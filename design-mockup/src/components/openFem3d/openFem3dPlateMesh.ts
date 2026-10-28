/**
 * Rekennet van 3D-platen (MITC4-vierhoeken) voor de externe 3D-kern.
 *
 * WAT HIER GEBEURT
 *  1. Elke plaat krijgt een eigen vlak assenstelsel (oorsprong in de eerste
 *     hoekknoop, e1 langs de eerste rand, normaal uit de knoopvolgorde). Haar
 *     buitenrand en openingen worden in dat vlak geprojecteerd: rechte randen,
 *     cirkelbogen (door de aangeklikte stuurknoop) en afgeronde hoeken.
 *  2. Knopen die platen en staven moeten delen komen uit één register:
 *     - bijzondere punten: hoekknopen, modelknopen op een rand of in een plaat,
 *       uiteinden van randen en staafdelen, snijpunten van lijnen in een plaat,
 *       doorstekende staven;
 *     - elke rechte lijn (plaatrand, staaf in het plaatvlak, rand van een
 *       andere plaat in het plaatvlak) wordt tussen opeenvolgende bijzondere
 *       punten canoniek verdeeld (grof raster: twee keer de elementgrootte).
 *     Twee platen of een plaat en een staaf langs dezelfde lijn krijgen zo
 *     exact dezelfde knopen; knopen worden op coördinaat samengevoegd.
 *  3. Een rechthoekige plaat (eventueel met rechthoekige openingen en
 *     knopen in het veld) krijgt een gestructureerd raster. Elke andere plaat
 *     wordt met Triangle getrianguleerd zonder extra punten op de lijnen en
 *     elke driehoek wordt in drie vierhoeken gesplitst (hoek, twee
 *     randmiddens, zwaartepunt). Beide wegen verfijnen de grove randverdeling
 *     met de middens, zodat aangrenzende platen dezelfde randknopen houden.
 *  4. Elke staaf krijgt de meshknopen op zijn as als tussenknopen: de adapter
 *     knipt hem daar voor de kern en voegt de uitkomst weer samen.
 *
 * Het gebruikersmodel verandert niet: nieuwe knopen krijgen id's boven de
 * hoogste modelknoop en bestaan alleen in het rekenmodel.
 */
import type {
  OpenFem3DModel, OpenFem3DNode, OpenFem3DPlate, OpenFem3DPlateBoundarySegment,
} from "./openFem3dModel";
import { circularArcThroughPoints2D } from "./openFem3dCircularArc";

type V3 = [number, number, number];
type V2 = [number, number];

export interface OpenFem3DMeshNode { id: number; x: number; y: number; z: number }

export interface OpenFem3DMeshElement {
  id: number;
  plateId: number;
  /** Rondgaand, tegen de klok in rond de plaatnormaal van het meshvlak. */
  nodeIds: [number, number, number, number];
}

export interface OpenFem3DPlateMeshInfo {
  plateId: number;
  /** "raster": gestructureerd; "driehoeken": driehoeksnet gesplitst in vierhoeken. */
  method: "raster" | "driehoeken";
  /** Gebruikte elementgrootte (m). */
  meshSizeM: number;
  elementCount: number;
}

export interface OpenFem3DPlateMesh {
  /** Alleen de NIEUWE knopen; modelknopen behouden hun id. */
  nodes: OpenFem3DMeshNode[];
  elements: OpenFem3DMeshElement[];
  /** Per staaf de meshknopen op zijn as tussen begin en eind, van begin naar eind. */
  beamIntermediateNodes: Map<number, number[]>;
  /**
   * Per plaat, per rand k van de buitencontour (zie OpenFem3DPlateEdgeSupport)
   * de rekenknopen op die rand — voor de randopleggingen.
   */
  plateEdgeNodes: Map<number, number[][]>;
  plates: OpenFem3DPlateMeshInfo[];
  /** Meldingen voor de gebruiker (bijv. een vergroofd net). */
  notices: string[];
}

/** Invoer van de triangulator (zie `triangulatePslg` in TriangleService). */
export interface OpenFem3DPslg {
  points: { x: number; y: number }[];
  segments: [number, number][];
  holes: { x: number; y: number }[];
  maxArea: number;
  minAngle: number;
}

export type OpenFem3DTriangulator = (input: OpenFem3DPslg) =>
  Promise<{ points: { x: number; y: number }[]; triangles: [number, number, number][] }>;

export interface OpenFem3DPlateMeshOptions {
  /** Triangulator; standaard Triangle (WASM). */
  triangulate?: OpenFem3DTriangulator;
  /** Bovengrens van het totale aantal elementen; daarboven wordt het net grover. */
  maxElements?: number;
  /** Altijd het driehoekspad (voor verificatie van dat pad op een rechthoek). */
  forceTriangulation?: boolean;
}

/** Afstandstolerantie voor "ligt op" en "is dezelfde knoop" (m). */
const TOL = 1e-6;
const DEFAULT_MAX_ELEMENTS = 30_000;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const l = norm(a); return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const pointOf = (node: Pick<OpenFem3DNode, "x" | "y" | "z">): V3 => [node.x, node.y, node.z];

/** Standaard-elementgrootte: een tiende van de kleinste plaatmaat, tussen 0,1 en 0,5 m. */
export function defaultOpenFem3DPlateMeshSizeM(shortestSpanM: number): number {
  return Math.min(0.5, Math.max(0.1, shortestSpanM / 10));
}

/**
 * Standaard-elementgrootte van een metselwerkwand (#97): hoogstens 0,1 m.
 * Met E horizontaal ≈ 0 geven grove, scheve elementen (het driehoekspad
 * rond een opening met latei) parasitaire afschuiving boven de opening. Bij
 * 0,27 m kwam 22 % van de last boven de opening niet via de latei; bij 0,1 m
 * 6 %, bij 0,05 m 3 % (test-open-fem3d-metselwerkwand.mjs). De lateitoets
 * rekent daarom met de analytische lateibelasting (openFem3DLintelDesign).
 */
function defaultPlateMeshSizeM(plate: OpenFem3DPlate, shortestSpanM: number): number {
  const size = defaultOpenFem3DPlateMeshSizeM(shortestSpanM);
  return plate.masonry ? Math.min(size, 0.1) : size;
}

// ── Knoopregister: coördinaten → id ─────────────────────────────────────────

class PointRegistry {
  private cells = new Map<string, { id: number; p: V3 }[]>();
  private nextId: number;
  readonly created: OpenFem3DMeshNode[] = [];
  readonly positions = new Map<number, V3>();

  constructor(modelNodes: readonly OpenFem3DNode[]) {
    this.nextId = modelNodes.reduce((max, node) => Math.max(max, node.id), 0) + 1;
    for (const node of modelNodes) this.insert(node.id, pointOf(node));
  }

  private key(i: number, j: number, k: number) { return `${i},${j},${k}`; }

  private cell(p: V3): V3 {
    const size = 1e-4;
    return [Math.floor(p[0] / size), Math.floor(p[1] / size), Math.floor(p[2] / size)];
  }

  private insert(id: number, p: V3) {
    const [i, j, k] = this.cell(p);
    const key = this.key(i, j, k);
    const list = this.cells.get(key);
    if (list) list.push({ id, p }); else this.cells.set(key, [{ id, p }]);
    if (!this.positions.has(id)) this.positions.set(id, p);
  }

  find(p: V3): number | undefined {
    const [i, j, k] = this.cell(p);
    for (let di = -1; di <= 1; di += 1) for (let dj = -1; dj <= 1; dj += 1) for (let dk = -1; dk <= 1; dk += 1) {
      const list = this.cells.get(this.key(i + di, j + dj, k + dk));
      if (!list) continue;
      for (const entry of list) if (norm(sub(entry.p, p)) <= TOL) return entry.id;
    }
    return undefined;
  }

  /** Bestaande knoop op deze plaats, of een nieuwe meshknoop. */
  get(p: V3): number {
    const existing = this.find(p);
    if (existing !== undefined) return existing;
    const id = this.nextId++;
    this.insert(id, p);
    this.created.push({ id, x: p[0], y: p[1], z: p[2] });
    return id;
  }
}

// ── Plaatvlak en contouren ──────────────────────────────────────────────────

interface Frame { origin: V3; e1: V3; e2: V3; n: V3 }

function toLocal(frame: Frame, p: V3): V2 {
  const d = sub(p, frame.origin);
  return [dot(d, frame.e1), dot(d, frame.e2)];
}

function toGlobal(frame: Frame, q: V2): V3 {
  return add(frame.origin, add(scale(frame.e1, q[0]), scale(frame.e2, q[1])));
}

/** Een stuk rand: recht (drager van gedeelde knopen) of gebogen (vast bemonsterd). */
type Piece =
  | { kind: "line"; a: V3; b: V3 }
  | { kind: "curve"; points: V3[]; arc?: { center: V3; radius: number } };

interface Contour { pieces: Piece[] }

interface PlateGeometry {
  plate: OpenFem3DPlate;
  frame: Frame;
  outer: Contour;
  holes: Contour[];
  /** Gemiddelde afmeting voor de standaard-elementgrootte. */
  shortestSpan: number;
  /** Elementgrootte h (m); het grove randraster is 2h. */
  meshSize: number;
}

function newellNormal(points: V3[]): V3 {
  const n: V3 = [0, 0, 0];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i], b = points[(i + 1) % points.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}

/** Punten op de cirkel door start, via en eind, van start tot eind (via ligt erop). */
function arcPoints(start: V3, through: V3, end: V3, spacing: number, frame: Frame): { points: V3[]; center: V3; radius: number } | null {
  const a = toLocal(frame, start), m = toLocal(frame, through), b = toLocal(frame, end);
  const arc = circularArcThroughPoints2D({ x: a[0], y: a[1] }, { x: m[0], y: m[1] }, { x: b[0], y: b[1] });
  if (!arc) return null;
  const angleOf = (q: V2) => Math.atan2(q[1] - arc.center.y, q[0] - arc.center.x);
  const unwrap = (angle: number) => {
    // Hoek relatief tot de start, in de draairichting van de boog.
    let delta = angle - arc.startAngle;
    if (arc.sweep >= 0) { while (delta < 0) delta += 2 * Math.PI; while (delta > 2 * Math.PI) delta -= 2 * Math.PI; }
    else { while (delta > 0) delta -= 2 * Math.PI; while (delta < -2 * Math.PI) delta += 2 * Math.PI; }
    return delta;
  };
  const middle = unwrap(angleOf(m));
  const sample = (from: number, to: number): V2[] => {
    const count = Math.max(1, Math.ceil(Math.abs(to - from) * arc.radius / spacing - 1e-9));
    return Array.from({ length: count + 1 }, (_, k) => {
      const angle = arc.startAngle + from + (to - from) * k / count;
      return [arc.center.x + arc.radius * Math.cos(angle), arc.center.y + arc.radius * Math.sin(angle)] as V2;
    });
  };
  const first = sample(0, middle);
  const second = sample(middle, arc.sweep);
  // Stuur- en eindpunt exact op de knoop.
  first[first.length - 1] = m;
  second[0] = m;
  second[second.length - 1] = b;
  first[0] = a;
  const local = [...first, ...second.slice(1)];
  return {
    points: local.map((q) => toGlobal(frame, q)),
    center: toGlobal(frame, [arc.center.x, arc.center.y]),
    radius: arc.radius,
  };
}

function contourFromBoundary(
  boundary: readonly OpenFem3DPlateBoundarySegment[], byId: ReadonlyMap<number, OpenFem3DNode>,
  spacing: number, frame: Frame,
): Contour | null {
  const pieces: Piece[] = [];
  for (const segment of boundary) {
    const start = byId.get(segment.startNodeId), end = byId.get(segment.endNodeId);
    if (!start || !end) return null;
    if (segment.kind === "line") {
      pieces.push({ kind: "line", a: pointOf(start), b: pointOf(end) });
    } else {
      const control = byId.get(segment.controlNodeId);
      if (!control) return null;
      const sampled = arcPoints(pointOf(start), pointOf(control), pointOf(end), spacing, frame);
      if (!sampled) return null;
      pieces.push({ kind: "curve", points: sampled.points, arc: { center: sampled.center, radius: sampled.radius } });
    }
  }
  return { pieces };
}

/** Knooplus met afgeronde hoeken: dezelfde kwadratische boog als in de weergave. */
function contourFromLoop(loop: V3[], radius: number, spacing: number): Contour {
  if (!(radius > 0)) {
    return { pieces: loop.map((a, i) => ({ kind: "line" as const, a, b: loop[(i + 1) % loop.length] })) };
  }
  const count = loop.length;
  const corners = loop.map((corner, index) => {
    const previous = loop[(index + count - 1) % count], next = loop[(index + 1) % count];
    const incoming = sub(previous, corner), outgoing = sub(next, corner);
    const limited = Math.min(radius, norm(incoming) * 0.45, norm(outgoing) * 0.45);
    return {
      start: add(corner, scale(unit(incoming), limited)),
      corner,
      end: add(corner, scale(unit(outgoing), limited)),
    };
  });
  const pieces: Piece[] = [];
  for (let index = 0; index < count; index += 1) {
    const { start, corner, end } = corners[index];
    const bezier = (s: number): V3 => add(add(scale(start, (1 - s) ** 2), scale(corner, 2 * s * (1 - s))), scale(end, s * s));
    const length = Array.from({ length: 8 }, (_, k) => norm(sub(bezier((k + 1) / 8), bezier(k / 8)))).reduce((a, b) => a + b, 0);
    const steps = Math.max(1, Math.ceil(length / spacing - 1e-9));
    pieces.push({ kind: "curve", points: Array.from({ length: steps + 1 }, (_, k) => bezier(k / steps)) });
    const next = corners[(index + 1) % count];
    if (norm(sub(next.start, end)) > TOL) pieces.push({ kind: "line", a: end, b: next.start });
  }
  return { pieces };
}

/** Punten van een contour als gesloten veelhoek (laatste punt niet herhaald). */
function contourPolyline(contour: Contour): V3[] {
  const out: V3[] = [];
  for (const piece of contour.pieces) {
    const points = piece.kind === "line" ? [piece.a, piece.b] : piece.points;
    for (const p of points) {
      if (out.length === 0 || norm(sub(out[out.length - 1], p)) > TOL) out.push(p);
    }
  }
  if (out.length > 1 && norm(sub(out[0], out[out.length - 1])) <= TOL) out.pop();
  return out;
}

// ── 2D-meetkunde in het plaatvlak ───────────────────────────────────────────

function distanceToSegment2(p: V2, a: V2, b: V2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function insidePolygon(p: V2, polygon: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

interface Region { outer: V2[]; holes: V2[][] }

/** "inside" (strikt binnen), "boundary" (op een rand) of "outside" (ook: in een opening). */
function classify(p: V2, region: Region): "inside" | "boundary" | "outside" {
  for (const loop of [region.outer, ...region.holes]) {
    for (let i = 0; i < loop.length; i += 1) {
      if (distanceToSegment2(p, loop[i], loop[(i + 1) % loop.length]) <= TOL) return "boundary";
    }
  }
  if (!insidePolygon(p, region.outer)) return "outside";
  return region.holes.some((hole) => insidePolygon(p, hole)) ? "outside" : "inside";
}

/** Parameters t ∈ (0, 1) waar lijnstuk a→b een randlijnstuk van het gebied snijdt. */
function crossingParameters(a: V2, b: V2, region: Region): number[] {
  const out: number[] = [];
  const d: V2 = [b[0] - a[0], b[1] - a[1]];
  for (const loop of [region.outer, ...region.holes]) {
    for (let i = 0; i < loop.length; i += 1) {
      const c = loop[i], e = loop[(i + 1) % loop.length];
      const f: V2 = [e[0] - c[0], e[1] - c[1]];
      const denominator = d[0] * f[1] - d[1] * f[0];
      if (Math.abs(denominator) < 1e-14) continue;
      const w: V2 = [c[0] - a[0], c[1] - a[1]];
      const t = (w[0] * f[1] - w[1] * f[0]) / denominator;
      const s = (w[0] * d[1] - w[1] * d[0]) / denominator;
      if (t > 1e-12 && t < 1 - 1e-12 && s >= -1e-12 && s <= 1 + 1e-12) out.push(t);
    }
  }
  return out;
}

// ── Vlak en contour van één plaat (net en plaatsing gebruiken dezelfde) ─────

/**
 * Vlakassen van een plaat: oorsprong in de eerste hoekknoop, e1 langs de
 * eerste rand, normaal (Newell) uit de knoopvolgorde. Plus de kleinste
 * plaatmaat in die assen, voor de standaard-elementgrootte.
 */
function plateFrame(
  plate: OpenFem3DPlate, byId: ReadonlyMap<number, OpenFem3DNode>,
): { frame: Frame; normal: V3; shortest: number } {
  const loop = plate.nodeIds.map((id) => byId.get(id));
  if (loop.some((node) => !node)) throw new Error(`3D-plaat ${plate.id} verwijst naar een ontbrekende knoop.`);
  const points = loop.map((node) => pointOf(node!));
  const normal = newellNormal(points);
  if (!(norm(normal) > 1e-12)) throw new Error(`3D-plaat ${plate.id} heeft geen oppervlakte.`);
  const e1 = unit(sub(points[1], points[0]));
  const n = unit(normal);
  const frame: Frame = { origin: points[0], e1, e2: cross(n, e1), n };
  const local = points.map((p) => toLocal(frame, p));
  const xs = local.map((q) => q[0]), ys = local.map((q) => q[1]);
  return { frame, normal, shortest: Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) };
}

/** Buitenrand en openingen van een plaat, bogen bemonsterd op `spacing` (zoals in het net). */
function plateContours(
  plate: OpenFem3DPlate, byId: ReadonlyMap<number, OpenFem3DNode>, spacing: number, frame: Frame,
): { outer: Contour; holes: Contour[] } {
  const outer = plate.boundary
    ? contourFromBoundary(plate.boundary, byId, spacing, frame)
    : contourFromLoop(plate.nodeIds.map((id) => pointOf(byId.get(id)!)), plate.cornerRadiusM ?? 0, spacing);
  if (!outer) throw new Error(`3D-plaat ${plate.id}: de rand is niet op te bouwen.`);
  const holes: Contour[] = [];
  for (const opening of plate.openings ?? []) {
    const contour = opening.boundary
      ? contourFromBoundary(opening.boundary, byId, spacing, frame)
      : contourFromLoop(opening.nodeIds.map((id) => pointOf(byId.get(id)!)), opening.cornerRadiusM ?? 0, spacing);
    if (!contour) throw new Error(`Opening ${opening.id} van 3D-plaat ${plate.id} is niet op te bouwen.`);
    holes.push(contour);
  }
  return { outer, holes };
}

/** Het vlak waarin het net een plaat legt: een punt erop (de eerste hoekknoop) en de eenheidsnormaal. */
export interface OpenFem3DPlatePlane {
  origin: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
}

/** Het middenvlak van een plaat, zoals het rekennet het gebruikt (Newell-normaal door de eerste hoekknoop). */
export function openFem3DPlatePlane(model: OpenFem3DModel, plate: OpenFem3DPlate): OpenFem3DPlatePlane {
  const { frame } = plateFrame(plate, new Map(model.nodes.map((node) => [node.id, node])));
  const [ox, oy, oz] = frame.origin, [nx, ny, nz] = frame.n;
  return { origin: { x: ox, y: oy, z: oz }, normal: { x: nx, y: ny, z: nz } };
}

/**
 * Waar een punt van het plaatvlak ligt, met de contour zoals het rekennet hem
 * gebruikt (bogen en afgeronde hoeken bemonsterd op twee keer de
 * elementgrootte): "inside" en "boundary" komen als bijzonder punt in het net,
 * "opening" (in een opening) en "outside" (buiten de buitenrand) niet. Het
 * punt wordt in het vlak beoordeeld; de afstand tot het vlak telt niet mee.
 */
export function classifyOpenFem3DPlatePoint(
  model: OpenFem3DModel, plate: OpenFem3DPlate, point: { x: number; y: number; z: number },
): "inside" | "boundary" | "opening" | "outside" {
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const { frame, shortest } = plateFrame(plate, byId);
  const meshSize = plate.meshSizeM ?? defaultPlateMeshSizeM(plate, shortest);
  const { outer, holes } = plateContours(plate, byId, 2 * meshSize, frame);
  const region: Region = {
    outer: contourPolyline(outer).map((p) => toLocal(frame, p)),
    holes: holes.map((hole) => contourPolyline(hole).map((p) => toLocal(frame, p))),
  };
  const q = toLocal(frame, [point.x, point.y, point.z]);
  const state = classify(q, region);
  if (state !== "outside") return state;
  return insidePolygon(q, region.outer) && region.holes.some((hole) => insidePolygon(q, hole)) ? "opening" : "outside";
}

// ── Lijndragers en hun verdeling ────────────────────────────────────────────

interface Carrier {
  a: V3;
  b: V3;
  /** Platen die deze lijn in hun net gebruiken (rand of inwendige lijn). */
  plateIds: Set<number>;
}

/** Afstand van punt p tot lijnstuk a→b en de parameter langs het lijnstuk (m). */
function projectOnCarrier(p: V3, a: V3, b: V3): { distance: number; along: number; length: number } {
  const axis = sub(b, a);
  const length = norm(axis);
  const along = dot(sub(p, a), axis) / length;
  const foot = add(a, scale(axis, along / length));
  return { distance: norm(sub(p, foot)), along, length };
}

// ── Hoofdroutine ────────────────────────────────────────────────────────────

let triangleModule: Promise<typeof import("../../core/mesher/TriangleService")> | null = null;

const defaultTriangulator: OpenFem3DTriangulator = async (input) => {
  triangleModule ??= import("../../core/mesher/TriangleService");
  const { triangulatePslg } = await triangleModule;
  return triangulatePslg(input);
};

/**
 * Mesh alle platen van het model. Gooit een Error met Nederlandse reden als
 * een plaat niet te meshen is; er wordt nooit stil een plaat overgeslagen.
 */
export async function meshOpenFem3DPlates(
  model: OpenFem3DModel, options: OpenFem3DPlateMeshOptions = {},
): Promise<OpenFem3DPlateMesh> {
  const plates = model.plates ?? [];
  const empty: OpenFem3DPlateMesh = {
    nodes: [], elements: [], beamIntermediateNodes: new Map(), plateEdgeNodes: new Map(), plates: [], notices: [],
  };
  if (plates.length === 0) return empty;
  const triangulate = options.triangulate ?? defaultTriangulator;
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const notices: string[] = [];

  // 1. Vlakken, maten en contouren.
  const frames = new Map<number, Frame>();
  const sizes = new Map<number, { shortest: number; area: number }>();
  for (const plate of plates) {
    const { frame, normal, shortest } = plateFrame(plate, byId);
    frames.set(plate.id, frame);
    sizes.set(plate.id, { shortest, area: Math.abs(norm(normal)) / 2 });
  }
  const meshSizes = new Map<number, number>();
  for (const plate of plates) {
    const size = plate.meshSizeM ?? defaultPlateMeshSizeM(plate, sizes.get(plate.id)!.shortest);
    if (!(size > 0) || !Number.isFinite(size)) throw new Error(`3D-plaat ${plate.id} heeft een ongeldige meshgrootte.`);
    meshSizes.set(plate.id, size);
  }
  const maxElements = options.maxElements ?? DEFAULT_MAX_ELEMENTS;
  const estimate = plates.reduce((sum, plate) => sum + sizes.get(plate.id)!.area / meshSizes.get(plate.id)! ** 2, 0);
  if (estimate > maxElements) {
    const factor = Math.sqrt(estimate / maxElements);
    for (const plate of plates) meshSizes.set(plate.id, meshSizes.get(plate.id)! * factor);
    notices.push(
      `Het plaatnet zou ongeveer ${Math.round(estimate)} elementen krijgen; alle elementgroottes zijn met ` +
      `factor ${factor.toFixed(2)} vergroot tot de grens van ${maxElements} elementen.`,
    );
  }

  const geometries: PlateGeometry[] = [];
  for (const plate of plates) {
    const frame = frames.get(plate.id)!;
    const spacing = 2 * meshSizes.get(plate.id)!;
    const { outer, holes } = plateContours(plate, byId, spacing, frame);
    geometries.push({
      plate, frame, outer, holes,
      shortestSpan: sizes.get(plate.id)!.shortest,
      meshSize: meshSizes.get(plate.id)!,
    });
  }
  const regions = new Map<number, Region>(geometries.map((g) => [g.plate.id, {
    outer: contourPolyline(g.outer).map((p) => toLocal(g.frame, p)),
    holes: g.holes.map((hole) => contourPolyline(hole).map((p) => toLocal(g.frame, p))),
  }]));
  const inPlane = (g: PlateGeometry, p: V3) => Math.abs(dot(sub(p, g.frame.origin), g.frame.n)) <= TOL * 10;

  // 2. Dragers: plaatranden en inwendige lijnen (staven en randen van andere
  //    platen in het plaatvlak), plus harde punten in het veld.
  const carriers: Carrier[] = [];
  const internalLines = new Map<number, { a: V3; b: V3 }[]>();
  const hardPoints = new Map<number, V3[]>();
  const specialPoints: V3[] = [];
  const addCarrier = (a: V3, b: V3, plateId: number) => {
    if (norm(sub(b, a)) <= TOL) return;
    carriers.push({ a, b, plateIds: new Set([plateId]) });
    specialPoints.push(a, b);
  };
  for (const g of geometries) {
    internalLines.set(g.plate.id, []);
    hardPoints.set(g.plate.id, []);
    for (const contour of [g.outer, ...g.holes]) {
      for (const piece of contour.pieces) {
        if (piece.kind === "line") addCarrier(piece.a, piece.b, g.plate.id);
        else specialPoints.push(piece.points[0], piece.points[piece.points.length - 1]);
      }
    }
  }
  /** Het deel van a→b dat strikt binnen de plaat ligt, als lijnstukken. */
  const clipInside = (g: PlateGeometry, a: V3, b: V3): { a: V3; b: V3 }[] => {
    const region = regions.get(g.plate.id)!;
    const la = toLocal(g.frame, a), lb = toLocal(g.frame, b);
    const cuts = [0, ...crossingParameters(la, lb, region), 1].sort((p, q) => p - q);
    const out: { a: V3; b: V3 }[] = [];
    for (let i = 0; i + 1 < cuts.length; i += 1) {
      if (cuts[i + 1] - cuts[i] < 1e-9) continue;
      const mid = (cuts[i] + cuts[i + 1]) / 2;
      const q: V2 = [la[0] + (lb[0] - la[0]) * mid, la[1] + (lb[1] - la[1]) * mid];
      if (classify(q, region) === "inside") out.push({ a: lerp(a, b, cuts[i]), b: lerp(a, b, cuts[i + 1]) });
      // Snijpunten met de rand worden altijd bijzonder punt.
      if (i > 0) specialPoints.push(lerp(a, b, cuts[i]));
    }
    return out;
  };
  const relevantBeams = new Map<number, Set<number>>(); // beamId → plateIds
  for (const g of geometries) {
    const region = regions.get(g.plate.id)!;
    for (const beam of model.beams) {
      const start = byId.get(beam.startNodeId), end = byId.get(beam.endNodeId);
      if (!start || !end) continue;
      const a = pointOf(start), b = pointOf(end);
      const da = dot(sub(a, g.frame.origin), g.frame.n), db = dot(sub(b, g.frame.origin), g.frame.n);
      if (Math.abs(da) <= TOL * 10 && Math.abs(db) <= TOL * 10) {
        const la = toLocal(g.frame, a), lb = toLocal(g.frame, b);
        const touches = classify(la, region) !== "outside" || classify(lb, region) !== "outside"
          || crossingParameters(la, lb, region).length > 0;
        if (!touches) continue;
        (relevantBeams.get(beam.id) ?? relevantBeams.set(beam.id, new Set()).get(beam.id)!).add(g.plate.id);
        for (const part of clipInside(g, a, b)) {
          internalLines.get(g.plate.id)!.push(part);
          addCarrier(part.a, part.b, g.plate.id);
        }
      } else if (da * db < 0 && Math.abs(da) > TOL * 10 && Math.abs(db) > TOL * 10) {
        // Doorstekende staaf: het doorstoot­punt wordt een knoop van plaat en staaf.
        const p = lerp(a, b, da / (da - db));
        const state = classify(toLocal(g.frame, p), region);
        if (state === "outside") continue;
        (relevantBeams.get(beam.id) ?? relevantBeams.set(beam.id, new Set()).get(beam.id)!).add(g.plate.id);
        specialPoints.push(p);
        if (state === "inside") hardPoints.get(g.plate.id)!.push(p);
      }
    }
    // Randen van andere platen die in dit plaatvlak liggen (wand op vloer).
    for (const other of geometries) {
      if (other === g) continue;
      for (const contour of [other.outer, ...other.holes]) {
        for (const piece of contour.pieces) {
          if (piece.kind !== "line" || !inPlane(g, piece.a) || !inPlane(g, piece.b)) continue;
          for (const part of clipInside(g, piece.a, piece.b)) {
            internalLines.get(g.plate.id)!.push(part);
            addCarrier(part.a, part.b, g.plate.id);
          }
        }
      }
    }
    // Modelknopen in het veld (kolomkop, oplegging, puntlast) worden harde punten.
    for (const node of model.nodes) {
      const p = pointOf(node);
      if (!inPlane(g, p)) continue;
      const state = classify(toLocal(g.frame, p), region);
      if (state === "inside") hardPoints.get(g.plate.id)!.push(p);
      if (state !== "outside") specialPoints.push(p);
    }
  }
  // Snijpunten van inwendige lijnen onderling en met de rand, per plaat.
  for (const g of geometries) {
    const lines = [
      ...internalLines.get(g.plate.id)!,
      ...[g.outer, ...g.holes].flatMap((c) => c.pieces.flatMap((p) => p.kind === "line" ? [{ a: p.a, b: p.b }] : [])),
    ];
    for (let i = 0; i < lines.length; i += 1) {
      for (let j = i + 1; j < lines.length; j += 1) {
        const a = toLocal(g.frame, lines[i].a), b = toLocal(g.frame, lines[i].b);
        const c = toLocal(g.frame, lines[j].a), e = toLocal(g.frame, lines[j].b);
        const d: V2 = [b[0] - a[0], b[1] - a[1]], f: V2 = [e[0] - c[0], e[1] - c[1]];
        const denominator = d[0] * f[1] - d[1] * f[0];
        if (Math.abs(denominator) < 1e-12) continue;
        const w: V2 = [c[0] - a[0], c[1] - a[1]];
        const t = (w[0] * f[1] - w[1] * f[0]) / denominator;
        const s = (w[0] * d[1] - w[1] * d[0]) / denominator;
        if (t > -1e-9 && t < 1 + 1e-9 && s > -1e-9 && s < 1 + 1e-9) specialPoints.push(lerp(lines[i].a, lines[i].b, t));
      }
    }
  }

  // 2b. Rechthoekige platen: spiegel harde punten en openingshoeken naar alle
  //     evenwijdige randen (buitenrand en openingen), zodat een gestructureerd
  //     raster erdoor kan lopen zonder knopen die de buren niet hebben.
  const rectangles = new Map<number, RectangleFrame>();
  for (const g of geometries) {
    const rectangle = rectangleFrame(g);
    if (!rectangle || internalLines.get(g.plate.id)!.length > 0) continue;
    rectangles.set(g.plate.id, rectangle);
    const toRect = (p: V3): V2 => { const d = sub(p, rectangle.origin); return [dot(d, rectangle.ex), dot(d, rectangle.ey)]; };
    const fromRect = (q: V2): V3 => add(rectangle.origin, add(scale(rectangle.ex, q[0]), scale(rectangle.ey, q[1])));
    const mirrors: V2[] = hardPoints.get(g.plate.id)!.map(toRect);
    const horizontalEdges: { y: number; x0: number; x1: number }[] = [
      { y: 0, x0: 0, x1: rectangle.width }, { y: rectangle.height, x0: 0, x1: rectangle.width },
    ];
    const verticalEdges: { x: number; y0: number; y1: number }[] = [
      { x: 0, y0: 0, y1: rectangle.height }, { x: rectangle.width, y0: 0, y1: rectangle.height },
    ];
    for (const hole of g.holes) {
      const corners = contourPolyline(hole).map(toRect);
      mirrors.push(...corners);
      const xs = corners.map((q) => q[0]), ys = corners.map((q) => q[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      horizontalEdges.push({ y: y0, x0, x1 }, { y: y1, x0, x1 });
      verticalEdges.push({ x: x0, y0, y1 }, { x: x1, y0, y1 });
    }
    for (const [x, y] of mirrors) {
      for (const edge of horizontalEdges) {
        if (x > edge.x0 + TOL && x < edge.x1 - TOL) specialPoints.push(fromRect([x, edge.y]));
      }
      for (const edge of verticalEdges) {
        if (y > edge.y0 + TOL && y < edge.y1 - TOL) specialPoints.push(fromRect([edge.x, y]));
      }
    }
  }

  // 3. Verdeel elke drager: breekpunten = bijzondere punten erop; elk
  //    deelstuk canoniek (vanaf de kleinste knoop-id) met de kleinste grove
  //    maat (2h) van de platen die het gebruiken.
  const registry = new PointRegistry(model.nodes);
  interface Interval { ia: number; ib: number; key: string }
  const intervalsOf = new Map<Carrier, Interval[]>();
  const spacingByKey = new Map<string, number>();
  for (const carrier of carriers) {
    const length = norm(sub(carrier.b, carrier.a));
    const params = new Set<number>([0, length]);
    for (const p of specialPoints) {
      const { distance, along } = projectOnCarrier(p, carrier.a, carrier.b);
      if (distance <= TOL * 10 && along > TOL && along < length - TOL) params.add(along);
    }
    const sorted = [...params].sort((p, q) => p - q).filter((v, i, arr) => i === 0 || v - arr[i - 1] > TOL);
    const intervals: Interval[] = [];
    for (let i = 0; i + 1 < sorted.length; i += 1) {
      const ia = registry.get(lerp(carrier.a, carrier.b, sorted[i] / length));
      const ib = registry.get(lerp(carrier.a, carrier.b, sorted[i + 1] / length));
      if (ia === ib) continue;
      const key = ia < ib ? `${ia}-${ib}` : `${ib}-${ia}`;
      intervals.push({ ia, ib, key });
      for (const plateId of carrier.plateIds) {
        spacingByKey.set(key, Math.min(spacingByKey.get(key) ?? Infinity, 2 * meshSizes.get(plateId)!));
      }
    }
    intervalsOf.set(carrier, intervals);
  }
  /** Grove punten langs een deelstuk, van ia naar ib, als knoop-id's. */
  const intervalPoints = (interval: Interval): number[] => {
    const forward = interval.ia < interval.ib;
    const [p, q] = forward ? [interval.ia, interval.ib] : [interval.ib, interval.ia];
    const pa = registry.positions.get(p)!, pb = registry.positions.get(q)!;
    const count = Math.max(1, Math.ceil(norm(sub(pb, pa)) / spacingByKey.get(interval.key)! - 1e-9));
    const ids = Array.from({ length: count + 1 }, (_, k) =>
      k === 0 ? p : k === count ? q : registry.get(lerp(pa, pb, k / count)));
    return forward ? ids : ids.reverse();
  };
  /** Grove punten langs een willekeurig lijnstuk dat uit dragers bestaat. */
  const linePoints = (a: V3, b: V3): number[] => {
    const carrier = carriers.find((c) =>
      (norm(sub(c.a, a)) <= TOL && norm(sub(c.b, b)) <= TOL) || (norm(sub(c.a, b)) <= TOL && norm(sub(c.b, a)) <= TOL));
    if (!carrier) return [registry.get(a), registry.get(b)];
    const intervals = intervalsOf.get(carrier)!;
    const ids: number[] = [];
    for (const interval of intervals) {
      const points = intervalPoints(interval);
      ids.push(...(ids.length ? points.slice(1) : points));
    }
    return norm(sub(carrier.a, a)) <= TOL ? ids : ids.reverse();
  };

  const elements: OpenFem3DMeshElement[] = [];
  const infos: OpenFem3DPlateMeshInfo[] = [];
  const plateEdgeNodes = new Map<number, number[][]>();
  const arcEdges = new Map<string, { center: V3; radius: number }>();
  const edgeKey = (a: number, b: number) => a < b ? `${a}-${b}` : `${b}-${a}`;
  const plateNodeIds = new Map<number, Set<number>>();

  for (const g of geometries) {
    const plateId = g.plate.id;
    const ownNodes = new Set<number>();
    plateNodeIds.set(plateId, ownNodes);
    // Contouren als id-lussen (grof), met boogranden gemarkeerd.
    const loopIds = (contour: Contour): number[] => {
      const ids: number[] = [];
      for (const piece of contour.pieces) {
        const points = piece.kind === "line"
          ? linePoints(piece.a, piece.b)
          : piece.points.map((p) => registry.get(p));
        if (piece.kind === "curve" && piece.arc) {
          for (let k = 0; k + 1 < points.length; k += 1) arcEdges.set(edgeKey(points[k], points[k + 1]), piece.arc);
        }
        for (const id of points) if (ids.length === 0 || ids[ids.length - 1] !== id) ids.push(id);
      }
      if (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop();
      return ids;
    };
    const outerIds = loopIds(g.outer);
    const holeIds = g.holes.map(loopIds);
    const internal = internalLines.get(plateId)!.map((line) => linePoints(line.a, line.b));
    const hard = hardPoints.get(plateId)!.map((p) => registry.get(p));
    const rectangle = rectangles.get(plateId);
    const before = elements.length;
    let method: OpenFem3DPlateMeshInfo["method"] = "driehoeken";
    const raster = rectangle && !options.forceTriangulation
      ? rasterMesh(g, rectangle, outerIds, holeIds, hard, registry) : null;
    if (raster) {
      method = "raster";
      for (const quad of raster) elements.push({ id: elements.length + 1, plateId, nodeIds: quad });
    } else {
      const quads = await triangulatedQuads(g, outerIds, holeIds, internal, hard, registry, arcEdges, triangulate);
      for (const quad of quads) elements.push({ id: elements.length + 1, plateId, nodeIds: quad });
    }
    for (const element of elements.slice(before)) for (const id of element.nodeIds) ownNodes.add(id);
    if (elements.length === before) throw new Error(`3D-plaat ${plateId} leverde geen elementen op.`);
    plateEdgeNodes.set(plateId, outerEdgeNodes(g, byId, ownNodes, registry));
    infos.push({ plateId, method, meshSizeM: g.meshSize, elementCount: elements.length - before });
  }

  // 4. Tussenknopen per staaf: de knopen van de betrokken platen op de staafas.
  const beamIntermediateNodes = new Map<number, number[]>();
  for (const [beamId, plateIds] of relevantBeams) {
    const beam = model.beams.find((item) => item.id === beamId)!;
    const a = pointOf(byId.get(beam.startNodeId)!), b = pointOf(byId.get(beam.endNodeId)!);
    const found = new Map<number, number>();
    for (const plateId of plateIds) {
      for (const id of plateNodeIds.get(plateId) ?? []) {
        if (id === beam.startNodeId || id === beam.endNodeId) continue;
        const { distance, along, length } = projectOnCarrier(registry.positions.get(id)!, a, b);
        if (distance <= TOL * 10 && along > TOL && along < length - TOL) found.set(id, along);
      }
    }
    if (found.size > 0) beamIntermediateNodes.set(beamId, [...found].sort((p, q) => p[1] - q[1]).map(([id]) => id));
  }
  const used = new Set(elements.flatMap((element) => element.nodeIds));
  for (const ids of beamIntermediateNodes.values()) for (const id of ids) used.add(id);
  return {
    nodes: registry.created.filter((node) => used.has(node.id)),
    elements,
    beamIntermediateNodes,
    plateEdgeNodes,
    plates: infos,
    notices,
  };
}

/**
 * Rekenknopen van één plaat op elke rand k van haar buitencontour: een rechte
 * rand van knoop k naar k+1 (of randstuk k), of een cirkelboog van `boundary`.
 * Bij afgeronde hoeken telt alleen het rechte deel van de rand mee.
 */
function outerEdgeNodes(
  g: PlateGeometry, byId: ReadonlyMap<number, OpenFem3DNode>, ownNodes: ReadonlySet<number>, registry: PointRegistry,
): number[][] {
  const plate = g.plate;
  const segments: ({ kind: "line"; a: V3; b: V3 } | { kind: "arc"; piece: Extract<Piece, { kind: "curve" }> })[] = [];
  if (plate.boundary) {
    plate.boundary.forEach((segment, index) => {
      const piece = g.outer.pieces[index];
      if (segment.kind === "arc" && piece?.kind === "curve" && piece.arc) segments.push({ kind: "arc", piece });
      else segments.push({ kind: "line", a: pointOf(byId.get(segment.startNodeId)!), b: pointOf(byId.get(segment.endNodeId)!) });
    });
  } else {
    plate.nodeIds.forEach((id, index) => segments.push({
      kind: "line", a: pointOf(byId.get(id)!), b: pointOf(byId.get(plate.nodeIds[(index + 1) % plate.nodeIds.length])!),
    }));
  }
  const nodes = [...ownNodes];
  return segments.map((segment) => {
    const found: { id: number; t: number }[] = [];
    if (segment.kind === "line") {
      for (const id of nodes) {
        const { distance, along, length } = projectOnCarrier(registry.positions.get(id)!, segment.a, segment.b);
        if (distance <= TOL * 10 && along >= -TOL && along <= length + TOL) found.push({ id, t: along });
      }
    } else {
      const { points, arc } = segment.piece;
      const center = arc!.center, radius = arc!.radius;
      const u = unit(sub(points[0], center));
      const v = cross(g.frame.n, u);
      const angle = (p: V3) => { const d = sub(p, center); return Math.atan2(dot(d, v), dot(d, u)); };
      const direction = Math.sign(angle(points[1])) || 1;
      const unwrap = (theta: number) => {
        let value = theta * direction;
        while (value < -1e-9) value += 2 * Math.PI;
        return value;
      };
      const sweep = unwrap(angle(points[points.length - 1])) || 2 * Math.PI;
      for (const id of nodes) {
        const p = registry.positions.get(id)!;
        if (Math.abs(norm(sub(p, center)) - radius) > TOL * 10 * Math.max(1, radius)) continue;
        const t = unwrap(angle(p));
        if (t <= sweep + 1e-9) found.push({ id, t });
      }
    }
    return found.sort((p, q) => p.t - q.t).map((item) => item.id);
  });
}

// ── Rechthoek: gestructureerd raster ────────────────────────────────────────

interface RectangleFrame { origin: V3; ex: V3; ey: V3; width: number; height: number }

/** Is de plaat een rechthoek met alleen rechthoekige, evenwijdige openingen? */
function rectangleFrame(g: PlateGeometry): RectangleFrame | null {
  const corners = (contour: Contour): V3[] | null => {
    if (contour.pieces.some((piece) => piece.kind !== "line")) return null;
    const loop = contourPolyline(contour);
    // Collineaire tussenknopen weglaten.
    const reduced = loop.filter((p, i) => {
      const previous = loop[(i + loop.length - 1) % loop.length], next = loop[(i + 1) % loop.length];
      return norm(cross(sub(p, previous), sub(next, p))) > 1e-9 * norm(sub(p, previous)) * norm(sub(next, p));
    });
    return reduced.length === 4 ? reduced : null;
  };
  const outer = corners(g.outer);
  if (!outer) return null;
  const ex = unit(sub(outer[1], outer[0]));
  const eyRaw = sub(outer[3], outer[0]);
  const ey = unit(eyRaw);
  const square = (loop: V3[]) => loop.every((p, i) => {
    const next = loop[(i + 1) % 4], previous = loop[(i + 3) % 4];
    return Math.abs(dot(unit(sub(next, p)), unit(sub(previous, p)))) < 1e-9;
  });
  if (!square(outer)) return null;
  const aligned = (loop: V3[]) => loop.every((p, i) => {
    const d = unit(sub(loop[(i + 1) % 4], p));
    return Math.abs(Math.abs(dot(d, ex)) - 1) < 1e-9 || Math.abs(Math.abs(dot(d, ey)) - 1) < 1e-9;
  });
  for (const hole of g.holes) {
    const loop = corners(hole);
    if (!loop || !square(loop) || !aligned(loop)) return null;
  }
  return { origin: outer[0], ex, ey, width: norm(sub(outer[1], outer[0])), height: norm(eyRaw) };
}

function rasterMesh(
  g: PlateGeometry, rectangle: RectangleFrame, outerIds: number[], holeIds: number[][], hard: number[],
  registry: PointRegistry,
): [number, number, number, number][] | null {
  const toRect = (id: number): V2 => {
    const d = sub(registry.positions.get(id)!, rectangle.origin);
    return [dot(d, rectangle.ex), dot(d, rectangle.ey)];
  };
  const snap = (values: number[]) => [...values].sort((a, b) => a - b)
    .filter((v, i, arr) => i === 0 || v - arr[i - 1] > TOL * 10);
  // Grove punten per rand: x-waarden op horizontale randen, y op verticale.
  const horizontal: { y: number; xs: number[]; range: V2 }[] = [];
  const vertical: { x: number; ys: number[]; range: V2 }[] = [];
  const collect = (loop: number[]) => {
    const points = loop.map(toRect);
    // Groepeer per rechte zijde.
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i], b = points[(i + 1) % points.length];
      if (Math.abs(a[1] - b[1]) <= TOL * 10) {
        const side = horizontal.find((h) => Math.abs(h.y - a[1]) <= TOL * 10
          && Math.min(a[0], b[0]) <= h.range[1] + TOL * 10 && Math.max(a[0], b[0]) >= h.range[0] - TOL * 10);
        if (side) { side.xs.push(a[0], b[0]); side.range = [Math.min(side.range[0], a[0], b[0]), Math.max(side.range[1], a[0], b[0])]; }
        else horizontal.push({ y: a[1], xs: [a[0], b[0]], range: [Math.min(a[0], b[0]), Math.max(a[0], b[0])] });
      } else if (Math.abs(a[0] - b[0]) <= TOL * 10) {
        const side = vertical.find((v) => Math.abs(v.x - a[0]) <= TOL * 10
          && Math.min(a[1], b[1]) <= v.range[1] + TOL * 10 && Math.max(a[1], b[1]) >= v.range[0] - TOL * 10);
        if (side) { side.ys.push(a[1], b[1]); side.range = [Math.min(side.range[0], a[1], b[1]), Math.max(side.range[1], a[1], b[1])]; }
        else vertical.push({ x: a[0], ys: [a[1], b[1]], range: [Math.min(a[1], b[1]), Math.max(a[1], b[1])] });
      } else {
        return false;
      }
    }
    return true;
  };
  if (!collect(outerIds) || !holeIds.every(collect)) return null;
  const hardPoints = hard.map(toRect);
  const X = snap([...horizontal.flatMap((h) => h.xs), ...hardPoints.map((p) => p[0])]);
  const Y = snap([...vertical.flatMap((v) => v.ys), ...hardPoints.map((p) => p[1])]);
  // Elke zijde moet precies de rasterlijnen binnen haar bereik dragen, anders
  // zou het raster knopen toevoegen die de buurplaat of staaf niet heeft.
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= TOL * 10);
  for (const side of horizontal) {
    if (!same(snap(side.xs), X.filter((x) => x >= side.range[0] - TOL * 10 && x <= side.range[1] + TOL * 10))) return null;
  }
  for (const side of vertical) {
    if (!same(snap(side.ys), Y.filter((y) => y >= side.range[0] - TOL * 10 && y <= side.range[1] + TOL * 10))) return null;
  }
  // Fijn raster: de grove lijnen plus hun middens.
  const refine = (values: number[]) => values.flatMap((v, i) => i + 1 < values.length ? [v, (v + values[i + 1]) / 2] : [v]);
  const xs = refine(X), ys = refine(Y);
  const holeRects = holeIds.map((loop) => {
    const points = loop.map(toRect);
    return {
      minX: Math.min(...points.map((p) => p[0])), maxX: Math.max(...points.map((p) => p[0])),
      minY: Math.min(...points.map((p) => p[1])), maxY: Math.max(...points.map((p) => p[1])),
    };
  });
  const cellExists = (i: number, j: number) => {
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
    return !holeRects.some((r) => cx > r.minX && cx < r.maxX && cy > r.minY && cy < r.maxY);
  };
  const point = (i: number, j: number): V3 =>
    add(rectangle.origin, add(scale(rectangle.ex, xs[i]), scale(rectangle.ey, ys[j])));
  // Rechtsom of linksom ten opzichte van de meshnormaal van de plaat.
  const counterClockwise = dot(cross(rectangle.ex, rectangle.ey), g.frame.n) > 0;
  const quads: [number, number, number, number][] = [];
  for (let j = 0; j + 1 < ys.length; j += 1) {
    for (let i = 0; i + 1 < xs.length; i += 1) {
      if (!cellExists(i, j)) continue;
      const a = registry.get(point(i, j)), b = registry.get(point(i + 1, j));
      const c = registry.get(point(i + 1, j + 1)), d = registry.get(point(i, j + 1));
      quads.push(counterClockwise ? [a, b, c, d] : [a, d, c, b]);
    }
  }
  return quads;
}

// ── Overige vormen: driehoeken, elk in drie vierhoeken ──────────────────────

async function triangulatedQuads(
  g: PlateGeometry, outerIds: number[], holeIds: number[][], internal: number[][], hard: number[],
  registry: PointRegistry, arcEdges: Map<string, { center: V3; radius: number }>,
  triangulate: OpenFem3DTriangulator,
): Promise<[number, number, number, number][]> {
  const index = new Map<number, number>();
  const points: { x: number; y: number }[] = [];
  const ids: number[] = [];
  const at = (id: number) => {
    let k = index.get(id);
    if (k === undefined) {
      k = points.length;
      index.set(id, k);
      const [x, y] = toLocal(g.frame, registry.positions.get(id)!);
      points.push({ x, y });
      ids.push(id);
    }
    return k;
  };
  const segments: [number, number][] = [];
  const addLoop = (loop: number[]) => {
    for (let k = 0; k < loop.length; k += 1) segments.push([at(loop[k]), at(loop[(k + 1) % loop.length])]);
  };
  addLoop(outerIds);
  holeIds.forEach(addLoop);
  for (const line of internal) for (let k = 0; k + 1 < line.length; k += 1) segments.push([at(line[k]), at(line[k + 1])]);
  for (const id of hard) at(id);
  const holes = holeIds.map((loop) => interiorPoint(loop.map((id) => toLocal(g.frame, registry.positions.get(id)!))));
  const coarse = 2 * g.meshSize;
  const result = await triangulate({
    points, segments, holes: holes.map(([x, y]) => ({ x, y })),
    maxArea: Math.sqrt(3) / 4 * coarse * coarse, minAngle: 25,
  });
  if (result.triangles.length === 0) throw new Error(`3D-plaat ${g.plate.id}: de driehoeksmesher gaf geen elementen.`);
  // Uitvoerpunten: de invoerpunten eerst (zelfde volgorde), daarna nieuwe.
  const outputIds = result.points.map((q, k) => k < ids.length ? ids[k] : registry.get(toGlobal(g.frame, [q.x, q.y])));
  const quads: [number, number, number, number][] = [];
  const midpoint = (a: number, b: number) => {
    const pa = registry.positions.get(a)!, pb = registry.positions.get(b)!;
    let m = scale(add(pa, pb), 0.5);
    const arc = arcEdges.get(a < b ? `${a}-${b}` : `${b}-${a}`);
    if (arc) {
      // Op een boogrand komt het midden op de cirkel.
      const radial = sub(m, arc.center);
      const length = norm(radial);
      if (length > 0) m = add(arc.center, scale(radial, arc.radius / length));
    }
    return registry.get(m);
  };
  for (const [i, j, k] of result.triangles) {
    let [a, b, c] = [outputIds[i], outputIds[j], outputIds[k]];
    // Omloop tegen de klok in rond de meshnormaal.
    const pa = registry.positions.get(a)!, pb = registry.positions.get(b)!, pc = registry.positions.get(c)!;
    if (dot(cross(sub(pb, pa), sub(pc, pa)), g.frame.n) < 0) [b, c] = [c, b];
    const mab = midpoint(a, b), mbc = midpoint(b, c), mca = midpoint(c, a);
    const centre = registry.get(scale(add(add(registry.positions.get(a)!, registry.positions.get(b)!), registry.positions.get(c)!), 1 / 3));
    quads.push([a, mab, centre, mca], [b, mbc, centre, mab], [c, mca, centre, mbc]);
  }
  return quads;
}

/** Een punt strikt binnen een veelhoek (voor het gatmerkteken van Triangle). */
function interiorPoint(polygon: V2[]): V2 {
  let area = 0, cx = 0, cy = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const c = polygon[j][0] * polygon[i][1] - polygon[i][0] * polygon[j][1];
    area += c; cx += (polygon[j][0] + polygon[i][0]) * c; cy += (polygon[j][1] + polygon[i][1]) * c;
  }
  if (Math.abs(area) > 1e-14) {
    const centroid: V2 = [cx / (3 * area), cy / (3 * area)];
    if (insidePolygon(centroid, polygon)) return centroid;
  }
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const mid: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (const side of [1, -1]) {
      const q: V2 = [mid[0] - side * (b[1] - a[1]) / length * 1e-3, mid[1] + side * (b[0] - a[0]) / length * 1e-3];
      if (insidePolygon(q, polygon)) return q;
    }
  }
  return polygon[0];
}

/**
 * Belastingvlakken: afdracht van een oppervlaktelast naar de liggers.
 *
 * WAAROM HIER, EN NIET IN DE KERN
 * De 3D-rekenkern kent alleen knoop- en staaflasten. Een belastingvlak wordt
 * daarom vóór de kern omgezet in gewone trapeziumvormige staaflasten (plus,
 * waar nodig, knooplasten). De kern blijft ongewijzigd en iedere afgeleide
 * last is gewoon zichtbaar en controleerbaar: in het eigenschappenpaneel, in
 * het rapport en in de onafhankelijke krachtensom van de adapter.
 *
 * LASTRICHTING (per vlak)
 *  - gravity: q in kN/m² HORIZONTALE PROJECTIE, werkt in globale −Z.
 *    Per m² vlak is dat q·|n_z|; Σ verticaal = q × projectie-oppervlak.
 *  - normal:  q in kN/m² VLAK, werkt langs de vaste vlaknormaal n.
 *    n wijst naar beneden (n_z < 0); bij een verticaal vlak naar −Y, en bij
 *    een vlak evenwijdig aan YZ naar −X. De hoekvolgorde doet er dus niet
 *    toe. Een negatieve q werkt tegen n in (zuiging).
 *
 * AFDRACHT
 *  - oneWay: de gebruiker kiest de overspanningsrichting u (in het vlak). De
 *    last gaat naar de liggers DWARS op u (hoekafwijking hoogstens
 *    OPEN_FEM_3D_ONE_WAY_ANGLE_TOLERANCE_DEG); elk punt gaat langs u naar de
 *    dichtstbijzijnde van die liggers. Bij evenwijdige liggers is dat precies
 *    "de halve afstand tot de buren als belastingbreedte", de randligger de
 *    halve strook. Liggers evenwijdig aan u en schuine staven (windverbanden)
 *    krijgen niets. Een rand zonder ligger dwars op u geeft een overstek naar
 *    de dichtstbijzijnde ligger, met een melding.
 *  - twoWay: elk punt van het vlak gaat naar de dichtstbijzijnde ligger. Voor
 *    een rechthoek op vier randliggers zijn de grenzen precies de 45°-lijnen
 *    uit de hoeken: twee trapezia en twee driehoeken. Een tussenligger deelt
 *    het vlak op dezelfde manier op; een rand zonder ligger geeft zijn last
 *    aan de dichtstbijzijnde ligger, met een melding.
 *
 * EXACTHEID
 * Beide afdrachten leveren stuksgewijs lineaire lijnlasten. De éénrichting
 * wordt met een veegbeweging dwars op u exact in trapezia opgedeeld. De
 * tweerichting volgt per ligger de loodlijnen op de staaf; de knikpunten
 * (de 45°-lijnen) worden als snijpunt van twee rechte lijnen exact bepaald.
 * Alleen gekromde grenzen — rond een vrij staafeinde of een inspringende
 * hoek — worden adaptief benaderd; de totale last sluit daar tot op 1e-6.
 */
import {
  openFem3DLoadCaseId,
  openFem3DMemberAxes,
  parseOpenFem3DModel,
  type OpenFem3DBeam,
  type OpenFem3DLoadPanel,
  type OpenFem3DLoadPanelDirection,
  type OpenFem3DLoadPanelDistribution,
  type OpenFem3DMemberLoad,
  type OpenFem3DMemberPointLoad,
  type OpenFem3DModel,
  type OpenFem3DNodalLoad,
  type OpenFem3DNode,
  type OpenFem3DVector,
} from "./openFem3dModel";

/** Afstand waarbinnen een knoop in het vlak of op de rand ligt (1 mm). */
export const OPEN_FEM_3D_LOAD_PANEL_TOLERANCE_M = 1e-3;
/** Grootste hoekafwijking van "dwars op de overspanning" bij éénrichting. */
export const OPEN_FEM_3D_ONE_WAY_ANGLE_TOLERANCE_DEG = 10;
/** Standaardintensiteit van een nieuw getekend belastingvlak, kN/m². */
export const OPEN_FEM_3D_LOAD_PANEL_DEFAULT_Q = 1;

type Vec2 = [number, number];
type Vec3 = [number, number, number];

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a: Vec3, factor: number): Vec3 => [a[0] * factor, a[1] * factor, a[2] * factor];
const dot3 = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm3 = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit3 = (a: Vec3): Vec3 => scale3(a, 1 / norm3(a));
const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const dot2 = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const cross2 = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const norm2 = (a: Vec2) => Math.hypot(a[0], a[1]);
const vec3 = (node: Pick<OpenFem3DNode, "x" | "y" | "z">): Vec3 => [node.x, node.y, node.z];

// ── Meetkunde van het vlak ──────────────────────────────────────────────────

export interface OpenFem3DLoadPanelGeometry {
  panelId: number;
  /** Oorsprong van de vlakcoördinaten (gemiddelde van de hoekpunten). */
  origin: Vec3;
  /** Vaste eenheidsnormaal; de richting van een positieve loodrechte last. */
  normal: Vec3;
  /** Assen in het vlak; (u, v, normaal) is rechtshandig. Bij éénrichting is u de overspanning. */
  axisU: Vec3;
  axisV: Vec3;
  /** Hoekpunten in (u, v), tegen de klok in rond de normaal. */
  polygon: Vec2[];
  /** Openingen in dezelfde vlakcoördinaten; binnen deze veelhoeken is geen last. */
  holePolygons: Vec2[][];
  /** Knoopnummers in dezelfde volgorde als `polygon`. */
  cornerNodeIds: number[];
  areaM2: number;
  /** Horizontale projectie: areaM2 × |n_z|. */
  projectedAreaM2: number;
  centroid: Vec3;
  /** Grootste afmeting van het vlak; basis voor relatieve toleranties. */
  sizeM: number;
}

/**
 * Normaal met een vaste oriëntatie, onafhankelijk van de volgorde waarin de
 * hoeken geklikt zijn: naar beneden, anders naar −Y, anders naar −X.
 */
function canonicalNormal(normal: Vec3): Vec3 {
  const e = 1e-6;
  const flip = Math.abs(normal[2]) > e ? normal[2] > 0
    : Math.abs(normal[1]) > e ? normal[1] > 0
      : normal[0] > 0;
  return flip ? scale3(normal, -1) : normal;
}

function signedArea(polygon: readonly Vec2[]): number {
  let twice = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    twice += cross2(polygon[index], polygon[(index + 1) % polygon.length]);
  }
  return twice / 2;
}

function polygonCentroid(polygon: readonly Vec2[]): Vec2 {
  let area = 0, cx = 0, cy = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length];
    const c = cross2(a, b);
    area += c;
    cx += (a[0] + b[0]) * c;
    cy += (a[1] + b[1]) * c;
  }
  return area === 0 ? [0, 0] : [cx / (3 * area), cy / (3 * area)];
}

function pointSegmentDistance2(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub2(b, a);
  const lengthSquared = dot2(ab, ab);
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, dot2(sub2(p, a), ab) / lengthSquared)) : 0;
  return norm2(sub2(p, [a[0] + t * ab[0], a[1] + t * ab[1]]));
}

function segmentsDistance2(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const r = sub2(b, a), s = sub2(d, c);
  const denominator = cross2(r, s);
  if (Math.abs(denominator) > 1e-300) {
    const t = cross2(sub2(c, a), s) / denominator;
    const u = cross2(sub2(c, a), r) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(
    pointSegmentDistance2(a, c, d), pointSegmentDistance2(b, c, d),
    pointSegmentDistance2(c, a, b), pointSegmentDistance2(d, a, b),
  );
}

/** Even-oneven-regel; een punt precies op de rand is hier onbepaald. */
function pointInPolygon(p: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index], b = polygon[previous];
    if ((a[1] > p[1]) !== (b[1] > p[1])
      && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function distanceToBoundary(p: Vec2, polygon: readonly Vec2[]): number {
  let minimum = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    minimum = Math.min(minimum, pointSegmentDistance2(p, polygon[index], polygon[(index + 1) % polygon.length]));
  }
  return minimum;
}

function insideOrOnPolygon(p: Vec2, polygon: readonly Vec2[], tolerance: number): boolean {
  return distanceToBoundary(p, polygon) <= tolerance || pointInPolygon(p, polygon);
}

export function openFem3DLoadPanelGeometry(
  model: Pick<OpenFem3DModel, "nodes">,
  panel: Pick<OpenFem3DLoadPanel, "id" | "nodeIds" | "distribution" | "spanDirection" | "openings">,
  nodeById?: ReadonlyMap<number, OpenFem3DNode>,
): OpenFem3DLoadPanelGeometry {
  const label = `3D-belastingvlak ${panel.id}`;
  const tolerance = OPEN_FEM_3D_LOAD_PANEL_TOLERANCE_M;
  const byId = nodeById ?? new Map(model.nodes.map((node) => [node.id, node]));
  if (panel.nodeIds.length < 3) throw new Error(`${label} heeft minstens drie hoekknopen nodig.`);
  const points = panel.nodeIds.map((id): Vec3 => {
    const node = byId.get(id);
    if (!node) throw new Error(`${label}: hoekknoop ${id} bestaat niet.`);
    return vec3(node);
  });
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (norm3(sub3(points[i], points[j])) <= tolerance) {
        throw new Error(`${label}: de hoekknopen ${panel.nodeIds[i]} en ${panel.nodeIds[j]} vallen samen.`);
      }
    }
  }
  // Newell: robuust voor iedere (ook niet-convexe) vlakke veelhoek.
  const newell: Vec3 = [0, 0, 0];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index], b = points[(index + 1) % points.length];
    newell[0] += (a[1] - b[1]) * (a[2] + b[2]);
    newell[1] += (a[2] - b[2]) * (a[0] + b[0]);
    newell[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  if (!(norm3(newell) / 2 > tolerance * tolerance)) {
    throw new Error(`${label} heeft geen oppervlakte: de hoekknopen liggen op één lijn.`);
  }
  const rawNormal = unit3(newell);
  const origin = scale3(points.reduce((sum, point) => add3(sum, point), [0, 0, 0] as Vec3), 1 / points.length);
  for (const [index, point] of points.entries()) {
    const offset = Math.abs(dot3(sub3(point, origin), rawNormal));
    if (offset > tolerance) {
      throw new Error(
        `${label} is niet vlak: hoekknoop ${panel.nodeIds[index]} ligt ${(offset * 1000).toFixed(1)} mm ` +
        `buiten het vlak door de andere hoeken (toegestaan ${tolerance * 1000} mm).`,
      );
    }
  }
  const normal = canonicalNormal(rawNormal);
  let axisU: Vec3;
  if (panel.distribution === "oneWay") {
    if (!panel.spanDirection) throw new Error(`${label} draagt in één richting af maar mist de overspanningsrichting.`);
    const direction: Vec3 = [panel.spanDirection.x, panel.spanDirection.y, panel.spanDirection.z];
    const inPlane = sub3(direction, scale3(normal, dot3(direction, normal)));
    if (norm3(inPlane) <= 1e-6 * norm3(direction)) {
      throw new Error(`${label}: de overspanningsrichting staat loodrecht op het vlak. Kies een richting in het vlak.`);
    }
    axisU = unit3(inPlane);
  } else {
    const edge = sub3(points[1], points[0]);
    axisU = unit3(sub3(edge, scale3(normal, dot3(edge, normal))));
  }
  const axisV = cross3(normal, axisU);
  let polygon = points.map((point): Vec2 => {
    const relative = sub3(point, origin);
    return [dot3(relative, axisU), dot3(relative, axisV)];
  });
  let cornerNodeIds = [...panel.nodeIds];
  if (signedArea(polygon) < 0) {
    polygon = [...polygon].reverse();
    cornerNodeIds = [...cornerNodeIds].reverse();
  }
  const n = polygon.length;
  for (let i = 0; i < n; i += 1) {
    const a = polygon[i], b = polygon[(i + 1) % n];
    // Een rand die op zichzelf terugvouwt, is een spijker zonder oppervlak.
    const c = polygon[(i + 2) % n];
    const first = sub2(b, a), second = sub2(c, b);
    if (Math.abs(cross2(first, second)) <= 1e-12 * norm2(first) * norm2(second) && dot2(first, second) < 0) {
      throw new Error(`${label} vouwt bij hoekknoop ${cornerNodeIds[(i + 1) % n]} op zichzelf terug.`);
    }
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsDistance2(a, b, polygon[j], polygon[(j + 1) % n]) <= tolerance * 1e-3) {
        throw new Error(
          `${label} snijdt zichzelf: de rand ${cornerNodeIds[i]}–${cornerNodeIds[(i + 1) % n]} ` +
          `raakt de rand ${cornerNodeIds[j]}–${cornerNodeIds[(j + 1) % n]}.`,
        );
      }
    }
  }
  const outerAreaM2 = Math.abs(signedArea(polygon));
  const strict = tolerance * 1e-3;
  const holePolygons = (panel.openings ?? []).map((opening) => {
    // Dezelfde keuring op vlakheid, zelfsnijding en oppervlakte als de buitenrand.
    openFem3DLoadPanelGeometry(model, { id: opening.id, nodeIds: opening.nodeIds, distribution: "twoWay" }, byId);
    const hole = opening.nodeIds.map((id): Vec2 => {
      const relative = sub3(vec3(byId.get(id)!), origin);
      if (Math.abs(dot3(relative, normal)) > tolerance) throw new Error(`${label}: opening ${opening.id} ligt buiten het vlak.`);
      return [dot3(relative, axisU), dot3(relative, axisV)];
    });
    for (let i = 0; i < hole.length; i += 1) {
      if (!pointInPolygon(hole[i], polygon) || distanceToBoundary(hole[i], polygon) <= strict) {
        throw new Error(`${label}: opening ${opening.id} ligt niet volledig binnen de buitenrand.`);
      }
      for (let j = 0; j < polygon.length; j += 1) {
        if (segmentsDistance2(hole[i], hole[(i + 1) % hole.length], polygon[j], polygon[(j + 1) % polygon.length]) <= strict) {
          throw new Error(`${label}: opening ${opening.id} raakt de buitenrand.`);
        }
      }
    }
    return hole;
  });
  for (let i = 0; i < holePolygons.length; i += 1) for (let j = i + 1; j < holePolygons.length; j += 1) {
    const a = holePolygons[i], b = holePolygons[j];
    if (pointInPolygon(a[0], b) || pointInPolygon(b[0], a)
      || a.some((start, index) => b.some((other, otherIndex) =>
        segmentsDistance2(start, a[(index + 1) % a.length], other, b[(otherIndex + 1) % b.length]) <= strict))) {
      throw new Error(`${label}: openingen ${panel.openings![i].id} en ${panel.openings![j].id} overlappen.`);
    }
  }
  const areaM2 = outerAreaM2 - holePolygons.reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0);
  if (!(areaM2 > tolerance * tolerance)) throw new Error(`${label} heeft geen netto oppervlak.`);
  const outerCentre = polygonCentroid(polygon);
  const weightedCentre = holePolygons.reduce<Vec2>((weighted, hole) => {
    const holeArea = Math.abs(signedArea(hole)), centre = polygonCentroid(hole);
    return [weighted[0] - holeArea * centre[0], weighted[1] - holeArea * centre[1]];
  }, [outerAreaM2 * outerCentre[0], outerAreaM2 * outerCentre[1]]);
  const centre2: Vec2 = [weightedCentre[0] / areaM2, weightedCentre[1] / areaM2];
  const sizeM = Math.max(tolerance, ...polygon.flatMap((a) => polygon.map((b) => norm2(sub2(a, b)))));
  return {
    panelId: panel.id,
    origin, normal, axisU, axisV, polygon, holePolygons, cornerNodeIds, areaM2,
    projectedAreaM2: areaM2 * Math.abs(normal[2]),
    centroid: add3(origin, add3(scale3(axisU, centre2[0]), scale3(axisV, centre2[1]))),
    sizeM,
  };
}

/** Kracht per m² WERKELIJK vlak (kN/m², globaal). */
export function openFem3DLoadPanelForcePerArea(
  panel: Pick<OpenFem3DLoadPanel, "id" | "q" | "direction">,
  geometry: Pick<OpenFem3DLoadPanelGeometry, "normal">,
): Vec3 {
  if (panel.direction === "gravity") {
    const projection = Math.abs(geometry.normal[2]);
    if (projection < 1e-6) {
      throw new Error(
        `3D-belastingvlak ${panel.id} staat verticaal: een last per m² horizontale projectie heeft daar geen ` +
        "oppervlak. Kies de lastrichting loodrecht op het vlak.",
      );
    }
    return [0, 0, -panel.q * projection];
  }
  if (panel.direction === "verticalSurface") return [0, 0, -panel.q];
  return scale3(geometry.normal, panel.q);
}

// ── Staven in het vlak ──────────────────────────────────────────────────────

interface PanelBeam {
  beam: OpenFem3DBeam;
  /** Begin- en eindknoop in vlakcoördinaten (begin = startNodeId). */
  a: Vec2;
  b: Vec2;
  length2: number;
  length3: number;
  direction: Vec2;
}

type SegmentStatus = "inside" | "partial" | "outside";

/**
 * Ligt het lijnstuk in (of op de rand van) de veelhoek? "partial" betekent
 * dat het over een lengte met het vlak samenvalt maar er ook buiten komt; een
 * aanraking in één punt telt als buiten.
 */
function segmentStatus(a: Vec2, b: Vec2, polygon: readonly Vec2[], tolerance: number): SegmentStatus {
  const parameters = [0, 1];
  const ab = sub2(b, a);
  const lengthSquared = dot2(ab, ab);
  for (let index = 0; index < polygon.length; index += 1) {
    const p = polygon[index], q = polygon[(index + 1) % polygon.length];
    const pq = sub2(q, p);
    const denominator = cross2(ab, pq);
    if (Math.abs(denominator) > 1e-300) {
      const t = cross2(sub2(p, a), pq) / denominator;
      const u = cross2(sub2(p, a), ab) / denominator;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) parameters.push(t);
    }
    for (const corner of [p, q]) {
      const t = dot2(sub2(corner, a), ab) / lengthSquared;
      if (t > 0 && t < 1) parameters.push(t);
    }
  }
  parameters.sort((x, y) => x - y);
  let overlap = false, outside = false;
  for (const endpoint of [a, b]) if (!insideOrOnPolygon(endpoint, polygon, tolerance)) outside = true;
  for (let index = 0; index + 1 < parameters.length; index += 1) {
    if (parameters[index + 1] - parameters[index] <= 1e-12) continue;
    const t = (parameters[index] + parameters[index + 1]) / 2;
    if (insideOrOnPolygon([a[0] + t * ab[0], a[1] + t * ab[1]], polygon, tolerance)) overlap = true;
    else outside = true;
  }
  return !overlap ? "outside" : outside ? "partial" : "inside";
}

function panelBeams(model: OpenFem3DModel, geometry: OpenFem3DLoadPanelGeometry,
  byId: ReadonlyMap<number, OpenFem3DNode>, supportGeometry: OpenFem3DLoadPanelGeometry = geometry) {
  const tolerance = OPEN_FEM_3D_LOAD_PANEL_TOLERANCE_M;
  const inPanel: PanelBeam[] = [];
  const partial: number[] = [];
  const project = (point: Vec3): Vec2 => {
    const relative = sub3(point, geometry.origin);
    return [dot3(relative, geometry.axisU), dot3(relative, geometry.axisV)];
  };
  const projectSupport = (point: Vec3): Vec2 => {
    const relative = sub3(point, supportGeometry.origin);
    return [dot3(relative, supportGeometry.axisU), dot3(relative, supportGeometry.axisV)];
  };
  for (const beam of model.beams) {
    const start = byId.get(beam.startNodeId), end = byId.get(beam.endNodeId);
    if (!start || !end) continue;
    const s = vec3(start), e = vec3(end);
    if (Math.abs(dot3(sub3(s, geometry.origin), geometry.normal)) > tolerance
      || Math.abs(dot3(sub3(e, geometry.origin), geometry.normal)) > tolerance) continue;
    const a = project(s), b = project(e);
    const length2 = norm2(sub2(b, a));
    if (length2 <= tolerance) continue;
    const status = segmentStatus(projectSupport(s), projectSupport(e), supportGeometry.polygon, tolerance);
    if (status === "inside") {
      inPanel.push({
        beam, a, b, length2, length3: norm3(sub3(e, s)),
        direction: [(b[0] - a[0]) / length2, (b[1] - a[1]) / length2],
      });
    } else if (status === "partial") partial.push(beam.id);
  }
  return { inPanel, partial };
}

// ── Stukken lijnlast ────────────────────────────────────────────────────────

/** Eén lineair stuk belastingbreedte langs een staaf, posities in m vanaf de beginknoop. */
export interface OpenFem3DLoadPanelPiece {
  startPositionM: number;
  endPositionM: number;
  /** Belastingbreedte in m² vlak per m staaf aan begin en eind van het stuk. */
  widthStartM: number;
  widthEndM: number;
}

/** Tel stuksgewijs lineaire functies op (sprongen toegestaan) en voeg rechte voortzettingen samen. */
function sumPieces(pieces: readonly OpenFem3DLoadPanelPiece[], lengthM: number): OpenFem3DLoadPanelPiece[] {
  const valid = pieces.filter((piece) => piece.endPositionM - piece.startPositionM > 1e-12 * Math.max(1, lengthM));
  if (valid.length === 0) return [];
  const breaks = [...new Set(valid.flatMap((piece) => [piece.startPositionM, piece.endPositionM]))].sort((a, b) => a - b);
  const valueAt = (piece: OpenFem3DLoadPanelPiece, position: number) => piece.widthStartM
    + (piece.widthEndM - piece.widthStartM) * (position - piece.startPositionM) / (piece.endPositionM - piece.startPositionM);
  const summed: OpenFem3DLoadPanelPiece[] = [];
  for (let index = 0; index + 1 < breaks.length; index += 1) {
    const from = breaks[index], to = breaks[index + 1];
    if (to - from <= 1e-12 * Math.max(1, lengthM)) continue;
    const middle = (from + to) / 2;
    let start = 0, end = 0, covered = false;
    for (const piece of valid) {
      if (piece.startPositionM <= middle && middle <= piece.endPositionM) {
        start += valueAt(piece, from);
        end += valueAt(piece, to);
        covered = true;
      }
    }
    if (covered) summed.push({ startPositionM: from, endPositionM: to, widthStartM: start, widthEndM: end });
  }
  return mergePieces(summed);
}

/**
 * Voeg aansluitende stukken met dezelfde helling samen. De vergelijking gaat
 * op de HELLING, niet op een absolute afwijking: anders slokt een kort stuk
 * een knik op en verschuift het knikpunt van een 45°-lijn.
 */
function mergePieces(pieces: readonly OpenFem3DLoadPanelPiece[]): OpenFem3DLoadPanelPiece[] {
  const merged: OpenFem3DLoadPanelPiece[] = [];
  const slope = (piece: OpenFem3DLoadPanelPiece) =>
    (piece.widthEndM - piece.widthStartM) / (piece.endPositionM - piece.startPositionM);
  for (const piece of pieces) {
    const previous = merged[merged.length - 1];
    if (previous && Math.abs(previous.endPositionM - piece.startPositionM) <= 1e-12 * Math.max(1, piece.endPositionM)) {
      const scale = Math.max(1e-12, Math.abs(previous.widthStartM), Math.abs(previous.widthEndM),
        Math.abs(piece.widthStartM), Math.abs(piece.widthEndM));
      const a = slope(previous), b = slope(piece);
      if (Math.abs(previous.widthEndM - piece.widthStartM) <= 1e-9 * scale
        && Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b))) {
        merged[merged.length - 1] = { ...previous, endPositionM: piece.endPositionM, widthEndM: piece.widthEndM };
        continue;
      }
    }
    if (Math.abs(piece.widthStartM) + Math.abs(piece.widthEndM) > 0) merged.push({ ...piece });
  }
  return merged;
}

const pieceArea = (piece: OpenFem3DLoadPanelPiece) =>
  (piece.widthStartM + piece.widthEndM) / 2 * (piece.endPositionM - piece.startPositionM);

// ── Éénrichting: veegbeweging dwars op de overspanning ──────────────────────

/** u als lineaire functie van v: u = a + b·v. */
interface LinearInV { a: number; b: number }
const atV = (f: LinearInV, v: number) => f.a + f.b * v;
const throughUV = (p: Vec2, q: Vec2): LinearInV => {
  const slope = (q[0] - p[0]) / (q[1] - p[1]);
  return { a: p[0] - slope * p[1], b: slope };
};
const halfway = (f: LinearInV, g: LinearInV): LinearInV => ({ a: (f.a + g.a) / 2, b: (f.b + g.b) / 2 });

function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = sub2(b, a), s = sub2(d, c);
  const denominator = cross2(r, s);
  if (Math.abs(denominator) <= 1e-12 * norm2(r) * norm2(s)) return null;
  const t = cross2(sub2(c, a), s) / denominator;
  const u = cross2(sub2(c, a), r) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

interface UncoveredPiece { areaM2: number; centroid: Vec2 }

function distributeOneWay(geometry: OpenFem3DLoadPanelGeometry, receivers: readonly PanelBeam[]) {
  const tolerance = OPEN_FEM_3D_LOAD_PANEL_TOLERANCE_M;
  const polygon = geometry.polygon;
  const edges = [polygon, ...geometry.holePolygons].flatMap((loop) =>
    loop.map((p, index) => [p, loop[(index + 1) % loop.length]] as const));
  const epsilon = 1e-12 * geometry.sizeM;
  const critical = [
    ...[polygon, ...geometry.holePolygons].flatMap((loop) => loop.map((p) => p[1])),
    ...receivers.flatMap((receiver) => [receiver.a[1], receiver.b[1]]),
  ];
  const segments = [...receivers.map((receiver) => [receiver.a, receiver.b] as const), ...edges];
  for (let i = 0; i < receivers.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const hit = segmentIntersection(receivers[i].a, receivers[i].b, segments[j][0], segments[j][1]);
      if (hit) critical.push(hit[1]);
    }
  }
  critical.sort((x, y) => x - y);
  const levels: number[] = [];
  for (const value of critical) if (levels.length === 0 || value - levels[levels.length - 1] > epsilon) levels.push(value);

  const pieces = receivers.map(() => [] as { va: number; vb: number; wa: number; wb: number }[]);
  const uncovered: UncoveredPiece[] = [];
  const overhangByEdge = new Map<number, number>();
  const trapezoidArea = (left: LinearInV, right: LinearInV, va: number, vb: number) =>
    Math.max(0, ((atV(right, va) - atV(left, va)) + (atV(right, vb) - atV(left, vb))) / 2 * (vb - va));
  for (let level = 0; level + 1 < levels.length; level += 1) {
    const va = levels[level], vb = levels[level + 1];
    const vm = (va + vb) / 2;
    const crossings = edges.flatMap(([p, q], edge) =>
      Math.min(p[1], q[1]) < vm && vm < Math.max(p[1], q[1]) ? [{ f: throughUV(p, q), edge }] : [])
      .sort((x, y) => atV(x.f, vm) - atV(y.f, vm));
    const crossingBeams = receivers.flatMap((receiver, index) =>
      Math.min(receiver.a[1], receiver.b[1]) < vm && vm < Math.max(receiver.a[1], receiver.b[1])
        ? [{ index, f: throughUV(receiver.a, receiver.b) }] : []);
    for (let c = 0; c + 1 < crossings.length; c += 2) {
      const left = crossings[c], right = crossings[c + 1];
      const uLeft = atV(left.f, vm), uRight = atV(right.f, vm);
      const inside = crossingBeams
        .filter((item) => atV(item.f, vm) >= uLeft - tolerance && atV(item.f, vm) <= uRight + tolerance)
        .sort((x, y) => atV(x.f, vm) - atV(y.f, vm));
      if (inside.length === 0) {
        const corners: Vec2[] = [
          [atV(left.f, va), va], [atV(right.f, va), va], [atV(right.f, vb), vb], [atV(left.f, vb), vb],
        ];
        const areaM2 = Math.abs(signedArea(corners));
        if (areaM2 > 0) uncovered.push({ areaM2, centroid: polygonCentroid(corners) });
        continue;
      }
      inside.forEach((item, position) => {
        const from = position === 0 ? left.f : halfway(inside[position - 1].f, item.f);
        const to = position === inside.length - 1 ? right.f : halfway(item.f, inside[position + 1].f);
        const wa = Math.max(0, atV(to, va) - atV(from, va));
        const wb = Math.max(0, atV(to, vb) - atV(from, vb));
        if (wa + wb > 0) pieces[item.index].push({ va, vb, wa, wb });
      });
      const first = inside[0].f, last = inside[inside.length - 1].f;
      if (atV(first, vm) - uLeft > tolerance) {
        overhangByEdge.set(left.edge, (overhangByEdge.get(left.edge) ?? 0) + trapezoidArea(left.f, first, va, vb));
      }
      if (uRight - atV(last, vm) > tolerance) {
        overhangByEdge.set(right.edge, (overhangByEdge.get(right.edge) ?? 0) + trapezoidArea(last, right.f, va, vb));
      }
    }
  }
  const beamPieces = receivers.map((receiver, index) => {
    const dv = receiver.b[1] - receiver.a[1];
    const factor = Math.abs(dv) / receiver.length3;
    return sumPieces(pieces[index].map((piece) => {
      let start = (piece.va - receiver.a[1]) / dv * receiver.length3;
      let end = (piece.vb - receiver.a[1]) / dv * receiver.length3;
      let widthStart = piece.wa * factor, widthEnd = piece.wb * factor;
      if (start > end) {
        [start, end] = [end, start];
        [widthStart, widthEnd] = [widthEnd, widthStart];
      }
      return {
        startPositionM: Math.max(0, start), endPositionM: Math.min(receiver.length3, end),
        widthStartM: widthStart, widthEndM: widthEnd,
      };
    }), receiver.length3);
  });
  return { beamPieces, uncovered, overhangByEdge };
}

// ── Tweerichting: elk punt naar de dichtstbijzijnde ligger ──────────────────

/** Waarde als functie van de staafparameter t: c0 + c1·t. */
interface LinearInT { c0: number; c1: number }

interface Crossing { s: number; key: string; linear: LinearInT | null }

interface RaySample { t: number; w: number; key: string; linear: LinearInT | null }

/**
 * Kleinste s ≥ 0 waarbij het punt p0 + s·m even ver van lijnstuk j ligt als
 * van zijn eigen voetpunt (afstand s). Omdat afstand(p(s), j) − s niet
 * toeneemt, is dat de eerste grens van het gebied van de eigen staaf.
 */
function crossing(
  p0: Vec2, m: Vec2, segment: PanelBeam, key: string,
  origin: Vec2, along: Vec2, tolerance: number,
): Crossing | null {
  const q0 = segment.a, q1 = segment.b;
  const d = segment.direction;
  const nj: Vec2 = [-d[1], d[0]];
  // Alleen werkelijk samenvallen (een T-aansluiting, een gedeeld stuk): een
  // ruimere drempel zou vlak naast een hoek een valse nul geven.
  if (pointSegmentDistance2(p0, q0, q1) <= 1e-12 * Math.max(1, tolerance * 1e3)) {
    return { s: 0, key: `${key}z`, linear: { c0: 0, c1: 0 } };
  }
  let best: Crossing | null = null;
  const consider = (s: number, candidateKey: string, linear: LinearInT | null) => {
    if (!(s >= -1e-12) || !Number.isFinite(s)) return;
    const value = Math.max(0, s);
    const point: Vec2 = [p0[0] + value * m[0], p0[1] + value * m[1]];
    if (Math.abs(pointSegmentDistance2(point, q0, q1) - value) > 1e-9 * Math.max(1, value, tolerance * 1e3)) return;
    if (!best || value < best.s) best = { s: value, key: candidateKey, linear };
  };
  const c1 = dot2(m, nj);
  const baseC0 = dot2(sub2(origin, q0), nj);
  const alongC0 = dot2(along, nj);
  const c0 = dot2(sub2(p0, q0), nj);
  if (1 - c1 > 1e-12) consider(c0 / (1 - c1), `${key}+`, { c0: baseC0 / (1 - c1), c1: alongC0 / (1 - c1) });
  if (1 + c1 > 1e-12) consider(-c0 / (1 + c1), `${key}-`, { c0: -baseC0 / (1 + c1), c1: -alongC0 / (1 + c1) });
  for (const [end, endKey] of [[q0, "a"], [q1, "b"]] as const) {
    const g = sub2(p0, end);
    const denominator = -2 * dot2(m, g);
    if (denominator > 1e-15) consider(dot2(g, g) / denominator, `${key}${endKey}`, null);
  }
  return best;
}

interface RayInterval {
  sIn: number; sOut: number;
  keyIn: string; keyOut: string;
  linearIn: LinearInT | null; linearOut: LinearInT | null;
}

/** Delen van de straal p0 + s·m (s > 0) die binnen de veelhoek liggen. */
function rayIntervals(
  p0: Vec2, m: Vec2, polygon: readonly Vec2[], epsilon: number,
  origin?: Vec2, along?: Vec2, holes: readonly (readonly Vec2[])[] = [],
): RayInterval[] {
  const hits: { s: number; key: string; linear: LinearInT | null }[] = [];
  for (const [loopIndex, loop] of [polygon, ...holes].entries()) for (let index = 0; index < loop.length; index += 1) {
    const p = loop[index], q = loop[(index + 1) % loop.length];
    const r = sub2(q, p);
    const denominator = cross2(m, r);
    if (Math.abs(denominator) < 1e-14 * norm2(r)) continue;
    const w = sub2(p, p0);
    const s = cross2(w, r) / denominator;
    const lambda = cross2(w, m) / denominator;
    if (lambda < 0 || lambda > 1 || s <= epsilon) continue;
    hits.push({
      s, key: `${loopIndex}e${index}`,
      linear: origin && along
        ? { c0: cross2(sub2(p, origin), r) / denominator, c1: -cross2(along, r) / denominator }
        : null,
    });
  }
  hits.sort((x, y) => x.s - y.s);
  const probe: Vec2 = [p0[0] + epsilon * m[0], p0[1] + epsilon * m[1]];
  let inside = pointInPolygon(probe, polygon) && !holes.some((hole) => pointInPolygon(probe, hole));
  let sIn = 0, keyIn = "0";
  let linearIn: LinearInT | null = { c0: 0, c1: 0 };
  const intervals: RayInterval[] = [];
  for (const hit of hits) {
    if (inside) intervals.push({ sIn, sOut: hit.s, keyIn, keyOut: hit.key, linearIn, linearOut: hit.linear });
    else {
      sIn = hit.s;
      keyIn = hit.key;
      linearIn = hit.linear;
    }
    inside = !inside;
  }
  return intervals;
}

const combine = (target: LinearInT | null, add: LinearInT | null, sign: 1 | -1): LinearInT | null =>
  target && add ? { c0: target.c0 + sign * add.c0, c1: target.c1 + sign * add.c1 } : null;

function twoWayWidths(
  receivers: readonly PanelBeam[], geometry: OpenFem3DLoadPanelGeometry,
): OpenFem3DLoadPanelPiece[][] {
  const polygon = geometry.polygon;
  const size = geometry.sizeM;
  const tolerance = OPEN_FEM_3D_LOAD_PANEL_TOLERANCE_M;
  const epsilon = 1e-9 * size;
  const valueTolerance = 1e-9 * size;
  const spacing = size / 32;
  return receivers.map((beam, index) => {
    // Collineair overlappende staven: de laagste id krijgt het gedeelde stuk.
    const others = receivers.filter((other, otherIndex) => {
      if (otherIndex === index) return false;
      const parallel = Math.abs(cross2(beam.direction, other.direction)) <= 1e-9;
      if (!parallel) return true;
      const offset = Math.abs(cross2(sub2(other.a, beam.a), beam.direction));
      if (offset > tolerance * 1e-3) return true;
      const t0 = dot2(sub2(other.a, beam.a), beam.direction), t1 = dot2(sub2(other.b, beam.a), beam.direction);
      const overlap = Math.min(beam.length2, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1));
      return overlap <= tolerance || other.beam.id < beam.beam.id;
    });
    const e = beam.direction;
    const stations = [0, beam.length2];
    for (const point of [...polygon, ...geometry.holePolygons.flat(), ...others.flatMap((other) => [other.a, other.b])]) {
      const t = dot2(sub2(point, beam.a), e);
      if (t > 0 && t < beam.length2) stations.push(t);
    }
    stations.sort((x, y) => x - y);
    const unique: number[] = [];
    for (const t of stations) if (unique.length === 0 || t - unique[unique.length - 1] > 1e-9 * size) unique.push(t);
    if (unique[unique.length - 1] < beam.length2) unique[unique.length - 1] = beam.length2;

    const pieces: OpenFem3DLoadPanelPiece[] = [];
    for (const side of [1, -1] as const) {
      const m: Vec2 = [-e[1] * side, e[0] * side];
      const evaluate = (t: number): RaySample => {
        const p0: Vec2 = [beam.a[0] + t * e[0], beam.a[1] + t * e[1]];
        const intervals = rayIntervals(p0, m, polygon, epsilon, beam.a, e, geometry.holePolygons);
        if (intervals.length === 0) return { t, w: 0, key: "", linear: { c0: 0, c1: 0 } };
        let limit = Infinity, limitKey = "inf";
        let limitLinear: LinearInT | null = null;
        for (let otherIndex = 0; otherIndex < others.length; otherIndex += 1) {
          const hit = crossing(p0, m, others[otherIndex], `j${otherIndex}`, beam.a, e, tolerance);
          if (hit && hit.s < limit) {
            limit = hit.s;
            limitKey = hit.key;
            limitLinear = hit.linear;
          }
        }
        let w = 0;
        let linear: LinearInT | null = { c0: 0, c1: 0 };
        const parts: string[] = [];
        for (const interval of intervals) {
          if (limit <= interval.sIn) { parts.push("z"); continue; }
          if (limit >= interval.sOut) {
            w += interval.sOut - interval.sIn;
            parts.push(`f${interval.keyIn}${interval.keyOut}`);
            linear = combine(combine(linear, interval.linearOut, 1), interval.linearIn, -1);
          } else {
            w += limit - interval.sIn;
            parts.push(`p${interval.keyIn}${limitKey}`);
            linear = combine(combine(linear, limitLinear, 1), interval.linearIn, -1);
          }
        }
        return { t, w, key: parts.join("|"), linear };
      };
      const valueOf = (sample: RaySample, t: number) => sample.linear ? sample.linear.c0 + sample.linear.c1 * t : sample.w;
      for (let station = 0; station + 1 < unique.length; station += 1) {
        const tA = unique[station], tB = unique[station + 1];
        const span = tB - tA;
        if (span <= 1e-9 * size) continue;
        const offset = span * 1e-7;
        const count = Math.max(1, Math.min(64, Math.ceil(span / spacing)));
        const samples: RaySample[] = [];
        for (let k = 0; k <= count; k += 1) {
          const t = k === 0 ? tA + offset : k === count ? tB - offset : tA + span * k / count;
          samples.push(evaluate(t));
        }
        const vertices: { t: number; w: number }[] = [{ t: tA, w: valueOf(samples[0], tA) }];
        const refine = (p: RaySample, q: RaySample, depth: number) => {
          if (p.key === q.key && p.linear) { vertices.push({ t: q.t, w: valueOf(p, q.t) }); return; }
          if (depth > 40 || q.t - p.t <= 1e-12 * size) { vertices.push({ t: q.t, w: q.w }); return; }
          // Twee sleutels die dezelfde rechte beschrijven (symmetrie): gewoon lineair.
          if (p.linear && q.linear && Math.abs(p.linear.c1 - q.linear.c1) <= 1e-14
            && Math.abs(p.linear.c0 - q.linear.c0) <= valueTolerance) {
            vertices.push({ t: q.t, w: valueOf(p, q.t) });
            return;
          }
          if (p.linear && q.linear && Math.abs(p.linear.c1 - q.linear.c1) > 1e-14) {
            const tStar = (q.linear.c0 - p.linear.c0) / (p.linear.c1 - q.linear.c1);
            const tiny = 1e-12 * size;
            // Een monster precies op het knikpunt (symmetrie): de ene rechte
            // geldt dan op het hele deel. Controleer dat in het midden.
            if (Math.abs(tStar - p.t) <= tiny || Math.abs(tStar - q.t) <= tiny) {
              const governing = Math.abs(tStar - p.t) <= tiny ? q : p;
              const check = evaluate((p.t + q.t) / 2);
              if (Math.abs(check.w - valueOf(governing, check.t)) <= valueTolerance) {
                vertices.push({ t: q.t, w: valueOf(governing, q.t) });
                return;
              }
            }
            if (tStar > p.t && tStar < q.t) {
              const middle = evaluate(tStar);
              const fromP = valueOf(p, tStar), fromQ = valueOf(q, tStar);
              if (Math.abs(middle.w - fromP) <= valueTolerance && Math.abs(middle.w - fromQ) <= valueTolerance) {
                vertices.push({ t: tStar, w: (fromP + fromQ) / 2 });
                vertices.push({ t: q.t, w: valueOf(q, q.t) });
                return;
              }
              refine(p, middle, depth + 1);
              refine(middle, q, depth + 1);
              return;
            }
          }
          const middle = evaluate((p.t + q.t) / 2);
          if (!p.linear || !q.linear || !middle.linear) {
            if (depth >= 3 && Math.abs(middle.w - (p.w + q.w) / 2) <= valueTolerance) {
              vertices.push({ t: q.t, w: q.w });
              return;
            }
            if (depth >= 16) {
              vertices.push({ t: middle.t, w: middle.w }, { t: q.t, w: q.w });
              return;
            }
          }
          refine(p, middle, depth + 1);
          refine(middle, q, depth + 1);
        };
        for (let k = 0; k + 1 < samples.length; k += 1) refine(samples[k], samples[k + 1], 0);
        const last = samples[samples.length - 1];
        vertices[vertices.length - 1] = { t: tB, w: valueOf(last, tB) };
        for (let k = 0; k + 1 < vertices.length; k += 1) {
          const from = vertices[k], to = vertices[k + 1];
          if (to.t - from.t <= 0) continue;
          pieces.push({
            startPositionM: from.t * beam.length3 / beam.length2,
            endPositionM: to.t * beam.length3 / beam.length2,
            widthStartM: Math.max(0, from.w) * beam.length2 / beam.length3,
            widthEndM: Math.max(0, to.w) * beam.length2 / beam.length3,
          });
        }
      }
    }
    return sumPieces(pieces, beam.length3);
  });
}

/** 8-punts Gauss-Legendre op [−1, 1]. */
const GAUSS_POINTS = [
  [-0.9602898564975363, 0.1012285362903763], [-0.7966664774136267, 0.2223810344533745],
  [-0.5255324099163290, 0.3137066458778873], [-0.1834346424956498, 0.3626837833783620],
  [0.1834346424956498, 0.3626837833783620], [0.5255324099163290, 0.3137066458778873],
  [0.7966664774136267, 0.2223810344533745], [0.9602898564975363, 0.1012285362903763],
] as const;

/**
 * Het oppervlak rond een staafeinde dat dichter bij dat eindpunt ligt dan bij
 * enige ligger: bij een vrij staafeinde in het vlak of een inspringende hoek.
 * Dat deel gaat als knooplast naar de eindknoop.
 */
function endCapAreas(receivers: readonly PanelBeam[], geometry: OpenFem3DLoadPanelGeometry): Map<number, number> {
  const tolerance = OPEN_FEM_3D_LOAD_PANEL_TOLERANCE_M;
  const epsilon = 1e-9 * geometry.sizeM;
  const ends = new Map<number, Vec2>();
  for (const receiver of receivers) {
    ends.set(receiver.beam.startNodeId, receiver.a);
    ends.set(receiver.beam.endNodeId, receiver.b);
  }
  const areas = new Map<number, number>();
  for (const [nodeId, point] of ends) {
    const incident = receivers.filter((receiver) =>
      norm2(sub2(receiver.a, point)) <= tolerance || norm2(sub2(receiver.b, point)) <= tolerance);
    const directions = incident.map((receiver) =>
      norm2(sub2(receiver.a, point)) <= tolerance ? receiver.direction : [-receiver.direction[0], -receiver.direction[1]] as Vec2);
    const others = receivers.filter((receiver) => !incident.includes(receiver));
    // Een staafeinde op een doorgaande ligger (T-aansluiting) heeft geen eigen gebied.
    if (others.some((other) => pointSegmentDistance2(point, other.a, other.b) <= 1e-12 * Math.max(1, geometry.sizeM))) continue;
    const allowed = (phi: number) => directions.every((d) => Math.cos(phi) * d[0] + Math.sin(phi) * d[1] <= 1e-12);
    const angles = new Set<number>([0, 2 * Math.PI]);
    const wrap = (angle: number) => ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    for (const d of directions) {
      const theta = Math.atan2(d[1], d[0]);
      angles.add(wrap(theta + Math.PI / 2));
      angles.add(wrap(theta - Math.PI / 2));
    }
    for (const target of [...geometry.polygon, ...geometry.holePolygons.flat(), ...others.flatMap((other) => [other.a, other.b])]) {
      if (norm2(sub2(target, point)) > tolerance) angles.add(wrap(Math.atan2(target[1] - point[1], target[0] - point[0])));
    }
    const sorted = [...angles].sort((a, b) => a - b);
    const integrand = (phi: number) => {
      const m: Vec2 = [Math.cos(phi), Math.sin(phi)];
      const intervals = rayIntervals(point, m, geometry.polygon, epsilon, undefined, undefined, geometry.holePolygons);
      if (intervals.length === 0) return 0;
      let limit = Infinity;
      for (let index = 0; index < others.length; index += 1) {
        const hit = crossing(point, m, others[index], `c${index}`, point, [0, 0], tolerance);
        if (hit && hit.s < limit) limit = hit.s;
      }
      let area = 0;
      for (const interval of intervals) {
        if (limit <= interval.sIn) break;
        const out = Math.min(interval.sOut, limit);
        area += (out * out - interval.sIn * interval.sIn) / 2;
      }
      return area;
    };
    let total = 0;
    for (let index = 0; index + 1 < sorted.length; index += 1) {
      const from = sorted[index], to = sorted[index + 1];
      if (to - from <= 1e-12 || !allowed((from + to) / 2)) continue;
      const parts = Math.max(1, Math.ceil((to - from) / (Math.PI / 72)));
      const step = (to - from) / parts;
      for (let part = 0; part < parts; part += 1) {
        const centre = from + (part + 0.5) * step;
        for (const [x, weight] of GAUSS_POINTS) total += weight * step / 2 * integrand(centre + x * step / 2);
      }
    }
    if (total > 1e-12 * geometry.areaM2) areas.set(nodeId, total);
  }
  return areas;
}

// ── Afdracht van één vlak ───────────────────────────────────────────────────

export interface OpenFem3DLoadPanelBeamLoad {
  beamId: number;
  pieces: OpenFem3DLoadPanelPiece[];
  /** Afgedragen vlakoppervlak (m²). */
  areaM2: number;
}

export interface OpenFem3DLoadPanelPointShare {
  /** Knooplast (eindgebied rond een staafeinde). */
  nodeId?: number;
  /** Puntlast op een staaf (strook zonder ligger bij éénrichting). */
  beamId?: number;
  positionM?: number;
  areaM2: number;
}

export interface OpenFem3DLoadPanelResult {
  panel: OpenFem3DLoadPanel;
  caseId: number;
  geometry: OpenFem3DLoadPanelGeometry;
  /** Kracht per m² werkelijk vlak, globaal (kN/m²). */
  forcePerAreaKnPerM2: Vec3;
  /** Resultante van het hele vlak, globaal (kN). */
  totalForceKn: Vec3;
  beamLoads: OpenFem3DLoadPanelBeamLoad[];
  pointShares: OpenFem3DLoadPanelPointShare[];
  /** Alle staven die geheel in het vlak liggen. */
  inPanelBeamIds: number[];
  receiverBeamIds: number[];
  excludedBeamIds: number[];
  /** Éénrichting: evenwijdig aan de overspanning (geen last). */
  parallelBeamIds: number[];
  /** Éénrichting: schuin op de overspanning, bijvoorbeeld windverbanden (geen last). */
  skewBeamIds: number[];
  /** In het vlak maar met een eindknoop erbuiten (geen last). */
  partialBeamIds: number[];
  /** Randen zonder (dragende) ligger. */
  unsupportedEdges: { startNodeId: number; endNodeId: number }[];
  /** Σ afgedragen oppervlak; hoort gelijk te zijn aan geometry.areaM2. */
  assignedAreaM2: number;
  /** Waarschuwingen: de last gaat anders dan de gebruiker mogelijk verwacht. */
  warnings: string[];
  /** Toelichting zonder actie: wat bewust geen last krijgt en waarom. */
  notes: string[];
}

const formatArea = (value: number) => value.toLocaleString("nl-NL", { maximumFractionDigits: 3 });

export function analyseOpenFem3DLoadPanel(model: OpenFem3DModel, panel: OpenFem3DLoadPanel): OpenFem3DLoadPanelResult {
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const label = `3D-belastingvlak ${panel.id}`;
  const geometry = openFem3DLoadPanelGeometry(model, panel, byId);
  const forcePerArea = openFem3DLoadPanelForcePerArea(panel, geometry);
  const sourcePanel = panel.generated?.source === "envelope3d"
    ? (model.envelopePanels ?? []).find((item) => item.id === panel.generated!.panelId) : undefined;
  if (panel.generated && !sourcePanel) throw new Error(`${label} verwijst naar een ontbrekend schilpaneel.`);
  const supportGeometry = sourcePanel ? openFem3DLoadPanelGeometry(model, {
    id: sourcePanel.id, nodeIds: sourcePanel.nodeIds, distribution: sourcePanel.distribution,
    spanDirection: sourcePanel.spanDirection,
  }, byId) : geometry;
  const { inPanel, partial } = panelBeams(model, geometry, byId, supportGeometry);
  const excluded = new Set(panel.excludedBeamIds ?? []);
  const candidates = inPanel.filter((item) => !excluded.has(item.beam.id));
  const warnings: string[] = [];
  const notes: string[] = [];
  const parallel: PanelBeam[] = [], skew: PanelBeam[] = [];
  let receivers = candidates;
  if (panel.distribution === "oneWay") {
    const sine = Math.sin(OPEN_FEM_3D_ONE_WAY_ANGLE_TOLERANCE_DEG * Math.PI / 180);
    receivers = candidates.filter((item) => Math.abs(item.direction[0]) <= sine);
    for (const item of candidates) {
      if (receivers.includes(item)) continue;
      (Math.abs(item.direction[1]) <= sine ? parallel : skew).push(item);
    }
    if (skew.length > 0) {
      notes.push(
        `Staaf ${skew.map((item) => item.beam.id).join(", ")} ligt schuin op de overspanningsrichting ` +
        `en krijgt bij afdracht in één richting geen last (zoals een windverband).`,
      );
    }
  }
  if (receivers.length === 0) {
    throw new Error(panel.distribution === "oneWay"
      ? `${label} heeft geen ligger dwars op de overspanningsrichting (hoogstens ` +
        `${OPEN_FEM_3D_ONE_WAY_ANGLE_TOLERANCE_DEG}° afwijking). Kies een andere overspanningsrichting of ` +
        "afdracht in twee richtingen."
      : `${label} heeft geen ligger in het vlak; de last kan nergens heen. Teken de liggers ` +
        "(met beide eindknopen op de rand of binnen het vlak) of verwijder het vlak.");
  }
  if (partial.length > 0) {
    warnings.push(
      `Staaf ${partial.join(", ")} ligt deels in ${label} maar een eindknoop valt buiten het vlak; ` +
      "die staaf krijgt geen last. Knip de staaf op de rand van het vlak.",
    );
  }
  if (excluded.size > 0) {
    const listed = inPanel.filter((item) => excluded.has(item.beam.id)).map((item) => item.beam.id);
    if (listed.length > 0) notes.push(`Staaf ${listed.join(", ")} is uitgesloten en krijgt geen last.`);
  }

  const corner = geometry.cornerNodeIds;
  const edgeNodes = (index: number) => ({ startNodeId: corner[index], endNodeId: corner[(index + 1) % corner.length] });
  const unsupportedEdges: { startNodeId: number; endNodeId: number }[] = [];
  const pointShares: OpenFem3DLoadPanelPointShare[] = [];
  let beamPieces: OpenFem3DLoadPanelPiece[][];
  if (panel.distribution === "oneWay") {
    const swept = distributeOneWay(geometry, receivers);
    beamPieces = swept.beamPieces;
    for (const [edge, area] of swept.overhangByEdge) {
      if (area <= 1e-9 * geometry.areaM2) continue;
      if (edge >= corner.length) continue; // openings zijn bewust vrij van vlaklast
      const nodes = edgeNodes(edge);
      unsupportedEdges.push(nodes);
      warnings.push(
        `Rand ${nodes.startNodeId}–${nodes.endNodeId} van ${label} heeft geen ligger dwars op de ` +
        `overspanning; ${formatArea(area)} m² gaat als overstek naar de dichtstbijzijnde ligger.`,
      );
    }
    // Een strook zonder enige ligger dwars op de overspanning: als puntlast
    // naar de dichtstbijzijnde ligger in het vlak, met een duidelijke melding.
    const fallbacks = candidates.length > 0 ? candidates : receivers;
    for (const strip of swept.uncovered) {
      let best: { item: PanelBeam; distance: number; t: number } | null = null;
      for (const item of fallbacks) {
        const ab = sub2(item.b, item.a);
        const t = Math.max(0, Math.min(1, dot2(sub2(strip.centroid, item.a), ab) / dot2(ab, ab)));
        const distance = norm2(sub2(strip.centroid, [item.a[0] + t * ab[0], item.a[1] + t * ab[1]]));
        if (!best || distance < best.distance) best = { item, distance, t };
      }
      if (!best) continue;
      const positionM = best.t * best.item.length3;
      const existing = pointShares.find((share) => share.beamId === best!.item.beam.id
        && Math.abs((share.positionM ?? 0) - positionM) <= 1e-9);
      if (existing) existing.areaM2 += strip.areaM2;
      else pointShares.push({ beamId: best.item.beam.id, positionM, areaM2: strip.areaM2 });
    }
    for (const share of pointShares) {
      warnings.push(
        `${formatArea(share.areaM2)} m² van ${label} ligt niet tussen liggers dwars op de ` +
        `overspanningsrichting en gaat als puntlast naar staaf ${share.beamId}.`,
      );
    }
  } else {
    beamPieces = twoWayWidths(receivers, geometry);
    for (const [nodeId, areaM2] of endCapAreas(receivers, geometry)) {
      pointShares.push({ nodeId, areaM2 });
      notes.push(`${formatArea(areaM2)} m² rond het staafeinde bij knoop ${nodeId} gaat als knooplast naar die knoop.`);
    }
    if (!panel.generated) geometry.polygon.forEach((p, index) => {
      const q = geometry.polygon[(index + 1) % geometry.polygon.length];
      const edge = sub2(q, p);
      const lengthM = norm2(edge);
      const unitEdge: Vec2 = [edge[0] / lengthM, edge[1] / lengthM];
      const covered: [number, number][] = [];
      for (const item of receivers) {
        const offsets = [item.a, item.b].map((point) => Math.abs(cross2(sub2(point, p), unitEdge)));
        if (offsets.some((offset) => offset > OPEN_FEM_3D_LOAD_PANEL_TOLERANCE_M)) continue;
        const t0 = dot2(sub2(item.a, p), unitEdge), t1 = dot2(sub2(item.b, p), unitEdge);
        const from = Math.max(0, Math.min(t0, t1)), to = Math.min(lengthM, Math.max(t0, t1));
        if (to > from) covered.push([from, to]);
      }
      covered.sort((x, y) => x[0] - y[0]);
      let reach = 0, gap = 0;
      for (const [from, to] of covered) {
        if (from > reach) gap += from - reach;
        reach = Math.max(reach, to);
      }
      gap += Math.max(0, lengthM - reach);
      if (gap > OPEN_FEM_3D_LOAD_PANEL_TOLERANCE_M) {
        const nodes = edgeNodes(index);
        unsupportedEdges.push(nodes);
        warnings.push(
          `Rand ${nodes.startNodeId}–${nodes.endNodeId} van ${label} heeft ` +
          `${gap < lengthM - OPEN_FEM_3D_LOAD_PANEL_TOLERANCE_M ? "deels " : ""}geen ligger; de last langs ` +
          "die rand gaat naar de dichtstbijzijnde ligger.",
        );
      }
    });
  }

  const beamLoads = receivers.flatMap((item, index) => {
    const pieces = beamPieces[index];
    const areaM2 = pieces.reduce((sum, piece) => sum + pieceArea(piece), 0);
    return pieces.length > 0 && areaM2 > 0 ? [{ beamId: item.beam.id, pieces, areaM2 }] : [];
  });
  // Een zwaartekrachtlast op een hellende ligger heeft een component langs de
  // staafas; het kerncontract kent geen axiale verdeelde last (zie de omzetting).
  const forceMagnitude = norm3(forcePerArea);
  const axialBeamIds = beamLoads.map((item) => item.beamId).filter((beamId) => {
    const beam = model.beams.find((candidate) => candidate.id === beamId)!;
    const axis = unit3(sub3(vec3(byId.get(beam.endNodeId)!), vec3(byId.get(beam.startNodeId)!)));
    return Math.abs(dot3(forcePerArea, axis)) > 1e-9 * forceMagnitude;
  });
  if (axialBeamIds.length > 0) {
    notes.push(
      `Het deel van de last langs de staafas van staaf ${axialBeamIds.join(", ")} gaat als gelijkwaardige ` +
      "knooplasten naar de staafeinden.",
    );
  }
  const assignedAreaM2 = beamLoads.reduce((sum, item) => sum + item.areaM2, 0)
    + pointShares.reduce((sum, item) => sum + item.areaM2, 0);
  const mismatch = Math.abs(assignedAreaM2 - geometry.areaM2) / geometry.areaM2;
  if (mismatch > 1e-2) {
    throw new Error(
      `${label}: de afdracht sluit niet (${formatArea(assignedAreaM2)} m² afgedragen van ` +
      `${formatArea(geometry.areaM2)} m²). Vereenvoudig de vorm of verdeel het vlak.`,
    );
  }
  if (mismatch > 1e-6) {
    warnings.push(
      `${label}: afgedragen oppervlak ${formatArea(assignedAreaM2)} m² wijkt ${(mismatch * 100).toFixed(4)} % af ` +
      `van het vlakoppervlak ${formatArea(geometry.areaM2)} m².`,
    );
  }
  return {
    panel,
    caseId: openFem3DLoadCaseId(panel),
    geometry,
    forcePerAreaKnPerM2: forcePerArea,
    totalForceKn: scale3(forcePerArea, geometry.areaM2),
    beamLoads,
    pointShares,
    inPanelBeamIds: inPanel.map((item) => item.beam.id),
    receiverBeamIds: receivers.map((item) => item.beam.id),
    excludedBeamIds: inPanel.filter((item) => excluded.has(item.beam.id)).map((item) => item.beam.id),
    parallelBeamIds: parallel.map((item) => item.beam.id),
    skewBeamIds: skew.map((item) => item.beam.id),
    partialBeamIds: partial,
    unsupportedEdges,
    assignedAreaM2,
    warnings,
    notes,
  };
}

export type OpenFem3DLoadPanelAnalysis =
  | { panel: OpenFem3DLoadPanel; result: OpenFem3DLoadPanelResult; error?: undefined }
  | { panel: OpenFem3DLoadPanel; result?: undefined; error: string };

const analysisCache = new WeakMap<OpenFem3DModel, OpenFem3DLoadPanelAnalysis[]>();

/** Afdracht van alle vlakken; een fout per vlak in plaats van een worp. */
export function analyseOpenFem3DLoadPanels(model: OpenFem3DModel): OpenFem3DLoadPanelAnalysis[] {
  const cached = analysisCache.get(model);
  if (cached) return cached;
  const analyses = (model.loadPanels ?? []).map((panel): OpenFem3DLoadPanelAnalysis => {
    try {
      return { panel, result: analyseOpenFem3DLoadPanel(model, panel) };
    } catch (cause) {
      return { panel, error: cause instanceof Error ? cause.message : String(cause) };
    }
  });
  analysisCache.set(model, analyses);
  return analyses;
}

// ── Omzetting naar staaf- en knooplasten ────────────────────────────────────

export interface OpenFem3DLoadPanelConversion {
  /** Rekenmodel: afgeleide lasten toegevoegd, `loadPanels` weggehaald. */
  model: OpenFem3DModel;
  results: OpenFem3DLoadPanelResult[];
  /** Waarschuwingen per belastinggeval (voor de meldingen bij een resultaat). */
  warnings: { caseId: number; message: string }[];
}

const conversionCache = new WeakMap<OpenFem3DModel, OpenFem3DLoadPanelConversion>();

/**
 * Zet elk belastingvlak om in gewone lasten in zijn eigen belastinggeval:
 *  - een trapeziumvormige staaflast per lineair stuk (lokale y/z);
 *  - de component langs de staafas als gelijkwaardige knooplasten op de
 *    staafeinden (net als bij het eigen gewicht: het kerncontract kent geen
 *    axiale verdeelde last);
 *  - eindgebieden als knooplast en stroken zonder ligger als staafpuntlast.
 * Een vlak dat niet kan worden afgedragen blokkeert het rekenen met zijn
 * melding: een last mag nooit stil wegvallen.
 */
export function withOpenFem3DLoadPanels(model: OpenFem3DModel): OpenFem3DLoadPanelConversion {
  const cached = conversionCache.get(model);
  if (cached) return cached;
  const { loadPanels, ...rest } = model;
  if (!loadPanels || loadPanels.length === 0) {
    const empty = { model: rest, results: [], warnings: [] };
    conversionCache.set(model, empty);
    return empty;
  }
  const analyses = analyseOpenFem3DLoadPanels(model);
  const failed = analyses.find((analysis) => analysis.error !== undefined);
  if (failed?.error) throw new Error(failed.error);
  const results = analyses.map((analysis) => analysis.result!);
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const beamById = new Map(model.beams.map((beam) => [beam.id, beam]));
  const memberLoads: OpenFem3DMemberLoad[] = [...(model.memberLoads ?? [])];
  const memberPointLoads: OpenFem3DMemberPointLoad[] = [...(model.memberPointLoads ?? [])];
  const loads: OpenFem3DNodalLoad[] = [...(model.loads ?? [])];
  const nextId = (items: readonly { id: number }[]) => items.reduce((maximum, item) => Math.max(maximum, item.id), 0) + 1;
  let nextMemberLoadId = nextId(memberLoads);
  let nextPointLoadId = nextId(memberPointLoads);
  let nextLoadId = nextId(loads);
  const warnings: { caseId: number; message: string }[] = [];
  const small = 1e-12;
  for (const result of results) {
    const caseId = result.caseId;
    const f = result.forcePerAreaKnPerM2;
    const nodal = new Map<number, Vec3>();
    const addNodal = (nodeId: number, force: Vec3) => nodal.set(nodeId, add3(nodal.get(nodeId) ?? [0, 0, 0], force));
    for (const beamLoad of result.beamLoads) {
      const beam = beamById.get(beamLoad.beamId)!;
      const start = byId.get(beam.startNodeId)!, end = byId.get(beam.endNodeId)!;
      const lengthM = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
      const { ex, ey, ez } = openFem3DMemberAxes(start, end, beam.rollAngleRad ?? 0);
      const fy = dot3(f, ey), fz = dot3(f, ez), fx = dot3(f, ex);
      for (const piece of beamLoad.pieces) {
        const values = {
          qyStart: fy * piece.widthStartM, qyEnd: fy * piece.widthEndM,
          qzStart: fz * piece.widthStartM, qzEnd: fz * piece.widthEndM,
        };
        if (Object.values(values).some((value) => Math.abs(value) > small)) {
          memberLoads.push({
            id: nextMemberLoadId++, beamId: beam.id, caseId, ...values,
            startPositionM: piece.startPositionM, endPositionM: piece.endPositionM,
          });
        }
        // Axiaal deel qx(s): arbeidsgelijkwaardige knoopkrachten van een
        // lineair verlopende last, F_eind = (1/L)∫q·s ds, F_begin = ∫q ds − F_eind.
        const q1 = fx * piece.widthStartM, q2 = fx * piece.widthEndM;
        if (Math.abs(q1) + Math.abs(q2) > small) {
          const a = piece.startPositionM, l = piece.endPositionM - piece.startPositionM;
          const total = (q1 + q2) / 2 * l;
          const moment = a * total + l * l * (q1 / 6 + q2 / 3);
          const endForce = moment / lengthM;
          addNodal(beam.startNodeId, scale3(ex as Vec3, total - endForce));
          addNodal(beam.endNodeId, scale3(ex as Vec3, endForce));
        }
      }
    }
    for (const share of result.pointShares) {
      const force = scale3(f, share.areaM2);
      if (share.nodeId !== undefined) {
        addNodal(share.nodeId, force);
        continue;
      }
      const beam = beamById.get(share.beamId!)!;
      const start = byId.get(beam.startNodeId)!, end = byId.get(beam.endNodeId)!;
      const lengthM = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
      const { ex, ey, ez } = openFem3DMemberAxes(start, end, beam.rollAngleRad ?? 0);
      const py = dot3(force, ey), pz = dot3(force, ez), px = dot3(force, ex);
      const positionM = Math.max(0, Math.min(lengthM, share.positionM ?? 0));
      if (Math.abs(py) + Math.abs(pz) > small) {
        memberPointLoads.push({ id: nextPointLoadId++, beamId: beam.id, caseId, py, pz, positionM });
      }
      if (Math.abs(px) > small) {
        addNodal(beam.startNodeId, scale3(ex as Vec3, px * (1 - positionM / lengthM)));
        addNodal(beam.endNodeId, scale3(ex as Vec3, px * positionM / lengthM));
      }
    }
    for (const [nodeId, force] of nodal) {
      if (norm3(force) <= small) continue;
      loads.push({ id: nextLoadId++, nodeId, caseId, fx: force[0], fy: force[1], fz: force[2], mx: 0, my: 0, mz: 0 });
    }
    for (const message of result.warnings) warnings.push({ caseId, message });
  }
  // Zonehoeken van de gebouwschil zijn alleen voor de vlakafdracht nodig.
  // Zonder constructieve verbinding zouden ze in de Rust-kern als vrije
  // knopen een mechanisme veroorzaken. Behoud ze wel als een gebruiker er
  // inmiddels een staaf, plaat, oplegging of ander object aan heeft gekoppeld.
  const helperIds = new Set(rest.generatedNodeIds ?? []);
  const structuralIds = new Set<number>();
  for (const beam of rest.beams) { structuralIds.add(beam.startNodeId); structuralIds.add(beam.endNodeId); }
  for (const support of rest.supports ?? []) structuralIds.add(support.nodeId);
  for (const load of loads) structuralIds.add(load.nodeId);
  for (const plate of rest.plates ?? []) {
    plate.nodeIds.forEach((id) => structuralIds.add(id));
    plate.openings?.forEach((opening) => opening.nodeIds.forEach((id) => structuralIds.add(id)));
  }
  for (const diaphragm of rest.diaphragms ?? []) diaphragm.nodeIds.forEach((id) => structuralIds.add(id));
  for (const panel of rest.envelopePanels ?? []) {
    panel.nodeIds.forEach((id) => structuralIds.add(id));
    panel.openings?.forEach((opening) => opening.nodeIds.forEach((id) => structuralIds.add(id)));
  }
  const nodes = helperIds.size
    ? rest.nodes.filter((node) => !helperIds.has(node.id) || structuralIds.has(node.id)) : rest.nodes;
  const conversion = { model: { ...rest, nodes, loads, memberLoads, memberPointLoads }, results, warnings };
  conversionCache.set(model, conversion);
  return conversion;
}

// ── Bewerken ────────────────────────────────────────────────────────────────

export interface OpenFem3DLoadPanelOptions {
  caseId?: number;
  q?: number;
  direction?: OpenFem3DLoadPanelDirection;
  distribution?: OpenFem3DLoadPanelDistribution;
  spanDirection?: OpenFem3DVector;
  excludedBeamIds?: number[];
  openings?: { id: number; nodeIds: number[] }[];
}

function nextPanelId(model: OpenFem3DModel): number {
  return (model.loadPanels ?? []).reduce((maximum, panel) => Math.max(maximum, panel.id), 0) + 1;
}

/** Standaardoverspanning: globaal X, of Y als X loodrecht op het vlak staat. */
export function defaultOpenFem3DLoadPanelSpan(model: OpenFem3DModel, nodeIds: number[]): OpenFem3DVector {
  try {
    const geometry = openFem3DLoadPanelGeometry(model, { id: 0, nodeIds, distribution: "twoWay" });
    const n = geometry.normal;
    const inPlaneX = Math.hypot(1 - n[0] * n[0], -n[0] * n[1], -n[0] * n[2]);
    return inPlaneX > 0.5 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  } catch {
    return { x: 1, y: 0, z: 0 };
  }
}

/**
 * Nieuw belastingvlak over bestaande knopen. Anders dan bij het openen van
 * een bestand wordt hier ook de meetkunde gekeurd: een vlak dat niet vlak,
 * zelfsnijdend of loodrecht op zijn lastrichting is, wordt niet getekend.
 */
export function addOpenFem3DLoadPanel(
  model: OpenFem3DModel, nodeIds: number[], options: OpenFem3DLoadPanelOptions = {},
): OpenFem3DModel {
  const distribution = options.distribution ?? "twoWay";
  const panel: OpenFem3DLoadPanel = {
    id: nextPanelId(model),
    nodeIds: [...nodeIds],
    ...(options.caseId !== undefined ? { caseId: options.caseId } : {}),
    q: options.q ?? OPEN_FEM_3D_LOAD_PANEL_DEFAULT_Q,
    direction: options.direction ?? "gravity",
    distribution,
    ...(options.spanDirection || distribution === "oneWay"
      ? { spanDirection: options.spanDirection ?? defaultOpenFem3DLoadPanelSpan(model, nodeIds) }
      : {}),
    ...(options.excludedBeamIds?.length ? { excludedBeamIds: [...options.excludedBeamIds] } : {}),
    ...(options.openings?.length ? { openings: options.openings.map((opening) => ({ id: opening.id, nodeIds: [...opening.nodeIds] })) } : {}),
  };
  const parsed = parseOpenFem3DModel({ ...model, loadPanels: [...(model.loadPanels ?? []), panel] });
  const added = parsed.loadPanels![parsed.loadPanels!.length - 1];
  const geometry = openFem3DLoadPanelGeometry(parsed, added);
  openFem3DLoadPanelForcePerArea(added, geometry);
  return { ...model, loadPanels: [...(model.loadPanels ?? []), added] };
}

export type OpenFem3DLoadPanelPatch = Partial<Pick<OpenFem3DLoadPanel,
  "q" | "direction" | "distribution" | "spanDirection" | "excludedBeamIds" | "caseId" | "openings">>;

/** Wijzig één belastingvlak; de structuur wordt gekeurd, de meetkunde niet (zie parse). */
export function updateOpenFem3DLoadPanel(
  model: OpenFem3DModel, panelId: number, patch: OpenFem3DLoadPanelPatch,
): OpenFem3DModel {
  const panels = model.loadPanels ?? [];
  const old = panels.find((panel) => panel.id === panelId);
  if (!old) throw new Error(`3D-belastingvlak ${panelId} bestaat niet.`);
  const next: OpenFem3DLoadPanel = { ...old, ...patch };
  if (next.distribution === "oneWay" && !next.spanDirection) {
    next.spanDirection = defaultOpenFem3DLoadPanelSpan(model, next.nodeIds);
  }
  if (patch.excludedBeamIds !== undefined && patch.excludedBeamIds.length === 0) delete next.excludedBeamIds;
  const parsed = parseOpenFem3DModel({ ...model, loadPanels: panels.map((panel) => panel.id === panelId ? next : panel) });
  const updated = parsed.loadPanels!.find((panel) => panel.id === panelId)!;
  return { ...model, loadPanels: panels.map((panel) => panel.id === panelId ? updated : panel) };
}

/** Kopie van een vlak (zelfde hoeken en instellingen) in een ander belastinggeval. */
export function duplicateOpenFem3DLoadPanel(
  model: OpenFem3DModel, panelId: number, caseId: number,
): { model: OpenFem3DModel; panelId: number } {
  const source = (model.loadPanels ?? []).find((panel) => panel.id === panelId);
  if (!source) throw new Error(`3D-belastingvlak ${panelId} bestaat niet.`);
  const id = nextPanelId(model);
  const copy: OpenFem3DLoadPanel = { ...source, id, caseId, nodeIds: [...source.nodeIds],
    ...(source.spanDirection ? { spanDirection: { ...source.spanDirection } } : {}),
    ...(source.excludedBeamIds ? { excludedBeamIds: [...source.excludedBeamIds] } : {}) };
  const parsed = parseOpenFem3DModel({ ...model, loadPanels: [...(model.loadPanels ?? []), copy] });
  return { model: { ...model, loadPanels: parsed.loadPanels }, panelId: id };
}

/**
 * Zet een plaat om in belastingvlakken: de plaat (met haar stijfheid)
 * verdwijnt en haar omtrek draagt voortaan alleen last af. Elke
 * oppervlaktebelasting wordt een eigen vlak in haar eigen geval, als ze exact
 * past: verticaal (→ zwaartekracht per horizontale projectie) of loodrecht op
 * de plaat. Zonder oppervlaktebelasting komt er één vlak met q = 1 kN/m² in
 * het opgegeven geval. Wat niet exact te vertalen is — openingen, bogen,
 * afgeronde hoeken of een schuine oppervlaktelast — wordt geweigerd in plaats
 * van stil benaderd.
 */
export function convertOpenFem3DPlateToLoadPanels(
  model: OpenFem3DModel, plateId: number, options: { caseId?: number } = {},
): { model: OpenFem3DModel; panelIds: number[] } {
  const plate = (model.plates ?? []).find((item) => item.id === plateId);
  if (!plate) throw new Error(`3D-plaat ${plateId} bestaat niet.`);
  const label = `3D-plaat ${plateId}`;
  if ((plate.openings?.length ?? 0) > 0) {
    throw new Error(`${label} heeft openingen; een belastingvlak kent geen openingen. Verwijder de openingen of teken het vlak in delen.`);
  }
  if (plate.boundary?.some((segment) => segment.kind === "arc")) {
    throw new Error(`${label} heeft een gebogen rand; een belastingvlak volgt alleen rechte randen tussen hoekknopen.`);
  }
  if ((plate.cornerRadiusM ?? 0) > 0) {
    throw new Error(`${label} heeft afgeronde hoeken; zet de randstraal op 0 voordat je de plaat omzet.`);
  }
  const geometry = openFem3DLoadPanelGeometry(model, { id: plateId, nodeIds: plate.nodeIds, distribution: "twoWay" });
  const n = geometry.normal;
  const surfaceLoads = (model.surfaceLoads ?? []).filter((load) => load.plateId === plateId);
  const specifications: OpenFem3DLoadPanelOptions[] = surfaceLoads.length === 0
    ? [{ caseId: options.caseId }]
    : surfaceLoads.map((load) => {
      const vector: Vec3 = [load.qx, load.qy, load.qz];
      const magnitude = norm3(vector);
      const alongNormal = dot3(vector, n);
      if (Math.abs(load.qx) <= 1e-12 * magnitude && Math.abs(load.qy) <= 1e-12 * magnitude && Math.abs(n[2]) >= 1e-6) {
        // Verticaal per m² plaat → per m² horizontale projectie.
        return { caseId: load.caseId, q: -load.qz / Math.abs(n[2]), direction: "gravity" as const };
      }
      if (Math.abs(Math.abs(alongNormal) - magnitude) <= 1e-9 * magnitude) {
        return { caseId: load.caseId, q: alongNormal, direction: "normal" as const };
      }
      throw new Error(
        `Oppervlaktebelasting ${load.id} op ${label} staat schuin op de plaat; een belastingvlak draagt alleen ` +
        "een verticale of loodrechte last af. Splits of verwijder die last eerst.",
      );
    });
  let next: OpenFem3DModel = {
    ...model,
    plates: (model.plates ?? []).filter((item) => item.id !== plateId),
    surfaceLoads: (model.surfaceLoads ?? []).filter((load) => load.plateId !== plateId),
  };
  const panelIds: number[] = [];
  for (const specification of specifications) {
    next = addOpenFem3DLoadPanel(next, plate.nodeIds, specification);
    panelIds.push(next.loadPanels![next.loadPanels!.length - 1].id);
  }
  return { model: next, panelIds };
}

/** Globale richting van knoop a naar knoop b: de overspanning uit twee klikken. */
export function openFem3DSpanFromNodes(model: OpenFem3DModel, fromNodeId: number, toNodeId: number): OpenFem3DVector {
  const from = model.nodes.find((node) => node.id === fromNodeId);
  const to = model.nodes.find((node) => node.id === toNodeId);
  if (!from || !to) throw new Error("De overspanningsrichting vraagt twee bestaande knopen.");
  const vector = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  if (Math.hypot(vector.x, vector.y, vector.z) <= OPEN_FEM_3D_LOAD_PANEL_TOLERANCE_M) {
    throw new Error("De twee knopen voor de overspanningsrichting vallen samen.");
  }
  return vector;
}

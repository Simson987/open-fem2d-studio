/**
 * Metselwerkwand (issue #97): een verticale 3D-plaat van metselwerk, met
 * openingen en lateien.
 *
 * Besluiten (DutchSailor, #97):
 *  - Rekenwijze: een orthotrope wandplaat (zie de Rust-module
 *    `open-fem-3d/src/orthotroop.rs` en docs/orthotrope-platen-en-metselwerkwand.md):
 *    E verticaal = E van het metselwerk, E horizontaal ≈ 0 en G > 0. De wand
 *    brengt de last naar de fundering, maar werkt niet als hoge ligger met de
 *    funderingsbalk samen. Windlast in het vlak gaat via afschuiving naar de
 *    fundering.
 *  - Een latei is een eigen staaf met doorsnede, toets en rapport.
 *  - De last boven een opening is per opening te kiezen: driehoek 60°
 *    (standaard) of volle hoogte.
 *
 * Het open punt: met E horizontaal ≈ 0 kan het metselwerk boven een opening
 * geen boog vormen. Het rekenmodel legt daarom ALTIJD de volle hoogte op de
 * latei. Dat is veilig voor de latei, en de penanten krijgen dezelfde totale
 * last. De keuze per opening geldt voor de lateibelasting in de lateitoets
 * (`openFem3DLintelDesign`). Daar telt de driehoek 60° alleen als het
 * metselwerk boven de latei minstens zo hoog is als die driehoek. Is het
 * lager, dan reikt de last op de wandkop binnen de driehoek en valt de toets
 * terug op de volle hoogte (met melding).
 */
import type {
  OpenFem3DModel, OpenFem3DNode, OpenFem3DPlate, OpenFem3DPlateOpening,
} from "./openFem3dModel";

/** E horizontaal = deze factor × E verticaal (≈ 0; precies 0 maakt het element singulier). */
export const OPEN_FEM_3D_MASONRY_E_X_FACTOR = 1e-6;
/** G = 0,4·E (NEN-EN 1996-1-1 §3.7.3). */
export const OPEN_FEM_3D_MASONRY_G_FACTOR = 0.4;
/** Standaard volumegewicht (kN/m³): de bovenkant van 18–20 kN/m³ voor kalkzandsteen uit #97. */
export const OPEN_FEM_3D_MASONRY_DEFAULT_UNIT_WEIGHT = 20;
/** Standaard E van het metselwerk (N/mm²); invoer, E = K_E·f_k (NEN-EN 1996-1-1 §3.7.2). */
export const OPEN_FEM_3D_MASONRY_DEFAULT_E_MPA = 5000;
/** Standaard opleglengte van een latei aan elke zijde (m). */
export const OPEN_FEM_3D_LINTEL_DEFAULT_BEARING_M = 0.1;
export const OPEN_FEM_3D_LINTEL_DEFAULT = { material: "S235", profileName: "HEA 100" } as const;

export interface OpenFem3DMasonryWall {
  /** Volumegewicht γ in kN/m³; het eigen gewicht is γ·t per m² wand. */
  unitWeightKnM3: number;
  /** E van het metselwerk in verticale richting, N/mm². */
  eMpa: number;
}

export type OpenFem3DLintelLoadSpread = "triangle60" | "fullHeight";

export interface OpenFem3DOpeningLintel {
  /** De staaf die de latei is (een gewone staaf van het model). */
  beamId: number;
  /** Opleglengte aan elke zijde van de opening, m. */
  bearingM: number;
  /** Lateibelasting in de lateitoets; het rekenmodel draagt altijd de volle hoogte. */
  loadSpread: OpenFem3DLintelLoadSpread;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function readOpenFem3DMasonryWall(value: unknown, label: string): OpenFem3DMasonryWall {
  if (!isRecord(value)) throw new Error(`${label}: ongeldige metselwerkwand.`);
  const unitWeightKnM3 = Number(value.unitWeightKnM3);
  const eMpa = Number(value.eMpa);
  if (!(Number.isFinite(unitWeightKnM3) && unitWeightKnM3 > 0 && unitWeightKnM3 <= 100)) {
    throw new Error(`${label}: het volumegewicht van het metselwerk moet tussen 0 en 100 kN/m³ liggen.`);
  }
  if (!(Number.isFinite(eMpa) && eMpa > 0)) {
    throw new Error(`${label}: de elasticiteitsmodulus van het metselwerk moet groter dan 0 zijn.`);
  }
  return { unitWeightKnM3, eMpa };
}

export function readOpenFem3DOpeningLintel(value: unknown, label: string): OpenFem3DOpeningLintel {
  if (!isRecord(value)) throw new Error(`${label}: ongeldige latei.`);
  const beamId = Number(value.beamId);
  const bearingM = Number(value.bearingM);
  if (!Number.isSafeInteger(value.beamId) || beamId <= 0) throw new Error(`${label}: de latei verwijst niet naar een geldige staaf.`);
  if (!(Number.isFinite(bearingM) && bearingM > 0)) throw new Error(`${label}: de opleglengte van de latei moet groter dan 0 zijn.`);
  const loadSpread = value.loadSpread ?? "triangle60";
  if (loadSpread !== "triangle60" && loadSpread !== "fullHeight") {
    throw new Error(`${label}: onbekende lastspreiding "${String(loadSpread)}" (triangle60 of fullHeight).`);
  }
  return { beamId, bearingM, loadSpread };
}

/** De orthotrope stijfheid van de wandplaat voor de 3D-kern (plaatassen: y omhoog). */
export function openFem3DMasonryOrthotropy(wall: OpenFem3DMasonryWall) {
  return {
    eXMpa: wall.eMpa * OPEN_FEM_3D_MASONRY_E_X_FACTOR,
    eYMpa: wall.eMpa,
    gXyMpa: OPEN_FEM_3D_MASONRY_G_FACTOR * wall.eMpa,
    nuXy: 0,
  };
}

/** Materiaalnaam van een metselwerkwand (één kernmateriaal per E en γ). */
export function openFem3DMasonryMaterialName(wall: OpenFem3DMasonryWall): string {
  return `Metselwerk E=${wall.eMpa} γ=${wall.unitWeightKnM3}`;
}

type V3 = [number, number, number];
const pointOf = (node: OpenFem3DNode): V3 => [node.x, node.y, node.z];

/** Wandassen: u horizontaal in het vlak (zoals de plaat-x van de kern), z omhoog. */
export interface OpenFem3DWallFrame {
  origin: V3;
  u: V3;
  normal: V3;
}

/**
 * Het vlak van een metselwerkwand. Een metselwerkwand staat verticaal: de
 * plaatnormaal ligt horizontaal (|n_z| ≤ 1·10⁻³). Anders volgt een fout.
 */
export function openFem3DWallFrame(model: Pick<OpenFem3DModel, "nodes">, plate: OpenFem3DPlate): OpenFem3DWallFrame {
  const index = new Map(model.nodes.map((node) => [node.id, node]));
  const points = plate.nodeIds.map((id) => {
    const node = index.get(id);
    if (!node) throw new Error(`3D-plaat ${plate.id}: knoop ${id} bestaat niet.`);
    return pointOf(node);
  });
  // Newell-normaal.
  const normal: V3 = [0, 0, 0];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
    normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
    normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const length = Math.hypot(...normal);
  if (!(length > 0)) throw new Error(`3D-plaat ${plate.id} heeft geen eenduidig vlak.`);
  const n: V3 = [normal[0] / length, normal[1] / length, normal[2] / length];
  if (Math.abs(n[2]) > 1e-3) {
    throw new Error(`3D-plaat ${plate.id}: een metselwerkwand moet verticaal staan.`);
  }
  // Zoals `plate_axes` in de kern: de projectie van globaal X, anders van Y.
  const project = (axis: V3): V3 => {
    const d = axis[0] * n[0] + axis[1] * n[1] + axis[2] * n[2];
    return [axis[0] - d * n[0], axis[1] - d * n[1], axis[2] - d * n[2]];
  };
  let u = project([1, 0, 0]);
  if (Math.hypot(...u) < 1e-3) u = project([0, 1, 0]);
  const ul = Math.hypot(...u);
  return { origin: points[0]!, u: [u[0] / ul, u[1] / ul, u[2] / ul], normal: n };
}

/** Coördinaten in het wandvlak: s langs u, z globaal. */
export function openFem3DWallCoordinates(frame: OpenFem3DWallFrame, p: V3): [number, number] {
  return [(p[0] - frame.origin[0]) * frame.u[0] + (p[1] - frame.origin[1]) * frame.u[1] + (p[2] - frame.origin[2]) * frame.u[2], p[2]];
}

function insidePolygon(p: [number, number], polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]!, [xj, yj] = polygon[j]!;
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Hoogste punt van de wandrand boven positie s (verticale lijn door s). */
function wallTopAt(polygon: [number, number][], s: number): number | undefined {
  let top: number | undefined;
  for (let i = 0; i < polygon.length; i += 1) {
    const [x1, z1] = polygon[i]!, [x2, z2] = polygon[(i + 1) % polygon.length]!;
    if ((x1 - s) * (x2 - s) > 0 || x1 === x2) continue;
    const z = z1 + (z2 - z1) * (s - x1) / (x2 - x1);
    top = top === undefined ? z : Math.max(top, z);
  }
  return top;
}

/** Afmetingen van een opening in het wandvlak, voor de latei. */
export interface OpenFem3DOpeningGeometry {
  frame: OpenFem3DWallFrame;
  /** Linker- en rechterkant van de opening langs u (m). */
  sMin: number;
  sMax: number;
  /** Hoogte van de bovenrand (globaal z, m). */
  zTop: number;
  /** Hoogte metselwerk boven de opening, gemeten in het midden (m). */
  heightAboveM: number;
}

export function openFem3DOpeningGeometry(
  model: Pick<OpenFem3DModel, "nodes">, plate: OpenFem3DPlate, opening: OpenFem3DPlateOpening,
): OpenFem3DOpeningGeometry {
  const frame = openFem3DWallFrame(model, plate);
  const index = new Map(model.nodes.map((node) => [node.id, node]));
  const local = (id: number) => openFem3DWallCoordinates(frame, pointOf(index.get(id)!));
  const points = opening.nodeIds.map(local);
  const sMin = Math.min(...points.map((p) => p[0]));
  const sMax = Math.max(...points.map((p) => p[0]));
  const zTop = Math.max(...points.map((p) => p[1]));
  const tol = 1e-6;
  const hasCorner = (s: number) => points.some((p) => Math.abs(p[0] - s) <= tol && Math.abs(p[1] - zTop) <= tol);
  if (opening.boundary?.some((segment) => segment.kind === "arc") || !hasCorner(sMin) || !hasCorner(sMax)) {
    throw new Error(`Opening ${opening.id} van 3D-plaat ${plate.id}: een latei past alleen boven een opening met een rechte, horizontale bovenrand.`);
  }
  const outline = plate.nodeIds.map(local);
  const top = wallTopAt(outline, (sMin + sMax) / 2);
  return { frame, sMin, sMax, zTop, heightAboveM: Math.max(0, (top ?? zTop) - zTop) };
}

/**
 * De twee eindpunten van de latei (globaal): de bovenrand van de opening,
 * aan beide zijden met de opleglengte verlengd. Beide punten moeten in het
 * metselwerk liggen (binnen de wand en buiten elke opening).
 */
export function openFem3DLintelEnds(
  model: Pick<OpenFem3DModel, "nodes">, plate: OpenFem3DPlate, opening: OpenFem3DPlateOpening, bearingM: number,
): [V3, V3] {
  if (!(Number.isFinite(bearingM) && bearingM > 0)) throw new Error("De opleglengte van de latei moet groter dan 0 zijn.");
  const g = openFem3DOpeningGeometry(model, plate, opening);
  const index = new Map(model.nodes.map((node) => [node.id, node]));
  const local = (id: number) => openFem3DWallCoordinates(g.frame, pointOf(index.get(id)!));
  const outline = plate.nodeIds.map(local);
  const holes = (plate.openings ?? []).map((item) => item.nodeIds.map(local));
  const toGlobal = (s: number): V3 => {
    // Het punt op de hoogte van de bovenrand, op afstand s langs u vanaf de oorsprong.
    const base: V3 = [g.frame.origin[0] + s * g.frame.u[0], g.frame.origin[1] + s * g.frame.u[1], 0];
    return [base[0], base[1], g.zTop];
  };
  const ends: [number, number][] = [[g.sMin - bearingM, g.zTop], [g.sMax + bearingM, g.zTop]];
  for (const end of ends) {
    // Een fractie binnen de oplegging keuren, zodat een eindpunt precies op de wandrand telt als "erin".
    const probe: [number, number] = [end[0] + (end[0] < g.sMin ? 1e-6 : -1e-6), end[1] - 1e-6];
    if (!insidePolygon(probe, outline) || holes.some((hole) => insidePolygon(probe, hole))) {
      throw new Error(`Opening ${opening.id} van 3D-plaat ${plate.id}: de oplegging van de latei (${bearingM.toFixed(3)} m) valt buiten het metselwerk.`);
    }
  }
  // Het wandvlak is verticaal: z = zTop, de horizontale ligging volgt uit u
  // vanaf de oorsprong, plus de horizontale component van de oorsprong zelf.
  return [toGlobal(ends[0][0]), toGlobal(ends[1][0])];
}

/** Lateibelasting voor de toets (karakteristiek, alleen het metselwerk). */
export interface OpenFem3DLintelDesign {
  /** Dagmaat (m). */
  clearSpanM: number;
  /** Overspanning van de latei: dagmaat + één opleglengte (hart op hart van de opleggingen). */
  spanM: number;
  /** Gekozen spreiding en de spreiding waarmee gerekend is. */
  requested: OpenFem3DLintelLoadSpread;
  applied: OpenFem3DLintelLoadSpread;
  /** Hoogte van de 60°-driehoek: L·tan60°/2 = L·√3/2 (m). */
  triangleHeightM: number;
  heightAboveM: number;
  /** Totale last van het metselwerk op de latei, moment en oplegkracht (kN, kNm). */
  loadKn: number;
  momentKnm: number;
  supportKn: number;
  /** Het metselwerk dat het rekenmodel (volle hoogte) op de latei legt. */
  modelLoadKn: number;
  modelMomentKnm: number;
  modelSupportKn: number;
  /** Uitleg bij een terugval naar de volle hoogte. */
  note?: string;
}

/**
 * Lateibelasting uit het eigen gewicht van het metselwerk (karakteristiek).
 *  - Volle hoogte: q = γ·t·h_boven, gelijkmatig; M = q·L²/8, V = q·L/2.
 *  - Driehoek 60°: driehoek op basis L met hoogte h_d = L·√3/2; W = γ·t·L·h_d/2,
 *    M = W·L/6 (driehoekslast met de top in het midden), V = W/2.
 * Het rekenmodel legt altijd de volle hoogte op de latei; het verschil
 * (model − gekozen) mag bij de lateitoets van de staafkrachten uit het
 * eigen-gewichtgeval af, met de factor van dat geval in de combinatie.
 */
export function openFem3DLintelDesign(
  model: Pick<OpenFem3DModel, "nodes">, plate: OpenFem3DPlate, opening: OpenFem3DPlateOpening,
): OpenFem3DLintelDesign | null {
  if (!plate.masonry || !opening.lintel) return null;
  const g = openFem3DOpeningGeometry(model, plate, opening);
  const clearSpanM = g.sMax - g.sMin;
  const spanM = clearSpanM + opening.lintel.bearingM;
  const gamma = plate.masonry.unitWeightKnM3 * plate.thicknessM;
  const triangleHeightM = spanM * Math.sqrt(3) / 2;
  const fullQ = gamma * g.heightAboveM;
  const modelLoadKn = fullQ * spanM;
  const modelMomentKnm = fullQ * spanM * spanM / 8;
  const modelSupportKn = modelLoadKn / 2;
  const requested = opening.lintel.loadSpread;
  const fits = g.heightAboveM >= triangleHeightM - 1e-9;
  const applied: OpenFem3DLintelLoadSpread = requested === "triangle60" && fits ? "triangle60" : "fullHeight";
  const note = requested === "triangle60" && !fits
    ? `Boven de latei staat ${g.heightAboveM.toFixed(2)} m metselwerk, minder dan de driehoek van 60° (${triangleHeightM.toFixed(2)} m): de last op de wandkop valt binnen de driehoek, dus gerekend met de volle hoogte.`
    : undefined;
  if (applied === "fullHeight") {
    return {
      clearSpanM, spanM, requested, applied, triangleHeightM, heightAboveM: g.heightAboveM,
      loadKn: modelLoadKn, momentKnm: modelMomentKnm, supportKn: modelSupportKn,
      modelLoadKn, modelMomentKnm, modelSupportKn, ...(note ? { note } : {}),
    };
  }
  const loadKn = gamma * spanM * triangleHeightM / 2;
  return {
    clearSpanM, spanM, requested, applied, triangleHeightM, heightAboveM: g.heightAboveM,
    loadKn, momentKnm: loadKn * spanM / 6, supportKn: loadKn / 2,
    modelLoadKn, modelMomentKnm, modelSupportKn,
  };
}

/** Knoopkoppeling in het rekenverzoek (zie `NodeLink3D` in de kern). */
export interface OpenFem3DNodeLinkBody {
  id: number; masterNodeId: number; slaveNodeId: number;
  ux?: boolean; uy?: boolean; uz?: boolean; rx?: boolean; ry?: boolean; rz?: boolean;
}

/**
 * Lateien in het rekenverzoek. Een latei deelt haar knopen niet met de
 * wandplaat. Elke rekenknoop op haar as krijgt een eigen tweelingknoop, die
 * met een knoopkoppeling aan de wandknoop hangt.
 *
 * Waarom: deelt de latei de knopen wel, dan werkt zij als drukstaaf tussen de
 * penanten. Wand, latei en funderingsbalk vormen dan samen een vakwerkligger,
 * en de funderingsbalk wordt ontlast. Op een HEA 200 van 6 m was dat 16 %
 * (test-open-fem3d-metselwerkwand.mjs [5]). Dat sluit het besluit in #97 juist
 * uit.
 *
 * Gekoppeld worden: verticaal (uz), loodrecht op de wand en de rotatie om de
 * wandas (torsie van de latei), langs de hele latei. Langs de wand alleen aan
 * het begin, zodat de latei niet vrij kan schuiven maar ook geen penanten aan
 * elkaar koppelt.
 *
 * Een wand die niet langs X of Y staat, kan dat niet met globale
 * vrijheidsgraden. Daar wordt de latei in alle translaties gekoppeld, met een
 * melding.
 */
export function withOpenFem3DLintelLinks<
  N extends { id: number; x: number; y: number; z: number },
  M extends { id: number; startNodeId: number; endNodeId: number; intermediateNodeIds?: number[] },
>(
  model: Pick<OpenFem3DModel, "nodes" | "plates">, nodes: N[], members: M[],
): { nodes: N[]; members: M[]; nodeLinks: OpenFem3DNodeLinkBody[]; notices: string[] } {
  const lintels: { beamId: number; plate: OpenFem3DPlate }[] = [];
  for (const plate of model.plates ?? []) {
    if (!plate.masonry) continue;
    for (const opening of plate.openings ?? []) if (opening.lintel) lintels.push({ beamId: opening.lintel.beamId, plate });
  }
  if (lintels.length === 0) return { nodes, members, nodeLinks: [], notices: [] };
  const outNodes = [...nodes];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let nextId = nodes.reduce((max, node) => Math.max(max, node.id), 0) + 1;
  const nodeLinks: OpenFem3DNodeLinkBody[] = [];
  const notices: string[] = [];
  const outMembers = members.map((member) => {
    const lintel = lintels.find((item) => item.beamId === member.id);
    if (!lintel) return member;
    const frame = openFem3DWallFrame(model, lintel.plate);
    const alongX = Math.abs(frame.u[0]) > 1 - 1e-9;
    const alongY = Math.abs(frame.u[1]) > 1 - 1e-9;
    if (!alongX && !alongY) {
      notices.push(`Latei (staaf ${member.id}) in een schuine wand: in alle richtingen aan de wand gekoppeld; zij kan daar de penanten koppelen.`);
    }
    const chain = [member.startNodeId, ...(member.intermediateNodeIds ?? []), member.endNodeId];
    const twins = chain.map((masterNodeId, index) => {
      const master = byId.get(masterNodeId);
      if (!master) throw new Error(`Latei (staaf ${member.id}): rekenknoop ${masterNodeId} ontbreekt.`);
      const twin = { ...master, id: nextId++ } as N;
      outNodes.push(twin);
      const first = index === 0;
      const link: OpenFem3DNodeLinkBody = { id: nodeLinks.length + 1, masterNodeId, slaveNodeId: twin.id, uz: true };
      if (alongX) Object.assign(link, { uy: true, rx: true, ...(first ? { ux: true } : {}) });
      else if (alongY) Object.assign(link, { ux: true, ry: true, ...(first ? { uy: true } : {}) });
      else Object.assign(link, { ux: true, uy: true });
      nodeLinks.push(link);
      return twin.id;
    });
    return {
      ...member,
      startNodeId: twins[0]!,
      endNodeId: twins[twins.length - 1]!,
      ...(twins.length > 2 ? { intermediateNodeIds: twins.slice(1, -1) } : {}),
    };
  });
  return { nodes: outNodes, members: outMembers, nodeLinks, notices };
}

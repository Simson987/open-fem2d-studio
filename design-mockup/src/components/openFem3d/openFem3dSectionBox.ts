/**
 * openFem3dSectionBox.ts — de section box van de 3D-werkruimte (issue #86):
 * een asgerichte doos (globaal X/Y/Z, in m) die het model afsnijdt. Alleen
 * wat binnen de doos valt is zichtbaar, kiesbaar, snapbaar en gelabeld.
 * Zuiver: geen DOM en geen Three.js, zodat de regels los te toetsen zijn
 * (test-open-fem3d-section-box.mjs). Het tekenvlak (ThreeFrameCanvas.tsx)
 * maakt er clipping planes, grepen en randen van; het rapportbeeld
 * (openFem3dRapportBeeld.ts) knipt er zijn vectorbeeld mee.
 *
 *  - De doos hoort bij de weergave: hij staat in de zichtbaarheid
 *    (`sectionBox`, aan/uit + grenzen in m) en reist zo mee in de bewaarde
 *    zichtbaarheid en in de opgeslagen views. Een oude view zonder doos: uit.
 *  - Uit bewaart de grenzen: weer aan geeft dezelfde doos terug. Zonder
 *    grenzen (nog nooit aan) neemt aan de modelgrenzen plus een marge.
 *  - Elke as is minstens {@link OPEN_FEM_3D_SECTION_BOX_MIN_M} groot; slepen
 *    rondt een vlak af op hele millimeters.
 *  - Binnen of buiten: een punt met een kleine tolerantie (de doosrand hoort
 *    erbij); een staaf en een lijnstuk geknipt op de doos (Liang–Barsky); een
 *    plaat en een vlak geknipt op de zes vlakken (Sutherland–Hodgman).
 */
import type { OpenFem3DModel } from "./openFem3dModel";
import type { OpenFem3DSelection } from "./openFem3dSelection";

export type OpenFem3DSectionBoxPunt = [number, number, number];

/** De grenzen van de doos in m: min ≤ max per as. */
export interface OpenFem3DSectionBoxBounds {
  min: OpenFem3DSectionBoxPunt;
  max: OpenFem3DSectionBoxPunt;
}

/**
 * De section box in de zichtbaarheid. `bounds` blijft bewaard als de doos
 * uit staat; `enabled` is alleen waar met grenzen.
 */
export interface OpenFem3DSectionBox {
  enabled: boolean;
  bounds: OpenFem3DSectionBoxBounds | null;
}

export const DEFAULT_OPEN_FEM_3D_SECTION_BOX: OpenFem3DSectionBox = Object.freeze({ enabled: false, bounds: null });

/** De kleinste doosmaat per as (m): een vlak slepen houdt zoveel afstand tot het overliggende. */
export const OPEN_FEM_3D_SECTION_BOX_MIN_M = 0.1;

/**
 * Tolerantie (m) van binnen/buiten: een knoop precies op de doosrand hoort
 * erbij, ook na afronding op millimeters.
 */
export const OPEN_FEM_3D_SECTION_BOX_TOLERANTIE_M = 1e-6;

type Punt3 = { x: number; y: number; z: number };
const AS = ["x", "y", "z"] as const;

/**
 * De marge rond het model of de selectie (m): 10 % van de modeldiagonaal,
 * minstens 0,5 m en hoogstens 5 m. Ruim genoeg voor profielen, opleggingen,
 * lastpijlen en de snedekrachtlijnen (hun hoogte is 8,5 % van de diagonaal,
 * hoogstens 3 m), zodat een doos op de modelgrenzen niets van het beeld afsnijdt.
 */
export function openFem3DSectionBoxMarge(diagonaalM: number): number {
  return Math.min(5, Math.max(0.5, 0.1 * (Number.isFinite(diagonaalM) ? diagonaalM : 0)));
}

const naarMm = (waarde: number) => Math.round(waarde * 1000) / 1000;
/** Op hele millimeters naar buiten afgerond: de doos blijft om de punten heen. */
const omlaagMm = (waarde: number) => Math.floor(waarde * 1000 + 1e-9) / 1000 + 0;
const omhoogMm = (waarde: number) => Math.ceil(waarde * 1000 - 1e-9) / 1000 + 0;

/** Grenzen om de punten, met `marge` (m) rondom en op mm naar buiten; zonder punten null. */
export function openFem3DSectionBoxRondPunten(punten: Iterable<Punt3>, marge: number): OpenFem3DSectionBoxBounds | null {
  const min: OpenFem3DSectionBoxPunt = [Infinity, Infinity, Infinity];
  const max: OpenFem3DSectionBoxPunt = [-Infinity, -Infinity, -Infinity];
  let aantal = 0;
  for (const p of punten) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
    AS.forEach((as, i) => {
      min[i] = Math.min(min[i], p[as]);
      max[i] = Math.max(max[i], p[as]);
    });
    aantal += 1;
  }
  if (aantal === 0) return null;
  const m = Math.max(0, marge);
  return begrensMaat({
    min: [omlaagMm(min[0] - m), omlaagMm(min[1] - m), omlaagMm(min[2] - m)],
    max: [omhoogMm(max[0] + m), omhoogMm(max[1] + m), omhoogMm(max[2] + m)],
  });
}

function diagonaal(punten: readonly Punt3[]): number {
  if (punten.length === 0) return 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of punten) AS.forEach((as, i) => { lo[i] = Math.min(lo[i], p[as]); hi[i] = Math.max(hi[i], p[as]); });
  return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
}

/** De modelgrenzen (alle knopen) plus de marge; een leeg model: null. */
export function openFem3DSectionBoxRondModel(model: Pick<OpenFem3DModel, "nodes">): OpenFem3DSectionBoxBounds | null {
  return openFem3DSectionBoxRondPunten(model.nodes, openFem3DSectionBoxMarge(diagonaal(model.nodes)));
}

/**
 * De knopen van een selectie: een knoop zelf, de eindknopen van een staaf,
 * de hoekknopen van een plaat (met openingen), en bij een last het element
 * waar hij op staat (een belastingvlak: zijn hoekknopen). Een groep: alles samen.
 */
export function openFem3DSectionBoxSelectieKnopen(model: OpenFem3DModel, selection: OpenFem3DSelection): Set<number> {
  const ids = new Set<number>();
  if (!selection) return ids;
  const staaf = new Map(model.beams.map((beam) => [beam.id, beam]));
  const plaat = new Map((model.plates ?? []).map((plate) => [plate.id, plate]));
  const metStaaf = (id: number) => {
    const beam = staaf.get(id);
    if (beam) { ids.add(beam.startNodeId); ids.add(beam.endNodeId); }
  };
  const metPlaat = (id: number) => {
    const plate = plaat.get(id);
    plate?.nodeIds.forEach((nodeId) => ids.add(nodeId));
    plate?.openings?.forEach((opening) => opening.nodeIds.forEach((nodeId) => ids.add(nodeId)));
  };
  const lasten = (soort: "nodalLoad" | "memberLoad" | "memberPointLoad" | "thermalLoad" | "surfaceLoad" | "loadPanel", gekozen: readonly number[]) => {
    const set = new Set(gekozen);
    if (soort === "nodalLoad") (model.loads ?? []).forEach((load) => { if (set.has(load.id)) ids.add(load.nodeId); });
    else if (soort === "surfaceLoad") (model.surfaceLoads ?? []).forEach((load) => { if (set.has(load.id)) metPlaat(load.plateId); });
    else if (soort === "loadPanel") (model.loadPanels ?? []).forEach((panel) => { if (set.has(panel.id)) panel.nodeIds.forEach((id) => ids.add(id)); });
    else {
      const lijst = soort === "memberLoad" ? model.memberLoads : soort === "memberPointLoad" ? model.memberPointLoads : model.thermalLoads;
      (lijst ?? []).forEach((load) => { if (set.has(load.id)) metStaaf(load.beamId); });
    }
  };
  if (selection.type === "node") ids.add(selection.id);
  else if (selection.type === "beam") metStaaf(selection.id);
  else if (selection.type === "plate") metPlaat(selection.id);
  else if (selection.type === "envelopePanel") {
    const panel = (model.envelopePanels ?? []).find((candidate) => candidate.id === selection.id);
    panel?.nodeIds.forEach((id) => ids.add(id));
    panel?.openings?.forEach((opening) => opening.nodeIds.forEach((id) => ids.add(id)));
  }
  else if (selection.type === "multi") {
    selection.nodeIds.forEach((id) => ids.add(id));
    selection.beamIds.forEach(metStaaf);
    selection.plateIds?.forEach(metPlaat);
    for (const [soort, gekozen] of Object.entries(selection.loads ?? {})) {
      if (gekozen?.length) lasten(soort as Parameters<typeof lasten>[0], gekozen);
    }
  } else lasten(selection.type, [selection.id]);
  return ids;
}

/**
 * De doos om de selectie: de grenzen van haar knopen plus de marge van het
 * model (dezelfde als bij de modelgrenzen: profielen, lasten en lijnen
 * schalen met het model, niet met de selectie). Geen selectie of geen
 * bestaande knopen: null.
 */
export function openFem3DSectionBoxRondSelectie(model: OpenFem3DModel, selection: OpenFem3DSelection): OpenFem3DSectionBoxBounds | null {
  const ids = openFem3DSectionBoxSelectieKnopen(model, selection);
  if (ids.size === 0) return null;
  return openFem3DSectionBoxRondPunten(model.nodes.filter((node) => ids.has(node.id)),
    openFem3DSectionBoxMarge(diagonaal(model.nodes)));
}

/** Elke as minstens OPEN_FEM_3D_SECTION_BOX_MIN_M: een te smalle as groeit gelijk naar beide kanten. */
function begrensMaat(bounds: OpenFem3DSectionBoxBounds): OpenFem3DSectionBoxBounds {
  const min = [...bounds.min] as OpenFem3DSectionBoxPunt;
  const max = [...bounds.max] as OpenFem3DSectionBoxPunt;
  for (let i = 0; i < 3; i += 1) {
    if (max[i] - min[i] >= OPEN_FEM_3D_SECTION_BOX_MIN_M - 1e-9) continue;
    const midden = (min[i] + max[i]) / 2;
    min[i] = naarMm(midden - OPEN_FEM_3D_SECTION_BOX_MIN_M / 2);
    max[i] = naarMm(min[i] + OPEN_FEM_3D_SECTION_BOX_MIN_M);
  }
  return { min, max };
}

const punt3 = (value: unknown): OpenFem3DSectionBoxPunt | null =>
  Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === "number" && Number.isFinite(v))
    ? [Number(value[0]), Number(value[1]), Number(value[2])] : null;

/**
 * Bewaarde grenzen → geldige grenzen, of null. Per as een verwisselde min en
 * max worden omgedraaid; een te smalle as groeit tot de minimale doosmaat.
 */
export function normalizeOpenFem3DSectionBoxBounds(value: unknown): OpenFem3DSectionBoxBounds | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const a = punt3(raw.min), b = punt3(raw.max);
  if (!a || !b) return null;
  return begrensMaat({
    min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  });
}

/**
 * Bewaarde doos (browseropslag of een opgeslagen view) → een geldige doos.
 * Ontbreekt hij of is hij ongeldig (een oude view): uit, zonder grenzen.
 * Aan zonder geldige grenzen: uit.
 */
export function normalizeOpenFem3DSectionBox(value: unknown): OpenFem3DSectionBox {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_OPEN_FEM_3D_SECTION_BOX;
  const raw = value as Record<string, unknown>;
  const bounds = normalizeOpenFem3DSectionBoxBounds(raw.bounds);
  return { enabled: raw.enabled === true && bounds !== null, bounds };
}

/** De werkende grenzen: alleen als de doos aan staat. */
export function openFem3DSectionBoxActief(box: OpenFem3DSectionBox | null | undefined): OpenFem3DSectionBoxBounds | null {
  return box?.enabled && box.bounds ? box.bounds : null;
}

export function openFem3DSectionBoxGelijk(
  a: OpenFem3DSectionBoxBounds | null | undefined, b: OpenFem3DSectionBoxBounds | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  return a.min.every((v, i) => v === b.min[i]) && a.max.every((v, i) => v === b.max[i]);
}

/** Aan/uit (menu, lint): uit bewaart de grenzen; aan zonder grenzen neemt de modelgrenzen. */
export function openFem3DSectionBoxSchakel(box: OpenFem3DSectionBox, model: Pick<OpenFem3DModel, "nodes">): OpenFem3DSectionBox {
  if (box.enabled) return { enabled: false, bounds: box.bounds };
  const bounds = box.bounds ?? openFem3DSectionBoxRondModel(model);
  return { enabled: bounds !== null, bounds };
}

/** Reset: aan, op de modelgrenzen plus de marge (een leeg model: uit). */
export function openFem3DSectionBoxReset(model: Pick<OpenFem3DModel, "nodes">): OpenFem3DSectionBox {
  const bounds = openFem3DSectionBoxRondModel(model);
  return { enabled: bounds !== null, bounds };
}

/** Passend op de selectie: aan, om de selectie; zonder selectie null (niets te doen). */
export function openFem3DSectionBoxOpSelectie(model: OpenFem3DModel, selection: OpenFem3DSelection): OpenFem3DSectionBox | null {
  const bounds = openFem3DSectionBoxRondSelectie(model, selection);
  return bounds ? { enabled: true, bounds } : null;
}

// ── Binnen en buiten ─────────────────────────────────────────────────────

/** Ligt het punt in de doos (de rand hoort erbij, met tolerantie)? */
export function openFem3DSectionBoxBevat(b: OpenFem3DSectionBoxBounds, p: Punt3, tol = OPEN_FEM_3D_SECTION_BOX_TOLERANTIE_M): boolean {
  return p.x >= b.min[0] - tol && p.x <= b.max[0] + tol
    && p.y >= b.min[1] - tol && p.y <= b.max[1] + tol
    && p.z >= b.min[2] - tol && p.z <= b.max[2] + tol;
}

/**
 * Het deel van het lijnstuk ab binnen de doos als parameterbereik [t0, t1]
 * (0 = a, 1 = b), of null als het er geheel buiten ligt. Liang–Barsky tegen
 * de zes halfruimten: geknipt op de doosrand zelf; een lijnstuk evenwijdig
 * aan een vlak telt met de tolerantie (een staaf precies op de rand blijft).
 */
export function openFem3DSectionBoxLijnstuk(
  b: OpenFem3DSectionBoxBounds, a: Punt3, c: Punt3, tol = OPEN_FEM_3D_SECTION_BOX_TOLERANTIE_M,
): [number, number] | null {
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i += 1) {
    const as = AS[i];
    const d = c[as] - a[as];
    for (const [p, q] of [[-d, a[as] - b.min[i]], [d, b.max[i] - a[as]]] as const) {
      if (Math.abs(p) < 1e-12) {
        if (q < -tol) return null;
        continue;
      }
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return t0 <= t1 ? [t0, t1] : null;
}

export type OpenFem3DSectionBoxStand = "binnen" | "deels" | "buiten";

/** Een staaf (systeemlijn ab): geheel binnen, deels (de doos knipt hem) of geheel buiten. */
export function openFem3DSectionBoxStaafStand(b: OpenFem3DSectionBoxBounds, a: Punt3, c: Punt3): OpenFem3DSectionBoxStand {
  const deel = openFem3DSectionBoxLijnstuk(b, a, c);
  if (!deel) return "buiten";
  return deel[0] <= 1e-9 && deel[1] >= 1 - 1e-9 ? "binnen" : "deels";
}

const lerp = (a: Punt3, c: Punt3, t: number): Punt3 => ({
  x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t, z: a.z + (c.z - a.z) * t,
});

/** Het geknipte lijnstuk als twee punten, of null. */
export function openFem3DSectionBoxKnipLijnstuk(b: OpenFem3DSectionBoxBounds, a: Punt3, c: Punt3): { a: Punt3; b: Punt3 } | null {
  const deel = openFem3DSectionBoxLijnstuk(b, a, c);
  return deel ? { a: lerp(a, c, deel[0]), b: lerp(a, c, deel[1]) } : null;
}

/**
 * Een polylijn geknipt op de doos: de stukken binnen de doos, elk als eigen
 * polylijn (een lijn die de doos verlaat en terugkomt, wordt twee stukken).
 */
export function openFem3DSectionBoxPolylijn(b: OpenFem3DSectionBoxBounds, punten: readonly Punt3[]): Punt3[][] {
  const stukken: Punt3[][] = [];
  let huidig: Punt3[] | null = null;
  for (let i = 0; i + 1 < punten.length; i += 1) {
    const deel = openFem3DSectionBoxLijnstuk(b, punten[i], punten[i + 1]);
    if (!deel) { huidig = null; continue; }
    const begin = lerp(punten[i], punten[i + 1], deel[0]);
    const eind = lerp(punten[i], punten[i + 1], deel[1]);
    if (!huidig || deel[0] > 1e-9) {
      huidig = [begin];
      stukken.push(huidig);
    }
    huidig.push(eind);
    if (deel[1] < 1 - 1e-9) huidig = null;
  }
  if (punten.length === 1 && openFem3DSectionBoxBevat(b, punten[0])) stukken.push([punten[0]]);
  return stukken.filter((stuk) => stuk.length >= 2 || punten.length === 1);
}

/**
 * Een (vlakke) veelhoek geknipt op de zes doosvlakken (Sutherland–Hodgman;
 * de doos is convex, dus elk deel binnen de doos blijft over). Geheel buiten:
 * een lege lijst.
 */
export function openFem3DSectionBoxVeelhoek(b: OpenFem3DSectionBoxBounds, punten: readonly Punt3[]): Punt3[] {
  let uit: Punt3[] = [...punten];
  const tol = OPEN_FEM_3D_SECTION_BOX_TOLERANTIE_M;
  for (let i = 0; i < 3 && uit.length > 0; i += 1) {
    const as = AS[i];
    for (const [kant, grens] of [[1, b.min[i]], [-1, b.max[i]]] as const) {
      // Binnen: kant · (p − grens) ≥ −tol; een snijpunt ligt op de rand zelf.
      const afstand = (p: Punt3) => kant * (p[as] - grens);
      const nieuw: Punt3[] = [];
      for (let k = 0; k < uit.length; k += 1) {
        const p = uit[k], q = uit[(k + 1) % uit.length];
        const dp = afstand(p), dq = afstand(q);
        const binnenP = dp >= -tol, binnenQ = dq >= -tol;
        if (binnenP) nieuw.push(p);
        if (binnenP !== binnenQ) nieuw.push(lerp(p, q, Math.min(1, Math.max(0, dp / (dp - dq)))));
      }
      uit = nieuw;
      if (uit.length === 0) break;
    }
  }
  return uit;
}

/** Een veelhoek (plaat): geheel binnen, deels of geheel buiten de doos. */
export function openFem3DSectionBoxVeelhoekStand(b: OpenFem3DSectionBoxBounds, punten: readonly Punt3[]): OpenFem3DSectionBoxStand {
  if (punten.length === 0) return "buiten";
  if (punten.every((p) => openFem3DSectionBoxBevat(b, p))) return "binnen";
  return openFem3DSectionBoxVeelhoek(b, punten).length >= 3 ? "deels" : "buiten";
}

/** De doorsnede van twee dozen, of null als ze elkaar niet raken. */
export function openFem3DSectionBoxSnijding(a: OpenFem3DSectionBoxBounds, b: OpenFem3DSectionBoxBounds): OpenFem3DSectionBoxBounds | null {
  const min: OpenFem3DSectionBoxPunt = [0, 0, 0], max: OpenFem3DSectionBoxPunt = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    min[i] = Math.max(a.min[i], b.min[i]);
    max[i] = Math.min(a.max[i], b.max[i]);
    if (min[i] > max[i]) return null;
  }
  return { min, max };
}

/**
 * De zes halfruimten van de doos als vlak n · p + c ≥ 0 (binnen), in de
 * vorm van THREE.Plane (normaal, constante): Three.js knipt weg wat aan de
 * negatieve kant van een clipping plane ligt.
 */
export function openFem3DSectionBoxVlakken(b: OpenFem3DSectionBoxBounds): { normaal: OpenFem3DSectionBoxPunt; constante: number }[] {
  return OPEN_FEM_3D_SECTION_BOX_VLAKKEN.map(({ as, kant }) => {
    const normaal: OpenFem3DSectionBoxPunt = [0, 0, 0];
    normaal[as] = -kant;
    return { normaal, constante: kant < 0 ? -b.min[as] : b.max[as] };
  });
}

// ── De zes vlakken en hun grepen ─────────────────────────────────────────

/** Een vlak van de doos: de as (0 = X, 1 = Y, 2 = Z) en de kant (−1 = min, +1 = max). */
export interface OpenFem3DSectionBoxVlak {
  /** "-x", "+x", "-y", "+y", "-z", "+z": dezelfde tekens als de doelen van de view cube. */
  id: string;
  as: 0 | 1 | 2;
  kant: -1 | 1;
}

export const OPEN_FEM_3D_SECTION_BOX_VLAKKEN: readonly OpenFem3DSectionBoxVlak[] = [
  { id: "-x", as: 0, kant: -1 }, { id: "+x", as: 0, kant: 1 },
  { id: "-y", as: 1, kant: -1 }, { id: "+y", as: 1, kant: 1 },
  { id: "-z", as: 2, kant: -1 }, { id: "+z", as: 2, kant: 1 },
];

/** Het midden van een vlak: daar staat zijn greep. */
export function openFem3DSectionBoxVlakMidden(b: OpenFem3DSectionBoxBounds, vlak: OpenFem3DSectionBoxVlak): OpenFem3DSectionBoxPunt {
  const p: OpenFem3DSectionBoxPunt = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  p[vlak.as] = vlak.kant < 0 ? b.min[vlak.as] : b.max[vlak.as];
  return p;
}

/** De plaats (m) van een vlak langs zijn as. */
export function openFem3DSectionBoxVlakWaarde(b: OpenFem3DSectionBoxBounds, vlak: OpenFem3DSectionBoxVlak): number {
  return vlak.kant < 0 ? b.min[vlak.as] : b.max[vlak.as];
}

/**
 * Zet één vlak op `waarde` (m), afgerond op hele millimeters en begrensd:
 * het blijft minstens `minMaat` van het overliggende vlak. De andere vijf
 * vlakken blijven staan.
 */
export function openFem3DSectionBoxZetVlak(
  b: OpenFem3DSectionBoxBounds, vlak: OpenFem3DSectionBoxVlak, waarde: number, minMaat = OPEN_FEM_3D_SECTION_BOX_MIN_M,
): OpenFem3DSectionBoxBounds {
  if (!Number.isFinite(waarde)) return b;
  const min = [...b.min] as OpenFem3DSectionBoxPunt, max = [...b.max] as OpenFem3DSectionBoxPunt;
  const w = naarMm(waarde);
  if (vlak.kant < 0) min[vlak.as] = Math.min(w, naarMm(max[vlak.as] - minMaat));
  else max[vlak.as] = Math.max(w, naarMm(min[vlak.as] + minMaat));
  return { min, max };
}

/**
 * Grens op 1 − cos²(hoek tussen as en kijkstraal): daaronder (minder dan
 * ±2,6°) wijst een greep naar de kijker. Hij is dan een stip zonder richting:
 * niet te slepen, dus ook niet getekend en niet te vangen.
 */
export const OPEN_FEM_3D_SECTION_BOX_LANGS_STRAAL = 2e-3;

/**
 * Wijst de as d (bijna) langs de straal r? Dezelfde toets voor het slepen
 * ({@link openFem3DSectionBoxAsParameter}), het tekenen en het vangen van een
 * greep: wat niet te slepen is, wordt ook niet getoond. Een nulvector: ja.
 */
export function openFem3DSectionBoxLangsStraal(d: Punt3, r: Punt3): boolean {
  const rl = Math.hypot(r.x, r.y, r.z), dl = Math.hypot(d.x, d.y, d.z);
  if (!(rl > 0) || !(dl > 0)) return true;
  const b = (d.x * r.x + d.y * r.y + d.z * r.z) / (rl * dl);
  return 1 - b * b < OPEN_FEM_3D_SECTION_BOX_LANGS_STRAAL;
}

/**
 * De parameter s langs de as (punt o + s·d, d een eenheidsvector) die het
 * dichtst bij de muisstraal (oorsprong r0, richting r) ligt: de plek waar
 * een greep heen gaat als je hem langs zijn normaal sleept. Kijk je (bijna)
 * langs de as, dan is er geen eenduidige plek: null.
 */
export function openFem3DSectionBoxAsParameter(
  o: Punt3, d: Punt3, r0: Punt3, r: Punt3,
): number | null {
  const rl = Math.hypot(r.x, r.y, r.z), dl = Math.hypot(d.x, d.y, d.z);
  if (!(rl > 0) || !(dl > 0)) return null;
  // De greep wijst naar de kijker: geen eenduidige plek op de as.
  if (openFem3DSectionBoxLangsStraal(d, r)) return null;
  const rx = r.x / rl, ry = r.y / rl, rz = r.z / rl;
  const dx = d.x / dl, dy = d.y / dl, dz = d.z / dl;
  const b = dx * rx + dy * ry + dz * rz;
  const noemer = 1 - b * b;
  const wx = o.x - r0.x, wy = o.y - r0.y, wz = o.z - r0.z;
  const dw = dx * wx + dy * wy + dz * wz;
  const rw = rx * wx + ry * wy + rz * wz;
  return (b * rw - dw) / noemer;
}

// ── Invoer van buiten (bedieningskanaal, MCP) ────────────────────────────

/**
 * De section box uit een opdracht van het bedieningskanaal
 * (`gui_configure_3d_view`, veld `section_box`):
 *  - `enabled` (verplicht): aan of uit;
 *  - `min_m` en `max_m` (samen): de grenzen in m, elk {x, y, z};
 *  - `fit`: "model" (de modelgrenzen plus marge) of "selection" (om de
 *    huidige selectie); niet samen met min_m/max_m.
 * Aan zonder grenzen en zonder `fit`: de bewaarde grenzen, anders de
 * modelgrenzen. Een fout geeft een Error met de reden; dan verandert niets.
 */
export function openFem3DSectionBoxUitOpdracht(
  invoer: unknown, huidig: OpenFem3DSectionBox, model: OpenFem3DModel, selection: OpenFem3DSelection,
): OpenFem3DSectionBox {
  if (!invoer || typeof invoer !== "object" || Array.isArray(invoer)) throw new Error("`section_box` moet een object zijn");
  const raw = invoer as Record<string, unknown>;
  const bekend = new Set(["enabled", "min_m", "max_m", "fit"]);
  const onbekend = Object.keys(raw).filter((key) => !bekend.has(key));
  if (onbekend.length > 0) throw new Error(`section_box kent ${onbekend.join(", ")} niet`);
  if (typeof raw.enabled !== "boolean") throw new Error("section_box.enabled is verplicht: true of false");
  const leesPunt = (naam: "min_m" | "max_m"): OpenFem3DSectionBoxPunt | undefined => {
    const v = raw[naam];
    if (v === undefined) return undefined;
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`section_box.${naam} moet {x, y, z} in m zijn`);
    const p = v as Record<string, unknown>;
    const extra = Object.keys(p).filter((key) => key !== "x" && key !== "y" && key !== "z");
    if (extra.length > 0) throw new Error(`section_box.${naam} kent ${extra.join(", ")} niet`);
    const getallen = AS.map((as) => p[as]);
    if (!getallen.every((g) => typeof g === "number" && Number.isFinite(g))) {
      throw new Error(`section_box.${naam} vereist x, y en z als getal in m`);
    }
    return getallen as OpenFem3DSectionBoxPunt;
  };
  const min = leesPunt("min_m"), max = leesPunt("max_m");
  if ((min === undefined) !== (max === undefined)) throw new Error("section_box: geef min_m en max_m samen");
  const fit = raw.fit;
  if (fit !== undefined && fit !== "model" && fit !== "selection") throw new Error("section_box.fit is model of selection");
  if (fit !== undefined && min) throw new Error("section_box: fit niet samen met min_m/max_m");
  let bounds = huidig.bounds;
  if (min && max) {
    for (let i = 0; i < 3; i += 1) {
      if (!(max[i] - min[i] >= OPEN_FEM_3D_SECTION_BOX_MIN_M - 1e-9)) {
        throw new Error(`section_box: max_m.${AS[i]} moet minstens ${OPEN_FEM_3D_SECTION_BOX_MIN_M * 1000} mm boven min_m.${AS[i]} liggen`);
      }
    }
    bounds = { min: [...min], max: [...max] };
  } else if (fit === "selection") {
    bounds = openFem3DSectionBoxRondSelectie(model, selection);
    if (!bounds) throw new Error("section_box.fit = selection: er is geen selectie in de 3D-werkruimte");
  } else if (fit === "model" || (raw.enabled && !bounds)) {
    bounds = openFem3DSectionBoxRondModel(model);
    if (!bounds && raw.enabled) throw new Error("section_box: het 3D-model heeft geen knopen");
  }
  return { enabled: raw.enabled && bounds !== null, bounds };
}

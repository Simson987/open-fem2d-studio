/**
 * Tekenhulpen van het 3D-tekenvlak (#84): objectspoor (zoals in CAD), Shift
 * als ortho, Alt zonder snap en de maat tijdens het tekenen.
 *
 * Zuivere rekenregels zonder Three of DOM: het tekenvlak (ThreeFrameCanvas)
 * geeft het muispunt op het werkvlak, een schermprojectie en de kandidaten van
 * de knoop-, stramien- en rastersnap; `kiesTekenpunt` beslist welk punt het
 * wordt en welke spoorlijnen erbij horen. Zo staan de regels op één plek en
 * zijn ze los te toetsen (test-open-fem3d-tekenhulp.mjs). Coördinaten in meter,
 * zoals het 3D-model; maten in beeld en bij de invoer in mm.
 *
 * OBJECTSPOOR
 *   Verworven worden knopen en staven waar de muis even (SPOOR_VERWERF_MS)
 *   boven hing, hoogstens SPOOR_MAX_VERWORVEN tegelijk (de oudste valt af);
 *   het beginpunt van de staaf of contour in aanbouw hoort er vanzelf bij.
 *   Alles wordt loodrecht op het werkvlak geprojecteerd: het spoor ligt altijd
 *   in het werkvlak (een knoop op een ander level lijnt in bovenaanzicht dus
 *   gewoon uit). Spoorlijnen:
 *     - uitlijnen: door een verworven punt evenwijdig aan een globale as die in
 *       het werkvlak ligt (X/Y in bovenaanzicht, X/Z of Y/Z bij verticaal tekenen);
 *     - verlengen: de verlenging van een verworven staaf voorbij een van zijn einden;
 *     - loodrecht: vanaf het beginpunt loodrecht op een verworven staaf, met het
 *       voetpunt op die staaf (of haar verlenging) als vangpunt;
 *     - parallel: vanaf het beginpunt evenwijdig aan een verworven staaf.
 *   Een staaf die (bijna) loodrecht op het werkvlak staat, geeft geen lijnen:
 *   zijn projectie heeft geen richting.
 *   Een lijn vangt binnen SPOOR_TOLERANTIE_PX schermpixels, loodrecht in beeld
 *   gemeten (ook in een schuin aanzicht); twee lijnen samen vangen hun snijpunt
 *   binnen SPOOR_SNIJPUNT_PX. Langs een lijn volgt de vrije maat het stramien
 *   of het raster: langs een asrichting de coördinaat, schuin de afstand vanaf
 *   de oorsprong van de lijn (in stappen van het raster).
 *
 * AANSLUITEN OP EEN STAAF
 *   Raakt de klik een bestaande staaf, dan wordt die gesplitst: op het
 *   tekenpunt als dat op de staaf ligt, anders op het snijpunt van de actieve
 *   spoor- of ortholijn met de staaf (`staafSplitsing`). Een voetpunt
 *   'loodrecht op staaf N' splitst staaf N, ook zonder treffer van de klik.
 *
 * VOORRANG
 *   knoop > snijpunt van spoorlijnen > spoorlijn (voetpunt, uitlijnen,
 *   verlengen, loodrecht, parallel) > stramien > raster > vrij punt.
 *
 * ALT EN SHIFT (zoals in 2D, lib/tekenhulp.ts)
 *   Alt: alle snaps tijdelijk uit, het punt onder de muis. Shift (met een
 *   beginpunt): de richting langs een globale as in het werkvlak, met dezelfde
 *   hysterese als in 2D; de maat langs die as komt van een knoop in de buurt,
 *   een spoorlijn die de as snijdt, het stramien of het raster.
 *
 * DIRECTE INVOER
 *   Een getal typen (mm, komma of punt) en Enter zet het eindpunt op precies
 *   die lengte langs de huidige richting; Backspace wist een teken, Esc de
 *   getypte maat.
 */
import { ORTHO_WISSEL_FACTOR } from "../../lib/tekenhulp";
import { parseLength } from "../../lib/lengthInput";

export type Punt3 = { x: number; y: number; z: number };
export type Schermpunt = { x: number; y: number };
export type As3 = "x" | "y" | "z";

const ASSEN: readonly As3[] = ["x", "y", "z"];

/** Zo dicht (schermpixels) bij een spoorlijn vangt hij. */
export const SPOOR_TOLERANTIE_PX = 8;
/** Zo dicht (schermpixels) bij het snijpunt van twee spoorlijnen vangt dat snijpunt. */
export const SPOOR_SNIJPUNT_PX = 12;
/** Zo lang (ms) moet de muis boven een knoop of staaf hangen om hem te verwerven. */
export const SPOOR_VERWERF_MS = 400;
/** Zo ver (schermpixels) mag de muis daarbij bewegen. */
export const SPOOR_STILSTAND_PX = 4;
/** Hoogstens zoveel verworven knopen en staven; de oudste valt af. */
export const SPOOR_MAX_VERWORVEN = 7;
/** Een knoop binnen deze afstand (schermpixels) wordt verworven… */
export const SPOOR_VERWERF_KNOOP_PX = 10;
/** …en anders een staaf binnen deze afstand. */
export const SPOOR_VERWERF_STAAF_PX = 6;
/**
 * Een verworven staaf geeft alleen spoorlijnen als zijn projectie op het
 * werkvlak minstens 1 mm en 1 % van zijn lengte is; anders staat hij (bijna)
 * loodrecht op het werkvlak en heeft de projectie geen betrouwbare richting.
 */
export const SPOOR_STAAF_MIN_PROJECTIE_M = 1e-3;
export const SPOOR_STAAF_MIN_PROJECTIE_DEEL = 0.01;

/** Afronding van berekende schuine punten: een miljoenste millimeter. */
const AFRONDING_M = 1e9;
const rondAf = (v: number) => Math.round(v * AFRONDING_M) / AFRONDING_M;
const EPS = 1e-9;

const verschil = (a: Punt3, b: Punt3): Punt3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const som = (a: Punt3, b: Punt3): Punt3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const maal = (a: Punt3, f: number): Punt3 => ({ x: a.x * f, y: a.y * f, z: a.z * f });
const inprod = (a: Punt3, b: Punt3) => a.x * b.x + a.y * b.y + a.z * b.z;
const uitprod = (a: Punt3, b: Punt3): Punt3 => ({
  x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x,
});
const lengte = (a: Punt3) => Math.hypot(a.x, a.y, a.z);
const eenheid = (a: Punt3): Punt3 | null => {
  const l = lengte(a);
  return l > EPS ? maal(a, 1 / l) : null;
};
const asVector = (as: As3): Punt3 => ({ x: as === "x" ? 1 : 0, y: as === "y" ? 1 : 0, z: as === "z" ? 1 : 0 });
const rond = (p: Punt3): Punt3 => ({ x: rondAf(p.x), y: rondAf(p.y), z: rondAf(p.z) });

/** De globale as waarlangs deze richting precies loopt, of null. */
function asVanRichting(r: Punt3): As3 | null {
  const nul = ASSEN.filter((as) => Math.abs(r[as]) < 1e-12);
  if (nul.length !== 2) return null;
  return ASSEN.find((as) => !nul.includes(as)) ?? null;
}

/* ── Werkvlak ─────────────────────────────────────────────────────────── */

export interface Werkvlak {
  /** Een punt van het werkvlak. */
  punt: Punt3;
  /** De normaal (eenheidsvector; het teken doet er niet toe). */
  normaal: Punt3;
}

/** De globale assen die in het werkvlak liggen (loodrecht op de normaal). */
export function assenInWerkvlak(normaal: Punt3): As3[] {
  return ASSEN.filter((as) => Math.abs(normaal[as]) < EPS);
}

/**
 * Een punt loodrecht op het werkvlak geprojecteerd. Bij een vlak loodrecht op
 * een globale as is de coördinaat langs die as exact die van het vlak (anders
 * werd 0,1 m 0,10000000000000009).
 */
export function opWerkvlak(p: Punt3, vlak: Werkvlak): Punt3 {
  const n = vlak.normaal;
  const as = asVanRichting(n);
  if (as) return { ...p, [as]: vlak.punt[as] };
  const l = lengte(n);
  if (!(l > EPS)) return { ...p };
  const nn = maal(n, 1 / l);
  return verschil(p, maal(nn, inprod(verschil(p, vlak.punt), nn)));
}

/**
 * Twee assen in het werkvlak voor de richting (hoek) van een staaf:
 *   - een (bijna) horizontaal vlak: u langs X, v langs Y (bovenaanzicht: 0° is
 *     +X, 90° is +Y);
 *   - een (bijna) verticaal vlak: v omhoog (+Z), u horizontaal langs +X, of
 *     langs +Y in een zijaanzicht (0° horizontaal, 90° recht omhoog).
 * Het teken van de normaal doet er niet toe.
 */
function werkvlakBasis(normaal: Punt3): { u: Punt3; v: Punt3 } | null {
  const n = eenheid(normaal);
  if (!n) return null;
  const projectie = (r: Punt3) => eenheid(verschil(r, maal(n, inprod(r, n))));
  if (Math.abs(n.z) > Math.SQRT1_2) {
    const omhoog = n.z < 0 ? maal(n, -1) : n;
    const u = projectie({ x: 1, y: 0, z: 0 }) ?? projectie({ x: 0, y: 1, z: 0 });
    if (!u) return null;
    return { u, v: uitprod(omhoog, u) };
  }
  const v = projectie({ x: 0, y: 0, z: 1 });
  if (!v) return null;
  let u = eenheid(uitprod(v, n));
  if (!u) return null;
  if (u.x < -EPS || (Math.abs(u.x) <= EPS && u.y < 0)) u = maal(u, -1);
  return { u, v };
}

/** De richting van `delta` in het werkvlak in graden op [0, 360); null zonder lengte. */
export function richtingInWerkvlak(normaal: Punt3, delta: Punt3): number | null {
  const basis = werkvlakBasis(normaal);
  if (!basis) return null;
  const a = inprod(delta, basis.u);
  const b = inprod(delta, basis.v);
  if (Math.hypot(a, b) < EPS) return null;
  const graden = Math.atan2(b, a) * 180 / Math.PI;
  const r = ((graden % 360) + 360) % 360;
  return r >= 360 - 1e-12 ? 0 : r;
}

/* ── Verwerven ────────────────────────────────────────────────────────── */

export type VerworvenItem =
  | { soort: "knoop"; id: number; punt: Punt3 }
  | { soort: "staaf"; id: number; a: Punt3; b: Punt3 };

const zelfde = (a: VerworvenItem, b: VerworvenItem) => a.soort === b.soort && a.id === b.id;

/**
 * Verwerf een knoop of staaf: achteraan (nieuwste), een al verworven item
 * schuift met zijn nieuwe plek naar achteren, en boven `max` valt de oudste af.
 */
export function verwerf(lijst: readonly VerworvenItem[], item: VerworvenItem, max = SPOOR_MAX_VERWORVEN): VerworvenItem[] {
  const volgend = [...lijst.filter((ander) => !zelfde(ander, item)), item];
  return volgend.slice(Math.max(0, volgend.length - Math.max(0, max)));
}

const gelijkPunt = (a: Punt3, b: Punt3) => a.x === b.x && a.y === b.y && a.z === b.z;

/**
 * De verworven items na een modelwijziging: verdwenen knopen en staven vallen
 * weg, de rest krijgt de plek uit het model. Niets veranderd: dezelfde lijst.
 */
export function verworvenNaModel(
  lijst: readonly VerworvenItem[],
  knopen: ReadonlyMap<number, Punt3>,
  staven: ReadonlyMap<number, { startNodeId: number; endNodeId: number }>,
): readonly VerworvenItem[] {
  let veranderd = false;
  const volgend: VerworvenItem[] = [];
  for (const item of lijst) {
    if (item.soort === "knoop") {
      const k = knopen.get(item.id);
      if (!k) { veranderd = true; continue; }
      const punt = { x: k.x, y: k.y, z: k.z };
      if (!gelijkPunt(punt, item.punt)) veranderd = true;
      volgend.push({ ...item, punt });
    } else {
      const s = staven.get(item.id);
      const a = s && knopen.get(s.startNodeId);
      const b = s && knopen.get(s.endNodeId);
      if (!a || !b) { veranderd = true; continue; }
      const pa = { x: a.x, y: a.y, z: a.z }, pb = { x: b.x, y: b.y, z: b.z };
      if (!gelijkPunt(pa, item.a) || !gelijkPunt(pb, item.b)) veranderd = true;
      volgend.push({ ...item, a: pa, b: pb });
    }
  }
  return veranderd ? volgend : lijst;
}

/* ── Spoorlijnen ──────────────────────────────────────────────────────── */

export type SpoorLijnSoort = "uitlijnen" | "verlengen" | "loodrecht" | "parallel" | "ortho";

export interface SpoorLijn {
  soort: SpoorLijnSoort;
  /** Het (geprojecteerde) verworven punt, staafeinde of beginpunt waar de lijn door gaat. */
  oorsprong: Punt3;
  /** Eenheidsvector in het werkvlak. */
  richting: Punt3;
  /** De globale as als de lijn daarlangs loopt. */
  as?: As3;
  /** Alleen vanaf de oorsprong in de richting (verlengen: voorbij het einde). */
  alleenVooruit?: boolean;
  knoopId?: number;
  staafId?: number;
}

/** Het beginpunt van de staaf of contour in aanbouw. */
export interface TekenStart {
  punt: Punt3;
  knoopId?: number;
}

/** Twee lijnen vallen samen: evenwijdig en de oorsprong van de een op de ander. */
function zelfdeLijn(a: SpoorLijn, b: SpoorLijn): boolean {
  if (lengte(uitprod(a.richting, b.richting)) > 1e-9) return false;
  if (a.alleenVooruit || b.alleenVooruit) {
    if (!a.alleenVooruit || !b.alleenVooruit || inprod(a.richting, b.richting) < 0) return false;
  }
  const d = verschil(b.oorsprong, a.oorsprong);
  return lengte(uitprod(d, a.richting)) < 1e-9 && (!a.alleenVooruit || lengte(d) < 1e-9);
}

/**
 * Een verworven staaf in het werkvlak: de geprojecteerde einden en de
 * richting (eenheidsvector). Null als de projectie te kort is om een richting
 * te geven (SPOOR_STAAF_MIN_PROJECTIE_M / _DEEL): een (bijna) loodrecht op het
 * werkvlak staande kolom gaf anders een willekeurige richting.
 */
function staafInVlak(a3: Punt3, b3: Punt3, vlak: Werkvlak): { a: Punt3; b: Punt3; r: Punt3; lengte: number } | null {
  const a = opWerkvlak(a3, vlak), b = opWerkvlak(b3, vlak);
  const l = lengte(verschil(b, a));
  if (!(l >= SPOOR_STAAF_MIN_PROJECTIE_M) || l < SPOOR_STAAF_MIN_PROJECTIE_DEEL * lengte(verschil(b3, a3))) return null;
  return { a, b, r: maal(verschil(b, a), 1 / l), lengte: l };
}

/**
 * Alle spoorlijnen in het werkvlak bij dit beginpunt en deze verworven items:
 * eerst uitlijnen (beginpunt, dan de knopen), dan per staaf verlengen,
 * loodrecht en parallel. Lijnen die samenvallen met een eerdere, vallen weg.
 */
export function spoorLijnen(vlak: Werkvlak, start: TekenStart | null, verworven: readonly VerworvenItem[]): SpoorLijn[] {
  const lijnen: SpoorLijn[] = [];
  const voeg = (lijn: SpoorLijn) => { if (!lijnen.some((ander) => zelfdeLijn(ander, lijn))) lijnen.push(lijn); };
  const assen = assenInWerkvlak(vlak.normaal);
  const beginpunt = start ? opWerkvlak(start.punt, vlak) : null;
  const punten: { punt: Punt3; knoopId?: number }[] = [];
  if (beginpunt) punten.push({ punt: beginpunt, knoopId: start!.knoopId });
  for (const item of verworven) if (item.soort === "knoop") punten.push({ punt: opWerkvlak(item.punt, vlak), knoopId: item.id });
  for (const { punt, knoopId } of punten) {
    for (const as of assen) voeg({ soort: "uitlijnen", oorsprong: punt, richting: asVector(as), as, knoopId });
  }
  for (const item of verworven) {
    if (item.soort !== "staaf") continue;
    const staaf = staafInVlak(item.a, item.b, vlak);
    if (!staaf) continue;
    const { a, b, r } = staaf;
    const as = asVanRichting(r) ?? undefined;
    const terug = maal(r, -1);
    voeg({ soort: "verlengen", oorsprong: b, richting: r, as, alleenVooruit: true, staafId: item.id });
    voeg({ soort: "verlengen", oorsprong: a, richting: terug, as: asVanRichting(terug) ?? undefined, alleenVooruit: true, staafId: item.id });
    if (!beginpunt) continue;
    const loodrecht = eenheid(uitprod(vlak.normaal, r));
    if (loodrecht) voeg({ soort: "loodrecht", oorsprong: beginpunt, richting: loodrecht, as: asVanRichting(loodrecht) ?? undefined, staafId: item.id });
    voeg({ soort: "parallel", oorsprong: beginpunt, richting: r, as, staafId: item.id });
  }
  return lijnen;
}

/** De voetpunten vanaf het beginpunt op de (verlengde) verworven staven. */
export function spoorVoetpunten(
  vlak: Werkvlak, start: TekenStart | null, verworven: readonly VerworvenItem[],
): { staafId: number; punt: Punt3 }[] {
  if (!start) return [];
  const s = opWerkvlak(start.punt, vlak);
  const uit: { staafId: number; punt: Punt3 }[] = [];
  for (const item of verworven) {
    if (item.soort !== "staaf") continue;
    const staaf = staafInVlak(item.a, item.b, vlak);
    if (!staaf) continue;
    const { a, r } = staaf;
    const voet = puntOpLijn(a, r, inprod(verschil(s, a), r));
    if (lengte(verschil(voet, s)) < 1e-9) continue;
    uit.push({ staafId: item.id, punt: voet });
  }
  return uit;
}

/** oorsprong + richting·t; langs een globale as exact (alleen die coördinaat verandert). */
function puntOpLijn(oorsprong: Punt3, richting: Punt3, t: number): Punt3 {
  const as = asVanRichting(richting);
  if (as) return { ...oorsprong, [as]: oorsprong[as] + richting[as] * t };
  return rond(som(oorsprong, maal(richting, t)));
}

/** Het snijpunt van twee lijnen in hetzelfde vlak, of null als ze evenwijdig lopen. */
function snijpunt(a: SpoorLijn, b: SpoorLijn): { punt: Punt3; ta: number; tb: number } | null {
  const k = uitprod(a.richting, b.richting);
  const kk = inprod(k, k);
  if (kk < 1e-18) return null;
  const d = verschil(b.oorsprong, a.oorsprong);
  const ta = inprod(uitprod(d, b.richting), k) / kk;
  const tb = inprod(uitprod(d, a.richting), k) / kk;
  // Twee lijnen langs verschillende globale assen: exact, de coördinaat langs
  // de ene as komt van de oorsprong van de andere.
  if (a.as && b.as && a.as !== b.as) {
    return { punt: { ...a.oorsprong, [a.as]: b.oorsprong[a.as] }, ta, tb };
  }
  return { punt: puntOpLijn(a.oorsprong, a.richting, ta), ta, tb };
}

const pxAfstand = (a: Schermpunt | null, b: Schermpunt) => (a ? Math.hypot(a.x - b.x, a.y - b.y) : Number.POSITIVE_INFINITY);

/** De stap (m) langs een lijn tussen de drie hulppunten van `lijnInBeeld`. */
const BEELD_STAP_M = 0.1;

/**
 * Een lijn van het werkvlak in beeld: de afstand (px) van de cursor tot de
 * lijn, loodrecht in beeld gemeten, en het punt van de lijn dat in beeld het
 * voetpunt van de cursor is (als parameter t vanaf de oorsprong; dt is de
 * verschuiving ten opzichte van het voetpunt in de wereld).
 *
 * Het voetpunt in de wereld (loodrecht in het werkvlak) ligt in een schuin
 * aanzicht in beeld verder weg dan de echte afstand tot de lijn; de vangzone
 * kromp daardoor. Een rechte lijn blijft in beeld recht (ook in perspectief),
 * dus twee punten geven de beeldlijn. Langs de lijn is de afbeelding
 * projectief, u(λ) = (c + 1)·λ / (c·λ + 1); een derde punt legt c vast en
 * geeft de terugweg van het voetpunt in beeld naar t. Null als de lijn hier
 * niet te meten is (een hulppunt of het voetpunt ligt achter de camera).
 */
export function lijnInBeeld(
  lijn: { oorsprong: Punt3; richting: Punt3 },
  cursor: Punt3,
  cursorPx: Schermpunt,
  naarScherm: (p: Punt3) => Schermpunt | null,
): { t: number; dt: number; px: number } | null {
  const { oorsprong: o, richting: r } = lijn;
  const t0 = inprod(verschil(cursor, o), r);
  const p = (t: number) => naarScherm(som(o, maal(r, t)));
  const s0 = p(t0), s1 = p(t0 + BEELD_STAP_M), s2 = p(t0 + 2 * BEELD_STAP_M);
  if (!s0 || !s1 || !s2) return null;
  const ex = s1.x - s0.x, ey = s1.y - s0.y;
  const l2 = ex * ex + ey * ey;
  const cx = cursorPx.x - s0.x, cy = cursorPx.y - s0.y;
  // De lijn loopt langs de kijkrichting: in beeld één punt.
  if (!(l2 > 1e-18)) return { t: t0, dt: 0, px: Math.hypot(cx, cy) };
  const px = Math.abs(cx * ey - cy * ex) / Math.sqrt(l2);
  const u = (cx * ex + cy * ey) / l2;
  const u2 = ((s2.x - s0.x) * ex + (s2.y - s0.y) * ey) / l2;
  const c = Math.abs(1 - u2) > 1e-12 ? (u2 - 2) / (2 - 2 * u2) : 0;
  const noemer = c + 1 - c * u;
  if (!(Math.abs(noemer) > 1e-15)) return null;
  const lambda = u === 0 ? 0 : u / noemer;
  // Voorbij het verdwijnpunt: dat deel van de beeldlijn ligt achter de camera.
  if (!(c * lambda + 1 > 0)) return null;
  // Een verschuiving onder een miljardste millimeter is rekenruis (in
  // bovenaanzicht vallen beide voetpunten samen): dan exact de cursor.
  const dt = Math.abs(lambda * BEELD_STAP_M) < 1e-12 ? 0 : lambda * BEELD_STAP_M;
  return { t: t0 + dt, dt, px };
}

/* ── Het tekenpunt ────────────────────────────────────────────────────── */

export type TekenpuntSoort = "knoop" | "snijpunt" | "voetpunt" | "spoor" | "ortho" | "stramien" | "raster" | "vrij";

export interface Tekenpunt {
  punt: Punt3;
  soort: TekenpuntSoort;
  /** Soort knoop: de knoop zelf; soort ortho: de knoop die de maat langs de as gaf. */
  knoopId?: number;
  /** De spoorlijnen om te tekenen (van hun oorsprong tot het punt). */
  lijnen: SpoorLijn[];
  /** Soort voetpunt: de staaf waar het voetpunt op ligt. */
  staafId?: number;
  /** Shift: de as van de ortho-richting. */
  orthoAs?: As3;
  /** Soort spoor: de afstand (m) van de oorsprong van de lijn tot het punt. */
  afstand?: number;
  /** Alt was ingedrukt: alle snaps tijdelijk uit. */
  alt?: boolean;
}

export interface TekenpuntInvoer {
  /** Het muispunt op het werkvlak (de kijkstraal door de cursor). */
  cursor: Punt3;
  /** De cursor op het scherm (px). */
  cursorPx: Schermpunt;
  /** Een wereldpunt naar het scherm (px), of null achter de camera. */
  naarScherm: (p: Punt3) => Schermpunt | null;
  vlak: Werkvlak;
  start: TekenStart | null;
  verworven: readonly VerworvenItem[];
  instellingen: { knoop: boolean; stramien: boolean; raster: boolean; spoor: boolean };
  toetsen: { alt: boolean; shift: boolean };
  /** De knoop binnen de snapzone van de cursor (knoopsnap van het tekenvlak). */
  knoop: { id: number; punt: Punt3 } | null;
  /** Het stramienpunt binnen de snapzone, met de assen die het stramien vastlegde. */
  stramien: { punt: Punt3; assen: readonly As3[] } | null;
  /** Het rasterpunt bij de cursor. */
  raster: Punt3 | null;
  /** De rasterstap (m) voor de maat langs een spoorlijn of ortho-as; null zonder raster. */
  rasterStap: number | null;
  /** Shift: de as van de vorige muisstand, voor de hysterese. */
  vorigeOrthoAs?: As3 | null;
  /** Shift: minimaal verschil (m) voordat de as wisselt (6 px omgerekend). */
  orthoWisselMin?: number;
  tolerantiePx?: number;
}

/**
 * De ortho-as bij deze muisstand: de grootste component van de verplaatsing
 * langs de assen in het werkvlak, met hysterese zoals in 2D (orthoAs in
 * lib/tekenhulp.ts): een vorige as wisselt pas als een andere component
 * ORTHO_WISSEL_FACTOR keer zo groot is en het verschil minstens `minVerschil`.
 */
export function orthoAs3D(
  start: Punt3, cursor: Punt3, assen: readonly As3[], vorige: As3 | null | undefined, minVerschil = 0,
): As3 | null {
  if (assen.length === 0) return null;
  const component = (as: As3) => Math.abs(cursor[as] - start[as]);
  const grootste = (kandidaten: readonly As3[]) => kandidaten.reduce((beste, as) => (component(as) > component(beste) ? as : beste));
  if (!vorige || !assen.includes(vorige)) return grootste(assen);
  const anderen = assen.filter((as) => as !== vorige);
  if (anderen.length === 0) return vorige;
  const ander = grootste(anderen);
  const huidig = component(vorige);
  const wissel = component(ander) > ORTHO_WISSEL_FACTOR * huidig && component(ander) - huidig >= minVerschil;
  return wissel ? ander : vorige;
}

/** Een maat op het raster: stap > 0, anders ongewijzigd. */
const opRaster = (waarde: number, stap: number | null) =>
  stap !== null && stap > 0 ? Math.round(waarde / stap) * stap : waarde;

/**
 * Het punt waar de muis tekent, met de voorrang van #84:
 * knoop > snijpunt > spoorlijn > stramien > raster > vrij; met Alt geen snap;
 * met Shift (en een beginpunt) ortho langs een globale as in het werkvlak.
 */
export function kiesTekenpunt(inv: TekenpuntInvoer): Tekenpunt {
  const { cursor, cursorPx, naarScherm, vlak, start, toetsen } = inv;
  const tol = inv.tolerantiePx ?? SPOOR_TOLERANTIE_PX;
  const alt = toetsen.alt;
  const aan = alt
    ? { knoop: false, stramien: false, raster: false, spoor: false }
    : inv.instellingen;
  const altVeld = alt ? { alt: true as const } : {};

  // Shift: ortho langs een globale as in het werkvlak.
  if (toetsen.shift && start) {
    const begin = opWerkvlak(start.punt, vlak);
    const as = orthoAs3D(begin, cursor, assenInWerkvlak(vlak.normaal), inv.vorigeOrthoAs, inv.orthoWisselMin ?? 0);
    if (as) {
      const orthoLijn: SpoorLijn = { soort: "ortho", oorsprong: begin, richting: asVector(as), as, knoopId: start.knoopId };
      const op = (waarde: number): Punt3 => ({ ...begin, [as]: waarde });
      // Het punt van de ortholijn onder de cursor, loodrecht in beeld (zoals de spoorlijnen).
      const inBeeld = lijnInBeeld(orthoLijn, cursor, cursorPx, naarScherm);
      const langs = cursor[as] + (inBeeld?.dt ?? 0);
      const voet = op(langs);
      const ortho = (punt: Punt3, extra: Partial<Tekenpunt> = {}): Tekenpunt =>
        ({ punt, soort: "ortho", lijnen: [orthoLijn], orthoAs: as, ...altVeld, ...extra });
      if (aan.knoop && inv.knoop) return ortho(op(inv.knoop.punt[as]), { knoopId: inv.knoop.id });
      if (aan.spoor) {
        const voetPx = naarScherm(voet);
        let beste: { punt: Punt3; lijn: SpoorLijn; px: number } | null = null;
        for (const lijn of spoorLijnen(vlak, start, inv.verworven)) {
          const s = snijpunt(orthoLijn, lijn);
          if (!s || (lijn.alleenVooruit && s.tb < -EPS)) continue;
          const px = voetPx ? pxAfstand(naarScherm(s.punt), voetPx) : Number.POSITIVE_INFINITY;
          if (px <= tol && (!beste || px < beste.px)) beste = { punt: s.punt, lijn, px };
        }
        if (beste) return { punt: beste.punt, soort: "snijpunt", lijnen: [orthoLijn, beste.lijn], orthoAs: as };
      }
      if (aan.stramien && inv.stramien?.assen.includes(as)) return ortho(op(inv.stramien.punt[as]));
      if (aan.raster && inv.rasterStap !== null) return ortho(op(opRaster(langs, inv.rasterStap)));
      return ortho(voet);
    }
  }

  if (alt) return { punt: { ...cursor }, soort: "vrij", lijnen: [], alt: true };
  if (aan.knoop && inv.knoop) return { punt: { ...inv.knoop.punt }, soort: "knoop", knoopId: inv.knoop.id, lijnen: [] };

  if (aan.spoor) {
    const lijnen = spoorLijnen(vlak, start, inv.verworven);
    // De lijnen binnen de vangzone, met het voetpunt van de cursor erop; de
    // afstand loodrecht in beeld (lijnInBeeld), ook in een schuin aanzicht.
    const actief: { lijn: SpoorLijn; t: number; dt: number; px: number }[] = [];
    for (const lijn of lijnen) {
      const inBeeld = lijnInBeeld(lijn, cursor, cursorPx, naarScherm);
      if (!inBeeld || (lijn.alleenVooruit && inBeeld.t < 0)) continue;
      if (inBeeld.px <= tol) actief.push({ lijn, ...inBeeld });
    }
    actief.sort((a, b) => a.px - b.px);
    // 1. Het snijpunt van twee actieve lijnen.
    let besteSnijpunt: { punt: Punt3; lijnen: SpoorLijn[]; px: number } | null = null;
    for (let i = 0; i < actief.length; i += 1) {
      for (let j = i + 1; j < actief.length; j += 1) {
        const s = snijpunt(actief[i].lijn, actief[j].lijn);
        if (!s) continue;
        if ((actief[i].lijn.alleenVooruit && s.ta < -EPS) || (actief[j].lijn.alleenVooruit && s.tb < -EPS)) continue;
        const px = pxAfstand(naarScherm(s.punt), cursorPx);
        if (px <= SPOOR_SNIJPUNT_PX && (!besteSnijpunt || px < besteSnijpunt.px)) {
          besteSnijpunt = { punt: s.punt, lijnen: [actief[i].lijn, actief[j].lijn], px };
        }
      }
    }
    if (besteSnijpunt) return { punt: besteSnijpunt.punt, soort: "snijpunt", lijnen: besteSnijpunt.lijnen };
    // 2. Het voetpunt loodrecht op een verworven staaf.
    let besteVoet: { staafId: number; punt: Punt3; px: number } | null = null;
    for (const voet of spoorVoetpunten(vlak, start, inv.verworven)) {
      const px = pxAfstand(naarScherm(voet.punt), cursorPx);
      if (px <= tol && (!besteVoet || px < besteVoet.px)) besteVoet = { ...voet, px };
    }
    if (besteVoet && start) {
      const begin = opWerkvlak(start.punt, vlak);
      const richting = eenheid(verschil(besteVoet.punt, begin)) ?? { x: 1, y: 0, z: 0 };
      return {
        punt: besteVoet.punt, soort: "voetpunt", staafId: besteVoet.staafId,
        lijnen: [{ soort: "loodrecht", oorsprong: begin, richting, staafId: besteVoet.staafId, knoopId: start.knoopId }],
      };
    }
    // 3. De dichtstbijzijnde lijn; de vrije maat langs de lijn volgt stramien of raster.
    const eerste = actief[0];
    if (eerste) {
      const { lijn } = eerste;
      if (lijn.as) {
        const as = lijn.as;
        // De coördinaat langs de as onder de cursor (het voetpunt in beeld).
        const langs = cursor[as] + lijn.richting[as] * eerste.dt;
        let waarde = langs;
        if (aan.stramien && inv.stramien?.assen.includes(as)) waarde = inv.stramien.punt[as];
        else if (aan.raster) waarde = opRaster(waarde, inv.rasterStap);
        let t = (waarde - lijn.oorsprong[as]) / lijn.richting[as];
        if (lijn.alleenVooruit && t < 0) { waarde = langs; t = eerste.t; }
        return { punt: { ...lijn.oorsprong, [as]: waarde }, soort: "spoor", lijnen: [lijn], afstand: Math.abs(t) };
      }
      let t = eerste.t;
      if (aan.raster && inv.rasterStap !== null) {
        const r = opRaster(t, inv.rasterStap);
        if (!(lijn.alleenVooruit && r < 0)) t = r;
      }
      return { punt: puntOpLijn(lijn.oorsprong, lijn.richting, t), soort: "spoor", lijnen: [lijn], afstand: Math.abs(t) };
    }
  }

  if (aan.stramien && inv.stramien) return { punt: { ...inv.stramien.punt }, soort: "stramien", lijnen: [] };
  if (aan.raster && inv.raster) return { punt: { ...inv.raster }, soort: "raster", lijnen: [] };
  return { punt: { ...cursor }, soort: "vrij", lijnen: [] };
}

/* ── Aansluiten op een staaf ──────────────────────────────────────────── */

/** Zo dicht (m) bij de staafas ligt een punt 'op' de staaf. */
const OP_STAAF_M = 1e-4;

/**
 * De plek van `punt` op staaf a–b als ratio (0 bij a, 1 bij b), of null als
 * het punt er niet op ligt: verder dan `tol` (m) van de as, of op de verlenging.
 */
export function ratioOpStaaf(punt: Punt3, a: Punt3, b: Punt3, tol = OP_STAAF_M): number | null {
  const d = verschil(b, a);
  const ll = inprod(d, d);
  if (!(ll > EPS * EPS)) return null;
  const ratio = inprod(verschil(punt, a), d) / ll;
  if (ratio < -EPS || ratio > 1 + EPS) return null;
  const r = Math.min(1, Math.max(0, ratio));
  return lengte(verschil(som(a, maal(d, r)), punt)) <= tol ? r : null;
}

/**
 * Waar een lijn van het werkvlak de staaf a–b kruist, gemeten in het werkvlak
 * (de staaf geprojecteerd): de ratio langs de staaf en het punt op de staaf
 * zelf. Ligt de staaf in het werkvlak, dan is dat punt exact het snijpunt.
 * Null als ze evenwijdig lopen, het snijpunt buiten de staaf of (bij een
 * halflijn) vóór de oorsprong ligt, of de staaf loodrecht op het vlak staat.
 */
export function snijpuntLijnStaaf(lijn: SpoorLijn, vlak: Werkvlak, a: Punt3, b: Punt3): { ratio: number; punt: Punt3 } | null {
  const staaf = staafInVlak(a, b, vlak);
  if (!staaf) return null;
  const staafLijn: SpoorLijn = { soort: "uitlijnen", oorsprong: staaf.a, richting: staaf.r, as: asVanRichting(staaf.r) ?? undefined };
  const s = snijpunt(lijn, staafLijn);
  if (!s || (lijn.alleenVooruit && s.ta < -EPS)) return null;
  const ratio = s.tb / staaf.lengte;
  if (ratio < -EPS || ratio > 1 + EPS) return null;
  const r = Math.min(1, Math.max(0, ratio));
  const inVlak = lengte(verschil(staaf.a, a)) < EPS && lengte(verschil(staaf.b, b)) < EPS;
  return { ratio: r, punt: inVlak ? s.punt : som(a, maal(verschil(b, a), r)) };
}

export interface StaafSplitsingInvoer {
  /** Het vaste tekenpunt (objectspoor, ortho of getypte maat). */
  punt: Punt3;
  /** De spoor- of ortholijnen waar het punt van kwam (leeg bij een getypte maat). */
  lijnen: readonly SpoorLijn[];
  vlak: Werkvlak;
  /** De staaf die de klik raakte. */
  a: Punt3;
  b: Punt3;
  cursorPx: Schermpunt;
  naarScherm: (p: Punt3) => Schermpunt | null;
  /** Zo ver (px) van de cursor mag het snijpunt met de staaf liggen (standaard SPOOR_SNIJPUNT_PX). */
  tolerantiePx?: number;
}

/**
 * Een staaf tekenen tot op een bestaande staaf (#84): waar die staaf
 * gesplitst wordt als het tekenpunt van het objectspoor of ortho komt.
 *   - het tekenpunt ligt op de staaf: daar ('punt');
 *   - anders het snijpunt van een actieve spoor- of ortholijn met de staaf,
 *     binnen de vangzone bij de cursor ('lijn'); het dichtstbijzijnde wint.
 * Null: geen van beide; het tekenvlak splitst dan op het raakpunt van de klik
 * (zoals zonder tekenhulp), behalve bij een getypte maat (die blijft exact).
 */
export function staafSplitsing(inv: StaafSplitsingInvoer): { ratio: number; punt: Punt3; via: "punt" | "lijn" } | null {
  const op = ratioOpStaaf(inv.punt, inv.a, inv.b);
  if (op !== null) return { ratio: op, punt: { ...inv.punt }, via: "punt" };
  const tol = inv.tolerantiePx ?? SPOOR_SNIJPUNT_PX;
  let beste: { ratio: number; punt: Punt3; px: number } | null = null;
  for (const lijn of inv.lijnen) {
    const s = snijpuntLijnStaaf(lijn, inv.vlak, inv.a, inv.b);
    if (!s) continue;
    const px = pxAfstand(inv.naarScherm(s.punt), inv.cursorPx);
    if (px <= tol && (!beste || px < beste.px)) beste = { ...s, px };
  }
  return beste ? { ratio: beste.ratio, punt: beste.punt, via: "lijn" } : null;
}

/* ── Maatlabel en cursortekst ─────────────────────────────────────────── */

export interface Rechthoek { left: number; top: number; right: number; bottom: number }

/**
 * De kleinste verschuiving (px) waarmee het maatlabel vrij komt van de tekst
 * bij de cursor (met `marge` ertussen); {0, 0} als ze elkaar niet raken. Bij
 * een korte rubberband lag het label midden op de staaf over de cursortekst.
 */
export function uitwijking(label: Rechthoek, tekst: Rechthoek, marge = 2): { dx: number; dy: number } {
  const raakt = label.left < tekst.right + marge && label.right > tekst.left - marge
    && label.top < tekst.bottom + marge && label.bottom > tekst.top - marge;
  if (!raakt) return { dx: 0, dy: 0 };
  const opties = [
    { dx: tekst.left - marge - label.right, dy: 0 },
    { dx: tekst.right + marge - label.left, dy: 0 },
    { dx: 0, dy: tekst.top - marge - label.bottom },
    { dx: 0, dy: tekst.bottom + marge - label.top },
  ];
  return opties.reduce((beste, optie) =>
    Math.abs(optie.dx) + Math.abs(optie.dy) < Math.abs(beste.dx) + Math.abs(beste.dy) ? optie : beste);
}

/* ── Directe invoer ───────────────────────────────────────────────────── */

export interface MaatToetsUitkomst {
  /** De getypte maat (mm, punt als decimaalteken), of null zonder maat. */
  tekst: string | null;
  /** geen: de toets hoort niet bij de maat; invoer: getypt of gewist; wis: Esc; bevestig: Enter. */
  actie: "geen" | "invoer" | "wis" | "bevestig";
}

/**
 * Een toets bij het intypen van een lengte: cijfers, komma of punt (één
 * decimaalteken), Backspace, Esc (wist alleen de maat) en Enter. Zonder
 * getypte maat doen Esc, Enter en Backspace niets: die horen dan bij het
 * tekenvlak (Esc stopt het gereedschap).
 */
export function maatToets(tekst: string | null, toets: string): MaatToetsUitkomst {
  if (/^[0-9]$/.test(toets)) return { tekst: (tekst ?? "") + toets, actie: "invoer" };
  if (toets === "," || toets === ".") {
    if (tekst?.includes(".")) return { tekst, actie: "invoer" };
    return { tekst: (tekst ?? "") + ".", actie: "invoer" };
  }
  if (tekst === null) return { tekst, actie: "geen" };
  if (toets === "Backspace") {
    const korter = tekst.slice(0, -1);
    return { tekst: korter.length > 0 ? korter : null, actie: "invoer" };
  }
  if (toets === "Escape") return { tekst: null, actie: "wis" };
  if (toets === "Enter") return { tekst, actie: "bevestig" };
  return { tekst, actie: "geen" };
}

/** De getypte lengte in mm, of null als het (nog) geen positief getal is. */
export function leesMaat(tekst: string | null): number | null {
  if (tekst === null) return null;
  const mm = parseLength(tekst);
  return Number.isFinite(mm) && mm > 0 ? mm : null;
}

/**
 * Het eindpunt op `lengteMm` vanaf `start` in de richting van `doel` (het
 * punt onder de muis). Langs een globale as exact; null zonder richting.
 */
export function maatEindpunt(start: Punt3, doel: Punt3, lengteMm: number): Punt3 | null {
  const r = eenheid(verschil(doel, start));
  if (!r || !(lengteMm > 0)) return null;
  const m = lengteMm / 1000;
  const as = asVanRichting(r);
  if (as) return { ...start, [as]: start[as] + Math.sign(r[as]) * m };
  return som(start, maal(r, m));
}

/* ── Teksten ──────────────────────────────────────────────────────────── */

const getal = (waarde: number, taal: string) => {
  const r = Math.round(waarde * 10) / 10;
  return new Intl.NumberFormat(taal, { maximumFractionDigits: 1, useGrouping: false }).format(Object.is(r, -0) ? 0 : r);
};

/** Een lengte (m) in mm voor in beeld: hele mm, of één decimaal als dat iets zegt. */
export function toonMaatMm(meter: number, taal: string): string {
  return getal(meter * 1000, taal);
}

/** De getypte maat zoals hij in beeld staat (komma in nl/de/fr). */
export function toonGetypteMaat(tekst: string, taal: string): string {
  const scheiding = new Intl.NumberFormat(taal).format(1.5).replace(/[0-9]/g, "") || ".";
  return tekst.replace(".", scheiding);
}

/** Het maatlabel bij de staaf in aanbouw: "4500 mm · 30°" (lengte en richting in het werkvlak). */
export function maatTekst(start: Punt3, eind: Punt3, normaal: Punt3, taal: string): string | null {
  const d = verschil(eind, start);
  const l = lengte(d);
  if (l < 1e-9) return null;
  const hoek = richtingInWerkvlak(normaal, d);
  return hoek === null ? `${toonMaatMm(l, taal)} mm` : `${toonMaatMm(l, taal)} mm · ${getal(hoek, taal)}°`;
}

type Vertaal = (sleutel: string, waarden?: Record<string, string | number>) => string;

function lijnTekst(lijn: SpoorLijn, t: Vertaal): string {
  const as = (lijn.as ?? "x").toUpperCase();
  switch (lijn.soort) {
    case "uitlijnen":
      return lijn.knoopId !== undefined
        ? t("openFem3d.spoor.uitlijnen", { as, knoop: lijn.knoopId })
        : t("openFem3d.spoor.uitlijnenBegin", { as });
    case "verlengen": return t("openFem3d.spoor.verlengen", { staaf: lijn.staafId ?? "" });
    case "loodrecht": return t("openFem3d.spoor.loodrecht", { staaf: lijn.staafId ?? "" });
    case "parallel": return t("openFem3d.spoor.parallel", { staaf: lijn.staafId ?? "" });
    case "ortho": return t("openFem3d.spoor.ortho", { as });
  }
}

/**
 * De korte tekst bij de cursor: welk spoor of welke snap actief is, bij een
 * spoorlijn met de afstand tot het verworven punt. `t` is i18next met de
 * naamruimte ribbon (de snapnamen komen uit common). Null bij een vrij punt.
 */
export function tekenpuntTekst(tp: Tekenpunt, t: Vertaal, taal: string): string | null {
  const uit = tp.alt ? t("openFem3d.spoor.snapUit") : null;
  switch (tp.soort) {
    case "knoop": return t("common:snap.knoop");
    case "stramien": return t("common:snap.stramien");
    case "raster": return t("common:snap.raster");
    case "snijpunt": return t("openFem3d.spoor.snijpunt", { eerste: lijnTekst(tp.lijnen[0], t), tweede: lijnTekst(tp.lijnen[1], t) });
    case "voetpunt": return t("openFem3d.spoor.voetpunt", { staaf: tp.staafId ?? "" });
    case "spoor": return `${lijnTekst(tp.lijnen[0], t)} · ${toonMaatMm(tp.afstand ?? 0, taal)} mm`;
    case "ortho": {
      const tekst = t("openFem3d.spoor.ortho", { as: (tp.orthoAs ?? "x").toUpperCase() });
      return uit ? `${tekst} · ${uit}` : tekst;
    }
    case "vrij": return uit;
  }
}

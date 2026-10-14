/**
 * Knopen samenvoegen in 3D (issue #75).
 *
 * WAAROM
 * Twee knopen een paar millimeter uit elkaar zitten in 3D niet aan elkaar
 * vast: de hoek van twee platen en een kolomkop die er net naast getekend is,
 * of de knopen van een kopie die op het origineel landen, rekenen als losse
 * punten. Dat is zelden bedoeld, en in het rekenmodel niet te zien. Deze
 * module vindt zulke knopen en voegt ze samen tot één knoop, met alles wat
 * eraan hangt. De tegenhanger in 2D is het herstel "voeg samen" van
 * `lib/modelControle.ts` (`zoekDubbeleKnopen`).
 *
 * DE REGEL
 * Twee knopen vallen samen als hun afstand hoogstens de verbindingstolerantie
 * is (standaard 5 mm, 0,1–25 mm; dezelfde instelling als het aansluiten op
 * staven van #63 en de modelcontrole van 2D). Een groep is transitief: liggen
 * A en B en ook B en C binnen de tolerantie, dan zijn A, B en C één groep.
 * De blijvende knoop is de laagste id; hij houdt zijn plek, de andere knopen
 * verdwijnen en alles wat ernaar verwees, gaat naar hem.
 *
 * AUTOMATISCH (na een bewerking, `placedNodeIds`)
 * Alleen wat de bewerking raakte: een getekend, verplaatst of gekopieerd punt
 * wordt de dichtstbijzijnde bestaande knoop binnen de tolerantie (bij gelijke
 * afstand de laagste id, zoals het tekenvlak met `openFem3DNodeNearPoint`), en
 * die bestaande knoop blijft. Twee bestaande knopen worden nooit onderling
 * gekoppeld: een punt midden tussen twee knopen die 8 mm uit elkaar liggen,
 * gaat op in één ervan, en de andere (met de kolom die eraan hangt) blijft
 * waar hij is. Geplaatste punten onderling binnen de tolerantie worden wel één
 * knoop (de einden van twee kopieën in een rij). Komen er via zo'n keten toch
 * twee bestaande knopen in één groep, dan wordt die groep geweigerd
 * ("existingNodes"): dat kiest de gebruiker met de knop Knopen samenvoegen.
 *
 * TWEE KEER DE TOLERANTIE
 * Een groep waarvan twee knopen verder dan 2 × de tolerantie uit elkaar
 * liggen, wordt geweigerd. Twee knopen die elk binnen de tolerantie van een
 * derde liggen, overspannen samen hoogstens 2 × de tolerantie: dat is de
 * grootste groep die nog "op één plek" ligt (rond die derde knoop). Een
 * ketting van knopen elk net binnen de tolerantie van de volgende (een fijn
 * verdeelde boog, een rij boutgaten op 4 mm) zou transitief tot één punt
 * ineenstorten, en een knoop aan het eind zou dan veel verder verschuiven dan
 * de tolerantie belooft. Zo'n groep blijft staan, met de reden; met een
 * kleinere tolerantie of per selectie gaat het wel.
 *
 * WAT MEEGAAT
 *  - Staven (begin en eind), platen (hoeken, getekende randen met de
 *    stuurknopen van bogen, openingen), knooplasten, schijven, belastingvlakken
 *    en het level (`levelId`). Verschillende levels in één groep: geweigerd,
 *    tenzij een van beide knopen geen level heeft. Heeft de blijvende knoop
 *    geen level, dan neemt hij dat van de andere over als hij op dezelfde
 *    hoogte ligt; een plaat op een level die haar knoop zo zou verliezen,
 *    weigert de groep.
 *  - Opleggingen: de geblokkeerde vrijheidsgraden samen (OR). Twee veren in
 *    dezelfde richting: geweigerd (in serie, parallel of een van beide? dat
 *    kiest de gebruiker). Een veer en een blokkering in dezelfde richting: de
 *    blokkering wint, met een notitie in het verslag. Opgelegde verplaatsingen:
 *    verschillende waarden in dezelfde geblokkeerde richting (een blokkering
 *    zonder opgegeven waarde telt als 0) geweigerd; dezelfde waarde blijft.
 *  - Een knoop in twee verschillende schijven: geweigerd. Een schijf die na het
 *    samenvoegen nog maar één knoop koppelt, verdwijnt (notitie); een schijf
 *    die daardoor niet meer op één hoogte ligt (1 mm, de grens van de
 *    rekenroute), weigert de groep.
 *
 * GEVOLGEN VOOR STAVEN EN PLATEN
 *  - Een staaf waarvan beide einden in de groep liggen, krijgt lengte 0 en
 *    verdwijnt, met haar lasten.
 *  - Een staaf die naar de blijvende knoop omhangt, wordt een fractie korter
 *    of langer: de lastposities schalen mee (zoals bij het splitsen op een
 *    knoop naast de as, #63), de intensiteiten per meter blijven.
 *  - Een dubbele staaf (dezelfde eindknopen, in welke volgorde ook) blijft één
 *    keer: de laagste id. Haar lasten gaan mee naar de blijvende staaf, exact:
 *    in dezelfde richting op dezelfde posities; in omgekeerde richting
 *    gespiegeld (s → L − s, begin- en eindwaarde gewisseld) en met de lokale
 *    componenten zoals de lokale assen het vragen. `openFem3DMemberAxes` geeft
 *    bij een omgekeerde staaf met dezelfde rolhoek e_z' = e_z en e_y' = −e_y
 *    (de hulprichting "omhoog" hangt niet van de zin van e_x af): qy, py en
 *    de temperatuurgradiënt in y wisselen van teken, qz en pz niet. In het
 *    algemeen: de componenten gaan via e_y'·e_y en e_z'·e_z (elk ±1). Een
 *    globale lijnlast (#80) houdt zijn richting; alleen de posities spiegelen.
 *    Verschillen de staven in profiel, materiaal, oriëntatie van de doorsnede
 *    (rolhoek), scharnieren (aan de bijbehorende einden), trek-alleen,
 *    bedding, toetsinstellingen of groep, of sluit een belastingvlak er maar
 *    één van uit, dan wordt de groep geweigerd in plaats van stil te kiezen.
 *    De naam van de blijvende staaf blijft (alleen weergave).
 *  - Een plaat of opening verliest een hoek als twee naburige hoeken
 *    samenvallen. Minder dan drie hoeken, een rand die zichzelf raakt, een
 *    boog die ontaardt, een randoplegging op een rand die lengte 0 krijgt, of
 *    een plaat die niet meer vlak is: geweigerd. Een belastingvlak idem (min.
 *    drie hoeken, en de vlakcontrole van de afdracht als het vóór het
 *    samenvoegen wel klopte).
 *
 * Weigeren gaat per groep: de rest wordt wel samengevoegd, en het verslag
 * noemt elke geweigerde groep met de reden. Een groep die doorgaat, gaat in
 * één keer door of helemaal niet.
 *
 * GROTE MODELLEN
 * De modelcontrole voegt bij elke wijziging van de geometrie op proef het
 * hele model samen. Daarom bouwt `mergeOpenFem3DNodes` één keer per aanroep
 * een werkmodel met indexen (per knoop de staven, platen, schijven,
 * belastingvlakken, opleggingen en knooplasten; per staaf haar lasten en de
 * belastingvlakken die haar uitsluiten), en voegt elke groep samen in een
 * deelmodel met alleen wat aan de groep hangt. De regels hierboven kijken
 * nooit verder dan dat; zo kost een groep niet het hele model.
 *
 * Zuiver: geen React, geen Three. Dezelfde functies voor de app (lintknop,
 * modelcontrole, automatisch na een bewerking via `openFem3dAansluiten.ts`) en
 * de API (`model3d.nodes.merge`).
 */
import { begrensVerbindingstolerantie, CONTROLE_TOL_MM } from "../../lib/modelControle";
import { openFem3DLevelName, type OpenFem3DLevel } from "./openFem3dLevels";
import { openFem3DLoadPanelGeometry } from "./openFem3dLoadPanels";
import {
  isOpenFem3DGlobalMemberLoad, openFem3DMemberAxes, parseOpenFem3DModel,
  type OpenFem3DBeam, type OpenFem3DDiaphragm, type OpenFem3DEndReleases, type OpenFem3DLoadPanel, type OpenFem3DMemberLoad,
  type OpenFem3DMemberPointLoad, type OpenFem3DModel, type OpenFem3DNodalLoad, type OpenFem3DNode, type OpenFem3DPlate, type OpenFem3DPlateBoundarySegment,
  type OpenFem3DPlateEdgeSupport, type OpenFem3DSupport, type OpenFem3DSupportSprings, type OpenFem3DThermalLoad,
  type OpenFem3DPrescribedDisplacements,
} from "./openFem3dModel";
import type { OpenFem3DSelection } from "./openFem3dSelection";

/** Standaard tolerantie in mm: de verbindingstolerantie van de app (#55, #63). */
export const OPEN_FEM_3D_MERGE_TOLERANCE_MM = CONTROLE_TOL_MM;

/** Afrondingsruimte (m) bij het vergelijken met de tolerantie: 5 mm schuin (3 en 4 mm) is nog 5 mm. */
const AFRONDING_M = 1e-12;
/** Een schijf ligt op één hoogte binnen 1 mm (de grens van de rekenroute). */
const SCHIJF_HOOGTE_M = 1e-3;
/** Twee lokale assen zijn gelijk gericht (of tegengesteld) als |e·e'| hierboven ligt. */
const ASSEN_GELIJK = 1 - 1e-9;

const DOF = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;
const VEER = ["kxKnPerM", "kyKnPerM", "kzKnPerM", "krxKnmPerRad", "kryKnmPerRad", "krzKnmPerRad"] as const;
const OPGELEGD = ["uxM", "uyM", "uzM", "rxRad", "ryRad", "rzRad"] as const;
export type OpenFem3DMergeDof = typeof DOF[number];

// ── Het verslag ──────────────────────────────────────────────────────────────

/** Een groep knopen die binnen de tolerantie samenvalt. */
export interface OpenFem3DCoincidentGroup {
  /** Alle knopen van de groep, oplopend. */
  nodeIds: number[];
  /** De knoop die blijft. */
  keepNodeId: number;
  /** Grootste onderlinge afstand in de groep, in mm. */
  spanMm: number;
  /** Grootste afstand van een knoop tot de blijvende knoop, in mm (zo ver schuift een verbinding). */
  distanceMm: number;
}

/** Een samengevoegde groep: deze knopen zijn opgegaan in `keepNodeId`. */
export interface OpenFem3DMergeGroup {
  keepNodeId: number;
  /** De verdwenen knopen, oplopend. */
  nodeIds: number[];
  distanceMm: number;
}

export interface OpenFem3DMergeRemovedBeam {
  beamId: number;
  /** Lijn-, punt- en temperatuurlasten die met haar verdwenen. */
  loadCount: number;
}

export interface OpenFem3DMergeMergedBeam {
  /** De staaf die verdween. */
  beamId: number;
  /** De staaf die bleef (laagste id) en haar lasten overnam. */
  intoBeamId: number;
  /** Lag zij in omgekeerde richting (posities gespiegeld)? */
  reversed: boolean;
  /** Overgenomen lijn-, punt- en temperatuurlasten. */
  loadCount: number;
}

export interface OpenFem3DMergePlate {
  plateId: number;
  /** Hoeken van de buitenrand na het samenvoegen. */
  corners: number;
  /** Zoveel hoeken (buitenrand en openingen samen) vielen weg. */
  removedCorners: number;
}

/** Een eigenschap van twee samenvallende staven die verschilt. */
export type OpenFem3DMergeBeamProperty =
  | "profile" | "taper" | "material" | "orientation" | "releases" | "tensionOnly" | "bedding" | "checkConfig" | "group";

/** Waarom een groep niet samengevoegd is. */
export type OpenFem3DMergeRefusalReason =
  | { kind: "tooWide"; spanMm: number; limitMm: number }
  /** Automatisch: de geplaatste punten zouden meer dan één bestaande knoop samenvoegen (die de bewerking niet raakte). */
  | { kind: "existingNodes"; existingNodeIds: number[] }
  | { kind: "levels"; levelIds: string[] }
  | { kind: "levelPlate"; plateId: number; levelId: string }
  | { kind: "diaphragms"; diaphragmIds: number[] }
  | { kind: "diaphragmHeight"; diaphragmId: number }
  | { kind: "springs"; dof: OpenFem3DMergeDof }
  | { kind: "prescribed"; dof: OpenFem3DMergeDof }
  | { kind: "beamProperties"; beamId: number; otherBeamId: number; properties: OpenFem3DMergeBeamProperty[] }
  | { kind: "beamExcluded"; beamId: number; otherBeamId: number; panelId: number }
  | { kind: "plateCorners" | "plateLoop" | "plateArc" | "plateNotPlanar"; plateId: number }
  | { kind: "openingCorners" | "openingLoop" | "openingArc" | "openingNotPlanar"; plateId: number; openingId: number }
  | { kind: "plateEdgeSupport"; plateId: number; edge: number }
  | { kind: "panelCorners" | "panelLoop"; panelId: number }
  | { kind: "panelInvalid"; panelId: number; message: string }
  | { kind: "invalid"; message: string };

export interface OpenFem3DMergeRefusal {
  /** Alle knopen van de groep, oplopend. */
  nodeIds: number[];
  keepNodeId: number;
  reason: OpenFem3DMergeRefusalReason;
}

/** Iets dat het samenvoegen besliste en dat de gebruiker moet weten. */
export type OpenFem3DMergeNote =
  /** De veer van `nodeId` in `dof` vervalt: een andere knoop van de groep blokkeert die richting. */
  | { kind: "springOverruled"; nodeId: number; keepNodeId: number; dof: OpenFem3DMergeDof }
  /** Schijf `diaphragmId` koppelde daarna nog maar één knoop en is verwijderd. */
  | { kind: "diaphragmRemoved"; diaphragmId: number };

export interface OpenFem3DMergeResult {
  /** Het nieuwe model; zonder samenvoeging precies het model dat erin ging. */
  model: OpenFem3DModel;
  groups: OpenFem3DMergeGroup[];
  removedBeams: OpenFem3DMergeRemovedBeam[];
  mergedBeams: OpenFem3DMergeMergedBeam[];
  plates: OpenFem3DMergePlate[];
  notes: OpenFem3DMergeNote[];
  refused: OpenFem3DMergeRefusal[];
  /** Aantal verdwenen knopen. */
  nodeCount: number;
}

/**
 * Welke knopen meedoen: een paar telt als een van beide knopen in `nodeIds`
 * staat (zoals bij het aansluiten, #63). Zonder: het hele model.
 */
export interface OpenFem3DMergeScope {
  nodeIds?: Iterable<number>;
}

export interface OpenFem3DMergeOptions extends OpenFem3DMergeScope {
  /** Tolerantie in mm, begrensd op 0,1–25 mm; standaard 5. */
  toleranceMm?: number;
  /**
   * De knopen die een bewerking net neerlegde of verplaatste (automatisch
   * samenvoegen, zie de module-uitleg): elk koppelt aan de dichtstbijzijnde
   * bestaande knoop binnen de tolerantie, die blijft; bestaande knopen
   * onderling nooit, en een groep met twee bestaande knopen wordt geweigerd.
   * Zonder: alle paren binnen de tolerantie, de laagste id blijft.
   */
  placedNodeIds?: Iterable<number>;
}

// ── Groepen zoeken ───────────────────────────────────────────────────────────

const afstand = (p: OpenFem3DNode, q: OpenFem3DNode) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
const mm = (m: number) => Math.round(m * 1e6) / 1e3;

/**
 * De groepen knopen die binnen `toleranceMm` samenvallen. Een raster met
 * cellen van de tolerantie houdt het lineair: elke knoop bekijkt alleen de 27
 * cellen om zich heen. Met `scope.nodeIds` alleen paren met een van die
 * knopen. De blijvende knoop is de laagste id.
 *
 * Met `placedNodeIds` (automatisch na een bewerking) alleen paren met een
 * geplaatste knoop uit het bereik: met andere geplaatste knopen binnen de
 * tolerantie, en met hoogstens één bestaande knoop, de dichtstbijzijnde (bij
 * gelijke afstand de laagste id). Twee bestaande knopen koppelen nooit
 * rechtstreeks. De blijvende knoop is de laagste bestaande knoop van de
 * groep, zonder bestaande knoop de laagste id. Gesorteerd op de laagste knoop.
 */
export function findOpenFem3DCoincidentNodes(
  model: Pick<OpenFem3DModel, "nodes">, toleranceMm: number = OPEN_FEM_3D_MERGE_TOLERANCE_MM,
  scope?: OpenFem3DMergeScope, placedNodeIds?: Iterable<number>,
): OpenFem3DCoincidentGroup[] {
  const tolM = begrensVerbindingstolerantie(toleranceMm) / 1000;
  const nodes = model.nodes;
  if (nodes.length < 2) return [];
  const cel = Math.max(tolM, 1e-6);
  // Een getal per cel (een spreidende hash, geen tekst): twee cellen met
  // dezelfde sleutel kosten alleen een afstandsvergelijking meer, nooit een
  // gemist paar, want elk paar wordt op zijn afstand getoetst.
  const sleutel = (ix: number, iy: number, iz: number) =>
    Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791);
  const index = (v: number) => Math.floor(v / cel);
  const cellen = new Map<number, OpenFem3DNode[]>();
  for (const node of nodes) {
    const k = sleutel(index(node.x), index(node.y), index(node.z));
    const vak = cellen.get(k);
    if (vak) vak.push(node); else cellen.set(k, [node]);
  }
  // Union-find over de knoop-id's.
  const ouder = new Map<number, number>();
  const wortel = (id: number): number => {
    let r = id;
    while (ouder.get(r) !== undefined && ouder.get(r) !== r) r = ouder.get(r)!;
    let c = id;
    while (c !== r) { const v = ouder.get(c)!; ouder.set(c, r); c = v; }
    return r;
  };
  const verbind = (a: number, b: number) => {
    if (!ouder.has(a)) ouder.set(a, a);
    if (!ouder.has(b)) ouder.set(b, b);
    const ra = wortel(a), rb = wortel(b);
    if (ra !== rb) ouder.set(Math.max(ra, rb), Math.min(ra, rb));
  };
  const geplaatst = new Set(placedNodeIds ?? []);
  const automatisch = geplaatst.size > 0;
  const bereik = scope?.nodeIds === undefined ? null : new Set(scope.nodeIds);
  const bronnen = nodes.filter((node) => (!bereik || bereik.has(node.id)) && (!automatisch || geplaatst.has(node.id)));
  for (const p of bronnen) {
    const ix = index(p.x), iy = index(p.y), iz = index(p.z);
    // Automatisch: de dichtstbijzijnde bestaande knoop, niet elke binnen de tolerantie.
    let naaste: OpenFem3DNode | undefined, naasteAfstand = Infinity;
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
      for (const q of cellen.get(sleutel(ix + dx, iy + dy, iz + dz)) ?? []) {
        if (q.id === p.id) continue;
        const d = afstand(p, q);
        if (d > tolM + AFRONDING_M) continue;
        if (!automatisch || geplaatst.has(q.id)) verbind(p.id, q.id);
        else if (d < naasteAfstand || (d === naasteAfstand && q.id < naaste!.id)) { naaste = q; naasteAfstand = d; }
      }
    }
    if (naaste) verbind(p.id, naaste.id);
  }
  if (ouder.size === 0) return [];
  const leden = new Map<number, number[]>();
  for (const id of ouder.keys()) {
    const r = wortel(id);
    const lijst = leden.get(r);
    if (lijst) lijst.push(id); else leden.set(r, [id]);
  }
  const knoopOp = new Map(nodes.map((node) => [node.id, node]));
  const groepen: OpenFem3DCoincidentGroup[] = [];
  for (const lijst of leden.values()) {
    if (lijst.length < 2) continue;
    const nodeIds = [...lijst].sort((a, b) => a - b);
    const keepNodeId = nodeIds.find((id) => !geplaatst.has(id)) ?? nodeIds[0];
    const keep = knoopOp.get(keepNodeId)!;
    let span = 0, verst = 0;
    for (let i = 0; i < nodeIds.length; i += 1) {
      const p = knoopOp.get(nodeIds[i])!;
      verst = Math.max(verst, afstand(p, keep));
      for (let j = i + 1; j < nodeIds.length; j += 1) span = Math.max(span, afstand(p, knoopOp.get(nodeIds[j])!));
    }
    groepen.push({ nodeIds, keepNodeId, spanMm: mm(span), distanceMm: mm(verst) });
  }
  return groepen.sort((a, b) => a.nodeIds[0] - b.nodeIds[0]);
}

/**
 * De knoop binnen `toleranceMm` van een getekend punt, de dichtstbijzijnde
 * (bij gelijke afstand de laagste id); `accept` kan knopen uitsluiten. Het
 * tekenvlak gebruikt dit met de schakelaar aan: een punt binnen de tolerantie
 * van een bestaande knoop wordt die knoop, in plaats van een knoop ernaast
 * die de pijplijn daarna zou moeten samenvoegen.
 */
export function openFem3DNodeNearPoint(
  nodes: readonly OpenFem3DNode[], point: { x: number; y: number; z: number }, toleranceMm: number,
  accept?: (node: OpenFem3DNode) => boolean,
): OpenFem3DNode | undefined {
  const tolM = begrensVerbindingstolerantie(toleranceMm) / 1000;
  let beste: OpenFem3DNode | undefined, besteAfstand = Infinity;
  for (const node of nodes) {
    const d = Math.hypot(node.x - point.x, node.y - point.y, node.z - point.z);
    if (d > tolM + AFRONDING_M) continue;
    if (accept && !accept(node)) continue;
    if (d < besteAfstand || (d === besteAfstand && beste && node.id < beste.id)) { beste = node; besteAfstand = d; }
  }
  return beste;
}

/**
 * Een klik op een staaf in het tekenvlak (raakpunt, voetpunt of snijpunt van
 * de tekenhulp) op `ratio` langs de staaf: ligt dat punt binnen `toleranceMm`
 * van een staafeind, langs de as gemeten zoals de eindmarge van het
 * aansluiten (#63), dan is het die eindknoop (bij een staaf korter dan
 * 2 × de tolerantie het dichtstbijzijnde eind); anders null, en splitst het
 * tekenvlak de staaf daar. Het tekenvlak gebruikt dit met de schakelaar aan.
 * Zonder deze regel knipte het een stompje van een paar millimeter af, dat het
 * automatisch samenvoegen daarna als staaf van lengte 0 met haar lasten
 * weggooide, en begon de volgende klik bij een knoop die niet meer bestond.
 */
export function openFem3DBeamEndNear(
  start: OpenFem3DNode, end: OpenFem3DNode, ratio: number, toleranceMm: number,
): number | null {
  const tolM = begrensVerbindingstolerantie(toleranceMm) / 1000;
  const lengte = afstand(start, end);
  const bijBegin = ratio * lengte <= tolM + AFRONDING_M;
  const bijEind = (1 - ratio) * lengte <= tolM + AFRONDING_M;
  if (bijBegin && (!bijEind || ratio <= 0.5)) return start.id;
  return bijEind ? end.id : null;
}

// ── Eén groep samenvoegen ────────────────────────────────────────────────────

interface GroepUitkomst {
  model: OpenFem3DModel;
  removedBeams: OpenFem3DMergeRemovedBeam[];
  mergedBeams: OpenFem3DMergeMergedBeam[];
  plates: OpenFem3DMergePlate[];
  notes: OpenFem3DMergeNote[];
}

class Weigering {
  constructor(readonly reason: OpenFem3DMergeRefusalReason) {}
}
const weiger = (reason: OpenFem3DMergeRefusalReason): never => { throw new Weigering(reason); };

/** Een JSON-tekst met gesorteerde sleutels: twee objecten vergelijken zonder op de volgorde te letten. */
function vast(value: unknown): string {
  if (value === undefined) return "";
  return JSON.stringify(value, (_key, v) => v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]])) : v);
}

const STIJF: OpenFem3DEndReleases = { myStart: false, myEnd: false, mzStart: false, mzEnd: false, torsionStart: false, torsionEnd: false };

/** De scharnieren van `beam`, met begin en eind gewisseld als zij omgekeerd ligt. */
function scharnieren(beam: OpenFem3DBeam, omgekeerd: boolean): OpenFem3DEndReleases {
  const r = { ...STIJF, ...(beam.releases ?? {}) };
  return omgekeerd
    ? { myStart: r.myEnd, myEnd: r.myStart, mzStart: r.mzEnd, mzEnd: r.mzStart, torsionStart: r.torsionEnd, torsionEnd: r.torsionStart }
    : r;
}

/**
 * De toetsinstellingen als vergelijkbare tekst. De kipsteunposities zijn
 * fracties vanaf de beginknoop: bij een omgekeerde staaf gespiegeld (1 − f),
 * en altijd oplopend, zodat dezelfde steunen in een andere volgorde gelijk zijn.
 */
function toetsinstellingen(beam: OpenFem3DBeam, omgekeerd: boolean): string {
  const config = beam.checkConfig as Record<string, unknown> | undefined;
  if (!config) return "";
  const posities = (value: unknown) => Array.isArray(value)
    ? value.map((f) => typeof f === "number" && omgekeerd ? 1 - f : f).sort((a, b) => Number(a) - Number(b))
    : value;
  return vast({
    ...config,
    ...(config.lateralRestraints !== undefined ? { lateralRestraints: posities(config.lateralRestraints) } : {}),
    ...(config.lateralRestraintsBottom !== undefined ? { lateralRestraintsBottom: posities(config.lateralRestraintsBottom) } : {}),
  });
}

interface Overdracht {
  /** e_y' · e_y en e_z' · e_z van de verdwijnende staaf op de blijvende: elk +1 of −1. */
  sy: 1 | -1;
  sz: 1 | -1;
}

/**
 * Wat er verschilt tussen de blijvende staaf `a` en de staaf `b` die erin
 * opgaat (`omgekeerd`: b loopt van a's eind naar a's begin), en hoe de lokale
 * componenten van b's lasten naar a gaan. De oriëntatie van de doorsnede is
 * gelijk als e_y van b langs e_y van a ligt (in welke zin ook); dan ligt e_z
 * er ook langs, en zijn de lasten exact over te zetten.
 */
function vergelijkStaven(
  a: OpenFem3DBeam, b: OpenFem3DBeam, omgekeerd: boolean, knoopOp: ReadonlyMap<number, OpenFem3DNode>,
): { verschillen: OpenFem3DMergeBeamProperty[]; overdracht: Overdracht } {
  const verschillen: OpenFem3DMergeBeamProperty[] = [];
  // Profiel en verloop (#73) in de richting van a: bij een omgekeerde b is
  // haar eindprofiel het begin. Een ander verloop (ook verlopend tegen
  // prismatisch) is een andere staaf en wordt geweigerd.
  const eindVan = (beam: OpenFem3DBeam) => beam.profileNameEnd ?? beam.profileName ?? "";
  const beginB = omgekeerd ? eindVan(b) : b.profileName ?? "";
  const eindB = omgekeerd ? b.profileName ?? "" : eindVan(b);
  if ((a.profileName ?? "") !== beginB) verschillen.push("profile");
  if ((a.profileNameEnd !== undefined || b.profileNameEnd !== undefined) && eindVan(a) !== eindB) verschillen.push("taper");
  if ((a.material ?? "") !== (b.material ?? "")) verschillen.push("material");
  const assenA = openFem3DMemberAxes(knoopOp.get(a.startNodeId)!, knoopOp.get(a.endNodeId)!, a.rollAngleRad ?? 0);
  const assenB = openFem3DMemberAxes(knoopOp.get(b.startNodeId)!, knoopOp.get(b.endNodeId)!, b.rollAngleRad ?? 0);
  const punt = (p: readonly number[], q: readonly number[]) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const cyy = punt(assenB.ey, assenA.ey), czz = punt(assenB.ez, assenA.ez);
  if (Math.abs(cyy) < ASSEN_GELIJK || Math.abs(czz) < ASSEN_GELIJK) verschillen.push("orientation");
  if (vast(scharnieren(a, false)) !== vast(scharnieren(b, omgekeerd))) verschillen.push("releases");
  if (Boolean(a.tensionOnly) !== Boolean(b.tensionOnly)) verschillen.push("tensionOnly");
  if (vast(a.bedding) !== vast(b.bedding)) verschillen.push("bedding");
  if (toetsinstellingen(a, false) !== toetsinstellingen(b, omgekeerd)) verschillen.push("checkConfig");
  if ((a.group ?? "") !== (b.group ?? "")) verschillen.push("group");
  return { verschillen, overdracht: { sy: cyy < 0 ? -1 : 1, sz: czz < 0 ? -1 : 1 } };
}

/**
 * Een lastpositie op 1e-12 m afgerond. Een staaf die in twee groepen omhangt
 * (eerst het begin, dan het eind), schaalt twee keer; zonder afronding komt een
 * last die op 1 m begon terug als 0,9999999999999999 m.
 */
const opPicometer = (s: number) => Math.round(s * 1e12) / 1e12;

/** s · q zonder −0 (een −0 in het model is onschuldig, maar leest slecht in JSON-vergelijkingen). */
const metTeken = (s: 1 | -1, q: number) => s * q || 0;

/**
 * Een gesloten contour na het samenvoegen: de knopen omgezet met `naar`, twee
 * naburige hoeken die samenvallen worden één hoek (die rand had lengte 0). Een
 * getekende rand (`boundary`) gaat mee: een recht stuk van lengte 0 valt weg,
 * een boog die ontaardt is een fout. `randen` zet het oude randnummer om naar
 * het nieuwe (null = verdwenen), voor de randopleggingen. Fouten: "corners"
 * (minder dan drie hoeken), "loop" (de rand raakt zichzelf), "arc".
 */
function herleidContour(
  loop: readonly number[], boundary: readonly OpenFem3DPlateBoundarySegment[] | undefined, naar: (id: number) => number,
): { loop: number[]; boundary?: OpenFem3DPlateBoundarySegment[]; randen: (number | null)[] } | { fout: "corners" | "loop" | "arc" } {
  const omgezet = loop.map(naar);
  const n = omgezet.length;
  const nieuw: number[] = [];
  const lusRanden: (number | null)[] = [];
  for (let i = 0; i < n; i += 1) {
    if (omgezet[i] === omgezet[(i + 1) % n]) { lusRanden.push(null); continue; }
    lusRanden.push(nieuw.length);
    nieuw.push(omgezet[i]);
  }
  if (new Set(nieuw).size !== nieuw.length) return { fout: "loop" };
  if (nieuw.length < 3) return { fout: "corners" };
  if (!boundary) return { loop: nieuw, randen: lusRanden };
  const segmenten: OpenFem3DPlateBoundarySegment[] = [];
  const randen: (number | null)[] = [];
  for (const segment of boundary) {
    const startNodeId = naar(segment.startNodeId), endNodeId = naar(segment.endNodeId);
    if (segment.kind === "arc") {
      const controlNodeId = naar(segment.controlNodeId);
      if (startNodeId === endNodeId || controlNodeId === startNodeId || controlNodeId === endNodeId) return { fout: "arc" };
      randen.push(segmenten.length);
      segmenten.push({ kind: "arc", startNodeId, controlNodeId, endNodeId });
    } else if (startNodeId === endNodeId) {
      randen.push(null);
    } else {
      randen.push(segmenten.length);
      segmenten.push({ kind: "line", startNodeId, endNodeId });
    }
  }
  if (segmenten.length < 2) return { fout: "corners" };
  return { loop: nieuw, boundary: segmenten, randen };
}

/** Vlak volgens dezelfde regel als de modelpoort (`parseOpenFem3DModel`): normaal uit de eerste bruikbare drie hoeken, schaal × 1e-7. */
function isVlak(points: readonly OpenFem3DNode[]): boolean {
  const a = points[0];
  let normaal: [number, number, number] | null = null;
  for (let i = 1; i < points.length - 1 && !normaal; i += 1) {
    const b = points[i], c = points[i + 1];
    const ab = [b.x - a.x, b.y - a.y, b.z - a.z], ac = [c.x - a.x, c.y - a.y, c.z - a.z];
    const kandidaat: [number, number, number] = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    if (Math.hypot(...kandidaat) > 1e-10) normaal = kandidaat;
  }
  if (!normaal) return false;
  const lengte = Math.hypot(...normaal);
  const schaal = Math.max(1, ...points.map((p) => Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z)));
  return points.every((p) =>
    Math.abs((p.x - a.x) * normaal![0] + (p.y - a.y) * normaal![1] + (p.z - a.z) * normaal![2]) / lengte <= schaal * 1e-7);
}

/** Knopen van een plaat: buitenrand, getekende randen en openingen. */
function plaatKnopen(plate: OpenFem3DPlate): number[] {
  const ids = new Set<number>(plate.nodeIds);
  for (const segment of plate.boundary ?? []) {
    ids.add(segment.startNodeId); ids.add(segment.endNodeId);
    if (segment.kind === "arc") ids.add(segment.controlNodeId);
  }
  for (const opening of plate.openings ?? []) {
    for (const id of opening.nodeIds) ids.add(id);
    for (const segment of opening.boundary ?? []) {
      ids.add(segment.startNodeId); ids.add(segment.endNodeId);
      if (segment.kind === "arc") ids.add(segment.controlNodeId);
    }
  }
  return [...ids];
}

function zonderUitgesloten(panels: OpenFem3DLoadPanel[] | undefined, weg: ReadonlySet<number>): OpenFem3DLoadPanel[] | undefined {
  if (!panels || weg.size === 0) return panels;
  return panels.map((panel) => {
    if (!panel.excludedBeamIds?.some((id) => weg.has(id))) return panel;
    const excludedBeamIds = panel.excludedBeamIds.filter((id) => !weg.has(id));
    const { excludedBeamIds: _weg, ...rest } = panel;
    return excludedBeamIds.length > 0 ? { ...rest, excludedBeamIds } : rest;
  });
}

/**
 * Voeg één groep samen in `model`: `keepId` blijft, de andere knopen van
 * `groep` verdwijnen. Gooit een `Weigering` met de reden als het niet kan; dan
 * blijft het model zoals het was.
 */
function voegGroepSamen(model: OpenFem3DModel, groep: readonly number[], keepId: number): GroepUitkomst {
  const weg = new Set(groep.filter((id) => id !== keepId));
  const inGroep = (id: number) => id === keepId || weg.has(id);
  const naar = (id: number) => weg.has(id) ? keepId : id;
  const knoopOp = new Map(model.nodes.map((node) => [node.id, node]));
  const keep = knoopOp.get(keepId)!;
  const leden = groep.map((id) => knoopOp.get(id)!);
  const notes: OpenFem3DMergeNote[] = [];

  // Levels: verschillende levels weigeren; een knoop zonder level neemt dat
  // van de andere over als hij op dezelfde hoogte ligt.
  const levels = [...new Set(leden.map((node) => node.levelId).filter((id): id is string => id !== undefined))].sort();
  if (levels.length > 1) weiger({ kind: "levels", levelIds: levels });
  let levelId = keep.levelId;
  if (levelId === undefined && levels.length === 1
    && leden.filter((node) => node.levelId === levels[0]).every((node) => Math.abs(node.z - keep.z) <= 1e-9)) {
    levelId = levels[0];
  }
  for (const plate of model.plates ?? []) {
    if (plate.levelId === undefined || plate.levelId === levelId) continue;
    if (plaatKnopen(plate).some(inGroep)) weiger({ kind: "levelPlate", plateId: plate.id, levelId: plate.levelId });
  }

  // Schijven: hoogstens één; een schijf met één knoop verdwijnt.
  let diaphragms = model.diaphragms;
  const schijven = (model.diaphragms ?? []).filter((d) => d.nodeIds.some(inGroep));
  if (schijven.length > 1) weiger({ kind: "diaphragms", diaphragmIds: schijven.map((d) => d.id).sort((a, b) => a - b) });
  if (schijven.length === 1) {
    const schijf = schijven[0];
    const ids = [...new Set(schijf.nodeIds.map(naar))];
    const hoogte = (lijst: readonly number[]) => {
      const zs = lijst.map((id) => knoopOp.get(id)!.z);
      return Math.max(...zs) - Math.min(...zs);
    };
    if (ids.length >= 2 && hoogte(ids) > SCHIJF_HOOGTE_M + AFRONDING_M && hoogte(schijf.nodeIds) <= SCHIJF_HOOGTE_M + AFRONDING_M) {
      weiger({ kind: "diaphragmHeight", diaphragmId: schijf.id });
    }
    if (ids.length >= 2) {
      diaphragms = model.diaphragms!.map((d): OpenFem3DDiaphragm => d.id === schijf.id ? { ...d, nodeIds: ids } : d);
    } else {
      diaphragms = model.diaphragms!.filter((d) => d.id !== schijf.id);
      notes.push({ kind: "diaphragmRemoved", diaphragmId: schijf.id });
    }
  }

  // Opleggingen: blokkeringen samen (OR); twee veren of twee verschillende
  // opgelegde waarden in één richting weigeren; blokkering wint van een veer.
  let supports = model.supports;
  const steunen = (model.supports ?? []).filter((s) => inGroep(s.nodeId));
  if (steunen.length > 0) {
    const geblokkeerd = Object.fromEntries(DOF.map((dof) => [dof, steunen.some((s) => s[dof])])) as Record<OpenFem3DMergeDof, boolean>;
    const springs: OpenFem3DSupportSprings = {};
    const prescribed: OpenFem3DPrescribedDisplacements = {};
    DOF.forEach((dof, i) => {
      const veren = steunen.filter((s) => s.springs?.[VEER[i]] !== undefined);
      if (veren.length > 1) weiger({ kind: "springs", dof });
      const waarden = [...new Set(steunen.filter((s) => s[dof]).map((s) => s.prescribed?.[OPGELEGD[i]] ?? 0))];
      if (waarden.length > 1) weiger({ kind: "prescribed", dof });
      if (geblokkeerd[dof]) {
        if (veren.length === 1) notes.push({ kind: "springOverruled", nodeId: veren[0].nodeId, keepNodeId: keepId, dof });
        if (waarden.length === 1 && waarden[0] !== 0) prescribed[OPGELEGD[i]] = waarden[0];
      } else if (veren.length === 1) {
        springs[VEER[i]] = veren[0].springs![VEER[i]]!;
      }
    });
    const samen: OpenFem3DSupport = {
      nodeId: keepId, ...geblokkeerd,
      ...(Object.keys(springs).length > 0 ? { springs } : {}),
      ...(Object.keys(prescribed).length > 0 ? { prescribed } : {}),
    };
    const eerste = model.supports!.findIndex((s) => inGroep(s.nodeId));
    supports = model.supports!.flatMap((s, i) => i === eerste ? [samen] : inGroep(s.nodeId) ? [] : [s]);
  }

  // Knooplasten gaan naar de blijvende knoop.
  const loads = model.loads?.map((load) => weg.has(load.nodeId) ? { ...load, nodeId: keepId } : load);

  // Staven: omhangen, lengte 0 verdwijnt.
  const lengte = (beam: Pick<OpenFem3DBeam, "startNodeId" | "endNodeId">) =>
    afstand(knoopOp.get(beam.startNodeId)!, knoopOp.get(beam.endNodeId)!);
  const omgehangen = new Map<number, number>(); // id → schaal van de lastposities
  const nul = new Set<number>();
  let beams: OpenFem3DBeam[] = [];
  for (const beam of model.beams) {
    if (!weg.has(beam.startNodeId) && !weg.has(beam.endNodeId)) { beams.push(beam); continue; }
    const startNodeId = naar(beam.startNodeId), endNodeId = naar(beam.endNodeId);
    if (startNodeId === endNodeId) { nul.add(beam.id); continue; }
    const voor = lengte(beam), na = lengte({ startNodeId, endNodeId });
    omgehangen.set(beam.id, na / voor);
    beams.push({ ...beam, startNodeId, endNodeId });
  }
  const lastenOp = (ids: ReadonlySet<number>) =>
    (model.memberLoads ?? []).filter((l) => ids.has(l.beamId)).length
    + (model.memberPointLoads ?? []).filter((l) => ids.has(l.beamId)).length
    + (model.thermalLoads ?? []).filter((l) => ids.has(l.beamId)).length;
  const removedBeams: OpenFem3DMergeRemovedBeam[] = [...nul].sort((a, b) => a - b)
    .map((beamId) => ({ beamId, loadCount: lastenOp(new Set([beamId])) }));
  const schaal = (beamId: number, s: number) => {
    const f = omgehangen.get(beamId);
    return f === undefined || f === 1 ? s : opPicometer(s * f);
  };
  let memberLoads = model.memberLoads?.filter((l) => !nul.has(l.beamId)).map((l): OpenFem3DMemberLoad => {
    const f = omgehangen.get(l.beamId);
    if (f === undefined || f === 1) return l;
    const L = lengte(beams.find((b) => b.id === l.beamId)!);
    return { ...l, startPositionM: Math.min(L, schaal(l.beamId, l.startPositionM)), endPositionM: Math.min(L, schaal(l.beamId, l.endPositionM)) };
  });
  let memberPointLoads = model.memberPointLoads?.filter((l) => !nul.has(l.beamId)).map((l): OpenFem3DMemberPointLoad => {
    const f = omgehangen.get(l.beamId);
    if (f === undefined || f === 1) return l;
    const L = lengte(beams.find((b) => b.id === l.beamId)!);
    return { ...l, positionM: Math.min(L, schaal(l.beamId, l.positionM)) };
  });
  let thermalLoads = model.thermalLoads?.filter((l) => !nul.has(l.beamId));
  let loadPanels = zonderUitgesloten(model.loadPanels, nul);

  // Dubbele staven: dezelfde eindknopen na het omhangen. De laagste id blijft
  // en neemt de lasten van de andere over.
  const perAnder = new Map<number, OpenFem3DBeam[]>();
  for (const beam of beams) {
    if (beam.startNodeId !== keepId && beam.endNodeId !== keepId) continue;
    const ander = beam.startNodeId === keepId ? beam.endNodeId : beam.startNodeId;
    const lijst = perAnder.get(ander);
    if (lijst) lijst.push(beam); else perAnder.set(ander, [beam]);
  }
  const mergedBeams: OpenFem3DMergeMergedBeam[] = [];
  const opgegaan = new Set<number>();
  const blijvers = new Set<number>();
  for (const lijst of perAnder.values()) {
    if (lijst.length < 2 || !lijst.some((beam) => omgehangen.has(beam.id))) continue;
    const [a, ...rest] = [...lijst].sort((p, q) => p.id - q.id);
    const L = lengte(a);
    for (const b of rest) {
      const omgekeerd = b.startNodeId !== a.startNodeId;
      const { verschillen, overdracht: { sy, sz } } = vergelijkStaven(a, b, omgekeerd, knoopOp);
      if (verschillen.length > 0) weiger({ kind: "beamProperties", beamId: a.id, otherBeamId: b.id, properties: verschillen });
      for (const panel of loadPanels ?? []) {
        const exA = panel.excludedBeamIds?.includes(a.id) ?? false, exB = panel.excludedBeamIds?.includes(b.id) ?? false;
        if (exA !== exB) weiger({ kind: "beamExcluded", beamId: a.id, otherBeamId: b.id, panelId: panel.id });
      }
      const spiegel = (s: number) => Math.min(L, Math.max(0, opPicometer(L - s)));
      let aantal = 0;
      memberLoads = memberLoads?.map((l): OpenFem3DMemberLoad => {
        if (l.beamId !== b.id) return l;
        aantal += 1;
        if (isOpenFem3DGlobalMemberLoad(l)) {
          return omgekeerd
            ? { ...l, beamId: a.id, startPositionM: spiegel(l.endPositionM), endPositionM: spiegel(l.startPositionM), qStart: l.qEnd, qEnd: l.qStart }
            : { ...l, beamId: a.id };
        }
        return omgekeerd
          ? {
              ...l, beamId: a.id, startPositionM: spiegel(l.endPositionM), endPositionM: spiegel(l.startPositionM),
              qyStart: metTeken(sy, l.qyEnd), qyEnd: metTeken(sy, l.qyStart), qzStart: metTeken(sz, l.qzEnd), qzEnd: metTeken(sz, l.qzStart),
            }
          : {
              ...l, beamId: a.id,
              qyStart: metTeken(sy, l.qyStart), qyEnd: metTeken(sy, l.qyEnd), qzStart: metTeken(sz, l.qzStart), qzEnd: metTeken(sz, l.qzEnd),
            };
      });
      memberPointLoads = memberPointLoads?.map((l): OpenFem3DMemberPointLoad => {
        if (l.beamId !== b.id) return l;
        aantal += 1;
        return { ...l, beamId: a.id, py: metTeken(sy, l.py), pz: metTeken(sz, l.pz), ...(omgekeerd ? { positionM: spiegel(l.positionM) } : {}) };
      });
      thermalLoads = thermalLoads?.map((l): OpenFem3DThermalLoad => {
        if (l.beamId !== b.id) return l;
        aantal += 1;
        return { ...l, beamId: a.id, deltaTGradientYK: metTeken(sy, l.deltaTGradientYK), deltaTGradientZK: metTeken(sz, l.deltaTGradientZK) };
      });
      opgegaan.add(b.id);
      blijvers.add(a.id);
      mergedBeams.push({ beamId: b.id, intoBeamId: a.id, reversed: omgekeerd, loadCount: aantal });
    }
  }
  if (opgegaan.size > 0) {
    beams = beams.filter((beam) => !opgegaan.has(beam.id));
    loadPanels = zonderUitgesloten(loadPanels, opgegaan);
  }

  // De knopen: de andere knopen verdwijnen; de blijvende houdt zijn plek en krijgt het level.
  const nodes = model.nodes.filter((node) => !weg.has(node.id)).map((node) => {
    if (node.id !== keepId || node.levelId === levelId) return node;
    const { levelId: _oud, ...rest } = node;
    return levelId === undefined ? rest : { ...rest, levelId };
  });
  const nieuwKnoopOp = new Map(nodes.map((node) => [node.id, node]));

  // Platen en openingen.
  const plates: OpenFem3DMergePlate[] = [];
  const nieuwePlaten = model.plates?.map((plate): OpenFem3DPlate => {
    if (!plaatKnopen(plate).some((id) => weg.has(id))) return plate;
    const buiten = herleidContour(plate.nodeIds, plate.boundary, naar);
    if ("fout" in buiten) {
      return weiger({ kind: buiten.fout === "corners" ? "plateCorners" : buiten.fout === "loop" ? "plateLoop" : "plateArc", plateId: plate.id });
    }
    const edgeSupports = plate.edgeSupports?.map((support): OpenFem3DPlateEdgeSupport => {
      const edge = buiten.randen[support.edge];
      if (edge === null || edge === undefined) return weiger({ kind: "plateEdgeSupport", plateId: plate.id, edge: support.edge + 1 });
      return { ...support, edge };
    });
    if (!isVlak(buiten.loop.map((id) => nieuwKnoopOp.get(id)!))) weiger({ kind: "plateNotPlanar", plateId: plate.id });
    let weggevallen = plate.nodeIds.length - buiten.loop.length;
    const openings = plate.openings?.map((opening) => {
      const binnen = herleidContour(opening.nodeIds, opening.boundary, naar);
      if ("fout" in binnen) {
        return weiger({
          kind: binnen.fout === "corners" ? "openingCorners" : binnen.fout === "loop" ? "openingLoop" : "openingArc",
          plateId: plate.id, openingId: opening.id,
        });
      }
      if (!isVlak(binnen.loop.map((id) => nieuwKnoopOp.get(id)!))) weiger({ kind: "openingNotPlanar", plateId: plate.id, openingId: opening.id });
      weggevallen += opening.nodeIds.length - binnen.loop.length;
      const { boundary: _rand, ...rest } = opening;
      return { ...rest, nodeIds: binnen.loop, ...(binnen.boundary ? { boundary: binnen.boundary } : {}) };
    });
    if (weggevallen > 0) plates.push({ plateId: plate.id, corners: buiten.loop.length, removedCorners: weggevallen });
    const { boundary: _rand, edgeSupports: _randen, openings: _openingen, ...rest } = plate;
    return {
      ...rest, nodeIds: buiten.loop,
      ...(buiten.boundary ? { boundary: buiten.boundary } : {}),
      ...(openings ? { openings } : {}),
      ...(edgeSupports?.length ? { edgeSupports } : {}),
    };
  });

  // Belastingvlakken: hoeken omzetten; ongeldig worden (terwijl het klopte) weigeren.
  loadPanels = loadPanels?.map((panel): OpenFem3DLoadPanel => {
    if (!panel.nodeIds.some((id) => weg.has(id))) return panel;
    const lus = herleidContour(panel.nodeIds, undefined, naar);
    if ("fout" in lus) return weiger({ kind: lus.fout === "loop" ? "panelLoop" : "panelCorners", panelId: panel.id });
    const nieuw = { ...panel, nodeIds: lus.loop };
    let klopteVoor = true;
    try { openFem3DLoadPanelGeometry(model, panel, knoopOp); } catch { klopteVoor = false; }
    if (klopteVoor) {
      try { openFem3DLoadPanelGeometry({ nodes }, nieuw, nieuwKnoopOp); }
      catch (cause) { weiger({ kind: "panelInvalid", panelId: panel.id, message: cause instanceof Error ? cause.message : String(cause) }); }
    }
    return nieuw;
  });

  const next: OpenFem3DModel = {
    ...model, nodes, beams,
    ...(supports !== undefined ? { supports } : {}),
    ...(loads !== undefined ? { loads } : {}),
    ...(memberLoads !== undefined ? { memberLoads } : {}),
    ...(memberPointLoads !== undefined ? { memberPointLoads } : {}),
    ...(thermalLoads !== undefined ? { thermalLoads } : {}),
    ...(nieuwePlaten !== undefined ? { plates: nieuwePlaten } : {}),
    ...(loadPanels !== undefined ? { loadPanels } : {}),
    ...(diaphragms !== undefined ? { diaphragms } : {}),
  };

  // De modelpoort over alles wat veranderde: omgehangen en blijvende staven met
  // hun lasten (posities binnen de lengte, bedding tegen de stand), de platen,
  // de oplegging en de schijf. Een proefmodel met alleen die delen houdt dit
  // licht in een groot model.
  const staven = beams.filter((beam) => omgehangen.has(beam.id) || blijvers.has(beam.id));
  const staafIds = new Set(staven.map((beam) => beam.id));
  const geraaktePlaten = (nieuwePlaten ?? []).filter((plate) => plaatKnopen(plate).includes(keepId));
  const geraakteSchijven = (diaphragms ?? []).filter((d) => d.nodeIds.includes(keepId));
  const nodig = new Set<number>([keepId]);
  for (const beam of staven) { nodig.add(beam.startNodeId); nodig.add(beam.endNodeId); }
  for (const plate of geraaktePlaten) for (const id of plaatKnopen(plate)) nodig.add(id);
  for (const d of geraakteSchijven) for (const id of d.nodeIds) nodig.add(id);
  try {
    parseOpenFem3DModel({
      nodes: nodes.filter((node) => nodig.has(node.id)),
      beams: staven,
      supports: (supports ?? []).filter((s) => s.nodeId === keepId),
      memberLoads: (memberLoads ?? []).filter((l) => staafIds.has(l.beamId)),
      memberPointLoads: (memberPointLoads ?? []).filter((l) => staafIds.has(l.beamId)),
      thermalLoads: (thermalLoads ?? []).filter((l) => staafIds.has(l.beamId)),
      plates: geraaktePlaten,
      diaphragms: geraakteSchijven,
    });
  } catch (cause) {
    weiger({ kind: "invalid", message: cause instanceof Error ? cause.message : String(cause) });
  }
  return { model: next, removedBeams, mergedBeams, plates, notes };
}

// ── Het werkmodel ────────────────────────────────────────────────────────────

/**
 * Eén lijst van het model (knopen, staven, lasten …) met vaste plekken: een
 * element dat verdwijnt laat een gat (null), zodat de volgorde van de rest
 * blijft. Met indexen van sleutel (knoop- of staaf-id) naar de plekken die
 * ernaar verwijzen, bijgehouden bij elke wijziging.
 */
class Soort<T> {
  readonly plekken: (T | null)[];
  private gewijzigd = false;
  private readonly indexen: { sleutels: (item: T) => Iterable<number>; per: Map<number, Set<number>> }[];

  constructor(private readonly bron: readonly T[], ...sleutels: ((item: T) => Iterable<number>)[]) {
    this.plekken = [...bron];
    this.indexen = sleutels.map((functie) => ({ sleutels: functie, per: new Map<number, Set<number>>() }));
    if (this.indexen.length > 0) this.plekken.forEach((item, plek) => this.registreer(item!, plek));
  }

  private registreer(item: T, plek: number): void {
    for (const index of this.indexen) {
      for (const sleutel of index.sleutels(item)) {
        const set = index.per.get(sleutel);
        if (set) set.add(plek); else index.per.set(sleutel, new Set([plek]));
      }
    }
  }

  private schrap(item: T, plek: number): void {
    for (const index of this.indexen) for (const sleutel of index.sleutels(item)) index.per.get(sleutel)?.delete(plek);
  }

  /** De plekken die via index `welke` naar een van `sleutels` verwijzen, toegevoegd aan `uit`. */
  zoek(sleutels: Iterable<number>, welke = 0, uit = new Set<number>()): Set<number> {
    const per = this.indexen[welke].per;
    for (const sleutel of sleutels) for (const plek of per.get(sleutel) ?? []) uit.add(plek);
    return uit;
  }

  zet(plek: number, item: T | null): void {
    const oud = this.plekken[plek];
    if (oud === item) return;
    if (oud !== null) this.schrap(oud, plek);
    this.plekken[plek] = item;
    if (item !== null) this.registreer(item, plek);
    this.gewijzigd = true;
  }

  /** De elementen op deze plekken (die er zijn), in volgorde van de plekken. */
  op(plekken: readonly number[]): T[] {
    return plekken.map((plek) => this.plekken[plek]!);
  }

  /** De lijst zoals hij nu is; ongewijzigd dezelfde lijst als het model had. */
  lijst(): T[] {
    return this.gewijzigd ? this.plekken.filter((item): item is T => item !== null) : this.bron as T[];
  }

  get isGewijzigd(): boolean {
    return this.gewijzigd;
  }
}

const oplopend = (plekken: ReadonlySet<number>) => [...plekken].sort((a, b) => a - b);

/** Een interne fout: het deelmodel kwam niet terug zoals het erin ging. */
function klopt(aantal: number, lijst: readonly unknown[] | undefined, wat: string): void {
  if (aantal !== (lijst?.length ?? 0)) throw new Error(`Samenvoegen: ${wat} kwamen niet volledig terug uit het deelmodel.`);
}

/**
 * Het model tijdens `mergeOpenFem3DNodes` (zie GROTE MODELLEN in de
 * module-uitleg): per groep een deelmodel met alleen wat aan de groep hangt,
 * door `voegGroepSamen` met dezelfde regels als op het hele model, en het
 * resultaat terug op de plekken waar het vandaan kwam.
 */
class Werkmodel {
  private readonly nodes: Soort<OpenFem3DNode>;
  private readonly knoopPlek = new Map<number, number>();
  private readonly beams: Soort<OpenFem3DBeam>;
  private readonly supports?: Soort<OpenFem3DSupport>;
  private readonly loads?: Soort<OpenFem3DNodalLoad>;
  private readonly memberLoads?: Soort<OpenFem3DMemberLoad>;
  private readonly memberPointLoads?: Soort<OpenFem3DMemberPointLoad>;
  private readonly thermalLoads?: Soort<OpenFem3DThermalLoad>;
  private readonly plates?: Soort<OpenFem3DPlate>;
  private readonly diaphragms?: Soort<OpenFem3DDiaphragm>;
  private readonly loadPanels?: Soort<OpenFem3DLoadPanel>;

  constructor(private readonly model: OpenFem3DModel) {
    this.nodes = new Soort(model.nodes);
    model.nodes.forEach((node, plek) => this.knoopPlek.set(node.id, plek));
    this.beams = new Soort(model.beams, (beam) => [beam.startNodeId, beam.endNodeId]);
    const opStaaf = (load: { beamId: number }) => [load.beamId];
    if (model.supports) this.supports = new Soort(model.supports, (support) => [support.nodeId]);
    if (model.loads) this.loads = new Soort(model.loads, (load) => [load.nodeId]);
    if (model.memberLoads) this.memberLoads = new Soort(model.memberLoads, opStaaf);
    if (model.memberPointLoads) this.memberPointLoads = new Soort(model.memberPointLoads, opStaaf);
    if (model.thermalLoads) this.thermalLoads = new Soort(model.thermalLoads, opStaaf);
    if (model.plates) this.plates = new Soort(model.plates, plaatKnopen);
    if (model.diaphragms) this.diaphragms = new Soort(model.diaphragms, (d) => d.nodeIds);
    if (model.loadPanels) {
      this.loadPanels = new Soort(model.loadPanels, (panel) => panel.nodeIds, (panel) => panel.excludedBeamIds ?? []);
    }
  }

  /**
   * Voeg één groep samen (`voegGroepSamen` op het deelmodel). Gooit een
   * `Weigering` als het niet kan; dan blijft het werkmodel zoals het was.
   */
  voegSamen(groep: readonly number[], keepId: number): GroepUitkomst {
    // Wat aan de groep hangt: de staven aan een knoop van de groep (ook alle
    // staven aan de blijvende knoop, voor de dubbele staven) met hun lasten,
    // de platen, schijven, belastingvlakken (ook die een van deze staven
    // uitsluiten), opleggingen en knooplasten, en de knopen van dat alles.
    const staafPlekken = oplopend(this.beams.zoek(groep));
    const staven = this.beams.op(staafPlekken);
    const staafIds = staven.map((beam) => beam.id);
    const plekkenVan = <T>(soort: Soort<T> | undefined, sleutels: Iterable<number>) =>
      soort ? oplopend(soort.zoek(sleutels)) : [];
    const plaatPlekken = plekkenVan(this.plates, groep);
    const schijfPlekken = plekkenVan(this.diaphragms, groep);
    const steunPlekken = plekkenVan(this.supports, groep);
    const lastPlekken = plekkenVan(this.loads, groep);
    const lijnPlekken = plekkenVan(this.memberLoads, staafIds);
    const puntPlekken = plekkenVan(this.memberPointLoads, staafIds);
    const warmtePlekken = plekkenVan(this.thermalLoads, staafIds);
    const vlakPlekken = this.loadPanels ? oplopend(this.loadPanels.zoek(staafIds, 1, this.loadPanels.zoek(groep))) : [];
    const platen = this.plates?.op(plaatPlekken) ?? [];
    const schijven = this.diaphragms?.op(schijfPlekken) ?? [];
    const vlakken = this.loadPanels?.op(vlakPlekken) ?? [];
    const knoopIds = new Set<number>(groep);
    for (const beam of staven) { knoopIds.add(beam.startNodeId); knoopIds.add(beam.endNodeId); }
    for (const plate of platen) for (const id of plaatKnopen(plate)) knoopIds.add(id);
    for (const d of schijven) for (const id of d.nodeIds) knoopIds.add(id);
    for (const panel of vlakken) for (const id of panel.nodeIds) knoopIds.add(id);
    const knoopPlekken = oplopend(new Set([...knoopIds].flatMap((id) => {
      const plek = this.knoopPlek.get(id);
      return plek === undefined ? [] : [plek];
    })));
    const deel: OpenFem3DModel = {
      nodes: this.nodes.op(knoopPlekken), beams: staven,
      ...(this.supports ? { supports: this.supports.op(steunPlekken) } : {}),
      ...(this.loads ? { loads: this.loads.op(lastPlekken) } : {}),
      ...(this.memberLoads ? { memberLoads: this.memberLoads.op(lijnPlekken) } : {}),
      ...(this.memberPointLoads ? { memberPointLoads: this.memberPointLoads.op(puntPlekken) } : {}),
      ...(this.thermalLoads ? { thermalLoads: this.thermalLoads.op(warmtePlekken) } : {}),
      ...(this.plates ? { plates: platen } : {}),
      ...(this.diaphragms ? { diaphragms: schijven } : {}),
      ...(this.loadPanels ? { loadPanels: vlakken } : {}),
    };
    const uit = voegGroepSamen(deel, groep, keepId);
    const na = uit.model;

    // Terug op de plekken, in dezelfde volgorde. Wat verdwijnt, volgt uit het
    // verslag met dezelfde regels als in `voegGroepSamen`: de knopen van de
    // groep behalve de blijvende, de staven van lengte 0 en de opgegane
    // staven, de lasten op een staaf van lengte 0, een verwijderde schijf; de
    // samengevoegde oplegging komt op de plek van de eerste.
    const weg = new Set(groep.filter((id) => id !== keepId));
    let i = 0;
    for (const plek of knoopPlekken) {
      const id = this.nodes.plekken[plek]!.id;
      if (weg.has(id)) { this.nodes.zet(plek, null); this.knoopPlek.delete(id); } else this.nodes.zet(plek, na.nodes[i++]);
    }
    klopt(i, na.nodes, "knopen");
    const verdwenen = new Set([...uit.removedBeams.map((b) => b.beamId), ...uit.mergedBeams.map((b) => b.beamId)]);
    i = 0;
    for (const plek of staafPlekken) this.beams.zet(plek, verdwenen.has(this.beams.plekken[plek]!.id) ? null : na.beams[i++]);
    klopt(i, na.beams, "staven");
    const nul = new Set(uit.removedBeams.map((b) => b.beamId));
    const lastenTerug = <T extends { beamId: number }>(soort: Soort<T> | undefined, plekken: readonly number[], lijst: readonly T[] | undefined) => {
      if (!soort) return;
      let j = 0;
      for (const plek of plekken) soort.zet(plek, nul.has(soort.plekken[plek]!.beamId) ? null : lijst![j++]);
      klopt(j, lijst, "staaflasten");
    };
    lastenTerug(this.memberLoads, lijnPlekken, na.memberLoads);
    lastenTerug(this.memberPointLoads, puntPlekken, na.memberPointLoads);
    lastenTerug(this.thermalLoads, warmtePlekken, na.thermalLoads);
    const eenOpEen = <T>(soort: Soort<T> | undefined, plekken: readonly number[], lijst: readonly T[] | undefined) => {
      if (!soort) return;
      klopt(plekken.length, lijst, "elementen");
      plekken.forEach((plek, j) => soort.zet(plek, lijst![j]));
    };
    eenOpEen(this.loads, lastPlekken, na.loads);
    eenOpEen(this.plates, plaatPlekken, na.plates);
    eenOpEen(this.loadPanels, vlakPlekken, na.loadPanels);
    if (this.diaphragms) {
      const geschrapt = new Set(uit.notes.flatMap((note) => note.kind === "diaphragmRemoved" ? [note.diaphragmId] : []));
      let j = 0;
      for (const plek of schijfPlekken) this.diaphragms.zet(plek, geschrapt.has(this.diaphragms.plekken[plek]!.id) ? null : na.diaphragms![j++]);
      klopt(j, na.diaphragms, "schijven");
    }
    if (this.supports && steunPlekken.length > 0) {
      klopt(1, na.supports, "opleggingen");
      steunPlekken.forEach((plek, j) => this.supports!.zet(plek, j === 0 ? na.supports![0] : null));
    }
    return uit;
  }

  /** Het model na alle groepen; ongewijzigde lijsten blijven dezelfde lijst. */
  alsModel(): OpenFem3DModel {
    const uit: OpenFem3DModel = { ...this.model, nodes: this.nodes.lijst(), beams: this.beams.lijst() };
    if (this.supports?.isGewijzigd) uit.supports = this.supports.lijst();
    if (this.loads?.isGewijzigd) uit.loads = this.loads.lijst();
    if (this.memberLoads?.isGewijzigd) uit.memberLoads = this.memberLoads.lijst();
    if (this.memberPointLoads?.isGewijzigd) uit.memberPointLoads = this.memberPointLoads.lijst();
    if (this.thermalLoads?.isGewijzigd) uit.thermalLoads = this.thermalLoads.lijst();
    if (this.plates?.isGewijzigd) uit.plates = this.plates.lijst();
    if (this.diaphragms?.isGewijzigd) uit.diaphragms = this.diaphragms.lijst();
    if (this.loadPanels?.isGewijzigd) uit.loadPanels = this.loadPanels.lijst();
    return uit;
  }
}

// ── Samenvoegen ──────────────────────────────────────────────────────────────

/**
 * Voeg de knopen samen die binnen de tolerantie samenvallen (zie de
 * module-uitleg): per groep, de laagste id blijft. Met `nodeIds` alleen de
 * groepen rond die knopen. Met `placedNodeIds` (automatisch) de geplaatste
 * punten op de dichtstbijzijnde bestaande knoop, die blijft; een groep met
 * meer dan één bestaande knoop wordt geweigerd. Een groep breder dan 2 × de
 * tolerantie, of met een conflict, blijft staan en komt met de reden in
 * `refused`. Valt er niets samen te voegen, dan komt hetzelfde model terug.
 */
export function mergeOpenFem3DNodes(model: OpenFem3DModel, options: OpenFem3DMergeOptions = {}): OpenFem3DMergeResult {
  const toleranceMm = begrensVerbindingstolerantie(options.toleranceMm ?? OPEN_FEM_3D_MERGE_TOLERANCE_MM);
  const geplaatst = new Set(options.placedNodeIds ?? []);
  return voegGroepenSamen(model, findOpenFem3DCoincidentNodes(model, toleranceMm, options, geplaatst), toleranceMm, geplaatst);
}

/** De groepen van `findOpenFem3DCoincidentNodes` samenvoegen, een voor een (zie `mergeOpenFem3DNodes`). */
function voegGroepenSamen(
  model: OpenFem3DModel, groepen: readonly OpenFem3DCoincidentGroup[], toleranceMm: number, geplaatst: ReadonlySet<number>,
): OpenFem3DMergeResult {
  const result: OpenFem3DMergeResult = {
    model, groups: [], removedBeams: [], mergedBeams: [], plates: [], notes: [], refused: [], nodeCount: 0,
  };
  const grens = mm(2 * toleranceMm / 1000);
  let werk: Werkmodel | null = null;
  const platenOp = new Map<number, OpenFem3DMergePlate>();
  for (const groep of groepen) {
    const bestaand = geplaatst.size > 0 ? groep.nodeIds.filter((id) => !geplaatst.has(id)) : [];
    if (bestaand.length > 1) {
      result.refused.push({ nodeIds: groep.nodeIds, keepNodeId: groep.keepNodeId, reason: { kind: "existingNodes", existingNodeIds: bestaand } });
      continue;
    }
    if (groep.spanMm > grens + 1e-9) {
      result.refused.push({ nodeIds: groep.nodeIds, keepNodeId: groep.keepNodeId, reason: { kind: "tooWide", spanMm: groep.spanMm, limitMm: grens } });
      continue;
    }
    werk ??= new Werkmodel(model);
    try {
      const uit = werk.voegSamen(groep.nodeIds, groep.keepNodeId);
      const nodeIds = groep.nodeIds.filter((id) => id !== groep.keepNodeId);
      result.groups.push({ keepNodeId: groep.keepNodeId, nodeIds, distanceMm: groep.distanceMm });
      result.nodeCount += nodeIds.length;
      result.removedBeams.push(...uit.removedBeams);
      result.mergedBeams.push(...uit.mergedBeams);
      for (const plate of uit.plates) {
        const eerder = platenOp.get(plate.plateId);
        if (eerder) { eerder.corners = plate.corners; eerder.removedCorners += plate.removedCorners; }
        else { platenOp.set(plate.plateId, plate); result.plates.push(plate); }
      }
      result.notes.push(...uit.notes);
    } catch (cause) {
      if (!(cause instanceof Weigering)) throw cause;
      result.refused.push({ nodeIds: groep.nodeIds, keepNodeId: groep.keepNodeId, reason: cause.reason });
    }
  }
  if (werk && result.groups.length > 0) result.model = werk.alsModel();
  return result;
}

/** Wat de modelcontrole van het 3D-tekenvlak toont over samenvallende knopen. */
export interface OpenFem3DMergeCheck {
  /** De groepen knopen die samenvallen, met de blijvende knoop. */
  groups: OpenFem3DCoincidentGroup[];
  /** De groepen die Samenvoegen niet kan samenvoegen, met de reden. */
  refused: OpenFem3DMergeRefusal[];
  /** Hoeveel knopen Samenvoegen laat verdwijnen; 0 = de knop zou niets doen. */
  mergeable: number;
}

/**
 * De modelcontrole (issue #75): de groepen samenvallende knopen in het hele
 * model, en welke Samenvoegen niet kan samenvoegen. Een proef zonder lasten:
 * die beslissen nooit of een groep doorgaat, en zo blijft de proef licht.
 */
export function openFem3DMergeCheck(model: OpenFem3DModel, toleranceMm: number = OPEN_FEM_3D_MERGE_TOLERANCE_MM): OpenFem3DMergeCheck {
  const tolerantie = begrensVerbindingstolerantie(toleranceMm);
  const groups = findOpenFem3DCoincidentNodes(model, tolerantie);
  if (groups.length === 0) return { groups, refused: [], mergeable: 0 };
  const zonderLasten: OpenFem3DModel = { ...model, loads: [], memberLoads: [], memberPointLoads: [], thermalLoads: [], surfaceLoads: [] };
  const proef = voegGroepenSamen(zonderLasten, groups, tolerantie, new Set());
  return { groups, refused: proef.refused, mergeable: proef.nodeCount };
}

// ── De app: bereik, knop, selectie en melding ───────────────────────────────

/**
 * Voor welke knopen de lintknop werkt: de geselecteerde knopen, de begin- en
 * eindknopen van geselecteerde staven en de hoeken van geselecteerde platen
 * (die bestaan), of `undefined` (het hele model) zonder knoop, staaf of plaat
 * in de selectie. `count`: het aantal gekozen knopen, staven en platen.
 */
export function openFem3DMergeScope(
  model: Pick<OpenFem3DModel, "nodes" | "beams" | "plates">, selection: OpenFem3DSelection,
): { nodeIds: number[]; count: number } | undefined {
  if (!selection) return undefined;
  const knopen = new Set(model.nodes.map((node) => node.id));
  const staafOp = new Map(model.beams.map((beam) => [beam.id, beam]));
  const plaatOp = new Map((model.plates ?? []).map((plate) => [plate.id, plate]));
  const gekozenKnopen = (selection.type === "node" ? [selection.id] : selection.type === "multi" ? selection.nodeIds : []).filter((id) => knopen.has(id));
  const gekozenStaven = (selection.type === "beam" ? [selection.id] : selection.type === "multi" ? selection.beamIds : []).filter((id) => staafOp.has(id));
  const gekozenPlaten = (selection.type === "plate" ? [selection.id] : selection.type === "multi" ? selection.plateIds ?? [] : []).filter((id) => plaatOp.has(id));
  const count = new Set(gekozenKnopen).size + new Set(gekozenStaven).size + new Set(gekozenPlaten).size;
  if (count === 0) return undefined;
  const nodeIds = new Set(gekozenKnopen);
  for (const id of gekozenStaven) { const beam = staafOp.get(id)!; nodeIds.add(beam.startNodeId); nodeIds.add(beam.endNodeId); }
  for (const id of gekozenPlaten) for (const nodeId of plaatKnopen(plaatOp.get(id)!)) nodeIds.add(nodeId);
  return { nodeIds: [...nodeIds].filter((id) => knopen.has(id)), count };
}

/** Waar het samenvoegen gebeurde, voor de melding. */
export interface OpenFem3DMergeMessageContext {
  scope: "selection" | "all" | "auto";
  /** Bij "selection": het aantal gekozen knopen, staven en platen. */
  count?: number;
  /** De tolerantie in mm. */
  toleranceMm: number;
}

/** Eén handeling van de app met samenvoegen: het model (één stap ongedaan maken), het verslag en de context. */
export interface OpenFem3DMergeStep {
  model: OpenFem3DModel;
  result: OpenFem3DMergeResult;
  context: OpenFem3DMergeMessageContext;
}

/**
 * De lintknop Knopen samenvoegen (`bereik` "selectie": de selectie volgens
 * `openFem3DMergeScope`, of het hele model zonder knoop, staaf of plaat erin)
 * en de knop Samenvoegen in de modelcontrole ("model": altijd het hele
 * model). Een opdracht, dus los van de schakelaar; de tolerantie is de
 * verbindingstolerantie in mm uit de snapinstellingen. Altijd een verslag.
 */
export function openFem3DMergeButton(
  model: OpenFem3DModel, selection: OpenFem3DSelection, snap: { verbindingsTolerantie: number }, bereik: "selectie" | "model",
): OpenFem3DMergeStep {
  const toleranceMm = snap.verbindingsTolerantie;
  const scope = bereik === "selectie" ? openFem3DMergeScope(model, selection) : undefined;
  const result = mergeOpenFem3DNodes(model, { toleranceMm, ...(scope ? { nodeIds: scope.nodeIds } : {}) });
  return {
    model: result.model, result,
    context: scope ? { scope: "selection", count: scope.count, toleranceMm } : { scope: "all", toleranceMm },
  };
}

/**
 * De selectie na een samenvoeging: een verdwenen knoop wordt de knoop waarin
 * hij opging, een verdwenen (dubbele) staaf de staaf die bleef; een staaf van
 * lengte 0 valt weg. Zo blijft na een verplaatsing op een bestaande knoop die
 * knoop geselecteerd in plaats van niets. Zonder samenvoeging dezelfde selectie.
 */
export function openFem3DSelectionAfterMerge(
  selection: OpenFem3DSelection, merge: Pick<OpenFem3DMergeResult, "groups" | "mergedBeams" | "removedBeams"> | null,
): OpenFem3DSelection {
  if (!selection || !merge || (merge.groups.length === 0 && merge.mergedBeams.length === 0 && merge.removedBeams.length === 0)) return selection;
  const knoopNaar = new Map<number, number>();
  for (const groep of merge.groups) for (const id of groep.nodeIds) knoopNaar.set(id, groep.keepNodeId);
  const staafNaar = new Map<number, number | null>(merge.mergedBeams.map((b) => [b.beamId, b.intoBeamId]));
  for (const b of merge.removedBeams) staafNaar.set(b.beamId, null);
  const knopen = (ids: readonly number[]) => [...new Set(ids.map((id) => knoopNaar.get(id) ?? id))];
  const staven = (ids: readonly number[]) => [...new Set(ids.flatMap((id) => {
    const naar = staafNaar.get(id);
    return naar === undefined ? [id] : naar === null ? [] : [naar];
  }))];
  if (selection.type === "node") {
    const naar = knoopNaar.get(selection.id);
    return naar === undefined ? selection : { type: "node", id: naar };
  }
  if (selection.type === "beam") {
    const naar = staafNaar.get(selection.id);
    return naar === undefined ? selection : naar === null ? null : { type: "beam", id: naar };
  }
  if (selection.type !== "multi") return selection;
  const nodeIds = knopen(selection.nodeIds), beamIds = staven(selection.beamIds);
  if (nodeIds.length === selection.nodeIds.length && beamIds.length === selection.beamIds.length
    && nodeIds.every((id, i) => id === selection.nodeIds[i]) && beamIds.every((id, i) => id === selection.beamIds[i])) return selection;
  return { ...selection, nodeIds, beamIds };
}

/** Een regel van een melding: een i18n-sleutel, met het aantal en waarden; `lists` zijn lijsten i18n-sleutels die vertaald en met komma's worden ingevuld. */
export interface OpenFem3DMergeMessagePart {
  key: string;
  count?: number;
  values?: Record<string, string | number>;
  lists?: Record<string, string[]>;
}

/** Zoveel groepen (en weigeringen) noemt de melding bij naam; de rest als "en nog …". */
const IN_MELDING = 6;
const lijstTekst = (ids: readonly number[]) => ids.join(", ");
const mmTekst = (waarde: number) => String(Math.round(waarde * 100) / 100);

/**
 * Een level zoals de gebruiker het kent: de naam (of de peilmaat) met de
 * hoogte in mm, uit de levels van het stramien. Een onbekend level houdt zijn
 * id. Het API-verslag houdt de id's; dit is alleen voor de melding en de
 * modelcontrole.
 */
function levelTekst(levelId: string, levels: readonly OpenFem3DLevel[]): string {
  const level = levels.find((item) => item.id === levelId);
  return level ? `${openFem3DLevelName(level)} (${mmTekst(level.position)} mm)` : levelId;
}

/**
 * De regel voor een geweigerde groep, met de reden: dezelfde regel in de
 * melding en de modelcontrole. `levels` (de levels van het stramien) zet
 * level-id's om naar hun naam en hoogte.
 */
export function openFem3DMergeRefusalPart(
  refusal: OpenFem3DMergeRefusal, levels: readonly OpenFem3DLevel[] = [],
): OpenFem3DMergeMessagePart {
  const r = refusal.reason;
  const basis = { nodes: lijstTekst(refusal.nodeIds), keep: refusal.keepNodeId };
  const key = `ribbon:openFem3d.mergeNodesRefusal.${r.kind}`;
  switch (r.kind) {
    case "tooWide": return { key, values: { ...basis, span: mmTekst(r.spanMm), limit: mmTekst(r.limitMm) } };
    case "existingNodes": return { key, values: { ...basis, existing: lijstTekst(r.existingNodeIds) } };
    case "levels": return { key, values: { ...basis, levels: r.levelIds.map((id) => levelTekst(id, levels)).join(", ") } };
    case "levelPlate": return { key, values: { ...basis, plate: r.plateId } };
    case "diaphragms": return { key, values: { ...basis, diaphragms: r.diaphragmIds.join(", ") } };
    case "diaphragmHeight": return { key, values: { ...basis, diaphragm: r.diaphragmId } };
    case "springs": case "prescribed": return { key, values: { ...basis, dof: r.dof } };
    case "beamProperties":
      return {
        key, values: { ...basis, beam: r.beamId, other: r.otherBeamId },
        lists: { properties: r.properties.map((p) => `ribbon:openFem3d.mergeNodesProperty.${p}`) },
      };
    case "beamExcluded": return { key, values: { ...basis, beam: r.beamId, other: r.otherBeamId, panel: r.panelId } };
    case "plateCorners": case "plateLoop": case "plateArc": case "plateNotPlanar": return { key, values: { ...basis, plate: r.plateId } };
    case "openingCorners": case "openingLoop": case "openingArc": case "openingNotPlanar":
      return { key, values: { ...basis, plate: r.plateId, opening: r.openingId } };
    case "plateEdgeSupport": return { key, values: { ...basis, plate: r.plateId, edge: r.edge } };
    case "panelCorners": case "panelLoop": return { key, values: { ...basis, panel: r.panelId } };
    case "panelInvalid": return { key, values: { ...basis, panel: r.panelId, message: r.message } };
    case "invalid": return { key, values: { ...basis, message: r.message } };
  }
}

/** De regel van een notitie (een veer die vervalt, een schijf die verdwijnt). */
export function openFem3DMergeNotePart(note: OpenFem3DMergeNote): OpenFem3DMergeMessagePart {
  return note.kind === "springOverruled"
    ? { key: "ribbon:openFem3d.mergeNodesSpringOverruled", values: { node: note.nodeId, keep: note.keepNodeId, dof: note.dof } }
    : { key: "ribbon:openFem3d.mergeNodesDiaphragmRemoved", values: { diaphragm: note.diaphragmId } };
}

/** De regel van een groep in de modelcontrole: "Knoop 12 valt samen met knoop 5 (3 mm)." */
export function openFem3DMergeGroupPart(group: OpenFem3DCoincidentGroup): OpenFem3DMergeMessagePart {
  const weg = group.nodeIds.filter((id) => id !== group.keepNodeId);
  return {
    key: "ribbon:openFem3d.modelCheck.mergeLine", count: weg.length,
    values: { nodes: lijstTekst(weg), keep: group.keepNodeId, mm: mmTekst(group.distanceMm) },
  };
}

/**
 * De melding na het samenvoegen: hoeveel knopen opgingen in welke (de eerste
 * zes groepen bij naam), welke staven verdwenen (lengte 0) of samengingen
 * (met hun lasten, omgekeerd of niet), welke platen een hoek verloren, de
 * notities (een veer die voor een blokkering wijkt, een schijf die verdwijnt),
 * welke groepen geweigerd zijn en waarom, en waar het gebeurde, met de
 * gebruikte tolerantie in mm (de regel van het bereik, in elke melding). Is
 * niets samengevoegd maar wel iets geweigerd: een waarschuwing met de
 * redenen. Is er niets te doen: een info-melding. `levels` (de levels van het
 * stramien) geeft een weigering om levels de namen in plaats van de id's.
 */
export function openFem3DMergeMessage(
  result: Pick<OpenFem3DMergeResult, "groups" | "removedBeams" | "mergedBeams" | "plates" | "notes" | "refused" | "nodeCount">,
  context: OpenFem3DMergeMessageContext,
  levels: readonly OpenFem3DLevel[] = [],
): { level: "success" | "info" | "warning"; title: OpenFem3DMergeMessagePart; details: OpenFem3DMergeMessagePart[] } {
  const mm = mmTekst(context.toleranceMm);
  const bereik: OpenFem3DMergeMessagePart = context.scope === "selection"
    ? { key: "ribbon:openFem3d.mergeNodesScopeSelection", count: context.count ?? 0, values: { mm } }
    : { key: `ribbon:openFem3d.mergeNodesScope${context.scope === "all" ? "All" : "Auto"}`, values: { mm } };
  const geweigerd: OpenFem3DMergeMessagePart[] = result.refused.slice(0, IN_MELDING).map((refusal) => openFem3DMergeRefusalPart(refusal, levels));
  if (result.refused.length > IN_MELDING) {
    geweigerd.push({ key: "ribbon:openFem3d.mergeNodesMoreRefused", count: result.refused.length - IN_MELDING });
  }
  if (result.groups.length === 0) {
    return result.refused.length > 0
      ? { level: "warning", title: { key: "ribbon:openFem3d.mergeNodesFailed", count: result.refused.length }, details: [...geweigerd, bereik] }
      : { level: "info", title: { key: "ribbon:openFem3d.mergeNodesNone" }, details: [bereik] };
  }
  const details: OpenFem3DMergeMessagePart[] = result.groups.slice(0, IN_MELDING).map((groep) => ({
    key: "ribbon:openFem3d.mergeNodesGroup", count: groep.nodeIds.length,
    values: { nodes: lijstTekst(groep.nodeIds), keep: groep.keepNodeId },
  }));
  if (result.groups.length > IN_MELDING) details.push({ key: "ribbon:openFem3d.mergeNodesMore", count: result.groups.length - IN_MELDING });
  for (const beam of result.removedBeams) {
    details.push({ key: "ribbon:openFem3d.mergeNodesBeamRemoved", count: beam.loadCount, values: { beam: beam.beamId } });
  }
  for (const beam of result.mergedBeams) {
    details.push({
      key: beam.reversed ? "ribbon:openFem3d.mergeNodesBeamMergedReversed" : "ribbon:openFem3d.mergeNodesBeamMerged",
      count: beam.loadCount, values: { beam: beam.beamId, into: beam.intoBeamId },
    });
  }
  for (const plate of result.plates) {
    details.push({ key: "ribbon:openFem3d.mergeNodesPlate", count: plate.removedCorners, values: { plate: plate.plateId, corners: plate.corners } });
  }
  details.push(...result.notes.map(openFem3DMergeNotePart));
  if (result.refused.length > 0) details.push({ key: "ribbon:openFem3d.mergeNodesSkipped", count: result.refused.length }, ...geweigerd);
  details.push(bereik);
  return { level: "success", title: { key: "ribbon:openFem3d.mergeNodesDone", count: result.nodeCount }, details };
}

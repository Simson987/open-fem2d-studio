/**
 * Knopen op staven aansluiten in 3D (issue #63).
 *
 * WAAROM
 * Een knoop die midden op een staaf ligt, zit er in 3D niet vanzelf aan vast:
 * de staaf loopt er ononderbroken langs. Een kolomvoet op een funderingsbalk
 * zweeft dan, of de balk krijgt de kolomlast niet. Bij het nabouwen van een
 * funderingsmodel moest één balk zo 92 keer met de hand gesplitst worden.
 * Deze module vindt zulke knopen en splitst de staven erop, in één keer.
 *
 * DE REGEL ("op de staaf" zoals in 2D, `puntOpStaaf` in lib/modelControle.ts,
 * maar in drie richtingen en met de eindmarge langs de as)
 * Een knoop ligt op een staaf als hij niet haar begin- of eindknoop is, zijn
 * loodrechte afstand tot de staafas hoogstens de verbindingstolerantie is
 * (standaard 5 mm, 0,1–25 mm, dezelfde instelling als in 2D), en zijn
 * projectie op de as verder dan de tolerantie van beide staafeinden ligt
 * (t·L > tol en (1 − t)·L > tol). Die marge voorkomt een stompje: een knoop
 * vlak bij een staafeind is een samenvoeg-geval, geen knip.
 *
 * Anders dan in 2D (daar telt de afstand tot de eindknoop) wordt de marge
 * hier langs de as gemeten. Een knoop net naast de as en vlak bij een eind
 * (bijvoorbeeld 1,5 mm langs de as en 4,9 mm ernaast) ligt dan niet op de
 * staaf. Met de afstand tot de eindknoop zou hij een steil stompje van zo'n
 * 5 mm maken; op een balk met verticale bedding (#106) staat zo'n stompje
 * (bijna) verticaal, en dan weigert het model bij opslaan. Langs de as gemeten
 * is elk deel minstens tol lang en hoogstens 45° steil (afstand ≤ tol naast,
 * > tol langs de as).
 *
 * SPLITSEN
 * Met `splitOpenFem3DBeam` op de bestaande knoop: de lijnlasten (lokaal en
 * globaal, #80), puntlasten, temperatuur, eindscharnieren (begin op het eerste
 * deel, eind op het laatste), profiel, materiaal, rolhoek, trek-alleen,
 * bedding (#106), groep en naam gaan mee. De knoop wordt NIET verschoven:
 * ligt hij net naast de as, dan lopen de delen naar de knoop (de staaf knikt
 * daar onmerkbaar) en schalen de lastposities mee. Meer knopen op één staaf
 * worden op volgorde langs de staaf geknipt; een knoop die te dicht bij het
 * vorige knippunt ligt, of een knip die een bestaande staaf zou verdubbelen
 * (twee staven die elkaar overlappen), wordt overgeslagen en gemeld.
 *
 * AUTOMATISCH
 * `autoConnectOpenFem3DEdit` vergelijkt het model vóór en na een bewerking en
 * sluit alleen aan wat die bewerking raakte: nieuwe of verplaatste knopen, en
 * nieuwe of verplaatste staven (een nieuwe staaf door een bestaande knoop). Een
 * lastwijziging raakt niets, dus een oud project met losse knopen verandert
 * daardoor niet stil; daarvoor is de modelcontrole er, met de knop Aansluiten.
 * Een plaat- of belastingvlakcontour in aanbouw wacht tot de contour sluit:
 * dan doen de knopen van die plaat of dat vlak mee.
 *
 * SAMENVOEGEN EERST (issue #75)
 * Vóór het aansluiten voegt dezelfde stap een getekend, ingevoegd, verplaatst
 * of gekopieerd punt dat binnen de tolerantie van een bestaande knoop valt,
 * samen met die knoop (`mergeOpenFem3DNodes` in `openFem3dSamenvoegen.ts`):
 * de dichtstbijzijnde bestaande knoop blijft, en twee bestaande knopen gaan
 * nooit samen (ook niet als het punt tussen beide ligt). Eerst samenvoegen,
 * dan aansluiten: een punt vlak
 * bij een staafeind is een samenvoeg-geval (de eindmarge hierboven sluit het
 * juist uit van het splitsen), en een staaf die na het samenvoegen naar een
 * andere knoop omhangt, doet daarna mee als gewijzigde staaf. Eén schakelaar
 * voor beide ("Knopen automatisch samenvoegen en aansluiten"): het is dezelfde
 * vraag met dezelfde tolerantie, en met alleen aansluiten aan zou een punt
 * 3 mm naast een staafeind los blijven liggen, tussen beide regels in.
 *
 * DE APP
 * App.tsx roept alleen de stappen hieronder aan, met de snapinstellingen
 * (schakelaar en tolerantie in mm) zoals ze zijn: `openFem3DEditWithAutoConnect`
 * (elke bewerking, de levelwijziging), `openFem3DConnectButton` (lintknop en
 * modelcontrole) en `openFem3DConnectAfterImport`. Zo liggen de schakelaar,
 * de eenheid van de tolerantie en het bereik uit de selectie hier vast en in
 * de unittest, niet verspreid over de bedrading. Na een transformatie zet
 * `openFem3DSelectionAfterConnect` de selectie op alle delen van een
 * gesplitste staaf.
 *
 * Zuiver: geen React, geen Three. Dezelfde functies voor de app (automatisch,
 * lint, modelcontrole) en de API (`model3d.beam.connectNodes`).
 */
import { begrensVerbindingstolerantie, CONTROLE_TOL_MM } from "../../lib/modelControle";
import { splitOpenFem3DBeam, type OpenFem3DBeam, type OpenFem3DModel, type OpenFem3DNode } from "./openFem3dModel";
import { mergeOpenFem3DNodes, openFem3DSelectionAfterMerge, type OpenFem3DMergeResult } from "./openFem3dSamenvoegen";
import type { OpenFem3DSelection } from "./openFem3dSelection";

/** Standaard verbindingstolerantie in mm; dezelfde als in 2D (issue #55). */
export const OPEN_FEM_3D_CONNECT_TOLERANCE_MM = CONTROLE_TOL_MM;

/** Afrondingsruimte (m) bij het vergelijken met de tolerantie: 5 mm schuin (3 en 4 mm) is nog 5 mm. */
const AFRONDING_M = 1e-12;
/** Binnen deze fractie van de lengte valt een knip op een staafeind (gelijk aan splitOpenFem3DBeam). */
const EIND_RATIO = 1e-6;

/** Een knoop die op een staaf ligt zonder eraan vast te zitten. */
export interface OpenFem3DNodeOnBeam {
  nodeId: number;
  beamId: number;
  /** Projectie op de staafas als fractie van de lengte vanaf de beginknoop, strikt tussen 0 en 1. */
  t: number;
  /** Loodrechte afstand van de knoop tot de staafas, in m. */
  distanceM: number;
}

/**
 * Welke paren (knoop, staaf) meedoen: een paar telt als de knoop in
 * `nodeIds` staat óf de staaf in `beamIds`. Zonder beide: het hele model.
 */
export interface OpenFem3DConnectScope {
  nodeIds?: Iterable<number>;
  beamIds?: Iterable<number>;
}

export interface OpenFem3DConnectSplit {
  /** De oorspronkelijke staaf; haar id blijft bij het eerste deel. */
  beamId: number;
  /** De knopen waarop zij geknipt is, op volgorde langs de staaf. */
  nodeIds: number[];
  /** Alle delen op volgorde langs de staaf, te beginnen met `beamId`. */
  beamIds: number[];
  /** Aantal delen (= beamIds.length). */
  parts: number;
}

export interface OpenFem3DConnectSkip {
  nodeId: number;
  beamId: number;
  /**
   * "nearNode": te dicht bij een ander knippunt (zou een stompje maken);
   * "duplicate": de knip zou een bestaande staaf verdubbelen (overlappende
   * staven); "error": een andere weigering van het splitsen.
   */
  reason: "nearNode" | "duplicate" | "error";
  /** Bij "duplicate": de staaf die verdubbeld zou worden (die de staaf overlapt). */
  otherBeamId?: number;
  /** Bij "nearNode": de knoop (vorig knippunt of staafeind) waar hij te dicht bij ligt. */
  otherNodeId?: number;
  message?: string;
}

export interface OpenFem3DConnectResult {
  /** Het nieuwe model; zonder knip precies het model dat erin ging. */
  model: OpenFem3DModel;
  splits: OpenFem3DConnectSplit[];
  skipped: OpenFem3DConnectSkip[];
  /** Aantal aangesloten knopen (paren knoop–staaf). */
  nodeCount: number;
}

interface Lijn { beam: OpenFem3DBeam; a: OpenFem3DNode; b: OpenFem3DNode; lengte: number }

const afstand = (p: OpenFem3DNode, q: OpenFem3DNode) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);

/** Ligt knoop p op de staaf (zie de regel bovenaan)? Dan t en de afstand tot de as. */
function opStaaf(p: OpenFem3DNode, lijn: Lijn, tolM: number): { t: number; distanceM: number } | null {
  const { beam, a, b, lengte } = lijn;
  if (p.id === beam.startNodeId || p.id === beam.endNodeId) return null;
  if (lengte <= tolM) return null;
  const vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z;
  const px = p.x - a.x, py = p.y - a.y, pz = p.z - a.z;
  const t = (px * vx + py * vy + pz * vz) / (lengte * lengte);
  if (!(t > 0 && t < 1)) return null;
  // De eindmarge langs de as (zie de regel bovenaan).
  if (t * lengte <= tolM + AFRONDING_M || (1 - t) * lengte <= tolM + AFRONDING_M) return null;
  const distanceM = Math.hypot(py * vz - pz * vy, pz * vx - px * vz, px * vy - py * vx) / lengte;
  return distanceM <= tolM + AFRONDING_M ? { t, distanceM } : null;
}

/**
 * Alle paren van `knopen` met `staven`. Een raster over de knopen houdt het
 * snel in een groot model: per staaf alleen de cellen van haar omhullende doos
 * (plus de tolerantie), binnen de doos van de knopen; een staaf die meer
 * cellen beslaat dan er knopen zijn, loopt de knopen gewoon langs. Elke cel
 * heeft een exact volgnummer, dus elke knoop komt per staaf hoogstens één keer
 * langs; de sleutel van een paar wordt pas gemaakt bij een treffer.
 */
function zoekParen(knopen: OpenFem3DNode[], lijnen: Lijn[], tolM: number, uit: Map<string, OpenFem3DNodeOnBeam>): void {
  if (knopen.length === 0 || lijnen.length === 0) return;
  const toets = (p: OpenFem3DNode, lijn: Lijn) => {
    const raak = opStaaf(p, lijn, tolM);
    if (!raak) return;
    const sleutel = `${p.id}:${lijn.beam.id}`;
    if (!uit.has(sleutel)) uit.set(sleutel, { nodeId: p.id, beamId: lijn.beam.id, ...raak });
  };
  if (knopen.length * lijnen.length <= 50_000) {
    for (const lijn of lijnen) for (const p of knopen) toets(p, lijn);
    return;
  }
  // Celgrootte: de mediane staaflengte, minstens tien keer de tolerantie.
  const lengtes = lijnen.map((l) => l.lengte).sort((x, y) => x - y);
  const cel = Math.max(lengtes[Math.floor(lengtes.length / 2)] ?? 1, 10 * tolM, 1e-3);
  const index = (v: number) => Math.floor(v / cel);
  let ix0 = Infinity, iy0 = Infinity, iz0 = Infinity, ix1 = -Infinity, iy1 = -Infinity, iz1 = -Infinity;
  for (const p of knopen) {
    const ix = index(p.x), iy = index(p.y), iz = index(p.z);
    if (ix < ix0) ix0 = ix; if (ix > ix1) ix1 = ix;
    if (iy < iy0) iy0 = iy; if (iy > iy1) iy1 = iy;
    if (iz < iz0) iz0 = iz; if (iz > iz1) iz1 = iz;
  }
  const nx = ix1 - ix0 + 1, ny = iy1 - iy0 + 1;
  const cellen = new Map<number, OpenFem3DNode[]>();
  for (const p of knopen) {
    const sleutel = (index(p.x) - ix0) + nx * ((index(p.y) - iy0) + ny * (index(p.z) - iz0));
    const vak = cellen.get(sleutel);
    if (vak) vak.push(p); else cellen.set(sleutel, [p]);
  }
  for (const lijn of lijnen) {
    const { a, b } = lijn;
    const x0 = Math.max(ix0, index(Math.min(a.x, b.x) - tolM)), x1 = Math.min(ix1, index(Math.max(a.x, b.x) + tolM));
    const y0 = Math.max(iy0, index(Math.min(a.y, b.y) - tolM)), y1 = Math.min(iy1, index(Math.max(a.y, b.y) + tolM));
    const z0 = Math.max(iz0, index(Math.min(a.z, b.z) - tolM)), z1 = Math.min(iz1, index(Math.max(a.z, b.z) + tolM));
    if (x0 > x1 || y0 > y1 || z0 > z1) continue;
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > knopen.length) {
      for (const p of knopen) toets(p, lijn);
      continue;
    }
    for (let iz = z0; iz <= z1; iz += 1) for (let iy = y0; iy <= y1; iy += 1) {
      const rij = nx * ((iy - iy0) + ny * (iz - iz0)) - ix0;
      for (let ix = x0; ix <= x1; ix += 1) {
        const vak = cellen.get(rij + ix);
        if (vak) for (const p of vak) toets(p, lijn);
      }
    }
  }
}

function lijnenVan(beams: readonly OpenFem3DBeam[], knoopOp: ReadonlyMap<number, OpenFem3DNode>): Lijn[] {
  const uit: Lijn[] = [];
  for (const beam of beams) {
    const a = knoopOp.get(beam.startNodeId), b = knoopOp.get(beam.endNodeId);
    if (!a || !b) continue;
    uit.push({ beam, a, b, lengte: afstand(a, b) });
  }
  return uit;
}

/**
 * De knopen die op een staaf liggen zonder eraan vast te zitten: de
 * modelcontrole (één waarschuwing per paar) en de invoer van het aansluiten.
 * Gesorteerd op staaf en dan langs de staaf. `toleranceMm` wordt begrensd op
 * 0,1–25 mm, zoals de instelling.
 */
export function findOpenFem3DNodesOnBeams(
  model: OpenFem3DModel, toleranceMm: number = OPEN_FEM_3D_CONNECT_TOLERANCE_MM, scope?: OpenFem3DConnectScope,
  overslaan: OpenFem3DMeshConnectedSkip = "lintels",
): OpenFem3DNodeOnBeam[] {
  const tolM = begrensVerbindingstolerantie(toleranceMm) / 1000;
  const knoopOp = new Map(model.nodes.map((node) => [node.id, node]));
  const alleLijnen = () => lijnenVan(model.beams, knoopOp);
  const gevonden = new Map<string, OpenFem3DNodeOnBeam>();
  if (!scope || (scope.nodeIds === undefined && scope.beamIds === undefined)) {
    zoekParen(model.nodes, alleLijnen(), tolM, gevonden);
  } else {
    const nodeIds = new Set(scope.nodeIds ?? []);
    const beamIds = new Set(scope.beamIds ?? []);
    if (nodeIds.size > 0) zoekParen(model.nodes.filter((node) => nodeIds.has(node.id)), alleLijnen(), tolM, gevonden);
    if (beamIds.size > 0) zoekParen(model.nodes, lijnenVan(model.beams.filter((beam) => beamIds.has(beam.id)), knoopOp), tolM, gevonden);
  }
  const viaPlaat = doorPlaatnetVerbonden(model, knoopOp, overslaan === "lintels");
  return [...gevonden.values()]
    .filter((paar) => !(paar.distanceM <= PLAATNET_TOL_M && viaPlaat(paar.nodeId, paar.beamId)))
    .sort((p, q) => p.beamId - q.beamId || p.t - q.t || p.nodeId - q.nodeId);
}

/**
 * De maattolerantie van het plaatnet (`TOL * 10` in openFem3dPlateMesh.ts):
 * daarbinnen ligt een staaf in het plaatvlak en een plaatknoop op de staafas.
 */
const PLAATNET_TOL_M = 1e-5;

/**
 * Welke paren die het plaatnet al verbindt `findOpenFem3DNodesOnBeams`
 * overslaat. "lintels" (standaard, ook voor Aansluiten en het automatisch
 * aansluiten): alleen een knoop van de eigen metselwerkwand op een latei; een
 * knip zou de latei (`opening.lintel.beamId`) opdelen. "all" (de
 * modelcontrole en de waarschuwing bij het rekenen): elke plaatknoop op een
 * staaf in het vlak van die plaat. Aansluiten mag zo'n gewone staaf wel
 * splitsen (de hoek van een getekende plaat op een staaf, #63): dat
 * verandert de rekenuitkomst niet, maar het is ook geen losse knoop.
 */
export type OpenFem3DMeshConnectedSkip = "lintels" | "all";

/**
 * Of het plaatnet een knoop al met een staaf verbindt (vondst bij de
 * lateien van de metselwerkwand, #97). Een staaf in het vlak van een plaat
 * krijgt bij het rekenen de knopen van die plaat op haar as als tussenknopen
 * (`beamIntermediateNodes` in openFem3dPlateMesh.ts); een latei hangt daarna
 * met knoopkoppelingen aan precies die knopen (`withOpenFem3DLintelLinks`).
 * De hoeken van een opening onder een latei zijn dus wél verbonden, en een
 * knip zou de latei (`opening.lintel.beamId`) zelfs opdelen. Zulke paren zijn
 * geen losse knoop: de modelcontrole, de waarschuwing bij het rekenen en
 * Aansluiten slaan ze over. Alleen exact (binnen de nettolerantie): een knoop
 * die er millimeters naast ligt, koppelt het net niet en blijft een vondst.
 */
function doorPlaatnetVerbonden(
  model: OpenFem3DModel, knoopOp: Map<number, OpenFem3DNode>, alleenLateien: boolean,
): (nodeId: number, beamId: number) => boolean {
  const platen = (model.plates ?? []).map((plate) => {
    const ids = new Set([...plate.nodeIds, ...(plate.openings ?? []).flatMap((opening) => opening.nodeIds)]);
    const lateien = new Set((plate.openings ?? []).flatMap((opening) => opening.lintel ? [opening.lintel.beamId] : []));
    const punten = plate.nodeIds.map((id) => knoopOp.get(id)).filter((p): p is OpenFem3DNode => p !== undefined);
    // Newell-normaal van de buitencontour.
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < punten.length; i += 1) {
      const p = punten[i]!, q = punten[(i + 1) % punten.length]!;
      nx += (p.y - q.y) * (p.z + q.z);
      ny += (p.z - q.z) * (p.x + q.x);
      nz += (p.x - q.x) * (p.y + q.y);
    }
    const n = Math.hypot(nx, ny, nz);
    const normaal = n > 1e-12 ? [nx / n, ny / n, nz / n] as const : undefined;
    const contour = (nodeIds: readonly number[]) => nodeIds.map((id) => knoopOp.get(id)).filter((q): q is OpenFem3DNode => q !== undefined);
    return {
      ids, lateien, origin: punten[0], normaal,
      buiten: punten, openingen: (plate.openings ?? []).map((opening) => contour(opening.nodeIds)),
    };
  }).filter((plaat) => plaat.origin !== undefined && plaat.normaal !== undefined
    && (!alleenLateien || plaat.lateien.size > 0));
  if (platen.length === 0) return () => false;
  const staafOp = new Map(model.beams.map((beam) => [beam.id, beam]));
  return (nodeId, beamId) => {
    const beam = staafOp.get(beamId);
    const a = beam && knoopOp.get(beam.startNodeId), b = beam && knoopOp.get(beam.endNodeId);
    if (!a || !b) return false;
    const knoop = knoopOp.get(nodeId);
    return platen.some(({ ids, lateien, origin, normaal, buiten, openingen }) => {
      if (alleenLateien && !lateien.has(beamId)) return false;
      const afstand = (p: OpenFem3DNode) =>
        Math.abs((p.x - origin!.x) * normaal![0] + (p.y - origin!.y) * normaal![1] + (p.z - origin!.z) * normaal![2]);
      if (afstand(a) > PLAATNET_TOL_M || afstand(b) > PLAATNET_TOL_M) return false;
      if (ids.has(nodeId)) return true;
      // Niet alleen de hoekknopen: het plaatnet neemt elke modelknoop in het
      // plaatvlak op die op de rand of binnen de plaat ligt (en niet binnen een
      // opening), en geeft hem aan een staaf in dat vlak als tussenknoop
      // (openFem3dPlateMesh.ts, "Modelknopen in het veld"). Een paalknoop midden
      // op de onderrand van een wand onder een funderingsbalk is zo verbonden
      // (examples/masonry-house vóór 64b4f0c1: de reacties waren gelijk met en
      // zonder knip).
      if (alleenLateien || !knoop || afstand(knoop) > PLAATNET_TOL_M) return false;
      return ligtInPlaat(knoop, normaal!, buiten, openingen);
    });
  };
}

/**
 * Ligt `p` (in het plaatvlak) op de rand of binnen de buitencontour, en niet
 * strikt binnen een opening? Op een rand = binnen PLAATNET_TOL_M. In het vlak
 * geprojecteerd langs de grootste normaalcomponent; een boog telt als de
 * veelhoek van haar contourknopen.
 */
function ligtInPlaat(
  p: OpenFem3DNode, normaal: readonly [number, number, number],
  buiten: readonly OpenFem3DNode[], openingen: readonly (readonly OpenFem3DNode[])[],
): boolean {
  const as = [0, 1, 2].reduce((m, i) => (Math.abs(normaal[i]!) > Math.abs(normaal[m]!) ? i : m), 0);
  const plat = (q: OpenFem3DNode): [number, number] => as === 0 ? [q.y, q.z] : as === 1 ? [q.x, q.z] : [q.x, q.y];
  // Schaal van de projectie: een afstand in het vlak wordt × |n_as| kleiner.
  const tol = PLAATNET_TOL_M * Math.abs(normaal[as]!) + 1e-12;
  const [x, y] = plat(p);
  const opRand = (veelhoek: readonly OpenFem3DNode[]) => veelhoek.some((q, i) => {
    const [ax, ay] = plat(q), [bx, by] = plat(veelhoek[(i + 1) % veelhoek.length]!);
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    return Math.hypot(x - ax - t * dx, y - ay - t * dy) <= tol;
  });
  const binnen = (veelhoek: readonly OpenFem3DNode[]) => {
    let in_ = false;
    for (let i = 0, j = veelhoek.length - 1; i < veelhoek.length; j = i++) {
      const [xi, yi] = plat(veelhoek[i]!), [xj, yj] = plat(veelhoek[j]!);
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) in_ = !in_;
    }
    return in_;
  };
  if (buiten.length < 3 || !(opRand(buiten) || binnen(buiten))) return false;
  return !openingen.some((o) => o.length >= 3 && binnen(o) && !opRand(o));
}

/** De staaf die een knip van `deel` op knoop `nodeId` zou verdubbelen: dezelfde toets als `splitOpenFem3DBeam`. */
function verdubbeldeStaaf(model: OpenFem3DModel, deel: OpenFem3DBeam, nodeId: number): number | undefined {
  const verbindt = (beam: OpenFem3DBeam, p: number, q: number) =>
    (beam.startNodeId === p && beam.endNodeId === q) || (beam.startNodeId === q && beam.endNodeId === p);
  return model.beams.find((beam) => beam.id !== deel.id
    && (verbindt(beam, deel.startNodeId, nodeId) || verbindt(beam, nodeId, deel.endNodeId)))?.id;
}

/**
 * Knip de gevonden paren (op staaf en langs de staaf gesorteerd, zoals
 * `findOpenFem3DNodesOnBeams` ze geeft): per staaf telkens het resterende
 * tweede deel verder. Een knoop te dicht bij een ander knippunt, of een knip
 * die een bestaande staaf zou verdubbelen (twee staven die elkaar
 * overlappen), wordt overgeslagen, met de knoop of staaf die het verhindert.
 *
 * `bewaarTussendoorsnede` gaat door naar `splitOpenFem3DBeam`: alleen een
 * echte knip zet de gelaste tussendoorsnede van een verlopende stalen staaf
 * (#73) in de bibliotheek; de proefknip van de modelcontrole niet.
 */
function knipOp(
  model: OpenFem3DModel, gevonden: readonly OpenFem3DNodeOnBeam[], tolM: number, bewaarTussendoorsnede = true,
): OpenFem3DConnectResult {
  if (gevonden.length === 0) return { model, splits: [], skipped: [], nodeCount: 0 };
  const perStaaf = new Map<number, OpenFem3DNodeOnBeam[]>();
  for (const paar of gevonden) {
    const lijst = perStaaf.get(paar.beamId);
    if (lijst) lijst.push(paar); else perStaaf.set(paar.beamId, [paar]);
  }
  const knoopOp = new Map(model.nodes.map((node) => [node.id, node]));
  let next = model;
  const splits: OpenFem3DConnectSplit[] = [];
  const skipped: OpenFem3DConnectSkip[] = [];
  for (const [beamId, paren] of perStaaf) {
    // Op volgorde langs de staaf: telkens het tweede (resterende) deel verder knippen.
    let deelId = beamId;
    const nodeIds: number[] = [], beamIds = [beamId];
    for (const paar of paren) {
      const deel = next.beams.find((beam) => beam.id === deelId)!;
      const a = knoopOp.get(deel.startNodeId)!, b = knoopOp.get(deel.endNodeId)!, p = knoopOp.get(paar.nodeId)!;
      const vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z;
      const deelLengte = Math.hypot(vx, vy, vz);
      const ratio = ((p.x - a.x) * vx + (p.y - a.y) * vy + (p.z - a.z) * vz) / (deelLengte * deelLengte);
      // Dezelfde eindmarge langs de as als de regel, nu op het resterende deel.
      const bijBegin = !(ratio * deelLengte > tolM + AFRONDING_M && ratio > EIND_RATIO);
      if (bijBegin || !((1 - ratio) * deelLengte > tolM + AFRONDING_M && ratio < 1 - EIND_RATIO)) {
        skipped.push({ nodeId: paar.nodeId, beamId, reason: "nearNode", otherNodeId: bijBegin ? a.id : b.id });
        continue;
      }
      const dubbel = verdubbeldeStaaf(next, deel, paar.nodeId);
      if (dubbel !== undefined) {
        skipped.push({ nodeId: paar.nodeId, beamId, reason: "duplicate", otherBeamId: dubbel });
        continue;
      }
      try {
        const knip = splitOpenFem3DBeam(next, deelId, ratio, { nodeId: paar.nodeId, bewaarTussendoorsnede });
        next = knip.model;
        deelId = knip.secondBeamId;
        nodeIds.push(paar.nodeId);
        beamIds.push(knip.secondBeamId);
      } catch (cause) {
        skipped.push({ nodeId: paar.nodeId, beamId, reason: "error", message: cause instanceof Error ? cause.message : String(cause) });
      }
    }
    if (nodeIds.length > 0) splits.push({ beamId, nodeIds, beamIds, parts: beamIds.length });
  }
  return { model: next, splits, skipped, nodeCount: splits.reduce((som, split) => som + split.nodeIds.length, 0) };
}

/**
 * Sluit de knopen aan die op een staaf liggen: elke staaf wordt in één keer
 * op al haar knopen gesplitst (zie de module-uitleg). Met `nodeIds` en/of
 * `beamIds` alleen die paren (`OpenFem3DConnectScope`). Geeft het verslag:
 * welke staven in hoeveel delen, en wat er werd overgeslagen. Valt er niets
 * aan te sluiten, dan komt hetzelfde model terug.
 */
export function connectOpenFem3DNodesToBeams(
  model: OpenFem3DModel,
  options: OpenFem3DConnectScope & { toleranceMm?: number } = {},
): OpenFem3DConnectResult {
  const toleranceMm = begrensVerbindingstolerantie(options.toleranceMm ?? OPEN_FEM_3D_CONNECT_TOLERANCE_MM);
  return knipOp(model, findOpenFem3DNodesOnBeams(model, toleranceMm, options), toleranceMm / 1000);
}

/** Wat de modelcontrole van het 3D-tekenvlak toont. */
export interface OpenFem3DConnectCheck {
  /** De knopen die op een staaf liggen zonder verbinding: één regel per paar. */
  findings: OpenFem3DNodeOnBeam[];
  /** De paren die Aansluiten niet kan aansluiten, met de reden (overlap, te dicht bij een knippunt). */
  skipped: OpenFem3DConnectSkip[];
  /** Hoeveel paren Aansluiten wel aansluit; 0 = de knop zou niets doen. */
  connectable: number;
}

/**
 * De modelcontrole (issue #63): de knopen op staven, en welke daarvan de knop
 * Aansluiten niet kan aansluiten. Een proefknip zonder lasten: alleen knopen
 * en staven bepalen of een knip lukt, en zo blijft de proef licht. De proef
 * bewaart geen gelaste tussendoorsneden (#73): de controle loopt bij elke
 * wijziging van knopen of staven, en mag de bibliotheek met eigen doorsneden
 * niet vullen. Een tweede knip in hetzelfde verlopende deel ziet daardoor een
 * onbekende tussendoorsnede; dat geeft geen fout (het deel blijft dan gewoon
 * bestaan), dus het aantal dat Aansluiten kan aansluiten verandert niet.
 */
export function openFem3DConnectCheck(
  model: OpenFem3DModel, toleranceMm: number = OPEN_FEM_3D_CONNECT_TOLERANCE_MM,
): OpenFem3DConnectCheck {
  const findings = findOpenFem3DNodesOnBeams(model, toleranceMm, undefined, "all");
  if (findings.length === 0) return { findings, skipped: [], connectable: 0 };
  const zonderLasten: OpenFem3DModel = { ...model, memberLoads: [], memberPointLoads: [], thermalLoads: [] };
  const proef = knipOp(zonderLasten, findings, begrensVerbindingstolerantie(toleranceMm) / 1000, false);
  return { findings, skipped: proef.skipped, connectable: proef.nodeCount };
}

/**
 * Wat een bewerking aan de geometrie raakte: nieuwe of verplaatste knopen, en
 * staven die nieuw zijn, andere knopen kregen of een verplaatste knoop hebben.
 */
export function openFem3DGeometryChanges(
  before: OpenFem3DModel, after: OpenFem3DModel,
): { nodeIds: number[]; beamIds: number[] } {
  const nodeIds: number[] = [];
  if (before.nodes !== after.nodes) {
    const oud = new Map(before.nodes.map((node) => [node.id, node]));
    for (const node of after.nodes) {
      const was = oud.get(node.id);
      if (!was || was.x !== node.x || was.y !== node.y || was.z !== node.z) nodeIds.push(node.id);
    }
  }
  if (before.beams === after.beams && nodeIds.length === 0) return { nodeIds, beamIds: [] };
  const verplaatst = new Set(nodeIds);
  const oud = new Map(before.beams.map((beam) => [beam.id, beam]));
  const beamIds: number[] = [];
  for (const beam of after.beams) {
    const was = oud.get(beam.id);
    if (!was || was.startNodeId !== beam.startNodeId || was.endNodeId !== beam.endNodeId
      || verplaatst.has(beam.startNodeId) || verplaatst.has(beam.endNodeId)) beamIds.push(beam.id);
  }
  return { nodeIds, beamIds };
}

/** De instelling van het automatisch aansluiten, met de tekengroep van de bewerking. */
export interface OpenFem3DAutoConnectSettings {
  /** De schakelaar "Knopen automatisch samenvoegen en aansluiten" (standaard aan; sinds #75 ook het samenvoegen). */
  enabled: boolean;
  /** De verbindingstolerantie in mm. */
  toleranceMm: number;
  /**
   * De tekengroep van de bewerking: een plaat-, opening- of
   * belastingvlakcontour in aanbouw. Dan alleen de knopen van een plaat of
   * belastingvlak dat met deze bewerking af is (de contour gesloten). De
   * conceptknopen van een open contour zijn nog niet af: een afgebroken schets
   * zou anders een gesplitste staaf achterlaten.
   */
  historyGroup?: string;
}

/** De knopen van platen (met openingen) en belastingvlakken die in `after` nieuw zijn. */
function knopenVanNieuweVlakken(before: OpenFem3DModel, after: OpenFem3DModel): number[] {
  const uit = new Set<number>();
  if (after.plates !== before.plates) {
    const bestond = new Set((before.plates ?? []).map((plate) => plate.id));
    for (const plate of after.plates ?? []) {
      if (bestond.has(plate.id)) continue;
      for (const id of plate.nodeIds) uit.add(id);
      for (const opening of plate.openings ?? []) for (const id of opening.nodeIds) uit.add(id);
    }
  }
  if (after.loadPanels !== before.loadPanels) {
    const bestond = new Set((before.loadPanels ?? []).map((panel) => panel.id));
    for (const panel of after.loadPanels ?? []) if (!bestond.has(panel.id)) for (const id of panel.nodeIds) uit.add(id);
  }
  return [...uit];
}

/**
 * Automatisch aansluiten na een bewerking (`before` → `after`): alleen de
 * paren met een knoop of staaf die de bewerking raakte; binnen een tekengroep
 * alleen de knopen van een plaat of belastingvlak dat net af is. Null als er
 * niets aan te sluiten is (of de schakelaar uit staat); anders het verslag met
 * het aangesloten model, dat de aanroeper als dezelfde stap ongedaan maken
 * opslaat.
 */
export function autoConnectOpenFem3DEdit(
  before: OpenFem3DModel, after: OpenFem3DModel, settings: OpenFem3DAutoConnectSettings,
): OpenFem3DConnectResult | null {
  if (!settings.enabled || before === after) return null;
  const changes = settings.historyGroup
    ? { nodeIds: knopenVanNieuweVlakken(before, after), beamIds: [] }
    : openFem3DGeometryChanges(before, after);
  if (changes.nodeIds.length === 0 && changes.beamIds.length === 0) return null;
  const result = connectOpenFem3DNodesToBeams(after, { ...changes, toleranceMm: settings.toleranceMm });
  return result.splits.length > 0 ? result : null;
}

/**
 * Automatisch samenvoegen na een bewerking (`before` → `after`, issue #75):
 * de knopen die de bewerking neerlegde of verplaatste (binnen een tekengroep
 * de knopen van een plaat of belastingvlak dat net af is), elk met de
 * dichtstbijzijnde bestaande knoop binnen de tolerantie (`placedNodeIds`): die
 * blijft, het getekende of verplaatste punt wordt die knoop. Bestaande knopen
 * onderling raakt dit niet; een punt dat er twee zou verbinden, wordt
 * geweigerd met de reden. Null als er niets samen te voegen of te
 * weigeren valt (of de schakelaar uit staat); anders het verslag, ook als
 * alles geweigerd is (de melding noemt dan de reden).
 */
export function autoMergeOpenFem3DEdit(
  before: OpenFem3DModel, after: OpenFem3DModel, settings: OpenFem3DAutoConnectSettings,
): OpenFem3DMergeResult | null {
  if (!settings.enabled || before === after) return null;
  const nodeIds = settings.historyGroup ? knopenVanNieuweVlakken(before, after) : openFem3DGeometryChanges(before, after).nodeIds;
  if (nodeIds.length === 0) return null;
  const result = mergeOpenFem3DNodes(after, { nodeIds, placedNodeIds: nodeIds, toleranceMm: settings.toleranceMm });
  return result.groups.length > 0 || result.refused.length > 0 ? result : null;
}

/**
 * Voor welke knopen en staven de lintknop werkt: de geselecteerde knopen en
 * staven (die bestaan), met de begin- en eindknopen van die staven, of
 * `undefined` (het hele model) zonder knoop of staaf in de selectie, ook als
 * er alleen een plaat of lasten geselecteerd zijn. Een geselecteerde kolom
 * brengt zo haar voet mee: staat die op een balk, dan wordt de balk daar
 * gesplitst (de handeling uit het issue: kolommen op een funderingsbalk
 * aanklikken). `count` is het aantal gekozen knopen en staven, zonder die
 * eindknopen, voor de melding.
 */
export function openFem3DConnectScope(
  model: Pick<OpenFem3DModel, "nodes" | "beams">, selection: OpenFem3DSelection,
): { nodeIds: number[]; beamIds: number[]; count: number } | undefined {
  const knopen = new Set(model.nodes.map((node) => node.id));
  const staafOp = new Map(model.beams.map((beam) => [beam.id, beam]));
  const gekozenKnopen = [...new Set((selection?.type === "node" ? [selection.id] : selection?.type === "multi" ? selection.nodeIds : [])
    .filter((id) => knopen.has(id)))];
  const beamIds = [...new Set((selection?.type === "beam" ? [selection.id] : selection?.type === "multi" ? selection.beamIds : [])
    .filter((id) => staafOp.has(id)))];
  if (gekozenKnopen.length + beamIds.length === 0) return undefined;
  const nodeIds = new Set(gekozenKnopen);
  for (const id of beamIds) {
    const beam = staafOp.get(id)!;
    if (knopen.has(beam.startNodeId)) nodeIds.add(beam.startNodeId);
    if (knopen.has(beam.endNodeId)) nodeIds.add(beam.endNodeId);
  }
  return { nodeIds: [...nodeIds], beamIds, count: gekozenKnopen.length + beamIds.length };
}

/**
 * De selectie na een bewerking die staven splitste (automatisch aansluiten na
 * verplaatsen, kopiëren, spiegelen of roteren): elke geselecteerde staaf die
 * gesplitst is, wordt vervangen door al haar delen. Anders wijst de selectie
 * alleen het eerste deel aan (dat houdt de oude id), en verplaatst of
 * kopieert de volgende bewerking maar een halve staaf. De knippunten komen
 * niet als losse knopen in de selectie: als eindknopen van de delen doen ze
 * bij een transformatie al mee, en Verwijderen zou anders ook de kolom op
 * zo'n knippunt weghalen. Zonder geselecteerde gesplitste staaf dezelfde
 * selectie terug.
 */
export function openFem3DSelectionAfterConnect(
  selection: OpenFem3DSelection, splits: readonly OpenFem3DConnectSplit[],
): OpenFem3DSelection {
  if (!selection || splits.length === 0) return selection;
  if (selection.type !== "beam" && selection.type !== "multi") return selection;
  const delen = new Map(splits.map((split) => [split.beamId, split.beamIds]));
  const gekozen = selection.type === "beam" ? [selection.id] : selection.beamIds;
  if (!gekozen.some((id) => delen.has(id))) return selection;
  const beamIds = [...new Set(gekozen.flatMap((id) => delen.get(id) ?? [id]))];
  return selection.type === "beam" ? { type: "multi", nodeIds: [], beamIds } : { ...selection, beamIds };
}

/**
 * De snapinstellingen die het aansluiten leest (`useSnapInstellingen`): de
 * schakelaar (sinds #75 ook voor het samenvoegen) en de verbindingstolerantie
 * in mm.
 */
export interface OpenFem3DConnectSnap {
  knopenAansluiten: boolean;
  verbindingsTolerantie: number;
}

/** Waar het aansluiten gebeurde, voor de melding (`openFem3DConnectMessage`). */
export interface OpenFem3DConnectMessageContext {
  scope: "selection" | "all" | "auto" | "import";
  /** Bij "selection": het aantal gekozen knopen en staven. */
  count?: number;
  /** De verbindingstolerantie in mm. */
  toleranceMm: number;
}

/**
 * Eén handeling van de app met aansluiten: het model voor de historie (als
 * één stap ongedaan maken), het verslag (null: niets aangesloten, geen
 * melding) en de context voor de melding.
 */
export interface OpenFem3DConnectStep<Result extends OpenFem3DConnectResult | null = OpenFem3DConnectResult | null> {
  model: OpenFem3DModel;
  result: Result;
  context: OpenFem3DConnectMessageContext;
}

/** Een bewerking met het automatisch samenvoegen en aansluiten: de stap, met ook het verslag van het samenvoegen (#75). */
export interface OpenFem3DAutoEditStep extends OpenFem3DConnectStep {
  /** Het samenvoegen vóór het aansluiten; null: niets samengevoegd of geweigerd. */
  merge: OpenFem3DMergeResult | null;
}

/**
 * Een bewerking uit de app met het automatisch samenvoegen en aansluiten
 * (App.setOpenFem3d en de levelwijziging): met de schakelaar aan eerst de
 * punten die de bewerking binnen de tolerantie van een bestaande knoop legde
 * samengevoegd (#75), dan de knopen die op een staaf liggen aangesloten
 * (#63); anders `after` zelf. De tolerantie komt in mm uit de
 * snapinstellingen. Het model is één stap ongedaan maken.
 */
export function openFem3DEditWithAutoConnect(
  before: OpenFem3DModel, after: OpenFem3DModel, snap: OpenFem3DConnectSnap, historyGroup?: string,
): OpenFem3DAutoEditStep {
  const settings: OpenFem3DAutoConnectSettings = {
    enabled: snap.knopenAansluiten, toleranceMm: snap.verbindingsTolerantie,
    ...(historyGroup !== undefined ? { historyGroup } : {}),
  };
  const merge = autoMergeOpenFem3DEdit(before, after, settings);
  const samengevoegd = merge?.model ?? after;
  const result = autoConnectOpenFem3DEdit(before, samengevoegd, settings);
  return { model: result?.model ?? samengevoegd, result, merge, context: { scope: "auto", toleranceMm: snap.verbindingsTolerantie } };
}

/**
 * De selectie na een bewerking met het automatisch samenvoegen en aansluiten
 * (een transformatie): eerst de verdwenen knopen en staven naar die waarin ze
 * opgingen (`openFem3DSelectionAfterMerge`), dan de gesplitste staven met al
 * hun delen (`openFem3DSelectionAfterConnect`).
 */
export function openFem3DSelectionAfterAutoEdit(
  selection: OpenFem3DSelection, step: Pick<OpenFem3DAutoEditStep, "result" | "merge"> | null | void,
): OpenFem3DSelection {
  if (!step) return selection;
  return openFem3DSelectionAfterConnect(openFem3DSelectionAfterMerge(selection, step.merge), step.result?.splits ?? []);
}

/**
 * De lintknop Knopen aansluiten (`bereik` "selectie": de selectie volgens
 * `openFem3DConnectScope`, of het hele model zonder knoop of staaf erin) en
 * de knop Aansluiten in de modelcontrole ("model": altijd het hele model).
 * Een opdracht, dus los van de schakelaar. Altijd een verslag, ook als er
 * niets aan te sluiten viel (dan zegt de melding dat).
 */
export function openFem3DConnectButton(
  model: OpenFem3DModel, selection: OpenFem3DSelection, snap: Pick<OpenFem3DConnectSnap, "verbindingsTolerantie">,
  bereik: "selectie" | "model",
): OpenFem3DConnectStep<OpenFem3DConnectResult> {
  const toleranceMm = snap.verbindingsTolerantie;
  const scope = bereik === "selectie" ? openFem3DConnectScope(model, selection) : undefined;
  const result = connectOpenFem3DNodesToBeams(model, {
    toleranceMm, ...(scope ? { nodeIds: scope.nodeIds, beamIds: scope.beamIds } : {}),
  });
  return {
    model: result.model, result,
    context: scope ? { scope: "selection", count: scope.count, toleranceMm } : { scope: "all", toleranceMm },
  };
}

/**
 * Na het importeren van een model (een IFC-analysemodel, of 2D omgezet naar
 * 3D): alles aansluiten, alleen met de schakelaar aan. `result` is null met
 * de schakelaar uit of als er niets aan te sluiten viel; het model blijft dan
 * zoals het binnenkwam. Het openen van een eigen project gebruikt dit niet:
 * daar meldt de modelcontrole de losse knopen.
 */
export function openFem3DConnectAfterImport(model: OpenFem3DModel, snap: OpenFem3DConnectSnap): OpenFem3DConnectStep {
  const context: OpenFem3DConnectMessageContext = { scope: "import", toleranceMm: snap.verbindingsTolerantie };
  if (!snap.knopenAansluiten) return { model, result: null, context };
  const result = connectOpenFem3DNodesToBeams(model, { toleranceMm: snap.verbindingsTolerantie });
  return result.model === model ? { model, result: null, context } : { model: result.model, result, context };
}

/** Een regel van een melding: een i18n-sleutel, met het aantal en andere waarden als die er zijn. */
export interface OpenFem3DConnectMessagePart {
  key: string;
  count?: number;
  values?: Record<string, string | number>;
}

/** Zoveel staven (en overgeslagen knopen) noemt de melding bij naam; de rest als "en nog …". */
const STAVEN_IN_MELDING = 6;

/**
 * De regel voor een knoop die niet aangesloten kon worden, met de reden: de
 * staaf overlapt een andere staaf (de knip zou die verdubbelen), of de knoop
 * ligt te dicht bij een ander knippunt. Dezelfde regel in de melding na
 * Aansluiten en in de modelcontrole.
 */
export function openFem3DConnectSkipPart(skip: OpenFem3DConnectSkip): OpenFem3DConnectMessagePart {
  const values = { node: skip.nodeId, beam: skip.beamId };
  if (skip.reason === "duplicate" && skip.otherBeamId !== undefined) {
    return { key: "ribbon:openFem3d.modelCheck.overlap", values: { ...values, other: skip.otherBeamId } };
  }
  if (skip.reason === "nearNode" && skip.otherNodeId !== undefined) {
    return { key: "ribbon:openFem3d.modelCheck.nearNode", values: { ...values, other: skip.otherNodeId } };
  }
  return { key: "ribbon:openFem3d.modelCheck.blocked", values: { ...values, message: skip.message ?? "" } };
}

/**
 * De melding na het aansluiten: hoeveel staven gesplitst zijn en in hoeveel
 * delen (de eerste zes bij naam), welke knopen niet aangesloten konden worden
 * en waarom, en waar het gebeurde: binnen de selectie (`count` = aantal
 * gekozen knopen en staven), in het hele model, automatisch na een bewerking
 * of na het importeren. Kon geen enkele knoop aangesloten worden, dan een
 * waarschuwing met de redenen (niet "geen knoop": de modelcontrole blijft ze
 * immers melden). Is er niets te doen, dan een info-melding met de
 * tolerantie.
 */
export function openFem3DConnectMessage(
  result: Pick<OpenFem3DConnectResult, "splits" | "skipped">,
  context: OpenFem3DConnectMessageContext,
): { level: "success" | "info" | "warning"; title: OpenFem3DConnectMessagePart; details: OpenFem3DConnectMessagePart[] } {
  const bereik: OpenFem3DConnectMessagePart = context.scope === "selection"
    ? { key: "ribbon:openFem3d.connectNodesScopeSelection", count: context.count ?? 0 }
    : { key: `ribbon:openFem3d.connectNodesScope${context.scope === "all" ? "All" : context.scope === "auto" ? "Auto" : "Import"}` };
  const overgeslagen: OpenFem3DConnectMessagePart[] = result.skipped.slice(0, STAVEN_IN_MELDING).map(openFem3DConnectSkipPart);
  // Knopen, niet paren: een knoop op twee overlappende staven telt één keer.
  const overgeslagenKnopen = new Set(result.skipped.map((skip) => skip.nodeId)).size;
  if (result.skipped.length > STAVEN_IN_MELDING) {
    overgeslagen.push({ key: "ribbon:openFem3d.modelCheck.more", count: result.skipped.length - STAVEN_IN_MELDING });
  }
  if (result.splits.length === 0) {
    return result.skipped.length > 0
      ? {
          level: "warning",
          title: { key: "ribbon:openFem3d.connectNodesFailed", count: overgeslagenKnopen },
          details: [...overgeslagen, bereik],
        }
      : {
          level: "info",
          title: { key: "ribbon:openFem3d.connectNodesNone", values: { mm: String(Math.round(context.toleranceMm * 100) / 100) } },
          details: [bereik],
        };
  }
  const details: OpenFem3DConnectMessagePart[] = result.splits.slice(0, STAVEN_IN_MELDING).map((split) => ({
    key: "ribbon:openFem3d.connectNodesBeam", values: { beam: split.beamId, parts: split.parts },
  }));
  if (result.splits.length > STAVEN_IN_MELDING) {
    details.push({ key: "ribbon:openFem3d.connectNodesMore", count: result.splits.length - STAVEN_IN_MELDING });
  }
  if (result.skipped.length > 0) {
    details.push({ key: "ribbon:openFem3d.connectNodesSkipped", count: overgeslagenKnopen }, ...overgeslagen);
  }
  details.push(bereik);
  return { level: "success", title: { key: "ribbon:openFem3d.connectNodesDone", count: result.splits.length }, details };
}

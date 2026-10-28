/**
 * doorgaandeLijn.ts — een door tussenknopen geknipte staaf als ÉÉN staaf
 * toetsen, en de staafeinden benoemen die géén gaffel zijn.
 *
 * HET PROBLEEM (basisaudit nr 29 en het kipgedrag "tussenknoop als gaffel")
 *
 * Zet de gebruiker een knoop op een staaf — voor een puntlast, een
 * aansluiting, of gewoon om te knippen — dan bestaat die staaf in het model
 * uit twee delen. De toetsing zag tot september 2026 twee losse staven, elk
 * met eigen lengte, en nam de tussenknoop stilzwijgend als zijdelingse steun
 * en als gaffel:
 *
 *  - kolomknik: HEA160 S235 van 6 m met N_Ed = 300 kN gaf UC 1,162; met een
 *    knoop op 3 m gaf elk deel λ̄_z = 0,802 en UC 0,500 — 2,3 keer zoveel
 *    knikweerstand zonder dat er een steun bij kwam;
 *  - kip: IPE 300 van 6 m vrij opgelegd gaf UC_kip 0,720; met een knoop op
 *    3 m kreeg elk deel L_st = 3000 mm en UC_kip 0,406;
 *  - doorbuiging: per deel gemeten vanaf de koorde van dát deel, tegen L/n
 *    van dat deel.
 *
 * Een knoop in het rekenvlak steunt de kip loodrecht op het vlak nooit, en
 * de knik in het vlak alleen als iets hem vasthoudt. Zonder oplegging is de
 * fysieke staaf de hele lijn. (Voor de knik bij een knoop waar een andere
 * staaf aansluit: zie KNIK PER VAK hieronder.)
 *
 * DE OPLOSSING
 *
 * Vóór de toetsing worden staven die in elkaars verlengde liggen, dezelfde
 * doorsnede en hetzelfde materiaal hebben en op de gedeelde knoop geen
 * oplegging hebben (dezelfde herkenning als `collinearContinuations`) en
 * waar geen plaat aansluit (`lijnLooptDoor`), tot één VIRTUELE staaf
 * samengevoegd: de lijn van het ene eind naar het andere, met
 *  - de station-arrays van de delen aaneengeregen (krachten, zakking,
 *    rotatie), zodat de kipvelden, de knik en de koorde van de doorbuiging
 *    over de hele lengte gaan;
 *  - de kipsteunen van de delen omgerekend naar fracties van de lijn;
 *  - een opgegeven kniklengte, zeeg of klasse van de delen overgenomen (bij
 *    verschil de ongunstigste, met een notitie).
 *
 * De virtuele staaf krijgt het laagste staafnummer van de delen; de andere
 * delen komen met reden bij de overgeslagen staven. Alles wat de bouwers
 * daarna doen (referentierichting, doorbuiging, kern) ziet gewoon één staaf.
 * De samenvoeging staat altijd in het rapport: als notitie bij de knik, de
 * kip en de doorbuiging van de lijn, en als reden bij elk overgeslagen deel.
 *
 * KNIK PER VAK (controle oktober 2026, K6, issue #188)
 *
 * Een tussenknoop waar een andere staaf aansluit die ergens aan vastzit (een
 * wandstaaf van een vakwerk, een ligger naar een oplegging) deelt de lijn
 * voor de KNIK IN HET VLAK in vakken: zonder opgave krijgt de lijn als L_cr,y
 * de grootste knoopafstand, de systeemlengte tussen de knopen. De bovenrand
 * van het vakwerk van de controle (SHS 100×100×5, vakken van 3 m) kreeg zo
 * L_cr,y = 3000 mm in plaats van 6000 mm (`test-vakwerk-kniklengte.mjs`).
 *
 * LOODRECHT OP HET VLAK (om z) IS ZO'N KNOOP GEEN VAKGRENS (issue #201). Een
 * aansluiting in het vlak van het raamwerk (een ligger, een wandstaaf) houdt
 * de lijn loodrecht op dat vlak niet vanzelf vast. Tot #201 kreeg de lijn om z
 * ook de knoopafstand, als AANNAME in het rapport; voor de vakwerkbovenrand
 * was dat UC 0,278 waar een rand zonder gordingen 0,842 haalt. Om z telt nu
 * alleen wat de lijn loodrecht op het vlak vasthoudt en in een vlak model te
 * zien is:
 *  - een oplegging: die knipt de lijn al (`collinearContinuations`);
 *  - een zijdelingse steun die als zodanig is opgegeven: een kipsteun aan de
 *    boven- ÉN de onderflens op die plaats (een gording, een windverband, een
 *    vloer). De kern leidt L_cr,z daar zelf uit af, net als bij een losse
 *    staaf (`lib/kniklengte.ts`).
 * Een staaf loodrecht op het vlak bestaat in 2D niet. Zonder zo'n steun is
 * L_cr,z de hele lijn; de notitie per knoop zegt dat, en vraagt om een
 * kipsteun aan beide flenzen of een opgegeven L_cr,z als de aansluiting de
 * lijn wél vasthoudt.
 *
 * Voor de KIP en de DOORBUIGING blijft zo'n knoop géén steun en géén gaffel:
 * de kipvelden en de koorde lopen over de hele lijn, en de notitie zegt dat
 * per knoop (basisaudit nr 29). Een eerste oplossing van K6 knipte de lijn op
 * zo'n knoop helemaal; daarmee werd de knoop stil een gaffel voor de kip en
 * viel de zakking van de lijn uit de doorbuigingstoets (een ligger met een
 * paal met vrije kop: kip-UC 2,235 → 1,207, w_fin 1,245 → 0,502).
 *
 * Een staaf waarvan het andere eind vrij is (geen oplegging, plaat of andere
 * staaf), houdt niets vast: haar knoop is ook voor de knik geen vakgrens, en
 * ook geen steunpunt voor de doorbuiging (`steunpuntenOpLijn`).
 *
 * Alleen als BEIDE lijneinden gaffel zijn (zie STAAFEINDEN): bij een VRIJ
 * lijneind (een kolom met een vrije top, een ligger met een overstek) hangt
 * het eindvak niet tussen twee vastgehouden knopen, en de knoopafstand
 * onderschat de kniklengte daar — minstens tweemaal het eindvak, en meer als
 * de knoop ervoor niet star ingeklemd is (kolom HEA200 0–3–7 m met een
 * pendelligger op 3 m: per vak 4 m en UC 0,255, terwijl α_cr in het vlak
 * L_cr,y = 9,54 m geeft). Bij een DOORLOPEND lijneind zou de per-vak-lengte als
 * opgave de weigering van de kern omzeilen. In beide gevallen zet deze module
 * geen kniklengte per vak, en geldt de regel van de kern (review van de
 * samenvoeging 2026.42, `test-vakwerk-kniklengte.mjs`).
 *
 * Een vrijgave of veer op de tussenknoop (een Gerberscharnier) knipt de lijn
 * NIET: de knoop steunt de lijn nergens, en apart getoetst kreeg elk deel een
 * staafeind "Doorlopend", waarop de kern knik en kip weigerde terwijl de
 * status Ok bleef. Het scharnier zit in de krachten; de notitie noemt het,
 * met de kanttekening dat de kniklengte in het vlak dan groter kan zijn dan
 * de lijn. Een plaat op de tussenknoop knipt de lijn wel: een wandschijf
 * houdt de knoop vast zoals een oplegging.
 *
 * STAAFEINDEN (kipgedrag "vrij eind als gaffel")
 *
 * De kern neemt een staafeind als gaffel. Deze module benoemt per staafeind
 * of dat klopt: een eind zonder oplegging en zonder aansluitende staaf is
 * VRIJ (uitkraging, vrijstaande kolom); een eind waar de lijn zonder
 * oplegging doorloopt in een staaf met een ándere doorsnede is DOORLOPEND.
 * Wat de kern daarmee doet staat bij `Staafeind` in de Rust-invoer.
 */
import type { Beam, BeamCheckConfig, Node, Support } from "../components/fem/femTypes";
import type { ElementForces, SolverResult } from "../components/fem/solver/types";
import type { CheckSkip } from "./checkTypes";
import type { Staafeinden } from "./types/steel/Staafeinden";
// Wederzijdse import met de staalbouwer (die roept deze module aan); alleen
// functies, gelezen bij de aanroep — dan zijn beide modules geladen.
import { beamLengthMm, collinearContinuations } from "./steelCheckBuilder";
import { spiegelElementKrachten, spiegelFracties } from "./referentierichting";
import { steunpuntenHeleDoorsnede, TOLERANTIE_STEUNPAAR_MM } from "./kniklengte";

/** Eén deel van een doorgaande lijn, in de volgorde van begin naar eind. */
export interface LijnDeel {
  beam: Beam;
  /** De staaf is tegen de lijnrichting in getekend (from/to omgekeerd). */
  gespiegeld: boolean;
  lengteMm: number;
  /** Afstand van het lijnbegin tot het begin van dit deel (mm). */
  xStartMm: number;
}

/** Wat er op één tussenknoop van een doorgaande lijn gebeurt. */
export interface Tussenknoop {
  knoop: number;
  /** Afstand van het lijnbegin tot de knoop (mm). */
  xMm: number;
  /** Andere staven die hier aansluiten (niet de delen van de lijn), oplopend. */
  aangesloten: number[];
  /**
   * Daarvan de staven waarvan het andere eind ergens aan vastzit (een
   * oplegging, een plaat of nog een staaf): alleen die houden de knoop vast.
   * Niet leeg = de knoop is voor de knik een vakgrens.
   */
  steunend: number[];
  /**
   * De knoop steunt de lijn: een `steunend` aansluiting, of een oplegging of
   * plaat op de knoop zelf. Zo'n knoop is waar een overstek begint
   * (`steunpuntenOpLijn`); een aansluitende staaf telt daarvoor met hetzelfde
   * criterium als voor KNIK PER VAK (`steunend`).
   */
  steunt: boolean;
  /** Vrijgaven en veren van de delen op deze knoop, leesbaar ("staaf 3: scharnier"). */
  los: string[];
}

/** Een doorgaande lijn van twee of meer delen. */
export interface DoorgaandeLijn {
  /** Het staafnummer waaronder de lijn wordt getoetst: het laagste van de delen. */
  id: number;
  delen: LijnDeel[];
  /** De knopen tussen de delen, in volgorde. */
  tussenknopen: number[];
  /** Per tussenknoop (zelfde volgorde) wat er aansluit en wat er los is. */
  knopen: Tussenknoop[];
  from: number;
  to: number;
  lengteMm: number;
}

/** Wat een bouwer nodig heeft om lijnen te herkennen en samen te voegen. */
export interface LijnInvoer {
  nodes: Node[];
  /** De staven die getoetst worden. */
  beams: Beam[];
  supports?: Support[];
  combinationResults: Map<number, SolverResult>;
  /**
   * Alle staven van het model, ook die niet getoetst worden. De herkenning
   * van een doorgaande lijn en van een vrij staafeind kijkt naar het hele
   * model; ontbreekt de lijst, dan gelden `beams` als het hele model.
   */
  alleBeams?: Beam[];
  /**
   * Platen (wandschijven): een knoop in of op een plaat — hoek-, rand- of
   * tussenknoop — is geen vrij eind; zie `knoopInPlaat`.
   */
  plates?: PlaatVoorEinden[];
}

/**
 * Wat de herkenning van een vrij staafeind van een plaat nodig heeft: de
 * hoekknopen en de openingen (een knoop in een opening hangt niet aan de
 * plaat).
 */
export interface PlaatVoorEinden {
  nodeIds: number[];
  openingen?: readonly { punten: readonly { x: number; z: number }[] }[];
}

/**
 * De tolerantie (mm) waarmee een knoop op een plaatrand ligt: dezelfde 1 mm
 * waarmee het rekenmesh bestaande knopen hergebruikt (`findNodeAt`, `TOL_MM`
 * in de engine).
 */
const PLAAT_TOL_MM = 1;

function inVeelhoek(x: number, z: number, poly: readonly { x: number; z: number }[]): boolean {
  let binnen = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) binnen = !binnen;
  }
  return binnen;
}

function afstandTotRand(x: number, z: number, poly: readonly { x: number; z: number }[]): number {
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    min = Math.min(min, Math.hypot(x - (a.x + t * dx), z - (a.z + t * dz)));
  }
  return min;
}

/**
 * Hangt de knoop aan een plaat? Een hoekknoop, maar ook een knoop op de rand of
 * binnen de omtrek: het rekenmesh hergebruikt elke knoop op of in de plaat
 * (binnen 1 mm) als plaatknoop, dus daar is de knoop met de plaat gekoppeld en
 * geen vrij staafeind. Een knoop in een opening (niet op de openingsrand) hangt
 * niet aan de plaat.
 *
 * Tot oktober 2026 telde alleen een hoekknoop: een ligger die midden op een
 * plaatrand eindigde, gold als uitkraging, en kreeg zo een twee keer te ruime
 * doorbuigingsgrens (controle 2026-10, punt K5).
 */
export function knoopInPlaat(
  knoop: { id: number; x: number; z: number },
  nodes: readonly Node[],
  plates: readonly PlaatVoorEinden[] | undefined,
): boolean {
  for (const p of plates ?? []) {
    if (p.nodeIds.includes(knoop.id)) return true;
    const omtrek = p.nodeIds
      .map((id) => nodes.find((n) => n.id === id))
      .filter((n): n is Node => n !== undefined);
    if (omtrek.length < 3) continue;
    const opRand = afstandTotRand(knoop.x, knoop.z, omtrek) <= PLAAT_TOL_MM;
    if (!opRand && !inVeelhoek(knoop.x, knoop.z, omtrek)) continue;
    const inOpening = (p.openingen ?? []).some(
      (o) =>
        o.punten.length >= 3 &&
        inVeelhoek(knoop.x, knoop.z, o.punten) &&
        afstandTotRand(knoop.x, knoop.z, o.punten) > PLAAT_TOL_MM,
    );
    if (!inOpening) return true;
  }
  return false;
}

export interface LijnUitkomst<T extends LijnInvoer> {
  /** Dezelfde invoer, met elke lijn vervangen door haar virtuele staaf. */
  data: T;
  /** Per virtuele staaf de lijn waar hij uit bestaat. */
  lijnen: Map<number, DoorgaandeLijn>;
  /** Per virtuele staaf de toelichting voor `staaf_notities`. */
  notities: Map<number, string[]>;
  /** De delen die niet onder hun eigen nummer worden getoetst, met reden. */
  overgeslagen: CheckSkip[];
  /**
   * Per virtuele staaf de kniklengte per vak IN HET VLAK (KNIK PER VAK), in
   * m, alleen als de delen geen L_cr,y opgeven. De bouwers zetten haar in
   * `buckling_length_y_m` als de staaf zelf geen opgave heeft; zij telt NIET
   * als opgave van de gebruiker. Zij is nooit langer dan de lijn, dus de
   * kanttekening van de kern over een opgegeven L_cr,y > L (dubbele sway)
   * komt er niet door. Om z zet deze module niets (issue #201): zonder opgave
   * leidt de kern L_cr,z af uit de kipsteunen aan beide flenzen van de lijn,
   * anders de hele lijn.
   */
  kniklengtes: Map<number, { yM: number }>;
}

const nl = (v: number, d = 3): string => v.toFixed(d).replace(".", ",");

/**
 * Relatief verschil (t.o.v. de grootste |w| of |θ| van de lijn) waarboven w
 * of θ op een naad "springt". Een starre aansluiting blijft vele ordes
 * eronder (afrondruis), een scharnier ver erboven.
 */
const NAAD_TOL = 1e-9;

function richting(beam: Beam, nodes: Node[]): { x: number; z: number } | null {
  const a = nodes.find((n) => n.id === beam.from);
  const b = nodes.find((n) => n.id === beam.to);
  if (!a || !b) return null;
  const l = Math.hypot(b.x - a.x, b.z - a.z);
  if (l <= 0) return null;
  return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
}

const VRIJHEIDSGRAAD: Record<"Tx" | "Tz" | "Ry", string> = {
  Tx: "vrijgave langs de as",
  Tz: "vrijgave dwars op de as",
  Ry: "scharnier",
};

/** Vrijgaven en veren van dit staafeind op `knoop`, leesbaar; leeg als het star is. */
function losOpKnoop(beam: Beam, knoop: number): string[] {
  const kant = beam.from === knoop ? "start" : beam.to === knoop ? "end" : null;
  if (!kant) return [];
  const releases = beam.releases ?? {};
  const veren = beam.veren ?? {};
  const uit: string[] = [];
  for (const dof of ["Tx", "Tz", "Ry"] as const) {
    const sleutel = `${kant}${dof}` as const;
    const veer = veren[sleutel];
    if (typeof veer === "number" && veer > 0) {
      const eenheid = dof === "Ry" ? "kNm/rad" : "kN/mm";
      uit.push(`staaf ${beam.id}: veer ${dof === "Ry" ? "op de draaiing" : VRIJHEIDSGRAAD[dof]} (${nl(veer, 0)} ${eenheid})`);
    } else if (releases[sleutel] === true) {
      uit.push(`staaf ${beam.id}: ${VRIJHEIDSGRAAD[dof]}`);
    }
  }
  return uit;
}

/**
 * Loopt de lijn door over de gedeelde knoop van twee staven in elkaars
 * verlengde? Niet waar een plaat aansluit: een wandschijf houdt de knoop vast
 * zoals een oplegging (die `collinearContinuations` al uitsluit). Wel waar
 * andere staven aansluiten of een vrijgave of veer zit — zie KNIK PER VAK in
 * de kop.
 */
function lijnLooptDoor(a: Beam, b: Beam, plates: { nodeIds: number[] }[] | undefined): boolean {
  const knoop = [a.from, a.to].find((n) => n === b.from || n === b.to);
  if (knoop === undefined) return false;
  return !(plates ?? []).some((p) => p.nodeIds.includes(knoop));
}

/**
 * Het deel van het model dat ALLEEN aan `knoop` hangt (issue #199: de luifel-
 * of T-kolom). Vanaf `knoop` wordt het model doorlopen over alle staven
 * behalve `uitgesloten` (de staaf of lijn zelf). Komt die tocht bij een
 * oplegging, een knoop in of op een plaat, een staaf op bedding of een knoop
 * uit `verboden` (de andere knopen van de staaf zelf: een gesloten lus), dan
 * hangt het deel ergens aan en is de uitkomst `null`. Anders zweeft het:
 * alles wat er aan `knoop` zit — een uitkragende ligger, een tweede console
 * erachter — draagt alleen zijn eigen last naar `knoop` en houdt hem nergens
 * vast. Knopen in `stop` worden bereikt maar niet verder doorlopen (de voet
 * van een losse kolom). `staafMagNiet` weigert een bereikte staaf (een andere
 * kolomlijn).
 *
 * Uitkomst: de bereikte staven en knopen (zonder `knoop` zelf en zonder de
 * stopknopen), of `null`.
 */
export function hangendDeel(
  knoop: number,
  model: {
    nodes: readonly Node[];
    beams: readonly Beam[];
    supports: readonly { nodeId: number }[];
    plates?: readonly PlaatVoorEinden[];
  },
  uitgesloten: ReadonlySet<number>,
  verboden: ReadonlySet<number> = new Set(),
  stop: ReadonlySet<number> = new Set(),
  staafMagNiet: (b: Beam) => boolean = () => false,
): { staafIds: number[]; knoopIds: number[] } | null {
  const opgelegd = new Set(model.supports.map((s) => s.nodeId));
  const knoopVan = new Map(model.nodes.map((n) => [n.id, n]));
  const vast = (id: number): boolean => {
    if (opgelegd.has(id) || verboden.has(id)) return true;
    const k = knoopVan.get(id);
    return k !== undefined && knoopInPlaat(k, model.nodes, model.plates);
  };
  const staven = new Set<number>();
  const knopen = new Set<number>([knoop]);
  const rij = [knoop];
  while (rij.length > 0) {
    const n = rij.pop()!;
    for (const b of model.beams) {
      if (uitgesloten.has(b.id) || staven.has(b.id) || (b.from !== n && b.to !== n)) continue;
      if (b.bedding || staafMagNiet(b)) return null;
      staven.add(b.id);
      const ander = b.from === n ? b.to : b.from;
      if (knopen.has(ander)) continue;
      knopen.add(ander);
      if (stop.has(ander)) continue;
      if (vast(ander)) return null;
      rij.push(ander);
    }
  }
  knopen.delete(knoop);
  for (const id of stop) knopen.delete(id);
  return { staafIds: [...staven].sort((a, b) => a - b), knoopIds: [...knopen].sort((a, b) => a - b) };
}

/**
 * Wat er op een tussenknoop van een lijn aansluit. Een aansluitende staaf
 * houdt de knoop alleen vast als haar ANDERE eind ergens aan vastzit: een
 * oplegging, een plaat (hoek, rand of binnenin, `knoopInPlaat` — hetzelfde
 * criterium als voor een vrij staafeind), of nog een staaf. Een paal of console
 * met een vrije kop houdt niets vast.
 */
function beschrijfKnoop(
  knoop: number,
  xMm: number,
  delen: LijnDeel[],
  alleBeams: Beam[],
  supports: Support[],
  nodes: Node[],
  plates: readonly PlaatVoorEinden[] | undefined,
): Tussenknoop {
  const inLijn = new Set(delen.map((d) => d.beam.id));
  const opgelegd = new Set(supports.map((s) => s.nodeId));
  const inPlaat = (id: number): boolean => {
    const k = nodes.find((n) => n.id === id);
    return k !== undefined && knoopInPlaat(k, nodes, plates);
  };
  const aangesloten = alleBeams
    .filter((c) => !inLijn.has(c.id) && (c.from === knoop || c.to === knoop))
    .sort((a, b) => a.id - b.id);
  const steunend = aangesloten.filter((c) => {
    const ander = c.from === knoop ? c.to : c.from;
    return opgelegd.has(ander) || inPlaat(ander) || alleBeams.some((d) => d.id !== c.id && (d.from === ander || d.to === ander));
  });
  const los = delen.flatMap((d) => losOpKnoop(d.beam, knoop));
  return {
    knoop,
    xMm,
    aangesloten: aangesloten.map((c) => c.id),
    steunend: steunend.map((c) => c.id),
    steunt: steunend.length > 0 || opgelegd.has(knoop) || inPlaat(knoop),
    los,
  };
}

/**
 * De doorgaande lijnen tussen de staven in `beams`, herkend op het hele
 * model. Zonder opleggingenlijst wordt er niets samengevoegd: dan is een
 * tussensteunpunt niet van een knip te onderscheiden, en samenvoegen over een
 * steunpunt heen zou een doorgaande ligger als één overspanning toetsen.
 * Over een knoop met een plaat loopt een lijn niet door (`lijnLooptDoor`).
 */
export function vindDoorgaandeLijnen(
  beams: Beam[],
  nodes: Node[],
  alleBeams: Beam[],
  supports: Support[] | undefined,
  plates?: PlaatVoorEinden[],
): DoorgaandeLijn[] {
  if (!supports) return [];
  const perId = new Map<number, Beam>(alleBeams.map((b) => [b.id, b]));
  const teToetsen = new Set(beams.map((b) => b.id));
  const gezien = new Set<number>();
  const lijnen: DoorgaandeLijn[] = [];

  for (const start of beams) {
    if (gezien.has(start.id)) continue;
    // Samenhangende component van collineaire vervolgstaven.
    const leden: Beam[] = [];
    const wachtrij = [start];
    gezien.add(start.id);
    while (wachtrij.length > 0) {
      const b = wachtrij.pop()!;
      leden.push(b);
      for (const id of collinearContinuations(b, nodes, alleBeams, supports)) {
        if (gezien.has(id)) continue;
        const other = perId.get(id);
        if (!other || !lijnLooptDoor(b, other, plates)) continue;
        gezien.add(id);
        wachtrij.push(other);
      }
    }
    if (leden.length < 2) continue;
    const dir = richting(start, nodes);
    if (!dir) continue;
    // Volgorde langs de lijn: projectie van de knopen op de richting.
    const proj = (id: number): number => {
      const n = nodes.find((k) => k.id === id)!;
      return n.x * dir.x + n.z * dir.z;
    };
    const geordend = leden
      .map((beam) => {
        const pa = proj(beam.from);
        const pb = proj(beam.to);
        return { beam, gespiegeld: pb < pa, pMin: Math.min(pa, pb) };
      })
      .sort((a, b) => a.pMin - b.pMin);
    const delen: LijnDeel[] = [];
    const tussenknopen: number[] = [];
    const knoopX: number[] = [];
    let x = 0;
    for (let i = 0; i < geordend.length; i++) {
      const { beam, gespiegeld } = geordend[i];
      const lengteMm = beamLengthMm(beam, nodes);
      if (i > 0) {
        tussenknopen.push(gespiegeld ? beam.to : beam.from);
        knoopX.push(x);
      }
      delen.push({ beam, gespiegeld, lengteMm, xStartMm: x });
      x += lengteMm;
    }
    const knopen = tussenknopen.map((k, i) => beschrijfKnoop(k, knoopX[i], delen, alleBeams, supports, nodes, plates));
    const eerste = delen[0];
    const laatste = delen[delen.length - 1];
    // Het nummer waaronder de lijn wordt getoetst: het laagste van de delen
    // die in de te toetsen lijst staan (bij een deelselectie via de MCP-server
    // hoort het antwoord onder een gevraagd nummer te staan).
    const kandidaten = leden.filter((b) => teToetsen.has(b.id)).map((b) => b.id);
    lijnen.push({
      id: Math.min(...(kandidaten.length > 0 ? kandidaten : leden.map((b) => b.id))),
      delen,
      tussenknopen,
      knopen,
      from: eerste.gespiegeld ? eerste.beam.to : eerste.beam.from,
      to: laatste.gespiegeld ? laatste.beam.from : laatste.beam.to,
      lengteMm: x,
    });
  }
  return lijnen;
}

/** Begin- of eindvelden van releases/veren, met het voorvoegsel hernoemd. */
function eindVelden<T extends object>(
  obj: T | undefined,
  van: "start" | "end",
  naar: "start" | "end",
): Partial<T> | undefined {
  if (!obj) return undefined;
  const uit: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (!k.startsWith(van) || v === undefined) continue;
    uit[`${naar}${k.slice(van.length)}`] = v;
    n++;
  }
  return n > 0 ? (uit as Partial<T>) : undefined;
}

/**
 * Wat `voegConfigSamen` van een deel leest: de toetsinstellingen, de richting
 * en de plaats op de lijn. Een 2D-`LijnDeel` past, en ook een deel van een
 * 3D-lijn (`openFem3dDoorgaandeLijn.ts`, issue #207).
 */
export interface ConfigDeel {
  beam: { checkConfig?: BeamCheckConfig };
  gespiegeld: boolean;
  xStartMm: number;
  lengteMm: number;
}

/** Kipsteunfracties van een deel, als fracties van de hele lijn. */
function fractiesNaarLijn(
  fracties: number[] | undefined,
  deel: ConfigDeel,
  lengteMm: number,
): number[] {
  if (!Array.isArray(fracties) || lengteMm <= 0) return [];
  const eigen = fracties.filter((f) => Number.isFinite(f) && f >= 0 && f <= 1);
  const inLijnrichting = deel.gespiegeld ? spiegelFracties(eigen) : eigen;
  return inLijnrichting.map((f) => Math.round(((deel.xStartMm + f * deel.lengteMm) / lengteMm) * 1e12) / 1e12);
}

/**
 * De toetsconfiguratie van de virtuele staaf uit die van de delen. Levert
 * ook de zinnen die zeggen waar de delen het oneens waren. Ook voor 3D
 * (`openFem3dDoorgaandeLijn.ts`): dezelfde regels in beide.
 */
export function voegConfigSamen(lijn: { delen: readonly ConfigDeel[]; lengteMm: number }): {
  config: BeamCheckConfig | undefined;
  notities: string[];
} {
  const configs = lijn.delen.map((d) => d.beam.checkConfig ?? {});
  const notities: string[] = [];
  const uit: BeamCheckConfig = {};

  const boven = new Set<number>();
  const onder = new Set<number>();
  for (const d of lijn.delen) {
    for (const f of fractiesNaarLijn(d.beam.checkConfig?.lateralRestraints, d, lijn.lengteMm)) boven.add(f);
    for (const f of fractiesNaarLijn(d.beam.checkConfig?.lateralRestraintsBottom, d, lijn.lengteMm)) onder.add(f);
  }
  if (boven.size > 0) uit.lateralRestraints = [...boven].sort((a, b) => a - b);
  if (onder.size > 0) uit.lateralRestraintsBottom = [...onder].sort((a, b) => a - b);

  // Een absolute maat die op een deel is opgegeven, geldt voor de lijn; bij
  // verschillende opgaven de GROOTSTE (de ongunstigste: een langere kniklengte
  // en een grotere kipsteunafstand geven de lagere weerstand).
  const grootste = (sleutel: "bucklingLengthY_m" | "bucklingLengthZ_m" | "ltbSupportSpacing_m", naam: string) => {
    const waarden = configs.map((c) => c[sleutel]).filter((v): v is number => Number.isFinite(v) && (v as number) > 0);
    if (waarden.length === 0) return;
    const max = Math.max(...waarden);
    uit[sleutel] = max;
    if (new Set(waarden).size > 1) {
      notities.push(
        `De delen geven verschillende waarden voor ${naam} (${waarden.map((v) => nl(v)).join(", ")} m); ` +
          `aangehouden is de grootste, ${nl(max)} m — de ongunstigste.`,
      );
    }
  };
  grootste("bucklingLengthY_m", "de kniklengte om de y-as");
  grootste("bucklingLengthZ_m", "de kniklengte om de z-as");
  grootste("ltbSupportSpacing_m", "de kipsteunafstand");

  // Een keuze (klasse, noemer, klimaat- en duurklasse, spanning) die op een
  // deel staat, geldt voor de lijn; verschillen de delen, dan wint het eerste
  // deel dat de keuze heeft gemaakt, en dat staat erbij.
  const eerste = <K extends keyof BeamCheckConfig>(sleutel: K, naam: string) => {
    const waarden = configs.map((c) => c[sleutel]).filter((v) => v !== undefined && v !== null);
    if (waarden.length === 0) return;
    uit[sleutel] = waarden[0];
    if (new Set(waarden.map((v) => JSON.stringify(v))).size > 1) {
      notities.push(
        `De delen verschillen in ${naam}; aangehouden is de waarde van het eerste deel dat ` +
          `haar heeft gezet (${JSON.stringify(waarden[0])}).`,
      );
    }
  };
  eerste("deflectionClass", "de doorbuigingsklasse");
  eerste("deflectionLimitNumerator", "de doorbuigingsnoemer");
  eerste("deflectionAddLimitNumerator", "de noemer van de bijkomende doorbuiging");
  eerste("serviceClass", "de klimaatklasse");
  eerste("loadDuration", "de belastingduurklasse");
  eerste("spanningSigmaZ", "de dwarsspanning");

  // Zeeg: alleen als alle delen dezelfde geven — een zeeg hoort bij de
  // overspanning als geheel. Bij verschil geen zeeg (de veilige kant) en een
  // notitie; bij het splitsen wist de app hem al met een melding.
  const zegen = configs.map((c) => c.preCamber_mm).filter((v): v is number => Number.isFinite(v) && v !== 0);
  if (zegen.length > 0) {
    if (zegen.length === configs.length && new Set(zegen).size === 1) {
      uit.preCamber_mm = zegen[0];
    } else {
      notities.push(
        `Niet alle delen geven dezelfde zeeg (${zegen.map((v) => nl(v, 1)).join(", ")} mm); ` +
          "de zeeg is voor de lijn op 0 gezet. Geef één zeeg op bij het deel waaronder de lijn wordt getoetst.",
      );
    }
  }

  return { config: Object.keys(uit).length > 0 ? uit : undefined, notities };
}

/** De station-arrays van de delen aaneengeregen tot die van de lijn. */
function voegElementKrachtenSamen(delen: { ef: ElementForces; gespiegeld: boolean }[]): ElementForces {
  const efs = delen.map((d) => (d.gespiegeld ? spiegelElementKrachten(d.ef) : d.ef));
  const stations_mm: number[] = [];
  const normalForce: number[] = [];
  const shearForce: number[] = [];
  const bendingMoment: number[] = [];
  const deflection: number[] = [];
  const axialDisp: number[] = [];
  const rotation: number[] = [];
  const metRotatie = efs.every((ef) => Array.isArray(ef.rotation) && ef.rotation.length === ef.stations_mm.length);
  // Schaal voor "springt op de naad": een starre aansluiting geeft aan beide
  // kanten dezelfde w en θ, op afrondruis na.
  const grootsteAbs = (reeksen: readonly (readonly number[] | undefined)[]): number => {
    let m = 0;
    for (const r of reeksen) for (const v of r ?? []) if (Number.isFinite(v) && Math.abs(v) > m) m = Math.abs(v);
    return m;
  };
  const wSchaal = grootsteAbs(efs.map((ef) => ef.deflection));
  const thetaSchaal = metRotatie ? grootsteAbs(efs.map((ef) => ef.rotation)) : 0;
  const springt = (a: number | undefined, b: number | undefined, schaal: number): boolean =>
    Math.abs((a ?? 0) - (b ?? 0)) > NAAD_TOL * schaal;
  let x0 = 0;
  efs.forEach((ef, i) => {
    // Het eerste station van een vervolgdeel valt samen met het laatste van
    // het vorige deel; één keer opnemen, als w en θ daar doorlopen.
    //
    // SPRINGT θ (of w) op de naad — een scharnier in de lijn, zoals het
    // naadstation van een Gerberligger —, dan staat het station er TWEE keer:
    // links met θ van het deel ervóór, rechts met θ van het deel erna, als een
    // interval van lengte nul. Dat doet de engine ook op een knip binnen één
    // staaf. Met één station droeg de naad alleen θ van het linkerdeel, en de
    // Hermite-verfijning van de zakking (`solver/veldExtremen.ts`) zag op het
    // interval rechts ervan een helling die daar niet hoort: zij verzon een
    // extreem. Gemeten (controle 12 oktober 2026, C8): de lijn 6–8–12 m met
    // het scharnier op 8 m kreeg −7,7226 mm waar −7,5947 mm (de tip van de
    // uitkraging) hoort.
    let van = 0;
    if (i > 0) {
      const vorige = efs[i - 1];
      const k = vorige.stations_mm.length - 1;
      const sprong =
        springt(vorige.deflection[k], ef.deflection[0], wSchaal) ||
        (metRotatie && springt(vorige.rotation![k], ef.rotation![0], thetaSchaal));
      van = sprong ? 0 : 1;
    }
    for (let k = van; k < ef.stations_mm.length; k++) {
      stations_mm.push(x0 + ef.stations_mm[k]);
      normalForce.push(ef.normalForce[k] ?? 0);
      shearForce.push(ef.shearForce[k] ?? 0);
      bendingMoment.push(ef.bendingMoment[k] ?? 0);
      deflection.push(ef.deflection[k] ?? 0);
      axialDisp.push(ef.axialDisp[k] ?? 0);
      if (metRotatie) rotation.push(ef.rotation![k]);
    }
    x0 += ef.L_mm;
  });
  const laatste = efs[efs.length - 1];
  const uit: ElementForces = {
    N: efs[0].N,
    V: efs[0].V,
    M_start: efs[0].M_start,
    M_end: laatste.M_end,
    L_mm: x0,
    stations_mm,
    normalForce,
    shearForce,
    bendingMoment,
    deflection,
    axialDisp,
  };
  if (metRotatie) uit.rotation = rotation;
  return uit;
}

/**
 * De virtuele staaf van een lijn: van het ene eind naar het andere, met de
 * eigenschappen van het eerste deel en de samengevoegde toetsconfiguratie.
 */
function virtueleStaaf(lijn: DoorgaandeLijn): { beam: Beam; notities: string[] } {
  const eerste = lijn.delen[0];
  const laatste = lijn.delen[lijn.delen.length - 1];
  const { config, notities } = voegConfigSamen(lijn);
  const beam: Beam = {
    ...eerste.beam,
    id: lijn.id,
    from: lijn.from,
    to: lijn.to,
  };
  delete beam.releases;
  delete beam.veren;
  delete beam.checkConfig;
  const startRel = eindVelden(eerste.beam.releases, eerste.gespiegeld ? "end" : "start", "start");
  const endRel = eindVelden(laatste.beam.releases, laatste.gespiegeld ? "start" : "end", "end");
  if (startRel || endRel) beam.releases = { ...(startRel ?? {}), ...(endRel ?? {}) };
  const startVeren = eindVelden(eerste.beam.veren, eerste.gespiegeld ? "end" : "start", "start");
  const endVeren = eindVelden(laatste.beam.veren, laatste.gespiegeld ? "start" : "end", "end");
  if (startVeren || endVeren) beam.veren = { ...(startVeren ?? {}), ...(endVeren ?? {}) };
  if (config) beam.checkConfig = config;
  return { beam, notities };
}

/**
 * Vervang in de bouwerinvoer elke doorgaande lijn door haar virtuele staaf,
 * met aaneengeregen resultaten. De invoer zelf wordt niet gewijzigd.
 */
export function voegDoorgaandeLijnenSamen<T extends LijnInvoer>(invoer: T): LijnUitkomst<T> {
  const alleBeams = invoer.alleBeams ?? invoer.beams;
  const lijnen = vindDoorgaandeLijnen(invoer.beams, invoer.nodes, alleBeams, invoer.supports, invoer.plates);
  if (lijnen.length === 0) {
    return { data: invoer, lijnen: new Map(), notities: new Map(), overgeslagen: [], kniklengtes: new Map() };
  }

  const vervangen = new Set<number>();
  const virtueel: Beam[] = [];
  const notities = new Map<number, string[]>();
  const lijnPerId = new Map<number, DoorgaandeLijn>();
  const overgeslagen: CheckSkip[] = [];
  const kniklengtes = new Map<number, { yM: number }>();
  const teToetsen = new Set(invoer.beams.map((b) => b.id));

  for (const lijn of lijnen) {
    const { beam, notities: configNotities } = virtueleStaaf(lijn);
    virtueel.push(beam);
    lijnPerId.set(lijn.id, lijn);
    const ids = lijn.delen.map((d) => d.beam.id);
    for (const id of ids) {
      vervangen.add(id);
      if (id !== lijn.id && teToetsen.has(id)) {
        overgeslagen.push({
          beamId: id,
          reason:
            `maakt deel uit van de doorgaande lijn die als staaf ${lijn.id} is getoetst ` +
            `(staven ${ids.join(", ")}, samen ${nl(lijn.lengteMm / 1000)} m); zie staaf ${lijn.id}`,
        });
      }
    }
    // De staafeinden van de lijn zoals de bouwers ze bepalen: een vrij of
    // doorlopend lijneind schakelt KNIK PER VAK uit, en één vrij eind maakt
    // de doorbuiging een toets per deel (veld en overstek).
    const einden = bepaalStaafeinden(beam, invoer.nodes, alleBeams, invoer.supports, new Set(ids), invoer.plates);
    const vak = kniklengteVanVakken(lijn, beam, einden);
    if (vak.yM !== undefined) kniklengtes.set(lijn.id, { yM: vak.yM });
    const splits = splitsKnoopDoorbuiging(lijn, einden);
    const knikZin = !lijn.knopen.some((k) => k.steunend.length > 0)
      ? "De kniklengte zonder opgave is de hele lijn; "
      : vak.nietToegepast
        ? "De kniklengte zonder opgave volgt hier NIET uit de vakken tussen de knopen, omdat een lijneind vrij " +
          "is of doorloopt (zie KNIK PER VAK NIET TOEGEPAST); "
        : "De kniklengte in het vlak zonder opgave volgt uit de vakken tussen de knopen waar andere staven " +
          "aansluiten; loodrecht op het vlak niet (zie KNIK PER VAK); ";
    const tekst: string[] = [
      `DOORGAANDE LIJN. Deze staaf is de doorgaande lijn van de staven ${ids.join(", ")} ` +
        `(${beam.profile ?? "—"}, ${beam.material ?? "—"}): zij liggen in elkaars verlengde, hebben ` +
        `dezelfde doorsnede en hetzelfde materiaal, en op de tussenknoop ${lijn.tussenknopen.join(", ")} ` +
        "staat geen oplegging en sluit geen plaat aan. De toetsing beschouwt de lijn als ÉÉN staaf van " +
        `${nl(lijn.lengteMm / 1000)} m: ` +
        (splits
          ? "de kipvelden gelden voor die hele lengte, en een tussenknoop telt daar niet als steun of als " +
            "gaffel (basisaudit nr 29 en het kipgedrag bij een tussenknoop). De doorbuiging is per deel getoetst: " +
            `het veld en het overstek apart, met tussenknoop ${splits.knoop} als grens en elk met zijn eigen ` +
            "ℓ_rep (zie de toelichting bij de doorbuiging). "
          : "de kipvelden en de koorde van de doorbuiging gelden voor die hele lengte, en een tussenknoop " +
            "telt daar niet als steun of als gaffel (basisaudit nr 29 en het kipgedrag bij een tussenknoop). ") +
        knikZin +
        "kipsteunen van de delen zijn omgerekend naar de lijn, en een opgegeven kniklengte, " +
        "kipsteunafstand, zeeg of klasse van een deel is voor de lijn overgenomen.",
    ];
    tekst.push(...knoopNotities(lijn, vak, splits));
    tekst.push(...configNotities);
    notities.set(lijn.id, tekst);
  }

  const beams = invoer.beams.filter((b) => !vervangen.has(b.id)).concat(virtueel);

  // Resultaten: per combinatie de virtuele staaf erbij, als alle delen er een
  // resultaat in hebben. De bestaande Maps blijven onaangeroerd.
  const combinationResults = new Map<number, SolverResult>();
  for (const [comboId, result] of invoer.combinationResults) {
    let elements: Map<number, ElementForces> | null = null;
    for (const lijn of lijnen) {
      const stukken: { ef: ElementForces; gespiegeld: boolean }[] = [];
      for (const d of lijn.delen) {
        const ef = result.elements.get(d.beam.id);
        if (!ef || ef.stations_mm.length === 0) break;
        stukken.push({ ef, gespiegeld: d.gespiegeld });
      }
      if (stukken.length !== lijn.delen.length) continue;
      elements ??= new Map(result.elements);
      elements.set(lijn.id, voegElementKrachtenSamen(stukken));
    }
    combinationResults.set(comboId, elements ? { ...result, elements } : result);
  }

  return {
    data: { ...invoer, beams, combinationResults },
    lijnen: lijnPerId,
    notities,
    overgeslagen,
    kniklengtes,
  };
}

/** KNIK PER VAK van een lijn: de lengte in het vlak en wat er om z geldt, of waarom er geen zijn. */
interface VakKnik {
  /** L_cr,y per vak (m), als de delen geen L_cr,y opgeven. */
  yM?: number;
  /**
   * Om z, als de delen geen L_cr,z opgeven en er een vakgrens in het vlak is
   * (issue #201): wat de kern zonder opgave neemt — de grootste afstand
   * tussen de kipsteunen aan beide flenzen, of de hele lijn — en of dat uit
   * de steunen komt. Alleen voor de notitie; de bouwers geven de kern 0.
   */
  z?: { lCrM: number; uitSteunen: boolean; steunpuntenMm: number[] };
  /**
   * Er zijn vakgrenzen, maar een lijneind is vrij of loopt door: waarom KNIK
   * PER VAK niet is toegepast (leesbaar, zonder hoofdletter vooraan).
   */
  nietToegepast?: string;
}

/**
 * Waarom een lijneind KNIK PER VAK uitsluit, of `null` als beide einden gaffel
 * zijn. `einden` is van de virtuele staaf: `begin` hoort bij `lijn.from`.
 */
function eindReden(lijn: DoorgaandeLijn, einden: Staafeinden): string | null {
  const redenen: string[] = [];
  for (const [eind, knoop] of [[einden.begin, lijn.from], [einden.eind, lijn.to]] as const) {
    if (eind === "Vrij") {
      redenen.push(`het lijneind op knoop ${knoop} is vrij (geen oplegging, plaat of andere staaf)`);
    } else if (eind === "Doorlopend") {
      redenen.push(
        `op knoop ${knoop} loopt de lijn zonder oplegging door in een staaf met een andere doorsnede, ` +
          "een ander materiaal of een verlopend profiel",
      );
    }
  }
  return redenen.length > 0 ? redenen.join(", en ") : null;
}

/**
 * KNIK PER VAK: in het vlak de grootste knoopafstand tussen de vakgrenzen
 * van de lijn (tussenknopen met een `steunend` aansluiting), als de delen
 * geen L_cr,y opgeven. Leeg zonder vakgrens.
 *
 * Om z is zo'n knoop GEEN vakgrens (issue #201): een aansluiting in het vlak
 * houdt de lijn loodrecht op het vlak niet vanzelf vast. Zonder opgave neemt
 * de kern de grootste afstand tussen de plaatsen met een kipsteun aan beide
 * flenzen, anders de hele lijn; `z` zegt welke, voor de notitie.
 *
 * Alleen tussen twee gaffels: is een lijneind VRIJ of DOORLOPEND, dan geen
 * lengtes maar de reden (`nietToegepast`) — zie de kop van deze module.
 */
function kniklengteVanVakken(lijn: DoorgaandeLijn, beam: Beam, einden: Staafeinden): VakKnik {
  const grenzen = lijn.knopen.filter((k) => k.steunend.length > 0).map((k) => k.xMm);
  if (grenzen.length === 0) return {};
  const opgegeven = (v: number | undefined) => Number.isFinite(v) && (v as number) > 0;
  const cfg = beam.checkConfig ?? {};
  if (opgegeven(cfg.bucklingLengthY_m) && opgegeven(cfg.bucklingLengthZ_m)) return {};
  const reden = eindReden(lijn, einden);
  if (reden) return { nietToegepast: reden };
  const uit: VakKnik = {};
  if (!opgegeven(cfg.bucklingLengthY_m)) {
    const alle = [0, ...grenzen, lijn.lengteMm].sort((a, b) => a - b);
    let max = 0;
    for (let i = 1; i < alle.length; i++) max = Math.max(max, alle[i] - alle[i - 1]);
    uit.yM = max / 1000;
  }
  if (!opgegeven(cfg.bucklingLengthZ_m)) {
    const flenzen = steunpuntenHeleDoorsnede(lijn.lengteMm, cfg.lateralRestraints, cfg.lateralRestraintsBottom);
    uit.z = flenzen.lCrMm !== null
      ? { lCrM: flenzen.lCrMm / 1000, uitSteunen: true, steunpuntenMm: flenzen.steunpuntenMm }
      : { lCrM: lijn.lengteMm / 1000, uitSteunen: false, steunpuntenMm: [] };
  }
  return uit;
}

/**
 * De tussenknoop waar de doorbuiging van de lijn in veld en overstek wordt
 * gesplitst, of `undefined` als zij als één staaf wordt getoetst. Dezelfde
 * regel als `doorbuigingsDelen` (`lib/uitkraging.ts`) met de steunpunten van
 * `steunpuntenOpLijn`: precies één vrij lijneind, en dan de steunende knoop
 * die het dichtst bij dat vrije eind ligt.
 */
function splitsKnoopDoorbuiging(lijn: DoorgaandeLijn, einden: Staafeinden): Tussenknoop | undefined {
  const beginVrij = einden.begin === "Vrij";
  const eindVrij = einden.eind === "Vrij";
  if (beginVrij === eindVrij) return undefined;
  const steunen = lijn.knopen.filter((k) => k.steunt);
  if (steunen.length === 0) return undefined;
  return eindVrij ? steunen[steunen.length - 1] : steunen[0];
}

/**
 * De notities per tussenknoop: aansluitingen, KNIK PER VAK (of waarom die
 * niet is toegepast) en vrijgaven of veren. `splits` is de knoop waar de
 * doorbuiging in veld en overstek wordt gesplitst (`splitsKnoopDoorbuiging`).
 */
function knoopNotities(lijn: DoorgaandeLijn, vak: VakKnik, splits: Tussenknoop | undefined): string[] {
  const uit: string[] = [];
  const vakknopen = lijn.knopen.filter((k) => k.steunend.length > 0);
  const perVak = vak.yM !== undefined || vak.z !== undefined;
  const knikZin = perVak
    ? "Voor de knik in het vlak is de knoop een vakgrens; loodrecht op het vlak niet (zie KNIK PER VAK)."
    : vak.nietToegepast
      ? "Voor de knik is de knoop hier GEEN vakgrens, omdat een lijneind vrij is of doorloopt (zie KNIK PER VAK NIET TOEGEPAST)."
      : "Voor de knik is de knoop een vakgrens; de opgegeven kniklengte gaat voor.";
  for (const k of lijn.knopen) {
    if (k.aangesloten.length === 0) continue;
    const staven = `staaf ${k.aangesloten.join(", ")}`;
    if (k.steunend.length > 0) {
      const isSplits = splits?.knoop === k.knoop;
      uit.push(
        `Op tussenknoop ${k.knoop} sluit ${staven} aan. Die aansluiting is NIET als steun of gaffel ` +
          (isSplits ? "meegeteld voor de kip" : "meegeteld voor de kip en de doorbuiging") +
          ": een vlak model zegt niet of zij de lijn zijdelings of tegen torsie vasthoudt. Doet zij dat " +
          "werkelijk, geef dan op die plaats een kipsteun (aan beide flenzen) op. " +
          (isSplits
            ? "Voor de doorbuiging is de knoop wel een steunpunt: daar begint het overstek, dat met de knoop " +
              "als inklemming apart van het veld is getoetst (zie de toelichting bij de doorbuiging). "
            : "") +
          knikZin,
      );
    } else {
      uit.push(
        `Op tussenknoop ${k.knoop} sluit ${staven} aan, maar het andere eind daarvan is vrij (geen ` +
          "oplegging, plaat of andere staaf): die aansluiting houdt de lijn nergens vast. De knoop telt " +
          "niet als steun of gaffel, ook niet voor de knik, en is geen steunpunt voor de doorbuiging.",
      );
    }
  }
  if (vakknopen.length > 0 && perVak) {
    const grenzen = [0, ...vakknopen.map((k) => k.xMm), lijn.lengteMm];
    const vakken = grenzen.slice(1).map((x, i) => nl((x - grenzen[i]) / 1000));
    const knopen = vakknopen.map((k) => k.knoop).join(", ");
    const zinnen: string[] = [];
    if (vak.yM !== undefined) {
      zinnen.push(
        `Om de y-as (in het vlak) is zonder opgave de grootste knoopafstand aangehouden: L_cr,y = ${nl(vak.yM)} m, ` +
          "de systeemlengte — de verplaatsing van de knopen zelf zit in de krachten (tweede orde) of is bij " +
          "α_cr ≥ 10 te verwaarlozen. In de kniktoets staat deze kniklengte als opgegeven: de toetsing heeft " +
          "haar gezet, niet de gebruiker.",
      );
    } else {
      zinnen.push("Om de y-as (in het vlak) gaat de opgegeven L_cr,y voor.");
    }
    if (vak.z) {
      // Een vakknoop met een kipsteun aan beide flenzen op dezelfde plaats is
      // als zijdelingse steun opgegeven: daar is de lijn ook om z gesteund.
      const z = vak.z;
      const gesteund = vakknopen.filter((k) => z.steunpuntenMm.some((x) => Math.abs(x - k.xMm) <= TOLERANTIE_STEUNPAAR_MM));
      const los = vakknopen.filter((k) => !gesteund.includes(k)).map((k) => k.knoop).join(", ");
      if (los) {
        zinnen.push(
          `Om de z-as (loodrecht op het vlak) is knoop ${los} GEEN vakgrens: een aansluiting in het vlak ` +
            "(een ligger, een wandstaaf) houdt de lijn loodrecht op het vlak niet vanzelf vast. Houdt zij de " +
            "lijn daar wél vast (een gording, een windverband, een vloer), geef dan op die plaats een kipsteun " +
            "aan beide flenzen op, of geef L_cr,z op.",
        );
      }
      if (gesteund.length > 0) {
        zinnen.push(
          `Op knoop ${gesteund.map((k) => k.knoop).join(", ")} staat een kipsteun aan beide flenzen: daar is de ` +
            "lijn als zijdelings gesteund opgegeven, ook voor de knik om de z-as.",
        );
      }
      zinnen.push(
        `Zonder opgave rekent de kern om de z-as met L_cr,z = ${nl(z.lCrM)} m, ` +
          (z.uitSteunen
            ? "de grootste afstand tussen de kipsteunen aan beide flenzen."
            : "de hele lijn: er is geen kipsteun aan beide flenzen opgegeven."),
      );
    } else {
      zinnen.push("Om de z-as (loodrecht op het vlak) gaat de opgegeven L_cr,z voor.");
    }
    uit.push(
      `KNIK PER VAK. Op knoop ${knopen} sluiten staven aan die de lijn in het vlak vasthouden; zij delen haar ` +
        `in vakken van ${vakken.join(" · ")} m. ${zinnen.join(" ")} De kip en de doorbuiging lopen over de hele lijn.`,
    );
  }
  if (vakknopen.length > 0 && vak.nietToegepast) {
    const knopen = vakknopen.map((k) => k.knoop).join(", ");
    uit.push(
      `KNIK PER VAK NIET TOEGEPAST. Op knoop ${knopen} sluiten staven aan die de lijn vasthouden, maar ` +
        `${vak.nietToegepast}. Het eindvak aan die kant ligt dan niet tussen twee vastgehouden knopen, en ` +
        "de knoopafstand zou de kniklengte daar onderschatten: bij een vrij eind is zij minstens tweemaal " +
        "het eindvak, en meer als de knoop ervoor niet star ingeklemd is. Daarom zet de toetsing hier geen " +
        "kniklengte per vak; zonder opgave bepaalt de kern de kniklengte over de hele lijn van " +
        `${nl(lijn.lengteMm / 1000)} m (zie de kniktoets). Geef L_cr,y en L_cr,z op als een kleinere waarde ` +
        "aantoonbaar is, bijvoorbeeld uit α_cr.",
    );
  }
  for (const k of lijn.knopen) {
    if (k.los.length === 0) continue;
    if (k.steunend.length > 0) {
      // Een vakgrens: de aansluiting houdt de knoop vast, de vrijgave of veer
      // zit in de krachten en verandert aan de knik per vak niets.
      const knik = perVak
        ? "voor de knik in het vlak is de knoop een vakgrens door de aansluiting daar, loodrecht op het vlak niet"
        : vak.nietToegepast
          ? "voor de knik is de knoop hier geen vakgrens (zie KNIK PER VAK NIET TOEGEPAST)"
          : "voor de knik gaat de opgegeven kniklengte voor";
      const rest =
        splits?.knoop === k.knoop
          ? "de kip loopt over de hele lijn, en voor de doorbuiging is de knoop de grens tussen veld en overstek"
          : splits
            ? "de kip loopt over de hele lijn, en voor de doorbuiging is de knoop geen steunpunt"
            : "de kip en de doorbuiging lopen over de hele lijn";
      uit.push(
        `Op tussenknoop ${k.knoop} zit ${k.los.join("; ")}. Het scharnier of de veer zit in de krachten; ` +
          `${knik}, en ${rest}.`,
      );
      continue;
    }
    uit.push(
      `Op tussenknoop ${k.knoop} zit ${k.los.join("; ")}. De lijn is daar niet stijf doorgaand, maar de ` +
        "knoop houdt haar ook nergens vast: het scharnier of de veer zit in de krachten, en voor de kip " +
        "en de knik loodrecht op het vlak is de lijn één staaf" +
        (splits ? ", en voor de doorbuiging is de knoop geen steunpunt" : " (ook voor de doorbuiging)") +
        ". In het vlak kan de kniklengte daardoor GROTER zijn dan de lijnlengte; de terugval op de lijn is " +
        "daar alleen veilig met krachten uit een tweede-ordeberekening (P-Δ) of bij α_cr ≥ 10. Geef anders L_cr,y op.",
    );
  }
  return uit;
}

/**
 * Wat er aan de twee staafeinden zit, voor de kern — zie `Staafeind` in de
 * Rust-invoer. `beam` is de (eventueel virtuele en eventueel gespiegelde)
 * staaf zoals de bouwer hem toetst: `from` is het begin in de
 * referentierichting. `ledenVanLijn` zijn de delen waaruit hij bestaat; die
 * tellen niet als aansluitende staaf.
 */
export function bepaalStaafeinden(
  beam: Beam,
  nodes: Node[],
  alleBeams: Beam[],
  supports: Support[] | undefined,
  ledenVanLijn: ReadonlySet<number>,
  plates?: readonly PlaatVoorEinden[],
): Staafeinden {
  // Zonder opleggingenlijst is een vrij eind niet van een opgelegd eind te
  // onderscheiden. Dan geen uitspraak: beide einden gelden als gaffel, de
  // aanname van vóór dit veld — een "vrij" eind aanwijzen waar in werkelijkheid
  // een oplegging staat, zou de kniklengte verdubbelen op grond van niets.
  if (!supports) return { begin: "Gaffel", eind: "Gaffel" };
  const dir = richting(beam, nodes);
  const opgelegd = new Set(supports.map((s) => s.nodeId));
  // Een knoop in of op een plaat (hoek, rand, binnenin): zie `knoopInPlaat`.
  const inPlaat = (id: number): boolean => {
    const k = nodes.find((n) => n.id === id);
    return k !== undefined && knoopInPlaat(k, nodes, plates);
  };
  const eind = (knoop: number) => {
    if (opgelegd.has(knoop) || inPlaat(knoop)) return "Gaffel" as const;
    const anderen = alleBeams.filter(
      (b) => b.id !== beam.id && !ledenVanLijn.has(b.id) && (b.from === knoop || b.to === knoop),
    );
    if (anderen.length === 0) return "Vrij" as const;
    // Alleen collineaire staven op de knoop, zonder oplegging en zonder
    // plaat: met dezelfde doorsnede en hetzelfde materiaal had de
    // lijnherkenning ze samengevoegd, ook over een vrijgave of veer heen. Hier
    // is het dus een andere doorsnede, een ander materiaal of een verlopende
    // staaf (die nooit wordt samengevoegd): de lijn loopt door.
    const alleenInVerlengde =
      dir !== null &&
      anderen.every((b) => {
        const d2 = richting(b, nodes);
        return d2 !== null && Math.abs(dir.x * d2.z - dir.z * d2.x) <= 1e-6;
      });
    if (alleenInVerlengde) return "Doorlopend" as const;
    // DE LUIFEL- OF T-KOLOM (issue #199). Hangt alles wat hier aansluit alleen
    // aan deze knoop — een uitkragende ligger op de kop van een kolom, zonder
    // oplegging, plaat of verbinding terug naar de staaf zelf — dan houdt het
    // de knoop nergens vast: het eind is vrij. Tot oktober 2026 telde elke
    // aansluitende staaf als gaffel, en kreeg zo'n kolom L in plaats van 2·L.
    const zelf = new Set<number>([beam.id, ...ledenVanLijn]);
    const eigenKnopen = new Set<number>([beam.from, beam.to]);
    for (const b of alleBeams) if (zelf.has(b.id)) { eigenKnopen.add(b.from); eigenKnopen.add(b.to); }
    eigenKnopen.delete(knoop);
    const hangend = hangendDeel(knoop, { nodes, beams: alleBeams, supports, plates }, zelf, eigenKnopen);
    return hangend ? ("Vrij" as const) : ("Gaffel" as const);
  };
  return { begin: eind(beam.from), eind: eind(beam.to) };
}

/**
 * De tussenknopen van een doorgaande lijn waar iets de lijn steunt (`steunt`
 * van de tussenknoop: een aansluitende staaf waarvan het andere eind ergens
 * aan vastzit, een plaat, of een oplegging) — als afstand in mm vanaf het
 * begin van `beam` (de virtuele staaf in referentierichting), oplopend. Zonder
 * lijn: leeg.
 *
 * WAARVOOR. Loopt een lijn over zo'n knoop door in een overstek, dan is het
 * overstek de uitkraging, met die knoop als inklemming, en niet de hele lijn:
 * zie `doorbuigingsDelen` in `lib/uitkraging.ts` (controle 2026-10, punt K5).
 * Of de aansluiting de lijn ook tegen kip of knik steunt, zegt dit niet — dat
 * blijft de notitie bij de lijn.
 *
 * Een staaf met een vrij ander eind (een paal met vrije kop) telt NIET: zij
 * houdt niets vast, net als voor KNIK PER VAK. Tot de review van de
 * samenvoeging 2026.42 telde elke aansluitende staaf; een onbelaste paal op
 * 7 m van een lijn 0–6–8 m verschoof zo het veld naar 0–7 m (ℓ_rep 7 m in
 * plaats van 6 m, onveilig) en het overstek naar 7–8 m.
 */
export function steunpuntenOpLijn(beam: Beam, nodes: Node[], lijn: DoorgaandeLijn | undefined): number[] {
  if (!lijn) return [];
  const begin = nodes.find((n) => n.id === beam.from);
  if (!begin) return [];
  const uit: number[] = [];
  for (const k of lijn.knopen) {
    if (!k.steunt) continue;
    const knoop = nodes.find((n) => n.id === k.knoop);
    if (knoop) uit.push(Math.hypot(knoop.x - begin.x, knoop.z - begin.z));
  }
  return uit.sort((a, b) => a - b);
}

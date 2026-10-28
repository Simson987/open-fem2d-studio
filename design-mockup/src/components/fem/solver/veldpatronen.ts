/**
 * Veldsgewijs ongunstige plaatsing van veranderlijke vloerbelasting (issue #219).
 *
 * DE NORM. Veranderlijke vloerbelasting is een VRIJE belasting: zij hoort op
 * de ongunstigste delen van de invloedsvlakken te staan (NEN-EN 1991-1-1
 * 6.2.1(1); voor doorgaande liggers en raamwerken uitgewerkt in NEN-EN
 * 1992-1-1 5.1.3 en NEN-EN 1993-1-1 bijlage AB.2: "veranderlijke belasting op
 * afwisselende velden" en "op twee aangrenzende velden"). Tot oktober 2026
 * zette de app een veranderlijk belastinggeval op alle velden tegelijk aan of
 * uit. Bij drie velden van 5 m (G = 10, Q = 5 kN/m, CC2) gaf dat 12,19 kNm
 * veldmoment in het middenveld waar 21,56 hoort (−43 %), en −48,75 kNm
 * steunmoment waar −51,88 hoort.
 *
 * DE AANPAK — invloedslijnen door superpositie, geen 2ⁿ combinaties.
 *  1. `splitsVeldgevallen`: elk veranderlijk vloergeval (type "live", elke
 *     gebruikscategorie BEHALVE H, daken; sneeuw en wind zijn geen "live")
 *     waarvan de last over twee of meer velden ligt, krijgt per veld een
 *     DEELGEVAL met precies de lasten van dat veld. De som van de deelgevallen
 *     is het geval zelf; het oorspronkelijke geval blijft bestaan.
 *  2. Na de (lineaire) rekengang levert elk deelgeval in elk resultaatpunt
 *     (station van N/V/M/w per staaf, reactie, knoopverplaatsing) een
 *     bijdrage r_veld. Het grootste effect in dat punt is
 *         vast deel + Σ max(0, f·r_veld),
 *     het kleinste vast deel + Σ min(0, f·r_veld): precies de ongunstigste van
 *     alle 2ⁿ plaatsingen, en dat is een gewone lastplaatsing (de velden met
 *     r > 0, resp. r < 0).
 *  3. `veldpatroonVarianten` verzamelt die plaatsingen (de VELDPATRONEN) over
 *     alle punten, zonder dubbelen, en maakt per combinatie met een
 *     veranderlijk vloergeval een variant per patroon: dezelfde combinatie,
 *     met de factor van het geval op de belaste deelgevallen in plaats van op
 *     het hele geval. Zo'n variant is een echte, samenhangende
 *     krachtsverdeling (M, V, N en w uit één lastplaatsing). De omhullende en
 *     ELKE toets (staal, hout, CLT, beton, plaat) lezen haar zoals elke andere
 *     combinatie; er is geen tweede weg naar de toetsing.
 *
 * WAT EEN VELD IS. De staven tussen twee opeenvolgende STEUNPUNTEN van een
 * doorgaande lijn: de staven worden samengevoegd over een knoop waar precies
 * twee staafeinden samenkomen en die geen translatie-oplegging heeft. Een
 * knoop met een oplegging (vast, scharnier, rol of translatieveer), een knoop
 * waar drie of meer staven samenkomen (een kolom onder een ligger) en een vrij
 * staafeinde zijn veldgrenzen. Zo is een doorgaande ligger over vier
 * steunpunten drie velden, een uitkraging een eigen veld, een ligger tussen
 * twee kolommen in een raamwerk één veld per vak, en een Gerberligger met een
 * scharnier tussen twee steunpunten één veld. Een knooplast op een inwendige
 * knoop van een veld hoort bij dat veld; elke andere last van het geval (een
 * knooplast op een veldgrens, plaatrandlasten, temperatuur) staat samen in
 * één deelgeval "overig" dat als geheel aan of uit gaat.
 *
 * ALLEEN LINEAIR. Superpositie geldt alleen bij een eerste-orde-berekening
 * zonder trek-alleen staven (issue #234).
 * Bij tweede orde of fysisch niet-lineair rekenen worden GEEN varianten
 * gemaakt; `veldpatroonMeldingen` geeft dan een waarschuwing per geval, zodat
 * het ontbreken van de ongunstige plaatsing niet stil blijft.
 *
 * WAT HET NIET DOET. De blijvende belasting gaat met één factor over alle
 * velden (EN 1990 6.4.3.1(4) staat dat toe; de standaardset bevat 0,9·G en
 * 1,2·G). Plaatspanningen sturen de patroonkeuze niet: de patronen volgen uit
 * de staven, reacties en knoopverplaatsingen; een plaat krijgt de varianten
 * wel mee in haar toetsing.
 */
import {
  VELD_GEVAL_OFFSET,
  type MultiInput,
  type SolverResult,
} from "./types";
import { soortVanCombinatie, type LoadCombination } from "./combinations";
import { getScheefstandRichtingen } from "./engine";

// ── Nummering ─────────────────────────────────────────────────────────────

/** Id van het eerste deelgeval; zie types.ts. */
export { VELD_GEVAL_OFFSET };

/**
 * Id van de eerste veldpatroonvariant van een combinatie. Boven de
 * eindtoestandvarianten (≤ 1 011 000 000 + scheefstand) en binnen een u32.
 */
export const VELD_COMBO_OFFSET = 2_000_000_000;

/**
 * Hoogstens zoveel veldpatronen. Daarboven blijven de patronen met de grootste
 * winst ten opzichte van "alle velden belast" staan en meldt
 * `veldpatroonVarianten` wat er wegviel (nooit stil).
 */
export const MAX_VELDPATRONEN = 64;

/**
 * Een bijdrage mag uit een patroon wegvallen zolang alle weggelaten bijdragen
 * in dat punt samen hoogstens dit deel van Σ|r| zijn. Dat houdt numerieke ruis
 * (een invloed die exact nul hoort te zijn) buiten de patroonkeuze; de fout is
 * begrensd op 0,1 ‰ van het veranderlijke aandeel in dat punt.
 */
const WEGLAAT_FRACTIE = 1e-4;

// ── Velden ────────────────────────────────────────────────────────────────

export interface Veld {
  /** Volgnummer 1…n, op volgorde van het kleinste staafnummer in het veld. */
  nummer: number;
  /** De staven van het veld, oplopend. */
  staven: number[];
  /** De inwendige knopen (geen veldgrens). */
  binnenknopen: number[];
}

/** De opleggingen die een veldgrens maken: alles met een translatiesteun. */
function isTranslatieSteun(type: string): boolean {
  return type !== "rotSpring";
}

/**
 * De velden van een 2D-staafmodel; zie de kop van dit bestand voor de regel.
 * Alleen `id`/`from`/`to` van de staven en `nodeId`/`type` van de opleggingen
 * tellen, zodat de store dezelfde indeling kan maken als de rekengang.
 */
export function bepaalVelden(model: {
  beams: readonly { id: number; from: number; to: number }[];
  supports: readonly { nodeId: number; type: string }[];
}): Veld[] {
  const graad = new Map<number, number[]>();
  for (const b of model.beams) {
    for (const k of [b.from, b.to]) {
      const lijst = graad.get(k);
      if (lijst) lijst.push(b.id); else graad.set(k, [b.id]);
    }
  }
  const gesteund = new Set(model.supports.filter((s) => isTranslatieSteun(s.type)).map((s) => s.nodeId));
  // Union-find over de staven.
  const ouder = new Map<number, number>(model.beams.map((b) => [b.id, b.id]));
  const wortel = (id: number): number => {
    let r = id;
    while (ouder.get(r) !== r) r = ouder.get(r)!;
    let x = id;
    while (ouder.get(x) !== r) { const v = ouder.get(x)!; ouder.set(x, r); x = v; }
    return r;
  };
  const binnen = new Set<number>();
  for (const [knoop, staven] of graad) {
    if (gesteund.has(knoop) || staven.length !== 2 || staven[0] === staven[1]) continue;
    binnen.add(knoop);
    const a = wortel(staven[0]), b = wortel(staven[1]);
    if (a !== b) ouder.set(Math.max(a, b), Math.min(a, b));
  }
  const groepen = new Map<number, number[]>();
  for (const b of model.beams) {
    const r = wortel(b.id);
    const lijst = groepen.get(r);
    if (lijst) lijst.push(b.id); else groepen.set(r, [b.id]);
  }
  const staafVan = new Map(model.beams.map((b) => [b.id, b] as const));
  return [...groepen.values()]
    .map((s) => s.sort((a, b) => a - b))
    .sort((a, b) => a[0] - b[0])
    .map((staven, i) => ({
      nummer: i + 1,
      staven,
      binnenknopen: [...new Set(staven.flatMap((id) => {
        const b = staafVan.get(id)!;
        return [b.from, b.to].filter((k) => binnen.has(k));
      }))].sort((a, b) => a - b),
    }));
}

// ── Welke gevallen ────────────────────────────────────────────────────────

/** Minimale vorm van een belastinggeval voor deze module. */
export interface VeldGevalInvoer {
  id: number;
  name: string;
  type: string;
  categorie?: string;
}

/**
 * Is dit een veranderlijke VLOERbelasting die veldsgewijs geplaatst hoort te
 * worden (6.2.1(1))? Type "live" in elke gebruikscategorie behalve H (daken,
 * 3.3.2: geen vloer; ontbreekt de categorie, dan geldt A). Sneeuw en wind
 * zijn eigen typen en vallen erbuiten — de norm eist voor die twee geen
 * veldsgewijze plaatsing.
 */
export function isVeldsgewijsGeval(lc: Pick<VeldGevalInvoer, "type" | "categorie">): boolean {
  return lc.type === "live" && (lc.categorie ?? "A") !== "H";
}

// ── Splitsen ──────────────────────────────────────────────────────────────

export interface VeldDeelgeval {
  /** Id in de perCase-Map en in de factoren van een variant. */
  id: number;
  /** Het belastinggeval waar dit deelgeval een deel van is. */
  ouderId: number;
  /** Het veldnummer, of null voor "overig". */
  veld: number | null;
  /** Leesbare naam, bijvoorbeeld "Q veld 2". */
  naam: string;
}

export interface VeldSplitsing {
  /** De invoer met de deelgevallen erbij (lasten gekopieerd onder hun id). */
  input: MultiInput;
  deelgevallen: VeldDeelgeval[];
  /** De gesplitste gevallen, met hun velden (alleen de belaste). */
  gesplitst: { ouderId: number; naam: string; velden: number[]; overig: boolean }[];
  velden: Veld[];
}

/**
 * Welke velden een geval belast, uit de solverinvoer. `null` = een last die
 * bij geen veld hoort (gaat naar "overig").
 */
function veldenPerGeval(velden: Veld[]) {
  const veldVanStaaf = new Map<number, number>();
  const veldVanKnoop = new Map<number, number>();
  for (const v of velden) {
    for (const s of v.staven) veldVanStaaf.set(s, v.nummer);
    for (const k of v.binnenknopen) veldVanKnoop.set(k, v.nummer);
  }
  return {
    staaf: (beamId: number): number | null => veldVanStaaf.get(beamId) ?? null,
    knoop: (nodeId: number): number | null => veldVanKnoop.get(nodeId) ?? null,
  };
}

/**
 * Splits elk veranderlijk vloergeval over twee of meer velden in deelgevallen
 * per veld. `null` = er valt niets te splitsen; de rekengang blijft dan
 * byte-gelijk aan die zonder deze stap.
 */
export function splitsVeldgevallen(
  input: MultiInput,
  loadCases: readonly VeldGevalInvoer[],
): VeldSplitsing | null {
  const kandidaten = loadCases.filter(
    (lc) => isVeldsgewijsGeval(lc) && input.cases.some((c) => c.id === lc.id),
  );
  if (kandidaten.length === 0) return null;
  const velden = bepaalVelden(input);
  const zoek = veldenPerGeval(velden);

  const deelgevallen: VeldDeelgeval[] = [];
  const gesplitst: VeldSplitsing["gesplitst"] = [];
  const nieuw = {
    cases: [] as MultiInput["cases"],
    loads: [] as MultiInput["loads"],
    pointLoads: [] as NonNullable<MultiInput["pointLoads"]>,
    beamPointLoads: [] as NonNullable<MultiInput["beamPointLoads"]>,
    thermalLoads: [] as NonNullable<MultiInput["thermalLoads"]>,
    edgeLoads: [] as NonNullable<MultiInput["edgeLoads"]>,
    edgePointLoads: [] as NonNullable<MultiInput["edgePointLoads"]>,
  };
  let volgende = VELD_GEVAL_OFFSET + 1;

  for (const lc of kandidaten) {
    type Sleutel = number | "overig";
    const groepen = new Map<Sleutel, { soort: keyof typeof nieuw; last: any }[]>();
    const voeg = (sleutel: number | null, soort: keyof typeof nieuw, last: any) => {
      const k: Sleutel = sleutel ?? "overig";
      const lijst = groepen.get(k);
      if (lijst) lijst.push({ soort, last }); else groepen.set(k, [{ soort, last }]);
    };
    for (const l of input.loads) if (l.caseId === lc.id) voeg(zoek.staaf(l.beamId), "loads", l);
    for (const l of input.beamPointLoads ?? []) if (l.caseId === lc.id) voeg(zoek.staaf(l.beamId), "beamPointLoads", l);
    for (const l of input.pointLoads ?? []) if (l.caseId === lc.id) voeg(zoek.knoop(l.nodeId), "pointLoads", l);
    for (const l of input.thermalLoads ?? []) if (l.caseId === lc.id) voeg(null, "thermalLoads", l);
    for (const l of input.edgeLoads ?? []) if (l.caseId === lc.id) voeg(null, "edgeLoads", l);
    for (const l of input.edgePointLoads ?? []) if (l.caseId === lc.id) voeg(null, "edgePointLoads", l);
    // Een geval op één veld (of alleen "overig") heeft maar één plaatsing.
    if (groepen.size < 2) continue;

    const veldNummers = [...groepen.keys()].filter((k): k is number => k !== "overig").sort((a, b) => a - b);
    const volgorde: Sleutel[] = [...veldNummers, ...(groepen.has("overig") ? ["overig" as const] : [])];
    for (const k of volgorde) {
      const id = volgende++;
      const naam = k === "overig" ? `${lc.name} overig` : `${lc.name} veld ${k}`;
      deelgevallen.push({ id, ouderId: lc.id, veld: k === "overig" ? null : k, naam });
      nieuw.cases.push({ id, name: naam });
      for (const { soort, last } of groepen.get(k)!) {
        (nieuw[soort] as any[]).push({ ...last, caseId: id });
      }
    }
    gesplitst.push({ ouderId: lc.id, naam: lc.name, velden: veldNummers, overig: groepen.has("overig") });
  }
  if (deelgevallen.length === 0) return null;

  const plus = <T,>(oud: T[] | undefined, erbij: T[]): T[] | undefined =>
    erbij.length === 0 ? oud : [...(oud ?? []), ...erbij];
  const uitgebreid: MultiInput = {
    ...input,
    cases: [...input.cases, ...nieuw.cases],
    loads: [...input.loads, ...nieuw.loads],
  };
  const pl = plus(input.pointLoads, nieuw.pointLoads);
  if (pl) uitgebreid.pointLoads = pl;
  const bpl = plus(input.beamPointLoads, nieuw.beamPointLoads);
  if (bpl) uitgebreid.beamPointLoads = bpl;
  const tl = plus(input.thermalLoads, nieuw.thermalLoads);
  if (tl) uitgebreid.thermalLoads = tl;
  const el = plus(input.edgeLoads, nieuw.edgeLoads);
  if (el) uitgebreid.edgeLoads = el;
  const epl = plus(input.edgePointLoads, nieuw.edgePointLoads);
  if (epl) uitgebreid.edgePointLoads = epl;
  return { input: uitgebreid, deelgevallen, gesplitst, velden };
}

/**
 * De deelgevallen als belastinggevallen, voor de toetsbouwers: zelfde type en
 * categorie als het geval waar ze uit komen, zodat de belastingduur (k_mod) en
 * ψ van een variant gelijk blijven aan die van de combinatie.
 */
export function deelgevalBelastinggevallen<T extends VeldGevalInvoer>(
  splitsing: Pick<VeldSplitsing, "deelgevallen"> | null | undefined,
  loadCases: readonly T[],
): T[] {
  if (!splitsing) return [];
  const uit: T[] = [];
  for (const d of splitsing.deelgevallen) {
    const ouder = loadCases.find((lc) => lc.id === d.ouderId);
    if (ouder) uit.push({ ...ouder, id: d.id, name: d.naam });
  }
  return uit;
}

// ── Patronen ──────────────────────────────────────────────────────────────

export interface VeldpatroonUitkomst {
  /** De varianten, elk direct achter haar basiscombinatie in te voegen. */
  varianten: LoadCombination[];
  /** De gebruikte patronen (deelgeval-id's per patroon). */
  patronen: number[][];
  /** Wat er te melden is (afkapping); leeg = niets. */
  meldingen: string[];
}

/** Optionele sleutels van `LoadCombination` voor een veldpatroonvariant. */
export interface VeldpatroonHerkomst {
  /** Id van de combinatie waarvan dit een variant is. */
  basisId: number;
  /** Per gesplitst geval de belaste velden ("overig" = de rest van het geval). */
  belast: { ouderId: number; velden: (number | "overig")[] }[];
}

/** Puntsgewijze bijdragen van alle deelgevallen, per grootheid. */
function* resultaatpunten(
  resultaten: (SolverResult | undefined)[],
): Generator<{ soort: string; r: Float64Array }> {
  const n = resultaten.length;
  const staven = new Set<number>();
  const knopen = new Set<number>();
  const reacties = new Set<number>();
  for (const r of resultaten) {
    r?.elements.forEach((_, id) => staven.add(id));
    r?.displacements.forEach((_, id) => knopen.add(id));
    r?.reactions.forEach((_, id) => reacties.add(id));
  }
  for (const bid of [...staven].sort((a, b) => a - b)) {
    let m = 0;
    for (const r of resultaten) m = Math.max(m, r?.elements.get(bid)?.stations_mm.length ?? 0);
    const reeksen: [string, (ef: any) => readonly number[] | undefined][] = [
      ["N", (ef) => ef.normalForce], ["V", (ef) => ef.shearForce],
      ["M", (ef) => ef.bendingMoment], ["w", (ef) => ef.deflection],
    ];
    if (m === 0) {
      for (const [soort, lees] of [["N", (ef: any) => ef.N], ["V", (ef: any) => ef.V],
        ["M", (ef: any) => ef.M_start], ["M", (ef: any) => ef.M_end]] as const) {
        const r = new Float64Array(n);
        resultaten.forEach((res, j) => { const ef = res?.elements.get(bid); r[j] = ef ? lees(ef) : 0; });
        yield { soort, r };
      }
      continue;
    }
    for (const [soort, lees] of reeksen) {
      for (let i = 0; i < m; i++) {
        const r = new Float64Array(n);
        resultaten.forEach((res, j) => {
          const ef = res?.elements.get(bid);
          r[j] = ef ? (lees(ef)?.[i] ?? 0) : 0;
        });
        yield { soort, r };
      }
    }
  }
  for (const nid of [...reacties].sort((a, b) => a - b)) {
    for (const k of ["fx", "fz", "my"] as const) {
      const r = new Float64Array(n);
      resultaten.forEach((res, j) => { r[j] = res?.reactions.get(nid)?.[k] ?? 0; });
      yield { soort: `R${k}`, r };
    }
  }
  for (const nid of [...knopen].sort((a, b) => a - b)) {
    for (const k of ["ux", "uz"] as const) {
      const r = new Float64Array(n);
      resultaten.forEach((res, j) => { r[j] = res?.displacements.get(nid)?.[k] ?? 0; });
      yield { soort: k, r };
    }
  }
}

/**
 * Het patroon dat in één punt het grootste (teken +1) of kleinste (−1) effect
 * geeft: de deelgevallen met een bijdrage van dat teken, zonder de kleinste
 * bijdragen die samen onder WEGLAAT_FRACTIE·Σ|r| blijven.
 */
function patroonIn(r: Float64Array, teken: 1 | -1, som: number): number[] {
  const mee: { j: number; v: number }[] = [];
  for (let j = 0; j < r.length; j++) {
    const v = teken * r[j];
    if (v > 0) mee.push({ j, v });
  }
  mee.sort((a, b) => a.v - b.v);
  let weg = 0;
  let k = 0;
  while (k < mee.length && weg + mee[k].v <= WEGLAAT_FRACTIE * som) { weg += mee[k].v; k++; }
  return mee.slice(k).map((x) => x.j).sort((a, b) => a - b);
}

/** Opmaak van een getal in de meldingen (Nederlands). */
const pct = (x: number) => `${(100 * x).toFixed(1).replace(".", ",")} %`;

/**
 * Sleutel van een combinatie in termen van de deelgevallen: een gesplitst
 * geval met factor f telt als al zijn deelgevallen met f (het geval IS de som
 * van zijn deelgevallen). Twee combinaties met dezelfde sleutel geven exact
 * dezelfde krachtsverdeling.
 */
function combinatieSleutel(
  c: LoadCombination,
  factoren: Map<number, number>,
  delenVan: Map<number, number[]>,
): string {
  const effectief = new Map<number, number>();
  for (const [id, f] of factoren) {
    if (f === 0) continue;
    const delen = delenVan.get(id);
    if (delen) for (const d of delen) effectief.set(d, (effectief.get(d) ?? 0) + f);
    else effectief.set(id, (effectief.get(id) ?? 0) + f);
  }
  const deel = [...effectief].filter(([, f]) => f !== 0).sort((a, b) => a[0] - b[0])
    .map(([id, f]) => `${id}=${Number(f.toPrecision(12))}`).join(",");
  const e = c.eindtoestand ? `e${c.eindtoestand.psi2}${c.eindtoestand.bgt ? "b" : ""}` : "";
  // De SOORT telt mee: de toetsen zoeken hun combinaties op soort (6.14b voor
  // de doorbuiging, 6.15b voor de scheurwijdte); een 6.14b-variant met alleen
  // G mag niet wegvallen omdat 6.16b toevallig dezelfde factoren heeft.
  return `${c.type}|${soortVanCombinatie(c) ?? ""}|${c.scheefstandAs ?? ""}${c.scheefstandRichting ?? ""}${c.scheefstandTorsie ? "t" : ""}|${e}|${deel}`;
}

/**
 * De veldpatroonvarianten van `combinaties`, uit de per-geval-resultaten van
 * een LINEAIRE rekengang met `splitsing.input`. Zie de kop van dit bestand.
 *
 * `perCase` moet de deelgevallen bevatten (een deelgeval zonder werkzame last
 * ontbreekt en telt als nul). Bij een scheefstand tellen de punten van beide
 * richtingen mee: de horizontale metgezel kan het teken van een invloed omdraaien.
 */
export function veldpatroonVarianten(
  combinaties: readonly LoadCombination[],
  splitsing: VeldSplitsing,
  perCase: Map<number, SolverResult>,
  opties: { scheefstandOffset?: number } = {},
): VeldpatroonUitkomst {
  const delen = splitsing.deelgevallen;
  const delenVan = new Map<number, number[]>();
  for (const d of delen) {
    const lijst = delenVan.get(d.ouderId);
    if (lijst) lijst.push(d.id); else delenVan.set(d.ouderId, [d.id]);
  }

  // ── 1. Patronen uit de invloeden ───────────────────────────────────────
  const sets: (SolverResult | undefined)[][] = [delen.map((d) => perCase.get(d.id))];
  if (opties.scheefstandOffset !== undefined) {
    sets.push(delen.map((d) => perCase.get(d.id + opties.scheefstandOffset!)));
  }
  // Eerst de schaal per grootheid, zodat een punt waar alle invloeden in de
  // ruis liggen (N in een ligger op rollen) geen patroon aandraagt.
  const schaal = new Map<string, number>();
  for (const set of sets) {
    for (const { soort, r } of resultaatpunten(set)) {
      let s = 0;
      for (const v of r) s += Math.abs(v);
      if (s > (schaal.get(soort) ?? 0)) schaal.set(soort, s);
    }
  }
  const patronen = new Map<string, { leden: number[]; winst: number }>();
  for (const set of sets) {
    for (const { soort, r } of resultaatpunten(set)) {
      let som = 0, totaal = 0;
      for (const v of r) { som += Math.abs(v); totaal += v; }
      const s = schaal.get(soort) ?? 0;
      if (!(som > 1e-6 * s) || s === 0) continue;
      for (const teken of [1, -1] as const) {
        const leden = patroonIn(r, teken, som);
        let waarde = 0;
        for (const j of leden) waarde += teken * r[j];
        // Winst ten opzichte van de beste plaatsing die er al is: alle velden
        // (de combinatie zelf) of geen enkel veld.
        const winst = (waarde - Math.max(teken * totaal, 0)) / s;
        const sleutel = leden.join(",");
        const vorig = patronen.get(sleutel);
        if (!vorig) patronen.set(sleutel, { leden, winst });
        else if (winst > vorig.winst) vorig.winst = winst;
      }
    }
  }
  // "Alle velden" is de combinatie zelf.
  patronen.delete(delen.map((_, j) => j).join(","));

  const meldingen: string[] = [];
  let lijst = [...patronen.values()].sort((a, b) => b.winst - a.winst
    || a.leden.length - b.leden.length || a.leden.join(",").localeCompare(b.leden.join(",")));
  if (lijst.length > MAX_VELDPATRONEN) {
    const weg = lijst.slice(MAX_VELDPATRONEN);
    lijst = lijst.slice(0, MAX_VELDPATRONEN);
    meldingen.push(
      `Veldsgewijze plaatsing (NEN-EN 1991-1-1 6.2.1(1)): ${patronen.size} verschillende ` +
        `veldpatronen gevonden; de ${MAX_VELDPATRONEN} met de grootste winst zijn doorgerekend. ` +
        `De ${weg.length} weggelaten patronen verhogen een effect met hoogstens ` +
        `${pct(weg[0].winst)} van het grootste veranderlijke aandeel van die grootheid.`,
    );
  }
  // Vaste volgorde voor de namen en id's: minst belaste velden eerst.
  lijst.sort((a, b) => a.leden.length - b.leden.length
    || a.leden.join(",").localeCompare(b.leden.join(","), undefined, { numeric: true }));
  const gekozen = lijst.map((p) => p.leden.map((j) => delen[j].id));

  // ── 2. Varianten per combinatie ────────────────────────────────────────
  const gezien = new Set(combinaties.map((c) => combinatieSleutel(c, c.factors, delenVan)));
  const deelVan = new Map(delen.map((d) => [d.id, d] as const));
  const varianten: LoadCombination[] = [];
  let volgnummer = 0;
  for (const c of combinaties) {
    if (c.veldpatroon) continue;
    const ouders = [...delenVan.keys()].filter((id) => (c.factors.get(id) ?? 0) !== 0);
    if (ouders.length === 0) continue;
    for (const patroon of gekozen) {
      const factors = new Map(c.factors);
      for (const o of ouders) factors.delete(o);
      const belast = ouders.map((o) => ({ ouderId: o, velden: [] as (number | "overig")[] }));
      for (const id of patroon) {
        const d = deelVan.get(id)!;
        const f = c.factors.get(d.ouderId) ?? 0;
        if (f === 0) continue;
        factors.set(id, f);
        belast.find((b) => b.ouderId === d.ouderId)!.velden.push(d.veld ?? "overig");
      }
      const sleutel = combinatieSleutel(c, factors, delenVan);
      if (gezien.has(sleutel)) continue;
      gezien.add(sleutel);
      volgnummer++;
      const naamVan = (o: number) => splitsing.gesplitst.find((g) => g.ouderId === o)?.naam ?? String(o);
      const omschrijving = belast.map((b) =>
        `${naamVan(b.ouderId)} op ${b.velden.length === 0 ? "geen veld"
          : b.velden.map((v) => (v === "overig" ? "overig" : `veld ${v}`)).join(" + ")}`).join("; ");
      varianten.push({
        ...c,
        id: VELD_COMBO_OFFSET + volgnummer,
        name: `${c.name} — veldpatroon: ${omschrijving}`,
        formula: `${c.formula} — veldsgewijs: ${omschrijving} (NEN-EN 1991-1-1 6.2.1(1))`,
        factors,
        veldpatroon: { basisId: c.id, belast },
      });
    }
  }
  return { varianten, patronen: gekozen, meldingen };
}

/**
 * De combinaties met de veldpatroonvarianten elk direct achter hun basis, in
 * de volgorde van `combinaties`.
 */
export function voegVeldpatronenIn(
  combinaties: readonly LoadCombination[],
  varianten: readonly LoadCombination[],
): LoadCombination[] {
  if (varianten.length === 0) return [...combinaties];
  const perBasis = new Map<number, LoadCombination[]>();
  for (const v of varianten) {
    const b = v.veldpatroon!.basisId;
    const lijst = perBasis.get(b);
    if (lijst) lijst.push(v); else perBasis.set(b, [v]);
  }
  return combinaties.flatMap((c) => [c, ...(perBasis.get(c.id) ?? [])]);
}

// ── Meldingen vooraf ──────────────────────────────────────────────────────

export interface VeldpatroonMelding {
  caseId: number;
  niveau: "waarschuwing";
  tekst: string;
  /** Het aantal velden dat het geval belast. */
  velden: number;
}

/**
 * Een waarschuwing per veranderlijk vloergeval over twee of meer velden
 * wanneer de berekening NIET lineair is: dan worden er geen veldpatronen
 * gemaakt (superpositie is ongeldig) en mist de omhullende de ongunstige
 * plaatsing. Bij een lineaire berekening: geen melding — de varianten staan
 * met naam in de combinatielijst.
 *
 * Werkt op het MODEL (staven, opleggingen, lasten met `beamId`/`nodeId`), niet
 * op de solverinvoer, zodat de store hem zonder rekengang kan tonen.
 */
export function veldpatroonMeldingen(p: {
  beams: readonly { id: number; from: number; to: number }[];
  supports: readonly { nodeId: number; type: string }[];
  loadCases: readonly VeldGevalInvoer[];
  loads: readonly { caseId: number; beamId?: number; nodeId?: number; plateId?: number }[];
  lineair: boolean;
}): VeldpatroonMelding[] {
  if (p.lineair) return [];
  const zoek = veldenPerGeval(bepaalVelden(p));
  const uit: VeldpatroonMelding[] = [];
  for (const lc of p.loadCases) {
    if (!isVeldsgewijsGeval(lc)) continue;
    const groepen = new Set<string>();
    for (const l of p.loads) {
      if (l.caseId !== lc.id) continue;
      const v = l.beamId !== undefined ? zoek.staaf(l.beamId)
        : l.nodeId !== undefined ? zoek.knoop(l.nodeId) : null;
      groepen.add(v === null ? "overig" : String(v));
    }
    if (groepen.size < 2) continue;
    uit.push({
      caseId: lc.id,
      niveau: "waarschuwing",
      velden: groepen.size,
      tekst:
        `Belastinggeval ${lc.id} ("${lc.name}") is veranderlijke vloerbelasting op ${groepen.size} velden, ` +
        "maar wordt bij deze niet-lineaire berekening NIET veldsgewijs ongunstig geplaatst " +
        "(NEN-EN 1991-1-1 6.2.1(1); NEN-EN 1992-1-1 5.1.3, NEN-EN 1993-1-1 AB.2): superpositie " +
        "van veldpatronen is bij tweede orde, fysisch niet-lineair rekenen of trek-alleen staven ongeldig, en het geval " +
        "staat dus steeds op alle velden tegelijk. Veldmomenten en steunmomenten kunnen daardoor te " +
        "laag uitkomen. Reken eerste orde (dan worden de veldpatronen automatisch gemaakt), of maak " +
        "eigen combinaties met het geval per veld in een eigen belastinggeval.",
    });
  }
  return uit;
}

// ── Eén stap voor de rekengangen ──────────────────────────────────────────

/** Wat een rekengang over de veldsgewijze plaatsing aan de store teruggeeft. */
export interface VeldpatroonResultaat<T extends VeldGevalInvoer> {
  /** De varianten (zonder de basiscombinaties). */
  combinaties: LoadCombination[];
  /** De deelgevallen als belastinggevallen, voor de toetsbouwers. */
  gevallen: T[];
  /** Meldingen (afkapping van het aantal patronen); leeg = niets. */
  meldingen: string[];
  /**
   * De invoer met de deelgevallen (`splitsing.input`): de UGT-toets rekent
   * daarop elke variant als eigen P-Δ-som (issue #199 met #219).
   */
  input: MultiInput;
}

/**
 * Na een LINEAIRE rekengang met `splitsing.input`: de combinatielijst om mee
 * te combineren, te omhullen en te toetsen (de basiscombinaties met hun
 * varianten), en wat de store erover bewaart. Zonder splitsing: `combinaties`
 * ongewijzigd en `uitkomst` null. App (JS- en Rust-route) en sidecar delen
 * deze ene functie.
 */
export function veldpatronenUitkomst<T extends VeldGevalInvoer>(
  splitsing: VeldSplitsing | null,
  loadCases: readonly T[],
  combinaties: LoadCombination[],
  perCase: Map<number, SolverResult>,
): { combinaties: LoadCombination[]; uitkomst: VeldpatroonResultaat<T> | null } {
  if (!splitsing) return { combinaties, uitkomst: null };
  const sr = getScheefstandRichtingen(perCase);
  const { varianten, meldingen } = veldpatroonVarianten(combinaties, splitsing, perCase,
    sr ? { scheefstandOffset: sr.offset } : {});
  return {
    combinaties: voegVeldpatronenIn(combinaties, varianten),
    uitkomst: {
      combinaties: varianten,
      gevallen: deelgevalBelastinggevallen(splitsing, loadCases),
      meldingen,
      input: splitsing.input,
    },
  };
}

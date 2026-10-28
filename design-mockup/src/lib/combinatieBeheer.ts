/**
 * combinatieBeheer.ts — belastinggevallen en belastingcombinaties in de pas
 * houden, en luid melden waar dat niet lukt.
 *
 * HET PROBLEEM DAT HIER OPGELOST WORDT
 * Combinaties waren een losse tabel naast de belastinggevallen. Gemeten in de
 * basisaudit van september 2026:
 *  - een nieuw geval kreeg in geen enkele combinatie een factor en telde in
 *    alle toetsen als nul, zonder melding (nr 1);
 *  - een verwijderd geval liet zijn factoren achter, en het volgende nieuwe
 *    geval kreeg hetzelfde id en ERFDE die factoren — een blijvende last met
 *    de factoren van wind (nr 14);
 *  - eigen gewicht zonder blijvend geval kwam stil in het eerste geval terecht,
 *    met de factoren van dát type (ruw 7).
 *
 * WAT HIER GEBEURT
 *  - Elke wijziging aan de gevallen of aan de gevolgklasse houdt de
 *    STANDAARDcombinaties bij (`synchroniseerStandaard`): een nieuw blijvend
 *    geval krijgt γ_G, een nieuw veranderlijk geval krijgt zijn beurt als
 *    leidende last en zijn ψ als begeleidende. Zie `normcombinaties.ts`.
 *  - De combinaties van de WINDGENERATOR lopen op dezelfde momenten mee
 *    (`synchroniseerWindCombinaties`), ook als de generator zelf niet actief
 *    is — en na het openen van een project is hij dat nooit.
 *  - EIGEN combinaties (zonder kenmerk `standaard`) blijven van de gebruiker:
 *    de app past ze niet aan, behalve dat de factor van een verwijderd geval
 *    eruit verdwijnt — uit ALLE combinaties, standaard of eigen. Ze worden wel
 *    GECONTROLEERD, na elke wijziging (`meldingenBelastinggevallen`).
 *  - Id's lopen via tellers die nooit teruglopen en in het projectbestand
 *    meereizen. Een verwijderd id komt nooit terug.
 *  - Een projectbestand OPENEN (`openCombinatieStaat`): factoren voor gevallen
 *    die niet bestaan gaan eruit, en wat de app zelf ooit maakte maar nu anders
 *    zou maken wordt VERVANGEN (`vervangVerouderdeCombinaties`): de
 *    standaardset van versie 0.3.11 en ouder, standaardcombinaties met de
 *    factoren van een andere gevolgklasse, en verouderde combinaties van de
 *    windgenerator. In één stap, die ongedaan te maken is (`herstelCombinaties`).
 *
 * WAAROM VERVANGEN EN NIET ALLEEN MELDEN (besluit van de gebruiker, september 2026)
 * Tot deze correctie gold "melden, niet overschrijven": een oud bestand hield
 * zijn acht combinaties, met een melding bij het openen. Langs steeds nieuwe
 * routes gaf dat stil te lage getallen. Gemeten op een vrij opgelegde ligger
 * van 6 m, M = q·L²/8 = 4,5·q kNm:
 *  - oud bestand, G = 4, Q = 5, geval 3 = 10 kN/m, geval 3 daarna
 *    veranderlijk: UGT 112,725 waar (1,2·4 + 1,5·15)·4,5 = 122,850 kNm hoort,
 *    BGT 72,00 waar (4 + 15)·4,5 = 85,50 hoort — zonder FOUT;
 *  - hetzelfde oude bestand, één keer opgeslagen door de vorige versie (die
 *    schreef id-tellers): bij heropenen golden de oude combinaties als "bewust
 *    eigen" en verdween elke melding. CC3, G = 10, Q = 5: 87,75 waar
 *    (1,3·10 + 1,65·5)·4,5 = 95,625 kNm hoort (NB tabel NB.5);
 *  - in een project van die versie alle standaardcombinaties hernoemd en
 *    daarna geval 3 veranderlijk: 102,60 / 72,00 waar 122,85 / 85,50 hoort,
 *    zonder melding.
 * De keuze: bij het openen worden de oude standaardcombinaties vervangen door
 * de NB-set, met een duidelijke melding en ongedaan maken. Eigen, zelf
 * toegevoegde of hernoemde combinaties blijven staan en worden gecontroleerd.
 *
 * EEN COMBINATIESET IS NOOIT STIL EEN DEELVERZAMELING VAN DE JUISTE SET
 * Gemeten in september 2026 (na de eerste correctie): een oud projectbestand
 * met de acht combinaties van vóór september 2026, plus een nieuw veranderlijk
 * geval "Q vloer 2" in dezelfde categorie. De synchronisatie voegde alleen de
 * nieuwe opstellingen "… zonder Variabel (Q)" toe — de volledige 6.10b met
 * beide gevallen op γ_Q ontstond nooit: 89,10 kNm waar 122,85 hoort, en geen
 * melding. Hetzelfde na het hernoemen van "UGT 6.10b — Variabel (Q) leidend":
 * 117,45 waar 122,85 hoort. Daarom:
 *  - `synchroniseerStandaard` voegt nooit een opstelling met afwezige gevallen
 *    toe van een uitdrukking waarvan de VOLLEDIGE opstelling ontbreekt;
 *  - `ontbrekendeStandaardcombinaties` zoekt elke standaardcombinatie die
 *    ontbreekt en door geen andere combinatie met dezelfde factoren wordt
 *    vervangen — in een project met standaardcombinaties, ook als die allemaal
 *    hernoemd zijn (herkenbaar aan hun formule, zie `isAfgeleidVanStandaard`),
 *    en in een project met de oude standaardset die er na "Ongedaan maken" of
 *    via de MCP-weg weer in staat (`isOudeStandaardcombinatie`; gemeten zonder
 *    die controle: 87,75 kNm waar 95,625 hoort, stil);
 *  - `veranderlijkeFactorVerschillen` zoekt een combinatie waarin twee delen
 *    van één veranderlijke belasting verschillende factoren hebben: het spoor
 *    van een eigen set waarin een geval later van type veranderde;
 *  - `veranderlijkeBelastingenZonderLeiding` zoekt een veranderlijke belasting
 *    die in geen enkele UGT-combinatie overheerst — ook in een volledig eigen
 *    set;
 *  - `verouderdeWindCombinaties` zoekt gegenereerde windcombinaties die niet
 *    (meer) bij de gevallen en de gevolgklasse passen;
 *  - `blijvendeFactorAfwijkingen` zoekt een blijvend geval met factoren die bij
 *    geen blijvende belasting passen: het spoor van nr 14 in een eigen set
 *    (UGT 47,25 en BGT 30,60 kNm waar 48,60 en 36,00 horen).
 * Alle meldingen lopen via `meldingenBelastinggevallen`: de app, het rapport en
 * de MCP-waarschuwingen lezen dezelfde functie.
 *
 * PUUR
 * Geen React: de store roept deze functies aan, en de tests roepen precies
 * dezelfde functies aan. Zo bewijst een test het gedrag van de app en niet dat
 * van een nagebouwde kopie. De sidecar leest een projectbestand met dezelfde
 * `openCombinatieStaat`, zodat app en MCP niet uit elkaar kunnen lopen.
 */
import type { Load, LoadCase } from "../components/fem/femTypes";
import type { VertaalbareTekst } from "./vertaalbareTekst";
import {
  defaultCombinations,
  soortVanCombinatie,
  type LoadCombination,
} from "../components/fem/solver/combinations";
import {
  aantalGebruiksgevallen,
  basisSleutel,
  genereerStandaardCombinaties,
  GEVOLGKLASSEN,
  kFi,
  MAX_VRIJE_GEVALLEN,
  PARTIELE_FACTOREN,
  partieleFactoren,
  PSI_BRON,
  psiGebruik,
  psiKlimaat,
  STANDAARD_CATEGORIE,
  STANDAARD_GEVOLGKLASSE,
  type GevalInvoer,
  type Gevolgklasse,
  type StandaardCombinatie,
} from "../components/fem/solver/normcombinaties";
import { genereerWindCombinaties, WIND_COMBI_PREFIX } from "./wind/windGenerator";
import { STANDAARD_BIJLAGE, type NationaleBijlageCode } from "./normAanduidingen";
import { ontbrekendeBlijvendeCombinatie } from "./belastingduur";
import {
  EIGEN_GEWICHT_NAAM, eigenGewichtDoel, eigenGewichtGeval, isEigenGewichtGeval,
} from "./eigenGewicht";

// ── Staat ─────────────────────────────────────────────────────────────────

/** Alles wat samen moet veranderen: gevallen, combinaties, klasse, bijlage, tellers. */
export interface CombinatieStaat {
  loadCases: LoadCase[];
  combinations: LoadCombination[];
  gevolgklasse: Gevolgklasse;
  /**
   * De nationale bijlage waarvan de standaardcombinaties hun γ en ψ krijgen
   * (normnaad). Zelfde rol als de gevolgklasse: een wissel bouwt de
   * standaardset opnieuw op (`zetBijlage`), en een set uit een bestand met een
   * andere bijlage wordt bij het openen bijgewerkt.
   */
  bijlage: NationaleBijlageCode;
  /** Eerstvolgend id voor een belastinggeval; loopt nooit terug. */
  volgendGevalId: number;
  /** Eerstvolgend id voor een combinatie; loopt nooit terug. */
  volgendCombinatieId: number;
}

/**
 * Het eerstvolgende id: nooit lager dan de teller, en nooit gelijk aan een id
 * dat er nog staat. Het tweede vangt een projectbestand zonder tellers op
 * (ouder dan september 2026) en een generator die zelf id's uitdeelde.
 */
export function volgendVrijId(bestaande: readonly { id: number }[], teller: number): number {
  const hoogste = bestaande.reduce((m, x) => Math.max(m, x.id), 0);
  return Math.max(teller, hoogste + 1);
}

/** Is dit een combinatie van de windbelastinggenerator? */
export function isWindgeneratorCombinatie(c: Pick<LoadCombination, "name">): boolean {
  return c.name.startsWith(WIND_COMBI_PREFIX);
}

// ── Vergelijken ───────────────────────────────────────────────────────────

function gelijkeFactoren(a: ReadonlyMap<number, number>, b: ReadonlyMap<number, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, f] of a) if (b.get(id) !== f) return false;
  return true;
}

/**
 * Zelfde REKENINHOUD: naam, type, formule en factoren. Het id en het kenmerk
 * tellen niet — een BGT-combinatie heeft onder CC1 en CC3 dezelfde factoren,
 * en is dan voor de gebruiker niet "anders".
 */
export function gelijkeInhoud(
  a: Omit<LoadCombination, "id">,
  b: Omit<LoadCombination, "id">,
): boolean {
  return (
    a.name === b.name &&
    a.type === b.type &&
    a.formula === b.formula &&
    gelijkeFactoren(a.factors, b.factors)
  );
}

/** Dezelfde bevestigde eigen factoren (issue #196); beide zonder = gelijk. */
function gelijkeBevestiging(
  a: LoadCombination["bevestigdeFactoren"],
  b: LoadCombination["bevestigdeFactoren"],
): boolean {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  if (ka.length !== kb.length) return false;
  return ka.every((k) => (b as Record<string, number>)[k] === (a as Record<string, number>)[k]);
}

/**
 * Zelfde inhoud, zelfde kenmerk en dezelfde bevestiging. Het id telt niet. De
 * bevestiging is geen rekeninhoud (`gelijkeInhoud` kijkt er niet naar), maar
 * een combinatie die alleen haar bevestiging verloor is wel een andere.
 */
export function gelijkeCombinatie(
  a: Omit<LoadCombination, "id">,
  b: Omit<LoadCombination, "id">,
): boolean {
  return (
    gelijkeInhoud(a, b) &&
    a.standaard?.sleutel === b.standaard?.sleutel &&
    a.standaard?.soort === b.standaard?.soort &&
    a.standaard?.gevolgklasse === b.standaard?.gevolgklasse &&
    a.standaard?.bijlage === b.standaard?.bijlage &&
    gelijkeBevestiging(a.bevestigdeFactoren, b.bevestigdeFactoren)
  );
}

function gelijkeLijst(a: readonly LoadCombination[], b: readonly LoadCombination[]): boolean {
  return a.length === b.length && a.every((c, i) => c.id === b[i].id && gelijkeCombinatie(c, b[i]));
}

/**
 * De combinatie zonder factoren voor gevallen die niet (meer) bestaan — en
 * zonder hun bevestiging (issue #196): die hoort bij de factor.
 */
function zonderOnbekendeGevallen(c: LoadCombination, ids: ReadonlySet<number>): LoadCombination {
  const bevestigd = Object.keys(c.bevestigdeFactoren ?? {}).map(Number);
  if ([...c.factors.keys()].every((id) => ids.has(id)) && bevestigd.every((id) => ids.has(id))) return c;
  const { bevestigdeFactoren: _weg, ...rest } = c;
  const over = bevestigd.filter((id) => ids.has(id));
  return {
    ...rest,
    factors: new Map([...c.factors].filter(([id]) => ids.has(id))),
    ...(over.length > 0
      ? { bevestigdeFactoren: Object.fromEntries(over.map((id) => [id, c.bevestigdeFactoren![id]])) }
      : {}),
  };
}

function perSleutel(set: readonly StandaardCombinatie[]): Map<string, StandaardCombinatie> {
  return new Map(set.map((c) => [c.standaard.sleutel, c]));
}

/** Getal met decimale komma, zonder overbodige nullen. */
function nl(x: number): string {
  return String(Number(x.toFixed(3))).replace(".", ",");
}

function gelijk(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9;
}

/** Hoogstens `max` namen tussen aanhalingstekens, en hoeveel er nog zijn. */
function namenLijst(lijst: readonly { naam: string }[], max = 8): string {
  return (
    lijst.slice(0, max).map((x) => `"${x.naam}"`).join(", ") +
    (lijst.length > max ? ` en nog ${lijst.length - max}` : "")
  );
}

/** Een combinatie met factoren voor belastinggevallen die er niet (meer) zijn. */
export interface WeesFactor {
  combinatieId: number;
  naam: string;
  caseIds: number[];
}

/**
 * Haal de factoren weg van gevallen die niet in `loadCases` staan, en zeg
 * welke dat waren. Zo'n factor vermenigvuldigt geen enkele last, dus het
 * weghalen verandert geen uitkomst. Blijft hij staan, dan erft het volgende
 * geval met dat id hem: een blijvende last met de factoren van wind
 * (basisaudit nr 14). Een projectbestand van vóór september 2026 kan zulke
 * factoren dragen, want daar liet het verwijderen van een geval ze staan.
 */
export function verwijderWeesFactoren(
  combinations: readonly LoadCombination[],
  loadCases: readonly Pick<LoadCase, "id">[],
): { combinaties: LoadCombination[]; wees: WeesFactor[] } {
  const ids = new Set(loadCases.map((c) => c.id));
  const wees: WeesFactor[] = [];
  const combinaties = combinations.map((c) => {
    const onbekend = [...c.factors.keys()].filter((id) => !ids.has(id)).sort((a, b) => a - b);
    if (onbekend.length === 0) return c;
    wees.push({ combinatieId: c.id, naam: c.name, caseIds: onbekend });
    return zonderOnbekendeGevallen(c, ids);
  });
  return { combinaties, wees };
}

// ── De standaardset van versie 0.3.11 en ouder ────────────────────────────

/**
 * De acht standaardcombinaties van versie 0.3.11 en ouder, letterlijk zoals
 * `defaultCombinations()` ze maakte (combinations.ts op 47a4c37; die functie is
 * van 1f12189 tot en met 0.3.11 niet veranderd). Vaste case-id's G = 1, Q = 2,
 * S = 3, W = 4, vaste CC2-factoren en de door EN 1990 aanbevolen ψ uit tabel
 * A1.1 (ψ₀ = 0,7 / 0,7 / 0,6), ongeacht de gevallen van het project.
 */
export const OUDE_STANDAARDSET: readonly {
  naam: string;
  type: "uls" | "sls";
  factoren: Readonly<Record<number, number>>;
}[] = [
  { naam: "ULS 6.10a", type: "uls", factoren: { 1: 1.35, 2: 1.05, 3: 1.05, 4: 0.9 } },
  { naam: "ULS 6.10b (Q leidend)", type: "uls", factoren: { 1: 1.2, 2: 1.5, 3: 1.05, 4: 0.9 } },
  { naam: "ULS 6.10b (S leidend)", type: "uls", factoren: { 1: 1.2, 3: 1.5, 2: 1.05, 4: 0.9 } },
  { naam: "ULS 6.10b (W leidend)", type: "uls", factoren: { 1: 1.2, 4: 1.5, 2: 1.05, 3: 1.05 } },
  { naam: "ULS uplift", type: "uls", factoren: { 1: 0.9, 4: 1.5 } },
  { naam: "SLS Karakteristiek", type: "sls", factoren: { 1: 1.0, 2: 1.0, 3: 0.7, 4: 0.6 } },
  { naam: "SLS Frequent", type: "sls", factoren: { 1: 1.0, 2: 0.5, 3: 0.2 } },
  { naam: "SLS Quasi-permanent", type: "sls", factoren: { 1: 1.0, 2: 0.3 } },
];

const OUDE_GEVALLEN: Readonly<Record<number, string>> = {
  2: "het veranderlijke geval (Q)", 3: "het sneeuwgeval (S)", 4: "het windgeval (W)",
};

/**
 * Is `c` een ongewijzigde combinatie van de standaardset van versie 0.3.11 en
 * ouder? Herkend op NAAM én FACTORPATROON, per combinatie:
 *  - geen kenmerk `standaard` en geen combinatie van de windgenerator;
 *  - de naam is exact een van de acht namen van `OUDE_STANDAARDSET`, en het
 *    type (UGT/BGT) hoort bij die naam;
 *  - voor ELK belastinggeval dat in het project bestaat is de factor exact
 *    (tot op 1e-9) die van het oude patroon, waarbij "niet in het patroon" 0
 *    betekent. Een factor voor een geval dat niet bestaat telt niet: zo'n
 *    wees-factor vermenigvuldigt niets, en een bestand dat de vorige versie
 *    opsloeg had hem al weggehaald.
 * Het bestaan van id-tellers of een kenmerk speelt GEEN rol: de vorige versie
 * gebruikte `idTellers !== undefined` als teken van "bewust eigen", en juist
 * daardoor verdween bij heropenen elke melding (95,625 kNm werd stil 87,75).
 *
 * WAAROM DIT NIET TE RUIM IS
 *  - De namen zijn vaste teksten die de app zelf maakte, in een mengsel van
 *    Engels en Nederlands ("ULS 6.10b (S leidend)"); geen referentieproject en
 *    geen externe berekening in de repo draagt ze.
 *  - Het patroon legt de factoren op alle vier de vaste id's vast, inclusief
 *    de voorgebakken γ·ψ₀-waarden 1,05 en 0,9. Een combinatie uit een externe
 *    referentie-berekening heeft die niet op precies die gevallen.
 *  - Elke aanpassing — een andere naam, één andere factor, een factor voor een
 *    extra bestaand geval — maakt het een eigen combinatie, en die blijft staan.
 *  - Gecontroleerd op alle bestanden in design-mockup/referentie/,
 *    design-mockup/referentie-projecten/ en de gouden fixture: geen enkele
 *    combinatie wordt herkend (test-oude-projecten.mjs).
 */
export function isOudeStandaardcombinatie(
  c: LoadCombination,
  gevalIds: ReadonlySet<number>,
): boolean {
  if (c.standaard !== undefined || isWindgeneratorCombinatie(c)) return false;
  const oud = OUDE_STANDAARDSET.find((o) => o.naam === c.name);
  if (!oud || oud.type !== c.type) return false;
  for (const [id, f] of c.factors) {
    if (!gevalIds.has(id)) continue;
    if (!gelijk(f, oud.factoren[id] ?? 0)) return false;
  }
  for (const [sleutel, f] of Object.entries(oud.factoren)) {
    const id = Number(sleutel);
    if (!gevalIds.has(id)) continue;
    if (!gelijk(c.factors.get(id) ?? 0, f)) return false;
  }
  return true;
}

/**
 * Uitleg bij oude standaardcombinaties die NA het openen nog in een project
 * staan: na "Ongedaan maken", of doordat een aanvrager ze via de MCP-weg zelf
 * meestuurt. Bij het openen zelf zijn ze al vervangen.
 */
function tekstOudeSetInProject(oud: readonly LoadCombination[], klasse: Gevolgklasse): string {
  return (
    `Dit project rekent met ${oud.length} ongewijzigde combinatie(s) van de standaardset van versie ` +
    `0.3.11 en ouder: ${namenLijst(oud.map((c) => ({ naam: c.name })))}. Die set gaat uit van vaste ` +
    "belastinggevallen 1 t/m 4, vaste CC2-factoren en de door EN 1990 aanbevolen ψ-waarden (tabel A1.1) " +
    `in plaats van die van de Nederlandse bijlage, en volgt de belastinggevallen en gevolgklasse ${klasse} ` +
    "van dit project niet. Bij het openen vervangt de app zo'n set; hij staat er weer na \"Ongedaan " +
    'maken", of doordat hij zo is meegestuurd.'
  );
}

// ── De gevolgklasse bij het openen ────────────────────────────────────────

/**
 * De klasse waarvoor de standaardcombinaties in een lijst zijn opgesteld: het
 * kenmerk `standaard.gevolgklasse`, als ALLE standaardcombinaties dezelfde
 * klasse dragen. Geen kenmerk, of een mengsel van klassen: null.
 */
export function klasseUitKenmerk(
  combinations: readonly LoadCombination[] | null | undefined,
): Gevolgklasse | null {
  const klassen = new Set(
    (combinations ?? []).flatMap((c) => (c.standaard ? [c.standaard.gevolgklasse] : [])),
  );
  return klassen.size === 1 ? [...klassen][0] : null;
}

/**
 * De bijlage waarvoor de standaardcombinaties in een lijst zijn opgesteld: het
 * kenmerk `standaard.bijlage`, als ALLE standaardcombinaties dezelfde bijlage
 * dragen. Geen kenmerk, of een mengsel: null. Tegenhanger van
 * `klasseUitKenmerk`.
 */
export function bijlageUitKenmerk(
  combinations: readonly LoadCombination[] | null | undefined,
): NationaleBijlageCode | null {
  const bijlagen = new Set(
    (combinations ?? []).flatMap((c) => (c.standaard ? [c.standaard.bijlage] : [])),
  );
  return bijlagen.size === 1 ? [...bijlagen][0] : null;
}

/** Waar de gevolgklasse bij het openen vandaan kwam. */
export type KlasseBron = "bestand" | "verzoek" | "kenmerk" | "terugval";

/**
 * De gevolgklasse waarmee een projectbestand wordt geopend — één regel voor de
 * app (`loadProjectState`) en de MCP-weg (`leesGevolgklasse` in de sidecar):
 *  1. de klasse uit de projectgegevens van het bestand: de keuze van de
 *     constructeur;
 *  2. een uitdrukkelijk gevraagde klasse (alleen de MCP-weg: `gevolgklasse`
 *     in het verzoek);
 *  3. de klasse uit het kenmerk van de standaardcombinaties in het bestand
 *     (`klasseUitKenmerk`);
 *  4. de terugval: in de app de klasse van het project dat open stond, in de
 *     MCP-weg CC2 (NB tabel NB.4), met een waarschuwing.
 *
 * Waarom stap 3: het openen werkt standaardcombinaties met een ander
 * klassekenmerk bij naar de klasse waarmee geopend wordt. Zonder deze stap was
 * dat voor een bestand zonder klasse in de projectgegevens de TERUGVALklasse,
 * en rekende een CC3-set ineens met CC2-factoren. Gemeten (ligger 6 m, G = 10
 * en Q = 5 kN/m, M = 4,5·q): 87,75 kNm waar (1,3·10 + 1,65·5)·4,5 = 95,625 kNm
 * hoort (NB tabel NB.5) — terwijl de set uit het bestand zelf 95,625 gaf.
 */
export function gevolgklasseBijOpenen(p: {
  bestand?: Gevolgklasse | null;
  verzoek?: Gevolgklasse | null;
  combinations?: readonly LoadCombination[] | null;
  terugval: Gevolgklasse;
}): { klasse: Gevolgklasse; bron: KlasseBron } {
  if (p.bestand) return { klasse: p.bestand, bron: "bestand" };
  if (p.verzoek) return { klasse: p.verzoek, bron: "verzoek" };
  const kenmerk = klasseUitKenmerk(p.combinations);
  if (kenmerk) return { klasse: kenmerk, bron: "kenmerk" };
  return { klasse: p.terugval, bron: "terugval" };
}

// ── De combinaties van de windgenerator ───────────────────────────────────

/**
 * De combinaties die de windgenerator voor deze gevallen en deze klasse zou
 * maken, met case-id's zoals `windStore.pasToe` ze zet. `null` als er geen
 * gegenereerd windgeval is: dan valt er niets af te leiden.
 */
export function windCombinatiesVoor(
  loadCases: readonly GevalInvoer[],
  gevolgklasse: Gevolgklasse,
  bijlage: NationaleBijlageCode = STANDAARD_BIJLAGE,
): Omit<LoadCombination, "id">[] | null {
  const wind = loadCases.filter((c) => c.gegenereerd?.bron === "wind");
  if (wind.length === 0) return null;
  const idVan = new Map(wind.map((c) => [c.gegenereerd!.sleutel, c.id] as const));
  return genereerWindCombinaties(
    loadCases,
    wind.map((c) => ({ sleutel: c.gegenereerd!.sleutel, naam: c.name })),
    gevolgklasse,
    bijlage,
  ).map((g) => ({
    name: g.naam,
    type: g.type,
    formula: g.formule,
    factors: new Map<number, number>([
      ...g.factorenPerCaseId,
      [idVan.get(g.windSleutel)!, g.windFactor],
      // Vrijstaand dak: wrijving en kolomwind van dezelfde richting (issue #26).
      ...(g.windMeeSleutels ?? []).map((s) => [idVan.get(s)!, g.windFactor] as [number, number]),
    ]),
  }));
}

/**
 * Breng de combinaties van de windgenerator in lijn met de gevallen en de
 * gevolgklasse. Zonder gegenereerde combinaties, of zonder gegenereerd
 * windgeval om ze uit af te leiden, verandert er niets (het tweede meldt
 * `verouderdeWindCombinaties` als FOUT). Een combinatie met dezelfde naam houdt
 * haar id. De generatorinstellingen zijn hier niet nodig: de combinaties hangen
 * alleen van de gevallen en de klasse af (zie `genereerWindCombinaties`).
 *
 * Gemeten vóór deze functie (portaal 12 × 6 m, HEA200/IPE300): wind
 * gegenereerd, daarna "Q dak 2" (cat. A) erbij of de gevolgklasse naar CC3 —
 * de windcombinaties bleven zoals ze waren zolang de generator niet actief was,
 * en vier N–M-toestanden aan de kolomvoet werden door geen combinatie gedekt.
 */
export function synchroniseerWindCombinaties(staat: CombinatieStaat): CombinatieStaat {
  const huidig = staat.combinations.filter(isWindgeneratorCombinatie);
  if (huidig.length === 0) return staat;
  const verwacht = windCombinatiesVoor(staat.loadCases, staat.gevolgklasse, staat.bijlage);
  if (verwacht === null) return staat;
  if (huidig.length === verwacht.length && huidig.every((c, i) => gelijkeInhoud(c, verwacht[i]))) {
    return staat;
  }
  const idPerNaam = new Map<string, number>();
  for (const c of huidig) if (!idPerNaam.has(c.name)) idPerNaam.set(c.name, c.id);
  let volgendId = volgendVrijId(staat.combinations, staat.volgendCombinatieId);
  const gebruikt = new Set<number>();
  const nieuw = verwacht.map((c): LoadCombination => {
    const id = idPerNaam.get(c.name);
    if (id !== undefined && !gebruikt.has(id)) {
      gebruikt.add(id);
      return { ...c, id };
    }
    return { ...c, id: volgendId++ };
  });
  return {
    ...staat,
    combinations: [...staat.combinations.filter((c) => !isWindgeneratorCombinatie(c)), ...nieuw],
    volgendCombinatieId: volgendId,
  };
}

// ── Openen: verouderde combinaties vervangen ──────────────────────────────

/** Wat er bij het openen is vervangen, en hoe het terug kan. */
export interface CombinatieVervanging {
  gevolgklasse: Gevolgklasse;
  /** De nationale bijlage waarmee de vervangende set is opgesteld. */
  bijlage: NationaleBijlageCode;
  /** Herkende combinaties van de standaardset van versie 0.3.11 en ouder. */
  oudeStandaard: { id: number; naam: string }[];
  /** Standaardcombinaties uit het bestand met een andere rekeninhoud dan nu. */
  bijgewerkt: { id: number; naam: string }[];
  /** Combinaties van de windgenerator die opnieuw zijn afgeleid (de oude). */
  wind: { id: number; naam: string }[];
  /** Eigen combinaties die zijn blijven staan. */
  eigen: { id: number; naam: string }[];
  /** Aantal standaardcombinaties na de vervanging. */
  aantalStandaard: number;
  /** Aantal combinaties van de windgenerator na de vervanging. */
  aantalWind: number;
  /**
   * De combinaties vóór de vervanging, voor "Ongedaan maken"
   * (`herstelCombinaties`). Dit is de lijst zoals hij uit het bestand kwam,
   * zonder wees-factoren (die vermenigvuldigen niets, zie `verwijderWeesFactoren`).
   */
  voor: LoadCombination[];
  /** Eén alinea voor de melding, het rapport en de MCP-waarschuwingen. */
  samenvatting: string;
}

function tekstVervanging(v: Omit<CombinatieVervanging, "samenvatting" | "voor">): string {
  const bron = partieleFactoren(v.gevolgklasse, v.bijlage).bron;
  const delen: string[] = [];
  if (v.oudeStandaard.length > 0) {
    delen.push(
      `Bij het openen zijn ${v.oudeStandaard.length} belastingcombinatie(s) van de standaardset van ` +
        `versie 0.3.11 en ouder vervangen: ${namenLijst(v.oudeStandaard)}. Die set rekende met vaste ` +
        "belastinggevallen 1 t/m 4, vaste CC2-factoren en de door EN 1990 aanbevolen ψ-waarden (tabel " +
        "A1.1) in plaats van die van de Nederlandse bijlage, en volgde de belastinggevallen van het " +
        "project niet: een geval dat erbij kwam of van type veranderde, telde met verkeerde of geen factoren.",
    );
  }
  if (v.bijgewerkt.length > 0) {
    delen.push(
      `${v.bijgewerkt.length} standaardcombinatie(s) uit het bestand hoorden bij een andere gevolgklasse, ` +
        `een andere nationale bijlage of andere belastinggevallen en zijn bijgewerkt: ${namenLijst(v.bijgewerkt)}.`,
    );
  }
  if (v.wind.length > 0) {
    delen.push(
      `De ${v.wind.length} combinatie(s) van de windgenerator zijn opnieuw afgeleid uit de ` +
        `gegenereerde windgevallen, de overige belastinggevallen en gevolgklasse ${v.gevolgklasse}.`,
    );
  }
  delen.push(
    `Het project rekent nu met ${v.aantalStandaard} standaardcombinaties` +
      (v.aantalWind > 0 ? ` en ${v.aantalWind} van de windgenerator` : "") +
      `, afgeleid uit zijn belastinggevallen en gevolgklasse ${v.gevolgklasse}: γ uit NEN-EN 1990 ` +
      `${bron}, ψ uit tabel NB.2–A1.1.`,
  );
  if (v.eigen.length > 0) {
    delen.push(
      `${v.eigen.length} eigen combinatie(s) zijn blijven staan: ${namenLijst(v.eigen)}. De app past ` +
        "ze niet aan, maar controleert ze wel; zie de meldingen bij de belastinggevallen.",
    );
  }
  delen.push(
    "De uitkomsten kunnen daardoor afwijken van een berekening met de versie waarin het bestand is opgeslagen.",
  );
  return delen.join(" ");
}

/**
 * Vervang wat de app zelf ooit maakte maar nu anders zou maken:
 *  1. Staat er minstens één combinatie van de standaardset van versie 0.3.11
 *     en ouder in (`isOudeStandaardcombinatie`), dan gaan die combinaties én
 *     alle standaardcombinaties met kenmerk eruit, en komt de VOLLEDIGE
 *     standaardset voor deze gevallen en deze klasse ervoor in de plaats. Een
 *     standaardcombinatie met kenmerk houdt daarbij haar id als haar sleutel
 *     terugkomt. Een volledige set, geen aanvulling: een oude set naast een
 *     deel van de nieuwe gaf 89,10 kNm waar 122,85 hoort.
 *  2. Anders: standaardcombinaties met kenmerk krijgen de factoren van de
 *     huidige gevallen en klasse (`synchroniseerStandaard`). Een combinatie
 *     die de gebruiker had weggehaald komt niet terug; ontbreekt er daardoor
 *     een, dan meldt `meldingenBelastinggevallen` dat als FOUT.
 *  3. Altijd: de combinaties van de windgenerator (`synchroniseerWindCombinaties`).
 * Eigen combinaties blijven staan, in hun volgorde, na de standaardset.
 *
 * `vervanging` is null als er aan de rekeninhoud niets veranderde; de staat
 * kan dan nog een bijgewerkt kenmerk dragen (een BGT-combinatie met gelijke
 * factoren onder een andere klasse).
 */
export function vervangVerouderdeCombinaties(staat: CombinatieStaat): {
  staat: CombinatieStaat;
  vervanging: CombinatieVervanging | null;
} {
  const gevalIds = new Set(staat.loadCases.map((c) => c.id));
  const oud = staat.combinations.filter((c) => isOudeStandaardcombinatie(c, gevalIds));
  const metKenmerk = staat.combinations.filter((c) => c.standaard !== undefined);

  let volgend: CombinatieStaat;
  if (oud.length > 0) {
    const weg = new Set<LoadCombination>(oud);
    let volgendId = volgendVrijId(staat.combinations, staat.volgendCombinatieId);
    const idPerSleutel = new Map<string, number>();
    for (const c of metKenmerk) {
      const s = c.standaard!.sleutel;
      if (!idPerSleutel.has(s)) idPerSleutel.set(s, c.id);
    }
    const standaard = genereerStandaardCombinaties(staat.loadCases, staat.gevolgklasse, staat.bijlage)
      .map((c): LoadCombination => ({ ...c, id: idPerSleutel.get(c.standaard.sleutel) ?? volgendId++ }));
    const rest = staat.combinations.filter((c) => !weg.has(c) && c.standaard === undefined);
    volgend = synchroniseerWindCombinaties({
      ...staat,
      combinations: [...standaard, ...rest],
      volgendCombinatieId: volgendId,
    });
  } else if (metKenmerk.length > 0) {
    // Het VORIGE kenmerk telt hier niet: de sleutels van de huidige set
    // bepalen wat blijft. Een combinatie met het kenmerk van een andere
    // bijlage of klasse krijgt zo de factoren van de huidige.
    volgend = synchroniseerStandaard(staat, {
      loadCases: staat.loadCases, gevolgklasse: staat.gevolgklasse, bijlage: staat.bijlage,
    });
  } else {
    volgend = synchroniseerWindCombinaties(staat);
  }

  const naStandaard = new Map(
    volgend.combinations.filter((c) => c.standaard !== undefined).map((c) => [c.id, c] as const),
  );
  const bijgewerkt = metKenmerk.filter((c) => {
    const n = naStandaard.get(c.id);
    return !n || !gelijkeInhoud(c, n);
  });
  const windVoor = staat.combinations.filter(isWindgeneratorCombinatie);
  const windNa = volgend.combinations.filter(isWindgeneratorCombinatie);
  const windAnders =
    windVoor.length !== windNa.length || windVoor.some((c, i) => !gelijkeInhoud(c, windNa[i]));
  const lijst = (l: readonly LoadCombination[]) => l.map((c) => ({ id: c.id, naam: c.name }));

  if (oud.length === 0 && bijgewerkt.length === 0 && !windAnders) {
    return { staat: volgend, vervanging: null };
  }
  const kern = {
    gevolgklasse: staat.gevolgklasse,
    bijlage: staat.bijlage,
    oudeStandaard: lijst(oud),
    bijgewerkt: lijst(bijgewerkt),
    wind: windAnders ? lijst(windVoor) : [],
    eigen: lijst(volgend.combinations.filter((c) => c.standaard === undefined && !isWindgeneratorCombinatie(c))),
    aantalStandaard: naStandaard.size,
    aantalWind: windNa.length,
  };
  return {
    staat: volgend,
    vervanging: { ...kern, voor: staat.combinations, samenvatting: tekstVervanging(kern) },
  };
}

/**
 * "Ongedaan maken" van een vervanging: de combinaties van vóór de vervanging
 * terug, precies zoals ze waren. Is sindsdien een belastinggeval verwijderd,
 * dan gaat de factor van dat geval eruit (anders zou een nieuw geval hem
 * erven, basisaudit nr 14). De combinatieteller loopt niet terug.
 */
export function herstelCombinaties(
  staat: CombinatieStaat,
  voor: readonly LoadCombination[],
): CombinatieStaat {
  const ids = new Set(staat.loadCases.map((c) => c.id));
  const combinations = voor.map((c) => zonderOnbekendeGevallen(c, ids));
  return {
    ...staat,
    combinations,
    volgendCombinatieId: Math.max(staat.volgendCombinatieId, volgendVrijId(combinations, 1)),
  };
}

/**
 * Een project openen: gevallen, combinaties, klasse en tellers in één keer. De
 * store (`loadProjectState`) en de sidecar (projectbestand via `project_path`)
 * roepen precies deze functie aan, zodat een test het gedrag van beide bewijst.
 *
 *  - Zonder combinaties in het bestand (v1, of Nieuw): de standaardset van
 *    zijn gevallen.
 *  - Met combinaties: eerst gaan factoren voor gevallen die niet bestaan eruit
 *    (`verwijderWeesFactoren`), daarna wordt vervangen wat verouderd is
 *    (`vervangVerouderdeCombinaties`). `vervanging` beschrijft dat, met de
 *    lijst van ervoor om het ongedaan te maken.
 *  - `afwijking`: wat er daarna nog te melden is — de weggehaalde
 *    wees-factoren, en een blijvend geval met vreemde factoren in een eigen
 *    combinatie.
 *  - De geval-teller komt boven het hoogste id van de gevallen, boven de teller
 *    uit het bestand, én boven elk id dat in een factortabel van het bestand
 *    stond. Het laatste is de tweede grendel tegen nr 14: een bestand zonder
 *    tellers waarin het hoogste geval al verwijderd was, gaf anders dat id
 *    opnieuw uit (gemeten: HEA200, "Permanent afbouw" kreeg id 4 en erfde de
 *    windfactoren — UGT 47,25 en BGT 30,60 kNm waar 48,60 en 36,00 horen).
 */
export function openCombinatieStaat(p: {
  loadCases: LoadCase[];
  combinations?: LoadCombination[];
  gevolgklasse: Gevolgklasse;
  /**
   * De bijlage van het project. Weglaten = de enige gevulde bijlage, zoals
   * `#[serde(default)]` aan de Rust-kant.
   */
  bijlage?: NationaleBijlageCode;
  idTellers?: { belastinggeval?: number; combinatie?: number };
  /**
   * De lasten van het project. Alleen voor de melding over weggehaalde
   * wees-factoren: staat er een last in zo'n niet-bestaand geval, dan zegt de
   * melding dat in plaats van "ze vermenigvuldigden geen enkele last".
   * Weglaten = onbekend; de melding beweert dan niets over lasten.
   */
  loads?: readonly Pick<Load, "id" | "caseId">[];
}): {
  staat: CombinatieStaat;
  afwijking: CombinatieAfwijking | null;
  vervanging: CombinatieVervanging | null;
} {
  const gevalTeller = volgendVrijId(p.loadCases, p.idTellers?.belastinggeval ?? 1);
  const bijlage = p.bijlage ?? STANDAARD_BIJLAGE;
  if (!p.combinations) {
    const combinations = defaultCombinations(p.loadCases, p.gevolgklasse, bijlage);
    return {
      staat: {
        loadCases: p.loadCases,
        combinations,
        gevolgklasse: p.gevolgklasse,
        bijlage,
        volgendGevalId: gevalTeller,
        volgendCombinatieId: volgendVrijId(combinations, p.idTellers?.combinatie ?? 1),
      },
      afwijking: null,
      vervanging: null,
    };
  }
  const { combinaties, wees } = verwijderWeesFactoren(p.combinations, p.loadCases);
  const hoogsteFactorSleutel = p.combinations
    .flatMap((c) => [...c.factors.keys()])
    .filter((id) => Number.isFinite(id))
    .reduce((m, id) => Math.max(m, id), 0);
  const { staat, vervanging } = vervangVerouderdeCombinaties({
    loadCases: p.loadCases,
    combinations: combinaties,
    gevolgklasse: p.gevolgklasse,
    bijlage,
    volgendGevalId: Math.max(gevalTeller, hoogsteFactorSleutel + 1),
    volgendCombinatieId: volgendVrijId(combinaties, p.idTellers?.combinatie ?? 1),
  });
  return {
    staat,
    vervanging,
    afwijking: beoordeelCombinatiesBijOpenen({
      combinations: staat.combinations,
      loadCases: p.loadCases,
      weesFactoren: wees,
      loads: p.loads,
      bijlage,
    }),
  };
}

// ── Bijhouden ─────────────────────────────────────────────────────────────

/**
 * Breng de standaardcombinaties in lijn met `staat.loadCases`,
 * `staat.gevolgklasse` en `staat.bijlage`, gegeven hoe gevallen, klasse en
 * bijlage `vorig` waren. De
 * combinaties van de windgenerator lopen mee (`synchroniseerWindCombinaties`).
 *
 * Regels:
 *  - Een standaardcombinatie waarvan de sleutel nog geldt, krijgt de nieuwe
 *    naam, formule en factoren en HOUDT haar id (resultaten, selectie en de
 *    rapportverwijzing blijven kloppen).
 *  - Een standaardcombinatie waarvan de sleutel niet meer geldt (de leidende
 *    last is verwijderd of van type veranderd), verdwijnt.
 *  - Een sleutel die nieuw is — hij bestond onder `vorig` niet — wordt
 *    toegevoegd met een nieuw id. Een sleutel die onder `vorig` WEL bestond
 *    maar niet in de lijst staat, heeft de gebruiker zelf weggehaald of tot een
 *    eigen combinatie gemaakt; die komt niet ongevraagd terug.
 *  - NOOIT EEN DEEL ZONDER HET GEHEEL: een nieuwe opstelling met afwezige
 *    gevallen ("…|zonder:…") komt er alleen bij als de volledige opstelling van
 *    dezelfde uitdrukking en leidende last in de lijst staat of nu zelf wordt
 *    toegevoegd. Anders zou een set waarin de volledige opstelling ontbreekt
 *    na een nieuw veranderlijk geval alleen "… zonder Variabel (Q)"-combinaties
 *    krijgen: het nieuwe geval telt dan wél ergens mee, de FOUT dat het nergens
 *    meetelt verdwijnt, en de combinatie met beide gevallen op γ_Q ontbreekt
 *    stil (gemeten 89,10 kNm waar 122,85 hoort). Wat er dan ontbreekt, meldt
 *    `meldingenBelastinggevallen` als FOUT.
 *  - Eigen combinaties blijven staan; alleen factoren van verdwenen gevallen
 *    gaan eruit.
 * Volgorde: de standaardset in haar vaste volgorde, daarna de eigen
 * combinaties in hun oorspronkelijke volgorde. Verandert er niets, dan komt
 * dezelfde array terug (geen nieuwe identiteit, dus geen herberekening).
 */
export function synchroniseerStandaard(
  staat: CombinatieStaat,
  vorig: { loadCases: readonly LoadCase[]; gevolgklasse: Gevolgklasse; bijlage: NationaleBijlageCode },
): CombinatieStaat {
  const vorigeSleutels = perSleutel(
    genereerStandaardCombinaties(vorig.loadCases, vorig.gevolgklasse, vorig.bijlage),
  );
  const nieuweSet = genereerStandaardCombinaties(staat.loadCases, staat.gevolgklasse, staat.bijlage);
  const nieuwPerSleutel = perSleutel(nieuweSet);
  const geldigeIds = new Set(staat.loadCases.map((c) => c.id));
  let volgendId = volgendVrijId(staat.combinations, staat.volgendCombinatieId);

  const aanwezig = new Map<string, LoadCombination>();
  const eigen: LoadCombination[] = [];
  for (const c of staat.combinations) {
    if (c.standaard) {
      const n = nieuwPerSleutel.get(c.standaard.sleutel);
      if (!n || aanwezig.has(c.standaard.sleutel)) continue;
      const bijgewerkt: LoadCombination = { ...n, id: c.id };
      aanwezig.set(c.standaard.sleutel, gelijkeCombinatie(c, bijgewerkt) ? c : bijgewerkt);
    } else {
      eigen.push(zonderOnbekendeGevallen(c, geldigeIds));
    }
  }

  // De volledige opstellingen (sleutel zonder "|zonder:") in de nieuwe set, en
  // welke daarvan na deze stap in de lijst staan: al aanwezig, of nieuw en dus
  // hieronder toegevoegd.
  const volledigInSet = new Set<string>();
  const volledigInLijst = new Set<string>();
  for (const n of nieuweSet) {
    const s = n.standaard.sleutel;
    if (basisSleutel(s) !== s) continue;
    volledigInSet.add(s);
    if (aanwezig.has(s) || !vorigeSleutels.has(s)) volledigInLijst.add(s);
  }

  const standaard: LoadCombination[] = [];
  for (const n of nieuweSet) {
    const s = n.standaard.sleutel;
    const bestaand = aanwezig.get(s);
    if (bestaand) {
      standaard.push(bestaand);
      continue;
    }
    if (vorigeSleutels.has(s)) continue; // weggehaald of eigen gemaakt
    const basis = basisSleutel(s);
    // Nooit een deel zonder het geheel. Staat de volledige opstelling niet in
    // de set (samengevallen met een andere combinatie, zie `ontdubbel`), dan
    // is er geen geheel om op te wachten.
    if (basis !== s && volledigInSet.has(basis) && !volledigInLijst.has(basis)) continue;
    standaard.push({ ...n, id: volgendId++ });
  }

  const combinations = [...standaard, ...eigen];
  return synchroniseerWindCombinaties({
    ...staat,
    combinations: gelijkeLijst(combinations, staat.combinations) ? staat.combinations : combinations,
    volgendCombinatieId: volgendId,
  });
}

/**
 * Nieuw belastinggeval. Het id komt van de teller — nooit het id van een
 * eerder verwijderd geval. Standaard is het type "other": de app raadt geen
 * type, en `meldingenBelastinggevallen` meldt het geval tot de gebruiker
 * kiest.
 */
export function voegBelastinggevalToe(
  staat: CombinatieStaat,
  naam: string,
  type: LoadCase["type"] = "other",
): { staat: CombinatieStaat; id: number } {
  const id = volgendVrijId(staat.loadCases, staat.volgendGevalId);
  const vorig = { loadCases: staat.loadCases, gevolgklasse: staat.gevolgklasse, bijlage: staat.bijlage };
  const volgend: CombinatieStaat = {
    ...staat,
    loadCases: [...staat.loadCases, { id, name: naam, type }],
    volgendGevalId: id + 1,
  };
  return { staat: synchroniseerStandaard(volgend, vorig), id };
}

/** Naam, type of categorie van een geval wijzigen; de standaardset volgt. */
export function wijzigBelastinggeval(
  staat: CombinatieStaat,
  id: number,
  patch: Partial<Omit<LoadCase, "id">>,
): CombinatieStaat {
  if (!staat.loadCases.some((c) => c.id === id)) return staat;
  const vorig = { loadCases: staat.loadCases, gevolgklasse: staat.gevolgklasse, bijlage: staat.bijlage };
  const volgend: CombinatieStaat = {
    ...staat,
    loadCases: staat.loadCases.map((c) => (c.id === id ? zonderLosKenmerk({ ...c, ...patch, id }) : c)),
  };
  return synchroniseerStandaard(volgend, vorig);
}

/**
 * Het kenmerk `eigenGewicht` hoort alleen op een blijvend geval. Wijzigt de
 * gebruiker het type, dan gaat het kenmerk eraf: een veranderlijk geval dat
 * stil het eigen gewicht draagt zou het ψ₂ = 0,3 geven waar 1,0 hoort. De
 * store zet het eigen gewicht dan uit en meldt dat
 * (`eigenGewichtNaGevalWijziging`); hier blijft alleen de gevallenlijst heel.
 */
function zonderLosKenmerk(c: LoadCase): LoadCase {
  if (!isEigenGewichtGeval(c) || c.type === "dead") return c;
  const { eigenGewicht: _weg, ...rest } = c;
  return rest;
}

/**
 * HET AANBOD VAN ISSUE #42: geef een project dat het eigen gewicht nog in het
 * eerste blijvende geval heeft een eigen geval "Eigen gewicht", vooraan in de
 * lijst. Alleen op verzoek van de gebruiker — bij het openen wordt niets stil
 * omgezet.
 *
 * De uitkomsten van de combinaties veranderen er niet door:
 *  - standaardcombinaties geven ELK blijvend geval dezelfde γ_G
 *    (`synchroniseerStandaard` bouwt ze op uit de nieuwe gevallenlijst);
 *  - eigen combinaties en combinaties van de windgenerator krijgen voor het
 *    nieuwe geval de factor van het geval waar het eigen gewicht UIT komt.
 *    Zonder die stap zou het eigen gewicht in een eigen combinatie stil als
 *    nul tellen.
 * Het eigen gewicht verhuist dus van geval A (factor f) naar geval N (factor
 * f): f·(lasten + eg) wordt f·lasten + f·eg.
 *
 * Geeft dezelfde staat terug als er niets te verplaatsen valt (er is al een
 * gekenmerkt geval, of er is geen blijvend geval).
 */
export function verplaatsEigenGewichtNaarEigenGeval(
  staat: CombinatieStaat,
): { staat: CombinatieStaat; id: number | null; vanId: number | null } {
  const doel = eigenGewichtDoel(staat.loadCases);
  if (doel.soort !== "eersteBlijvend") return { staat, id: null, vanId: null };
  const vanId = doel.geval.id;
  const id = volgendVrijId(staat.loadCases, staat.volgendGevalId);
  const vorig = { loadCases: staat.loadCases, gevolgklasse: staat.gevolgklasse, bijlage: staat.bijlage };
  const volgend: CombinatieStaat = {
    ...staat,
    loadCases: [
      { id, name: vrijeNaam(staat.loadCases, EIGEN_GEWICHT_NAAM), type: "dead", eigenGewicht: true },
      ...staat.loadCases,
    ],
    combinations: staat.combinations.map((c) => {
      if (c.standaard) return c;
      const f = c.factors.get(vanId) ?? 0;
      if (f === 0) return c;
      const factors = new Map(c.factors);
      factors.set(id, f);
      // Een bevestigde factor blijft bevestigd: het is dezelfde factor, nu
      // over twee gevallen (issue #196). Anders kwam de FOUT stil terug.
      return isBevestigdeFactor(c, vanId)
        ? { ...c, factors, bevestigdeFactoren: { ...c.bevestigdeFactoren, [id]: f } }
        : { ...c, factors };
    }),
    volgendGevalId: id + 1,
  };
  const gesynchroniseerd = synchroniseerStandaard(volgend, vorig);
  // De windgenerator bouwt zijn combinaties opnieuw op uit de gevallen; die
  // kennen het nieuwe blijvende geval dan al. Waar hij ze liet staan, staat
  // de gekopieerde factor er nog.
  return { staat: gesynchroniseerd, id, vanId };
}

/** `naam`, of `naam (2)`, `naam (3)`… als die naam al bestaat. */
function vrijeNaam(gevallen: readonly Pick<LoadCase, "name">[], naam: string): string {
  const bezet = new Set(gevallen.map((c) => c.name));
  if (!bezet.has(naam)) return naam;
  for (let n = 2; ; n++) if (!bezet.has(`${naam} (${n})`)) return `${naam} (${n})`;
}

/**
 * Geval verwijderen. De factor van dit id verdwijnt uit ELKE combinatie, ook
 * uit eigen combinaties: een factor voor een geval dat er niet is, is een
 * wees die het volgende geval met hetzelfde id zou erven. Het laatste geval
 * blijft staan — een model zonder belastinggeval kent de store niet.
 */
export function verwijderBelastinggeval(staat: CombinatieStaat, id: number): CombinatieStaat {
  if (!staat.loadCases.some((c) => c.id === id)) return staat;
  if (staat.loadCases.length <= 1) return staat;
  const vorig = { loadCases: staat.loadCases, gevolgklasse: staat.gevolgklasse, bijlage: staat.bijlage };
  const volgend: CombinatieStaat = {
    ...staat,
    loadCases: staat.loadCases.filter((c) => c.id !== id),
    // De teller mag nooit onder het verwijderde id uitkomen.
    volgendGevalId: Math.max(staat.volgendGevalId, id + 1),
  };
  return synchroniseerStandaard(volgend, vorig);
}

/** Andere gevolgklasse: de factoren van de standaardcombinaties volgen NB.4/NB.5. */
export function zetGevolgklasse(staat: CombinatieStaat, gevolgklasse: Gevolgklasse): CombinatieStaat {
  if (gevolgklasse === staat.gevolgklasse) return staat;
  const vorig = { loadCases: staat.loadCases, gevolgklasse: staat.gevolgklasse, bijlage: staat.bijlage };
  return synchroniseerStandaard({ ...staat, gevolgklasse }, vorig);
}

/**
 * Andere nationale bijlage: de standaardcombinaties krijgen γ en ψ van die
 * bijlage (normnaad). Dezelfde route als `zetGevolgklasse`: een
 * standaardcombinatie houdt haar id en krijgt de nieuwe factoren, een eigen
 * combinatie blijft staan. Zonder deze stap zou een project na een
 * bijlagewissel met de γ en ψ van de vorige bijlage blijven rekenen, terwijl
 * de kernen de nieuwe bijlage lezen.
 */
export function zetBijlage(staat: CombinatieStaat, bijlage: NationaleBijlageCode): CombinatieStaat {
  if (bijlage === staat.bijlage) return staat;
  const vorig = { loadCases: staat.loadCases, gevolgklasse: staat.gevolgklasse, bijlage: staat.bijlage };
  return synchroniseerStandaard({ ...staat, bijlage }, vorig);
}

/**
 * De expliciete actie bij een project met afwijkende combinaties: vervang
 * alles door de standaardset. Alleen de combinaties van de windgenerator
 * blijven staan — die horen bij haar gevallen, en worden hier meteen opnieuw
 * afgeleid.
 */
export function vervangDoorStandaard(staat: CombinatieStaat): CombinatieStaat {
  const geldigeIds = new Set(staat.loadCases.map((c) => c.id));
  let volgendId = volgendVrijId(staat.combinations, staat.volgendCombinatieId);
  const standaard = genereerStandaardCombinaties(staat.loadCases, staat.gevolgklasse, staat.bijlage)
    .map((c) => ({ ...c, id: volgendId++ }));
  const wind = staat.combinations
    .filter(isWindgeneratorCombinatie)
    .map((c) => zonderOnbekendeGevallen(c, geldigeIds));
  return synchroniseerWindCombinaties({
    ...staat,
    combinations: [...standaard, ...wind],
    volgendCombinatieId: volgendId,
  });
}

export function voegCombinatieToe(
  staat: CombinatieStaat,
  combo: Omit<LoadCombination, "id">,
): CombinatieStaat {
  const id = volgendVrijId(staat.combinations, staat.volgendCombinatieId);
  // Een handmatig toegevoegde combinatie is nooit een standaardcombinatie.
  const { standaard: _weg, ...rest } = combo;
  return {
    ...staat,
    combinations: [...staat.combinations, { ...rest, id }],
    volgendCombinatieId: id + 1,
  };
}

/**
 * Een combinatie wijzigen. Elke wijziging maakt er een EIGEN combinatie van:
 * het kenmerk `standaard` verdwijnt, en de app past haar daarna niet meer aan.
 * Anders zou de volgende wijziging aan een belastinggeval de aanpassing van
 * de gebruiker stil terugdraaien. De formule blijft staan; daaraan herkent
 * `isAfgeleidVanStandaard` dat de set uit de standaardset komt.
 *
 * De bevestiging van eigen factoren (issue #196) hoort bij de exacte waarde:
 * een factor die verandert verliest haar, de andere houden haar. Ook terug
 * naar de oude waarde brengt haar niet stil terug — bevestigen is een
 * handeling, geen eigenschap van een getal. Een ander type (UGT ↔ BGT) laat
 * de hele bevestiging vallen: dezelfde factor betekent dan iets anders.
 */
export function wijzigCombinatie(
  staat: CombinatieStaat,
  id: number,
  patch: Partial<Omit<LoadCombination, "id">>,
): CombinatieStaat {
  if (!staat.combinations.some((c) => c.id === id)) return staat;
  return {
    ...staat,
    combinations: staat.combinations.map((c) => {
      if (c.id !== id) return c;
      const { standaard: _weg, bevestigdeFactoren: _bevestigd, ...rest } = { ...c, ...patch };
      const typeAnders = patch.type !== undefined && patch.type !== c.type;
      const over = typeAnders
        ? []
        : Object.entries(c.bevestigdeFactoren ?? {}).filter(([caseId, b]) => {
            const f = rest.factors.get(Number(caseId)) ?? 0;
            return f !== 0 && gelijk(f, b);
          });
      return { ...rest, id, ...(over.length > 0 ? { bevestigdeFactoren: Object.fromEntries(over) } : {}) };
    }),
  };
}

export function verwijderCombinatie(staat: CombinatieStaat, id: number): CombinatieStaat {
  if (!staat.combinations.some((c) => c.id === id)) return staat;
  return {
    ...staat,
    combinations: staat.combinations.filter((c) => c.id !== id),
    volgendCombinatieId: Math.max(staat.volgendCombinatieId, id + 1),
  };
}

// ── Eigen factoren, bewust gekozen (issue #196) ────────────────────────────
//
// HET PROBLEEM
// Een project met bewust gekozen factoren — de referentieprojecten P01, P03
// en P04 rekenen met K_FI = 0,9 maal NB tabel NB.4: 1,22 / 1,08 voor G,
// 1,35 / 0,54 voor Q — kreeg bij het openen te horen dat het patroon "ontstaat
// in een projectbestand van vóór september 2026" en dat de last "met de
// verkeerde factoren" telt. Er was geen manier om de factoren te houden: een
// blijvende FOUT in de projectboom, het venster en het rapport, en MCP
// validate gaf ok:false.
//
// DE KEUZE
//  - Bevestigen legt per combinatie de huidige factoren vast
//    (`LoadCombination.bevestigdeFactoren`). Een bevestiging geldt per factor
//    en alleen voor PRECIES die waarde (`isBevestigdeFactor`); een gewijzigde
//    factor verliest haar (`wijzigCombinatie`). Het idTellers-spoor van de
//    vorige versie ("tellers = bewust eigen") verdween juist omdat het aan
//    niets gebonden was; dit is aan de waarde gebonden.
//  - Een bevestigde factor geeft geen FOUT meer in `blijvendeFactorAfwijkingen`;
//    het rapport en de MCP-weg vermelden hem als bewust gekozen
//    (`bevestigdeEigenFactoren`).
//  - Een eigen combinatie met bevestigde factoren VERVANGT de
//    standaardcombinatie waarvan ze is afgeleid (zelfde formule, zelfde
//    gevallen, zelfde type, in de BGT dezelfde soort) als ze alleen in
//    bevestigde factoren afwijkt (`ontbrekendeStandaardcombinaties`); na een
//    andere gevolgklasse niet meer. Waarom: die controle bewaakt dat er
//    geen OPSTELLING ontbreekt (de set is nooit stil een deel van de juiste
//    set), niet welke waarde een factor heeft. Een op K_FI gezette afgeleide set
//    heeft elke opstelling; alleen de waarden wijken af, en die zijn per
//    waarde bevestigd. Een opstelling die er niet is — een verwijderde
//    combinatie, of een nieuw geval dat nieuwe opstellingen vraagt — blijft een
//    FOUT. De klasse op CC1 zetten is geen uitweg: NB.5 geeft voor CC1 1,2 / 1,1
//    en niet 0,9 × 1,35 / 0,9 × 1,2.
//  - Niet bevestigd worden: standaardcombinaties en combinaties van de
//    windgenerator (die houdt de app zelf bij), en de ongewijzigde
//    standaardset van versie 0.3.11 en ouder (die wordt vervangen, niet
//    gehouden; daar hoort "Vervang door standaardcombinaties" bij).
//  - De berekening verandert niet: de bevestiging is geen factor.

/**
 * Is de factor van geval `caseId` in combinatie `c` bevestigd? Alleen als de
 * bevestiging precies de huidige factor noemt (tot op 1e-9) en die niet 0 is.
 */
export function isBevestigdeFactor(
  c: Pick<LoadCombination, "factors" | "bevestigdeFactoren">,
  caseId: number,
): boolean {
  const f = c.factors.get(caseId) ?? 0;
  const b = c.bevestigdeFactoren?.[caseId];
  return f !== 0 && typeof b === "number" && gelijk(b, f);
}

/** Heeft deze combinatie minstens één geldig bevestigde factor? */
export function heeftBevestigdeFactoren(c: Pick<LoadCombination, "factors" | "bevestigdeFactoren">): boolean {
  return Object.keys(c.bevestigdeFactoren ?? {}).some((id) => isBevestigdeFactor(c, Number(id)));
}

/** Waarom deze combinatie niet bevestigd kan worden; null = het kan. */
/**
 * Kan "Behoud eigen factoren" deze afwijking oplossen? Ja als minstens één
 * combinatie met een afwijkende factor bevestigd kan worden. Een ongewijzigde
 * combinatie van de oude standaardset kan dat niet (`redenNietBevestigbaar`):
 * daar zou de knop niets doen, dus wordt hij niet aangeboden.
 */
function afwijkingBevestigbaar(
  a: BlijvendeAfwijking,
  combinations: readonly LoadCombination[],
  gevalIds: ReadonlySet<number>,
): boolean {
  return a.regels.some((r) => {
    const c = combinations.find((x) => x.id === r.combinatieId);
    return c !== undefined && redenNietBevestigbaar(c, gevalIds) === null;
  });
}

function redenNietBevestigbaar(c: LoadCombination, gevalIds: ReadonlySet<number>): string | null {
  if (c.standaard) {
    return "een standaardcombinatie: de app houdt haar factoren bij volgens de NB-tabellen. Wijzig haar " +
      "eerst; dan is het een eigen combinatie";
  }
  if (isWindgeneratorCombinatie(c)) {
    return "een combinatie van de windgenerator: die volgt de gegenereerde windgevallen";
  }
  if (isOudeStandaardcombinatie(c, gevalIds)) {
    return 'een ongewijzigde combinatie van de standaardset van versie 0.3.11 en ouder: kies "Vervang door ' +
      'standaardcombinaties" in plaats van haar te houden';
  }
  return null;
}

/**
 * "Behoud eigen factoren": leg de huidige factoren (≠ 0) van deze combinaties
 * vast als bewust gekozen. Zonder `ids`: elke combinatie die bevestigd kan
 * worden (zie `redenNietBevestigbaar`); een combinatie die dat niet kan, komt
 * in `overgeslagen` met de reden. Verandert er niets, dan komt dezelfde staat
 * terug.
 */
export function bevestigEigenFactoren(
  staat: CombinatieStaat,
  ids?: readonly number[],
): {
  staat: CombinatieStaat;
  bevestigd: number[];
  overgeslagen: { id: number; naam: string; reden: string }[];
} {
  const gevalIds = new Set(staat.loadCases.map((c) => c.id));
  const gevraagd = ids ? new Set(ids) : null;
  const bevestigd: number[] = [];
  const overgeslagen: { id: number; naam: string; reden: string }[] = [];
  let veranderd = false;
  const combinations = staat.combinations.map((c) => {
    if (gevraagd && !gevraagd.has(c.id)) return c;
    const reden = redenNietBevestigbaar(c, gevalIds);
    if (reden) {
      overgeslagen.push({ id: c.id, naam: c.name, reden });
      return c;
    }
    const bevestigdeFactoren = Object.fromEntries(
      [...c.factors].filter(([id, f]) => f !== 0 && gevalIds.has(id)),
    ) as Record<number, number>;
    if (Object.keys(bevestigdeFactoren).length === 0) return c;
    bevestigd.push(c.id);
    if (gelijkeBevestiging(c.bevestigdeFactoren, bevestigdeFactoren)) return c;
    veranderd = true;
    return { ...c, bevestigdeFactoren };
  });
  return { staat: veranderd ? { ...staat, combinations } : staat, bevestigd, overgeslagen };
}

/**
 * De bevestiging intrekken (zonder `ids`: van alle combinaties). Daarna meldt
 * de app de afwijkende factoren weer als FOUT.
 */
export function trekBevestigingIn(
  staat: CombinatieStaat,
  ids?: readonly number[],
): { staat: CombinatieStaat; ingetrokken: number[] } {
  const gevraagd = ids ? new Set(ids) : null;
  const ingetrokken: number[] = [];
  const combinations = staat.combinations.map((c) => {
    if ((gevraagd && !gevraagd.has(c.id)) || c.bevestigdeFactoren === undefined) return c;
    ingetrokken.push(c.id);
    const { bevestigdeFactoren: _weg, ...rest } = c;
    return rest;
  });
  return { staat: ingetrokken.length > 0 ? { ...staat, combinations } : staat, ingetrokken };
}

// ── Wat de NB geeft, en een schaal K_FI op NB.4 ───────────────────────────

/**
 * Afrondingstolerantie bij het herkennen van een schaal K_FI maal NB.4: een
 * constructeur schrijft 0,9 × 1,35 = 1,215 als 1,22. Twee decimalen, dus een
 * halve eenheid in de tweede decimaal. De kandidaten liggen ver genoeg uiteen
 * (1,08 / 1,215 / 1,32 / 1,485) om elkaar binnen die tolerantie niet te raken.
 */
const AFRONDING = 0.005 + 1e-9;

/** De klasse waarvoor K_FI = 1: tabel NB.4, de basis van de schaal. */
function nb4Klasse(bijlage: NationaleBijlageCode): Gevolgklasse {
  return GEVOLGKLASSEN.find((k) => gelijk(kFi(k, bijlage), 1)) ?? STANDAARD_GEVOLGKLASSE;
}

/** "NB.4" of "NB.5": de tabel waar de factoren van deze klasse staan. */
function tabelVan(klasse: Gevolgklasse, bijlage: NationaleBijlageCode): string {
  const bron = partieleFactoren(klasse, bijlage).bron;
  return /NB\.\d+/.exec(bron)?.[0] ?? bron;
}

/** De klasse bij een K_FI, of null. */
function klasseVanK(k: number, bijlage: NationaleBijlageCode): Gevolgklasse | null {
  return GEVOLGKLASSEN.find((x) => gelijk(kFi(x, bijlage), k)) ?? null;
}

type UgtUitdrukking = "6.10a" | "6.10b";

/** Uitdrukking 6.10a of 6.10b, uit het kenmerk, de naam of de formule; anders null. */
function uitdrukkingVan(c: Pick<LoadCombination, "name" | "formula" | "standaard">): UgtUitdrukking | null {
  if (c.standaard?.soort === "6.10a" || c.standaard?.soort === "6.10b") return c.standaard.soort;
  const tekst = `${c.name} ${c.formula}`;
  if (/6\.10a/.test(tekst)) return "6.10a";
  if (/6\.10b/.test(tekst)) return "6.10b";
  return null;
}

const gSup = (u: UgtUitdrukking, klasse: Gevolgklasse, bijlage: NationaleBijlageCode): number =>
  u === "6.10a" ? partieleFactoren(klasse, bijlage).gGsup610a : partieleFactoren(klasse, bijlage).gGsup610b;

/**
 * Wat een blijvende UGT-factor `f` is, gezien vanuit de NB: een schaal K_FI
 * (CC1 of CC3) maal γ_G,sup van NB.4, met wat NB.5 voor die klasse geeft; of
 * een eigen factor, met de NB-waarden ernaast. Hangt NIET van de klasse van
 * het project af: die is bij het openen van een bestand zonder klasse een
 * terugval naar het vorige project.
 */
function duidingBlijvend(f: number, u: UgtUitdrukking | null, bijlage: NationaleBijlageCode): string {
  const basisKlasse = nb4Klasse(bijlage);
  const nb4 = tabelVan(basisKlasse, bijlage);
  const kandidaten: { klasse: Gevolgklasse; k: number; u: UgtUitdrukking; basis: number }[] = [];
  for (const klasse of GEVOLGKLASSEN) {
    const k = kFi(klasse, bijlage);
    if (gelijk(k, 1)) continue;
    for (const x of ["6.10a", "6.10b"] as const) {
      const basis = gSup(x, basisKlasse, bijlage);
      if (Math.abs(f - k * basis) <= AFRONDING) kandidaten.push({ klasse, k, u: x, basis });
    }
  }
  const kfi = kandidaten.find((x) => x.u === u) ?? kandidaten[0];
  if (kfi) {
    const exact = gelijk(f, Math.round(kfi.k * kfi.basis * 1e9) / 1e9);
    return (
      `${nl(f)} ${exact ? "=" : "≈"} ${nl(kfi.k)} × ${nl(kfi.basis)} (K_FI ${kfi.klasse} op ${nb4} ${kfi.u}; ` +
      `${tabelVan(kfi.klasse, bijlage)} ${kfi.klasse} geeft ${nl(gSup(kfi.u, kfi.klasse, bijlage))})`
    );
  }
  const reeks = (x: UgtUitdrukking) =>
    `γ_G,sup in ${x}: ${GEVOLGKLASSEN.map((k) => `${nl(gSup(x, k, bijlage))} (${k})`).join(", ")}`;
  const nbs = [...new Set(GEVOLGKLASSEN.map((k) => tabelVan(k, bijlage)))].sort().join("/");
  return (
    `${nl(f)} (eigen factor, niet uit ${nbs}; ` +
    (u ? reeks(u) : `${reeks("6.10a")}; ${reeks("6.10b")}`) +
    (f < 1 ? `; gunstig γ_G,inf ${nl(partieleFactoren(basisKlasse, bijlage).gGinf)}` : "") +
    ")"
  );
}

/** De schaal K_FI op NB.4 die de G- en de Q-factoren van de UGT-combinaties volgen. */
export interface SchaalOpNB4 {
  /** Eén K_FI voor elke blijvende factor (γ_G,inf en 1,0 tellen niet mee), anders null. */
  g: number | null;
  /** Eén K_FI voor elke veranderlijke factor (γ_Q of γ_Q·ψ₀), anders null. */
  q: number | null;
}

/**
 * Volgen de UGT-factoren een vaste schaal K_FI (0,9 / 1,0 / 1,1) maal NB tabel
 * NB.4, met de afrondingstolerantie hierboven? Per soort apart: G (γ_G,sup in
 * 6.10a en 6.10b; γ_G,inf en 1,0 zijn gunstig of buitengewoon en zeggen niets
 * over de schaal) en Q (γ_Q als overheersende, γ_Q·ψ₀ als samengaande
 * belasting, met ψ₀ uit NB.2–A1.1 voor de gebruikscategorie of de soort).
 * P01: G 1,22 / 1,08 en Q 1,35 / 0,54 → beide 0,9.
 */
export function schaalOpNB4(p: {
  loadCases: readonly (Pick<LoadCase, "id" | "type"> & Partial<Pick<LoadCase, "categorie">>)[];
  combinations: readonly LoadCombination[];
  bijlage?: NationaleBijlageCode;
}): SchaalOpNB4 {
  const bijlage = p.bijlage ?? STANDAARD_BIJLAGE;
  const nb4 = partieleFactoren(nb4Klasse(bijlage), bijlage);
  const alleK = [...new Set(GEVOLGKLASSEN.map((k) => kFi(k, bijlage)))];
  let g = alleK;
  let q = alleK;
  let gGezien = false;
  let qGezien = false;
  const past = (f: number, waarden: number[]) => (k: number) => waarden.some((w) => Math.abs(f - k * w) <= AFRONDING);
  for (const c of p.combinations) {
    if (c.type !== "uls") continue;
    for (const [id, f] of c.factors) {
      if (f === 0) continue;
      const geval = p.loadCases.find((x) => x.id === id);
      if (!geval) continue;
      if (geval.type === "dead") {
        if (gelijk(f, nb4.gGinf) || gelijk(f, 1)) continue;
        gGezien = true;
        g = g.filter(past(f, [nb4.gGsup610a, nb4.gGsup610b]));
      } else if (geval.type === "live" || geval.type === "snow" || geval.type === "wind") {
        const psi0 = geval.type === "live"
          ? psiGebruik(geval.categorie ?? STANDAARD_CATEGORIE, bijlage).psi0
          : psiKlimaat(geval.type === "wind" ? "wind" : "sneeuw", bijlage).psi0;
        qGezien = true;
        q = q.filter(past(f, psi0 > 0 ? [nb4.gQ, nb4.gQ * psi0] : [nb4.gQ]));
      }
    }
  }
  return {
    g: gGezien && g.length === 1 ? g[0] : null,
    q: qGezien && q.length === 1 ? q[0] : null,
  };
}

/** Eén zin over de schaal, of "" als er geen schaal anders dan NB.4 zelf is. */
function tekstSchaal(s: SchaalOpNB4, bijlage: NationaleBijlageCode): string {
  if (s.g === null || gelijk(s.g, 1)) return "";
  const klasse = klasseVanK(s.g, bijlage);
  const nb4 = tabelVan(nb4Klasse(bijlage), bijlage);
  const kTekst = (k: number) => `K_FI = ${nl(k)}${klasseVanK(k, bijlage) ? ` (${klasseVanK(k, bijlage)})` : ""}`;
  if (s.q !== null && gelijk(s.q, s.g)) {
    const eigen = klasse ? partieleFactoren(klasse, bijlage) : null;
    return (
      `De UGT-factoren zijn consequent ${kTekst(s.g)} maal ${nb4}, voor G én Q.` +
      (eigen && klasse
        ? ` ${tabelVan(klasse, bijlage)} geeft voor ${klasse} eigen waarden: γ_G,sup ${nl(eigen.gGsup610a)} (6.10a) ` +
          `en ${nl(eigen.gGsup610b)} (6.10b), γ_Q ${nl(eigen.gQ)}.`
        : "")
    );
  }
  const qTekst = s.q === null
    ? `volgen geen vaste schaal van ${nb4}`
    : gelijk(s.q, 1) ? `zijn ${nb4} zelf (K_FI = 1${klasseVanK(1, bijlage) ? `, ${klasseVanK(1, bijlage)}` : ""})`
    : `zijn ${kTekst(s.q)} maal ${nb4}`;
  return `De G-factoren zijn ${kTekst(s.g)} maal ${nb4}, de Q-factoren ${qTekst}: G en Q zijn niet met dezelfde factor geschaald.`;
}

// ── Meldingen ─────────────────────────────────────────────────────────────

export interface GevalMelding {
  /**
   * "fout" = een last telt als nul of met verkeerde factoren, of er ontbreekt
   * een combinatie; "waarschuwing" = het kan misgaan.
   */
  niveau: "fout" | "waarschuwing";
  /** Het geval waar de melding over gaat; null = het model als geheel. */
  caseId: number | null;
  tekst: string;
  /**
   * De kop van de melding voor de projectboom, vertaalbaar (issue #33). De
   * boom toont anders de eerste zin van `tekst`, en die is Nederlands. De
   * Nederlandse vorm van de kop is die eerste zin, zonder punt.
   */
  kop?: VertaalbareTekst;
  /**
   * De combinaties zelf zijn het probleem, en "Vervang door
   * standaardcombinaties" lost het op. De interface toont die actie dan ook.
   */
  vervangAdvies?: true;
  /**
   * De combinaties van de windgenerator zijn verouderd en niet af te leiden;
   * de interface toont de actie om de windbelasting opnieuw te genereren.
   */
  windOpnieuwAdvies?: true;
  /**
   * De melding gaat over eigen factoren die bewust gekozen kunnen zijn, en
   * "Behoud eigen factoren" (`bevestigEigenFactoren`) lost haar op (issue #196).
   * De interface toont die actie dan ook. Nooit bij een echt spoor van een
   * oud bestand (de kolom van de oude standaardset).
   */
  bevestigAdvies?: true;
}

const TYPE_TEKST: Record<string, string> = {
  dead: "blijvend", live: "veranderlijk", snow: "sneeuw", wind: "wind", other: "overig",
};

// ── Ontbrekende standaardcombinaties ──────────────────────────────────────

/**
 * Komt deze combinatie uit de standaardset van deze versie? Met kenmerk
 * zeker; zonder kenmerk als haar formule nog de bronvermelding van
 * `normcombinaties.ts` draagt ("ψ uit NB tabel NB.2–A1.1"). Dat laatste is een
 * hernoemde of aangepaste standaardcombinatie: `wijzigCombinatie` haalt het
 * kenmerk weg maar laat de formule staan, en in het venster is de formule niet
 * te bewerken. De windgenerator zet dezelfde bron in zijn formules, maar zijn
 * combinaties hebben een eigen controle (`verouderdeWindCombinaties`).
 *
 * Waarom dit nodig is: in een project waarin ALLE standaardcombinaties hernoemd
 * waren en een geval daarna van type veranderde, zocht niemand naar
 * ontbrekende combinaties — 102,60 kNm waar 122,85 hoort, zonder melding.
 */
export function isAfgeleidVanStandaard(
  c: Pick<LoadCombination, "name" | "formula" | "standaard">,
): boolean {
  if (isWindgeneratorCombinatie(c)) return false;
  // De bron van ELKE gevulde bijlage: een hernoemde standaardcombinatie blijft
  // herkenbaar, ook als het project sindsdien van bijlage wisselde.
  return c.standaard !== undefined || Object.values(PSI_BRON).some((b) => c.formula.includes(b));
}

/**
 * De standaardcombinaties voor deze gevallen en deze klasse die in
 * `combinations` ontbreken — en door geen andere combinatie worden vervangen.
 *
 * Vervangen = een combinatie van hetzelfde type (UGT/BGT) met dezelfde
 * factoren voor de gevallen die een last dragen (`gevuld`), in de BGT ook van
 * dezelfde soort (6.14b/6.15b/6.16b, want elke bruikbaarheidstoets zoekt zijn
 * eigen soort; zie `soortVanCombinatie`). Een hernoemde standaardcombinatie
 * vervangt zichzelf dus zolang er niets verandert. Een factor voor een leeg
 * geval telt niet: "UGT 6.10a — zonder Variabel (Q)" vervangt 6.10a als Q
 * geen last draagt, want de uitkomst is dan dezelfde. Een standaardcombinatie
 * zonder enige factor voor een gevuld geval ontbreekt nooit.
 *
 * Een ontbrekende combinatie is een opstelling die de omhullende niet ziet.
 * Zonder deze controle werd een combinatieset stil een DEELVERZAMELING van de
 * juiste set — zie de kop van dit bestand.
 *
 * Bevestigde eigen factoren (issue #196): een combinatie met dezelfde gevallen
 * (met last), van hetzelfde type en in de BGT van dezelfde soort, die alleen in
 * BEVESTIGDE factoren afwijkt, vervangt de standaardcombinatie ook — één op
 * één, alleen als ze niet al exact een andere standaardcombinatie vervangt, en
 * alleen als ze nog de FORMULE van die standaardcombinatie draagt: ze is er
 * dan van afgeleid (`wijzigCombinatie` laat de formule staan). De opstelling
 * is er dan; alleen de waarde is anders, en die is bewust gekozen. Zie "Eigen
 * factoren, bewust gekozen" hierboven.
 * Waarom de formule: de formule van een standaardcombinatie draagt de factoren
 * van haar klasse ("1,35·G + 1,5·0,4·Q"). Gaat het project daarna naar een
 * andere gevolgklasse, dan verschillen de formules, en meldt deze controle de
 * ontbrekende combinaties weer — een set die onder CC2 bewust op K_FI = 0,9 is
 * gezet, dekt een CC3-project niet stil. De formule wijst ook aan WELKE
 * standaardcombinatie een afgeleide vervangt (6.10a en 6.10b met Q leidend
 * hebben dezelfde gevallen).
 */
export function ontbrekendeStandaardcombinaties(p: {
  combinations: readonly LoadCombination[];
  loadCases: readonly GevalInvoer[];
  gevolgklasse: Gevolgklasse;
  /** De bijlage van het project; weglaten = de enige gevulde bijlage. */
  bijlage?: NationaleBijlageCode;
  /** Draagt dit geval een last? Zonder: elk geval (de strenge kant). */
  gevuld?: (caseId: number) => boolean;
}): StandaardCombinatie[] {
  const gevuld = p.gevuld ?? (() => true);
  const werkzaam = (factors: ReadonlyMap<number, number>): [number, number][] =>
    [...factors].filter(([id, f]) => f !== 0 && gevuld(id)).sort((a, b) => a[0] - b[0]);
  const inhoud = (factors: ReadonlyMap<number, number>): string =>
    werkzaam(factors).map(([id, f]) => `${id}:${Math.round(f * 1e9) / 1e9}`).join(",");
  const soortDeel = (type: string, soort: string | null): string =>
    type === "sls" ? soort ?? "?" : "";
  const sleutel = (c: LoadCombination): string =>
    `${c.type}|${soortDeel(c.type, soortVanCombinatie(c))}|${inhoud(c.factors)}`;
  const nSleutel = (n: StandaardCombinatie): string =>
    `${n.type}|${soortDeel(n.type, n.standaard.soort)}|${inhoud(n.factors)}`;
  const aanwezig = new Set(p.combinations.map(sleutel));
  const set = genereerStandaardCombinaties(p.loadCases, p.gevolgklasse, p.bijlage).filter((n) => inhoud(n.factors) !== "");
  const ontbrekend = set.filter((n) => !aanwezig.has(nSleutel(n)));
  if (ontbrekend.length === 0) return ontbrekend;

  // Vervangers met bevestigde factoren: niet al exact een standaardcombinatie.
  const exact = new Set(set.map(nSleutel));
  const vrij = p.combinations.filter((c) => heeftBevestigdeFactoren(c) && !exact.has(sleutel(c)));
  const formuleBasis = (f: string) => f.split("   [")[0];
  return ontbrekend.filter((n) => {
    const nWerkzaam = werkzaam(n.factors);
    const past = (c: LoadCombination): boolean => {
      if (c.type !== n.type) return false;
      if (n.type === "sls" && soortVanCombinatie(c) !== n.standaard.soort) return false;
      const cWerkzaam = werkzaam(c.factors);
      if (cWerkzaam.length !== nWerkzaam.length) return false;
      return nWerkzaam.every(([id, f], i) =>
        cWerkzaam[i][0] === id && (gelijk(cWerkzaam[i][1], f) || isBevestigdeFactor(c, id)));
    };
    const keuze = vrij.find((c) => formuleBasis(c.formula) === formuleBasis(n.formula) && past(c));
    if (!keuze) return true;
    vrij.splice(vrij.indexOf(keuze), 1);
    return false;
  });
}

function tekstOntbrekend(ontbrekend: readonly StandaardCombinatie[], klasse: Gevolgklasse): string {
  const MAX = 6;
  const namen =
    ontbrekend.slice(0, MAX).map((c) => `"${c.name}" (${c.formula.split("   [")[0]})`).join(", ") +
    (ontbrekend.length > MAX ? ` en nog ${ontbrekend.length - MAX}` : "");
  return (
    `${ontbrekend.length} standaardcombinatie(s) ontbreken, dus de omhullende kan te laag zijn. ` +
    `Ze horen bij deze belastinggevallen en ${klasse}, en geen andere combinatie in dit project ` +
    `heeft dezelfde factoren voor de gevallen met last: ${namen}. Een combinatieset die een deel ` +
    "van de standaardset mist, geeft een lagere omhullende zonder dat een getal dat verraadt. Dat " +
    "gebeurt als een standaardcombinatie is verwijderd, hernoemd of aangepast — dan is ze een eigen " +
    "combinatie en volgt ze de belastinggevallen niet meer — en er daarna een belastinggeval bij kwam " +
    'of van type of categorie veranderde. Kies "Vervang door standaardcombinaties" in ' +
    "Belastinggevallen & combinaties, of voeg de ontbrekende combinaties als eigen combinatie toe."
  );
}

// ── Veranderlijke belastingen in eigen combinaties ────────────────────────

/** Twee delen van één veranderlijke belasting met verschillende factoren. */
export interface VeranderlijkVerschil {
  /** De gebruikscategorie (tabel NB.2–A1.1) die de gevallen delen. */
  categorie: string;
  /** De gevulde veranderlijke gevallen van die categorie. */
  caseIds: number[];
  /** Per combinatie de factoren die van elkaar verschillen. */
  combinaties: { combinatieId: number; naam: string; factoren: [number, number][] }[];
}

/**
 * Combinaties waarin twee gevulde veranderlijke gevallen van DEZELFDE
 * gebruikscategorie elk een factor ≠ 0 hebben, maar niet dezelfde.
 *
 * Waarom dat een fout is: de app behandelt veranderlijke gevallen van één
 * categorie als delen van één veranderlijke belasting (normcombinaties.ts,
 * "WAT EEN VERANDERLIJKE BELASTING HIER IS"). In één combinatie is die
 * belasting de overheersende of een samengaande (NEN-EN 1990 6.4.3.2(2)), dus
 * draagt elk aanwezig deel dezelfde factor: γ_Q, of γ_Q·ψ₀. Een combinatie
 * waarin het ene deel met 1,5 en het andere met 0,6 telt, is geen van beide.
 *
 * Het spoor dat hier gevonden wordt: een set eigen (hernoemde) combinaties,
 * daarna een sneeuwgeval veranderlijk gemaakt. "UGT 6.10b — Sneeuw (S)
 * leidend" hield 1,5 voor geval 3 en 0,6 voor geval 2, en de combinatie met
 * beide op 1,5 ontstond nooit (102,60 kNm waar 122,85 hoort). Een afwezig deel
 * (factor 0) mag: een veranderlijke belasting telt alleen waar ze ongunstig
 * werkt (EN 1991-1-1 6.2.1(1)P). Een factor voor een leeg geval telt niet.
 */
export function veranderlijkeFactorVerschillen(p: {
  loadCases: readonly GevalInvoer[];
  combinations: readonly LoadCombination[];
  gevuld?: (caseId: number) => boolean;
}): VeranderlijkVerschil[] {
  const gevuld = p.gevuld ?? (() => true);
  const groepen = new Map<string, number[]>();
  for (const c of p.loadCases) {
    if (c.type !== "live" || c.gegenereerd?.bron === "wind" || !gevuld(c.id)) continue;
    const cat = c.categorie ?? STANDAARD_CATEGORIE;
    groepen.set(cat, [...(groepen.get(cat) ?? []), c.id]);
  }
  const uit: VeranderlijkVerschil[] = [];
  for (const [categorie, ids] of groepen) {
    if (ids.length < 2) continue;
    const combinaties: VeranderlijkVerschil["combinaties"] = [];
    for (const c of p.combinations) {
      const factoren = ids
        .map((id) => [id, c.factors.get(id) ?? 0] as [number, number])
        .filter(([, f]) => f !== 0);
      if (new Set(factoren.map(([, f]) => Math.round(f * 1e9) / 1e9)).size > 1) {
        combinaties.push({ combinatieId: c.id, naam: c.name, factoren });
      }
    }
    if (combinaties.length > 0) uit.push({ categorie, caseIds: ids, combinaties });
  }
  return uit;
}

function tekstVerschil(v: VeranderlijkVerschil, naamVan: (id: number) => string): string {
  const MAX = 6;
  const regels =
    v.combinaties
      .slice(0, MAX)
      .map((c) => `"${c.naam}" ${c.factoren.map(([id, f]) => `${nl(f)} voor geval ${id}`).join(" en ")}`)
      .join("; ") + (v.combinaties.length > MAX ? `; en nog ${v.combinaties.length - MAX}` : "");
  return (
    `De veranderlijke belastinggevallen ${v.caseIds.map(naamVan).join(", ")} (gebruikscategorie ` +
    `${v.categorie}) hebben in ${v.combinaties.length} combinatie(s) verschillende factoren: ${regels}. ` +
    "Gevallen van dezelfde gebruikscategorie zijn delen van één veranderlijke belasting — zo stelt de " +
    "app de standaardcombinaties op — en in één combinatie is die belasting de overheersende (γ_Q) of " +
    "een samengaande (γ_Q·ψ₀), NEN-EN 1990 6.4.3.2(2); elk aanwezig deel draagt dan dezelfde factor. " +
    "Een combinatie waarin het ene deel overheerst en het andere samengaat, telt de belasting te laag, " +
    "en de combinatie waarin alle delen samen overheersen ontbreekt dan mogelijk. Dit ontstaat als een " +
    "geval van type of categorie verandert terwijl de combinaties eigen combinaties zijn (hernoemd of " +
    'aangepast): die volgen de gevallen niet. Kies "Vervang door standaardcombinaties" in ' +
    "Belastinggevallen & combinaties, of pas de factoren van deze combinaties aan."
  );
}

/** Een veranderlijke belasting die in geen enkele UGT-combinatie overheerst. */
export interface BelastingZonderLeiding {
  /** Voor in de melding: de naam van het geval, of de categorie. */
  label: string;
  caseIds: number[];
  /** De grootste |factor| waarmee de belasting in een UGT-combinatie voorkomt. */
  hoogste: number;
}

/**
 * De kleinste γ_Q voor een overheersende veranderlijke belasting in enige
 * gevolgklasse: 1,35 (NB tabel NB.5, CC1). Een factor daaronder is in geen
 * klasse een overheersende belasting zonder ψ₀; een eigen combinatie uit een
 * CC1-berekening (1,35) telt dus ook in een CC2-project als overheersend.
 * Over alle gevulde bijlagen, om dezelfde reden als over alle klassen: dit is
 * een ondergrens voor "overheersend", geen factor waarmee gerekend wordt.
 */
const GAMMA_Q_MIN = Math.min(
  ...Object.values(PARTIELE_FACTOREN).flatMap((rij) => GEVOLGKLASSEN.map((k) => rij[k].gQ)),
);

/**
 * Veranderlijke belastingen met last die wel in een UGT-combinatie voorkomen,
 * maar in geen enkele als overheersende: nergens staan hun aanwezige delen met
 * één factor van minstens γ_Q = 1,35. Een veranderlijke belasting is hier
 * dezelfde eenheid als in de standaardset: veranderlijke gevallen per
 * gebruikscategorie samen, elk sneeuwgeval en elk windgeval apart. Een
 * belasting die in geen UGT-combinatie voorkomt, meldt de controle per geval al.
 *
 * Waarom: NEN-EN 1990 6.4.3.1(2) — elke combinatie omvat een overheersende
 * veranderlijke belasting — en 6.4.3.1(1)P: de rekenwaarden volgen uit elk
 * kritiek belastingsgeval. Overheerst een belasting nergens, dan ontbreekt het
 * kritieke geval waarin zij overheerst; in 6.10b (NB A1.3.1(1)) is dat γ_Q
 * zonder ψ₀. Dit geldt ook in een set die de gebruiker volledig zelf opstelde.
 */
export function veranderlijkeBelastingenZonderLeiding(p: {
  loadCases: readonly GevalInvoer[];
  combinations: readonly LoadCombination[];
  gevuld?: (caseId: number) => boolean;
}): BelastingZonderLeiding[] {
  const gevuld = p.gevuld ?? (() => true);
  const acties: { label: string; caseIds: number[] }[] = [];
  const live = p.loadCases.filter((c) => c.type === "live" && gevuld(c.id));
  for (const cat of [...new Set(live.map((c) => c.categorie ?? STANDAARD_CATEGORIE))]) {
    const leden = live.filter((c) => (c.categorie ?? STANDAARD_CATEGORIE) === cat);
    acties.push({
      label: leden.length === 1 ? `"${leden[0].name}"` : `veranderlijk, categorie ${cat}`,
      caseIds: leden.map((c) => c.id),
    });
  }
  for (const c of p.loadCases) {
    if ((c.type === "snow" || c.type === "wind") && gevuld(c.id)) {
      acties.push({ label: `"${c.name}"`, caseIds: [c.id] });
    }
  }
  const ugt = p.combinations.filter((c) => c.type === "uls");
  const uit: BelastingZonderLeiding[] = [];
  for (const a of acties) {
    let hoogste = 0;
    let overheerst = false;
    for (const c of ugt) {
      const f = a.caseIds.map((id) => c.factors.get(id) ?? 0).filter((x) => x !== 0);
      if (f.length === 0) continue;
      hoogste = Math.max(hoogste, ...f.map(Math.abs));
      const eenFactor = new Set(f.map((x) => Math.round(x * 1e9) / 1e9)).size === 1;
      if (eenFactor && Math.abs(f[0]) >= GAMMA_Q_MIN - 1e-9) {
        overheerst = true;
        break;
      }
    }
    if (!overheerst && hoogste > 0) uit.push({ ...a, hoogste });
  }
  return uit;
}

function tekstZonderLeiding(a: BelastingZonderLeiding, bijlage: NationaleBijlageCode): string {
  const γ = (k: Gevolgklasse) => nl(partieleFactoren(k, bijlage).gQ);
  return (
    `Veranderlijke belasting ${a.label} (belastinggeval ${a.caseIds.join(", ")}) is in geen enkele ` +
    "UGT-combinatie de overheersende veranderlijke belasting: ze komt alleen voor met een factor van " +
    `ten hoogste ${nl(a.hoogste)}. Elke combinatie omvat een overheersende veranderlijke belasting ` +
    "(NEN-EN 1990 6.4.3.1(2)) en de rekenwaarden volgen uit elk kritiek belastingsgeval (6.4.3.1(1)P); " +
    `in uitdrukking 6.10b (NB A1.3.1(1)) krijgt de overheersende belasting γ_Q zonder ψ₀: ${γ("CC1")} in ` +
    `CC1 (NB tabel NB.5), ${γ("CC2")} in CC2 (NB.4), ${γ("CC3")} in CC3 (NB.5). Zonder zo'n combinatie ` +
    'kan de omhullende te laag zijn. Kies "Vervang door standaardcombinaties", of voeg een combinatie ' +
    "toe waarin deze belasting overheerst."
  );
}

// ── Combinaties van de windgenerator ──────────────────────────────────────

function gelijkeRekeninhoudSet(
  a: readonly Omit<LoadCombination, "id">[],
  b: readonly Omit<LoadCombination, "id">[],
): boolean {
  if (a.length !== b.length) return false;
  const vrij = [...b];
  for (const c of a) {
    const i = vrij.findIndex((x) =>
      x.type === c.type &&
      x.factors.size === c.factors.size &&
      [...c.factors].every(([id, f]) => gelijk(x.factors.get(id) ?? Number.NaN, f)));
    if (i < 0) return false;
    vrij.splice(i, 1);
  }
  return true;
}

/**
 * Combinaties van de windgenerator die niet passen bij wat de generator voor
 * deze gevallen en deze klasse zou maken — vergeleken op type en factoren, in
 * willekeurige volgorde. `null` = in orde of geen gegenereerde combinaties.
 *
 * In de app en bij het openen houdt `synchroniseerWindCombinaties` ze bij, dus
 * daar treft dit alleen een set zonder gegenereerd windgeval om uit af te
 * leiden. In de MCP-weg kan een aanvrager ook zelf verouderde
 * windcombinaties meesturen.
 */
export function verouderdeWindCombinaties(p: {
  loadCases: readonly GevalInvoer[];
  combinations: readonly LoadCombination[];
  gevolgklasse: Gevolgklasse;
  /** De bijlage van het project; weglaten = de enige gevulde bijlage. */
  bijlage?: NationaleBijlageCode;
}): { aantal: number; verwacht: number | null } | null {
  const huidig = p.combinations.filter(isWindgeneratorCombinatie);
  if (huidig.length === 0) return null;
  const verwacht = windCombinatiesVoor(p.loadCases, p.gevolgklasse, p.bijlage);
  if (verwacht !== null && gelijkeRekeninhoudSet(huidig, verwacht)) return null;
  return { aantal: huidig.length, verwacht: verwacht?.length ?? null };
}

function tekstWindVerouderd(v: { aantal: number; verwacht: number | null }, klasse: Gevolgklasse): string {
  return (
    `${v.aantal} combinatie(s) van de windgenerator passen niet bij de belastinggevallen en gevolgklasse ` +
    `${klasse} van dit project: ` +
    (v.verwacht === null
      ? "er staat geen gegenereerd windbelastinggeval meer in het model waar ze bij horen"
      : `de generator zou nu ${v.verwacht} combinatie(s) met andere factoren maken`) +
    ". De gegenereerde set is verouderd: een combinatie die de generator nu wel zou maken — met een " +
    "later toegevoegd veranderlijk geval als samengaande belasting, of met de factoren van een andere " +
    "gevolgklasse — ontbreekt in de omhullende. Open de windbelastinggenerator en genereer de " +
    "windbelasting opnieuw."
  );
}

// ── Blijvende gevallen met factoren die niet bij hun type passen ──────────

/**
 * Elke factor die een blijvende belasting in een UGT-combinatie kan hebben:
 * γ_G,sup (6.10a en 6.10b) en γ_G,inf van NB tabel NB.4 en NB.5 in elke
 * gevolgklasse, en 1,0 uit tabel NB.10–A1.3 (buitengewone en
 * aardbevingscombinaties, "1,0 G_k,j,sup" en "1,0 G_k,j,inf"). Alle klassen
 * samen: een eigen combinatie uit een CC2-project blijft ook in CC3 een
 * blijvende combinatie.
 */
const UGT_FACTOREN_BLIJVEND: readonly number[] = [
  ...new Set([
    // Over alle gevulde bijlagen: dit is een lijst van factoren die een
    // blijvende belasting ERGENS kan hebben, geen factor waarmee gerekend wordt.
    ...Object.values(PARTIELE_FACTOREN).flatMap((rij) => GEVOLGKLASSEN.flatMap((k) => [
      rij[k].gGsup610a, rij[k].gGsup610b, rij[k].gGinf,
    ])),
    1.0,
  ]),
];

/** Eén combinatie waarin een blijvend geval afwijkt. */
export interface BlijvendeRegel {
  combinatieId: number;
  combinatie: string;
  factor: number;
  /** De factor past bij geen blijvende belasting (UGT: geen γ_G uit NB.4/NB.5 en geen 1,0; BGT: niet 1,0). */
  pastNiet: boolean;
  /** De factor is bewust gekozen en bevestigd (`isBevestigdeFactor`, issue #196). */
  bevestigd: boolean;
  /** Een ander blijvend geval met een andere factor in dezelfde combinatie, anders null. */
  ander: { caseId: number; factor: number } | null;
  /** De regel voor in een melding, met wat de NB geeft. */
  tekst: string;
}

/** Een blijvend geval met factoren die bij geen blijvende belasting passen. */
export interface BlijvendeAfwijking {
  caseId: number;
  naam: string;
  /**
   * Elke combinatie waarin dit geval afwijkt: een factor die niet past
   * (`pastNiet`), of een andere factor dan een ander blijvend geval in
   * dezelfde combinatie. In `blijvendeFactorAfwijkingen` zonder de bevestigde
   * factoren, in `bevestigdeEigenFactoren` alleen die.
   */
  regels: BlijvendeRegel[];
  /**
   * Draagt dit geval in de oude standaardcombinaties precies de kolom van het
   * oude geval met dit id (2 = Q, 3 = S, 4 = W)? Dan dat id, anders null.
   */
  oudeKolom: number | null;
  /** De schaal K_FI op NB.4 die de UGT-factoren van de set volgen (voor de hele set gelijk). */
  schaal: SchaalOpNB4;
}

function oudeKolomVan(caseId: number, combinations: readonly LoadCombination[]): number | null {
  if (OUDE_GEVALLEN[caseId] === undefined) return null;
  const oud = combinations
    .map((c) => ({ c, o: OUDE_STANDAARDSET.find((x) => x.naam === c.name) }))
    .filter((x): x is { c: LoadCombination; o: (typeof OUDE_STANDAARDSET)[number] } => x.o !== undefined);
  if (oud.length < 3) return null;
  return oud.every(({ c, o }) => gelijk(c.factors.get(caseId) ?? 0, o.factoren[caseId] ?? 0)) ? caseId : null;
}

/** De invoer van de controles op blijvende factoren. */
interface BlijvendInvoer {
  loadCases: readonly (Pick<LoadCase, "id" | "name" | "type"> & Partial<Pick<LoadCase, "categorie">>)[];
  combinations: readonly LoadCombination[];
  /** De bijlage van het project, voor de NB-waarden in de tekst; weglaten = de enige gevulde. */
  bijlage?: NationaleBijlageCode;
}

/**
 * Elk blijvend geval met minstens één factor die niet past — bevestigd of
 * niet — met al zijn regels. De twee openbare functies hieronder kiezen eruit.
 */
function alleBlijvendeAfwijkingen(p: BlijvendInvoer): BlijvendeAfwijking[] {
  const bijlage = p.bijlage ?? STANDAARD_BIJLAGE;
  const blijvend = p.loadCases.filter((c) => c.type === "dead");
  const uit: BlijvendeAfwijking[] = [];
  let schaal: SchaalOpNB4 | null = null;
  for (const g of blijvend) {
    const regels: BlijvendeRegel[] = [];
    for (const c of p.combinations) {
      const f = c.factors.get(g.id) ?? 0;
      const anderGeval = blijvend.find((o) => {
        const fo = c.factors.get(o.id) ?? 0;
        return o.id !== g.id && fo !== 0 && !gelijk(fo, f);
      });
      const ander = anderGeval ? { caseId: anderGeval.id, factor: c.factors.get(anderGeval.id) ?? 0 } : null;
      const pastNiet = f !== 0 && (c.type === "sls"
        ? !gelijk(f, 1)
        : !UGT_FACTOREN_BLIJVEND.some((x) => gelijk(x, f)));
      if (!pastNiet && !ander) continue;
      const anderTekst = ander ? `blijvend geval ${ander.caseId} heeft daar ${nl(ander.factor)}` : "";
      let tekst: string;
      if (pastNiet && c.type === "uls") {
        // Wat de NB geeft, en een schaal K_FI op NB.4 (issue #196).
        tekst = `"${c.name}" ${duidingBlijvend(f, uitdrukkingVan(c), bijlage)}${ander ? ` — ${anderTekst}` : ""}`;
      } else {
        const waarom = [
          ...(pastNiet ? ["in de BGT telt een blijvende belasting met 1,0"] : []),
          ...(ander ? [anderTekst] : []),
        ];
        tekst = `"${c.name}" ${f === 0 ? "geen factor" : nl(f)} (${waarom.join("; ")})`;
      }
      regels.push({
        combinatieId: c.id, combinatie: c.name, factor: f, pastNiet,
        bevestigd: isBevestigdeFactor(c, g.id), ander, tekst,
      });
    }
    if (regels.some((r) => r.pastNiet)) {
      schaal ??= schaalOpNB4({ loadCases: p.loadCases, combinations: p.combinations, bijlage });
      uit.push({ caseId: g.id, naam: g.name, regels, oudeKolom: oudeKolomVan(g.id, p.combinations), schaal });
    }
  }
  return uit;
}

/**
 * Blijvende gevallen (type "dead") met een factor die bij geen blijvende
 * belasting past: in de BGT anders dan 1,0 (6.14b–6.16b), in de UGT geen γ_G
 * uit NB.4/NB.5 en geen 1,0. Ontbreekt een blijvend geval in een combinatie,
 * dan is dat op zich geen fout — een eigen BGT-combinatie voor de bijkomende
 * zakking laat het eigen gewicht bewust weg — maar het staat wel in de regels
 * als een ander blijvend geval er een factor heeft.
 *
 * Het spoor van basisaudit nr 14: "Permanent afbouw" kreeg het id van het
 * verwijderde windgeval en erfde zijn factoren — 0,9 in 6.10a, 1,5 met wind
 * leidend, 0,6 in de karakteristieke BGT-combinatie. HEA200 6 m, G = 5 en
 * afbouw 3 kN/m: UGT 47,25 en BGT 30,60 kNm waar 1,35·8·36/8 = 48,60 en
 * 8·36/8 = 36,00 horen. Bij het openen vervangt `vervangVerouderdeCombinaties`
 * zo'n ongewijzigde oude set; deze controle vangt het in een eigen set (en na
 * "Ongedaan maken").
 *
 * Alleen gevallen met minstens één factor die niet past en NIET bevestigd is
 * komen in de lijst (issue #196), met hun regels zonder de bevestigde factoren.
 * Een bevestigde factor staat in `bevestigdeEigenFactoren`.
 */
export function blijvendeFactorAfwijkingen(p: BlijvendInvoer): BlijvendeAfwijking[] {
  return alleBlijvendeAfwijkingen(p)
    .filter((a) => a.regels.some((r) => r.pastNiet && !r.bevestigd))
    .map((a) => ({ ...a, regels: a.regels.filter((r) => !r.bevestigd) }));
}

/**
 * De blijvende factoren die niet uit NB.4/NB.5 komen maar bewust gekozen en
 * bevestigd zijn (issue #196). Geen fout: het rapport en de MCP-weg vermelden
 * ze (`tekstBevestigdeEigenFactoren`), zodat een lezer ziet dat er met eigen
 * factoren is gerekend.
 */
export function bevestigdeEigenFactoren(p: BlijvendInvoer): BlijvendeAfwijking[] {
  return alleBlijvendeAfwijkingen(p)
    .map((a) => ({ ...a, regels: a.regels.filter((r) => r.pastNiet && r.bevestigd) }))
    .filter((a) => a.regels.length > 0);
}

/** De vermelding van bevestigde eigen factoren, of "" als er geen zijn. */
export function tekstBevestigdeEigenFactoren(
  lijst: readonly BlijvendeAfwijking[],
  bijlage: NationaleBijlageCode = STANDAARD_BIJLAGE,
): string {
  if (lijst.length === 0) return "";
  const delen = lijst.map((a) => `belastinggeval ${a.caseId} ("${a.naam}") ${lijstVan(a)}`);
  const schaal = tekstSchaal(lijst[0].schaal, bijlage);
  return (
    `Eigen factoren, bewust gekozen ("Behoud eigen factoren"): ${delen.join("; ")}.` +
    (schaal ? ` ${schaal}` : "") +
    " Ze wijken af van NB tabel NB.4/NB.5, zijn bevestigd en worden niet als fout gemeld zolang ze niet " +
    "veranderen; er wordt gewoon mee gerekend."
  );
}

/** De regels van een afwijking, hoogstens acht, voor in een melding. */
function lijstVan(a: BlijvendeAfwijking): string {
  const MAX = 8;
  return (
    a.regels.slice(0, MAX).map((r) => r.tekst).join("; ") +
    (a.regels.length > MAX ? `; en nog ${a.regels.length - MAX}` : "")
  );
}

/**
 * De herkomst van een afwijking. Uit de factoren alleen is de leeftijd of
 * herkomst van het project niet af te leiden (PR #126): een bewust gekozen
 * eigen factor ziet er net zo uit. Alleen bij een echt spoor staat er meer:
 *  - de kolom van de oude standaardset (`oudeKolom`): welke kolom, met de
 *    vraag of dit bewust is;
 *  - wees-factoren in hetzelfde bestand (alleen bij het openen bekend).
 * Een andere factor dan een ander blijvend geval in dezelfde combinatie zegt
 * waar zo'n verschil vandaan kan komen, zonder datum.
 */
function herkomstVan(a: BlijvendeAfwijking, spoor: { wees: boolean }): string {
  if (a.oudeKolom !== null) {
    return (
      `Deze factoren komen overeen met de oude standaardkolom voor belastinggeval ` +
      `${a.oudeKolom}, ${OUDE_GEVALLEN[a.oudeKolom]}. Controleer of dit een bewust gekozen ` +
      "eigen combinatie is; uit de factoren alleen is de leeftijd of herkomst van het project niet af te leiden."
    );
  }
  if (spoor.wees) {
    return (
      "In hetzelfde bestand stonden ook factoren voor belastinggevallen die niet (meer) bestaan (zie " +
      "hieronder): een spoor van een eerdere versie, waarin een nieuw geval het id én de factoren van een " +
      "verwijderd geval kon erven. Ga na of dat bij dit geval is gebeurd."
    );
  }
  return (
    (a.regels.some((r) => r.ander !== null)
      ? "Een blijvend geval met een andere factor dan een ander blijvend geval in dezelfde combinatie " +
        "ontstaat als zijn type later is gewijzigd zonder dat de factoren meegingen, of als een factor met " +
        "de hand is aangepast. "
      : "") +
    "De factoren kunnen bewust gekozen zijn. Uit deze afwijking is de leeftijd of herkomst van " +
    "het project niet af te leiden."
  );
}

/** Wat de gebruiker kan doen met eigen factoren (issue #196). */
const ADVIES_EIGEN =
  "De berekening gebruikt de getoonde factoren. Zijn ze bewust gekozen, kies dan \"Behoud eigen factoren\" " +
  "in Belastinggevallen & combinaties: de bevestiging wordt opgeslagen, de melding vervalt zolang de " +
  "factoren niet veranderen, en het rapport noemt ze als bewust gekozen. Anders: kies \"Vervang door " +
  "standaardcombinaties\", of corrigeer de factoren.";

function tekstBlijvendeAfwijking(a: BlijvendeAfwijking, bijlage: NationaleBijlageCode): string {
  const kop = `Belastinggeval ${a.caseId} ("${a.naam}") is van type blijvend, maar draagt factoren die niet ` +
    `bij een blijvende belasting passen: ${lijstVan(a)}.`;
  const regel = "Alle blijvende gevallen samen zijn één blijvende belasting G, met in elke combinatie dezelfde " +
    "factor: γ_G uit NEN-EN 1990 NB tabel NB.4/NB.5 in de UGT (0,9 waar zij gunstig werkt), 1,0 in de BGT " +
    "(6.14b–6.16b).";
  return [kop, regel, tekstSchaal(a.schaal, bijlage), herkomstVan(a, { wees: false }), ADVIES_EIGEN]
    .filter((x) => x !== "").join(" ");
}

/**
 * Welke belastinggevallen niet (volledig) in de doorgerekende combinaties
 * meetellen, of de combinaties een deel van de juiste set missen, en of het
 * eigen gewicht een blijvend geval heeft.
 *
 * `combinations` hoort de ACTIEF doorgerekende lijst te zijn: wat daar niet in
 * staat, telt ook niet mee. `loads` bepaalt of een geval een last draagt: een
 * leeg geval zonder factor is een waarschuwing, een gevuld geval zonder factor
 * een fout. Zonder `loads` wordt elk geval als gevuld beschouwd — de strenge
 * kant.
 *
 * `alleCombinaties` is de VOLLEDIGE lijst van het project (ook wat de selectie
 * overslaat) en `gevolgklasse` de klasse van het project. Samen bepalen ze of
 * er standaardcombinaties ontbreken (`ontbrekendeStandaardcombinaties`) — in
 * een project met standaardcombinaties, ook als die hernoemd zijn
 * (`isAfgeleidVanStandaard`). Een set die de gebruiker helemaal zelf opstelde
 * (een externe referentie-berekening) is geen deel van de standaardset maar
 * een andere set; die wordt gecontroleerd op wat voor ELKE set geldt:
 * `veranderlijkeFactorVerschillen` en `veranderlijkeBelastingenZonderLeiding`.
 * Zonder `gevolgklasse` geldt de klasse uit het kenmerk van de
 * standaardcombinaties, en blijft de controle op verouderde windcombinaties
 * achterwege (die hangt van de klasse af).
 */
export function meldingenBelastinggevallen(p: {
  loadCases: readonly (Pick<LoadCase, "id" | "name" | "type"> &
    Partial<Pick<LoadCase, "categorie" | "gegenereerd" | "eigenGewicht">>)[];
  combinations: readonly LoadCombination[];
  alleCombinaties?: readonly LoadCombination[];
  gevolgklasse?: Gevolgklasse;
  /**
   * De nationale bijlage van het project. Zonder: de bijlage uit het kenmerk
   * van de standaardcombinaties, anders de enige gevulde bijlage.
   */
  bijlage?: NationaleBijlageCode;
  loads?: readonly Pick<Load, "caseId">[];
  selfWeightEnabled?: boolean;
  /**
   * Staat er hout (of kruislaaghout) in het model? Dan hoort er een
   * UGT-combinatie met alleen blijvende belasting te zijn, anders wordt de
   * houttoets nooit met k_mod "blijvend" uitgevoerd (EN 1995-1-1 3.1.3(2)).
   */
  metHout?: boolean;
}): GevalMelding[] {
  const meldingen: GevalMelding[] = [];
  // Zelfde regel als de rekengang: het gekenmerkte geval, anders het eerste
  // blijvende (lib/eigenGewicht). Een geval dat alleen het automatische eigen
  // gewicht draagt is dus NIET leeg.
  const egDoel = eigenGewichtDoel(p.loadCases);
  const egGeval = eigenGewichtGeval(p.loadCases, p.selfWeightEnabled === true);
  const gevuld = (id: number): boolean =>
    p.loads === undefined ||
    p.loads.some((l) => l.caseId === id) ||
    egGeval?.id === id;
  const heeftFactor = (id: number, type: "uls" | "sls") =>
    p.combinations.some((c) => c.type === type && (c.factors.get(id) ?? 0) !== 0);
  const heeftBgt = p.combinations.some((c) => c.type === "sls");
  const naamVan = (id: number): string => {
    const c = p.loadCases.find((x) => x.id === id);
    return c ? `${id} ("${c.name}")` : String(id);
  };

  if (p.selfWeightEnabled && egDoel.soort === "geen") {
    meldingen.push({
      niveau: "fout",
      caseId: null,
      tekst:
        'Eigen gewicht staat aan, maar er is geen belastinggeval van type "blijvend". ' +
        "Het eigen gewicht wordt daarom NIET meegerekend. Tot september 2026 kwam het " +
        "stil in het eerste belastinggeval terecht, met de factoren van dát type — " +
        "bij een veranderlijk geval ψ₂ = 0,3 in de quasi-blijvende combinatie in plaats " +
        'van 1,0. Maak een belastinggeval van type "blijvend" aan.',
    });
  }
  if (p.selfWeightEnabled && egDoel.soort === "kenmerkNietBlijvend") {
    meldingen.push({
      niveau: "fout",
      caseId: egDoel.geval.id,
      tekst:
        `Belastinggeval ${naamVan(egDoel.geval.id)} draagt het kenmerk van het automatische eigen ` +
        'gewicht, maar is niet van type "blijvend". Het eigen gewicht wordt daarom NIET ' +
        "meegerekend: in een veranderlijk geval zou het ψ₂ = 0,3 krijgen in de quasi-blijvende " +
        "combinatie in plaats van 1,0, en γ_Q in de UGT. Er wordt ook niet stil op het eerste " +
        'blijvende geval teruggevallen. Zet het type van dit geval op "blijvend", of haal het ' +
        "kenmerk weg.",
    });
  }
  // Een ingevoerde last in het gekenmerkte geval. De app laat dat niet toe en
  // de MCP-poort weigert het; het kan alleen uit een met de hand bewerkt
  // bestand komen. De last telt gewoon mee (blijvend, γ_G), maar staat dan
  // onzichtbaar tussen het automatische eigen gewicht.
  if (egDoel.soort === "kenmerk" && p.loads) {
    const aantal = p.loads.filter((l) => l.caseId === egDoel.geval.id).length;
    if (aantal > 0) {
      meldingen.push({
        niveau: "waarschuwing",
        caseId: egDoel.geval.id,
        tekst:
          `Belastinggeval ${naamVan(egDoel.geval.id)} is het geval van het automatische eigen gewicht, ` +
          `maar er ${aantal === 1 ? "staat 1 ingevoerde last" : `staan ${aantal} ingevoerde lasten`} in. ` +
          "Die tellen mee als blijvende belasting, maar horen in een ander blijvend geval: in dit " +
          "geval zijn ze op het tekenvlak niet van het eigen gewicht te onderscheiden.",
      });
    }
  }

  // Nooit stil een deelverzameling van de standaardset — ook niet als die
  // standaardcombinaties allemaal hernoemd zijn, en ook niet als het de
  // standaardset van versie 0.3.11 en ouder is.
  const alle = p.alleCombinaties ?? p.combinations;
  const eenStandaard = alle.find((c) => c.standaard);
  const klasse = p.gevolgklasse ?? eenStandaard?.standaard?.gevolgklasse ?? STANDAARD_GEVOLGKLASSE;
  const bijlage = p.bijlage ?? eenStandaard?.standaard?.bijlage ?? STANDAARD_BIJLAGE;
  // De oude standaardset hoort bij het openen vervangen te zijn. Staat hij er
  // toch — na "Ongedaan maken" (knop of Ctrl+Z), of zelf meegestuurd via de
  // MCP-weg — dan is hij een standaardset die de gevallen en de klasse niet
  // volgt, en zoekt de controle wat er ontbreekt. Herkend op naam en factoren
  // (`isOudeStandaardcombinatie`), NIET op de formule: een referentieproject
  // draagt "G + ψ₂·Q" als formule van een eigen combinatie.
  // Gemeten zonder deze regel: oud CC3-bestand, G = 10 en Q = 5 kN/m, ligger
  // 6 m, na ongedaan maken 87,75 kNm waar (1,3·10 + 1,65·5)·4,5 = 95,625 kNm
  // hoort (NB tabel NB.5) — zonder één melding.
  const gevalIds = new Set(p.loadCases.map((c) => c.id));
  const oud = alle.filter((c) => isOudeStandaardcombinatie(c, gevalIds));
  if (oud.length > 0 || alle.some(isAfgeleidVanStandaard)) {
    const ontbrekend = ontbrekendeStandaardcombinaties({
      combinations: alle, loadCases: p.loadCases, gevolgklasse: klasse, bijlage, gevuld,
    });
    if (ontbrekend.length > 0) {
      // Een afgeleide set met bewust gekozen factoren (bijvoorbeeld K_FI op
      // NB.4, issue #196): heeft elke ontbrekende combinatie een eigen
      // combinatie met dezelfde gevallen, dan lost "Behoud eigen factoren"
      // dit op — dat zeggen we dan ook. Nooit bij de oude standaardset.
      const naHouden = oud.length > 0 ? ontbrekend : ontbrekendeStandaardcombinaties({
        combinations: bevestigEigenFactoren({
          loadCases: p.loadCases as LoadCase[], combinations: [...alle], gevolgklasse: klasse, bijlage,
          volgendGevalId: 1, volgendCombinatieId: 1,
        }).staat.combinations,
        loadCases: p.loadCases, gevolgklasse: klasse, bijlage, gevuld,
      });
      const houden = naHouden.length === 0;
      meldingen.push({
        niveau: "fout", caseId: null, vervangAdvies: true, ...(houden ? { bevestigAdvies: true as const } : {}),
        tekst: (oud.length > 0 ? `${tekstOudeSetInProject(oud, klasse)} ` : "") + tekstOntbrekend(ontbrekend, klasse) +
          (houden
            ? " De eigen combinaties van dit project hebben wel dezelfde gevallen als de ontbrekende, maar " +
              "andere factoren. Zijn die bewust gekozen (bijvoorbeeld K_FI maal NB.4), kies dan \"Behoud " +
              "eigen factoren\": een eigen combinatie met bevestigde factoren telt dan als vervanger."
            : ""),
      });
    }
  }
  // Wat voor elke set geldt, ook een volledig eigen set.
  for (const v of veranderlijkeFactorVerschillen({ loadCases: p.loadCases, combinations: p.combinations, gevuld })) {
    meldingen.push({ niveau: "fout", caseId: null, vervangAdvies: true, tekst: tekstVerschil(v, naamVan) });
  }
  for (const a of veranderlijkeBelastingenZonderLeiding({
    loadCases: p.loadCases, combinations: p.combinations, gevuld,
  })) {
    meldingen.push({ niveau: "fout", caseId: null, vervangAdvies: true, tekst: tekstZonderLeiding(a, bijlage) });
  }
  // Hout zonder UGT-combinatie met alleen blijvende belasting. De standaardset
  // heeft haar altijd (6.10a zonder veranderlijke gevallen); een eigen set
  // mogelijk niet, en dan kan de houttoets te gunstig uitvallen.
  if (p.metHout) {
    const zonder = ontbrekendeBlijvendeCombinatie({
      combinaties: p.combinations, loadCases: p.loadCases, gevuld,
    });
    if (zonder) {
      meldingen.push({
        niveau: "fout",
        caseId: null,
        vervangAdvies: true,
        tekst:
          `Er staan houten staven in het model en ${zonder.map((c) => naamVan(c.id)).join(", ")} ` +
          `${zonder.length === 1 ? "is een blijvend belastinggeval" : "zijn blijvende belastinggevallen"}, ` +
          "maar geen enkele UGT-combinatie bevat alleen blijvende belasting (zoals 6.10a zonder " +
          "veranderlijke belasting, 1,35·G). EN 1995-1-1 3.1.3(2): k_mod hoort bij de kortste " +
          "belastingsduur in een combinatie. Zonder zo'n combinatie wordt de houttoets nooit met " +
          'k_mod "blijvend" (0,60 in klimaatklasse 1 en 2) uitgevoerd, terwijl juist die bij een ' +
          "kleine veranderlijke belasting maatgevend is — de toetsing kan dan te gunstig " +
          "uitvallen. Voeg de combinatie toe, of gebruik de standaardcombinaties.",
      });
    }
  }
  // BGT-combinaties die geen toets kan plaatsen. Tot september 2026 vielen ze
  // bij de doorbuiging stil weg zodra er één herkende combinatie was, en bij
  // beton altijd.
  const nietHerkendeBgt = p.combinations.filter((c) => c.type === "sls" && soortVanCombinatie(c) === null);
  if (nietHerkendeBgt.length > 0) {
    meldingen.push({
      niveau: "waarschuwing",
      caseId: null,
      tekst:
        `BGT-combinatie ${nietHerkendeBgt.map((c) => `${c.id} ("${c.name}")`).join(", ")} ` +
        `${nietHerkendeBgt.length === 1 ? "is" : "zijn"} niet herkend als karakteristiek (6.14b), ` +
        'frequent (6.15b) of quasi-blijvend (6.16b): het kenmerk ontbreekt en de naam bevat geen ' +
        '"karakter", "frequent" of "quasi". De doorbuigingstoets van staal en hout weegt ' +
        `${nietHerkendeBgt.length === 1 ? "haar" : "ze"} veilig-zijdig mee in de omhullende; de ` +
        "betontoetsing gebruikt " + `${nietHerkendeBgt.length === 1 ? "haar" : "ze"} NIET ` +
        "(de scheurwijdte van §7.3 vraagt 6.15b, de kruip van §5.8.4 vraagt 6.16b). Is de " +
        "combinatie een van de drie, geef haar dan een herkenbare naam.",
    });
  }
  if (p.gevolgklasse !== undefined) {
    const wind = verouderdeWindCombinaties({
      loadCases: p.loadCases, combinations: alle, gevolgklasse: p.gevolgklasse, bijlage,
    });
    if (wind) {
      meldingen.push({
        niveau: "fout", caseId: null, windOpnieuwAdvies: true, tekst: tekstWindVerouderd(wind, p.gevolgklasse),
      });
    }
  }
  const blijvendAfwijkend = new Map(
    blijvendeFactorAfwijkingen({ loadCases: p.loadCases, combinations: p.combinations, bijlage })
      .map((a) => [a.caseId, a] as const),
  );

  // Twee aannames van de standaardset die de gebruiker moet kunnen zien. Alleen
  // als er standaardcombinaties worden doorgerekend: eigen combinaties stelt de
  // gebruiker zelf op.
  if (p.combinations.some((c) => c.standaard)) {
    const eigen = p.loadCases.filter((c) => c.gegenereerd?.bron !== "wind");
    const aantal = aantalGebruiksgevallen(eigen);
    if (aantal > MAX_VRIJE_GEVALLEN) {
      meldingen.push({
        niveau: "waarschuwing",
        caseId: null,
        tekst:
          `Er zijn ${aantal} veranderlijke belastinggevallen (gebruiksbelasting). De ` +
          `standaardcombinaties zetten er hoogstens ${MAX_VRIJE_GEVALLEN} afzonderlijk aan en uit; ` +
          "bij meer gaan de gevallen van één gebruikscategorie samen aan of uit. Een " +
          "gebruiksbelasting is een vrije belasting die op het meest ongunstige deel moet staan " +
          "(NEN-EN 1991-1-1 6.2.1(1)P): een per veld verdeelde vloerlast op alleen het " +
          "ongunstigste veld zit nu NIET in de set, en de omhullende kan daardoor te laag zijn. " +
          "Voeg die opstellingen toe als eigen combinaties, of beperk het aantal veranderlijke gevallen.",
      });
    }
    const soorten = [
      { type: "wind", meervoud: "windgevallen", voorbeeld: "druk op de gevel en zuiging op het dak bij één windrichting" },
      { type: "snow", meervoud: "sneeuwgevallen", voorbeeld: "de sneeuw op twee dakvlakken bij één sneeuwverdeling" },
    ] as const;
    for (const s of soorten) {
      const alternatieven = eigen.filter((c) => c.type === s.type);
      if (alternatieven.length < 2) continue;
      meldingen.push({
        niveau: "waarschuwing",
        caseId: null,
        tekst:
          `De ${s.meervoud} ${alternatieven.map((c) => `${c.id} ("${c.name}")`).join(", ")} gelden ` +
          "in de standaardcombinaties als ALTERNATIEVEN: elk leidt apart, en ze staan nooit samen " +
          "in één combinatie (zoals wind van links óf van rechts). Horen ze bij dezelfde " +
          `belasting — bijvoorbeeld ${s.voorbeeld} — zet ze dan in één belastinggeval; anders ` +
          "telt steeds maar een deel ervan mee.",
      });
    }
  }

  for (const c of p.loadCases) {
    const naam = `Belastinggeval ${c.id} ("${c.name}")`;
    const metLast = gevuld(c.id);
    if (!heeftFactor(c.id, "uls")) {
      const typeloos = c.type === undefined || c.type === "other";
      const oorzaak = typeloos
        ? `heeft ${c.type === undefined ? "geen type" : 'type "overig"'} en telt daardoor in geen ` +
          "enkele UGT-combinatie mee. Voor zo'n geval bestaat geen normfactor (NEN-EN 1990 NB " +
          "tabel NB.4 en NB.2–A1.1 kennen alleen blijvende en veranderlijke belastingen): " +
          "kies het type — blijvend, veranderlijk, sneeuw of wind — zodat de " +
          "standaardcombinaties het opnemen, of geef het in een eigen combinatie zelf een factor."
        : `(type ${TYPE_TEKST[c.type] ?? c.type}) telt in geen enkele UGT-combinatie mee: in elke ` +
          "doorgerekende combinatie is zijn factor 0. De combinaties van dit project zijn geen " +
          "(volledige) standaardset; controleer ze, of vervang ze door de standaardcombinaties.";
      meldingen.push({
        niveau: metLast ? "fout" : "waarschuwing",
        caseId: c.id,
        tekst:
          `${naam} ${oorzaak}` +
          (metLast
            ? " Zolang dat zo is, telt de last van dit geval in elke toets als NUL."
            : " Het geval is nog leeg; een last die u erin zet, telt pas mee als dit is opgelost."),
        ...(typeloos ? {} : { vervangAdvies: true as const }),
      });
      continue;
    }
    const afwijking = blijvendAfwijkend.get(c.id);
    if (afwijking) {
      meldingen.push({
        niveau: metLast ? "fout" : "waarschuwing",
        caseId: c.id,
        vervangAdvies: true,
        // Eigen factoren behouden mag (PR #126, issue #196), ook bij de kolom
        // van de oude standaardset: uit de factoren alleen is niet af te
        // leiden of ze bewust zijn. Alleen niet als geen enkele betrokken
        // combinatie bevestigd kan worden (de ongewijzigde oude standaardset).
        ...(afwijkingBevestigbaar(afwijking, p.combinations, new Set(p.loadCases.map((x) => x.id)))
          ? { bevestigAdvies: true as const } : {}),
        tekst: tekstBlijvendeAfwijking(afwijking, bijlage),
      });
    }
    if (metLast && heeftBgt && !heeftFactor(c.id, "sls")) {
      meldingen.push({
        niveau: "waarschuwing",
        caseId: c.id,
        tekst:
          `${naam} telt wel in de UGT maar in geen enkele BGT-combinatie mee: doorbuiging, ` +
          "horizontale verplaatsing en scheurwijdte zien de last van dit geval niet.",
      });
    }
  }
  return meldingen;
}

// ── Wat er bij het openen verder te melden is ─────────────────────────────

export interface CombinatieAfwijking {
  /** Factoren voor gevallen die niet bestaan; bij het openen weggehaald. */
  weesFactoren: WeesFactor[];
  /**
   * Blijvende gevallen met factoren die bij geen blijvende belasting passen —
   * in een EIGEN combinatie (een oude standaardset is bij het openen al
   * vervangen). NIET weggehaald: die factoren vermenigvuldigen wél een last;
   * alleen de gebruiker kan kiezen. Bevestigde factoren staan er niet in.
   */
  blijvend: BlijvendeAfwijking[];
  /**
   * Kan "Behoud eigen factoren" (`bevestigEigenFactoren`) deze melding
   * oplossen? Ja als er een blijvend geval is zonder de kolom van de oude
   * standaardset (issue #196); de melding bij het openen toont dan die knop.
   */
  bevestigbaar: boolean;
  /** Eén alinea voor de melding bij het openen. */
  samenvatting: string;
}

/**
 * Wat de weggehaalde wees-factoren met de lasten deden. Tot oktober 2026 stond
 * hier zonder voorwaarde "Ze vermenigvuldigden geen enkele last, dus geen
 * uitkomst van dit project verandert" — ook als er wél een last in dat
 * niet-bestaande geval stond (controle 12 oktober 2026, punt K1: een lijnlast
 * in geval 5, en de melding zei dat er niets veranderde). Zo'n last telt in
 * geen enkel belastinggeval mee; de modelcontrole weigert het model daarom.
 */
function weesLastenTekst(
  weesIds: readonly number[],
  loads: readonly Pick<Load, "id" | "caseId">[] | undefined,
): string {
  if (loads === undefined) return "";
  const wees = new Set(weesIds);
  const getroffen = loads.filter((l) => wees.has(l.caseId));
  if (getroffen.length === 0) {
    return "Er stond geen last in, dus geen uitkomst van dit project verandert. ";
  }
  const lijst = getroffen.map((l) => `last ${l.id} (geval ${l.caseId})`).join(", ");
  return (
    `LET OP: er ${getroffen.length === 1 ? "staat" : "staan"} wél ${getroffen.length === 1 ? "een last" : `${getroffen.length} lasten`} ` +
    `in een geval dat niet bestaat: ${lijst}. ${getroffen.length === 1 ? "Die last telt" : "Die lasten tellen"} ` +
    "in geen enkele berekening mee; de modelcontrole weigert het model tot " +
    `${getroffen.length === 1 ? "hij in een bestaand belastinggeval staat" : "ze in een bestaand belastinggeval staan"}. `
  );
}

/**
 * Wat er na het openen nog te melden is, naast een eventuele vervanging: de
 * wees-factoren die `verwijderWeesFactoren` weghaalde, en een blijvend geval
 * met factoren die niet bij zijn type passen. `null` = niets te melden.
 * Afwijkende EIGEN combinaties op zich worden hier niet gemeld: die zijn van
 * de gebruiker, en `meldingenBelastinggevallen` controleert ze na elke
 * wijziging.
 *
 * De herkomst "projectbestand van vóór september 2026" staat er alleen bij een
 * echt spoor: de kolom van de oude standaardset, of wees-factoren in hetzelfde
 * bestand (issue #196). Per factor staat erbij wat de NB geeft, en of de set
 * een schaal K_FI maal NB.4 volgt — onafhankelijk van de klasse, want die is
 * bij een bestand zonder klasse een terugval naar het vorige project.
 */
export function beoordeelCombinatiesBijOpenen(p: {
  combinations: readonly LoadCombination[];
  loadCases: readonly LoadCase[];
  weesFactoren?: readonly WeesFactor[];
  /** De lasten, zie `openCombinatieStaat`. Weglaten = onbekend. */
  loads?: readonly Pick<Load, "id" | "caseId">[];
  /** De bijlage van het project, voor de NB-waarden; weglaten = de enige gevulde. */
  bijlage?: NationaleBijlageCode;
}): CombinatieAfwijking | null {
  const bijlage = p.bijlage ?? STANDAARD_BIJLAGE;
  const weesFactoren = [...(p.weesFactoren ?? [])];
  const blijvend = blijvendeFactorAfwijkingen({ loadCases: p.loadCases, combinations: p.combinations, bijlage });
  if (weesFactoren.length === 0 && blijvend.length === 0) return null;

  const spoor = { wees: weesFactoren.length > 0 };
  const weesIds = [...new Set(weesFactoren.flatMap((w) => w.caseIds))].sort((a, b) => a - b);
  const delen: string[] = [];
  for (const a of blijvend) {
    const kop = `LET OP: belastinggeval ${a.caseId} ("${a.naam}") is van type blijvend, maar draagt factoren ` +
      `die niet bij een blijvende belasting passen: ${lijstVan(a)}.`;
    const regel = "Een blijvende belasting telt in de BGT met 1,0 en heeft in elke combinatie dezelfde factor " +
      "als de andere blijvende gevallen.";
    delen.push([kop, regel, herkomstVan(a, spoor)].filter((x) => x !== "").join(" "));
  }
  if (blijvend.length > 0) {
    // Eén keer voor de hele set: de schaal geldt voor alle gevallen samen.
    delen.push([tekstSchaal(blijvend[0].schaal, bijlage), "De app laat deze eigen combinaties staan.", ADVIES_EIGEN]
      .filter((x) => x !== "").join(" "));
  }
  if (weesFactoren.length > 0) {
    delen.push(
      `In ${weesFactoren.length} belastingcombinatie(s) ` +
        `(${weesFactoren.map((w) => `"${w.naam}"`).join(", ")}) stonden factoren voor ` +
        (weesIds.length === 1
          ? `belastinggeval ${weesIds[0]}, dat in dit project niet (meer) bestaat`
          : `belastinggevallen ${weesIds.join(", ")}, die in dit project niet (meer) bestaan`) +
        ": een rest van een verwijderd geval. Die factoren zijn bij het openen weggehaald. " +
        weesLastenTekst(weesIds, p.loads) +
        `Een nieuw belastinggeval krijgt een id boven ${weesIds[weesIds.length - 1]} en kan ze niet ` +
        "meer erven.",
    );
  }
  const gevalIds = new Set(p.loadCases.map((x) => x.id));
  return {
    weesFactoren,
    blijvend,
    bevestigbaar: blijvend.some((a) => afwijkingBevestigbaar(a, p.combinations, gevalIds)),
    samenvatting: delen.join(" ").trim(),
  };
}

/**
 * Zorg dat deze belastinggevallen in het project bestaan en geef hun id's, in
 * dezelfde volgorde. Voor een generator die een heel model maakt (de wizard
 * "Stalen hal"): zijn lasten moeten in gevallen van het PROJECT landen.
 *  - Een bestaand geval met dezelfde naam en hetzelfde type wordt hergebruikt.
 *  - Het geval met het kenmerk `eigenGewicht` is het gekenmerkte geval van het
 *    project. Is er geen, dan verhuist het eigen gewicht uit het eerste
 *    blijvende geval naar een nieuw gekenmerkt geval (dezelfde stap als het
 *    aanbod van issue #42, met de factoren van eigen combinaties); is er ook
 *    geen blijvend geval, dan komt er een nieuw gekenmerkt geval vooraan.
 *  - Een ontbrekend geval komt erbij met een id van de teller; de
 *    standaardcombinaties volgen.
 * Bestaande gevallen, hun lasten en eigen combinaties blijven ongemoeid: een
 * ongedaan gemaakt model verwijst daarna nog naar dezelfde gevallen.
 */
export function zorgVoorBelastinggevallen(
  staat: CombinatieStaat,
  gevraagd: readonly Pick<LoadCase, "name" | "type" | "eigenGewicht">[],
): { staat: CombinatieStaat; ids: number[] } {
  let volgend = staat;
  const ids: number[] = [];
  for (const geval of gevraagd) {
    if (isEigenGewichtGeval(geval)) {
      const bestaand = volgend.loadCases.find((c) => isEigenGewichtGeval(c));
      if (bestaand) { ids.push(bestaand.id); continue; }
      const verhuisd = verplaatsEigenGewichtNaarEigenGeval(volgend);
      if (verhuisd.id !== null) { volgend = verhuisd.staat; ids.push(verhuisd.id); continue; }
      const nieuw = voegBelastinggevalToe(volgend, geval.name, "dead");
      const gekenmerkt = wijzigBelastinggeval(nieuw.staat, nieuw.id, { eigenGewicht: true });
      volgend = {
        ...gekenmerkt,
        loadCases: [
          ...gekenmerkt.loadCases.filter((c) => c.id === nieuw.id),
          ...gekenmerkt.loadCases.filter((c) => c.id !== nieuw.id),
        ],
      };
      ids.push(nieuw.id);
      continue;
    }
    const bestaand = volgend.loadCases.find((c) =>
      !isEigenGewichtGeval(c) && c.name === geval.name && c.type === geval.type);
    if (bestaand) { ids.push(bestaand.id); continue; }
    const nieuw = voegBelastinggevalToe(volgend, geval.name, geval.type);
    volgend = nieuw.staat;
    ids.push(nieuw.id);
  }
  return { staat: volgend, ids };
}

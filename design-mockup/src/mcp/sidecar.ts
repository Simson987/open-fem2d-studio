/**
 * sidecar.ts — de hoofdlus van de solver-sidecar.
 *
 * De Rust-MCP-server rekent niet zelf. Per tool-aanroep start hij een
 * kortlevend Node-proces op deze module en voert daarmee LETTERLIJK dezelfde
 * `solveAllCases` / `solveAllCasesNonlinear` uit die de app aanroept. Er komt
 * dus geen tweede rekenkern bij: een tweede implementatie zou betekenen dat
 * hetzelfde model twee plausibele antwoorden kan geven, en in constructieve
 * software is dat een veiligheidsprobleem, geen onderhoudslast.
 *
 * DE KETEN, en waarom precies deze
 *   bouwMultiInput  → solveAllCases / solveAllCasesNonlinear
 *                   → combineResults → computeEnvelope              (`solve`: de resultaten)
 *                   → bepaalToetsKrachten2D → toetsSet2D
 *                   → buildSteelCheckInputs, buildTimberCheckInputs,
 *                     buildCltCheckInputs, buildPlaatCheckInputs     (`check`: de toetsing)
 * De resultaten volgen het analysetype en de scheefstandschakelaar van het
 * model. De UGT-toetskrachten rekent `check` ALTIJD zelf tweede orde (P-Δ) met
 * scheefstand, met de φ van de projectinstelling, in +x en −x — dezelfde
 * functie als de app (`lib/toetsKrachten.ts`, NEN-EN 1993-1-1 5.2.2(3)b en
 * (7)b). De BGT-toetsen lezen de resultaten.
 * NOOIT rechtstreeks `solveNonlinear` of `core/fem/Mesh`: die leveren andere
 * EENHEDEN én andere TEKENS. De omslag naar trek-positief gebeurt pas in de
 * adapterlaag (`engine.ts`, convertResult), dus wie de kern rechtstreeks
 * aanroept krijgt getallen die er goed uitzien en het niet zijn.
 * Let ook op de argumentvolgorde: `combineResults(combinatie, perCase)`.
 *
 * STARTEN
 *   node fem-kernel.mjs --sidecar
 * De vlag is de betrouwbare schakelaar: de bundel wordt ook door de
 * regressierunner en het bundelscript geïMPORTEERD, en dan mag de lus juist
 * NIET starten. Wordt de bundel rechtstreeks als hoofdmodule gedraaid, dan
 * start hij ook zonder vlag (zie `draaitAlsHoofdmodule`).
 *
 * GEEN `node:`-IMPORTS
 * Het bundelscript keurt elke overgebleven `import`-regel af: de bundel moet
 * volledig zelfdragend zijn, want Rust bakt hem met `include_str!` in de
 * binary. Daarom praat deze module uitsluitend via de Node-GLOBAL `process`
 * met de buitenwereld, en haalt hij `node:fs`/`node:crypto` — enkel voor de
 * zelf-hash in de handshake — op via `process.getBuiltinModule`.
 *
 * STDOUT IS PROTOCOL
 * Er staan `console.log`-regels in de gebundelde solvercode. Op stdout zouden
 * die het NDJSON-kanaal corrumperen, dus alle console-uitvoer wordt hier naar
 * stderr omgeleid voordat er ook maar één verzoek wordt afgehandeld.
 */
import {
  gevalResultaten,
  solveAllCases,
  solveAllCasesNonlinear,
} from "../components/fem/solver/engine";
import {
  combineResults,
  computeEnvelope,
  metScheefstandRichtingen,
  defaultCombinations,
  SCHEEFSTAND_COMBO_OFFSET,
  type LoadCombination,
} from "../components/fem/solver/combinations";
import type { VeldSplitsing } from "../components/fem/solver/veldpatronen";
import { buildSteelCheckInputs, profileLookupKey } from "../lib/steelCheckBuilder";
import { buildTimberCheckInputs, matchSupportedTimberGrade } from "../lib/timberCheckBuilder";
import { buildCltCheckInputs, isCltProfiel } from "../lib/cltCheckBuilder";
import { buildPlaatCheckInputs } from "../lib/plaatCheckBuilder";
import {
  alphaCrLabel,
  analyseToelichting,
  bepaalAlphaCr,
  noemerTekst,
  stabiliteitsMeldingen,
  type AlphaCrUitkomst,
} from "../components/fem/solver/alphaCr";
import {
  bepaalToetsKrachten2D,
  bepaalToetsScheefstand,
  scheefstandToelichtingToets,
  toetsOmschrijving,
  toetsScheefstandNormen,
  toetsSet2D,
  TOETS_PHI_MARGE,
  weigeringTekst,
  type ToetsKrachten2D,
} from "../lib/toetsKrachten";
import {
  selecteerCombinaties,
  type OvergeslagenCombinatie,
} from "../lib/combinatieSelectie";
import {
  bevestigdeEigenFactoren,
  gevolgklasseBijOpenen,
  meldingenBelastinggevallen,
  openCombinatieStaat,
  tekstBevestigdeEigenFactoren,
  type KlasseBron,
} from "../lib/combinatieBeheer";
import {
  GEVOLGKLASSEN,
  partieleFactoren,
  STANDAARD_GEVOLGKLASSE,
  type Gevolgklasse,
} from "../components/fem/solver/normcombinaties";
import { bouwMultiInput, type FemModelInvoer } from "../lib/modelNaarSolverInput";
import {
  splitsVeldgevallen,
  veldpatroonMeldingen,
  veldpatronenUitkomst,
} from "../components/fem/solver/veldpatronen";
import {
  bepaalEindstijfheidHout,
  losEindtoestandOp,
  metEindtoestandVarianten,
} from "../lib/houtEindstijfheid";
import { DoorsnedeOnbekendFout } from "../lib/sectionResolver";
import { eigenGewichtOverzicht } from "../lib/eigenGewichtOverzicht";
// De scheefstand φ: dezelfde afleiding als de app (App.tsx → bepaalScheefstand).
import {
  SCHEEFSTAND_BRONNEN,
  SCHEEFSTAND_BRON_LABEL,
  bepaalScheefstand,
  leidScheefstandGeometrieAf,
  toepasselijkeScheefstandNormen,
  type ScheefstandBron,
  type ScheefstandGeometrie,
  type ScheefstandNorm,
  type ScheefstandUitkomst,
} from "../lib/scheefstandNorm";
import {
  PROJECT_FORMAT_VERSION,
  combinationsFromFile,
  deserializeProject,
} from "../io/projectFile";
import type {
  ElementForces,
  MultiInput,
  MultiLcResult,
  SolverResult,
} from "../components/fem/solver/types";
import type { Beam, BeamCheckConfig, Analysetype } from "../components/fem/femTypes";
import { ANALYSETYPEN, ANALYSETYPE_LABEL, ANALYSETYPE_OMSCHRIJVING } from "../components/fem/femTypes";
import type { SteelProfile } from "../lib/types/steel/SteelProfile";
import { version as PAKKET_VERSIE } from "../../package.json";
import { beeldKernfoutAf } from "./fouten";
import { opStaalhalMaken, opStaalhalUitwerken } from "./staalhalSidecar";
import { StaalhalFout } from "../components/openFem3d/wizards/staalhal";
import { IfcSidecarInvoerFout, opIfcImporteren, opIfcUitwerken } from "./ifcImportSidecar";
import { IfcImportFout } from "../io/ifcAnalyseImport";
import { opApiCatalogus, opApiUitvoeren } from "./apiSidecar";
import { opExtensieImporteren } from "./extensieSidecar";
import { ApiFout } from "../api/register";
import { controleerVelden, keurCheckConfig, valideerModel } from "./valideerModel";
import { bijlageUitBestand, STANDAARD_BIJLAGE, type NationaleBijlageCode } from "../lib/normAanduidingen";
import {
  FOUTCODES,
  SIDECAR_OPS,
  SIDECAR_PROTOCOL,
  type Foutcode,
  mapNaarObject,
  maakFout,
  maakOk,
  ontleedVerzoek,
  serialiseerAntwoord,
  telNietEindig,
  type SidecarAntwoord,
  type SidecarVerzoek,
} from "./protocol";

/**
 * Minimale typering van de Node-global `process`. Dit project heeft bewust
 * geen `@types/node` (het is een browser-app); alleen de sidecar draait in
 * Node, en alleen deze paar velden worden gebruikt.
 */
declare const process: {
  argv: string[];
  versions: { node: string };
  exitCode?: number;
  stdin: {
    setEncoding(codering: string): void;
    on(gebeurtenis: string, luisteraar: (brok?: string) => void): void;
    resume(): void;
  };
  stdout: { write(regel: string): boolean };
  stderr: { write(regel: string): boolean };
  getBuiltinModule?: (naam: string) => unknown;
};

// ── Eenheden ───────────────────────────────────────────────────────────────
// De solver rekent in N, mm, rad en N·mm. Naar buiten toe gelden de eenheden
// uit het contract: kN, kNm, mm, rad — dezelfde eenheden die `check_steel_beam`
// gebruikt, zodat een client geen enkele grootheid zelf hoeft om te rekenen.

/** N → kN. */
const naarKN = (n: number) => n / 1000;
/** N·mm → kNm. */
const naarKNm = (nmm: number) => nmm / 1e6;

/** Eenheden- en tekenafspraak; gaat mee in elk solve-antwoord. */
const EENHEDEN = {
  kracht: "kN",
  moment: "kNm",
  verplaatsing: "mm",
  rotatie: "rad",
  teken: "N positief = trek; z positief omhoog",
  // Issue #244 (punt 053): de momentafspraak, en dat de 3D-kern een andere
  // heeft. Eén afspraak voor 2D en 3D zou alle uitvoer, rapporten en toetsen
  // van één van beide raken; de controle laat ook "een expliciete vermelding
  // van de toegepaste afspraak" toe, en dat is deze.
  teken_momenten:
    "Knoop- en reactiemomenten en rotaties (my, ry): positief tegen de klok in, gezien met x naar rechts en z omhoog. Staafkrachten in lokale staafassen (x van begin- naar eindknoop, +y 90 graden tegen de klok in): M positief = trek aan de -y-zijde (een ligger van links naar rechts: trek onder), V = dM/dx. Let op: solve_open_fem_3d volgt de rechterhandregel om de globale assen (X, Y, Z rechtshandig, Z omhoog); daar heeft M_y van een model in het XZ-vlak het tegengestelde teken (reacties en rotaties om Y), en de staafmomenten volgen de lokale assen van de 3D-kern.",
} as const;

// ── Zelf-hash ──────────────────────────────────────────────────────────────

/**
 * SHA-256 van het bestand dat dit proces draait, in `sha256:<hex>`-vorm.
 *
 * Dit is een TWEEDE lezer naast de Rust-kant: `build.rs` bewaakt dat de
 * ingebakken bundel bij `fem-kernel.sha256` hoort, en met deze waarde kan de
 * server bovendien controleren dat het bestand dat Node daadwerkelijk laadde
 * hetzelfde is — relevant bij de ontsnappingsklep `OPENAEC_FEM_KERNEL`.
 *
 * `process.getBuiltinModule` bestaat pas vanaf Node 22.3. Op oudere (maar
 * toegestane) Node 20/21 komt hier `null` uit; de bindende hash-poort blijft
 * dan de Rust-kant. Bewust geen `import` van `node:crypto`: het bundelscript
 * eist nul externe imports in de bundel.
 */
function zelfHash(): string | null {
  const haal = process.getBuiltinModule;
  const pad = process.argv[1];
  if (typeof haal !== "function" || !pad) return null;
  try {
    const fs = haal("node:fs") as {
      readFileSync(pad: string): { length: number };
    };
    const crypto = haal("node:crypto") as {
      createHash(alg: string): {
        update(data: unknown): { digest(codering: string): string };
      };
    };
    const bytes = fs.readFileSync(pad);
    return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
  } catch {
    return null;
  }
}

/**
 * SHA-256 van de INVOER van deze berekening (issue #244, punt 063), in
 * `sha256:<hex>`-vorm: het verzoek als JSON met de sleutels op elk niveau
 * gesorteerd, zodat dezelfde invoer in een andere sleutelvolgorde dezelfde
 * hash geeft. `bundle_hash` is iets anders: de hash van de solverbundel, gelijk
 * voor elk model dat met dezelfde bundel gerekend wordt. Samen identificeren
 * ze een uitkomst: wélk model, met wélke rekenkern. `null` zonder
 * `process.getBuiltinModule` (Node < 22.3), net als `zelfHash`.
 */
export function invoerHash(payload: unknown): string | null {
  const haal = process.getBuiltinModule;
  if (typeof haal !== "function") return null;
  const geordend = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(geordend);
    if (v !== null && typeof v === "object") {
      const uit: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        uit[k] = geordend((v as Record<string, unknown>)[k]);
      }
      return uit;
    }
    return v;
  };
  try {
    const crypto = haal("node:crypto") as {
      createHash(alg: string): {
        update(data: string): { digest(codering: string): string };
      };
    };
    const tekst = JSON.stringify(geordend(payload)) ?? "null";
    return `sha256:${crypto.createHash("sha256").update(tekst).digest("hex")}`;
  } catch {
    return null;
  }
}

// ── Payload lezen ──────────────────────────────────────────────────────────

/**
 * `detail.reden` bij een INVOER_ONGELDIG van de modelcontrole (een last naar
 * een staaf, knoop of geval dat niet bestaat, een koppel zonder `my`, …). De
 * MCP-server kiest er een eigen remedie op (sidecar.rs, REDEN_MODELCONTROLE).
 */
export const REDEN_MODELCONTROLE = "modelcontrole";

/** Payload deugt niet (vorm, veld, type) → INVOER_ONGELDIG. */
class InvoerFout extends Error {
  constructor(
    melding: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(melding);
  }
}

/** Meegestuurde bestandsinhoud is niet te lezen → BESTAND_ONLEESBAAR. */
class BestandFout extends Error {
  constructor(
    melding: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(melding);
  }
}

/** De rekenkern weigerde het model → MODEL_ONOPLOSBAAR. */
class ModelFout extends Error {}

function eisObject(waarde: unknown, veld: string): Record<string, unknown> {
  if (typeof waarde !== "object" || waarde === null || Array.isArray(waarde)) {
    throw new InvoerFout(`Veld \`${veld}\` moet een JSON-object zijn.`);
  }
  return waarde as Record<string, unknown>;
}

function eisArray(waarde: unknown, veld: string): unknown[] {
  if (!Array.isArray(waarde)) {
    throw new InvoerFout(`Veld \`${veld}\` moet een array zijn.`);
  }
  return waarde;
}

function leesTekst(payload: Record<string, unknown>, veld: string): string {
  const waarde = payload[veld];
  if (typeof waarde !== "string" || waarde.length === 0) {
    throw new InvoerFout(`Veld \`${veld}\` ontbreekt of is geen tekst.`);
  }
  return waarde;
}

/** Wat `leesModel` uit een payload haalt. */
interface GelezenModel {
  model: FemModelInvoer;
  /**
   * Het model zoals de aanroeper het aanleverde, ONGEFILTERD. `model` hierboven
   * is genormaliseerd — daar zijn onbekende sleutels al uit weggevallen, en
   * juist die moet de strenge validatie kunnen zien. Bij een projectbestand
   * bevat dit de modelvelden van het bestand; de bestandsvelden eromheen
   * (`format`, `version`, `savedAt`, …) blijven er buiten, want die horen bij
   * het bestandsformaat en niet bij het model.
   */
  rauw: Record<string, unknown>;
  beams: Beam[];
  /** Combinaties uit het projectbestand, of `null` als het bestand ze niet had. */
  combinatiesUitBestand: LoadCombination[] | null;
  /** Tweede-orde-vlag uit het projectbestand, of `null` bij een los model. */
  nonlinearUitBestand: boolean | null;
  /**
   * Het ANALYSETYPE uit het projectbestand, of `null` bij een los model (en
   * bij een bestand van vóór het veld; dan telt de booleaan hierboven).
   *
   * Tot deze wijziging kende deze weg alleen `nonlinearEnabled`. Een bestand
   * met "2e orde + fysisch" — de keuze van de constructeur — werd langs MCP
   * dus stil als geometrische tweede orde gerekend, zonder de betonstijfheidslus
   * van EN 1992-1-1 5.8.6, en het antwoord meldde `analysis_type` als
   * "tweedeOrdeGeometrisch". Dat is een ANDERE berekening met een geruststellend
   * etiket. Zie basisaudit §3.2 punt 2.
   */
  analysetypeUitBestand: Analysetype | null;
  formatVersion: number | null;
  /** Gevolgklasse uit de projectgegevens van het bestand, of `null`. */
  gevolgklasseUitBestand: Gevolgklasse | null;
  /**
   * Nationale bijlage uit de projectgegevens van het bestand, ZOALS GELEZEN
   * (normnaad), of `undefined`. Nog niet gekeurd: een `bijlage` in het verzoek
   * gaat voor (issue #17), en dan hoort een onbekende code in het bestand de
   * aanroep niet te laten stranden. `leesBijlageVoorRekening` keurt de bijlage
   * die werkelijk geldt, en weigert een onbekende code met reden.
   */
  bijlageRauwUitBestand: unknown;
  /**
   * De id-tellers uit het projectbestand, of `undefined`. Alleen voor de
   * tellers zelf: of een combinatie verouderd is, herkent `openCombinatieStaat`
   * aan naam en factoren, niet aan het bestaan van tellers.
   */
  idTellersUitBestand: { belastinggeval?: number; combinatie?: number } | undefined;
  /**
   * φ(∞,t₀) van het project (EN 1992-1-1 3.1.4) uit het projectbestand, of
   * `null` = niet opgegeven of een los model. Alleen gelezen voor de
   * BGT-eindtoestand van beton naast hout (`lib/houtEindstijfheid.ts`), zodat
   * deze weg dezelfde stijfheid gebruikt als de app.
   */
  betonKruipcoefficientUitBestand: number | null;
  /**
   * Wat er over de scheefstand te melden is: de afgeleide φ als een norm is
   * gekozen, en de waarschuwingen van die afleiding. Leeg bij de vaste noemer.
   */
  scheefstandMeldingen: string[];
  /** De normkeuze en de handmatige h en m, zoals gelezen — voor `load_project`. */
  scheefstandKeuze: {
    scheefstandBron: ScheefstandBron;
    scheefstandHoogteM: number | null;
    scheefstandAantalElementen: number | null;
  };
  /**
   * De scheefstand van de PROJECTINSTELLING, ook als de schakelaar uit staat:
   * de UGT-toets rekent er altijd mee (`lib/toetsKrachten.ts`). Dezelfde
   * bepaling als `scheefstandUitkomst` in de app, met de geometrie en de
   * toepasselijke normen ernaast voor de toets-φ en de toelichting.
   */
  scheefstandProject: {
    uitkomst: ScheefstandUitkomst;
    geometrie: ScheefstandGeometrie;
    normen: ScheefstandNorm[];
  };
}

/**
 * De scheefstand φ zoals de app hem bepaalt.
 *
 * Tot september 2026 las deze weg alleen aan/uit, de ingetikte noemer en de
 * richting. De normkeuze (`scheefstandBron`), de hoogte en het aantal
 * kolommen bleven liggen, terwijl de app met de normnoemer rekende. Gemeten
 * met de echte MCP-server: h = 5 m met EN 1993-1-1 (5.5) gaf via de app
 * 1/258,2 en via MCP 1/200 (H 29 % te hoog); een eerder ingetikte 1/500 met
 * daarna een normkeuze gaf MCP 1/500 waar de app 1/258,2 rekende (H 48 % te
 * laag). In alle zeven gemeten gevallen zonder waarschuwing.
 *
 * Nu loopt de bepaling door `bepaalScheefstand`, dezelfde functie als de app,
 * met h en m uit dezelfde afleiding (`leidScheefstandGeometrieAf`). Een bron
 * die de app niet kent wordt GEWEIGERD, niet stil als vaste noemer gerekend.
 * Zonder `scheefstandBron` (elk bestand van vóór de normkeuze) blijft het
 * precies de vaste noemer, tot op de bit.
 *
 * TWEE UITKOMSTEN. `noemer` is die van de RESULTATEN: alleen met de
 * schakelaar aan zit er een scheefstand in de krachten, en dan met deze
 * noemer. `project` is de projectinstelling zelf, ook met de schakelaar uit:
 * de UGT-toets rekent altijd met scheefstand (`lib/toetsKrachten.ts`), en dus
 * altijd met deze φ — precies `scheefstandUitkomst` van de app.
 */
function leesScheefstand(
  rauw: Record<string, unknown>,
  model: Pick<FemModelInvoer, "nodes" | "beams" | "supports">,
  opgegevenNoemer: number,
): {
  noemer: number;
  meldingen: string[];
  keuze: GelezenModel["scheefstandKeuze"];
  project: GelezenModel["scheefstandProject"];
} {
  const bronRauw = rauw.scheefstandBron;
  if (bronRauw !== undefined && bronRauw !== null &&
      !(SCHEEFSTAND_BRONNEN as readonly unknown[]).includes(bronRauw)) {
    throw new InvoerFout(
      `\`scheefstandBron\` is "${String(bronRauw)}"; bekend zijn ` +
        SCHEEFSTAND_BRONNEN.map((b) => `"${b}"`).join(", ") +
        ". Een onbekende bron wordt geweigerd, niet stil als vaste noemer gerekend.",
    );
  }
  const bron = (bronRauw ?? "vast") as ScheefstandBron;
  const hoogte = rauw.scheefstandHoogteM;
  if (hoogte !== undefined && hoogte !== null &&
      !(typeof hoogte === "number" && Number.isFinite(hoogte) && hoogte > 0)) {
    throw new InvoerFout(
      "`scheefstandHoogteM` moet een getal groter dan 0 zijn (hoogte h in m), " +
        "of null om h uit het model af te leiden.",
    );
  }
  const aantal = rauw.scheefstandAantalElementen;
  if (aantal !== undefined && aantal !== null &&
      !(typeof aantal === "number" && Number.isInteger(aantal) && aantal >= 1)) {
    throw new InvoerFout(
      "`scheefstandAantalElementen` moet een geheel getal van minstens 1 zijn " +
        "(aantal dragende verticale elementen m), of null om m uit het model af te leiden.",
    );
  }
  const keuze = {
    scheefstandBron: bron,
    scheefstandHoogteM: typeof hoogte === "number" ? hoogte : null,
    scheefstandAantalElementen: typeof aantal === "number" ? aantal : null,
  };
  // De projectinstelling, ook met de schakelaar uit (de toets rekent ermee).
  const geometrie = leidScheefstandGeometrieAf({
    nodes: model.nodes, beams: model.beams, supports: model.supports,
  });
  const normen = toepasselijkeScheefstandNormen(model.beams);
  const uit = bepaalScheefstand(
    {
      bron,
      noemer: opgegevenNoemer,
      hoogteM: keuze.scheefstandHoogteM,
      aantalElementen: keuze.scheefstandAantalElementen,
    },
    geometrie,
    normen,
  );
  const project = { uitkomst: uit, geometrie, normen };
  // De resultaten: zonder schakelaar geen scheefstand in de krachten, en met de
  // vaste noemer precies de opgegeven noemer, tot op de bit.
  if (rauw.scheefstandEnabled !== true || bron === "vast") {
    return { noemer: opgegevenNoemer, meldingen: [], keuze, project };
  }
  const herkomst = uit.norm
    ? `${SCHEEFSTAND_BRON_LABEL[uit.bron]}` +
      (uit.bron === "ongunstigste" ? ` (${SCHEEFSTAND_BRON_LABEL[uit.norm]})` : "") +
      `, h = ${uit.hoogteM} m, m = ${uit.aantalElementen}`
    : SCHEEFSTAND_BRON_LABEL[uit.bron];
  const meldingen = [
    `Scheefstand: φ = 1/${uit.noemer.toFixed(1)} volgens ${herkomst} — dezelfde ` +
      `afleiding als de app; de noemer ${opgegevenNoemer} uit het bestand telt bij ` +
      "deze normkeuze niet.",
    ...uit.waarschuwingen.map((w) => `Scheefstand: ${w}`),
  ];
  return { noemer: uit.noemer, meldingen, keuze, project };
}

/** Een geldige gevolgklasse, of `null`. */
function alsGevolgklasse(x: unknown): Gevolgklasse | null {
  return GEVOLGKLASSEN.includes(x as Gevolgklasse) ? (x as Gevolgklasse) : null;
}

/**
 * Het analysetype uit een projectbestand: de keuze van de constructeur, en de
 * enige uitspraak over WÈLKE berekening bij de bewaarde uitkomsten hoort.
 *
 * ONTBREEKT het veld (elk bestand van vóór het analysetype), dan `null`: dan
 * telt de oude booleaan `nonlinearEnabled`, precies zoals de app hem leest.
 * Staat er een waarde die deze versie niet kent, dan wordt hij GEWEIGERD en
 * niet stil op tweede orde gezet — raden welke van de drie bedoeld was levert
 * een andere berekening op dan de gebruiker bewaarde, met een etiket dat het
 * tegendeel beweert.
 */
function leesAnalysetype(waarde: unknown): Analysetype | null {
  if (waarde === undefined || waarde === null) return null;
  if (typeof waarde !== "string" || !(ANALYSETYPEN as readonly string[]).includes(waarde)) {
    throw new InvoerFout(
      `\`analysetype\` is ${JSON.stringify(waarde)}; bekend zijn ` +
        ANALYSETYPEN.map((a) => `"${a}"`).join(", ") +
        ". Een onbekend analysetype wordt geweigerd, niet stil als tweede orde gerekend.",
    );
  }
  return waarde as Analysetype;
}

/**
 * Model uit een payload: ofwel `model` (store-eigen vorm), ofwel `project`
 * (de INHOUD van een `.ifcfem`-bestand). De sidecar leest zelf nooit van
 * schijf: Rust levert de bytes aan. Zo blijft alle bestandstoegang aan één
 * kant, zijn de FEM-tools aantoonbaar alleen-lezen, en heeft de bundel geen
 * `node:fs` nodig — wat hij ook niet mag hebben, want de bundel moet nul
 * externe imports bevatten.
 */
function leesModel(payload: Record<string, unknown>): GelezenModel {
  const heeftModel = payload.model !== undefined;
  const heeftProject = payload.project !== undefined;
  if (heeftModel === heeftProject) {
    throw new InvoerFout(
      "Geef precies één van `model` (het model zelf) of `project` " +
        "(de inhoud van een .ifcfem-bestand).",
    );
  }

  if (heeftProject) {
    const project = eisObject(payload.project, "project");
    const inhoud = leesTekst(project, "inhoud");
    let bestand;
    try {
      bestand = deserializeProject(inhoud);
    } catch (err) {
      throw new BestandFout(
        "Het projectbestand kon niet worden gelezen.",
        { originele_melding: String(err) },
      );
    }
    const uitBestand = {
      nodes: bestand.nodes ?? [],
      beams: bestand.beams ?? [],
      supports: bestand.supports ?? [],
      plates: bestand.plates ?? [],
      loadCases: bestand.loadCases ?? [],
      loads: bestand.loads ?? [],
      selfWeightEnabled: bestand.selfWeightEnabled ?? false,
      scheefstandEnabled: bestand.scheefstandEnabled ?? false,
      scheefstandNoemer: bestand.scheefstandNoemer ?? 200,
      scheefstandRichting: bestand.scheefstandRichting ?? 1,
    };
    // De normkeuze van de scheefstand uit het bestand: φ zoals de app hem
    // bepaalt, of de vaste noemer als er geen (of "vast") gekozen is.
    const scheef = leesScheefstand(
      bestand as unknown as Record<string, unknown>,
      uitBestand,
      uitBestand.scheefstandNoemer,
    );
    uitBestand.scheefstandNoemer = scheef.noemer;
    return {
      model: uitBestand,
      // De arrays zijn dezelfde objecten als in het bestand, dus een onbekend
      // veld BINNEN een knoop, staaf of last blijft zichtbaar voor de validatie.
      rauw: uitBestand as unknown as Record<string, unknown>,
      scheefstandMeldingen: scheef.meldingen,
      scheefstandKeuze: scheef.keuze,
      scheefstandProject: scheef.project,
      beams: bestand.beams ?? [],
      combinatiesUitBestand: combinationsFromFile(bestand.combinations) ?? null,
      nonlinearUitBestand: bestand.nonlinearEnabled ?? null,
      analysetypeUitBestand: leesAnalysetype(bestand.analysetype),
      formatVersion: bestand.version,
      gevolgklasseUitBestand: alsGevolgklasse(
        (bestand.projectInfo as { uitgangspunten?: { gevolgklasse?: unknown } } | undefined)
          ?.uitgangspunten?.gevolgklasse,
      ),
      // De nationale bijlage stond al in het projectbestand maar werd door
      // niemand gelezen (normnaad). Hier alleen gelezen; gekeurd wordt zij in
      // `leesBijlageVoorRekening`, na de voorrang van het verzoek.
      bijlageRauwUitBestand: (bestand.projectInfo as { uitgangspunten?: { nationaleBijlage?: unknown } } | undefined)
        ?.uitgangspunten?.nationaleBijlage,
      idTellersUitBestand: bestand.idTellers,
      betonKruipcoefficientUitBestand:
        typeof bestand.betonKruipcoefficient === "number" ? bestand.betonKruipcoefficient : null,
    };
  }

  const rauw = eisObject(payload.model, "model");
  const beams = eisArray(rauw.beams ?? [], "model.beams") as Beam[];

  // Doorsnedegrootheden horen NIET in de invoer: `bouwMultiInput` leidt E, A
  // en I af uit (materiaal, profiel) via `resolveSection` — dezelfde route als
  // de app. Zou de sidecar hier losse E/A/I accepteren, dan bestond er een
  // tweede waarheid over de doorsnede; even gevaarlijk als een tweede solver
  // en moeilijker op te merken, omdat beide antwoorden plausibel ogen.
  for (const beam of beams) {
    const b = beam as unknown as Record<string, unknown>;
    for (const veld of ["E", "A", "I"]) {
      if (b[veld] !== undefined) {
        throw new InvoerFout(
          `Staaf ${String(b.id)} geeft \`${veld}\` rechtstreeks op. Dat wordt ` +
            "niet ondersteund: de doorsnede volgt uit `material` en `profile`, " +
            "zodat er één bron voor A en I is.",
        );
      }
    }
  }

  const model: FemModelInvoer = {
    nodes: eisArray(rauw.nodes ?? [], "model.nodes") as FemModelInvoer["nodes"],
    beams,
    supports: eisArray(
      rauw.supports ?? [],
      "model.supports",
    ) as FemModelInvoer["supports"],
    plates: eisArray(rauw.plates ?? [], "model.plates") as FemModelInvoer["plates"],
    loadCases: eisArray(
      rauw.loadCases ?? [],
      "model.loadCases",
    ) as FemModelInvoer["loadCases"],
    loads: eisArray(rauw.loads ?? [], "model.loads") as FemModelInvoer["loads"],
    selfWeightEnabled: rauw.selfWeightEnabled === true,
    scheefstandEnabled: rauw.scheefstandEnabled === true,
    scheefstandNoemer:
      typeof rauw.scheefstandNoemer === "number" ? rauw.scheefstandNoemer : 200,
    scheefstandRichting: rauw.scheefstandRichting === -1 ? -1 : 1,
  };
  // Ook een los model mag de normkeuze dragen — het is "exact de vorm van een
  // projectbestand", zegt het toolschema.
  const scheef = leesScheefstand(rauw, model, model.scheefstandNoemer);
  model.scheefstandNoemer = scheef.noemer;
  return {
    model,
    rauw,
    beams,
    combinatiesUitBestand: null,
    nonlinearUitBestand: null,
    analysetypeUitBestand: null,
    formatVersion: null,
    gevolgklasseUitBestand: null,
    bijlageRauwUitBestand: undefined,
    idTellersUitBestand: undefined,
    betonKruipcoefficientUitBestand: null,
    scheefstandMeldingen: scheef.meldingen,
    scheefstandKeuze: scheef.keuze,
    scheefstandProject: scheef.project,
  };
}

/**
 * De nationale bijlage uit de projectgegevens (normnaad).
 *
 * Een code die deze uitgave niet kent, wordt een INVOERFOUT met de reden erbij
 * — niet stil "NL". Een model met een vreemde bijlage doorrekenen met
 * Nederlandse partiële factoren zou een antwoord geven dat bij geen enkel land
 * hoort, en niets in de getallen verraadt dat.
 */
function leesBijlage(waarde: unknown): NationaleBijlageCode | null {
  try {
    return bijlageUitBestand(waarde);
  } catch (e) {
    throw new InvoerFout((e as Error).message);
  }
}

/**
 * De nationale bijlage waarmee deze aanroep rekent (normnaad). Eén plek, zodat
 * de standaardcombinaties (γ en ψ) en elke toetsinvoer dezelfde bijlage
 * krijgen:
 *  1. `bijlage` uit het VERZOEK (issue #17: `check_fem_model` met een losse
 *     bijlage) — wie hem uitdrukkelijk meegeeft, bedoelt deze, ook boven het
 *     projectbestand;
 *  2. die uit de projectgegevens van het bestand;
 *  3. de enige gevulde bijlage (bestand van vóór de naad, of een los model).
 * Een code die deze uitgave niet kent, in het verzoek of in het geldende
 * bestand, wordt een INVOERFOUT met reden — nooit stil NL.
 */
function leesBijlageVoorRekening(
  payload: Record<string, unknown>,
  gelezen: GelezenModel,
): NationaleBijlageCode {
  if (payload.bijlage !== undefined) {
    const uitVerzoek = leesBijlage(payload.bijlage);
    if (uitVerzoek === null) {
      throw new InvoerFout(
        "Veld `bijlage` is leeg. Laat het weg om de bijlage uit het projectbestand te gebruiken.",
      );
    }
    return uitVerzoek;
  }
  return leesBijlage(gelezen.bijlageRauwUitBestand) ?? STANDAARD_BIJLAGE;
}

/**
 * De gevolgklasse, via `gevolgklasseBijOpenen` — dezelfde regel als het openen
 * in de app: die uit het projectbestand wint (de keuze van de constructeur, net
 * als het analysetype), anders `gevolgklasse` uit het verzoek, anders de klasse
 * uit het kenmerk van de standaardcombinaties in het bestand, anders CC2 (NB
 * tabel NB.4). `aangenomen` zegt of het die laatste terugval was, zodat het
 * antwoord dat kan melden.
 */
function leesGevolgklasse(
  payload: Record<string, unknown>,
  gelezen: GelezenModel,
): { klasse: Gevolgklasse; aangenomen: boolean; bron: KlasseBron } {
  if (payload.gevolgklasse !== undefined && alsGevolgklasse(payload.gevolgklasse) === null) {
    throw new InvoerFout('Veld `gevolgklasse` moet "CC1", "CC2" of "CC3" zijn.');
  }
  const { klasse, bron } = gevolgklasseBijOpenen({
    bestand: gelezen.gevolgklasseUitBestand,
    verzoek: alsGevolgklasse(payload.gevolgklasse),
    combinations: gelezen.combinatiesUitBestand,
    terugval: STANDAARD_GEVOLGKLASSE,
  });
  return { klasse, aangenomen: bron === "terugval", bron };
}

/**
 * De waarschuwing over de herkomst van de gevolgklasse, of null. Alleen als
 * er standaardcombinaties meerekenen: meegegeven eigen combinaties hangen niet
 * van de klasse af.
 */
function gevolgklasseWaarschuwing(
  k: { klasse: Gevolgklasse; bron: KlasseBron },
  metStandaard: boolean,
  bijlage: NationaleBijlageCode,
): string | null {
  if (!metStandaard) return null;
  if (k.bron === "terugval") {
    return (
      "Geen gevolgklasse opgegeven (niet in de projectgegevens en niet als " +
      "`gevolgklasse`): de standaardcombinaties zijn opgesteld voor CC2, met de " +
      "factoren van NEN-EN 1990 NB tabel NB.4."
    );
  }
  if (k.bron === "kenmerk") {
    return (
      "Geen gevolgklasse in de projectgegevens of als `gevolgklasse`: de klasse " +
      `${k.klasse} komt uit het kenmerk van de standaardcombinaties in het projectbestand, ` +
      `met de factoren van NEN-EN 1990 ${partieleFactoren(k.klasse, bijlage).bron}.`
    );
  }
  return null;
}

/**
 * Combinaties uit de payload (`{ id, name, type, formula, factors }` met
 * `factors` als `{ "<caseId>": factor }`), anders die uit het projectbestand,
 * anders de standaardset die de app afleidt uit de belastinggevallen (type en
 * gebruikscategorie) en de gevolgklasse — zie normcombinaties.ts. Tot
 * september 2026 was die laatste een vaste lijst voor de case-id's 1 t/m 4,
 * ongeacht welke gevallen het model had.
 *
 * Een projectbestand gaat door `openCombinatieStaat` — PRECIES de functie
 * waarmee de app een project opent: factoren voor gevallen die niet bestaan
 * eruit, en de standaardset van versie 0.3.11 en ouder, standaardcombinaties
 * van een andere gevolgklasse en verouderde windgeneratorcombinaties
 * vervangen. Zo rekent `project_path` met dezelfde combinaties als de app na
 * het openen van hetzelfde bestand. Tot deze correctie rekende de MCP-weg met
 * de oude set en meldde hij alleen dat die afweek — en bij een bestand met
 * id-tellers zelfs dat niet (CC3: 87,75 kNm waar 95,625 hoort). Wat er is
 * vervangen of weggehaald staat in `openMeldingen`, en daarmee in `warnings`.
 * Combinaties die de aanvrager zelf meestuurt blijven zoals ze zijn: dat is
 * een uitdrukkelijke keuze, en `meldingenBelastinggevallen` controleert ze —
 * ook als het de acht combinaties van versie 0.3.11 en ouder zijn: die geven
 * een FOUT als er voor deze gevallen en deze klasse combinaties ontbreken
 * (gemeten zonder die controle: CC3, 87,75 kNm waar 95,625 hoort, stil).
 */
function leesCombinaties(
  payload: Record<string, unknown>,
  gelezen: GelezenModel,
  gevolgklasse: Gevolgklasse,
  bijlage: NationaleBijlageCode,
): { lijst: LoadCombination[]; bron: "verzoek" | "bestand" | "standaard"; openMeldingen: string[] } {
  if (payload.combinations !== undefined) {
    const rauw = eisArray(payload.combinations, "combinations");
    const uit = combinationsFromFile(
      rauw as Parameters<typeof combinationsFromFile>[0],
    );
    if (!uit) throw new InvoerFout("Veld `combinations` is geen geldige lijst.");
    return { lijst: uit, bron: "verzoek", openMeldingen: [] };
  }
  if (gelezen.combinatiesUitBestand) {
    const { staat, afwijking, vervanging } = openCombinatieStaat({
      loadCases: gelezen.model.loadCases,
      combinations: gelezen.combinatiesUitBestand,
      gevolgklasse,
      bijlage,
      idTellers: gelezen.idTellersUitBestand,
      // Voor de melding over wees-factoren: stond er een last in zo'n geval?
      loads: gelezen.model.loads,
    });
    return {
      lijst: staat.combinations,
      bron: "bestand",
      openMeldingen: [vervanging?.samenvatting, afwijking?.samenvatting]
        .filter((x): x is string => typeof x === "string" && x !== ""),
    };
  }
  return {
    lijst: defaultCombinations(gelezen.model.loadCases, gevolgklasse, bijlage),
    bron: "standaard",
    openMeldingen: [],
  };
}

/**
 * Profieldatabase uit de payload. De bron is de Rust-crate `steel-profiles`;
 * de sidecar draagt bewust geen eigen kopie, zodat er één profielwaarheid is.
 * Ontbreekt de lijst, dan blijft `steel_check_inputs` leeg — mét waarschuwing,
 * nooit stil.
 */
function leesProfielen(payload: Record<string, unknown>): Map<string, SteelProfile> {
  const db = new Map<string, SteelProfile>();
  if (payload.profiles === undefined) return db;
  for (const item of eisArray(payload.profiles, "profiles")) {
    const profiel = item as SteelProfile;
    if (!profiel || typeof profiel.name !== "string") {
      throw new InvoerFout("Elk item in `profiles` heeft een `name` nodig.");
    }
    const sleutel = profileLookupKey(profiel.name);
    if (!db.has(sleutel)) db.set(sleutel, profiel);
  }
  return db;
}

/**
 * De houtsterkteklassen uit de payload. De bron is de Rust-kern
 * (`nen_en_1995_1_1::strength_class_names`); de bundel draagt alleen een
 * statische terugval, en die kan uit de pas lopen. `null` = niet meegegeven.
 */
function leesHoutklassen(payload: Record<string, unknown>): string[] | null {
  if (payload.timber_grades === undefined) return null;
  const lijst = eisArray(payload.timber_grades, "timber_grades");
  if (!lijst.every((g) => typeof g === "string")) {
    throw new InvoerFout("Elk item in `timber_grades` moet tekst zijn.");
  }
  return lijst as string[];
}

/**
 * `check_config`: per staaf-id de store-eigen `BeamCheckConfig`.
 *
 * GEKEURD met dezelfde poort als de `checkConfig` van een staaf in het model
 * (`keurCheckConfig`). Tot september 2026 werd dit argument zonder keuring
 * samengevoegd: een tikfout (`ltbSupportSpacing` zonder `_m`, `loadDuraton`)
 * viel stil terug op de standaardwaarde, en een sleutel die geen staaf is werd
 * genegeerd. Allebei leveren ze een geslaagde toetsing die bij een ander model
 * hoort; daarom een fout.
 */
function pasCheckConfigToe(beams: Beam[], payload: Record<string, unknown>): Beam[] {
  if (payload.check_config === undefined) return beams;
  const configs = eisObject(payload.check_config, "check_config");
  const bestaand = new Set(beams.map((b) => String(b.id)));
  const fouten: string[] = [];
  for (const [sleutel, cc] of Object.entries(configs)) {
    if (!bestaand.has(sleutel)) {
      fouten.push(
        `check_config.${sleutel}: het model heeft geen staaf met dit nummer; deze instellingen ` +
          "zouden nergens worden toegepast.",
      );
    }
    fouten.push(...keurCheckConfig(cc, `check_config.${sleutel}`));
  }
  if (fouten.length > 0) {
    throw new InvoerFout(
      `\`check_config\` bevat ${fouten.length} invoerfout(en) — zie \`detail.fouten\`. ` +
        "Een onbekend veld of staafnummer wordt geweigerd, niet genegeerd: genegeerd levert " +
        "het een toetsing op met de standaardwaarde in plaats van de bedoelde instelling.",
      { fouten },
    );
  }
  return beams.map((beam) => {
    const extra = configs[String(beam.id)];
    if (extra === undefined) return beam;
    return {
      ...beam,
      checkConfig: {
        ...(beam.checkConfig ?? {}),
        ...(eisObject(extra, `check_config.${beam.id}`) as BeamCheckConfig),
      },
    };
  });
}

// ── Resultaten vormgeven ───────────────────────────────────────────────────

function vormStaafkrachten(ef: ElementForces, metStations: boolean) {
  const basis = {
    N: naarKN(ef.N),
    V: naarKN(ef.V),
    M_start: naarKNm(ef.M_start),
    M_end: naarKNm(ef.M_end),
    L_mm: ef.L_mm,
  };
  if (!metStations) return basis;
  return {
    ...basis,
    stations_mm: ef.stations_mm,
    N_x: ef.normalForce.map(naarKN),
    V_x: ef.shearForce.map(naarKN),
    M_x: ef.bendingMoment.map(naarKNm),
    w_x: ef.deflection,
    u_x: ef.axialDisp,
    // Hoekverdraaiing θ(x) = dw/dx per station, in RAD — dezelfde eenheid als
    // `displacements.ry` en als `units.rotatie`, dus geen omrekening. Positief
    // = tegen de klok in; bij een stijve aansluiting is θ op een staafeinde
    // gelijk aan de ry van de aanliggende knoop.
    theta_x: ef.rotation ?? [],
  };
}

function vormResultaat(res: SolverResult, metStations: boolean) {
  return {
    reactions: mapNaarObject(res.reactions, (r) => ({
      fx: naarKN(r.fx),
      fz: naarKN(r.fz),
      my: naarKNm(r.my),
    })),
    displacements: mapNaarObject(res.displacements, (d) => ({
      ux: d.ux,
      uz: d.uz,
      ry: d.ry,
    })),
    elements: mapNaarObject(res.elements, (ef) => vormStaafkrachten(ef, metStations)),
    maxDisplacement: res.maxDisplacement,
  };
}

function vormEnvelop(env: ReturnType<typeof computeEnvelope>) {
  return {
    elements: mapNaarObject(env.elements, (e) => ({
      N_min: naarKN(e.N_min),
      N_max: naarKN(e.N_max),
      V_min: naarKN(e.V_min),
      V_max: naarKN(e.V_max),
      M_min: naarKNm(e.M_min),
      M_max: naarKNm(e.M_max),
      governingCombinationId: e.governingCombinationId,
      governingMAbs: naarKNm(e.governingMAbs),
      // Positie van governingMAbs langs de staaf (mm vanaf de startknoop).
      // De omhullende leest het volledige stationsraster plus het veldextreem
      // tussen de stations (V = 0, solver/veldExtremen.ts), dus dat maximum
      // ligt zelden op een uiteinde of op een station; zonder deze waarde is
      // niet af te leiden waar het maatgevende moment optreedt.
      governingMPos_mm: e.governingMPos_mm,
    })),
    reactions: mapNaarObject(env.reactions, (r) => ({
      fx_min: naarKN(r.fx_min),
      fx_max: naarKN(r.fx_max),
      fz_min: naarKN(r.fz_min),
      fz_max: naarKN(r.fz_max),
    })),
    maxDisplacement: env.maxDisplacement,
    maxDisplacementCombinationId: env.maxDisplacementCombinationId,
  };
}

/** `field_patterns` in het antwoord van `solve`; zie solver/veldpatronen.ts. */
function vormVeldpatronen(splitsing: VeldSplitsing, varianten: readonly LoadCombination[]) {
  return {
    rule:
      "NEN-EN 1991-1-1 6.2.1(1): veranderlijke vloerbelasting (type live, niet categorie H) op " +
      "twee of meer velden is per veld gesplitst; per combinatie is elke ongunstige veldplaatsing " +
      "(invloedslijn door superpositie) als variant doorgerekend. Een veld = de staven tussen " +
      "opeenvolgende steunpunten van een doorgaande lijn.",
    cases: splitsing.gesplitst.map((g) => ({
      case_id: g.ouderId,
      name: g.naam,
      fields: splitsing.deelgevallen.filter((d) => d.ouderId === g.ouderId).map((d) => ({
        sub_case_id: d.id,
        field: d.veld,
        beams: d.veld === null ? [] : splitsing.velden.find((v) => v.nummer === d.veld)?.staven ?? [],
      })),
    })),
    combinations: varianten.map((c) => ({
      id: c.id,
      base_id: c.veldpatroon?.basisId ?? null,
      name: c.name,
    })),
  };
}

// ── Bewerkingen ────────────────────────────────────────────────────────────

function opHandshake() {
  return {
    protocol: SIDECAR_PROTOCOL,
    node_version: `v${process.versions.node}`,
    bundle_version: PAKKET_VERSIE,
    bundle_hash: zelfHash(),
    project_format_version: PROJECT_FORMAT_VERSION,
    ops: [...SIDECAR_OPS],
  };
}

/**
 * EIGEN GEWICHT IN HET ANTWOORD (#231). In de MCP-modelvorm staat
 * `selfWeightEnabled` standaard UIT (een nieuw appproject zet hem aan). Tot
 * deze correctie stond dat nergens in het antwoord: bij een ligger IPE300 van
 * 200 m viel 0,4144 kN/m × 200 m = 82,9 kN — 98 % van de belasting — zonder
 * een woord weg. De standaard blijft UIT (een bestaand verzoek mag niet stil
 * een andere belasting krijgen), maar het antwoord zegt het nu ALTIJD, met het
 * niet meegenomen staafgewicht in kN, en per belastinggeval of het eigen
 * gewicht erin zit.
 *
 * De getallen komen uit `eigenGewichtOverzicht` met de schakelaar AAN — dat
 * is LETTERLIJK de functie waarmee `bouwMultiInput` het eigen gewicht maakt
 * (q = ρ·A·g, EN 1991-1-1 tabel A.4 voor ρ staal = 7850 kg/m³), dus het
 * gemelde totaal is precies wat er met `selfWeightEnabled: true` bij zou komen.
 */
function eigenGewichtStatus(model: FemModelInvoer): {
  melding: string | null;
  info: {
    enabled: boolean;
    case_id: number | null;
    case_name: string | null;
    beams_weight_kN: number;
    plates_kN_per_m2: Array<{ plate_id: number; p: number }>;
    included_per_case: Record<string, boolean>;
  };
} {
  const aan = model.selfWeightEnabled === true;
  let overzicht: ReturnType<typeof eigenGewichtOverzicht> | null = null;
  try {
    overzicht = eigenGewichtOverzicht({
      nodes: model.nodes,
      beams: model.beams,
      plates: model.plates,
      loadCases: model.loadCases,
      selfWeightEnabled: true,
    });
  } catch {
    // Een materiaal zonder dichtheid weigert de rekengang zelf al met reden.
    overzicht = null;
  }
  // Het geval dat het eigen gewicht zou krijgen; zonder (blijvend) geval is
  // er geen, en dat meldt `meldingenBelastinggevallen` zelf.
  const doelId = overzicht?.caseId ?? null;
  const doelNaam = doelId === null
    ? null
    : (model.loadCases.find((c) => c.id === doelId)?.name ?? null);
  const gewichtKN = overzicht?.gewichtStavenKN ?? 0;
  const platen = (overzicht?.platen ?? []).map((pl) => ({ plate_id: pl.plateId, p: pl.p }));
  const perGeval: Record<string, boolean> = {};
  for (const c of model.loadCases) perGeval[String(c.id)] = aan && c.id === doelId;

  let melding: string | null = null;
  if (!aan && (gewichtKN > 0 || platen.length > 0)) {
    const delen: string[] = [];
    if (gewichtKN > 0) {
      delen.push(`${gewichtKN.toFixed(1).replace(".", ",")} kN staafgewicht`);
    }
    if (platen.length > 0) {
      delen.push(
        `het plaatgewicht (ρ·g·t) van ${platen.length} plaat/platen, ` +
          platen.map((pl) => `plaat ${pl.plate_id}: ${Math.abs(pl.p).toFixed(2).replace(".", ",")} kN/m²`).join(", "),
      );
    }
    melding =
      "Eigen gewicht staat UIT (`selfWeightEnabled` ontbreekt of is false; in de MCP-modelvorm is " +
      `dat de standaard): ${delen.join(" en ")} is in GEEN belastinggeval meegenomen. ` +
      "Zet `selfWeightEnabled: true` om het mee te rekenen" +
      (doelNaam !== null
        ? ` (het komt dan in belastinggeval ${doelId} "${doelNaam}").`
        : "; het model heeft daarvoor een blijvend geval (type \"dead\") nodig.");
  }
  return {
    melding,
    info: {
      enabled: aan,
      case_id: aan ? doelId : null,
      case_name: aan ? doelNaam : null,
      beams_weight_kN: gewichtKN,
      plates_kN_per_m2: platen,
      included_per_case: perGeval,
    },
  };
}

/** Welke bewerking de rekengang vraagt: alleen de resultaten, of ook de toetsing. */
type Bewerking = "solve" | "check";

/**
 * De toets heeft geen krachten: de tweede-ordeberekening (P-Δ) van de toets
 * faalt in een UGT-combinatie (`ToetsKrachten2D.weigering`). Wordt
 * MODEL_ONOPLOSBAAR, met de reden per combinatie en de toetsanalyse in
 * `detail` — dezelfde code als een tweede-ordeberekening die niet convergeert.
 */
class ToetsGeweigerdFout extends Error {
  constructor(
    melding: string,
    readonly detail: Record<string, unknown>,
  ) {
    super(melding);
  }
}

/** Eén α_cr-uitkomst in de vorm van de uitvoer. */
function vormAlphaCr(u: AlphaCrUitkomst) {
  return {
    combination_id: u.combinatieId,
    name: u.naam,
    alpha_cr: u.alphaCr,
    status: u.status,
    ...(u.grens !== undefined ? { bound: u.grens } : {}),
    ...(u.reden !== undefined ? { reason: u.reden } : {}),
    label: alphaCrLabel(u),
  };
}

/**
 * De RESULTAATREKENGANG, gedeeld door `solve` en `check`: het model zoals het
 * is ingesteld — het analysetype en de scheefstandschakelaar van het model.
 * Hieruit komen de resultaten van `solve` en de BGT van de toetsing. De
 * UGT-toetskrachten rekent `opCheck` daarna zelf (`bepaalToetsKrachten2D`).
 */
function rekenDoor(payload: Record<string, unknown>, bewerking: Bewerking) {
  const gelezen = leesModel(payload);

  // Strenge veldpoort VÓÓR het rekenen. Een onbekende of verkeerd getypte
  // sleutel is geen schoonheidsfoutje: `bouwMultiInput` laat zo'n last door
  // alle takken heen vallen en de solve slaagt met een resultaat waarin die
  // last ontbreekt — nul, en niet te onderscheiden van een echte nul. Weigeren
  // is daarom het enige veilige antwoord. Dit staat NA `leesModel`, zodat de
  // specifiekere melding over losse E/A/I op een staaf voorrang houdt.
  const veldFouten = controleerVelden(gelezen.rauw);
  if (veldFouten.length > 0) {
    throw new InvoerFout(
      `Het model bevat ${veldFouten.length} invoerfout(en) — zie ` +
        "`detail.fouten`. Onbekende velden worden geweigerd, niet genegeerd: " +
        "een genegeerd veld levert een geslaagde berekening op die bij een " +
        "ander model hoort.",
      { fouten: veldFouten },
    );
  }
  // DE MODELCONTROLE VAN `validate`, ook hier (controle 12 oktober 2026, punt
  // K1). Tot dan draaide `solve`/`check` alleen de veldpoort hierboven: een
  // lijnlast op staaf 7 die niet bestaat, of in belastinggeval 5 dat niet
  // bestaat, viel in de mapping stil weg, en het antwoord (R = 2,5 kN waar
  // 32,5 kN hoort) had `warnings: []`. `validate_fem_model` en de app weigerden
  // hetzelfde model wél. Nu dezelfde `valideerModel`, zonder de combinatieset
  // (die meldingen staan hieronder als "FOUT: …" in `warnings`, ongewijzigd).
  //
  // DE VOLGORDE. De bevindingen worden hier bepaald, maar pas NA de rekenkern
  // gemeld: een model dat de kern of de mapping zelf weigert, houdt zo zijn
  // eigen foutcode en melding (MODEL_ONOPLOSBAAR met knoop en richting,
  // DOORSNEDE_ONBEKEND per staaf). Wat de kern wél zou doorrekenen terwijl de
  // controle een fout ziet, wordt geweigerd — nooit meer een uitkomst bij een
  // ander model dan er is ingevoerd.
  const modelFouten = valideerModel(gelezen.rauw, { alleenModel: true }).errors;
  const weigerBijModelfouten = (): void => {
    if (modelFouten.length === 0) return;
    const getoond = modelFouten.slice(0, 5);
    throw new InvoerFout(
      `Model niet doorgerekend — de modelcontrole (dezelfde als \`validate_fem_model\` en de ` +
        `app) vindt ${modelFouten.length} fout(en): ${getoond.join(" ")}` +
        (modelFouten.length > getoond.length ? ` En nog ${modelFouten.length - getoond.length}; zie \`detail.fouten\`.` : ""),
      // `reden` onderscheidt deze weigering van de veldpoort hierboven: de
      // MCP-server geeft er een eigen remedie bij (issue #204), want hier gaat
      // het om een fout in het model, niet om een onbekend veld.
      { fouten: modelFouten, reden: REDEN_MODELCONTROLE },
    );
  };

  const klasseGelezen = leesGevolgklasse(payload, gelezen);
  const gevolgklasse = klasseGelezen.klasse;
  // Een projectbestand gaat door dezelfde functie als het openen in de app:
  // wees-factoren eruit, verouderde combinaties vervangen (zie leesCombinaties).
  const bijlage = leesBijlageVoorRekening(payload, gelezen);
  const gelezenCombinaties = leesCombinaties(payload, gelezen, gevolgklasse, bijlage);
  const combinatieBron = gelezenCombinaties.bron;
  const alleCombinaties = gelezenCombinaties.lijst;
  // Dezelfde selectie als de app (lib/combinatieSelectie): bij een zuivere
  // staalconstructie waarin geen staaf een vloer- of dakeis krijgt (alleen
  // overwegend verticale staven zonder doorbuigingsklasse) vallen de
  // ongewijzigde standaardcombinaties 6.15b en 6.16b af, want geen enkele
  // staaltoets leest ze dan. De knopen gaan mee: zonder knopen is de stand
  // van een staaf niet te zien en blijft alles staan. Dat gebeurt HIER en niet
  // in de app-laag, zodat een MCP-solve niet meer combinaties oplevert dan de
  // app toont — hetzelfde model hoort langs elke weg hetzelfde antwoord te
  // geven. Wat er wegvalt staat in `combinations_skipped` en in `warnings`.
  const selectie = selecteerCombinaties(
    alleCombinaties,
    gelezen.beams,
    gelezen.model.plates,
    { loadCases: gelezen.model.loadCases, gevolgklasse, bijlage, nodes: gelezen.model.nodes },
  );
  // Met een scheefstand elke combinatie in twee varianten, één per richting —
  // dezelfde ontvouwing als de app (basisaudit nr 28).
  const combinatiesZonderEindtoestand = metScheefstandRichtingen(
    selectie.actief,
    gelezen.model.scheefstandEnabled,
    gelezen.model.scheefstandRichting,
  );

  // `check` kent geen `nonlinear`: de UGT-toets rekent altijd tweede orde met
  // scheefstand, en een vlag die dat lijkt te kunnen omzetten wordt geweigerd
  // in plaats van genegeerd (dezelfde regel als de argumenten van
  // `check_fem_model` in de MCP-server).
  if (bewerking === "check" && payload.nonlinear !== undefined) {
    throw new InvoerFout(
      "Veld `nonlinear` bestaat niet bij `check`: de UGT-toets rekent altijd tweede orde " +
        "(P-Δ) met scheefstand (NEN-EN 1993-1-1 5.2.2(3)b en (7)b), los van het analysetype. " +
        "Laat het veld weg; het analysetype van de resultaten volgt uit het projectbestand.",
    );
  }
  // Het ANALYSETYPE van de RESULTATEN: uit het projectbestand als dat er is —
  // een projectbestand draagt de keuze van de constructeur, en die mag een
  // tool-vlag niet stilzwijgend overrulen. Het veld `analysetype` wint van de
  // oude booleaan `nonlinearEnabled`, precies zoals `analysetypeUitBestand` in
  // de app. De toets rekent hoe dan ook tweede orde (`opCheck`).
  //
  // De fysisch niet-lineaire stand wordt langs deze weg GEWEIGERD in plaats
  // van als geometrische tweede orde gerekend: de secans-EI per segment komt
  // uit de betonkern (EN 1992-1-1 5.8.6) en die lus draait in de app, niet in
  // de sidecar. Stil terugvallen zou een andere krachtsverdeling opleveren
  // dan het bestand bewaart, met "tweedeOrdeGeometrisch" als etiket erop. Bij
  // `check` geldt dat ook voor de toets: die draait de ronde in de app op haar
  // eigen tweede-ordeberekening.
  const analysetype: Analysetype =
    gelezen.analysetypeUitBestand !== null
      ? gelezen.analysetypeUitBestand
      : gelezen.nonlinearUitBestand !== null
        ? (gelezen.nonlinearUitBestand ? "tweedeOrdeGeometrisch" : "eersteOrde")
        : (payload.nonlinear === true ? "tweedeOrdeGeometrisch" : "eersteOrde");
  if (analysetype === "tweedeOrdeFysisch") {
    throw new InvoerFout(
      bewerking === "check"
        ? "Het projectbestand staat op \"2e orde + fysisch\" (tweedeOrdeFysisch). De UGT-toets " +
            "rekent dan op haar eigen tweede-ordeberekening met scheefstand de fysisch " +
            "niet-lineaire betonronde: per segment de secans-EI uit de betonkern (NEN-EN 1992-1-1 " +
            "5.8.6). Die ronde draait alleen in de app en niet langs deze weg. Er wordt NIET stil " +
            "geometrisch getoetst; zet het analysetype op \"tweedeOrdeGeometrisch\" (of " +
            "\"eersteOrde\": de toets rekent toch P-Δ met scheefstand) als de betonstijfheidslus " +
            "niet de bedoeling is."
        : "Het projectbestand staat op \"2e orde + fysisch\" (tweedeOrdeFysisch): de " +
            "betonstaven krijgen daarbij per segment de secans-EI uit de betonkern " +
            "(NEN-EN 1992-1-1 5.8.6). Die lus draait alleen in de app en niet langs " +
            "deze weg. Er wordt NIET stil als geometrische tweede orde gerekend; zet " +
            "het analysetype op \"tweedeOrdeGeometrisch\" als dat de bedoeling is.",
    );
  }
  const nonlinear = analysetype !== "eersteOrde";

  // De eindstijfheid van hout (NEN-EN 1995-1-1 2.3.2.2): in een statisch
  // onbepaalde constructie met verschillend kruipgedrag krijgt elke
  // UGT-combinatie eindtoestandvarianten met E_mean,fin — dezelfde bepaling en
  // dezelfde varianten als de app (`lib/houtEindstijfheid.ts`). Geldt
  // 2.2.3(5), dan is `combinaties` dezelfde lijst als zonder deze stap.
  // Met de toetsconfiguratie uit `check_config` erbij: de klimaatklasse daarin
  // bepaalt k_def (tabel 3.2), net als bij de toetsing zelf.
  const eindstijfheid = bepaalEindstijfheidHout({
    nodes: gelezen.model.nodes,
    beams: pasCheckConfigToe(gelezen.beams, payload),
    supports: gelezen.model.supports,
    plates: gelezen.model.plates,
    analysetype,
    // φ(∞,t₀) van het project, zoals de app hem meegeeft: de BGT-eindtoestand
    // (EN 1995-1-1 2.2.3(4)) rekent een betonstaaf daarmee met E_c,eff.
    betonKruipcoefficient: gelezen.betonKruipcoefficientUitBestand,
  });
  const combinaties = metEindtoestandVarianten(
    combinatiesZonderEindtoestand, gelezen.model.loadCases, eindstijfheid, bijlage,
  );

  const detail = payload.detail ?? "samenvatting";
  if (detail !== "samenvatting" && detail !== "stations") {
    throw new InvoerFout(
      "Veld `detail` moet \"samenvatting\" of \"stations\" zijn.",
    );
  }
  const metStations = detail === "stations";

  const multiInput = bouwMultiInput(gelezen.model);
  // Veranderlijke vloerbelasting veldsgewijs (issue #219, NEN-EN 1991-1-1
  // 6.2.1(1)): dezelfde stap als de app, alleen bij eerste orde. Zonder geval
  // over meer velden is `rekenInput` de invoer zelf.
  // Trek-alleen staven (#234): ook niet-lineair, dus geen veldpatronen.
  const metTrekAlleen = gelezen.model.beams.some((b) => b.tensionOnly);
  const veldSplitsing = nonlinear || metTrekAlleen ? null : splitsVeldgevallen(multiInput, gelezen.model.loadCases);
  const rekenInput = veldSplitsing?.input ?? multiInput;

  const start = Date.now();
  let perCaseResultaat: MultiLcResult;
  try {
    perCaseResultaat = nonlinear
      ? solveAllCasesNonlinear(multiInput)
      : solveAllCases(rekenInput);
  } catch (err) {
    throw new ModelFout(String((err as Error)?.message ?? err));
  }
  // De kern accepteerde het model; de modelcontrole heeft het laatste woord.
  weigerBijModelfouten();
  const { perCase } = perCaseResultaat;
  // De combinaties met hun veldpatroonvarianten: hiermee wordt gecombineerd,
  // omhuld en getoetst. De deelgevallen gaan als belastinggevallen mee naar
  // de toetsbouwers (belastingduur, ψ).
  const veld = veldpatronenUitkomst(veldSplitsing, gelezen.model.loadCases, combinaties, perCase);
  const rekenCombinaties = veld.combinaties;
  const rekenGevallen = veld.uitkomst
    ? [...gelezen.model.loadCases, ...veld.uitkomst.gevallen]
    : gelezen.model.loadCases;
  try {
    losEindtoestandOp(rekenInput, perCase, rekenCombinaties, eindstijfheid);
  } catch (err) {
    throw new ModelFout(String((err as Error)?.message ?? err));
  }

  // Bij `check` gebruikt de toets van de UGT-resultaten alleen wat ze kan
  // hergebruiken (`bepaalToetsKrachten2D`): P-Δ met de schakelaar aan, dezelfde
  // φ en richting als de toets en geen UGT-eindtoestandvariant. Anders rekent
  // de toets alle UGT zelf in ±x; dan zijn de UGT-resultaten (bij P-Δ één som
  // per combinatie) en de omhullende alleen rekentijd, en een UGT-som zonder
  // scheefstand die divergeert zou de check afbreken met MODEL_ONOPLOSBAAR in
  // plaats van via de weigering van de toets. De BGT komt altijd uit de
  // resultaten (B6). `combinaties` blijft de volledige lijst.
  const ugtNodig = bewerking !== "check" || ugtResultatenHergebruikbaar(
    analysetype, gelezen, multiInput, combinaties,
  );
  const teRekenen = ugtNodig ? rekenCombinaties : rekenCombinaties.filter((c) => c.type !== "uls");
  let combinationResults: Map<number, SolverResult>;
  let envelope: ReturnType<typeof computeEnvelope> | null;
  try {
    combinationResults = new Map(
      teRekenen.map((c) => [c.id, combineResults(c, perCase)] as const),
    );
    // De omhullende staat alleen in het antwoord van `solve`.
    envelope = bewerking === "check" ? null : computeEnvelope(rekenCombinaties, perCase);
  } catch (err) {
    throw new ModelFout(String((err as Error)?.message ?? err));
  }
  const solveMs = Date.now() - start;

  const gevraagd = gelezen.model.loadCases.map((lc) => lc.id);
  // Alleen de gewone geval-id's: de tegengestelde scheefstandrichting staat
  // onder verschoven id's in de Map en is geen belastinggeval.
  const opgelost = [...gevalResultaten(perCase).keys()];
  // `solveAllCases` slaat een belastinggeval zonder werkzame last stilzwijgend
  // over. Zonder deze lijst krijgt een client een ontbrekende sleutel die als
  // "nul" leest; daarom staat hij expliciet in het antwoord.
  const legeGevallen = gevraagd.filter((id) => !perCase.has(id));
  const metHout = gelezen.beams.some((b) => matchSupportedTimberGrade(b.material) !== null);

  // De waarschuwingen over de resultaten. Ze komen in twee delen, omdat de
  // α_cr-meldingen ertussen staan, en die verschillen per bewerking: `solve`
  // meldt α_cr van de resultaten, `check` die van de toets.
  const waarschuwingenVoor: string[] = [];
  // De scheefstand: welke φ er is gerekend als een norm is gekozen, en wat
  // die afleiding te melden had. Zo is in het antwoord te lezen waarom de
  // horizontale krachten niet bij de noemer uit het bestand horen.
  waarschuwingenVoor.push(...gelezen.scheefstandMeldingen);
  // Eindstijfheid hout: wat er is doorgerekend en wat niet (2.2.3(4), 2.2.3(5)).
  waarschuwingenVoor.push(...eindstijfheid.meldingen.map((m) => (m.niveau === "fout" ? `FOUT: ${m.tekst}` : m.tekst)));
  if (legeGevallen.length > 0) {
    waarschuwingenVoor.push(
      `Belastinggeval(len) ${legeGevallen.join(", ")} zonder werkzame last ` +
        "overgeslagen; ze tellen als nulbijdrage in de combinaties.",
    );
  }
  for (const weg of selectie.overgeslagen) {
    // Luid, niet stil: wie acht combinaties in het bestand zette en er zes
    // terugkrijgt, moet in het antwoord kunnen lezen waarom.
    waarschuwingenVoor.push(`Combinatie ${weg.id} overgeslagen — ${weg.reden}`);
  }
  // Ook als de standaardcombinaties uit een bestand komen of bij het inlezen
  // zijn vervangen: dan rekenen ze evengoed met de aangenomen (of uit het
  // kenmerk overgenomen) klasse.
  const klasseMelding = gevolgklasseWaarschuwing(
    klasseGelezen,
    combinatieBron === "standaard" || alleCombinaties.some((c) => c.standaard),
    bijlage,
  );
  if (klasseMelding) waarschuwingenVoor.push(klasseMelding);
  // Wat er bij het inlezen van het projectbestand is vervangen of weggehaald —
  // dezelfde tekst als de melding bij het openen in de app.
  waarschuwingenVoor.push(...gelezenCombinaties.openMeldingen);
  // Eigen gewicht uit: altijd melden, met wat er wegvalt (#231).
  const eigenGewicht = eigenGewichtStatus(gelezen.model);
  if (eigenGewicht.melding) waarschuwingenVoor.push(eigenGewicht.melding);
  // Veldsgewijze plaatsing (issue #219): afkapping van het aantal patronen, en
  // bij een niet-lineaire berekening de waarschuwing dat er niet veldsgewijs
  // is geplaatst — nooit stil.
  if (veld.uitkomst) waarschuwingenVoor.push(...veld.uitkomst.meldingen);
  const resultatenLineair = !nonlinear && !metTrekAlleen;
  for (const m of veldpatroonMeldingen({
    beams: gelezen.model.beams,
    supports: gelezen.model.supports,
    loadCases: gelezen.model.loadCases,
    loads: gelezen.model.loads,
    lineair: resultatenLineair,
  })) {
    waarschuwingenVoor.push(m.tekst);
  }
  // De UGT-toets van `check` rekent altijd tweede orde (#199): ook bij lineaire
  // resultaten staat een veldsgewijs geval daar op alle velden tegelijk.
  if (bewerking === "check" && resultatenLineair) {
    for (const m of veldpatroonMeldingen({
      beams: gelezen.model.beams,
      supports: gelezen.model.supports,
      loadCases: gelezen.model.loadCases,
      loads: gelezen.model.loads,
      lineair: false,
    })) {
      waarschuwingenVoor.push(`UGT-toets (tweede orde met scheefstand): ${m.tekst}`);
    }
  }

  // Een belastinggeval met last dat in geen enkele doorgerekende UGT-combinatie
  // meetelt, en eigen gewicht zonder blijvend geval. Tot september 2026 kwam
  // hier niets: een geval van type "overig" telde stil als nul (basisaudit nr 1).
  // En — dezelfde functie als de app — een blijvend geval met factoren die
  // niet bij een blijvende belasting passen, en standaardcombinaties die
  // ontbreken: dan is de combinatieset stil een deel van de juiste set.
  const waarschuwingenNa: string[] = [];
  for (const m of meldingenBelastinggevallen({
    loadCases: gelezen.model.loadCases,
    combinations: combinaties,
    alleCombinaties,
    gevolgklasse,
    bijlage,
    loads: gelezen.model.loads,
    selfWeightEnabled: gelezen.model.selfWeightEnabled,
    metHout,
  })) {
    waarschuwingenNa.push(m.niveau === "fout" ? `FOUT: ${m.tekst}` : m.tekst);
  }
  // Bewust gekozen eigen factoren (issue #196): geen FOUT, wel vermeld.
  const bevestigd = tekstBevestigdeEigenFactoren(
    bevestigdeEigenFactoren({ loadCases: gelezen.model.loadCases, combinations: combinaties, bijlage }), bijlage,
  );
  if (bevestigd) waarschuwingenNa.push(bevestigd);

  return {
    gelezen,
    gevolgklasse,
    bijlage,
    analysetype,
    eindstijfheid,
    multiInput,
    combinaties,
    veldSplitsing,
    veldVarianten: veld.uitkomst?.combinaties ?? [],
    combinatiesOvergeslagen: selectie.overgeslagen,
    combinationResults,
    envelope,
    perCase,
    metStations,
    nonlinear,
    metHout,
    solveMs,
    gevraagd,
    opgelost,
    legeGevallen,
    waarschuwingenVoor,
    waarschuwingenNa,
    rekenCombinaties,
    rekenGevallen,
    eigenGewicht: eigenGewicht.info,
    formatVersion: gelezen.formatVersion,
  };
}

/**
 * Kan de toets van `check` de UGT-resultaten hergebruiken? Dezelfde voorwaarden
 * als `hergebruikt` in `bepaalToetsKrachten2D`: tweede orde, de schakelaar aan,
 * geen UGT-eindtoestandvariant, en de φ en richting van de resultaten gelijk
 * aan die van de toets (met hout eventueel verhoogd volgens EN 1995 (5.1)).
 */
function ugtResultatenHergebruikbaar(
  analysetype: Analysetype,
  gelezen: GelezenModel,
  multiInput: MultiInput,
  combinaties: readonly LoadCombination[],
): boolean {
  if (analysetype === "eersteOrde" || !gelezen.model.scheefstandEnabled) return false;
  if (combinaties.some((c) => c.type === "uls" && c.eindtoestand !== undefined)) return false;
  const resultaat = multiInput.scheefstand;
  if (!resultaat || resultaat.richting !== gelezen.model.scheefstandRichting) return false;
  const ts = bepaalToetsScheefstand(
    gelezen.scheefstandProject.uitkomst,
    toetsScheefstandNormen(gelezen.model.beams, gelezen.model.plates ?? []),
  );
  return Math.abs(resultaat.phi - ts.phi) <= ts.phi * TOETS_PHI_MARGE;
}

/**
 * De reden bij een nummer uit `beam_ids` dat geen staaf in het model is.
 * Dezelfde woorden als `reden_bestaat_niet` in `fem_tools.rs`, dat hetzelfde gat
 * aan de Rust-kant dicht voor een bundel van vóór deze regel.
 */
function redenBestaatNiet(id: number): string {
  return (
    `bestaat niet in het model — staaf ${id} is gevraagd in \`beam_ids\`, maar het ` +
    "model heeft geen staaf met dit nummer; er is niets getoetst"
  );
}

/**
 * Een staaf hoort precies één keer in het antwoord: in een toetsinvoer óf in
 * `skipped_beams`, en daar maar één keer. Twee bouwers kunnen dezelfde staaf
 * met een reden overslaan; dubbel melden leest als twee staven. De eerste reden
 * blijft staan, en een staaf die wél toetsinvoer heeft staat hier niet.
 */
function eenmaalPerStaaf(
  lijst: { beam_id: number; reason: string }[],
  getoetst: ReadonlySet<number>,
): { beam_id: number; reason: string }[] {
  const gezien = new Set<number>();
  const uit: { beam_id: number; reason: string }[] = [];
  for (const s of lijst) {
    if (getoetst.has(s.beam_id) || gezien.has(s.beam_id)) continue;
    gezien.add(s.beam_id);
    uit.push(s);
  }
  return uit;
}

/**
 * `solve`: de RESULTATEN — het model zoals het is ingesteld, met α_cr per
 * UGT-combinatie van deze berekening. Geen toetsinvoer: die rustte op deze
 * krachten, terwijl de toets altijd zelf tweede orde met scheefstand rekent
 * (`opCheck`). Wie wil toetsen, vraagt `check`.
 */
function opSolve(payload: Record<string, unknown>) {
  const d = rekenDoor(payload, "solve");

  // De kritieke lastfactor α_cr per UGT-combinatie van de resultaten
  // (basisaudit nr 27), met de meldingen bij het analysetype van het model.
  // Informatief (issue #199, B14): de toets rekent altijd zelf tweede orde
  // met scheefstand, dus "eerste orde niet toegestaan" is geen FOUT meer.
  const stabiliteit = bepaalAlphaCr(d.multiInput, d.combinaties, d.combinationResults);
  const waarschuwingen = [
    ...d.waarschuwingenVoor,
    ...stabiliteitsMeldingen(stabiliteit, d.analysetype, d.gelezen.model.scheefstandEnabled)
      .map((m) => m.tekst),
    ...d.waarschuwingenNa,
  ];

  const antwoord = {
    solver_version: PAKKET_VERSIE,
    // De hash van de SOLVERBUNDEL (zelfde voor elk model met deze bundel);
    // `model_hash` is die van de invoer (issue #244, punt 063).
    bundle_hash: zelfHash(),
    model_hash: invoerHash(payload),
    units: EENHEDEN,
    nonlinear_used: d.nonlinear,
    cases_requested: d.gevraagd,
    cases_solved: d.opgelost,
    cases_skipped_empty: d.legeGevallen,
    // Combinaties die dit model niet nodig heeft — zelfde gedachte als
    // `cases_skipped_empty`: een ontbrekende sleutel in `combinations` leest
    // anders als "nul" in plaats van als "niet berekend, en wel hierom".
    combinations_skipped: d.combinatiesOvergeslagen.map(
      (c: OvergeslagenCombinatie) => ({
        id: c.id,
        name: c.naam,
        reason: c.reden,
      }),
    ),
    per_case: mapNaarObject(gevalResultaten(d.perCase), (r) => vormResultaat(r, d.metStations)),
    combinations: mapNaarObject(d.combinationResults, (r) =>
      vormResultaat(r, d.metStations),
    ),
    envelope: vormEnvelop(d.envelope!),
    // De veldsgewijze plaatsing (issue #219): welke gevallen per veld zijn
    // gesplitst en welke combinatie-id's varianten zijn. Alleen aanwezig als
    // er iets te plaatsen viel; een model zonder blijft byte-gelijk.
    ...(d.veldSplitsing ? { field_patterns: vormVeldpatronen(d.veldSplitsing, d.veldVarianten) } : {}),
    // Het analysetype van deze resultaten en α_cr per UGT-combinatie.
    stability: {
      analysis_type: d.analysetype,
      alpha_cr: stabiliteit.map(vormAlphaCr),
    },
    // Of en waar het eigen gewicht is meegerekend, en hoeveel het is (#231).
    self_weight: d.eigenGewicht,
    warnings: waarschuwingen,
    solve_ms: d.solveMs,
  };

  const ontspoord = telNietEindig(antwoord.per_case) +
    telNietEindig(antwoord.combinations) +
    telNietEindig(antwoord.envelope);
  if (ontspoord > 0) {
    antwoord.warnings.push(
      `${ontspoord} resultaatwaarde(n) zijn NaN of oneindig. JSON schrijft die ` +
        "als null weg, wat als nul kan worden gelezen — vertrouw dit resultaat niet.",
    );
  }

  return antwoord;
}

/** De toetsanalyse in de vorm van de uitvoer (`stability` van `check`). */
function vormToetsStabiliteit(toets: ToetsKrachten2D, modelAnalysetype: Analysetype) {
  return {
    // De analyse van de TOETSKRACHTEN: altijd tweede orde.
    analysis_type: toets.analyse.soort,
    // De analyse van de resultaten (en de BGT-toetsen).
    model_analysis_type: modelAnalysetype,
    // De resultaten waren al deze tweede orde met deze φ: geen extra som.
    hergebruikt: toets.analyse.hergebruikt,
    scheefstand: {
      phi: toets.analyse.phi,
      noemer: toets.analyse.noemer,
      bron: toets.analyse.bron,
      // De schakelaar van het model; die geldt alleen voor de resultaten.
      model_scheefstand_aan: toets.analyse.scheefstandModelAan,
      // De toets rekent altijd met deze scheefstand. Een bundel van vóór die
      // regel kent het veld niet; de MCP-server weigert dan de toetsing.
      afgedwongen: true,
    },
    // α_cr per UGT-basiscombinatie van de toets: informatief, want de grens
    // α_cr ≥ 10 van 5.2.1(3) geldt alleen voor eerste orde.
    alpha_cr: toets.alphaCr.map(vormAlphaCr),
  };
}

/**
 * De vaste regel over de toetskrachten in `warnings`: welke analyse, welke φ
 * en waar die vandaan komt, en wat de instellingen van het model nog doen.
 */
function toetsRegel(
  toets: ToetsKrachten2D,
  modelAnalysetype: Analysetype,
  scheefstandModelAan: boolean,
  project: ScheefstandUitkomst,
): string {
  const a = toets.analyse;
  const herkomst = a.bron === "en1995" && project.bron !== "en1995"
    ? `${SCHEEFSTAND_BRON_LABEL.en1995}, want het model bevat hout`
    : project.norm
      ? `${SCHEEFSTAND_BRON_LABEL[project.bron]}` +
        (project.bron === "ongunstigste" ? ` (${SCHEEFSTAND_BRON_LABEL[project.norm]})` : "") +
        `, h = ${project.hoogteM} m, m = ${project.aantalElementen}`
      : SCHEEFSTAND_BRON_LABEL[project.bron];
  return (
    `Toetskrachten: de UGT-toets rekent altijd ${ANALYSETYPE_LABEL[a.soort]} met scheefstand ` +
    `φ = 1/${noemerTekst(a.noemer)} (${herkomst}), elke UGT-combinatie in +x en −x, los van het ` +
    "analysetype en de scheefstandschakelaar van het model (NEN-EN 1993-1-1 5.2.2(3)b en (7)b, " +
    "5.3.2); de staaftoets gebruikt de systeemlengte. De resultaten " +
    `(${ANALYSETYPE_LABEL[modelAnalysetype]}, scheefstand ${scheefstandModelAan ? "aan" : "uit"}) ` +
    "gelden voor de BGT-toetsen." +
    (a.hergebruikt
      ? " De resultaten zijn al deze tweede-ordeberekening; de toets gebruikt ze zonder nieuwe som."
      : "")
  );
}

/**
 * `analyse_toelichting` van `check`: de resultaten en de toetskrachten, elk
 * met hun analyse, en daarna α_cr van de toets — het tekstblok dat het
 * rapport onder "Berekeningswijze en stabiliteit" zet. Dezelfde functie als de
 * app (`analyseToelichting`), zodat MCP, scherm en PDF dezelfde tekst hebben.
 */
function toetsAnalyseToelichting(
  toets: ToetsKrachten2D,
  d: ReturnType<typeof rekenDoor>,
  toetsNormen: readonly ScheefstandNorm[],
): string {
  const model = d.analysetype;
  // De meldingen over de toets-φ zelf staan al in `scheefstand_toelichting`.
  const phiMeldingen = bepaalToetsScheefstand(d.gelezen.scheefstandProject.uitkomst, toetsNormen).meldingen;
  return analyseToelichting({
    resultaten: {
      analysetype: model,
      label: ANALYSETYPE_LABEL[model],
      omschrijving: ANALYSETYPE_OMSCHRIJVING[model],
      scheefstandAan: d.gelezen.model.scheefstandEnabled,
      scheefstandNoemer: d.gelezen.model.scheefstandNoemer,
    },
    toets: toetsOmschrijving(toets.analyse, "2d", toetsNormen.includes("en1992")),
    alphaCr: toets.alphaCr,
    // Wat er naast de gewone berekening is gedaan en wat niet: de eindstijfheid
    // van hout (zoals in de app) en de meldingen van de toets.
    meldingen: [
      ...d.eindstijfheid.meldingen.map((m) => m.tekst),
      ...toets.meldingen.filter((m) => !phiMeldingen.includes(m)),
    ],
  });
}

/**
 * `check`: de resultaten (`rekenDoor`) plus de toetsing. De normtoetsing zelf
 * gebeurt in Rust (`steel_check::check_all_beams`,
 * `timber_check::check_all_timber_beams`, `…::clt::check_all_clt_beams` en
 * `plaat_check::check_all_plates`) — dezelfde functies die de app aanroept. De
 * sidecar levert de invoer, en levert die ook zichtbaar mee terug, zodat te
 * zien is wát er getoetst is.
 *
 * DE TOETSKRACHTEN (issue #199). De UGT komt uit `bepaalToetsKrachten2D`:
 * altijd tweede orde (P-Δ) met de scheefstand van de projectinstelling, in +x
 * en −x, ook als de schakelaar uit staat of het model eerste orde rekent —
 * dezelfde functie als de app. De BGT komt uit de resultaten (`toetsSet2D`).
 * Zijn de resultaten al P-Δ met dezelfde φ, dan zijn de toetskrachten die
 * resultaten zelf. Divergeert de tweede orde van de toets, dan is er geen
 * toetsing: MODEL_ONOPLOSBAAR met de reden per combinatie, nooit eerste orde.
 */
function opCheck(payload: Record<string, unknown>) {
  const d = rekenDoor(payload, "check");
  const { gelezen } = d;
  const project = gelezen.scheefstandProject;
  // De normen voor de toets-φ: die van de staven én van de platen (een houten
  // wandschijf geeft het minimum van NEN-EN 1995-1-1 (5.1)), zoals de app.
  const toetsNormen = toetsScheefstandNormen(gelezen.model.beams, gelezen.model.plates ?? []);

  // ── De UGT-toetskrachten: altijd tweede orde met scheefstand ──
  const start = Date.now();
  let toets: ToetsKrachten2D;
  try {
    toets = bepaalToetsKrachten2D({
      basis: d.multiInput,
      combinaties: d.combinaties,
      scheefstand: {
        project: project.uitkomst,
        normen: toetsNormen,
        richting: gelezen.model.scheefstandRichting,
        modelAan: gelezen.model.scheefstandEnabled,
      },
      analysetype: d.analysetype,
      resultaten: { perCase: d.perCase, combinationResults: d.combinationResults },
    });
  } catch (err) {
    // `bepaalToetsKrachten2D` weigert zelf per combinatie; dit vangt een fout
    // vóór de som (een onbruikbare toetsinvoer). Ook dan geen toetsing.
    throw new ModelFout(String((err as Error)?.message ?? err));
  }
  const stability = vormToetsStabiliteit(toets, d.analysetype);
  if (toets.weigering) {
    // α_cr per combinatie als getal: die van haar basiscombinatie (de −x-
    // variant draagt id + 1 000 000). `null` = niet bepaald; de reden noemt
    // het getal alleen als het bepaald is.
    const alphaVan = (id: number) =>
      toets.alphaCr.find((u) => u.combinatieId === id)
      ?? toets.alphaCr.find((u) => u.combinatieId === id - SCHEEFSTAND_COMBO_OFFSET);
    throw new ToetsGeweigerdFout(weigeringTekst(toets.weigering), {
      toets_geweigerd: true,
      per_combinatie: toets.weigering.perCombinatie.map((p) => ({
        combination_id: p.id,
        name: p.naam,
        reason: p.reden,
        alpha_cr: alphaVan(p.id)?.alphaCr ?? null,
      })),
      stability,
    });
  }
  // Het hele model, met de toetsconfiguratie uit `check_config` erbij.
  const teToetsen = pasCheckConfigToe(gelezen.beams, payload);
  // De toetsset: de UGT uit de toets, de BGT uit de resultaten. Een fout hier
  // (de eerste orde voor §5.8 is een eigen som) is een rekenfout van het model.
  let set: ReturnType<typeof toetsSet2D>;
  try {
    set = toetsSet2D(
      toets,
      { combinaties: d.rekenCombinaties, combinationResults: d.combinationResults, perCase: d.perCase },
      teToetsen,
    );
  } catch (err) {
    throw new ModelFout(String((err as Error)?.message ?? err));
  }
  const toetsMs = Date.now() - start;

  const profileDb = leesProfielen(payload);
  const gevraagdeIds =
    payload.beam_ids === undefined
      ? []
      : (eisArray(payload.beam_ids, "beam_ids") as unknown[]).map(Number);
  // LEEG = ALLE STAVEN, zoals het toolschema van `check_fem_model` belooft
  // ("Leeg of afwezig = alle staalstaven"). Tot september 2026 las een lege
  // lijst hier als "geen enkele staaf": er werd niets getoetst, en de Rust-kant
  // meldde daarna elke staalstaaf als "niet herkend als staal" (gemeten met een
  // S235-ligger op IPE 200).
  const beamIds = gevraagdeIds.length === 0 ? null : new Set(gevraagdeIds);
  const staafSelectie =
    beamIds === null ? teToetsen : teToetsen.filter((b) => beamIds.has(b.id));
  // Een gevraagd nummer zonder staaf in het model. Tot september 2026 stond het
  // nergens in het antwoord: `beam_ids` [1, 99] gaf staaf 1 en zweeg over 99 —
  // en een staaf die nergens staat, leest als een staaf die in orde is.
  const inModel = new Set(gelezen.beams.map((b) => b.id));
  const onbekendeIds = [...new Set(gevraagdeIds)].filter((id) => !inModel.has(id));

  const staal = buildSteelCheckInputs({
    nodes: gelezen.model.nodes,
    beams: staafSelectie,
    // Het hele model, ook buiten `beam_ids`: een doorgaande lijn en een vrij
    // staafeind worden op alle staven herkend (`lib/doorgaandeLijn.ts`).
    alleBeams: teToetsen,
    plates: gelezen.model.plates,
    // Nodig om een tussensteunpunt te onderscheiden van een knoop waar een
    // ligger alleen is doorgeknipt; zonder deze lijst zou de doorbuigingstoets
    // dat verschil niet kunnen melden.
    supports: gelezen.model.supports,
    // De toetsset: de UGT-toetskrachten en de BGT van de resultaten.
    combinations: set.combinaties,
    combinationResults: set.combinationResults,
    profileDb,
    gevolgklasse: d.gevolgklasse,
    // Nodig om w₁ te vinden: de BGT-combinatie met alleen de blijvende
    // belastinggevallen (NEN-EN 1990:2002/NB:2019 A1.4.3(2)). Zonder deze
    // lijst valt w_add terug op de volledige zakking, mét notitie.
    loadCases: d.rekenGevallen,
    // De nationale bijlage gaat als `bijlage` mee naar de rekenkern.
    nationaleBijlage: d.bijlage,
    // De TOETSanalyse: tweede orde met scheefstand, de toets-φ en haar α_cr —
    // zoals de app hem meegeeft. Een kolom met een vrije kop krijgt alleen L
    // als die φ minstens haar eigen φ is (`zijdelingseKnikInVlakModel`).
    stabiliteit: set.stabiliteit,
  });

  // Hout en kruislaaghout: DEZELFDE bouwers als de app, met dezelfde filters
  // (stores/checkStore.ts): de houtbouwer ziet de CLT-staven niet, want hun
  // profiel is een opbouw en geen b × h. De belastingduur per UGT-combinatie
  // (k_mod, EN 1995-1-1 3.1.3(2)) volgt uit de belastinggevallen; de gevallen
  // zonder werkzame last — die de solve oversloeg — tellen daarbij niet mee.
  // De toetsing zelf gebeurt in Rust (`check_all_timber_beams`,
  // `check_all_clt_beams`).
  const houtklassen = leesHoutklassen(payload);
  const houtData = {
    nodes: gelezen.model.nodes,
    supports: gelezen.model.supports,
    // Het hele model en de platen, net als bij staal: een vrij staafeind
    // (uitkraging) en een doorgaande lijn worden op alle staven herkend, ook
    // buiten `beam_ids`, en een knoop op een plaat is geen vrij eind.
    alleBeams: teToetsen,
    plates: gelezen.model.plates,
    combinations: set.combinaties,
    combinationResults: set.combinationResults,
    supportedGrades: houtklassen ?? undefined,
    loadCases: d.rekenGevallen,
    // Uit de RESULTATEN: de toetsrekengang lost geen gevallen los op.
    gevallenMetLast: d.opgelost,
    nationaleBijlage: d.bijlage,
    // De toetsanalyse, zoals de app hem via de toetsstore meegeeft: voor de
    // kniklengte bij een vrij eind (hout houdt 2·L, met E_mean in de P-Δ).
    stabiliteit: set.stabiliteit,
  };
  const hout = buildTimberCheckInputs({
    ...houtData,
    beams: staafSelectie.filter((b) => !isCltProfiel(b.profile)),
  });
  const clt = buildCltCheckInputs({ ...houtData, beams: staafSelectie });
  // Platen (wandschijven): DEZELFDE bouwer als de app (stores/checkStore.ts).
  // Altijd alle platen — `beam_ids` gaat over staven. De toetsing zelf gebeurt
  // in Rust (`plaat_check::check_all_plates`).
  const plaat = buildPlaatCheckInputs({
    nodes: gelezen.model.nodes,
    plates: gelezen.model.plates ?? [],
    combinations: set.combinaties,
    combinationResults: set.combinationResults,
    nationaleBijlage: d.bijlage,
    loadCases: d.rekenGevallen,
    gevallenMetLast: d.opgelost,
  });

  // ── De waarschuwingen ──
  // Vooraan de vaste regel over de toetskrachten: zonder die regel leest een
  // client de UC als een toetsing op de krachten van `solve`.
  const waarschuwingen: string[] = [
    toetsRegel(toets, d.analysetype, gelezen.model.scheefstandEnabled, project.uitkomst),
  ];
  if (houtklassen === null && d.metHout) {
    waarschuwingen.push(
      "Geen houtsterkteklassen meegegeven (`timber_grades`); de bundel valt terug op zijn " +
        "eigen lijst, die uit de pas kan lopen met de rekenkern.",
    );
  }
  if (profileDb.size === 0) {
    waarschuwingen.push(
      "Geen profieldatabase meegegeven (`profiles`); `steel_check_inputs` " +
        "blijft daardoor leeg. Lever de lijst uit de staalprofielendatabase mee.",
    );
  }
  waarschuwingen.push(...d.waarschuwingenVoor);
  // Met de schakelaar uit stond de afleiding van φ nog nergens; de toets
  // rekent er wel mee.
  if (!gelezen.model.scheefstandEnabled) {
    waarschuwingen.push(...project.uitkomst.waarschuwingen.map((w) => `Scheefstand (toets): ${w}`));
  }
  // α_cr van de TOETS, informatief (B14): de toets rekent nooit eerste orde,
  // dus de grens α_cr ≥ 10 van 5.2.1(3) speelt voor de toets niet. Wat α_cr
  // nog zegt, gaat over de resultaten (het analysetype en de schakelaar van het
  // model) — dezelfde regels als in `analyse_toelichting`.
  for (const m of stabiliteitsMeldingen(toets.alphaCr, d.analysetype, gelezen.model.scheefstandEnabled)) {
    waarschuwingen.push(m.tekst);
  }
  waarschuwingen.push(...d.waarschuwingenNa);
  // Wat de toets te melden had: hout met E_mean en 2·L, een door hout
  // verhoogde φ, een vaste noemer onder de normwaarde, vervallen
  // eindtoestandvarianten.
  waarschuwingen.push(...toets.meldingen);

  return {
    solve_summary: {
      cases_requested: d.gevraagd,
      cases_solved: d.opgelost,
      cases_skipped_empty: d.legeGevallen,
      combinations_skipped: d.combinatiesOvergeslagen.map(
        (c: OvergeslagenCombinatie) => ({
          id: c.id,
          name: c.naam,
          reason: c.reden,
        }),
      ),
      // De resultaten; de toets rekent hoe dan ook tweede orde.
      nonlinear_used: d.nonlinear,
      solve_ms: d.solveMs,
      // De toetsrekengang: de P-Δ-sommen van de toets en de toetsset. Bij
      // hergebruik alleen het samenstellen.
      toets_ms: toetsMs,
    },
    units: EENHEDEN,
    stability,
    // De tekstblokken voor het rapport (`generate_steel_report_pdf`).
    analyse_toelichting: toetsAnalyseToelichting(toets, d, toetsNormen),
    // De afleiding van φ uit de projectinstelling, met de toets erbij: dezelfde
    // functie als het rapport van de app (`scheefstandToelichtingToets`).
    scheefstand_toelichting: scheefstandToelichtingToets(project.uitkomst, project.geometrie, toetsNormen),
    // De herkomst van de toetskrachten per combinatie, in de vorm van
    // `ReportInput.toetskrachten`: de krachtregel van de PDF noemt daarmee
    // "2e orde + scheefstand φ = 1/…" bij een UGT-toetscombinatie en
    // "resultaten" bij een BGT-combinatie — zoals de app hem meegeeft.
    toetskrachten: {
      noemer: toets.analyse.noemer,
      tweede_orde_combinaties: toets.ugtCombinaties.map((c) => c.id),
      // De namen, zodat de PDF "UGT … (scheefstand −x)" zegt in plaats van het
      // id + 1 000 000 dat in geen combinatielijst staat. Alle toetscombinaties:
      // de UGT van de toets en de BGT van de resultaten.
      combinaties: [
        ...toets.ugtCombinaties.map((c) => ({ id: c.id, naam: c.name })),
        ...d.combinaties.filter((c) => c.type !== "uls").map((c) => ({ id: c.id, naam: c.name })),
      ],
    },
    steel_check_inputs: staal.inputs,
    // Het bestaan van deze twee sleutels zegt de server dat deze bundel hout
    // toetsbaar maakt; een oudere bundel heeft ze niet, en dan meldt de server
    // dat in `skipped_beams` in plaats van "nul houtstaven" te lezen.
    timber_check_inputs: hout.inputs,
    clt_check_inputs: clt.inputs,
    // Elk gevraagd nummer staat in de toetsinvoer of hier — ook een nummer dat
    // geen staaf is — en elk maar één keer.
    skipped_beams: eenmaalPerStaaf(
      [...staal.skipped, ...hout.skipped, ...clt.skipped]
        .map((s) => ({ beam_id: s.beamId, reason: s.reason }))
        .concat(onbekendeIds.map((id) => ({ beam_id: id, reason: redenBestaatNiet(id) }))),
      new Set([...staal.inputs, ...hout.inputs, ...clt.inputs].map((i) => i.beam_id)),
    ),
    // Platen: elke plaat staat in de toetsinvoer of hier, met reden. Het
    // bestaan van `plate_check_inputs` zegt de server dat deze bundel platen
    // toetsbaar maakt.
    plate_check_inputs: plaat.inputs,
    skipped_plates: plaat.skipped.map((s) => ({ plate_id: s.plateId, reason: s.reason })),
    self_weight: d.eigenGewicht,
    warnings: waarschuwingen,
  };
}

/**
 * `validate`: droogloop zonder rekenen (plan §3.2). Bestaat omdat een tikfout
 * in een lastveld vandaag een gesláágde solve met een ontbrekende last
 * oplevert — een fout die als "nul" leest. Deze bewerking rekent bewust niet:
 * ze zegt alleen of het model doorgerekend mag worden, en waarom niet.
 */
function opValidate(payload: Record<string, unknown>) {
  const gelezen = leesModel(payload);
  // Met de combinaties die een solve zou gebruiken, zodat de droogloop óók
  // meldt welk belastinggeval in geen enkele UGT-combinatie meetelt.
  const { klasse } = leesGevolgklasse(payload, gelezen);
  const bijlage = leesBijlageVoorRekening(payload, gelezen);
  const { lijst, openMeldingen } = leesCombinaties(payload, gelezen, klasse, bijlage);
  const actief = selecteerCombinaties(lijst, gelezen.beams, gelezen.model.plates, {
    loadCases: gelezen.model.loadCases, gevolgklasse: klasse, bijlage, nodes: gelezen.model.nodes,
  }).actief;
  const uitkomst = valideerModel(gelezen.rauw, {
    combinaties: actief, alleCombinaties: lijst, gevolgklasse: klasse, bijlage,
  });
  return {
    ok: uitkomst.ok,
    errors: uitkomst.errors,
    warnings: [...openMeldingen, ...uitkomst.warnings],
    counts: {
      nodes: gelezen.model.nodes.length,
      beams: gelezen.model.beams.length,
      supports: gelezen.model.supports.length,
      plates: gelezen.model.plates.length,
      loads: gelezen.model.loads.length,
      load_cases: gelezen.model.loadCases.length,
    },
  };
}

/**
 * `load_project`: het gedeserialiseerde model plus tellingen. Alleen-lezen —
 * en de sidecar raakt de schijf niet eens aan: Rust levert de inhoud in
 * `payload.inhoud`, `payload.path` is er alleen om het antwoord te labelen.
 *
 * De combinaties gaan door `leesGevolgklasse` en `leesCombinaties`, en dus
 * door `openCombinatieStaat`: PRECIES wat `solve` met hetzelfde bestand en de
 * app na het openen gebruiken. Tot deze correctie gaf `load_project` de
 * combinaties uit het bestand rauw terug. Gemeten met de echte MCP-server: een
 * oud CC3-bestand (0.3.11, met id-tellers) gaf de acht oude combinaties, en
 * `solve_fem_model` met dat model, die combinaties en gevolgklasse CC3 gaf
 * 87,75 kNm waar (1,3·10 + 1,65·5)·4,5 = 95,625 kNm hoort (NB tabel NB.5) —
 * zonder waarschuwing, terwijl de app en `project_path` vervingen. Wat er is
 * vervangen, de herkomst van de klasse en elke FOUT in de set staan nu in
 * `warnings`. Het kenmerk `standaard` gaat niet mee: het schema van
 * `combinations` bij `solve_fem_model` kent het niet, en een teruggegeven
 * standaardcombinatie blijft aan haar formule herkenbaar.
 */
function opLoadProject(payload: Record<string, unknown>) {
  const gelezen = leesModel({
    project: { inhoud: leesTekst(payload, "inhoud") },
  });
  const m = gelezen.model;
  const klasse = leesGevolgklasse({}, gelezen);
  const bijlage = leesBijlageVoorRekening({}, gelezen);
  const { lijst, bron, openMeldingen } = leesCombinaties({}, gelezen, klasse.klasse, bijlage);
  const warnings: string[] = [];
  const klasseMelding = gevolgklasseWaarschuwing(
    klasse,
    bron === "standaard" || lijst.some((c) => c.standaard),
    bijlage,
  );
  if (klasseMelding) warnings.push(klasseMelding);
  warnings.push(...openMeldingen);
  warnings.push(...gelezen.scheefstandMeldingen);
  for (const mld of meldingenBelastinggevallen({
    loadCases: m.loadCases,
    combinations: lijst,
    alleCombinaties: lijst,
    gevolgklasse: klasse.klasse,
    bijlage,
    loads: m.loads,
    selfWeightEnabled: m.selfWeightEnabled,
    metHout: gelezen.beams.some((b) => matchSupportedTimberGrade(b.material) !== null),
  })) {
    warnings.push(mld.niveau === "fout" ? `FOUT: ${mld.tekst}` : mld.tekst);
  }
  // Bewust gekozen eigen factoren (issue #196): geen FOUT, wel vermeld.
  const bevestigd = tekstBevestigdeEigenFactoren(
    bevestigdeEigenFactoren({ loadCases: m.loadCases, combinations: lijst, bijlage }), bijlage,
  );
  if (bevestigd) warnings.push(bevestigd);
  return {
    path: typeof payload.path === "string" ? payload.path : null,
    format_version: gelezen.formatVersion,
    supported_format_version: PROJECT_FORMAT_VERSION,
    // `scheefstandNoemer` is hier de GEREKENDE noemer (na de normkeuze); de
    // keuze zelf gaat mee, zodat het model heen en weer kan zonder dat de
    // norm onderweg verdwijnt.
    model: { ...m, ...gelezen.scheefstandKeuze },
    combinations: lijst.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      formula: c.formula,
      factors: Object.fromEntries([...c.factors].map(([k, v]) => [String(k), v])),
      // Bewust gekozen eigen factoren (issue #196) gaan mee: wie de combinaties
      // ongewijzigd teruggeeft aan solve of validate, houdt de bevestiging.
      ...(c.bevestigdeFactoren && Object.keys(c.bevestigdeFactoren).length > 0
        ? { bevestigdeFactoren: Object.fromEntries(Object.entries(c.bevestigdeFactoren)) }
        : {}),
    })),
    combinations_source: bron,
    gevolgklasse: klasse.klasse,
    nonlinear_enabled: gelezen.nonlinearUitBestand,
    // Het analysetype zoals het bestand het draagt; `null` bij een bestand van
    // vóór het veld (dan telt `nonlinear_enabled`) en bij een los model.
    analysetype: gelezen.analysetypeUitBestand,
    counts: {
      nodes: m.nodes.length,
      beams: m.beams.length,
      supports: m.supports.length,
      plates: m.plates.length,
      loads: m.loads.length,
      load_cases: m.loadCases.length,
      combinations: lijst.length,
    },
    warnings,
  };
}

// ── Hoofdlus ───────────────────────────────────────────────────────────────

/**
 * Eén verzoek afhandelen. Gooit nooit: elke fout wordt een net antwoord met
 * een Nederlandse melding en een foutcode waar de Rust-kant op kan beslissen.
 */
export function verwerkVerzoek(verzoek: SidecarVerzoek): SidecarAntwoord {
  try {
    switch (verzoek.op) {
      case "handshake":
        return maakOk(verzoek.id, opHandshake());
      case "solve":
        return maakOk(verzoek.id, opSolve(verzoek.payload));
      case "check":
        return maakOk(verzoek.id, opCheck(verzoek.payload));
      case "load_project":
        return maakOk(verzoek.id, opLoadProject(verzoek.payload));
      case "validate":
        // Een gevonden modelfout is GEEN protocolfout: de bewerking is
        // geslaagd, het antwoord luidt alleen `ok: false`. Daarom `maakOk` —
        // wie een lijst bevindingen vraagt en er een krijgt, kreeg antwoord.
        return maakOk(verzoek.id, opValidate(verzoek.payload));
      case "staalhal_maken":
        return maakOk(verzoek.id, opStaalhalMaken(verzoek.payload));
      case "staalhal_uitwerken":
        return maakOk(verzoek.id, opStaalhalUitwerken(verzoek.payload));
      case "ifc_importeren":
        return maakOk(verzoek.id, opIfcImporteren(verzoek.payload));
      case "ifc_uitwerken":
        return maakOk(verzoek.id, opIfcUitwerken(verzoek.payload));
      case "api_catalogus":
        return maakOk(verzoek.id, opApiCatalogus());
      case "api_uitvoeren":
        return maakOk(verzoek.id, opApiUitvoeren(verzoek.payload));
      case "extensie_importeren":
        return maakFout(verzoek.id, "INVOER_ONGELDIG", "Extensie-import loopt via de asynchrone sidecarlus.");
    }
  } catch (err) {
    if (err instanceof ApiFout) {
      // De codes van de API staan in FOUTCODES; een ApiFout met een andere
      // code (een programmeerfout) valt door naar INTERN.
      const code = (FOUTCODES as readonly string[]).includes(err.code) ? (err.code as Foutcode) : "INTERN";
      const detail = err.detail && typeof err.detail === "object" && !Array.isArray(err.detail)
        ? err.detail as Record<string, unknown>
        : err.detail === undefined ? undefined : { waarde: err.detail };
      return maakFout(verzoek.id, code, err.message, code === "INTERN" ? { ...detail, code: err.code } : detail);
    }
    if (err instanceof StaalhalFout) {
      // De invoerpoort van de hal meldt ALLE problemen, elk met code en veld;
      // die gaan ongeschonden mee in `detail`.
      return maakFout(verzoek.id, "INVOER_ONGELDIG", err.message, { problemen: err.problemen });
    }
    if (err instanceof IfcImportFout) {
      // Een bestand dat niet te lezen is (of geen IFC4-analysemodel bevat) is
      // BESTAND_ONLEESBAAR; een ontbrekende of onbekende modelkeuze is invoer,
      // met de lijst analysemodellen erbij.
      const bestand = err.code === "leesfout" || err.code === "geenIfc4" || err.code === "geenAnalysemodel";
      return maakFout(verzoek.id, bestand ? "BESTAND_ONLEESBAAR" : "INVOER_ONGELDIG", err.message, {
        reden: err.code,
        ...(err.modellen.length > 0 ? { modellen: err.modellen } : {}),
      });
    }
    if (err instanceof IfcSidecarInvoerFout) {
      return maakFout(verzoek.id, "INVOER_ONGELDIG", err.message, { veld: err.veld });
    }
    if (err instanceof InvoerFout) {
      return maakFout(verzoek.id, "INVOER_ONGELDIG", err.message, err.detail);
    }
    if (err instanceof BestandFout) {
      return maakFout(verzoek.id, "BESTAND_ONLEESBAAR", err.message, err.detail);
    }
    if (err instanceof DoorsnedeOnbekendFout) {
      // Een staaf zonder materiaal, met een profiel dat niet bestaat of met een
      // profiel dat niet bij het materiaal hoort: dat is INVOER, en de melding
      // zegt al per staaf wat er moet veranderen. Tot september 2026 viel deze
      // fout door naar het vangnet onderaan en kwam hij als `INTERN` naar
      // buiten ("Onverwachte fout in de sidecar — Meld deze fout"): een
      // storingsmelding voor iets wat de gebruiker zelf herstelt.
      return maakFout(verzoek.id, "DOORSNEDE_ONBEKEND", err.message, {
        staven: err.staven.map((s) => ({ beam_id: s.beamId, reason: s.reden })),
      });
    }
    if (err instanceof ToetsGeweigerdFout) {
      // De toets heeft geen krachten (de tweede orde van de toets divergeert).
      // Een eigen code: het model IS doorgerekend (solve_fem_model geeft de
      // resultaten) en heeft geen mechanisme; de remedie van MODEL_ONOPLOSBAAR
      // ("controleer de opleggingen") zou de verkeerde kant op wijzen. Met de
      // reden en α_cr per combinatie en de toetsanalyse in `detail`. Geen
      // toetsing, en zeker geen toetsing op eerste-ordekrachten.
      return maakFout(verzoek.id, "TOETSING_GEWEIGERD", err.message, err.detail);
    }
    if (err instanceof ModelFout) {
      // De kern meldt in het Engels; `fouten.ts` beeldt bekende meldingen af op
      // Nederlands en kiest de foutcode. Een ONBEKENDE melding wordt niet
      // gegokt: die komt door als `INTERN`, want "de solver kon dit model niet
      // oplossen" zou een uitspraak over de constructie zijn die niemand heeft
      // onderbouwd. De originele tekst gaat in beide gevallen mee in `detail`.
      const afgebeeld = beeldKernfoutAf(err.message);
      return maakFout(
        verzoek.id,
        afgebeeld.code,
        afgebeeld.melding,
        afgebeeld.detail,
      );
    }
    return maakFout(
      verzoek.id,
      "INTERN",
      "Onverwachte fout in de sidecar.",
      { originele_melding: String((err as Error)?.stack ?? err) },
    );
  }
}

/** Alleen extensie-import wacht op een mogelijk asynchroon importFile-script. */
export async function verwerkVerzoekAsync(verzoek: SidecarVerzoek): Promise<SidecarAntwoord> {
  if (verzoek.op !== "extensie_importeren") return verwerkVerzoek(verzoek);
  try {
    return maakOk(verzoek.id, await opExtensieImporteren(verzoek.payload));
  } catch (fout) {
    if (fout instanceof ApiFout) {
      const code = (FOUTCODES as readonly string[]).includes(fout.code) ? fout.code as Foutcode : "INTERN";
      return maakFout(verzoek.id, code, fout.message,
        fout.detail && typeof fout.detail === "object" && !Array.isArray(fout.detail)
          ? fout.detail as Record<string, unknown> : undefined);
    }
    return maakFout(verzoek.id, "INTERN", "Onverwachte fout bij extensie-import.", {
      originele_melding: String((fout as Error)?.stack ?? fout),
    });
  }
}

/** Eén stdin-regel → één stdout-regel. Lege regels worden overgeslagen. */
export function verwerkRegel(regel: string): string | null {
  const opgeschoond = regel.replace(/\r$/, "");
  if (opgeschoond.trim().length === 0) return null;
  const ontleed = ontleedVerzoek(opgeschoond);
  const antwoord = ontleed.ok
    ? verwerkVerzoek(ontleed.verzoek)
    : ontleed.antwoord;
  return serialiseerAntwoord(antwoord);
}

export async function verwerkRegelAsync(regel: string): Promise<string | null> {
  const opgeschoond = regel.replace(/\r$/, "");
  if (opgeschoond.trim().length === 0) return null;
  const ontleed = ontleedVerzoek(opgeschoond);
  const antwoord = ontleed.ok ? await verwerkVerzoekAsync(ontleed.verzoek) : ontleed.antwoord;
  return serialiseerAntwoord(antwoord);
}

/**
 * Leidt alle console-uitvoer naar stderr. stdout is uitsluitend protocol: één
 * `console.log` uit de gebundelde solvercode (die er zijn) zou het NDJSON-
 * kanaal ongeldig maken en de aanroeper laten stikken op een regel die geen
 * antwoord is.
 */
function leidConsoleOm(): void {
  const naarStderr = (...delen: unknown[]) => {
    process.stderr.write(
      `${delen.map((d) => (typeof d === "string" ? d : JSON.stringify(d))).join(" ")}\n`,
    );
  };
  console.log = naarStderr;
  console.info = naarStderr;
  console.debug = naarStderr;
  console.warn = naarStderr;
  console.error = naarStderr;
}

/**
 * De hoofdlus: leest NDJSON van stdin, schrijft per regel één antwoordregel
 * naar stdout, en eindigt met exitcode 0 zodra stdin sluit.
 *
 * Er wordt bewust NIET met `process.exit()` afgesloten: dat kan een nog niet
 * geleegde stdout-pipe afkappen, waardoor het laatste antwoord verdwijnt en de
 * aanroeper een crash ziet waar een geldig antwoord stond.
 */
export function startSidecar(): void {
  leidConsoleOm();
  // De stukken van de regel die nog niet af is. Alleen het NIEUWE stuk wordt
  // op "\n" doorzocht: een verzoek van honderd MB (de staalhal met zijn
  // toetsresultaten, issue #199) komt in duizenden stukken binnen, en steeds
  // de hele buffer samenvoegen en doorzoeken kostte kwadratisch veel tijd
  // (tientallen seconden voor één regel).
  let stukken: string[] = [];
  let wachtrij = Promise.resolve();
  const plan = (regel: string) => {
    wachtrij = wachtrij.then(async () => {
      const antwoord = await verwerkRegelAsync(regel);
      if (antwoord !== null) process.stdout.write(antwoord);
    });
  };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (brok?: string) => {
    let rest = brok ?? "";
    let grens = rest.indexOf("\n");
    while (grens >= 0) {
      stukken.push(rest.slice(0, grens));
      plan(stukken.join(""));
      stukken = [];
      rest = rest.slice(grens + 1);
      grens = rest.indexOf("\n");
    }
    if (rest.length > 0) stukken.push(rest);
  });
  process.stdin.on("end", () => {
    // Laatste regel zonder afsluitende "\n" telt gewoon mee.
    plan(stukken.join(""));
    stukken = [];
    void wachtrij.then(() => { process.exitCode = 0; });
  });
  process.stdin.resume();
}

/**
 * Draait dit bestand als hoofdmodule? Vergelijkt `process.argv[1]` met de
 * eigen module-URL, zonder `node:path`/`node:url` te importeren (de bundel
 * mag geen enkele externe import bevatten).
 */
function draaitAlsHoofdmodule(): boolean {
  const pad = process.argv[1];
  if (!pad) return false;
  try {
    const eigen = decodeURIComponent(new URL(import.meta.url).pathname)
      .replace(/^\/([A-Za-z]:)/, "$1")
      .toLowerCase();
    return pad.replace(/\\/g, "/").toLowerCase() === eigen;
  } catch {
    return false;
  }
}

// Starten gebeurt ALLEEN met de expliciete vlag of als hoofdmodule. De bundel
// wordt ook geïmporteerd — door het bundelscript en door de bundelstand van de
// regressierunner — en dan mag de lus niet aanslaan.
if (process.argv.includes("--sidecar") || draaitAlsHoofdmodule()) {
  startSidecar();
}

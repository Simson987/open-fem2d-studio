/**
 * Hal van staal of hout als 3D-raamwerk — één pure generator.
 *
 * De wizard in de app, de opdracht `staalhal_maken` van het bedieningskanaal
 * en de MCP-tool `open_fem_3d_staalhal_maken` roepen allemaal DEZE functies
 * aan. Er is geen tweede vertaling van parameters naar model: wie een hal via
 * de API maakt, krijgt knoop voor knoop hetzelfde model als wie hem in de
 * wizard maakt.
 *
 * GEOMETRIE (eenheden: invoer in mm, het model in m zoals elk 3D-model)
 *  - x langs de hal (lengte), y dwars (overspanning), z omhoog; peil 0 = z 0.
 *  - Spanten op x = i · L/n (n vakken). Een opgegeven spantafstand is een
 *    MAXIMUM: n = ⌈L/s⌉ en de werkelijke h.o.h.-afstand is L/n.
 *  - Per spant een kolom op elke grens van de gelijke overspanningen en een
 *    spantligger over de dakknopen. Kolommen zijn 90° om hun as gedraaid:
 *    het lijf ligt in het spantvlak en de lokale z-as wijst naar +Y.
 *  - Dakknopen op y = j · B/m, met m velden. De gordingafstand is een
 *    MAXIMUM, horizontaal gemeten; bij een zadeldak is m even zodat de nok een
 *    knoop is.
 *  - Gordingen (binnen) en randliggers (langs de goten) lopen van spant tot
 *    spant en zijn aan beide einden scharnierend (My en Mz vrij).
 *  - Verbanden (kruizen, scharnierend) in de gekozen vakken: dakverband in elk
 *    gordingveld, wandverband in beide langsgevels, optioneel een kruis per
 *    overspanning in beide kopgevelvlakken. Optioneel trek-alleen;
 *    de 3D-kern bepaalt de actieve diagonalen met de kruisregel.
 *
 * BELASTINGEN (per m² HORIZONTALE PROJECTIE, zoals het oorspronkelijke
 * voorbeeldmodel): dakafwerking (G), sneeuw (S), optioneel dakgebruik (Q,
 * categorie H) en windzuiging op het dak als lijnlast op de gordingen met
 * hun invloedsbreedte; wind dwars (+Y) als
 * lijnlast op de kolommen (loef druk, lij zuiging); wind langs (+X) als
 * knooplasten op de dakrand van het eerste spant (de helft van de kopgevel,
 * de andere helft gaat via de gevelstijlen rechtstreeks naar de fundering).
 * Het eigen gewicht staat in het vaste geval "Eigen gewicht" en wordt bij het
 * rekenen uit profiel, materiaal en geometrie afgeleid (ρ · A · g).
 *
 * VERLOPEND PROFIEL (issue #73). Een groep kan een eindprofiel krijgen
 * (`profielEind`), met dezelfde keuring als elke verlopende staaf
 * (`bepaalVerloop`):
 *  - kolom: van de voet (begin) naar de kop (eind), één staaf;
 *  - spantligger: van de goot (begin) naar het midden van de overspanning
 *    (eind), aan beide zijden gelijk — bij een zadeldak is dat de nok. De
 *    ligger bestaat uit staven tussen de dakknopen; elke staaf verloopt van
 *    de doorsnede op haar beginknoop naar die op haar eindknoop, zodat de
 *    doorsnede over de hele ligger lineair verloopt zonder sprong. Een stalen
 *    tussendoorsnede is een eigen gelaste I (zoals bij het splitsen van een
 *    verlopende staaf); die staan in `eigenDoorsneden` van het resultaat en
 *    gaan mee in het projectbestand. Het midden moet een dakknoop zijn (een
 *    even aantal gordingvelden);
 *  - gording, randligger en verband: geen verloop (geweigerd met reden).
 *
 * FUNDERING. Standaard vaste opleggingen onder de kolommen (ingeklemd of
 * scharnierend). Of een BALKROOSTER: betonnen funderingsbalken langs alle
 * kolomlijnen en dwarsbalken onder elk spant of alleen onder de kopspanten,
 * met hun systeemlijn op een diepte d onder peil. Ligt het rooster dieper dan
 * peil, dan verbindt een betonnen poer (doorsnede van de balk, lange zijde in
 * het spantvlak) de kolomvoet op peil met het rooster. Het rooster ligt op
 * palen als verende opleggingen: K_z per paal, en horizontaal kleine veren of
 * één statisch bepaalde set (u_x en u_y in de eerste paal, u_y in de paal aan
 * het andere einde van dezelfde kolomlijn). Palen staan onder elke kolom en
 * daartussen met hoogstens de opgegeven h.o.h.-afstand.
 *
 * FOUTEN. Invoer die niet deugt levert een `StaalhalFout` met ALLE gevonden
 * problemen, elk met een vaste code (voor de vertaling in de wizard), het
 * veld en een Nederlandse melding (voor API-clients).
 */
import type { LoadCase, StructuralGrid } from "../../fem/femTypes";
import {
  CONCRETE_E_CM, bepaalVerloop, dichtheidVanMateriaal, G, matenOpPositie, resolveSection, type VerlopendeDoorsnede,
} from "../../../lib/sectionResolver";
import { tussenProfielVoorSplitsing } from "../../../lib/verloopSplitsen";
import type { EigenDoorsnede } from "../../../lib/profieleditor/types";
import { openFem3DVerloopIndelingVan } from "../openFem3dVerloop";
import { STEEL_GRADES } from "../../../lib/steelGrades";
import { matchSupportedTimberGrade, parseTimberRectMm } from "../../../lib/timberCheckBuilder";
import { profileLookupKey } from "../../../lib/steelCheckBuilder";
import { STEEL_SECTION_DIMS } from "../../../lib/steelSectionDims.generated";
import {
  cpeWand,
  CSCD_BRON,
  CSCD_GRENSHOOGTE_M,
  TERREIN_CATEGORIEEN,
  WINDGEBIEDEN,
  type TerreinCategorie,
  type Windgebied,
} from "../../../lib/wind/windEurocode";
import { calculateWindReferencePressure, NEDERLANDSE_WINDROUTE,
  requireWindCodeId, windCodeIdFromProjectInfo } from "../../../lib/wind/windCodeRoute";
import { DEFAULT_UITGANGSPUNTEN } from "../../../lib/projectBasisDefaults";
import {
  isOpenFem3DGlobalMemberLoad,
  openFem3DGlobalDirectionVector,
  openFem3DGlobalMemberLoadFactor,
  openFem3DMemberAxes,
  parseOpenFem3DModel,
  type OpenFem3DBeam,
  type OpenFem3DMemberLoad,
  type OpenFem3DModel,
  type OpenFem3DNodalLoad,
  type OpenFem3DSupport,
} from "../openFem3dModel";

// ── Parameters ──────────────────────────────────────────────────────────────

export type StaalhalDaktype = "zadeldak" | "lessenaarsdak" | "platdak";
export type StaalhalKolomvoet = "ingeklemd" | "scharnierend";
export type StaalhalProfielGroep = "kolom" | "spantligger" | "gording" | "randligger" | "verband";
export type StaalhalVerbandVakken = "kopvakken" | "alle" | "geen" | number[];
export type StaalhalFunderingType = "opleggingen" | "balkrooster";
export type StaalhalDwarsbalken = "elkSpant" | "kopspanten";
export type StaalhalPaalHorizontaal = "veren" | "statischBepaald";
export type StaalhalWindBron = "handmatig" | "stuwdruk";

export interface StaalhalProfiel {
  profiel: string;
  materiaal: string;
  /**
   * Eindprofiel van een verlopende staaf (#73); ontbreekt = prismatisch. Alleen
   * bij kolom (voet → kop) en spantligger (goot → midden van de overspanning).
   */
  profielEind?: string;
}

/**
 * De volledige, genormaliseerde parameters. `leesStaalhalInvoer` vult elk
 * ontbrekend veld met de standaardwaarde; de generator leest alleen deze vorm.
 */
export interface StaalhalParameters {
  lengteMm: number;
  breedteMm: number;
  /** Gelijke overspanningen dwars op de hal; op elke grens staat een kolomlijn. */
  aantalOverspanningen: number;
  /** Aantal vakken tussen de spanten; aantal spanten = aantalVakken + 1. */
  aantalVakken: number;
  goothoogteMm: number;
  /** Bij een lessenaarsdak is `nokhoogteMm` de hoogte aan de hoge zijde (y = B); bij een plat dak gelijk aan de goothoogte. */
  dak: { type: StaalhalDaktype; nokhoogteMm: number };
  /** Grootste gordingafstand, horizontaal gemeten. */
  gordingafstandMm: number;
  profielen: Record<StaalhalProfielGroep, StaalhalProfiel>;
  kolomvoet: StaalhalKolomvoet;
  verbanden: { vakken: StaalhalVerbandVakken; dak: boolean; wanden: boolean; kopgevels: boolean; trekAlleen: boolean };
  fundering: {
    type: StaalhalFunderingType;
    balkBreedteMm: number;
    balkHoogteMm: number;
    betonklasse: string;
    dwarsbalken: StaalhalDwarsbalken;
    /** Diepte van de systeemlijn (hart balk) onder peil 0. */
    diepteMm: number;
    paalKzKnPerMm: number;
    paalHorizontaal: StaalhalPaalHorizontaal;
    paalKhKnPerMm: number;
    /** Grootste h.o.h.-afstand van de palen langs een balk. */
    paalAfstandMm: number;
  };
  lasten: {
    dakafwerkingKnM2: number;
    sneeuwKnM2: number;
    /** Optionele dakgebruikslast Q, categorie H, per m² horizontale projectie. */
    dakgebruikKnM2: number;
    wind: {
      bron: StaalhalWindBron;
      /** Handmatig: druk op de loefgevel, zuiging op de lijgevel, opwaartse zuiging op het dak. */
      drukKnM2: number;
      zuigingKnM2: number;
      dakZuigingKnM2: number;
      /** Stuwdruk: q_p(z = nokhoogte) volgens NEN-EN 1991-1-4. */
      windgebied: Windgebied;
      terreincategorie: TerreinCategorie;
      /** Stuwdruk: vormfactor voor de opwaartse zuiging op het hele dak (één waarde, geen zones). */
      cDak: number;
    };
  };
  /** Het vaste geval "Eigen gewicht" en eigen gewicht aan. */
  eigenGewicht: boolean;
  /** Projectnaam in het projectbestand; leeg = "Staalhal L × B m". */
  projectnaam: string;
}

// De veldnamen per niveau. De MCP-server leest deze lijsten uit de bron om te
// bewijzen dat zijn strikte schema dezelfde velden noemt als deze poort (zie
// `staalhal_tools.rs`). Wie hier een veld toevoegt, voegt het daar ook toe.
export const STAALHAL_VELDEN = [
  "lengteMm", "breedteMm", "aantalOverspanningen", "spantafstandMm", "aantalVakken", "goothoogteMm", "dak", "gordingafstandMm",
  "profielen", "kolomvoet", "verbanden", "fundering", "lasten", "eigenGewicht", "projectnaam",
] as const;
export const STAALHAL_DAK_VELDEN = ["type", "nokhoogteMm", "hellingGraden"] as const;
export const STAALHAL_PROFIEL_GROEPEN = ["kolom", "spantligger", "gording", "randligger", "verband"] as const;
export const STAALHAL_PROFIEL_VELDEN = ["profiel", "materiaal", "profielEind"] as const;
/**
 * Een keuze uit de profielkiezer (`ProfielKeuze`) als profiel van een groep:
 * het eindprofiel (verlopend, #73) gaat mee, een prismatische keuze heeft er
 * geen. De generator keurt het verloop (`controleer`).
 */
export function staalhalProfielUitKeuze(keuze: { material: string; profile: string; profileEnd?: string }): StaalhalProfiel {
  const eind = keuze.profileEnd?.trim() ?? "";
  return { profiel: keuze.profile, materiaal: keuze.material, ...(eind ? { profielEind: eind } : {}) };
}

/** De groepen waarbij een eindprofiel (verlopend, #73) betekenis heeft. */
export const STAALHAL_VERLOOP_GROEPEN: readonly StaalhalProfielGroep[] = ["kolom", "spantligger"];
export const STAALHAL_VERBAND_VELDEN = ["vakken", "dak", "wanden", "kopgevels", "trekAlleen"] as const;
export const STAALHAL_FUNDERING_VELDEN = [
  "type", "balkBreedteMm", "balkHoogteMm", "betonklasse", "dwarsbalken", "diepteMm",
  "paalKzKnPerMm", "paalHorizontaal", "paalKhKnPerMm", "paalAfstandMm",
] as const;
export const STAALHAL_LASTEN_VELDEN = ["dakafwerkingKnM2", "sneeuwKnM2", "dakgebruikKnM2", "wind"] as const;
export const STAALHAL_WIND_VELDEN = [
  "bron", "drukKnM2", "zuigingKnM2", "dakZuigingKnM2", "windgebied", "terreincategorie", "cDak",
] as const;

/** Grenzen die een zinnig en rekenbaar model bewaken. */
export const STAALHAL_GRENZEN = {
  maxVakken: 100,
  maxGordingvelden: 60,
  maxOverspanningen: 10,
  maxPalen: 2000,
  maxMaatMm: 500_000,
  maxHoogteMm: 60_000,
  maxHellingGraden: 60,
} as const;

/** Standaardhelling als nokhoogte en helling ontbreken: 1 : 10. */
const STANDAARD_HELLING = 0.1;

/** Het voorbeeldmodel "staalhal 60 × 30 m" (test-open-fem3d-staalhal.mjs). */
export const STAALHAL_STANDAARD: StaalhalParameters = {
  lengteMm: 60_000,
  breedteMm: 30_000,
  aantalOverspanningen: 1,
  aantalVakken: 10,
  goothoogteMm: 8_000,
  dak: { type: "zadeldak", nokhoogteMm: 9_500 },
  gordingafstandMm: 2_500,
  profielen: {
    kolom: { profiel: "HEA 450", materiaal: "S235" },
    spantligger: { profiel: "IPE 600", materiaal: "S235" },
    gording: { profiel: "IPE 160", materiaal: "S235" },
    randligger: { profiel: "HEA 160", materiaal: "S235" },
    verband: { profiel: "CHS 88.9x4", materiaal: "S235" },
  },
  kolomvoet: "ingeklemd",
  verbanden: { vakken: "kopvakken", dak: true, wanden: true, kopgevels: false, trekAlleen: false },
  fundering: {
    type: "opleggingen",
    balkBreedteMm: 400,
    balkHoogteMm: 600,
    betonklasse: "C20/25",
    dwarsbalken: "elkSpant",
    diepteMm: 800,
    paalKzKnPerMm: 100,
    paalHorizontaal: "veren",
    paalKhKnPerMm: 5,
    paalAfstandMm: 6_000,
  },
  lasten: {
    // Sneeuw 0,8 · 0,7; wind met q_p ≈ 0,8 kN/m²: loef 0,8, lij 0,5, dak 0,6 opwaarts.
    dakafwerkingKnM2: 0.3,
    sneeuwKnM2: 0.56,
    dakgebruikKnM2: 0,
    wind: {
      bron: "handmatig",
      drukKnM2: 0.64,
      zuigingKnM2: 0.4,
      dakZuigingKnM2: 0.48,
      windgebied: "II",
      terreincategorie: "III",
      cDak: 0.6,
    },
  },
  eigenGewicht: true,
  projectnaam: "",
};

/** De spantafstand die de standaardparameters opleveren (voor documentatie en schema). */
export const STAALHAL_STANDAARD_SPANTAFSTAND_MM = 6_000;

/**
 * De beginstand van de wizard "Stalen hal…" (issue #199): het voorbeeldmodel
 * `STAALHAL_STANDAARD`, maar met TREK-ALLEEN verbanden. De UGT-toets rekent
 * altijd P-Δ met scheefstand, en dan knikken de wandverbanden CHS 88,9×4 van
 * het voorbeeldmodel zelf (N = −29,3 kN tegen π²·E·I/L² = 19,97 kN onder
 * "wind langs", α_cr = 0,688): de toets van de standaardhal werd geweigerd.
 * Slanke kruisverbanden zijn in de praktijk trek-alleen; met die beginstand is
 * de hal uit de wizard meteen toetsbaar. Het voorbeeldmodel zelf (en de
 * standaard van de MCP-tool `staalhal_maken`) blijft ongewijzigd: het is de
 * referentie van de verificatie (docs/verificatie/3d-raamwerk).
 */
export const STAALHAL_WIZARD_BEGINSTAND: StaalhalParameters = {
  ...STAALHAL_STANDAARD,
  verbanden: { ...STAALHAL_STANDAARD.verbanden, trekAlleen: true },
};

// ── Belastinggevallen ───────────────────────────────────────────────────────

/** Vaste id's van de levels (horizontale stramienassen) van de hal. */
export const STAALHAL_LEVEL = { peil: "peil", goot: "goot", nok: "nok", fundering: "fundering" } as const;

/** Vaste id's; de app beeldt ze bij het toepassen af op de gevallen van het project. */
export const STAALHAL_GEVAL = { permanent: 1, sneeuw: 2, windDwars: 3, windLangs: 4, eigenGewicht: 5, dakgebruik: 6 } as const;

const HANDMATIGE_GEVALLEN: readonly LoadCase[] = [
  { id: STAALHAL_GEVAL.permanent, name: "Permanent (G)", type: "dead" },
  { id: STAALHAL_GEVAL.sneeuw, name: "Sneeuw (S)", type: "snow" },
  { id: STAALHAL_GEVAL.windDwars, name: "Wind dwars (W)", type: "wind" },
  { id: STAALHAL_GEVAL.windLangs, name: "Wind langs (W)", type: "wind" },
];
const EIGEN_GEWICHT_GEVAL: LoadCase = {
  id: STAALHAL_GEVAL.eigenGewicht, name: "Eigen gewicht", type: "dead", eigenGewicht: true,
};
const DAKGEBRUIK_GEVAL: LoadCase = {
  id: STAALHAL_GEVAL.dakgebruik, name: "Dakgebruik (Q)", type: "live", categorie: "H",
};

// ── Fouten ──────────────────────────────────────────────────────────────────

export type StaalhalFoutcode =
  | "onbekendVeld" | "geenObject" | "geenGetal" | "geenGeheelGetal" | "geenTekst" | "geenJaNee"
  | "ongeldigeKeuze" | "buitenBereik" | "spantafstandEnAantal" | "nokEnHelling" | "nokTeLaag"
  | "teVeelVakken" | "teVeelGordingvelden" | "profielOnbekend" | "geenStaal" | "geen3dDoorsnede"
  | "geenBeton" | "verbandVak" | "instabielLangs" | "teVeelPalen"
  | "verloopOngeldig" | "verloopNietBijGroep" | "verloopZonderMidden";

export interface StaalhalProbleem {
  code: StaalhalFoutcode;
  /** Pad van het veld, bijvoorbeeld `profielen.kolom.profiel`. */
  veld: string;
  /** Nederlandse melding voor API-clients; de wizard vertaalt `code` met `waarden`. */
  melding: string;
  waarden?: Record<string, string | number>;
}

export class StaalhalFout extends Error {
  constructor(readonly problemen: StaalhalProbleem[]) {
    super(problemen.map((p) => p.melding).join(" "));
    this.name = "StaalhalFout";
  }
}

type Problemen = StaalhalProbleem[];

const fmt = (waarde: number) => (Math.round(waarde * 1000) / 1000).toString().replace(".", ",");

function probleem(lijst: Problemen, code: StaalhalFoutcode, veld: string, melding: string,
  waarden?: Record<string, string | number>) {
  lijst.push({ code, veld, melding, ...(waarden ? { waarden } : {}) });
}

// ── Invoer lezen ────────────────────────────────────────────────────────────

function isObject(waarde: unknown): waarde is Record<string, unknown> {
  return typeof waarde === "object" && waarde !== null && !Array.isArray(waarde);
}

/** Object met een vaste veldenlijst; onbekende velden worden gemeld, niet genegeerd. */
function leesObject(waarde: unknown, veld: string, velden: readonly string[], p: Problemen): Record<string, unknown> {
  if (waarde === undefined) return {};
  if (!isObject(waarde)) {
    probleem(p, "geenObject", veld || "invoer", veld ? `\`${veld}\` moet een object zijn.` : "De invoer van de hal moet een object zijn.");
    return {};
  }
  for (const sleutel of Object.keys(waarde)) {
    if (!velden.includes(sleutel)) {
      const pad = veld ? `${veld}.${sleutel}` : sleutel;
      probleem(p, "onbekendVeld", pad,
        `Onbekend veld \`${pad}\`; bekend zijn: ${velden.join(", ")}. Een genegeerd veld zou een hal opleveren die bij andere invoer hoort.`,
        { velden: velden.join(", ") });
    }
  }
  return waarde;
}

interface GetalRegels { min?: number; minExclusief?: boolean; max?: number; geheel?: boolean }

function leesGetal(obj: Record<string, unknown>, sleutel: string, veld: string, standaard: number,
  regels: GetalRegels, p: Problemen): number {
  const waarde = obj[sleutel];
  if (waarde === undefined) return standaard;
  if (typeof waarde !== "number" || !Number.isFinite(waarde)) {
    probleem(p, "geenGetal", veld, `\`${veld}\` moet een eindig getal zijn.`);
    return standaard;
  }
  if (regels.geheel && !Number.isInteger(waarde)) {
    probleem(p, "geenGeheelGetal", veld, `\`${veld}\` moet een geheel getal zijn.`);
    return standaard;
  }
  const { min, max, minExclusief } = regels;
  const teLaag = min !== undefined && (minExclusief ? waarde <= min : waarde < min);
  const teHoog = max !== undefined && waarde > max;
  if (teLaag || teHoog) {
    const ondergrens = min === undefined ? "" : minExclusief ? `groter dan ${fmt(min)}` : `minstens ${fmt(min)}`;
    const bovengrens = max === undefined ? "" : `hoogstens ${fmt(max)}`;
    probleem(p, "buitenBereik", veld,
      `\`${veld}\` = ${fmt(waarde)} ligt buiten het bereik: ${[ondergrens, bovengrens].filter(Boolean).join(" en ")}.`,
      { waarde, min: min ?? "", max: max ?? "" });
    return standaard;
  }
  return waarde;
}

function leesKeuze<T extends string>(obj: Record<string, unknown>, sleutel: string, veld: string,
  toegestaan: readonly T[], standaard: T, p: Problemen): T {
  const waarde = obj[sleutel];
  if (waarde === undefined) return standaard;
  if (typeof waarde !== "string" || !toegestaan.includes(waarde as T)) {
    probleem(p, "ongeldigeKeuze", veld,
      `\`${veld}\` moet een van ${toegestaan.map((t) => `"${t}"`).join(", ")} zijn, niet ${JSON.stringify(waarde)}.`,
      { toegestaan: toegestaan.join(", ") });
    return standaard;
  }
  return waarde as T;
}

function leesJaNee(obj: Record<string, unknown>, sleutel: string, veld: string, standaard: boolean, p: Problemen): boolean {
  const waarde = obj[sleutel];
  if (waarde === undefined) return standaard;
  if (typeof waarde !== "boolean") {
    probleem(p, "geenJaNee", veld, `\`${veld}\` moet true of false zijn.`);
    return standaard;
  }
  return waarde;
}

function leesTekst(obj: Record<string, unknown>, sleutel: string, veld: string, standaard: string, p: Problemen): string {
  const waarde = obj[sleutel];
  if (waarde === undefined) return standaard;
  if (typeof waarde !== "string") {
    probleem(p, "geenTekst", veld, `\`${veld}\` moet tekst zijn.`);
    return standaard;
  }
  return waarde.trim();
}

/**
 * Ruwe invoer (JSON van de API, of de toestand van de wizard) → volledige
 * parameters. Ontbrekende velden krijgen de standaardwaarde, onbekende velden
 * en verkeerde typen worden GEWEIGERD. Semantische controles (profielen,
 * stabiliteit, aantallen) doet `maakStaalhal`.
 */
export function leesStaalhalInvoer(invoer: unknown = {}): StaalhalParameters {
  const p: Problemen = [];
  const s = STAALHAL_STANDAARD;
  const raw = leesObject(invoer, "", STAALHAL_VELDEN, p);

  const lengteMm = leesGetal(raw, "lengteMm", "lengteMm", s.lengteMm, { min: 0, minExclusief: true, max: STAALHAL_GRENZEN.maxMaatMm }, p);
  const breedteMm = leesGetal(raw, "breedteMm", "breedteMm", s.breedteMm, { min: 0, minExclusief: true, max: STAALHAL_GRENZEN.maxMaatMm }, p);
  const aantalOverspanningen = leesGetal(raw, "aantalOverspanningen", "aantalOverspanningen", s.aantalOverspanningen,
    { min: 1, max: STAALHAL_GRENZEN.maxOverspanningen, geheel: true }, p);
  const goothoogteMm = leesGetal(raw, "goothoogteMm", "goothoogteMm", s.goothoogteMm, { min: 0, minExclusief: true, max: STAALHAL_GRENZEN.maxHoogteMm }, p);

  let aantalVakken = s.aantalVakken;
  if (raw.aantalVakken !== undefined && raw.spantafstandMm !== undefined) {
    probleem(p, "spantafstandEnAantal", "aantalVakken",
      "Geef `spantafstandMm` of `aantalVakken`, niet allebei: welke van de twee zou gelden is dan niet af te lezen.");
  } else if (raw.aantalVakken !== undefined) {
    aantalVakken = leesGetal(raw, "aantalVakken", "aantalVakken", s.aantalVakken, { min: 1, max: STAALHAL_GRENZEN.maxVakken, geheel: true }, p);
  } else {
    const spantafstandMm = leesGetal(raw, "spantafstandMm", "spantafstandMm", STAALHAL_STANDAARD_SPANTAFSTAND_MM,
      { min: 0, minExclusief: true, max: STAALHAL_GRENZEN.maxMaatMm }, p);
    aantalVakken = Math.max(1, Math.ceil(lengteMm / spantafstandMm - 1e-9));
    if (aantalVakken > STAALHAL_GRENZEN.maxVakken) {
      probleem(p, "teVeelVakken", "spantafstandMm",
        `Met een spantafstand van ${fmt(spantafstandMm)} mm krijgt de hal ${aantalVakken} vakken; hoogstens ${STAALHAL_GRENZEN.maxVakken} zijn toegestaan.`,
        { aantal: aantalVakken, max: STAALHAL_GRENZEN.maxVakken });
      aantalVakken = STAALHAL_GRENZEN.maxVakken;
    }
  }

  const dakRaw = leesObject(raw.dak, "dak", STAALHAL_DAK_VELDEN, p);
  const daktype = leesKeuze(dakRaw, "type", "dak.type", ["zadeldak", "lessenaarsdak", "platdak"] as const, s.dak.type, p);
  let nokhoogteMm = goothoogteMm;
  if (daktype !== "platdak") {
    const helpBreedte = daktype === "zadeldak" ? breedteMm / 2 : breedteMm;
    if (dakRaw.nokhoogteMm !== undefined && dakRaw.hellingGraden !== undefined) {
      probleem(p, "nokEnHelling", "dak",
        "Geef `dak.nokhoogteMm` of `dak.hellingGraden`, niet allebei.");
    } else if (dakRaw.hellingGraden !== undefined) {
      const graden = leesGetal(dakRaw, "hellingGraden", "dak.hellingGraden", 0,
        { min: 0, minExclusief: true, max: STAALHAL_GRENZEN.maxHellingGraden }, p);
      nokhoogteMm = goothoogteMm + Math.tan(graden * Math.PI / 180) * helpBreedte;
    } else {
      nokhoogteMm = leesGetal(dakRaw, "nokhoogteMm", "dak.nokhoogteMm",
        goothoogteMm + STANDAARD_HELLING * helpBreedte, { min: 0, minExclusief: true, max: STAALHAL_GRENZEN.maxHoogteMm }, p);
      if (!(nokhoogteMm > goothoogteMm)) {
        probleem(p, "nokTeLaag", "dak.nokhoogteMm",
          `De ${daktype === "zadeldak" ? "nokhoogte" : "hoogte aan de hoge zijde"} (${fmt(nokhoogteMm)} mm) moet boven de goothoogte (${fmt(goothoogteMm)} mm) liggen; kies anders een plat dak.`,
          { nok: nokhoogteMm, goot: goothoogteMm });
      }
    }
  } else if ((dakRaw.nokhoogteMm !== undefined && dakRaw.nokhoogteMm !== goothoogteMm)
    || (dakRaw.hellingGraden !== undefined && dakRaw.hellingGraden !== 0)) {
    // Een plat dak heeft geen nok; een opgegeven waarde wordt geweigerd in
    // plaats van stil genegeerd. De genormaliseerde vorm (nok = goot) mag wel,
    // zodat `leesStaalhalInvoer` zijn eigen uitvoer weer leest.
    probleem(p, "ongeldigeKeuze", "dak",
      "Een plat dak heeft geen nokhoogte of helling; laat `dak.nokhoogteMm` en `dak.hellingGraden` weg of kies een ander daktype.",
      { toegestaan: "type" });
  }

  const gordingafstandMm = leesGetal(raw, "gordingafstandMm", "gordingafstandMm", s.gordingafstandMm,
    { min: 0, minExclusief: true, max: STAALHAL_GRENZEN.maxMaatMm }, p);

  const profielenRaw = leesObject(raw.profielen, "profielen", STAALHAL_PROFIEL_GROEPEN, p);
  const profielen = {} as Record<StaalhalProfielGroep, StaalhalProfiel>;
  for (const groep of STAALHAL_PROFIEL_GROEPEN) {
    const groepRaw = leesObject(profielenRaw[groep], `profielen.${groep}`, STAALHAL_PROFIEL_VELDEN, p);
    const profielEind = leesTekst(groepRaw, "profielEind", `profielen.${groep}.profielEind`, "", p);
    profielen[groep] = {
      profiel: leesTekst(groepRaw, "profiel", `profielen.${groep}.profiel`, s.profielen[groep].profiel, p),
      materiaal: leesTekst(groepRaw, "materiaal", `profielen.${groep}.materiaal`, s.profielen[groep].materiaal, p),
      ...(profielEind ? { profielEind } : {}),
    };
  }

  const kolomvoet = leesKeuze(raw, "kolomvoet", "kolomvoet", ["ingeklemd", "scharnierend"] as const, s.kolomvoet, p);

  const verbandRaw = leesObject(raw.verbanden, "verbanden", STAALHAL_VERBAND_VELDEN, p);
  let vakken: StaalhalVerbandVakken = s.verbanden.vakken;
  if (verbandRaw.vakken !== undefined) {
    const v = verbandRaw.vakken;
    if (v === "kopvakken" || v === "alle" || v === "geen") vakken = v;
    else if (Array.isArray(v) && v.every((n) => Number.isInteger(n))) vakken = [...new Set(v as number[])].sort((a, b) => a - b);
    else {
      probleem(p, "ongeldigeKeuze", "verbanden.vakken",
        '`verbanden.vakken` moet "kopvakken", "alle", "geen" of een lijst vaknummers (1 = eerste vak) zijn.',
        { toegestaan: "kopvakken, alle, geen, [1, …]" });
    }
  }
  const verbanden = {
    vakken,
    dak: leesJaNee(verbandRaw, "dak", "verbanden.dak", s.verbanden.dak, p),
    wanden: leesJaNee(verbandRaw, "wanden", "verbanden.wanden", s.verbanden.wanden, p),
    kopgevels: leesJaNee(verbandRaw, "kopgevels", "verbanden.kopgevels", s.verbanden.kopgevels, p),
    trekAlleen: leesJaNee(verbandRaw, "trekAlleen", "verbanden.trekAlleen", s.verbanden.trekAlleen, p),
  };

  const fRaw = leesObject(raw.fundering, "fundering", STAALHAL_FUNDERING_VELDEN, p);
  const f = s.fundering;
  const fundering: StaalhalParameters["fundering"] = {
    type: leesKeuze(fRaw, "type", "fundering.type", ["opleggingen", "balkrooster"] as const, f.type, p),
    balkBreedteMm: leesGetal(fRaw, "balkBreedteMm", "fundering.balkBreedteMm", f.balkBreedteMm, { min: 0, minExclusief: true, max: 5_000 }, p),
    balkHoogteMm: leesGetal(fRaw, "balkHoogteMm", "fundering.balkHoogteMm", f.balkHoogteMm, { min: 0, minExclusief: true, max: 5_000 }, p),
    betonklasse: leesTekst(fRaw, "betonklasse", "fundering.betonklasse", f.betonklasse, p),
    dwarsbalken: leesKeuze(fRaw, "dwarsbalken", "fundering.dwarsbalken", ["elkSpant", "kopspanten"] as const, f.dwarsbalken, p),
    diepteMm: leesGetal(fRaw, "diepteMm", "fundering.diepteMm", f.diepteMm, { min: 0, max: 20_000 }, p),
    paalKzKnPerMm: leesGetal(fRaw, "paalKzKnPerMm", "fundering.paalKzKnPerMm", f.paalKzKnPerMm, { min: 0, minExclusief: true, max: 1e6 }, p),
    paalHorizontaal: leesKeuze(fRaw, "paalHorizontaal", "fundering.paalHorizontaal", ["veren", "statischBepaald"] as const, f.paalHorizontaal, p),
    paalKhKnPerMm: leesGetal(fRaw, "paalKhKnPerMm", "fundering.paalKhKnPerMm", f.paalKhKnPerMm, { min: 0, minExclusief: true, max: 1e6 }, p),
    paalAfstandMm: leesGetal(fRaw, "paalAfstandMm", "fundering.paalAfstandMm", f.paalAfstandMm, { min: 500, max: STAALHAL_GRENZEN.maxMaatMm }, p),
  };

  const lRaw = leesObject(raw.lasten, "lasten", STAALHAL_LASTEN_VELDEN, p);
  const wRaw = leesObject(lRaw.wind, "lasten.wind", STAALHAL_WIND_VELDEN, p);
  const w = s.lasten.wind;
  const lasten: StaalhalParameters["lasten"] = {
    dakafwerkingKnM2: leesGetal(lRaw, "dakafwerkingKnM2", "lasten.dakafwerkingKnM2", s.lasten.dakafwerkingKnM2, { min: 0, max: 100 }, p),
    sneeuwKnM2: leesGetal(lRaw, "sneeuwKnM2", "lasten.sneeuwKnM2", s.lasten.sneeuwKnM2, { min: 0, max: 100 }, p),
    dakgebruikKnM2: leesGetal(lRaw, "dakgebruikKnM2", "lasten.dakgebruikKnM2", s.lasten.dakgebruikKnM2, { min: 0, max: 100 }, p),
    wind: {
      bron: leesKeuze(wRaw, "bron", "lasten.wind.bron", ["handmatig", "stuwdruk"] as const, w.bron, p),
      drukKnM2: leesGetal(wRaw, "drukKnM2", "lasten.wind.drukKnM2", w.drukKnM2, { min: 0, max: 100 }, p),
      zuigingKnM2: leesGetal(wRaw, "zuigingKnM2", "lasten.wind.zuigingKnM2", w.zuigingKnM2, { min: 0, max: 100 }, p),
      dakZuigingKnM2: leesGetal(wRaw, "dakZuigingKnM2", "lasten.wind.dakZuigingKnM2", w.dakZuigingKnM2, { min: 0, max: 100 }, p),
      windgebied: leesKeuze(wRaw, "windgebied", "lasten.wind.windgebied", Object.keys(WINDGEBIEDEN) as Windgebied[], w.windgebied, p),
      terreincategorie: leesKeuze(wRaw, "terreincategorie", "lasten.wind.terreincategorie",
        Object.keys(TERREIN_CATEGORIEEN) as TerreinCategorie[], w.terreincategorie, p),
      cDak: leesGetal(wRaw, "cDak", "lasten.wind.cDak", w.cDak, { min: 0, max: 5 }, p),
    },
  };

  const eigenGewicht = leesJaNee(raw, "eigenGewicht", "eigenGewicht", s.eigenGewicht, p);
  const projectnaam = leesTekst(raw, "projectnaam", "projectnaam", s.projectnaam, p);

  if (p.length > 0) throw new StaalhalFout(p);
  return {
    lengteMm, breedteMm, aantalOverspanningen, aantalVakken, goothoogteMm,
    dak: { type: daktype, nokhoogteMm }, gordingafstandMm,
    profielen, kolomvoet, verbanden, fundering, lasten, eigenGewicht, projectnaam,
  };
}

// ── Afgeleide maten ─────────────────────────────────────────────────────────

export interface StaalhalMaten {
  lengteMm: number;
  breedteMm: number;
  aantalOverspanningen: number;
  overspanningMm: number;
  aantalVakken: number;
  aantalSpanten: number;
  /** Werkelijke h.o.h.-afstand van de spanten. */
  spantafstandMm: number;
  goothoogteMm: number;
  nokhoogteMm: number;
  hellingGraden: number;
  aantalGordingvelden: number;
  /** Werkelijke (horizontale) gordingafstand. */
  gordingafstandMm: number;
  /** Vakken met verbanden, 1 = eerste vak. */
  verbandvakken: number[];
}

function aantalGordingvelden(p: StaalhalParameters): number {
  const minimum = p.dak.type === "zadeldak"
    ? 2 * Math.max(1, Math.ceil(p.breedteMm / 2 / p.gordingafstandMm - 1e-9))
    : Math.max(1, Math.ceil(p.breedteMm / p.gordingafstandMm - 1e-9));
  // Elke binnenkolom moet op een dakknoop liggen; bij een zadeldak de nok ook.
  const stap = p.dak.type === "zadeldak" && p.aantalOverspanningen % 2 !== 0
    ? 2 * p.aantalOverspanningen : p.aantalOverspanningen;
  return Math.ceil(minimum / stap) * stap;
}

function verbandvakken(p: StaalhalParameters): number[] {
  const n = p.aantalVakken;
  const v = p.verbanden.vakken;
  if (v === "geen") return [];
  if (v === "alle") return Array.from({ length: n }, (_, i) => i + 1);
  if (v === "kopvakken") return [...new Set([1, n])];
  return v;
}

/** De maten die volgen uit de parameters, zonder het model te bouwen. */
export function staalhalMaten(p: StaalhalParameters): StaalhalMaten {
  const helpBreedte = p.dak.type === "zadeldak" ? p.breedteMm / 2 : p.breedteMm;
  const velden = aantalGordingvelden(p);
  return {
    lengteMm: p.lengteMm,
    breedteMm: p.breedteMm,
    aantalOverspanningen: p.aantalOverspanningen,
    overspanningMm: p.breedteMm / p.aantalOverspanningen,
    aantalVakken: p.aantalVakken,
    aantalSpanten: p.aantalVakken + 1,
    spantafstandMm: p.lengteMm / p.aantalVakken,
    goothoogteMm: p.goothoogteMm,
    nokhoogteMm: p.dak.nokhoogteMm,
    hellingGraden: Math.atan((p.dak.nokhoogteMm - p.goothoogteMm) / helpBreedte) * 180 / Math.PI,
    aantalGordingvelden: velden,
    gordingafstandMm: p.breedteMm / velden,
    verbandvakken: verbandvakken(p),
  };
}

// ── Semantische controle ────────────────────────────────────────────────────

function controleer(p: StaalhalParameters, maten: StaalhalMaten): Problemen {
  const problemen: Problemen = [];
  if (maten.aantalGordingvelden > STAALHAL_GRENZEN.maxGordingvelden) {
    probleem(problemen, "teVeelGordingvelden", "gordingafstandMm",
      `Met een gordingafstand van ${fmt(p.gordingafstandMm)} mm krijgt het dak ${maten.aantalGordingvelden} gordingvelden; hoogstens ${STAALHAL_GRENZEN.maxGordingvelden} zijn toegestaan.`,
      { aantal: maten.aantalGordingvelden, max: STAALHAL_GRENZEN.maxGordingvelden });
  }
  for (const groep of STAALHAL_PROFIEL_GROEPEN) {
    const { profiel, materiaal } = p.profielen[groep];
    const veld = `profielen.${groep}`;
    const hout = matchSupportedTimberGrade(materiaal) !== null;
    if (!STEEL_GRADES.includes(materiaal) && !hout) {
      probleem(problemen, "geenStaal", `${veld}.materiaal`,
        `${groep}: "${materiaal}" is geen ondersteunde staal- of houtsterkteklasse.`,
        { groep, materiaal, toegestaan: `${STEEL_GRADES.join(", ")}, C14–C35, GL24h–GL36h` });
      continue;
    }
    const opgelost = resolveSection(materiaal, profiel);
    if (opgelost.bron === "default") {
      probleem(problemen, "profielOnbekend", `${veld}.profiel`,
        `${groep}: profiel "${profiel}" is onbekend (${opgelost.reden ?? "doorsnede niet te bepalen"}).`,
        { groep, profiel });
      continue;
    }
    if (hout ? !parseTimberRectMm(profiel) : !STEEL_SECTION_DIMS[profileLookupKey(profiel)]?.props) {
      probleem(problemen, "geen3dDoorsnede", `${veld}.profiel`,
        hout
          ? `${groep}: houtprofiel "${profiel}" is geen rechthoek b×h in mm.`
          : `${groep}: profiel "${profiel}" mist I_z en I_t voor een ruimtelijke berekening; kies een catalogusprofiel.`,
        { groep, profiel });
      continue;
    }
    // Verlopend profiel (#73): dezelfde keuring als elke verlopende staaf.
    const profielEind = p.profielen[groep].profielEind;
    if (profielEind === undefined) continue;
    const verloop = bepaalVerloop(materiaal, profiel, profielEind);
    if (verloop.status === "fout") {
      probleem(problemen, "verloopOngeldig", `${veld}.profielEind`,
        `${groep}: eindprofiel "${profielEind}" past niet bij "${profiel}": ${verloop.reden}.`,
        { groep, profiel, profielEind, reden: verloop.reden });
    } else if (verloop.status === "verlopend" && !STAALHAL_VERLOOP_GROEPEN.includes(groep)) {
      probleem(problemen, "verloopNietBijGroep", `${veld}.profielEind`,
        `${groep}: een verlopend profiel kan alleen bij de kolommen (voet → kop) en de spantliggers (goot → midden); laat het eindprofiel weg.`,
        { groep });
    } else if (verloop.status === "verlopend" && groep === "spantligger" && maten.aantalGordingvelden % 2 !== 0) {
      probleem(problemen, "verloopZonderMidden", `${veld}.profielEind`,
        `spantligger: een verlopende spantligger loopt van de goot naar het midden van de overspanning, en daar ligt bij ${maten.aantalGordingvelden} gordingvelden geen dakknoop. Kies een gordingafstand met een even aantal velden.`,
        { groep, aantal: maten.aantalGordingvelden });
    }
  }
  for (const vak of maten.verbandvakken) {
    if (vak < 1 || vak > p.aantalVakken) {
      probleem(problemen, "verbandVak", "verbanden.vakken",
        `Verbandvak ${vak} bestaat niet; de hal heeft vak 1 t/m ${p.aantalVakken}.`,
        { vak, max: p.aantalVakken });
    }
  }
  const wandverband = p.verbanden.wanden && maten.verbandvakken.length > 0;
  if (p.kolomvoet === "scharnierend" && !wandverband) {
    probleem(problemen, "instabielLangs", "verbanden",
      "Met scharnierende kolomvoeten en zonder wandverband is de hal in langsrichting een mechanisme. Zet wandverbanden aan of klem de kolommen in.");
  }
  if (p.fundering.type === "balkrooster") {
    if (!(p.fundering.betonklasse in CONCRETE_E_CM)) {
      probleem(problemen, "geenBeton", "fundering.betonklasse",
        `"${p.fundering.betonklasse}" is geen betonklasse; kies uit ${Object.keys(CONCRETE_E_CM).join(", ")}.`,
        { materiaal: p.fundering.betonklasse, toegestaan: Object.keys(CONCRETE_E_CM).join(", ") });
    }
    const palen = roosterIndeling(p, maten).palen;
    if (palen > STAALHAL_GRENZEN.maxPalen) {
      probleem(problemen, "teVeelPalen", "fundering.paalAfstandMm",
        `Met een paalafstand van ${fmt(p.fundering.paalAfstandMm)} mm krijgt het rooster ${palen} palen; hoogstens ${STAALHAL_GRENZEN.maxPalen} zijn toegestaan.`,
        { aantal: palen, max: STAALHAL_GRENZEN.maxPalen });
    }
  }
  return problemen;
}

/** Tussenposities (fracties) van de palen langs een balk met lengte `lengteMm`. */
function paalFracties(lengteMm: number, afstandMm: number): number[] {
  const tussen = Math.max(0, Math.ceil(lengteMm / afstandMm - 1e-9) - 1);
  return Array.from({ length: tussen }, (_, k) => (k + 1) / (tussen + 1));
}

function roosterIndeling(p: StaalhalParameters, maten: StaalhalMaten) {
  const langsTussen = paalFracties(maten.spantafstandMm, p.fundering.paalAfstandMm).length;
  const dwarsTussen = paalFracties(maten.overspanningMm, p.fundering.paalAfstandMm).length;
  const dwarsbalken = p.fundering.dwarsbalken === "elkSpant" ? maten.aantalSpanten : Math.min(2, maten.aantalSpanten);
  const palen = (p.aantalOverspanningen + 1) * (maten.aantalSpanten + p.aantalVakken * langsTussen)
    + dwarsbalken * p.aantalOverspanningen * dwarsTussen;
  return { langsTussen, dwarsTussen, dwarsbalken, palen };
}

// ── Het model ───────────────────────────────────────────────────────────────

export type StaalhalStaafGroep =
  | "kolom" | "spantligger" | "gording" | "randligger" | "dakverband" | "wandverband" | "kopgevelverband" | "funderingsbalk" | "poer";

export interface StaalhalSamenvatting {
  maten: StaalhalMaten;
  aantallen: {
    knopen: number; staven: number; opleggingen: number; palen: number;
    knoopbelastingen: number; staafbelastingen: number;
  };
  /** Staafnummers per rol, voor groepsgewijze uitkomsten (UC per groep). */
  groepen: Record<StaalhalStaafGroep, number[]>;
  /** Knoopnummers van de palen (leeg zonder balkrooster). */
  paalknopen: number[];
  /** De lasten zoals ze in het model staan, in kN/m². */
  lasten: {
    dakafwerkingKnM2: number;
    sneeuwKnM2: number;
    dakgebruikKnM2: number;
    windDwarsDrukKnM2: number;
    windDwarsZuigingKnM2: number;
    windLangsDrukKnM2: number;
    dakZuigingKnM2: number;
    /** Alleen bij `bron: "stuwdruk"`: q_p en de gebruikte vormfactoren. */
    stuwdruk?: {
      qpKnM2: number; zeM: number;
      cpeDwarsD: number; cpeDwarsE: number; cpeLangsD: number; cDak: number;
      afleiding: { symbool: string; waarde: string; bron: string }[];
    };
  };
  /** Σ opgegeven lasten per belastinggeval (zonder eigen gewicht), kN, globale assen. */
  belastingsom: Record<number, { fx: number; fy: number; fz: number }>;
  /** Σ ρ·A·g·L per materiaalsoort, kN (naar beneden). */
  eigenGewichtKn: { staal: number; hout: number; beton: number };
}

export interface StaalhalResultaat {
  parameters: StaalhalParameters;
  model: OpenFem3DModel;
  /**
   * De eigen gelaste tussendoorsneden van een verlopende spantligger (#73),
   * waar de staven met `EIGEN:<naam>` naar verwijzen; leeg zonder verloop. De
   * generator bewaart ze niet zelf (hij is puur): wie de hal toepast of
   * doorrekent, zet ze in de winkel, en het projectbestand draagt ze mee.
   */
  eigenDoorsneden: EigenDoorsnede[];
  /**
   * Stramien van de hal (mm): assen 1…n op de spanten, A… op de
   * kolomlijnen, en de levels peil 0, goot, nok (niet bij een plat dak) en —
   * bij een balkrooster dieper dan peil — de systeemlijn van de fundering.
   * De level-id's liggen vast (`STAALHAL_LEVEL`).
   */
  stramien: StructuralGrid;
  loadCases: LoadCase[];
  selfWeightEnabled: boolean;
  samenvatting: StaalhalSamenvatting;
  /** Aandachtspunten die de hal niet tegenhouden (bijv. een aangepaste spantafstand). */
  waarschuwingen: string[];
}

const SCHARNIEREN = { myStart: true, myEnd: true, mzStart: true, mzEnd: true };

/** Wind uit de parameters: handmatig, of q_p · c_pe volgens NEN-EN 1991-1-4. */
function windlasten(p: StaalhalParameters): StaalhalSamenvatting["lasten"] {
  const w = p.lasten.wind;
  const basis = { dakafwerkingKnM2: p.lasten.dakafwerkingKnM2,
    sneeuwKnM2: p.lasten.sneeuwKnM2, dakgebruikKnM2: p.lasten.dakgebruikKnM2 };
  if (w.bron === "handmatig") {
    return {
      ...basis,
      windDwarsDrukKnM2: w.drukKnM2,
      windDwarsZuigingKnM2: w.zuigingKnM2,
      windLangsDrukKnM2: w.drukKnM2,
      dakZuigingKnM2: w.dakZuigingKnM2,
    };
  }
  const hoogteM = p.dak.nokhoogteMm / 1000;
  const stuwdruk = calculateWindReferencePressure({ codeId: NEDERLANDSE_WINDROUTE,
    source: "calculated", windgebied: w.windgebied, terreincategorie: w.terreincategorie }, hoogteM);
  const qp = stuwdruk.qp_kNm2;
  const dwars = cpeWand(p.dak.nokhoogteMm / p.breedteMm);
  const langs = cpeWand(p.dak.nokhoogteMm / p.lengteMm);
  return {
    ...basis,
    windDwarsDrukKnM2: dwars.D * qp,
    windDwarsZuigingKnM2: -dwars.E * qp,
    windLangsDrukKnM2: langs.D * qp,
    dakZuigingKnM2: w.cDak * qp,
    stuwdruk: {
      qpKnM2: qp, zeM: hoogteM,
      cpeDwarsD: dwars.D, cpeDwarsE: dwars.E, cpeLangsD: langs.D, cDak: w.cDak,
      afleiding: stuwdruk.afleiding,
    },
  };
}

/**
 * Bouw de hal. Gooit `StaalhalFout` bij invoer die niet deugt; `invoer` mag
 * ruwe JSON zijn (die gaat eerst door `leesStaalhalInvoer`).
 */
export function maakStaalhal(invoer: unknown = {}): StaalhalResultaat {
  const p = leesStaalhalInvoer(invoer);
  const maten = staalhalMaten(p);
  const problemen = controleer(p, maten);
  if (problemen.length > 0) throw new StaalhalFout(problemen);

  const waarschuwingen: string[] = [];
  const lengte = p.lengteMm / 1000;
  const breedte = p.breedteMm / 1000;
  const nOverspanningen = p.aantalOverspanningen;
  const overspanning = breedte / nOverspanningen;
  const goothoogte = p.goothoogteMm / 1000;
  const nokhoogte = p.dak.nokhoogteMm / 1000;
  const nVak = p.aantalVakken;
  const nSpant = nVak + 1;
  const spantafstand = lengte / nVak;
  const velden = maten.aantalGordingvelden;
  const nDak = velden + 1;
  const gordingafstand = breedte / velden;
  const helling = p.dak.type === "zadeldak"
    ? (nokhoogte - goothoogte) / (breedte / 2)
    : p.dak.type === "lessenaarsdak" ? (nokhoogte - goothoogte) / breedte : 0;
  const dakZ = (y: number) => {
    const stijging = p.dak.type === "zadeldak" ? Math.min(y, breedte - y) : p.dak.type === "lessenaarsdak" ? y : 0;
    return Math.round((goothoogte + helling * stijging) * 1e9) / 1e9;
  };
  const lasten = windlasten(p);
  if (maten.hellingGraden > 10 + 1e-9 && (lasten.dakafwerkingKnM2 > 0 || lasten.sneeuwKnM2 > 0 || lasten.dakgebruikKnM2 > 0)) {
    waarschuwingen.push(
      `De daklasten staan per m² horizontale projectie. Bij een helling van ${fmt(maten.hellingGraden)}° is een last ` +
      `per m² dakvlak ${fmt(1 / Math.cos(maten.hellingGraden * Math.PI / 180))} × zo groot; reken de dakafwerking zo nodig om.`);
  }
  if (p.fundering.type === "balkrooster" && p.fundering.paalHorizontaal === "statischBepaald") {
    waarschuwingen.push(
      "Horizontaal steunt het rooster op twee palen (u_x en u_y in de eerste, u_y in de laatste paal van de kolomlijn y = 0). " +
      "Alle horizontale belasting loopt dan in het vlak door de funderingsbalken naar die palen; controleer de horizontale verplaatsingen.");
  }
  if (lasten.stuwdruk && lasten.stuwdruk.zeM > CSCD_GRENSHOOGTE_M) {
    waarschuwingen.push(
      `De hal is hoger dan ${CSCD_GRENSHOOGTE_M} m; c_s·c_d = 1,0 (${CSCD_BRON}) geldt dan niet zonder meer.`);
  }

  const nodes: OpenFem3DModel["nodes"] = [];
  const beams: OpenFem3DBeam[] = [];
  const supports: OpenFem3DSupport[] = [];
  const loads: OpenFem3DNodalLoad[] = [];
  const memberLoads: OpenFem3DMemberLoad[] = [];
  const knoop = new Map<string, number>();
  const zet = (sleutel: string, x: number, y: number, z: number) => {
    nodes.push({ id: nodes.length + 1, x, y, z });
    knoop.set(sleutel, nodes.length);
    return nodes.length;
  };
  const groepen: Record<StaalhalStaafGroep, number[]> = {
    kolom: [], spantligger: [], gording: [], randligger: [], dakverband: [], wandverband: [], kopgevelverband: [], funderingsbalk: [], poer: [],
  };
  const staaf = (groep: StaalhalStaafGroep, a: number, b: number, profileName: string, material: string,
    extra: Partial<OpenFem3DBeam> = {}) => {
    beams.push({ id: beams.length + 1, startNodeId: a, endNodeId: b, profileName, material, ...extra });
    groepen[groep].push(beams.length);
    return beams.length;
  };

  // Knopen: per spant een voet op elke kolomlijn en alle dakknopen.
  for (let i = 0; i < nSpant; i++) {
    const x = i * spantafstand;
    for (let lijn = 0; lijn <= nOverspanningen; lijn++)
      zet(`voet-${i}-${lijn}`, x, lijn * overspanning, 0);
    for (let j = 0; j < nDak; j++) {
      const y = j * gordingafstand;
      zet(`dak-${i}-${j}`, x, y, dakZ(y));
    }
  }
  const k = (sleutel: string) => knoop.get(sleutel)!;
  const opleggingen = p.fundering.type === "opleggingen";
  const voetScharnier = p.kolomvoet === "scharnierend";

  const pr = p.profielen;
  // Verlopende kolom en spantligger (#73); de keuring zit in `controleer`.
  const verloopVan = (groep: StaalhalProfielGroep): VerlopendeDoorsnede | null => {
    const keuze = pr[groep];
    if (keuze.profielEind === undefined) return null;
    const v = bepaalVerloop(keuze.materiaal, keuze.profiel, keuze.profielEind);
    return v.status === "verlopend" ? v.verloop : null;
  };
  const kolomVerloop = verloopVan("kolom");
  const spantVerloop = verloopVan("spantligger");
  const eigenDoorsneden: EigenDoorsnede[] = [];
  /** Het profiel van de spantligger op relatieve plaats t (0 = goot, 1 = midden). */
  const spantProfiel = (t: number): string => {
    if (t <= 1e-12) return pr.spantligger.profiel;
    if (t >= 1 - 1e-12) return pr.spantligger.profielEind!;
    const tussen = tussenProfielVoorSplitsing(pr.spantligger.materiaal, pr.spantligger.profiel, pr.spantligger.profielEind, t, eigenDoorsneden);
    if (!tussen) throw new Error("spantligger: het verloop is verdwenen tijdens het bouwen.");
    if (tussen.bewaren && !eigenDoorsneden.some((d) => d.naam === tussen.bewaren!.naam)) eigenDoorsneden.push(tussen.bewaren);
    return tussen.tussenProfiel;
  };
  /** Per staaf van een verlopende spantligger: het verloop over die staaf, voor het eigen gewicht. */
  const staafVerloop = new Map<number, VerlopendeDoorsnede>();
  const kolommen: { id: number; i: number; lijn: number; dakJ: number }[] = [];
  for (let i = 0; i < nSpant; i++) {
    for (let lijn = 0; lijn <= nOverspanningen; lijn++) {
      const j = lijn * velden / nOverspanningen;
      const id = staaf("kolom", k(`voet-${i}-${lijn}`), k(`dak-${i}-${j}`), pr.kolom.profiel, pr.kolom.materiaal, {
        // Verlopend: van de voet (begin) naar de kop (eind).
        ...(kolomVerloop ? { profileNameEnd: pr.kolom.profielEind } : {}),
        rollAngleRad: Math.PI / 2,
        // Op het balkrooster is een scharnierende voet een eindscharnier van
        // de kolom zelf; op vaste opleggingen is het de oplegging.
        ...(!opleggingen && voetScharnier ? { releases: { myStart: true, mzStart: true } as OpenFem3DBeam["releases"] } : {}),
      });
      kolommen.push({ id, i, lijn, dakJ: j });
      if (opleggingen) {
        supports.push({
          nodeId: k(`voet-${i}-${lijn}`),
          ux: true, uy: true, uz: true, rx: !voetScharnier, ry: !voetScharnier, rz: !voetScharnier,
        });
      }
    }
    for (let j = 0; j + 1 < nDak; j++) {
      if (!spantVerloop) {
        staaf("spantligger", k(`dak-${i}-${j}`), k(`dak-${i}-${j + 1}`), pr.spantligger.profiel, pr.spantligger.materiaal);
        continue;
      }
      // Verlopend: t = afstand tot de dichtstbijzijnde goot / (B/2); de
      // velden zijn even, dus het midden is een dakknoop en geen staaf
      // loopt eroverheen.
      const tVan = (jj: number) => Math.min(jj, velden - jj) / (velden / 2);
      const t0 = tVan(j), t1 = tVan(j + 1);
      const id = staaf("spantligger", k(`dak-${i}-${j}`), k(`dak-${i}-${j + 1}`), spantProfiel(t0), pr.spantligger.materiaal,
        { profileNameEnd: spantProfiel(t1) });
      staafVerloop.set(id, {
        ...spantVerloop, begin: matenOpPositie(spantVerloop, t0), eind: matenOpPositie(spantVerloop, t1),
      });
    }
  }
  const gordingen: { id: number; rand: boolean }[] = [];
  for (let i = 0; i + 1 < nSpant; i++) {
    for (let j = 0; j < nDak; j++) {
      const rand = j === 0 || j === nDak - 1;
      const keuze = rand ? pr.randligger : pr.gording;
      const id = staaf(rand ? "randligger" : "gording", k(`dak-${i}-${j}`), k(`dak-${i + 1}-${j}`), keuze.profiel, keuze.materiaal,
        { releases: { ...SCHARNIEREN } as OpenFem3DBeam["releases"] });
      gordingen.push({ id, rand });
    }
  }
  for (const vak of maten.verbandvakken) {
    const i = vak - 1;
    const verband = (groep: StaalhalStaafGroep, a: string, b: string) =>
      staaf(groep, k(a), k(b), pr.verband.profiel, pr.verband.materiaal, {
        releases: { ...SCHARNIEREN } as OpenFem3DBeam["releases"],
        ...(p.verbanden.trekAlleen ? { tensionOnly: true } : {}),
      });
    if (p.verbanden.dak) {
      for (let j = 0; j + 1 < nDak; j++) {
        verband("dakverband", `dak-${i}-${j}`, `dak-${i + 1}-${j + 1}`);
        verband("dakverband", `dak-${i + 1}-${j}`, `dak-${i}-${j + 1}`);
      }
    }
    if (p.verbanden.wanden) {
      for (const [zijde, j] of [[0, 0], [1, nDak - 1]] as const) {
        verband("wandverband", `voet-${i}-${zijde}`, `dak-${i + 1}-${j}`);
        verband("wandverband", `voet-${i + 1}-${zijde}`, `dak-${i}-${j}`);
      }
    }
  }

  // Optionele kruizen in de twee kopgevelvlakken. De voeten en gootknopen
  // bestaan al in het spant; het kruis draagt via die knopen af naar de
  // opleggingen of het balkrooster. Bij één lengte-vak delen beide gevels
  // geen staven: elk kruis ligt in zijn eigen x-vlak.
  if (p.verbanden.kopgevels) {
    for (const i of [0, nSpant - 1]) {
      for (let span = 0; span < nOverspanningen; span++) {
        const links = span * velden / nOverspanningen;
        const rechts = (span + 1) * velden / nOverspanningen;
        for (const [lijn, andereJ] of [[span, rechts], [span + 1, links]] as const) {
          staaf("kopgevelverband", k(`voet-${i}-${lijn}`), k(`dak-${i}-${andereJ}`),
            pr.verband.profiel, pr.verband.materiaal, {
              releases: { ...SCHARNIEREN } as OpenFem3DBeam["releases"],
              ...(p.verbanden.trekAlleen ? { tensionOnly: true } : {}),
            });
        }
      }
    }
  }

  // ── Balkrooster ──
  const paalknopen: number[] = [];
  if (!opleggingen) {
    const f = p.fundering;
    const diepte = f.diepteMm / 1000;
    const zRooster = diepte === 0 ? 0 : -diepte;
    const balkProfiel = `${fmtMaat(f.balkBreedteMm)}x${fmtMaat(f.balkHoogteMm)}`;
    const beton = f.betonklasse;
    const langsFracties = paalFracties(maten.spantafstandMm, f.paalAfstandMm);
    const dwarsFracties = paalFracties(maten.overspanningMm, f.paalAfstandMm);
    // Roosterknoop onder een kolom: de kolomvoet zelf als het rooster op peil
    // ligt, anders een knoop op de systeemlijn eronder.
    const roosterKnoop = (i: number, lijn: number) => {
      if (diepte === 0) return k(`voet-${i}-${lijn}`);
      const sleutel = `rooster-${i}-${lijn}`;
      return knoop.get(sleutel) ?? zet(sleutel, i * spantafstand, lijn * overspanning, zRooster);
    };
    const langslijnen: number[][] = [];
    for (let lijnIndex = 0; lijnIndex <= nOverspanningen; lijnIndex++) {
      const lijn: number[] = [];
      for (let i = 0; i < nSpant; i++) {
        lijn.push(roosterKnoop(i, lijnIndex));
        if (i + 1 < nSpant) {
          for (const [m, t] of langsFracties.entries()) {
            lijn.push(zet(`langs-${lijnIndex}-${i}-${m}`, (i + t) * spantafstand, lijnIndex * overspanning, zRooster));
          }
        }
      }
      langslijnen.push(lijn);
    }
    const dwarsSpanten = f.dwarsbalken === "elkSpant"
      ? Array.from({ length: nSpant }, (_, i) => i)
      : [...new Set([0, nSpant - 1])];
    const dwarslijnen: number[][] = dwarsSpanten.map((i) => {
      const lijn = [roosterKnoop(i, 0)];
      for (let span = 0; span < nOverspanningen; span++) {
        for (const [m, t] of dwarsFracties.entries())
          lijn.push(zet(`dwars-${i}-${span}-${m}`, i * spantafstand, (span + t) * overspanning, zRooster));
        lijn.push(roosterKnoop(i, span + 1));
      }
      return lijn;
    });
    for (const lijn of [...langslijnen, ...dwarslijnen]) {
      for (let m = 0; m + 1 < lijn.length; m++) staaf("funderingsbalk", lijn[m], lijn[m + 1], balkProfiel, beton);
    }
    if (diepte > 0) {
      for (const kolom of kolommen) {
        // Van de roosterknoop omhoog naar de kolomvoet; lange zijde in het spantvlak (lokale z = +Y).
        staaf("poer", roosterKnoop(kolom.i, kolom.lijn), k(`voet-${kolom.i}-${kolom.lijn}`), balkProfiel, beton,
          { rollAngleRad: Math.PI / 2 });
      }
    }
    // Palen: elke roosterknoop, in de volgorde van de langslijnen en daarna de
    // tussenknopen van de dwarsbalken.
    const volgorde = [...new Set([...langslijnen.flat(), ...dwarslijnen.flatMap((lijn) => lijn.slice(1, -1))])];
    const kz = f.paalKzKnPerMm * 1000, kh = f.paalKhKnPerMm * 1000;
    const vastX = roosterKnoop(0, 0), vastY = roosterKnoop(nSpant - 1, 0);
    for (const nodeId of volgorde) {
      paalknopen.push(nodeId);
      if (f.paalHorizontaal === "veren") {
        supports.push({
          nodeId, ux: false, uy: false, uz: false, rx: false, ry: false, rz: false,
          springs: { kxKnPerM: kh, kyKnPerM: kh, kzKnPerM: kz },
        });
      } else {
        supports.push({
          nodeId, ux: nodeId === vastX, uy: nodeId === vastX || nodeId === vastY, uz: false, rx: false, ry: false, rz: false,
          springs: { kzKnPerM: kz },
        });
      }
    }
  }

  // ── Belastingen ──
  const lijnlast = (beamId: number, caseId: number, qz: number, lengteM: number) => {
    if (qz === 0) return;
    memberLoads.push({
      id: memberLoads.length + 1, beamId, caseId, qyStart: 0, qyEnd: 0, qzStart: qz, qzEnd: qz,
      startPositionM: 0, endPositionM: lengteM,
    });
  };
  // Gordingen: lokale z is omhoog, dus neerwaarts negatief; invloedsbreedte
  // is de gordingafstand, bij de randliggers de helft.
  for (const g of gordingen) {
    const strook = g.rand ? gordingafstand / 2 : gordingafstand;
    lijnlast(g.id, STAALHAL_GEVAL.permanent, -lasten.dakafwerkingKnM2 * strook, spantafstand);
    lijnlast(g.id, STAALHAL_GEVAL.sneeuw, -lasten.sneeuwKnM2 * strook, spantafstand);
    lijnlast(g.id, STAALHAL_GEVAL.dakgebruik, -lasten.dakgebruikKnM2 * strook, spantafstand);
    lijnlast(g.id, STAALHAL_GEVAL.windDwars, lasten.dakZuigingKnM2 * strook, spantafstand);
  }
  // Wind dwars (+Y) op de kolommen: met rolhoek 90° valt lokale z samen met +Y.
  for (const kolom of kolommen) {
    if (kolom.lijn !== 0 && kolom.lijn !== nOverspanningen) continue;
    const strook = kolom.i === 0 || kolom.i === nSpant - 1 ? spantafstand / 2 : spantafstand;
    const top = nodes[k(`dak-${kolom.i}-${kolom.dakJ}`) - 1];
    lijnlast(kolom.id, STAALHAL_GEVAL.windDwars,
      (kolom.lijn === 0 ? lasten.windDwarsDrukKnM2 : lasten.windDwarsZuigingKnM2) * strook, top.z);
  }
  // Wind langs (+X) op de kopgevel: de helft via de gevelstijlen naar de
  // dakrand van het eerste spant, randknopen half.
  const naarDak = lasten.windLangsDrukKnM2 * breedte * ((goothoogte + nokhoogte) / 2) / 2;
  if (naarDak !== 0) {
    for (let j = 0; j < nDak; j++) {
      loads.push({
        id: loads.length + 1, nodeId: k(`dak-0-${j}`), caseId: STAALHAL_GEVAL.windLangs,
        fx: naarDak * (j === 0 || j === nDak - 1 ? 0.5 : 1) / (nDak - 1), fy: 0, fz: 0, mx: 0, my: 0, mz: 0,
      });
    }
  }

  const model = parseOpenFem3DModel({ nodes, beams, supports, loads, memberLoads, memberPointLoads: [],
    ...(p.verbanden.trekAlleen && ((maten.verbandvakken.length > 0 && (p.verbanden.dak || p.verbanden.wanden)) || p.verbanden.kopgevels)
      ? { tensionOnlyCrossRule: true } : {}) });
  const stramien: StructuralGrid = {
    enabled: true,
    xAxes: Array.from({ length: nSpant }, (_, i) => ({ id: `spant-${i + 1}`, label: String(i + 1), position: i * maten.spantafstandMm })),
    yAxes: Array.from({ length: nOverspanningen + 1 }, (_, lijn) => {
      const label = String.fromCharCode(65 + lijn);
      return { id: lijn === 0 || lijn === nOverspanningen ? `gevel-${label}` : `as-${label}`,
        label, position: lijn * maten.overspanningMm };
    }),
    zAxes: [
      ...(p.fundering.type === "balkrooster" && p.fundering.diepteMm > 0
        ? [{ id: STAALHAL_LEVEL.fundering, label: "Fundering", position: -p.fundering.diepteMm }] : []),
      { id: STAALHAL_LEVEL.peil, label: "Peil 0", position: 0 },
      { id: STAALHAL_LEVEL.goot, label: "Goot", position: p.goothoogteMm },
      ...(p.dak.type === "platdak" ? [] : [{ id: STAALHAL_LEVEL.nok, label: p.dak.type === "zadeldak" ? "Nok" : "Hoge zijde", position: p.dak.nokhoogteMm }]),
    ],
  };
  const loadCases = [...(p.eigenGewicht ? [{ ...EIGEN_GEWICHT_GEVAL }] : []), ...HANDMATIGE_GEVALLEN.map((c) => ({ ...c })),
    ...(lasten.dakgebruikKnM2 > 0 ? [{ ...DAKGEBRUIK_GEVAL }] : [])];
  return {
    parameters: p,
    model,
    eigenDoorsneden,
    stramien,
    loadCases,
    selfWeightEnabled: p.eigenGewicht,
    samenvatting: {
      maten,
      aantallen: {
        knopen: model.nodes.length,
        staven: model.beams.length,
        opleggingen: model.supports?.length ?? 0,
        palen: paalknopen.length,
        knoopbelastingen: model.loads?.length ?? 0,
        staafbelastingen: model.memberLoads?.length ?? 0,
      },
      groepen,
      paalknopen,
      lasten,
      belastingsom: belastingsom(model),
      eigenGewichtKn: eigenGewichtSom(model, staafVerloop, kolomVerloop),
    },
    waarschuwingen,
  };
}

/** "400" of "412,5" → "400" / "412.5" in een profielnaam b×h. */
function fmtMaat(mm: number): string {
  return String(Math.round(mm * 1000) / 1000);
}

/** Σ van de opgegeven lasten per geval in globale assen (voor controle en overzicht). */
function belastingsom(model: OpenFem3DModel): Record<number, { fx: number; fy: number; fz: number }> {
  const som: Record<number, { fx: number; fy: number; fz: number }> = {};
  const bij = (caseId: number) => (som[caseId] ??= { fx: 0, fy: 0, fz: 0 });
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
  for (const load of model.loads ?? []) {
    const s = bij(load.caseId ?? 1);
    s.fx += load.fx; s.fy += load.fy; s.fz += load.fz;
  }
  for (const load of model.memberLoads ?? []) {
    const beam = model.beams.find((b) => b.id === load.beamId)!;
    const a = nodeById.get(beam.startNodeId)!, e = nodeById.get(beam.endNodeId)!;
    const { ex, ey, ez } = openFem3DMemberAxes(a, e, beam.rollAngleRad ?? 0);
    const lengte = load.endPositionM - load.startPositionM;
    if (isOpenFem3DGlobalMemberLoad(load)) {
      // Globale lijnlast (#80): langs de globale as, per projectie maal |e_x × d|.
      const d = openFem3DGlobalDirectionVector(load.globalDirection);
      const f = openFem3DGlobalMemberLoadFactor(ex, load.globalDirection, load.perProjection);
      const totaal = f * (load.qStart + load.qEnd) / 2 * lengte;
      const s = bij(load.caseId ?? 1);
      s.fx += d[0] * totaal; s.fy += d[1] * totaal; s.fz += d[2] * totaal;
      continue;
    }
    const fy = (load.qyStart + load.qyEnd) / 2 * lengte;
    const fz = (load.qzStart + load.qzEnd) / 2 * lengte;
    const s = bij(load.caseId ?? 1);
    s.fx += fy * ey[0] + fz * ez[0];
    s.fy += fy * ey[1] + fz * ez[1];
    s.fz += fy * ey[2] + fz * ez[2];
  }
  return som;
}

/**
 * Σ ρ · A · g · L per materiaalsoort in kN; dezelfde doorsnede als de
 * rekenkern (bruto A). Een verlopende staaf (#73) met de gemiddelde A van haar
 * gelijke delen, zoals het eigen gewicht bij het rekenen; het verloop per
 * staaf komt van de generator zelf (`staafVerloop`, `kolomVerloop`), want een
 * gelaste tussendoorsnede staat nog niet in de winkel.
 */
function eigenGewichtSom(
  model: OpenFem3DModel, staafVerloop: ReadonlyMap<number, VerlopendeDoorsnede>, kolomVerloop: VerlopendeDoorsnede | null,
): { staal: number; hout: number; beton: number } {
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
  const som = { staal: 0, hout: 0, beton: 0 };
  for (const beam of model.beams) {
    const a = nodeById.get(beam.startNodeId)!, e = nodeById.get(beam.endNodeId)!;
    const lengte = Math.hypot(e.x - a.x, e.y - a.y, e.z - a.z);
    const verloop = staafVerloop.get(beam.id) ?? (beam.profileNameEnd !== undefined ? kolomVerloop : null);
    const d = resolveSection(beam.material ?? "", beam.profileName ?? "");
    const area = verloop
      ? openFem3DVerloopIndelingVan(verloop, lengte).delen.reduce((t, deel) => t + deel.doorsnede.areaMm2 * (deel.tEnd - deel.tStart), 0)
      : d.aBruto ?? d.A;
    const kn = dichtheidVanMateriaal(beam.material) * area * 1e-6 * G / 1000 * lengte;
    if ((beam.material ?? "") in CONCRETE_E_CM) som.beton += kn;
    else if (matchSupportedTimberGrade(beam.material)) som.hout += kn;
    else som.staal += kn;
  }
  return som;
}

/**
 * Probeer de hal te maken zonder te gooien — voor de wizard, die bij elke
 * wijziging een voorbeeld toont.
 */
export function probeerStaalhal(invoer: unknown):
  | { ok: true; resultaat: StaalhalResultaat }
  | { ok: false; problemen: StaalhalProbleem[] } {
  try {
    return { ok: true, resultaat: maakStaalhal(invoer) };
  } catch (fout) {
    if (fout instanceof StaalhalFout) return { ok: false, problemen: fout.problemen };
    throw fout;
  }
}

/**
 * Zet de belastinggevallen van de hal om naar die van een bestaand project:
 * `idVoor(halId)` geeft het project-id. Alleen `caseId` verandert.
 */
export function metBelastinggevalIds(model: OpenFem3DModel, idVoor: (halId: number) => number): OpenFem3DModel {
  return {
    ...model,
    loads: (model.loads ?? []).map((load) => ({ ...load, caseId: idVoor(load.caseId ?? 1) })),
    memberLoads: (model.memberLoads ?? []).map((load) => ({ ...load, caseId: idVoor(load.caseId ?? 1) })),
  };
}

/** Standaardnaam volgens het hoofdmateriaal; het stalen voorbeeld behoudt zijn naam. */
export function staalhalProjectnaam(p: StaalhalParameters): string {
  const materialen = Object.values(p.profielen).map((groep) => matchSupportedTimberGrade(groep.materiaal) !== null);
  const soort = materialen.every(Boolean) ? "Houten hal" : materialen.some(Boolean) ? "Hal" : "Staalhal";
  return p.projectnaam || `${soort} ${fmt(p.lengteMm / 1000)} × ${fmt(p.breedteMm / 1000)} m`;
}

/** The steel hall's wind cases use the legacy Dutch route, including manual pressures. */
export function requireStaalhalWindRoute(projectInfo: unknown): void {
  requireWindCodeId(windCodeIdFromProjectInfo(projectInfo));
}

/**
 * Het projectbestand (de vorm van `serializeProject`) van een hal: een
 * 3D-project met eerste-ordeanalyse, de belastinggevallen van de hal en het
 * eigen gewicht zoals gekozen. Met `stramien: true` gaat ook het stramien van
 * de hal mee; zonder is het bestand gelijk aan dat van het voorbeeldmodel.
 */
export function staalhalProject(
  resultaat: StaalhalResultaat,
  projectInfo: Record<string, unknown> = {},
  opties: { stramien?: boolean } = {},
) {
  requireStaalhalWindRoute(projectInfo);
  const savedBasis = projectInfo.uitgangspunten;
  if (savedBasis !== undefined && (savedBasis === null || typeof savedBasis !== "object" || Array.isArray(savedBasis))) {
    throw new Error("Projectuitgangspunten moeten een object zijn.");
  }
  return {
    nodes: [], beams: [], supports: [], plates: [], loads: [],
    loadCases: resultaat.loadCases,
    activeLoadCaseId: STAALHAL_GEVAL.permanent,
    selfWeightEnabled: resultaat.selfWeightEnabled,
    nonlinearEnabled: false,
    analysetype: "eersteOrde" as const,
    modelDimension: "3d" as const,
    model3d: resultaat.model,
    // De gelaste tussendoorsneden van een verlopende spantligger (#73).
    ...(resultaat.eigenDoorsneden.length > 0 ? { eigenDoorsneden: resultaat.eigenDoorsneden } : {}),
    ...(opties.stramien ? { structuralGrid: resultaat.stramien } : {}),
    projectInfo: { name: staalhalProjectnaam(resultaat.parameters), ...projectInfo,
      uitgangspunten: { ...DEFAULT_UITGANGSPUNTEN, ...(savedBasis as Record<string, unknown> | undefined),
        windCodeId: NEDERLANDSE_WINDROUTE } },
  };
}

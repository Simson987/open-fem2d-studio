/**
 * ifcAnalyseImport.ts — IFC4-analysemodel (Structural Analysis View) → 3D-project.
 *
 * Eén pure functie, drie afnemers: de knop "Rekenmodel importeren" in de app,
 * de bedieningsopdracht `ifc_analysemodel_importeren` en de MCP-tool
 * `open_fem_3d_ifc_importeren` (via de sidecarbundel). Er is geen tweede
 * vertaling van IFC naar model: wie een bestand via de API importeert, krijgt
 * knoop voor knoop hetzelfde project als wie het in de app opent.
 *
 * WAT ER UIT HET BESTAND KOMT
 *  - knopen (IfcStructuralPointConnection), met opleggingen en veren;
 *  - staven (IfcStructuralCurveMember) met profiel, materiaal, rolhoek,
 *    eindscharnieren (IfcRelConnectsStructuralMember) en trek-alleen; een
 *    staaf die ook tussen haar eindpunten aan een knoop hangt (een doorgaande
 *    ligger over een kolom), wordt daar geknipt; een stalen massieve rechthoek
 *    wordt een strip ("Strip <b>x<t>"), als pendelstaaf trek-alleen als hij plat is;
 *  - vlakken (IfcStructuralSurfaceMember): starre schijven (membraan,
 *    horizontaal) en dragers van belastingvlakken;
 *  - belastinggevallen, vlak-, lijn- en puntlasten, combinaties, levels. Een
 *    vlaklast met een eigen face die met haar vlak samenvalt, geldt voor het
 *    hele vlak; een kleinere face staat als niet ondersteund in het verslag.
 *
 * EERLIJK VERSLAG
 * Wat niet te vertalen is, wordt nooit stil weggelaten of geraden: het staat
 * in `verslag.nietOndersteund` (niet ingelezen) of `verslag.waarschuwingen`
 * (benaderd of aangenomen), in Nederlandse zinnen, gelijke meldingen samen
 * met een telling.
 *
 * EENHEDEN
 * Het bestand bepaalt zijn eenheden met IfcUnitAssignment; alles wordt
 * omgerekend naar m, kN, kN/m, kN/m², kNm, kN/m en kNm/rad (veren). Voor een
 * afgeleide grootheid geldt: een eigen IfcDerivedUnit gaat voor; anders, voor
 * de vlaklast, de PRESSUREUNIT (druk en vlaklast zijn dezelfde grootheid);
 * anders de samenstelling uit kracht en lengte (kN/mm bij mm en kN).
 *
 * LOKALE ASSEN
 * IFC: x van EdgeStart naar EdgeEnd, lokaal z = `Axis` loodrecht op x
 * geprojecteerd, y = z × x. Bij een I-profiel is `Axis` de richting van het
 * lijf (profiel-y = lokaal z). Het 3D-model: `openFem3DMemberAxes` met een
 * rolhoek θ; θ = atan2(−ẑ·e_y0, ẑ·e_z0) legt lokaal z op `Axis`. Lasten in
 * lokale assen en eindscharnieren gaan via globale vectoren naar de assen van
 * het model, zodat een extra rol (een liggende koker) vanzelf klopt.
 */
import type { GridAxisLine, LoadCase } from "../components/fem/femTypes";
import type { LoadCombination } from "../components/fem/solver/combinations";
import {
  openFem3DMemberAxes,
  parseOpenFem3DModel,
  type OpenFem3DBeam,
  type OpenFem3DDiaphragm,
  type OpenFem3DEndReleases,
  type OpenFem3DLoadPanel,
  type OpenFem3DLoadPanelDirection,
  type OpenFem3DMemberLoad,
  type OpenFem3DMemberPointLoad,
  type OpenFem3DModel,
  type OpenFem3DEnvelopePanel,
  type OpenFem3DNodalLoad,
  type OpenFem3DNode,
  type OpenFem3DSupport,
  type OpenFem3DVector,
} from "../components/openFem3d/openFem3dModel";
import { analyseOpenFem3DLoadPanels, openFem3DLoadPanelGeometry } from "../components/openFem3d/openFem3dLoadPanels";
import { STEEL_SECTION_DIMS, type SteelSectionDims, type SteelSectionKind } from "../lib/steelSectionDims.generated";
import { STEEL_GRADES } from "../lib/steelGrades";
import {
  leesStep,
  StepEnum,
  StepGetypt,
  StepLeesFout,
  StepRef,
  type StepBestand,
  type StepRecord,
  type StepWaarde,
} from "./stepLezer";

// ── Publieke vorm ───────────────────────────────────────────────────────────

export interface IfcAnalyseModelInfo {
  /** Volgnummer in het bestand, vanaf 1; zo kies je het model ook. */
  nummer: number;
  naam: string;
  beschrijving: string;
  aantallen: {
    knopen: number;
    staven: number;
    vlakken: number;
    belastinggevallen: number;
    combinaties: number;
  };
}

export interface IfcImportSchijf {
  id: number;
  naam: string;
  hoogteM: number;
  knopen: number;
  /** Namen van de membraanvlakken die samen deze schijf vormen. */
  vlakken: string[];
}

export interface IfcImportVerslag {
  /** Naam van het geïmporteerde analysemodel. */
  model: string;
  /** Schema uit de kop van het bestand, bijvoorbeeld "IFC4". */
  schema: string;
  aantallen: {
    knopen: number;
    staven: number;
    opleggingen: number;
    /** Staven met minstens één eindscharnier. */
    stavenMetScharnieren: number;
    belastingvlakken: number;
    staaflasten: number;
    staafpuntlasten: number;
    knooplasten: number;
    belastinggevallen: number;
    combinaties: number;
    levels: number;
    schijven: number;
    /** Gevallen met ActionSource SYSTEM_IMPERFECTION (scheefstand als knooplasten). */
    imperfectieGevallen: number;
  };
  /** Aantal trek-alleen staven. */
  trekAlleen: number;
  schijven: IfcImportSchijf[];
  /** Wat de import deed en hoe (eenheden, regels); geen actie nodig. */
  toelichting: string[];
  /** Benaderd of aangenomen: nakijken. */
  waarschuwingen: string[];
  /** Niet ingelezen: zelf aanvullen als het ertoe doet. */
  nietOndersteund: string[];
}

export interface IfcAnalyseImport {
  model3d: OpenFem3DModel;
  loadCases: LoadCase[];
  /** Eigen combinaties uit het bestand (zonder `standaard`); leeg als het bestand er geen heeft. */
  combinations: LoadCombination[];
  /** Het geval met het automatische eigen gewicht, als het bestand dat vraagt. */
  selfWeightCaseId?: number;
  /** Levels (horizontale stramienassen), hoogte in mm zoals `StructuralGrid.zAxes`. */
  levels: GridAxisLine[];
  projectnaam: string;
  verslag: IfcImportVerslag;
}

export type IfcImportFoutcode =
  | "leesfout" | "geenIfc4" | "geenAnalysemodel" | "modelKeuzeNodig" | "modelOnbekend" | "ongeldigModel";

/** Een bestand dat niet te importeren is, of een keuze die ontbreekt. */
export class IfcImportFout extends Error {
  constructor(
    readonly code: IfcImportFoutcode,
    melding: string,
    readonly modellen: IfcAnalyseModelInfo[] = [],
  ) {
    super(melding);
    this.name = "IfcImportFout";
  }
}

export interface IfcImportOpties {
  /** Het analysemodel: de naam, of het volgnummer vanaf 1. Mag ontbreken bij één model. */
  model?: string | number;
}

// ── Toleranties ─────────────────────────────────────────────────────────────

/** Knopen binnen deze afstand vallen samen; ook de grens voor "op de staaf" en "in het vlak". */
const KNOOP_TOLERANTIE_M = 1e-3;
/** Een knoop ligt op een level als hij hoogstens zoveel afwijkt (afrondingsruis). */
const LEVEL_TOLERANTIE_M = 1e-6;
const KLEIN = 1e-12;

// ── STEP-waarden lezen ──────────────────────────────────────────────────────

const arg = (r: StepRecord | undefined, i: number): StepWaarde => r?.args[i] ?? null;

function refVan(w: StepWaarde): number | null {
  return w instanceof StepRef ? w.id : null;
}

function refsVan(w: StepWaarde): number[] {
  if (!Array.isArray(w)) {
    const r = refVan(w);
    return r === null ? [] : [r];
  }
  return w.flatMap((x) => refsVan(x));
}

function tekstVan(w: StepWaarde): string | null {
  if (typeof w === "string") return w;
  if (w instanceof StepGetypt) return tekstVan(w.waarde);
  return null;
}

function getalVan(w: StepWaarde): number | null {
  if (typeof w === "number") return Number.isFinite(w) ? w : null;
  if (w instanceof StepGetypt) return getalVan(w.waarde);
  return null;
}

function enumVan(w: StepWaarde): string | null {
  if (w instanceof StepEnum) return w.waarde;
  if (w instanceof StepGetypt) return enumVan(w.waarde);
  return null;
}

/** `.T.` → true, `.F.` → false, anders null (ook `.U.`). */
function janeeVan(w: StepWaarde): boolean | null {
  const e = enumVan(w);
  return e === "T" || e === "TRUE" ? true : e === "F" || e === "FALSE" ? false : null;
}

/** Getal voor een Nederlandse zin: decimale komma en een echt minteken. */
const NL = (waarde: number, decimalen = 3) =>
  String(Number(waarde.toFixed(decimalen))).replace(".", ",").replace("-", "−");

// ── Het bestand, met de indexen die de import nodig heeft ───────────────────

type V3 = [number, number, number];

const T = {
  analyseModel: "IFCSTRUCTURALANALYSISMODEL",
  puntConnectie: "IFCSTRUCTURALPOINTCONNECTION",
  staven: new Set(["IFCSTRUCTURALCURVEMEMBER", "IFCSTRUCTURALCURVEMEMBERVARYING"]),
  vlakken: new Set(["IFCSTRUCTURALSURFACEMEMBER", "IFCSTRUCTURALSURFACEMEMBERVARYING"]),
  andereConnecties: new Set(["IFCSTRUCTURALCURVECONNECTION", "IFCSTRUCTURALSURFACECONNECTION"]),
  lastgroepen: new Set(["IFCSTRUCTURALLOADGROUP", "IFCSTRUCTURALLOADCASE"]),
  acties: new Set([
    "IFCSTRUCTURALPOINTACTION", "IFCSTRUCTURALCURVEACTION", "IFCSTRUCTURALLINEARACTION",
    "IFCSTRUCTURALSURFACEACTION", "IFCSTRUCTURALPLANARACTION",
  ]),
  toewijzing: new Set(["IFCRELASSIGNSTOGROUP", "IFCRELASSIGNSTOGROUPBYFACTOR"]),
  staafKoppeling: new Set(["IFCRELCONNECTSSTRUCTURALMEMBER", "IFCRELCONNECTSWITHECCENTRICITY"]),
  randen: new Set(["IFCEDGE", "IFCEDGECURVE", "IFCSUBEDGE"]),
};

interface Toewijzing {
  obj: number;
  /** Factor uit IfcRelAssignsToGroupByFactor; null bij een gewone toewijzing (= 1). */
  factor: number | null;
}

class IfcInhoud {
  readonly records: Map<number, StepRecord>;
  readonly schema: string;
  private readonly perType = new Map<string, StepRecord[]>();
  /** groep → leden (IfcRelAssignsToGroup/…ByFactor). */
  readonly toewijzingen = new Map<number, Toewijzing[]>();
  /** activiteit (last) → element waarop hij werkt. */
  readonly aangrijping = new Map<number, number>();
  /** staaf of vlak → koppelingen met knopen. */
  readonly staafKoppelingen = new Map<number, StepRecord[]>();
  /** object → materiaalkoppeling. */
  readonly materiaalVan = new Map<number, number>();
  /** object → eigenschappen (property sets). */
  readonly eigenschappen = new Map<number, { pset: string; naam: string; waarde: string | number | boolean }[]>();

  constructor(bestand: StepBestand) {
    this.records = bestand.records;
    this.schema = bestand.schemas[0] ?? "";
    for (const r of this.records.values()) {
      const lijst = this.perType.get(r.type);
      if (lijst) lijst.push(r);
      else this.perType.set(r.type, [r]);
    }
    for (const type of T.toewijzing) {
      for (const r of this.vanType(type)) {
        const groep = refVan(arg(r, 6));
        if (groep === null) continue;
        const factor = type === "IFCRELASSIGNSTOGROUPBYFACTOR" ? getalVan(arg(r, 7)) : null;
        const lijst = this.toewijzingen.get(groep) ?? [];
        for (const obj of refsVan(arg(r, 4))) lijst.push({ obj, factor: factor ?? null });
        this.toewijzingen.set(groep, lijst);
      }
    }
    for (const r of this.vanType("IFCRELCONNECTSSTRUCTURALACTIVITY")) {
      const element = refVan(arg(r, 4)), activiteit = refVan(arg(r, 5));
      if (element !== null && activiteit !== null && !this.aangrijping.has(activiteit)) this.aangrijping.set(activiteit, element);
    }
    for (const type of T.staafKoppeling) {
      for (const r of this.vanType(type)) {
        const lid = refVan(arg(r, 4));
        if (lid === null) continue;
        const lijst = this.staafKoppelingen.get(lid) ?? [];
        lijst.push(r);
        this.staafKoppelingen.set(lid, lijst);
      }
    }
    for (const r of this.vanType("IFCRELASSOCIATESMATERIAL")) {
      const materiaal = refVan(arg(r, 5));
      if (materiaal === null) continue;
      for (const obj of refsVan(arg(r, 4))) if (!this.materiaalVan.has(obj)) this.materiaalVan.set(obj, materiaal);
    }
    for (const r of this.vanType("IFCRELDEFINESBYPROPERTIES")) {
      // RelatingPropertyDefinition is één set of (IFC4) een lijst sets.
      const waarden: { pset: string; naam: string; waarde: string | number | boolean }[] = [];
      for (const psetId of refsVan(arg(r, 5))) {
        const pset = this.get(psetId);
        if (!pset || pset.type !== "IFCPROPERTYSET") continue;
        const psetNaam = tekstVan(arg(pset, 2)) ?? "";
        for (const id of refsVan(arg(pset, 4))) {
          const p = this.get(id);
          if (!p) continue;
          const naam = tekstVan(arg(p, 0)) ?? "";
          let ruw: StepWaarde = null;
          if (p.type === "IFCPROPERTYSINGLEVALUE") ruw = arg(p, 2);
          else if (p.type === "IFCPROPERTYENUMERATEDVALUE") {
            const lijst = arg(p, 2);
            ruw = Array.isArray(lijst) ? lijst[0] ?? null : null;
          } else continue;
          const waarde = tekstVan(ruw) ?? getalVan(ruw) ?? janeeVan(ruw);
          if (waarde !== null) waarden.push({ pset: psetNaam, naam, waarde });
        }
      }
      if (waarden.length === 0) continue;
      for (const obj of refsVan(arg(r, 4))) {
        const lijst = this.eigenschappen.get(obj) ?? [];
        lijst.push(...waarden);
        this.eigenschappen.set(obj, lijst);
      }
    }
  }

  get(id: number | null | undefined): StepRecord | undefined {
    return id === null || id === undefined ? undefined : this.records.get(id);
  }

  vanType(type: string): StepRecord[] {
    return this.perType.get(type) ?? [];
  }

  leden(groep: number): Toewijzing[] {
    return this.toewijzingen.get(groep) ?? [];
  }
}

/** Een gelezen bestand; te hergebruiken tussen `ifcAnalyseModellen` en de import. */
export interface IfcAnalyseBestand {
  readonly inhoud: IfcInhoud;
}

/** Lees en controleer het bestand één keer. Gooit `IfcImportFout`. */
export function leesIfcAnalyseBestand(tekst: string): IfcAnalyseBestand {
  let bestand: StepBestand;
  try {
    bestand = leesStep(tekst);
  } catch (fout) {
    if (fout instanceof StepLeesFout) throw new IfcImportFout("leesfout", `Het IFC-bestand is niet te lezen. ${fout.message}`);
    throw fout;
  }
  const schema = bestand.schemas[0] ?? "";
  if (!schema.startsWith("IFC4")) {
    throw new IfcImportFout("geenIfc4",
      `Dit bestand gebruikt het schema ${schema || "(onbekend)"}; alleen IFC4 wordt gelezen. ` +
      "Exporteer het analysemodel als IFC4 (Structural Analysis View).");
  }
  return { inhoud: new IfcInhoud(bestand) };
}

function bestandVan(invoer: string | IfcAnalyseBestand): IfcInhoud {
  return typeof invoer === "string" ? leesIfcAnalyseBestand(invoer).inhoud : invoer.inhoud;
}

// ── Eenheden ────────────────────────────────────────────────────────────────

const SI_VOORVOEGSEL: Record<string, number> = {
  EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 1e1,
  DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9, PICO: 1e-12, FEMTO: 1e-15, ATTO: 1e-18,
};
const SI_SYMBOOL_VOORVOEGSEL: Record<string, string> = {
  GIGA: "G", MEGA: "M", KILO: "k", HECTO: "h", DECA: "da", DECI: "d", CENTI: "c", MILLI: "m", MICRO: "µ",
};
/** Macht van de basiseenheid en factor naar SI. */
const SI_NAAM: Record<string, { macht: number; factor: number; symbool: string }> = {
  METRE: { macht: 1, factor: 1, symbool: "m" },
  SQUARE_METRE: { macht: 2, factor: 1, symbool: "m²" },
  CUBIC_METRE: { macht: 3, factor: 1, symbool: "m³" },
  NEWTON: { macht: 1, factor: 1, symbool: "N" },
  PASCAL: { macht: 1, factor: 1, symbool: "Pa" },
  RADIAN: { macht: 1, factor: 1, symbool: "rad" },
  GRAM: { macht: 1, factor: 1e-3, symbool: "g" },
  SECOND: { macht: 1, factor: 1, symbool: "s" },
  KELVIN: { macht: 1, factor: 1, symbool: "K" },
};

interface Eenheid {
  /** Factor naar SI (m, N, Pa, rad, …). */
  factor: number;
  label: string;
}

interface Eenheden {
  /** m per lengte-eenheid. */
  lengte: number;
  /** kN per krachteenheid. */
  kracht: number;
  /** kN/m per eenheid van een lijnlast. */
  lijnlast: number;
  /** kN/m² per eenheid van een vlaklast. */
  vlaklast: number;
  /** kNm per eenheid van een moment. */
  moment: number;
  /** kNm/m per eenheid van een lijnmoment. */
  lijnmoment: number;
  /** kN/m per eenheid van een translatieveer. */
  veerTranslatie: number;
  /** kNm/rad per eenheid van een rotatieveer. */
  veerRotatie: number;
  /** Omschrijving voor het verslag. */
  omschrijving: string;
}

function eenheidVan(ifc: IfcInhoud, id: number | null, bezocht = new Set<number>()): Eenheid | null {
  const r = ifc.get(id);
  if (!r || bezocht.has(r.id)) return null;
  bezocht.add(r.id);
  if (r.type === "IFCSIUNIT") {
    const voorvoegsel = enumVan(arg(r, 2));
    const naam = enumVan(arg(r, 3)) ?? "";
    const basis = SI_NAAM[naam];
    if (!basis) return null;
    const v = voorvoegsel ? SI_VOORVOEGSEL[voorvoegsel] ?? 1 : 1;
    return {
      factor: v ** basis.macht * basis.factor,
      label: `${voorvoegsel ? SI_SYMBOOL_VOORVOEGSEL[voorvoegsel] ?? voorvoegsel.toLowerCase() : ""}${basis.symbool}`,
    };
  }
  if (r.type === "IFCCONVERSIONBASEDUNIT" || r.type === "IFCCONVERSIONBASEDUNITWITHOFFSET") {
    const maat = ifc.get(refVan(arg(r, 3)));
    const waarde = getalVan(arg(maat, 0));
    const basis = eenheidVan(ifc, refVan(arg(maat, 1)), bezocht);
    if (waarde === null || !basis) return null;
    return { factor: waarde * basis.factor, label: tekstVan(arg(r, 2)) ?? basis.label };
  }
  if (r.type === "IFCDERIVEDUNIT") {
    let factor = 1;
    const boven: string[] = [], onder: string[] = [];
    for (const elementId of refsVan(arg(r, 0))) {
      const element = ifc.get(elementId);
      const deel = eenheidVan(ifc, refVan(arg(element, 0)), bezocht);
      const exponent = getalVan(arg(element, 1));
      if (!deel || exponent === null) return null;
      factor *= deel.factor ** exponent;
      const macht = Math.abs(exponent) === 1 ? "" : Math.abs(exponent) === 2 ? "²" : Math.abs(exponent) === 3 ? "³" : `^${Math.abs(exponent)}`;
      (exponent > 0 ? boven : onder).push(`${deel.label}${macht}`);
    }
    return { factor, label: `${boven.join("·") || "1"}${onder.length ? `/${onder.join("·")}` : ""}` };
  }
  return null;
}

function leesEenheden(ifc: IfcInhoud): Eenheden {
  const project = ifc.vanType("IFCPROJECT")[0];
  const toekenning = ifc.get(refVan(arg(project, 8))) ?? ifc.vanType("IFCUNITASSIGNMENT")[0];
  const benoemd = new Map<string, Eenheid>();
  const afgeleid = new Map<string, Eenheid>();
  for (const id of refsVan(arg(toekenning, 0))) {
    const r = ifc.get(id);
    if (!r) continue;
    const eenheid = eenheidVan(ifc, id);
    if (!eenheid) continue;
    if (r.type === "IFCDERIVEDUNIT") {
      const soort = enumVan(arg(r, 1));
      if (soort && !afgeleid.has(soort)) afgeleid.set(soort, eenheid);
    } else {
      const soort = enumVan(arg(r, 1));
      if (soort && !benoemd.has(soort)) benoemd.set(soort, eenheid);
    }
  }
  const lengte = benoemd.get("LENGTHUNIT")?.factor ?? 1;
  const krachtN = benoemd.get("FORCEUNIT")?.factor ?? 1;
  const kracht = krachtN / 1000;
  const lengteLabel = benoemd.get("LENGTHUNIT")?.label ?? "m";
  const krachtLabel = benoemd.get("FORCEUNIT")?.label ?? "N";
  const kies = (soort: string, samengesteld: number, samengesteldLabel: string, extra?: { soort: string; bron: string }) => {
    const eigen = afgeleid.get(soort);
    if (eigen) return { factor: eigen.factor / 1000, label: `${eigen.label} (${soort})` };
    if (extra) {
      const alt = benoemd.get(extra.soort);
      if (alt) return { factor: alt.factor / 1000, label: `${alt.label} (${extra.bron})` };
    }
    return { factor: samengesteld, label: samengesteldLabel };
  };
  const lijnlast = kies("LINEARFORCEUNIT", kracht / lengte, `${krachtLabel}/${lengteLabel}`);
  const vlaklast = kies("PLANARFORCEUNIT", kracht / lengte ** 2, `${krachtLabel}/${lengteLabel}²`,
    { soort: "PRESSUREUNIT", bron: "PRESSUREUNIT" });
  const moment = kies("TORQUEUNIT", kracht * lengte, `${krachtLabel}·${lengteLabel}`);
  const lijnmoment = kies("LINEARMOMENTUNIT", kracht, `${krachtLabel}·${lengteLabel}/${lengteLabel}`);
  const veerTranslatie = kies("LINEARSTIFFNESSUNIT", kracht / lengte, `${krachtLabel}/${lengteLabel}`);
  const veerRotatie = kies("ROTATIONALSTIFFNESSUNIT", kracht * lengte, `${krachtLabel}·${lengteLabel}/rad`);
  return {
    lengte, kracht,
    lijnlast: lijnlast.factor, vlaklast: vlaklast.factor, moment: moment.factor, lijnmoment: lijnmoment.factor,
    veerTranslatie: veerTranslatie.factor, veerRotatie: veerRotatie.factor,
    omschrijving:
      `Eenheden in het bestand: lengte ${lengteLabel}, kracht ${krachtLabel}, lijnlast ${lijnlast.label}, ` +
      `vlaklast ${vlaklast.label}, moment ${moment.label}. Omgerekend naar m, kN, kN/m, kN/m² en kNm.`,
  };
}

// ── Meetkunde ───────────────────────────────────────────────────────────────

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): V3 => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: readonly number[], b: readonly number[]): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: readonly number[], f: number): V3 => [a[0] * f, a[1] * f, a[2] * f];
const norm = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: readonly number[]): V3 => scale(a, 1 / norm(a));

/** Starre transformatie: kolommen x, y, z en oorsprong o. */
interface Trafo { x: V3; y: V3; z: V3; o: V3 }
const IDENTITEIT: Trafo = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], o: [0, 0, 0] };
const draai = (t: Trafo, v: readonly number[]): V3 =>
  add(add(scale(t.x, v[0]), scale(t.y, v[1])), scale(t.z, v[2]));
const pas = (t: Trafo, p: readonly number[]): V3 => add(t.o, draai(t, p));
const na = (a: Trafo, b: Trafo): Trafo => ({ x: draai(a, b.x), y: draai(a, b.y), z: draai(a, b.z), o: pas(a, b.o) });
const inverse = (t: Trafo): Trafo => {
  const x: V3 = [t.x[0], t.y[0], t.z[0]];
  const y: V3 = [t.x[1], t.y[1], t.z[1]];
  const z: V3 = [t.x[2], t.y[2], t.z[2]];
  const r: Trafo = { x, y, z, o: [0, 0, 0] };
  return { x, y, z, o: scale(draai(r, t.o), -1) };
};

class Meetkunde {
  private wereldCache = new Map<number, Trafo>();

  constructor(readonly ifc: IfcInhoud, readonly lengte: number, private readonly meld: (tekst: string) => void) {}

  punt(id: number | null): V3 | null {
    const r = this.ifc.get(id);
    if (!r || r.type !== "IFCCARTESIANPOINT") return null;
    const c = arg(r, 0);
    if (!Array.isArray(c)) return null;
    const waarden = c.map((w) => getalVan(w) ?? 0);
    return [(waarden[0] ?? 0) * this.lengte, (waarden[1] ?? 0) * this.lengte, (waarden[2] ?? 0) * this.lengte];
  }

  richting(id: number | null): V3 | null {
    const r = this.ifc.get(id);
    if (!r || r.type !== "IFCDIRECTION") return null;
    const c = arg(r, 0);
    if (!Array.isArray(c)) return null;
    const v: V3 = [getalVan(c[0] ?? null) ?? 0, getalVan(c[1] ?? null) ?? 0, getalVan(c[2] ?? null) ?? 0];
    return norm(v) > KLEIN ? unit(v) : null;
  }

  /** IfcAxis2Placement3D of 2D → transformatie (IfcBuildAxes / IfcFirstProjAxis). */
  plaatsing(id: number | null): Trafo {
    const r = this.ifc.get(id);
    if (!r) return IDENTITEIT;
    if (r.type === "IFCAXIS2PLACEMENT3D") {
      const o = this.punt(refVan(arg(r, 0))) ?? [0, 0, 0];
      const z = this.richting(refVan(arg(r, 1))) ?? [0, 0, 1];
      const ref = this.richting(refVan(arg(r, 2)))
        ?? (Math.abs(z[0] - 1) < KLEIN && Math.abs(z[1]) < KLEIN && Math.abs(z[2]) < KLEIN ? [0, 1, 0] as V3 : [1, 0, 0] as V3);
      const x0 = sub(ref, scale(z, dot(ref, z)));
      const x = norm(x0) > KLEIN ? unit(x0) : unit(cross([0, 1, 0], z));
      return { x, y: cross(z, x), z, o };
    }
    if (r.type === "IFCAXIS2PLACEMENT2D") {
      const o = this.punt(refVan(arg(r, 0))) ?? [0, 0, 0];
      const ref = this.richting(refVan(arg(r, 1))) ?? [1, 0, 0];
      const x = unit([ref[0], ref[1], 0]);
      return { x, y: cross([0, 0, 1], x), z: [0, 0, 1], o: [o[0], o[1], 0] };
    }
    return IDENTITEIT;
  }

  /** IfcLocalPlacement-keten → wereldtransformatie. */
  wereld(id: number | null, keten = new Set<number>()): Trafo {
    if (id === null) return IDENTITEIT;
    const bekend = this.wereldCache.get(id);
    if (bekend) return bekend;
    const r = this.ifc.get(id);
    if (!r || keten.has(id)) return IDENTITEIT;
    keten.add(id);
    let uit = IDENTITEIT;
    if (r.type === "IFCLOCALPLACEMENT") {
      const ouder = refVan(arg(r, 0));
      uit = na(this.wereld(ouder, keten), this.plaatsing(refVan(arg(r, 1))));
    } else {
      this.meld(`Plaatsing ${ifcNaam(r.type)} wordt niet ondersteund; als oorsprong ingelezen`);
    }
    this.wereldCache.set(id, uit);
    return uit;
  }

  /** Vertexpunt → coördinaten in het eigen stelsel van het item. */
  vertex(id: number | null): V3 | null {
    const r = this.ifc.get(id);
    if (!r || r.type !== "IFCVERTEXPOINT") return null;
    return this.punt(refVan(arg(r, 0)));
  }

  /** Items van de topologie van een product (IfcProductDefinitionShape → representaties → items). */
  topologie(product: StepRecord): StepRecord[] {
    const vorm = this.ifc.get(refVan(arg(product, 6)));
    const uit: StepRecord[] = [];
    for (const repId of refsVan(arg(vorm, 2))) {
      const rep = this.ifc.get(repId);
      for (const itemId of refsVan(arg(rep, 3))) {
        const item = this.ifc.get(itemId);
        if (item) uit.push(item);
      }
    }
    return uit;
  }

  /** Begin- en eindvertex van een rand; een IfcOrientedEdge volgt zijn richting. */
  rand(r: StepRecord | undefined): { start: number; eind: number; gebogen: boolean } | null {
    if (!r) return null;
    if (r.type === "IFCORIENTEDEDGE") {
      const element = this.rand(this.ifc.get(refVan(arg(r, 2))));
      if (!element) return null;
      return janeeVan(arg(r, 3)) === false ? { ...element, start: element.eind, eind: element.start } : element;
    }
    if (!T.randen.has(r.type)) return null;
    const start = refVan(arg(r, 0)), eind = refVan(arg(r, 1));
    if (start === null || eind === null) return null;
    let gebogen = false;
    if (r.type === "IFCEDGECURVE") {
      const kromme = this.ifc.get(refVan(arg(r, 2)));
      const basis = kromme?.type === "IFCTRIMMEDCURVE" ? this.ifc.get(refVan(arg(kromme, 0))) : kromme;
      gebogen = !!basis && basis.type !== "IFCLINE" && basis.type !== "IFCPOLYLINE";
    }
    return { start, eind, gebogen };
  }
}

// ── Meldingen ───────────────────────────────────────────────────────────────

type Soort = "toelichting" | "waarschuwing" | "nietOndersteund";

class Meldingen {
  private readonly lijst = new Map<string, { soort: Soort; tekst: string; details: string[] }>();

  voeg(soort: Soort, tekst: string, detail?: string): void {
    const sleutel = `${soort}|${tekst}`;
    let item = this.lijst.get(sleutel);
    if (!item) {
      item = { soort, tekst, details: [] };
      this.lijst.set(sleutel, item);
    }
    if (detail !== undefined && !item.details.includes(detail)) item.details.push(detail);
  }

  teksten(soort: Soort): string[] {
    const uit: string[] = [];
    for (const item of this.lijst.values()) {
      if (item.soort !== soort) continue;
      const n = item.details.length;
      if (n === 0) uit.push(`${item.tekst}.`);
      else if (n === 1) uit.push(`${item.tekst}: ${item.details[0]}.`);
      else {
        const getoond = item.details.slice(0, 6).join("; ");
        uit.push(`${item.tekst} (${n}×): ${getoond}${n > 6 ? "; …" : ""}.`);
      }
    }
    return uit;
  }
}

// ── Analysemodellen ─────────────────────────────────────────────────────────

interface ModelInhoud {
  record: StepRecord;
  nummer: number;
  naam: string;
  connecties: StepRecord[];
  staven: StepRecord[];
  vlakken: StepRecord[];
  andere: StepRecord[];
  gevallen: StepRecord[];
  combinaties: StepRecord[];
  /** LOAD_GROUP's in LoadedBy die bij geen geval horen: als eigen geval gelezen. */
  losseGroepen: StepRecord[];
  /** Combinaties buiten LoadedBy die gevallen van dit model gebruiken. */
  wezen: StepRecord[];
}

function modelNaam(r: StepRecord, nummer: number): string {
  return (tekstVan(arg(r, 2)) ?? "").trim() || `Analysemodel ${nummer}`;
}

function modellenVan(ifc: IfcInhoud): ModelInhoud[] {
  const modellen = ifc.vanType(T.analyseModel).slice().sort((a, b) => a.id - b.id);
  const inLoadedBy = new Set<number>();
  for (const m of modellen) for (const id of refsVan(arg(m, 7))) inLoadedBy.add(id);
  const uit = modellen.map((record, index): ModelInhoud => {
    const leden = ifc.leden(record.id).map((t) => ifc.get(t.obj)).filter((r): r is StepRecord => !!r);
    const gevallen: StepRecord[] = [], combinaties: StepRecord[] = [], groepen: StepRecord[] = [];
    for (const id of refsVan(arg(record, 7))) {
      const g = ifc.get(id);
      if (!g || !T.lastgroepen.has(g.type)) continue;
      const soort = enumVan(arg(g, 5));
      if (soort === "LOAD_COMBINATION") combinaties.push(g);
      else if (g.type === "IFCSTRUCTURALLOADCASE" || soort === "LOAD_CASE") gevallen.push(g);
      else if (soort === "LOAD_GROUP") groepen.push(g);
      else gevallen.push(g);
    }
    // Een lastgroep die in een geval zit, telt via dat geval mee.
    const inGeval = new Set<number>();
    for (const g of gevallen) for (const t of ifc.leden(g.id)) inGeval.add(t.obj);
    const losseGroepen = groepen.filter((g) => !inGeval.has(g.id));
    const eigenGevallen = new Set([...gevallen, ...losseGroepen].map((g) => g.id));
    const wezen = ifc.vanType("IFCSTRUCTURALLOADGROUP").filter((g) =>
      enumVan(arg(g, 5)) === "LOAD_COMBINATION" && !inLoadedBy.has(g.id) &&
      ifc.leden(g.id).some((t) => eigenGevallen.has(t.obj)));
    return {
      record, nummer: index + 1, naam: modelNaam(record, index + 1),
      connecties: leden.filter((r) => r.type === T.puntConnectie),
      staven: leden.filter((r) => T.staven.has(r.type)),
      vlakken: leden.filter((r) => T.vlakken.has(r.type)),
      andere: leden.filter((r) => T.andereConnecties.has(r.type)),
      gevallen: [...gevallen, ...losseGroepen],
      combinaties: [...combinaties, ...wezen],
      losseGroepen,
      wezen,
    };
  });
  return uit;
}

function info(m: ModelInhoud): IfcAnalyseModelInfo {
  return {
    nummer: m.nummer,
    naam: m.naam,
    beschrijving: (tekstVan(arg(m.record, 3)) ?? "").trim(),
    aantallen: {
      knopen: m.connecties.length,
      staven: m.staven.length,
      vlakken: m.vlakken.length,
      belastinggevallen: m.gevallen.length,
      combinaties: m.combinaties.length,
    },
  };
}

/** De analysemodellen in het bestand, met naam, beschrijving en aantallen. */
export function ifcAnalyseModellen(invoer: string | IfcAnalyseBestand): IfcAnalyseModelInfo[] {
  return modellenVan(bestandVan(invoer)).map(info);
}

function kiesModel(modellen: ModelInhoud[], keuze: string | number | undefined): ModelInhoud {
  const lijst = modellen.map(info);
  const opsomming = lijst.map((m) => `${m.nummer} "${m.naam}"`).join(", ");
  if (modellen.length === 0) {
    throw new IfcImportFout("geenAnalysemodel",
      "Dit IFC-bestand bevat geen analysemodel (IfcStructuralAnalysisModel). Het is waarschijnlijk een " +
      "bouwkundig model; exporteer uit het rekenpakket het analysemodel (Structural Analysis View).");
  }
  if (keuze === undefined || keuze === "") {
    if (modellen.length === 1) return modellen[0];
    throw new IfcImportFout("modelKeuzeNodig",
      `Het bestand bevat ${modellen.length} analysemodellen: ${opsomming}. Kies er één, op naam of nummer.`, lijst);
  }
  if (typeof keuze === "number") {
    const gevonden = modellen[keuze - 1];
    if (Number.isInteger(keuze) && gevonden) return gevonden;
  } else {
    const gezocht = keuze.trim().toLowerCase();
    const gevonden = modellen.find((m) => m.naam.trim().toLowerCase() === gezocht);
    if (gevonden) return gevonden;
  }
  throw new IfcImportFout("modelOnbekend",
    `Analysemodel ${typeof keuze === "number" ? keuze : `"${keuze}"`} staat niet in het bestand; ` +
    `kies uit ${opsomming}.`, lijst);
}

// ── Profielen en materialen ─────────────────────────────────────────────────

const SERIE_VOORKEUR = ["IPE", "HEA", "HEB", "HEM", "UNP", "UPE", "SHS", "RHS", "CHS"];

function catalogusSleutel(naam: string): string {
  return naam.toUpperCase().replace(/[\s\-.]/g, "");
}

function voorkeur(dims: SteelSectionDims): number {
  const i = SERIE_VOORKEUR.findIndex((serie) => dims.naam.toUpperCase().startsWith(serie));
  return i < 0 ? SERIE_VOORKEUR.length : i;
}

function zoekOpMaten(
  soorten: readonly SteelSectionKind[],
  past: (d: SteelSectionDims) => boolean,
): SteelSectionDims | undefined {
  const kandidaten = Object.values(STEEL_SECTION_DIMS).filter((d) => soorten.includes(d.kind) && past(d));
  return kandidaten.sort((a, b) => voorkeur(a) - voorkeur(b))[0];
}

const binnen = (a: number, b: number, tolerantie: number) => Math.abs(a - b) <= tolerantie;
const maat = (x: number) => String(Math.round(x * 100) / 100);

interface ProfielUitkomst {
  naam?: string;
  /** Extra rol (rad) bovenop die uit `Axis`: een liggende koker of een gedraaid profiel. */
  extraRol: number;
  /** Massief rond (IfcCircleProfileDef): trek-alleen bij een pendelstaaf. */
  massiefRond: boolean;
  /** Platte strip (stalen rechthoek met dikte ≤ ¼ breedte): trek-alleen bij een pendelstaaf. */
  platteStrip: boolean;
}

/**
 * Profiel → catalogusnaam. Afmetingen in mm. Meldingen gaan via `meld`,
 * met de staaf als detail. `staal`: de staaf is van staal S235–S460; alleen
 * dan wordt een massieve rechthoek een strip.
 */
function profielVan(
  ifc: IfcInhoud, meetkunde: Meetkunde, profiel: StepRecord | undefined, staal: boolean,
  meld: (soort: Soort, tekst: string) => void,
): ProfielUitkomst {
  const uit: ProfielUitkomst = { extraRol: 0, massiefRond: false, platteStrip: false };
  if (!profiel) {
    meld("nietOndersteund", "Staaf zonder profiel in het bestand; de staaf staat zonder profiel in het model");
    return uit;
  }
  const mm = (w: StepWaarde) => (getalVan(w) ?? 0) * meetkunde.lengte * 1000;
  const naam = (tekstVan(arg(profiel, 1)) ?? "").trim();
  // Position (IfcAxis2Placement2D): verschuiving = excentriciteit, draaiing = extra rol.
  const positie = ifc.get(refVan(arg(profiel, 2)));
  if (positie && positie.type === "IFCAXIS2PLACEMENT2D") {
    const p = meetkunde.plaatsing(positie.id);
    if (Math.hypot(p.o[0], p.o[1]) > 1e-4) {
      meld("nietOndersteund", "Profiel met een verschoven positie (excentriciteit) wordt niet ondersteund; de staaf ligt op de hartlijn");
    }
    const hoek = Math.atan2(p.x[1], p.x[0]);
    if (Math.abs(hoek) > 1e-9) uit.extraRol += hoek;
  }
  if (profiel.type === "IFCRECTANGLEPROFILEDEF" && staal) {
    // Stalen rechthoek → "Strip <b>x<t>" (mm) met b de brede en t de smalle zijde.
    // Aangenomen: de catalogus legt b, zoals h van een koker, langs lokaal z
    // (profiel-y). Ligt de brede zijde langs profiel-x, dan draait de staaf 90° mee.
    const x = mm(arg(profiel, 3)), y = mm(arg(profiel, 4));
    const b = Math.max(x, y), t = Math.min(x, y);
    if (y < x) {
      uit.extraRol += Math.PI / 2;
      meld("toelichting", "Strip met de brede zijde langs profiel-x: catalogusprofiel met een extra rol van 90°");
    }
    uit.naam = `Strip ${maat(b)}x${maat(t)}`;
    uit.platteStrip = t <= b / 4 + 1e-9;
    return uit;
  }
  switch (profiel.type) {
    case "IFCISHAPEPROFILEDEF":
    case "IFCUSHAPEPROFILEDEF": {
      const isI = profiel.type === "IFCISHAPEPROFILEDEF";
      const b = mm(arg(profiel, isI ? 3 : 4)), h = mm(arg(profiel, isI ? 4 : 3));
      const tw = mm(arg(profiel, 5)), tf = mm(arg(profiel, 6));
      const soort: SteelSectionKind = isI ? "ISection" : "Channel";
      const sleutel = catalogusSleutel(naam);
      const kandidaten = [sleutel];
      let m = /^HE(\d+)(AA|A|B|M)$/.exec(sleutel);
      if (m) kandidaten.push(`HE${m[2]}${m[1]}`);
      m = /^(?:UPN|U)(\d+)$/.exec(sleutel);
      if (m) kandidaten.push(`UNP${m[1]}`);
      const opNaam = kandidaten.map((k) => STEEL_SECTION_DIMS[k]).find((d) => d?.kind === soort);
      if (opNaam) {
        if (!binnen(opNaam.h, h, Math.max(1, 0.02 * h)) || !binnen(opNaam.b, b, Math.max(1, 0.02 * b))) {
          meld("waarschuwing",
            `De afmetingen in het bestand passen niet bij de profielnaam; de catalogusnaam ${opNaam.naam} is aangehouden`);
        }
        uit.naam = opNaam.naam;
        return uit;
      }
      const opMaten = zoekOpMaten([soort], (d) =>
        binnen(d.h, h, Math.max(0.5, 0.005 * h)) && binnen(d.b, b, Math.max(0.5, 0.005 * b)) &&
        binnen(d.tw, tw, 0.2) && binnen(d.tf, tf, 0.2));
      if (opMaten) {
        uit.naam = opMaten.naam;
        meld("toelichting", `Profielnaam niet in de catalogus; op afmetingen gevonden: ${opMaten.naam}`);
        return uit;
      }
      meld("nietOndersteund",
        `${isI ? "I-profiel" : "U-profiel"} niet in de staalcatalogus (naam en afmetingen); de staaf staat zonder profiel`);
      return uit;
    }
    case "IFCRECTANGLEHOLLOWPROFILEDEF": {
      const x = mm(arg(profiel, 3)), y = mm(arg(profiel, 4)), t = mm(arg(profiel, 5));
      if (binnen(x, y, 0.01)) {
        const d = zoekOpMaten(["Shs"], (c) => c.naam.startsWith("SHS") && binnen(c.h, x, 0.5) && binnen(c.b, x, 0.5) && binnen(c.tw, t, 0.1));
        uit.naam = d?.naam ?? `SHS ${maat(x)}x${maat(x)}x${maat(t)}`;
        if (!d) meld("waarschuwing", `Koker niet in de staalcatalogus; profielnaam ${uit.naam} gegeven, het rekenen meldt de ontbrekende doorsnede`);
        return uit;
      }
      const hoog = Math.max(x, y), laag = Math.min(x, y);
      // Catalogus: h langs lokaal z (profiel-y). Ligt de lange zijde langs profiel-x,
      // dan draait de staaf 90° mee zodat h weer langs de lange zijde ligt.
      if (y < x) {
        uit.extraRol += Math.PI / 2;
        meld("toelichting", "Liggende koker (breedte groter dan hoogte): catalogusprofiel met een extra rol van 90°");
      }
      const d = zoekOpMaten(["Rhs"], (c) => c.naam.startsWith("RHS") && binnen(c.h, hoog, 0.5) && binnen(c.b, laag, 0.5) && binnen(c.tw, t, 0.1));
      uit.naam = d?.naam ?? `RHS ${maat(hoog)}x${maat(laag)}x${maat(t)}`;
      if (!d) meld("waarschuwing", `Koker niet in de staalcatalogus; profielnaam ${uit.naam} gegeven, het rekenen meldt de ontbrekende doorsnede`);
      return uit;
    }
    case "IFCCIRCLEHOLLOWPROFILEDEF": {
      const diameter = 2 * mm(arg(profiel, 3)), t = mm(arg(profiel, 4));
      const d = zoekOpMaten(["Chs"], (c) => binnen(c.h, diameter, 0.3) && binnen(c.tw, t, 0.1));
      uit.naam = d?.naam ?? `CHS ${maat(diameter)}x${maat(t)}`;
      if (!d) meld("waarschuwing", `Buis niet in de staalcatalogus; profielnaam ${uit.naam} gegeven, het rekenen meldt de ontbrekende doorsnede`);
      return uit;
    }
    case "IFCCIRCLEPROFILEDEF": {
      const diameter = 2 * mm(arg(profiel, 3));
      uit.naam = `RD ${maat(diameter)}`;
      uit.massiefRond = true;
      return uit;
    }
    default:
      meld("nietOndersteund",
        `Profieltype ${ifcNaam(profiel.type)} wordt niet ondersteund; de staaf staat zonder profiel`);
      return uit;
  }
}

function materiaalVan(naam: string): string | null {
  const m = /(?:^|[^A-Z0-9])S\s?(\d{3})(?!\d)/i.exec(` ${naam}`);
  if (!m) return null;
  const soort = `S${m[1]}`;
  return STEEL_GRADES.includes(soort) ? soort : null;
}

// ── Oplegcondities ──────────────────────────────────────────────────────────

/** Eén vrijheidsgraad van een IfcBoundaryNodeCondition. */
type Conditie = { soort: "vast" } | { soort: "vrij" } | { soort: "veer"; waarde: number } | { soort: "ongeldig" };

/**
 * `leeg` is de betekenis van een niet ingevulde waarde (`$`): bij een
 * oplegging "vrij" (niet opgelegd), aan een staafeinde "vast" (star
 * verbonden, zoals zonder conditie).
 */
function conditieVan(w: StepWaarde, factor: number, leeg: "vrij" | "vast"): Conditie {
  if (w === null) return { soort: leeg };
  const janee = janeeVan(w);
  if (janee !== null) return { soort: janee ? "vast" : "vrij" };
  if (w instanceof StepGetypt && /STIFFNESSMEASURE$/.test(w.type)) {
    const waarde = getalVan(w);
    if (waarde === null || waarde < 0) return { soort: "ongeldig" };
    return waarde === 0 ? { soort: "vrij" } : { soort: "veer", waarde: waarde * factor };
  }
  if (enumVan(w) === "U") return { soort: leeg };
  return { soort: "ongeldig" };
}

function condities(ifc: IfcInhoud, id: number | null, eenheden: Eenheden, leeg: "vrij" | "vast"): Conditie[] | null {
  const r = ifc.get(id);
  if (!r || (r.type !== "IFCBOUNDARYNODECONDITION" && r.type !== "IFCBOUNDARYNODECONDITIONWARPING")) return null;
  return [1, 2, 3, 4, 5, 6].map((i) =>
    conditieVan(arg(r, i), i <= 3 ? eenheden.veerTranslatie : eenheden.veerRotatie, leeg));
}

const gelijkeConditie = (a: Conditie, b: Conditie) =>
  a.soort === b.soort && (a.soort !== "veer" || (b.soort === "veer" && Math.abs(a.waarde - b.waarde) <= 1e-9 * Math.abs(a.waarde)));

// ── Vlakmeetkunde ───────────────────────────────────────────────────────────

/** Vaste normaal zoals bij een belastingvlak: naar beneden, anders −Y, anders −X. */
function canoniekeNormaal(n: V3): V3 {
  const e = 1e-6;
  const omkeren = Math.abs(n[2]) > e ? n[2] > 0 : Math.abs(n[1]) > e ? n[1] > 0 : n[0] > 0;
  return omkeren ? scale(n, -1) : n;
}

/** Newell: normaal × 2·oppervlak van een (ook niet-convexe) vlakke veelhoek. */
function newell(punten: readonly V3[]): V3 {
  const n: V3 = [0, 0, 0];
  for (let i = 0; i < punten.length; i += 1) {
    const a = punten[i], b = punten[(i + 1) % punten.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}

/** In of op (binnen `tolerantie`) de veelhoek. */
function puntInVeelhoek(p: readonly [number, number], veelhoek: readonly (readonly [number, number])[], tolerantie: number): boolean {
  let binnenkant = false;
  for (let i = 0, j = veelhoek.length - 1; i < veelhoek.length; j = i, i += 1) {
    const a = veelhoek[i], b = veelhoek[j];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    if (Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) <= tolerantie) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < dx * (p[1] - a[1]) / dy + a[0]) binnenkant = !binnenkant;
  }
  return binnenkant;
}

/** Zoekt een knoop binnen 1 mm, met een raster van 1 mm. */
class KnoopZoeker {
  private readonly cellen = new Map<string, OpenFem3DNode[]>();

  private static cel(x: number): number {
    return Math.round(x / KNOOP_TOLERANTIE_M);
  }

  voeg(knoop: OpenFem3DNode): void {
    const s = `${KnoopZoeker.cel(knoop.x)},${KnoopZoeker.cel(knoop.y)},${KnoopZoeker.cel(knoop.z)}`;
    const lijst = this.cellen.get(s);
    if (lijst) lijst.push(knoop);
    else this.cellen.set(s, [knoop]);
  }

  zoek(p: readonly number[]): OpenFem3DNode | undefined {
    const [i0, j0, k0] = [KnoopZoeker.cel(p[0]), KnoopZoeker.cel(p[1]), KnoopZoeker.cel(p[2])];
    let beste: { knoop: OpenFem3DNode; d: number } | undefined;
    for (let i = i0 - 1; i <= i0 + 1; i += 1) {
      for (let j = j0 - 1; j <= j0 + 1; j += 1) {
        for (let k = k0 - 1; k <= k0 + 1; k += 1) {
          for (const knoop of this.cellen.get(`${i},${j},${k}`) ?? []) {
            const d = Math.hypot(knoop.x - p[0], knoop.y - p[1], knoop.z - p[2]);
            if (d <= KNOOP_TOLERANTIE_M && (!beste || d < beste.d)) beste = { knoop, d };
          }
        }
      }
    }
    return beste?.knoop;
  }
}

const aantal = (n: number, enkelvoud: string, meervoud: string) => `${n} ${n === 1 ? enkelvoud : meervoud}`;

// ── De import ───────────────────────────────────────────────────────────────

interface StaafInfo {
  beam: OpenFem3DBeam;
  record: StepRecord;
  label: string;
  trafo: Trafo;
  /** Lokale IFC-assen (globaal): x langs de staaf, z uit `Axis`, y = z × x. */
  ifcAssen: [V3, V3, V3];
  /** PIN_JOINED_MEMBER: krijgt geen vloerlast. */
  pendel: boolean;
  /** Lengte van deze staaf; bij een op tussenknopen geknipte IFC-staaf die van dit deel. */
  lengte: number;
  /**
   * Begin en eind van dit deel langs de as van de IFC-staaf, gemeten vanaf
   * haar begin. Een ongeknipte staaf loopt van 0 tot haar lengte.
   */
  ketenVan: number;
  ketenTot: number;
}

interface VlakInfo {
  record: StepRecord;
  naam: string;
  label: string;
  /** Knopen rond de buitenrand, in volgorde. */
  knopen: number[];
  soort: "schijf" | "plaat" | "lastvlak";
  horizontaal: boolean;
  hoogte: number;
  spanDirection?: OpenFem3DVector;
  /** Vaste normaal zoals bij een belastingvlak (naar beneden, anders −Y, anders −X). */
  normaal: V3;
  /** Lokale assen van het vlak (voor lasten in LOCAL_COORDS). */
  lokaalX: V3;
  lokaalZ: V3;
  /** Knopen die via IfcRelConnectsStructuralMember aan het vlak hangen. */
  gekoppeld: number[];
  /** Plaatsing van het vlak: ook die van een face van een vlaklast zonder eigen plaatsing. */
  trafo: Trafo;
  /** De buitenrand en de openingen zoals in het bestand (modelcoördinaten), om de face van een vlaklast mee te vergelijken. */
  rand: V3[];
  openingen: V3[][];
}

interface VlakLast {
  vlak: VlakInfo;
  caseId: number;
  direction: OpenFem3DLoadPanelDirection;
  q: number;
}

class Importeur {
  readonly meldingen = new Meldingen();
  readonly eenheden: Eenheden;
  readonly meetkunde: Meetkunde;
  private readonly gedeeldInv: Trafo;

  readonly nodes: OpenFem3DNode[] = [];
  readonly nodeById = new Map<number, OpenFem3DNode>();
  private readonly zoeker = new KnoopZoeker();
  private readonly knoopVanVertex = new Map<number, number>();
  readonly knoopVanConnectie = new Map<number, number>();
  private readonly aangemaakt = { staafeinden: 0, vlakhoeken: 0 };

  readonly supports: OpenFem3DSupport[] = [];
  readonly staven: StaafInfo[] = [];
  /** Per IFC-staaf haar delen in volgorde; één deel als zij niet geknipt is. */
  readonly staafVanRecord = new Map<number, StaafInfo[]>();
  readonly vlakken: VlakInfo[] = [];
  readonly vlakVanRecord = new Map<number, VlakInfo>();
  readonly diaphragms: OpenFem3DDiaphragm[] = [];
  readonly schijven: IfcImportSchijf[] = [];

  readonly loadCases: LoadCase[] = [];
  readonly gevalVanRecord = new Map<number, number>();
  selfWeightCaseId: number | undefined;
  /** Gevallen met ActionSource SYSTEM_IMPERFECTION (initiële scheefstand als knooplasten). */
  imperfectieGevallen = 0;
  /** Het geval voor de lasten van het eigengewichtgeval (dat zelf geen lasten neemt). */
  private eigenGewichtLasten: number | undefined;

  readonly loads: OpenFem3DNodalLoad[] = [];
  readonly memberLoads: OpenFem3DMemberLoad[] = [];
  readonly memberPointLoads: OpenFem3DMemberPointLoad[] = [];
  private readonly axiaal = new Map<string, { nodeId: number; caseId: number; f: V3 }>();
  private readonly vlakLasten = new Map<string, VlakLast>();
  readonly loadPanels: OpenFem3DLoadPanel[] = [];
  readonly envelopePanels: OpenFem3DEnvelopePanel[] = [];
  /** Per belastingvlak (index = id − 1) het vlak waar het vandaan komt. */
  private readonly panelBron: VlakLast[] = [];
  readonly combinations: LoadCombination[] = [];
  readonly levels: GridAxisLine[] = [];

  constructor(readonly ifc: IfcInhoud, readonly model: ModelInhoud) {
    this.eenheden = leesEenheden(ifc);
    this.meldingen.voeg("toelichting", this.eenheden.omschrijving.replace(/\.$/, ""));
    this.meetkunde = new Meetkunde(ifc, this.eenheden.lengte, (tekst) => this.meldingen.voeg("nietOndersteund", tekst));
    // Het "globale" stelsel van het analysemodel is zijn SharedPlacement.
    const gedeeld = refVan(arg(model.record, 9));
    const wereld = gedeeld === null ? IDENTITEIT : this.meetkunde.wereld(gedeeld);
    this.gedeeldInv = inverse(wereld);
    if (Math.abs(wereld.z[2] - 1) > 1e-6) {
      this.meldingen.voeg("waarschuwing",
        "De SharedPlacement van het analysemodel staat niet rechtop; z van het model is niet de verticaal van het gebouw");
    }
  }

  /** Van de eigen coördinaten van een item naar het stelsel van het analysemodel. */
  trafoVan(item: StepRecord): Trafo {
    const plaatsing = refVan(arg(item, 5));
    return plaatsing === null ? IDENTITEIT : na(this.gedeeldInv, this.meetkunde.wereld(plaatsing));
  }

  private nieuweKnoop(p: V3, naam?: string): OpenFem3DNode {
    // Een knoop op een level (afrondingsruis daargelaten) hangt eraan en ligt er
    // exact op. Dat gebeurt hier, vóór er lengtes en lastposities van afhangen.
    const level = this.levels.find((l) => Math.abs(p[2] - l.position / 1000) <= LEVEL_TOLERANTIE_M);
    const knoop: OpenFem3DNode = {
      id: this.nodes.length + 1, x: p[0], y: p[1], z: level ? level.position / 1000 : p[2],
      ...(level ? { levelId: level.id } : {}),
      ...(naam ? { name: naam } : {}),
    };
    this.nodes.push(knoop);
    this.nodeById.set(knoop.id, knoop);
    this.zoeker.voeg(knoop);
    return knoop;
  }

  /** Vertex → knoop: dezelfde IfcVertexPoint-entiteit, anders een knoop binnen 1 mm, anders een nieuwe. */
  private knoopVoorVertex(vertexId: number, trafo: Trafo, telling: "staafeinden" | "vlakhoeken"): OpenFem3DNode | null {
    const bekend = this.knoopVanVertex.get(vertexId);
    if (bekend !== undefined) return this.nodeById.get(bekend)!;
    const lokaal = this.meetkunde.vertex(vertexId);
    if (!lokaal) return null;
    const p = pas(trafo, lokaal);
    let knoop = this.zoeker.zoek(p);
    if (!knoop) {
      knoop = this.nieuweKnoop(p);
      this.aangemaakt[telling] += 1;
    }
    this.knoopVanVertex.set(vertexId, knoop.id);
    return knoop;
  }

  // ── Knopen en opleggingen ──

  knopen(): void {
    for (const connectie of this.model.connecties) {
      const naam = (tekstVan(arg(connectie, 2)) ?? "").trim();
      const label = naam ? `knoop "${naam}"` : `knoop #${connectie.id}`;
      const trafo = this.trafoVan(connectie);
      const vertexId = this.meetkunde.topologie(connectie).find((item) => item.type === "IFCVERTEXPOINT")?.id;
      const lokaal = vertexId !== undefined ? this.meetkunde.vertex(vertexId) : null;
      if (!lokaal) {
        this.meldingen.voeg("waarschuwing", "Knoop zonder topologie (IfcVertexPoint); op de oorsprong van zijn plaatsing gezet", label);
      }
      const p = pas(trafo, lokaal ?? [0, 0, 0]);
      let knoop = this.zoeker.zoek(p);
      if (knoop) {
        this.meldingen.voeg("waarschuwing", "Knopen van het analysemodel binnen 1 mm van elkaar zijn samengevoegd", label);
        if (naam && !knoop.name) knoop.name = naam;
      } else {
        knoop = this.nieuweKnoop(p, naam || undefined);
      }
      if (vertexId !== undefined) this.knoopVanVertex.set(vertexId, knoop.id);
      this.knoopVanConnectie.set(connectie.id, knoop.id);
      this.oplegging(connectie, knoop, trafo, label);
    }
  }

  private oplegging(connectie: StepRecord, knoop: OpenFem3DNode, trafo: Trafo, label: string): void {
    const conditieId = refVan(arg(connectie, 7));
    const c = condities(this.ifc, conditieId, this.eenheden, "vrij");
    if (!c) {
      if (conditieId !== null) {
        this.meldingen.voeg("nietOndersteund", "Oplegconditie van een ander type dan IfcBoundaryNodeCondition; niet ingelezen", label);
      }
      return;
    }
    if (c.some((x) => x.soort === "ongeldig")) {
      this.meldingen.voeg("waarschuwing", "Ongeldige oplegwaarde (negatieve of onbekende stijfheid); als vrij ingelezen", label);
    }
    if (c.every((x) => x.soort === "vrij" || x.soort === "ongeldig")) return;
    const stelsel = refVan(arg(connectie, 8));
    if (stelsel !== null) {
      // Alleen een richtingsafhankelijke conditie hangt van het assenstelsel af.
      const afhankelijk = !(c.slice(1, 3).every((x) => gelijkeConditie(x, c[0])) &&
        c.slice(4).every((x) => gelijkeConditie(x, c[3])));
      const s = this.meetkunde.plaatsing(stelsel);
      const globaal: Trafo = { x: draai(trafo, s.x), y: draai(trafo, s.y), z: draai(trafo, s.z), o: [0, 0, 0] };
      if (afhankelijk && !isGlobaal(globaal)) {
        this.meldingen.voeg("nietOndersteund",
          "Oplegging in een eigen, niet-globaal assenstelsel (ConditionCoordinateSystem) wordt niet ondersteund; " +
          "als globaal ingelezen, controleer de richting", label);
      }
    }
    if (this.supports.some((s) => s.nodeId === knoop.id)) {
      this.meldingen.voeg("waarschuwing", "Twee opleggingen op dezelfde knoop; de eerste is aangehouden", label);
      return;
    }
    const as = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;
    const veer = ["kxKnPerM", "kyKnPerM", "kzKnPerM", "krxKnmPerRad", "kryKnmPerRad", "krzKnmPerRad"] as const;
    const support: OpenFem3DSupport = { nodeId: knoop.id, ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };
    const springs: NonNullable<OpenFem3DSupport["springs"]> = {};
    c.forEach((x, i) => {
      if (x.soort === "vast") support[as[i]] = true;
      else if (x.soort === "veer") springs[veer[i]] = x.waarde;
    });
    if (Object.keys(springs).length > 0) support.springs = springs;
    this.supports.push(support);
  }

  // ── Staven ──

  private materiaalRecords(lid: StepRecord) {
    let r = this.ifc.get(this.ifc.materiaalVan.get(lid.id));
    let cardinalPoint: number | null = null;
    let taps = false;
    if (r?.type === "IFCMATERIALPROFILESETUSAGE" || r?.type === "IFCMATERIALPROFILESETUSAGETAPERING") {
      cardinalPoint = getalVan(arg(r, 1));
      taps = r.type === "IFCMATERIALPROFILESETUSAGETAPERING";
      r = this.ifc.get(refVan(arg(r, 0)));
    }
    let materiaalProfiel: StepRecord | undefined;
    let meerdere = false;
    if (r?.type === "IFCMATERIALPROFILESET") {
      const profielen = refsVan(arg(r, 2));
      meerdere = profielen.length > 1;
      materiaalProfiel = this.ifc.get(profielen[0] ?? null);
    } else if (r?.type === "IFCMATERIALPROFILE" || r?.type === "IFCMATERIALPROFILEWITHOFFSETS") {
      materiaalProfiel = r;
    }
    return {
      materiaal: materiaalProfiel ? this.ifc.get(refVan(arg(materiaalProfiel, 2))) : r?.type === "IFCMATERIAL" ? r : undefined,
      profiel: materiaalProfiel ? this.ifc.get(refVan(arg(materiaalProfiel, 3))) : undefined,
      cardinalPoint, taps, meerdere,
      offsets: materiaalProfiel?.type === "IFCMATERIALPROFILEWITHOFFSETS",
    };
  }

  staafLijst(): void {
    const teller = { type: 0, rond: 0, strip: 0, pendel: 0 };
    for (const lid of this.model.staven) {
      const naam = (tekstVan(arg(lid, 2)) ?? "").trim();
      const label = naam ? `staaf "${naam}"` : `staaf #${lid.id}`;
      const trafo = this.trafoVan(lid);
      const rand = this.meetkunde.topologie(lid).map((item) => this.meetkunde.rand(item)).find((r) => r !== null);
      if (!rand) {
        this.meldingen.voeg("nietOndersteund", "Staaf zonder rand (IfcEdge) in zijn topologie; niet ingelezen", label);
        continue;
      }
      if (rand.gebogen) this.meldingen.voeg("waarschuwing", "Gebogen staaf als rechte staaf tussen zijn eindpunten ingelezen", label);
      if (lid.type === "IFCSTRUCTURALCURVEMEMBERVARYING") {
        this.meldingen.voeg("nietOndersteund", "Staaf met een verlopende doorsnede (IfcStructuralCurveMemberVarying); met het eerste profiel ingelezen", label);
      }
      const start = this.knoopVoorVertex(rand.start, trafo, "staafeinden");
      const eind = this.knoopVoorVertex(rand.eind, trafo, "staafeinden");
      if (!start || !eind) {
        this.meldingen.voeg("nietOndersteund", "Staaf met een eindpunt zonder coördinaten; niet ingelezen", label);
        continue;
      }
      if (start.id === eind.id) {
        this.meldingen.voeg("nietOndersteund", "Staaf korter dan 1 mm; niet ingelezen", label);
        continue;
      }
      const lengte = Math.hypot(eind.x - start.x, eind.y - start.y, eind.z - start.z);
      const basis = openFem3DMemberAxes(start, eind, 0);
      // Lokaal z uit Axis, loodrecht op x geprojecteerd; θ = atan2(−ẑ·e_y0, ẑ·e_z0).
      let zIfc: V3 | null = null;
      const axis = this.meetkunde.richting(refVan(arg(lid, 8)));
      if (axis) {
        const a = draai(trafo, axis);
        const loodrecht = sub(a, scale(basis.ex, dot(a, basis.ex)));
        if (norm(loodrecht) > 1e-6) zIfc = unit(loodrecht);
      }
      if (!zIfc) {
        this.meldingen.voeg("waarschuwing", "Staaf zonder bruikbare Axis (ontbreekt of evenwijdig aan de staaf); rolhoek 0 aangenomen", label);
        zIfc = basis.ez;
      }
      let roll = Math.atan2(-dot(zIfc, basis.ey), dot(zIfc, basis.ez));

      const mat = this.materiaalRecords(lid);
      // Eerst het materiaal: een massieve rechthoek is alleen in staal een strip.
      let material: string | undefined;
      if (mat.materiaal) {
        const materiaalNaam = (tekstVan(arg(mat.materiaal, 0)) ?? "").trim();
        material = materiaalVan(materiaalNaam) ?? undefined;
        if (!material) {
          this.meldingen.voeg("nietOndersteund",
            `Materiaal "${materiaalNaam}" niet herkend (alleen staal S235–S460); de staaf staat zonder materiaal`, label);
        }
      } else {
        this.meldingen.voeg("nietOndersteund", "Staaf zonder materiaal in het bestand; de staaf staat zonder materiaal", label);
      }
      const profiel = profielVan(this.ifc, this.meetkunde, mat.profiel, material !== undefined,
        (soort, tekst) => this.meldingen.voeg(soort, tekst, label));
      roll += profiel.extraRol;
      // CardinalPoint 5 (midden) en 10 (zwaartepunt): de staafas is de hartlijn, zoals het model rekent.
      if (mat.cardinalPoint !== null && mat.cardinalPoint !== 5 && mat.cardinalPoint !== 10) {
        this.meldingen.voeg("nietOndersteund",
          `Profiel buiten het midden (CardinalPoint ${mat.cardinalPoint}) wordt niet ondersteund; de staaf ligt op de hartlijn`, label);
      }
      if (mat.offsets) {
        this.meldingen.voeg("nietOndersteund", "Profiel met verschuivingen (IfcMaterialProfileWithOffsets) wordt niet ondersteund; de staaf ligt op de hartlijn", label);
      }
      if (mat.taps) this.meldingen.voeg("nietOndersteund", "Verlopend profiel (IfcMaterialProfileSetUsageTapering) wordt niet ondersteund; met het beginprofiel ingelezen", label);
      if (mat.meerdere) this.meldingen.voeg("waarschuwing", "Profielset met meer dan één profiel; het eerste is aangehouden", label);

      const soort = enumVan(arg(lid, 7)) ?? "NOTDEFINED";
      let tensionOnly = false;
      if (soort === "TENSION_MEMBER" || soort === "CABLE") { tensionOnly = true; teller.type += 1; }
      else if (soort === "PIN_JOINED_MEMBER" && profiel.massiefRond) { tensionOnly = true; teller.rond += 1; }
      else if (soort === "PIN_JOINED_MEMBER" && profiel.platteStrip) { tensionOnly = true; teller.strip += 1; }
      else if (soort === "PIN_JOINED_MEMBER") teller.pendel += 1;
      else if (soort === "COMPRESSION_MEMBER") {
        this.meldingen.voeg("nietOndersteund", "Druk-alleen staaf (COMPRESSION_MEMBER) wordt niet ondersteund; als gewone staaf ingelezen", label);
      }
      const onderdeel = (this.ifc.eigenschappen.get(lid.id) ?? [])
        .find((e) => e.naam.trim().toLowerCase() === "onderdeel" && typeof e.waarde === "string" && e.waarde.trim() !== "");
      const group = (typeof onderdeel?.waarde === "string" ? onderdeel.waarde : tekstVan(arg(lid, 4)) ?? "").trim();
      const beam: OpenFem3DBeam = {
        id: this.staven.length + 1,
        startNodeId: start.id,
        endNodeId: eind.id,
        ...(profiel.naam ? { profileName: profiel.naam } : {}),
        ...(material ? { material } : {}),
        ...(Math.abs(roll) > 1e-12 ? { rollAngleRad: roll } : {}),
        ...(tensionOnly ? { tensionOnly: true } : {}),
        ...(naam ? { name: naam } : {}),
        ...(group ? { group } : {}),
      };
      const info: StaafInfo = {
        beam, record: lid, label, trafo, lengte, ketenVan: 0, ketenTot: lengte,
        ifcAssen: [basis.ex, cross(zIfc, basis.ex), zIfc],
        pendel: soort === "PIN_JOINED_MEMBER",
      };
      this.staven.push(info);
      this.staafVanRecord.set(lid.id, [info]);
    }
    if (this.aangemaakt.staafeinden > 0) {
      this.meldingen.voeg("toelichting",
        `${aantal(this.aangemaakt.staafeinden, "staafeinde had", "staafeinden hadden")} geen eigen knoop ` +
        "(IfcStructuralPointConnection) en kreeg een knoop op zijn eindpunt");
    }
    if (teller.type + teller.rond + teller.strip + teller.pendel > 0) {
      this.meldingen.voeg("toelichting",
        `Trek-alleen: ${aantal(teller.type + teller.rond + teller.strip, "staaf", "staven")}, namelijk ${teller.type} als TENSION_MEMBER of CABLE, ` +
        `${aantal(teller.rond, "pendelstaaf", "pendelstaven")} (PIN_JOINED_MEMBER) van massief rond staal ` +
        `en ${aantal(teller.strip, "pendelstaaf", "pendelstaven")} van platte strip (dikte ≤ ¼ breedte). ` +
        `${aantal(teller.pendel, "pendelstaaf", "pendelstaven")} met een ander profiel (zoals een koker als schoor of een gedrongen strip) ` +
        `${teller.pendel === 1 ? "neemt" : "nemen"} ook druk op; de scharnieren komen dan uit de eindcondities`);
    }
  }

  // ── Tussenknopen ──

  private connectieLabel(id: number): string {
    const naam = (tekstVan(arg(this.ifc.get(id), 2)) ?? "").trim();
    return naam ? `knoop "${naam}"` : `knoop #${id}`;
  }

  /**
   * Een staaf die via IfcRelConnectsStructuralMember ook tussen haar
   * eindpunten aan een knoop hangt (een doorgaande ligger over een kolom of
   * een tussensteunpunt), wordt op die knopen geknipt; anders liggen ligger en
   * kolom los van elkaar. De delen houden profiel, materiaal, rolhoek, naam en
   * groep en zijn op de tussenknopen star verbonden. Daarna zijn de staven
   * weer doorlopend genummerd (lasten bestaan dan nog niet).
   */
  tussenknopen(): void {
    const delen: StaafInfo[] = [];
    for (const info of this.staven) {
      const a = this.nodeById.get(info.beam.startNodeId)!, b = this.nodeById.get(info.beam.endNodeId)!;
      const ex = info.ifcAssen[0];
      const knippunten = new Map<number, number>();
      for (const koppeling of this.ifc.staafKoppelingen.get(info.record.id) ?? []) {
        const connectieId = refVan(arg(koppeling, 5));
        const knoopId = this.knoopVanConnectie.get(connectieId ?? -1);
        if (connectieId === null || knoopId === undefined || knoopId === a.id || knoopId === b.id) continue;
        const label = `${info.label} bij ${this.connectieLabel(connectieId)}`;
        const k = this.nodeById.get(knoopId)!;
        const rel = sub([k.x, k.y, k.z], [a.x, a.y, a.z]);
        const s = dot(rel, ex);
        if (norm(sub(rel, scale(ex, s))) > KNOOP_TOLERANTIE_M || s < -KNOOP_TOLERANTIE_M || s > info.lengte + KNOOP_TOLERANTIE_M) {
          this.meldingen.voeg("waarschuwing", "Aansluiting op een knoop die niet op de staaf ligt; genegeerd", label);
          continue;
        }
        if (s <= KNOOP_TOLERANTIE_M || s >= info.lengte - KNOOP_TOLERANTIE_M) {
          this.meldingen.voeg("waarschuwing", "Aansluiting op een knoop binnen 1 mm van een staafeinde; genegeerd", label);
          continue;
        }
        knippunten.set(knoopId, s);
        const c = condities(this.ifc, refVan(arg(koppeling, 6)), this.eenheden, "vast");
        if (c?.some((x) => x.soort === "vrij" || x.soort === "veer")) {
          this.meldingen.voeg("nietOndersteund",
            "Scharnier, veer of vrijheid in een aansluiting tussen de staafeinden wordt niet ondersteund; de staaf loopt daar star door",
            label);
        }
        if (c?.some((x) => x.soort === "ongeldig")) {
          this.meldingen.voeg("waarschuwing", "Ongeldige waarde in een staafaansluiting; als star ingelezen", label);
        }
      }
      if (knippunten.size === 0) {
        delen.push(info);
        continue;
      }
      const punten = [...knippunten].sort((p, q) => p[1] - q[1]);
      const knopen = [a.id, ...punten.map(([id]) => id), b.id];
      const posities = [0, ...punten.map(([, s]) => s), info.lengte];
      for (let i = 0; i + 1 < knopen.length; i += 1) {
        const p = this.nodeById.get(knopen[i])!, q = this.nodeById.get(knopen[i + 1])!;
        delen.push({
          ...info,
          beam: { ...info.beam, startNodeId: p.id, endNodeId: q.id },
          lengte: Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z),
          ketenVan: posities[i],
          ketenTot: posities[i + 1],
        });
      }
      this.meldingen.voeg("toelichting",
        "Staaf met een aansluiting tussen haar eindpunten (een doorgaande staaf) is op die tussenknopen geknipt; " +
        "de delen houden profiel, materiaal, rolhoek en naam en zijn daar star verbonden",
        `${info.label} (${aantal(knopen.length - 1, "deel", "delen")})`);
    }
    // Twee staven tussen dezelfde knopen tellen allebei mee in de stijfheid.
    const tussen = new Map<string, string>();
    for (const d of delen) {
      const sleutel = [d.beam.startNodeId, d.beam.endNodeId].sort((p, q) => p - q).join("|");
      const eerder = tussen.get(sleutel);
      if (eerder === undefined) tussen.set(sleutel, d.label);
      else {
        this.meldingen.voeg("waarschuwing", "Twee staven tussen dezelfde knopen; allebei ingelezen, ze tellen allebei mee in de stijfheid",
          `${eerder} en ${d.label}`);
      }
    }
    delen.forEach((d, i) => { d.beam.id = i + 1; });
    this.staven.splice(0, this.staven.length, ...delen);
    this.staafVanRecord.clear();
    for (const d of delen) this.staafVanRecord.set(d.record.id, [...(this.staafVanRecord.get(d.record.id) ?? []), d]);
  }

  // ── Eindscharnieren ──

  /**
   * Per IFC-staaf de voorwaarden aan haar twee einden. Bij een geknipte staaf
   * gaan de scharnieren van het begin naar het eerste deel en die van het eind
   * naar het laatste; een aansluiting tussen de einden is bij de tussenknopen
   * verwerkt.
   */
  eindscharnieren(): void {
    const geenScharnieren = (): OpenFem3DEndReleases => ({
      myStart: false, myEnd: false, mzStart: false, mzEnd: false, torsionStart: false, torsionEnd: false,
    });
    for (const delen of this.staafVanRecord.values()) {
      const eerste = delen[0], laatste = delen[delen.length - 1];
      const { label, record, ifcAssen, trafo } = eerste;
      const startId = eerste.beam.startNodeId, eindId = laatste.beam.endNodeId;
      const releases = geenScharnieren();
      const assen = openFem3DMemberAxes(this.nodeById.get(startId)!, this.nodeById.get(eindId)!, eerste.beam.rollAngleRad ?? 0);
      for (const koppeling of this.ifc.staafKoppelingen.get(record.id) ?? []) {
        if (koppeling.type === "IFCRELCONNECTSWITHECCENTRICITY") {
          this.meldingen.voeg("nietOndersteund", "Excentrische aansluiting (IfcRelConnectsWithEccentricity) wordt niet ondersteund; centrisch ingelezen", label);
        }
        if (refVan(arg(koppeling, 7)) !== null) {
          this.meldingen.voeg("nietOndersteund", "Aanvullende aansluitvoorwaarden (AdditionalConditions) worden niet ondersteund; genegeerd", label);
        }
        const knoopId = this.knoopVanConnectie.get(refVan(arg(koppeling, 5)) ?? -1);
        if (knoopId === undefined) continue;
        const kant = knoopId === startId ? "Start" : knoopId === eindId ? "End" : null;
        if (!kant) continue;
        const c = condities(this.ifc, refVan(arg(koppeling, 6)), this.eenheden, "vast");
        if (!c) continue;
        const kantLabel = `${label} (${kant === "Start" ? "begin" : "eind"})`;
        if (c.slice(0, 3).some((x) => x.soort === "vrij" || x.soort === "veer")) {
          this.meldingen.voeg("nietOndersteund",
            "Translatievrijheid of -veer aan een staafeinde wordt niet ondersteund; het staafeinde is star verbonden", kantLabel);
        }
        if (c.slice(3).some((x) => x.soort === "veer")) {
          this.meldingen.voeg("nietOndersteund", "Rotatieveer aan een staafeinde wordt niet ondersteund; als star ingelezen", kantLabel);
        }
        if (c.some((x) => x.soort === "ongeldig")) {
          this.meldingen.voeg("waarschuwing", "Ongeldige waarde in een staafaansluiting; als star ingelezen", kantLabel);
        }
        // Assen van de voorwaarde (globaal): het ConditionCoordinateSystem, anders de lokale staafassen.
        let voorwaardeAssen: V3[] = ifcAssen;
        const stelselId = refVan(arg(koppeling, 9));
        if (stelselId !== null) {
          const s = this.meetkunde.plaatsing(stelselId);
          voorwaardeAssen = [draai(trafo, s.x), draai(trafo, s.y), draai(trafo, s.z)];
          const samen = voorwaardeAssen.every((as, i) => Math.abs(Math.abs(dot(as, ifcAssen[i])) - 1) < 1e-6);
          if (!samen) {
            this.meldingen.voeg("waarschuwing",
              "Het assenstelsel van een staafaansluiting valt niet samen met het lokale stelsel van de staaf; " +
              "de vrije rotaties zijn op de lokale assen geprojecteerd", kantLabel);
          }
        }
        // Vrije rotaties op de lokale assen van het model projecteren: een lokale as is vrij
        // als hij (overwegend) in de ruimte van de vrije rotatie-assen ligt.
        const vrij = voorwaardeAssen.filter((_, i) => c[3 + i].soort === "vrij");
        const velden = kant === "Start"
          ? (["torsionStart", "myStart", "mzStart"] as const)
          : (["torsionEnd", "myEnd", "mzEnd"] as const);
        [assen.ex, assen.ey, assen.ez].forEach((as, i) => {
          const aandeel = vrij.reduce((som, f) => som + dot(as, f) ** 2, 0);
          if (aandeel > 1e-6 && aandeel < 1 - 1e-6) {
            this.meldingen.voeg("waarschuwing",
              "Vrije rotatie niet evenwijdig aan een lokale staafas; afgerond naar de dichtstbijzijnde as", kantLabel);
          }
          if (aandeel > 0.5) releases[velden[i]] = true;
        });
      }
      if (releases.torsionStart && releases.torsionEnd) {
        releases.torsionStart = false;
        this.meldingen.voeg("waarschuwing",
          "Beide staafeinden vrij in torsie is een mechanisme; torsie aan het begin is vastgezet", label);
      }
      if (!Object.values(releases).some(Boolean)) continue;
      if (delen.length === 1) {
        eerste.beam.releases = releases;
        continue;
      }
      if (releases.myStart || releases.mzStart || releases.torsionStart) {
        eerste.beam.releases = {
          ...geenScharnieren(), myStart: releases.myStart, mzStart: releases.mzStart, torsionStart: releases.torsionStart,
        };
      }
      if (releases.myEnd || releases.mzEnd || releases.torsionEnd) {
        laatste.beam.releases = {
          ...geenScharnieren(), myEnd: releases.myEnd, mzEnd: releases.mzEnd, torsionEnd: releases.torsionEnd,
        };
      }
    }
  }

  // ── Vlakken ──

  /** De punten van een lus (in modelcoördinaten), zonder knopen te maken. */
  private lusPunten(bound: StepRecord, trafo: Trafo): V3[] | null {
    const lus = this.ifc.get(refVan(arg(bound, 0)));
    const lokaal: (V3 | null)[] = lus?.type === "IFCEDGELOOP"
      ? refsVan(arg(lus, 0)).map((id) => {
          const r = this.meetkunde.rand(this.ifc.get(id));
          return r ? this.meetkunde.vertex(r.start) : null;
        })
      : lus?.type === "IFCPOLYLOOP" ? refsVan(arg(lus, 0)).map((id) => this.meetkunde.punt(id)) : [null];
    if (lokaal.some((p) => p === null)) return null;
    return (lokaal as V3[]).map((p) => pas(trafo, p));
  }

  /** De knopen van een lus (in volgorde); maakt een knoop voor een hoek zonder knoop. */
  private lus(bound: StepRecord, trafo: Trafo): { knopen: number[]; punten: V3[] } | null {
    const lus = this.ifc.get(refVan(arg(bound, 0)));
    const knopen: number[] = [];
    if (lus?.type === "IFCEDGELOOP") {
      for (const id of refsVan(arg(lus, 0))) {
        const r = this.meetkunde.rand(this.ifc.get(id));
        const knoop = r ? this.knoopVoorVertex(r.start, trafo, "vlakhoeken") : null;
        if (!knoop) return null;
        knopen.push(knoop.id);
      }
    } else if (lus?.type === "IFCPOLYLOOP") {
      for (const id of refsVan(arg(lus, 0))) {
        const lokaal = this.meetkunde.punt(id);
        if (!lokaal) return null;
        const p = pas(trafo, lokaal);
        let knoop = this.zoeker.zoek(p);
        if (!knoop) {
          knoop = this.nieuweKnoop(p);
          this.aangemaakt.vlakhoeken += 1;
        }
        knopen.push(knoop.id);
      }
    } else return null;
    // Samengevallen hoeken (binnen 1 mm) eruit, en een lus die terugkeert naar de start.
    const schoon = knopen.filter((k, i) => i === 0 || k !== knopen[i - 1]);
    if (schoon.length > 1 && schoon[0] === schoon[schoon.length - 1]) schoon.pop();
    if (janeeVan(arg(bound, 1)) === false) schoon.reverse();
    if (schoon.length < 3) return null;
    return { knopen: schoon, punten: schoon.map((id) => { const k = this.nodeById.get(id)!; return [k.x, k.y, k.z] as V3; }) };
  }

  /** OpenFEM-schil uit een bouwkundig IfcCovering, zonder rekenstijfheid. */
  schilpanelen(): void {
    for (const covering of this.ifc.vanType("IFCCOVERING")) {
      const props = (this.ifc.eigenschappen.get(covering.id) ?? [])
        .filter((property) => property.pset === "OpenFEM3D_Schilpaneel");
      if (props.length === 0) continue;
      const property = (naam: string) => props.find((item) => item.naam === naam)?.waarde;
      const items = this.meetkunde.topologie(covering);
      const faces = items.flatMap((item) => item.type === "IFCFACEBASEDSURFACEMODEL"
          ? refsVan(arg(item, 0)).flatMap((setId) => refsVan(arg(this.ifc.get(setId), 0)))
            .map((id) => this.ifc.get(id)).filter((face): face is StepRecord => !!face)
          : item.type === "IFCFACE" ? [item] : []);
      const face = faces[0];
      if (!face) {
        this.meldingen.voeg("nietOndersteund", "Schilpaneel zonder leesbaar IFC-vlak overgeslagen");
        continue;
      }
      const bounds = refsVan(arg(face, 0)).map((id) => this.ifc.get(id))
        .filter((bound): bound is StepRecord => !!bound);
      const outer = bounds.find((bound) => bound.type === "IFCFACEOUTERBOUND");
      const trafo = this.trafoVan(covering);
      const boundary = outer ? this.lus(outer, trafo) : null;
      if (!boundary) {
        this.meldingen.voeg("nietOndersteund", "Schilpaneel met onleesbare buitenrand overgeslagen");
        continue;
      }
      const openings = bounds.filter((bound) => bound !== outer).map((bound, index) => {
        const loop = this.lus(bound, trafo);
        return loop ? { id: index + 1, nodeIds: loop.knopen } : null;
      });
      if (openings.some((opening) => !opening)) {
        this.meldingen.voeg("nietOndersteund", "Schilpaneel met onleesbare opening overgeslagen");
        continue;
      }
      const rawSpan = property("Overspanningsrichting");
      const spanParts = typeof rawSpan === "string" ? rawSpan.split(",").map(Number) : [];
      const spanDirection = spanParts.length === 3 && spanParts.every(Number.isFinite)
        ? { x: spanParts[0], y: spanParts[1], z: spanParts[2] } : undefined;
      const distribution = property("Afdracht") === "oneWay" && spanDirection ? "oneWay" : "twoWay";
      const weight = property("BekledingsgewichtKNPerM2");
      this.envelopePanels.push({
        id: this.envelopePanels.length + 1,
        nodeIds: boundary.knopen,
        type: property("Type") === "roof" || enumVan(arg(covering, 8)) === "ROOFING" ? "roof" : "facade",
        distribution,
        ...(spanDirection ? { spanDirection } : {}),
        ...(property("BuitenwaartsOmgekeerd") === true ? { flipOuterSide: true } : {}),
        ...(openings.length ? { openings: openings as { id: number; nodeIds: number[] }[] } : {}),
        ...(typeof weight === "number" ? { claddingWeightKnPerM2: weight } : {}),
        ...((tekstVan(arg(covering, 2)) ?? "").trim() ? { name: tekstVan(arg(covering, 2))!.trim() } : {}),
      });
    }
  }

  vlakLijst(): void {
    for (const vlak of this.model.vlakken) {
      const naam = (tekstVan(arg(vlak, 2)) ?? "").trim() || `vlak #${vlak.id}`;
      const label = `vlak "${naam}"`;
      const trafo = this.trafoVan(vlak);
      const faces = this.meetkunde.topologie(vlak).filter((item) => item.type === "IFCFACESURFACE" || item.type === "IFCFACE");
      if (faces.length === 0) {
        this.meldingen.voeg("nietOndersteund", "Vlak zonder vlaktopologie (IfcFaceSurface); niet ingelezen", label);
        continue;
      }
      if (faces.length > 1) this.meldingen.voeg("waarschuwing", "Vlak met meer dan één face; alleen de eerste is ingelezen", label);
      const face = faces[0];
      const randen = refsVan(arg(face, 0)).map((id) => this.ifc.get(id)).filter((r): r is StepRecord => !!r);
      // De buitenrand: IfcFaceOuterBound, anders de lus met het grootste oppervlak.
      // Alleen van de buitenrand worden knopen gemaakt; een opening heeft er geen nodig.
      const buiten = randen.find((r) => r.type === "IFCFACEOUTERBOUND")
        ?? randen.slice().sort((a, b) => {
          const opp = (r: StepRecord) => { const l = this.lusPunten(r, trafo); return l ? norm(newell(l)) : 0; };
          return opp(b) - opp(a);
        })[0];
      const buitenLus = buiten ? this.lus(buiten, trafo) : null;
      if (!buitenLus) {
        this.meldingen.voeg("nietOndersteund", "Vlak waarvan de buitenrand niet te lezen is (geen IfcEdgeLoop of IfcPolyLoop); niet ingelezen", label);
        continue;
      }
      const openingen = randen.filter((r) => r !== buiten).length;
      if (openingen > 0) {
        this.meldingen.voeg("nietOndersteund",
          "Opening in een vlak: een belastingvlak kent geen openingen, dus de last ligt ook op de opening (te veel last) en een schijf loopt door",
          `${label} (${aantal(openingen, "opening", "openingen")})`);
      }
      const n = newell(buitenLus.punten);
      if (norm(n) / 2 <= 1e-9) {
        this.meldingen.voeg("nietOndersteund", "Vlak zonder oppervlakte; niet ingelezen", label);
        continue;
      }
      const hoogte = buitenLus.punten.reduce((s, p) => s + p[2], 0) / buitenLus.punten.length;
      const horizontaal = buitenLus.punten.every((p) => Math.abs(p[2] - hoogte) <= KNOOP_TOLERANTIE_M);
      let lokaalZ = unit(n), lokaalX = unit(sub(buitenLus.punten[1], buitenLus.punten[0]));
      const drager = this.ifc.get(refVan(arg(face, 1)));
      if (face.type === "IFCFACESURFACE" && drager?.type === "IFCPLANE") {
        const p = this.meetkunde.plaatsing(refVan(arg(drager, 0)));
        lokaalZ = scale(draai(trafo, p.z), janeeVan(arg(face, 2)) === false ? -1 : 1);
        lokaalX = draai(trafo, p.x);
      }
      const typeNaam = enumVan(arg(vlak, 7)) ?? "NOTDEFINED";
      let soort: VlakInfo["soort"] = "lastvlak";
      if (typeNaam === "MEMBRANE_ELEMENT") {
        if (horizontaal) soort = "schijf";
        else {
          this.meldingen.voeg("nietOndersteund",
            "Membraanvlak dat niet horizontaal ligt (wand of schuin vlak): geen schijfwerking; alleen de lasten erop zijn ingelezen", label);
        }
      } else if (typeNaam === "SHELL" || typeNaam === "SHELL_ELEMENT" || typeNaam === "BENDING_ELEMENT") {
        soort = "plaat";
        this.meldingen.voeg("nietOndersteund",
          `Vlak met buigstijfheid (${typeNaam}) wordt niet als plaat geïmporteerd; alleen de lasten erop gaan als belastingvlak mee`, label);
      }
      let spanDirection: OpenFem3DVector | undefined;
      const span = (this.ifc.eigenschappen.get(vlak.id) ?? [])
        .find((e) => /overspanningsrichting|spandirection|span direction/i.test(e.naam));
      if (span && typeof span.waarde === "string") {
        const x = /(^|[^a-z])x([^a-z]|$)/i.test(span.waarde), y = /(^|[^a-z])y([^a-z]|$)/i.test(span.waarde);
        if (x !== y) spanDirection = x ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
        else {
          this.meldingen.voeg("waarschuwing",
            `Overspanningsrichting "${span.waarde}" noemt niet precies één van X en Y; afdracht in twee richtingen`, label);
        }
      }
      const gekoppeld = (this.ifc.staafKoppelingen.get(vlak.id) ?? [])
        .map((k) => this.knoopVanConnectie.get(refVan(arg(k, 5)) ?? -1))
        .filter((id): id is number => id !== undefined);
      const info: VlakInfo = {
        record: vlak, naam, label, knopen: buitenLus.knopen, soort, horizontaal, hoogte,
        ...(spanDirection ? { spanDirection } : {}),
        normaal: canoniekeNormaal(unit(n)), lokaalX, lokaalZ, gekoppeld,
        trafo,
        rand: this.lusPunten(buiten!, trafo) ?? buitenLus.punten,
        openingen: randen.filter((r) => r !== buiten).map((r) => this.lusPunten(r, trafo)).filter((l): l is V3[] => l !== null),
      };
      this.vlakken.push(info);
      this.vlakVanRecord.set(vlak.id, info);
    }
    for (const andere of this.model.andere) {
      this.meldingen.voeg("nietOndersteund",
        "Lijn- en vlakopleggingen (IfcStructuralCurveConnection, IfcStructuralSurfaceConnection) worden niet ondersteund; niet ingelezen",
        `"${(tekstVan(arg(andere, 2)) ?? "").trim() || `#${andere.id}`}"`);
    }
  }

  // ── Schijven: per hoogte de membraanvlakken die knopen delen ──

  schijfLijst(): void {
    const schijfVlakken = this.vlakken.filter((v) => v.soort === "schijf");
    if (schijfVlakken.length === 0) return;
    // Knopen van een vlak: de buitenrand, de gekoppelde knopen en elke knoop op die hoogte in of op de rand.
    const sets = schijfVlakken.map((v) => {
      const set = new Set<number>([...v.knopen, ...v.gekoppeld]);
      const veelhoek = v.knopen.map((id): [number, number] => [this.nodeById.get(id)!.x, this.nodeById.get(id)!.y]);
      for (const knoop of this.nodes) {
        if (Math.abs(knoop.z - v.hoogte) <= KNOOP_TOLERANTIE_M && puntInVeelhoek([knoop.x, knoop.y], veelhoek, KNOOP_TOLERANTIE_M)) {
          set.add(knoop.id);
        }
      }
      return set;
    });
    // Samenhangende componenten (union-find): vlakken op dezelfde hoogte die een knoop delen.
    const ouder = schijfVlakken.map((_, i) => i);
    const wortel = (i: number): number => (ouder[i] === i ? i : (ouder[i] = wortel(ouder[i])));
    for (let i = 0; i < schijfVlakken.length; i += 1) {
      for (let j = i + 1; j < schijfVlakken.length; j += 1) {
        if (Math.abs(schijfVlakken[i].hoogte - schijfVlakken[j].hoogte) > KNOOP_TOLERANTIE_M) continue;
        if ([...sets[i]].some((id) => sets[j].has(id))) ouder[wortel(i)] = wortel(j);
      }
    }
    const groepen = new Map<number, number[]>();
    schijfVlakken.forEach((_, i) => groepen.set(wortel(i), [...(groepen.get(wortel(i)) ?? []), i]));
    const volgorde = [...groepen.values()]
      .sort((a, b) => schijfVlakken[a[0]].hoogte - schijfVlakken[b[0]].hoogte || a[0] - b[0]);
    const hoogteTekst = (h: number) => `${h < -5e-4 ? "−" : "+"}${Math.abs(h).toFixed(3)}`;
    const perHoogte = new Map<string, number>();
    for (const groep of volgorde) perHoogte.set(hoogteTekst(schijfVlakken[groep[0]].hoogte), (perHoogte.get(hoogteTekst(schijfVlakken[groep[0]].hoogte)) ?? 0) + 1);
    const volgnummer = new Map<string, number>();
    for (const groep of volgorde) {
      const hoogte = schijfVlakken[groep[0]].hoogte;
      const knopen = [...new Set(groep.flatMap((i) => [...sets[i]]))].sort((a, b) => a - b);
      if (knopen.length < 2) continue;
      const tekst = hoogteTekst(hoogte);
      const n = (volgnummer.get(tekst) ?? 0) + 1;
      volgnummer.set(tekst, n);
      const naam = `Schijf ${tekst}${(perHoogte.get(tekst) ?? 1) > 1 ? ` (${n})` : ""}`;
      const id = this.diaphragms.length + 1;
      this.diaphragms.push({ id, nodeIds: knopen, name: naam });
      this.schijven.push({ id, naam, hoogteM: hoogte, knopen: knopen.length, vlakken: groep.map((i) => schijfVlakken[i].naam) });
    }
    this.meldingen.voeg("waarschuwing",
      `De membraanstijfheid van ${aantal(schijfVlakken.length, "vlak", "vlakken")} is benaderd als starre schijf ` +
      `(${aantal(this.diaphragms.length, "schijf", "schijven")}): de knopen verplaatsen in het horizontale vlak als één star lichaam`);
  }

  // ── Belastinggevallen ──

  gevallen(): void {
    for (const g of this.model.gevallen) {
      const id = this.loadCases.length + 1;
      const naam = (tekstVan(arg(g, 2)) ?? "").trim() || `Belastinggeval ${id}`;
      const label = `geval "${naam}"`;
      const bron = enumVan(arg(g, 7));
      const type = gevalType(enumVan(arg(g, 6)), bron);
      const geval: LoadCase = { id, name: naam, type };
      if (bron === "SYSTEM_IMPERFECTION") {
        this.imperfectieGevallen += 1;
        // Het kenmerk: de UGT-toets zet zo'n geval op factor 0 (zie LoadCase).
        geval.imperfectie = true;
      } else if (type === "other") {
        this.meldingen.voeg("waarschuwing",
          "Belastinggeval zonder herkenbaar type (ActionType/ActionSource); als \"overig\" ingelezen, kies het type zelf", label);
      }
      if (this.model.losseGroepen.includes(g)) {
        this.meldingen.voeg("waarschuwing", "Lastgroep (LOAD_GROUP) die bij geen belastinggeval hoort; als eigen geval ingelezen", label);
      }
      const coefficient = getalVan(arg(g, 8));
      if (coefficient !== null && Math.abs(coefficient - 1) > 1e-9) {
        this.meldingen.voeg("nietOndersteund", `Factor (Coefficient ${NL(coefficient)}) op een belastinggeval wordt niet ondersteund; genegeerd`, label);
      }
      const swc = g.type === "IFCSTRUCTURALLOADCASE" ? arg(g, 10) : null;
      if (Array.isArray(swc)) {
        const c = [0, 1, 2].map((i) => getalVan(swc[i] ?? null) ?? 0);
        const gewicht = Math.abs(c[0]) < 1e-9 && Math.abs(c[1]) < 1e-9 && Math.abs(c[2] + 1) < 1e-9;
        if (gewicht && type === "dead" && this.selfWeightCaseId === undefined) {
          geval.eigenGewicht = true;
          this.selfWeightCaseId = id;
        } else if (gewicht && this.selfWeightCaseId !== undefined) {
          this.meldingen.voeg("waarschuwing",
            "Tweede geval met eigen gewicht (SelfWeightCoefficients); alleen het eerste krijgt het automatische eigen gewicht", label);
        } else if (gewicht) {
          this.meldingen.voeg("nietOndersteund", "Eigen gewicht (SelfWeightCoefficients) in een geval dat niet blijvend is; niet overgenomen", label);
        } else if (c.some((x) => Math.abs(x) > 1e-12)) {
          this.meldingen.voeg("nietOndersteund",
            `Eigen gewicht met coëfficiënten (${c.map((x) => NL(x)).join("; ")}) wordt niet ondersteund; ` +
            "alleen (0; 0; −1) geeft het automatische eigen gewicht", label);
        }
      }
      this.loadCases.push(geval);
      this.gevalVanRecord.set(g.id, id);
    }
    if (this.imperfectieGevallen > 0) {
      this.meldingen.voeg("waarschuwing",
        `${aantal(this.imperfectieGevallen, "imperfectiegeval", "imperfectiegevallen")} (SYSTEM_IMPERFECTION) ingelezen; ` +
        "zet de scheefstand van de app uit om dubbeltelling te voorkomen (in het geïmporteerde project staat hij uit). " +
        "De UGT-toets rekent altijd met de scheefstand van de projectinstelling en telt deze gevallen daarom met factor 0")
    }
    if (this.selfWeightCaseId !== undefined) {
      this.meldingen.voeg("toelichting",
        `Geval "${this.loadCases[this.selfWeightCaseId - 1].name}" draagt het automatische eigen gewicht (ρ·A·g per staaf); eigen gewicht staat aan`);
      if (this.vlakken.some((v) => v.soort !== "lastvlak")) {
        this.meldingen.voeg("waarschuwing",
          "Het automatische eigen gewicht telt alleen de staven; het gewicht van vloeren en platen (schijven, platen) zit er niet in. " +
          "Voeg het zo nodig toe als belastingvlak");
      }
    }
  }

  /**
   * Het geval waarin een last van geval `caseId` komt. Het geval met het
   * automatische eigen gewicht neemt zelf geen lasten: die gaan naar een eigen
   * geval "… (lasten)" dat in elke combinatie dezelfde factor krijgt.
   */
  private doelGeval(caseId: number): number {
    if (caseId !== this.selfWeightCaseId) return caseId;
    if (this.eigenGewichtLasten === undefined) {
      const naam = this.loadCases[caseId - 1].name;
      this.eigenGewichtLasten = this.loadCases.length + 1;
      this.loadCases.push({ id: this.eigenGewichtLasten, name: `${naam} (lasten)`, type: "dead" });
      this.meldingen.voeg("toelichting",
        `Geval "${naam}" draagt het automatische eigen gewicht én lasten; die lasten staan in het geval "${naam} (lasten)" ` +
        "met dezelfde combinatiefactoren");
    }
    return this.eigenGewichtLasten;
  }

  private voegAxiaal(nodeId: number, caseId: number, f: V3): void {
    const sleutel = `${nodeId}|${caseId}`;
    const bestaand = this.axiaal.get(sleutel);
    if (bestaand) bestaand.f = add(bestaand.f, f);
    else this.axiaal.set(sleutel, { nodeId, caseId, f });
  }

  private actiesVan(groep: number, bezocht: Set<number>): StepRecord[] {
    if (bezocht.has(groep)) return [];
    bezocht.add(groep);
    const uit: StepRecord[] = [];
    for (const t of this.ifc.leden(groep)) {
      const r = this.ifc.get(t.obj);
      if (!r) continue;
      if (T.acties.has(r.type)) uit.push(r);
      else if (T.lastgroepen.has(r.type) && enumVan(arg(r, 5)) !== "LOAD_COMBINATION") uit.push(...this.actiesVan(r.id, bezocht));
    }
    return uit;
  }

  // ── Lasten ──

  lasten(): void {
    for (const g of this.model.gevallen) {
      const caseId = this.gevalVanRecord.get(g.id)!;
      const gevalNaam = this.loadCases[caseId - 1].name;
      for (const actie of this.actiesVan(g.id, new Set())) {
        const actieNaam = (tekstVan(arg(actie, 2)) ?? "").trim();
        const label = `last ${actieNaam ? `"${actieNaam}" ` : ""}in geval "${gevalNaam}"`;
        const element = this.ifc.get(this.ifc.aangrijping.get(actie.id));
        const last = this.ifc.get(refVan(arg(actie, 7)));
        if (!element) {
          this.meldingen.voeg("nietOndersteund", "Last zonder aangrijpingspunt (IfcRelConnectsStructuralActivity); niet ingelezen", label);
          continue;
        }
        if (!last) {
          this.meldingen.voeg("nietOndersteund", "Last zonder waarde (AppliedLoad); niet ingelezen", label);
          continue;
        }
        if (last.type === "IFCSTRUCTURALLOADCONFIGURATION") {
          this.meldingen.voeg("nietOndersteund", "Verlopende last (IfcStructuralLoadConfiguration) wordt niet ondersteund; niet ingelezen", label);
          continue;
        }
        const lokaal = enumVan(arg(actie, 8)) === "LOCAL_COORDS";
        if (actie.type === "IFCSTRUCTURALPOINTACTION") this.puntlast(actie, last, element, caseId, lokaal, label);
        else if (actie.type === "IFCSTRUCTURALCURVEACTION" || actie.type === "IFCSTRUCTURALLINEARACTION") {
          this.lijnlast(actie, last, element, caseId, lokaal, label);
        } else this.vlaklast(actie, last, element, caseId, lokaal, label);
      }
    }
    for (const { nodeId, caseId, f } of this.axiaal.values()) {
      if (norm(f) <= KLEIN) continue;
      this.loads.push({ id: this.loads.length + 1, nodeId, caseId, fx: f[0], fy: f[1], fz: f[2], mx: 0, my: 0, mz: 0 });
    }
  }

  private puntlast(actie: StepRecord, last: StepRecord, element: StepRecord, caseId: number, lokaal: boolean, label: string): void {
    if (last.type !== "IFCSTRUCTURALLOADSINGLEFORCE" && last.type !== "IFCSTRUCTURALLOADSINGLEFORCEWARPING") {
      this.meldingen.voeg("nietOndersteund",
        `Puntbelasting van het type ${ifcNaam(last.type)} (zoals een opgelegde verplaatsing) wordt niet ondersteund; niet ingelezen`, label);
      return;
    }
    const f = [1, 2, 3].map((i) => (getalVan(arg(last, i)) ?? 0) * this.eenheden.kracht) as V3;
    const m = [4, 5, 6].map((i) => (getalVan(arg(last, i)) ?? 0) * this.eenheden.moment) as V3;
    if ([...f, ...m].every((x) => Math.abs(x) <= KLEIN)) return;
    if (element.type === T.puntConnectie) {
      const nodeId = this.knoopVanConnectie.get(element.id);
      if (nodeId === undefined) {
        this.meldingen.voeg("nietOndersteund", "Last op een knoop buiten dit analysemodel; niet ingelezen", label);
        return;
      }
      if (lokaal && refVan(arg(element, 8)) !== null) {
        this.meldingen.voeg("waarschuwing", "Knooplast in een lokaal assenstelsel als globaal ingelezen", label);
      }
      this.loads.push({
        id: this.loads.length + 1, nodeId, caseId: this.doelGeval(caseId),
        fx: f[0], fy: f[1], fz: f[2], mx: m[0], my: m[1], mz: m[2],
      });
      return;
    }
    const keten = this.staafKeten(element);
    if (!keten) {
      this.meldingen.voeg("nietOndersteund", "Puntlast op een vlak of buiten dit analysemodel wordt niet ondersteund; niet ingelezen", label);
      return;
    }
    const { a, assen } = keten;
    // Plaats: een vertex in de topologie van de actie, anders de oorsprong van haar plaatsing.
    const vertex = this.meetkunde.topologie(actie).find((item) => item.type === "IFCVERTEXPOINT");
    const heeftPlaatsing = refVan(arg(actie, 5)) !== null;
    let s = 0;
    if (vertex || heeftPlaatsing) {
      const trafo = heeftPlaatsing ? this.trafoVan(actie) : keten.eerste.trafo;
      const p = pas(trafo, (vertex ? this.meetkunde.vertex(vertex.id) : null) ?? [0, 0, 0]);
      const rel = sub(p, [a.x, a.y, a.z]);
      s = dot(rel, assen.ex);
      if (norm(sub(rel, scale(assen.ex, s))) > KNOOP_TOLERANTIE_M) {
        this.meldingen.voeg("waarschuwing", "Puntlast ligt naast de staafas; loodrecht op de staaf geprojecteerd", label);
      }
      s = Math.max(0, Math.min(keten.lengte, s));
    } else {
      this.meldingen.voeg("waarschuwing", "Puntlast op een staaf zonder plaats; op het begin van de staaf gezet", label);
    }
    if (m.some((x) => Math.abs(x) > KLEIN)) {
      this.meldingen.voeg("nietOndersteund", "Moment als puntlast op een staaf wordt niet ondersteund; alleen de kracht is ingelezen", label);
    }
    const fGlobaal = lokaal ? naarGlobaal(keten.eerste.ifcAssen, f) : f;
    // Het deel waar de last op valt; precies op een tussenknoop is dat het begin van het volgende deel.
    const deel = keten.delen.find((d) => s < d.ketenTot) ?? keten.delen[keten.delen.length - 1];
    const positie = opDeel(deel, s);
    const assenDeel = this.assenVan(deel);
    const py = dot(fGlobaal, assenDeel.ey), pz = dot(fGlobaal, assenDeel.ez), px = dot(fGlobaal, assenDeel.ex);
    const doel = this.doelGeval(caseId);
    if (Math.abs(py) > KLEIN || Math.abs(pz) > KLEIN) {
      this.memberPointLoads.push({ id: this.memberPointLoads.length + 1, beamId: deel.beam.id, caseId: doel, py, pz, positionM: positie });
    }
    if (Math.abs(px) > KLEIN) {
      // Axiaal deel: hefboomregel naar de einden van het deel (gelijkwaardige knoopkrachten).
      this.voegAxiaal(deel.beam.startNodeId, doel, scale(assenDeel.ex, px * (1 - positie / deel.lengte)));
      this.voegAxiaal(deel.beam.endNodeId, doel, scale(assenDeel.ex, px * positie / deel.lengte));
    }
  }

  /** De delen van een IFC-staaf met haar begin, assen en lengte; null als het element geen staaf van dit model is. */
  private staafKeten(element: StepRecord) {
    const delen = this.staafVanRecord.get(element.id);
    if (!delen) return null;
    const eerste = delen[0], laatste = delen[delen.length - 1];
    const a = this.nodeById.get(eerste.beam.startNodeId)!, b = this.nodeById.get(laatste.beam.endNodeId)!;
    return { delen, eerste, a, assen: openFem3DMemberAxes(a, b, eerste.beam.rollAngleRad ?? 0), lengte: laatste.ketenTot };
  }

  /** Lokale assen van één deel (bij een tussenknoop net naast de staafas wijken die een fractie af). */
  private assenVan(deel: StaafInfo) {
    return openFem3DMemberAxes(
      this.nodeById.get(deel.beam.startNodeId)!, this.nodeById.get(deel.beam.endNodeId)!, deel.beam.rollAngleRad ?? 0);
  }

  private lijnlast(actie: StepRecord, last: StepRecord, element: StepRecord, caseId: number, lokaal: boolean, label: string): void {
    const keten = this.staafKeten(element);
    if (!keten) {
      this.meldingen.voeg("nietOndersteund", "Lijnlast op een vlakrand of buiten dit analysemodel wordt niet ondersteund; niet ingelezen", label);
      return;
    }
    const verloop = enumVan(arg(actie, 11)) ?? "CONST";
    if (verloop !== "CONST") {
      this.meldingen.voeg("nietOndersteund", `Lijnlast met verloop ${verloop} wordt niet ondersteund; niet ingelezen`, label);
      return;
    }
    if (last.type !== "IFCSTRUCTURALLOADLINEARFORCE") {
      this.meldingen.voeg("nietOndersteund", `Lijnbelasting van het type ${ifcNaam(last.type)} wordt niet ondersteund; niet ingelezen`, label);
      return;
    }
    const q = [1, 2, 3].map((i) => (getalVan(arg(last, i)) ?? 0) * this.eenheden.lijnlast) as V3;
    const mq = [4, 5, 6].map((i) => (getalVan(arg(last, i)) ?? 0) * this.eenheden.lijnmoment) as V3;
    if (mq.some((x) => Math.abs(x) > KLEIN)) {
      this.meldingen.voeg("nietOndersteund", "Verdeeld moment (LinearMoment) op een staaf wordt niet ondersteund; alleen de kracht is ingelezen", label);
    }
    const { a, assen } = keten;
    const geprojecteerd = enumVan(arg(actie, 10)) === "PROJECTED_LENGTH";
    let qGlobaal: V3;
    if (lokaal) {
      if (geprojecteerd) {
        this.meldingen.voeg("waarschuwing", "Lijnlast in lokale assen per geprojecteerde lengte; als per ware lengte ingelezen", label);
      }
      qGlobaal = naarGlobaal(keten.eerste.ifcAssen, q);
    } else if (geprojecteerd) {
      // Per geprojecteerde lengte: de component langs globale as k werkt per
      // meter staaf, geprojecteerd op het vlak loodrecht op k. Die projectie is
      // L·√(1 − e_x,k²). Totaal langs k: q_k · L·√(1 − e_x,k²) = q_k,waar · L,
      // dus q_k,waar = q_k · √(1 − e_x,k²). Sneeuw (−z) op een spant onder een
      // helling α: q_waar = q · cos α; een horizontale of verticale staaf
      // loodrecht op de last verandert niet.
      qGlobaal = q.map((qk, k) => qk * Math.sqrt(Math.max(0, 1 - assen.ex[k] ** 2))) as V3;
    } else {
      qGlobaal = q;
    }
    // Een eigen rand in de topologie van de actie maakt het een deellast.
    let van = 0, tot = keten.lengte;
    const eigenRand = this.meetkunde.topologie(actie).map((item) => this.meetkunde.rand(item)).find((r) => r !== null);
    if (eigenRand) {
      const trafo = refVan(arg(actie, 5)) === null ? keten.eerste.trafo : this.trafoVan(actie);
      const posities = [eigenRand.start, eigenRand.eind].map((v) =>
        dot(sub(pas(trafo, this.meetkunde.vertex(v) ?? [0, 0, 0]), [a.x, a.y, a.z]), assen.ex));
      van = Math.max(0, Math.min(...posities));
      tot = Math.min(keten.lengte, Math.max(...posities));
      if (tot - van <= KNOOP_TOLERANTIE_M) {
        this.meldingen.voeg("nietOndersteund", "Lijnlast over een deel korter dan 1 mm; niet ingelezen", label);
        return;
      }
    }
    const doel = this.doelGeval(caseId);
    // Per deel van een geknipte staaf het stuk van de last dat erop valt.
    for (const deel of keten.delen) {
      const vanS = Math.max(van, deel.ketenVan), totS = Math.min(tot, deel.ketenTot);
      if (totS - vanS <= 1e-9) continue;
      const vanDeel = opDeel(deel, vanS), totDeel = opDeel(deel, totS);
      const assenDeel = this.assenVan(deel);
      const qy = dot(qGlobaal, assenDeel.ey), qz = dot(qGlobaal, assenDeel.ez), qx = dot(qGlobaal, assenDeel.ex);
      if (Math.abs(qy) > KLEIN || Math.abs(qz) > KLEIN) {
        this.memberLoads.push({
          id: this.memberLoads.length + 1, beamId: deel.beam.id, caseId: doel,
          qyStart: qy, qyEnd: qy, qzStart: qz, qzEnd: qz, startPositionM: vanDeel, endPositionM: totDeel,
        });
      }
      if (Math.abs(qx) > KLEIN) {
        // Axiaal deel, zoals bij het eigen gewicht (de kern kent geen axiale lijnlast):
        // gelijkwaardige knoopkrachten F_eind = qx·(b − a)·(a + b)/2 / L en
        // F_begin = qx·(b − a) − F_eind; over de hele staaf is dat half-half.
        const totaal = qx * (totDeel - vanDeel);
        const eindKracht = totaal * (vanDeel + totDeel) / 2 / deel.lengte;
        this.voegAxiaal(deel.beam.startNodeId, doel, scale(assenDeel.ex, totaal - eindKracht));
        this.voegAxiaal(deel.beam.endNodeId, doel, scale(assenDeel.ex, eindKracht));
      }
    }
  }

  private vlaklast(actie: StepRecord, last: StepRecord, element: StepRecord, caseId: number, lokaal: boolean, label: string): void {
    const vlak = this.vlakVanRecord.get(element.id);
    if (!vlak) {
      this.meldingen.voeg("nietOndersteund", "Vlaklast op iets anders dan een vlak van dit analysemodel; niet ingelezen", label);
      return;
    }
    const verloop = enumVan(arg(actie, 11)) ?? "CONST";
    if (verloop !== "CONST") {
      this.meldingen.voeg("nietOndersteund", `Vlaklast met verloop ${verloop} wordt niet ondersteund; niet ingelezen`, label);
      return;
    }
    if (last.type !== "IFCSTRUCTURALLOADPLANARFORCE") {
      this.meldingen.voeg("nietOndersteund", `Vlakbelasting van het type ${ifcNaam(last.type)} wordt niet ondersteund; niet ingelezen`, label);
      return;
    }
    // Een eigen face die met het vlak samenvalt, is een last op het hele vlak: dezelfde route als zonder face.
    const face = this.faceVanVlaklast(actie, vlak);
    if (face === "onleesbaar") {
      this.meldingen.voeg("nietOndersteund", "Vlaklast met een eigen topologie zonder leesbare face (buitenrand); niet ingelezen", label);
      return;
    }
    if (face === "deel") {
      this.meldingen.voeg("nietOndersteund", "Vlaklast op een deel van een vlak wordt niet ondersteund; niet ingelezen, voeg hem zelf toe", label);
      return;
    }
    const p = [1, 2, 3].map((i) => (getalVan(arg(last, i)) ?? 0) * this.eenheden.vlaklast) as V3;
    const f = lokaal ? naarGlobaal([vlak.lokaalX, cross(vlak.lokaalZ, vlak.lokaalX), vlak.lokaalZ], p) : p;
    const geprojecteerd = !lokaal && enumVan(arg(actie, 10)) === "PROJECTED_LENGTH";
    const doel = this.doelGeval(caseId);
    const telOp = (direction: OpenFem3DLoadPanelDirection, q: number) => {
      if (Math.abs(q) <= KLEIN) return;
      const sleutel = `${vlak.record.id}|${doel}|${direction}`;
      const bestaand = this.vlakLasten.get(sleutel);
      if (bestaand) bestaand.q += q;
      else this.vlakLasten.set(sleutel, { vlak, caseId: doel, direction, q });
    };
    const nz = Math.abs(vlak.normaal[2]);
    if (Math.hypot(f[0], f[1]) <= 1e-9 * Math.max(1, Math.abs(f[2]))) {
      // Alleen verticaal: richting "gravity", q per m² HORIZONTALE PROJECTIE.
      // Per m² ware oppervlakte (TRUE_LENGTH) is dat q_waar / cos α = −F_z / |n_z|.
      if (nz < 1e-6) {
        this.meldingen.voeg("nietOndersteund", "Verticale vlaklast op een verticaal vlak; niet ingelezen", label);
        return;
      }
      if (!vlak.horizontaal) {
        this.meldingen.voeg(geprojecteerd ? "toelichting" : "waarschuwing", geprojecteerd
          ? "Vlaklast per m² horizontale projectie op een hellend vlak rechtstreeks overgenomen"
          : "Vlaklast per m² ware oppervlakte op een hellend vlak omgerekend naar per m² horizontale projectie (q / cos α)", vlak.label);
      }
      telOp("gravity", geprojecteerd ? -f[2] : -f[2] / nz);
      return;
    }
    // Loodrecht op het vlak (wind op een gevel): richting "normal", q per m² vlak langs de vaste normaal.
    const langsNormaal = dot(f, vlak.normaal);
    if (norm(sub(f, scale(vlak.normaal, langsNormaal))) <= 1e-6 * norm(f)) {
      if (geprojecteerd) this.meldingen.voeg("waarschuwing", "Vlaklast loodrecht op het vlak per geprojecteerde oppervlakte; als per m² vlak ingelezen", label);
      telOp("normal", langsNormaal);
      return;
    }
    this.meldingen.voeg("nietOndersteund",
      "Vlaklast met een horizontale component (PlanarForceX/Y) die niet loodrecht op het vlak staat wordt niet ondersteund; " +
      "alleen de verticale component is ingelezen", label);
    if (nz >= 1e-6) telOp("gravity", geprojecteerd ? -f[2] : -f[2] / nz);
  }

  /**
   * De eigen topologie van een vlaklast tegen haar vlak gehouden. "geen": de
   * actie heeft geen eigen topologie. "geheel": één face waarvan de buitenrand
   * samenvalt met die van het vlak (dezelfde hoekpunten binnen 1 mm, willekeurig
   * beginpunt en willekeurige draairichting, punten op een rechte rand tellen niet
   * mee) en waarvan elke opening ook een opening van het vlak is. "deel": een
   * andere veelhoek. "onleesbaar": geen face met een leesbare buitenrand.
   */
  private faceVanVlaklast(actie: StepRecord, vlak: VlakInfo): "geen" | "geheel" | "deel" | "onleesbaar" {
    const items = this.meetkunde.topologie(actie);
    if (items.length === 0) return "geen";
    const faces = items.filter((item) => item.type === "IFCFACESURFACE" || item.type === "IFCFACE");
    if (faces.length === 0) return "onleesbaar";
    if (faces.length > 1) return "deel";
    const trafo = refVan(arg(actie, 5)) === null ? vlak.trafo : this.trafoVan(actie);
    const randen = refsVan(arg(faces[0], 0)).map((id) => this.ifc.get(id)).filter((r): r is StepRecord => !!r);
    const lussen = randen.map((r) => ({ buiten: r.type === "IFCFACEOUTERBOUND", punten: this.lusPunten(r, trafo) }));
    if (lussen.length === 0 || lussen.some((l) => l.punten === null)) return "onleesbaar";
    // De buitenrand: IfcFaceOuterBound, anders de lus met het grootste oppervlak (zoals bij het vlak zelf).
    const buiten = lussen.find((l) => l.buiten)
      ?? lussen.slice().sort((a, b) => norm(newell(b.punten!)) - norm(newell(a.punten!)))[0];
    if (!zelfdeVeelhoek(buiten.punten!, vlak.rand, KNOOP_TOLERANTIE_M)) return "deel";
    const openingen = lussen.filter((l) => l !== buiten);
    return openingen.every((o) => vlak.openingen.some((v) => zelfdeVeelhoek(o.punten!, v, KNOOP_TOLERANTIE_M))) ? "geheel" : "deel";
  }

  // ── Belastingvlakken ──

  belastingvlakken(): void {
    const zonderRichting = new Set<string>();
    for (const bron of this.vlakLasten.values()) {
      const { vlak, caseId, direction, q } = bron;
      const oneWay = direction === "gravity" && vlak.spanDirection !== undefined;
      if (!oneWay) zonderRichting.add(vlak.label);
      const panel: OpenFem3DLoadPanel = {
        id: this.loadPanels.length + 1,
        nodeIds: [...vlak.knopen],
        caseId, q, direction,
        distribution: oneWay ? "oneWay" : "twoWay",
        ...(oneWay ? { spanDirection: vlak.spanDirection } : {}),
      };
      // Trek-alleen staven en pendelstaven in het vlak krijgen geen vloerlast.
      try {
        const g = openFem3DLoadPanelGeometry({ nodes: this.nodes }, panel, this.nodeById);
        const inVlak = (id: number) => {
          const k = this.nodeById.get(id)!;
          const rel = sub([k.x, k.y, k.z], g.origin);
          return Math.abs(dot(rel, g.normal)) <= KNOOP_TOLERANTIE_M &&
            puntInVeelhoek([dot(rel, g.axisU), dot(rel, g.axisV)], g.polygon, KNOOP_TOLERANTIE_M);
        };
        const uitgesloten = this.staven
          .filter((s) => (s.beam.tensionOnly || s.pendel) && inVlak(s.beam.startNodeId) && inVlak(s.beam.endNodeId))
          .map((s) => s.beam.id);
        if (uitgesloten.length > 0) panel.excludedBeamIds = uitgesloten;
      } catch {
        // Een vlak dat niet klopt, meldt de afdracht hieronder met reden.
      }
      this.loadPanels.push(panel);
      this.panelBron.push(bron);
    }
    for (const label of zonderRichting) {
      this.meldingen.voeg("waarschuwing",
        "Vlak zonder overspanningsrichting (eigenschap \"Overspanningsrichting\"); afdracht in twee richtingen aangenomen", label);
    }
  }

  // ── Combinaties ──

  combinaties(): void {
    for (const c of this.model.combinaties) {
      const naam = (tekstVan(arg(c, 2)) ?? "").trim() || `Combinatie ${this.combinations.length + 1}`;
      const label = `combinatie "${naam}"`;
      const factors = new Map<number, number>();
      for (const t of this.ifc.leden(c.id)) {
        const caseId = this.gevalVanRecord.get(t.obj);
        if (caseId === undefined) {
          if (T.lastgroepen.has(this.ifc.get(t.obj)?.type ?? "")) {
            this.meldingen.voeg("nietOndersteund",
              "Combinatie met een lastgroep, een andere combinatie of een geval buiten dit model; dat deel is niet ingelezen", label);
          }
          continue;
        }
        if (factors.has(caseId)) this.meldingen.voeg("waarschuwing", "Belastinggeval twee keer in een combinatie; de factoren zijn opgeteld", label);
        factors.set(caseId, (factors.get(caseId) ?? 0) + (t.factor ?? 1));
      }
      if (this.selfWeightCaseId !== undefined && this.eigenGewichtLasten !== undefined && factors.has(this.selfWeightCaseId)) {
        factors.set(this.eigenGewichtLasten, factors.get(this.selfWeightCaseId)!);
      }
      const coefficient = getalVan(arg(c, 8));
      if (coefficient !== null && Math.abs(coefficient - 1) > 1e-9) {
        this.meldingen.voeg("nietOndersteund", `Factor (Coefficient ${NL(coefficient)}) op een combinatie wordt niet ondersteund; genegeerd`, label);
      }
      let type = combinatieType((tekstVan(arg(c, 9)) ?? "").trim()) ?? combinatieType(naam);
      if (!type) {
        type = "uls";
        this.meldingen.voeg("waarschuwing",
          "Combinatie zonder herkenbare grenstoestand (Purpose of naam met ULS/UGT of SLS/BGT); als uiterste grenstoestand aangenomen", label);
      }
      if (this.model.wezen.includes(c)) {
        this.meldingen.voeg("toelichting", "Combinatie buiten LoadedBy van het model, met gevallen van dit model; meegenomen", label);
      }
      // "1,2·G + 1,5·Q − 1·Imp": factor 1 zonder getal, een negatieve factor met een minteken.
      const formula = [...factors].map(([id, f], i) => {
        const term = `${Math.abs(Math.abs(f) - 1) < 1e-12 && f > 0 ? "" : `${NL(Math.abs(f))}·`}${this.loadCases[id - 1].name}`;
        return i === 0 ? `${f < 0 ? "−" : ""}${term}` : `${f < 0 ? " − " : " + "}${term}`;
      }).join("") || "0";
      this.combinations.push({ id: this.combinations.length + 1, name: naam, type, formula, factors });
    }
    if (this.loadCases.length === 0) {
      this.loadCases.push({ id: 1, name: "Belastinggeval 1", type: "dead" });
      this.meldingen.voeg("toelichting", "Het analysemodel heeft geen belastinggevallen; er is één leeg blijvend geval gemaakt");
    }
    if (this.combinations.length === 0) {
      this.meldingen.voeg("toelichting", "Het bestand bevat geen belastingcombinaties; de app stelt de standaardcombinaties (NEN-EN 1990) op");
    }
  }

  // ── Levels ──

  /** De bouwlagen (IfcBuildingStorey) als levels; eerst, want elke nieuwe knoop op een level komt er exact op. */
  levelLijst(): void {
    const verdiepingen = this.ifc.vanType("IFCBUILDINGSTOREY").slice().sort((a, b) => a.id - b.id);
    for (const v of verdiepingen) {
      const elevatie = getalVan(arg(v, 9));
      let hoogteM: number;
      if (elevatie !== null) hoogteM = elevatie * this.eenheden.lengte;
      else {
        const plaatsing = refVan(arg(v, 5));
        if (plaatsing === null) continue;
        hoogteM = pas(na(this.gedeeldInv, this.meetkunde.wereld(plaatsing)), [0, 0, 0])[2];
      }
      // Afronden op 10⁻⁶ mm, zoals openFem3DLevelsFromMetres: 3,6 m wordt 3600 mm.
      const position = Math.round(hoogteM * 1e9) / 1e6;
      if (this.levels.some((l) => Math.abs(l.position - position) < 1e-3)) continue;
      this.levels.push({ id: `z-${this.levels.length + 1}`, label: (tekstVan(arg(v, 2)) ?? "").trim(), position });
    }
    this.levels.sort((a, b) => a.position - b.position);
  }

  // ── Afronden ──

  /**
   * Knopen zonder staaf, vlak of last (bijvoorbeeld een losse knoop van het
   * analysemodel) gaan eruit: de rekenkern zou er een mechanisme melden. De
   * nummering sluit daarna weer aan.
   */
  opruimen(): void {
    const gebruikt = new Set<number>();
    for (const s of this.staven) { gebruikt.add(s.beam.startNodeId); gebruikt.add(s.beam.endNodeId); }
    for (const p of this.loadPanels) for (const id of p.nodeIds) gebruikt.add(id);
    for (const p of this.envelopePanels) {
      for (const id of p.nodeIds) gebruikt.add(id);
      for (const opening of p.openings ?? []) for (const id of opening.nodeIds) gebruikt.add(id);
    }
    for (const l of this.loads) gebruikt.add(l.nodeId);
    const los = this.nodes.filter((k) => !gebruikt.has(k.id));
    if (los.length === 0) return;
    this.meldingen.voeg("waarschuwing",
      "Knoop zonder staaf, vlak of last overgeslagen (de rekenkern zou er een mechanisme melden)",
      los.map((k) => (k.name ? `"${k.name}"` : `(${NL(k.x)}; ${NL(k.y)}; ${NL(k.z)})`)).join(", "));
    const nieuw = new Map<number, number>();
    const blijft = this.nodes.filter((k) => gebruikt.has(k.id));
    blijft.forEach((k, i) => nieuw.set(k.id, i + 1));
    const hernoemd = blijft.map((k) => ({ ...k, id: nieuw.get(k.id)! }));
    this.nodes.splice(0, this.nodes.length, ...hernoemd);
    this.nodeById.clear();
    for (const k of this.nodes) this.nodeById.set(k.id, k);
    for (const s of this.staven) {
      s.beam.startNodeId = nieuw.get(s.beam.startNodeId)!;
      s.beam.endNodeId = nieuw.get(s.beam.endNodeId)!;
    }
    const opleggingen = this.supports.filter((s) => nieuw.has(s.nodeId)).map((s) => ({ ...s, nodeId: nieuw.get(s.nodeId)! }));
    this.supports.splice(0, this.supports.length, ...opleggingen);
    for (const l of this.loads) l.nodeId = nieuw.get(l.nodeId)!;
    for (const p of this.loadPanels) p.nodeIds = p.nodeIds.map((id) => nieuw.get(id)!);
    for (const p of this.envelopePanels) {
      p.nodeIds = p.nodeIds.map((id) => nieuw.get(id)!);
      for (const opening of p.openings ?? []) opening.nodeIds = opening.nodeIds.map((id) => nieuw.get(id)!);
    }
    for (const [i, d] of this.diaphragms.entries()) {
      d.nodeIds = d.nodeIds.filter((id) => nieuw.has(id)).map((id) => nieuw.get(id)!);
      this.schijven[i].knopen = d.nodeIds.length;
    }
    const schijven = this.diaphragms.filter((d) => d.nodeIds.length >= 2);
    this.diaphragms.splice(0, this.diaphragms.length, ...schijven);
  }

  resultaat(): IfcAnalyseImport {
    if (this.aangemaakt.vlakhoeken > 0) {
      this.meldingen.voeg("waarschuwing",
        `${aantal(this.aangemaakt.vlakhoeken, "hoekpunt van een vlak valt", "hoekpunten van vlakken vallen")} niet op een knoop ` +
        "van het analysemodel; daar is een knoop gemaakt. Zonder staaf eraan meldt de rekenkern daar een mechanisme");
    }
    const ruw: OpenFem3DModel = {
      nodes: this.nodes, beams: this.staven.map((s) => s.beam), supports: this.supports,
      loads: this.loads, memberLoads: this.memberLoads, memberPointLoads: this.memberPointLoads,
      thermalLoads: [], plates: [], surfaceLoads: [], loadPanels: this.loadPanels,
      envelopePanels: this.envelopePanels,
      ...(this.diaphragms.length > 0 ? { diaphragms: this.diaphragms } : {}),
    };
    let model3d: OpenFem3DModel;
    try {
      model3d = parseOpenFem3DModel(ruw);
    } catch (fout) {
      throw new IfcImportFout("ongeldigModel",
        `Het analysemodel "${this.model.naam}" leverde geen geldig 3D-model op: ${fout instanceof Error ? fout.message : String(fout)}`);
    }
    // De afdracht van elk belastingvlak nu al keuren: een vlak zonder ligger valt anders pas bij het rekenen op.
    for (const analyse of analyseOpenFem3DLoadPanels(model3d)) {
      const bron = this.panelBron[analyse.panel.id - 1];
      const label = `belastingvlak ${analyse.panel.id} (${bron?.vlak.label ?? "vlak ?"}, geval "${this.loadCases[(analyse.panel.caseId ?? 1) - 1]?.name ?? "?"}")`;
      if (analyse.error !== undefined) {
        this.meldingen.voeg("waarschuwing", `Belastingvlak kan niet afdragen: ${analyse.error.replace(/\.$/, "")}`, label);
        continue;
      }
      for (const w of analyse.result.warnings) this.meldingen.voeg("waarschuwing", w.replace(/\.$/, ""), label);
    }
    const project = this.ifc.vanType("IFCPROJECT")[0];
    const projectNaam = (tekstVan(arg(project, 2)) ?? "").trim() || (tekstVan(arg(project, 5)) ?? "").trim();
    return {
      model3d,
      loadCases: this.loadCases,
      combinations: this.combinations,
      ...(this.selfWeightCaseId !== undefined ? { selfWeightCaseId: this.selfWeightCaseId } : {}),
      levels: this.levels,
      projectnaam: projectNaam ? `${projectNaam} - ${this.model.naam}` : this.model.naam,
      verslag: {
        model: this.model.naam,
        schema: this.ifc.schema,
        aantallen: {
          knopen: model3d.nodes.length,
          staven: model3d.beams.length,
          opleggingen: model3d.supports?.length ?? 0,
          stavenMetScharnieren: model3d.beams.filter((b) => b.releases).length,
          belastingvlakken: model3d.loadPanels?.length ?? 0,
          staaflasten: model3d.memberLoads?.length ?? 0,
          staafpuntlasten: model3d.memberPointLoads?.length ?? 0,
          knooplasten: model3d.loads?.length ?? 0,
          belastinggevallen: this.loadCases.length,
          combinaties: this.combinations.length,
          levels: this.levels.length,
          schijven: model3d.diaphragms?.length ?? 0,
          imperfectieGevallen: this.imperfectieGevallen,
        },
        trekAlleen: model3d.beams.filter((b) => b.tensionOnly).length,
        schijven: this.schijven.filter((s) => this.diaphragms.some((d) => d.id === s.id)),
        toelichting: this.meldingen.teksten("toelichting"),
        waarschuwingen: this.meldingen.teksten("waarschuwing"),
        nietOndersteund: this.meldingen.teksten("nietOndersteund"),
      },
    };
  }
}

/**
 * Plaats s langs de as van een IFC-staaf → plaats op één deel ervan. Een
 * ongeknipte staaf houdt s; bij een geknipte schaalt het stuk van de as op de
 * lengte van het deel (gelijk, tenzij een tussenknoop net naast de as ligt).
 */
function opDeel(deel: StaafInfo, s: number): number {
  const stuk = deel.ketenTot - deel.ketenVan;
  const t = stuk === deel.lengte ? s - deel.ketenVan : (s - deel.ketenVan) / stuk * deel.lengte;
  return Math.max(0, Math.min(deel.lengte, t));
}

/** Afstand van punt p tot het lijnstuk a–b. */
function afstandTotLijnstuk(p: V3, a: V3, b: V3): number {
  const ab = sub(b, a);
  const lengte2 = dot(ab, ab);
  const t = lengte2 <= 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / lengte2));
  return norm(sub(p, add(a, scale(ab, t))));
}

/**
 * De hoekpunten van een lus: samenvallende punten (binnen `tol`), een herhaald
 * beginpunt en punten op een rechte rand (binnen `tol` van het lijnstuk tussen
 * hun buren) gaan eruit.
 */
function hoekpunten(lus: readonly V3[], tol: number): V3[] {
  let p = lus.filter((v, i) => i === 0 || norm(sub(v, lus[i - 1])) > tol);
  if (p.length > 1 && norm(sub(p[0], p[p.length - 1])) <= tol) p = p.slice(0, -1);
  let weg = true;
  while (weg && p.length > 3) {
    weg = false;
    for (let i = 0; i < p.length; i += 1) {
      if (afstandTotLijnstuk(p[i], p[(i - 1 + p.length) % p.length], p[(i + 1) % p.length]) <= tol) {
        p = [...p.slice(0, i), ...p.slice(i + 1)];
        weg = true;
        break;
      }
    }
  }
  return p;
}

/** Dezelfde veelhoek: dezelfde hoekpunten binnen `tol`, los van beginpunt en draairichting. */
function zelfdeVeelhoek(a: readonly V3[], b: readonly V3[], tol: number): boolean {
  const p = hoekpunten(a, tol), q = hoekpunten(b, tol);
  const n = p.length;
  if (n < 3 || q.length !== n) return false;
  const gelijk = (u: V3, v: V3) => norm(sub(u, v)) <= tol;
  for (let start = 0; start < n; start += 1) {
    if (!gelijk(p[0], q[start])) continue;
    if (p.every((u, i) => gelijk(u, q[(start + i) % n]))) return true;
    if (p.every((u, i) => gelijk(u, q[(start - i + n) % n]))) return true;
  }
  return false;
}

/** Assen van het IFC-stelsel (globaal) × lokale componenten → globale vector. */
function naarGlobaal(assen: readonly V3[], v: readonly number[]): V3 {
  return add(add(scale(assen[0], v[0]), scale(assen[1], v[1])), scale(assen[2], v[2]));
}

/** Vallen de assen samen met de globale X, Y en Z? */
function isGlobaal(t: Trafo): boolean {
  return Math.abs(t.x[0] - 1) < 1e-9 && Math.abs(t.y[1] - 1) < 1e-9 && Math.abs(t.z[2] - 1) < 1e-9;
}

/** De schrijfwijze van het schema, voor de typen die in een melding kunnen staan. */
const IFC_NAMEN = [
  "IfcLShapeProfileDef", "IfcTShapeProfileDef", "IfcCShapeProfileDef", "IfcZShapeProfileDef", "IfcRectangleProfileDef",
  "IfcRoundedRectangleProfileDef", "IfcAsymmetricIShapeProfileDef", "IfcArbitraryClosedProfileDef",
  "IfcArbitraryProfileDefWithVoids", "IfcCompositeProfileDef", "IfcDerivedProfileDef", "IfcEllipseProfileDef",
  "IfcTrapeziumProfileDef", "IfcCenterLineProfileDef", "IfcMirroredProfileDef",
  "IfcStructuralLoadSingleDisplacement", "IfcStructuralLoadSingleDisplacementDistortion", "IfcStructuralLoadTemperature",
  "IfcStructuralLoadLinearForce", "IfcStructuralLoadPlanarForce", "IfcStructuralLoadSingleForce", "IfcStructuralLoadConfiguration",
  "IfcGridPlacement", "IfcLinearPlacement",
];
const ifcNaam = (type: string) => IFC_NAMEN.find((n) => n.toUpperCase() === type) ?? type.replace(/^IFC/, "Ifc");

/**
 * Importeer één analysemodel uit een IFC4-bestand. Gooit `IfcImportFout` als
 * het bestand niet te lezen is, geen analysemodel bevat, of als er meerdere
 * modellen zijn en `opties.model` ontbreekt.
 */
export function importeerIfcAnalyseModel(
  invoer: string | IfcAnalyseBestand,
  opties: IfcImportOpties = {},
): IfcAnalyseImport {
  const ifc = bestandVan(invoer);
  const importeur = new Importeur(ifc, kiesModel(modellenVan(ifc), opties.model));
  importeur.levelLijst();
  importeur.knopen();
  importeur.staafLijst();
  importeur.tussenknopen();
  importeur.eindscharnieren();
  importeur.vlakLijst();
  importeur.schilpanelen();
  importeur.schijfLijst();
  importeur.gevallen();
  importeur.lasten();
  importeur.belastingvlakken();
  importeur.combinaties();
  importeur.opruimen();
  return importeur.resultaat();
}

function gevalType(actieType: string | null, bron: string | null): LoadCase["type"] {
  // Een imperfectiegeval (initiële scheefstand als knooplasten) draagt het
  // ActionType van zijn verticale geval, maar is geen blijvende of
  // veranderlijke last: "overig", zodat de combinatiecontrole van de app er
  // geen γ-factor van een ander type op legt.
  if (bron === "SYSTEM_IMPERFECTION") return "other";
  if (actieType === "PERMANENT_G") return "dead";
  if (actieType === "VARIABLE_Q") return bron === "SNOW_S" ? "snow" : bron === "WIND_W" ? "wind" : "live";
  if (actieType !== "EXTRAORDINARY_A") {
    // Geen ActionType: dan zegt de bron het, als die het zegt.
    if (bron === "DEAD_LOAD_G" || bron === "COMPLETION_G1") return "dead";
    if (bron === "SNOW_S") return "snow";
    if (bron === "WIND_W") return "wind";
    if (bron === "LIVE_LOAD_Q") return "live";
  }
  return "other";
}

function combinatieType(tekst: string): "uls" | "sls" | null {
  if (/(?:^|[^a-z])(uls|ugt)(?:[^a-z]|$)/i.test(tekst)) return "uls";
  if (/(?:^|[^a-z])(sls|bgt)(?:[^a-z]|$)/i.test(tekst)) return "sls";
  return null;
}

// ── Projectbestand ──────────────────────────────────────────────────────────

/**
 * De inhoud van een projectbestand (de vorm van `serializeProject`) voor een
 * geïmporteerd model: een nieuw 3D-project met eerste-ordeanalyse, de gevallen
 * en eigen combinaties uit het bestand en de levels als stramien.
 * `projectInfo` levert de overige projectgegevens; de naam komt uit het IFC.
 */
export function ifcAnalyseProject(imp: IfcAnalyseImport, projectInfo: Record<string, unknown> = {}) {
  const actief = imp.loadCases.find((c) => !c.eigenGewicht) ?? imp.loadCases[0];
  return {
    nodes: [], beams: [], supports: [], plates: [], loads: [],
    loadCases: imp.loadCases,
    activeLoadCaseId: actief?.id ?? 1,
    selfWeightEnabled: imp.selfWeightCaseId !== undefined,
    // Een analysemodel met imperfectiegevallen (SYSTEM_IMPERFECTION) draagt de
    // scheefstand al als knooplasten; de scheefstand van de app erbij zou hem
    // dubbel tellen. Zonder zulke gevallen is uit ook de standaard van een
    // nieuw project.
    scheefstandEnabled: false,
    nonlinearEnabled: false,
    analysetype: "eersteOrde" as const,
    modelDimension: "3d" as const,
    model3d: imp.model3d,
    // Geen combinaties in het bestand: dan zet de app de standaardset op.
    ...(imp.combinations.length > 0 ? {
      combinations: imp.combinations.map((c) => ({
        id: c.id, name: c.name, type: c.type, formula: c.formula,
        factors: Object.fromEntries([...c.factors].map(([id, f]) => [String(id), f])),
      })),
    } : {}),
    structuralGrid: { enabled: imp.levels.length > 0, xAxes: [], yAxes: [], zAxes: imp.levels },
    projectInfo: { ...projectInfo, name: imp.projectnaam },
  };
}

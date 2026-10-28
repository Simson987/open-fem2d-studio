/**
 * ifcResultaten.ts — rekenresultaten als IFC4: het `.ifcfemresults`-bestand
 * (issue #87).
 *
 * WAT HET BESTAND IS
 * Eén geldig IFC4-bestand (ISO 10303-21) met precies het rekenmodel van de
 * gewone IFC-export (`bouwIfcRekenmodel`: analysemodel, belastinggroepen,
 * lasten, bouwkundig model) plus de resultaten:
 *  - per belastinggeval en per combinatie een IfcStructuralResultGroup, met
 *    `ResultForLoadGroup` naar zijn IfcStructuralLoadGroup en als
 *    `HasResults` op het analysemodel;
 *  - per knoop de verplaatsing en per oplegknoop de reactie als
 *    IfcStructuralPointReaction (IfcStructuralLoadSingleDisplacement resp.
 *    IfcStructuralLoadSingleForce), verbonden met de puntconnectie;
 *  - per staaf de snedekrachten en verplaatsingen over de stations als
 *    IfcStructuralCurveReaction (DISCRETE, IfcStructuralLoadConfiguration);
 *  - per plaatelement een IfcStructuralSurfaceReaction, met alle grootheden
 *    in de set OpenFEM_Plaatelement (2D) of OpenFEM_Schaalelement (3D);
 *  - de unity checks: de set OpenFEM_Toetsing per staaf, zoals de gewone
 *    export die al schrijft;
 *  - het projectbestand (.ifcfem) zelf, als IfcText in de set
 *    OpenFEM_Projectbestand op het IfcProject. Daarmee opent de app het
 *    model exact zoals het gerekend is; de IFC-entiteiten zijn er voor
 *    andere programma's (en voor de resultaten zelf, die hieruit gelezen
 *    worden).
 *
 * EENHEDEN EN EXACTHEID
 * Het bestand rekent in SI (m, N, N·m, Pa), zoals de IfcUnitAssignment van de
 * export. De app rekent in mm/N (2D) en m/kN (3D). Omrekenen met ×1000 komt
 * niet altijd bit-gelijk terug; daarom verschuift `reeelExact` de decimale
 * komma in de tekst (x.toExponential() met een aangepaste exponent) en doet
 * de lezer het omgekeerde op de tekst uit het bestand (`StepGetal`). Een
 * waarde komt zo exact terug — dat bewaakt test-ifc-resultaten.mjs.
 *
 * TEKENS EN ASSEN (vastgelegd, niet omgerekend)
 *  - 2D-knopen: GLOBAL_COORDS; ux → DisplacementX, uz → DisplacementZ,
 *    ry → RotationalDisplacementRY; fx/fz/my → ForceX/ForceZ/MomentY. Zelfde
 *    afspraak als de knooplasten van de bestaande export (geen tekenwissel).
 *  - 2D-staven: LOCAL_COORDS van het curve-lid (lokaal z = Axis = globaal Y,
 *    loodrecht op het rekenvlak); N → ForceX, V → ForceY, M → MomentZ;
 *    axiale verplaatsing → DisplacementX, doorbuiging → DisplacementY,
 *    rotatie → RotationalDisplacementRZ. Tekens zoals de app ze geeft
 *    (N trek positief).
 *  - 3D: zoals de 3D-kern ze geeft: knopen globaal, staven lokaal (x, y, z
 *    van de staaf).
 *
 * WAT ER NIET IN STAAT (en bij teruglezen dus ontbreekt): de omhullende (die
 * volgt bij openen weer uit de combinaties), α_cr, veldpatroonvarianten,
 * segment- en materiaalgeschiedenis van fysisch niet-lineaire staven, de
 * drielagen-toets van platen, en bij 3D knik, evenwichtscontroles,
 * bedding, het rekennet van de platen en de plaatsamenvatting.
 */
import type { SolverResult, ElementForces, PlateResult, PlateElementStress, NodalDisp, NodalReaction } from "../components/fem/solver/types";
import type {
  OpenFem3DSolveResult, OpenFem3DMemberDiagram, OpenFem3DDiagrams, OpenFem3DShellValues,
  OpenFem3DShellElementResult, OpenFem3DShellNodeResult, OpenFem3DMemberForces,
} from "../components/openFem3d/openFem3dSolver";
import { materiaalasRanges } from "../lib/plaatMateriaal";
import {
  bouwIfcRekenmodel, lijst, ref, stepString,
  type IfcAnalysemodelIds, type IfcExportOpties, type IfcRekenmodelInput, type SpfSchrijver,
} from "./ifcExport";
import { RESULTATEN_FILE_EXT } from "./projectFile";
import { leesStep, StepEnum, StepGetal, StepGetypt, StepRef, type StepRecord, type StepWaarde } from "./stepLezer";

/** De extensie van het resultatenbestand (zonder punt); één bron met Openen. */
export const IFC_RESULTATEN_EXT = RESULTATEN_FILE_EXT;

/** Herkenning van de eigen entiteiten: het ObjectType begint hiermee. */
const SLEUTEL = "OpenFEM:";

// ── Invoer ──────────────────────────────────────────────────────────────────

export interface IfcResultatenInvoer {
  /** De 2D-resultaten per belastinggeval en per combinatie (app-eenheden: N, mm, rad). */
  tweeD?: {
    perCase: ReadonlyMap<number, SolverResult>;
    combinaties: ReadonlyMap<number, SolverResult>;
  };
  /** De 3D-resultaten per belastinggeval en per combinatie (m, kN, kNm). */
  drieD?: {
    perCase: ReadonlyMap<number, OpenFem3DSolveResult>;
    combinaties: ReadonlyMap<number, OpenFem3DSolveResult>;
  };
  /**
   * De tekst van het projectbestand (`serializeProject`), zodat de app het
   * model exact kan heropenen. Weglaten = alleen IFC.
   */
  projectTekst?: string;
}

export interface IfcResultaatGroepInfo {
  dimensie: "2D" | "3D";
  soort: "geval" | "combinatie";
  id: number;
  naam: string;
  theorie: string;
  lineair: boolean;
}

export interface IfcResultatenGelezen {
  /** Het ingebedde projectbestand, of null als het bestand er geen heeft. */
  projectTekst: string | null;
  tweeD: { perCase: Map<number, SolverResult>; combinaties: Map<number, SolverResult> };
  drieD: { perCase: Map<number, OpenFem3DSolveResult>; combinaties: Map<number, OpenFem3DSolveResult> };
  groepen: IfcResultaatGroepInfo[];
}

export class IfcResultatenFout extends Error {
  constructor(melding: string) {
    super(melding);
    this.name = "IfcResultatenFout";
  }
}

// ── Exacte getallen ─────────────────────────────────────────────────────────

/**
 * STEP-reëel van `x · 10^verschuiving`, exact: de cijfers van de kortste
 * terugleesbare vorm van x met een aangepaste exponent. Niet-eindig → `$`.
 */
export function reeelExact(x: number, verschuiving = 0): string {
  if (!Number.isFinite(x)) return "$";
  if (x === 0) return "0.";
  const [mantisse, exponent] = x.toExponential().split("e");
  const m = mantisse.includes(".") ? mantisse : `${mantisse}.`;
  return `${m}E${Number(exponent) + verschuiving}`;
}

/** Het omgekeerde van `reeelExact`: waarde uit het bestand × 10^(−verschuiving). */
export function leesExact(waarde: StepWaarde | undefined, verschuiving = 0): number | undefined {
  if (waarde instanceof StepGetypt) return leesExact(waarde.waarde, verschuiving);
  if (waarde instanceof StepGetal) {
    const m = /^([+-]?[0-9]*\.?[0-9]*)(?:[eE]([+-]?[0-9]+))?$/.exec(waarde.tekst);
    if (!m) return waarde.waarde * 10 ** -verschuiving;
    const exponent = Number(m[2] ?? 0) - verschuiving;
    return Number(`${m[1]}e${exponent}`);
  }
  if (typeof waarde === "number") return verschuiving === 0 ? waarde : Number(`${waarde}e${-verschuiving}`);
  return undefined;
}

const opt = (x: number | undefined, verschuiving = 0): string =>
  x === undefined ? "$" : reeelExact(x, verschuiving);

// ── Veldtabellen (naam, IFC-maat, verschuiving app → SI) ───────────────────

type Veld<T> = readonly [keyof T & string, string, number];

const PLAAT2D_VELDEN: readonly Veld<PlateElementStress>[] = [
  ["sigmaX", "IFCPRESSUREMEASURE", 6], ["sigmaY", "IFCPRESSUREMEASURE", 6],
  ["tauXY", "IFCPRESSUREMEASURE", 6], ["vonMises", "IFCPRESSUREMEASURE", 6],
  ["sigma1", "IFCPRESSUREMEASURE", 6], ["sigma2", "IFCPRESSUREMEASURE", 6],
  ["angle", "IFCREAL", 0],
  ["nx", "IFCLINEARFORCEMEASURE", 3], ["ny", "IFCLINEARFORCEMEASURE", 3], ["nxy", "IFCLINEARFORCEMEASURE", 3],
  ["effectiveEMpa", "IFCMODULUSOFELASTICITYMEASURE", 6],
  ["maxEquivalentStrain", "IFCREAL", 0], ["equivalentPlasticStrain", "IFCREAL", 0], ["tensileDamage", "IFCREAL", 0],
];

const SCHAAL_VELDEN: readonly Veld<OpenFem3DShellValues>[] = [
  ["nxxKnPerM", "IFCLINEARFORCEMEASURE", 3], ["nyyKnPerM", "IFCLINEARFORCEMEASURE", 3], ["nxyKnPerM", "IFCLINEARFORCEMEASURE", 3],
  ["mxxKnmPerM", "IFCLINEARMOMENTMEASURE", 3], ["myyKnmPerM", "IFCLINEARMOMENTMEASURE", 3], ["mxyKnmPerM", "IFCLINEARMOMENTMEASURE", 3],
  ["vxKnPerM", "IFCLINEARFORCEMEASURE", 3], ["vyKnPerM", "IFCLINEARFORCEMEASURE", 3],
  ["sigmaXxTopMpa", "IFCPRESSUREMEASURE", 6], ["sigmaYyTopMpa", "IFCPRESSUREMEASURE", 6],
  ["tauXyTopMpa", "IFCPRESSUREMEASURE", 6], ["vonMisesTopMpa", "IFCPRESSUREMEASURE", 6],
  ["sigmaXxBottomMpa", "IFCPRESSUREMEASURE", 6], ["sigmaYyBottomMpa", "IFCPRESSUREMEASURE", 6],
  ["tauXyBottomMpa", "IFCPRESSUREMEASURE", 6], ["vonMisesBottomMpa", "IFCPRESSUREMEASURE", 6],
];

/** De zes snedekrachtlijnen van een 3D-staaf, met hun plaats in de SingleForce. */
const DIAGRAM_COMPONENTEN = [
  ["axial", 1], ["shearY", 2], ["shearZ", 3], ["torsion", 4], ["momentY", 5], ["momentZ", 6],
] as const satisfies readonly (readonly [keyof OpenFem3DDiagrams, number])[];

const STAAF3D_KRACHTEN = [
  ["n", 1, "Kn"], ["vy", 2, "Kn"], ["vz", 3, "Kn"], ["torsion", 4, "Knm"], ["my", 5, "Knm"], ["mz", 6, "Knm"],
] as const;

// ── Schrijven ───────────────────────────────────────────────────────────────

interface Eig { naam: string; waarde: string }

function schrijfSet(w: SpfSchrijver, setNaam: string, seed: string, eigenschappen: Eig[], objecten: number[]): void {
  if (eigenschappen.length === 0 || objecten.length === 0) return;
  const ids = eigenschappen.map((e) => w.ent("IFCPROPERTYSINGLEVALUE", stepString(e.naam), "$", e.waarde, "$"));
  const set = w.ent("IFCPROPERTYSET", w.guid(`pset:${seed}`), "$", stepString(setNaam), "$", lijst(ids));
  w.ent("IFCRELDEFINESBYPROPERTIES", w.guid(`psetrel:${seed}`), "$", "$", "$", lijst(objecten), ref(set));
}

const maat = (naam: string, type: string, v: number, verschuiving = 0): Eig =>
  ({ naam, waarde: `${type}(${reeelExact(v, verschuiving)})` });
const label = (naam: string, v: string): Eig => ({ naam, waarde: `IFCLABEL(${stepString(v)})` });
const geheel = (naam: string, v: number): Eig => ({ naam, waarde: `IFCINTEGER(${Math.round(v)})` });

function veldEigenschappen<T>(bron: T, velden: readonly Veld<T>[], voorvoegsel = ""): Eig[] {
  const uit: Eig[] = [];
  for (const [veld, type, verschuiving] of velden) {
    const v = bron[veld];
    if (typeof v === "number" && Number.isFinite(v)) uit.push(maat(voorvoegsel + veld, type, v, verschuiving));
  }
  return uit;
}

function theorie2D(analysetype: string | undefined): { theorie: string; lineair: boolean } {
  switch (analysetype) {
    case "tweedeOrdeGeometrisch": return { theorie: "SECOND_ORDER_THEORY", lineair: false };
    case "tweedeOrdeFysisch":
    case "axiaalFysischRust": return { theorie: "FULL_NONLINEAR_THEORY", lineair: false };
    default: return { theorie: "FIRST_ORDER_THEORY", lineair: true };
  }
}

function theorie3D(r: OpenFem3DSolveResult): { theorie: string; lineair: boolean } {
  if (r.nativeAnalysis === "material" || r.nativeAnalysis === "combined") {
    return { theorie: "FULL_NONLINEAR_THEORY", lineair: false };
  }
  return r.analysis === "p-delta"
    ? { theorie: "SECOND_ORDER_THEORY", lineair: false }
    : { theorie: "FIRST_ORDER_THEORY", lineair: true };
}

/** Eén reactie-entiteit plus haar koppeling aan een knoop, staaf of plaat. */
function koppel(w: SpfSchrijver, seed: string, item: number | undefined, actie: number): void {
  if (item === undefined) return;
  w.ent("IFCRELCONNECTSSTRUCTURALACTIVITY", w.guid(`${seed}:rel`), "$", "$", "$", ref(item), ref(actie));
}

function resultaatGroep(
  w: SpfSchrijver, dim: "2D" | "3D", soort: "geval" | "combinatie", id: number, naam: string,
  th: { theorie: string; lineair: boolean }, lastgroep: number | undefined,
): number {
  return w.ent("IFCSTRUCTURALRESULTGROUP",
    w.guid(`resultaat:${dim}:${soort}:${id}`), "$", stepString(`Resultaten ${naam}`), "$",
    stepString(`${SLEUTEL}${dim}:${soort}:${id}`), `.${th.theorie}.`,
    lastgroep !== undefined ? ref(lastgroep) : "$", th.lineair ? ".T." : ".F.");
}

function schrijf2DResultaat(
  w: SpfSchrijver, ids: IfcAnalysemodelIds, context: number,
  soort: "geval" | "combinatie", id: number, naam: string, r: SolverResult, analysetype: string | undefined,
): number {
  const p = `res:2d:${soort}:${id}`;
  const lastgroep = soort === "geval" ? ids.groepPerCase.get(id) : ids.groepPerCombinatie.get(id);
  const groep = resultaatGroep(w, "2D", soort, id, naam, theorie2D(analysetype), lastgroep);
  const leden: number[] = [];

  for (const [knoop, d] of r.displacements) {
    const last = w.ent("IFCSTRUCTURALLOADSINGLEDISPLACEMENT", stepString(`u ${knoop}`),
      reeelExact(d.ux, -3), "$", reeelExact(d.uz, -3), "$", reeelExact(d.ry), "$");
    const actie = w.ent("IFCSTRUCTURALPOINTREACTION", w.guid(`${p}:u:${knoop}`), "$",
      stepString(`Verplaatsing knoop ${knoop}`), "$", stepString(`${SLEUTEL}verplaatsing:${knoop}`),
      "$", "$", ref(last), ".GLOBAL_COORDS.");
    koppel(w, `${p}:u:${knoop}`, ids.connectiePerKnoop.get(knoop), actie);
    leden.push(actie);
  }
  for (const [knoop, f] of r.reactions) {
    const last = w.ent("IFCSTRUCTURALLOADSINGLEFORCE", stepString(`R ${knoop}`),
      reeelExact(f.fx), "$", reeelExact(f.fz), "$", reeelExact(f.my, -3), "$");
    const actie = w.ent("IFCSTRUCTURALPOINTREACTION", w.guid(`${p}:r:${knoop}`), "$",
      stepString(`Reactie knoop ${knoop}`), "$", stepString(`${SLEUTEL}reactie:${knoop}`),
      "$", "$", ref(last), ".GLOBAL_COORDS.");
    koppel(w, `${p}:r:${knoop}`, ids.connectiePerKnoop.get(knoop), actie);
    leden.push(actie);
  }
  for (const [knoop, d] of r.plateNodeDisplacements ?? []) {
    const last = w.ent("IFCSTRUCTURALLOADSINGLEDISPLACEMENT", stepString(`u ${knoop}`),
      reeelExact(d.ux, -3), "$", reeelExact(d.uz, -3), "$", "$", "$");
    leden.push(w.ent("IFCSTRUCTURALPOINTREACTION", w.guid(`${p}:pu:${knoop}`), "$",
      stepString(`Verplaatsing plaatknoop ${knoop}`), "$", stepString(`${SLEUTEL}plaatknoop:${knoop}`),
      "$", "$", ref(last), ".GLOBAL_COORDS."));
  }
  for (const [staaf, e] of r.elements) {
    const locaties = `(${e.stations_mm.map((s) => `(${reeelExact(s, -3)})`).join(",")})`;
    const krachten = e.stations_mm.map((_, i) => w.ent("IFCSTRUCTURALLOADSINGLEFORCE", "$",
      opt(e.normalForce[i]), opt(e.shearForce[i]), "$", "$", "$", opt(e.bendingMoment[i], -3)));
    const configK = w.ent("IFCSTRUCTURALLOADCONFIGURATION", "'Snedekrachten'", lijst(krachten), locaties);
    const actieK = w.ent("IFCSTRUCTURALCURVEREACTION", w.guid(`${p}:staaf:${staaf}:k`), "$",
      stepString(`Snedekrachten staaf ${staaf}`), "$", stepString(`${SLEUTEL}staaf:${staaf}:krachten`),
      "$", "$", ref(configK), ".LOCAL_COORDS.", ".DISCRETE.");
    koppel(w, `${p}:staaf:${staaf}:k`, ids.memberPerStaaf.get(staaf), actieK);
    schrijfSet(w, "OpenFEM_Staafresultaat", `${p}:staaf:${staaf}`, [
      maat("N", "IFCFORCEMEASURE", e.N), maat("V", "IFCFORCEMEASURE", e.V),
      maat("M_start", "IFCTORQUEMEASURE", e.M_start, -3), maat("M_end", "IFCTORQUEMEASURE", e.M_end, -3),
      maat("L", "IFCLENGTHMEASURE", e.L_mm, -3),
    ], [actieK]);
    const verpl = e.stations_mm.map((_, i) => w.ent("IFCSTRUCTURALLOADSINGLEDISPLACEMENT", "$",
      opt(e.axialDisp[i], -3), opt(e.deflection[i], -3), "$", "$", "$", opt(e.rotation?.[i])));
    const configU = w.ent("IFCSTRUCTURALLOADCONFIGURATION", "'Verplaatsingen'", lijst(verpl), locaties);
    const actieU = w.ent("IFCSTRUCTURALCURVEREACTION", w.guid(`${p}:staaf:${staaf}:u`), "$",
      stepString(`Verplaatsingen staaf ${staaf}`), "$", stepString(`${SLEUTEL}staaf:${staaf}:verplaatsingen`),
      "$", "$", ref(configU), ".LOCAL_COORDS.", ".DISCRETE.");
    koppel(w, `${p}:staaf:${staaf}:u`, ids.memberPerStaaf.get(staaf), actieU);
    leden.push(actieK, actieU);
  }
  const groepEig: Eig[] = [
    label("Soort", soort), geheel("Id", id),
    maat("MaxVerplaatsing", "IFCLENGTHMEASURE", r.maxDisplacement, -3),
  ];
  if (r.trekAlleenUitgeschakeld) groepEig.push(label("TrekAlleenUitgeschakeld", r.trekAlleenUitgeschakeld.join(",")));
  for (const plaat of r.plateElements ?? []) {
    if (plaat.expectedElementIds) groepEig.push(label(`Plaat${plaat.plateId}_VerwachteElementen`, plaat.expectedElementIds.join(",")));
    if (plaat.materiaalassen) groepEig.push(maat(`Plaat${plaat.plateId}_MateriaalHoekGraden`, "IFCREAL", plaat.materiaalassen.hoekGraden));
    if (plaat.elements.length === 0) groepEig.push(label(`Plaat${plaat.plateId}_Leeg`, "ja"));
    for (const el of plaat.elements) {
      const punten = el.corners.map((c) => w.ent("IFCCARTESIANPOINT",
        `(${reeelExact(c.x, -3)},0.,${reeelExact(c.z, -3)})`));
      let vorm = "$";
      if (punten.length >= 3) {
        const lus = w.ent("IFCPOLYLOOP", lijst(punten));
        const rand = w.ent("IFCFACEOUTERBOUND", ref(lus), ".T.");
        const vlak = w.ent("IFCFACE", lijst([rand]));
        const topo = w.ent("IFCTOPOLOGYREPRESENTATION", ref(context), "'Reference'", "'Face'", lijst([vlak]));
        vorm = ref(w.ent("IFCPRODUCTDEFINITIONSHAPE", "$", "$", lijst([topo])));
      }
      const last = w.ent("IFCSTRUCTURALLOADPLANARFORCE", "'Membraanspanning'",
        reeelExact(el.sigmaX, 6), reeelExact(el.sigmaY, 6), "$");
      const actie = w.ent("IFCSTRUCTURALSURFACEREACTION", w.guid(`${p}:plaat:${plaat.plateId}:${el.elementId}`), "$",
        stepString(`Plaat ${plaat.plateId} element ${el.elementId}`), "$",
        stepString(`${SLEUTEL}plaatelement:${plaat.plateId}:${el.elementId}`),
        "$", vorm, ref(last), ".GLOBAL_COORDS.", ".CONST.");
      koppel(w, `${p}:plaat:${plaat.plateId}:${el.elementId}`, ids.memberPerPlaat.get(plaat.plateId), actie);
      const eig = veldEigenschappen(el, PLAAT2D_VELDEN);
      if (el.materiaalassen) {
        eig.push(maat("Materiaal_sigma1", "IFCPRESSUREMEASURE", el.materiaalassen.sigma1, 6));
        eig.push(maat("Materiaal_sigma2", "IFCPRESSUREMEASURE", el.materiaalassen.sigma2, 6));
        eig.push(maat("Materiaal_tau12", "IFCPRESSUREMEASURE", el.materiaalassen.tau12, 6));
      }
      schrijfSet(w, "OpenFEM_Plaatelement", `${p}:plaat:${plaat.plateId}:${el.elementId}`, eig, [actie]);
      leden.push(actie);
    }
  }
  schrijfSet(w, "OpenFEM_Resultaatgroep", p, groepEig, [groep]);
  if (leden.length > 0) {
    w.ent("IFCRELASSIGNSTOGROUP", w.guid(`${p}:leden`), "$", "$", "$", lijst(leden), "$", ref(groep));
  }
  return groep;
}

function schrijf3DResultaat(
  w: SpfSchrijver, ids: IfcAnalysemodelIds,
  soort: "geval" | "combinatie", id: number, naam: string, r: OpenFem3DSolveResult, lastgroep: number | undefined,
): number {
  const p = `res:3d:${soort}:${id}`;
  const groep = resultaatGroep(w, "3D", soort, id, naam, theorie3D(r), lastgroep);
  const leden: number[] = [];
  for (const d of r.displacements) {
    const last = w.ent("IFCSTRUCTURALLOADSINGLEDISPLACEMENT", stepString(`u ${d.nodeId}`),
      reeelExact(d.ux), reeelExact(d.uy), reeelExact(d.uz), reeelExact(d.rx), reeelExact(d.ry), reeelExact(d.rz));
    const actie = w.ent("IFCSTRUCTURALPOINTREACTION", w.guid(`${p}:u:${d.nodeId}`), "$",
      stepString(`Verplaatsing knoop ${d.nodeId}`), "$", stepString(`${SLEUTEL}verplaatsing:${d.nodeId}`),
      "$", "$", ref(last), ".GLOBAL_COORDS.");
    koppel(w, `${p}:u:${d.nodeId}`, ids.connectiePerKnoop.get(d.nodeId), actie);
    leden.push(actie);
  }
  for (const f of r.reactions) {
    const last = w.ent("IFCSTRUCTURALLOADSINGLEFORCE", stepString(`R ${f.nodeId}`),
      reeelExact(f.fx, 3), reeelExact(f.fy, 3), reeelExact(f.fz, 3),
      reeelExact(f.mx, 3), reeelExact(f.my, 3), reeelExact(f.mz, 3));
    const actie = w.ent("IFCSTRUCTURALPOINTREACTION", w.guid(`${p}:r:${f.nodeId}`), "$",
      stepString(`Reactie knoop ${f.nodeId}`), "$", stepString(`${SLEUTEL}reactie:${f.nodeId}`),
      "$", "$", ref(last), ".GLOBAL_COORDS.");
    koppel(w, `${p}:r:${f.nodeId}`, ids.connectiePerKnoop.get(f.nodeId), actie);
    leden.push(actie);
  }
  for (const m of r.memberForces) {
    const kracht = (kant: "Start" | "End") => {
      const v = ["$", "$", "$", "$", "$", "$"];
      for (const [veld, plek, eenheid] of STAAF3D_KRACHTEN) {
        v[plek - 1] = reeelExact((m as unknown as Record<string, number>)[`${veld}${kant}${eenheid}`], 3);
      }
      return w.ent("IFCSTRUCTURALLOADSINGLEFORCE", `'${kant}'`, ...v);
    };
    const config = w.ent("IFCSTRUCTURALLOADCONFIGURATION", "'Eindkrachten'",
      lijst([kracht("Start"), kracht("End")]), `((0.),(${reeelExact(m.lengthM)}))`);
    const actie = w.ent("IFCSTRUCTURALCURVEREACTION", w.guid(`${p}:staaf:${m.memberId}:eind`), "$",
      stepString(`Eindkrachten staaf ${m.memberId}`), "$", stepString(`${SLEUTEL}staaf:${m.memberId}:eindkrachten`),
      "$", "$", ref(config), ".LOCAL_COORDS.", ".DISCRETE.");
    koppel(w, `${p}:staaf:${m.memberId}:eind`, ids.memberPerStaaf.get(m.memberId), actie);
    leden.push(actie);
  }
  // Snedekrachtlijnen: per staaf één curve-reactie per groep componenten met
  // dezelfde stations (normaal één groep met alle zes).
  if (r.diagrams) {
    const perStaaf = new Map<number, { comp: keyof OpenFem3DDiagrams; plek: number; d: OpenFem3DMemberDiagram }[]>();
    for (const [comp, plek] of DIAGRAM_COMPONENTEN) {
      for (const d of r.diagrams[comp] ?? []) {
        const lijstje = perStaaf.get(d.memberId) ?? [];
        lijstje.push({ comp, plek, d });
        perStaaf.set(d.memberId, lijstje);
      }
    }
    const lengte = new Map(r.memberForces.map((m) => [m.memberId, m.lengthM]));
    for (const [staaf, comps] of perStaaf) {
      const groepen = new Map<string, typeof comps>();
      for (const c of comps) {
        const sleutel = c.d.points.map((q) => reeelExact(q.t)).join(",");
        groepen.set(sleutel, [...(groepen.get(sleutel) ?? []), c]);
      }
      let volgnummer = 0;
      for (const leden2 of groepen.values()) {
        volgnummer += 1;
        const punten = leden2[0].d.points;
        const L = lengte.get(staaf) ?? 1;
        const waarden = punten.map((_, i) => {
          const v = ["$", "$", "$", "$", "$", "$"];
          for (const c of leden2) v[c.plek - 1] = reeelExact(c.d.points[i].value, 3);
          return w.ent("IFCSTRUCTURALLOADSINGLEFORCE", "$", ...v);
        });
        const config = w.ent("IFCSTRUCTURALLOADCONFIGURATION", "'Snedekrachtlijnen'", lijst(waarden),
          `(${punten.map((q) => `(${reeelExact(q.t * L)})`).join(",")})`);
        const seed = `${p}:staaf:${staaf}:lijn:${volgnummer}`;
        const actie = w.ent("IFCSTRUCTURALCURVEREACTION", w.guid(seed), "$",
          stepString(`Snedekrachtlijnen staaf ${staaf}`), "$",
          stepString(`${SLEUTEL}staaf:${staaf}:lijnen:${leden2.map((c) => c.comp).join("+")}`),
          "$", "$", ref(config), ".LOCAL_COORDS.", ".DISCRETE.");
        koppel(w, seed, ids.memberPerStaaf.get(staaf), actie);
        const eig: Eig[] = [{ naam: "T", waarde: `IFCLABEL(${stepString(punten.map((q) => reeelExact(q.t)).join(" "))})` }];
        for (const c of leden2) {
          eig.push(maat(`${c.comp}_max`, "IFCREAL", c.d.maxValue, 3));
          eig.push(maat(`${c.comp}_min`, "IFCREAL", c.d.minValue, 3));
          eig.push(maat(`${c.comp}_maxAbs`, "IFCREAL", c.d.maxAbsValue, 3));
        }
        schrijfSet(w, "OpenFEM_Snedekrachtlijn", seed, eig, [actie]);
        leden.push(actie);
      }
    }
  }
  for (const el of r.shellElements ?? []) {
    const seed = `${p}:schaal:${el.plateId}:${el.elementId}`;
    const last = w.ent("IFCSTRUCTURALLOADPLANARFORCE", "'Schaalelement'", "$", "$", "$");
    const actie = w.ent("IFCSTRUCTURALSURFACEREACTION", w.guid(seed), "$",
      stepString(`Plaat ${el.plateId} element ${el.elementId}`), "$",
      stepString(`${SLEUTEL}schaalelement:${el.plateId}:${el.elementId}`),
      "$", "$", ref(last), ".LOCAL_COORDS.", ".CONST.");
    koppel(w, seed, ids.memberPerPlaat.get(el.plateId), actie);
    schrijfSet(w, "OpenFEM_Schaalelement", seed, [
      maat("ZwaartepuntX", "IFCLENGTHMEASURE", el.centroidM[0]),
      maat("ZwaartepuntY", "IFCLENGTHMEASURE", el.centroidM[1]),
      maat("ZwaartepuntZ", "IFCLENGTHMEASURE", el.centroidM[2]),
      ...veldEigenschappen(el, SCHAAL_VELDEN),
    ], [actie]);
    leden.push(actie);
  }
  for (const kn of r.shellNodes ?? []) {
    const seed = `${p}:schaalknoop:${kn.plateId}:${kn.nodeId}`;
    const last = w.ent("IFCSTRUCTURALLOADSINGLEDISPLACEMENT", "'w'", "$", "$", reeelExact(kn.wM), "$", "$", "$");
    const actie = w.ent("IFCSTRUCTURALPOINTREACTION", w.guid(seed), "$",
      stepString(`Plaat ${kn.plateId} knoop ${kn.nodeId}`), "$",
      stepString(`${SLEUTEL}schaalknoop:${kn.plateId}:${kn.nodeId}`),
      "$", "$", ref(last), ".LOCAL_COORDS.");
    schrijfSet(w, "OpenFEM_Schaalknoop", seed, veldEigenschappen(kn, SCHAAL_VELDEN), [actie]);
    leden.push(actie);
  }
  const groepEig: Eig[] = [
    label("Soort", soort), geheel("Id", id), geheel("SchemaVersion", r.schemaVersion),
    label("Analyse", r.analysis),
    label("EngineId", r.engine.id), label("EngineName", r.engine.name),
    label("EngineRevision", r.engine.revision), label("EngineLicense", r.engine.license),
  ];
  if (r.nativeAnalysis) groepEig.push(label("NativeAnalysis", r.nativeAnalysis));
  if (r.inactiveMembers) groepEig.push(label("InactieveStaven", r.inactiveMembers.join(",")));
  schrijfSet(w, "OpenFEM_Resultaatgroep", p, groepEig, [groep]);
  if (leden.length > 0) {
    w.ent("IFCRELASSIGNSTOGROUP", w.guid(`${p}:leden`), "$", "$", "$", lijst(leden), "$", ref(groep));
  }
  return groep;
}

/**
 * Bouwt het `.ifcfemresults`-bestand: het rekenmodel van de IFC-export plus
 * de resultaten. Deterministisch zonder `opties.tijdstempel`.
 */
export function bouwIfcResultaten(
  model: IfcRekenmodelInput,
  resultaten: IfcResultatenInvoer,
  opties: Omit<IfcExportOpties, "resultaten" | "zonderLasten"> = {},
): string {
  const geval = (id: number) => model.loadCases.find((c) => c.id === id)?.name ?? `Belastinggeval ${id}`;
  const combinatie = (id: number) => model.combinations?.find((c) => c.id === id)?.name ?? `Combinatie ${id}`;
  return bouwIfcRekenmodel(model, {
    ...opties,
    resultaten: ({ w, project, context, tweeD, drieD }) => {
      if (resultaten.projectTekst !== undefined) {
        schrijfSet(w, "OpenFEM_Projectbestand", "projectbestand", [
          label("Formaat", "ifcfem"),
          { naam: "Inhoud", waarde: `IFCTEXT(${stepString(resultaten.projectTekst)})` },
        ], [project]);
      }
      const resultaten2D: number[] = [];
      const resultaten3D: number[] = [];
      if (resultaten.tweeD) {
        for (const [id, r] of resultaten.tweeD.perCase) {
          resultaten2D.push(schrijf2DResultaat(w, tweeD, context, "geval", id, geval(id), r, model.analysetype));
        }
        for (const [id, r] of resultaten.tweeD.combinaties) {
          resultaten2D.push(schrijf2DResultaat(w, tweeD, context, "combinatie", id, combinatie(id), r, model.analysetype));
        }
      }
      if (resultaten.drieD) {
        // Zonder 3D-analysemodel (geen staven of platen) hangen de groepen los;
        // de knoop-id's in hun ObjectType blijven leesbaar.
        const ids3d: IfcAnalysemodelIds = drieD ?? {
          analyseModel: 0, connectiePerKnoop: new Map(), memberPerStaaf: new Map(), memberPerPlaat: new Map(),
          groepPerCase: new Map(), groepPerCombinatie: new Map(),
        };
        for (const [id, r] of resultaten.drieD.perCase) {
          resultaten3D.push(schrijf3DResultaat(w, ids3d, "geval", id, geval(id), r, ids3d.groepPerCase.get(id)));
        }
        for (const [id, r] of resultaten.drieD.combinaties) {
          // De 3D-export schrijft geen combinaties; hier wel, met hun factoren
          // op de gevallen die als belastinggroep in het bestand staan.
          const combo = model.combinations?.find((c) => c.id === id);
          const lastgroep = w.ent("IFCSTRUCTURALLOADGROUP",
            w.guid(`3d:combinatie:${id}`), "$", stepString(combinatie(id)), "$", "$",
            ".LOAD_COMBINATION.", ".USERDEFINED.", ".USERDEFINED.", "$",
            stepString(combo?.type === "sls" ? "BGT" : "UGT"));
          for (const [caseId, factor] of [...(combo?.factors ?? new Map<number, number>())].sort((a, b) => a[0] - b[0])) {
            const g = ids3d.groepPerCase.get(caseId);
            if (g === undefined || factor === 0) continue;
            w.ent("IFCRELASSIGNSTOGROUPBYFACTOR", w.guid(`3d:combinatie:${id}:geval:${caseId}`), "$", "$", "$",
              lijst([g]), "$", ref(lastgroep), reeelExact(factor));
          }
          resultaten3D.push(schrijf3DResultaat(w, ids3d, "combinatie", id, combinatie(id), r, lastgroep));
        }
      }
      return { resultaten2D, resultaten3D };
    },
  });
}

// ── Lezen ───────────────────────────────────────────────────────────────────

type Psets = Map<number, Map<string, StepWaarde>>;

function verzamelPsets(records: Map<number, StepRecord>): Psets {
  const uit: Psets = new Map();
  for (const rec of records.values()) {
    if (rec.type !== "IFCRELDEFINESBYPROPERTIES") continue;
    const objecten = rec.args[4];
    const setRef = rec.args[5];
    if (!Array.isArray(objecten) || !(setRef instanceof StepRef)) continue;
    const set = records.get(setRef.id);
    if (!set || set.type !== "IFCPROPERTYSET" || !Array.isArray(set.args[4])) continue;
    const eigenschappen = new Map<string, StepWaarde>();
    for (const e of set.args[4]) {
      const p = e instanceof StepRef ? records.get(e.id) : undefined;
      if (p?.type === "IFCPROPERTYSINGLEVALUE" && typeof p.args[0] === "string") eigenschappen.set(p.args[0], p.args[2]);
    }
    for (const o of objecten) {
      if (!(o instanceof StepRef)) continue;
      const bestaand = uit.get(o.id) ?? new Map<string, StepWaarde>();
      for (const [k, v] of eigenschappen) bestaand.set(k, v);
      uit.set(o.id, bestaand);
    }
  }
  return uit;
}

function tekstVan(v: StepWaarde | undefined): string | undefined {
  if (v instanceof StepGetypt) return tekstVan(v.waarde);
  return typeof v === "string" ? v : undefined;
}

function getalVan(v: StepWaarde | undefined, verschuiving = 0): number {
  const x = leesExact(v, verschuiving);
  return x === undefined ? NaN : x;
}

function idLijst(v: string | undefined): number[] {
  return v ? v.split(",").filter((s) => s.trim() !== "").map(Number) : [];
}

/**
 * Leest een `.ifcfemresults`-bestand terug. Alleen de resultaatgroepen die
 * Open FEM Studio zelf schreef (ObjectType `OpenFEM:…`) worden herkend;
 * resultaten van andere programma's worden overgeslagen.
 */
export function leesIfcResultaten(tekst: string): IfcResultatenGelezen {
  const bestand = leesStep(tekst, { getallenAlsTekst: true });
  if (!bestand.schemas.includes("IFC4")) {
    throw new IfcResultatenFout("Dit is geen IFC4-bestand: FILE_SCHEMA noemt geen IFC4.");
  }
  const records = bestand.records;
  const rec = (v: StepWaarde | undefined): StepRecord | undefined =>
    v instanceof StepRef ? records.get(v.id) : undefined;
  const psets = verzamelPsets(records);

  let projectTekst: string | null = null;
  for (const r of records.values()) {
    if (r.type !== "IFCPROJECT") continue;
    const inhoud = tekstVan(psets.get(r.id)?.get("Inhoud"));
    if (inhoud !== undefined) projectTekst = inhoud;
  }

  // Leden per groep.
  const ledenPerGroep = new Map<number, StepRecord[]>();
  for (const r of records.values()) {
    if (r.type !== "IFCRELASSIGNSTOGROUP") continue;
    const g = r.args[6];
    if (!(g instanceof StepRef) || !Array.isArray(r.args[4])) continue;
    const lijstje = ledenPerGroep.get(g.id) ?? [];
    for (const o of r.args[4]) {
      const lid = rec(o);
      if (lid) lijstje.push(lid);
    }
    ledenPerGroep.set(g.id, lijstje);
  }

  const uit: IfcResultatenGelezen = {
    projectTekst,
    tweeD: { perCase: new Map(), combinaties: new Map() },
    drieD: { perCase: new Map(), combinaties: new Map() },
    groepen: [],
  };
  for (const g of records.values()) {
    if (g.type !== "IFCSTRUCTURALRESULTGROUP") continue;
    const sleutel = tekstVan(g.args[4]) ?? "";
    const m = /^OpenFEM:(2D|3D):(geval|combinatie):(-?\d+)$/.exec(sleutel);
    if (!m) continue;
    const dimensie = m[1] as "2D" | "3D";
    const soort = m[2] as "geval" | "combinatie";
    const id = Number(m[3]);
    const naam = (tekstVan(g.args[2]) ?? "").replace(/^Resultaten /, "");
    const theorie = g.args[5] instanceof StepEnum ? g.args[5].waarde : "NOTDEFINED";
    const lineair = g.args[7] instanceof StepEnum ? g.args[7].waarde === "T" : true;
    uit.groepen.push({ dimensie, soort, id, naam, theorie, lineair });
    const leden = ledenPerGroep.get(g.id) ?? [];
    const groepEig = psets.get(g.id) ?? new Map<string, StepWaarde>();
    if (dimensie === "2D") {
      const r = lees2D(leden, groepEig, psets, rec);
      (soort === "geval" ? uit.tweeD.perCase : uit.tweeD.combinaties).set(id, r);
    } else {
      const r = lees3D(leden, groepEig, psets, rec);
      (soort === "geval" ? uit.drieD.perCase : uit.drieD.combinaties).set(id, r);
    }
  }
  return uit;
}

type RecVan = (v: StepWaarde | undefined) => StepRecord | undefined;

function configuratie(actie: StepRecord, rec: RecVan): { waarden: StepRecord[]; locaties: StepWaarde[] } {
  const config = rec(actie.args[7]);
  const waarden = Array.isArray(config?.args[1])
    ? config.args[1].map(rec).filter((x): x is StepRecord => x !== undefined) : [];
  const locaties = Array.isArray(config?.args[2])
    ? config.args[2].map((l) => (Array.isArray(l) ? l[0] : l)) : [];
  return { waarden, locaties };
}

function lees2D(leden: StepRecord[], groepEig: Map<string, StepWaarde>, psets: Psets, rec: RecVan): SolverResult {
  const displacements = new Map<number, NodalDisp>();
  const reactions = new Map<number, NodalReaction>();
  const elements = new Map<number, ElementForces>();
  const plateNodeDisplacements = new Map<number, { ux: number; uz: number }>();
  const platen = new Map<number, PlateElementStress[]>();
  const staafVerpl = new Map<number, StepRecord>();
  for (const lid of leden) {
    const sleutel = tekstVan(lid.args[4]) ?? "";
    let m: RegExpExecArray | null;
    if ((m = /^OpenFEM:verplaatsing:(-?\d+)$/.exec(sleutel))) {
      const a = rec(lid.args[7])?.args ?? [];
      displacements.set(Number(m[1]), { ux: getalVan(a[1], -3), uz: getalVan(a[3], -3), ry: getalVan(a[5]) });
    } else if ((m = /^OpenFEM:reactie:(-?\d+)$/.exec(sleutel))) {
      const a = rec(lid.args[7])?.args ?? [];
      reactions.set(Number(m[1]), { fx: getalVan(a[1]), fz: getalVan(a[3]), my: getalVan(a[5], -3) });
    } else if ((m = /^OpenFEM:plaatknoop:(-?\d+)$/.exec(sleutel))) {
      const a = rec(lid.args[7])?.args ?? [];
      plateNodeDisplacements.set(Number(m[1]), { ux: getalVan(a[1], -3), uz: getalVan(a[3], -3) });
    } else if ((m = /^OpenFEM:staaf:(-?\d+):krachten$/.exec(sleutel))) {
      const { waarden, locaties } = configuratie(lid, rec);
      const e = psets.get(lid.id) ?? new Map<string, StepWaarde>();
      elements.set(Number(m[1]), {
        N: getalVan(e.get("N")), V: getalVan(e.get("V")),
        M_start: getalVan(e.get("M_start"), -3), M_end: getalVan(e.get("M_end"), -3),
        L_mm: getalVan(e.get("L"), -3),
        stations_mm: locaties.map((l) => getalVan(l, -3)),
        normalForce: waarden.map((w) => getalVan(w.args[1])),
        shearForce: waarden.map((w) => getalVan(w.args[2])),
        bendingMoment: waarden.map((w) => getalVan(w.args[6], -3)),
        deflection: [], axialDisp: [],
      });
    } else if ((m = /^OpenFEM:staaf:(-?\d+):verplaatsingen$/.exec(sleutel))) {
      staafVerpl.set(Number(m[1]), lid);
    } else if ((m = /^OpenFEM:plaatelement:(-?\d+):(-?\d+)$/.exec(sleutel))) {
      const e = psets.get(lid.id) ?? new Map<string, StepWaarde>();
      const el = { elementId: Number(m[2]), corners: hoekpunten(lid, rec) } as PlateElementStress;
      const doel = el as unknown as Record<string, number>;
      for (const [veld, , verschuiving] of PLAAT2D_VELDEN) {
        if (e.has(veld)) doel[veld] = getalVan(e.get(veld), verschuiving);
      }
      if (e.has("Materiaal_sigma1")) {
        el.materiaalassen = {
          sigma1: getalVan(e.get("Materiaal_sigma1"), 6),
          sigma2: getalVan(e.get("Materiaal_sigma2"), 6),
          tau12: getalVan(e.get("Materiaal_tau12"), 6),
        };
      }
      const plaatId = Number(m[1]);
      platen.set(plaatId, [...(platen.get(plaatId) ?? []), el]);
    }
  }
  for (const [staaf, lid] of staafVerpl) {
    const e = elements.get(staaf);
    if (!e) continue;
    const { waarden } = configuratie(lid, rec);
    e.axialDisp = waarden.map((w) => getalVan(w.args[1], -3));
    e.deflection = waarden.map((w) => getalVan(w.args[2], -3));
    if (waarden.some((w) => w.args[6] !== null)) e.rotation = waarden.map((w) => getalVan(w.args[6]));
  }
  // Platen die geen enkel element met spanningen hadden, staan alleen als kenmerk in de groep.
  for (const naam of groepEig.keys()) {
    const m = /^Plaat(-?\d+)_/.exec(naam);
    if (m && !platen.has(Number(m[1]))) platen.set(Number(m[1]), []);
  }
  const uit: SolverResult = {
    displacements, reactions, elements,
    maxDisplacement: getalVan(groepEig.get("MaxVerplaatsing"), -3),
  };
  if (platen.size > 0) {
    uit.plateElements = [...platen].map(([plateId, els]) => plaatResultaat(plateId, els, groepEig));
    uit.plateNodeDisplacements = plateNodeDisplacements;
  }
  const trek = tekstVan(groepEig.get("TrekAlleenUitgeschakeld"));
  if (trek !== undefined) uit.trekAlleenUitgeschakeld = idLijst(trek);
  return uit;
}

/** Ranges zoals engine.ts ze bepaalt: min/max over de elementen, leeg → 0. */
function plaatResultaat(plateId: number, elements: PlateElementStress[], groepEig: Map<string, StepWaarde>): PlateResult {
  const bereik = (k: keyof PlateResult["ranges"]) => {
    let min = Infinity, max = -Infinity;
    for (const el of elements) { min = Math.min(min, el[k]); max = Math.max(max, el[k]); }
    return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
  };
  const uit: PlateResult = {
    plateId, elements,
    ranges: {
      sigmaX: bereik("sigmaX"), sigmaY: bereik("sigmaY"), tauXY: bereik("tauXY"), vonMises: bereik("vonMises"),
      nx: bereik("nx"), ny: bereik("ny"), nxy: bereik("nxy"),
    },
  };
  const verwacht = tekstVan(groepEig.get(`Plaat${plateId}_VerwachteElementen`));
  if (verwacht !== undefined) uit.expectedElementIds = idLijst(verwacht);
  const hoek = groepEig.get(`Plaat${plateId}_MateriaalHoekGraden`);
  if (hoek !== undefined) uit.materiaalassen = materiaalasRanges(elements, getalVan(hoek));
  return uit;
}

function hoekpunten(actie: StepRecord, rec: RecVan): { x: number; z: number }[] {
  const vorm = rec(actie.args[6]);
  const topo = Array.isArray(vorm?.args[2]) ? rec(vorm.args[2][0]) : undefined;
  const vlak = Array.isArray(topo?.args[3]) ? rec(topo.args[3][0]) : undefined;
  const rand = Array.isArray(vlak?.args[0]) ? rec(vlak.args[0][0]) : undefined;
  const lus = rec(rand?.args[0]);
  if (!lus || !Array.isArray(lus.args[0])) return [];
  return lus.args[0].map((p) => {
    const c = rec(p)?.args[0];
    const xyz = Array.isArray(c) ? c : [];
    return { x: getalVan(xyz[0], -3), z: getalVan(xyz[2], -3) };
  });
}

function lees3D(leden: StepRecord[], groepEig: Map<string, StepWaarde>, psets: Psets, rec: RecVan): OpenFem3DSolveResult {
  const t = (k: string) => tekstVan(groepEig.get(k)) ?? "";
  const uit: OpenFem3DSolveResult = {
    schemaVersion: (getalVan(groepEig.get("SchemaVersion")) === 2 ? 2 : 1),
    engine: { id: t("EngineId"), name: t("EngineName"), revision: t("EngineRevision"), license: t("EngineLicense") },
    analysis: t("Analyse") === "p-delta" ? "p-delta" : "linear",
    displacements: [], reactions: [], memberForces: [],
    buckling: { status: "notApplicable", reason: "Gelezen uit een .ifcfemresults-bestand; de knikanalyse wordt niet opgeslagen." },
    diagnostics: [],
  };
  const native = tekstVan(groepEig.get("NativeAnalysis"));
  if (native !== undefined) uit.nativeAnalysis = native as OpenFem3DSolveResult["nativeAnalysis"];
  const inactief = tekstVan(groepEig.get("InactieveStaven"));
  if (inactief !== undefined) uit.inactiveMembers = idLijst(inactief);
  const diagrammen: OpenFem3DDiagrams = { momentY: [], momentZ: [], shearY: [], shearZ: [], axial: [], torsion: [] };
  let heeftDiagrammen = false;
  const schaalElementen: OpenFem3DShellElementResult[] = [];
  const schaalKnopen: OpenFem3DShellNodeResult[] = [];
  for (const lid of leden) {
    const sleutel = tekstVan(lid.args[4]) ?? "";
    let m: RegExpExecArray | null;
    if ((m = /^OpenFEM:verplaatsing:(-?\d+)$/.exec(sleutel))) {
      const a = rec(lid.args[7])?.args ?? [];
      uit.displacements.push({
        nodeId: Number(m[1]),
        ux: getalVan(a[1]), uy: getalVan(a[2]), uz: getalVan(a[3]),
        rx: getalVan(a[4]), ry: getalVan(a[5]), rz: getalVan(a[6]),
      });
    } else if ((m = /^OpenFEM:reactie:(-?\d+)$/.exec(sleutel))) {
      const a = rec(lid.args[7])?.args ?? [];
      uit.reactions.push({
        nodeId: Number(m[1]),
        fx: getalVan(a[1], 3), fy: getalVan(a[2], 3), fz: getalVan(a[3], 3),
        mx: getalVan(a[4], 3), my: getalVan(a[5], 3), mz: getalVan(a[6], 3),
      });
    } else if ((m = /^OpenFEM:staaf:(-?\d+):eindkrachten$/.exec(sleutel))) {
      const { waarden, locaties } = configuratie(lid, rec);
      const krachten: Record<string, number> = { memberId: Number(m[1]), lengthM: getalVan(locaties[1]) };
      for (const [veld, plek, eenheid] of STAAF3D_KRACHTEN) {
        krachten[`${veld}Start${eenheid}`] = getalVan(waarden[0]?.args[plek], 3);
        krachten[`${veld}End${eenheid}`] = getalVan(waarden[1]?.args[plek], 3);
      }
      uit.memberForces.push(krachten as unknown as OpenFem3DMemberForces);
    } else if ((m = /^OpenFEM:staaf:(-?\d+):lijnen:(.+)$/.exec(sleutel))) {
      heeftDiagrammen = true;
      const { waarden } = configuratie(lid, rec);
      const e = psets.get(lid.id) ?? new Map<string, StepWaarde>();
      const ts = (tekstVan(e.get("T")) ?? "").split(" ").filter(Boolean)
        .map((s) => getalVan(new StepGetal(s, Number(s))));
      for (const comp of m[2].split("+") as (keyof OpenFem3DDiagrams)[]) {
        const plek = DIAGRAM_COMPONENTEN.find(([c]) => c === comp)?.[1];
        if (plek === undefined) continue;
        diagrammen[comp].push({
          memberId: Number(m[1]),
          points: ts.map((tt, i) => ({ t: tt, value: getalVan(waarden[i]?.args[plek], 3) })),
          maxValue: getalVan(e.get(`${comp}_max`), 3),
          minValue: getalVan(e.get(`${comp}_min`), 3),
          maxAbsValue: getalVan(e.get(`${comp}_maxAbs`), 3),
        });
      }
    } else if ((m = /^OpenFEM:schaalelement:(-?\d+):(-?\d+)$/.exec(sleutel))) {
      const e = psets.get(lid.id) ?? new Map<string, StepWaarde>();
      const el: Record<string, unknown> = {
        elementId: Number(m[2]), plateId: Number(m[1]),
        centroidM: [getalVan(e.get("ZwaartepuntX")), getalVan(e.get("ZwaartepuntY")), getalVan(e.get("ZwaartepuntZ"))],
      };
      for (const [veld, , verschuiving] of SCHAAL_VELDEN) if (e.has(veld)) el[veld] = getalVan(e.get(veld), verschuiving);
      schaalElementen.push(el as unknown as OpenFem3DShellElementResult);
    } else if ((m = /^OpenFEM:schaalknoop:(-?\d+):(-?\d+)$/.exec(sleutel))) {
      const e = psets.get(lid.id) ?? new Map<string, StepWaarde>();
      const a = rec(lid.args[7])?.args ?? [];
      const kn: Record<string, unknown> = { nodeId: Number(m[2]), plateId: Number(m[1]), wM: getalVan(a[3]) };
      for (const [veld, , verschuiving] of SCHAAL_VELDEN) if (e.has(veld)) kn[veld] = getalVan(e.get(veld), verschuiving);
      schaalKnopen.push(kn as unknown as OpenFem3DShellNodeResult);
    }
  }
  if (heeftDiagrammen) uit.diagrams = diagrammen;
  if (schaalElementen.length > 0) uit.shellElements = schaalElementen;
  if (schaalKnopen.length > 0) uit.shellNodes = schaalKnopen;
  return uit;
}

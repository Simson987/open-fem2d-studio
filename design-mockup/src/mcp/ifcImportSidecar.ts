/**
 * ifcImportSidecar.ts — de twee sidecarbewerkingen achter de MCP-tool
 * `open_fem_3d_ifc_importeren`.
 *
 * DE KETEN, en wie wat doet
 *   1. Rust leest het .ifc-bestand van schijf en stuurt de tekst mee.
 *   2. `ifc_importeren` (hier): de import van de app (`io/ifcAnalyseImport.ts`,
 *      dezelfde functie als de knop "Rekenmodel importeren") levert de lijst
 *      analysemodellen, het projectbestand en het verslag. Met `reken` erbij
 *      komen er per belast geval en per combinatie rekenverzoeken voor de
 *      3D-kern bij, gebouwd met `buildOpenFem3DSolveRequest` — dezelfde
 *      functie als de knop Berekenen, inclusief de omzetting van de
 *      belastingvlakken en het eigen gewicht (`withOpenFem3DSelfWeight`).
 *      De combinaties zijn die uit het bestand; heeft het bestand er geen,
 *      dan de standaardset van de app (NEN-EN 1990) voor de gekozen klasse.
 *   3. Rust rekent elk verzoek met `open_fem_3d::solve`.
 *   4. `ifc_uitwerken` (hier): reactiesommen en evenwicht (kern én de
 *      onafhankelijke krachtensom) per geval en combinatie, de grootste
 *      verplaatsing en de EN 1993-toetsinvoer met
 *      `buildOpenFem3DSteelCheckInputs`.
 *   5. Rust toetst met `steel_check::check_all_beams`.
 *
 * Kan het model (nog) niet gerekend worden — een onderdeel dat de 3D-kern
 * niet kent, een staaf zonder profiel — dan zegt `rekenen.reden` waarom, en
 * komt het model gewoon terug. Er wordt niets weggelaten om toch te rekenen.
 *
 * DE TOETSKRACHTEN (issue #199, B9). `reken.analyse` geldt alleen voor de
 * resultaten (zonder scheefstand). Met `toetsen` (standaard aan) levert stap 2
 * ook de `toetsverzoeken`: elke UGT-combinatie P-Δ met scheefstand in +X, −X,
 * +Y en −Y (`toets3dSidecar.ts`, dezelfde functies als de app), met de φ van
 * het projectbestand van de import. Rust rekent ze mee, een mislukte als
 * `{ fout }`; stap 4 stelt de toetskrachten samen (UGT uit de toets, BGT uit
 * de resultaten) of geeft de `toetsweigering` met de reden per combinatie.
 *
 * DETERMINISME. Beide bewerkingen importeren het bestand opnieuw; de import is
 * een pure functie, dus stap 4 ziet precies het model en de verzoeken van
 * stap 2. Een resultaat dat bij een ander verzoek hoort, wordt aan de
 * sleutels en de knoopnummers herkend en geweigerd.
 */
import { eigenGewichtGeval } from "../lib/eigenGewicht";
import { defaultCombinations, type LoadCombination } from "../components/fem/solver/combinations";
import { GEVOLGKLASSEN, STANDAARD_GEVOLGKLASSE, type Gevolgklasse } from "../components/fem/solver/normcombinaties";
import { openFem3DLoadCaseId, withOpenFem3DSelfWeight, type OpenFem3DModel } from "../components/openFem3d/openFem3dModel";
import {
  buildOpenFem3DSolveRequest,
  openFem3DGlobalForceBalance,
  type OpenFem3DAnalysisKind,
  type OpenFem3DSolveResult,
} from "../components/openFem3d/openFem3dSolver";
import { openFem3DMaximumDisplacementM } from "../components/openFem3d/openFem3dDisplacement";
import { buildOpenFem3DSteelCheckInputs } from "../components/openFem3d/openFem3dSteelCheck";
import {
  ifcAnalyseModellen,
  ifcAnalyseProject,
  importeerIfcAnalyseModel,
  leesIfcAnalyseBestand,
  type IfcAnalyseImport,
} from "../io/ifcAnalyseImport";
import { serializeProject } from "../io/projectFile";
import {
  leesToetsen,
  toets3DOpzet,
  toets3DUitwerken,
  toets3DVerzoeken,
  vormToetsanalyse3D,
  vormToetsweigering3D,
  type Toets3DOpzet,
} from "./toets3dSidecar";

const IMPORTEREN_VELDEN = ["inhoud", "pad", "analysemodel", "reken", "projectbestand", "toetsen"] as const;
const UITWERKEN_VELDEN = ["inhoud", "analysemodel", "reken", "resultaten", "toetsen", "toetsresultaten"] as const;
const REKEN_VELDEN = ["analyse", "gevolgklasse"] as const;

/** Een payload die niet deugt; de sidecar maakt er INVOER_ONGELDIG van, met het veld. */
export class IfcSidecarInvoerFout extends Error {
  constructor(readonly veld: string, melding: string) {
    super(melding);
    this.name = "IfcSidecarInvoerFout";
  }
}

export interface IfcRekeninstellingen {
  analyse: OpenFem3DAnalysisKind;
  gevolgklasse: Gevolgklasse;
}

function eisVelden(payload: Record<string, unknown>, velden: readonly string[], waar: string): void {
  const onbekend = Object.keys(payload).filter((k) => !velden.includes(k));
  if (onbekend.length > 0) {
    throw new IfcSidecarInvoerFout(onbekend[0], `Onbekend veld \`${onbekend[0]}\` in ${waar}; bekend zijn: ${velden.join(", ")}.`);
  }
}

function leesInhoud(payload: Record<string, unknown>): string {
  if (typeof payload.inhoud !== "string" || payload.inhoud.length === 0) {
    throw new IfcSidecarInvoerFout("inhoud", "`inhoud` moet de tekst van het IFC-bestand zijn.");
  }
  return payload.inhoud;
}

function leesModelKeuze(payload: Record<string, unknown>): string | number | undefined {
  const keuze = payload.analysemodel;
  if (keuze === undefined || keuze === null) return undefined;
  if (typeof keuze === "string" && keuze.trim()) return keuze;
  if (typeof keuze === "number" && Number.isInteger(keuze) && keuze >= 1) return keuze;
  throw new IfcSidecarInvoerFout("analysemodel", "`analysemodel` is de naam van het analysemodel of zijn volgnummer (vanaf 1).");
}

function leesReken(waarde: unknown): IfcRekeninstellingen | null {
  if (waarde === undefined || waarde === null || waarde === false) return null;
  const raw = waarde === true ? {} : waarde;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new IfcSidecarInvoerFout("reken", "`reken` moet een object zijn.");
  const r = raw as Record<string, unknown>;
  eisVelden(r, REKEN_VELDEN, "`reken`");
  const analyse = r.analyse ?? "linear";
  if (analyse !== "linear" && analyse !== "p-delta") {
    throw new IfcSidecarInvoerFout("reken.analyse", '`reken.analyse` moet "linear" of "p-delta" zijn.');
  }
  const gevolgklasse = r.gevolgklasse ?? STANDAARD_GEVOLGKLASSE;
  if (typeof gevolgklasse !== "string" || !(GEVOLGKLASSEN as readonly string[]).includes(gevolgklasse)) {
    throw new IfcSidecarInvoerFout("reken.gevolgklasse", `\`reken.gevolgklasse\` moet een van ${GEVOLGKLASSEN.join(", ")} zijn.`);
  }
  return { analyse, gevolgklasse: gevolgklasse as Gevolgklasse };
}

/** Eén verzoek aan de 3D-kern, met de sleutel waaronder Rust het resultaat teruggeeft. */
export interface IfcRekenverzoek {
  sleutel: string;
  soort: "geval" | "combinatie";
  id: number;
  naam: string;
  verzoek: Omit<ReturnType<typeof buildOpenFem3DSolveRequest>, "bucklingModes"> & { bucklingModes: number };
}

type Rekenopzet =
  | {
      mogelijk: true; rekenmodel: OpenFem3DModel; combinaties: LoadCombination[]; verzoeken: IfcRekenverzoek[];
      bron: "bestand" | "standaard";
      /** Het geval met het automatische eigen gewicht; ontbreekt als het bestand dat niet vraagt. */
      eigenGewichtGeval?: number;
    }
  | { mogelijk: false; reden: string };

/**
 * De verzoeken zoals de knop Berekenen ze opbouwt: alleen belaste gevallen,
 * en alleen de combinaties waarin minstens één belast geval meedoet.
 */
function rekenopzet(imp: IfcAnalyseImport, reken: IfcRekeninstellingen): Rekenopzet {
  try {
    const egGeval = eigenGewichtGeval(imp.loadCases, imp.selfWeightCaseId !== undefined);
    const rekenmodel = egGeval ? withOpenFem3DSelfWeight(imp.model3d, egGeval.id) : imp.model3d;
    const belast = new Set<number>([
      ...(rekenmodel.loads ?? []).map(openFem3DLoadCaseId),
      ...(rekenmodel.memberLoads ?? []).map(openFem3DLoadCaseId),
      ...(rekenmodel.memberPointLoads ?? []).map(openFem3DLoadCaseId),
      ...(rekenmodel.loadPanels ?? []).map(openFem3DLoadCaseId),
    ]);
    const bron = imp.combinations.length > 0 ? "bestand" as const : "standaard" as const;
    const combinaties = (bron === "bestand" ? imp.combinations : defaultCombinations(imp.loadCases, reken.gevolgklasse))
      .filter((c) => [...belast].some((id) => (c.factors.get(id) ?? 0) !== 0));
    const verzoek = (selectie: number | ReadonlyMap<number, number>) =>
      ({ ...buildOpenFem3DSolveRequest(rekenmodel, reken.analyse, selectie), bucklingModes: 0 });
    const verzoeken: IfcRekenverzoek[] = [
      ...imp.loadCases.filter((c) => belast.has(c.id)).map((c) => ({
        sleutel: `geval:${c.id}`, soort: "geval" as const, id: c.id, naam: c.name, verzoek: verzoek(c.id),
      })),
      ...combinaties.map((c) => ({
        sleutel: `combinatie:${c.id}`, soort: "combinatie" as const, id: c.id, naam: c.name, verzoek: verzoek(c.factors),
      })),
    ];
    if (verzoeken.length === 0) return { mogelijk: false, reden: "Het model heeft geen enkel belast geval." };
    return { mogelijk: true, rekenmodel, combinaties, verzoeken, bron, ...(egGeval ? { eigenGewichtGeval: egGeval.id } : {}) };
  } catch (fout) {
    return { mogelijk: false, reden: fout instanceof Error ? fout.message : String(fout) };
  }
}

/**
 * De UGT-toets van het geïmporteerde model (issue #199): het plan en de
 * verzoeken van `toets3dSidecar.ts`, met de φ van het projectbestand van de
 * import. Puur, dus in `ifc_importeren` en `ifc_uitwerken` dezelfde.
 *
 * Draagt het bestand de scheefstand al als knooplasten (imperfectiegevallen,
 * SYSTEM_IMPERFECTION), dan telt de toets die gevallen met factor 0: hij rekent
 * altijd met de scheefstand van de projectinstelling. Dat doet en meldt
 * `planToetsKrachten3D`, net als in de app (de gevallen dragen
 * `LoadCase.imperfectie`).
 */
function toetsopzet(
  imp: IfcAnalyseImport,
  reken: IfcRekeninstellingen,
  opzet: Extract<Rekenopzet, { mogelijk: true }>,
): Toets3DOpzet {
  return toets3DOpzet({
    model: imp.model3d,
    rekenmodel: opzet.rekenmodel,
    combinaties: opzet.combinaties,
    loadCases: imp.loadCases,
    ...(opzet.eigenGewichtGeval !== undefined ? { selfWeightCaseId: opzet.eigenGewichtGeval } : {}),
    project: ifcAnalyseProject(imp),
    modelAnalyse: reken.analyse,
  });
}

function combinatieNaarJson(c: LoadCombination) {
  return {
    id: c.id, name: c.name, type: c.type, formula: c.formula,
    factors: Object.fromEntries([...c.factors].map(([k, v]) => [String(k), v])),
  };
}

/** Staafnummers per groep (Onderdeel of ObjectType uit het bestand); zonder groep: "overig". */
function groepen(imp: IfcAnalyseImport): Record<string, number[]> {
  const uit: Record<string, number[]> = {};
  for (const beam of imp.model3d.beams) (uit[beam.group ?? "overig"] ??= []).push(beam.id);
  return uit;
}

/**
 * `ifc_importeren`: de modellen in het bestand, het gekozen model als
 * projectbestand met verslag, en — met `reken` — de rekenverzoeken.
 * Gooit `IfcImportFout` (bestand of keuze) of `IfcSidecarInvoerFout` (payload).
 */
export function opIfcImporteren(payload: Record<string, unknown>) {
  eisVelden(payload, IMPORTEREN_VELDEN, "de payload");
  if (payload.pad !== undefined && typeof payload.pad !== "string") {
    throw new IfcSidecarInvoerFout("pad", "`pad` moet tekst zijn.");
  }
  if (payload.projectbestand !== undefined && typeof payload.projectbestand !== "boolean") {
    throw new IfcSidecarInvoerFout("projectbestand", "`projectbestand` moet true of false zijn.");
  }
  const bestand = leesIfcAnalyseBestand(leesInhoud(payload));
  const keuze = leesModelKeuze(payload);
  const reken = leesReken(payload.reken);
  const toetsen = leesToetsen(payload.toetsen, (veld, melding) => new IfcSidecarInvoerFout(veld, melding));
  const modellen = ifcAnalyseModellen(bestand);
  const imp = importeerIfcAnalyseModel(bestand, { model: keuze });
  const gekozen = modellen.find((m) => m.naam === imp.verslag.model) ?? modellen[0];
  const opzet = reken ? rekenopzet(imp, reken) : null;
  const project = ifcAnalyseProject(imp);
  const toets = reken && opzet?.mogelijk && toetsen ? toetsopzet(imp, reken, opzet) : null;
  return {
    pad: typeof payload.pad === "string" ? payload.pad : null,
    modellen,
    analysemodel: { nummer: gekozen.nummer, naam: gekozen.naam },
    project,
    // De tekst van het .ifcfem-bestand, met `format`, `version` en `savedAt`:
    // precies wat Opslaan in de app schrijft (`serializeProject`). Alleen op
    // verzoek — de MCP-server schrijft hem naar `uitvoerpad` (#233).
    ...(payload.projectbestand === true
      ? { projectTekst: serializeProject(project as Parameters<typeof serializeProject>[0]) }
      : {}),
    verslag: imp.verslag,
    groepen: groepen(imp),
    ...(reken && opzet ? (opzet.mogelijk ? {
      reken,
      rekenen: { mogelijk: true, combinatiebron: opzet.bron },
      combinaties: opzet.combinaties.map(combinatieNaarJson),
      rekenverzoeken: opzet.verzoeken,
      ...(toets ? { toetsanalyse: vormToetsanalyse3D(toets), toetsverzoeken: toets3DVerzoeken(toets) } : {}),
    } : {
      reken,
      rekenen: { mogelijk: false, reden: opzet.reden },
    }) : {}),
  };
}

type Vector = { fx: number; fy: number; fz: number };
const somVan = (r: OpenFem3DSolveResult): Vector => r.reactions.reduce(
  (t, x) => ({ fx: t.fx + x.fx, fy: t.fy + x.fy, fz: t.fz + x.fz }), { fx: 0, fy: 0, fz: 0 });

function leesResultaat(resultaten: Record<string, unknown>, v: IfcRekenverzoek): OpenFem3DSolveResult {
  const r = resultaten[v.sleutel] as OpenFem3DSolveResult | undefined;
  if (!r || typeof r !== "object" || !Array.isArray(r.reactions) || !Array.isArray(r.displacements) || !Array.isArray(r.memberForces)) {
    throw new IfcSidecarInvoerFout(`resultaten.${v.sleutel}`, `Het resultaat \`${v.sleutel}\` (${v.naam}) ontbreekt of is geen 3D-rekenresultaat.`);
  }
  const knopen = new Set(v.verzoek.nodes.map((n) => n.id));
  if (r.displacements.length !== knopen.size || r.displacements.some((d) => !knopen.has(d.nodeId))) {
    throw new IfcSidecarInvoerFout(`resultaten.${v.sleutel}`,
      `Het resultaat \`${v.sleutel}\` hoort niet bij dit model: de knoopnummers wijken af van het verzoek.`);
  }
  return r;
}

/**
 * `ifc_uitwerken`: uit de rekenresultaten van Rust de controles per geval en
 * combinatie, en — met `toetsen` (standaard aan) en de `toetsresultaten` van
 * de `toetsverzoeken` — de toetsanalyse en de toetsinvoer voor EN 1993, of de
 * weigering van de toets.
 */
export function opIfcUitwerken(payload: Record<string, unknown>) {
  eisVelden(payload, UITWERKEN_VELDEN, "de payload");
  const imp = importeerIfcAnalyseModel(leesInhoud(payload), { model: leesModelKeuze(payload) });
  const reken = leesReken(payload.reken ?? {})!;
  const invoerFout = (veld: string, melding: string) => new IfcSidecarInvoerFout(veld, melding);
  const toetsen = leesToetsen(payload.toetsen, invoerFout);
  if (!toetsen && payload.toetsresultaten !== undefined) {
    throw invoerFout("toetsresultaten", "`toetsresultaten` horen bij `toetsen: true`.");
  }
  const resultaten = payload.resultaten;
  if (!resultaten || typeof resultaten !== "object" || Array.isArray(resultaten)) {
    throw new IfcSidecarInvoerFout("resultaten", "`resultaten` moet een object zijn.");
  }
  const opzet = rekenopzet(imp, reken);
  if (!opzet.mogelijk) throw new IfcSidecarInvoerFout("reken", `Dit model kan niet gerekend worden: ${opzet.reden}`);
  const bekend = new Set(opzet.verzoeken.map((v) => v.sleutel));
  const vreemd = Object.keys(resultaten).filter((k) => !bekend.has(k));
  if (vreemd.length > 0) {
    throw new IfcSidecarInvoerFout("resultaten", `Onbekende resultaatsleutels: ${vreemd.join(", ")}; verwacht: ${[...bekend].join(", ")}.`);
  }
  const controle = (v: IfcRekenverzoek, r: OpenFem3DSolveResult) => {
    const reactiesom = somVan(r);
    const balans = openFem3DGlobalForceBalance(v.verzoek, r);
    return {
      id: v.id,
      naam: v.naam,
      reactiesomKn: reactiesom,
      // Σ opgebrachte last (met eigen gewicht en belastingvlakken) = restant van de krachtensom − Σ reacties.
      belastingsomKn: {
        fx: balans.imbalanceKn[0] - reactiesom.fx,
        fy: balans.imbalanceKn[1] - reactiesom.fy,
        fz: balans.imbalanceKn[2] - reactiesom.fz,
      },
      evenwicht: {
        kern: r.equilibrium?.equilibriumOk ?? null,
        onafhankelijk: balans.ok,
        restKrachtKn: balans.maxImbalanceKn,
        restMomentKnm: balans.maxMomentImbalanceKnm,
      },
      maxVerplaatsingMm: openFem3DMaximumDisplacementM(imp.model3d, r) * 1000,
    };
  };
  const gevallen = [], combinaties = [];
  const combinatieResultaten = new Map<number, OpenFem3DSolveResult>();
  let basis: OpenFem3DSolveResult | null = null;
  for (const v of opzet.verzoeken) {
    const r = leesResultaat(resultaten as Record<string, unknown>, v);
    if (v.soort === "geval") {
      gevallen.push(controle(v, r));
      basis ??= r;
    } else {
      const c = opzet.combinaties.find((x) => x.id === v.id)!;
      combinaties.push({ ...controle(v, r), type: c.type, formule: c.formula });
      combinatieResultaten.set(v.id, r);
    }
  }
  if (!basis) throw new IfcSidecarInvoerFout("resultaten", "Er is geen enkel belast geval om uit te werken.");
  const uit = { reken, gevallen, combinaties, groepen: groepen(imp) };
  if (!toetsen) return uit;

  // De UGT-toets (issue #199): P-Δ met scheefstand uit de toetsresultaten van
  // Rust, de BGT uit de resultaten hierboven.
  const toetsOpzet = toetsopzet(imp, reken, opzet);
  const { toets, combinationSet, berekeningen } = toets3DUitwerken(toetsOpzet, {
    rekenmodel: opzet.rekenmodel,
    toetsresultaten: payload.toetsresultaten,
    combinaties: opzet.combinaties,
    combinationResults: combinatieResultaten,
    loadCases: imp.loadCases,
    consequenceClass: reken.gevolgklasse,
  }, invoerFout);
  const toetsanalyse = { ...vormToetsanalyse3D(toetsOpzet, toets), berekeningen };
  if (!combinationSet) {
    // Geweigerd: geen toetsinvoer, wel de reden per combinatie en wat eraan te doen is.
    return {
      ...uit,
      toetsanalyse,
      toetsweigering: {
        ...vormToetsweigering3D(toets.weigering!),
        suggestie: "Verstijf het model (verbanden, zwaardere profielen of extra opleggingen) tot elke " +
          "UGT-combinatie in de tweede orde stabiel is (α_cr > 1). Noemt de reden van een combinatie staven " +
          "boven hun eigen knikkracht, maak die (als het verbanden zijn) trek-alleen of kies een zwaarder profiel.",
      },
    };
  }
  const staal = buildOpenFem3DSteelCheckInputs(imp.model3d, basis, combinationSet);
  return {
    ...uit,
    toetsanalyse,
    toetsinvoer: staal.inputs,
    nietGetoetst: staal.skipped,
    notities: staal.notes,
  };
}

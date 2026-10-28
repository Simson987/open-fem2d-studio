/**
 * toets3dSidecar.ts — de UGT-toets van de 3D-MCP-tools
 * `open_fem_3d_staalhal_maken` en `open_fem_3d_ifc_importeren` (issue #199,
 * besluit B9): dezelfde regel en dezelfde functies als de knop Berekenen in
 * de app (`components/openFem3d/openFem3dToetsKrachten.ts`).
 *
 * DE REGEL
 * De resultaten van deze tools volgen `reken.analyse` (lineair of P-Δ) en
 * rekenen zonder scheefstand. De UGT-toets rekent ALTIJD zelf tweede orde
 * (P-Δ) met scheefstand, elke UGT-combinatie in +X, −X, +Y en −Y, met één
 * knikvorm per berekening (NEN-EN 1993-1-1 5.2.2(3)b en (7)b, 5.3.2). De φ is
 * die van de projectinstelling in het projectbestand dat de tool teruggeeft,
 * zoals de app hem bij het openen van dat bestand bepaalt (standaard vast
 * 1/200); met hout in het model minstens φ volgens NEN-EN 1995-1-1 (5.1). De
 * BGT-toetsen lezen de resultaten (B6). Divergeert de toets in een combinatie,
 * dan wordt hij geweigerd met de reden per combinatie; nooit eerste orde (B7).
 *
 * DE KETEN. De app rekent de toets met `bepaalToetsKrachten3D` en een
 * rekenfunctie; hier zit Rust tussen plannen en samenstellen:
 *   1. `toets3DOpzet` (bij `staalhal_maken` en `ifc_importeren`):
 *      `planToetsKrachten3D` en per berekening het verzoek van
 *      `openFem3DRekenverzoek`, met dezelfde opties als de app — dus hetzelfde
 *      verzoek als de app naar de kern stuurt;
 *   2. Rust rekent elk verzoek met `open_fem_3d::solve`; een mislukte
 *      berekening komt terug als `{ fout }`, niet als een afgebroken aanroep;
 *   3. `toets3DUitwerken` (bij `staalhal_uitwerken` en `ifc_uitwerken`):
 *      dezelfde opzet opnieuw (generator en import zijn puur), de uitkomsten
 *      gelezen zoals de app ze heeft (`openFem3DUitkomstVanKern`),
 *      `stelToetsKrachten3DSamen` en `toetsSet3D` voor de bouwers.
 * De resultaten van deze tools zijn nooit P-Δ met scheefstand, dus de toets
 * hergebruikt ze nooit. Het plan wordt daarom zonder resultaten gemaakt, en
 * is in stap 1 en 3 hetzelfde.
 *
 * Puur: geen React, geen DOM, geen Tauri.
 */
import type { LoadCase } from "../components/fem/femTypes";
import { alphaCrLabel, stabiliteitsMeldingen, type AlphaCrUitkomst } from "../components/fem/solver/alphaCr";
import type { LoadCombination } from "../components/fem/solver/combinations";
import type { OpenFem3DModel } from "../components/openFem3d/openFem3dModel";
import {
  openFem3DGlobalForceBalance,
  openFem3DRekenverzoek,
  openFem3DUitkomstVanKern,
  type OpenFem3DRekenverzoek,
  type OpenFem3DSolveOptions,
  type OpenFem3DSolveRequestBody,
  type OpenFem3DSolveResult,
} from "../components/openFem3d/openFem3dSolver";
import {
  bepaalScheefstand3D, leidScheefstandGeometrieAf3D, toepasselijkeScheefstandNormen3D, torsieRijen3D,
} from "../components/openFem3d/openFem3dScheefstand";
import type { OpenFem3DCombinationSet } from "../components/openFem3d/openFem3dSteelCheck";
import {
  planToetsKrachten3D,
  stelToetsKrachten3DSamen,
  toetsKrachtenNotitie3D,
  toetsSet3D,
  type ToetsKrachten3D,
  type ToetsKrachtenInvoer3D,
  type ToetsPlan3D,
  type ToetsRun3D,
  type ToetsRunUitkomst3D,
} from "../components/openFem3d/openFem3dToetsKrachten";
import { SCHEEFSTAND_BRONNEN, type ScheefstandBron } from "../lib/scheefstandNorm";
import type { ConsequenceClass } from "../lib/types/steel/ConsequenceClass";
import { weigeringTekst, type ToetsAnalyse, type ToetsWeigering } from "../lib/toetsKrachten";

/** De richtingen van de scheefstand in de toets, in de volgorde van de varianten. */
const RICHTINGEN = ["+X", "−X", "+Y", "−Y"] as const;

/** Eén berekening van de toets, met de sleutel waaronder Rust de uitkomst teruggeeft. */
export interface Toets3DVerzoek {
  /** `toets:<id>` (P-Δ met scheefstand) of `eersteOrde:<id>` (eerste orde voor §5.8). */
  sleutel: string;
  soort: ToetsRun3D["soort"];
  id: number;
  naam: string;
  /** Het verzoek van `openFem3DRekenverzoek`: hetzelfde als de app naar de kern stuurt. */
  verzoek: OpenFem3DSolveRequestBody;
}

/** Het plan van de toets en zijn verzoeken, opnieuw te maken uit dezelfde invoer. */
export interface Toets3DOpzet {
  plan: ToetsPlan3D;
  /** De runs van het plan met hun verzoek, op sleutel. */
  runs: Map<string, { run: ToetsRun3D; opties: OpenFem3DSolveOptions; verzoek: OpenFem3DRekenverzoek }>;
  /** De analyse van de resultaten (`reken.analyse`), om naast de toetsanalyse te melden. */
  modelAnalyse: string;
  /** Meldingen van de aanroeper over deze toets (bijv. een imperfectiegeval uit het IFC-bestand). */
  meldingen: string[];
}

/**
 * De scheefstand van de projectinstelling in het projectbestand, zoals de app
 * hem bij het openen van dat bestand bepaalt (`useFemStore`: ontbrekende
 * velden → vast, noemer 200, h en m uit het model) en voor 3D afleidt
 * (`App.tsx`: `bepaalScheefstand3D` met de 3D-geometrie en de normen van het
 * model: φ_X en φ_Y met m per rij en richting, issue #194). `modelAan` is
 * false: de resultaten van deze tools rekenen zonder scheefstand.
 */
export function toetsScheefstand3D(
  project: Record<string, unknown>,
  model: OpenFem3DModel,
): ToetsKrachtenInvoer3D["scheefstand"] {
  const bron: ScheefstandBron = (SCHEEFSTAND_BRONNEN as readonly unknown[]).includes(project.scheefstandBron)
    ? project.scheefstandBron as ScheefstandBron
    : "vast";
  const noemer = typeof project.scheefstandNoemer === "number" && project.scheefstandNoemer > 0
    ? project.scheefstandNoemer : 200;
  const hoogteM = typeof project.scheefstandHoogteM === "number" && project.scheefstandHoogteM > 0
    ? project.scheefstandHoogteM : null;
  const aantalElementen = typeof project.scheefstandAantalElementen === "number" && project.scheefstandAantalElementen >= 1
    ? Math.floor(project.scheefstandAantalElementen) : null;
  // Issue #212: m per richting en de torsievarianten van 5.3.2(10), zoals de app.
  const mPerAs = (v: unknown) => (typeof v === "number" && v >= 1 ? Math.floor(v) : null);
  const aantalPerAs = { x: mPerAs(project.scheefstandAantalX), y: mPerAs(project.scheefstandAantalY) };
  const geometrie = leidScheefstandGeometrieAf3D(model);
  const normen = toepasselijkeScheefstandNormen3D(model);
  return {
    project: bepaalScheefstand3D({ bron, noemer, hoogteM, aantalElementen, aantalPerAs }, geometrie, normen),
    normen,
    modelAan: false,
    torsie: project.scheefstandTorsie === true ? torsieRijen3D(geometrie) : null,
  };
}

/**
 * Stap 1: het plan van de toets en per berekening het verzoek, met dezelfde
 * opties als de app (`App.tsx`, de 3D-tak van `handleSolve`): de blijvende
 * gevallen, het eigen-gewichtgeval, één knikvorm bij P-Δ en P-Δ verplicht.
 */
export function toets3DOpzet(invoer: {
  /** Het model zonder eigen gewicht: de geometrie en de normen van φ. */
  model: OpenFem3DModel;
  /** Het rekenmodel van de resultaten (met eigen gewicht). */
  rekenmodel: OpenFem3DModel;
  /** De combinaties van de resultaten. */
  combinaties: readonly LoadCombination[];
  loadCases: readonly Pick<LoadCase, "id" | "type" | "name" | "imperfectie">[];
  selfWeightCaseId?: number;
  /** Het projectbestand dat de tool teruggeeft: de projectinstelling van φ. */
  project: Record<string, unknown>;
  /** `reken.analyse` van de resultaten. */
  modelAnalyse: string;
  meldingen?: string[];
}): Toets3DOpzet {
  const plan = planToetsKrachten3D({
    model: invoer.rekenmodel,
    combinaties: invoer.combinaties,
    scheefstand: toetsScheefstand3D(invoer.project, invoer.model),
    // De imperfectiegevallen (IFC SYSTEM_IMPERFECTION) op factor 0 in de UGT-toets.
    loadCases: invoer.loadCases,
  });
  const basisOpties: OpenFem3DSolveOptions = {
    permanentCaseIds: invoer.loadCases.filter((c) => c.type === "dead").map((c) => c.id),
    ...(invoer.selfWeightCaseId !== undefined ? { selfWeightCaseId: invoer.selfWeightCaseId } : {}),
  };
  const runs: Toets3DOpzet["runs"] = new Map();
  for (const run of plan.runs) {
    const opties = { ...basisOpties, bucklingModes: run.bucklingModes, tweedeOrdeVerplicht: run.analyse === "p-delta" };
    runs.set(run.sleutel, {
      run, opties,
      verzoek: openFem3DRekenverzoek(invoer.rekenmodel, run.combinatie.factors, run.analyse, run.scheefstand, opties),
    });
  }
  return { plan, runs, modelAnalyse: invoer.modelAnalyse, meldingen: invoer.meldingen ?? [] };
}

/** De verzoeken van de toets voor Rust. */
export function toets3DVerzoeken(opzet: Toets3DOpzet): Toets3DVerzoek[] {
  return [...opzet.runs.values()].map(({ run, verzoek }) => ({
    sleutel: run.sleutel, soort: run.soort, id: run.combinatie.id, naam: run.combinatie.name, verzoek: verzoek.input,
  }));
}

/** Eén α_cr in de vorm van de uitvoer; dezelfde velden als `stability.alpha_cr` van `check_fem_model`. */
function vormAlphaCr(u: AlphaCrUitkomst) {
  return {
    combination_id: u.combinatieId,
    name: u.naam,
    alpha_cr: u.alphaCr,
    status: u.status,
    ...(u.reden !== undefined ? { reason: u.reden } : {}),
    label: alphaCrLabel(u),
  };
}

/**
 * De toetsanalyse in de uitvoer, met dezelfde velden als `stability` van
 * `check_fem_model`. De MCP-server weigert de toetsing (TOETSING_ONMOGELIJK)
 * als `analysis_type` geen tweede orde is of `scheefstand.afgedwongen`
 * ontbreekt: zo valt een bundel van vóór deze regel nooit stil terug op de
 * krachten van de resultaten.
 */
export function vormToetsanalyse3D(opzet: Toets3DOpzet, toets?: ToetsKrachten3D) {
  const a: ToetsAnalyse = toets?.analyse ?? opzet.plan.analyse;
  const meldingen = [...(toets?.meldingen ?? opzet.plan.meldingen), ...opzet.meldingen];
  return {
    // De analyse van de TOETSKRACHTEN: altijd tweede orde.
    analysis_type: a.soort,
    // De analyse van de resultaten (en de BGT-toetsen).
    model_analysis_type: opzet.modelAnalyse,
    hergebruikt: a.hergebruikt,
    scheefstand: {
      // De grootste van φ_X en φ_Y, en per richting (issue #194): ±X rekent
      // met phi_x, ±Y met phi_y.
      phi: a.phi,
      noemer: a.noemer,
      ...(a.phiPerAs ? {
        phi_x: a.phiPerAs.x,
        phi_y: a.phiPerAs.y,
        noemer_x: Math.round(10 / a.phiPerAs.x) / 10,
        noemer_y: Math.round(10 / a.phiPerAs.y) / 10,
      } : {}),
      bron: a.bron,
      // De resultaten van deze tools rekenen zonder scheefstand.
      model_scheefstand_aan: a.scheefstandModelAan,
      // De toets rekent altijd met deze scheefstand (zie hierboven).
      afgedwongen: true,
    },
    richtingen: [...RICHTINGEN],
    aantal_berekeningen: opzet.plan.runs.length,
    toelichting: toetsKrachtenNotitie3D(a),
    meldingen,
    ...(toets ? {
      // α_cr per UGT-basiscombinatie van de toets (+X): informatief, want de
      // grens α_cr ≥ 10 van 5.2.1(3) geldt alleen voor eerste orde.
      alpha_cr: toets.alphaCr.map(vormAlphaCr),
      // De stabiliteitspoort per UGT-combinatie (issue #194), dezelfde
      // meldingen als de app en 2D: informatief over de resultaten (hier
      // `model_analysis_type`, zonder scheefstand); alleen een geweigerde toets
      // is een fout.
      stabiliteitsmeldingen: stabiliteitsMeldingen(
        toets.alphaCr, opzet.modelAnalyse === "p-delta" ? "tweedeOrdeGeometrisch" : "eersteOrde", false,
        toets.weigering ? weigeringTekst(toets.weigering) : null,
      ),
      geweigerd: toets.weigering !== null,
    } : opzet.plan.weigering ? { geweigerd: true } : {}),
  };
}

/** De weigering van de toets in de vorm van de uitvoer. */
export function vormToetsweigering3D(weigering: ToetsWeigering) {
  return {
    reden: weigering.reden,
    per_combinatie: weigering.perCombinatie.map((c) => ({ combination_id: c.id, name: c.naam, reason: c.reden })),
  };
}

/** Een object dat op een 3D-rekenresultaat lijkt, met de knopen van het verzoek. */
function isResultaatVan(r: unknown, verzoek: OpenFem3DSolveRequestBody): r is OpenFem3DSolveResult {
  if (!r || typeof r !== "object") return false;
  const x = r as Partial<OpenFem3DSolveResult>;
  if (!Array.isArray(x.reactions) || !Array.isArray(x.displacements) || !Array.isArray(x.memberForces)) return false;
  const knopen = new Set(verzoek.nodes.map((n) => n.id));
  return x.displacements.length === knopen.size && x.displacements.every((d) => knopen.has(d.nodeId));
}

/** Σ reacties en het evenwicht van één toetsberekening, om na te rekenen. */
function controle(verzoek: OpenFem3DSolveRequestBody, r: OpenFem3DSolveResult) {
  const som = r.reactions.reduce((t, x) => ({ fx: t.fx + x.fx, fy: t.fy + x.fy, fz: t.fz + x.fz }), { fx: 0, fy: 0, fz: 0 });
  const balans = r.forceBalance ?? openFem3DGlobalForceBalance(verzoek, r);
  return {
    reactiesomKn: som,
    evenwicht: {
      kern: r.equilibrium?.equilibriumOk ?? null,
      onafhankelijk: balans.ok,
      restKrachtKn: balans.maxImbalanceKn,
      restMomentKnm: balans.maxMomentImbalanceKnm,
    },
  };
}

/**
 * Stap 3: de uitkomsten van Rust (`toetsresultaten`: per sleutel
 * `{ resultaat }` of `{ fout }`) tot de toetskrachten en, zonder weigering, de
 * toetsset voor de bouwers. Elke sleutel van het plan moet er precies één keer
 * zijn; een ontbrekende, onbekende of onleesbare uitkomst is een fout in de
 * aanroep (`fout(veld, melding)`), geen weigering.
 */
export function toets3DUitwerken(
  opzet: Toets3DOpzet,
  invoer: {
    rekenmodel: OpenFem3DModel;
    toetsresultaten: unknown;
    /** De resultaten: de combinaties en hun uitkomsten (de BGT van de toetsset). */
    combinaties: readonly LoadCombination[];
    combinationResults: ReadonlyMap<number, OpenFem3DSolveResult>;
    loadCases: readonly Pick<LoadCase, "id" | "type">[];
    consequenceClass?: ConsequenceClass;
  },
  fout: (veld: string, melding: string) => Error,
): {
  toets: ToetsKrachten3D;
  combinationSet: OpenFem3DCombinationSet | null;
  berekeningen: Record<string, unknown>[];
} {
  const rauw = invoer.toetsresultaten;
  if (!rauw || typeof rauw !== "object" || Array.isArray(rauw)) {
    throw fout("toetsresultaten", "`toetsresultaten` moet een object zijn: per sleutel van `toetsverzoeken` `{ resultaat }` of `{ fout }`.");
  }
  const gegeven = rauw as Record<string, unknown>;
  const vreemd = Object.keys(gegeven).filter((k) => !opzet.runs.has(k));
  const ontbreekt = [...opzet.runs.keys()].filter((k) => !(k in gegeven));
  if (vreemd.length > 0 || ontbreekt.length > 0) {
    throw fout("toetsresultaten",
      (vreemd.length > 0 ? `Onbekende toetssleutels: ${vreemd.join(", ")}. ` : "") +
      (ontbreekt.length > 0 ? `Ontbrekende toetssleutels: ${ontbreekt.join(", ")}. ` : "") +
      `Verwacht: ${[...opzet.runs.keys()].join(", ") || "(geen)"}.`);
  }
  const uitkomsten = new Map<string, ToetsRunUitkomst3D>();
  const berekeningen: Record<string, unknown>[] = [];
  for (const [sleutel, { run, opties, verzoek }] of opzet.runs) {
    const u = gegeven[sleutel] as Record<string, unknown> | null;
    const basis = { sleutel, soort: run.soort, id: run.combinatie.id, naam: run.combinatie.name };
    if (u && typeof u === "object" && typeof u.fout === "string" && !("resultaat" in u)) {
      uitkomsten.set(sleutel, { fout: u.fout });
      berekeningen.push({ ...basis, fout: u.fout });
      continue;
    }
    if (!u || typeof u !== "object" || !isResultaatVan(u.resultaat, verzoek.input)) {
      throw fout(`toetsresultaten.${sleutel}`,
        `De uitkomst \`${sleutel}\` (${run.combinatie.name}) is geen \`{ resultaat }\` met een 3D-rekenresultaat ` +
        "van dit verzoek en geen `{ fout }`.");
    }
    const r = openFem3DUitkomstVanKern(invoer.rekenmodel, run.combinatie.factors, verzoek, u.resultaat, opties);
    uitkomsten.set(sleutel, { resultaat: r });
    const knik = r.buckling?.status === "available" ? r.buckling.modes[0]?.loadFactor : undefined;
    berekeningen.push({
      ...basis, analyse: r.analysis, ...controle(verzoek.input, r),
      ...(knik !== undefined ? { alphaCr: knik } : {}),
    });
  }
  const toets = stelToetsKrachten3DSamen(opzet.plan, uitkomsten);
  const combinationSet = toets.weigering ? null : toetsSet3D(toets, {
    combinaties: invoer.combinaties,
    combinationResults: invoer.combinationResults,
    loadCases: invoer.loadCases,
    ...(invoer.consequenceClass ? { consequenceClass: invoer.consequenceClass } : {}),
  });
  return { toets, combinationSet, berekeningen };
}

/**
 * Lees `toetsen` uit een payload: standaard aan; alleen `false` zet de toets
 * (en dus zijn berekeningen) uit.
 */
export function leesToetsen(waarde: unknown, fout: (veld: string, melding: string) => Error): boolean {
  if (waarde === undefined || waarde === null) return true;
  if (typeof waarde !== "boolean") throw fout("toetsen", "`toetsen` moet true of false zijn.");
  return waarde;
}

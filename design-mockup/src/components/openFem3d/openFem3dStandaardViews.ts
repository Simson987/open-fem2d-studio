/**
 * openFem3dStandaardViews.ts — de views van de 3D-werkruimte: zes vaste
 * standaardviews (Geometrie, Belastingen, Combinaties, Vz, Reacties,
 * Spanningen) naast de eigen, opgeslagen views (openFem3dViewSets.ts), en welke
 * daarvan als afbeelding in het berekeningsrapport komen. Geen React.
 *
 * STANDAARDVIEWS. Altijd aanwezig, niet te verwijderen, wel toe te passen. Elke
 * standaardview zet de INHOUDslagen vast (staven, platen, profielen,
 * opleggingen, lasten en de resultaatlagen) en laat de rest — labels, raster,
 * assen, profielkleuren — zoals de gebruiker het heeft. Camera: isometrisch en
 * passend beeld. De resultaatviews (Combinaties, Vz, Reacties, Spanningen) zijn
 * pas beschikbaar na Berekenen; tot dan grijs, met de reden erbij.
 *
 * COMBINATIES toont de actieve combinatie; is er geen gekozen, dan de
 * maatgevende: de combinatie met de grootste verplaatsing (het vervormingsbeeld
 * waar deze view om draait). Vz, Reacties en Spanningen tonen het resultaat
 * dat in beeld is (belastinggeval of combinatie). SPANNINGEN is de
 * unity-checkkleuring per staaf (EN 1992 / EN 1993): de spanningstoets van de
 * staven; een contourplot van spanningen kent het 3D-staafmodel niet.
 *
 * RAPPORT. Per view een vinkje "in rapport". Standaard staan alle
 * standaardviews aan; de uitgezette worden in het project bewaard
 * (`openFem3dStandaardViewsUitRapport`). Een eigen view draagt zijn eigen
 * keuze (`inRapport`, ontbrekend = aan).
 */
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, type OpenFem3DVisibility } from "./openFem3dVisibility";
import {
  OPEN_FEM_3D_STANDAARD_VIEW_IDS, openFem3DViewSetInRapport,
  type OpenFem3DCameraState, type OpenFem3DStandaardViewId, type OpenFem3DViewSet,
} from "./openFem3dViewSets";
import type { OpenFem3DView } from "./openFem3dCommands";
import type { OpenFem3DModel } from "./openFem3dModel";
import type { OpenFem3DSolveResult } from "./openFem3dSolver";
import { openFem3DMaximumDisplacementM } from "./openFem3dDisplacement";
import { DEFAULT_OPEN_FEM_3D_DIAGRAM_LABELS, type OpenFem3DDiagramLabels } from "./openFem3dDiagramLabels";

export { OPEN_FEM_3D_STANDAARD_VIEW_IDS, parseOpenFem3DStandaardViewsUitRapport, type OpenFem3DStandaardViewId } from "./openFem3dViewSets";
export type OpenFem3DViewModus = "model" | "loadCase" | "results";

/** De inhoudslagen die een standaardview vastzet. */
const INHOUD: readonly (keyof OpenFem3DVisibility)[] = [
  "beams", "plates", "profiles", "supports", "loads",
  "deformation", "reactions", "utilization", "axialForce", "shearY", "shearZ", "torsion", "momentY", "momentZ",
  "groundPressure",
];
const lagen = (aan: (keyof OpenFem3DVisibility)[]): Partial<OpenFem3DVisibility> =>
  Object.fromEntries(INHOUD.map((k) => [k, aan.includes(k)]));

export interface OpenFem3DStandaardView {
  id: OpenFem3DStandaardViewId;
  /** De tab die de view kiest: Model, belastinggeval of Resultaten. */
  mode: OpenFem3DViewModus;
  /** Alleen zinvol met een berekend resultaat. */
  resultaat: boolean;
  lagen: Partial<OpenFem3DVisibility>;
}

export const OPEN_FEM_3D_STANDAARD_VIEWS: readonly OpenFem3DStandaardView[] = [
  // Het model zelf: profielen als volume, opleggingen, geen lasten of resultaten.
  { id: "geometrie", mode: "model", resultaat: false, lagen: lagen(["beams", "plates", "profiles", "supports"]) },
  // Het actieve belastinggeval: hartlijnen, zodat de lastpijlen leesbaar blijven.
  { id: "belastingen", mode: "loadCase", resultaat: false, lagen: lagen(["beams", "plates", "supports", "loads"]) },
  { id: "combinaties", mode: "results", resultaat: true, lagen: lagen(["beams", "plates", "supports", "deformation"]) },
  { id: "vz", mode: "results", resultaat: true, lagen: lagen(["beams", "plates", "supports", "shearZ"]) },
  { id: "reacties", mode: "results", resultaat: true, lagen: lagen(["beams", "plates", "supports", "reactions"]) },
  { id: "spanningen", mode: "results", resultaat: true, lagen: lagen(["beams", "plates", "supports", "utilization"]) },
];

/** De sleutel waaronder een standaardview als "actieve view" telt. */
export const standaardViewSleutel = (id: OpenFem3DStandaardViewId) => `standaard:${id}`;

/** Wat er berekend is: bepaalt welke resultaatviews beschikbaar zijn. */
export interface OpenFem3DViewStatus {
  /** Er is gerekend (er zijn resultaten per belastinggeval of combinatie). */
  heeftResultaat: boolean;
  /** Er zijn berekende combinaties. */
  heeftCombinaties: boolean;
  /** Er zijn unity checks (staal- of betontoetsing). */
  heeftToetsing: boolean;
}

/** null = beschikbaar; anders de i18n-sleutel (common) van de reden. */
export function openFem3DStandaardViewReden(id: OpenFem3DStandaardViewId, s: OpenFem3DViewStatus): string | null {
  const view = OPEN_FEM_3D_STANDAARD_VIEWS.find((v) => v.id === id);
  if (!view?.resultaat) return null;
  if (id === "combinaties") {
    if (s.heeftCombinaties) return null;
    return s.heeftResultaat ? "openFem3dViews.redenGeenCombinaties" : "openFem3dViews.redenNietGerekend";
  }
  if (!s.heeftResultaat) return "openFem3dViews.redenNietGerekend";
  if (id === "spanningen" && !s.heeftToetsing) return "openFem3dViews.redenGeenToetsing";
  return null;
}

/**
 * De maatgevende combinatie voor het vervormingsbeeld: de berekende
 * combinatie met de grootste verplaatsing. Gelijk: de laagste id.
 */
export function openFem3DMaatgevendeCombinatie(
  model: OpenFem3DModel,
  combinations: readonly { id: number }[],
  combinationResults: ReadonlyMap<number, OpenFem3DSolveResult> | undefined,
): number | null {
  let beste: { id: number; u: number } | null = null;
  for (const c of combinations) {
    const r = combinationResults?.get(c.id);
    if (!r) continue;
    const u = openFem3DMaximumDisplacementM(model, r);
    if (!beste || u > beste.u + 1e-12 || (Math.abs(u - beste.u) <= 1e-12 && c.id < beste.id)) beste = { id: c.id, u };
  }
  return beste?.id ?? null;
}

/** Wat de app toepast: een standaardview of een eigen view, in één vorm. */
export interface OpenFem3DViewToepassing {
  /** `standaard:<id>` of de id van een eigen view. */
  sleutel: string;
  view: OpenFem3DView;
  /** null = passend beeld in `view`; anders precies deze camera. */
  camera: OpenFem3DCameraState | null;
  visibility: OpenFem3DVisibility;
  /** null = het belastinggeval `loadCaseId`; anders deze combinatie. */
  combinationId: number | null;
  loadCaseId?: number;
  mode?: OpenFem3DViewModus;
  /**
   * De getallen bij de snedekrachtlijnen. Een eigen view zet ze altijd (een
   * oudere view zonder veld: de standaard); een standaardview laat ze staan.
   */
  diagramLabels?: OpenFem3DDiagramLabels;
}

/** Een standaardview als toepassing, uitgaande van de huidige weergave. */
export function openFem3DStandaardViewToepassing(
  id: OpenFem3DStandaardViewId,
  s: { visibility: OpenFem3DVisibility; activeCombinationId: number | null; maatgevendeCombinationId: number | null; activeLoadCaseId: number },
): OpenFem3DViewToepassing {
  const view = OPEN_FEM_3D_STANDAARD_VIEWS.find((v) => v.id === id)!;
  return {
    sleutel: standaardViewSleutel(id),
    view: "iso",
    camera: null,
    visibility: { ...s.visibility, ...view.lagen },
    combinationId: id === "combinaties"
      ? s.activeCombinationId ?? s.maatgevendeCombinationId
      : view.mode === "results" ? s.activeCombinationId : null,
    loadCaseId: s.activeLoadCaseId,
    mode: view.mode,
  };
}

/** Een eigen view als toepassing. */
export function openFem3DViewSetToepassing(viewSet: OpenFem3DViewSet): OpenFem3DViewToepassing {
  return {
    sleutel: viewSet.id,
    view: viewSet.view,
    camera: viewSet.camera,
    visibility: { ...viewSet.visibility },
    combinationId: viewSet.combinationId,
    ...(viewSet.loadCaseId === undefined ? {} : { loadCaseId: viewSet.loadCaseId }),
    ...(viewSet.mode === undefined ? {} : { mode: viewSet.mode }),
    diagramLabels: { ...(viewSet.diagramLabels ?? DEFAULT_OPEN_FEM_3D_DIAGRAM_LABELS) },
  };
}

/** Dezelfde zichtbaarheid (alle vlaggen)? */
export function openFem3DZichtGelijk(a: OpenFem3DVisibility, b: OpenFem3DVisibility): boolean {
  return (Object.keys(DEFAULT_OPEN_FEM_3D_VISIBILITY) as (keyof OpenFem3DVisibility)[]).every((k) =>
    k === "explode" ? a.explode.mode === b.explode.mode && a.explode.amountM === b.explode.amountM : a[k] === b[k]);
}

/**
 * Is deze view de actieve? Hij is als laatste toegepast én zijn lagen staan
 * nog zo: zet de gebruiker daarna zelf een laag om, dan is de markering weg.
 */
export function openFem3DViewActief(
  sleutel: string, actieveSleutel: string | null, toepassing: Pick<OpenFem3DViewToepassing, "visibility">, huidig: OpenFem3DVisibility,
): boolean {
  return sleutel === actieveSleutel && openFem3DZichtGelijk(toepassing.visibility, huidig);
}

// ── Rapport ─────────────────────────────────────────────────────────────

export function zetOpenFem3DStandaardViewInRapport(
  uit: readonly OpenFem3DStandaardViewId[], id: OpenFem3DStandaardViewId, inRapport: boolean,
): OpenFem3DStandaardViewId[] {
  const set = new Set(uit);
  if (inRapport) set.delete(id); else set.add(id);
  return OPEN_FEM_3D_STANDAARD_VIEW_IDS.filter((x) => set.has(x));
}

/** Eén afbeelding in het rapport. */
export interface OpenFem3DRapportView {
  sleutel: string;
  /** Standaardview: zijn id (de titel komt uit de vertaling). */
  standaard?: OpenFem3DStandaardViewId;
  /** Eigen view: zijn naam. */
  naam?: string;
  lagen: OpenFem3DVisibility;
  view: OpenFem3DView;
  camera: OpenFem3DCameraState | null;
  resultaat: OpenFem3DSolveResult | null;
  /** Het belastinggeval voor de lastpijlen. */
  loadCaseId: number;
  /** De combinatie van het getoonde resultaat, als het een combinatie is. */
  combinationId: number | null;
  /** Staat hij aangevinkt maar valt er (nog) niets te tonen: de reden (common). */
  reden: string | null;
}

/**
 * De aangevinkte views voor het rapport, in de volgorde van de verkenner:
 * eerst de standaardviews, dan de eigen views. Standaardviews tekenen op een
 * vaste basis (de standaardzichtbaarheid met hun eigen lagen), zodat het
 * rapport niet afhangt van wat er toevallig op het scherm aan stond.
 */
export function openFem3DRapportViews(s: {
  model: OpenFem3DModel;
  viewSets: readonly OpenFem3DViewSet[];
  standaardUitRapport: readonly OpenFem3DStandaardViewId[];
  /** Het resultaat dat in de app in beeld is (belastinggeval of combinatie). */
  result: OpenFem3DSolveResult | null;
  caseResults?: ReadonlyMap<number, OpenFem3DSolveResult>;
  combinationResults?: ReadonlyMap<number, OpenFem3DSolveResult>;
  combinations: readonly { id: number }[];
  activeLoadCaseId: number;
  activeCombinationId: number | null;
  heeftToetsing: boolean;
}): OpenFem3DRapportView[] {
  const status: OpenFem3DViewStatus = {
    heeftResultaat: Boolean(s.result) || (s.caseResults?.size ?? 0) > 0 || (s.combinationResults?.size ?? 0) > 0,
    heeftCombinaties: (s.combinationResults?.size ?? 0) > 0,
    heeftToetsing: s.heeftToetsing,
  };
  const uit: OpenFem3DRapportView[] = [];
  for (const v of OPEN_FEM_3D_STANDAARD_VIEWS) {
    if (s.standaardUitRapport.includes(v.id)) continue;
    const reden = openFem3DStandaardViewReden(v.id, status);
    let resultaat: OpenFem3DSolveResult | null = null;
    let combinationId: number | null = null;
    if (v.id === "combinaties") {
      combinationId = s.activeCombinationId ?? openFem3DMaatgevendeCombinatie(s.model, s.combinations, s.combinationResults);
      resultaat = combinationId === null ? null : s.combinationResults?.get(combinationId) ?? null;
    } else if (v.resultaat) {
      resultaat = s.result ?? s.caseResults?.get(s.activeLoadCaseId) ?? null;
      combinationId = s.result ? s.activeCombinationId : null;
    }
    uit.push({
      sleutel: standaardViewSleutel(v.id), standaard: v.id,
      lagen: { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, ...v.lagen },
      view: "iso", camera: null,
      resultaat: reden ? null : resultaat,
      loadCaseId: s.activeLoadCaseId, combinationId,
      reden: reden ?? (v.resultaat && !resultaat ? "openFem3dViews.redenNietGerekend" : null),
    });
  }
  for (const vs of s.viewSets) {
    if (!openFem3DViewSetInRapport(vs)) continue;
    const loadCaseId = vs.loadCaseId ?? s.activeLoadCaseId;
    // Zoals de app: in de tab Model geen lasten en geen resultaten.
    const model = vs.mode === "model";
    const resultaat = model ? null
      : vs.combinationId !== null ? s.combinationResults?.get(vs.combinationId) ?? null
        : s.caseResults?.get(loadCaseId) ?? null;
    uit.push({
      sleutel: vs.id, naam: vs.name,
      lagen: model ? { ...vs.visibility, loads: false } : { ...vs.visibility },
      view: vs.view, camera: vs.camera,
      resultaat, loadCaseId, combinationId: model ? null : vs.combinationId,
      reden: null,
    });
  }
  return uit;
}

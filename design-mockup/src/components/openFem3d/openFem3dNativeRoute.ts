/**
 * Rekenkeuze tussen Open FEM 3D en de native Rust-3D-route (Open FEM Rust,
 * `openaec-native-fem`) voor het Open FEM 3D-model van de app.
 *
 *  - Open FEM 3D blijft de standaard voor staaf- en plaatmodellen.
 *  - Een model met onderdelen die alleen de native route rekent (volumes
 *    Tet4/Hex8, membraanplaten, axiale staven, materiaalwetten, …; zie
 *    `openFem3DNativeFeatures`) gaat bij "automatisch" naar Open FEM Rust;
 *    de app meldt dat.
 *  - Kiest de gebruiker Open FEM Rust, dan rekent ook een gewoon staaf- of
 *    plaatmodel via de native route (voor zover die het ondersteunt).
 *  - Kiest de gebruiker expliciet Open FEM 3D voor een model met native
 *    onderdelen, dan weigert de app: Open FEM 3D zou ze stil overslaan.
 *
 * De native route zelf is `solveFrame3D` (components/frame3d); deze module
 * zet model en uitkomst om.
 */
import { withFrame3DSelfWeight, type Frame3DModel } from "../frame3d/frame3dModel";
import {
  frame3DAnalysisForProject,
  solveFrame3D,
  solveFrame3DCombination,
  type Frame3DAnalysisKind,
  type Frame3DProjectAnalysisMode,
  type Frame3DSolveResult,
} from "../frame3d/frame3dSolver";
import { SolverResolutionError, type SolverPreference } from "../../core/solver/SolverRegistry";
import type { OpenFem3DModel } from "./openFem3dModel";
import {
  openFem3DNativeFeatures,
  openFem3DToFrame3DModel,
  type OpenFem3DNativeFeature,
} from "./openFem3dNativeModel";
import type { OpenFem3DSolveResult } from "./openFem3dSolver";

export type OpenFem3DEngineId = "open-fem-3d" | "openaec-native-fem";

export interface OpenFem3DRouteChoice {
  engineId: OpenFem3DEngineId;
  /** True als "automatisch" vanwege native onderdelen naar Open FEM Rust ging. */
  automaticNative: boolean;
  features: OpenFem3DNativeFeature[];
}

/** Kies de rekenkern voor het 3D-model bij de gegeven voorkeur. */
export function chooseOpenFem3DRoute(model: OpenFem3DModel, preference: SolverPreference): OpenFem3DRouteChoice {
  const features = openFem3DNativeFeatures(model);
  if (preference === "openaec-native-fem") return { engineId: "openaec-native-fem", automaticNative: false, features };
  if (features.length > 0) {
    if (preference === "automatic") return { engineId: "openaec-native-fem", automaticNative: true, features };
    throw new SolverResolutionError(
      `Dit 3D-model bevat onderdelen die alleen Open FEM Rust rekent (${features.join(", ")}). `
        + "Kies in Instellingen → Berekening automatisch of Open FEM Rust.",
    );
  }
  return { engineId: "open-fem-3d", automaticNative: false, features };
}

/** De analyse van de native route bij de projectkeuze (eerste/tweede orde, fysisch). */
export function openFem3DNativeAnalysis(model: Frame3DModel, mode: Frame3DProjectAnalysisMode): Frame3DAnalysisKind {
  return frame3DAnalysisForProject(model, mode);
}

/**
 * Het rekenmodel van de native route: Open FEM 3D-model omgezet, met het
 * eigen gewicht (ook van volumes via hun dichtheid) als `selfWeightCaseId`
 * gegeven is.
 */
export function openFem3DNativeCalculationModel(model: OpenFem3DModel, selfWeightCaseId?: number): Frame3DModel {
  const native = openFem3DToFrame3DModel(model);
  return selfWeightCaseId === undefined ? native : withFrame3DSelfWeight(native, selfWeightCaseId);
}

/**
 * Zet een uitkomst van de native route om naar de Open FEM 3D-vorm. De
 * meetkundige analyse blijft "linear" of "p-delta"; de volledige native
 * analysesoort (materiaal-FNL, gecombineerd) staat in `nativeAnalysis`, de
 * volumeresultaten in `nativeVolume3D`.
 */
export function frame3DResultToOpenFem3D(result: Frame3DSolveResult): OpenFem3DSolveResult {
  const geometricallyNonlinear = result.analysis === "p-delta" || result.analysis === "combined";
  return {
    schemaVersion: 1,
    engine: result.engine,
    analysis: geometricallyNonlinear ? "p-delta" : "linear",
    nativeAnalysis: result.analysis,
    displacements: result.displacements,
    reactions: result.reactions,
    memberForces: result.memberForces,
    ...(result.diagrams ? { diagrams: result.diagrams } : {}),
    ...(result.secondOrder ? { secondOrder: result.secondOrder } : {}),
    buckling: result.buckling,
    ...(result.equilibrium ? { equilibrium: result.equilibrium } : {}),
    ...(result.forceBalance ? { forceBalance: result.forceBalance } : {}),
    ...(result.solverPath ? { solverPath: result.solverPath } : {}),
    diagnostics: result.diagnostics,
    ...(result.volume3D ? { nativeVolume3D: result.volume3D } : {}),
  };
}

/** Los één belastinggeval via de native route op. */
export async function solveOpenFem3DNative(
  model: Frame3DModel, caseId: number, analysis: Frame3DAnalysisKind,
): Promise<OpenFem3DSolveResult> {
  return frame3DResultToOpenFem3D(await solveFrame3D(model, caseId, analysis, "openaec-native-fem"));
}

/** Los één combinatie via de native route op (als één volledige lastvector). */
export async function solveOpenFem3DNativeCombination(
  model: Frame3DModel, factors: ReadonlyMap<number, number>, analysis: Frame3DAnalysisKind,
): Promise<OpenFem3DSolveResult> {
  return frame3DResultToOpenFem3D(await solveFrame3DCombination(model, factors, analysis, "openaec-native-fem"));
}

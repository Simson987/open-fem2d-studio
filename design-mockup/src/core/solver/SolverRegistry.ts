/**
 * Neutral solver catalogue and capability router.
 *
 * UI and project data only use these Open FEM types. Concrete engine adapters
 * translate an AnalysisRequest at the boundary, so a future plate or volume
 * solver can be added without leaking engine-specific fields into the model.
 */

export const SOLVER_PREFERENCE_KEY = "solverPreference";

/**
 * "open-fem-3d" is de Dedaliano-kern (dezelfde pin als het vroegere id "dedaliano").
 * "dedaliano" blijft alleen in het type staan voor de frame3d-adapter
 * (components/frame3d/frame3dSolver.ts) en wordt niet meer als keuze aangeboden;
 * een opgeslagen voorkeur "dedaliano" wordt gelezen als "open-fem-3d".
 */
export type SolverEngineId = "open-fem-2d" | "open-fem-3d" | "openaec-native-fem" | "dedaliano";
export type SolverPreference = "automatic" | SolverEngineId;
export type SolverDimension = "2d" | "3d";
export type SolverAnalysisKind = "linear" | "p-delta" | "material-nonlinear";
export type SolverElementFamily = "frame" | "plate" | "solid";

export interface SolverCapabilities {
  dimensions: readonly SolverDimension[];
  analyses: readonly SolverAnalysisKind[];
  elementFamilies: readonly SolverElementFamily[];
}

export interface SolverDescriptor {
  id: SolverEngineId;
  name: string;
  version: string;
  license: string;
  available: boolean;
  priority: number;
  /** Experimental engines can require an explicit user choice. */
  automaticEligible?: boolean;
  capabilities: SolverCapabilities;
}

export interface AnalysisRequest {
  schemaVersion: 1;
  dimension: SolverDimension;
  analysis: SolverAnalysisKind;
  elementFamilies: readonly SolverElementFamily[];
}

export class SolverResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolverResolutionError";
  }
}

export const SOLVER_REGISTRY: readonly SolverDescriptor[] = Object.freeze([
  {
    // Het id blijft "open-fem-2d": het staat als `solverPreference` in de
    // opgeslagen instellingen. Alleen de getoonde naam is veranderd.
    id: "open-fem-2d",
    name: "Open FEM",
    version: "built-in",
    license: "project license",
    available: true,
    priority: 100,
    capabilities: {
      dimensions: ["2d"],
      analyses: ["linear", "p-delta", "material-nonlinear"],
      elementFamilies: ["frame", "plate"],
    },
  },
  {
    id: "open-fem-3d",
    name: "Open FEM 3D (externe kern)",
    version: "7d87e551b765c88956df95b375e0ef0befda53f7",
    license: "AGPL-3.0",
    available: true,
    priority: 200,
    capabilities: {
      dimensions: ["3d"],
      analyses: ["linear", "p-delta"],
      // Platen rekenen met MITC4-vierhoeken; met platen alleen lineair (de app
      // meldt dat bij een tweede-ordekeuze).
      elementFamilies: ["frame", "plate"],
    },
  },
  {
    id: "openaec-native-fem",
    name: "Open FEM Rust (experimenteel)",
    version: "0.1.0",
    license: "AGPL-3.0-or-later",
    available: true,
    priority: 150,
    automaticEligible: false,
    capabilities: {
      dimensions: ["2d", "3d"],
      analyses: ["linear", "p-delta", "material-nonlinear"],
      elementFamilies: ["frame", "plate", "solid"],
    },
  },
]);

export function isSolverPreference(value: unknown): value is SolverPreference {
  return value === "automatic" || SOLVER_REGISTRY.some((solver) => solver.id === value);
}

export function normaliseSolverPreference(value: unknown): SolverPreference {
  // Vroeger id van de Dedaliano-3D-kern; dezelfde kern heet nu "open-fem-3d".
  if (value === "dedaliano") return "open-fem-3d";
  return isSolverPreference(value) ? value : "automatic";
}

export function supportsRequest(solver: SolverDescriptor, request: AnalysisRequest): boolean {
  const capabilities = solver.capabilities;
  if (request.dimension === "3d" && request.elementFamilies.includes("solid")) {
    return solver.id === "openaec-native-fem" && solver.available
      && (request.analysis === "linear"
        && request.elementFamilies.every((family) => family === "solid" || family === "frame" || family === "plate")
        || request.analysis === "material-nonlinear"
        && request.elementFamilies.every((family) => family === "solid" || family === "frame" || family === "plate")
        || request.analysis === "p-delta"
        && request.elementFamilies.length === 1 && request.elementFamilies[0] === "solid");
  }
  // The native 2D app routes cover pure membranes and pure frames. Frame
  // material analysis requires an explicit axial law and a separate UI mode.
  if (solver.id === "openaec-native-fem" && request.dimension === "2d") {
    return solver.available
      && capabilities.dimensions.includes("2d")
      && capabilities.analyses.includes(request.analysis)
      && request.elementFamilies.length === 1
      && (request.elementFamilies[0] === "plate" || request.elementFamilies[0] === "frame");
  }
  if (solver.id === "openaec-native-fem" && request.dimension === "3d"
      && request.elementFamilies.includes("plate")) {
    // Geometric shell GNL and material-only secant-E FNL both run through the
    // app's native plate adapter; steel plasticity and cracked-shell laws wait.
    return solver.available && (request.analysis === "linear" || request.analysis === "p-delta"
      || request.analysis === "material-nonlinear")
      && request.elementFamilies.length === 1 && request.elementFamilies[0] === "plate";
  }
  return solver.available
    && capabilities.dimensions.includes(request.dimension)
    && capabilities.analyses.includes(request.analysis)
    && request.elementFamilies.every((family) => capabilities.elementFamilies.includes(family));
}

/** Resolve one engine for the complete coupled request. */
export function resolveSolver(
  preference: SolverPreference,
  request: AnalysisRequest,
): SolverDescriptor {
  if (preference !== "automatic") {
    const requested = SOLVER_REGISTRY.find((solver) => solver.id === preference);
    if (!requested) throw new SolverResolutionError(`Unknown solver: ${preference}`);
    if (!requested.available) {
      throw new SolverResolutionError(`${requested.name} is not installed in this build.`);
    }
    if (!supportsRequest(requested, request)) {
      throw new SolverResolutionError(`${requested.name} does not support this analysis request.`);
    }
    return requested;
  }

  const resolved = SOLVER_REGISTRY
    .filter((solver) => (solver.automaticEligible !== false
      || request.dimension === "3d" && request.elementFamilies.includes("solid"))
      && supportsRequest(solver, request))
    .sort((a, b) => b.priority - a.priority)[0];

  if (!resolved) {
    const manual = SOLVER_REGISTRY.find((solver) => solver.automaticEligible === false
      && supportsRequest(solver, request));
    if (manual) {
      throw new SolverResolutionError(`Kies in Instellingen → Berekening expliciet ${manual.name} voor deze analyse.`);
    }
    throw new SolverResolutionError("No installed solver supports this analysis request.");
  }
  return resolved;
}

/**
 * Neutral solver catalogue and capability router.
 *
 * UI and project data only use these Open FEM types. Concrete engine adapters
 * translate an AnalysisRequest at the boundary, so a future plate or volume
 * solver can be added without leaking engine-specific fields into the model.
 */

export const SOLVER_PREFERENCE_KEY = "solverPreference";

export type SolverEngineId = "open-fem-2d" | "dedaliano" | "openaec-native-fem";
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
    id: "open-fem-2d",
    name: "Open FEM 2D",
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
    id: "dedaliano",
    name: "Dedaliano / Stabileo",
    version: "7d87e551b765c88956df95b375e0ef0befda53f7",
    license: "AGPL-3.0",
    available: true,
    priority: 200,
    capabilities: {
      dimensions: ["3d"],
      analyses: ["linear", "p-delta"],
      elementFamilies: ["frame"],
    },
  },
  {
    id: "openaec-native-fem",
    name: "Open FEM Rust (experimenteel)",
    version: "0.1.0",
    license: "AGPL-3.0-or-later",
    available: true,
    priority: 150,
    capabilities: {
      dimensions: ["3d"],
      analyses: ["linear", "p-delta"],
      elementFamilies: ["frame"],
    },
  },
]);

export function isSolverPreference(value: unknown): value is SolverPreference {
  return value === "automatic" || SOLVER_REGISTRY.some((solver) => solver.id === value);
}

export function normaliseSolverPreference(value: unknown): SolverPreference {
  return isSolverPreference(value) ? value : "automatic";
}

export function supportsRequest(solver: SolverDescriptor, request: AnalysisRequest): boolean {
  const capabilities = solver.capabilities;
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
    .filter((solver) => supportsRequest(solver, request))
    .sort((a, b) => b.priority - a.priority)[0];

  if (!resolved) {
    throw new SolverResolutionError("No installed solver supports this analysis request.");
  }
  return resolved;
}

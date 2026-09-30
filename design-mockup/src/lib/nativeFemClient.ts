/** Experimental transport to the independent Rust FEM kernels.
 * The same typed `solve_native_fem` dispatch runs behind Tauri, the development
 * browser bridge, and MCP. Unsupported model features fail in Rust.
 */
import { roepKern } from "../stores/checkStore";
import type { Mesh } from "../core/fem/Mesh";
import {
  buildNativeHybridPlateRequest, buildNativeQuad2DRequest,
  type NativeModulusCurve, type NativeReinforcementSpec,
  type NativeMaterialLaw,
} from "../core/fem/nativePlate2DAdapter";

export type NativeFemKind =
  | "frame3d"
  | "plate2d"
  | "plateBending"
  | "quad2d"
  | "hybridPlate"
  | "squareMesh"
  | "prestressedBeam";

export async function solveNativeFem<T>(kind: NativeFemKind, input: unknown): Promise<T> {
  const answer = await roepKern<{ kind: NativeFemKind; result: T }>(
    "solve_native_fem", { kind, input },
  );
  if (answer?.kind !== kind || answer.result === undefined) {
    throw new Error(`De eigen Rust-solver gaf geen ${kind}-resultaat terug.`);
  }
  return answer.result;
}

export interface NativeQuad2DResult {
  nodes: Array<{ nodeId: number; uxM: number; uyM: number; rxKn: number; ryKn: number }>;
  quads: Array<{
    quadId: number;
    averageStrain: [number, number, number];
    averageStressMpa: [number, number, number];
    gaussPoints: Array<{
      stressMpa: [number, number, number]; effectiveEMpa: number;
      maxEquivalentStrain: number; equivalentPlasticStrain: number; tensileDamage: number;
    }>;
  }>;
  iterations: number;
  relativeResidual: number;
}

export interface NativeHybridPlateResult {
  nodes: Array<{
    nodeId: number; wM: number; thetaXRad: number; thetaYRad: number;
    reactionFzKn: number; reactionMxKnm: number; reactionMyKnm: number;
  }>;
  elements: Array<{
    quadId: number; momentKnmPerM: [number, number, number];
    shearKnPerM: [number, number]; effectiveEMpa: number;
    maxFibreStrain: number; reinforcement?: unknown;
  }>;
  iterations: number;
  relativeResidual: number;
}

/** Existing Mesh -> strict Rust Q4 input -> browser or desktop transport. */
export function solveNativeQuad2D(
  mesh: Mesh,
  analysis: 'linear' | 'geometric' | 'material' | 'combined' = 'linear',
  laws: ReadonlyMap<number, NativeMaterialLaw> = new Map(),
  loadPath: readonly number[] = [],
  modulusCurves: readonly NativeModulusCurve[] = [],
): Promise<NativeQuad2DResult> {
  return solveNativeFem('quad2d',
    buildNativeQuad2DRequest(mesh, analysis, laws, loadPath, modulusCurves));
}

/** Existing Mesh -> strict Rust hybrid bending input -> browser or desktop transport. */
export function solveNativeHybridPlate(
  mesh: Mesh,
  pressureKnM2 = 0,
  modulusCurves: readonly NativeModulusCurve[] = [],
  loadPath: readonly number[] = [],
  reinforcement?: NativeReinforcementSpec,
): Promise<NativeHybridPlateResult> {
  return solveNativeFem('hybridPlate',
    buildNativeHybridPlateRequest(mesh, pressureKnM2, modulusCurves, loadPath, reinforcement));
}

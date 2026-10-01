/** Experimental transport to the independent Rust FEM kernels.
 * The same typed `solve_native_fem` dispatch runs behind Tauri, the development
 * browser bridge, and MCP. Unsupported model features fail in Rust.
 */
import { roepKern } from "../stores/checkStore";
import type { Mesh } from "../core/fem/Mesh";
import {
  buildNativeHybridPlateRequest, buildNativePlate2DRequest, buildNativeQuad2DRequest,
  type NativeModulusCurve, type NativeQuadPressure, type NativeReinforcementSpec,
  type NativeMaterialLaw,
} from "../core/fem/nativePlate2DAdapter";

export type NativeFemKind =
  | "frame2d"
  | "frame3d"
  | "plate2d"
  | "plateBending"
  | "quad2d"
  | "hybridPlate"
  | "squareMesh"
  | "quadMesh"
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

export interface NativeTriangle2DResult {
  nodes: NativeQuad2DResult["nodes"];
  elements: Array<{
    triangleId: number;
    strain: [number, number, number];
    stressMpa: [number, number, number];
    equivalentPlasticStrain: number;
    tensileDamage: number;
    effectiveEMpa: number;
    maxEquivalentStrain: number;
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
    maxFibreStrain: number; reinforcement?: NativePlateReinforcementEnvelope;
  }>;
  iterations: number;
  relativeResidual: number;
}

export interface NativePlateReinforcementEnvelope {
  limitState: 'ultimate' | 'service';
  checkedPoints: number;
  shear?: { positionM: [number, number]; check: {
    demandKnPerM: number; concreteResistanceKnPerM: number;
    requiredShearMm2PerM2: number; providedShearMm2PerM2: number;
    shearReinforcementSufficient: boolean; strutSufficient: boolean;
  } };
  maximumStrutUtilization?: number;
  longitudinal?: { requiredMm2PerM: [number, number, number, number];
    providedMm2PerM: [number, number, number, number]; sufficient: [boolean, boolean, boolean, boolean];
    governingPositionsM: [[number, number], [number, number], [number, number], [number, number]] };
  crack?: Array<{ positionM: [number, number]; check: {
    cracked: boolean; unreinforcedTension: boolean; characteristicWidthMm: number | null;
    passesLimit: boolean | null;
  } }>;
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

export function solveNativeTriangle2D(
  mesh: Mesh,
  analysis: 'linear' | 'geometric' | 'material' | 'combined' = 'linear',
  laws: ReadonlyMap<number, NativeMaterialLaw> = new Map(),
  loadPath: readonly number[] = [],
  modulusCurves: readonly NativeModulusCurve[] = [],
): Promise<NativeTriangle2DResult> {
  return solveNativeFem('plate2d',
    buildNativePlate2DRequest(mesh, analysis, laws, loadPath, modulusCurves));
}

/** Existing Mesh -> strict Rust hybrid bending input -> browser or desktop transport. */
export function solveNativeHybridPlate(
  mesh: Mesh,
  pressureKnM2 = 0,
  modulusCurves: readonly NativeModulusCurve[] = [],
  loadPath: readonly number[] = [],
  reinforcement?: NativeReinforcementSpec,
  quadPressures: readonly NativeQuadPressure[] = [],
): Promise<NativeHybridPlateResult> {
  return solveNativeFem('hybridPlate',
    buildNativeHybridPlateRequest(mesh, pressureKnM2, modulusCurves, loadPath, reinforcement, quadPressures));
}

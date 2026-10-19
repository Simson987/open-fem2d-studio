/** Experimental transport to the independent Rust FEM kernels.
 * The same typed `solve_native_fem` dispatch runs behind Tauri, the development
 * browser bridge, and MCP. Unsupported model features fail in Rust.
 */
import { roepKern } from "../stores/checkStore";
import type { Mesh } from "../core/fem/Mesh";
import { buildNativeGeometricShellRequest } from "../core/fem/nativeGeometricShellAdapter";
import { buildNativeThreeLayerBatchInput, buildNativeThreeLayerMembraneBatchInput,
  type NativeThreeLayerConfiguration } from "../core/fem/nativeThreeLayerAdapter";
import {
  buildNativeHybridPlateRequest, buildNativeMixed2DRequest, buildNativePlate2DRequest,
  buildNativePlateBendingRequest, buildNativeQuad2DRequest,
  type NativeEdgeLoad, type NativeModulusCurve, type NativeQuadPressure, type NativeReinforcementSpec,
  type NativeMaterialLaw, type NativeMixed2DLinearBackend, type NativePlateAnalysis,
} from "../core/fem/nativePlate2DAdapter";

export type NativeFemKind =
  | "frame2d"
  | "frame3d"
  | "plate2d"
  | "plateBending"
  | "quad2d"
  | "mixed2d"
  | "mixed3d"
  | "hybridPlate"
  | "hybridPlateLayered"
  | "hybridPlateFiber"
  | "geometricShell"
  | "squareMesh"
  | "quadMesh"
  | "prestressedBeam"
  | "crackWidth"
  | "threeLayer"
  | "threeLayerBatch"
  | "volume3d"
  | "volume3dConcreteDamage"
  | "volume3dFiniteJ2"
  | "volume3dFiniteJ2Coupled"
  | "volume3dFiniteJ2MembraneCoupled"
  | "volume3dFiniteJ2HexCoupled"
  | "volume3dFiniteJ2FrameCoupled"
  | "volume3dGnl"
  | "volume3dJ2"
  | "volumeHex8";

export interface NativeVolume3DInput {
  nodes: Array<[number, number, number]>;
  materials: Array<{ eMpa: number; poisson: number }>;
  elements: Array<{ nodes: [number, number, number, number]; material: number }>;
  loads: Array<{ node: number; forceKn: [number, number, number] }>;
  bodyForces?: Array<{ element: number; forceKnPerM3: [number, number, number] }>;
  faceTractions?: Array<{ element: number; nodes: [number, number, number]; tractionKnPerM2: [number, number, number] }>;
  supports: Array<{ node: number; displacementM: [number | null, number | null, number | null] }>;
  threads?: number;
  tolerance?: number;
  maxIterations?: number;
  solverStrategy?: "automatic" | "matrixFree" | "sparse" | "sparseDirect" | "frontal";
}

export interface NativeVolume3DResult {
  nodalDisplacementsM: Array<[number, number, number]>;
  nodalReactionsKn: Array<[number, number, number]>;
  /** Constant Tet4 stress ordered xx, yy, zz, xy, yz, zx. */
  elementStressMpa: Array<[number, number, number, number, number, number]>;
  iterations: number;
  relativeResidual: number;
  threads: number;
  solverUsed: "matrixFree" | "sparse" | "sparseDirect" | "frontal";
}

export function solveNativeVolume3D(input: NativeVolume3DInput): Promise<NativeVolume3DResult> {
  return solveNativeFem<NativeVolume3DResult>("volume3d", input);
}

/** Linear shared-node Tet4/Hex8 solids, triangular membranes/bending plates, trusses and 3D frames. */
export interface NativeMixed3DInput {
  mesh: { nodes: Array<[number, number, number]>; tets: Array<[number, number, number, number]> };
  solidMaterial: { eMpa: number; poisson: number };
  /** Optional one-to-one Tet4 material list, in mesh.tets order. */
  tetMaterials?: Array<{ eMpa: number; poisson: number }>;
  hexes?: Array<{ nodes: [number, number, number, number, number, number, number, number]; eMpa: number; poisson: number }>;
  /** Local e1 runs from first to second node; e2 points toward the third node. */
  membranes?: Array<{ nodes: [number, number, number]; eMpa: number; nu: number; thicknessM: number }>;
  /** Horizontal XY Tri3 DKT bending only; no in-plane membrane stiffness. */
  bendingPlates?: Array<{ nodes: [number, number, number]; eMpa: number; nu: number; thicknessM: number }>;
  /** Consistent global traction on a Tri3 membrane, assembled as A·t/3 per node in Rust. */
  membraneTractions?: Array<{ element: number; tractionKnPerM2: [number, number, number] }>;
  trusses: Array<{ nodes: [number, number]; eMpa: number; areaM2: number }>;
  /** Frame nodes own three rotations; DKT-only nodes own Rx/Ry. */
  frames?: Array<{
    nodes: [number, number]; eMpa: number; poisson: number; gMpa?: number; areaM2: number;
    iyM4: number; izM4: number; torsionJM4: number; rollAngleRad?: number;
  }>;
  /** Consistent local transverse loads on zero-based frame elements; assembled in Rust. */
  frameMemberLoads?: Array<{
    element: number; qyStartKnPerM: number; qyEndKnPerM: number;
    qzStartKnPerM: number; qzEndKnPerM: number;
    startPositionM: number; endPositionM: number;
  }>;
  frameMemberPointLoads?: Array<{
    element: number; pyKn: number; pzKn: number; positionM: number;
  }>;
  loadsKn: Array<[number, number, number]>;
  /** Nodal moments about global axes, in kNm. */
  momentsKnm?: Array<[number, number, number]>;
  tetBodyForces?: Array<{ element: number; forceKnPerM3: [number, number, number] }>;
  tetFaceTractions?: Array<{ element: number; nodes: [number, number, number]; tractionKnPerM2: [number, number, number] }>;
  hexBodyForces?: Array<{ element: number; forceKnPerM3: [number, number, number] }>;
  /** Hex8 faceNodes are local indices in outward cyclic order. */
  hexFaceTractions?: Array<{ element: number; faceNodes: [number, number, number, number]; tractionKnPerM2: [number, number, number] }>;
  prescribedM: Array<[number | null, number | null, number | null]>;
  /** Prescribed global rotations in radians; use null for a free rotation. */
  prescribedRotationsRad?: Array<[number | null, number | null, number | null]>;
  backend?: "dense" | "sparseDirect" | "sparsePcg" | "matrixFreePcg" | "frontalWave" | "automatic";
  maxFrontDofs?: number;
  threads?: number;
  maxPcgIterations?: number;
}

export interface NativeMixed3DResult {
  nodalDisplacementsM: Array<[number, number, number]>;
  nodalReactionsKn: Array<[number, number, number]>;
  /** null for nodes without frame or DKT rotations; empty for legacy models without either. */
  nodalRotationsRad: Array<[number, number, number] | null>;
  nodalMomentReactionsKnm: Array<[number, number, number] | null>;
  solidElementStressMpa: Array<[number, number, number, number, number, number]>;
  hexGaussStressMpa: Array<Array<[number, number, number, number, number, number]>>;
  /** Local plane-stress components [sigma11, sigma22, tau12]. */
  membraneStressMpa?: Array<[number, number, number]>;
  /** Local membrane forces per unit width [N11, N22, N12]. */
  membraneResultantsKnPerM?: Array<[number, number, number]>;
  /** Elastic XY-DKT centroid moments [Mx, My, Mxy] in kNm/m, in bendingPlates triangle order. */
  bendingPlateMomentsKnmPerM?: Array<[number, number, number]>;
  trussAxialForceKn: number[];
  /** Local-axis [Fx,Fy,Fz,Mx,My,Mz] at both member ends. */
  frameEndForcesLocal: Array<[[number, number, number, number, number, number], [number, number, number, number, number, number]]>;
  relativeResidual: number;
  backendUsed: "dense" | "sparseDirect" | "sparsePcg" | "matrixFreePcg" | "frontalWave";
  frontalMaximumFrontDofs: number | null;
  linearIterations: number;
}

export function solveNativeMixed3D(input: NativeMixed3DInput): Promise<NativeMixed3DResult> {
  return solveNativeFem<NativeMixed3DResult>("mixed3d", input);
}

/** Experimental small-strain 3D J2 steel Tet4 load-path solver. */
export interface NativeVolume3DJ2Input {
  mesh: { nodes: Array<[number, number, number]>; tets: Array<[number, number, number, number]> };
  steel: { youngsMpa: number; poisson: number; yieldMpa: number; hardeningMpa: number };
  /** Optional steel law per Tet4 in mesh.tets order; overrides steel for every element. */
  elementSteels?: Array<{ youngsMpa: number; poisson: number; yieldMpa: number; hardeningMpa: number }>;
  targets: Array<{
    loadsKn: Array<[number, number, number]>;
    prescribedM: Array<[number | null, number | null, number | null]>;
    bodyForces?: Array<{ element: number; forceKnPerM3: [number, number, number] }>;
    faceTractions?: Array<{ element: number; faceNodes: [number, number, number]; tractionKnPerM2: [number, number, number] }>;
  }>;
  options?: {
    residualTolerance?: number;
    maxNewtonIterations?: number;
    maxLineSearchHalvings?: number;
    minStepFraction?: number;
    maxStepCutbacks?: number;
    maxFactorEntries?: number;
    linearBackend?: "sparseDirect" | "sparsePcg" | "frontalWave" | "automatic";
    maxFrontDofs?: number;
    pcgThreads?: number;
    pcgMaxIterations?: number;
    pcgRelativeTolerance?: number;
  };
}

export interface NativeVolume3DJ2Result {
  nodalDisplacementsM: Array<[number, number, number]>;
  nodalReactionsKn: Array<[number, number, number]>;
  elementStates: Array<{
    stressMpa: [[number, number, number], [number, number, number], [number, number, number]];
    plasticStrain: [[number, number, number], [number, number, number], [number, number, number]];
    equivalentPlasticStrain: number;
  }>;
  acceptedSteps: Array<{ targetIndex: number; targetFraction: number; newtonIterations: number; trueFreeResidualKn: number }>;
  cutbacks: number;
  trueFreeResidualKn: number;
  /** Backend used at the final accepted load step. */
  linearBackendUsed: "sparseDirect" | "sparsePcg" | "frontalWave";
  /** Count of sparse factor-storage-limit recoveries with frontal wavefront. */
  frontalFallbacks: number;
}

export function solveNativeVolume3DJ2(input: NativeVolume3DJ2Input): Promise<NativeVolume3DJ2Result> {
  return solveNativeFem<NativeVolume3DJ2Result>("volume3dJ2", input);
}

/** Bounded total-Lagrangian finite-strain J2 Tet4 research route. */
export interface NativeVolume3DFiniteJ2Input {
  mesh: { nodes: Array<[number, number, number]>; tets: Array<[number, number, number, number]> };
  steel: { youngsMpa: number; poisson: number; yieldMpa: number; hardeningMpa: number };
  elementSteels?: Array<{ youngsMpa: number; poisson: number; yieldMpa: number; hardeningMpa: number }>;
  targets: Array<{
    loadsKn: Array<[number, number, number]>;
    prescribedM: Array<[number | null, number | null, number | null]>;
    /** Dead force per undeformed volume in reference coordinates. */
    bodyForces?: Array<{ element: number; forceKnPerM3: [number, number, number] }>;
    /** Dead traction per undeformed triangular face area. */
    faceTractions?: Array<{ element: number; faceNodes: [number, number, number]; tractionKnPerM2: [number, number, number] }>;
  }>;
  options?: {
    residualTolerance?: number;
    maxNewtonIterations?: number;
    maxLineSearchHalvings?: number;
    maxCutbacks?: number;
    minStepFraction?: number;
    linearBackend?: "dense" | "sparseGmres" | "frontalWave" | "matrixFreeGmres" | "matrixFreeGmresLarge" | "automatic";
    gmresRestart?: number;
    gmresMaxIterations?: number;
    gmresRelativeTolerance?: number;
    maxFrontDofs?: number;
    geometricFrames?: boolean;
    matrixFreeThreads?: number;
  };
}

export interface NativeVolume3DFiniteJ2Result {
  nodalDisplacementsM: Array<[number, number, number]>;
  nodalReactionsKn: Array<[number, number, number]>;
  /** Present only on the full 3D bending-frame coupled finite-J2 route. */
  nodalRotationsRad?: Array<[number, number, number]>;
  nodalReactionMomentsKnM?: Array<[number, number, number]>;
  frameEndForcesLocal?: Array<[
    [number, number, number, number, number, number],
    [number, number, number, number, number, number],
  ]>;
  /** Elastic reference XY-DKT centroid [Mx, My, Mxy] in kNm/m, in bendingPlates input order. */
  bendingPlateMomentsKnmPerM?: Array<[number, number, number]>;
  elementStates: Array<{
    fp: [[number, number, number], [number, number, number], [number, number, number]];
    equivalentPlasticStrain: number;
  }>;
  /** First Piola stress [spatial row, reference column], MPa. */
  elementFirstPiolaMpa: Array<[[number, number, number], [number, number, number], [number, number, number]]>;
  /** Eight independently committed plastic states for each coupled Hex8. */
  hexGaussStates?: Array<NativeVolume3DFiniteJ2Result["elementStates"]>;
  /** First Piola and current Cauchy stresses at each Hex8 integration point. */
  hexGaussFirstPiolaMpa?: Array<NativeVolume3DFiniteJ2Result["elementFirstPiolaMpa"]>;
  hexGaussCauchyMpa?: Array<NativeVolume3DFiniteJ2Result["elementFirstPiolaMpa"]>;
  trussAxialForceKn: number[];
  trussStates: Array<{ plasticLogStrain: number; accumulatedPlasticLogStrain: number } | null>;
  trussAlgorithmicModulusMpa: Array<number | null>;
  /** Second Piola–Kirchhoff [S11, S22, S12] in each reference membrane plane. */
  membraneStressMpa: Array<[number, number, number]>;
  /** Plastic membrane history; null for elastic membranes. */
  membraneStates: Array<{ fp: [[number, number, number], [number, number, number], [number, number, number]];
    equivalentPlasticStrain: number } | null>;
  membraneThicknessStretch: Array<number | null>;
  /** Global Kirchhoff tensor; null for elastic membranes. */
  membraneKirchhoffMpa: Array<[[number, number, number], [number, number, number], [number, number, number]] | null>;
  /** Current-local Cauchy [11,22,12]; null for elastic membranes. */
  membraneCauchyMpa: Array<[number, number, number] | null>;
  /** Current-local membrane resultants [N11,N22,N12], kN/m; null for elastic membranes. */
  membraneForceResultantKnPerM: Array<[number, number, number] | null>;
  acceptedSteps: Array<{ targetIndex: number; targetFraction: number; newtonIterations: number; trueFreeResidualKn: number }>;
  cutbacks: number;
  trueFreeResidualKn: number;
  linearBackendUsed: "dense" | "sparseGmres" | "frontalWave" | "matrixFreeGmres" | "matrixFreeGmresLarge";
  frontalFallbacks: number;
}

export function solveNativeVolume3DFiniteJ2(input: NativeVolume3DFiniteJ2Input): Promise<NativeVolume3DFiniteJ2Result> {
  return solveNativeFem<NativeVolume3DFiniteJ2Result>("volume3dFiniteJ2", input);
}

export interface NativeVolume3DFiniteJ2CoupledInput {
  volume: NativeVolume3DFiniteJ2Input;
  trusses: Array<{ nodes: [number, number]; youngsMpa: number; areaM2: number;
    plasticity?: { yieldMpa: number; hardeningMpa: number } }>;
}

export function solveNativeVolume3DFiniteJ2Coupled(
  input: NativeVolume3DFiniteJ2CoupledInput,
): Promise<NativeVolume3DFiniteJ2Result> {
  return solveNativeFem<NativeVolume3DFiniteJ2Result>("volume3dFiniteJ2Coupled", input);
}

export interface NativeVolume3DFiniteJ2MembraneCoupledInput {
  volume: NativeVolume3DFiniteJ2Input;
  trusses?: NativeVolume3DFiniteJ2CoupledInput["trusses"];
  membranes: Array<{ nodes: [number, number, number]; youngsMpa: number; poisson: number; thicknessM: number;
    plasticity?: { yieldMpa: number; hardeningMpa: number } }>;
}

export function solveNativeVolume3DFiniteJ2MembraneCoupled(
  input: NativeVolume3DFiniteJ2MembraneCoupledInput,
): Promise<NativeVolume3DFiniteJ2Result> {
  return solveNativeFem<NativeVolume3DFiniteJ2Result>("volume3dFiniteJ2MembraneCoupled", input);
}

export interface NativeVolume3DFiniteJ2HexCoupledInput {
  volume: NativeVolume3DFiniteJ2Input;
  hexes: Array<{ nodes: [number, number, number, number, number, number, number, number];
    steel: NativeVolume3DFiniteJ2Input["steel"] }>;
  /** Absolute dead-load targets aligned one-to-one with volume.targets. */
  hexTargets: Array<{
    bodyForces?: Array<{ element: number; forceKnPerM3: [number, number, number] }>;
    faceTractions?: Array<{ element: number; faceNodes: [number, number, number, number];
      tractionKnPerM2: [number, number, number] }>;
  }>;
  trusses?: NativeVolume3DFiniteJ2CoupledInput["trusses"];
  membranes?: NativeVolume3DFiniteJ2MembraneCoupledInput["membranes"];
}

export function solveNativeVolume3DFiniteJ2HexCoupled(
  input: NativeVolume3DFiniteJ2HexCoupledInput,
): Promise<NativeVolume3DFiniteJ2Result> {
  return solveNativeFem<NativeVolume3DFiniteJ2Result>("volume3dFiniteJ2HexCoupled", input);
}

export interface NativeVolume3DFiniteJ2FrameCoupledInput extends NativeVolume3DFiniteJ2HexCoupledInput {
  frames: Array<{ nodes: [number, number]; youngsMpa: number; poisson: number;
    /** Independent Saint-Venant torsion modulus in MPa; omitted means isotropic G. */
    gMpa?: number;
    areaM2: number; iyM4: number; izM4: number; torsionJM4: number; rollAngleRad?: number }>;
  /** Elastic, horizontal XY-DKT triangles on Tet4/Hex8-supported nodes. No plate moment recovery. */
  bendingPlates?: Array<{ nodes: [number, number, number]; youngsMpa: number;
    poisson: number; thicknessM: number }>;
  frameTargets: Array<{
    momentsKnM: Array<[number, number, number]>;
    prescribedRotationRad: Array<[number | null, number | null, number | null]>;
  }>;
  /** Absolute dead-load targets aligned with volume.targets; local reference y/z, kN/m. */
  frameMemberLoadTargets?: Array<Array<{
    element: number;
    qyStartKnPerM: number; qyEndKnPerM: number;
    qzStartKnPerM: number; qzEndKnPerM: number;
    startPositionM: number; endPositionM: number;
  }>>;
  /** Absolute fixed-axis point-load targets aligned with volume.targets; local y/z, kN. */
  frameMemberPointLoadTargets?: Array<Array<{
    element: number; pyKn: number; pzKn: number; positionM: number;
  }>>;
}

export function solveNativeVolume3DFiniteJ2FrameCoupled(
  input: NativeVolume3DFiniteJ2FrameCoupledInput,
): Promise<NativeVolume3DFiniteJ2Result> {
  return solveNativeFem<NativeVolume3DFiniteJ2Result>("volume3dFiniteJ2FrameCoupled", input);
}

/** Experimental small-strain concrete tension damage; caller must set crack-band width. */
export interface NativeVolume3DConcreteDamageInput {
  mesh: { nodes: Array<[number, number, number]>; tets: Array<[number, number, number, number]> };
  eMpa: number;
  poisson: number;
  tensileStrengthMpa: number;
  fractureEnergyNPerM: number;
  crackBandWidthM: number;
  /** Optional full damage law per Tet4 in mesh.tets order; each width remains caller-specified. */
  elementMaterials?: Array<{
    eMpa: number;
    poisson: number;
    tensileStrengthMpa: number;
    fractureEnergyNPerM: number;
    crackBandWidthM: number;
  }>;
  targets: Array<{
    loadsKn: Array<[number, number, number]>;
    prescribedM: Array<[number | null, number | null, number | null]>;
    bodyForces?: Array<{ element: number; forceKnPerM3: [number, number, number] }>;
    faceTractions?: Array<{ element: number; faceNodes: [number, number, number]; tractionKnPerM2: [number, number, number] }>;
  }>;
  options?: {
    residualTolerance?: number;
    maxNewtonIterations?: number;
    maxLineSearchHalvings?: number;
    minStepFraction?: number;
    maxCutbacks?: number;
    linearBackend?: "denseLu" | "sparseGmres";
    gmresRestart?: number;
    gmresMaxIterations?: number;
    gmresRelativeTolerance?: number;
  };
}

export interface NativeVolume3DConcreteDamageResult {
  nodalDisplacementsM: Array<[number, number, number]>;
  nodalReactionsKn: Array<[number, number, number]>;
  elementStressMpa: Array<[number, number, number, number, number, number]>;
  elementDamage: number[];
  elementStates: Array<{ maxEquivalentStrain: number }>;
  acceptedSteps: Array<{ targetIndex: number; targetFraction: number; newtonIterations: number; trueFreeResidualKn: number }>;
  cutbacks: number;
  trueFreeResidualKn: number;
  linearBackendUsed: "denseLu" | "sparseGmres";
}

export function solveNativeVolume3DConcreteDamage(input: NativeVolume3DConcreteDamageInput): Promise<NativeVolume3DConcreteDamageResult> {
  return solveNativeFem<NativeVolume3DConcreteDamageResult>("volume3dConcreteDamage", input);
}

/** Experimental total-Lagrangian St Venant–Kirchhoff Tet4 route for bounded meshes. */
export interface NativeVolume3DGnlInput {
  mesh: { nodes: Array<[number, number, number]>; tets: Array<[number, number, number, number]> };
  eMpa: number;
  poisson: number;
  /** Optional E and Poisson ratio per Tet4, in mesh.tets order. */
  elementMaterials?: Array<{ eMpa: number; poisson: number }>;
  /** Optional dimensionless coefficient β per Tet4 for W = W0 + β W0²/(2E). */
  elementEnergyBeta?: number[];
  targets: Array<{
    loadsKn: Array<[number, number, number]>;
    prescribedM: Array<[number | null, number | null, number | null]>;
    /** Dead load per reference Tet4 volume, kN/m³. */
    bodyForces?: Array<{ element: number; forceKnPerM3: [number, number, number] }>;
    /** Nominal traction on a reference Tet4 face, kN/m². */
    faceTractions?: Array<{ element: number; faceNodes: [number, number, number]; tractionKnPerM2: [number, number, number] }>;
  }>;
  options?: {
    residualTolerance?: number;
    maxNewtonIterations?: number;
    maxLineSearchHalvings?: number;
    minStepFraction?: number;
    maxCutbacks?: number;
    /** Bounded Newton tangent solver; dense remains the default. */
    linearBackend?: "dense" | "sparseDirect" | "sparseGmres" | "frontalWave" | "automatic";
    maxFactorEntries?: number;
    maxFrontDofs?: number;
    gmresRestart?: number;
    gmresMaxIterations?: number;
    gmresRelativeTolerance?: number;
  };
}

export interface NativeVolume3DGnlResult {
  nodalDisplacementsM: Array<[number, number, number]>;
  nodalReactionsKn: Array<[number, number, number]>;
  elementGreenStrain: Array<[[number, number, number], [number, number, number], [number, number, number]]>;
  /** First Piola stress P [spatial row, reference column], MPa. */
  elementFirstPiolaMpa: Array<[[number, number, number], [number, number, number], [number, number, number]]>;
  /** Final secant scaling αE for each Tet4 in the nonlinear energy law, MPa. */
  elementEffectiveEMpa: number[];
  linearBackendUsed: "dense" | "sparseDirect" | "sparseGmres" | "frontalWave";
  frontalFallbacks: number;
  acceptedSteps: Array<{ targetIndex: number; targetFraction: number; newtonIterations: number; trueFreeResidualKn: number }>;
  cutbacks: number;
  trueFreeResidualKn: number;
}

export function solveNativeVolume3DGnl(input: NativeVolume3DGnlInput): Promise<NativeVolume3DGnlResult> {
  return solveNativeFem<NativeVolume3DGnlResult>("volume3dGnl", input);
}

export interface NativeVolumeHex8Input {
  nodes: Array<[number, number, number]>;
  materials: Array<{ eMpa: number; poisson: number }>;
  elements: Array<{ nodes: [number, number, number, number, number, number, number, number]; material: number }>;
  loads: Array<{ node: number; forceKn: [number, number, number] }>;
  bodyForces?: Array<{ element: number; forceKnPerM3: [number, number, number] }>;
  /** faceNodes are outward cyclic local indices, for example [1,2,6,5] for +x. */
  faceTractions?: Array<{ element: number; faceNodes: [number, number, number, number]; tractionKnPerM2: [number, number, number] }>;
  supports: Array<{ node: number; displacementM: [number | null, number | null, number | null] }>;
  tolerance?: number;
  maxIterations?: number;
  /** Exact origin-based rectangular structured ordering selects parallel matrix-free PCG. */
  structuredGridCells?: [number, number, number];
  threads?: number;
  /** Bounded elementwise direct solve; incompatible with structured matrix-free mode. */
  linearBackend?: "automatic" | "sparse" | "sparseDirect" | "frontalWave" | "matrixFreeGeneral" | "matrixFreeGeneralLarge";
}

export interface NativeVolumeHex8Result {
  nodalDisplacementsM: Array<[number, number, number]>;
  nodalReactionsKn: Array<[number, number, number]>;
  elementGaussStressMpa: Array<Array<[number, number, number, number, number, number]>>;
  iterations: number;
  relativeResidual: number;
  csrNonzeros: number;
  solverUsed: "sparse" | "sparseDirect" | "matrixFree" | "matrixFreeGeneral" | "matrixFreeGeneralLarge" | "frontalWave";
  threads: number;
  frontalMaximumFrontDofs?: number;
}

export function solveNativeVolumeHex8(input: NativeVolumeHex8Input): Promise<NativeVolumeHex8Result> {
  return solveNativeFem<NativeVolumeHex8Result>("volumeHex8", input);
}

export interface NativeThreeLayerInput {
  forces: { nx: number; ny: number; nxy: number; mx: number; my: number; mxy: number; vx: number; vy: number };
  thicknessMm: number; topSkinMm: number; bottomSkinMm: number;
  topReinforcement: { asX: number; asY: number };
  bottomReinforcement: { asX: number; asY: number };
  fcdMpa: number; fydMpa: number; nuPrime: number;
  compressionModel: 'blaauwendraad2021' | 'ec2AnnexF';
  core?: { vRdcKnPerM: number; tanTheta: number; providedShearMm2PerM2: number; diagonalLimitMpa: number };
}

export interface NativeThreeLayerSkinResult {
  forces: { nx: number; ny: number; nxy: number };
  requiredAsXmm2PerM: number; requiredAsYmm2PerM: number;
  concreteCompressionMpa: number; compressionLimitMpa: number;
  utilizationAsX: number; utilizationAsY: number; utilizationCompression: number;
  reinforcementCase: 'both-directions' | 'x-only' | 'y-only' | 'compression-only';
  annexFBranch: string;
}

export interface NativeThreeLayerResult {
  leverArmMm: number;
  top: NativeThreeLayerSkinResult;
  bottom: NativeThreeLayerSkinResult;
  core: { vxKnPerM: number; vyKnPerM: number; resultantKnPerM: number; directionDeg: number; shearReinforcementRequired: boolean | null; requiredShearMm2PerM2: number | null; diagonalStressMpa: number | null; utilizationShear: number | null; utilizationDiagonal: number | null };
  status: 'partial_check_passes' | 'partial_check_exceeded';
  notAssessed: string[];
}

export interface NativeThreeLayerBatchInput {
  configuration: Omit<NativeThreeLayerInput, 'forces'>;
  samples: Array<{ id: string; positionM: [number, number]; forces: NativeThreeLayerInput['forces'] }>;
}

export interface NativeThreeLayerBatchResult {
  checkedPoints: number;
  status: 'partial_check_passes' | 'partial_check_exceeded';
  results: Array<{ id: string; positionM: [number, number]; result: NativeThreeLayerResult }>;
}

export interface NativePrestressedBeamInput {
  spanM: number;
  section: { areaM2: number; inertiaM4: number; topFibreM: number; bottomFibreM: number; eMpa: number };
  /** Optional full-span, contiguous elastic E segments; section inertia is shared. */
  stiffnessSegments?: Array<{ startM: number; endM: number; eMpa: number }>;
  tendon: { kind: "straight"; eccentricityM: number }
    | { kind: "parabolic"; endEccentricityM: number; midEccentricityM: number };
  initialForceKn: number;
  lossFraction?: number;
  transferUniformDownwardKnPerM?: number;
  serviceUniformDownwardKnPerM?: number;
  transferPointLoads?: Array<{ positionM: number; downwardKn: number }>;
  servicePointLoads?: Array<{ positionM: number; downwardKn: number }>;
  transferLineLoads?: Array<{
    startM: number;
    endM: number;
    startDownwardKnPerM: number;
    endDownwardKnPerM: number;
  }>;
  serviceLineLoads?: Array<{
    startM: number;
    endM: number;
    startDownwardKnPerM: number;
    endDownwardKnPerM: number;
  }>;
  /** EC2 shear resistance without links; returns separate cracked/uncracked branches. */
  shearWithoutLinks?: {
    webWidthMm: number;
    heightMm: number;
    effectiveDepthMm: number;
    fctdMpa: number;
    vMinMpa: number;
    k1: number;
  };
  /** EC2 variable-angle truss design; all norm-dependent factors are explicit. */
  shearLinks?: {
    webWidthMm: number;
    effectiveDepthMm: number;
    leverArmMm: number;
    alphaCw: number;
    nu1: number;
    fcdMpa: number;
    fywdMpa: number;
    cotTheta: number;
    providedAswMm2?: number;
    providedSpacingMm?: number;
  };
  /** Extra output sections in metres from the left support; both supports are always reported. */
  stationsXM?: number[];
}

export interface NativePrestressedBeamStageResult {
  forceKn: number;
  endEccentricityM: number;
  midEccentricityM: number;
  equivalentUniformUpwardKnPerM: number;
  endMomentKnm: number;
  endVerticalForceMagnitudeKn: number;
  externalLeftReactionKn: number;
  externalRightReactionKn: number;
  leftReactionKn: number;
  rightReactionKn: number;
  prestressMidspanMomentKnm: number;
  externalMidspanMomentKnm: number;
  endStress: { topMpa: number; bottomMpa: number };
  midspanStress: { topMpa: number; bottomMpa: number };
  axialShorteningM: number;
  prestressCamberM: number;
  externalMidspanDeflectionM: number;
  totalMidspanDeflectionM: number;
  stations: NativePrestressedBeamStationResult[];
  criticalStations: NativePrestressedBeamStationResult[];
}

export interface NativePrestressedBeamStationResult {
  xM: number;
  tendonEccentricityM: number;
  effectiveEMpa: number;
  externalMomentKnm: number;
  prestressMomentKnm: number;
  totalMomentKnm: number;
  shearKn: number;
  shearBeforePointLoadKn?: number;
  shearAfterPointLoadKn?: number;
  fibreStress: { topMpa: number; bottomMpa: number };
  prestressDeflectionM: number;
  externalDeflectionM: number;
  totalDeflectionM: number;
  shearResistanceWithoutLinks?: {
    sigmaCpMpa: number;
    vEdKn: number;
    vRdcCrackedKn: number;
    vRdcUncrackedKn: number;
    utilizationCracked: number;
    utilizationUncracked: number;
  };
  shearLinks?: {
    vEdKn: number;
    cotTheta: number;
    requiredAswPerSpacingMm2PerMm: number;
    vRdMaxKn: number;
    utilizationConcreteStrut: number;
    providedAswPerSpacingMm2PerMm?: number;
    maximumSpacingForProvidedAswMm?: number;
    vRdSKn?: number;
    vRdKn?: number;
    utilizationProvidedLinks?: number;
  };
}

export interface NativePrestressedBeamResult {
  transfer: NativePrestressedBeamStageResult;
  service: NativePrestressedBeamStageResult;
}

function validatePrestressedBeamResult(
  input: NativePrestressedBeamInput,
  result: NativePrestressedBeamResult,
): void {
  const finite = (values: number[]) => values.every(Number.isFinite);
  const validStation = (station: NativePrestressedBeamStationResult) => {
    const values = [station.xM, station.tendonEccentricityM, station.effectiveEMpa,
      station.externalMomentKnm, station.prestressMomentKnm, station.totalMomentKnm,
      station.shearKn, station.fibreStress?.topMpa, station.fibreStress?.bottomMpa,
      station.prestressDeflectionM, station.externalDeflectionM, station.totalDeflectionM];
    if (!finite(values) || station.effectiveEMpa <= 0
        || (station.shearBeforePointLoadKn != null && !Number.isFinite(station.shearBeforePointLoadKn))
        || (station.shearAfterPointLoadKn != null && !Number.isFinite(station.shearAfterPointLoadKn))) return false;
    if (input.shearWithoutLinks) {
      const check = station.shearResistanceWithoutLinks;
      if (!check || !finite([check.sigmaCpMpa, check.vEdKn, check.vRdcCrackedKn,
        check.vRdcUncrackedKn, check.utilizationCracked, check.utilizationUncracked])
          || check.vEdKn < 0 || check.vRdcCrackedKn < 0 || check.vRdcUncrackedKn < 0
          || check.utilizationCracked < 0 || check.utilizationUncracked < 0) return false;
    }
    if (input.shearLinks) {
      const links = station.shearLinks;
      if (!links || !finite([links.vEdKn, links.cotTheta, links.requiredAswPerSpacingMm2PerMm,
        links.vRdMaxKn, links.utilizationConcreteStrut])
          || links.vEdKn < 0 || links.requiredAswPerSpacingMm2PerMm < 0
          || links.vRdMaxKn < 0 || links.utilizationConcreteStrut < 0
          || (links.providedAswPerSpacingMm2PerMm != null
            && (!Number.isFinite(links.providedAswPerSpacingMm2PerMm) || links.providedAswPerSpacingMm2PerMm < 0))
          || (links.maximumSpacingForProvidedAswMm != null
            && (!Number.isFinite(links.maximumSpacingForProvidedAswMm) || links.maximumSpacingForProvidedAswMm < 0))
          || (links.vRdSKn != null && (!Number.isFinite(links.vRdSKn) || links.vRdSKn < 0))
          || (links.vRdKn != null && (!Number.isFinite(links.vRdKn) || links.vRdKn < 0))
          || (links.utilizationProvidedLinks != null
            && (!Number.isFinite(links.utilizationProvidedLinks) || links.utilizationProvidedLinks < 0))) return false;
    }
    return station.xM >= 0 && station.xM <= input.spanM;
  };
  const validStage = (stage: NativePrestressedBeamStageResult) => {
    const values = [stage.forceKn, stage.endEccentricityM, stage.midEccentricityM,
      stage.equivalentUniformUpwardKnPerM, stage.endMomentKnm, stage.endVerticalForceMagnitudeKn,
      stage.externalLeftReactionKn, stage.externalRightReactionKn, stage.leftReactionKn,
      stage.rightReactionKn, stage.prestressMidspanMomentKnm, stage.externalMidspanMomentKnm,
      stage.endStress?.topMpa, stage.endStress?.bottomMpa,
      stage.midspanStress?.topMpa, stage.midspanStress?.bottomMpa,
      stage.axialShorteningM, stage.prestressCamberM, stage.externalMidspanDeflectionM,
      stage.totalMidspanDeflectionM];
    if (!finite(values) || stage.forceKn < 0 || !Array.isArray(stage.stations)
        || !Array.isArray(stage.criticalStations) || stage.stations.length < 2
        || stage.criticalStations.length < 2
        || !stage.stations.every(validStation) || !stage.criticalStations.every(validStation)) return false;
    for (const stations of [stage.stations, stage.criticalStations]) {
      if (stations[0].xM !== 0 || stations[stations.length - 1].xM !== input.spanM
          || stations.some((station, index) => index > 0 && station.xM <= stations[index - 1].xM)) return false;
    }
    return input.stationsXM?.every((x) => stage.stations.some((station) => station.xM === x)) ?? true;
  };
  if (!result?.transfer || !result.service || !validStage(result.transfer) || !validStage(result.service)) {
    throw new Error("De Rust-voorgespannen ligger leverde onvolledige, niet-eindige of ongeldige stationsresultaten terug.");
  }
}

/** EC2 7.3.4 postprocessor. All section response values are from a cracked
 * section; for pretensioned members sigmaSMpa is Δσp from zero concrete strain. */
export interface NativeCrackWidthInput {
  sigmaSMpa: number;
  widthMm: number;
  heightMm: number;
  effectiveDepthMm: number;
  neutralAxisMm: number;
  bondedReinforcementAreaMm2?: number;
  /** Bond-adjusted A'p term for (7.10), based on the selected code edition. */
  effectiveBondedPrestressingAreaMm2?: number;
  coverToLongitudinalSteelMm: number;
  barOrTendonDiameterMm: number;
  spacingMm?: number;
  fCkMpa: number;
  fCtEffMpa: number;
  eCmMpa: number;
  kT: number;
  k1: number;
  k2: number;
  wMaxMm: number;
}

export interface NativeCrackWidthResult {
  effectiveTensionHeightMm: number;
  effectiveConcreteAreaMm2: number;
  effectiveReinforcementRatio: number;
  strainDifference: number;
  tensionStiffeningFloorGoverns: boolean;
  maximumCrackSpacingMm: number;
  crackSpacingEquation: string;
  crackWidthMm: number;
  allowableCrackWidthMm: number;
  utilization: number;
  passes: boolean;
}

export function solveNativeThreeLayer(input: NativeThreeLayerInput): Promise<NativeThreeLayerResult> {
  return solveNativeFem('threeLayer', input);
}

export function solveNativeThreeLayerBatch(input: NativeThreeLayerBatchInput): Promise<NativeThreeLayerBatchResult> {
  return solveNativeFem('threeLayerBatch', input);
}

/** Solve the Rust prestressed beam reference model through the same app transport. */
export async function solveNativePrestressedBeam(
  input: NativePrestressedBeamInput,
): Promise<NativePrestressedBeamResult> {
  const result = await solveNativeFem<NativePrestressedBeamResult>('prestressedBeam', input);
  validatePrestressedBeamResult(input, result);
  return result;
}

/** Check a supplied cracked-section response using the Rust EC2 7.3.4 kernel. */
export function solveNativeCrackWidth(
  input: NativeCrackWidthInput,
): Promise<NativeCrackWidthResult> {
  return solveNativeFem<NativeCrackWidthResult>('crackWidth', input).then((result) => {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("De Rust-scheurwijdtecontrole leverde onvolledige of ongeldige resultaten terug.");
    }
    const positiveValues = [result.effectiveTensionHeightMm, result.effectiveConcreteAreaMm2,
      result.effectiveReinforcementRatio, result.maximumCrackSpacingMm,
      result.crackWidthMm, result.allowableCrackWidthMm];
    const nonnegativeValues = [result.strainDifference, result.utilization];
    const expectedUtilization = result.crackWidthMm / input.wMaxMm;
    const coherentCheck = Math.abs(result.allowableCrackWidthMm - input.wMaxMm)
        <= 1e-10 * Math.max(1, input.wMaxMm)
      && Math.abs(result.utilization - expectedUtilization)
        <= 1e-10 * Math.max(1, expectedUtilization)
      && result.passes === (expectedUtilization <= 1);
    if (!positiveValues.every((value) => Number.isFinite(value) && value > 0)
        || !nonnegativeValues.every((value) => Number.isFinite(value) && value >= 0)
        || !coherentCheck
        || typeof result.tensionStiffeningFloorGoverns !== "boolean"
        || typeof result.passes !== "boolean"
        || !["7.11", "7.11 NB-bovengrens", "7.14"].includes(result.crackSpacingEquation)) {
      throw new Error("De Rust-scheurwijdtecontrole leverde onvolledige of ongeldige resultaten terug.");
    }
    return result;
  });
}

export function solveNativeThreeLayerFromSolverResults(
  mesh: Mesh,
  membrane: NativeQuad2DResult,
  bending: NativeHybridPlateResult,
  configuration: NativeThreeLayerConfiguration,
): Promise<NativeThreeLayerBatchResult> {
  return solveNativeThreeLayerBatch(
    buildNativeThreeLayerBatchInput(mesh, membrane, bending, configuration),
  );
}

export function solveNativeThreeLayerFromMembraneResults(
  mesh: Mesh,
  membrane: NativeQuad2DResult,
  configuration: NativeThreeLayerConfiguration,
): Promise<NativeThreeLayerBatchResult> {
  return solveNativeThreeLayerBatch(
    buildNativeThreeLayerMembraneBatchInput(mesh, membrane, configuration),
  );
}

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

export interface NativeMixed2DResult {
  nodes: NativeQuad2DResult["nodes"];
  triangles: NativeTriangle2DResult["elements"];
  quads: NativeQuad2DResult["quads"];
  relativeResidual: number;
  linearSolverTrueResidual: number | null;
  linearBackendUsed: NativeMixed2DLinearBackend;
  frontalMaximumFrontDofs: number | null;
}

export interface NativeHybridPlateResult {
  nodes: Array<{
    nodeId: number; wM: number; thetaXRad: number; thetaYRad: number;
    reactionFzKn: number; reactionMxKnm: number; reactionMyKnm: number;
  }>;
  elements: Array<{
    quadId: number; momentKnmPerM: [number, number, number];
    shearKnPerM: [number, number]; effectiveEMpa: number;
    maxFibreStrain: number; maxCombinedStrain?: number;
    maxEquivalentPlasticStrain?: number; maxTensileDamage?: number;
    materialPoints?: Array<{ gaussIndex: [number, number]; positionM: [number, number];
      membraneStrain: [number, number, number]; equivalentPlasticStrain: number; tensileDamage: number }>;
    resultantSamples: Array<{ positionM: [number, number];
      momentKnmPerM: [number, number, number]; shearKnPerM: [number, number] }>;
    reinforcement?: NativePlateReinforcementEnvelope;
  }>;
  iterations: number;
  relativeResidual: number;
  linearBackendUsed?: 'existing' | 'frontalWave';
  frontalMaximumFrontDofs?: number | null;
}

export interface NativeHybridPlateFiberResult {
  nodes: NativeHybridPlateResult['nodes'];
  elements: Array<{
    quadId: number;
    centreMomentKnmPerM: [number, number, number];
    centreShearKnPerM: [number, number];
    maxEquivalentPlasticStrain: number;
    materialPoints: Array<{
      gaussIndex: [number, number];
      positionM: [number, number];
      membraneStrain: [number, number, number];
      curvaturePerM: [number, number, number];
      momentKnmPerM: [number, number, number];
      maxEquivalentPlasticStrain: number;
    }>;
  }>;
  iterations: number;
  acceptedSteps: number;
  cutbacks: number;
  relativeResidual: number;
  linearBackendUsed: 'existing' | 'frontalWave';
  frontalMaximumFrontDofs: number | null;
}

export type NativeGeometricShellInput = ReturnType<typeof buildNativeGeometricShellRequest>;

export interface NativeGeometricShellResult {
  nodes: Array<{
    nodeId: number; uM: number; vM: number; wM: number;
    thetaXRad: number; thetaYRad: number;
    reactionFxKn: number; reactionFyKn: number; reactionFzKn: number;
    reactionMxKnm: number; reactionMyKnm: number;
  }>;
  elements: Array<{
    quadId: number; membraneKnPerM: [number, number, number];
    momentKnmPerM: [number, number, number]; effectiveEMpa: number;
    maxFibreStrain: number; maxCombinedStrain: number;
    maxEquivalentPlasticStrain: number; maxTensileDamage: number;
    materialPoints: Array<{ gaussIndex: [number, number]; positionM: [number, number];
      membraneStrain: [number, number, number]; equivalentPlasticStrain: number; tensileDamage: number }>;
    resultantSamples: Array<{ positionM: [number, number]; membraneKnPerM: [number, number, number];
      momentKnmPerM: [number, number, number]; shearKnPerM: [number, number] }>;
    reinforcement?: NativePlateReinforcementEnvelope;
  }>;
  iterations: number;
  relativeResidual: number;
}

export interface NativePlateBendingResult {
  nodes: Array<{
    nodeId: number; wM: number; thetaXRad: number; thetaYRad: number;
    reactionFzKn: number; reactionMxKnm: number; reactionMyKnm: number;
  }>;
  elements: Array<{
    triangleId: number; momentKnmPerM: [number, number, number];
    effectiveEMpa: number; maxFibreStrain: number;
  }>;
  relativeResidual: number;
  linearBackendUsed?: 'existing' | 'frontalWave';
  frontalMaximumFrontDofs?: number | null;
}

export function solveNativeGeometricShell(
  mesh: Mesh,
  pressureKnM2 = 0,
  modulusCurves: readonly NativeModulusCurve[] = [],
  loadPath: readonly number[] = [],
  reinforcement?: NativeReinforcementSpec,
  quadPressures: readonly NativeQuadPressure[] = [],
  edgeLoads: readonly NativeEdgeLoad[] = [],
  membraneSupports: NativeGeometricShellInput["membraneSupports"] = [],
  membraneLoads: NativeGeometricShellInput["membraneLoads"] = [],
): Promise<NativeGeometricShellResult> {
  return solveNativeFem("geometricShell", buildNativeGeometricShellRequest(
    mesh, pressureKnM2, modulusCurves, loadPath, reinforcement, quadPressures, edgeLoads,
    membraneSupports, membraneLoads,
  ));
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

/** Solve a conforming CST/Q4 membrane mesh in one shared Rust global system. */
export function solveNativeMixed2D(
  mesh: Mesh,
  analysis: NativePlateAnalysis = 'linear',
  laws: ReadonlyMap<number, NativeMaterialLaw> = new Map(),
  loadPath: readonly number[] = [],
  modulusCurves: readonly NativeModulusCurve[] = [],
  linearBackend?: NativeMixed2DLinearBackend,
): Promise<NativeMixed2DResult> {
  return solveNativeFem('mixed2d',
    buildNativeMixed2DRequest(mesh, analysis, laws, loadPath, modulusCurves, linearBackend));
}

/** Existing triangular plate mesh -> Rust DKT bending/FNL input and result. */
export function solveNativePlateBending(
  mesh: Mesh,
  modulusCurves: readonly NativeModulusCurve[] = [],
  loadPath: readonly number[] = [],
  linearBackend: 'existing' | 'frontalWave' = 'existing',
  frontalMaxFrontDofs?: number,
): Promise<NativePlateBendingResult> {
  return solveNativeFem('plateBending',
    buildNativePlateBendingRequest(mesh, modulusCurves, loadPath, linearBackend, frontalMaxFrontDofs));
}

/** Existing Mesh -> strict Rust hybrid bending input -> browser or desktop transport. */
export function solveNativeHybridPlate(
  mesh: Mesh,
  pressureKnM2 = 0,
  modulusCurves: readonly NativeModulusCurve[] = [],
  loadPath: readonly number[] = [],
  reinforcement?: NativeReinforcementSpec,
  quadPressures: readonly NativeQuadPressure[] = [],
  edgeLoads: readonly NativeEdgeLoad[] = [],
  linearBackend: 'existing' | 'frontalWave' = 'existing',
  frontalMaxFrontDofs?: number,
): Promise<NativeHybridPlateResult> {
  return solveNativeFem('hybridPlate',
    buildNativeHybridPlateRequest(mesh, pressureKnM2, modulusCurves, loadPath, reinforcement, quadPressures,
      edgeLoads, linearBackend, frontalMaxFrontDofs));
}

export interface NativeElasticPlateLayer {
  thicknessM: number;
  eMpa: number;
  nu: number;
}

export interface NativeElasticLayeredQuad {
  quadId: number;
  layers: readonly NativeElasticPlateLayer[];
}

/** Elastic, locally N=0 layered bending. Rust validates each quad and layer. */
export function solveNativeHybridPlateLayered(
  mesh: Mesh,
  elasticLayeredSections: readonly NativeElasticLayeredQuad[],
  pressureKnM2 = 0,
  loadPath: readonly number[] = [],
  edgeLoads: readonly NativeEdgeLoad[] = [],
  linearBackend: 'existing' | 'frontalWave' = 'existing',
  frontalMaxFrontDofs?: number,
): Promise<NativeHybridPlateResult> {
  const bending = buildNativeHybridPlateRequest(mesh, pressureKnM2, [], loadPath, undefined, [],
    edgeLoads, linearBackend, frontalMaxFrontDofs);
  return solveNativeFem('hybridPlateLayered', {
    bending,
    elasticLayeredSections: elasticLayeredSections.map(section => ({
      quadId: section.quadId,
      layers: section.layers.map(layer => ({ ...layer, law: { kind: 'elastic' } })),
    })),
  });
}

export interface NativeFiberPlateLayer {
  thicknessM: number;
  eMpa: number;
  nu: number;
  law: { kind: 'elastic' } | { kind: 'steelBilinear'; yieldMpa: number; hardeningRatio: number };
}

export interface NativeFiberPlateQuad {
  quadId: number;
  layers: readonly NativeFiberPlateLayer[];
}

/** Material-only hybrid Kirchhoff bending with one committed steel-fiber history per Gauss point. */
export function solveNativeHybridPlateFiber(
  mesh: Mesh,
  fiberSections: readonly NativeFiberPlateQuad[],
  pressureKnM2 = 0,
  loadPath: readonly number[] = [],
  edgeLoads: readonly NativeEdgeLoad[] = [],
  linearBackend: 'existing' | 'frontalWave' = 'existing',
): Promise<NativeHybridPlateFiberResult> {
  const bending = buildNativeHybridPlateRequest(mesh, pressureKnM2, [], loadPath, undefined, [],
    edgeLoads, linearBackend);
  return solveNativeFem('hybridPlateFiber', {
    bending,
    fiberSections,
  });
}

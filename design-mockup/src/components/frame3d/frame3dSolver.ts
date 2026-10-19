import { isTauriApp } from "../../lib/tauri";
import { solveNativeFem } from "../../lib/nativeFemClient";
import type { NativePlateReinforcementEnvelope } from "../../lib/nativeFemClient";
import type { SolverEngineId } from "../../core/solver/SolverRegistry";
import {
  CONCRETE_E_CM,
  NU_BETON,
  NU_STAAL,
  TIMBER_G_MEAN,
  parseRechthoek,
  resolveSection,
} from "../../lib/sectionResolver";
import { STEEL_GRADES } from "../../lib/steelGrades";
import { STEEL_SECTION_DIMS } from "../../lib/steelSectionDims.generated";
import { thermalAlphaForMaterial } from "../../lib/thermalAlpha";
import { frame3DLoadCaseId, frame3DMemberAxes, type Frame3DModel } from "./frame3dModel";

export type Frame3DAnalysisKind = "linear" | "p-delta" | "material" | "combined";

const isMaterialNonlinear = (analysis: Frame3DAnalysisKind) =>
  analysis === "material" || analysis === "combined";

export type Frame3DProjectAnalysisMode =
  | "eersteOrde" | "tweedeOrdeGeometrisch" | "tweedeOrdeFysisch" | "axiaalFysischRust";

/** Map the shared project analysis selector onto the available 3D solver. */
export function frame3DAnalysisForProject(
  model: Pick<Frame3DModel, "beams" | "plates" | "volumes" | "volumeMaterialKinematics">,
  mode: Frame3DProjectAnalysisMode,
): Frame3DAnalysisKind {
  if (mode === "eersteOrde") return "linear";
  if ((model.volumes?.length ?? 0) > 0 && mode === "tweedeOrdeFysisch") {
    return model.volumeMaterialKinematics === "finiteStrain"
      && model.beams.some((beam) => !beam.axialOnly)
      && model.volumes!.every((volume) => volume.materialLaw?.kind === "steelJ2")
      ? "combined" : "material";
  }
  if ((model.volumes?.length ?? 0) > 0 && mode === "axiaalFysischRust"
      && model.beams.some((beam) => !beam.axialOnly)) return "combined";
  const frameOnly = model.beams.length > 0 && (model.plates?.length ?? 0) === 0
    && (model.volumes?.length ?? 0) === 0;
  if (frameOnly && (mode === "tweedeOrdeFysisch" || mode === "axiaalFysischRust")) return "combined";
  if (mode === "tweedeOrdeFysisch") return "material";
  return "p-delta";
}

export interface Frame3DDisplacement {
  nodeId: number;
  ux: number; uy: number; uz: number;
  rx: number; ry: number; rz: number;
}

export interface Frame3DReaction {
  nodeId: number;
  fx: number; fy: number; fz: number;
  mx: number; my: number; mz: number;
}

export interface Frame3DPlateBendingResult {
  plateId: number;
  /** Orthogonale lokale plaatassen, uitgedrukt in globale XYZ. */
  basis: { ex: [number, number, number]; ey: [number, number, number]; normal: [number, number, number] };
  quads: Array<{ id: number; nodeIds: [number, number, number, number] }>;
  /** Rotaties om de lokale ex/ey-assen met het fysieke 3D-teken. */
  nodes: Array<{ meshNodeId: number; x: number; y: number; z: number;
    wM: number; thetaXRad: number; thetaYRad: number }>;
  /** Alle globale reacties op vastgezette hoek- en randroosterknopen. */
  reactions: Array<{ meshNodeId: number; x: number; y: number; z: number;
    fx: number; fy: number; fz: number; mx: number; my: number; mz: number }>;
  elements: Array<{ quadId: number; momentKnmPerM: [number, number, number];
    shearKnPerM: [number, number]; effectiveEMpa: number; maxFibreStrain: number; maxCombinedStrain?: number;
    maxEquivalentPlasticStrain?: number; maxTensileDamage?: number;
    materialPoints?: Array<{ gaussIndex: [number, number]; positionM: [number, number];
      membraneStrain: [number, number, number]; equivalentPlasticStrain: number; tensileDamage: number }>;
    resultantSamples: Array<{ positionM: [number, number];
      momentKnmPerM: [number, number, number]; shearKnPerM: [number, number] }>;
    reinforcement?: NativePlateReinforcementEnvelope;
    threeLayer?: {
      checkedPoints: number;
      status: "partial_check_passes" | "partial_check_exceeded";
      governingPositionM: [number, number];
      top: { utilizationAsX: number; utilizationAsY: number; utilizationCompression: number; reinforcementCase: string };
      bottom: { utilizationAsX: number; utilizationAsY: number; utilizationCompression: number; reinforcementCase: string };
      core: { utilizationShear: number | null; utilizationDiagonal: number | null };
      notAssessed: string[];
    } }>;
}

export interface Frame3DMemberForces {
  memberId: number;
  lengthM: number;
  effectiveEMpa?: number;
  axialHistory?: { plasticStrain: number; equivalentPlasticStrain: number; tensileDamage: number; tangentEMpa: number };
  sectionHistory?: { maximumAbsPlasticStrain: number; maximumEquivalentPlasticStrain: number; maximumTensileDamage: number };
  nStartKn: number; nEndKn: number;
  vyStartKn: number; vyEndKn: number;
  vzStartKn: number; vzEndKn: number;
  torsionStartKnm: number; torsionEndKnm: number;
  myStartKnm: number; myEndKnm: number;
  mzStartKnm: number; mzEndKnm: number;
}

export interface Frame3DDiagramPoint {
  /** Relatieve positie langs de staaf: 0 = begin, 1 = einde. */
  t: number;
  value: number;
}

export interface Frame3DMemberDiagram {
  memberId: number;
  points: Frame3DDiagramPoint[];
  maxValue: number;
  minValue: number;
  maxAbsValue: number;
}

export interface Frame3DDiagrams {
  momentY: Frame3DMemberDiagram[];
  momentZ: Frame3DMemberDiagram[];
  shearY: Frame3DMemberDiagram[];
  shearZ: Frame3DMemberDiagram[];
  axial: Frame3DMemberDiagram[];
  torsion: Frame3DMemberDiagram[];
}

export interface Frame3DBucklingMember {
  memberId: number;
  axialForceKn: number;
  criticalForceKn: number;
  effectiveLengthFactor: number;
  effectiveLengthM: number;
  lengthM: number;
  slendernessY: number;
  slendernessZ: number;
}

export type Frame3DBuckling =
  | { status: "available"; modes: { mode: number; loadFactor: number }[]; members: Frame3DBucklingMember[] }
  | { status: "notApplicable" | "failed"; reason: string };

export interface Frame3DSolveResult {
  schemaVersion: 1;
  engine: { id: string; name: string; revision: string; license: string };
  analysis: Frame3DAnalysisKind;
  displacements: Frame3DDisplacement[];
  reactions: Frame3DReaction[];
  memberForces: Frame3DMemberForces[];
  plateBending?: Frame3DPlateBendingResult;
  /** Lineair, klein-vervormd volume op gedeelde knopen met eventuele 3D-staven. */
  volume3D?: {
    elements: Array<{
      elementId: number;
      kind: "tet4" | "hex8";
      stressMpa: [number, number, number, number, number, number];
      gaussStressMpa?: Array<[number, number, number, number, number, number]>;
      gaussEquivalentPlasticStrain?: number[];
      vonMisesMpa: number;
      greenStrain?: [[number, number, number], [number, number, number], [number, number, number]];
      firstPiolaMpa?: [[number, number, number], [number, number, number], [number, number, number]];
      effectiveEMpa?: number;
      equivalentPlasticStrain?: number;
      tensileDamage?: number;
    }>;
    membranes?: Array<{ plateId: number; stressMpa: [number, number, number];
      resultantsKnPerM: [number, number, number];
      stressMeasure?: "secondPiolaKirchhoff" | "cauchy";
      equivalentPlasticStrain?: number;
      thicknessStretch?: number }>;
    /** Coupled DKT bending-only plates. Centroid moments use elastic reference DKT stiffness. */
    bendingPlates?: Array<{ plateId: number; triangleCount: number;
      maxAbsWm: number; maxAbsRotationRad: number;
      maxAbsMomentKnmPerM?: [number, number, number];
      centroidMoments?: Array<{ triangleIndex: number; nodeIds: [number, number, number];
        momentKnmPerM: [number, number, number] }> }>;
    backendUsed: string;
    linearIterations: number;
    relativeResidual: number;
    formulation?: "linear" | "totalLagrangian" | "smallStrainMaterial" | "totalLagrangianJ2";
    newtonIterations?: number;
    acceptedSteps?: number;
    cutbacks?: number;
  };
  materialIterations?: number;
  materialLoadPath?: number[];
  /** Sinds contract 1.1: door de solver bemonsterde snedekrachtlijnen. */
  diagrams?: Frame3DDiagrams;
  secondOrder?: { iterations: number; converged: boolean; stable: boolean; maxAmplification: number };
  buckling: Frame3DBuckling;
  equilibrium?: { relativeResidual: number; residualOk: boolean; maxImbalanceKn: number; equilibriumOk: boolean };
  /** Onafhankelijke globale kracht- en momentensom, inclusief hefboomarmen om de oorsprong. */
  forceBalance?: {
    imbalanceKn: [number, number, number]; maxImbalanceKn: number; toleranceKn: number;
    momentImbalanceKnm: [number, number, number]; maxMomentImbalanceKnm: number; momentToleranceKnm: number;
    ok: boolean;
  };
  solverPath?: string;
  diagnostics: string[];
}

/** Controleer de globale statica ook wanneer de P-Delta-kern geen eigen evenwichtsobject levert. */
export function frame3DGlobalForceBalance(
  input: Omit<ReturnType<typeof buildFrame3DSolveRequest>, "bucklingModes">,
  result: Pick<Frame3DSolveResult, "reactions"> & Partial<Pick<Frame3DSolveResult, "displacements">>,
): NonNullable<Frame3DSolveResult["forceBalance"]> {
  type Vector3 = [number, number, number];
  const applied: [number, number, number] = [0, 0, 0];
  const appliedMoment: [number, number, number] = [0, 0, 0];
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const displacementById = new Map((result.displacements ?? []).map((node) => [node.nodeId, node]));
  const useDeformedGeometry = input.analysis === "p-delta" || input.analysis === "combined";
  const nodePosition = (node: { id: number; x: number; y: number; z: number }): Vector3 => {
    const displacement = useDeformedGeometry ? displacementById.get(node.id) : undefined;
    return [node.x + (displacement?.ux ?? 0), node.y + (displacement?.uy ?? 0), node.z + (displacement?.uz ?? 0)];
  };
  const memberById = new Map(input.members.map((member) => [member.id, member]));
  const cross = (a: Vector3, b: Vector3): Vector3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const add = (target: Vector3, value: Vector3) => {
    for (let axis = 0; axis < 3; axis++) target[axis] += value[axis];
  };
  const addForceAt = (force: Vector3, position: Vector3, couple: Vector3 = [0, 0, 0]) => {
    add(applied, force);
    add(appliedMoment, cross(position, force));
    add(appliedMoment, couple);
  };
  const memberGeometry = (memberId: number) => {
    const member = memberById.get(memberId);
    const start = member && nodeById.get(member.startNodeId);
    const end = member && nodeById.get(member.endNodeId);
    if (!start || !end) throw new Error(`Staaf ${memberId} ontbreekt bij de onafhankelijke krachtensom.`);
    return { start, end, ...frame3DMemberAxes(start, end, member?.rollAngleRad ?? 0) };
  };
  const localVector = (ey: readonly number[], ez: readonly number[], fy: number, fz: number): Vector3 => [
    fy * ey[0] + fz * ez[0], fy * ey[1] + fz * ez[1], fy * ey[2] + fz * ez[2],
  ];
  const memberPoint = (
    start: { id: number; x: number; y: number; z: number },
    end: { id: number; x: number; y: number; z: number },
    ex: readonly number[],
    distance: number,
  ): Vector3 => {
    const p0 = nodePosition(start), p1 = nodePosition(end);
    const currentAxis = useDeformedGeometry
      ? [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]
      : [...ex];
    const currentLength = Math.hypot(...currentAxis);
    return [p0[0] + distance * currentAxis[0] / currentLength,
      p0[1] + distance * currentAxis[1] / currentLength,
      p0[2] + distance * currentAxis[2] / currentLength];
  };
  const addLocalMemberForce = (memberId: number, fy: number, fz: number, positionM: number) => {
    const { start, end, ex, ey, ez } = memberGeometry(memberId);
    addForceAt(localVector(ey, ez, fy, fz), memberPoint(start, end, ex, positionM));
  };
  for (const load of input.nodalLoads) {
    const node = nodeById.get(load.nodeId);
    if (!node) throw new Error(`Knoop ${load.nodeId} ontbreekt bij de onafhankelijke krachtensom.`);
    addForceAt([load.fx, load.fy, load.fz], nodePosition(node), [load.mx, load.my, load.mz]);
  }
  for (const load of input.memberLoads) {
    const { start, end, ex, ey, ez } = memberGeometry(load.memberId);
    const length = load.endPositionM - load.startPositionM;
    const fy = (load.qyStartKnPerM + load.qyEndKnPerM) * length / 2;
    const fz = (load.qzStartKnPerM + load.qzEndKnPerM) * length / 2;
    const force = localVector(ey, ez, fy, fz);
    add(applied, force);
    const startPosition = nodePosition(start);
    add(appliedMoment, cross(startPosition, force));
    // ∫s·q(s)ds over a linearly varying load; a is measured from the member start.
    const sy = load.startPositionM * fy
      + length ** 2 * (load.qyStartKnPerM / 6 + load.qyEndKnPerM / 3);
    const sz = load.startPositionM * fz
      + length ** 2 * (load.qzStartKnPerM / 6 + load.qzEndKnPerM / 3);
    const endPosition = nodePosition(end);
    const currentAxis: Vector3 = useDeformedGeometry
      ? [endPosition[0] - startPosition[0], endPosition[1] - startPosition[1], endPosition[2] - startPosition[2]]
      : [...ex] as Vector3;
    const currentLength = Math.hypot(...currentAxis);
    add(appliedMoment, cross([
      currentAxis[0] / currentLength,
      currentAxis[1] / currentLength,
      currentAxis[2] / currentLength,
    ], localVector(ey, ez, sy, sz)));
  }
  for (const load of input.memberPointLoads) addLocalMemberForce(load.memberId, load.pyKn, load.pzKn, load.positionM);
  const finalFactor = input.loadPath ? input.loadPath[input.loadPath.length - 1] : 1;
  for (let axis = 0; axis < 3; axis++) {
    applied[axis] *= finalFactor;
    appliedMoment[axis] *= finalFactor;
  }
  const imbalanceKn: [number, number, number] = [...applied];
  const momentImbalanceKnm: [number, number, number] = [...appliedMoment];
  for (const reaction of result.reactions) {
    const node = nodeById.get(reaction.nodeId);
    if (!node) throw new Error(`Reactieknoop ${reaction.nodeId} ontbreekt bij de onafhankelijke momentensom.`);
    imbalanceKn[0] += reaction.fx;
    imbalanceKn[1] += reaction.fy;
    imbalanceKn[2] += reaction.fz;
    add(momentImbalanceKnm, cross(nodePosition(node), [reaction.fx, reaction.fy, reaction.fz]));
    add(momentImbalanceKnm, [reaction.mx, reaction.my, reaction.mz]);
  }
  const maxImbalanceKn = Math.max(...imbalanceKn.map(Math.abs));
  const maxMomentImbalanceKnm = Math.max(...momentImbalanceKnm.map(Math.abs));
  const scaleKn = Math.max(1, ...applied.map(Math.abs));
  const scaleKnm = Math.max(1, ...appliedMoment.map(Math.abs));
  const toleranceKn = 1e-5 * scaleKn;
  // P-Delta equilibrium is assembled in the displaced configuration. The
  // independent statics check reconstructs nodal/member load arms from the
  // deformed node line, so allow a small additional tolerance for this
  // first-order geometric reconstruction.
  const momentToleranceKnm = (useDeformedGeometry ? 1e-4 : 1e-5) * scaleKnm;
  return {
    imbalanceKn, maxImbalanceKn, toleranceKn,
    momentImbalanceKnm, maxMomentImbalanceKnm, momentToleranceKnm,
    ok: Number.isFinite(maxImbalanceKn) && Number.isFinite(maxMomentImbalanceKnm)
      && maxImbalanceKn <= toleranceKn && maxMomentImbalanceKnm <= momentToleranceKnm,
  };
}

/**
 * Welke 3D-belastingen één solveraanroep vormen. Een getal rekent één
 * belastinggeval; een Map rekent een volledige combinatie. De factoren
 * worden vóór de Rust-grens op iedere kracht, elk moment en elke
 * staafbelasting toegepast. Daardoor doorloopt ook een combinatie als één
 * geheel de P-Delta-iteraties en wordt zij niet achteraf lineair opgeteld.
 */
export type Frame3DLoadSelection = number | ReadonlyMap<number, number>;

function factorForLoad(selection: Frame3DLoadSelection | undefined, caseId: number): number {
  if (selection === undefined) return 1;
  if (typeof selection === "number") return caseId === selection ? 1 : 0;
  const factor = selection.get(caseId) ?? 0;
  if (!Number.isFinite(factor)) throw new Error(`Belastinggeval ${caseId} heeft een ongeldige combinatiefactor.`);
  return factor;
}

function profileKey(value: string): string {
  return value.toUpperCase().split("").filter((character) => ![" ", "-", "."].includes(character)).join("");
}

function rectangleTorsionConstant(bMm: number, hMm: number): number {
  const long = Math.max(bMm, hMm);
  const short = Math.min(bMm, hMm);
  return long * short ** 3 * (1 / 3 - 0.21 * (short / long) * (1 - short ** 4 / (12 * long ** 4)));
}

function poisson(material: string): number {
  // ν is retained for the request schema; timber torsion uses explicit Gmean.
  if (material in TIMBER_G_MEAN) return NU_STAAL;
  if (material in CONCRETE_E_CM) return NU_BETON;
  if (STEEL_GRADES.includes(material.toUpperCase())) return NU_STAAL;
  if (/^(EN\s*AW|ALUMINIUM|ALUMINUM|VRIJ:)/i.test(material)) return NU_STAAL;
  throw new Error(
    `Materiaal "${material}" heeft in 3D nog geen betrouwbare torsiestijfheid. ` +
    "Gebruik staal, beton, aluminium, een bekende houtklasse of een vrij isotroop materiaal.",
  );
}

/**
 * Resolve every member before the Rust call. A/Iy still come from the same
 * resolver as 2D; Iz/J come from the steel catalogue or exact rectangle
 * geometry. An incomplete 3D section is rejected rather than supplemented
 * with hidden defaults.
 */
export function buildFrame3DSolveRequest(
  model: Frame3DModel,
  analysis: Frame3DAnalysisKind = "p-delta",
  loadSelection?: Frame3DLoadSelection,
  allowMixedMembranes = false,
) {
  if (model.materialLoadPath !== undefined && (!Array.isArray(model.materialLoadPath)
      || model.materialLoadPath.length === 0 || model.materialLoadPath.length > 100
      || model.materialLoadPath.some((factor) => !Number.isFinite(factor)))) {
    throw new Error("Het FNL-lastpad moet 1–100 eindige lastfactoren bevatten.");
  }
  if (!allowMixedMembranes && ((model.plates?.length ?? 0) > 0 || (model.surfaceLoads?.length ?? 0) > 0)) {
    throw new Error(
      "De raamwerkkern rekent 3D-platen en oppervlaktebelastingen niet mee. " +
      "Gebruik de losse lineaire Rust-plaatroute voor een ondersteunde rechthoek; " +
      "gekoppelde staaf-plaatmodellen zijn geblokkeerd om genegeerde plaatlasten te voorkomen.",
    );
  }
  if (model.nodes.length < 2 || model.beams.length === 0) {
    throw new Error("Voeg minstens twee knopen en één staaf toe voordat je rekent.");
  }
  if ((model.supports ?? []).length === 0) throw new Error("Voeg minstens één 3D-oplegging toe.");
  const nodalLoads = (model.loads ?? []).flatMap((load) => {
    const factor = factorForLoad(loadSelection, frame3DLoadCaseId(load));
    if (factor === 0) return [];
    return [{
      ...load,
      fx: load.fx * factor, fy: load.fy * factor, fz: load.fz * factor,
      mx: load.mx * factor, my: load.my * factor, mz: load.mz * factor,
    }];
  });
  const memberLoads = (model.memberLoads ?? []).flatMap((load) => {
    const factor = factorForLoad(loadSelection, frame3DLoadCaseId(load));
    if (factor === 0) return [];
    return [{
      ...load,
      qyStart: load.qyStart * factor, qyEnd: load.qyEnd * factor,
      qzStart: load.qzStart * factor, qzEnd: load.qzEnd * factor,
    }];
  });
  const memberPointLoads = (model.memberPointLoads ?? []).flatMap((load) => {
    const factor = factorForLoad(loadSelection, frame3DLoadCaseId(load));
    if (factor === 0) return [];
    return [{ ...load, py: load.py * factor, pz: load.pz * factor }];
  });
  const thermalLoads = (model.thermalLoads ?? []).flatMap((load) => {
    const factor = factorForLoad(loadSelection, frame3DLoadCaseId(load));
    if (factor === 0) return [];
    return [{
      ...load,
      deltaTUniformK: load.deltaTUniformK * factor,
      deltaTGradientYK: load.deltaTGradientYK * factor,
      deltaTGradientZK: load.deltaTGradientZK * factor,
    }];
  });
  const hasPrescribedDisplacement = (model.supports ?? []).some((support) =>
    Object.keys(support.prescribed ?? {}).length > 0);
  const hasVolumeLoad = (model.volumes?.length ?? 0) > 0 &&
    [...(model.volumeBodyLoads ?? []), ...(model.volumeFaceLoads ?? [])].some((load) =>
      factorForLoad(loadSelection, frame3DLoadCaseId(load)) !== 0);
  const hasMembraneLoad = allowMixedMembranes && (model.surfaceLoads ?? []).some((load) =>
    factorForLoad(loadSelection, frame3DLoadCaseId(load)) !== 0);
  if (nodalLoads.length === 0 && memberLoads.length === 0 && memberPointLoads.length === 0
      && thermalLoads.length === 0 && !hasPrescribedDisplacement && !hasVolumeLoad && !hasMembraneLoad) {
    throw new Error(loadSelection === undefined
      ? "Voeg minstens één 3D-belasting of opgelegde verplaatsing toe."
      : typeof loadSelection === "number"
        ? `Belastinggeval ${loadSelection} bevat geen 3D-belastingen.`
        : "De geselecteerde combinatie bevat geen 3D-belastingen met een niet-nulfactor.");
  }

  type NativeLaw = { kind: "steelBilinear"; yield_mpa: number; hardening_ratio: number }
    | { kind: "concreteCracking"; tensile_mpa: number; residual_ratio: number };
  const materials: { id: number; name: string; eMpa: number; nu: number; gMpa?: number; alphaPerK: number; law?: NativeLaw }[] = [];
  const sections: { id: number; name: string; areaM2: number; iyM4: number; izM4: number; torsionJM4: number }[] = [];
  const materialIds = new Map<string, number>();
  const sectionIds = new Map<string, number>();

  if (isMaterialNonlinear(analysis)) {
    if ((model.volumes?.length ?? 0) === 0 && !model.beams.some((beam) => beam.nonlinearLaw)) {
      throw new Error("Stel bij minstens één 3D-staaf een expliciete FNL-materiaalwet in.");
    }
  }
  const members = model.beams.map((beam) => {
    const material = beam.material?.trim();
    const profile = beam.profileName?.trim();
    if (!material || !profile) {
      throw new Error(`Staaf ${beam.id}: wijs eerst een materiaal en profiel toe.`);
    }
    const resolved = resolveSection(material, profile);
    if (resolved.bron === "default") throw new Error(`Staaf ${beam.id}: ${resolved.reden ?? "doorsnede onbekend"}.`);
    if (isMaterialNonlinear(analysis) && beam.nonlinearLaw) {
      if (beam.nonlinearLaw.kind === "steelBilinear" && material in CONCRETE_E_CM
          || beam.nonlinearLaw.kind === "concreteCracking" && STEEL_GRADES.includes(material.toUpperCase())) {
        throw new Error(`Staaf ${beam.id}: de FNL-materiaalwet past niet bij materiaal ${material}.`);
      }
    }

    const law: NativeLaw | undefined = !isMaterialNonlinear(analysis) || !beam.nonlinearLaw ? undefined
      : beam.nonlinearLaw.kind === "steelBilinear"
        ? { kind: "steelBilinear", yield_mpa: beam.nonlinearLaw.yieldMpa,
          hardening_ratio: beam.nonlinearLaw.hardeningRatio }
        : { kind: "concreteCracking", tensile_mpa: beam.nonlinearLaw.tensileMpa,
          residual_ratio: beam.nonlinearLaw.residualRatio };
    const materialKey = `${material}\u0000${JSON.stringify(law ?? null)}`;
    let materialId = materialIds.get(materialKey);
    if (!materialId) {
      materialId = materials.length + 1;
      materialIds.set(materialKey, materialId);
      materials.push({
        id: materialId, name: material, eMpa: resolved.E, nu: poisson(material),
        ...(material in TIMBER_G_MEAN ? { gMpa: TIMBER_G_MEAN[material] } : {}),
        alphaPerK: thermalAlphaForMaterial(material),
        ...(law ? { law } : {}),
      });
    }

    const sectionKey = `${material}\u0000${profile}`;
    let sectionId = sectionIds.get(sectionKey);
    if (!sectionId) {
      let izMm4: number;
      let torsionJMm4: number;
      const catalogue = STEEL_SECTION_DIMS[profileKey(profile)]?.props;
      const rectangle = parseRechthoek(profile);
      if (catalogue) {
        izMm4 = catalogue.iz;
        torsionJMm4 = catalogue.it;
      } else if (rectangle) {
        izMm4 = rectangle.h * rectangle.b ** 3 / 12;
        torsionJMm4 = rectangleTorsionConstant(rectangle.b, rectangle.h);
      } else {
        throw new Error(
          `Staaf ${beam.id}: profiel "${profile}" mist Iz en J voor een ruimtelijke berekening. ` +
          "Kies een catalogusprofiel of rechthoek b×h.",
        );
      }
      sectionId = sections.length + 1;
      sectionIds.set(sectionKey, sectionId);
      sections.push({
        id: sectionId,
        name: profile,
        areaM2: resolved.A * 1e-6,
        iyM4: resolved.I * 1e-12,
        izM4: izMm4 * 1e-12,
        torsionJM4: torsionJMm4 * 1e-12,
      });
    }
    return {
      id: beam.id,
      startNodeId: beam.startNodeId,
      endNodeId: beam.endNodeId,
      materialId,
      sectionId,
      releases: beam.releases ?? {},
      ...(beam.rollAngleRad !== undefined ? { rollAngleRad: beam.rollAngleRad } : {}),
    };
  });

  return {
    schemaVersion: 1,
    analysis,
    nodes: model.nodes,
    materials,
    sections,
    members,
    supports: (model.supports ?? []).map(({ springs, prescribed, ...support }) => ({
      ...support,
      ...(springs ?? {}),
      ...(prescribed?.uxM !== undefined ? { uxPrescribedM: prescribed.uxM } : {}),
      ...(prescribed?.uyM !== undefined ? { uyPrescribedM: prescribed.uyM } : {}),
      ...(prescribed?.uzM !== undefined ? { uzPrescribedM: prescribed.uzM } : {}),
      ...(prescribed?.rxRad !== undefined ? { rxPrescribedRad: prescribed.rxRad } : {}),
      ...(prescribed?.ryRad !== undefined ? { ryPrescribedRad: prescribed.ryRad } : {}),
      ...(prescribed?.rzRad !== undefined ? { rzPrescribedRad: prescribed.rzRad } : {}),
    })),
    nodalLoads: nodalLoads.map(({ caseId: _caseId, ...load }) => load),
    memberLoads: memberLoads.map((load) => ({
      id: load.id,
      memberId: load.beamId,
      qyStartKnPerM: load.qyStart,
      qyEndKnPerM: load.qyEnd,
      qzStartKnPerM: load.qzStart,
      qzEndKnPerM: load.qzEnd,
      startPositionM: load.startPositionM,
      endPositionM: load.endPositionM,
    })),
    memberPointLoads: memberPointLoads.map((load) => ({
      id: load.id,
      memberId: load.beamId,
      pyKn: load.py,
      pzKn: load.pz,
      positionM: load.positionM,
    })),
    thermalLoads: thermalLoads.map((load) => ({
      id: load.id,
      memberId: load.beamId,
      deltaTUniformK: load.deltaTUniformK,
      deltaTGradientYK: load.deltaTGradientYK,
      deltaTGradientZK: load.deltaTGradientZK,
    })),
    ...(analysis === "combined" ? { loadPath: model.materialLoadPath ?? [1] }
      : analysis === "material" && model.materialLoadPath ? { loadPath: model.materialLoadPath } : {}),
    maxIterations: 50,
    tolerance: 1e-8,
    bucklingModes: 3,
  } as const;
}

export async function solveFrame3D(
  model: Frame3DModel,
  activeLoadCaseId?: number,
  analysis: Frame3DAnalysisKind = "p-delta",
  engine: SolverEngineId = "dedaliano",
): Promise<Frame3DSolveResult> {
  if ((model.volumes?.length ?? 0) > 0) {
    if (engine !== "openaec-native-fem") throw new Error("3D-volume-elementen vereisen de Open FEM Rust-kern.");
    const frame = model.beams.length > 0 ? buildFrame3DSolveRequest(model, analysis, activeLoadCaseId, true) : undefined;
    const { solveFrame3DVolume } = await import("./frame3dVolumeSolver");
    return solveFrame3DVolume(model, activeLoadCaseId, frame, analysis);
  }
  if (model.beams.some((beam) => beam.axialOnly)) {
    if (engine !== "openaec-native-fem") throw new Error("Axiale 3D-staven vereisen de Open FEM Rust-kern.");
    if (analysis !== "linear") throw new Error("Axiale 3D-staven zonder volume ondersteunen voorlopig alleen lineaire analyse.");
    const frame = buildFrame3DSolveRequest(model, analysis, activeLoadCaseId, true);
    const { solveFrame3DVolume } = await import("./frame3dVolumeSolver");
    return solveFrame3DVolume(model, activeLoadCaseId, frame, analysis);
  }
  if ((model.plates?.length ?? 0) > 0) {
    if (analysis === "combined") {
      throw new Error("Gecombineerde axiale GNL/FNL is voorlopig alleen beschikbaar voor zuivere 3D-raamwerken.");
    }
    if (engine !== "openaec-native-fem") {
      throw new Error("3D-platen vereisen de Open FEM Rust-plaatroute.");
    }
    const { solveFrame3DPlate } = await import("./frame3dPlateSolver");
    return solveFrame3DPlate(model, activeLoadCaseId, analysis);
  }
  const request = buildFrame3DSolveRequest(model, analysis, activeLoadCaseId);
  const input = analysis === "p-delta" ? request : { ...request, bucklingModes: 0 };
  return callFrame3DSolver(input, engine);
}

/** Los één belastingcombinatie rechtstreeks als tweede-ordeprobleem op. */
export async function solveFrame3DCombination(
  model: Frame3DModel,
  factors: ReadonlyMap<number, number>,
  analysis: Frame3DAnalysisKind = "p-delta",
  engine: SolverEngineId = "dedaliano",
): Promise<Frame3DSolveResult> {
  if ((model.volumes?.length ?? 0) > 0) {
    if (engine !== "openaec-native-fem") throw new Error("3D-volume-elementen vereisen de Open FEM Rust-kern.");
    const frame = model.beams.length > 0 ? buildFrame3DSolveRequest(model, analysis, factors, true) : undefined;
    const { solveFrame3DVolume } = await import("./frame3dVolumeSolver");
    return solveFrame3DVolume(model, factors, frame, analysis);
  }
  if (model.beams.some((beam) => beam.axialOnly)) {
    if (engine !== "openaec-native-fem") throw new Error("Axiale 3D-staven vereisen de Open FEM Rust-kern.");
    if (analysis !== "linear") throw new Error("Axiale 3D-staven zonder volume ondersteunen voorlopig alleen lineaire analyse.");
    const frame = buildFrame3DSolveRequest(model, analysis, factors, true);
    const { solveFrame3DVolume } = await import("./frame3dVolumeSolver");
    return solveFrame3DVolume(model, factors, frame, analysis);
  }
  if ((model.plates?.length ?? 0) > 0) {
    if (analysis === "combined") {
      throw new Error("Gecombineerde axiale GNL/FNL is voorlopig alleen beschikbaar voor zuivere 3D-raamwerken.");
    }
    if (engine !== "openaec-native-fem") {
      throw new Error("3D-platen vereisen de Open FEM Rust-plaatroute.");
    }
    const { solveFrame3DPlate } = await import("./frame3dPlateSolver");
    return solveFrame3DPlate(model, factors, analysis);
  }
  const request = buildFrame3DSolveRequest(model, analysis, factors);
  const input = analysis === "p-delta" ? request : { ...request, bucklingModes: 0 };
  return callFrame3DSolver(input, engine);
}

type Frame3DSolveRequest = Omit<ReturnType<typeof buildFrame3DSolveRequest>, "bucklingModes"> & {
  readonly bucklingModes: number;
};

interface NativeFrame3DResult {
  nodes: Array<{ nodeId: number; displacement: number[]; reaction: number[] }>;
  members: Array<{ memberId: number; localEndForces: number[]; effectiveEMpa: number;
    axialHistory?: Frame3DMemberForces["axialHistory"];
    sectionHistory?: Frame3DMemberForces["sectionHistory"] }>;
  diagrams: Frame3DDiagrams;
  buckling: Frame3DBuckling;
  iterations: number;
  relativeChange: number;
  maxAmplification: number;
  equilibriumResidual: number;
}

/** Keep the native element's local nodal forces separate from the app's
 * internal-section sign convention. This mapping is checked against the
 * existing solver for axial force, both shears, torsion and both moments. */
function adaptNativeFrame3DResult(
  input: Frame3DSolveRequest,
  native: NativeFrame3DResult,
): Frame3DSolveResult {
  if (!native || typeof native !== "object" || !Array.isArray(native.nodes)
      || !Array.isArray(native.members) || native.nodes.length !== input.nodes.length
      || native.members.length !== input.members.length
      || native.nodes.some((node) => !node || typeof node !== "object")
      || native.members.some((member) => !member || typeof member !== "object")
      || !Number.isSafeInteger(native.iterations) || native.iterations < 1
      || !Number.isFinite(native.equilibriumResidual) || native.equilibriumResidual < 0 || native.equilibriumResidual > 1e-7
      || !Number.isFinite(native.relativeChange) || native.relativeChange < 0
      || !Number.isFinite(native.maxAmplification) || native.maxAmplification < 0
      || !native.diagrams || typeof native.diagrams !== "object") {
    throw new Error("De eigen Rust-raamwerkkern leverde geen volledig of evenwichtig resultaat.");
  }
  const exactIds = (actual: number[], expected: number[]) => {
    const actualSet = new Set(actual);
    return actualSet.size === actual.length && actual.length === expected.length
      && expected.every((id) => actualSet.has(id));
  };
  if (!exactIds(native.nodes.map((node) => node.nodeId), input.nodes.map((node) => node.id))) {
    throw new Error("De eigen Rust-raamwerkkern leverde geen één-op-één knoopresultaten.");
  }
  if (!exactIds(native.members.map((member) => member.memberId), input.members.map((member) => member.id))) {
    throw new Error("De eigen Rust-raamwerkkern leverde geen één-op-één staafresultaten.");
  }
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const memberById = new Map(input.members.map((member) => [member.id, member]));
  const displacements: Frame3DDisplacement[] = native.nodes.map((node) => {
    if (!nodeById.has(node.nodeId) || !Array.isArray(node.displacement) || node.displacement.length !== 6
        || node.displacement.some((value) => !Number.isFinite(value))) {
      throw new Error("De eigen Rust-raamwerkkern leverde een ongeldige knoopverplaatsing.");
    }
    const [ux, uy, uz, rx, ry, rz] = node.displacement;
    return { nodeId: node.nodeId, ux, uy, uz, rx, ry, rz };
  });
  const reactions: Frame3DReaction[] = native.nodes.map((node) => {
    if (!Array.isArray(node.reaction) || node.reaction.length !== 6
        || node.reaction.some((value) => !Number.isFinite(value))) {
      throw new Error("De eigen Rust-raamwerkkern leverde een ongeldige oplegreactie.");
    }
    const [fx, fy, fz, mx, my, mz] = node.reaction;
    return { nodeId: node.nodeId, fx, fy, fz, mx, my, mz };
  });
  const memberForces: Frame3DMemberForces[] = native.members.map((member) => {
    const source = memberById.get(member.memberId);
    const start = source && nodeById.get(source.startNodeId);
    const end = source && nodeById.get(source.endNodeId);
    if (!start || !end || !Number.isFinite(member.effectiveEMpa) || member.effectiveEMpa <= 0
        || !Array.isArray(member.localEndForces) || member.localEndForces.length !== 12
        || member.localEndForces.some((value) => !Number.isFinite(value))) {
      throw new Error("De eigen Rust-raamwerkkern leverde ongeldige staafeindkrachten.");
    }
    const history = member.axialHistory;
    const sectionHistory = member.sectionHistory;
    if (input.loadPath && !history && !sectionHistory) {
      throw new Error("De eigen Rust-raamwerkkern leverde geen materiaalgeschiedenis voor het lastpad.");
    }
    if (history && (!Number.isFinite(history.plasticStrain)
        || !Number.isFinite(history.equivalentPlasticStrain) || history.equivalentPlasticStrain < 0
        || !Number.isFinite(history.tensileDamage) || history.tensileDamage < 0 || history.tensileDamage > 1
        || !Number.isFinite(history.tangentEMpa) || history.tangentEMpa < 0)) {
      throw new Error("De eigen Rust-raamwerkkern leverde een ongeldige axiale materiaaltoestand.");
    }
    if (sectionHistory && (!Number.isFinite(sectionHistory.maximumAbsPlasticStrain)
        || sectionHistory.maximumAbsPlasticStrain < 0
        || !Number.isFinite(sectionHistory.maximumEquivalentPlasticStrain)
        || sectionHistory.maximumEquivalentPlasticStrain < 0
        || !Number.isFinite(sectionHistory.maximumTensileDamage)
        || sectionHistory.maximumTensileDamage < 0 || sectionHistory.maximumTensileDamage > 1)) {
      throw new Error("De eigen Rust-raamwerkkern leverde een ongeldige doorsnedegeschiedenis.");
    }
    const f = member.localEndForces;
    return {
      memberId: member.memberId,
      lengthM: Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z),
      effectiveEMpa: member.effectiveEMpa,
      ...(history ? { axialHistory: history } : {}),
      ...(sectionHistory ? { sectionHistory } : {}),
      nStartKn: -f[0], vyStartKn: f[1], vzStartKn: f[2],
      torsionStartKnm: f[3], myStartKnm: f[4], mzStartKnm: f[5],
      nEndKn: f[6], vyEndKn: -f[7], vzEndKn: -f[8],
      torsionEndKnm: -f[9], myEndKnm: -f[10], mzEndKnm: -f[11],
    };
  });
  const diagrams = native.diagrams;
  const stationTolerance = 1e-12;
  for (const key of ["momentY", "momentZ", "shearY", "shearZ", "axial", "torsion"] as const) {
    const curves = diagrams?.[key];
    if (!Array.isArray(curves) || curves.length !== memberForces.length
        || curves.some((curve) => !curve || typeof curve !== "object") ||
        !exactIds(curves.map((curve) => curve.memberId), memberForces.map((member) => member.memberId)) ||
        curves.some((curve) => !memberById.has(curve.memberId) || !Array.isArray(curve.points)
          || curve.points.length < 2 || curve.points.some((point) => !point || typeof point !== "object")
          || curve.points.some((point, index) =>
            !Number.isFinite(point.t) || point.t < 0 || point.t > 1 || !Number.isFinite(point.value)
            || (index > 0 && point.t < curve.points[index - 1].t - stationTolerance))
          || Math.abs(curve.points[0].t) > stationTolerance
          || Math.abs(curve.points[curve.points.length - 1].t - 1) > stationTolerance ||
          !Number.isFinite(curve.maxValue) || !Number.isFinite(curve.minValue) || !Number.isFinite(curve.maxAbsValue))) {
      throw new Error("De eigen Rust-raamwerkkern leverde ongeldige snedekrachtlijnen.");
    }
  }
  const balance = frame3DGlobalForceBalance(input, { reactions, displacements });
  const residualOk = native.equilibriumResidual <= 1e-8;
  const implicitThermalHistory = isMaterialNonlinear(input.analysis) && input.thermalLoads.length > 0
    && !input.loadPath;
  const buckling = native.buckling;
  if (!buckling || !["available", "notApplicable", "failed"].includes(buckling.status)
      || (buckling.status === "available" && (
        !Array.isArray(buckling.modes) || buckling.modes.length === 0
        || buckling.modes.some((mode) => !mode || typeof mode !== "object"
          || !Number.isFinite(mode.loadFactor) || mode.loadFactor <= 0)
        || !Array.isArray(buckling.members) || buckling.members.length !== memberForces.length
        || buckling.members.some((member) => !member || typeof member !== "object"
          || !memberById.has(member.memberId)
          || !Number.isFinite(member.criticalForceKn) || !Number.isFinite(member.effectiveLengthM))
        || !exactIds(buckling.members.map((member) => member.memberId), memberForces.map((member) => member.memberId))))) {
    throw new Error("De eigen Rust-raamwerkkern leverde een ongeldige eigenknikuitkomst.");
  }
  return {
    schemaVersion: 1,
    engine: { id: "openaec-native-fem", name: "Open FEM Rust", revision: "0.1.0", license: "AGPL-3.0-or-later" },
    analysis: input.analysis,
    displacements, reactions, memberForces, diagrams,
    ...(input.loadPath ? { materialLoadPath: [...input.loadPath] }
      : implicitThermalHistory ? { materialLoadPath: [1] } : {}),
    ...(input.analysis !== "linear" ? { secondOrder: {
      iterations: native.iterations, converged: true, stable: true,
      maxAmplification: native.maxAmplification,
    } } : {}),
    buckling,
    equilibrium: { relativeResidual: native.equilibriumResidual,
      residualOk, maxImbalanceKn: balance.maxImbalanceKn,
      equilibriumOk: residualOk && balance.ok },
    solverPath: "native-rust",
    diagnostics: [
      "Eigen Rust-raamwerkkern: 3D-raamwerk.",
      ...(isMaterialNonlinear(input.analysis)
        ? input.loadPath || implicitThermalHistory
          ? ["FNL-lastpad bewaart axiale plastische rek en betonschade per staaf; uniforme temperatuur werkt via mechanische rek. Buiging gebruikt nog een secant-E zonder doorsnedegeschiedenis."]
          : ["FNL gebruikt een monotone secant-E per staaf; plastische en scheurgeschiedenis ontbreken nog."] : []),
      ...(buckling.status === "failed" ? [`Eigenknik: ${buckling.reason}`] : []),
      ...(input.analysis !== "linear" && !balance.ok
        ? ["De onafhankelijke momentensom gebruikt verplaatste knoopposities en rechte koordes; bij P-Δ kan een kleine momentrest overblijven."]
        : []),
    ],
  };
}

async function callFrame3DSolver(input: Frame3DSolveRequest, engine: SolverEngineId): Promise<Frame3DSolveResult> {
  if (engine !== "openaec-native-fem" && input.materials.some((material) => material.gMpa !== undefined)) {
    throw new Error("Houten 3D-staven vereisen Open FEM Rust voor de afzonderlijke afschuifmodulus Gmean.");
  }
  const checked = (result: Frame3DSolveResult): Frame3DSolveResult => ({
    ...result,
    forceBalance: frame3DGlobalForceBalance(input, result),
  });
  if (engine === "openaec-native-fem") {
    let native: NativeFrame3DResult;
    let recoveredWithFrontal = false;
    // The assembled matrix is capped at 20,000 DOFs. A linear narrow-front
    // frame can be solved elementwise above that cap.
    const directFrontalForSize = input.analysis === "linear" && input.nodes.length * 6 > 20_000;
    try {
      native = await solveNativeFem<NativeFrame3DResult>("frame3d", directFrontalForSize
        ? { ...input, linearBackend: "frontalWave", frontalMaxFrontDofs: 256 }
        : input);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const iterativeFailure = /sparse solver did not converge within|sparse solve lost residual accuracy/.test(reason);
      if (directFrontalForSize || input.analysis !== "linear" || input.members.length > 2500
          || !iterativeFailure) throw error;
      try {
        native = await solveNativeFem<NativeFrame3DResult>("frame3d", {
          ...input, linearBackend: "frontalWave", frontalMaxFrontDofs: 256,
        });
        recoveredWithFrontal = true;
      } catch (frontalError) {
        const secondReason = frontalError instanceof Error ? frontalError.message : String(frontalError);
        throw new Error(`3D-raamwerk: de iteratieve en frontale oplossers faalden: ${reason}; ${secondReason}`);
      }
    }
    const result = checked(adaptNativeFrame3DResult(input, native));
    return (recoveredWithFrontal || directFrontalForSize) ? {
      ...result, solverPath: "native-rust-frame3d-frontal-wave",
      diagnostics: [...result.diagnostics,
        directFrontalForSize
          ? "Het grote lineaire raamwerk is direct met de frontale methode opgelost."
          : "De iteratieve raamwerkoplosser convergeerde niet; de frontale methode loste het lineaire model op."],
    } : result;
  }
  if (isMaterialNonlinear(input.analysis)) {
    throw new Error("Fysisch niet-lineaire 3D-analyse is alleen beschikbaar met Open FEM Rust (experimenteel).");
  }
  const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
  const usesLegacyCompatibleLoads = input.memberLoads.length === 0
    && input.memberPointLoads.length === 0
    && input.thermalLoads.length === 0;
  const isLegacyMaterialContract = (error: unknown) => usesLegacyCompatibleLoads
    && errorText(error).includes("unknown field `alphaPerK`");
  const legacyInput = () => {
    const {
      memberLoads: _memberLoads,
      memberPointLoads: _memberPointLoads,
      thermalLoads: _thermalLoads,
      ...legacy
    } = input;
    return {
      ...legacy,
      materials: input.materials.map(({ alphaPerK: _alphaPerK, ...material }) => material),
    };
  };
  if (isTauriApp()) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      return checked(await invoke<Frame3DSolveResult>("solve_frame3d", { input }));
    } catch (error) {
      if (!isLegacyMaterialContract(error)) throw error;
      return checked(await invoke<Frame3DSolveResult>("solve_frame3d", { input: legacyInput() }));
    }
  }
  const post = async (request: typeof input | ReturnType<typeof legacyInput>) => {
    const response = await fetch("/api/frame3d/solve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const data = await response.json().catch(() => ({})) as Frame3DSolveResult & { fout?: string };
    if (!response.ok || data.fout) throw new Error(data.fout || `3D-rekenkern gaf HTTP ${response.status}`);
    return checked(data);
  };
  try {
    return await post(input);
  } catch (error) {
    if (!isLegacyMaterialContract(error)) throw error;
    return post(legacyInput());
  }
}

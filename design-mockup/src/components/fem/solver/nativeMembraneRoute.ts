import { buildMesh } from "./engine";
import type { LoadCombination } from "./combinations";
import type { MultiInput, PlateElementStress, PlateResult, SolverResult } from "./types";
import { solveNativeQuad2D, solveNativeTriangle2D,
  type NativeQuad2DResult, type NativeTriangle2DResult } from "../../../lib/nativeFemClient";
import type { NativeMaterialLaw, NativeModulusCurve, NativePlateAnalysis } from "../../../core/fem/nativePlate2DAdapter";
import { plaatMateriaalSoort } from "../../../lib/plaatMateriaal";

type NativeElementStress = {
  elementId: number;
  stressMpa: [number, number, number];
  effectiveEMpa: number;
  maxEquivalentStrain: number;
  equivalentPlasticStrain: number;
  tensileDamage: number;
};

/** Translate either Rust membrane element to the same units and IDs as the 2D UI. */
function nativeMembraneResultToSolverResult(
  built: ReturnType<typeof buildMesh>,
  result: { nodes: NativeQuad2DResult["nodes"] },
  elementResults: readonly NativeElementStress[],
  supports: MultiInput["supports"],
): SolverResult {
  const nodes = new Map(result.nodes.map(node => [node.nodeId, node]));
  const stresses = new Map(elementResults.map(element => [element.elementId, element]));
  const displacements = new Map<number, { ux: number; uz: number; ry: number }>();
  const reactions = new Map<number, { fx: number; fz: number; my: number }>();
  let maxDisplacement = 0;
  for (const node of result.nodes) {
    maxDisplacement = Math.max(maxDisplacement, Math.hypot(node.uxM, node.uyM) * 1000);
  }
  for (const [uiId, meshId] of built.nodeIdMap) {
    const node = nodes.get(meshId);
    if (!node) continue;
    displacements.set(uiId, { ux: node.uxM * 1000, uz: node.uyM * 1000, ry: 0 });
    if (supports.some(support => support.nodeId === uiId)) {
      reactions.set(uiId, { fx: node.rxKn * 1000, fz: node.ryKn * 1000, my: 0 });
    }
  }
  const plateElements: PlateResult[] = built.plateInfo.map(info => {
    const elements: PlateElementStress[] = info.region.elementIds.map(elementId => {
      const stressResult = stresses.get(elementId);
      const element = built.mesh.getElement(elementId);
      if (!stressResult || !element) throw new Error(`Plaat ${info.plateId}: geen Rust-spanning voor element ${elementId}.`);
      const [sigmaX, sigmaY, tauXY] = stressResult.stressMpa;
      const mean = (sigmaX + sigmaY) / 2;
      const radius = Math.hypot((sigmaX - sigmaY) / 2, tauXY);
      const thicknessM: number = element.thickness;
      return {
        elementId,
        corners: element.nodeIds.map((nodeId: number) => {
          const node = built.mesh.getNode(nodeId);
          if (!node) throw new Error(`Plaat ${info.plateId}: ontbrekende meshknoop ${nodeId}.`);
          return { x: node.x * 1000, z: node.y * 1000 };
        }),
        sigmaX, sigmaY, tauXY,
        vonMises: Math.sqrt(Math.max(0, sigmaX ** 2 - sigmaX * sigmaY + sigmaY ** 2 + 3 * tauXY ** 2)),
        sigma1: mean + radius, sigma2: mean - radius,
        angle: Math.atan2(2 * tauXY, sigmaX - sigmaY) / 2,
        nx: sigmaX * thicknessM * 1000,
        ny: sigmaY * thicknessM * 1000,
        nxy: tauXY * thicknessM * 1000,
        effectiveEMpa: stressResult.effectiveEMpa,
        maxEquivalentStrain: stressResult.maxEquivalentStrain,
        equivalentPlasticStrain: stressResult.equivalentPlasticStrain,
        tensileDamage: stressResult.tensileDamage,
      };
    });
    const range = (key: "sigmaX" | "sigmaY" | "tauXY" | "vonMises" | "nx" | "ny" | "nxy") => ({
      min: elements.length ? Math.min(...elements.map(element => element[key])) : 0,
      max: elements.length ? Math.max(...elements.map(element => element[key])) : 0,
    });
    return {
      plateId: info.plateId,
      expectedElementIds: [...info.region.elementIds],
      elements,
      ranges: {
        sigmaX: range("sigmaX"), sigmaY: range("sigmaY"), tauXY: range("tauXY"),
        vonMises: range("vonMises"), nx: range("nx"), ny: range("ny"), nxy: range("nxy"),
      },
    };
  });
  return { displacements, reactions, elements: new Map(), maxDisplacement, plateElements };
}

export function nativeQuadResultToSolverResult(
  built: ReturnType<typeof buildMesh>, result: NativeQuad2DResult, supports: MultiInput["supports"],
): SolverResult {
  return nativeMembraneResultToSolverResult(built, result, result.quads.map(quad => ({
    elementId: quad.quadId,
    stressMpa: quad.averageStressMpa,
    effectiveEMpa: quad.gaussPoints.reduce((sum, point) => sum + point.effectiveEMpa, 0) / 4,
    maxEquivalentStrain: Math.max(...quad.gaussPoints.map(point => point.maxEquivalentStrain)),
    equivalentPlasticStrain: Math.max(...quad.gaussPoints.map(point => point.equivalentPlasticStrain)),
    tensileDamage: Math.max(...quad.gaussPoints.map(point => point.tensileDamage)),
  })), supports);
}

export function nativeTriangleResultToSolverResult(
  built: ReturnType<typeof buildMesh>, result: NativeTriangle2DResult, supports: MultiInput["supports"],
): SolverResult {
  return nativeMembraneResultToSolverResult(built, result, result.elements.map(element => ({
    elementId: element.triangleId,
    stressMpa: element.stressMpa,
    effectiveEMpa: element.effectiveEMpa,
    maxEquivalentStrain: element.maxEquivalentStrain,
    equivalentPlasticStrain: element.equivalentPlasticStrain,
    tensileDamage: element.tensileDamage,
  })), supports);
}

function materialOptions(input: MultiInput, built: ReturnType<typeof buildMesh>, analysis: NativePlateAnalysis) {
  const laws = new Map<number, NativeMaterialLaw>();
  const curves: NativeModulusCurve[] = [];
  let nonlinearCount = 0;
  for (const info of built.plateInfo) {
    const plate = input.plates?.find(item => item.id === info.plateId);
    if (!plate) throw new Error(`Plaat ${info.plateId} ontbreekt in de solverinvoer.`);
    if (plate.nonlinearLaw && plate.modulusCurve?.length) {
      throw new Error(`Plaat ${plate.id}: kies een FNL-materiaalwet of een E-curve, niet beide.`);
    }
    const materialId = info.region.materialId;
    const baseEMpa = built.mesh.materials.get(materialId)?.E / 1e6;
    if (!(baseEMpa > 0)) throw new Error(`Plaat ${plate.id}: ongeldige elastische E-modulus.`);
    if (plate.nonlinearLaw) {
      const kind = plaatMateriaalSoort(plate.materiaal);
      if (kind === "staal" && plate.nonlinearLaw.kind !== "steelBilinear"
        || kind === "beton" && plate.nonlinearLaw.kind !== "concreteCracking") {
        throw new Error(`Plaat ${plate.id}: FNL-wet past niet bij het gekozen materiaal.`);
      }
      const law = plate.nonlinearLaw;
      const strength = law.kind === "steelBilinear" ? law.yieldMpa : law.tensileMpa;
      const ratio = law.kind === "steelBilinear" ? law.hardeningRatio : law.residualRatio;
      if (!Number.isFinite(strength) || strength <= 0 || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
        throw new Error(`Plaat ${plate.id}: FNL-sterkte en stijfheidsverhouding zijn ongeldig.`);
      }
      laws.set(materialId, law.kind === "steelBilinear"
        ? { kind: "steelBilinear", yield_mpa: law.yieldMpa, hardening_ratio: law.hardeningRatio }
        : { kind: "concreteCracking", tensile_mpa: law.tensileMpa, residual_ratio: law.residualRatio });
      nonlinearCount++;
    }
    if (plate.modulusCurve?.length) {
      let previousStrain = 0;
      let previousE = baseEMpa;
      for (const point of plate.modulusCurve) {
        if (!Number.isFinite(point.strain) || point.strain <= previousStrain
          || !Number.isFinite(point.eMpa) || point.eMpa <= 0 || point.eMpa > previousE) {
          throw new Error(`Plaat ${plate.id}: E-curve vereist stijgende positieve rek en niet-stijgende positieve E.`);
        }
        previousStrain = point.strain;
        previousE = point.eMpa;
      }
      curves.push({ materialId, points: [{ strain: 0, eMpa: baseEMpa }, ...plate.modulusCurve] });
      nonlinearCount++;
    }
  }
  if ((analysis === "material" || analysis === "combined") && nonlinearCount === 0) {
    throw new Error("Geef minstens één plaat een FNL-materiaalwet of een afnemende E-curve.");
  }
  return { laws, curves };
}

async function solveNativeMembraneMesh(
  input: MultiInput,
  built: ReturnType<typeof buildMesh>,
  analysis: NativePlateAnalysis,
): Promise<SolverResult> {
  if (input.beams.length > 0 || !input.plates?.length) {
    throw new Error("De Rust 2D-plaatroute vereist uitsluitend platen, zonder gekoppelde staven.");
  }
  if (input.scheefstand) throw new Error("Scheefstand is nog niet gevalideerd voor de Rust 2D-plaatroute.");
  if (built.randKoppelingen.length > 0) {
    throw new Error("Randkoppelingen zijn nog niet ondersteund door de Rust 2D-plaatroute.");
  }
  const { laws, curves } = materialOptions(input, built, analysis);
  const sideCounts = new Set([...built.mesh.elements.values()].map(element => element.nodeIds.length));
  if (sideCounts.size !== 1 || ![3, 4].includes([...sideCounts][0])) {
    throw new Error("De Rust 2D-plaatroute vereist een zuiver driehoeks- of vierhoeksmesh; gemengde meshes zijn nog niet gekoppeld.");
  }
  const triangles = sideCounts.has(3);
  const native = triangles
    ? await solveNativeTriangle2D(built.mesh, analysis, laws, [], curves)
    : await solveNativeQuad2D(built.mesh, analysis, laws, [], curves);
  // The Rust point-state commit can change the final free-DOF residual slightly
  // after the converged Newton step; still require a tight 1e-5 force ratio.
  if (!Number.isFinite(native.relativeResidual) || native.relativeResidual > 1e-5) {
    throw new Error("Rust 2D-plaatberekening heeft geen voldoende klein residu.");
  }
  return triangles
    ? nativeTriangleResultToSolverResult(built, native as NativeTriangle2DResult, input.supports)
    : nativeQuadResultToSolverResult(built, native as NativeQuad2DResult, input.supports);
}

/** Solve cases separately; linear cases can be superposed, nonlinear cases are for inspection only. */
export async function solveAllCasesNativeMembrane2D(
  input: MultiInput,
  analysis: NativePlateAnalysis = "linear",
): Promise<Map<number, SolverResult>> {
  const perCase = new Map<number, SolverResult>();
  for (const loadCase of input.cases) {
    const built = buildMesh(input, caseId => caseId === loadCase.id ? 1 : 0);
    // Empty default cases have no effect and are omitted by the existing solver too.
    const hasLoads = [...built.mesh.nodes.values()].some(node => node.loads.fx || node.loads.fy);
    if (!hasLoads) continue;
    perCase.set(loadCase.id, await solveNativeMembraneMesh(input, built, analysis));
  }
  return perCase;
}

/** Nonlinear combinations each keep their own Gauss-point history through the full load path. */
export async function solveAllCombinationsNativeMembrane2D(
  input: MultiInput,
  combinations: readonly LoadCombination[],
  analysis: Exclude<NativePlateAnalysis, "linear">,
): Promise<Map<number, SolverResult>> {
  const results = new Map<number, SolverResult>();
  for (const combination of combinations) {
    if (combination.eindtoestand !== undefined) {
      throw new Error(`Combinatie ${combination.name}: eindstijfheidvariant is niet ondersteund door de Rust 2D-plaatroute.`);
    }
    const built = buildMesh(input, caseId => combination.factors.get(caseId ?? -1) ?? 0);
    results.set(combination.id, await solveNativeMembraneMesh(input, built, analysis));
  }
  return results;
}

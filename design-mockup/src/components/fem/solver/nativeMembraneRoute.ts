import { buildMesh, registreerScheefstandRichtingen, SCHEEFSTAND_ID_OFFSET } from "./engine";
import type { LoadCombination } from "./combinations";
import type { MultiInput, PlateElementStress, PlateResult, SolverResult } from "./types";
import { solveNativeFem, solveNativeMixed2D, solveNativeQuad2D, solveNativeTriangle2D, solveNativeThreeLayerBatch,
  type NativeMixed2DResult, type NativeQuad2DResult, type NativeTriangle2DResult } from "../../../lib/nativeFemClient";
import type { NativeThreeLayerBatchInput } from "../../../lib/nativeFemClient";
import type { NativeMaterialLaw, NativeModulusCurve, NativePlateAnalysis } from "../../../core/fem/nativePlate2DAdapter";
import type { INode } from "../../../core/fem/types";
import { Mesh } from "../../../core/fem/Mesh";
import { plaatMateriaalSoort } from "../../../lib/plaatMateriaal";

type NativeElementStress = {
  elementId: number;
  stressMpa: [number, number, number];
  effectiveEMpa: number;
  maxEquivalentStrain: number;
  equivalentPlasticStrain: number;
  tensileDamage: number;
  threeLayerSamples?: NonNullable<PlateElementStress["threeLayerSamples"]>;
};

function q4GaussPointPositions(
  built: ReturnType<typeof buildMesh>,
  elementId: number,
): Array<[number, number]> {
  const element = built.mesh.getElement(elementId);
  if (!element || element.nodeIds.length !== 4) {
    throw new Error(`Q4-element ${elementId}: vier meshknopen ontbreken voor de Gauss-punten.`);
  }
  const nodes: Array<INode | undefined> = element.nodeIds.map((id: number) => built.mesh.getNode(id));
  if (nodes.some((node: INode | undefined) => !node || !Number.isFinite(node.x) || !Number.isFinite(node.y))) {
    throw new Error(`Q4-element ${elementId}: ongeldige knoopcoördinaten voor de Gauss-punten.`);
  }
  const a = 1 / Math.sqrt(3);
  return [[-a, -a], [a, -a], [a, a], [-a, a]].map(([xi, eta]) => {
    const weights = [
      (1 - xi) * (1 - eta) / 4,
      (1 + xi) * (1 - eta) / 4,
      (1 + xi) * (1 + eta) / 4,
      (1 - xi) * (1 + eta) / 4,
    ];
    return [
      weights.reduce((sum, weight, index) => sum + weight * nodes[index]!.x, 0),
      weights.reduce((sum, weight, index) => sum + weight * nodes[index]!.y, 0),
    ];
  });
}

/** Recompute the Blaauwendraad check from final resultants, including combinations. */
export async function voegNativeDrieLagencontroleToe(
  input: MultiInput,
  result: SolverResult,
): Promise<SolverResult> {
  for (const plate of input.plates ?? []) {
    if (!plate.threeLayer) continue;
    const plateResult = result.plateElements?.find((entry) => entry.plateId === plate.id);
    if (!plateResult) throw new Error(`Plaat ${plate.id}: drie-lagenresultaten ontbreken.`);
    const thicknessMm = plate.thickness;
    if (!Number.isFinite(thicknessMm) || thicknessMm! <= 0) {
      throw new Error(`Plaat ${plate.id}: ongeldige plaatdikte voor de drie-lagencontrole.`);
    }
    const config = plate.threeLayer;
    const batchInput: NativeThreeLayerBatchInput = {
      configuration: {
        thicknessMm: thicknessMm!, topSkinMm: config.topSkinMm, bottomSkinMm: config.bottomSkinMm,
        topReinforcement: { asX: config.topAsX, asY: config.topAsY },
        bottomReinforcement: { asX: config.bottomAsX, asY: config.bottomAsY },
        fcdMpa: config.fcdMpa, fydMpa: config.fydMpa, nuPrime: config.nuPrime,
        compressionModel: config.compressionModel,
      },
      samples: plateResult.elements.flatMap((element) => {
        if (element.corners.length !== 4 || element.corners.some((point) =>
          !Number.isFinite(point.x) || !Number.isFinite(point.z))) {
          throw new Error(`Plaat ${plate.id}, element ${element.elementId}: ongeldige Q4-geometrie.`);
        }
        if (![element.nx, element.ny, element.nxy].every(Number.isFinite)) {
          throw new Error(`Plaat ${plate.id}, element ${element.elementId}: niet-eindige membraankrachten.`);
        }
        const points = element.threeLayerSamples?.length === 4
          ? element.threeLayerSamples
          : [{
            id: `quad-${element.elementId}-center`,
            positionM: [element.corners.reduce((sum, point) => sum + point.x, 0) / 4_000,
              element.corners.reduce((sum, point) => sum + point.z, 0) / 4_000] as [number, number],
            nx: element.nx, ny: element.ny, nxy: element.nxy,
          }];
        if (points.some((point) => !point.id || point.positionM.some((value) => !Number.isFinite(value))
            || ![point.nx, point.ny, point.nxy].every(Number.isFinite))) {
          throw new Error(`Plaat ${plate.id}, element ${element.elementId}: ongeldige Gauss-puntresultanten.`);
        }
        return points.map((point) => ({
          id: point.id,
          positionM: point.positionM,
          forces: { nx: point.nx, ny: point.ny, nxy: point.nxy, mx: 0, my: 0, mxy: 0, vx: 0, vy: 0 },
        }));
      }),
    };
    const batch = await solveNativeThreeLayerBatch(batchInput);
    const checks = new Map(batch.results.map((entry) => [entry.id, entry]));
    const expected = plateResult.expectedElementIds;
    const sampleIds = new Set(batchInput.samples.map((sample) => sample.id));
    const expectedMismatch = expected !== undefined && (expected.length !== plateResult.elements.length
      || expected.some((id) => !plateResult.elements.some((element) => element.elementId === id)));
    if (batch.checkedPoints !== batchInput.samples.length || checks.size !== batch.results.length
        || sampleIds.size !== batchInput.samples.length
        || batchInput.samples.some((sample) => !checks.has(sample.id))
        || expectedMismatch) {
      throw new Error(`Plaat ${plate.id}: de drie-lagencontrole gaf geen volledig elementresultaat terug.`);
    }
    plateResult.elements = plateResult.elements.map((element) => {
      const sampleIdsForElement = element.threeLayerSamples?.length === 4
        ? element.threeLayerSamples.map((sample) => sample.id)
        : [`quad-${element.elementId}-center`];
      const elementChecks = sampleIdsForElement.map((id) => checks.get(id)).filter((entry) => entry !== undefined);
      if (elementChecks.length !== sampleIdsForElement.length) {
        throw new Error(`Plaat ${plate.id}, element ${element.elementId}: Gauss-puntcontrole ontbreekt.`);
      }
      const max = (values: number[]) => Math.max(...values);
      const governing = elementChecks.reduce((best, candidate) => {
        const utilization = (r: typeof candidate.result) => Math.max(
          r.top.utilizationAsX, r.top.utilizationAsY, r.top.utilizationCompression,
          r.bottom.utilizationAsX, r.bottom.utilizationAsY, r.bottom.utilizationCompression,
        );
        return utilization(candidate.result) > utilization(best.result) ? candidate : best;
      });
      const top = {
        utilizationAsX: max(elementChecks.map(({ result: r }) => r.top.utilizationAsX)),
        utilizationAsY: max(elementChecks.map(({ result: r }) => r.top.utilizationAsY)),
        utilizationCompression: max(elementChecks.map(({ result: r }) => r.top.utilizationCompression)),
        reinforcementCase: governing.result.top.reinforcementCase,
      };
      const bottom = {
        utilizationAsX: max(elementChecks.map(({ result: r }) => r.bottom.utilizationAsX)),
        utilizationAsY: max(elementChecks.map(({ result: r }) => r.bottom.utilizationAsY)),
        utilizationCompression: max(elementChecks.map(({ result: r }) => r.bottom.utilizationCompression)),
        reinforcementCase: governing.result.bottom.reinforcementCase,
      };
      return { ...element, threeLayer: {
        positionM: governing.positionM,
        status: elementChecks.some(({ result: r }) => r.status === "partial_check_exceeded")
          ? "partial_check_exceeded" : "partial_check_passes",
        top, bottom,
        notAssessed: [...new Set(elementChecks.flatMap(({ result: r }) => r.notAssessed))],
      } };
    });
  }
  return result;
}

/** Translate either Rust membrane element to the same units and IDs as the 2D UI. */
export function nativeMembraneResultToSolverResult(
  built: ReturnType<typeof buildMesh>,
  result: { nodes: NativeQuad2DResult["nodes"] },
  elementResults: readonly NativeElementStress[],
  supports: MultiInput["supports"],
  nodeIdentity?: { required: ReadonlySet<number>; allowed: ReadonlySet<number> },
): SolverResult {
  if (!result || typeof result !== "object" || !Array.isArray(result.nodes)
      || result.nodes.some(node => !node || typeof node !== "object")
      || elementResults.some(element => !element || typeof element !== "object")) {
    throw new Error("Rust 2D-plaatresultaat heeft ongeldige of ontbrekende knoop-/elementrecords.");
  }
  const expectedElementIds = new Set(built.plateInfo.flatMap(info => info.region.elementIds));
  const requiredNodeIds = nodeIdentity?.required ?? new Set([...expectedElementIds].flatMap(id =>
    built.mesh.getElement(id)?.nodeIds ?? []));
  const knownMeshNodeIds = nodeIdentity?.allowed ?? new Set([...built.mesh.nodes.keys()]);
  const returnedNodeIds = result.nodes.map(node => node.nodeId);
  const returnedElementIds = elementResults.map(element => element.elementId);
  const uniqueIds = (returned: number[]) => new Set(returned).size === returned.length;
  const completeNodeIdentity = uniqueIds(returnedNodeIds)
    && [...requiredNodeIds].every(id => returnedNodeIds.includes(id))
    && returnedNodeIds.every(id => knownMeshNodeIds.has(id));
  const exactElementIdentity = returnedElementIds.length === expectedElementIds.size
    && uniqueIds(returnedElementIds) && returnedElementIds.every(id => expectedElementIds.has(id));
  if (!completeNodeIdentity || !exactElementIdentity) {
    const duplicates = (ids: number[]) => ids.filter((id, index) => ids.indexOf(id) !== index);
    const missingNodes = [...requiredNodeIds].filter(id => !returnedNodeIds.includes(id));
    const unknownNodes = returnedNodeIds.filter(id => !knownMeshNodeIds.has(id));
    const missingElements = [...expectedElementIds].filter(id => !returnedElementIds.includes(id));
    const extraElements = returnedElementIds.filter(id => !expectedElementIds.has(id));
    throw new Error("Rust 2D-plaatresultaat heeft geen volledige, unieke knoop- en elementidentiteit. "
      + `Ontbrekende knopen ${missingNodes.slice(0, 4)}; onbekende knopen ${unknownNodes.slice(0, 4)}; `
      + `dubbele knopen ${duplicates(returnedNodeIds).slice(0, 4)}; `
      + `ontbrekende elementen ${missingElements.slice(0, 4)}; extra elementen ${extraElements.slice(0, 4)}.`);
  }
  if (result.nodes.some(node => ![node.uxM, node.uyM, node.rxKn, node.ryKn].every(Number.isFinite))) {
    throw new Error("Rust 2D-plaatresultaat bevat een niet-eindige knoopverplaatsing of oplegreactie.");
  }
  if (elementResults.some(element => !Array.isArray(element.stressMpa) || element.stressMpa.length !== 3
      || !element.stressMpa.every(Number.isFinite)
      || !Number.isFinite(element.effectiveEMpa) || element.effectiveEMpa <= 0
      || !Number.isFinite(element.maxEquivalentStrain) || element.maxEquivalentStrain < 0
      || !Number.isFinite(element.equivalentPlasticStrain) || element.equivalentPlasticStrain < 0
      || !Number.isFinite(element.tensileDamage) || element.tensileDamage < 0 || element.tensileDamage > 1
      || element.threeLayerSamples?.some(sample => !sample || typeof sample !== "object" || !sample.id
        || !Array.isArray(sample.positionM) || sample.positionM.length !== 2
        || !sample.positionM.every(Number.isFinite)
        || ![sample.nx, sample.ny, sample.nxy].every(Number.isFinite)))) {
    throw new Error("Rust 2D-plaatresultaat bevat ongeldige spannings- of materiaaltoestanden.");
  }
  const nodes = new Map(result.nodes.map(node => [node.nodeId, node]));
  const stresses = new Map(elementResults.map(element => [element.elementId, element]));
  const displacements = new Map<number, { ux: number; uz: number; ry: number }>();
  const reactions = new Map<number, { fx: number; fz: number; my: number }>();
  let maxDisplacement = 0;
  const plateNodeDisplacements = new Map<number, { ux: number; uz: number }>();
  for (const node of result.nodes) {
    maxDisplacement = Math.max(maxDisplacement, Math.hypot(node.uxM, node.uyM) * 1000);
    plateNodeDisplacements.set(node.nodeId, { ux: node.uxM * 1000, uz: node.uyM * 1000 });
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
        ...(stressResult.threeLayerSamples ? { threeLayerSamples: stressResult.threeLayerSamples } : {}),
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
  return { displacements, reactions, elements: new Map(), maxDisplacement, plateElements, plateNodeDisplacements };
}

export function nativeQuadResultToSolverResult(
  built: ReturnType<typeof buildMesh>, result: NativeQuad2DResult, supports: MultiInput["supports"],
): SolverResult {
  if (!result || typeof result !== "object" || !Array.isArray(result.nodes)
      || !Array.isArray(result.quads) || result.quads.some(quad => !quad || typeof quad !== "object")) {
    throw new Error("Rust Q4-resultaat mist geldige knoop- of elementrecords.");
  }
  for (const quad of result.quads) {
    if (!Array.isArray(quad.averageStressMpa) || quad.averageStressMpa.length !== 3
        || !Array.isArray(quad.gaussPoints) || quad.gaussPoints.length !== 4
        || !quad.averageStressMpa.every(Number.isFinite)
        || quad.gaussPoints.some(point => !point || typeof point !== "object"
          || !Array.isArray(point.stressMpa) || point.stressMpa.length !== 3
          || !point.stressMpa.every(Number.isFinite)
          || !Number.isFinite(point.effectiveEMpa) || point.effectiveEMpa <= 0
          || !Number.isFinite(point.maxEquivalentStrain) || point.maxEquivalentStrain < 0
          || !Number.isFinite(point.equivalentPlasticStrain) || point.equivalentPlasticStrain < 0
          || !Number.isFinite(point.tensileDamage) || point.tensileDamage < 0 || point.tensileDamage > 1)) {
      throw new Error(`Q4-element ${quad.quadId}: ongeldig Rust-resultaat op de vier Gauss-punten.`);
    }
  }
  return nativeMembraneResultToSolverResult(built, result, result.quads.map(quad => {
    const element = built.mesh.getElement(quad.quadId);
    const thicknessM = element?.thickness;
    if (!(Number.isFinite(thicknessM) && thicknessM! > 0)) {
      throw new Error(`Q4-element ${quad.quadId}: ongeldige dikte voor Gauss-puntresultanten.`);
    }
    const positions = q4GaussPointPositions(built, quad.quadId);
    return {
      elementId: quad.quadId,
      stressMpa: quad.averageStressMpa,
      effectiveEMpa: quad.gaussPoints.reduce((sum, point) => sum + point.effectiveEMpa, 0) / 4,
      maxEquivalentStrain: Math.max(...quad.gaussPoints.map(point => point.maxEquivalentStrain)),
      equivalentPlasticStrain: Math.max(...quad.gaussPoints.map(point => point.equivalentPlasticStrain)),
      tensileDamage: Math.max(...quad.gaussPoints.map(point => point.tensileDamage)),
      threeLayerSamples: quad.gaussPoints.map((point, index) => ({
        id: `quad-${quad.quadId}-gauss-${index + 1}`,
        positionM: positions[index],
        nx: point.stressMpa[0] * thicknessM! * 1000,
        ny: point.stressMpa[1] * thicknessM! * 1000,
        nxy: point.stressMpa[2] * thicknessM! * 1000,
      })),
    };
  }), supports);
}

export function nativeTriangleResultToSolverResult(
  built: ReturnType<typeof buildMesh>, result: NativeTriangle2DResult, supports: MultiInput["supports"],
): SolverResult {
  if (!result || typeof result !== "object" || !Array.isArray(result.nodes)
      || result.nodes.some(node => !node || typeof node !== "object")
      || !Array.isArray(result.elements)
      || result.elements.some(element => !element || typeof element !== "object")) {
    throw new Error("Rust CST-resultaat mist geldige knoop- of elementrecords.");
  }
  return nativeMembraneResultToSolverResult(built, result, result.elements.map(element => ({
    elementId: element.triangleId,
    stressMpa: element.stressMpa,
    effectiveEMpa: element.effectiveEMpa,
    maxEquivalentStrain: element.maxEquivalentStrain,
    equivalentPlasticStrain: element.equivalentPlasticStrain,
    tensileDamage: element.tensileDamage,
  })), supports);
}

export function nativeMixedResultToSolverResult(
  built: ReturnType<typeof buildMesh>, result: NativeMixed2DResult, supports: MultiInput["supports"],
): SolverResult {
  if (!result || typeof result !== "object" || !Array.isArray(result.nodes)
      || result.nodes.some(node => !node || typeof node !== "object")
      || !Array.isArray(result.triangles)
      || result.triangles.some(element => !element || typeof element !== "object")
      || !Array.isArray(result.quads)
      || result.quads.some(quad => !quad || typeof quad !== "object")) {
    throw new Error("Rust gemengd 2D-resultaat mist geldige knoop-, CST- of Q4-records.");
  }
  const triangleResults: NativeElementStress[] = result.triangles.map(element => ({
    elementId: element.triangleId,
    stressMpa: element.stressMpa,
    effectiveEMpa: element.effectiveEMpa,
    maxEquivalentStrain: element.maxEquivalentStrain,
    equivalentPlasticStrain: element.equivalentPlasticStrain,
    tensileDamage: element.tensileDamage,
  }));
  const quadResults: NativeElementStress[] = result.quads.map(quad => {
    if (!Array.isArray(quad.gaussPoints) || quad.gaussPoints.length !== 4
        || !Array.isArray(quad.averageStressMpa) || quad.averageStressMpa.length !== 3
        || !quad.averageStressMpa.every(Number.isFinite)
        || quad.gaussPoints.some(point => !point || typeof point !== "object"
          || !Array.isArray(point.stressMpa) || point.stressMpa.length !== 3
          || !point.stressMpa.every(Number.isFinite)
          || !Number.isFinite(point.effectiveEMpa) || point.effectiveEMpa <= 0
          || !Number.isFinite(point.maxEquivalentStrain) || point.maxEquivalentStrain < 0
          || !Number.isFinite(point.equivalentPlasticStrain) || point.equivalentPlasticStrain < 0
          || !Number.isFinite(point.tensileDamage) || point.tensileDamage < 0 || point.tensileDamage > 1)) {
      throw new Error(`Q4-element ${quad.quadId}: ongeldig Rust-resultaat op de vier Gauss-punten.`);
    }
    const element = built.mesh.getElement(quad.quadId);
    const thicknessM = element?.thickness;
    if (!(Number.isFinite(thicknessM) && thicknessM! > 0)) {
      throw new Error(`Q4-element ${quad.quadId}: ongeldige dikte voor Gauss-puntresultanten.`);
    }
    const positions = q4GaussPointPositions(built, quad.quadId);
    return {
      elementId: quad.quadId,
      stressMpa: quad.averageStressMpa,
      effectiveEMpa: quad.gaussPoints.reduce((sum, point) => sum + point.effectiveEMpa, 0) / 4,
      maxEquivalentStrain: Math.max(...quad.gaussPoints.map(point => point.maxEquivalentStrain)),
      equivalentPlasticStrain: Math.max(...quad.gaussPoints.map(point => point.equivalentPlasticStrain)),
      tensileDamage: Math.max(...quad.gaussPoints.map(point => point.tensileDamage)),
      threeLayerSamples: quad.gaussPoints.map((point, index) => ({
        id: `quad-${quad.quadId}-gauss-${index + 1}`,
        positionM: positions[index],
        nx: point.stressMpa[0] * thicknessM! * 1000,
        ny: point.stressMpa[1] * thicknessM! * 1000,
        nxy: point.stressMpa[2] * thicknessM! * 1000,
      })),
    };
  });
  return nativeMembraneResultToSolverResult(built, result, [...triangleResults, ...quadResults], supports);
}

export function materialOptions(
  input: MultiInput, built: ReturnType<typeof buildMesh>, analysis: NativePlateAnalysis,
  requireNonlinear = true,
) {
  const laws = new Map<number, NativeMaterialLaw>();
  const curves: NativeModulusCurve[] = [];
  let nonlinearCount = 0;
  for (const info of built.plateInfo) {
    const plate = input.plates?.find(item => item.id === info.plateId);
    if (!plate) throw new Error(`Plaat ${info.plateId} ontbreekt in de solverinvoer.`);
    if (plate.threeLayer && plaatMateriaalSoort(plate.materiaal) !== "beton") {
      throw new Error(`Plaat ${plate.id}: de Blaauwendraad drie-lagencontrole vereist een expliciet herkend betonmateriaal.`);
    }
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
  if (requireNonlinear && (analysis === "material" || analysis === "combined") && nonlinearCount === 0) {
    throw new Error("Geef minstens één plaat een FNL-materiaalwet of een afnemende E-curve.");
  }
  return { laws, curves };
}

type NativeQuadGrid = {
  nodes: Array<{ id: number; x: number; y: number }>;
  quads: Array<{ id: number; nodeIds: [number, number, number, number]; materialId: number; thicknessM: number }>;
};

const coordinateKey = (x: number, y: number) => `${x.toPrecision(13)},${y.toPrecision(13)}`;

/**
 * Replace the app's generated rectangular Q4 mesh with the Rust square-grid
 * mesh when the two discretizations are exactly identical. The strict parity
 * guard preserves load/support locations and element identities while making
 * the native mesher the source of the actual solver mesh.
 */
async function useNativeRectangularQuadMesh(
  input: MultiInput,
  built: ReturnType<typeof buildMesh>,
): Promise<void> {
  if (!input.plates?.length || input.plates.length !== built.plateInfo.length
      || built.randKoppelingen.length !== 0 || built.mesh.beamElements.size !== 0) return;
  const plateById = new Map(input.plates.map(plate => [plate.id, plate]));
  const oldNodeByCoordinate = new Map<string, INode>();
  for (const node of built.mesh.nodes.values()) {
    const key = coordinateKey(node.x, node.y);
    if (oldNodeByCoordinate.has(key)) return;
    oldNodeByCoordinate.set(key, node);
  }
  if ([...built.mesh.elements.values()].some(element => element.nodeIds.length !== 4)) return;

  const elementSignature = (nodeIds: readonly number[], nodeById: (id: number) => { x: number; y: number } | undefined) =>
    nodeIds.map(id => {
      const node = nodeById(id);
      if (!node) return "missing";
      return coordinateKey(node.x, node.y);
    }).sort().join(";");
  const nativeMeshes: Array<{
    info: typeof built.plateInfo[number];
    native: NativeQuadGrid;
    nativeNodeToOld: Map<number, number>;
    nativeElementToOld: Map<number, number>;
  }> = [];
  const coveredSourceElements = new Set<number>();
  const clearanceM = 0.010;
  for (const info of built.plateInfo) {
    const plate = plateById.get(info.plateId);
    if (!plate || plate.meshType !== "vierhoeken" || plate.meshCache || info.edgeNodeIds !== undefined) return;
    const corners = info.hoeken;
    const xs = [...new Set(corners.map(point => point.x))].sort((a, b) => a - b);
    const ys = [...new Set(corners.map(point => point.z))].sort((a, b) => a - b);
    if (corners.length !== 4 || xs.length !== 2 || ys.length !== 2
        || corners.some(point => !xs.includes(point.x) || !ys.includes(point.z))) return;
    const openingBounds = info.openingen.map(opening => {
      const openingXs = [...new Set(opening.punten.map(point => point.x))].sort((a, b) => a - b);
      const openingYs = [...new Set(opening.punten.map(point => point.z))].sort((a, b) => a - b);
      if (opening.punten.length !== 4 || openingXs.length !== 2 || openingYs.length !== 2
          || opening.punten.some(point => !openingXs.includes(point.x) || !openingYs.includes(point.z))) return undefined;
      return { xM: openingXs[0] / 1000, yM: openingYs[0] / 1000,
        widthM: (openingXs[1] - openingXs[0]) / 1000, heightM: (openingYs[1] - openingYs[0]) / 1000 };
    });
    const openings = openingBounds.filter((opening): opening is NonNullable<typeof opening> => opening !== undefined);
    if (openings.length !== openingBounds.length) return;
    const widthM = (xs[1] - xs[0]) / 1000, heightM = (ys[1] - ys[0]) / 1000;
    if (openings.some(opening => opening.xM <= xs[0] / 1000 + clearanceM
        || opening.yM <= ys[0] / 1000 + clearanceM
        || opening.xM + opening.widthM >= xs[1] / 1000 - clearanceM
        || opening.yM + opening.heightM >= ys[1] / 1000 - clearanceM)) return;
    for (let i = 0; i < openings.length; i++) for (let j = i + 1; j < openings.length; j++) {
      const a = openings[i], b = openings[j];
      if (a.xM <= b.xM + b.widthM + clearanceM && b.xM <= a.xM + a.widthM + clearanceM
          && a.yM <= b.yM + b.heightM + clearanceM && b.yM <= a.yM + a.heightM + clearanceM) return;
    }
    const sourceElements = info.region.elementIds
      .map(id => built.mesh.getElement(id))
      .filter((element): element is NonNullable<typeof element> => element !== undefined);
    if (sourceElements.length !== info.region.elementIds.length || sourceElements.length === 0
        || sourceElements.some(element => coveredSourceElements.has(element.id))) return;
    sourceElements.forEach(element => coveredSourceElements.add(element.id));
    const materialId = sourceElements[0].materialId;
    const thicknessM = sourceElements[0].thickness;
    if (sourceElements.some(element => element.materialId !== materialId
        || !Number.isFinite(element.thickness) || element.thickness <= 0
        || element.thickness !== thicknessM)) return;
    const meshSizeMm = plate.meshSize;
    if (!(Number.isFinite(meshSizeMm) && meshSizeMm > 0)) return;
    const native = await solveNativeFem<NativeQuadGrid>("quadMesh", {
      originX: xs[0] / 1000, originY: ys[0] / 1000, widthM, heightM,
      maxCellSizeM: meshSizeMm / 1000, materialId, thicknessM,
      ...(openings.length ? { openings } : {}),
    });
    if (!native || typeof native !== "object" || !Array.isArray(native.nodes)
        || !Array.isArray(native.quads)
        || native.nodes.some(node => !node || typeof node !== "object"
          || !Number.isSafeInteger(node.id) || node.id <= 0 || !Number.isFinite(node.x) || !Number.isFinite(node.y))
        || native.quads.some(quad => !quad || typeof quad !== "object"
          || !Number.isSafeInteger(quad.id) || quad.id <= 0
          || !Array.isArray(quad.nodeIds) || quad.nodeIds.length !== 4
          || new Set(quad.nodeIds).size !== 4 || quad.nodeIds.some(id => !Number.isSafeInteger(id) || id <= 0)
          || !Number.isSafeInteger(quad.materialId) || !Number.isFinite(quad.thicknessM) || quad.thicknessM <= 0)
        || new Set(native.nodes.map(node => node.id)).size !== native.nodes.length
        || new Set(native.quads.map(quad => quad.id)).size !== native.quads.length) return;
    const sourceNodeIds = new Set(sourceElements.flatMap(element => element.nodeIds));
    if (native.quads.length !== sourceElements.length
        || native.nodes.length !== sourceNodeIds.size) return;
    const nativeNodeToOld = new Map<number, number>();
    for (const node of native.nodes) {
      const source = oldNodeByCoordinate.get(coordinateKey(node.x, node.y));
      if (!source || !sourceNodeIds.has(source.id)) return;
      nativeNodeToOld.set(node.id, source.id);
    }
    const sourceElementBySignature = new Map(sourceElements.map(element => [
      elementSignature(element.nodeIds, id => built.mesh.getNode(id)), element,
    ]));
    const nativeElementToOld = new Map<number, number>();
    for (const quad of native.quads) {
      const source = sourceElementBySignature.get(elementSignature(
        quad.nodeIds, id => native.nodes.find(node => node.id === id)));
      if (!source || quad.materialId !== source.materialId
          || Math.abs(quad.thicknessM - source.thickness) > 1e-12 * Math.max(1, source.thickness)) return;
      nativeElementToOld.set(quad.id, source.id);
    }
    nativeMeshes.push({ info, native, nativeNodeToOld, nativeElementToOld });
  }
  if (coveredSourceElements.size !== built.mesh.elements.size) return;

  const mesh = new Mesh();
  mesh.materials = new Map(built.mesh.materials);
  const oldNodeToNew = new Map<number, number>();
  const newNodeByCoordinate = new Map<string, number>();
  const oldElementToNew = new Map<number, number>();
  for (const { native, nativeNodeToOld, nativeElementToOld } of nativeMeshes) {
    const localToGlobalNode = new Map<number, number>();
    for (const node of native.nodes) {
      const key = coordinateKey(node.x, node.y);
      const oldId = nativeNodeToOld.get(node.id);
      if (oldId === undefined) return;
      let newId = newNodeByCoordinate.get(key);
      if (newId === undefined) {
        const added = mesh.addNode(node.x, node.y);
        newId = added.id;
        const source = built.mesh.getNode(oldId);
        if (!source) return;
        added.constraints = { ...source.constraints };
        added.loads = { ...source.loads };
        newNodeByCoordinate.set(key, newId);
      }
      const existingMap = oldNodeToNew.get(oldId);
      if (existingMap !== undefined && existingMap !== newId) return;
      oldNodeToNew.set(oldId, newId);
      localToGlobalNode.set(node.id, newId);
    }
    for (const quad of native.quads) {
      const oldElementId = nativeElementToOld.get(quad.id);
      if (oldElementId === undefined) return;
      const nodeIds = quad.nodeIds.map(id => localToGlobalNode.get(id)) as [number, number, number, number];
      const added = mesh.addQuadElement(nodeIds, quad.materialId, quad.thicknessM);
      if (!added) return;
      oldElementToNew.set(oldElementId, added.id);
    }
  }
  if (oldNodeToNew.size !== built.mesh.nodes.size || oldElementToNew.size !== built.mesh.elements.size) return;
  const mappedNodeIds = new Map<number, number>();
  for (const [uiId, oldId] of built.nodeIdMap) {
    const newId = oldNodeToNew.get(oldId);
    if (newId === undefined) return;
    mappedNodeIds.set(uiId, newId);
  }
  const mappedElementIds = nativeMeshes.map(({ info }) => ({
    info,
    elementIds: info.region.elementIds.map(oldId => oldElementToNew.get(oldId)),
  }));
  if (mappedElementIds.some(({ elementIds }) => elementIds.some(id => id === undefined))) return;
  for (const { info, elementIds } of mappedElementIds) {
    info.region.elementIds = elementIds as number[];
  }
  built.nodeIdMap = mappedNodeIds;
  built.mesh = mesh;
}

async function solveNativeMembraneMesh(
  input: MultiInput,
  built: ReturnType<typeof buildMesh>,
  analysis: NativePlateAnalysis,
): Promise<SolverResult> {
  if (input.beams.length > 0 || !input.plates?.length) {
    throw new Error("De Rust 2D-plaatroute vereist uitsluitend platen, zonder gekoppelde staven.");
  }
  if (input.scheefstand && (!Number.isFinite(input.scheefstand.phi) || input.scheefstand.phi < 0
      || (input.scheefstand.richting !== 1 && input.scheefstand.richting !== -1))) {
    throw new Error("De Rust 2D-plaatroute vereist een eindige, niet-negatieve φ en scheefstandrichting +1 of −1.");
  }
  if (built.randKoppelingen.length > 0) {
    throw new Error("Randkoppelingen zijn nog niet ondersteund door de Rust 2D-plaatroute.");
  }
  await useNativeRectangularQuadMesh(input, built);
  const { laws, curves } = materialOptions(input, built, analysis);
  const sideCounts = new Set([...built.mesh.elements.values()].map(element => element.nodeIds.length));
  if ([...sideCounts].some(sides => ![3, 4].includes(sides))) {
    throw new Error("De Rust 2D-plaatroute vereist CST-driehoeken en/of Q4-vierhoeken.");
  }
  const triangles = sideCounts.has(3);
  const mixed = triangles && sideCounts.has(4);
  const hasMaterialHistory = analysis === "material" || analysis === "combined";
  const loadPath = hasMaterialHistory ? input.axialMaterialLoadPath ?? [1] : [];
  if (hasMaterialHistory && (loadPath.length === 0 || loadPath.length > 100
      || loadPath.some((factor) => !Number.isFinite(factor)))) {
    throw new Error("De Rust-plaatroute vereist 1 tot 100 eindige factoren in het FNL-belastingspad.");
  }
  const native = mixed
    ? await solveNativeMixed2D(built.mesh, analysis, laws, loadPath, curves)
    : triangles
      ? await solveNativeTriangle2D(built.mesh, analysis, laws, loadPath, curves)
      : await solveNativeQuad2D(built.mesh, analysis, laws, loadPath, curves);
  // The Rust point-state commit can change the final free-DOF residual slightly
  // after the converged Newton step; still require a tight 1e-5 force ratio.
  if (!Number.isFinite(native.relativeResidual) || native.relativeResidual < 0 || native.relativeResidual > 1e-5) {
    throw new Error("Rust 2D-plaatberekening heeft geen voldoende klein residu.");
  }
  if (triangles && input.plates.some((plate) => plate.threeLayer)) {
    throw new Error("De Blaauwendraad drie-lagencontrole vereist vierhoekelementen; kies voor deze plaat een Q4-raster.");
  }
  const solverResult = mixed
    ? nativeMixedResultToSolverResult(built, native as NativeMixed2DResult, input.supports)
    : triangles
      ? nativeTriangleResultToSolverResult(built, native as NativeTriangle2DResult, input.supports)
      : nativeQuadResultToSolverResult(built, native as NativeQuad2DResult, input.supports);
  return !triangles && (input.plates ?? []).some((plate) => plate.threeLayer)
    ? voegNativeDrieLagencontroleToe(input, solverResult)
    : solverResult;
}

/** Solve cases separately; linear cases can be superposed, nonlinear cases are for inspection only. */
export async function solveAllCasesNativeMembrane2D(
  input: MultiInput,
  analysis: NativePlateAnalysis = "linear",
): Promise<Map<number, SolverResult>> {
  const perCase = new Map<number, SolverResult>();
  if (input.scheefstand && input.cases.some(loadCase => loadCase.id >= SCHEEFSTAND_ID_OFFSET)) {
    throw new Error("Belastinggeval-id botst met de scheefstandvarianten van de Rust 2D-plaatroute.");
  }
  const solveDirection = async (richting: 1 | -1 | undefined, offset: number) => {
    const directionalInput = richting === undefined ? input
      : { ...input, scheefstand: { ...input.scheefstand!, richting } };
    for (const loadCase of input.cases) {
      const built = buildMesh(directionalInput, caseId => caseId === loadCase.id ? 1 : 0,
        { solverCapacity: "native" });
      // Empty default cases have no effect and are omitted by the existing solver too.
      const hasLoads = [...built.mesh.nodes.values()].some(node => node.loads.fx || node.loads.fy);
      if (!hasLoads) continue;
      perCase.set(loadCase.id + offset, await solveNativeMembraneMesh(directionalInput, built, analysis));
    }
  };
  await solveDirection(input.scheefstand?.richting, 0);
  if (input.scheefstand) {
    await solveDirection((-input.scheefstand.richting) as 1 | -1, SCHEEFSTAND_ID_OFFSET);
    registreerScheefstandRichtingen(perCase, input.scheefstand.richting);
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
    const directionalInput = input.scheefstand && combination.scheefstandRichting !== undefined
      ? { ...input, scheefstand: { ...input.scheefstand, richting: combination.scheefstandRichting } }
      : input;
    const built = buildMesh(directionalInput, caseId => combination.factors.get(caseId ?? -1) ?? 0,
      { solverCapacity: "native" });
    results.set(combination.id, await solveNativeMembraneMesh(directionalInput, built, analysis));
  }
  return results;
}

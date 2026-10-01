import { buildMesh } from "./engine";
import type { MultiInput, PlateElementStress, PlateResult, SolverResult } from "./types";
import { solveNativeQuad2D, type NativeQuad2DResult } from "../../../lib/nativeFemClient";

/** Translate the Rust membrane result to the same units and IDs as the 2D UI. */
export function nativeQuadResultToSolverResult(
  built: ReturnType<typeof buildMesh>,
  result: NativeQuad2DResult,
  supports: MultiInput["supports"],
): SolverResult {
  const nodes = new Map(result.nodes.map(node => [node.nodeId, node]));
  const quads = new Map(result.quads.map(quad => [quad.quadId, quad]));
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
      const quad = quads.get(elementId);
      const element = built.mesh.getElement(elementId);
      if (!quad || !element) throw new Error(`Plaat ${info.plateId}: geen Rust-spanning voor element ${elementId}.`);
      const [sigmaX, sigmaY, tauXY] = quad.averageStressMpa;
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

/** Solve load cases separately so existing linear combination/envelope logic remains valid. */
export async function solveAllCasesNativeQuad2D(input: MultiInput): Promise<Map<number, SolverResult>> {
  if (input.beams.length > 0 || !input.plates?.length) {
    throw new Error("De Rust Quad4-route vereist uitsluitend platen, zonder gekoppelde staven.");
  }
  if (input.scheefstand) throw new Error("Scheefstand is nog niet gevalideerd voor de Rust Quad4-route.");
  const perCase = new Map<number, SolverResult>();
  for (const loadCase of input.cases) {
    const built = buildMesh(input, caseId => caseId === loadCase.id ? 1 : 0);
    if (built.randKoppelingen.length > 0) {
      throw new Error("Randkoppelingen zijn nog niet ondersteund door de Rust Quad4-route.");
    }
    // Empty default cases have no effect and are omitted by the existing solver too.
    const hasLoads = [...built.mesh.nodes.values()].some(node => node.loads.fx || node.loads.fy);
    if (!hasLoads) continue;
    const native = await solveNativeQuad2D(built.mesh);
    if (!Number.isFinite(native.relativeResidual) || native.relativeResidual > 1e-6) {
      throw new Error(`Rust Quad4 berekening van ${loadCase.name} heeft geen voldoende klein residu.`);
    }
    perCase.set(loadCase.id, nativeQuadResultToSolverResult(built, native, input.supports));
  }
  return perCase;
}

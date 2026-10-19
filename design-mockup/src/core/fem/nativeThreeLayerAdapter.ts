import type { Mesh } from './Mesh';
import type {
  NativeHybridPlateResult,
  NativeQuad2DResult,
  NativeThreeLayerBatchInput,
  NativeThreeLayerInput,
} from '../../lib/nativeFemClient';

export type NativeThreeLayerConfiguration = Omit<NativeThreeLayerInput, 'forces' | 'thicknessMm'>;

/**
 * Combine the existing Rust Q4 membrane stresses with the Rust hybrid-plate
 * moment/shear output at matching element IDs, then prepare one batch request
 * for the Blaauwendraad three-layer postprocessor. One center resultant is
 * checked per element: the membrane stress is the Q4 area average and the
 * hybrid plate exposes resultants at the element center.
 */
export function buildNativeThreeLayerBatchInput(
  mesh: Mesh,
  membrane: NativeQuad2DResult,
  bending: NativeHybridPlateResult,
  configuration: NativeThreeLayerConfiguration,
): NativeThreeLayerBatchInput {
  const membraneById = new Map(membrane.quads.map((quad) => [quad.quadId, quad]));
  const bendingById = new Map(bending.elements.map((element) => [element.quadId, element]));
  if (membraneById.size !== membrane.quads.length || bendingById.size !== bending.elements.length
      || membraneById.size === 0 || membraneById.size !== bendingById.size
      || [...membraneById.keys()].some((id) => !bendingById.has(id))) {
    throw new Error('Membraan- en buigresultaten moeten dezelfde unieke vierhoeken bevatten.');
  }
  if (!Number.isFinite(membrane.relativeResidual) || membrane.relativeResidual > 1e-7
      || !Number.isFinite(bending.relativeResidual) || bending.relativeResidual > 1e-7) {
    throw new Error('De upstream FEM-oplossingen hebben geen toereikend evenwicht bereikt.');
  }
  const expectedNodeIds = new Set([...membraneById.keys()].flatMap((id) => {
    const element = mesh.elements.get(id);
    if (!element || element.nodeIds.length !== 4) return [];
    return element.nodeIds;
  }));
  const membraneNodeIds = new Set(membrane.nodes.map((node) => node.nodeId));
  const bendingNodeIds = new Set(bending.nodes.map((node) => node.nodeId));
  const sameNodes = (actual: Set<number>) => actual.size === expectedNodeIds.size
    && [...expectedNodeIds].every((id) => actual.has(id));
  if (!sameNodes(membraneNodeIds) || !sameNodes(bendingNodeIds)
      || membraneNodeIds.size !== membrane.nodes.length || bendingNodeIds.size !== bending.nodes.length) {
    throw new Error('Membraan- en buigresultaten moeten dezelfde meshknopen bevatten.');
  }
  const samples = [...membraneById].map(([quadId, membraneQuad]) => {
    const element = mesh.elements.get(quadId);
    const bendingQuad = bendingById.get(quadId);
    if (!element || element.nodeIds.length !== 4 || !bendingQuad || !Number.isFinite(element.thickness)
        || element.thickness <= 0) {
      throw new Error(`Vierhoek ${quadId}: ontbrekende geometrie of ongeldige plaatdikte.`);
    }
    if (!membraneQuad.averageStressMpa.every(Number.isFinite)
        || ![...bendingQuad.momentKnmPerM, ...bendingQuad.shearKnPerM].every(Number.isFinite)) {
      throw new Error(`Vierhoek ${quadId}: niet-eindige solverresultanten.`);
    }
    const nodes = element.nodeIds.map((id) => mesh.nodes.get(id));
    if (nodes.some((node) => !node || !Number.isFinite(node.x) || !Number.isFinite(node.y))) {
      throw new Error(`Vierhoek ${quadId}: ontbrekende knoopcoördinaten.`);
    }
    const positionM: [number, number] = [
      nodes.reduce((sum, node) => sum + node!.x, 0) / 4,
      nodes.reduce((sum, node) => sum + node!.y, 0) / 4,
    ];
    const thicknessMm = element.thickness * 1000;
    return {
      id: `quad-${quadId}-center`,
      positionM,
      forces: {
        nx: membraneQuad.averageStressMpa[0] * thicknessMm,
        ny: membraneQuad.averageStressMpa[1] * thicknessMm,
        nxy: membraneQuad.averageStressMpa[2] * thicknessMm,
        mx: bendingQuad.momentKnmPerM[0],
        my: bendingQuad.momentKnmPerM[1],
        mxy: bendingQuad.momentKnmPerM[2],
        vx: bendingQuad.shearKnPerM[0],
        vy: bendingQuad.shearKnPerM[1],
      },
    };
  });
  const thicknesses = new Set([...membraneById.keys()].map((id) => mesh.elements.get(id)!.thickness));
  if (thicknesses.size !== 1) {
    throw new Error('De drie-lagenconfiguratie en Q4-mesh moeten dezelfde uniforme plaatdikte gebruiken.');
  }
  const thicknessMm = [...thicknesses][0] * 1000;
  if ('thicknessMm' in configuration && configuration.thicknessMm !== thicknessMm) {
    throw new Error('De drie-lagenconfiguratie en Q4-mesh moeten dezelfde uniforme plaatdikte gebruiken.');
  }
  return {
    configuration: { ...configuration, thicknessMm },
    samples,
  };
}

/** Build three-layer checks from the existing in-plane Rust Q4 solution. */
export function buildNativeThreeLayerMembraneBatchInput(
  mesh: Mesh,
  membrane: NativeQuad2DResult,
  configuration: NativeThreeLayerConfiguration,
): NativeThreeLayerBatchInput {
  if (!Number.isFinite(membrane.relativeResidual) || membrane.relativeResidual > 1e-5) {
    throw new Error('De upstream Rust-schijfoplossing heeft geen toereikend evenwicht bereikt.');
  }
  const membraneById = new Map(membrane.quads.map((quad) => [quad.quadId, quad]));
  if (membraneById.size !== membrane.quads.length || membraneById.size === 0) {
    throw new Error('Membraanresultaten moeten unieke vierhoeken bevatten.');
  }
  const nodeIds = membrane.nodes.map((node) => node.nodeId);
  const nodeIdSet = new Set(nodeIds);
  if (nodeIdSet.size !== nodeIds.length) throw new Error('Membraanresultaten bevatten dubbele knoop-ID’s.');
  const samples = [...membraneById].map(([quadId, quad]) => {
    const element = mesh.elements.get(quadId);
    if (!element || element.nodeIds.length !== 4 || !(Number.isFinite(element.thickness) && element.thickness > 0)) {
      throw new Error(`Vierhoek ${quadId}: ontbrekende geometrie of ongeldige plaatdikte.`);
    }
    if (!quad.averageStressMpa.every(Number.isFinite)) {
      throw new Error(`Vierhoek ${quadId}: niet-eindige membraanspanningen.`);
    }
    if (element.nodeIds.some((nodeId) => !nodeIdSet.has(nodeId))) {
      throw new Error(`Vierhoek ${quadId}: de membraanresultaten missen een bijbehorende meshknoop.`);
    }
    const nodes = element.nodeIds.map((id) => mesh.nodes.get(id));
    if (nodes.some((node) => !node || !Number.isFinite(node.x) || !Number.isFinite(node.y))) {
      throw new Error(`Vierhoek ${quadId}: ontbrekende knoopcoördinaten.`);
    }
    return {
      id: `quad-${quadId}-center`,
      positionM: [nodes.reduce((sum, node) => sum + node!.x, 0) / 4,
        nodes.reduce((sum, node) => sum + node!.y, 0) / 4] as [number, number],
      forces: {
        nx: quad.averageStressMpa[0] * element.thickness * 1000,
        ny: quad.averageStressMpa[1] * element.thickness * 1000,
        nxy: quad.averageStressMpa[2] * element.thickness * 1000,
        mx: 0, my: 0, mxy: 0, vx: 0, vy: 0,
      },
    };
  });
  const thicknesses = new Set([...membraneById.keys()].map((id) => mesh.elements.get(id)!.thickness));
  if (thicknesses.size !== 1) {
    throw new Error('De drie-lagen deelcontrole vereist één plaatdikte binnen de batch.');
  }
  const thicknessMm = [...thicknesses][0] * 1000;
  if ('thicknessMm' in configuration && configuration.thicknessMm !== thicknessMm) {
    throw new Error('De drie-lagen deelcontrole vereist dezelfde uniforme plaatdikte als het mesh.');
  }
  return { configuration: { ...configuration, thicknessMm }, samples };
}

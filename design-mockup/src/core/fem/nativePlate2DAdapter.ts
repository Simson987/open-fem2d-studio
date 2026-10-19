import type { Mesh } from './Mesh';
import type { INode } from './types';

export type NativePlateAnalysis = 'linear' | 'geometric' | 'material' | 'combined';
/** The sparse direct mixed CST/Q4 backend is currently validated for linear analysis only. */
export type NativeMixed2DLinearBackend = 'existing' | 'sparseDirect' | 'frontalWave';
export type NativeMaterialLaw =
  | { kind: 'elastic' }
  | { kind: 'steelBilinear'; yield_mpa: number; hardening_ratio: number }
  | { kind: 'concreteCracking'; tensile_mpa: number; residual_ratio: number };
export interface NativeModulusCurve {
  materialId: number;
  points: { strain: number; eMpa: number }[];
}
export interface NativeQuadPressure {
  quadId: number;
  /** Additional pressure at the four corners in the quad's node order, kN/m². */
  nodalPressureKnM2: [number, number, number, number];
}
export interface NativeEdgeLoad {
  quadId: number;
  /** Quad edge 0–3, from local node i to (i + 1) % 4. */
  edgeIndex: number;
  startKnPerM: number;
  endKnPerM: number;
}
export interface NativeReinforcementSpec {
  limitState: 'ultimate' | 'service';
  fckMpa: number;
  fctmMpa: number;
  gammaC: number;
  fydMpa: number;
  fywdMpa: number;
  esMpa: number;
  coverMm: number;
  barDiameterMm: number;
  leverArmMm?: number;
  topXMm2PerM: number;
  topYMm2PerM: number;
  bottomXMm2PerM: number;
  bottomYMm2PerM: number;
  shearMm2PerM2?: number;
  tanTheta?: number;
  alphaCc?: number;
  cRdc?: number;
  longTerm?: boolean;
  crackLimitMm?: number;
}

function nativeMembraneSupports(nodes: INode[]) {
  return nodes.filter(node => node.constraints.x || node.constraints.y
    || node.constraints.springX != null || node.constraints.springY != null).map(node => {
    const kx = node.constraints.springX;
    const ky = node.constraints.springY;
    if (node.constraints.springRot != null) {
      throw new Error(`Knoop ${node.id}: rotatieveren zijn geen vlakspanningsrandvoorwaarden.`);
    }
    for (const [axis, stiffness] of [['x', kx], ['y', ky]] as const) {
      if (stiffness != null && (!Number.isFinite(stiffness) || stiffness <= 0)) {
        throw new Error(`Knoop ${node.id}: de ${axis}-veerstijfheid moet eindig en positief zijn.`);
      }
    }
    return {
      nodeId: node.id,
      ux: node.constraints.x && kx == null,
      uy: node.constraints.y && ky == null,
      ...(kx == null ? {} : { kxKnPerM: kx / 1000 }),
      ...(ky == null ? {} : { kyKnPerM: ky / 1000 }),
    };
  });
}

/** Invoercontract van openaec-native-fem/native-plate2d: m, kN en MPa. */
export function buildNativePlate2DRequest(
  mesh: Mesh,
  analysis: NativePlateAnalysis = 'linear',
  laws: ReadonlyMap<number, NativeMaterialLaw> = new Map(),
  loadPath: readonly number[] = [],
  modulusCurves: readonly NativeModulusCurve[] = [],
) {
  if (mesh.beamElements.size > 0) {
    throw new Error('De native 2D-plaatkern ondersteunt nog geen gekoppelde staaf-plaatmodellen.');
  }
  const triangles = [...mesh.elements.values()].map(element => {
    if (element.nodeIds.length !== 3) {
      throw new Error(`Element ${element.id}: de native 2D-plaatkern ondersteunt alleen driehoeken.`);
    }
    return {
      id: element.id,
      nodeIds: element.nodeIds as [number, number, number],
      materialId: element.materialId,
      thicknessM: element.thickness,
    };
  });
  if (triangles.length === 0) throw new Error('De native 2D-plaatkern heeft minstens één driehoek nodig.');
  const usedNodes = new Set(triangles.flatMap(triangle => triangle.nodeIds));
  const nodes = [...mesh.nodes.values()].filter(node => usedNodes.has(node.id));
  for (const node of mesh.nodes.values()) {
    if (usedNodes.has(node.id)) continue;
    if (node.constraints.x || node.constraints.y || node.constraints.springX != null
        || node.constraints.springY != null || node.loads.fx || node.loads.fy) {
      throw new Error(`Knoop ${node.id} heeft een last of oplegging buiten het driehoeksrooster.`);
    }
  }
  const usedMaterials = new Set(triangles.map(triangle => triangle.materialId));
  const materials = [...usedMaterials].map(id => {
    const material = mesh.materials.get(id);
    if (!material) throw new Error(`Onbekend plaatmateriaal ${id}.`);
    if (material.orthotroop && laws.get(id) && laws.get(id)!.kind !== 'elastic') {
      throw new Error(`Materiaal ${id}: de native orthotrope driehoekskern vereist een elastische materiaalwet.`);
    }
    return { id, eMpa: material.E / 1e6, nu: material.nu, law: laws.get(id) ?? { kind: 'elastic' as const } };
  });
  const orthotropicMaterials = [...usedMaterials].flatMap(id => {
    const orthotropic = mesh.materials.get(id)?.orthotroop;
    if (!orthotropic) return [];
    return [{ materialId: id, e1Mpa: orthotropic.E1 / 1e6, e2Mpa: orthotropic.E2 / 1e6,
      nu12: orthotropic.nu12, g12Mpa: orthotropic.G12 / 1e6, angleRad: orthotropic.hoek }];
  });
  for (const node of nodes) {
    if (node.constraints.springRot != null) {
      throw new Error(`Knoop ${node.id}: rotatieveren zijn geen vlakspanningsrandvoorwaarden.`);
    }
    if (node.loads.moment || node.loads.fz) {
      throw new Error(`Knoop ${node.id}: momenten en dwarslasten zijn geen vlakspanningslasten.`);
    }
  }
  return {
    analysis,
    nodes: nodes.map(node => ({ id: node.id, x: node.x, y: node.y })),
    materials,
    orthotropicMaterials,
    modulusCurves: modulusCurves.map(curve => ({
      materialId: curve.materialId,
      points: curve.points.map(point => ({ strain: point.strain, eMpa: point.eMpa })),
    })),
    triangles,
    supports: nativeMembraneSupports(nodes),
    loads: nodes.filter(node => node.loads.fx || node.loads.fy).map(node => ({
      nodeId: node.id, fx: node.loads.fx / 1000, fy: node.loads.fy / 1000,
    })),
    loadPath: [...loadPath],
  };
}

/** Zet een bestaand driehoeksrooster om naar de Rust DKT-buigkern. */
export function buildNativePlateBendingRequest(
  mesh: Mesh,
  modulusCurves: readonly NativeModulusCurve[] = [],
  loadPath: readonly number[] = [],
  linearBackend: 'existing' | 'frontalWave' = 'existing',
  frontalMaxFrontDofs?: number,
) {
  if (linearBackend === 'frontalWave' && modulusCurves.length > 0) {
    throw new Error('De frontale DKT-oplosser ondersteunt alleen lineaire elasticiteit zonder E-rekcurve.');
  }
  if (mesh.beamElements.size > 0) {
    throw new Error('De native DKT-kern ondersteunt geen gekoppelde staaf-plaatmodellen.');
  }
  const triangles = [...mesh.elements.values()].map(element => {
    if (element.nodeIds.length !== 3) {
      throw new Error(`Element ${element.id}: de native DKT-kern ondersteunt alleen driehoeken.`);
    }
    return {
      id: element.id, nodeIds: element.nodeIds as [number, number, number],
      materialId: element.materialId, thicknessM: element.thickness,
    };
  });
  if (triangles.length === 0) throw new Error('De native DKT-kern heeft minstens één driehoek nodig.');
  const usedNodes = new Set(triangles.flatMap(triangle => triangle.nodeIds));
  const nodes = [...mesh.nodes.values()].filter(node => usedNodes.has(node.id));
  const materials = [...new Set(triangles.map(triangle => triangle.materialId))].map(id => {
    const material = mesh.materials.get(id);
    if (!material) throw new Error(`Onbekend plaatmateriaal ${id}.`);
    return { id, eMpa: material.E / 1e6, nu: material.nu };
  });
  const orthotropicMaterials = [...new Set(triangles.map(triangle => triangle.materialId))].flatMap(id => {
    const orthotropic = mesh.materials.get(id)?.orthotroop;
    if (!orthotropic) return [];
    return [{ materialId: id, e1Mpa: orthotropic.E1 / 1e6, e2Mpa: orthotropic.E2 / 1e6,
      nu12: orthotropic.nu12, g12Mpa: orthotropic.G12 / 1e6, angleRad: orthotropic.hoek }];
  });
  for (const node of mesh.nodes.values()) {
    if (!usedNodes.has(node.id)) {
      if (node.constraints.y || node.constraints.rotation || node.constraints.springY != null
          || node.constraints.springRot != null || node.loads.fz || node.loads.fy) {
        throw new Error(`Knoop ${node.id} heeft een dwarslast of oplegging buiten het DKT-rooster.`);
      }
      continue;
    }
    if (node.constraints.springX != null) {
      throw new Error(`Knoop ${node.id}: een x-veer werkt niet op een DKT-buigvrijheidsgraad.`);
    }
    if (node.loads.fx || node.loads.moment) {
      throw new Error(`Knoop ${node.id}: vlaklasten en éénassige momenten zijn geen DKT-invoer.`);
    }
  }
  return {
    nodes: nodes.map(node => ({ id: node.id, x: node.x, y: node.y })),
    materials,
    orthotropicMaterials,
    modulusCurves: modulusCurves.map(curve => ({
      materialId: curve.materialId,
      points: curve.points.map(point => ({ strain: point.strain, eMpa: point.eMpa })),
    })),
    loadPath: [...loadPath],
    linearBackend,
    ...(frontalMaxFrontDofs === undefined ? {} : { frontalMaxFrontDofs }),
    triangles,
    supports: nodes.filter(node => node.constraints.y || node.constraints.rotation
      || node.constraints.springY != null || node.constraints.springRot != null).map(node => ({
      nodeId: node.id,
      w: node.constraints.y && node.constraints.springY == null,
      thetaX: node.constraints.rotation && node.constraints.springRot == null,
      thetaY: node.constraints.rotation && node.constraints.springRot == null,
      ...(node.constraints.springY == null ? {} : { kwKnPerM: node.constraints.springY / 1000 }),
      ...(node.constraints.springRot == null ? {} : {
        kthetaXKnmPerRad: node.constraints.springRot / 1000,
        kthetaYKnmPerRad: node.constraints.springRot / 1000,
      }),
    })),
    loads: nodes.filter(node => (node.loads.fz ?? node.loads.fy) !== 0).map(node => ({
      nodeId: node.id,
      fz: (node.loads.fz ?? node.loads.fy) / 1000,
      mx: 0,
      my: 0,
    })),
  };
}

/** Zet het bestaande Quad4-rooster om naar de Rust-vierhoeksolver. */
export function buildNativeQuad2DRequest(
  mesh: Mesh,
  analysis: NativePlateAnalysis = 'linear',
  laws: ReadonlyMap<number, NativeMaterialLaw> = new Map(),
  loadPath: readonly number[] = [],
  modulusCurves: readonly NativeModulusCurve[] = [],
) {
  if (mesh.beamElements.size > 0) {
    throw new Error('De native Quad4-kern ondersteunt nog geen gekoppelde staaf-plaatmodellen.');
  }
  const quads = [...mesh.elements.values()].map(element => {
    if (element.nodeIds.length !== 4) {
      throw new Error(`Element ${element.id}: de native Quad4-kern ondersteunt alleen vierhoeken.`);
    }
    return { id: element.id, nodeIds: element.nodeIds as [number, number, number, number],
      materialId: element.materialId, thicknessM: element.thickness };
  });
  if (quads.length === 0) throw new Error('De native Quad4-kern heeft minstens één vierhoek nodig.');
  const usedNodes = new Set(quads.flatMap(quad => quad.nodeIds));
  const nodes = [...mesh.nodes.values()].filter(node => usedNodes.has(node.id));
  for (const node of mesh.nodes.values()) {
    if (usedNodes.has(node.id)) continue;
    if (node.constraints.x || node.constraints.y || node.constraints.springX != null
        || node.constraints.springY != null || node.loads.fx || node.loads.fy) {
      throw new Error(`Knoop ${node.id} heeft een last of oplegging buiten het vierhoeksrooster.`);
    }
  }
  const materials = [...new Set(quads.map(quad => quad.materialId))].map(id => {
    const material = mesh.materials.get(id);
    if (!material) throw new Error(`Onbekend plaatmateriaal ${id}.`);
    if (material.orthotroop && laws.get(id) && laws.get(id)!.kind !== 'elastic') {
      throw new Error(`Materiaal ${id}: de native orthotrope Quad4-kern vereist een elastische materiaalwet.`);
    }
    return { id, eMpa: material.E / 1e6, nu: material.nu, law: laws.get(id) ?? { kind: 'elastic' as const } };
  });
  const orthotropicMaterials = [...new Set(quads.map(quad => quad.materialId))].flatMap(id => {
    const material = mesh.materials.get(id);
    if (!material?.orthotroop) return [];
    const orthotropic = material.orthotroop;
    return [{ materialId: id, e1Mpa: orthotropic.E1 / 1e6, e2Mpa: orthotropic.E2 / 1e6,
      nu12: orthotropic.nu12, g12Mpa: orthotropic.G12 / 1e6, angleRad: orthotropic.hoek }];
  });
  for (const node of nodes) {
    if (node.constraints.springRot != null) {
      throw new Error(`Knoop ${node.id}: rotatieveren zijn geen vlakspanningsrandvoorwaarden.`);
    }
    if (node.loads.moment || node.loads.fz) {
      throw new Error(`Knoop ${node.id}: momenten en dwarslasten zijn geen vlakspanningslasten.`);
    }
  }
  return {
    analysis,
    nodes: nodes.map(node => ({ id: node.id, x: node.x, y: node.y })),
    materials,
    orthotropicMaterials,
    modulusCurves: modulusCurves.map(curve => ({
      materialId: curve.materialId,
      points: curve.points.map(point => ({ strain: point.strain, eMpa: point.eMpa })),
    })),
    quads,
    supports: nativeMembraneSupports(nodes),
    loads: nodes.filter(node => node.loads.fx || node.loads.fy).map(node => ({
      nodeId: node.id, fx: node.loads.fx / 1000, fy: node.loads.fy / 1000,
    })),
    loadPath: [...loadPath],
  };
}

/** Build a shared-node CST/Q4 request for linear, geometric, or material-nonlinear analysis. */
export function buildNativeMixed2DRequest(
  mesh: Mesh,
  analysis: NativePlateAnalysis = 'linear',
  laws: ReadonlyMap<number, NativeMaterialLaw> = new Map(),
  loadPath: readonly number[] = [],
  modulusCurves: readonly NativeModulusCurve[] = [],
  linearBackend?: NativeMixed2DLinearBackend,
) {
  if (linearBackend !== undefined && linearBackend !== 'existing' && analysis !== 'linear') {
    throw new Error(`De ${linearBackend}-kern voor gemengde CST/Q4-platen ondersteunt alleen lineaire analyse.`);
  }
  if (mesh.beamElements.size > 0) {
    throw new Error('De native gemengde vlakspanningskern ondersteunt geen gekoppelde staven.');
  }
  const triangles = [...mesh.elements.values()].filter(element => element.nodeIds.length === 3).map(element => ({
    id: element.id,
    nodeIds: element.nodeIds as [number, number, number],
    materialId: element.materialId,
    thicknessM: element.thickness,
  }));
  const quads = [...mesh.elements.values()].filter(element => element.nodeIds.length === 4).map(element => ({
    id: element.id,
    nodeIds: element.nodeIds as [number, number, number, number],
    materialId: element.materialId,
    thicknessM: element.thickness,
  }));
  if (!triangles.length || !quads.length
      || triangles.length + quads.length !== mesh.elements.size) {
    throw new Error('De native gemengde vlakspanningskern vereist uitsluitend CST- en Q4-elementen.');
  }
  const usedNodeIds = new Set([...triangles, ...quads].flatMap(element => element.nodeIds));
  const nodes = [...mesh.nodes.values()].filter(node => usedNodeIds.has(node.id));
  for (const node of mesh.nodes.values()) {
    if (usedNodeIds.has(node.id)) continue;
    if (node.constraints.x || node.constraints.y || node.constraints.springX != null
        || node.constraints.springY != null || node.constraints.springRot != null
        || node.loads.fx || node.loads.fy || node.loads.fz || node.loads.moment) {
      throw new Error(`Knoop ${node.id} heeft een last of oplegging buiten het gemengde plaatrooster.`);
    }
  }
  for (const node of nodes) {
    if (node.constraints.springRot != null) {
      throw new Error(`Knoop ${node.id}: rotatieveren zijn geen vlakspanningsrandvoorwaarden.`);
    }
    if (node.loads.moment || node.loads.fz) {
      throw new Error(`Knoop ${node.id}: momenten en dwarslasten zijn geen vlakspanningslasten.`);
    }
  }
  const materialIds = new Set([...triangles, ...quads].map(element => element.materialId));
  const materials = [...materialIds].map(id => {
    const material = mesh.materials.get(id);
    if (!material) throw new Error(`Onbekend plaatmateriaal ${id}.`);
    return { id, eMpa: material.E / 1e6, nu: material.nu, law: laws.get(id) ?? { kind: 'elastic' as const } };
  });
  const orthotropicMaterials = [...materialIds].flatMap(id => {
    const orthotropic = mesh.materials.get(id)?.orthotroop;
    if (!orthotropic) return [];
    return [{ materialId: id, e1Mpa: orthotropic.E1 / 1e6, e2Mpa: orthotropic.E2 / 1e6,
      nu12: orthotropic.nu12, g12Mpa: orthotropic.G12 / 1e6, angleRad: orthotropic.hoek }];
  });
  return {
    analysis,
    nodes: nodes.map(node => ({ id: node.id, x: node.x, y: node.y })),
    materials,
    orthotropicMaterials,
    modulusCurves: modulusCurves.map(curve => ({
      materialId: curve.materialId,
      points: curve.points.map(point => ({ strain: point.strain, eMpa: point.eMpa })),
    })),
    triangles,
    quads,
    supports: nativeMembraneSupports(nodes),
    loads: nodes.filter(node => node.loads.fx || node.loads.fy).map(node => ({
      nodeId: node.id, fx: node.loads.fx / 1000, fy: node.loads.fy / 1000,
    })),
    loadPath: [...loadPath],
    tolerance: 1e-8,
    maxIterations: 40,
    ...(linearBackend === undefined ? {} : { linearBackend }),
  };
}

/** Zet een vierhoeksrooster om naar het hybride Kirchhoff-buigelement. */
export function buildNativeHybridPlateRequest(
  mesh: Mesh,
  pressureKnM2 = 0,
  modulusCurves: readonly NativeModulusCurve[] = [],
  loadPath: readonly number[] = [],
  reinforcement?: NativeReinforcementSpec,
  quadPressures: readonly NativeQuadPressure[] = [],
  edgeLoads: readonly NativeEdgeLoad[] = [],
  linearBackend: 'existing' | 'frontalWave' = 'existing',
  frontalMaxFrontDofs?: number,
) {
  if (linearBackend === 'frontalWave' && modulusCurves.length > 0) {
    throw new Error('De frontale hybride plaatoplosser ondersteunt alleen lineaire elasticiteit zonder E-rekcurve.');
  }
  if (mesh.beamElements.size > 0) {
    throw new Error('De hybride plaatkern ondersteunt geen gekoppelde staaf-plaatmodellen.');
  }
  const quads = [...mesh.elements.values()].map(element => {
    if (element.nodeIds.length !== 4) {
      throw new Error(`Element ${element.id}: de hybride plaatkern vereist vierhoeken.`);
    }
    return { id: element.id, nodeIds: element.nodeIds as [number, number, number, number],
      materialId: element.materialId, thicknessM: element.thickness };
  });
  if (quads.length === 0) throw new Error('De hybride plaatkern heeft minstens één vierhoek nodig.');
  const quadIds = new Set(quads.map(quad => quad.id));
  const pressureIds = new Set<number>();
  for (const pressure of quadPressures) {
    if (!quadIds.has(pressure.quadId) || pressureIds.has(pressure.quadId)
      || !Array.isArray(pressure.nodalPressureKnM2)
      || pressure.nodalPressureKnM2.length !== 4
      || pressure.nodalPressureKnM2.some(value => !Number.isFinite(value))) {
      throw new Error(`Vierhoek ${pressure.quadId}: ongeldige of dubbele variabele plaatdruk.`);
    }
    pressureIds.add(pressure.quadId);
  }
  for (const load of edgeLoads) {
    if (!quadIds.has(load.quadId) || !Number.isInteger(load.edgeIndex) || load.edgeIndex < 0
      || load.edgeIndex > 3 || !Number.isFinite(load.startKnPerM) || !Number.isFinite(load.endKnPerM)) {
      throw new Error(`Vierhoek ${load.quadId}: ongeldige randlijnlast.`);
    }
  }
  const usedNodes = new Set(quads.flatMap(quad => quad.nodeIds));
  const nodes = [...mesh.nodes.values()].filter(node => usedNodes.has(node.id));
  for (const node of mesh.nodes.values()) {
    if (usedNodes.has(node.id)) continue;
    if (node.constraints.y || node.constraints.rotation || node.constraints.springY != null
        || node.constraints.springRot != null || node.loads.fz || node.loads.fy) {
      throw new Error(`Knoop ${node.id} heeft een buiglast of oplegging buiten het vierhoeksrooster.`);
    }
  }
  const materials = [...new Set(quads.map(quad => quad.materialId))].map(id => {
    const material = mesh.materials.get(id);
    if (!material) throw new Error(`Onbekend plaatmateriaal ${id}.`);
    return { id, eMpa: material.E / 1e6, nu: material.nu };
  });
  const orthotropicMaterials = [...new Set(quads.map(quad => quad.materialId))].flatMap(id => {
    const orthotropic = mesh.materials.get(id)?.orthotroop;
    if (!orthotropic) return [];
    return [{ materialId: id, e1Mpa: orthotropic.E1 / 1e6, e2Mpa: orthotropic.E2 / 1e6,
      nu12: orthotropic.nu12, g12Mpa: orthotropic.G12 / 1e6, angleRad: orthotropic.hoek }];
  });
  for (const node of nodes) {
    if (node.constraints.springX != null) {
      throw new Error(`Knoop ${node.id}: een x-veer werkt niet op een hybride buigvrijheidsgraad.`);
    }
    if (node.loads.fx || node.loads.moment) {
      throw new Error(`Knoop ${node.id}: vlaklasten en éénassige momenten zijn geen hybride-plaatinvoer.`);
    }
  }
  return {
    nodes: nodes.map(node => ({ id: node.id, x: node.x, y: node.y })),
    materials,
    orthotropicMaterials,
    quads,
    supports: nodes.filter(node => node.constraints.y || node.constraints.rotation
      || node.constraints.springY != null || node.constraints.springRot != null).map(node => ({
      nodeId: node.id,
      w: node.constraints.y && node.constraints.springY == null,
      thetaX: node.constraints.rotation && node.constraints.springRot == null,
      thetaY: node.constraints.rotation && node.constraints.springRot == null,
      ...(node.constraints.springY == null ? {} : { kwKnPerM: node.constraints.springY / 1000 }),
      ...(node.constraints.springRot == null ? {} : {
        kthetaXKnmPerRad: node.constraints.springRot / 1000,
        kthetaYKnmPerRad: node.constraints.springRot / 1000,
      }),
    })),
    loads: nodes.filter(node => (node.loads.fz ?? node.loads.fy) !== 0).map(node => ({
      nodeId: node.id, fz: (node.loads.fz ?? node.loads.fy) / 1000, mx: 0, my: 0,
    })),
    pressureKnM2,
    quadPressures: quadPressures.map(pressure => ({
      quadId: pressure.quadId,
      nodalPressureKnM2: [...pressure.nodalPressureKnM2],
    })),
    edgeLoads: edgeLoads.map(load => ({ ...load })),
    modulusCurves: modulusCurves.map(curve => ({
      materialId: curve.materialId,
      points: curve.points.map(point => ({ strain: point.strain, eMpa: point.eMpa })),
    })),
    loadPath: [...loadPath],
    reinforcement,
    linearBackend,
    ...(frontalMaxFrontDofs === undefined ? {} : { frontalMaxFrontDofs }),
  };
}

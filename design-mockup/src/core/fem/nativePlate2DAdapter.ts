import type { Mesh } from './Mesh';

export type NativePlateAnalysis = 'linear' | 'geometric' | 'material' | 'combined';
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
    if (node.constraints.x || node.constraints.y || node.loads.fx || node.loads.fy) {
      throw new Error(`Knoop ${node.id} heeft een last of oplegging buiten het driehoeksrooster.`);
    }
  }
  const usedMaterials = new Set(triangles.map(triangle => triangle.materialId));
  const materials = [...usedMaterials].map(id => {
    const material = mesh.materials.get(id);
    if (!material) throw new Error(`Onbekend plaatmateriaal ${id}.`);
    if (material.orthotroop) throw new Error(`Materiaal ${id}: orthotropie is nog niet ondersteund door de native 2D-plaatkern.`);
    return { id, eMpa: material.E / 1e6, nu: material.nu, law: laws.get(id) ?? { kind: 'elastic' as const } };
  });
  for (const node of nodes) {
    if (node.constraints.springX || node.constraints.springY || node.constraints.springRot) {
      throw new Error(`Knoop ${node.id}: veren zijn nog niet ondersteund door de native 2D-plaatkern.`);
    }
    if (node.loads.moment || node.loads.fz) {
      throw new Error(`Knoop ${node.id}: momenten en dwarslasten zijn geen vlakspanningslasten.`);
    }
  }
  return {
    analysis,
    nodes: nodes.map(node => ({ id: node.id, x: node.x, y: node.y })),
    materials,
    modulusCurves: modulusCurves.map(curve => ({
      materialId: curve.materialId,
      points: curve.points.map(point => ({ strain: point.strain, eMpa: point.eMpa })),
    })),
    triangles,
    supports: nodes.filter(node => node.constraints.x || node.constraints.y).map(node => ({
      nodeId: node.id, ux: node.constraints.x, uy: node.constraints.y,
    })),
    loads: nodes.filter(node => node.loads.fx || node.loads.fy).map(node => ({
      nodeId: node.id, fx: node.loads.fx / 1000, fy: node.loads.fy / 1000,
    })),
    loadPath: [...loadPath],
  };
}

/** Zet een bestaand driehoeksrooster om naar de lineaire Rust DKT-kern. */
export function buildNativePlateBendingRequest(mesh: Mesh) {
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
    if (material.orthotroop) throw new Error(`Materiaal ${id}: orthotropie is nog niet ondersteund door de native DKT-kern.`);
    return { id, eMpa: material.E / 1e6, nu: material.nu };
  });
  for (const node of mesh.nodes.values()) {
    if (!usedNodes.has(node.id)) {
      if (node.constraints.y || node.constraints.rotation || node.loads.fz || node.loads.fy) {
        throw new Error(`Knoop ${node.id} heeft een dwarslast of oplegging buiten het DKT-rooster.`);
      }
      continue;
    }
    if (node.constraints.springX != null || node.constraints.springY != null || node.constraints.springRot != null) {
      throw new Error(`Knoop ${node.id}: veren zijn nog niet ondersteund door de native DKT-kern.`);
    }
    if (node.loads.fx || node.loads.moment) {
      throw new Error(`Knoop ${node.id}: vlaklasten en éénassige momenten zijn geen DKT-invoer.`);
    }
  }
  return {
    nodes: nodes.map(node => ({ id: node.id, x: node.x, y: node.y })),
    materials,
    triangles,
    supports: nodes.filter(node => node.constraints.y || node.constraints.rotation).map(node => ({
      nodeId: node.id,
      w: node.constraints.y,
      thetaX: node.constraints.rotation,
      thetaY: node.constraints.rotation,
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
    if (node.constraints.x || node.constraints.y || node.loads.fx || node.loads.fy) {
      throw new Error(`Knoop ${node.id} heeft een last of oplegging buiten het vierhoeksrooster.`);
    }
  }
  const materials = [...new Set(quads.map(quad => quad.materialId))].map(id => {
    const material = mesh.materials.get(id);
    if (!material) throw new Error(`Onbekend plaatmateriaal ${id}.`);
    if (material.orthotroop) throw new Error(`Materiaal ${id}: orthotropie is nog niet ondersteund door de native Quad4-kern.`);
    return { id, eMpa: material.E / 1e6, nu: material.nu, law: laws.get(id) ?? { kind: 'elastic' as const } };
  });
  for (const node of nodes) {
    if (node.constraints.springX != null || node.constraints.springY != null || node.constraints.springRot != null) {
      throw new Error(`Knoop ${node.id}: veren zijn nog niet ondersteund door de native Quad4-kern.`);
    }
    if (node.loads.moment || node.loads.fz) {
      throw new Error(`Knoop ${node.id}: momenten en dwarslasten zijn geen vlakspanningslasten.`);
    }
  }
  return {
    analysis,
    nodes: nodes.map(node => ({ id: node.id, x: node.x, y: node.y })),
    materials,
    modulusCurves: modulusCurves.map(curve => ({
      materialId: curve.materialId,
      points: curve.points.map(point => ({ strain: point.strain, eMpa: point.eMpa })),
    })),
    quads,
    supports: nodes.filter(node => node.constraints.x || node.constraints.y).map(node => ({
      nodeId: node.id, ux: node.constraints.x, uy: node.constraints.y,
    })),
    loads: nodes.filter(node => node.loads.fx || node.loads.fy).map(node => ({
      nodeId: node.id, fx: node.loads.fx / 1000, fy: node.loads.fy / 1000,
    })),
    loadPath: [...loadPath],
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
) {
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
  const usedNodes = new Set(quads.flatMap(quad => quad.nodeIds));
  const nodes = [...mesh.nodes.values()].filter(node => usedNodes.has(node.id));
  for (const node of mesh.nodes.values()) {
    if (usedNodes.has(node.id)) continue;
    if (node.constraints.y || node.constraints.rotation || node.loads.fz || node.loads.fy) {
      throw new Error(`Knoop ${node.id} heeft een buiglast of oplegging buiten het vierhoeksrooster.`);
    }
  }
  const materials = [...new Set(quads.map(quad => quad.materialId))].map(id => {
    const material = mesh.materials.get(id);
    if (!material) throw new Error(`Onbekend plaatmateriaal ${id}.`);
    if (material.orthotroop) throw new Error(`Materiaal ${id}: orthotropie is nog niet ondersteund door de hybride plaatkern.`);
    return { id, eMpa: material.E / 1e6, nu: material.nu };
  });
  for (const node of nodes) {
    if (node.constraints.springX != null || node.constraints.springY != null || node.constraints.springRot != null) {
      throw new Error(`Knoop ${node.id}: veren zijn nog niet ondersteund door de hybride plaatkern.`);
    }
    if (node.loads.fx || node.loads.moment) {
      throw new Error(`Knoop ${node.id}: vlaklasten en éénassige momenten zijn geen hybride-plaatinvoer.`);
    }
  }
  return {
    nodes: nodes.map(node => ({ id: node.id, x: node.x, y: node.y })),
    materials,
    quads,
    supports: nodes.filter(node => node.constraints.y || node.constraints.rotation).map(node => ({
      nodeId: node.id, w: node.constraints.y,
      thetaX: node.constraints.rotation, thetaY: node.constraints.rotation,
    })),
    loads: nodes.filter(node => (node.loads.fz ?? node.loads.fy) !== 0).map(node => ({
      nodeId: node.id, fz: (node.loads.fz ?? node.loads.fy) / 1000, mx: 0, my: 0,
    })),
    pressureKnM2,
    quadPressures: quadPressures.map(pressure => ({
      quadId: pressure.quadId,
      nodalPressureKnM2: [...pressure.nodalPressureKnM2],
    })),
    modulusCurves: modulusCurves.map(curve => ({
      materialId: curve.materialId,
      points: curve.points.map(point => ({ strain: point.strain, eMpa: point.eMpa })),
    })),
    loadPath: [...loadPath],
    reinforcement,
  };
}

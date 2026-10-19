import { solveNativeFem, type NativeGeometricShellResult, type NativeHybridPlateResult,
  type NativeQuad2DResult, type NativeThreeLayerBatchInput, type NativeThreeLayerBatchResult,
  type NativeThreeLayerResult } from "../../lib/nativeFemClient";
import { CONCRETE_E_CM, NU_BETON, NU_STAAL, eVanMateriaal } from "../../lib/sectionResolver";
import { frame3DLoadCaseId, type Frame3DModel, type Frame3DNode } from "./frame3dModel";
import type { Frame3DAnalysisKind, Frame3DLoadSelection, Frame3DPlateBendingResult, Frame3DSolveResult } from "./frame3dSolver";

interface QuadMesh {
  nodes: { id: number; x: number; y: number }[];
  quads: { id: number; nodeIds: [number, number, number, number]; materialId: number; thicknessM: number }[];
  bottomNodeIds: number[]; rightNodeIds: number[]; topNodeIds: number[]; leftNodeIds: number[];
}

function validThreeLayerBatch(
  batch: NativeThreeLayerBatchResult,
  samples: NativeThreeLayerBatchInput["samples"],
): boolean {
  const cases = new Set(["both-directions", "x-only", "y-only", "compression-only"]);
  const validSkin = (skin: NativeThreeLayerResult["top"]) => {
    const numeric = [skin.requiredAsXmm2PerM, skin.requiredAsYmm2PerM,
      skin.concreteCompressionMpa, skin.compressionLimitMpa,
      skin.utilizationAsX, skin.utilizationAsY, skin.utilizationCompression];
    return numeric.every(Number.isFinite)
      && skin.requiredAsXmm2PerM >= 0 && skin.requiredAsYmm2PerM >= 0
      && skin.compressionLimitMpa > 0
      && skin.utilizationAsX >= 0 && skin.utilizationAsY >= 0
      && skin.utilizationCompression >= 0
      && cases.has(skin.reinforcementCase)
      && typeof skin.annexFBranch === "string";
  };
  const validNullableNonnegative = (value: number | null) =>
    value === null || (Number.isFinite(value) && value >= 0);
  if (!batch || typeof batch !== "object" || !Array.isArray(batch.results)
      || batch.checkedPoints !== samples.length
      || !["partial_check_passes", "partial_check_exceeded"].includes(batch.status)
      || batch.results.length !== samples.length) return false;
  if (batch.results.some((entry) => !entry || typeof entry.id !== "string" || !entry.result)) return false;
  const results = new Map(batch.results.map((entry) => [entry.id, entry]));
  if (results.size !== samples.length || samples.some((sample) => !results.has(sample.id))) return false;
  const statuses = batch.results.map((entry) => entry.result?.status);
  const expectedStatus = statuses.includes("partial_check_exceeded")
    ? "partial_check_exceeded" : "partial_check_passes";
  if (statuses.some((status) => status !== "partial_check_passes" && status !== "partial_check_exceeded")
      || batch.status !== expectedStatus) return false;
  return samples.every((sample) => {
    const entry = results.get(sample.id)!;
    const result = entry.result;
    const core = result?.core;
    if (!Array.isArray(entry.positionM) || entry.positionM.length !== 2
        || !result?.top || !result.bottom || !core || !Array.isArray(result.notAssessed)) return false;
    const numeric = [result?.leverArmMm, ...entry.positionM,
      ...(result?.top ? [result.top.requiredAsXmm2PerM, result.top.requiredAsYmm2PerM,
        result.top.concreteCompressionMpa, result.top.compressionLimitMpa,
        result.top.utilizationAsX, result.top.utilizationAsY, result.top.utilizationCompression] : []),
      ...(result?.bottom ? [result.bottom.requiredAsXmm2PerM, result.bottom.requiredAsYmm2PerM,
        result.bottom.concreteCompressionMpa, result.bottom.compressionLimitMpa,
        result.bottom.utilizationAsX, result.bottom.utilizationAsY, result.bottom.utilizationCompression] : []),
      ...(core ? [core.vxKnPerM, core.vyKnPerM, core.resultantKnPerM, core.directionDeg] : [])];
    return entry.positionM.length === 2 && entry.positionM.every(Number.isFinite)
      && entry.positionM.every((coordinate, index) => Math.abs(coordinate - sample.positionM[index]) <= 1e-10)
      && numeric.every((value) => value !== undefined && Number.isFinite(value))
      && result.leverArmMm > 0
      && validSkin(result.top) && validSkin(result.bottom)
      && core !== undefined && core.resultantKnPerM >= 0
      && [core.requiredShearMm2PerM2, core.diagonalStressMpa,
        core.utilizationShear, core.utilizationDiagonal].every(validNullableNonnegative)
      && (core.shearReinforcementRequired === null || typeof core.shearReinforcementRequired === "boolean")
      && Array.isArray(result.notAssessed) && result.notAssessed.every((item) => typeof item === "string");
  });
}

const q4GaussRoots = [-0.8611363115940526, -0.3399810435848563,
  0.3399810435848563, 0.8611363115940526] as const;

/** Independent Q4 isoparametric map for the 4 corners, centre and 4x4 rule. */
function expectedQ4ResultantPositions(
  nodeById: ReadonlyMap<number, QuadMesh["nodes"][number]>,
  nodeIds: QuadMesh["quads"][number]["nodeIds"],
): [number, number][] {
  const nodes = nodeIds.map((id) => nodeById.get(id));
  if (nodes.some((node) => !node)) throw new Error("Q4-element mist een meshknoop voor de resultaatpositiecontrole.");
  const naturalPoints: Array<[number, number]> = [
    [-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0],
  ];
  for (const xi of q4GaussRoots) for (const eta of q4GaussRoots) naturalPoints.push([xi, eta]);
  return naturalPoints.map(([xi, eta]) => {
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

function validGeometricShellResult(
  result: NativeGeometricShellResult,
  expectedNodeIds: readonly number[],
  expectedQuadIds: readonly number[],
): boolean {
  if (!result || typeof result !== "object"
      || !Number.isInteger(result.iterations) || result.iterations < 0
      || !Number.isFinite(result.relativeResidual) || result.relativeResidual < 0 || result.relativeResidual > 1e-7
      || !Array.isArray(result.nodes) || result.nodes.length !== expectedNodeIds.length
      || !Array.isArray(result.elements) || result.elements.length !== expectedQuadIds.length
      || result.nodes.some((node) => !node || typeof node !== "object")
      || result.elements.some((element) => !element || typeof element !== "object")) return false;
  const nodeIds = result.nodes.map((node) => node.nodeId);
  const quadIds = result.elements.map((element) => element.quadId);
  const nodeIdSet = new Set(nodeIds);
  const quadIdSet = new Set(quadIds);
  if (nodeIdSet.size !== nodeIds.length || quadIdSet.size !== quadIds.length
      || expectedNodeIds.some((id) => !nodeIdSet.has(id))
      || expectedQuadIds.some((id) => !quadIdSet.has(id))) return false;
  if (result.nodes.some((node) => ![
    node.uM, node.vM, node.wM, node.thetaXRad, node.thetaYRad,
    node.reactionFxKn, node.reactionFyKn, node.reactionFzKn,
    node.reactionMxKnm, node.reactionMyKnm,
  ].every(Number.isFinite))) return false;
  return result.elements.every((element) => {
    if (!Array.isArray(element.membraneKnPerM) || element.membraneKnPerM.length !== 3
        || !Array.isArray(element.momentKnmPerM) || element.momentKnmPerM.length !== 3
        || !Array.isArray(element.resultantSamples) || element.resultantSamples.length !== 21
        || !Array.isArray(element.materialPoints) || element.materialPoints.length !== 16
        || ![...element.membraneKnPerM, ...element.momentKnmPerM,
      element.effectiveEMpa, element.maxFibreStrain, element.maxCombinedStrain,
      element.maxEquivalentPlasticStrain, element.maxTensileDamage].every(Number.isFinite)
        || element.effectiveEMpa <= 0 || element.maxFibreStrain < 0
        || element.maxCombinedStrain < 0 || element.maxEquivalentPlasticStrain < 0
        || element.maxTensileDamage < 0 || element.maxTensileDamage > 1
        || element.resultantSamples.some((sample) => !sample || typeof sample !== "object"
          || !Array.isArray(sample.positionM) || sample.positionM.length !== 2
          || !Array.isArray(sample.membraneKnPerM) || sample.membraneKnPerM.length !== 3
          || !Array.isArray(sample.momentKnmPerM) || sample.momentKnmPerM.length !== 3
          || !Array.isArray(sample.shearKnPerM) || sample.shearKnPerM.length !== 2
          || ![...sample.positionM, ...sample.membraneKnPerM,
            ...sample.momentKnmPerM, ...sample.shearKnPerM].every(Number.isFinite))) return false;
    return element.materialPoints.every((point, index) => point && typeof point === "object"
      && Array.isArray(point.gaussIndex) && point.gaussIndex.length === 2
      && Array.isArray(point.positionM) && point.positionM.length === 2
      && Array.isArray(point.membraneStrain) && point.membraneStrain.length === 3
      && point.gaussIndex[0] === Math.floor(index / 4) && point.gaussIndex[1] === index % 4
      && [...point.positionM, ...point.membraneStrain, point.equivalentPlasticStrain,
        point.tensileDamage].every(Number.isFinite)
      && point.equivalentPlasticStrain >= 0 && point.tensileDamage >= 0 && point.tensileDamage <= 1);
  });
}

type Vector3 = [number, number, number];
const position = (node: Frame3DNode): Vector3 => [node.x, node.y, node.z];
const subtract = (a: Vector3, b: Vector3): Vector3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vector3, b: Vector3): Vector3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (vector: Vector3, factor: number): Vector3 => vector.map((value) => value * factor) as Vector3;
const dot = (a: Vector3, b: Vector3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (vector: Vector3) => Math.hypot(...vector);
const cross = (a: Vector3, b: Vector3): Vector3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function factor(selection: Frame3DLoadSelection | undefined, caseId: number): number {
  if (selection === undefined) return 1;
  if (typeof selection === "number") return selection === caseId ? 1 : 0;
  const value = selection.get(caseId) ?? 0;
  if (!Number.isFinite(value)) throw new Error(`Belastinggeval ${caseId} heeft een ongeldige combinatiefactor.`);
  return value;
}

function rectangle(model: Frame3DModel) {
  const plates = model.plates ?? [];
  if (plates.length !== 1 || model.beams.length > 0) {
    throw new Error("De huidige 3D-plaatroute ondersteunt één losse plaat zonder gekoppelde staven.");
  }
  const plate = plates[0];
  if (plate.nodeIds.length !== 4 || (plate.cornerRadiusM ?? 0) !== 0
      || plate.boundary?.some((edge) => edge.kind !== "line")) {
    throw new Error(`3D-plaat ${plate.id}: de Rust-route vereist een rechthoek zonder bogen of afrondingen.`);
  }
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const corners = plate.nodeIds.map((id) => byId.get(id));
  const vertexIds = new Set([...plate.nodeIds, ...(plate.openings ?? []).flatMap((opening) => opening.nodeIds)]);
  if (corners.some((node) => !node) || model.nodes.length !== vertexIds.size
      || model.nodes.some((node) => !vertexIds.has(node.id))) {
    throw new Error(`3D-plaat ${plate.id}: het model mag alleen de buiten- en openingshoekknopen bevatten.`);
  }
  const outer = corners as Frame3DNode[];
  const nodes = model.nodes;
  const origin = position(outer[0]);
  const firstEdge = subtract(position(outer[1]), origin);
  const secondEdge = subtract(position(outer[3]), origin);
  const width = norm(firstEdge), height = norm(secondEdge);
  const tolerance = Math.max(width, height, 1) * 1e-9;
  if (!(width > tolerance) || !(height > tolerance)
      || Math.abs(dot(firstEdge, secondEdge)) > tolerance * Math.max(width, height)
      || norm(subtract(position(outer[2]), add(origin, add(firstEdge, secondEdge)))) > tolerance) {
    throw new Error(`3D-plaat ${plate.id}: de vier knopen moeten een vlakke rechthoek vormen.`);
  }
  const ex = scale(firstEdge, 1 / width), ey = scale(secondEdge, 1 / height);
  const crossProduct = cross(ex, ey);
  const normal = scale(crossProduct, 1 / norm(crossProduct));
  const minClearance = 0.010;
  const openingRects = (plate.openings ?? []).map((opening) => {
    if (opening.nodeIds.length !== 4 || (opening.cornerRadiusM ?? 0) !== 0
        || opening.boundary?.some((edge) => edge.kind !== "line")) {
      throw new Error(`3D-opening ${opening.id}: de Rust-plaatroute vereist een rechthoek zonder bogen of afrondingen.`);
    }
    const points = opening.nodeIds.map((id) => {
      const node = byId.get(id);
      if (!node) throw new Error(`3D-opening ${opening.id}: onbekende hoekknop ${id}.`);
      const relative = subtract(position(node), origin);
      if (Math.abs(dot(relative, normal)) > tolerance) throw new Error(`3D-opening ${opening.id} ligt niet in het plaatvlak.`);
      return { u: dot(relative, ex), v: dot(relative, ey) };
    });
    const us = points.map((point) => point.u), vs = points.map((point) => point.v);
    const minU = Math.min(...us), maxU = Math.max(...us), minV = Math.min(...vs), maxV = Math.max(...vs);
    if (minU <= minClearance || maxU >= width - minClearance
        || minV <= minClearance || maxV >= height - minClearance
        || maxU - minU <= tolerance || maxV - minV <= tolerance
        || points.some((point) => (Math.abs(point.u - minU) > tolerance && Math.abs(point.u - maxU) > tolerance)
          || (Math.abs(point.v - minV) > tolerance && Math.abs(point.v - maxV) > tolerance))
        || new Set(points.map((point) => `${Math.round((point.u - minU) / (maxU - minU))},${Math.round((point.v - minV) / (maxV - minV))}`)).size !== 4) {
      throw new Error(`3D-opening ${opening.id}: alleen een volledig binnenliggende, lokaal assenrechte rechthoek wordt ondersteund.`);
    }
    return { id: opening.id, points, minU, maxU, minV, maxV,
      area: (maxU - minU) * (maxV - minV) };
  });
  for (let i = 0; i < openingRects.length; i++) for (let j = i + 1; j < openingRects.length; j++) {
    const a = openingRects[i], b = openingRects[j];
    if (a.minU <= b.maxU + minClearance && b.minU <= a.maxU + minClearance
        && a.minV <= b.maxV + minClearance && b.minV <= a.maxV + minClearance) {
      throw new Error(`3D-openingen ${a.id} en ${b.id} raken, overlappen of liggen te dicht bij elkaar.`);
    }
  }
  const outerArea = width * height;
  const area = outerArea - openingRects.reduce((sum, opening) => sum + opening.area, 0);
  if (!(area > tolerance * tolerance)) throw new Error(`3D-plaat ${plate.id}: de openingen laten geen dragend plaatoppervlak over.`);
  const weightedLocalCenter: [number, number] = [outerArea * width / 2, outerArea * height / 2];
  for (const opening of openingRects) {
    weightedLocalCenter[0] -= opening.area * (opening.minU + opening.maxU) / 2;
    weightedLocalCenter[1] -= opening.area * (opening.minV + opening.maxV) / 2;
  }
  const center = add(origin, add(scale(ex, weightedLocalCenter[0] / area), scale(ey, weightedLocalCenter[1] / area)));
  if (!plate.material) throw new Error(`3D-plaat ${plate.id}: wijs eerst een materiaal toe.`);
  const { E, soort } = eVanMateriaal(plate.material);
  if (!(E > 0) || !Number.isFinite(E) || soort === "hout") {
    throw new Error(`3D-plaat ${plate.id}: kies een herkend isotroop materiaal met een geldige E-modulus; hout vraagt een orthotrope plaatkern.`);
  }
  return { plate, nodes, origin, ex, ey, normal, center, area, openingRects, width, height, eMpa: E,
    nu: plate.material in CONCRETE_E_CM ? NU_BETON : NU_STAAL, tolerance };
}

async function meshForPlate(geometry: ReturnType<typeof rectangle>): Promise<QuadMesh> {
  const { plate, openingRects, width, height, area } = geometry;
  const maxCellSizeM = plate.maxCellSizeM ?? Math.min(width, height) / 4;
  if (!Number.isFinite(maxCellSizeM) || maxCellSizeM <= 0) {
    throw new Error(`3D-plaat ${plate.id}: de maximale Q4-celmaat moet eindig en positief zijn.`);
  }
  const mesh = await solveNativeFem<QuadMesh>("quadMesh", {
    originX: 0, originY: 0, widthM: width, heightM: height,
    maxCellSizeM, materialId: 1, thicknessM: plate.thicknessM,
    ...(openingRects.length ? { openings: openingRects.map((opening) => ({
      xM: opening.minU, yM: opening.minV,
      widthM: opening.maxU - opening.minU, heightM: opening.maxV - opening.minV,
    })) } : {}),
  });
  if (!mesh || typeof mesh !== "object" || !Array.isArray(mesh.nodes) || !Array.isArray(mesh.quads)
      || mesh.nodes.length > 20_000 / 3 || mesh.nodes.length < 4 || mesh.quads.length === 0
      || mesh.nodes.some((node) => !node || typeof node !== "object")
      || mesh.quads.some((quad) => !quad || typeof quad !== "object")) {
    throw new Error("De Rust-Q4-meshrespons is leeg, onvolledig of overschrijdt de grens van 20.000 vrijheidsgraden.");
  }
  const tolerance = Math.max(1e-10, Math.max(width, height) * 1e-10);
  const nodeIds = mesh.nodes.map((node) => node.id);
  const nodeIdSet = new Set(nodeIds);
  const nodeById = new Map(mesh.nodes.map((node) => [node.id, node]));
  const quadIds = mesh.quads.map((quad) => quad.id);
  const quadIdSet = new Set(quadIds);
  if (nodeIdSet.size !== mesh.nodes.length || nodeIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
      || mesh.nodes.some((node) => !Number.isFinite(node.x) || !Number.isFinite(node.y)
        || node.x < -tolerance || node.x > width + tolerance || node.y < -tolerance || node.y > height + tolerance)
      || quadIdSet.size !== mesh.quads.length || quadIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("De Rust-Q4-mesher gaf dubbele ID's of ongeldige knoopcoördinaten terug.");
  }
  const coordinateBuckets = new Map<string, QuadMesh["nodes"]>();
  for (const node of mesh.nodes) {
    const bucketX = Math.floor(node.x / tolerance);
    const bucketY = Math.floor(node.y / tolerance);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const neighbors = coordinateBuckets.get(`${bucketX + dx},${bucketY + dy}`) ?? [];
      if (neighbors.some((other) => Math.abs(other.x - node.x) <= tolerance
          && Math.abs(other.y - node.y) <= tolerance)) {
        throw new Error(`De Rust-Q4-mesher gaf meerdere knoop-ID's voor dezelfde plaatcoördinaat (${node.x}, ${node.y}).`);
      }
    }
    const key = `${bucketX},${bucketY}`;
    coordinateBuckets.set(key, [...(coordinateBuckets.get(key) ?? []), node]);
  }
  const cellBounds: Array<{ id: number; minX: number; maxX: number; minY: number; maxY: number }> = [];
  const edgeUses = new Map<string, Array<{ start: number; end: number; quadId: number }>>();
  for (const quad of mesh.quads) {
    if (!Array.isArray(quad.nodeIds) || quad.nodeIds.length !== 4
        || new Set(quad.nodeIds).size !== 4 || quad.nodeIds.some((id) => !nodeIdSet.has(id))
        || quad.materialId !== 1 || !Number.isFinite(quad.thicknessM)
        || Math.abs(quad.thicknessM - plate.thicknessM) > 1e-12 * Math.max(1, plate.thicknessM)) {
      throw new Error(`Rust-Q4-element ${quad.id}: ongeldige knoopreferenties of materiaalgegevens.`);
    }
    const corners = quad.nodeIds.map((id) => nodeById.get(id)!);
    const [a, b, c, d] = corners;
    const cellWidth = b.x - a.x;
    const cellHeight = d.y - a.y;
    if (!(cellWidth > tolerance) || !(cellHeight > tolerance)
        || Math.abs(a.y - b.y) > tolerance || Math.abs(b.x - c.x) > tolerance
        || Math.abs(c.y - d.y) > tolerance || Math.abs(d.x - a.x) > tolerance) {
      throw new Error(`Rust-Q4-element ${quad.id}: de mesh verwacht positief georiënteerde rechthoeken.`);
    }
    if (openingRects.some((opening) =>
      Math.min(b.x, opening.maxU) - Math.max(a.x, opening.minU) > tolerance
      && Math.min(d.y, opening.maxV) - Math.max(a.y, opening.minV) > tolerance)) {
      throw new Error(`Rust-Q4-element ${quad.id}: de mesh bevat een cel die een plaatopening overlapt.`);
    }
    if (cellWidth > maxCellSizeM + tolerance || cellHeight > maxCellSizeM + tolerance) {
      throw new Error(`Rust-Q4-element ${quad.id}: de mesher overschrijdt de gevraagde maximale celmaat.`);
    }
    cellBounds.push({ id: quad.id, minX: a.x, maxX: b.x, minY: a.y, maxY: d.y });
    for (let side = 0; side < 4; side++) {
      const start = quad.nodeIds[side];
      const end = quad.nodeIds[(side + 1) % 4];
      const key = start < end ? `${start}:${end}` : `${end}:${start}`;
      const uses = edgeUses.get(key) ?? [];
      uses.push({ start, end, quadId: quad.id });
      edgeUses.set(key, uses);
    }
  }
  const onDomainOrOpeningBoundary = (startId: number, endId: number) => {
    const start = nodeById.get(startId)!;
    const end = nodeById.get(endId)!;
    const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y);
    const horizontal = Math.abs(start.y - end.y) <= tolerance;
    const vertical = Math.abs(start.x - end.x) <= tolerance;
    if (!horizontal && !vertical) return false;
    if (horizontal && (Math.abs(start.y) <= tolerance || Math.abs(start.y - height) <= tolerance)) return true;
    if (vertical && (Math.abs(start.x) <= tolerance || Math.abs(start.x - width) <= tolerance)) return true;
    return openingRects.some((opening) => horizontal
      ? (Math.abs(start.y - opening.minV) <= tolerance || Math.abs(start.y - opening.maxV) <= tolerance)
        && minX >= opening.minU - tolerance && maxX <= opening.maxU + tolerance
      : (Math.abs(start.x - opening.minU) <= tolerance || Math.abs(start.x - opening.maxU) <= tolerance)
        && minY >= opening.minV - tolerance && maxY <= opening.maxV + tolerance);
  };
  for (const uses of edgeUses.values()) {
    if (uses.length === 2 && uses[0].start === uses[1].end && uses[0].end === uses[1].start) continue;
    if (uses.length === 1 && onDomainOrOpeningBoundary(uses[0].start, uses[0].end)) continue;
    const elementIds = uses.map((use) => use.quadId).join(", ");
    throw new Error(`De Rust-Q4-mesh is niet-conform bij elementrand(en) ${elementIds}: een rand moet gedeeld zijn of op de plaat-/openingscontour liggen.`);
  }
  const referencedNodeIds = new Set(mesh.quads.flatMap((quad) => quad.nodeIds));
  if (mesh.nodes.some((node) => !referencedNodeIds.has(node.id))) {
    throw new Error("De Rust-Q4-mesher gaf knopen terug die door geen enkel element worden gebruikt.");
  }
  const sweepCells = [...cellBounds].sort((first, second) => first.minX - second.minX);
  const activeCells: typeof cellBounds = [];
  for (const cell of sweepCells) {
    for (let index = activeCells.length - 1; index >= 0; index--) {
      if (activeCells[index].maxX - cell.minX <= tolerance) activeCells.splice(index, 1);
    }
    if (activeCells.some((other) =>
      Math.min(other.maxY, cell.maxY) - Math.max(other.minY, cell.minY) > tolerance)) {
      throw new Error(`Rust-Q4-element ${cell.id}: de mesh bevat cellen met overlappende oppervlakken.`);
    }
    activeCells.push(cell);
  }
  const edgeNodeIds = [mesh.bottomNodeIds, mesh.rightNodeIds, mesh.topNodeIds, mesh.leftNodeIds];
  const edgeCoordinates: Array<{ axis: "x" | "y"; fixed: number; min: number; max: number }> = [
    { axis: "x", fixed: 0, min: 0, max: width },
    { axis: "y", fixed: width, min: 0, max: height },
    { axis: "x", fixed: height, min: 0, max: width },
    { axis: "y", fixed: 0, min: 0, max: height },
  ];
  for (let edge = 0; edge < edgeNodeIds.length; edge++) {
    const ids = edgeNodeIds[edge];
    const { axis, fixed, min, max } = edgeCoordinates[edge];
    const onEdge = (node: QuadMesh["nodes"][number]) =>
      Math.abs(node[axis === "x" ? "y" : "x"] - fixed) <= tolerance;
    const expectedIds = mesh.nodes.filter(onEdge).map((node) => node.id).sort((a, b) => {
      const first = nodeById.get(a)!;
      const second = nodeById.get(b)!;
      return first[axis] - second[axis];
    });
    if (!Array.isArray(ids) || ids.length < 2 || new Set(ids).size !== ids.length
        || ids.some((id) => !nodeIdSet.has(id) || !onEdge(nodeById.get(id)!))
        || ids.length !== expectedIds.length || ids.some((id, index) => id !== expectedIds[index])
        || Math.abs(nodeById.get(ids[0])![axis] - min) > tolerance
        || Math.abs(nodeById.get(ids[ids.length - 1])![axis] - max) > tolerance) {
      throw new Error(`De Rust-Q4-mesher gaf een onvolledige of ongeldige randknoopreeks voor rand ${edge}.`);
    }
  }
  const quads = mesh.quads;
  const actualArea = quads.reduce((sum, quad) => {
    const a = nodeById.get(quad.nodeIds[0])!, b = nodeById.get(quad.nodeIds[1])!,
      d = nodeById.get(quad.nodeIds[3])!;
    return sum + (b.x - a.x) * (d.y - a.y);
  }, 0);
  if (Math.abs(actualArea - area) > 1e-8 * Math.max(1, area)) {
    throw new Error(`Het plaatrooster heeft oppervlak ${actualArea} m² in plaats van ${area} m².`);
  }
  return mesh;
}

function localSupport(
  support: NonNullable<Frame3DModel["supports"]>[number],
  ex: Vector3, ey: Vector3, normal: Vector3,
) {
  const translation = [support.ux, support.uy, support.uz];
  const rotation = [support.rx, support.ry, support.rz];
  const axes: Vector3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const aligned = (projection: number) => Math.abs(Math.abs(projection) - 1) < 1e-9;
  let w = translation.every(Boolean), thetaX = rotation.every(Boolean), thetaY = rotation.every(Boolean);
  // Two restrained global rotations span the plate tangent plane when the
  // remaining free axis is exactly the plate normal (e.g. Rx/Ry for XY).
  if (rotation.filter(Boolean).length === 2) {
    const freeAxis = rotation.findIndex((restrained) => !restrained);
    if (aligned(dot(axes[freeAxis], normal))) thetaX = thetaY = true;
  }
  if (!w) for (let axis = 0; axis < 3; axis++) {
    if (!translation[axis]) continue;
    const component = dot(axes[axis], normal);
    if (Math.abs(component) < 1e-9) continue; // in-plane restraint: no plate DOF
    if (!aligned(component)) throw new Error("Een scheve 3D-plaat vraagt voor een normale hoekoplegging alle drie globale translatie-assen.");
    w = true;
  }
  if (!(thetaX && thetaY)) for (let axis = 0; axis < 3; axis++) {
    if (!rotation[axis]) continue;
    const x = dot(axes[axis], ex), y = dot(axes[axis], ey);
    if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) continue; // drilling rotation
    if (aligned(x)) thetaX = true;
    else if (aligned(y)) thetaY = true;
    else throw new Error("Een scheve 3D-plaat vraagt voor rotatieinklemming alle drie globale rotatie-assen.");
  }
  return { w, thetaX, thetaY };
}

function localMembraneSupport(
  support: NonNullable<Frame3DModel["supports"]>[number], ex: Vector3, ey: Vector3,
) {
  const translation = [support.ux, support.uy, support.uz];
  const axes: Vector3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const aligned = (projection: number) => Math.abs(Math.abs(projection) - 1) < 1e-9;
  let ux = false, uy = false;
  for (let axis = 0; axis < 3; axis++) {
    if (!translation[axis]) continue;
    const x = dot(axes[axis], ex), y = dot(axes[axis], ey);
    if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) continue;
    if (aligned(x)) ux = true;
    else if (aligned(y)) uy = true;
    else if (translation.every(Boolean)) { ux = true; uy = true; break; }
    else throw new Error("Een scheve 3D-plaat vraagt voor membraanopleggingen alle drie globale translatie-assen.");
  }
  return { ux, uy };
}

function localSpringSupport(
  support: NonNullable<Frame3DModel["supports"]>[number],
  ex: Vector3, ey: Vector3, normal: Vector3,
) {
  const result: { kuKnPerM?: number; kvKnPerM?: number; kwKnPerM?: number;
    kthetaXKnmPerRad?: number; kthetaYKnmPerRad?: number } = {};
  const assign = (value: number | undefined, label: string, direction: Vector3,
    allowed: Array<[Vector3, keyof typeof result]>) => {
    if (value === undefined || value === 0) return;
    if (!(Number.isFinite(value) && value > 0)) throw new Error(`${label} moet een eindige positieve stijfheid hebben.`);
    const projections = allowed.map(([axis]) => Math.abs(dot(direction, axis)));
    const max = Math.max(...projections);
    const selected = projections.findIndex((projection) => Math.abs(projection - 1) < 1e-9);
    if (selected < 0 || Math.abs(max - 1) > 1e-9) {
      throw new Error(`${label} moet met een lokale translatie- of rotatie-as van de plaat samenvallen.`);
    }
    const field = allowed[selected][1];
    result[field] = (result[field] ?? 0) + value;
  };
  const globalAxes: Vector3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const translations = [support.springs?.kxKnPerM, support.springs?.kyKnPerM, support.springs?.kzKnPerM];
  translations.forEach((stiffness, index) => assign(stiffness, `Knoop ${support.nodeId} translatieveer`, globalAxes[index],
    [[ex, "kuKnPerM"], [ey, "kvKnPerM"], [normal, "kwKnPerM"]]));
  const rotations = [support.springs?.krxKnmPerRad, support.springs?.kryKnmPerRad, support.springs?.krzKnmPerRad];
  rotations.forEach((stiffness, index) => assign(stiffness, `Knoop ${support.nodeId} rotatieveer`, globalAxes[index],
    [[ex, "kthetaXKnmPerRad"], [ey, "kthetaYKnmPerRad"]]));
  return result;
}

function membraneStressAt(
  quad: NativeQuad2DResult["quads"][number],
  nodesById: ReadonlyMap<number, QuadMesh["nodes"][number]>, quadNodes: QuadMesh["quads"][number]["nodeIds"],
  x: number, y: number,
): [number, number, number] {
  const corners = quadNodes.map((id) => nodesById.get(id));
  if (corners.some((node) => !node) || quad.gaussPoints.length !== 4) {
    throw new Error(`Q4-element ${quad.quadId}: geen volledige membraanresultanten beschikbaar.`);
  }
  const xs = corners.map((node) => node!.x), ys = corners.map((node) => node!.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const xi = 2 * (x - minX) / (maxX - minX) - 1;
  const eta = 2 * (y - minY) / (maxY - minY) - 1;
  const g = 1 / Math.sqrt(3);
  const basis = [(g - xi) / (2 * g), (g + xi) / (2 * g)];
  const basisEta = [(g - eta) / (2 * g), (g + eta) / (2 * g)];
  const gaussLocations: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const stress: [number, number, number] = [0, 0, 0];
  for (let point = 0; point < 4; point++) {
    const [ix, iy] = gaussLocations[point];
    const weight = basis[ix] * basisEta[iy];
    for (let component = 0; component < 3; component++) {
      stress[component] += quad.gaussPoints[point].stressMpa[component] * weight;
    }
  }
  return stress;
}

function balance(
  pressure: Vector3, area: number, center: Vector3,
  loads: Array<{ point: Vector3; force: Vector3; moment: Vector3 }>,
  reactions: Array<{ point: Vector3; force: Vector3; moment: Vector3 }>,
): NonNullable<Frame3DSolveResult["forceBalance"]> {
  const applied = scale(pressure, area);
  const appliedMoment = cross(center, applied);
  for (const load of loads) {
    const lever = cross(load.point, load.force);
    for (let axis = 0; axis < 3; axis++) {
      applied[axis] += load.force[axis];
      appliedMoment[axis] += lever[axis] + load.moment[axis];
    }
  }
  const scaleKn = Math.max(1, ...applied.map(Math.abs));
  const scaleKnm = Math.max(1, ...appliedMoment.map(Math.abs));
  const imbalanceKn: Vector3 = [...applied];
  const momentImbalanceKnm: Vector3 = [...appliedMoment];
  for (const reaction of reactions) {
    const lever = cross(reaction.point, reaction.force);
    for (let axis = 0; axis < 3; axis++) {
      imbalanceKn[axis] += reaction.force[axis];
      momentImbalanceKnm[axis] += lever[axis] + reaction.moment[axis];
    }
  }
  const maxImbalanceKn = Math.max(...imbalanceKn.map(Math.abs));
  const maxMomentImbalanceKnm = Math.max(...momentImbalanceKnm.map(Math.abs));
  const toleranceKn = 1e-5 * scaleKn, momentToleranceKnm = 1e-5 * scaleKnm;
  return { imbalanceKn, maxImbalanceKn, toleranceKn, momentImbalanceKnm,
    maxMomentImbalanceKnm, momentToleranceKnm,
    ok: maxImbalanceKn <= toleranceKn && maxMomentImbalanceKnm <= momentToleranceKnm };
}

/** First app route for the native Blaauwendraad-inspired hybrid Q4 bending element. */
export async function solveFrame3DPlate(
  model: Frame3DModel, selection: Frame3DLoadSelection | undefined,
  analysis: Extract<Frame3DAnalysisKind, "linear" | "p-delta" | "material">,
): Promise<Frame3DSolveResult> {
  const geometry = rectangle(model);
  const { plate, nodes, origin, ex, ey, normal, center, area, eMpa, nu, tolerance } = geometry;
  if (plate.reinforcement && !(plate.material && plate.material in CONCRETE_E_CM)) {
    throw new Error(`3D-plaat ${plate.id}: de wapenings- en scheurtoets vraagt een herkende betonklasse.`);
  }
  if (model.materialLoadPath !== undefined && (!Array.isArray(model.materialLoadPath)
      || model.materialLoadPath.length === 0 || model.materialLoadPath.length > 100
      || model.materialLoadPath.some((value) => !Number.isFinite(value)))) {
    throw new Error("Het FNL-lastpad moet 1–100 eindige lastfactoren bevatten.");
  }
  const useSecantModulus = analysis === "material"
    || (analysis === "p-delta" && (plate.modulusCurve?.length ?? 0) > 0);
  const useConstitutiveLaw = analysis === "p-delta" && plate.nonlinearLaw !== undefined;
  if (useSecantModulus && useConstitutiveLaw) {
    throw new Error(`3D-plaat ${plate.id}: kies voor deze proef óf de secant-E-rekcurve óf één materiaalwet; de combinatie is nog niet gevalideerd.`);
  }
  if (useSecantModulus && (!plate.modulusCurve || plate.modulusCurve.length < 2)) {
    throw new Error(`3D-plaat ${plate.id}: stel voor FNL een expliciete E-rekcurve in.`);
  }
  if (useSecantModulus && Math.abs(plate.modulusCurve![0].eMpa - eMpa) > eMpa * 1e-10) {
    throw new Error(`3D-plaat ${plate.id}: de E-rekcurve moet bij rek 0 beginnen met de materiaaleigen E = ${eMpa} MPa.`);
  }
  const useMaterialPath = useSecantModulus || useConstitutiveLaw;
  const loadPath = useMaterialPath ? model.materialLoadPath ?? [1] : [];
  if ((model.memberLoads?.length ?? 0) || (model.memberPointLoads?.length ?? 0)
      || (model.thermalLoads?.length ?? 0)) {
    throw new Error("De losse 3D-plaatroute ondersteunt geen staaflasten of temperatuur.");
  }
  for (const support of model.supports ?? []) {
    if (!nodes.some((node) => node.id === support.nodeId)
        || Object.values(support.prescribed ?? {}).some((value) => value !== 0)) {
      throw new Error("De 3D-plaatroute ondersteunt alleen buiten- en openingshoekopleggingen zonder opgelegde verplaatsingen.");
    }
    if (Object.values(support.springs ?? {}).some((value) => !Number.isFinite(value) || value < 0)) {
      throw new Error(`Knoop ${support.nodeId}: veerstijfheden moeten eindig en niet-negatief zijn.`);
    }
  }
  const localSupports = (model.supports ?? []).map((support) => ({
    nodeId: support.nodeId, ...localSupport(support, ex, ey, normal),
  }));
  const nodalLoads = (model.loads ?? []).flatMap((load) => {
    const loadFactor = factor(selection, frame3DLoadCaseId(load));
    if (loadFactor === 0) return [];
    const force: Vector3 = [load.fx * loadFactor, load.fy * loadFactor, load.fz * loadFactor];
    const moment: Vector3 = [load.mx * loadFactor, load.my * loadFactor, load.mz * loadFactor];
    if (!nodes.some((node) => node.id === load.nodeId)
        || Math.abs(dot(moment, normal)) > 1e-9 * Math.max(1, norm(moment))) {
      throw new Error("De 3D-plaat ondersteunt op buiten- en openingshoekknopen alleen knooplasten en momenten om de twee plaatassen.");
    }
    return [{ nodeId: load.nodeId, force, moment,
      normalForce: dot(force, normal), localFx: dot(force, ex), localFy: dot(force, ey),
      localMx: -dot(moment, ex), localMy: -dot(moment, ey) }];
  });
  const inPlaneNodalLoads = nodalLoads.filter((load) => Math.abs(load.localFx) + Math.abs(load.localFy)
    > 1e-9 * Math.max(1, norm(load.force)));
  if (inPlaneNodalLoads.length > 0 && !plate.threeLayer && analysis !== "p-delta") {
    throw new Error("In-vlakse knooplasten vragen een ingestelde drielagencontrole om membraanresultanten te berekenen.");
  }
  const surfaceLoads = (model.surfaceLoads ?? []).flatMap((load) => {
    const loadFactor = factor(selection, frame3DLoadCaseId(load));
    if (loadFactor === 0) return [];
    const pressure: Vector3 = [load.qx * loadFactor, load.qy * loadFactor, load.qz * loadFactor];
    if (load.plateId !== plate.id) {
      throw new Error("De 3D-plaatroute kan alleen oppervlaktebelastingen op de berekende plaat verwerken.");
    }
    const inPlane = Math.abs(dot(pressure, ex)) + Math.abs(dot(pressure, ey)) > 1e-9 * Math.max(1, norm(pressure));
    if (inPlane && !plate.threeLayer && analysis !== "p-delta") {
      throw new Error("In-vlakse oppervlaktebelastingen vragen een ingestelde drielagencontrole om membraanresultanten te berekenen.");
    }
    return [dot(pressure, normal)];
  });
  const inPlaneSurfaceLoads = (model.surfaceLoads ?? []).flatMap((load) => {
    const loadFactor = factor(selection, frame3DLoadCaseId(load));
    if (loadFactor === 0) return [];
    const pressure: Vector3 = [load.qx * loadFactor, load.qy * loadFactor, load.qz * loadFactor];
    return [{ x: dot(pressure, ex), y: dot(pressure, ey) }];
  });
  const activeEdgeLoads = (model.plateEdgeLoads ?? []).flatMap((load) => {
    const loadFactor = factor(selection, frame3DLoadCaseId(load));
    if (loadFactor === 0) return [];
    if (load.plateId !== plate.id || !Number.isSafeInteger(load.edgeIndex) || load.edgeIndex < 0 || load.edgeIndex > 3) {
      throw new Error("De 3D-buigplaat kan alleen randlijnlasten op de berekende plaat verwerken.");
    }
    return [{ load, startKnPerM: load.startKnPerM * loadFactor, endKnPerM: load.endKnPerM * loadFactor }];
  });
  if (nodalLoads.length === 0 && surfaceLoads.length === 0 && activeEdgeLoads.length === 0) {
    throw new Error("Dit belastinggeval bevat geen normale 3D-plaatbelasting.");
  }
  const mesh = await meshForPlate(geometry);
  if (mesh.nodes.length < 4 || mesh.quads.length < 1) throw new Error("De plaatmesher gaf een leeg rooster terug.");
  const edgeNodeIds = [mesh.bottomNodeIds, mesh.rightNodeIds, mesh.topNodeIds, mesh.leftNodeIds];
  const meshNodeById = new Map(mesh.nodes.map((node) => [node.id, node]));
  const expectedResultantPositions = new Map(mesh.quads.map((quad) => [quad.id,
    expectedQ4ResultantPositions(meshNodeById, quad.nodeIds)]));
  const positionToleranceM = Math.max(1e-9, Math.max(geometry.width, geometry.height) * 1e-9);
  const vertexMeshId = new Map(nodes.map((vertex) => {
    const relative = subtract(position(vertex), origin);
    const u = dot(relative, ex), v = dot(relative, ey);
    const found = mesh.nodes.find((node) => Math.abs(node.x - u) <= tolerance
      && Math.abs(node.y - v) <= tolerance);
    if (!found) throw new Error(`Plaat-hoek- of openingsknoop ${vertex.id} ontbreekt in het rekenrooster.`);
    return [vertex.id, found.id] as const;
  }));
  const membraneLoadByNode = new Map(mesh.nodes.map((node) => [node.id, { fx: 0, fy: 0 }]));
  for (const load of inPlaneNodalLoads) {
    const nodeId = vertexMeshId.get(load.nodeId)!;
    const nodal = membraneLoadByNode.get(nodeId)!;
    nodal.fx += load.localFx;
    nodal.fy += load.localFy;
  }
  const surfaceQx = inPlaneSurfaceLoads.reduce((sum, load) => sum + load.x, 0);
  const surfaceQy = inPlaneSurfaceLoads.reduce((sum, load) => sum + load.y, 0);
  const equivalentMembraneSurfaceLoads: Array<{ point: Vector3; force: Vector3; moment: Vector3 }> = [];
  if (Math.abs(surfaceQx) + Math.abs(surfaceQy) > 0) {
    for (const quad of mesh.quads) {
      const elementNodes = quad.nodeIds.map((id) => meshNodeById.get(id)!);
      const width = elementNodes[1].x - elementNodes[0].x;
      const height = elementNodes[3].y - elementNodes[0].y;
      const elementArea = width * height;
      if (!(Number.isFinite(elementArea) && elementArea > 0)) {
        throw new Error(`Plaatroosterelement ${quad.id}: ongeldige oppervlakte voor membraanbelasting.`);
      }
      const nodalFx = surfaceQx * elementArea / 4;
      const nodalFy = surfaceQy * elementArea / 4;
      for (const node of elementNodes) {
        const load = membraneLoadByNode.get(node.id)!;
        load.fx += nodalFx;
        load.fy += nodalFy;
      }
      const localCenter = [elementNodes.reduce((sum, node) => sum + node.x, 0) / 4,
        elementNodes.reduce((sum, node) => sum + node.y, 0) / 4] as const;
      const point = add(origin, add(scale(ex, localCenter[0]), scale(ey, localCenter[1])));
      const force = add(scale(ex, surfaceQx * elementArea), scale(ey, surfaceQy * elementArea));
      equivalentMembraneSurfaceLoads.push({ point, force, moment: [0, 0, 0] });
    }
  }
  const hasInPlaneLoads = [...membraneLoadByNode.values()].some((load) => Math.abs(load.fx) + Math.abs(load.fy) > 1e-12);
  const meshEdgeLoads: Array<{ quadId: number; edgeIndex: number; startKnPerM: number; endKnPerM: number }> = [];
  const equivalentEdgeLoads: Array<{ point: Vector3; force: Vector3; moment: Vector3 }> = [];
  const vertexByIdForEdges = new Map(nodes.map((node) => [node.id, node]));
  for (const { load, startKnPerM, endKnPerM } of activeEdgeLoads) {
    const startNode = vertexByIdForEdges.get(plate.nodeIds[load.edgeIndex]);
    const endNode = vertexByIdForEdges.get(plate.nodeIds[(load.edgeIndex + 1) % 4]);
    if (!startNode || !endNode) throw new Error(`Plaatrandlast ${load.id} verwijst naar een ontbrekende hoekknoop.`);
    const startGlobal = position(startNode), endGlobal = position(endNode);
    const startRelative = subtract(startGlobal, origin), endRelative = subtract(endGlobal, origin);
    const a: [number, number] = [dot(startRelative, ex), dot(startRelative, ey)];
    const b: [number, number] = [dot(endRelative, ex), dot(endRelative, ey)];
    const du = b[0] - a[0], dv = b[1] - a[1], length2 = du * du + dv * dv;
    const length = Math.sqrt(length2);
    let segments = 0;
    for (const quad of mesh.quads) for (let edgeIndex = 0; edgeIndex < 4; edgeIndex++) {
      const firstId = quad.nodeIds[edgeIndex], secondId = quad.nodeIds[(edgeIndex + 1) % 4];
      const first = meshNodeById.get(firstId)!, second = meshNodeById.get(secondId)!;
      const projection = (point: { x: number; y: number }) => ((point.x - a[0]) * du + (point.y - a[1]) * dv) / length2;
      const t0 = projection(first), t1 = projection(second);
      const distanceToSide = (point: { x: number; y: number }) => Math.abs((point.x - a[0]) * dv - (point.y - a[1]) * du) / length;
      if (t0 < -1e-9 || t0 > 1 + 1e-9 || t1 < -1e-9 || t1 > 1 + 1e-9
          || distanceToSide(first) > tolerance || distanceToSide(second) > tolerance) continue;
      const qAt = (t: number) => startKnPerM + (endKnPerM - startKnPerM) * Math.max(0, Math.min(1, t));
      const q0 = qAt(t0), q1 = qAt(t1);
      meshEdgeLoads.push({ quadId: quad.id, edgeIndex, startKnPerM: q0, endKnPerM: q1 });
      const p0 = add(origin, add(scale(ex, first.x), scale(ey, first.y)));
      const p1 = add(origin, add(scale(ex, second.x), scale(ey, second.y)));
      const segmentLength = norm(subtract(p1, p0));
      const resultant = segmentLength * (q0 + q1) / 2;
      const firstMoment = segmentLength * (q0 / 6 + q1 / 3);
      const force = scale(normal, resultant);
      const moment = add(scale(cross(p0, normal), resultant), scale(cross(subtract(p1, p0), normal), firstMoment));
      equivalentEdgeLoads.push({ point: [0, 0, 0], force, moment });
      segments++;
    }
    if (segments === 0) throw new Error(`Plaatrandlast ${load.id}: de gekozen rand valt niet samen met de plaatmesh.`);
  }
  const hasOutOfPlaneLoads = nodalLoads.some((load) => Math.abs(load.normalForce)
      + Math.abs(load.localMx) + Math.abs(load.localMy) > 1e-12)
    || surfaceLoads.some((pressure) => Math.abs(pressure) > 1e-12)
    || meshEdgeLoads.some((load) => Math.abs(load.startKnPerM) + Math.abs(load.endKnPerM) > 1e-12);
  type BendingSupport = { nodeId: number; w: boolean; thetaX: boolean; thetaY: boolean;
    kwKnPerM?: number; kthetaXKnmPerRad?: number; kthetaYKnmPerRad?: number };
  const supportByMeshId = new Map<number, BendingSupport>();
  const addStiffness = (a: number | undefined, b: number | undefined) => {
    const value = (a ?? 0) + (b ?? 0);
    return value > 0 ? value : undefined;
  };
  const mergeSupport = (nodeId: number, w: boolean, thetaX: boolean, thetaY: boolean,
    springs: ReturnType<typeof localSpringSupport> = {}) => {
    if (!meshNodeById.has(nodeId)) throw new Error(`Plaat-randroosterknoop ${nodeId} ontbreekt.`);
    if (!(w || thetaX || thetaY || springs.kwKnPerM || springs.kthetaXKnmPerRad || springs.kthetaYKnmPerRad)) return;
    const current = supportByMeshId.get(nodeId);
    supportByMeshId.set(nodeId, { nodeId, w: w || (current?.w ?? false),
      thetaX: thetaX || (current?.thetaX ?? false), thetaY: thetaY || (current?.thetaY ?? false),
      kwKnPerM: addStiffness(current?.kwKnPerM, springs.kwKnPerM),
      kthetaXKnmPerRad: addStiffness(current?.kthetaXKnmPerRad, springs.kthetaXKnmPerRad),
      kthetaYKnmPerRad: addStiffness(current?.kthetaYKnmPerRad, springs.kthetaYKnmPerRad) });
  };
  for (const support of model.supports ?? []) {
    const local = localSupports.find((item) => item.nodeId === support.nodeId)!;
    mergeSupport(vertexMeshId.get(support.nodeId)!, local.w, local.thetaX, local.thetaY,
      localSpringSupport(support, ex, ey, normal));
  }
  for (let edge = 0; edge < 4; edge++) {
    const kind = plate.edgeSupports?.[edge] ?? "free";
    if (kind === "free") continue;
    for (const nodeId of edgeNodeIds[edge]) mergeSupport(nodeId, true,
      kind === "clamped", kind === "clamped");
  }
  type MembraneSupport = { nodeId: number; ux: boolean; uy: boolean; kxKnPerM?: number; kyKnPerM?: number };
  const membraneSupportByMeshId = new Map<number, MembraneSupport>();
  let membrane: NativeQuad2DResult | undefined;
  let geometricShell: NativeGeometricShellResult | undefined;
  if (hasInPlaneLoads || analysis === "p-delta") {
    for (const support of model.supports ?? []) {
      const nodeId = vertexMeshId.get(support.nodeId)!;
      const local = localMembraneSupport(support, ex, ey);
      const localSpring = localSpringSupport(support, ex, ey, normal);
      if (!local.ux && !local.uy && !localSpring.kuKnPerM && !localSpring.kvKnPerM) continue;
      const current = membraneSupportByMeshId.get(nodeId);
      membraneSupportByMeshId.set(nodeId, { nodeId, ux: local.ux || (current?.ux ?? false),
        uy: local.uy || (current?.uy ?? false),
        kxKnPerM: addStiffness(current?.kxKnPerM, localSpring.kuKnPerM),
        kyKnPerM: addStiffness(current?.kyKnPerM, localSpring.kvKnPerM) });
    }
  }
  if (hasInPlaneLoads && analysis !== "p-delta") {
    membrane = await solveNativeFem<NativeQuad2DResult>("quad2d", {
      analysis: analysis === "material" ? "material" : "linear",
      nodes: mesh.nodes,
      materials: [{ id: 1, eMpa, nu }],
      quads: mesh.quads.map((quad) => ({ id: quad.id, nodeIds: quad.nodeIds,
        materialId: quad.materialId, thicknessM: quad.thicknessM })),
      supports: [...membraneSupportByMeshId.values()],
      loads: [...membraneLoadByNode].filter(([, load]) => Math.abs(load.fx) + Math.abs(load.fy) > 1e-12)
        .map(([nodeId, load]) => ({ nodeId, fx: load.fx, fy: load.fy })),
      ...(analysis === "material" ? {
        modulusCurves: [{ materialId: 1, points: plate.modulusCurve!.map(({ strain, eMpa: modulus }) => ({ strain, eMpa: modulus })) }],
        loadPath, maxIterations: 50, tolerance: 1e-7,
      } : {}),
    });
    if (membrane.nodes.length !== mesh.nodes.length || membrane.quads.length !== mesh.quads.length
        || !Number.isFinite(membrane.relativeResidual) || membrane.relativeResidual < 0 || membrane.relativeResidual > 1e-7
        || membrane.quads.some((quad) => ![...quad.averageStressMpa,
          ...quad.gaussPoints.flatMap((point) => point.stressMpa)].every(Number.isFinite))) {
      throw new Error(`Plaat ${plate.id}: de Rust Q4-membraanberekening gaf geen volledig resultaat met voldoende kleine restkracht.`);
    }
  }
  const bendingInput = {
    nodes: mesh.nodes, quads: mesh.quads, materials: [{ id: 1, eMpa, nu }],
    supports: [...supportByMeshId.values()],
    loads: nodalLoads.map((load) => ({ nodeId: vertexMeshId.get(load.nodeId),
      // The plate's thetaX=-dw/dy and thetaY=dw/dx are the negatives of
      // physical 3D rotations about the local plate X and Y axes.
      fz: load.normalForce, mx: load.localMx, my: load.localMy })),
    pressureKnM2: surfaceLoads.reduce((sum, pressure) => sum + pressure, 0),
    ...(meshEdgeLoads.length > 0 ? { edgeLoads: meshEdgeLoads } : {}),
    ...(plate.reinforcement ? { reinforcement: plate.reinforcement } : {}),
    ...(useSecantModulus ? { modulusCurves: [{ materialId: 1, points: plate.modulusCurve }] } : {}),
    ...(useMaterialPath ? { loadPath, maxIterations: 50, tolerance: 1e-7 } : {}),
  };
  let native: NativeHybridPlateResult;
  let frontalRecoveryReason: string | undefined;
  if (analysis === "p-delta") {
    geometricShell = await solveNativeFem<NativeGeometricShellResult>("geometricShell", {
      bending: bendingInput,
      analysis: plate.nonlinearLaw ? "combined" : "geometric",
      materialLaws: plate.nonlinearLaw ? { [1]: plate.nonlinearLaw } : {},
      membraneSupports: [...membraneSupportByMeshId.values()].map((support) => ({
        nodeId: support.nodeId, u: support.ux, v: support.uy,
        ...(support.kxKnPerM ? { kuKnPerM: support.kxKnPerM } : {}),
        ...(support.kyKnPerM ? { kvKnPerM: support.kyKnPerM } : {}),
      })),
      membraneLoads: [...membraneLoadByNode]
        .filter(([, load]) => Math.abs(load.fx) + Math.abs(load.fy) > 1e-12)
        .map(([nodeId, load]) => ({ nodeId, fxKn: load.fx, fyKn: load.fy })),
    });
    if (!validGeometricShellResult(geometricShell, mesh.nodes.map((node) => node.id),
      mesh.quads.map((quad) => quad.id))) {
      throw new Error(`Plaat ${plate.id}: de Rust-shell gaf onvolledige, niet-eindige of ongeldige meshresultaten terug.`);
    }
    native = {
      nodes: geometricShell.nodes.map((node) => ({
        nodeId: node.nodeId, wM: node.wM, thetaXRad: node.thetaXRad, thetaYRad: node.thetaYRad,
        reactionFzKn: node.reactionFzKn, reactionMxKnm: node.reactionMxKnm, reactionMyKnm: node.reactionMyKnm,
      })),
      elements: geometricShell.elements.map((element) => ({
        quadId: element.quadId,
        momentKnmPerM: element.momentKnmPerM,
        shearKnPerM: element.resultantSamples[4].shearKnPerM,
        effectiveEMpa: element.effectiveEMpa,
        maxFibreStrain: element.maxFibreStrain,
        maxCombinedStrain: element.maxCombinedStrain,
        maxEquivalentPlasticStrain: element.maxEquivalentPlasticStrain,
        maxTensileDamage: element.maxTensileDamage,
        materialPoints: element.materialPoints,
        reinforcement: element.reinforcement,
        resultantSamples: element.resultantSamples.map((sample) => ({
          positionM: sample.positionM, momentKnmPerM: sample.momentKnmPerM,
          shearKnPerM: sample.shearKnPerM,
        })),
      })),
      iterations: geometricShell.iterations,
      relativeResidual: geometricShell.relativeResidual,
    };
  } else {
    const hybridInput = {
      ...bendingInput,
      ...(plate.reinforcement ? { reinforcement: plate.reinforcement } : {}),
    };
    try {
      native = await solveNativeFem<NativeHybridPlateResult>("hybridPlate", hybridInput);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const iterativeFailure = /sparse solver did not converge within|sparse solve lost residual accuracy/.test(reason);
      if (analysis !== "linear" || mesh.quads.length > 2500 || !iterativeFailure) throw error;
      try {
        native = await solveNativeFem<NativeHybridPlateResult>("hybridPlate", {
          ...hybridInput, linearBackend: "frontalWave", frontalMaxFrontDofs: 256,
        });
        frontalRecoveryReason = reason;
      } catch (frontalError) {
        const secondReason = frontalError instanceof Error ? frontalError.message : String(frontalError);
        throw new Error(`Plaat ${plate.id}: de iteratieve en frontale oplossers faalden: ${reason}; ${secondReason}`);
      }
    }
  }
  const exactIds = (actual: number[], expected: number[]) => {
    const actualSet = new Set(actual);
    return actualSet.size === actual.length && actual.length === expected.length
      && expected.every((id) => actualSet.has(id));
  };
  if (!native || typeof native !== "object" || !Array.isArray(native.nodes)
      || !Array.isArray(native.elements) || native.nodes.length !== mesh.nodes.length
      || native.elements.length !== mesh.quads.length
      || native.nodes.some((node) => !node || typeof node !== "object")
      || native.elements.some((element) => !element || typeof element !== "object")
      || !Number.isSafeInteger(native.iterations) || native.iterations < 0
      || !exactIds(native.nodes.map((node) => node.nodeId), mesh.nodes.map((node) => node.id))
      || !exactIds(native.elements.map((element) => element.quadId), mesh.quads.map((quad) => quad.id))
      || !Number.isFinite(native.relativeResidual) || native.relativeResidual < 0 || native.relativeResidual > 1e-7
      || native.elements.some((element) => !Number.isFinite(element.effectiveEMpa) || element.effectiveEMpa <= 0
        || !Number.isFinite(element.maxFibreStrain) || element.maxFibreStrain < 0)
      || native.elements.some((element) => !Array.isArray(element.resultantSamples)
        || element.resultantSamples.length !== 21 || element.resultantSamples.some((sample, index) =>
          !sample || typeof sample !== "object" || !Array.isArray(sample.positionM) || sample.positionM.length !== 2
          || !Array.isArray(sample.momentKnmPerM) || sample.momentKnmPerM.length !== 3
          || !Array.isArray(sample.shearKnPerM) || sample.shearKnPerM.length !== 2
          || ![...sample.positionM, ...sample.momentKnmPerM, ...sample.shearKnPerM].every(Number.isFinite)
          || sample.positionM.some((value, axis) => Math.abs(value
            - expectedResultantPositions.get(element.quadId)![index][axis]) > positionToleranceM)))
      || (useConstitutiveLaw && native.elements.some((element) => !Array.isArray(element.materialPoints)
        || element.materialPoints.length !== 16 || element.materialPoints.some((point, index) => {
          const expectedIndex: [number, number] = [Math.floor(index / 4), index % 4];
          return !point || typeof point !== "object" || !Array.isArray(point.gaussIndex)
            || point.gaussIndex.length !== 2 || !Array.isArray(point.positionM) || point.positionM.length !== 2
            || !Array.isArray(point.membraneStrain) || point.membraneStrain.length !== 3
            || point.gaussIndex[0] !== expectedIndex[0] || point.gaussIndex[1] !== expectedIndex[1]
            || ![...point.positionM, ...point.membraneStrain, point.equivalentPlasticStrain,
              point.tensileDamage].every(Number.isFinite)
            || point.positionM.some((value, axis) => Math.abs(value
              - expectedResultantPositions.get(element.quadId)![index + 5][axis]) > positionToleranceM)
            || point.equivalentPlasticStrain < 0 || point.tensileDamage < 0 || point.tensileDamage > 1;
        })))
      || (plate.reinforcement && native.elements.some((element) => !element.reinforcement
        || element.reinforcement.limitState !== plate.reinforcement!.limitState
        || !Number.isSafeInteger(element.reinforcement.checkedPoints) || element.reinforcement.checkedPoints <= 0))
      || native.nodes.some((node) => ![node.wM, node.thetaXRad, node.thetaYRad,
        node.reactionFzKn, node.reactionMxKnm, node.reactionMyKnm].every(Number.isFinite))) {
    throw new Error("De Rust-buigplaat leverde geen volledig, eindig resultaat met voldoende kleine restkracht.");
  }
  const threeLayerByQuad = new Map<number, NonNullable<Frame3DPlateBendingResult["elements"][number]["threeLayer"]>>();
  if (plate.threeLayer) {
    const membraneByQuad = new Map(membrane?.quads.map((quad) => [quad.quadId, quad]) ?? []);
    const quadById = new Map(mesh.quads.map((quad) => [quad.id, quad]));
    const idsByQuad = new Map<number, string[]>();
    const samples = native.elements.flatMap((element) => element.resultantSamples.map((sample, index) => {
      const id = `plate-${plate.id}-quad-${element.quadId}-point-${index + 1}`;
      const ids = idsByQuad.get(element.quadId) ?? [];
      ids.push(id);
      idsByQuad.set(element.quadId, ids);
      const membraneQuad = membraneByQuad.get(element.quadId);
      const quad = quadById.get(element.quadId);
      const shellElement = geometricShell?.elements.find((candidate) => candidate.quadId === element.quadId);
      const shellSample = shellElement?.resultantSamples[index];
      if (geometricShell && !shellSample) {
        throw new Error(`Plaat ${plate.id}, element ${element.quadId}: ontbrekende gekoppelde shellresultanten.`);
      }
      if (membrane && (!membraneQuad || !quad)) {
        throw new Error(`Plaat ${plate.id}, element ${element.quadId}: ontbrekende membraanresultanten.`);
      }
      const inPlaneStress = membraneQuad && quad
        ? membraneStressAt(membraneQuad, meshNodeById, quad.nodeIds, sample.positionM[0], sample.positionM[1])
        : [0, 0, 0] as [number, number, number];
      const membraneResultant = shellSample?.membraneKnPerM
        ?? inPlaneStress.map((stress) => stress * plate.thicknessM * 1000) as [number, number, number];
      return {
        id,
        positionM: sample.positionM,
        forces: {
          nx: membraneResultant[0],
          ny: membraneResultant[1],
          nxy: membraneResultant[2],
          mx: sample.momentKnmPerM[0], my: sample.momentKnmPerM[1], mxy: sample.momentKnmPerM[2],
          vx: sample.shearKnPerM[0], vy: sample.shearKnPerM[1],
        },
      };
    }));
    const batch = await solveNativeFem<NativeThreeLayerBatchResult>("threeLayerBatch", {
      configuration: { ...plate.threeLayer, thicknessMm: plate.thicknessM * 1000 }, samples,
    });
    if (!validThreeLayerBatch(batch, samples)) {
      throw new Error(`Plaat ${plate.id}: de Rust-drielagencontrole gaf een onvolledig of ongeldig puntresultaat terug.`);
    }
    const checks = new Map(batch.results.map((entry) => [entry.id, entry]));
    if (batch.checkedPoints !== samples.length || checks.size !== batch.results.length
        || checks.size !== samples.length || samples.some((sample) => !checks.has(sample.id))) {
      throw new Error(`Plaat ${plate.id}: de Rust-drielagencontrole gaf een onvolledig of ongeldig puntresultaat terug.`);
    }
    const utilization = (entry: NativeThreeLayerBatchResult["results"][number]) => Math.max(
      entry.result.top.utilizationAsX, entry.result.top.utilizationAsY, entry.result.top.utilizationCompression,
      entry.result.bottom.utilizationAsX, entry.result.bottom.utilizationAsY,
      entry.result.bottom.utilizationCompression,
      entry.result.core.utilizationShear ?? 0, entry.result.core.utilizationDiagonal ?? 0,
    );
    for (const element of native.elements) {
      const ids = idsByQuad.get(element.quadId) ?? [];
      const elementChecks = ids.map((id) => checks.get(id)).filter((entry) => entry !== undefined);
      if (elementChecks.length !== element.resultantSamples.length) {
        throw new Error(`Plaat ${plate.id}, element ${element.quadId}: niet alle resultanten zijn getoetst.`);
      }
      const max = (values: number[]) => Math.max(...values);
      const maxNullable = (values: Array<number | null>) => {
        const finite = values.filter((value): value is number => value !== null);
        return finite.length ? max(finite) : null;
      };
      const governing = elementChecks.reduce((best, entry) => utilization(entry) > utilization(best) ? entry : best);
      threeLayerByQuad.set(element.quadId, {
        checkedPoints: elementChecks.length,
        status: elementChecks.some((entry) => entry.result.status === "partial_check_exceeded")
          ? "partial_check_exceeded" : "partial_check_passes",
        governingPositionM: governing.positionM,
        top: {
          utilizationAsX: max(elementChecks.map((entry) => entry.result.top.utilizationAsX)),
          utilizationAsY: max(elementChecks.map((entry) => entry.result.top.utilizationAsY)),
          utilizationCompression: max(elementChecks.map((entry) => entry.result.top.utilizationCompression)),
          reinforcementCase: governing.result.top.reinforcementCase,
        },
        bottom: {
          utilizationAsX: max(elementChecks.map((entry) => entry.result.bottom.utilizationAsX)),
          utilizationAsY: max(elementChecks.map((entry) => entry.result.bottom.utilizationAsY)),
          utilizationCompression: max(elementChecks.map((entry) => entry.result.bottom.utilizationCompression)),
          reinforcementCase: governing.result.bottom.reinforcementCase,
        },
        core: {
          utilizationShear: maxNullable(elementChecks.map((entry) => entry.result.core.utilizationShear)),
          utilizationDiagonal: maxNullable(elementChecks.map((entry) => entry.result.core.utilizationDiagonal)),
        },
        notAssessed: [...new Set(elementChecks.flatMap((entry) => entry.result.notAssessed))],
      });
    }
  }
  const nodeResult = new Map(native.nodes.map((node) => [node.nodeId, node]));
  const membraneNodeResult = new Map(membrane?.nodes.map((node) => [node.nodeId, node]) ?? []);
  const shellNodeResult = new Map(geometricShell?.nodes.map((node) => [node.nodeId, node]) ?? []);
  const membraneReaction = (meshNodeId: number): Vector3 => {
    const shell = shellNodeResult.get(meshNodeId);
    if (shell) return add(scale(ex, shell.reactionFxKn), scale(ey, shell.reactionFyKn));
    const value = membraneNodeResult.get(meshNodeId);
    return value ? add(scale(ex, value.rxKn), scale(ey, value.ryKn)) : [0, 0, 0];
  };
  const membraneDisplacement = (meshNodeId: number): Vector3 => {
    const shell = shellNodeResult.get(meshNodeId);
    if (shell) return add(scale(ex, shell.uM), scale(ey, shell.vM));
    const value = membraneNodeResult.get(meshNodeId);
    return value ? add(scale(ex, value.uxM), scale(ey, value.uyM)) : [0, 0, 0];
  };
  const globalPoint = (u: number, v: number): Vector3 => add(origin, add(scale(ex, u), scale(ey, v)));
  const globalRotation = (thetaX: number, thetaY: number): Vector3 =>
    add(scale(ex, -thetaX), scale(ey, -thetaY));
  const reactionNodeIds = new Set([...supportByMeshId.keys(), ...membraneSupportByMeshId.keys()]);
  const meshReactions = [...reactionNodeIds].map((meshNodeId) => {
    const meshNode = meshNodeById.get(meshNodeId)!;
    const value = nodeResult.get(meshNodeId)!;
    const [x, y, z] = globalPoint(meshNode.x, meshNode.y);
    const force = add(scale(normal, value.reactionFzKn), membraneReaction(meshNodeId));
    const [fx, fy, fz] = force;
    const [mx, my, mz] = globalRotation(value.reactionMxKnm, value.reactionMyKnm);
    return { meshNodeId, x, y, z, fx, fy, fz, mx, my, mz };
  });
  const plateBending: Frame3DPlateBendingResult = {
    plateId: plate.id,
    basis: { ex, ey, normal },
    quads: mesh.quads.map((quad) => ({ id: quad.id, nodeIds: quad.nodeIds })),
    nodes: mesh.nodes.map((node) => {
      const value = nodeResult.get(node.id);
      if (!value) throw new Error(`Resultaat voor plaatroosterknoop ${node.id} ontbreekt.`);
      const [x, y, z] = globalPoint(node.x, node.y);
      return { meshNodeId: node.id, x, y, z,
        wM: value.wM, thetaXRad: -value.thetaXRad, thetaYRad: -value.thetaYRad };
    }),
    reactions: meshReactions,
    elements: native.elements.map((element) => ({
      ...element,
      ...(threeLayerByQuad.has(element.quadId) ? { threeLayer: threeLayerByQuad.get(element.quadId)! } : {}),
    })),
  };
  const displacements = nodes.map((vertex) => {
    const meshNodeId = vertexMeshId.get(vertex.id)!;
    const value = nodeResult.get(meshNodeId)!;
    const displacement = add(scale(normal, value.wM), membraneDisplacement(meshNodeId));
    const [ux, uy, uz] = displacement;
    const [rx, ry, rz] = globalRotation(value.thetaXRad, value.thetaYRad);
    return { nodeId: vertex.id, ux, uy, uz, rx, ry, rz };
  });
  const reactions = nodes.map((vertex) => {
    const meshNodeId = vertexMeshId.get(vertex.id)!;
    const value = nodeResult.get(meshNodeId)!;
    const force = add(scale(normal, value.reactionFzKn), membraneReaction(meshNodeId));
    const [fx, fy, fz] = force;
    const [mx, my, mz] = globalRotation(value.reactionMxKnm, value.reactionMyKnm);
    return { nodeId: vertex.id, fx, fy, fz, mx, my, mz };
  });
  const finalFactor = loadPath.length ? loadPath[loadPath.length - 1] : 1;
  const relativeResidual = Math.max(native.relativeResidual, membrane?.relativeResidual ?? 0);
  const vertexById = new Map(nodes.map((node) => [node.id, node]));
  const forceBalance = balance(scale(normal, finalFactor * surfaceLoads.reduce((sum, q) => sum + q, 0)),
    area, center, [...nodalLoads.map((load) => ({ point: position(vertexById.get(load.nodeId)!),
      force: scale(load.force, finalFactor), moment: scale(load.moment, finalFactor) })),
      ...equivalentMembraneSurfaceLoads.map((load) => ({ point: load.point,
        force: scale(load.force, finalFactor), moment: scale(load.moment, finalFactor) })),
      ...equivalentEdgeLoads.map((load) => ({ point: load.point, force: scale(load.force, finalFactor), moment: scale(load.moment, finalFactor) }))],
    meshReactions.map((reaction) => ({ point: [reaction.x, reaction.y, reaction.z],
      force: [reaction.fx, reaction.fy, reaction.fz], moment: [reaction.mx, reaction.my, reaction.mz] })));
  return {
    schemaVersion: 1,
    engine: { id: "openaec-native-fem", name: "Open FEM Rust", revision: "0.1.0", license: "AGPL-3.0-or-later" },
    analysis, displacements, reactions, memberForces: [], plateBending,
    ...(analysis === "material" || useConstitutiveLaw ? { materialLoadPath: [...loadPath],
      materialIterations: Math.max(native.iterations, membrane?.iterations ?? 0) } : {}),
    buckling: { status: "notApplicable", reason: "Eigenknik voor een losse buigplaat is niet beschikbaar." },
    equilibrium: { relativeResidual, residualOk: true,
      maxImbalanceKn: forceBalance.maxImbalanceKn, equilibriumOk: forceBalance.ok },
    forceBalance, solverPath: frontalRecoveryReason
      ? "native-rust-hybrid-plate-frontal-wave" : "native-rust-hybrid-plate",
    diagnostics: ["Rust hybride Q4-buigplaat in een 3D-vlak.",
      ...(frontalRecoveryReason ? [`De iteratieve plaatoplosser convergeerde niet; de frontale methode loste het model op met maximaal ${native.frontalMaximumFrontDofs ?? "?"} actieve vrijheidsgraden.`] : []),
      ...(geometry.openingRects.length > 0 ? ["Ook het Q4-rooster met rechthoekige openingen komt uit de Rust-mesher."] : []),
      "Buiten- en openingshoekopleggingen komen uit het 3D-model; opgegeven plaatrandopleggingen gelden voor alle randroosterknopen.",
    ...(analysis === "material" && hasInPlaneLoads && hasOutOfPlaneLoads
        ? ["FNL met gelijktijdige membraan- en buigbelasting wordt met afzonderlijke Rust-oplossingen berekend; de E(rek)-geschiedenis is niet gekoppeld tot één schaalelement."]
        : []),
      ...(analysis === "p-delta"
        ? [plate.nonlinearLaw
          ? `GNL/FNL shell: ${plate.nonlinearLaw.kind} op de in-vlaks-Gauss-punten; shellbuiging blijft elastisch/secant-E.`
          : plate.modulusCurve?.length
          ? "GNL/FNL gebruikt één gekoppelde von-Kármán schaalsolve met secant-E-rekhistorie en hybride plaatbuiging."
          : "GNL gebruikt één gekoppelde von-Kármán schaalsolve met hybride plaatbuiging en membraanresultanten."]
        : []),
      ...(plate.threeLayer ? [analysis === "p-delta"
        ? "De drie-lagencontrole gebruikt membraan- en buigresultanten uit dezelfde geometrisch niet-lineaire shelloplossing."
        : "De drie-lagencontrole combineert de afzonderlijke Rust-Q4-membraan- en hybride buigresultaten; geometrische membraan-buigkoppeling ontbreekt."] : []),
      ...(analysis === "material" ? ["FNL gebruikt een niet-toenemende secant-E op maximale vezelrek per element; dit is geen scheur- of plastisch doorsnedemodel."] : []),
      ...(plate.reinforcement ? ["Plaatwapening en scheurwijdte zijn per element op steekpunten getoetst; extremen tussen punten en normcombinaties zijn niet afgedekt."]
        : ["Plaatwapening en scheurwijdte zijn niet getoetst: geef daarvoor een wapeningsspecificatie op."])],
  };
}

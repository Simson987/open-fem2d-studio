import { solveNativeFem, type NativeHybridPlateResult } from "../../lib/nativeFemClient";
import { CONCRETE_E_CM, NU_BETON, NU_STAAL, eVanMateriaal } from "../../lib/sectionResolver";
import { frame3DLoadCaseId, type Frame3DModel, type Frame3DNode } from "./frame3dModel";
import type { Frame3DAnalysisKind, Frame3DLoadSelection, Frame3DPlateBendingResult, Frame3DSolveResult } from "./frame3dSolver";

interface QuadMesh {
  nodes: { id: number; x: number; y: number }[];
  quads: { id: number; nodeIds: [number, number, number, number]; materialId: number; thicknessM: number }[];
  bottomNodeIds: number[]; rightNodeIds: number[]; topNodeIds: number[]; leftNodeIds: number[];
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
  const mesh = await solveNativeFem<QuadMesh>("quadMesh", {
    originX: 0, originY: 0, widthM: width, heightM: height,
    maxCellSizeM, materialId: 1, thicknessM: plate.thicknessM,
    ...(openingRects.length ? { openings: openingRects.map((opening) => ({
      xM: opening.minU, yM: opening.minV,
      widthM: opening.maxU - opening.minU, heightM: opening.maxV - opening.minV,
    })) } : {}),
  });
  if (mesh.nodes.length > 20_000 / 3 || mesh.quads.length === 0) {
    throw new Error("Het Q4-plaatrooster is leeg of overschrijdt de Rust-grens van 20.000 vrijheidsgraden.");
  }
  const nodes = mesh.nodes;
  const quads = mesh.quads;
  const actualArea = quads.reduce((sum, quad) => {
    const a = nodes[quad.nodeIds[0] - 1], b = nodes[quad.nodeIds[1] - 1], d = nodes[quad.nodeIds[3] - 1];
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
  analysis: Extract<Frame3DAnalysisKind, "linear" | "material">,
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
  if (analysis === "material" && (!plate.modulusCurve || plate.modulusCurve.length < 2)) {
    throw new Error(`3D-plaat ${plate.id}: stel voor FNL een expliciete E-rekcurve in.`);
  }
  if (analysis === "material" && Math.abs(plate.modulusCurve![0].eMpa - eMpa) > eMpa * 1e-10) {
    throw new Error(`3D-plaat ${plate.id}: de E-rekcurve moet bij rek 0 beginnen met de materiaaleigen E = ${eMpa} MPa.`);
  }
  const loadPath = analysis === "material" ? model.materialLoadPath ?? [1] : [];
  if ((model.memberLoads?.length ?? 0) || (model.memberPointLoads?.length ?? 0)
      || (model.thermalLoads?.length ?? 0)) {
    throw new Error("De losse 3D-plaatroute ondersteunt geen staaflasten of temperatuur.");
  }
  for (const support of model.supports ?? []) {
    if (!nodes.some((node) => node.id === support.nodeId)
        || Object.values(support.springs ?? {}).some((value) => value !== 0)
        || Object.values(support.prescribed ?? {}).some((value) => value !== 0)) {
      throw new Error("De 3D-plaatroute ondersteunt alleen buiten- en openingshoekopleggingen zonder veren of opgelegde verplaatsingen.");
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
        || Math.abs(dot(force, ex)) + Math.abs(dot(force, ey)) > 1e-9 * Math.max(1, norm(force))
        || Math.abs(dot(moment, normal)) > 1e-9 * Math.max(1, norm(moment))) {
      throw new Error("De 3D-buigplaat ondersteunt op buiten- en openingshoekknopen alleen normaalkracht en momenten om de twee plaatassen.");
    }
    return [{ nodeId: load.nodeId, force, moment,
      normalForce: dot(force, normal), localMx: -dot(moment, ex), localMy: -dot(moment, ey) }];
  });
  const surfaceLoads = (model.surfaceLoads ?? []).flatMap((load) => {
    const loadFactor = factor(selection, frame3DLoadCaseId(load));
    if (loadFactor === 0) return [];
    const pressure: Vector3 = [load.qx * loadFactor, load.qy * loadFactor, load.qz * loadFactor];
    if (load.plateId !== plate.id
        || Math.abs(dot(pressure, ex)) + Math.abs(dot(pressure, ey)) > 1e-9 * Math.max(1, norm(pressure))) {
      throw new Error("De 3D-buigplaat ondersteunt alleen een oppervlaktebelasting normaal op de berekende plaat.");
    }
    return [dot(pressure, normal)];
  });
  if (nodalLoads.length === 0 && surfaceLoads.length === 0) {
    throw new Error("Dit belastinggeval bevat geen normale 3D-plaatbelasting.");
  }
  const mesh = await meshForPlate(geometry);
  if (mesh.nodes.length < 4 || mesh.quads.length < 1) throw new Error("De plaatmesher gaf een leeg rooster terug.");
  const meshNodeById = new Map(mesh.nodes.map((node) => [node.id, node]));
  const vertexMeshId = new Map(nodes.map((vertex) => {
    const relative = subtract(position(vertex), origin);
    const u = dot(relative, ex), v = dot(relative, ey);
    const found = mesh.nodes.find((node) => Math.abs(node.x - u) <= tolerance
      && Math.abs(node.y - v) <= tolerance);
    if (!found) throw new Error(`Plaat-hoek- of openingsknoop ${vertex.id} ontbreekt in het rekenrooster.`);
    return [vertex.id, found.id] as const;
  }));
  const supportByMeshId = new Map<number, { nodeId: number; w: boolean; thetaX: boolean; thetaY: boolean }>();
  const mergeSupport = (nodeId: number, w: boolean, thetaX: boolean, thetaY: boolean) => {
    if (!meshNodeById.has(nodeId)) throw new Error(`Plaat-randroosterknoop ${nodeId} ontbreekt.`);
    if (!(w || thetaX || thetaY)) return;
    const current = supportByMeshId.get(nodeId);
    supportByMeshId.set(nodeId, { nodeId, w: w || (current?.w ?? false),
      thetaX: thetaX || (current?.thetaX ?? false), thetaY: thetaY || (current?.thetaY ?? false) });
  };
  for (const support of localSupports) mergeSupport(vertexMeshId.get(support.nodeId)!,
    support.w, support.thetaX, support.thetaY);
  const edgeNodeIds = [mesh.bottomNodeIds, mesh.rightNodeIds, mesh.topNodeIds, mesh.leftNodeIds];
  if (edgeNodeIds.some((ids) => !Array.isArray(ids) || ids.length < 2)) {
    throw new Error("De plaatmesher gaf geen volledige vier randknoopreeksen terug.");
  }
  for (let edge = 0; edge < 4; edge++) {
    const kind = plate.edgeSupports?.[edge] ?? "free";
    if (kind === "free") continue;
    for (const nodeId of edgeNodeIds[edge]) mergeSupport(nodeId, true,
      kind === "clamped", kind === "clamped");
  }
  const native = await solveNativeFem<NativeHybridPlateResult>("hybridPlate", {
    nodes: mesh.nodes, quads: mesh.quads, materials: [{ id: 1, eMpa, nu }],
    supports: [...supportByMeshId.values()],
    loads: nodalLoads.map((load) => ({ nodeId: vertexMeshId.get(load.nodeId),
      // The plate's thetaX=-dw/dy and thetaY=dw/dx are the negatives of
      // physical 3D rotations about the local plate X and Y axes.
      fz: load.normalForce, mx: load.localMx, my: load.localMy })),
    pressureKnM2: surfaceLoads.reduce((sum, pressure) => sum + pressure, 0),
    ...(plate.reinforcement ? { reinforcement: plate.reinforcement } : {}),
    ...(analysis === "material" ? { modulusCurves: [{ materialId: 1, points: plate.modulusCurve }],
      loadPath, maxIterations: 50, tolerance: 1e-7 } : {}),
  });
  if (native.nodes?.length !== mesh.nodes.length || native.elements?.length !== mesh.quads.length
      || !Number.isFinite(native.relativeResidual) || native.relativeResidual > 1e-7
      || native.elements.some((element) => !Number.isFinite(element.effectiveEMpa) || element.effectiveEMpa <= 0
        || !Number.isFinite(element.maxFibreStrain) || element.maxFibreStrain < 0)
      || (plate.reinforcement && native.elements.some((element) => !element.reinforcement
        || element.reinforcement.limitState !== plate.reinforcement!.limitState
        || !(element.reinforcement.checkedPoints > 0)))
      || native.nodes.some((node) => ![node.wM, node.thetaXRad, node.thetaYRad,
        node.reactionFzKn, node.reactionMxKnm, node.reactionMyKnm].every(Number.isFinite))) {
    throw new Error("De Rust-buigplaat leverde geen volledig, eindig resultaat met voldoende kleine restkracht.");
  }
  const nodeResult = new Map(native.nodes.map((node) => [node.nodeId, node]));
  const globalPoint = (u: number, v: number): Vector3 => add(origin, add(scale(ex, u), scale(ey, v)));
  const globalRotation = (thetaX: number, thetaY: number): Vector3 =>
    add(scale(ex, -thetaX), scale(ey, -thetaY));
  const meshReactions = [...supportByMeshId.keys()].map((meshNodeId) => {
    const meshNode = meshNodeById.get(meshNodeId)!;
    const value = nodeResult.get(meshNodeId)!;
    const [x, y, z] = globalPoint(meshNode.x, meshNode.y);
    const [fx, fy, fz] = scale(normal, value.reactionFzKn);
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
    elements: native.elements,
  };
  const displacements = nodes.map((vertex) => {
    const value = nodeResult.get(vertexMeshId.get(vertex.id)!)!;
    const [ux, uy, uz] = scale(normal, value.wM);
    const [rx, ry, rz] = globalRotation(value.thetaXRad, value.thetaYRad);
    return { nodeId: vertex.id, ux, uy, uz, rx, ry, rz };
  });
  const reactions = nodes.map((vertex) => {
    const value = nodeResult.get(vertexMeshId.get(vertex.id)!)!;
    const [fx, fy, fz] = scale(normal, value.reactionFzKn);
    const [mx, my, mz] = globalRotation(value.reactionMxKnm, value.reactionMyKnm);
    return { nodeId: vertex.id, fx, fy, fz, mx, my, mz };
  });
  const finalFactor = loadPath.length ? loadPath[loadPath.length - 1] : 1;
  const vertexById = new Map(nodes.map((node) => [node.id, node]));
  const forceBalance = balance(scale(normal, finalFactor * surfaceLoads.reduce((sum, q) => sum + q, 0)),
    area, center, nodalLoads.map((load) => ({ point: position(vertexById.get(load.nodeId)!),
      force: scale(load.force, finalFactor), moment: scale(load.moment, finalFactor) })),
    meshReactions.map((reaction) => ({ point: [reaction.x, reaction.y, reaction.z],
      force: [reaction.fx, reaction.fy, reaction.fz], moment: [reaction.mx, reaction.my, reaction.mz] })));
  return {
    schemaVersion: 1,
    engine: { id: "openaec-native-fem", name: "Open FEM Rust", revision: "0.1.0", license: "AGPL-3.0-or-later" },
    analysis, displacements, reactions, memberForces: [], plateBending,
    ...(analysis === "material" ? { materialLoadPath: [...loadPath], materialIterations: native.iterations } : {}),
    buckling: { status: "notApplicable", reason: "Eigenknik voor een losse buigplaat is niet beschikbaar." },
    equilibrium: { relativeResidual: native.relativeResidual, residualOk: true,
      maxImbalanceKn: forceBalance.maxImbalanceKn, equilibriumOk: forceBalance.ok },
    forceBalance, solverPath: "native-rust-hybrid-plate",
    diagnostics: ["Rust hybride Q4-buigplaat in een 3D-vlak.",
      ...(geometry.openingRects.length > 0 ? ["Ook het Q4-rooster met rechthoekige openingen komt uit de Rust-mesher."] : []),
      "Buiten- en openingshoekopleggingen komen uit het 3D-model; opgegeven plaatrandopleggingen gelden voor alle randroosterknopen.",
      ...(analysis === "material" ? ["FNL gebruikt een niet-toenemende secant-E op maximale vezelrek per element; dit is geen scheur- of plastisch doorsnedemodel."] : []),
      ...(plate.reinforcement ? ["Plaatwapening en scheurwijdte zijn per element op steekpunten getoetst; extremen tussen punten en normcombinaties zijn niet afgedekt."]
        : ["Plaatwapening en scheurwijdte zijn niet getoetst: geef daarvoor een wapeningsspecificatie op."])],
  };
}

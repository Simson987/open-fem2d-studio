import { solveNativeFem, type NativeHybridPlateResult } from "../../lib/nativeFemClient";
import { CONCRETE_E_CM, NU_BETON, NU_STAAL, eVanMateriaal } from "../../lib/sectionResolver";
import { frame3DLoadCaseId, type Frame3DModel, type Frame3DNode } from "./frame3dModel";
import type { Frame3DLoadSelection, Frame3DPlateBendingResult, Frame3DSolveResult } from "./frame3dSolver";

interface QuadMesh {
  nodes: { id: number; x: number; y: number }[];
  quads: { id: number; nodeIds: [number, number, number, number]; materialId: number; thicknessM: number }[];
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
  if (plate.nodeIds.length !== 4 || (plate.openings?.length ?? 0) > 0
      || (plate.cornerRadiusM ?? 0) !== 0 || plate.boundary?.some((edge) => edge.kind !== "line")) {
    throw new Error(`3D-plaat ${plate.id}: de Rust-route vereist een rechthoek zonder bogen, afrondingen of openingen.`);
  }
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const corners = plate.nodeIds.map((id) => byId.get(id));
  if (corners.some((node) => !node) || model.nodes.length !== 4) {
    throw new Error(`3D-plaat ${plate.id}: het model moet precies de vier plaat-hoekknopen bevatten.`);
  }
  const nodes = corners as Frame3DNode[];
  const origin = position(nodes[0]);
  const firstEdge = subtract(position(nodes[1]), origin);
  const secondEdge = subtract(position(nodes[3]), origin);
  const width = norm(firstEdge), height = norm(secondEdge);
  const tolerance = Math.max(width, height, 1) * 1e-9;
  if (!(width > tolerance) || !(height > tolerance)
      || Math.abs(dot(firstEdge, secondEdge)) > tolerance * Math.max(width, height)
      || norm(subtract(position(nodes[2]), add(origin, add(firstEdge, secondEdge)))) > tolerance) {
    throw new Error(`3D-plaat ${plate.id}: de vier knopen moeten een vlakke rechthoek vormen.`);
  }
  const ex = scale(firstEdge, 1 / width), ey = scale(secondEdge, 1 / height);
  const crossProduct = cross(ex, ey);
  const normal = scale(crossProduct, 1 / norm(crossProduct));
  const center = add(origin, scale(add(firstEdge, secondEdge), 0.5));
  if (!plate.material) throw new Error(`3D-plaat ${plate.id}: wijs eerst een materiaal toe.`);
  const { E, soort } = eVanMateriaal(plate.material);
  if (!(E > 0) || !Number.isFinite(E) || soort === "hout") {
    throw new Error(`3D-plaat ${plate.id}: kies een herkend isotroop materiaal met een geldige E-modulus; hout vraagt een orthotrope plaatkern.`);
  }
  return { plate, nodes, origin, ex, ey, normal, center, width, height, eMpa: E,
    nu: plate.material in CONCRETE_E_CM ? NU_BETON : NU_STAAL, tolerance };
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
  corners: Frame3DNode[], pressure: Vector3, area: number, center: Vector3,
  loads: Array<{ nodeId: number; force: Vector3; moment: Vector3 }>,
  reactions: Frame3DSolveResult["reactions"],
): NonNullable<Frame3DSolveResult["forceBalance"]> {
  const corner = new Map(corners.map((node) => [node.id, node]));
  const applied = scale(pressure, area);
  const appliedMoment = cross(center, applied);
  for (const load of loads) {
    const node = corner.get(load.nodeId)!;
    const lever = cross(position(node), load.force);
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
    const node = corner.get(reaction.nodeId)!;
    const force: Vector3 = [reaction.fx, reaction.fy, reaction.fz];
    const lever = cross(position(node), force);
    const moment: Vector3 = [reaction.mx, reaction.my, reaction.mz];
    for (let axis = 0; axis < 3; axis++) {
      imbalanceKn[axis] += force[axis];
      momentImbalanceKnm[axis] += lever[axis] + moment[axis];
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
): Promise<Frame3DSolveResult> {
  const geometry = rectangle(model);
  const { plate, nodes, origin, ex, ey, normal, center, width, height, eMpa, nu, tolerance } = geometry;
  if ((model.memberLoads?.length ?? 0) || (model.memberPointLoads?.length ?? 0)
      || (model.thermalLoads?.length ?? 0) || model.materialLoadPath) {
    throw new Error("De losse 3D-plaatroute ondersteunt geen staaflasten, temperatuur of FNL-lastpad.");
  }
  for (const support of model.supports ?? []) {
    if (!nodes.some((node) => node.id === support.nodeId)
        || Object.values(support.springs ?? {}).some((value) => value !== 0)
        || Object.values(support.prescribed ?? {}).some((value) => value !== 0)) {
      throw new Error("De 3D-plaatroute ondersteunt alleen hoekopleggingen zonder veren of opgelegde verplaatsingen.");
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
      throw new Error("De 3D-buigplaat ondersteunt op hoekknopen alleen normaalkracht en momenten om de twee plaatassen.");
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
  const mesh = await solveNativeFem<QuadMesh>("quadMesh", {
    originX: 0, originY: 0, widthM: width, heightM: height,
    maxCellSizeM: Math.min(width, height) / 4, materialId: 1, thicknessM: plate.thicknessM,
  });
  if (mesh.nodes.length < 4 || mesh.quads.length < 1) throw new Error("De Rust-plaatmesher gaf een leeg rooster terug.");
  const cornerMeshId = new Map(nodes.map((corner) => {
    const relative = subtract(position(corner), origin);
    const u = dot(relative, ex), v = dot(relative, ey);
    const found = mesh.nodes.find((node) => Math.abs(node.x - u) <= tolerance
      && Math.abs(node.y - v) <= tolerance);
    if (!found) throw new Error(`Plaat-hoekknoop ${corner.id} ontbreekt in het Rust-rooster.`);
    return [corner.id, found.id] as const;
  }));
  const native = await solveNativeFem<NativeHybridPlateResult>("hybridPlate", {
    nodes: mesh.nodes, quads: mesh.quads, materials: [{ id: 1, eMpa, nu }],
    supports: localSupports.map((support) => ({ nodeId: cornerMeshId.get(support.nodeId),
      w: support.w, thetaX: support.thetaX, thetaY: support.thetaY })),
    loads: nodalLoads.map((load) => ({ nodeId: cornerMeshId.get(load.nodeId),
      // The plate's thetaX=-dw/dy and thetaY=dw/dx are the negatives of
      // physical 3D rotations about the local plate X and Y axes.
      fz: load.normalForce, mx: load.localMx, my: load.localMy })),
    pressureKnM2: surfaceLoads.reduce((sum, pressure) => sum + pressure, 0),
  });
  if (native.nodes?.length !== mesh.nodes.length || native.elements?.length !== mesh.quads.length
      || !Number.isFinite(native.relativeResidual) || native.relativeResidual > 1e-7
      || native.nodes.some((node) => ![node.wM, node.thetaXRad, node.thetaYRad,
        node.reactionFzKn, node.reactionMxKnm, node.reactionMyKnm].every(Number.isFinite))) {
    throw new Error("De Rust-buigplaat leverde geen volledig, eindig resultaat met voldoende kleine restkracht.");
  }
  const nodeResult = new Map(native.nodes.map((node) => [node.nodeId, node]));
  const globalPoint = (u: number, v: number): Vector3 => add(origin, add(scale(ex, u), scale(ey, v)));
  const globalRotation = (thetaX: number, thetaY: number): Vector3 =>
    add(scale(ex, -thetaX), scale(ey, -thetaY));
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
    elements: native.elements,
  };
  const displacements = nodes.map((corner) => {
    const value = nodeResult.get(cornerMeshId.get(corner.id)!)!;
    const [ux, uy, uz] = scale(normal, value.wM);
    const [rx, ry, rz] = globalRotation(value.thetaXRad, value.thetaYRad);
    return { nodeId: corner.id, ux, uy, uz, rx, ry, rz };
  });
  const reactions = nodes.map((corner) => {
    const value = nodeResult.get(cornerMeshId.get(corner.id)!)!;
    const [fx, fy, fz] = scale(normal, value.reactionFzKn);
    const [mx, my, mz] = globalRotation(value.reactionMxKnm, value.reactionMyKnm);
    return { nodeId: corner.id, fx, fy, fz, mx, my, mz };
  });
  const forceBalance = balance(nodes, scale(normal, surfaceLoads.reduce((sum, q) => sum + q, 0)),
    width * height, center, nodalLoads, reactions);
  return {
    schemaVersion: 1,
    engine: { id: "openaec-native-fem", name: "Open FEM Rust", revision: "0.1.0", license: "AGPL-3.0-or-later" },
    analysis: "linear", displacements, reactions, memberForces: [], plateBending,
    buckling: { status: "notApplicable", reason: "Eigenknik voor een losse buigplaat is niet beschikbaar." },
    equilibrium: { relativeResidual: native.relativeResidual, residualOk: true,
      maxImbalanceKn: forceBalance.maxImbalanceKn, equilibriumOk: forceBalance.ok },
    forceBalance, solverPath: "native-rust-hybrid-plate",
    diagnostics: ["Rust hybride Q4-buigplaat; lokaal rechthoekig rooster in een 3D-vlak, lineaire buiging.",
      "Opleggingen gelden op de vier plaat-hoekknopen; langs de overige rand is de plaat vrij.",
      "Plaatwapening en scheurwijdte zijn in deze 3D-app-route nog niet aangesloten."],
  };
}

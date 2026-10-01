import { solveNativeFem, type NativeHybridPlateResult } from "../../lib/nativeFemClient";
import { CONCRETE_E_CM, NU_BETON, NU_STAAL, eVanMateriaal } from "../../lib/sectionResolver";
import { frame3DLoadCaseId, type Frame3DModel, type Frame3DNode } from "./frame3dModel";
import type { Frame3DLoadSelection, Frame3DPlateBendingResult, Frame3DSolveResult } from "./frame3dSolver";

interface QuadMesh {
  nodes: { id: number; x: number; y: number }[];
  quads: { id: number; nodeIds: [number, number, number, number]; materialId: number; thicknessM: number }[];
}

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
  const minX = Math.min(...nodes.map((node) => node.x));
  const maxX = Math.max(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxY = Math.max(...nodes.map((node) => node.y));
  const z = nodes[0].z;
  const width = maxX - minX, height = maxY - minY;
  const tolerance = Math.max(width, height, 1) * 1e-9;
  if (!(width > 0) || !(height > 0) || !nodes.every((node) => Math.abs(node.z - z) <= tolerance)
      || new Set(nodes.map((node) => `${Math.abs(node.x - minX) <= tolerance ? 0 : 1}:${Math.abs(node.y - minY) <= tolerance ? 0 : 1}`)).size !== 4
      || nodes.some((node) => Math.min(Math.abs(node.x - minX), Math.abs(node.x - maxX)) > tolerance
        || Math.min(Math.abs(node.y - minY), Math.abs(node.y - maxY)) > tolerance)) {
    throw new Error(`3D-plaat ${plate.id}: de vier knopen moeten een horizontale, asparallelle rechthoek vormen.`);
  }
  if (!plate.material) throw new Error(`3D-plaat ${plate.id}: wijs eerst een materiaal toe.`);
  const { E, soort } = eVanMateriaal(plate.material);
  if (!(E > 0) || !Number.isFinite(E) || soort === "hout") {
    throw new Error(`3D-plaat ${plate.id}: kies een herkend isotroop materiaal met een geldige E-modulus; hout vraagt een orthotrope plaatkern.`);
  }
  return { plate, nodes, minX, minY, z, width, height, eMpa: E,
    nu: plate.material in CONCRETE_E_CM ? NU_BETON : NU_STAAL, tolerance };
}

function balance(
  corners: Frame3DNode[], pressure: number, area: number, center: [number, number, number],
  loads: Array<{ nodeId: number; fz: number; mx: number; my: number }>,
  reactions: Frame3DSolveResult["reactions"],
): NonNullable<Frame3DSolveResult["forceBalance"]> {
  const corner = new Map(corners.map((node) => [node.id, node]));
  const imbalanceKn: [number, number, number] = [0, 0, pressure * area];
  const momentImbalanceKnm: [number, number, number] = [center[1] * pressure * area, -center[0] * pressure * area, 0];
  for (const load of loads) {
    const node = corner.get(load.nodeId)!;
    imbalanceKn[2] += load.fz;
    momentImbalanceKnm[0] += node.y * load.fz + load.mx;
    momentImbalanceKnm[1] += -node.x * load.fz + load.my;
  }
  const scaleKn = Math.max(1, Math.abs(imbalanceKn[2]));
  const scaleKnm = Math.max(1, ...momentImbalanceKnm.map(Math.abs));
  for (const reaction of reactions) {
    const node = corner.get(reaction.nodeId)!;
    imbalanceKn[2] += reaction.fz;
    momentImbalanceKnm[0] += node.y * reaction.fz + reaction.mx;
    momentImbalanceKnm[1] += -node.x * reaction.fz + reaction.my;
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
  const { plate, nodes, minX, minY, z, width, height, eMpa, nu, tolerance } = geometry;
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
  const nodalLoads = (model.loads ?? []).flatMap((load) => {
    const loadFactor = factor(selection, frame3DLoadCaseId(load));
    if (loadFactor === 0) return [];
    if (!nodes.some((node) => node.id === load.nodeId)
        || Math.abs(load.fx) + Math.abs(load.fy) + Math.abs(load.mz) > 0) {
      throw new Error("De 3D-buigplaat ondersteunt op hoekknopen alleen Fz, Mx en My.");
    }
    return [{ nodeId: load.nodeId, fz: load.fz * loadFactor,
      mx: load.mx * loadFactor, my: load.my * loadFactor }];
  });
  const surfaceLoads = (model.surfaceLoads ?? []).flatMap((load) => {
    const loadFactor = factor(selection, frame3DLoadCaseId(load));
    if (loadFactor === 0) return [];
    if (load.plateId !== plate.id || Math.abs(load.qx) + Math.abs(load.qy) > 0) {
      throw new Error("De 3D-buigplaat ondersteunt alleen een verticale oppervlaktebelasting op de berekende plaat.");
    }
    return [load.qz * loadFactor];
  });
  if (nodalLoads.length === 0 && surfaceLoads.length === 0) {
    throw new Error("Dit belastinggeval bevat geen verticale 3D-plaatbelasting.");
  }
  const mesh = await solveNativeFem<QuadMesh>("quadMesh", {
    originX: minX, originY: minY, widthM: width, heightM: height,
    maxCellSizeM: Math.min(width, height) / 4, materialId: 1, thicknessM: plate.thicknessM,
  });
  if (mesh.nodes.length < 4 || mesh.quads.length < 1) throw new Error("De Rust-plaatmesher gaf een leeg rooster terug.");
  const cornerMeshId = new Map(nodes.map((corner) => {
    const found = mesh.nodes.find((node) => Math.abs(node.x - corner.x) <= tolerance
      && Math.abs(node.y - corner.y) <= tolerance);
    if (!found) throw new Error(`Plaat-hoekknoop ${corner.id} ontbreekt in het Rust-rooster.`);
    return [corner.id, found.id] as const;
  }));
  const native = await solveNativeFem<NativeHybridPlateResult>("hybridPlate", {
    nodes: mesh.nodes, quads: mesh.quads, materials: [{ id: 1, eMpa, nu }],
    supports: (model.supports ?? []).map((support) => ({ nodeId: cornerMeshId.get(support.nodeId),
      w: support.uz, thetaX: support.rx, thetaY: support.ry })),
    loads: nodalLoads.map((load) => ({ nodeId: cornerMeshId.get(load.nodeId),
      // The plate's thetaX=-dw/dy and thetaY=dw/dx are the negatives of
      // physical 3D rotations about global X and Y.
      fz: load.fz, mx: -load.mx, my: -load.my })),
    pressureKnM2: surfaceLoads.reduce((sum, pressure) => sum + pressure, 0),
  });
  if (native.nodes?.length !== mesh.nodes.length || native.elements?.length !== mesh.quads.length
      || !Number.isFinite(native.relativeResidual) || native.relativeResidual > 1e-7
      || native.nodes.some((node) => ![node.wM, node.thetaXRad, node.thetaYRad,
        node.reactionFzKn, node.reactionMxKnm, node.reactionMyKnm].every(Number.isFinite))) {
    throw new Error("De Rust-buigplaat leverde geen volledig, eindig resultaat met voldoende kleine restkracht.");
  }
  const nodeResult = new Map(native.nodes.map((node) => [node.nodeId, node]));
  const plateBending: Frame3DPlateBendingResult = {
    plateId: plate.id,
    quads: mesh.quads.map((quad) => ({ id: quad.id, nodeIds: quad.nodeIds })),
    nodes: mesh.nodes.map((node) => {
      const value = nodeResult.get(node.id);
      if (!value) throw new Error(`Resultaat voor plaatroosterknoop ${node.id} ontbreekt.`);
      return { meshNodeId: node.id, x: node.x, y: node.y, z,
        wM: value.wM, thetaXRad: -value.thetaXRad, thetaYRad: -value.thetaYRad };
    }),
    elements: native.elements,
  };
  const displacements = nodes.map((corner) => {
    const value = nodeResult.get(cornerMeshId.get(corner.id)!)!;
    return { nodeId: corner.id, ux: 0, uy: 0, uz: value.wM,
      rx: -value.thetaXRad, ry: -value.thetaYRad, rz: 0 };
  });
  const reactions = nodes.map((corner) => {
    const value = nodeResult.get(cornerMeshId.get(corner.id)!)!;
    return { nodeId: corner.id, fx: 0, fy: 0, fz: value.reactionFzKn,
      mx: -value.reactionMxKnm, my: -value.reactionMyKnm, mz: 0 };
  });
  const forceBalance = balance(nodes, surfaceLoads.reduce((sum, q) => sum + q, 0),
    width * height, [minX + width / 2, minY + height / 2, z], nodalLoads, reactions);
  return {
    schemaVersion: 1,
    engine: { id: "openaec-native-fem", name: "Open FEM Rust", revision: "0.1.0", license: "AGPL-3.0-or-later" },
    analysis: "linear", displacements, reactions, memberForces: [], plateBending,
    buckling: { status: "notApplicable", reason: "Eigenknik voor een losse buigplaat is niet beschikbaar." },
    equilibrium: { relativeResidual: native.relativeResidual, residualOk: true,
      maxImbalanceKn: forceBalance.maxImbalanceKn, equilibriumOk: forceBalance.ok },
    forceBalance, solverPath: "native-rust-hybrid-plate",
    diagnostics: ["Rust hybride Q4-buigplaat; rechthoekig XY-rooster, lineaire buiging.",
      "Opleggingen gelden op de vier plaat-hoekknopen; langs de overige rand is de plaat vrij.",
      "Plaatwapening en scheurwijdte zijn in deze 3D-app-route nog niet aangesloten."],
  };
}

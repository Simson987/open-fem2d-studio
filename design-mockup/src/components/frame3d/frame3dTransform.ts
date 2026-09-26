import type { Frame3DModel } from "./frame3dModel";
import type { Frame3DMultiSelection, Frame3DSingleSelection } from "./frame3dSelection";

export type Frame3DTransformSelection =
  | Extract<Frame3DSingleSelection, { type: "node" | "beam" | "plate" }>
  | Frame3DMultiSelection;
export type Frame3DAxis = "x" | "y" | "z";
export type Frame3DTransformCommand =
  | { kind: "move"; dx: number; dy: number; dz: number }
  | { kind: "copy"; dx: number; dy: number; dz: number }
  | { kind: "rotate"; axis: Frame3DAxis; angleDeg: number }
  | { kind: "mirror"; axis: Frame3DAxis; offset: number };

export interface Frame3DTransformResult {
  model: Frame3DModel;
  selection: Frame3DTransformSelection;
}

function selectedNodeIds(model: Frame3DModel, selection: Frame3DTransformSelection): number[] {
  if (selection.type === "multi") {
    for (const id of selection.nodeIds) {
      if (!model.nodes.some((node) => node.id === id)) throw new Error(`3D-knoop ${id} bestaat niet.`);
    }
    const ids = new Set(selection.nodeIds);
    for (const beamId of selection.beamIds) {
      const beam = model.beams.find((item) => item.id === beamId);
      if (!beam) throw new Error(`3D-staaf ${beamId} bestaat niet.`);
      ids.add(beam.startNodeId);
      ids.add(beam.endNodeId);
    }
    for (const plateId of selection.plateIds ?? []) {
      const plate = (model.plates ?? []).find((item) => item.id === plateId);
      if (!plate) throw new Error(`3D-plaat ${plateId} bestaat niet.`);
      plate.nodeIds.forEach((id) => ids.add(id));
      plate.openings?.forEach((opening) => opening.nodeIds.forEach((id) => ids.add(id)));
    }
    if (ids.size === 0) throw new Error("De 3D-selectie bevat geen knopen of staven.");
    return [...ids];
  }
  if (selection.type === "node") {
    if (!model.nodes.some((node) => node.id === selection.id)) throw new Error(`3D-knoop ${selection.id} bestaat niet.`);
    return [selection.id];
  }
  if (selection.type === "plate") {
    const plate = (model.plates ?? []).find((item) => item.id === selection.id);
    if (!plate) throw new Error(`3D-plaat ${selection.id} bestaat niet.`);
    return [...new Set([...plate.nodeIds, ...(plate.openings ?? []).flatMap((opening) => opening.nodeIds)])];
  }
  const beam = model.beams.find((item) => item.id === selection.id);
  if (!beam) throw new Error(`3D-staaf ${selection.id} bestaat niet.`);
  return [beam.startNodeId, beam.endNodeId];
}

function selectedBeamIds(model: Frame3DModel, selection: Frame3DTransformSelection): number[] {
  if (selection.type === "node" || selection.type === "plate") return [];
  const ids = selection.type === "beam" ? [selection.id] : selection.beamIds;
  for (const id of ids) {
    if (!model.beams.some((beam) => beam.id === id)) throw new Error(`3D-staaf ${id} bestaat niet.`);
  }
  return ids;
}

function selectedPlateIds(model: Frame3DModel, selection: Frame3DTransformSelection): number[] {
  const ids = selection.type === "plate" ? [selection.id] : selection.type === "multi" ? (selection.plateIds ?? []) : [];
  for (const id of ids) if (!(model.plates ?? []).some((plate) => plate.id === id)) throw new Error(`3D-plaat ${id} bestaat niet.`);
  return ids;
}

function finite(values: number[]) {
  if (values.some((value) => !Number.isFinite(value))) throw new Error("Vul eindige getallen in voor de 3D-bewerking.");
}

function rotatePoint(
  point: { x: number; y: number; z: number },
  center: { x: number; y: number; z: number },
  axis: Frame3DAxis,
  angleRad: number,
) {
  const x = point.x - center.x, y = point.y - center.y, z = point.z - center.z;
  const c = Math.cos(angleRad), s = Math.sin(angleRad);
  if (axis === "x") return { x: point.x, y: center.y + c * y - s * z, z: center.z + s * y + c * z };
  if (axis === "y") return { x: center.x + c * x + s * z, y: point.y, z: center.z - s * x + c * z };
  return { x: center.x + c * x - s * y, y: center.y + s * x + c * y, z: point.z };
}

/** Eén undo-bare modelwijziging voor de vier bewerkingen uit de gedeelde ribbon. */
export function transformFrame3D(
  model: Frame3DModel,
  selection: Frame3DTransformSelection,
  command: Frame3DTransformCommand,
): Frame3DTransformResult {
  const ids = selectedNodeIds(model, selection);
  const idSet = new Set(ids);
  if (command.kind === "move" || command.kind === "copy") finite([command.dx, command.dy, command.dz]);
  if (command.kind === "rotate") finite([command.angleDeg]);
  if (command.kind === "mirror") finite([command.offset]);

  if (command.kind === "copy") {
    const nextNode = Math.max(0, ...model.nodes.map((node) => node.id)) + 1;
    const idMap = new Map(ids.map((id, index) => [id, nextNode + index]));
    const copiedNodes = model.nodes.filter((node) => idSet.has(node.id)).map((node) => ({
      ...node,
      id: idMap.get(node.id)!,
      x: node.x + command.dx,
      y: node.y + command.dy,
      z: node.z + command.dz,
    }));
    const beamIds = selectedBeamIds(model, selection);
    const beamIdSet = new Set(beamIds);
    let nextBeam = Math.max(0, ...model.beams.map((beam) => beam.id)) + 1;
    const beamIdMap = new Map<number, number>();
    const copiedBeams = model.beams.filter((beam) => beamIdSet.has(beam.id)).map((source) => {
      const id = nextBeam++;
      beamIdMap.set(source.id, id);
      return {
        ...source,
        id,
        startNodeId: idMap.get(source.startNodeId)!,
        endNodeId: idMap.get(source.endNodeId)!,
      };
    });
    const copiedSupports = (model.supports ?? []).filter((support) => idSet.has(support.nodeId))
      .map((support) => ({ ...support, nodeId: idMap.get(support.nodeId)! }));
    let nextLoad = Math.max(0, ...(model.loads ?? []).map((load) => load.id)) + 1;
    const copiedLoads = (model.loads ?? []).filter((load) => idSet.has(load.nodeId))
      .map((load) => ({ ...load, id: nextLoad++, nodeId: idMap.get(load.nodeId)! }));
    let nextMemberLoad = Math.max(0, ...(model.memberLoads ?? []).map((load) => load.id)) + 1;
    const copiedMemberLoads = (model.memberLoads ?? []).filter((load) => beamIdSet.has(load.beamId))
      .map((load) => ({ ...load, id: nextMemberLoad++, beamId: beamIdMap.get(load.beamId)! }));
    let nextMemberPointLoad = Math.max(0, ...(model.memberPointLoads ?? []).map((load) => load.id)) + 1;
    const copiedMemberPointLoads = (model.memberPointLoads ?? []).filter((load) => beamIdSet.has(load.beamId))
      .map((load) => ({ ...load, id: nextMemberPointLoad++, beamId: beamIdMap.get(load.beamId)! }));
    let nextThermalLoad = Math.max(0, ...(model.thermalLoads ?? []).map((load) => load.id)) + 1;
    const copiedThermalLoads = (model.thermalLoads ?? []).filter((load) => beamIdSet.has(load.beamId))
      .map((load) => ({ ...load, id: nextThermalLoad++, beamId: beamIdMap.get(load.beamId)! }));
    const plateIds = selectedPlateIds(model, selection);
    const plateIdSet = new Set(plateIds);
    let nextPlate = Math.max(0, ...(model.plates ?? []).map((plate) => plate.id)) + 1;
    const plateIdMap = new Map<number, number>();
    const copiedPlates = (model.plates ?? []).filter((plate) => plateIdSet.has(plate.id)).map((plate) => {
      const id = nextPlate++;
      plateIdMap.set(plate.id, id);
      return {
        ...plate, id,
        nodeIds: plate.nodeIds.map((nodeId) => idMap.get(nodeId)!),
        openings: plate.openings?.map((opening) => ({ ...opening, nodeIds: opening.nodeIds.map((nodeId) => idMap.get(nodeId)!) })),
      };
    });
    let nextSurfaceLoad = Math.max(0, ...(model.surfaceLoads ?? []).map((load) => load.id)) + 1;
    const copiedSurfaceLoads = (model.surfaceLoads ?? []).filter((load) => plateIdSet.has(load.plateId))
      .map((load) => ({ ...load, id: nextSurfaceLoad++, plateId: plateIdMap.get(load.plateId)! }));
    return {
      model: {
        ...model,
        nodes: [...model.nodes, ...copiedNodes],
        beams: [...model.beams, ...copiedBeams],
        supports: [...(model.supports ?? []), ...copiedSupports],
        loads: [...(model.loads ?? []), ...copiedLoads],
        memberLoads: [...(model.memberLoads ?? []), ...copiedMemberLoads],
        memberPointLoads: [...(model.memberPointLoads ?? []), ...copiedMemberPointLoads],
        thermalLoads: [...(model.thermalLoads ?? []), ...copiedThermalLoads],
        plates: [...(model.plates ?? []), ...copiedPlates],
        surfaceLoads: [...(model.surfaceLoads ?? []), ...copiedSurfaceLoads],
      },
      selection: selection.type === "multi"
        ? {
            type: "multi",
            nodeIds: selection.nodeIds.map((id) => idMap.get(id)!),
            beamIds: selection.beamIds.map((id) => beamIdMap.get(id)!),
            ...(selection.plateIds?.length ? { plateIds: selection.plateIds.map((id) => plateIdMap.get(id)!) } : {}),
          }
        : selection.type === "beam"
          ? { type: "beam", id: beamIdMap.get(selection.id)! }
          : selection.type === "plate"
            ? { type: "plate", id: plateIdMap.get(selection.id)! }
          : { type: "node", id: idMap.get(selection.id)! },
    };
  }

  const selectedNodes = model.nodes.filter((node) => idSet.has(node.id));
  const center = selectedNodes.reduce((sum, node) => ({
    x: sum.x + node.x / selectedNodes.length,
    y: sum.y + node.y / selectedNodes.length,
    z: sum.z + node.z / selectedNodes.length,
  }), { x: 0, y: 0, z: 0 });
  const nodes = model.nodes.map((node) => {
    if (!idSet.has(node.id)) return node;
    if (command.kind === "move") return {
      ...node, x: node.x + command.dx, y: node.y + command.dy, z: node.z + command.dz,
    };
    if (command.kind === "rotate") return {
      ...node, ...rotatePoint(node, center, command.axis, command.angleDeg * Math.PI / 180),
    };
    const coordinate = node[command.axis];
    return { ...node, [command.axis]: 2 * command.offset - coordinate };
  });
  return { model: { ...model, nodes }, selection };
}

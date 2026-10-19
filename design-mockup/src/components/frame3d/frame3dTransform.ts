import type { Frame3DModel, Frame3DPlateBoundarySegment } from "./frame3dModel";
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

interface Frame3DTransformIndex {
  nodeIndexById: Map<number, number>;
  beamById: Map<number, Frame3DModel["beams"][number]>;
  plateById: Map<number, NonNullable<Frame3DModel["plates"]>[number]>;
}

function buildTransformIndex(model: Frame3DModel): Frame3DTransformIndex {
  const nodeIndexById = new Map<number, number>();
  for (let index = 0; index < model.nodes.length; index += 1) {
    nodeIndexById.set(model.nodes[index].id, index);
  }
  return {
    nodeIndexById,
    beamById: new Map(model.beams.map((beam) => [beam.id, beam])),
    plateById: new Map((model.plates ?? []).map((plate) => [plate.id, plate])),
  };
}

function nextId(items: ReadonlyArray<{ id: number }>): number {
  let maximum = 0;
  for (const item of items) if (item.id > maximum) maximum = item.id;
  return maximum + 1;
}

function remapPlateBoundary(
  boundary: Frame3DPlateBoundarySegment[] | undefined,
  idMap: ReadonlyMap<number, number>,
): Frame3DPlateBoundarySegment[] | undefined {
  return boundary?.map((segment) => segment.kind === "arc"
    ? {
        ...segment,
        startNodeId: idMap.get(segment.startNodeId)!,
        controlNodeId: idMap.get(segment.controlNodeId)!,
        endNodeId: idMap.get(segment.endNodeId)!,
      }
    : {
        ...segment,
        startNodeId: idMap.get(segment.startNodeId)!,
        endNodeId: idMap.get(segment.endNodeId)!,
      });
}

function selectedNodeIds(index: Frame3DTransformIndex, selection: Frame3DTransformSelection): number[] {
  if (selection.type === "multi") {
    for (const id of selection.nodeIds) {
      if (!index.nodeIndexById.has(id)) throw new Error(`3D-knoop ${id} bestaat niet.`);
    }
    const ids = new Set(selection.nodeIds);
    for (const beamId of selection.beamIds) {
      const beam = index.beamById.get(beamId);
      if (!beam) throw new Error(`3D-staaf ${beamId} bestaat niet.`);
      ids.add(beam.startNodeId);
      ids.add(beam.endNodeId);
    }
    for (const plateId of selection.plateIds ?? []) {
      const plate = index.plateById.get(plateId);
      if (!plate) throw new Error(`3D-plaat ${plateId} bestaat niet.`);
      plate.nodeIds.forEach((id) => ids.add(id));
      plate.openings?.forEach((opening) => opening.nodeIds.forEach((id) => ids.add(id)));
    }
    if (ids.size === 0) throw new Error("De 3D-selectie bevat geen knopen of staven.");
    return [...ids];
  }
  if (selection.type === "node") {
    if (!index.nodeIndexById.has(selection.id)) throw new Error(`3D-knoop ${selection.id} bestaat niet.`);
    return [selection.id];
  }
  if (selection.type === "plate") {
    const plate = index.plateById.get(selection.id);
    if (!plate) throw new Error(`3D-plaat ${selection.id} bestaat niet.`);
    return [...new Set([...plate.nodeIds, ...(plate.openings ?? []).flatMap((opening) => opening.nodeIds)])];
  }
  const beam = index.beamById.get(selection.id);
  if (!beam) throw new Error(`3D-staaf ${selection.id} bestaat niet.`);
  return [beam.startNodeId, beam.endNodeId];
}

function selectedBeamIds(index: Frame3DTransformIndex, selection: Frame3DTransformSelection): number[] {
  if (selection.type === "node" || selection.type === "plate") return [];
  const ids = selection.type === "beam" ? [selection.id] : selection.beamIds;
  for (const id of ids) {
    if (!index.beamById.has(id)) throw new Error(`3D-staaf ${id} bestaat niet.`);
  }
  return ids;
}

function selectedPlateIds(index: Frame3DTransformIndex, selection: Frame3DTransformSelection): number[] {
  const ids = selection.type === "plate" ? [selection.id] : selection.type === "multi" ? (selection.plateIds ?? []) : [];
  for (const id of ids) if (!index.plateById.has(id)) throw new Error(`3D-plaat ${id} bestaat niet.`);
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
  const index = buildTransformIndex(model);
  const ids = selectedNodeIds(index, selection);
  const idSet = new Set(ids);
  if (command.kind === "move" || command.kind === "copy") finite([command.dx, command.dy, command.dz]);
  if (command.kind === "rotate") finite([command.angleDeg]);
  if (command.kind === "mirror") finite([command.offset]);
  if (command.kind === "move" && command.dx === 0 && command.dy === 0 && command.dz === 0) {
    return { model, selection };
  }
  if (command.kind === "rotate" && command.angleDeg % 360 === 0) {
    return { model, selection };
  }

  if (command.kind === "copy") {
    const nextNode = nextId(model.nodes);
    const idMap = new Map(ids.map((id, selectionIndex) => [id, nextNode + selectionIndex]));
    const copiedNodes = ids.map((sourceId) => model.nodes[index.nodeIndexById.get(sourceId)!]).map((node) => ({
      ...node,
      id: idMap.get(node.id)!,
      x: node.x + command.dx,
      y: node.y + command.dy,
      z: node.z + command.dz,
    }));
    const beamIds = selectedBeamIds(index, selection);
    const beamIdSet = new Set(beamIds);
    let nextBeam = nextId(model.beams);
    const beamIdMap = new Map<number, number>();
    const copiedBeams = beamIds.map((beamId) => index.beamById.get(beamId)!).map((source) => {
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
    let nextLoad = nextId(model.loads ?? []);
    const copiedLoads = (model.loads ?? []).filter((load) => idSet.has(load.nodeId))
      .map((load) => ({ ...load, id: nextLoad++, nodeId: idMap.get(load.nodeId)! }));
    let nextMemberLoad = nextId(model.memberLoads ?? []);
    const copiedMemberLoads = (model.memberLoads ?? []).filter((load) => beamIdSet.has(load.beamId))
      .map((load) => ({ ...load, id: nextMemberLoad++, beamId: beamIdMap.get(load.beamId)! }));
    let nextMemberPointLoad = nextId(model.memberPointLoads ?? []);
    const copiedMemberPointLoads = (model.memberPointLoads ?? []).filter((load) => beamIdSet.has(load.beamId))
      .map((load) => ({ ...load, id: nextMemberPointLoad++, beamId: beamIdMap.get(load.beamId)! }));
    let nextThermalLoad = nextId(model.thermalLoads ?? []);
    const copiedThermalLoads = (model.thermalLoads ?? []).filter((load) => beamIdSet.has(load.beamId))
      .map((load) => ({ ...load, id: nextThermalLoad++, beamId: beamIdMap.get(load.beamId)! }));
    const plateIds = selectedPlateIds(index, selection);
    const plateIdSet = new Set(plateIds);
    let nextPlate = nextId(model.plates ?? []);
    const plateIdMap = new Map<number, number>();
    const copiedPlates = plateIds.map((plateId) => index.plateById.get(plateId)!).map((plate) => {
      const id = nextPlate++;
      plateIdMap.set(plate.id, id);
      return {
        ...plate, id,
        nodeIds: plate.nodeIds.map((nodeId) => idMap.get(nodeId)!),
        ...(plate.boundary ? { boundary: remapPlateBoundary(plate.boundary, idMap) } : {}),
        openings: plate.openings?.map((opening) => ({
          ...opening,
          nodeIds: opening.nodeIds.map((nodeId) => idMap.get(nodeId)!),
          ...(opening.boundary ? { boundary: remapPlateBoundary(opening.boundary, idMap) } : {}),
        })),
      };
    });
    let nextSurfaceLoad = nextId(model.surfaceLoads ?? []);
    const copiedSurfaceLoads = (model.surfaceLoads ?? []).filter((load) => plateIdSet.has(load.plateId))
      .map((load) => ({ ...load, id: nextSurfaceLoad++, plateId: plateIdMap.get(load.plateId)! }));
    let nextPlateEdgeLoad = nextId(model.plateEdgeLoads ?? []);
    const copiedPlateEdgeLoads = (model.plateEdgeLoads ?? []).filter((load) => plateIdSet.has(load.plateId))
      .map((load) => ({ ...load, id: nextPlateEdgeLoad++, plateId: plateIdMap.get(load.plateId)! }));
    return {
      model: {
        ...model,
        nodes: [...model.nodes, ...copiedNodes],
        beams: [...model.beams, ...copiedBeams],
        supports: copiedSupports.length > 0 ? [...(model.supports ?? []), ...copiedSupports] : model.supports,
        loads: copiedLoads.length > 0 ? [...(model.loads ?? []), ...copiedLoads] : model.loads,
        memberLoads: copiedMemberLoads.length > 0 ? [...(model.memberLoads ?? []), ...copiedMemberLoads] : model.memberLoads,
        memberPointLoads: copiedMemberPointLoads.length > 0
          ? [...(model.memberPointLoads ?? []), ...copiedMemberPointLoads] : model.memberPointLoads,
        thermalLoads: copiedThermalLoads.length > 0
          ? [...(model.thermalLoads ?? []), ...copiedThermalLoads] : model.thermalLoads,
        plates: copiedPlates.length > 0 ? [...(model.plates ?? []), ...copiedPlates] : model.plates,
        surfaceLoads: copiedSurfaceLoads.length > 0
          ? [...(model.surfaceLoads ?? []), ...copiedSurfaceLoads] : model.surfaceLoads,
        plateEdgeLoads: copiedPlateEdgeLoads.length > 0
          ? [...(model.plateEdgeLoads ?? []), ...copiedPlateEdgeLoads] : model.plateEdgeLoads,
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

  const selectedNodes = ids.map((id) => model.nodes[index.nodeIndexById.get(id)!]);
  const center = selectedNodes.reduce((sum, node) => ({
    x: sum.x + node.x / ids.length,
    y: sum.y + node.y / ids.length,
    z: sum.z + node.z / ids.length,
  }), { x: 0, y: 0, z: 0 });
  const nodes = model.nodes.slice();
  let changed = false;
  for (const id of ids) {
    const nodeIndex = index.nodeIndexById.get(id)!;
    const node = model.nodes[nodeIndex];
    let next: typeof node;
    if (command.kind === "move") next = {
      ...node, x: node.x + command.dx, y: node.y + command.dy, z: node.z + command.dz,
    };
    else if (command.kind === "rotate") next = {
      ...node, ...rotatePoint(node, center, command.axis, command.angleDeg * Math.PI / 180),
    };
    else {
      const coordinate = node[command.axis];
      next = { ...node, [command.axis]: 2 * command.offset - coordinate };
    }
    if (next.x !== node.x || next.y !== node.y || next.z !== node.z) changed = true;
    nodes[nodeIndex] = next;
  }
  if (!changed) return { model, selection };
  return { model: { ...model, nodes }, selection };
}

import { assertOpenFem3DBeddingFitsGeometry, type OpenFem3DModel, type OpenFem3DPlateBoundarySegment } from "./openFem3dModel";
import type { OpenFem3DMultiSelection, OpenFem3DSingleSelection } from "./openFem3dSelection";
import { withConsistentOpenFem3DPlateLevels } from "./openFem3dLevels";

export type OpenFem3DTransformSelection =
  | Extract<OpenFem3DSingleSelection, { type: "node" | "beam" | "plate" | "envelopePanel" }>
  | OpenFem3DMultiSelection;
export type OpenFem3DAxis = "x" | "y" | "z";
export type OpenFem3DTransformCommand =
  | { kind: "move"; dx: number; dy: number; dz: number }
  | { kind: "copy"; dx: number; dy: number; dz: number }
  | { kind: "rotate"; axis: OpenFem3DAxis; angleDeg: number }
  | { kind: "mirror"; axis: OpenFem3DAxis; offset: number };

export interface OpenFem3DTransformResult {
  model: OpenFem3DModel;
  selection: OpenFem3DTransformSelection;
}

interface OpenFem3DTransformIndex {
  nodeIndexById: Map<number, number>;
  beamById: Map<number, OpenFem3DModel["beams"][number]>;
  plateById: Map<number, NonNullable<OpenFem3DModel["plates"]>[number]>;
  envelopePanelById: Map<number, NonNullable<OpenFem3DModel["envelopePanels"]>[number]>;
}

function buildTransformIndex(model: OpenFem3DModel): OpenFem3DTransformIndex {
  const nodeIndexById = new Map<number, number>();
  for (let index = 0; index < model.nodes.length; index += 1) {
    nodeIndexById.set(model.nodes[index].id, index);
  }
  return {
    nodeIndexById,
    beamById: new Map(model.beams.map((beam) => [beam.id, beam])),
    plateById: new Map((model.plates ?? []).map((plate) => [plate.id, plate])),
    envelopePanelById: new Map((model.envelopePanels ?? []).map((panel) => [panel.id, panel])),
  };
}

function nextId(items: ReadonlyArray<{ id: number }>): number {
  let maximum = 0;
  for (const item of items) if (item.id > maximum) maximum = item.id;
  return maximum + 1;
}

function remapPlateBoundary(
  boundary: OpenFem3DPlateBoundarySegment[] | undefined,
  idMap: ReadonlyMap<number, number>,
): OpenFem3DPlateBoundarySegment[] | undefined {
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

function selectedNodeIds(index: OpenFem3DTransformIndex, selection: OpenFem3DTransformSelection): number[] {
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
  if (selection.type === "envelopePanel") {
    const panel = index.envelopePanelById.get(selection.id);
    if (!panel) throw new Error(`3D-schilpaneel ${selection.id} bestaat niet.`);
    return [...new Set([...panel.nodeIds, ...(panel.openings ?? []).flatMap((opening) => opening.nodeIds)])];
  }
  const beam = index.beamById.get(selection.id);
  if (!beam) throw new Error(`3D-staaf ${selection.id} bestaat niet.`);
  return [beam.startNodeId, beam.endNodeId];
}

function selectedBeamIds(index: OpenFem3DTransformIndex, selection: OpenFem3DTransformSelection): number[] {
  if (selection.type === "node" || selection.type === "plate" || selection.type === "envelopePanel") return [];
  const ids = selection.type === "beam" ? [selection.id] : selection.beamIds;
  for (const id of ids) {
    if (!index.beamById.has(id)) throw new Error(`3D-staaf ${id} bestaat niet.`);
  }
  return ids;
}

function selectedPlateIds(index: OpenFem3DTransformIndex, selection: OpenFem3DTransformSelection): number[] {
  const ids = selection.type === "plate" ? [selection.id] : selection.type === "multi" ? (selection.plateIds ?? []) : [];
  for (const id of ids) if (!index.plateById.has(id)) throw new Error(`3D-plaat ${id} bestaat niet.`);
  return ids;
}

/**
 * Een knoop hangt alleen aan zijn level zolang hij op die hoogte blijft: wie
 * hem verticaal verplaatst, om X/Y roteert of in Z spiegelt, maakt hem los.
 * Een kopie op dezelfde hoogte blijft aan hetzelfde level hangen.
 */
function keepLevelLink<T extends OpenFem3DModel["nodes"][number]>(before: { z: number }, next: T): T {
  if (next.levelId === undefined || next.z === before.z) return next;
  const { levelId: _levelId, ...unlinked } = next;
  return unlinked as T;
}

function finite(values: number[]) {
  if (values.some((value) => !Number.isFinite(value))) throw new Error("Vul eindige getallen in voor de 3D-bewerking.");
}

function rotatePoint(
  point: { x: number; y: number; z: number },
  center: { x: number; y: number; z: number },
  axis: OpenFem3DAxis,
  angleRad: number,
) {
  const x = point.x - center.x, y = point.y - center.y, z = point.z - center.z;
  const c = Math.cos(angleRad), s = Math.sin(angleRad);
  if (axis === "x") return { x: point.x, y: center.y + c * y - s * z, z: center.z + s * y + c * z };
  if (axis === "y") return { x: center.x + c * x + s * z, y: point.y, z: center.z - s * x + c * z };
  return { x: center.x + c * x - s * y, y: center.y + s * x + c * y, z: point.z };
}

/** Eén undo-bare modelwijziging voor de vier bewerkingen uit de gedeelde ribbon. */
export function transformOpenFem3D(
  model: OpenFem3DModel,
  selection: OpenFem3DTransformSelection,
  command: OpenFem3DTransformCommand,
): OpenFem3DTransformResult {
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
    const copiedNodes = ids.map((sourceId) => model.nodes[index.nodeIndexById.get(sourceId)!]).map((node) => keepLevelLink(node, {
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
    const panelIds = selection.type === "envelopePanel" ? [selection.id]
      : (model.envelopePanels ?? []).filter((panel) =>
        [...panel.nodeIds, ...(panel.openings ?? []).flatMap((opening) => opening.nodeIds)]
          .every((id) => idSet.has(id))).map((panel) => panel.id);
    let nextPanel = nextId(model.envelopePanels ?? []);
    const panelIdMap = new Map<number, number>();
    const copiedPanels = panelIds.map((panelId) => index.envelopePanelById.get(panelId)!).map((panel) => {
      const id = nextPanel++;
      panelIdMap.set(panel.id, id);
      return {
        ...panel, id,
        nodeIds: panel.nodeIds.map((nodeId) => idMap.get(nodeId)!),
        openings: panel.openings?.map((opening) => ({
          ...opening, nodeIds: opening.nodeIds.map((nodeId) => idMap.get(nodeId)!),
        })),
      };
    });
    let nextSurfaceLoad = nextId(model.surfaceLoads ?? []);
    const copiedSurfaceLoads = (model.surfaceLoads ?? []).filter((load) => plateIdSet.has(load.plateId))
      .map((load) => ({ ...load, id: nextSurfaceLoad++, plateId: plateIdMap.get(load.plateId)! }));
    return {
      // Een kopie op een andere hoogte verliest de levelkoppeling van haar
      // knopen, en daarmee ook die van haar platen.
      model: withConsistentOpenFem3DPlateLevels({
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
        envelopePanels: copiedPanels.length > 0
          ? [...(model.envelopePanels ?? []), ...copiedPanels] : model.envelopePanels,
        surfaceLoads: copiedSurfaceLoads.length > 0
          ? [...(model.surfaceLoads ?? []), ...copiedSurfaceLoads] : model.surfaceLoads,
      }),
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
          : selection.type === "envelopePanel"
            ? { type: "envelopePanel", id: panelIdMap.get(selection.id)! }
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
    nodes[nodeIndex] = keepLevelLink(node, next);
  }
  if (!changed) return { model, selection };
  const envelopePanels = command.kind === "mirror" || command.kind === "rotate"
    ? (model.envelopePanels ?? []).map((panel) => {
        const allNodeIds = [...panel.nodeIds, ...(panel.openings ?? []).flatMap((opening) => opening.nodeIds)];
        if (!allNodeIds.every((id) => idSet.has(id))) return panel;
        const spanDirection = panel.spanDirection && (command.kind === "rotate"
          ? rotatePoint(panel.spanDirection, { x: 0, y: 0, z: 0 }, command.axis, command.angleDeg * Math.PI / 180)
          : { ...panel.spanDirection, [command.axis]: -panel.spanDirection[command.axis] });
        return {
          ...panel,
          ...(spanDirection ? { spanDirection } : {}),
          ...(command.kind === "mirror" ? { flipOuterSide: !panel.flipOuterSide } : {}),
        };
      })
    : model.envelopePanels;
  const next = withConsistentOpenFem3DPlateLevels({ ...model, nodes, envelopePanels });
  // Draaien, spiegelen of verplaatsen mag een staaf op een verticale bedding
  // (k) niet verticaal zetten (#106): dezelfde regel als bij het lezen.
  assertOpenFem3DBeddingFitsGeometry(next, model.beams
    .filter((beam) => idSet.has(beam.startNodeId) || idSet.has(beam.endNodeId)).map((beam) => beam.id));
  return { model: next, selection };
}

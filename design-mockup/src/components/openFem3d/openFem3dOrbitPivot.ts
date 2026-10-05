import * as THREE from "three";
import type { OpenFem3DModel } from "./openFem3dModel";
import type { OpenFem3DSelection } from "./openFem3dSelection";

/**
 * Het draaipunt bij een selectie: het midden van het omhullende kader van de
 * geselecteerde knopen, staafeinden en plaathoeken. Een last draait om het
 * element waar hij op staat. Zonder (bestaande) selectie: `null`.
 */
export function openFem3DSelectionPivot(model: OpenFem3DModel, selection: OpenFem3DSelection): THREE.Vector3 | null {
  if (!selection) return null;
  const nodeIds = new Set<number>();
  // Een kaderselectie kan duizenden staven bevatten: zoek via een index.
  let beamById: Map<number, OpenFem3DModel["beams"][number]> | null = null;
  let plateById: Map<number, NonNullable<OpenFem3DModel["plates"]>[number]> | null = null;
  const addBeam = (beamId: number) => {
    beamById ??= new Map(model.beams.map((item) => [item.id, item]));
    const beam = beamById.get(beamId);
    if (beam) { nodeIds.add(beam.startNodeId); nodeIds.add(beam.endNodeId); }
  };
  const addPlate = (plateId: number) => {
    plateById ??= new Map((model.plates ?? []).map((item) => [item.id, item]));
    plateById.get(plateId)?.nodeIds.forEach((id) => nodeIds.add(id));
  };
  switch (selection.type) {
    case "node": nodeIds.add(selection.id); break;
    case "beam": addBeam(selection.id); break;
    case "plate": addPlate(selection.id); break;
    case "multi": {
      selection.nodeIds.forEach((id) => nodeIds.add(id));
      selection.beamIds.forEach(addBeam);
      selection.plateIds?.forEach(addPlate);
      // Lasten uit het selectiefilter (issue #94): om het element waar ze op staan.
      const loads = selection.loads;
      if (loads) {
        const gekozen = (ids: number[] | undefined) => new Set(ids ?? []);
        const nodal = gekozen(loads.nodalLoad);
        (model.loads ?? []).forEach((load) => { if (nodal.has(load.id)) nodeIds.add(load.nodeId); });
        for (const [list, ids] of [[model.memberLoads, loads.memberLoad], [model.memberPointLoads, loads.memberPointLoad],
          [model.thermalLoads, loads.thermalLoad]] as const) {
          const set = gekozen(ids);
          (list ?? []).forEach((load) => { if (set.has(load.id)) addBeam(load.beamId); });
        }
        const surface = gekozen(loads.surfaceLoad);
        (model.surfaceLoads ?? []).forEach((load) => { if (surface.has(load.id)) addPlate(load.plateId); });
        const panels = gekozen(loads.loadPanel);
        (model.loadPanels ?? []).forEach((panel) => { if (panels.has(panel.id)) panel.nodeIds.forEach((id) => nodeIds.add(id)); });
      }
      break;
    }
    case "nodalLoad": {
      const load = (model.loads ?? []).find((item) => item.id === selection.id);
      if (load) nodeIds.add(load.nodeId);
      break;
    }
    case "memberLoad": case "memberPointLoad": case "thermalLoad": {
      const loads = selection.type === "memberLoad" ? model.memberLoads
        : selection.type === "memberPointLoad" ? model.memberPointLoads : model.thermalLoads;
      const load = (loads ?? []).find((item) => item.id === selection.id);
      if (load) addBeam(load.beamId);
      break;
    }
    case "surfaceLoad": {
      const load = (model.surfaceLoads ?? []).find((item) => item.id === selection.id);
      if (load) addPlate(load.plateId);
      break;
    }
  }
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const node of model.nodes) {
    if (nodeIds.has(node.id)) box.expandByPoint(point.set(node.x, node.y, node.z));
  }
  return box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
}

/**
 * Verschuiving van camera én doel na één draaistap van de besturing.
 *
 * OrbitControls draait de camera om zijn doel t: p' = t + R(p − t), met
 * R = q_na · q_voor⁻¹ (de verandering van het camera-quaternion). Draaien om
 * het draaipunt c had p'' = c + R(p − c) gegeven; het verschil is
 * p'' − p' = (I − R)(c − t), en het doel verschuift over hetzelfde stuk.
 * Na die verschuiving heeft c in het camerastelsel dezelfde coördinaten als
 * vóór de stap: het draaipunt blijft op dezelfde schermplek, zonder sprong.
 */
export function openFem3DOrbitPivotShift(
  before: THREE.Quaternion,
  after: THREE.Quaternion,
  pivot: THREE.Vector3,
  target: THREE.Vector3,
): THREE.Vector3 {
  const rotation = after.clone().multiply(before.clone().invert());
  const offset = pivot.clone().sub(target);
  return offset.clone().sub(offset.clone().applyQuaternion(rotation));
}

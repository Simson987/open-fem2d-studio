import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const source = new URL("../../docs/verificatie/3d-volume/tet4-tri3-raamwerk-j2-gekoppeld.ifcfem2d", import.meta.url);
const target = new URL("../../docs/verificatie/3d-volume/tet4-hex8-tri3-raamwerk-j2-gekoppeld.ifcfem2d", import.meta.url);
const plasticTarget = new URL("../../docs/verificatie/3d-volume/tet4-hex8-tri3-raamwerk-j2-plastisch.ifcfem2d", import.meta.url);
const unloadTarget = new URL("../../docs/verificatie/3d-volume/tet4-hex8-tri3-raamwerk-j2-ontlasten.ifcfem2d", import.meta.url);
const project = JSON.parse(readFileSync(source, "utf8"));
assert.deepEqual([project.model3d.volumes.length, project.model3d.plates.length,
  project.model3d.beams.length], [1, 1, 1]);
const model = project.model3d;
model.nodes = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1], [1, -1, 0],
  [2, 0, 0], [2, 1, 0], [2, 0, 1]]
  .map(([x, y, z], index) => ({ id: index + 1, x, y, z }));
model.volumes = [
  { ...model.volumes[0], id: 1, kind: "hex8", nodeIds: [1, 2, 3, 4, 5, 6, 7, 8] },
  { ...model.volumes[0], id: 4, kind: "tet4", nodeIds: [2, 10, 11, 12] },
];
model.plates = [{ ...model.plates[0], nodeIds: [1, 2, 4] }];
model.beams = [{ ...model.beams[0], startNodeId: 2, endNodeId: 9 }];
model.supports = model.nodes.filter(node => node.id !== 9).map(node => ({
  nodeId: node.id, ux: node.id !== 2, uy: true, uz: true,
  rx: node.id === 2, ry: node.id === 2, rz: node.id === 2,
}));
model.loads = [{ ...model.loads[0], nodeId: 9 }];
project.projectInfo = {
  name: "Gekoppelde Hex8, Tet4, Tri3-membraan en 3D-buigstaaf (J2/GNL)",
  projectNumber: "VF-HEX8-TET4-TRI3-FRAME-J2-01",
};
writeFileSync(target, `${JSON.stringify(project)}\n`);
console.log(`Wrote ${target.pathname}: Hex8, Tet4, Tri3, 3D frame, small-load J2/GNL reference.`);
const plastic = structuredClone(project);
plastic.projectInfo = {
  name: "Gekoppelde Hex8, Tet4, Tri3 en 3D-staaf: volumeplastificatie",
  projectNumber: "VF-HEX8-TET4-TRI3-FRAME-J2-02",
};
plastic.loadCases = [{ id: 1, name: "Tipdwarskracht 5 kN", type: "live" }];
plastic.model3d.loads[0].fx = 5;
plastic.model3d.materialLoadPath = [0.25, 0.5, 1];
plastic.model3d.volumes = plastic.model3d.volumes.map(volume => ({ ...volume,
  materialLaw: { kind: "steelJ2", yieldMpa: 0.001, hardeningMpa: 300 } }));
writeFileSync(plasticTarget, `${JSON.stringify(plastic)}\n`);
console.log(`Wrote ${plasticTarget.pathname}: plastic Hex8 and Tet4 with shared membrane/frame.`);
const unloaded = structuredClone(plastic);
unloaded.projectInfo = {
  name: "Gekoppelde Hex8, Tet4, Tri3 en 3D-staaf: plastisch ontlasten",
  projectNumber: "VF-HEX8-TET4-TRI3-FRAME-J2-03",
};
unloaded.model3d.materialLoadPath = [0.25, 0.5, 1, 0];
writeFileSync(unloadTarget, `${JSON.stringify(unloaded)}\n`);
console.log(`Wrote ${unloadTarget.pathname}: unloaded plastic Hex8 and Tet4 with residual displacement.`);

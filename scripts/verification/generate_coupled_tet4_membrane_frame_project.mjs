import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const source = new URL("../../docs/verificatie/3d-volume/tet4-tri3-membraan.ifcfem2d", import.meta.url);
const target = new URL("../../docs/verificatie/3d-volume/tet4-tri3-raamwerk-j2-gekoppeld.ifcfem2d", import.meta.url);
const project = JSON.parse(readFileSync(source, "utf8"));
const model = project.model3d;
assert.deepEqual([model.volumes.length, model.plates.length, model.beams.length], [1, 1, 0]);
project.savedAt = "2026-10-11T00:00:00.000Z";
project.analysetype = "tweedeOrdeFysisch";
project.projectInfo = {
  name: "Gedeelde Tet4, Tri3-membraan en 3D-buigstaaf (J2/GNL)",
  projectNumber: "VF-TET4-TRI3-FRAME-J2-01",
};
project.loadCases = [{ id: 1, name: "Tipdwarskracht 0,05 kN", type: "live" }];
model.nodes.push({ id: 50, x: 1, y: 1, z: 0 });
model.beams = [{ id: 3, startNodeId: 20, endNodeId: 50,
  profileName: "200x100", material: "VRIJ:Teststaal E=200000 rho=7850 f=235" }];
model.volumes = model.volumes.map((volume) => ({ ...volume,
  materialLaw: { kind: "steelJ2", yieldMpa: 1_000_000, hardeningMpa: 2_000 } }));
model.supports = model.supports.map((support) => support.nodeId === 20
  ? { ...support, rx: true, ry: true, rz: true } : support);
model.loads = [{ id: 1, nodeId: 50, caseId: 1,
  fx: 0.05, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }];
model.surfaceLoads = [];
model.volumeMaterialKinematics = "finiteStrain";
model.volumeResidualTolerance = 1e-8;
model.materialLoadPath = [0.5, 1];
model.volumeBackend = "frontalWave";
writeFileSync(target, `${JSON.stringify(project)}\n`);
console.log(`Wrote ${target.pathname}: Tet4, Tri3, 3D frame, small-load J2/GNL reference.`);

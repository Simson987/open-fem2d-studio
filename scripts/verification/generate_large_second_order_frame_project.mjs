import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const source = new URL("../../docs/verificatie/3d-volume/hex8-verbonden-raamwerk-5104-staven.ifcfem2d", import.meta.url);
const target = new URL("../../docs/verificatie/3d-volume/hex8-verbonden-raamwerk-5104-staven-gnl-j2-druk.ifcfem2d", import.meta.url);
const project = JSON.parse(readFileSync(source, "utf8"));
const endX = Math.max(...project.model3d.nodes.map(node => node.x));
const endNodes = project.model3d.nodes.filter(node => node.x === endX);
assert.deepEqual([project.model3d.nodes.length, project.model3d.beams.length,
  project.model3d.volumes.length, endNodes.length], [2_048, 5_104, 1, 16]);

project.savedAt = "2026-10-09T00:00:00.000Z";
project.projectInfo = { name: "3D-raamwerk met 5.104 staven, Hex8 en tweede-orde druk",
  projectNumber: "VF-FRAME-5104-HEX8-GNL-J2" };
project.analysetype = "tweedeOrdeFysisch";
project.model3d.volumes = project.model3d.volumes.map(volume => ({ ...volume,
  materialLaw: { kind: "steelJ2", yieldMpa: 235, hardeningMpa: 300 } }));
project.model3d.loads = endNodes.map((node, index) => ({
  id: index + 1, nodeId: node.id, fx: -5_000 / 16, fy: 0, fz: -10 / 16,
  mx: 0, my: 0, mz: 0, caseId: project.activeLoadCaseId,
}));
project.model3d.volumeMaterialKinematics = "finiteStrain";
project.model3d.materialLoadPath = [0.25, 0.5, 0.75, 1];
project.model3d.volumeBackend = "automatic";
project.model3d.volumeResidualTolerance = 1e-8;
project.model3d.volumeThreads = 4;

writeFileSync(target, `${JSON.stringify(project)}\n`);
console.log(`Wrote ${target.pathname}: ${project.model3d.beams.length} frames, `
  + `${project.model3d.volumes.length} Hex8, ${project.model3d.loads.length} tip loads.`);

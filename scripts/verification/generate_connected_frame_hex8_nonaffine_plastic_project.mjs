import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const source = new URL("../../docs/verificatie/3d-volume/hex8-verbonden-raamwerk-1143-volumes-5104-staven-j2-buiging.ifcfem2d", import.meta.url);
const target = new URL("../../docs/verificatie/3d-volume/hex8-verbonden-raamwerk-1143-volumes-5104-staven-j2-plastische-buiging.ifcfem2d", import.meta.url);
const unloadTarget = new URL("../../docs/verificatie/3d-volume/hex8-verbonden-raamwerk-1143-volumes-5104-staven-j2-plastische-buiging-ontlast.ifcfem2d", import.meta.url);
const softFourStepTarget = new URL("../../docs/verificatie/3d-volume/hex8-verbonden-raamwerk-1143-volumes-5104-staven-j2-plastische-buiging-4-stappen.ifcfem2d", import.meta.url);
const memberLoadTarget = new URL("../../docs/verificatie/3d-volume/hex8-verbonden-raamwerk-1143-volumes-5104-staven-j2-punt-en-lijnlast.ifcfem2d", import.meta.url);
const project = JSON.parse(readFileSync(source, "utf8"));
assert.deepEqual([project.model3d.nodes.length, project.model3d.beams.length,
  project.model3d.volumes.length], [2_048, 5_104, 1_143]);
assert.equal(project.analysetype, "tweedeOrdeFysisch");

project.savedAt = "2026-10-09T00:00:00.000Z";
project.projectInfo = {
  name: "Plastische Hex8-buiging: 5.104 staven en 1.143 volumes",
  projectNumber: "VF-FRAME-HEX8-J2-PLASTIC-BENDING-1143",
};
project.model3d.volumes = project.model3d.volumes.map(volume => ({ ...volume,
  materialLaw: { kind: "steelJ2", yieldMpa: 0.001, hardeningMpa: 3_000 } }));
project.model3d.materialLoadPath = [1];
project.model3d.volumeMaterialKinematics = "finiteStrain";
project.model3d.volumeBackend = "automatic";
project.model3d.volumeResidualTolerance = 1e-8;

writeFileSync(target, `${JSON.stringify(project)}\n`);
const unloadProject = structuredClone(project);
unloadProject.projectInfo = {
  name: "Plastische Hex8-buiging en ontlasting: 5.104 staven en 1.143 volumes",
  projectNumber: "VF-FRAME-HEX8-J2-PLASTIC-BENDING-1143-UNLOAD",
};
unloadProject.model3d.materialLoadPath = [1, 0];
writeFileSync(unloadTarget, `${JSON.stringify(unloadProject)}\n`);
const softFourStepProject = structuredClone(project);
softFourStepProject.projectInfo = {
  name: "Vierstaps plastische Hex8-buiging: 5.104 staven en 1.143 volumes",
  projectNumber: "VF-FRAME-HEX8-J2-PLASTIC-BENDING-1143-FOUR-STEPS",
};
softFourStepProject.model3d.volumes = softFourStepProject.model3d.volumes.map(volume => ({
  ...volume,
  materialLaw: { kind: "steelJ2", yieldMpa: 0.001, hardeningMpa: 300 },
}));
softFourStepProject.model3d.materialLoadPath = [0.25, 0.5, 0.75, 1];
softFourStepProject.model3d.volumeResidualTolerance = 1e-7;
writeFileSync(softFourStepTarget, `${JSON.stringify(softFourStepProject)}\n`);
const memberLoadProject = structuredClone(project);
memberLoadProject.projectInfo = {
  name: "Plastisch Hex8-raamwerk met punt- en lijnlast: 5.104 staven",
  projectNumber: "VF-FRAME-HEX8-J2-MEMBER-LOADS-1143",
};
assert.equal(memberLoadProject.model3d.beams.find(beam => beam.id === 5_080)?.endNodeId, 2_048);
memberLoadProject.model3d.memberPointLoads = [{ id: 1, beamId: 5_080, caseId: 1,
  py: 0, pz: -1, positionM: 0.125 }];
memberLoadProject.model3d.memberLoads = [{ id: 1, beamId: 5_080, caseId: 1,
  qyStart: 0, qyEnd: 0, qzStart: -1, qzEnd: -1,
  startPositionM: 0, endPositionM: 0.25 }];
writeFileSync(memberLoadTarget, `${JSON.stringify(memberLoadProject)}\n`);
console.log(`Wrote loaded, unloaded, four-step and member-loaded projects: ${project.model3d.beams.length} frames, `
  + `${project.model3d.volumes.length} plastic Hex8 each.`);

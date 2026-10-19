import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const source = new URL("../../docs/verificatie/3d-volume/tet4-hex8-j2-buigraamwerk.ifcfem2d", import.meta.url);
const target = new URL("../../docs/verificatie/3d-volume/tet4-hex8-j2-raamwerk-punt-en-lijnlast.ifcfem2d", import.meta.url);
const project = JSON.parse(readFileSync(source, "utf8"));
assert.equal(project.analysetype, "tweedeOrdeFysisch");
assert.deepEqual([project.model3d.beams.length, project.model3d.volumes.length], [1, 3]);

project.savedAt = "2026-10-11T00:00:00.000Z";
project.projectInfo = {
  name: "Gekoppelde 3D-staaf met druk, punt- en lijnlast op Tet4/Hex8",
  projectNumber: "VF-COUPLED-J2-FRAME-MEMBER-LOADS",
};
project.model3d.loads = project.model3d.loads.map(load => load.id === 1
  ? { ...load, fx: -250, fz: 0 } : load);
project.model3d.memberPointLoads = [{ id: 1, beamId: 1, caseId: project.activeLoadCaseId,
  py: 0, pz: -0.1, positionM: 0.5 }];
project.model3d.memberLoads = [{ id: 1, beamId: 1, caseId: project.activeLoadCaseId,
  qyStart: 0, qyEnd: 0, qzStart: -0.1, qzEnd: -0.1,
  startPositionM: 0, endPositionM: 1 }];
project.model3d.volumeResidualTolerance = 1e-8;
writeFileSync(target, `${JSON.stringify(project)}\n`);
console.log(`Wrote ${target.pathname}: ${project.model3d.beams.length} frame, `
  + `${project.model3d.volumes.length} volumes, two member loads.`);

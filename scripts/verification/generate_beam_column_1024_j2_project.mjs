import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const source = new URL("../../docs/verificatie/3d-volume/tet4-hex8-j2-buigraamwerk.ifcfem2d", import.meta.url);
const target = new URL("../../docs/verificatie/3d-volume/tet4-j2-staafkolom-1024-elementen.ifcfem2d", import.meta.url);
const project = JSON.parse(readFileSync(source, "utf8"));
const segmentCount = 1_024;
const lengthM = 20;

const nodes = [
  { id: 1, x: 0, y: 0, z: 0 },
  { id: 2, x: -1, y: 0, z: 0 },
  { id: 3, x: 0, y: 1, z: 0 },
  { id: 4, x: 0, y: 0, z: 1 },
  ...Array.from({ length: segmentCount }, (_, index) => ({
    id: index + 5, x: lengthM * (index + 1) / segmentCount, y: 0, z: 0,
  })),
];
const beams = Array.from({ length: segmentCount }, (_, index) => ({
  id: index + 1,
  startNodeId: index === 0 ? 1 : index + 4,
  endNodeId: index + 5,
  profileName: "HEA100",
  material: "S235",
}));
assert.equal(beams.at(-1).endNodeId, segmentCount + 4);

project.savedAt = "2026-10-09T00:00:00.000Z";
project.projectInfo = { name: "Tweede-orde staafkolom: 1.024 staven en J2-Tet4-wortel",
  projectNumber: "VF-FRAME-1024-GNL-J2-TET4" };
project.loadCases = [{ id: 1, name: "Druk 0,5 kN en dwars 0,01 kN", type: "live" }];
project.activeLoadCaseId = 1;
project.analysetype = "tweedeOrdeFysisch";
project.model3d = {
  nodes, beams,
  volumes: [{ id: 1, kind: "tet4", nodeIds: [1, 2, 4, 3],
    eMpa: 210_000, poisson: 0.3,
    materialLaw: { kind: "steelJ2", yieldMpa: 235, hardeningMpa: 300 } }],
  supports: [
    { nodeId: 1, ux: false, uy: false, uz: false, rx: true, ry: true, rz: true },
    ...[2, 3, 4].map(nodeId => ({ nodeId,
      ux: true, uy: true, uz: true, rx: false, ry: false, rz: false })),
  ],
  loads: [{ id: 1, nodeId: segmentCount + 4, fx: -0.5, fy: 0, fz: -0.01,
    mx: 0, my: 0, mz: 0, caseId: 1 }],
  plates: [],
  materialLoadPath: [0.25, 0.5, 0.75, 1],
  volumeMaterialKinematics: "finiteStrain",
  volumeBackend: "automatic",
  volumeResidualTolerance: 1e-6,
  volumeThreads: 4,
};
writeFileSync(target, `${JSON.stringify(project)}\n`);
console.log(`Wrote ${target.pathname}: ${nodes.length} nodes, ${beams.length} frames, one Tet4.`);

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const count = 5_000;
const lengthM = 0.01;
const template = JSON.parse(readFileSync(new URL(
  "../docs/verificatie/3d-raamwerk/raamwerk-5888-staven-acht-bouwlagen.ifcfem2d",
  import.meta.url), "utf8"));
const nodes = Array.from({ length: count + 1 }, (_, index) => ({
  id: index + 1, x: index * lengthM, y: 0, z: 0,
}));
const beams = Array.from({ length: count }, (_, index) => ({
  id: index + 1, startNodeId: index + 1, endNodeId: index + 2,
  profileName: "10x10", material: "VRIJ:Teststaal E=200000 rho=7850 f=235",
  axialOnly: true,
}));
const supports = nodes.map((node, index) => ({
  nodeId: node.id, ux: index === 0, uy: true, uz: true,
  rx: false, ry: false, rz: false,
}));
const model = {
  nodes, beams, supports,
  loads: [{ id: 1, nodeId: count + 1, caseId: 1,
    fx: 10, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
  memberLoads: [], memberPointLoads: [], thermalLoads: [],
  plates: [], volumes: [], volumeBodyLoads: [], volumeFaceLoads: [],
  surfaceLoads: [], plateEdgeLoads: [],
  volumeBackend: "frontalWave", volumeThreads: 4,
};
const project = {
  ...template,
  savedAt: "2026-10-08T00:00:00.000Z",
  loadCases: [{ id: 1, name: "10 kN aan het vrije einde", type: "live" }],
  activeLoadCaseId: 1,
  nonlinearEnabled: false,
  analysetype: "eersteOrde",
  model3d: model,
};
const output = new URL(
  "../docs/verificatie/3d-raamwerk/trekstaven-5000-analytische-keten.ifcfem2d",
  import.meta.url);
writeFileSync(output, JSON.stringify(project));
console.log(`Wrote ${fileURLToPath(output)}: ${nodes.length} nodes, ${beams.length} bars`);

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const bays = 256;
const bayLengthM = 0.05;
const template = JSON.parse(readFileSync(new URL(
  "../docs/verificatie/3d-raamwerk/raamwerk-5888-staven-acht-bouwlagen.ifcfem2d",
  import.meta.url), "utf8"));
const section = [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]];
const nodes = Array.from({ length: bays + 1 }, (_, station) =>
  section.map(([y, z], corner) => ({ id: 4 * station + corner + 1,
    x: station * bayLengthM, y, z }))).flat();
const edges = new Map();
for (let bay = 0; bay < bays; bay++) {
  for (let a = 0; a < 8; a++) {
    for (let b = a + 1; b < 8; b++) {
      const startNodeId = 4 * bay + a + 1;
      const endNodeId = 4 * bay + b + 1;
      edges.set(`${startNodeId}:${endNodeId}`, { startNodeId, endNodeId });
    }
  }
}
const beams = [...edges.values()].map((edge, index) => ({
  id: index + 1, ...edge,
  profileName: "100x100", material: "VRIJ:Teststaal E=200000 rho=7850 f=235",
  axialOnly: true,
}));
const model = {
  nodes, beams,
  supports: nodes.slice(0, 4).map((node) => ({ nodeId: node.id,
    ux: true, uy: true, uz: true, rx: false, ry: false, rz: false })),
  loads: [{ id: 1, nodeId: nodes.at(-1).id, caseId: 1,
    fx: 1, fy: 0, fz: -10, mx: 0, my: 0, mz: 0 }],
  memberLoads: [], memberPointLoads: [], thermalLoads: [],
  plates: [], volumes: [], volumeBodyLoads: [], volumeFaceLoads: [],
  surfaceLoads: [], plateEdgeLoads: [],
  volumeBackend: "frontalWave", volumeThreads: 4,
};
if (beams.length !== 5_638) throw new Error(`Expected 5,638 unique bars, got ${beams.length}`);
const project = {
  ...template,
  savedAt: "2026-10-08T00:00:00.000Z",
  loadCases: [{ id: 1, name: "Tip: 1 kN X en 10 kN neerwaarts", type: "live" }],
  activeLoadCaseId: 1,
  nonlinearEnabled: false,
  analysetype: "eersteOrde",
  model3d: model,
};
const output = new URL(
  "../docs/verificatie/3d-raamwerk/ruimtelijk-vakwerk-5638-staven.ifcfem2d",
  import.meta.url);
writeFileSync(output, JSON.stringify(project));
console.log(`Wrote ${fileURLToPath(output)}: ${nodes.length} nodes, ${beams.length} bars`);

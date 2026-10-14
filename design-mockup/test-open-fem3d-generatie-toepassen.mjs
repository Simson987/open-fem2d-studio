import assert from "node:assert/strict";
import { generateRoofAndCladdingLoads } from "./src/components/openFem3d/openFem3dRoofLoads.ts";
import { applyGeneratedEnvelopeLoads } from "./src/components/openFem3d/openFem3dGeneratedLoads.ts";
import { withOpenFem3DLoadPanels } from "./src/components/openFem3d/openFem3dLoadPanels.ts";
import { removeOpenFem3DNode } from "./src/components/openFem3d/openFem3dModel.ts";

const nodes = [
  [0, 0, 4], [4, 0, 4], [4, 3, 4], [0, 3, 4],
  [1, 1, 4], [2, 1, 4], [2, 2, 4], [1, 2, 4],
].map(([x, y, z], index) => ({ id: index + 1, x, y, z }));
const model = {
  nodes,
  beams: [[1, 2], [2, 3], [3, 4], [4, 1]].map(([startNodeId, endNodeId], index) =>
    ({ id: index + 1, startNodeId, endNodeId })),
  envelopePanels: [{ id: 1, nodeIds: [1, 2, 3, 4], type: "roof", distribution: "twoWay",
    openings: [{ id: 1, nodeIds: [5, 6, 7, 8] }], claddingWeightKnPerM2: 0.2 }],
  loadPanels: [{ id: 5, nodeIds: [1, 2, 3, 4], caseId: 1, q: 0.3,
    direction: "gravity", distribution: "twoWay" }],
};
const cases = [{ id: 1, name: "Handmatig", type: "live" }];
const settings = { groundSnowKnPerM2: 0.7, snowExposure: 1, snowThermal: 1 };
const withHelperTriangle = (generation) => {
  const firstLoad = generation.loads[0];
  const [a, b, c] = firstLoad.triangle.points;
  const midpoint = a.map((coordinate, index) => (coordinate + b[index]) / 2);
  return { ...generation, loads: [...generation.loads, {
    ...firstLoad, key: `${firstLoad.key}:helper-test`,
    triangle: { points: [a, midpoint, c], areaM2: firstLoad.triangle.areaM2 / 2 },
  }] };
};
const roof = withHelperTriangle(generateRoofAndCladdingLoads(model, settings));
const first = applyGeneratedEnvelopeLoads(model, cases, null, roof);
assert.equal(first.changed, true);
assert.equal(first.loadCases.length, 3);
assert.equal(first.model.loadPanels[0].id, 5);
assert.deepEqual(first.model.loadPanels[0], model.loadPanels[0]);
assert.ok(first.model.generatedNodeIds.length > 0);
const second = applyGeneratedEnvelopeLoads(first.model, first.loadCases, null,
  withHelperTriangle(generateRoofAndCladdingLoads(first.model, settings)));
assert.equal(second.changed, false, "regeneratie met dezelfde invoer schrijft niets");
assert.equal(second.model, first.model);
assert.equal(second.loadCases, first.loadCases);
const converted = withOpenFem3DLoadPanels(first.model);
assert.ok(first.model.nodes.length > converted.model.nodes.length, "hulpknopen gaan niet naar de rekenkern");
assert.ok(converted.model.nodes.every((node) => !first.model.generatedNodeIds.includes(node.id)));
const deletedHelper = removeOpenFem3DNode(first.model, first.model.generatedNodeIds[0]);
assert.ok(!deletedHelper.generatedNodeIds.includes(first.model.generatedNodeIds[0]));
for (const result of converted.results) {
  assert.ok(Math.abs(result.assignedAreaM2 - result.geometry.areaM2) < 1e-5,
    `belastingvlak ${result.panel.id} draagt zijn volledige oppervlak af`);
}
const snowCaseId = first.loadCases.find((item) => item.gegenereerd?.sleutel === "envelope3d:snow:balanced").id;
const snowResults = converted.results.filter((result) => result.caseId === snowCaseId);
const snowForce = -snowResults.reduce((sum, result) => sum + result.totalForceKn[2], 0);
const snowProjectedArea = snowResults.reduce((sum, result) => sum + result.geometry.projectedAreaM2, 0);
assert.ok(Math.abs(snowForce - 0.8 * 0.7 * snowProjectedArea) < 1e-8);
const modified = { ...first.model, envelopePanels: [{ ...first.model.envelopePanels[0], claddingWeightKnPerM2: 0.25 }] };
const third = applyGeneratedEnvelopeLoads(modified, first.loadCases, null,
  withHelperTriangle(generateRoofAndCladdingLoads(modified, settings)));
assert.equal(third.loadCases[0].id, 1);
assert.equal(third.model.loadPanels[0].id, 5);
assert.deepEqual(third.generatedCaseIds, first.generatedCaseIds);
assert.deepEqual(third.generatedPanelIds, first.generatedPanelIds);
assert.ok(third.model.loadPanels.some((panel) => panel.generated?.zone === "bekleding" && panel.q === 0.25));
assert.throws(() => applyGeneratedEnvelopeLoads(model, cases, null,
  { ...roof, loads: [{ ...roof.loads[0], caseKey: "ontbreekt" }] }), /ontbreekt/);
console.log("3D-belastinggeneratie toepassen: controles geslaagd");

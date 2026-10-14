import assert from "node:assert/strict";
import { maakRegister } from "./src/api/register.ts";
import { leegDocument, model3dVan } from "./src/api/projectDocument.ts";
import { MODEL3D_GEOMETRIE_COMMANDOS } from "./src/api/commands/model3dGeometrie.ts";
import { MODEL3D_VOORWAARDEN_COMMANDOS } from "./src/api/commands/model3dVoorwaarden.ts";

const register = maakRegister([...MODEL3D_GEOMETRIE_COMMANDOS, ...MODEL3D_VOORWAARDEN_COMMANDOS]);
let document = leegDocument();
const run = (naam, invoer) => {
  const result = register.voerUit(naam, invoer, { document });
  if (result.document) document = result.document;
  return result.uitkomst;
};
for (const [x, y] of [[0, 0], [4, 0], [4, 3], [0, 3], [1, 1], [2, 1], [2, 2], [1, 2]]) {
  run("model3d.node.add", { x, y, z: 0 });
}
for (const [startNodeId, endNodeId] of [[1, 2], [2, 3], [3, 4], [4, 1]]) {
  run("model3d.beam.add", { startNodeId, endNodeId });
}
const panel = run("model3d.panel.add", {
  nodeIds: [1, 2, 3, 4], type: "roof", distribution: "twoWay", name: "Dak",
  openings: [{ id: 1, nodeIds: [5, 6, 7, 8] }], claddingWeightKnPerM2: 0.12,
}).panel;
assert.equal(panel.name, "Dak");
assert.equal(model3dVan(document).envelopePanels.length, 1);
assert.equal(run("model3d.panel.update", { id: panel.id, flipOuterSide: true }).panel.flipOuterSide, true);
assert.throws(() => run("model3d.panel.add", {
  nodeIds: [1, 2, 3, 4], type: "roof", distribution: "twoWay", unknown: true,
}), /unknown|onbekend|extra|additional/i);
const loadPanel = run("model3d.panel.createLoad", { id: panel.id, q: 2, direction: "normal" }).loadPanel;
assert.deepEqual(loadPanel.openings, [{ id: 1, nodeIds: [5, 6, 7, 8] }]);
assert.equal(loadPanel.q, 2, "de canonieke vlaknormaal wijst na omkering naar -Z");
assert.equal(run("model3d.panel.delete", { id: panel.id }).deletedPanelId, panel.id);
assert.equal(model3dVan(document).envelopePanels.length, 0);
assert.equal(model3dVan(document).loadPanels.length, 1, "afgeleid handmatig belastingvlak blijft bestaan");
console.log("3D-paneel-API: 9 controles geslaagd");

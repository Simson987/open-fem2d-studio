import assert from "node:assert/strict";
import { addOpenFem3DEnvelopePanel, addOpenFem3DEnvelopePanelFromGrid,
  addOpenFem3DEnvelopePanelLoad, openFem3DEnvelopePanelGeometry, openFem3DEnvelopePanelSupportWarnings,
  updateOpenFem3DEnvelopePanel } from "./src/components/openFem3d/openFem3dEnvelopePanels.ts";
import { parseOpenFem3DModel } from "./src/components/openFem3d/openFem3dModel.ts";
import { analyseOpenFem3DLoadPanel, withOpenFem3DLoadPanels } from "./src/components/openFem3d/openFem3dLoadPanels.ts";
import { openFem3DLoadPanelSurface } from "./src/components/openFem3d/openFem3dLoadSurfaces.ts";
import { transformOpenFem3D } from "./src/components/openFem3d/openFem3dTransform.ts";
import { deserializeProject, serializeProject,
  PROJECT_FORMAT_VERSION_3D_ENVELOPE_PANELS } from "./src/io/projectFile.ts";
import { bouwIfcRekenmodel, valideerIfc } from "./src/io/ifcExport.ts";
import { importeerIfcAnalyseModel } from "./src/io/ifcAnalyseImport.ts";

const nodes = [
  [0, 0], [4, 0], [4, 3], [0, 3],
  [1, 1], [2, 1], [2, 2], [1, 2],
  [5, 1], [6, 1], [6, 2], [5, 2],
].map(([x, y], index) => ({ id: index + 1, x, y, z: 0 }));
const model = { nodes, beams: [] };
const grid = {
  enabled: true,
  xAxes: [{ id: "x0", label: "A", position: 0 }, { id: "x4", label: "B", position: 4000 }],
  yAxes: [{ id: "y0", label: "1", position: 0 }, { id: "y3", label: "2", position: 3000 }],
  zAxes: [{ id: "z0", label: "Peil", position: 0 }, { id: "z4", label: "Dak", position: 4000 }],
};
const gridRoof = addOpenFem3DEnvelopePanelFromGrid({ nodes: [], beams: [] }, grid,
  { plane: "xy", fixed: 4, first: [0, 4], second: [0, 3] });
assert.equal(gridRoof.envelopePanels[0].type, "roof");
assert.equal(gridRoof.nodes.length, 4);
const gridFacade = addOpenFem3DEnvelopePanelFromGrid(gridRoof, grid,
  { plane: "xz", fixed: 0, first: [0, 4], second: [0, 4] });
assert.equal(gridFacade.envelopePanels[1].type, "facade");
assert.equal(gridFacade.nodes.length, 6);
const values = {
  nodeIds: [1, 2, 3, 4], type: "roof", distribution: "twoWay",
  openings: [{ id: 1, nodeIds: [5, 6, 7, 8] }],
  claddingWeightKnPerM2: 0.15, name: "Dak west",
};
const added = addOpenFem3DEnvelopePanel(model, values);
const panel = added.envelopePanels[0];
const geometry = openFem3DEnvelopePanelGeometry(added, panel);
assert.match(openFem3DEnvelopePanelSupportWarnings(added, panel)[0], /geen ligger/);
assert.equal(geometry.outer.areaM2, 12);
assert.equal(geometry.netAreaM2, 11);
assert.deepEqual(geometry.outwardNormal, [0, 0, 1]);
assert.deepEqual(openFem3DEnvelopePanelGeometry(
  updateOpenFem3DEnvelopePanel(added, panel.id, { flipOuterSide: true }),
  { ...panel, flipOuterSide: true },
).outwardNormal, [0, 0, -1]);
const oneWay = updateOpenFem3DEnvelopePanel(added, panel.id, { distribution: "oneWay" });
assert.ok(oneWay.envelopePanels[0].spanDirection);
const copied = transformOpenFem3D(oneWay, { type: "envelopePanel", id: panel.id },
  { kind: "copy", dx: 5, dy: 0, dz: 0 });
assert.equal(copied.model.envelopePanels.length, 2);
assert.deepEqual(copied.model.envelopePanels[1].nodeIds, [13, 14, 15, 16]);
assert.deepEqual(copied.model.envelopePanels[1].openings[0].nodeIds, [17, 18, 19, 20]);
const mirrored = transformOpenFem3D(added, { type: "envelopePanel", id: panel.id },
  { kind: "mirror", axis: "x", offset: 0 });
assert.deepEqual(openFem3DEnvelopePanelGeometry(mirrored.model, mirrored.model.envelopePanels[0]).outwardNormal,
  geometry.outwardNormal);
const rotated = transformOpenFem3D(oneWay, { type: "envelopePanel", id: panel.id },
  { kind: "rotate", axis: "z", angleDeg: 90 });
assert.ok(Math.abs(rotated.model.envelopePanels[0].spanDirection.x) < 1e-9);
assert.throws(() => addOpenFem3DEnvelopePanel(model, {
  ...values, openings: [{ id: 1, nodeIds: [9, 10, 11, 12] }],
}), /niet volledig binnen/);
assert.throws(() => addOpenFem3DEnvelopePanel(model, {
  ...values, openings: [{ id: 1, nodeIds: [5, 6, 7, 8] }, { id: 2, nodeIds: [5, 6, 7, 8] }],
}), /overlappen/);
assert.throws(() => parseOpenFem3DModel({ ...added, envelopePanels: [panel, panel] }), /twee keer/);
const project = {
  nodes: [], beams: [], supports: [], plates: [], loads: [], loadCases: [{ id: 1, name: "G", type: "dead" }],
  modelDimension: "3d", model3d: added,
};
const text = serializeProject(project);
assert.equal(JSON.parse(text).version, PROJECT_FORMAT_VERSION_3D_ENVELOPE_PANELS);
assert.deepEqual(deserializeProject(text).model3d.envelopePanels, added.envelopePanels);
const ifc = bouwIfcRekenmodel({ nodes: [], beams: [], supports: [], loads: [], loadCases: [], model3d: added });
assert.match(ifc, /IFCCOVERING\([^\n]+\.ROOFING\.\)/);
assert.match(ifc, /IFCFACEBASED?SURFACEMODEL/);
assert.match(ifc, /IFCAREAMEASURE\(11\.\)/);
assert.doesNotMatch(ifc, /IFCSTRUCTURALSURFACEMEMBER\(/);
assert.deepEqual(valideerIfc(ifc).fouten, []);
const standaloneImported = importeerIfcAnalyseModel(ifc, { model: 2 });
assert.equal(standaloneImported.model3d.envelopePanels.length, 1);
assert.equal(standaloneImported.model3d.envelopePanels[0].openings.length, 1);
const beams = [[1, 2], [2, 3], [3, 4], [4, 1]].map(([startNodeId, endNodeId], index) =>
  ({ id: index + 1, startNodeId, endNodeId }));
const ifcWithFrame = bouwIfcRekenmodel({ nodes: [], beams: [], supports: [], loads: [], loadCases: [],
  model3d: { ...added, beams } });
const imported = importeerIfcAnalyseModel(ifcWithFrame, { model: 2 });
assert.equal(imported.model3d.envelopePanels.length, 1);
assert.equal(openFem3DEnvelopePanelGeometry(imported.model3d, imported.model3d.envelopePanels[0]).netAreaM2, 11);
for (const distribution of ["oneWay", "twoWay"]) {
  const loadPanel = {
    id: 1, nodeIds: values.nodeIds, openings: values.openings, caseId: 1,
    q: 2, direction: "gravity", distribution,
    ...(distribution === "oneWay" ? { spanDirection: { x: 1, y: 0, z: 0 } } : {}),
  };
  const loaded = parseOpenFem3DModel({ ...model, beams, loadPanels: [loadPanel] });
  const result = analyseOpenFem3DLoadPanel(loaded, loaded.loadPanels[0]);
  assert.ok(Math.abs(result.assignedAreaM2 - 11) < 1e-5, `${distribution}: netto afdracht`);
  assert.ok(Math.abs(result.totalForceKn[2] + 22) < 1e-9, `${distribution}: netto last`);
  const converted = withOpenFem3DLoadPanels(loaded).model;
  assert.ok((converted.memberLoads?.length ?? 0) + (converted.loads?.length ?? 0) > 0);
  const shell = addOpenFem3DEnvelopePanel({ ...model, beams }, { ...values, distribution,
    ...(distribution === "oneWay" ? { spanDirection: { x: 1, y: 0, z: 0 } } : {}) });
  const generated = addOpenFem3DEnvelopePanelLoad(shell, 1, 1, 2, "gravity");
  const generatedResult = analyseOpenFem3DLoadPanel(generated, generated.loadPanels[0]);
  assert.ok(Math.abs(openFem3DLoadPanelSurface(generated, generated.loadPanels[0]).areaM2 - 11) < 1e-9);
  assert.ok(Math.abs(generatedResult.assignedAreaM2 - result.assignedAreaM2) < 1e-6);
  assert.deepEqual(generatedResult.totalForceKn, result.totalForceKn);
  assert.deepEqual(generatedResult.beamLoads, result.beamLoads);
}
console.log("3D-schilpanelen: controles geslaagd");

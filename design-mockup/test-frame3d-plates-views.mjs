import assert from "node:assert/strict";
import {
  addFrame3DPlate,
  addFrame3DPlateOpening,
  addFrame3DSurfaceLoad,
  parseFrame3DModel,
  removeFrame3DSurfaceLoad,
  updateFrame3DPlate,
  updateFrame3DSurfaceLoad,
} from "./src/components/frame3d/frame3dModel.ts";
import { createFrame3DPlateGeometry } from "./src/components/frame3d/frame3dPlateGeometry.ts";
import { parseFrame3DViewSets } from "./src/components/frame3d/frame3dViewSets.ts";
import { buildFrame3DSolveRequest } from "./src/components/frame3d/frame3dSolver.ts";
import { DEFAULT_FRAME_3D_VISIBILITY } from "./src/components/frame3d/frame3dVisibility.ts";
import { toggleFrame3DSelection } from "./src/components/frame3d/frame3dSelection.ts";
import { deserializeProject, serializeProject } from "./src/io/projectFile.ts";

const base = parseFrame3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 },
    { id: 3, x: 6, y: 4, z: 0 }, { id: 4, x: 0, y: 4, z: 0 },
    { id: 5, x: 2, y: 1, z: 0 }, { id: 6, x: 4, y: 1, z: 0 },
    { id: 7, x: 4, y: 3, z: 0 }, { id: 8, x: 2, y: 3, z: 0 },
    { id: 9, x: 3, y: -1.5, z: 0 },
    { id: 10, x: 3, y: 0.5, z: 0 },
  ],
  beams: [],
});
const withPlate = addFrame3DPlate(base, [1, 2, 3, 4], { thicknessM: 0.25, material: "C35/45" });
assert.deepEqual(withPlate.plates[0].nodeIds, [1, 2, 3, 4]);
const rounded = updateFrame3DPlate(withPlate, 1, { cornerRadiusM: 0.35 });
const withOpening = addFrame3DPlateOpening(rounded, 1, [5, 6, 7, 8], 0.2);
assert.equal(withOpening.plates[0].openings.length, 1);
const rendered = createFrame3DPlateGeometry(withOpening, withOpening.plates[0]);
assert.ok(rendered?.geometry.attributes.position.count > 0, "plaat met afgeronde buitenrand en opening krijgt een mesh");
assert.ok(Math.abs(rendered.normal.z) > 0.999, "horizontale plaat krijgt een verticale normaal");

const curvedOpening = addFrame3DPlateOpening(rounded, 1, [5, 10, 6, 7, 8], {
  boundary: [
    { kind: "arc", startNodeId: 5, controlNodeId: 10, endNodeId: 6 },
    { kind: "line", startNodeId: 6, endNodeId: 7 },
    { kind: "line", startNodeId: 7, endNodeId: 8 },
    { kind: "line", startNodeId: 8, endNodeId: 5 },
  ],
});
assert.equal(curvedOpening.plates[0].openings[0].boundary[0].kind, "arc",
  "een getekende boogrand van een opening blijft modeldata");
assert.ok(createFrame3DPlateGeometry(curvedOpening, curvedOpening.plates[0])?.geometry.attributes.position.count > 0,
  "een opening met lijn- en boogranden krijgt een echte plaatuitsparing");
assert.deepEqual(
  parseFrame3DModel(JSON.parse(JSON.stringify(curvedOpening))).plates[0].openings[0].boundary,
  curvedOpening.plates[0].openings[0].boundary,
  "boogranden van openingen overleven opslaan en openen",
);

const curved = addFrame3DPlate(base, [1, 9, 2, 3, 4], {
  thicknessM: 0.2,
  material: "C30/37",
  boundary: [
    { kind: "arc", startNodeId: 1, controlNodeId: 9, endNodeId: 2 },
    { kind: "line", startNodeId: 2, endNodeId: 3 },
    { kind: "line", startNodeId: 3, endNodeId: 4 },
    { kind: "line", startNodeId: 4, endNodeId: 1 },
  ],
});
assert.equal(curved.plates[0].boundary[0].kind, "arc", "de getekende boog blijft modeldata");
assert.ok(createFrame3DPlateGeometry(curved, curved.plates[0])?.geometry.attributes.position.count > 0,
  "een gemengde lijn-boogcontour krijgt een echte extrusie");
assert.deepEqual(parseFrame3DModel(JSON.parse(JSON.stringify(curved))).plates[0].boundary, curved.plates[0].boundary,
  "lijn- en boogsegmenten overleven opslaan en openen");

const loaded = addFrame3DSurfaceLoad(withOpening, 1, { qx: 1, qy: 0, qz: -5 }, 2);
assert.deepEqual(loaded.surfaceLoads, [{ id: 1, plateId: 1, caseId: 2, qx: 1, qy: 0, qz: -5 }]);
const changed = updateFrame3DSurfaceLoad(loaded, 1, { qx: 0, qy: 2, qz: -7 });
assert.equal(changed.surfaceLoads[0].qz, -7);
assert.equal(removeFrame3DSurfaceLoad(changed, 1).surfaceLoads.length, 0);
assert.throws(() => buildFrame3DSolveRequest(loaded), /plaatkernel.*geblokkeerd/i,
  "de staafsolver mag een plaat of oppervlaktebelasting niet stil negeren");
assert.throws(() => parseFrame3DModel({
  ...withPlate,
  nodes: withPlate.nodes.map((node) => node.id === 3 ? { ...node, z: 1 } : node),
}), /vlak/);

const view = {
  id: "view-1", name: "UGT momentbeeld", view: "iso",
  camera: { position: [7, 8, 6], target: [3, 2, 0], up: [0, 0, 1] },
  visibility: { ...DEFAULT_FRAME_3D_VISIBILITY, loads: false, momentY: true, deformation: false },
  combinationId: 12,
};
assert.deepEqual(parseFrame3DViewSets([view]), [view]);
assert.throws(() => parseFrame3DViewSets([view, view]), /dubbele id/);
const geometrySelection = toggleFrame3DSelection({ type: "node", id: 1 }, { type: "plate", id: 1 }, true);
assert.deepEqual(geometrySelection, { type: "multi", nodeIds: [1], beamIds: [], plateIds: [1] });
assert.deepEqual(toggleFrame3DSelection(geometrySelection, { type: "plate", id: 1 }, true), { type: "node", id: 1 });
assert.deepEqual(toggleFrame3DSelection(geometrySelection, { type: "surfaceLoad", id: 1 }, true), { type: "surfaceLoad", id: 1 });

const projectText = serializeProject({
  nodes: [], beams: [], supports: [], plates: [], loads: [], loadCases: [{ id: 1, name: "Permanent", type: "permanent" }],
  activeLoadCaseId: 1, selfWeightEnabled: false, nonlinearEnabled: true,
  modelDimension: "3d", model3d: loaded, frame3dViewSets: [view],
});
const reopened = deserializeProject(projectText);
assert.equal(reopened.model3d.plates[0].cornerRadiusM, 0.35);
assert.equal(reopened.model3d.surfaceLoads[0].qz, -5);
assert.equal(reopened.frame3dViewSets[0].name, "UGT momentbeeld");

console.log("3D-platen, openingen, ronde randen, oppervlaktebelasting en opgeslagen views: geslaagd");

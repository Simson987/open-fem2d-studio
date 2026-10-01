import assert from "node:assert/strict";
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import {
  addOpenFem3DPlate,
  addOpenFem3DPlateOpening,
  addOpenFem3DSurfaceLoad,
  parseOpenFem3DModel,
  removeOpenFem3DSurfaceLoad,
  updateOpenFem3DPlate,
  updateOpenFem3DSurfaceLoad,
} from "./src/components/openFem3d/openFem3dModel.ts";
import { createOpenFem3DPlateGeometry } from "./src/components/openFem3d/openFem3dPlateGeometry.ts";
import { circularArcThroughPoints2D, sampleCircularArc3D } from "./src/components/openFem3d/openFem3dCircularArc.ts";
import { openFem3DViewFromCamera, parseOpenFem3DViewSets } from "./src/components/openFem3d/openFem3dViewSets.ts";
import { buildOpenFem3DSolveRequest } from "./src/components/openFem3d/openFem3dSolver.ts";
import { meshOpenFem3DPlates } from "./src/components/openFem3d/openFem3dPlateMesh.ts";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY } from "./src/components/openFem3d/openFem3dVisibility.ts";
import { toggleOpenFem3DSelection } from "./src/components/openFem3d/openFem3dSelection.ts";
import { deserializeProject, serializeProject } from "./src/io/projectFile.ts";

assert.equal(openFem3DViewFromCamera({ x: 0, y: -10, z: 2.5 }, { x: 0, y: 0, z: 2.5 }), "front");
assert.equal(openFem3DViewFromCamera({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 0 }), "top");
assert.equal(openFem3DViewFromCamera({ x: 12, y: 12, z: 11 }, { x: 0, y: 0, z: 2.5 }), "iso",
  "een schuin gedraaide front-view is voor het tekenvlak en de bediening een vrij 3D-aanzicht");

const base = parseOpenFem3DModel({
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
const withPlate = addOpenFem3DPlate(base, [1, 2, 3, 4], { thicknessM: 0.25, material: "C35/45" });
assert.deepEqual(withPlate.plates[0].nodeIds, [1, 2, 3, 4]);
const rounded = updateOpenFem3DPlate(withPlate, 1, { cornerRadiusM: 0.35 });
const withOpening = addOpenFem3DPlateOpening(rounded, 1, [5, 6, 7, 8], 0.2);
assert.equal(withOpening.plates[0].openings.length, 1);
const rendered = createOpenFem3DPlateGeometry(withOpening, withOpening.plates[0]);
assert.ok(rendered?.geometry.attributes.position.count > 0, "plaat met afgeronde buitenrand en opening krijgt een mesh");
assert.ok(Math.abs(rendered.normal.z) > 0.999, "horizontale plaat krijgt een verticale normaal");
const plateMesh = new Mesh(rendered.geometry, new MeshBasicMaterial({ side: DoubleSide }));
plateMesh.position.copy(rendered.position);
plateMesh.quaternion.copy(rendered.quaternion);
plateMesh.updateMatrixWorld(true);
assert.equal(new Raycaster(new Vector3(3, 2, 2), new Vector3(0, 0, -1)).intersectObject(plateMesh).length, 0,
  "een opening laat in de gemeshte plaat werkelijk een leeg vlak achter");
assert.ok(new Raycaster(new Vector3(1, 2, 2), new Vector3(0, 0, -1)).intersectObject(plateMesh).length > 0,
  "naast de opening blijft de plaat gesloten");
assert.ok(new Raycaster(rendered.surfaceAnchor.clone().add(new Vector3(0, 0, 2)), new Vector3(0, 0, -1))
  .intersectObject(plateMesh).length > 0,
"het lastteken moet op plaatmateriaal staan en niet in de opening");
assert.equal(new Raycaster(rendered.surfaceLabelAnchor.clone().add(new Vector3(0, 0, 2)), new Vector3(0, 0, -1))
  .intersectObject(plateMesh).length, 0,
  "het lastlabel krijgt een anker buiten de buitencontour, zodat een brede tekst niet in de opening valt");
assert.throws(() => addOpenFem3DPlateOpening(withPlate, 1, [1, 5, 6]), /binnen.*buitenrand/,
  "een opening die de plaatrand raakt mag geen schijnbare uitsparing worden");
assert.throws(() => parseOpenFem3DModel({ ...withOpening,
  nodes: withOpening.nodes.map((node) => [5, 6, 7, 8].includes(node.id) ? { ...node, z: 1 } : node),
}), /binnen.*buitenrand/,
  "een vlakke opening op een andere hoogte hoort niet in deze plaatmesh");

const curvedOpening = addOpenFem3DPlateOpening(rounded, 1, [5, 10, 6, 7, 8], {
  boundary: [
    { kind: "arc", startNodeId: 5, controlNodeId: 10, endNodeId: 6 },
    { kind: "line", startNodeId: 6, endNodeId: 7 },
    { kind: "line", startNodeId: 7, endNodeId: 8 },
    { kind: "line", startNodeId: 8, endNodeId: 5 },
  ],
});
assert.equal(curvedOpening.plates[0].openings[0].boundary[0].kind, "arc",
  "een getekende boogrand van een opening blijft modeldata");
const curvedOpeningGeometry = createOpenFem3DPlateGeometry(curvedOpening, curvedOpening.plates[0]);
assert.ok(curvedOpeningGeometry?.geometry.attributes.position.count > 0,
  "een opening met lijn- en boogranden krijgt een echte plaatuitsparing");
const curvedOpeningMesh = new Mesh(curvedOpeningGeometry.geometry, new MeshBasicMaterial({ side: DoubleSide }));
curvedOpeningMesh.position.copy(curvedOpeningGeometry.position);
curvedOpeningMesh.quaternion.copy(curvedOpeningGeometry.quaternion);
curvedOpeningMesh.updateMatrixWorld(true);
assert.ok(new Raycaster(curvedOpeningGeometry.surfaceAnchor.clone().add(new Vector3(0, 0, 2)), new Vector3(0, 0, -1))
  .intersectObject(curvedOpeningMesh).length > 0,
"ook bij een gebogen opening staat het lastteken op plaatmateriaal");
assert.deepEqual(
  parseOpenFem3DModel(JSON.parse(JSON.stringify(curvedOpening))).plates[0].openings[0].boundary,
  curvedOpening.plates[0].openings[0].boundary,
  "boogranden van openingen overleven opslaan en openen",
);

const curved = addOpenFem3DPlate(base, [1, 9, 2, 3, 4], {
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
const curvedMesh = createOpenFem3DPlateGeometry(curved, curved.plates[0]);
assert.ok(curvedMesh?.geometry.attributes.position.count > 0,
  "een gemengde lijn-boogcontour krijgt een echte extrusie");
const vertices = curvedMesh.geometry.getAttribute("position");
const distanceToSteeringPoint = Math.min(...Array.from({ length: vertices.count }, (_, index) => {
  const vertex = new Vector3(vertices.getX(index), vertices.getY(index), vertices.getZ(index))
    .applyQuaternion(curvedMesh.quaternion).add(curvedMesh.position);
  return Math.hypot(vertex.x - 3, vertex.y + 1.5);
}));
assert.ok(distanceToSteeringPoint < 1e-5,
  `de cirkelboog moet door het aangeklikte stuurpunt lopen; afwijking ${distanceToSteeringPoint} m`);
const arc3D = sampleCircularArc3D({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 0 }, 24);
assert.ok(arc3D && Math.hypot(arc3D[12].x - 1, arc3D[12].y, arc3D[12].z - 1) < 1e-12,
  "de 3D-tekenpreview loopt ook in een verticaal vlak door het stuurpunt");
const longArc = circularArcThroughPoints2D({ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 });
assert.ok(longArc?.clockwise && Math.abs(longArc.sweep + 3 * Math.PI / 2) < 1e-12,
  "een stuurpunt buiten de korte boog kiest de lange cirkelboog");
assert.throws(() => parseOpenFem3DModel({ ...curved,
  nodes: curved.nodes.map((node) => node.id === 9 ? { ...node, y: 0 } : node),
}), /boog.*één lijn/, "drie collineaire punten vormen geen cirkelboog");
assert.deepEqual(parseOpenFem3DModel(JSON.parse(JSON.stringify(curved))).plates[0].boundary, curved.plates[0].boundary,
  "lijn- en boogsegmenten overleven opslaan en openen");

const loaded = addOpenFem3DSurfaceLoad(withOpening, 1, { qx: 1, qy: 0, qz: -5 }, 2);
assert.deepEqual(loaded.surfaceLoads, [{ id: 1, plateId: 1, caseId: 2, qx: 1, qy: 0, qz: -5 }]);
const changed = updateOpenFem3DSurfaceLoad(loaded, 1, { qx: 0, qy: 2, qz: -7 });
assert.equal(changed.surfaceLoads[0].qz, -7);
assert.equal(removeOpenFem3DSurfaceLoad(changed, 1).surfaceLoads.length, 0);
assert.throws(() => buildOpenFem3DSolveRequest(loaded), /plaatnet/i,
  "zonder rekennet mag een plaat of oppervlaktebelasting niet stil wegvallen");
{
  const supported = { ...loaded, supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }] };
  const mesh = await meshOpenFem3DPlates(supported);
  const request = buildOpenFem3DSolveRequest(supported, "linear", 2, mesh);
  assert.equal(request.schemaVersion, 2);
  assert.deepEqual(request.plates, [{ id: 1, materialId: 1, thicknessM: 0.25 }]);
  assert.deepEqual(request.surfaceLoads, [{ id: 1, plateId: 1, qxKnPerM2: 1, qyKnPerM2: 0, qzKnPerM2: -5 }]);
  assert.equal(request.shellElements.length, mesh.elements.length);
  assert.ok(request.shellElements.length > 20, "de plaat met opening en ronde hoeken is gemesht");
}
assert.throws(() => parseOpenFem3DModel({
  ...withPlate,
  nodes: withPlate.nodes.map((node) => node.id === 3 ? { ...node, z: 1 } : node),
}), /vlak/);

const view = {
  id: "view-1", name: "UGT momentbeeld", view: "iso",
  camera: { position: [7, 8, 6], target: [3, 2, 0], up: [0, 0, 1] },
  visibility: { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, loads: false, momentY: true, deformation: false },
  combinationId: 12,
};
assert.deepEqual(parseOpenFem3DViewSets([view]), [view]);
assert.deepEqual(parseOpenFem3DViewSets([{ ...view, mode: "model" }])[0].mode, "model");
assert.throws(() => parseOpenFem3DViewSets([{ ...view, mode: "unknown" }]), /ongeldige tabstand/);
assert.throws(() => parseOpenFem3DViewSets([view, view]), /dubbele id/);
const geometrySelection = toggleOpenFem3DSelection({ type: "node", id: 1 }, { type: "plate", id: 1 }, true);
assert.deepEqual(geometrySelection, { type: "multi", nodeIds: [1], beamIds: [], plateIds: [1] });
assert.deepEqual(toggleOpenFem3DSelection(geometrySelection, { type: "plate", id: 1 }, true), { type: "node", id: 1 });
assert.deepEqual(toggleOpenFem3DSelection(geometrySelection, { type: "surfaceLoad", id: 1 }, true), { type: "surfaceLoad", id: 1 });

const modernView = { ...view, mode: "results" };
const projectText = serializeProject({
  nodes: [], beams: [], supports: [], plates: [], loads: [], loadCases: [{ id: 1, name: "Permanent", type: "permanent" }],
  activeLoadCaseId: 1, selfWeightEnabled: false, nonlinearEnabled: true,
  modelDimension: "3d", model3d: loaded, openFem3dViewSets: [modernView],
});
const reopened = deserializeProject(projectText);
assert.equal(reopened.model3d.plates[0].cornerRadiusM, 0.35);
assert.equal(reopened.model3d.surfaceLoads[0].qz, -5);
assert.equal(reopened.openFem3dViewSets[0].name, "UGT momentbeeld");
assert.equal(reopened.openFem3dViewSets[0].mode, "results", "de resultaat-tabstand overleeft projectopslag");

console.log("3D-platen, openingen, ronde randen, oppervlaktebelasting en opgeslagen views: geslaagd");

import assert from "node:assert/strict";
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
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
import { circularArcThroughPoints2D, sampleCircularArc3D } from "./src/components/frame3d/frame3dCircularArc.ts";
import { frame3DViewFromCamera, parseFrame3DViewSets } from "./src/components/frame3d/frame3dViewSets.ts";
import { buildFrame3DSolveRequest } from "./src/components/frame3d/frame3dSolver.ts";
import { DEFAULT_FRAME_3D_VISIBILITY, readFrame3DVisibility, saveFrame3DVisibility } from "./src/components/frame3d/frame3dVisibility.ts";
import { toggleFrame3DSelection } from "./src/components/frame3d/frame3dSelection.ts";
import { deserializeProject, serializeProject } from "./src/io/projectFile.ts";
import { CONCRETE_E_CM } from "./src/lib/sectionResolver.ts";

assert.equal(frame3DViewFromCamera({ x: 0, y: -10, z: 2.5 }, { x: 0, y: 0, z: 2.5 }), "front");
assert.equal(frame3DViewFromCamera({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 0 }), "top");
assert.equal(frame3DViewFromCamera({ x: 12, y: 12, z: 11 }, { x: 0, y: 0, z: 2.5 }), "iso",
  "een schuin gedraaide front-view is voor het tekenvlak en de bediening een vrij 3D-aanzicht");

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
assert.throws(() => addFrame3DPlateOpening(withPlate, 1, [1, 5, 6]), /binnen.*buitenrand/,
  "een opening die de plaatrand raakt mag geen schijnbare uitsparing worden");
assert.throws(() => parseFrame3DModel({ ...withOpening,
  nodes: withOpening.nodes.map((node) => [5, 6, 7, 8].includes(node.id) ? { ...node, z: 1 } : node),
}), /binnen.*buitenrand/,
  "een vlakke opening op een andere hoogte hoort niet in deze plaatmesh");

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
const curvedOpeningGeometry = createFrame3DPlateGeometry(curvedOpening, curvedOpening.plates[0]);
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
const curvedMesh = createFrame3DPlateGeometry(curved, curved.plates[0]);
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
assert.throws(() => parseFrame3DModel({ ...curved,
  nodes: curved.nodes.map((node) => node.id === 9 ? { ...node, y: 0 } : node),
}), /boog.*één lijn/, "drie collineaire punten vormen geen cirkelboog");
assert.deepEqual(parseFrame3DModel(JSON.parse(JSON.stringify(curved))).plates[0].boundary, curved.plates[0].boundary,
  "lijn- en boogsegmenten overleven opslaan en openen");

const loaded = addFrame3DSurfaceLoad(withOpening, 1, { qx: 1, qy: 0, qz: -5 }, 2);
assert.deepEqual(loaded.surfaceLoads, [{ id: 1, plateId: 1, caseId: 2, qx: 1, qy: 0, qz: -5 }]);
const changed = updateFrame3DSurfaceLoad(loaded, 1, { qx: 0, qy: 2, qz: -7 });
assert.equal(changed.surfaceLoads[0].qz, -7);
assert.equal(removeFrame3DSurfaceLoad(changed, 1).surfaceLoads.length, 0);
assert.throws(() => buildFrame3DSolveRequest(loaded), /raamwerkkern.*plaatlasten.*voorkomen/i,
  "de staafsolver mag een plaat of oppervlaktebelasting niet stil negeren");
assert.throws(() => parseFrame3DModel({
  ...withPlate,
  nodes: withPlate.nodes.map((node) => node.id === 3 ? { ...node, z: 1 } : node),
}), /vlak/);

const view = {
  id: "view-1", name: "UGT momentbeeld", view: "iso",
  camera: { position: [7, 8, 6], target: [3, 2, 0], up: [0, 0, 1] },
  visibility: { ...DEFAULT_FRAME_3D_VISIBILITY, loads: false, momentY: true, deformation: false, supportScale: 1.8 },
  combinationId: 12,
};
assert.deepEqual(parseFrame3DViewSets([view]), [view]);
assert.equal(parseFrame3DViewSets([{ ...view, visibility: { supports: true } }])[0].visibility.supportScale, 1,
  "oude opgeslagen views behouden de standaardgrootte");
const preferenceStore = new Map();
globalThis.localStorage = {
  getItem: (key) => preferenceStore.get(key) ?? null,
  setItem: (key, value) => preferenceStore.set(key, value),
};
saveFrame3DVisibility({ ...DEFAULT_FRAME_3D_VISIBILITY, supportScale: 2.25 });
assert.equal(readFrame3DVisibility().supportScale, 2.25, "opleggingsgrootte blijft lokaal bewaard");
delete globalThis.localStorage;
assert.deepEqual(parseFrame3DViewSets([{ ...view, mode: "model" }])[0].mode, "model");
assert.throws(() => parseFrame3DViewSets([{ ...view, mode: "unknown" }]), /ongeldige tabstand/);
assert.throws(() => parseFrame3DViewSets([view, view]), /dubbele id/);
const geometrySelection = toggleFrame3DSelection({ type: "node", id: 1 }, { type: "plate", id: 1 }, true);
assert.deepEqual(geometrySelection, { type: "multi", nodeIds: [1], beamIds: [], plateIds: [1] });
assert.deepEqual(toggleFrame3DSelection(geometrySelection, { type: "plate", id: 1 }, true), { type: "node", id: 1 });
assert.deepEqual(toggleFrame3DSelection(geometrySelection, { type: "surfaceLoad", id: 1 }, true), { type: "surfaceLoad", id: 1 });

const modernView = { ...view, mode: "results" };
const modulusCurve = [{ strain: 0, eMpa: CONCRETE_E_CM["C35/45"] },
  { strain: 0.0002, eMpa: CONCRETE_E_CM["C35/45"] / 2 }];
const reinforcement = { limitState: "service", fckMpa: 35, fctmMpa: 3.2,
  gammaC: 1.5, fydMpa: 435, fywdMpa: 435, esMpa: 200000,
  coverMm: 30, barDiameterMm: 12, topXMm2PerM: 800, topYMm2PerM: 800,
  bottomXMm2PerM: 800, bottomYMm2PerM: 800, shearMm2PerM2: 0,
  tanTheta: 1, alphaCc: 1, longTerm: false, crackLimitMm: 0.3 };
const edgeSupports = ["simplySupported", "clamped", "free", "simplySupported"];
const loadedWithCurve = updateFrame3DPlate(loaded, 1, { modulusCurve, reinforcement,
  edgeSupports, maxCellSizeM: 0.4 });
const projectText = serializeProject({
  nodes: [], beams: [], supports: [], plates: [], loads: [], loadCases: [{ id: 1, name: "Permanent", type: "permanent" }],
  activeLoadCaseId: 1, selfWeightEnabled: false, nonlinearEnabled: true,
  modelDimension: "3d", model3d: loadedWithCurve, openFem3dViewSets: [modernView],
});
const reopened = deserializeProject(projectText);
assert.equal(reopened.model3d.plates[0].cornerRadiusM, 0.35);
assert.equal(reopened.model3d.surfaceLoads[0].qz, -5);
assert.deepEqual(reopened.model3d.plates[0].modulusCurve, modulusCurve,
  "de ingevoerde E-rekcurve blijft in het 3D-projectbestand behouden");
assert.deepEqual(reopened.model3d.plates[0].reinforcement, reinforcement,
  "de ingevoerde plaatwapening en scheurgrens blijven in het projectbestand behouden");
// Het projectbestand bewaart het Open FEM 3D-model; de frame3d-randtypen (in
// plaatassen) worden bij het lezen omgezet naar globale opleggingen. Deze
// plaat ligt in het XY-vlak: scharnier = uz vast, inklemming = uz, rx en ry
// vast (openFem3dNativeModel, legacyFrame3DEdgeSupportsToOpenFem3D).
const edge = (index, clamped) => ({ edge: index, ux: false, uy: false, uz: true, rx: clamped, ry: clamped, rz: false });
assert.deepEqual(reopened.model3d.plates[0].edgeSupports, [edge(0, false), edge(1, true), edge(3, false)],
  "de plaatrandopleggingen blijven (omgezet naar globale assen) in het projectbestand behouden");
assert.equal(reopened.model3d.plates[0].maxCellSizeM, 0.4);
assert.throws(() => updateFrame3DPlate(withPlate, 1, { edgeSupports: ["free", "clamped"] }), /vier plaatranden/);
assert.throws(() => updateFrame3DPlate(withPlate, 1, { maxCellSizeM: 0 }), /maximale roostermaat/);
// Sinds de samenvoeging met Open FEM 3D heten de weergaven `openFem3dViewSets`
// (een oud bestand met `frame3dViewSets` wordt bij openen daarheen omgezet).
assert.equal(reopened.frame3dViewSets, undefined);
assert.equal(reopened.openFem3dViewSets[0].name, "UGT momentbeeld");
assert.equal(reopened.openFem3dViewSets[0].mode, "results", "de resultaat-tabstand overleeft projectopslag");

console.log("3D-platen, openingen, ronde randen, oppervlaktebelasting en opgeslagen views: geslaagd");

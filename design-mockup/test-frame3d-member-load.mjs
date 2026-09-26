import assert from "node:assert/strict";
import * as THREE from "three";
import {
  addFrame3DNodalLoad,
  addFrame3DMemberLoad,
  addFrame3DMemberPointLoad,
  frame3DMemberAxes,
  parseFrame3DModel,
  removeFrame3DBeam,
  removeFrame3DMemberLoad,
  removeFrame3DMemberPointLoad,
  removeFrame3DNode,
  updateFrame3DMemberLoad,
  updateFrame3DMemberPointLoad,
  withFrame3DSelfWeight,
} from "./src/components/frame3d/frame3dModel.ts";
import { addFrame3DConditionMarkers } from "./src/components/frame3d/frame3dMarkers.ts";
import { buildFrame3DSolveRequest } from "./src/components/frame3d/frame3dSolver.ts";

const base = parseFrame3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 200", material: "S235" }],
  supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
  loads: [], memberLoads: [], memberPointLoads: [],
});
const values = {
  qyStart: 0, qyEnd: 2,
  qzStart: -4, qzEnd: -6,
  startPositionM: 0.5, endPositionM: 3.5,
};
const loaded = addFrame3DMemberLoad(base, 1, values, 2);
assert.deepEqual(loaded.memberLoads, [{ id: 1, beamId: 1, caseId: 2, ...values }]);
assert.equal(base.memberLoads.length, 0, "toevoegen muteert het bronmodel niet");

const changed = updateFrame3DMemberLoad(loaded, 1, { ...values, qzEnd: -8 });
assert.equal(changed.memberLoads[0].qzEnd, -8);
assert.equal(removeFrame3DMemberLoad(changed, 1).memberLoads.length, 0);
assert.throws(() => addFrame3DMemberLoad(base, 9, values), /bestaat niet/);
assert.throws(() => addFrame3DMemberLoad(base, 1, { ...values, endPositionM: 4.1 }), /staaflengte/);
assert.throws(() => addFrame3DMemberLoad(base, 1, { ...values, qzStart: 0, qzEnd: 0, qyEnd: 0 }), /niet-nulwaarde/);

const pointLoaded = addFrame3DMemberPointLoad(loaded, 1, { py: 2, pz: -10, positionM: 2 }, 2);
assert.deepEqual(pointLoaded.memberPointLoads, [{ id: 1, beamId: 1, caseId: 2, py: 2, pz: -10, positionM: 2 }]);
const pointChanged = updateFrame3DMemberPointLoad(pointLoaded, 1, { py: 0, pz: -12, positionM: 1.5 });
assert.equal(pointChanged.memberPointLoads[0].pz, -12);
assert.deepEqual(parseFrame3DModel(JSON.parse(JSON.stringify(pointLoaded))), pointLoaded,
  "staafpuntlast overleeft projectbestandgrens");
assert.equal(removeFrame3DMemberPointLoad(pointChanged, 1).memberPointLoads.length, 0);
assert.throws(() => addFrame3DMemberPointLoad(base, 1, { py: 0, pz: 0, positionM: 2 }), /niet-nulwaarde/);
assert.throws(() => addFrame3DMemberPointLoad(base, 1, { py: 0, pz: -10, positionM: 4.1 }), /staaflengte/);

const reopened = parseFrame3DModel(JSON.parse(JSON.stringify(loaded)));
assert.deepEqual(reopened, loaded, "staaflast overleeft projectbestandgrens");
const request = buildFrame3DSolveRequest(reopened, "linear", 2);
assert.deepEqual(request.memberLoads, [{
  id: 1, memberId: 1,
  qyStartKnPerM: 0, qyEndKnPerM: 2,
  qzStartKnPerM: -4, qzEndKnPerM: -6,
  startPositionM: 0.5, endPositionM: 3.5,
}]);
assert.deepEqual(buildFrame3DSolveRequest(pointLoaded, "linear", 2).memberPointLoads, [{
  id: 1, memberId: 1, pyKn: 2, pzKn: -10, positionM: 2,
}]);
assert.throws(() => buildFrame3DSolveRequest(reopened, "linear", 1), /bevat geen 3D-belastingen/);

const oriented = parseFrame3DModel({
  ...JSON.parse(JSON.stringify(loaded)),
  beams: [{
    ...loaded.beams[0],
    rollAngleRad: Math.PI / 2,
    releases: {
      myStart: true, myEnd: false,
      mzStart: false, mzEnd: true,
      torsionStart: true, torsionEnd: false,
    },
  }],
});
const orientedRequest = buildFrame3DSolveRequest(oriented, "linear", 2);
assert.equal(orientedRequest.members[0].rollAngleRad, Math.PI / 2);
assert.deepEqual(orientedRequest.members[0].releases, oriented.beams[0].releases);
assert.deepEqual(parseFrame3DModel(JSON.parse(JSON.stringify(oriented))), oriented,
  "profielrotatie en zes eindscharnieren overleven de projectbestandgrens");
const orientedAxes = frame3DMemberAxes(oriented.nodes[0], oriented.nodes[1], Math.PI / 2);
assert.ok(Math.abs(orientedAxes.ey[2] - 1) < 1e-12 && Math.abs(orientedAxes.ez[1] + 1) < 1e-12,
  "90 graden profielrotatie draait lokale y naar globale z");
assert.throws(() => parseFrame3DModel({
  ...JSON.parse(JSON.stringify(base)),
  beams: [{ ...base.beams[0], rollAngleRad: Number.NaN }],
}), /ongeldige profielrotatie/);
assert.throws(() => parseFrame3DModel({
  ...JSON.parse(JSON.stringify(base)),
  beams: [{ ...base.beams[0], releases: { myStart: "ja" } }],
}), /ongeldig eindscharnier/);

const withTwoCases = addFrame3DNodalLoad(pointLoaded, 2, {
  fx: 10, fy: 0, fz: -2, mx: 0, my: 3, mz: 0,
}, 1);
const combination = buildFrame3DSolveRequest(
  withTwoCases,
  "p-delta",
  new Map([[1, 1.35], [2, 1.5]]),
);
assert.deepEqual(combination.nodalLoads, [{
  id: 1, nodeId: 2, fx: 13.5, fy: 0, fz: -2.7, mx: 0, my: 4.050000000000001, mz: 0,
}], "combinatiefactor schaalt alle zes knooplastcomponenten vóór de solver");
assert.deepEqual(combination.memberLoads, [{
  id: 1, memberId: 1,
  qyStartKnPerM: 0, qyEndKnPerM: 3,
  qzStartKnPerM: -6, qzEndKnPerM: -9,
  startPositionM: 0.5, endPositionM: 3.5,
}], "combinatiefactor schaalt de volledige trapeziumlast vóór de solver");
assert.deepEqual(combination.memberPointLoads, [{
  id: 1, memberId: 1, pyKn: 3, pzKn: -15, positionM: 2,
}], "combinatiefactor schaalt de staafpuntlast vóór de solver");
assert.throws(
  () => buildFrame3DSolveRequest(withTwoCases, "p-delta", new Map([[1, 0], [2, 0]])),
  /combinatie bevat geen 3D-belastingen/,
);
assert.throws(
  () => buildFrame3DSolveRequest(withTwoCases, "p-delta", new Map([[1, Number.NaN]])),
  /ongeldige combinatiefactor/,
);

const markers = new THREE.Group();
addFrame3DConditionMarkers(markers, pointLoaded, { supports: false, loads: true });
assert.ok(markers.children.some((child) => child instanceof THREE.ArrowHelper), "verdeelde last toont pijlen");
const markerTypes = new Set(markers.children.map((child) => child.userData.type));
assert.ok(markerTypes.has("memberLoad"), "lijnlastsymbolen selecteren de lijnlast zelf");
assert.ok(markerTypes.has("memberPointLoad"), "puntlastsymbolen selecteren de staafpuntlast zelf");
assert.ok([...markerTypes].every((type) => type === "memberLoad" || type === "memberPointLoad"),
  "ieder zichtbaar lastsymbool verwijst naar een selecteerbare last");
const hiddenMarkers = new THREE.Group();
addFrame3DConditionMarkers(hiddenMarkers, loaded, { supports: false, loads: true }, 1);
assert.equal(hiddenMarkers.children.length, 0, "een ander belastinggeval blijft uit beeld");

assert.equal(removeFrame3DBeam(loaded, 1).memberLoads.length, 0, "staaf verwijderen ruimt zijn lasten op");
assert.equal(removeFrame3DNode(loaded, 1).memberLoads.length, 0, "knoop verwijderen ruimt lasten van verwijderde staven op");
assert.equal(removeFrame3DBeam(pointLoaded, 1).memberPointLoads.length, 0, "staaf verwijderen ruimt puntlasten op");
assert.equal(removeFrame3DNode(pointLoaded, 1).memberPointLoads.length, 0, "knoop verwijderen ruimt staafpuntlasten op");

const horizontalWeight = withFrame3DSelfWeight(base, 5);
const expectedWeight = 7850 * (2850e-6) * 9.81 / 1000;
assert.equal(horizontalWeight.loads.length, 0, "horizontale zwaartekracht heeft geen lokale axiale component");
assert.equal(horizontalWeight.memberLoads.length, 1);
assert.equal(horizontalWeight.memberLoads[0].caseId, 5);
assert.ok(Math.abs(horizontalWeight.memberLoads[0].qzStart + expectedWeight) < 1e-12);
assert.equal(base.memberLoads.length, 0, "automatisch eigen gewicht blijft vluchtig");
const rolledWeight = withFrame3DSelfWeight({ ...oriented, loads: [], memberLoads: [] }, 5);
assert.ok(Math.abs(rolledWeight.memberLoads[0].qyStart + expectedWeight) < 1e-12);
assert.ok(Math.abs(rolledWeight.memberLoads[0].qzStart) < 1e-12,
  "eigen gewicht volgt na profielrotatie dezelfde lokale assen als de solver");

const vertical = parseFrame3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 4 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 200", material: "S235" }],
  supports: [], loads: [], memberLoads: [],
});
const verticalWeight = withFrame3DSelfWeight(vertical, 5);
assert.equal(verticalWeight.memberLoads.length, 0, "verticale zwaartekracht is volledig axiaal");
assert.equal(verticalWeight.loads.length, 2);
assert.ok(Math.abs(verticalWeight.loads.reduce((sum, load) => sum + load.fz, 0) + expectedWeight * 4) < 1e-12,
  "axiaal eigen gewicht levert exact zijn totale globale gewicht op");

console.log("3D-staaflast: model, solvercontract, markers en opruimen geslaagd");

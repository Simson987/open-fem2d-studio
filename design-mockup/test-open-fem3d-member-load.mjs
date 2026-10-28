import assert from "node:assert/strict";
import * as THREE from "three";
import {
  addOpenFem3DNodalLoad,
  addOpenFem3DMemberLoad,
  addOpenFem3DMemberPointLoad,
  openFem3DMemberAxes,
  parseOpenFem3DModel,
  removeOpenFem3DBeam,
  removeOpenFem3DMemberLoad,
  removeOpenFem3DMemberPointLoad,
  removeOpenFem3DNode,
  updateOpenFem3DMemberLoad,
  updateOpenFem3DMemberPointLoad,
  withOpenFem3DSelfWeight,
} from "./src/components/openFem3d/openFem3dModel.ts";
import { addOpenFem3DConditionMarkers } from "./src/components/openFem3d/openFem3dMarkers.ts";
import { buildOpenFem3DSolveRequest } from "./src/components/openFem3d/openFem3dSolver.ts";

const base = parseOpenFem3DModel({
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
const loaded = addOpenFem3DMemberLoad(base, 1, values, 2);
assert.deepEqual(loaded.memberLoads, [{ id: 1, beamId: 1, caseId: 2, ...values }]);
assert.equal(base.memberLoads.length, 0, "toevoegen muteert het bronmodel niet");

const changed = updateOpenFem3DMemberLoad(loaded, 1, { ...values, qzEnd: -8 });
assert.equal(changed.memberLoads[0].qzEnd, -8);
assert.equal(removeOpenFem3DMemberLoad(changed, 1).memberLoads.length, 0);
assert.throws(() => addOpenFem3DMemberLoad(base, 9, values), /bestaat niet/);
assert.throws(() => addOpenFem3DMemberLoad(base, 1, { ...values, endPositionM: 4.1 }), /staaflengte/);
assert.throws(() => addOpenFem3DMemberLoad(base, 1, { ...values, qzStart: 0, qzEnd: 0, qyEnd: 0 }), /niet-nulwaarde/);

const pointLoaded = addOpenFem3DMemberPointLoad(loaded, 1, { py: 2, pz: -10, positionM: 2 }, 2);
assert.deepEqual(pointLoaded.memberPointLoads, [{ id: 1, beamId: 1, caseId: 2, py: 2, pz: -10, positionM: 2 }]);
const pointChanged = updateOpenFem3DMemberPointLoad(pointLoaded, 1, { py: 0, pz: -12, positionM: 1.5 });
assert.equal(pointChanged.memberPointLoads[0].pz, -12);
assert.deepEqual(parseOpenFem3DModel(JSON.parse(JSON.stringify(pointLoaded))), pointLoaded,
  "staafpuntlast overleeft projectbestandgrens");
assert.equal(removeOpenFem3DMemberPointLoad(pointChanged, 1).memberPointLoads.length, 0);
assert.throws(() => addOpenFem3DMemberPointLoad(base, 1, { py: 0, pz: 0, positionM: 2 }), /niet-nulwaarde/);
assert.throws(() => addOpenFem3DMemberPointLoad(base, 1, { py: 0, pz: -10, positionM: 4.1 }), /staaflengte/);

const reopened = parseOpenFem3DModel(JSON.parse(JSON.stringify(loaded)));
assert.deepEqual(reopened, loaded, "staaflast overleeft projectbestandgrens");
const request = buildOpenFem3DSolveRequest(reopened, "linear", 2);
assert.deepEqual(request.memberLoads, [{
  id: 1, memberId: 1,
  qyStartKnPerM: 0, qyEndKnPerM: 2,
  qzStartKnPerM: -4, qzEndKnPerM: -6,
  startPositionM: 0.5, endPositionM: 3.5,
}]);
assert.deepEqual(buildOpenFem3DSolveRequest(pointLoaded, "linear", 2).memberPointLoads, [{
  id: 1, memberId: 1, pyKn: 2, pzKn: -10, positionM: 2,
}]);
assert.throws(() => buildOpenFem3DSolveRequest(reopened, "linear", 1), /bevat geen 3D-belastingen/);

const oriented = parseOpenFem3DModel({
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
const orientedRequest = buildOpenFem3DSolveRequest(oriented, "linear", 2);
assert.equal(orientedRequest.members[0].rollAngleRad, Math.PI / 2);
assert.deepEqual(orientedRequest.members[0].releases, oriented.beams[0].releases);
assert.deepEqual(parseOpenFem3DModel(JSON.parse(JSON.stringify(oriented))), oriented,
  "profielrotatie en zes eindscharnieren overleven de projectbestandgrens");
const orientedAxes = openFem3DMemberAxes(oriented.nodes[0], oriented.nodes[1], Math.PI / 2);
assert.ok(Math.abs(orientedAxes.ey[2] - 1) < 1e-12 && Math.abs(orientedAxes.ez[1] + 1) < 1e-12,
  "90 graden profielrotatie draait lokale y naar globale z");
assert.throws(() => parseOpenFem3DModel({
  ...JSON.parse(JSON.stringify(base)),
  beams: [{ ...base.beams[0], rollAngleRad: Number.NaN }],
}), /ongeldige profielrotatie/);
assert.throws(() => parseOpenFem3DModel({
  ...JSON.parse(JSON.stringify(base)),
  beams: [{ ...base.beams[0], releases: { myStart: "ja" } }],
}), /ongeldig eindscharnier/);

const withTwoCases = addOpenFem3DNodalLoad(pointLoaded, 2, {
  fx: 10, fy: 0, fz: -2, mx: 0, my: 3, mz: 0,
}, 1);
const combination = buildOpenFem3DSolveRequest(
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
  () => buildOpenFem3DSolveRequest(withTwoCases, "p-delta", new Map([[1, 0], [2, 0]])),
  /combinatie bevat geen 3D-belastingen/,
);
assert.throws(
  () => buildOpenFem3DSolveRequest(withTwoCases, "p-delta", new Map([[1, Number.NaN]])),
  /ongeldige combinatiefactor/,
);

const markers = new THREE.Group();
addOpenFem3DConditionMarkers(markers, pointLoaded, { supports: false, loads: true });
assert.ok(markers.children.some((child) => child instanceof THREE.ArrowHelper), "verdeelde last toont pijlen");
const markerTypes = new Set(markers.children.map((child) => child.userData.type));
assert.ok(markerTypes.has("memberLoad"), "lijnlastsymbolen selecteren de lijnlast zelf");
assert.ok(markerTypes.has("memberPointLoad"), "puntlastsymbolen selecteren de staafpuntlast zelf");
assert.ok([...markerTypes].every((type) => type === "memberLoad" || type === "memberPointLoad"),
  "ieder zichtbaar lastsymbool verwijst naar een selecteerbare last");
const hiddenMarkers = new THREE.Group();
addOpenFem3DConditionMarkers(hiddenMarkers, loaded, { supports: false, loads: true }, 1);
assert.equal(hiddenMarkers.children.length, 0, "een ander belastinggeval blijft uit beeld");

assert.equal(removeOpenFem3DBeam(loaded, 1).memberLoads.length, 0, "staaf verwijderen ruimt zijn lasten op");
assert.equal(removeOpenFem3DNode(loaded, 1).memberLoads.length, 0, "knoop verwijderen ruimt lasten van verwijderde staven op");
assert.equal(removeOpenFem3DBeam(pointLoaded, 1).memberPointLoads.length, 0, "staaf verwijderen ruimt puntlasten op");
assert.equal(removeOpenFem3DNode(pointLoaded, 1).memberPointLoads.length, 0, "knoop verwijderen ruimt staafpuntlasten op");

// Eigen gewicht (#112): een globale lijnlast in Z over de hele staaf, ook bij een
// liggende, gedraaide of staande staaf. De kern ontbindt haar in de lokale assen
// en verdeelt de axiale component; de app zet geen knooplasten meer.
const expectedWeight = 7850 * (2850e-6) * 9.81 / 1000;
const isEigenGewicht = (load, lengte) => load.caseId === 5 && load.globalDirection === "z" && load.perProjection === undefined
  && Math.abs(load.qStart + expectedWeight) < 1e-12 && load.qEnd === load.qStart
  && load.startPositionM === 0 && Math.abs(load.endPositionM - lengte) < 1e-12;
const horizontalWeight = withOpenFem3DSelfWeight(base, 5);
assert.equal(horizontalWeight.loads.length, 0, "eigen gewicht geeft geen knooplasten");
assert.equal(horizontalWeight.memberLoads.length, 1);
assert.ok(isEigenGewicht(horizontalWeight.memberLoads[0], 4), "liggend: één globale Z-last −ρ·A·g over de hele staaf");
assert.equal(base.memberLoads.length, 0, "automatisch eigen gewicht blijft vluchtig");
const rolledWeight = withOpenFem3DSelfWeight({ ...oriented, loads: [], memberLoads: [] }, 5);
assert.ok(rolledWeight.memberLoads.length === 1 && isEigenGewicht(rolledWeight.memberLoads[0], 4),
  "gedraaid profiel: dezelfde globale last; de kern ontbindt haar met de rolhoek");
const rolledRequest = buildOpenFem3DSolveRequest(rolledWeight, "linear", new Map([[5, 1]]));
assert.ok(rolledRequest.memberLoads.length === 1 && rolledRequest.memberLoads[0].globalDirection === "z"
  && rolledRequest.memberLoads[0].qStartKnPerM === rolledWeight.memberLoads[0].qStart,
  "het rekenverzoek draagt de globale last ongewijzigd");

const vertical = parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 4 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 200", material: "S235" }],
  supports: [], loads: [], memberLoads: [],
});
const verticalWeight = withOpenFem3DSelfWeight(vertical, 5);
assert.equal(verticalWeight.loads.length, 0, "staand: geen knooplasten op de staafeinden meer");
assert.ok(verticalWeight.memberLoads.length === 1 && isEigenGewicht(verticalWeight.memberLoads[0], 4),
  "staand: één globale Z-last langs de staaf, samen exact ρ·A·g·L");

console.log("3D-staaflast: model, solvercontract, markers en opruimen geslaagd");

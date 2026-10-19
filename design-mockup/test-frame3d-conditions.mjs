import assert from "node:assert/strict";
import * as THREE from "three";
import { buildFrame3DNodeSnapScreenIndex, findFrame3DNodeScreenSnap } from "./src/components/frame3d/frame3dNodeSnapIndex.ts";
import { frame3DGridLayout } from "./src/components/frame3d/frame3dGrid.ts";
import {
  FRAME3D_SUPPORT_PRESETS,
  addFrame3DNodalLoad,
  addFrame3DThermalLoad,
  frame3DRevoluteAxis,
  frame3DSupportPresetOf,
  parseFrame3DModel,
  removeFrame3DNode,
  removeFrame3DNodalLoad,
  removeFrame3DSupport,
  removeFrame3DThermalLoad,
  setFrame3DSupport,
  setFrame3DBeamNodes,
  setFrame3DSupportPrescribed,
  setFrame3DSupportSprings,
  splitFrame3DBeam,
  updateFrame3DNodalLoad,
  updateFrame3DThermalLoad,
} from "./src/components/frame3d/frame3dModel.ts";
import { addFrame3DConditionMarkers } from "./src/components/frame3d/frame3dMarkers.ts";
import { buildFrame3DSolveRequest } from "./src/components/frame3d/frame3dSolver.ts";

const geometry = {
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 3 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }],
};
const oldModel = parseFrame3DModel(geometry);
assert.deepEqual(oldModel, { ...geometry, supports: [], loads: [] });

const pinned = setFrame3DSupport(oldModel, 1, FRAME3D_SUPPORT_PRESETS.pinned);
assert.equal(pinned.supports.length, 1);
assert.deepEqual(pinned.supports[0], { nodeId: 1, ...FRAME3D_SUPPORT_PRESETS.pinned });
assert.equal(oldModel.supports.length, 0, "updates must not mutate old state");
const fixed = setFrame3DSupport(pinned, 1, FRAME3D_SUPPORT_PRESETS.fixed);
assert.equal(fixed.supports.length, 1, "one node has at most one support");
assert.deepEqual(fixed.supports[0], { nodeId: 1, ...FRAME3D_SUPPORT_PRESETS.fixed });
assert.equal(removeFrame3DSupport(fixed, 1).supports.length, 0);
assert.throws(() => setFrame3DSupport(oldModel, 9, FRAME3D_SUPPORT_PRESETS.fixed), /bestaat niet/);
const reconnectSource = {
  ...oldModel,
  nodes: [...oldModel.nodes, { id: 3, x: 4, y: 2, z: 3 }, { id: 4, x: 4, y: 0, z: 3 }],
};
const reconnected = setFrame3DBeamNodes(reconnectSource, 1, 1, 3);
assert.deepEqual([reconnected.beams[0].startNodeId, reconnected.beams[0].endNodeId], [1, 3]);
assert.deepEqual([reconnectSource.beams[0].startNodeId, reconnectSource.beams[0].endNodeId], [1, 2],
  "herverbinden muteert het oude model niet");
assert.throws(() => setFrame3DBeamNodes(reconnectSource, 1, 1, 1), /niet-nulle lengte/);
assert.throws(() => setFrame3DBeamNodes(reconnectSource, 1, 2, 4), /niet-nulle lengte/,
  "verschillende knoop-id's op dezelfde positie vormen nog steeds een nulstaaf");

const splitSource = {
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 10, y: 0, z: 0 }],
  beams: [{
    id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 300", material: "S355", rollAngleRad: 0.3,
    checkConfig: { materialStandard: "EN 1993-1-1" },
    releases: { myStart: true, myEnd: true, mzStart: true, mzEnd: true, torsionStart: true, torsionEnd: true },
  }],
  supports: [], loads: [],
  memberLoads: [
    { id: 1, beamId: 1, qyStart: 1, qyEnd: 3, qzStart: 2, qzEnd: 4, startPositionM: 0, endPositionM: 2 },
    { id: 2, beamId: 1, caseId: 7, qyStart: 2, qyEnd: 8, qzStart: -2, qzEnd: -8, startPositionM: 2, endPositionM: 8 },
    { id: 3, beamId: 1, qyStart: 7, qyEnd: 9, qzStart: 0, qzEnd: 0, startPositionM: 7, endPositionM: 9 },
  ],
  memberPointLoads: [
    { id: 1, beamId: 1, py: 2, pz: 0, positionM: 2 },
    { id: 2, beamId: 1, py: 0, pz: -3, positionM: 5 },
    { id: 3, beamId: 1, py: 4, pz: 5, positionM: 9 },
  ],
  thermalLoads: [{ id: 1, beamId: 1, caseId: 7, deltaTUniformK: 20, deltaTGradientYK: 5, deltaTGradientZK: -4 }],
};
const split = splitFrame3DBeam(splitSource, 1, 0.5);
assert.equal(split.nodeId, 3);
assert.equal(split.secondBeamId, 2);
assert.deepEqual(split.model.nodes[2], { id: 3, x: 5, y: 0, z: 0 });
assert.deepEqual(split.model.beams.map((beam) => [beam.id, beam.startNodeId, beam.endNodeId]), [
  [1, 1, 3], [2, 3, 2],
]);
assert.equal(split.model.beams[0].profileName, "IPE 300");
assert.equal(split.model.beams[1].material, "S355");
assert.equal(split.model.beams[1].rollAngleRad, 0.3);
assert.deepEqual(split.model.beams[0].checkConfig, splitSource.beams[0].checkConfig);
assert.deepEqual(split.model.beams[0].releases, {
  myStart: true, myEnd: false, mzStart: true, mzEnd: false, torsionStart: true, torsionEnd: false,
});
assert.deepEqual(split.model.beams[1].releases, {
  myStart: false, myEnd: true, mzStart: false, mzEnd: true, torsionStart: false, torsionEnd: true,
});
assert.deepEqual(split.model.memberLoads, [
  splitSource.memberLoads[0],
  { ...splitSource.memberLoads[1], qyEnd: 5, qzEnd: -5, endPositionM: 5 },
  { ...splitSource.memberLoads[1], id: 4, beamId: 2, qyStart: 5, qzStart: -5, startPositionM: 0, endPositionM: 3 },
  { ...splitSource.memberLoads[2], beamId: 2, startPositionM: 2, endPositionM: 4 },
]);
assert.deepEqual(split.model.memberPointLoads, [
  splitSource.memberPointLoads[0],
  { ...splitSource.memberPointLoads[1], beamId: 2, positionM: 0 },
  { ...splitSource.memberPointLoads[2], beamId: 2, positionM: 4 },
]);
assert.deepEqual(split.model.thermalLoads, [
  splitSource.thermalLoads[0],
  { ...splitSource.thermalLoads[0], id: 2, beamId: 2 },
]);
assert.equal(splitSource.nodes.length, 2, "splitsen muteert het oude model niet");
assert.throws(() => splitFrame3DBeam(splitSource, 1, 0), /binnen/);
assert.throws(() => splitFrame3DBeam(splitSource, 1, 1), /binnen/);
const reusedNode = splitFrame3DBeam({
  ...splitSource,
  nodes: [...splitSource.nodes, { id: 9, x: 5, y: 0, z: 0 }],
}, 1, 0.5);
assert.equal(reusedNode.nodeId, 9, "een bestaande knoop op het knippunt wordt hergebruikt");
assert.equal(reusedNode.model.nodes.length, 3);
for (const axis of ["X", "Y", "Z"]) {
  const presetName = `revolute${axis}`;
  const preset = FRAME3D_SUPPORT_PRESETS[presetName];
  assert.equal(frame3DSupportPresetOf(preset), presetName);
  assert.equal(frame3DRevoluteAxis(preset), axis.toLowerCase());
  assert.equal(preset.ux && preset.uy && preset.uz, true, `${presetName} is translatievast`);
  assert.equal([preset.rx, preset.ry, preset.rz].filter(Boolean).length, 2, `${presetName} laat precies één rotatie vrij`);
}
for (const axis of ["x", "y", "z"]) {
  const presetName = `${axis}Roller`;
  const preset = FRAME3D_SUPPORT_PRESETS[presetName];
  assert.equal(frame3DSupportPresetOf(preset), presetName);
  assert.equal([preset.ux, preset.uy, preset.uz].filter(Boolean).length, 1,
    `${presetName} blokkeert precies één translatie`);
  assert.equal(preset[`u${axis}`], true, `${presetName} blokkeert de globale ${axis.toUpperCase()}-translatie`);
  assert.equal([preset.rx, preset.ry, preset.rz].some(Boolean), false, `${presetName} laat alle rotaties vrij`);
}

const sprung = setFrame3DSupportSprings(pinned, 2, {
  kzKnPerM: 370,
  kryKnmPerRad: 125,
});
assert.deepEqual(sprung.supports.find((support) => support.nodeId === 2), {
  nodeId: 2, ux: false, uy: false, uz: false, rx: false, ry: false, rz: false,
  springs: { kzKnPerM: 370, kryKnmPerRad: 125 },
});
assert.throws(() => setFrame3DSupportSprings(pinned, 2, { kzKnPerM: 0 }), /positieve/);
const imposed = setFrame3DSupportPrescribed(pinned, 1, { uxM: 0.001, rzRad: -0.002 });
assert.equal(imposed.supports[0].ux, true);
assert.equal(imposed.supports[0].rz, true, "een opgelegde rotatie blokkeert de bijbehorende DOF");
assert.deepEqual(imposed.supports[0].prescribed, { uxM: 0.001, rzRad: -0.002 });
const imposedRequest = buildFrame3DSolveRequest({
  ...imposed,
  beams: [{ ...imposed.beams[0], profileName: "IPE200", material: "S235" }],
});
assert.equal(imposedRequest.supports[0].uxPrescribedM, 0.001);
assert.equal(imposedRequest.supports[0].rzPrescribedRad, -0.002);
assert.equal("prescribed" in imposedRequest.supports[0], false, "solvercontract gebruikt vlakke velden met eenheden");

const load = { fx: 4, fy: 0, fz: -10, mx: 0, my: 0, mz: 2 };
const loaded = addFrame3DNodalLoad(pinned, 2, load);
assert.deepEqual(loaded.loads, [{ id: 1, nodeId: 2, ...load }]);
assert.equal(pinned.loads.length, 0);
const changed = updateFrame3DNodalLoad(loaded, 1, { ...load, fx: -3, mz: 0 });
assert.equal(changed.loads[0].fx, -3);
assert.equal(changed.loads[0].nodeId, 2);
assert.equal(removeFrame3DNodalLoad(changed, 1).loads.length, 0);
assert.throws(() => addFrame3DNodalLoad(oldModel, 9, load), /bestaat niet/);
assert.throws(() => addFrame3DNodalLoad(oldModel, 1,
  { fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }), /niet-nulwaarde/);

const withConditions = {
  ...geometry,
  supports: [
    { nodeId: 1, ...FRAME3D_SUPPORT_PRESETS.fixed },
    { nodeId: 2, ...FRAME3D_SUPPORT_PRESETS.revoluteX },
  ],
  loads: [
    { id: 1, nodeId: 1, ...load },
    { id: 2, nodeId: 2, fx: 0, fy: 7, fz: 0, mx: 0, my: 0, mz: 0 },
  ],
};
assert.deepEqual(parseFrame3DModel(withConditions), withConditions);
const springModel = parseFrame3DModel({
  ...withConditions,
  supports: [withConditions.supports[0], {
    nodeId: 2, ux: false, uy: true, uz: false, rx: false, ry: false, rz: false,
    springs: { kzKnPerM: 370, kryKnmPerRad: 125 },
  }],
});
const solverSpring = buildFrame3DSolveRequest({
  ...springModel,
  beams: [{ ...springModel.beams[0], profileName: "IPE200", material: "S235" }],
});
assert.equal(solverSpring.supports[1].kzKnPerM, 370);
assert.equal(solverSpring.supports[1].kryKnmPerRad, 125);
assert.equal("springs" in solverSpring.supports[1], false, "solvercontract is vlak en heeft expliciete eenheden");
const thermal = addFrame3DThermalLoad(springModel, 1, {
  deltaTUniformK: 25, deltaTGradientYK: 4, deltaTGradientZK: -6,
}, 2);
assert.deepEqual(thermal.thermalLoads, [{
  id: 1, beamId: 1, caseId: 2,
  deltaTUniformK: 25, deltaTGradientYK: 4, deltaTGradientZK: -6,
}]);
const changedThermal = updateFrame3DThermalLoad(thermal, 1, {
  deltaTUniformK: 30, deltaTGradientYK: 0, deltaTGradientZK: 0,
});
assert.equal(changedThermal.thermalLoads[0].deltaTUniformK, 30);
assert.equal(removeFrame3DThermalLoad(changedThermal, 1).thermalLoads.length, 0);
const parsedThermal = parseFrame3DModel(thermal);
const thermalRequest = buildFrame3DSolveRequest({
  ...parsedThermal,
  beams: [{ ...parsedThermal.beams[0], profileName: "IPE200", material: "S235" }],
}, "linear", 2);
assert.equal(thermalRequest.thermalLoads[0].deltaTUniformK, 25);
assert.equal(thermalRequest.thermalLoads[0].deltaTGradientZK, -6);
assert.equal(thermalRequest.materials[0].alphaPerK, 12e-6);
const concreteThermalRequest = buildFrame3DSolveRequest({
  ...parsedThermal,
  beams: [{ ...parsedThermal.beams[0], profileName: "300x600", material: "C30/37" }],
}, "linear", 2);
assert.equal(concreteThermalRequest.materials[0].alphaPerK, 10e-6);
assert.throws(() => addFrame3DThermalLoad(springModel, 1, {
  deltaTUniformK: 0, deltaTGradientYK: 0, deltaTGradientZK: 0,
}), /niet-nulwaarde/);
for (const malformed of [
  { ...withConditions, supports: "wrong" },
  { ...withConditions, supports: [withConditions.supports[0], withConditions.supports[0]] },
  { ...withConditions, supports: [{ ...withConditions.supports[0], nodeId: 9 }] },
  { ...withConditions, supports: [{ ...withConditions.supports[0], ry: 1 }] },
  { ...withConditions, supports: [{ ...withConditions.supports[0], ux: false, uy: false, uz: false, rx: false, ry: false, rz: false }] },
  { ...withConditions, supports: [{ ...withConditions.supports[0], ux: false, springs: { kxKnPerM: 0 } }] },
  { ...withConditions, supports: [{ ...withConditions.supports[0], springs: { kxKnPerM: 100 } }] },
  { ...withConditions, supports: [{ ...withConditions.supports[0], ux: false, prescribed: { uxM: 0.001 } }] },
  { ...withConditions, supports: [{ ...withConditions.supports[0], prescribed: { uzM: Infinity } }] },
  { ...withConditions, loads: [withConditions.loads[0], withConditions.loads[0]] },
  { ...withConditions, loads: [{ ...withConditions.loads[0], nodeId: 9 }] },
  { ...withConditions, loads: [{ ...withConditions.loads[0], fy: Infinity }] },
  { ...withConditions, thermalLoads: [{ id: 1, beamId: 1, deltaTUniformK: 0, deltaTGradientYK: 0, deltaTGradientZK: 0 }] },
]) {
  assert.throws(() => parseFrame3DModel(malformed));
}

const afterDelete = removeFrame3DNode(withConditions, 1);
assert.deepEqual(afterDelete.nodes.map((node) => node.id), [2]);
assert.equal(afterDelete.beams.length, 0);
assert.deepEqual(afterDelete.supports.map((support) => support.nodeId), [2]);
assert.deepEqual(afterDelete.loads.map((item) => item.nodeId), [2]);

const supportOnly = new THREE.Group();
addFrame3DConditionMarkers(supportOnly, withConditions, { supports: true, loads: false });
assert.ok(supportOnly.children.length > 0);
assert.ok(supportOnly.children.every((child) => child instanceof THREE.Mesh && child.userData.type === "node"));
assert.ok(supportOnly.children.some((child) => child.geometry.type === "TorusGeometry"),
  "revolute support has a visible rotation ring");
const edgeModel = parseFrame3DModel({ nodes: [
  { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 2, y: 0, z: 0 },
  { id: 3, x: 2, y: 2, z: 0 }, { id: 4, x: 0, y: 2, z: 0 },
], beams: [], plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2,
  edgeSupports: ["simplySupported", "clamped", "free", "free"] }] });
const edgeMarkers = new THREE.Group();
addFrame3DConditionMarkers(edgeMarkers, edgeModel, { supports: true, loads: false });
assert.deepEqual(edgeMarkers.children.map((child) => child.userData.frame3dPlateEdgeSupport),
  ["simplySupported", "clamped"]);
const hiddenEdges = new THREE.Group();
addFrame3DConditionMarkers(hiddenEdges, edgeModel, { supports: false, loads: false });
assert.equal(hiddenEdges.children.length, 0);
const rollerOnly = new THREE.Group();
const rollerModel = {
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 },
    { id: 2, x: 2, y: 0, z: 0 },
    { id: 3, x: 4, y: 0, z: 0 },
  ],
  beams: [], loads: [],
  supports: [
    { nodeId: 1, ...FRAME3D_SUPPORT_PRESETS.xRoller },
    { nodeId: 2, ...FRAME3D_SUPPORT_PRESETS.yRoller },
    { nodeId: 3, ...FRAME3D_SUPPORT_PRESETS.zRoller },
  ],
};
addFrame3DConditionMarkers(rollerOnly, rollerModel, { supports: true, loads: false });
const enlargedRollers = new THREE.Group();
addFrame3DConditionMarkers(enlargedRollers, rollerModel, { supports: true, loads: false }, undefined, 2);
const normalCone = rollerOnly.children.find((child) => child.userData.id === 1 && child.geometry?.type === "ConeGeometry");
const enlargedCone = enlargedRollers.children.find((child) => child.userData.id === 1 && child.geometry?.type === "ConeGeometry");
assert.equal(enlargedCone.geometry.parameters.radius, normalCone.geometry.parameters.radius * 2,
  "support scale changes the visible support geometry");
assert.equal(enlargedCone.position.distanceTo(rollerModel.nodes[0]),
  normalCone.position.distanceTo(rollerModel.nodes[0]) * 2,
  "support scale also changes the symbol offset from its node");
for (const [nodeId, expectedAxis] of [[1, new THREE.Vector3(1, 0, 0)], [2, new THREE.Vector3(0, 1, 0)], [3, new THREE.Vector3(0, 0, 1)]]) {
  const cone = rollerOnly.children.find((child) => child.userData.id === nodeId && child.geometry?.type === "ConeGeometry");
  assert.ok(cone, `rol ${nodeId} heeft een zichtbaar 3D-kegelsymbool`);
  const renderedAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(cone.quaternion);
  assert.ok(renderedAxis.distanceTo(expectedAxis) < 1e-10, `rol ${nodeId} is op de juiste globale as gericht`);
}
const springOnly = new THREE.Group();
addFrame3DConditionMarkers(springOnly, springModel, { supports: true, loads: false });
assert.ok(springOnly.children.some((child) => child instanceof THREE.Mesh && child.geometry.type === "TubeGeometry"),
  "translatieveer heeft een ronde 3D-spoel");
assert.ok(springOnly.children.some((child) => child.geometry?.type === "TorusGeometry"), "rotatieve veer heeft een ronde boog");
const imposedOnly = new THREE.Group();
addFrame3DConditionMarkers(imposedOnly, imposed, { supports: true, loads: false });
assert.ok(imposedOnly.children.some((child) => child.material?.color?.getHex() === 0x0891b2),
  "opgelegde verplaatsing heeft een zichtbaar cyaan symbool");
const loadOnly = new THREE.Group();
addFrame3DConditionMarkers(loadOnly, withConditions, { supports: false, loads: true });
assert.ok(loadOnly.children.length > 0);
const largeMarkerModel = {
  nodes: Array.from({ length: 120 }, (_, index) => ({ id: index + 1, x: index % 20, y: Math.floor(index / 20), z: 0 })),
  beams: [],
  supports: Array.from({ length: 120 }, (_, index) => ({ nodeId: index + 1, ...FRAME3D_SUPPORT_PRESETS.fixed })),
  loads: Array.from({ length: 120 }, (_, index) => ({
    id: index + 1, nodeId: index + 1, fx: 2, fy: 0, fz: -5, mx: 0, my: 0, mz: 0,
  })),
};
const largeMarkers = new THREE.Group();
addFrame3DConditionMarkers(largeMarkers, largeMarkerModel, { supports: true, loads: true });
assert.ok(largeMarkers.children.length <= 8, "grote aantallen opleggingen en lasten blijven enkele GPU-batches");
assert.ok(largeMarkers.children.every((child) => child instanceof THREE.InstancedMesh),
  "ieder groot markersymbool wordt als selecteerbare instancing-batch getekend");
assert.ok(largeMarkers.children.every((child) => child.userData.instanceIds.length === child.count),
  "iedere markerinstantie behoudt zijn selecteerbare model-id");
const largeMemberLoadModel = {
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 12, y: 0, z: 0 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }],
  supports: [], loads: [],
  memberLoads: Array.from({ length: 240 }, (_, index) => ({
    id: index + 1, beamId: 1,
    qyStart: -2 - index / 240, qyEnd: -3 - index / 240,
    qzStart: 0, qzEnd: 0, startPositionM: 0, endPositionM: 12,
  })),
};
const largeMemberLoadMarkers = new THREE.Group();
addFrame3DConditionMarkers(largeMemberLoadMarkers, largeMemberLoadModel, { supports: false, loads: true });
const memberLoadInstances = largeMemberLoadMarkers.children.filter((child) => child instanceof THREE.InstancedMesh);
assert.equal(memberLoadInstances.length, 2, "verdeelde lasten delen één staaf- en één pijlpuntbatch");
assert.equal(largeMemberLoadMarkers.children.filter((child) => child instanceof THREE.LineSegments).length, 1,
  "alle hulplijnen van verdeelde lasten delen één tekenaanroep");
assert.ok(memberLoadInstances.every((child) => child.userData.type === "memberLoad"),
  "gebatchte lastpijlen blijven als staafbelasting selecteerbaar");
assert.ok(memberLoadInstances.every((child) => child.userData.instanceIds.includes(1)
  && child.userData.instanceIds.includes(240)), "iedere last-id blijft in de selectiebatch aanwezig");
const mediumMemberLoadMarkers = new THREE.Group();
addFrame3DConditionMarkers(mediumMemberLoadMarkers, {
  ...largeMemberLoadModel, memberLoads: largeMemberLoadModel.memberLoads.slice(0, 4),
}, { supports: false, loads: true });
assert.equal(mediumMemberLoadMarkers.children.filter((child) => child.visible).length, 3,
  "vier lijnlasten delen al twee zichtbare pijlbatches en één hulplijnbatch");
assert.equal(mediumMemberLoadMarkers.children.filter((child) =>
  child instanceof THREE.Line && !child.visible && child.userData.type === "memberLoad").length, 4,
"de vier samengevoegde hulplijnen behouden afzonderlijke selectiedoelen");
assert.ok(mediumMemberLoadMarkers.children.filter((child) => child instanceof THREE.InstancedMesh)
  .every((child) => child.userData.instanceIds.includes(4)),
"ook de vierde last blijft apart selecteerbaar");
const snapCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
snapCamera.position.set(0, 0, 80);
snapCamera.lookAt(0, 0, 0);
snapCamera.updateProjectionMatrix();
snapCamera.updateMatrixWorld();
const snapNodes = Array.from({ length: 20_301 }, (_, index) => ({
  id: index + 1,
  x: (index % 201) - 100,
  y: Math.floor(index / 201) - 50,
  z: 0,
}));
const snapIndex = buildFrame3DNodeSnapScreenIndex(snapNodes, snapCamera, 1000, 1000);
const centerSnap = findFrame3DNodeScreenSnap(snapIndex, 500, 500);
assert.equal(centerSnap?.point.id, 10_151, "schermindex vindt de middelste knoop van 20.301 knopen");
assert.ok((centerSnap?.candidateCount ?? Number.POSITIVE_INFINITY) < 250,
  "knoopsnap bekijkt alleen lokale schermcellen en niet het hele grote model");
const withoutArcControl = findFrame3DNodeScreenSnap(snapIndex, 500, 500, 14, 10_151);
assert.notEqual(withoutArcControl?.point.id, 10_151,
  "het stuurpunt van een onafgemaakte boog mag zijn eindpunt niet op zichzelf vastzetten");
const onlyArcControl = buildFrame3DNodeSnapScreenIndex([snapNodes[10_150]], snapCamera, 1000, 1000);
assert.equal(findFrame3DNodeScreenSnap(onlyArcControl, 500, 500, 14, 10_151), null,
  "zonder andere knopen kan het boogeindpunt weer op raster of werkvlak vallen");
const demoGrid = frame3DGridLayout([
  { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 36, y: 0, z: 0 },
], 0.5);
assert.equal(demoGrid.visibleSpacingM, 0.5, "zichtbaar raster en knoopsnap gebruiken dezelfde stap");
assert.ok(demoGrid.centerX - demoGrid.sizeM / 2 <= 0
  && demoGrid.centerX + demoGrid.sizeM / 2 >= 36,
"het zichtbare raster loopt door over het hele 36 meter brede model");
const largeGrid = frame3DGridLayout([
  { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 1000, y: 1000, z: 0 },
], 0.5);
assert.ok(largeGrid.divisions <= 200, "een groot model maakt niet duizenden rasterlijnen");
assert.ok(largeGrid.centerX - largeGrid.sizeM / 2 <= 0
  && largeGrid.centerX + largeGrid.sizeM / 2 >= 1000,
"ook het begrensde raster blijft over het grote model liggen");
const hidden = new THREE.Group();
addFrame3DConditionMarkers(hidden, withConditions, { supports: false, loads: false });
assert.equal(hidden.children.length, 0);
const thermalOnly = new THREE.Group();
addFrame3DConditionMarkers(thermalOnly, thermal, { supports: false, loads: true }, 2);
assert.ok(thermalOnly.children.some((child) => child.userData.kind === "thermal"), "temperatuurlast heeft een zichtbaar 3D-symbool");

for (const group of [
  supportOnly, rollerOnly, springOnly, imposedOnly, loadOnly, largeMarkers, largeMemberLoadMarkers, thermalOnly,
]) {
  for (const child of group.children) {
    child.geometry?.dispose();
    child.material?.dispose();
  }
}
console.log("3D-opleggingen, knoopbelastingen en zichtbare symbolen: geslaagd");

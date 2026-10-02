import assert from "node:assert/strict";
import * as THREE from "three";
import { buildOpenFem3DNodeSnapScreenIndex, findOpenFem3DNodeScreenSnap } from "./src/components/openFem3d/openFem3dNodeSnapIndex.ts";
import { openFem3DGridLayout } from "./src/components/openFem3d/openFem3dGrid.ts";
import {
  OPEN_FEM_3D_SUPPORT_PRESETS,
  addOpenFem3DNodalLoad,
  addOpenFem3DThermalLoad,
  openFem3DRevoluteAxis,
  openFem3DSupportPresetOf,
  parseOpenFem3DModel,
  removeOpenFem3DNode,
  removeOpenFem3DNodalLoad,
  removeOpenFem3DSupport,
  removeOpenFem3DThermalLoad,
  setOpenFem3DSupport,
  setOpenFem3DBeamNodes,
  setOpenFem3DSupportPrescribed,
  setOpenFem3DSupportSprings,
  splitOpenFem3DBeam,
  updateOpenFem3DNodalLoad,
  updateOpenFem3DThermalLoad,
} from "./src/components/openFem3d/openFem3dModel.ts";
import { addOpenFem3DConditionMarkers } from "./src/components/openFem3d/openFem3dMarkers.ts";
import { buildOpenFem3DSolveRequest } from "./src/components/openFem3d/openFem3dSolver.ts";

const geometry = {
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 3 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }],
};
const oldModel = parseOpenFem3DModel(geometry);
assert.deepEqual(oldModel, { ...geometry, supports: [], loads: [] });

const pinned = setOpenFem3DSupport(oldModel, 1, OPEN_FEM_3D_SUPPORT_PRESETS.pinned);
assert.equal(pinned.supports.length, 1);
assert.deepEqual(pinned.supports[0], { nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.pinned });
assert.equal(oldModel.supports.length, 0, "updates must not mutate old state");
const fixed = setOpenFem3DSupport(pinned, 1, OPEN_FEM_3D_SUPPORT_PRESETS.fixed);
assert.equal(fixed.supports.length, 1, "one node has at most one support");
assert.deepEqual(fixed.supports[0], { nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.fixed });
assert.equal(removeOpenFem3DSupport(fixed, 1).supports.length, 0);
assert.throws(() => setOpenFem3DSupport(oldModel, 9, OPEN_FEM_3D_SUPPORT_PRESETS.fixed), /bestaat niet/);
const reconnectSource = {
  ...oldModel,
  nodes: [...oldModel.nodes, { id: 3, x: 4, y: 2, z: 3 }, { id: 4, x: 4, y: 0, z: 3 }],
};
const reconnected = setOpenFem3DBeamNodes(reconnectSource, 1, 1, 3);
assert.deepEqual([reconnected.beams[0].startNodeId, reconnected.beams[0].endNodeId], [1, 3]);
assert.deepEqual([reconnectSource.beams[0].startNodeId, reconnectSource.beams[0].endNodeId], [1, 2],
  "herverbinden muteert het oude model niet");
assert.throws(() => setOpenFem3DBeamNodes(reconnectSource, 1, 1, 1), /niet-nulle lengte/);
assert.throws(() => setOpenFem3DBeamNodes(reconnectSource, 1, 2, 4), /niet-nulle lengte/,
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
const split = splitOpenFem3DBeam(splitSource, 1, 0.5);
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
assert.throws(() => splitOpenFem3DBeam(splitSource, 1, 0), /binnen/);
assert.throws(() => splitOpenFem3DBeam(splitSource, 1, 1), /binnen/);
const reusedNode = splitOpenFem3DBeam({
  ...splitSource,
  nodes: [...splitSource.nodes, { id: 9, x: 5, y: 0, z: 0 }],
}, 1, 0.5);
assert.equal(reusedNode.nodeId, 9, "een bestaande knoop op het knippunt wordt hergebruikt");
assert.equal(reusedNode.model.nodes.length, 3);
for (const axis of ["X", "Y", "Z"]) {
  const presetName = `revolute${axis}`;
  const preset = OPEN_FEM_3D_SUPPORT_PRESETS[presetName];
  assert.equal(openFem3DSupportPresetOf(preset), presetName);
  assert.equal(openFem3DRevoluteAxis(preset), axis.toLowerCase());
  assert.equal(preset.ux && preset.uy && preset.uz, true, `${presetName} is translatievast`);
  assert.equal([preset.rx, preset.ry, preset.rz].filter(Boolean).length, 2, `${presetName} laat precies één rotatie vrij`);
}
for (const axis of ["x", "y", "z"]) {
  const presetName = `${axis}Roller`;
  const preset = OPEN_FEM_3D_SUPPORT_PRESETS[presetName];
  assert.equal(openFem3DSupportPresetOf(preset), presetName);
  assert.equal([preset.ux, preset.uy, preset.uz].filter(Boolean).length, 1,
    `${presetName} blokkeert precies één translatie`);
  assert.equal(preset[`u${axis}`], true, `${presetName} blokkeert de globale ${axis.toUpperCase()}-translatie`);
  assert.equal([preset.rx, preset.ry, preset.rz].some(Boolean), false, `${presetName} laat alle rotaties vrij`);
}

const sprung = setOpenFem3DSupportSprings(pinned, 2, {
  kzKnPerM: 370,
  kryKnmPerRad: 125,
});
assert.deepEqual(sprung.supports.find((support) => support.nodeId === 2), {
  nodeId: 2, ux: false, uy: false, uz: false, rx: false, ry: false, rz: false,
  springs: { kzKnPerM: 370, kryKnmPerRad: 125 },
});
assert.throws(() => setOpenFem3DSupportSprings(pinned, 2, { kzKnPerM: 0 }), /positieve/);
const imposed = setOpenFem3DSupportPrescribed(pinned, 1, { uxM: 0.001, rzRad: -0.002 });
assert.equal(imposed.supports[0].ux, true);
assert.equal(imposed.supports[0].rz, true, "een opgelegde rotatie blokkeert de bijbehorende DOF");
assert.deepEqual(imposed.supports[0].prescribed, { uxM: 0.001, rzRad: -0.002 });
const imposedRequest = buildOpenFem3DSolveRequest({
  ...imposed,
  beams: [{ ...imposed.beams[0], profileName: "IPE200", material: "S235" }],
});
assert.equal(imposedRequest.supports[0].uxPrescribedM, 0.001);
assert.equal(imposedRequest.supports[0].rzPrescribedRad, -0.002);
assert.equal("prescribed" in imposedRequest.supports[0], false, "solvercontract gebruikt vlakke velden met eenheden");

const load = { fx: 4, fy: 0, fz: -10, mx: 0, my: 0, mz: 2 };
const loaded = addOpenFem3DNodalLoad(pinned, 2, load);
assert.deepEqual(loaded.loads, [{ id: 1, nodeId: 2, ...load }]);
assert.equal(pinned.loads.length, 0);
const changed = updateOpenFem3DNodalLoad(loaded, 1, { ...load, fx: -3, mz: 0 });
assert.equal(changed.loads[0].fx, -3);
assert.equal(changed.loads[0].nodeId, 2);
assert.equal(removeOpenFem3DNodalLoad(changed, 1).loads.length, 0);
assert.throws(() => addOpenFem3DNodalLoad(oldModel, 9, load), /bestaat niet/);
assert.throws(() => addOpenFem3DNodalLoad(oldModel, 1,
  { fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }), /niet-nulwaarde/);

const withConditions = {
  ...geometry,
  supports: [
    { nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.fixed },
    { nodeId: 2, ...OPEN_FEM_3D_SUPPORT_PRESETS.revoluteX },
  ],
  loads: [
    { id: 1, nodeId: 1, ...load },
    { id: 2, nodeId: 2, fx: 0, fy: 7, fz: 0, mx: 0, my: 0, mz: 0 },
  ],
};
assert.deepEqual(parseOpenFem3DModel(withConditions), withConditions);
const springModel = parseOpenFem3DModel({
  ...withConditions,
  supports: [withConditions.supports[0], {
    nodeId: 2, ux: false, uy: true, uz: false, rx: false, ry: false, rz: false,
    springs: { kzKnPerM: 370, kryKnmPerRad: 125 },
  }],
});
const solverSpring = buildOpenFem3DSolveRequest({
  ...springModel,
  beams: [{ ...springModel.beams[0], profileName: "IPE200", material: "S235" }],
});
assert.equal(solverSpring.supports[1].kzKnPerM, 370);
assert.equal(solverSpring.supports[1].kryKnmPerRad, 125);
assert.equal("springs" in solverSpring.supports[1], false, "solvercontract is vlak en heeft expliciete eenheden");
const thermal = addOpenFem3DThermalLoad(springModel, 1, {
  deltaTUniformK: 25, deltaTGradientYK: 4, deltaTGradientZK: -6,
}, 2);
assert.deepEqual(thermal.thermalLoads, [{
  id: 1, beamId: 1, caseId: 2,
  deltaTUniformK: 25, deltaTGradientYK: 4, deltaTGradientZK: -6,
}]);
const changedThermal = updateOpenFem3DThermalLoad(thermal, 1, {
  deltaTUniformK: 30, deltaTGradientYK: 0, deltaTGradientZK: 0,
});
assert.equal(changedThermal.thermalLoads[0].deltaTUniformK, 30);
assert.equal(removeOpenFem3DThermalLoad(changedThermal, 1).thermalLoads.length, 0);
const parsedThermal = parseOpenFem3DModel(thermal);
const thermalRequest = buildOpenFem3DSolveRequest({
  ...parsedThermal,
  beams: [{ ...parsedThermal.beams[0], profileName: "IPE200", material: "S235" }],
}, "linear", 2);
assert.equal(thermalRequest.thermalLoads[0].deltaTUniformK, 25);
assert.equal(thermalRequest.thermalLoads[0].deltaTGradientZK, -6);
assert.equal(thermalRequest.materials[0].alphaPerK, 12e-6);
const concreteThermalRequest = buildOpenFem3DSolveRequest({
  ...parsedThermal,
  beams: [{ ...parsedThermal.beams[0], profileName: "300x600", material: "C30/37" }],
}, "linear", 2);
assert.equal(concreteThermalRequest.materials[0].alphaPerK, 10e-6);
assert.throws(() => addOpenFem3DThermalLoad(springModel, 1, {
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
  assert.throws(() => parseOpenFem3DModel(malformed));
}

const afterDelete = removeOpenFem3DNode(withConditions, 1);
assert.deepEqual(afterDelete.nodes.map((node) => node.id), [2]);
assert.equal(afterDelete.beams.length, 0);
assert.deepEqual(afterDelete.supports.map((support) => support.nodeId), [2]);
assert.deepEqual(afterDelete.loads.map((item) => item.nodeId), [2]);

const supportOnly = new THREE.Group();
addOpenFem3DConditionMarkers(supportOnly, withConditions, { supports: true, loads: false });
assert.ok(supportOnly.children.length > 0);
assert.ok(supportOnly.children.every((child) => child instanceof THREE.Mesh && child.userData.type === "node"));
assert.ok(supportOnly.children.some((child) => child.geometry.type === "TorusGeometry"),
  "revolute support has a visible rotation ring");
const rollerOnly = new THREE.Group();
const rollerModel = {
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 },
    { id: 2, x: 2, y: 0, z: 0 },
    { id: 3, x: 4, y: 0, z: 0 },
  ],
  beams: [], loads: [],
  supports: [
    { nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.xRoller },
    { nodeId: 2, ...OPEN_FEM_3D_SUPPORT_PRESETS.yRoller },
    { nodeId: 3, ...OPEN_FEM_3D_SUPPORT_PRESETS.zRoller },
  ],
};
addOpenFem3DConditionMarkers(rollerOnly, rollerModel, { supports: true, loads: false });
for (const [nodeId, expectedAxis] of [[1, new THREE.Vector3(1, 0, 0)], [2, new THREE.Vector3(0, 1, 0)], [3, new THREE.Vector3(0, 0, 1)]]) {
  const cone = rollerOnly.children.find((child) => child.userData.id === nodeId && child.geometry?.type === "ConeGeometry");
  assert.ok(cone, `rol ${nodeId} heeft een zichtbaar 3D-kegelsymbool`);
  const renderedAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(cone.quaternion);
  assert.ok(renderedAxis.distanceTo(expectedAxis) < 1e-10, `rol ${nodeId} is op de juiste globale as gericht`);
}
const springOnly = new THREE.Group();
addOpenFem3DConditionMarkers(springOnly, springModel, { supports: true, loads: false });
assert.ok(springOnly.children.some((child) => child instanceof THREE.Mesh && child.geometry.type === "TubeGeometry"),
  "translatieveer heeft een ronde 3D-spoel");
assert.ok(springOnly.children.some((child) => child.geometry?.type === "TorusGeometry"), "rotatieve veer heeft een ronde boog");
const imposedOnly = new THREE.Group();
addOpenFem3DConditionMarkers(imposedOnly, imposed, { supports: true, loads: false });
assert.ok(imposedOnly.children.some((child) => child.material?.color?.getHex() === 0x0891b2),
  "opgelegde verplaatsing heeft een zichtbaar cyaan symbool");
const loadOnly = new THREE.Group();
addOpenFem3DConditionMarkers(loadOnly, withConditions, { supports: false, loads: true });
assert.ok(loadOnly.children.length > 0);
const largeMarkerModel = {
  nodes: Array.from({ length: 120 }, (_, index) => ({ id: index + 1, x: index % 20, y: Math.floor(index / 20), z: 0 })),
  beams: [],
  supports: Array.from({ length: 120 }, (_, index) => ({ nodeId: index + 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.fixed })),
  loads: Array.from({ length: 120 }, (_, index) => ({
    id: index + 1, nodeId: index + 1, fx: 2, fy: 0, fz: -5, mx: 0, my: 0, mz: 0,
  })),
};
const largeMarkers = new THREE.Group();
addOpenFem3DConditionMarkers(largeMarkers, largeMarkerModel, { supports: true, loads: true });
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
addOpenFem3DConditionMarkers(largeMemberLoadMarkers, largeMemberLoadModel, { supports: false, loads: true });
const memberLoadInstances = largeMemberLoadMarkers.children.filter((child) => child instanceof THREE.InstancedMesh);
assert.equal(memberLoadInstances.length, 2, "verdeelde lasten delen één staaf- en één pijlpuntbatch");
assert.equal(largeMemberLoadMarkers.children.filter((child) => child instanceof THREE.LineSegments).length, 1,
  "alle hulplijnen van verdeelde lasten delen één tekenaanroep");
// De gedeelde staartlijn kent per lijnstuk zijn last, zodat selecteren de
// staartlijn van één last meekleurt (#81): lijnstuk i loopt van punt 2i naar
// 2i + 1, met een kleur per punt.
const staartlijn = largeMemberLoadMarkers.children.find((child) => child instanceof THREE.LineSegments);
assert.equal(staartlijn.userData.type, "memberLoad", "de gedeelde staartlijn hoort bij de lijnlasten (selectiekleur)");
assert.equal(staartlijn.userData.pickable, false, "… maar is geen raycast-doel; elke last houdt zijn eigen kieslijn");
const staartPunten = staartlijn.geometry.getAttribute("position");
const staartKleuren = staartlijn.geometry.getAttribute("color");
assert.equal(staartPunten.count, 2 * staartlijn.userData.segmentIds.length, "twee punten per lijnstuk");
assert.equal(staartKleuren.count, staartPunten.count, "een kleur per punt");
assert.equal(staartlijn.userData.segmentBaseColors.length, staartlijn.userData.segmentIds.length, "een basiskleur per lijnstuk");
const kleurVan = new THREE.Color();
assert.ok(Array.from({ length: staartKleuren.count }, (_, index) => kleurVan.fromBufferAttribute(staartKleuren, index).getHex())
  .every((hex) => hex === 0xef4444) && staartlijn.userData.segmentBaseColors.every((hex) => hex === 0xef4444),
"ongeselecteerd is de staartlijn in de lastkleur");
// Elk lijnstuk ligt op de (onzichtbare) kieslijn van zijn eigen last: negen
// pijlen over 12 m, dus acht lijnstukken per last, in volgorde.
const kieslijnen = new Map(largeMemberLoadMarkers.children
  .filter((child) => child instanceof THREE.Line && !child.visible).map((child) => [child.userData.id, child]));
assert.equal(kieslijnen.size, 240, "elke lijnlast een eigen kieslijn");
const volgende = new Map();
const verkeerd = [];
staartlijn.userData.segmentIds.forEach((id, segment) => {
  const k = volgende.get(id) ?? 0;
  volgende.set(id, k + 1);
  const kieslijn = kieslijnen.get(id)?.geometry.getAttribute("position");
  const zelfde = (punt, index) => kieslijn && index < kieslijn.count
    && Math.hypot(staartPunten.getX(punt) - kieslijn.getX(index), staartPunten.getY(punt) - kieslijn.getY(index),
      staartPunten.getZ(punt) - kieslijn.getZ(index)) < 1e-6;
  if (!zelfde(2 * segment, k) || !zelfde(2 * segment + 1, k + 1)) verkeerd.push(`lijnstuk ${segment} (last ${id})`);
});
assert.deepEqual(verkeerd, [], "elk lijnstuk ligt op de staartlijn van de last die erbij staat");
assert.ok([...volgende.values()].every((aantal) => aantal === 8) && volgende.size === 240, "acht lijnstukken per last");
assert.ok(memberLoadInstances.every((child) => child.userData.type === "memberLoad"),
  "gebatchte lastpijlen blijven als staafbelasting selecteerbaar");
assert.ok(memberLoadInstances.every((child) => child.userData.instanceIds.includes(1)
  && child.userData.instanceIds.includes(240)), "iedere last-id blijft in de selectiebatch aanwezig");
const mediumMemberLoadMarkers = new THREE.Group();
addOpenFem3DConditionMarkers(mediumMemberLoadMarkers, {
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
const snapIndex = buildOpenFem3DNodeSnapScreenIndex(snapNodes, snapCamera, 1000, 1000);
const centerSnap = findOpenFem3DNodeScreenSnap(snapIndex, 500, 500);
assert.equal(centerSnap?.point.id, 10_151, "schermindex vindt de middelste knoop van 20.301 knopen");
assert.ok((centerSnap?.candidateCount ?? Number.POSITIVE_INFINITY) < 250,
  "knoopsnap bekijkt alleen lokale schermcellen en niet het hele grote model");
const withoutArcControl = findOpenFem3DNodeScreenSnap(snapIndex, 500, 500, 14, 10_151);
assert.notEqual(withoutArcControl?.point.id, 10_151,
  "het stuurpunt van een onafgemaakte boog mag zijn eindpunt niet op zichzelf vastzetten");
const onlyArcControl = buildOpenFem3DNodeSnapScreenIndex([snapNodes[10_150]], snapCamera, 1000, 1000);
assert.equal(findOpenFem3DNodeScreenSnap(onlyArcControl, 500, 500, 14, 10_151), null,
  "zonder andere knopen kan het boogeindpunt weer op raster of werkvlak vallen");
const demoGrid = openFem3DGridLayout([
  { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 36, y: 0, z: 0 },
], 0.5);
assert.equal(demoGrid.visibleSpacingM, 0.5, "zichtbaar raster en knoopsnap gebruiken dezelfde stap");
assert.ok(demoGrid.centerX - demoGrid.sizeM / 2 <= 0
  && demoGrid.centerX + demoGrid.sizeM / 2 >= 36,
"het zichtbare raster loopt door over het hele 36 meter brede model");
const largeGrid = openFem3DGridLayout([
  { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 1000, y: 1000, z: 0 },
], 0.5);
assert.ok(largeGrid.divisions <= 200, "een groot model maakt niet duizenden rasterlijnen");
assert.ok(largeGrid.centerX - largeGrid.sizeM / 2 <= 0
  && largeGrid.centerX + largeGrid.sizeM / 2 >= 1000,
"ook het begrensde raster blijft over het grote model liggen");
const hidden = new THREE.Group();
addOpenFem3DConditionMarkers(hidden, withConditions, { supports: false, loads: false });
assert.equal(hidden.children.length, 0);
const thermalOnly = new THREE.Group();
addOpenFem3DConditionMarkers(thermalOnly, thermal, { supports: false, loads: true }, 2);
assert.ok(thermalOnly.children.some((child) => child.userData.kind === "thermal"), "temperatuurlast heeft een zichtbaar 3D-symbool");

for (const group of [
  supportOnly, rollerOnly, springOnly, imposedOnly, loadOnly, largeMarkers, largeMemberLoadMarkers, thermalOnly,
]) {
  for (const child of group.children) {
    child.geometry?.dispose();
    child.material?.dispose();
  }
}
// Een lintknop met meerdere geselecteerde knopen (bijv. "Alle selecteren" bij
// Opleggingen): dezelfde voorwaarde op elke bestaande knoop, één nieuw model.
{
  const { applyOpenFem3DNodeConditionToNodes } = await import("./src/components/openFem3d/openFem3dNodeTools.ts");
  const meerdere = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }, { id: 3, x: 8, y: 0, z: 0 }],
    beams: [],
    supports: [{ nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.fixed }, { nodeId: 2, ...OPEN_FEM_3D_SUPPORT_PRESETS.xRoller }],
  });
  const na = applyOpenFem3DNodeConditionToNodes(meerdere, [1, 2, 99], { kind: "support", preset: "pinned" }, 0);
  assert.equal(na.supports.length, 2, "een onbekende knoop wordt overgeslagen");
  assert.ok(na.supports.every((support) => support.ux && support.uy && support.uz && !support.rx && !support.ry && !support.rz),
    "alle geselecteerde opleggingen zijn scharnieren");
  assert.equal(applyOpenFem3DNodeConditionToNodes(meerdere, [], { kind: "support", preset: "pinned" }, 0), meerdere,
    "zonder knopen hetzelfde model (geen lege stap ongedaan maken)");
}
console.log("3D-opleggingen, knoopbelastingen en zichtbare symbolen: geslaagd");

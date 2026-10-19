import assert from "node:assert/strict";
import { frame3DVolumeMemberDiagrams } from "./src/components/frame3d/frame3dVolumeDiagrams.ts";

const member = (memberId, vzStartKn) => ({
  memberId, lengthM: 1, nStartKn: 0, nEndKn: 0,
  vyStartKn: 0, vyEndKn: 0, vzStartKn, vzEndKn: 0,
  torsionStartKnm: 0, torsionEndKnm: 0,
  myStartKnm: 0, myEndKnm: 0, mzStartKnm: 0, mzEndKnm: 0,
});
const line = (beamId, start, end) => ({ load: {
  id: beamId, beamId, qyStart: 0, qyEnd: 0,
  qzStart: start, qzEnd: end, startPositionM: 0, endPositionM: 1,
}, factor: 1 });
const result = frame3DVolumeMemberDiagrams([
  member(1, 0.327), member(2, 0),
], [line(1, -1, -1), line(2, -0.37, 0.63)], []);
const moment = result.momentY.find(curve => curve.memberId === 1);
const stationary = moment.points.find(point => Math.abs(point.t - 0.327) < 1e-10);
assert.ok(stationary, "the exact moment extremum falls between 5% display stations");
assert.ok(Math.abs(stationary.value - 0.327 ** 2 / 2) < 1e-10);
assert.ok(Math.abs(moment.maxValue - stationary.value) < 1e-10);
const shear = result.shearZ.find(curve => curve.memberId === 2);
const zeroIntensity = shear.points.find(point => Math.abs(point.t - 0.37) < 1e-10);
assert.ok(zeroIntensity, "the exact shear extremum occurs where the line intensity changes sign");
assert.ok(Math.abs(zeroIntensity.value + 0.37 ** 2 / 2) < 1e-10);
assert.ok(Math.abs(shear.minValue - zeroIntensity.value) < 1e-10);
console.log("Mixed 3D member diagrams: exact off-grid moment and shear extrema passed.");

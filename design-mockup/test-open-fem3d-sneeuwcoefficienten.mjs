import assert from "node:assert/strict";
import { snowRoofPressure, snowShapeCoefficients } from "./src/lib/snow/snowEurocode.ts";

assert.deepEqual([0, 15, 30, 45, 60, 90].map((angle) => snowShapeCoefficients(angle).mu1),
  [0.8, 0.8, 0.8, 0.4, 0, 0]);
for (const [angle, expected] of [[0, 0.8], [15, 1.2], [30, 1.6], [45, 1.6]]) {
  assert.ok(Math.abs(snowShapeCoefficients(angle).mu3 - expected) < 1e-12);
}
assert.equal(snowShapeCoefficients(60).mu3, null);
assert.ok(Math.abs(snowRoofPressure(0.8, 0.7, 1, 1) - 0.56) < 1e-12);
assert.throws(() => snowShapeCoefficients(-1), /0° en 90°/);
assert.throws(() => snowRoofPressure(0.8, -0.7, 1, 1), /niet-negatief/);
console.log("3D-sneeuwcoëfficiënten: controles geslaagd");

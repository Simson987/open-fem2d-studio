import assert from "node:assert/strict";
import { runLargeFrameCase } from "./accept-large-frame-second-order-load-app-route.mjs";

const cases = [
  ["compressionWithLateral", -5_000, -10],
  ["compressionOnly", -5_000, 0],
  ["lateralOnly", 0, -10],
  ["tensionWithLateral", 5_000, -10],
  ["tensionOnly", 5_000, 0],
];
const responses = new Map();
for (const [name, axial, lateral] of cases) {
  const result = await runLargeFrameCase(axial, lateral);
  assert.equal(result.backend, "frontalWave");
  assert.ok(result.residual < 1e-8);
  assert.ok(result.momentImbalanceKnm <= result.momentToleranceKnm);
  responses.set(name, result.relativeUzMm);
  console.log(`${name}: relative uz=${result.relativeUzMm.toFixed(6)} mm, `
    + `residual=${result.residual.toExponential(3)}, `
    + `moment=${result.momentImbalanceKnm.toExponential(3)} kNm, `
    + `${result.durationSeconds.toFixed(2)} s`);
}

// Subtract the transverse movement caused by the axial load alone. The one
// Hex8 at the root breaks section symmetry, so raw tip deflections cannot be
// compared directly between compression and tension.
const compression = Math.abs(responses.get("compressionWithLateral")
  - responses.get("compressionOnly"));
const zeroAxial = Math.abs(responses.get("lateralOnly"));
const tension = Math.abs(responses.get("tensionWithLateral")
  - responses.get("tensionOnly"));
assert.ok(compression > zeroAxial + 0.0002,
  `compression ${compression} mm must amplify lateral response beyond ${zeroAxial} mm`);
assert.ok(zeroAxial > tension + 0.0002,
  `tension ${tension} mm must stiffen lateral response below ${zeroAxial} mm`);
assert.ok(Math.abs(responses.get("compressionOnly")
  + responses.get("tensionOnly")) < 0.0001,
  "axial-only transverse response must be nearly antisymmetric in the elastic range");
console.log(`5,104-frame + Hex8 second-order series: lateral increment `
  + `compression ${compression.toFixed(5)} mm > zero ${zeroAxial.toFixed(5)} mm `
  + `> tension ${tension.toFixed(5)} mm; five frontalWave app-route solves passed.`);

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { parseOpenFem3DModel } from "../src/components/openFem3d/openFem3dModel.ts";

// A regular 60 × 40 floor grid stresses the project-open path without
// involving solver work or GPU-dependent timings.
const nx = 60;
const ny = 40;
const nodes = Array.from({ length: nx * ny }, (_, index) => ({
  id: index + 1,
  x: index % nx,
  y: Math.floor(index / nx),
  z: 0,
}));
const beams = [];
for (let y = 0; y < ny; y += 1) {
  for (let x = 0; x < nx; x += 1) {
    const startNodeId = y * nx + x + 1;
    if (x + 1 < nx) beams.push({ id: beams.length + 1, startNodeId, endNodeId: startNodeId + 1 });
    if (y + 1 < ny) beams.push({ id: beams.length + 1, startNodeId, endNodeId: startNodeId + nx });
  }
}
const start = performance.now();
const parsed = parseOpenFem3DModel({ nodes, beams });
const elapsedMs = performance.now() - start;
assert.equal(parsed.nodes.length, 2400);
assert.equal(parsed.beams.length, 4700);
assert.deepEqual(parsed.beams.at(-1)?.endNodeId, 2400);
console.log(`3D-project openen: ${parsed.nodes.length} knopen, ${parsed.beams.length} staven, ${elapsedMs.toFixed(1)} ms`);

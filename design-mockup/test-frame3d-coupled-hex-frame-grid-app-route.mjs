import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const fixture = (name) => deserializeProject(readFileSync(new URL(
  `../docs/verificatie/3d-volume/${name}.ifcfem2d`, import.meta.url), "utf8"));
const small = fixture("hex8-raamwerk-koppeling-klein");
const large = fixture("hex8-raamwerk-koppeling-groot");
assert.deepEqual([small.model3d.nodes.length, small.model3d.volumes.length, small.model3d.beams.length],
  [36, 4, 42]);
assert.deepEqual([large.model3d.nodes.length, large.model3d.volumes.length, large.model3d.beams.length],
  [1183, 432, 1443]);
assert.ok(small.model3d.beams.every(beam => !beam.axialOnly));
assert.ok(large.model3d.beams.every(beam => !beam.axialOnly));

const binary = fileURLToPath(new URL("../src-tauri/target/release/toetsbrug", import.meta.url));
const originalFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "mixed3d");
  requests.push(body.inputs.input);
  const answer = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", code => resolve({ code,
      output: Buffer.concat(stdout).toString(), error: Buffer.concat(stderr).toString() }));
    child.stdin.end(JSON.stringify(body));
  });
  if (answer.code !== 0) throw new Error(answer.error || answer.output);
  return new Response(answer.output, { status: 200 });
};

const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);
function check(result, nodes, hexes, frames, roofLoads) {
  assert.equal(result.displacements.length, nodes);
  assert.equal(result.volume3D.elements.length, hexes);
  assert.equal(result.memberForces.length, frames);
  assert.ok(result.volume3D.relativeResidual < 1e-8,
    `relative residual ${result.volume3D.relativeResidual}`);
  assert.ok(result.forceBalance.ok, JSON.stringify(result.forceBalance));
  assert.ok(result.displacements.every(node =>
    [node.ux, node.uy, node.uz, node.rx, node.ry, node.rz].every(Number.isFinite)));
  assert.ok(result.volume3D.elements.some(element => element.vonMisesMpa > 0));
  assert.ok(result.memberForces.every(member => [member.nStartKn, member.nEndKn,
    member.myStartKnm, member.myEndKnm, member.mzStartKnm, member.mzEndKnm].every(Number.isFinite)));
  assert.ok(Math.abs(sum(result.reactions, "fx") + 0.1 * roofLoads) < 1e-5);
  assert.ok(Math.abs(sum(result.reactions, "fz") - roofLoads) < 1e-5);
}

try {
  const direct = await solveFrame3D({ ...small.model3d, volumeBackend: "sparseDirect" }, 1,
    "linear", "openaec-native-fem");
  check(direct, 36, 4, 42, 9);
  assert.equal(direct.volume3D.backendUsed, "sparseDirect");
  for (const backend of ["frontalWave", "matrixFreePcg"]) {
    const candidate = await solveFrame3D({ ...small.model3d, volumeBackend: backend }, 1,
      "linear", "openaec-native-fem");
    check(candidate, 36, 4, 42, 9);
    assert.equal(candidate.volume3D.backendUsed, backend);
    for (let index = 0; index < 36; index++) {
      const a = direct.displacements[index], b = candidate.displacements[index];
      for (const component of ["ux", "uy", "uz", "rx", "ry", "rz"])
        assert.ok(Math.abs(a[component] - b[component]) < 1e-7,
          `${backend} node ${a.nodeId} ${component}: ${a[component]} vs ${b[component]}`);
    }
  }
  const solved = await solveFrame3D(large.model3d, 1, "linear", "openaec-native-fem");
  check(solved, 1183, 432, 1443, 169);
  assert.equal(solved.volume3D.backendUsed, "matrixFreePcg");
  assert.ok(solved.volume3D.linearIterations > 0);
  assert.deepEqual(requests.map(request => [request.hexes.length, request.frames.length]),
    [[4, 42], [4, 42], [4, 42], [432, 1443]]);
  console.log(`Shared Hex8/frame grid: 432 volumes, 1,443 full frames, `
    + `${solved.volume3D.linearIterations} PCG iterations, `
    + `residual ${solved.volume3D.relativeResidual.toExponential(2)}`);
} finally {
  globalThis.fetch = originalFetch;
}

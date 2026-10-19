import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { solveNativeMixed3D } from "./src/lib/nativeFemClient.ts";

const binary = fileURLToPath(new URL("../src-tauri/target/debug/native-mixed3d", import.meta.url));
const invoke = input => new Promise((resolve, reject) => {
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [], errors = [];
  child.stdout.on("data", chunk => output.push(chunk));
  child.stderr.on("data", chunk => errors.push(chunk));
  child.on("error", reject);
  child.on("close", code => {
    const raw = Buffer.concat(output).toString();
    if (code === 0) resolve(JSON.parse(raw));
    else reject(new Error(raw || Buffer.concat(errors).toString()));
  });
  child.stdin.end(JSON.stringify(input));
});

const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const request = JSON.parse(options.body);
  assert.equal(request.opdracht, "solve_native_fem");
  assert.equal(request.inputs.kind, "mixed3d");
  calls++;
  const result = await invoke(request.inputs.input);
  return new Response(JSON.stringify({ kind: "mixed3d", result }), { status: 200 });
};

try {
  const input = {
    mesh: { nodes: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], tets: [[0, 1, 2, 3]] },
    solidMaterial: { eMpa: 1200, poisson: 0.2 },
    trusses: [{ nodes: [0, 1], eMpa: 2000, areaM2: 0.05 }],
    loadsKn: [[0, 0, 0], [10, 0, 0], [0, 0, 0], [0, 0, 0]],
    prescribedM: [[0, 0, 0], [null, 0, 0], [0, 0, 0], [0, 0, 0]],
  };
  const expected = 10 / (1000 * (1200 * 0.2 / (1.2 * 0.6) + 2 * 1200 / (2 * 1.2)) / 6 + 100000);
  for (const backend of ["dense", "sparseDirect", "sparsePcg", "matrixFreePcg", "frontalWave"]) {
    const result = await solveNativeMixed3D({ ...input, backend });
    assert.equal(result.backendUsed, backend);
    assert.ok(Math.abs(result.nodalDisplacementsM[1][0] - expected) < 1e-12);
    assert.ok(Math.abs(result.nodalReactionsKn[0][0] + 10) < 1e-8);
    assert.ok(Math.abs(result.trussAxialForceKn[0] - 100000 * expected) < 1e-8);
    assert.ok(result.relativeResidual < 1e-9);
  }
  const varied = await solveNativeMixed3D({
    ...input, tetMaterials: [{ eMpa: 2400, poisson: 0.2 }],
  });
  const doubledSolidStiffness = 2 * (10 / expected - 100000);
  assert.ok(Math.abs(varied.nodalDisplacementsM[1][0] - 10 / (doubledSolidStiffness + 100000)) < 1e-12);
  const combined = JSON.parse(readFileSync(new URL(
    "../src-tauri/crates/native-fem/examples/mixed3d-hex8-tet4-truss.json", import.meta.url,
  ), "utf8"));
  assert.equal(combined.kind, "mixed3d");
  const allTypes = await solveNativeMixed3D(combined.input);
  assert.equal(allTypes.solidElementStressMpa.length, 2);
  assert.equal(allTypes.hexGaussStressMpa.length, 1);
  assert.equal(allTypes.hexGaussStressMpa[0].length, 8);
  assert.equal(allTypes.trussAxialForceKn.length, 1);
  assert.ok(allTypes.relativeResidual < 1e-9);
  const fallbackModel = JSON.parse(readFileSync(new URL(
    "../src-tauri/crates/native-fem/examples/mixed3d-automatic-fallback.json", import.meta.url,
  ), "utf8"));
  assert.equal(fallbackModel.kind, "mixed3d");
  const recovered = await solveNativeMixed3D(fallbackModel.input);
  assert.equal(recovered.backendUsed, "frontalWave");
  for (let node = 0; node < allTypes.nodalDisplacementsM.length; node++) {
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(recovered.nodalDisplacementsM[node][axis] - allTypes.nodalDisplacementsM[node][axis]) < 1e-9);
    }
  }
  const distributed = JSON.parse(readFileSync(new URL(
    "../src-tauri/crates/native-fem/examples/mixed3d-distributed-loads.json", import.meta.url,
  ), "utf8"));
  assert.equal(distributed.kind, "mixed3d");
  const loaded = await solveNativeMixed3D(distributed.input);
  assert.equal(loaded.backendUsed, "matrixFreePcg");
  assert.equal(loaded.solidElementStressMpa.length, 2);
  assert.equal(loaded.hexGaussStressMpa.length, 1);
  assert.equal(loaded.trussAxialForceKn.length, 1);
  assert.ok(loaded.relativeResidual < 1e-8);
  const expectedNet = [0, 0, 0];
  for (const force of distributed.input.loadsKn) force.forEach((v, axis) => expectedNet[axis] += v);
  [8, -4, 2].forEach((v, axis) => expectedNet[axis] += v); // unit Hex8 volume
  [6, 3, -9].forEach((v, axis) => expectedNet[axis] += v / 6); // Tet4 volume 1/6
  [12, -8, 4].forEach((v, axis) => expectedNet[axis] += v); // unit Hex8 face
  [9, 6, -3].forEach((v, axis) => expectedNet[axis] += v / 2); // Tet4 face area 1/2
  for (let axis = 0; axis < 3; axis++) {
    const reaction = loaded.nodalReactionsKn.reduce((sum, node) => sum + node[axis], 0);
    assert.ok(Math.abs(reaction + expectedNet[axis]) < 1e-6);
  }
  const frameModel = JSON.parse(readFileSync(new URL(
    "../src-tauri/crates/native-fem/examples/mixed3d-tet4-frame-bending.json", import.meta.url,
  ), "utf8"));
  assert.equal(frameModel.kind, "mixed3d");
  const shearModulusMpa = 1200 / (2 * (1 + 0.2));
  const baseUzM = 10 / (1000 * shearModulusMpa / 6);
  const tipUzM = baseUzM + 10 / (3 * 1000 * 200000 * 1e-4);
  const tipThetaYRad = -10 / (2 * 1000 * 200000 * 1e-4);
  for (const backend of ["dense", "sparseDirect", "sparsePcg", "matrixFreePcg", "frontalWave", "automatic"]) {
    const frame = await solveNativeMixed3D({ ...frameModel.input, backend });
    assert.equal(frame.backendUsed, backend === "automatic" ? "matrixFreePcg" : backend);
    assert.ok(Math.abs(frame.nodalDisplacementsM[1][2] - baseUzM) < 1e-11);
    assert.ok(Math.abs(frame.nodalDisplacementsM[4][2] - tipUzM) < 1e-11);
    assert.ok(Math.abs(frame.nodalRotationsRad[4][1] - tipThetaYRad) < 1e-11);
    assert.ok(Math.abs(frame.nodalMomentReactionsKnm[1][1]) - 10 < 1e-7);
    assert.ok(Math.abs(frame.frameEndForcesLocal[0][0][2]) - 10 < 1e-7);
    assert.ok(frame.relativeResidual < 1e-9);
  }
  const membraneModel = JSON.parse(readFileSync(new URL(
    "../src-tauri/crates/native-fem/examples/mixed3d-tet4-membrane-coupling-v1.json", import.meta.url,
  ), "utf8"));
  const eSolid = 1200, nuSolid = 0.2;
  const lambda = eSolid * nuSolid / ((1 + nuSolid) * (1 - 2 * nuSolid));
  const mu = eSolid / (2 * (1 + nuSolid));
  const tetK = 1000 * (lambda + 2 * mu) / 6;
  const membraneK = 1000 * 0.5 * 0.1 * 2000 / (1 - 0.25 ** 2);
  const expectedUx = 10 / (tetK + membraneK);
  const expectedSigma11 = 2000 * expectedUx / (1 - 0.25 ** 2);
  for (const backend of ["dense", "sparseDirect", "sparsePcg", "matrixFreePcg", "frontalWave", "automatic"]) {
    const membrane = await solveNativeMixed3D({ ...membraneModel.input, backend });
    assert.equal(membrane.backendUsed, backend === "automatic" ? "matrixFreePcg" : backend);
    assert.ok(Math.abs(membrane.nodalDisplacementsM[1][0] - expectedUx) < 1e-10);
    assert.ok(Math.abs(membrane.membraneStressMpa[0][0] - expectedSigma11) < 1e-7);
    assert.ok(Math.abs(membrane.membraneResultantsKnPerM[0][0] - 1000 * 0.1 * expectedSigma11) < 1e-5);
    assert.ok(membrane.relativeResidual < 1e-8);
  }
  assert.equal(calls, 21);
  console.log("Native 3D Tet4/Hex8/staaf/raamwerkroute slaagt met vijf expliciete backends, automatische keuze en een onafhankelijke buigreferentie.");
} finally {
  globalThis.fetch = originalFetch;
}

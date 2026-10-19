import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { solveNativeVolume3DGnl } from "./src/lib/nativeFemClient.ts";

const binary = fileURLToPath(new URL("../src-tauri/target/debug/native-volume3d-gnl", import.meta.url));
const fixture = JSON.parse(readFileSync(new URL("../src-tauri/crates/native-fem/examples/volume3d-gnl-affine-stretch.json", import.meta.url), "utf8"));

function structuredTetMesh(n) {
  const nodes = [];
  const tets = [];
  const index = (i, j, k) => (k * (n + 1) + j) * (n + 1) + i;
  for (let k = 0; k <= n; k++) {
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) nodes.push([i / n, j / n, k / n]);
    }
  }
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const [a, b, c, d, e, f, g, h] = [
          index(i, j, k), index(i + 1, j, k),
          index(i, j + 1, k), index(i + 1, j + 1, k),
          index(i, j, k + 1), index(i + 1, j, k + 1),
          index(i, j + 1, k + 1), index(i + 1, j + 1, k + 1),
        ];
        tets.push([a, b, d, h], [a, d, c, h], [a, c, g, h],
          [a, g, e, h], [a, e, f, h], [a, f, b, h]);
      }
    }
  }
  return { nodes, tets };
}

const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "volume3dGnl");
  calls++;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const output = [];
    child.stdout.on("data", chunk => output.push(chunk));
    child.on("error", reject);
    child.on("close", code => {
      const raw = Buffer.concat(output).toString();
      code === 0 ? resolve(JSON.parse(raw)) : reject(new Error(raw));
    });
    child.stdin.end(JSON.stringify(body.inputs.input));
  });
  return new Response(JSON.stringify({ kind: "volume3dGnl", result }), { status: 200 });
};

try {
  const result = await solveNativeVolume3DGnl(fixture.input);
  assert.equal(calls, 1);
  const stretch = 1.05;
  const e = fixture.input.eMpa;
  const nu = fixture.input.poisson;
  const greenXx = (stretch ** 2 - 1) / 2;
  const lambda = e * nu / ((1 + nu) * (1 - 2 * nu));
  const mu = e / (2 * (1 + nu));
  const nominalForce = stretch * (lambda + 2 * mu) * greenXx * 1000;
  const reaction = result.nodalReactionsKn
    .reduce((sum, value, index) => sum + (index % 3 === 2 ? value[0] : 0), 0);
  assert.ok(Math.abs(reaction - nominalForce) < 1e-4);
  assert.ok(Math.abs(result.nodalDisplacementsM[13][0] - 0.025) < 1e-10);
  assert.ok(result.elementGreenStrain.every(tensor => Math.abs(tensor[0][0] - greenXx) < 1e-10));
  assert.ok(result.elementFirstPiolaMpa.every(tensor => Math.abs(tensor[0][0] - nominalForce / 1000) < 1e-8));
  assert.ok(result.trueFreeResidualKn < 1e-5);
  assert.equal(result.linearBackendUsed, "dense");
  for (const linearBackend of ["sparseDirect", "frontalWave"]) {
    const alternate = await solveNativeVolume3DGnl({
      ...fixture.input,
      options: { ...fixture.input.options, linearBackend },
    });
    assert.equal(alternate.linearBackendUsed, linearBackend);
    assert.ok(Math.abs(alternate.nodalDisplacementsM[13][0] - result.nodalDisplacementsM[13][0]) < 1e-10);
    assert.ok(Math.abs(alternate.trueFreeResidualKn - result.trueFreeResidualKn) < 1e-5);
  }
  assert.equal(calls, 3);
  const heterogeneous = {
    ...fixture.input,
    poisson: 0,
    elementMaterials: fixture.input.mesh.tets.map((_, index) => ({
      eMpa: index % 2 === 0 ? 80_000 : 120_000,
      poisson: 0,
    })),
    targets: [{
      loadsKn: fixture.input.mesh.nodes.map(() => [0, 0, 0]),
      prescribedM: fixture.input.mesh.nodes.map(([x]) => [0.05 * x, 0, 0]),
    }],
  };
  const varied = await solveNativeVolume3DGnl(heterogeneous);
  assert.equal(calls, 4);
  heterogeneous.elementMaterials.forEach((material, index) => {
    const expected = material.eMpa * stretch * greenXx;
    assert.ok(Math.abs(varied.elementFirstPiolaMpa[index][0][0] - expected) < 1e-7);
    assert.ok(Math.abs(varied.elementEffectiveEMpa[index] - material.eMpa) < 1e-8);
  });
  const nonlinear = {
    ...heterogeneous,
    elementEnergyBeta: heterogeneous.elementMaterials.map((_, index) => index % 2 === 0 ? 60 : -30),
  };
  const nonlinearResult = await solveNativeVolume3DGnl(nonlinear);
  assert.equal(calls, 5);
  nonlinear.elementMaterials.forEach((material, index) => {
    const expected = material.eMpa * stretch * greenXx
      * (1 + nonlinear.elementEnergyBeta[index] * greenXx ** 2 / 2);
    assert.ok(Math.abs(nonlinearResult.elementFirstPiolaMpa[index][0][0] - expected) < 1e-7);
    assert.ok(Math.abs(nonlinearResult.elementEffectiveEMpa[index]
      - material.eMpa * (1 + nonlinear.elementEnergyBeta[index] * greenXx ** 2 / 2)) < 1e-8);
  });
  const distributed = await solveNativeVolume3DGnl({
    mesh: {
      nodes: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
      tets: [[0, 1, 2, 3]],
    },
    eMpa: 200_000,
    poisson: 0.3,
    targets: [{
      loadsKn: Array.from({ length: 4 }, () => [0, 0, 0]),
      prescribedM: Array.from({ length: 4 }, () => [0, 0, 0]),
      bodyForces: [{ element: 0, forceKnPerM3: [12, 0, 0] }],
      faceTractions: [{ element: 0, faceNodes: [1, 2, 3], tractionKnPerM2: [0, 6, 0] }],
    }],
  });
  assert.equal(calls, 6);
  assert.ok(Math.abs(distributed.nodalReactionsKn.reduce((sum, node) => sum + node[0], 0) + 2) < 1e-12);
  assert.ok(Math.abs(distributed.nodalReactionsKn.reduce((sum, node) => sum + node[1], 0) + 3 * Math.sqrt(3)) < 1e-12);

  const scaledMesh = structuredTetMesh(5);
  assert.equal(scaledMesh.nodes.length, 216);
  assert.equal(scaledMesh.tets.length, 750);
  const scaledStretch = 1.03;
  const scaledBeta = 24;
  const scaledGreenXx = (scaledStretch ** 2 - 1) / 2;
  const scaledNominalForceKn = 1000 * scaledStretch * 100 * scaledGreenXx
    * (1 + scaledBeta * scaledGreenXx ** 2 / 2);
  const scaledInput = {
    mesh: scaledMesh,
    eMpa: 100,
    poisson: 0,
    elementEnergyBeta: scaledMesh.tets.map(() => scaledBeta),
    targets: [{
      loadsKn: scaledMesh.nodes.map(() => [0, 0, 0]),
      prescribedM: scaledMesh.nodes.map(([x, y, z]) =>
        [x, y, z].some(value => value === 0 || value === 1)
          ? [(scaledStretch - 1) * x, 0, 0] : [null, null, null]),
    }],
  };
  for (const linearBackend of ["sparseDirect", "frontalWave"]) {
    const scaled = await solveNativeVolume3DGnl({
      ...scaledInput,
      options: { linearBackend },
    });
    assert.equal(scaled.linearBackendUsed, linearBackend);
    assert.equal(scaled.nodalDisplacementsM.length, 216);
    assert.equal(scaled.elementGreenStrain.length, 750);
    const interior = 2 + 2 * 6 + 2 * 36;
    assert.ok(Math.abs(scaled.nodalDisplacementsM[interior][0] - 0.4 * (scaledStretch - 1)) < 2e-9);
    assert.ok(Math.abs(scaled.nodalDisplacementsM[interior][1]) < 2e-9);
    assert.ok(Math.abs(scaled.nodalDisplacementsM[interior][2]) < 2e-9);
    const rightReaction = scaled.nodalReactionsKn.reduce((sum, reaction, node) =>
      sum + (scaledMesh.nodes[node][0] === 1 ? reaction[0] : 0), 0);
    assert.ok(Math.abs(rightReaction - scaledNominalForceKn) < 2e-4);
    assert.ok(scaled.trueFreeResidualKn < 2e-4);
  }
  assert.equal(calls, 8);
  await assert.rejects(
    () => solveNativeVolume3DGnl({ ...scaledInput, options: { linearBackend: "dense" } }),
    /experimental GNL Tet4 limit for Dense/,
  );
  assert.equal(calls, 9);
  const automatic = await solveNativeVolume3DGnl({
    ...fixture.input,
    options: { ...fixture.input.options, linearBackend: "automatic", maxFactorEntries: 1 },
  });
  assert.equal(calls, 10);
  assert.equal(automatic.linearBackendUsed, "frontalWave");
  assert.ok(automatic.frontalFallbacks > 0);
  assert.ok(Math.abs(automatic.nodalDisplacementsM[13][0] - result.nodalDisplacementsM[13][0]) < 1e-10);
  assert.ok(Math.abs(automatic.trueFreeResidualKn - result.trueFreeResidualKn) < 1e-5);
  const scaledAutomatic = await solveNativeVolume3DGnl({
    ...scaledInput,
    options: { linearBackend: "automatic", maxFactorEntries: 192 },
  });
  assert.equal(calls, 11);
  assert.equal(scaledAutomatic.linearBackendUsed, "frontalWave");
  assert.ok(scaledAutomatic.frontalFallbacks > 0);
  assert.equal(scaledAutomatic.elementGreenStrain.length, 750);
  assert.ok(Math.abs(scaledAutomatic.nodalDisplacementsM[2 + 2 * 6 + 2 * 36][0]
    - 0.4 * (scaledStretch - 1)) < 2e-9);
  assert.ok(scaledAutomatic.trueFreeResidualKn < 2e-4);
  const gmres = await solveNativeVolume3DGnl({
    ...fixture.input,
    options: { ...fixture.input.options, linearBackend: "sparseGmres" },
  });
  assert.equal(calls, 12);
  assert.equal(gmres.linearBackendUsed, "sparseGmres");
  assert.ok(Math.abs(gmres.nodalDisplacementsM[13][0] - result.nodalDisplacementsM[13][0]) < 1e-10);
  assert.ok(Math.abs(gmres.trueFreeResidualKn - result.trueFreeResidualKn) < 1e-5);
  console.log("Native GNL Tet4 affine patch, rekafhankelijk E, verdeelde lasten en automatische opslagherstelroute bij 192 vrije DOF slagen via app-transport.");
} finally {
  globalThis.fetch = originalFetch;
}

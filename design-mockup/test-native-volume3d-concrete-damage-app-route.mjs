import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { solveNativeVolume3DConcreteDamage } from "./src/lib/nativeFemClient.ts";

const binary = fileURLToPath(new URL("../src-tauri/target/debug/native-volume3d-concrete-damage", import.meta.url));
const fixture = JSON.parse(readFileSync(new URL("../src-tauri/crates/native-fem/examples/volume3d-concrete-damage-coupon.json", import.meta.url), "utf8"));
const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "volume3dConcreteDamage");
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
  return new Response(JSON.stringify({ kind: "volume3dConcreteDamage", result }), { status: 200 });
};

try {
  const result = await solveNativeVolume3DConcreteDamage(fixture.input);
  assert.equal(calls, 1);
  assert.ok(result.acceptedSteps.length >= 2);
  const { eMpa: e, tensileStrengthMpa: ft, fractureEnergyNPerM: gf, crackBandWidthM: h } = fixture.input;
  const onset = ft / e;
  const softening = 1e-6 * gf / (h * ft) - onset / 2;
  const peakStrain = onset + softening;
  const unloadedStrain = onset + softening / 2;
  const expectedReaction = (ft / Math.E) * unloadedStrain / peakStrain * h * h * 1000;
  const rightReaction = [1, 3, 5, 7].reduce((sum, node) => sum + result.nodalReactionsKn[node][0], 0);
  assert.ok(Math.abs(rightReaction - expectedReaction) < 1e-5);
  assert.ok(result.elementStates.every(state => Math.abs(state.maxEquivalentStrain - peakStrain) < 1e-10));
  const expectedDamage = 1 - (ft / Math.E) / (e * peakStrain);
  assert.ok(result.elementDamage.every(damage => Math.abs(damage - expectedDamage) < 1e-10));
  assert.ok(result.elementStressMpa.every(stress => Math.abs(stress[0] - expectedReaction / (h * h * 1000)) < 1e-8));
  assert.ok(result.trueFreeResidualKn < 1e-5);
  const distributed = await solveNativeVolume3DConcreteDamage({
    ...fixture.input,
    mesh: { nodes: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], tets: [[0, 1, 2, 3]] },
    targets: [{
      loadsKn: Array.from({ length: 4 }, () => [0, 0, 0]),
      prescribedM: Array.from({ length: 4 }, () => [0, 0, 0]),
      bodyForces: [{ element: 0, forceKnPerM3: [12, 0, 0] }],
      faceTractions: [{ element: 0, faceNodes: [1, 2, 3], tractionKnPerM2: [0, 6, 0] }],
    }],
  });
  assert.equal(calls, 2);
  assert.ok(Math.abs(distributed.nodalReactionsKn.reduce((sum, node) => sum + node[0], 0) + 2) < 1e-12);
  assert.ok(Math.abs(distributed.nodalReactionsKn.reduce((sum, node) => sum + node[1], 0) + 3 * Math.sqrt(3)) < 1e-12);
  const material = {
    eMpa: fixture.input.eMpa,
    poisson: fixture.input.poisson,
    tensileStrengthMpa: fixture.input.tensileStrengthMpa,
    fractureEnergyNPerM: fixture.input.fractureEnergyNPerM,
    crackBandWidthM: fixture.input.crackBandWidthM,
  };
  const perElement = await solveNativeVolume3DConcreteDamage({
    ...fixture.input,
    eMpa: fixture.input.eMpa * 0.75,
    elementMaterials: fixture.input.mesh.tets.map(() => ({ ...material })),
  });
  assert.equal(calls, 3);
  const elementRightReaction = [1, 3, 5, 7]
    .reduce((sum, node) => sum + perElement.nodalReactionsKn[node][0], 0);
  assert.ok(Math.abs(elementRightReaction - rightReaction) < 1e-5);
  perElement.elementDamage.forEach((damage, index) => {
    assert.ok(Math.abs(damage - result.elementDamage[index]) < 1e-10);
  });
  await assert.rejects(
    () => solveNativeVolume3DConcreteDamage({ ...fixture.input, elementMaterials: [material] }),
    /elementMaterials/,
  );
  assert.equal(calls, 4);
  const layeredNodes = [];
  const layeredTets = [];
  const index = (i, j, k) => (k * 2 + j) * 3 + i;
  for (let k = 0; k <= 1; k++) for (let j = 0; j <= 1; j++) for (let i = 0; i <= 2; i++) {
    layeredNodes.push([i / 2, j, k]);
  }
  for (let i = 0; i < 2; i++) {
    const [a, b, c, d, e0, f, g, h0] = [
      index(i, 0, 0), index(i + 1, 0, 0), index(i, 1, 0), index(i + 1, 1, 0),
      index(i, 0, 1), index(i + 1, 0, 1), index(i, 1, 1), index(i + 1, 1, 1),
    ];
    layeredTets.push([a, b, d, h0], [a, d, c, h0], [a, c, g, h0],
      [a, g, e0, h0], [a, e0, f, h0], [a, f, b, h0]);
  }
  const weak = { eMpa: 20_000, poisson: 0, tensileStrengthMpa: 2, fractureEnergyNPerM: 500, crackBandWidthM: 0.5 };
  const strong = { eMpa: 30_000, poisson: 0, tensileStrengthMpa: 10, fractureEnergyNPerM: 2_000, crackBandWidthM: 0.5 };
  const layerTarget = endU => ({
    loadsKn: layeredNodes.map(() => [0, 0, 0]),
    prescribedM: layeredNodes.map(([x]) => [x === 0 ? 0 : x === 1 ? endU : null, 0, 0]),
  });
  const beta = weak.fractureEnergyNPerM / (1e6 * weak.crackBandWidthM * weak.tensileStrengthMpa)
    - weak.tensileStrengthMpa / (2 * weak.eMpa);
  const weakStress = (strain, history) => {
    const maximum = Math.max(strain, history);
    const damage = maximum <= weak.tensileStrengthMpa / weak.eMpa ? 0
      : 1 - weak.tensileStrengthMpa * Math.exp(-(maximum - weak.tensileStrengthMpa / weak.eMpa) / beta)
        / (weak.eMpa * maximum);
    return { stress: (1 - damage) * weak.eMpa * strain, damage };
  };
  const scalarInterface = (endU, history) => {
    let low = 0, high = 0.001;
    for (let n = 0; n < 90; n++) {
      const mid = (low + high) / 2;
      const total = 0.5 * mid + 0.5 * weakStress(mid, history).stress / strong.eMpa;
      if (total < endU) low = mid; else high = mid;
    }
    return (low + high) / 2;
  };
  const peakWeakStrain = scalarInterface(1.75e-4, 0);
  const unloadedWeakStrain = scalarInterface(4e-5, peakWeakStrain);
  const expectedLayer = weakStress(unloadedWeakStrain, peakWeakStrain);
  const layered = await solveNativeVolume3DConcreteDamage({
    mesh: { nodes: layeredNodes, tets: layeredTets },
    eMpa: weak.eMpa, poisson: weak.poisson,
    tensileStrengthMpa: weak.tensileStrengthMpa,
    fractureEnergyNPerM: weak.fractureEnergyNPerM,
    crackBandWidthM: weak.crackBandWidthM,
    elementMaterials: layeredTets.map((_, i) => i < 6 ? weak : strong),
    targets: [layerTarget(1.75e-4), layerTarget(4e-5)],
  });
  assert.equal(calls, 5);
  assert.ok(expectedLayer.damage > 0);
  layeredNodes.forEach(([x], node) => {
    if (x === 0.5) {
      assert.ok(Math.abs(layered.nodalDisplacementsM[node][0] - 0.5 * unloadedWeakStrain) < 2e-10);
      assert.ok(Math.abs(layered.nodalReactionsKn[node][0]) < 1e-7);
    }
  });
  layered.elementStressMpa.forEach((stress, i) => {
    assert.ok(Math.abs(stress[0] - expectedLayer.stress) < 2e-6);
    assert.ok(Math.abs(layered.elementDamage[i] - (i < 6 ? expectedLayer.damage : 0)) < 2e-8);
    assert.ok(Math.abs(layered.elementStates[i].maxEquivalentStrain
      - (i < 6 ? peakWeakStrain : weakStress(peakWeakStrain, 0).stress / strong.eMpa)) < 2e-9);
  });
  const layeredLeft = layered.nodalReactionsKn.reduce((sum, r, i) => sum + (layeredNodes[i][0] === 0 ? r[0] : 0), 0);
  const layeredRight = layered.nodalReactionsKn.reduce((sum, r, i) => sum + (layeredNodes[i][0] === 1 ? r[0] : 0), 0);
  assert.ok(Math.abs(layeredLeft + 1000 * expectedLayer.stress) < 2e-5);
  assert.ok(Math.abs(layeredRight - 1000 * expectedLayer.stress) < 2e-5);
  assert.ok(layered.trueFreeResidualKn < 1e-7);
  const sparse = await solveNativeVolume3DConcreteDamage({
    ...fixture.input,
    options: { ...fixture.input.options, linearBackend: "sparseGmres" },
  });
  assert.equal(calls, 6);
  assert.equal(sparse.linearBackendUsed, "sparseGmres");
  assert.ok(Math.abs(sparse.trueFreeResidualKn - result.trueFreeResidualKn) < 1e-7);
  sparse.nodalDisplacementsM.forEach((node, index) => {
    node.forEach((value, axis) => {
      assert.ok(Math.abs(value - result.nodalDisplacementsM[index][axis]) < 1e-9);
    });
  });
  console.log("Native 3D-betontrekschadecoupon, vrij tweelagen-grensvlak en verdeelde Tet4-lasten slagen via app-transport.");
} finally {
  globalThis.fetch = originalFetch;
}

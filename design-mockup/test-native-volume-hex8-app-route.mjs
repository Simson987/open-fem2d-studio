import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { solveNativeVolumeHex8 } from "./src/lib/nativeFemClient.ts";

const binary = fileURLToPath(new URL("../src-tauri/target/debug/native-volume-hex8", import.meta.url));
const fixture = JSON.parse(readFileSync(new URL("../src-tauri/crates/native-fem/examples/volume-hex8-uniaxial.json", import.meta.url), "utf8"));
const invoke = input => new Promise((resolve, reject) => {
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [];
  child.stdout.on("data", chunk => output.push(chunk));
  child.on("error", reject);
  child.on("close", code => {
    const raw = Buffer.concat(output).toString();
    code === 0 ? resolve(JSON.parse(raw)) : reject(new Error(raw));
  });
  child.stdin.end(JSON.stringify(input));
});

const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "volumeHex8");
  calls++;
  const result = await invoke(body.inputs.input);
  return new Response(JSON.stringify({ kind: "volumeHex8", result }), { status: 200 });
};

try {
  const result = await solveNativeVolumeHex8(fixture);
  assert.equal(calls, 1);
  assert.equal(result.solverUsed, "sparse");
  assert.equal(result.threads, 1);
  for (let node = 0; node < fixture.nodes.length; node++) {
    const [x,y,z] = fixture.nodes[node];
    assert.ok(Math.abs(result.nodalDisplacementsM[node][0]-0.001*x)<1e-11);
    assert.ok(Math.abs(result.nodalDisplacementsM[node][1]+0.0003*y)<1e-11);
    assert.ok(Math.abs(result.nodalDisplacementsM[node][2]+0.0003*z)<1e-11);
  }
  for (const stress of result.elementGaussStressMpa[0]) {
    assert.ok(Math.abs(stress[0]-210)<1e-6);
    for (const component of stress.slice(1)) assert.ok(Math.abs(component)<1e-6);
  }
  const automatic = await solveNativeVolumeHex8({ ...fixture, linearBackend: "automatic" });
  assert.equal(automatic.solverUsed, "sparse");
  assert.ok(Math.abs(automatic.nodalDisplacementsM[1][0] - result.nodalDisplacementsM[1][0]) < 1e-11);
  const direct = await solveNativeVolumeHex8({ ...fixture, linearBackend: "sparseDirect" });
  assert.equal(direct.solverUsed, "sparseDirect");
  assert.ok(direct.csrNonzeros > 0);
  for (let node = 0; node < fixture.nodes.length; node++) {
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(direct.nodalDisplacementsM[node][axis] - result.nodalDisplacementsM[node][axis]) < 1e-11);
      assert.ok(Math.abs(direct.nodalReactionsKn[node][axis] - result.nodalReactionsKn[node][axis]) < 1e-6);
    }
  }
  const frontal = await solveNativeVolumeHex8({ ...fixture, linearBackend: "frontalWave" });
  assert.equal(frontal.solverUsed, "frontalWave");
  assert.ok(frontal.frontalMaximumFrontDofs > 0);
  assert.equal(frontal.csrNonzeros, 0);
  for (let node = 0; node < fixture.nodes.length; node++) {
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(frontal.nodalDisplacementsM[node][axis] - result.nodalDisplacementsM[node][axis]) < 1e-11);
      assert.ok(Math.abs(frontal.nodalReactionsKn[node][axis] - result.nodalReactionsKn[node][axis]) < 1e-6);
    }
  }
  const leftReaction = [0,3,4,7].reduce((sum,node) => sum+result.nodalReactionsKn[node][0],0);
  assert.ok(Math.abs(leftReaction+210000)<1e-5);
  assert.ok(result.relativeResidual<1e-9);
  const distributed = await solveNativeVolumeHex8({
    ...fixture,
    loads: [],
    bodyForces: [{ element: 0, forceKnPerM3: [8, 0, 0] }],
    faceTractions: [{ element: 0, faceNodes: [1, 2, 6, 5], tractionKnPerM2: [4, 0, 0] }],
    supports: fixture.nodes.map((_, node) => ({ node, displacementM: [0, 0, 0] })),
  });
  [-1, -2, -2, -1, -1, -2, -2, -1].forEach((expected, node) => {
    assert.ok(Math.abs(distributed.nodalReactionsKn[node][0] - expected) < 1e-12);
  });
  const oldToNew = [0, 1, 3, 2, 4, 5, 7, 6];
  const structured = {
    ...fixture,
    nodes: [0, 1, 3, 2, 4, 5, 7, 6].map(old => fixture.nodes[old]),
    elements: [{ ...fixture.elements[0], nodes: fixture.elements[0].nodes.map(old => oldToNew[old]) }],
    loads: fixture.loads.map(load => ({ ...load, node: oldToNew[load.node] })),
    supports: fixture.supports.map(support => ({ ...support, node: oldToNew[support.node] })),
    structuredGridCells: [1, 1, 1],
    threads: 2,
  };
  const matrixFree = await solveNativeVolumeHex8(structured);
  assert.equal(matrixFree.solverUsed, "matrixFree");
  assert.equal(matrixFree.threads, 2);
  assert.equal(matrixFree.csrNonzeros, 0);
  for (let old = 0; old < fixture.nodes.length; old++) {
    const current = oldToNew[old];
    for (let direction = 0; direction < 3; direction++) {
      assert.ok(Math.abs(matrixFree.nodalDisplacementsM[current][direction] - result.nodalDisplacementsM[old][direction]) < 1e-10);
    }
  }
  const cells = [2, 2, 1];
  const nodeIndex = (i, j, k) => i + (cells[0] + 1) * (j + (cells[1] + 1) * k);
  const nodes = [];
  for (let k = 0; k <= cells[2]; k++) {
    for (let j = 0; j <= cells[1]; j++) {
      for (let i = 0; i <= cells[0]; i++) nodes.push([i / cells[0], j / cells[1], k / cells[2]]);
    }
  }
  const elements = [];
  for (let j = 0; j < cells[1]; j++) {
    for (let i = 0; i < cells[0]; i++) {
      elements.push({
        nodes: [
          nodeIndex(i, j, 0), nodeIndex(i + 1, j, 0), nodeIndex(i + 1, j + 1, 0), nodeIndex(i, j + 1, 0),
          nodeIndex(i, j, 1), nodeIndex(i + 1, j, 1), nodeIndex(i + 1, j + 1, 1), nodeIndex(i, j + 1, 1),
        ],
        material: (i + j) % 2,
      });
    }
  }
  const heterogeneous = {
    nodes,
    elements,
    materials: [{ eMpa: 30000, poisson: 0.25 }, { eMpa: 12000, poisson: 0.31 }],
    supports: nodes.flatMap(([x], node) => x === 0 ? [{ node, displacementM: [0, 0, 0] }] : []),
    loads: [{ node: nodeIndex(2, 2, 1), forceKn: [3, -2, 1] }],
    tolerance: 1e-10,
    maxIterations: 2000,
  };
  const heterogeneousCsr = await solveNativeVolumeHex8(heterogeneous);
  const heterogeneousMatrixFree = await solveNativeVolumeHex8({ ...heterogeneous, structuredGridCells: cells, threads: 4 });
  assert.equal(heterogeneousCsr.solverUsed, "sparse");
  assert.equal(heterogeneousMatrixFree.solverUsed, "matrixFree");
  assert.equal(heterogeneousMatrixFree.threads, 4);
  assert.equal(heterogeneousMatrixFree.csrNonzeros, 0);
  assert.ok(heterogeneousMatrixFree.relativeResidual < 1e-9);
  for (let node = 0; node < nodes.length; node++) {
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(heterogeneousCsr.nodalDisplacementsM[node][axis] - heterogeneousMatrixFree.nodalDisplacementsM[node][axis]) < 1e-10);
      assert.ok(Math.abs(heterogeneousCsr.nodalReactionsKn[node][axis] - heterogeneousMatrixFree.nodalReactionsKn[node][axis]) < 1e-6);
    }
  }
  for (let element = 0; element < elements.length; element++) {
    for (let point = 0; point < 8; point++) {
      for (let component = 0; component < 6; component++) {
        assert.ok(Math.abs(heterogeneousCsr.elementGaussStressMpa[element][point][component]
          - heterogeneousMatrixFree.elementGaussStressMpa[element][point][component]) < 1e-7);
      }
    }
  }
  const warped = {
    ...heterogeneous,
    nodes: nodes.map(([x, y, z]) => [x + 0.06 * y * z, y + 0.04 * x * z, z + 0.03 * x * y]),
  };
  const warpedCsr = await solveNativeVolumeHex8(warped);
  const warpedMatrixFree = await solveNativeVolumeHex8({
    ...warped, linearBackend: "matrixFreeGeneral", threads: 2,
  });
  const warpedLarge = await solveNativeVolumeHex8({
    ...warped, linearBackend: "matrixFreeGeneralLarge", threads: 2,
  });
  assert.equal(warpedMatrixFree.solverUsed, "matrixFreeGeneral");
  assert.equal(warpedLarge.solverUsed, "matrixFreeGeneralLarge");
  assert.equal(warpedMatrixFree.csrNonzeros, 0);
  assert.equal(warpedMatrixFree.threads, 2);
  assert.ok(warpedMatrixFree.relativeResidual < 1e-9);
  for (let node = 0; node < nodes.length; node++) {
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(warpedCsr.nodalDisplacementsM[node][axis]
        - warpedMatrixFree.nodalDisplacementsM[node][axis]) < 1e-10);
      assert.ok(Math.abs(warpedLarge.nodalDisplacementsM[node][axis]
        - warpedMatrixFree.nodalDisplacementsM[node][axis]) < 1e-10);
      assert.ok(Math.abs(warpedCsr.nodalReactionsKn[node][axis]
        - warpedMatrixFree.nodalReactionsKn[node][axis]) < 1e-6);
    }
  }
  for (let element = 0; element < elements.length; element++) {
    for (let point = 0; point < 8; point++) {
      for (let component = 0; component < 6; component++) {
        assert.ok(Math.abs(warpedCsr.elementGaussStressMpa[element][point][component]
          - warpedMatrixFree.elementGaussStressMpa[element][point][component]) < 1e-7);
      }
    }
  }
  assert.equal(calls, 11);
  console.log("Native Hex8-volumeroute: analytische kubus en sparse-directe, frontale en matrixvrije pariteit slagen.");
} finally {
  globalThis.fetch = originalFetch;
}

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { solveFrame3D, solveFrame3DCombination } from "./src/components/frame3d/frame3dSolver.ts";
import { parseFrame3DModel } from "./src/components/frame3d/frame3dModel.ts";
import { deserializeProject } from "./src/io/projectFile.ts";

// The one-free-DOF Tet4 has an independent total-Lagrangian scalar solution:
// F = 1000 V (lambda + 2mu) (1+u) (u + u²/2).
const binary = fileURLToPath(new URL("../src-tauri/target/debug/native-volume3d-gnl", import.meta.url));
const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/tet4-gnl-eenassig.ifcfem2d", import.meta.url), "utf8"));
const e = 1200, nu = 0.2, volume = 1 / 6;
const lambda = e * nu / ((1 + nu) * (1 - 2 * nu));
const mu = e / (2 * (1 + nu));
const modulus = lambda + 2 * mu;
const nominalForce = u => 1000 * volume * modulus * (1 + u) * (u + u * u / 2);
const expectedU = force => {
  let low = -0.5, high = 0.5;
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    if (nominalForce(mid) < force) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
};
const close = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual}, expected ${expected}`);

const calls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const request = JSON.parse(options.body);
  assert.equal(request.opdracht, "solve_native_fem");
  assert.equal(request.inputs.kind, "volume3dGnl");
  calls.push(request.inputs.input);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const output = [], errors = [];
    child.stdout.on("data", chunk => output.push(chunk));
    child.stderr.on("data", chunk => errors.push(chunk));
    child.on("error", reject);
    child.on("close", code => {
      const raw = Buffer.concat(output).toString();
      code === 0 ? resolve(JSON.parse(raw)) : reject(new Error(raw || Buffer.concat(errors).toString()));
    });
    child.stdin.end(JSON.stringify(request.inputs.input));
  });
  return new Response(JSON.stringify({ kind: "volume3dGnl", result }), { status: 200 });
};

try {
  assert.equal(project.modelDimension, "3d");
  assert.equal(project.model3d.volumes.length, 1);
  assert.equal(project.analysetype, "tweedeOrdeGeometrisch");
  const force = project.model3d.loads[0].fx;
  close(force, nominalForce(0.1), 1e-11, "load from closed solution");
  const result = await solveFrame3D(project.model3d, 1, "p-delta", "openaec-native-fem");
  assert.equal(result.analysis, "p-delta");
  assert.equal(result.volume3D.formulation, "totalLagrangian");
  assert.equal(result.volume3D.elements.length, 1);
  const displacement = result.displacements.find(node => node.nodeId === 205);
  close(displacement.ux, 0.1, 1e-10, "nonlinear displacement");
  const green = 0.1 + 0.1 ** 2 / 2;
  const stress = result.volume3D.elements[0];
  close(stress.greenStrain[0][0], green, 1e-10, "Green strain");
  close(stress.firstPiolaMpa[0][0], 1.1 * modulus * green, 1e-8, "first Piola stress");
  close(stress.stressMpa[0], 1.1 * modulus * green, 1e-8, "Cauchy stress xx");
  close(stress.stressMpa[1], lambda * green / 1.1, 1e-8, "Cauchy stress yy");
  close(result.reactions.reduce((sum, node) => sum + node.fx, 0), -force, 1e-7, "force balance");
  assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk);
  assert.ok(result.volume3D.newtonIterations > 0);
  assert.deepEqual(calls[0].mesh.tets, [[0, 1, 2, 3]]);
  assert.deepEqual(calls[0].targets[0].loadsKn[1], [force, 0, 0]);

  const body = await solveFrame3D(project.model3d, 2, "p-delta", "openaec-native-fem");
  close(body.displacements.find(node => node.nodeId === 205).ux, expectedU(0.25), 1e-10,
    "consistent body force on one free DOF");
  close(body.reactions.reduce((sum, node) => sum + node.fx, 0), -1, 1e-7,
    "body-force total reaction");
  assert.deepEqual(calls[1].targets[0].bodyForces,
    [{ element: 0, forceKnPerM3: [6, 0, 0] }]);
  assert.ok(calls[1].targets[0].loadsKn.every(load => load.every(value => value === 0)),
    "distributed load must not be counted twice");

  const faceModel = { ...project.model3d, loads: [], volumeBodyLoads: [],
    volumeFaceLoads: [{ id: 9, volumeId: 21, caseId: 3, faceIndex: 2,
      tractionKnPerM2: [6 / Math.sqrt(3), 0, 0] }] };
  const face = await solveFrame3D(faceModel, 3, "p-delta", "openaec-native-fem");
  close(face.displacements.find(node => node.nodeId === 205).ux, expectedU(1), 1e-10,
    "nominal face traction on one free DOF");
  close(face.reactions.reduce((sum, node) => sum + node.fx, 0), -3, 1e-7,
    "face-traction total reaction");
  assert.deepEqual(calls[2].targets[0].faceTractions[0].faceNodes, [1, 2, 3]);

  const imposedModel = { ...project.model3d, loads: [], volumeBodyLoads: [],
    supports: project.model3d.supports.map(support => support.nodeId === 205
      ? { ...support, ux: true, prescribed: { uxM: 0.1 } } : support) };
  const imposed = await solveFrame3D(imposedModel, 1, "p-delta", "openaec-native-fem");
  close(imposed.displacements.find(node => node.nodeId === 205).ux, 0.1, 1e-12,
    "prescribed displacement");
  close(imposed.reactions.find(node => node.nodeId === 205).fx, force, 1e-7,
    "prescribed-displacement reaction");
  assert.ok(imposed.forceBalance.ok);

  const combinedForce = 0.5 * force - 2 * 0.25;
  const combination = await solveFrame3DCombination(project.model3d,
    new Map([[1, 0.5], [2, -2]]), "p-delta", "openaec-native-fem");
  close(combination.displacements.find(node => node.nodeId === 205).ux,
    expectedU(combinedForce), 1e-10, "nonlinear combination is solved after load assembly");
  close(combination.reactions.reduce((sum, node) => sum + node.fx, 0),
    -(0.5 * force - 2 * 1), 1e-7, "combined global reaction");

  for (const backend of ["dense", "sparseDirect", "frontalWave"]) {
    const alternate = await solveFrame3D({ ...project.model3d, volumeBackend: backend },
      1, "p-delta", "openaec-native-fem");
    close(alternate.displacements.find(node => node.nodeId === 205).ux, 0.1, 1e-10,
      `${backend} nonlinear displacement`);
    assert.equal(alternate.volume3D.backendUsed, backend);
  }
  const beta = 40;
  const factor = 1 + beta * (modulus / e) * green ** 2 / 2;
  const betaProject = deserializeProject(readFileSync(new URL(
    "../docs/verificatie/3d-volume/tet4-gnl-rekafhankelijke-e.ifcfem2d", import.meta.url), "utf8"));
  const betaModel = betaProject.model3d;
  assert.equal(betaProject.analysetype, "tweedeOrdeGeometrisch");
  assert.equal(betaModel.volumes[0].energyBeta, beta);
  close(betaModel.loads[0].fx, nominalForce(0.1) * factor, 1e-9,
    "saved nonlinear-energy load");
  const nonlinearMaterial = await solveFrame3D(betaModel, 1, "p-delta", "openaec-native-fem");
  close(nonlinearMaterial.displacements.find(node => node.nodeId === 205).ux, 0.1, 1e-10,
    "nonlinear energy law displacement");
  close(nonlinearMaterial.volume3D.elements[0].effectiveEMpa, e * factor, 1e-7,
    "independent strain-dependent E reference");
  close(nonlinearMaterial.volume3D.elements[0].stressMpa[0], 1.1 * modulus * green * factor,
    1e-7, "independent hyperelastic Cauchy stress");
  assert.deepEqual(calls.at(-1).elementEnergyBeta, [beta]);
  assert.throws(() => parseFrame3DModel({ ...project.model3d,
    volumes: [{ ...project.model3d.volumes[0], energyBeta: Infinity }] }), /β/);
  const requestCount = calls.length;
  await assert.rejects(solveFrame3D({ ...project.model3d,
    volumes: [{ ...project.model3d.volumes[0], kind: "hex8",
      nodeIds: [101, 205, 306, 407, 101, 205, 306, 407] }] },
  1, "p-delta", "openaec-native-fem"), /alleen Tet4/i);
  await assert.rejects(solveFrame3D({ ...project.model3d, volumeBackend: "matrixFreePcg" },
    1, "p-delta", "openaec-native-fem"), /PCG/);
  assert.equal(calls.length, requestCount, "unsupported GNL combinations are rejected before Rust");
  console.log("Ordinary 3D Tet4-GNL route matches finite-strain reference, strain-dependent E, body and face loads, prescribed displacement, combinations and backend parity.");
} finally {
  globalThis.fetch = originalFetch;
}

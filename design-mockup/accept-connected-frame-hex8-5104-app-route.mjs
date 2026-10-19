import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const analyticPatch = process.env.FEM_ANALYTIC_PATCH === "1";
const fullVolumeGrid = process.env.FEM_FULL_VOLUME_GRID === "1";
const projectFile = analyticPatch
  ? "../docs/verificatie/3d-volume/hex8-raamwerk-1143-volumes-5104-staven-axiaal-patch.ifcfem2d"
  : fullVolumeGrid
    ? "../docs/verificatie/3d-volume/hex8-verbonden-raamwerk-1143-volumes-5104-staven.ifcfem2d"
    : "../docs/verificatie/3d-volume/hex8-verbonden-raamwerk-5104-staven.ifcfem2d";
const volumeCount = fullVolumeGrid || analyticPatch ? 1_143 : 1;
const project = deserializeProject(readFileSync(new URL(projectFile, import.meta.url), "utf8"));
const model = project.model3d;
assert.equal(project.modelDimension, "3d");
assert.deepEqual([model.nodes.length, model.beams.length, model.volumes.length],
  [2_048, 5_104, volumeCount]);
assert.equal(model.volumeBackend, "matrixFreePcg");
assert.equal(model.volumeThreads, 4);
assert.ok(model.beams.every(beam => !beam.axialOnly));

const binary = process.env.FEM_MIXED3D_BINARY
  ?? fileURLToPath(new URL("../src-tauri/target/debug/native-mixed3d", import.meta.url));
const previousFetch = globalThis.fetch;
let nativeInput;
let nativeDurationMs;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "mixed3d");
  nativeInput = body.inputs.input;
  const nativeStart = performance.now();
  const result = await new Promise((resolve, reject) => {
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
    child.stdin.end(JSON.stringify(nativeInput));
  });
  nativeDurationMs = performance.now() - nativeStart;
  return new Response(JSON.stringify({ kind: "mixed3d", result }), { status: 200 });
};

try {
  const start = performance.now();
  const result = await solveFrame3D(model, project.activeLoadCaseId,
    "linear", "openaec-native-fem");
  assert.equal(nativeInput.mesh.nodes.length, 2_048);
  assert.equal(nativeInput.frames.length, 5_104);
  assert.equal(nativeInput.hexes.length, volumeCount);
  assert.equal(nativeInput.backend, "matrixFreePcg");
  assert.equal(nativeInput.threads, 4);
  assert.equal(result.displacements.length, 2_048);
  assert.equal(result.memberForces.length, 5_104);
  assert.equal(result.volume3D.elements.length, volumeCount);
  assert.equal(result.volume3D.backendUsed, "matrixFreePcg");
  assert.ok(result.volume3D.relativeResidual < 1e-8);
  assert.ok(result.equilibrium.equilibriumOk);
  assert.ok(result.forceBalance.ok);
  assert.ok(result.displacements.every(node =>
    [node.ux, node.uy, node.uz, node.rx, node.ry, node.rz].every(Number.isFinite)));
  assert.ok(result.memberForces.every(member => Object.values(member)
    .filter(value => typeof value === "number").every(Number.isFinite)));
  assert.ok(result.volume3D.elements.every(element =>
    element.stressMpa.every(Number.isFinite) && Number.isFinite(element.vonMisesMpa)));
  const tip = result.displacements.find(node => node.nodeId === 2_048);
  if (analyticPatch) {
    const eBeamKnM2 = 210_000 * 1_000;
    const eSolidMpa = 30_000;
    const poisson = 0.2;
    const constrainedModulusMpa = eSolidMpa * (1 - poisson)
      / ((1 + poisson) * (1 - 2 * poisson));
    const expectedStrain = 100 / (constrainedModulusMpa * 1_000 * 9
      + eBeamKnM2 * 0.16 * 16);
    const expectedTipUx = expectedStrain * 31.75;
    assert.ok(Math.abs(tip.ux - expectedTipUx) < 1e-9,
      `tip ux ${tip.ux}, expected ${expectedTipUx}`);
    const coordinates = new Map(model.nodes.map(node => [node.id, node]));
    let maxAffineError = 0;
    for (const node of result.displacements) {
      const expectedUx = expectedStrain * coordinates.get(node.nodeId).x;
      maxAffineError = Math.max(maxAffineError, Math.abs(node.ux - expectedUx));
      assert.ok(Math.abs(node.ux - expectedUx) < 1e-9, `node ${node.nodeId} ux`);
      assert.ok(Math.max(Math.abs(node.uy), Math.abs(node.uz), Math.abs(node.rx),
        Math.abs(node.ry), Math.abs(node.rz)) < 1e-10,
      `node ${node.nodeId} spurious transverse or rotation DOF`);
    }
    const lambdaMpa = eSolidMpa * poisson / ((1 + poisson) * (1 - 2 * poisson));
    const expectedStress = [constrainedModulusMpa * expectedStrain,
      lambdaMpa * expectedStrain, lambdaMpa * expectedStrain];
    let maxStressError = 0;
    for (const element of result.volume3D.elements) {
      for (let axis = 0; axis < 3; axis++) {
        maxStressError = Math.max(maxStressError,
          Math.abs(element.stressMpa[axis] - expectedStress[axis]));
        assert.ok(Math.abs(element.stressMpa[axis] - expectedStress[axis]) < 1e-5,
          `Hex8 ${element.elementId} stress ${axis}`);
      }
      for (let axis = 3; axis < 6; axis++) {
        assert.ok(Math.abs(element.stressMpa[axis]) < 1e-5,
          `Hex8 ${element.elementId} shear ${axis}`);
      }
    }
    const beamsById = new Map(model.beams.map(beam => [beam.id, beam]));
    const expectedBeamAxialKn = eBeamKnM2 * 0.16 * expectedStrain;
    let longitudinalBeams = 0;
    for (const member of result.memberForces) {
      const beam = beamsById.get(member.memberId);
      const alongX = coordinates.get(beam.startNodeId).x
        !== coordinates.get(beam.endNodeId).x;
      const axialExpected = alongX ? expectedBeamAxialKn : 0;
      if (alongX) longitudinalBeams++;
      assert.ok(Math.abs(member.nStartKn - axialExpected) < 1e-4,
        `beam ${member.memberId} axial start`);
      assert.ok(Math.abs(member.nEndKn - axialExpected) < 1e-4,
        `beam ${member.memberId} axial end`);
      for (const field of ["vyStartKn", "vyEndKn", "vzStartKn", "vzEndKn",
        "torsionStartKnm", "torsionEndKnm", "myStartKnm", "myEndKnm",
        "mzStartKnm", "mzEndKnm"]) {
        assert.ok(Math.abs(member[field]) < 1e-4,
          `beam ${member.memberId} ${field}`);
      }
    }
    assert.equal(longitudinalBeams, 16 * 127);
    console.log(`Analytic axial patch: 2,048 node displacements within `
      + `${maxAffineError.toExponential(3)} m, 1,143 Hex8 stresses within `
      + `${maxStressError.toExponential(3)} MPa, 5,104 member-end forces, `
      + `tip ux=${(1_000 * tip.ux).toFixed(6)} mm.`);
  } else {
    assert.ok(tip.uz < 0 && Number.isFinite(tip.uz));
  }

  const positions = new Map(model.nodes.map(node => [node.id, node]));
  const force = [0, 0, 0], moment = [0, 0, 0];
  for (const item of [...model.loads, ...result.reactions]) {
    const { x, y, z } = positions.get(item.nodeId);
    const fx = item.fx ?? 0, fy = item.fy ?? 0, fz = item.fz ?? 0;
    force[0] += fx; force[1] += fy; force[2] += fz;
    moment[0] += (item.mx ?? 0) + y * fz - z * fy;
    moment[1] += (item.my ?? 0) + z * fx - x * fz;
    moment[2] += (item.mz ?? 0) + x * fy - y * fx;
  }
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(Math.abs(force[axis]) < 1e-4, `global force ${axis}: ${force[axis]}`);
    assert.ok(Math.abs(moment[axis]) < 1e-3, `global moment ${axis}: ${moment[axis]}`);
  }
  console.log(`Open FEM Studio: 5,104 connected 3D beams + ${volumeCount} shared Hex8, `
    + `2,048 nodes, tip ${analyticPatch ? "ux" : "uz"}=`
    + `${(1_000 * (analyticPatch ? tip.ux : tip.uz)).toFixed(6)} mm, `
    + `residual=${result.volume3D.relativeResidual.toExponential(3)}, `
    + `${((performance.now() - start) / 1_000).toFixed(2)} s `
    + `(Rust ${((nativeDurationMs ?? 0) / 1_000).toFixed(2)} s).`);
} finally {
  globalThis.fetch = previousFetch;
}

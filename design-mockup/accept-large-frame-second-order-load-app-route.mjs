import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { deserializeProject } from "./src/io/projectFile.ts";
import { frame3DAnalysisForProject, solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/hex8-verbonden-raamwerk-5104-staven-gnl-j2-druk.ifcfem2d",
  import.meta.url), "utf8"));
const farX = Math.max(...project.model3d.nodes.map(node => node.x));
const endNodes = project.model3d.nodes.filter(node => node.x === farX);
assert.equal(endNodes.length, 16);
assert.deepEqual([project.model3d.nodes.length, project.model3d.beams.length,
  project.model3d.volumes.length],
  [2_048, 5_104, 1]);
assert.equal(project.model3d.volumeMaterialKinematics, "finiteStrain");
assert.equal(project.model3d.volumes[0].materialLaw?.kind, "steelJ2");
assert.deepEqual(project.model3d.materialLoadPath, [0.25, 0.5, 0.75, 1]);
assert.equal(frame3DAnalysisForProject(project.model3d, project.analysetype), "combined");
const binary = process.env.NATIVE_FEM_BINARY
  ?? fileURLToPath(new URL("../src-tauri/target/release/toetsbrug", import.meta.url));

export async function runLargeFrameCase(loadFxKn, loadFzKn) {
  assert.ok(Number.isFinite(loadFxKn) && Math.abs(loadFxKn) <= 8_000);
  assert.ok(Number.isFinite(loadFzKn) && Math.abs(loadFzKn) <= 50);
  const model = { ...project.model3d,
    // Equal tip-node forces keep the compression concentric across the 4x4 grid.
    loads: endNodes.map((node, index) => ({ id: index + 1, nodeId: node.id,
      fx: loadFxKn / endNodes.length, fy: 0, fz: loadFzKn / endNodes.length,
      mx: 0, my: 0, mz: 0, caseId: project.activeLoadCaseId })),
  };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/toetsing");
    const body = JSON.parse(options.body);
    assert.equal(body.opdracht, "solve_native_fem");
    assert.equal(body.inputs.kind, "volume3dFiniteJ2FrameCoupled");
    assert.equal(body.inputs.input.volume.options.geometricFrames, true);
    assert.deepEqual([body.inputs.input.frames.length,
      body.inputs.input.hexes.length, body.inputs.input.volume.targets.length],
    [5_104, 1, 4]);
    const raw = await new Promise((resolve, reject) => {
      const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
      const stdout = [], stderr = [];
      child.stdout.on("data", chunk => stdout.push(chunk));
      child.stderr.on("data", chunk => stderr.push(chunk));
      child.on("error", reject);
      child.on("close", code => {
        const output = Buffer.concat(stdout).toString();
        if (code === 0) resolve(output);
        else reject(new Error(output || Buffer.concat(stderr).toString()));
      });
      child.stdin.end(JSON.stringify(body));
    });
    return new Response(raw, { status: 200 });
  };
  try {
    const start = performance.now();
    const result = await solveFrame3D(model, project.activeLoadCaseId,
      "combined", "openaec-native-fem");
    assert.equal(result.analysis, "combined");
    assert.deepEqual([result.displacements.length, result.memberForces.length,
      result.volume3D.elements.length], [2_048, 5_104, 1]);
    assert.ok(result.equilibrium.equilibriumOk && result.forceBalance.ok);
    assert.ok(result.equilibrium.relativeResidual < 1e-8);
    assert.ok(result.displacements.every(node =>
      [node.ux, node.uy, node.uz, node.rx, node.ry, node.rz].every(Number.isFinite)));
    const root = result.displacements.find(node => node.nodeId === 16);
    const tip = result.displacements.find(node => node.nodeId === 2_048);
    return { tipUzMm: tip.uz * 1_000,
      relativeUzMm: (tip.uz - root.uz) * 1_000,
      residual: result.equilibrium.relativeResidual,
      backend: result.volume3D.backendUsed,
      momentImbalanceKnm: result.forceBalance.maxMomentImbalanceKnm,
      momentToleranceKnm: result.forceBalance.momentToleranceKnm,
      durationSeconds: (performance.now() - start) / 1_000 };
  } finally {
    globalThis.fetch = oldFetch;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const axial = Number(process.env.FEM_AXIAL_LOAD_KN ?? -5_000);
  const lateral = Number(process.env.FEM_LATERAL_LOAD_KN ?? -10);
  const result = await runLargeFrameCase(axial, lateral);
  console.log(`Large second-order load: axial=${axial} kN, lateral=${lateral} kN, 5,104 frames + Hex8; `
    + `tip uz=${result.tipUzMm.toFixed(5)} mm, relative uz=${result.relativeUzMm.toFixed(5)} mm, `
    + `residual=${result.residual.toExponential(3)}, backend=${result.backend}, `
    + `moment=${result.momentImbalanceKnm.toExponential(3)}/${result.momentToleranceKnm.toExponential(3)} kNm, `
    + `${result.durationSeconds.toFixed(2)} s.`);
}

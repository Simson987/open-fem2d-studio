import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { bouwMultiInput } from "./src/lib/modelNaarSolverInput.ts";
import { solveAllCasesNativeFrame2D } from "./src/components/fem/solver/nativeFrame2DRoute.ts";
import { solveAllCasesNativeMembrane2D } from "./src/components/fem/solver/nativeMembraneRoute.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

// Saved-file acceptance matrix. The focused route tests use mostly constructed
// models; this checks that the persisted editor format reaches the real Rust
// binaries through the same adapters as the app.
const files = {
  beam2d: "referentie/R16.ifcfem2d",
  plate2d: "referentie/native-plaat-rek.ifcfem2d",
  frame3d: "../docs/verificatie/3d-raamwerk/gui-portaal.ifcfem2d",
  volume3d: "../docs/verificatie/3d-volume/tet4-hex8-raamwerk.ifcfem2d",
};
const binaries = Object.fromEntries([
  ["frame2d", "native-frame2d"],
  ["quad2d", "native-quad2d"],
  ["frame3d", "native-frame3d"],
  ["mixed3d", "native-mixed3d"],
].map(([kind, name]) => [kind, fileURLToPath(new URL(
  `../src-tauri/target/debug/${name}${process.platform === "win32" ? ".exe" : ""}`,
  import.meta.url,
))]));
for (const [kind, path] of Object.entries(binaries)) {
  assert.ok(existsSync(path), `${kind}: build the native-fem debug binary at ${path}`);
}
const project = name => deserializeProject(readFileSync(new URL(files[name], import.meta.url), "utf8"));
const invokeRust = (kind, input) => new Promise((resolve, reject) => {
  const child = spawn(binaries[kind], [], { stdio: ["pipe", "pipe", "pipe"] });
  const stdout = [], stderr = [];
  child.stdout.on("data", chunk => stdout.push(chunk));
  child.stderr.on("data", chunk => stderr.push(chunk));
  child.on("error", reject);
  child.on("close", code => {
    const out = Buffer.concat(stdout).toString();
    if (code !== 0) return reject(new Error(`${kind} exited ${code}: ${out} ${Buffer.concat(stderr)}`));
    try { resolve(JSON.parse(out)); } catch (error) { reject(error); }
  });
  child.stdin.end(JSON.stringify(input));
});
const close = (value, expected, tolerance, label) => assert.ok(
  Number.isFinite(value) && Math.abs(value - expected) <= tolerance,
  `${label}: got ${value}, expected ${expected} ± ${tolerance}`,
);
const nativeRequests = [];
const oldFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  nativeRequests.push(body.inputs.kind);
  const result = await invokeRust(body.inputs.kind, body.inputs.input);
  return new Response(JSON.stringify({ kind: body.inputs.kind, result }), { status: 200 });
};

try {
  const beam = project("beam2d");
  assert.equal(beam.modelDimension ?? "2d", "2d");
  assert.equal(beam.beams.length, 1);
  const beamCases = await solveAllCasesNativeFrame2D(bouwMultiInput(beam));
  assert.deepEqual([...beamCases.keys()], [1, 2]);
  for (const [caseId, result] of beamCases) {
    assert.ok(result.maxDisplacement > 0 && Number.isFinite(result.maxDisplacement),
      `2D beam case ${caseId}: no finite deflection`);
    assert.equal(result.elements.size, 1);
    assert.ok(result.reactions.size >= 2);
  }
  // R16 case 2 has only a uniform -6.25 N/mm load over 5700 mm.
  close(beamCases.get(2).reactions.get(1).fz, 17_812.5, 1e-5,
    "2D beam Q left reaction (N)");
  close(beamCases.get(2).reactions.get(2).fz, 17_812.5, 1e-5,
    "2D beam Q right reaction (N)");

  const plate = project("plate2d");
  assert.equal(plate.modelDimension, "2d");
  assert.equal(plate.plates.length, 1);
  const plateCases = await solveAllCasesNativeMembrane2D(bouwMultiInput(plate));
  assert.deepEqual([...plateCases.keys()], [1]);
  const plateResult = plateCases.get(1);
  assert.ok(plateResult.plateElements?.[0].elements.length >= 2);
  assert.ok(plateResult.maxDisplacement > 0 && Number.isFinite(plateResult.maxDisplacement));
  close([...plateResult.reactions.values()].reduce((sum, reaction) => sum + reaction.fx, 0),
    -10_000, 1e-5, "2D plate global X equilibrium (N)");

  const frame = project("frame3d");
  assert.equal(frame.modelDimension, "3d");
  const frameResult = await solveFrame3D(frame.model3d, frame.activeLoadCaseId,
    "linear", "openaec-native-fem");
  assert.equal(frameResult.memberForces.length, frame.model3d.beams.length);
  assert.ok(frameResult.displacements.find(node => node.nodeId === 2).ux > 0);
  close(frameResult.reactions.reduce((sum, node) => sum + node.fx, 0), -10, 1e-7,
    "3D frame global X equilibrium (kN)");
  close(frameResult.reactions.reduce((sum, node) => sum + node.fz, 0), 50, 1e-7,
    "3D frame global Z equilibrium (kN)");
  assert.ok(frameResult.forceBalance?.ok);

  const volume = project("volume3d");
  assert.equal(volume.modelDimension, "3d");
  assert.equal(volume.model3d.volumes.length, 3);
  const volumeResult = await solveFrame3D(volume.model3d, volume.activeLoadCaseId,
    "linear", "openaec-native-fem");
  assert.equal(volumeResult.volume3D?.elements.length, volume.model3d.volumes.length);
  assert.equal(volumeResult.memberForces.length, volume.model3d.beams.length);
  assert.ok(volumeResult.volume3D.relativeResidual < 1e-7);
  assert.ok(volumeResult.forceBalance?.ok);
  close(volumeResult.reactions.reduce((sum, node) => sum + node.fz, 0), 10, 1e-6,
    "3D coupled volume global Z equilibrium (kN)");
  assert.ok(volumeResult.displacements.some(node =>
    Math.hypot(node.ux, node.uy, node.uz) > 0));
  assert.ok(volumeResult.volume3D.elements.every(element =>
    element.stressMpa.every(Number.isFinite)));

  assert.deepEqual(nativeRequests, ["frame2d", "frame2d", "quad2d", "frame3d", "mixed3d"]);
  console.log("Saved-project native solve matrix: 2D beam (2 cases), 2D membrane plate, "
    + "3D frame, coupled Tet4/Hex8/frame volume passed.");
} finally {
  globalThis.fetch = oldFetch;
}

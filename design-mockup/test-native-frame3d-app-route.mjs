import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { solveFrame3D, solveFrame3DCombination } from "./src/components/frame3d/frame3dSolver.ts";
import { resolveSolver } from "./src/core/solver/SolverRegistry.ts";
import { deserializeProject } from "./src/io/projectFile.ts";

const executable = (name) => fileURLToPath(new URL(`../src-tauri/target/debug/${name}`, import.meta.url));
const invoke = (binary, input) => new Promise((resolve, reject) => {
  const child = spawn(executable(binary), [], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [], errors = [];
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => errors.push(chunk));
  child.on("error", reject);
  child.on("close", (code) => {
    if (code !== 0) return reject(new Error(Buffer.concat(errors).toString() || Buffer.concat(output).toString()));
    resolve(JSON.parse(Buffer.concat(output).toString()));
  });
  child.stdin.end(JSON.stringify(input));
});

const fetchBefore = globalThis.fetch;
let nativeCalls = 0;
let referenceCalls = 0;
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  if (url === "/api/toetsing") {
    assert.equal(body.opdracht, "solve_native_fem");
    assert.equal(body.inputs.kind, "frame3d");
    nativeCalls += 1;
    const result = await invoke("native-frame3d", body.inputs.input);
    return new Response(JSON.stringify({ kind: "frame3d", result }), { status: 200 });
  }
  assert.equal(url, "/api/frame3d/solve");
  referenceCalls += 1;
  const result = await invoke("frame3d-solver", body);
  return new Response(JSON.stringify(result), { status: 200 });
};

const close = (actual, expected, absolute, label) => assert.ok(
  Math.abs(actual - expected) <= absolute,
  `${label}: native ${actual}, bestaande solver ${expected}, grens ${absolute}`,
);
try {
  const request = { schemaVersion: 1, dimension: "3d", analysis: "linear", elementFamilies: ["frame"] };
  assert.equal(resolveSolver("openaec-native-fem", request).id, "openaec-native-fem");
  assert.equal(resolveSolver("automatic", request).id, "dedaliano");
  assert.equal(resolveSolver("openaec-native-fem", { ...request, analysis: "p-delta" }).id,
    "openaec-native-fem");
  const cases = [
    ["stalen-ligger-3d.ifcfem2d", 1],
    ["stalen-ruimteportaal.ifcfem2d", 1],
    ["stalen-ruimteportaal.ifcfem2d", 2],
  ];
  for (const [name, caseId] of cases) {
    const project = fileURLToPath(new URL(`../docs/verificatie/3d-raamwerk/${name}`, import.meta.url));
    const model = deserializeProject(readFileSync(project, "utf8")).model3d;
    const native = await solveFrame3D(model, caseId, "linear", "openaec-native-fem");
    const existing = await solveFrame3D(model, caseId, "linear", "dedaliano");
    assert.equal(native.engine.id, "openaec-native-fem");
    assert.equal(native.buckling.status, "notApplicable");
    assert.equal(native.forceBalance.ok, true);
    assert.equal(native.memberForces.length, existing.memberForces.length);
    for (const node of native.displacements) {
      const expected = existing.displacements.find((value) => value.nodeId === node.nodeId);
      assert.ok(expected);
      for (const axis of ["ux", "uy", "uz", "rx", "ry", "rz"])
        close(node[axis], expected[axis], 1e-7, `${name} LC${caseId} knoop ${node.nodeId} ${axis}`);
    }
    for (const reaction of native.reactions) {
      const expected = existing.reactions.find((value) => value.nodeId === reaction.nodeId);
      if (!expected) continue;
      for (const axis of ["fx", "fy", "fz", "mx", "my", "mz"])
        close(reaction[axis], expected[axis], 1e-4, `${name} LC${caseId} reactie ${reaction.nodeId} ${axis}`);
    }
    for (const member of native.memberForces) {
      const expected = existing.memberForces.find((value) => value.memberId === member.memberId);
      assert.ok(expected);
      for (const axis of ["nStartKn", "nEndKn", "vyStartKn", "vyEndKn", "vzStartKn", "vzEndKn",
        "torsionStartKnm", "torsionEndKnm", "myStartKnm", "myEndKnm", "mzStartKnm", "mzEndKnm"])
        close(member[axis], expected[axis], 1e-4, `${name} LC${caseId} staaf ${member.memberId} ${axis}`);
      for (const [key, startAxis, endAxis] of [
        ["axial", "nStartKn", "nEndKn"], ["shearY", "vyStartKn", "vyEndKn"],
        ["shearZ", "vzStartKn", "vzEndKn"], ["momentY", "myStartKnm", "myEndKnm"],
        ["momentZ", "mzStartKnm", "mzEndKnm"], ["torsion", "torsionStartKnm", "torsionEndKnm"],
      ]) {
        const curve = native.diagrams[key].find((value) => value.memberId === member.memberId);
        assert.ok(curve);
        close(curve.points[0].value, member[startAxis], 1e-9, `${key} begin`);
        close(curve.points.at(-1).value, member[endAxis], 1e-9, `${key} einde`);
      }
    }
  }
  assert.equal(nativeCalls, 3);
  assert.equal(referenceCalls, 3);
  const fixture = fileURLToPath(new URL("../docs/verificatie/3d-raamwerk/stalen-ligger-3d.ifcfem2d", import.meta.url));
  const model = deserializeProject(readFileSync(fixture, "utf8")).model3d;
  const portalFixture = fileURLToPath(new URL("../docs/verificatie/3d-raamwerk/stalen-ruimteportaal.ifcfem2d", import.meta.url));
  const portal = deserializeProject(readFileSync(portalFixture, "utf8")).model3d;
  const pDeltaFactors = new Map([[1, 1], [2, 1]]);
  const nativePDelta = await solveFrame3DCombination(portal, pDeltaFactors, "p-delta", "openaec-native-fem");
  const referencePDelta = await solveFrame3DCombination(portal, pDeltaFactors, "p-delta", "dedaliano");
  assert.equal(nativePDelta.analysis, "p-delta");
  assert.equal(nativePDelta.secondOrder.converged, true);
  assert.equal(nativePDelta.secondOrder.stable, true);
  assert.ok(nativePDelta.secondOrder.iterations > 1);
  assert.ok(nativePDelta.secondOrder.maxAmplification > 1, "portaal onder druk versterkt de zijdelingse verplaatsing");
  assert.ok(nativePDelta.forceBalance.maxImbalanceKn < 1e-6,
    "P-Δ-krachten zijn globaal in evenwicht; de momenten worden over de onvervormde geometrie getoetst");
  for (const node of nativePDelta.displacements) {
    const expected = referencePDelta.displacements.find((value) => value.nodeId === node.nodeId);
    assert.ok(expected);
    for (const axis of ["ux", "uy", "uz", "rx", "ry", "rz"])
      close(node[axis], expected[axis], 1e-5, `P-Δ knoop ${node.nodeId} ${axis}`);
  }
  for (const member of nativePDelta.memberForces) {
    const expected = referencePDelta.memberForces.find((value) => value.memberId === member.memberId);
    assert.ok(expected);
    for (const axis of ["nStartKn", "nEndKn", "vyStartKn", "vyEndKn", "vzStartKn", "vzEndKn",
      "torsionStartKnm", "torsionEndKnm", "myStartKnm", "myEndKnm", "mzStartKnm", "mzEndKnm"])
      close(member[axis], expected[axis], 1e-2, `P-Δ staaf ${member.memberId} ${axis}`);
  }
  const beam = model.beams[0];
  const start = model.nodes.find((node) => node.id === beam.startNodeId);
  const end = model.nodes.find((node) => node.id === beam.endNodeId);
  const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  const loaded = { ...model, memberLoads: [{ id: 99, beamId: beam.id, caseId: 1,
    qyStart: 0, qyEnd: 0, qzStart: -1, qzEnd: -1, startPositionM: 0, endPositionM: length }] };
  const pointLoaded = { ...model, memberPointLoads: [{ id: 100, beamId: beam.id, caseId: 1,
    py: 2, pz: -4, positionM: length / 2 }] };
  const thermal = { ...model, thermalLoads: [{ id: 101, beamId: beam.id, caseId: 1,
    deltaTUniformK: 20, deltaTGradientYK: 8, deltaTGradientZK: -5 }] };
  for (const [label, caseModel] of [["lijnlast", loaded], ["puntlast", pointLoaded], ["temperatuur", thermal]]) {
    const native = await solveFrame3D(caseModel, 1, "linear", "openaec-native-fem");
    const existing = await solveFrame3D(caseModel, 1, "linear", "dedaliano");
    assert.equal(native.forceBalance.ok, true, label);
    for (const key of ["momentY", "momentZ", "shearY", "shearZ", "axial", "torsion"]) {
      for (const curve of native.diagrams[key]) {
        const reference = existing.diagrams[key].find((value) => value.memberId === curve.memberId);
        assert.ok(reference, `${label} ${key}`);
        for (const station of reference.points) {
          const actual = curve.points.find((value) => Math.abs(value.t - station.t) < 1e-9);
          assert.ok(actual, `${label} ${key} station ${station.t}`);
          close(actual.value, station.value, 1e-4, `${label} ${key} station ${station.t}`);
        }
      }
    }
  }
  assert.equal(nativeCalls, 7);
  assert.equal(referenceCalls, 7);
  console.log("Native 3D-app-route: 3 staalgevallen, 3 staaflastgevallen en P-Δ geslaagd.");
} finally {
  globalThis.fetch = fetchBefore;
}

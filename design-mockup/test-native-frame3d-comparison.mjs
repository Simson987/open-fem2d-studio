import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildFrame3DSolveRequest } from "./src/components/frame3d/frame3dSolver.ts";
import { deserializeProject } from "./src/io/projectFile.ts";

const suffix = process.platform === "win32" ? ".exe" : "";
const native = fileURLToPath(new URL(`../src-tauri/target/debug/native-frame3d${suffix}`, import.meta.url));
const reference = fileURLToPath(new URL(`../src-tauri/target/debug/frame3d-solver${suffix}`, import.meta.url));
if (!existsSync(native) || !existsSync(reference)) {
  console.log("Vergelijking overgeslagen: bouw native-frame3d en frame3d-solver eerst.");
  process.exit(0);
}

const invoke = (binary, request) => new Promise((resolve, reject) => {
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
  const out = [], err = [];
  const timeout = setTimeout(() => child.kill(), 60_000);
  child.stdout.on("data", (data) => out.push(data));
  child.stderr.on("data", (data) => err.push(data));
  child.on("error", reject);
  child.on("close", (code) => {
    clearTimeout(timeout);
    if (code !== 0) return reject(new Error(`${binary}: ${Buffer.concat(out)} ${Buffer.concat(err)}`));
    try { resolve(JSON.parse(Buffer.concat(out).toString())); }
    catch (error) { reject(error); }
  });
  child.stdin.end(JSON.stringify(request));
});
const close = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${label}: native ${actual}, referentie ${expected}, grens ${tolerance}`,
);
const fixtures = [
  ["stalen-ligger-3d.ifcfem2d", 1],
  ["stalen-ruimteportaal.ifcfem2d", 1],
  ["stalen-ruimteportaal.ifcfem2d", 2],
];
for (const [filename, caseId] of fixtures) {
  const path = fileURLToPath(new URL(`../docs/verificatie/3d-raamwerk/${filename}`, import.meta.url));
  const model = deserializeProject(readFileSync(path, "utf8")).model3d;
  const request = { ...buildFrame3DSolveRequest(model, "linear", caseId), bucklingModes: 0 };
  const [own, external] = await Promise.all([invoke(native, request), invoke(reference, request)]);
  assert.equal(own.nodes.length, external.displacements.length);
  for (const node of own.nodes) {
    const displacement = external.displacements.find((value) => value.nodeId === node.nodeId);
    const reaction = external.reactions.find((value) => value.nodeId === node.nodeId);
    assert.ok(displacement, `referentieknoop ${node.nodeId}`);
    ["ux", "uy", "uz", "rx", "ry", "rz"].forEach((axis, index) =>
      close(node.displacement[index], displacement[axis], 1e-7, `${filename} LC${caseId} knoop ${node.nodeId} ${axis}`));
    if (reaction) ["fx", "fy", "fz", "mx", "my", "mz"].forEach((axis, index) =>
      close(node.reaction[index], reaction[axis], 1e-4, `${filename} LC${caseId} reactie ${node.nodeId} ${axis}`));
  }
  assert.ok(own.equilibriumResidual < 1e-8);
}
console.log("Native 3D-raamwerk: 3 staalgevallen stemmen overeen met Dedaliano (u ≤ 1e-7, R ≤ 1e-4).");

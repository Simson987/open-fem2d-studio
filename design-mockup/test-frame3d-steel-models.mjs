import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildFrame3DSolveRequest, frame3DGlobalForceBalance } from "./src/components/frame3d/frame3dSolver.ts";
import { parseFrame3DModel } from "./src/components/frame3d/frame3dModel.ts";
import { buildFrame3DSteelCheckInputs } from "./src/components/frame3d/frame3dSteelCheck.ts";
import { deserializeProject, serializeProject } from "./src/io/projectFile.ts";

const fixtureDirectory = new URL("../docs/verificatie/3d-raamwerk/", import.meta.url);
const fixed = (nodeId) => ({ nodeId, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true });
const force = (id, nodeId, caseId, fx, fy, fz) => ({ id, nodeId, caseId, fx, fy, fz, mx: 0, my: 0, mz: 0 });
const steel = (id, startNodeId, endNodeId, profileName) => ({
  id, startNodeId, endNodeId, profileName, material: "S235",
});

const beamModel = parseFrame3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 4 },
    { id: 2, x: 2, y: 0, z: 4 },
    { id: 3, x: 4, y: 0, z: 4 },
  ],
  beams: [steel(1, 1, 2, "IPE200"), steel(2, 2, 3, "IPE200")],
  supports: [
    { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: false, rz: false },
    { nodeId: 3, ux: false, uy: true, uz: true, rx: false, ry: false, rz: false },
  ],
  loads: [force(1, 2, 1, 0, 0, -10)],
});

const portalNodes = [
  [0, 0, 0], [6, 0, 0], [0, 4, 0], [6, 4, 0],
  [0, 0, 3.5], [6, 0, 3.5], [0, 4, 3.5], [6, 4, 3.5],
].map(([x, y, z], index) => ({ id: index + 1, x, y, z }));
const portalModel = parseFrame3DModel({
  nodes: portalNodes,
  beams: [
    steel(1, 1, 5, "HEA200"), steel(2, 2, 6, "HEA200"),
    steel(3, 3, 7, "HEA200"), steel(4, 4, 8, "HEA200"),
    steel(5, 5, 6, "IPE200"), steel(6, 7, 8, "IPE200"),
    steel(7, 5, 7, "IPE200"), steel(8, 6, 8, "IPE200"),
  ],
  supports: [1, 2, 3, 4].map(fixed),
  loads: [5, 6, 7, 8].flatMap((nodeId, index) => [
    force(index * 2 + 1, nodeId, 1, 0, 0, -10),
    force(index * 2 + 2, nodeId, 2, 2, 1, 0),
  ]),
});

const cases = [
  {
    filename: "stalen-ligger-3d.ifcfem2d",
    name: "Controle 3D-stalen ligger — middenlast",
    number: "VF-3D-STAAL-01",
    model: beamModel,
    loadCases: [{ id: 1, name: "Middenlast 10 kN", type: "live" }],
  },
  {
    filename: "stalen-ruimteportaal.ifcfem2d",
    name: "Controle 3D-stalen ruimteportaal",
    number: "VF-3D-STAAL-02",
    model: portalModel,
    loadCases: [
      { id: 1, name: "Daklast 4 × 10 kN", type: "dead" },
      { id: 2, name: "Wind X/Y 4 × (2/1) kN", type: "wind" },
    ],
  },
];

for (const testCase of cases) {
  const project = {
    nodes: [], beams: [], supports: [], plates: [], loads: [],
    loadCases: testCase.loadCases,
    activeLoadCaseId: 1,
    selfWeightEnabled: false,
    nonlinearEnabled: false,
    analysetype: "eersteOrde",
    modelDimension: "3d",
    model3d: testCase.model,
    projectInfo: { name: testCase.name, projectNumber: testCase.number },
  };
  const path = fileURLToPath(new URL(testCase.filename, fixtureDirectory));
  if (process.argv.includes("--write-fixtures")) {
    const serialized = JSON.parse(serializeProject(project));
    serialized.savedAt = "2026-09-30T00:00:00.000Z";
    writeFileSync(path, JSON.stringify(serialized, null, 2) + "\n");
  }
  assert.ok(existsSync(path), `${testCase.filename} bestaat`);
  const opened = deserializeProject(readFileSync(path, "utf8"));
  assert.equal(opened.modelDimension, "3d");
  assert.deepEqual(opened.model3d, testCase.model, `${testCase.filename} opent zonder modelverlies`);
  assert.deepEqual(opened.loadCases, testCase.loadCases);
}

const binary = process.env.FRAME3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${process.platform === "win32" ? "frame3d-solver.exe" : "frame3d-solver"}`, import.meta.url));
if (!existsSync(binary)) {
  console.log("Twee 3D-staalprojecten gevalideerd; rekenkern ontbreekt voor numerieke controle.");
  process.exit(0);
}

const invoke = (executable, request) => new Promise((resolve, reject) => {
  const child = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [];
  const errors = [];
  const timeout = setTimeout(() => child.kill(), 120_000);
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => errors.push(chunk));
  child.on("error", reject);
  child.on("close", (code) => {
    clearTimeout(timeout);
    if (code !== 0) return reject(new Error(`${executable} exit ${code}: ${Buffer.concat(output)} ${Buffer.concat(errors)}`));
    try { resolve(JSON.parse(Buffer.concat(output).toString())); }
    catch (error) { reject(error); }
  });
  child.stdin.end(JSON.stringify(request));
});
const solve = async (model, caseId) => {
  const request = { ...buildFrame3DSolveRequest(model, "linear", caseId), bucklingModes: 0 };
  const result = await invoke(binary, request);
  assert.equal(result.equilibrium?.equilibriumOk, true, "interne evenwichtscontrole");
  const balance = frame3DGlobalForceBalance(request, result);
  assert.equal(balance.ok, true, "onafhankelijke kracht- en momentensom");
  assert.ok(result.displacements.every((displacement) =>
    [displacement.ux, displacement.uy, displacement.uz,
      displacement.rx, displacement.ry, displacement.rz].every(Number.isFinite)));
  return { request, result, balance };
};
const near = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${label}: verwacht ${expected}, kreeg ${actual} (grens ${tolerance})`,
);
const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);

const beam = await solve(beamModel, 1);
assert.equal(beam.result.memberForces.length, 2);
near(beam.result.reactions.find((reaction) => reaction.nodeId === 1).fz, 5, 1e-6, "linker liggerreactie");
near(beam.result.reactions.find((reaction) => reaction.nodeId === 3).fz, 5, 1e-6, "rechter liggerreactie");
const eKnPerM2 = beam.request.materials[0].eMpa * 1000;
const iyM4 = beam.request.sections[0].iyM4;
const expectedDeflectionM = -10 * 4 ** 3 / (48 * eKnPerM2 * iyM4);
near(beam.result.displacements.find((displacement) => displacement.nodeId === 2).uz,
  expectedDeflectionM, 1e-8, "Euler-Bernoulli-middendoorbuiging");

const gravity = await solve(portalModel, 1);
assert.equal(gravity.result.memberForces.length, 8);
near(sum(gravity.result.reactions, "fz"), 40, 1e-5, "portaal dakreacties");
for (const reaction of gravity.result.reactions) {
  near(reaction.fz, 10, 1e-5, `symmetrische reactie steun ${reaction.nodeId}`);
}
const wind = await solve(portalModel, 2);
near(sum(wind.result.reactions, "fx"), -8, 1e-5, "portaal windreactie X");
near(sum(wind.result.reactions, "fy"), -4, 1e-5, "portaal windreactie Y");
assert.ok(wind.result.displacements.filter((displacement) => displacement.nodeId >= 5)
  .every((displacement) => displacement.ux > 0 && displacement.uy > 0),
"alle dakknopen wijken met de wind mee in X en Y");

const checkBinary = fileURLToPath(new URL(`../src-tauri/target/debug/${process.platform === "win32" ? "toetsbrug.exe" : "toetsbrug"}`, import.meta.url));
if (existsSync(checkBinary)) {
  const checkSteel = async (model, result, combinations, results, loadCases) => {
    const built = buildFrame3DSteelCheckInputs(model, result, { combinations, results, loadCases });
    assert.equal(built.skipped.length, 0, "alle staalprofielen worden getoetst");
    assert.equal(built.inputs.length, model.beams.length, "iedere staaf heeft toetsinvoer");
    const checks = await invoke(checkBinary, { opdracht: "check_steel_beams", inputs: built.inputs });
    assert.equal(checks.length, model.beams.length, "de EN 1993-kern beoordeelt iedere staaf");
    assert.ok(checks.every((check) => check.status === "Ok"),
      `EN 1993-toets: ${checks.map((check) => `${check.beam_id}: ${check.status} UC ${check.uc_max}`).join(", ")}`);
    return Math.max(...checks.map((check) => check.uc_max));
  };
  const beamUls = await solve(beamModel, new Map([[1, 1.5]]));
  const beamUc = await checkSteel(beamModel, beamUls.result, [
    { id: 10, name: "UGT 1,5 Q", type: "uls", factors: new Map([[1, 1.5]]) },
    { id: 11, name: "BGT Q", type: "sls", factors: new Map([[1, 1]]) },
  ], new Map([[10, beamUls.result], [11, beam.result]]), cases[0].loadCases);
  const portalUls = await solve(portalModel, new Map([[1, 1.35], [2, 1.5]]));
  const portalSls = await solve(portalModel, new Map([[1, 1], [2, 1]]));
  const portalUc = await checkSteel(portalModel, portalUls.result, [
    { id: 20, name: "UGT G + W", type: "uls", factors: new Map([[1, 1.35], [2, 1.5]]) },
    { id: 21, name: "BGT G + W", type: "sls", factors: new Map([[1, 1], [2, 1]]) },
    { id: 22, name: "BGT G", type: "sls", factors: new Map([[1, 1], [2, 0]]) },
  ], new Map([[20, portalUls.result], [21, portalSls.result], [22, gravity.result]]), cases[1].loadCases);
  console.log(`3D-staalmodellen: geometrie, solver, evenwicht en EN 1993 geslaagd (UC ligger ${beamUc.toFixed(3)}, portaal ${portalUc.toFixed(3)})`);
} else {
  console.log("3D-staalmodellen: geometrie, solver en evenwicht geslaagd; toetsbrug ontbreekt voor EN 1993.");
}

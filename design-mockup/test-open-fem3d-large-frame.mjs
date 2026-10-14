import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildOpenFem3DSolveRequest, openFem3DGlobalForceBalance } from "./src/components/openFem3d/openFem3dSolver.ts";
import { parseOpenFem3DModel } from "./src/components/openFem3d/openFem3dModel.ts";
import { deserializeProject, serializeProject } from "./src/io/projectFile.ts";

// Twee bouwlagen, 3 × 3 vakken. Deze grootte activeert ook de 3D-profielinstancing.
const nx = 4, ny = 4, nz = 3;
const nodeId = (ix, iy, iz) => 1 + iz * nx * ny + iy * nx + ix;
const nodes = [];
for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
  nodes.push({ id: nodeId(ix, iy, iz), x: ix * 3, y: iy * 4, z: iz * 3.5 });
}
const beams = [];
const addBeam = (a, b, profileName) => {
  beams.push({ id: beams.length + 1, startNodeId: a, endNodeId: b, profileName, material: "S235" });
};
for (let iz = 0; iz < nz - 1; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
  addBeam(nodeId(ix, iy, iz), nodeId(ix, iy, iz + 1), "HEA 200");
}
for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
  if (ix + 1 < nx) addBeam(nodeId(ix, iy, iz), nodeId(ix + 1, iy, iz), "IPE 200");
  if (iy + 1 < ny) addBeam(nodeId(ix, iy, iz), nodeId(ix, iy + 1, iz), "IPE 200");
}
const supports = nodes.filter((node) => node.z === 0).map((node) => ({
  nodeId: node.id, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true,
}));
const loads = [];
for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
  const id = nodeId(ix, iy, nz - 1);
  loads.push({ id: loads.length + 1, nodeId: id, caseId: 1, fx: 0, fy: 0, fz: -20, mx: 0, my: 0, mz: 0 });
  loads.push({ id: loads.length + 1, nodeId: id, caseId: 2, fx: 2, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 });
}
const memberLoads = beams.filter((beam) => {
  const a = nodes[beam.startNodeId - 1], b = nodes[beam.endNodeId - 1];
  return a.z === 7 && b.z === 7 && a.y === b.y;
}).map((beam, index) => ({
  id: index + 1, beamId: beam.id, caseId: 3,
  qyStart: 0, qyEnd: 0, qzStart: -2, qzEnd: -2,
  startPositionM: 0, endPositionM: 3,
}));
// Een excentrische dwarslast met knoopmomenten en een puntlast op een ligger.
// Dit geval belast ook de tweede horizontale as en de ruimtelijke torsieroute.
for (let ix = 0; ix < nx; ix++) {
  loads.push({
    id: loads.length + 1, nodeId: nodeId(ix, ny - 1, nz - 1), caseId: 4,
    fx: 0, fy: 3, fz: 0, mx: 0, my: 1, mz: 0,
  });
}
const pointLoadBeam = beams.find((beam) => beam.startNodeId === 33 && beam.endNodeId === 34);
assert.ok(pointLoadBeam, "dakligger voor excentrische staafpuntlast");
const memberPointLoads = [{
  id: 1, beamId: pointLoadBeam.id, caseId: 4, py: 0, pz: -5, positionM: 1.5,
}];
const model = parseOpenFem3DModel({ nodes, beams, supports, loads, memberLoads, memberPointLoads });
assert.equal(model.nodes.length, 48);
assert.equal(model.beams.length, 104);
assert.equal(memberLoads.length, 12);
assert.equal(model.loads.length, 36);
assert.equal(model.memberPointLoads.length, 1);

const fixturePath = fileURLToPath(new URL("../docs/verificatie/3d-raamwerk/groot-staalraam.ifcfem", import.meta.url));
const project = {
  nodes: [], beams: [], supports: [], plates: [], loads: [],
  loadCases: [
    { id: 1, name: "Daklast", type: "dead" },
    { id: 2, name: "Horizontale belasting", type: "wind" },
    { id: 3, name: "Liggerlast", type: "live" },
    { id: 4, name: "Excentrisch Y en staafpuntlast", type: "wind" },
  ],
  activeLoadCaseId: 1, selfWeightEnabled: false, nonlinearEnabled: true,
  analysetype: "tweedeOrdeGeometrisch", modelDimension: "3d", model3d: model,
  projectInfo: { name: "Verificatie groot 3D staalraam", projectNumber: "VF-3D-GROOT-01" },
};
if (process.argv.includes("--write-fixture")) {
  writeFileSync(fixturePath, serializeProject(project));
}
assert.ok(existsSync(fixturePath), "het GUI-verificatieproject moet aanwezig zijn");
const opened = deserializeProject(readFileSync(fixturePath, "utf8"));
assert.deepEqual(opened.model3d, model, "het project bewaart alle 3D-knopen, staven en belastingen");

const xBeam = model.beams.find((beam) => beam.startNodeId === 33 && beam.endNodeId === 34);
assert.ok(xBeam, "een horizontale ligger voor de lokale-asproef");
const localForceInput = {
  ...buildOpenFem3DSolveRequest(model, "linear", 1), nodalLoads: [],
  memberLoads: [{ id: 1, memberId: xBeam.id, qyStartKnPerM: 1, qyEndKnPerM: 3,
    qzStartKnPerM: 0, qzEndKnPerM: 0, startPositionM: 0, endPositionM: 3 }],
  memberPointLoads: [{ id: 1, memberId: xBeam.id, pyKn: 0, pzKn: -5, positionM: 1.5 }],
};
const localBalance = openFem3DGlobalForceBalance(localForceInput, { reactions: [] });
assert.deepEqual(localBalance.imbalanceKn,
  [0, 6, -5], "een lineair variërende qy en een lokale pz-puntlast tellen in globale assen op");
assert.deepEqual(localBalance.momentImbalanceKnm,
  [-42, 7.5, 10.5], "dezelfde lasten hebben hun exacte hefboomarm om de globale oorsprong");
const momentOnlyMismatch = openFem3DGlobalForceBalance({
  ...localForceInput,
  nodalLoads: [{ id: 1, nodeId: xBeam.endNodeId, fx: 0, fy: 0, fz: -10, mx: 0, my: 0, mz: 0 }],
  memberLoads: [], memberPointLoads: [],
}, { reactions: [{ nodeId: xBeam.startNodeId, fx: 0, fy: 0, fz: 10, mx: 0, my: 0, mz: 0 }] });
assert.deepEqual(momentOnlyMismatch.imbalanceKn, [0, 0, 0]);
assert.equal(momentOnlyMismatch.momentImbalanceKnm[1], 30);
assert.equal(momentOnlyMismatch.ok, false, "een sluitende krachtensom mag een fout moment niet verhullen");

const solverBinary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${solverBinary}`, import.meta.url));
// Zonder kern is de numerieke verificatie niet gedaan: een fout, geen stille
// geslaagde test (zoals in de andere 3D-tests).
assert.ok(existsSync(solverPath), `Bouw eerst de Rust-rekenkern (${solverPath}) of zet OPEN_FEM_3D_SOLVER_PATH.`);
const invokeSolver = (request) => new Promise((resolve, reject) => {
  const child = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  const stdout = [], stderr = [];
  let size = 0;
  const timeout = setTimeout(() => child.kill(), 120_000);
  child.stdout.on("data", (chunk) => {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) child.kill();
    else stdout.push(chunk);
  });
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.on("error", reject);
  child.on("close", (code) => {
    clearTimeout(timeout);
    if (code !== 0) return reject(new Error(`3D-kern: exit ${code}; ${Buffer.concat(stderr).toString()}`));
    try { resolve(JSON.parse(Buffer.concat(stdout).toString())); }
    catch (error) { reject(error); }
  });
  child.stdin.on("error", reject);
  child.stdin.end(JSON.stringify(request));
});
const solve = async (analysis, factors) => {
  const request = { ...buildOpenFem3DSolveRequest(model, analysis, factors), bucklingModes: 0 };
  if (process.argv.includes("--progress")) console.error(`Rekenen: ${analysis}, ${typeof factors === "number" ? factors : "combinatie"}`);
  const started = performance.now();
  const result = await invokeSolver(request);
  return { result, elapsedMs: performance.now() - started, balance: openFem3DGlobalForceBalance(request, result) };
};
const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);
const close = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${label}: verwacht ${expected}, berekend ${actual}, grens ${tolerance}`,
);
const check = (result, forces, moments, label) => {
  assert.equal(result.displacements.length, 48, `${label}: alle knoopverplaatsingen`);
  assert.equal(result.memberForces.length, 104, `${label}: alle staafkrachten`);
  assert.ok(result.displacements.every((d) =>
    [d.ux, d.uy, d.uz, d.rx, d.ry, d.rz].every(Number.isFinite)), `${label}: eindige verplaatsingen`);
  if (result.equilibrium) assert.equal(result.equilibrium.equilibriumOk, true, `${label}: interne evenwichtscontrole`);
  for (const [axis, force] of Object.entries(forces)) {
    close(sum(result.reactions, axis), force, 1e-4, `${label}: som reactie ${axis}`);
  }
  for (const [axis, moment] of Object.entries(moments)) {
    const lever = result.reactions.reduce((total, reaction) => {
      const node = nodes[reaction.nodeId - 1];
      if (axis === "mx") return total + node.y * reaction.fz - node.z * reaction.fy;
      if (axis === "my") return total + node.z * reaction.fx - node.x * reaction.fz;
      return total + node.x * reaction.fy - node.y * reaction.fx;
    }, 0);
    close(sum(result.reactions, axis) + lever, moment, 1e-3, `${label}: moment ${axis} over oorsprong`);
  }
};

const gravity = await solve("linear", 1);
check(gravity.result, { fx: 0, fy: 0, fz: 320 }, { mx: 1920, my: -1440, mz: 0 }, "daklast");
assert.equal(gravity.balance.ok, true, "de onafhankelijke krachtensom sluit bij daklast");
assert.ok(gravity.balance.maxMomentImbalanceKnm < 1e-3, "ook het globale moment sluit bij daklast");
for (const reaction of gravity.result.reactions) {
  close(reaction.fz, 20, 1e-5, `symmetrische verticale reactie steun ${reaction.nodeId}`);
}
const lateral = await solve("linear", 2);
check(lateral.result, { fx: -32, fy: 0, fz: 0 }, { mx: 0, my: -224, mz: 192 }, "horizontaal");
assert.equal(lateral.balance.ok, true, "de onafhankelijke krachtensom sluit bij horizontale last");
assert.ok(lateral.balance.maxMomentImbalanceKnm < 1e-3, "ook het globale moment sluit bij horizontale last");
const distributed = await solve("linear", 3);
check(distributed.result, { fx: 0, fy: 0, fz: 72 }, { mx: 432, my: -324, mz: 0 }, "verdeelde liggerlast");
assert.equal(distributed.balance.ok, true, "ook de lokale lijnlast sluit na omrekening naar globale assen");
assert.ok(distributed.balance.maxMomentImbalanceKnm < 1e-3, "de lijnlast gebruikt zijn exacte aangrijpingspunt");
const eccentric = await solve("linear", 4);
check(eccentric.result, { fx: 0, fy: -12, fz: 5 },
  { mx: 84, my: -11.5, mz: -54 }, "excentrische Y-last, knoopmomenten en staafpuntlast");
assert.equal(eccentric.balance.ok, true, "ook de excentrische belasting sluit in alle globale assen");
assert.ok(eccentric.balance.maxMomentImbalanceKnm < 1e-3,
  "de excentrische knoopmomenten en de staafpuntlast hebben hun juiste hefboomarm");
const allLinear = await solve("linear", new Map([[1, 1], [2, 1], [3, 1]]));
check(allLinear.result, { fx: -32, fy: 0, fz: 392 },
  { mx: 2352, my: -1988, mz: 192 }, "lineaire combinatie van drie belastinggevallen");
assert.equal(allLinear.balance.ok, true, "ook het gecombineerde lineaire evenwicht sluit");
for (const [index, response] of allLinear.result.displacements.entries()) {
  const cases = [gravity, lateral, distributed].map(({ result }) => result.displacements[index]);
  assert.equal(response.nodeId, cases[0].nodeId);
  for (const axis of ["ux", "uy", "uz", "rx", "ry", "rz"]) {
    close(response[axis], cases.reduce((value, item) => value + item[axis], 0), 1e-8,
      `lineaire superpositie knoop ${response.nodeId}, ${axis}`);
  }
}
for (const [index, response] of allLinear.result.reactions.entries()) {
  const cases = [gravity, lateral, distributed].map(({ result }) => result.reactions[index]);
  assert.equal(response.nodeId, cases[0].nodeId);
  for (const axis of ["fx", "fy", "fz", "mx", "my", "mz"]) {
    close(response[axis], cases.reduce((value, item) => value + item[axis], 0), 1e-5,
      `lineaire superpositie reactie steun ${response.nodeId}, ${axis}`);
  }
}
const allFour = await solve("linear", new Map([[1, 1], [2, 1], [3, 1], [4, 1]]));
check(allFour.result, { fx: -32, fy: -12, fz: 397 },
  { mx: 2436, my: -1999.5, mz: 138 }, "combinatie van vier ruimtelijke belastinggevallen");
assert.equal(allFour.balance.ok, true, "de volledige ruimtelijke combinatie sluit");
for (const [index, response] of allFour.result.displacements.entries()) {
  const cases = [gravity, lateral, distributed, eccentric].map(({ result }) => result.displacements[index]);
  assert.equal(response.nodeId, cases[0].nodeId);
  for (const axis of ["ux", "uy", "uz", "rx", "ry", "rz"]) {
    close(response[axis], cases.reduce((value, item) => value + item[axis], 0), 1e-8,
      `vierweg superpositie knoop ${response.nodeId}, ${axis}`);
  }
}
for (const [index, response] of allFour.result.memberForces.entries()) {
  const cases = [gravity, lateral, distributed, eccentric].map(({ result }) => result.memberForces[index]);
  assert.equal(response.memberId, cases[0].memberId);
  for (const axis of ["nStartKn", "nEndKn", "vyStartKn", "vyEndKn", "vzStartKn", "vzEndKn",
    "torsionStartKnm", "torsionEndKnm", "myStartKnm", "myEndKnm", "mzStartKnm", "mzEndKnm"]) {
    close(response[axis], cases.reduce((value, item) => value + item[axis], 0), 1e-5,
      `vierweg superpositie staaf ${response.memberId}, ${axis}`);
  }
}
const combined = await solve("p-delta", new Map([[1, 1], [2, 1]]));
assert.equal(combined.result.displacements.length, 48);
assert.equal(combined.result.memberForces.length, 104);
assert.ok(combined.result.displacements.every((d) =>
  [d.ux, d.uy, d.uz, d.rx, d.ry, d.rz].every(Number.isFinite)));
assert.equal(combined.result.secondOrder?.converged, true, "tweede-orde-iteraties convergeren");
assert.equal(combined.result.secondOrder?.stable, true, "grote raamwerk blijft stabiel onder de gekozen lasten");
// Tweede orde (#60): K_G voert bij een starre translatie geen kracht af, dus de
// reactiesom is exact die van de lasten, (−32, 0, +320) kN zoals bij daklast en
// horizontale last samen. De momentensom om de oorsprong in de onvervormde
// stand wijkt precies het tweede-ordemoment Σ N·(e_x × Δu) af; de
// onafhankelijke balans van de app trekt dat af en moet dan sluiten.
for (const [axis, force] of Object.entries({ fx: -32, fy: 0, fz: 320 })) {
  close(sum(combined.result.reactions, axis), force, 1e-4, `tweede orde: som reactie ${axis}`);
}
assert.ok(combined.balance.secondOrderMomentKnm, "de balans rekent bij P-Δ met het tweede-ordemoment");
assert.equal(combined.balance.ok, true,
  `tweede orde: de onafhankelijke kracht- en momentbalans sluit (ΔF ${combined.balance.maxImbalanceKn} kN, `
  + `ΔM ${combined.balance.maxMomentImbalanceKnm} kNm)`);
const secondOrderForceImbalanceKn = Object.fromEntries(
  ["fx", "fy", "fz"].map((axis, index) => [axis, combined.balance.imbalanceKn[index]]));
const secondOrderMomentImbalanceKnm = Object.fromEntries(
  ["mx", "my", "mz"].map((axis, index) => [axis, combined.balance.momentImbalanceKnm[index]]));

console.log(JSON.stringify({
  model: { nodes: 48, beams: 104, supports: 16, nodalLoads: 36, memberLoads: 12, memberPointLoads: 1 },
  cases: [gravity, lateral, distributed, eccentric, allLinear, allFour, combined].map(({ result, elapsedMs }, index) => ({
    name: ["daklast", "horizontaal", "liggerlast", "excentrisch", "combinatie lineair",
      "combinatie 4 gevallen", "combinatie tweede orde"][index],
    elapsedMs: +elapsedMs.toFixed(1),
    relativeResidual: result.equilibrium?.relativeResidual,
    secondOrder: result.secondOrder,
  })),
  secondOrderForceImbalanceKn,
  secondOrderMomentImbalanceKnm,
  secondOrderMomentKnm: combined.balance.secondOrderMomentKnm,
  secondOrderForceBalanceOk: combined.balance.ok,
}, null, 2));

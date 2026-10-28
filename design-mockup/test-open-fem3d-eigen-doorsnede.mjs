// Issue #65: bewaarde eigen doorsneden in het 3D-verzoek en Timoshenko in de kern.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { eigenDoorsnedenStore } = await import("./src/lib/profieleditor/eigenDoorsnedenStore.ts");
const { parseOpenFem3DModel, updateOpenFem3DBeam } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { buildOpenFem3DSolveRequest } = await import("./src/components/openFem3d/openFem3dSolver.ts");
const { openFem3DMemberDisplacementStations } = await import("./src/components/openFem3d/openFem3dDisplacement.ts");
const original = eigenDoorsnedenStore.getState().items;
const props = {
  area_mm2: 90_000, iy_mm4: 675_000_000, iz_mm4: 675_000_000,
  iyz_mm4: 0, it_mm4: 1_100_000_000, av_y_mm2: 75_000, av_z_mm2: 75_000,
};
const custom = {
  id: "eigen-3d-proef", naam: "Eigen 300", eigenschappen: props,
  ontwerp: {}, vorm: "Rechthoek", motor: {}, berekendOp: "2026-10-08T00:00:00Z",
};
eigenDoorsnedenStore.getState().bewaar(custom);

const free = { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };
const model = parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 1, y: 0, z: 0 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, material: "S235", profileName: "EIGEN:Eigen 300" }],
  supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
  loads: [{ id: 1, nodeId: 2, caseId: 1, fx: 0, fy: 0, fz: -100, mx: 0, my: 0, mz: 0 }],
});

try {
  const bernoulli = buildOpenFem3DSolveRequest(model, "linear", 1);
  assert.equal(bernoulli.sections[0].areaM2, 0.09);
  assert.equal(bernoulli.sections[0].iyM4, 0.000675);
  assert.equal(bernoulli.sections[0].izM4, 0.000675);
  assert.equal(bernoulli.sections[0].torsionJM4, 0.0011);
  assert.equal(bernoulli.sections[0].shearAreaYM2, undefined);

  const withShear = updateOpenFem3DBeam(model, 1, { shearDeformation: true });
  assert.equal(parseOpenFem3DModel(JSON.parse(JSON.stringify(withShear))).beams[0].shearDeformation, true);
  const timoshenko = buildOpenFem3DSolveRequest(withShear, "linear", 1);
  assert.equal(timoshenko.sections[0].shearAreaYM2, 0.075);
  assert.equal(timoshenko.sections[0].shearAreaZM2, 0.075);
  const asProfile = (profileName, material = "S235") => buildOpenFem3DSolveRequest({
    ...withShear, beams: [{ ...withShear.beams[0], profileName, material }],
  }, "linear", 1).sections[0];
  const catalog = asProfile("IPE 300");
  assert.ok(catalog.shearAreaYM2 > 0 && catalog.shearAreaZM2 > 0);
  const rectangle = asProfile("300x300", "C30/37");
  assert.equal(rectangle.shearAreaYM2, 0.075);
  assert.equal(rectangle.shearAreaZM2, 0.075);
  assert.equal(buildOpenFem3DSolveRequest(updateOpenFem3DBeam(withShear, 1, { shearDeformation: false }), "linear", 1)
    .sections[0].shearAreaZM2, undefined);
  assert.throws(() => parseOpenFem3DModel({ ...model, beams: [{ ...model.beams[0], shearDeformation: "ja" }] }),
    /ongeldige waarde voor afschuifvervorming/);

  const twin = buildOpenFem3DSolveRequest({
    ...model, nodes: [...model.nodes, { id: 3, x: 2, y: 0, z: 0 }],
    beams: [...model.beams, { ...model.beams[0], id: 2, startNodeId: 2, endNodeId: 3, shearDeformation: true }],
  }, "linear", 1);
  assert.equal(twin.sections.length, 2, "Bernoulli en Timoshenko delen geen sectie-id");

  const kern = process.env.OPEN_FEM_3D_SOLVER_PATH
    ?? fileURLToPath(new URL(`../src-tauri/target/debug/open-fem-3d${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
  assert.ok(existsSync(kern), `3D-kern ontbreekt: ${kern}`);
  const solve = (request) => {
    const run = spawnSync(kern, [], { input: JSON.stringify({ ...request, bucklingModes: 0 }) });
    assert.equal(run.status, 0, run.stderr.toString());
    return JSON.parse(run.stdout.toString());
  };
  const uz0 = solve(bernoulli).displacements.find((d) => d.nodeId === 2).uz;
  const uz1 = solve(timoshenko).displacements.find((d) => d.nodeId === 2).uz;
  const expectedBending = -100 / (3 * 210_000_000 * 0.000675);
  const expectedShear = -100 / ((210_000_000 / (2 * (1 + 0.3))) * 0.075);
  assert.ok(Math.abs(uz0 - expectedBending) < 1e-7, `Euler–Bernoulli: ${uz0} tegen ${expectedBending}`);
  assert.ok(Math.abs((uz1 - uz0) - expectedShear) < 1e-7,
    `Timoshenko-extra: ${uz1 - uz0} tegen ${expectedShear}`);
  const uniformModel = { ...withShear, loads: [], memberLoads: [{
    id: 1, beamId: 1, caseId: 1, qyStart: 0, qyEnd: 0,
    qzStart: -100, qzEnd: -100, startPositionM: 0, endPositionM: 1,
  }] };
  const uniformResult = solve(buildOpenFem3DSolveRequest(uniformModel, "linear", 1));
  const mid = openFem3DMemberDisplacementStations(uniformModel, uniformModel.beams[0], uniformResult, 20)[10];
  const x = 0.5, l = 1, e = 210_000_000, g = e / (2 * (1 + 0.3));
  const expectedField = -100 * x ** 2 * (6 * l ** 2 - 4 * l * x + x ** 2) / (24 * e * 0.000675)
    - 100 * (l * x - x ** 2 / 2) / (g * 0.075);
  assert.ok(Math.abs(mid.uz - expectedField) < 1e-7,
    `Timoshenko-veldverplaatsing: ${mid.uz} tegen ${expectedField}`);

  eigenDoorsnedenStore.getState().bewaar({ ...custom, eigenschappen: { ...props, iyz_mm4: 100_000 } });
  assert.throws(() => buildOpenFem3DSolveRequest(model, "linear", 1), /geen geldige hoofdassen/);
  eigenDoorsnedenStore.getState().bewaar({ ...custom, eigenschappen: { ...props, av_z_mm2: 0 } });
  assert.throws(() => buildOpenFem3DSolveRequest(withShear, "linear", 1), /geen geldige afschuifoppervlakken/);
  console.log("Eigen doorsnede, sectiekeuze en analytische Timoshenko-zakking: geslaagd.");
} finally {
  eigenDoorsnedenStore.getState().vervangAlles(original);
}

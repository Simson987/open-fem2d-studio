// Issue #65: een eigen doorsnede met Iyz ≠ 0 rekent om de hoofdassen, terwijl
// de lokale invoer en de getoonde staafresultaten in de invoerassen blijven.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const { eigenDoorsnedenStore } = await import("./src/lib/profieleditor/eigenDoorsnedenStore.ts");
const { openFem3DMemberAxes, parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { buildOpenFem3DSolveRequest, solveOpenFem3D } = await import("./src/components/openFem3d/openFem3dSolver.ts");
const { openFem3DMemberDisplacementStations } = await import("./src/components/openFem3d/openFem3dDisplacement.ts");
const { toOpenFem3DPrincipal, fromOpenFem3DPrincipal } = await import("./src/components/openFem3d/openFem3dPrincipalAxes.ts");

const original = eigenDoorsnedenStore.getState().items;
const iy = 675_000_000, iz = 300_000_000, iyz = 150_000_000;
const middle = (iy + iz) / 2, radius = Math.hypot((iy - iz) / 2, iyz);
const alpha = 0.5 * Math.atan2(-2 * iyz, iy - iz);
const props = {
  area_mm2: 90_000, iy_mm4: iy, iz_mm4: iz, iyz_mm4: iyz,
  iu_mm4: middle + radius, iv_mm4: middle - radius, alpha_hoofdas_rad: alpha,
  it_mm4: 1_100_000_000, av_y_mm2: 75_000, av_z_mm2: 75_000,
};
const custom = { id: "gedraaide-3d-proef", naam: "Scheve proef", eigenschappen: props,
  ontwerp: {}, vorm: "Rechthoek", motor: { av_hoofdas_bepaald: false }, berekendOp: "2026-10-08T00:00:00Z" };
eigenDoorsnedenStore.getState().bewaar(custom);
const free = { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };
const model = parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 2, y: 0, z: 0 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, material: "S235", profileName: "EIGEN:Scheve proef" }],
  supports: [{ nodeId: 1, ...free, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
  loads: [{ id: 1, nodeId: 2, caseId: 1, fx: 0, fy: 7, fz: -100, mx: 0, my: 0, mz: 0 }],
});

try {
  const request = buildOpenFem3DSolveRequest(model, "linear", 1);
  assert.ok(Math.abs(request.members[0].rollAngleRad - alpha) < 1e-12);
  assert.ok(Math.abs(request.sections[0].iyM4 - props.iu_mm4 * 1e-12) < 1e-15);
  assert.ok(Math.abs(request.sections[0].izM4 - props.iv_mm4 * 1e-12) < 1e-15);

  const loads = buildOpenFem3DSolveRequest({
    ...model,
    memberLoads: [{ id: 1, beamId: 1, caseId: 1, qyStart: 2, qyEnd: 4,
      qzStart: -3, qzEnd: -5, startPositionM: 0, endPositionM: 2 }],
    memberPointLoads: [{ id: 1, beamId: 1, caseId: 1, py: 6, pz: -8, positionM: 1 }],
    thermalLoads: [{ id: 1, beamId: 1, caseId: 1, deltaTUniformK: 5,
      deltaTGradientYK: 2, deltaTGradientZK: -3 }],
  }, "linear", 1);
  const closePair = (actual, expected) => actual.every((x, i) => Math.abs(x - expected[i]) < 1e-12);
  assert.ok(closePair([loads.memberLoads[0].qyStartKnPerM, loads.memberLoads[0].qzStartKnPerM],
    toOpenFem3DPrincipal(2, -3, alpha)));
  assert.ok(closePair([loads.memberPointLoads[0].pyKn, loads.memberPointLoads[0].pzKn],
    toOpenFem3DPrincipal(6, -8, alpha)));
  assert.ok(closePair([loads.thermalLoads[0].deltaTGradientYK, loads.thermalLoads[0].deltaTGradientZK],
    toOpenFem3DPrincipal(2, -3, alpha)));

  const kern = process.env.OPEN_FEM_3D_SOLVER_PATH
    ?? fileURLToPath(new URL(`../src-tauri/target/debug/open-fem-3d${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const input = JSON.parse(options.body);
    const run = spawnSync(kern, [], { input: JSON.stringify(input) });
    assert.equal(run.status, 0, run.stderr.toString());
    return { ok: true, json: async () => JSON.parse(run.stdout.toString()) };
  };
  let result, localResult, globalResult, rolledResult;
  try {
    result = await solveOpenFem3D(model, 1, "linear");
    const withoutNodal = { ...model, loads: [] };
    localResult = await solveOpenFem3D({ ...withoutNodal, memberLoads: [{
      id: 1, beamId: 1, caseId: 1, qyStart: 2, qyEnd: 2,
      qzStart: -3, qzEnd: -3, startPositionM: 0, endPositionM: 2,
    }] }, 1, "linear");
    globalResult = await solveOpenFem3D({ ...withoutNodal, memberLoads: [
      { id: 1, beamId: 1, caseId: 1, globalDirection: "y", qStart: 2, qEnd: 2, startPositionM: 0, endPositionM: 2 },
      { id: 2, beamId: 1, caseId: 1, globalDirection: "z", qStart: -3, qEnd: -3, startPositionM: 0, endPositionM: 2 },
    ] }, 1, "linear");
    rolledResult = await solveOpenFem3D({
      ...model, beams: [{ ...model.beams[0], rollAngleRad: 0.37 }],
    }, 1, "linear");
  }
  finally { globalThis.fetch = oldFetch; }
  const displacement = result.displacements.find((d) => d.nodeId === 2);
  const [fu, fv] = toOpenFem3DPrincipal(7, -100, alpha);
  const l = 2, e = 210_000_000;
  const [expectedY, expectedZ] = fromOpenFem3DPrincipal(
    fu * l ** 3 / (3 * e * props.iv_mm4 * 1e-12),
    fv * l ** 3 / (3 * e * props.iu_mm4 * 1e-12), alpha,
  );
  assert.ok(Math.abs(displacement.uy - expectedY) < 1e-7,
    `y-zakking: ${displacement.uy} tegen ${expectedY}`);
  assert.ok(Math.abs(displacement.uz - expectedZ) < 1e-7,
    `z-zakking: ${displacement.uz} tegen ${expectedZ}`);
  const axes = openFem3DMemberAxes(model.nodes[0], model.nodes[1], 0.37);
  const [fuRol, fvRol] = toOpenFem3DPrincipal(
    7 * axes.ey[1] - 100 * axes.ey[2],
    7 * axes.ez[1] - 100 * axes.ez[2], alpha,
  );
  const [duRol, dvRol] = fromOpenFem3DPrincipal(
    fuRol * l ** 3 / (3 * e * props.iv_mm4 * 1e-12),
    fvRol * l ** 3 / (3 * e * props.iu_mm4 * 1e-12), alpha,
  );
  const rolledTip = rolledResult.displacements.find((d) => d.nodeId === 2);
  assert.ok(Math.abs(rolledTip.uy - (duRol * axes.ey[1] + dvRol * axes.ez[1])) < 1e-7);
  assert.ok(Math.abs(rolledTip.uz - (duRol * axes.ey[2] + dvRol * axes.ez[2])) < 1e-7);
  assert.ok(result.memberForces.some((f) => f.memberId === 1));
  assert.ok(result.diagrams.momentY[0].points.length > 2);
  assert.ok(result.diagnostics.some((message) => message.includes("hoofdassen u/v")));
  assert.deepEqual(result.principalAxesMemberIds, [1]);
  const localTip = localResult.displacements.find((d) => d.nodeId === 2);
  const globalTip = globalResult.displacements.find((d) => d.nodeId === 2);
  assert.ok(Math.abs(localTip.uy - globalTip.uy) < 1e-8 && Math.abs(localTip.uz - globalTip.uz) < 1e-8,
    "lokale qy/qz en dezelfde globale Y/Z-lasten geven dezelfde zakking");
  for (const key of ["vyStartKn", "vzStartKn", "myStartKnm", "mzStartKnm"]) {
    assert.ok(Math.abs(localResult.memberForces[0][key] - globalResult.memberForces[0][key]) < 1e-7,
      `${key} moet na terugdraaien overeenkomen`);
  }
  for (const key of ["momentY", "momentZ", "shearY", "shearZ"]) {
    const localPoints = localResult.diagrams[key][0].points;
    const globalPoints = globalResult.diagrams[key][0].points;
    assert.equal(localPoints.length, globalPoints.length);
    assert.ok(localPoints.every((point, i) => Math.abs(point.value - globalPoints[i].value) < 1e-6),
      `${key}: lokale en globale last geven dezelfde lijn na terugdraaien`);
  }
  const [qu, qv] = toOpenFem3DPrincipal(2, -3, alpha);
  const x = l / 2;
  const uniformFactor = x ** 2 * (6 * l ** 2 - 4 * l * x + x ** 2) / (24 * e);
  const [expectedFieldY, expectedFieldZ] = fromOpenFem3DPrincipal(
    qu * uniformFactor / (props.iv_mm4 * 1e-12),
    qv * uniformFactor / (props.iu_mm4 * 1e-12), alpha,
  );
  const mid = openFem3DMemberDisplacementStations(model, model.beams[0], localResult, 20)[10];
  assert.ok(Math.abs(mid.uy - expectedFieldY) < 1e-7,
    `veldverplaatsing y: ${mid.uy} tegen ${expectedFieldY}`);
  assert.ok(Math.abs(mid.uz - expectedFieldZ) < 1e-7,
    `veldverplaatsing z: ${mid.uz} tegen ${expectedFieldZ}`);

  assert.throws(() => buildOpenFem3DSolveRequest({
    ...model, beams: [{ ...model.beams[0], releases: { myStart: true } }],
  }, "linear", 1), /enkel My- of Mz-scharnier/);
  assert.throws(() => buildOpenFem3DSolveRequest({
    ...model, beams: [{ ...model.beams[0], shearDeformation: true }],
  }, "linear", 1), /Av;u en Av;v/);
  eigenDoorsnedenStore.getState().bewaar({ ...custom, eigenschappen: { ...props, iu_mm4: props.iu_mm4 * 1.1 } });
  assert.throws(() => buildOpenFem3DSolveRequest(model, "linear", 1), /niet bij Iy, Iz en Iyz passen/);
  console.log("Gedraaide hoofdassen: verzoek, lokale lasten en analytische 3D-zakking geslaagd.");
} finally {
  eigenDoorsnedenStore.getState().vervangAlles(original);
}

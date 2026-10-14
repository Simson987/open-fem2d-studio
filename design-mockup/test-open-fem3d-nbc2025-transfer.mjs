import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nbc2025HorizontalWindActions } from "./src/lib/wind/nbc2025PartialWind.ts";
import { nbc2025CombinationPlan } from "./src/lib/wind/nbc2025Combinations.ts";
import { generateNbc2025EnvelopeWindLoadsForLimitStates,
  nbc2025ProjectedHorizontalResultants } from "./src/components/openFem3d/openFem3dNbc2025Wind.ts";
import { nbc2025TransferPartialWind } from "./src/components/openFem3d/openFem3dNbc2025Transfer.ts";
import { nbc2025ModelLoadPlan } from "./src/components/openFem3d/openFem3dNbc2025ModelPlan.ts";
import { parseOpenFem3DModel } from "./src/components/openFem3d/openFem3dModel.ts";
import { buildOpenFem3DSolveRequest } from "./src/components/openFem3d/openFem3dSolver.ts";

const geometry = {
  widthXM: 20, widthYM: 10, heightM: 5,
  naturalFrequencyHz: 1.2, naturalFrequencySource: "modal analysis",
  noWakeOrChannelling: true,
  referencePressureKPa: 0.5, referencePressureSource: "project q1/500",
  importanceCategory: "normal", terrain: "open",
  topographicFactor: 1, topographicFactorSource: "level site",
  internalPressureCoefficientMin: -0.3, internalPressureCoefficientMax: 0.2,
  internalCoefficientSource: "verified openings",
};
const model = {
  nodes: [
    [0, 0, 0], [20, 0, 0], [20, 10, 0], [0, 10, 0],
    [0, 0, 5], [20, 0, 5], [20, 10, 5], [0, 10, 5],
  ].map(([x, y, z], index) => ({ id: index + 1, x, y, z })),
  beams: [1, 2, 3, 4].map((id) => ({ id, startNodeId: id, endNodeId: id + 4,
    profileName: "IPE 300", material: "S235" })),
  supports: [1, 2, 3, 4].map((nodeId) => ({ nodeId,
    ux: true, uy: true, uz: true, rx: true, ry: true, rz: true })),
  diaphragms: [{ id: 1, nodeIds: [5, 6, 7, 8] }],
  envelopePanels: [
    { id: 1, type: "facade", nodeIds: [1, 5, 8, 4], distribution: "twoWay" },
    { id: 2, type: "facade", nodeIds: [2, 3, 7, 6], distribution: "twoWay" },
    { id: 3, type: "facade", nodeIds: [2, 6, 5, 1], distribution: "twoWay" },
    { id: 4, type: "facade", nodeIds: [4, 8, 7, 3], distribution: "twoWay" },
    { id: 5, type: "roof", nodeIds: [5, 6, 7, 8], distribution: "twoWay" },
  ],
};
const wind = generateNbc2025EnvelopeWindLoadsForLimitStates(model, geometry);
const projected = nbc2025ProjectedHorizontalResultants(model, wind);
const actions = ["uls", "sls"].flatMap((limitState) => {
  const cases = wind.cases.filter((item) => item.limitState === limitState);
  return nbc2025HorizontalWindActions(cases, geometry.widthXM, geometry.widthYM,
    new Map(cases.map((item) => [item.key, projected.get(item.key)])));
});
const levels = [
  { kind: "supported-base", nodeIds: [1, 2, 3, 4], source: "foundation tie and supports" },
  { kind: "diaphragm", nodeIds: [5, 6, 7, 8], source: "roof deck diaphragm design" },
];
const transferred = nbc2025TransferPartialWind(model, wind, actions, levels);
assert.equal(transferred.length, 112);
assert.equal(new Set(transferred.map((item) => item.key)).size, 112);
assert.ok(transferred.every((item) => item.loads.length > 0
  && item.loads.every((load) => load.fz === 0 && load.mx === 0 && load.my === 0 && load.mz === 0)));
const eccentricX = transferred.find((item) => item.action.pattern === "b"
  && item.action.limitState === "uls"
  && item.action.pressureCaseKeys[0].includes(":+X:")
  && item.action.internalPressureCoefficient === -0.3);
const baseFx = eccentricX.loads.filter((load) => load.nodeId <= 4)
  .reduce((sum, load) => sum + load.fx, 0);
const roofFx = eccentricX.loads.filter((load) => load.nodeId >= 5)
  .reduce((sum, load) => sum + load.fx, 0);
assert.ok(Math.abs(baseFx - roofFx) < 1e-8, "gelijkmatige geveldruk gaat half naar basis en dak");
assert.ok(Math.abs(baseFx + roofFx - eccentricX.action.fxKn) < 1e-8);
const opened = { ...model,
  nodes: [...model.nodes, ...[[0, 2, 1], [0, 2, 2], [0, 3, 2], [0, 3, 1]]
    .map(([x, y, z], index) => ({ id: index + 9, x, y, z }))],
  envelopePanels: model.envelopePanels.map((panel) => panel.id === 1
    ? { ...panel, openings: [{ id: 1, nodeIds: [9, 10, 11, 12] }] } : panel),
};
const openedWind = generateNbc2025EnvelopeWindLoadsForLimitStates(opened, geometry);
const openedProjected = nbc2025ProjectedHorizontalResultants(opened, openedWind);
const openedActions = ["uls", "sls"].flatMap((limitState) => {
  const cases = openedWind.cases.filter((item) => item.limitState === limitState);
  return nbc2025HorizontalWindActions(cases, geometry.widthXM, geometry.widthYM,
    new Map(cases.map((item) => [item.key, openedProjected.get(item.key)])));
});
assert.ok(openedActions.some((item) => item.pattern === "a" && Math.abs(item.mzKnM) > 1e-3));
assert.equal(nbc2025TransferPartialWind(opened, openedWind, openedActions, levels).length, 112);
assert.throws(() => nbc2025TransferPartialWind({ ...model, diaphragms: [] }, wind, actions, levels), /starre schijf/);
assert.throws(() => nbc2025TransferPartialWind({ ...model, supports: [] }, wind, actions, levels), /opleggingen/);
assert.throws(() => nbc2025TransferPartialWind({ ...model, supports: model.supports.map((support) =>
  support.nodeId === 1 ? { ...support, ux: false, uy: false } : support) }, wind, actions, levels),
/horizontale oplegging/);
assert.throws(() => nbc2025TransferPartialWind({ ...model, supports: model.supports.map((support) =>
  support.nodeId === 1 ? { ...support, ux: false, springs: { kxKnPerM: 0 } } : support) }, wind, actions, levels),
/horizontale oplegging/);
assert.equal(nbc2025TransferPartialWind({ ...model, supports: model.supports.map((support) =>
  support.nodeId === 1 ? { ...support, ux: false, uy: false,
    springs: { kxKnPerM: 1000, kyKnPerM: 1000 } } : support) }, wind, actions, levels).length, 112);
assert.throws(() => nbc2025TransferPartialWind(model, wind, actions, levels.slice(1)), /minstens twee/);
assert.throws(() => nbc2025TransferPartialWind(model, wind, actions,
  [{ ...levels[0], nodeIds: [1, 2] }, { ...levels[1], nodeIds: [5, 6] }]), /volledige bestaande starre schijf/);
const input = { wind: geometry, horizontalTransfer: levels, firstId: 100,
  deadLoadScope: "ordinary-only", nonWindLoadsVerifiedForNbc2025: true,
  liveUse: "ordinary", serviceability: "noncreep-deflection" };
const manualCases = [{ id: 1, name: "D", type: "dead" }];
const applied = nbc2025ModelLoadPlan(model, manualCases, input);
assert.equal(applied.transferredCaseIds.length, 112);
assert.equal(applied.combinations.length, 193);
assert.equal(applied.loadCases.filter((item) => item.type === "wind").length, 128);
assert.ok(applied.transferredCaseIds.every((id) => applied.combinations.some((combo) =>
  combo.factors.get(id) === 1 && combo.type === applied.loadCases.find((item) => item.id === id)
    .gegenereerd.sleutel.split(":")[2])));
assert.ok(applied.combinations.every((combo) => applied.transferredCaseIds
  .filter((id) => combo.factors.has(id)).length <= 1));
const withLive = nbc2025ModelLoadPlan(model, [...manualCases,
  { id: 2, name: "L", type: "live" }], input);
const partialUlsId = withLive.transferredCaseIds.find((id) => withLive.loadCases
  .find((item) => item.id === id).gegenereerd.sleutel.includes(":uls:"));
assert.ok(withLive.combinations.some((combo) => combo.type === "uls" && combo.factors.get(partialUlsId) === 0.3
  && combo.factors.get(2) === 1.5));
assert.ok(withLive.combinations.some((combo) => combo.type === "uls" && combo.factors.get(partialUlsId) === 1
  && combo.factors.get(2) === 0.5));
const missingSls = transferred.find((item) => item.action.limitState === "sls");
assert.throws(() => nbc2025CombinationPlan({ ...input,
  loadCases: applied.loadCases.filter((item) => item.gegenereerd?.sleutel !== missingSls.key),
  windCases: wind.cases,
  partialWindCases: transferred.filter((item) => item.key !== missingSls.key)
    .map(({ key, action }) => ({ key, action })) }), /volledige UGT\/BGT-paren/);
assert.equal(applied.transferredLoadIds.length, transferred.reduce((sum, item) => sum + item.loads.length, 0));
assert.ok(applied.model.loads.every((load) => load.generated?.source === "nbc2025-partial-wind"
  && load.generated.sourceReference.includes("foundation tie and supports")));
assert.deepEqual(parseOpenFem3DModel(applied.model).loads, applied.model.loads);
const solveCase = applied.loadCases.find((item) => item.gegenereerd?.sleutel === eccentricX.key);
const request = buildOpenFem3DSolveRequest({ ...applied.model, loadPanels: [],
  nodes: applied.model.nodes.filter((node) => node.id <= 8), generatedNodeIds: [] }, "linear", solveCase.id);
assert.equal(request.nodalLoads.length, eccentricX.loads.length);
assert.ok(request.nodalLoads.every((load) => !Object.hasOwn(load, "generated")));
assert.ok(Math.abs(request.nodalLoads.reduce((sum, load) => sum + load.fx, 0) - eccentricX.action.fxKn) < 1e-8);
const solver = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d"}`, import.meta.url));
assert.ok(existsSync(solver), "bouw eerst de Rust 3D-kern");
const solved = spawnSync(solver, [], { input: JSON.stringify({ ...request, bucklingModes: 0 }), encoding: "utf8" });
assert.equal(solved.status, 0, `${solved.stderr}\n${solved.stdout}`.slice(0, 800));
const response = JSON.parse(solved.stdout);
assert.ok(response.displacements?.length > 0, "de 3D-kern rekent de gegenereerde deelwind door");
const repeated = nbc2025ModelLoadPlan(applied.model, applied.loadCases, input);
assert.equal(repeated.changed, false);
assert.deepEqual(repeated.transferredCaseIds, applied.transferredCaseIds);
assert.deepEqual(repeated.transferredLoadIds, applied.transferredLoadIds);
const removed = nbc2025ModelLoadPlan(applied.model, applied.loadCases,
  { ...input, horizontalTransfer: undefined });
assert.equal(removed.transferredCaseIds.length, 0);
assert.equal(removed.model.loads.length, 0);
assert.equal(removed.loadCases.filter((item) => item.type === "wind").length, 16);
assert.equal(removed.combinations.length, 25);
const manualLoad = { id: 99999, nodeId: 5, caseId: 1,
  fx: 1, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 };
const withManual = nbc2025ModelLoadPlan({ ...model, loads: [manualLoad] }, manualCases, input);
assert.deepEqual(withManual.model.loads.find((item) => item.id === manualLoad.id), manualLoad);
assert.deepEqual(nbc2025ModelLoadPlan(withManual.model, withManual.loadCases,
  { ...input, horizontalTransfer: undefined }).model.loads, [manualLoad]);
assert.throws(() => parseOpenFem3DModel({ ...applied.model, loads: [{ ...applied.model.loads[0],
  generated: { ...applied.model.loads[0].generated, source: "other" } }] }), /NBC-deelwindherkomst/);
console.log("NBC 2025 horizontale deellasten: statisch equivalente knooplasten en afwijzingen geslaagd");

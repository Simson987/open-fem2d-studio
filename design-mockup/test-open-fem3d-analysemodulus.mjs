// Issue #62: dezelfde betonklasse rekent met Ecm, Eeff of eigen E en houdt haar normidentiteit.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { register as registerLoader } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

registerLoader("data:text/javascript," + encodeURIComponent(
  "export async function load(url, ctx, next) {" +
  " if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };" +
  " return next(url, ctx); }",
));
await import("./scripts/i18n-voor-tests.mjs");

const { parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { setOpenFem3DAnalysisMaterial } = await import("./src/components/openFem3d/openFem3dAnalysisMaterial.ts");
const { buildOpenFem3DSolveRequest, solveOpenFem3D } = await import("./src/components/openFem3d/openFem3dSolver.ts");
const { serializeProject, deserializeProject, PROJECT_FORMAT_VERSION_MAX } = await import("./src/io/projectFile.ts");
const { matchSupportedConcreteClass } = await import("./src/lib/betonCheckBuilder.ts");
const { meshOpenFem3DPlates } = await import("./src/components/openFem3d/openFem3dPlateMesh.ts");
const { maakRegister } = await import("./src/api/register.ts");
const { metModel3d, leegDocument, model3dVan } = await import("./src/api/projectDocument.ts");
const { MODEL3D_ANALYSIS_MATERIAL_COMMANDOS } = await import("./src/api/commands/model3dAnalysisMaterial.ts");
const { default: AnalysisMaterialField } = await import("./src/components/openFem3d/OpenFem3DAnalysisMaterialField.tsx");
const { default: OpenFem3DReport } = await import("./src/components/openFem3d/OpenFem3DReport.tsx");

const free = { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };
const model = parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 2, y: 0, z: 0 }, { id: 3, x: 4, y: 0, z: 0 }],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, material: "C30/37", profileName: "300x500" },
    { id: 2, startNodeId: 2, endNodeId: 3, material: "C30/37", profileName: "300x500" },
  ],
  supports: [
    { nodeId: 1, ...free, ux: true, uy: true, uz: true, rx: true },
    { nodeId: 3, ...free, uy: true, uz: true },
  ],
  loads: [{ id: 1, nodeId: 2, caseId: 1, fx: 0, fy: 0, fz: -100, mx: 0, my: 0, mz: 0 }],
});

const creep = setOpenFem3DAnalysisMaterial(model, "C30/37", { concreteModulus: { kind: "creep", phi: 2 }, nu: 0.25 });
const custom = setOpenFem3DAnalysisMaterial(model, "C30/37", { concreteModulus: { kind: "custom", eMpa: 15_000 }, nu: 0.2 });
const baseRequest = buildOpenFem3DSolveRequest(model, "linear", 1);
const creepRequest = buildOpenFem3DSolveRequest(creep, "linear", 1);
const customRequest = buildOpenFem3DSolveRequest(custom, "linear", 1);
assert.equal(baseRequest.materials.length, 1);
assert.equal(baseRequest.materials[0].eMpa, 33_000);
assert.equal(baseRequest.materials[0].nu, 0.2);
assert.equal(creepRequest.materials.length, 1, "beide staven delen dezelfde materiaalinstelling");
assert.equal(creepRequest.materials[0].eMpa, 11_000);
assert.equal(creepRequest.materials[0].nu, 0.25);
assert.equal(customRequest.materials[0].eMpa, 15_000);
assert.equal(creep.beams[0].material, "C30/37");
assert.ok(matchSupportedConcreteClass(creep.beams[0].material), "de betonklasse blijft beschikbaar voor de normtoets");
const plateModel = parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 2, y: 0, z: 0 },
    { id: 3, x: 2, y: 2, z: 0 }, { id: 4, x: 0, y: 2, z: 0 },
  ],
  beams: [], plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2, material: "C30/37" }],
  supports: [{ nodeId: 1, ...free, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
  loads: [{ id: 1, nodeId: 1, caseId: 1, fx: 0, fy: 0, fz: -1, mx: 0, my: 0, mz: 0 }],
  analysisMaterials: creep.analysisMaterials,
});
const plateMesh = await meshOpenFem3DPlates(plateModel);
const plateRequest = buildOpenFem3DSolveRequest(plateModel, "linear", 1, plateMesh);
assert.equal(plateRequest.materials[0].eMpa, 11_000, "de plaat gebruikt dezelfde gekozen E als de staven");
assert.equal(plateRequest.materials[0].nu, 0.25);
const field = renderToStaticMarkup(React.createElement(AnalysisMaterialField, {
  model: creep, material: "C30/37", onChange() {},
}));
assert.match(field, /data-open-fem3d-analysis-mode/);
assert.match(field, /data-open-fem3d-analysis-phi/);
assert.match(field, /data-open-fem3d-analysis-nu/);
const register = maakRegister(MODEL3D_ANALYSIS_MATERIAL_COMMANDOS);
let document = metModel3d(leegDocument(), model);
document = register.voerUit("model3d.material.setAnalysis", {
  material: "C30/37", concreteModulus: { kind: "creep", phi: 2 }, nu: 0.25,
}, { document }).document;
assert.deepEqual(model3dVan(document).analysisMaterials, creep.analysisMaterials);
assert.throws(() => register.voerUit("model3d.material.setAnalysis", {
  material: "C30/37", concreteModulus: { kind: "creep", phi: 2, extra: 1 },
}, { document }), (error) => error.code === "INVOER_ONGELDIG");
assert.throws(() => register.voerUit("model3d.material.setAnalysis", {
  material: "C30/37", nu: 0.5,
}, { document }), (error) => error.code === "INVOER_ONGELDIG");
document = register.voerUit("model3d.material.setAnalysis", {
  material: "C30/37", concreteModulus: null, nu: null,
}, { document }).document;
assert.equal(model3dVan(document).analysisMaterials, undefined);

const kern = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/open-fem-3d${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
const oldFetch = globalThis.fetch;
let creepResult;
globalThis.fetch = async (_url, options) => {
  const run = spawnSync(kern, [], { input: options.body });
  assert.equal(run.status, 0, run.stderr.toString());
  return { ok: true, json: async () => JSON.parse(run.stdout.toString()) };
};
try {
  const inertia = 300 * 500 ** 3 / 12 * 1e-12;
  for (const [chosen, eMpa] of [[model, 33_000], [creep, 11_000], [custom, 15_000]]) {
    const result = await solveOpenFem3D(chosen, 1, "linear");
    if (chosen === creep) creepResult = result;
    const middle = result.displacements.find((item) => item.nodeId === 2);
    const expected = -100 * 4 ** 3 / (48 * eMpa * 1000 * inertia);
    assert.ok(Math.abs(middle.uz - expected) < 1e-8,
      `E=${eMpa} MPa: zakking ${middle.uz} m tegen ${expected} m`);
  }
  const twistModel = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 2, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, material: "C30/37", profileName: "300x500" }],
    supports: [{ nodeId: 1, ...free, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
    loads: [{ id: 1, nodeId: 2, caseId: 1, fx: 0, fy: 0, fz: 0, mx: 100, my: 0, mz: 0 }],
  });
  const nuQuarter = setOpenFem3DAnalysisMaterial(twistModel, "C30/37", { nu: 0.25 });
  const angleDefault = (await solveOpenFem3D(twistModel, 1, "linear")).displacements.find((item) => item.nodeId === 2).rx;
  const angleQuarter = (await solveOpenFem3D(nuQuarter, 1, "linear")).displacements.find((item) => item.nodeId === 2).rx;
  assert.ok(Math.abs(angleQuarter / angleDefault - 1.25 / 1.2) < 1e-6,
    "een andere ν verandert G = E/[2(1+ν)] en daarmee de torsiehoek");
} finally { globalThis.fetch = oldFetch; }
const report = renderToStaticMarkup(React.createElement(OpenFem3DReport, { model: creep, result: creepResult }));
assert.match(report, /Materiaalstijfheid in de 3D-analyse/);
assert.match(report, /11\.000/);
assert.match(report, /0,25/);

const project = (model3d) => ({
  nodes: [], beams: [], supports: [], plates: [], loads: [],
  loadCases: [{ id: 1, name: "G", type: "dead" }], modelDimension: "3d", model3d,
});
assert.equal(JSON.parse(serializeProject(project(model))).version, 3);
const text = serializeProject(project(creep));
assert.equal(JSON.parse(text).version, 8);
assert.deepEqual(deserializeProject(text).model3d.analysisMaterials, creep.analysisMaterials);
assert.throws(() => deserializeProject(JSON.stringify({ ...JSON.parse(text), version: PROJECT_FORMAT_VERSION_MAX + 1 })),
  /nieuwere versie/);
for (const invalid of [
  { concreteModulus: { kind: "creep", phi: -1 } },
  { concreteModulus: { kind: "custom", eMpa: 0 } },
  { concreteModulus: { kind: "custom", eMpa: 10_000 }, nu: 0.5 },
  { concreteModulus: { kind: "ecm", extra: 1 } },
]) {
  assert.throws(() => parseOpenFem3DModel({ ...model, analysisMaterials: { "C30/37": invalid } }));
}
assert.throws(() => parseOpenFem3DModel({ ...model, analysisMaterials: { S235: { concreteModulus: { kind: "custom", eMpa: 10_000 } } } }),
  /alleen voor een bekende betonklasse/);

console.log("3D-analysemodulus: analytische betonzakking, materiaalidentiteit en projectversie geslaagd.");

// Native Rust-3D-route vanuit het Open FEM 3D-model van de app:
//  1. projectbestand bewaart volumes (formaatversie 11), oude bestanden blijven gelijk;
//  2. omzetting van de frame3d-randoplegging (plaatassen) naar globale assen en terug;
//  3. rekenkeuze: Open FEM 3D standaard, volumes automatisch naar Open FEM Rust;
//  4. een Tet4 door de hele route (Open FEM 3D-model → frame3d → native-mixed3d),
//     tegen de analytische stijfheid k = (λ + 2μ)/6 · 1 m (integraal van de
//     Tet4-vormfunctiegradiënten, zie ook test-frame3d-volume-app-route).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { parseOpenFem3DModel } from "./src/components/openFem3d/openFem3dModel.ts";
import {
  legacyFrame3DEdgeSupportsToOpenFem3D, openFem3DEdgeSupportsToFrame3D, openFem3DNativeFeatures,
  openFem3DToFrame3DModel,
} from "./src/components/openFem3d/openFem3dNativeModel.ts";
import {
  chooseOpenFem3DRoute, openFem3DNativeAnalysis, openFem3DNativeCalculationModel, solveOpenFem3DNative,
} from "./src/components/openFem3d/openFem3dNativeRoute.ts";
import { buildOpenFem3DSolveRequest } from "./src/components/openFem3d/openFem3dSolver.ts";
import { deserializeProject, serializeProject } from "./src/io/projectFile.ts";

let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks += 1; console.log(`  ✓ ${message}`); };

const eMpa = 1200, poisson = 0.2;
const lambda = eMpa * poisson / ((1 + poisson) * (1 - 2 * poisson));
const mu = eMpa / (2 * (1 + poisson));
const tetStiffnessKnPerM = 1000 * (lambda + 2 * mu) / 6; // 1000·(333,33 + 2·500)/6 = 222 222 kN/m
const fixed = (nodeId, ux = true) => ({ nodeId, ux, uy: true, uz: true, rx: false, ry: false, rz: false });
const tetModel = () => ({
  nodes: [{ id: 101, x: 0, y: 0, z: 0 }, { id: 205, x: 1, y: 0, z: 0 },
    { id: 306, x: 0, y: 1, z: 0 }, { id: 407, x: 0, y: 0, z: 1 }],
  beams: [],
  volumes: [{ id: 21, kind: "tet4", nodeIds: [101, 205, 306, 407], eMpa, poisson }],
  supports: [fixed(101), fixed(205, false), fixed(306), fixed(407)],
  loads: [{ id: 1, nodeId: 205, caseId: 1, fx: 10, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
});
const project = (model3d) => ({
  nodes: [], beams: [], supports: [], plates: [], loads: [], loadCases: [{ id: 1, name: "G", type: "dead" }],
  activeLoadCaseId: 1, selfWeightEnabled: false, modelDimension: "3d", model3d,
});

console.log("[1] projectbestand");
{
  const model = parseOpenFem3DModel(tetModel());
  ok(model.volumes.length === 1 && model.volumes[0].kind === "tet4", "parseOpenFem3DModel bewaart het Tet4-volume");
  const text = serializeProject(project(model));
  ok(JSON.parse(text).version === 11, "met volumes: formaatversie 11");
  ok(JSON.stringify(deserializeProject(text).model3d) === JSON.stringify(model), "volumes overleven opslaan en openen");
  const { volumes: _volumes, ...frameOnly } = tetModel();
  const plain = parseOpenFem3DModel({ ...frameOnly, beams: [{ id: 1, startNodeId: 101, endNodeId: 205 }] });
  ok(JSON.parse(serializeProject(project(plain))).version === 3, "zonder native velden: versie 3, als voorheen");
  ok(!("volumes" in plain), "geen leeg volumeveld in een gewoon Open FEM 3D-model");
  assert.throws(() => parseOpenFem3DModel({ ...tetModel(), volumes: [{ ...tetModel().volumes[0], poisson: 0.5 }] }),
    /Poisson/);
  ok(true, "een ongeldig volume (ν = 0,5) wordt geweigerd met de frame3d-keuring");
}

console.log("[2] randoplegging frame3d ↔ Open FEM 3D");
{
  const nodes = new Map([[1, { x: 0, y: 0, z: 3 }], [2, { x: 2, y: 0, z: 3 }], [3, { x: 2, y: 2, z: 3 }], [4, { x: 0, y: 2, z: 3 }],
    [5, { x: 0, y: 5, z: 0 }], [6, { x: 2, y: 5, z: 0 }], [7, { x: 2, y: 5, z: 2 }], [8, { x: 0, y: 5, z: 2 }],
    [9, { x: 0, y: 0, z: 0 }], [10, { x: 2, y: 0, z: 0 }], [11, { x: 2, y: 2, z: 1 }], [12, { x: 0, y: 2, z: 1 }]]);
  const kinds = ["simplySupported", "clamped", "free", "simplySupported"];
  const vloer = legacyFrame3DEdgeSupportsToOpenFem3D(kinds, [1, 2, 3, 4], nodes, "vloer");
  ok(JSON.stringify(vloer) === JSON.stringify([
    { edge: 0, ux: false, uy: false, uz: true, rx: false, ry: false, rz: false },
    { edge: 1, ux: false, uy: false, uz: true, rx: true, ry: true, rz: false },
    { edge: 3, ux: false, uy: false, uz: true, rx: false, ry: false, rz: false },
  ]), "XY-vloer: scharnier = uz, inklemming = uz + rx + ry");
  ok(JSON.stringify(openFem3DEdgeSupportsToFrame3D({ id: 1, nodeIds: [1, 2, 3, 4], edgeSupports: vloer }, nodes))
    === JSON.stringify(kinds), "en terug naar de frame3d-randtypen");
  const wand = legacyFrame3DEdgeSupportsToOpenFem3D(["clamped", "free", "free", "free"], [5, 6, 7, 8], nodes, "wand");
  ok(wand[0].uy && wand[0].rx && wand[0].rz && !wand[0].uz && !wand[0].ry, "XZ-wand: inklemming = uy + rx + rz");
  assert.throws(() => legacyFrame3DEdgeSupportsToOpenFem3D(kinds, [9, 10, 11, 12], nodes, "schuin dak"), /globaal coördinatenvlak/);
  ok(true, "een schuine plaat met randoplegging in plaatassen geeft een melding");
  assert.throws(() => openFem3DEdgeSupportsToFrame3D({ id: 1, nodeIds: [1, 2, 3, 4],
    edgeSupports: [{ edge: 0, ux: true, uy: false, uz: true, rx: false, ry: false, rz: false }] }, nodes), /niet te rekenen/);
  ok(true, "een globale oplegging die geen frame3d-randtype is, weigert de native route");
}

console.log("[3] rekenkeuze");
{
  const volume = parseOpenFem3DModel(tetModel());
  const { volumes: _volumes, ...frameOnly } = tetModel();
  const plain = parseOpenFem3DModel({ ...frameOnly, beams: [{ id: 1, startNodeId: 101, endNodeId: 205 }] });
  ok(chooseOpenFem3DRoute(plain, "automatic").engineId === "open-fem-3d", "staafmodel, automatisch: Open FEM 3D");
  ok(chooseOpenFem3DRoute(plain, "openaec-native-fem").engineId === "openaec-native-fem", "staafmodel, Open FEM Rust gekozen: native route");
  const auto = chooseOpenFem3DRoute(volume, "automatic");
  ok(auto.engineId === "openaec-native-fem" && auto.automaticNative && auto.features.includes("volumes"),
    "volumemodel, automatisch: Open FEM Rust, met melding");
  assert.throws(() => chooseOpenFem3DRoute(volume, "open-fem-3d"), /alleen Open FEM Rust/);
  ok(true, "volumemodel met Open FEM 3D expliciet gekozen: weigering in plaats van stil overslaan");
  ok(openFem3DNativeFeatures(plain).length === 0, "een gewoon model heeft geen native onderdelen");
  assert.throws(() => buildOpenFem3DSolveRequest(volume, "linear"), /alleen Open FEM Rust/);
  ok(true, "de Open FEM 3D-kern (ook via MCP) weigert een volumemodel in plaats van de volumes over te slaan");
  assert.throws(() => openFem3DToFrame3DModel({ ...volume, beams: [{ id: 1, startNodeId: 101, endNodeId: 205,
    bedding: { widthM: 0.3, kKnPerM3: 1000 } }] }), /bedding/);
  ok(true, "de native route weigert onderdelen die zij niet rekent (bedding)");
}

console.log("[4] Tet4 door de app-route");
const binary = process.env.OPEN_FEM_NATIVE_MIXED3D_BIN
  ?? fileURLToPath(new URL("../src-tauri/target/debug/native-mixed3d", import.meta.url));
const invoke = (input) => new Promise((resolve, reject) => {
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [], errors = [];
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => errors.push(chunk));
  child.on("error", reject);
  child.on("close", (code) => code === 0 ? resolve(JSON.parse(Buffer.concat(output).toString()))
    : reject(new Error(Buffer.concat(errors).toString() || Buffer.concat(output).toString())));
  child.stdin.end(JSON.stringify(input));
});
const previousFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const request = JSON.parse(options.body);
  assert.equal(request.inputs.kind, "mixed3d");
  return new Response(JSON.stringify({ kind: "mixed3d", result: await invoke(request.inputs.input) }), { status: 200 });
};
try {
  const model = deserializeProject(serializeProject(project(parseOpenFem3DModel(tetModel())))).model3d;
  const native = openFem3DNativeCalculationModel(model);
  const analysis = openFem3DNativeAnalysis(native, "eersteOrde");
  ok(analysis === "linear", "eerste orde: lineaire native analyse");
  const result = await solveOpenFem3DNative(native, 1, analysis);
  const ux = result.displacements.find((node) => node.nodeId === 205).ux;
  const expected = 10 / tetStiffnessKnPerM; // 10 kN / 222 222 kN/m = 4,5·10⁻⁵ m
  ok(Math.abs(ux - expected) <= 1e-12, `ux = ${ux.toExponential(6)} m = F/k = ${expected.toExponential(6)} m`);
  ok(result.engine.id === "openaec-native-fem" && result.analysis === "linear" && result.nativeAnalysis === "linear",
    "uitkomst in Open FEM 3D-vorm, kern Open FEM Rust");
  ok(result.nativeVolume3D?.elements.length === 1 && result.nativeVolume3D.elements[0].kind === "tet4",
    "volumespanningen meegegeven");
  const reactionX = result.reactions.reduce((sum, reaction) => sum + reaction.fx, 0);
  ok(Math.abs(reactionX + 10) <= 1e-9, `ΣRx = ${reactionX.toFixed(9)} kN = −F`);
} finally {
  globalThis.fetch = previousFetch;
}
console.log("[5] app en vertalingen");
{
  const app = readFileSync(new URL("./src/App.tsx", import.meta.url), "utf8");
  ok(app.includes("chooseOpenFem3DRoute(openFem3d, preference)") && app.includes("solveOpenFem3DNative(nativeModel"),
    "App.tsx kiest de 3D-route en rekent native via openFem3dNativeRoute");
  const features = ["volumes", "volumeLoads", "plateEdgeLoads", "axialOnly", "nonlinearLaw", "membraneOnly",
    "modulusCurve", "reinforcement", "threeLayer", "materialLoadPath"];
  for (const taal of ["nl", "en", "de", "fr"]) {
    const solve = JSON.parse(readFileSync(new URL(`./src/i18n/locales/${taal}/common.json`, import.meta.url), "utf8")).app.solve;
    ok(solve.nativeRouteTitle && solve.nativeRouteText.includes("{{features}}")
      && features.every((feature) => typeof solve.nativeFeature[feature] === "string"),
      `${taal}: melding over de automatische keuze van Open FEM Rust vertaald`);
  }
}
console.log("[6] verkenner toont volumes");
{
  // De componenten importeren stylesheets; Node kent die niet.
  register("data:text/javascript," + encodeURIComponent(
    "export async function load(url, ctx, next) {"
    + " if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };"
    + " return next(url, ctx); }"));
  await import("./scripts/i18n-voor-tests.mjs");
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { default: OpenFem3DExplorer } = await import("./src/components/openFem3d/OpenFem3DExplorer.tsx");
  const noop = () => {};
  const render = (model, selection = null) => renderToStaticMarkup(React.createElement(OpenFem3DExplorer, {
    model, selection, setSelection: noop, result: null,
    visibility: {}, setVisibility: noop, displayFlags: {}, setDisplayFlags: noop,
    gridShow: true, setGridShow: noop, structuralGrid: { enabled: false, xAxes: [], zAxes: [] }, setStructuralGridEnabled: noop,
  })).replace(/<[^>]+>/g, " ");
  const volume = parseOpenFem3DModel({ ...tetModel(),
    volumeBodyLoads: [{ id: 3, volumeId: 21, caseId: 1, forceKnPerM3: [0, 0, -25] }] });
  const boom = render(volume);
  ok(boom.includes("Volumes") && boom.includes("Tet4 21") && boom.includes("4 knopen · E 1200 MPa · ν 0.2"),
    "de verkenner toont de tak Volumes met het Tet4-volume");
  ok(boom.includes("b#3 · volumekracht, volume 21") && boom.includes("0 · 0 · -25 kN/m³"), "en de volumelast onder Belastingen");
  const { volumes: _volumes, ...frameOnly } = tetModel();
  ok(!render(parseOpenFem3DModel(frameOnly)).includes("Volumes"), "een model zonder volumes krijgt geen extra tak");
}
console.log(`\n${checks} geslaagd, 0 gefaald`);

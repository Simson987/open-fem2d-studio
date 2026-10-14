// Issue #72: dezelfde houten ligger door de 2D- en 3D-rekenweg, daarna
// door hun eigen invoerbouwers en dezelfde echte EN 1995-toetsbrug.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

register("data:text/javascript," + encodeURIComponent(
  "export async function load(url, ctx, next) {" +
  " if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };" +
  " return next(url, ctx); }",
));

const { parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { solveOpenFem3D, solveOpenFem3DCombination } = await import("./src/components/openFem3d/openFem3dSolver.ts");
const { buildOpenFem3DTimberCheckInputs } = await import("./src/components/openFem3d/openFem3dTimberCheck.ts");
const { solveAllCases } = await import("./src/components/fem/solver/engine.ts");
const { defaultCombinations, combineResults } = await import("./src/components/fem/solver/combinations.ts");
const { selecteerCombinaties } = await import("./src/lib/combinatieSelectie.ts");
const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");
const { buildTimberCheckInputs } = await import("./src/lib/timberCheckBuilder.ts");

const exe = (name) => process.platform === "win32" ? `${name}.exe` : name;
const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${exe("open-fem-3d")}`, import.meta.url));
const bridgePath = process.env.TOETSBRUG_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/release/${exe("toetsbrug")}`, import.meta.url));
assert.ok(existsSync(solverPath), `3D-solver ontbreekt: ${solverPath}`);
assert.ok(existsSync(bridgePath), `toetsbrug ontbreekt: ${bridgePath}`);

globalThis.fetch = (_url, options) => new Promise((resolve, reject) => {
  const child = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  const out = [], err = [];
  child.stdout.on("data", (data) => out.push(data));
  child.stderr.on("data", (data) => err.push(data));
  child.on("error", reject);
  child.on("close", (code) => {
    const body = Buffer.concat(out).toString();
    if (code !== 0) { reject(new Error(Buffer.concat(err).toString() || body)); return; }
    resolve({ ok: true, status: 200, json: async () => JSON.parse(body) });
  });
  child.stdin.end(options.body);
});
const toets = (input) => {
  const proc = spawnSync(bridgePath, [], {
    input: JSON.stringify({ opdracht: "check_timber_beams", inputs: [input] }),
    encoding: "utf8", maxBuffer: 64 << 20,
  });
  assert.equal(proc.status, 0, proc.stdout || proc.stderr);
  return JSON.parse(proc.stdout)[0];
};
const uc = (result, id) => result.checks.find((check) => check.id === id)?.kind.data.uc?.uc;
const dichtbij = (a, b, tol, label) => {
  assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol * Math.max(1e-6, Math.abs(b)),
    `${label}: 3D ${a}, 2D ${b}, tolerantie ${tol}`);
  console.log(`  ✓ ${label}: 3D ${a.toFixed(5)}, 2D ${b.toFixed(5)}`);
};

const L = 5, q = 2;
const loadCases = [{ id: 1, name: "G", type: "dead" }];
const checkConfig = { deflectionClass: "floor" };
const model2d = {
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: L * 1000, z: 0 }],
  beams: [{ id: 1, from: 1, to: 2, material: "GL24h", profile: "100x300", checkConfig }],
  supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 2, type: "zRoller" }],
  plates: [], loadCases,
  loads: [{ id: 1, type: "lineLoad", caseId: 1, beamId: 1, q: -q }],
  selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
};
const model3d = parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, material: "GL24h", profileName: "100x300", checkConfig }],
  supports: [
    { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
    { nodeId: 2, ux: false, uy: true, uz: true, rx: true, ry: false, rz: false },
  ],
  memberLoads: [{ id: 1, beamId: 1, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -q, qzEnd: -q, startPositionM: 0, endPositionM: L }],
});
const combinations = selecteerCombinaties(defaultCombinations(loadCases), model2d.beams, model2d.plates).actief;
const { perCase } = solveAllCases(bouwMultiInput(model2d));
const combination2d = new Map(combinations.map((c) => [c.id, combineResults(c, perCase)]));
const result3d = await solveOpenFem3D(model3d, 1, "linear");
const combination3d = new Map();
for (const combo of combinations) {
  combination3d.set(combo.id, await solveOpenFem3DCombination(model3d, combo.factors, "linear"));
}
const built2d = buildTimberCheckInputs({
  nodes: model2d.nodes, beams: model2d.beams, supports: model2d.supports,
  combinations, combinationResults: combination2d, loadCases, gevallenMetLast: [1],
});
const built3d = buildOpenFem3DTimberCheckInputs(model3d, result3d, {
  combinations, results: combination3d, loadCases,
});
assert.equal(built2d.inputs.length, 1, JSON.stringify(built2d.skipped));
assert.equal(built3d.inputs.length, 1, JSON.stringify(built3d.skipped));
assert.equal(built3d.inputs[0].ltb_load_case, "UniformLoad");
const two = toets(built2d.inputs[0]), three = toets(built3d.inputs[0]);
assert.equal(two.beam_id, 1);
assert.equal(three.beam_id, 1);
assert.deepEqual(three.checks.map((check) => check.id), two.checks.map((check) => check.id));
for (const check of two.checks) {
  // De 2D- en 3D-veldzakking worden op verschillende stationnetten bepaald;
  // gemeten verschil 0,30%. De grens 0,5% vangt die discretisatie op.
  const tolerance = check.id.startsWith("deflection_") ? 5e-3 : 1e-4;
  // Een toets die niet van toepassing is (geen trek, geen druk) heeft sinds
  // oktober 2026 geen UC meer in plaats van UC 0 (controle 2026-10, punt K3).
  // Pariteit betekent dan: in 2D en 3D allebei geen UC.
  if (uc(two, check.id) === undefined || uc(three, check.id) === undefined) {
    assert.equal(uc(three, check.id), uc(two, check.id), `${check.id}: UC in 3D en 2D allebei weg`);
    console.log(`  ✓ ${check.id}: n.v.t. in 2D en 3D`);
    continue;
  }
  dichtbij(uc(three, check.id), uc(two, check.id), tolerance, check.id);
}
const mixed = {
  ...model3d,
  nodes: [...model3d.nodes, { id: 3, x: L + 1, y: 0, z: 0 }],
  beams: [...model3d.beams, { id: 2, startNodeId: 2, endNodeId: 3, material: "S235", profileName: "IPE 200" }],
};
const mixedInput = buildOpenFem3DTimberCheckInputs(mixed, result3d, {
  combinations, results: combination3d, loadCases,
}).inputs[0];
assert.match(mixedInput.deflection_not_applicable_reason, /verschillend kruipgedrag/);
assert.equal(mixedInput.ltb_load_case, "ConstantMoment");
const mixedCheck = toets(mixedInput);
assert.equal(mixedCheck.checks.find((check) => check.id === "deflection_w_fin")?.kind.data.status, "NotApplicable");
assert.ok(uc(mixedCheck, "6.1.6_bending") > 0);
console.log("  ✓ verbonden staaldeel: UGT blijft toetsbaar, BGT-zakking wordt niet schijnbaar goedgekeurd");
const endMomentInput = buildOpenFem3DTimberCheckInputs({
  ...model3d,
  loads: [{ id: 2, nodeId: 2, fx: 0, fy: 0, fz: 0, mx: 0, my: 1, mz: 0 }],
}, result3d, { combinations, results: combination3d, loadCases }).inputs[0];
assert.equal(endMomentInput.ltb_load_case, "ConstantMoment");
console.log("  ✓ eindmoment gebruikt de conservatieve kiplengte L");
const noUls = buildOpenFem3DTimberCheckInputs(model3d, result3d, {
  combinations: combinations.filter((combo) => combo.type === "sls"),
  results: combination3d, loadCases,
});
assert.equal(noUls.inputs.length, 0);
assert.match(noUls.skipped[0].reason, /UGT-combinatie/);
console.log("  ✓ zonder berekende UGT-combinatie wordt geen lastgeval als sterktetoets gebruikt");
const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const i18next = (await import("i18next")).default;
const { initReactI18next } = await import("react-i18next");
const ribbon = (await import("./src/i18n/locales/nl/ribbon.json", { with: { type: "json" } })).default;
const common = (await import("./src/i18n/locales/nl/common.json", { with: { type: "json" } })).default;
await i18next.use(initReactI18next).init({ lng: "nl", resources: { nl: { ribbon, common } }, defaultNS: "common", initImmediate: false });
const Report = (await import("./src/components/openFem3d/OpenFem3DReport.tsx")).default;
const { buildOpenFem3DUtilizations } = await import("./src/components/openFem3d/openFem3dUtilization.ts");
const [utilization] = buildOpenFem3DUtilizations(null, null, { results: [three], skipped: [], notes: [] });
assert.equal(utilization.standard, "EN 1995");
dichtbij(utilization.uc, uc(three, "6.1.6_bending"), 1e-4, "3D-profielkleur-UC");
const html = renderToStaticMarkup(React.createElement(Report, {
  model: model3d, result: result3d,
  timberChecks: { results: [three], skipped: [], notes: [] },
}));
assert.match(html, /EN 1995/);
assert.match(html, /6\.1\.6|Buiging/);
console.log("  ✓ het echte 3D-berekeningsrapport toont de EN 1995-toets");
console.log("\n3D/2D-houtpariteit geslaagd");

// Issue #210: CLT-doorbuiging w_add = w₂ + w₃ met w₃ = w_c − w₁ PER
// BGT-combinatie, zoals bij massief hout (issue #200).
//
// ── HANDBEREKENING ─────────────────────────────────────────────────────────
// CLT 40/20/40/20/40 C24, b = 1000, vrij opgelegd, L = 5000 mm:
//   (EI)_ef = 3,344·10¹² N·mm²; w(q) = 5·q·L⁴/(384·EI) = q · 2,43362 mm.
// G = 1 kN/m omlaag, Q = 3 kN/m omlaag (cat. A, ψ₂ = 0,3), W = 5,1 kN/m
// OMHOOG (ψ₂ = 0). Karakteristieke combinaties (6.14b):
//   Q leidend:          G + Q        → w = −4,0·2,43362 = −9,73449 mm
//   W leidend zonder Q: G + W        → w = +4,1·2,43362 = +9,97785 mm  ← grootste |w|
//   w₁ = w(G) = −2,43362;  w_qp = w(G + 0,3·Q) = −1,9·2,43362 = −4,62388
//   k_def = 0,8 (testgetal) → w₂ = 0,8·w_qp = −3,69910
//   per combinatie |w₂ + w_c − w₁|: Q: |−3,69910 − 7,30087| = 11,000
//                                   W: |−3,69910 + 12,41147| =  8,712
//   → w₃ = −7,30087 (Q leidend), w_add = −3,69910 − 7,30087 = −10,99997 mm.
// Zonder w₃ per combinatie gaf de kern w_add = w_fin − w₁ = (9,97785 − 3,69910)
// + 2,43362 = 8,71237 mm: 21 % te weinig.
//
// Draaien met: node scripts/run-tests.mjs --filter=clt-w-add

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HIER, "..");
const TOETSBRUG = join(REPO, "src-tauri", "target", "release", process.platform === "win32" ? "toetsbrug.exe" : "toetsbrug");

const { solveAllCases } = await import("./src/components/fem/solver/engine.ts");
const { defaultCombinations, combineResults } = await import("./src/components/fem/solver/combinations.ts");
const { selecteerCombinaties } = await import("./src/lib/combinatieSelectie.ts");
const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");
const { buildCltCheckInputs } = await import("./src/lib/cltCheckBuilder.ts");

let passed = 0, failed = 0;
const log = (s = "") => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
}
function dicht(naam, gemeten, verwacht, tolAbs) {
  ok(naam, Number.isFinite(gemeten) && Math.abs(gemeten - verwacht) <= tolAbs,
    `${Number(gemeten).toFixed(5)} vs ${verwacht.toFixed(5)}`);
}

const L = 5000;
const EI = 11000 * (3 * 1000 * 40 ** 3 / 12 + 2 * 1000 * 40 * 60 ** 2);
const w = (q) => (5 * q * L ** 4) / (384 * EI);
const w1 = w(-1), wQ = w(-4), wW = w(4.1), wqp = w(-1.9), w2 = 0.8 * wqp;
const W3 = wQ - w1, WADD = w2 + W3;
dicht("hand w₃ = −7,30087", W3, -7.30087, 1e-4);
dicht("hand w_add = −10,99997", WADD, -10.99997, 1e-4);

function model(wind) {
  return {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: L, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, material: "C24", profile: "CLT 40/20/40/20/40", checkConfig: { cltKdef: 0.8, cltKdefBron: "testgetal" } }],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
    plates: [],
    loadCases: [{ id: 1, name: "G", type: "dead" }, { id: 2, name: "Q", type: "live", categorie: "A" }, { id: 3, name: "W", type: "wind" }],
    loads: [
      { id: 1, type: "lineLoad", caseId: 1, beamId: 1, q: -1 },
      { id: 2, type: "lineLoad", caseId: 2, beamId: 1, q: -3 },
      { id: 3, type: "lineLoad", caseId: 3, beamId: 1, q: wind },
    ],
    selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
  };
}
function bouw(m) {
  const { perCase } = solveAllCases(bouwMultiInput(m));
  const combinations = selecteerCombinaties(defaultCombinations(m.loadCases), m.beams, m.plates, { loadCases: m.loadCases }).actief;
  const combinationResults = new Map(combinations.map((c) => [c.id, combineResults(c, perCase)]));
  return buildCltCheckInputs({
    nodes: m.nodes, beams: m.beams, supports: m.supports, combinations, combinationResults,
    loadCases: m.loadCases, gevallenMetLast: [...perCase.keys()],
  }).inputs[0];
}

log("\n[1] De bouwer bepaalt w₃ per combinatie");
const i = bouw(model(5.1));
dicht("w_inst = +9,97785 (W leidend, de grootste |w|)", i.deflection_inst_mm, wW, 1e-3);
dicht("w₁ = −2,43362", i.deflection_permanent_mm, w1, 1e-3);
dicht("deflection_add_mm = w₃ van 'Q leidend' = −7,30087", i.deflection_add_mm, W3, 1e-3);
ok("de herkomst staat in de notities", i.deflection_notes.some((n) => /w₃ = w_c − w₁.*Q leidend/.test(n)));
// Zonder wind kiest w_inst dezelfde combinatie: geen apart veld, invoer als voorheen.
const zonderWind = bouw(model(0));
ok("zelfde combinatie als w_inst: geen deflection_add_mm (invoer als voorheen)", !("deflection_add_mm" in zonderWind));

log("\n[2] De kern (toetsbrug)");
if (!existsSync(TOETSBRUG)) {
  ok("toetsbrug gevonden — bouw hem met `cargo build --release -p toetsbrug`", false, TOETSBRUG);
} else {
  const kern = (inputs) => new Promise((res, rej) => {
    const c = spawn(TOETSBRUG, [], { stdio: ["pipe", "pipe", "pipe"] });
    let o = ""; c.stdout.on("data", (d) => (o += d)); c.on("error", rej);
    c.on("close", (code) => (code === 0 ? res(JSON.parse(o)) : rej(new Error(`toetsbrug code ${code}`))));
    c.stdin.end(JSON.stringify({ opdracht: "check_clt_beams", inputs }));
  });
  const { deflection_add_mm: _weg, ...zonder } = i;
  const [met, oud] = await kern([i, zonder]);
  const add = (r) => r.checks.find((c) => c.id === "deflection_w_add")?.kind?.data;
  dicht("w_add = w₂ + w₃ = −11,0000 mm", add(met)?.variables?.find((v) => v.symbol === "w")?.value, WADD, 2e-3);
  dicht("UC w_add = 11,0000/(L/n)", add(met)?.uc?.uc, Math.abs(WADD) / (L / i.deflection_limit_add), 1e-3);
  dicht("zonder het veld: w_add = w_fin − w₁ = 8,71237 (de oude, te lage waarde)",
    add(oud)?.variables?.find((v) => v.symbol === "w")?.value, wW + w2 - w1, 2e-3);
  ok("w_fin verandert niet door het veld",
    JSON.stringify(met.checks.find((c) => c.id === "deflection_w_fin")) === JSON.stringify(oud.checks.find((c) => c.id === "deflection_w_fin")));
}

log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

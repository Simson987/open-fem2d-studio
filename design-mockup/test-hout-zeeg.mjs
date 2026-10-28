// Issue #252: zeeg bij houten liggers in de NETTO eindzakking.
//
// ── HANDBEREKENING (controle 2026-10-26, N11) ──────────────────────────────
// GL28h 115 × 360 (E_0,mean = 12 600 N/mm², EN 14080), vrij opgelegd,
// L = 7200 mm, klimaatklasse 1, kiptoets uit; G = 3 kN/m, vloer cat. A
// Q = 1 kN/m (ψ₂ = 0,3); k_def = 0,6 (tabel 3.2).
//   I = 115·360³/12 = 447,12·10⁶ mm⁴;  w(q) = 5·q·L⁴/(384·E·I)
//   w_inst = w(4,0) = 24,84 mm;  w_qp = w(3,3) = 20,50 mm
//   w_fin  = 24,84 + 0,6·20,50 = 37,14 mm → UC (L/250 = 28,8) = 1,290
//   zeeg 15 mm: w_net,fin = 37,14 − 15 = 22,14 mm → UC = 0,769
// w_add verandert niet door de zeeg (A1.4.3(3)).
//
// Draaien met: node scripts/run-tests.mjs --filter=hout-zeeg

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
const { buildTimberCheckInputs } = await import("./src/lib/timberCheckBuilder.ts");

let passed = 0, failed = 0;
const log = (s = "") => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
}
function dicht(naam, gemeten, verwacht, tolAbs) {
  ok(naam, Number.isFinite(gemeten) && Math.abs(gemeten - verwacht) <= tolAbs,
    `${Number(gemeten).toFixed(4)} vs ${verwacht.toFixed(4)}`);
}

const L = 7200, EI = 12600 * (115 * 360 ** 3 / 12);
const w = (q) => (5 * q * L ** 4) / (384 * EI);
const wFin = w(4) + 0.6 * w(3.3);
dicht("hand w_inst = 24,84", w(4), 24.84, 0.01);
dicht("hand w_fin = 37,14", wFin, 37.14, 0.01);

function bouw(checkConfig) {
  const m = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: L, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, material: "GL28h", profile: "115x360", checkConfig: { performLtbCheck: false, ...checkConfig } }],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
    plates: [],
    loadCases: [{ id: 1, name: "G", type: "dead" }, { id: 2, name: "Q", type: "live", categorie: "A" }],
    loads: [
      { id: 1, type: "lineLoad", caseId: 1, beamId: 1, q: -3 },
      { id: 2, type: "lineLoad", caseId: 2, beamId: 1, q: -1 },
    ],
    selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
  };
  const { perCase } = solveAllCases(bouwMultiInput(m));
  const combinations = selecteerCombinaties(defaultCombinations(m.loadCases), m.beams, m.plates, { loadCases: m.loadCases }).actief;
  const combinationResults = new Map(combinations.map((c) => [c.id, combineResults(c, perCase)]));
  return buildTimberCheckInputs({
    nodes: m.nodes, beams: m.beams, supports: m.supports, combinations, combinationResults,
    loadCases: m.loadCases, gevallenMetLast: [...perCase.keys()],
  }).inputs[0];
}

log("\n[1] De bouwer geeft de zeeg door");
const zonder = bouw({});
const met = bouw({ preCamber_mm: 15 });
ok("zonder zeeg: geen pre_camber_mm (invoer als voorheen)", zonder && !("pre_camber_mm" in zonder));
ok("met zeeg: pre_camber_mm = 15", met?.pre_camber_mm === 15);
dicht("w_inst uit de solver = −24,84", met.deflection_inst_mm, -w(4), 0.02);

log("\n[2] De kern (toetsbrug)");
if (!existsSync(TOETSBRUG)) {
  ok("toetsbrug gevonden — bouw hem met `cargo build --release -p toetsbrug`", false, TOETSBRUG);
} else {
  const [a, b] = await new Promise((res, rej) => {
    const c = spawn(TOETSBRUG, [], { stdio: ["pipe", "pipe", "pipe"] });
    let o = ""; c.stdout.on("data", (d) => (o += d)); c.on("error", rej);
    c.on("close", (code) => (code === 0 ? res(JSON.parse(o)) : rej(new Error(`toetsbrug code ${code}`))));
    c.stdin.end(JSON.stringify({ opdracht: "check_timber_beams", inputs: [zonder, met] }));
  });
  const t = (r, id) => r.checks.find((c) => c.id === id)?.kind?.data;
  dicht("zonder zeeg: UC w_fin = 37,14/28,8 = 1,290", t(a, "deflection_w_fin")?.uc?.uc, wFin / 28.8, 2e-3);
  dicht("met zeeg 15: UC w_net,fin = 22,14/28,8 = 0,769", t(b, "deflection_w_fin")?.uc?.uc, (wFin - 15) / 28.8, 2e-3);
  ok("de zeeg staat in de toets", t(b, "deflection_w_fin")?.notes?.some((n) => /Zeeg verrekend/.test(n)));
  ok("w_add verandert niet door de zeeg", JSON.stringify(t(a, "deflection_w_add")) === JSON.stringify(t(b, "deflection_w_add")));
}

log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

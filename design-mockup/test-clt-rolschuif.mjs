// Issue #232: rolschuif in de dwarslagen van kruislaaghout, toetsbaar met een
// GEDECLAREERDE f_v,rol,k en haar bron (ETA / productverklaring).
//
// ── HANDBEREKENING (controle 2026-10-26, B21, model OFS-016) ───────────────
// CLT 150 = 5 × 30 mm L/D/L/D/L, C24, b = 1000 mm, L = 4,5 m, klimaatklasse 1,
// middellang. Alleen lengtelagen dragend:
//   I_ef = 3·1000·30³/12 + 2·1000·30·60² = 222,75·10⁶ mm⁴
//   V = 18 kN: τ_rol = V·S/(I·b), S = 1000·30·60 = 1,8·10⁶ mm³
//        = 18 000·1,8·10⁶/(222,75·10⁶·1000) = 0,14545 N/mm²
//   f_v,rol,d = 0,8·1,1/1,3 = 0,67692 N/mm² → UC = 0,2149
// Zonder f_v_rol_k: geen UC en de melding "NIET GETOETST".
//
// Draaien met: node scripts/run-tests.mjs --filter=clt-rolschuif

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
const { keurCheckConfig } = await import("./src/mcp/valideerModel.ts");

let passed = 0, failed = 0;
const log = (s = "") => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
}
function dicht(naam, gemeten, verwacht, tolRel) {
  ok(naam, Number.isFinite(gemeten) && Math.abs(gemeten - verwacht) <= tolRel * Math.abs(verwacht),
    `${Number(gemeten).toFixed(5)} vs ${verwacht.toFixed(5)}`);
}

const I = 3 * 1000 * 30 ** 3 / 12 + 2 * 1000 * 30 * 60 ** 2;
const TAU = 18000 * (1000 * 30 * 60) / (I * 1000);
const FD = 0.8 * 1.1 / 1.3;
dicht("hand I_ef = 222,75·10⁶", I / 1e6, 222.75, 1e-12);
dicht("hand τ_rol = 0,14545", TAU, 0.145455, 1e-4);
dicht("hand UC = 0,2149", TAU / FD, 0.21488, 1e-3);

log("\n[1] De bouwer geeft f_v_rol_k en de bron alleen door als ze zijn opgegeven");
function bouw(checkConfig) {
  const m = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 4500, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, material: "C24", profile: "CLT 30/30/30/30/30", ...(checkConfig ? { checkConfig } : {}) }],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
    plates: [], loadCases: [{ id: 1, name: "G", type: "dead" }],
    loads: [{ id: 1, type: "lineLoad", caseId: 1, beamId: 1, q: -4 }],
    selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
  };
  const { perCase } = solveAllCases(bouwMultiInput(m));
  const combinations = selecteerCombinaties(defaultCombinations(m.loadCases), m.beams, m.plates, { loadCases: m.loadCases }).actief;
  const combinationResults = new Map(combinations.map((c) => [c.id, combineResults(c, perCase)]));
  return buildCltCheckInputs({
    nodes: m.nodes, beams: m.beams, supports: m.supports, combinations, combinationResults,
    loadCases: m.loadCases, gevallenMetLast: [...perCase.keys()],
  }).inputs[0];
}
const zonder = bouw();
ok("zonder opgave: geen f_v_rol_k in de invoer", zonder && !("f_v_rol_k" in zonder) && !("f_v_rol_k_bron" in zonder));
const met = bouw({ cltFvRolK: 1.1, cltFvRolKBron: "ETA-voorbeeld" });
ok("met opgave: f_v_rol_k = 1,1 en de bron gaan mee", met?.f_v_rol_k === 1.1 && met?.f_v_rol_k_bron === "ETA-voorbeeld");

log("\n[2] De veldpoort");
const f = (cc) => keurCheckConfig(cc, "check_config.1");
ok("geldig: waarde met bron", f({ cltFvRolK: 1.1, cltFvRolKBron: "ETA" }).length === 0);
ok("waarde zonder bron wordt geweigerd", /cltFvRolKBron.*verplicht/.test(f({ cltFvRolK: 1.1 }).join(" ")));
ok("waarde 0 wordt geweigerd", /cltFvRolK/.test(f({ cltFvRolK: 0, cltFvRolKBron: "ETA" }).join(" ")));

log("\n[3] De kern (toetsbrug) tegen de handberekening");
if (!existsSync(TOETSBRUG)) {
  ok("toetsbrug gevonden — bouw hem met `cargo build --release -p toetsbrug`", false, TOETSBRUG);
} else {
  const punt = (x, v, my) => ({ combination_id: 1, position_mm: x, forces: { n_ed: 0, vy_ed: 0, vz_ed: v, mt_ed: 0, my_ed: my, mz_ed: 0 } });
  const basis = {
    beam_id: 1,
    layup: { width_mm: 1000, layers: [0, 1, 2, 3, 4].map((i) => ({ thickness_mm: 30, orientation: i % 2 ? "Transverse" : "Longitudinal", strength_class: "C24" })) },
    service_class: "Sc1", load_duration: "MediumTerm", length_m: 4.5,
    forces_envelope: [punt(0, 18, 0), punt(2250, 0, 20.25), punt(4500, -18, 0)],
  };
  const uit = await new Promise((res, rej) => {
    const c = spawn(TOETSBRUG, [], { stdio: ["pipe", "pipe", "pipe"] });
    let o = ""; c.stdout.on("data", (d) => (o += d)); c.on("error", rej);
    c.on("close", (code) => (code === 0 ? res(JSON.parse(o)) : rej(new Error(`toetsbrug code ${code}`))));
    c.stdin.end(JSON.stringify({ opdracht: "check_clt_beams", inputs: [basis, { ...basis, f_v_rol_k: 1.1, f_v_rol_k_bron: "ETA-voorbeeld" }] }));
  });
  const rol = (r) => r.checks.find((c) => c.id === "clt_rolschuif_laag_2")?.kind?.data;
  const a = rol(uit[0]), b = rol(uit[1]);
  dicht("τ_rol in laag 2 = 0,14545", a?.value, TAU, 1e-4);
  ok("zonder f_v_rol_k: geen UC en 'NIET GETOETST'", a?.uc == null && a?.notes?.some((n) => /NIET GETOETST/.test(n)));
  dicht("met f_v_rol_k = 1,1: UC = 0,2149", b?.uc?.uc, TAU / FD, 1e-4);
  ok("de bron staat in de toets", b?.notes?.some((n) => n.includes("ETA-voorbeeld")));
  dicht("buiging blijft maatgevend: uc_max = 0,4616", uit[1].uc_max, 0.4616, 1e-3);
}

log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

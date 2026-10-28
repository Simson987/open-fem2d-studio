// Issue #5: aluminium volgens NEN-EN 1999-1-1 door de hele keten —
// materiaal en profielnaam → solver (E = 70 000) → bouwer → toetsbrug.
//
// ── HANDBEREKENING ─────────────────────────────────────────────────────────
// Ligger op twee steunpunten, L = 4,0 m, ALU-I 200x100x6x10 in EN AW-6063 T6
// (tabel 3.2b: f_o = 160, f_u = 195 N/mm²), q_k = 5 kN/m (permanent).
//   A   = 2·100·10 + 180·6 = 3080 mm²
//   I_y = (100·200³ − 94·180³)/12 = 20 982 667 mm⁴
//   BGT: w = 5 q L⁴ / (384 E I) = 5·5·4000⁴/(384·70 000·20 982 667) = 11,347 mm
//   Buiging (6.2.5): flens β = 4,7 ≤ 4,5ε … 5,625 → klasse 2, lijf 0,4·30 = 12 → klasse 1;
//   M_Rd = min(W_pl f_o/γ_M1; W_el f_u/γ_M2)
//        = min(238 600·160/1,1; 209 826,7·195/1,25) = 32,733 kNm
//   UC = M_Ed / M_Rd met M_Ed = γ·q·L²/8 uit de UGT-combinatie van de app.
//
// Draaien met: node scripts/run-tests.mjs --filter=aluminium-check

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HIER, "..");
const TOETSBRUG = join(REPO, "src-tauri", "target", "release", process.platform === "win32" ? "toetsbrug.exe" : "toetsbrug");

const { solveAllCases } = await import("./src/components/fem/solver/engine.ts");
const { defaultCombinations, combineResults } = await import("./src/components/fem/solver/combinations.ts");
const { selecteerCombinaties } = await import("./src/lib/combinatieSelectie.ts");
const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");
const { buildAluminiumCheckInputs, aluminiumDoorsnedeVanProfiel } = await import("./src/lib/aluminiumCheckBuilder.ts");
const { parseAluminiumProfiel, aluminiumGrootheden } = await import("./src/lib/aluminiumProfiel.ts");
const { ALUMINIUM_LEGERINGEN, parseAluminiumMateriaal } = await import("./src/lib/aluminiumMateriaal.ts");
const { resolveSection } = await import("./src/lib/sectionResolver.ts");
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

const A = 2 * 100 * 10 + 180 * 6;
const IY = (100 * 200 ** 3 - 94 * 180 ** 3) / 12;
const W_HAND = 5 * 5 * 4000 ** 4 / (384 * 70000 * IY);
const M_RD = Math.min(238600 * 160 / 1.1, (IY / 100) * 195 / 1.25);
dicht("hand I_y = 20 982 667 mm⁴", IY, 20982666.67, 1e-9);
dicht("hand w = 11,347 mm", W_HAND, 11.3472, 1e-4);
dicht("hand M_Rd = 32,733 kNm", M_RD / 1e6, 32.73296, 1e-6);

log("\n[1] Materiaal en profielnaam");
ok("vier legeringen uit tabel 3.2b", ALUMINIUM_LEGERINGEN.length === 4);
ok("oude schrijfwijze ALU:EN AW-6063-T6 blijft herkend", parseAluminiumMateriaal("ALU:EN AW-6063-T6")?.aanduiding === "EN AW-6063 T6");
ok("onbekende legering → null (geen stille stijfheid)", parseAluminiumMateriaal("ALU:EN AW-7075 T6") === null);
const iProfiel = parseAluminiumProfiel("ALU-I 200x100x6x10");
ok("ALU-I wordt gelezen", iProfiel?.vorm === "IProfiel" && iProfiel.tf_mm === 10);
dicht("ALU-I: A = 3080 mm²", aluminiumGrootheden(iProfiel).A, A, 1e-12);
dicht("ALU-I: I_y", aluminiumGrootheden(iProfiel).Iy, IY, 1e-12);
// Koker 120×60×4: A = 60·120 − 52·112 = 1376 mm².
const sec = resolveSection("ALU:EN AW-6082 T6", "ALU-K 120x60x4");
ok("solver: koker met E = 70 000 en A = 1376", sec.E === 70000 && sec.A === 1376, `${sec.E} / ${sec.A}`);
ok("ongeldige maat (2t ≥ h) wordt geen profiel", parseAluminiumProfiel("ALU-K 8x60x4") === null);
ok("catalogus-I wordt een I zonder afrondingen", aluminiumDoorsnedeVanProfiel("HEA 200")?.vorm === "IProfiel");
ok("RHS uit de staalcatalogus wordt (nog) niet getoetst", typeof aluminiumDoorsnedeVanProfiel("RHS 100x50x4") === "string");

log("\n[2] De veldpoort kent de twee aluminiumvelden");
const f = (cc) => keurCheckConfig(cc, "check_config.1");
ok("aluLasstatus 'geen' en 'gelast' zijn geldig", f({ aluLasstatus: "geen" }).length === 0 && f({ aluLasstatus: "gelast", aluZijdelingsGesteund: true }).length === 0);
ok("aluLasstatus 'ja' wordt geweigerd", f({ aluLasstatus: "ja" }).length > 0);
ok("aluZijdelingsGesteund moet een boolean zijn", f({ aluZijdelingsGesteund: "ja" }).length > 0);

log("\n[3] Solver en bouwer");
function bouw(checkConfig, material = "ALU:EN AW-6063 T6", profile = "ALU-I 200x100x6x10") {
  const m = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 4000, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, material, profile, ...(checkConfig ? { checkConfig } : {}) }],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
    plates: [], loadCases: [{ id: 1, name: "G", type: "dead" }],
    loads: [{ id: 1, type: "lineLoad", caseId: 1, beamId: 1, q: -5 }],
    selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
  };
  const { perCase } = solveAllCases(bouwMultiInput(m));
  const combinations = selecteerCombinaties(defaultCombinations(m.loadCases), m.beams, m.plates, { loadCases: m.loadCases }).actief;
  const combinationResults = new Map(combinations.map((c) => [c.id, combineResults(c, perCase)]));
  return buildAluminiumCheckInputs({ nodes: m.nodes, beams: m.beams, combinations, combinationResults });
}
const onbekend = bouw(undefined).inputs[0];
ok("zonder opgave: lasstatus 'Onbekend' (nooit stil ongelast)", onbekend?.lasstatus === "Onbekend");
ok("doorsnede I 200×100×6×10", onbekend?.doorsnede?.vorm === "IProfiel" && onbekend.doorsnede.h_mm === 200);
ok("kniklengten zonder opgave = staaflengte 4,0 m", onbekend?.buckling_length_y_m === 4 && onbekend?.buckling_length_z_m === 4);
ok("zonder eigen grens geen doorbuigingsinvoer", onbekend && !("deflection_mm" in onbekend));
const volledig = bouw({ aluLasstatus: "geen", aluZijdelingsGesteund: true, deflectionClass: "custom", deflectionLimitNumerator: 250 }).inputs[0];
ok("lasstatus 'Geen' en zijdelings gesteund gaan mee", volledig?.lasstatus === "Geen" && volledig?.zijdelings_gesteund === true);
// De BGT-combinatie van één permanent geval is G·1,0: w moet de handwaarde zijn
// — met E = 70 000, niet met staal-E (dan 3,78 mm).
dicht("BGT-doorbuiging = 5qL⁴/(384·70 000·I) = 11,347 mm", volledig?.deflection_mm, W_HAND, 2e-3);
let solverWeigert = false;
try { bouw(undefined, "ALU:EN AW-7075 T6"); } catch (e) { solverWeigert = /niet ondersteund/.test(String(e)); }
ok("onbekende legering: de solver weigert (geen staal-E)", solverWeigert);
const weg = buildAluminiumCheckInputs({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 4000, z: 0 }],
  beams: [{ id: 1, from: 1, to: 2, material: "ALU:EN AW-7075 T6", profile: "ALU-I 200x100x6x10" }],
  combinations: [], combinationResults: new Map(),
});
ok("onbekende legering: de bouwer slaat over met reden", weg.inputs.length === 0 && /niet ondersteund/.test(weg.skipped[0]?.reason ?? ""));

log("\n[4] De kern (toetsbrug) tegen de handberekening");
if (!existsSync(TOETSBRUG)) {
  ok("toetsbrug gevonden — bouw hem met `cargo build --release -p toetsbrug`", false, TOETSBRUG);
} else {
  const roep = (opdracht, inputs) => new Promise((res, rej) => {
    const c = spawn(TOETSBRUG, [], { stdio: ["pipe", "pipe", "pipe"] });
    let o = ""; c.stdout.on("data", (d) => (o += d)); c.on("error", rej);
    c.on("close", (code) => (code === 0 ? res(JSON.parse(o)) : rej(new Error(`toetsbrug code ${code}: ${o}`))));
    c.stdin.end(JSON.stringify({ opdracht, inputs }));
  });
  const lijst = await roep("list_aluminium_alloys");
  ok("de legeringen in de app zijn die van de kern",
    JSON.stringify([...new Set(lijst.map((l) => l.aanduiding))]) === JSON.stringify([...ALUMINIUM_LEGERINGEN]));
  const [r0, r1] = await roep("check_aluminium_beams", [onbekend, volledig]);
  const mEd = Math.max(...volledig.forces_envelope.map((p) => Math.abs(p.forces.my_ed))) * 1e6;
  const uc = (r, id) => r.checks.find((c) => c.id === id)?.kind?.data?.uc?.uc;
  dicht("buiging ongelast: UC = M_Ed / 32,733 kNm", uc(r1, "alu_buiging"), mEd / M_RD, 1e-9);
  ok("ongelast, zijdelings gesteund, alles getoetst → status Ok", r1.status === "Ok" && r1.niet_getoetst.length === 0, r1.niet_getoetst.join("; "));
  ok("lasstatus onbekend → nooit Ok", r0.status !== "Ok" && r0.niet_getoetst.some((s) => s.includes("lasstatus")));
  // Onbekend rekent veilig met de HAZ: klasse 2 → M_o = ρ_o,haz·W_pl·f_o/γ_M1 met ρ_o,haz = 0,41.
  const mHaz = Math.min(0.41 * 238600 * 160 / 1.1, r0.grootheden.w_net_mm3 * 195 / 1.25);
  dicht("onbekend: buiging met HAZ-reductie (ρ_o,haz = 0,41)", uc(r0, "alu_buiging"), mEd / mHaz, 1e-9);
  ok("onbekend: kip niet getoetst gemeld", r0.niet_getoetst.some((s) => s.includes("kip")));
}

log("\n[5] Bron: drie wegen geregistreerd");
const lib = readFileSync(join(REPO, "src-tauri", "src", "lib.rs"), "utf8");
ok("Tauri: check_aluminium_beams en list_aluminium_alloys in generate_handler!",
  /generate_handler!\[[\s\S]*check_aluminium_beams,[\s\S]*\]/.test(lib) && /list_aluminium_alloys,/.test(lib));

log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);

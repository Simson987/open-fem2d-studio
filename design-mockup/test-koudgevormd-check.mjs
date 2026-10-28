// Issue #4: koudgevormde profielen volgens NEN-EN 1993-1-3 door de hele keten —
// materiaal en profielnaam → solver (E = 210 000, hartlijnmodel) → bouwer → toetsbrug.
//
// ── HANDBEREKENING ─────────────────────────────────────────────────────────
// Ligger op twee steunpunten, L = 4,0 m, KV-C 200x70x20x2 r1.5 in S350GD
// (tabel 3.1a: f_yb = 350, f_u = 420 N/mm²), q_k = 5 kN/m (permanent).
//   Hartlijnmaten h_p = 198, b_p = 68, c_p = 19 mm; r = 1,5 ≤ 0,1·19 → δ = 0 (§5.1(3))
//   A   = 2·(198 + 2·68 + 2·19) = 744 mm²
//   I_y = 2·198³/12 + 2·68·2·99² + 2·(2·19³/12 + 19·2·89,5²) = 4 570 669 mm⁴
//   BGT: w = 5 q L⁴ / (384 E I) = 5·5·4000⁴/(384·210 000·4 570 669) = 17,364 mm
//   Buiging (6.1.4.1): W_eff = 40 727,7 mm³ (effectieve doorsnede met χ_d = 0,77395
//   van de bovenverstijver en ρ = 0,96304 van het lijf, zie
//   nen-en-1993-1-3/tests/handberekening.rs) → M_c,Rd = 40 727,7·350/1,0 = 14,2547 kNm
//   UC = M_Ed / M_c,Rd met M_Ed uit de UGT-combinatie van de app.
//
// Draaien met: node scripts/run-tests.mjs --filter=koudgevormd-check

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
const { buildKoudgevormdCheckInputs } = await import("./src/lib/koudgevormdCheckBuilder.ts");
const { parseKoudgevormdProfiel, koudgevormdGrootheden, koudgevormdProfielNaam } = await import("./src/lib/koudgevormdProfiel.ts");
const { KOUDGEVORMD_STAALSOORTEN, parseKoudgevormdMateriaal } = await import("./src/lib/koudgevormdMateriaal.ts");
const { resolveSection } = await import("./src/lib/sectionResolver.ts");
const { keurCheckConfig } = await import("./src/mcp/valideerModel.ts");
const { checkSoort, normAanduiding } = await import("./src/lib/checkTypes.ts");

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

const PROFIEL = "KV-C 200x70x20x2 r1.5";
const A = 744;
const IY = 2 * 198 ** 3 / 12 + 2 * 68 * 2 * 99 ** 2 + 2 * (2 * 19 ** 3 / 12 + 19 * 2 * 89.5 ** 2);
const W_HAND = 5 * 5 * 4000 ** 4 / (384 * 210000 * IY);
const M_RD = 40727.70145311495 * 350;
dicht("hand I_y = 4 570 669 mm⁴", IY, 4570669.333, 1e-9);
dicht("hand w = 17,364 mm", W_HAND, 17.36399, 1e-6);

log("\n[1] Materiaal en profielnaam");
ok("acht staalsoorten uit tabel 3.1a", KOUDGEVORMD_STAALSOORTEN.length === 8);
ok("deklaag telt niet mee: KV:S350GD+Z", parseKoudgevormdMateriaal("KV:S350GD+Z")?.aanduiding === "S350GD");
ok("onbekende soort → null (geen stille stijfheid)", parseKoudgevormdMateriaal("KV:S550GD") === null);
const c = parseKoudgevormdProfiel(PROFIEL);
ok("KV-C wordt gelezen", c?.vorm === "CProfiel" && c.c_mm === 20 && c.r_mm === 1.5);
ok("naam ↔ doorsnede", koudgevormdProfielNaam(c) === PROFIEL);
ok("KV-Z en KV-U worden gelezen",
  parseKoudgevormdProfiel("KV-Z 200x70x20x2 r3")?.vorm === "ZProfiel" && parseKoudgevormdProfiel("KV-U 150x50x3 r3")?.vorm === "UProfiel");
ok("ongeldige lip (c ≥ h/2) wordt geen profiel", parseKoudgevormdProfiel("KV-C 200x70x100x2 r1") === null);
ok("zonder straal geen profiel (r is verplicht)", parseKoudgevormdProfiel("KV-C 200x70x20x2") === null);
dicht("A = 744 mm² (δ = 0)", koudgevormdGrootheden(c).A, A, 1e-12);
dicht("I_y (δ = 0)", koudgevormdGrootheden(c).Iy, IY, 1e-12);
// r = 3 > 0,10·19: δ = 0,43·4·3/372 (§5.1(4)) → A·(1 − δ)
const d3 = koudgevormdGrootheden(parseKoudgevormdProfiel("KV-C 200x70x20x2 r3"));
dicht("r = 3: δ = 0,013871 en A·(1 − δ)", d3.A, 744 * (1 - 0.43 * 4 * 3 / 372), 1e-12);
const sec = resolveSection("KV:S350GD", PROFIEL);
ok("solver: E = 210 000, A = 744", sec.E === 210000 && sec.A === A && sec.bron === "koudgevormd-profiel", `${sec.E} / ${sec.A} / ${sec.bron}`);
ok("KV-profiel met een warmgewalste staalsoort is geen koudgevormde doorsnede",
  resolveSection("S235", PROFIEL).bron === "default");

log("\n[2] De veldpoort kent kvZijdelingsGesteund");
const f = (cc) => keurCheckConfig(cc, "check_config.1");
ok("kvZijdelingsGesteund true is geldig", f({ kvZijdelingsGesteund: true }).length === 0);
ok("kvZijdelingsGesteund moet een boolean zijn", f({ kvZijdelingsGesteund: "ja" }).length > 0);

log("\n[3] Solver en bouwer");
function bouw(checkConfig, material = "KV:S350GD", profile = PROFIEL) {
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
  const combinationResults = new Map(combinations.map((cc) => [cc.id, combineResults(cc, perCase)]));
  return buildKoudgevormdCheckInputs({ nodes: m.nodes, beams: m.beams, combinations, combinationResults });
}
const kaal = bouw(undefined).inputs[0];
ok("zonder opgave: niet zijdelings gesteund", kaal?.zijdelings_gesteund === false);
ok("doorsnede C 200×70×20×2", kaal?.doorsnede?.vorm === "CProfiel" && kaal.doorsnede.h_mm === 200);
ok("kniklengten zonder opgave = staaflengte 4,0 m; l_T aan de kern", kaal?.buckling_length_y_m === 4 && kaal?.buckling_length_z_m === 4 && !("buckling_length_t_m" in kaal));
const volledig = bouw({ kvZijdelingsGesteund: true, deflectionClass: "custom", deflectionLimitNumerator: 250 }).inputs[0];
ok("zijdelings gesteund gaat mee", volledig?.zijdelings_gesteund === true);
dicht("BGT-doorbuiging = 5qL⁴/(384·210 000·I) = 17,364 mm", volledig?.deflection_mm, W_HAND, 2e-3);
const weg = buildKoudgevormdCheckInputs({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 4000, z: 0 }],
  beams: [{ id: 1, from: 1, to: 2, material: "KV:S550GD", profile: PROFIEL }, { id: 2, from: 1, to: 2, material: "KV:S350GD", profile: "HEA 200" }],
  combinations: [], combinationResults: new Map(),
});
ok("onbekende soort en catalogusprofiel: de bouwer slaat over met reden",
  weg.inputs.length === 0 && /niet ondersteund/.test(weg.skipped[0]?.reason ?? "") && /geen geldig koudgevormd/.test(weg.skipped[1]?.reason ?? ""));

log("\n[4] De kern (toetsbrug) tegen de handberekening");
if (!existsSync(TOETSBRUG)) {
  ok("toetsbrug gevonden — bouw hem met `cargo build --release -p toetsbrug`", false, TOETSBRUG);
} else {
  const roep = (opdracht, inputs) => new Promise((res, rej) => {
    const p = spawn(TOETSBRUG, [], { stdio: ["pipe", "pipe", "pipe"] });
    let o = ""; p.stdout.on("data", (d) => (o += d)); p.on("error", rej);
    p.on("close", (code) => (code === 0 ? res(JSON.parse(o)) : rej(new Error(`toetsbrug code ${code}: ${o}`))));
    p.stdin.end(JSON.stringify({ opdracht, inputs }));
  });
  const lijst = await roep("list_koudgevormd_staalsoorten");
  ok("de staalsoorten in de app zijn die van de kern",
    JSON.stringify(lijst.map((l) => l.aanduiding)) === JSON.stringify([...KOUDGEVORMD_STAALSOORTEN]));
  const [r0, r1] = await roep("check_koudgevormd_beams", [kaal, volledig]);
  const mEd = Math.max(...volledig.forces_envelope.map((p) => Math.abs(p.forces.my_ed))) * 1e6;
  const uc = (r, id) => r.checks.find((x) => x.id === id)?.kind?.data?.uc?.uc;
  dicht("buiging: UC = M_Ed / 14,2547 kNm", uc(r1, "kv_buiging"), mEd / M_RD, 1e-9);
  dicht("kern en solver zien dezelfde A en I_y", r1.grootheden.i_y_mm4, IY, 1e-12);
  // Doorbuiging: w·I_y/I_y,eff tegen L/250 = 16 mm.
  dicht("doorbuiging: w·I_y/I_y,eff / (L/250)", uc(r1, "kv_doorbuiging"),
    volledig.deflection_mm * (IY / r1.effectief_buiging.i_y_eff_mm4) / 16, 1e-9);
  ok("zijdelings gesteund en alles getoetst → status volgt de UC",
    r1.niet_getoetst.length === 0 && r1.status === (r1.uc_max <= 1 ? "Ok" : "NotOk"), r1.niet_getoetst.join("; "));
  ok("zonder steun → nooit Ok, kip gemeld", r0.status !== "Ok" && r0.niet_getoetst.some((s) => s.includes("kip")));
  ok("het resultaat heet koudgevormd en draagt EN 1993-1-3", checkSoort(r1) === "koudgevormd" && normAanduiding(r1) === "EN 1993-1-3");
}

log("\n[5] Bron: drie wegen geregistreerd");
const lib = readFileSync(join(REPO, "src-tauri", "src", "lib.rs"), "utf8");
ok("Tauri: check_koudgevormd_beams en list_koudgevormd_staalsoorten in generate_handler!",
  /generate_handler!\[[\s\S]*check_koudgevormd_beams,[\s\S]*\]/.test(lib) && /list_koudgevormd_staalsoorten,/.test(lib));

log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);

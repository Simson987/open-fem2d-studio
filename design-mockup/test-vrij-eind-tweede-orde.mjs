// Een VRIJ staafeind en de tweede-orde-berekening met scheefstand: welke
// kniklengte de toets neemt, langs alle wegen.
//
// Een vrijstaande kolom zonder opgegeven kniklengte knikt zijdelings met
// L_cr = 2·L. Zit die zijdelingse uitbuiging al in de krachten — tweede orde
// (P-Δ) MET scheefstand — dan wordt de staaf getoetst met de systeemlengte L
// (NEN-EN 1993-1-1 5.2.2(7)b); 2·L zou de zijdelingse knik dubbel tellen. De
// bouwer zegt dat de kern per as (`zijdelingse_knik_in_analyse`), en alleen
//  - voor STAAL: hout houdt 2·L, want NEN-EN 1995-1-1 eist bij tweede orde
//    E_d = E_mean/γ_M en een boogimperfectie, en onze P-Δ rekent met E_mean;
//  - bij een STAANDE staaf: de scheefstand is een horizontale metgezel H = φ·V
//    bij de verticale last en stoot de knikvorm van een liggende uitkraging
//    niet aan;
//  - als de φ van de berekening minstens de EIGEN φ van de kolom is
//    (EN 1993-1-1 (5.5) met h = haar lengte en m = 1): een kolom met een vrije
//    kop hangt nergens aan en middelt haar scheefstand met niets.
// In 2D blijft z (uit het vlak) op 2·L.
//
// Tot oktober 2026 zette de 2D-houtbouwer `is_cantilever` hard op false: een
// vrijstaande houten kolom kreeg L_cr = L bij eerste orde.
//
// Handwaarden (zie ook de Rust-tests `vrij_eind_tweede_orde` in steel-check en
// timber-check):
//   HEA200 S235, L = 3 m, N_Ed = 200 kN: A = 5383 mm², i_y = 82,8 mm,
//   i_z = 49,8 mm; χ_z(6 m, kromme c) = 0,3960 → N_b,Rd = 501,0 kN, UC 0,399;
//   χ_z(3 m) = 0,7605 → N_b,Rd = 962,0 kN, UC 0,208.
//   C24 100 × 160, L = 2 m, N_d = 20 kN, permanente last (k_mod = 0,6, γ_M = 1,3,
//   f_c,0,d = 9,692 N/mm², σ_c,0,d = 1,25 N/mm²): k_c,z(4 m) = 0,1663 →
//   (6.24) 0,7754; k_c,z(2 m) = 0,5619 → (6.24) 0,2295.
//
// Uitvoeren: npx tsx test-vrij-eind-tweede-orde.mjs

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HIER, "..");
const win = process.platform === "win32";
const TOETSBRUG = join(REPO, "src-tauri", "target", "release", win ? "toetsbrug.exe" : "toetsbrug");
const MCP_SERVER = join(REPO, "src-tauri", "target", "release", win ? "openaec-mcp-server.exe" : "openaec-mcp-server");

const { solveAllCases } = await import("./src/components/fem/solver/engine.ts");
const { combineResults } = await import("./src/components/fem/solver/combinations.ts");
const { buildSteelCheckInputs, profileLookupKey } = await import("./src/lib/steelCheckBuilder.ts");
const { buildTimberCheckInputs } = await import("./src/lib/timberCheckBuilder.ts");
const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");
const { zijdelingseKnikInVlakModel } = await import("./src/components/fem/solver/alphaCr.ts");
const { phiLosseKolom } = await import("./src/lib/scheefstandNorm.ts");
const { openFem3DZijdelingseKnik } = await import("./src/components/openFem3d/openFem3dUitkraging.ts");
const { buildOpenFem3DSteelCheckInputs } = await import("./src/components/openFem3d/openFem3dSteelCheck.ts");
const { buildOpenFem3DTimberCheckInputs } = await import("./src/components/openFem3d/openFem3dTimberCheck.ts");

let passed = 0, failed = 0;
const log = (s = "") => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
}
function dicht(naam, gemeten, verwacht, tol) {
  ok(naam, Number.isFinite(gemeten) && Math.abs(gemeten - verwacht) <= tol,
    `${Number(gemeten).toFixed(4)} tegen ${verwacht.toFixed(4)}`);
}

// ── Handwaarden ─────────────────────────────────────────────────────────────
function chiStaal(lcrMm, iMm, alpha) {
  const lb = lcrMm / iMm / 93.9;
  const phi = 0.5 * (1 + alpha * (lb - 0.2) + lb * lb);
  return Math.min(1, 1 / (phi + Math.sqrt(phi * phi - lb * lb)));
}
function kcHout(lcrMm, iMm) {
  const lr = lcrMm / iMm / Math.PI * Math.sqrt(21 / 7400);
  const k = 0.5 * (1 + 0.2 * (lr - 0.3) + lr * lr);
  return Math.min(1, 1 / (k + Math.sqrt(k * k - lr * lr)));
}
const NB_RD_2L = chiStaal(6000, 49.8, 0.49) * 5383 * 235 / 1000;
const NB_RD_L = chiStaal(3000, 49.8, 0.49) * 5383 * 235 / 1000;
// k_mod = 0,6: de last is permanent (belastinggeval "dead"), klimaatklasse 1.
const FC0D = 0.6 * 21 / 1.3;
const SIGMA = 20e3 / (100 * 160);
const VGL_2L = SIGMA / (kcHout(4000, 100 / Math.sqrt(12)) * FC0D);
const VGL_L = SIGMA / (kcHout(2000, 100 / Math.sqrt(12)) * FC0D);
dicht("hand: N_b,Rd,z HEA200 bij 2·L = 501,0 kN", NB_RD_2L, 501.0, 0.5);
dicht("hand: N_b,Rd,z HEA200 bij L = 962,0 kN", NB_RD_L, 962.0, 0.8);
dicht("hand: (6.24) C24 100×160 bij 2·L = 0,7754", VGL_2L, 0.7754, 5e-4);
dicht("hand: (6.24) C24 100×160 bij L = 0,2295", VGL_L, 0.2295, 5e-4);

// ── De kern ─────────────────────────────────────────────────────────────────
const heeftKern = existsSync(TOETSBRUG);
if (!heeftKern) ok("toetsbrug gevonden — bouw hem met `cargo build --release -p toetsbrug`", false, TOETSBRUG);
function kern(inputs, opdracht) {
  const r = spawnSync(TOETSBRUG, [], {
    input: JSON.stringify({ opdracht, inputs }), encoding: "utf8", maxBuffer: 256 << 20,
  });
  if (r.status !== 0 || !r.stdout) throw new Error(`toetsbrug faalde (status ${r.status}, ${r.error?.message ?? "geen fout"}): ${(r.stderr ?? "").slice(0, 300)}`);
  const uit = JSON.parse(r.stdout);
  if (uit.fout) throw new Error(uit.fout);
  return uit;
}
const toets = (res, id) => res?.checks?.find((c) => c.id === id)?.kind?.data;
const stap = (data, id) => data?.deelstappen?.find((d) => d.id === id);
const lcr = (data, as) => stap(data, `l_cr_${as}`)?.value;

// ── 2D-model en bouwer zoals de toetsstore ──────────────────────────────────
const PROFIELEN = JSON.parse(
  readFileSync(join(REPO, "src-tauri", "crates", "steel-profiles", "data", "profiles.json"), "utf8"),
);
const profileDb = new Map();
for (const p of PROFIELEN) {
  const k = profileLookupKey(p.name);
  if (!profileDb.has(k)) profileDb.set(k, p);
}
const combos = [
  { id: 1, name: "UGT", type: "uls", formula: "1.0G", factors: new Map([[1, 1.0]]) },
  { id: 2, name: "BGT karakteristiek", type: "sls", formula: "G", factors: new Map([[1, 1]]),
    standaard: { soort: "6.14b", leidend: null, gevolgklasse: "CC2", kenmerk: "" } },
];
const G = [{ id: 1, name: "G", type: "dead" }];
const EERSTE_ORDE = { analysetype: "eersteOrde", alphaCr: [], scheefstandAan: true, scheefstandPhi: 1 / 200 };
const TWEEDE_ZONDER = { analysetype: "tweedeOrdeGeometrisch", alphaCr: [], scheefstandAan: false };
const TWEEDE_MET = { analysetype: "tweedeOrdeGeometrisch", alphaCr: [], scheefstandAan: true, scheefstandPhi: 1 / 200 };
const TWEEDE_KLEIN = { ...TWEEDE_MET, scheefstandPhi: 1 / 346 };
const TWEEDE_ONBEKEND = { analysetype: "tweedeOrdeGeometrisch", alphaCr: [], scheefstandAan: true };
const FYSISCH_MET = { analysetype: "tweedeOrdeFysisch", alphaCr: [], scheefstandAan: true, scheefstandPhi: 1 / 200 };

/** Kolom 0 → L omhoog, ingeklemd aan de voet, vrije kop met F omlaag. */
const kolom = (lMm, materiaal, profiel, fKn) => ({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: lMm }],
  beams: [{ id: 1, from: 1, to: 2, material: materiaal, profile: profiel }],
  supports: [{ nodeId: 1, type: "fixed" }],
  loads: [{ id: 1, type: "pointForce", nodeId: 2, caseId: 1, fz: -fKn }],
});
/** Liggende uitkraging met druk in de as. */
const liggend = {
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 3000, z: 0 }],
  beams: [{ id: 1, from: 1, to: 2, material: "S235", profile: "HEA200" }],
  supports: [{ nodeId: 1, type: "fixed" }],
  loads: [{ id: 1, type: "pointForce", nodeId: 2, caseId: 1, fx: -200 }],
};

function bouw(m, soort, stabiliteit) {
  const mi = bouwMultiInput({
    nodes: m.nodes, beams: m.beams, supports: m.supports, loads: m.loads, loadCases: G,
    plates: [], selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200,
    scheefstandRichting: 1,
  });
  const { perCase } = solveAllCases(mi);
  const combinationResults = new Map(combos.map((c) => [c.id, combineResults(c, perCase)]));
  const data = {
    nodes: m.nodes, beams: m.beams, alleBeams: m.beams, supports: m.supports, plates: [],
    combinations: combos, combinationResults, loadCases: G, stabiliteit,
  };
  return soort === "staal" ? buildSteelCheckInputs({ ...data, profileDb }) : buildTimberCheckInputs(data);
}
const notities = (i) => i?.staaf_notities ?? [];
const phiNotitie = (i) => notities(i).some((n) => /^VRIJ STAAFEIND, TWEEDE ORDE/.test(n) && /m = 1/.test(n));
const JSONg = (x) => JSON.stringify(x);

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] De regel: tweede orde MET scheefstand, een staande staaf, φ ≥ eigen φ, alleen om y");
// ─────────────────────────────────────────────────────────────────────────
dicht("hand: eigen φ van een kolom van 3 m = 1/200 (α_h = 2/√3 > 1 → 1, m = 1)", 1 / phiLosseKolom(3), 200, 1e-9);
dicht("hand: eigen φ van een kolom van 9 m = 1/300 (α_h = 2/√9 = 2/3)", 1 / phiLosseKolom(9), 300, 1e-9);
ok("eerste orde: niets", JSONg(zijdelingseKnikInVlakModel(EERSTE_ORDE, true, 3)) === "{}");
ok("tweede orde zonder scheefstand: niets", JSONg(zijdelingseKnikInVlakModel(TWEEDE_ZONDER, true, 3)) === "{}");
ok("geen stabiliteitsgegevens: niets", JSONg(zijdelingseKnikInVlakModel(undefined, true, 3)) === "{}");
ok("liggende staaf: niets", JSONg(zijdelingseKnikInVlakModel(TWEEDE_MET, false, 3)) === "{}");
ok("staande staaf, φ = 1/200 ≥ 1/200: y gedekt, z niet",
  JSONg(zijdelingseKnikInVlakModel(TWEEDE_MET, true, 3)) === JSONg({ veld: { y: true, z: false } }));
ok("fysisch niet-lineair telt ook als tweede orde",
  JSONg(zijdelingseKnikInVlakModel(FYSISCH_MET, true, 3)) === JSONg({ veld: { y: true, z: false } }));
{
  const b = zijdelingseKnikInVlakModel(TWEEDE_KLEIN, true, 3);
  ok("φ = 1/346 < 1/200: geen veld, wel een kanttekening met beide φ's",
    b.veld === undefined && /1\/346/.test(b.notitie ?? "") && /1\/200/.test(b.notitie ?? "") && /m = 1/.test(b.notitie ?? ""),
    b.notitie);
  const o = zijdelingseKnikInVlakModel(TWEEDE_ONBEKEND, true, 3);
  ok("φ onbekend: geen veld, wel een kanttekening", o.veld === undefined && /niet bekend/.test(o.notitie ?? ""));
  ok("kolom van 9 m met φ = 1/346 < 1/300: geen veld",
    zijdelingseKnikInVlakModel(TWEEDE_KLEIN, true, 9).veld === undefined);
  ok("kolom van 9 m met φ = 1/300: veld",
    zijdelingseKnikInVlakModel({ ...TWEEDE_MET, scheefstandPhi: 1 / 300 }, true, 9).veld !== undefined);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] Staal 2D: vrijstaande kolom HEA200 S235, 3 m, N = 200 kN");
// ─────────────────────────────────────────────────────────────────────────
for (const [naam, stab, lcrY, metNotitie] of [
  ["eerste orde", EERSTE_ORDE, 6000, false],
  ["tweede orde zonder scheefstand", TWEEDE_ZONDER, 6000, false],
  ["tweede orde met scheefstand φ = 1/200", TWEEDE_MET, 3000, false],
  ["tweede orde met scheefstand φ = 1/346 (model)", TWEEDE_KLEIN, 6000, true],
]) {
  const r = bouw(kolom(3000, "S235", "HEA200", 200), "staal", stab);
  const i = r.inputs[0];
  ok(`${naam}: kop vrij`, i?.staafeinden?.eind === "Vrij" && i.staafeinden.begin === "Gaffel", JSON.stringify(i?.staafeinden));
  ok(`${naam}: zijdelingse_knik_in_analyse ${lcrY === 3000 ? "{ y, niet z }" : "weggelaten"}`,
    lcrY === 3000
      ? JSON.stringify(i?.zijdelingse_knik_in_analyse) === JSON.stringify({ y: true, z: false })
      : i?.zijdelingse_knik_in_analyse === undefined,
    JSON.stringify(i?.zijdelingse_knik_in_analyse));
  ok(`${naam}: kanttekening over φ ${metNotitie ? "aanwezig" : "afwezig"}`, phiNotitie(i) === metNotitie);
  if (heeftKern) {
    const k = toets(kern(r.inputs, "check_steel_beams")[0], "6.3.1_buckling");
    dicht(`${naam}: kern L_cr,y`, lcr(k, "y"), lcrY, 1e-9);
    dicht(`${naam}: kern L_cr,z = 6000 mm (uit het vlak blijft 2·L)`, lcr(k, "z"), 6000, 1e-9);
    dicht(`${naam}: kern UC 6.3.1 = 200/501,0 (z maatgevend)`, k?.uc?.uc, 200 / NB_RD_2L, 2e-3);
  }
}
{
  // Eerste orde met α_cr < 10 en een vrij eind: niet "valt terug op de
  // systeemlengte" (de kern neemt 2·L), maar de eigen kanttekening: 2·L
  // veronderstelt een ingeklemde voet, anders L_cr,y uit α_cr.
  const laag = { ...EERSTE_ORDE, alphaCr: [{ naam: "UGT", status: "bepaald", alphaCr: 4 }] };
  const r = bouw(kolom(3000, "S235", "HEA200", 200), "staal", laag);
  const n = notities(r.inputs[0]).filter((x) => /^EERSTE ORDE MET α_cr/.test(x));
  ok("eerste orde met α_cr = 4, vrij eind: de kanttekening voor een vrij eind (2·L, ingeklemde voet, L_cr,y uit α_cr)",
    n.length === 1 && /heeft een vrij eind/.test(n[0]) && /volledig ingeklemde voet/.test(n[0])
      && /π·√\(EI\/\(α_cr·N_Ed\)\)/.test(n[0]) && !/valt terug op de systeemlengte/.test(n[0]), JSON.stringify(n));
  // Met een opgegeven L_cr,y geen kanttekening over α_cr en geen over φ.
  const opgegeven = kolom(3000, "S235", "HEA200", 200);
  opgegeven.beams[0].checkConfig = { bucklingLengthY_m: 4.5 };
  const o = bouw(opgegeven, "staal", laag).inputs[0];
  ok("eerste orde met α_cr = 4 en L_cr,y opgegeven: geen α_cr-kanttekening",
    !notities(o).some((x) => /^EERSTE ORDE MET α_cr/.test(x)));
  const ok2 = bouw(opgegeven, "staal", TWEEDE_KLEIN).inputs[0];
  ok("tweede orde, φ te klein maar L_cr,y opgegeven: geen φ-kanttekening (de kern neemt de opgave)",
    !phiNotitie(ok2), JSON.stringify(notities(ok2)));
}
{
  const r = bouw(liggend, "staal", TWEEDE_MET);
  const i = r.inputs[0];
  ok("liggende uitkraging met druk, tweede orde met scheefstand: geen veld (de scheefstand stoot haar knikvorm niet aan)",
    i?.staafeinden?.eind === "Vrij" && i?.zijdelingse_knik_in_analyse === undefined && !phiNotitie(i), JSON.stringify(i?.staafeinden));
  if (heeftKern) {
    const k = toets(kern(r.inputs, "check_steel_beams")[0], "6.3.1_buckling");
    dicht("liggende uitkraging: kern L_cr,y = 6000 mm", lcr(k, "y"), 6000, 1e-9);
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] Hout 2D: vrijstaande kolom C24 100×160, 2 m, N = 20 kN — altijd 2·L");
// ─────────────────────────────────────────────────────────────────────────
for (const [naam, stab] of [
  ["eerste orde", EERSTE_ORDE],
  ["tweede orde met scheefstand φ = 1/200", TWEEDE_MET],
]) {
  const r = bouw(kolom(2000, "C24", "100x160", 20), "hout", stab);
  const i = r.inputs[0];
  ok(`${naam}: is_cantilever = true (was hard false)`, i?.is_cantilever === true);
  ok(`${naam}: geen zijdelingse_knik_in_analyse (hout: E_d en boogimperfectie ontbreken)`,
    i?.zijdelingse_knik_in_analyse === undefined);
  if (heeftKern) {
    const k = toets(kern(r.inputs, "check_timber_beams")[0], "6.3.2_column_stability");
    dicht(`${naam}: kern L_cr,y = 4000 mm`, lcr(k, "y"), 4000, 1e-9);
    dicht(`${naam}: kern L_cr,z = 4000 mm`, lcr(k, "z"), 4000, 1e-9);
    dicht(`${naam}: kern (6.24) = 0,7754`, k?.uc?.uc, VGL_2L, 2e-4);
  }
}
{
  // Een ligger op twee steunpunten houdt de staaflengte: niets veranderd.
  const r = bouw({
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 2000, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, material: "C24", profile: "100x160" }],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
    loads: [{ id: 1, type: "lineLoad", caseId: 1, beamId: 1, q: -1 }],
  }, "hout", EERSTE_ORDE);
  ok("hout, ligger op twee steunpunten: is_cantilever = false", r.inputs[0]?.is_cantilever === false);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] 3D: P-Δ met scheefstand in X en Y, een staande stalen staaf, φ ≥ eigen φ");
// ─────────────────────────────────────────────────────────────────────────
const knopen3D = [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 3 }, { id: 3, x: 3, y: 0, z: 0 }];
const staand3D = { id: 1, startNodeId: 1, endNodeId: 2 };
const liggend3D = { id: 2, startNodeId: 1, endNodeId: 3 };
const ugt = (id, as) => ({ id, name: `UGT ${as ?? "zonder"}`, type: "uls", formula: "", factors: new Map([[1, 1]]),
  ...(as ? { scheefstandRichting: 1, scheefstandAs: as } : {}) });
const pDelta = () => "p-delta";
const XY = [ugt(1, "x"), ugt(2, "y")];
const knik3D = (uls, analyse, phi, staaf) => openFem3DZijdelingseKnik({ nodes: knopen3D }, uls, analyse, phi)(staaf);
ok("P-Δ, scheefstand X en Y, φ = 1/200, staande staaf: beide assen gedekt",
  JSONg(knik3D(XY, pDelta, 1 / 200, staand3D)) === JSONg({ veld: { y: true, z: true } }));
{
  const b = knik3D(XY, pDelta, 1 / 346, staand3D);
  ok("idem met φ = 1/346: geen veld, wel een kanttekening", !b.veld && /1\/346/.test(b.notitie ?? ""), b.notitie);
  const o = knik3D(XY, pDelta, undefined, staand3D);
  ok("idem zonder bekende φ: geen veld, wel een kanttekening", !o.veld && /niet bekend/.test(o.notitie ?? ""));
  // Een kolom 45° om haar as gedraaid: langs elke hoofdas werkt φ·0,707.
  // Met φ = 1/200 is dat 1/283 < 1/200; met φ = 1/140 is het 1/198 ≥ 1/200.
  const gedraaid = { ...staand3D, rollAngleRad: Math.PI / 4 };
  const g = knik3D(XY, pDelta, 1 / 200, gedraaid);
  ok("45° gedraaid, φ = 1/200: geen veld (langs de as 1/283), kanttekening noemt de draaiing",
    !g.veld && /45,0° om haar as/.test(g.notitie ?? "") && /1\/283/.test(g.notitie ?? ""), g.notitie);
  ok("45° gedraaid, φ = 1/140: veld (langs de as 1/198 ≥ 1/200)",
    JSONg(knik3D(XY, pDelta, 1 / 140, gedraaid)) === JSONg({ veld: { y: true, z: true } }));
  ok("90° gedraaid, φ = 1/200: veld (de assen vallen weer samen met X en Y)",
    JSONg(knik3D(XY, pDelta, 1 / 200, { ...staand3D, rollAngleRad: Math.PI / 2 })) === JSONg({ veld: { y: true, z: true } }));
}
ok("liggende staaf: niets", JSONg(knik3D(XY, pDelta, 1 / 200, liggend3D)) === "{}");
ok("lineair gerekend: niets", JSONg(knik3D(XY, () => "linear", 1 / 200, staand3D)) === "{}");
ok("scheefstand alleen in X: niets", JSONg(knik3D([ugt(1, "x")], pDelta, 1 / 200, staand3D)) === "{}");
ok("een UGT-combinatie zonder scheefstand: niets", JSONg(knik3D([...XY, ugt(3)], pDelta, 1 / 200, staand3D)) === "{}");
ok("geen UGT-combinaties: niets", JSONg(knik3D([], pDelta, 1 / 200, staand3D)) === "{}");

// De 3D-bouwers met een samengesteld resultaat: een vrijstaande kolom.
const kolom3D = (materiaal, profiel) => ({
  nodes: knopen3D.slice(0, 2),
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: profiel, material: materiaal }],
  supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
  loads: [], memberLoads: [],
});
const nul = (nodeId) => ({ nodeId, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 });
const resultaat3D = (analysis, nKn, lM) => ({
  analysis,
  displacements: [nul(1), nul(2)],
  memberForces: [{
    memberId: 1, lengthM: lM, nStartKn: -nKn, nEndKn: -nKn,
    vyStartKn: 0, vyEndKn: 0, vzStartKn: 0, vzEndKn: 0, torsionStartKnm: 0, torsionEndKnm: 0,
    myStartKnm: 0, myEndKnm: 0, mzStartKnm: 0, mzEndKnm: 0,
  }],
});
const set3D = (analysis, nKn, lM, combinaties, phi) => ({
  combinations: combinaties,
  results: new Map(combinaties.map((c) => [c.id, resultaat3D(analysis, nKn, lM)])),
  loadCases: [{ id: 1, type: "dead" }],
  ...(phi !== undefined ? { scheefstandPhi: phi } : {}),
});
for (const [naam, analysis, combinaties, phi, gedekt] of [
  ["P-Δ met scheefstand X en Y, φ = 1/200", "p-delta", XY, 1 / 200, true],
  ["P-Δ met scheefstand X en Y, φ = 1/346", "p-delta", XY, 1 / 346, false],
  ["lineair met scheefstand", "linear", XY, 1 / 200, false],
  ["P-Δ zonder scheefstand", "p-delta", [ugt(1)], undefined, false],
]) {
  const m = kolom3D("S235", "HEA200");
  const st = buildOpenFem3DSteelCheckInputs(m, resultaat3D(analysis, 200, 3), set3D(analysis, 200, 3, combinaties, phi));
  const i = st.inputs[0];
  ok(`3D staal, ${naam}: kop vrij`, i?.staafeinden?.eind === "Vrij", JSON.stringify(i?.staafeinden ?? st.skipped));
  ok(`3D staal, ${naam}: veld ${gedekt ? "{ y, z }" : "weggelaten"}`,
    gedekt ? JSON.stringify(i?.zijdelingse_knik_in_analyse) === JSON.stringify({ y: true, z: true })
      : i?.zijdelingse_knik_in_analyse === undefined, JSON.stringify(i?.zijdelingse_knik_in_analyse));
  if (phi === 1 / 346) ok(`3D staal, ${naam}: kanttekening over φ`, phiNotitie(i), JSON.stringify(notities(i)));
  if (heeftKern && i) {
    const k = toets(kern(st.inputs, "check_steel_beams")[0], "6.3.1_buckling");
    const l = gedekt ? 3000 : 6000;
    dicht(`3D staal, ${naam}: kern L_cr,y = L_cr,z = ${l} mm`, Math.max(lcr(k, "y"), lcr(k, "z")), l, 1e-9);
    dicht(`3D staal, ${naam}: kern UC 6.3.1`, k?.uc?.uc, 200 / (gedekt ? NB_RD_L : NB_RD_2L), 2e-3);
  }
  const h = buildOpenFem3DTimberCheckInputs(kolom3D("C24", "100x160"), resultaat3D(analysis, 20, 2), set3D(analysis, 20, 2, combinaties, phi));
  const j = h.inputs[0];
  ok(`3D hout, ${naam}: is_cantilever, geen veld (hout houdt 2·L)`,
    j?.is_cantilever === true && j?.zijdelingse_knik_in_analyse === undefined, JSON.stringify(j?.zijdelingse_knik_in_analyse ?? h.skipped));
  if (heeftKern && j) {
    const k = toets(kern(h.inputs, "check_timber_beams")[0], "6.3.2_column_stability");
    dicht(`3D hout, ${naam}: kern L_cr,z = 4000 mm`, lcr(k, "z"), 4000, 1e-9);
    dicht(`3D hout, ${naam}: kern (6.24) = 0,7754`, k?.uc?.uc, VGL_2L, 2e-4);
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[5] MCP: check_fem_model rekent P-Δ met scheefstand en kiest zelf");
// ─────────────────────────────────────────────────────────────────────────
function mcp(aanroepen) {
  return new Promise((klaar, mis) => {
    const k = spawn(MCP_SERVER, [], { stdio: ["pipe", "pipe", "pipe"] });
    const klok = setTimeout(() => { k.kill(); mis(new Error("MCP-server reageerde niet binnen 180 s")); }, 180_000);
    let buf = "";
    const antwoorden = new Map();
    k.on("error", (e) => { clearTimeout(klok); mis(e); });
    k.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const regel = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!regel) continue;
        const bericht = JSON.parse(regel);
        antwoorden.set(bericht.id, bericht);
        if (antwoorden.size === aanroepen.length + 1) {
          clearTimeout(klok);
          k.stdin.end();
          klaar(aanroepen.map((_, n) => antwoorden.get(n + 2)));
        }
      }
    });
    const schrijf = (o) => k.stdin.write(JSON.stringify(o) + "\n");
    schrijf({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-vrij-eind-tweede-orde", version: "1" } } });
    aanroepen.forEach((a, n) => schrijf({ jsonrpc: "2.0", id: n + 2, method: "tools/call", params: { name: a.tool, arguments: a.arguments } }));
  });
}
if (!existsSync(MCP_SERVER)) {
  ok("MCP-server gevonden — bouw hem met `cargo build --release -p openaec-mcp-server` (na `npm run build:sidecar`)", false, MCP_SERVER);
} else {
  // De UGT-combinatie 6.10a geeft 1,35·G: met G = 200/1,35 is N_Ed = 200 kN.
  // Scheefstand met de vaste noemer (de standaardbron): φ = 1/noemer.
  const model = (m, scheef, noemer = 200) => ({
    ...m, loads: m.loads.map((l) => ({ ...l, fz: l.fz / 1.35 })),
    loadCases: [{ id: 1, name: "Permanent", type: "dead" }], selfWeightEnabled: false,
    scheefstandEnabled: scheef, scheefstandNoemer: noemer,
  });
  const staal = kolom(3000, "S235", "HEA200", 200);
  const hout = kolom(2000, "C24", "100x160", 20);
  const tool = "check_fem_model";
  const [eerste, tweede, zonder, kleinePhi, houtEerste, houtTweede] = await mcp([
    { tool, arguments: { model: model(staal, true) } },
    { tool, arguments: { model: model(staal, true), nonlinear: true } },
    { tool, arguments: { model: model(staal, false), nonlinear: true } },
    { tool, arguments: { model: model(staal, true, 346), nonlinear: true } },
    { tool, arguments: { model: model(hout, true) } },
    { tool, arguments: { model: model(hout, true), nonlinear: true } },
  ]);
  const inhoud = (x) => x?.result?.structuredContent ?? JSON.parse(x?.result?.content?.[0]?.text ?? "null");
  for (const [naam, antwoord, lcrY] of [
    ["staal, eerste orde met scheefstand", eerste, 6000],
    ["staal, P-Δ met scheefstand φ = 1/200", tweede, 3000],
    ["staal, P-Δ zonder scheefstand", zonder, 6000],
    ["staal, P-Δ met scheefstand φ = 1/346 (kleiner dan de eigen 1/200)", kleinePhi, 6000],
  ]) {
    const d = inhoud(antwoord);
    ok(`MCP ${naam}: slaagt`, d && !antwoord?.result?.isError, JSON.stringify(antwoord?.error ?? antwoord?.result?.content?.[0]?.text ?? "").slice(0, 200));
    const k = toets(d?.results?.find((r) => r.beam_id === 1), "6.3.1_buckling");
    dicht(`MCP ${naam}: L_cr,y`, lcr(k, "y"), lcrY, 1e-9);
    dicht(`MCP ${naam}: L_cr,z = 6000 mm`, lcr(k, "z"), 6000, 1e-9);
    dicht(`MCP ${naam}: UC 6.3.1 = 200/501,0`, k?.uc?.uc, 200 / NB_RD_2L, 3e-3);
  }
  ok("MCP staal, φ = 1/346: de kanttekening over φ staat bij de kniktoets",
    (toets(inhoud(kleinePhi)?.results?.find((r) => r.beam_id === 1), "6.3.1_buckling")?.notes ?? [])
      .some((n) => /^VRIJ STAAFEIND, TWEEDE ORDE/.test(n) && /1\/346/.test(n)));
  for (const [naam, antwoord] of [
    ["hout, eerste orde", houtEerste],
    ["hout, P-Δ met scheefstand", houtTweede],
  ]) {
    const d = inhoud(antwoord);
    ok(`MCP ${naam}: slaagt`, d && !antwoord?.result?.isError);
    const k = toets(d?.timber_results?.find((r) => r.beam_id === 1), "6.3.2_column_stability");
    dicht(`MCP ${naam}: L_cr,y = 4000 mm (hout houdt 2·L)`, lcr(k, "y"), 4000, 1e-9);
    dicht(`MCP ${naam}: L_cr,z = 4000 mm (was 2000 mm vóór deze wijziging)`, lcr(k, "z"), 4000, 1e-9);
  }
}

log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);

// Issue #205: een houten staaf met een DOORLOPEND staafeind — een getrapte
// houten kolom.
//
// Staal kent drie soorten staafeinden: gaffel, vrij en doorlopend
// (`Staafeind::Doorlopend`): de staaf loopt zonder oplegging in het verlengde
// door in een staaf met een andere doorsnede of een ander materiaal. Hout
// kende alleen "vrij" (`is_cantilever`), en een getrapte kolom kreeg per deel
// de eigen lengte als kniklengte, alsof de overgang zijdelings gesteund is. Nu
// krijgt de houtkern de staafeinden, en weigert zij art. 6.3.2 (en 6.3.3)
// zonder opgegeven kniklengtes; de staaf is dan "niet volledig getoetst".
//
// WAT HIER BEWEZEN WORDT
//   [1] 2D: de bouwer geeft beide delen het doorlopende eind; de kern weigert
//       6.3.2 en meldt NIET VOLLEDIG GETOETST. Ter vergelijking het oude getal
//       met L_cr = 3000 mm.
//   [2] 2D met opgegeven kniklengtes (6 m, de hele kolom): 6.3.2 wordt getoetst.
//   [3] 2D met dezelfde doorsnede boven en onder: de bouwer voegt de delen samen
//       tot één lijn van 6 m; geen doorlopend eind.
//   [4] 3D: dezelfde getrapte kolom met de 3D-houtbouwer. In 3D worden staven
//       niet samengevoegd, dus ook een voortzetting met dezelfde doorsnede is
//       doorlopend.
//   [5] De MCP-weg (`check_fem_model`): dezelfde staafeinden en dezelfde status.
//
// HANDWAARDEN. Kolom van 6 m: onder 3 m C24 120 × 120, boven 3 m C24 100 × 100,
// scharnier aan de voet, aan de kop horizontaal gesteund, G = 10 kN op de kop.
// UGT 6.10a: N_Ed = 1,35·10 = 13,5 kN; alleen blijvend, dus k_mod = 0,6
// (klimaatklasse 1), γ_M = 1,3: f_c,0,d = 0,6·21/1,3 = 9,6923 N/mm².
// Onderste deel: A = 14 400 mm², i = 34,641 mm, σ_c,0,d = 0,9375 N/mm².
//   L_cr = 3000 (de oude terugval): λ_rel = 1,4685 → k_c = 0,3934 → UC 0,2459
//   L_cr = 6000 (opgegeven):        λ_rel = 2,9370 → k_c = 0,10849 → UC 0,8916
//
// Draaien met: npx tsx test-hout-doorlopend.mjs
//         of : node scripts/run-tests.mjs --filter=hout-doorlopend
// Vereist de release-toetsbrug en, voor [5], de release-MCP-server na
// `npm run build:sidecar`.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HIER, "..");
const win = process.platform === "win32";
const TOETSBRUG = join(REPO, "src-tauri", "target", "release", win ? "toetsbrug.exe" : "toetsbrug");
const MCP_SERVER = join(REPO, "src-tauri", "target", "release", win ? "openaec-mcp-server.exe" : "openaec-mcp-server");

const { solveAllCases } = await import("./src/components/fem/solver/engine.ts");
const { defaultCombinations, combineResults } = await import("./src/components/fem/solver/combinations.ts");
const { selecteerCombinaties } = await import("./src/lib/combinatieSelectie.ts");
const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");
const { buildTimberCheckInputs } = await import("./src/lib/timberCheckBuilder.ts");
const { buildOpenFem3DTimberCheckInputs } = await import("./src/components/openFem3d/openFem3dTimberCheck.ts");

let passed = 0, failed = 0;
const log = (s = "") => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
}
function dicht(naam, gemeten, hand, rel) {
  ok(naam, Number.isFinite(gemeten) && Math.abs(gemeten - hand) <= rel * Math.abs(hand),
    `${Number(gemeten).toFixed(5)} tegen hand ${hand.toFixed(5)}`);
}
function kern(inputs) {
  const r = spawnSync(TOETSBRUG, [], {
    input: JSON.stringify({ opdracht: "check_timber_beams", inputs }), encoding: "utf8", maxBuffer: 256 << 20,
  });
  if (r.status !== 0 || !r.stdout) throw new Error(`toetsbrug faalde: ${(r.stderr ?? "").slice(0, 300)}`);
  const uit = JSON.parse(r.stdout);
  if (uit.fout) throw new Error(uit.fout);
  return uit;
}
const toets = (res, id) => res.checks.find((c) => c.id === id)?.kind?.data;
const heeftKern = existsSync(TOETSBRUG);
if (!heeftKern) ok("toetsbrug gevonden — bouw hem met `cargo build --release -p toetsbrug`", false, TOETSBRUG);
const NIET_VOLLEDIG = "NIET VOLLEDIG GETOETST";

// ── Handwaarden ─────────────────────────────────────────────────────────────
const F_C0D = (0.6 * 21) / 1.3;
const SIGMA = 13500 / (120 * 120);
function kC(lCrMm) {
  const i = 120 / Math.sqrt(12);
  const lr = (lCrMm / i / Math.PI) * Math.sqrt(21 / 7400);
  const k = 0.5 * (1 + 0.2 * (lr - 0.3) + lr * lr);
  return Math.min(1, 1 / (k + Math.sqrt(k * k - lr * lr)));
}
const UC_3000 = SIGMA / (kC(3000) * F_C0D);
const UC_6000 = SIGMA / (kC(6000) * F_C0D);
dicht("hand: k_c(3000) = 0,3934", kC(3000), 0.3934, 5e-4);
dicht("hand: k_c(6000) = 0,10849", kC(6000), 0.10849, 5e-4);
dicht("hand: UC (6.23) bij 3000 = 0,2459", UC_3000, 0.2459, 5e-4);
dicht("hand: UC (6.23) bij 6000 = 0,8916", UC_6000, 0.8916, 5e-4);

// ── 2D ──────────────────────────────────────────────────────────────────────
const LC = [{ id: 1, name: "G", type: "dead" }];
function kolom2D(boven = "100x100", cfg) {
  return {
    selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
    loadCases: LC, plates: [],
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: 3000 }, { id: 3, x: 0, z: 6000 }],
    beams: [
      { id: 1, from: 1, to: 2, material: "C24", profile: "120x120", ...(cfg ? { checkConfig: cfg } : {}) },
      { id: 2, from: 2, to: 3, material: "C24", profile: boven },
    ],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 3, type: "xRoller" }],
    loads: [{ id: 1, type: "pointForce", nodeId: 3, caseId: 1, fz: -10 }],
  };
}
function hout2D(m) {
  const { perCase } = solveAllCases(bouwMultiInput(m));
  const sel = selecteerCombinaties(defaultCombinations(m.loadCases), m.beams, m.plates, { loadCases: m.loadCases, nodes: m.nodes });
  const combinationResults = new Map(sel.actief.map((c) => [c.id, combineResults(c, perCase)]));
  return buildTimberCheckInputs({
    nodes: m.nodes, beams: m.beams, alleBeams: m.beams, supports: m.supports, plates: [],
    combinations: sel.actief, combinationResults, loadCases: m.loadCases, gevallenMetLast: [...perCase.keys()],
  });
}

log("\n[1] 2D getrapte kolom zonder kniklengtes: 6.3.2 geweigerd, niet volledig getoetst");
{
  const b = hout2D(kolom2D());
  const onder = b.inputs.find((i) => i.beam_id === 1);
  const boven = b.inputs.find((i) => i.beam_id === 2);
  ok("onderste deel: voet gaffel, overgang doorlopend", JSON.stringify(onder?.staafeinden) === JSON.stringify({ begin: "Gaffel", eind: "Doorlopend" }), JSON.stringify(onder?.staafeinden));
  ok("bovenste deel: overgang doorlopend, kop gaffel", JSON.stringify(boven?.staafeinden) === JSON.stringify({ begin: "Doorlopend", eind: "Gaffel" }), JSON.stringify(boven?.staafeinden));
  ok("geen vrij eind", onder?.is_cantilever === false && boven?.is_cantilever === false);
  if (heeftKern && onder) {
    const r = kern([onder])[0];
    const knik = toets(r, "6.3.2_column_stability");
    ok("6.3.2 geweigerd, zonder UC", knik?.status === "NotApplicable" && !knik?.uc, knik?.status);
    ok("de reden staat bij de toets", (knik?.notes ?? []).some((n) => n.includes("L_cr,y én L_cr,z")));
    ok("status niet volledig getoetst", r.status === "NotApplicable" && r.governing_check_id.startsWith(NIET_VOLLEDIG),
      `${r.status}: ${r.governing_check_id.slice(0, 120)}`);
    // Het getal van vóór dit issue: het eind als gaffel, L_cr = 3000 mm.
    const oud = kern([{ ...onder, staafeinden: { begin: "Gaffel", eind: "Gaffel" } }])[0];
    dicht("ter vergelijking, het eind als gaffel (tot dit issue): UC 0,2459 met L_cr = 3000", toets(oud, "6.3.2_column_stability").uc.uc, UC_3000, 2e-4);
    ok("ter vergelijking: toen status Ok", oud.status === "Ok");
  }
}

log("\n[2] 2D met opgegeven kniklengtes van 6 m: 6.3.2 wordt getoetst");
{
  const onder = hout2D(kolom2D("100x100", { bucklingLengthY_m: 6, bucklingLengthZ_m: 6 })).inputs.find((i) => i.beam_id === 1);
  ok("kniklengtes in de invoer", onder?.buckling_length_y_m === 6 && onder?.buckling_length_z_m === 6);
  if (heeftKern && onder) {
    const r = kern([onder])[0];
    dicht("6.3.2 UC = 0,8916 (L_cr = 6000)", toets(r, "6.3.2_column_stability").uc.uc, UC_6000, 2e-4);
    // Kip blijft geweigerd zonder kipsteunafstand, maar er is geen buiging.
    ok("status Ok: zonder buiging ontbreekt er niets", r.status === "Ok", `${r.status}: ${r.governing_check_id}`);
  }
}

log("\n[3] 2D met dezelfde doorsnede: één lijn van 6 m, geen doorlopend eind");
{
  const b = hout2D(kolom2D("120x120"));
  ok("één getoetste staaf", b.inputs.length === 1, String(b.inputs.length));
  const lijn = b.inputs[0];
  ok("lijnlengte 6 m", Math.abs((lijn?.length_m ?? 0) - 6) < 1e-9, String(lijn?.length_m));
  ok("geen doorlopend eind", JSON.stringify(lijn?.staafeinden) === JSON.stringify({ begin: "Gaffel", eind: "Gaffel" }), JSON.stringify(lijn?.staafeinden));
}

// ── 3D ──────────────────────────────────────────────────────────────────────
log("\n[4] 3D getrapte kolom");
{
  const nul = (nodeId) => ({ nodeId, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 });
  const krachten = (memberId) => ({
    memberId, lengthM: 3, nStartKn: -13.5, nEndKn: -13.5, vyStartKn: 0, vyEndKn: 0, vzStartKn: 0, vzEndKn: 0,
    torsionStartKnm: 0, torsionEndKnm: 0, myStartKnm: 0, myEndKnm: 0, mzStartKnm: 0, mzEndKnm: 0,
  });
  const resultaat = { analysis: "p-delta", displacements: [nul(1), nul(2), nul(3)], memberForces: [krachten(1), krachten(2)] };
  const combinations = [{ id: 1, name: "UGT", type: "uls", formula: "", factors: new Map([[1, 1.35]]) }];
  const set = { combinations, results: new Map([[1, resultaat]]), loadCases: [{ id: 1, type: "dead" }] };
  const model3D = (boven, cfg) => ({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 3 }, { id: 3, x: 0, y: 0, z: 6 }],
    beams: [
      { id: 1, startNodeId: 1, endNodeId: 2, profileName: "120x120", material: "C24", ...(cfg ? { checkConfig: cfg } : {}) },
      { id: 2, startNodeId: 2, endNodeId: 3, profileName: boven, material: "C24" },
    ],
    supports: [
      { nodeId: 1, ux: true, uy: true, uz: true, rx: false, ry: false, rz: true },
      { nodeId: 3, ux: true, uy: true, uz: false, rx: false, ry: false, rz: false },
    ],
    loads: [], memberLoads: [],
  });
  const h = buildOpenFem3DTimberCheckInputs(model3D("100x100"), resultaat, set);
  const onder = h.inputs.find((i) => i.beam_id === 1);
  ok("3D: onderste deel voet gaffel, overgang doorlopend", JSON.stringify(onder?.staafeinden) === JSON.stringify({ begin: "Gaffel", eind: "Doorlopend" }), JSON.stringify(onder?.staafeinden ?? h.skipped));
  ok("3D: bovenste deel overgang doorlopend", h.inputs.find((i) => i.beam_id === 2)?.staafeinden?.begin === "Doorlopend");
  if (heeftKern && onder) {
    const r = kern([onder])[0];
    ok("3D: 6.3.2 geweigerd", toets(r, "6.3.2_column_stability")?.status === "NotApplicable");
    ok("3D: status niet volledig getoetst", r.status === "NotApplicable" && r.governing_check_id.startsWith(NIET_VOLLEDIG), r.governing_check_id.slice(0, 120));
  }
  const metLengtes = buildOpenFem3DTimberCheckInputs(model3D("100x100", { bucklingLengthY_m: 6, bucklingLengthZ_m: 6 }), resultaat, set)
    .inputs.find((i) => i.beam_id === 1);
  if (heeftKern && metLengtes) {
    const r = kern([metLengtes])[0];
    dicht("3D met kniklengtes van 6 m: 6.3.2 UC = 0,8916", toets(r, "6.3.2_column_stability").uc.uc, UC_6000, 2e-4);
    ok("3D met kniklengtes: status Ok", r.status === "Ok", `${r.status}: ${r.governing_check_id}`);
  }
  // In 3D worden staven niet samengevoegd: ook met dezelfde doorsnede loopt
  // de staaf door, en de tussenknoop is geen steun.
  const gelijk = buildOpenFem3DTimberCheckInputs(model3D("120x120"), resultaat, set).inputs.find((i) => i.beam_id === 1);
  ok("3D, dezelfde doorsnede: ook doorlopend", gelijk?.staafeinden?.eind === "Doorlopend", JSON.stringify(gelijk?.staafeinden));
  // Een aansluitende staaf onder een hoek maakt de knoop een gaffel.
  const metLigger = model3D("100x100");
  metLigger.nodes.push({ id: 4, x: 4, y: 0, z: 3 });
  metLigger.beams.push({ id: 3, startNodeId: 2, endNodeId: 4, profileName: "100x200", material: "C24" });
  const ligger = buildOpenFem3DTimberCheckInputs(metLigger, { ...resultaat, memberForces: [...resultaat.memberForces, { ...krachten(3), lengthM: 4 }] }, set)
    .inputs.find((i) => i.beam_id === 1);
  ok("3D met een ligger op de overgang: gaffel", ligger?.staafeinden?.eind === "Gaffel", JSON.stringify(ligger?.staafeinden));
}

// ── MCP ─────────────────────────────────────────────────────────────────────
log("\n[5] De MCP-weg: check_fem_model");
function mcp(aanroepen) {
  return new Promise((klaar, mis) => {
    const k = spawn(MCP_SERVER, [], { stdio: ["pipe", "pipe", "pipe"] });
    const klok = setTimeout(() => { k.kill(); mis(new Error("MCP-server reageerde niet binnen 120 s")); }, 120_000);
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
    schrijf({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-hout-doorlopend", version: "1" } } });
    aanroepen.forEach((a, n) => schrijf({ jsonrpc: "2.0", id: n + 2, method: "tools/call", params: { name: a.name, arguments: a.arguments } }));
  });
}
if (!existsSync(MCP_SERVER)) {
  ok("MCP-server gevonden — bouw hem met `cargo build --release -p openaec-mcp-server` (na `npm run build:sidecar`)", false, MCP_SERVER);
} else {
  const { selfWeightEnabled: _a, scheefstandEnabled: _b, scheefstandNoemer: _c, scheefstandRichting: _d, ...m } = kolom2D();
  const [h] = await mcp([{ name: "check_fem_model", arguments: { model: m } }]);
  const inhoud = h?.result?.structuredContent;
  ok("MCP slaagt", !h?.error && !h?.result?.isError, JSON.stringify(h?.error ?? h?.result?.content).slice(0, 300));
  if (inhoud) {
    const inv = inhoud.timber_check_inputs?.find((i) => i.beam_id === 1);
    const r = inhoud.timber_results?.find((x) => x.beam_id === 1);
    ok("MCP: staafeinden in de toetsinvoer", JSON.stringify(inv?.staafeinden) === JSON.stringify({ begin: "Gaffel", eind: "Doorlopend" }), JSON.stringify(inv?.staafeinden));
    ok("MCP: niet volledig getoetst", r?.status === "NotApplicable" && (r?.governing_check_id ?? "").startsWith(NIET_VOLLEDIG),
      `${r?.status}: ${(r?.governing_check_id ?? "").slice(0, 120)}`);
  }
}

log(`\n${failed === 0 ? "GESLAAGD" : "GEFAALD"}: ${passed} geslaagd, ${failed} gefaald.`);
process.exit(failed === 0 ? 0 : 1);

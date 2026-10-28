// Issue #200: w_add van een houten uitkraging waarvan de punt onder de
// blijvende last OMHOOG gaat en onder de veranderlijke OMLAAG.
//
// NEN-EN 1990:2002/NB:2019 figuur NB.1: w_add = w₂ + w₃, met w₂ het kruipdeel en
// w₃ = w_c − w₁ de ogenblikkelijke zakking bovenop die onder de blijvende
// belasting, per combinatie c. Tot dit issue rekende de houtkern altijd
// w₃ = w_inst − w₁, met w_inst de combinatie met de grootste |w|. Hoort die
// grootste |w| bij een combinatie die (bijna) de blijvende is, dan valt w_add te
// laag uit. Staal kreeg daarvoor `deflection_add_mm` (controle 2026-10, K5); hout
// krijgt nu hetzelfde veld, met het kruipdeel erbij: w_add = w₂ + w₃.
//
// WAT HIER BEWEZEN WORDT
//   [1] 2D, eigen BGT-combinaties die niet als 6.14b/6.16b te herkennen zijn
//       ("BGT G" en "BGT G+Q"): w_inst is die van G (de grootste |w|), w₃ komt
//       apart naar de kern uit G + Q, en de kern rekent w_add = w₂ + w₃.
//   [2] Dezelfde staaf in klimaatklasse 3 (k_def = 2,0): de omhoog kruipende
//       punt maakt nu G maatgevend voor |w₂ + w₃|, dus GEEN apart veld. De
//       grootste |w₃| (zoals bij staal, zonder kruip) zou hier w_add = 2,34 mm
//       geven in plaats van 11,98 mm: daarom kiest de bouwer de grootste
//       |w₂ + w₃| en niet de grootste |w₃|.
//   [3] De standaardcombinaties: daar is w_inst al de combinatie met de
//       grootste |w₂ + w₃|; geen veld, de invoer blijft zoals hij was.
//   [4] 3D: dezelfde tekenwissel met de 3D-houtbouwer (de 3D-maat is een
//       grootte; w₃ is de grootste verandering van het vervormingsveld).
//   [5] De MCP-weg (`check_fem_model`) geeft voor [1] dezelfde getallen.
//
// ── HANDBEREKENING 2D ────────────────────────────────────────────────────────
// GL28h 200 × 600 (E₀,mean = 12 600 N/mm², EN 14080; I = 200·600³/12 =
// 3,6·10⁹ mm⁴; EI = 4,536·10¹³ N·mm²). Veld L = 6000 mm op een scharnier en een
// rol, overstek a = 2000 mm (staaf 2). G = 15,1 kN/m alleen op het veld, Q =
// 41 kN op de punt. Punt van het overstek, gemeten vanaf de inklemming:
//   onder G: omhoog q·L³·a/(24·EI)       = 15,1·6000³·2000/(24·4,536·10¹³) = +5,9921 mm
//   onder Q: omlaag F·a²·(L + a)/(3·EI)  = 41 000·2000²·8000/(3·4,536·10¹³) = −9,6414 mm
//   "BGT G" = +5,9921; "BGT G+Q" = −3,6493 → w_inst = +5,9921 (grootste |w|)
//   geen quasi-blijvende combinatie → w_qp = w_inst = +5,9921 (terugval, met notitie)
//   w₁ = "BGT G" = +5,9921
// Klimaatklasse 1, k_def = 0,6:
//   w_fin = 5,9921 + 0,6·5,9921 = 9,5873 → grens 2·2000/250 = 16 → UC 0,59921
//   w₂ = 0,6·5,9921 = 3,5952
//   kandidaten w₂ + (w_c − w₁): G: 3,5952 + 0 = 3,5952; G+Q: 3,5952 − 9,6414 = −6,0462
//   → w₃ = −9,6414 apart naar de kern; w_add = −6,0462 → grens 0,003·2·2000 =
//     12,000 → UC 0,50385. Tot dit issue: w_add = 3,5952 → UC 0,29960.
//   (Op werk/pr-57 stond hier de grens 2·2000/333 = 12,012 en UC 0,50335. De
//   samenvoeglijn rekent sinds #210 met 0,003·l = l/333,33 (NEN-EN 1990 NB
//   A1.4.3, zie `timberCheckBuilder.ts`); dat is de enige oorzaak van het
//   verschil, 12,012/12,000 = 1,001.)
// Klimaatklasse 3, k_def = 2,0:
//   w₂ = 11,9841; kandidaten: G: 11,9841; G+Q: 2,3427 → G, geen apart veld;
//   w_add = 11,9841 → UC 0,99868 (was 0,99770 met l/333; de grootste |w₃| zou 2,3427 geven).
//
// ── HANDBEREKENING 3D ────────────────────────────────────────────────────────
// Uitkraging L = 3 m, C24 100 × 300, punt onder G 5 mm OMHOOG, onder G + Q 8 mm
// OMLAAG (verplaatsingsvelden opgegeven, zoals in test-controle-2026-10-3d). De
// 3D-maat is een grootte: w_inst = −8, w_qp = −5, w₁ = −5 (alle drie "omlaag").
// w₃ = de grootste verandering = |−8 − 5| = 13 → −13; w₂ = 0,6·−5 = −3;
// w_add = −16 → grens 0,003·2·3000 = 18,000 → UC 0,88889 (was 0,88800 met
// l/333). Tot dit issue: w_add = (−8 − 3) − (−5) = −6 → UC 0,33333.
//
// Draaien met: npx tsx test-hout-w-add.mjs
//         of : node scripts/run-tests.mjs --filter=hout-w-add
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
function dicht(naam, gemeten, hand, tolAbs) {
  ok(naam, Number.isFinite(gemeten) && Math.abs(gemeten - hand) <= tolAbs,
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

// ── Handwaarden ─────────────────────────────────────────────────────────────
const EI = 12600 * (200 * 600 ** 3) / 12; // N·mm²
const L = 6000, A = 2000;
const wG = (15.1 * L ** 3 * A) / (24 * EI); // omhoog
const wQ = (41000 * A ** 2 * (L + A)) / (3 * EI); // omlaag
dicht("hand: punt omhoog onder G = 5,9921 mm", wG, 5.9921, 5e-5);
dicht("hand: punt omlaag onder Q = 9,6414 mm", wQ, 9.6414, 5e-5);
const grensFin = (2 * A) / 250, grensAdd = 0.003 * (2 * A);

const LC = [{ id: 1, name: "G", type: "dead" }, { id: 2, name: "Q", type: "live", categorie: "A" }];
/** Eigen combinaties zonder herkenbare naam of kenmerk, zoals een gebruiker ze kan maken. */
const EIGEN = [
  { id: 1, name: "UGT", type: "uls", factors: { 1: 1.35, 2: 1.5 } },
  { id: 2, name: "BGT G", type: "sls", factors: { 1: 1 } },
  { id: 3, name: "BGT G+Q", type: "sls", factors: { 1: 1, 2: 1 } },
];
function model(serviceClass, combinaties) {
  const cfg = { serviceClass };
  return {
    selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
    loadCases: LC, plates: [],
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: L, z: 0 }, { id: 3, x: L + A, z: 0 }],
    beams: [
      { id: 1, from: 1, to: 2, material: "GL28h", profile: "200x600", checkConfig: cfg },
      { id: 2, from: 2, to: 3, material: "GL28h", profile: "200x600", checkConfig: cfg },
    ],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
    loads: [
      { id: 1, type: "lineLoad", beamId: 1, caseId: 1, q: -15.1 },
      { id: 2, type: "pointForce", nodeId: 3, caseId: 2, fz: -41 },
    ],
    ...(combinaties ? { combinations: combinaties } : {}),
  };
}
function overstek(m) {
  const { perCase } = solveAllCases(bouwMultiInput(m));
  const alle = m.combinations
    ? m.combinations.map((c) => ({ ...c, formula: c.name, factors: new Map(Object.entries(c.factors).map(([k, v]) => [Number(k), v])) }))
    : defaultCombinations(m.loadCases);
  const sel = selecteerCombinaties(alle, m.beams, m.plates, { loadCases: m.loadCases, nodes: m.nodes });
  const combinationResults = new Map(sel.actief.map((c) => [c.id, combineResults(c, perCase)]));
  const r = buildTimberCheckInputs({
    nodes: m.nodes, beams: m.beams, alleBeams: m.beams, supports: m.supports, plates: [],
    combinations: sel.actief, combinationResults, loadCases: m.loadCases, gevallenMetLast: [...perCase.keys()],
  });
  return r.inputs.find((i) => i.beam_id === 2);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] 2D, eigen combinaties, klimaatklasse 1: w₃ uit G + Q apart naar de kern");
// ─────────────────────────────────────────────────────────────────────────
{
  const inv = overstek(model(1, EIGEN));
  ok("overstek is een uitkraging", inv.is_cantilever === true);
  dicht("w_inst = +5,9921 (G, de grootste |w|)", inv.deflection_inst_mm, wG, 2e-3);
  dicht("w₁ = +5,9921", inv.deflection_permanent_mm, wG, 2e-3);
  ok("w₃ apart naar de kern", typeof inv.deflection_add_mm === "number", String(inv.deflection_add_mm));
  dicht("w₃ = (G + Q) − G = −9,6414", inv.deflection_add_mm, -wQ, 2e-3);
  ok("de herkomst van w₃ staat in de notities",
    inv.deflection_notes.some((n) => n.startsWith("w₃ = w_c − w₁ = -9,64 mm komt uit \"BGT G+Q\"")),
    (inv.deflection_notes.find((n) => n.startsWith("w₃")) ?? "—").slice(0, 160));
  if (heeftKern) {
    const r = kern([inv])[0];
    const fin = toets(r, "deflection_w_fin"), add = toets(r, "deflection_w_add");
    dicht("w_fin = 9,5873 mm (onveranderd)", fin.uc.ed, wG * 1.6, 2e-3);
    dicht("w_fin UC = 0,59921", fin.uc.uc, (wG * 1.6) / grensFin, 2e-4);
    dicht("w_add = |w₂ + w₃| = 6,0462 mm (tot dit issue 3,5952)", add.uc.ed, wQ - 0.6 * wG, 2e-3);
    dicht("w_add grens = 0,003·2·2000 = 12,000 mm", add.uc.rd, grensAdd, 1e-9);
    dicht("w_add UC = 0,50385 (tot dit issue 0,29960)", add.uc.uc, (wQ - 0.6 * wG) / grensAdd, 2e-4);
    const w = add.variables.find((v) => v.symbol === "w")?.value;
    dicht("w_add met teken = −6,0462 (omlaag)", w, 0.6 * wG - wQ, 2e-3);
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] Klimaatklasse 3 (k_def = 2,0): de kruip maakt G maatgevend, geen apart veld");
// ─────────────────────────────────────────────────────────────────────────
{
  const inv = overstek(model(3, EIGEN));
  ok("geen deflection_add_mm: |w₂ + 0| = 11,98 > |w₂ − 9,64| = 2,34", inv.deflection_add_mm === undefined, String(inv.deflection_add_mm));
  if (heeftKern) {
    const add = toets(kern([inv])[0], "deflection_w_add");
    dicht("w_add = w₂ = 2,0·5,9921 = 11,9841 mm", add.uc.ed, 2 * wG, 2e-3);
    dicht("w_add UC = 0,99868", add.uc.uc, (2 * wG) / grensAdd, 2e-4);
    // Ter vergelijking, de regel van staal (grootste |w₃|, zonder kruip): G + Q.
    // Dat gaf hier 2,34 mm — vijf keer te weinig.
    const naief = kern([{ ...inv, deflection_add_mm: -wQ }])[0];
    dicht("ter vergelijking: met de grootste |w₃| zou w_add 2,3427 mm zijn", toets(naief, "deflection_w_add").uc.ed, 2 * wG - wQ, 2e-3);
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] De standaardcombinaties: w_inst is al de maatgevende, de invoer blijft gelijk");
// ─────────────────────────────────────────────────────────────────────────
{
  const inv = overstek(model(1));
  // Karakteristiek is alleen "Q leidend": w_inst = G + Q = −3,6493, en dat is
  // ook de combinatie met de grootste |w₂ + w_c − w₁|.
  dicht("w_inst = G + Q = −3,6493", inv.deflection_inst_mm, wG - wQ, 2e-3);
  ok("geen deflection_add_mm", !("deflection_add_mm" in inv), String(inv.deflection_add_mm));
  ok("geen w₃-notitie", !inv.deflection_notes.some((n) => n.startsWith("w₃")));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] 3D: tekenwissel tussen G en G + Q");
// ─────────────────────────────────────────────────────────────────────────
{
  const L3 = 3;
  const nul = (nodeId) => ({ nodeId, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 });
  const tip = (dMm) => ({
    // Vorm van een uitkraging met eindlast: θ = 3δ/(2L); omhoog = +u_z, en de
    // rotatie volgt r_y = −dw/dx (zie openFem3dDisplacement).
    displacements: [nul(1), { ...nul(2), uz: dMm / 1000, ry: -(3 * dMm / 1000) / (2 * L3) }],
    memberForces: [{ memberId: 1, lengthM: L3, nStartKn: 0, nEndKn: 0, vyStartKn: 0, vyEndKn: 0,
      vzStartKn: 1, vzEndKn: 1, torsionStartKnm: 0, torsionEndKnm: 0, myStartKnm: -L3, myEndKnm: 0, mzStartKnm: 0, mzEndKnm: 0 }],
  });
  const m3 = {
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L3, y: 0, z: 0 }],
    supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
    loads: [], memberLoads: [],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "100x300", material: "C24" }],
  };
  const combinations = [
    { id: 10, name: "UGT 6.10b", type: "uls", formula: "", factors: new Map([[1, 1.35], [2, 1.5]]) },
    { id: 20, name: "BGT karakteristiek 6.14b", type: "sls", formula: "", factors: new Map([[1, 1], [2, 1]]) },
    { id: 30, name: "BGT quasi-blijvend 6.16b zonder Q", type: "sls", formula: "", factors: new Map([[1, 1], [2, 0]]) },
  ];
  const inv = buildOpenFem3DTimberCheckInputs(m3, tip(-8), {
    combinations, loadCases: [{ id: 1, type: "dead" }, { id: 2, type: "live" }],
    results: new Map([[10, tip(-12)], [20, tip(-8)], [30, tip(5)]]),
  }).inputs[0];
  dicht("3D: w_inst = −8", inv.deflection_inst_mm, -8, 1e-6);
  dicht("3D: w₁ = −5 (de 3D-maat is een grootte)", inv.deflection_permanent_mm, -5, 1e-6);
  dicht("3D: w₃ = −13 (verandering van het veld)", inv.deflection_add_mm, -13, 1e-6);
  ok("3D: de herkomst van w₃ staat in de notities", inv.deflection_notes.some((n) => n.startsWith("w₃ = w_c − w₁ = 13,00 mm")));
  ok("3D: de BGT wordt getoetst", inv.deflection_not_applicable_reason === undefined, String(inv.deflection_not_applicable_reason));
  if (heeftKern) {
    const add = toets(kern([inv])[0], "deflection_w_add");
    dicht("3D: w_add = |w₂ + w₃| = |−3 − 13| = 16 mm (tot dit issue 6)", add.uc.ed, 16, 1e-9);
    dicht("3D: w_add UC = 16/18,000 = 0,88889", add.uc.uc, 16 / (0.003 * 2 * 3000), 1e-9);
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[5] De MCP-weg: check_fem_model geeft voor [1] dezelfde getallen");
// ─────────────────────────────────────────────────────────────────────────
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
    schrijf({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-hout-w-add", version: "1" } } });
    aanroepen.forEach((a, n) => schrijf({ jsonrpc: "2.0", id: n + 2, method: "tools/call", params: { name: a.name, arguments: a.arguments } }));
  });
}
if (!existsSync(MCP_SERVER)) {
  ok("MCP-server gevonden — bouw hem met `cargo build --release -p openaec-mcp-server` (na `npm run build:sidecar`)", false, MCP_SERVER);
} else {
  // De eigen combinaties gaan als argument `combinations` mee, zoals een client ze opgeeft.
  const { selfWeightEnabled: _a, scheefstandEnabled: _b, scheefstandNoemer: _c, scheefstandRichting: _d, combinations, ...m } = model(1, EIGEN);
  const [h] = await mcp([{ name: "check_fem_model", arguments: { model: m, combinations } }]);
  const inhoud = h?.result?.structuredContent;
  ok("MCP slaagt", !h?.error && !h?.result?.isError, JSON.stringify(h?.error ?? h?.result?.content).slice(0, 300));
  if (inhoud) {
    const inv = inhoud.timber_check_inputs?.find((i) => i.beam_id === 2);
    const r = inhoud.timber_results?.find((x) => x.beam_id === 2);
    dicht("MCP: w₃ in de toetsinvoer = −9,6414", inv?.deflection_add_mm, -wQ, 2e-3);
    if (r) dicht("MCP: w_add UC = 0,50385", toets(r, "deflection_w_add").uc.uc, (wQ - 0.6 * wG) / grensAdd, 2e-4);
  }
}

log(`\n${failed === 0 ? "GESLAAGD" : "GEFAALD"}: ${passed} geslaagd, ${failed} gefaald.`);
process.exit(failed === 0 ? 0 : 1);

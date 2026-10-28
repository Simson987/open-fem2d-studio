// Het veldmaximum van M (waar V = 0) en de grootste zakking (waar θ = 0)
// liggen tussen de stations: exact in de omhullende, de grootste verplaatsing
// en de toetsinvoer (controle 12 oktober 2026, punt C8, issue #193).
//
// WAT ER MISGING
//  Elke rekenstaaf heeft 21 stations op x = i·L/20. De omhullende, de grootste
//  verplaatsing en de krachtenomhullende voor de toetsen namen het grootste
//  STATIONSWAARDE. Gemeten:
//    060 Gerberligger, veld 0–6 m: M = 19,950 kNm (station 2100) waar
//        R_A²/(2q) = 20,000 kNm op x = 2000 hoort (−0,25 %);
//    072 ingeklemd-rol 6 m: M = 25,200 kNm waar 9qL²/128 = 25,3125 kNm op
//        x = 5L/8 hoort (−0,44 %), en w = 3,986 mm op station 3600 waar het
//        maximum op x = L(15 − √33)/16 = 3471 mm ligt.
//
// WAT DEZE TEST VASTLEGT (q = 10 kN/m, IPE300, EI uit de profieltabel)
//  [1] 072: M_max = 9qL²/128 op 5L/8; w_max = max q·x²(3L² − 5Lx + 2x²)/(48EI)
//      in de grootste verplaatsing (per geval, per combinatie, omhullende);
//      M_inklemming −qL²/8 en de reacties 5qL/8 / 3qL/8 ongewijzigd; nog
//      steeds 21 stations.
//  [2] 060: M_max van staaf 1 = 20,000 kNm op x = 2000; steunmoment −60,
//      reacties 20 / 80 / 20, zakking van de uitkraging ongewijzigd.
//  [3] De toetsinvoer: de krachtenomhullende krijgt het punt op V = 0, de
//      doorbuiging vanaf de koorde het maximum tussen de stations (hand:
//      w(x) van een ligger met eindmoment −60 kNm).
//  [3b] Een doorgaande lijn met een puntlast op de tussenknoop (V springt).
//  [3c] Een doorgaande lijn over een scharnier (060 staaf 2+3, θ springt):
//      de doorbuiging van de lijn is de tip van de uitkraging (hand), in
//      staal en hout; geen extreem dat de verfijning rechts van de naad
//      verzint.
//  [4] Waar niets te verfijnen valt, verandert niets: een symmetrische ligger
//      (maximum op een station) en zuivere eindmomenten (constant M).
//  [5] De gebouwde MCP-server: solve_fem_model en check_fem_model.
//
// Draaien met: npx tsx test-veldmaximum.mjs  (ook tegen de sidecarbundel)

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { solveAllCases } = await import("./src/components/fem/solver/engine.ts");
const { combineResults, computeEnvelope } = await import("./src/components/fem/solver/combinations.ts");
const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");
const { resolveSection } = await import("./src/lib/sectionResolver.ts");
const { buildForcesEnvelope, buildSteelCheckInputs, extractFieldDeflectionMm } = await import("./src/lib/steelCheckBuilder.ts");
const { buildTimberCheckInputs } = await import("./src/lib/timberCheckBuilder.ts");

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HIER, "..");
const win = process.platform === "win32";
const MCP_SERVER = join(REPO, "src-tauri", "target", "release", win ? "openaec-mcp-server.exe" : "openaec-mcp-server");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? ` — ${extra}` : ""}`); }
}
function check(naam, waarde, verwacht, relTol = 1e-5) {
  const goed = Number.isFinite(waarde) && Math.abs(waarde - verwacht) <= relTol * Math.max(1, Math.abs(verwacht));
  ok(`${naam}: ${Number(waarde).toFixed(5)} ≈ ${verwacht.toFixed(5)}`, goed);
}

const q = 10; // kN/m = N/mm
const EI = 210000 * resolveSection("S235", "IPE300").I; // N·mm²
const G = [{ id: 1, name: "G", type: "dead" }];
const COMBI = [{ id: 1, name: "G", type: "uls", factors: new Map([[1, 1]]) }];
const COMBI_MCP = [{ id: 1, name: "G", type: "uls", factors: { 1: 1 } }];
const metDefaults = (m) => ({ plates: [], selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1, ...m });
const staaf = (id, from, to, extra = {}) => ({ id, from, to, profile: "IPE300", material: "S235", ...extra });
const lijnlast = (id, beamId) => ({ id, type: "lineLoad", caseId: 1, beamId, q: -q });

const M072 = () => ({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }],
  beams: [staaf(1, 1, 2)],
  supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 2, type: "zRoller" }],
  loadCases: G,
  loads: [lijnlast(1, 1)],
});
const M060 = () => ({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }, { id: 3, x: 8000, z: 0 }, { id: 4, x: 12000, z: 0 }],
  beams: [staaf(1, 1, 2), staaf(2, 2, 3), staaf(3, 3, 4, { releases: { startRy: true } })],
  supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }, { nodeId: 4, type: "zRoller" }],
  loadCases: G,
  loads: [lijnlast(1, 1), lijnlast(2, 2), lijnlast(3, 3)],
});
const reken = (m) => {
  const { perCase } = solveAllCases(bouwMultiInput(metDefaults(m)));
  return { perCase, combi: combineResults(COMBI[0], perCase), env: computeEnvelope(COMBI, perCase) };
};

/** Maximum van f op [a, b] (gulden snede; f unimodaal daar). */
function maxOp(f, a, b) {
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = b - g * (b - a), x2 = a + g * (b - a);
  for (let k = 0; k < 200; k++) {
    if (f(x1) < f(x2)) { a = x1; x1 = x2; x2 = a + g * (b - a); } else { b = x2; x2 = x1; x1 = b - g * (b - a); }
  }
  return { x: (a + b) / 2, f: f((a + b) / 2) };
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] 072: ingeklemd-rol 6 m");
// ─────────────────────────────────────────────────────────────────────────
const L = 6000;
const w072 = (x) => (q * x * x * (3 * L * L - 5 * L * x + 2 * x * x)) / (48 * EI);
const xw = (L * (15 - Math.sqrt(33))) / 16;
const wmax072 = w072(xw);
{
  const { perCase, combi, env } = reken(M072());
  const e = env.elements.get(1);
  check("M_max = 9qL²/128 = 25,3125 kNm (was 25,200)", e.M_max / 1e6, (9 * q * 36) / 128);
  check("plaats van het maatgevende |M|: de inklemming, x = 0", e.governingMPos_mm, 0);
  check("M_min = −qL²/8 = −45 kNm (ongewijzigd)", e.M_min / 1e6, -45);
  check(`w_max per geval = ${wmax072.toFixed(5)} mm op x = ${xw.toFixed(1)} (was 3,98633)`, perCase.get(1).maxDisplacement, wmax072);
  check("w_max van de combinatie", combi.maxDisplacement, wmax072);
  check("w_max van de omhullende", env.maxDisplacement, wmax072);
  check("R₁ = 5qL/8 = 37,5 kN (ongewijzigd)", perCase.get(1).reactions.get(1).fz / 1000, 37.5);
  check("R₂ = 3qL/8 = 22,5 kN (ongewijzigd)", perCase.get(1).reactions.get(2).fz / 1000, 22.5);
  ok("nog steeds 21 stations, op x = i·L/20", combi.elements.get(1).stations_mm.length === 21
    && combi.elements.get(1).stations_mm.every((x, i) => Math.abs(x - i * 300) < 1e-9));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] 060: Gerberligger 0–6–8–12 m, scharnier op 8 m");
// ─────────────────────────────────────────────────────────────────────────
{
  const { perCase, env } = reken(M060());
  check("staaf 1: M_max = R_A²/(2q) = 20,000 kNm (was 19,950)", env.elements.get(1).M_max / 1e6, 20);
  check("staaf 3: M_max = qL²/8 = 20,000 kNm (lag al op een station)", env.elements.get(3).M_max / 1e6, 20);
  check("steunmoment −60 kNm", env.elements.get(1).M_min / 1e6, -60);
  const r = perCase.get(1).reactions;
  check("R₁ = 20 kN", r.get(1).fz / 1000, 20);
  check("R₂ = 80 kN", r.get(2).fz / 1000, 80);
  check("R₄ = 20 kN", r.get(4).fz / 1000, 20);
  // De grootste verplaatsing is de tip van de uitkraging, een knoop: die
  // verandert niet door de verfijning.
  check("grootste verplaatsing = |uz| van knoop 3", perCase.get(1).maxDisplacement, Math.abs(perCase.get(1).displacements.get(3).uz));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] De toetsinvoer: krachtenomhullende en doorbuiging vanaf de koorde");
// ─────────────────────────────────────────────────────────────────────────
{
  const { combi } = reken(M072());
  const res = new Map([[1, combi]]);
  const fe = buildForcesEnvelope(1, COMBI, res);
  ok("22 punten: de 21 stations plus het punt op V = 0", fe.length === 22, String(fe.length));
  const top = fe.reduce((a, p) => (p.forces.my_ed > a.forces.my_ed ? p : a));
  check("my_ed max = 25,3125 kNm", top.forces.my_ed, 25.3125);
  check("op x = 5L/8 = 3750 mm", top.position_mm, 3750);
  check("met V = 0", top.forces.vz_ed, 0);
  ok("de punten blijven op volgorde van positie", fe.every((p, i) => i === 0 || p.position_mm >= fe[i - 1].position_mm));
  check("doorbuiging vanaf de koorde = −w_max (omlaag negatief)", extractFieldDeflectionMm(M072().beams[0], combi), -wmax072);

  // 060 staaf 1: koorde tussen twee steunpunten (nul), eindmoment −60 kNm op x = L.
  const { combi: c060 } = reken(M060());
  const L1 = 6000, MB = -60e6;
  const w060 = (x) => (q * x * (L1 ** 3 - 2 * L1 * x * x + x ** 3)) / (24 * EI) + (MB * x * (L1 * L1 - x * x)) / (6 * EI * L1);
  const hand = maxOp(w060, 0, L1);
  check(`060 staaf 1: doorbuiging = −${hand.f.toFixed(5)} mm op x = ${hand.x.toFixed(0)} (was −2,29172 op een station)`,
    extractFieldDeflectionMm(M060().beams[0], c060), -hand.f);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3b] Een doorgaande lijn met een puntlast op de tussenknoop: geen verzonnen extreem");
// ─────────────────────────────────────────────────────────────────────────
{
  // Ligger 6 m in twee staven, 10 kN/m + 5 kN op de tussenknoop (het bedoelde
  // model 051 van de controle). De toets voegt de staven samen tot één lijn
  // en neemt het naadstation één keer op, met de V van het eerste deel. Daar
  // springt V (5 kN): de Hermite-kubiek op het interval erna is niet M(x).
  // Hand: M_max = qL²/8 + FL/4 = 52,5 kNm op de tussenknoop, niet erbuiten.
  const model = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }, { id: 3, x: 3000, z: 0 }],
    beams: [staaf(1, 1, 3), staaf(2, 3, 2)],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
    loadCases: G,
    loads: [lijnlast(1, 1), lijnlast(3, 2), { id: 2, type: "pointForce", caseId: 1, nodeId: 3, fz: -5 }],
  };
  const { perCase } = solveAllCases(bouwMultiInput(metDefaults(model)));
  // Met een karakteristieke BGT-combinatie erbij, zodat ook de doorbuiging
  // van de lijn in de toetsinvoer komt.
  const combis = [...COMBI, { id: 2, name: "BGT karakteristiek", type: "sls", formula: "G", factors: new Map([[1, 1]]),
    standaard: { soort: "6.14b", leidend: null, gevolgklasse: "CC2", kenmerk: "" } }];
  const combinationResults = new Map(combis.map((c) => [c.id, combineResults(c, perCase)]));
  const { inputs } = buildSteelCheckInputs({
    nodes: model.nodes, beams: model.beams, supports: model.supports,
    combinations: combis, combinationResults, profileDb: new Map([["IPE300", { geometry: { h: 300 } }]]),
  });
  ok("één toetsinvoer: de doorgaande lijn", inputs.length === 1, String(inputs.length));
  const fe = inputs[0]?.forces_envelope ?? [];
  const top = fe.reduce((a, p) => (p.forces.my_ed > a.forces.my_ed ? p : a), fe[0]);
  check("my_ed max = qL²/8 + FL/4 = 52,5 kNm (was zonder toets op de naad: 52,52 op x = 3019)", top?.forces?.my_ed, 52.5);
  check("op de tussenknoop, x = 3000", top?.position_mm, 3000);
  const L2 = 6000;
  const wHand = (5 * q * L2 ** 4) / (384 * EI) + (5000 * L2 ** 3) / (48 * EI);
  check("doorbuiging van de lijn = −(5qL⁴/384EI + FL³/48EI)", inputs[0]?.deflection_actual_max_mm ?? NaN, -wHand);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3c] Een doorgaande lijn over een scharnier (060 staaf 2+3): geen verzonnen extreem");
// ─────────────────────────────────────────────────────────────────────────
{
  // De toets voegt de uitkraging 6–8 m en de ligger 8–12 m (scharnier op 8 m)
  // samen tot één lijn van 6 m. Op de naad springt θ. Met het naadstation één
  // keer (θ van de uitkraging) verzon de Hermite-verfijning rechts van de naad
  // een extreem: −7,7226 mm. De koorde van de lijn ligt op twee steunpunten
  // (nul), en rechts van het scharnier loopt w op naar 0: de grootste
  // doorbuiging is de tip van de uitkraging.
  // Hand (Euler-Bernoulli, w omlaag positief): de ligger 8–12 m legt
  // P = qL₃/2 op de tip; M_B = −(P·a + q·a²/2) met a = 2 m;
  // EI·θ_B = −M_B·L₁/3 − q·L₁³/24 (L₁ = 6 m);
  // w_tip = (EI·θ_B·a + P·a³/3 + q·a⁴/8)/EI.
  const wTip = (qq, EIx) => {
    const L1 = 6000, a = 2000, P = (qq * 4000) / 2, MB = -(P * a + (qq * a * a) / 2);
    const thetaEI = (-MB * L1) / 3 - (qq * L1 ** 3) / 24;
    return (thetaEI * a + (P * a ** 3) / 3 + (qq * a ** 4) / 8) / EIx;
  };
  const combis = [...COMBI, { id: 2, name: "BGT karakteristiek", type: "sls", formula: "G", factors: new Map([[1, 1]]),
    standaard: { soort: "6.14b", leidend: null, gevolgklasse: "CC2", kenmerk: "" } }];
  const resultaten = (model) => {
    const { perCase } = solveAllCases(bouwMultiInput(metDefaults(model)));
    return { perCase, combinationResults: new Map(combis.map((c) => [c.id, combineResults(c, perCase)])) };
  };
  // Staal: 060 zoals in [2].
  const m060 = M060();
  const s = resultaten(m060);
  const { inputs } = buildSteelCheckInputs({
    nodes: m060.nodes, beams: m060.beams, supports: m060.supports,
    combinations: combis, combinationResults: s.combinationResults, profileDb: new Map([["IPE300", { geometry: { h: 300 } }]]),
  });
  ok("staal: twee toetsinvoeren (staaf 1 en de lijn 2+3)", inputs.length === 2, String(inputs.length));
  const lijn = inputs.find((i) => i.beam_id !== 1);
  const handStaal = wTip(q, EI);
  check(`staal, lijn 2+3: doorbuiging = −w_tip = −${handStaal.toFixed(5)} mm (was −7,72264)`, lijn?.deflection_actual_max_mm ?? NaN, -handStaal);
  check("staal, lijn 2+3: gelijk aan uz van knoop 3 (de tip)", lijn?.deflection_actual_max_mm ?? NaN, s.perCase.get(1).displacements.get(3).uz);
  check("staal, staaf 1 ongewijzigd (zie [3])", inputs.find((i) => i.beam_id === 1)?.deflection_actual_max_mm ?? NaN,
    extractFieldDeflectionMm(m060.beams[0], s.combinationResults.get(2)));
  // Hout: dezelfde geometrie in C24 96x450 onder 2 kN/m.
  const qH = 2;
  const hout = {
    ...M060(),
    beams: M060().beams.map((b) => ({ ...b, profile: "96x450", material: "C24" })),
    loads: M060().loads.map((l) => ({ ...l, q: -qH })),
  };
  const h = resultaten(hout);
  const { inputs: houtInputs } = buildTimberCheckInputs({
    nodes: hout.nodes, beams: hout.beams, supports: hout.supports, combinations: combis, combinationResults: h.combinationResults,
  });
  const EIh = 11000 * resolveSection("C24", "96x450").I; // E0,mean van C24
  const handHout = wTip(qH, EIh);
  const houtLijn = houtInputs.find((i) => i.beam_id !== 1);
  check(`hout, lijn 2+3: w_inst = −w_tip = −${handHout.toFixed(5)} mm`, houtLijn?.deflection_inst_mm ?? NaN, -handHout);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] Waar niets te verfijnen valt, verandert niets");
// ─────────────────────────────────────────────────────────────────────────
{
  // Vrij opgelegd: het maximum ligt op het middelste station.
  const vrij = M072();
  vrij.supports = [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }];
  const { combi, env } = reken(vrij);
  check("vrij opgelegd: M_max = qL²/8 = 45 kNm", env.elements.get(1).M_max / 1e6, 45);
  check("op x = L/2", env.elements.get(1).governingMPos_mm, 3000);
  ok("vrij opgelegd: geen extra punt in de krachtenomhullende", buildForcesEnvelope(1, COMBI, new Map([[1, combi]])).length === 21);
  check("w_max = 5qL⁴/384EI", combi.maxDisplacement, (5 * q * L ** 4) / (384 * EI));
  // Zuivere eindmomenten: M constant, geen veldextreem, plaats = eerste station.
  const koppels = {
    ...vrij,
    loads: [{ id: 1, type: "pointMoment", caseId: 1, nodeId: 1, my: 10 }, { id: 2, type: "pointMoment", caseId: 1, nodeId: 2, my: -10 }],
  };
  const k = reken(koppels);
  const ek = k.env.elements.get(1);
  ok("constant moment: M_max = M_min", Math.abs(ek.M_max - ek.M_min) < 1e-3 * Math.abs(ek.M_max), `${ek.M_max} / ${ek.M_min}`);
  check("constant moment: plaats blijft het eerste station", ek.governingMPos_mm, 0);
  ok("constant moment: geen extra punt", buildForcesEnvelope(1, COMBI, new Map([[1, k.combi]])).length === 21);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[5] De gebouwde MCP-server");
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
    schrijf({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-veldmaximum", version: "1" } } });
    aanroepen.forEach((a, n) => schrijf({ jsonrpc: "2.0", id: n + 2, method: "tools/call", params: { name: a.name, arguments: a.arguments } }));
  });
}
function lees(antwoord) {
  if (antwoord?.error) return { fout: JSON.stringify(antwoord.error) };
  const r = antwoord?.result;
  const tekst = r?.content?.[0]?.text ?? "";
  if (r?.isError) return { fout: tekst };
  try { return { uit: r?.structuredContent ?? JSON.parse(tekst) }; } catch { return { fout: tekst }; }
}

if (!existsSync(MCP_SERVER)) {
  ok("MCP-server gevonden — bouw hem met `cargo build --release -p openaec-mcp-server` (na `npm run build:sidecar`)", false, MCP_SERVER);
} else {
  const metBgt = [...COMBI_MCP, { id: 2, name: "BGT", type: "sls", factors: { 1: 1 } }];
  const a = (await mcp([
    { name: "solve_fem_model", arguments: { model: M072(), combinations: COMBI_MCP } },
    { name: "solve_fem_model", arguments: { model: M060(), combinations: COMBI_MCP } },
    { name: "check_fem_model", arguments: { model: M072(), combinations: metBgt } },
  ])).map(lees);
  check("MCP 072: envelope M_max = 25,3125 kNm", a[0].uit?.envelope?.elements?.["1"]?.M_max, 25.3125);
  check("MCP 072: maxDisplacement = w_max", a[0].uit?.envelope?.maxDisplacement, wmax072);
  check("MCP 072: M_min = −45 kNm", a[0].uit?.envelope?.elements?.["1"]?.M_min, -45);
  check("MCP 060: staaf 1 M_max = 20,000 kNm", a[1].uit?.envelope?.elements?.["1"]?.M_max, 20);
  check("MCP 060: R₂ = 80 kN", a[1].uit?.combinations?.["1"]?.reactions?.["2"]?.fz, 80);
  const inv = a[2].uit?.steel_check_inputs?.[0];
  const fe = inv?.forces_envelope ?? [];
  const top = fe.reduce((m, p) => (p.forces.my_ed > (m?.forces.my_ed ?? -Infinity) ? p : m), null);
  // VERSCHOVEN BINNEN DE TOLERANTIE (issue #199). `check_fem_model` rekent de
  // UGT-toetskrachten altijd P-Δ met scheefstand φ = 1/200 in ±x. De metgezel
  // φ·q = 10/200 = 0,05 kN/m langs de ligger gaat naar de inklemming: N loopt
  // van 0 (rol) tot 0,3 kN. Via de geometrische stijfheid (orde N·2L/15·θ_B,
  // θ_B = qL³/48EI = 2,57·10⁻³) verschuift het veldmoment met ~3·10⁻⁴ kNm.
  // Gemeten: 25,31263 kNm op x = 3750,008 mm, tegen 25,3125 op 3750 in eerste
  // orde: +5·10⁻⁶ relatief en +2·10⁻⁶ in x, binnen relTol 1e-5. De
  // BGT-zakking hieronder komt uit de resultaten (B6) en blijft exact.
  // VERRUIMDE TOLERANTIE (oktober 2026), relTol 1e-5 → 5e-5: sinds de kern de
  // staafkrachten na P-Δ uit (K_E + K_G)·u rekent, telt langs de staaf ook het
  // P-δ-moment N·(w(x) − w(0)) mee. Met N ≤ 0,3 kN en w ≈ 4 mm is dat orde
  // 300 N · 4 mm = 1,2·10⁻³ kNm; gemeten 25,31300 kNm, +2·10⁻⁵ relatief
  // (+5·10⁻⁴ kNm). De handwaarde 9qL²/128 = 25,3125 is eerste orde; dit
  // verschil is de (juiste) tweede orde van de toets, geen fout.
  check("MCP check 072: my_ed max in de toetsinvoer = 25,3125 kNm (binnen 5e-5, P-δ)", top?.forces?.my_ed, 25.3125, 5e-5);
  check("MCP check 072: op x = 3750 mm", top?.position_mm, 3750);
  check("MCP check 072: deflection_actual_max_mm = −w_max", inv?.deflection_actual_max_mm, -wmax072);
}

log(`\n${failed === 0 ? "GESLAAGD" : "GEFAALD"}: ${passed} geslaagd, ${failed} gefaald.`);
process.exit(failed === 0 ? 0 : 1);

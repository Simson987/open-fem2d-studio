// Lijnlast in een globale richting (issue #80) van eind tot eind: een 3D-model
// met een schuine spant onder sneeuw per horizontale meter gaat door de
// rekenweg van de app (solveOpenFem3D en solveOpenFem3DCombination:
// verzoekopbouw, POST naar /api/openFem3d/solve, de onafhankelijke
// krachtensom) naar de echte 3D-kern, en de reacties, het moment, de
// dwarskracht en de normaalkrachtlijn komen terug in de app. Alles wordt
// vergeleken met een handberekening.
//
// Het model: een spant van knoop 1 (0; 0; 0) naar knoop 2 (4; 0; 3), dus
// a = 4 m horizontaal, h = 3 m hoog, L = 5 m, cos α = 0,8 en sin α = 0,6
// (IPE 300, S235). Sneeuw w = 2 kN/m per horizontale meter: globaal Z,
// q = −2 kN/m per projectie. Per staafmeter is dat w·cos α = 1,6 kN/m
// verticaal, met een dwarscomponent q_t = 1,6·cos α = 1,28 kN/m en een
// axiale component q_x = −1,6·sin α = −0,96 kN/m (langs e_x, de helling af).
//   [1] scharnierend–scharnierend (alle translaties vast aan beide einden):
//       Rz = w·a/2 = 4 kN per einde, Rx = 0; M_max = q_t·L²/8 = 4 kNm;
//       V = ±q_t·L/2 = ±3,2 kN; N(s) = q_x·(L/2 − s): −2,4 → +2,4 kN.
//   [2] spant tegen een wand (knoop 2 alleen horizontaal gesteund, statisch
//       bepaald): R2x = −w·a·(a/2)/h = −16/3 kN, R1x = 16/3, R1z = w·a = 8;
//       N(0) = −(R1x·cos α + R1z·sin α) = −9,0667 kN, dN/ds = −q_x, dus
//       N(L) = R2x·cos α = −4,2667 kN; M_max = 4 kNm; de kop zakt exact
//       u_z = L·N_gem/(EA·sin α) (de axiale knooplasten zijn consistent).
//   [3] de combinatie 1,5·S: alles schaalt met 1,5.
//   [4] P-Δ op [2]: rekent, evenwicht, en dN/ds = −q_x blijft exact.
//
// Rekenkern: OPEN_FEM_3D_SOLVER_PATH, anders src-tauri/target/debug/open-fem-3d(.exe).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseOpenFem3DModel } from "./src/components/openFem3d/openFem3dModel.ts";
import { solveOpenFem3D, solveOpenFem3DCombination } from "./src/components/openFem3d/openFem3dSolver.ts";

let geslaagd = 0;
const ok = (waar, naam) => { assert.ok(waar, naam); geslaagd++; console.log(`  ✓ ${naam}`); };
const fmt = (x) => Math.abs(x) >= 0.01 || x === 0 ? x.toFixed(4) : x.toExponential(4);
/** |werkelijk − verwacht| ≤ grens; de grens staat bij elke aanroep verantwoord. */
const binnen = (werkelijk, verwacht, grens, naam) => {
  const verschil = Math.abs(werkelijk - verwacht);
  assert.ok(Number.isFinite(werkelijk) && verschil <= grens,
    `${naam}: berekend ${werkelijk}, verwacht ${verwacht}, verschil ${verschil} > ${grens}`);
  geslaagd++;
  console.log(`  ✓ ${naam} (${fmt(werkelijk)} tegen ${fmt(verwacht)}, verschil ${verschil.toExponential(1)})`);
};

const solverBinary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${solverBinary}`, import.meta.url));
assert.ok(existsSync(solverPath), `Bouw eerst de Rust-rekenkern (${solverPath}) of zet OPEN_FEM_3D_SOLVER_PATH.`);

/** De rekenweg van de app in de browser: POST /api/openFem3d/solve, hier naar de echte kern (zoals vite.config.ts). */
const verzoeken = [];
const vorigeFetch = globalThis.fetch;
globalThis.fetch = (url, options) => new Promise((resolve, reject) => {
  assert.equal(url, "/api/openFem3d/solve");
  verzoeken.push(JSON.parse(options.body));
  const kind = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  const uit = [];
  kind.stdout.on("data", (d) => uit.push(d));
  kind.on("error", reject);
  kind.on("close", (code) => {
    const tekst = Buffer.concat(uit).toString();
    resolve({ ok: code === 0, status: code === 0 ? 200 : 500, json: async () => JSON.parse(tekst) });
  });
  kind.stdin.end(options.body);
});

// ── Het model en de handberekening ───────────────────────────────────────
const A = 4, H = 3, L = 5, COS = A / L, SIN = H / L;
const W = 2;                       // kN/m per horizontale meter
const Q_VERTICAAL = W * COS;       // 1,6 kN/m per staafmeter, omlaag
const Q_T = Q_VERTICAAL * COS;     // 1,28 kN/m loodrecht op de staaf
const Q_X = -Q_VERTICAAL * SIN;    // −0,96 kN/m langs e_x (de helling af)
const sneeuw = { id: 1, beamId: 1, caseId: 1, globalDirection: "z", qStart: -W, qEnd: -W, perProjection: true, startPositionM: 0, endPositionM: L };
// Knoop 1 houdt ook de draaiing om X en Z vast: anders draait de staaf vrij om zijn eigen as.
const knoop1 = { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: false, rz: true };
const model = (kop) => parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: A, y: 0, z: H }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 300", material: "S235" }],
  supports: [knoop1, { nodeId: 2, rx: false, ry: false, rz: false, ...kop }],
  loads: [], memberLoads: [sneeuw], memberPointLoads: [],
});
const scharnierend = () => model({ ux: true, uy: true, uz: true });
const tegenWand = () => model({ ux: true, uy: true, uz: false });

const reactie = (result, nodeId) => result.reactions.find((r) => r.nodeId === nodeId)
  ?? { nodeId, fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 };
const lijn = (result, soort) => result.diagrams[soort].find((d) => d.memberId === 1);
const krachten = (result) => result.memberForces.find((f) => f.memberId === 1);

/**
 * Vergelijk één uitkomst met de handberekening: reacties, momentenlijn,
 * dwarskracht, normaalkrachtlijn (elk punt) en eindnormaalkrachten, met het
 * evenwicht van de kern en de onafhankelijke krachtensom van de app.
 * Grenzen: de kern rekent een staaf exact (afrondruis rond 1e-13 kN);
 * 1e-9 kN laat daar ruim marge voor en vangt elke echte afwijking.
 */
function vergelijk(result, verwacht, factor, label) {
  const grens = 1e-9 * Math.max(1, factor);
  for (const [nodeId, fx, fz] of verwacht.reacties) {
    binnen(reactie(result, nodeId).fx, fx * factor, grens, `${label}: R${nodeId}x`);
    binnen(reactie(result, nodeId).fz, fz * factor, grens, `${label}: R${nodeId}z`);
  }
  binnen(result.reactions.reduce((som, r) => som + r.fz, 0), W * A * factor, grens, `${label}: ΣRz = w·a`);
  // Moment: M(s) = q_t·s·(L − s)/2 (scharnieren aan beide einden), in elk lijnpunt.
  const my = lijn(result, "momentY");
  const momentAfwijking = Math.max(...my.points.map((p) => Math.abs(Math.abs(p.value) - Q_T * factor * p.t * L * (L - p.t * L) / 2)));
  ok(momentAfwijking <= grens,
    `${label}: elk punt van de momentenlijn |My| = q_t·s·(L − s)/2 (${my.points.length} punten, grootste afwijking ${momentAfwijking.toExponential(1)} kNm)`);
  binnen(Math.abs(my.maxAbsValue), Q_T * factor * L * L / 8, grens, `${label}: M_max = q_t·L²/8`);
  binnen(lijn(result, "momentZ").maxAbsValue, 0, grens, `${label}: geen buiging uit het vlak`);
  const vz = krachten(result);
  binnen(Math.abs(vz.vzStartKn), Q_T * factor * L / 2, grens, `${label}: |V| begin = q_t·L/2`);
  binnen(Math.abs(vz.vzEndKn), Q_T * factor * L / 2, grens, `${label}: |V| eind = q_t·L/2`);
  // Normaalkracht (trek positief): N(s) = N(0) − q_x·s.
  const n = (s) => (verwacht.n0 - Q_X * s) * factor;
  binnen(vz.nStartKn, n(0), grens, `${label}: N begin`);
  binnen(vz.nEndKn, n(L), grens, `${label}: N eind`);
  const axiaal = lijn(result, "axial");
  ok(axiaal.points[0].t === 0 && axiaal.points.at(-1).t === 1, `${label}: de N-lijn loopt van t = 0 tot t = 1 (${axiaal.points.length} punten)`);
  const grootste = Math.max(...axiaal.points.map((p) => Math.abs(p.value - n(p.t * L))));
  ok(grootste <= grens, `${label}: elk punt van de N-lijn op de rechte lijn (grootste afwijking ${grootste.toExponential(1)} kN)`);
  ok(result.equilibrium?.equilibriumOk === true, `${label}: evenwicht volgens de kern (${result.equilibrium?.maxImbalanceKn.toExponential(1)} kN)`);
  ok(result.forceBalance?.ok === true,
    `${label}: de onafhankelijke krachtensom van de app sluit (${result.forceBalance?.maxImbalanceKn.toExponential(1)} kN, ${result.forceBalance?.maxMomentImbalanceKnm.toExponential(1)} kNm)`);
}

const scharnierendVerwacht = { reacties: [[1, 0, W * A / 2], [2, 0, W * A / 2]], n0: Q_X * L / 2 };
const R2X = -W * A * (A / 2) / H;
const wandVerwacht = { reacties: [[1, -R2X, W * A], [2, R2X, 0]], n0: -(-R2X * COS + W * A * SIN) };

console.log("[0] de handberekening");
{
  binnen(Q_T, 1.28, 1e-15, "q_t = w·cos²α");
  binnen(Q_X, -0.96, 1e-15, "q_x = −w·cos α·sin α");
  binnen(scharnierendVerwacht.n0, -2.4, 1e-15, "scharnierend: N(0) = q_x·L/2");
  binnen(wandVerwacht.n0, -9.0666666666666667, 1e-12, "tegen de wand: N(0) = −(R1x·cos α + R1z·sin α)");
  binnen(wandVerwacht.n0 - Q_X * L, R2X * COS, 1e-12, "tegen de wand: N(L) = R2x·cos α (de kop, langs de staaf)");
}

console.log("\n[1] scharnierend–scharnierend, belastinggeval S, lineair");
{
  const result = await solveOpenFem3D(scharnierend(), 1, "linear");
  assert.deepEqual(verzoeken.at(-1).memberLoads, [{
    id: 1, memberId: 1, globalDirection: "z", qStartKnPerM: -2, qEndKnPerM: -2, perProjection: true, startPositionM: 0, endPositionM: 5,
  }], "het verzoek van de app");
  ok(true, "het verzoek draagt de last 1-op-1 volgens het contract (globalDirection z, q = −2, perProjection)");
  vergelijk(result, scharnierendVerwacht, 1, "scharnierend");
}

console.log("\n[2] spant tegen een wand (statisch bepaald), lineair");
let lineairTegenWand;
{
  const result = await solveOpenFem3D(tegenWand(), 1, "linear");
  lineairTegenWand = result;
  vergelijk(result, wandVerwacht, 1, "tegen de wand");
  // De kop beweegt alleen in Z (X en Y vast); de verkorting langs de staaf is
  // u·e_x = u_z·sin α = ∫N/EA ds = L·N_gem/EA, exact dankzij de consistente
  // axiale knooplasten (de buiging verandert de koordlengte lineair niet).
  const verzoek = verzoeken.at(-1);
  const EA = verzoek.materials[0].eMpa * 1000 * verzoek.sections[0].areaM2;
  const nGemiddeld = wandVerwacht.n0 - Q_X * L / 2;
  const uz = result.displacements.find((d) => d.nodeId === 2).uz;
  binnen(uz, L * nGemiddeld / (EA * SIN), 1e-12 * Math.abs(L * nGemiddeld / (EA * SIN)) + 1e-15,
    `tegen de wand: u_z van de kop = L·N_gem/(EA·sin α), N_gem = ${nGemiddeld.toFixed(4)} kN`);
}

console.log("\n[3] de combinatie 1,5·S");
{
  const result = await solveOpenFem3DCombination(tegenWand(), new Map([[1, 1.5]]), "linear");
  const [last] = verzoeken.at(-1).memberLoads;
  ok(last.qStartKnPerM === -3 && last.qEndKnPerM === -3 && last.perProjection === true, "het verzoek: q = 1,5 · −2 = −3 kN/m, per projectie");
  vergelijk(result, wandVerwacht, 1.5, "1,5·S");
}

console.log("\n[4] P-Δ op de spant tegen de wand");
{
  const result = await solveOpenFem3D(tegenWand(), 1, "p-delta");
  ok(result.analysis === "p-delta" && result.secondOrder?.converged === true, `P-Δ convergeert (${result.secondOrder?.iterations} iteraties)`);
  ok(result.equilibrium?.equilibriumOk === true, "P-Δ: evenwicht volgens de kern");
  ok(result.forceBalance?.ok === true, "P-Δ: de onafhankelijke krachtensom sluit (met het tweede-ordemoment)");
  binnen(result.reactions.reduce((som, r) => som + r.fz, 0), W * A, 1e-9, "P-Δ: ΣRz = w·a");
  const f = krachten(result);
  // Tweede orde met N_gem per element: de helling van de N-lijn blijft −q_x exact.
  binnen(f.nEndKn - f.nStartKn, -Q_X * L, 1e-9, "P-Δ: N(L) − N(0) = −q_x·L = 4,8 kN");
  const lineair = krachten(lineairTegenWand);
  binnen(f.nStartKn, lineair.nStartKn, 0.01 * Math.abs(lineair.nStartKn), "P-Δ: N(0) binnen 1 % van lineair (druk 9 kN, ver onder de knikkracht)");
  binnen(lijn(result, "momentY").maxAbsValue, lijn(lineairTegenWand, "momentY").maxAbsValue, 0.01 * 4,
    "P-Δ: M_max binnen 1 % van lineair");
}

globalThis.fetch = vorigeFetch;
console.log(`\n${geslaagd} geslaagd, 0 gefaald`);

// Eigen gewicht langs de staafas als verdeelde last (issue #112), van eind tot
// eind: het automatische eigen gewicht (`withOpenFem3DSelfWeight`) gaat als
// globale lijnlast in Z per deel door de rekenweg van de app (solveOpenFem3D:
// verzoekopbouw, POST naar /api/openFem3d/solve, de onafhankelijke krachtensom)
// naar de echte 3D-kern. De kern verdeelt ook de axiale component over de
// staaf (#80), dus de N-lijn klopt nu op elk punt. Tot oktober 2026 ging de
// axiale component als knooplasten naar de staafeinden: de reacties klopten,
// de N-lijn van een kolom week tot het halve kolomgewicht af.
//
//   [1] Staande kolom IPE 200, L = 4 m, ingeklemd aan de voet, verder vrij:
//       N(s) = −q·(L − s), van −G aan de voet naar 0 aan de top (druk
//       negatief); R_z = G; geen buiging. De reacties zijn gelijk aan die van
//       de oude aanpak (G/2 als knooplast op elk einde).
//   [2] Schuine spant IPE 300 van (0; 0; 0) naar (4; 0; 3), L = 5 m,
//       sin α = 0,6, cos α = 0,8; knoop 1 scharnierend, knoop 2 alleen
//       verticaal (en uit het vlak) gesteund. Met G = q·L: R1z = R2z = G/2,
//       geen horizontale reactie; N(s) = sin α·(G/2 − q·(L − s)), van
//       −0,6·G/2 onderaan naar +0,6·G/2 bovenaan; M_max = q·cos α·L²/8.
//       Met de oude knooplasten was N over de hele staaf 0.
//   [3] Verlopende kolom HEA 500 → HEA 300, L = 6 m, ingeklemd aan de voet:
//       twintig deellasten; N(t) = −Σ q_i·(lengte van de delen boven t), op
//       elk punt van de N-lijn; aan de voet het hele gewicht.
//
// Rekenkern: OPEN_FEM_3D_SOLVER_PATH, anders src-tauri/target/debug/open-fem-3d(.exe).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseOpenFem3DModel, withOpenFem3DSelfWeight } from "./src/components/openFem3d/openFem3dModel.ts";
import { solveOpenFem3D } from "./src/components/openFem3d/openFem3dSolver.ts";

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
globalThis.fetch = (url, options) => new Promise((resolve, reject) => {
  assert.equal(url, "/api/openFem3d/solve");
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

const reactie = (result, nodeId) => result.reactions.find((r) => r.nodeId === nodeId)
  ?? { nodeId, fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 };
const lijn = (result, soort) => result.diagrams[soort].find((d) => d.memberId === 1);
const krachten = (result) => result.memberForces.find((f) => f.memberId === 1);
const VAST = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };
/** Het gewicht per staafmeter van het automatische eigen gewicht (de globale Z-last zelf). */
const qVan = (model) => -withOpenFem3DSelfWeight(model, 1).memberLoads[0].qStart;
// Grens: de kern rekent een staaf exact (afrondruis rond 1e-13 kN); 1e-9 kN
// laat daar ruim marge voor en vangt elke echte afwijking.
const GRENS = 1e-9;

/** Elk punt van de N-lijn tegen de handberekening n(s), s in m vanaf de beginknoop. */
function nLijn(result, n, L, label) {
  const axiaal = lijn(result, "axial");
  ok(axiaal.points[0].t === 0 && axiaal.points.at(-1).t === 1, `${label}: de N-lijn loopt van t = 0 tot t = 1 (${axiaal.points.length} punten)`);
  const grootste = Math.max(...axiaal.points.map((p) => Math.abs(p.value - n(p.t * L))));
  ok(grootste <= GRENS, `${label}: elk punt van de N-lijn op de handberekening (grootste afwijking ${grootste.toExponential(1)} kN)`);
  binnen(krachten(result).nStartKn, n(0), GRENS, `${label}: N begin`);
  binnen(krachten(result).nEndKn, n(L), GRENS, `${label}: N eind`);
}

function evenwicht(result, label) {
  ok(result.equilibrium?.equilibriumOk === true, `${label}: evenwicht volgens de kern (${result.equilibrium?.maxImbalanceKn.toExponential(1)} kN)`);
  ok(result.forceBalance?.ok === true,
    `${label}: de onafhankelijke krachtensom van de app sluit (${result.forceBalance?.maxImbalanceKn.toExponential(1)} kN)`);
}

console.log("[1] staande kolom IPE 200, L = 4 m, ingeklemd aan de voet");
{
  const L = 4;
  const kolom = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: L }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 200", material: "S235" }],
    supports: [{ nodeId: 1, ...VAST }], loads: [], memberLoads: [], memberPointLoads: [],
  });
  const q = qVan(kolom), G = q * L;
  binnen(q, 7850 * 2850e-6 * 9.81 / 1000, 1e-15, "q = ρ·A·g (IPE 200, A = 2850 mm²)");
  const met = withOpenFem3DSelfWeight(kolom, 1);
  ok(met.loads.length === 0 && met.memberLoads.length === 1 && met.memberLoads[0].globalDirection === "z",
    "het eigen gewicht is één globale Z-last, geen knooplasten");
  const result = await solveOpenFem3D(met, 1, "linear");
  nLijn(result, (s) => -q * (L - s), L, "kolom: N(s) = −q·(L − s)");
  binnen(reactie(result, 1).fz, G, GRENS, "kolom: R_z = G");
  binnen(Math.hypot(reactie(result, 1).fx, reactie(result, 1).fy), 0, GRENS, "kolom: geen horizontale reactie");
  binnen(lijn(result, "momentY").maxAbsValue + lijn(result, "momentZ").maxAbsValue, 0, GRENS, "kolom: geen buiging");
  evenwicht(result, "kolom");
  // De oude aanpak: G/2 als knooplast op elk einde. Dezelfde reacties, een vlakke N-lijn.
  const oud = await solveOpenFem3D({ ...kolom, loads: [1, 2].map((nodeId, i) => ({
    id: i + 1, nodeId, caseId: 1, fx: 0, fy: 0, fz: -G / 2, mx: 0, my: 0, mz: 0 })) }, 1, "linear");
  for (const as of ["fx", "fy", "fz", "mx", "my", "mz"]) {
    binnen(reactie(result, 1)[as], reactie(oud, 1)[as], GRENS, `kolom: reactie ${as} gelijk aan de oude aanpak`);
  }
  ok(Math.abs(krachten(oud).nStartKn - krachten(oud).nEndKn) < GRENS && Math.abs(krachten(oud).nStartKn + G / 2) < GRENS,
    `kolom: de oude aanpak gaf N = −G/2 over de hele kolom (${fmt(krachten(oud).nStartKn)} kN), nu −G aan de voet (${fmt(krachten(result).nStartKn)} kN)`);
}

console.log("\n[2] schuine spant IPE 300 van (0; 0; 0) naar (4; 0; 3)");
{
  const A = 4, H = 3, L = 5, SIN = H / L, COS = A / L;
  const spant = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: A, y: 0, z: H }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 300", material: "S235" }],
    supports: [
      // Knoop 1 houdt ook de draaiing om X en Z vast: anders draait de staaf vrij om zijn eigen as.
      { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: false, rz: true },
      { nodeId: 2, ux: false, uy: true, uz: true, rx: false, ry: false, rz: false },
    ],
    loads: [], memberLoads: [], memberPointLoads: [],
  });
  const q = qVan(spant), G = q * L;
  const result = await solveOpenFem3D(withOpenFem3DSelfWeight(spant, 1), 1, "linear");
  binnen(reactie(result, 1).fz, G / 2, GRENS, "spant: R1z = G/2");
  binnen(reactie(result, 2).fz, G / 2, GRENS, "spant: R2z = G/2");
  binnen(reactie(result, 1).fx, 0, GRENS, "spant: geen horizontale reactie");
  nLijn(result, (s) => SIN * (G / 2 - q * (L - s)), L, "spant: N(s) = sin α·(G/2 − q·(L − s))");
  binnen(krachten(result).nEndKn, SIN * G / 2, GRENS, "spant: bovenaan trek +sin α·G/2 (de verticale oplegging trekt de staaf de helling op)");
  binnen(Math.abs(lijn(result, "momentY").maxAbsValue), q * COS * L * L / 8, GRENS, "spant: M_max = q·cos α·L²/8");
  evenwicht(result, "spant");
}

console.log("\n[3] verlopende kolom HEA 500 → HEA 300, L = 6 m, ingeklemd aan de voet");
{
  const L = 6;
  const kolom = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: L }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA 500", profileNameEnd: "HEA 300", material: "S235" }],
    supports: [{ nodeId: 1, ...VAST }], loads: [], memberLoads: [], memberPointLoads: [],
  });
  const met = withOpenFem3DSelfWeight(kolom, 1);
  const delen = met.memberLoads;
  ok(delen.length === 20 && met.loads.length === 0 && delen.every((l) => l.globalDirection === "z"),
    "twintig globale Z-deellasten, geen knooplasten");
  ok(-delen[0].qStart > -delen[19].qStart, "het zware begin weegt per meter meer dan het lichte eind");
  // N(s) = −∫_s^L q(s') ds', per deel constant q.
  const n = (s) => -delen.reduce((som, l) => som - l.qStart * Math.max(0, l.endPositionM - Math.max(s, l.startPositionM)), 0);
  const G = -delen.reduce((som, l) => som + l.qStart * (l.endPositionM - l.startPositionM), 0);
  const result = await solveOpenFem3D(met, 1, "linear");
  binnen(reactie(result, 1).fz, G, GRENS, "verlopend: R_z = Σ q_i·L/20");
  nLijn(result, n, L, "verlopend: N(s) = −Σ q_i·(deel boven s)");
  binnen(krachten(result).nStartKn, -G, GRENS, "verlopend: aan de voet het hele gewicht");
  evenwicht(result, "verlopend");
}

console.log(`\n${geslaagd} geslaagd, 0 gefaald`);

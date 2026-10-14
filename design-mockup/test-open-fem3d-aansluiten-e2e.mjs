// Knopen op staven aansluiten (issue #63) van eind tot eind, met de echte
// 3D-kern: een funderingsbalk van 12 m met drie kolommen erop waarvan de
// voeten wel op de balk liggen maar er niet aan vastzitten (zo kwam het
// funderingsmodel uit het issue binnen). Het model gaat door
// connectOpenFem3DNodesToBeams en daarna door de rekenweg van de app
// (solveOpenFem3D: verzoekopbouw, POST naar /api/openFem3d/solve, de
// onafhankelijke krachtensom) naar de kern. Het wordt vergeleken met
// hetzelfde model dat met de hand in vier staven is ingevoerd, met de lasten
// per deel met de hand verdeeld. De reacties en verplaatsingen horen gelijk
// te zijn op afrondingsruis na.
//
//   [1] balk op twee opleggingen (knoop 1 scharnierend met torsie vast,
//       knoop 2 ingeklemd om Y met een momentscharnier aan het balkeind):
//       het automatisch aansluiten (na het tekenen van de kolommen) geeft
//       hetzelfde model als de knop; reacties en verplaatsingen gelijk;
//       ΣRz = de totale last; zonder
//       aansluiten rekent de kern het model niet (de kolommen zweven) of
//       komt er een ander antwoord;
//   [2] dezelfde balk op bedding (Winkler, issue #106): verplaatsingen,
//       horizontale reacties en de bedding per deel gelijk; Σ bedding = de
//       totale verticale last;
//   [3] lastgrenzen precies op een kolomvoet met coördinaten in hele mm (de
//       knipafstand is binair niet exact): geen extra lastregel, geen last
//       van lengte 0; opslaan, openen en de kern rekenen het model.
//
// Rekenkern: OPEN_FEM_3D_SOLVER_PATH, anders src-tauri/target/debug/open-fem-3d(.exe).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseOpenFem3DModel } from "./src/components/openFem3d/openFem3dModel.ts";
import { autoConnectOpenFem3DEdit, connectOpenFem3DNodesToBeams } from "./src/components/openFem3d/openFem3dAansluiten.ts";
import { solveOpenFem3D } from "./src/components/openFem3d/openFem3dSolver.ts";

let geslaagd = 0;
const ok = (waar, naam) => { assert.ok(waar, naam); geslaagd++; console.log(`  ✓ ${naam}`); };

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

// ── De modellen ──────────────────────────────────────────────────────────
// Knopen: balk 1 (0 m) en 2 (12 m), kolomvoeten 3, 4, 5 (3, 6 en 9 m),
// kolomkoppen 6, 7, 8 (3 m hoog). Kolommen HEA 200, balk IPE 300 (S235).
const KNOPEN = [
  { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 12, y: 0, z: 0 },
  { id: 3, x: 3, y: 0, z: 0 }, { id: 4, x: 6, y: 0, z: 0 }, { id: 5, x: 9, y: 0, z: 0 },
  { id: 6, x: 3, y: 0, z: 3 }, { id: 7, x: 6, y: 0, z: 3 }, { id: 8, x: 9, y: 0, z: 3 },
];
const KOLOMMEN = [
  { id: 2, startNodeId: 3, endNodeId: 6, profileName: "HEA 200", material: "S235" },
  { id: 3, startNodeId: 4, endNodeId: 7, profileName: "HEA 200", material: "S235" },
  { id: 4, startNodeId: 5, endNodeId: 8, profileName: "HEA 200", material: "S235" },
];
const KNOOPLASTEN = [
  { id: 1, nodeId: 6, caseId: 1, fx: 0, fy: 0, fz: -40, mx: 0, my: 0, mz: 0 },
  { id: 2, nodeId: 7, caseId: 1, fx: 5, fy: 0, fz: -50, mx: 0, my: 0, mz: 0 },
  { id: 3, nodeId: 8, caseId: 1, fx: 0, fy: 0, fz: -30, mx: 0, my: 0, mz: 0 },
];
// Totale verticale last: 120 (kolommen) + 32 (trapezium) + 36 (globaal Z) + 10 (puntlast) = 198 kN.
const TOTAAL_KN = 198;
const balk = { profileName: "IPE 300", material: "S235" };
const eindScharnier = { myStart: false, myEnd: true, mzStart: false, mzEnd: false, torsionStart: false, torsionEnd: false };

/** Het model zoals het binnenkwam: één balk 1 → 2, de kolomvoeten los erop. */
const losModel = (extra) => parseOpenFem3DModel({
  nodes: KNOPEN,
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, ...balk, releases: eindScharnier, ...extra.balk }, ...KOLOMMEN],
  supports: extra.supports, loads: KNOOPLASTEN,
  memberLoads: [
    { id: 1, beamId: 1, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -2, qzEnd: -6, startPositionM: 2, endPositionM: 10 },
    { id: 2, beamId: 1, caseId: 1, globalDirection: "z", qStart: -3, qEnd: -3, startPositionM: 0, endPositionM: 12 },
  ],
  memberPointLoads: [{ id: 1, beamId: 1, caseId: 1, py: 0, pz: -10, positionM: 7.5 }],
});

/**
 * Hetzelfde model met de hand in vier staven (11: 1→3, 12: 3→4, 13: 4→5,
 * 14: 5→2), de lasten met de hand per deel: het trapezium −2 → −6 kN/m van 2
 * tot 10 m is q(x) = −2 − 0,5·(x − 2), dus −2,5 op 3 m, −4 op 6 m en −5,5 op
 * 9 m; de puntlast op 7,5 m staat op deel 13 op 1,5 m. Het momentscharnier
 * aan het balkeind zit aan het eind van deel 14.
 */
const handModel = (extra) => parseOpenFem3DModel({
  nodes: KNOPEN,
  beams: [
    { id: 11, startNodeId: 1, endNodeId: 3, ...balk, ...extra.balk },
    { id: 12, startNodeId: 3, endNodeId: 4, ...balk, ...extra.balk },
    { id: 13, startNodeId: 4, endNodeId: 5, ...balk, ...extra.balk },
    { id: 14, startNodeId: 5, endNodeId: 2, ...balk, releases: eindScharnier, ...extra.balk },
    ...KOLOMMEN,
  ],
  supports: extra.supports, loads: KNOOPLASTEN,
  memberLoads: [
    { id: 1, beamId: 11, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -2, qzEnd: -2.5, startPositionM: 2, endPositionM: 3 },
    { id: 2, beamId: 12, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -2.5, qzEnd: -4, startPositionM: 0, endPositionM: 3 },
    { id: 3, beamId: 13, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -4, qzEnd: -5.5, startPositionM: 0, endPositionM: 3 },
    { id: 4, beamId: 14, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -5.5, qzEnd: -6, startPositionM: 0, endPositionM: 1 },
    ...[11, 12, 13, 14].map((beamId, i) => ({ id: 5 + i, beamId, caseId: 1, globalDirection: "z", qStart: -3, qEnd: -3, startPositionM: 0, endPositionM: 3 })),
  ],
  memberPointLoads: [{ id: 1, beamId: 13, caseId: 1, py: 0, pz: -10, positionM: 1.5 }],
});

const reactie = (result, nodeId) => result.reactions.find((r) => r.nodeId === nodeId)
  ?? { nodeId, fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 };
const verplaatsing = (result, nodeId) => result.displacements.find((d) => d.nodeId === nodeId);
const COMP_R = ["fx", "fy", "fz", "mx", "my", "mz"];
const COMP_U = ["ux", "uy", "uz", "rx", "ry", "rz"];

/**
 * Vergelijk aangesloten en met de hand gesplitst. Grenzen: beide modellen
 * hebben dezelfde staven en knopen; alleen de lastwaarden op de knippunten
 * zijn bij het aansluiten geïnterpoleerd (−2,5 + (−3,5)·3/7 voor het tweede
 * knippunt) en kunnen daardoor in de laatste bit van de met de hand
 * ingevoerde waarde afwijken. Dat zou verschillen van orde 1e-15 kN geven;
 * 1e-9 kN en 1e-12 m laten daar ruim marge voor en vangen elke echte
 * afwijking (een verkeerd verdeelde last scheelt kN's).
 */
function vergelijk(a, b, label) {
  let r = 0, u = 0;
  for (const nodeId of KNOPEN.map((k) => k.id)) {
    for (const c of COMP_R) r = Math.max(r, Math.abs(reactie(a, nodeId)[c] - reactie(b, nodeId)[c]));
    for (const c of COMP_U) u = Math.max(u, Math.abs(verplaatsing(a, nodeId)[c] - verplaatsing(b, nodeId)[c]));
  }
  ok(r <= 1e-9, `${label}: alle reacties gelijk (grootste verschil ${r.toExponential(1)} kN/kNm)`);
  ok(u <= 1e-12, `${label}: alle verplaatsingen en rotaties gelijk (grootste verschil ${u.toExponential(1)} m/rad)`);
}

// ── [1] balk op twee opleggingen ─────────────────────────────────────────
console.log("[1] balk op twee opleggingen, kolommen erop");
{
  const opleggingen = [
    { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: false, rz: false },
    { nodeId: 2, ux: false, uy: true, uz: true, rx: true, ry: true, rz: false },
  ];
  const los = losModel({ balk: {}, supports: opleggingen });
  const aangesloten = connectOpenFem3DNodesToBeams(los);
  ok(aangesloten.splits.length === 1 && aangesloten.splits[0].parts === 4, "de balk is in vier delen gesplitst");
  // Automatisch (zoals App.setOpenFem3d): de kolommen met hun voeten en
  // lasten erbij op de balk die er al lag. Precies hetzelfde model als de knop.
  const zonderKolommen = { ...los, nodes: los.nodes.filter((n) => n.id <= 2), beams: los.beams.filter((b) => b.id === 1), loads: [] };
  const automatisch = autoConnectOpenFem3DEdit(zonderKolommen, los, { enabled: true, toleranceMm: 5 });
  ok(automatisch !== null && JSON.stringify(automatisch.model) === JSON.stringify(aangesloten.model),
    "automatisch aansluiten na het tekenen van de kolommen: precies hetzelfde model als de knop");
  const a = await solveOpenFem3D(aangesloten.model, 1, "linear");
  const b = await solveOpenFem3D(handModel({ balk: {}, supports: opleggingen }), 1, "linear");
  ok(a.forceBalance?.ok === true && b.forceBalance?.ok === true, "beide in evenwicht (de onafhankelijke krachtensom van de app)");
  vergelijk(a, b, "aangesloten tegen met de hand gesplitst");
  const somRz = a.reactions.reduce((s, x) => s + x.fz, 0);
  ok(Math.abs(somRz - TOTAAL_KN) <= 1e-9, `ΣRz = ${somRz.toFixed(6)} kN = de totale last ${TOTAAL_KN} kN`);
  ok(Math.abs(reactie(a, 1).fx + 5) <= 1e-9, "de horizontale last van 5 kN op kolom 7 komt in knoop 1 (Rx = −5 kN)");
  // Zonder aansluiten zweven de kolommen: de kern weigert, of de kolomlasten bereiken de opleggingen niet.
  let zonder = null;
  try { zonder = await solveOpenFem3D(los, 1, "linear"); } catch (e) { zonder = e; }
  ok(zonder instanceof Error || Math.abs(zonder.reactions.reduce((s, x) => s + x.fz, 0) - TOTAAL_KN) > 1,
    `zonder aansluiten: ${zonder instanceof Error ? `de kern weigert (${zonder.message.slice(0, 80)})` : "een ander antwoord"}`);
}

// ── [2] balk op bedding ──────────────────────────────────────────────────
console.log("\n[2] dezelfde balk op bedding (Winkler)");
{
  const bedding = { kKnPerM3: 20000, widthM: 0.6 };
  // Alleen horizontaal en torsie vast; verticaal draagt de bedding.
  const opleggingen = [
    { nodeId: 1, ux: true, uy: true, uz: false, rx: true, ry: false, rz: false },
    { nodeId: 2, ux: false, uy: true, uz: false, rx: true, ry: true, rz: false },
  ];
  const los = losModel({ balk: { bedding }, supports: opleggingen });
  const aangesloten = connectOpenFem3DNodesToBeams(los);
  ok(aangesloten.model.beams.filter((b) => b.bedding?.kKnPerM3 === 20000).length === 4, "de bedding staat op alle vier delen");
  const a = await solveOpenFem3D(aangesloten.model, 1, "linear");
  const b = await solveOpenFem3D(handModel({ balk: { bedding }, supports: opleggingen }), 1, "linear");
  ok(a.forceBalance?.ok === true && b.forceBalance?.ok === true, "beide in evenwicht");
  vergelijk(a, b, "op bedding: aangesloten tegen met de hand gesplitst");
  const grond = (result) => (result.bedding ?? []).reduce((s, x) => s + x.totalReactionKn, 0);
  ok(Math.abs(grond(a) - grond(b)) <= 1e-9 && Math.abs(grond(a) - TOTAAL_KN) <= 1e-6,
    `Σ bedding ${grond(a).toFixed(6)} kN = met de hand ${grond(b).toFixed(6)} kN = de totale last`);
}

// ── [3] lastgrenzen op de knoop, coördinaten in hele mm ──────────────────
console.log("\n[3] lastgrenzen precies op een kolomvoet, met coördinaten die binair niet exact zijn");
{
  // Een ligger in hele mm (10,243 → 20,225 m) met qz −1 kN/m tot 7,6 m en
  // −2 kN/m vanaf 7,6 m; de kolomvoet komt op x = 10,243 + 7,6. De knipafstand
  // wordt 7,6000000000000005: zonder ruimte rond het knippunt werd last 2 op
  // deel 1 een last [7,6; 7,6] (lengte 0) en weigerden opslaan en de kern.
  const Lw = 20.225 - 10.243;
  const zonder = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 10.243, y: 28.757, z: 0.822 }, { id: 2, x: 20.225, y: 28.757, z: 0.822 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 300", material: "S235" }],
    supports: [
      { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: false, rz: false },
      { nodeId: 2, ux: false, uy: true, uz: true, rx: false, ry: false, rz: false },
    ],
    memberLoads: [
      { id: 1, beamId: 1, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -1, qzEnd: -1, startPositionM: 0, endPositionM: 7.6 },
      { id: 2, beamId: 1, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -2, qzEnd: -2, startPositionM: 7.6, endPositionM: Lw },
    ],
  });
  // De kolom erbij (zoals tekenen): voet op de ligger, kop 3 m hoger en zijdelings vast.
  const met = parseOpenFem3DModel({
    ...zonder,
    nodes: [...zonder.nodes, { id: 3, x: 10.243 + 7.6, y: 28.757, z: 0.822 }, { id: 4, x: 10.243 + 7.6, y: 28.757, z: 3.822 }],
    beams: [...zonder.beams, { id: 2, startNodeId: 3, endNodeId: 4, profileName: "HEA 200", material: "S235" }],
    supports: [...zonder.supports, { nodeId: 4, ux: true, uy: true, uz: false, rx: false, ry: false, rz: false }],
  });
  const automatisch = autoConnectOpenFem3DEdit(zonder, met, { enabled: true, toleranceMm: 5 });
  ok(automatisch !== null && automatisch.splits.length === 1, "de kolomvoet wordt automatisch aangesloten");
  const lasten = automatisch.model.memberLoads;
  ok(lasten.length === 2 && lasten.every((l) => l.endPositionM - l.startPositionM > 1e-6),
    `geen extra lastregels en geen last van lengte 0: ${JSON.stringify(lasten.map((l) => [l.id, l.beamId, l.startPositionM, l.endPositionM]))}`);
  const { serializeProject, deserializeProject } = await import("./src/io/projectFile.ts");
  const tekst = serializeProject({
    modelDimension: "3d", model3d: automatisch.model, nodes: [], beams: [], supports: [], plates: [], loads: [], loadCases: [],
  });
  const terug = parseOpenFem3DModel(deserializeProject(tekst).model3d);
  ok(JSON.stringify(terug.memberLoads) === JSON.stringify(lasten), "opslaan en openen: dezelfde twee lasten");
  const r = await solveOpenFem3D(terug, 1, "linear");
  const totaal = 1 * 7.6 + 2 * (Lw - 7.6);
  const somRz = r.reactions.reduce((s, x) => s + x.fz, 0);
  ok(r.forceBalance?.ok === true && Math.abs(somRz - totaal) <= 1e-9,
    `de kern rekent het model: ΣRz = ${somRz.toFixed(9)} kN = de totale last ${totaal.toFixed(9)} kN`);
}

console.log(`\n${geslaagd} geslaagd, 0 gefaald`);

// Knopen samenvoegen (issue #75) van eind tot eind, met de echte 3D-kern: een
// dubbele staaf die door het samenvoegen één staaf wordt, met de lasten van
// beide. Het model gaat door mergeOpenFem3DNodes en daarna door de rekenweg
// van de app (solveOpenFem3D: verzoekopbouw, POST naar /api/openFem3d/solve,
// de onafhankelijke krachtensom) naar de kern.
//
// Een ligger van 6 m op een statisch bepaalde oplegging (knoop 1 vast in X, Y,
// Z en torsie, knoop 2 in Y en Z). Staaf 1 ligt van knoop 1 naar 2; staaf 2
// ligt er los naast (2 mm opzij, op knopen 3 en 4), in dezelfde richting of
// omgekeerd, met lokale lijnlasten (qy en qz, trapezium, gedeeltelijk), een
// globale lijnlast, een puntlast en een temperatuurgradiënt.
//
//   [1] dezelfde richting en [2] omgekeerde richting, elk:
//       - samengevoegd tegen het model met beide staven op dezelfde knopen
//         (de dubbele staaf zoals hij bedoeld was): statisch bepaald, dus de
//         reacties zijn gelijk, ook al draagt daar een dubbele stijfheid;
//         klopt het teken van een overgezette last niet (qy, py, of de
//         spiegeling), dan wijken de reacties kN's af;
//       - samengevoegd tegen dezelfde ligger met de lasten met de hand
//         overgezet: reacties en verplaatsingen gelijk;
//       - ΣRz is de totale verticale last.
//
// Rekenkern: OPEN_FEM_3D_SOLVER_PATH, anders src-tauri/target/debug/open-fem-3d(.exe).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseOpenFem3DModel } from "./src/components/openFem3d/openFem3dModel.ts";
import { mergeOpenFem3DNodes } from "./src/components/openFem3d/openFem3dSamenvoegen.ts";
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

const OPLEGGINGEN = [
  { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: false, rz: false },
  { nodeId: 2, ux: false, uy: true, uz: true, rx: false, ry: false, rz: false },
];
const PROFIEL = { profileName: "IPE 300", material: "S235" };
/** De lasten op staaf 1 (de staaf die blijft). */
const LAST_A = [{ id: 1, beamId: 1, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -5, qzEnd: -5, startPositionM: 0, endPositionM: 6 }];
/**
 * De lasten op staaf 2, in haar eigen richting (vanaf haar beginknoop). Een
 * trapezium in qy en qz over [1; 4] m, een globale Z-last, een puntlast op
 * 2 m en een temperatuurgradiënt.
 */
const LAST_B = {
  memberLoads: [
    { id: 2, beamId: 2, caseId: 1, qyStart: 1, qyEnd: 3, qzStart: -2, qzEnd: -4, startPositionM: 1, endPositionM: 4 },
    { id: 3, beamId: 2, caseId: 1, globalDirection: "z", qStart: -1, qEnd: -3, startPositionM: 0, endPositionM: 6 },
  ],
  memberPointLoads: [{ id: 1, beamId: 2, caseId: 1, py: 3, pz: -5, positionM: 2 }],
  thermalLoads: [{ id: 1, beamId: 2, caseId: 1, deltaTUniformK: 0, deltaTGradientYK: 4, deltaTGradientZK: 2 }],
};
// Verticaal: 5·6 (staaf 1) + 9 (trapezium qz: (2+4)/2·3) + 12 (globaal: (1+3)/2·6) + 5 (puntlast) = 56 kN.
const TOTAAL_KN = 56;

/** Het model zoals het binnenkwam: staaf 2 los naast staaf 1 (knopen 3 en 4, 2 mm opzij). */
const losModel = (omgekeerd) => parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 0, y: 0.002, z: 0 }, { id: 4, x: 6, y: 0.002, z: 0 }],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, ...PROFIEL },
    { id: 2, startNodeId: omgekeerd ? 4 : 3, endNodeId: omgekeerd ? 3 : 4, ...PROFIEL },
  ],
  supports: OPLEGGINGEN,
  memberLoads: [...LAST_A, ...LAST_B.memberLoads], memberPointLoads: LAST_B.memberPointLoads, thermalLoads: LAST_B.thermalLoads,
});
/** De dubbele staaf zoals hij bedoeld was: beide staven op knopen 1 en 2, staaf 2 in haar eigen richting. */
const dubbelModel = (omgekeerd) => parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, ...PROFIEL },
    { id: 2, startNodeId: omgekeerd ? 2 : 1, endNodeId: omgekeerd ? 1 : 2, ...PROFIEL },
  ],
  supports: OPLEGGINGEN,
  memberLoads: [...LAST_A, ...LAST_B.memberLoads], memberPointLoads: LAST_B.memberPointLoads, thermalLoads: LAST_B.thermalLoads,
});
/**
 * Eén staaf met de lasten van staaf 2 met de hand overgezet. Omgekeerd: e_y
 * van staaf 2 is −e_y van staaf 1 (openFem3DMemberAxes), e_z gelijk: s → 6 − s,
 * begin en eind gewisseld, qy, py en ΔT_y van teken om.
 */
const handModel = (omgekeerd) => parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, ...PROFIEL }],
  supports: OPLEGGINGEN,
  memberLoads: [...LAST_A, ...(omgekeerd
    ? [
        { id: 2, beamId: 1, caseId: 1, qyStart: -3, qyEnd: -1, qzStart: -4, qzEnd: -2, startPositionM: 2, endPositionM: 5 },
        { id: 3, beamId: 1, caseId: 1, globalDirection: "z", qStart: -3, qEnd: -1, startPositionM: 0, endPositionM: 6 },
      ]
    : LAST_B.memberLoads.map((l) => ({ ...l, beamId: 1 })))],
  memberPointLoads: [omgekeerd ? { id: 1, beamId: 1, caseId: 1, py: -3, pz: -5, positionM: 4 } : { ...LAST_B.memberPointLoads[0], beamId: 1 }],
  thermalLoads: [omgekeerd
    ? { id: 1, beamId: 1, caseId: 1, deltaTUniformK: 0, deltaTGradientYK: -4, deltaTGradientZK: 2 }
    : { ...LAST_B.thermalLoads[0], beamId: 1 }],
});

const reactie = (result, nodeId) => result.reactions.find((r) => r.nodeId === nodeId)
  ?? { nodeId, fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 };
const verplaatsing = (result, nodeId) => result.displacements.find((d) => d.nodeId === nodeId);
const COMP_R = ["fx", "fy", "fz", "mx", "my", "mz"];
const COMP_U = ["ux", "uy", "uz", "rx", "ry", "rz"];
const grootsteVerschil = (a, b, functie, comps) => Math.max(...[1, 2].flatMap((id) => comps.map((c) => Math.abs(functie(a, id)[c] - functie(b, id)[c]))));

for (const [nummer, omgekeerd] of [[1, false], [2, true]]) {
  console.log(`\n[${nummer}] dubbele staaf ${omgekeerd ? "in omgekeerde richting" : "in dezelfde richting"}`);
  const samengevoegd = mergeOpenFem3DNodes(losModel(omgekeerd));
  ok(samengevoegd.refused.length === 0 && samengevoegd.mergedBeams.length === 1 && samengevoegd.mergedBeams[0].reversed === omgekeerd
    && samengevoegd.model.beams.length === 1, "staaf 2 is in staaf 1 opgegaan, met haar vier lasten");
  const m = await solveOpenFem3D(samengevoegd.model, 1, "linear");
  const d = await solveOpenFem3D(dubbelModel(omgekeerd), 1, "linear");
  const h = await solveOpenFem3D(handModel(omgekeerd), 1, "linear");
  ok(m.forceBalance?.ok === true && d.forceBalance?.ok === true && h.forceBalance?.ok === true,
    "alle drie in evenwicht (de onafhankelijke krachtensom van de app)");
  const rDubbel = grootsteVerschil(m, d, reactie, COMP_R);
  ok(rDubbel <= 1e-9, `reacties gelijk aan de dubbele staaf op dezelfde knopen (grootste verschil ${rDubbel.toExponential(1)} kN/kNm)`);
  const rHand = grootsteVerschil(m, h, reactie, COMP_R), uHand = grootsteVerschil(m, h, verplaatsing, COMP_U);
  ok(rHand <= 1e-9 && uHand <= 1e-12,
    `reacties en verplaatsingen gelijk aan de lasten met de hand overgezet (${rHand.toExponential(1)} kN, ${uHand.toExponential(1)} m/rad)`);
  const somRz = m.reactions.reduce((s, x) => s + x.fz, 0), somRy = m.reactions.reduce((s, x) => s + x.fy, 0);
  ok(Math.abs(somRz - TOTAAL_KN) <= 1e-9, `ΣRz = ${somRz.toFixed(6)} kN = de totale verticale last ${TOTAAL_KN} kN`);
  // Zijdelings: het trapezium qy 1 → 3 over 3 m (6 kN) en de puntlast py 3 kN,
  // langs e_y van staaf 2: +Y in dezelfde richting, −Y omgekeerd.
  const verwacht = omgekeerd ? 9 : -9;
  ok(Math.abs(somRy - verwacht) <= 1e-9, `ΣRy = ${somRy.toFixed(6)} kN: de reactie tegen de zijdelingse last van 9 kN ${omgekeerd ? "in −Y (e_y van de omgekeerde staaf)" : "in +Y"}`);
}

console.log(`\n${geslaagd} geslaagd, 0 gefaald`);

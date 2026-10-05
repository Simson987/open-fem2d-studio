// Staaf op bedding in 3D (issue #106) van eind tot eind: een 3D-model met een
// funderingsbalk op bedding gaat door de rekenweg van de app
// (solveOpenFem3D en solveOpenFem3DCombination: verzoekopbouw, POST naar
// /api/openFem3d/solve, de onafhankelijke krachtensom) naar de echte 3D-kern,
// en de uitkomst komt terug in de app: gronddruklijn, zakking, momentenlijn,
// vervormde vorm en de rapportregels. Alles wordt vergeleken met de exacte
// oplossing van een vrije balk op bedding met een puntlast in het midden
// (Hetényi), hier opgelost als randwaardeprobleem en zelf eerst getoetst
// tegen de gesloten formules voor het midden en de einden.
//
// Het model: een funderingsbalk van 8 m langs Y (HEB 300, k = 50 000 kN/m³,
// zijdelings 20 000 kN/m³, b = 0,6 m) in twee staven, met in het midden een
// kolom van 3 m (HEA 200) die de last P op de balk zet. Eén knoop van de balk
// houdt alleen X, Y, torsie en de draaiing om Z vast en de kolomkop is
// horizontaal gesteund (een vloer); verticaal draagt alleen de grond,
// zijdelings houdt de grond de kolomvoet op zijn plek. Zonder de steun op de kop knikt de kolom al bij
// 0,12·P: haar voet draait dan om de balkas en alleen de torsie van de balk
// houdt dat tegen (een lijn van grondveren onder de as geeft geen
// torsiestijfheid); zonder zijdelingse bedding schuift de voet weg met de
// zijdelingse buiging van de balk (0,25·P).
//   [1] de analytische oplossing (randwaardeprobleem tegen de gesloten formules);
//   [2] lineair, belastinggeval G (P = 100 kN): zakking, gronddruk, moment,
//       dwarskracht (P/2 naast de kolom, 0 aan de vrije einden), evenwicht,
//       vervormde vorm, rapportregels;
//   [3] combinatie 1,2·G + 1,5·Q (P = 210 kN): dezelfde vergelijking, schaalt lineair;
//   [4] P-Delta met knikfactor: rekent, wijkt nauwelijks af van lineair;
//   [5] alleen druk: de grond laat de einden los; het contact is π/λ lang
//       (exact voor een balk met λL > π), de zakking in het midden
//       Pλ/(2kb)·coth(π/2);
//   [6] het rapport en het tekenvlak met deze echte uitkomst in een lokale
//       headless browser (scripts/open-fem3d-bedding-e2e-browser.tsx):
//       gronddruklijn met de waarde van de kern, de band, de vervormde vorm
//       en de tabel Staven op bedding. Met OPEN_FEM3D_SCHERMAFBEELDINGEN (een
//       bestaande map) worden er schermafbeeldingen van gemaakt.
//
// Rekenkern: OPEN_FEM_3D_SOLVER_PATH, anders src-tauri/target/debug/open-fem-3d(.exe).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { parseOpenFem3DModel } from "./src/components/openFem3d/openFem3dModel.ts";
import { solveOpenFem3D, solveOpenFem3DCombination } from "./src/components/openFem3d/openFem3dSolver.ts";
import {
  openFem3DBeddingLiftedRuns, openFem3DBeddingPressurePoints, openFem3DBeddingResultOf, openFem3DBeddingSettlementAt,
  openFem3DBeddingSummary,
} from "./src/components/openFem3d/openFem3dBedding.ts";
import { openFem3DMemberDisplacementStations } from "./src/components/openFem3d/openFem3dDisplacement.ts";
import { startBrowser } from "./scripts/headlessBrowser.mjs";

let geslaagd = 0;
const ok = (waar, naam) => { assert.ok(waar, naam); geslaagd++; console.log(`  ✓ ${naam}`); };
/** |werkelijk − verwacht| ≤ grens; de grens staat bij elke aanroep verantwoord. */
const binnen = (werkelijk, verwacht, grens, naam) => {
  const verschil = Math.abs(werkelijk - verwacht);
  assert.ok(Number.isFinite(werkelijk) && verschil <= grens,
    `${naam}: berekend ${werkelijk}, verwacht ${verwacht}, verschil ${verschil} > ${grens}`);
  geslaagd++;
  console.log(`  ✓ ${naam} (${fmt(werkelijk)} tegen ${fmt(verwacht)}, ${verwacht !== 0 ? `${(100 * (werkelijk - verwacht) / Math.abs(verwacht)).toFixed(3)} %` : fmt(verschil)})`);
};
const fmt = (x) => Math.abs(x) >= 0.01 || x === 0 ? x.toFixed(4) : x.toExponential(4);

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

// ── Het model ────────────────────────────────────────────────────────────
const L = 8;               // m, lengte van de funderingsbalk
const K = 50_000;          // kN/m³
const B = 0.6;             // m
const KB = K * B;          // kN/m²
const K_LAT = 20_000;      // kN/m³, zijdelings
const PG = 100, PQ = 60;   // kN op de kolomkop, geval 1 (G) en geval 2 (Q)
const model = (bedding = { kKnPerM3: K, widthM: B, kLateralKnPerM3: K_LAT }) => parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: L / 2, z: 0 }, { id: 3, x: 0, y: L, z: 0 }, { id: 4, x: 0, y: L / 2, z: 3 },
  ],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEB 300", material: "S235", bedding },
    { id: 2, startNodeId: 2, endNodeId: 3, profileName: "HEB 300", material: "S235", bedding },
    { id: 3, startNodeId: 2, endNodeId: 4, profileName: "HEA 200", material: "S235" },
  ],
  // X, Y, torsie (om Y) en draaiing om Z vast; verticaal (uz) en de buiging (rx) vrij.
  // De kolomkop alleen horizontaal gesteund: onder verticale last zonder reactie.
  supports: [
    { nodeId: 1, ux: true, uy: true, uz: false, rx: false, ry: true, rz: true },
    { nodeId: 4, ux: true, uy: true, uz: false, rx: false, ry: false, rz: false },
  ],
  loads: [
    { id: 1, nodeId: 4, caseId: 1, fx: 0, fy: 0, fz: -PG, mx: 0, my: 0, mz: 0 },
    { id: 2, nodeId: 4, caseId: 2, fx: 0, fy: 0, fz: -PQ, mx: 0, my: 0, mz: 0 },
  ],
});

// ── [1] De analytische oplossing ─────────────────────────────────────────
/**
 * Vrije balk (lengte L) op bedding kb met een puntlast P in het midden; w
 * positief omlaag, M positief bij trek onderin. Op de halve balk 0 ≤ x ≤ L/2
 * (vrij eind bij x = 0): EI·w'''' + kb·w = 0 met w''(0) = 0 en w'''(0) = 0
 * (M = V = 0), w'(L/2) = 0 (symmetrie) en −EI·w'''(L/2) = P/2 (de grond onder
 * de halve balk draagt P/2). w is een som van e^{±λx}·(c·cos λx + s·sin λx).
 */
function vrijeBalkOpBedding(P, kb, EI, lengte) {
  const lam = (kb / (4 * EI)) ** 0.25;
  const basis = [[1, 1, 0], [1, 0, 1], [-1, 1, 0], [-1, 0, 1]];
  // d/dx e^{aλx}(c cos λx + s sin λx) = λ e^{aλx}((a c + s) cos λx + (a s − c) sin λx)
  const afgeleide = ([a, c, s], n) => {
    for (let i = 0; i < n; i++) [c, s] = [lam * (a * c + s), lam * (a * s - c)];
    return [a, c, s];
  };
  const waarde = ([a, c, s], x) => Math.exp(a * lam * x) * (c * Math.cos(lam * x) + s * Math.sin(lam * x));
  const rij = (n, x) => basis.map((f) => waarde(afgeleide(f, n), x));
  const A = [rij(2, 0), rij(3, 0), rij(1, lengte / 2), rij(3, lengte / 2)];
  const b = [0, 0, 0, -P / (2 * EI)];
  // Gauss met rijwisseling (4 × 4).
  for (let k = 0; k < 4; k++) {
    const p = [k, k + 1, k + 2, k + 3].filter((i) => i < 4).reduce((m, i) => Math.abs(A[i][k]) > Math.abs(A[m][k]) ? i : m, k);
    [A[k], A[p]] = [A[p], A[k]]; [b[k], b[p]] = [b[p], b[k]];
    for (let i = k + 1; i < 4; i++) {
      const f = A[i][k] / A[k][k];
      for (let j = k; j < 4; j++) A[i][j] -= f * A[k][j];
      b[i] -= f * b[k];
    }
  }
  const c = [0, 0, 0, 0];
  for (let i = 3; i >= 0; i--) c[i] = (b[i] - A[i].slice(i + 1).reduce((s, v, j) => s + v * c[i + 1 + j], 0)) / A[i][i];
  // Symmetrisch om het midden: even afgeleiden spiegelen, oneven wisselen van teken.
  const som = (n, x) => {
    const xs = Math.min(x, lengte - x);
    const teken = x > lengte / 2 && n % 2 === 1 ? -1 : 1;
    return teken * rij(n, xs).reduce((s, v, i) => s + v * c[i], 0);
  };
  // V = −EI·w''' (dV/dx = de grondlast k·b·w omhoog, zoals de kern: dV/dx = +q).
  return { lam, w: (x) => som(0, x), M: (x) => -EI * som(2, x), V: (x) => -EI * som(3, x) };
}

// De doorsnede en E zoals de app ze naar de kern stuurt.
const voorbeeld = await solveOpenFem3D(model(), 1, "linear");
const verzoek = verzoeken.at(-1);
const balkLid = verzoek.members.find((m) => m.id === 1);
const doorsnede = verzoek.sections.find((s) => s.id === balkLid.sectionId);
const materiaal = verzoek.materials.find((m) => m.id === balkLid.materialId);
const EI = materiaal.eMpa * 1000 * doorsnede.iyM4; // kNm²; verticale buiging van een liggende staaf zonder rol: I_y
const analytisch = (P) => vrijeBalkOpBedding(P, KB, EI, L);
const { lam } = analytisch(1);

console.log(`[1] de analytische oplossing (EI = ${EI.toFixed(0)} kNm², λ = ${lam.toFixed(4)} 1/m, λL = ${(lam * L).toFixed(3)})`);
{
  ok(doorsnede.iyM4 > doorsnede.izM4, `HEB 300: I_y = ${doorsnede.iyM4.toExponential(4)} m⁴ is de sterke as`);
  const { w, M, V } = analytisch(PG);
  const a = lam * L;
  const noemer = Math.sinh(a) + Math.sin(a);
  // Gesloten formules voor de vrije balk met een puntlast in het midden.
  const wMidden = PG * lam / (2 * KB) * (Math.cosh(a) + Math.cos(a) + 2) / noemer;
  const mMidden = PG / (4 * lam) * (Math.cosh(a) - Math.cos(a)) / noemer;
  const wEind = 2 * PG * lam / KB * Math.cosh(a / 2) * Math.cos(a / 2) / noemer;
  // Het randwaardeprobleem moet ze op afrondfouten na treffen (relatief 1e-10).
  binnen(w(L / 2), wMidden, 1e-10 * wMidden, "randwaardeprobleem: w in het midden = Pλ/(2kb)·(cosh λL + cos λL + 2)/(sinh λL + sin λL)");
  binnen(M(L / 2), mMidden, 1e-10 * mMidden, "randwaardeprobleem: M in het midden = P/(4λ)·(cosh λL − cos λL)/(sinh λL + sin λL)");
  binnen(w(0), wEind, 1e-10 * wMidden, "randwaardeprobleem: w aan het eind = 2Pλ/kb·cosh(λL/2)·cos(λL/2)/(sinh λL + sin λL)");
  binnen(M(0), 0, 1e-10 * mMidden, "M = 0 aan het vrije eind");
  binnen(V(0), 0, 1e-10 * PG, "V = 0 aan het vrije eind");
  binnen(V(L / 2 - 1e-9), PG / 2, 1e-6 * PG, "V = P/2 net voor de last");
  binnen(V(L / 2 + 1e-9), -PG / 2, 1e-6 * PG, "V = −P/2 net na de last");
  // Evenwicht van de analytische oplossing: ∫ kb·w dx = P (trapezium op 4000 delen).
  const n = 4000;
  let integraal = 0;
  for (let i = 0; i <= n; i++) integraal += (i === 0 || i === n ? 0.5 : 1) * KB * w(i * L / n) * L / n;
  binnen(integraal, PG, 1e-6 * PG, "∫ kb·w dx = P");
  ok(w(0) < 0, `bij λL = ${a.toFixed(2)} trekt de grond aan de einden (w(0) = ${(w(0) * 1000).toFixed(4)} mm, omhoog)`);
}

/** De punten van de kern als (x langs de hele balk, punt): staaf 1 van y = 0 tot L/2, staaf 2 van L/2 tot L. */
const langsDeBalk = (result) => [1, 2].flatMap((id) => openFem3DBeddingResultOf(result, id).points
  .map((p) => ({ x: (id === 1 ? 0 : L / 2) + p.t * L / 2, p, id })));

/**
 * Vergelijk een lineaire uitkomst met de analytische oplossing voor P. De
 * grenzen: de kern zet de grond als losse veren k·b·L_trib op knopen met een
 * deellengte h ≤ 0,15/λ. Voor een puntlast op een knoop is de fout in w en M
 * van orde (λh)²/12 ≈ 0,2 %; zie bedding.rs en tests/bedding.rs (gemeten
 * 0,0004 % in w0 en 0,37 % in M0 voor de oneindige balk). Grens: 1 % van de
 * grootste waarde voor w en p, 1,5 % voor M (zoals de kerntests).
 */
function vergelijk(result, P, label) {
  const { w, M, V } = analytisch(P);
  const wMax = w(L / 2), mMax = M(L / 2);
  const punten = langsDeBalk(result);
  const delen = openFem3DBeddingResultOf(result, 1).points.length - 1;
  const h = L / 2 / delen;
  // De fijnste richting telt: zijdelings buigt de balk om de zwakke as (I_z) met k_lat·b.
  const lamZij = (K_LAT * B / (4 * materiaal.eMpa * 1000 * doorsnede.izM4)) ** 0.25;
  ok(delen === Math.ceil(L / 2 * Math.max(lam, lamZij) / 0.15) && h <= 0.15 / lam,
    `${label}: de kern knipt elke staaf in ${delen} = ⌈(L/2)·max(λ, λ_zij)/0,15⌉ delen (λ_zij = ${lamZij.toFixed(4)} 1/m), h = ${h.toFixed(4)} m`);
  ok(punten.every(({ p }) => Math.abs(p.lateralKnPerM) < 1e-9 * P), `${label}: geen zijdelingse gronddruk zonder zijdelingse last`);
  const fouten = punten.map(({ x, p }) => Math.abs(p.settlementM - w(x)));
  binnen(Math.max(...fouten), 0, 0.01 * wMax, `${label}: zakking op alle ${punten.length} punten = w(x), grootste afwijking ≤ 1 % van w_midden`);
  binnen(openFem3DBeddingResultOf(result, 1).points.at(-1).settlementM, wMax, 0.01 * wMax, `${label}: zakking onder de kolom`);
  binnen(openFem3DBeddingResultOf(result, 1).points[0].settlementM, w(0), 0.01 * wMax, `${label}: zakking aan het vrije eind (negatief: omhoog)`);
  ok(punten.every(({ p }) => Math.abs(p.pressureKnPerM - KB * p.settlementM) <= 1e-9 * KB * wMax && p.active),
    `${label}: gronddruk = k·b·zakking op elk punt, overal actief (geen alleen druk)`);
  // Gronddruklijn in de app (laag Gronddruk): dezelfde getallen als de kern.
  const lijn = openFem3DBeddingPressurePoints(result, 1);
  ok(lijn.length === openFem3DBeddingResultOf(result, 1).points.length
    && lijn.every((q, i) => q.value === openFem3DBeddingResultOf(result, 1).points[i].pressureKnPerM), `${label}: de gronddruklijn van de app volgt de kern`);
  binnen(Math.max(...lijn.map((q) => q.value)), KB * wMax, 0.01 * KB * wMax, `${label}: grootste gronddruk = k·b·w_midden (kN/m)`);
  // Moment: de samengevoegde momentenlijn van de kern (My, trek onderin positief) op de punten van de staaf.
  const momentLijnen = [1, 2].flatMap((id) => result.diagrams.momentY.find((d) => d.memberId === id).points
    .map((q) => ({ x: (id === 1 ? 0 : L / 2) + q.t * L / 2, waarde: q.value })));
  const mFout = Math.max(...momentLijnen.map(({ x, waarde }) => Math.abs(waarde - M(x))));
  binnen(mFout, 0, 0.015 * mMax, `${label}: momentenlijn My = M(x) op ${momentLijnen.length} punten, grootste afwijking ≤ 1,5 % van M_midden`);
  const krachten = result.memberForces.find((f) => f.memberId === 1);
  binnen(krachten.myEndKnm, mMax, 0.015 * mMax, `${label}: moment onder de kolom (staafeinde)`);
  // Dwarskracht: de grond onder de halve balk draagt precies P/2 (symmetrie), het vrije eind niets.
  // Dat is exact voor de losse veren zodra elke veer als grond over haar eigen lengte telt (zie bedding.rs, correctie).
  binnen(krachten.vzEndKn, P / 2, 1e-9 * P, `${label}: dwarskracht naast de kolom Vz = P/2`);
  binnen(krachten.vzStartKn, 0, 1e-9 * P, `${label}: dwarskracht aan het vrije eind = 0`);
  binnen(result.memberForces.find((f) => f.memberId === 2).vzStartKn, -P / 2, 1e-9 * P, `${label}: dwarskracht aan de andere kant van de kolom = −P/2`);
  // De dwarskrachtlijn tussen de knopen: lineair tussen de waarden van de kern midden in elk deel,
  // fout van orde (λh)²/8 maal de helling: grens 1,5 % van P/2 (zoals het moment).
  const dwarsLijnen = [1, 2].flatMap((id) => result.diagrams.shearZ.find((d) => d.memberId === id).points
    .map((q) => ({ x: (id === 1 ? 0 : L / 2) + q.t * L / 2, waarde: q.value, id })));
  const vFout = Math.max(...dwarsLijnen.map(({ x, waarde, id }) => Math.abs(waarde - (Math.abs(x - L / 2) < 1e-9 ? (id === 1 ? P / 2 : -P / 2) : V(x)))));
  binnen(vFout, 0, 0.015 * P / 2, `${label}: dwarskrachtlijn Vz = V(x) op ${dwarsLijnen.length} punten, grootste afwijking ≤ 1,5 % van P/2`);
  // Evenwicht: de grond draagt alles; de knoopoplegging (uz vrij) niets verticaal.
  const totaal = result.bedding.reduce((s, b) => s + b.totalReactionKn, 0);
  binnen(totaal, P, 1e-6 * P, `${label}: Σ veerkrachten = P`);
  ok(result.reactions.every((r) => Math.hypot(r.fx, r.fy, r.fz) < 1e-6 * P) && result.reactions.every((r) => [1, 2, 3, 4].includes(r.nodeId)),
    `${label}: oplegreacties alleen van modelknopen, zonder kracht (de grond draagt alles)`);
  ok(result.displacements.map((d) => d.nodeId).sort().join() === "1,2,3,4", `${label}: verplaatsingen alleen van de modelknopen (geen rekenknopen van de kern)`);
  ok(result.forceBalance?.ok === true, `${label}: onafhankelijke kracht- en momentensom van de app sluit met de grondveren (${result.forceBalance?.maxImbalanceKn.toExponential(2)} kN, ${result.forceBalance?.maxMomentImbalanceKnm.toExponential(2)} kNm)`);
  ok(result.equilibrium?.equilibriumOk === true, `${label}: evenwicht volgens de kern`);
  // Vervormde vorm: uz langs de staaf volgt de zakking; de einden zijn de knoopverplaatsingen.
  const m = model();
  for (const id of [1, 2]) {
    const stations = openFem3DMemberDisplacementStations(m, m.beams.find((b) => b.id === id), result, 16);
    const bedding = openFem3DBeddingResultOf(result, id);
    ok(stations.every((s) => Math.abs(s.uz + openFem3DBeddingSettlementAt(bedding, s.t)) < 1e-15), `${label}: vervormde vorm staaf ${id}, uz = −zakking op 17 punten`);
    const vormFout = Math.max(...stations.map((s) => Math.abs(-s.uz - w((id === 1 ? 0 : L / 2) + s.t * L / 2))));
    // Lineair tussen de punten van de kern: extra fout ≤ h²/8·|w''| ≤ h²/8·M_max/EI.
    binnen(vormFout, 0, 0.01 * wMax + h * h / 8 * mMax / EI, `${label}: vervormde vorm staaf ${id} = w(x) (1 % + interpolatie h²/8·M/EI)`);
  }
  const knoop = (id) => result.displacements.find((d) => d.nodeId === id);
  binnen(-knoop(2).uz, openFem3DBeddingResultOf(result, 1).points.at(-1).settlementM, 1e-15, `${label}: knoop 2 zakt evenveel als de grond eronder`);
  return { wMax, mMax, w };
}

console.log("\n[2] lineair, belastinggeval G (P = 100 kN)");
const lineair = voorbeeld;
{
  ok(verzoek.analysis === "linear" && verzoek.bucklingModes === 0, "het verzoek van de app: lineair, zonder knik");
  ok(JSON.stringify(balkLid.bedding) === JSON.stringify({ kKnPerM3: K, widthM: B, kLateralKnPerM3: K_LAT }) && !("bedding" in verzoek.members.find((m) => m.id === 3)),
    "Member3D.bedding volgens het contract, alleen op de funderingsbalk");
  ok(verzoek.nodalLoads.length === 1 && verzoek.nodalLoads[0].fz === -PG, "alleen de last van geval G");
  const { wMax } = vergelijk(lineair, PG, "G");
  // Rapport: de regels die de tabel Staven op bedding toont.
  const rijen = openFem3DBeddingSummary(model(), lineair);
  ok(rijen.length === 2 && rijen.every((r) => r.kKnPerM3 === K && r.widthMm === 600 && r.kLateralKnPerM3 === K_LAT && !r.compressionOnly),
    "rapport: twee staven op bedding met k, b (mm) en zijdelingse k");
  for (const r of rijen) {
    binnen(r.result.maxSettlementMm, wMax * 1000, 0.01 * wMax * 1000, `rapport staaf ${r.beamId}: grootste zakking (mm)`);
    binnen(r.result.maxPressureKnPerM2, K * wMax, 0.01 * K * wMax, `rapport staaf ${r.beamId}: grootste gronddruk p/b = k·w (kN/m²)`);
    binnen(r.result.totalReactionKn, PG / 2, 1e-6 * PG, `rapport staaf ${r.beamId}: Σ R = P/2`);
    ok(r.result.liftedPercent === 0, `rapport staaf ${r.beamId}: overal contact`);
  }
}

console.log("\n[3] combinatie 1,2·G + 1,5·Q (P = 210 kN)");
const PC = 1.2 * PG + 1.5 * PQ;
const combinatie = await solveOpenFem3DCombination(model(), new Map([[1, 1.2], [2, 1.5]]), "linear");
{
  ok(verzoeken.at(-1).nodalLoads.reduce((s, l) => s + l.fz, 0) === -PC, "het verzoek: beide lasten met hun factor");
  vergelijk(combinatie, PC, "1,2G+1,5Q");
  const g = langsDeBalk(lineair), c = langsDeBalk(combinatie);
  ok(c.every(({ p }, i) => Math.abs(p.settlementM - g[i].p.settlementM * PC / PG) <= 1e-9 * Math.abs(PC / PG * g[0].p.settlementM) + 1e-12),
    "lineair: de zakking schaalt precies met P");
}

console.log("\n[4] P-Delta met knikfactor");
const pDelta = await solveOpenFem3D(model(), 1, "p-delta");
{
  ok(verzoeken.at(-1).analysis === "p-delta" && verzoeken.at(-1).bucklingModes > 0, "het verzoek: P-Delta met knikvormen");
  ok(pDelta.analysis === "p-delta", "de kern rekende P-Delta");
  const wL = openFem3DBeddingResultOf(lineair, 1).points.at(-1).settlementM;
  const wP = openFem3DBeddingResultOf(pDelta, 1).points.at(-1).settlementM;
  // De balk heeft geen normaalkracht en de kolom 100 kN bij een Euler-last van duizenden kN: verschil ≪ 0,1 %.
  binnen(wP, wL, 1e-3 * wL, "zakking onder de kolom: P-Delta ≈ lineair (grens 0,1 %)");
  ok(pDelta.forceBalance?.ok === true, "P-Delta: de onafhankelijke krachtensom sluit");
  // De eerste knikvorm is die van de kolom (kop horizontaal gesteund, voet verend ingeklemd door de balk op
  // bedding), om haar zwakke as. De knikanalyse rekent de kolom als één element (kubische vorm): dat geeft
  // een bovengrens van de exacte waarde voor dezelfde randen. Dus tussen de exacte scharnierend-scharnierende
  // π²EI_z/h² en de één-elementwaarde voor ingeklemd-scharnierend 30·EI_z/h² (meer inklemming dan volledig
  // kan de balk niet geven). De knik van een staaf op bedding zelf: tests/bedding.rs (Hetényi).
  const kolom = verzoeken.at(-1).sections.find((s) => s.id === verzoeken.at(-1).members.find((m) => m.id === 3).sectionId);
  const eiZwak = materiaal.eMpa * 1000 * Math.min(kolom.iyM4, kolom.izM4);
  const onder = Math.PI ** 2 * eiZwak / 3 ** 2 / PG, boven = 30 * eiZwak / 3 ** 2 / PG;
  const eerste = pDelta.buckling.status === "available" ? pDelta.buckling.modes[0]?.loadFactor : undefined;
  ok(eerste !== undefined && eerste >= onder && eerste <= boven,
    `P-Delta: eerste knikfactor ${eerste?.toFixed(2)} tussen π²EI_z/(h²P) = ${onder.toFixed(2)} en 30·EI_z/(h²P) = ${boven.toFixed(2)}`);
}

console.log("\n[5] alleen druk: de einden komen los");
const losModel = model({ kKnPerM3: K, widthM: B, kLateralKnPerM3: K_LAT, compressionOnly: true });
const alleenDruk = await solveOpenFem3D(losModel, 1, "linear");
{
  ok(JSON.stringify(verzoeken.at(-1).members.find((m) => m.id === 1).bedding) === JSON.stringify({ kKnPerM3: K, widthM: B, kLateralKnPerM3: K_LAT, compressionOnly: true }),
    "het verzoek: compressionOnly mee");
  const punten = langsDeBalk(alleenDruk);
  ok(punten.every(({ p }) => p.pressureKnPerM >= 0), "nergens trek in de grond (gronddruk ≥ 0)");
  ok(punten.every(({ p }) => p.active || (p.pressureKnPerM === 0 && p.settlementM < 0)), "losse punten: geen druk, en de balk is daar omhoog gekomen");
  // Exact: zonder trek in de grond is het contact een vrije balk op bedding met
  // w = 0 aan zijn einden; voor een balk met λL > π geeft cosh(λa)·cos(λa) = 0
  // de halve contactlengte a = π/(2λ). Het losse deel draagt niets en blijft recht.
  const los = 1 - Math.PI / (lam * L);
  const h = L / 2 / (openFem3DBeddingResultOf(alleenDruk, 1).points.length - 1);
  for (const id of [1, 2]) {
    const lid = openFem3DBeddingResultOf(alleenDruk, id);
    // De grens tussen contact en los ligt halverwege twee knopen van de kern: ± h/2 op L/2.
    binnen(lid.liftedFraction, los, h / L + 1e-9, `staaf ${id}: deel zonder contact = 1 − π/(λL) (grens h/L)`);
  }
  const runs1 = openFem3DBeddingLiftedRuns(openFem3DBeddingResultOf(alleenDruk, 1));
  const runs2 = openFem3DBeddingLiftedRuns(openFem3DBeddingResultOf(alleenDruk, 2));
  ok(runs1.length === 1 && runs1[0][0] === 0 && runs2.length === 1 && runs2[0][1] === 1,
    `de app tekent één stuk zonder contact aan elk vrij eind (${JSON.stringify(runs1)}, ${JSON.stringify(runs2)})`);
  // Zakking in het midden: Pλ/(2kb)·(cosh π + cos π + 2)/(sinh π + sin π) = Pλ/(2kb)·coth(π/2).
  const wMidden = PG * lam / (2 * KB) / Math.tanh(Math.PI / 2);
  // De contactgrens valt tussen twee knopen (± h/2 op a = π/(2λ)); dw/da maal h/2 geeft orde λh/2 ≈ 7 % in a,
  // maar w_midden is stationair rond de exacte a (de randvoorwaarde w = 0 kiest haar): grens 1 %.
  binnen(openFem3DBeddingResultOf(alleenDruk, 1).points.at(-1).settlementM, wMidden, 0.01 * wMidden, "zakking onder de kolom = Pλ/(2kb)·coth(π/2)");
  binnen(alleenDruk.bedding.reduce((s, b) => s + b.totalReactionKn, 0), PG, 1e-6 * PG, "Σ veerkrachten = P");
  ok(alleenDruk.forceBalance?.ok === true, "de onafhankelijke krachtensom sluit met alleen de actieve veren");
  const rij = openFem3DBeddingSummary(losModel, alleenDruk)[0];
  binnen(rij.result.liftedPercent, 100 * los, 100 * (h / L + 1e-9), "rapport: deel zonder contact in %");
  ok(rij.result.minPressureKnPerM === 0 && rij.compressionOnly, "rapport: alleen druk, kleinste gronddruk 0");
  ok(alleenDruk.diagnostics.some((d) => /alleen druk: los van de grond/.test(d)), "de kern meldt waar de grond loslaat");
}

globalThis.fetch = vorigeFetch;

console.log("\n[6] rapport en tekenvlak met de echte uitkomst (browser)");
{
  const browser = [process.env.OPENAEC_BROWSER,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
  ].filter(Boolean).find(existsSync);
  assert.ok(browser, "Chromium-browser vereist; stel eventueel OPENAEC_BROWSER in");
  const map = mkdtempSync(join(tmpdir(), "open-fem3d-bedding-e2e-"));
  try {
    const bundel = await build({
      absWorkingDir: dirname(fileURLToPath(import.meta.url)),
      entryPoints: ["scripts/open-fem3d-bedding-e2e-browser.tsx"], bundle: true, write: false,
      outfile: join(map, "test.js"), format: "iife", platform: "browser", jsx: "automatic",
      external: ["fs", "path"],
      loader: { ".ifcfem": "text", ".svg": "dataurl", ".png": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
      define: { "process.env.NODE_ENV": '"production"' },
    });
    for (const bestand of bundel.outputFiles) writeFileSync(bestand.path, bestand.contents);
    // De echte uitkomsten van hierboven gaan als gegevens mee de pagina in.
    const gegevens = {
      model: model(), result: lineair, losModel, los: alleenDruk,
      verwacht: { pMax: Math.max(...langsDeBalk(lineair).map(({ p }) => p.pressureKnPerM)), wMaxMm: analytisch(PG).w(L / 2) * 1000 },
    };
    writeFileSync(join(map, "gegevens.js"), `window.__BEDDING_E2E__ = ${JSON.stringify(gegevens)};`);
    const html = join(map, "test.html");
    writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="test.css"></head><body style="margin:0;background:#fff"><div id="root"></div>' +
      '<pre id="uitslag"></pre><script src="gegevens.js"></script><script src="test.js"></script></body></html>');
    const vlaggen = (profiel, venster) => ["--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader", "--no-first-run",
      "--no-default-browser-check", `--user-data-dir=${join(map, profiel)}`, `--window-size=${venster}`];
    const uitslag = startBrowser(browser, [...vlaggen("profiel", "1100,800"), "--virtual-time-budget=60000", "--dump-dom", pathToFileURL(html).href],
      { encoding: "utf8", timeout: 90_000, maxBuffer: 32 * 1024 * 1024 });
    const gevonden = /<pre id="uitslag">([^<]*)<\/pre>/.exec(uitslag.stdout ?? "");
    assert.ok(gevonden?.[1], uitslag.error?.message ?? uitslag.stderr?.slice(0, 1500) ?? "Geen browserresultaat");
    const verslag = JSON.parse(gevonden[1].replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
    for (const proef of verslag.tests) {
      assert.ok(!proef.error, `${proef.name}: ${proef.error}`);
      geslaagd++;
      console.log(`  ✓ ${proef.name}`);
    }
    assert.equal(verslag.error, null, verslag.error);
    assert.ok(verslag.tests.length >= 5, `te weinig browserproeven: ${verslag.tests.length}`);

    const schermMap = process.env.OPEN_FEM3D_SCHERMAFBEELDINGEN;
    if (schermMap) {
      assert.ok(existsSync(schermMap), `map voor schermafbeeldingen bestaat niet: ${schermMap}`);
      for (const [bestand, beeld, venster] of [
        ["bedding-e2e-gronddruk.png", "gronddruk", "1200,700"],
        ["bedding-e2e-alleen-druk.png", "alleen-druk", "1200,700"],
        ["bedding-e2e-band.png", "band", "1200,700"],
        ["bedding-e2e-rapport.png", "rapport", "1200,900"],
      ]) {
        const pad = join(schermMap, bestand);
        startBrowser(browser, [...vlaggen(`profiel-${beeld}`, venster), "--hide-scrollbars", "--virtual-time-budget=10000",
          `--screenshot=${pad}`, `${pathToFileURL(html).href}#beeld=${beeld}`], { encoding: "utf8", timeout: 90_000 });
        assert.ok(existsSync(pad), `schermafbeelding niet gemaakt: ${pad}`);
        console.log(`  schermafbeelding: ${pad}`);
      }
    }
    console.log(`  (${basename(browser)})`);
  } finally {
    rmSync(map, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

console.log(`\n${geslaagd} geslaagd, 0 gefaald`);

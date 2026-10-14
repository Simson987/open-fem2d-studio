// Plaat op bedding in 3D (issue #107) van eind tot eind, vergeleken met de
// analytische waarden: een begane-grondvloer van 10 × 6 m op zand met een
// vloerlast en twee kolomlasten, door de rekenweg van de app
// (solveOpenFem3D: rekennet, buildOpenFem3DSolveRequest, POST naar
// /api/openFem3d/solve, de onafhankelijke krachtensom) naar de echte 3D-kern.
//
// De vloer: C30/37 (E = 33 000 N/mm², ν = 0,2), 200 mm dik, net van 250 mm,
// k = 30 000 kN/m³, alleen druk, geen opleggingen. Belastinggeval 1: een
// vloerlast q = 5 kN/m²; geval 2: kolomlasten P₁ = 150 kN op (3; 3) en
// P₂ = 250 kN op (7; 3). Plaatstijfheid D = E·t³/(12(1 − ν²)) = 22 917 kNm,
// karakteristieke lengte ℓ = (D/k)^¼ = 0,935 m.
//   [1] alleen de vloerlast: elke knoop zakt q/k, de gronddruk is overal q,
//       geen buiging, Σ veerkrachten = q·A (afrondingsruis, 10⁻⁹);
//   [2] vloerlast plus kolommen: het verzoek volgt het contract; evenwicht
//       Σ veerkrachten = q·A + P₁ + P₂ en de resultante van de gronddruk ligt
//       in het zwaartepunt van de belasting (beide exact, 10⁻⁹); onder de
//       kolommen de zakking volgens Westergaard (oneindige dunne plaat op
//       Winkler, puntlast w₀ = P/(8√(kD))) met de invloed van de andere kolom
//       volgens Hertz (w(r) = −P·ℓ²/(2πD)·kei(r/ℓ)), en de grootste gronddruk
//       k·w onder de zwaarste kolom. De afwijking is ontleed met een dunne
//       plaat met dezelfde D (t/4, E·64: geen afschuifvervorming meer). Het
//       deel zonder contact (liftedFraction) is exact Σ A_trib zonder contact /
//       Σ A_trib, het aandeel van het oppervlak en niet van de knopen;
//   [3] dezelfde vloer met een wand van 3 m op de lange rand y = 6 m (de wand
//       zonder bedding), nog steeds zonder opleggingen: de kern houdt het deel
//       in het vlak vast en rekent (zie plaatbedding.rs: de kunstmatige
//       draaistijfheid van de plaatelementen mag daar geen fout geven);
//   [4] het tekenvlak (contour Gronddruk met de stippen zonder contact,
//       arcering), de keuzelijst en het rapport met deze uitkomst in een lokale
//       headless browser (scripts/open-fem3d-plaatbedding-e2e-browser.tsx).
//       Met OPEN_FEM3D_SCHERMAFBEELDINGEN (een bestaande map) worden er
//       schermafbeeldingen van gemaakt.
//
// Rekenkern: OPEN_FEM_3D_SOLVER_PATH, anders src-tauri/target/debug/open-fem-3d(.exe).
// Kent de kern `plates[].bedding` niet (een oude bouw), dan faalt de proef
// met die melding.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { parseOpenFem3DModel } from "./src/components/openFem3d/openFem3dModel.ts";
import { solveOpenFem3D, solveOpenFem3DCombination } from "./src/components/openFem3d/openFem3dSolver.ts";
import {
  openFem3DPlateBeddingResultOf, openFem3DPlateBeddingSummary, openFem3DPlateBeddingTributaryAreas,
} from "./src/components/openFem3d/openFem3dPlateBedding.ts";
import { startBrowser } from "./scripts/headlessBrowser.mjs";

const stil = console.log;
// TriangleService logt elke aanroep; houd de testuitvoer leesbaar.
console.log = (...args) => { if (!String(args[0] ?? "").startsWith("[TriangleService]")) stil(...args); };
let geslaagd = 0;
const ok = (waar, naam) => { assert.ok(waar, naam); geslaagd++; stil(`  ✓ ${naam}`); };

const solverBinary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${solverBinary}`, import.meta.url));
assert.ok(existsSync(solverPath), `Bouw eerst de Rust-rekenkern (${solverPath}) of zet OPEN_FEM_3D_SOLVER_PATH.`);
/** Het laatste verzoek dat de app naar de kern stuurde (de uitvoer van buildOpenFem3DSolveRequest). */
let laatsteVerzoek = null;
/** De rekenweg van de app in de browser: POST /api/openFem3d/solve, hier naar de echte kern (zoals vite.config.ts). */
globalThis.fetch = (url, options) => new Promise((resolve, reject) => {
  assert.equal(url, "/api/openFem3d/solve");
  laatsteVerzoek = JSON.parse(options.body);
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
/** Een verzoek rechtstreeks naar de kern (voor de ontleding met een dunne plaat). */
function kern(verzoek) {
  const uit = spawnSync(solverPath, [], { input: JSON.stringify(verzoek), maxBuffer: 1 << 30 });
  const tekst = uit.stdout.toString();
  assert.equal(uit.status, 0, tekst.slice(0, 600));
  return JSON.parse(tekst);
}

/** kei(x), Kelvin-functie, uit haar machtreeks (Abramowitz & Stegun 9.9.12); kei(1) = −0,4949946. */
function kei(x) {
  const h = (x / 2) ** 2;
  let ber = 0, bei = 0, rest = 0, fac = 1, psi = -0.5772156649015329;
  for (let k = 0; k < 40; k += 1) {
    if (k > 0) fac *= (2 * k - 1) * (2 * k);
    const fac1 = fac * (2 * k + 1);
    psi += 1 / (2 * k + 1) + (k > 0 ? 1 / (2 * k) : 0);
    const term1 = (-1) ** k * h ** (2 * k + 1) / (fac1 * fac1);
    ber += (-1) ** k * h ** (2 * k) / (fac * fac);
    bei += term1;
    rest += psi * term1;
  }
  return (x === 0 ? 0 : -Math.log(x / 2) * bei) - Math.PI / 4 * ber + rest;
}
assert.ok(Math.abs(kei(1) + 0.4949946) < 1e-7 && Math.abs(kei(2) + 0.2024001) < 1e-7 && Math.abs(kei(0) + Math.PI / 4) < 1e-15,
  "kei klopt met de tabel");

const LX = 10, LY = 6, T = 0.2, H = 0.25, K = 30_000, Q = 5;
const KOLOMMEN = [{ id: 5, x: 3, y: 3, P: 150 }, { id: 6, x: 7, y: 3, P: 250 }];
const E = 33_000e3, NU = 0.2;
const D = E * T ** 3 / (12 * (1 - NU * NU));
const L = (D / K) ** 0.25;
const A = LX * LY;
/** Zakking van een oneindige dunne plaat op Winkler op afstand r van een puntlast P (Hertz; r = 0: Westergaard). */
const hertz = (P, r) => -P * L * L / (2 * Math.PI * D) * kei(r / L);
stil(`  (D = ${D.toFixed(1)} kNm, ℓ = ${L.toFixed(4)} m, t/ℓ = ${(T / L).toFixed(3)}, h/ℓ = ${(H / L).toFixed(3)})`);

const knopen = [
  { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: LX, y: 0, z: 0 }, { id: 3, x: LX, y: LY, z: 0 }, { id: 4, x: 0, y: LY, z: 0 },
  ...KOLOMMEN.map(({ id, x, y }) => ({ id, x, y, z: 0 })),
];
const vloer = (wand = false) => parseOpenFem3DModel({
  nodes: [...knopen, ...(wand ? [{ id: 7, x: LX, y: LY, z: 3 }, { id: 8, x: 0, y: LY, z: 3 }] : [])],
  beams: [],
  plates: [
    { id: 1, nodeIds: [1, 2, 3, 4], thicknessM: T, material: "C30/37", meshSizeM: H, bedding: { kKnPerM3: K, compressionOnly: true } },
    ...(wand ? [{ id: 2, nodeIds: [4, 3, 7, 8], thicknessM: 0.2, material: "C30/37", meshSizeM: 0.5 }] : []),
  ],
  loads: KOLOMMEN.map(({ id, P }, index) => ({ id: index + 1, nodeId: id, caseId: 2, fx: 0, fy: 0, fz: -P, mx: 0, my: 0, mz: 0 })),
  surfaceLoads: [{ id: 1, plateId: 1, caseId: 1, qx: 0, qy: 0, qz: -Q }],
});
const model = vloer();

console.log("[1] alleen de vloerlast: overal q/k, door de rekenweg van de app");
let alleenQ;
try {
  alleenQ = await solveOpenFem3D(model, 1, "linear");
} catch (fout) {
  const tekst = fout instanceof Error ? fout.message : String(fout);
  assert.ok(!/unknown field `bedding`/.test(tekst),
    `de 3D-kern op ${solverPath} kent plates[].bedding niet: een oude bouw; bouw open-fem-3d opnieuw (${tekst.slice(0, 120)})`);
  throw fout;
}
{
  const b = openFem3DPlateBeddingResultOf(alleenQ, 1);
  const zakking = Math.max(...b.nodes.map((n) => Math.abs(n.settlementM - Q / K)));
  ok(b.nodes.length > 900 && zakking <= 1e-9 * Q / K,
    `${b.nodes.length} knopen zakken q/k = ${(Q / K * 1000).toFixed(4)} mm (grootste afwijking ${zakking.toExponential(1)} m)`);
  ok(b.nodes.every((n) => n.active && Math.abs(n.pressureKnPerM2 - Q) <= 1e-9 * Q), "de gronddruk is overal q = 5 kN/m², overal contact");
  ok(Math.abs(b.totalReactionKn - Q * A) <= 1e-9 * Q * A, `Σ veerkrachten = q·A = ${Q * A} kN (${b.totalReactionKn.toFixed(9)})`);
  const m = Math.max(...alleenQ.shellNodes.map((n) => Math.max(Math.abs(n.mxxKnmPerM), Math.abs(n.myyKnmPerM), Math.abs(n.mxyKnmPerM))));
  ok(m < 1e-9 * Q * L * L, `geen buiging: grootste plaatmoment ${m.toExponential(1)} kNm/m`);
  ok(alleenQ.reactions.length === 0, "geen opleggingen, dus geen oplegreacties");
}

console.log("\n[2] vloerlast plus kolomlasten, vergeleken met Westergaard en Hertz");
const result = await solveOpenFem3DCombination(model, new Map([[1, 1], [2, 1]]), "linear");
const verzoek = laatsteVerzoek;
const b = openFem3DPlateBeddingResultOf(result, 1);
const P = KOLOMMEN.reduce((som, k) => som + k.P, 0);
{
  ok(JSON.stringify(verzoek.plates[0].bedding) === JSON.stringify({ kKnPerM3: K, compressionOnly: true }),
    `het verzoek: plates[0].bedding = ${JSON.stringify(verzoek.plates[0].bedding)}`);
  ok(verzoek.supports.length === 0 && verzoek.nodalLoads.length === 2 && verzoek.surfaceLoads.length === 1,
    "geen opleggingen, twee kolomlasten en de vloerlast in het verzoek");
  ok(Math.abs(b.totalReactionKn - (Q * A + P)) <= 1e-9 * (Q * A + P),
    `Σ veerkrachten = q·A + P₁ + P₂ = ${Q * A + P} kN (${b.totalReactionKn.toFixed(9)})`);
  // De resultante van de gronddruk p·A_trib ligt in het zwaartepunt van de belasting.
  const plek = new Map(result.plateMesh.nodes.map((n) => [n.id, [n.x, n.y, n.z]]));
  for (const n of model.nodes) plek.set(n.id, [n.x, n.y, n.z]);
  const opp = openFem3DPlateBeddingTributaryAreas(result.plateMesh.elements.filter((e) => e.plateId === 1), (id) => plek.get(id));
  let som = 0, sx = 0, sy = 0;
  for (const n of b.nodes) {
    const kracht = n.pressureKnPerM2 * opp.get(n.nodeId);
    som += kracht; sx += kracht * plek.get(n.nodeId)[0]; sy += kracht * plek.get(n.nodeId)[1];
  }
  const xLast = (Q * A * LX / 2 + KOLOMMEN.reduce((s, k) => s + k.P * k.x, 0)) / (Q * A + P);
  const yLast = (Q * A * LY / 2 + KOLOMMEN.reduce((s, k) => s + k.P * k.y, 0)) / (Q * A + P);
  ok(Math.abs(sx / som - xLast) < 1e-9 * LX && Math.abs(sy / som - yLast) < 1e-9 * LX,
    `de resultante van de gronddruk ligt in (${(sx / som).toFixed(6)}; ${(sy / som).toFixed(6)}) m = het zwaartepunt van de belasting (${xLast.toFixed(6)}; ${yLast.toFixed(6)})`);
  ok(result.forceBalance?.ok === true,
    `de onafhankelijke kracht- en momentensom van de app sluit (${result.forceBalance?.maxImbalanceKn.toExponential(1)} kN, ${result.forceBalance?.maxMomentImbalanceKnm.toExponential(1)} kNm)`);
  ok(b.minPressureKnPerM2 >= 0 && b.nodes.every((n) => n.pressureKnPerM2 >= 0), "alleen druk: nergens trek in de grond");

  // Westergaard + Hertz, en de dunne plaat met dezelfde D (t/4, E·64) rechtstreeks naar de kern.
  const dun = structuredClone(verzoek);
  dun.plates[0].thicknessM = T / 4;
  dun.materials.find((m) => m.id === dun.plates[0].materialId).eMpa *= 64;
  const bDun = kern(dun).plateBedding[0];
  const zak = (bron, id) => bron.nodes.find((n) => n.nodeId === id).settlementM;
  for (const [i, kolom] of KOLOMMEN.entries()) {
    const ander = KOLOMMEN[1 - i];
    const w = Q / K + hertz(kolom.P, 0) + hertz(ander.P, Math.hypot(kolom.x - ander.x, kolom.y - ander.y));
    const fe = zak(b, kolom.id), feDun = zak(bDun, kolom.id);
    const afw = fe / w - 1, afwDun = feDun / w - 1;
    stil(`  kolom ${i + 1} (${kolom.P} kN op (${kolom.x}; ${kolom.y})): q/k + Westergaard + Hertz = ${(w * 1000).toFixed(4)} mm;` +
      ` de kern ${(fe * 1000).toFixed(4)} mm (${(100 * afw).toFixed(2)} %), dunne plaat ${(feDun * 1000).toFixed(4)} mm (${(100 * afwDun).toFixed(2)} %)`);
    // Dunne plaat (t/ℓ = 0,053): wat overblijft is het net (h/ℓ = 0,27; in de kerntest −5,6 % bij een
    // puntlast op een grote plaat) en de eindige plaat (vrije randen op 3,2ℓ maken haar weker). Grens 5 %.
    ok(Math.abs(afwDun) < 0.05, `kolom ${i + 1}, dunne plaat met dezelfde D: binnen 5 % van Westergaard + Hertz (${(100 * afwDun).toFixed(2)} %)`);
    // De echte dikte (t/ℓ = 0,21): MITC4 rekent met afschuifvervorming, Westergaard niet; die komt erbij
    // (orde P/(2πκGt)·ln(ℓ/h) ≈ 2,6 % van w onder kolom 2). Dus boven de dunne plaat en binnen 10 %.
    ok(fe > feDun && afw < 0.10,
      `kolom ${i + 1}, 200 mm: ${(100 * (fe / feDun - 1)).toFixed(2)} % boven de dunne plaat (afschuiving), ${(100 * afw).toFixed(2)} % boven Westergaard + Hertz`);
  }
  const zwaar = KOLOMMEN[1];
  const knoopP = b.nodes.find((n) => n.nodeId === zwaar.id);
  ok(Math.abs(b.maxPressureKnPerM2 - knoopP.pressureKnPerM2) < 1e-12 && Math.abs(knoopP.pressureKnPerM2 - K * knoopP.settlementM) < 1e-9,
    `de grootste gronddruk ${b.maxPressureKnPerM2.toFixed(2)} kN/m² = k·s onder de zwaarste kolom (Westergaard + Hertz: ${(K * (Q / K + hertz(zwaar.P, 0) + hertz(KOLOMMEN[0].P, 4))).toFixed(2)} kN/m²)`);
  ok(Math.abs(b.maxSettlementM - knoopP.settlementM) < 1e-15, `de grootste zakking ${(b.maxSettlementM * 1000).toFixed(3)} mm ligt onder de zwaarste kolom`);
  const los = b.nodes.filter((n) => !n.active).length;
  stil(`  (zonder contact: ${los} knopen, ${(100 * b.liftedFraction).toFixed(2)} % van het oppervlak: de vrije hoeken krullen op)`);
  const zonder = b.nodes.filter((n) => !n.active).reduce((s, n) => s + opp.get(n.nodeId), 0);
  const totaal = [...opp.values()].reduce((s, a) => s + a, 0);
  ok(Math.abs(b.liftedFraction - zonder / totaal) <= 1e-12,
    `liftedFraction ${b.liftedFraction} = Σ A_trib zonder contact / Σ A_trib ${zonder / totaal} (het oppervlak, niet de ${los} van ${b.nodes.length} knopen)`);
  const rij = openFem3DPlateBeddingSummary(model, result)[0];
  ok(rij.kKnPerM3 === K && rij.compressionOnly && Math.abs(rij.result.maxPressureKnPerM2 - b.maxPressureKnPerM2) < 1e-12
    && Math.abs(rij.result.totalReactionKn - (Q * A + P)) < 1e-6, "de rapportregel leest de uitkomst van de kern");
}

console.log("\n[3] met een wand op de lange rand, zonder opleggingen");
{
  const metWand = vloer(true);
  const uit = await solveOpenFem3DCombination(metWand, new Map([[1, 1], [2, 1]]), "linear");
  const bw = openFem3DPlateBeddingResultOf(uit, 1);
  ok(Math.abs(bw.totalReactionKn - (Q * A + P)) <= 1e-9 * (Q * A + P), `de kern rekent; Σ veerkrachten = ${Q * A + P} kN (${bw.totalReactionKn.toFixed(9)})`);
  ok(uit.reactions.length === 0 && uit.diagnostics.some((m) => m.includes("plaatvlak") && m.includes("vast")),
    "de kern houdt het deel in het vlak vast en meldt dat");
  ok((uit.forceBalance?.maxImbalanceKn ?? Infinity) <= (uit.forceBalance?.toleranceKn ?? 0),
    `de onafhankelijke krachtensom sluit (${uit.forceBalance?.maxImbalanceKn.toExponential(1)} kN)`);
  // De momentensom wijkt bij vloer + wand al af zonder bedding: de kunstmatige draaistijfheid van de
  // plaatelementen van de externe kern (zie plaatbedding.rs). Hier alleen getoond.
  stil(`  (momentensom: ${uit.forceBalance?.momentImbalanceKnm.map((x) => x.toExponential(2)).join(" / ")} kNm, grens ${uit.forceBalance?.momentToleranceKnm.toFixed(4)})`);
  stil(`  (zakking onder kolom 2 met wand ${(openFem3DPlateBeddingResultOf(uit, 1).nodes.find((n) => n.nodeId === 6).settlementM * 1000).toFixed(4)} mm, zonder ${(b.nodes.find((n) => n.nodeId === 6).settlementM * 1000).toFixed(4)} mm)`);
}

console.log("\n[4] tekenvlak en rapport met de echte uitkomst (browser)");
{
  const browser = [process.env.OPENAEC_BROWSER,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
  ].filter(Boolean).find(existsSync);
  assert.ok(browser, "Chromium-browser vereist; stel eventueel OPENAEC_BROWSER in");
  const map = mkdtempSync(join(tmpdir(), "open-fem3d-plaatbedding-vloer-"));
  try {
    const bundel = await build({
      absWorkingDir: dirname(fileURLToPath(import.meta.url)),
      entryPoints: ["scripts/open-fem3d-plaatbedding-e2e-browser.tsx"], bundle: true, write: false,
      outfile: join(map, "test.js"), format: "iife", platform: "browser", jsx: "automatic",
      external: ["fs", "path"],
      loader: { ".ifcfem": "text", ".svg": "dataurl", ".png": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
      define: { "process.env.NODE_ENV": '"production"' },
    });
    for (const bestand of bundel.outputFiles) writeFileSync(bestand.path, bestand.contents);
    const net = result.plateMesh;
    const gegevens = {
      model,
      result: { ...result, plateMesh: { ...net, beamIntermediateNodes: [...net.beamIntermediateNodes], plateEdgeNodes: [...net.plateEdgeNodes] } },
      verwacht: {
        pMax: b.maxPressureKnPerM2, los: b.nodes.filter((n) => !n.active).length, sMaxMm: b.maxSettlementM * 1000,
        sigmaR: b.totalReactionKn, kTekst: "30.000",
      },
      camera: { position: [13, -4.5, 6.5], target: [5, 3, 0], up: [0, 0, 1] },
    };
    writeFileSync(join(map, "gegevens.js"), `window.__PLAATBEDDING_E2E__ = ${JSON.stringify(gegevens)};`);
    const html = join(map, "test.html");
    writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="test.css"></head><body style="margin:0;background:#fff"><div id="root"></div>' +
      '<pre id="uitslag"></pre><script src="gegevens.js"></script><script src="test.js"></script></body></html>');
    const vlaggen = (profiel, venster) => ["--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader", "--no-first-run",
      "--no-default-browser-check", `--user-data-dir=${join(map, profiel)}`, `--window-size=${venster}`];
    const uitslag = startBrowser(browser, [...vlaggen("profiel", "1100,800"), "--virtual-time-budget=60000", "--dump-dom", pathToFileURL(html).href],
      { encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
    const gevonden = /<pre id="uitslag">([^<]*)<\/pre>/.exec(uitslag.stdout ?? "");
    assert.ok(gevonden?.[1], uitslag.error?.message ?? uitslag.stderr?.slice(0, 1500) ?? "Geen browserresultaat");
    const verslag = JSON.parse(gevonden[1].replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
    for (const proef of verslag.tests) {
      assert.ok(!proef.error, `${proef.name}: ${proef.error}`);
      geslaagd++;
      stil(`  ✓ ${proef.name}`);
    }
    assert.equal(verslag.error, null, verslag.error);
    assert.ok(verslag.tests.length >= 3, `te weinig browserproeven: ${verslag.tests.length}`);

    const schermMap = process.env.OPEN_FEM3D_SCHERMAFBEELDINGEN;
    if (schermMap) {
      assert.ok(existsSync(schermMap), `map voor schermafbeeldingen bestaat niet: ${schermMap}`);
      for (const [bestand, beeld, venster] of [
        ["plaatbedding-vloer-gronddruk.png", "gronddruk", "1200,700"],
        ["plaatbedding-vloer-zakking.png", "zakking", "1200,700"],
        ["plaatbedding-vloer-rapport.png", "rapport", "1200,900"],
      ]) {
        const pad = join(schermMap, bestand);
        startBrowser(browser, [...vlaggen(`profiel-${beeld}`, venster), "--hide-scrollbars", "--virtual-time-budget=10000",
          `--screenshot=${pad}`, `${pathToFileURL(html).href}#beeld=${beeld}`], { encoding: "utf8", timeout: 120_000 });
        assert.ok(existsSync(pad), `schermafbeelding niet gemaakt: ${pad}`);
        stil(`  schermafbeelding: ${pad}`);
      }
    }
    stil(`  (${basename(browser)})`);
  } finally {
    rmSync(map, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

stil(`\n${geslaagd} geslaagd, 0 gefaald`);

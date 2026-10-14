// Plaat op bedding in 3D (issue #107) van eind tot eind: een vloer op zand
// gaat door de rekenweg van de app (solveOpenFem3D: rekennet, verzoekopbouw,
// POST naar /api/openFem3d/solve, de onafhankelijke krachtensom) naar de echte
// 3D-kern, en de echte uitkomst komt terug in het tekenvlak (de contour
// Gronddruk met de waarden van de kern, de stippen zonder contact) en in het
// rapport (de tabel Platen op bedding met de getallen van de kern).
//
// Het model: een vloer van 8 × 6 m (C30/37, 250 mm, k = 20 000 kN/m³, alleen
// druk) met een vloerlast van 2 kN/m² en een kolomlast van 200 kN op
// (6,5; 1,5). Geen oplegging: de kern houdt de vloer in haar vlak vast (de
// last staat er loodrecht op) en verticaal draagt alleen de grond.
//   [1] de uitkomst van de kern: Σ veerkrachten = de belasting, de grootste
//       gronddruk onder de kolom, nergens trek in de grond, de krachtensom;
//   [2] het tekenvlak en het rapport met deze uitkomst in een lokale headless
//       browser (scripts/open-fem3d-plaatbedding-e2e-browser.tsx). Met
//       OPEN_FEM3D_SCHERMAFBEELDINGEN (een bestaande map) worden er
//       schermafbeeldingen van gemaakt.
//
// Rekenkern: OPEN_FEM_3D_SOLVER_PATH, anders src-tauri/target/debug/open-fem-3d(.exe).
// Kent de kern `plates[].bedding` niet (een oude bouw), dan faalt de proef
// met die melding.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { parseOpenFem3DModel } from "./src/components/openFem3d/openFem3dModel.ts";
import { solveOpenFem3D } from "./src/components/openFem3d/openFem3dSolver.ts";
import { openFem3DPlateBeddingResultOf, openFem3DPlateBeddingSummary } from "./src/components/openFem3d/openFem3dPlateBedding.ts";
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

const Q = 2, P = 200, K = 20_000;
const model = parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 8, y: 0, z: 0 }, { id: 3, x: 8, y: 6, z: 0 }, { id: 4, x: 0, y: 6, z: 0 },
    { id: 7, x: 6.5, y: 1.5, z: 0 },
  ],
  beams: [],
  plates: [
    { id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.25, material: "C30/37", meshSizeM: 0.5, bedding: { kKnPerM3: K, compressionOnly: true } },
  ],
  loads: [{ id: 1, nodeId: 7, caseId: 1, fx: 0, fy: 0, fz: -P, mx: 0, my: 0, mz: 0 }],
  surfaceLoads: [{ id: 1, plateId: 1, caseId: 1, qx: 0, qy: 0, qz: -Q }],
});

console.log("[1] de uitkomst van de kern, door de rekenweg van de app");
let result;
try {
  result = await solveOpenFem3D(model, 1, "linear");
} catch (fout) {
  const tekst = fout instanceof Error ? fout.message : String(fout);
  assert.ok(!/unknown field `bedding`/.test(tekst),
    `de 3D-kern op ${solverPath} kent plates[].bedding niet: een oude bouw; bouw open-fem-3d opnieuw (${tekst.slice(0, 120)})`);
  throw fout;
}
const vloer = openFem3DPlateBeddingResultOf(result, 1);
ok(vloer && vloer.nodes.length > 100, `plateBedding voor de vloer, ${vloer?.nodes.length} knopen`);
const belasting = Q * 48 + P;
ok(Math.abs(vloer.totalReactionKn - belasting) <= 1e-6 * belasting, `Σ veerkrachten = q·A + P = ${belasting} kN (${vloer.totalReactionKn.toFixed(6)})`);
const knoopVan = new Map(result.plateMesh.nodes.map((node) => [node.id, node]));
for (const node of model.nodes) knoopVan.set(node.id, node);
const grootste = vloer.nodes.reduce((a, b) => b.pressureKnPerM2 > a.pressureKnPerM2 ? b : a);
const plek = knoopVan.get(grootste.nodeId);
ok(Math.hypot(plek.x - 6.5, plek.y - 1.5) < 0.75, `de grootste gronddruk (${grootste.pressureKnPerM2.toFixed(1)} kN/m²) ligt onder de kolom (${plek.x}; ${plek.y})`);
ok(Math.abs(vloer.maxPressureKnPerM2 - grootste.pressureKnPerM2) < 1e-9, "maxPressureKnPerM2 is de grootste knoopwaarde");
ok(vloer.minPressureKnPerM2 >= 0 && vloer.nodes.every((n) => n.pressureKnPerM2 >= 0), "alleen druk: nergens trek in de grond");
ok(vloer.nodes.every((n) => n.active || (n.pressureKnPerM2 === 0 && n.settlementM <= 0)), "zonder contact: druk 0 en de vloer komt omhoog");
ok(result.forceBalance?.ok === true, `de onafhankelijke kracht- en momentensom sluit (${result.forceBalance?.maxImbalanceKn.toExponential(2)} kN, ${result.forceBalance?.maxMomentImbalanceKnm.toExponential(2)} kNm)`);
const rij = openFem3DPlateBeddingSummary(model, result)[0];
ok(rij.result && Math.abs(rij.result.maxSettlementMm - vloer.maxSettlementM * 1000) < 1e-9, "de rapportregel leest de uitkomst");
const los = vloer.nodes.filter((n) => !n.active).length;
stil(`  (grootste zakking ${(vloer.maxSettlementM * 1000).toFixed(3)} mm, ${los} knopen zonder contact, ${(vloer.liftedFraction * 100).toFixed(1)} % van het oppervlak)`);

console.log("\n[2] tekenvlak en rapport met de echte uitkomst (browser)");
{
  const browser = [process.env.OPENAEC_BROWSER,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
  ].filter(Boolean).find(existsSync);
  assert.ok(browser, "Chromium-browser vereist; stel eventueel OPENAEC_BROWSER in");
  const map = mkdtempSync(join(tmpdir(), "open-fem3d-plaatbedding-e2e-"));
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
    // De echte uitkomst gaat als gegevens mee de pagina in; het rekennet heeft Maps (JSON kent die niet).
    const net = result.plateMesh;
    const gegevens = {
      model,
      result: { ...result, plateMesh: { ...net, beamIntermediateNodes: [...net.beamIntermediateNodes], plateEdgeNodes: [...net.plateEdgeNodes] } },
      verwacht: { pMax: vloer.maxPressureKnPerM2, los, sMaxMm: vloer.maxSettlementM * 1000, sigmaR: vloer.totalReactionKn },
    };
    writeFileSync(join(map, "gegevens.js"), `window.__PLAATBEDDING_E2E__ = ${JSON.stringify(gegevens)};`);
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
      stil(`  ✓ ${proef.name}`);
    }
    assert.equal(verslag.error, null, verslag.error);
    assert.ok(verslag.tests.length >= 3, `te weinig browserproeven: ${verslag.tests.length}`);

    const schermMap = process.env.OPEN_FEM3D_SCHERMAFBEELDINGEN;
    if (schermMap) {
      assert.ok(existsSync(schermMap), `map voor schermafbeeldingen bestaat niet: ${schermMap}`);
      for (const [bestand, beeld, venster] of [
        ["plaatbedding-e2e-gronddruk.png", "gronddruk", "1200,700"],
        ["plaatbedding-e2e-zakking.png", "zakking", "1200,700"],
        ["plaatbedding-e2e-rapport.png", "rapport", "1200,900"],
      ]) {
        const pad = join(schermMap, bestand);
        startBrowser(browser, [...vlaggen(`profiel-${beeld}`, venster), "--hide-scrollbars", "--virtual-time-budget=10000",
          `--screenshot=${pad}`, `${pathToFileURL(html).href}#beeld=${beeld}`], { encoding: "utf8", timeout: 90_000 });
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

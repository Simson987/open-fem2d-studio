// Stramien- en levellijnen als streep-stip (issue #103) in het echte
// 3D-tekenvlak (ThreeFrameCanvas, WebGL) en het echte 2D-tekenvlak
// (FemCanvas), in een lokale headless browser: de pixels langs een
// stramienas in bovenaanzicht zijn streep-stip 16-4-2-4 px vanaf het begin
// van de lijn, ook twee keer in- en uitgezoomd (schermvast); in perspectief
// is de schaal de pixels-per-meter bij het draaipunt; met een section box is
// het model geknipt en het stramien heel; de peilmaten blijven; in 2D is de
// berekende stijl van assen en niveaulijnen streep-stip met de kleur en
// dekking van voorheen. De regels zelf: test-stramien-streepstip.mjs. Zie
// scripts/stramien-streepstip-browser.tsx.
//
// Schermafbeeldingen (3D boven, 3D iso, 3D met section box, 2D): zet
// STRAMIEN_SCHERMAFBEELDINGEN op een bestaande map; zonder die variabele
// wordt er niets gemaakt.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startBrowser } from "./scripts/headlessBrowser.mjs";

const browser = [process.env.OPENAEC_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
].filter(Boolean).find(existsSync);
assert.ok(browser, "Chromium-browser vereist; stel eventueel OPENAEC_BROWSER in");
const folder = mkdtempSync(join(tmpdir(), "stramien-streepstip-ui-"));
try {
  const bundle = await build({
    absWorkingDir: dirname(fileURLToPath(import.meta.url)),
    entryPoints: ["scripts/stramien-streepstip-browser.tsx"], bundle: true, write: false,
    outfile: join(folder, "test.js"), format: "iife", platform: "browser", jsx: "automatic",
    // Niet-uitgevoerde Node-tak van triangle-wasm, zoals Vite hem externaliseert.
    external: ["fs", "path"],
    loader: { ".ifcfem": "text", ".svg": "dataurl", ".png": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  for (const file of bundle.outputFiles) writeFileSync(file.path, file.contents);
  const html = join(folder, "test.html");
  writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8">' +
    '<link rel="stylesheet" href="test.css"></head><body style="margin:0;background:#fff"><div id="root"></div>' +
    '<pre id="uitslag"></pre><script src="test.js"></script></body></html>');
  const chromium = (extra, doel, profiel) => startBrowser(browser, ["--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader",
    "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(folder, profiel)}`, "--window-size=1100,720",
    ...extra, doel,
  ], { encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });

  const result = chromium(["--virtual-time-budget=60000", "--dump-dom"], pathToFileURL(html).href, "profiel");
  const match = /<pre id="uitslag">([^<]*)<\/pre>/.exec(result.stdout ?? "");
  assert.ok(match?.[1], result.error?.message ?? result.stderr?.slice(0, 1500) ?? "Geen browserresultaat");
  const report = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
  for (const item of report.tests) console.log(`  ${item.error ? "FAIL" : "ok"} ${item.name}${item.error ? ": " + item.error : ""}`);
  for (const regel of report.info ?? []) console.log(`     · ${regel}`);
  assert.equal(report.error, null, report.error);
  assert.equal(report.tests.filter((t) => t.error).length, 0, "streep-stip-UI regressies");
  assert.ok(report.tests.length >= 6, `te weinig proeven gedraaid: ${report.tests.length}`);

  const map = process.env.STRAMIEN_SCHERMAFBEELDINGEN;
  if (map) {
    assert.ok(existsSync(map), `map voor schermafbeeldingen bestaat niet: ${map}`);
    for (const beeld of ["3d-boven", "3d-iso", "3d-doos", "2d"]) {
      const pad = join(map, `stramien-${beeld}.png`);
      chromium(["--virtual-time-budget=15000", "--hide-scrollbars", `--screenshot=${pad}`], `${pathToFileURL(html).href}#beeld=${beeld}`, `profiel-${beeld}`);
      assert.ok(existsSync(pad), `schermafbeelding niet gemaakt: ${pad}`);
      console.log(`  schermafbeelding: ${pad}`);
    }
  }
  console.log(`${report.tests.length} geslaagd, 0 gefaald (${basename(browser)})`);
} finally {
  rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

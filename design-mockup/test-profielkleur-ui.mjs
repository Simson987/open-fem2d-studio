// "Profielen in kleur" in een lokale headless browser: het echte 2D-tekenvlak
// met de echte verkenner en het echte venster Zichtbaarheid op dezelfde
// displayFlags, en de echte 3D-werkruimte (OpenFem3DEditor, WebGL). Bewaakt:
// de schakelaar (verkenner, venster, 3D), de staafkleuren gelijk aan de
// toekenning, de legenda (alleen profielen uit het model, met aantal, plaats
// rechtsonder boven de modelcontrole, niet over andere HUD-kaarten, scrollen
// bij veel profielen), de uitbreiding (lijnsoort), "zonder profiel", de
// selectie en het aanzicht die voorgaan, het contrast in beide thema's, en in
// 3D de pixelkleuren, het snelle en het volledige opbouwpad en de voorrang van
// de UC-kleuring. De toekenning zelf bewaakt test-profielkleur.mjs.
//
// Schermafbeeldingen: zet PROFIELKLEUR_SCHERMAFBEELDINGEN op een bestaande map
// en de test schrijft daar tekenvlak-licht.png, tekenvlak-donker.png en
// werkruimte-3d.png. Zonder die variabele worden er geen bestanden gemaakt.
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
const folder = mkdtempSync(join(tmpdir(), "profielkleur-ui-"));
try {
  const bundle = await build({
    absWorkingDir: dirname(fileURLToPath(import.meta.url)),
    entryPoints: ["scripts/profielkleur-browser.tsx"], bundle: true, write: false,
    outfile: join(folder, "test.js"), format: "iife", platform: "browser", jsx: "automatic",
    // Niet-uitgevoerde Node-tak van triangle-wasm, zoals Vite hem externaliseert.
    external: ["fs", "path"],
    loader: { ".svg": "dataurl", ".png": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  for (const file of bundle.outputFiles) writeFileSync(file.path, file.contents);
  const html = join(folder, "test.html");
  writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8">' +
    '<link rel="stylesheet" href="test.css"></head><body><div id="root"></div>' +
    '<pre id="uitslag"></pre><script src="test.js"></script></body></html>');
  // Geen --disable-gpu-uitzondering nodig: WebGL loopt headless via de
  // software-renderer van het besturingssysteem (of SwiftShader op Linux).
  const chromium = (extra, doel) => startBrowser(browser, ["--headless=new", "--disable-gpu", "--no-first-run",
    "--no-default-browser-check", "--enable-unsafe-swiftshader", `--user-data-dir=${join(folder, "profiel")}`,
    "--window-size=1220,700", "--virtual-time-budget=20000", ...extra, doel,
  ], { encoding: "utf8", timeout: 90_000, maxBuffer: 32 * 1024 * 1024 });

  const result = chromium(["--dump-dom"], pathToFileURL(html).href);
  const match = /<pre id="uitslag">([^<]*)<\/pre>/.exec(result.stdout ?? "");
  assert.ok(match?.[1], result.error?.message ?? result.stderr?.slice(0, 1500) ?? "Geen browserresultaat");
  const report = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
  for (const item of report.tests) console.log(`  ${item.error ? "FAIL" : "ok"} ${item.name}${item.error ? ": " + item.error : ""}`);
  assert.equal(report.error, null, report.error);
  assert.equal(report.tests.filter((t) => t.error).length, 0, "Profielkleur-UI regressies");

  const map = process.env.PROFIELKLEUR_SCHERMAFBEELDINGEN;
  if (map) {
    assert.ok(existsSync(map), `map voor schermafbeeldingen bestaat niet: ${map}`);
    for (const [beeld, naam] of [["licht", "tekenvlak-licht.png"], ["donker", "tekenvlak-donker.png"], ["drie", "werkruimte-3d.png"]]) {
      const pad = join(map, naam);
      chromium([`--screenshot=${pad}`, "--hide-scrollbars", "--force-device-scale-factor=2"], `${pathToFileURL(html).href}#beeld=${beeld}`);
      assert.ok(existsSync(pad), `schermafbeelding niet gemaakt: ${pad}`);
      console.log(`  schermafbeelding: ${pad}`);
    }
  }
  console.log(`${report.tests.length} geslaagd, 0 gefaald (${basename(browser)})`);
} finally {
  rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

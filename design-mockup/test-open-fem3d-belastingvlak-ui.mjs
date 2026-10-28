// Belastingvlakken in de echte 3D-werkruimte (OpenFem3DEditor met
// ThreeFrameCanvas, WebGL) in een lokale headless browser, met echte klikken
// op het tekenvlak. Bewaakt: een nieuw getekend belastingvlak landt op het
// actieve werkvlak (level) in boven- en scheef aanzicht; het licht
// doorzichtige vlak in de kleur van het belastinggeval, alleen bij zichtbare
// belastingen en het actieve geval, ook van onderen; de oppervlaktelast op een
// plaat met een eigen vlak; klikken door het vlak heen (ligger in het vlak en
// plaat onder een oppervlaktelast blijven aanklikbaar, een plaat ver onder het
// vlak steelt de klik niet) en het label in licht en donker thema. De
// vlakmeetkunde en de klikregel zelf bewaakt test-open-fem3d-belastingvlak.mjs.
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
const folder = mkdtempSync(join(tmpdir(), "open-fem3d-belastingvlak-ui-"));
try {
  const bundle = await build({
    absWorkingDir: dirname(fileURLToPath(import.meta.url)),
    entryPoints: ["scripts/open-fem3d-belastingvlak-browser.tsx"], bundle: true, write: false,
    outfile: join(folder, "test.js"), format: "iife", platform: "browser", jsx: "automatic",
    // Niet-uitgevoerde Node-tak van triangle-wasm, zoals Vite hem externaliseert.
    external: ["fs", "path"],
    loader: { ".svg": "dataurl", ".png": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  for (const file of bundle.outputFiles) writeFileSync(file.path, file.contents);
  const html = join(folder, "test.html");
  writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8">' +
    '<link rel="stylesheet" href="test.css"></head><body style="margin:0"><div id="root"></div>' +
    '<pre id="uitslag"></pre><script src="test.js"></script></body></html>');
  // WebGL loopt headless via de software-renderer van het besturingssysteem
  // (of SwiftShader op Linux).
  const result = startBrowser(browser, ["--headless=new", "--disable-gpu", "--no-first-run",
    "--no-default-browser-check", "--enable-unsafe-swiftshader", `--user-data-dir=${join(folder, "profiel")}`,
    "--window-size=1220,700", "--virtual-time-budget=30000", "--dump-dom", pathToFileURL(html).href,
  ], { encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
  const match = /<pre id="uitslag">([^<]*)<\/pre>/.exec(result.stdout ?? "");
  assert.ok(match?.[1], result.error?.message ?? result.stderr?.slice(0, 1500) ?? "Geen browserresultaat");
  const report = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
  for (const item of report.tests) console.log(`  ${item.error ? "FAIL" : "ok"} ${item.name}${item.error ? ": " + item.error : ""}`);
  assert.equal(report.error, null, report.error);
  assert.equal(report.tests.filter((t) => t.error).length, 0, "Belastingvlak-UI regressies");
  console.log(`${report.tests.length} geslaagd, 0 gefaald (${basename(browser)})`);
} finally {
  rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

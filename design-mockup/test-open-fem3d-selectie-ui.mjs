// Het echte 3D-tekenvlak (ThreeFrameCanvas, WebGL) in een lokale headless
// browser: één klik op of vlak naast een staaf selecteert die staaf, ook in
// de staalhal van 60 × 30 m met dunne buisverbanden.
//
// Met OPEN_FEM3D_SELECTIE_DIAG=1 schrijft de test alleen de telling per
// scenario (hoe vaak één klik de staaf selecteert) en toetst niets.
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
const diag = process.env.OPEN_FEM3D_SELECTIE_DIAG === "1";
const folder = mkdtempSync(join(tmpdir(), "open-fem3d-selectie-ui-"));
try {
  const bundle = await build({
    absWorkingDir: dirname(fileURLToPath(import.meta.url)),
    entryPoints: ["scripts/open-fem3d-selectie-browser.tsx"], bundle: true, write: false,
    outfile: join(folder, "test.js"), format: "iife", platform: "browser", jsx: "automatic",
    external: ["fs", "path"],
    loader: { ".ifcfem": "text", ".svg": "dataurl", ".png": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  for (const file of bundle.outputFiles) writeFileSync(file.path, file.contents);
  const html = join(folder, "test.html");
  writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8">' +
    '<link rel="stylesheet" href="test.css"></head><body style="margin:0"><div id="root"></div>' +
    '<pre id="uitslag"></pre><script src="test.js"></script></body></html>');
  // WebGL via SwiftShader is traag; elke groep krijgt een eigen browserproces
  // (en daarmee een eigen klok in scripts/headlessBrowser.mjs).
  const draai = (hash, profiel) => {
    const result = startBrowser(browser, ["--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader", "--no-first-run",
      "--no-default-browser-check", `--user-data-dir=${join(folder, profiel)}`, "--window-size=1100,800",
      "--virtual-time-budget=60000", "--dump-dom", `${pathToFileURL(html).href}#${hash}`,
    ], { encoding: "utf8", timeout: 90_000, maxBuffer: 32 * 1024 * 1024 });
    const match = /<pre id="uitslag">([^<]*)<\/pre>/.exec(result.stdout ?? "");
    assert.ok(match?.[1], result.error?.message ?? result.stderr?.slice(0, 1500) ?? "Geen browserresultaat");
    return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
  };
  if (diag) {
    const report = draai(process.env.OPEN_FEM3D_SELECTIE_HASH ?? "diag", "profiel-diag");
    console.log(JSON.stringify(report.diag, null, 2));
    assert.equal(report.error, null, report.error);
  } else {
    let totaal = 0;
    for (const groep of ["groot", "klein"]) {
      const report = draai(`groep=${groep}`, `profiel-${groep}`);
      for (const item of report.tests) console.log(`  ${item.error ? "FAIL" : "ok"} ${item.name}${item.error ? ": " + item.error : ""}`);
      assert.equal(report.error, null, report.error);
      assert.equal(report.tests.filter((t) => t.error).length, 0, "3D-selectie-UI regressies");
      totaal += report.tests.length;
    }
    // Schermafbeelding van de vervormde vorm: zet OPEN_FEM3D_SCHERMAFBEELDINGEN
    // op een bestaande map; zonder die variabele wordt er niets gemaakt.
    const map = process.env.OPEN_FEM3D_SCHERMAFBEELDINGEN;
    if (map) {
      assert.ok(existsSync(map), `map voor schermafbeeldingen bestaat niet: ${map}`);
      const pad = join(map, "vervormde-vorm.png");
      startBrowser(browser, ["--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader", "--no-first-run",
        "--no-default-browser-check", `--user-data-dir=${join(folder, "profiel-beeld")}`, "--window-size=1000,700",
        "--hide-scrollbars", "--virtual-time-budget=10000", `--screenshot=${pad}`, `${pathToFileURL(html).href}#beeld=vervormd`,
      ], { encoding: "utf8", timeout: 90_000 });
      assert.ok(existsSync(pad), `schermafbeelding niet gemaakt: ${pad}`);
      console.log(`  schermafbeelding: ${pad}`);
    }
    console.log(`${totaal} geslaagd, 0 gefaald (${basename(browser)})`);
  }
} finally {
  rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

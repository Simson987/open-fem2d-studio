// Section box (issue #86) in het echte 3D-tekenvlak (ThreeFrameCanvas, WebGL)
// in een lokale headless browser: aan via het menu ▾ van de view cube, een
// vlak slepen (geen opbouw, geen nieuwe shader, de camera staat stil), een
// staaf buiten de doos niet in beeld en niet kiesbaar, het selectievenster
// alleen binnen, geen snap op een knoop buiten de doos, labels buiten weg,
// passend beeld op de doos, Reset, passend op selectie, Esc tijdens het
// slepen, grepen in de eerste render op hun vlak, recht van boven geen dode
// plek midden in de doos (de greep ±z wijst naar de kijker), een dakplaat
// afgesneden en alleen binnen kiesbaar, geen objectspoor meer van een knoop
// die na het slepen buiten de doos valt, een view die de doos bewaart, en
// twintig sleepstappen in een hal van 631 staven. De rekenregels:
// test-open-fem3d-section-box.mjs. Zie scripts/open-fem3d-section-box-browser.tsx.
//
// Schermafbeeldingen (de hal iso met een doos en grepen, en het menu ▾): zet
// OPEN_FEM3D_SCHERMAFBEELDINGEN op een bestaande map; zonder die variabele
// wordt er niets gemaakt.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { browserResult, startBrowser } from "./scripts/headlessBrowser.mjs";

const browser = [process.env.OPENAEC_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
].filter(Boolean).find(existsSync);
assert.ok(browser, "Chromium-browser vereist; stel eventueel OPENAEC_BROWSER in");
const folder = mkdtempSync(join(tmpdir(), "open-fem3d-section-box-ui-"));
try {
  const bundle = await build({
    absWorkingDir: dirname(fileURLToPath(import.meta.url)),
    entryPoints: ["scripts/open-fem3d-section-box-browser.tsx"], bundle: true, write: false,
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
  // De halproef maakt honderden WebGL-objecten. Beide groepen draaien alle
  // checks met een eigen proces; CDP leest #uitslag zodra die gevuld is.
  let totaal = 0;
  for (const groep of ["basis", "prestatie"]) {
    const report = await browserResult(browser, ["--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader", "--force-prefers-reduced-motion=reduce", "--no-first-run",
      "--no-default-browser-check", `--user-data-dir=${join(folder, `profiel-${groep}`)}`, "--window-size=1000,760",
      `${pathToFileURL(html).href}#groep=${groep}`,
    ]);
    for (const item of report.tests) console.log(`  ${item.error ? "FAIL" : "ok"} ${item.name}${item.error ? ": " + item.error : ""}`);
    for (const regel of report.info ?? []) console.log(`     · ${regel}`);
    assert.equal(report.error, null, `${groep}: ${report.error}`);
    assert.equal(report.tests.filter((t) => t.error).length, 0, `${groep}: section-box-UI regressies`);
    totaal += report.tests.length;
  }
  assert.ok(totaal >= 14, `te weinig proeven gedraaid: ${totaal}`);

  const map = process.env.OPEN_FEM3D_SCHERMAFBEELDINGEN;
  if (map) {
    assert.ok(existsSync(map), `map voor schermafbeeldingen bestaat niet: ${map}`);
    for (const [bestand, beeld] of [["section-box-hal-iso.png", "hal"], ["section-box-menu.png", "menu"]]) {
      const pad = join(map, bestand);
      startBrowser(browser, ["--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader", "--no-first-run",
        "--no-default-browser-check", `--user-data-dir=${join(folder, `profiel-${beeld}`)}`, "--window-size=900,640",
        "--hide-scrollbars", "--virtual-time-budget=20000", `--screenshot=${pad}`, `${pathToFileURL(html).href}#beeld=${beeld}`,
      ], { encoding: "utf8", timeout: 120_000 });
      assert.ok(existsSync(pad), `schermafbeelding niet gemaakt: ${pad}`);
      console.log(`  schermafbeelding: ${pad}`);
    }
  }
  console.log(`${totaal} geslaagd, 0 gefaald (${basename(browser)})`);
} finally {
  rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

// Knopen op staven aansluiten (issue #63) in het echte 3D-tekenvlak
// (ThreeFrameCanvas, WebGL), de modelcontrole, de tab Weergave en het lint,
// in een lokale headless browser: een staaf tekenen door een losse knoop
// splitst die staaf op de knoop (één stap); een knoop tekenen op een staaf
// splitst de staaf; de modelcontrole meldt een losse knoop met de knop
// Aansluiten (één stap, ongedaan maken brengt de melding terug) en klapt open
// bij Berekenen; bij overlappende staven staat de reden in de regel en de
// knop uit; de kaart ligt onder de kopregel en naast de view cube (760 en
// 1100 px, vier talen, de langste uitleg); met de schakelaar uit blijft alles
// heel; twee keer verplaatsen neemt de tweede keer de hele (gesplitste)
// ligger mee; de schakelaar en de verbindingstolerantie staan in de tab
// Weergave van 3D; de lintknop met alleen een kolom geselecteerd sluit haar
// voet aan. De regels zelf: test-open-fem3d-aansluiten.mjs. Zie
// scripts/open-fem3d-aansluiten-browser.tsx.
//
// Schermafbeeldingen (de modelcontrole met de knop; het lint, de tab Weergave
// met de instelling en het tekenvlak): zet OPEN_FEM3D_SCHERMAFBEELDINGEN op
// een bestaande map; zonder die variabele wordt er niets gemaakt.
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
const folder = mkdtempSync(join(tmpdir(), "open-fem3d-aansluiten-ui-"));
try {
  const bundle = await build({
    absWorkingDir: dirname(fileURLToPath(import.meta.url)),
    entryPoints: ["scripts/open-fem3d-aansluiten-browser.tsx"], bundle: true, write: false,
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
  const report = await browserResult(browser, ["--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader", "--no-first-run",
    "--no-default-browser-check", `--user-data-dir=${join(folder, "profiel")}`, "--window-size=1150,700",
    pathToFileURL(html).href,
  ]);
  for (const item of report.tests) console.log(`  ${item.error ? "FAIL" : "ok"} ${item.name}${item.error ? ": " + item.error : ""}`);
  for (const regel of report.info ?? []) console.log(`     · ${regel}`);
  assert.equal(report.error, null, report.error);
  assert.equal(report.tests.filter((t) => t.error).length, 0, "aansluiten-UI regressies");
  assert.ok(report.tests.length >= 11, `te weinig proeven gedraaid: ${report.tests.length}`);

  const map = process.env.OPEN_FEM3D_SCHERMAFBEELDINGEN;
  if (map) {
    assert.ok(existsSync(map), `map voor schermafbeeldingen bestaat niet: ${map}`);
    for (const [bestand, beeld] of [["aansluiten-modelcontrole.png", "modelcontrole"], ["aansluiten-instelling.png", "instelling"]]) {
      const pad = join(map, bestand);
      startBrowser(browser, ["--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader", "--no-first-run",
        "--no-default-browser-check", `--user-data-dir=${join(folder, `profiel-${beeld}`)}`,
        beeld === "modelcontrole" ? "--window-size=900,600" : "--window-size=1150,660",
        "--hide-scrollbars", "--virtual-time-budget=15000", `--screenshot=${pad}`, `${pathToFileURL(html).href}#beeld=${beeld}`,
      ], { encoding: "utf8", timeout: 90_000 });
      assert.ok(existsSync(pad), `schermafbeelding niet gemaakt: ${pad}`);
      console.log(`  schermafbeelding: ${pad}`);
    }
  }
  console.log(`${report.tests.length} geslaagd, 0 gefaald (${basename(browser)})`);
} finally {
  rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

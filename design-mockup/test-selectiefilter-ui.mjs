// Het venster Selectiefilter (issue #94) in een lokale headless browser, met
// echte React en CSS en dezelfde koppeling als App.tsx
// (SelectieFilterVenster3D/2D), zie scripts/selectiefilter-browser.tsx:
//   3D — de lintknop opent het venster op een selectie van tien staven; alleen
//        HEA 200 houden; de telling loopt mee; Toepassen → de selectie is die
//        staven, niet de HEA 200 buiten de selectie; Annuleren laat hem staan;
//        weghalen, lengte in mm, Wissen; enkelvoud bij één staaf; het hele
//        model zonder selectie, lasten van één geval (dat geval wordt actief),
//        opleggingen; Engels;
//   2D — het hele model, Staven en verticaal houden, Toepassen; lasten van
//        één geval op een selectie (niet de last van dat geval erbuiten; het
//        geval wordt actief).
//
// Met SELECTIEFILTER_SCHERMEN=<map> maakt de test daarnaast schermafbeeldingen
// van het venster in 3D en 2D (licht en donker thema). Die horen niet in de repo.
//
// Uitvoeren: node test-selectiefilter-ui.mjs   (vanuit design-mockup/)
import assert from "node:assert/strict";
import { build } from "esbuild";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startBrowser } from "./scripts/headlessBrowser.mjs";

const browser = [process.env.OPENAEC_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
].filter(Boolean).find(existsSync);
assert.ok(browser, "Chromium-browser vereist; stel eventueel OPENAEC_BROWSER in");
const folder = mkdtempSync(join(tmpdir(), "selectiefilter-ui-"));
const chromium = (extra, url, profiel = "profiel") => startBrowser(browser, ["--headless=new", "--disable-gpu", "--no-first-run",
  "--no-default-browser-check", `--user-data-dir=${join(folder, profiel)}`,
  "--virtual-time-budget=10000", ...extra, url,
], { encoding: "utf8", timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
try {
  const bundle = await build({
    absWorkingDir: dirname(fileURLToPath(import.meta.url)),
    entryPoints: ["scripts/selectiefilter-browser.tsx"], bundle: true, write: false,
    outfile: join(folder, "test.js"), format: "iife", platform: "browser", jsx: "automatic",
    external: ["fs", "path"], loader: { ".svg": "dataurl", ".png": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  for (const file of bundle.outputFiles) writeFileSync(file.path, file.contents);
  const html = join(folder, "test.html");
  writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8">' +
    '<link rel="stylesheet" href="test.css"></head><body><div id="root"></div>' +
    '<pre id="uitslag" style="display:none"></pre><script src="test.js"></script></body></html>');
  const result = chromium(["--dump-dom", "--window-size=1100,800"], pathToFileURL(html).href);
  const match = /<pre id="uitslag"[^>]*>([^<]*)<\/pre>/.exec(result.stdout ?? "");
  assert.ok(match?.[1], result.error?.message ?? result.stderr?.slice(0, 1500) ?? "Geen browserresultaat");
  const report = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
  for (const line of report.tests) console.log("  ✓ " + line);
  for (const line of report.errors) console.log("  ✗ " + line);
  assert.deepEqual(report.errors, [], report.errors.join("\n"));

  const schermen = process.env.SELECTIEFILTER_SCHERMEN;
  if (schermen) {
    assert.ok(existsSync(schermen), `map voor schermafbeeldingen bestaat niet: ${schermen}`);
    for (const [dim, thema, naam] of [["3d", "light", "3d-licht"], ["3d", "dark", "3d-donker"], ["2d", "light", "2d-licht"]]) {
      const pad = resolve(schermen, `selectiefilter-${naam}.png`);
      const r = chromium([`--screenshot=${pad}`, "--window-size=1100,820", "--hide-scrollbars"],
        `${pathToFileURL(html).href}#beeld=${dim}-${thema}`, `profiel-${naam}`);
      assert.ok(existsSync(pad), `schermafbeelding ${naam} niet gemaakt: ${r.stderr?.slice(0, 500)}`);
      console.log(`  schermafbeelding: ${pad}`);
    }
  }
  console.log(`${report.tests.length} geslaagd, 0 gefaald (${basename(browser)})`);
} finally {
  rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

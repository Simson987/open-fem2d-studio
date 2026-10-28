// Plaatsen op een object (issues #76 en #77) in het echte 3D-tekenvlak
// (ThreeFrameCanvas, WebGL), het eigenschappenpaneel en het lint, in een
// lokale headless browser: een klik op de ligger vlak naast een knoop geeft
// die knoop de oplegging; midden op de ligger wordt hij gesplitst; de
// knoopschaal (#82) vergroot de vangzone; op de vloerplaat komt een knoop in
// het middenvlak en het getekende rekennet neemt hem mee; het gereedschap
// Puntlast zet een knooplast of een staafpuntlast op de plek en opent het
// paneel; op een plaat of leeg canvas niets, met een melding; Esc stopt. De
// regels zelf: test-open-fem3d-plaatsen.mjs. Zie scripts/open-fem3d-plaatsen-browser.tsx.
//
// Schermafbeeldingen (een oplegging op de plaat met het nieuwe rekennet, een
// puntlast op de ligger): zet OPEN_FEM3D_SCHERMAFBEELDINGEN op een bestaande
// map; zonder die variabele wordt er niets gemaakt.
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
const folder = mkdtempSync(join(tmpdir(), "open-fem3d-plaatsen-ui-"));
try {
  const bundle = await build({
    absWorkingDir: dirname(fileURLToPath(import.meta.url)),
    entryPoints: ["scripts/open-fem3d-plaatsen-browser.tsx"], bundle: true, write: false,
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
  const result = startBrowser(browser, ["--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader", "--no-first-run",
    "--no-default-browser-check", `--user-data-dir=${join(folder, "profiel")}`, "--window-size=1150,700",
    "--virtual-time-budget=90000", "--dump-dom", pathToFileURL(html).href,
  ], { encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
  const match = /<pre id="uitslag">([^<]*)<\/pre>/.exec(result.stdout ?? "");
  assert.ok(match?.[1], result.error?.message ?? result.stderr?.slice(0, 1500) ?? "Geen browserresultaat");
  const report = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
  for (const item of report.tests) console.log(`  ${item.error ? "FAIL" : "ok"} ${item.name}${item.error ? ": " + item.error : ""}`);
  for (const regel of report.info ?? []) console.log(`     · ${regel}`);
  assert.equal(report.error, null, report.error);
  assert.equal(report.tests.filter((t) => t.error).length, 0, "plaatsen-UI regressies");
  assert.ok(report.tests.length >= 10, `te weinig proeven gedraaid: ${report.tests.length}`);

  const map = process.env.OPEN_FEM3D_SCHERMAFBEELDINGEN;
  if (map) {
    assert.ok(existsSync(map), `map voor schermafbeeldingen bestaat niet: ${map}`);
    for (const [bestand, beeld] of [["plaatsen-oplegging-op-plaat.png", "plaat-oplegging"], ["plaatsen-puntlast-op-staaf.png", "puntlast-staaf"]]) {
      const pad = join(map, bestand);
      startBrowser(browser, ["--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader", "--no-first-run",
        "--no-default-browser-check", `--user-data-dir=${join(folder, `profiel-${beeld}`)}`, "--window-size=1150,660",
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

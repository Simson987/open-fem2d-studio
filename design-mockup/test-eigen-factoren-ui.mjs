// Eigen factoren, bewust gekozen (issue #196) in de echte melding bij het
// openen, het echte venster Belastinggevallen & combinaties en de echte
// rapportsectie: echte React, echte CSS, in Chromium, zonder webserver of
// rekenkern. De regels zelf staan in test-eigen-factoren.mjs; zie
// scripts/eigen-factoren-browser.tsx.
//
// Met EIGEN_FACTOREN_SCHERMEN=<map> maakt de test daarnaast drie
// schermafbeeldingen: de melding met de knop "Behoud eigen factoren" en het
// venster vóór de knop, het venster erna, en de rapportsectie erna. Die horen
// niet in de repo.
//
// Uitvoeren: node test-eigen-factoren-ui.mjs   (vanuit design-mockup/)
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
const folder = mkdtempSync(join(tmpdir(), "eigen-factoren-ui-"));
const chromium = (extra, url) => startBrowser(browser, ["--headless=new", "--disable-gpu", "--no-first-run",
  "--no-default-browser-check", `--user-data-dir=${join(folder, "profiel")}`,
  "--virtual-time-budget=10000", ...extra, url,
], { encoding: "utf8", timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
try {
  const bundle = await build({
    absWorkingDir: dirname(fileURLToPath(import.meta.url)),
    entryPoints: ["scripts/eigen-factoren-browser.tsx"], bundle: true, write: false,
    outfile: join(folder, "test.js"), format: "iife", platform: "browser", jsx: "automatic",
    external: ["fs", "path"],
    loader: { ".femp": "text", ".svg": "dataurl", ".png": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  for (const file of bundle.outputFiles) writeFileSync(file.path, file.contents);
  const html = join(folder, "test.html");
  writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8">' +
    '<link rel="stylesheet" href="test.css"></head><body><div id="root"></div>' +
    '<pre id="uitslag" style="display:none"></pre><script src="test.js"></script></body></html>');
  const result = chromium(["--dump-dom"], pathToFileURL(html).href);
  const match = /<pre id="uitslag"[^>]*>([^<]*)<\/pre>/.exec(result.stdout ?? "");
  assert.ok(match?.[1], result.error?.message ?? result.stderr?.slice(0, 1500) ?? "Geen browserresultaat");
  const report = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
  for (const line of report.tests) console.log("  ok  " + line);
  for (const line of report.errors) console.log("  FAAL " + line);
  assert.deepEqual(report.errors, [], report.errors.join("\n"));
  assert.ok(report.tests.length >= 9, `te weinig proeven gedraaid: ${report.tests.length}`);

  const schermen = process.env.EIGEN_FACTOREN_SCHERMEN;
  if (schermen) {
    assert.ok(existsSync(schermen), `map voor schermafbeeldingen bestaat niet: ${schermen}`);
    for (const stand of ["melding", "bevestigd", "rapport"]) {
      const pad = resolve(schermen, `eigen-factoren-${stand}.png`);
      const r = chromium([`--screenshot=${pad}`, "--window-size=1280,1100", "--hide-scrollbars"],
        `${pathToFileURL(html).href}#toon-${stand}`);
      assert.ok(existsSync(pad), `schermafbeelding ${stand} niet gemaakt: ${r.stderr?.slice(0, 500)}`);
      console.log(`  schermafbeelding: ${pad}`);
    }
  }
  console.log(`${report.tests.length} geslaagd, 0 gefaald (${basename(browser)})`);
} finally {
  rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

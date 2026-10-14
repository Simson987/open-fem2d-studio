// Bestandskoppeling (#90): de recente bestanden als er meerdere paden in één
// ophaalronde binnenkomen (meerdere bestanden tegelijk openen terwijl de
// pagina nog laadt).
//
// De koppeling opent het volgende pad zodra het vorige klaar is, in een
// microtaak; React heeft dan nog niet opnieuw gerenderd. Bouwde
// `addRecentFile` op de lijst uit de closure van de vorige render, dan viel er
// een bestand weg ([a, b, c] → [c, a]). Deze test draait de echte
// useRecentFiles en useBestandskoppeling in React, in headless Chromium, met
// alleen de native IPC-grens nagebootst (scripts/bestandskoppeling-recent-browser.tsx).
import assert from "node:assert/strict";
import { build } from "esbuild";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startBrowser } from "./scripts/headlessBrowser.mjs";

const browser = [process.env.OPENAEC_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
].filter(Boolean).find(existsSync);
assert.ok(browser, "Chromium vereist; stel OPENAEC_BROWSER in");

const map = mkdtempSync(join(tmpdir(), "bestandskoppeling-recent-"));
try {
  const bundel = await build({
    entryPoints: ["scripts/bestandskoppeling-recent-browser.tsx"], bundle: true, write: false,
    // fs en path: de extensielijst komt uit io/projectFile.ts, en via die import
    // komt triangle-wasm mee, zoals in de andere UI-tests.
    format: "iife", platform: "browser", jsx: "automatic", external: ["fs", "path"], loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const html = join(map, "test.html");
  writeFileSync(html, '<!doctype html><meta charset="utf-8"><div id="root"></div><pre id="uitslag"></pre><script>' +
    bundel.outputFiles[0].text.replace(/<\/script/gi, "<\\/script") + "</script>");
  const uitkomst = startBrowser(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${join(map, "profiel")}`, "--virtual-time-budget=12000", "--dump-dom", pathToFileURL(html).href],
    { encoding: "utf8", timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
  const treffer = /<pre id="uitslag">([^<]*)<\/pre>/.exec(uitkomst.stdout ?? "");
  assert.ok(treffer?.[1], uitkomst.error?.message ?? uitkomst.stderr?.slice(0, 1500) ?? "Geen browseruitslag");
  const verslag = JSON.parse(treffer[1].replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
  for (const t of verslag.tests) console.log(`  ${t.error ? "✗" : "✓"} ${t.name}${t.error ? " — " + t.error : ""}`);
  assert.equal(verslag.error, undefined, verslag.error);
  const gefaald = verslag.tests.filter((t) => t.error).length;
  console.log(`\n${verslag.tests.length - gefaald} geslaagd, ${gefaald} gefaald`);
  assert.equal(gefaald, 0, "recente bestanden bij de bestandskoppeling");
} finally {
  rmSync(map, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

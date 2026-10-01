// "Rekenmodel importeren" als echte React-UI in een lokale, headless browser;
// geen webserver. De stappen staan in scripts/ifc-import-browser.tsx: de knop op
// het IFC-tabblad, het keuzevenster bij twee analysemodellen, de vraag bij
// niet-opgeslagen werk, het verslagvenster en de foutmelding bij een bestand
// dat geen IFC is. Het testbestand is docs/verificatie/ifc-analyse/ifc-analyse-m-n.ifc.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { startBrowser } from "./scripts/headlessBrowser.mjs";

const browser = [
  process.env.OPENAEC_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
].filter(Boolean).find(existsSync);
assert.ok(browser, "Chromium-browser vereist; stel eventueel OPENAEC_BROWSER in");
const folder = mkdtempSync(join(tmpdir(), "ifc-import-ui-"));
try {
  const bundle = await build({
    entryPoints: ["scripts/ifc-import-browser.tsx"], bundle: true, write: false,
    format: "iife", platform: "browser", jsx: "automatic",
    external: ["fs", "path"],
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".css": "empty", ".svg": "dataurl", ".png": "dataurl", ".ifc": "text" },
  });
  const html = join(folder, "test.html");
  const stijl = ["src/components/Modal.css", "src/components/ifcImport/IfcImportDialogen.css"]
    .map((pad) => readFileSync(pad, "utf8")).join("\n");
  writeFileSync(html, '<!doctype html><meta charset="utf-8"><style>' + stijl +
    '</style><div id="root"></div><pre id="uitslag"></pre><script>' +
    bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script") + "</script>");
  const result = startBrowser(browser, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${join(folder, "profiel")}`, "--virtual-time-budget=20000",
    "--dump-dom", pathToFileURL(html).href,
  ], { encoding: "utf8", timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
  const match = /<pre id="uitslag">([^<]*)<\/pre>/.exec(result.stdout ?? "");
  assert.ok(match?.[1], result.error?.message ?? result.stderr?.slice(0, 1500) ?? "Geen browserresultaat");
  const report = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
  for (const line of report.tests) console.log("  ✓ " + line);
  assert.equal(report.error, null, report.error);
  console.log(`${report.tests.length} geslaagd, 0 gefaald (${basename(browser)})`);
} finally {
  rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

// Browserproef voor lokale importextensies: dezelfde .demofem-extensie als de
// contracttest, plus tijdslimiet, foutafhandeling en scheiding van de pagina.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { browserResult } from "./scripts/headlessBrowser.mjs";

const hier = dirname(fileURLToPath(import.meta.url));
const browser = [process.env.OPENAEC_BROWSER, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe",
].filter(Boolean).find(existsSync);
assert.ok(browser, "Chromium-browser vereist; stel eventueel OPENAEC_BROWSER in");
const folder = mkdtempSync(join(tmpdir(), "open-fem-extensie-worker-ui-"));
try {
  const bundle = await build({
    absWorkingDir: hier, entryPoints: ["scripts/extensie-worker-browser.ts"], bundle: true, write: false,
    outfile: join(folder, "test.js"), format: "iife", platform: "browser",
    external: ["fs", "path"],
    define: { "process.env.NODE_ENV": '"production"' },
  });
  for (const file of bundle.outputFiles) writeFileSync(file.path, file.contents);
  const fixture = join(hier, "test-fixtures", "extensie-voorbeeld");
  const data = { script: readFileSync(join(fixture, "index.js"), "utf8"),
    bytes: [...readFileSync(join(fixture, "voorbeeld.demofem"))] };
  writeFileSync(join(folder, "data.js"), `window.__extensieTest = ${JSON.stringify(data)};`);
  const html = join(folder, "test.html");
  writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<pre id="uitslag"></pre><script src="data.js"></script><script src="test.js"></script></body></html>');
  const report = await browserResult(browser, ["--headless=new", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${join(folder, "profile")}`, pathToFileURL(html).href]);
  for (const item of report.tests) console.log(`  ${item.error ? "FAIL" : "ok"} ${item.name}${item.error ? ": " + item.error : ""}`);
  assert.equal(report.error, null, report.error);
  assert.equal(report.tests.length, 5);
  assert.equal(report.tests.filter((test) => test.error).length, 0, "worker-regressies");
  console.log("5 geslaagd, 0 gefaald");
} finally {
  rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

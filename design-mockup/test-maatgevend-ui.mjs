// Het toetsingspaneel met "wat is maatgevend" in Chromium (issue #41):
// modeloverzicht, samenvattingsregel per kaart, de toetslijst met balkjes, de
// keuze van de volgorde en de klik naar het tekenvlak. De afleiding zelf staat
// in test-maatgevend.mjs.
//
// Schermafbeeldingen (licht en donker thema) komen er alleen als de
// omgevingsvariabele MAATGEVEND_SCHERMAFBEELDINGEN een map noemt; ze horen niet
// in de repo.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { browserResult, startBrowser } from "./scripts/headlessBrowser.mjs";

const browser = [process.env.OPENAEC_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
].filter(Boolean).find(existsSync);
assert.ok(browser, "Chromium vereist; stel OPENAEC_BROWSER in");
const beeldmap = process.env.MAATGEVEND_SCHERMAFBEELDINGEN;
const folder = mkdtempSync(join(tmpdir(), "maatgevend-ui-"));
try {
  const styles = ["src/openaec/openaec-tokens.css", "src/themes.css", "src/App.css", "node_modules/katex/dist/katex.min.css", "src/components/panels/CheckPanel.css"]
    .map((path) => readFileSync(path, "utf8")).join("\n");
  const pagina = async (thema) => {
    const bundle = await build({ entryPoints: ["scripts/maatgevend-browser.tsx"], bundle: true, write: false,
      format: "iife", platform: "browser", jsx: "automatic", external: ["fs", "path"],
      define: { "process.env.NODE_ENV": '"production"', THEMA: JSON.stringify(thema) },
      loader: { ".css": "empty", ".svg": "dataurl", ".png": "dataurl" } });
    const html = join(folder, `test-${thema}.html`);
    writeFileSync(html, '<!doctype html><meta charset="utf-8"><style>' + styles +
      "html,body{margin:0;height:auto}#test-root{width:860px;height:2000px}#uitslag{display:none}" +
      '</style><div id="test-root"></div><pre id="uitslag"></pre><script>' +
      bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script") + "</script>");
    return html;
  };
  const vlaggen = (thema, virtueleTijd = true) => ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${join(folder, "profiel-" + thema)}`, "--window-size=860,2000",
    ...(virtueleTijd ? ["--virtual-time-budget=12000"] : [])];

  const html = await pagina("light");
  // Lees de uitslag zodra de pagina klaar is; CDP toont bij een hang ook
  // welke test het laatst bezig was, zonder op --dump-dom te wachten (#46).
  const report = await browserResult(browser, [...vlaggen("light", false), pathToFileURL(html).href], 45_000);
  for (const item of report.tests) console.log(`  ${item.error ? "FAIL" : "ok"} ${item.name}${item.error ? ": " + item.error : ""}`);
  assert.equal(report.error, null, report.error);
  assert.equal(report.tests.filter((t) => t.error).length, 0, "Regressies in het toetsingspaneel");

  if (beeldmap) {
    mkdirSync(beeldmap, { recursive: true });
    for (const [thema, naam] of [["light", "toetsingspaneel-licht.png"], ["dark", "toetsingspaneel-donker.png"]]) {
      const doel = join(beeldmap, naam);
      startBrowser(browser, [...vlaggen(thema + "-beeld"), `--screenshot=${doel}`, pathToFileURL(await pagina(thema)).href],
        { encoding: "utf8", timeout: 180_000 });
      assert.ok(existsSync(doel), `schermafbeelding ontbreekt: ${doel}`);
      console.log(`  schermafbeelding: ${doel}`);
    }
  }
  console.log(`${report.tests.length} geslaagd, 0 gefaald`);
} finally {
  // Edge-hulpprocessen kunnen op Windows hun cache nog vasthouden nadat het
  // hoofdproces is gestopt. Een tijdelijk profiel dat dan niet weg kan, mag
  // een geslaagde UI-proef niet alsnog laten falen.
  try {
    rmSync(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
  } catch (error) {
    if (process.platform !== "win32" || !["EBUSY", "EPERM", "EACCES"].includes(error?.code)) throw error;
    console.warn(`Tijdelijk Edge-profiel nog vergrendeld; opruimen overgeslagen: ${folder}`);
  }
}

// Het echte 3D-tekenvlak (ThreeFrameCanvas, WebGL) in een lokale headless
// browser: één klik op of vlak naast een staaf selecteert die staaf, ook in
// de staalhal van 60 × 30 m met dunne buisverbanden; de view cube (groep
// "kubus"), perspectief of parallel (groep "parallel") en de waarden bij de
// snedekrachtlijnen (groep "waarden", issue #95), een lijnlast kiezen en
// markeren (groep "lijnlast", issue #81), scharnierbolletjes op staafeinden,
// het gereedschap Scharnier aan staafeind en het inklemmingsteken (groep
// "scharnier", issue #93), zie scripts/open-fem3d-selectie-browser.tsx. De groep "strikt" draait in een
// ontwikkelbundel: alleen daar voert React StrictMode effecten tweemaal uit.
//
// Met OPEN_FEM3D_SELECTIE_DIAG=1 schrijft de test alleen de telling per
// scenario (hoe vaak één klik de staaf selecteert) en toetst niets.
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
const diag = process.env.OPEN_FEM3D_SELECTIE_DIAG === "1";
const folder = mkdtempSync(join(tmpdir(), "open-fem3d-selectie-ui-"));
try {
  /** Bundel en pagina; `modus` is "production" (de groepen) of "development" (StrictMode). */
  const bouw = async (naam, modus) => {
    const bundle = await build({
      absWorkingDir: dirname(fileURLToPath(import.meta.url)),
      entryPoints: ["scripts/open-fem3d-selectie-browser.tsx"], bundle: true, write: false,
      outfile: join(folder, `${naam}.js`), format: "iife", platform: "browser", jsx: "automatic",
      external: ["fs", "path"],
      loader: { ".ifcfem": "text", ".svg": "dataurl", ".png": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
      define: { "process.env.NODE_ENV": JSON.stringify(modus) },
    });
    for (const file of bundle.outputFiles) writeFileSync(file.path, file.contents);
    // De stijl staat in de pagina zelf: een stylesheet van een file://-adres is
    // voor de pagina niet leesbaar (cssRules), en de kubusproeven lezen de
    // regels (bijv. @media print).
    const css = bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
    const pagina = join(folder, `${naam}.html`);
    writeFileSync(pagina, '<!doctype html><html><head><meta charset="utf-8">' +
      `<style>${css}</style></head><body style="margin:0"><div id="root"></div>` +
      `<pre id="uitslag"></pre><script src="${naam}.js"></script></body></html>`);
    return pagina;
  };
  const html = await bouw("test", "production");
  // WebGL via SwiftShader is traag; elke groep krijgt een eigen browserproces
  // (en daarmee een eigen klok in scripts/headlessBrowser.mjs).
  const draai = async (hash, profiel, pagina = html) => {
    return browserResult(browser, ["--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader", "--no-first-run",
      "--no-default-browser-check", `--user-data-dir=${join(folder, profiel)}`, "--window-size=1100,800",
      `${pathToFileURL(pagina).href}#${hash}`,
    ]);
  };
  if (diag) {
    const report = await draai(process.env.OPEN_FEM3D_SELECTIE_HASH ?? "diag", "profiel-diag");
    console.log(JSON.stringify(report.diag, null, 2));
    assert.equal(report.error, null, report.error);
  } else {
    let totaal = 0;
    // OPEN_FEM3D_SELECTIE_GROEP=kubus (of groot1..groot8, klein, parallel,
    // waarden, lijnlast, scharnier, strikt) draait één groep. De staalhal is
    // per proef gesplitst om de WebGL-werkbelasting per browser te begrenzen.
    const groepen = [...Array.from({ length: 8 }, (_, i) => `groot${i + 1}`), "klein", "kubus", "parallel", "waarden", "lijnlast", "scharnier", "strikt"].filter((g) => !process.env.OPEN_FEM3D_SELECTIE_GROEP || g === process.env.OPEN_FEM3D_SELECTIE_GROEP);
    for (const groep of groepen) {
      const pagina = groep === "strikt" ? await bouw("test-dev", "development") : html;
      const hash = groep.startsWith("groot") ? `groep=groot&test=${groep.slice(5)}` : `groep=${groep}`;
      const report = await draai(hash, `profiel-${groep}`, pagina);
      for (const item of report.tests) console.log(`  ${item.error ? "FAIL" : "ok"} ${item.name}${item.error ? ": " + item.error : ""}`);
      assert.equal(report.error, null, report.error);
      if (groep.startsWith("groot")) assert.equal(report.tests.length, 1, `${groep}: één proef verwacht`);
      assert.equal(report.tests.filter((t) => t.error).length, 0, "3D-selectie-UI regressies");
      totaal += report.tests.length;
    }
    // Schermafbeeldingen (de vervormde vorm, de view cube driemaal vergroot,
    // de scharnierbolletjes en het inklemmingsteken van dichtbij): zet
    // OPEN_FEM3D_SCHERMAFBEELDINGEN op een bestaande map; zonder die variabele
    // wordt er niets gemaakt.
    const map = process.env.OPEN_FEM3D_SCHERMAFBEELDINGEN;
    if (map) {
      assert.ok(existsSync(map), `map voor schermafbeeldingen bestaat niet: ${map}`);
      // De kubusbeelden in een breder venster: de knop ▾ ligt 20 px van de
      // rechterrand van het 1000 px brede tekenvlak, en het zichtbare deel van
      // een venster van 1000 px is in headless Edge net smaller.
      for (const [bestand, beeld, venster] of [
        ["vervormde-vorm.png", "vervormd", "1000,700"], ["view-cube-start.png", "kubus-start", "1100,720"],
        ["view-cube-onder.png", "kubus-onder", "1100,720"], ["view-cube-menu.png", "kubus-menu", "1100,720"],
        ...["scharnier-overzicht", "scharnier-iso", "scharnier-opzij", "scharnier-klein", "scharnier-profiel", "inklemming-iso", "inklemming-opzij", "inklemming-boven",
          "opleggingen-naast-elkaar"].map((beeld) => [`${beeld}.png`, beeld, "1000,700"]),
      ]) {
        const pad = join(map, bestand);
        startBrowser(browser, ["--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader", "--no-first-run",
          "--no-default-browser-check", `--user-data-dir=${join(folder, `profiel-${beeld}`)}`, `--window-size=${venster}`,
          "--hide-scrollbars", "--virtual-time-budget=10000", `--screenshot=${pad}`, `${pathToFileURL(html).href}#beeld=${beeld}`,
        ], { encoding: "utf8", timeout: 90_000 });
        assert.ok(existsSync(pad), `schermafbeelding niet gemaakt: ${pad}`);
        console.log(`  schermafbeelding: ${pad}`);
      }
    }
    console.log(`${totaal} geslaagd, 0 gefaald (${basename(browser)})`);
  }
} finally {
  rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

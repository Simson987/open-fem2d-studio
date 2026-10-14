// Verlopende profielen in 3D (issue #73) in de echte onderdelen, in een lokale
// headless browser: het volume met twee ringen in de profielweergave (en een
// lijn in de hartlijnweergave), het label, kiezen en markeren, de GPU-batch van
// een groot model, het eigenschappenpaneel met de profielkiezer (Verlopend aan,
// eindprofiel bewaard, uitzetten maakt prismatisch), de wizard Stalen hal en
// het VerloopBlok in het rapport. De regels zelf: test-open-fem3d-verlopend.mjs.
// Zie scripts/open-fem3d-verlopend-browser.tsx.
//
// Voor het rapport rekent deze runner eerst de staaltoets van een verlopende
// stalen staaf met de echte kern (toetsbrug, release); zonder die kern faalt
// de test (bouw hem met `cargo build --release -p toetsbrug`).
//
// Schermafbeeldingen (de verlopende spant, de profielkiezer): zet
// OPEN_FEM3D_SCHERMAFBEELDINGEN op een bestaande map; zonder die variabele
// wordt er niets gemaakt.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startBrowser } from "./scripts/headlessBrowser.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const TOETSBRUG = join(resolve(HIER, ".."), "src-tauri", "target", "release", process.platform === "win32" ? "toetsbrug.exe" : "toetsbrug");

const browser = [process.env.OPENAEC_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
].filter(Boolean).find(existsSync);
assert.ok(browser, "Chromium-browser vereist; stel eventueel OPENAEC_BROWSER in");

// De echte staaltoets van een verlopende uitkrager IPE 400 → IPE 200 (de
// krachten van test-verlopend-toetsing.mjs [4]) voor het VerloopBlok.
assert.ok(existsSync(TOETSBRUG), `toetsbrug ontbreekt: ${TOETSBRUG} (cargo build --release -p toetsbrug)`);
let staaltoets = null;
{
  const punten = Array.from({ length: 11 }, (_, i) => ({
    combination_id: 1, position_mm: (i * 6000) / 10,
    forces: { n_ed: 0, vy_ed: 0, vz_ed: 0, mt_ed: 0, my_ed: 200 * (1 - i / 10), mz_ed: 0 },
  }));
  const r = spawnSync(TOETSBRUG, [], {
    input: JSON.stringify({ opdracht: "check_steel_beams", inputs: [{
      beam_id: 3, profile_name: "IPE400", profile_end: "IPE200", steel_grade: "S235", length_m: 6, forces_envelope: punten,
      lateral_bracing: { top_flange_positions: [], bottom_flange_positions: [] },
      deflection_limit_class: "Floor", deflection_limit_numerator: 333, deflection_actual_max_mm: 0,
      is_cantilever: false, consequence_class: "CC2",
    }] }),
    encoding: "utf8", maxBuffer: 64 << 20,
  });
  if (r.status === 0 && r.stdout) staaltoets = JSON.parse(r.stdout)[0];
}
assert.ok(staaltoets, `de toetsbrug gaf geen uitslag voor de verlopende staaf (${TOETSBRUG})`);

const folder = mkdtempSync(join(tmpdir(), "open-fem3d-verlopend-ui-"));
try {
  const bundle = await build({
    absWorkingDir: HIER,
    entryPoints: ["scripts/open-fem3d-verlopend-browser.tsx"], bundle: true, write: false,
    outfile: join(folder, "test.js"), format: "iife", platform: "browser", jsx: "automatic",
    external: ["fs", "path"],
    loader: { ".ifcfem": "text", ".svg": "dataurl", ".png": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  for (const file of bundle.outputFiles) writeFileSync(file.path, file.contents);
  const html = join(folder, "test.html");
  writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8">' +
    '<link rel="stylesheet" href="test.css"></head><body style="margin:0"><div id="root"></div>' +
    `<pre id="uitslag"></pre><script>window.__STAALTOETS = ${JSON.stringify(staaltoets).replace(/</g, "\\u003c")};</script>` +
    '<script src="test.js"></script></body></html>');
  const result = startBrowser(browser, ["--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader", "--no-first-run",
    "--no-default-browser-check", `--user-data-dir=${join(folder, "profiel")}`, "--window-size=1100,800",
    "--virtual-time-budget=60000", "--dump-dom", pathToFileURL(html).href,
  ], { encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
  const match = /<pre id="uitslag">([^<]*)<\/pre>/.exec(result.stdout ?? "");
  assert.ok(match?.[1], result.error?.message ?? result.stderr?.slice(0, 1500) ?? "Geen browserresultaat");
  const report = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
  for (const item of report.tests) console.log(`  ${item.error ? "FAAL" : "ok"} ${item.name}${item.error ? ": " + item.error : ""}`);
  assert.equal(report.error, null, report.error);
  assert.equal(report.tests.filter((t) => t.error).length, 0, "verloop-UI regressies");
  assert.ok(report.tests.length >= 13, `te weinig proeven gedraaid: ${report.tests.length}`);

  const map = process.env.OPEN_FEM3D_SCHERMAFBEELDINGEN;
  if (map) {
    assert.ok(existsSync(map), `map voor schermafbeeldingen bestaat niet: ${map}`);
    for (const [bestand, beeld, venster] of [
      ["verlopend-spant.png", "spant", "1000,700"],
      ["verlopend-kiezer.png", "kiezer", "1100,800"],
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
  console.log(`${report.tests.length} geslaagd, 0 gefaald (${basename(browser)})`);
} finally {
  rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

// Een AI-assistent koppelen (issue #109): het paneel Instellingen →
// AI-assistent (MCP) in de echte onderdelen, in een lokale headless browser
// (scripts/mcp-koppeling-browser.tsx), met alleen de native IPC-grens
// nagebootst. Het pad van de MCP-server, de schakelaar (aan/uit, status,
// event van Rust, een weigering met de opnieuw gelezen status), een kanaal
// dat alleen voor deze sessie aanstaat (gui_start_app of
// OPENAEC_GUI_CONTROL=1: de schakelaar toont de bewaarde keuze, de sessie
// staat apart en is uit te zetten), de knop "Toevoegen aan Claude Desktop"
// (pas na een klik; uitkomst, reservekopie, een vertaalde weigering bij
// ongeldige JSON), de opdracht voor Claude Code, het JSON-fragment, Kopiëren,
// vier talen, de lintknop en het tabblad.
//
// Daarnaast broncontroles: de servernaam en de eventnaam zijn in TypeScript
// en Rust dezelfde, en de vijf commando's staan in generate_handler!.
//
// Schermafbeeldingen (licht en donker, boven en onder): zet MCP_KOPPELING_SCHERMAFBEELDINGEN
// op een bestaande map; zonder die variabele wordt er niets gemaakt.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { browserResult, startBrowser } from "./scripts/headlessBrowser.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const bron = (...pad) => readFileSync(join(HIER, ...pad), "utf8");
let geslaagd = 0;
const check = (naam, voorwaarde, detail = "") => {
  assert.ok(voorwaarde, `${naam}${detail ? " — " + detail : ""}`);
  geslaagd++;
  console.log(`  ok ${naam}`);
};

// ── Broncontroles ───────────────────────────────────────────────────────────

const { MCP_SERVERNAAM, EVENT_KANAAL_STATUS, claudeCodeOpdracht, mcpJsonFragment } = await import("./src/lib/mcpKoppeling.ts");
const koppelingRs = bron("..", "src-tauri", "src", "mcp_koppeling.rs");
const controlRs = bron("..", "src-tauri", "src", "gui_control.rs");
const libRs = bron("..", "src-tauri", "src", "lib.rs");
check("de servernaam is in TypeScript en Rust dezelfde",
  koppelingRs.includes(`pub const SERVERNAAM: &str = "${MCP_SERVERNAAM}";`) && MCP_SERVERNAAM === "open-fem-studio");
check("de eventnaam gui-control:status is in TypeScript en Rust dezelfde",
  controlRs.includes(`pub const EVENT_STATUS: &str = "${EVENT_KANAAL_STATUS}";`));
const handler = /generate_handler!\[([\s\S]*?)\]/.exec(libRs)?.[1] ?? "";
for (const c of ["gui_kanaal_status", "gui_kanaal_aan", "gui_kanaal_uit", "mcp_koppeling_info", "mcp_claude_desktop_toevoegen"]) {
  check(`${c} staat in generate_handler! en als functie in lib.rs`,
    new RegExp(`\\b${c},`).test(handler) && new RegExp(`fn ${c}\\(`).test(libRs));
}
const pad = "C:\\Program Files\\Open FEM Studio\\openaec-mcp-server.exe";
check("de opdracht voor Claude Code", claudeCodeOpdracht(pad) === `claude mcp add --scope user open-fem-studio -- "${pad}"`);
check("het JSON-fragment is geldige JSON met command en lege args",
  JSON.stringify(JSON.parse(mcpJsonFragment(pad))) === JSON.stringify({ mcpServers: { "open-fem-studio": { command: pad, args: [] } } }));
check("de bediening luistert naar het event van de schakelaar",
  /listen<\{ actief: boolean \}>\(EVENT_KANAAL_STATUS/.test(bron("src", "bediening", "bediening.ts")));
check("het lint opent Instellingen op het tabblad AI-assistent (MCP)",
  /onOpenAiAssistant=\{\(\) => openSettings\("aiAssistant"\)\}/.test(bron("src", "App.tsx")));

// ── De browserproef ─────────────────────────────────────────────────────────

const browser = [process.env.OPENAEC_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
].filter(Boolean).find(existsSync);
assert.ok(browser, "Chromium-browser vereist; stel eventueel OPENAEC_BROWSER in");
const folder = mkdtempSync(join(tmpdir(), "mcp-koppeling-ui-"));
try {
  const bundle = await build({
    absWorkingDir: HIER,
    entryPoints: ["scripts/mcp-koppeling-browser.tsx"], bundle: true, write: false,
    outfile: join(folder, "test.js"), format: "iife", platform: "browser", jsx: "automatic",
    external: ["fs", "path"],
    loader: { ".svg": "dataurl", ".png": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  for (const file of bundle.outputFiles) writeFileSync(file.path, file.contents);
  const html = join(folder, "test.html");
  writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8">' +
    '<link rel="stylesheet" href="test.css"></head><body style="margin:0"><div id="root"></div>' +
    '<pre id="uitslag"></pre><script>' +
    'Object.defineProperty(navigator,"language",{configurable:true,value:"nl-NL"});' +
    'Object.defineProperty(navigator,"languages",{configurable:true,value:["nl-NL","nl"]});' +
    '</script><script src="test.js"></script></body></html>');
  // Eerst de beelden (ook als een proef faalt: dan is te zien wat er mis is), dan de proeven.
  const map = process.env.MCP_KOPPELING_SCHERMAFBEELDINGEN;
  if (map) {
    assert.ok(existsSync(map), `map voor schermafbeeldingen bestaat niet: ${map}`);
    for (const beeld of ["licht", "donker", "licht-midden", "donker-midden", "licht-onder", "donker-onder", "licht-sessie", "donker-sessie"]) {
      const png = join(map, `ai-assistent-${beeld}.png`);
      startBrowser(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
        `--user-data-dir=${join(folder, `profiel-${beeld}`)}`, "--window-size=820,640", "--hide-scrollbars",
        "--virtual-time-budget=10000", `--screenshot=${png}`, `${pathToFileURL(html).href}#beeld=${beeld}`,
      ], { encoding: "utf8", timeout: 90_000 });
      assert.ok(existsSync(png), `schermafbeelding niet gemaakt: ${png}`);
      console.log(`  schermafbeelding: ${png}`);
    }
  }
  const report = await browserResult(browser, ["--headless=new", "--disable-gpu", "--no-first-run",
    "--no-default-browser-check", `--user-data-dir=${join(folder, "profiel")}`, "--window-size=1000,800",
    pathToFileURL(html).href,
  ], 90_000);
  for (const item of report.tests) console.log(`  ${item.error ? "FAAL" : "ok"} ${item.name}${item.error ? ": " + item.error : ""}`);
  assert.equal(report.error, null, report.error);
  assert.equal(report.tests.filter((t) => t.error).length, 0, "het paneel AI-assistent (MCP)");
  assert.ok(report.tests.length >= 19, `te weinig proeven gedraaid: ${report.tests.length}`);
  console.log(`${geslaagd + report.tests.length} geslaagd, 0 gefaald (${basename(browser)})`);
} finally {
  rmSync(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}

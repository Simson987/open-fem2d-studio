// ═══════════════════════════════════════════════════════════════════════════
// De API-commando's in de ÉCHTE desktop-app — via de MCP-server.
// ═══════════════════════════════════════════════════════════════════════════
//
// WAT DIT TOETST
// De weg die een MCP-client neemt om de draaiende app te bedienen: een tool
// uit de catalogus (`model3d_node_add`, `app_undo`, …) zonder `project`, door
// de MCP-server over het bedieningskanaal naar de pagina, en daar via
// src/bediening/apiAdapter.ts in de echte stores. Niet de commando's zelf —
// die hebben test-api-*.mjs — maar de aansluiting in App.tsx:
// * elke tool uit de catalogus staat in tools/list;
// * een documentcommando is één stap ongedaan maken in de 3D-editor, en
//   `app_undo`/`app_redo` lopen langs dezelfde weg als Ctrl+Z/Ctrl+Y;
// * levels gaan met het model in dezelfde stap, en komen met undo terug;
// * belastinggevallen gaan via de modelstore (en de standaardcombinaties
//   volgen);
// * `project_new` laadt een leeg project zoals Bestand → Nieuw, zonder bestand
//   (daarna overschrijft opslaan zonder pad het vorige project niet);
// * `app_project_save` schrijft wat de app toont: hetzelfde commando op dat
//   bestand (headless, met `project`) leest hetzelfde model;
// * `app_project_open` zet dat bestand weer in de app; met niet-opgeslagen
//   werk weigeren `project_new` en `app_project_open`, tenzij discardChanges;
// * het stramien (`project_grid_set`) komt in de app;
// * een fout komt met zijn code terug (NIET_GEVONDEN, INVOER_ONGELDIG).
//
// NIET OVERSCHRIJVEN
// Een app die al met bediening draait, blijft ongemoeid: deze rondgang geeft
// zijn eigen app een eigen vindbestand (OPENAEC_GUI_CONTROL_FILE) en een eigen
// WebView2-gegevensmap (WEBVIEW2_USER_DATA_FOLDER), zoals
// wapening-workflow.mjs.
//
// Draaien:  node referentie-gui/api-app.mjs   (vanuit design-mockup/)
// Vereist:  een gebouwde app (OPENAEC_APP of target/release) en
//           cargo build --release -p openaec-mcp-server. Een debugbuild
//           (OPENAEC_APP=…/target/debug/open-fem-studio.exe) laadt de
//           devserver op poort 1440: start die eerst met `npm run dev`.
// Bewaren:  API_APP_BEWAAR=1 laat de werkmap (schermafbeeldingen, project) staan.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HIER, "..", "..");
const EXE = process.platform === "win32" ? ".exe" : "";
const APP = process.env.OPENAEC_APP
  ?? join(REPO, "src-tauri", "target", "release", `open-fem-studio${EXE}`);
const MCP = join(REPO, "src-tauri", "target", "release", `openaec-mcp-server${EXE}`);
const CATALOGUS = join(REPO, "src-tauri", "crates", "openaec-mcp-server", "assets", "api-catalogus.json");
const EXTENSIE = join(REPO, "design-mockup", "test-fixtures", "extensie-voorbeeld");
const IMPORTBESTAND = join(EXTENSIE, "voorbeeld.demofem");
const WERK = join(tmpdir(), `openfem-api-app-${process.pid}`);
const APPDATA_TEST = join(WERK, "appdata");
const VINDBESTAND = join(WERK, "gui-control.json");
const PROJECT = join(WERK, "api-app.ifcfem");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function eis(naam, ok, detail = "") {
  log(`  ${ok ? "✓" : "✗"} ${naam}${detail ? `: ${detail}` : ""}`);
  ok ? passed++ : failed++;
}
const slaap = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Vooraf ──────────────────────────────────────────────────────────────────
for (const [wat, pad] of [["app", APP], ["MCP-server", MCP]]) {
  if (!existsSync(pad)) {
    log(`ONTBREEKT: ${wat} op ${pad}`);
    log(wat === "app"
      ? "  bouw met: npm run tauri build   (of zet OPENAEC_APP naar de geïnstalleerde exe)"
      : "  bouw met: cargo build --release -p openaec-mcp-server   (in src-tauri)");
    process.exit(2);
  }
}
mkdirSync(WERK, { recursive: true });
mkdirSync(APPDATA_TEST, { recursive: true });

// ── De MCP-server over stdio ────────────────────────────────────────────────
class Mcp {
  constructor() {
    this.kind = spawn(MCP, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, APPDATA: APPDATA_TEST, XDG_DATA_HOME: APPDATA_TEST,
        OPENAEC_GUI_CONTROL_FILE: VINDBESTAND, OPENAEC_EXTENSIONS_DIRS: EXTENSIE },
    });
    this.buffer = "";
    this.wachtenden = new Map();
    this.id = 0;
    this.kind.stdout.on("data", (d) => {
      this.buffer += d.toString();
      let i;
      while ((i = this.buffer.indexOf("\n")) >= 0) {
        const regel = this.buffer.slice(0, i).trim();
        this.buffer = this.buffer.slice(i + 1);
        if (!regel) continue;
        let msg; try { msg = JSON.parse(regel); } catch { continue; }
        const w = this.wachtenden.get(msg.id);
        if (w) { this.wachtenden.delete(msg.id); w(msg); }
      }
    });
    this.kind.stderr.on("data", () => {});
  }
  verzoek(method, params) {
    const id = ++this.id;
    this.kind.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((los, weiger) => {
      const t = setTimeout(() => { this.wachtenden.delete(id); weiger(new Error(`${method}: geen antwoord binnen 120 s`)); }, 120_000);
      this.wachtenden.set(id, (msg) => { clearTimeout(t); los(msg); });
    });
  }
  async init() {
    const r = await this.verzoek("initialize", {
      protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: { name: "api-app", version: "0.0.0" },
    });
    if (r.error) throw new Error(`initialize: ${JSON.stringify(r.error)}`);
  }
  /** Roep een tool; een toolfout wordt een Error met de tekst van de app. */
  async tool(name, args = {}) {
    const r = await this.verzoek("tools/call", { name, arguments: args });
    if (r.error) throw new Error(`${name}: ${r.error.message}`);
    if (r.result?.isError) throw new Error(`${name}: ${r.result.content?.[0]?.text ?? "toolfout"}`);
    return r.result?.structuredContent ?? null;
  }
  /** Roep een tool die moet weigeren; geeft de gestructureerde fout, of null als hij slaagde. */
  async weigering(name, args = {}) {
    const r = await this.verzoek("tools/call", { name, arguments: args });
    if (r.error) return { error_code: `JSON-RPC ${r.error.code}`, melding: r.error.message };
    return r.result?.isError ? r.result.structuredContent : null;
  }
  async lijst() {
    const r = await this.verzoek("tools/list", {});
    return (r.result?.tools ?? []).map((t) => t.name);
  }
  stop() { try { this.kind.stdin.end(); this.kind.kill(); } catch {} }
}

// ── De app starten en vinden ────────────────────────────────────────────────
log("═══════════════════════════════════════════════════════════════════════");
log("API-commando's in de desktop-app, via de MCP-server");
log(`  app: ${APP}`);
log("═══════════════════════════════════════════════════════════════════════");

const app = spawn(APP, [], {
  env: {
    ...process.env,
    APPDATA: APPDATA_TEST,
    XDG_DATA_HOME: APPDATA_TEST,
    OPENAEC_GUI_CONTROL: "1",
    OPENAEC_GUI_CONTROL_FILE: VINDBESTAND,
    OPENAEC_EXTENSIONS_DIRS: EXTENSIE,
    WEBVIEW2_USER_DATA_FOLDER: join(WERK, "webview2"),
  },
  stdio: "ignore", detached: false,
});
let vind = null;
for (let i = 0; i < 240 && !vind; i++) {
  await slaap(250);
  try {
    const j = JSON.parse(readFileSync(VINDBESTAND, "utf8"));
    if (j.pid === app.pid) vind = j;
  } catch {}
}
eis("de app schrijft haar eigen vindbestand met haar eigen pid", vind !== null,
  vind ? `poort ${vind.poort}, versie ${vind.versie}` : `niet gevonden op ${VINDBESTAND}`);
if (!vind) { app.kill(); process.exit(1); }

const mcp = new Mcp();
await mcp.init();

// De pagina moet geladen zijn en het kanaal moet de API kennen.
let status = null;
for (let i = 0; i < 240 && !status?.pagina; i++) {
  await slaap(500);
  try { status = await mcp.tool("gui_status"); } catch { status = null; }
}
eis("de pagina antwoordt", !!status?.pagina,
  status?.pagina ? `weergave ${status.pagina.weergave}, versie ${status.versie}, dev ${status.pagina.frontendDevMode}` : "geen status");

/** De uitkomst van een commando in de app: de MCP-server zet hem onder `output`. */
async function inApp(tool, args = {}) {
  const r = await mcp.tool(tool, args);
  if (r?.via !== "app") throw new Error(`${tool}: niet via de app beantwoord (${JSON.stringify(r)?.slice(0, 200)})`);
  return r.output;
}
const schermen = {};
async function scherm(naam) {
  const pad = join(WERK, `${naam}.png`);
  await mcp.tool("gui_screenshot", { window: "main", path: pad, dom: process.platform !== "win32" });
  schermen[naam] = readFileSync(pad);
  return pad;
}

try {
  // ── 1. De catalogus ───────────────────────────────────────────────────────
  log("\n① De catalogus als tools");
  const catalogus = JSON.parse(readFileSync(CATALOGUS, "utf8")).commands;
  const tools = new Set(await mcp.lijst());
  const ontbrekend = catalogus.map((c) => c.name.replaceAll(".", "_")).filter((t) => !tools.has(t));
  eis(`elk van de ${catalogus.length} commando's is een tool`, ontbrekend.length === 0, ontbrekend.join(", "));

  // ── 2. Een leeg project ───────────────────────────────────────────────────
  log("\n② project_new in de app");
  await inApp("project_new");
  const leeg = await inApp("project_get");
  eis("een leeg 3D-project", leeg.modelDimension === "3d" && leeg.counts3d.nodes === 0 && leeg.counts3d.beams === 0,
    JSON.stringify(leeg.counts3d));
  status = await mcp.tool("gui_status");
  eis("de app toont de 3D-editor", status?.pagina?.weergave === "openFem3d", status?.pagina?.weergave);
  await slaap(500);
  await scherm("leeg");

  // ── 3. Tekenen ────────────────────────────────────────────────────────────
  log("\n③ Twee knopen en een staaf");
  const k1 = (await inApp("model3d_node_add", { x: 0, y: 0, z: 0 })).node;
  const k2 = (await inApp("model3d_node_add", { x: 6, y: 0, z: 0 })).node;
  const staaf = (await inApp("model3d_beam_add", { startNodeId: k1.id, endNodeId: k2.id, profileName: "HEA 200", material: "S235" })).beam;
  const getekend = await inApp("model3d_get");
  eis("het model van de app heeft ze", getekend.counts.nodes === 2 && getekend.counts.beams === 1
    && getekend.model.beams[0].profileName === "HEA 200", JSON.stringify(getekend.counts));
  await slaap(500);
  await scherm("staaf");
  eis("het tekenvlak veranderde", !schermen.leeg.equals(schermen.staaf));

  // ── 4. Ongedaan maken ─────────────────────────────────────────────────────
  log("\n④ app_undo en app_redo: één stap per commando");
  await inApp("app_undo");
  let m = await inApp("model3d_get");
  eis("undo: de staaf is weg, de knopen staan er", m.counts.beams === 0 && m.counts.nodes === 2, JSON.stringify(m.counts));
  await inApp("app_undo");
  m = await inApp("model3d_get");
  eis("nog eens: de tweede knoop is weg", m.counts.nodes === 1 && m.model.nodes[0].id === k1.id, JSON.stringify(m.counts));
  await inApp("app_redo");
  await inApp("app_redo");
  m = await inApp("model3d_get");
  eis("twee keer redo: alles terug, met dezelfde ids", m.counts.nodes === 2 && m.counts.beams === 1
    && m.model.beams[0].id === staaf.id, JSON.stringify(m.counts));

  // ── 5. Levels ─────────────────────────────────────────────────────────────
  log("\n⑤ Levels in dezelfde stap");
  const voor = (await inApp("model3d_levels_get")).levels;
  await inApp("model3d_levels_set", { levels: [{ label: "Maaiveld", heightM: 0 }, { label: "Verdieping", heightM: 3.5 }] });
  const na = (await inApp("model3d_levels_get")).levels;
  eis("twee levels", na.length === 2 && na[1].heightM === 3.5, JSON.stringify(na));
  await inApp("app_undo");
  const terug = (await inApp("model3d_levels_get")).levels;
  eis("undo zet de levels van vóór terug", JSON.stringify(terug) === JSON.stringify(voor), `${JSON.stringify(voor)} → ${JSON.stringify(terug)}`);
  await inApp("app_redo");
  eis("redo zet ze weer", JSON.stringify((await inApp("model3d_levels_get")).levels) === JSON.stringify(na));

  // ── 6. Belastinggevallen ──────────────────────────────────────────────────
  log("\n⑥ Een belastinggeval via de modelstore");
  const gevallenVoor = (await inApp("project_get")).loadCases.length;
  const geval = await inApp("project_loadCase_add", { name: "Sneeuwophoping", type: "snow" });
  const project = await inApp("project_get");
  eis("het geval staat in het project", project.loadCases.length === gevallenVoor + 1
    && project.loadCases.some((lc) => lc.name === "Sneeuwophoping"), JSON.stringify(geval));
  eis("de standaardcombinaties nemen het mee", project.combinations.some((c) =>
    Object.keys(c.factors ?? {}).map(Number).includes(geval.loadCase.id)), `${project.combinations.length} combinaties`);

  // ── 7. Opslaan, en headless hetzelfde lezen ───────────────────────────────
  log("\n⑦ app_project_save, en het bestand headless");
  const opgeslagen = await inApp("app_project_save", { path: PROJECT });
  eis("opgeslagen op het gevraagde pad", opgeslagen.path === PROJECT && existsSync(PROJECT), opgeslagen.path);
  const inDeApp = await inApp("model3d_get");
  const headless = await mcp.tool("model3d_get", { project: PROJECT, save: false });
  eis("headless leest hetzelfde 3D-model als de app toont",
    JSON.stringify(headless?.output?.model) === JSON.stringify(inDeApp.model), JSON.stringify(headless?.output?.counts));
  const headlessProject = await mcp.tool("project_get", { project: PROJECT, save: false });
  eis("en dezelfde belastinggevallen", JSON.stringify(headlessProject?.output?.loadCases) === JSON.stringify(project.loadCases));

  // ── 8. Fouten ─────────────────────────────────────────────────────────────
  log("\n⑧ Fouten komen met hun code terug");
  const nietGevonden = await mcp.weigering("model3d_node_delete", { id: 999 });
  eis("een onbekende knoop: NIET_GEVONDEN", nietGevonden?.error_code === "NIET_GEVONDEN", nietGevonden?.melding);
  const ongeldig = await mcp.weigering("model3d_node_add", { x: "nul", y: 0, z: 0 });
  eis("een tekst als coördinaat: INVOER_ONGELDIG", ongeldig?.error_code === "INVOER_ONGELDIG", ongeldig?.melding);
  const nogSteeds = await inApp("model3d_get");
  eis("en het model bleef staan", nogSteeds.counts.nodes === 2 && nogSteeds.counts.beams === 1);

  // ── 9. Een nieuw project heeft geen bestand ───────────────────────────────
  // Anders zou Opslaan (of app_project_save zonder pad) het vorige project
  // overschrijven met het nieuwe, lege.
  log("\n⑨ project_new laat het vorige bestand los");
  const bestandVoor = readFileSync(PROJECT, "utf8");
  await inApp("project_new");
  const zonderPad = await mcp.weigering("app_project_save", {});
  eis("opslaan zonder pad vraagt om een pad", zonderPad?.error_code === "GEWEIGERD" && /path/.test(zonderPad?.melding ?? ""),
    zonderPad ? `${zonderPad.error_code}: ${zonderPad.melding}` : "het werd opgeslagen");
  eis("het vorige bestand is onveranderd", readFileSync(PROJECT, "utf8") === bestandVoor);

  // ── 10. Openen, en niet-opgeslagen werk ───────────────────────────────────
  log("\n⑩ app_project_open, en wat er gebeurt met niet-opgeslagen werk");
  const geopend = await inApp("app_project_open", { path: PROJECT });
  const weerTerug = await inApp("model3d_get");
  eis("het opgeslagen project staat weer in de app", geopend.path === PROJECT && weerTerug.counts.nodes === 2 && weerTerug.counts.beams === 1
    && JSON.stringify(weerTerug.model) === JSON.stringify(inDeApp.model), JSON.stringify(weerTerug.counts));
  await inApp("model3d_node_add", { x: 0, y: 5, z: 0 });
  const nieuwGeweigerd = await mcp.weigering("project_new", {});
  eis("met niet-opgeslagen werk weigert project_new", nieuwGeweigerd?.error_code === "GEWEIGERD" && /discardChanges/.test(nieuwGeweigerd?.melding ?? ""),
    nieuwGeweigerd ? `${nieuwGeweigerd.error_code}: ${nieuwGeweigerd.melding}` : "het nieuwe project werd geladen");
  const openGeweigerd = await mcp.weigering("app_project_open", { path: PROJECT });
  eis("en app_project_open ook", openGeweigerd?.error_code === "GEWEIGERD", openGeweigerd?.melding ?? "het bestand werd geopend");
  eis("het werk staat er nog", (await inApp("model3d_get")).counts.nodes === 3);
  await inApp("app_project_open", { path: PROJECT, discardChanges: true });
  eis("met discardChanges: het bestand vervangt het werk", (await inApp("model3d_get")).counts.nodes === 2);

  // ── 11. Het stramien in de app ────────────────────────────────────────────
  log("\n⑪ project_grid_set in de app");
  await inApp("project_grid_set", { xAxes: [{ label: "A", positionM: 0 }, { label: "B", positionM: 6 }], yAxes: [{ label: "1", positionM: 0 }] });
  const stramien = await inApp("project_grid_get");
  eis("de app heeft het nieuwe stramien", stramien.xAxes.map((as) => `${as.label}@${as.positionM}`).join() === "A@0,B@6"
    && stramien.yAxes.length === 1, JSON.stringify(stramien));

  // ── 12. Lokale importextensie via de echte app ────────────────────────────
  log("\n⑫ app_project_import via de voorbeeldextensie");
  const extensies = await inApp("extensions_list");
  eis("de voorbeeldextensie is ingeschakeld", extensies.extensions.some((e) =>
    e.id === "org.openaec.voorbeeld" && e.enabled && e.importers.some((i) => i.fileExtensions.includes("demofem"))),
    JSON.stringify(extensies.extensions));
  const importantwoord = await inApp("app_project_import", { path: IMPORTBESTAND, discardChanges: true });
  eis("de import geeft extensie en verslag terug", importantwoord.project === "nieuw"
    && importantwoord.extension.id === "org.openaec.voorbeeld" && importantwoord.messages.length === 2,
    JSON.stringify(importantwoord));
  const zonderImportpad = await mcp.weigering("app_project_save", {});
  eis("het geïmporteerde project heeft nog geen opslagpad", zonderImportpad?.error_code === "GEWEIGERD",
    zonderImportpad?.melding ?? "het werd opgeslagen");
  const importDoel = join(WERK, "geimporteerd.ifcfem");
  await inApp("app_project_save", { path: importDoel });
  const importProject = JSON.parse(readFileSync(importDoel, "utf8"));
  eis("Opslaan bewaart het 2D-project met vier knopen en drie staven", importProject.modelDimension === "2d"
    && importProject.nodes.length === 4 && importProject.beams.length === 3,
    `${importProject.nodes.length} knopen, ${importProject.beams.length} staven`);
} catch (e) {
  failed++;
  log(`  ✗ afgebroken: ${e instanceof Error ? e.message : String(e)}`);
}

// ── 13. Afsluiten en opruimen ───────────────────────────────────────────────
log("\n⑬ Afsluiten");
try {
  const q = await mcp.tool("gui_quit");
  eis("gui_quit wordt bevestigd", q?.afgesloten === true);
} catch (e) {
  eis("gui_quit wordt bevestigd", false, e.message);
}
let weg = false;
for (let i = 0; i < 40 && !weg; i++) { await slaap(250); weg = !existsSync(VINDBESTAND); }
eis("de app ruimde gui-control.json op", weg);
if (!app.killed && app.exitCode === null) { await slaap(1000); try { app.kill(); } catch {} }
mcp.stop();
if (failed === 0 && !process.env.API_APP_BEWAAR) {
  // De WebView2-processen laten hun gegevensmap pas even na het afsluiten los.
  for (let i = 0; i < 60 && existsSync(WERK); i++) {
    try { rmSync(WERK, { recursive: true, force: true }); } catch { await slaap(500); }
  }
  if (existsSync(WERK)) log(`\n  MELDING: de werkmap ${WERK} kon niet worden opgeruimd.`);
} else {
  log(`\n  De schermafbeeldingen en het projectbestand van deze rondgang staan in ${WERK}.`);
}

log("\n═══════════════════════════════════════════════════════════════════════");
log(`api-app: ${passed} geslaagd, ${failed} gefaald.`);
process.exit(failed === 0 ? 0 : 1);

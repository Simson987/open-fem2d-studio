// Bestandskoppeling (issue #90): een .ifcfem of .ifcfem2d openen met een
// dubbelklik, ook als de app al draait.
//
// De keten: de installer koppelt beide extensies aan de app (tauri.conf.json,
// bundle.fileAssociations). Windows en Linux geven het pad als argument; macOS
// als RunEvent::Opened. Rust haalt de bestanden eruit
// (src-tauri/src/bestandskoppeling.rs, met eigen tests in
// src-tauri/tests/bestandskoppeling.rs), geeft precies die paden vrij in de
// fs-scope en zet ze in een wachtrij. De pagina haalt de wachtrij op bij het
// starten en na elk event, en opent elk pad langs de BESTAANDE weg
// (`handleOpenFilePath`: de vraag over niet-opgeslagen werk, recente
// bestanden, de juiste werkruimte). Draait de app al, dan geeft
// tauri-plugin-single-instance de argumenten van de tweede start door en
// stopt die tweede start.
//
//   [1] welk pad een projectbestand is (extensie, hoofdletters, spaties)
//   [2] de interfacekant met een nagebootste Rust-kant: wachtrij, event,
//       volgorde, onbekende extensie, fouten, stoppen (React StrictMode), en
//       de vraagpoort: een bestand dat binnenkomt terwijl de vraag over
//       niet-opgeslagen werk al openstaat, wacht in plaats van weg te vallen
//   [3] de bedrading in App.tsx: de bestaande open-weg met de vraag, de
//       vraagpoort, en welkomstscherm en backstage dicht vóór het openen
//       (de recente bestanden bij meerdere paden in één ronde toetst
//       test-bestandskoppeling-recent.mjs in Chromium)
//   [4] tauri.conf.json koppelt beide extensies, met alleen bestaande velden
//   [5] Rust: single-instance als eerste plugin, command en event gelijk aan
//       de pagina, opstarten (argv als OsString), tweede start en macOS, en
//       wanneer er één venster bewaakt wordt
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const lees = (...p) => readFileSync(join(HIER, ...p), "utf8").replace(/\r\n/g, "\n");
/** Laat alle wachtende microtaken en een macrotaak lopen. */
const rust = () => new Promise((r) => setTimeout(r, 0));

const {
  isProjectbestand, startBestandskoppeling, maakWachtpoort, EVENT_BESTANDEN, COMMANDO_OPHALEN, bestandsnaam,
} = await import("./src/io/bestandskoppeling.ts");
const { PROJECT_FILE_EXTS } = await import("./src/io/projectFile.ts");

// ── [1] ─────────────────────────────────────────────────────────────────────
log("[1] welk pad een projectbestand is");
check("dezelfde extensies als Openen en de recente bestanden", JSON.stringify(PROJECT_FILE_EXTS) === JSON.stringify(["ifcfem", "ifcfem2d"]));
for (const pad of ["C:\\werk\\hal.ifcfem", "C:\\werk\\ligger.ifcfem2d", "C:\\Mijn projecten\\Hal 2 - DEF.IFCFEM",
  "\\\\server\\share\\oud.IfcFem2d", "/home/ik/hal v2.ifcfem"]) {
  check(`project: ${pad}`, isProjectbestand(pad) === true);
}
for (const pad of ["C:\\werk\\hal.ifcfem.bak", "C:\\werk\\gebouw.ifc", "C:\\werk\\notities.txt", "C:\\werk\\ifcfem",
  "C:\\werk.ifcfem\\leeg", ""]) {
  check(`geen project: ${JSON.stringify(pad)}`, isProjectbestand(pad) === false);
}
check("bestandsnaam: laatste deel, beide scheidingstekens",
  bestandsnaam("C:\\werk\\hal 2.ifcfem") === "hal 2.ifcfem" && bestandsnaam("/home/ik/x.txt") === "x.txt");

// ── [2] ─────────────────────────────────────────────────────────────────────
log("\n[2] de interfacekant, met een nagebootste Rust-kant");

/** Rust in het klein: een wachtrij die bij ophalen leegloopt, en een event. */
function nepRust() {
  const r = {
    rij: [], luisteraars: new Set(), opgehaald: 0, afgemeld: 0,
    meld(...paden) { r.rij.push(...paden); for (const f of r.luisteraars) f(); },
    haalOp: async () => { r.opgehaald++; return r.rij.splice(0); },
    luister: async (bij) => { r.luisteraars.add(bij); return () => { r.luisteraars.delete(bij); r.afgemeld++; }; },
  };
  return r;
}
function app({ open } = {}) {
  const a = {
    geopend: [], meldingen: [],
    open: open ?? (async (pad) => { a.geopend.push(pad); }),
    meldGeenProject: (pad) => { a.meldingen.push(pad); },
  };
  return a;
}

{
  // Eerste start: Rust zette het pad uit argv al in de wachtrij vóór de pagina luisterde.
  const r = nepRust(); const a = app();
  r.rij.push("C:\\werk\\hal.ifcfem");
  const k = startBestandskoppeling({ haalOp: r.haalOp, luister: r.luister, open: a.open, meldGeenProject: a.meldGeenProject });
  await k.gereed;
  check("een pad van vóór het laden opent na het laden", JSON.stringify(a.geopend) === JSON.stringify(["C:\\werk\\hal.ifcfem"]), JSON.stringify(a.geopend));
  check("… en luistert daarna naar het event", r.luisteraars.size === 1);

  // Tweede start terwijl de app draait: Rust meldt het met een event.
  r.meld("D:\\Projecten met spatie\\Loods.IFCFEM2D");
  await rust();
  check("een gemeld pad gaat naar de bestaande open-functie, ongewijzigd",
    a.geopend[1] === "D:\\Projecten met spatie\\Loods.IFCFEM2D", JSON.stringify(a.geopend));

  // Een ander bestandstype ("Openen met"): melding, niet openen.
  r.meld("C:\\werk\\notities.txt");
  await rust();
  check("onbekende extensie: een melding, geen opening",
    JSON.stringify(a.meldingen) === JSON.stringify(["C:\\werk\\notities.txt"]) && a.geopend.length === 2);

  // Ophalen leegt de wachtrij: geen pad twee keer, ook niet bij een dubbel event.
  r.meld("C:\\werk\\a.ifcfem");
  for (const f of r.luisteraars) f();
  await rust();
  check("elk pad één keer, ook als het event dubbel komt", a.geopend.filter((p) => p === "C:\\werk\\a.ifcfem").length === 1);

  k.stop();
  check("stoppen meldt de luisteraar af", r.luisteraars.size === 0 && r.afgemeld === 1);
}

{
  // Twee bestanden kort na elkaar: het tweede wacht tot het eerste klaar is,
  // anders zouden twee vragen over niet-opgeslagen werk door elkaar lopen.
  const r = nepRust();
  const lopend = [];
  const a = app({
    open: (pad) => new Promise((klaar) => { lopend.push({ pad, klaar }); }),
  });
  const k = startBestandskoppeling({ haalOp: r.haalOp, luister: r.luister, open: a.open, meldGeenProject: a.meldGeenProject });
  await k.gereed;
  r.meld("C:\\werk\\eerste.ifcfem");
  r.meld("C:\\werk\\tweede.ifcfem");
  await rust();
  check("het tweede bestand wacht op het eerste", lopend.length === 1 && lopend[0].pad.endsWith("eerste.ifcfem"), JSON.stringify(lopend.map((l) => l.pad)));
  lopend[0].klaar();
  await rust(); await rust();
  check("… en opent daarna", lopend.length === 2 && lopend[1].pad.endsWith("tweede.ifcfem"));
  lopend[1].klaar();
  k.stop();
}

{
  // Een fout bij ophalen of openen breekt de keten niet.
  const r = nepRust(); const a = app();
  let eerste = true;
  const haalOp = async () => { if (eerste) { eerste = false; throw new Error("geen Tauri"); } return r.haalOp(); };
  const fouten = [];
  const oudeFout = console.error; console.error = (...x) => fouten.push(x.join(" "));
  try {
    const open = async (pad) => { if (pad.includes("kapot")) throw new Error("kapot"); a.geopend.push(pad); };
    const k = startBestandskoppeling({ haalOp, luister: r.luister, open, meldGeenProject: a.meldGeenProject });
    await k.gereed;
    r.meld("C:\\werk\\kapot.ifcfem", "C:\\werk\\heel.ifcfem");
    await rust(); await rust();
    check("na een fout bij ophalen en bij openen gaat het volgende pad gewoon open",
      JSON.stringify(a.geopend) === JSON.stringify(["C:\\werk\\heel.ifcfem"]), JSON.stringify(a.geopend));
    check("… en de fouten staan in de console", fouten.length === 2, JSON.stringify(fouten));
    k.stop();
  } finally {
    console.error = oudeFout;
  }
}

{
  // React StrictMode: het effect start, stopt meteen en start opnieuw. De
  // eerste start mag de wachtrij niet leeghalen, anders is het pad weg.
  const r = nepRust(); const a = app();
  r.rij.push("C:\\werk\\hal.ifcfem");
  const eerste = startBestandskoppeling({ haalOp: r.haalOp, luister: r.luister, open: a.open, meldGeenProject: a.meldGeenProject });
  eerste.stop();
  const tweede = startBestandskoppeling({ haalOp: r.haalOp, luister: r.luister, open: a.open, meldGeenProject: a.meldGeenProject });
  await eerste.gereed; await tweede.gereed;
  check("gestopt vóór het luisteren: geen luisteraar over, niets opgehaald",
    r.luisteraars.size === 1 && r.opgehaald === 1, `luisteraars ${r.luisteraars.size}, opgehaald ${r.opgehaald}`);
  check("… en de tweede start opent het pad één keer", JSON.stringify(a.geopend) === JSON.stringify(["C:\\werk\\hal.ifcfem"]));
  tweede.stop();
}

{
  // De vraagpoort op zich: open → meteen verder; dicht → wachten, ook na een
  // melding terwijl hij nog dicht is; open en gemeld → verder.
  let dicht = false;
  const poort = maakWachtpoort(() => dicht);
  let verder = false;
  await poort.wacht().then(() => { verder = true; });
  check("vraagpoort: open poort laat meteen door", verder);
  dicht = true; verder = false;
  const wachten = poort.wacht().then(() => { verder = true; });
  await rust();
  check("vraagpoort: dichte poort houdt tegen", !verder);
  poort.misschienOpen();
  await rust();
  check("… ook na een melding terwijl hij nog dicht is", !verder);
  dicht = false; poort.misschienOpen();
  await wachten;
  check("… en laat door als hij open is en gemeld", verder);
}

/**
 * De sluitbeveiliging van App.tsx in het klein: een vraag over niet-opgeslagen
 * werk die er maar één keer tegelijk kan zijn (`confirmUnsavedAction` geeft
 * `false` zolang er een openstaat), het kruisje dat die vraag stelt, en de
 * open-weg van de koppeling die eerst op de vraagpoort wacht.
 */
function nepApp() {
  const a = {
    vraagOpen: false, sluitOpen: false, gesloten: false, geopend: [], vragen: 0,
    /** Het antwoord dat de gebruiker op de volgende vraag geeft. */
    antwoorden: [],
    lopendeVraag: null,
  };
  a.poort = maakWachtpoort(() => a.vraagOpen || a.sluitOpen);
  a.bevestig = async () => {
    if (a.vraagOpen) return false;
    a.vraagOpen = true; a.vragen++;
    try {
      return await new Promise((antwoord) => { a.lopendeVraag = antwoord; });
    } finally {
      a.vraagOpen = false; a.lopendeVraag = null;
      a.poort.misschienOpen();
    }
  };
  a.kruisje = async () => {
    a.sluitOpen = true;
    const doorgaan = await a.bevestig();
    if (doorgaan) { a.gesloten = true; return; }
    a.sluitOpen = false;
    a.poort.misschienOpen();
  };
  // handleOpenFilePath: eerst de vraag, dan laden.
  a.handleOpenFilePath = async (pad) => {
    if (!(await a.bevestig())) return;
    a.geopend.push(pad);
  };
  // openUitBestandskoppeling: wachten op de poort, dan de bestaande weg.
  a.openUitKoppeling = async (pad) => {
    await a.poort.wacht();
    await a.handleOpenFilePath(pad);
  };
  return a;
}

{
  // Zonder poort valt het bestand stil weg: confirmUnsavedAction zegt "nee"
  // zolang de vraag van het kruisje openstaat. Met de poort wacht het, en na
  // Annuleren opent het, met een eigen vraag.
  const r = nepRust(); const a = nepApp();
  const k = startBestandskoppeling({ haalOp: r.haalOp, luister: r.luister, open: a.openUitKoppeling, meldGeenProject: () => {} });
  await k.gereed;
  const sluiten = a.kruisje();
  await rust();
  check("het kruisje stelt de vraag over niet-opgeslagen werk", a.vraagOpen && a.vragen === 1);
  r.meld("C:\\werk\\binnen-tijdens-vraag.ifcfem");
  await rust();
  check("een bestand dat binnenkomt terwijl die vraag openstaat, wacht (geen tweede vraag, niet geopend)",
    a.vragen === 1 && a.geopend.length === 0 && r.rij.length === 0);
  a.lopendeVraag(false); // Annuleren
  await sluiten; await rust(); await rust();
  check("na Annuleren komt de vraag voor het bestand", a.vragen === 2 && a.vraagOpen, `vragen ${a.vragen}`);
  a.lopendeVraag(true); // Niet opslaan
  await rust(); await rust();
  check("… en daarna opent het bestand", JSON.stringify(a.geopend) === JSON.stringify(["C:\\werk\\binnen-tijdens-vraag.ifcfem"]), JSON.stringify(a.geopend));
  k.stop();
}

{
  // Kiest de gebruiker bij het kruisje Opslaan of Niet opslaan, dan sluit de
  // app: het bestand opent niet en er komt geen tweede vraag.
  const r = nepRust(); const a = nepApp();
  const k = startBestandskoppeling({ haalOp: r.haalOp, luister: r.luister, open: a.openUitKoppeling, meldGeenProject: () => {} });
  await k.gereed;
  const sluiten = a.kruisje();
  await rust();
  r.meld("C:\\werk\\te-laat.ifcfem");
  await rust();
  a.lopendeVraag(true);
  await sluiten; await rust(); await rust();
  check("de app sluit: geen tweede vraag en niets geopend", a.gesloten && a.vragen === 1 && a.geopend.length === 0);
  k.stop();
}

// ── [3] ─────────────────────────────────────────────────────────────────────
log("\n[3] de bedrading in App.tsx");
const appBron = lees("src", "App.tsx");
const hookBron = lees("src", "hooks", "useBestandskoppeling.ts");
const koppelOpenBlok = /const openUitBestandskoppeling = useCallback\(async \(path: string\) => \{[\s\S]*?\n  \}, \[handleOpenFilePath\]\);/.exec(appBron)?.[0] ?? "";
check("App geeft de bestandskoppeling een eigen open-functie", /useBestandskoppeling\(openUitBestandskoppeling, recenteBestandenGeladen\);/.test(appBron));
check("… die wacht op de vraagpoort, dan welkomstscherm en backstage sluit, dan handleOpenFilePath aanroept",
  /^const openUitBestandskoppeling[^\n]*\n    await vraagpoortRef\.current\?\.wacht\(\);\n    setWelcomeOpen\(false\);\n    setBackstageOpen\(false\);\n    await handleOpenFilePath\(path\);\n/.test(koppelOpenBlok),
  koppelOpenBlok.slice(0, 240));
check("… ná de definitie van handleOpenFilePath",
  appBron.indexOf("const openUitBestandskoppeling") > appBron.indexOf("const handleOpenFilePath = useCallback")
  && appBron.indexOf("useBestandskoppeling(openUitBestandskoppeling") > appBron.indexOf("const openUitBestandskoppeling"));
check("de vraagpoort is dicht zolang de vraag over niet-opgeslagen werk of de sluitvraag openstaat",
  /const vraagpoortRef = useRef<Wachtpoort \| null>\(null\);\n  if \(vraagpoortRef\.current === null\) \{\n    vraagpoortRef\.current = maakWachtpoort\(\s*\(\) => unsavedConfirmationPendingRef\.current \|\| closeRequestPendingRef\.current,\s*\);\n  \}/.test(appBron));
const bevestigBlok = /const confirmUnsavedAction = useCallback\([\s\S]*?\n  \}, \[[^\]]*\]\);/.exec(appBron)?.[0] ?? "";
check("… en gaat na elke beantwoorde vraag weer open (finally van confirmUnsavedAction)",
  /\} finally \{\n      unsavedConfirmationPendingRef\.current = false;\n      vraagpoortRef\.current\?\.misschienOpen\(\);\n    \}/.test(bevestigBlok));
check("… en na Annuleren bij het kruisje",
  /if \(!proceed\) \{\n              event\.preventDefault\(\);\n              closeRequestPendingRef\.current = false;\n[^\n]*\n              vraagpoortRef\.current\?\.misschienOpen\(\);/.test(appBron));
check("closeRequestPendingRef staat één keer gedeclareerd", (appBron.match(/const closeRequestPendingRef = useRef/g) ?? []).length === 1);
// addRecentFile bouwt de nieuwe lijst op de state van de hook; opent er een
// bestand vóór die uit de store geladen is, dan overschrijft het de bewaarde
// lijst met alleen dit ene bestand. Dus: pas starten als de lijst er is.
check("… en pas als de recente bestanden geladen zijn",
  /const \{ addRecentFile, loaded: recenteBestandenGeladen \} = useRecentFiles\(\);/.test(appBron)
  && /if \(!klaar \|\| !isTauriApp\(\)\) return;/.test(hookBron) && /\}, \[klaar\]\);/.test(hookBron));
const openBlok = /const handleOpenFilePath = useCallback\(async \(path: string\) => \{[\s\S]*?\n  \}, \[pasProjectToe, confirmUnsavedAction\]\);/.exec(appBron)?.[0] ?? "";
check("handleOpenFilePath vraagt eerst naar niet-opgeslagen werk", /^const handleOpenFilePath[^\n]*\n    if \(!\(await confirmUnsavedAction\(\)\)\) return;/.test(openBlok), openBlok.slice(0, 160));
check("… en laadt langs pasProjectToe met het pad (recente bestanden, werkruimte)", /pasProjectToe\(deserializeProject\(text\), path\)/.test(openBlok));
const toepasBlok = /const pasProjectToe = useCallback\([\s\S]*?\n  \);/.exec(appBron)?.[0] ?? "";
check("pasProjectToe kiest 2D of 3D uit het bestand", /setModelDimension\(volgendeDimensie\)/.test(toepasBlok) && /setActiveView\(volgendeDimensie === "3d"/.test(toepasBlok));
check("pasProjectToe zet het pad in de recente bestanden", /addRecentFile\(path\)/.test(toepasBlok));
check("de hook haalt op met het command en luistert naar het event",
  /invoke<string\[\]>\(COMMANDO_OPHALEN\)/.test(hookBron) && /listen\(EVENT_BESTANDEN/.test(hookBron));
check("de hook doet niets buiten Tauri (browserstand)", /if \(!klaar \|\| !isTauriApp\(\)\) return;/.test(hookBron));
check("de hook meldt een ander bestandstype via i18n",
  /common:app\.file\.notAProjectTitle/.test(hookBron) && /common:app\.file\.notAProjectBody/.test(hookBron));
for (const taal of ["nl", "en", "de", "fr"]) {
  const file = JSON.parse(lees("src", "i18n", "locales", taal, "common.json")).app?.file ?? {};
  check(`${taal}: melding bij een ander bestandstype, met {{naam}}`,
    typeof file.notAProjectTitle === "string" && file.notAProjectTitle.length > 0 && /\{\{naam\}\}/.test(file.notAProjectBody ?? ""));
}

// ── [4] ─────────────────────────────────────────────────────────────────────
log("\n[4] de installer koppelt beide extensies");
const conf = JSON.parse(lees("..", "src-tauri", "tauri.conf.json"));
const koppelingen = conf.bundle?.fileAssociations ?? [];
for (const ext of PROJECT_FILE_EXTS) {
  const k = koppelingen.find((f) => (f.ext ?? []).includes(ext));
  check(`.${ext} is gekoppeld`, Boolean(k));
  check(`… met naam, omschrijving en rol Editor`, Boolean(k?.name && k?.description) && k?.role === "Editor", JSON.stringify(k));
}
const namen = koppelingen.map((k) => k.name);
check("elke koppeling een eigen naam (NSIS gebruikt hem als registerklasse)", new Set(namen).size === namen.length, JSON.stringify(namen));
check("de naam is een geldige ProgID: letters, cijfers en punten, ≤ 39 tekens, geen cijfer vooraan",
  namen.every((n) => /^[A-Za-z][A-Za-z0-9.]{0,38}$/.test(n ?? "")), JSON.stringify(namen));
const schemaPad = join(HIER, "..", "node_modules", "@tauri-apps", "cli", "config.schema.json");
if (!existsSync(schemaPad)) {
  log("  · overgeslagen: het configschema van de Tauri-CLI staat niet in node_modules (root: npm install)");
} else {
  const schema = JSON.parse(readFileSync(schemaPad, "utf8"));
  const velden = Object.keys(schema.definitions.FileAssociation.properties);
  const typeVelden = Object.keys(schema.definitions.ExportedFileAssociation.properties);
  for (const k of koppelingen) {
    const vreemd = Object.keys(k).filter((v) => !velden.includes(v));
    check(`.${k.ext} gebruikt alleen velden die de CLI kent`, vreemd.length === 0, vreemd.join(", "));
    const vreemdType = Object.keys(k.exportedType ?? {}).filter((v) => !typeVelden.includes(v));
    check(`… ook in exportedType`, vreemdType.length === 0, vreemdType.join(", "));
  }
}
const winConf = JSON.parse(lees("..", "src-tauri", "tauri.windows.conf.json"));
check("tauri.windows.conf.json vervangt de koppelingen niet (arrays worden bij samenvoegen vervangen)",
  winConf.bundle?.fileAssociations === undefined);
check("WebView2 blijft: embedBootstrapper en WebView2Loader.dll in beide configs",
  [conf, winConf].every((c) => c.bundle?.windows?.webviewInstallMode?.type === "embedBootstrapper"
    && (c.bundle?.resources ?? []).includes("WebView2Loader.dll")));

// ── [5] ─────────────────────────────────────────────────────────────────────
log("\n[5] Rust: één venster, opstarten, tweede start, macOS");
const lib = lees("..", "src-tauri", "src", "lib.rs");
const koppelRs = lees("..", "src-tauri", "src", "bestandskoppeling.rs");
const run = lib.slice(lib.indexOf("pub fn run()"));
const eerstePlugin = /\.plugin\(([a-z_]+)/.exec(run)?.[1];
check("single-instance is de eerste plugin", eerstePlugin === "tauri_plugin_single_instance", String(eerstePlugin));
check("… met de tweede start naar de bestandskoppeling", /tauri_plugin_single_instance::init\(\|app, argv, werkmap\| \{\s*bestandskoppeling::tweede_start\(app, &argv, &werkmap\);/.test(run));
check("bij het opstarten: argv van deze start", /bestandskoppeling::eerste_start\(app\.handle\(\)\)/.test(run));
// std::env::args() raakt in paniek op een argument dat geen geldige Unicode
// is; dan zou een dubbelklik op zo'n bestand de app bij het starten laten
// vallen. De Rust-test toetst het filter met zulke argumenten.
const eersteStart = /pub fn eerste_start[\s\S]*?\n\}/.exec(koppelRs)?.[0] ?? "";
// Alleen code, geen commentaar: dat mag uitleggen waarom args() niet kan.
const koppelRsCode = koppelRs.split("\n").filter((r) => !/^\s*\/\//.test(r)).join("\n");
check("… gelezen met std::env::args_os(), niet met args()",
  /std::env::args_os\(\)/.test(eersteStart) && /bestanden_uit_argv_os\(/.test(eersteStart)
  && !/std::env::args\(\)/.test(koppelRsCode));
check("één venster: niet alleen bij het bedieningskanaal, maar bij kanaal én eigen vindbestand",
  /een_instantie_bewaken\(\s*cfg!\(debug_assertions\),\s*gui_control::gevraagd\(\),\s*gui_control::eigen_vindbestand\(\)\.is_some\(\),\s*bestandskoppeling::in_debug_gevraagd\(\),\s*\)/.test(run));
const mcpReadme = lees("..", "src-tauri", "crates", "openaec-mcp-server", "README.md");
check("de README van de MCP-server noemt het ene venster en OPENAEC_GUI_CONTROL_FILE voor een aparte instantie",
  /single window/.test(mcpReadme) && /separate\s+instance[\s\S]{0,200}its own\s+`OPENAEC_GUI_CONTROL_FILE`/.test(mcpReadme));
check("macOS: RunEvent::Opened gaat dezelfde weg", /RunEvent::Opened \{ urls \}[\s\S]{0,200}bestandskoppeling::geopend\(app, urls\)/.test(run));
const handler = /generate_handler!\[([\s\S]*?)\]/.exec(lib)?.[1] ?? "";
check(`command ${COMMANDO_OPHALEN} staat in generate_handler! en als functie`,
  handler.split(",").map((s) => s.trim()).includes(COMMANDO_OPHALEN) && lib.includes(`fn ${COMMANDO_OPHALEN}(`));
check("het event heet in Rust en op de pagina hetzelfde", koppelRs.includes(`pub const EVENT_BESTANDEN: &str = "${EVENT_BESTANDEN}";`));
check("Rust geeft alleen het gekozen projectbestand vrij (allow_file, geen map)",
  /allow_file\(/.test(koppelRs) && !/allow_directory\(/.test(koppelRs));
const cargo = lees("..", "src-tauri", "Cargo.toml");
const cargoLock = lees("..", "src-tauri", "Cargo.lock");
const lockVersie = (crate) => new RegExp(`name = "${crate}"\\nversion = "([^"]+)"`).exec(cargoLock)?.[1];
check("tauri-plugin-single-instance vastgezet in Cargo.toml", /^tauri-plugin-single-instance = "=2\.\d+\.\d+"/m.test(cargo));
check("… en in Cargo.lock, naast tauri 2.11", Boolean(lockVersie("tauri-plugin-single-instance")) && lockVersie("tauri")?.startsWith("2.11."),
  `${lockVersie("tauri-plugin-single-instance")} / tauri ${lockVersie("tauri")}`);

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

# Extensiesysteem (stap 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open FEM Studio laadt lokale extensies die een bestandsformaat importeren; Bestand → Openen, het paneel Bestand → Extensies, de API en de MCP-server gebruiken ze.

**Architecture:** Eén gedeeld contract in TypeScript (`src/extensies/manifest.ts`) keurt manifesten en importresultaten. De app leest mappen en bytes via Tauri-commando's (`src-tauri/src/extensies.rs`) en draait de extensiecode in een Web Worker; zonder app laadt de Node-sidecar dezelfde code in een `vm`-context. Het resultaat is altijd een gewoon projectdocument dat door `deserializeProject` moet.

**Tech Stack:** React 19/TypeScript (design-mockup), Tauri v2 (Rust), Node-sidecar (esbuild-bundel), Rust MCP-server; crate `zip` voor installeren uit een ZIP.

Spec: `docs/superpowers/specs/2026-10-01-extensies-design.md`.

## Global Constraints

- Nergens in de repo namen van externe rekensoftware; de testextensie gebruikt een verzonnen formaat (`.demofem`).
- Extensiecode draait nooit in de pagina zelf: in de app alleen in een Web Worker (tijdslimiet 60 s), in Node in een `vm`-context.
- Het resultaat van een importeur gaat altijd door `deserializeProject`; een geïmporteerd project laadt als nieuw project zonder bestand.
- Rust leest alleen bytes van bestandstypen die een ingeschakelde extensie aanbiedt; het fs-bereik van de app wordt niet ruimer.
- Elk nieuw Tauri-commando staat kaal in `generate_handler!` en krijgt een uitzonderingsrij in `tests/drie_wegen_kruistabel.rs` (geen rekenkern).
- Voorkeuren per machine in `preferences.json` (`store.ts`): `extensies.mappen` (gekoppelde mappen, `string[]`) en `extensies.uit` (uitgeschakelde id's, `string[]`).
- Teksten in nl/en/de/fr.
- Testrunner: elke nieuwe `test-*.mjs` in `BUNDEL_TESTS` of `ALLEEN_BRON` (met reden).

## Contractwijziging t.o.v. de spec

De spec noemt "één gebundelde ES-module". Een module-worker uit een Blob-URL kan geen tweede Blob-URL importeren zonder `script-src blob:`, en Node kan een ES-module niet in een `vm`-context draaien zonder experimentele vlag. Daarom is het modulebestand een **klassiek script** dat `globalThis.openFemExtension = { importFile }` zet (esbuild: `--format=iife --global-name=openFemExtension`). Taak 1 past de spec daarop aan.

## Bestanden

| Bestand | Verantwoordelijkheid |
|---|---|
| `design-mockup/src/extensies/manifest.ts` (nieuw) | typen, `keurManifest`, `keurImportResultaat`, `importeurVoorBestand` |
| `design-mockup/src/extensies/worker.ts` (nieuw) | `draaiImporteurInWorker` |
| `design-mockup/src/extensies/extensieStore.ts` (nieuw) | zustand-store: lijst laden, aan/uit, koppelen, ZIP, verwijderen, importeren |
| `design-mockup/src/extensies/ImportVerslagVenster.tsx` (nieuw) | het importverslag |
| `design-mockup/src/components/backstage/ExtensionManagerPanel.tsx` | echte kaarten in plaats van voorbeeldgegevens |
| `design-mockup/src/io/projectFile.ts` | `openProject` met filters per importeur |
| `design-mockup/src/App.tsx` | Openen via een importeur, het verslag, de API-acties |
| `design-mockup/src/api/standaardRegister.ts`, `bediening/apiAdapter.ts` | `app.project.import`, `extensions.list` |
| `design-mockup/src/mcp/extensieSidecar.ts` (nieuw), `protocol.ts`, `sidecar.ts`, `kernel-exports.ts` | bewerking `extensie_importeren` |
| `src-tauri/src/extensies.rs` (nieuw), `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `tauri.conf.json` | commando's, `zip`, CSP |
| `src-tauri/crates/openaec-mcp-server/src/extensie_tools.rs` (nieuw), `main.rs`, `api_tools.rs` | tool `project_import` |
| `design-mockup/test-fixtures/extensie-voorbeeld/` (nieuw) | testextensie: `extension.json`, `index.js`, `voorbeeld.demofem` |
| `docs/extensies.md` (nieuw) | een extensie schrijven |

---

### Task 1: Contract, testextensie en het draaien in Node

**Files:**
- Create: `design-mockup/src/extensies/manifest.ts`
- Create: `design-mockup/test-fixtures/extensie-voorbeeld/extension.json`, `index.js`, `voorbeeld.demofem`
- Create: `design-mockup/src/mcp/extensieSidecar.ts` (alleen `laadExtensieScript` in deze taak)
- Modify: `docs/superpowers/specs/2026-10-01-extensies-design.md` (contract: klassiek script met `globalThis.openFemExtension`)
- Test: `design-mockup/test-extensie-contract.mjs` (BUNDEL_TESTS)

**Interfaces:**
- Produces:
  ```ts
  export interface ExtensieImporteur { id: string; label: string; fileExtensions: string[]; dimension: "2d" | "3d" }
  export interface ExtensieManifest {
    id: string; name: string; version: string; apiVersion: 1; main: string;
    description?: string; author?: string; category?: string; importers: ExtensieImporteur[];
  }
  export type ManifestKeuring = { ok: true; manifest: ExtensieManifest } | { ok: false; fouten: string[] };
  export function keurManifest(tekst: string): ManifestKeuring;
  export interface ImportMelding { level: "info" | "warning"; text: string }
  export interface ImportUitkomst { projectTekst: string; meldingen: ImportMelding[] }
  /** Gooit Error met een Nederlandse reden; projectTekst is opnieuw geserialiseerd door serializeProject. */
  export function keurImportResultaat(waarde: unknown): ImportUitkomst;
  export interface GeladenExtensie { map: string; manifest: ExtensieManifest; ingeschakeld: boolean }
  export function importeurVoorBestand(extensies: readonly GeladenExtensie[], bestandsnaam: string, importerId?: string):
    { extensie: GeladenExtensie; importeur: ExtensieImporteur }[];
  // extensieSidecar.ts (Node)
  export function laadExtensieScript(tekst: string, bestandsnaam: string):
    { importFile(invoer: { importerId: string; fileName: string; bytes: Uint8Array }): unknown };
  ```

- [ ] **Step 1: Testextensie schrijven.** `extension.json`:
  ```json
  { "id": "org.openaec.voorbeeld", "name": "Voorbeeldformaat", "version": "1.0.0", "apiVersion": 1,
    "main": "index.js", "description": "Testextensie: een verzonnen tekstformaat (.demofem).",
    "author": "OpenAEC", "category": "Import/Export",
    "importers": [{ "id": "demofem", "label": "Voorbeeldraamwerk", "fileExtensions": ["demofem"], "dimension": "2d" }] }
  ```
  `index.js` (klassiek script) leest regels `knoop <id> <x_mm> <z_mm>`, `staaf <id> <van> <naar> <profiel> <materiaal>`, `oplegging <knoop> <scharnier|inklemming|rol>`, `last <knoop> <Fz_kN>` en geeft een 2D-projectdocument (`format: "open-fem-studio-v2"`, `version: 2`, met `nodes`, `beams`, `supports`, `loads`, `loadCases` [{id:1,name:"Permanent (G)",type:"dead"}], `activeLoadCaseId: 1`, `selfWeightEnabled: false`) plus meldingen (`info`: aantallen; `warning` per onbekende regel). Het bestand eindigt met `globalThis.openFemExtension = { importFile };`. `voorbeeld.demofem`: een portaal van 3 knopen, 2 staven, 2 opleggingen, 1 last en één onbekende regel.
- [ ] **Step 2: Falende test schrijven** (`test-extensie-contract.mjs`): (a) het voorbeeldmanifest is geldig; (b) zes ongeldige manifesten met hun foutmelding: onbekend veld, ontbrekend `main`, `apiVersion` 2, `fileExtensions` met punt, dubbele importeur-id, `dimension` "4d"; (c) `laadExtensieScript` op `index.js` + `importFile` op `voorbeeld.demofem` → `keurImportResultaat` geeft een projecttekst die `deserializeProject` leest met 3 knopen en 2 staven, en één waarschuwing over de onbekende regel; (d) `keurImportResultaat` weigert: geen object, geen `project`, `messages` geen lijst, een project met `version` 99 (reden van de lezer); (e) een script dat `openFemExtension` niet zet geeft een duidelijke fout; (f) `importeurVoorBestand` vindt de importeur op extensie (hoofdletterongevoelig), slaat uitgeschakelde extensies over, en kiest bij twee kandidaten de gevraagde `importerId`.
- [ ] **Step 3: Test draaien:** `cd design-mockup && npx tsx test-extensie-contract.mjs` → faalt (modules ontbreken).
- [ ] **Step 4: Implementeren.** `keurManifest`: `JSON.parse` met foutmelding, daarna veld voor veld (strikt: onbekende velden = fout, `id` volgens `/^[a-z0-9]+(\.[a-z0-9-]+)+$/`, `version` semver, `apiVersion === 1`, `main` relatief zonder `..`, ≥ 1 importeur, `fileExtensions` niet-leeg, kleine letters zonder punt, unieke importeur-id's). `keurImportResultaat`: object met `project` (object) en `messages` (lijst van `{level, text}`), daarna `deserializeProject(JSON.stringify(project))` en `serializeProject(...)` voor de genormaliseerde tekst. `laadExtensieScript`: `vm.createContext({})` + `vm.runInContext(tekst, context, { filename: bestandsnaam, timeout: 60000 })`, daarna `context.openFemExtension?.importFile` controleren.
- [ ] **Step 5: Spec bijwerken** (§1: klassiek script, `globalThis.openFemExtension`, esbuild-voorbeeld).
- [ ] **Step 6: Registreren** in `BUNDEL_TESTS` (het contract en de sidecarkant draaien ook in de bundel) en `kernel-exports.ts` (`export * from "../extensies/manifest"; export { laadExtensieScript } from "./extensieSidecar";`), `npm run build:sidecar`.
- [ ] **Step 7: Groen** in bron en bundel: `node scripts/run-tests.mjs --filter=extensie-contract` en `--bundel`.
- [ ] **Step 8: Commit** `feat(extensies): contract, testextensie en het draaien in Node`.

### Task 2: De Web Worker en de CSP

**Files:**
- Create: `design-mockup/src/extensies/worker.ts`
- Modify: `src-tauri/tauri.conf.json` (`app.security.csp`: `worker-src 'self' blob:` toevoegen)
- Create: `design-mockup/scripts/extensie-worker-browser.ts`, Test: `design-mockup/test-extensie-worker-ui.mjs` (ALLEEN_BRON: Web Worker in Chromium)

**Interfaces:**
- Consumes: `keurImportResultaat` (Task 1).
- Produces: `export function draaiImporteurInWorker(scriptTekst: string, invoer: { importerId: string; fileName: string; bytes: Uint8Array }, opties?: { tijdslimietMs?: number }): Promise<unknown>` — de ruwe uitkomst van `importFile`; weigert met `Error` bij een fout in het script, een ontbrekende `openFemExtension`, of na de tijdslimiet (worker beëindigd).

- [ ] **Step 1: Falende browsertest** (harnas naar het voorbeeld van `scripts/ifc-import-browser.tsx`, headless Edge, uitslag in `<pre id="uitslag">`): (a) de testextensie importeert `voorbeeld.demofem` en `keurImportResultaat` slaagt; (b) een script dat eeuwig loopt wordt na een tijdslimiet van 300 ms afgebroken met een melding over de tijdslimiet; (c) een script dat gooit geeft die fouttekst; (d) in de worker bestaan `document` en `__TAURI_INTERNALS__` niet (het script meldt `typeof document`).
- [ ] **Step 2: Draaien** → faalt.
- [ ] **Step 3: Implementeren:** Blob met `scriptTekst + "\n;" + bootstrap` waarin `self.onmessage = async (e) => { try { const ext = globalThis.openFemExtension; if (!ext || typeof ext.importFile !== "function") throw new Error("…"); postMessage({ ok: true, uitkomst: await ext.importFile(e.data) }); } catch (f) { postMessage({ ok: false, fout: String(f?.message ?? f) }); } }`; `new Worker(URL.createObjectURL(blob))`; de bytes gaan als transferable; `setTimeout` → `worker.terminate()` + Error; altijd `URL.revokeObjectURL`.
- [ ] **Step 4: CSP** in `tauri.conf.json` aanvullen; `tauri.windows.conf.json` en `tauri.bundel.conf.json` hebben geen eigen CSP (gecontroleerd).
- [ ] **Step 5: Groen**, registreren in `ALLEEN_BRON`, `npx tsc --noEmit`.
- [ ] **Step 6: Commit** `feat(extensies): importeurs draaien in een Web Worker`.

### Task 3: Rust: mappen, bytes, ZIP en verwijderen

**Files:**
- Create: `src-tauri/src/extensies.rs`
- Modify: `src-tauri/src/lib.rs` (`mod extensies;`, vijf kale namen in `generate_handler!`), `src-tauri/Cargo.toml` (`zip = { version = "2", default-features = false, features = ["deflate"] }`)
- Modify: `src-tauri/crates/openaec-mcp-server/tests/drie_wegen_kruistabel.rs` (vijf uitzonderingsrijen, reden `EXTENSIE_REDEN`)
- Test: unit-tests onderaan `extensies.rs` (tijdelijke mappen)

**Interfaces:**
- Produces (Tauri-commando's, camelCase-argumenten zoals elders in de app):
  ```rust
  #[derive(Serialize)] struct GevondenExtensie { map: String, manifest_tekst: Option<String>, fout: Option<String>, bron: String /* "geinstalleerd" | "gekoppeld" | "omgeving" */ }
  fn extensies_lezen(app: AppHandle, mappen: Vec<String>) -> Result<Vec<GevondenExtensie>, String>
  fn extensie_script_lezen(map: String, main: String) -> Result<String, String>       // main relatief, zonder ".."
  fn extensie_bestand_lezen(app: AppHandle, pad: String, mappen: Vec<String>) -> Result<Vec<u8>, String>
  fn extensie_zip_installeren(app: AppHandle, zip_pad: String) -> Result<String, String> // geeft de nieuwe map
  fn extensie_verwijderen(app: AppHandle, map: String) -> Result<(), String>            // alleen binnen <app_data>/extensions
  ```
  De vaste map is `app.path().app_data_dir()?.join("extensions")`. Daarnaast de mappen uit de omgevingsvariabele `OPENAEC_EXTENSIONS_DIRS` (gescheiden door `;`, bron `omgeving`), zodat een test een extensie kan koppelen zonder de voorkeuren van de gebruiker te raken. `extensie_bestand_lezen` scant dezelfde mappen, neemt de `fileExtensions` uit elk leesbaar manifest (alleen de JSON, geen volledige keuring) en weigert elk ander bestandstype.

- [ ] **Step 1: Falende unit-tests:** scannen van een vaste map met twee extensies en één kapot manifest (fout per map, de rest leesbaar); een gekoppelde map; `extensie_bestand_lezen` leest `.demofem` en weigert `.txt`; `extensie_script_lezen` weigert `../x.js`; ZIP-installatie pakt een zip met `extension.json` + `index.js` uit naar `extensions/<id>` en weigert een zip zonder manifest of met een pad buiten de doelmap (zip-slip); verwijderen buiten de vaste map wordt geweigerd. De pure functies nemen het pad van de vaste map als argument, zodat de tests geen `AppHandle` nodig hebben.
- [ ] **Step 2: Draaien:** `cd src-tauri && cargo test -p open-fem-studio extensies` → faalt. (Let op de dll-lock: geen draaiende debug-app.)
- [ ] **Step 3: Implementeren** (pure functies + dunne `#[tauri::command]`-omhulsels; de commando's in `lib.rs` zijn functies in dít bestand die de module aanroepen, zoals de andere).
- [ ] **Step 4: Kruistabel** bijwerken; `cargo test -p openaec-mcp-server --test drie_wegen_kruistabel`.
- [ ] **Step 5: Groen:** de extensietests en de kruistabel; `cargo build -p open-fem-studio`.
- [ ] **Step 6: Commit** `feat(extensies): mappen lezen, bytes, installeren uit ZIP en verwijderen`.

### Task 4: Store, beheerpaneel, Openen en het verslag

**Files:**
- Create: `design-mockup/src/extensies/extensieStore.ts`, `design-mockup/src/extensies/ImportVerslagVenster.tsx`
- Modify: `design-mockup/src/components/backstage/ExtensionManagerPanel.tsx` (+ `.css` waar nodig), `design-mockup/src/io/projectFile.ts`, `design-mockup/src/App.tsx`, `design-mockup/src/i18n/locales/{nl,en,de,fr}/backstage.json` en `common.json`
- Test: `design-mockup/test-extensie-beheer.mjs` (ALLEEN_BRON: React in Node met nagebootste Tauri-aanroepen)

**Interfaces:**
- Consumes: `keurManifest`, `importeurVoorBestand`, `keurImportResultaat` (Task 1), `draaiImporteurInWorker` (Task 2), de Tauri-commando's (Task 3).
- Produces:
  ```ts
  // extensieStore.ts
  interface ExtensieKaart { map: string; bron: "geinstalleerd" | "gekoppeld" | "omgeving"; manifest?: ExtensieManifest; fout?: string; ingeschakeld: boolean }
  useExtensieStore: { kaarten: ExtensieKaart[]; laden(): Promise<void>; zetIngeschakeld(id: string, aan: boolean): Promise<void>;
    koppelMap(map: string): Promise<void>; ontkoppel(map: string): Promise<void>; installeerZip(pad: string): Promise<void>;
    verwijder(map: string): Promise<void>; importeer(pad: string, importerId?: string): Promise<{ uitkomst: ImportUitkomst; extensie: ExtensieManifest }> }
  // projectFile.ts
  export async function openProject(importFilters?: { name: string; extensions: string[] }[]):
    Promise<{ soort: "project"; text: string; path: string } | { soort: "import"; path: string } | null>
  ```
  `importeer` leest de bytes via `extensie_bestand_lezen`, het script via `extensie_script_lezen`, draait `draaiImporteurInWorker` en keurt met `keurImportResultaat`. De Tauri-aanroepen gaan via één kleine `tauri`-functie die de test vervangt.

- [ ] **Step 1: Falende test:** de store met een nagebootste `invoke` (twee extensies, één met een kapot manifest, één uitgeschakeld via `extensies.uit`): de kaarten tonen de fout; aan/uit schrijft `extensies.uit`; koppelen voegt het pad toe aan `extensies.mappen` en laadt opnieuw; `importeer` met de testextensie geeft het project (de worker wordt in de Node-test vervangen door `laadExtensieScript`). Het paneel (renderToStaticMarkup) toont geen voorbeeldgegevens meer en wel de kaart van de testextensie met haar bestandstype.
- [ ] **Step 2: Draaien** → faalt.
- [ ] **Step 3: Implementeren:** store; paneel (kaarten zoals nu, met bestandstypen, map, bron, fout; knoppen "+ ZIP" via de bestandsdialoog met filter `zip`, "Map koppelen…" via `open({ directory: true })`, "Opnieuw laden", per kaart "Ontkoppelen"/"Verwijderen"; de tab Bladeren en `SAMPLE_*` verdwijnen; bij koppelen en ZIP eerst de waarschuwing); `openProject` met filters "Alle ondersteunde bestanden", "Open FEM Studio-project" en per importeur; in `handleOpenProject` bij `soort: "import"`: `importeer` → `laadProjectTekst(projectTekst)` → `setProjectPath("")` → `ImportVerslagVenster` met de meldingen en "naam versie" van de extensie; een fout via `notifyWarning`.
- [ ] **Step 4: Teksten** in de vier talen.
- [ ] **Step 5: Groen:** de test, `npx tsc --noEmit`, en de bestaande backstage-tests (`--filter=backstage`).
- [ ] **Step 6: Commit** `feat(extensies): beheer in Bestand → Extensies, en openen via een importeur`.

### Task 5: API: `app.project.import` en `extensions.list`

**Files:**
- Modify: `design-mockup/src/api/standaardRegister.ts`, `design-mockup/src/bediening/apiAdapter.ts`, `design-mockup/src/App.tsx`
- Test: `design-mockup/test-api-adapter.mjs` (uitbreiden)

**Interfaces:**
- Produces: app-commando `app.project.import` (`path` verplicht, `importer` optioneel, `discardChanges` optioneel) → `{ path, project: "nieuw", messages, extension: { id, name, version } }`; app-commando `extensions.list` → `{ extensions: [{ id, name, version, enabled, source, folder, importers, error? }] }`. `ApiAppActies` krijgt `importeren(pad: string, importerId?: string): Promise<{ meldingen: ImportMelding[]; extensie: ExtensieManifest }>` en `extensies(): ExtensieKaart[]`.

- [ ] **Step 1: Falende tests** in `test-api-adapter.mjs`: `app.project.import` weigert bij niet-opgeslagen werk zonder `discardChanges` (GEWEIGERD), roept anders `importeren` aan en geeft de meldingen terug; `extensions.list` geeft de kaarten.
- [ ] **Step 2: Implementeren** (adapter en App: `importeren` gebruikt dezelfde route als Openen, zonder vraag en zonder verslagvenster; het antwoord draagt de meldingen).
- [ ] **Step 3: Sidecar en catalogus:** `npm run build:sidecar` (de catalogus krijgt twee commando's; buiten de app ALLEEN_IN_APP).
- [ ] **Step 4: Groen:** `--filter=api` in bron en bundel; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(api): project importeren via een extensie, en de extensies opvragen`.

### Task 6: Zonder app: sidecar en MCP-tool `project_import`

**Files:**
- Modify: `design-mockup/src/mcp/extensieSidecar.ts` (`opExtensieImporteren`), `protocol.ts` (`SIDECAR_OPS` + `extensie_importeren`; foutcode `EXTENSIE` met remedie), `sidecar.ts`
- Create: `src-tauri/crates/openaec-mcp-server/src/extensie_tools.rs`; Modify: `main.rs`, `api_tools.rs` (`schrijf_vervangend` → `pub(crate)`), `sidecar.rs` (remedie)
- Test: `design-mockup/test-extensie-sidecar.mjs` (BUNDEL_TESTS), `src-tauri/crates/openaec-mcp-server/tests/extensie_import.rs`; Modify: `tests/stdio_roundtrip.rs` (51 → 52 vaste tools), `tests/drie_wegen_kruistabel.rs` (rij voor `project_import`), `test-sidecar.mjs` (11 → 12 bewerkingen)

**Interfaces:**
- Produces: sidecar-bewerking `extensie_importeren` met payload `{ pad: string; mappen: string[]; importerId?: string; uit?: string[] }` → `{ project: string; meldingen: ImportMelding[]; extensie: { id, name, version } }`; MCP-tool `project_import` (`path`, `save_as`, `importer?`) → `{ saved: save_as, messages, extension }`. De mappen: `%APPDATA%\org.openaec.fem-studio\extensions`, de gekoppelde mappen uit `%APPDATA%\org.openaec.fem-studio\preferences.json` (`extensies.mappen`) en, voor tests, `OPENAEC_EXTENSIONS_DIRS` (gescheiden door `;`); `extensies.uit` uit dezelfde voorkeuren.

- [ ] **Step 1: Falende tests:** sidecar: de testextensie via `mappen` importeert `voorbeeld.demofem`; een onbekend bestandstype geeft `EXTENSIE` met de lijst importeurs; een uitgeschakelde extensie telt niet mee. Rust: `project_import` schrijft `save_as` dat `load_fem_project` leest; zonder extensie een fout met code en remedie.
- [ ] **Step 2: Implementeren** (Node: `readdirSync`, `keurManifest`, `importeurVoorBestand`, `laadExtensieScript`, `keurImportResultaat`; Rust: mappen bepalen, `sidecar::roep_aan("extensie_importeren")`, `schrijf_vervangend`).
- [ ] **Step 3: Bouwen en groen:** `npm run build:sidecar`, `cargo build --release -p openaec-mcp-server`, de nieuwe tests, `stdio_roundtrip`, kruistabel, `test-sidecar.mjs`.
- [ ] **Step 4: README** van de MCP-server: tool `project_import` en de extensiemappen.
- [ ] **Step 5: Commit** `feat(mcp): project importeren via een extensie, zonder app`.

### Task 7: Documentatie, de echte app en de volledige verificatie

**Files:**
- Create: `docs/extensies.md` (manifest, script, projectformaat, bundelen met esbuild, testen met `test-extensie-contract.mjs` als voorbeeld, de beveiliging)
- Modify: `design-mockup/referentie-gui/api-app.mjs` (stap: `app_project_import` met de testextensie, gekoppeld via `OPENAEC_EXTENSIONS_DIRS`; de voorkeuren van de gebruiker blijven ongemoeid)
- Modify: `CLAUDE.md` (één regel: extensies, waar ze staan, geen formaatkennis in de repo)

- [ ] **Step 1: Documentatie** schrijven.
- [ ] **Step 2: Rondgang door de echte app:** importeren via de API, het verslag (meldingen in het antwoord), daarna `app_project_save` met pad.
- [ ] **Step 3: Volledige verificatie:** `npm run build:sidecar`; `cargo build --release -p toetsbrug -p openaec-mcp-server`; `npx tsc --noEmit`; `node scripts/run-tests.mjs` en `--bundel` (logs volledig bewaren); `cargo test --workspace --exclude open-fem-studio` plus `cargo test -p open-fem-studio extensies`; ts-rs-regeleinden terugzetten.
- [ ] **Step 4: Commit** `docs(extensies): een extensie schrijven`.

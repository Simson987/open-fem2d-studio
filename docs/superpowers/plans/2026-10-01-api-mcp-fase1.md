# API en MCP, fase 1: fundament en 3D-model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** één commandoregister waaruit het bedieningskanaal en de MCP-tools volgen, met alle 3D-modelbewerkingen als commando's die ook zonder app werken op een projectbestand.

**Architecture:**
- De commando's staan in `design-mockup/src/api/`. Een documentcommando is zuiver: van projectdocument naar projectdocument plus een uitkomst.
- In de app past een adapter het nieuwe document toe op de stores, als één stap ongedaan maken.
- Zonder app voert de sidecar het commando uit op de projecttekst; de MCP-server leest en schrijft het bestand.
- De MCP-server bouwt zijn toollijst uit de catalogus van de sidecar.

**Tech Stack:** TypeScript (React-app en Node-sidecarbundel via esbuild), Rust (MCP-server, tokio), testbatterij `design-mockup/scripts/run-tests.mjs` (`test-*.mjs`), `cargo test`.

Spec: `docs/superpowers/specs/2026-10-01-api-mcp-alle-functies-design.md`.

## Global Constraints

- **Namen en velden:** commandonamen en veldnamen in het Engels, gelijk aan het datamodel. Beschrijvingen en foutmeldingen in het Nederlands.
- **Afhankelijkheden:** geen nieuwe npm- of crate-afhankelijkheden.
- **Schema's:** elk invoerschema heeft op elk objectniveau `additionalProperties: false`. Een onbekend veld is een fout.
- **Documentcommando's** importeren geen React, DOM of Tauri. Ze komen in de sidecarbundel, en `bouw-sidecar.mjs` faalt op `window.`, `document.` en `__TAURI`.
- **Elk commando valideert zijn invoer** vóór uitvoering. Een fout wordt `ApiFout` met `code`, Nederlandse `melding` en eventueel `detail`.
- **Repo-inhoud:** nergens namen van externe rekensoftware en nergens verwijzingen naar gesprekken met een assistent (harde regel).
- **Nieuwe tests:**
  - een nieuwe `test-*.mjs` komt in `ALLEEN_BRON` (met reden) of draait ook tegen de bundel;
  - na een wijziging aan de bundelbron: `npm run build:sidecar`;
  - test-*.mjs die binaries starten, draaien tegen verse `toetsbrug`/`openaec-mcp-server` (`cargo build --release -p toetsbrug -p openaec-mcp-server`).
- **Verificatie per taak:** `npx tsc --noEmit` in `design-mockup/`, de eigen test, en aan het eind van de fase de volledige batterij en `cargo test --workspace --exclude open-fem-studio`.

---

## Bestandsstructuur

| Bestand | Verantwoordelijkheid |
|---|---|
| `design-mockup/src/api/schema.ts` | `ApiSchema` (subset van JSON Schema) en `valideer(schema, waarde)` → lijst problemen |
| `design-mockup/src/api/register.ts` | `ApiCommando`, `ApiFout`, `ApiContext`, `maakRegister(commandos)` met `catalogus()` en `voerUit()` |
| `design-mockup/src/api/document.ts` | `ApiDocument` = projectbestand zonder metavelden; `documentUitTekst`, `documentNaarTekst`, `leegDocument`, `model3dVan`, `metModel3d` |
| `design-mockup/src/api/commands/model3dGeometrie.ts` | knopen, staven, platen en openingen |
| `design-mockup/src/api/commands/model3dVoorwaarden.ts` | opleggingen (vast, veren, opgelegde verplaatsing), alle lastsoorten, belastingvlakken, schijven, trek-alleen-instellingen |
| `design-mockup/src/api/commands/model3dBewerken.ts` | transformaties (verplaatsen, roteren, kopiëren, spiegelen), selectie verwijderen, levels |
| `design-mockup/src/api/commands/project.ts` | `project.get`, `project.new`, belastinggevallen en combinaties |
| `design-mockup/src/api/standaardRegister.ts` | alle commando's samen, zonder React (voor sidecar en app) |
| `design-mockup/src/components/openFem3d/openFem3dModel.ts` | nieuw: `addOpenFem3DNode`, `updateOpenFem3DNode`, `addOpenFem3DBeam`, `updateOpenFem3DBeam` (zuiver) |
| `design-mockup/src/mcp/apiSidecar.ts` | sidecarbewerkingen `api_catalogus` en `api_uitvoeren` |
| `design-mockup/src/mcp/protocol.ts`, `sidecar.ts`, `kernel-exports.ts` | bewerkingen registreren en doorgeven |
| `design-mockup/src/bediening/apiAdapter.ts` | document lezen uit en terugzetten in de draaiende app |
| `design-mockup/src/bediening/bediening.ts` | paginaopdrachten `api_catalogus` en `api_uitvoeren` |
| `design-mockup/src/App.tsx` | `openFem3d.editModel` en setters voor gevallen en combinaties in `BedieningActies` |
| `src-tauri/crates/openaec-mcp-server/src/api_tools.rs` | catalogus → tooldefinities; uitvoeren op een bestand of in de app |
| `src-tauri/crates/openaec-mcp-server/src/main.rs` | api-tools in `tools/list` en `dispatch_tool` |
| `design-mockup/src/api/dekking.ts` | lijst van 3D-GUI-functies → commando of geplande fase |

## Interfaces (vast voor alle taken)

```ts
// schema.ts
export type ApiSchema =
  | { type: "object"; properties: Record<string, ApiSchema>; required?: string[]; additionalProperties: false; description?: string }
  | { type: "array"; items: ApiSchema; minItems?: number; maxItems?: number; description?: string }
  | { type: "number" | "integer"; minimum?: number; maximum?: number; exclusiveMinimum?: number; description?: string }
  | { type: "string"; enum?: string[]; minLength?: number; description?: string }
  | { type: "boolean"; description?: string }
  | { oneOf: ApiSchema[]; description?: string };
export interface SchemaProbleem { pad: string; melding: string }
export function valideer(schema: ApiSchema, waarde: unknown, pad?: string): SchemaProbleem[];
export function isStrikt(schema: ApiSchema): string[]; // paden van objecten zonder additionalProperties:false

// register.ts
export type ApiSoort = "document" | "app";
export interface ApiContext { document?: ApiDocument; app?: unknown }
export interface ApiUitkomst<U> { uitkomst: U; document?: ApiDocument }
export interface ApiCommando<I = unknown, U = unknown> {
  naam: string; beschrijving: string; invoer: ApiSchema; soort: ApiSoort;
  uitvoeren(invoer: I, context: ApiContext): ApiUitkomst<U> | Promise<ApiUitkomst<U>>;
}
export class ApiFout extends Error { code: string; detail?: unknown }
export interface ApiCatalogusItem { naam: string; beschrijving: string; invoer: ApiSchema; soort: ApiSoort }
export interface ApiRegister {
  catalogus(): ApiCatalogusItem[];
  voerUit(naam: string, invoer: unknown, context: ApiContext): Promise<ApiUitkomst<unknown>>;
}
export function maakRegister(commandos: readonly ApiCommando[]): ApiRegister;

// document.ts
export type ApiDocument = Omit<ProjectFile, "format" | "version" | "savedAt">;
export function documentUitTekst(tekst: string): ApiDocument;
export function documentNaarTekst(doc: ApiDocument): string;
export function leegDocument(): ApiDocument;
export function model3dVan(doc: ApiDocument): OpenFem3DModel;
export function metModel3d(doc: ApiDocument, model: OpenFem3DModel): ApiDocument;

// standaardRegister.ts
export function standaardRegister(): ApiRegister;
```

Foutcodes: `ONBEKEND_COMMANDO`, `INVOER_ONGELDIG` (detail: `problemen`), `GEEN_DOCUMENT`, `NIET_GEVONDEN`, `GEWEIGERD` (een modelregel weigert, melding van de modelfunctie), `ALLEEN_IN_APP`.

---

### Task 1: Schemavalidator

**Files:** Create `design-mockup/src/api/schema.ts`; Test `design-mockup/test-api-schema.mjs`; registreer in `scripts/run-tests.mjs`: draait ook tegen de bundel.

- [ ] **Test schrijven.** Cases:
  - een geldig object;
  - een ontbrekend verplicht veld (pad `.x`);
  - een onbekend veld (pad `.y`, melding "onbekend veld");
  - een verkeerd type;
  - `integer` met 1,5;
  - `minimum`, `exclusiveMinimum`, `enum`;
  - `array` met `minItems` en een fout element (pad `[1].x`);
  - `oneOf` waarvan geen of twee varianten passen;
  - `NaN` en `Infinity` zijn geen geldig getal;
  - `isStrikt` vindt een object zonder `additionalProperties: false` op diepte 2.
- [ ] **Falen zien:** `node scripts/run-tests.mjs --filter=api-schema` faalt, want de module ontbreekt.
- [ ] **Implementeren.** `valideer` loopt recursief en geeft alle problemen, niet alleen het eerste. `isStrikt` loopt alle subschema's af.
- [ ] **Groen**, `npx tsc --noEmit`, dan commit.

### Task 2: Register

**Files:** Create `design-mockup/src/api/register.ts`; Test `design-mockup/test-api-register.mjs`.

- [ ] **Test:**
  - `catalogus()` geeft naam, beschrijving, invoer en soort, gesorteerd op naam;
  - een dubbele naam bij `maakRegister` gooit;
  - een naam die niet aan `^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$` voldoet, gooit;
  - een niet-strikt schema gooit (via `isStrikt`);
  - `voerUit` met een onbekende naam geeft `ONBEKEND_COMMANDO` met de dichtstbijzijnde namen in `detail.suggesties`;
  - ongeldige invoer geeft `INVOER_ONGELDIG` met alle problemen, en `uitvoeren` wordt dan niet aangeroepen;
  - een documentcommando zonder `context.document` geeft `GEEN_DOCUMENT`;
  - een `Error` uit `uitvoeren` wordt `GEWEIGERD` met dezelfde melding;
  - een `ApiFout` gaat ongewijzigd door.
- [ ] **Implementeren, groen, commit.**

### Task 3: Projectdocument

**Files:** Create `design-mockup/src/api/document.ts`; Test `design-mockup/test-api-document.mjs`.

- [ ] **Test:**
  - `leegDocument()` geeft `modelDimension: "3d"`, een leeg 3D-model, de standaardgevallen van een nieuw project en `analysetype: "eersteOrde"`;
  - `documentNaarTekst` gevolgd door `documentUitTekst` geeft een gelijk document;
  - een bestand met het oude formaat-id leest in;
  - `model3dVan` op een 2D-bestand zonder `model3d` geeft `EMPTY_OPEN_FEM_3D`;
  - `metModel3d` laat het origineel ongewijzigd en zet `modelDimension` op `"3d"`.
- [ ] **Implementeren** met `serializeProject` en `deserializeProject` uit `io/projectFile.ts`, en zet `leegDocument` op dezelfde standaardwaarden als Bestand → Nieuw in `App.tsx` (`handleNewProject`). Lees die waarden daar af; neem ze niet over uit je geheugen.
- [ ] **Groen, commit.**

### Task 4: Zuivere 3D-functies voor knoop en staaf

**Files:** Modify `design-mockup/src/components/openFem3d/openFem3dModel.ts`; Test `design-mockup/test-open-fem3d-model-api.mjs`.

- [ ] **Test:**
  - `addOpenFem3DNode(model, { x, y, z, levelId?, name? })` → `{ model, node }` met id = hoogste + 1. Een dubbele positie (binnen 1e-6 m) wordt geweigerd met de bestaande knoop in de melding. Een niet-eindig getal wordt geweigerd.
  - `updateOpenFem3DNode(model, id, { x?, y?, z?, levelId?, name? })` wijzigt alleen de genoemde velden. Een onbekend id wordt geweigerd. Een verplaatsing op dezelfde plek als een andere knoop wordt geweigerd. Staven, platen en lasten blijven gekoppeld.
  - `addOpenFem3DBeam(model, { startNodeId, endNodeId, profileName?, material?, rollAngleRad?, releases?, tensionOnly?, name?, group? })` → `{ model, beam }`. Geweigerd worden: dezelfde begin- en eindknoop, een onbekende knoop, en een staaf die al bestaat (in beide richtingen).
  - `updateOpenFem3DBeam(model, id, patch)`: `null` in de patch wist een optioneel veld. `startNodeId`/`endNodeId` lopen via de bestaande `setOpenFem3DBeamNodes`.
  - `parseOpenFem3DModel(uitkomst)` slaagt na elke bewerking.
- [ ] **Implementeren** naast de bestaande `add…`/`update…`-functies, met dezelfde foutstijl (een Nederlandse `Error`).
- [ ] **Groen**, tsc, commit.

### Task 5: 3D-commando's — geometrie

**Files:** Create `design-mockup/src/api/commands/model3dGeometrie.ts`; Test `design-mockup/test-api-model3d.mjs` (blok [1]).

Commando's (allemaal `soort: "document"`):

| naam | invoer | functie |
|---|---|---|
| `model3d.get` | `{}` | het 3D-model, met aantallen |
| `model3d.node.add` | `x, y, z` (m), `levelId?`, `name?` | `addOpenFem3DNode` |
| `model3d.node.update` | `id`, `x?`, `y?`, `z?`, `levelId?` (string of null), `name?` | `updateOpenFem3DNode` |
| `model3d.node.delete` | `id` | `removeOpenFem3DNode` |
| `model3d.beam.add` | `startNodeId`, `endNodeId`, `profileName?`, `material?`, `rollAngleDeg?`, `releases?`, `tensionOnly?`, `name?`, `group?` | `addOpenFem3DBeam` |
| `model3d.beam.update` | `id` plus dezelfde velden, optioneel (null wist) | `updateOpenFem3DBeam` |
| `model3d.beam.delete` | `id` | `removeOpenFem3DBeam` |
| `model3d.beam.split` | `id`, `positionM` of `fraction` (oneOf) | `splitOpenFem3DBeam` |
| `model3d.plate.add` | `nodeIds` (≥ 3), `thicknessM`, `material?`, overige velden van `addOpenFem3DPlate` | `addOpenFem3DPlate` |
| `model3d.plate.update` | `id`, velden van `updateOpenFem3DPlate` | `updateOpenFem3DPlate` |
| `model3d.plate.delete` | `id` | `removeOpenFem3DPlate` |
| `model3d.plate.addOpening` | `plateId`, `nodeIds` (≥ 3) | `addOpenFem3DPlateOpening` |

Hoeken staan in de API in graden (`rollAngleDeg`), net als in de GUI. Het model rekent in radialen.

- [ ] **Test per commando:**
  - een geslaagde aanroep op `leegDocument()`, met het document vóór en na;
  - een weigering met de Nederlandse melding;
  - een onbekend veld → `INVOER_ONGELDIG`;
  - `model3d.get` op een document met knopen.
- [ ] **Implementeren, groen, commit.**

### Task 6: 3D-commando's — opleggingen, lasten, vlakken, schijven

**Files:** Create `design-mockup/src/api/commands/model3dVoorwaarden.ts`; Test `test-api-model3d.mjs` (blok [2]).

| naam | functie |
|---|---|
| `model3d.support.set` (`nodeId`, `preset` óf zes booleans `ux … rz`) | `setOpenFem3DSupport` (preset via `OPEN_FEM_3D_SUPPORT_PRESETS`) |
| `model3d.support.setSprings` (`nodeId`, `kxKnPerM?` … `krzKnmPerRad?`) | `setOpenFem3DSupportSprings` |
| `model3d.support.setPrescribed` (`nodeId`, `uxM?` … `rzRad?`) | `setOpenFem3DSupportPrescribed` |
| `model3d.support.remove` (`nodeId`) | `removeOpenFem3DSupport` |
| `model3d.load.nodal.add/update/delete` | `addOpenFem3DNodalLoad`, `updateOpenFem3DNodalLoad`, `removeOpenFem3DNodalLoad` |
| `model3d.load.member.add/update/delete` | `addOpenFem3DMemberLoad`, `updateOpenFem3DMemberLoad`, `removeOpenFem3DMemberLoad` |
| `model3d.load.memberPoint.add/update/delete` | `addOpenFem3DMemberPointLoad`, `updateOpenFem3DMemberPointLoad`, `removeOpenFem3DMemberPointLoad` |
| `model3d.load.thermal.add/update/delete` | `addOpenFem3DThermalLoad`, `updateOpenFem3DThermalLoad`, `removeOpenFem3DThermalLoad` |
| `model3d.load.surface.add/update/delete` | `addOpenFem3DSurfaceLoad`, `updateOpenFem3DSurfaceLoad`, `removeOpenFem3DSurfaceLoad` |
| `model3d.loadPanel.add/update/delete` | dezelfde functies als `OpenFem3DLoadPanelProperties.tsx` en het tekengereedschap; lees ze daar af |
| `model3d.diaphragm.add/delete` | `addOpenFem3DDiaphragm`, `removeOpenFem3DDiaphragm` |
| `model3d.beam.setTensionOnly` | `setOpenFem3DTensionOnly` |
| `model3d.settings.update` (`tensionOnlyFitAfterPermanent?`, `tensionOnlyCrossRule?`) | `setOpenFem3DTensionOnlySetting` |

Velden van lasten zijn de modelvelden (`caseId`, `qyStart` …). `caseId` moet bestaan in `document.loadCases`, anders volgt `GEWEIGERD`.

- [ ] **Test** per groep: toevoegen, wijzigen en verwijderen, plus een weigering (onbekende staaf, onbekend geval, een veer op een vaste richting).
- [ ] **Implementeren, groen, commit.**

### Task 7: 3D-commando's — bewerken en levels

**Files:** Create `design-mockup/src/api/commands/model3dBewerken.ts`; Test `test-api-model3d.mjs` (blok [3]).

| naam | functie |
|---|---|
| `model3d.transform` (`selection`: `nodeIds?`, `beamIds?`, `plateIds?`; `command`: move/rotate/copy/mirror met de velden van `OpenFem3DTransformCommand`) | `transformOpenFem3D` |
| `model3d.selection.delete` (`nodeIds?`, `beamIds?`, `plateIds?`) | `removeOpenFem3DSelection` |
| `model3d.levels.set` (`levels`: `id`, `label`, `heightM`) | `applyOpenFem3DLevels` op het stramien in het document (`structuralGrid.zAxes`) |
| `model3d.node.linkLevel` (`nodeIds`, `levelId` of null) | `linkOpenFem3DToLevel` |

- [ ] **Test:**
  - verplaatsen, roteren 90°, kopiëren 2× en spiegelen, op een klein portaal;
  - levels verhogen neemt gekoppelde knopen mee;
  - een weigering van `applyOpenFem3DLevels` wordt `GEWEIGERD` met de reden.
- [ ] **Implementeren, groen, commit.**

### Task 8: Project — gevallen en combinaties

**Files:** Create `design-mockup/src/api/commands/project.ts`; Test `design-mockup/test-api-project.mjs`.

| naam | functie |
|---|---|
| `project.get` | aantallen, modelDimension, gevallen, combinaties, analysetype |
| `project.new` | `leegDocument()` |
| `project.loadCase.add` (`name`, `type`) | volgend vrij id via `volgendVrijId` |
| `project.loadCase.update` / `project.loadCase.delete` | lasten van een verwijderd geval gaan mee (2D en 3D), en factoren in combinaties via `verwijderWeesFactoren` |
| `project.combination.add/update/delete` (`name`, `type`, `factors` per geval) | dezelfde opslagvorm als `combinationsToFile` |

- [ ] **Test:**
  - een geval toevoegen, wijzigen en verwijderen, waarbij een 3D-staaflast in dat geval meegaat;
  - een combinatie met een factor op een onbekend geval → `GEWEIGERD`.
- [ ] **Implementeren, groen, commit.**

### Task 9: Standaardregister en sidecar

**Files:**
- Create `design-mockup/src/api/standaardRegister.ts`, `design-mockup/src/mcp/apiSidecar.ts`.
- Modify `mcp/protocol.ts` (`SIDECAR_OPS` + `api_catalogus`, `api_uitvoeren`), `mcp/sidecar.ts` (`verwerkVerzoek`; een `ApiFout` wordt `maakFout(id, code, melding, detail)`), `mcp/kernel-exports.ts`.
- Test `design-mockup/test-api-sidecar.mjs`: draait tegen de bundel.

- [ ] **Test** (bundel):
  - `api_catalogus` geeft alle commando's, en elk schema is strikt;
  - `api_uitvoeren` met `{ name: "model3d.node.add", input: {x:0,y:0,z:0}, project: <tekst van leegDocument> }` geeft `result.output.node.id === 1` en een `result.project` waarin de knoop staat;
  - een onbekend commando geeft `ok: false` met `ONBEKEND_COMMANDO`;
  - een `app`-commando zonder app geeft `ALLEEN_IN_APP`.
- [ ] **Implementeren**, `npm run build:sidecar`, groen, commit. Neem de herbouwde bundel en de hash mee in de commit.

### Task 10: MCP-server — tools uit de catalogus

**Files:** Create `src-tauri/crates/openaec-mcp-server/src/api_tools.rs`; Modify `src/main.rs` (`tool_definitions`, `dispatch_tool`), `src/gui_tools.rs` (een `roep_api(naam, invoer)` over `api_uitvoeren`); Test `src-tauri/crates/openaec-mcp-server/tests/api_tools.rs`.

**Gedrag:**
- **De catalogus** wordt één keer per proces opgehaald via `sidecar::roep_aan("api_catalogus", …)` en daarna gecachet. Lukt dat niet (geen Node), dan blijft `tools/list` de 51 bestaande tools geven, met een waarschuwing in het log.
- **Toolnaam:** de commandonaam met `_` voor `.` (`model3d_node_add`). Botsing met een bestaande toolnaam is een fout bij het opbouwen (test).
- **Een documenttool:** het schema krijgt `project` (string, pad naar `.ifcfem`/`.ifcfem2d`) en `save` (boolean, standaard true). Met `project` leest Rust het bestand, roept `api_uitvoeren` aan en schrijft het nieuwe document terug als `save` niet false is. Het antwoord bevat `output` (de uitkomst van het commando) en `saved` (true of false). Zonder `project` gaat het via het bedieningskanaal.
- **Een apptool** gaat altijd via het bedieningskanaal; zonder draaiende app volgt de bestaande "niet bereikbaar"-fout met remedie.

- [ ] **Test:**
  - `tools/list` bevat `model3d_node_add` met strikt schema en de velden `project`/`save`;
  - `tools/call` `model3d_node_add` op een tijdelijk projectbestand schrijft de knoop in het bestand;
  - met `save: false` blijft het bestand gelijk en komt de knoop wel in de uitkomst;
  - een fout pad geeft `BESTAND_ONLEESBAAR`.

  De bestaande `stdio_roundtrip.rs` en `schema_strikt.rs` blijven groen.
- [ ] **Implementeren**, `cargo test -p openaec-mcp-server`, commit.

### Task 11: App-adapter en bedieningskanaal

**Files:**
- Create `design-mockup/src/bediening/apiAdapter.ts`.
- Modify `bediening/bediening.ts` (cases `api_catalogus`, `api_uitvoeren`) en `App.tsx`. `BedieningActies.openFem3d.editModel(model, meta?)` → `dispatchOpenFem3D({ type: "edit", model })`. Verder setters voor gevallen en combinaties en het stramien, dezelfde die de dialogen gebruiken.
- Test: `design-mockup/scripts/api-bediening-browser.tsx` + `design-mockup/test-api-bediening-ui.mjs` (headless, naar het voorbeeld van `scripts/open-fem3d-selectie-browser.tsx`).

**Adapter:**
- `leesDocument(acties)`: het document uit de app, met dezelfde velden als bij Opslaan.
- `pasToe(acties, oud, nieuw)`:
  - alleen gewijzigde topvelden (vergelijking per referentie);
  - `model3d` via `editModel` (één stap ongedaan maken);
  - gevallen en combinaties via hun setters;
  - stramien via `setStructuralGrid`;
  - een ander gewijzigd veld (2D-model, fase 2) → `ALLEEN_IN_APP`-achtige fout `NOG_NIET_IN_APP`, en er wordt niets toegepast.

**App-commando's** (`soort: "app"`, alleen in de draaiende app; ze komen in `standaardRegister()` met een `uitvoeren` dat in de sidecar `ALLEEN_IN_APP` geeft, en in de app door de adapter wordt vervangen):
- `app.undo` en `app.redo`, voor de 3D-historie, dezelfde als Ctrl+Z en Ctrl+Y;
- `app.project.save` (`path?`): zelfde route als Opslaan / Opslaan als, zonder dialoog als `path` gegeven is.

- [ ] **Test** (browser):
  - `api_uitvoeren` `model3d.node.add` in de echte editor: de knoop staat in het model en op het tekenvlak;
  - `app.undo` haalt hem weg, `app.redo` zet hem terug, en Ctrl+Z doet hetzelfde;
  - `api_catalogus` geeft dezelfde lijst als de sidecar.
- [ ] **Implementeren, groen, commit.**

### Task 12: Dekkingstest 3D

**Files:** Create `design-mockup/src/api/dekking.ts`; Test `design-mockup/test-api-dekking.mjs`.

- [ ] **`dekking.ts`:** een lijst van alle 3D-GUI-functies:
  - de gereedschappen uit `openFem3dCommands.ts` (`OpenFem3DTool`);
  - de knoppen van het 3D-lint;
  - de velden van `OpenFem3DProperties.tsx` en `OpenFem3DNodeConditions.tsx`;
  - de sneltoetsen van `OpenFem3DEditor.tsx` en `ThreeFrameCanvas.tsx`.

  Elk met `commando` (een naam uit het register) of `fase` (2, 3 of 4) met een reden.
- [ ] **Test:**
  - elk `commando` bestaat in `standaardRegister()`;
  - geen 3D-modelfunctie staat nog op een uitzonderingslijst voor fase 1;
  - de lijst bevat elk lid van `OpenFem3DTool`, via een typecontrole met `satisfies Record<OpenFem3DTool, …>`.
- [ ] **Implementeren, groen, commit.**

### Task 13: Documentatie en volledige verificatie

**Files:** Modify `src-tauri/crates/openaec-mcp-server/README.md` (sectie "Commando's uit de app": hoe de tools heten, `project`/`save`, voorbeeld), `CLAUDE.md` (bij "Drie wegen": nieuwe modelfuncties krijgen een commando in `src/api/`; de dekkingstest bewaakt dat).

- [ ] **Volledige batterij:**
  - `npm run build:sidecar`;
  - `cargo build --release -p toetsbrug -p openaec-mcp-server`;
  - `npx tsc --noEmit`;
  - `node scripts/run-tests.mjs` en `--bundel` (logs volledig bewaren);
  - `cargo test --workspace --exclude open-fem-studio`;
  - ts-rs-regeleinden terugzetten.
- [ ] **Commit.**

## Uitvoering: waar die van het plan afweek

- **Taak 11, adapter.** Een veld dat de app nog niet als één stap kan toepassen,
  weigert de adapter met `INTERN` (niet met een nieuwe code `NOG_NIET_IN_APP`):
  geen enkel commando komt daar nu, het is een bewaking voor latere fasen.
  `project.new` merkt zijn uitkomst als nieuw project (`nieuwProject`); de app
  laadt het zoals Bestand → Nieuw, zonder bestand.
- **Taak 11, test.** In plaats van een browserharnas: `test-api-adapter.mjs`
  (adapter en kanaal met nagebootste app-acties) en `referentie-gui/api-app.mjs`,
  een rondgang door de echte app via de MCP-server. Ctrl+Z zelf wordt daar niet
  ingedrukt; `app.undo` loopt langs dezelfde tak als de sneltoets.
- **Taak 12.** De dekking legde vier ontbrekende functies bloot; die hebben nu
  een commando: `model3d.beam.flipLocalAxes`, `project.grid.get`,
  `project.grid.set` en `app.project.open`. `project.new` en
  `app.project.open` weigeren in de app bij niet-opgeslagen wijzigingen, tenzij
  `discardChanges`. De velden van het eigenschappenpaneel dekt `dekking.ts`
  via de modeltypen (`satisfies Record<keyof T, …>`; de test zoekt elk veld op
  in het schema van zijn commando); de knoppen van het paneel leest de test
  uit de bron.

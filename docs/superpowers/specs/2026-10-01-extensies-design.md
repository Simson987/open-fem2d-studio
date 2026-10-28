# Extensies: bestanden uit andere formaten openen

Ontwerp, 1 oktober 2026.

## Doel

Open FEM Studio krijgt een extensiesysteem. Een extensie is een map op de
eigen computer die de app laadt en die iets toevoegt; in versie 1 is dat één
ding: **een bestandsformaat importeren**. Bestand → Openen kent daarna ook de
bestandstypen van de geïnstalleerde extensies, en de MCP-server kan zulke
bestanden zonder app omzetten naar een projectbestand.

De repo bevat alleen het algemene systeem. Kennis van een bepaald extern
formaat hoort in de extensie zelf, en die kan buiten de repo blijven (privé,
alleen op de eigen machine).

## Buiten dit ontwerp

- Extensies die lintknoppen, vensters, wizards of API-commando's toevoegen
  (het manifest laat daar ruimte voor, versie 1 kent ze niet).
- Exporteren naar andere formaten.
- Een catalogus of het downloaden van extensies: installeren gaat per map.

## 1. Wat een extensie is

Een map met twee bestanden:

```
<map>/
  extension.json   het manifest
  index.js         één gebundeld script, zonder imports
```

**Manifest** (`extension.json`, streng: onbekende velden worden geweigerd):

| Veld | Type | Betekenis |
|---|---|---|
| `id` | tekst | uniek, omgekeerde domeinnaam, bijv. `nl.voorbeeld.importeur` |
| `name` | tekst | naam in de interface |
| `version` | tekst | semver, bijv. `1.2.0` |
| `apiVersion` | 1 | de versie van dit contract |
| `main` | tekst | het modulebestand, relatief in de map |
| `description` | tekst, optioneel | korte omschrijving |
| `author`, `category` | tekst, optioneel | voor de kaart in het beheerpaneel |
| `importers` | lijst | per importeur: `id`, `label`, `fileExtensions` (zonder punt, kleine letters), `dimension` (`"2d"` of `"3d"`) |

**Script.** Een klassiek script (geen ES-module) dat `globalThis.openFemExtension`
zet; bundelen kan met esbuild `--format=iife --global-name=openFemExtension`.
Zo draait hetzelfde bestand in een Web Worker (de app) en in een `vm`-context
(Node, zonder app). Een ES-module zou in de worker een tweede Blob-URL moeten
importeren, en in Node een experimentele vlag vragen.

```js
async function importFile({ importerId, fileName, bytes }) {
  // bytes: Uint8Array met de inhoud van het bestand
  return {
    project: { /* inhoud van een .ifcfem, als object */ },
    messages: [{ level: "info" | "warning", text: "…" }],
  };
}
globalThis.openFemExtension = { importFile };
```

- `project` is een gewoon Open FEM-projectdocument, met `format` en `version`
  zoals in een `.ifcfem`. De app leest het met dezelfde strikte lezer als bij
  Openen (`deserializeProject`); een document dat daar niet doorheen komt, wordt
  geweigerd met de reden van de lezer.
- `messages` vormen het importverslag: wat er overkwam, wat er is aangenomen en
  wat niet is overgenomen.
- De functie is zuiver: geen DOM, geen netwerk, geen bestanden. Bytes erin,
  project eruit. Een fout wordt een melding in de app, geen crash.

## 2. Installeren en beheren

Het bestaande paneel **Bestand → Extensies** (`ExtensionManagerPanel.tsx`)
krijgt echte inhoud. Nu toont het voorbeeldgegevens uit het sjabloon en doen
"+ ZIP" en de tab Bladeren niets; die voorbeelden en de tab Bladeren
verdwijnen (er is geen catalogus in versie 1). De kaarten blijven:

- per extensie een kaart met naam, versie, auteur, categorie, omschrijving, de
  bestandstypen en de map, en de schakelaar aan/uit (bewaard per machine);
- **+ ZIP**: een gezipte extensie installeren in de vaste map `extensions/` in
  de app-datamap (uitpakken in een eigen submap, met het manifest gekeurd vóór
  er iets geschreven wordt);
- **Map koppelen…**: kies een map met een `extension.json`. De map blijft waar
  ze staat (zo blijft een privé-extensie op haar eigen plek); de app onthoudt
  het pad per machine (`preferences.json`);
- per kaart **Ontkoppelen** (gekoppelde map) of **Verwijderen** (geïnstalleerd
  via ZIP), en bovenaan **Opnieuw laden** (na een wijziging in een map);
- elke submap van `extensions/` met een manifest is een geïnstalleerde extensie;
- het manifest mag ook `author` en `category` hebben (optioneel), voor de kaart;
- een fout in een manifest staat bij de extensie in de lijst (welke regel, welk
  veld); de extensie doet dan niet mee.

Bij het koppelen meldt de app: *een extensie draait code op deze computer;
koppel alleen extensies die je zelf maakte of vertrouwt.*

Twee extensies die hetzelfde bestandstype aanbieden: de app vraagt bij het
openen welke importeur.

## 3. Openen in de app

- **Bestand → Openen** krijgt in de keuzelijst naast "Open FEM Studio-project"
  per importeur een filter met zijn bestandstypen, en "Alle ondersteunde
  bestanden".
- Bij een bestand van een extensie:
  1. dezelfde vraag over niet-opgeslagen werk als bij Openen;
  2. Rust leest het bestand als bytes (alleen bestandstypen die een
     ingeschakelde extensie aanbiedt; het bestandsbereik van de app wordt niet
     ruimer);
  3. de module draait in een **Web Worker** (geen toegang tot de pagina, de
     app-opdrachten of bestanden; netwerk volgt het beveiligingsbeleid van de
     app), met een tijdslimiet van 60 s;
  4. het project gaat door `deserializeProject`;
  5. de app laadt het als **nieuw project zonder bestand**, zoals Bestand →
     Nieuw (Opslaan vraagt daarna om een pad); de titel noemt het bronbestand;
  6. het **importverslag** verschijnt: de meldingen van de extensie, met de
     naam en versie van de extensie.
- Het beveiligingsbeleid (CSP) krijgt `worker-src 'self' blob:`; de module
  wordt als Blob-URL in een module-worker geladen.

## 4. MCP en API

- **API-commando `app.project.import`** (`path`, `discardChanges`): in de app
  zoals Bestand → Openen, met dezelfde bewaking van niet-opgeslagen werk als
  `app.project.open`. Komt in de catalogus en dus als MCP-tool.
- **MCP-tool zonder app** `project_import` (`path`, `save_as`, optioneel
  `importer`): de MCP-server geeft de extensiemappen door aan de sidecar; die
  zoekt de importeur, laadt de module in Node, voert `importFile` uit, keurt het
  project met dezelfde lezer en schrijft `save_as` (eerst ernaast, dan in één
  keer vervangen). Het antwoord bevat de meldingen.
- **`extensions.list`**: de geïnstalleerde extensies met hun importeurs.
- Zonder app draait een extensie in Node, met de rechten van de MCP-server.
  Dat staat in de documentatie, met hetzelfde advies als in de app.

## 5. Opbouw

| Deel | Waar | Wat |
|---|---|---|
| Manifest en contract | `design-mockup/src/extensies/manifest.ts` | typen, strikte keuring van `extension.json`, keuring van het resultaat van `importFile`; gedeeld door app en sidecar |
| Mappen lezen | `src-tauri/src/extensies.rs` | Tauri-commando's: extensiemappen scannen (vaste map + gekoppelde paden), manifest en module als tekst teruggeven, een te importeren bestand als bytes lezen |
| Draaien in de app | `design-mockup/src/extensies/worker.ts` | de Blob-URL, de module-worker, de tijdslimiet en het berichtenprotocol |
| Openen | `App.tsx`, `io/projectFile.ts` | filters, het importpad, het verslag |
| Beheer | `components/backstage/ExtensionManagerPanel.tsx` | de kaarten, aan/uit, + ZIP, map koppelen, ontkoppelen/verwijderen, opnieuw laden |
| API | `design-mockup/src/api/` | `app.project.import`, `extensions.list`; dekking in `dekking.ts` |
| Sidecar en MCP | `design-mockup/src/mcp/`, `openaec-mcp-server` | bewerking `extensie_importeren`, tool `project_import` |
| Documentatie | `docs/extensies.md` | een extensie schrijven: manifest, module, projectformaat, bundelen, testen |
| Testextensie | `design-mockup/test-fixtures/extensie-voorbeeld/` | een importeur voor een verzonnen tekstformaat (`.demofem`): een paar knopen, staven, opleggingen en een last |

## 6. Testen

- **Manifest en contract** (Node): geldige en ongeldige manifesten met de
  juiste foutmelding; een resultaat zonder `format`, met onbekende velden of met
  een te nieuwe versie wordt geweigerd.
- **De testextensie end-to-end in Node**: `.demofem` → project → dezelfde
  lezer → het verwachte model.
- **In de browser** (headless): de module-worker laadt de testextensie, de
  tijdslimiet stopt een module die blijft hangen, een module die een fout gooit
  geeft een melding.
- **Rust**: scannen van mappen, een kapot manifest, bytes lezen alleen voor
  aangeboden bestandstypen.
- **MCP**: `project_import` met de testextensie schrijft een project dat de app
  kan openen; een onbekend bestandstype geeft een duidelijke fout.
- **Echte app** (`referentie-gui/`): Openen met de testextensie via het
  bedieningskanaal, het verslag en Opslaan.

## 7. Volgorde

1. Het extensiesysteem met de testextensie, in de repo (dit ontwerp).
2. Een privé-extensie buiten de repo met de eerste importeur (2D), gebouwd op
   bestaand eigen gereedschap; gecontroleerd tegen eerdere omzettingen.
3. Dezelfde extensie uitgebreid met een 3D-importeur.

Stap 2 en 3 staan niet in de repo en vallen buiten dit document.

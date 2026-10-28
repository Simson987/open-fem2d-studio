# API en MCP voor alle functies

Datum: 2026-10-01. Status: ontwerp goedgekeurd (aanpak, zonder app, volgorde).

## Waarom

Een AI moet Open FEM Studio volledig kunnen bedienen: een model opbouwen en
wijzigen, rekenen, toetsen, resultaten uitlezen en een rapport maken. Nu kan
dat maar ten dele:

- **Wat de app heeft:** ongeveer 330 functies, circa 450 als je elke vlag en
  elk toetsveld apart telt.
- **Wat een AI kan:** het bedieningskanaal kent 25 opdrachten, in één `switch`
  in `bediening/bediening.ts`. De MCP-server heeft 51 tools, met de hand
  geschreven, en schema's in Rust.
- **Wat ontbreekt:**
  - elementen wijzigen, verwijderen of transformeren;
  - opslaan, nieuw, ongedaan maken en exports;
  - belastinggevallen, combinaties en projectgegevens;
  - de meeste rekeninstellingen;
  - 2D-platen en de generatoren;
  - de 2D-weergave en selectie;
  - een willekeurig 3D-project doorrekenen en toetsen zonder geopende app.

Elke functie apart als Rust-tool naschrijven betekent circa 300 tools dubbel
bijhouden. Dit ontwerp maakt één register de bron, en de rest volgt daaruit.

## Besluiten

1. **Eén commandoregister in de app** (`design-mockup/src/api/`).
   - Het bedieningskanaal en de MCP-tools komen er automatisch uit.
   - De GUI-knoppen gaan per fase via hetzelfde register. Zo doen API en GUI
     precies hetzelfde.
2. **Zonder geopende app** werken modelbewerking, rekenen, toetsen en rapport
   op een projectbestand. Weergave, selectie en schermafbeeldingen gaan via de
   draaiende app.
3. **Volgorde:**
   1. fundament en 3D-model;
   2. 2D-model;
   3. rekenen en toetsen;
   4. weergave, rapport, instellingen en export.

## Architectuur

### Commando

```ts
interface ApiCommando<Invoer, Uitkomst> {
  naam: string;            // "model3d.beam.update" — domein.object.actie, Engels
  beschrijving: string;    // Nederlands, voor de MCP-toolbeschrijving
  invoer: ApiSchema;       // strikt JSON-schema (subset, zie onder)
  soort: "document" | "app";
  uitvoeren(invoer: Invoer, context: ApiContext): Uitkomst | Promise<Uitkomst>;
}
```

- **Namen en velden in het Engels**, gelijk aan het datamodel (`nodes`,
  `startNodeId`, `profileName`, `memberLoads`) en de bestaande tools.
  Beschrijvingen en foutmeldingen zijn Nederlands. Dat is de conventie van
  `mcp/protocol.ts`.
- **`document`-commando's zijn zuiver.** Ze werken van projectdocument naar
  projectdocument plus een uitkomst, zonder React, DOM of Tauri. Ze gaan mee
  in de sidecarbundel en werken dus ook zonder app.
- **`app`-commando's** hebben de draaiende app nodig: weergave, selectie,
  zichtbaarheid, ongedaan maken, schermafbeelding.

### Projectdocument

Het projectdocument is de vorm van een `.ifcfem`-bestand
(`io/projectFile.ts`): het 2D-model, `model3d`, de gedeelde gevallen en
combinaties, de reken- en projectinstellingen. Een `document`-commando krijgt
het document en geeft een nieuw document terug. Het oude document blijft
ongewijzigd.

- **In de app:** de adapter leest het document uit de stores en zet het
  resultaat terug, als één stap in de historie (Ctrl+Z).
  - 3D loopt via `openFem3dHistoryReducer`.
  - 2D vraagt in fase 2 eerst zuivere functies in plaats van de mutators van
    `useFemStore`.
- **Zonder app:** de MCP-server leest het bestand, de sidecar voert het
  commando uit op de tekst, en de MCP-server schrijft het resultaat terug als
  dat gevraagd is.

### Schema's en validatie

- **Eigen strenge validator** voor een vaste subset van JSON Schema:
  `type`, `properties`, `required`, `additionalProperties: false`, `enum`,
  `const`, `minimum`/`maximum`, `exclusiveMinimum`, `items`,
  `minItems`/`maxItems`, `oneOf` en `description`. Geen nieuwe afhankelijkheid.
  Elk commando valideert zijn invoer vóór uitvoering. Een tikfout in een
  veldnaam geeft een fout, geen stille standaardwaarde.
- **Een test** controleert dat elk schema op elk niveau
  `additionalProperties: false` heeft, net als `tests/schema_strikt.rs`.

### Kanalen

- **Bedieningskanaal (app).**
  - Nieuwe paginaopdrachten: `api_catalogus` (namen en schema's) en
    `api_uitvoeren` (`{ naam, invoer }`).
  - De 25 bestaande opdrachten blijven werken. Waar een registercommando ze
    vervangt, roept de oude naam het nieuwe commando aan.
  - Token, localhost en `OPENAEC_GUI_CONTROL=1` blijven zoals ze zijn.
- **Sidecar (zonder app).**
  - Nieuwe bewerkingen: `api_catalogus` en `api_uitvoeren`
    (`{ naam, invoer, project: <tekst> }` → `{ uitkomst, project: <tekst> }`).
  - Het projectbestand wordt alleen in Rust gelezen en geschreven.
- **MCP.**
  - Bij `tools/list` haalt de server de catalogus uit de sidecar. Dat werkt
    altijd, ook zonder app. Elk commando wordt een tool met de naam van het
    commando, met `_` voor `.` (`model3d_beam_update`).
  - **Een `document`-tool** krijgt twee extra velden:
    - `project` (pad naar een `.ifcfem`): uitvoeren zonder app op dat bestand,
      en terugschrijven tenzij `save: false`;
    - zonder `project`: uitvoeren in de draaiende app.
  - **Een `app`-tool** loopt altijd via het bedieningskanaal.
  - De 51 bestaande tools blijven.

### Dekking

Elke knop, elk menu-item, elk tekengereedschap en elke sneltoets krijgt een
verwijzing naar een commando. Een dekkingstest faalt als een GUI-functie geen
commando heeft. Vóór de fase van een functie staat ze op een uitzonderingslijst
met de geplande fase; die lijst krimpt per fase tot leeg. Zo blijft "alle
functies" na fase 4 waar, ook als de GUI groeit.

## Fasen

1. **Fundament en 3D-model.**
   - Register, validator, document, app-adapter (3D) en kanaal- en
     sidecarbewerkingen.
   - Dynamische MCP-tools en de eerste dekkingstest (3D).
   - 3D-commando's:
     - `project.*`: nieuw, openen, opslaan, model lezen;
     - knopen, staven (eigenschappen, scharnieren, splitsen, trek-alleen,
       rolhoek), platen en openingen;
     - opleggingen (veren, opgelegde verplaatsing);
     - lasten (knoop, staaf, staafpunt, thermisch, vlak), belastingvlakken,
       schijven, levels en stramien;
     - transformaties;
     - gedeelde gevallen en combinaties;
     - ongedaan maken en opnieuw (app).
2. **2D-model.** Eerst de mutators van `useFemStore` naar zuivere functies,
   dan dezelfde dekking voor 2D, plus platen, wind- en watergeneratoren,
   stramien en omzetten naar 3D.
3. **Rekenen en toetsen.**
   - Alle rekeninstellingen: analysetype, eigen gewicht, scheefstand, kruip,
     segmentlengte, trek-alleen.
   - Toetsinstellingen per staaf.
   - Rekenen en toetsen voor elk project zonder app, inclusief 3D-beton en de
     spanningstoets.
   - Resultaten uitlezen: krachten, verplaatsingen, reacties, UC's.
   - De twee toetsbrugopdrachten die nog niet in MCP staan.
4. **Weergave, rapport, instellingen en export.**
   - Aanzichten, zichtbaarheid, selectie en view sets.
   - Rapportsecties en opmaak.
   - Projectgegevens en voorkeuren.
   - IFC- en CSV-export, en de overige vensters.

Fase 1 bouwt de coördinator zelf, want die legt de vorm vast. De commando's van
fasen 2–4 kunnen door parallelle agents in eigen worktrees worden gebouwd,
per domein. De coördinator integreert en draait de volledige batterij.

## Testen

- **Per commando** een zuivere test op het document: vóór, na, uitkomst en
  fouten.
- **Schema's:** strengheid op elk niveau, en de validator zelf met
  randgevallen.
- **Gelijkheid:** dezelfde handeling via de GUI-handler en via het commando
  geeft hetzelfde document.
- **Rondgang zonder app:** de MCP-server over stdio, `tools/list` bevat de
  catalogus, en `tools/call` op een tijdelijk projectbestand wijzigt dat
  bestand.
- **Rondgang met app:** een browsertest met de echte editor, die
  `api_uitvoeren` uitvoert en de historie controleert.
- **Dekking:** de uitzonderingslijst bevat alleen geplande fasen.

## Buiten dit ontwerp

- De app starten vanuit MCP.
- Toegang van buiten deze computer.
- Meerdere gebruikers tegelijk.

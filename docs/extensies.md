# Lokale importextensies

Een extensie leert Open FEM Studio een extra bestandsformaat in te lezen. Zij
verandert geen rekenkern en voegt geen vensters of lintknoppen toe. Een
geïmporteerd bestand wordt een nieuw, nog niet opgeslagen Open FEM-project.

## Installeren

Open **Bestand → Extensies**. Kies **+ ZIP** om een extensie in de vaste
app-datamap te installeren, of **Map koppelen…** om een bestaande map op haar
plaats te laten staan. Het paneel toont per extensie haar bestandstypen,
versie, map en eventuele manifestfout. Aan/uit en gekoppelde mappen worden per
computer in `preferences.json` bewaard. Na een wijziging in een gekoppelde map
kiest u **Opnieuw laden**.

Een extensie voert code uit op deze computer. Installeer of koppel alleen
extensies die u zelf maakte of vertrouwt. In de app draait importcode in een
Web Worker met een tijdslimiet van 60 seconden, zonder toegang tot de pagina of
het Tauri-kanaal. De MCP-server draait haar in Node met de rechten van die
server; de Node-context is geen beveiligingsgrens voor niet-vertrouwde code.

**Bestand → Openen** toont de bestandstypen van ingeschakelde extensies. Zijn
er meerdere importeurs voor hetzelfde bestandstype, dan vraagt de app welke u
wilt gebruiken. Het resultaat gaat door dezelfde strikte projectlezer als een
`.ifcfem`-bestand. Het nieuwe project heeft nog geen opslagpad, dus **Opslaan**
vraagt om een bestandsnaam. Het importverslag noemt de gebruikte extensie en
alle meldingen van de importeur.

## Een extensie schrijven

Een extensie is een map met `extension.json` en één klassiek JavaScript-bestand:

```text
mijn-extensie/
  extension.json
  index.js
```

Het manifest is streng: onbekende velden en ongeldige waarden worden geweigerd.

```json
{
  "id": "nl.voorbeeld.importeur",
  "name": "Mijn importeur",
  "version": "1.0.0",
  "apiVersion": 1,
  "main": "index.js",
  "description": "Leest een voorbeeldformaat.",
  "author": "Mijn organisatie",
  "category": "Import/Export",
  "importers": [
    { "id": "voorbeeld", "label": "Voorbeeldbestand", "fileExtensions": ["demo"], "dimension": "2d" }
  ]
}
```

`id` is een unieke omgekeerde domeinnaam. `main` is een relatief pad binnen
de extensiemap. `fileExtensions` bevat kleine letters zonder punt. Een
extensie kan meer dan één importeur aanbieden.

Het script is een **klassiek script**, zonder imports. Het zet
`globalThis.openFemExtension` en ontvangt de bestandsbytes als `Uint8Array`:

```js
async function importFile({ importerId, fileName, bytes }) {
  const inhoud = new TextDecoder("utf-8").decode(bytes);
  // Lees hier uw formaat. `project` is een volledig .ifcfem-document als object.
  return {
    project: {
      format: "open-fem-studio-v2",
      version: 2,
      modelDimension: "2d",
      nodes: [], beams: [], supports: [], plates: [], loads: [],
      loadCases: [{ id: 1, name: "Permanent (G)", type: "dead" }],
      activeLoadCaseId: 1,
      selfWeightEnabled: false
    },
    messages: [{ level: "info", text: `${fileName}: import voltooid` }]
  };
}
globalThis.openFemExtension = { importFile };
```

`messages` bevat objecten met `level: "info"` of `"warning"` en tekst. De
projectlezer keurt de volledige projectstructuur; een onleesbaar document
wordt niet geopend of opgeslagen. Een bundler kan het script als IIFE maken,
bijvoorbeeld met `esbuild --bundle --format=iife`; het resultaat moet
`globalThis.openFemExtension` zetten.

Een complete testextensie staat in
[`design-mockup/test-fixtures/extensie-voorbeeld/`](../design-mockup/test-fixtures/extensie-voorbeeld/).
Het verzonnen `.demofem`-formaat bevat knopen, staven, opleggingen en een last.

## API en MCP

In de draaiende app importeert `app.project.import` een absoluut `path` en
optioneel een `importer`. Bij niet-opgeslagen werk is `discardChanges: true`
nodig. `extensions.list` geeft de gevonden extensies, fouten en aan/uit-status.

Zonder app biedt de MCP-server `project_import` met `path` en `save_as` (een
absoluut `.ifcfem`-pad). Een optionele `importer` kiest tussen meerdere
importeurs. Deze tool vereist Node.js 22.3 of nieuwer. De server vindt
geïnstalleerde extensies in de app-datamap en
gekoppelde mappen in `preferences.json`. Extra mappen kunnen via
`OPENAEC_EXTENSIONS_DIRS` worden doorgegeven (op Windows gescheiden door `;`,
op Linux en macOS door `:`). Uitgeschakelde extensies worden overgeslagen.
Het project wordt eerst gekeurd en dan naast het doelbestand geschreven,
voordat het doel in één stap wordt vervangen. Het antwoord bevat de meldingen
en de naam en versie van de extensie.

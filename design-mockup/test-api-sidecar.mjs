// De API-commando's langs de sidecar (src/mcp/apiSidecar.ts): api_catalogus
// en api_uitvoeren op de tekst van een projectbestand, zonder app. Draait ook
// tegen de BUNDEL: dat is wat de MCP-server uitvoert.
import { readFileSync } from "node:fs";
import { verwerkVerzoek, isStrikt, leegDocument, documentNaarTekst, standaardCommandos } from "./src/mcp/kernel-exports.ts";

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
let volgnummer = 0;
const vraag = (op, payload) => verwerkVerzoek({ v: 1, id: ++volgnummer, op, payload });

console.log("[1] catalogus");
const catalogus = vraag("api_catalogus", {});
const commandos = catalogus.result?.commands ?? [];
check("ok, met alle commando's van het register", catalogus.ok && commandos.length === standaardCommandos().length && commandos.length > 50,
  String(commandos.length));
check("elk commando: naam, beschrijving, invoerschema en soort",
  commandos.every((c) => c.name && c.description && c.inputSchema?.type === "object" && (c.kind === "document" || c.kind === "app")));
check("elk invoerschema streng op elk niveau", commandos.every((c) => isStrikt(c.inputSchema).length === 0),
  commandos.filter((c) => isStrikt(c.inputSchema).length > 0).map((c) => c.name).join());
check("unieke namen", new Set(commandos.map((c) => c.name)).size === commandos.length);
check("documentcommando's en app-commando's", commandos.find((c) => c.name === "model3d.node.add")?.kind === "document"
  && commandos.find((c) => c.name === "app.undo")?.kind === "app");
const ingebakken = JSON.parse(readFileSync(new URL("../src-tauri/crates/openaec-mcp-server/assets/api-catalogus.json", import.meta.url), "utf8"));
check("de catalogus in de MCP-server is gelijk aan deze (anders: npm run build:sidecar)",
  JSON.stringify(ingebakken) === JSON.stringify(catalogus.result));

console.log("\n[2] uitvoeren op een projectbestand");
let project = documentNaarTekst(leegDocument());
const doe = (name, input) => {
  const antwoord = vraag("api_uitvoeren", { name, input, project });
  if (antwoord.ok && antwoord.result.project) project = antwoord.result.project;
  return antwoord;
};
const eerste = doe("model3d.node.add", { x: 0, y: 0, z: 0 });
check("knoop toevoegen: uitkomst en nieuwe projecttekst", eerste.ok && eerste.result.output.node.id === 1
  && JSON.parse(eerste.result.project).model3d.nodes.length === 1, JSON.stringify(eerste).slice(0, 200));
doe("model3d.node.add", { x: 6, y: 0, z: 0 });
const staaf = doe("model3d.beam.add", { startNodeId: 1, endNodeId: 2, profileName: "HEA 200" });
check("een keten van commando's op dezelfde tekst", staaf.ok && JSON.parse(project).model3d.beams[0].profileName === "HEA 200");
const lezen = vraag("api_uitvoeren", { name: "model3d.get", input: {}, project });
check("een lezend commando geeft project null", lezen.ok && lezen.result.project === null && lezen.result.output.counts.beams === 1);
const nieuw = vraag("api_uitvoeren", { name: "project.new", input: {} });
check("project.new zonder bestand", nieuw.ok && JSON.parse(nieuw.result.project).modelDimension === "3d");

console.log("\n[3] fouten");
const onbekend = vraag("api_uitvoeren", { name: "model3d.node.ad", input: {}, project });
check("onbekend commando → ONBEKEND_COMMANDO met suggesties", !onbekend.ok && onbekend.error.code === "ONBEKEND_COMMANDO"
  && onbekend.error.detail.suggesties.includes("model3d.node.add"), JSON.stringify(onbekend.error));
const ongeldig = vraag("api_uitvoeren", { name: "model3d.node.add", input: { x: 1, y: 1 }, project });
check("ongeldige invoer → INVOER_ONGELDIG met de problemen", !ongeldig.ok && ongeldig.error.code === "INVOER_ONGELDIG"
  && ongeldig.error.detail.problemen[0].pad === ".z", JSON.stringify(ongeldig.error));
const weigering = vraag("api_uitvoeren", { name: "model3d.beam.add", input: { startNodeId: 1, endNodeId: 2 }, project });
check("een modelregel weigert → GEWEIGERD", !weigering.ok && weigering.error.code === "GEWEIGERD" && weigering.error.melding.includes("staaf 1"));
const nietGevonden = vraag("api_uitvoeren", { name: "model3d.node.delete", input: { id: 9 }, project });
check("onbekende knoop → NIET_GEVONDEN", !nietGevonden.ok && nietGevonden.error.code === "NIET_GEVONDEN");
const app = vraag("api_uitvoeren", { name: "app.undo", input: {}, project });
check("app-commando zonder app → ALLEEN_IN_APP", !app.ok && app.error.code === "ALLEEN_IN_APP");
const geenProject = vraag("api_uitvoeren", { name: "model3d.node.add", input: { x: 0, y: 0, z: 0 } });
check("documentcommando zonder project → GEEN_DOCUMENT", !geenProject.ok && geenProject.error.code === "GEEN_DOCUMENT");
const kapot = vraag("api_uitvoeren", { name: "model3d.get", input: {}, project: "{ geen json" });
check("onleesbare projecttekst → BESTAND_ONLEESBAAR", !kapot.ok && kapot.error.code === "BESTAND_ONLEESBAAR");
const extraVeld = vraag("api_uitvoeren", { name: "model3d.get", input: {}, project, opslaan: true });
check("onbekend veld in het verzoek → INVOER_ONGELDIG", !extraVeld.ok && extraVeld.error.code === "INVOER_ONGELDIG");

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

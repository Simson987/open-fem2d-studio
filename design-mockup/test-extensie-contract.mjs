// Het contract van een extensie (src/extensies/manifest.ts, docs/extensies.md):
// het manifest, wat importFile teruggeeft, de keuze van de importeur, en het
// draaien van een extensiescript in Node (src/mcp/extensieSidecar.ts) — met de
// testextensie in test-fixtures/extensie-voorbeeld (een verzonnen tekstformaat).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { keurManifest, keurImportResultaat, importeurVoorBestand } = await import("./src/extensies/manifest.ts");
const { laadExtensieScript } = await import("./src/mcp/extensieSidecar.ts");
const { deserializeProject } = await import("./src/io/projectFile.ts");

const HIER = dirname(fileURLToPath(import.meta.url));
const VOORBEELD = join(HIER, "test-fixtures", "extensie-voorbeeld");
const lees = (naam) => readFileSync(join(VOORBEELD, naam));

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};

console.log("[1] het manifest van de testextensie");
const goed = keurManifest(lees("extension.json").toString());
check("geldig", goed.ok, JSON.stringify(goed));
const manifest = goed.manifest;
check("één importeur voor .demofem, 2D", manifest?.importers.length === 1 && manifest.importers[0].fileExtensions[0] === "demofem"
  && manifest.importers[0].dimension === "2d");

console.log("\n[2] ongeldige manifesten, elk met zijn reden");
const basis = JSON.parse(lees("extension.json").toString());
const fout = (wijziging) => {
  const k = keurManifest(JSON.stringify(wijziging(structuredClone(basis))));
  return k.ok ? "" : k.fouten.join(" | ");
};
check("geen JSON", !keurManifest("{ kapot").ok && keurManifest("{ kapot").fouten[0].includes("geen geldige JSON"));
check("onbekend veld", /Onbekend veld "kleur"/.test(fout((m) => ({ ...m, kleur: "rood" }))));
check("main ontbreekt", /"main"/.test(fout((m) => { delete m.main; return m; })));
check("main buiten de map", /binnen de extensiemap/.test(fout((m) => ({ ...m, main: "../elders.js" }))));
check("apiVersion 2", /apiVersion/.test(fout((m) => ({ ...m, apiVersion: 2 }))));
check("bestandstype met punt", /zonder punt/.test(fout((m) => { m.importers[0].fileExtensions = [".demofem"]; return m; })));
check("dubbele importeur-id", /twee keer/.test(fout((m) => { m.importers.push({ ...m.importers[0] }); return m; })));
check("dimensie 4d", /dimension/.test(fout((m) => { m.importers[0].dimension = "4d"; return m; })));
check("id zonder punt", /omgekeerde domeinnaam/.test(fout((m) => ({ ...m, id: "voorbeeld" }))));
check("geen importeurs", /minstens één importeur/.test(fout((m) => ({ ...m, importers: [] }))));

console.log("\n[3] de testextensie importeert, in Node");
const extensie = laadExtensieScript(lees("index.js").toString(), "index.js");
const ruw = await extensie.importFile({ importerId: "demofem", fileName: "voorbeeld.demofem", bytes: new Uint8Array(lees("voorbeeld.demofem")) });
const uitkomst = keurImportResultaat(ruw);
const project = deserializeProject(uitkomst.projectTekst);
check("een project dat de lezer van Openen leest: 4 knopen, 3 staven, 2 opleggingen, 1 last",
  project.nodes.length === 4 && project.beams.length === 3 && project.supports.length === 2 && project.loads.length === 1,
  `${project.nodes.length}/${project.beams.length}/${project.supports.length}/${project.loads.length}`);
check("profielnamen zoals de bibliotheek ze kent", project.beams.map((b) => b.profile).join() === "HEA 200,IPE 300,HEA 200");
check("het verslag: de aantallen en één waarschuwing voor de onbekende regel",
  uitkomst.meldingen[0].level === "info" && uitkomst.meldingen.filter((m) => m.level === "warning").length === 1
    && /kleur rood/.test(uitkomst.meldingen.find((m) => m.level === "warning").text), JSON.stringify(uitkomst.meldingen));
check("opnieuw geschreven zoals Opslaan (actueel formaat)", JSON.parse(uitkomst.projectTekst).format === "open-fem-studio-v2");

console.log("\n[4] wat importFile teruggeeft, wordt gekeurd");
const weigert = (waarde, patroon) => { try { keurImportResultaat(waarde); return false; } catch (e) { return patroon.test(e.message); } };
check("geen object", weigert(42, /geen object/));
check("geen project", weigert({ messages: [] }, /geen project/));
check("messages geen lijst", weigert({ project: ruw.project, messages: "hoi" }, /geen lijst/));
check("een verkeerde melding", weigert({ project: ruw.project, messages: [{ level: "fout", text: "x" }] }, /messages\[0\]/));
check("een project met een te nieuwe versie: de reden van de lezer",
  weigert({ project: { ...ruw.project, version: 99 } }, /nieuwere versie/));
check("een project zonder lijst nodes: de reden van de lezer",
  weigert({ project: { ...ruw.project, nodes: undefined } }, /nodes/));

console.log("\n[5] een script zonder openFemExtension");
let melding = "";
try { laadExtensieScript("const x = 1;", "leeg.js"); } catch (e) { melding = e.message; }
check("duidelijke fout", /openFemExtension/.test(melding), melding);
try { laadExtensieScript("throw new Error('stuk')", "stuk.js"); melding = ""; } catch (e) { melding = e.message; }
check("een fout bij het laden noemt het script en de fout", /stuk\.js/.test(melding) && /stuk/.test(melding), melding);

console.log("\n[6] de importeur voor een bestand");
const geladen = [
  { map: "a", manifest, ingeschakeld: true },
  { map: "b", manifest: { ...manifest, id: "org.openaec.tweede", importers: [{ ...manifest.importers[0], id: "andere" }] }, ingeschakeld: true },
  { map: "c", manifest: { ...manifest, id: "org.openaec.uit" }, ingeschakeld: false },
];
check("op bestandstype, hoofdletterongevoelig, alleen ingeschakeld: twee kandidaten",
  importeurVoorBestand(geladen, "C:/werk/Portaal.DEMOFEM").length === 2);
check("met importerId alleen die", importeurVoorBestand(geladen, "x.demofem", "andere").map((k) => k.extensie.map).join() === "b");
check("een ander bestandstype: geen", importeurVoorBestand(geladen, "x.txt").length === 0);

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

// De API-commando's in de app (src/bediening/apiAdapter.ts), met nagebootste
// app-acties: welk commando welke actie aanroept, één 3D-stap per commando,
// levels in dezelfde stap, gevallen via de store, en een antwoord met `ok`.
// Blok [8] gaat door het bedieningskanaal zelf (`voerUit` in bediening.ts).
import { register } from "node:module";

// bediening.ts trekt via de rapportmodules stylesheets (KaTeX) mee; Node kent
// die niet. Een lege module volstaat: hier wordt geen opmaak gelezen.
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function load(url, ctx, next) {" +
        " if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };" +
        " return next(url, ctx); }",
    ),
);
const { appRegister, pasToe, voerApiUitInApp } = await import("./src/bediening/apiAdapter.ts");
const { standaardRegister } = await import("./src/api/standaardRegister.ts");
const { leegDocument, model3dVan, documentUitTekst } = await import("./src/api/projectDocument.ts");
const { combinationsToFile } = await import("./src/io/projectFile.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};

/** Een nagebootste app: één document, en een logboek van de aangeroepen acties. */
function nepApp(start = leegDocument()) {
  let doc = start;
  const log = [];
  const acties = {
    document: () => doc,
    bewerk3D: (model, stramien, extern) => {
      log.push(["bewerk3D", stramien ? "met stramien" : "zonder stramien", ...(extern ? ["met gevallen"] : [])]);
      doc = { ...doc, model3d: model, ...(stramien ? { structuralGrid: stramien } : {}) };
      acties.laatsteExtern = extern ?? null;
    },
    zetModelDimensie: (d) => { log.push(["zetModelDimensie", d]); doc = { ...doc, modelDimension: d }; },
    zetStramien: (stramien) => { log.push(["zetStramien"]); doc = { ...doc, structuralGrid: stramien }; },
    zetGevallen: (p) => {
      log.push(["zetGevallen", p.loadCases.length]);
      // Zoals de app: het volgende document() schrijft de combinaties zoals Opslaan.
      doc = { ...doc, loadCases: p.loadCases, loads: p.loads, activeLoadCaseId: p.activeLoadCaseId, selfWeightEnabled: p.selfWeightEnabled,
        combinations: combinationsToFile(p.combinations) };
      acties.laatsteCombinaties = p.combinations;
    },
    nieuwProject: async (tekst) => { log.push(["nieuwProject"]); doc = documentUitTekst(tekst); },
    // Zoals de app: `false` als er geen stap was (issue #244, punt 001).
    ongedaanMaken: () => { log.push(["ongedaanMaken"]); return acties.geenStap !== true; },
    opnieuw: () => { log.push(["opnieuw"]); return acties.geenStap !== true; },
    opslaan: async (pad) => { log.push(["opslaan", pad ?? null]); return pad ?? "C:/huidig.ifcfem"; },
    openen: async (pad) => { log.push(["openen", pad]); return pad; },
    importeren: async (pad, importerId) => {
      log.push(["importeren", pad, importerId ?? null]);
      return { meldingen: [{ level: "info", text: "3 knopen" }], extensie: { id: "org.openaec.voorbeeld", name: "Voorbeeldformaat", version: "1.0.0" } };
    },
    extensies: async () => [{ map: "C:/extensies/demo", bron: "gekoppeld", ingeschakeld: true,
      manifest: { id: "org.openaec.voorbeeld", name: "Voorbeeldformaat", version: "1.0.0", importers: [] } }],
    heeftNietOpgeslagenWerk: () => acties.nietOpgeslagen === true,
    zetSelectie3D: (selectie) => log.push(["zetSelectie3D", selectie]),
  };
  return { acties, log, doc: () => doc };
}

console.log("[1] catalogus");
const namenApp = appRegister(nepApp().acties).catalogus().map((c) => c.naam).join();
const namenSidecar = standaardRegister().catalogus().map((c) => c.naam).join();
check("de app toont dezelfde catalogus als de sidecar", namenApp === namenSidecar);

console.log("\n[2] 3D-commando's: één stap per commando");
const app = nepApp();
const knoop = await voerApiUitInApp(app.acties, "model3d.node.add", { x: 0, y: 0, z: 0 });
check("ok met de uitkomst van het commando", knoop.ok && knoop.output.node.id === 1, JSON.stringify(knoop));
check("precies één 3D-bewerking, zonder stramien", JSON.stringify(app.log) === JSON.stringify([["bewerk3D", "zonder stramien"]]), JSON.stringify(app.log));
check("het model van de app heeft de knoop", model3dVan(app.doc()).nodes.length === 1);
app.log.length = 0;
await voerApiUitInApp(app.acties, "model3d.levels.set", { levels: [{ label: "vloer", heightM: 3 }] });
check("levels: model en stramien in dezelfde stap", JSON.stringify(app.log) === JSON.stringify([["bewerk3D", "met stramien"]]), JSON.stringify(app.log));
app.log.length = 0;
const lezen = await voerApiUitInApp(app.acties, "model3d.get", {});
check("een lezend commando roept geen actie aan", lezen.ok && app.log.length === 0, JSON.stringify(app.log));

console.log("\n[3] gevallen en combinaties via de store");
const tweeD = nepApp({ ...leegDocument(), modelDimension: "2d", model3d: undefined });
const geval = await voerApiUitInApp(tweeD.acties, "project.loadCase.add", { name: "Sneeuw", type: "snow" });
check("ok, en zetGevallen met het nieuwe geval", geval.ok && tweeD.log.some(([actie]) => actie === "zetGevallen")
  && tweeD.doc().loadCases.some((lc) => lc.name === "Sneeuw"), JSON.stringify(tweeD.log));
check("combinaties als LoadCombination (factoren in een Map)",
  Array.isArray(tweeD.acties.laatsteCombinaties) && tweeD.acties.laatsteCombinaties.every((c) => c.factors instanceof Map));
check("geen 3D-bewerking voor een gevalwijziging", !tweeD.log.some(([actie]) => actie === "bewerk3D"));

console.log("\n[4] project.new: een nieuw project, geen bewerking");
const nieuw = nepApp();
await voerApiUitInApp(nieuw.acties, "model3d.node.add", { x: 1, y: 2, z: 3 });
nieuw.log.length = 0;
const leeg = await voerApiUitInApp(nieuw.acties, "project.new", {});
check("alleen nieuwProject, en het model is leeg", leeg.ok && JSON.stringify(nieuw.log) === JSON.stringify([["nieuwProject"]])
  && model3dVan(nieuw.doc()).nodes.length === 0, JSON.stringify(nieuw.log));

console.log("\n[4b] een breder veld weigert de app, vóór er iets verandert");
const breed = nepApp();
const voorBreed = breed.doc();
let breedFout = null;
try {
  await pasToe(breed.acties, voorBreed, {
    ...voorBreed, analysetype: "tweedeOrde", model3d: { ...model3dVan(voorBreed), nodes: [{ id: 1, x: 0, y: 0, z: 0 }] },
  });
} catch (fout) { breedFout = fout; }
check("INTERN met het veld in de melding", breedFout?.code === "INTERN" && breedFout.message.includes("analysetype")
  && JSON.stringify(breedFout.detail) === JSON.stringify({ velden: ["analysetype"] }), String(breedFout?.message));
check("en er is niets toegepast (ook het 3D-model niet)", breed.log.length === 0 && breed.doc() === voorBreed, JSON.stringify(breed.log));

console.log("\n[4c] nieuw en openen bij niet-opgeslagen werk");
const vuil = nepApp();
vuil.acties.nietOpgeslagen = true;
const geweigerdNieuw = await voerApiUitInApp(vuil.acties, "project.new", {});
check("project.new weigert, en er is niets geladen", !geweigerdNieuw.ok && geweigerdNieuw.error.code === "GEWEIGERD"
  && geweigerdNieuw.error.melding.includes("discardChanges") && vuil.log.length === 0, JSON.stringify(geweigerdNieuw));
check("met discardChanges wel", (await voerApiUitInApp(vuil.acties, "project.new", { discardChanges: true })).ok
  && JSON.stringify(vuil.log) === JSON.stringify([["nieuwProject"]]));
vuil.log.length = 0;
const geweigerdOpen = await voerApiUitInApp(vuil.acties, "app.project.open", { path: "C:/ander.ifcfem" });
check("app.project.open weigert ook", !geweigerdOpen.ok && geweigerdOpen.error.code === "GEWEIGERD" && vuil.log.length === 0);
const geopend = await voerApiUitInApp(vuil.acties, "app.project.open", { path: "C:/ander.ifcfem", discardChanges: true });
check("met discardChanges: openen(pad), en het pad terug", geopend.ok && geopend.output.path === "C:/ander.ifcfem"
  && JSON.stringify(vuil.log) === JSON.stringify([["openen", "C:/ander.ifcfem"]]), JSON.stringify(geopend));
const schoon = nepApp();
check("zonder niet-opgeslagen werk opent hij meteen",
  (await voerApiUitInApp(schoon.acties, "app.project.open", { path: "C:/a.ifcfem" })).ok && schoon.log.at(-1)[0] === "openen");
const geweigerdImport = await voerApiUitInApp(vuil.acties, "app.project.import", { path: "C:/model.demofem" });
check("app.project.import weigert bij niet-opgeslagen werk", !geweigerdImport.ok && geweigerdImport.error.code === "GEWEIGERD"
  && !vuil.log.some(([naam]) => naam === "importeren"));
const geimporteerd = await voerApiUitInApp(vuil.acties, "app.project.import", {
  path: "C:/model.demofem", importer: "org.openaec.voorbeeld/demofem", discardChanges: true,
});
check("app.project.import laadt als nieuw project en geeft verslag + extensie terug",
  geimporteerd.ok && geimporteerd.output.project === "nieuw" && geimporteerd.output.messages[0].text === "3 knopen"
  && geimporteerd.output.extension.id === "org.openaec.voorbeeld"
  && vuil.log.at(-1)[0] === "importeren", JSON.stringify(geimporteerd));
const lijst = await voerApiUitInApp(schoon.acties, "extensions.list", {});
check("extensions.list toont de gekoppelde importeurs en hun status",
  lijst.ok && lijst.output.extensions[0].source === "gekoppeld"
  && lijst.output.extensions[0].enabled === true, JSON.stringify(lijst));

console.log("\n[4d] het stramien");
const stramien3D = nepApp();
await voerApiUitInApp(stramien3D.acties, "project.grid.set", { xAxes: [{ label: "A", positionM: 0 }, { label: "B", positionM: 7.2 }] });
check("3D-project: via de 3D-bewerking, met het stramien", JSON.stringify(stramien3D.log) === JSON.stringify([["bewerk3D", "met stramien"]])
  && stramien3D.doc().structuralGrid.xAxes[1].position === 7200, JSON.stringify(stramien3D.log));
const stramien2D = nepApp({ ...leegDocument(), modelDimension: "2d", model3d: undefined });
await voerApiUitInApp(stramien2D.acties, "project.grid.set", { enabled: false });
check("2D-project: zetStramien", JSON.stringify(stramien2D.log) === JSON.stringify([["zetStramien"]])
  && stramien2D.doc().structuralGrid.enabled === false, JSON.stringify(stramien2D.log));

console.log("\n[5] app-commando's");
const ondo = nepApp();
check("app.undo → ongedaanMaken", (await voerApiUitInApp(ondo.acties, "app.undo", {})).ok && ondo.log.at(-1)[0] === "ongedaanMaken");
check("app.redo → opnieuw", (await voerApiUitInApp(ondo.acties, "app.redo", {})).ok && ondo.log.at(-1)[0] === "opnieuw");
{
  // Issue #244, punt 001: zonder herhaalbare actie geen `done: true`.
  ondo.acties.geenStap = true;
  const redo = await voerApiUitInApp(ondo.acties, "app.redo", {});
  check("app.redo zonder stap: done false met reden", redo.ok && redo.output.done === false && /niets veranderd/.test(redo.output.reason), JSON.stringify(redo));
  const undo = await voerApiUitInApp(ondo.acties, "app.undo", {});
  check("app.undo zonder stap: done false met reden", undo.ok && undo.output.done === false && /niets veranderd/.test(undo.output.reason), JSON.stringify(undo));
  ondo.acties.geenStap = false;
  const wel = await voerApiUitInApp(ondo.acties, "app.redo", {});
  check("app.redo met stap: done true", wel.ok && wel.output.done === true, JSON.stringify(wel));
}
const opslaan = await voerApiUitInApp(ondo.acties, "app.project.save", { path: "C:/proef.ifcfem" });
check("app.project.save met pad → opslaan(pad) en het pad terug", opslaan.ok && opslaan.output.path === "C:/proef.ifcfem"
  && JSON.stringify(ondo.log.at(-1)) === JSON.stringify(["opslaan", "C:/proef.ifcfem"]));

console.log("\n[6] fouten komen heel aan");
const fout = await voerApiUitInApp(nepApp().acties, "model3d.node.delete", { id: 9 });
check("NIET_GEVONDEN met melding", !fout.ok && fout.error.code === "NIET_GEVONDEN" && fout.error.melding.includes("9"), JSON.stringify(fout));
const onbekend = await voerApiUitInApp(nepApp().acties, "model3d.niets", {});
check("ONBEKEND_COMMANDO met suggesties in detail", !onbekend.ok && onbekend.error.code === "ONBEKEND_COMMANDO" && Array.isArray(onbekend.error.detail.suggesties));
const kapotteApp = nepApp();
kapotteApp.acties.bewerk3D = () => { throw new Error("de app weigert"); };
const weigering = await voerApiUitInApp(kapotteApp.acties, "model3d.node.add", { x: 0, y: 0, z: 0 });
check("een fout bij het terugzetten → INTERN met de melding", !weigering.ok && weigering.error.code === "INTERN" && weigering.error.melding === "de app weigert");

console.log("\n[7] pasToe zonder wijziging doet niets");
const stil = nepApp();
const d = stil.doc();
await pasToe(stil.acties, d, d);
check("geen enkele actie", stil.log.length === 0);

console.log("\n[7b] een belastinggeval verwijderen in een 3D-project: één stap, ook voor de gevallen (#91)");
{
  const app3d = nepApp();
  // De app heeft altijd combinaties in haar document; het lege document niet.
  await voerApiUitInApp(app3d.acties, "project.combinations.resetToStandard", {});
  await voerApiUitInApp(app3d.acties, "model3d.node.add", { x: 0, y: 0, z: 0 });
  await voerApiUitInApp(app3d.acties, "model3d.load.nodal.add", { nodeId: 1, caseId: 3, fz: -10 });
  await voerApiUitInApp(app3d.acties, "model3d.load.nodal.add", { nodeId: 1, caseId: 1, fz: -5 });
  const gevallenVoor = app3d.doc().loadCases.map((c) => c.id).join();
  app3d.log.length = 0;
  const weg = await voerApiUitInApp(app3d.acties, "project.loadCase.delete", { id: 3 });
  check("ok; de 3D-last van geval 3 is weg, die van geval 1 blijft", weg.ok && weg.output.removedLoads3d === 1
    && model3dVan(app3d.doc()).loads.map((l) => l.caseId).join() === "1", JSON.stringify(weg));
  check("één 3D-stap mét de gevallen, daarna de gevallen in de store",
    JSON.stringify(app3d.log) === JSON.stringify([["bewerk3D", "zonder stramien", "met gevallen"], ["zetGevallen", 4]]),
    JSON.stringify(app3d.log));
  app3d.log.length = 0;
  app3d.acties.laatsteExtern.terug();
  check("ongedaan maken van die stap zet de vijf gevallen terug",
    JSON.stringify(app3d.log) === JSON.stringify([["zetGevallen", 5]]) && app3d.doc().loadCases.map((c) => c.id).join() === gevallenVoor,
    JSON.stringify(app3d.log));
  app3d.log.length = 0;
  app3d.acties.laatsteExtern.vooruit();
  check("opnieuw verwijdert het geval weer", JSON.stringify(app3d.log) === JSON.stringify([["zetGevallen", 4]]));
  app3d.log.length = 0;
  await voerApiUitInApp(app3d.acties, "model3d.node.add", { x: 1, y: 0, z: 0 });
  check("een gewone 3D-bewerking krijgt geen gevallenstap mee",
    JSON.stringify(app3d.log) === JSON.stringify([["bewerk3D", "zonder stramien"]]), JSON.stringify(app3d.log));
}

console.log("\n[7c] model3d.selection.filter met select: de app zet de selectie (issue #94)");
{
  const filterApp = nepApp();
  for (const [x, z] of [[0, 0], [6, 0], [0, 4]]) await voerApiUitInApp(filterApp.acties, "model3d.node.add", { x, y: 0, z });
  await voerApiUitInApp(filterApp.acties, "model3d.beam.add", { startNodeId: 1, endNodeId: 2 });
  await voerApiUitInApp(filterApp.acties, "model3d.beam.add", { startNodeId: 1, endNodeId: 3 });
  filterApp.log.length = 0;
  const gefilterd = await voerApiUitInApp(filterApp.acties, "model3d.selection.filter",
    { criteria: [{ property: "direction", mode: "keep", values: ["vertical"] }], select: true });
  check("select: true komt via voerApiUitInApp bij acties.zetSelectie3D, met de uitkomst als selectie",
    gefilterd.ok && gefilterd.output.selectionApplied === true
    && JSON.stringify(filterApp.log) === JSON.stringify([["zetSelectie3D", { type: "beam", id: 2 }]]),
    JSON.stringify([gefilterd, filterApp.log]));
  filterApp.log.length = 0;
  const zonder = await voerApiUitInApp(filterApp.acties, "model3d.selection.filter", { beamIds: [1, 2] });
  check("zonder select blijft de selectie in de app staan", zonder.ok && zonder.output.selectionApplied === false
    && filterApp.log.length === 0, JSON.stringify(filterApp.log));
}

console.log("\n[8] het bedieningskanaal: api_catalogus en api_uitvoeren");
const { voerUit } = await import("./src/bediening/bediening.ts");
const { opApiCatalogus } = await import("./src/mcp/apiSidecar.ts");
const kanaalApp = nepApp();
let tikken = 0;
const kanaal = (naam, args) => voerUit(naam, args, { current: { api: kanaalApp.acties } },
  () => new Promise(() => {}), () => { tikken++; return Promise.resolve(); });
const catalogus = await kanaal("api_catalogus", {});
check("api_catalogus is precies de catalogus van de sidecar",
  JSON.stringify(catalogus) === JSON.stringify(opApiCatalogus()));
const viaKanaal = await kanaal("api_uitvoeren", { name: "model3d.node.add", input: { x: 2, y: 0, z: 0 } });
check("api_uitvoeren: ok met de uitkomst, en de knoop in het model", viaKanaal.ok && viaKanaal.output.node.id === 1
  && model3dVan(kanaalApp.doc()).nodes.length === 1, JSON.stringify(viaKanaal));
check("daarna een verse render (het antwoord wacht op de nieuwe stand)", tikken === 1, String(tikken));
const kanaalFout = await kanaal("api_uitvoeren", { name: "model3d.node.update", input: { id: 1, x: "twee" } });
check("een fout van het register komt als antwoord met ok: false, niet als kanaalfout",
  !kanaalFout.ok && kanaalFout.error.code === "INVOER_ONGELDIG", JSON.stringify(kanaalFout));
let zonderNaam = null;
try { await kanaal("api_uitvoeren", { input: {} }); } catch (fout) { zonderNaam = fout.message; }
check("zonder `name` weigert het kanaal zelf", zonderNaam !== null && zonderNaam.includes("name"), String(zonderNaam));

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

// API-commando's voor het project (src/api/commands/project.ts): gevallen en
// combinaties lopen via lib/combinatieBeheer zoals de store — standaardset
// volgt, factoren van een verwijderd geval verdwijnen, id's komen nooit terug.
const { maakRegister } = await import("./src/api/register.ts");
const { leegDocument, model3dVan } = await import("./src/api/projectDocument.ts");
const { PROJECT_COMMANDOS } = await import("./src/api/commands/project.ts");
const { MODEL3D_GEOMETRIE_COMMANDOS } = await import("./src/api/commands/model3dGeometrie.ts");
const { MODEL3D_VOORWAARDEN_COMMANDOS } = await import("./src/api/commands/model3dVoorwaarden.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const register = maakRegister([...PROJECT_COMMANDOS, ...MODEL3D_GEOMETRIE_COMMANDOS, ...MODEL3D_VOORWAARDEN_COMMANDOS]);
let doc = leegDocument();
const doe = (naam, invoer) => {
  const r = register.voerUit(naam, invoer, { document: doc });
  if (r.document) doc = r.document;
  return r.uitkomst;
};
const faalt = (naam, invoer) => { try { register.voerUit(naam, invoer, { document: doc }); return null; } catch (e) { return e; } };
const combinaties = () => doc.combinations;
const factorVan = (c, caseId) => c.factors[String(caseId)];

console.log("[1] project lezen");
const begin = doe("project.get", {});
check("3D-project met de standaardgevallen en een standaardset combinaties",
  begin.modelDimension === "3d" && begin.loadCases.length === doc.loadCases.length && begin.combinations.length > 0
    && begin.combinations.every((c) => c.standaard), JSON.stringify(begin.combinations.map((c) => c.name)));
check("project.get wijzigt het document niet", doc.combinations === undefined);

console.log("\n[2] gevallen toevoegen");
const aantalVoor = begin.combinations.length;
const sneeuw = doe("project.loadCase.add", { name: "Sneeuw (S)", type: "snow" }).loadCase;
check("nieuw geval met een nieuw id", sneeuw.type === "snow" && !begin.loadCases.some((lc) => lc.id === sneeuw.id));
check("de standaardset neemt het mee", combinaties().length > aantalVoor && combinaties().some((c) => factorVan(c, sneeuw.id) > 0));
check("tellers in het document", doc.idTellers.belastinggeval > sneeuw.id, JSON.stringify(doc.idTellers));
const vloer = doe("project.loadCase.add", { name: "Vloer (Q)", type: "live", categorie: "B" }).loadCase;
check("veranderlijk met gebruikscategorie B", vloer.categorie === "B");
check("categorie bij een blijvend geval → INVOER_ONGELDIG",
  faalt("project.loadCase.add", { name: "X", type: "dead", categorie: "B" })?.code === "INVOER_ONGELDIG");

console.log("\n[3] gevallen wijzigen");
check("hernoemen", doe("project.loadCase.update", { id: sneeuw.id, name: "Sneeuw" }).loadCase.name === "Sneeuw");
const eigen = doc.loadCases.find((lc) => lc.eigenGewicht);
check("(opzet) er is een geval met het eigen gewicht en het staat aan", eigen !== undefined && doc.selfWeightEnabled === true);
const omgezet = doe("project.loadCase.update", { id: eigen.id, type: "live" });
check("het eigen-gewichtgeval niet meer blijvend → eigen gewicht uit, met melding",
  omgezet.selfWeightEnabled === false && doc.selfWeightEnabled === false && omgezet.meldingen.some((m) => m.includes("eigen gewicht")),
  JSON.stringify(omgezet.meldingen));

console.log("\n[4] gevallen verwijderen");
for (const [x, y, z] of [[0, 0, 4], [6, 0, 4], [6, 4, 4], [0, 4, 4]]) doe("model3d.node.add", { x, y, z });
doe("model3d.beam.add", { startNodeId: 1, endNodeId: 2 });
doe("model3d.load.member.add", { beamId: 1, qzStart: -1, caseId: sneeuw.id });
doe("model3d.loadPanel.add", { nodeIds: [1, 2, 3, 4], q: 0.56, caseId: sneeuw.id });
doe("model3d.load.member.add", { beamId: 1, qzStart: -2, caseId: vloer.id });
const weg = doe("project.loadCase.delete", { id: sneeuw.id });
check("het geval weg, met zijn 3D-lijnlast en belastingvlak", weg.removedLoads3d === 2
  && model3dVan(doc).memberLoads.length === 1 && model3dVan(doc).loadPanels.length === 0, JSON.stringify(weg));
check("zijn factoren verdwenen uit elke combinatie", combinaties().every((c) => factorVan(c, sneeuw.id) === undefined));
const later = doe("project.loadCase.add", { name: "Wind", type: "wind" }).loadCase;
check("een nieuw geval krijgt nooit het verwijderde id terug", later.id > sneeuw.id, `${later.id} ≤ ${sneeuw.id}`);
doc = { ...doc, activeLoadCaseId: vloer.id };
check("het actieve geval verwijderen → een ander wordt actief", doe("project.loadCase.delete", { id: vloer.id }).activeLoadCaseId !== vloer.id
  && doc.loadCases.some((lc) => lc.id === doc.activeLoadCaseId));
for (const lc of doc.loadCases.slice(1)) doe("project.loadCase.delete", { id: lc.id });
check("het laatste geval → GEWEIGERD", faalt("project.loadCase.delete", { id: doc.loadCases[0].id })?.code === "GEWEIGERD");
check("een onbekend geval → NIET_GEVONDEN", faalt("project.loadCase.update", { id: 999, name: "x" })?.code === "NIET_GEVONDEN");

console.log("\n[5] combinaties");
doc = leegDocument();
const g = doc.loadCases.find((lc) => lc.type === "dead").id;
const eigenCombi = doe("project.combination.add", { name: "Montage", type: "uls", factors: [{ caseId: g, factor: 1.35 }] }).combination;
check("eigen combinatie: geen kenmerk standaard, formule uit de factoren",
  eigenCombi.standaard === undefined && factorVan(eigenCombi, g) === 1.35 && eigenCombi.formula.includes("1.35"), JSON.stringify(eigenCombi));
check("factor op een onbekend geval → NIET_GEVONDEN",
  faalt("project.combination.add", { name: "X", type: "uls", factors: [{ caseId: 999, factor: 1 }] })?.code === "NIET_GEVONDEN");
check("hetzelfde geval twee keer → INVOER_ONGELDIG",
  faalt("project.combination.add", { name: "X", type: "uls", factors: [{ caseId: g, factor: 1 }, { caseId: g, factor: 2 }] })?.code === "INVOER_ONGELDIG");
const standaard = combinaties().find((c) => c.standaard);
const gewijzigd = doe("project.combination.update", { id: standaard.id, name: "Mijn UGT" }).combination;
check("een standaardcombinatie wijzigen maakt haar eigen", gewijzigd.name === "Mijn UGT" && gewijzigd.standaard === undefined);
doe("project.combination.delete", { id: eigenCombi.id });
check("verwijderd", !combinaties().some((c) => c.id === eigenCombi.id));
const hersteld = doe("project.combinations.resetToStandard", {}).combinations;
check("standaard herstellen: alleen standaardcombinaties", hersteld.length > 0 && hersteld.every((c) => c.standaard));

console.log("\n[6] nieuw project");
const nieuw = register.voerUit("project.new", {}, { document: doc });
doc = nieuw.document;
check("leeg 3D-project", doc.modelDimension === "3d" && model3dVan(doc).nodes.length === 0 && doc.combinations === undefined);
check("gemerkt als nieuw project (de app laadt het als Nieuw, zonder bestand)", nieuw.nieuwProject === true);
check("een bewerking is geen nieuw project", register.voerUit("model3d.node.add", { x: 0, y: 0, z: 0 }, { document: doc }).nieuwProject === undefined);

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

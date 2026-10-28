// Het projectdocument van de API (src/api/projectDocument.ts): de vorm van een
// .ifcfem-bestand zonder metavelden, met dezelfde (de)serialisatie als de app.
const {
  documentNaarTekst, documentUitTekst, leegDocument, metModel3d, model3dVan,
} = await import("./src/api/projectDocument.ts");
const {
  standaardBelastinggevallen, STANDAARD_ACTIEF_GEVAL_ID, EIGEN_GEWICHT_STANDAARD_AAN,
} = await import("./src/lib/eigenGewicht.ts");
const { PROJECT_FORMAT_ID } = await import("./src/io/projectFile.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const json = (x) => JSON.stringify(x);

console.log("[1] een leeg document");
const leeg = leegDocument();
check("3D-project met een leeg 3D-model", leeg.modelDimension === "3d" && model3dVan(leeg).nodes.length === 0 && model3dVan(leeg).beams.length === 0);
check("de standaardgevallen van Bestand → Nieuw", json(leeg.loadCases) === json(standaardBelastinggevallen())
  && leeg.activeLoadCaseId === STANDAARD_ACTIEF_GEVAL_ID && leeg.selfWeightEnabled === EIGEN_GEWICHT_STANDAARD_AAN);
check("eerste orde, niet-lineair uit", leeg.analysetype === "eersteOrde" && leeg.nonlinearEnabled === false);
check("geen metavelden in het document", !("format" in leeg) && !("version" in leeg) && !("savedAt" in leeg));

console.log("\n[2] tekst heen en terug");
const tekst = documentNaarTekst(leeg);
check("de tekst draagt het huidige formaat-id", JSON.parse(tekst).format === PROJECT_FORMAT_ID);
const d1 = documentUitTekst(tekst);
const d2 = documentUitTekst(documentNaarTekst(d1));
check("heen en terug geeft hetzelfde document", json(d1) === json(d2), `${json(d1).slice(0, 120)} …`);
check("een bestand met het oude formaat-id leest in",
  documentUitTekst(tekst.replace(PROJECT_FORMAT_ID, "open-fem2d-studio-v2")).modelDimension === "3d");
let gooit = false;
try { documentUitTekst("{ geen json"); } catch { gooit = true; }
check("onleesbare tekst gooit", gooit);

console.log("\n[3] het 3D-model in het document");
const tweeD = { ...leeg, modelDimension: "2d", model3d: undefined };
check("een 2D-document zonder model3d → leeg 3D-model", model3dVan(tweeD).nodes.length === 0 && model3dVan(tweeD).beams.length === 0);
const model = { ...model3dVan(leeg), nodes: [{ id: 1, x: 0, y: 0, z: 0 }] };
const met = metModel3d(tweeD, model);
check("metModel3d zet het model en de dimensie 3d", met.model3d === model && met.modelDimension === "3d");
check("… en laat het origineel ongewijzigd", tweeD.model3d === undefined && tweeD.modelDimension === "2d");
check("het model overleeft de tekst", model3dVan(documentUitTekst(documentNaarTekst(met))).nodes.length === 1);

// De MCP-server voert de commando's zonder app uit op een projectbestand:
// lezen en weer schrijven via dit document. Een zichtbaarheidssleutel die de
// (bundel)code niet kent, valt daarbij stil weg uit de opgeslagen views; de
// peilmaten (issue #92, `levelMarks`) zijn de nieuwste.
console.log("\n[4] opgeslagen 3D-views overleven de tekst");
const camera = { position: [10, -10, 8], target: [0, 0, 0], up: [0, 0, 1] };
const metViews = {
  ...leeg,
  openFem3dViewSets: [
    { id: "zonder-peil", name: "Zonder peilmaten", view: "front", camera, visibility: { levelMarks: false, structuralGrid: true }, combinationId: null },
    { id: "oud", name: "Oud", view: "iso", camera, visibility: { structuralGrid: false }, combinationId: null },
  ],
};
const views = documentUitTekst(documentNaarTekst(metViews)).openFem3dViewSets ?? [];
check("een view met de peilmaten uit houdt ze uit", views[0]?.visibility.levelMarks === false,
  json(views[0]?.visibility));
check("… en het stramien aan", views[0]?.visibility.structuralGrid === true);
check("een oude view zonder de sleutel krijgt de peilmaten aan (de standaard)", views[1]?.visibility.levelMarks === true,
  json(views[1]?.visibility));
check("… met zijn eigen stramien uit", views[1]?.visibility.structuralGrid === false);

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

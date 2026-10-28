// API-commando's voor het stramien (src/api/commands/stramien.ts): de assen
// in X en Y en of het stramien aan staat, zoals het venster Stramienen en
// levels. Posities in m in en uit, mm in het project; een as met een
// bestaande naam houdt zijn id; de levels blijven bij model3d.levels.*.
const { maakRegister } = await import("./src/api/register.ts");
const { leegDocument } = await import("./src/api/projectDocument.ts");
const { STRAMIEN_COMMANDOS } = await import("./src/api/commands/stramien.ts");
const { MODEL3D_BEWERKEN_COMMANDOS } = await import("./src/api/commands/model3dBewerken.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const register = maakRegister([...STRAMIEN_COMMANDOS, ...MODEL3D_BEWERKEN_COMMANDOS]);
let doc = leegDocument();
const doe = (naam, invoer) => {
  const r = register.voerUit(naam, invoer, { document: doc });
  if (r.document) doc = r.document;
  return r.uitkomst;
};
const faalt = (naam, invoer) => { try { register.voerUit(naam, invoer, { document: doc }); return null; } catch (e) { return e; } };

console.log("[1] lezen");
const docVoor = doc;
const start = doe("project.grid.get", {});
check("aan, met assen in X en Y in m", start.enabled === true && start.xAxes.length > 0 && start.xAxes.every((as) => typeof as.positionM === "number"),
  JSON.stringify(start));
check("de levels staan erbij, in m", Array.isArray(start.levels) && start.levels.every((l) => typeof l.heightM === "number"));
check("lezen verandert het document niet", doc === docVoor);
// Issue #244, punt 001: in een nieuw project heten Y-assen en levels niet
// hetzelfde (was: Y-assen "1", "2" en levels "1", "2").
{
  const yNamen = new Set(start.yAxes.map((as) => as.label));
  const dubbel = start.levels.filter((l) => yNamen.has(l.label)).map((l) => l.label);
  check("nieuw project: geen level met de naam van een Y-as", dubbel.length === 0,
    `Y ${JSON.stringify([...yNamen])}, levels ${JSON.stringify(start.levels.map((l) => l.label))}`);
  const xNamen = new Set(start.xAxes.map((as) => as.label));
  check("nieuw project: alle asnamen en levelnamen verschillend",
    new Set([...xNamen, ...yNamen, ...start.levels.map((l) => l.label)]).size === xNamen.size + yNamen.size + start.levels.length);
}

console.log("\n[2] assen zetten");
const eersteX = start.xAxes[0];
const gezet = doe("project.grid.set", { xAxes: [{ label: eersteX.label, positionM: 0 }, { label: "Q", positionM: 1.1 }, { label: "R", positionM: 7.2 }] });
check("een as met een bestaande naam houdt zijn id", gezet.xAxes[0].id === eersteX.id, JSON.stringify(gezet.xAxes));
check("nieuwe assen krijgen x-1, x-2", gezet.xAxes[1].id === "x-1" && gezet.xAxes[2].id === "x-2", JSON.stringify(gezet.xAxes));
check("positie in mm in het project, zonder afrondingsruis", doc.structuralGrid.xAxes[1].position === 1100 && doc.structuralGrid.xAxes[2].position === 7200,
  JSON.stringify(doc.structuralGrid.xAxes));
const naX = doe("project.grid.get", {});
check("Y en de levels onveranderd", JSON.stringify(naX.yAxes) === JSON.stringify(start.yAxes) && JSON.stringify(naX.levels) === JSON.stringify(start.levels),
  JSON.stringify(naX));
doe("project.grid.set", { yAxes: [{ label: "1", positionM: 0 }, { label: "2", positionM: 5 }], enabled: false });
check("Y-assen en uit", doc.structuralGrid.enabled === false && doc.structuralGrid.yAxes.length === 2 && doc.structuralGrid.yAxes[1].position === 5000);
check("X onveranderd bij alleen Y", doc.structuralGrid.xAxes.length === 3);
check("een lege lijst haalt de assen weg", doe("project.grid.set", { yAxes: [] }).yAxes.length === 0 && doc.structuralGrid.yAxes.length === 0);

console.log("\n[3] een document zonder Y-assen of stramien");
doc = { ...leegDocument(), structuralGrid: { enabled: true, xAxes: [], zAxes: [] } };
check("Y-assen zetten waar ze ontbraken", doe("project.grid.set", { yAxes: [{ label: "A", positionM: 3 }] }).yAxes[0].id === "y-1");
doc = { ...leegDocument() };
delete doc.structuralGrid;
check("zonder stramien geldt het standaardstramien", doe("project.grid.get", {}).xAxes.length > 0);

console.log("\n[4] fouten");
check("niets opgegeven → INVOER_ONGELDIG", faalt("project.grid.set", {})?.code === "INVOER_ONGELDIG");
check("een as zonder positie → INVOER_ONGELDIG", faalt("project.grid.set", { xAxes: [{ label: "A" }] })?.code === "INVOER_ONGELDIG");
check("levels gaan niet via het stramien → INVOER_ONGELDIG", faalt("project.grid.set", { zAxes: [] })?.code === "INVOER_ONGELDIG");

console.log("\n[5] levels via model3d.levels.set laten de assen staan");
doc = leegDocument();
doe("project.grid.set", { xAxes: [{ label: "A", positionM: 0 }, { label: "B", positionM: 6 }] });
const assen = doc.structuralGrid.xAxes;
doe("model3d.levels.set", { levels: [{ label: "vloer", heightM: 3 }] });
check("X-assen onveranderd, levels gezet", doc.structuralGrid.xAxes === assen && doc.structuralGrid.zAxes.length === 1);

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

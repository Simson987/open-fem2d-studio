// API-commando's om het 3D-model als geheel te bewerken
// (src/api/commands/model3dBewerken.ts): transformaties, een selectie
// verwijderen en levels, via het register op een portaal.
const { maakRegister } = await import("./src/api/register.ts");
const { leegDocument, model3dVan } = await import("./src/api/projectDocument.ts");
const { MODEL3D_GEOMETRIE_COMMANDOS } = await import("./src/api/commands/model3dGeometrie.ts");
const { MODEL3D_BEWERKEN_COMMANDOS } = await import("./src/api/commands/model3dBewerken.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const register = maakRegister([...MODEL3D_GEOMETRIE_COMMANDOS, ...MODEL3D_BEWERKEN_COMMANDOS]);
let doc = leegDocument();
const doe = (naam, invoer) => {
  const r = register.voerUit(naam, invoer, { document: doc });
  if (r.document) doc = r.document;
  return r.uitkomst;
};
const faalt = (naam, invoer) => { try { register.voerUit(naam, invoer, { document: doc }); return null; } catch (e) { return e; } };
const knoop = (nodeId) => model3dVan(doc).nodes.find((n) => n.id === nodeId);
const dichtbij = (a, b) => Math.abs(a - b) < 1e-9;

for (const [x, y, z] of [[0, 0, 0], [6, 0, 0], [0, 0, 4], [6, 0, 4]]) doe("model3d.node.add", { x, y, z });
doe("model3d.beam.add", { startNodeId: 1, endNodeId: 3 });
doe("model3d.beam.add", { startNodeId: 2, endNodeId: 4 });
doe("model3d.beam.add", { startNodeId: 3, endNodeId: 4 });

console.log("[1] transformaties");
doe("model3d.transform", { beamIds: [3], command: { kind: "move", dx: 0, dy: 0, dz: 1 } });
check("ligger 1 m omhoog: zijn knopen gaan mee", knoop(3).z === 5 && knoop(4).z === 5 && knoop(1).z === 0);
const kopie = doe("model3d.transform", { beamIds: [1, 2, 3], command: { kind: "copy", dx: 0, dy: 6, dz: 0 } });
check("portaal kopiëren: vier knopen en drie staven erbij", model3dVan(doc).nodes.length === 8 && model3dVan(doc).beams.length === 6,
  JSON.stringify(kopie.selection));
check("de uitkomst noemt de kopie", kopie.selection.beamIds?.length === 3 && !kopie.selection.beamIds.includes(1), JSON.stringify(kopie.selection));
doe("model3d.transform", { beamIds: [3], command: { kind: "rotate", axis: "z", angleDeg: 90 } });
check("90° om z door het midden van de ligger, tegen de klok in", dichtbij(knoop(3).x, 3) && dichtbij(knoop(3).y, -3) && dichtbij(knoop(4).y, 3),
  JSON.stringify([knoop(3), knoop(4)]));
doe("model3d.transform", { nodeIds: [5], command: { kind: "mirror", axis: "y", offset: 10 } });
check("spiegelen in y = 10", dichtbij(knoop(5).y, 14), JSON.stringify(knoop(5)));
check("lege selectie → INVOER_ONGELDIG", faalt("model3d.transform", { command: { kind: "move", dx: 1, dy: 0, dz: 0 } })?.code === "INVOER_ONGELDIG");
check("onbekende staaf → NIET_GEVONDEN", faalt("model3d.transform", { beamIds: [99], command: { kind: "move", dx: 1, dy: 0, dz: 0 } })?.code === "NIET_GEVONDEN");
check("onbekende bewerking → INVOER_ONGELDIG", faalt("model3d.transform", { nodeIds: [1], command: { kind: "scale", f: 2 } })?.code === "INVOER_ONGELDIG");

console.log("\n[2] selectie verwijderen");
const weg = doe("model3d.selection.delete", { beamIds: kopie.selection.beamIds });
check("de gekopieerde staven weg, hun knopen blijven", weg.removedBeamIds.length === 3 && model3dVan(doc).nodes.length === 8, JSON.stringify(weg));
const knopenWeg = doe("model3d.selection.delete", { nodeIds: [5, 6, 7, 8] });
check("losse knopen weg", knopenWeg.removedNodeIds.join() === "5,6,7,8" && model3dVan(doc).nodes.length === 4);

console.log("\n[3] levels");
const gezet = doe("model3d.levels.set", { levels: [{ label: "vloer", heightM: 4 }, { label: "dak", heightM: 8 }] }).levels;
check("twee levels met id en hoogte in m", gezet.length === 2 && gezet[0].heightM === 4 && gezet[1].label === "dak" && typeof gezet[0].id === "string");
check("in het stramien van het document, in mm", doc.structuralGrid.zAxes.map((a) => a.position).join() === "4000,8000");
const vloer = gezet[0].id;
doe("model3d.node.linkLevel", { nodeIds: [3, 4], levelId: vloer });
check("koppelen zet de knopen op de levelhoogte", knoop(3).z === 4 && knoop(4).z === 4 && knoop(3).levelId === vloer);
doe("model3d.levels.set", { levels: [{ label: "vloer", heightM: 4.5 }, { label: "dak", heightM: 8 }] });
check("het level hoger: gekoppelde knopen schuiven mee, id blijft", knoop(3).z === 4.5 && knoop(3).levelId === vloer);
check("z van een gekoppelde knoop wijzigen → GEWEIGERD", faalt("model3d.node.update", { id: 3, z: 6 })?.code === "GEWEIGERD");
const onbekend = faalt("model3d.node.linkLevel", { nodeIds: [1], levelId: "bestaat-niet" });
check("onbekend level → GEWEIGERD met de zin uit de app", onbekend?.code === "GEWEIGERD" && onbekend.message.includes("bestaat niet"), onbekend?.message);
check("levels lezen", doe("model3d.levels.get", {}).levels.length === 2);
doe("model3d.levels.set", { levels: [{ label: "dak", heightM: 8 }] });
check("level weg: de knopen laten los en blijven staan", knoop(3).levelId === undefined && knoop(3).z === 4.5);

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

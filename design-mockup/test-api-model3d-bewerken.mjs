// API-commando's om het 3D-model als geheel te bewerken
// (src/api/commands/model3dBewerken.ts): transformaties, een selectie
// verwijderen (ook met lasten, de uitkomst van model3d.selection.filter) en
// levels, via het register op een portaal.
const { maakRegister } = await import("./src/api/register.ts");
const { leegDocument, metModel3d, model3dVan } = await import("./src/api/projectDocument.ts");
const { MODEL3D_GEOMETRIE_COMMANDOS } = await import("./src/api/commands/model3dGeometrie.ts");
const { MODEL3D_BEWERKEN_COMMANDOS } = await import("./src/api/commands/model3dBewerken.ts");
const { MODEL3D_SELECTIE_COMMANDOS } = await import("./src/api/commands/model3dSelectie.ts");

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

console.log("\n[2b] selectie met lasten verwijderen (issue #94), zoals Delete na het selectiefilter");
{
  const knoopLast = (id, nodeId, caseId) => ({ id, nodeId, caseId, fx: 1, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 });
  const lijnLast = (id, beamId, caseId) => ({ id, beamId, caseId, qyStart: 0, qyEnd: 0, qzStart: -1, qzEnd: -1, startPositionM: 0, endPositionM: 6 });
  // Een ligger en een kolom met lasten in twee gevallen.
  const metLasten = metModel3d(leegDocument(), {
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6, y: 0, z: 4 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 2, endNodeId: 3 }],
    supports: [],
    loads: [knoopLast(1, 3, 1), knoopLast(2, 2, 2)],
    memberLoads: [lijnLast(1, 1, 2), lijnLast(2, 2, 1)],
    memberPointLoads: [{ id: 1, beamId: 1, caseId: 2, py: 0, pz: -5, positionM: 3 }],
    thermalLoads: [], plates: [], surfaceLoads: [], loadPanels: [],
  });
  const reg = maakRegister([...MODEL3D_BEWERKEN_COMMANDOS, ...MODEL3D_SELECTIE_COMMANDOS]);
  const voer = (naam, invoer, document = metLasten) => reg.voerUit(naam, invoer, { document });
  const faaltOp = (invoer) => { try { voer("model3d.selection.delete", invoer); return null; } catch (e) { return e; } };
  const lijst = (ids) => (ids ?? []).join(",");

  // De id-velden van het filter gaan ongewijzigd in delete.
  const { counts, wholeModel, selectionApplied, supportNodeIds, ...gefilterd } =
    voer("model3d.selection.filter", { criteria: [{ property: "loadCase", mode: "keep", values: [2] }] }).uitkomst;
  check("het filter geeft de lasten van geval 2 (knooplast 2, lijnlast 1, puntlast 1)", counts.loads === 3
    && lijst(gefilterd.nodalLoadIds) === "2" && lijst(gefilterd.memberLoadIds) === "1" && lijst(gefilterd.memberPointLoadIds) === "1",
  JSON.stringify(gefilterd));
  const weg = voer("model3d.selection.delete", gefilterd);
  const na = model3dVan(weg.document);
  check("de uitkomst van het filter in één commando weg: alleen de lasten van geval 2, de geometrie blijft",
    lijst(na.loads.map((l) => l.id)) === "1" && lijst(na.memberLoads.map((l) => l.id)) === "2" && na.memberPointLoads.length === 0
    && na.beams.length === 2 && na.nodes.length === 3, JSON.stringify(na));
  check("de uitkomst noemt de verwijderde lasten per soort",
    lijst(weg.uitkomst.removedNodalLoadIds) === "2" && lijst(weg.uitkomst.removedMemberLoadIds) === "1"
    && lijst(weg.uitkomst.removedMemberPointLoadIds) === "1" && lijst(weg.uitkomst.removedThermalLoadIds) === ""
    && lijst(weg.uitkomst.removedSurfaceLoadIds) === "" && lijst(weg.uitkomst.removedLoadPanelIds) === ""
    && lijst(weg.uitkomst.removedNodeIds) === "" && lijst(weg.uitkomst.removedBeamIds) === "", JSON.stringify(weg.uitkomst));
  const een = voer("model3d.selection.delete", { memberLoadIds: [2] });
  check("één last: alleen die last weg", lijst(model3dVan(een.document).memberLoads.map((l) => l.id)) === "1"
    && lijst(een.uitkomst.removedMemberLoadIds) === "2");
  const gemengd = voer("model3d.selection.delete", { beamIds: [1], nodalLoadIds: [1] });
  check("staaf en last samen: de staaf met zijn lasten, en de gekozen knooplast",
    lijst(gemengd.uitkomst.removedBeamIds) === "1" && lijst(gemengd.uitkomst.removedNodalLoadIds) === "1"
    && lijst(gemengd.uitkomst.removedMemberLoadIds) === "1" && lijst(gemengd.uitkomst.removedMemberPointLoadIds) === "1"
    && lijst(model3dVan(gemengd.document).loads.map((l) => l.id)) === "2", JSON.stringify(gemengd.uitkomst));
  const leeg = faaltOp({});
  check("niets gekozen → INVOER_ONGELDIG, en de melding noemt lasten", leeg?.code === "INVOER_ONGELDIG" && leeg.message.includes("last"),
    leeg?.message);
  check("onbekende last → NIET_GEVONDEN", faaltOp({ thermalLoadIds: [9] })?.code === "NIET_GEVONDEN");
}

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

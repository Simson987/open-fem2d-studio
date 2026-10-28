// API-commando's voor opleggingen, lasten, belastingvlakken, schijven en
// trek-alleen (src/api/commands/model3dVoorwaarden.ts), via het register op
// een klein portaal met een dakplaat.
const { maakRegister } = await import("./src/api/register.ts");
const { leegDocument, model3dVan } = await import("./src/api/projectDocument.ts");
const { MODEL3D_GEOMETRIE_COMMANDOS } = await import("./src/api/commands/model3dGeometrie.ts");
const { MODEL3D_VOORWAARDEN_COMMANDOS } = await import("./src/api/commands/model3dVoorwaarden.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const register = maakRegister([...MODEL3D_GEOMETRIE_COMMANDOS, ...MODEL3D_VOORWAARDEN_COMMANDOS]);
let doc = leegDocument();
const doe = (naam, invoer) => {
  const r = register.voerUit(naam, invoer, { document: doc });
  if (r.document) doc = r.document;
  return r.uitkomst;
};
const faalt = (naam, invoer) => { try { register.voerUit(naam, invoer, { document: doc }); return null; } catch (e) { return e; } };
const model = () => model3dVan(doc);

// Portaal 6 × 4 m met een dakvlak op z = 4 (knopen 3–6).
for (const [x, y, z] of [[0, 0, 0], [6, 0, 0], [0, 0, 4], [6, 0, 4], [6, 4, 4], [0, 4, 4]]) doe("model3d.node.add", { x, y, z });
doe("model3d.beam.add", { startNodeId: 1, endNodeId: 3 });
doe("model3d.beam.add", { startNodeId: 2, endNodeId: 4 });
doe("model3d.beam.add", { startNodeId: 3, endNodeId: 4 });
const actief = doc.activeLoadCaseId;
const tweedeGeval = doc.loadCases.find((lc) => lc.id !== actief).id;

console.log("[1] opleggingen");
const vast = doe("model3d.support.set", { nodeId: 1, preset: "fixed" }).support;
check("inklemming via preset", vast.ux && vast.uy && vast.uz && vast.rx && vast.ry && vast.rz);
const scharnier = doe("model3d.support.set", { nodeId: 2, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false }).support;
check("scharnier via zes vrijheidsgraden", scharnier.uz && !scharnier.rx);
check("preset én vrijheidsgraden → INVOER_ONGELDIG", faalt("model3d.support.set", { nodeId: 2, preset: "pinned", ux: true })?.code === "INVOER_ONGELDIG");
check("drie vrijheidsgraden zonder preset → INVOER_ONGELDIG", faalt("model3d.support.set", { nodeId: 2, ux: true, uy: true, uz: true })?.code === "INVOER_ONGELDIG");
check("een onbekende knoop → NIET_GEVONDEN", faalt("model3d.support.set", { nodeId: 99, preset: "fixed" })?.code === "NIET_GEVONDEN");
const veer = doe("model3d.support.setSprings", { nodeId: 3, kzKnPerM: 1000 }).support;
check("veer op een vrije richting", veer?.springs?.kzKnPerM === 1000 && veer.uz === false, JSON.stringify(veer));
const vervangen = doe("model3d.support.setSprings", { nodeId: 1, kxKnPerM: 100 }).support;
check("een veer op een verhinderde richting vervangt die vaste richting (zoals in de app)",
  vervangen.ux === false && vervangen.springs.kxKnPerM === 100 && vervangen.uz === true, JSON.stringify(vervangen));
check("opgelegde zakking op een verhinderde richting",
  doe("model3d.support.setPrescribed", { nodeId: 1, uzM: -0.01 }).support?.prescribed?.uzM === -0.01);
doe("model3d.support.remove", { nodeId: 2 });
check("oplegging weg, knoop blijft", !(model().supports ?? []).some((s) => s.nodeId === 2) && model().nodes.some((n) => n.id === 2));
check("nog eens weghalen → NIET_GEVONDEN", faalt("model3d.support.remove", { nodeId: 2 })?.code === "NIET_GEVONDEN");

console.log("\n[2] lasten");
const knoopLast = doe("model3d.load.nodal.add", { nodeId: 4, fz: -10 }).load;
check("knooplast in het actieve geval, ontbrekende componenten 0", knoopLast.caseId === actief && knoopLast.fz === -10 && knoopLast.fx === 0);
check("een onbekend geval → NIET_GEVONDEN", faalt("model3d.load.nodal.add", { nodeId: 4, fz: -1, caseId: 999 })?.code === "NIET_GEVONDEN");
const knoopGewijzigd = doe("model3d.load.nodal.update", { id: knoopLast.id, fx: 2 }).load;
check("wijzigen laat de andere componenten staan", knoopGewijzigd.fx === 2 && knoopGewijzigd.fz === -10);
doe("model3d.load.nodal.delete", { id: knoopLast.id });
check("verwijderen; nog eens → NIET_GEVONDEN", faalt("model3d.load.nodal.delete", { id: knoopLast.id })?.code === "NIET_GEVONDEN");
const lijnLast = doe("model3d.load.member.add", { beamId: 3, qzStart: -5 }).load;
check("lijnlast over de hele staaf, gelijkmatig", lijnLast.qzEnd === -5 && lijnLast.startPositionM === 0 && Math.abs(lijnLast.endPositionM - 6) < 1e-9,
  JSON.stringify(lijnLast));
check("lijnlast trapezium", doe("model3d.load.member.update", { id: lijnLast.id, qzEnd: -8 }).load.qzStart === -5);
check("lijnlast op een onbekende staaf → NIET_GEVONDEN", faalt("model3d.load.member.add", { beamId: 99, qzStart: -1 })?.code === "NIET_GEVONDEN");
const puntLast = doe("model3d.load.memberPoint.add", { beamId: 3, pz: -12, positionM: 2 }).load;
check("puntlast op een staaf", puntLast.pz === -12 && puntLast.positionM === 2);
check("puntlast verplaatsen", doe("model3d.load.memberPoint.update", { id: puntLast.id, positionM: 3 }).load.positionM === 3);
doe("model3d.load.memberPoint.delete", { id: puntLast.id });
const warm = doe("model3d.load.thermal.add", { beamId: 1, deltaTUniformK: 20 }).load;
check("temperatuurbelasting", warm.deltaTUniformK === 20 && warm.deltaTGradientYK === 0);
check("alle temperatuurwaarden 0 → GEWEIGERD", faalt("model3d.load.thermal.add", { beamId: 1 })?.code === "GEWEIGERD");
check("temperatuur wijzigen", doe("model3d.load.thermal.update", { id: warm.id, deltaTGradientZK: 5 }).load.deltaTUniformK === 20);
doe("model3d.load.thermal.delete", { id: warm.id });
doe("model3d.plate.add", { nodeIds: [3, 4, 5, 6], thicknessM: 0.2 });
const vlakLast = doe("model3d.load.surface.add", { plateId: 1, qz: -2 }).load;
check("oppervlaktebelasting op de plaat", vlakLast.qz === -2 && vlakLast.plateId === 1);
check("oppervlaktebelasting wijzigen", doe("model3d.load.surface.update", { id: vlakLast.id, qz: -3 }).load.qz === -3);

console.log("\n[3] belastingvlakken");
const naarVlak = doe("model3d.plate.toLoadPanels", { plateId: 1 });
check("plaat met verticale last → belastingvlak; de plaat verdwijnt",
  naarVlak.loadPanelIds.length === 1 && (model().plates ?? []).length === 0 && (model().loadPanels ?? []).length === 1, JSON.stringify(naarVlak));
doe("model3d.loadPanel.delete", { id: naarVlak.loadPanelIds[0] });
const vlak = doe("model3d.loadPanel.add", { nodeIds: [3, 4, 5, 6], q: 2 }).loadPanel;
check("belastingvlak: actief geval, zwaartekracht, tweezijdig", vlak.caseId === actief && vlak.direction === "gravity" && vlak.distribution === "twoWay" && vlak.q === 2);
const eenzijdig = doe("model3d.loadPanel.update", { id: vlak.id, distribution: "oneWay" }).loadPanel;
check("eenzijdig krijgt een standaard overspanning", eenzijdig.distribution === "oneWay" && eenzijdig.spanDirection !== undefined);
const kopie = doe("model3d.loadPanel.duplicate", { id: vlak.id, caseId: tweedeGeval });
check("kopie in een ander geval", model().loadPanels.find((p) => p.id === kopie.loadPanelId)?.caseId === tweedeGeval);
check("een vlak in een onbekend geval → NIET_GEVONDEN", faalt("model3d.loadPanel.add", { nodeIds: [3, 4, 5, 6], caseId: 999 })?.code === "NIET_GEVONDEN");
doe("model3d.loadPanel.delete", { id: kopie.loadPanelId });
check("vlak verwijderd", !model().loadPanels.some((p) => p.id === kopie.loadPanelId));

console.log("\n[4] schijven en trek-alleen");
const scheef = faalt("model3d.diaphragm.add", { nodeIds: [1, 3] });
check("knopen op verschillende hoogte → GEWEIGERD met de reden", scheef?.code === "GEWEIGERD" && scheef.message.includes("mm"), scheef?.message);
const schijf = doe("model3d.diaphragm.add", { nodeIds: [3, 4, 5, 6], name: "dak" });
check("schijf op één hoogte", schijf.diaphragmId >= 1 && model().diaphragms.length === 1);
const dubbel = faalt("model3d.diaphragm.add", { nodeIds: [3, 4] });
check("een knoop in twee schijven → GEWEIGERD", dubbel?.code === "GEWEIGERD" && dubbel.message.includes("schijf"), dubbel?.message);
doe("model3d.diaphragm.delete", { id: schijf.diaphragmId });
check("schijf verwijderd", (model().diaphragms ?? []).length === 0);
doe("model3d.beam.setTensionOnly", { beamIds: [1, 2], on: true });
check("trek-alleen aan", model().beams.filter((b) => b.tensionOnly).map((b) => b.id).join() === "1,2");
doe("model3d.beam.setTensionOnly", { beamIds: [2], on: false });
check("trek-alleen uit", model().beams.filter((b) => b.tensionOnly).map((b) => b.id).join() === "1");
check("een onbekende staaf → NIET_GEVONDEN", faalt("model3d.beam.setTensionOnly", { beamIds: [99], on: true })?.code === "NIET_GEVONDEN");
const aan = doe("model3d.settings.update", { tensionOnlyFitAfterPermanent: true, tensionOnlyCrossRule: true });
check("montage en kruisregel aan", aan.tensionOnlyFitAfterPermanent && aan.tensionOnlyCrossRule && model().tensionOnlyCrossRule === true);
const uit = doe("model3d.settings.update", { tensionOnlyCrossRule: false });
check("kruisregel uit, montage blijft", uit.tensionOnlyFitAfterPermanent && !uit.tensionOnlyCrossRule && !("tensionOnlyCrossRule" in model()));

console.log("\n[setMany] alle opleggingen in één keer scharnierend");
{
  const bewaard = doc;
  doe("model3d.support.set", { nodeId: 1, preset: "fixed" });
  doe("model3d.support.set", { nodeId: 2, preset: "xRoller" });
  doe("model3d.support.setSprings", { nodeId: 2, krxKnmPerRad: 5000, kzKnPerM: 800 });
  const vooraf = model().supports.map((support) => support.nodeId).sort((a, b) => a - b);
  const uit = doe("model3d.support.setMany", { allSupports: true, preset: "pinned" });
  const s = (id) => model().supports.find((support) => support.nodeId === id);
  check("alle bestaande opleggingen, en alleen die", JSON.stringify([...uit.nodeIds].sort((a, b) => a - b)) === JSON.stringify(vooraf)
    && model().supports.length === vooraf.length, `${JSON.stringify(uit.nodeIds)} vs ${JSON.stringify(vooraf)}`);
  check("allemaal scharnier", vooraf.every((id) => s(id).ux && s(id).uy && s(id).uz && !s(id).rx && !s(id).ry && !s(id).rz),
    JSON.stringify(model().supports));
  check("een veer in een richting die vrij blijft (rx) blijft staan; die in uz vervalt",
    s(2).springs?.krxKnmPerRad === 5000 && s(2).springs?.kzKnPerM === undefined, JSON.stringify(s(2)));
  const aantal = model().supports.length;
  const nieuweKnoop = doe("model3d.node.add", { x: 9, y: 9, z: 0 }).node.id;
  doe("model3d.support.setMany", { nodeIds: [nieuweKnoop, nieuweKnoop], preset: "fixed" });
  check("met nodeIds: een nieuwe oplegging, een dubbele id één keer", s(nieuweKnoop)?.rz === true && model().supports.length === aantal + 1);
  check("nodeIds én allSupports → INVOER_ONGELDIG",
    faalt("model3d.support.setMany", { nodeIds: [1], allSupports: true, preset: "pinned" })?.code === "INVOER_ONGELDIG");
  check("geen van beide → INVOER_ONGELDIG", faalt("model3d.support.setMany", { preset: "pinned" })?.code === "INVOER_ONGELDIG");
  check("een onbekende knoop → NIET_GEVONDEN", faalt("model3d.support.setMany", { nodeIds: [99], preset: "pinned" })?.code === "NIET_GEVONDEN");
  doc = bewaard;
}

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

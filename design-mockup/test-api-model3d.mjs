// API-commando's voor het 3D-model (src/api/commands/model3d*.ts), via het
// register zoals het bedieningskanaal en de sidecar ze aanroepen: een keten
// van documenten, met de foutcodes van het register.
const { maakRegister } = await import("./src/api/register.ts");
const { leegDocument, model3dVan } = await import("./src/api/projectDocument.ts");
const { MODEL3D_GEOMETRIE_COMMANDOS } = await import("./src/api/commands/model3dGeometrie.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const register = maakRegister(MODEL3D_GEOMETRIE_COMMANDOS);
let doc = leegDocument();
const doe = (naam, invoer) => {
  const r = register.voerUit(naam, invoer, { document: doc });
  if (r.document) doc = r.document;
  return r.uitkomst;
};
const faalt = (naam, invoer) => { try { register.voerUit(naam, invoer, { document: doc }); return null; } catch (e) { return e; } };
const model = () => model3dVan(doc);

console.log("[1] knopen");
const begin = doc;
const ids = [[0, 0, 0], [6, 0, 0], [6, 0, 4], [0, 0, 4]].map(([x, y, z]) => doe("model3d.node.add", { x, y, z }).node.id);
check("vier knopen met id 1–4", ids.join() === "1,2,3,4", ids.join());
check("het begindocument is ongewijzigd", model3dVan(begin).nodes.length === 0);
const dubbel = faalt("model3d.node.add", { x: 0, y: 0, z: 0 });
check("een knoop op een bestaande plek → GEWEIGERD met die knoop", dubbel?.code === "GEWEIGERD" && dubbel.message.includes("knoop 1"), dubbel?.message);
check("een onbekend veld → INVOER_ONGELDIG", faalt("model3d.node.add", { x: 1, y: 1, z: 1, w: 0 })?.code === "INVOER_ONGELDIG");
check("verplaatsen", doe("model3d.node.update", { id: 4, z: 4.5 }).node.z === 4.5 && model().nodes.find((n) => n.id === 4).z === 4.5);
check("een onbekende knoop → NIET_GEVONDEN", faalt("model3d.node.update", { id: 9, x: 1 })?.code === "NIET_GEVONDEN");

console.log("\n[2] staven");
const kolom = doe("model3d.beam.add", { startNodeId: 1, endNodeId: 4 }).beam;
check("standaard IPE 200 in S235", kolom.id === 1 && kolom.profileName === "IPE 200" && kolom.material === "S235");
const gedraaid = doe("model3d.beam.add", { startNodeId: 2, endNodeId: 3, profileName: "HEA 200", rollAngleDeg: 90, group: "kolom" }).beam;
check("rolhoek in graden → radialen in het model", Math.abs(gedraaid.rollAngleRad - Math.PI / 2) < 1e-12 && gedraaid.group === "kolom");
doe("model3d.beam.add", { startNodeId: 4, endNodeId: 3, name: "R1" });
const bestaand = faalt("model3d.beam.add", { startNodeId: 4, endNodeId: 1 });
check("een bestaande verbinding → GEWEIGERD met die staaf", bestaand?.code === "GEWEIGERD" && bestaand.message.includes("staaf 1"), bestaand?.message);
const gewijzigd = doe("model3d.beam.update", { id: 3, profileName: "IPE 300", name: null }).beam;
check("profiel wijzigen, naam wissen", gewijzigd.profileName === "IPE 300" && gewijzigd.name === undefined);
check("rolhoek wissen met null", doe("model3d.beam.update", { id: 2, rollAngleDeg: null }).beam.rollAngleRad === undefined);
const gesplitst = doe("model3d.beam.split", { id: 3, fraction: 0.5 });
const tussen = model().nodes.find((n) => n.id === gesplitst.nodeId);
check("splitsen op de helft: een tussenknoop in het midden", tussen && Math.abs(tussen.x - 3) < 1e-9 && model().beams.length === 4,
  JSON.stringify(gesplitst));
check("fraction én positionM → INVOER_ONGELDIG", faalt("model3d.beam.split", { id: 1, fraction: 0.5, positionM: 1 })?.code === "INVOER_ONGELDIG");
check("een plaats voorbij het eind → GEWEIGERD", faalt("model3d.beam.split", { id: 1, positionM: 99 })?.code === "GEWEIGERD");
{
  // Lokale assen omkeren op een eigen klein model: de lasten draaien mee.
  const bewaard = doc;
  doc = leegDocument();
  doe("model3d.node.add", { x: 0, y: 0, z: 0 });
  doe("model3d.node.add", { x: 5, y: 0, z: 0 });
  doe("model3d.beam.add", { startNodeId: 1, endNodeId: 2, rollAngleDeg: 30 });
  doc = { ...doc, model3d: { ...model(),
    memberLoads: [{ id: 1, beamId: 1, caseId: 2, qyStart: 1, qyEnd: 2, qzStart: -3, qzEnd: -4, startPositionM: 0, endPositionM: 5 }],
    memberPointLoads: [{ id: 1, beamId: 1, caseId: 2, py: 5, pz: -6, positionM: 2 }],
    thermalLoads: [{ id: 1, beamId: 1, caseId: 2, deltaTUniformK: 10, deltaTGradientYK: 3, deltaTGradientZK: -4 }],
  } };
  const omgekeerd = doe("model3d.beam.flipLocalAxes", { id: 1 }).beam;
  check("assen omkeren: rolhoek + 180°", Math.abs(omgekeerd.rollAngleRad - 210 * Math.PI / 180) < 1e-12, String(omgekeerd.rollAngleRad));
  const m = model();
  check("de lokale lastcomponenten draaien mee, de gelijkmatige temperatuur niet",
    m.memberLoads[0].qyStart === -1 && m.memberLoads[0].qzEnd === 4 && m.memberPointLoads[0].py === -5 && m.memberPointLoads[0].pz === 6
      && m.thermalLoads[0].deltaTGradientYK === -3 && m.thermalLoads[0].deltaTGradientZK === 4 && m.thermalLoads[0].deltaTUniformK === 10);
  doe("model3d.beam.flipLocalAxes", { id: 1 });
  check("twee keer omkeren geeft het origineel", Math.abs(model().beams[0].rollAngleRad - 30 * Math.PI / 180) < 1e-12
    && model().memberLoads[0].qyStart === 1 && model().memberPointLoads[0].pz === -6);
  check("assen omkeren van een onbekende staaf → NIET_GEVONDEN", faalt("model3d.beam.flipLocalAxes", { id: 9 })?.code === "NIET_GEVONDEN");
  doc = bewaard;
}
{
  // Eindscharnieren als standaardsituatie, zoals de knoppen Momentvast en Scharnierend.
  const bewaard = doc;
  const uit = doe("model3d.beam.setReleasePreset", { beamIds: [1, 2], preset: "pinned" });
  const r = (id) => model().beams.find((b) => b.id === id).releases;
  check("scharnierend: My en Mz los aan beide einden, torsie niet", uit.beamIds.join() === "1,2" && uit.preset === "pinned"
    && [1, 2].every((id) => r(id).myStart && r(id).myEnd && r(id).mzStart && r(id).mzEnd && !r(id).torsionStart && !r(id).torsionEnd),
    JSON.stringify(uit));
  doe("model3d.beam.setReleasePreset", { beamIds: [2], preset: "rigid" });
  check("momentvast haalt de scharnieren weg, staaf 1 blijft scharnierend", r(2) === undefined && r(1).myStart === true);
  check("een onbekende staaf → NIET_GEVONDEN", faalt("model3d.beam.setReleasePreset", { beamIds: [1, 9], preset: "pinned" })?.code === "NIET_GEVONDEN");
  check("een lege lijst → INVOER_ONGELDIG", faalt("model3d.beam.setReleasePreset", { beamIds: [], preset: "pinned" })?.code === "INVOER_ONGELDIG");
  check("een onbekende situatie → INVOER_ONGELDIG", faalt("model3d.beam.setReleasePreset", { beamIds: [1], preset: "half" })?.code === "INVOER_ONGELDIG");
  doc = bewaard;
}
{
  // Scharnier aan één staafeind (het gereedschap in het lint) en liggers
  // scharnierend op kolommen (#93), op een eigen portaal met uitkraging:
  // kolommen 1 en 2, ligger 3 tussen de kolomkoppen, uitkraging 4.
  const bewaard = doc;
  doc = leegDocument();
  for (const [x, y, z] of [[0, 0, 0], [0, 0, 4], [6, 0, 0], [6, 0, 4], [9, 0, 4]]) doe("model3d.node.add", { x, y, z });
  for (const [a, b] of [[1, 2], [3, 4], [2, 4], [4, 5]]) doe("model3d.beam.add", { startNodeId: a, endNodeId: b });
  const r = (id) => model().beams.find((b) => b.id === id).releases;
  const einden = (changed) => changed.map((c) => `${c.beamId}${c.end === "start" ? "b" : "e"}${c.reason ? `:${c.reason}` : ""}`).join(" ");
  const portaal = doc;
  const los = doe("model3d.beam.setEndHinge", { beamId: 3, end: "start" });
  check("setEndHinge zonder hinged wisselt: My en Mz aan het begin los",
    los.beamId === 3 && los.end === "start" && los.hinged === true && r(3).myStart && r(3).mzStart && !r(3).myEnd && !r(3).torsionStart,
    JSON.stringify(los));
  const vast = doe("model3d.beam.setEndHinge", { beamId: 3, end: "start" });
  check("… nog eens: weer vast, zonder scharnierveld (zoals Momentvast)", vast.hinged === false && r(3) === undefined);
  check("hinged: true zet los, ook twee keer", doe("model3d.beam.setEndHinge", { beamId: 3, end: "end", hinged: true }).hinged
    && doe("model3d.beam.setEndHinge", { beamId: 3, end: "end", hinged: true }).hinged && r(3).myEnd && r(3).mzEnd);
  check("een onbekende staaf → NIET_GEVONDEN", faalt("model3d.beam.setEndHinge", { beamId: 9, end: "start" })?.code === "NIET_GEVONDEN");
  check("een onbekend eind → INVOER_ONGELDIG", faalt("model3d.beam.setEndHinge", { beamId: 3, end: "midden" })?.code === "INVOER_ONGELDIG");
  doc = portaal;
  const alles = doe("model3d.beam.pinToColumns", {});
  check("pinToColumns zonder beamIds: de ligger tussen de kolomkoppen aan beide einden",
    alles.count === 2 && einden(alles.changed) === "3b 3e", JSON.stringify(alles));
  check("… de uitkraging blijft momentvast (anders een mechanisme) en staat in skipped",
    einden(alles.skipped) === "4b:cantilever" && r(4) === undefined, JSON.stringify(alles.skipped));
  check("… de kolommen blijven doorgaand, torsie overal vast", r(1) === undefined && r(2) === undefined
    && !r(3).torsionStart && !r(3).torsionEnd);
  const nogEens = doe("model3d.beam.pinToColumns", { beamIds: [3, 4] });
  check("nog eens: niets meer te doen (de uitkraging blijft overgeslagen)",
    nogEens.count === 0 && nogEens.changed.length === 0 && einden(nogEens.skipped) === "4b:cantilever");
  doc = portaal;
  const selectie = doe("model3d.beam.pinToColumns", { beamIds: [4, 1] });
  check("alleen de genoemde staven: de uitkraging blijft momentvast, kolom 1 en ligger 3 niet aangeraakt",
    selectie.count === 0 && einden(selectie.skipped) === "4b:cantilever" && r(3) === undefined && r(1) === undefined && r(4) === undefined,
    JSON.stringify(selectie));
  // Een kolom onder het vrije eind: dan is de uitkraging een ligger tussen twee kolomkoppen.
  doc = portaal;
  doe("model3d.node.add", { x: 9, y: 0, z: 0 });
  doe("model3d.beam.add", { startNodeId: 6, endNodeId: 5 });
  const gesteund = doe("model3d.beam.pinToColumns", { beamIds: [4, 1] });
  check("met een kolom onder het eind: staaf 4 aan beide einden scharnierend",
    einden(gesteund.changed) === "4b 4e" && gesteund.skipped.length === 0 && r(4).myStart && r(4).mzEnd, JSON.stringify(gesteund));
  check("een onbekende staaf → NIET_GEVONDEN", faalt("model3d.beam.pinToColumns", { beamIds: [3, 99] })?.code === "NIET_GEVONDEN");
  check("een lege lijst → INVOER_ONGELDIG", faalt("model3d.beam.pinToColumns", { beamIds: [] })?.code === "INVOER_ONGELDIG");
  doc = bewaard;
}
check("een onbekende staaf verwijderen → NIET_GEVONDEN", faalt("model3d.beam.delete", { id: 99 })?.code === "NIET_GEVONDEN");
doe("model3d.beam.delete", { id: 2 });
check("staaf verwijderd, knopen blijven", !model().beams.some((b) => b.id === 2) && model().nodes.length === 5);
const weg = doe("model3d.node.delete", { id: 1 });
check("knoop verwijderen neemt zijn staven mee", weg.removedBeamIds.join() === "1" && !model().nodes.some((n) => n.id === 1), JSON.stringify(weg));

console.log("\n[3] platen en openingen");
doc = leegDocument();
for (const [x, y] of [[0, 0], [4, 0], [4, 3], [0, 3], [1, 1], [2, 1], [2, 2], [1, 2]]) doe("model3d.node.add", { x, y, z: 0 });
const plaat = doe("model3d.plate.add", { nodeIds: [1, 2, 3, 4], thicknessM: 0.2, material: "C30/37" }).plate;
check("plaat 1, 200 mm", plaat.id === 1 && plaat.thicknessM === 0.2 && plaat.material === "C30/37");
check("twee knopen → INVOER_ONGELDIG (minstens drie)", faalt("model3d.plate.add", { nodeIds: [1, 2], thicknessM: 0.2 })?.code === "INVOER_ONGELDIG");
const randen = [{ edge: 0, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false }];
const bijgewerkt = doe("model3d.plate.update", { id: 1, thicknessM: 0.25, edgeSupports: randen }).plate;
check("dikte en randoplegging", bijgewerkt.thicknessM === 0.25 && bijgewerkt.edgeSupports?.length === 1);
const opening = doe("model3d.plate.addOpening", { plateId: 1, nodeIds: [5, 6, 7, 8] }).opening;
check("opening in de plaat", opening.id >= 1 && model().plates[0].openings.length === 1, JSON.stringify(opening));
doe("model3d.plate.delete", { id: 1 });
check("plaat verwijderd, knopen blijven", (model().plates ?? []).length === 0 && model().nodes.length === 8);

console.log("\n[4] model lezen");
const gelezen = doe("model3d.get", {});
check("aantallen en model", gelezen.counts.nodes === 8 && gelezen.counts.beams === 0 && gelezen.model.nodes.length === 8);

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

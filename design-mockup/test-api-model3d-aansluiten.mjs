// API-commando voor knopen op staven aansluiten (issue #63):
// model3d.beam.connectNodes, via het register — dezelfde zuivere functie als
// de lintknop en de knop Aansluiten in de modelcontrole
// (connectOpenFem3DNodesToBeams). Draait tegen de bron én tegen de
// sidecarbundel (de MCP-server voert het daar uit).
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
const json = JSON.stringify;
const dicht = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// Een ligger van 12 m langs X (knopen 1–2) met een trapeziumlast, en drie
// losse knopen erop (3, 4, 5 op 3, 6 en 9 m; knoop 5 ligt 2 mm naast de as),
// plus een knoop 6 die 8 mm naast de as ligt.
for (const [x, y, z] of [[0, 0, 0], [12, 0, 0], [3, 0, 0], [6, 0, 0], [9, 0.002, 0], [4, 0.008, 0]]) doe("model3d.node.add", { x, y, z });
doe("model3d.beam.add", { startNodeId: 1, endNodeId: 2, profileName: "IPE 300", releases: { myStart: true, mzStart: true } });
doe("model3d.load.member.add", { beamId: 1, qzStart: -2, qzEnd: -6, startPositionM: 2, endPositionM: 10 });

console.log("[1] model3d.beam.connectNodes");
const catalogus = register.catalogus().find((c) => c.naam === "model3d.beam.connectNodes");
check("het commando staat in de catalogus, met toleranceMm, beamIds en nodeIds",
  Boolean(catalogus) && ["toleranceMm", "beamIds", "nodeIds"].every((veld) => catalogus.invoer.properties?.[veld])
  && catalogus.invoer.additionalProperties === false, json(catalogus?.invoer));
const alleenKnoop4 = doe("model3d.beam.connectNodes", { nodeIds: [4] });
check("alleen knoop 4: staaf 1 in twee delen", json(alleenKnoop4.splits) === json([{ beamId: 1, nodeIds: [4], beamIds: [1, 2], parts: 2 }])
  && alleenKnoop4.count === 1 && alleenKnoop4.nodeCount === 1, json(alleenKnoop4));
const rest = doe("model3d.beam.connectNodes", {});
check("daarna het hele model: staaf 1 op knoop 3, staaf 2 op knoop 5 (2 mm naast de as); knoop 6 (8 mm) niet",
  json(rest.splits.map((s) => [s.beamId, s.nodeIds, s.parts])) === json([[1, [3], 2], [2, [5], 2]]) && rest.count === 2,
  json(rest.splits));
const ketting = [1, 3, 2, 4].map((id) => model().beams.find((b) => b.id === id));
check("de ligger is nu vier staven 1→3→4→5→2",
  json(ketting.map((b) => [b?.startNodeId, b?.endNodeId])) === json([[1, 3], [3, 4], [4, 5], [5, 2]]), json(model().beams));
check("knoop 5 is niet verschoven", json(model().nodes.find((n) => n.id === 5)) === json({ id: 5, x: 9, y: 0.002, z: 0 }));
check("het beginscharnier zit op het eerste deel", ketting[0].releases?.myStart === true && ketting[3].releases?.myStart !== true);
const lasten = model().memberLoads;
check("de trapeziumlast per deel: resultante −32 kN, aansluitend",
  lasten.length === 4 && dicht(lasten.reduce((s, l) => s + (l.qzStart + l.qzEnd) / 2 * (l.endPositionM - l.startPositionM), 0), -32, 1e-4),
  json(lasten));
const breed = doe("model3d.beam.connectNodes", { toleranceMm: 10 });
check("met 10 mm tolerantie ook knoop 6 (8 mm naast de as)", breed.count === 1 && json(breed.splits[0].nodeIds) === json([6]), json(breed));
const niets = doe("model3d.beam.connectNodes", {});
check("opnieuw: niets te doen, count 0", niets.count === 0 && niets.splits.length === 0 && niets.skipped.length === 0, json(niets));
// Twee staven die elkaar overlappen: A (20 → 30 m) en B (knoop op 24 m → 30 m).
// De knoop op 24 m ligt op A, maar een knip daar zou B verdubbelen.
const [k20, k30, k24] = [[20, 0, 0], [30, 0, 0], [24, 0, 0]].map(([x, y, z]) => doe("model3d.node.add", { x, y, z }).node.id);
const staafA = doe("model3d.beam.add", { startNodeId: k20, endNodeId: k30 }).beam.id;
const staafB = doe("model3d.beam.add", { startNodeId: k24, endNodeId: k30 }).beam.id;
const overlap = doe("model3d.beam.connectNodes", { beamIds: [staafA] });
check("overlappende staven: niets gesplitst, de knoop overgeslagen met de staaf die verdubbeld zou worden (otherBeamId)",
  overlap.count === 0 && json(overlap.skipped) === json([{ nodeId: k24, beamId: staafA, reason: "duplicate", otherBeamId: staafB }]),
  json(overlap));
check("een onbekende staaf → NIET_GEVONDEN", faalt("model3d.beam.connectNodes", { beamIds: [99] })?.code === "NIET_GEVONDEN");
check("een onbekende knoop → NIET_GEVONDEN", faalt("model3d.beam.connectNodes", { nodeIds: [99] })?.code === "NIET_GEVONDEN");
check("tolerantie buiten 0,1–25 mm → INVOER_ONGELDIG",
  faalt("model3d.beam.connectNodes", { toleranceMm: 30 })?.code === "INVOER_ONGELDIG"
  && faalt("model3d.beam.connectNodes", { toleranceMm: 0.05 })?.code === "INVOER_ONGELDIG");
check("een onbekend veld → INVOER_ONGELDIG", faalt("model3d.beam.connectNodes", { tolerance: 5 })?.code === "INVOER_ONGELDIG");

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

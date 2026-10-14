// API-commando voor knopen samenvoegen (issue #75): model3d.nodes.merge, via
// het register — dezelfde zuivere functie als de lintknop Knopen samenvoegen en
// de knop Samenvoegen in de modelcontrole (mergeOpenFem3DNodes). Draait tegen
// de bron én tegen de sidecarbundel (de MCP-server voert het daar uit).
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

// Twee platen die apart getekend zijn: plaat 1 op knopen 1–4 van (0; 0) tot
// (4; 3), plaat 2 op knopen 5–8 van (4; 0) tot (8; 3), maar knoop 5 ligt 2 mm
// en knoop 8 3 mm naast de hoeken 2 en 3. Een staaf A van 2 naar 3 (de
// gedeelde rand) en een staaf B van 8 naar 5 (dezelfde rand, omgekeerd, met
// een lijnlast). Knoop 9 ligt 4 mm naast knoop 4.
for (const [x, y, z] of [[0, 0, 0], [4, 0, 0], [4, 3, 0], [0, 3, 0], [4.002, 0, 0], [8, 0, 0], [8, 3, 0], [4, 3.003, 0], [0.004, 3, 0]]) {
  doe("model3d.node.add", { x, y, z });
}
doe("model3d.plate.add", { nodeIds: [1, 2, 3, 4], thicknessM: 0.2 });
doe("model3d.plate.add", { nodeIds: [5, 6, 7, 8], thicknessM: 0.2 });
const staafA = doe("model3d.beam.add", { startNodeId: 2, endNodeId: 3, profileName: "IPE 200" }).beam.id;
const staafB = doe("model3d.beam.add", { startNodeId: 8, endNodeId: 5, profileName: "IPE 200" }).beam.id;
doe("model3d.load.member.add", { beamId: staafB, qyStart: 1, qyEnd: 1, qzStart: -2, qzEnd: -4, startPositionM: 0, endPositionM: 1 });
doe("model3d.support.set", { nodeId: 5, preset: "pinned" });

console.log("[1] model3d.nodes.merge");
const catalogus = register.catalogus().find((c) => c.naam === "model3d.nodes.merge");
check("het commando staat in de catalogus, met toleranceMm en nodeIds, zonder andere velden",
  Boolean(catalogus) && ["toleranceMm", "nodeIds"].every((veld) => catalogus.invoer.properties?.[veld])
  && catalogus.invoer.additionalProperties === false, json(catalogus?.invoer));
const alleen9 = doe("model3d.nodes.merge", { nodeIds: [9] });
check("alleen knoop 9: 9 gaat op in 4 (4 mm); de platen blijven los",
  json(alleen9.groups) === json([{ keepNodeId: 4, nodeIds: [9], distanceMm: 4 }]) && alleen9.count === 1 && alleen9.nodeCount === 1
  && model().nodes.length === 8, json(alleen9));
const rest = doe("model3d.nodes.merge", {});
check("daarna het hele model: 5 → 2 en 8 → 3",
  json(rest.groups.map((g) => [g.keepNodeId, g.nodeIds])) === json([[2, [5]], [3, [8]]]) && rest.nodeCount === 2, json(rest.groups));
check("plaat 2 deelt nu de rand 2–3 met plaat 1", json(model().plates.find((p) => p.id === 2).nodeIds) === json([2, 6, 7, 3]));
check("staaf B viel omgekeerd samen met staaf A en is erin opgegaan, met haar last",
  json(rest.mergedBeams) === json([{ beamId: staafB, intoBeamId: staafA, reversed: true, loadCount: 1 }])
  && model().beams.length === 1, json(rest.mergedBeams));
const last = model().memberLoads[0];
// Staaf B was √(0,002² + 3,003²) m lang (8 → 5) en is nu 3 m: de last over de
// eerste meter schaalt mee, en ligt gespiegeld aan het eind van A.
const { startPositionM, endPositionM, ...waarden } = last;
check("de last gespiegeld naar het eind van staaf A (posities met de lengte meegeschaald) en qy van teken om, qz niet",
  json(waarden) === json({ id: 1, beamId: staafA, caseId: 1, qyStart: -1, qyEnd: -1, qzStart: -4, qzEnd: -2 })
  && Math.abs(startPositionM - (3 - 3 / Math.hypot(0.002, 3.003))) < 1e-9 && endPositionM === 3, json(last));
check("de oplegging van knoop 5 zit nu op knoop 2", json(model().supports.map((s) => s.nodeId)) === json([2]));
const niets = doe("model3d.nodes.merge", {});
check("opnieuw: niets te doen, count 0, geen weigering", niets.count === 0 && niets.groups.length === 0 && niets.refused.length === 0, json(niets));
// Een geweigerde groep: twee veren in dezelfde richting.
const k20 = doe("model3d.node.add", { x: 20, y: 0, z: 0 }).node.id;
const k21 = doe("model3d.node.add", { x: 20.002, y: 0, z: 0 }).node.id;
doe("model3d.support.setSprings", { nodeId: k20, kzKnPerM: 1000 });
doe("model3d.support.setSprings", { nodeId: k21, kzKnPerM: 2000 });
const veren = doe("model3d.nodes.merge", {});
check("twee veren in uz: geweigerd met de reden, het model ongewijzigd",
  veren.count === 0 && json(veren.refused) === json([{ nodeIds: [k20, k21], keepNodeId: k20, reason: { kind: "springs", dof: "uz" } }])
  && model().nodes.some((n) => n.id === k21), json(veren));
check("een tolerantie van 1 mm vindt ze niet", doe("model3d.nodes.merge", { toleranceMm: 1 }).refused.length === 0);
check("een onbekende knoop → NIET_GEVONDEN", faalt("model3d.nodes.merge", { nodeIds: [99] })?.code === "NIET_GEVONDEN");
check("tolerantie buiten 0,1–25 mm → INVOER_ONGELDIG",
  faalt("model3d.nodes.merge", { toleranceMm: 30 })?.code === "INVOER_ONGELDIG"
  && faalt("model3d.nodes.merge", { toleranceMm: 0.05 })?.code === "INVOER_ONGELDIG");
check("een onbekend veld → INVOER_ONGELDIG", faalt("model3d.nodes.merge", { tolerance: 5 })?.code === "INVOER_ONGELDIG");

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

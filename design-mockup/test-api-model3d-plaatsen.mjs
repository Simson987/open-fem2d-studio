// API-commando's voor plaatsen op een object (issues #76 en #77):
// model3d.support.place (oplegging of veer op een knoop, staaf, plaat of vrij
// punt) en model3d.load.placePoint (puntlast op een knoop of staaf), via het
// register — dezelfde zuivere functies als de gereedschappen in de app. Draait
// tegen de bron én tegen de sidecarbundel (de MCP-server voert ze daar uit).
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
const dicht = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// Ligger van 6 m op z = 3 (knopen 1–2) met een lijnlast en een puntlast, en
// een vloerplaat 6 × 4 m op z = 0 (knopen 3–6) met een opening (knopen 7–10).
for (const [x, y, z] of [[0, 0, 3], [6, 0, 3], [0, 1, 0], [6, 1, 0], [6, 5, 0], [0, 5, 0], [2, 2, 0], [3, 2, 0], [3, 3, 0], [2, 3, 0]]) {
  doe("model3d.node.add", { x, y, z });
}
doe("model3d.beam.add", { startNodeId: 1, endNodeId: 2, profileName: "IPE 300" });
doe("model3d.plate.add", { nodeIds: [3, 4, 5, 6], thicknessM: 0.2 });
doe("model3d.plate.addOpening", { plateId: 1, nodeIds: [7, 8, 9, 10] });
doe("model3d.load.member.add", { beamId: 1, qzStart: -5 });
doe("model3d.load.memberPoint.add", { beamId: 1, pz: -12, positionM: 4.5 });
const actief = doc.activeLoadCaseId;
const tweedeGeval = doc.loadCases.find((lc) => lc.id !== actief).id;

console.log("[1] model3d.support.place");
const opStaaf = doe("model3d.support.place", { target: { kind: "beam", beamId: 1, positionM: 2.5 }, preset: "pinned" });
check("op een staaf: gesplitst, nieuwe knoop 11 op 2,5 m met een scharnier",
  opStaaf.created === "beamSplit" && opStaaf.nodeId === 11 && opStaaf.split?.beamId === 1
  && dicht(opStaaf.node.x, 2.5) && opStaaf.node.z === 3 && opStaaf.support.uz === true && opStaaf.support.rx === false,
  JSON.stringify(opStaaf));
const tweede = model().beams.find((b) => b.id === opStaaf.split.secondBeamId);
check("… de staaf loopt nu 1 → 11 en 11 → 2", model().beams.find((b) => b.id === 1).endNodeId === 11 && tweede?.startNodeId === 11 && tweede.endNodeId === 2);
check("… de lijnlast is verdeeld en de puntlast op 4,5 m staat op het tweede deel op 2,0 m",
  model().memberLoads.length === 2 && model().memberPointLoads[0].beamId === tweede.id && dicht(model().memberPointLoads[0].positionM, 2));
const opEind = doe("model3d.support.place", { target: { kind: "beam", beamId: 1, t: 0 }, preset: "fixed" });
check("t = 0: de beginknoop, geen splitsing", opEind.created === "existing" && opEind.nodeId === 1 && model().beams.length === 2);
const opPlaat = doe("model3d.support.place", { target: { kind: "plate", plateId: 1, x: 4.5, y: 4, z: 0.1 }, preset: "zRoller" });
check("op een plaat: nieuwe knoop in het middenvlak (z = 0), met de oplegging",
  opPlaat.created === "plate" && opPlaat.node.x === 4.5 && opPlaat.node.y === 4 && opPlaat.node.z === 0 && opPlaat.support.uz === true);
check("in een opening → GEWEIGERD",
  faalt("model3d.support.place", { target: { kind: "plate", plateId: 1, x: 2.5, y: 2.5, z: 0 }, preset: "pinned" })?.code === "GEWEIGERD");
check("buiten de plaat → GEWEIGERD",
  faalt("model3d.support.place", { target: { kind: "plate", plateId: 1, x: 9, y: 2, z: 0 }, preset: "pinned" })?.code === "GEWEIGERD");
const veer = doe("model3d.support.place", { target: { kind: "point", x: 10, y: 0, z: 0 }, springAxis: "kz", stiffness: 5000 });
check("vrij punt met een veer: nieuwe knoop, Z-veer 5000 kN/m", veer.created === "point" && veer.support.springs.kzKnPerM === 5000 && veer.support.uz === false);
const veerStandaard = doe("model3d.support.place", { target: { kind: "node", nodeId: 2 }, springAxis: "krx" });
check("veer zonder stijfheid: de beginwaarde 1000 kNm/rad", veerStandaard.created === "existing" && veerStandaard.support.springs.krxKnmPerRad === 1000);
check("preset én springAxis, of geen van beide → INVOER_ONGELDIG",
  faalt("model3d.support.place", { target: { kind: "node", nodeId: 2 }, preset: "pinned", springAxis: "kz" })?.code === "INVOER_ONGELDIG"
  && faalt("model3d.support.place", { target: { kind: "node", nodeId: 2 } })?.code === "INVOER_ONGELDIG");
check("t én positionM, of geen van beide → INVOER_ONGELDIG",
  faalt("model3d.support.place", { target: { kind: "beam", beamId: 1, t: 0.5, positionM: 1 }, preset: "pinned" })?.code === "INVOER_ONGELDIG"
  && faalt("model3d.support.place", { target: { kind: "beam", beamId: 1 }, preset: "pinned" })?.code === "INVOER_ONGELDIG");
check("onbekende staaf, plaat of knoop → NIET_GEVONDEN",
  faalt("model3d.support.place", { target: { kind: "beam", beamId: 99, t: 0.5 }, preset: "pinned" })?.code === "NIET_GEVONDEN"
  && faalt("model3d.support.place", { target: { kind: "plate", plateId: 9, x: 0, y: 0, z: 0 }, preset: "pinned" })?.code === "NIET_GEVONDEN"
  && faalt("model3d.support.place", { target: { kind: "node", nodeId: 99 }, preset: "pinned" })?.code === "NIET_GEVONDEN");
check("onbekend soort doel → INVOER_ONGELDIG (schema)",
  faalt("model3d.support.place", { target: { kind: "face", x: 0 }, preset: "pinned" })?.code === "INVOER_ONGELDIG");

console.log("\n[2] model3d.load.placePoint");
const knoopLast = doe("model3d.load.placePoint", { target: { kind: "node", nodeId: 2 } });
check("op een knoop zonder waarden: knooplast Fz = −10 kN in het actieve geval",
  knoopLast.kind === "nodal" && knoopLast.load.nodeId === 2 && knoopLast.load.fz === -10 && knoopLast.load.fx === 0 && knoopLast.load.caseId === actief);
const staafLast = doe("model3d.load.placePoint", { target: { kind: "beam", beamId: 1, t: 0.4 }, caseId: tweedeGeval });
check("op een staaf met t = 0,4 (staaf 1 is nu 2,5 m): staafpuntlast Pz = −10 kN op 1,0 m in geval 2",
  staafLast.kind === "memberPoint" && staafLast.load.beamId === 1 && dicht(staafLast.load.positionM, 1) && staafLast.load.pz === -10
  && staafLast.load.caseId === tweedeGeval, JSON.stringify(staafLast));
check("de staaf blijft heel", model().beams.length === 2);
const eigen = doe("model3d.load.placePoint", { target: { kind: "beam", beamId: tweede.id, positionM: 0.5 }, py: 4 });
check("eigen waarde Py = 4 kN, Pz 0", eigen.load.py === 4 && eigen.load.pz === 0 && eigen.load.positionM === 0.5);
check("Py bij een knoop, of Fz bij een staaf → INVOER_ONGELDIG",
  faalt("model3d.load.placePoint", { target: { kind: "node", nodeId: 2 }, py: 1 })?.code === "INVOER_ONGELDIG"
  && faalt("model3d.load.placePoint", { target: { kind: "beam", beamId: 1, t: 0.5 }, fz: -1 })?.code === "INVOER_ONGELDIG");
check("een plaat als doel past niet in het schema → INVOER_ONGELDIG",
  faalt("model3d.load.placePoint", { target: { kind: "plate", plateId: 1, x: 1, y: 3, z: 0 } })?.code === "INVOER_ONGELDIG");
check("buiten de staaf → GEWEIGERD", faalt("model3d.load.placePoint", { target: { kind: "beam", beamId: 1, positionM: 9 } })?.code === "GEWEIGERD");
check("onbekend geval → NIET_GEVONDEN", faalt("model3d.load.placePoint", { target: { kind: "node", nodeId: 2 }, caseId: 999 })?.code === "NIET_GEVONDEN");

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

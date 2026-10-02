// Zuivere 3D-functies voor knoop en staaf (openFem3dModel.ts), de basis van
// de API-commando's: toevoegen en wijzigen zonder het oude model te wijzigen,
// met Nederlandse weigeringen en een model dat daarna gewoon opent.
const {
  EMPTY_OPEN_FEM_3D, addOpenFem3DBeam, addOpenFem3DMemberLoad, addOpenFem3DNode, parseOpenFem3DModel,
  updateOpenFem3DBeam, updateOpenFem3DNode,
} = await import("./src/components/openFem3d/openFem3dModel.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const weigert = (fn, deel) => {
  try { fn(); return false; } catch (e) { return deel === undefined || String(e.message).includes(deel); }
};
const opent = (model) => { try { parseOpenFem3DModel(JSON.parse(JSON.stringify(model))); return true; } catch { return false; } };

console.log("[1] knoop toevoegen");
const leeg = { ...EMPTY_OPEN_FEM_3D };
const a = addOpenFem3DNode(leeg, { x: 0, y: 0, z: 0 });
check("eerste knoop krijgt id 1", a.node.id === 1 && a.model.nodes.length === 1 && leeg.nodes.length === 0);
const b = addOpenFem3DNode(a.model, { x: 6, y: 0, z: 0, name: "  B  " });
check("volgende id, naam bijgesneden", b.node.id === 2 && b.node.name === "B");
check("een knoop op de plek van een andere wordt geweigerd, met die knoop in de melding",
  weigert(() => addOpenFem3DNode(b.model, { x: 6, y: 0, z: 0.0000004 }), "knoop 2"));
check("een niet-eindige coördinaat wordt geweigerd", weigert(() => addOpenFem3DNode(b.model, { x: Number.NaN, y: 0, z: 0 })));
check("het model opent", opent(b.model));

console.log("\n[2] staaf toevoegen");
const s = addOpenFem3DBeam(b.model, { startNodeId: 1, endNodeId: 2 });
check("staaf 1 met de standaard van het tekengereedschap (S235, IPE 200)",
  s.beam.id === 1 && s.beam.material === "S235" && s.beam.profileName === "IPE 200" && s.model.beams.length === 1);
const s2model = addOpenFem3DNode(s.model, { x: 6, y: 0, z: 4 }).model;
const s2 = addOpenFem3DBeam(s2model, {
  startNodeId: 2, endNodeId: 3, profileName: "HEA 200", material: "S355", rollAngleRad: Math.PI / 2,
  releases: { myEnd: true }, tensionOnly: true, name: "K1", group: "kolom",
});
check("opgegeven velden; eindscharnieren aangevuld met false",
  s2.beam.profileName === "HEA 200" && s2.beam.material === "S355" && s2.beam.tensionOnly === true
    && s2.beam.releases.myEnd === true && s2.beam.releases.myStart === false && s2.beam.group === "kolom");
check("dezelfde begin- en eindknoop geweigerd", weigert(() => addOpenFem3DBeam(s2.model, { startNodeId: 1, endNodeId: 1 })));
check("een onbekende knoop geweigerd", weigert(() => addOpenFem3DBeam(s2.model, { startNodeId: 1, endNodeId: 9 }), "9"));
check("een bestaande verbinding (ook omgekeerd) geweigerd, met de staaf in de melding",
  weigert(() => addOpenFem3DBeam(s2.model, { startNodeId: 2, endNodeId: 1 }), "staaf 1"));
check("een niet-eindige rolhoek geweigerd", weigert(() => addOpenFem3DBeam(s2.model, { startNodeId: 1, endNodeId: 3, rollAngleRad: Infinity })));
check("het model opent", opent(s2.model));

console.log("\n[3] knoop wijzigen");
const metLast = addOpenFem3DMemberLoad(s2.model, 1, { qyStart: 0, qyEnd: 0, qzStart: -2, qzEnd: -2, startPositionM: 0, endPositionM: 6 });
const verplaatst = updateOpenFem3DNode(metLast, 2, { x: 7 });
const k2 = verplaatst.nodes.find((n) => n.id === 2);
check("alleen x verandert", k2.x === 7 && k2.y === 0 && k2.z === 0 && k2.name === "B");
check("staven en lasten blijven gekoppeld", verplaatst.beams.length === 2 && verplaatst.memberLoads.length === 1 && opent(verplaatst));
check("het oude model is ongewijzigd", metLast.nodes.find((n) => n.id === 2).x === 6);
check("naam wissen met null", updateOpenFem3DNode(metLast, 2, { name: null }).nodes.find((n) => n.id === 2).name === undefined);
check("een onbekende knoop geweigerd", weigert(() => updateOpenFem3DNode(metLast, 9, { x: 1 }), "9"));
check("verplaatsen op de plek van een andere knoop geweigerd", weigert(() => updateOpenFem3DNode(metLast, 3, { z: 0 }), "knoop 2"));
const opLevel = { ...metLast, nodes: metLast.nodes.map((n) => n.id === 3 ? { ...n, levelId: "L1" } : n) };
check("een knoop aan een level: z wijzigen geweigerd", weigert(() => updateOpenFem3DNode(opLevel, 3, { z: 5 }), "level"));
check("… x wijzigen mag", updateOpenFem3DNode(opLevel, 3, { x: 6.5 }).nodes.find((n) => n.id === 3).x === 6.5);

console.log("\n[4] staaf wijzigen");
const gewijzigd = updateOpenFem3DBeam(metLast, 1, { profileName: "IPE 300", material: "S355", rollAngleRad: 0.25 });
const st1 = gewijzigd.beams.find((x) => x.id === 1);
check("profiel, materiaal en rolhoek", st1.profileName === "IPE 300" && st1.material === "S355" && st1.rollAngleRad === 0.25);
check("de last op de staaf blijft", gewijzigd.memberLoads.length === 1 && gewijzigd.memberLoads[0].beamId === 1);
const gewist = updateOpenFem3DBeam(metLast, 2, { releases: null, tensionOnly: false, name: null, group: null });
const st2 = gewist.beams.find((x) => x.id === 2);
check("null en false wissen optionele velden", st2.releases === undefined && !("tensionOnly" in st2) && st2.name === undefined && st2.group === undefined,
  JSON.stringify(st2));
const omgehangen = updateOpenFem3DBeam(metLast, 1, { endNodeId: 3 });
check("eindknoop wijzigen", omgehangen.beams.find((x) => x.id === 1).endNodeId === 3 && opent(omgehangen));
check("omhangen naar een bestaande verbinding geweigerd", weigert(() => updateOpenFem3DBeam(metLast, 1, { startNodeId: 3, endNodeId: 2 }), "staaf 2"));
check("een onbekende staaf geweigerd", weigert(() => updateOpenFem3DBeam(metLast, 7, { material: "S235" }), "7"));
check("een leeg profiel geweigerd", weigert(() => updateOpenFem3DBeam(metLast, 1, { profileName: "  " })));

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

// Lijnlast in een globale richting via de API (issue #80): model3d.load.member.add
// en model3d.load.member.update nemen `globalDirection` (x, y of z), `qStart`,
// `qEnd` en `perProjection` naast de lokale qy/qz. Beide gebruiken dezelfde
// zuivere functies als het lastpaneel (addOpenFem3DMemberLoad,
// updateOpenFem3DMemberLoad), dus dezelfde keuring. Wijzigen kan van lokaal
// naar globaal (met qStart) en terug (globalDirection null, met qy/qz).
// Draait tegen de bron en, via de regressierunner, tegen de sidecarbundel.
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
const json = (waarde) => JSON.stringify(waarde);

console.log("[1] het schema");
const catalogus = new Map(register.catalogus().map((c) => [c.naam, c]));
for (const naam of ["model3d.load.member.add", "model3d.load.member.update"]) {
  const velden = catalogus.get(naam)?.invoer.properties ?? {};
  const richting = velden.globalDirection?.oneOf ? velden.globalDirection.oneOf.find((v) => v.type === "string") : velden.globalDirection;
  check(`${naam}: globalDirection kiest uit x, y, z`, json(richting?.enum) === json(["x", "y", "z"]), json(velden.globalDirection));
  check(`${naam}: qStart en qEnd getallen, perProjection ja/nee`,
    velden.qStart?.type === "number" && velden.qEnd?.type === "number" && velden.perProjection?.type === "boolean");
  check(`${naam}: het schema blijft strikt`, catalogus.get(naam).invoer.additionalProperties === false);
}
check("update: globalDirection null mag (weer lokaal)",
  catalogus.get("model3d.load.member.update").invoer.properties.globalDirection.oneOf?.some((v) => v.type === "null"));
check("add: globalDirection is niet verplicht (lokaal blijft de standaard)",
  !(catalogus.get("model3d.load.member.add").invoer.required ?? []).includes("globalDirection"));

console.log("\n[2] toevoegen");
// Schuine spant: 4 m horizontaal, 3 m omhoog (L = 5 m), en een kolom van 3 m.
for (const [x, y, z] of [[0, 0, 0], [4, 0, 3], [8, 0, 0], [8, 0, 3]]) doe("model3d.node.add", { x, y, z });
doe("model3d.beam.add", { startNodeId: 1, endNodeId: 2, profileName: "IPE 300" });
doe("model3d.beam.add", { startNodeId: 3, endNodeId: 4, profileName: "HEB 200" });
const sneeuw = doe("model3d.load.member.add", { beamId: 1, globalDirection: "z", qStart: -2, perProjection: true }).load;
check("globaal Z per projectie: qEnd = qStart en over de hele staaf",
  json(sneeuw) === json({ id: 1, beamId: 1, caseId: doc.activeLoadCaseId, globalDirection: "z", qStart: -2, qEnd: -2, perProjection: true, startPositionM: 0, endPositionM: 5 }),
  json(sneeuw));
const wind = doe("model3d.load.member.add", { beamId: 2, globalDirection: "x", qStart: 1, qEnd: 3, startPositionM: 0.5, endPositionM: 2.5 }).load;
check("globaal X per staafmeter, trapezium over een deel: geen perProjection en geen lokale velden",
  wind.globalDirection === "x" && wind.qStart === 1 && wind.qEnd === 3 && !("perProjection" in wind) && !("qyStart" in wind) && wind.endPositionM === 2.5,
  json(wind));
const lokaal = doe("model3d.load.member.add", { beamId: 1, qzStart: -5 }).load;
check("een lokale last werkt zoals voorheen", json(lokaal) === json({ id: 3, beamId: 1, caseId: doc.activeLoadCaseId, qyStart: 0, qyEnd: 0, qzStart: -5, qzEnd: -5, startPositionM: 0, endPositionM: 5 }),
  json(lokaal));

console.log("\n[3] weigeringen");
const tik = faalt("model3d.load.member.add", { beamId: 1, globalDirection: "Z", qStart: -2 });
check("richting Z (hoofdletter) → INVOER_ONGELDIG (schema)", tik?.code === "INVOER_ONGELDIG", tik?.message);
const gemengd = faalt("model3d.load.member.add", { beamId: 1, globalDirection: "z", qStart: -2, qzStart: -1 });
check("globaal met een lokale waarde → INVOER_ONGELDIG, met uitleg", gemengd?.code === "INVOER_ONGELDIG" && /qzStart/.test(gemengd.message), gemengd?.message);
const zonderRichting = faalt("model3d.load.member.add", { beamId: 1, qStart: -2 });
check("qStart zonder globalDirection → INVOER_ONGELDIG", zonderRichting?.code === "INVOER_ONGELDIG" && /globalDirection/.test(zonderRichting.message), zonderRichting?.message);
const projectieLokaal = faalt("model3d.load.member.add", { beamId: 1, qzStart: -2, perProjection: true });
check("perProjection bij een lokale last → INVOER_ONGELDIG", projectieLokaal?.code === "INVOER_ONGELDIG", projectieLokaal?.message);
const zonderQ = faalt("model3d.load.member.add", { beamId: 1, globalDirection: "y" });
check("globaal zonder qStart → INVOER_ONGELDIG", zonderQ?.code === "INVOER_ONGELDIG" && /qStart/.test(zonderQ.message), zonderQ?.message);
const nul = faalt("model3d.load.member.add", { beamId: 1, globalDirection: "y", qStart: 0 });
check("q = 0 → GEWEIGERD door de modelregel", nul?.code === "GEWEIGERD" && /niet-nulwaarde/.test(nul.message), nul?.message);
const buiten = faalt("model3d.load.member.add", { beamId: 1, globalDirection: "z", qStart: -1, endPositionM: 6 });
check("buiten de staaf → GEWEIGERD", buiten?.code === "GEWEIGERD" && /staaflengte/.test(buiten.message), buiten?.message);
check("na de weigeringen: drie lasten", model().memberLoads.length === 3);

console.log("\n[4] wijzigen");
check("alleen qEnd: richting, qStart en projectie blijven",
  json(doe("model3d.load.member.update", { id: 1, qEnd: -3 }).load) === json({ ...sneeuw, qEnd: -3 }));
check("projectie uit: het veld valt weg", !("perProjection" in doe("model3d.load.member.update", { id: 1, perProjection: false }).load));
check("andere richting: q blijft", json(doe("model3d.load.member.update", { id: 1, globalDirection: "y" }).load)
  === json({ id: 1, beamId: 1, caseId: doc.activeLoadCaseId, globalDirection: "y", qStart: -2, qEnd: -3, startPositionM: 0, endPositionM: 5 }));
const naarGlobaal = faalt("model3d.load.member.update", { id: 3, globalDirection: "z" });
check("lokaal → globaal zonder qStart → INVOER_ONGELDIG", naarGlobaal?.code === "INVOER_ONGELDIG" && /qStart/.test(naarGlobaal.message), naarGlobaal?.message);
check("lokaal → globaal met qStart (qEnd = qStart, het bereik blijft)",
  json(doe("model3d.load.member.update", { id: 3, globalDirection: "z", qStart: -4 }).load)
  === json({ id: 3, beamId: 1, caseId: doc.activeLoadCaseId, globalDirection: "z", qStart: -4, qEnd: -4, startPositionM: 0, endPositionM: 5 }));
const terugZonder = faalt("model3d.load.member.update", { id: 3, globalDirection: null, qStart: -1 });
check("terug naar lokaal met qStart → INVOER_ONGELDIG", terugZonder?.code === "INVOER_ONGELDIG", terugZonder?.message);
check("terug naar lokaal (null) met qz",
  json(doe("model3d.load.member.update", { id: 3, globalDirection: null, qzStart: -5 }).load)
  === json({ id: 3, beamId: 1, caseId: doc.activeLoadCaseId, qyStart: 0, qyEnd: 0, qzStart: -5, qzEnd: -5, startPositionM: 0, endPositionM: 5 }));
check("een lokale last wijzigen zoals voorheen (qzEnd)", doe("model3d.load.member.update", { id: 3, qzEnd: -8 }).load.qzStart === -5
  && model().memberLoads.find((l) => l.id === 3).qzEnd === -8);
const lokaalMetQ = faalt("model3d.load.member.update", { id: 3, qStart: 1 });
check("een lokale last met qStart → INVOER_ONGELDIG", lokaalMetQ?.code === "INVOER_ONGELDIG", lokaalMetQ?.message);
const globaalMetQy = faalt("model3d.load.member.update", { id: 2, qyEnd: 1 });
check("een globale last met qyEnd → INVOER_ONGELDIG", globaalMetQy?.code === "INVOER_ONGELDIG", globaalMetQy?.message);

console.log("\n[5] verwijderen");
doe("model3d.load.member.delete", { id: 2 });
check("de globale last is weg", !model().memberLoads.some((l) => l.id === 2) && model().memberLoads.length === 2);

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

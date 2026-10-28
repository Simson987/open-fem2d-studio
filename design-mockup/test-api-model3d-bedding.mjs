// Staaf op bedding via de API (issue #106): model3d.beam.add en
// model3d.beam.update nemen `bedding` (update: null haalt haar weg), en
// model3d.beam.setBedding zet of haalt haar op meer staven tegelijk. Alle drie
// gebruiken dezelfde zuivere functie als het eigenschappenpaneel
// (setOpenFem3DBeamBedding), dus dezelfde keuring: positief, geen tikfout in
// een veld, een verticale staaf alleen zijdelings. Draait tegen de bron en,
// via de regressierunner, tegen de sidecarbundel.
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
const model = () => model3dVan(doc);
const staaf = (id) => model().beams.find((beam) => beam.id === id);
const json = (waarde) => JSON.stringify(waarde);

console.log("[1] het schema");
const catalogus = new Map(register.catalogus().map((c) => [c.naam, c]));
const beddingSchema = (naam) => {
  const veld = catalogus.get(naam)?.invoer.properties.bedding;
  return veld?.oneOf ? veld.oneOf.find((v) => v.type === "object") : veld;
};
for (const naam of ["model3d.beam.add", "model3d.beam.update", "model3d.beam.setBedding"]) {
  const schema = beddingSchema(naam);
  check(`${naam}: bedding is een strikt object met widthM verplicht`, schema?.type === "object" && schema.additionalProperties === false
    && json(schema.required) === json(["widthM"]) && json(Object.keys(schema.properties)) === json(["kKnPerM3", "widthM", "kLateralKnPerM3", "compressionOnly"]),
  json(schema));
}
check("update en setBedding: null mag (weghalen)", ["model3d.beam.update", "model3d.beam.setBedding"].every((naam) =>
  catalogus.get(naam).invoer.properties.bedding.oneOf?.some((v) => v.type === "null")));
check("setBedding: beamIds en bedding verplicht", json(catalogus.get("model3d.beam.setBedding").invoer.required) === json(["beamIds", "bedding"]));

console.log("\n[2] toevoegen en wijzigen");
for (const [x, y, z] of [[0, 0, 0], [6, 0, 0], [12, 0, 0], [0, 0, -8]]) doe("model3d.node.add", { x, y, z });
const balk = doe("model3d.beam.add", { startNodeId: 1, endNodeId: 2, profileName: "HEB 300", bedding: { kKnPerM3: 50_000, widthM: 0.6, compressionOnly: true } }).beam;
check("add met bedding", json(balk.bedding) === json({ kKnPerM3: 50_000, widthM: 0.6, compressionOnly: true }) && json(staaf(1).bedding) === json(balk.bedding));
doe("model3d.beam.add", { startNodeId: 2, endNodeId: 3, profileName: "HEB 300" });
doe("model3d.beam.add", { startNodeId: 4, endNodeId: 1, profileName: "HEB 300" });
check("add zonder bedding: geen veld", !("bedding" in staaf(2)));
const gewijzigd = doe("model3d.beam.update", { id: 2, bedding: { kKnPerM3: 30_000, widthM: 0.4, kLateralKnPerM3: 10_000 } }).beam;
check("update zet de bedding", json(gewijzigd.bedding) === json({ kKnPerM3: 30_000, widthM: 0.4, kLateralKnPerM3: 10_000 }));
check("update met null haalt haar weg", !("bedding" in doe("model3d.beam.update", { id: 2, bedding: null }).beam) && !("bedding" in staaf(2)));
check("update zonder bedding laat haar staan", json(doe("model3d.beam.update", { id: 1, name: "Strook A" }).beam.bedding) === json(balk.bedding));
const paal = doe("model3d.beam.update", { id: 3, bedding: { widthM: 0.3, kLateralKnPerM3: 20_000 } }).beam;
check("een paal: alleen zijdelings", json(paal.bedding) === json({ widthM: 0.3, kLateralKnPerM3: 20_000 }));

console.log("\n[3] weigeringen");
const verticaal = faalt("model3d.beam.update", { id: 3, bedding: { kKnPerM3: 50_000, widthM: 0.3 } });
check("een verticale k op een paal → GEWEIGERD, met uitleg", verticaal?.code === "GEWEIGERD" && /verticaal/.test(verticaal.message), verticaal?.message);
const tik = faalt("model3d.beam.update", { id: 1, bedding: { kKnPerm3: 50_000, widthM: 0.6 } });
check("een tikfout in een veldnaam → INVOER_ONGELDIG", tik?.code === "INVOER_ONGELDIG", tik?.message);
check("k = 0 → INVOER_ONGELDIG", faalt("model3d.beam.update", { id: 1, bedding: { kKnPerM3: 0, widthM: 0.6 } })?.code === "INVOER_ONGELDIG");
check("zonder breedte → INVOER_ONGELDIG", faalt("model3d.beam.add", { startNodeId: 1, endNodeId: 3, bedding: { kKnPerM3: 1 } })?.code === "INVOER_ONGELDIG");
const geenK = faalt("model3d.beam.update", { id: 1, bedding: { widthM: 0.6 } });
check("zonder constante → GEWEIGERD", geenK?.code === "GEWEIGERD" && /beddingsconstante/.test(geenK.message), geenK?.message);
check("na de weigeringen is het model onveranderd", json(staaf(1).bedding) === json(balk.bedding) && json(staaf(3).bedding) === json(paal.bedding));

console.log("\n[4] meer staven tegelijk");
const voor = doc;
const samen = doe("model3d.beam.setBedding", { beamIds: [1, 2], bedding: { kKnPerM3: 40_000, widthM: 0.5 } });
check("twee staven in één opdracht", json(samen.beamIds) === json([1, 2])
  && [1, 2].every((id) => json(staaf(id).bedding) === json({ kKnPerM3: 40_000, widthM: 0.5 })), json(samen));
check("de uitkomst noemt de bedding per staaf", samen.bedding.length === 2 && samen.bedding[1].bedding.widthM === 0.5);
check("het vorige document is ongewijzigd (één stap)", json(model3dVan(voor).beams.find((b) => b.id === 1).bedding) === json(balk.bedding));
const gemengd = faalt("model3d.beam.setBedding", { beamIds: [1, 3], bedding: { kKnPerM3: 40_000, widthM: 0.5 } });
check("een selectie met de paal en een verticale k → GEWEIGERD, niets veranderd", gemengd?.code === "GEWEIGERD"
  && json(staaf(3).bedding) === json(paal.bedding), gemengd?.message);
const weg = doe("model3d.beam.setBedding", { beamIds: [1, 2, 3], bedding: null });
check("null haalt de bedding van alle genoemde staven weg", weg.bedding.every((item) => item.bedding === null)
  && model().beams.every((beam) => !("bedding" in beam)));
check("een onbekende staaf → NIET_GEVONDEN", faalt("model3d.beam.setBedding", { beamIds: [9], bedding: null })?.code === "NIET_GEVONDEN");

console.log("\n[5] geometrie wijzigen met een staaf op bedding (review #106)");
// Een staaf op een verticale k mag ook via model3d.transform en model3d.beam.update niet
// (bijna) verticaal komen te staan; met alleen een zijdelingse bedding wel.
doe("model3d.beam.setBedding", { beamIds: [1], bedding: { kKnPerM3: 50_000, widthM: 0.6 } });
const voorDraaien = doc;
const gedraaid = faalt("model3d.transform", { beamIds: [1], command: { kind: "rotate", axis: "y", angleDeg: 90 } });
check("model3d.transform: draaien naar verticaal met een verticale k → geweigerd, met uitleg",
  gedraaid !== null && /komt dan \(bijna\) verticaal/.test(gedraaid.message) && doc === voorDraaien, gedraaid?.message);
const omZ = doe("model3d.transform", { beamIds: [1], command: { kind: "rotate", axis: "z", angleDeg: 90 } });
check("model3d.transform: draaien om Z mag, de bedding blijft", omZ.selection.beamIds[0] === 1 && staaf(1).bedding.kKnPerM3 === 50_000, json(omZ));
doe("model3d.beam.setBedding", { beamIds: [1], bedding: { widthM: 0.6, kLateralKnPerM3: 20_000 } });
// De staaf ligt nu langs Y: draaien om X zet haar verticaal.
doe("model3d.transform", { beamIds: [1], command: { kind: "rotate", axis: "x", angleDeg: 90 } });
const knoop = (id) => model().nodes.find((n) => n.id === id);
const [a, b] = [knoop(staaf(1).startNodeId), knoop(staaf(1).endNodeId)];
check("met alleen een zijdelingse bedding: draaien naar verticaal mag", Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9
  && json(staaf(1).bedding) === json({ widthM: 0.6, kLateralKnPerM3: 20_000 }));
const verticaalK = faalt("model3d.beam.update", { id: 1, bedding: { kKnPerM3: 50_000, widthM: 0.6 } });
check("daarna een verticale k op die staaf → geweigerd", verticaalK?.code === "GEWEIGERD" && /verticaal/.test(verticaalK.message), verticaalK?.message);

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

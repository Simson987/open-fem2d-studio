// Plaat op bedding via de API (issue #107): model3d.plate.add en
// model3d.plate.update nemen `bedding` (update: null haalt haar weg), en
// model3d.plate.setBedding zet of haalt haar op meer platen tegelijk. Alle
// drie gebruiken dezelfde zuivere functies als het eigenschappenpaneel
// (setOpenFem3DPlateBedding en de keuring van het model): k positief en
// eindig, alleen druk true of false, geen tikfout in een veld. setBedding
// noemt per plaat de grondzijde (groundSide); bij een wand op bedding ligt die
// vast door de plaatassen (+Y voor een wand in het XZ-vlak, −X in het
// YZ-vlak) en waarschuwen alle drie (warnings), bij alleen druk met het advies
// om zonder alleen druk te rekenen. Draait tegen de bron en, via de
// regressierunner, tegen de sidecarbundel.
const { maakRegister } = await import("./src/api/register.ts");
const { leegDocument, model3dVan } = await import("./src/api/projectDocument.ts");
const { MODEL3D_GEOMETRIE_COMMANDOS } = await import("./src/api/commands/model3dGeometrie.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const register = maakRegister([...MODEL3D_GEOMETRIE_COMMANDOS]);
let doc = leegDocument();
const doe = (naam, invoer) => {
  const r = register.voerUit(naam, invoer, { document: doc });
  if (r.document) doc = r.document;
  return r.uitkomst;
};
const faalt = (naam, invoer) => { try { register.voerUit(naam, invoer, { document: doc }); return null; } catch (e) { return e; } };
const model = () => model3dVan(doc);
const plaat = (id) => (model().plates ?? []).find((item) => item.id === id);
const json = (waarde) => JSON.stringify(waarde);

console.log("[1] het schema");
const catalogus = new Map(register.catalogus().map((c) => [c.naam, c]));
const beddingSchema = (naam) => {
  const veld = catalogus.get(naam)?.invoer.properties.bedding;
  return veld?.oneOf ? veld.oneOf.find((v) => v.type === "object") : veld;
};
for (const naam of ["model3d.plate.add", "model3d.plate.update", "model3d.plate.setBedding"]) {
  const schema = beddingSchema(naam);
  check(`${naam}: bedding is een strikt object met kKnPerM3 verplicht`, schema?.type === "object" && schema.additionalProperties === false
    && json(schema.required) === json(["kKnPerM3"]) && json(Object.keys(schema.properties)) === json(["kKnPerM3", "compressionOnly"])
    && schema.properties.kKnPerM3.exclusiveMinimum === 0 && schema.properties.compressionOnly.type === "boolean",
  json(schema));
}
check("update en setBedding: null mag (weghalen)", ["model3d.plate.update", "model3d.plate.setBedding"].every((naam) =>
  catalogus.get(naam).invoer.properties.bedding.oneOf?.some((v) => v.type === "null")));
check("add: geen null (een nieuwe plaat heeft nog niets om weg te halen)", !catalogus.get("model3d.plate.add").invoer.properties.bedding.oneOf);
check("setBedding: plateIds en bedding verplicht", json(catalogus.get("model3d.plate.setBedding").invoer.required) === json(["plateIds", "bedding"]));

console.log("\n[2] toevoegen en wijzigen");
for (const [x, y, z] of [[0, 0, 0], [6, 0, 0], [6, 4, 0], [0, 4, 0], [12, 0, 0], [12, 4, 0]]) doe("model3d.node.add", { x, y, z });
const vloer = doe("model3d.plate.add", { nodeIds: [1, 2, 3, 4], thicknessM: 0.25, bedding: { kKnPerM3: 20_000, compressionOnly: true } }).plate;
check("add met bedding", json(vloer.bedding) === json({ kKnPerM3: 20_000, compressionOnly: true }) && json(plaat(1).bedding) === json(vloer.bedding));
doe("model3d.plate.add", { nodeIds: [2, 5, 6, 3], thicknessM: 0.25 });
check("add zonder bedding: geen veld", !("bedding" in plaat(2)));
const gewijzigd = doe("model3d.plate.update", { id: 2, bedding: { kKnPerM3: 30_000 } }).plate;
check("update zet de bedding", json(gewijzigd.bedding) === json({ kKnPerM3: 30_000 }));
check("update met compressionOnly false bewaart alleen k", json(doe("model3d.plate.update", { id: 2, bedding: { kKnPerM3: 30_000, compressionOnly: false } }).plate.bedding)
  === json({ kKnPerM3: 30_000 }));
check("update met null haalt haar weg", !("bedding" in doe("model3d.plate.update", { id: 2, bedding: null }).plate) && !("bedding" in plaat(2)));
check("update zonder bedding laat haar staan", json(doe("model3d.plate.update", { id: 1, thicknessM: 0.3 }).plate.bedding) === json(vloer.bedding));

console.log("\n[3] weigeringen");
const tik = faalt("model3d.plate.update", { id: 1, bedding: { kKnPerm3: 20_000 } });
check("een tikfout in een veldnaam → INVOER_ONGELDIG", tik?.code === "INVOER_ONGELDIG", tik?.message);
check("k = 0 → INVOER_ONGELDIG", faalt("model3d.plate.update", { id: 1, bedding: { kKnPerM3: 0 } })?.code === "INVOER_ONGELDIG");
check("zonder k → INVOER_ONGELDIG", faalt("model3d.plate.add", { nodeIds: [2, 5, 6, 3], thicknessM: 0.2, bedding: { compressionOnly: true } })?.code === "INVOER_ONGELDIG");
check("de breedte van een staafbedding → INVOER_ONGELDIG", faalt("model3d.plate.update", { id: 1, bedding: { kKnPerM3: 1, widthM: 1 } })?.code === "INVOER_ONGELDIG");
check("na de weigeringen is het model onveranderd", json(plaat(1).bedding) === json(vloer.bedding) && !("bedding" in plaat(2)));
check("een onbekende plaat → NIET_GEVONDEN", faalt("model3d.plate.update", { id: 9, bedding: null })?.code === "NIET_GEVONDEN");

console.log("\n[4] meer platen tegelijk");
const voor = doc;
const samen = doe("model3d.plate.setBedding", { plateIds: [1, 2, 2], bedding: { kKnPerM3: 40_000 } });
check("twee platen in één opdracht (dubbele id één keer)", json(samen.plateIds) === json([1, 2])
  && [1, 2].every((id) => json(plaat(id).bedding) === json({ kKnPerM3: 40_000 })), json(samen));
check("de uitkomst noemt de bedding per plaat", samen.bedding.length === 2 && samen.bedding[1].bedding.kKnPerM3 === 40_000);
check("het vorige document is ongewijzigd (één stap)", json((model3dVan(voor).plates ?? []).find((p) => p.id === 1).bedding) === json(vloer.bedding));
const weg = doe("model3d.plate.setBedding", { plateIds: [1, 2], bedding: null });
check("null haalt de bedding van alle genoemde platen weg", weg.bedding.every((item) => item.bedding === null)
  && model().plates.every((p) => !("bedding" in p)));
check("een onbekende plaat → NIET_GEVONDEN, niets veranderd", faalt("model3d.plate.setBedding", { plateIds: [1, 9], bedding: { kKnPerM3: 1 } })?.code === "NIET_GEVONDEN"
  && model().plates.every((p) => !("bedding" in p)));
check("een lege lijst → INVOER_ONGELDIG", faalt("model3d.plate.setBedding", { plateIds: [], bedding: null })?.code === "INVOER_ONGELDIG");

console.log("\n[5] wanden op bedding: de grondzijde ligt vast");
for (const [x, y, z] of [[0, 4, 3], [6, 4, 3], [12, 4, 3], [12, 0, 3]]) doe("model3d.node.add", { x, y, z });
const wandXZ = doe("model3d.plate.add", { nodeIds: [4, 3, 8, 7], thicknessM: 0.2, bedding: { kKnPerM3: 20_000 } });
check("add: een wand op bedding geeft een waarschuwing met de grondzijde +Y",
  wandXZ.warnings?.length === 1 && /3D-plaat 3 staat verticaal/.test(wandXZ.warnings[0]) && /aan de \+Y-zijde/.test(wandXZ.warnings[0])
  && /niet te kiezen/.test(wandXZ.warnings[0]) && !/zonder alleen druk/.test(wandXZ.warnings[0]), json(wandXZ.warnings));
const wandYZ = doe("model3d.plate.add", { nodeIds: [5, 6, 9, 10], thicknessM: 0.2 });
check("add: een wand zonder bedding geeft geen waarschuwing", !("warnings" in wandYZ));
const metDruk = doe("model3d.plate.update", { id: 4, bedding: { kKnPerM3: 20_000, compressionOnly: true } });
check("update: alleen druk op een wand in het YZ-vlak: grondzijde −X en het advies zonder alleen druk",
  metDruk.warnings?.length === 1 && /aan de −X-zijde/.test(metDruk.warnings[0]) && /zonder alleen druk/.test(metDruk.warnings[0]), json(metDruk.warnings));
const zijden = doe("model3d.plate.setBedding", { plateIds: [1, 3, 4], bedding: { kKnPerM3: 30_000 } });
check("setBedding: de grondzijde per plaat (vloer −Z, wanden +Y en −X)",
  json(zijden.bedding.map((item) => item.groundSide)) === json(["−Z", "+Y", "−X"]), json(zijden.bedding));
check("setBedding: een waarschuwing per wand, niet voor de vloer", zijden.warnings?.length === 2
  && /3D-plaat 3/.test(zijden.warnings[0]) && /3D-plaat 4/.test(zijden.warnings[1]), json(zijden.warnings));
const vloerAlleen = doe("model3d.plate.setBedding", { plateIds: [1], bedding: { kKnPerM3: 30_000 } });
check("setBedding op een vloer: geen waarschuwing", !("warnings" in vloerAlleen) && vloerAlleen.bedding[0].groundSide === "−Z");
const wandenWeg = doe("model3d.plate.setBedding", { plateIds: [3, 4], bedding: null });
check("zonder bedding: geen grondzijde en geen waarschuwing", wandenWeg.bedding.every((item) => item.groundSide === null) && !("warnings" in wandenWeg));

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

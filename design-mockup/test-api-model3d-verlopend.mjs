// Verlopende 3D-staaf via de API (issue #73): model3d.beam.add en
// model3d.beam.update nemen `profileNameEnd` (update: null maakt de staaf
// prismatisch), met dezelfde keuring als het eigenschappenpaneel en de
// profielkiezer (`bepaalVerloop`, de reden ongewijzigd). Splitsen van een
// verlopende stalen staaf laat een gelaste tussendoorsnede achter; het
// document draagt die mee (`eigenDoorsneden`), zodat het ook zonder app en na
// opslaan en openen te rekenen is. Draait tegen de bron en, via de
// regressierunner, tegen de sidecarbundel.
const { maakRegister } = await import("./src/api/register.ts");
const { documentNaarTekst, documentUitTekst, leegDocument, model3dVan } = await import("./src/api/projectDocument.ts");
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
const staaf = (id) => model().beams.find((beam) => beam.id === id);
const json = (waarde) => JSON.stringify(waarde);

console.log("[1] het schema");
const catalogus = new Map(register.catalogus().map((c) => [c.naam, c]));
const add = catalogus.get("model3d.beam.add").invoer.properties.profileNameEnd;
check("beam.add: profileNameEnd is tekst (niet leeg)", add?.type === "string" && add.minLength === 1, json(add));
check("beam.add: de beschrijving noemt de regels van een verloop", /rechthoek/.test(add?.description ?? "") && /I\/H-profiel/.test(add?.description ?? ""));
const upd = catalogus.get("model3d.beam.update").invoer.properties.profileNameEnd;
check("beam.update: profileNameEnd of null (prismatisch maken)",
  upd?.oneOf?.some((v) => v.type === "string") && upd.oneOf.some((v) => v.type === "null"), json(upd));

console.log("\n[2] toevoegen en wijzigen");
for (const [x, y, z] of [[0, 0, 0], [8, 0, 0], [16, 0, 0]]) doe("model3d.node.add", { x, y, z });
const ligger = doe("model3d.beam.add", { startNodeId: 1, endNodeId: 2, profileName: "IPE 500", profileNameEnd: "IPE 300", material: "S235" }).beam;
check("add met eindprofiel", ligger.profileNameEnd === "IPE 300" && staaf(1).profileNameEnd === "IPE 300");
doe("model3d.beam.add", { startNodeId: 2, endNodeId: 3, profileName: "IPE 300" });
check("add zonder eindprofiel: geen veld", !("profileNameEnd" in staaf(2)));
check("update zet het eindprofiel", doe("model3d.beam.update", { id: 2, profileNameEnd: "IPE 400" }).beam.profileNameEnd === "IPE 400");
check("update met null maakt prismatisch", !("profileNameEnd" in doe("model3d.beam.update", { id: 2, profileNameEnd: null }).beam));
check("update zonder eindprofiel laat het staan", doe("model3d.beam.update", { id: 1, name: "Spant" }).beam.profileNameEnd === "IPE 300");
check("eind gelijk aan begin: prismatisch", !("profileNameEnd" in doe("model3d.beam.update", { id: 2, profileNameEnd: "IPE 300" }).beam));

console.log("\n[3] weigeringen met de reden van bepaalVerloop");
const buis = faalt("model3d.beam.add", { startNodeId: 1, endNodeId: 3, profileName: "IPE 300", profileNameEnd: "CHS 88.9x4", material: "S235" });
check("een buis als eind wordt geweigerd", /niet ondersteund/.test(buis?.message ?? ""), buis?.message);
const begin = faalt("model3d.beam.update", { id: 1, profileName: "SHS 100x100x5" });
check("een begin dat niet meer bij het eind past: geweigerd (niet stil prismatisch)", /3D-staaf 1:/.test(begin?.message ?? ""), begin?.message);
check("het model is na een weigering onveranderd", staaf(1).profileName === "IPE 500" && staaf(1).profileNameEnd === "IPE 300");
const leeg = faalt("model3d.beam.add", { startNodeId: 1, endNodeId: 3, profileName: "IPE 300", profileNameEnd: "" });
check("een leeg eindprofiel weigert het schema", /profileNameEnd/.test(leeg?.message ?? ""), leeg?.message);

console.log("\n[4] splitsen: de tussendoorsnede reist met het document mee");
check("zonder tussendoorsnede draagt het document geen eigen doorsneden", doc.eigenDoorsneden === undefined);
const knip = doe("model3d.beam.split", { id: 1, fraction: 0.25 });
const eerste = staaf(1);
check("deel 1 eindigt met een gelaste tussendoorsnede", /^EIGEN:Gelast I /.test(eerste.profileNameEnd ?? ""), eerste.profileNameEnd);
check("deel 2 begint ermee en eindigt op IPE 300",
  model().beams.some((b) => b.profileName === eerste.profileNameEnd && b.profileNameEnd === "IPE 300"));
const naam = eerste.profileNameEnd.slice("EIGEN:".length);
check("het document draagt de tussendoorsnede", doc.eigenDoorsneden?.length === 1 && doc.eigenDoorsneden[0].naam === naam,
  json(doc.eigenDoorsneden?.map((d) => d.naam)));
const terug = documentUitTekst(documentNaarTekst(doc));
check("na opslaan en openen staat ze er nog", terug.eigenDoorsneden?.[0]?.naam === naam);
check("…en ook het verloop van beide delen", terug.model3d.beams.filter((b) => b.profileNameEnd).length === 2);
check("het bestand heeft versie 6", JSON.parse(documentNaarTekst(doc)).version === 6);
void knip;

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
if (gefaald > 0) process.exit(1);

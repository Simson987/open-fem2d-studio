// #230: een onbekend 3D-profiel of -materiaal wordt al bij model3d.beam.add en
// model3d.beam.update geweigerd, met staafnummer, de onbekende naam en
// bekende namen als suggestie — niet pas bij Berekenen in de app.
//
// Model uit het issue: staaf 5 m langs x, knopen (0,0,0) en (5,0,0);
// "IPE 9999" in "S999" (beide onbekend) en "IPE 9999" in S235 (profiel
// onbekend). De weigering is dezelfde regel als Berekenen (`resolveSection`,
// openFem3dSolver: "profiel "IPE 9999" hoort niet bij materiaal "S235"").
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

doe("model3d.node.add", { x: 0, y: 0, z: 0 });
doe("model3d.node.add", { x: 5, y: 0, z: 0 });

console.log("[1] model3d.beam.add");
{
  const f = faalt("model3d.beam.add", { startNodeId: 1, endNodeId: 2, profileName: "IPE 9999", material: "S999" });
  check("IPE 9999 / S999 → INVOER_ONGELDIG", f?.code === "INVOER_ONGELDIG", f?.message);
  check("… met staafnummer en de onbekende naam", /3D-staaf 1/.test(f?.message ?? "") && f?.message.includes("S999"), f?.message);
  check("… en bekende materialen als suggestie", f?.message.includes("S235") && f?.message.includes("S355"), f?.message);
  check("… en de staaf is NIET opgeslagen", model().beams.length === 0);

  const g = faalt("model3d.beam.add", { startNodeId: 1, endNodeId: 2, profileName: "IPE 9999", material: "S235" });
  check("IPE 9999 / S235 → INVOER_ONGELDIG", g?.code === "INVOER_ONGELDIG", g?.message);
  check("… zelfde reden als Berekenen: hoort niet bij materiaal",
    g?.message.includes('profiel "IPE 9999" hoort niet bij materiaal "S235"'), g?.message);
  check("… met bekende IPE-profielen als suggestie", /IPE600|IPE550/.test(g?.message ?? ""), g?.message);
  check("… detail noemt staaf, profiel en materiaal",
    g?.detail?.beamId === 1 && g?.detail?.profileName === "IPE 9999" && g?.detail?.material === "S235",
    JSON.stringify(g?.detail));
  check("… en geen staaf opgeslagen", model().beams.length === 0);

  const h = faalt("model3d.beam.add", { startNodeId: 1, endNodeId: 2, profileName: "IPE 300", material: "C24" });
  check("staalprofiel in hout (IPE 300 / C24) → INVOER_ONGELDIG", h?.code === "INVOER_ONGELDIG", h?.message);

  const goed = doe("model3d.beam.add", { startNodeId: 1, endNodeId: 2, profileName: "IPE 300", material: "S235" }).beam;
  check("IPE 300 / S235 wordt gewoon opgeslagen", goed?.id === 1 && model().beams.length === 1);
}

console.log("\n[2] model3d.beam.update");
{
  const f = faalt("model3d.beam.update", { id: 1, profileName: "IPE 9999" });
  check("naar IPE 9999 → INVOER_ONGELDIG", f?.code === "INVOER_ONGELDIG", f?.message);
  check("… en de staaf houdt IPE 300", model().beams[0].profileName === "IPE 300");
  const g = faalt("model3d.beam.update", { id: 1, material: "S999" });
  check("naar S999 → INVOER_ONGELDIG", g?.code === "INVOER_ONGELDIG", g?.message);
  check("… en de staaf houdt S235", model().beams[0].material === "S235");
  doe("model3d.beam.update", { id: 1, profileName: "HEA 200", material: "S355" });
  check("HEA 200 / S355 wordt geaccepteerd",
    model().beams[0].profileName === "HEA 200" && model().beams[0].material === "S355");
  doe("model3d.beam.update", { id: 1, profileName: "100x200", material: "C24" });
  check("hout 100x200 / C24 wordt geaccepteerd", model().beams[0].material === "C24");
}

console.log("\n[3] model3d.get meldt een onbekende doorsnede in een geopend project");
{
  // Een projectbestand dat buiten de API om (met de hand, of door een oudere
  // versie) een staaf IPE 9999 in S999 kreeg: zoals bij het openen in de app.
  const { metModel3d } = await import("./src/api/projectDocument.ts");
  const m = model();
  check("zonder onbekende staaf geen veld onbekendeDoorsneden", doe("model3d.get", {}).onbekendeDoorsneden === undefined);
  doc = metModel3d(doc, { ...m, beams: [...m.beams, { ...m.beams[0], id: 2, profileName: "IPE 9999", material: "S999" }] });
  const u = doe("model3d.get", {});
  check("model3d.get noemt staaf 2 met profiel, materiaal en reden",
    u.onbekendeDoorsneden?.length === 1 && u.onbekendeDoorsneden[0].beamId === 2 &&
    u.onbekendeDoorsneden[0].profileName === "IPE 9999" && u.onbekendeDoorsneden[0].material === "S999" &&
    /S999/.test(u.onbekendeDoorsneden[0].reden), JSON.stringify(u.onbekendeDoorsneden));
  const bron = (await import("node:fs")).readFileSync(new URL("./src/App.tsx", import.meta.url), "utf8");
  // Het openen in de app (App.pasProjectToe) gebruikt dezelfde keuring
  // (onbekendeOpenFem3DDoorsneden) als model3d.get hierboven.
  check("App.pasProjectToe meldt onbekende 3D-doorsneden bij het openen",
    /onbekendeOpenFem3DDoorsneden\(parsed\.model3d/.test(bron) && bron.includes("common:app.file.unknownSections3dBody"));
}

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

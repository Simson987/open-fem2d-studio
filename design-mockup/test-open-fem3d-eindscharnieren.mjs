// De standaardsituaties voor de eindscharnieren van een 3D-staaf: de knoppen
// Momentvast en Scharnierend in het eigenschappenpaneel en het API-commando
// model3d.beam.setReleasePreset roepen dezelfde functie aan.
//   [1] de twee situaties;
//   [2] herkennen welke situatie een staaf heeft (voor de actieve knop);
//   [3] toepassen op één of meer staven, de rest blijft ongemoeid.
const {
  OPEN_FEM_3D_RELEASE_PRESETS, openFem3DReleasePresetOf, setOpenFem3DReleasePreset, parseOpenFem3DModel,
} = await import("./src/components/openFem3d/openFem3dModel.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};

console.log("[1] de situaties");
const alle = (r) => [r.myStart, r.myEnd, r.mzStart, r.mzEnd, r.torsionStart, r.torsionEnd].join();
check("momentvast: niets losgelaten", alle(OPEN_FEM_3D_RELEASE_PRESETS.rigid) === "false,false,false,false,false,false");
check("scharnierend: My en Mz aan beide einden los, torsie gaat over",
  alle(OPEN_FEM_3D_RELEASE_PRESETS.pinned) === "true,true,true,true,false,false");

console.log("\n[2] herkennen");
check("zonder scharnieren is de staaf momentvast", openFem3DReleasePresetOf(undefined) === "rigid");
check("alles uit is momentvast", openFem3DReleasePresetOf({ ...OPEN_FEM_3D_RELEASE_PRESETS.rigid }) === "rigid");
check("My en Mz aan beide einden is scharnierend", openFem3DReleasePresetOf({ ...OPEN_FEM_3D_RELEASE_PRESETS.pinned }) === "pinned");
check("alleen het begin los is geen van beide",
  openFem3DReleasePresetOf({ ...OPEN_FEM_3D_RELEASE_PRESETS.rigid, myStart: true, mzStart: true }) === null);
check("scharnierend met torsie los is geen van beide",
  openFem3DReleasePresetOf({ ...OPEN_FEM_3D_RELEASE_PRESETS.pinned, torsionStart: true }) === null);

console.log("\n[3] toepassen");
const model = parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 12, y: 0, z: 0 }, { id: 4, x: 18, y: 0, z: 0 }],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 300", material: "S235" },
    { id: 2, startNodeId: 2, endNodeId: 3, profileName: "IPE 300", material: "S235",
      releases: { myStart: true, myEnd: false, mzStart: false, mzEnd: false, torsionStart: true, torsionEnd: false } },
    { id: 3, startNodeId: 3, endNodeId: 4, profileName: "IPE 300", material: "S235",
      releases: { myStart: false, myEnd: true, mzStart: false, mzEnd: false, torsionStart: false, torsionEnd: false } },
  ],
});
const voor = JSON.stringify(model);
const scharnierend = setOpenFem3DReleasePreset(model, [1, 2], "pinned");
check("staaf 1 en 2 scharnierend", openFem3DReleasePresetOf(scharnierend.beams[0].releases) === "pinned"
  && openFem3DReleasePresetOf(scharnierend.beams[1].releases) === "pinned");
check("de torsie die los stond, gaat weer over", scharnierend.beams[1].releases.torsionStart === false);
check("staaf 3 blijft zoals hij was", JSON.stringify(scharnierend.beams[2]) === JSON.stringify(model.beams[2]));
check("het oorspronkelijke model is niet veranderd", JSON.stringify(model) === voor);
check("de scharnieren zijn een eigen kopie per staaf",
  scharnierend.beams[0].releases !== scharnierend.beams[1].releases
  && scharnierend.beams[0].releases !== OPEN_FEM_3D_RELEASE_PRESETS.pinned);
const vast = setOpenFem3DReleasePreset(scharnierend, [2, 3], "rigid");
check("momentvast haalt het veld weg, zoals een staaf zonder scharnieren",
  !("releases" in vast.beams[1]) && !("releases" in vast.beams[2]));
check("momentvast laat staaf 1 scharnierend", openFem3DReleasePresetOf(vast.beams[0].releases) === "pinned");
check("dubbele ids zijn geen probleem", openFem3DReleasePresetOf(setOpenFem3DReleasePreset(model, [3, 3], "pinned").beams[2].releases) === "pinned");
let fout = null;
try { setOpenFem3DReleasePreset(model, [1, 9], "pinned"); } catch (e) { fout = e; }
check("een onbekende staaf wordt geweigerd en noemt de staaf", fout?.message.includes("9"), fout?.message);

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

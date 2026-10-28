// Verlopende profielen in 3D (issue #73), de app-kant:
//  1. het model: `profileNameEnd` lezen en keuren met de 2D-regels
//     (`bepaalVerloop`); oude bestanden blijven byte-gelijk; toevoegen,
//     wijzigen en weghalen; een eindprofiel dat niet (meer) bij het begin past
//     wordt met de reden geweigerd;
//  2. het projectbestand: versie 6 alleen voor een bestand met een verlopende
//     staaf (een oudere uitgave zou haar stil prismatisch maken), heen en terug;
//  3. het rekenverzoek: per verlopende staaf n gelijke delen met elk de
//     doorsnede van hun midden (`partSectionIds`), n en A/I per deel gelijk aan
//     2D (`segmentenVoorVerloop`, `splitsVerlopendProfiel`), I_z en I_t uit de
//     bestaande doorsnedemodules; een prismatische staaf houdt een byte-gelijk
//     verzoek; hout; een korte staaf; een ongeldig verloop wordt geweigerd;
//  4. het eigen gewicht per deel (lijnlasten op de deelgrenzen, de axiale
//     component als knooplasten met de lineaire vormfuncties; een trek-alleen
//     staaf het halve gewicht Σ ρ·g·A_i·L/n op elk einde) en het staalgewicht
//     met de gemiddelde massa;
//  5. invoer zonder verlies: de profielkeuze (kiezer) bewaart het eindprofiel,
//     2D → 3D neemt het mee, splitsen geeft het tussenprofiel op de knip,
//     samenvoegen weigert dubbele staven met een ander verloop; de
//     modelcontrole (proefknip) bewaart geen tussendoorsnede, Aansluiten wel;
//  6. de staaltoetsinvoer geeft `profile_end` door zoals in 2D; de
//     profielkleuring noemt het verloop; de profielweergave tekent twee ringen
//     (ook de vervormde vorm verloopt); de IFC-export noemt het verloop;
//  7. de veldzakking (BGT, vervormde vorm) met I per deel;
//  8. de wizard Stalen hal: verlopende kolom (voet → kop) en spantligger
//     (goot → midden) zonder sprong, gelaste tussendoorsneden in het
//     projectbestand, weigeringen met reden;
//  9. het bedieningskanaal (model_3d_bouwen): `profile_name_end` wordt
//     `profileNameEnd`, een ongeldig verloop wordt met de reden geweigerd;
// 10. Opslaan: de gelaste tussendoorsneden van de 3D-staven (begin- en
//     eindprofiel) gaan mee in het projectbestand, alleen in een 3D-project
//     (`gebruikteEigenDoorsneden`, dezelfde regel voor App en API); de wizard
//     Stalen hal zet zijn tussendoorsneden in de bibliotheek (App.tsx);
// 11. de echte 3D-kern (OPEN_FEM_3D_SOLVER_PATH of de debugbouw): een
//     verlopende uitkrager tegen de som over dezelfde delen als 2D. Zonder
//     kern, of met een oude bouw die `partSectionIds` niet kent, faalt dit
//     deel (bouw de kern met `cargo build -p open-fem-3d`).
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function load(url, ctx, next) {" +
        " if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };" +
        " return next(url, ctx); }",
    ),
);

const {
  addOpenFem3DBeam, applyOpenFem3DProfileChoice, parseOpenFem3DModel, splitOpenFem3DBeam, updateOpenFem3DBeam,
  withOpenFem3DSelfWeight,
} = await import("./src/components/openFem3d/openFem3dModel.ts");
const { openFem3DProfielTekst, openFem3DVerloopDelen, rechthoekTorsieconstante } = await import("./src/components/openFem3d/openFem3dVerloop.ts");
const { buildOpenFem3DSolveRequest } = await import("./src/components/openFem3d/openFem3dSolver.ts");
const { buildOpenFem3DTimberCheckInputs } = await import("./src/components/openFem3d/openFem3dTimberCheck.ts");
const { openFem3DStaalgewicht } = await import("./src/components/openFem3d/openFem3dStaalgewicht.ts");
const { convert2DTo3D } = await import("./src/components/openFem3d/convert2DTo3D.ts");
const { mergeOpenFem3DNodes } = await import("./src/components/openFem3d/openFem3dSamenvoegen.ts");
const {
  connectOpenFem3DNodesToBeams, openFem3DConnectCheck,
} = await import("./src/components/openFem3d/openFem3dAansluiten.ts");
const { gebruikteEigenDoorsneden } = await import("./src/api/projectDocument.ts");
const { buildOpenFem3DSteelCheckInputs } = await import("./src/components/openFem3d/openFem3dSteelCheck.ts");
const { openFem3DProfielKleuring } = await import("./src/lib/profielKleur.ts");
const {
  createOpenFem3DBeamProfileGeometry, openFem3DBeamProfileKey, openFem3DBeamSweepSections,
} = await import("./src/components/openFem3d/openFem3dProfileGeometry.ts");
const { createOpenFem3DSweptProfileGeometry } = await import("./src/components/openFem3d/openFem3dDeformedSweep.ts");
const THREE = await import("three");
const {
  PROJECT_FORMAT_VERSION_3D, PROJECT_FORMAT_VERSION_3D_BEDDING, PROJECT_FORMAT_VERSION_3D_TAPERED,
  PROJECT_FORMAT_VERSION_MAX, deserializeProject, serializeProject,
} = await import("./src/io/projectFile.ts");
const { bouwIfcRekenmodel, verzamelIfcBeperkingen } = await import("./src/io/ifcExport.ts");
const {
  bepaalVerloop, dichtheidVanMateriaal, doorsnedeOpPositie, G, resolveSection,
} = await import("./src/lib/sectionResolver.ts");
const { segmentenVoorVerloop, aantalVerloopSegmenten } = await import("./src/lib/modelNaarSolverInput.ts");
const { tussenProfielVoorSplitsing, gelasteIEigenschappen } = await import("./src/lib/verloopSplitsen.ts");
const { eigenDoorsnedenStore, zoekEigenDoorsnede } = await import("./src/lib/profieleditor/eigenDoorsnedenStore.ts");
const { openFem3DMemberDisplacementStations } = await import("./src/components/openFem3d/openFem3dDisplacement.ts");
const {
  maakStaalhal, probeerStaalhal, staalhalProfielUitKeuze, staalhalProject,
} = await import("./src/components/openFem3d/wizards/staalhal.ts");
const { opStaalhalMaken } = await import("./src/mcp/staalhalSidecar.ts");

let geslaagd = 0;
const ok = (waar, naam) => { assert.ok(waar, naam); geslaagd++; console.log(`  ✓ ${naam}`); };
const gelijk = (werkelijk, verwacht, naam, relatief = 1e-9, absoluut = 1e-12) => {
  const verschil = Math.abs(werkelijk - verwacht);
  assert.ok(verschil <= Math.max(absoluut, Math.abs(verwacht) * relatief),
    `${naam}: berekend ${werkelijk}, verwacht ${verwacht} (verschil ${verschil})`);
  geslaagd++;
  console.log(`  ✓ ${naam}`);
};
const weigert = (f, patroon, naam) => { assert.throws(f, patroon, naam); geslaagd++; console.log(`  ✓ ${naam}`); };
const json = (waarde) => JSON.stringify(waarde);

/**
 * Een spant: twee kolommen van 6 m en een ligger van 8 m. Staaf 3 (ligger)
 * verloopt naar wens; staaf 1 en 2 blijven prismatisch.
 */
const spant = (ligger = {}, extra = {}) => ({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 6 }, { id: 3, x: 8, y: 0, z: 6 }, { id: 4, x: 8, y: 0, z: 0 },
  ],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA 300", material: "S235" },
    { id: 2, startNodeId: 4, endNodeId: 3, profileName: "HEA 300", material: "S235" },
    { id: 3, startNodeId: 2, endNodeId: 3, profileName: "IPE 500", material: "S235", ...ligger },
  ],
  supports: [
    { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
    { nodeId: 4, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
  ],
  loads: [{ id: 1, nodeId: 2, fx: 5, fy: 0, fz: -20, mx: 0, my: 0, mz: 0 }],
  memberLoads: [{ id: 1, beamId: 3, qyStart: 0, qyEnd: 0, qzStart: -10, qzEnd: -10, startPositionM: 0, endPositionM: 8 }],
  ...extra,
});
const VERLOOP = { profileNameEnd: "IPE 300" };

console.log("[1] het model: lezen, keuren, toevoegen en wijzigen");
{
  const oud = parseOpenFem3DModel(spant());
  ok(oud.beams.every((beam) => !("profileNameEnd" in beam)), "een bestand zonder eindprofiel: geen veld");
  ok(json(parseOpenFem3DModel(JSON.parse(json(oud)))) === json(oud), "zonder eindprofiel verandert heen en terug niets");
  const model = parseOpenFem3DModel(spant(VERLOOP));
  ok(model.beams[2].profileNameEnd === "IPE 300", "het eindprofiel blijft staan");
  ok(json(Object.keys(model.beams[2])) === json(["id", "startNodeId", "endNodeId", "profileName", "profileNameEnd", "material"]),
    "het eindprofiel staat direct na het beginprofiel");
  ok(json(parseOpenFem3DModel(JSON.parse(json(model)))) === json(model), "met eindprofiel verandert heen en terug niets");
  ok(parseOpenFem3DModel(spant({ profileNameEnd: "  IPE 300 " })).beams[2].profileNameEnd === "IPE 300", "spaties eromheen vallen weg");
  ok(!("profileNameEnd" in parseOpenFem3DModel(spant({ profileNameEnd: "" })).beams[2]), "een leeg eindprofiel: prismatisch, geen veld");
  ok(!("profileNameEnd" in parseOpenFem3DModel(spant({ profileNameEnd: null })).beams[2]), "null: prismatisch, geen veld");
  ok(!("profileNameEnd" in parseOpenFem3DModel(spant({ profileNameEnd: "IPE 500" })).beams[2]), "hetzelfde profiel: prismatisch, geen veld");
  weigert(() => parseOpenFem3DModel(spant({ profileNameEnd: 300 })), /3D-staaf 3 heeft een ongeldig eindprofiel/, "een getal als eindprofiel wordt geweigerd");
  // Een eindprofiel dat niet bij het begin past, maakt een bestand niet onleesbaar
  // (de eigen doorsnede van een gesplitste staaf kan nog moeten laden); het rekenen
  // en de toetsing weigeren de staaf met de reden van bepaalVerloop.
  const scheef = parseOpenFem3DModel(spant({ profileNameEnd: "SHS 100x100x5" }));
  ok(scheef.beams[2].profileNameEnd === "SHS 100x100x5", "een ongeldig verloop in een bestand blijft zichtbaar staan");
  weigert(() => buildOpenFem3DSolveRequest(scheef, "linear"), /Staaf 3: verlopend profiel wordt voor deze doorsnede niet ondersteund \(koker/,
    "het rekenen weigert een ongeldig verloop met de reden van bepaalVerloop");

  // Toevoegen en wijzigen
  const basis = parseOpenFem3DModel(spant());
  const { model: met, beam } = addOpenFem3DBeam(basis, { startNodeId: 1, endNodeId: 3, profileName: "HEA 400", profileNameEnd: "HEA 200", material: "S355" });
  ok(beam.profileNameEnd === "HEA 200" && met.beams.at(-1).profileNameEnd === "HEA 200", "toevoegen met eindprofiel");
  weigert(() => addOpenFem3DBeam(basis, { startNodeId: 1, endNodeId: 3, profileName: "HEA 400", profileNameEnd: "CHS 88.9x4", material: "S355" }),
    /3D-staaf 4: verlopend profiel wordt voor deze doorsnede niet ondersteund \(buis "CHS 88.9x4"\)/, "toevoegen met een buis als eind wordt geweigerd met de reden");
  weigert(() => addOpenFem3DBeam(basis, { startNodeId: 1, endNodeId: 3, profileName: "200x600", profileNameEnd: "IPE 300", material: "GL24h" }),
    /3D-staaf 4: eindprofiel "IPE 300" is geen rechthoek/, "hout naar staal wordt geweigerd");
  const gewijzigd = updateOpenFem3DBeam(basis, 3, { profileNameEnd: "IPE 300" });
  ok(gewijzigd.beams[2].profileNameEnd === "IPE 300", "wijzigen zet het eindprofiel");
  ok(!("profileNameEnd" in updateOpenFem3DBeam(gewijzigd, 3, { profileNameEnd: null }).beams[2]), "null haalt het eindprofiel weg");
  ok(updateOpenFem3DBeam(gewijzigd, 3, { name: "Spant" }).beams[2].profileNameEnd === "IPE 300", "een andere wijziging laat het eindprofiel staan");
  ok(!("profileNameEnd" in updateOpenFem3DBeam(gewijzigd, 3, { profileNameEnd: "IPE 500" }).beams[2]), "eind gelijk aan begin: prismatisch");
  weigert(() => updateOpenFem3DBeam(gewijzigd, 3, { profileName: "CHS 168.3x8" }),
    /3D-staaf 3: verlopend profiel wordt voor deze doorsnede niet ondersteund \("CHS 168.3x8"\)/,
    "een nieuw beginprofiel dat niet bij het eind past, wordt geweigerd (niet stil prismatisch)");
  ok(!("profileNameEnd" in updateOpenFem3DBeam(gewijzigd, 3, { profileName: "CHS 168.3x8", profileNameEnd: null }).beams[2]),
    "met profileNameEnd: null mag het beginprofiel wel van soort wisselen");
  weigert(() => updateOpenFem3DBeam(gewijzigd, 3, { material: "C24" }), /3D-staaf 3:/, "ander materiaal dat geen verloop toelaat: geweigerd");
}

console.log("\n[2] het projectbestand: versie 6 alleen met een verlopende staaf");
{
  const bestand = (model3d) => ({
    modelDimension: "3d", nodes: [], beams: [], supports: [], plates: [], loads: [], loadCases: [], model3d,
  });
  ok(PROJECT_FORMAT_VERSION_3D_TAPERED === 6 && PROJECT_FORMAT_VERSION_MAX >= 6, "versie 6 voor verloop, en de app leest haar");
  const prismatisch = JSON.parse(serializeProject(bestand(parseOpenFem3DModel(spant()))));
  ok(prismatisch.version === PROJECT_FORMAT_VERSION_3D, "een 3D-project zonder verloop houdt versie 3");
  const bedding = { kKnPerM3: 50_000, widthM: 0.5 };
  ok(JSON.parse(serializeProject(bestand(parseOpenFem3DModel(spant({ bedding }))))).version === PROJECT_FORMAT_VERSION_3D_BEDDING,
    "met bedding en zonder verloop: versie 5");
  ok(JSON.parse(serializeProject(bestand(parseOpenFem3DModel(spant({ bedding, ...VERLOOP }))))).version === 6,
    "met bedding én verloop: versie 6");
  const tekst = serializeProject(bestand(parseOpenFem3DModel(spant(VERLOOP))));
  ok(JSON.parse(tekst).version === 6, "een bestand met een verlopende staaf krijgt versie 6");
  const terug = deserializeProject(tekst);
  ok(terug.model3d.beams[2].profileNameEnd === "IPE 300", "het eindprofiel overleeft opslaan en openen");
  ok(JSON.parse(serializeProject(bestand(parseOpenFem3DModel(spant({ profileNameEnd: "IPE 500" }))))).version === PROJECT_FORMAT_VERSION_3D,
    "een eindprofiel gelijk aan het begin is geen verloop: versie 3");
  // Sinds #107 (plaat op bedding) is 7 de hoogste leesbare versie; daarboven wordt geweigerd.
  assert.throws(() => deserializeProject(JSON.stringify({ ...JSON.parse(tekst), version: PROJECT_FORMAT_VERSION_MAX + 1 })), /nieuwere versie/);
  ok(true, `versie ${PROJECT_FORMAT_VERSION_MAX + 1} wordt geweigerd`);
}

console.log("\n[3] het rekenverzoek: delen met de doorsnede van hun midden");
{
  const prismatisch = buildOpenFem3DSolveRequest(parseOpenFem3DModel(spant()), "linear");
  ok(!json(prismatisch).includes("partSectionIds"), "zonder verloop: geen partSectionIds in het verzoek");
  ok(json(prismatisch.sections.map((s) => s.name)) === json(["HEA 300", "IPE 500"]), "zonder verloop: de catalogusdoorsneden zoals voorheen");

  const model = parseOpenFem3DModel(spant(VERLOOP));
  const verzoek = buildOpenFem3DSolveRequest(model, "linear");
  const lid = verzoek.members.find((m) => m.id === 3);
  const n = aantalVerloopSegmenten(8000);
  ok(n === 20, "8 m: twintig delen, zoals een 2D-staaf");
  ok(Array.isArray(lid.partSectionIds) && lid.partSectionIds.length === n, `staaf 3 krijgt ${n} deeldoorsneden`);
  ok(verzoek.members.filter((m) => m.id !== 3).every((m) => !("partSectionIds" in m)), "de prismatische kolommen houden geen partSectionIds");
  const sectie = (id) => verzoek.sections.find((s) => s.id === id);
  ok(lid.partSectionIds.every((id) => sectie(id)), "elke deeldoorsnede bestaat in sections");
  const v = bepaalVerloop("S235", "IPE 500", "IPE 300");
  ok(v.status === "verlopend", "IPE 500 → IPE 300 is een verloop");
  const segmenten2D = segmentenVoorVerloop(v.verloop, 8000);
  ok(segmenten2D.length === n, "dezelfde n als de 2D-indeling");
  segmenten2D.forEach((s, i) => {
    const d = sectie(lid.partSectionIds[i]);
    gelijk(d.areaM2, s.A * 1e-6, `deel ${i + 1}: A gelijk aan 2D`, 1e-12);
    gelijk(d.iyM4, s.I * 1e-12, `deel ${i + 1}: I_y gelijk aan 2D`, 1e-12);
    // De tussendoorsnede die 2D bij splitsen op het midden van dit deel zou bewaren.
    const tussen = tussenProfielVoorSplitsing("S235", "IPE 500", "IPE 300", (s.tStart + s.tEnd) / 2, []);
    const e = tussen.bewaren.eigenschappen;
    gelijk(d.izM4, e.iz_mm4 * 1e-12, `deel ${i + 1}: I_z gelijk aan de 2D-tussendoorsnede`, 1e-12);
    gelijk(d.torsionJM4, e.it_mm4 * 1e-12, `deel ${i + 1}: I_t gelijk aan de 2D-tussendoorsnede`, 1e-12);
    gelijk(d.areaM2, e.area_mm2 * 1e-6, `deel ${i + 1}: A gelijk aan de 2D-tussendoorsnede`, 1e-12);
  });
  const begin = sectie(lid.sectionId);
  const welBegin = gelasteIEigenschappen(v.verloop.begin);
  gelijk(begin.areaM2, welBegin.area_mm2 * 1e-6, "sectionId is de doorsnede van het begin (gelast model op t = 0)", 1e-12);
  ok(lid.sectionId !== lid.partSectionIds[0], "het begin is niet het eerste deel (dat rekent met zijn midden)");
  ok(verzoek.members.find((m) => m.id === 1).sectionId === prismatisch.members.find((m) => m.id === 1).sectionId
    && json(sectie(verzoek.members.find((m) => m.id === 1).sectionId)) === json(prismatisch.sections[0]),
  "de prismatische HEA 300 houdt de catalogusdoorsnede");
  // Twee gelijke verlopende staven delen hun doorsneden.
  const twee = parseOpenFem3DModel({
    ...spant(VERLOOP), nodes: [...spant().nodes, { id: 5, x: 16, y: 0, z: 6 }],
    beams: [...spant(VERLOOP).beams, { id: 4, startNodeId: 3, endNodeId: 5, profileName: "IPE 500", profileNameEnd: "IPE 300", material: "S235" }],
  });
  const verzoekTwee = buildOpenFem3DSolveRequest(twee, "linear");
  ok(json(verzoekTwee.members.find((m) => m.id === 4).partSectionIds) === json(verzoekTwee.members.find((m) => m.id === 3).partSectionIds),
    "twee gelijke verlopende staven delen dezelfde deeldoorsneden");
  ok(verzoekTwee.sections.length === verzoek.sections.length, "geen dubbele doorsneden");

  // Hout: rechthoek b × h verloopt; I_z en I_t uit b en h.
  const hout = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 5, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "100x500", profileNameEnd: "100x200", material: "GL24h" }],
    supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
    loads: [{ id: 1, nodeId: 2, fx: 0, fy: 0, fz: -5, mx: 0, my: 0, mz: 0 }],
  });
  // Hout gebruikt E_mean voor buiging en G_mean voor torsie/afschuiving.
  const houtVerzoek = buildOpenFem3DSolveRequest(hout, "linear");
  ok(houtVerzoek.materials[0].nu === 0 && houtVerzoek.materials[0].gMpa === 650,
    "GL24h geeft zijn onafhankelijke G_mean aan de 3D-adapter door");
  ok(houtVerzoek.members[0].partSectionIds.length > 1,
    "een verlopende houten staaf geeft zijn deeldoorsneden door");
  const vrij = parseOpenFem3DModel({ ...hout, beams: [{ ...hout.beams[0], material: "VRIJ:Hout E=11000 rho=420 f=24 gM=1.3" }] });
  const vrijVerzoek = buildOpenFem3DSolveRequest(vrij, "linear");
  const vrijLid = vrijVerzoek.members[0];
  const vh = bepaalVerloop(vrij.beams[0].material, "100x500", "100x200");
  ok(vh.status === "verlopend" && vh.verloop.soort === "rechthoek", "een vrij materiaal met rechthoek verloopt als rechthoek");
  const delenHout = segmentenVoorVerloop(vh.verloop, 5000);
  delenHout.forEach((s, i) => {
    const d = vrijVerzoek.sections.find((x) => x.id === vrijLid.partSectionIds[i]);
    const t = (s.tStart + s.tEnd) / 2;
    const h = 500 - 300 * t;
    gelijk(d.areaM2, 100 * h * 1e-6, `rechthoek deel ${i + 1}: A = b·h`, 1e-12);
    gelijk(d.iyM4, 100 * h ** 3 / 12 * 1e-12, `rechthoek deel ${i + 1}: I_y = b·h³/12`, 1e-12);
    gelijk(d.izM4, h * 100 ** 3 / 12 * 1e-12, `rechthoek deel ${i + 1}: I_z = h·b³/12`, 1e-12);
    gelijk(d.torsionJM4, rechthoekTorsieconstante(100, h) * 1e-12, `rechthoek deel ${i + 1}: I_t als een prismatische rechthoek`, 1e-12);
  });

  // Een korte staaf: minder delen, nooit korter dan 25 mm; onder 50 mm één deel (de doorsnede van het midden).
  const kort = (lengte) => parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: lengte, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 500", profileNameEnd: "IPE 300", material: "S235" }],
    supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
    loads: [{ id: 1, nodeId: 2, fx: 0, fy: 0, fz: -5, mx: 0, my: 0, mz: 0 }],
  });
  ok(buildOpenFem3DSolveRequest(kort(0.3), "linear").members[0].partSectionIds.length === 12, "0,3 m: twaalf delen van 25 mm");
  const heelKort = buildOpenFem3DSolveRequest(kort(0.04), "linear");
  ok(!("partSectionIds" in heelKort.members[0]), "0,04 m: één deel, geen partSectionIds (het contract vraagt n ≥ 2)");
  gelijk(heelKort.sections.find((s) => s.id === heelKort.members[0].sectionId).areaM2,
    doorsnedeOpPositie(bepaalVerloop("S235", "IPE 500", "IPE 300").verloop, 0.5).A * 1e-6,
    "één deel rekent met de doorsnede van het midden, zoals 2D", 1e-12);
  const indeling = openFem3DVerloopDelen(model.beams[2], 8);
  ok(indeling.delen.length === 20 && indeling.delen[0].tStart === 0 && indeling.delen[19].tEnd === 1, "de delen lopen van 0 tot 1");
  ok(openFem3DVerloopDelen(model.beams[0], 6) === null, "een prismatische staaf heeft geen delen");
}

console.log("\n[4] eigen gewicht per deel en het staalgewicht");
{
  const model = parseOpenFem3DModel(spant(VERLOOP, { loads: [], memberLoads: [] }));
  const met = withOpenFem3DSelfWeight(model, 9);
  const lasten = met.memberLoads.filter((l) => l.beamId === 3 && l.caseId === 9);
  ok(lasten.length === 20, "twintig deellasten op de verlopende ligger");
  const v = bepaalVerloop("S235", "IPE 500", "IPE 300").verloop;
  const rho = dichtheidVanMateriaal("S235");
  segmentenVoorVerloop(v, 8000).forEach((s, i) => {
    const l = lasten[i];
    gelijk(l.startPositionM, s.tStart * 8, `deel ${i + 1}: begint op de deelgrens`, 1e-15);
    gelijk(l.endPositionM, s.tEnd * 8, `deel ${i + 1}: eindigt op de deelgrens`, 1e-15);
    ok(l.globalDirection === "z" && l.qEnd === l.qStart, `deel ${i + 1}: een gelijkmatige globale Z-last (#112)`);
    gelijk(l.qStart, -(rho * s.A * 1e-6 * G) / 1000, `deel ${i + 1}: q = ρ·A·g met A van het midden`, 1e-12);
  });
  const totaal = lasten.reduce((som, l) => som + l.qStart * (l.endPositionM - l.startPositionM), 0);
  const gemiddeld = segmentenVoorVerloop(v, 8000).reduce((som, s) => som + s.A, 0) / 20;
  gelijk(totaal, -(rho * gemiddeld * 1e-6 * G) / 1000 * 8, "het totaal is ρ·g·L maal de gemiddelde A van de delen", 1e-12);
  ok(met.memberLoads.filter((l) => l.beamId === 1 && l.globalDirection === "z").length === 1 && met.loads.filter((l) => l.caseId === 9).length === 0,
    "de verticale kolommen: één globale Z-last langs de staaf, geen knooplasten (#112)");
  // Een schuine verlopende staaf: per deel een globale Z-last; de kern ontbindt
  // haar en verdeelt de axiale component (test-open-fem3d-eigen-gewicht-e2e).
  const schuin = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 6 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 500", profileNameEnd: "IPE 300", material: "S235" }],
  });
  const s = withOpenFem3DSelfWeight(schuin, 1);
  const L = Math.hypot(6, 6);
  const delen = segmentenVoorVerloop(v, L * 1000);
  const q = (A) => -(rho * A * 1e-6 * G) / 1000;
  ok(s.loads.length === 0 && s.memberLoads.length === 20, "schuin: twintig deellasten, geen knooplasten");
  delen.forEach((d, i) => {
    gelijk(s.memberLoads[i].qStart, q(d.A), `schuin, deel ${i + 1}: q = ρ·A·g per staafmeter`, 1e-12);
    gelijk(s.memberLoads[i].startPositionM, d.tStart * L, `schuin, deel ${i + 1}: op de deelgrens`, 1e-15);
  });
  ok(Math.abs(s.memberLoads[0].qStart) > Math.abs(s.memberLoads[19].qStart), "het zware begin weegt per meter meer dan het lichte eind");
  // Een verlopende trek-alleen staaf (kabelwerking): het halve gewicht van de
  // delen, Σ ρ·g·A_i·L/n / 2, als knooplast in −Z op elk einde; geen lijnlasten.
  const trek = parseOpenFem3DModel({ ...schuin, beams: [{ ...schuin.beams[0], tensionOnly: true }] });
  ok(trek.beams[0].tensionOnly === true && trek.beams[0].profileNameEnd === "IPE 300", "een verlopende trek-alleen staaf");
  const metTrek = withOpenFem3DSelfWeight(trek, 1);
  ok(metTrek.memberLoads.length === 0, "trek-alleen: geen lijnlasten (geen buiging)");
  ok(metTrek.loads.length === 2 && metTrek.loads.every((l) => l.fx === 0 && l.fy === 0 && l.mx === 0 && l.my === 0 && l.mz === 0),
    "trek-alleen: twee knooplasten, alleen in Z");
  const helft = delen.reduce((som, d) => som + q(d.A) * (d.tEnd - d.tStart) * L, 0) / 2;
  gelijk(2 * helft, -(rho * G / 1000) * delen.reduce((som, d) => som + d.A * 1e-6, 0) * L / delen.length,
    "trek-alleen: de som over de delen is Σ ρ·g·A_i·L/n", 1e-12);
  for (const id of [1, 2]) {
    gelijk(metTrek.loads.find((l) => l.nodeId === id).fz, helft, `trek-alleen: knoop ${id} draagt de helft`, 1e-12);
  }
  const prismatischTrek = withOpenFem3DSelfWeight(parseOpenFem3DModel({
    ...schuin, beams: [{ ...schuin.beams[0], profileNameEnd: undefined, tensionOnly: true }],
  }), 1);
  ok(Math.abs(prismatischTrek.loads[0].fz) > Math.abs(helft), "de verlopende trek-alleen staaf weegt minder dan een prismatische IPE 500");

  const gewicht = openFem3DStaalgewicht(model);
  const ligger = gewicht.perProfiel.find((p) => p.profiel === "IPE 500 → IPE 300");
  ok(ligger !== undefined, "het staalgewicht noemt de verlopende ligger als eigen regel");
  gelijk(ligger.kg, rho * gemiddeld * 1e-6 * 8, "staalgewicht met de gemiddelde massa van de delen", 1e-12);
  gelijk(ligger.kg, -totaal / G * 1000, "staalgewicht en eigen gewicht passen bij elkaar", 1e-12);
}

console.log("\n[4b] de profieltekst (#113): een eigen doorsnede zonder EIGEN:, een gelaste I vertaald");
{
  const gelast = "EIGEN:Gelast I 400×300×9×14";
  ok(openFem3DProfielTekst({ profileName: "HEA 300", profileNameEnd: gelast }) === "HEA 300 → Gelast I 400×300×9×14",
    "verlopend naar een gelaste tussendoorsnede: zonder voorvoegsel, in het Nederlands zonder vertaalfunctie");
  const engels = (sleutel, w) => sleutel === "common:profileName.weldedI" ? `${w.voorvoegsel}Welded I ${w.maten}` : sleutel;
  ok(openFem3DProfielTekst({ profileName: gelast, profileNameEnd: "HEA 500" }, engels) === "Welded I 400×300×9×14 → HEA 500",
    "met een vertaalfunctie vertaald, zoals de 2D-profielkiezer");
  ok(openFem3DProfielTekst({ profileName: "EIGEN:Kokerligger 300" }) === "Kokerligger 300", "een andere eigen doorsnede: alleen het voorvoegsel weg");
  ok(openFem3DProfielTekst({ profileName: "IPE 500", profileNameEnd: "IPE 300" }) === "IPE 500 → IPE 300", "een catalogusverloop blijft zoals het was");
}

console.log("\n[5] invoer zonder verlies: kiezer, 2D → 3D, splitsen, samenvoegen");
{
  const model = parseOpenFem3DModel(spant());
  const gekozen = applyOpenFem3DProfileChoice(model, [3], { material: "S235", profile: "IPE 600", profileEnd: "IPE 400" });
  ok(gekozen.beams[2].profileName === "IPE 600" && gekozen.beams[2].profileNameEnd === "IPE 400", "de profielkiezer bewaart het eindprofiel");
  const terug = applyOpenFem3DProfileChoice(gekozen, [3], { material: "S235", profile: "IPE 600", profileEnd: undefined });
  ok(!("profileNameEnd" in terug.beams[2]), "een prismatische keuze haalt het eindprofiel weg");
  weigert(() => applyOpenFem3DProfileChoice(model, [3], { material: "S235", profile: "IPE 600", profileEnd: "UPE 200" }),
    /3D-staaf 3: verlopend profiel wordt voor deze doorsnede niet ondersteund/, "een ongeldige keuze wordt met de reden geweigerd");
  const beton = applyOpenFem3DProfileChoice(model, [3], {
    material: "C30/37", profile: "300x600", beton: { korf: { a: 1 }, milieuklasse: "XC1", constructieklasse: null },
  });
  ok(beton.beams[2].checkConfig?.betonMilieuklasse === "XC1" && !("profileNameEnd" in beton.beams[2]), "beton: de korf gaat mee, geen eindprofiel");
  const meer = applyOpenFem3DProfileChoice(model, [1, 2], { material: "S355", profile: "HEA 400", profileEnd: "HEA 200" });
  ok(meer.beams.slice(0, 2).every((b) => b.profileNameEnd === "HEA 200" && b.material === "S355"), "meer staven tegelijk");

  const omgezet = convert2DTo3D({
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }, { id: 3, x: 12000, z: 0 }],
    beams: [
      { id: 1, from: 1, to: 2, profile: "IPE 400", profileEnd: "IPE 200", material: "S235" },
      { id: 2, from: 2, to: 3, profile: "IPE 200", profileEnd: "", material: "S235" },
      { id: 3, from: 2, to: 3, profile: "IPE300", profileEnd: "IPE 300", material: "S235" },
    ],
    supports: [], loads: [],
  }).model;
  ok(omgezet.beams[0].profileNameEnd === "IPE 200", "2D → 3D neemt het eindprofiel mee");
  ok(!("profileNameEnd" in omgezet.beams[1]), "2D → 3D: een leeg eindprofiel blijft prismatisch");
  ok(!("profileNameEnd" in omgezet.beams[2]), "2D → 3D: hetzelfde profiel anders gespeld blijft prismatisch (de keuring van bepaalVerloop)");

  // Splitsen: beide delen verlopend, met het tussenprofiel op de knip.
  const verlopend = parseOpenFem3DModel(spant(VERLOOP));
  const knip = splitOpenFem3DBeam(verlopend, 3, 0.25);
  const eerste = knip.model.beams.find((b) => b.id === knip.firstBeamId);
  const tweede = knip.model.beams.find((b) => b.id === knip.secondBeamId);
  const verwacht = tussenProfielVoorSplitsing("S235", "IPE 500", "IPE 300", 0.25, []);
  ok(eerste.profileName === "IPE 500" && eerste.profileNameEnd === verwacht.tussenProfiel, "deel 1: van het begin naar het tussenprofiel");
  ok(tweede.profileName === verwacht.tussenProfiel && tweede.profileNameEnd === "IPE 300", "deel 2: van het tussenprofiel naar het eind");
  ok(zoekEigenDoorsnede(verwacht.tussenProfiel) !== undefined, "de gelaste tussendoorsnede is bewaard (zoals in 2D)");
  const vHeel = bepaalVerloop("S235", "IPE 500", "IPE 300").verloop;
  const v1 = bepaalVerloop("S235", eerste.profileName, eerste.profileNameEnd).verloop;
  const v2 = bepaalVerloop("S235", tweede.profileName, tweede.profileNameEnd).verloop;
  for (const t of [0, 0.1, 0.25, 0.4, 0.7, 1]) {
    const heel = doorsnedeOpPositie(vHeel, t);
    const deel = t <= 0.25 ? doorsnedeOpPositie(v1, t / 0.25) : doorsnedeOpPositie(v2, (t - 0.25) / 0.75);
    gelijk(deel.I, heel.I, `na splitsen: I(x) op t = ${t} ongewijzigd`, 1e-12);
  }
  // De gesplitste delen zijn te rekenen: de tussendoorsnede is een eigen gelaste I.
  const knipVerzoek = buildOpenFem3DSolveRequest(knip.model, "linear");
  ok(knipVerzoek.members.filter((m) => m.partSectionIds).length === 2, "beide delen rekenen verlopend");
  const prismKnip = splitOpenFem3DBeam(parseOpenFem3DModel(spant()), 3, 0.5);
  ok(prismKnip.model.beams.every((b) => !("profileNameEnd" in b)), "een prismatische staaf splitst zonder eindprofiel");
  // Hout: het tussenprofiel is een rechthoek in de naam.
  const houtKnip = splitOpenFem3DBeam(parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "100x500", profileNameEnd: "100x300", material: "GL24h" }],
  }), 1, 0.5);
  ok(houtKnip.model.beams[0].profileNameEnd === "100x400" && houtKnip.model.beams[1].profileName === "100x400", "hout: 100x400 op het midden");

  // De modelcontrole (een proefknip bij elke wijziging van knopen of staven)
  // bewaart geen gelaste tussendoorsnede; de echte knip van Aansluiten wel.
  // Staaf 1: 8 m, IPE 500 → IPE 300; de knopen 3 en 5 liggen los op x = 3 en
  // x = 6 m, elk met een kolom erop.
  const losseKnopen = parseOpenFem3DModel({
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 8, y: 0, z: 0 }, { id: 3, x: 3, y: 0, z: 0 }, { id: 4, x: 3, y: 0, z: -4 },
      { id: 5, x: 6, y: 0, z: 0 }, { id: 6, x: 6, y: 0, z: -4 },
    ],
    beams: [
      { id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 500", profileNameEnd: "IPE 300", material: "S235" },
      { id: 2, startNodeId: 4, endNodeId: 3, profileName: "HEA 200", material: "S235" },
      { id: 3, startNodeId: 6, endNodeId: 5, profileName: "HEA 200", material: "S235" },
    ],
    supports: [1, 4, 6].map((nodeId) => ({ nodeId, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true })),
    loads: [{ id: 1, nodeId: 2, fx: 0, fy: 0, fz: -10, mx: 0, my: 0, mz: 0 }],
  });
  const opDrie = tussenProfielVoorSplitsing("S235", "IPE 500", "IPE 300", 3 / 8, []).tussenProfiel;
  ok(zoekEigenDoorsnede(opDrie) === undefined, "vooraf: de tussendoorsnede op x = 3 m staat niet in de bibliotheek");
  const bibliotheek = eigenDoorsnedenStore.getState().items;
  const controle = openFem3DConnectCheck(losseKnopen, 10);
  ok(controle.findings.length === 2 && controle.connectable === 2 && controle.skipped.length === 0,
    "de modelcontrole vindt beide losse knopen en kan ze aansluiten");
  for (const x of [1, 2, 3, 4, 5, 6, 7]) {
    openFem3DConnectCheck({ ...losseKnopen, nodes: losseKnopen.nodes.map((n) => n.id === 3 || n.id === 4 ? { ...n, x: x + 0.25 } : n) }, 10);
  }
  ok(eigenDoorsnedenStore.getState().items === bibliotheek,
    "de modelcontrole (ook met de knoop op zeven plekken) laat de bibliotheek ongewijzigd");
  const aangesloten = connectOpenFem3DNodesToBeams(losseKnopen, { toleranceMm: 10 });
  ok(aangesloten.nodeCount === controle.connectable, "Aansluiten sluit evenveel knopen aan als de controle voorspelde");
  const delenNa = aangesloten.splits[0].beamIds.map((id) => aangesloten.model.beams.find((b) => b.id === id));
  ok(delenNa.length === 3 && delenNa[0].profileName === "IPE 500" && delenNa[0].profileNameEnd === opDrie,
    "Aansluiten: het eerste deel loopt van IPE 500 naar de tussendoorsnede op x = 3 m");
  ok(zoekEigenDoorsnede(opDrie) !== undefined, "Aansluiten bewaart de tussendoorsnede wel");
  ok(delenNa[1].profileName === opDrie && delenNa[1].profileNameEnd.startsWith("EIGEN:")
    && zoekEigenDoorsnede(delenNa[1].profileNameEnd) !== undefined && delenNa[2].profileNameEnd === "IPE 300",
    "ook de tussendoorsnede van de tweede knip staat in de bibliotheek");
  ok(buildOpenFem3DSolveRequest(aangesloten.model, "linear").members.filter((m) => m.partSectionIds).length === 3,
    "de drie delen rekenen verlopend");

  // Samenvoegen: twee staven op dezelfde knopen na het samenvoegen.
  const dubbel = (b) => parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6.0002, y: 0, z: 0 }],
    beams: [
      { id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 400", profileNameEnd: "IPE 200", material: "S235" },
      { id: 2, startNodeId: 1, endNodeId: 3, material: "S235", ...b },
    ],
  });
  const zelfde = mergeOpenFem3DNodes(dubbel({ profileName: "IPE 400", profileNameEnd: "IPE 200" }), { toleranceMm: 1 });
  ok(zelfde.refused.length === 0 && zelfde.model.beams.length === 1, "dubbele staven met hetzelfde verloop: één staaf");
  const anders = mergeOpenFem3DNodes(dubbel({ profileName: "IPE 400", profileNameEnd: "IPE 300" }), { toleranceMm: 1 });
  ok(anders.refused.length === 1 && anders.refused[0].reason.kind === "beamProperties"
    && json(anders.refused[0].reason.properties) === json(["taper"]), "een ander verloop: geweigerd met de reden verloop");
  const prism = mergeOpenFem3DNodes(dubbel({ profileName: "IPE 400" }), { toleranceMm: 1 });
  ok(prism.refused.length === 1 && json(prism.refused[0].reason.properties) === json(["taper"]), "verlopend tegen prismatisch: geweigerd");
  const omgekeerd = mergeOpenFem3DNodes(parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6.0002, y: 0, z: 0 }],
    beams: [
      { id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 400", profileNameEnd: "IPE 200", material: "S235" },
      { id: 2, startNodeId: 3, endNodeId: 1, profileName: "IPE 200", profileNameEnd: "IPE 400", material: "S235" },
    ],
  }), { toleranceMm: 1 });
  ok(omgekeerd.refused.length === 0 && omgekeerd.model.beams.length === 1, "omgekeerd getekend met omgekeerd verloop is hetzelfde: één staaf");
}

console.log("\n[6] toetsinvoer, profielkleuring, weergave en IFC");
{
  const model = parseOpenFem3DModel(spant(VERLOOP));
  const result = {
    displacements: model.nodes.map((n) => ({ nodeId: n.id, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 })),
    memberForces: model.beams.map((b) => ({
      memberId: b.id, lengthM: b.id === 3 ? 8 : 6, nStartKn: 0, nEndKn: 0, vyStartKn: 0, vyEndKn: 0, vzStartKn: 0, vzEndKn: 0,
      torsionStartKnm: 0, torsionEndKnm: 0, myStartKnm: 10, myEndKnm: -10, mzStartKnm: 0, mzEndKnm: 0,
    })),
  };
  const invoer = buildOpenFem3DSteelCheckInputs(model, result).inputs;
  ok(invoer.find((i) => i.beam_id === 3).profile_end === "IPE 300", "de 3D-staaltoets krijgt profile_end zoals in 2D");
  ok(invoer.filter((i) => i.beam_id !== 3).every((i) => !("profile_end" in i)), "prismatische staven: geen profile_end");
  const prismatisch = buildOpenFem3DSteelCheckInputs(parseOpenFem3DModel(spant()), result).inputs;
  ok(json(prismatisch.filter((i) => i.beam_id !== 3)) === json(invoer.filter((i) => i.beam_id !== 3)), "de toetsinvoer van prismatische staven is byte-gelijk");
  const scheef = buildOpenFem3DSteelCheckInputs(parseOpenFem3DModel(spant({ profileNameEnd: "SHS 100x100x5" })), result);
  ok(scheef.skipped.some((s) => s.beamId === 3 && /niet ondersteund \(koker/.test(s.reason)), "een ongeldig verloop: overgeslagen met de reden");

  const kleuring = openFem3DProfielKleuring(model.beams);
  const regel = kleuring.perStaaf.get(3);
  ok(regel.naam === "IPE 500 → IPE 300 (verlopend)", "de profielkleuring noemt het verloop");
  ok(kleuring.regels.length === 2 && kleuring.perStaaf.get(1) !== regel, "de verlopende ligger heeft een eigen kleur");

  ok(openFem3DBeamProfileKey(model.beams[2]) !== openFem3DBeamProfileKey(model.beams[0]), "een eigen geometriesleutel voor het verloop");
  ok(openFem3DBeamProfileKey({ ...model.beams[2], profileNameEnd: undefined }) === openFem3DBeamProfileKey({ ...model.beams[2], profileNameEnd: "IPE 500" }),
    "hetzelfde profiel als eind: dezelfde sleutel als prismatisch");
  const geo = createOpenFem3DBeamProfileGeometry(model.beams[2], 8);
  geo.computeBoundingBox();
  const pos = geo.getAttribute("position");
  const ring = (z) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getZ(i) - z) > 1e-6) continue;
      minX = Math.min(minX, pos.getX(i)); maxX = Math.max(maxX, pos.getX(i));
      minY = Math.min(minY, pos.getY(i)); maxY = Math.max(maxY, pos.getY(i));
    }
    return { b: maxX - minX, h: maxY - minY };
  };
  const beginRing = ring(-4), eindRing = ring(4);
  gelijk(beginRing.h, 0.5, "ring aan het begin: h van IPE 500", 1e-6);
  gelijk(beginRing.b, 0.2, "ring aan het begin: b van IPE 500", 1e-6);
  gelijk(eindRing.h, 0.3, "ring aan het eind: h van IPE 300", 1e-6);
  gelijk(eindRing.b, 0.15, "ring aan het eind: b van IPE 300", 1e-6);
  const zWaarden = new Set();
  for (let i = 0; i < pos.count; i++) zWaarden.add(Math.round(pos.getZ(i) * 1e9) / 1e9);
  ok(zWaarden.size === 2, "precies twee ringen: het volume is lineair tussen begin en eind");

  // De vervormde vorm in de profielweergave verloopt ook: de ringen langs de
  // stations lopen lineair van de begin- naar de einddoorsnede.
  const secties = openFem3DBeamSweepSections(model.beams[2]);
  ok(secties?.sectionEnd !== undefined, "de vervormde vorm krijgt begin- en einddoorsnede");
  const sweep = createOpenFem3DSweptProfileGeometry({
    ...secties, referenceY: new THREE.Vector3(0, 1, 0),
    points: [0, 4, 8].map((x) => new THREE.Vector3(x, 0, 0)),
  });
  const zBij = (x) => {
    const p = sweep.getAttribute("position");
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i) - x) < 1e-9) { min = Math.min(min, p.getZ(i)); max = Math.max(max, p.getZ(i)); }
    return max - min;
  };
  gelijk(zBij(0), 0.5, "vervormd: h = 500 mm aan het begin", 1e-6);
  gelijk(zBij(4), 0.4, "vervormd: h = 400 mm halverwege", 1e-6);
  gelijk(zBij(8), 0.3, "vervormd: h = 300 mm aan het eind", 1e-6);

  const ifcInvoer = (model3d) => ({ nodes: [], beams: [], supports: [], loads: [], loadCases: [], model3d });
  const ifc = bouwIfcRekenmodel(ifcInvoer(model), { tijdstempel: "2026-10-06T00:00:00", zonderBouwkundig: true });
  ok(/OpenFEM3D_Staaf/.test(ifc) && /'Eindprofiel'[^;]*IPE 300/.test(ifc), "IFC: de verlopende staaf draagt begin- en eindprofiel");
  ok(/Verloop[^;]*lineair/.test(ifc), "IFC: het verloop staat er met zoveel woorden bij");
  const ifcPrism = bouwIfcRekenmodel(ifcInvoer(parseOpenFem3DModel(spant())), { tijdstempel: "2026-10-06T00:00:00", zonderBouwkundig: true });
  ok(!/OpenFEM3D_Staaf/.test(ifcPrism), "IFC zonder verloop: geen extra set");
  ok(verzamelIfcBeperkingen(ifcInvoer(model)).some((r) => /Verlopende 3D-staaf \(3\)/.test(r) && /OpenFEM3D_Staaf/.test(r)),
    "de beperkingenlijst zegt hoe de verlopende staaf in het bestand staat (niet stil)");
  ok(!verzamelIfcBeperkingen(ifcInvoer(parseOpenFem3DModel(spant()))).some((r) => /Verlopende/.test(r)), "zonder verloop: geen regel");

  console.log("\n[7] de veldzakking met I per deel");
  // De doorbuiging in het veld (BGT-toets, vervormde vorm) integreert M/EI(x)
  // met dezelfde delen als de kern. Vrij opgelegde ligger, M = q·L²/8·4t(1−t),
  // einden in rust: w(½) = Σ over de delen van ∫ M·m/(E·I_i), m = de eenheidslast in het midden.
  const L = 8, q = 10;
  const ligger = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 500", profileNameEnd: "IPE 300", material: "S235" }],
  });
  const ts = Array.from({ length: 201 }, (_, i) => i / 200);
  const veld = {
    displacements: [1, 2].map((nodeId) => ({ nodeId, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 })),
    memberForces: [],
    diagrams: {
      momentY: [{ memberId: 1, points: ts.map((t) => ({ t, value: q * L * L / 8 * 4 * t * (1 - t) })) }],
      momentZ: [], shearY: [], shearZ: [], axial: [], torsion: [],
    },
  };
  const stations = openFem3DMemberDisplacementStations(ligger, ligger.beams[0], veld, 400);
  const midden = stations.find((s) => Math.abs(s.t - 0.5) < 1e-12);
  const vI = bepaalVerloop("S235", "IPE 500", "IPE 300").verloop;
  const delen = segmentenVoorVerloop(vI, L * 1000);
  const E = 210_000e3;
  let w = 0;
  const stappen = 4000;
  for (let i = 0; i < stappen; i++) {
    const t = (i + 0.5) / stappen;
    const I = delen[Math.min(delen.length - 1, Math.floor(t * delen.length))].I * 1e-12;
    const m = (t <= 0.5 ? t : 1 - t) * L / 2;
    w += q * L * L / 8 * 4 * t * (1 - t) * m / (E * I) * (L / stappen);
  }
  gelijk(Math.abs(midden.uz), w, "veldzakking in het midden met I per deel (zoals de kern)", 2e-3);
  const prismatischeVeld = openFem3DMemberDisplacementStations(
    parseOpenFem3DModel({ ...ligger, beams: [{ ...ligger.beams[0], profileNameEnd: undefined }] }), ligger.beams[0] && { ...ligger.beams[0], profileNameEnd: undefined }, veld, 400);
  ok(Math.abs(prismatischeVeld.find((s) => Math.abs(s.t - 0.5) < 1e-12).uz) < Math.abs(midden.uz), "slanker naar het eind: meer zakking dan een prismatische IPE 500");
}

console.log("\n[8] de wizard Stalen hal bewaart het eindprofiel");
{
  ok(json(staalhalProfielUitKeuze({ material: "S235", profile: "IPE 600", profileEnd: "IPE 400" }))
    === json({ profiel: "IPE 600", materiaal: "S235", profielEind: "IPE 400" }), "de kiezerkeuze wordt een groep met eindprofiel");
  ok(json(staalhalProfielUitKeuze({ material: "S235", profile: "IPE 600" })) === json({ profiel: "IPE 600", materiaal: "S235" }),
    "een prismatische keuze: geen eindprofiel");
  const standaard = maakStaalhal({});
  ok(standaard.model.beams.every((b) => !("profileNameEnd" in b)) && standaard.eigenDoorsneden.length === 0,
    "zonder eindprofiel: geen verloop en geen eigen doorsneden");
  ok(!("eigenDoorsneden" in staalhalProject(standaard)), "zonder verloop draagt het project geen eigen doorsneden");
  const hal = maakStaalhal({
    lengteMm: 12_000, breedteMm: 20_000, aantalVakken: 2, gordingafstandMm: 2_500,
    profielen: {
      kolom: { profiel: "HEA 300", materiaal: "S235", profielEind: "HEA 500" },
      spantligger: { profiel: "IPE 600", materiaal: "S235", profielEind: "IPE 400" },
    },
  });
  const kolommen = hal.samenvatting.groepen.kolom.map((id) => hal.model.beams.find((b) => b.id === id));
  const knoop = (id) => hal.model.nodes.find((n) => n.id === id);
  ok(kolommen.every((b) => b.profileName === "HEA 300" && b.profileNameEnd === "HEA 500" && knoop(b.startNodeId).z === 0),
    "kolom: van HEA 300 aan de voet naar HEA 500 aan de kop");
  const spant = hal.samenvatting.groepen.spantligger.map((id) => hal.model.beams.find((b) => b.id === id))
    .filter((b) => knoop(b.startNodeId).x === 0)
    .sort((a, b) => knoop(a.startNodeId).y - knoop(b.startNodeId).y);
  ok(spant.length === 8, "acht staven in het eerste spant (twintig meter, gordingen om de 2,5 m)");
  ok(spant[0].profileName === "IPE 600" && spant[3].profileNameEnd === "IPE 400" && spant[4].profileName === "IPE 400"
    && spant[7].profileNameEnd === "IPE 600", "spantligger: IPE 600 aan beide goten, IPE 400 in de nok");
  ok(spant.every((b, i) => i === 0 || b.profileName === spant[i - 1].profileNameEnd), "geen sprong: elk eind is het begin van de volgende staaf");
  ok(hal.eigenDoorsneden.length === 3 && hal.eigenDoorsneden.every((d) => spant.some((b) => b.profileNameEnd === `EIGEN:${d.naam}`)),
    "drie gelaste tussendoorsneden (op een kwart, de helft en driekwart), en die gaan mee in het resultaat");
  ok(json(staalhalProject(hal).eigenDoorsneden) === json(hal.eigenDoorsneden), "het projectbestand draagt ze mee");
  // In de winkel (zoals de app en de sidecar doen) is de ligger lineair over de hele halve overspanning.
  for (const d of hal.eigenDoorsneden) eigenDoorsnedenStore.getState().bewaar(d);
  const vHeel = bepaalVerloop("S235", "IPE 600", "IPE 400").verloop;
  for (const [index, t] of [[0, 0.125], [1, 0.375], [2, 0.625], [3, 0.875]]) {
    const v = bepaalVerloop("S235", spant[index].profileName, spant[index].profileNameEnd).verloop;
    gelijk(doorsnedeOpPositie(v, 0.5).I, doorsnedeOpPositie(vHeel, t).I, `staaf ${index + 1}: I in haar midden = I van het hele verloop op t = ${t}`, 1e-12);
  }
  const verzoek = buildOpenFem3DSolveRequest(withOpenFem3DSelfWeight(hal.model, 5), "linear", 5);
  ok(verzoek.members.filter((m) => m.partSectionIds).length === hal.samenvatting.groepen.kolom.length + hal.samenvatting.groepen.spantligger.length,
    "alle kolommen en spantliggers rekenen verlopend");
  // De MCP-weg (staalhal_maken): de sidecar zet de tussendoorsneden zelf in de
  // winkel vóór hij de verzoeken bouwt — met een lege winkel gaat het ook.
  eigenDoorsnedenStore.getState().vervangAlles([]);
  const mcp = opStaalhalMaken({
    hal: {
      lengteMm: 12_000, breedteMm: 20_000, aantalVakken: 2, gordingafstandMm: 2_500,
      profielen: {
        kolom: { profiel: "HEA 300", materiaal: "S235", profielEind: "HEA 500" },
        spantligger: { profiel: "IPE 600", materiaal: "S235", profielEind: "IPE 400" },
      },
    },
    reken: {},
  });
  ok(mcp.project.eigenDoorsneden?.length === 3, "staalhal_maken: het projectbestand draagt de tussendoorsneden");
  ok(mcp.rekenverzoeken.length > 0 && mcp.rekenverzoeken.every((v) => v.verzoek.members.filter((m) => m.partSectionIds).length
    === hal.samenvatting.groepen.kolom.length + hal.samenvatting.groepen.spantligger.length),
  "staalhal_maken: elk rekenverzoek rekent kolommen en spantliggers verlopend, ook met een lege winkel");
  const fout = (profielen, code, naam, extra = {}) => {
    const uit = probeerStaalhal({ lengteMm: 12_000, breedteMm: 20_000, aantalVakken: 2, ...extra, profielen });
    ok(!uit.ok && uit.problemen.some((p) => p.code === code), `${naam} (${code})`);
  };
  fout({ kolom: { profiel: "HEA 300", materiaal: "S235", profielEind: "CHS 168.3x8" } }, "verloopOngeldig", "een buis als eind wordt geweigerd");
  fout({ gording: { profiel: "IPE 160", materiaal: "S235", profielEind: "IPE 120" } }, "verloopNietBijGroep", "geen verloop bij gordingen");
  fout({ spantligger: { profiel: "IPE 600", materiaal: "S235", profielEind: "IPE 400" } }, "verloopZonderMidden",
    "plat dak met een oneven aantal velden: geen knoop in het midden", { dak: { type: "platdak" }, gordingafstandMm: 4_000 });
  const leeg = maakStaalhal({ profielen: { kolom: { profiel: "HEA 450", materiaal: "S235", profielEind: "" } } });
  ok(!("profielEind" in leeg.parameters.profielen.kolom), "een leeg eindprofiel is prismatisch");
  const gelijkProfiel = maakStaalhal({ profielen: { kolom: { profiel: "HEA 450", materiaal: "S235", profielEind: "HEA 450" } } });
  ok(gelijkProfiel.model.beams.every((b) => !("profileNameEnd" in b)), "hetzelfde profiel als eind: prismatisch");
}

console.log("\n[9] bedieningskanaal (model_3d_bouwen)");
{
  const { voerUit } = await import("./src/bediening/bediening.ts");
  const acties = () => ({
    fem: { nodes: [], beams: [], loads: [], loadCases: [], combinations: [], combinationResults: null },
    modelDimension: "3d",
    openFem3d: {
      model: { nodes: [], beams: [] },
      visibility: { nodes: true, beams: true, structuralGrid: true },
      structuralGrid: { enabled: true, xAxes: [], yAxes: [], zAxes: [] },
      replaceModel(model) { this.model = model; },
      setVisibility() {}, setView() {}, setSelection() {},
    },
    setActiveView() {},
  });
  const voer = async (naam, args, a) => {
    try {
      return await voerUit(naam, args, { current: a }, () => new Promise(() => {}), () => Promise.resolve());
    } catch (fout) {
      return { fout: fout instanceof Error ? fout.message : String(fout) };
    }
  };
  const bouw = (ligger) => ({
    nodes: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 6 }, { x: 8, y: 0, z: 6 }, { x: 8, y: 0, z: 0 }],
    beams: [
      { from: 1, to: 2, profile_name: "HEA 300", material: "S235" },
      { from: 2, to: 3, profile_name: "IPE 500", material: "S235", ...ligger },
      { from: 4, to: 3, profile_name: "HEA 300", material: "S235" },
    ],
    supports: [{ node: 1, type: "fixed" }, { node: 4, type: "fixed" }],
    loads: [{ node: 2, fz: -20 }],
  });
  const a = acties();
  const antwoord = await voer("model_3d_bouwen", bouw({ profile_name_end: "IPE 300" }), a);
  ok(!antwoord.fout, `model_3d_bouwen met een verlopende ligger${antwoord.fout ? `: ${antwoord.fout}` : ""}`);
  ok(a.openFem3d.model.beams[1].profileName === "IPE 500" && a.openFem3d.model.beams[1].profileNameEnd === "IPE 300",
    "IPE 500 → IPE 300 blijft als profileNameEnd staan");
  ok(a.openFem3d.model.beams.filter((b) => "profileNameEnd" in b).length === 1, "de kolommen blijven prismatisch");
  ok(buildOpenFem3DSolveRequest(a.openFem3d.model, "linear").members[1].partSectionIds?.length > 1,
    "de gebouwde ligger rekent verlopend");
  const reden = bepaalVerloop("S235", "IPE 500", "CHS 168.3x8").reden;
  ok(typeof reden === "string" && reden.length > 0, "bepaalVerloop weigert een buis als eind");
  const buis = await voer("model_3d_bouwen", bouw({ profile_name_end: "CHS 168.3x8" }), acties());
  ok(buis.fout === `3D-staaf 2: ${reden}`, `een buis als eind wordt met de reden van bepaalVerloop geweigerd: ${buis.fout}`);
  const gelijkEind = acties();
  const zelfde = await voer("model_3d_bouwen", bouw({ profile_name_end: "IPE 500" }), gelijkEind);
  ok(!zelfde.fout && !("profileNameEnd" in gelijkEind.openFem3d.model.beams[1]), "een eind gelijk aan het begin geeft geen veld");
  const getal = await voer("model_3d_bouwen", bouw({ profile_name_end: 300 }), acties());
  ok(getal.fout && /ongeldig eindprofiel/.test(getal.fout), `een getal wordt geweigerd: ${getal.fout}`);
}

console.log("\n[10] Opslaan: gelaste tussendoorsneden van 3D-staven in het projectbestand");
{
  // Een gesplitste verlopende stalen staaf: deel 1 verwijst alleen met zijn
  // EINDprofiel naar de tussendoorsnede.
  const knip = splitOpenFem3DBeam(parseOpenFem3DModel(spant(VERLOOP)), 3, 0.6);
  const tussen = knip.model.beams.find((b) => b.id === knip.firstBeamId).profileNameEnd;
  ok(tussen.startsWith("EIGEN:") && zoekEigenDoorsnede(tussen) !== undefined, "de knip laat een bewaarde tussendoorsnede achter");
  const naam = tussen.slice("EIGEN:".length);
  const alleenEind = {
    ...knip.model,
    beams: knip.model.beams.map((b) => {
      if (b.id !== knip.secondBeamId) return b;
      const { profileNameEnd: _eind, ...rest } = b;
      return { ...rest, profileName: "IPE 300" };
    }),
  };
  const namen = (lijst) => json(lijst.map((d) => d.naam));
  ok(namen(gebruikteEigenDoorsneden({ beams: [], modelDimension: "3d", model3d: alleenEind })) === json([naam]),
    "een 3D-model met de tussendoorsnede alleen als eindprofiel geeft die doorsnede mee");
  ok(gebruikteEigenDoorsneden({ beams: [], modelDimension: "2d", model3d: alleenEind }).length === 0,
    "in 2D-stand (geen model3d in het bestand) niet");
  ok(namen(gebruikteEigenDoorsneden({ beams: [], model3d: alleenEind })) === json([naam]),
    "zonder modelDimension telt de aanwezigheid van model3d, zoals serializeProject");
  ok(namen(gebruikteEigenDoorsneden({ beams: [{ profile: "IPE 200", profileEnd: tussen }], modelDimension: "2d" })) === json([naam]),
    "2D-staven tellen altijd mee (ook hun eindprofiel)");
  ok(gebruikteEigenDoorsneden({ beams: [], modelDimension: "3d", model3d: parseOpenFem3DModel(spant(VERLOOP)) }).length === 0,
    "een verloop tussen catalogusprofielen draagt geen eigen doorsnede mee");
  // Heen en terug: het projectbestand draagt de doorsnede.
  const bestand = serializeProject({
    modelDimension: "3d", nodes: [], beams: [], supports: [], plates: [], loads: [], loadCases: [], model3d: alleenEind,
    eigenDoorsneden: gebruikteEigenDoorsneden({ beams: [], modelDimension: "3d", model3d: alleenEind }),
  });
  ok(deserializeProject(bestand).eigenDoorsneden?.some((d) => d.naam === naam), "het projectbestand draagt de tussendoorsnede");
  // De app-lijm: Opslaan gebruikt dezelfde regel, en de wizard Stalen hal zet
  // zijn tussendoorsneden in de bibliotheek vóór hij de staven toepast.
  const app = readFileSync(fileURLToPath(new URL("./src/App.tsx", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  const snapshot = app.slice(app.indexOf("const buildProjectSnapshot = useCallback"), app.indexOf("const modelJson = useCallback"));
  ok(snapshot.includes("eigenDoorsneden: gebruikteEigenDoorsneden({ beams: fem.beams, modelDimension, model3d: openFem3d }),"),
    "App.buildProjectSnapshot: de eigen doorsneden via gebruikteEigenDoorsneden, met de 3D-staven");
  const toepassen = app.slice(app.indexOf("const pasStaalhalToe = useCallback"));
  const importPlek = toepassen.indexOf("importeerEigenDoorsneden(hal.eigenDoorsneden)");
  ok(importPlek > 0 && importPlek < toepassen.indexOf("femRef.current"),
    "App.pasStaalhalToe: de tussendoorsneden van de hal eerst in de bibliotheek");
}

console.log("\n[11] rekenen via de 3D-kern");
const solverBinary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${solverBinary}`, import.meta.url));
const reken = (request) => new Promise((resolve, reject) => {
  const child = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  const uit = [], fout = [];
  child.stdout.on("data", (d) => uit.push(d));
  child.stderr.on("data", (d) => fout.push(d));
  child.on("error", reject);
  child.on("close", () => {
    try { resolve(JSON.parse(Buffer.concat(uit).toString())); }
    catch (error) { reject(new Error(`${error.message}; ${Buffer.concat(fout).toString().slice(0, 400)}`)); }
  });
  child.stdin.end(JSON.stringify(request));
});
assert.ok(existsSync(solverPath), `Bouw eerst de 3D-kern (${solverPath}: cargo build -p open-fem-3d) of zet OPEN_FEM_3D_SOLVER_PATH.`);
{
  // Uitkrager IPE 400 → IPE 200, L = 6 m, eindlast P = 10 kN omlaag. De kern
  // rekent per deel met de doorsnede van het midden; de 2D-solver doet
  // hetzelfde met dezelfde 20 delen. De zakking aan het eind uit de som over
  // de delen (virtuele arbeid, Euler-Bernoulli, alleen buiging):
  //   w = Σ_i ∫ M·m/(E·I_i) dx met M = P·(L − x), m = (L − x).
  const L = 6, P = 10, E = 210_000e3; // kN/m²
  const model = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 400", profileNameEnd: "IPE 200", material: "S235" }],
    supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
    loads: [{ id: 1, nodeId: 2, fx: 0, fy: 0, fz: -P, mx: 0, my: 0, mz: 0 }],
  });
  const request = { ...buildOpenFem3DSolveRequest(model, "linear"), bucklingModes: 0 };
  const result = await reken(request);
  // Een oude bouw kent partSectionIds niet en weigert het veld: dat is een fout, geen overslaan.
  assert.ok(!result.fout, `de 3D-kern op ${solverPath} weigert het verzoek (oude bouw?): ${result.fout}`);
  {
    const v = bepaalVerloop("S235", "IPE 400", "IPE 200").verloop;
    let w = 0;
    for (const s of segmentenVoorVerloop(v, L * 1000)) {
      const a = s.tStart * L, b = s.tEnd * L;
      // ∫ (L − x)² dx van a tot b
      w += P * ((L - a) ** 3 - (L - b) ** 3) / 3 / (E * s.I * 1e-12);
    }
    const uz = result.displacements.find((d) => d.nodeId === 2).uz;
    // De app geeft geen afschuifoppervlak mee: de kern rekent Euler-Bernoulli,
    // en voor de getrapte staaf is de som over de delen exact (afronding).
    gelijk(-uz, w, "zakking aan het eind = Σ over de delen (exact voor de getrapte staaf)", 1e-12);
    const prisma = await reken({ ...buildOpenFem3DSolveRequest(parseOpenFem3DModel({ ...model, beams: [{ ...model.beams[0], profileNameEnd: undefined }] }), "linear"), bucklingModes: 0 });
    ok(Math.abs(prisma.displacements.find((d) => d.nodeId === 2).uz) < Math.abs(uz), "de verlopende uitkrager zakt meer dan een prismatische IPE 400");
    const my = result.memberForces[0].myStartKnm;
    gelijk(Math.abs(my), P * L, "inklemmingsmoment P·L op de ene modelstaaf (de delen zijn samengevoegd)", 1e-12);
    ok(result.memberForces.length === 1 && result.displacements.every((d) => d.nodeId === 1 || d.nodeId === 2),
      "één staaf terug, en alleen de modelknopen (geen grensknopen van de delen)");
  }
}

{
  // Echte brug: een GL24h-uitkrager krijgt E_mean voor buiging en G_mean
  // voor torsie. Bij ν = 0 zou een isotrope kern G = E/2 = 5750 MPa nemen.
  const L = 2, T = 1;
  const model = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "100x200", material: "GL24h" }],
    supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
    loads: [{ id: 1, nodeId: 2, fx: 0, fy: 0, fz: -1, mx: T, my: 0, mz: 0 }],
  });
  const request = { ...buildOpenFem3DSolveRequest(model, "linear"), bucklingModes: 0 };
  const result = await reken(request);
  assert.ok(!result.fout, `GL24h moet in de 3D-kern oplossen: ${result.fout}`);
  const j = request.sections[0].torsionJM4;
  const end = result.displacements.find((d) => d.nodeId === 2);
  gelijk(end.rx, T * L / (650e3 * j), "houttorsie gebruikt G_mean van GL24h", 1e-10);
  const iy = request.sections[0].iyM4;
  gelijk(-end.uz, L ** 3 / (3 * 11500e3 * iy), "houtbuiging gebruikt E_mean van GL24h", 1e-10);
  const checks = buildOpenFem3DTimberCheckInputs(model, result);
  ok(checks.inputs.length === 1 && checks.skipped.length === 0, "GL24h krijgt een 3D-houttoetsinvoer");
  ok(checks.inputs[0].forces_envelope.some((p) => Math.abs(p.forces.mt_ed) > 0.99),
    "de 3D-houtbouwer neemt torsie op de solverstations mee");
  ok(checks.inputs[0].deflection_inst_mm < 0 && checks.inputs[0].deflection_quasi_perm_mm < 0,
    "de BGT-zakkingen houden het teken dat de houtkern verwacht");
  ok(checks.inputs[0].ltb_load_case === "CantileverConcentratedEnd",
    "de uitkraging met eindlast kiest de juiste tabelrij voor kip");
  const toetsbrugBinary = process.platform === "win32" ? "toetsbrug.exe" : "toetsbrug";
  const toetsbrugPath = process.env.TOETSBRUG_PATH
    ?? fileURLToPath(new URL(`../src-tauri/target/release/${toetsbrugBinary}`, import.meta.url));
  assert.ok(existsSync(toetsbrugPath), `Bouw eerst de toetsbrug (${toetsbrugPath}: cargo build --release -p toetsbrug).`);
  const antwoord = spawnSync(toetsbrugPath, [], {
    input: JSON.stringify({ opdracht: "check_timber_beams", inputs: checks.inputs }),
    encoding: "utf8", maxBuffer: 64 << 20,
  });
  assert.equal(antwoord.status, 0, `3D-houttoets via toetsbrug faalde: ${antwoord.stdout || antwoord.stderr}`);
  const [hout] = JSON.parse(antwoord.stdout);
  ok(hout.beam_id === 1 && hout.checks.some((check) => check.id === "6.1.8_torsion" && check.kind.data.uc?.uc > 0),
    "de echte houtkern toetst torsie uit de 3D-solver");
  const kolom = hout.checks.find((check) => check.id === "6.3.2_column_stability");
  ok(kolom?.kind.data.notes.join(" ").includes("2 × staaflengte"),
    "de echte houtkern gebruikt 2L voor de vrije uitkraging");
  ok(hout.checks.find((check) => check.id === "deflection_w_fin")?.kind.data.status === "NotApplicable",
    "zonder BGT-combinaties geeft de echte houtkern geen schijnbaar geslaagde zakkingstoets");
}

console.log(`\n${geslaagd} geslaagd, 0 gefaald`);

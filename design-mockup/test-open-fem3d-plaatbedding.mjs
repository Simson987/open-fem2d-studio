// Plaat op bedding in 3D (issue #107), de app-kant:
//  1. het model: lezen en keuren (k positief en eindig, alleen druk true of
//     false, geen tikfout in een veld); oude bestanden zonder het veld blijven
//     gelijk;
//  2. zetten en weghalen op één of meer platen als één stap ongedaan maken,
//     ook via plaat toevoegen en wijzigen;
//  3. het projectbestand: heen en terug, en versie 7 alleen voor een bestand
//     met een plaat op bedding (een uitgave van versie 5 of 6 zou het veld stil
//     overslaan en zonder grond rekenen);
//  4. de verzoekopbouw: `bedding` op Plate3D volgens het contract, alleen bij
//     platen op bedding; grondveren tellen als oplegging;
//  5. het tributaire oppervlak per meshknoop (consistent, ∫N_i dA): samen het
//     plaatoppervlak min de openingen;
//  6. de uitkomst: gronddruk en zakking als plaatgrootheid (waarden, bereik,
//     extremen), de rapportregels, de contour met contact en geen contact, en
//     de onafhankelijke krachtensom met de grondveren;
//  7. de arcering onder de plaat (aan de kant van de grond, in de drie
//     plaatweergaven van #78, met de opening uitgespaard), en de grondzijde in
//     woorden: bij een wand ligt die vast door de plaatassen (+Y voor een wand
//     in het XZ-vlak, −X in het YZ-vlak);
//  8. het bedieningskanaal (model_3d_bouwen) met `plates[].bedding`;
//  9. rekenen via de echte 3D-kern (OPEN_FEM_3D_SOLVER_PATH of de debugbouw)
//     door de rekenweg van de app: een vrije vloer onder een gelijkmatige last
//     zakt overal q/k (geen buiging, Σ veerkrachten = q·A), ook een
//     niet-rechthoekige vloer die de app in scheve vierhoeken meshet (waar
//     ∫N_i dA niet A/4 is), en alleen druk laat een lange strook onder een
//     eindlast aan het andere eind los (liftedFraction is het aandeel van het
//     oppervlak zonder contact, niet van de knopen). Kent
//     de kern `plates[].bedding` niet (een oude bouw), dan faalt de proef met
//     die melding.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import {
  addOpenFem3DPlate, parseOpenFem3DModel, readOpenFem3DPlateBedding, setOpenFem3DPlateBedding, updateOpenFem3DPlate,
} from "./src/components/openFem3d/openFem3dModel.ts";
import { openFem3dHistoryReducer } from "./src/components/openFem3d/openFem3dHistory.ts";
import { meshOpenFem3DPlates } from "./src/components/openFem3d/openFem3dPlateMesh.ts";
import { buildOpenFem3DSolveRequest, openFem3DGlobalForceBalance, solveOpenFem3D } from "./src/components/openFem3d/openFem3dSolver.ts";
import {
  OPEN_FEM_3D_PLATE_BEDDING_DEFAULT_K_KN_PER_M3, openFem3DPlateAxisZ, openFem3DPlateBeddingResultOf,
  openFem3DPlateBeddingSummary, openFem3DPlateBeddingTributaryAreas, openFem3DPlateGroundDirection, openFem3DPlateGroundSide,
} from "./src/components/openFem3d/openFem3dPlateBedding.ts";
import {
  OPEN_FEM_3D_PLATE_QUANTITIES, openFem3DPlateExtremes, openFem3DPlateQuantitiesFor, openFem3DPlateQuantity,
  openFem3DPlateQuantityRange, openFem3DPlateQuantityValues,
} from "./src/components/openFem3d/openFem3dPlateResults.ts";
import { buildOpenFem3DPlateOverlay } from "./src/components/openFem3d/openFem3dPlateOverlay.ts";
import {
  OPEN_FEM_3D_PLATE_BEDDING_NAME, openFem3DPlateBeddingHatchShapes,
} from "./src/components/openFem3d/openFem3dPlateBeddingHatch.ts";
import { OPEN_FEM_3D_BEDDING_DEFAULT_K_KN_PER_M3 } from "./src/components/openFem3d/openFem3dBedding.ts";
import {
  PROJECT_FORMAT_VERSION_3D_BEDDING, PROJECT_FORMAT_VERSION_3D_PLATE_BEDDING, PROJECT_FORMAT_VERSION_MAX,
  deserializeProject, serializeProject,
} from "./src/io/projectFile.ts";

// Componenten importeren stylesheets (het bedieningskanaal); Node kent die niet. Een lege module volstaat.
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function load(url, ctx, next) {" +
        " if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };" +
        " return next(url, ctx); }",
    ),
);

const stil = console.log;
// TriangleService logt elke aanroep; houd de testuitvoer leesbaar.
console.log = (...args) => { if (!String(args[0] ?? "").startsWith("[TriangleService]")) stil(...args); };

let geslaagd = 0;
const ok = (waar, naam) => { assert.ok(waar, naam); geslaagd++; stil(`  ✓ ${naam}`); };
const gelijk = (werkelijk, verwacht, naam, relatief = 1e-9, absoluut = 1e-9) => {
  const verschil = Math.abs(werkelijk - verwacht);
  assert.ok(Number.isFinite(werkelijk) && verschil <= Math.max(absoluut, Math.abs(verwacht) * relatief),
    `${naam}: berekend ${werkelijk}, verwacht ${verwacht} (verschil ${verschil})`);
  geslaagd++;
  stil(`  ✓ ${naam}`);
};
const weigert = (f, patroon, naam) => {
  assert.throws(f, patroon, naam);
  geslaagd++;
  stil(`  ✓ ${naam}`);
};
const json = (waarde) => JSON.stringify(waarde);

/**
 * Een vloer van 4 × 2 m (plaat 1, op z = 0) en een wand van 4 × 3 m langs X
 * op y = 2 (plaat 2, geen bedding), met een knoopoplegging in het vlak.
 */
const knopen = [
  { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }, { id: 3, x: 4, y: 2, z: 0 }, { id: 4, x: 0, y: 2, z: 0 },
  { id: 5, x: 4, y: 2, z: 3 }, { id: 6, x: 0, y: 2, z: 3 },
];
const basis = (vloer = {}, wand = {}) => ({
  nodes: knopen,
  beams: [],
  plates: [
    { id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.25, material: "C30/37", meshSizeM: 1, ...vloer },
    { id: 2, nodeIds: [4, 3, 5, 6], thicknessM: 0.2, material: "C30/37", meshSizeM: 1, ...wand },
  ],
  supports: [
    { nodeId: 1, ux: true, uy: true, uz: false, rx: false, ry: false, rz: false },
    { nodeId: 2, ux: false, uy: true, uz: false, rx: false, ry: false, rz: false },
  ],
  surfaceLoads: [{ id: 1, plateId: 1, caseId: 1, qx: 0, qy: 0, qz: -10 }],
});
const grond = { kKnPerM3: 20_000 };

console.log("[1] het model: lezen en keuren");
{
  const oud = parseOpenFem3DModel(basis());
  ok(oud.plates.every((plate) => !("bedding" in plate)), "een bestand zonder bedding: geen veld");
  ok(json(parseOpenFem3DModel(JSON.parse(json(oud)))) === json(oud), "zonder bedding verandert heen en terug niets");
  const model = parseOpenFem3DModel(basis({ bedding: { ...grond, compressionOnly: false } }));
  ok(json(model.plates[0].bedding) === json(grond), "k blijft staan; compressionOnly false wordt niet bewaard");
  const druk = parseOpenFem3DModel(basis({ bedding: { compressionOnly: true, kKnPerM3: 30_000 } }));
  ok(json(druk.plates[0].bedding) === json({ kKnPerM3: 30_000, compressionOnly: true }), "alleen druk blijft staan, in vaste volgorde");
  ok(json(parseOpenFem3DModel(JSON.parse(json(druk)))) === json(druk), "met bedding verandert heen en terug niets");
  ok(!("bedding" in parseOpenFem3DModel(basis({ bedding: null })).plates[0]), "null in een bestand: geen bedding");
  const fout = (bedding, patroon, naam) => weigert(() => parseOpenFem3DModel(basis({ bedding })), patroon, naam);
  fout({ kKnPerM3: 0 }, /3D-plaat 1: de beddingsconstante k \(kN\/m³\) moet een eindig getal groter dan 0 zijn/, "k = 0 wordt geweigerd");
  fout({ kKnPerM3: -5 }, /groter dan 0/, "k < 0 wordt geweigerd");
  fout({ kKnPerM3: Number.NaN }, /eindig getal/, "k = NaN wordt geweigerd");
  fout({ kKnPerM3: Infinity }, /eindig getal/, "k = oneindig wordt geweigerd");
  fout({ kKnPerM3: "20000" }, /eindig getal/, "k als tekst wordt geweigerd");
  fout({}, /3D-plaat 1: de bedding mist de beddingsconstante k \(kKnPerM3, in kN\/m³\)/, "zonder k geweigerd");
  fout({ compressionOnly: true }, /mist de beddingsconstante/, "alleen druk zonder k geweigerd");
  fout({ kKnPerm3: 20_000 }, /3D-plaat 1: onbekend veld in de bedding: kKnPerm3\. Toegestaan: kKnPerM3, compressionOnly/,
    "een tikfout in een veldnaam wordt geweigerd, niet genegeerd");
  fout({ kKnPerM3: 20_000, widthM: 1 }, /onbekend veld in de bedding: widthM/, "de breedte van de staafbedding hoort niet bij een plaat");
  fout({ ...grond, compressionOnly: "ja" }, /compressionOnly\) moet true of false zijn/, "alleen druk als tekst geweigerd");
  fout(20_000, /3D-plaat 1: de bedding moet een object zijn/, "een getal in plaats van een object geweigerd");
  fout([grond], /moet een object zijn/, "een lijst in plaats van een object geweigerd");
  ok(json(readOpenFem3DPlateBedding({ kKnPerM3: 1e5, compressionOnly: true }, "proef")) === json({ kKnPerM3: 1e5, compressionOnly: true }),
    "readOpenFem3DPlateBedding geeft de vaste vorm");
  ok(OPEN_FEM_3D_PLATE_BEDDING_DEFAULT_K_KN_PER_M3 === OPEN_FEM_3D_BEDDING_DEFAULT_K_KN_PER_M3
    && OPEN_FEM_3D_PLATE_BEDDING_DEFAULT_K_KN_PER_M3 === 50_000, "standaard k zoals de staafbedding: 50 000 kN/m³");
}

console.log("\n[2] zetten en weghalen, één stap ongedaan maken");
{
  const model = parseOpenFem3DModel(basis());
  const aan = setOpenFem3DPlateBedding(model, [1], { ...grond, compressionOnly: true });
  ok(json(aan.plates[0].bedding) === json({ ...grond, compressionOnly: true }), "zetten op één plaat");
  ok(aan.plates[1] === model.plates[1] && aan.nodes === model.nodes, "de andere plaat en de knopen blijven dezelfde objecten");
  ok(setOpenFem3DPlateBedding(aan, [1], { compressionOnly: true, ...grond }) === aan, "dezelfde bedding opnieuw: hetzelfde model");
  const uit = setOpenFem3DPlateBedding(aan, [1], null);
  ok(!("bedding" in uit.plates[0]), "null haalt de bedding weg");
  ok(setOpenFem3DPlateBedding(model, [1], null) === model, "weghalen waar niets is: hetzelfde model");
  const beide = setOpenFem3DPlateBedding(model, [1, 2], grond);
  ok(beide.plates.every((plate) => json(plate.bedding) === json(grond)), "twee platen in één keer (ook een wand)");
  let historie = { model, past: [], future: [] };
  historie = openFem3dHistoryReducer(historie, { type: "edit", model: beide });
  ok(historie.past.length === 1, "één stap in de geschiedenis");
  historie = openFem3dHistoryReducer(historie, { type: "undo" });
  ok(historie.model === model && model.plates.every((plate) => !plate.bedding), "ongedaan maken haalt beide weg");
  weigert(() => setOpenFem3DPlateBedding(model, [9], grond), /3D-plaat 9 bestaat niet/, "een onbekende plaat");
  weigert(() => setOpenFem3DPlateBedding(model, [1], { kKnPerM3: 0 }), /3D-plaat 1: de beddingsconstante k/, "een ongeldige k");
  ok(model.plates.every((plate) => !plate.bedding), "na een weigering is het model onveranderd");
  // Plaat wijzigen en toevoegen gebruiken dezelfde keuring.
  const via = updateOpenFem3DPlate(model, 1, { bedding: grond });
  ok(json(via.plates[0].bedding) === json(grond), "updateOpenFem3DPlate zet de bedding");
  ok(!("bedding" in updateOpenFem3DPlate(via, 1, { bedding: null }).plates[0]), "updateOpenFem3DPlate met null haalt haar weg");
  ok(json(updateOpenFem3DPlate(via, 1, { thicknessM: 0.3 }).plates[0].bedding) === json(grond), "een andere wijziging laat de bedding staan");
  weigert(() => updateOpenFem3DPlate(model, 1, { bedding: { kKnPerM3: -1 } }), /groter dan 0/, "updateOpenFem3DPlate keurt de bedding");
  const erbij = addOpenFem3DPlate(model, [1, 2, 5, 6], { thicknessM: 0.2, bedding: { kKnPerM3: 10_000, compressionOnly: true } });
  ok(json(erbij.plates.at(-1).bedding) === json({ kKnPerM3: 10_000, compressionOnly: true }), "addOpenFem3DPlate met bedding");
  weigert(() => addOpenFem3DPlate(model, [1, 2, 5, 6], { bedding: { k: 1 } }), /onbekend veld in de bedding: k\./, "addOpenFem3DPlate keurt de bedding");
}

console.log("\n[3] het projectbestand");
{
  const project = (model3d) => ({
    nodes: [], beams: [], supports: [], plates: [], loads: [], loadCases: [{ id: 1, name: "G", type: "dead" }],
    modelDimension: "3d", model3d,
  });
  const met = parseOpenFem3DModel(basis({ bedding: { ...grond, compressionOnly: true } }));
  const terug = deserializeProject(serializeProject(project(met))).model3d;
  ok(json(terug.plates[0].bedding) === json(met.plates[0].bedding), "heen en terug: de bedding blijft gelijk");
  const zonder = parseOpenFem3DModel(basis());
  const tekst = serializeProject(project(zonder));
  ok(!tekst.includes("bedding") && JSON.parse(tekst).version === 3, "zonder bedding: geen veld en dezelfde versie als voorheen");
  const bestand = JSON.parse(tekst);
  bestand.model3d.plates[0].bedding = { kKnPerM3: -1 };
  weigert(() => deserializeProject(JSON.stringify(bestand)), /3D-plaat 1: de beddingsconstante k/, "een bestand met een ongeldige plaatbedding wordt geweigerd");
  // Een uitgave van versie 5 (staaf op bedding, #106) of 6 (verlopende staven, #73) kent de plaatbedding
  // niet: zij zou het veld stil overslaan en de vloer zonder grond rekenen. Met een plaat op bedding dus versie 7.
  ok(PROJECT_FORMAT_VERSION_3D_PLATE_BEDDING === 7 && PROJECT_FORMAT_VERSION_3D_BEDDING === 5
    && PROJECT_FORMAT_VERSION_MAX >= 7, "versie 7 voor de plaatbedding blijft leesbaar");
  ok(JSON.parse(serializeProject(project(met))).version === 7, "met een plaat op bedding: versie 7");
  const staafEnPlaat = { ...met, nodes: [...met.nodes, { id: 7, x: 0, y: -2, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 7, profileName: "HEB 300", material: "S235", bedding: { kKnPerM3: 50_000, widthM: 0.6 } }] };
  ok(JSON.parse(serializeProject(project(parseOpenFem3DModel(staafEnPlaat)))).version === 7, "plaat- en staafbedding samen: versie 7");
  const verloopEnPlaat = { ...staafEnPlaat, beams: staafEnPlaat.beams.map(({ bedding: _b, ...b }) => ({ ...b, profileNameEnd: "HEB 400" })) };
  ok(JSON.parse(serializeProject(project(parseOpenFem3DModel(verloopEnPlaat)))).version === 7, "plaatbedding en een verlopende staaf samen: versie 7");
  const alleenStaaf = parseOpenFem3DModel({ ...staafEnPlaat, plates: zonder.plates });
  ok(JSON.parse(serializeProject(project(alleenStaaf))).version === 5, "alleen een staaf op bedding: versie 5 zoals voorheen");
  ok(JSON.parse(serializeProject(project({ ...met, loadPanels: [] }))).version === 7, "plaatbedding gaat boven de versie van de belastingvlakken");
  ok(JSON.parse(serializeProject(project(setOpenFem3DPlateBedding(met, [1], null)))).version === 3, "bedding weer weg: terug naar versie 3");
  const versie7 = serializeProject(project(met));
  ok(json(deserializeProject(versie7).model3d.plates[0].bedding) === json(met.plates[0].bedding), "een bestand van versie 7 leest terug");
  const nieuwer = PROJECT_FORMAT_VERSION_MAX + 1;
  weigert(() => deserializeProject(JSON.stringify({ ...JSON.parse(versie7), version: nieuwer })),
    new RegExp(`nieuwere versie \\(${nieuwer}\\)`), `versie ${nieuwer} wordt geweigerd`);
}

console.log("\n[4] de verzoekopbouw");
const model = parseOpenFem3DModel(basis({ bedding: { ...grond, compressionOnly: true } }));
const mesh = await meshOpenFem3DPlates(model);
{
  const verzoek = buildOpenFem3DSolveRequest(model, "linear", 1, mesh);
  const plaat = (id) => verzoek.plates.find((plate) => plate.id === id);
  ok(json(plaat(1)) === json({ id: 1, materialId: plaat(1).materialId, thicknessM: 0.25, bedding: { kKnPerM3: 20_000, compressionOnly: true } }),
    "de vloer: k en alleen druk op Plate3D");
  ok(!("bedding" in plaat(2)), "een plaat zonder bedding krijgt geen veld (een oudere kern rekent dan precies als voorheen)");
  const zonderDruk = buildOpenFem3DSolveRequest(setOpenFem3DPlateBedding(model, [1], grond), "linear", 1, mesh);
  ok(json(zonderDruk.plates[0].bedding) === json({ kKnPerM3: 20_000 }), "zonder alleen druk: alleen k");
  // Grondveren tellen als oplegging, zoals in de kern: zonder knoopoplegging gaat het verzoek naar de kern.
  ok(buildOpenFem3DSolveRequest({ ...model, supports: [] }, "linear", 1, mesh).supports.length === 0,
    "op bedding zonder oplegging: het verzoek gaat naar de kern (de kern keurt het mechanisme)");
  weigert(() => buildOpenFem3DSolveRequest(parseOpenFem3DModel({ ...basis(), supports: [] }), "linear", 1, mesh),
    /minstens één 3D-oplegging/, "zonder bedding en zonder oplegging: nog steeds geweigerd");
  // Een model in het geheugen dat niet door de keuring ging: de melding komt vóór de kern.
  const ongekeurd = { ...model, plates: model.plates.map((plate) => plate.id === 1 ? { ...plate, bedding: { kKnPerM3: 0 } } : plate) };
  weigert(() => buildOpenFem3DSolveRequest(ongekeurd, "linear", 1, mesh), /3D-plaat 1: de beddingsconstante k/,
    "een ongeldige plaatbedding wordt vóór de kern geweigerd");
}

console.log("\n[5] het tributaire oppervlak per meshknoop");
const plaatPositie = (net, model) => {
  const posities = new Map([...model.nodes, ...net.nodes].map((node) => [node.id, [node.x, node.y, node.z]]));
  return (id) => posities.get(id);
};
{
  const elementen = mesh.elements.filter((element) => element.plateId === 1);
  ok(elementen.length === 8, `de vloer van 4 × 2 m met elementen van 1 m: 8 vierhoeken (${elementen.length})`);
  const oppervlakken = openFem3DPlateBeddingTributaryAreas(elementen, plaatPositie(mesh, model));
  const som = [...oppervlakken.values()].reduce((a, b) => a + b, 0);
  gelijk(som, 8, "Σ A_trib = plaatoppervlak 8 m²");
  gelijk(oppervlakken.get(1), 0.25, "hoekknoop: een kwart element");
  const rand = [...oppervlakken.entries()].filter(([, a]) => Math.abs(a - 0.5) < 1e-12).length;
  const binnen = [...oppervlakken.entries()].filter(([, a]) => Math.abs(a - 1) < 1e-12).length;
  ok(oppervlakken.size === 15 && rand === 8 && binnen === 3, `rand 0,5 m² (${rand}×), binnen 1 m² (${binnen}×)`);
  // Een scheve vierhoek: Σ ∫N_i dA = het oppervlak, en bij een parallellogram elk een kwart.
  const scheef = new Map([[1, [0, 0, 0]], [2, [2, 0, 0]], [3, [3, 2, 0]], [4, [0, 1, 0]]]);
  const a = openFem3DPlateBeddingTributaryAreas([{ id: 1, plateId: 1, nodeIds: [1, 2, 3, 4] }], (id) => scheef.get(id));
  gelijk([...a.values()].reduce((x, y) => x + y, 0), 3.5, "scheve vierhoek: Σ = oppervlak 3,5 m²");
  ok(a.get(3) > a.get(4), "de knoop in de ruimste hoek draagt meer dan die in de krapste");
  const parallel = new Map([[1, [0, 0, 0]], [2, [2, 0, 0]], [3, [3, 1, 1]], [4, [1, 1, 1]]]);
  const p = openFem3DPlateBeddingTributaryAreas([{ id: 1, plateId: 1, nodeIds: [1, 2, 3, 4] }], (id) => parallel.get(id));
  ok([...p.values()].every((waarde) => Math.abs(waarde - 2 * Math.SQRT2 / 4) < 1e-12), "parallellogram (schuin in de ruimte): elk een kwart");
  // Met een opening: Σ = plaat min opening.
  const metGat = parseOpenFem3DModel({
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }, { id: 3, x: 4, y: 4, z: 0 }, { id: 4, x: 0, y: 4, z: 0 },
      { id: 5, x: 1, y: 1, z: 0 }, { id: 6, x: 3, y: 1, z: 0 }, { id: 7, x: 3, y: 2, z: 0 }, { id: 8, x: 1, y: 2, z: 0 },
    ],
    beams: [],
    plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2, meshSizeM: 0.5, openings: [{ id: 1, nodeIds: [5, 6, 7, 8] }], bedding: grond }],
  });
  const gatNet = await meshOpenFem3DPlates(metGat);
  const gat = openFem3DPlateBeddingTributaryAreas(gatNet.elements, plaatPositie(gatNet, metGat));
  gelijk([...gat.values()].reduce((x, y) => x + y, 0), 16 - 2, "met een opening van 2 m²: Σ = 14 m²", 1e-9);
}

console.log("\n[6] de uitkomst: gronddruk, zakking, contour, rapport en krachtensom");
// Een nep-uitkomst van de kern: zakking lineair in x, s = 2,5 − x mm (x = 0 … 4 m); waar s < 0 komt de vloer los
// (x = 3 en 4 m: zes knopen). De gronddruk k·s = 20·s kN/m² met s in mm: 50, 30 en 10 kN/m².
const k = 20_000;
const verzoek = buildOpenFem3DSolveRequest(model, "linear", 1, mesh);
const knoopVan = new Map(verzoek.nodes.map((node) => [node.id, node]));
const vloerKnopen = [...new Set(mesh.elements.filter((e) => e.plateId === 1).flatMap((e) => e.nodeIds))].sort((a, b) => a - b);
const wandKnopen = [...new Set(mesh.elements.filter((e) => e.plateId === 2).flatMap((e) => e.nodeIds))].sort((a, b) => a - b);
const zakkingMm = (id) => 2.5 - knoopVan.get(id).x;
const beddingKnopen = vloerKnopen.map((nodeId) => {
  const s = zakkingMm(nodeId);
  return { nodeId, settlementM: s / 1000, pressureKnPerM2: s > 0 ? 20 * s : 0, active: s > 0 };
});
const schaal = (id, plateId) => ({
  nodeId: id, plateId, wM: 0, nxxKnPerM: 0, nyyKnPerM: 0, nxyKnPerM: 0, mxxKnmPerM: plateId, myyKnmPerM: 0, mxyKnmPerM: 0,
  sigmaXxTopMpa: 0, sigmaYyTopMpa: 0, tauXyTopMpa: 0, vonMisesTopMpa: 0, sigmaXxBottomMpa: 0, sigmaYyBottomMpa: 0, tauXyBottomMpa: 0, vonMisesBottomMpa: 0,
});
const plaatBedding = {
  plateId: 1, nodes: beddingKnopen, maxPressureKnPerM2: 50, minPressureKnPerM2: 0, maxSettlementM: 0.0025, totalReactionKn: 37.5, liftedFraction: 0.375,
};
const nepUitkomst = (extra = {}) => ({
  schemaVersion: 2, engine: { id: "open-fem-3d", name: "Open FEM 3D", revision: "test", license: "AGPL-3.0" }, analysis: "linear",
  displacements: verzoek.nodes.map((node) => ({ nodeId: node.id, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 })),
  reactions: [], memberForces: [], buckling: { status: "notApplicable", reason: "test" }, diagnostics: [],
  plates: [1, 2].map((plateId) => ({
    plateId, axes: plateId === 1 ? { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] } : { x: [1, 0, 0], y: [0, 0, 1], z: [0, -1, 0] },
    elementCount: 8, nodeCount: 15, areaM2: 8, loadResultantKn: [0, 0, 0],
    extremes: [{ quantity: "mxxKnmPerM", min: plateId, minNodeId: 1, max: plateId, maxNodeId: 1 }],
  })),
  shellNodes: [...vloerKnopen.map((id) => schaal(id, 1)), ...wandKnopen.map((id) => schaal(id, 2))],
  plateMesh: mesh,
  plateBedding: [plaatBedding],
  ...extra,
});
{
  const uitkomst = nepUitkomst();
  ok(openFem3DPlateBeddingResultOf(uitkomst, 1) === plaatBedding && openFem3DPlateBeddingResultOf(uitkomst, 2) === undefined
    && openFem3DPlateBeddingResultOf(null, 1) === undefined, "de uitkomst per plaat");
  // Plaatgrootheden: Gronddruk (kN/m²) en Zakking (mm, positief in de grond), uit plateBedding.
  const druk = openFem3DPlateQuantity("groundPressure"), zak = openFem3DPlateQuantity("settlement");
  ok(druk.unit === "kN/m²" && zak.unit === "mm", "eenheden: kN/m² en mm");
  ok(OPEN_FEM_3D_PLATE_QUANTITIES.at(-2).key === "groundPressure" && OPEN_FEM_3D_PLATE_QUANTITIES.at(-1).key === "settlement",
    "de twee grootheden achteraan, na de bestaande");
  const waarden = openFem3DPlateQuantityValues(uitkomst, "groundPressure", 1);
  ok(waarden.size === 15 && waarden.get(1) === 50 && waarden.get(2) === 0, "gronddruk per knoop: k·s, 0 waar geen contact");
  const zakkingen = openFem3DPlateQuantityValues(uitkomst, "settlement", 1);
  gelijk(zakkingen.get(2), -1.5, "zakking in mm, negatief waar de vloer loskomt");
  ok(openFem3DPlateQuantityValues(uitkomst, "groundPressure", 2).size === 0, "de wand zonder bedding: geen waarden");
  ok(openFem3DPlateQuantityValues(uitkomst, "mxx", 2).get(wandKnopen[0]) === 2, "de bestaande grootheden blijven uit shellNodes komen");
  ok(json(openFem3DPlateQuantityRange(uitkomst, "groundPressure")) === json({ min: 0, max: 50 }), "bereik van de gronddruk");
  const zakBereik = openFem3DPlateQuantityRange(uitkomst, "settlement");
  gelijk(zakBereik.min, -1.5, "bereik van de zakking: kleinste −1,5 mm");
  gelijk(zakBereik.max, 2.5, "bereik van de zakking: grootste 2,5 mm");
  ok(openFem3DPlateQuantityRange(nepUitkomst({ plateBedding: undefined }), "groundPressure") === null, "zonder bedding-uitvoer: geen bereik");
  const keuze = (r) => openFem3DPlateQuantitiesFor(r).map((q) => q.key);
  ok(keuze(uitkomst).includes("groundPressure") && keuze(uitkomst).includes("settlement") && keuze(uitkomst).includes("mxx"),
    "de keuzelijst: met platen op bedding ook Gronddruk en Zakking");
  ok(!keuze(nepUitkomst({ plateBedding: undefined })).includes("groundPressure") && keuze(nepUitkomst({ plateBedding: undefined })).includes("mxx"),
    "zonder platen op bedding: de bestaande grootheden");
  // Extremen in de eigenschappen en het rapport: de bestaande uit de kern, plus gronddruk en zakking.
  const extremen = openFem3DPlateExtremes(uitkomst, 1);
  const extreem = (key) => extremen.find((item) => item.definition.key === key);
  ok(extreem("mxx") && extreem("groundPressure") && extreem("settlement"), "extremen: mxx, gronddruk en zakking");
  ok(extreem("groundPressure").max === 50 && extreem("groundPressure").maxNodeId === 1 && extreem("groundPressure").min === 0,
    "gronddruk: grootste 50 kN/m² op knoop 1, kleinste 0");
  gelijk(extreem("settlement").min, -1.5, "zakking: kleinste −1,5 mm (opgetild)");
  gelijk(extreem("settlement").max, 2.5, "zakking: grootste 2,5 mm");
  ok(!openFem3DPlateExtremes(uitkomst, 2).some((item) => item.definition.key === "groundPressure"), "de wand: geen gronddruk in de extremen");
  // Rapport: per plaat op bedding k, alleen druk, grootste zakking, grootste en kleinste gronddruk, zonder contact.
  const rijen = openFem3DPlateBeddingSummary(model, uitkomst);
  ok(rijen.length === 1 && rijen[0].plateId === 1, "één rapportregel: alleen platen op bedding");
  const r = rijen[0];
  ok(r.kKnPerM3 === 20_000 && r.compressionOnly === true, "invoer in de regel");
  gelijk(r.result.maxSettlementMm, 2.5, "grootste zakking in mm");
  gelijk(r.result.maxPressureKnPerM2, 50, "grootste gronddruk");
  gelijk(r.result.minPressureKnPerM2, 0, "kleinste gronddruk");
  gelijk(r.result.liftedPercent, 37.5, "zonder contact in %");
  gelijk(r.result.totalReactionKn, 37.5, "som van de veerkrachten");
  ok(openFem3DPlateBeddingSummary(model, null)[0].result === null, "zonder uitkomst: alleen de invoer");
  ok(openFem3DPlateBeddingSummary(model, nepUitkomst({ plateBedding: undefined }))[0].result === null, "een kern zonder plaatbedding-uitvoer: alleen de invoer");

  // De contour Gronddruk in het tekenvlak: geen contact grijs, en een stip op elke knoop zonder contact.
  const overlay = (quantity, extra = {}) => buildOpenFem3DPlateOverlay({
    model, mesh: null, result: uitkomst, quantity, showMesh: false, showPlates: true, showSupports: false,
    plateDisplay: "volume", deformation: false, deformationScale: 1, ...extra,
  });
  const contour = overlay("groundPressure");
  const vlakken = contour.group.children.filter((child) => child.userData.openFem3dPlateContour !== undefined);
  ok(contour.contourShown && vlakken.length === 1 && vlakken[0].userData.openFem3dPlateContour === 1,
    "gronddruk: alleen de vloer krijgt een contour (de wand heeft geen bedding)");
  const kleuren = vlakken[0].geometry.getAttribute("color");
  const posities = vlakken[0].geometry.getAttribute("position");
  let grijs = 0, gekleurd = 0;
  for (let i = 0; i < posities.count; i += 1) {
    const [rood, groen, blauw] = [kleuren.getX(i), kleuren.getY(i), kleuren.getZ(i)];
    const neutraal = Math.abs(rood - groen) < 1e-6 && Math.abs(groen - blauw) < 1e-6;
    if (posities.getX(i) > 2 + 1e-9) { if (neutraal) grijs += 1; } else if (!neutraal) gekleurd += 1;
  }
  ok(grijs === 6 && gekleurd === 9, `geen contact (x > 2 m) grijs: ${grijs} van 6 knopen; met contact in kleur: ${gekleurd} van 9`);
  ok(contour.liftedNodes === 6, `zes knopen zonder contact gemarkeerd (${contour.liftedNodes})`);
  const stippen = contour.group.children.find((child) => child.userData.openFem3dPlateLifted === 1);
  ok(stippen && stippen.geometry.getAttribute("position").count === 6, "de stippen liggen op de knopen zonder contact");
  const metZakking = overlay("settlement");
  ok(metZakking.contourShown && metZakking.liftedNodes === 6, "zakking: contour en ook de stippen zonder contact");
  ok(overlay("mxx").liftedNodes === 0, "een andere grootheid: geen stippen");
  ok(!overlay("groundPressure", { result: nepUitkomst({ plateBedding: undefined }) }).contourShown, "zonder bedding-uitvoer: geen contour");

  // Onafhankelijke krachtensom: de grondveer per knoop is p·A_trib langs de plaatnormaal (de kern: k·A·s).
  const oppervlakken = openFem3DPlateBeddingTributaryAreas(mesh.elements.filter((e) => e.plateId === 1), plaatPositie(mesh, model));
  const gelijkmatig = (p, reactions = []) => nepUitkomst({
    reactions,
    plateBedding: [{ ...plaatBedding, nodes: vloerKnopen.map((nodeId) => ({ nodeId, settlementM: p / k, pressureKnPerM2: p, active: true })) }],
  });
  const balans = openFem3DGlobalForceBalance(verzoek, gelijkmatig(10));
  ok(balans.ok, `q = 10 kN/m² op de vloer, gronddruk overal 10 kN/m²: kracht- en momentensom sluiten (${balans.maxImbalanceKn.toExponential(2)} kN, ${balans.maxMomentImbalanceKnm.toExponential(2)} kNm)`);
  const scheef = openFem3DGlobalForceBalance(verzoek, gelijkmatig(9));
  gelijk(scheef.imbalanceKn[2], -8, "met 9 kN/m² blijft 8 kN over (de som telt de grond echt mee)", 1e-9);
  ok(!scheef.ok, "en dan sluit de som niet");
  // Geeft een kern de grondveren óók als reactie op een meshknoop zonder oplegging, dan telt die niet dubbel.
  const dubbel = vloerKnopen.filter((id) => id !== 1 && id !== 2).map((nodeId) => ({ nodeId, fx: 0, fy: 0, fz: 10 * oppervlakken.get(nodeId), mx: 0, my: 0, mz: 0 }));
  ok(openFem3DGlobalForceBalance(verzoek, gelijkmatig(10, dubbel)).ok, "grondveren als reactie op een knoop zonder oplegging: niet dubbel geteld");
  const echt = openFem3DGlobalForceBalance(verzoek, gelijkmatig(10, [{ nodeId: 1, fx: 5, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }]));
  gelijk(echt.imbalanceKn[0], 5, "een reactie op een opgelegde knoop telt wel mee");
}

console.log("\n[7] de arcering onder de plaat");
{
  const maat = 0.4;
  const volume = openFem3DPlateBeddingHatchShapes(model, maat, "volume");
  ok(volume.length === 1 && volume[0].plateId === 1, "alleen de plaat op bedding krijgt een arcering");
  const [vorm] = volume;
  ok(json(vorm.ground.toArray()) === json([0, 0, -1]), "de grond onder de vloer (−Z)");
  gelijk(vorm.offset, 0.125 + 0.15 * maat, "Volume: onder de onderzijde (halve dikte) plus een spleet");
  const vlak = openFem3DPlateBeddingHatchShapes(model, maat, "surface")[0];
  gelijk(vlak.offset, 0.15 * maat, "Vlak: onder het middenvlak");
  gelijk(openFem3DPlateBeddingHatchShapes(model, maat, "mesh")[0].offset, 0.15 * maat, "Mesh: onder het middenvlak");
  ok(vorm.compressionOnly === true, "alleen druk staat in de vorm (de rand gestippeld)");
  const alle = [...vorm.loops.flat(), ...vorm.hatch];
  ok(alle.every((p) => Math.abs(p.z + vorm.offset) < 1e-9), "alles ligt in één vlak onder de vloer");
  ok(vorm.hatch.length >= 2 && vorm.hatch.length % 2 === 0, `arceringslijnen als paren (${vorm.hatch.length / 2})`);
  ok(vorm.hatch.every((p) => p.x > -1e-9 && p.x < 4 + 1e-9 && p.y > -1e-9 && p.y < 2 + 1e-9), "de arcering blijft binnen de plaat");
  // Onder 45° in het plaatvlak.
  for (let i = 0; i < vorm.hatch.length; i += 2) {
    const d = vorm.hatch[i + 1].clone().sub(vorm.hatch[i]);
    assert.ok(Math.abs(Math.abs(d.x) - Math.abs(d.y)) < 1e-9, "45°");
  }
  ok(true, "de arcering staat onder 45°");
  gelijk(openFem3DPlateBeddingHatchShapes(model, 2 * maat, "surface")[0].offset, 2 * vlak.offset, "de spleet volgt de regelaar Opleggingen");
  // De rand langs de omtrek, de grond in: zichtbaar van opzij en schuin van boven.
  gelijk(vorm.skirtDepth, 0.5 * maat, "de rand is even diep als de band onder een staaf op bedding");
  const opRand = (p) => (Math.abs(p.x) < 1e-9 || Math.abs(p.x - 4) < 1e-9) || (Math.abs(p.y) < 1e-9 || Math.abs(p.y - 2) < 1e-9);
  ok(vorm.skirtHatch.length > 0 && vorm.skirtHatch.every((p) => opRand(p) && p.z <= -vorm.offset + 1e-9 && p.z >= -vorm.offset - vorm.skirtDepth - 1e-9),
    `de arcering van de rand ligt langs de omtrek, tussen het grondvlak en ${vorm.skirtDepth.toFixed(2)} m dieper`);
  let opEenVlak = true, onder45 = true;
  for (let i = 0; i < vorm.skirtHatch.length; i += 2) {
    const [p, q] = [vorm.skirtHatch[i], vorm.skirtHatch[i + 1]];
    const zijde = [Math.abs(p.x - q.x) < 1e-9 && (Math.abs(p.x) < 1e-9 || Math.abs(p.x - 4) < 1e-9),
      Math.abs(p.y - q.y) < 1e-9 && (Math.abs(p.y) < 1e-9 || Math.abs(p.y - 2) < 1e-9)];
    if (!zijde.some(Boolean)) opEenVlak = false;
    if (Math.abs(Math.hypot(p.x - q.x, p.y - q.y) - Math.abs(p.z - q.z)) > 1e-9) onder45 = false;
  }
  ok(opEenVlak, "elk stuk van de randarcering ligt op één zijvlak (geknipt in de hoeken)");
  ok(onder45, "de randarcering staat onder 45°");
  const staand = [];
  for (let i = 0; i < vorm.skirtEdges.length; i += 2) {
    const [p, q] = [vorm.skirtEdges[i], vorm.skirtEdges[i + 1]];
    if (Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9) staand.push(`${p.x},${p.y}`);
  }
  ok(json(staand.sort()) === json(["0,0", "0,2", "4,0", "4,2"]), `staande lijnen in de vier hoeken (${staand.join(" ")})`);
  // Een opening blijft open.
  const metGat = parseOpenFem3DModel({
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }, { id: 3, x: 4, y: 4, z: 0 }, { id: 4, x: 0, y: 4, z: 0 },
      { id: 5, x: 1, y: 1, z: 0 }, { id: 6, x: 3, y: 1, z: 0 }, { id: 7, x: 3, y: 3, z: 0 }, { id: 8, x: 1, y: 3, z: 0 },
    ],
    beams: [],
    plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2, openings: [{ id: 1, nodeIds: [5, 6, 7, 8] }], bedding: grond }],
  });
  const gat = openFem3DPlateBeddingHatchShapes(metGat, maat, "surface")[0];
  ok(gat.loops.length === 2, "twee lussen: de buitenrand en de opening");
  let inGat = false;
  for (let i = 0; i < gat.hatch.length; i += 2) {
    const m = gat.hatch[i].clone().add(gat.hatch[i + 1]).multiplyScalar(0.5);
    if (m.x > 1 + 1e-6 && m.x < 3 - 1e-6 && m.y > 1 + 1e-6 && m.y < 3 - 1e-6) inGat = true;
  }
  ok(!inGat, "geen arceringslijn door de opening");
  // De kant van de grond volgt de afspraak van de kern (plaatassen), niet de volgorde van de knopen.
  const omgekeerd = parseOpenFem3DModel(basis({ nodeIds: [4, 3, 2, 1], bedding: grond }));
  ok(json(openFem3DPlateBeddingHatchShapes(omgekeerd, maat, "volume")[0].ground.toArray()) === json([0, 0, -1]),
    "een vloer met de knopen andersom: de grond ligt nog steeds onder");
  ok(json(openFem3DPlateAxisZ([0, 0, -2])) === json([0, 0, 1]), "plaatnormaal van een vloer: omhoog (de kern)");
  const wand = (volgorde) => openFem3DPlateGroundDirection(
    parseOpenFem3DModel(basis({}, { nodeIds: volgorde, bedding: grond })), parseOpenFem3DModel(basis({}, { nodeIds: volgorde, bedding: grond })).plates[1]);
  const w1 = wand([4, 3, 5, 6]), w2 = wand([6, 5, 3, 4]);
  ok(json(w1.map((c) => Math.abs(c) < 1e-12 ? 0 : c)) === json([0, 1, 0]) && json(w1) === json(w2),
    `een wand in het XZ-vlak: de grond aan de +Y-kant (normaal −Y, zoals de kern), in beide knoopvolgordes (${json(w1)})`);
  // De grondzijde in woorden, met de vraag of het een wand is (dan ligt de zijde vast, zoals in de kern).
  const zijde = (nodes, nodeIds) => openFem3DPlateGroundSide({ nodes }, { nodeIds });
  const xz = zijde(knopen, [4, 3, 5, 6]);
  ok(xz.vertical && xz.side === "+Y" && zijde(knopen, [6, 5, 3, 4]).side === "+Y", `wand in het XZ-vlak: ${xz.side}, verticaal`);
  const yz = [{ id: 1, x: 5, y: 0, z: 0 }, { id: 2, x: 5, y: 4, z: 0 }, { id: 3, x: 5, y: 4, z: 3 }, { id: 4, x: 5, y: 0, z: 3 }];
  ok(zijde(yz, [1, 2, 3, 4]).side === "−X" && zijde(yz, [4, 3, 2, 1]).side === "−X" && zijde(yz, [1, 2, 3, 4]).vertical,
    "wand in het YZ-vlak: −X, in beide knoopvolgordes (zoals de kern)");
  const vloerZijde = zijde(knopen, [1, 2, 3, 4]);
  ok(vloerZijde.side === "−Z" && !vloerZijde.vertical, "een vloer: −Z, geen wand");
  const schuin = [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 3, y: 3, z: 0 }, { id: 3, x: 3, y: 3, z: 3 }, { id: 4, x: 0, y: 0, z: 3 }];
  const s45 = zijde(schuin, [1, 2, 3, 4]);
  ok(s45.vertical && s45.side === "(−0.71; 0.71; 0.00)", `een schuine wand (normaal (0,71; −0,71; 0) zoals de kern): de richting ${s45.side}`);
  ok(zijde(knopen, [1, 2]) === null, "minder dan drie knopen: geen zijde");
  // De groep in de plaatlaag (laag Opleggingen): één arcering per plaat op bedding.
  const laag = buildOpenFem3DPlateOverlay({
    model, mesh: null, result: null, quantity: null, showMesh: false, showPlates: true, showSupports: true,
    plateDisplay: "volume", deformation: false, deformationScale: 1,
  });
  const groep = laag.group.getObjectByName(OPEN_FEM_3D_PLATE_BEDDING_NAME);
  ok(groep && groep.children.some((child) => child.userData.openFem3dPlateBedding === 1), "de laag Opleggingen: de arcering van plaat 1");
  ok(groep.children.some((child) => child.userData.openFem3dPlateBeddingContact === "compressionOnly"), "alleen druk: de rand gestippeld");
  const doos = new THREE.Box3().setFromObject(groep);
  ok(doos.max.z < -0.125 + 1e-9, `de arcering ligt onder de onderzijde van de vloer (z ≤ ${doos.max.z.toFixed(3)})`);
  ok(!buildOpenFem3DPlateOverlay({
    model, mesh: null, result: null, quantity: null, showMesh: false, showPlates: true, showSupports: false,
    plateDisplay: "volume", deformation: false, deformationScale: 1,
  }).group.getObjectByName(OPEN_FEM_3D_PLATE_BEDDING_NAME), "Opleggingen uit: geen arcering");
}

console.log("\n[8] bedieningskanaal (model_3d_bouwen)");
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
  const bouw = (bedding) => ({
    nodes: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 2, z: 0 }, { x: 0, y: 2, z: 0 }],
    beams: [],
    plates: [{ nodes: [1, 2, 3, 4], thickness_m: 0.25, ...(bedding ? { bedding } : {}) }],
    supports: [{ node: 1, type: "fixed" }],
  });
  const a = acties();
  const antwoord = await voer("model_3d_bouwen", bouw({ k_kn_per_m3: 30_000, compression_only: true }), a);
  ok(!antwoord.fout, `model_3d_bouwen met een plaat op bedding${antwoord.fout ? `: ${antwoord.fout}` : ""}`);
  ok(json(a.openFem3d.model.plates[0].bedding) === json({ kKnPerM3: 30_000, compressionOnly: true }), "de plaat staat op bedding, in modelvorm");
  const zonder = acties();
  await voer("model_3d_bouwen", bouw(null), zonder);
  ok(!("bedding" in zonder.openFem3d.model.plates[0]), "zonder bedding: geen veld");
  const tik = await voer("model_3d_bouwen", bouw({ k: 30_000 }), acties());
  ok(tik.fout && /3D-plaat 1: onbekend veld in bedding: k/.test(tik.fout), `een tikfout wordt geweigerd: ${tik.fout}`);
  const nul = await voer("model_3d_bouwen", bouw({ k_kn_per_m3: 0 }), acties());
  ok(nul.fout && /groter dan 0/.test(nul.fout), `k = 0 wordt geweigerd: ${nul.fout}`);
}

console.log("\n[9] rekenen via de 3D-kern, door de rekenweg van de app");
const solverBinary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${solverBinary}`, import.meta.url));
assert.ok(existsSync(solverPath), `Bouw eerst de Rust-rekenkern (${solverPath}) of zet OPEN_FEM_3D_SOLVER_PATH.`);
const verzoeken = [];
globalThis.fetch = (url, options) => new Promise((resolve, reject) => {
  assert.equal(url, "/api/openFem3d/solve");
  verzoeken.push(JSON.parse(options.body));
  const kind = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  const uit = [];
  kind.stdout.on("data", (d) => uit.push(d));
  kind.on("error", reject);
  kind.on("close", (code) => {
    const tekst = Buffer.concat(uit).toString();
    resolve({ ok: code === 0, status: code === 0 ? 200 : 500, json: async () => JSON.parse(tekst) });
  });
  kind.stdin.end(options.body);
});
const vrijeVloer = (bedding, extra = {}) => parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6, y: 4, z: 0 }, { id: 4, x: 0, y: 4, z: 0 }],
  beams: [],
  plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.25, material: "C30/37", meshSizeM: 0.5, bedding }],
  // Alleen in het vlak gesteund (X en Y in knoop 1, Y in knoop 2): verticaal draagt alleen de grond.
  supports: [
    { nodeId: 1, ux: true, uy: true, uz: false, rx: false, ry: false, rz: false },
    { nodeId: 2, ux: false, uy: true, uz: false, rx: false, ry: false, rz: false },
  ],
  surfaceLoads: [{ id: 1, plateId: 1, caseId: 1, qx: 0, qy: 0, qz: -10 }],
  ...extra,
});
try {
  await solveOpenFem3D(vrijeVloer(grond), 1, "linear");
} catch (fout) {
  const tekst = fout instanceof Error ? fout.message : String(fout);
  assert.ok(!/unknown field `bedding`/.test(tekst),
    `de 3D-kern op ${solverPath} kent plates[].bedding niet: een oude bouw; bouw open-fem-3d opnieuw (${tekst.slice(0, 120)})`);
  throw fout;
}
{
  {
    // Gelijkmatige last op een vrije vloer: overal dezelfde zakking q/k, geen buiging, Σ veerkrachten = q·A.
    const q = 10, A = 24;
    const result = await solveOpenFem3D(vrijeVloer(grond), 1, "linear");
    const vloer = result.plateBedding?.find((item) => item.plateId === 1);
    ok(vloer && vloer.nodes.length > 4, `plateBedding in het resultaat, ${vloer?.nodes.length} knopen`);
    ok(json(verzoeken.at(-1).plates[0].bedding) === json(grond), "het verzoek droeg de bedding van de plaat");
    for (const knoop of vloer.nodes) {
      assert.ok(Math.abs(knoop.settlementM - q / grond.kKnPerM3) <= 0.01 * q / grond.kKnPerM3, `zakking op knoop ${knoop.nodeId}: ${knoop.settlementM}`);
      assert.ok(Math.abs(knoop.pressureKnPerM2 - q) <= 0.01 * q, `gronddruk op knoop ${knoop.nodeId}: ${knoop.pressureKnPerM2}`);
    }
    ok(true, `zakking overal q/k = ${(q / grond.kKnPerM3 * 1000).toFixed(3)} mm en gronddruk q (binnen 1 %)`);
    gelijk(vloer.totalReactionKn, q * A, "som van de veerkrachten = q·A", 1e-6);
    gelijk(vloer.maxPressureKnPerM2, q, "grootste gronddruk = q", 0.01);
    gelijk(vloer.maxSettlementM, q / grond.kKnPerM3, "grootste zakking = q/k", 0.01);
    ok(vloer.liftedFraction === 0 && vloer.nodes.every((knoop) => knoop.active), "overal contact");
    const mMax = Math.max(...result.shellNodes.map((n) => Math.abs(n.mxxKnmPerM)));
    ok(mMax < 0.01 * q, `geen buiging (|mxx| ≤ ${mMax.toExponential(2)} kNm/m)`);
    ok(result.forceBalance?.ok, `de onafhankelijke kracht- en momentensom sluit met de grondveren (${result.forceBalance?.maxImbalanceKn.toExponential(2)} kN)`);
    const rij = openFem3DPlateBeddingSummary(vrijeVloer(grond), result)[0];
    gelijk(rij.result.maxPressureKnPerM2, q, "de rapportregel leest de uitkomst", 0.01);
  }
  {
    // Alleen druk: een strook van 8 × 2 m, k = 50 000 kN/m³, t = 0,30 m, met 2 × 50 kN op x = 1,5 m.
    // λ = (k·b/(4EI))^¼ ≈ 0,63 /m (EI van de strook ≈ 1,5·10⁵ kNm²): bij een lineaire grond golft de
    // zakking uit en wordt zij voorbij x ≈ 1,5 + π/(2λ) ≈ 4 m negatief (de grond trekt); met alleen druk
    // laat de grond daar los. De last staat binnen het deel met contact, dus de strook kantelt niet.
    const strook = (bedding) => parseOpenFem3DModel({
      nodes: [
        { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 8, y: 0, z: 0 }, { id: 3, x: 8, y: 2, z: 0 }, { id: 4, x: 0, y: 2, z: 0 },
        { id: 5, x: 1.5, y: 0, z: 0 }, { id: 6, x: 1.5, y: 2, z: 0 },
      ],
      beams: [],
      plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.3, material: "C30/37", meshSizeM: 0.5, bedding }],
      supports: [
        { nodeId: 1, ux: true, uy: true, uz: false, rx: false, ry: false, rz: false },
        { nodeId: 2, ux: false, uy: true, uz: false, rx: false, ry: false, rz: false },
      ],
      loads: [
        { id: 1, nodeId: 5, caseId: 1, fx: 0, fy: 0, fz: -50, mx: 0, my: 0, mz: 0 },
        { id: 2, nodeId: 6, caseId: 1, fx: 0, fy: 0, fz: -50, mx: 0, my: 0, mz: 0 },
      ],
    });
    const lineair = await solveOpenFem3D(strook({ kKnPerM3: 50_000 }), 1, "linear");
    const ver = lineair.plateBedding[0].nodes.filter((n) => n.settlementM < 0);
    ok(ver.length > 0 && ver.every((n) => n.pressureKnPerM2 < 0), `lineaire grond: het verre eind trekt aan de grond (${ver.length} knopen met trek)`);
    const druk = await solveOpenFem3D(strook({ kKnPerM3: 50_000, compressionOnly: true }), 1, "linear");
    const vloer = druk.plateBedding[0];
    const los = vloer.nodes.filter((n) => !n.active);
    ok(los.length > 0 && vloer.liftedFraction > 0.2 && vloer.liftedFraction < 0.8,
      `alleen druk: ${los.length} knopen zonder contact, ${(vloer.liftedFraction * 100).toFixed(1)} % van het oppervlak (het verre deel)`);
    const knoopX = new Map(verzoeken.at(-1).nodes.map((node) => [node.id, node.x]));
    ok(los.every((n) => knoopX.get(n.nodeId) > 3), "zonder contact: alleen voorbij x = 3 m, ver van de last");
    ok(los.every((n) => n.pressureKnPerM2 === 0 && n.settlementM <= 0), "zonder contact: gronddruk 0, de plaat komt omhoog");
    // liftedFraction is het aandeel van het oppervlak zonder contact: Σ A_trib zonder contact / Σ A_trib (exact).
    const plek = new Map([...strook({ kKnPerM3: 1 }).nodes, ...druk.plateMesh.nodes].map((n) => [n.id, [n.x, n.y, n.z]]));
    const opp = openFem3DPlateBeddingTributaryAreas(druk.plateMesh.elements.filter((e) => e.plateId === 1), (id) => plek.get(id));
    const totaal = [...opp.values()].reduce((a, b) => a + b, 0);
    const zonder = los.reduce((som, n) => som + opp.get(n.nodeId), 0);
    gelijk(vloer.liftedFraction, zonder / totaal, "liftedFraction = Σ A_trib zonder contact / Σ A_trib", 1e-12, 1e-12);
    ok(Math.abs(vloer.liftedFraction - los.length / vloer.nodes.length) > 1e-3,
      `en niet het aandeel van de knopen (${(vloer.liftedFraction * 100).toFixed(2)} % tegen ${(100 * los.length / vloer.nodes.length).toFixed(2)} %)`);
    ok(vloer.minPressureKnPerM2 >= 0, "alleen druk: nergens trek in de grond");
    gelijk(vloer.totalReactionKn, 100, "de grond draagt de 100 kN", 1e-6);
    ok(druk.forceBalance?.ok, "de onafhankelijke kracht- en momentensom sluit ook met losgekomen veren");
  }
  {
    // Een niet-rechthoekige vloer (een vierhoek van 29,5 m², zonder opleggingen): de app meshet haar in
    // scheve vierhoeken (pad "driehoeken"), waar ∫N_i dA niet A/4 is. De veren k·∫N_i dA en de vlaklast
    // q·∫N_i dA gebruiken dezelfde gewichten: elke knoop zakt exact q/k (10⁻⁹), niets buigt, Σ = q·A.
    const q = 10, A = 29.5;
    const vierhoek = parseOpenFem3DModel({
      nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 8, y: 0, z: 0 }, { id: 3, x: 6, y: 5, z: 0 }, { id: 4, x: 1, y: 4, z: 0 }],
      beams: [],
      plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.25, material: "C30/37", meshSizeM: 0.5, bedding: grond }],
      surfaceLoads: [{ id: 1, plateId: 1, caseId: 1, qx: 0, qy: 0, qz: -q }],
    });
    const result = await solveOpenFem3D(vierhoek, 1, "linear");
    const net = result.plateMesh;
    ok(net.plates.every((plaat) => plaat.method === "driehoeken"), `het rekennet: pad ${net.plates.map((plaat) => plaat.method).join(", ")}`);
    const plek = new Map([...vierhoek.nodes, ...net.nodes].map((n) => [n.id, [n.x, n.y, n.z]]));
    const scheef = net.elements.filter((e) => {
      const p = e.nodeIds.map((id) => plek.get(id));
      return Math.hypot(...[0, 1, 2].map((as) => p[0][as] + p[2][as] - p[1][as] - p[3][as])) > 1e-9;
    }).length;
    let afwijking = 0;
    for (const e of net.elements) {
      const a = openFem3DPlateBeddingTributaryAreas([e], (id) => plek.get(id));
      const totaal = [...a.values()].reduce((x, y) => x + y, 0);
      for (const w of a.values()) afwijking = Math.max(afwijking, Math.abs(w - totaal / 4) / (totaal / 4));
    }
    ok(scheef > net.elements.length / 2 && afwijking > 0.05,
      `${scheef} van ${net.elements.length} elementen zijn geen parallellogram; ∫N_i dA wijkt tot ${(100 * afwijking).toFixed(1)} % af van A/4`);
    const b = openFem3DPlateBeddingResultOf(result, 1);
    const zakking = Math.max(...b.nodes.map((n) => Math.abs(n.settlementM - q / grond.kKnPerM3)));
    ok(zakking <= 1e-9 * q / grond.kKnPerM3, `elke knoop zakt q/k (grootste afwijking ${zakking.toExponential(1)} m)`);
    gelijk(b.totalReactionKn, q * A, "Σ veerkrachten = q·A", 1e-9);
    const m = Math.max(...result.shellNodes.map((n) => Math.max(Math.abs(n.mxxKnmPerM), Math.abs(n.myyKnmPerM), Math.abs(n.mxyKnmPerM))));
    ok(m < 1e-9 * q * A, `geen buiging (grootste plaatmoment ${m.toExponential(1)} kNm/m)`);
    ok(result.forceBalance?.ok, "de onafhankelijke krachtensom sluit");
  }
}

stil(`\n${geslaagd} geslaagd, 0 gefaald`);

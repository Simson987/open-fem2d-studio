// Plaatweergave in 3D: volume, vlak of mesh (issue #78).
//
// WAAROM DEZE TEST BESTAAT
// Een plaat stond in 3D altijd als volume (de plaat met haar dikte), met een
// losse schakelaar "Mesh" die de elementen als lijnen op beide plaatvlakken
// tekende. Nu is er één keuze, plateDisplay: "volume" (de plaat met haar
// dikte), "surface" (alleen het middenvlak, dun en halfdoorzichtig, met de
// omtrek en openingen als lijn) of "mesh" (de elementen van het rekennet op
// het middenvlak, met een licht gevuld vlak eronder). De schakelaar Platen
// aan/uit blijft los bestaan. Precies de fouten die hieronder vallen: een
// oude opslag of view met mesh: true die niet als "mesh" terugkomt, een
// ongeldige of ontbrekende waarde die geen "volume" wordt, een sleutel mesh
// die na de overname blijft hangen, een vlak of mesh dat toch dikte heeft of
// niet op het middenvlak ligt, meshlijnen die in volume of vlak blijven staan
// of niet op het middenvlak liggen, en een bedieningskanaal of MCP-schema dat
// de keuze (of de oude sleutel mesh) niet aanneemt.
//
// Elk getal volgt uit de invoer: een plaat van 8 × 6 m met een opening van
// 2 × 1,5 m heeft 48 − 3 = 45 m² vlak; de omtrek is 2 · (8 + 6) = 28 m plus
// 2 · (2 + 1,5) = 7 m rond de opening; het middenvlak ligt op de knopen.
//
// Checks:
//  [1] KEUZE     — drie standen in vaste volgorde, standaard "volume", geen
//                  aan/uit-vlag (niet in de lijst van vlaggen) en geen mesh
//                  meer in de zichtbaarheid.
//  [2] OPSLAG    — eenmalige overname: mesh: true zonder plateDisplay →
//                  "mesh"; anders "volume"; ongeldig → "volume"; daarna is
//                  plateDisplay leidend en verdwijnt mesh bij het bewaren.
//  [3] VIEWS     — een opgeslagen view (projectbestand) neemt over zoals de
//                  opslag; bewaren en een standaardview houden de keuze.
//  [4] GEOMETRIE — volume heeft dikte, vlak en mesh liggen op het middenvlak
//                  zonder dikte, met de opening als gat; de omtrek als lijn;
//                  het vlak van een oppervlaktelast ligt in elke stand net
//                  buiten de getekende plaat (alleen de marge, niet t/2 erbij
//                  in vlak en mesh).
//  [5] MESHLAAG  — de elementlijnen alleen bij "mesh", op het middenvlak;
//                  de stijl per stand (vlak en mesh lichter dan volume).
//  [6] KANAAL    — gui_configure_3d_view: plateDisplay als enum (MCP-schema
//                  en unittests), het bedieningskanaal neemt de keuze en de
//                  oude sleutel mesh aan en weigert iets anders.
//  [7] SCHERM    — keuzegroep onder Platen in het venster en de verkenner,
//                  drie lintknoppen met dekking, teksten in vier talen, het
//                  snelle pad in het tekenvlak en de browserproef in de
//                  batterij (het gedrag op het scherm toetst
//                  test-open-fem3d-plaatweergave-ui.mjs).
//
// Uitvoeren: node scripts/run-tests.mjs --filter=open-fem3d-plaatweergave
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import * as THREE from "three";

// Het bedieningskanaal trekt onderdelen met stylesheets mee; Node kent die
// niet. Een lege module volstaat (zoals in test-open-fem3d-symboolschaal.mjs).
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function load(url, ctx, next) {" +
        " if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };" +
        " return next(url, ctx); }",
    ),
);

const D = await import("./src/components/openFem3d/openFem3dPlateDisplay.ts");
const V = await import("./src/components/openFem3d/openFem3dVisibility.ts");
const { parseOpenFem3DViewSets, bewaarOpenFem3DViewSet } = await import("./src/components/openFem3d/openFem3dViewSets.ts");
const { openFem3DStandaardViewToepassing, openFem3DViewSetToepassing } = await import("./src/components/openFem3d/openFem3dStandaardViews.ts");
const { createOpenFem3DPlateGeometry } = await import("./src/components/openFem3d/openFem3dPlateGeometry.ts");
const { openFem3DSurfaceLoadSurface, openFem3DSurfaceLoadMarginM } = await import("./src/components/openFem3d/openFem3dLoadSurfaces.ts");
const { buildOpenFem3DPlateOverlay } = await import("./src/components/openFem3d/openFem3dPlateOverlay.ts");
const { parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");

let geslaagd = 0;
let gefaald = 0;
async function check(naam, proef) {
  try {
    await proef();
    geslaagd += 1;
    console.log(`  ✓ ${naam}`);
  } catch (fout) {
    gefaald += 1;
    console.log(`  ✗ ${naam}\n      ${fout instanceof Error ? fout.message : fout}`);
  }
}
const bron = (pad) => readFileSync(new URL(pad, import.meta.url), "utf8");
const dichtbij = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const DEFAULT = V.DEFAULT_OPEN_FEM_3D_VISIBILITY;

/** Bewaarde zichtbaarheid lezen en schrijven via een nagebootste browseropslag. */
function metOpslag(waarde, proef) {
  const bewaard = { waarde: waarde === undefined ? null : JSON.stringify(waarde) };
  globalThis.localStorage = { getItem: () => bewaard.waarde, setItem: (_k, v) => { bewaard.waarde = v; } };
  try {
    return proef(bewaard);
  } finally {
    delete globalThis.localStorage;
  }
}

/* ── [1] Keuze ───────────────────────────────────────────────────────── */
console.log("[1] Drie standen, standaard volume");
await check("de standen: volume, surface, mesh (in deze volgorde); standaard volume", () => {
  assert.deepEqual([...D.OPEN_FEM_3D_PLATE_DISPLAYS], ["volume", "surface", "mesh"]);
  assert.equal(D.DEFAULT_OPEN_FEM_3D_PLATE_DISPLAY, "volume");
  assert.equal(DEFAULT.plateDisplay, "volume");
});
await check("geen aan/uit-vlag: niet in de lijst van vlaggen; de oude sleutel mesh is weg", () => {
  assert.ok(!V.OPEN_FEM_3D_VISIBILITY_FLAGS.includes("plateDisplay"));
  assert.ok(!V.OPEN_FEM_3D_VISIBILITY_FLAGS.includes("mesh"));
  assert.ok(!("mesh" in DEFAULT), "DEFAULT kent geen mesh meer");
  assert.ok(V.OPEN_FEM_3D_VISIBILITY_FLAGS.every((k) => typeof DEFAULT[k] === "boolean"));
  // Alle sleutels = de vlaggen + de twee schalen (issue #82) + deze keuze
  // + de section box (issue #86) + de explode-stand (issue #104).
  assert.equal(V.OPEN_FEM_3D_VISIBILITY_FLAGS.length + 5, Object.keys(DEFAULT).length);
});
await check("isOpenFem3DPlateDisplay: alleen de drie teksten", () => {
  for (const s of ["volume", "surface", "mesh"]) assert.equal(D.isOpenFem3DPlateDisplay(s), true, s);
  for (const s of ["Volume", "vlak", "", null, undefined, 1, true, {}]) assert.equal(D.isOpenFem3DPlateDisplay(s), false, String(s));
});

/* ── [2] Opslag ──────────────────────────────────────────────────────── */
console.log("\n[2] Overname uit de bewaarde zichtbaarheid");
await check("mesh: true zonder plateDisplay → mesh; mesh: false of geen van beide → volume", () => {
  assert.equal(V.normalizeOpenFem3DVisibility({ mesh: true }).plateDisplay, "mesh");
  assert.equal(V.normalizeOpenFem3DVisibility({ mesh: false }).plateDisplay, "volume");
  assert.equal(V.normalizeOpenFem3DVisibility({ nodes: false }).plateDisplay, "volume");
  assert.equal(V.normalizeOpenFem3DVisibility(null).plateDisplay, "volume");
  assert.equal(V.normalizeOpenFem3DVisibility({ mesh: "ja" }).plateDisplay, "volume", "mesh geen boolean: volume");
});
await check("een geldige plateDisplay is leidend, ook naast een oude mesh", () => {
  for (const stand of ["volume", "surface", "mesh"]) {
    assert.equal(V.normalizeOpenFem3DVisibility({ plateDisplay: stand }).plateDisplay, stand, stand);
    assert.equal(V.normalizeOpenFem3DVisibility({ plateDisplay: stand, mesh: true }).plateDisplay, stand, `${stand} + mesh: true`);
    assert.equal(V.normalizeOpenFem3DVisibility({ plateDisplay: stand, mesh: false }).plateDisplay, stand, `${stand} + mesh: false`);
  }
});
await check("ongeldige plateDisplay → volume (ook met mesh: true ernaast)", () => {
  for (const fout of ["wire", "Volume", "", 3, true, null, ["mesh"], { stand: "mesh" }]) {
    assert.equal(V.normalizeOpenFem3DVisibility({ plateDisplay: fout }).plateDisplay, "volume", JSON.stringify(fout));
    assert.equal(V.normalizeOpenFem3DVisibility({ plateDisplay: fout, mesh: true }).plateDisplay, "volume", `${JSON.stringify(fout)} + mesh`);
  }
});
await check("de genormaliseerde zichtbaarheid draagt geen sleutel mesh meer; de rest blijft", () => {
  const v = V.normalizeOpenFem3DVisibility({ mesh: true, nodes: false, supportSizePercent: 60 });
  assert.ok(!("mesh" in v));
  assert.equal(v.nodes, false);
  assert.equal(v.supportSizePercent, 60);
  assert.equal(v.plates, true);
});
await check("browseropslag: oud mesh: true → mesh; bewaren schrijft plateDisplay zonder mesh; daarna leidend", () => {
  metOpslag({ mesh: true, nodes: false }, (bewaard) => {
    const oud = V.readOpenFem3DVisibility();
    assert.equal(oud.plateDisplay, "mesh");
    assert.equal(oud.nodes, false);
    V.saveOpenFem3DVisibility(oud);
    const opgeslagen = JSON.parse(bewaard.waarde);
    assert.equal(opgeslagen.plateDisplay, "mesh");
    assert.ok(!("mesh" in opgeslagen), "mesh verdwijnt bij het bewaren");
    // De gebruiker kiest daarna volume: dat blijft zo, ook al stond er ooit mesh.
    V.saveOpenFem3DVisibility({ ...oud, plateDisplay: "volume" });
    assert.equal(V.readOpenFem3DVisibility().plateDisplay, "volume");
  });
  metOpslag({ mesh: false }, () => assert.equal(V.readOpenFem3DVisibility().plateDisplay, "volume"));
  metOpslag(undefined, () => assert.equal(V.readOpenFem3DVisibility().plateDisplay, "volume", "lege opslag"));
  metOpslag({ plateDisplay: "surface", mesh: true }, () => assert.equal(V.readOpenFem3DVisibility().plateDisplay, "surface"));
  metOpslag({ plateDisplay: "rooster" }, () => assert.equal(V.readOpenFem3DVisibility().plateDisplay, "volume"));
});

/* ── [3] Views ───────────────────────────────────────────────────────── */
console.log("\n[3] Opgeslagen views (projectbestand)");
const camera = { position: [10, -10, 8], target: [0, 0, 0], up: [0, 0, 1] };
const view = (visibility, extra = {}) => ({ id: "view-1", name: "Vloer", view: "iso", camera, visibility, combinationId: null, ...extra });
await check("een oude view met mesh: true → mesh; met mesh: false of zonder → volume", () => {
  assert.equal(parseOpenFem3DViewSets([view({ mesh: true })])[0].visibility.plateDisplay, "mesh");
  assert.equal(parseOpenFem3DViewSets([view({ mesh: false })])[0].visibility.plateDisplay, "volume");
  assert.equal(parseOpenFem3DViewSets([view({ nodes: true })])[0].visibility.plateDisplay, "volume");
  assert.ok(!("mesh" in parseOpenFem3DViewSets([view({ mesh: true })])[0].visibility), "geen mesh na het inlezen");
});
await check("een nieuwe view met plateDisplay: leidend; ongeldig → volume", () => {
  assert.equal(parseOpenFem3DViewSets([view({ plateDisplay: "surface", mesh: true })])[0].visibility.plateDisplay, "surface");
  assert.equal(parseOpenFem3DViewSets([view({ plateDisplay: "mesh" })])[0].visibility.plateDisplay, "mesh");
  assert.equal(parseOpenFem3DViewSets([view({ plateDisplay: 7, mesh: true })])[0].visibility.plateDisplay, "volume");
});
await check("bewaren en weer inlezen houdt de keuze (JSON heen en terug)", () => {
  for (const stand of ["volume", "surface", "mesh"]) {
    const views = bewaarOpenFem3DViewSet([], "Vloer", {
      view: "iso", camera, visibility: { ...DEFAULT, plateDisplay: stand }, combinationId: null, loadCaseId: 1, mode: "model",
    });
    const terug = parseOpenFem3DViewSets(JSON.parse(JSON.stringify(views)));
    assert.equal(terug[0].visibility.plateDisplay, stand, stand);
  }
});
await check("projectbestand (zoals de MCP-server het leest en schrijft): oud mesh: true → mesh; terug zonder mesh", async () => {
  const { documentNaarTekst, documentUitTekst, leegDocument } = await import("./src/api/projectDocument.ts");
  const metViews = {
    ...leegDocument(),
    openFem3dViewSets: [
      view({ mesh: true, nodes: false }, { id: "oud-mesh", name: "Oud met mesh" }),
      view({ mesh: false }, { id: "oud-zonder", name: "Oud zonder mesh" }),
      view({ plateDisplay: "surface" }, { id: "nieuw", name: "Nieuw vlak" }),
    ],
  };
  const tekst = documentNaarTekst(documentUitTekst(documentNaarTekst(metViews)));
  const views = documentUitTekst(tekst).openFem3dViewSets ?? [];
  assert.deepEqual(views.map((v) => v.visibility.plateDisplay), ["mesh", "volume", "surface"]);
  assert.equal(views[0].visibility.nodes, false, "de rest van de view blijft");
  const bewaard = JSON.parse(tekst);
  const zichtbaarheden = (bewaard.openFem3dViewSets ?? bewaard.state?.openFem3dViewSets ?? []).map((v) => v.visibility);
  assert.equal(zichtbaarheden.length, 3, "drie views in het bestand");
  assert.ok(zichtbaarheden.every((v) => !("mesh" in v) && typeof v.plateDisplay === "string"), "opgeslagen met plateDisplay, zonder mesh");
});
await check("een standaardview houdt de huidige plaatweergave; een eigen view brengt de zijne mee", () => {
  const huidig = { ...DEFAULT, plateDisplay: "surface" };
  for (const id of ["geometrie", "belastingen", "vz"]) {
    const t = openFem3DStandaardViewToepassing(id, { visibility: huidig, activeCombinationId: null, maatgevendeCombinationId: null, activeLoadCaseId: 1 });
    assert.equal(t.visibility.plateDisplay, "surface", id);
  }
  const eigen = parseOpenFem3DViewSets([view({ plateDisplay: "mesh" })])[0];
  assert.equal(openFem3DViewSetToepassing(eigen).visibility.plateDisplay, "mesh");
});

/* ── [4] Geometrie ───────────────────────────────────────────────────── */
console.log("\n[4] Geometrie per stand");
/** Vloer van 8 × 6 m op z = 3 m, 0,3 m dik, met een opening van 2 × 1,5 m. */
const vloer = parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 3 }, { id: 2, x: 8, y: 0, z: 3 }, { id: 3, x: 8, y: 6, z: 3 }, { id: 4, x: 0, y: 6, z: 3 },
    { id: 5, x: 3, y: 2, z: 3 }, { id: 6, x: 5, y: 2, z: 3 }, { id: 7, x: 5, y: 3.5, z: 3 }, { id: 8, x: 3, y: 3.5, z: 3 },
  ],
  beams: [],
  plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.3, material: "C30/37", openings: [{ id: 1, nodeIds: [5, 6, 7, 8] }] }],
});
const plaat = vloer.plates[0];
/** Wereldpunten van een plaatgeometrie (lokale geometrie × positie en draaiing). */
function wereld(built) {
  const pos = built.geometry.getAttribute("position");
  const m = new THREE.Matrix4().compose(built.position, built.quaternion, new THREE.Vector3(1, 1, 1));
  const uit = [];
  for (let i = 0; i < pos.count; i += 1) uit.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m));
  return uit;
}
/** Oppervlak van de driehoeken (geïndexeerd of niet). */
function oppervlak(geometry) {
  const pos = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const n = index ? index.count : pos.count;
  const at = (k) => new THREE.Vector3().fromBufferAttribute(pos, index ? index.getX(k) : k);
  let som = 0;
  for (let k = 0; k + 2 < n; k += 3) {
    const a = at(k), b = at(k + 1), c = at(k + 2);
    som += new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).length() / 2;
  }
  return som;
}
await check("volume: de plaat met haar dikte, 2,85 … 3,15 m (zoals voorheen; ook zonder keuze)", () => {
  for (const built of [createOpenFem3DPlateGeometry(vloer, plaat), createOpenFem3DPlateGeometry(vloer, plaat, undefined, "volume")]) {
    const z = wereld(built).map((p) => p.z);
    assert.ok(dichtbij(Math.min(...z), 2.85, 1e-6) && dichtbij(Math.max(...z), 3.15, 1e-6), `z ${Math.min(...z)} … ${Math.max(...z)}`);
    assert.equal(built.geometry.type, "ExtrudeGeometry");
  }
});
await check("vlak en mesh: alleen het middenvlak (z = 3 m), geen dikte; 45 m² met de opening als gat", () => {
  for (const stand of ["surface", "mesh"]) {
    const built = createOpenFem3DPlateGeometry(vloer, plaat, undefined, stand);
    const punten = wereld(built);
    assert.ok(punten.every((p) => dichtbij(p.z, 3, 1e-9)), `${stand}: alle punten op z = 3`);
    assert.ok(dichtbij(oppervlak(built.geometry), 45, 1e-6), `${stand}: oppervlak ${oppervlak(built.geometry)}`);
    // Lokaal: z = 0, het middenvlak; de begrenzing is plat.
    built.geometry.computeBoundingBox();
    assert.ok(dichtbij(built.geometry.boundingBox.max.z - built.geometry.boundingBox.min.z, 0), `${stand}: dikte 0`);
  }
  const volume = createOpenFem3DPlateGeometry(vloer, plaat, undefined, "volume");
  // Het volume heeft twee kapvlakken van 45 m² plus zijvlakken: 2 · 45 + 0,3 · (28 + 7).
  assert.ok(dichtbij(oppervlak(volume.geometry), 2 * 45 + 0.3 * 35, 1e-6), `volume: ${oppervlak(volume.geometry)}`);
});
await check("het ankerpunt (lastpijl) ligt in elke stand op het middenvlak en niet in de opening", () => {
  for (const stand of ["volume", "surface", "mesh"]) {
    const a = createOpenFem3DPlateGeometry(vloer, plaat, undefined, stand).surfaceAnchor;
    assert.ok(dichtbij(a.z, 3, 1e-9), `${stand}: z ${a.z}`);
    const inOpening = a.x > 3 && a.x < 5 && a.y > 2 && a.y < 3.5;
    assert.ok(!inOpening && a.x >= 0 && a.x <= 8 && a.y >= 0 && a.y <= 6, `${stand}: anker (${a.x}, ${a.y})`);
  }
});
await check("de omtrek als lijn: buitenrand 28 m en opening 7 m, alles op het middenvlak", () => {
  for (const stand of ["surface", "mesh"]) {
    const built = createOpenFem3DPlateGeometry(vloer, plaat, undefined, stand);
    const randen = new THREE.EdgesGeometry(built.geometry, 22);
    const pos = randen.getAttribute("position");
    let lengte = 0;
    for (let i = 0; i < pos.count; i += 2) {
      lengte += new THREE.Vector3().fromBufferAttribute(pos, i).distanceTo(new THREE.Vector3().fromBufferAttribute(pos, i + 1));
      assert.ok(dichtbij(pos.getZ(i), 0) && dichtbij(pos.getZ(i + 1), 0), `${stand}: randpunt op het middenvlak`);
    }
    assert.ok(dichtbij(lengte, 35, 1e-6), `${stand}: randlengte ${lengte}`);
  }
});
await check("een schuine plaat: vlak op het middenvlak door de knopen, ook bij een boogrand", () => {
  const schuin = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }, { id: 3, x: 4, y: 3, z: 3 }, { id: 4, x: 0, y: 3, z: 3 }, { id: 5, x: 2, y: -1, z: -1 }],
    beams: [],
    plates: [{ id: 1, nodeIds: [1, 5, 2, 3, 4], thicknessM: 0.25, material: "C30/37",
      boundary: [{ kind: "arc", startNodeId: 1, controlNodeId: 5, endNodeId: 2 }, { kind: "line", startNodeId: 2, endNodeId: 3 },
        { kind: "line", startNodeId: 3, endNodeId: 4 }, { kind: "line", startNodeId: 4, endNodeId: 1 }] }],
  });
  const built = createOpenFem3DPlateGeometry(schuin, schuin.plates[0], undefined, "surface");
  // Het vlak y = z door de knopen: elk punt voldoet, ook de boog door (2, −1, −1).
  assert.ok(wereld(built).every((p) => dichtbij(p.y, p.z, 1e-9)), "alle punten in het plaatvlak y = z");
  assert.ok(wereld(built).some((p) => p.y < -0.5), "de boog loopt mee");
});
await check("lastvlak: in elke stand de marge (0,015 m) buiten de getekende plaat; in vlak en mesh niet t/2 hoger", () => {
  // Marge: 5 % van de dikte, minstens 5 mm. Vloer 0,3 m: 0,015 m.
  assert.ok(dichtbij(openFem3DSurfaceLoadMarginM(0.3), 0.015, 1e-12), "marge 0,3 m dik");
  assert.ok(dichtbij(openFem3DSurfaceLoadMarginM(0.05), 0.005, 1e-12), "marge dunne plaat: minstens 5 mm");
  const marge = 0.015;
  // Getekende plaat: volume 2,85 … 3,15 m, vlak en mesh 3 m. Lastvlak omlaag
  // (qz < 0) boven de plaat, omhoog (qz > 0) eronder: telkens precies de marge.
  const verwacht = { volume: [3.15 + marge, 2.85 - marge], surface: [3 + marge, 3 - marge], mesh: [3 + marge, 3 - marge] };
  for (const stand of ["volume", "surface", "mesh"]) {
    const z = wereld(createOpenFem3DPlateGeometry(vloer, plaat, undefined, stand)).map((p) => p.z);
    const boven = Math.max(...z), onder = Math.min(...z);
    const omlaag = openFem3DSurfaceLoadSurface(vloer, plaat, { qx: 0, qy: 0, qz: -5 }, undefined, stand);
    const omhoog = openFem3DSurfaceLoadSurface(vloer, plaat, { qx: 0, qy: 0, qz: 5 }, undefined, stand);
    const hoogtes = (vlak) => [...vlak.positions.filter((_, k) => k % 3 === 2), ...vlak.outlines.flat().map((p) => p[2])];
    assert.ok(hoogtes(omlaag).every((h) => dichtbij(h, verwacht[stand][0], 1e-9)), `${stand}: omlaag op ${verwacht[stand][0]}`);
    assert.ok(hoogtes(omhoog).every((h) => dichtbij(h, verwacht[stand][1], 1e-9)), `${stand}: omhoog op ${verwacht[stand][1]}`);
    assert.ok(dichtbij(verwacht[stand][0] - boven, marge, 1e-6), `${stand}: afstand tot de bovenzijde ${verwacht[stand][0] - boven}`);
    assert.ok(dichtbij(onder - verwacht[stand][1], marge, 1e-6), `${stand}: afstand tot de onderzijde ${onder - verwacht[stand][1]}`);
    assert.ok(dichtbij(omlaag.areaM2, 45, 1e-6), `${stand}: lastvlak 45 m² (de opening blijft open)`);
  }
  // Zonder keuze: volume, zoals voorheen.
  const standaard = openFem3DSurfaceLoadSurface(vloer, plaat, { qx: 0, qy: 0, qz: -5 });
  assert.ok(standaard.positions.filter((_, k) => k % 3 === 2).every((h) => dichtbij(h, 3.165, 1e-9)), "standaard: volume");
});

/* ── [5] Meshlaag en stijl ───────────────────────────────────────────── */
console.log("\n[5] De elementlijnen en de stijl per stand");
/**
 * Een eenvoudig weergavenet van 1 × 1 m over de vloer, zonder de twee vakken
 * die helemaal in de opening liggen (alleen voor de lijnen; geen rekenwerk).
 */
function rasterNet(model, z) {
  const nodes = [];
  const id = (i, j) => 1000 + i * 9 + j;
  for (let i = 0; i <= 6; i += 1) for (let j = 0; j <= 8; j += 1) nodes.push({ id: id(i, j), x: j, y: i, z });
  const elements = [];
  for (let i = 0; i < 6; i += 1) for (let j = 0; j < 8; j += 1) {
    if (j >= 3 && j < 5 && i >= 2 && i < 3) continue;
    elements.push({ id: elements.length + 1, plateId: 1, nodeIds: [id(i, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j)] });
  }
  return { nodes, elements, beamIntermediateNodes: new Map(), plateEdgeNodes: new Map(), plates: [], notices: [] };
}
const net = rasterNet(vloer, 3);
const meshLijnen = (overlay) => overlay.group.children.filter((c) => c.userData.openFem3dPlateMesh !== undefined);
await check("alleen bij mesh de elementlijnen; volume en vlak zonder", () => {
  for (const stand of ["volume", "surface", "mesh"]) {
    const overlay = buildOpenFem3DPlateOverlay({
      model: vloer, mesh: net, result: null, quantity: null, showMesh: D.OPEN_FEM_3D_PLATE_DISPLAY_STYLES[stand].showMesh,
      showPlates: true, deformation: false, deformationScale: 1,
    });
    assert.equal(meshLijnen(overlay).length, stand === "mesh" ? 1 : 0, stand);
  }
});
await check("de elementlijnen liggen op het middenvlak (z = 3 m, niet op ± t/2), elke rand één keer", () => {
  const overlay = buildOpenFem3DPlateOverlay({
    model: vloer, mesh: net, result: null, quantity: null, showMesh: true, showPlates: true, deformation: false, deformationScale: 1,
  });
  const lijnen = meshLijnen(overlay)[0];
  const pos = lijnen.geometry.getAttribute("position");
  for (let i = 0; i < pos.count; i += 1) assert.ok(dichtbij(pos.getZ(i), 3), `punt ${i}: z ${pos.getZ(i)}`);
  // 46 vakken; unieke randen: 7 · 8 + 6 · 9 = 110 in het volle raster, min de 2
  // randen die alleen tussen de twee weggelaten vakken liggen (1 binnenrand
  // tussen de vakken; de buitenranden van het gat blijven bij hun buren).
  const randen = pos.count / 2;
  assert.equal(randen, 110 - 1, `aantal randen ${randen}`);
});
await check("stijl: volume ondoorzichtiger dan vlak, mesh het lichtst gevuld; vlak en mesh zonder dikte", () => {
  const S = D.OPEN_FEM_3D_PLATE_DISPLAY_STYLES;
  assert.deepEqual(Object.keys(S), ["volume", "surface", "mesh"]);
  assert.equal(S.volume.flat, false);
  assert.equal(S.surface.flat, true);
  assert.equal(S.mesh.flat, true);
  assert.equal(S.volume.opacity, 0.7, "volume zoals voorheen");
  assert.equal(S.volume.selectionOpacity, 0.88, "volume zoals voorheen");
  assert.ok(S.surface.opacity < S.volume.opacity, "vlak halfdoorzichtig");
  assert.ok(S.mesh.opacity < S.surface.opacity, "mesh: licht gevuld vlak");
  for (const stand of D.OPEN_FEM_3D_PLATE_DISPLAYS) {
    assert.ok(S[stand].selectionOpacity > S[stand].opacity, `${stand}: geselecteerd duidelijker`);
  }
  assert.deepEqual(D.OPEN_FEM_3D_PLATE_DISPLAYS.filter((s) => S[s].showMesh), ["mesh"]);
});

/* ── [6] Bedieningskanaal en MCP ─────────────────────────────────────── */
console.log("\n[6] Bedieningskanaal en MCP (gui_configure_3d_view)");
await check("het MCP-schema kent plateDisplay als enum volume/surface/mesh (strikt schema)", () => {
  const gui = bron("../src-tauri/crates/openaec-mcp-server/src/gui_tools.rs");
  const schema = /"name": "gui_configure_3d_view"[\s\S]*?"structural_grid"/.exec(gui)?.[0] ?? "";
  assert.match(schema, /"plateDisplay":\{"type":"string","enum":\["volume","surface","mesh"\]/);
  assert.match(gui, /\["plateDisplay"\]\["enum"\], json!\(\["volume", "surface", "mesh"\]\)/, "unittest in gui_tools.rs");
  assert.match(bron("../src-tauri/crates/openaec-mcp-server/tests/schema_strikt.rs"), /plateDisplay/, "schema_strikt.rs");
  assert.match(bron("../src-tauri/crates/openaec-mcp-server/README.md"), /plateDisplay/, "README");
});
{
  const { voerUit } = await import("./src/bediening/bediening.ts");
  const gezet = [];
  const acties = {
    modelDimension: "3d",
    openFem3d: {
      visibility: { ...DEFAULT },
      setVisibility(next) { gezet.push(next); this.visibility = next; },
    },
  };
  const voer = (visibility) => voerUit("weergave_3d_configureren", { visibility }, { current: acties },
    () => new Promise(() => {}), () => Promise.resolve());
  await check("plateDisplay zet de stand; de rest blijft staan; het antwoord meldt hem", async () => {
    for (const stand of ["surface", "mesh", "volume"]) {
      gezet.length = 0;
      const uit = await voer({ plateDisplay: stand });
      assert.equal(gezet.length, 1);
      assert.equal(gezet[0].plateDisplay, stand);
      assert.equal(gezet[0].plates, true);
      assert.equal(uit.zichtbaarheid.plateDisplay, stand);
    }
  });
  await check("de oude sleutel mesh: true → mesh, false → volume; geen mesh in de zichtbaarheid", async () => {
    acties.openFem3d.visibility = { ...DEFAULT, plateDisplay: "surface" };
    gezet.length = 0;
    await voer({ mesh: true });
    assert.equal(gezet[0].plateDisplay, "mesh");
    assert.ok(!("mesh" in gezet[0]));
    gezet.length = 0;
    await voer({ mesh: false });
    assert.equal(gezet[0].plateDisplay, "volume");
    assert.ok(!("mesh" in gezet[0]));
    // Samen met plateDisplay wint plateDisplay (de nieuwe sleutel is leidend).
    gezet.length = 0;
    await voer({ mesh: true, plateDisplay: "surface" });
    assert.equal(gezet[0].plateDisplay, "surface");
    gezet.length = 0;
    await voer({ plateDisplay: "surface", mesh: true });
    assert.equal(gezet[0].plateDisplay, "surface");
  });
  await check("samen met Platen uit: beide gezet", async () => {
    gezet.length = 0;
    await voer({ plates: false, plateDisplay: "mesh" });
    assert.equal(gezet[0].plates, false);
    assert.equal(gezet[0].plateDisplay, "mesh");
  });
  await check("een verkeerde waarde wordt geweigerd en er wordt niets gezet", async () => {
    for (const fout of [{ plateDisplay: "wire" }, { plateDisplay: true }, { plateDisplay: 2 }, { plateDisplay: null }, { mesh: "ja" }, { mesh: 1 }]) {
      gezet.length = 0;
      await assert.rejects(() => voer(fout), /3D-zichtbaarheidsoptie|volume, surface of mesh|plateDisplay|mesh/, JSON.stringify(fout));
      assert.equal(gezet.length, 0, `niets gezet bij ${JSON.stringify(fout)}`);
    }
  });
}

/* ── [7] Scherm ──────────────────────────────────────────────────────── */
console.log("\n[7] Keuzegroep, lint, teksten en tekenvlak");
await check("het venster Zichtbaarheid en de verkenner: de keuzegroep onder Platen, geen schakelaar Mesh meer", () => {
  const venster = bron("./src/components/openFem3d/OpenFem3DVisibilityDialog.tsx");
  assert.match(venster, /<OpenFem3DPlateDisplayChoice\b/);
  assert.doesNotMatch(venster, /"plates", "mesh"/, "geen schakelaar mesh in de groep Geometrie");
  assert.match(venster, /key === "plates"/, "direct onder Platen");
  const verkenner = bron("./src/components/fem/ExplorerViewTab.tsx");
  assert.match(verkenner, /<OpenFem3DPlateDisplayChoice\b/);
  assert.match(verkenner, /key === "plates"/, "direct onder Platen");
  assert.doesNotMatch(verkenner, /\bmesh: gridIcon/, "geen pictogram voor een schakelaar mesh");
  const keuze = bron("./src/components/openFem3d/OpenFem3DPlateDisplayChoice.tsx");
  assert.match(keuze, /role="radiogroup"/);
  assert.match(keuze, /role="radio"/);
  assert.match(keuze, /aria-checked=/);
  assert.match(keuze, /OPEN_FEM_3D_PLATE_DISPLAYS\.map/);
});
await check("het lint: drie knoppen in de groep Weergave, de actieve licht op, met dekking in LINT_3D", () => {
  const lint = bron("./src/components/ribbon/HomeTab.tsx");
  const groep = /<RibbonGroup label=\{t\("openFem3d\.viewGroup"\)\}>[\s\S]*?<\/RibbonGroup>/.exec(lint)?.[0] ?? "";
  for (const stand of ["Volume", "Surface", "Mesh"]) {
    assert.match(groep, new RegExp(`t\\("openFem3d\\.plateDisplay${stand}"\\)`), `knop ${stand} in de groep Weergave`);
  }
  assert.match(groep, /active=\{openFem3dPlateDisplay === stand\}|active=\{openFem3dPlateDisplay === "volume"\}/, "de actieve knop licht op");
  const dekking = bron("./src/api/dekking.ts");
  for (const stand of ["Volume", "Surface", "Mesh"]) assert.match(dekking, new RegExp(`"ribbon:openFem3d\\.plateDisplay${stand}"`));
  const app = bron("./src/App.tsx");
  assert.match(app, /openFem3dPlateDisplay=\{openFem3dVisibility\.plateDisplay\}/);
  assert.match(app, /onOpenFem3DPlateDisplayChange=/);
  assert.match(bron("./src/components/ribbon/Ribbon.tsx"), /onOpenFem3DPlateDisplayChange=\{onOpenFem3DPlateDisplayChange\}/);
});
await check("teksten in nl, en, de en fr (keuzegroep en lint), geen tekst voor de oude schakelaar", () => {
  const per = {};
  for (const taal of ["nl", "en", "de", "fr"]) {
    const common = JSON.parse(bron(`./src/i18n/locales/${taal}/common.json`));
    const ribbon = JSON.parse(bron(`./src/i18n/locales/${taal}/ribbon.json`));
    for (const k of ["plateDisplay", "plateDisplayHint", "plateDisplayVolume", "plateDisplaySurface", "plateDisplayMesh",
      "plateDisplayVolumeHint", "plateDisplaySurfaceHint", "plateDisplayMeshHint"]) {
      const tekst = common.openFem3dVisibility?.[k];
      assert.equal(typeof tekst, "string", `${taal}: openFem3dVisibility.${k}`);
      assert.ok(tekst.trim(), `${taal}: ${k} leeg`);
    }
    assert.equal(common.openFem3dVisibility.mesh, undefined, `${taal}: openFem3dVisibility.mesh hoort weg`);
    for (const k of ["plateDisplayVolume", "plateDisplaySurface", "plateDisplayMesh",
      "plateDisplayVolumeHint", "plateDisplaySurfaceHint", "plateDisplayMeshHint"]) {
      const tekst = ribbon.openFem3d?.[k];
      assert.equal(typeof tekst, "string", `${taal}: ribbon openFem3d.${k}`);
      assert.ok(tekst.trim(), `${taal}: ribbon ${k} leeg`);
    }
    per[taal] = common.openFem3dVisibility.plateDisplayHint;
  }
  assert.equal(new Set(Object.values(per)).size, 4, "vier eigen toelichtingen");
});
await check("het tekenvlak leest alleen plateDisplay; wisselen neemt een snel pad dat alleen de plaatlaag opbouwt", () => {
  const canvas = bron("./src/components/openFem3d/ThreeFrameCanvas.tsx");
  assert.doesNotMatch(canvas, /visibility\.mesh\b/, "geen visibility.mesh meer");
  assert.match(canvas, /visibilityChangedOnly\("plateDisplay"\)/);
  assert.match(canvas, /"plate-display"/);
  assert.match(canvas, /showMesh: OPEN_FEM_3D_PLATE_DISPLAY_STYLES\[visibility\.plateDisplay\]\.showMesh/);
  // Elke plaat wordt in de gekozen stand gemaakt: volledige opbouw, bewerken, verplaatsen.
  assert.doesNotMatch(canvas, /createOpenFem3DPlateGeometry\(model, (plate|changedPlate), nodeByIdRef\.current \?\? undefined\)/,
    "geen plaatgeometrie zonder de gekozen stand");
  // Het lastvlak van een oppervlaktelast volgt de stand, en het snelle pad
  // zet het mee wanneer de getekende dikte verandert (van of naar volume).
  assert.match(canvas, /openFem3DSurfaceLoadSurface\(model, plate, load, nodeByIdRef\.current \?\? undefined,\s*visibility\.plateDisplay\)/,
    "lastvlak in de gekozen stand");
  const snelPad = /if \(plateDisplayOnly\) \{[\s\S]*?writeBuildMode\(containerRef\.current, "plate-display"\)/.exec(canvas)?.[0] ?? "";
  assert.match(snelPad, /replaceSurfaceLoadLayer\(plateGeometryFor\)/, "het snelle pad vervangt de lastlaag mee");
  const editor = bron("./src/components/openFem3d/OpenFem3DEditor.tsx");
  assert.match(editor, /visibility\.plateDisplay === "mesh"/, "het rekennet zonder resultaat alleen voor de stand mesh");
  assert.doesNotMatch(editor, /visibility\.mesh\b/);
});
await check("de browserproef van het tekenvlak staat in de batterij", () => {
  const runner = bron("./scripts/run-tests.mjs");
  assert.match(runner, /"open-fem3d-plaatweergave"/);
  assert.match(runner, /"open-fem3d-plaatweergave-ui"/);
});

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
if (gefaald > 0) process.exit(1);

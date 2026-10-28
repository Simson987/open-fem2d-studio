// Grootte van knopen en opleggingen in 3D (issue #82).
//
// WAAROM DEZE TEST BESTAAT
// De knoopbol heeft een automatische straal (uit de modelgrootte) en de
// opleggingssymbolen een automatische maat. Bij een heel groot of heel klein
// model zijn ze soms te groot of te klein, en er was geen regelaar. Nu zijn er
// twee: Knopen en Opleggingen, elk 25–400 % van de automatische maat,
// standaard 100 %. Ze zijn weergavevoorkeuren: bewaard met de andere
// zichtbaarheidsinstellingen (dezelfde opslag en parser) en in een opgeslagen
// view. Precies de fouten die hieronder vallen: een oude opslag of view die
// geen 100 % oplevert, een waarde buiten 25–400 % die blijft staan, een
// regelaar waarop 100 % niet precies te kiezen is, een schaal die ook de
// lasten vergroot (de lasten delen de automatische maat met de opleggingen),
// randopleggingen van platen of scharnierbolletjes die niet meeschalen, een
// rapportbeeld dat de schaal van zijn view negeert, en een bedieningskanaal of
// MCP-schema dat de waarden weigert.
//
// Elk getal volgt uit de invoer: schaal = procent / 100, getekende maat =
// automatische maat × schaal; 100 % is precies de oude tekening.
//
// Checks:
//  [1] SCHAAL       — standaard 100 %, begrenzen tot 25–400 %, afronden op
//                     hele procenten, ongeldig → 100 %, maat × schaal.
//  [2] REGELAAR     — standen van 25 tot 400 %, 100 % precies in het midden,
//                     oplopend, heen en terug gelijk, dichtstbijzijnde stand
//                     (logaritmisch) voor een vrije waarde.
//  [3] OPSLAG       — de twee waarden in de zichtbaarheid; oude opslag zonder
//                     de waarden: 100 %; ongeldig begrensd; geen aan/uit-vlag
//                     (lijst van vlaggen zonder de schalen).
//  [4] VIEWS        — opgeslagen view (ook via het projectbestand) bewaart en
//                     leest de waarden; een oude view zonder de waarden:
//                     100 %; een standaardview houdt de huidige schaal; het
//                     rapport tekent een standaardview op 100 % en een eigen
//                     view op zijn eigen schaal.
//  [5] TEKENMAAT    — opleggingen (los en in GPU-batches) en randopleggingen
//                     van platen × de opleggingsschaal; lasten blijven gelijk;
//                     scharnierbolletjes volgen de knoopbol.
//  [6] RAPPORTBEELD — knoopcirkel en opleggingsteken × de schaal van de view;
//                     de top van het teken blijft tegen de knoopcirkel.
//  [7] KANAAL       — gui_configure_3d_view kent beide (MCP-schema, getal
//                     25–400) en het bedieningskanaal zet ze (begrensd), en
//                     weigert een verkeerd type.
//  [8] SCHERM       — de regelaars in het venster Zichtbaarheid en in de
//                     verkenner, de teksten in vier talen, het snelle pad in
//                     het tekenvlak en de browserproef in de batterij (het
//                     gedrag op het scherm toetst test-open-fem3d-symboolschaal-ui.mjs).
//
// Uitvoeren: node scripts/run-tests.mjs --filter=open-fem3d-symboolschaal
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import * as THREE from "three";

// Het bedieningskanaal trekt onderdelen met stylesheets mee; Node kent die
// niet. Een lege module volstaat (zoals in test-open-fem3d-peilmaten.mjs).
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function load(url, ctx, next) {" +
        " if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };" +
        " return next(url, ctx); }",
    ),
);

const S = await import("./src/components/openFem3d/openFem3dSymbolScale.ts");
const V = await import("./src/components/openFem3d/openFem3dVisibility.ts");
const { parseOpenFem3DViewSets, bewaarOpenFem3DViewSet } = await import("./src/components/openFem3d/openFem3dViewSets.ts");
const { openFem3DStandaardViewToepassing, openFem3DRapportViews } = await import("./src/components/openFem3d/openFem3dStandaardViews.ts");
const {
  addOpenFem3DConditionMarkers, openFem3DConditionMarkerSize, openFem3DBeamHingePlacements,
} = await import("./src/components/openFem3d/openFem3dMarkers.ts");
const { buildOpenFem3DPlateOverlay } = await import("./src/components/openFem3d/openFem3dPlateOverlay.ts");
const { OPEN_FEM_3D_SUPPORT_PRESETS, parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");
const {
  openFem3DRapportBeeld, openFem3DRapportOpleggingMaten, openFem3DRapportOpleggingPad, RAPPORT_BEELD_BREEDTE, RAPPORT_BEELD_HOOGTE,
} = await import("./src/components/openFem3d/openFem3dRapportBeeld.ts");

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

/* ── [1] Schaal ──────────────────────────────────────────────────────── */
console.log("[1] De schaal: standaard, begrenzen, maat × schaal");
await check("grenzen en standaard: 25, 400, 100", () => {
  assert.equal(S.OPEN_FEM_3D_SYMBOL_PERCENT_MIN, 25);
  assert.equal(S.OPEN_FEM_3D_SYMBOL_PERCENT_MAX, 400);
  assert.equal(S.OPEN_FEM_3D_SYMBOL_PERCENT_DEFAULT, 100);
});
await check("binnen het bereik blijft de waarde staan, afgerond op hele procenten", () => {
  for (const p of [25, 50, 100, 137, 250, 400]) assert.equal(S.normalizeOpenFem3DSymbolPercent(p), p, String(p));
  assert.equal(S.normalizeOpenFem3DSymbolPercent(137.4), 137);
  assert.equal(S.normalizeOpenFem3DSymbolPercent(137.6), 138);
});
await check("buiten het bereik begrensd tot 25–400 %", () => {
  assert.equal(S.normalizeOpenFem3DSymbolPercent(10), 25);
  assert.equal(S.normalizeOpenFem3DSymbolPercent(0), 25);
  assert.equal(S.normalizeOpenFem3DSymbolPercent(-50), 25);
  assert.equal(S.normalizeOpenFem3DSymbolPercent(401), 400);
  assert.equal(S.normalizeOpenFem3DSymbolPercent(1e6), 400);
});
await check("geen getal (ontbreekt, tekst, NaN, oneindig, null, boolean): 100 %", () => {
  for (const v of [undefined, null, "200", "groot", Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, true, {}, [150]]) {
    assert.equal(S.normalizeOpenFem3DSymbolPercent(v), 100, JSON.stringify(v) ?? String(v));
  }
});
await check("schaal = procent / 100; ook begrensd", () => {
  assert.equal(S.openFem3DSymbolScaleFactor(100), 1);
  assert.equal(S.openFem3DSymbolScaleFactor(200), 2);
  assert.equal(S.openFem3DSymbolScaleFactor(25), 0.25);
  assert.equal(S.openFem3DSymbolScaleFactor(400), 4);
  assert.equal(S.openFem3DSymbolScaleFactor(5), 0.25);
  assert.equal(S.openFem3DSymbolScaleFactor(undefined), 1);
});
await check("getekende maat = automatische maat × schaal; 100 % is precies de automatische maat", () => {
  assert.equal(S.openFem3DScaledSymbolSize(0.3, 100), 0.3);
  assert.ok(dichtbij(S.openFem3DScaledSymbolSize(0.3, 200), 0.6));
  assert.ok(dichtbij(S.openFem3DScaledSymbolSize(0.08, 50), 0.04));
  assert.ok(dichtbij(S.openFem3DScaledSymbolSize(0.08, 1000), 0.32), "begrensd op 400 %");
  assert.equal(S.openFem3DScaledSymbolSize(0.077, undefined), 0.077, "oude zichtbaarheid zonder veld: ongewijzigd");
});

/* ── [2] Regelaar ────────────────────────────────────────────────────── */
console.log("\n[2] De regelaar in standen");
const STANDEN = S.OPEN_FEM_3D_SYMBOL_PERCENT_STOPS;
await check("standen van 25 tot 400 %, oplopend, elk binnen het bereik", () => {
  assert.equal(STANDEN[0], 25);
  assert.equal(STANDEN[STANDEN.length - 1], 400);
  assert.ok(STANDEN.every((p, i) => i === 0 || p > STANDEN[i - 1]), JSON.stringify(STANDEN));
  assert.ok(STANDEN.every((p) => S.normalizeOpenFem3DSymbolPercent(p) === p));
});
await check("100 % is een stand, precies in het midden (evenveel standen eronder als erboven)", () => {
  const i = STANDEN.indexOf(100);
  assert.ok(i > 0);
  assert.equal(i, STANDEN.length - 1 - i, JSON.stringify(STANDEN));
  assert.equal(S.openFem3DSymbolSliderFromPercent(100), i);
  assert.equal(S.openFem3DSymbolPercentFromSlider(i), 100);
});
await check("heen en terug: elke stand geeft zijn eigen positie", () => {
  STANDEN.forEach((p, i) => {
    assert.equal(S.openFem3DSymbolSliderFromPercent(p), i, String(p));
    assert.equal(S.openFem3DSymbolPercentFromSlider(i), p, String(i));
  });
});
await check("een vrije waarde (bv. via MCP) zet de regelaar op de dichtstbijzijnde stand, logaritmisch", () => {
  const dichtst = (p) => STANDEN.reduce((best, s) => Math.abs(Math.log(s / p)) < Math.abs(Math.log(best / p)) ? s : best);
  for (const p of [26, 33, 47, 105, 137, 180, 222, 333, 390]) {
    assert.equal(S.openFem3DSymbolPercentFromSlider(S.openFem3DSymbolSliderFromPercent(p)), dichtst(p), String(p));
  }
});
await check("een positie buiten de regelaar wordt de eerste of laatste stand", () => {
  assert.equal(S.openFem3DSymbolPercentFromSlider(-3), 25);
  assert.equal(S.openFem3DSymbolPercentFromSlider(999), 400);
  assert.equal(S.openFem3DSymbolPercentFromSlider(Number.NaN), 100);
});

/* ── [3] Opslag ──────────────────────────────────────────────────────── */
console.log("\n[3] Bewaard met de zichtbaarheid");
await check("de zichtbaarheid draagt beide waarden, standaard 100 %", () => {
  assert.equal(DEFAULT.nodeSizePercent, 100);
  assert.equal(DEFAULT.supportSizePercent, 100);
});
await check("het zijn geen aan/uit-vlaggen: niet in de lijst van vlaggen, wel in de lijst van schalen", () => {
  assert.deepEqual([...V.OPEN_FEM_3D_SYMBOL_SCALE_KEYS], ["nodeSizePercent", "supportSizePercent"]);
  assert.ok(!V.OPEN_FEM_3D_VISIBILITY_FLAGS.includes("nodeSizePercent"));
  assert.ok(!V.OPEN_FEM_3D_VISIBILITY_FLAGS.includes("supportSizePercent"));
  assert.ok(V.OPEN_FEM_3D_VISIBILITY_FLAGS.every((k) => typeof DEFAULT[k] === "boolean"));
  // Alle sleutels = de vlaggen + deze twee schalen + de plaatweergave (issue
  // #78, een keuze uit drie standen; test-open-fem3d-plaatweergave.mjs) + de
  // section box (issue #86) + de explode-stand (issue #104).
  assert.equal(V.OPEN_FEM_3D_VISIBILITY_FLAGS.length + 2 + 1 + 1 + 1, Object.keys(DEFAULT).length);
});
await check("dezelfde parser voor opslag en views: vlaggen alleen als boolean, schalen begrensd", () => {
  const v = V.normalizeOpenFem3DVisibility({ nodes: false, supports: "nee", nodeSizePercent: 1000, supportSizePercent: 60 });
  assert.equal(v.nodes, false);
  assert.equal(v.supports, true, "geen boolean: de standaard");
  assert.equal(v.nodeSizePercent, 400);
  assert.equal(v.supportSizePercent, 60);
  assert.deepEqual(V.normalizeOpenFem3DVisibility(null), DEFAULT);
  assert.deepEqual(V.normalizeOpenFem3DVisibility([1, 2]), DEFAULT);
});
await check("oude bewaarde instellingen zonder de waarden: 100 %; bewaard 250 % en 40 % komen terug", () => {
  const bewaard = { waarde: JSON.stringify({ nodes: false, structuralGrid: false }) };
  globalThis.localStorage = { getItem: () => bewaard.waarde, setItem: (_k, v) => { bewaard.waarde = v; } };
  try {
    const oud = V.readOpenFem3DVisibility();
    assert.equal(oud.nodeSizePercent, 100);
    assert.equal(oud.supportSizePercent, 100);
    assert.equal(oud.nodes, false);
    V.saveOpenFem3DVisibility({ ...oud, nodeSizePercent: 250, supportSizePercent: 40 });
    const terug = V.readOpenFem3DVisibility();
    assert.equal(terug.nodeSizePercent, 250);
    assert.equal(terug.supportSizePercent, 40);
    assert.equal(terug.nodes, false);
  } finally {
    delete globalThis.localStorage;
  }
});
await check("ongeldige bewaarde waarden: begrensd of 100 %", () => {
  globalThis.localStorage = { getItem: () => JSON.stringify({ nodeSizePercent: 3, supportSizePercent: "groot" }), setItem: () => {} };
  try {
    const v = V.readOpenFem3DVisibility();
    assert.equal(v.nodeSizePercent, 25);
    assert.equal(v.supportSizePercent, 100);
  } finally {
    delete globalThis.localStorage;
  }
});

/* ── [4] Views ───────────────────────────────────────────────────────── */
console.log("\n[4] Opgeslagen views en rapport");
const camera = { position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1] };
await check("een oude view zonder de waarden: 100 %; de andere vlaggen blijven zoals bewaard", () => {
  const [oud] = parseOpenFem3DViewSets([{ id: "view-1", name: "Oud", view: "iso", camera, visibility: { supports: false }, combinationId: null }]);
  assert.equal(oud.visibility.nodeSizePercent, 100);
  assert.equal(oud.visibility.supportSizePercent, 100);
  assert.equal(oud.visibility.supports, false);
});
await check("een view met eigen waarden houdt ze; buiten het bereik begrensd; geen getal 100 %", () => {
  const [a, b] = parseOpenFem3DViewSets([
    { id: "view-1", name: "Groot", view: "iso", camera, visibility: { nodeSizePercent: 300, supportSizePercent: 50 }, combinationId: null },
    { id: "view-2", name: "Fout", view: "iso", camera, visibility: { nodeSizePercent: 9999, supportSizePercent: "x" }, combinationId: null },
  ]);
  assert.equal(a.visibility.nodeSizePercent, 300);
  assert.equal(a.visibility.supportSizePercent, 50);
  assert.equal(b.visibility.nodeSizePercent, 400);
  assert.equal(b.visibility.supportSizePercent, 100);
});
await check("huidige weergave opslaan legt de waarden vast, en ze overleven het projectbestand (JSON)", () => {
  const huidig = { view: "iso", camera, visibility: { ...DEFAULT, nodeSizePercent: 175, supportSizePercent: 60 },
    combinationId: null, loadCaseId: 1, mode: "model" };
  const views = bewaarOpenFem3DViewSet([], "Detail", huidig);
  const [terug] = parseOpenFem3DViewSets(JSON.parse(JSON.stringify(views)));
  assert.equal(terug.visibility.nodeSizePercent, 175);
  assert.equal(terug.visibility.supportSizePercent, 60);
});
await check("projectbestand (ook de MCP-server zonder app leest en schrijft het zo): de waarden overleven de tekst", async () => {
  const { documentNaarTekst, documentUitTekst, leegDocument } = await import("./src/api/projectDocument.ts");
  const metViews = { ...leegDocument(), openFem3dViewSets: [
    { id: "groot", name: "Groot", view: "iso", camera, visibility: { nodeSizePercent: 250, supportSizePercent: 40 }, combinationId: null },
    { id: "oud", name: "Oud", view: "iso", camera, visibility: { nodes: false }, combinationId: null },
  ] };
  const [groot, oud] = documentUitTekst(documentNaarTekst(metViews)).openFem3dViewSets ?? [];
  assert.equal(groot.visibility.nodeSizePercent, 250);
  assert.equal(groot.visibility.supportSizePercent, 40);
  assert.equal(oud.visibility.nodeSizePercent, 100);
  assert.equal(oud.visibility.supportSizePercent, 100);
  assert.equal(oud.visibility.nodes, false);
});
const portaal = parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 4 }, { id: 3, x: 6, y: 0, z: 4 }, { id: 4, x: 6, y: 0, z: 0 }],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA 200", material: "S235" },
    { id: 2, startNodeId: 2, endNodeId: 3, profileName: "IPE 300", material: "S235" },
    { id: 3, startNodeId: 3, endNodeId: 4, profileName: "HEA 200", material: "S235" },
  ],
  supports: [{ nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.pinned }, { nodeId: 4, ...OPEN_FEM_3D_SUPPORT_PRESETS.fixed }],
  loads: [{ id: 1, nodeId: 2, fx: 5, fy: 0, fz: -10, mx: 0, my: 0, mz: 0 }],
});
await check("een standaardview toepassen laat de huidige schaal staan (alleen de inhoudslagen liggen vast)", () => {
  const t = openFem3DStandaardViewToepassing("geometrie", {
    visibility: { ...DEFAULT, nodeSizePercent: 50, supportSizePercent: 300 },
    activeCombinationId: null, maatgevendeCombinationId: null, activeLoadCaseId: 1,
  });
  assert.equal(t.visibility.nodeSizePercent, 50);
  assert.equal(t.visibility.supportSizePercent, 300);
});
await check("rapport: een standaardview op de vaste basis (100 %), een eigen view op zijn eigen schaal", () => {
  const [eigen] = parseOpenFem3DViewSets([{ id: "view-1", name: "Groot", view: "front", camera, mode: "model",
    visibility: { nodeSizePercent: 200, supportSizePercent: 300 }, combinationId: null }]);
  const views = openFem3DRapportViews({
    model: portaal, viewSets: [eigen], standaardUitRapport: [], result: null, combinations: [],
    activeLoadCaseId: 1, activeCombinationId: null, heeftToetsing: false,
  });
  const geometrie = views.find((v) => v.standaard === "geometrie");
  assert.equal(geometrie.lagen.nodeSizePercent, 100);
  assert.equal(geometrie.lagen.supportSizePercent, 100);
  const groot = views.find((v) => v.naam === "Groot");
  assert.equal(groot.lagen.nodeSizePercent, 200);
  assert.equal(groot.lagen.supportSizePercent, 300);
});

/* ── [5] Tekenmaat ───────────────────────────────────────────────────── */
console.log("\n[5] Getekende maat van opleggingen, lasten en scharnierbolletjes");
/** Wereldgrootte (diagonaal van de omhullende) van alle delen van een soort. */
function omvang(groep, filter) {
  const box = new THREE.Box3();
  groep.updateMatrixWorld(true);
  for (const kind of groep.children) {
    if (!filter(kind)) continue;
    if (kind instanceof THREE.InstancedMesh) { kind.computeBoundingBox(); box.union(kind.boundingBox.clone().applyMatrix4(kind.matrixWorld)); }
    else box.expandByObject(kind);
  }
  return box.isEmpty() ? 0 : box.getSize(new THREE.Vector3()).length();
}
const isOplegging = (o) => o.userData.type === "node";
const isLast = (o) => o.userData.type === "nodalLoad";
/** Eén oplegging: omhullende van het teken rond knoop 1, zonder bundeling. */
function eenOplegging(preset, percent) {
  const model = parseOpenFem3DModel({ nodes: portaal.nodes, beams: [], supports: [{ nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS[preset] }] });
  const groep = new THREE.Group();
  addOpenFem3DConditionMarkers(groep, model, { supports: true, loads: false, supportSizePercent: percent });
  return groep;
}
await check("een losse oplegging (scharnier, inklemming, rol, scharnier om één as) is bij 200 % twee keer zo groot, bij 50 % half zo groot", () => {
  for (const preset of ["pinned", "fixed", "zRoller", "revoluteY"]) {
    assert.ok(OPEN_FEM_3D_SUPPORT_PRESETS[preset], preset);
    const basis = omvang(eenOplegging(preset, 100), isOplegging);
    assert.ok(basis > 0, preset);
    assert.ok(dichtbij(omvang(eenOplegging(preset, 200), isOplegging) / basis, 2, 1e-6), `${preset} 200 %`);
    assert.ok(dichtbij(omvang(eenOplegging(preset, 50), isOplegging) / basis, 0.5, 1e-6), `${preset} 50 %`);
  }
});
await check("100 % (of geen veld) tekent precies de oude maat: openFem3DConditionMarkerSize", () => {
  const groep = new THREE.Group();
  addOpenFem3DConditionMarkers(groep, parseOpenFem3DModel({ nodes: portaal.nodes, beams: [], supports: [{ nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.pinned }] }),
    { supports: true, loads: false });
  const kegel = groep.children.find((c) => c.geometry?.type === "ConeGeometry");
  assert.ok(dichtbij(kegel.geometry.parameters.height, openFem3DConditionMarkerSize(portaal.nodes)));
  const dubbel = eenOplegging("pinned", 200).children.find((c) => c.geometry?.type === "ConeGeometry");
  assert.ok(dichtbij(dubbel.geometry.parameters.height, 2 * openFem3DConditionMarkerSize(portaal.nodes)));
});
await check("een veer en een opgelegde verplaatsing schalen mee (horen bij het opleggingsteken)", () => {
  const model = (percent) => {
    const m = parseOpenFem3DModel({ nodes: portaal.nodes, beams: [],
      supports: [{ nodeId: 1, ux: true, uy: true, uz: false, rx: false, ry: false, rz: false, springs: { kzKnPerM: 5000 }, prescribed: { uxM: 0.01 } }] });
    const groep = new THREE.Group();
    addOpenFem3DConditionMarkers(groep, m, { supports: true, loads: false, supportSizePercent: percent });
    return groep;
  };
  const basis = omvang(model(100), isOplegging);
  assert.ok(dichtbij(omvang(model(300), isOplegging) / basis, 3, 1e-6));
});
await check("in GPU-batches (vanaf vier tekens): elk opleggingsteken × de schaal, de knooplast blijft gelijk", () => {
  const veel = parseOpenFem3DModel({
    nodes: [0, 6, 12, 18].map((x, i) => ({ id: i + 1, x, y: 0, z: 0 })), beams: [],
    supports: [1, 2, 3, 4].map((nodeId) => ({ nodeId, ...OPEN_FEM_3D_SUPPORT_PRESETS.pinned })),
    loads: [{ id: 1, nodeId: 2, fx: 0, fy: 0, fz: -10, mx: 0, my: 0, mz: 0 }],
  });
  const teken = (percent) => {
    const groep = new THREE.Group();
    addOpenFem3DConditionMarkers(groep, veel, { supports: true, loads: true, supportSizePercent: percent });
    return groep;
  };
  const [g100, g200] = [teken(100), teken(200)];
  assert.ok(g200.children.some((c) => c instanceof THREE.InstancedMesh && c.userData.type === "node"), "gebundeld");
  // Per oplegging de hoogte van het teken (z-bereik): de hoogte van één teken, niet van de rij.
  const hoogte = (groep) => { const b = new THREE.Box3(); for (const c of groep.children) if (isOplegging(c)) { c.computeBoundingBox?.(); b.union(c.boundingBox ?? new THREE.Box3().setFromObject(c)); } return b.max.z - b.min.z; };
  assert.ok(dichtbij(hoogte(g200) / hoogte(g100), 2, 1e-6), `${hoogte(g200)} / ${hoogte(g100)}`);
  assert.ok(dichtbij(omvang(g200, isLast), omvang(g100, isLast), 1e-12), "knooplast ongewijzigd");
  assert.ok(omvang(g100, isLast) > 0);
});
await check("lasten veranderen niet met de opleggingsschaal (de knooplast van het portaal)", () => {
  const teken = (percent) => {
    const groep = new THREE.Group();
    addOpenFem3DConditionMarkers(groep, portaal, { supports: false, loads: true, supportSizePercent: percent });
    return groep;
  };
  assert.ok(dichtbij(omvang(teken(25), isLast), omvang(teken(400), isLast), 1e-12));
});
await check("randopleggingen van een plaat schalen mee met de opleggingsschaal", () => {
  const plaat = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6, y: 6, z: 0 }, { id: 4, x: 0, y: 6, z: 0 }],
    beams: [],
    plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2, material: "C30/37", edgeSupports: [{ edge: 0, ...OPEN_FEM_3D_SUPPORT_PRESETS.pinned }] }],
  });
  const kegel = (percent) => {
    const overlay = buildOpenFem3DPlateOverlay({
      model: plaat, mesh: null, result: null, quantity: null, showMesh: false, showPlates: true, showSupports: true,
      deformation: false, deformationScale: 1, supportSizePercent: percent,
    });
    const tekens = overlay.group.getObjectByName("open-fem3d-plate-edge-supports");
    const kegels = tekens.children.filter((c) => c.geometry?.type === "ConeGeometry");
    assert.ok(kegels.length > 0, `${percent} %: kegels`);
    return Math.max(...kegels.map((c) => c.geometry.parameters.height));
  };
  assert.ok(dichtbij(kegel(200) / kegel(100), 2, 1e-9), `${kegel(200)} / ${kegel(100)}`);
  assert.ok(dichtbij(kegel(50) / kegel(100), 0.5, 1e-9));
});
await check("scharnierbolletjes volgen de knoopbol: een twee keer zo grote knoopbol geeft een twee keer zo groot bolletje", () => {
  const lang = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 12, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 300", material: "S235",
      releases: { myStart: true, mzStart: true, myEnd: true, mzEnd: true, torsionStart: false, torsionEnd: false } }],
  });
  const maat = openFem3DConditionMarkerSize(lang.nodes);
  const bol = (nodeRadius) => openFem3DBeamHingePlacements(lang, { nodeRadius, markerSize: maat, minRadius: 0.04375 })[0];
  const [een, twee] = [bol(S.openFem3DScaledSymbolSize(0.08, 100)), bol(S.openFem3DScaledSymbolSize(0.08, 200))];
  assert.ok(een && twee, "bolletjes");
  assert.ok(dichtbij(twee.radius / een.radius, 2, 1e-9), `${twee.radius} / ${een.radius}`);
});

/* ── [6] Rapportbeeld ────────────────────────────────────────────────── */
console.log("\n[6] Rapportbeeld");
const beeld = (lagen) => openFem3DRapportBeeld({ model: portaal, lagen, view: "front", camera: null, resultaat: null, utilizations: [], loadCaseId: 1 });
await check("100 %: de oude maten (knoopcirkel 3,4 px, opleggingsteken schaal 1)", () => {
  const b = beeld({ ...DEFAULT });
  assert.equal(b.knoopStraal, 3.4);
  assert.equal(b.opleggingSchaal, 1);
});
await check("de schaal van de view: knopen 200 % en opleggingen 50 %", () => {
  const b = beeld({ ...DEFAULT, nodeSizePercent: 200, supportSizePercent: 50 });
  assert.ok(dichtbij(b.knoopStraal, 6.8));
  assert.equal(b.opleggingSchaal, 0.5);
  assert.equal(b.opleggingen.length, 2, "beide opleggingen getekend");
});
await check("opleggingsteken bij 100 % / 100 %: precies het oude pad (top 4 px onder het midden, 16 × 13 px)", () => {
  assert.equal(openFem3DRapportOpleggingPad({ x: 10, y: 20 }, 3.4, 1), "M 10 24 l -8 13 h 16 z");
});
await check("de top van het opleggingsteken ligt altijd 0,6 px onder de knoopcirkel, ook als de schalen verschillen", () => {
  // Knopen 100 % en opleggingen 400 %: vroeger schaalde de top mee (16 px
  // onder het midden), en hing het teken 12,6 px los onder de knoop.
  for (const [knopen, opleggingen] of [[100, 100], [100, 400], [100, 200], [400, 100], [25, 400], [400, 25], [200, 200]]) {
    const b = beeld({ ...DEFAULT, nodeSizePercent: knopen, supportSizePercent: opleggingen });
    const m = openFem3DRapportOpleggingMaten(b.knoopStraal, b.opleggingSchaal);
    assert.ok(dichtbij(m.top - b.knoopStraal, 0.6), `${knopen}/${opleggingen}: spleet ${m.top - b.knoopStraal}`);
    assert.ok(dichtbij(m.halfBreed, 8 * opleggingen / 100), `${knopen}/${opleggingen}: halve breedte`);
    assert.ok(dichtbij(m.hoog, 13 * opleggingen / 100), `${knopen}/${opleggingen}: hoogte`);
    const pad = openFem3DRapportOpleggingPad({ x: 0, y: 0 }, b.knoopStraal, b.opleggingSchaal);
    assert.match(pad, new RegExp(`^M 0 ${m.top} l ${-m.halfBreed} ${m.hoog} h ${2 * m.halfBreed} z$`), pad);
  }
});
await check("opleggingstekens vallen binnen het beeld, ook bij 400 %", () => {
  for (const [knopen, opleggingen] of [[100, 400], [400, 400], [400, 25]]) {
    const b = beeld({ ...DEFAULT, nodeSizePercent: knopen, supportSizePercent: opleggingen });
    const m = openFem3DRapportOpleggingMaten(b.knoopStraal, b.opleggingSchaal);
    for (const q of b.opleggingen) {
      assert.ok(q.y + m.top + m.hoog + 1 <= RAPPORT_BEELD_HOOGTE + 1e-9, `${knopen}/${opleggingen}: onderkant ${q.y + m.top + m.hoog}`);
      assert.ok(q.x - m.halfBreed - 1 >= -1e-9 && q.x + m.halfBreed + 1 <= RAPPORT_BEELD_BREEDTE + 1e-9, `${knopen}/${opleggingen}: zijkanten`);
    }
  }
});
await check("de svg tekent met deze maten (OpenFem3DReportViews.tsx)", () => {
  const svg = bron("./src/components/openFem3d/OpenFem3DReportViews.tsx");
  assert.match(svg, /r=\{beeld\.knoopStraal\}/);
  assert.match(svg, /openFem3DRapportOpleggingPad\(q, beeld\.knoopStraal, beeld\.opleggingSchaal\)/);
});

/* ── [7] Bedieningskanaal en MCP ─────────────────────────────────────── */
console.log("\n[7] Bedieningskanaal (gui_configure_3d_view)");
await check("het MCP-schema kent beide als getal van 25 tot 400 (strikt schema: anders geweigerd)", () => {
  const gui = bron("../src-tauri/crates/openaec-mcp-server/src/gui_tools.rs");
  const schema = /"name": "gui_configure_3d_view"[\s\S]*?"structural_grid"/.exec(gui)?.[0] ?? "";
  for (const sleutel of ["nodeSizePercent", "supportSizePercent"]) {
    assert.match(schema, new RegExp(`"${sleutel}":\\{"type":"number","minimum":25,"maximum":400`), sleutel);
  }
  assert.match(gui, /"nodeSizePercent"\]\["maximum"\], json!\(400\)/, "unittest in gui_tools.rs");
  assert.match(bron("../src-tauri/crates/openaec-mcp-server/tests/schema_strikt.rs"), /supportSizePercent/, "schema_strikt.rs");
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
  await check("weergave_3d_configureren zet knopen op 200 % en opleggingen op 50 %; de rest blijft staan", async () => {
    gezet.length = 0;
    const uit = await voer({ nodeSizePercent: 200, supportSizePercent: 50 });
    assert.equal(gezet.length, 1);
    assert.equal(gezet[0].nodeSizePercent, 200);
    assert.equal(gezet[0].supportSizePercent, 50);
    assert.equal(gezet[0].nodes, true);
    assert.equal(uit.zichtbaarheid.nodeSizePercent, 200, "het antwoord meldt de waarde");
  });
  await check("samen met een vlag; buiten het bereik begrensd", async () => {
    gezet.length = 0;
    await voer({ supports: false, nodeSizePercent: 1000, supportSizePercent: 1 });
    assert.equal(gezet[0].supports, false);
    assert.equal(gezet[0].nodeSizePercent, 400);
    assert.equal(gezet[0].supportSizePercent, 25);
  });
  await check("een verkeerd type wordt geweigerd: tekst of boolean voor een schaal, een getal voor een vlag", async () => {
    for (const fout of [{ nodeSizePercent: "groot" }, { supportSizePercent: true }, { nodes: 100 }, { nodeSizePercent: Number.NaN }]) {
      gezet.length = 0;
      await assert.rejects(() => voer(fout), /3D-zichtbaarheidsoptie|tussen 25 en 400/, JSON.stringify(fout));
      assert.equal(gezet.length, 0, `niets gezet bij ${JSON.stringify(fout)}`);
    }
  });
}

/* ── [8] Scherm ──────────────────────────────────────────────────────── */
console.log("\n[8] Regelaars, teksten en tekenvlak");
await check("het venster Zichtbaarheid en de verkenner tonen de regelaar onder Knopen en onder Opleggingen", () => {
  for (const pad of ["./src/components/openFem3d/OpenFem3DVisibilityDialog.tsx", "./src/components/fem/ExplorerViewTab.tsx"]) {
    const tekst = bron(pad);
    assert.match(tekst, /<OpenFem3DSymbolScaleControl\b/, pad);
    assert.match(tekst, /"nodeSizePercent"|nodeSizePercent/, `${pad}: knopen`);
    assert.match(tekst, /"supportSizePercent"|supportSizePercent/, `${pad}: opleggingen`);
  }
});
await check("de regelaar: dubbelklik of de waardeknop zet hem terug op 100 %, de waarde in %", () => {
  const tekst = bron("./src/components/openFem3d/OpenFem3DSymbolScaleControl.tsx");
  assert.match(tekst, /onDoubleClick=\{[^}]*OPEN_FEM_3D_SYMBOL_PERCENT_DEFAULT/);
  assert.match(tekst, /openFem3DSymbolSliderFromPercent\(/);
  assert.match(tekst, /openFem3DSymbolPercentFromSlider\(/);
  assert.match(tekst, /openFem3dSymbolScale\.value/);
});
await check("teksten in nl, en, de en fr (label, toelichting, aria, terugzetten, waarde)", () => {
  const sleutels = ["size", "hint", "nodesAria", "supportsAria", "reset", "value"];
  const per = {};
  for (const taal of ["nl", "en", "de", "fr"]) {
    const common = JSON.parse(bron(`./src/i18n/locales/${taal}/common.json`));
    for (const k of sleutels) {
      const tekst = common.openFem3dSymbolScale?.[k];
      assert.equal(typeof tekst, "string", `${taal}: openFem3dSymbolScale.${k}`);
      assert.ok(tekst.trim(), `${taal}: ${k} leeg`);
    }
    assert.match(common.openFem3dSymbolScale.value, /\{\{n\}\}/, `${taal}: waarde met {{n}}`);
    per[taal] = common.openFem3dSymbolScale.hint;
  }
  assert.equal(new Set(Object.values(per)).size, 4, "vier eigen toelichtingen");
});
await check("het tekenvlak: knoopbol en kiesstraal × de knoopschaal, snelle wegen zonder volledige opbouw", () => {
  const canvas = bron("./src/components/openFem3d/ThreeFrameCanvas.tsx");
  assert.match(canvas, /function scaledNodeRadius\(/);
  assert.match(canvas, /visibilityChangedOnly\("nodeSizePercent"\)/);
  assert.match(canvas, /visibilityChangedOnly\("supportSizePercent"\)/);
  assert.match(canvas, /"node-scale"/);
  assert.match(canvas, /"support-scale"/);
  assert.match(canvas, /supportSizePercent: visibility\.supportSizePercent/, "randopleggingen in de plaatlaag");
  assert.doesNotMatch(canvas, /visualNodeRadiusRef\.current = visualNodeRadius\(model\)/);
  assert.doesNotMatch(canvas, /const nodeRadius = visualNodeRadius\(model\)/, "volledige opbouw met de geschaalde straal");
  // Het zoekgebied om de klik groeit mee met de knoopschaal (vroeger vast 48 px).
  assert.match(canvas, /NODE_PICK_MAX_RADIUS_PX \* Math\.max\(1, openFem3DSymbolScaleFactor\(visibilityRef\.current\.nodeSizePercent\)\)/);
  // Elke run van de scène-opbouw wist het snelle pad; alleen de regelaars zetten het.
  assert.match(canvas, /symbolScalePathRef\.current = null;/);
  // Bij randopleggingen alleen die groep vervangen, niet het net en de contour.
  assert.match(canvas, /buildOpenFem3DPlateEdgeSupports\(model, visibility\.supportSizePercent\)/);
});
await check("de browserproef van het tekenvlak staat in de batterij", () => {
  const runner = bron("./scripts/run-tests.mjs");
  assert.match(runner, /"open-fem3d-symboolschaal"/);
  assert.match(runner, /"open-fem3d-symboolschaal-ui"/);
});

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
if (gefaald > 0) process.exit(1);

// Section box in de 3D-werkruimte (issue #86).
//
// WAAROM DEZE TEST BESTAAT
// De section box is een asgerichte doos (globaal X/Y/Z, in m) die het model
// afsnijdt: alleen wat binnen de doos valt is zichtbaar, kiesbaar, snapbaar
// en gelabeld. Precies de fouten die hieronder vallen: een doos om het model
// of de selectie die een stuk van het model afsnijdt (te krappe marge) of op
// de verkeerde knopen staat, een rand die niet bij de doos hoort (een knoop
// op de rand valt weg), een staaf of plaat die de doos snijdt en dan geheel
// verdwijnt of geheel blijft, een vlak dat bij slepen door het overliggende
// vlak heen schiet, een clipping plane met het teken verkeerd om (dan zie je
// juist alles BUITEN de doos), een oude view of opslag zonder doos die met
// een doos opent, een opgeslagen view die de doos kwijtraakt, een kader dat
// een onzichtbare staaf meeneemt, een rapportbeeld dat de doos negeert, en
// een bedieningskanaal of MCP-schema dat een tikfout stil doorlaat.
//
// Elk getal volgt uit de invoer: de doos om de knopen plus marge
// 0,1 × modeldiagonaal (0,5 … 5 m), op hele mm naar buiten afgerond.
//
// Checks:
//  [1] GRENZEN      — doos om het model en om de selectie (knoop, staaf,
//                     plaat, last, belastingvlak, groep), marge, minimale maat.
//  [2] BINNEN       — punt, lijnstuk (Liang–Barsky), staaf binnen/deels/
//                     buiten, polylijn in stukken, veelhoek (Sutherland–Hodgman),
//                     doorsnede van twee dozen.
//  [3] SLEPEN       — een vlak zetten (mm, minimale maat, overliggend vlak),
//                     de asparameter onder de muis, de zes clipping planes
//                     (binnen = positieve kant), grepen en randen in Three:
//                     de wereldmatrix in dezelfde render, een greep langs de
//                     kijkstraal uit en niet te vangen, platen geknipt.
//  [4] OPSLAG       — normaliseren, de zichtbaarheid (oude opslag: uit), geen
//                     aan/uit-vlag, aan/uit en reset, opgeslagen views (ook
//                     oude zonder doos), ander model: uit, standaardviews.
//  [5] KANAAL       — section_box van gui_configure_3d_view: keuren, zetten,
//                     weigeren; het strikte MCP-schema.
//  [6] RAPPORTBEELD — een view met doos: staven en platen geknipt, wat
//                     erbuiten ligt weg, snedekrachtlijnen meetkundig geknipt;
//                     zonder doos precies hetzelfde beeld als voorheen.
//  [7] KADER        — selectievenster en crossing nemen alleen mee wat
//                     binnen de doos zichtbaar is (staven, knopen, lasten, platen).
//  [8] BEDRADING    — tekenvlak (clipping planes, snel pad, kiezen, snappen,
//                     labels, passend beeld), menu, lint, dekking, teksten en
//                     de browserproef in de batterij.
//
// Uitvoeren: node scripts/run-tests.mjs --filter=open-fem3d-section-box
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

const B = await import("./src/components/openFem3d/openFem3dSectionBox.ts");
const Beeld = await import("./src/components/openFem3d/openFem3dSectionBoxBeeld.ts");
const V = await import("./src/components/openFem3d/openFem3dVisibility.ts");
const { parseOpenFem3DViewSets, bewaarOpenFem3DViewSet } = await import("./src/components/openFem3d/openFem3dViewSets.ts");
const { openFem3DRapportViews, openFem3DStandaardViewToepassing } = await import("./src/components/openFem3d/openFem3dStandaardViews.ts");
const { openFem3DRapportBeeld } = await import("./src/components/openFem3d/openFem3dRapportBeeld.ts");
const { selectOpenFem3DInScreenBox } = await import("./src/components/openFem3d/openFem3dBoxSelection.ts");
const { findOpenFem3DBeamNearScreenPoint } = await import("./src/components/openFem3d/openFem3dBeamScreenPick.ts");

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
const puntGelijk = (p, q, tol = 1e-9) => dichtbij(p.x, q[0], tol) && dichtbij(p.y, q[1], tol) && dichtbij(p.z, q[2], tol);
const DEFAULT = V.DEFAULT_OPEN_FEM_3D_VISIBILITY;

/**
 * Het proefmodel: een portaal van 6 × 3 × 2 m (diagonaal √(36 + 9 + 4) = 7 m,
 * dus marge 0,7 m). Knopen 1 (0,0,0), 2 (0,0,2), 3 (6,0,2), 4 (6,0,0),
 * 5 (6,3,0), 6 (6,3,2), 7 (0,3,2); staven 1: 1–2, 2: 2–3, 3: 3–4, 4: 4–5,
 * 5: 3–6, 6: 6–5, 7: 2–7; plaat 1 op 2, 3, 6, 7 (het dak, z = 2).
 */
const PORTAAL = {
  nodes: [[1, 0, 0, 0], [2, 0, 0, 2], [3, 6, 0, 2], [4, 6, 0, 0], [5, 6, 3, 0], [6, 6, 3, 2], [7, 0, 3, 2]]
    .map(([id, x, y, z]) => ({ id, x, y, z })),
  beams: [[1, 1, 2], [2, 2, 3], [3, 3, 4], [4, 4, 5], [5, 3, 6], [6, 6, 5], [7, 2, 7]]
    .map(([id, startNodeId, endNodeId]) => ({ id, startNodeId, endNodeId, profileName: "HEA 200", material: "S235" })),
  plates: [{ id: 1, nodeIds: [2, 3, 6, 7], thicknessM: 0.2, material: "C30/37" }],
  memberLoads: [{ id: 1, beamId: 4, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -5, qzEnd: -5, startPositionM: 0, endPositionM: 3 }],
  loads: [{ id: 1, nodeId: 5, caseId: 1, fx: 0, fy: 0, fz: -10, mx: 0, my: 0, mz: 0 }],
  loadPanels: [{ id: 1, nodeIds: [1, 4, 5], caseId: 1, q: 1, direction: "gravity", distribution: "twoWay" }],
  supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
    { nodeId: 5, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false }],
};
const grenzen = (min, max) => ({ min, max });

/* ── [1] Grenzen ─────────────────────────────────────────────────────── */
console.log("[1] Grenzen om model en selectie");
await check("marge = 0,1 × diagonaal, minstens 0,5 m en hoogstens 5 m", () => {
  assert.equal(B.openFem3DSectionBoxMarge(3), 0.5);
  assert.ok(dichtbij(B.openFem3DSectionBoxMarge(7), 0.7));
  assert.ok(dichtbij(B.openFem3DSectionBoxMarge(20), 2));
  assert.equal(B.openFem3DSectionBoxMarge(100), 5);
  assert.equal(B.openFem3DSectionBoxMarge(Number.NaN), 0.5);
});
await check("doos om het model: de knopen plus 0,7 m rondom (portaal 6 × 3 × 2 m)", () => {
  assert.deepEqual(B.openFem3DSectionBoxRondModel(PORTAAL), grenzen([-0.7, -0.7, -0.7], [6.7, 3.7, 2.7]));
});
await check("een leeg model heeft geen doos; één knoop krijgt de minimale marge 0,5 m", () => {
  assert.equal(B.openFem3DSectionBoxRondModel({ nodes: [] }), null);
  assert.deepEqual(B.openFem3DSectionBoxRondModel({ nodes: [{ id: 1, x: 1, y: 2, z: 3 }] }), grenzen([0.5, 1.5, 2.5], [1.5, 2.5, 3.5]));
});
await check("op hele mm naar buiten afgerond: de doos blijft om de punten", () => {
  const b = B.openFem3DSectionBoxRondPunten([{ x: 0.0004, y: 1.2346, z: -0.0004 }, { x: 2.9996, y: 2, z: 1 }], 0);
  assert.deepEqual(b, grenzen([0, 1.234, -0.001], [3, 2, 1]));
});
await check("een platte puntenwolk (alle z gelijk, geen marge) krijgt de minimale doosmaat 100 mm", () => {
  const b = B.openFem3DSectionBoxRondPunten([{ x: 0, y: 0, z: 4 }, { x: 2, y: 1, z: 4 }], 0);
  assert.deepEqual(b, grenzen([0, 0, 3.95], [2, 1, 4.05]));
  assert.ok(dichtbij(b.max[2] - b.min[2], B.OPEN_FEM_3D_SECTION_BOX_MIN_M));
});
await check("om de selectie, met de marge van het model (0,7 m): staaf, knoop, plaat", () => {
  assert.deepEqual(B.openFem3DSectionBoxRondSelectie(PORTAAL, { type: "beam", id: 2 }), grenzen([-0.7, -0.7, 1.3], [6.7, 0.7, 2.7]));
  assert.deepEqual(B.openFem3DSectionBoxRondSelectie(PORTAAL, { type: "node", id: 5 }), grenzen([5.3, 2.3, -0.7], [6.7, 3.7, 0.7]));
  assert.deepEqual(B.openFem3DSectionBoxRondSelectie(PORTAAL, { type: "plate", id: 1 }), grenzen([-0.7, -0.7, 1.3], [6.7, 3.7, 2.7]));
});
await check("een last om het element waar hij op staat; een belastingvlak om zijn hoeken; een groep om alles", () => {
  assert.deepEqual(B.openFem3DSectionBoxRondSelectie(PORTAAL, { type: "memberLoad", id: 1 }), grenzen([5.3, -0.7, -0.7], [6.7, 3.7, 0.7]));
  assert.deepEqual(B.openFem3DSectionBoxRondSelectie(PORTAAL, { type: "nodalLoad", id: 1 }), grenzen([5.3, 2.3, -0.7], [6.7, 3.7, 0.7]));
  assert.deepEqual(B.openFem3DSectionBoxRondSelectie(PORTAAL, { type: "loadPanel", id: 1 }), grenzen([-0.7, -0.7, -0.7], [6.7, 3.7, 0.7]));
  assert.deepEqual(B.openFem3DSectionBoxRondSelectie(PORTAAL,
    { type: "multi", nodeIds: [1], beamIds: [], loads: { memberLoad: [1] } }), grenzen([-0.7, -0.7, -0.7], [6.7, 3.7, 0.7]));
  assert.deepEqual([...B.openFem3DSectionBoxSelectieKnopen(PORTAAL, { type: "multi", nodeIds: [7], beamIds: [1], plateIds: [] })].sort(),
    [1, 2, 7]);
});
await check("geen selectie of geen bestaande knopen: geen doos", () => {
  assert.equal(B.openFem3DSectionBoxRondSelectie(PORTAAL, null), null);
  assert.equal(B.openFem3DSectionBoxRondSelectie(PORTAAL, { type: "beam", id: 99 }), null);
  assert.equal(B.openFem3DSectionBoxOpSelectie(PORTAAL, null), null);
  assert.deepEqual(B.openFem3DSectionBoxOpSelectie(PORTAAL, { type: "node", id: 5 }),
    { enabled: true, bounds: grenzen([5.3, 2.3, -0.7], [6.7, 3.7, 0.7]) });
});

/* ── [2] Binnen en buiten ─────────────────────────────────────────────── */
console.log("\n[2] Binnen en buiten");
const D = grenzen([0, 0, 0], [4, 4, 4]);
await check("een punt: de rand hoort erbij (tolerantie 1 µm), daarbuiten niet", () => {
  assert.equal(B.openFem3DSectionBoxBevat(D, { x: 4, y: 4, z: 4 }), true, "hoek");
  assert.equal(B.openFem3DSectionBoxBevat(D, { x: 4.0000005, y: 0, z: 0 }), true, "binnen de tolerantie");
  assert.equal(B.openFem3DSectionBoxBevat(D, { x: 4.00001, y: 0, z: 0 }), false, "10 µm erbuiten");
  assert.equal(B.openFem3DSectionBoxBevat(D, { x: 2, y: -0.1, z: 2 }), false);
});
await check("een lijnstuk door de doos: het deel erbinnen als t-bereik en als punten", () => {
  const deel = B.openFem3DSectionBoxLijnstuk(D, { x: -2, y: 2, z: 2 }, { x: 6, y: 2, z: 2 });
  assert.ok(deel && dichtbij(deel[0], 0.25) && dichtbij(deel[1], 0.75, 1e-6), JSON.stringify(deel));
  const punten = B.openFem3DSectionBoxKnipLijnstuk(D, { x: -2, y: 2, z: 2 }, { x: 6, y: 2, z: 2 });
  assert.ok(puntGelijk(punten.a, [0, 2, 2], 1e-6) && puntGelijk(punten.b, [4, 2, 2], 1e-5), JSON.stringify(punten));
  assert.equal(B.openFem3DSectionBoxLijnstuk(D, { x: 3, y: 5, z: 5 }, { x: 5, y: 3, z: 5 }), null, "geheel boven de doos");
  assert.deepEqual(B.openFem3DSectionBoxLijnstuk(D, { x: -1, y: 4, z: 1 }, { x: 5, y: 4, z: 1 })?.map((t) => Math.round(t * 1e6) / 1e6),
    [0.166667, 0.833333], "langs een zijvlak: binnen");
});
await check("een staaf: binnen, deels (de doos knipt hem) of buiten", () => {
  assert.equal(B.openFem3DSectionBoxStaafStand(D, { x: 1, y: 1, z: 1 }, { x: 3, y: 3, z: 3 }), "binnen");
  assert.equal(B.openFem3DSectionBoxStaafStand(D, { x: 0, y: 0, z: 0 }, { x: 4, y: 4, z: 4 }), "binnen", "hoek tot hoek");
  assert.equal(B.openFem3DSectionBoxStaafStand(D, { x: 5, y: -1, z: 2 }, { x: -1, y: 5, z: 2 }), "deels");
  assert.equal(B.openFem3DSectionBoxStaafStand(D, { x: 5, y: 5, z: 5 }, { x: 6, y: 6, z: 6 }), "buiten");
});
await check("een polylijn die de doos verlaat en terugkomt: twee stukken", () => {
  const stukken = B.openFem3DSectionBoxPolylijn(D, [
    { x: -1, y: 2, z: 2 }, { x: 2, y: 2, z: 2 }, { x: 2, y: 6, z: 2 }, { x: 2, y: 6, z: 3 }, { x: 3, y: 2, z: 3 },
  ]);
  assert.equal(stukken.length, 2, JSON.stringify(stukken));
  const verwacht = [[[0, 2, 2], [2, 2, 2], [2, 4, 2]], [[2.5, 4, 3], [3, 2, 3]]];
  stukken.forEach((stuk, i) => {
    assert.equal(stuk.length, verwacht[i].length, `stuk ${i}`);
    stuk.forEach((p, k) => assert.ok(puntGelijk(p, verwacht[i][k], 1e-6), `stuk ${i} punt ${k}: ${JSON.stringify(p)}`));
  });
  assert.deepEqual(B.openFem3DSectionBoxPolylijn(D, [{ x: 9, y: 9, z: 9 }, { x: 8, y: 9, z: 9 }]), [], "geheel erbuiten");
});
await check("een plaat die de doos snijdt: geknipt tot het deel erbinnen (Sutherland–Hodgman)", () => {
  const plaat = [{ x: -2, y: -2, z: 2 }, { x: 2, y: -2, z: 2 }, { x: 2, y: 2, z: 2 }, { x: -2, y: 2, z: 2 }];
  const geknipt = B.openFem3DSectionBoxVeelhoek(D, plaat);
  const hoeken = geknipt.map((p) => `${Math.round(p.x * 1e5) / 1e5},${Math.round(p.y * 1e5) / 1e5}`).sort();
  assert.deepEqual([...new Set(hoeken)], ["0,0", "0,2", "2,0", "2,2"], JSON.stringify(geknipt));
  assert.ok(geknipt.every((p) => p.z === 2));
  assert.equal(B.openFem3DSectionBoxVeelhoekStand(D, plaat), "deels");
  assert.equal(B.openFem3DSectionBoxVeelhoekStand(D, plaat.map((p) => ({ ...p, x: p.x + 2, y: p.y + 2 }))), "binnen");
  assert.equal(B.openFem3DSectionBoxVeelhoekStand(D, plaat.map((p) => ({ ...p, z: 5 }))), "buiten");
  assert.deepEqual(B.openFem3DSectionBoxVeelhoek(D, plaat.map((p) => ({ ...p, z: 5 }))), []);
});
await check("de doorsnede van twee dozen (passend beeld met doos); geen overlap: null", () => {
  assert.deepEqual(B.openFem3DSectionBoxSnijding(D, grenzen([2, 2, 2], [6, 6, 6])), grenzen([2, 2, 2], [4, 4, 4]));
  assert.equal(B.openFem3DSectionBoxSnijding(D, grenzen([5, 5, 5], [6, 6, 6])), null);
});

/* ── [3] Slepen, vlakken en grepen ────────────────────────────────────── */
console.log("\n[3] Slepen, clipping planes en grepen");
const vlak = (id) => B.OPEN_FEM_3D_SECTION_BOX_VLAKKEN.find((v) => v.id === id);
await check("zes vlakken met de tekens van de view cube; de greep staat in het midden van zijn vlak", () => {
  assert.deepEqual(B.OPEN_FEM_3D_SECTION_BOX_VLAKKEN.map((v) => v.id), ["-x", "+x", "-y", "+y", "-z", "+z"]);
  assert.deepEqual(B.openFem3DSectionBoxVlakMidden(D, vlak("+z")), [2, 2, 4]);
  assert.deepEqual(B.openFem3DSectionBoxVlakMidden(D, vlak("-x")), [0, 2, 2]);
  assert.equal(B.openFem3DSectionBoxVlakWaarde(D, vlak("+y")), 4);
});
await check("een vlak zetten: op hele mm, de andere vijf blijven staan", () => {
  assert.deepEqual(B.openFem3DSectionBoxZetVlak(D, vlak("+x"), 6.12345), grenzen([0, 0, 0], [6.123, 4, 4]));
  assert.deepEqual(B.openFem3DSectionBoxZetVlak(D, vlak("-z"), -1.0004), grenzen([0, 0, -1], [4, 4, 4]));
});
await check("niet door het overliggende vlak: minstens 100 mm doos (min-vlak en max-vlak)", () => {
  assert.deepEqual(B.openFem3DSectionBoxZetVlak(D, vlak("-x"), 3.99), grenzen([3.9, 0, 0], [4, 4, 4]));
  assert.deepEqual(B.openFem3DSectionBoxZetVlak(D, vlak("+y"), -10), grenzen([0, 0, 0], [4, 0.1, 4]));
  assert.deepEqual(B.openFem3DSectionBoxZetVlak(D, vlak("+y"), Number.NaN), D, "geen getal: niets");
});
await check("de plek op de as onder de muis: loodrecht erop exact, langs de as geen plek", () => {
  const s = B.openFem3DSectionBoxAsParameter({ x: 4, y: 2, z: 2 }, { x: 1, y: 0, z: 0 }, { x: 6, y: 2, z: 10 }, { x: 0, y: 0, z: -1 });
  assert.ok(dichtbij(s, 2), String(s));
  const schuin = B.openFem3DSectionBoxAsParameter({ x: 4, y: 2, z: 2 }, { x: 1, y: 0, z: 0 }, { x: 7, y: -5, z: 10 }, { x: 0, y: 1, z: -1 });
  assert.ok(dichtbij(schuin, 3), `de straal kruist de as bij x = 7: ${schuin}`);
  assert.equal(B.openFem3DSectionBoxAsParameter({ x: 4, y: 2, z: 2 }, { x: 1, y: 0, z: 0 }, { x: 10, y: 2, z: 2 }, { x: -1, y: 0, z: 0 }), null);
});
await check("de zes clipping planes: het midden aan de positieve kant (Three.js houdt die), net buiten elk vlak negatief", () => {
  const vlakken = B.openFem3DSectionBoxVlakken(D);
  assert.equal(vlakken.length, 6);
  B.OPEN_FEM_3D_SECTION_BOX_VLAKKEN.forEach((v, i) => {
    const p = new THREE.Plane(new THREE.Vector3(...vlakken[i].normaal), vlakken[i].constante);
    assert.ok(p.distanceToPoint(new THREE.Vector3(2, 2, 2)) > 0, `${v.id}: midden binnen`);
    const buiten = new THREE.Vector3(2, 2, 2).setComponent(v.as, v.kant < 0 ? -0.01 : 4.01);
    assert.ok(p.distanceToPoint(buiten) < 0, `${v.id}: buiten`);
    const opRand = new THREE.Vector3(2, 2, 2).setComponent(v.as, v.kant < 0 ? 0 : 4);
    assert.ok(dichtbij(p.distanceToPoint(opRand), 0), `${v.id}: op de rand 0`);
  });
});
await check("Three: zet() deelt de vlakken (zelfde objecten, alleen andere waarden), randen en grepen zichtbaar", () => {
  const beeld = Beeld.createOpenFem3DSectionBoxBeeld();
  const vlakken = [...beeld.vlakken];
  assert.equal(beeld.group.visible, false, "uit tot er een doos is");
  beeld.zet(D);
  beeld.zet(grenzen([1, 1, 1], [3, 3, 3]));
  assert.ok(beeld.vlakken.every((p, i) => p === vlakken[i]), "dezelfde THREE.Plane-objecten: alleen uniforms veranderen");
  assert.ok(dichtbij(beeld.vlakken[1].distanceToPoint(new THREE.Vector3(3, 2, 2)), 0), "+x op 3 m");
  assert.equal(beeld.group.visible, true);
  assert.equal(beeld.grepen.length, 6);
  const rand = beeld.group.children.find((c) => c.userData.openFem3dSectionBoxRand);
  assert.equal(rand.geometry.getAttribute("position").count, 24, "twaalf ribben");
  beeld.zet(null);
  assert.equal(beeld.group.visible, false);
  beeld.dispose();
});
await check("Three: de greep onder de muis (schermpixels), op vaste schermmaat, ook als de camera ver weg staat", () => {
  const beeld = Beeld.createOpenFem3DSectionBoxBeeld();
  beeld.zet(D);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  for (const afstand of [20, 200]) {
    camera.position.set(2, 2, afstand);
    camera.lookAt(2, 2, 2);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    beeld.schaal(camera, 400);
    const greep = beeld.grepen[1];
    const p = greep.position.clone().project(camera);
    const px = { x: (p.x + 1) * 200, y: (1 - p.y) * 200 };
    assert.equal(beeld.greepOnder(camera, 400, 400, px.x + 4, px.y - 3)?.id, "+x", `${afstand} m: 5 px naast de greep +x`);
    assert.equal(beeld.greepOnder(camera, 400, 400, px.x + 40, px.y), null, `${afstand} m: 40 px ernaast niets`);
    const a = greep.position.clone().project(camera);
    const b = greep.position.clone().add(new THREE.Vector3(greep.scale.y, 0, 0)).project(camera);
    assert.ok(dichtbij(Math.abs(b.x - a.x) * 200, Beeld.OPEN_FEM_3D_SECTION_BOX_GREEP_PX, 0.5),
      `${afstand} m: greep ${(Math.abs(b.x - a.x) * 200).toFixed(2)} px lang`);
  }
  beeld.dispose();
});
await check("Three: de wereldmatrix van een greep klopt in dezelfde render (schaal() draait ná scene.updateMatrixWorld van de renderer)", () => {
  // De volgorde van WebGLRenderer.render: eerst scene.updateMatrixWorld(),
  // dan scene.onBeforeRender (daar staat schaal()), dan tekenen met
  // matrixWorld. Een greep die alleen zijn lokale matrix bijwerkt, tekent op
  // de plek van de vorige render: na "aan" op de oorsprong.
  const scene = new THREE.Scene();
  const beeld = Beeld.createOpenFem3DSectionBoxBeeld();
  scene.add(beeld.group);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(14, -12, 10);
  camera.lookAt(2, 2, 2);
  camera.updateProjectionMatrix();
  const render = (doos) => {
    beeld.zet(doos);
    scene.updateMatrixWorld();
    beeld.schaal(camera, 400);
  };
  const getekend = new THREE.Vector3(), schaalGetekend = new THREE.Vector3(), q = new THREE.Quaternion();
  for (const doos of [D, grenzen([1, -2, 0.5], [7, 3, 6]), D]) {
    render(doos);
    B.OPEN_FEM_3D_SECTION_BOX_VLAKKEN.forEach((v, i) => {
      const greep = beeld.grepen[i];
      greep.matrixWorld.decompose(getekend, q, schaalGetekend);
      const midden = B.openFem3DSectionBoxVlakMidden(doos, v);
      const lengte = greep.scale.y;
      const verwacht = new THREE.Vector3(...midden);
      verwacht.setComponent(v.as, midden[v.as] + v.kant * (lengte / 2 + lengte * 3 / Beeld.OPEN_FEM_3D_SECTION_BOX_GREEP_PX));
      assert.ok(getekend.distanceTo(verwacht) < 1e-9, `${v.id}: getekend op ${getekend.toArray()} in plaats van ${verwacht.toArray()}`);
      assert.ok(dichtbij(schaalGetekend.y, lengte, 1e-9), `${v.id}: getekende maat ${schaalGetekend.y} ≠ ${lengte}`);
    });
  }
  beeld.dispose();
});
await check("langs de kijkstraal: dezelfde toets voor slepen, tekenen en vangen (grens 2,6°)", () => {
  const as = { x: 1, y: 0, z: 0 };
  const straal = (graden) => ({ x: -Math.cos(graden * Math.PI / 180), y: Math.sin(graden * Math.PI / 180), z: 0 });
  assert.equal(B.openFem3DSectionBoxLangsStraal(as, straal(0)), true, "recht erlangs");
  assert.equal(B.openFem3DSectionBoxLangsStraal(as, straal(2)), true, "2°");
  assert.equal(B.openFem3DSectionBoxLangsStraal(as, straal(3)), false, "3°");
  assert.equal(B.openFem3DSectionBoxLangsStraal(as, straal(90)), false, "loodrecht");
  assert.equal(B.openFem3DSectionBoxLangsStraal(as, { x: 0, y: 0, z: 0 }), true, "geen richting");
  for (const graden of [0, 1, 2, 2.5, 2.7, 3, 10, 45, 90]) {
    const s = B.openFem3DSectionBoxAsParameter({ x: 4, y: 2, z: 2 }, as, { x: 10, y: 2, z: 2 }, straal(graden));
    assert.equal(s === null, B.openFem3DSectionBoxLangsStraal(as, straal(graden)), `${graden}°: geen plek op de as ⇔ langs de straal`);
  }
});
await check("Three: een greep die naar de kijker wijst, staat uit en vangt niets (perspectief en parallel; de klik gaat naar de staaf eronder)", () => {
  const beeld = Beeld.createOpenFem3DSectionBoxBeeld();
  beeld.zet(D);
  const perspectief = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  const parallel = new THREE.OrthographicCamera(-8, 8, 8, -8, 0.1, 1000);
  for (const camera of [perspectief, parallel]) {
    // Recht van boven, boven het midden van de doos: ±z liggen allebei op het schermmidden.
    camera.position.set(2, 2, 30);
    camera.up.set(0, 1, 0);
    camera.lookAt(2, 2, 2);
    camera.updateProjectionMatrix();
    beeld.schaal(camera, 400);
    const zichtbaar = Object.fromEntries(beeld.grepen.map((g) => [g.userData.openFem3dSectionBoxGreep, g.visible]));
    assert.deepEqual(zichtbaar, { "-x": true, "+x": true, "-y": true, "+y": true, "-z": false, "+z": false }, camera.type);
    assert.equal(beeld.greepOnder(camera, 400, 400, 200, 200), null, `${camera.type}: midden van het scherm vangt geen greep`);
    const p = beeld.grepen[1].position.clone().project(camera);
    assert.equal(beeld.greepOnder(camera, 400, 400, (p.x + 1) * 200, (1 - p.y) * 200)?.id, "+x", `${camera.type}: +x wel`);
  }
  // Schuin erboven (iso): alle zes weer zichtbaar.
  perspectief.position.set(14, -12, 10);
  perspectief.lookAt(2, 2, 2);
  beeld.schaal(perspectief, 400);
  assert.ok(beeld.grepen.every((g) => g.visible), "iso: alle grepen");
  beeld.dispose();
});
await check("Three: de materialen van het model krijgen de vlakken; oriëntatie (raster, stramien, peilmaten) en de doos zelf niet; uit haalt ze weg", () => {
  const scene = new THREE.Scene();
  const beeld = Beeld.createOpenFem3DSectionBoxBeeld();
  scene.add(beeld.group);
  const staaf = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  const model = new THREE.Group();
  model.add(staaf);
  const stramien = new THREE.Group();
  stramien.userData.openFem3dStructuralGrid = true;
  const stramienLijn = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
  stramien.add(stramienLijn);
  model.add(stramien);
  const raster = new THREE.GridHelper(10, 10);
  raster.userData.openFem3dNietKnippen = true;
  // Een plaat zoals het tekenvlak hem maakt (createPlateObject): het vlak met
  // type "plate" en de randen als kind met hetzelfde type (niet kiesbaar).
  const plaat = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  plaat.userData = { type: "plate", id: 1 };
  const plaatRand = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
  plaatRand.userData = { type: "plate", id: 1, pickable: false };
  plaat.add(plaatRand);
  // Een plaatbatch (vanaf 100 platen) en de gebundelde plaatranden.
  const batch = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 2);
  batch.userData = { type: "plate", instanceIds: [2, 3] };
  const bundelRand = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
  bundelRand.userData = { openFem3dPlateEdges: true };
  model.add(plaat, batch, bundelRand);
  scene.add(model, raster, new THREE.AmbientLight());
  beeld.zet(D);
  Beeld.openFem3DSectionBoxKnipMaterialen(scene, beeld.vlakken);
  assert.equal(staaf.material.clippingPlanes, beeld.vlakken, "staaf geknipt");
  assert.equal(plaat.material.clippingPlanes, beeld.vlakken, "plaat geknipt");
  assert.equal(plaatRand.material.clippingPlanes, beeld.vlakken, "plaatranden geknipt");
  assert.equal(batch.material.clippingPlanes, beeld.vlakken, "plaatbatch geknipt");
  assert.equal(bundelRand.material.clippingPlanes, beeld.vlakken, "gebundelde plaatranden geknipt");
  assert.equal(stramienLijn.material.clippingPlanes, null, "stramien niet");
  assert.equal(raster.material.clippingPlanes, null, "raster niet");
  assert.ok(beeld.grepen.every((g) => g.material.clippingPlanes === null), "grepen niet");
  Beeld.openFem3DSectionBoxKnipMaterialen(scene, null);
  assert.equal(staaf.material.clippingPlanes, null, "uit: weer heel");
  assert.equal(plaat.material.clippingPlanes, null, "uit: plaat weer heel");
});
await check("prestatie: de vlakken zetten op 2000 materialen kost één doorloop, de tweede keer verandert niets", () => {
  const scene = new THREE.Scene();
  const vlakken = Beeld.createOpenFem3DSectionBoxBeeld().vlakken;
  const materialen = Array.from({ length: 2000 }, () => new THREE.MeshBasicMaterial());
  for (const m of materialen) scene.add(new THREE.Mesh(new THREE.BufferGeometry(), m));
  assert.equal(Beeld.openFem3DSectionBoxKnipMaterialen(scene, vlakken), 2000);
  let versies = materialen.reduce((som, m) => som + m.version, 0);
  const start = performance.now();
  Beeld.openFem3DSectionBoxKnipMaterialen(scene, vlakken);
  const ms = performance.now() - start;
  assert.equal(materialen.reduce((som, m) => som + m.version, 0), versies, "geen materiaal opnieuw (geen nieuwe shader)");
  assert.ok(ms < 20, `${ms.toFixed(2)} ms`);
  versies = 0;
});

/* ── [4] Opslag, views en aan/uit ─────────────────────────────────────── */
console.log("\n[4] Opslag, views en aan/uit");
await check("normaliseren: ontbrekend of ongeldig is uit; aan zonder grenzen is uit", () => {
  assert.deepEqual(B.normalizeOpenFem3DSectionBox(undefined), { enabled: false, bounds: null });
  assert.deepEqual(B.normalizeOpenFem3DSectionBox([1, 2]), { enabled: false, bounds: null });
  assert.deepEqual(B.normalizeOpenFem3DSectionBox({ enabled: true }), { enabled: false, bounds: null });
  assert.deepEqual(B.normalizeOpenFem3DSectionBox({ enabled: "ja", bounds: D }), { enabled: false, bounds: D });
  assert.deepEqual(B.normalizeOpenFem3DSectionBox({ enabled: true, bounds: { min: [0, Number.NaN, 0], max: [1, 1, 1] } }),
    { enabled: false, bounds: null });
});
await check("normaliseren: min en max per as verwisseld wordt omgedraaid; te smal groeit tot 100 mm", () => {
  assert.deepEqual(B.normalizeOpenFem3DSectionBox({ enabled: true, bounds: { min: [4, 0, 4], max: [0, 4, 0] } }),
    { enabled: true, bounds: D });
  assert.deepEqual(B.normalizeOpenFem3DSectionBoxBounds({ min: [1, 1, 1], max: [1, 3, 3] }), grenzen([0.95, 1, 1], [1.05, 3, 3]));
});
await check("de zichtbaarheid: standaard uit, geen aan/uit-vlag; een oude opslag zonder doos: uit", () => {
  assert.deepEqual(DEFAULT.sectionBox, { enabled: false, bounds: null });
  assert.ok(!V.OPEN_FEM_3D_VISIBILITY_FLAGS.includes("sectionBox"));
  assert.ok(V.OPEN_FEM_3D_VISIBILITY_FLAGS.every((k) => typeof DEFAULT[k] === "boolean"));
  const oud = V.normalizeOpenFem3DVisibility({ nodes: false, beams: true });
  assert.deepEqual(oud.sectionBox, { enabled: false, bounds: null });
  assert.equal(oud.nodes, false);
});
await check("de zichtbaarheid bewaart de doos (aan en grenzen) via de opslag en terug", () => {
  const zicht = { ...DEFAULT, sectionBox: { enabled: true, bounds: D } };
  const terug = V.normalizeOpenFem3DVisibility(JSON.parse(JSON.stringify(zicht)));
  assert.deepEqual(terug.sectionBox, { enabled: true, bounds: D });
  assert.deepEqual(terug, zicht);
});
await check("aan/uit: zonder grenzen de modelgrenzen; uit bewaart de grenzen; weer aan geeft dezelfde doos", () => {
  const aan = B.openFem3DSectionBoxSchakel(B.DEFAULT_OPEN_FEM_3D_SECTION_BOX, PORTAAL);
  assert.deepEqual(aan, { enabled: true, bounds: grenzen([-0.7, -0.7, -0.7], [6.7, 3.7, 2.7]) });
  const uit = B.openFem3DSectionBoxSchakel({ enabled: true, bounds: D }, PORTAAL);
  assert.deepEqual(uit, { enabled: false, bounds: D });
  assert.deepEqual(B.openFem3DSectionBoxSchakel(uit, PORTAAL), { enabled: true, bounds: D });
  assert.deepEqual(B.openFem3DSectionBoxSchakel(B.DEFAULT_OPEN_FEM_3D_SECTION_BOX, { nodes: [] }), { enabled: false, bounds: null },
    "leeg model: niets om een doos omheen te zetten");
  assert.deepEqual(B.openFem3DSectionBoxActief(uit), null, "uit werkt niet");
  assert.deepEqual(B.openFem3DSectionBoxActief({ enabled: true, bounds: D }), D);
});
await check("reset: aan, op de modelgrenzen plus marge", () => {
  assert.deepEqual(B.openFem3DSectionBoxReset(PORTAAL), { enabled: true, bounds: grenzen([-0.7, -0.7, -0.7], [6.7, 3.7, 2.7]) });
  assert.deepEqual(B.openFem3DSectionBoxReset({ nodes: [] }), { enabled: false, bounds: null });
});
await check("een opgeslagen view bewaart de doos (ook via JSON, zoals in het projectbestand)", () => {
  const huidig = {
    view: "iso", camera: { position: [10, -10, 8], target: [3, 1.5, 1], up: [0, 0, 1] },
    visibility: { ...DEFAULT, sectionBox: { enabled: true, bounds: grenzen([1, -0.5, -0.5], [5, 3.5, 2.5]) } },
    combinationId: null, loadCaseId: 1, mode: "model",
  };
  const views = bewaarOpenFem3DViewSet([], "Middenportaal", huidig);
  const terug = parseOpenFem3DViewSets(JSON.parse(JSON.stringify(views)));
  assert.deepEqual(terug[0].visibility.sectionBox, huidig.visibility.sectionBox);
});
await check("een oude view zonder doos opent zonder doos", () => {
  const oud = parseOpenFem3DViewSets([{
    id: "view-1", name: "Oud", view: "iso", camera: { position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1] },
    visibility: { nodes: true, beams: true }, combinationId: null,
  }]);
  assert.deepEqual(oud[0].visibility.sectionBox, { enabled: false, bounds: null });
});
await check("een ander model (openen, nieuw, hal, kanaal): de doos uit en zonder grenzen; zonder doos hetzelfde object", () => {
  const zicht = { ...DEFAULT, sectionBox: { enabled: true, bounds: D } };
  assert.deepEqual(V.openFem3DVisibilityZonderSectionBox(zicht).sectionBox, { enabled: false, bounds: null });
  assert.equal(V.openFem3DVisibilityZonderSectionBox(DEFAULT), DEFAULT);
  const app = bron("./src/App.tsx");
  const aanroepen = app.match(/setOpenFem3dVisibility\(openFem3DVisibilityZonderSectionBox\)/g) ?? [];
  const camera = app.match(/setOpenFem3dCameraSnapshot\(null\);/g) ?? [];
  assert.equal(aanroepen.length, camera.length, "bij elk nieuw model (waar ook de camera terug gaat)");
  assert.ok(aanroepen.length >= 5, String(aanroepen.length));
});
await check("rapport: een eigen view draagt zijn doos; een standaardview tekent zonder doos (vaste basis)", () => {
  const vs = parseOpenFem3DViewSets([{
    id: "view-1", name: "Doos", view: "iso", camera: { position: [10, -10, 8], target: [3, 1.5, 1], up: [0, 0, 1] },
    visibility: { ...DEFAULT, sectionBox: { enabled: true, bounds: D } }, combinationId: null, mode: "model",
  }]);
  const views = openFem3DRapportViews({
    model: PORTAAL, viewSets: vs, standaardUitRapport: [], result: null, combinations: [], activeLoadCaseId: 1,
    activeCombinationId: null, heeftToetsing: false,
  });
  assert.deepEqual(views.find((v) => v.sleutel === "view-1").lagen.sectionBox, { enabled: true, bounds: D });
  assert.ok(views.filter((v) => v.standaard).every((v) => v.lagen.sectionBox.enabled === false));
  // Een standaardview toepassen laat de doos van het scherm staan (zoals labels en raster).
  const toe = openFem3DStandaardViewToepassing("geometrie", {
    visibility: { ...DEFAULT, sectionBox: { enabled: true, bounds: D } }, activeCombinationId: null, maatgevendeCombinationId: null, activeLoadCaseId: 1,
  });
  assert.deepEqual(toe.visibility.sectionBox, { enabled: true, bounds: D });
});

/* ── [5] Kanaal en MCP ─────────────────────────────────────────────────── */
console.log("\n[5] Bedieningskanaal en MCP (gui_configure_3d_view, section_box)");
await check("keuren: grenzen, fit model en fit selection; aan zonder grenzen houdt de bewaarde grenzen", () => {
  const huidig = { enabled: false, bounds: D };
  assert.deepEqual(B.openFem3DSectionBoxUitOpdracht({ enabled: true, min_m: { x: 1, y: 0, z: 0 }, max_m: { x: 3, y: 3, z: 2 } },
    huidig, PORTAAL, null), { enabled: true, bounds: grenzen([1, 0, 0], [3, 3, 2]) });
  assert.deepEqual(B.openFem3DSectionBoxUitOpdracht({ enabled: true }, huidig, PORTAAL, null), { enabled: true, bounds: D });
  assert.deepEqual(B.openFem3DSectionBoxUitOpdracht({ enabled: true }, B.DEFAULT_OPEN_FEM_3D_SECTION_BOX, PORTAAL, null),
    { enabled: true, bounds: grenzen([-0.7, -0.7, -0.7], [6.7, 3.7, 2.7]) });
  assert.deepEqual(B.openFem3DSectionBoxUitOpdracht({ enabled: true, fit: "model" }, huidig, PORTAAL, null),
    { enabled: true, bounds: grenzen([-0.7, -0.7, -0.7], [6.7, 3.7, 2.7]) });
  assert.deepEqual(B.openFem3DSectionBoxUitOpdracht({ enabled: true, fit: "selection" }, huidig, PORTAAL, { type: "node", id: 5 }),
    { enabled: true, bounds: grenzen([5.3, 2.3, -0.7], [6.7, 3.7, 0.7]) });
  assert.deepEqual(B.openFem3DSectionBoxUitOpdracht({ enabled: false }, { enabled: true, bounds: D }, PORTAAL, null),
    { enabled: false, bounds: D }, "uit bewaart de grenzen");
});
await check("weigeren: geen enabled, onbekende sleutel, min zonder max, te klein, fit met grenzen, fit selection zonder selectie", () => {
  const fout = (invoer, patroon) => assert.throws(() => B.openFem3DSectionBoxUitOpdracht(invoer, B.DEFAULT_OPEN_FEM_3D_SECTION_BOX, PORTAAL, null), patroon, JSON.stringify(invoer));
  fout({}, /enabled is verplicht/);
  fout({ enabled: "ja" }, /enabled is verplicht/);
  fout({ enabled: true, max: { x: 1, y: 1, z: 1 } }, /kent max niet/);
  fout({ enabled: true, min_m: { x: 0, y: 0, z: 0 } }, /min_m en max_m samen/);
  fout({ enabled: true, min_m: { x: 0, y: 0, z: 0 }, max_m: { x: 1, y: 1, z: 0.05 } }, /100 mm boven min_m\.z/);
  fout({ enabled: true, min_m: { x: 0, y: 0 }, max_m: { x: 1, y: 1, z: 1 } }, /x, y en z/);
  fout({ enabled: true, min_m: { x: 0, y: 0, z: 0, w: 1 }, max_m: { x: 1, y: 1, z: 1 } }, /kent w niet/);
  fout({ enabled: true, fit: "model", min_m: { x: 0, y: 0, z: 0 }, max_m: { x: 1, y: 1, z: 1 } }, /fit niet samen/);
  fout({ enabled: true, fit: "alles" }, /model of selection/);
  fout({ enabled: true, fit: "selection" }, /geen selectie/);
  assert.throws(() => B.openFem3DSectionBoxUitOpdracht({ enabled: true }, B.DEFAULT_OPEN_FEM_3D_SECTION_BOX, { nodes: [], beams: [] }, null), /geen knopen/);
});
{
  const { voerUit } = await import("./src/bediening/bediening.ts");
  const gezet = [];
  const acties = {
    modelDimension: "3d",
    openFem3d: {
      model: PORTAAL, selection: { type: "beam", id: 2 },
      visibility: { ...DEFAULT },
      setVisibility(next) { gezet.push(next); this.visibility = next; },
    },
  };
  const voer = (args) => voerUit("weergave_3d_configureren", args, { current: acties }, () => new Promise(() => {}), () => Promise.resolve());
  await check("weergave_3d_configureren zet de doos in de zichtbaarheid; het antwoord meldt hem", async () => {
    gezet.length = 0;
    const uit = await voer({ section_box: { enabled: true, min_m: { x: 1, y: -1, z: -1 }, max_m: { x: 5, y: 4, z: 3 } } });
    assert.equal(gezet.length, 1);
    assert.deepEqual(gezet[0].sectionBox, { enabled: true, bounds: grenzen([1, -1, -1], [5, 4, 3]) });
    assert.equal(gezet[0].nodes, true, "de rest blijft staan");
    assert.deepEqual(uit.zichtbaarheid.sectionBox, gezet[0].sectionBox);
  });
  await check("samen met zichtbaarheid in één keer; fit selection om de geselecteerde staaf", async () => {
    gezet.length = 0;
    await voer({ visibility: { nodes: false }, section_box: { enabled: true, fit: "selection" } });
    assert.equal(gezet.length, 1, "één keer zetten");
    assert.equal(gezet[0].nodes, false);
    assert.deepEqual(gezet[0].sectionBox, { enabled: true, bounds: grenzen([-0.7, -0.7, 1.3], [6.7, 0.7, 2.7]) });
  });
  await check("een fout in de doos laat alles staan (ook de zichtbaarheid in dezelfde opdracht)", async () => {
    gezet.length = 0;
    await assert.rejects(() => voer({ visibility: { nodes: true }, section_box: { enabled: true, min_m: { x: 0, y: 0, z: 0 } } }), /samen/);
    assert.equal(gezet.length, 0);
  });
}
await check("MCP: section_box is strikt (additionalProperties: false, enabled verplicht, {x, y, z} in m, fit model/selection)", () => {
  const gui = bron("../src-tauri/crates/openaec-mcp-server/src/gui_tools.rs");
  const schema = /"name": "gui_configure_3d_view"[\s\S]*?"name": "gui_select_member"/.exec(gui)?.[0] ?? "";
  assert.match(schema, /"section_box": \{ "type": "object", "additionalProperties": false, "required": \["enabled"\]/);
  assert.match(schema, /"min_m":\{"\$ref":"#\/\$defs\/pointM"\}/);
  assert.match(schema, /"fit":\{"type":"string","enum":\["model","selection"\]\}/);
  assert.match(schema, /"pointM": \{ "type":"object", "additionalProperties":false, "required":\["x","y","z"\]/);
  assert.match(gui, /doos\["required"\], json!\(\["enabled"\]\)/, "unittest in gui_tools.rs");
  assert.match(bron("../src-tauri/crates/openaec-mcp-server/tests/schema_strikt.rs"), /section_box/, "schema_strikt.rs");
  assert.match(bron("../src-tauri/crates/openaec-mcp-server/README.md"), /section_box/, "README");
});

/* ── [6] Rapportbeeld ─────────────────────────────────────────────────── */
console.log("\n[6] Rapportbeeld van een view met section box");
// Bovenaanzicht van een rij: staaf 1 (0..2) binnen, staaf 2 (10..12) buiten,
// staaf 3 (−2..2, y = 1) door de rand van de doos x = −1.
const RIJ = {
  nodes: [[1, 0, 0, 0], [2, 2, 0, 0], [3, 10, 0, 0], [4, 12, 0, 0], [5, -2, 1, 0], [6, 2, 1, 0]].map(([id, x, y, z]) => ({ id, x, y, z })),
  beams: [[1, 1, 2], [2, 3, 4], [3, 5, 6]].map(([id, startNodeId, endNodeId]) => ({ id, startNodeId, endNodeId, profileName: "IPE 200", material: "S235" })),
  supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false },
    { nodeId: 4, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false }],
  loads: [{ id: 1, nodeId: 2, caseId: 1, fx: 0, fy: 0, fz: -10, mx: 0, my: 0, mz: 0 },
    { id: 2, nodeId: 3, caseId: 1, fx: 0, fy: 0, fz: -10, mx: 0, my: 0, mz: 0 }],
};
const DOOS_RIJ = grenzen([-1, -1, -1], [3, 3, 1]);
const beeldVan = (lagen, extra = {}) => openFem3DRapportBeeld({
  model: RIJ, lagen: { ...DEFAULT, nodes: true, ...lagen }, view: "top", camera: null, resultaat: null, utilizations: [], loadCaseId: 1, ...extra,
});
const lengte = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
await check("zonder doos: alle staven, knopen, opleggingen en lasten", () => {
  const beeld = beeldVan({});
  assert.deepEqual(beeld.staven.map((s) => s.id), [1, 2, 3]);
  assert.equal(beeld.knopen.length, 6);
  assert.equal(beeld.opleggingen.length, 2);
  assert.equal(beeld.lastpijlen.length, 0, "bovenaanzicht: een verticale last is een tekst");
});
await check("met doos: staaf 2 weg, staaf 3 op de doos geknipt (3 van de 4 m), knopen en opleggingen alleen binnen", () => {
  const beeld = beeldVan({ sectionBox: { enabled: true, bounds: DOOS_RIJ } });
  assert.deepEqual(beeld.staven.map((s) => s.id), [1, 3]);
  const [s1, s3] = beeld.staven;
  assert.ok(dichtbij(lengte(s3) / lengte(s1), 3 / 2, 1e-3), `staaf 3 / staaf 1 = ${(lengte(s3) / lengte(s1)).toFixed(4)} (3 m tegen 2 m)`);
  assert.deepEqual(beeld.knopen.map((k) => k.id), [1, 2, 6]);
  assert.equal(beeld.opleggingen.length, 1, "de oplegging op knoop 4 valt weg");
  assert.equal(beeld.teksten.filter((t) => t.tekst.startsWith("Fz")).length, 1, "alleen de last op knoop 2");
  // Het beeld past op wat overblijft: staaf 1 tekent breder dan zonder doos.
  assert.ok(lengte(s1) > lengte(beeldVan({}).staven[0]) * 2, "ingezoomd op de doos");
});
await check("een doos die uit staat, verandert het beeld niet (zonder doos precies hetzelfde)", () => {
  assert.deepEqual(beeldVan({ sectionBox: { enabled: false, bounds: DOOS_RIJ } }), beeldVan({}));
});
{
  // Twee platen bij de rij (peil 0, y = 2 … 2,5): plaat 1 van x = −3 tot 1
  // door de doosrand x = −1, plaat 2 (x = 10 … 12) geheel buiten de doos.
  const RIJ_PLATEN = {
    ...RIJ,
    nodes: [...RIJ.nodes, ...[[7, -3, 2], [8, 1, 2], [9, 1, 2.5], [10, -3, 2.5], [11, 10, 2], [12, 12, 2], [13, 12, 2.5], [14, 10, 2.5]]
      .map(([id, x, y]) => ({ id, x, y, z: 0 }))],
    plates: [{ id: 1, nodeIds: [7, 8, 9, 10], thicknessM: 0.2, material: "C30/37" },
      { id: 2, nodeIds: [11, 12, 13, 14], thicknessM: 0.2, material: "C30/37" }],
  };
  const plaatBeeld = (lagen) => openFem3DRapportBeeld({
    model: RIJ_PLATEN, lagen: { ...DEFAULT, nodes: true, plates: true, ...lagen }, view: "top", camera: null,
    resultaat: null, utilizations: [], loadCaseId: 1,
  });
  /**
   * De hoekpunten van elke getekende plaat terug in wereldmaat (m), via de
   * knopen 1 (0; 0), 2 (2; 0) en 6 (2; 1): scherm = K1 + x · ex + y · ey.
   */
  const plaatHoeken = (beeld) => {
    const k = (id) => beeld.knopen.find((n) => n.id === id);
    const k1 = k(1), k2 = k(2), k6 = k(6);
    const ex = { x: (k2.x - k1.x) / 2, y: (k2.y - k1.y) / 2 }, ey = { x: k6.x - k2.x, y: k6.y - k2.y };
    const det = ex.x * ey.y - ex.y * ey.x;
    return beeld.platen.map((p) => p.punten.split(" ").map((q) => {
      const [sx, sy] = q.split(",").map(Number);
      const dx = sx - k1.x, dy = sy - k1.y;
      return { x: (dx * ey.y - dy * ey.x) / det, y: (ex.x * dy - ex.y * dx) / det };
    }));
  };
  const bereik = (hoeken, as) => [Math.min(...hoeken.map((h) => h[as])), Math.max(...hoeken.map((h) => h[as]))];
  await check("platen zonder doos: allebei, elk met haar vier hoeken", () => {
    const hoeken = plaatHoeken(plaatBeeld({}));
    assert.equal(hoeken.length, 2);
    assert.ok(hoeken.every((h) => h.length === 4));
    const [x0, x1] = bereik(hoeken[0], "x");
    assert.ok(dichtbij(x0, -3, 0.01) && dichtbij(x1, 1, 0.01), `plaat 1: x ${x0} … ${x1}`);
  });
  await check("platen met doos: plaat 1 geknipt op x = −1 (hoeken binnen de doos), plaat 2 weg", () => {
    const hoeken = plaatHoeken(plaatBeeld({ sectionBox: { enabled: true, bounds: DOOS_RIJ } }));
    assert.equal(hoeken.length, 1, "alleen plaat 1");
    const [x0, x1] = bereik(hoeken[0], "x"), [y0, y1] = bereik(hoeken[0], "y");
    assert.ok(dichtbij(x0, -1, 0.01) && dichtbij(x1, 1, 0.01), `x ${x0} … ${x1} (geknipt op de doosrand x = −1)`);
    assert.ok(dichtbij(y0, 2, 0.01) && dichtbij(y1, 2.5, 0.01), `y ${y0} … ${y1}`);
    assert.ok(hoeken[0].every((h) => h.x >= DOOS_RIJ.min[0] - 0.01 && h.x <= DOOS_RIJ.max[0] + 0.01
      && h.y >= DOOS_RIJ.min[1] - 0.01 && h.y <= DOOS_RIJ.max[1] + 0.01), JSON.stringify(hoeken[0]));
  });
  await check("platen: een doos die uit staat, verandert het beeld niet", () => {
    assert.deepEqual(plaatBeeld({ sectionBox: { enabled: false, bounds: DOOS_RIJ } }), plaatBeeld({}));
  });
}
await check("snedekrachtlijnen worden meetkundig op de doos geknipt; die van staaf 2 valt weg", () => {
  const krachten = RIJ.beams.map((b) => ({
    memberId: b.id, nStartKn: 0, nEndKn: 0, vyStartKn: 0, vyEndKn: 0, vzStartKn: 0, vzEndKn: 0,
    torsionStartKnm: 0, torsionEndKnm: 0, myStartKnm: 10, myEndKnm: 10, mzStartKnm: 0, mzEndKnm: 0,
  }));
  const resultaat = { memberForces: krachten, reactions: [], displacements: [] };
  const zonder = beeldVan({ momentY: true, deformation: false, reactions: false }, { resultaat });
  const met = beeldVan({ momentY: true, deformation: false, reactions: false, sectionBox: { enabled: true, bounds: DOOS_RIJ } }, { resultaat });
  assert.equal(zonder.diagrammen.length, 3);
  assert.equal(met.diagrammen.length, 2, "staaf 2 ligt buiten de doos");
  // Een constante My = 10 kNm: het vlak is een rechthoek; met de doos ligt elk punt binnen het beeld.
  for (const d of met.diagrammen) {
    const punten = d.vlak.split(" ").map((p) => p.split(",").map(Number));
    assert.ok(punten.length >= 3 && punten.every(([x, y]) => x >= 0 && x <= met.breedte && y >= 0 && y <= met.hoogte), d.vlak);
  }
});

/* ── [7] Kader ───────────────────────────────────────────────────────── */
console.log("\n[7] Selectievenster en crossing met section box");
{
  // Recht van boven, 20 px per m: staaf 1 (0..4, y = 0) binnen, staaf 2 (8..12) buiten,
  // staaf 3 (3..9, y = 2) door de doos x ≤ 5.
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(5, 0, 50);
  camera.up.set(0, 1, 0);
  camera.lookAt(5, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const model = {
    nodes: [[1, 0, 0, 0], [2, 4, 0, 0], [3, 8, 0, 0], [4, 12, 0, 0], [5, 3, 2, 0], [6, 9, 2, 0]].map(([id, x, y, z]) => ({ id, x, y, z })),
    beams: [[1, 1, 2], [2, 3, 4], [3, 5, 6]].map(([id, startNodeId, endNodeId]) => ({ id, startNodeId, endNodeId })),
    plates: [],
  };
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const meshes = model.beams.map((beam) => {
    const a = byId.get(beam.startNodeId), b = byId.get(beam.endNodeId);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.x - a.x, 0.1, 0.1), new THREE.MeshBasicMaterial());
    mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
    mesh.userData = { type: "beam", id: beam.id };
    mesh.updateMatrixWorld();
    return mesh;
  });
  const doos = grenzen([-1, -1, -1], [5, 5, 1]);
  const px = (x, y) => ({ x: (x - 5 + 10) * 20, y: (10 - y) * 20 });
  const kader = (x0, y0, x1, y1) => {
    const a = px(x0, y1), b = px(x1, y0);
    return { left: a.x, top: a.y, right: b.x, bottom: b.y };
  };
  const kies = (k, modus, d, knopen = false) => selectOpenFem3DInScreenBox(model, meshes, camera, 400, 400, k, null, false, knopen, modus, [], d);
  await check("venster om x −2 … 6: zonder doos alleen staaf 1, met doos ook het zichtbare stuk van staaf 3 (3 … 5)", () => {
    assert.deepEqual(kies(kader(-2, -1, 6, 3), "venster", null), { type: "beam", id: 1 });
    assert.deepEqual(kies(kader(-2, -1, 6, 3), "venster", doos), { type: "multi", nodeIds: [], beamIds: [1, 3] });
  });
  await check("crossing over x 6 … 13: zonder doos staaf 2 en 3, met doos niets (wat het kader raakt is niet getekend)", () => {
    assert.deepEqual(kies(kader(6, -1, 13, 3), "crossing", null), { type: "multi", nodeIds: [], beamIds: [2, 3] });
    assert.equal(kies(kader(6, -1, 13, 3), "crossing", doos), null);
    assert.deepEqual(kies(kader(4, 1, 13, 3), "crossing", doos), { type: "beam", id: 3 }, "het zichtbare stuk 4 … 5 raakt het kader");
  });
  await check("knopen alleen binnen de doos; een venster over alles neemt de knopen buiten de doos niet mee", () => {
    const alles = kies(kader(-2, -1, 13, 3), "venster", doos, true);
    assert.deepEqual(alles, { type: "multi", nodeIds: [1, 2, 5], beamIds: [1, 3] });
  });
  await check("een last met zijn pijl buiten de doos telt niet; binnen wel", () => {
    const pijl = (id, x) => ({ selection: { type: "nodalLoad", id }, a: { x, y: 0, z: 0.5 }, b: { x, y: 0, z: 0 } });
    const leeg = { ...model, beams: [] };
    const k = kader(-2, -1, 13, 1);
    assert.equal(selectOpenFem3DInScreenBox(leeg, [], camera, 400, 400, k, null, false, false, "crossing", [pijl(7, 10)], doos), null);
    assert.deepEqual(selectOpenFem3DInScreenBox(leeg, [], camera, 400, 400, k, null, false, false, "crossing", [pijl(7, 10), pijl(8, 1)], doos),
      { type: "nodalLoad", id: 8 });
  });
  await check("een klik naast een staaf: alleen het zichtbare deel van de systeemlijn telt", () => {
    const knopen = new Map(model.nodes.map((n) => [n.id, n]));
    const op = px(7, 2.1);
    assert.equal(findOpenFem3DBeamNearScreenPoint(model.beams, knopen, camera, 400, 400, op.x, op.y, 6, null)?.beamId, 3, "zonder doos");
    assert.equal(findOpenFem3DBeamNearScreenPoint(model.beams, knopen, camera, 400, 400, op.x, op.y, 6, doos), null, "x = 7 ligt buiten de doos");
    const binnen = px(4.5, 2.1);
    assert.equal(findOpenFem3DBeamNearScreenPoint(model.beams, knopen, camera, 400, 400, binnen.x, binnen.y, 6, doos)?.beamId, 3);
  });

  // Twee platen erbij (peil 0): plaat 1 (x 3 … 9, y 3 … 4) door de doosrand
  // x = 5, plaat 2 (x 8 … 12, y −3 … −2) geheel buiten de doos.
  const plaatHoeken = { 1: [[3, 3], [9, 3], [9, 4], [3, 4]], 2: [[8, -3], [12, -3], [12, -2], [8, -2]] };
  const metPlaten = {
    ...model,
    nodes: [...model.nodes, ...Object.values(plaatHoeken).flat().map(([x, y], i) => ({ id: 7 + i, x, y, z: 0 }))],
    plates: [{ id: 1, nodeIds: [7, 8, 9, 10] }, { id: 2, nodeIds: [11, 12, 13, 14] }],
  };
  const plaatMeshes = Object.entries(plaatHoeken).map(([id, hoeken]) => {
    const geometrie = new THREE.BufferGeometry();
    geometrie.setAttribute("position", new THREE.Float32BufferAttribute(hoeken.flatMap(([x, y]) => [x, y, 0]), 3));
    geometrie.setIndex([0, 1, 2, 0, 2, 3]);
    const mesh = new THREE.Mesh(geometrie, new THREE.MeshBasicMaterial());
    mesh.userData = { type: "plate", id: Number(id) };
    mesh.updateMatrixWorld();
    return mesh;
  });
  const kiesP = (k, modus, d) => selectOpenFem3DInScreenBox(metPlaten, [...meshes, ...plaatMeshes], camera, 400, 400, k, null, false, false, modus, [], d);
  await check("platen, venster over alles: zonder doos beide; met doos alleen plaat 1 (haar zichtbare deel), plaat 2 valt weg", () => {
    assert.deepEqual(kiesP(kader(-2, -4, 13, 5), "venster", null), { type: "multi", nodeIds: [], beamIds: [1, 2, 3], plateIds: [1, 2] });
    assert.deepEqual(kiesP(kader(-2, -4, 13, 5), "venster", doos), { type: "multi", nodeIds: [], beamIds: [1, 3], plateIds: [1] });
  });
  await check("platen, venster om x −2 … 6, y 2,5 … 4,5: zonder doos niets (plaat 1 steekt uit), met doos plaat 1 (geknipt op x = 5)", () => {
    assert.equal(kiesP(kader(-2, 2.5, 6, 4.5), "venster", null), null);
    assert.deepEqual(kiesP(kader(-2, 2.5, 6, 4.5), "venster", doos), { type: "plate", id: 1 });
  });
  await check("platen, crossing over x 6 … 13: zonder doos beide, met doos niets; het zichtbare deel van plaat 1 (x 4 … 5) wel", () => {
    assert.deepEqual(kiesP(kader(6, -4, 13, 5), "crossing", null), { type: "multi", nodeIds: [], beamIds: [2, 3], plateIds: [1, 2] });
    assert.equal(kiesP(kader(6, -4, 13, 5), "crossing", doos), null);
    assert.equal(kiesP(kader(6, 3.2, 13, 3.6), "crossing", doos), null, "alleen het weggeknipte deel van plaat 1");
    assert.deepEqual(kiesP(kader(6, 3.2, 13, 3.6), "crossing", null), { type: "plate", id: 1 }, "zonder doos raakt het kader plaat 1");
    assert.deepEqual(kiesP(kader(4, 3.2, 13, 3.6), "crossing", doos), { type: "plate", id: 1 });
  });
}

/* ── [8] Bedrading ───────────────────────────────────────────────────── */
console.log("\n[8] Tekenvlak, menu, lint, teksten en batterij");
const canvas = bron("./src/components/openFem3d/ThreeFrameCanvas.tsx");
await check("tekenvlak: lokale clipping planes vóór elke render, alleen met een doos; de doos zelf en de oriëntatie niet", () => {
  assert.match(canvas, /renderer\.localClippingEnabled = bounds !== null/);
  assert.match(canvas, /scene\.onBeforeRender = \(\) => \{[\s\S]*?openFem3DSectionBoxKnipMaterialen\(scene, vlakken\)/);
  for (const naam of ["grid", "axes", "preview", "draftLine"]) {
    assert.match(canvas, new RegExp(`${naam}\\.userData\\.openFem3dNietKnippen = true`), naam);
  }
  assert.match(canvas, /nextGrid\.userData\.openFem3dNietKnippen = true/, "ook een nieuw raster");
});
await check("tekenvlak: alleen de doos anders = snel pad zonder opbouw; slepen tekent per beeldje zonder React", () => {
  assert.match(canvas, /writeBuildMode\(containerRef\.current, "section-box"\)/);
  assert.match(canvas, /const onGreepMove[\s\S]*?toonSectionBox\(volgende\);[\s\S]*?renderCameraInteraction\(\);/);
  assert.match(canvas, /sectionBoxChangeRef\.current\?\.\(\{ enabled: true, bounds \}\)/, "bewaard bij het loslaten");
  assert.match(canvas, /event\.key !== "Escape" \|\| !greepSleep/, "Esc tijdens slepen");
});
await check("tekenvlak: kiezen, kader, snappen, verwerven, zoomanker en labels lezen de doos", () => {
  assert.match(canvas, /const intersections = binnenDoos\(raycaster\.intersectObjects\(nonNodePickTargetsRef\.current, false\)\)/);
  assert.match(canvas, /openFem3DLoadPickSegments\(boxConditions\) : \[\],\s*sceneRef\.current\?\.sectionBox \?\? null,/);
  assert.match(canvas, /modelRef\.current\.nodes\.filter\(\(node\) => openFem3DSectionBoxBevat\(doos, node\)\)/, "knoopindex");
  assert.match(canvas, /if \(doos && !openFem3DSectionBoxBevat\(doos, candidate\.point\)\) return best;/, "stramiensnap");
  assert.ok((canvas.match(/SPOOR_VERWERF_STAAF_PX,\s*sceneRef\.current\?\.sectionBox \?\? null/g) ?? []).length === 1, "verwerven van een staaf");
  assert.match(canvas, /knipOpenFem3DLabels\(state, container\);\s*state\.labelRenderer\.render/, "labels");
  assert.match(canvas, /const doos = state\.sectionBox;\s*if \(doos\) \{[\s\S]*?intersect\(doosBox\)/, "passend beeld");
});
await check("menu ▾: Section box (schakelaar), passend op selectie (zonder selectie uitgeschakeld) en Reset; de editor bewaart de doos", () => {
  for (const id of ["sectionBox", "sectionBoxSelectie", "sectionBoxReset"]) assert.match(canvas, new RegExp(`id: "${id}"`), id);
  assert.match(canvas, /uitgeschakeld: selectionRef\.current === null/);
  assert.match(bron("./src/components/openFem3d/OpenFem3DEditor.tsx"), /onSectionBoxChange=\{\(sectionBox\) => setVisibility\(\{ \.\.\.visibility, sectionBox \}\)\}/);
  const dom = bron("./src/components/openFem3d/openFem3dViewCubeDom.ts");
  assert.match(dom, /if \(!item \|\| item\.uitgeschakeld\) return;/);
  assert.match(dom, /setAttribute\("aria-disabled", "true"\)/);
});
await check("lint: de knop Section box in de groep Beeld, met dekking in de API", () => {
  assert.match(bron("./src/components/ribbon/HomeTab.tsx"), /label=\{t\("openFem3d\.sectionBox"\)\}[^\n]*active=\{openFem3dSectionBox\}/);
  assert.match(bron("./src/components/ribbon/Ribbon.tsx"), /onOpenFem3DSectionBoxToggle=\{onOpenFem3DSectionBoxToggle\}/);
  assert.match(bron("./src/App.tsx"), /openFem3DSectionBoxSchakel\(visibility\.sectionBox, openFem3d\)/);
  assert.match(bron("./src/api/dekking.ts"), /"ribbon:openFem3d\.sectionBox": WEERGAVE/);
});
await check("teksten in nl, en, de en fr (menu en lint)", () => {
  const verwacht = { nl: "Section box", en: "Section box", de: "Schnittbox", fr: "Boîte de coupe" };
  for (const [taal, naam] of Object.entries(verwacht)) {
    const ribbon = JSON.parse(bron(`./src/i18n/locales/${taal}/ribbon.json`));
    assert.equal(ribbon.openFem3d.viewCube.sectionBox, naam, taal);
    for (const k of ["sectionBoxSelectie", "sectionBoxReset"]) assert.ok(ribbon.openFem3d.viewCube[k]?.length > 5, `${taal}: ${k}`);
    assert.equal(ribbon.openFem3d.sectionBox, naam, `${taal}: lint`);
    assert.ok(ribbon.openFem3d.sectionBoxHint?.length > 20, `${taal}: toelichting`);
  }
});
await check("de batterij draait deze test en de browserproef (op de bron)", () => {
  const runner = bron("./scripts/run-tests.mjs");
  assert.match(runner, /"open-fem3d-section-box", "open-fem3d-section-box-ui"/);
});

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
if (gefaald > 0) process.exit(1);

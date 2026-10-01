// Levels in de 3D-werkruimte: knopen en platen aan een level koppelen, een
// level verschuiven (de gekoppelde geometrie gaat mee, één stap ongedaan
// maken) en het werkvlak voor tekenen op het actieve level.
//
// WAAROM DEZE TEST BESTAAT
// Een level is een horizontale stramienas (zAxes, hoogte in mm); het 3D-model
// rekent in meters. Een koppeling die de omrekening mist, zet een verdieping
// een factor 1000 te hoog. Een koppeling die bij een bewerking blijft hangen
// terwijl de knoop al van hoogte veranderde, trekt de knoop bij de volgende
// levelwijziging stil terug. En een levelverschuiving die de volle-lengte-last
// op een kolom niet meeneemt, laat een deel van de kolom onbelast. Elk getal
// hieronder volgt rechtstreeks uit de invoer (hoogte / 1000, lengtes als
// verschil van twee hoogtes, snijpunten van een rechte lijn met een vlak).
//
// Checks:
//  [1] MODEL      — levelId op knoop en plaat overleeft modelpoort en
//                   projectbestand; een oud model blijft bit-gelijk; een
//                   ongeldige verwijzing wordt geweigerd; een plaatkoppeling
//                   met een losse knoop valt weg.
//  [2] KNOOP      — koppelen zet z = hoogte/1000; ontkoppelen laat hem staan.
//  [3] PLAAT      — koppelen neemt alle knopen mee (ook de opening);
//                   een door een plaat vastgehouden knoop los ontkoppelen of
//                   aan een ander level hangen wordt geweigerd; ontkoppelen
//                   van de plaat maakt haar knopen vrij.
//  [4] MEERVOUDIG — knopen en platen in één aanroep, één modelwijziging.
//  [5] VERSCHUIVEN — 3000 → 3500 mm: gekoppelde knopen en plaat op 3,5 m,
//                   een losse knoop blijft; volle-lengte-last volgt de kolom,
//                   een deellast houdt zijn plaats; naar 0 → staaf zonder
//                   lengte geweigerd; een plaat die scheef zou trekken
//                   geweigerd; level weg → koppeling weg, knoop blijft.
//  [6] BEWERKEN   — verplaatsen/kopiëren/roteren/spiegelen: een knoop die
//                   van hoogte verandert raakt zijn level kwijt, op dezelfde
//                   hoogte blijft hij gekoppeld; een plaat volgt haar knopen.
//  [7] REKENKERN  — het rekenverzoek draagt alleen id/x/y/z per knoop.
//  [8] ONGEDAAN   — levelstap met en zonder meeschuivende knopen; undo zet de
//                   hoogte terug, redo opnieuw; een verwijderd level komt op
//                   zijn plaats terug.
//  [9] WERKVLAK   — actief level (standaard peil 0), keuzelijst, en het
//                   snijpunt van een kijkstraal met het werkvlak in scheef,
//                   boven- en vooraanzicht.
// [10] BUITENAF   — de controle voor het bedieningskanaal (MCP).
// [11] KANAAL     — gui_build_3d_model met levels en `level` bij knoop en
//                   plaat; gui_configure_3d_view houdt een level aan zijn
//                   label vast, zodat gekoppelde knopen meeschuiven; foute
//                   invoer wordt geweigerd zonder het model te raken.
//
// Uitvoeren: node scripts/run-tests.mjs --filter=open-fem3d-levels

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

// OpenFem3DProperties.tsx importeert stylesheets; Node kent die niet. Een lege
// module volstaat: hier wordt alleen de zuivere coördinaatfunctie gebruikt.
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function load(url, ctx, next) {" +
        " if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };" +
        " return next(url, ctx); }",
    ),
);

const {
  applyOpenFem3DLevels, linkOpenFem3DToLevel, openFem3DLevelLinkError, openFem3DLevelRefusalText,
  openFem3DLevelTransition, openFem3DPlateHoldingNode, withOpenFem3DLevelPatch, withoutUnknownOpenFem3DLevelLinks,
  openFem3DLevelName, openFem3DLevelsByHeight,
} = await import("./src/components/openFem3d/openFem3dLevels.ts");
const splitModule = await import("./src/components/openFem3d/openFem3dModel.ts");
const { parseOpenFem3DModel } = splitModule;
const { transformOpenFem3D } = await import("./src/components/openFem3d/openFem3dTransform.ts");
const { buildOpenFem3DSolveRequest } = await import("./src/components/openFem3d/openFem3dSolver.ts");
const { openFem3dHistoryReducer, openFem3DHistoryLevelPatch } = await import("./src/components/openFem3d/openFem3dHistory.ts");
const {
  intersectOpenFem3DWorkPlane, openFem3DWorkLevel, openFem3DWorkPlaneOptions, openFem3DWorkPlaneOrigin,
} = await import("./src/components/openFem3d/openFem3dWorkPlane.ts");
const { serializeProject, deserializeProject } = await import("./src/io/projectFile.ts");
const { openFem3DModelWithNodeCoordinate } = await import("./src/components/openFem3d/OpenFem3DProperties.tsx");

let geslaagd = 0;
let gefaald = 0;
function check(naam, proef) {
  try {
    proef();
    geslaagd += 1;
    console.log(`  ✓ ${naam}`);
  } catch (fout) {
    gefaald += 1;
    console.log(`  ✗ ${naam}\n      ${String(fout?.message ?? fout).split("\n").join("\n      ")}`);
  }
}

const LEVELS = [
  { id: "peil0", label: "Peil 0", position: 0 },
  { id: "v1", label: "1e verdieping", position: 3000 },
];
const node = (model, id) => model.nodes.find((item) => item.id === id);
const plate = (model, id) => model.plates.find((item) => item.id === id);

/* ── [1] Model ───────────────────────────────────────────────────────── */
console.log("\n[1] Model en projectbestand");
check("levelId op knoop en plaat blijft door de modelpoort en het projectbestand", () => {
  const model3d = {
    nodes: [
      { id: 1, x: 0, y: 0, z: 3, levelId: "v1" }, { id: 2, x: 4, y: 0, z: 3, levelId: "v1" },
      { id: 3, x: 4, y: 4, z: 3, levelId: "v1" }, { id: 4, x: 0, y: 4, z: 3, levelId: "v1" },
      { id: 5, x: 0, y: 0, z: 0 },
    ],
    beams: [{ id: 1, startNodeId: 5, endNodeId: 1 }],
    plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2, levelId: "v1" }],
  };
  const parsed = parseOpenFem3DModel(model3d);
  assert.equal(node(parsed, 1).levelId, "v1");
  assert.equal(node(parsed, 5).levelId, undefined, "een vrije knoop krijgt geen veld");
  assert.equal(plate(parsed, 1).levelId, "v1");
  const project = {
    nodes: [], beams: [], supports: [], plates: [], loads: [],
    loadCases: [{ id: 1, name: "Permanent", type: "dead" }], activeLoadCaseId: 1,
    selfWeightEnabled: false, nonlinearEnabled: false,
    structuralGrid: { enabled: true, xAxes: [], yAxes: [], zAxes: LEVELS },
    model3d,
  };
  const terug = deserializeProject(serializeProject(project));
  assert.equal(node(terug.model3d, 3).levelId, "v1");
  assert.equal(plate(terug.model3d, 1).levelId, "v1");
  assert.deepEqual(terug.structuralGrid.zAxes, LEVELS);
});
check("een model zonder levels komt bit-gelijk door de modelpoort", () => {
  const oud = {
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 3 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }],
  };
  const parsed = parseOpenFem3DModel(oud);
  assert.deepEqual(parsed.nodes, oud.nodes);
  assert.ok(parsed.nodes.every((item) => !("levelId" in item)));
});
check("een levelverwijzing die geen tekst is wordt geweigerd; leeg of null betekent geen", () => {
  assert.throws(() => parseOpenFem3DModel({ nodes: [{ id: 1, x: 0, y: 0, z: 0, levelId: 7 }], beams: [] }),
    /ongeldige levelverwijzing/);
  const leeg = parseOpenFem3DModel({ nodes: [{ id: 1, x: 0, y: 0, z: 0, levelId: " " }, { id: 2, x: 1, y: 0, z: 0, levelId: null }], beams: [] });
  assert.ok(leeg.nodes.every((item) => item.levelId === undefined));
});
check("een plaat op een level met een knoop die niet aan dat level hangt verliest de koppeling (geometrie blijft)", () => {
  const parsed = parseOpenFem3DModel({
    nodes: [
      { id: 1, x: 0, y: 0, z: 3, levelId: "v1" }, { id: 2, x: 4, y: 0, z: 3, levelId: "v1" },
      { id: 3, x: 4, y: 4, z: 3 }, { id: 4, x: 0, y: 4, z: 3, levelId: "v1" },
    ],
    beams: [],
    plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2, levelId: "v1" }],
  });
  assert.equal(plate(parsed, 1).levelId, undefined);
  assert.equal(node(parsed, 1).levelId, "v1", "de knoopkoppelingen zelf blijven");
  assert.deepEqual(parsed.nodes.map((item) => item.z), [3, 3, 3, 3]);
});
check("koppelingen naar een verdwenen level vallen bij het openen weg zonder iets te verplaatsen", () => {
  const model = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 3, levelId: "weg" }, { id: 2, x: 0, y: 0, z: 0, levelId: "peil0" }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }],
  });
  const schoon = withoutUnknownOpenFem3DLevelLinks(model, LEVELS);
  assert.equal(node(schoon, 1).levelId, undefined);
  assert.equal(node(schoon, 1).z, 3);
  assert.equal(node(schoon, 2).levelId, "peil0");
  assert.strictEqual(withoutUnknownOpenFem3DLevelLinks(schoon, LEVELS), schoon, "niets te doen = zelfde model");
});

/* ── [2] Knoop ───────────────────────────────────────────────────────── */
console.log("\n[2] Knoop koppelen en ontkoppelen");
const kolom = {
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 2.75 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }],
};
check("koppelen aan 1e verdieping (3000 mm) zet z = 3,000 m", () => {
  const r = linkOpenFem3DToLevel(kolom, { nodeIds: [2] }, "v1", LEVELS);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(node(r.model, 2), { id: 2, x: 0, y: 0, z: 3, levelId: "v1" });
  assert.strictEqual(node(r.model, 1), kolom.nodes[0], "de andere knoop is hetzelfde object");
  assert.deepEqual(kolom.nodes[1], { id: 2, x: 0, y: 0, z: 2.75 }, "het bronmodel blijft ongewijzigd");
  const nogmaals = linkOpenFem3DToLevel(r.model, { nodeIds: [2] }, "v1", LEVELS);
  assert.strictEqual(nogmaals.model, r.model, "opnieuw hetzelfde level kiezen is geen wijziging");
});
check("ontkoppelen laat de knoop op 3,000 m staan", () => {
  const gekoppeld = linkOpenFem3DToLevel(kolom, { nodeIds: [2] }, "v1", LEVELS).model;
  const r = linkOpenFem3DToLevel(gekoppeld, { nodeIds: [2] }, null, LEVELS);
  assert.ok(r.ok);
  assert.deepEqual(node(r.model, 2), { id: 2, x: 0, y: 0, z: 3 });
});
check("een onbekend level wordt geweigerd", () => {
  const r = linkOpenFem3DToLevel(kolom, { nodeIds: [2] }, "bestaat-niet", LEVELS);
  assert.deepEqual(r, { ok: false, refusal: { kind: "unknownLevel", levelId: "bestaat-niet" } });
});
check("beide kolomknopen op hetzelfde level → staaf zonder lengte, geweigerd", () => {
  const r = linkOpenFem3DToLevel(kolom, { nodeIds: [1, 2] }, "peil0", LEVELS);
  assert.deepEqual(r, { ok: false, refusal: { kind: "zeroLengthBeam", beamId: 1 } });
});

/* ── [3] Plaat ───────────────────────────────────────────────────────── */
console.log("\n[3] Plaat koppelen");
// Vloerplaat 6 × 4 m op z = 2,8 m met een opening 1 × 1 m, en een tweede
// plaat die de rand 2–3 deelt.
const vloer = parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 2.8 }, { id: 2, x: 6, y: 0, z: 2.8 }, { id: 3, x: 6, y: 4, z: 2.8 }, { id: 4, x: 0, y: 4, z: 2.8 },
    { id: 5, x: 2, y: 1, z: 2.8 }, { id: 6, x: 3, y: 1, z: 2.8 }, { id: 7, x: 3, y: 2, z: 2.8 }, { id: 8, x: 2, y: 2, z: 2.8 },
    { id: 9, x: 9, y: 0, z: 2.8 }, { id: 10, x: 9, y: 4, z: 2.8 },
    { id: 11, x: 0, y: 0, z: 0 },
  ],
  beams: [{ id: 1, startNodeId: 11, endNodeId: 1 }],
  plates: [
    { id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2, openings: [{ id: 1, nodeIds: [5, 6, 7, 8] }] },
    { id: 2, nodeIds: [2, 9, 10, 3], thicknessM: 0.2 },
  ],
});
check("plaat 1 op 1e verdieping: alle acht knopen (rand en opening) op 3,000 m en gekoppeld", () => {
  const r = linkOpenFem3DToLevel(vloer, { plateIds: [1] }, "v1", LEVELS);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(plate(r.model, 1).levelId, "v1");
  for (const id of [1, 2, 3, 4, 5, 6, 7, 8]) assert.deepEqual([node(r.model, id).z, node(r.model, id).levelId], [3, "v1"], `knoop ${id}`);
  assert.equal(node(r.model, 11).z, 0, "de kolomvoet blijft op peil 0");
  assert.equal(plate(r.model, 2).levelId, undefined, "plaat 2 zelf is niet gekoppeld");
  assert.equal(openFem3DPlateHoldingNode(r.model, 2)?.id, 1);
  assert.equal(openFem3DPlateHoldingNode(r.model, 9), null);
});
check("een naastgelegen plaat die vlak blijft mag mee; één die scheef trekt → geweigerd met de melding van de modelpoort", () => {
  // Knoop 2 en 3 gaan naar 3,0 m; 9 en 10 blijven op 2,8 m. Vier punten
  // (6,0,3) (9,0,2.8) (9,4,2.8) (6,4,3) liggen WEL in één vlak (de helling
  // loopt alleen in x), dus dit mag. Scheef wordt het pas als één hoek afwijkt.
  const r = linkOpenFem3DToLevel(vloer, { plateIds: [1] }, "v1", LEVELS);
  assert.ok(r.ok, "een hellende naastgelegen plaat blijft vlak");
  const scheef = linkOpenFem3DToLevel(vloer, { nodeIds: [9] }, "v1", LEVELS);
  assert.equal(scheef.ok, false);
  assert.equal(scheef.refusal.kind, "invalidGeometry");
  assert.match(scheef.refusal.message, /3D-plaat 2 moet vlak zijn/);
});
check("een knoop die plaat 1 vasthoudt: los ontkoppelen of ander level → geweigerd", () => {
  const gekoppeld = linkOpenFem3DToLevel(vloer, { plateIds: [1] }, "v1", LEVELS).model;
  assert.deepEqual(linkOpenFem3DToLevel(gekoppeld, { nodeIds: [5] }, null, LEVELS),
    { ok: false, refusal: { kind: "heldByPlate", nodeId: 5, plateId: 1, levelId: "v1" } });
  assert.deepEqual(linkOpenFem3DToLevel(gekoppeld, { nodeIds: [2] }, "peil0", LEVELS),
    { ok: false, refusal: { kind: "heldByPlate", nodeId: 2, plateId: 1, levelId: "v1" } });
  assert.strictEqual(linkOpenFem3DToLevel(gekoppeld, { nodeIds: [2] }, "v1", LEVELS).model, gekoppeld,
    "hetzelfde level mag en verandert niets");
  const tekst = openFem3DLevelRefusalText({ kind: "heldByPlate", nodeId: 5, plateId: 1, levelId: "v1" }, LEVELS);
  assert.deepEqual(tekst, { key: "openFem3d.levels.refused.heldByPlate", values: { node: 5, plate: 1, level: "1e verdieping" } });
});
check("plaat 1 ontkoppelen: plaat en knopen vrij, alles blijft op 3,000 m", () => {
  const gekoppeld = linkOpenFem3DToLevel(vloer, { plateIds: [1] }, "v1", LEVELS).model;
  const r = linkOpenFem3DToLevel(gekoppeld, { plateIds: [1] }, null, LEVELS);
  assert.ok(r.ok);
  assert.equal(plate(r.model, 1).levelId, undefined);
  for (const id of [1, 2, 3, 4, 5, 6, 7, 8]) assert.deepEqual([node(r.model, id).z, node(r.model, id).levelId], [3, undefined]);
});
check("twee platen op hetzelfde level: één ontkoppelen houdt de gedeelde knopen aan het level", () => {
  const beide = linkOpenFem3DToLevel(vloer, { plateIds: [1, 2] }, "v1", LEVELS).model;
  const r = linkOpenFem3DToLevel(beide, { plateIds: [1] }, null, LEVELS);
  assert.ok(r.ok);
  assert.equal(node(r.model, 2).levelId, "v1", "knoop 2 hoort ook bij plaat 2");
  assert.equal(node(r.model, 3).levelId, "v1", "knoop 3 hoort ook bij plaat 2");
  assert.equal(node(r.model, 1).levelId, undefined, "knoop 1 alleen bij plaat 1");
  assert.equal(plate(r.model, 2).levelId, "v1");
});

/* ── [4] Meervoudig ──────────────────────────────────────────────────── */
console.log("\n[4] Meervoudige selectie");
check("knoop 9 en 10 met plaat 1 en 2 in één keuze op 1e verdieping: alles op 3,000 m, één modelwijziging", () => {
  const r = linkOpenFem3DToLevel(vloer, { nodeIds: [9, 10], plateIds: [1, 2] }, "v1", LEVELS);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => node(r.model, id).z), Array(10).fill(3));
  assert.deepEqual([plate(r.model, 1).levelId, plate(r.model, 2).levelId], ["v1", "v1"]);
  let stappen = { model: vloer, past: [], future: [] };
  stappen = openFem3dHistoryReducer(stappen, { type: "edit", model: r.model });
  assert.equal(stappen.past.length, 1, "één keuze is één stap ongedaan maken");
});

/* ── [5] Verschuiven ─────────────────────────────────────────────────── */
console.log("\n[5] Level verschuiven");
// Twee kolommen van peil 0 naar 1e verdieping met een ligger ertussen, een
// losse knoop op 3,0 m die niet gekoppeld is, en drie staaflasten.
const portaal = parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0, levelId: "peil0" }, { id: 2, x: 6, y: 0, z: 0, levelId: "peil0" },
    { id: 3, x: 0, y: 0, z: 3, levelId: "v1" }, { id: 4, x: 6, y: 0, z: 3, levelId: "v1" },
    { id: 5, x: 3, y: 5, z: 3 },
  ],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 3 }, { id: 2, startNodeId: 2, endNodeId: 4 },
    { id: 3, startNodeId: 3, endNodeId: 4 },
  ],
  memberLoads: [
    { id: 1, beamId: 1, qyStart: 0, qyEnd: 0, qzStart: -2, qzEnd: -2, startPositionM: 0, endPositionM: 3 },
    { id: 2, beamId: 2, qyStart: 0, qyEnd: 0, qzStart: -1, qzEnd: -1, startPositionM: 0.5, endPositionM: 1.5 },
    { id: 3, beamId: 3, qyStart: 0, qyEnd: 0, qzStart: -5, qzEnd: -5, startPositionM: 0, endPositionM: 6 },
  ],
  memberPointLoads: [{ id: 1, beamId: 2, py: 0, pz: -4, positionM: 1 }],
});
const verhoogd = LEVELS.map((level) => level.id === "v1" ? { ...level, position: 3500 } : level);
check("1e verdieping 3000 → 3500 mm: knoop 3 en 4 op 3,500 m, knoop 5 (los) blijft op 3,000 m", () => {
  const r = applyOpenFem3DLevels(portaal, verhoogd);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.model.nodes.map((item) => item.z), [0, 0, 3.5, 3.5, 3]);
  assert.deepEqual(r.model.nodes.map((item) => item.levelId), ["peil0", "peil0", "v1", "v1", undefined]);
});
check("de volle-lengtelast op kolom 1 loopt mee tot 3,5 m; deellast en puntlast op kolom 2 houden hun plaats", () => {
  const r = applyOpenFem3DLevels(portaal, verhoogd);
  const last = (id) => r.model.memberLoads.find((item) => item.id === id);
  assert.deepEqual([last(1).startPositionM, last(1).endPositionM], [0, 3.5]);
  assert.deepEqual([last(2).startPositionM, last(2).endPositionM], [0.5, 1.5]);
  assert.strictEqual(last(3), portaal.memberLoads[2], "de ligger verandert niet van lengte (6 m)");
  assert.equal(r.model.memberPointLoads[0].positionM, 1);
});
check("ongewijzigde levels veranderen niets: zelfde model", () => {
  assert.strictEqual(applyOpenFem3DLevels(portaal, LEVELS).model, portaal);
});
check("1e verdieping naar 0 mm → kolom 1 zonder lengte, geweigerd", () => {
  const r = applyOpenFem3DLevels(portaal, LEVELS.map((level) => level.id === "v1" ? { ...level, position: 0 } : level));
  assert.deepEqual(r, { ok: false, refusal: { kind: "zeroLengthBeam", beamId: 1 } });
});
check("een kolomlast die buiten de kortere kolom valt → geweigerd met de melding van de modelpoort", () => {
  const r = applyOpenFem3DLevels(portaal, LEVELS.map((level) => level.id === "v1" ? { ...level, position: 1200 } : level));
  assert.equal(r.ok, false);
  assert.equal(r.refusal.kind, "invalidGeometry");
  assert.match(r.refusal.message, /binnen de staaflengte van 1\.2 m/);
});
check("level 1e verdieping verwijderd: knoop 3 en 4 los, op 3,000 m", () => {
  const r = applyOpenFem3DLevels(portaal, LEVELS.filter((level) => level.id !== "v1"));
  assert.ok(r.ok);
  assert.deepEqual([node(r.model, 3).z, node(r.model, 3).levelId, node(r.model, 4).levelId], [3, undefined, undefined]);
  assert.equal(node(r.model, 1).levelId, "peil0");
});
check("een plaat op een level schuift als geheel mee en blijft horizontaal", () => {
  const opVloer = linkOpenFem3DToLevel(vloer, { plateIds: [1, 2] }, "v1", LEVELS).model;
  const r = applyOpenFem3DLevels(opVloer, verhoogd);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => node(r.model, id).z), Array(10).fill(3.5));
  assert.equal(node(r.model, 11).z, 0);
});
check("een hellende plaat met één gekoppelde hoek trekt scheef → geweigerd", () => {
  // Vlak z = 3 + y/4 door A(0,0,3) B(4,0,3) C(4,4,4) D(0,4,4); alleen A hangt
  // aan het level. A naar 3,5 m ligt niet meer in het vlak door B, C en D.
  const helling = parseOpenFem3DModel({
    nodes: [
      { id: 1, x: 0, y: 0, z: 3, levelId: "v1" }, { id: 2, x: 4, y: 0, z: 3 },
      { id: 3, x: 4, y: 4, z: 4 }, { id: 4, x: 0, y: 4, z: 4 },
    ],
    beams: [],
    plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2 }],
  });
  const r = applyOpenFem3DLevels(helling, verhoogd);
  assert.equal(r.ok, false);
  assert.equal(r.refusal.kind, "invalidGeometry");
});

/* ── [6] Bewerken ────────────────────────────────────────────────────── */
console.log("\n[6] Bewerkingen en de koppeling");
const opLevel = linkOpenFem3DToLevel(vloer, { plateIds: [1] }, "v1", LEVELS).model;
check("horizontaal verplaatsen (dz = 0) houdt knoop en plaat op het level", () => {
  const r = transformOpenFem3D(opLevel, { type: "plate", id: 1 }, { kind: "move", dx: 1, dy: 0, dz: 0 });
  assert.equal(node(r.model, 1).levelId, "v1");
  assert.equal(plate(r.model, 1).levelId, "v1");
});
check("verticaal verplaatsen maakt de knopen en de plaat los", () => {
  const r = transformOpenFem3D(opLevel, { type: "plate", id: 1 }, { kind: "move", dx: 0, dy: 0, dz: 0.5 });
  assert.deepEqual([node(r.model, 1).z, node(r.model, 1).levelId], [3.5, undefined]);
  assert.equal(plate(r.model, 1).levelId, undefined);
});
check("één hoek verticaal verplaatsen: die knoop los, de plaat ook (haar knopen hangen niet meer allemaal aan het level)", () => {
  const r = transformOpenFem3D(opLevel, { type: "node", id: 4 }, { kind: "move", dx: 0, dy: 0, dz: 0.25 });
  assert.equal(node(r.model, 4).levelId, undefined);
  assert.equal(node(r.model, 1).levelId, "v1");
  assert.equal(plate(r.model, 1).levelId, undefined);
});
check("kopiëren op dezelfde hoogte blijft gekoppeld, een verdieping hoger niet", () => {
  const naast = transformOpenFem3D(opLevel, { type: "plate", id: 1 }, { kind: "copy", dx: 0, dy: 10, dz: 0 });
  const kopie = naast.model.plates.at(-1);
  assert.equal(kopie.levelId, "v1");
  assert.ok(kopie.nodeIds.every((id) => node(naast.model, id).levelId === "v1"));
  const hoger = transformOpenFem3D(opLevel, { type: "plate", id: 1 }, { kind: "copy", dx: 0, dy: 0, dz: 3 });
  const kopie2 = hoger.model.plates.at(-1);
  assert.equal(kopie2.levelId, undefined);
  assert.ok(kopie2.nodeIds.every((id) => node(hoger.model, id).levelId === undefined && node(hoger.model, id).z === 6));
  assert.equal(plate(hoger.model, 1).levelId, "v1", "het origineel blijft gekoppeld");
});
check("roteren om Z houdt de koppeling, roteren om X of spiegelen in Z niet", () => {
  const z = transformOpenFem3D(opLevel, { type: "plate", id: 1 }, { kind: "rotate", axis: "z", angleDeg: 30 });
  assert.equal(plate(z.model, 1).levelId, "v1");
  const x = transformOpenFem3D(opLevel, { type: "plate", id: 1 }, { kind: "rotate", axis: "x", angleDeg: 90 });
  assert.equal(plate(x.model, 1).levelId, undefined);
  const spiegel = transformOpenFem3D(opLevel, { type: "plate", id: 1 }, { kind: "mirror", axis: "z", offset: 0 });
  assert.deepEqual([node(spiegel.model, 1).z, node(spiegel.model, 1).levelId], [-3, undefined]);
});
check("een tussenknoop op een ligger tussen twee knopen op hetzelfde level hangt ook aan dat level", () => {
  const { splitOpenFem3DBeam } = splitModule;
  const knip = splitOpenFem3DBeam(portaal, 3, 0.25);
  assert.deepEqual(node(knip.model, knip.nodeId), { id: 6, x: 1.5, y: 0, z: 3, levelId: "v1" });
  const hoger = applyOpenFem3DLevels(knip.model, verhoogd);
  assert.ok(hoger.ok);
  assert.deepEqual([3, 6, 4].map((id) => node(hoger.model, id).z), [3.5, 3.5, 3.5], "de ligger blijft recht");
  const kolom1 = splitOpenFem3DBeam(portaal, 1, 0.5);
  assert.equal(node(kolom1.model, kolom1.nodeId).levelId, undefined, "halverwege een kolom: geen level");
});
check("Z in het eigenschappenpaneel wijzigen maakt de knoop los (X/Y niet)", () => {
  const gekoppeld = linkOpenFem3DToLevel(kolom, { nodeIds: [2] }, "v1", LEVELS).model;
  assert.equal(node(openFem3DModelWithNodeCoordinate(gekoppeld, 2, "x", 1), 2).levelId, "v1");
  assert.deepEqual(node(openFem3DModelWithNodeCoordinate(gekoppeld, 2, "z", 3.2), 2), { id: 2, x: 0, y: 0, z: 3.2 });
});

/* ── [7] Rekenkern ───────────────────────────────────────────────────── */
console.log("\n[7] Rekenverzoek");
check("het verzoek aan de 3D-kern draagt per knoop alleen id, x, y en z", () => {
  const model = {
    ...portaal,
    beams: portaal.beams.map((beam) => ({ ...beam, material: "S235", profileName: "HEA200" })),
    supports: [
      { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
      { nodeId: 2, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
    ],
    loads: [{ id: 1, nodeId: 3, fx: 10, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
  };
  const verzoek = buildOpenFem3DSolveRequest(model);
  assert.deepEqual(verzoek.nodes[2], { id: 3, x: 0, y: 0, z: 3 });
  assert.ok(verzoek.nodes.every((item) => Object.keys(item).join() === "id,x,y,z"));
});

/* ── [8] Ongedaan maken ──────────────────────────────────────────────── */
console.log("\n[8] Eén stap ongedaan maken");
check("levelhoogte met meeschuivende knopen: één stap; undo zet model én hoogte terug, redo opnieuw", () => {
  const r = applyOpenFem3DLevels(portaal, verhoogd);
  const overgang = openFem3DLevelTransition(LEVELS, verhoogd);
  assert.deepEqual(overgang, {
    before: { v1: { level: { id: "v1", label: "1e verdieping", position: 3000 }, index: 1 } },
    after: { v1: { level: { id: "v1", label: "1e verdieping", position: 3500 }, index: 1 } },
  });
  let h = { model: portaal, past: [], future: [] };
  h = openFem3dHistoryReducer(h, { type: "edit", model: r.model, levels: overgang });
  assert.equal(h.past.length, 1);
  const grid = { enabled: true, xAxes: [], zAxes: verhoogd };
  const terug = openFem3DHistoryLevelPatch(h, "undo");
  h = openFem3dHistoryReducer(h, { type: "undo" });
  assert.strictEqual(h.model, portaal);
  const gridTerug = withOpenFem3DLevelPatch(grid, terug);
  assert.deepEqual(gridTerug.zAxes, LEVELS);
  const opnieuw = openFem3DHistoryLevelPatch(h, "redo");
  h = openFem3dHistoryReducer(h, { type: "redo" });
  assert.strictEqual(h.model, r.model);
  assert.deepEqual(withOpenFem3DLevelPatch(gridTerug, opnieuw).zAxes, verhoogd);
  assert.equal(openFem3DHistoryLevelPatch(h, "redo"), null, "niets meer om opnieuw te doen");
});
check("levelhoogte zonder gekoppelde knopen is ook een stap (model ongewijzigd)", () => {
  const los = { nodes: [{ id: 1, x: 0, y: 0, z: 0 }], beams: [] };
  const overgang = openFem3DLevelTransition(LEVELS, verhoogd);
  let h = { model: los, past: [], future: [] };
  h = openFem3dHistoryReducer(h, { type: "edit", model: los, levels: overgang });
  assert.equal(h.past.length, 1);
  assert.deepEqual(openFem3DHistoryLevelPatch(h, "undo"), overgang.before);
  const zonder = openFem3dHistoryReducer(h, { type: "edit", model: h.model });
  assert.strictEqual(zonder, h, "zelfde model zonder levels blijft géén stap");
});
check("een gewone modelstap na een levelstap: undo van de gewone stap raakt de levels niet", () => {
  const r = applyOpenFem3DLevels(portaal, verhoogd);
  let h = { model: portaal, past: [], future: [] };
  h = openFem3dHistoryReducer(h, { type: "edit", model: r.model, levels: openFem3DLevelTransition(LEVELS, verhoogd) });
  const verder = { ...r.model, nodes: [...r.model.nodes, { id: 6, x: 9, y: 9, z: 0 }] };
  h = openFem3dHistoryReducer(h, { type: "edit", model: verder });
  assert.equal(openFem3DHistoryLevelPatch(h, "undo"), null);
  h = openFem3dHistoryReducer(h, { type: "undo" });
  assert.ok(openFem3DHistoryLevelPatch(h, "undo"), "de levelstap ligt nu bovenop");
  assert.equal(h.pastLevels.length, h.past.length);
  assert.equal(h.futureLevels.length, h.future.length);
});
check("een verwijderd level komt bij undo op zijn plaats terug; een toegevoegd level verdwijnt", () => {
  const drie = [...LEVELS, { id: "dak", label: "Dak", position: 6000 }];
  const zonderV1 = drie.filter((level) => level.id !== "v1");
  const overgang = openFem3DLevelTransition(drie, zonderV1);
  assert.deepEqual(overgang.after, { v1: null });
  const grid = { enabled: true, xAxes: [], zAxes: zonderV1 };
  assert.deepEqual(withOpenFem3DLevelPatch(grid, overgang.before).zAxes.map((level) => level.id), ["peil0", "v1", "dak"]);
  const erbij = openFem3DLevelTransition(LEVELS, drie);
  assert.deepEqual(withOpenFem3DLevelPatch({ enabled: true, xAxes: [], zAxes: drie }, erbij.before).zAxes, LEVELS);
});
check("een nieuwe naam is geen levelstap en wordt bij undo niet teruggedraaid", () => {
  const hernoemd = LEVELS.map((level) => level.id === "v1" ? { ...level, label: "Verdieping" } : level);
  assert.equal(openFem3DLevelTransition(LEVELS, hernoemd), null);
  const overgang = openFem3DLevelTransition(LEVELS, verhoogd);
  const grid = { enabled: true, xAxes: [], zAxes: verhoogd.map((level) => level.id === "v1" ? { ...level, label: "Verdieping" } : level) };
  const terug = withOpenFem3DLevelPatch(grid, overgang.before).zAxes.find((level) => level.id === "v1");
  assert.deepEqual(terug, { id: "v1", label: "Verdieping", position: 3000 });
});
check("de bestaande contourstappen werken zoals voorheen (geen levels)", () => {
  let h = { model: portaal, past: [], future: [] };
  const a = { ...portaal, nodes: [...portaal.nodes, { id: 6, x: 1, y: 1, z: 0 }] };
  const b = { ...a, nodes: [...a.nodes, { id: 7, x: 2, y: 1, z: 0 }] };
  h = openFem3dHistoryReducer(h, { type: "edit", model: a, historyGroup: "schets" });
  h = openFem3dHistoryReducer(h, { type: "edit", model: b, historyGroup: "schets" });
  assert.equal(h.past.length, 1);
  assert.equal(h.pastLevels.length, 1);
});

/* ── [9] Werkvlak ────────────────────────────────────────────────────── */
console.log("\n[9] Werkvlak op het actieve level");
check("standaard: het level op peil 0; zonder zo'n level peil 0 zelf (z = 0)", () => {
  assert.deepEqual(openFem3DWorkLevel(LEVELS, null), { levelId: "peil0", zM: 0 });
  assert.deepEqual(openFem3DWorkLevel([{ id: "v1", position: 3000 }], undefined), { levelId: null, zM: 0 });
  assert.deepEqual(openFem3DWorkLevel(LEVELS, "v1"), { levelId: "v1", zM: 3 });
  assert.deepEqual(openFem3DWorkLevel(LEVELS, "verdwenen"), { levelId: "peil0", zM: 0 }, "een verwijderd level valt terug op peil 0");
});
check("keuzelijst van laag naar hoog; peil 0 ertussen als er geen level op 0 ligt", () => {
  const levels = [{ id: "v2", label: "2e", position: 6000 }, { id: "k", label: "Kelder", position: -2800 }, { id: "v1", label: "1e", position: 3000 }];
  assert.deepEqual(openFem3DWorkPlaneOptions(levels).map((option) => option.value), ["k", "", "v1", "v2"]);
  assert.deepEqual(openFem3DWorkPlaneOptions(LEVELS).map((option) => option.value), ["peil0", "v1"]);
  assert.deepEqual(openFem3DLevelsByHeight(levels).map((level) => level.id), ["k", "v1", "v2"]);
  assert.equal(openFem3DLevelName({ label: "", position: 3000 }), "+3,00 m", "zonder naam: de peilmaat");
  assert.equal(openFem3DLevelName({ label: "1e verdieping", position: 3000 }), "1e verdieping");
});
// Camera (8, 8, 6), richtpunt (0, 0, 1,5): de kijkstraal door het richtpunt is
// (8, 8, 6) + t·(−8, −8, −4,5). Het vlak z = h raakt hij bij t = (6 − h)/4,5.
const camera = { x: 8, y: 8, z: 6 };
const richtpunt = { x: 0, y: 0, z: 1.5 };
const straal = { x: -8, y: -8, z: -4.5 };
const dicht = (a, b) => ["x", "y", "z"].every((k) => Math.abs(a[k] - b[k]) < 1e-12);
check("scheef aanzicht: een klik midden in beeld landt op peil 0 in (−8/3, −8/3, 0), niet op het richtpunt", () => {
  const punt = intersectOpenFem3DWorkPlane(camera, straal, "iso", richtpunt, 0);
  assert.ok(dicht(punt, { x: -8 / 3, y: -8 / 3, z: 0 }), JSON.stringify(punt));
  assert.notEqual(punt.z, richtpunt.z);
});
check("scheef aanzicht op 1e verdieping (3,0 m): (8/3, 8/3, 3)", () => {
  const punt = intersectOpenFem3DWorkPlane(camera, straal, "iso", richtpunt, 3);
  assert.ok(dicht(punt, { x: 8 / 3, y: 8 / 3, z: 3 }), JSON.stringify(punt));
});
check("bovenaanzicht: recht omlaag landt op (x, y, hoogte van het level)", () => {
  const punt = intersectOpenFem3DWorkPlane({ x: 2.5, y: -1, z: 40 }, { x: 0, y: 0, z: -1 }, "top", richtpunt, 3);
  assert.ok(dicht(punt, { x: 2.5, y: -1, z: 3 }), JSON.stringify(punt));
});
check("vooraanzicht: het verticale vlak y = y van het richtpunt blijft (horizontaal staat op zijn kant)", () => {
  assert.deepEqual(openFem3DWorkPlaneOrigin("front", { x: 1, y: 2, z: 3 }, 9), { x: 1, y: 2, z: 3 });
  const punt = intersectOpenFem3DWorkPlane({ x: 1, y: -20, z: 4 }, { x: 0, y: 1, z: 0 }, "front", { x: 0, y: 2, z: 0 }, 3);
  assert.ok(dicht(punt, { x: 1, y: 2, z: 4 }), JSON.stringify(punt));
});
check("een straal evenwijdig aan of weg van het werkvlak raakt het niet", () => {
  assert.equal(intersectOpenFem3DWorkPlane(camera, { x: -1, y: 0, z: 0 }, "iso", richtpunt, 0), null);
  assert.equal(intersectOpenFem3DWorkPlane(camera, { x: 0, y: 0, z: 1 }, "iso", richtpunt, 0), null);
});

/* ── [10] Buitenaf ───────────────────────────────────────────────────── */
console.log("\n[10] Controle voor het bedieningskanaal");
check("klopt alles, dan null; z naast de levelhoogte of een losse plaatknoop geeft een melding", () => {
  assert.equal(openFem3DLevelLinkError(portaal, LEVELS), null);
  const scheef = { ...portaal, nodes: portaal.nodes.map((item) => item.id === 3 ? { ...item, z: 3.2 } : item) };
  assert.match(openFem3DLevelLinkError(scheef, LEVELS), /3D-knoop 3: z = 3\.2 m wijkt af van de hoogte van level "1e verdieping" \(3 m\)/);
  assert.match(openFem3DLevelLinkError(portaal, [LEVELS[0]]), /3D-knoop 3: level v1 bestaat niet/);
  const plaatLos = {
    nodes: [
      { id: 1, x: 0, y: 0, z: 3, levelId: "v1" }, { id: 2, x: 4, y: 0, z: 3, levelId: "v1" },
      { id: 3, x: 4, y: 4, z: 3 },
    ],
    beams: [],
    plates: [{ id: 1, nodeIds: [1, 2, 3], thicknessM: 0.2, levelId: "v1" }],
  };
  assert.match(openFem3DLevelLinkError(plaatLos, LEVELS), /3D-plaat 1 ligt op level "1e verdieping", maar knoop 3 hangt niet aan dat level/);
});
check("elke weigering heeft een tekst in nl/en/de/fr", () => {
  const weigeringen = [
    { kind: "unknownLevel", levelId: "x" }, { kind: "heldByPlate", nodeId: 1, plateId: 2, levelId: "v1" },
    { kind: "zeroLengthBeam", beamId: 3 }, { kind: "invalidGeometry", message: "m" },
  ];
  for (const taal of ["nl", "en", "de", "fr"]) {
    const ribbon = JSON.parse(readFileSync(new URL(`./src/i18n/locales/${taal}/ribbon.json`, import.meta.url), "utf8"));
    for (const weigering of weigeringen) {
      const { key } = openFem3DLevelRefusalText(weigering, LEVELS);
      const tekst = key.split(".").reduce((obj, part) => obj?.[part], ribbon);
      assert.equal(typeof tekst, "string", `${taal}: ${key}`);
    }
  }
});

/* ── [11] Bedieningskanaal ───────────────────────────────────────────── */
console.log("\n[11] Bedieningskanaal (gui_build_3d_model, gui_configure_3d_view)");
const { voerUit } = await import("./src/bediening/bediening.ts");
const { openFem3DLevelsFromMetres } = await import("./src/components/openFem3d/openFem3dLevels.ts");
/** Nagebootste app: `setStructuralGrid` volgt de levels zoals App.tsx (commitLevels → applyOpenFem3DLevels). */
function maakActies() {
  return {
    fem: { nodes: [], beams: [], loads: [], loadCases: [], combinations: [], combinationResults: null },
    modelDimension: "3d",
    openFem3d: {
      model: { nodes: [], beams: [] },
      visibility: { nodes: true, beams: true, structuralGrid: true },
      structuralGrid: { enabled: true, xAxes: [], yAxes: [], zAxes: LEVELS },
      replaceModel(model, levels) {
        this.model = model;
        if (levels) this.structuralGrid = { ...this.structuralGrid, zAxes: levels };
      },
      setStructuralGrid(grid) {
        const r = applyOpenFem3DLevels(this.model, grid.zAxes);
        if (!r.ok) throw new Error(`geweigerd: ${r.refusal.kind}`);
        this.model = r.model;
        this.structuralGrid = grid;
      },
      setVisibility() {}, setView() {}, setSelection() {},
    },
    setActiveView() {},
  };
}
const voer = async (naam, args, acties) => {
  try {
    return await voerUit(naam, args, { current: acties }, () => new Promise(() => {}), () => Promise.resolve());
  } catch (fout) {
    return { fout: fout instanceof Error ? fout.message : String(fout) };
  }
};
// Twee kolommen van Peil 0 naar een vloerplaat op de 1e verdieping (3,0 m).
const bouwArgs = {
  levels: [{ label: "Peil 0", position_m: 0 }, { label: "1e verdieping", position_m: 3 }],
  nodes: [
    { x: 0, y: 0, z: 0, level: 1 }, { x: 6, y: 0, z: 0, level: 1 },
    { x: 0, y: 0, z: 3 }, { x: 6, y: 0, z: 3 }, { x: 6, y: 4, z: 3 }, { x: 0, y: 4, z: 3 },
  ],
  beams: [{ from: 1, to: 3 }, { from: 2, to: 4 }],
  plates: [{ nodes: [3, 4, 5, 6], thickness_m: 0.2, level: 2 }],
};
{
  const a = maakActies();
  const u = await voer("model_3d_bouwen", bouwArgs, a);
  check("gui_build_3d_model koppelt knoop 1–2 aan Peil 0 en de plaat met knoop 3–6 aan 1e verdieping", () => {
    assert.ok(!u.fout, u.fout);
    assert.deepEqual(u.levelIds, ["peil0", "v1"], "een bestaand label houdt zijn id");
    assert.equal(u.aantalGekoppeldeKnopen, 6);
    assert.deepEqual(a.openFem3d.model.nodes.map((item) => item.levelId), ["peil0", "peil0", "v1", "v1", "v1", "v1"]);
    assert.equal(a.openFem3d.model.plates[0].levelId, "v1");
    assert.deepEqual(a.openFem3d.structuralGrid.zAxes.map((level) => level.position), [0, 3000]);
  });
  const v = await voer("weergave_3d_configureren", {
    structural_grid: { z_levels: [{ label: "Peil 0", position_m: 0 }, { label: "1e verdieping", position_m: 3.5 }] },
  }, a);
  check("gui_configure_3d_view: 1e verdieping naar 3,5 m neemt knoop 3–6 en de plaat mee", () => {
    assert.ok(!v.fout, v.fout);
    assert.deepEqual(a.openFem3d.model.nodes.map((item) => item.z), [0, 0, 3.5, 3.5, 3.5, 3.5]);
    assert.equal(a.openFem3d.model.plates[0].levelId, "v1");
  });
  const w = await voer("weergave_3d_configureren", {
    structural_grid: { z_levels: [{ label: "Peil 0", position_m: 0 }, { label: "1e verdieping", position_m: 0 }] },
  }, a);
  check("gui_configure_3d_view: een level dat een kolom nul lang maakt, geeft de fout van de app terug", () => {
    assert.match(w.fout ?? "", /zeroLengthBeam/);
    assert.deepEqual(a.openFem3d.model.nodes.map((item) => item.z), [0, 0, 3.5, 3.5, 3.5, 3.5], "niets verschoven");
  });
}
check("een nieuw level krijgt een ongebruikt id, ook niet dat van een vervallen level", () => {
  const nieuw = openFem3DLevelsFromMetres([{ label: "Kelder", position_m: -2.8 }, { label: "Peil 0", position_m: 0 }], LEVELS);
  assert.deepEqual(nieuw, [{ id: "z-1", label: "Kelder", position: -2800 }, { id: "peil0", label: "Peil 0", position: 0 }]);
  const botsing = openFem3DLevelsFromMetres([{ label: "A", position_m: 1.1 }], [{ id: "z-1", label: "Oud", position: 0 }]);
  assert.deepEqual(botsing, [{ id: "z-2", label: "A", position: 1100 }], "1,1 m is precies 1100 mm");
});
for (const [naam, args, verwacht] of [
  ["z naast de levelhoogte", { ...bouwArgs, nodes: bouwArgs.nodes.map((n, i) => i === 0 ? { ...n, z: 0.2 } : n) },
    /3D-knoop 1: z = 0\.2 m wijkt af van de hoogte van level "Peil 0" \(0 m\)/],
  ["level buiten de lijst", { ...bouwArgs, nodes: bouwArgs.nodes.map((n, i) => i === 0 ? { ...n, level: 3 } : n) },
    /3D-knoop 1: level moet een index van 1 tot en met 2 in levels zijn/],
  ["level zonder levels", { ...bouwArgs, levels: undefined },
    /3D-knoop 1: level verwijst naar levels, maar levels ontbreekt/],
  ["plaatknoop op een ander level", { ...bouwArgs, nodes: bouwArgs.nodes.map((n, i) => i === 2 ? { ...n, level: 1 } : n) },
    /3D-plaat 1: knoop 3 hangt aan een ander level dan de plaat/],
]) {
  const a = maakActies();
  const u = await voer("model_3d_bouwen", args, a);
  check(`gui_build_3d_model weigert ${naam}`, () => {
    assert.match(u.fout ?? "", verwacht);
    assert.deepEqual(a.openFem3d.model, { nodes: [], beams: [] }, "het oude model blijft staan");
  });
}

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald === 0 ? 0 : 1);

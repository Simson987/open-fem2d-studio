// Peilmaten bij de levels in 3D (issue #92).
//
// WAAROM DEZE TEST BESTAAT
// Een level in 3D (horizontale stramienas, hoogte in mm) droeg alleen een kale
// naam op de hoek van zijn stippelrechthoek, en alleen als het stramien
// zichtbaar was. In 2D draagt elk niveau al een peilmaat ("+3,50 m", het
// nulniveau "±0,00 m", een eigen naam ervóór, een volgnummer niet) met het
// peildriehoekje op de lijn. 3D gebruikt nu DEZELFDE notatie (lib/peilmaat.ts),
// met het driehoekje op een kort horizontaal streepje op de levelhoogte, aan de
// rand van het model. Een eigen notatie in 3D, een peilmaat op de verkeerde
// hoogte (mm/m), een peilmaat die met het stramien mee uitgaat, een peilmaat
// die in het zijaanzicht over de staven valt (vaste hoek (xMin, yMin), die
// daar het verst weg ligt) of die na passend beeld buiten beeld valt (hal van
// 30 m in vooraanzicht) zijn precies de fouten die hieronder vallen.
//
// Elk getal volgt rechtstreeks uit de invoer: hoogte / 1000, het kader is het
// uiterste van knopen en assen plus max(1 m, 12 % van het bereik), de dunning
// is ceil(n / 40) boven 80 levels, de labelbreedte is 39 px + 6,6 px per
// teken, en passend beeld wordt nagerekend met dezelfde zuivere functies.
//
// Checks:
//  [1] TEKST        — nulniveau ±0,00 m, positief en negatief niveau, eigen
//                     naam vóór de peilmaat, volgnummer niet; gelijk aan 2D.
//  [2] RAND         — hoogte in m; de vier hoeken van de modelrand op de
//                     levelhoogte; zonder knopen het stramienkader.
//  [3] HOEK         — per kijkrichting de hoek die links ligt (iso, voor, zij,
//                     achter, links; perspectief en parallel); in het
//                     zijaanzicht van een hal ligt de oude vaste hoek binnen
//                     het silhouet, de gekozen hoek erbuiten.
//  [4] LABEL        — de punt van het driehoekje ten opzichte van de hoek, de
//                     geschatte breedte (gelijk aan de CSS-maten).
//  [5] PASSEND BEELD — ruimte voor de peilmaten links: smaller bruikbaar deel,
//                     verschuiving; de hal van 30 m in vooraanzicht past mét
//                     zijn peilmaten, zonder deze ruimte niet.
//  [6] DUNNING      — tot 80 levels elk een peilmaat, daarboven elke n-de.
//  [7] ZICHTBAARHEID — stramien uit maar peilmaten aan, peilmaten uit terwijl
//                     het stramien aan blijft, beide aan, beide uit.
//  [8] SLEUTEL      — `levelMarks` bestaat, staat standaard aan, is een
//                     modellaag, staat direct na het stramien; oude
//                     instellingen en oude views zonder de sleutel: aan.
//  [9] TEKSTEN      — de regel in nl/en/de/fr.
// [10] TEKENVLAK    — het 3D-tekenvlak gebruikt deze functies (het gedrag zelf
//                     toetst test-open-fem3d-peilmaten-ui.mjs in de browser).
// [11] KANAAL       — gui_configure_3d_view kent `levelMarks` (MCP-schema) en
//                     het bedieningskanaal zet hem.
//
// Uitvoeren: node scripts/run-tests.mjs --filter=open-fem3d-peilmaten
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

// Het bedieningskanaal trekt onderdelen met stylesheets mee; Node kent die
// niet. Een lege module volstaat (zoals in test-open-fem3d-levels.mjs).
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function load(url, ctx, next) {" +
        " if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };" +
        " return next(url, ctx); }",
    ),
);

const P = await import("./src/components/openFem3d/openFem3dPeilmaten.ts");
const { niveauLabel, PEIL_DRIEHOEK_HALF_PX } = await import("./src/lib/peilmaat.ts");
const {
  DEFAULT_OPEN_FEM_3D_VISIBILITY, OPEN_FEM_3D_RESULT_LAYERS, readOpenFem3DVisibility,
} = await import("./src/components/openFem3d/openFem3dVisibility.ts");
const { parseOpenFem3DViewSets } = await import("./src/components/openFem3d/openFem3dViewSets.ts");
const { openFem3DAanzichtRichting } = await import("./src/components/openFem3d/openFem3dViewCube.ts");
const { openFem3DOrthoPassendeHalveHoogte } = await import("./src/components/openFem3d/openFem3dProjectie.ts");

let geslaagd = 0;
let gefaald = 0;
async function check(naam, proef) {
  try {
    await proef();
    geslaagd += 1;
    console.log(`  ✓ ${naam}`);
  } catch (fout) {
    gefaald += 1;
    console.log(`  ✗ ${naam}\n      ${String(fout?.message ?? fout).split("\n").join("\n      ")}`);
  }
}
const bron = (pad) => readFileSync(new URL(pad, import.meta.url), "utf8");
const dichtbij = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// Een portaal van 6 × 4 m, twee verdiepingen; levels in mm zoals het stramien.
const KNOPEN = [
  { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 },
  { id: 3, x: 0, y: 4, z: 3.5 }, { id: 4, x: 6, y: 4, z: 7 },
];
const LEVELS = [
  { id: "kelder", label: "kelder", position: -1200 },
  { id: "1", label: "1", position: 0 },
  { id: "v1", label: "1e verdieping", position: 3500 },
  { id: "3", label: "  ", position: 7000 },
];
const STRAMIEN = { enabled: true, xAxes: [{ id: "A", label: "A", position: 0 }, { id: "B", label: "B", position: 6000 }],
  yAxes: [{ id: "1", label: "1", position: 0 }, { id: "2", label: "2", position: 4000 }], zAxes: LEVELS };
const KADER = P.openFem3DStramienKader(KNOPEN, STRAMIEN);
// De rand: de knopen plus de marge van passend beeld (knoopbol/profiel), hier 0,1 m.
const RAND = { xMin: -0.1, xMax: 6.1, yMin: -0.1, yMax: 4.1 };

/* ── [1] Tekst ───────────────────────────────────────────────────────── */
console.log("\n[1] Tekst: dezelfde notatie als 2D");
const peilmaten = P.openFem3DPeilmaten(LEVELS, RAND);
const vanLevel = (id) => peilmaten.find((p) => p.levelId === id);
await check("nulniveau ±0,00 m; het volgnummer '1' staat er niet bij", () => {
  assert.equal(vanLevel("1").tekst, "±0,00 m");
});
await check("positief niveau met eigen naam: naam vóór de peilmaat", () => {
  assert.equal(vanLevel("v1").tekst, "1e verdieping  +3,50 m");
});
await check("negatief niveau met typografisch minteken", () => {
  assert.equal(vanLevel("kelder").tekst, "kelder  −1,20 m");
});
await check("lege naam: alleen de peilmaat", () => {
  assert.equal(vanLevel("3").tekst, "+7,00 m");
});
await check("elke tekst is precies niveauLabel van 2D (lib/peilmaat.ts), geen tweede notatie", () => {
  for (const level of LEVELS) assert.equal(vanLevel(level.id).tekst, niveauLabel(level.label, level.position), level.id);
});

/* ── [2] Rand ────────────────────────────────────────────────────────── */
console.log("\n[2] Rand: op de levelhoogte, aan de rand van het model");
await check("het stramienkader: knopen en assen plus de marge max(1 m, 12 % van het bereik)", () => {
  // x: 0 … 6 m → marge max(1; 0,72) = 1; y: 0 … 4 → 1; z: −1,2 … 7 → max(1; 0,984) = 1.
  assert.ok(dichtbij(KADER.xMin, -1) && dichtbij(KADER.xMax, 7), `x ${KADER.xMin} … ${KADER.xMax}`);
  assert.ok(dichtbij(KADER.yMin, -1) && dichtbij(KADER.yMax, 5), `y ${KADER.yMin} … ${KADER.yMax}`);
  assert.ok(dichtbij(KADER.zMin, -2.2) && dichtbij(KADER.zMax, 8), `z ${KADER.zMin} … ${KADER.zMax}`);
  assert.equal(KADER.baseZ, -1.2, "de basis is het eerste level");
});
await check("de rand is de begrenzing van het model; zonder knopen (of ongeldig) het stramienkader", () => {
  assert.deepEqual(P.openFem3DPeilmaatRand(RAND, KADER), RAND);
  const kaderRand = { xMin: KADER.xMin, xMax: KADER.xMax, yMin: KADER.yMin, yMax: KADER.yMax };
  assert.deepEqual(P.openFem3DPeilmaatRand(null, KADER), kaderRand);
  assert.deepEqual(P.openFem3DPeilmaatRand({ xMin: Infinity, xMax: -Infinity, yMin: Infinity, yMax: -Infinity }, KADER), kaderRand);
});
await check("hoogte in m = positie in mm / 1000", () => {
  assert.equal(vanLevel("kelder").z, -1.2);
  assert.equal(vanLevel("1").z, 0);
  assert.equal(vanLevel("v1").z, 3.5);
  assert.equal(vanLevel("3").z, 7);
});
await check("de vier hoeken van de rand op de levelhoogte, in de volgorde van de levelrechthoek", () => {
  for (const p of peilmaten) {
    assert.deepEqual(p.hoeken, [[-0.1, -0.1, p.z], [6.1, -0.1, p.z], [6.1, 4.1, p.z], [-0.1, 4.1, p.z]], p.levelId);
  }
});
await check("de rand omsluit alle knopen en ligt dicht bij het model, binnen het stramienkader", () => {
  for (const n of KNOPEN) {
    assert.ok(n.x > RAND.xMin && n.x < RAND.xMax && n.y > RAND.yMin && n.y < RAND.yMax, `knoop ${n.id}`);
  }
  assert.ok(RAND.xMin > KADER.xMin && RAND.yMin > KADER.yMin, "het kader ligt metres verder (marge ≥ 1 m)");
});

/* ── [3] Hoekkeuze ───────────────────────────────────────────────────── */
console.log("\n[3] De hoek die op het scherm links ligt");
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const kruis = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
/**
 * Projectie van een camera in richting `richting` (van het doel naar de
 * camera) met `up`, zoals three.js: rechts = up × richting. Perspectief: x
 * gedeeld door de diepte; parallel: x zelf.
 */
function projectie(richting, up, { perspectief, doel, afstand }) {
  const d = norm(richting);
  const rechts = norm(kruis(up, d));
  const positie = doel.map((v, i) => v + d[i] * afstand);
  return (p) => {
    const rel = sub(p, positie);
    const diepte = -dot(rel, d);
    if (perspectief && diepte <= 0) return null;
    const x = dot(rel, rechts);
    return { x: perspectief ? x / diepte : x, diepte };
  };
}
const AANZICHTEN = [
  ["iso", openFem3DAanzichtRichting("iso"), 0, "(xMin, yMin)"],
  ["voor", openFem3DAanzichtRichting("front"), 0, "(xMin, yMin): links en het dichtst bij"],
  ["zij (camera op +x)", openFem3DAanzichtRichting("side"), 1, "(xMax, yMin): de vaste hoek (xMin, yMin) ligt het verst weg"],
  ["achter (camera op +y)", { richting: [0, 1, 0], up: [0, 0, 1] }, 2, "(xMax, yMax)"],
  ["links (camera op −x)", { richting: [-1, 0, 0], up: [0, 0, 1] }, 3, "(xMin, yMax)"],
];
for (const [naam, { richting, up }, verwacht, uitleg] of AANZICHTEN) {
  for (const perspectief of [true, false]) {
    await check(`${naam}, ${perspectief ? "perspectief" : "parallel"}: hoek ${verwacht} ${uitleg}`, () => {
      const project = projectie(richting, up, { perspectief, doel: [3, 2, 3.5], afstand: 25 });
      for (const p of peilmaten) assert.equal(P.openFem3DPeilmaatHoek(p.hoeken, project), verwacht, p.levelId);
    });
  }
}
// De hal waarmee de fout gevonden is: 30 × 12 × 6 m.
const HAL = [];
for (const x of [0, 6, 12, 18, 24, 30]) for (const y of [0, 12]) for (const z of [0, 6]) HAL.push([x, y, z]);
const HAL_RAND = { xMin: -0.2, xMax: 30.2, yMin: -0.2, yMax: 12.2 };
const [halPeil] = P.openFem3DPeilmaten([{ id: "1", label: "1", position: 0 }], HAL_RAND);
await check("hal 30 × 12 × 6 in zijaanzicht (perspectief): de oude vaste hoek valt binnen het silhouet, de gekozen hoek erbuiten", () => {
  const { richting, up } = openFem3DAanzichtRichting("side");
  const project = projectie(richting, up, { perspectief: true, doel: [15, 6, 3], afstand: 45 });
  const knoopMin = Math.min(...HAL.map((k) => project(k).x));
  assert.ok(project(halPeil.hoeken[0]).x > knoopMin, "de vaste hoek (xMin, yMin) ligt rechts van de meest linkse knoop");
  const gekozen = halPeil.hoeken[P.openFem3DPeilmaatHoek(halPeil.hoeken, project)];
  assert.ok(project(gekozen).x < knoopMin, `gekozen hoek ${gekozen} links van alle knopen`);
});
await check("horizontale kijkrichtingen (en iso parallel): de gekozen hoek ligt links van álle knopen, op elke hoogte", () => {
  for (const [naam, { richting, up }] of AANZICHTEN) {
    for (const perspectief of [true, false]) {
      if (naam === "iso" && perspectief) continue; // iso in perspectief: de diepte hangt van de hoogte af
      const project = projectie(richting, up, { perspectief, doel: [15, 6, 3], afstand: 45 });
      const gekozen = halPeil.hoeken[P.openFem3DPeilmaatHoek(halPeil.hoeken, project)];
      const knoopMin = Math.min(...HAL.map((k) => project(k).x));
      assert.ok(project(gekozen).x < knoopMin, `${naam} ${perspectief ? "perspectief" : "parallel"}`);
    }
  }
});
await check("een hoek achter de camera telt niet mee; alles erachter: de eerste hoek", () => {
  const hoeken = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]];
  const project = (p) => (p[0] === 0 ? null : { x: p[0], diepte: 1 });
  assert.equal(P.openFem3DPeilmaatHoek(hoeken, project), 1, "de linkse hoek (x = 0) ligt achter de camera");
  assert.equal(P.openFem3DPeilmaatHoek(hoeken, () => null), 0);
  assert.equal(P.openFem3DPeilmaatHoek(hoeken, (p) => ({ x: 0, diepte: -1 - p[0] })), 0, "negatieve diepte telt niet");
});

/* ── [4] Label ───────────────────────────────────────────────────────── */
console.log("\n[4] Het label: punt, streepje en breedte");
await check("de punt van het driehoekje ligt 4 + 20 px links van de hoek, op dezelfde hoogte", () => {
  assert.deepEqual(P.openFem3DPeilmaatPuntPx(), { x: -24, y: 0 });
  assert.equal(P.OPEN_FEM_3D_PEILMAAT_AFSTAND_PX + P.OPEN_FEM_3D_PEILMAAT_STREEP_PX, 24);
});
await check("breedte = afstand 4 + streepje 20 + half driehoekje 6 + tussenruimte 3 + opvulling 2 × 3 + 6,6 px per teken", () => {
  assert.equal(PEIL_DRIEHOEK_HALF_PX, 6);
  assert.ok(dichtbij(P.openFem3DPeilmaatBreedtePx("±0,00 m"), 39 + 7 * 6.6), "7 tekens: 85,2 px");
  assert.ok(dichtbij(P.openFem3DPeilmaatBreedtePx("1e verdieping  +3,50 m"), 39 + 22 * 6.6), "22 tekens: 184,2 px");
  assert.ok(dichtbij(P.openFem3DPeilmaatRuimtePx(peilmaten), 39 + 22 * 6.6), "de ruimte is het breedste label");
  assert.equal(P.openFem3DPeilmaatRuimtePx([]), 0);
});
await check("de maten van het label staan zo in de CSS (lettergrootte 11 px, opvulling 3 px, tussenruimte 3 px)", () => {
  const css = bron("./src/components/openFem3d/OpenFem3DEditor.css");
  const tekst = /\.open-fem3d-level-mark-tekst \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(tekst, /font:\s*600 11px\//);
  assert.match(tekst, /padding:\s*1px 3px;/);
  assert.match(/\.open-fem3d-level-mark \{([^}]*)\}/.exec(css)?.[1] ?? "", /gap:\s*3px;/);
  assert.equal(P.OPEN_FEM_3D_PEILMAAT_FONT_PX, 11);
  assert.equal(P.OPEN_FEM_3D_PEILMAAT_OPVULLING_PX, 3);
  assert.equal(P.OPEN_FEM_3D_PEILMAAT_TUSSENRUIMTE_PX, 3);
});

/* ── [5] Passend beeld ───────────────────────────────────────────────── */
console.log("\n[5] Passend beeld maakt links ruimte voor de peilmaten");
await check("het bruikbare deel wordt smaller met de labelbreedte, hooguit 40 %", () => {
  assert.ok(dichtbij(P.openFem3DPeilmaatBruikbareBreedte(0.952, 1000, 85.2), 0.952 - 0.0852));
  assert.ok(dichtbij(P.openFem3DPeilmaatBruikbareBreedte(0.952, 1000, 600), 0.952 * 0.6));
  assert.equal(P.openFem3DPeilmaatBruikbareBreedte(0.952, 1000, 0), 0.952);
});
await check("verschuiving: links de rand plus de labelbreedte, rechts de rand; niet als het al past", () => {
  // Rand (1 − 0,952) / 2 × 1000 = 24 px. Model 2 × 400 px: vrij 100 aan elke kant.
  assert.ok(dichtbij(P.openFem3DPeilmaatVerschuivingPx(1000, 0.952, 400, 85.2), 24 + 85.2 - 100));
  assert.equal(P.openFem3DPeilmaatVerschuivingPx(1000, 0.952, 200, 85.2), 0, "smal model: past al");
  assert.ok(dichtbij(P.openFem3DPeilmaatVerschuivingPx(1000, 0.952, 470, 85.2), 30 - 24), "niet verder dan rechts toelaat");
  assert.equal(P.openFem3DPeilmaatVerschuivingPx(1000, 0.952, 400, 0), 0, "zonder peilmaten: niets");
});
await check("hal 30 × 12 × 6 in vooraanzicht (parallel, 1000 × 650): met de ruimte past het hele label, zonder niet", () => {
  // Zoals aimOpenFem3DCamera: de begrenzing (knopen + 0,2 m) op het cameravlak,
  // het bruikbare deel van usableViewport (breedte max(0,7; 1 − 48/1000),
  // hoogte max(0,55; 1 − 88/650)), dan de verschuiving.
  const [breed, hoog] = [1000, 650];
  const basis = { breedte: Math.max(0.7, 1 - 48 / breed), hoogte: Math.max(0.55, 1 - 88 / hoog) };
  const maten = { halfWidth: 15.2, halfHeight: 3.2 };
  const halLevels = [{ id: "1", label: "1", position: 0 }, { id: "kop", label: "kolomkop", position: 6000 }];
  const ruimte = P.openFem3DPeilmaatRuimtePx(P.openFem3DPeilmaten(halLevels, HAL_RAND));
  assert.ok(dichtbij(ruimte, 39 + 17 * 6.6), "'kolomkop  +6,00 m' is het breedste label");
  const beeld = (r) => {
    const bruikbaar = { ...basis, breedte: P.openFem3DPeilmaatBruikbareBreedte(basis.breedte, breed, r) };
    const halveHoogte = openFem3DOrthoPassendeHalveHoogte(maten, breed / hoog, bruikbaar);
    const modelHalfPx = maten.halfWidth * hoog / (2 * halveHoogte);
    const schuif = P.openFem3DPeilmaatVerschuivingPx(breed, basis.breedte, modelHalfPx, r);
    const randLinks = breed / 2 + schuif - modelHalfPx;
    return { labelLinks: randLinks - ruimte, modelRechts: breed / 2 + schuif + modelHalfPx };
  };
  const met = beeld(ruimte);
  assert.ok(met.labelLinks >= 24 - 1e-6, `label begint op ${met.labelLinks.toFixed(1)} px`);
  assert.ok(met.modelRechts <= breed - 24 + 1e-6, `model eindigt op ${met.modelRechts.toFixed(1)} px`);
  const zonder = beeld(0);
  assert.ok(zonder.labelLinks < 0, `zonder ruimte begint het label op ${zonder.labelLinks.toFixed(1)} px: buiten beeld`);
});

/* ── [6] Dunning ─────────────────────────────────────────────────────── */
console.log("\n[6] Dunning bij heel veel levels");
const reeks = (n) => Array.from({ length: n }, (_, i) => ({ id: `z${i}`, label: "", position: i * 100 }));
await check("tot en met 80 levels: elk level een peilmaat", () => {
  assert.equal(P.openFem3DLabelStride(80), 1);
  assert.equal(P.openFem3DPeilmaten(reeks(80), RAND).length, 80);
});
await check("81 levels: elke 3e (ceil(81 / 40) = 3), te beginnen bij het eerste", () => {
  assert.equal(P.openFem3DLabelStride(81), 3);
  const p = P.openFem3DPeilmaten(reeks(81), RAND);
  assert.equal(p.length, 27);
  assert.deepEqual(p.slice(0, 3).map((m) => m.levelId), ["z0", "z3", "z6"]);
});
await check("400 levels: elke 10e, 40 peilmaten", () => {
  assert.equal(P.openFem3DLabelStride(400), 10);
  assert.equal(P.openFem3DPeilmaten(reeks(400), RAND).length, 40);
});
await check("geen levels: geen peilmaten", () => {
  assert.deepEqual(P.openFem3DPeilmaten([], RAND), []);
});

/* ── [7] Zichtbaarheid ───────────────────────────────────────────────── */
console.log("\n[7] Peilmaten los van het stramien");
const zicht = (extra, grid = STRAMIEN) => P.openFem3DLevelZichtbaarheid({ ...DEFAULT_OPEN_FEM_3D_VISIBILITY, ...extra }, grid);
await check("standaard: stramien en peilmaten", () => {
  assert.deepEqual(zicht({}), { stramien: true, peilmaten: true });
});
await check("stramien uit (weergave) maar peilmaten aan", () => {
  assert.deepEqual(zicht({ structuralGrid: false }), { stramien: false, peilmaten: true });
});
await check("stramien in het model uitgezet: de peilmaten blijven", () => {
  assert.deepEqual(zicht({}, { ...STRAMIEN, enabled: false }), { stramien: false, peilmaten: true });
});
await check("peilmaten uit terwijl het stramien aan blijft", () => {
  assert.deepEqual(zicht({ levelMarks: false }), { stramien: true, peilmaten: false });
});
await check("zonder stramien (geen gegevens): niets", () => {
  assert.deepEqual(P.openFem3DLevelZichtbaarheid(DEFAULT_OPEN_FEM_3D_VISIBILITY, undefined), { stramien: false, peilmaten: false });
});
await check("stramien uit, peilmaten aan: geen stippelrechthoeken, wel elk level een peilmaat", () => {
  const w = P.openFem3DLevelWeergave(LEVELS, KADER, RAND, { stramien: false, peilmaten: true });
  assert.deepEqual(w.rechthoeken, []);
  assert.deepEqual(w.peilmaten, peilmaten);
});
await check("peilmaten uit, stramien aan: alleen de rechthoeken, op de levelhoogte rond het kader", () => {
  const w = P.openFem3DLevelWeergave(LEVELS, KADER, RAND, { stramien: true, peilmaten: false });
  assert.deepEqual(w.peilmaten, []);
  assert.equal(w.rechthoeken.length, LEVELS.length);
  const v1 = w.rechthoeken.find((r) => r.levelId === "v1");
  assert.deepEqual(v1.hoeken, [
    [KADER.xMin, KADER.yMin, 3.5], [KADER.xMax, KADER.yMin, 3.5],
    [KADER.xMax, KADER.yMax, 3.5], [KADER.xMin, KADER.yMax, 3.5],
  ]);
});
await check("beide aan: rechthoek om het kader, peilmaat aan de modelrand op dezelfde hoogte; beide uit: niets", () => {
  const w = P.openFem3DLevelWeergave(LEVELS, KADER, RAND, { stramien: true, peilmaten: true });
  for (const p of w.peilmaten) {
    const r = w.rechthoeken.find((item) => item.levelId === p.levelId);
    assert.equal(p.hoeken[0][2], r.hoeken[0][2], p.levelId);
  }
  assert.deepEqual(P.openFem3DLevelWeergave(LEVELS, KADER, RAND, { stramien: false, peilmaten: false }), { rechthoeken: [], peilmaten: [] });
});
await check("rechthoeken worden niet gedund (alleen de tekst)", () => {
  assert.equal(P.openFem3DLevelRechthoeken(reeks(400), KADER).length, 400);
});

/* ── [8] Zichtbaarheidssleutel ───────────────────────────────────────── */
console.log("\n[8] De sleutel levelMarks");
await check("bestaat en staat standaard aan", () => {
  assert.equal(DEFAULT_OPEN_FEM_3D_VISIBILITY.levelMarks, true);
});
await check("modellaag, geen resultaatlaag", () => {
  assert.equal(OPEN_FEM_3D_RESULT_LAYERS.includes("levelMarks"), false);
});
await check("direct na het stramien: de verkenner toont de rijen in deze volgorde, en ook het venster", () => {
  const sleutels = Object.keys(DEFAULT_OPEN_FEM_3D_VISIBILITY);
  assert.equal(sleutels.indexOf("levelMarks"), sleutels.indexOf("structuralGrid") + 1);
  assert.match(bron("./src/components/openFem3d/OpenFem3DVisibilityDialog.tsx"), /"structuralGrid", "levelMarks"/);
  assert.match(bron("./src/components/fem/ExplorerViewTab.tsx"), /levelMarks: \w+Icon/, "eigen pictogram in de verkenner");
});
await check("oude bewaarde instellingen zonder de sleutel: aan; uitgezet blijft uit", () => {
  const bewaard = { waarde: JSON.stringify({ structuralGrid: false }) };
  globalThis.localStorage = { getItem: () => bewaard.waarde, setItem: () => {} };
  try {
    const oud = readOpenFem3DVisibility();
    assert.equal(oud.levelMarks, true);
    assert.equal(oud.structuralGrid, false);
    bewaard.waarde = JSON.stringify({ levelMarks: false });
    assert.equal(readOpenFem3DVisibility().levelMarks, false);
  } finally {
    delete globalThis.localStorage;
  }
});
await check("oude opgeslagen view (project) zonder de sleutel: aan; een view met peilmaten uit houdt ze uit", () => {
  const camera = { position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1] };
  const [oud] = parseOpenFem3DViewSets([{ id: "view-1", name: "Oud", view: "iso", camera, visibility: { structuralGrid: false }, combinationId: null }]);
  assert.equal(oud.visibility.levelMarks, true);
  assert.equal(oud.visibility.structuralGrid, false);
  const [uit] = parseOpenFem3DViewSets([{ id: "view-2", name: "Zonder peil", view: "front", camera, visibility: { levelMarks: false }, combinationId: null }]);
  assert.equal(uit.visibility.levelMarks, false);
});

/* ── [9] Teksten ─────────────────────────────────────────────────────── */
console.log("\n[9] Teksten in vier talen");
await check("openFem3dVisibility.levelMarks in nl, en, de en fr, vier eigen vertalingen", () => {
  const teksten = {};
  for (const taal of ["nl", "en", "de", "fr"]) {
    const common = JSON.parse(bron(`./src/i18n/locales/${taal}/common.json`));
    const tekst = common.openFem3dVisibility?.levelMarks;
    assert.equal(typeof tekst, "string", `${taal}: ontbreekt`);
    assert.ok(tekst.trim(), `${taal}: leeg`);
    teksten[taal] = tekst;
  }
  assert.equal(new Set(Object.values(teksten)).size, 4, JSON.stringify(teksten));
});

/* ── [10] Tekenvlak ──────────────────────────────────────────────────── */
console.log("\n[10] Het 3D-tekenvlak");
const canvas = bron("./src/components/openFem3d/ThreeFrameCanvas.tsx");
const css = bron("./src/components/openFem3d/OpenFem3DEditor.css");
await check("geen kale levelnaam meer: de peilmaat vervangt hem", () => {
  assert.doesNotMatch(canvas, /makeLabel\(level\.label/);
  assert.doesNotMatch(canvas, /open-fem3d-level-label/);
  assert.doesNotMatch(css, /\.open-fem3d-level-label/);
});
await check("het tekenvlak gebruikt deze functies: rechthoeken, peilmaten, hoekkeuze, ruimte bij passend beeld", () => {
  assert.match(canvas, /openFem3DLevelRechthoeken\(/);
  assert.match(canvas, /openFem3DPeilmaten\(/);
  assert.match(canvas, /openFem3DLevelZichtbaarheid\(/);
  assert.match(canvas, /openFem3DPeilmaatHoek\(/);
  assert.match(canvas, /openFem3DPeilmaatVerschuivingPx\(/);
  assert.match(canvas, /openFem3DPeilmaatBruikbareBreedte\(/);
  assert.match(canvas, /visibilityChangedOnly\("levelMarks"\)/, "aan/uit zonder volledige opbouw");
});
await check("de hoek wordt vóór elke labelindeling gekozen, en de peilmaat doet mee in de botsingsregel", () => {
  assert.match(canvas, /function renderOpenFem3DLabels\([^)]*\) \{\s*placeOpenFem3DLevelMarks\(state\);/);
  assert.match(canvas, /\.open-fem3d-level-mark[,"]/);
});
await check("kleur via een CSS-variabele van het podium (wit in elk thema), voor tekst, driehoekje en streepje", () => {
  assert.match(css, /\.open-fem3d-stage \{[^}]*--open-fem3d-peilmaat:\s*#1d4ed8/s);
  for (const klasse of ["open-fem3d-level-mark", "open-fem3d-level-mark-streep", "open-fem3d-level-mark-driehoek"]) {
    assert.match(css, new RegExp(`\\.${klasse} \\{[^}]*var\\(--open-fem3d-peilmaat`, "s"), klasse);
  }
});
await check("de browserproef van het tekenvlak staat in de batterij", () => {
  assert.match(bron("./scripts/run-tests.mjs"), /"open-fem3d-peilmaten-ui"/);
});

/* ── [11] Bedieningskanaal en MCP ────────────────────────────────────── */
console.log("\n[11] Bedieningskanaal (gui_configure_3d_view)");
await check("het MCP-schema van gui_configure_3d_view kent levelMarks (strikt schema: anders geweigerd)", () => {
  const gui = bron("../src-tauri/crates/openaec-mcp-server/src/gui_tools.rs");
  const schema = /"name": "gui_configure_3d_view"[\s\S]*?"structural_grid"/.exec(gui)?.[0] ?? "";
  assert.match(schema, /"levelMarks":\{"type":"boolean"\}/);
});
{
  const { voerUit } = await import("./src/bediening/bediening.ts");
  const gezet = [];
  const acties = {
    modelDimension: "3d",
    openFem3d: {
      visibility: { ...DEFAULT_OPEN_FEM_3D_VISIBILITY },
      setVisibility(next) { gezet.push(next); this.visibility = next; },
    },
  };
  await check("weergave_3d_configureren zet levelMarks uit en laat het stramien staan", async () => {
    await voerUit("weergave_3d_configureren", { visibility: { levelMarks: false } }, { current: acties },
      () => new Promise(() => {}), () => Promise.resolve());
    assert.equal(gezet.length, 1);
    assert.equal(gezet[0].levelMarks, false);
    assert.equal(gezet[0].structuralGrid, true);
  });
}

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
if (gefaald > 0) process.exit(1);

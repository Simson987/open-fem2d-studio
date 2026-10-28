// De getallen bij de snedekrachtlijnen in 3D (issue #95):
//   [1] de instelling: Waarden aan/uit en een stand 1 … 5 (standaard: aan,
//       stand 3), onthouden als voorkeur (localStorage), robuust ingelezen;
//   [2] de staafindeling van de huidige labels en de eerste aangevinkte lijn
//       (waaronder de verkenner het sub-blok zet);
//   [3] stand 3 is precies de oude regel (zelfde staven, zelfde labels per staaf),
//       op één bewuste uitzondering na: een geselecteerde maatgevende staaf
//       houdt zijn uiterste, ook vlak naast een eind;
//   [4] stand 1: per lijn alleen de maatgevende waarde in het hele model;
//   [5] stand 2: per staaf alleen het uiterste, op de staven met de grootste waarden;
//   [6] stand 4: alle staven, labels per staaf als in stand 3;
//   [7] stand 5: begin, eind, uiterste en de kwartpunten (geïnterpoleerd);
//   [8] het aantal waarden én labels (lijnlabels plus middenlabels) neemt
//       monotoon toe met de stand (ook met selectie, schaarse lijnen, grote
//       modellen, en N en T samen op veel staven);
//   [9] geselecteerde staven altijd (ook het maatgevende uiterste naast een
//       eind); Waarden uit: geen enkel getal;
//  [10] views: optioneel veld, oude views zonder veld krijgen de standaard;
//  [11] de bedrading in tekenvlak (met uitdunnen), verkenner, editor en App
//       (per plek), en de teksten in vier talen;
//  [12] de botsingsregel: prioriteit, marge, bediening, beeldrand, uitwijken
//       van kwartpuntlabels, en het zoekrooster verandert niets.
//
// Uitvoeren: npx tsx test-open-fem3d-diagram-labels.mjs   (vanuit design-mockup/)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const opslag = new Map();
globalThis.localStorage = {
  getItem: (k) => (opslag.has(k) ? opslag.get(k) : null),
  setItem: (k, v) => { opslag.set(k, String(v)); },
  removeItem: (k) => { opslag.delete(k); },
};

const L = await import("./src/components/openFem3d/openFem3dDiagramLabels.ts");
const V = await import("./src/components/openFem3d/openFem3dViewSets.ts");
const S = await import("./src/components/openFem3d/openFem3dStandaardViews.ts");
const { DEFAULT_OPEN_FEM_3D_VISIBILITY, OPEN_FEM_3D_RESULT_LAYERS } = await import("./src/components/openFem3d/openFem3dVisibility.ts");

const HIER = dirname(fileURLToPath(import.meta.url));
let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => { if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); } };
const json = (x) => JSON.stringify(x);
const gelijk = (naam, a, b) => check(naam, json(a) === json(b), `${json(a)?.slice(0, 400)} ≠ ${json(b)?.slice(0, 400)}`);

const DIAGRAMMEN = ["shearY", "shearZ", "momentY", "momentZ"];
const MIDDEN = ["axialForce", "torsion"];
const aan = (stand) => ({ show: true, stand });

// Vaste pseudo-toeval (mulberry32): dezelfde reeks bij elke run.
function toeval(zaad) {
  let a = zaad >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Punten t = 0 … 1 (gelijk verdeeld) met waarden uit een functie van t. */
const lijn = (aantal, f) => Array.from({ length: aantal }, (_, i) => {
  const t = aantal === 1 ? 0 : i / (aantal - 1);
  return { t, value: f(t) };
});

/**
 * Staven zoals het tekenvlak ze aanlevert: per staaf zijn plek in het model,
 * de punten per actieve lijn en de waarde van het middenlabel (N, T).
 * `dicht`: elke staaf heeft elke lijn (niet nul); anders schaars, met nullijnen
 * en ontbrekende lijnen, en af en toe een staaf zonder resultaat.
 */
function staven(aantal, zaad, { dicht = false, componenten = DIAGRAMMEN, midden = MIDDEN } = {}) {
  const r = toeval(zaad);
  const uit = [];
  for (let index = 0; index < aantal; index += 1) {
    if (!dicht && r() < 0.05) continue; // staaf zonder resultaat: telt wel mee in de indeling
    const diagrams = {};
    for (const c of componenten) {
      const soort = dicht ? 1 : r();
      if (soort < 0.15) continue;
      const punten = 2 + Math.floor(r() * 20);
      if (soort < 0.4) { diagrams[c] = lijn(punten, () => 0); continue; }
      const A = 0.5 + r() * 100, B = (r() - 0.5) * 2, C = (r() - 0.5) * 2, D = r() * 6;
      diagrams[c] = lijn(punten, (t) => A * (B * (1 - t) + C * t + Math.sin(D * t) * (r() < 0.5 ? 1 : -1) * 0.3));
    }
    const mid = {};
    for (const m of midden) mid[m] = dicht || r() > 0.2 ? Math.abs((r() - 0.3) * 80) : 0;
    uit.push({ beamId: 1000 + index * 3, index, diagrams, mid });
  }
  return uit;
}

/** De regel van het tekenvlak vóór issue #95, letterlijk nagebouwd. */
function oudeRegel(beams, beamCount, geselecteerd) {
  const stride = beamCount <= 24 ? 1 : Math.ceil(beamCount / 16);
  const uit = [];
  for (const beam of beams) {
    if (!(beam.index % stride === 0 || geselecteerd.includes(beam.beamId))) continue;
    const diagrams = [];
    for (const c of DIAGRAMMEN) {
      const s = beam.diagrams[c];
      if (!s || s.length < 2 || s.every((p) => Math.abs(p.value) < 5e-4)) continue;
      const last = s.length - 1;
      const inset = Math.min(last, Math.max(1, Math.round(last * 0.18)));
      const labels = [
        { kind: "start", value: s[0].value, sample: inset },
        { kind: "end", value: s[last].value, sample: Math.max(0, last - inset) },
      ];
      let pi = 0;
      for (let i = 1; i < s.length; i += 1) if (Math.abs(s[i].value) > Math.abs(s[pi].value)) pi = i;
      if (pi > 1 && pi < last - 1) labels.push({ kind: "peak", value: s[pi].value, sample: pi });
      diagrams.push({ component: c, labels });
    }
    const mid = MIDDEN.filter((m) => beam.mid[m] !== undefined).map((m) => ({ component: m, value: beam.mid[m] }));
    if (diagrams.length > 0 || mid.length > 0) uit.push({ beamId: beam.beamId, diagrams, mid });
  }
  return uit;
}

const plan = (beams, beamCount, labels, selectedBeamIds = []) =>
  L.planOpenFem3DDiagramLabels(beams, { beamCount, labels, selectedBeamIds });

/** Het eerste punt met het grootste |waarde|. */
const piekIndex = (s) => s.reduce((best, p, i) => (Math.abs(p.value) > Math.abs(s[best].value) ? i : best), 0);

/**
 * Het plan zonder de ene bewuste afwijking van de oude regel: een
 * geselecteerde staaf die de maatgevende waarde van een lijn heeft, toont dat
 * uiterste ook als het vlak naast een eind ligt (de oude regel sloeg het daar
 * over; dan verdween de maatgevende waarde juist door te selecteren). Geeft
 * ook terug welke labels eruit gehaald zijn, om die apart te toetsen.
 */
function zonderMaatgevendeSelectie(p, beams, geselecteerd) {
  const weg = [];
  const rest = p.beams.map((b) => ({
    ...b,
    diagrams: b.diagrams.map((d) => {
      const labels = d.labels.filter((l) => {
        const extra = l.kind === "extreme" && geselecteerd.includes(b.beamId);
        if (extra) weg.push({ beamId: b.beamId, component: d.component, label: l });
        return !extra;
      });
      return { ...d, labels };
    }),
  }));
  const verklaard = weg.every(({ beamId, component, label }) => {
    const beam = beams.find((x) => x.beamId === beamId);
    const s = beam.diagrams[component];
    const last = s.length - 1;
    const piek = piekIndex(s);
    const maatgevend = Math.abs(s[piek].value) >= Math.max(...beams.map((x) => Math.max(0, ...(x.diagrams[component] ?? []).map((q) => Math.abs(q.value)))));
    return p.governingBeamIds[component] === beamId && maatgevend && label.sample === piek && label.value === s[piek].value
      && (piek === 1 || piek === last - 1);
  });
  return { rest, weg, verklaard };
}
/** Aantal lijnlabels van één component (over alle staven). */
const lijnLabels = (p, c) => p.beams.reduce((n, b) => n + (b.diagrams.find((d) => d.component === c)?.labels.length ?? 0), 0);
const middenDelen = (p, m) => p.beams.reduce((n, b) => n + b.mid.filter((x) => x.component === m).length, 0);
const telling = (p) => p.beams.reduce((n, b) => n + b.diagrams.reduce((k, d) => k + d.labels.length, 0) + b.mid.length, 0);
/** Labels op het tekenvlak: elk lijnlabel, plus één middenlabel per staaf met N en/of T. */
const elementen = (p) => p.beams.reduce((n, b) => n + b.diagrams.reduce((k, d) => k + d.labels.length, 0) + (b.mid.length > 0 ? 1 : 0), 0);
const middenLabels = (p) => p.beams.filter((b) => b.mid.length > 0).length;

// ── [1] De instelling ──────────────────────────────────────────────────────
log("[1] de instelling");
gelijk("standaard: Waarden aan, stand 3", L.DEFAULT_OPEN_FEM_3D_DIAGRAM_LABELS, { show: true, stand: 3 });
gelijk("vijf standen", L.OPEN_FEM_3D_DIAGRAM_LABEL_STANDS, [1, 2, 3, 4, 5]);
gelijk("zonder opslag: de standaard", L.readOpenFem3DDiagramLabels(), { show: true, stand: 3 });
L.saveOpenFem3DDiagramLabels({ show: false, stand: 5 });
gelijk("bewaard en teruggelezen", L.readOpenFem3DDiagramLabels(), { show: false, stand: 5 });
gelijk("eigen sleutel in de opslag", [...opslag.keys()].filter((k) => k.includes("diagramLabels")), ["open-fem-studio.openFem3d.diagramLabels"]);
opslag.set("open-fem-studio.openFem3d.diagramLabels", "{kapot");
gelijk("kapotte opslag: de standaard", L.readOpenFem3DDiagramLabels(), { show: true, stand: 3 });
opslag.set("open-fem-studio.openFem3d.diagramLabels", json({ show: "ja", stand: 9 }));
gelijk("ongeldige velden: per veld de standaard of de rand", L.readOpenFem3DDiagramLabels(), { show: true, stand: 5 });
gelijk("normaliseren: afronden en begrenzen",
  [L.normalizeOpenFem3DDiagramLabels({ show: false, stand: 2.4 }), L.normalizeOpenFem3DDiagramLabels({ stand: -3 }),
    L.normalizeOpenFem3DDiagramLabels(null), L.normalizeOpenFem3DDiagramLabels([1]), L.normalizeOpenFem3DDiagramLabels({ stand: "4" })],
  [{ show: false, stand: 2 }, { show: true, stand: 1 }, { show: true, stand: 3 }, { show: true, stand: 3 }, { show: true, stand: 3 }]);
check("gelijk-vergelijking", L.sameOpenFem3DDiagramLabels({ show: true, stand: 2 }, { show: true, stand: 2 })
  && !L.sameOpenFem3DDiagramLabels({ show: true, stand: 2 }, { show: false, stand: 2 })
  && !L.sameOpenFem3DDiagramLabels({ show: true, stand: 2 }, { show: true, stand: 3 }));

// ── [2] Indeling en eerste aangevinkte lijn ────────────────────────────────
log("\n[2] staafindeling en eerste aangevinkte lijn");
gelijk("indeling: ≤ 24 staven alle, anders elke ceil(n/16)e",
  [1, 24, 25, 32, 33, 100, 1000].map(L.openFem3DResultLabelStride), [1, 1, 2, 2, 3, 7, 63]);
// De zes snedekrachten en (issue #106) de gronddruk onder staven op bedding.
gelijk("de lijnen met waarden in de volgorde van de tab Resultaten", L.OPEN_FEM_3D_FORCE_LAYERS,
  OPEN_FEM_3D_RESULT_LAYERS.filter((k) => ["axialForce", "shearY", "shearZ", "torsion", "momentY", "momentZ", "groundPressure"].includes(k)));
gelijk("alleen de gronddruk: het sub-blok Waarden onder Gronddruk", L.openFem3DFirstActiveForceLayer({ ...DEFAULT_OPEN_FEM_3D_VISIBILITY, groundPressure: true }), "groundPressure");
gelijk("geen lijn aan: geen sub-blok", L.openFem3DFirstActiveForceLayer(DEFAULT_OPEN_FEM_3D_VISIBILITY), null);
gelijk("alleen My: onder My", L.openFem3DFirstActiveForceLayer({ ...DEFAULT_OPEN_FEM_3D_VISIBILITY, momentY: true }), "momentY");
gelijk("Vy en My: onder Vy (de eerste)", L.openFem3DFirstActiveForceLayer({ ...DEFAULT_OPEN_FEM_3D_VISIBILITY, momentY: true, shearY: true }), "shearY");
gelijk("N telt mee", L.openFem3DFirstActiveForceLayer({ ...DEFAULT_OPEN_FEM_3D_VISIBILITY, axialForce: true, momentZ: true }), "axialForce");
gelijk("vervorming en reacties tellen niet", L.openFem3DFirstActiveForceLayer({ ...DEFAULT_OPEN_FEM_3D_VISIBILITY, deformation: true, reactions: true, utilization: true }), null);
gelijk("selectie → staafnummers", [
  L.openFem3DDiagramLabelSelection(null), L.openFem3DDiagramLabelSelection({ type: "beam", id: 4 }),
  L.openFem3DDiagramLabelSelection({ type: "node", id: 4 }), L.openFem3DDiagramLabelSelection({ type: "multi", nodeIds: [1], beamIds: [9, 2] }),
], [[], [4], [], [2, 9]]);
check("getekend: ≥ 2 punten en niet overal (bijna) nul", L.openFem3DDiagramDrawn(lijn(3, (t) => t)) && !L.openFem3DDiagramDrawn(lijn(5, () => 4e-4))
  && !L.openFem3DDiagramDrawn([{ t: 0, value: 5 }]));

// ── [3] Stand 3 = de oude regel ────────────────────────────────────────────
log("\n[3] stand 3 is de oude regel");
for (const [aantal, zaad] of [[1, 1], [7, 2], [24, 3], [25, 4], [30, 5], [100, 6], [333, 7]]) {
  const beams = staven(aantal, zaad, { dicht: true });
  gelijk(`${aantal} staven, geen selectie`, plan(beams, aantal, aan(3)).beams, oudeRegel(beams, aantal, []));
  const sel = [beams[Math.floor(beams.length / 2)].beamId, beams.at(-1).beamId];
  const { rest, weg, verklaard } = zonderMaatgevendeSelectie(plan(beams, aantal, aan(3), sel), beams, sel);
  gelijk(`${aantal} staven, twee geselecteerd (op het uiterste van een geselecteerde maatgevende staaf na: ${weg.length})`,
    rest, oudeRegel(beams, aantal, sel));
  check("… en dat extra uiterste is steeds de maatgevende waarde, vlak naast een eind", verklaard, json(weg));
}
{
  // Schaars, maar met op de ingedeelde staven steeds iets voor elke lijn: ook dan gelijk.
  let vergeleken = 0, afwijkend = 0;
  for (let zaad = 100; zaad < 160; zaad += 1) {
    const aantal = 20 + (zaad % 7) * 30;
    const beams = staven(aantal, zaad);
    const stride = L.openFem3DResultLabelStride(aantal);
    const ingedeeld = beams.filter((b) => b.index % stride === 0);
    const elkeLijn = DIAGRAMMEN.every((c) => !beams.some((b) => L.openFem3DDiagramDrawn(b.diagrams[c] ?? []))
      || ingedeeld.some((b) => L.openFem3DDiagramDrawn(b.diagrams[c] ?? [])));
    if (!elkeLijn || ingedeeld.length === 0) continue;
    vergeleken += 1;
    if (json(plan(beams, aantal, aan(3)).beams) !== json(oudeRegel(beams, aantal, []))) afwijkend += 1;
  }
  check(`schaarse modellen: ${vergeleken} vergeleken, geen afwijking`, vergeleken > 20 && afwijkend === 0, `${afwijkend} afwijkend`);
}

// ── Het voorbeeld van de browserproef: 30 staven, My parabolisch ──────────
// Staaf i: My = (i + 1) · (4t(1 − t) − 0,25), 11 punten; het uiterste ligt
// in het midden (index 5): start, eind en uiterste per staaf.
const voorbeeld = Array.from({ length: 30 }, (_, i) => ({
  beamId: i + 1, index: i, diagrams: { momentY: lijn(11, (t) => (i + 1) * (4 * t * (1 - t) - 0.25)) }, mid: {},
}));

// ── [4] Stand 1 ────────────────────────────────────────────────────────────
log("\n[4] stand 1: alleen de maatgevende waarde");
{
  const p = plan(voorbeeld, 30, aan(1));
  gelijk("één label, op de staaf met het grootste |My|, het uiterste", p.beams.map((b) => [b.beamId, b.diagrams[0].labels]),
    [[30, [{ kind: "extreme", value: 30 * 0.75, sample: 5 }]]]);
  const beams = staven(200, 11, { dicht: true });
  const p2 = plan(beams, 200, aan(1));
  for (const c of DIAGRAMMEN) {
    const max = Math.max(...beams.map((b) => Math.max(...b.diagrams[c].map((x) => Math.abs(x.value)))));
    const labels = p2.beams.flatMap((b) => b.diagrams.filter((d) => d.component === c).flatMap((d) => d.labels));
    check(`${c}: één label met het grootste |waarde| (${max.toFixed(3)})`, labels.length === 1 && Math.abs(Math.abs(labels[0].value) - max) < 1e-12);
  }
  for (const m of MIDDEN) {
    const max = Math.max(...beams.map((b) => b.mid[m]));
    const delen = p2.beams.flatMap((b) => b.mid.filter((x) => x.component === m));
    check(`${m}: één waarde, de grootste`, delen.length === 1 && delen[0].value === max);
  }
}

// ── [5] Stand 2 ────────────────────────────────────────────────────────────
log("\n[5] stand 2: het uiterste op de staven met de grootste waarden");
{
  const p = plan(voorbeeld, 30, aan(2));
  gelijk("30 staven: de top 10 % met een minimum van 3 → staven 30, 29, 28, elk alleen het uiterste",
    p.beams.map((b) => [b.beamId, b.diagrams[0].labels.map((l) => [l.kind, l.sample])]),
    [[28, [["extreme", 5]]], [29, [["extreme", 5]]], [30, [["extreme", 5]]]]);
  const honderd = Array.from({ length: 100 }, (_, i) => ({
    beamId: i + 1, index: i, diagrams: { momentY: lijn(11, (t) => ((i * 37) % 100 + 1) * (4 * t * (1 - t) - 0.25)) }, mid: {},
  }));
  const p100 = plan(honderd, 100, aan(2));
  const grootste = [...honderd].sort((a, b) => ((b.beamId - 1) * 37 % 100) - ((a.beamId - 1) * 37 % 100)).slice(0, 10).map((b) => b.beamId).sort((a, b) => a - b);
  gelijk("100 staven: tien staven, de grootste tien", p100.beams.map((b) => b.beamId).sort((a, b) => a - b), grootste);
  check("… elk één label", p100.beams.every((b) => b.diagrams.length === 1 && b.diagrams[0].labels.length === 1 && b.diagrams[0].labels[0].kind === "extreme"));
  // Groot model: nooit meer dan stand 3 (daar komt de begrenzing vandaan).
  const groot = staven(1000, 12, { dicht: true });
  check("1000 staven: per lijn niet meer waarden dan stand 3", DIAGRAMMEN.every((c) =>
    lijnLabels(plan(groot, 1000, aan(2)), c) <= lijnLabels(plan(groot, 1000, aan(3)), c)
    && lijnLabels(plan(groot, 1000, aan(2)), c) >= 3));
}

// ── [6] Stand 4 ────────────────────────────────────────────────────────────
log("\n[6] stand 4: alle staven, labels per staaf als stand 3");
{
  const beams = staven(100, 13, { dicht: true });
  gelijk("gelijk aan de oude regel met indeling 1 (alle staven)", plan(beams, 100, aan(4)).beams, oudeRegel(beams, 24, []));
  gelijk("voorbeeld: 30 staven × 3 labels", lijnLabels(plan(voorbeeld, 30, aan(4)), "momentY"), 90);
}

// ── [7] Stand 5 ────────────────────────────────────────────────────────────
log("\n[7] stand 5: begin, eind, uiterste en kwartpunten");
{
  const p = plan(voorbeeld.slice(0, 1), 1, aan(5));
  // Kwartpunt 0,25 ligt tussen de punten t = 0,2 (0,39) en 0,3 (0,59): lineair 0,49.
  gelijk("staaf 1: begin, eind, uiterste (midden) en de kwartpunten 0,25 en 0,75 (0,5 = het uiterste)",
    p.beams[0].diagrams[0].labels.map((l) => [l.kind, l.sample ?? null, l.t ?? null, Number(l.value.toFixed(6))]),
    [["start", 2, null, -0.25], ["end", 8, null, -0.25], ["peak", 5, null, 0.75],
      ["quarter", null, 0.25, 0.49], ["quarter", null, 0.75, 0.49]]);
  gelijk("voorbeeld: 30 staven × 5 labels", lijnLabels(plan(voorbeeld, 30, aan(5)), "momentY"), 150);
  // Kwartpunt tussen twee punten in: lineair geïnterpoleerd.
  const twee = [{ beamId: 1, index: 0, diagrams: { shearZ: [{ t: 0, value: -8 }, { t: 1, value: 12 }] }, mid: {} }];
  const q = plan(twee, 1, aan(5)).beams[0].diagrams[0].labels.filter((l) => l.kind === "quarter");
  gelijk("twee punten (begin/eind): kwartpunten -3, 2, 7", q.map((l) => [l.t, l.value]), [[0.25, -3], [0.5, 2], [0.75, 7]]);
  gelijk("interpolatie", [L.openFem3DDiagramValueAt([{ t: 0, value: 0 }, { t: 0.5, value: 10 }, { t: 1, value: 0 }], 0.25),
    L.openFem3DDiagramValueAt([{ t: 0, value: 1 }], 0.7)], [5, 1]);
  // Uiterste vlak naast het eind (index 1): in stand 5 toch als uiterste getoond.
  const vlak = [{ beamId: 1, index: 0, diagrams: { momentZ: lijn(11, (t) => (t === 0.1 ? 9 : 1)) }, mid: {} }];
  check("uiterste op index 1: stand 4 niet, stand 5 wel",
    !plan(vlak, 1, aan(4)).beams[0].diagrams[0].labels.some((l) => l.kind === "peak")
    && plan(vlak, 1, aan(5)).beams[0].diagrams[0].labels.some((l) => l.kind === "peak" && l.sample === 1 && l.value === 9));
  gelijk("N en T: stand 5 als stand 4 (één waarde per staaf)", plan(staven(40, 14, { dicht: true }), 40, aan(5)).beams.map((b) => b.mid),
    plan(staven(40, 14, { dicht: true }), 40, aan(4)).beams.map((b) => b.mid));
}

// ── [8] Monotoon ───────────────────────────────────────────────────────────
log("\n[8] het aantal waarden neemt monotoon toe met de stand");
{
  const voorbeeldTelling = [1, 2, 3, 4, 5].map((s) => lijnLabels(plan(voorbeeld, 30, aan(s)), "momentY"));
  gelijk("voorbeeld (30 staven): 1 < 3 < 45 < 90 < 150", voorbeeldTelling, [1, 3, 45, 90, 150]);
  const metSelectie = [1, 2, 3, 4, 5].map((s) => lijnLabels(plan(voorbeeld, 30, aan(s), [2]), "momentY"));
  gelijk("… met staaf 2 geselecteerd (niet ingedeeld): 4 < 6 < 48 < 90 < 150", metSelectie, [4, 6, 48, 90, 150]);
  let gevallen = 0;
  const fouten = [];
  for (let zaad = 1; zaad <= 400; zaad += 1) {
    const r = toeval(zaad * 7919);
    const aantal = 1 + Math.floor(r() * (zaad % 5 === 0 ? 1200 : 120));
    const beams = staven(aantal, zaad, { dicht: zaad % 3 === 0 });
    const sel = beams.filter(() => r() < (zaad % 4 === 0 ? 0.3 : 0.02)).map((b) => b.beamId);
    const tellingen = [1, 2, 3, 4, 5].map((s) => plan(beams, aantal, aan(s), sel));
    gevallen += 1;
    for (let s = 0; s < 4; s += 1) {
      for (const c of DIAGRAMMEN) {
        if (lijnLabels(tellingen[s], c) > lijnLabels(tellingen[s + 1], c)) fouten.push(`zaad ${zaad}, ${c}: stand ${s + 1} > ${s + 2}`);
      }
      for (const m of MIDDEN) {
        if (middenDelen(tellingen[s], m) > middenDelen(tellingen[s + 1], m)) fouten.push(`zaad ${zaad}, ${m}: stand ${s + 1} > ${s + 2}`);
      }
      if (telling(tellingen[s]) > telling(tellingen[s + 1])) fouten.push(`zaad ${zaad}: totaal stand ${s + 1} > ${s + 2}`);
      // Ook de labels op het tekenvlak: elk lijnlabel, en per staaf één middenlabel (N en T samen).
      if (elementen(tellingen[s]) > elementen(tellingen[s + 1])) fouten.push(`zaad ${zaad}: labels stand ${s + 1} > ${s + 2}`);
      if (middenLabels(tellingen[s]) > middenLabels(tellingen[s + 1])) fouten.push(`zaad ${zaad}: middenlabels stand ${s + 1} > ${s + 2}`);
    }
    if (tellingen.some((p) => p.count !== telling(p))) fouten.push(`zaad ${zaad}: count klopt niet`);
    if (tellingen.some((p) => p.elements !== elementen(p))) fouten.push(`zaad ${zaad}: elements klopt niet`);
  }
  check(`${gevallen} modellen (1 … 1200 staven, dicht en schaars, met en zonder selectie): per lijn, waarden en labels monotoon`,
    fouten.length === 0, fouten.slice(0, 5).join("; "));
  // N en T samen op veel staven: stand 2 kiest de staven voor N en T samen,
  // zodat er niet meer middenlabels komen dan in stand 3 (eerder 32 tegen 16).
  for (const [aantal, zaad] of [[100, 21], [340, 22], [1189, 23]]) {
    const beams = staven(aantal, zaad, { dicht: true, componenten: [] });
    const p = [1, 2, 3, 4, 5].map((s) => plan(beams, aantal, aan(s)));
    const labels = p.map(elementen);
    check(`alleen N en T, ${aantal} staven: middenlabels per stand ${labels.join(", ")} monotoon, stand 2 ≤ stand 3`,
      labels.every((n, i) => i === 0 || labels[i - 1] <= n) && labels[1] <= labels[2] && labels[0] >= 1 && labels[0] <= 2 && labels[3] === aantal);
    check(`… waarden ${p.map((x) => x.count).join(", ")} monotoon`, p.every((x, i) => i === 0 || p[i - 1].count <= x.count));
  }
  {
    // Alleen My bij 1189 staven: stand 2 nooit op meer staven dan stand 3.
    const beams = staven(1189, 24, { dicht: true, componenten: ["momentY"], midden: [] });
    const [twee, drie] = [2, 3].map((s) => plan(beams, 1189, aan(s)));
    check(`alleen My, 1189 staven: stand 2 op ${twee.beams.length} staven met ${twee.elements} labels, stand 3 op ${drie.beams.length} met ${drie.elements}`,
      twee.beams.length <= drie.beams.length && twee.elements <= drie.elements);
  }
  // Randgeval: geen enkele ingedeelde staaf heeft een My, een andere wel. Stand
  // 3 toont dan de maatgevende waarde (anders zou stand 3 minder tonen dan 1).
  const rand = Array.from({ length: 40 }, (_, i) => ({
    beamId: i + 1, index: i, diagrams: { momentY: i === 5 ? lijn(5, (t) => 3 * t) : lijn(5, () => 0) }, mid: {},
  }));
  gelijk("geen My op de ingedeelde staven: stand 1 … 5 = 1, 1, 1, 2, 5",
    [1, 2, 3, 4, 5].map((s) => lijnLabels(plan(rand, 40, aan(s)), "momentY")), [1, 1, 1, 2, 5]);
  gelijk("… stand 3 toont het uiterste van staaf 6", plan(rand, 40, aan(3)).beams.map((b) => [b.beamId, b.diagrams[0].labels.map((l) => l.kind)]),
    [[6, ["extreme"]]]);
}

// ── [9] Selectie en Waarden uit ────────────────────────────────────────────
log("\n[9] geselecteerde staven altijd; Waarden uit: niets");
{
  for (const s of [1, 2, 3, 4, 5]) {
    const p = plan(voorbeeld, 30, aan(s), [2]);
    const staaf2 = p.beams.find((b) => b.beamId === 2);
    check(`stand ${s}: geselecteerde staaf 2 heeft zijn waarden (begin, eind, uiterste)`,
      Boolean(staaf2) && ["start", "end", "peak"].every((k) => staaf2.diagrams[0].labels.some((l) => l.kind === k)));
  }
  // De maatgevende staaf geselecteerd, met zijn uiterste vlak naast het begin
  // (punt 1 van 21): de volledige set van stand 3/4 slaat zo'n uiterste over,
  // maar de maatgevende waarde mag door selecteren niet verdwijnen.
  const lijn21 = (f) => Array.from({ length: 21 }, (_, i) => ({ t: i / 20, value: f(i / 20, i) }));
  const randPiek = [
    { beamId: 1, index: 0, diagrams: { momentY: lijn21((t, i) => (i === 1 ? 50 : 20 * (1 - t))) }, mid: {} },
    { beamId: 2, index: 1, diagrams: { momentY: lijn21((t) => 30 * t) }, mid: {} },
    { beamId: 3, index: 2, diagrams: { momentY: lijn21(() => 10) }, mid: {} },
  ];
  const vorm = (p) => p.beams.map((b) => [b.beamId, ...b.diagrams[0].labels.map((l) => `${l.kind}:${l.value}`)]);
  gelijk("maatgevend uiterste naast het begin, stand 1 zonder selectie: alleen dat uiterste",
    vorm(plan(randPiek, 3, aan(1))), [[1, "extreme:50"]]);
  gelijk("… met die staaf geselecteerd: begin, eind én het uiterste 50",
    vorm(plan(randPiek, 3, aan(1), [1])), [[1, "start:20", "end:0", "extreme:50"]]);
  for (const s of [2, 3, 4, 5]) {
    const staaf1 = plan(randPiek, 3, aan(s), [1]).beams.find((b) => b.beamId === 1);
    check(`… stand ${s}: de 50 blijft in beeld`, staaf1.diagrams[0].labels.some((l) => l.value === 50 && l.sample === 1));
  }
  const multi = L.openFem3DDiagramLabelSelection({ type: "multi", nodeIds: [], beamIds: [3, 7] });
  check("meervoudige selectie: beide staven in stand 1", [3, 7].every((id) => plan(voorbeeld, 30, aan(1), multi).beams.some((b) => b.beamId === id)));
  const midden = Array.from({ length: 30 }, (_, i) => ({ beamId: i + 1, index: i, diagrams: {}, mid: { axialForce: i, torsion: 2 * i } }));
  gelijk("N en T in stand 1 met staaf 4 geselecteerd: staaf 4 (N en T) en staaf 30 (N en T)",
    plan(midden, 30, aan(1), [4]).beams.map((b) => [b.beamId, b.mid.map((m) => m.component)]),
    [[4, ["axialForce", "torsion"]], [30, ["axialForce", "torsion"]]]);
  for (const s of [1, 3, 5]) {
    const p = plan([...voorbeeld, ...midden.map((b) => ({ ...b, beamId: b.beamId + 100, index: b.index + 30 }))], 60, { show: false, stand: s }, [2, 104]);
    check(`Waarden uit (stand ${s}, met selectie): geen enkel getal`, p.beams.length === 0 && p.count === 0);
  }
}

// ── [10] Views ─────────────────────────────────────────────────────────────
log("\n[10] views");
{
  const huidig = {
    view: "iso", camera: { position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1] },
    visibility: { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, momentY: true }, combinationId: null, loadCaseId: 1, mode: "results",
  };
  const zonder = V.bewaarOpenFem3DViewSet([], "Oud", huidig);
  check("opslaan zonder instelling: geen veld (zoals oude views)", !("diagramLabels" in zonder[0]));
  const met = V.bewaarOpenFem3DViewSet([], "Nieuw", { ...huidig, diagramLabels: { show: true, stand: 5 } });
  gelijk("opslaan met instelling: bewaard", met[0].diagramLabels, { show: true, stand: 5 });
  const bijgewerkt = V.bewaarOpenFem3DViewSet(met, "nieuw", { ...huidig, diagramLabels: { show: false, stand: 1 } });
  gelijk("bijwerken onder dezelfde naam: nieuwe instelling", bijgewerkt[0].diagramLabels, { show: false, stand: 1 });
  const ruw = JSON.parse(json(met[0]));
  gelijk("inlezen: geldig veld blijft", V.parseOpenFem3DViewSets([ruw])[0].diagramLabels, { show: true, stand: 5 });
  gelijk("inlezen: ongeldig veld genormaliseerd", V.parseOpenFem3DViewSets([{ ...ruw, diagramLabels: { show: 1, stand: 7.6 } }])[0].diagramLabels, { show: true, stand: 5 });
  const oud = { ...ruw };
  delete oud.diagramLabels;
  check("inlezen: oude view zonder veld blijft zonder veld", !("diagramLabels" in V.parseOpenFem3DViewSets([oud])[0]));
  gelijk("toepassen: oude view → de standaard (aan, stand 3)", S.openFem3DViewSetToepassing(V.parseOpenFem3DViewSets([oud])[0]).diagramLabels, { show: true, stand: 3 });
  gelijk("toepassen: eigen view → zijn instelling", S.openFem3DViewSetToepassing(bijgewerkt[0]).diagramLabels, { show: false, stand: 1 });
  check("standaardview: laat de instelling van de gebruiker staan", S.openFem3DStandaardViewToepassing("vz", {
    visibility: DEFAULT_OPEN_FEM_3D_VISIBILITY, activeCombinationId: null, maatgevendeCombinationId: null, activeLoadCaseId: 1,
  }).diagramLabels === undefined);
}

// ── [11] Bedrading en teksten ──────────────────────────────────────────────
log("\n[11] bedrading");
const lees = (...pad) => readFileSync(join(HIER, ...pad), "utf8").replace(/\r\n/g, "\n");
const canvas = lees("src", "components", "openFem3d", "ThreeFrameCanvas.tsx");
check("tekenvlak: de labels uit het plan, in een eigen laag",
  /planOpenFem3DDiagramLabels\(/.test(canvas) && /function buildDiagramLabelLayer/.test(canvas));
check("… de lijnen tekenen zelf geen getallen meer", !/showLabels/.test(canvas));
check("… de laag volgt instelling en selectie", /\[model, conditionModel, visibility, structuralGrid, result, utilizations, activeLoadCaseId, loadCaseTypes, diagramLabels, selection\]/.test(canvas));
check("… een groot plan wordt vóór elke labelindeling uitgedund (alleen wat in beeld past wordt een element)",
  /function thinDiagramLabelLayer/.test(canvas) && /state\.beforeLabels\?\.\(state, container\)/.test(canvas)
  && /state\.beforeLabels = \(scene, container\) => thinDiagramLabelLayer\(scene, container, thinned\)/.test(canvas));
const verkenner = lees("src", "components", "openFem3d", "OpenFem3DExplorer.tsx");
check("verkenner: het sub-blok onder de eerste aangevinkte lijn",
  /openFem3DFirstActiveForceLayer\(props\.visibility\)/.test(verkenner) && /<DiagramLabelControls/.test(verkenner)
  && /data-open-fem3d-diagram-label-controls/.test(verkenner) && /type="range"[\s\S]{0,200}min=\{OPEN_FEM_3D_DIAGRAM_LABEL_STANDS\[0\]\}/.test(verkenner));
// De markering van het sub-blok heeft een eigen naam: data-open-fem3d-diagram-labels
// is de teller van het tekenvlak, en beide staan in de app tegelijk in de DOM.
check("… met een eigen markering, niet de teller van het tekenvlak", !/data-open-fem3d-diagram-labels\b/.test(verkenner));
const editor = lees("src", "components", "openFem3d", "OpenFem3DEditor.tsx");
check("editor: naar het tekenvlak en mee in een view uit het venster Views",
  /diagramLabels=\{diagramLabels\}/.test(editor) && /currentDiagramLabels=\{diagramLabels\}/.test(editor));
const dialoog = lees("src", "components", "openFem3d", "OpenFem3DVisibilityDialog.tsx");
check("venster Views: slaat de instelling mee op", /diagramLabels: currentDiagramLabels/.test(dialoog));
const app = lees("src", "App.tsx");
check("App: voorkeur gelezen en bewaard, mee in views",
  /useState\(readOpenFem3DDiagramLabels\)/.test(app) && /saveOpenFem3DDiagramLabels\(openFem3dDiagramLabels\)/.test(app)
  && /diagramLabels: openFem3dDiagramLabels/.test(app) && /if \(w\.diagramLabels\) setOpenFem3dDiagramLabels/.test(app));
// Per plek: in welk JSX-element staat de prop (de laatste opening `<Naam` ervoor)?
// Eén losse regex vond ook één van de twee als de andere wegviel.
const omhullend = (tekst, index) => [...tekst.slice(0, index).matchAll(/<([A-Z][\w.]*)/g)].at(-1)?.[1];
gelijk("App: de instelling naar de editor (het tekenvlak) en naar de verkenner, elk één keer",
  [...app.matchAll(/diagramLabels=\{openFem3dDiagramLabels\}/g)].map((m) => omhullend(app, m.index)).sort(),
  ["OpenFem3DEditor", "OpenFem3DExplorer"]);
gelijk("App: de regelaar in de verkenner zet de instelling",
  [...app.matchAll(/setDiagramLabels=\{setOpenFem3dDiagramLabels\}/g)].map((m) => omhullend(app, m.index)), ["OpenFem3DExplorer"]);
gelijk("editor: de instelling naar het tekenvlak",
  [...editor.matchAll(/diagramLabels=\{diagramLabels\}/g)].map((m) => omhullend(editor, m.index)), ["ThreeFrameCanvas"]);
for (const taal of ["nl", "en", "de", "fr"]) {
  const teksten = JSON.parse(readFileSync(join(HIER, "src", "i18n", "locales", taal, "common.json"), "utf8")).openFem3dDiagramLabels ?? {};
  check(`teksten ${taal}`, ["values", "valuesAria", "valuesHint", "few", "many", "density", "densityHint", "densityValue"]
    .every((k) => typeof teksten[k] === "string" && teksten[k].length > 0));
}
{
  const nl = JSON.parse(lees("src", "i18n", "locales", "nl", "common.json")).openFem3dDiagramLabels ?? {};
  gelijk("nl: Waarden, Weinig, Veel", [nl.values, nl.few, nl.many], ["Waarden", "Weinig", "Veel"]);
}

// ── [12] De botsingsregel ──────────────────────────────────────────────────
log("\n[12] de botsingsregel (openFem3dLabelLayout.ts)");
{
  const B = await import("./src/components/openFem3d/openFem3dLabelLayout.ts");
  const beeld = { left: 0, top: 0, right: 1000, bottom: 700 };
  const rh = (left, top, breed = 80, hoog = 19) => ({ left, top, right: left + breed, bottom: top + hoog });
  const plaats = (kandidaten, gereserveerd = []) => B.placeOpenFem3DLabels(kandidaten, gereserveerd, beeld)
    .map((p) => (p.shown ? (p.shift ? `ja ${p.shift}` : "ja") : "nee"));
  gelijk("zelfde prioriteit: de eerste wint, los ernaast blijft",
    plaats([{ rect: rh(100, 100), priority: 2 }, { rect: rh(150, 105), priority: 2 }, { rect: rh(300, 100), priority: 2 }]), ["ja", "nee", "ja"]);
  gelijk("lagere prioriteit wint, ook als hij later komt",
    plaats([{ rect: rh(100, 100), priority: 2 }, { rect: rh(150, 105), priority: 1 }]), ["nee", "ja"]);
  gelijk("2 px marge: 1 px ertussen botst, 3 px niet",
    plaats([{ rect: rh(100, 100), priority: 2 }, { rect: rh(181, 100), priority: 2 }, { rect: rh(263, 100), priority: 2 }]), ["ja", "nee", "ja"]);
  gelijk("gereserveerd gebied (bediening) en geheel buiten beeld: verborgen; half in beeld: getoond",
    plaats([{ rect: rh(900, 10), priority: 0 }, { rect: rh(1001, 10), priority: 0 }, { rect: rh(960, 300), priority: 0 }],
      [{ left: 880, top: 0, right: 1000, bottom: 120 }]), ["nee", "nee", "ja"]);
  // Kwartpuntlabel (stand 5) vlak naast het beginlabel: een regel omlaag, of
  // omhoog als ook daar iets staat; zonder uitwijkplaatsen verborgen.
  const begin = { rect: rh(100, 100), priority: 2 };
  gelijk("uitwijken: omlaag", plaats([begin, { rect: rh(140, 104), priority: 2, shifts: [22, -22] }]), ["ja", "ja 22"]);
  gelijk("uitwijken: omlaag bezet, dan omhoog",
    plaats([begin, { rect: rh(140, 122), priority: 2 }, { rect: rh(140, 100), priority: 2, shifts: [22, -22] }]), ["ja", "ja", "ja -22"]);
  gelijk("geen uitwijkplaatsen: verborgen", plaats([begin, { rect: rh(140, 104), priority: 2 }]), ["ja", "nee"]);
  gelijk("uitwijken niet naar buiten het beeld",
    plaats([{ rect: rh(100, 681), priority: 2 }, { rect: rh(140, 681), priority: 2, shifts: [22] }]), ["ja", "nee"]);
  // Het zoekrooster verandert de uitkomst niet: vergelijk met de rechttoe-rechtaan regel.
  const r = toeval(77);
  const veel = Array.from({ length: 1500 }, () => ({
    rect: rh(r() * 1100 - 50, r() * 800 - 50, 30 + r() * 90, 12 + r() * 10),
    priority: Math.floor(r() * 4), shifts: r() < 0.2 ? [22, -22] : undefined,
  }));
  const gereserveerd = [{ left: 860, top: 0, right: 1000, bottom: 140 }];
  const naief = (() => {
    const geplaatst = [];
    const uit = veel.map(() => ({ shown: false, shift: 0 }));
    const volgorde = veel.map((_, i) => i).sort((a, b) => veel[a].priority - veel[b].priority || a - b);
    const buiten = (q) => q.right <= 0 || q.left >= 1000 || q.bottom <= 0 || q.top >= 700;
    const vrij = (q) => ![...gereserveerd, ...geplaatst].some((o) => B.openFem3DLabelsOverlap(q, o));
    for (const i of volgorde) {
      if (buiten(veel[i].rect)) continue; // geheel buiten beeld: niet uitwijken
      for (const dy of [0, ...(veel[i].shifts ?? [])]) {
        const q = { ...veel[i].rect, top: veel[i].rect.top + dy, bottom: veel[i].rect.bottom + dy };
        if (buiten(q) || !vrij(q)) continue;
        geplaatst.push(q);
        uit[i] = { shown: true, shift: dy };
        break;
      }
    }
    return uit;
  })();
  gelijk("1500 labels: met zoekrooster gelijk aan de rechttoe-rechtaan regel", B.placeOpenFem3DLabels(veel, gereserveerd, beeld), naief);
}

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

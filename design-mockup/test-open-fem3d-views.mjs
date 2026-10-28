// De tab Views van de 3D-verkenner, de pure kant:
//   - de zes standaardviews (Geometrie, Belastingen, Combinaties, Vz, Reacties,
//     Spanningen): hun lagen, tab en camera, wanneer ze beschikbaar zijn, de
//     maatgevende combinatie en de markering "actief";
//   - de eigen views: opslaan (ook onder een bestaande naam), hernoemen,
//     verwijderen en de rapportkeuze — dezelfde functies als het venster Views;
//   - wat er in het project komt (projectbestand) en wat er in het rapport komt;
//   - het rapportbeeld: projectie per aanzicht en camera, en de lagen (lasten,
//     vervorming, Vz-lijn, reacties, unity checks, profielkleuren);
//   - de aansluiting in de bron (App, verkenner, venster) en de teksten.
// Het gedrag in de browser bewaakt test-open-fem3d-views-ui.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const S = await import("./src/components/openFem3d/openFem3dStandaardViews.ts");
const V = await import("./src/components/openFem3d/openFem3dViewSets.ts");
const B = await import("./src/components/openFem3d/openFem3dRapportBeeld.ts");
const { DEFAULT_OPEN_FEM_3D_VISIBILITY } = await import("./src/components/openFem3d/openFem3dVisibility.ts");
const { parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { serializeProject, deserializeProject, onbekendeTopVelden } = await import("./src/io/projectFile.ts");
const { PROFIEL_PALET_3D } = await import("./src/lib/profielKleur.ts");

let passed = 0, failed = 0;
function test(naam, fn) {
  try { fn(); passed++; console.log(`  ✓ ${naam}`); }
  catch (e) { failed++; console.log(`  ✗ ${naam}\n      ${e.message.split("\n").join("\n      ")}`); }
}
const bron = (pad) => readFileSync(new URL(pad, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const lees = (taal) => JSON.parse(readFileSync(new URL(`./src/i18n/locales/${taal}/common.json`, import.meta.url), "utf8"));
const bijna = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} ≠ ${b}`);

// ── Een klein portaal in het vlak y = 0: twee kolommen, een regel, een schoor ──
const model = parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 4 }, { id: 3, x: 6, y: 0, z: 4 }, { id: 4, x: 6, y: 0, z: 0 }],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA 300", material: "S235" },
    { id: 2, startNodeId: 2, endNodeId: 3, profileName: "IPE 400", material: "S235" },
    { id: 3, startNodeId: 4, endNodeId: 3, profileName: "HEA 300", material: "S235" },
  ],
  supports: [
    { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
    { nodeId: 4, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
  ],
  loads: [{ id: 1, nodeId: 2, caseId: 1, fx: 5, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
  memberLoads: [{ id: 1, beamId: 2, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -10, qzEnd: -10, startPositionM: 0, endPositionM: 6 }],
  memberPointLoads: [], thermalLoads: [], plates: [], surfaceLoads: [],
});
/** Een nagebootst resultaat: zakking van de regel, Vz lineair, reacties omhoog. */
function resultaat(schaal = 1) {
  const leeg = { rx: 0, ry: 0, rz: 0 };
  return {
    schemaVersion: 1, engine: { id: "proef", name: "Proef", revision: "0", license: "-" }, analysis: "linear",
    displacements: [
      { nodeId: 1, ux: 0, uy: 0, uz: 0, ...leeg }, { nodeId: 2, ux: 0.002 * schaal, uy: 0, uz: -0.001 * schaal, ...leeg },
      { nodeId: 3, ux: 0.002 * schaal, uy: 0, uz: -0.001 * schaal, ...leeg }, { nodeId: 4, ux: 0, uy: 0, uz: 0, ...leeg },
    ],
    reactions: [
      { nodeId: 1, fx: -2.5, fy: 0, fz: 30, mx: 0, my: 4, mz: 0 },
      { nodeId: 4, fx: -2.5, fy: 0, fz: 30, mx: 0, my: -4, mz: 0 },
    ],
    memberForces: [1, 2, 3].map((memberId) => ({
      memberId, lengthM: memberId === 2 ? 6 : 4, nStartKn: -30, nEndKn: -30, vyStartKn: 0, vyEndKn: 0,
      vzStartKn: memberId === 2 ? 30 : 2.5, vzEndKn: memberId === 2 ? -30 : 2.5,
      torsionStartKnm: 0, torsionEndKnm: 0, myStartKnm: 0, myEndKnm: 0, mzStartKnm: 0, mzEndKnm: 0,
    })),
    buckling: { status: "unavailable", reason: "-" }, diagnostics: [],
  };
}
const utilizations = [
  { beamId: 1, uc: 0.3, status: "Ok", standard: "EN 1993" },
  { beamId: 2, uc: 1.2, status: "NotOk", standard: "EN 1993" },
];

console.log("[1] de standaardviews");
test("zes vaste views in deze volgorde, met hun tab", () => {
  assert.deepEqual(S.OPEN_FEM_3D_STANDAARD_VIEWS.map((v) => [v.id, v.mode, v.resultaat]), [
    ["geometrie", "model", false], ["belastingen", "loadCase", false], ["combinaties", "results", true],
    ["vz", "results", true], ["reacties", "results", true], ["spanningen", "results", true],
  ]);
  assert.deepEqual(S.OPEN_FEM_3D_STANDAARD_VIEW_IDS, S.OPEN_FEM_3D_STANDAARD_VIEWS.map((v) => v.id));
});
test("elke view zet de inhoudslagen vast: precies zijn eigen resultaatlaag, lasten alleen bij Belastingen", () => {
  const RESULT = ["deformation", "reactions", "utilization", "axialForce", "shearY", "shearZ", "torsion", "momentY", "momentZ"];
  const eigen = { geometrie: [], belastingen: [], combinaties: ["deformation"], vz: ["shearZ"], reacties: ["reactions"], spanningen: ["utilization"] };
  for (const v of S.OPEN_FEM_3D_STANDAARD_VIEWS) {
    assert.deepEqual(RESULT.filter((k) => v.lagen[k]), eigen[v.id], v.id);
    assert.equal(v.lagen.loads, v.id === "belastingen", `${v.id}: lasten`);
    assert.equal(v.lagen.beams && v.lagen.supports, true, `${v.id}: staven en opleggingen`);
    assert.equal(v.lagen.profiles, v.id === "geometrie", `${v.id}: profielen als volume alleen bij Geometrie`);
    // Labels, raster, assen en profielkleuren zet een standaardview niet.
    for (const k of ["nodeNumbers", "beamNumbers", "grid", "axes", "structuralGrid", "profileColors", "nodes"]) assert.equal(k in v.lagen, false, `${v.id}: ${k}`);
  }
});
test("beschikbaar: geometrie en belastingen altijd; resultaatviews pas na Berekenen, met reden", () => {
  const niet = { heeftResultaat: false, heeftCombinaties: false, heeftToetsing: false };
  assert.deepEqual(S.OPEN_FEM_3D_STANDAARD_VIEW_IDS.map((id) => S.openFem3DStandaardViewReden(id, niet)), [
    null, null, "openFem3dViews.redenNietGerekend", "openFem3dViews.redenNietGerekend", "openFem3dViews.redenNietGerekend", "openFem3dViews.redenNietGerekend",
  ]);
  const alleenGevallen = { heeftResultaat: true, heeftCombinaties: false, heeftToetsing: false };
  assert.equal(S.openFem3DStandaardViewReden("combinaties", alleenGevallen), "openFem3dViews.redenGeenCombinaties");
  assert.equal(S.openFem3DStandaardViewReden("vz", alleenGevallen), null);
  assert.equal(S.openFem3DStandaardViewReden("spanningen", alleenGevallen), "openFem3dViews.redenGeenToetsing");
  const alles = { heeftResultaat: true, heeftCombinaties: true, heeftToetsing: true };
  for (const id of S.OPEN_FEM_3D_STANDAARD_VIEW_IDS) assert.equal(S.openFem3DStandaardViewReden(id, alles), null, id);
});
test("toepassen: iso met passend beeld, de rest van de zichtbaarheid blijft, Combinaties = actief anders maatgevend", () => {
  const zicht = { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, nodeNumbers: false, profileColors: true, momentY: true, loads: true };
  const geo = S.openFem3DStandaardViewToepassing("geometrie", { visibility: zicht, activeCombinationId: 7, maatgevendeCombinationId: 9, activeLoadCaseId: 2 });
  assert.deepEqual([geo.sleutel, geo.view, geo.camera, geo.mode, geo.combinationId, geo.loadCaseId], ["standaard:geometrie", "iso", null, "model", null, 2]);
  assert.deepEqual([geo.visibility.nodeNumbers, geo.visibility.profileColors, geo.visibility.momentY, geo.visibility.loads, geo.visibility.profiles],
    [false, true, false, false, true]);
  assert.equal(S.openFem3DStandaardViewToepassing("combinaties", { visibility: zicht, activeCombinationId: null, maatgevendeCombinationId: 9, activeLoadCaseId: 1 }).combinationId, 9);
  assert.equal(S.openFem3DStandaardViewToepassing("combinaties", { visibility: zicht, activeCombinationId: 7, maatgevendeCombinationId: 9, activeLoadCaseId: 1 }).combinationId, 7);
  assert.equal(S.openFem3DStandaardViewToepassing("vz", { visibility: zicht, activeCombinationId: 7, maatgevendeCombinationId: 9, activeLoadCaseId: 1 }).combinationId, 7, "Vz: het getoonde resultaat");
  assert.equal(S.openFem3DStandaardViewToepassing("belastingen", { visibility: zicht, activeCombinationId: 7, maatgevendeCombinationId: 9, activeLoadCaseId: 1 }).combinationId, null);
});
test("maatgevende combinatie: de grootste verplaatsing; gelijk = de laagste id; zonder resultaten: geen", () => {
  const r = new Map([[4, resultaat(1)], [5, resultaat(3)], [6, resultaat(3)]]);
  assert.equal(S.openFem3DMaatgevendeCombinatie(model, [{ id: 4 }, { id: 6 }, { id: 5 }], r), 5);
  assert.equal(S.openFem3DMaatgevendeCombinatie(model, [{ id: 4 }], r), 4);
  assert.equal(S.openFem3DMaatgevendeCombinatie(model, [{ id: 8 }], r), null);
  assert.equal(S.openFem3DMaatgevendeCombinatie(model, [{ id: 4 }], undefined), null);
});
test("actief: als laatste toegepast én de lagen staan nog zo", () => {
  const w = S.openFem3DStandaardViewToepassing("vz", { visibility: DEFAULT_OPEN_FEM_3D_VISIBILITY, activeCombinationId: null, maatgevendeCombinationId: null, activeLoadCaseId: 1 });
  assert.equal(S.openFem3DViewActief("standaard:vz", "standaard:vz", w, w.visibility), true);
  assert.equal(S.openFem3DViewActief("standaard:vz", "standaard:reacties", w, w.visibility), false, "een andere view is actief");
  assert.equal(S.openFem3DViewActief("standaard:vz", "standaard:vz", w, { ...w.visibility, momentY: true }), false, "zelf een laag aangezet");
});

console.log("\n[2] eigen views: dezelfde functies als het venster Views");
const huidig = {
  view: "front", camera: { position: [3, -20, 2], target: [3, 0, 2], up: [0, 0, 1] },
  visibility: { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, momentY: true }, combinationId: 12, loadCaseId: 2, mode: "results",
};
test("opslaan: nieuwe id, alles van de huidige weergave; dezelfde naam (hoofdletters tellen niet) werkt bij", () => {
  const een = V.bewaarOpenFem3DViewSet([], "  Voorgevel ", huidig);
  assert.deepEqual(een, [{ id: "view-1", name: "Voorgevel", view: "front", camera: huidig.camera, visibility: huidig.visibility, combinationId: 12, loadCaseId: 2, mode: "results" }]);
  assert.notEqual(een[0].camera.position, huidig.camera.position, "een kopie, geen verwijzing");
  const twee = V.bewaarOpenFem3DViewSet(V.zetOpenFem3DViewSetInRapport(een, "view-1", false), "VOORGEVEL", { ...huidig, view: "top" });
  assert.equal(twee.length, 1);
  assert.deepEqual([twee[0].id, twee[0].name, twee[0].view, twee[0].inRapport], ["view-1", "VOORGEVEL", "top", false], "id en rapportkeuze blijven");
  const drie = V.bewaarOpenFem3DViewSet(twee, "Zijgevel", huidig);
  assert.deepEqual(drie.map((v) => v.id), ["view-1", "view-2"]);
  assert.deepEqual(V.bewaarOpenFem3DViewSet(drie, "   ", huidig), drie, "lege naam: niets");
});
test("hernoemen: geweigerd bij leeg of een bestaande naam; verwijderen; rapportkeuze standaard aan", () => {
  const lijst = V.bewaarOpenFem3DViewSet(V.bewaarOpenFem3DViewSet([], "A", huidig), "B", huidig);
  assert.equal(V.hernoemOpenFem3DViewSet(lijst, "view-1", " ").fout, "leeg");
  assert.equal(V.hernoemOpenFem3DViewSet(lijst, "view-1", "b").fout, "bestaat");
  const r = V.hernoemOpenFem3DViewSet(lijst, "view-1", "Portaal");
  assert.deepEqual([r.fout, r.viewSets.map((v) => v.name)], [null, ["Portaal", "B"]]);
  assert.equal(V.hernoemOpenFem3DViewSet(lijst, "view-1", "a").fout, null, "de eigen naam in andere hoofdletters mag");
  assert.deepEqual(V.verwijderOpenFem3DViewSet(lijst, "view-1").map((v) => v.name), ["B"]);
  assert.equal(V.openFem3DViewSetInRapport(lijst[0]), true, "ontbrekend = in het rapport");
  assert.equal(V.openFem3DViewSetInRapport(V.zetOpenFem3DViewSetInRapport(lijst, "view-1", false)[0]), false);
});
test("inlezen: inRapport blijft (waar en onwaar), ontbreekt blijft ontbreken, iets anders valt weg", () => {
  const basis = { id: "view-1", name: "A", view: "iso", camera: huidig.camera, visibility: DEFAULT_OPEN_FEM_3D_VISIBILITY, combinationId: null };
  assert.deepEqual(V.parseOpenFem3DViewSets([basis]), [basis]);
  assert.equal(V.parseOpenFem3DViewSets([{ ...basis, inRapport: false }])[0].inRapport, false);
  assert.equal(V.parseOpenFem3DViewSets([{ ...basis, inRapport: true }])[0].inRapport, true);
  assert.equal("inRapport" in V.parseOpenFem3DViewSets([{ ...basis, inRapport: "nee" }])[0], false);
});

console.log("\n[3] project en rapport");
test("standaardviews buiten het rapport: bekende ids, vaste volgorde, zonder dubbele; aan/uit zetten", () => {
  assert.deepEqual(S.parseOpenFem3DStandaardViewsUitRapport(["vz", "onbekend", "geometrie", "vz", 3]), ["geometrie", "vz"]);
  assert.deepEqual(S.parseOpenFem3DStandaardViewsUitRapport("vz"), []);
  assert.deepEqual(S.zetOpenFem3DStandaardViewInRapport(["vz"], "geometrie", false), ["geometrie", "vz"]);
  assert.deepEqual(S.zetOpenFem3DStandaardViewInRapport(["geometrie", "vz"], "vz", true), ["geometrie"]);
});
test("projectbestand: de keuze reist mee in 3D, niet in 2D, en is een bekend veld", () => {
  const basis = {
    nodes: [], beams: [], supports: [], plates: [], loads: [], loadCases: [{ id: 1, name: "G", type: "permanent" }],
    activeLoadCaseId: 1, selfWeightEnabled: false, nonlinearEnabled: false,
  };
  const drie = deserializeProject(serializeProject({ ...basis, modelDimension: "3d", model3d: model,
    openFem3dViewSets: V.zetOpenFem3DViewSetInRapport(V.bewaarOpenFem3DViewSet([], "Gevel", huidig), "view-1", false),
    openFem3dStandaardViewsUitRapport: ["reacties", "spanningen", "rommel"] }));
  assert.deepEqual(drie.openFem3dStandaardViewsUitRapport, ["reacties", "spanningen"]);
  assert.equal(drie.openFem3dViewSets[0].inRapport, false);
  const twee = JSON.parse(serializeProject({ ...basis, modelDimension: "2d", openFem3dStandaardViewsUitRapport: ["vz"] }));
  assert.equal("openFem3dStandaardViewsUitRapport" in twee, false);
  assert.deepEqual(onbekendeTopVelden({ format: "open-fem2d-studio-v2", version: 3, openFem3dStandaardViewsUitRapport: [] }), []);
  const oud = deserializeProject(serializeProject({ ...basis, modelDimension: "3d", model3d: model }));
  assert.equal(oud.openFem3dStandaardViewsUitRapport, undefined, "een ouder bestand: alle standaardviews erin");
});
test("rapportviews: standaard alle zes, dan de aangevinkte eigen views; resultaatviews met reden zolang er niet gerekend is", () => {
  const eigen = V.zetOpenFem3DViewSetInRapport(V.bewaarOpenFem3DViewSet(V.bewaarOpenFem3DViewSet([], "Gevel", huidig), "Uit", huidig), "view-2", false);
  const zonder = S.openFem3DRapportViews({ model, viewSets: eigen, standaardUitRapport: [], result: null, combinations: [],
    activeLoadCaseId: 1, activeCombinationId: null, heeftToetsing: false });
  assert.deepEqual(zonder.map((v) => [v.sleutel, v.reden]), [
    ["standaard:geometrie", null], ["standaard:belastingen", null],
    ["standaard:combinaties", "openFem3dViews.redenNietGerekend"], ["standaard:vz", "openFem3dViews.redenNietGerekend"],
    ["standaard:reacties", "openFem3dViews.redenNietGerekend"], ["standaard:spanningen", "openFem3dViews.redenNietGerekend"],
    ["view-1", null],
  ]);
  const r1 = resultaat(1), c1 = resultaat(2), c2 = resultaat(5);
  const met = S.openFem3DRapportViews({ model, viewSets: [], standaardUitRapport: ["geometrie", "spanningen"], result: r1,
    caseResults: new Map([[1, r1]]), combinationResults: new Map([[11, c1], [12, c2]]), combinations: [{ id: 11 }, { id: 12 }],
    activeLoadCaseId: 1, activeCombinationId: null, heeftToetsing: true });
  assert.deepEqual(met.map((v) => v.standaard), ["belastingen", "combinaties", "vz", "reacties"]);
  const comb = met.find((v) => v.standaard === "combinaties");
  assert.deepEqual([comb.combinationId, comb.resultaat === c2, comb.reden], [12, true, null], "de maatgevende combinatie");
  assert.equal(met.find((v) => v.standaard === "vz").resultaat, r1, "Vz: het getoonde resultaat");
  // Een eigen view in de tab Model: zonder lasten en resultaat, zoals in de app.
  const modelView = V.bewaarOpenFem3DViewSet([], "M", { ...huidig, mode: "model", visibility: { ...huidig.visibility, loads: true } });
  const [m] = S.openFem3DRapportViews({ model, viewSets: modelView, standaardUitRapport: S.OPEN_FEM_3D_STANDAARD_VIEW_IDS, result: r1,
    caseResults: new Map([[2, r1]]), combinationResults: new Map([[12, c2]]), combinations: [], activeLoadCaseId: 1, activeCombinationId: null, heeftToetsing: false });
  assert.deepEqual([m.naam, m.lagen.loads, m.resultaat, m.camera], ["M", false, null, huidig.camera]);
});

console.log("\n[4] het rapportbeeld");
const lagen = (extra) => ({ ...DEFAULT_OPEN_FEM_3D_VISIBILITY, nodes: false, supports: false, ...extra });
const beeld = (extra, over = {}) => B.openFem3DRapportBeeld({ model, lagen: lagen(extra), view: "front", camera: null, resultaat: null, utilizations: [], loadCaseId: 1, ...over });
test("kijkassen gelijk aan de werkruimte: voor, boven, zij, iso en een eigen camera", () => {
  const as = (v, c = null) => { const a = B.openFem3DKijkAssen(v, c); return [...a.rechts, ...a.boven].map((x) => Math.round(x * 1000) / 1000 + 0); };
  assert.deepEqual(as("front"), [1, 0, 0, 0, 0, 1]);
  assert.deepEqual(as("top"), [1, 0, 0, 0, 1, 0]);
  assert.deepEqual(as("side"), [0, 1, 0, 0, 0, 1]);
  const iso = B.openFem3DKijkAssen("iso", null);
  bijna(iso.rechts[2], 0, 1e-12, "iso: rechts horizontaal");
  assert.ok(iso.boven[2] > 0.8, "iso: Z omhoog");
  assert.deepEqual(as("iso", { position: [3, -20, 2], target: [3, 0, 2], up: [0, 0, 1] }), [1, 0, 0, 0, 0, 1], "een camera recht van voren = vooraanzicht");
});
test("vooraanzicht: kolommen verticaal, regel horizontaal, alles binnen het beeld", () => {
  const b = beeld({});
  const [k1, regel] = b.staven;
  bijna(k1.x1, k1.x2, 1e-9, "kolom verticaal");
  assert.ok(k1.y1 > k1.y2, "de kolom loopt omhoog op het scherm");
  bijna(regel.y1, regel.y2, 1e-9, "regel horizontaal");
  for (const s of b.staven) for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]]) assert.ok(x >= 0 && x <= b.breedte && y >= 0 && y <= b.hoogte, "binnen het beeld");
  assert.equal(b.staven[0].kleur, "#2563eb", "staal: de materiaalkleur van het rapport");
});
test("Belastingen: knooplast naar rechts, lijnlast als vijf pijlen naar beneden met een verbindingslijn", () => {
  const b = beeld({ loads: true });
  const knooppijl = b.lastpijlen.find((p) => p.label?.startsWith("Fx"));
  assert.ok(knooppijl && knooppijl.x2 > knooppijl.x1 && Math.abs(knooppijl.y2 - knooppijl.y1) < 1e-9, "Fx 5 kN naar rechts");
  assert.equal(knooppijl.label, "Fx 5 kN");
  const lijn = b.lastpijlen.filter((p) => !p.label);
  assert.equal(lijn.length, 5);
  for (const p of lijn) assert.ok(p.y2 > p.y1, "qz −10 kN/m: naar beneden");
  assert.equal(b.lijnlasten.length, 1);
  assert.ok(b.teksten.some((t) => t.tekst === "q 10 kN/m"));
  assert.equal(beeld({ loads: true }, { loadCaseId: 2 }).lastpijlen.length, 0, "een ander belastinggeval: geen pijlen");
});
test("Combinaties: de vervormde staven gestreept, met de vergroting; zonder resultaat niets", () => {
  const b = beeld({ deformation: true }, { resultaat: resultaat(1) });
  assert.equal(b.vervorming.length, 3);
  assert.ok(b.vergroting > 1);
  assert.equal(beeld({ deformation: true }).vervorming.length, 0);
});
test("Vz: een lijn per staaf in de kleur van de werkruimte, met de piekwaarde", () => {
  const b = beeld({ shearZ: true }, { resultaat: resultaat(1) });
  assert.equal(b.diagrammen.length, 3);
  assert.ok(b.diagrammen.every((d) => d.kleur === "#7c3aed"));
  assert.ok(b.teksten.some((t) => t.tekst === "Vz 30 kN" || t.tekst === "Vz -30 kN" || t.tekst === "Vz −30 kN"), JSON.stringify(b.teksten.map((t) => t.tekst)));
});
test("Reacties: groene pijlen omhoog naar de opleggingen, met de componenten", () => {
  const b = beeld({ reactions: true }, { resultaat: resultaat(1) });
  assert.equal(b.reacties.length, 2);
  for (const p of b.reacties) assert.ok(p.kleur === "#16a34a" && p.y2 < p.y1, "omhoog");
  assert.equal(b.reacties[0].label, "Rx -2,5 kN · Rz 30 kN · My 4 kNm".replace("-", "-"));
});
test("Spanningen: staven in de UC-kleur met de UC-waarde en een legenda; profielkleuren alleen zonder UC", () => {
  const b = beeld({ utilization: true }, { utilizations });
  assert.deepEqual(b.staven.map((s) => s.kleur), ["#16a34a", "#dc2626", "#2563eb"]);
  assert.ok(b.teksten.some((t) => t.tekst === "UC 1,2"));
  assert.equal(b.legenda.length, 4);
  const p = beeld({ profileColors: true });
  assert.deepEqual(p.staven.map((s) => s.kleur), [PROFIEL_PALET_3D[0][0], PROFIEL_PALET_3D[0][1], PROFIEL_PALET_3D[0][0]]);
  assert.deepEqual(p.legenda.map((l) => l.tekst), ["HEA 300", "IPE 400"]);
  assert.deepEqual(beeld({ profileColors: true, utilization: true }, { utilizations }).staven.map((s) => s.kleur), ["#16a34a", "#dc2626", "#2563eb"], "UC gaat voor");
});

test("pijlen en hun teksten vallen binnen het beeld (lasten en reacties, voor- en iso-aanzicht)", () => {
  for (const view of ["front", "iso"]) {
    for (const extra of [{ loads: true }, { reactions: true }, { shearZ: true }]) {
      const b = beeld({ ...extra, nodes: true }, { resultaat: resultaat(1), view });
      const binnen = (x, y, wat) => assert.ok(x >= -0.5 && x <= b.breedte + 0.5 && y >= -0.5 && y <= b.hoogte + 0.5, `${view} ${JSON.stringify(extra)}: ${wat} (${x.toFixed(1)}, ${y.toFixed(1)})`);
      for (const p of [...b.lastpijlen, ...b.reacties]) {
        binnen(p.x1, p.y1, "staart"); binnen(p.x2, p.y2, "kop");
        if (p.label) { binnen(p.x1 + 4 + p.label.length * 5.6, p.y1 - 4, `eind van "${p.label}"`); binnen(p.x1 + 4, p.y1 - 15, `boven "${p.label}"`); }
      }
      for (const t of b.teksten) { binnen(t.x, t.y, `"${t.tekst}"`); binnen(t.x + t.tekst.length * 5.6, t.y - 11, `eind van "${t.tekst}"`); }
    }
  }
});

console.log("\n[5] aansluiting in de bron");
test("het venster Views en de tab Views slaan op met dezelfde functie; de app past ze op één manier toe", () => {
  assert.match(bron("./src/components/openFem3d/OpenFem3DVisibilityDialog.tsx"), /bewaarOpenFem3DViewSet\(viewSets, trimmed,/);
  assert.match(bron("./src/components/openFem3d/OpenFem3DViewsTab.tsx"), /bewaarOpenFem3DViewSet\(viewSets, gekozen, props\.huidig\(\)\)/);
  const app = bron("./src/App.tsx");
  assert.match(app, /onApplyViewSet=\{\(viewSet\) => pasOpenFem3dViewToe\(openFem3DViewSetToepassing\(viewSet\)\)\}/);
  assert.match(app, /onToepassen: \(w\) => pasOpenFem3dViewToe\(w, true\)/);
  assert.match(app, /if \(!vanuitVerkenner\) setTreeTab/);
  assert.match(app, /openFem3dStandaardViewsUitRapport \} : \{\}\)/, "in het projectbestand");
  const verkenner = bron("./src/components/openFem3d/OpenFem3DExplorer.tsx");
  assert.match(verkenner, /\{props\.views && <button className=\{`fem-tree-tab/, "de vierde tab alleen met views (dus alleen in 3D)");
  assert.match(bron("./src/components/openFem3d/OpenFem3DReport.tsx"), /openFem3DRapportViews\(\{/);
});

console.log("\n[6] teksten in vier talen");
test("dezelfde sleutels voor de tab Views in nl, en, de en fr; elke titel en uitleg per standaardview", () => {
  const sleutels = (o, p = "") => Object.entries(o).flatMap(([k, v]) => typeof v === "object" ? sleutels(v, `${p}${k}.`) : [`${p}${k}`]).sort();
  const nl = sleutels(lees("nl").openFem3dViews);
  for (const taal of ["en", "de", "fr"]) assert.deepEqual(sleutels(lees(taal).openFem3dViews), nl, taal);
  for (const id of S.OPEN_FEM_3D_STANDAARD_VIEW_IDS) {
    assert.ok(nl.includes(`titel.${id}`) && nl.includes(`uitleg.${id}`), id);
  }
  for (const reden of ["redenNietGerekend", "redenGeenCombinaties", "redenGeenToetsing"]) assert.ok(nl.includes(reden), reden);
});

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

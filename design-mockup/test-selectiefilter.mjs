// Selectiefilter (issue #94): de zuivere functies achter het venster
// Selectiefilter en het commando model3d.selection.filter.
//
//   [1] de kern: richting (grenzen |ez| > 0,95 verticaal, < 0,05 horizontaal),
//       actieve criteria, de telling en de keuzelijsten;
//   [2] 3D: lege selectie = het hele model, elk criterium (type, profiel,
//       materiaal, groep, richting, level, lengte in mm, belastinggeval,
//       lastsoort), houden tegenover weghalen, combinaties (EN), een selectie
//       als basis, keuzelijsten alleen uit de basis;
//   [3] de 3D-selectie met lasten: opbouw uit id's, bevat, telling,
//       verwijderen, Ctrl-klik houdt de lasten vast;
//   [4] 2D: dezelfde kern op het 2D-model (mm, standaardprofiel, staaftype,
//       plaatmateriaal, de lastsoorten van 2D) en terug naar een 2D-selectie,
//       en de belastinggevallen van gekozen lasten;
//   [5] bedrading: Toepassen in App.tsx (2D en 3D) maakt het geval van de
//       gekozen lasten actief en zet de lasten in beeld; het label van het
//       transformatiepaneel telt alleen geometrie;
//   [6] teksten van het venster: enkelvoud en meervoud in vier talen.
//
// Uitvoeren: npx tsx test-selectiefilter.mjs   (vanuit design-mockup/)
const {
  filterRichting, filterCriteriumActief, filterElementen, filterTelling, filterKeuzes,
  FILTER_VERTICAAL, FILTER_HORIZONTAAL, keurFilterCriteria, filterLastGeval,
} = await import("./src/components/selectieFilter/selectieFilter.ts");
const {
  openFem3DSelectieIds, openFem3DFilterElementen, filterOpenFem3D, openFem3DSelectieBelastinggevallen,
} = await import("./src/components/openFem3d/openFem3dSelectieFilter.ts");
const {
  openFem3DSelectionFromIds, openFem3DSelectionContains, openFem3DSelectionCount, openFem3DSelectionGeometryCount,
  toggleOpenFem3DSelection,
} = await import("./src/components/openFem3d/openFem3dSelection.ts");
const { OPEN_FEM_3D_COLUMN_COSINE, removeOpenFem3DSelection } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { selectieIds2D, filterElementen2D, filterSelectie2D, selectieUitIds2D, lastSoort2D, selectieBelastinggevallen2D } =
  await import("./src/components/fem/selectieFilter2d.ts");
const { readFileSync } = await import("node:fs");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const lijst = (ids) => [...(ids ?? [])].join(",");
const gooit = (fn) => { try { fn(); return null; } catch (e) { return e; } };

// ── [1] De kern ────────────────────────────────────────────────────────────

console.log("[1] de kern");
check("verticaal hergebruikt de kolomregel van 3D (|ex·Z| > 0,95)", FILTER_VERTICAAL === OPEN_FEM_3D_COLUMN_COSINE && FILTER_VERTICAAL === 0.95);
check("horizontaal: |ex·Z| < 0,05", FILTER_HORIZONTAAL === 0.05);
check("precies 0,95 is schuin, net erboven verticaal",
  filterRichting(0.95) === "sloped" && filterRichting(0.9500001) === "vertical" && filterRichting(1) === "vertical");
check("precies 0,05 is schuin, net eronder horizontaal",
  filterRichting(0.05) === "sloped" && filterRichting(0.0499999) === "horizontal" && filterRichting(0) === "horizontal");
check("het teken telt niet (een staaf van boven naar onder)", filterRichting(-0.99) === "vertical" && filterRichting(-0.01) === "horizontal");
check("een criterium zonder waarden doet niet mee",
  !filterCriteriumActief({ property: "profile", mode: "keep", values: [] })
  && filterCriteriumActief({ property: "profile", mode: "keep", values: ["HEA 200"] }));
check("een lengte zonder van en tot doet niet mee, met één grens wel",
  !filterCriteriumActief({ property: "length", mode: "keep" })
  && filterCriteriumActief({ property: "length", mode: "keep", toMm: 4000 }));
check("keuren: van groter dan tot wordt geweigerd",
  gooit(() => keurFilterCriteria([{ property: "length", mode: "keep", fromMm: 5000, toMm: 4000 }])) instanceof Error);
check("keuren: een negatieve lengte wordt geweigerd",
  gooit(() => keurFilterCriteria([{ property: "length", mode: "keep", fromMm: -1 }])) instanceof Error);
check("keuren: een geldige set gaat door",
  gooit(() => keurFilterCriteria([{ property: "type", mode: "remove", values: ["node"] }, { property: "length", mode: "keep", fromMm: 0, toMm: 0 }])) === null);
const geval = (gevallen, actief) => JSON.stringify(filterLastGeval(gevallen, actief));
check("geval na Toepassen: zonder lasten niets (de weergave blijft)", filterLastGeval([], 1) === null);
check("geval na Toepassen: alle lasten in één ander geval → dat geval", geval([2], 1) === '{"geval":2,"meerdere":false}');
check("geval na Toepassen: alle lasten in het actieve geval → blijft", geval([3], 3) === '{"geval":3,"meerdere":false}');
check("geval na Toepassen: meerdere gevallen met het actieve erbij → het actieve blijft, met melding",
  geval([1, 2, 3], 2) === '{"geval":2,"meerdere":true}');
check("geval na Toepassen: meerdere gevallen zonder het actieve → het laagste, met melding",
  geval([3, 2], 1) === '{"geval":2,"meerdere":true}');

// ── [2] 3D ─────────────────────────────────────────────────────────────────

console.log("\n[2] 3D");
const levels = [
  { id: "L0", label: "Peil 0", position: 0 },
  { id: "L1", label: "Verdieping", position: 4000 },
];
// Een portaal met een schoor, een vloerplaat op 4 m en lasten in drie gevallen.
// Knoop 3 is aan L1 gekoppeld, knoop 4 ligt alleen op die hoogte.
const model = {
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 },
    { id: 3, x: 0, y: 0, z: 4, levelId: "L1" }, { id: 4, x: 6, y: 0, z: 4 },
    { id: 7, x: 6, y: 6, z: 4, levelId: "L1" }, { id: 8, x: 0, y: 6, z: 4, levelId: "L1" },
    // Bijna verticaal (|ez| = 0,96) en bijna horizontaal (|ez| = 0,04).
    { id: 9, x: 10, y: 0, z: 0 }, { id: 10, x: 10 + Math.sqrt(1 - 0.96 ** 2), y: 0, z: 0.96 },
    { id: 11, x: 12, y: 0, z: 0 }, { id: 12, x: 12 + Math.sqrt(1 - 0.04 ** 2), y: 0, z: 0.04 },
  ],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 3, profileName: "HEA 200", material: "S235", group: "kolom" },
    { id: 2, startNodeId: 2, endNodeId: 4, profileName: "HEA 200", material: "S355", group: "kolom" },
    { id: 3, startNodeId: 3, endNodeId: 4, profileName: "IPE 300", material: "S235", group: "ligger" },
    { id: 4, startNodeId: 1, endNodeId: 4 },
    { id: 5, startNodeId: 9, endNodeId: 10, profileName: "HEA 200", material: "S235" },
    { id: 6, startNodeId: 11, endNodeId: 12, profileName: "IPE 300", material: "S235" },
  ],
  supports: [
    { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
    { nodeId: 2, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false },
  ],
  plates: [{ id: 1, nodeIds: [3, 4, 7, 8], thicknessM: 0.2, material: "C30/37", levelId: "L1" }],
  loads: [{ id: 1, nodeId: 3, caseId: 1, fx: 5, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
  memberLoads: [{ id: 1, beamId: 3, caseId: 2, qyStart: 0, qyEnd: 0, qzStart: -3, qzEnd: -3, startPositionM: 0, endPositionM: 6 }],
  memberPointLoads: [{ id: 2, beamId: 3, caseId: 1, py: 0, pz: -10, positionM: 3 }],
  thermalLoads: [{ id: 1, beamId: 1, caseId: 3, deltaTUniformK: 20, deltaTGradientYK: 0, deltaTGradientZK: 0 }],
  surfaceLoads: [{ id: 1, plateId: 1, caseId: 2, qx: 0, qy: 0, qz: -2 }],
  loadPanels: [{ id: 1, nodeIds: [3, 4, 7, 8], caseId: 2, q: 1, direction: "gravity", distribution: "twoWay" }],
};
const filter = (criteria, ids = null) => filterOpenFem3D(model, levels, ids, criteria);
const staven = (uit) => lijst(uit.ids.beamIds);
const knopen = (uit) => lijst(uit.ids.nodeIds);

const heel = filter([]);
check("niets geselecteerd: het hele model is de basis", heel.heleModel === true
  && heel.telling.node === 10 && heel.telling.beam === 6 && heel.telling.plate === 1 && heel.telling.load === 6 && heel.telling.support === 2,
JSON.stringify(heel.telling));
check("zonder criteria blijft de basis staan, met elke last per soort",
  lijst(heel.ids.loads.nodalLoad) === "1" && lijst(heel.ids.loads.memberLoad) === "1" && lijst(heel.ids.loads.memberPointLoad) === "2"
  && lijst(heel.ids.loads.thermalLoad) === "1" && lijst(heel.ids.loads.surfaceLoad) === "1" && lijst(heel.ids.loads.loadPanel) === "1",
JSON.stringify(heel.ids.loads));

const alleenStaven = filter([{ property: "type", mode: "keep", values: ["beam"] }]);
check("type staven houden: alleen de staven", staven(alleenStaven) === "1,2,3,4,5,6" && alleenStaven.telling.node === 0
  && alleenStaven.telling.load === 0 && alleenStaven.telling.plate === 0);
const zonderKnopen = filter([{ property: "type", mode: "remove", values: ["node"] }]);
check("type knopen weghalen: de rest blijft, opleggingen gaan mee (het zijn knopen)",
  zonderKnopen.telling.node === 0 && zonderKnopen.telling.support === 0 && zonderKnopen.telling.beam === 6 && zonderKnopen.telling.load === 6);
const opleggingen = filter([{ property: "type", mode: "keep", values: ["support"] }]);
check("type opleggingen houden: de knopen met een oplegging", knopen(opleggingen) === "1,2" && opleggingen.telling.support === 2
  && opleggingen.telling.beam === 0);
const zonderOpleggingen = filter([{ property: "type", mode: "remove", values: ["support"] }]);
check("type opleggingen weghalen: de andere knopen blijven", knopen(zonderOpleggingen) === "3,4,7,8,9,10,11,12");
const lastenEnPlaten = filter([{ property: "type", mode: "keep", values: ["load", "plate"] }]);
check("twee typen houden: lasten en platen", lastenEnPlaten.telling.load === 6 && lastenEnPlaten.telling.plate === 1
  && lastenEnPlaten.telling.beam === 0);

check("profiel HEA 200 houden: alleen die staven, niets anders",
  staven(filter([{ property: "profile", mode: "keep", values: ["HEA 200"] }])) === "1,2,5"
  && filter([{ property: "profile", mode: "keep", values: ["HEA 200"] }]).telling.node === 0);
const zonderHea = filter([{ property: "profile", mode: "remove", values: ["HEA 200"] }]);
check("profiel HEA 200 weghalen: de andere staven, knopen, plaat en lasten blijven",
  staven(zonderHea) === "3,4,6" && zonderHea.telling.node === 10 && zonderHea.telling.plate === 1 && zonderHea.telling.load === 6);
check("een staaf zonder profiel heeft de waarde \"\"", staven(filter([{ property: "profile", mode: "keep", values: [""] }])) === "4");
check("materiaal S235 houden", staven(filter([{ property: "material", mode: "keep", values: ["S235"] }])) === "1,3,5,6");
check("materiaal geldt ook voor een plaat", lijst(filter([{ property: "material", mode: "keep", values: ["C30/37"] }]).ids.plateIds) === "1");
check("groep kolom houden", staven(filter([{ property: "group", mode: "keep", values: ["kolom"] }])) === "1,2");
check("groep: zonder groep is \"\"", staven(filter([{ property: "group", mode: "keep", values: [""] }])) === "4,5,6");

check("richting verticaal: de kolommen en de staaf met |ez| = 0,96",
  staven(filter([{ property: "direction", mode: "keep", values: ["vertical"] }])) === "1,2,5");
check("richting horizontaal: de ligger en de staaf met |ez| = 0,04",
  staven(filter([{ property: "direction", mode: "keep", values: ["horizontal"] }])) === "3,6");
check("richting schuin: de schoor", staven(filter([{ property: "direction", mode: "keep", values: ["sloped"] }])) === "4");
check("richting verticaal weghalen houdt knopen en de andere staven",
  staven(filter([{ property: "direction", mode: "remove", values: ["vertical"] }])) === "3,4,6"
  && filter([{ property: "direction", mode: "remove", values: ["vertical"] }]).telling.node === 10);

const opL1 = filter([{ property: "level", mode: "keep", values: ["L1"] }]);
check("level L1: knopen gekoppeld of op de hoogte, de ligger ertussen en de plaat",
  knopen(opL1) === "3,4,7,8" && staven(opL1) === "3" && lijst(opL1.ids.plateIds) === "1" && opL1.telling.load === 0,
JSON.stringify(opL1.ids));
const opL0 = filter([{ property: "level", mode: "keep", values: ["L0"] }]);
check("level L0 (peil 0, op hoogte): knopen op z = 0, geen kolom (die loopt naar L1)",
  knopen(opL0) === "1,2,9,11" && staven(opL0) === "", JSON.stringify(opL0.ids));
check("level L1 weghalen", knopen(filter([{ property: "level", mode: "remove", values: ["L1"] }])) === "1,2,9,10,11,12");

const lengte = (fromMm, toMm, mode = "keep") => staven(filter([{ property: "length", mode, fromMm, toMm }]));
check("lengte 4000–6000 mm: de grenzen tellen mee (4 m kolommen, 6 m ligger)", lengte(4000, 6000) === "1,2,3");
check("lengte vanaf 4001 mm", lengte(4001, undefined) === "3,4");
check("lengte tot 4000 mm", lengte(undefined, 4000) === "1,2,5,6");
check("lengte 999–1001 mm: de staven van 1 m", lengte(999, 1001) === "5,6");
check("lengte 4000–6000 mm weghalen", lengte(4000, 6000, "remove") === "4,5,6");
check("een lengte geldt niet voor knopen: houden laat ze vallen",
  filter([{ property: "length", mode: "keep", fromMm: 0 }]).telling.node === 0);

const geval2 = filter([{ property: "loadCase", mode: "keep", values: [2] }]);
check("belastinggeval 2 houden: lijnlast, vlaklast en belastingvlak",
  geval2.telling.load === 3 && lijst(geval2.ids.loads.memberLoad) === "1" && lijst(geval2.ids.loads.surfaceLoad) === "1"
  && lijst(geval2.ids.loads.loadPanel) === "1" && geval2.telling.beam === 0, JSON.stringify(geval2.ids));
const zonderGeval1 = filter([{ property: "loadCase", mode: "remove", values: [1] }]);
check("belastinggeval 1 weghalen: de knooplast en de puntlast weg, de geometrie blijft",
  zonderGeval1.telling.load === 4 && !zonderGeval1.ids.loads.nodalLoad?.length && !zonderGeval1.ids.loads.memberPointLoad?.length
  && zonderGeval1.telling.beam === 6);
const lijnlasten = filter([{ property: "loadKind", mode: "keep", values: ["line"] }]);
check("soort lijnlast houden: alleen lijnlast 1 (een knooplast 1 bestaat ook)",
  lijnlasten.telling.load === 1 && lijst(lijnlasten.ids.loads.memberLoad) === "1" && !lijnlasten.ids.loads.nodalLoad?.length);
check("soort knooplast en temperatuur weghalen",
  filter([{ property: "loadKind", mode: "remove", values: ["nodal", "thermal"] }]).telling.load === 4);
check("soort puntlast op staaf, vlaklast, belastingvlak",
  filter([{ property: "loadKind", mode: "keep", values: ["memberPoint", "surface", "loadPanel"] }]).telling.load === 3);

const combinatie = filter([
  { property: "type", mode: "keep", values: ["beam"] },
  { property: "material", mode: "keep", values: ["S235"] },
  { property: "direction", mode: "remove", values: ["vertical"] },
]);
check("combinatie (EN): staven, S235, niet verticaal", staven(combinatie) === "3,6" && combinatie.telling.node === 0);
check("combinatie: lastgeval 1 én soort knooplast",
  filter([{ property: "loadCase", mode: "keep", values: [1] }, { property: "loadKind", mode: "keep", values: ["nodal"] }]).telling.load === 1);
check("een criterium zonder waarden verandert niets",
  filter([{ property: "profile", mode: "keep", values: [] }]).telling.beam === 6);

// De selectie als basis.
const selectie = { type: "multi", nodeIds: [3], beamIds: [1, 2, 3, 4], plateIds: [] };
const ids = openFem3DSelectieIds(selectie);
check("selectie → id's", lijst(ids.nodeIds) === "3" && lijst(ids.beamIds) === "1,2,3,4");
check("niets geselecteerd → geen id's (dus het hele model)", openFem3DSelectieIds(null) === null);
const uitSelectie = filter([{ property: "profile", mode: "keep", values: ["HEA 200"] }], ids);
check("op de selectie: HEA 200 houden geeft 1 en 2, niet staaf 5 buiten de selectie",
  uitSelectie.heleModel === false && staven(uitSelectie) === "1,2" && uitSelectie.telling.node === 0);
check("op de selectie zonder criteria: precies de selectie",
  staven(filter([], ids)) === "1,2,3,4" && knopen(filter([], ids)) === "3" && filter([], ids).telling.load === 0);
check("één last geselecteerd is ook een basis", filter([], openFem3DSelectieIds({ type: "memberLoad", id: 1 })).telling.load === 1);
check("een id die niet (meer) bestaat, valt weg", staven(filter([], { nodeIds: [], beamIds: [3, 99], plateIds: [], loads: {} })) === "3");

const keuzesSelectie = filterKeuzes(openFem3DFilterElementen(model, levels, openFem3DSelectieIds({ type: "beam", id: 3 })));
check("keuzelijsten alleen uit de basis: één staaf → één profiel, één materiaal, één richting",
  keuzesSelectie.profile.map((k) => k.value).join() === "IPE 300" && keuzesSelectie.material.map((k) => k.value).join() === "S235"
  && keuzesSelectie.direction.map((k) => k.value).join() === "horizontal" && keuzesSelectie.loadCase.length === 0,
JSON.stringify(keuzesSelectie));
const keuzesModel = filterKeuzes(openFem3DFilterElementen(model, levels, null));
check("keuzelijsten van het model: profielen met aantal, oplopend, \"\" achteraan",
  keuzesModel.profile.map((k) => `${k.value}:${k.count}`).join() === "HEA 200:3,IPE 300:2,:1", JSON.stringify(keuzesModel.profile));
check("keuzelijst typen in vaste volgorde, alleen wat voorkomt",
  keuzesModel.type.map((k) => `${k.value}:${k.count}`).join() === "node:10,beam:6,plate:1,load:6,support:2");
check("keuzelijst lastsoort en belastinggeval", keuzesModel.loadKind.map((k) => k.value).join() === "nodal,line,memberPoint,thermal,surface,loadPanel"
  && keuzesModel.loadCase.map((k) => `${k.value}:${k.count}`).join() === "1:2,2:3,3:1", JSON.stringify(keuzesModel.loadCase));
check("keuzelijst levels en lengtebereik in mm", keuzesModel.level.map((k) => `${k.value}:${k.count}`).join() === "L0:4,L1:6"
  && Math.abs(keuzesModel.lengthMm.min - 1000) < 1e-6 && Math.abs(keuzesModel.lengthMm.max - Math.hypot(6, 4) * 1000) < 1e-6,
JSON.stringify([keuzesModel.level, keuzesModel.lengthMm]));
check("keuzelijst groep: \"\" achteraan", keuzesModel.group.map((k) => k.value).join() === "kolom,ligger,");
check("belastinggevallen van een uitkomst", lijst(openFem3DSelectieBelastinggevallen(model, geval2.ids)) === "2"
  && lijst(openFem3DSelectieBelastinggevallen(model, heel.ids)) === "1,2,3");

// ── [3] De 3D-selectie met lasten ──────────────────────────────────────────

console.log("\n[3] 3D-selectie met lasten");
check("één staaf → enkele selectie", JSON.stringify(openFem3DSelectionFromIds({ beamIds: [3] })) === '{"type":"beam","id":3}');
check("één last → enkele selectie van die soort",
  JSON.stringify(openFem3DSelectionFromIds({ loads: { memberLoad: [1] } })) === '{"type":"memberLoad","id":1}');
check("niets → geen selectie", openFem3DSelectionFromIds({}) === null);
const metLasten = openFem3DSelectionFromIds(geval2.ids);
check("drie lasten → groepsselectie met de lasten per soort", metLasten.type === "multi"
  && lijst(metLasten.loads.memberLoad) === "1" && lijst(metLasten.loads.loadPanel) === "1" && metLasten.nodeIds.length === 0,
JSON.stringify(metLasten));
check("bevat: de lasten in de groepsselectie, niet een andere soort met hetzelfde id",
  openFem3DSelectionContains(metLasten, "memberLoad", 1) && openFem3DSelectionContains(metLasten, "surfaceLoad", 1)
  && !openFem3DSelectionContains(metLasten, "nodalLoad", 1) && !openFem3DSelectionContains(metLasten, "thermalLoad", 1));
check("telling van de groepsselectie telt de lasten mee", openFem3DSelectionCount(metLasten) === 3
  && openFem3DSelectionCount(openFem3DSelectionFromIds(heel.ids)) === 10 + 6 + 1 + 6);
const naVerwijderen = removeOpenFem3DSelection(model, metLasten);
check("verwijderen haalt de lasten weg, geometrie en andere lasten blijven",
  naVerwijderen.memberLoads.length === 0 && naVerwijderen.surfaceLoads.length === 0 && naVerwijderen.loadPanels.length === 0
  && naVerwijderen.loads.length === 1 && naVerwijderen.memberPointLoads.length === 1 && naVerwijderen.beams.length === 6);
const gemengd = openFem3DSelectionFromIds({ beamIds: [3], loads: { nodalLoad: [1] } });
check("geometrietelling (label van het transformatiepaneel) laat de lasten weg",
  openFem3DSelectionGeometryCount(gemengd) === 1 && openFem3DSelectionCount(gemengd) === 2);
const naKlik = toggleOpenFem3DSelection(gemengd, { type: "beam", id: 1 }, true);
check("Ctrl-klik op een staaf houdt de lasten in de selectie vast",
  naKlik.type === "multi" && lijst(naKlik.beamIds) === "1,3" && lijst(naKlik.loads?.nodalLoad) === "1", JSON.stringify(naKlik));
const terug = toggleOpenFem3DSelection(naKlik, { type: "beam", id: 1 }, true);
check("en nog eens: staaf 3 met de knooplast blijft een groep", terug.type === "multi" && lijst(terug.beamIds) === "3"
  && lijst(terug.loads?.nodalLoad) === "1", JSON.stringify(terug));

// ── [4] 2D ─────────────────────────────────────────────────────────────────

console.log("\n[4] 2D");
// Een portaal in mm met een schoor; staaf 4 zonder profiel en materiaal (standaard HEA160, S235).
const model2d = {
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }, { id: 3, x: 0, z: 4000 }, { id: 4, x: 6000, z: 4000 }],
  beams: [
    { id: 1, from: 1, to: 3, profile: "HEA200", material: "S235" },
    { id: 2, from: 2, to: 4, profile: "HEA200", material: "S355" },
    { id: 3, from: 3, to: 4, profile: "IPE300", material: "S235", loadRole: "vloer" },
    { id: 4, from: 1, to: 4 },
  ],
  supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 2, type: "pinned" }],
  plates: [],
  loads: [
    { id: 1, type: "pointForce", caseId: 1, nodeId: 3, fx: 5 },
    { id: 2, type: "lineLoad", caseId: 2, beamId: 3, q: -3 },
    { id: 3, type: "pointForce", caseId: 2, beamId: 3, posFrac: 0.5, fz: -10 },
    { id: 4, type: "pointMoment", caseId: 1, nodeId: 4, my: 2 },
    { id: 5, type: "thermal", caseId: 3, beamId: 1, deltaT: 20 },
  ],
};
check("lastsoorten van 2D", [1, 2, 3, 4, 5].map((id) => lastSoort2D(model2d.loads.find((l) => l.id === id))).join()
  === "nodal,line,memberPoint,moment,thermal");
check("randlast en puntlast op een plaatrand",
  lastSoort2D({ id: 9, type: "edgeLoad", caseId: 1, plateId: 1 }) === "edge"
  && lastSoort2D({ id: 9, type: "pointForce", caseId: 1, plateId: 1 }) === "edgePoint");
const heel2d = filterSelectie2D(model2d, null, []);
check("2D, niets geselecteerd: het hele model", heel2d.heleModel && heel2d.telling.node === 4 && heel2d.telling.beam === 4
  && heel2d.telling.load === 5 && heel2d.telling.support === 2);
const elementen2d = filterElementen2D(model2d, null);
const staaf4 = elementen2d.find((e) => e.soort === "beam" && e.id === 4);
check("2D: standaardprofiel en -materiaal, lengte in mm, richting schuin",
  staaf4.profile === "HEA160" && staaf4.material === "S235" && Math.abs(staaf4.lengthMm - Math.hypot(6000, 4000)) < 1e-9
  && staaf4.direction === "sloped", JSON.stringify(staaf4));
check("2D: staaftype zoals ingesteld, anders afgeleid",
  elementen2d.find((e) => e.soort === "beam" && e.id === 3).role === "vloer" && staaf4.role === "dakHellend"
  && elementen2d.find((e) => e.soort === "beam" && e.id === 1).role === "gevelLinks");
const s2 = (criteria, ids = null) => lijst(filterSelectie2D(model2d, ids, criteria).ids.beamIds);
check("2D: profiel HEA200 houden", s2([{ property: "profile", mode: "keep", values: ["HEA200"] }]) === "1,2");
check("2D: richting verticaal", s2([{ property: "direction", mode: "keep", values: ["vertical"] }]) === "1,2");
check("2D: lengte 4000–6000 mm", s2([{ property: "length", mode: "keep", fromMm: 4000, toMm: 6000 }]) === "1,2,3");
check("2D: staaftype gevelLinks houden", s2([{ property: "role", mode: "keep", values: ["gevelLinks"] }]) === "1");
const l2 = filterSelectie2D(model2d, null, [{ property: "loadCase", mode: "keep", values: [2] }]);
check("2D: belastinggeval 2", lijst(l2.ids.loadIds) === "2,3" && l2.telling.beam === 0);
check("2D: de belastinggevallen van gekozen lasten, oplopend en zonder dubbele",
  lijst(selectieBelastinggevallen2D(model2d, l2.ids)) === "2"
  && lijst(selectieBelastinggevallen2D(model2d, { loadIds: [5, 1, 2, 4] })) === "1,2,3"
  && lijst(selectieBelastinggevallen2D(model2d, { loadIds: [] })) === "");
check("2D: geval 2 houden vanuit actief geval 1 → geval 2 wordt actief",
  JSON.stringify(filterLastGeval(selectieBelastinggevallen2D(model2d, l2.ids), 1)) === '{"geval":2,"meerdere":false}');
// Platen met en zonder materiaal: het materiaal staat onder "Algemeen" en geldt in 2D net als in 3D ook voor een plaat.
const metPlaten = { ...model2d, plates: [{ id: 1, materiaal: "C30/37" }, { id: 2 }, { id: 3, materiaal: " S235 " }] };
const opPlaten = (criteria) => filterSelectie2D(metPlaten, null, criteria).ids;
const beton = opPlaten([{ property: "material", mode: "keep", values: ["C30/37"] }]);
check("2D: een plaat filtert op materiaal (C30/37 houden → alleen plaat 1)",
  lijst(beton.plateIds) === "1" && beton.beamIds.length === 0 && beton.nodeIds.length === 0, JSON.stringify(beton));
const s235 = opPlaten([{ property: "material", mode: "keep", values: ["S235"] }]);
check("2D: S235 houden houdt de staven én de plaat van S235", lijst(s235.beamIds) === "1,3,4" && lijst(s235.plateIds) === "3",
  JSON.stringify(s235));
check("2D: een plaat zonder materiaal heeft \"\" (in het venster: (geen))",
  lijst(opPlaten([{ property: "material", mode: "keep", values: [""] }]).plateIds) === "2");
check("2D: de keuzelijst materiaal noemt ook het plaatmateriaal",
  filterKeuzes(filterElementen2D(metPlaten, null)).material.map((k) => `${k.value}:${k.count}`).join() === "C30/37:1,S235:4,S355:1,:1",
  JSON.stringify(filterKeuzes(filterElementen2D(metPlaten, null)).material));
check("2D: soort moment weghalen uit de lasten",
  lijst(filterSelectie2D(model2d, null, [{ property: "type", mode: "keep", values: ["load"] }, { property: "loadKind", mode: "remove", values: ["moment"] }]).ids.loadIds) === "1,2,3,5");
check("2D: opleggingen houden", lijst(filterSelectie2D(model2d, null, [{ property: "type", mode: "keep", values: ["support"] }]).ids.nodeIds) === "1,2");
const sel2d = { type: "multi", nodeIds: [1, 2, 3, 4], beamIds: [1, 2, 3], plateIds: [] };
check("2D: selectie → id's, en de selectie als basis", lijst(selectieIds2D(sel2d).beamIds) === "1,2,3"
  && s2([{ property: "type", mode: "keep", values: ["beam"] }], selectieIds2D(sel2d)) === "1,2,3");
check("2D: een selectie met lasten", lijst(selectieIds2D({ type: "multi", nodeIds: [], beamIds: [], plateIds: [], loadIds: [2, 3] }).loadIds) === "2,3"
  && lijst(selectieIds2D({ type: "load", id: 4 }).loadIds) === "4" && selectieIds2D(null) === null);
check("2D: terug naar een selectie (één staaf, groep met lasten, niets)",
  JSON.stringify(selectieUitIds2D({ nodeIds: [], beamIds: [3], plateIds: [], loadIds: [] })) === '{"type":"beam","id":3}'
  && JSON.stringify(selectieUitIds2D({ nodeIds: [], beamIds: [], plateIds: [], loadIds: [4] })) === '{"type":"load","id":4}'
  && JSON.stringify(selectieUitIds2D({ nodeIds: [1], beamIds: [], plateIds: [], loadIds: [4] }))
    === '{"type":"multi","nodeIds":[1],"beamIds":[],"plateIds":[],"loadIds":[4]}'
  && JSON.stringify(selectieUitIds2D({ nodeIds: [1, 2], beamIds: [], plateIds: [], loadIds: [] }))
    === '{"type":"multi","nodeIds":[1,2],"beamIds":[],"plateIds":[]}'
  && selectieUitIds2D({ nodeIds: [], beamIds: [], plateIds: [], loadIds: [] }) === null);

// ── [5] Bedrading ──────────────────────────────────────────────────────────

console.log("\n[5] bedrading");
const lees = (...pad) => readFileSync(new URL(pad.join("/"), import.meta.url), "utf8").replace(/\r\n/g, "\n");
const app = lees("src", "App.tsx");
/** De tekst van handler `naam` in App.tsx, van `const naam = ` tot de afsluitende `};` op inspringing 2. */
const handler = (naam) => {
  const begin = app.indexOf(`  const ${naam} = `);
  const eind = begin < 0 ? -1 : app.indexOf("\n  };", begin);
  return eind < 0 ? "" : app.slice(begin, eind);
};
const h2 = handler("zetGefilterdeSelectie2D");
check("App 2D: Toepassen gaat via zetGefilterdeSelectie2D (niet rechtstreeks naar fem.setSelection)",
  /onSelect=\{\(next, ids\) => zetGefilterdeSelectie2D\(next, ids\)\}/.test(app) && !/onSelect=\{fem\.setSelection\}/.test(app));
check("App 2D: het geval van de gekozen lasten actief, lasten aan, combinatie, omhullende en resultaten uit, melding bij meerdere",
  /fem\.setSelection\(next\)/.test(h2) && /selectieBelastinggevallen2D\(selectieFilterModel2D, ids\)/.test(h2)
  && /filterLastGeval\(gevallen, fem\.activeLoadCaseId\)/.test(h2) && /fem\.setActiveLoadCaseId\(keuze\.geval\)/.test(h2)
  && /fem\.setActiveCombinationId\(null\)/.test(h2) && /fem\.setEnvelopeView\(false\)/.test(h2)
  && /fem\.setShowLoads\(true\)/.test(h2) && /setResultsTabActive\(false\)/.test(h2)
  && /if \(keuze\.meerdere\) meldGefilterdeLastenInMeerdereGevallen\(gevallen, keuze\.geval\)/.test(h2), h2.slice(0, 200));
const h3 = handler("zetGefilterdeSelectie3D");
check("App 3D: lastweergave aan, lasten en belastingvlakken zichtbaar, resultaten uit, geval via filterLastGeval, melding bij meerdere",
  /setOpenFem3dShowLoadCase\(true\)/.test(h3) && /setResultsTabActive\(false\)/.test(h3)
  && /setOpenFem3dVisibility\(\(value\) => value\.loads && value\.loadPanels \? value : \{ \.\.\.value, loads: true, loadPanels: true \}\)/.test(h3)
  && /filterLastGeval\(gevallen, fem\.activeLoadCaseId\)/.test(h3) && /fem\.setActiveLoadCaseId\(keuze\.geval\)/.test(h3)
  && /if \(keuze\.meerdere\) meldGefilterdeLastenInMeerdereGevallen\(gevallen, keuze\.geval\)/.test(h3), h3.slice(0, 200));
check("App 3D: het venster en de API-actie zetSelectie3D gaan door dezelfde afhandeling",
  /onSelect=\{\(next\) => zetGefilterdeSelectie3D\(next\)\}/.test(app) && /zetSelectie3D: \(selectie\) => zetGefilterdeSelectie3D\(selectie\)/.test(app));
const editor = lees("src", "components", "openFem3d", "OpenFem3DEditor.tsx");
check("transformatiepaneel: het label telt alleen knopen, staven en platen",
  /count: openFem3DSelectionGeometryCount\(transformSelection\)/.test(editor) && !/openFem3DSelectionCount\(/.test(editor));

// ── [6] Teksten ────────────────────────────────────────────────────────────

console.log("\n[6] teksten: enkelvoud en meervoud");
const i18next = (await import("i18next")).default;
const resources = Object.fromEntries(["nl", "en", "de", "fr"].map((taal) =>
  [taal, { common: JSON.parse(lees("src", "i18n", "locales", taal, "common.json")) }]));
const vertaler = i18next.createInstance();
await vertaler.init({ resources, lng: "nl", fallbackLng: false, defaultNS: "common", interpolation: { escapeValue: false }, initImmediate: false,
  showSupportNotice: false });
const tekst = (taal, sleutel, opties) => vertaler.getFixedT(taal)(`selectieFilter.${sleutel}`, opties);
check("nl: 1 element, 2 elementen (basis en voettekst)",
  tekst("nl", "basisSelectie", { count: 1 }) === "Werkt op de huidige selectie: 1 element."
  && tekst("nl", "basisSelectie", { count: 2 }) === "Werkt op de huidige selectie: 2 elementen."
  && tekst("nl", "basisModel", { count: 1 }) === "Er is niets geselecteerd: het filter werkt op het hele model (1 element)."
  && tekst("nl", "over", { over: 1, count: 1 }) === "Over: 1 van 1 element"
  && tekst("nl", "over", { over: 1, count: 5 }) === "Over: 1 van 5 elementen",
  [tekst("nl", "basisSelectie", { count: 1 }), tekst("nl", "over", { over: 1, count: 1 })].join(" | "));
for (const [taal, enkel, meer] of [["en", /\b1 element\b/, /\b2 elements\b/], ["de", /\b1 Element\b/, /\b2 (Elemente|Elementen)\b/],
  ["fr", /\b1 élément\b/, /\b2 éléments\b/]]) {
  const een = ["basisSelectie", "basisModel", "over"].map((sleutel) => tekst(taal, sleutel, { count: 1, over: 1 }));
  const twee = ["basisSelectie", "basisModel", "over"].map((sleutel) => tekst(taal, sleutel, { count: 2, over: 1 }));
  check(`${taal}: enkelvoud bij 1, meervoud bij 2`, een.every((t) => enkel.test(t)) && twee.every((t) => meer.test(t)),
    [...een, ...twee].join(" | "));
}
check("nl: melding bij lasten in meerdere gevallen", tekst("nl", "meerdereGevallen.tekst", { aantal: 2, geval: "Permanent (G)" })
  === "De gekozen lasten liggen in 2 belastinggevallen. Ze zijn allemaal geselecteerd, maar alleen die van het actieve geval (Permanent (G)) staan in beeld.");

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

// API-commando model3d.selection.filter (issue #94): een selectie verfijnen
// zoals het venster Selectiefilter, met dezelfde zuivere functie
// (filterOpenFem3D). Tegen de bron én tegen de sidecarbundel (de MCP-server
// voert het daar uit).
const { maakRegister } = await import("./src/api/register.ts");
const { leegDocument, metModel3d } = await import("./src/api/projectDocument.ts");
const { standaardRegister } = await import("./src/api/standaardRegister.ts");
const { MODEL3D_SELECTIE_COMMANDOS } = await import("./src/api/commands/model3dSelectie.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const lijst = (ids) => (ids ?? []).join(",");

// Tien staven op een rij (1 → 10): vier HEA 200, zes IPE 300; staaf 10 verticaal.
const knopen = Array.from({ length: 11 }, (_, i) => ({ id: i + 1, x: i * 5, y: 0, z: 0 }));
knopen.push({ id: 12, x: 0, y: 0, z: 4 });
const staven = Array.from({ length: 9 }, (_, i) => ({
  id: i + 1, startNodeId: i + 1, endNodeId: i + 2, profileName: [1, 4, 6, 8].includes(i + 1) ? "HEA 200" : "IPE 300", material: "S235",
}));
staven.push({ id: 10, startNodeId: 1, endNodeId: 12, profileName: "HEA 200", material: "S355", group: "kolom" });
const model = {
  nodes: knopen, beams: staven,
  supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false }],
  loads: [{ id: 1, nodeId: 12, caseId: 2, fx: 1, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
  memberLoads: [{ id: 1, beamId: 2, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -1, qzEnd: -1, startPositionM: 0, endPositionM: 5 }],
  memberPointLoads: [], thermalLoads: [], plates: [], surfaceLoads: [], loadPanels: [],
};
const doc = { ...metModel3d(leegDocument(), model), structuralGrid: { enabled: true, xAxes: [], yAxes: [], zAxes: [{ id: "L4", label: "Kop", position: 4000 }] } };
const register = maakRegister(MODEL3D_SELECTIE_COMMANDOS);
const doe = (invoer, context = {}) => register.voerUit("model3d.selection.filter", invoer, { document: doc, ...context });
const faalt = (invoer) => { try { doe(invoer); return null; } catch (e) { return e; } };

console.log("[1] filteren");
check("het commando staat in de standaardcatalogus", standaardRegister().heeft("model3d.selection.filter"));
const alleTien = Array.from({ length: 10 }, (_, i) => i + 1);
const hea = doe({ beamIds: alleTien, criteria: [{ property: "profile", mode: "keep", values: ["HEA 200"] }] });
check("tien staven, alleen HEA 200 houden → 1, 4, 6, 8, 10", lijst(hea.uitkomst.beamIds) === "1,4,6,8,10"
  && hea.uitkomst.counts.beams === 5 && hea.uitkomst.counts.nodes === 0, JSON.stringify(hea.uitkomst));
check("het document verandert niet", hea.document === undefined);
check("op de selectie, niet het hele model", hea.uitkomst.wholeModel === false);
const weg = doe({ beamIds: alleTien, criteria: [{ property: "profile", mode: "remove", values: ["HEA 200"] }] });
check("HEA 200 weghalen → de IPE 300", lijst(weg.uitkomst.beamIds) === "2,3,5,7,9");
const heel = doe({});
check("zonder id's: het hele model", heel.uitkomst.wholeModel === true && heel.uitkomst.counts.nodes === 12
  && heel.uitkomst.counts.beams === 10 && heel.uitkomst.counts.loads === 2 && heel.uitkomst.counts.supports === 1,
JSON.stringify(heel.uitkomst.counts));
check("opleggingen als knopen", lijst(doe({ criteria: [{ property: "type", mode: "keep", values: ["support"] }] }).uitkomst.nodeIds) === "1"
  && lijst(heel.uitkomst.supportNodeIds) === "1");
check("lasten per soort", lijst(heel.uitkomst.nodalLoadIds) === "1" && lijst(heel.uitkomst.memberLoadIds) === "1"
  && lijst(heel.uitkomst.memberPointLoadIds) === "");
check("richting verticaal", lijst(doe({ criteria: [{ property: "direction", mode: "keep", values: ["vertical"] }] }).uitkomst.beamIds) === "10");
check("lengte in mm (de grens telt mee)",
  lijst(doe({ criteria: [{ property: "length", mode: "keep", fromMm: 4000, toMm: 4000 }] }).uitkomst.beamIds) === "10");
check("level (id uit model3d.levels.get)",
  lijst(doe({ criteria: [{ property: "level", mode: "keep", values: ["L4"] }] }).uitkomst.nodeIds) === "12");
check("groep", lijst(doe({ criteria: [{ property: "group", mode: "keep", values: ["kolom"] }] }).uitkomst.beamIds) === "10");
const geval1 = doe({ criteria: [{ property: "loadCase", mode: "keep", values: [1] }] });
check("belastinggeval 1: alleen de lijnlast", lijst(geval1.uitkomst.memberLoadIds) === "1" && geval1.uitkomst.counts.loads === 1
  && lijst(geval1.uitkomst.nodalLoadIds) === "");
check("soort knooplast", lijst(doe({ criteria: [{ property: "loadKind", mode: "keep", values: ["nodal"] }] }).uitkomst.nodalLoadIds) === "1");
check("lasten als basis", doe({ memberLoadIds: [1], nodalLoadIds: [1], criteria: [{ property: "loadCase", mode: "remove", values: [2] }] })
  .uitkomst.counts.loads === 1);
const samen = doe({ beamIds: alleTien, criteria: [
  { property: "profile", mode: "keep", values: ["HEA 200"] }, { property: "direction", mode: "remove", values: ["vertical"] },
] });
check("criteria samen (EN)", lijst(samen.uitkomst.beamIds) === "1,4,6,8");

console.log("\n[2] invoer");
check("onbekende staaf → NIET_GEVONDEN", faalt({ beamIds: [99] })?.code === "NIET_GEVONDEN");
check("onbekende knooplast → NIET_GEVONDEN", faalt({ nodalLoadIds: [7] })?.code === "NIET_GEVONDEN");
check("onbekend kenmerk → INVOER_ONGELDIG", faalt({ criteria: [{ property: "colour", mode: "keep", values: ["rood"] }] })?.code === "INVOER_ONGELDIG");
check("onbekende modus → INVOER_ONGELDIG", faalt({ criteria: [{ property: "profile", mode: "only", values: ["HEA 200"] }] })?.code === "INVOER_ONGELDIG");
check("onbekend type → INVOER_ONGELDIG", faalt({ criteria: [{ property: "type", mode: "keep", values: ["wall"] }] })?.code === "INVOER_ONGELDIG");
const omgekeerd = faalt({ criteria: [{ property: "length", mode: "keep", fromMm: 5000, toMm: 4000 }] });
check("lengte van > tot → INVOER_ONGELDIG", omgekeerd?.code === "INVOER_ONGELDIG" && omgekeerd.message.includes("groter"), omgekeerd?.message);
check("negatieve lengte → INVOER_ONGELDIG", faalt({ criteria: [{ property: "length", mode: "keep", fromMm: -1 }] })?.code === "INVOER_ONGELDIG");

console.log("\n[3] selectie zetten in de app");
const gezet = [];
const app = { zetSelectie3D: (selectie) => gezet.push(selectie) };
const metApp = doe({ beamIds: alleTien, criteria: [{ property: "profile", mode: "keep", values: ["HEA 200"] }], select: true }, { app });
check("select: de app krijgt de selectie (een groep van vijf staven)", gezet.length === 1 && gezet[0].type === "multi"
  && lijst(gezet[0].beamIds) === "1,4,6,8,10" && metApp.uitkomst.selectionApplied === true, JSON.stringify(gezet));
doe({ beamIds: [1], select: true }, { app });
check("één staaf over: een enkele selectie", JSON.stringify(gezet[1]) === '{"type":"beam","id":1}');
doe({ criteria: [{ property: "type", mode: "keep", values: ["load"] }], select: true }, { app });
check("twee lasten: een groep met de lasten per soort", gezet[2]?.type === "multi" && lijst(gezet[2].loads?.nodalLoad) === "1"
  && lijst(gezet[2].loads?.memberLoad) === "1", JSON.stringify(gezet[2]));
doe({ beamIds: [1], criteria: [{ property: "profile", mode: "keep", values: ["IPE 300"] }], select: true }, { app });
check("niets over: de selectie wordt opgeheven", gezet[3] === null);
check("zonder select zet de app niets", doe({ beamIds: [1] }, { app }).uitkomst.selectionApplied === false && gezet.length === 4);
check("buiten de app (sidecar): select zet niets en zegt dat", doe({ beamIds: [1], select: true }).uitkomst.selectionApplied === false);

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

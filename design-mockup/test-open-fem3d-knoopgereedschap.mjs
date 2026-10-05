// Oplegging- en veergereedschap in 3D (openFem3dNodeTools): een klik op een
// knoop geeft die knoop de voorwaarde; een klik in leeg canvas maakt daar een
// knoop op het werkvlak en zet er de voorwaarde op — samen één modelwijziging,
// dus één stap ongedaan maken. Veren krijgen de laatst gebruikte stijfheid.
// Plus de bedrading in lint, App, editor, tekenvlak en eigenschappenpaneel;
// App gebruikt dezelfde helper (openFem3DNodeToolClick) als de browserproef
// en roept setOpenFem3d precies één keer aan per klik.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Eenvoudige localStorage voor Node (de app gebruikt die van de browser).
const opslag = new Map();
globalThis.localStorage = {
  getItem: (k) => (opslag.has(k) ? opslag.get(k) : null),
  setItem: (k, v) => { opslag.set(k, String(v)); },
  removeItem: (k) => { opslag.delete(k); },
};

const {
  OPEN_FEM_3D_DEFAULT_SPRING_STIFFNESS, openFem3DNodeConditionOfTool, openFem3DNodeToolClick, placeOpenFem3DNodeCondition,
  readOpenFem3DSpringStiffness, rememberOpenFem3DSpringStiffness,
} = await import("./src/components/openFem3d/openFem3dNodeTools.ts");
const { parseOpenFem3DModel, OPEN_FEM_3D_SUPPORT_PRESETS } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { openFem3dHistoryReducer } = await import("./src/components/openFem3d/openFem3dHistory.ts");

const HIER = dirname(fileURLToPath(import.meta.url));
let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => { if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); } };

log("[1] gereedschap → voorwaarde");
check("support:pinned → oplegging scharnier", JSON.stringify(openFem3DNodeConditionOfTool("support:pinned")) === JSON.stringify({ kind: "support", preset: "pinned" }));
check("spring:kz → veer in Z", JSON.stringify(openFem3DNodeConditionOfTool("spring:kz")) === JSON.stringify({ kind: "spring", axis: "kz" }));
check("spring:kry → rotatieveer om Y", openFem3DNodeConditionOfTool("spring:kry")?.axis === "kry");
check("onbekend of ander gereedschap → geen voorwaarde",
  openFem3DNodeConditionOfTool("spring:kq") === null && openFem3DNodeConditionOfTool("support:zweven") === null
  && openFem3DNodeConditionOfTool("select") === null && openFem3DNodeConditionOfTool("addNode") === null);

log("\n[2] leeg canvas: nieuwe knoop op het werkvlak + voorwaarde, één stap");
const model = parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 4, x: 6, y: 0, z: 0 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 4 }],
});
const scharnier = { kind: "support", preset: "pinned" };
const geplaatst = placeOpenFem3DNodeCondition(model, { position: { x: 3, y: 2, z: 2.5 } }, scharnier, 0);
check("nieuwe knoop met het eerstvolgende nummer op de aangeklikte plek (werkvlak z = 2,5 m)",
  geplaatst.createdNode && geplaatst.nodeId === 5
  && JSON.stringify(geplaatst.model.nodes.at(-1)) === JSON.stringify({ id: 5, x: 3, y: 2, z: 2.5 }));
const oplegging = geplaatst.model.supports?.find((s) => s.nodeId === 5);
check("… met de gekozen oplegging", oplegging && ["ux", "uy", "uz", "rx", "ry", "rz"].every((k) => oplegging[k] === OPEN_FEM_3D_SUPPORT_PRESETS.pinned[k]));
check("het oorspronkelijke model blijft onaangeroerd", model.nodes.length === 2 && (model.supports ?? []).length === 0);
let historie = { model, past: [], future: [] };
historie = openFem3dHistoryReducer(historie, { type: "edit", model: geplaatst.model });
check("één historiestap", historie.past.length === 1);
historie = openFem3dHistoryReducer(historie, { type: "undo" });
check("één keer ongedaan maken haalt knoop én oplegging weg", historie.model === model);
const opKnoop = placeOpenFem3DNodeCondition(model, { position: { x: 6, y: 0, z: 0 } }, scharnier, 0);
check("valt het punt op een bestaande knoop, dan krijgt die de oplegging (geen dubbele knoop)",
  !opKnoop.createdNode && opKnoop.nodeId === 4 && opKnoop.model.nodes.length === 2);
const klikOpKnoop = placeOpenFem3DNodeCondition(model, { nodeId: 1 }, { kind: "support", preset: "fixed" }, 0);
check("klik op een bestaande knoop: zoals voorheen", !klikOpKnoop.createdNode && klikOpKnoop.model.supports?.[0]?.rz === true);

log("\n[3] veren: laatst gebruikte stijfheid, anders een redelijke beginwaarde");
check("beginwaarden: 10 kN/mm (10 000 kN/m) en 1000 kNm/rad",
  readOpenFem3DSpringStiffness("kz") === 10_000 && readOpenFem3DSpringStiffness("krx") === 1_000
  && OPEN_FEM_3D_DEFAULT_SPRING_STIFFNESS.ky === 10_000);
const veer = placeOpenFem3DNodeCondition(model, { position: { x: 1, y: 1, z: 0 } }, { kind: "spring", axis: "kz" }, readOpenFem3DSpringStiffness("kz"));
const veerOplegging = veer.model.supports?.find((s) => s.nodeId === veer.nodeId);
check("nieuwe knoop met een Z-veer van 10 000 kN/m, Z niet star", veerOplegging?.springs?.kzKnPerM === 10_000 && veerOplegging.uz === false);
rememberOpenFem3DSpringStiffness({ kzKnPerM: 25_000, kryKnmPerRad: 500 });
check("de laatst ingevulde waarde wordt de beginwaarde", readOpenFem3DSpringStiffness("kz") === 25_000 && readOpenFem3DSpringStiffness("kry") === 500
  && readOpenFem3DSpringStiffness("kx") === 10_000);
const tweede = placeOpenFem3DNodeCondition(veer.model, { nodeId: veer.nodeId }, { kind: "spring", axis: "kry" }, readOpenFem3DSpringStiffness("kry"));
const tweedeVeren = tweede.model.supports?.find((s) => s.nodeId === veer.nodeId)?.springs;
check("een tweede veer op dezelfde knoop laat de eerste staan", tweedeVeren?.kzKnPerM === 10_000 && tweedeVeren?.kryKnmPerRad === 500);

log("\n[3b] één klik zoals App hem verwerkt (openFem3DNodeToolClick)");
const klikVeer = openFem3DNodeToolClick(model, { position: { x: 2, y: 0, z: 0 } }, "spring:kz");
check("veergereedschap: nieuwe knoop met de laatst ingevulde stijfheid (25 000 kN/m), in één model",
  klikVeer?.nodeId === 5 && klikVeer.condition.kind === "spring"
  && klikVeer.model.supports?.find((s) => s.nodeId === 5)?.springs?.kzKnPerM === 25_000 && model.nodes.length === 2);
const klikHistorie = openFem3dHistoryReducer({ model, past: [], future: [] }, { type: "edit", model: klikVeer.model });
check("één stap ongedaan maken haalt knoop en veer weg", openFem3dHistoryReducer(klikHistorie, { type: "undo" }).model === model);
const klikOplegging = openFem3DNodeToolClick(model, { nodeId: 4 }, "support:fixed");
check("opleggingsgereedschap op knoop 4: inklemming, geen nieuwe knoop",
  klikOplegging?.nodeId === 4 && klikOplegging.model.nodes === model.nodes && klikOplegging.model.supports?.[0]?.rz === true);
check("geen voorwaarde-gereedschap of een verdwenen knoop → niets",
  openFem3DNodeToolClick(model, { nodeId: 1 }, "select") === null && openFem3DNodeToolClick(model, { nodeId: 99 }, "support:pinned") === null);

opslag.set("open-fem-studio.openFem3d.springStiffness", "{kapot");
check("onleesbare opslag → beginwaarde", readOpenFem3DSpringStiffness("kz") === 10_000);

log("\n[4] bedrading");
const lees = (...pad) => readFileSync(join(HIER, ...pad), "utf8").replace(/\r\n/g, "\n");
const lint = lees("src", "components", "ribbon", "HomeTab.tsx");
check("lint 3D: X-, Y- en Z-veer als gereedschap", /\(\["kx", "ky", "kz"\] as const\)\.map[\s\S]{0,500}active=\{openFem3dTool === `spring:\$\{axis\}`\}[\s\S]{0,120}onOpenFem3DSpringTool\?\.\(axis\)/.test(lint));
check("lint 3D: rotatieveren om X, Y en Z", /\(\["krx", "kry", "krz"\] as const\)\.map[\s\S]{0,500}onOpenFem3DSpringTool\?\.\(axis\)/.test(lint));
check("lint 2D: de drie veerknoppen blijven 2D-gereedschappen",
  /setTool\("addZSpring"\)/.test(lint) && /setTool\("addXSpring"\)/.test(lint) && /setTool\("addRotSpring"\)/.test(lint));
const app = lees("src", "App.tsx");
/** De tekst van handler `naam` in App.tsx, van `const naam = ` tot de afsluitende `};` op inspringing 2. */
const handler = (naam) => {
  const begin = app.indexOf(`  const ${naam} = `);
  const eind = begin < 0 ? -1 : app.indexOf("\n  };", begin);
  return eind < 0 ? "" : app.slice(begin, eind);
};
const aantal = (tekst, deel) => tekst.split(deel).length - 1;
const knoopHandler = handler("applyOpenFem3DNodeTool");
check("App: klik op knoop, staaf, plaat of werkvlak → openFem3DNodeToolClick, knoop geselecteerd",
  /onPlaceNodeCondition=\{\(target\) => applyOpenFem3DNodeTool\(target\)\}/.test(app)
  && /openFem3DNodeToolClick\(openFem3dHistoryRef\.current\.model, target, tool\);/.test(knoopHandler)
  && /setOpenFem3d\(placed\.model\);\n\s*setOpenFem3dSelection\(\{ type: "node", id: placed\.nodeId \}\)/.test(knoopHandler));
// Elke setOpenFem3d is een eigen historiestap; knoop en voorwaarde moeten er samen één zijn.
check("App: precies één modelwijziging per klik (één setOpenFem3d, geen andere dispatch)",
  aantal(knoopHandler, "setOpenFem3d(") === 1 && aantal(knoopHandler, "dispatchOpenFem3D(") === 0
  && aantal(knoopHandler, "setOpenFem3dHistoryState(") === 0, `${aantal(knoopHandler, "setOpenFem3d(")}× setOpenFem3d`);
check("App: bij een veer gaat de cursor naar het veerveld", /condition\.kind === "spring"[\s\S]{0,120}setOpenFem3dSpringEditorRequest/.test(app));
check("App: veerknop in het lint zet het gereedschap (en een geselecteerde knoop krijgt de veer)",
  /onOpenFem3DSpringTool=\{\(axis\) => \{[\s\S]{0,200}setOpenFem3dTool\(`spring:\$\{axis\}`\)[\s\S]{0,200}applyOpenFem3DNodeTool/.test(app));
const canvas = lees("src", "components", "openFem3d", "ThreeFrameCanvas.tsx");
// Sinds #76 kiest het gereedschap ook een staaf of plaat (chooseOpenFem3DPlacement,
// test-open-fem3d-plaatsen.mjs); zonder treffer blijft het het werkvlak met snap.
check("tekenvlak: knoop, staaf, plaat of leeg canvas (werkvlaksnap) naar onPlaceNodeCondition",
  /nodeCondition && placeNodeConditionRef\.current\) \{[\s\S]{0,900}placementTarget\(\)[\s\S]{0,200}drawingSnap\(\)[\s\S]{0,400}position:[\s\S]{0,400}placeNodeConditionRef\.current\(target\)/.test(canvas));
const paneel = lees("src", "components", "openFem3d", "OpenFem3DNodeConditions.tsx");
check("eigenschappenpaneel onthoudt de ingevulde veerstijfheid", /rememberOpenFem3DSpringStiffness\(springs\)/.test(paneel));
for (const taal of ["nl", "en", "de", "fr"]) {
  const lint3d = JSON.parse(readFileSync(join(HIER, "src", "i18n", "locales", taal, "ribbon.json"), "utf8")).openFem3d;
  check(`teksten ${taal}: Y-veer, rotatieveren X/Y/Z en de hulp bij veren`,
    ["ySpring", "rotSpringX", "rotSpringY", "rotSpringZ", "springPlacementHelp"].every((k) => typeof lint3d[k] === "string" && lint3d[k].length > 0));
}

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

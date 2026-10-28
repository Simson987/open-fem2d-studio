import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register as registerLoader } from "node:module";
import {
  openFem3DExplodedGrid, openFem3DExplodedMesh, openFem3DExplodedModel, normalizeOpenFem3DExplode,
  openFem3DExplodedResult, openFem3DExplodeSourceNodeId, openFem3DExplodeSourceSelection, openFem3DExplodeFromCommand,
  toggleOpenFem3DExplode, openFem3DExplodeNodeSteps,
} from "./src/components/openFem3d/openFem3dExplode.ts";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, normalizeOpenFem3DVisibility } from "./src/components/openFem3d/openFem3dVisibility.ts";
import { appRegister } from "./src/bediening/apiAdapter.ts";
import { openFem3DRapportBeeld } from "./src/components/openFem3d/openFem3dRapportBeeld.ts";

const model = {
  nodes: [
    { id: 1, x: 0, y: 0, z: 0, levelId: "ground" },
    { id: 2, x: 0, y: 0, z: 3, levelId: "floor" },
    { id: 3, x: 4, y: 0, z: 3, levelId: "floor" },
    { id: 4, x: 0, y: 0, z: 1.5 },
  ],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 2, endNodeId: 3 }],
  plates: [{ id: 1, nodeIds: [2, 3] }],
  supports: [{ nodeId: 1 }],
  loads: [{ id: 1, nodeId: 2, fx: 1 }],
  memberLoads: [{ id: 2, beamId: 1, startPositionM: 0, endPositionM: 3 }],
  memberPointLoads: [{ id: 3, beamId: 1, positionM: 1.5 }],
};
const levels = [{ id: "ground", label: "Ground", position: 0 }, { id: "floor", label: "Floor", position: 3000 }];
const exploded = openFem3DExplodedModel(model, levels, { mode: "levels", amountM: 2 });
assert.notEqual(exploded, model);
assert.deepEqual(exploded.nodes.map((node) => node.z), [0, 5, 5, 1.5]);
assert.equal(exploded.memberLoads[0].endPositionM, 5);
assert.equal(exploded.memberPointLoads[0].positionM, 2.5);
assert.equal(exploded.loads[0], model.loads[0]);
assert.deepEqual(model.nodes.map((node) => node.z), [0, 3, 3, 1.5]);
assert.equal(model.memberLoads[0].endPositionM, 3);
const grid = { zAxes: levels };
assert.deepEqual(openFem3DExplodedGrid(grid, { mode: "levels", amountM: 2 }).zAxes.map((axis) => axis.position), [0, 5000]);
assert.equal(grid.zAxes[1].position, 3000);
const mesh = { nodes: [{ id: 100, x: 2, y: 0, z: 3 }], elements: [] };
assert.equal(openFem3DExplodedMesh(mesh, model, levels, { mode: "levels", amountM: 2 }).nodes[0].z, 5);
const reportInput = { lagen: DEFAULT_OPEN_FEM_3D_VISIBILITY, view: "front", camera: null,
  resultaat: null, utilizations: [], loadCaseId: 1 };
const reportNormal = openFem3DRapportBeeld({ ...reportInput, model: { ...model, plates: [] } });
const reportExploded = openFem3DRapportBeeld({ ...reportInput, model: { ...exploded, plates: [] } });
assert.notDeepEqual(reportNormal.staven, reportExploded.staven);
assert.equal(openFem3DExplodedModel(model, levels, { mode: "levels", amountM: 0 }), model);
assert.deepEqual(openFem3DExplodedModel(model, [], { mode: "levels", amountM: 1 }).nodes.map((node) => node.z), [0, 5, 5, 2.5]);
assert.equal(normalizeOpenFem3DExplode({ mode: "levels", amountM: 100 }).amountM, 10);
assert.equal(normalizeOpenFem3DVisibility({}).explode.amountM, 0);
assert.equal(normalizeOpenFem3DVisibility({ ...DEFAULT_OPEN_FEM_3D_VISIBILITY, explode: { mode: "levels", amountM: 2 } }).explode.amountM, 2);

let gezetExplode = null;
const register = appRegister({ zetExplode3D: (value) => { gezetExplode = value; } });
const result = register.voerUit("app.view3d.explode", { mode: "levels", amountMm: 2500 }, {});
assert.deepEqual(result.uitkomst, { mode: "levels", amountMm: 2500 });
assert.deepEqual(gezetExplode, { mode: "levels", amountM: 2.5 });
assert.throws(() => register.voerUit("app.view3d.explode", { mode: "levels", amountMm: 10001 }, {}));
assert.throws(() => register.voerUit("app.view3d.explode", { mode: "levels", amountMm: 0, typo: true }, {}));
console.log("explode by level, unchanged analysis model, visibility and API: passed");

// ── Per elementsoort (issue #198) ───────────────────────────────────────────
// Portaal met vloerplaat: opleggingen 1 en 4 (z 0), kolommen 1-2 en 4-3,
// ligger 2-3 (z 3), plaat 2-3-6-5 op z 3, losse knoop 7. Afstand a = 2 m:
// opleggingen 0, kolommen +2, liggers +4, platen +6. Elk element schuift als
// geheel, dus elke staaf houdt zijn lengte en elk eind schuift stap × a.
{
  const a = 2;
  const portaal = {
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 3, levelId: "floor" }, { id: 3, x: 4, y: 0, z: 3 },
      { id: 4, x: 4, y: 0, z: 0 }, { id: 5, x: 0, y: 4, z: 3 }, { id: 6, x: 4, y: 4, z: 3 }, { id: 7, x: 9, y: 9, z: 1 },
    ],
    beams: [
      { id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 2, endNodeId: 3 }, { id: 3, startNodeId: 4, endNodeId: 3 },
    ],
    plates: [{ id: 1, nodeIds: [2, 3, 6, 5], boundary: [
      { kind: "line", startNodeId: 2, endNodeId: 3 }, { kind: "line", startNodeId: 3, endNodeId: 6 },
      { kind: "line", startNodeId: 6, endNodeId: 5 }, { kind: "line", startNodeId: 5, endNodeId: 2 },
    ], thicknessM: 0.2 }],
    supports: [{ nodeId: 1 }, { nodeId: 4 }],
    loads: [{ id: 1, nodeId: 2, fz: -10 }],
    memberLoads: [{ id: 1, beamId: 2, startPositionM: 0, endPositionM: 4 }],
    loadPanels: [{ id: 1, nodeIds: [2, 3, 6, 5] }],
  };
  const soort = { mode: "elementTypes", amountM: a };
  const stappen = openFem3DExplodeNodeSteps(portaal);
  assert.deepEqual([...stappen.entries()], [[1, 0], [2, 1], [3, 1], [4, 0], [5, 2], [6, 2], [7, 0]],
    "een knoop staat bij de laagste soort: oplegging, kolom, ligger (ook een belastingvlak), plaat; een losse knoop 0");
  const uit = openFem3DExplodedModel(portaal, levels, soort);
  const byId = new Map(uit.nodes.map((node) => [node.id, node]));
  const echt = new Map(portaal.nodes.map((node) => [node.id, node]));
  const stapVan = { 1: 1, 2: 2, 3: 1 };
  for (const beam of uit.beams) {
    const voor = portaal.beams.find((b) => b.id === beam.id);
    for (const [weer, bron] of [[beam.startNodeId, voor.startNodeId], [beam.endNodeId, voor.endNodeId]]) {
      const p = byId.get(weer), q = echt.get(bron);
      assert.equal(openFem3DExplodeSourceNodeId(weer), bron, `staaf ${beam.id}: weergaveknoop ${weer} hoort bij knoop ${bron}`);
      assert.deepEqual([p.x, p.y, p.z], [q.x, q.y, q.z + stapVan[beam.id] * a], `staaf ${beam.id}, knoop ${bron}`);
    }
  }
  assert.deepEqual(uit.beams.map((b) => [b.startNodeId, b.endNodeId]), [[-5, 2], [-10, -14], [-17, 3]]);
  // De echte knopen op hun laagste soort; de rest van het model blijft gelijk.
  assert.deepEqual(portaal.nodes.map((node) => byId.get(node.id).z), [0, 5, 5, 0, 7, 7, 1]);
  assert.equal(byId.get(-10).levelId, undefined, "een weergaveknoop hangt aan geen level");
  assert.deepEqual(uit.plates[0].nodeIds, [-11, -15, -27, -23]);
  assert.deepEqual(uit.plates[0].boundary.map((s) => [s.startNodeId, s.endNodeId]), [[-11, -15], [-15, -27], [-27, -23], [-23, -11]]);
  for (const id of uit.plates[0].nodeIds) assert.equal(byId.get(id).z, 3 + 3 * a, `plaatknoop ${id}`);
  assert.deepEqual(uit.loadPanels[0].nodeIds, [-10, -14, 6, 5], "een belastingvlak hoort bij de liggers");
  for (const id of uit.loadPanels[0].nodeIds) assert.equal(byId.get(id).z, 3 + 2 * a, `belastingvlakknoop ${id}`);
  assert.equal(uit.loads, portaal.loads, "knooplasten blijven bij de echte knoop");
  assert.equal(uit.memberLoads, portaal.memberLoads, "een staaf houdt zijn lengte: lastposities blijven");
  assert.equal(uit.supports, portaal.supports);
  assert.deepEqual(portaal.nodes.map((node) => node.z), [0, 3, 3, 0, 3, 3, 1], "het echte model verandert niet");
  assert.deepEqual(portaal.beams[0], { id: 1, startNodeId: 1, endNodeId: 2 });
  assert.equal(openFem3DExplodedModel(portaal, levels, { mode: "elementTypes", amountM: 0 }), portaal);
  // Een schoor onder 45 graden (|dz| = horizontaal) is een ligger; steiler een kolom.
  const schoor = openFem3DExplodeNodeSteps({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 3, y: 0, z: 3 }, { id: 3, x: 0, y: 1, z: 0 }, { id: 4, x: 0.5, y: 1, z: 3 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 3, endNodeId: 4 }],
  });
  assert.deepEqual([...schoor.values()], [2, 2, 1, 1]);
  // Het stramien blijft per elementsoort staan.
  const grid = { zAxes: levels };
  assert.equal(openFem3DExplodedGrid(grid, soort), grid);
  // Rekennet: alles op plaathoogte; modelknopen in het net staan er met hun eigen id bij.
  const mesh = { nodes: [{ id: 100, x: 2, y: 2, z: 3 }], elements: [{ id: 1, plateId: 1, nodeIds: [2, 3, 100, 5] }] };
  const net = openFem3DExplodedMesh(mesh, portaal, levels, soort);
  assert.deepEqual(net.nodes.map((node) => [node.id, node.z]), [[100, 9], [2, 9], [3, 9], [5, 9]]);
  assert.equal(mesh.nodes[0].z, 3);
  // Resultaat: de weergaveknopen krijgen de verplaatsing van hun bronknoop.
  const verplaatsing = (nodeId, uz) => ({ nodeId, ux: 0, uy: 0, uz, rx: 0, ry: 0, rz: 0 });
  const resultaat = { displacements: [1, 2, 3, 4, 5, 6].map((id) => verplaatsing(id, -id / 1000)), reactions: [] };
  const getoond = openFem3DExplodedResult(resultaat, portaal, uit, levels, soort);
  const uz = new Map(getoond.displacements.map((d) => [d.nodeId, d.uz]));
  for (const node of uit.nodes) {
    if (node.id !== 7) assert.equal(uz.get(node.id), -openFem3DExplodeSourceNodeId(node.id) / 1000, `knoop ${node.id}`);
  }
  assert.equal(resultaat.displacements.length, 6, "het echte resultaat verandert niet");
  assert.equal(openFem3DExplodedResult(resultaat, model, exploded, levels, { mode: "levels", amountM: 2 }), resultaat,
    "per level zonder rekennet: hetzelfde resultaat");
  // Kiezen van een weergaveknoop selecteert de echte knoop.
  assert.deepEqual(openFem3DExplodeSourceSelection({ type: "node", id: -14 }), { type: "node", id: 3 });
  assert.deepEqual(openFem3DExplodeSourceSelection({ type: "multi", nodeIds: [-10, 2, -14], beamIds: [2] }),
    { type: "multi", nodeIds: [2, 3], beamIds: [2] });
  const beam = { type: "beam", id: 2 };
  assert.equal(openFem3DExplodeSourceSelection(beam), beam);
  // Opslag, schakelaar en opdracht.
  assert.equal(normalizeOpenFem3DExplode({ mode: "elementTypes", amountM: 3 }).mode, "elementTypes");
  assert.equal(normalizeOpenFem3DExplode({ mode: "x", amountM: 3 }).mode, "levels");
  assert.deepEqual(toggleOpenFem3DExplode({ mode: "elementTypes", amountM: 0 }), { mode: "elementTypes", amountM: 2 });
  assert.deepEqual(toggleOpenFem3DExplode({ mode: "elementTypes", amountM: 3 }), { mode: "elementTypes", amountM: 0 });
  const nu = { mode: "levels", amountM: 1 };
  assert.deepEqual(openFem3DExplodeFromCommand({ mode: "elementTypes" }, nu), { mode: "elementTypes", amountM: 1 });
  assert.deepEqual(openFem3DExplodeFromCommand({ amount_mm: 2500 }, nu), { mode: "levels", amountM: 2.5 });
  assert.throws(() => openFem3DExplodeFromCommand({ amount: 2500 }, nu), /kent amount niet/);
  assert.throws(() => openFem3DExplodeFromCommand({ mode: "types" }, nu), /levels of elementTypes/);
  assert.throws(() => openFem3DExplodeFromCommand({ amount_mm: 10001 }, nu), /0 tot 10000/);
  assert.throws(() => openFem3DExplodeFromCommand([], nu), /object/);
  const r2 = register.voerUit("app.view3d.explode", { mode: "elementTypes", amountMm: 1500 }, {});
  assert.deepEqual(r2.uitkomst, { mode: "elementTypes", amountMm: 1500 });
  assert.deepEqual(gezetExplode, { mode: "elementTypes", amountM: 1.5 });
  assert.throws(() => register.voerUit("app.view3d.explode", { mode: "types", amountMm: 1500 }, {}));
}

// ── gui_configure_3d_view: explode (issue #198) ─────────────────────────────
registerLoader(
  "data:text/javascript," + encodeURIComponent(
    "export async function load(url, ctx, next) {"
    + " if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };"
    + " return next(url, ctx); }"),
);
{
  const { voerUit } = await import("./src/bediening/bediening.ts");
  const gezet = [];
  const acties = {
    modelDimension: "3d",
    openFem3d: {
      model, selection: null, visibility: { ...DEFAULT_OPEN_FEM_3D_VISIBILITY },
      setVisibility(next) { gezet.push(next); this.visibility = next; },
    },
  };
  const voer = (args) => voerUit("weergave_3d_configureren", args, { current: acties }, () => new Promise(() => {}), () => Promise.resolve());
  const uit = await voer({ explode: { mode: "elementTypes", amount_mm: 3000 } });
  assert.equal(gezet.length, 1);
  assert.deepEqual(gezet[0].explode, { mode: "elementTypes", amountM: 3 });
  assert.deepEqual(uit.zichtbaarheid.explode, { mode: "elementTypes", amountM: 3 });
  await voer({ visibility: { nodes: false }, explode: { amount_mm: 0 } });
  assert.equal(gezet.length, 2, "samen met de zichtbaarheid in één keer");
  assert.equal(gezet[1].nodes, false);
  assert.deepEqual(gezet[1].explode, { mode: "elementTypes", amountM: 0 }, "wat ontbreekt blijft");
  await assert.rejects(voer({ visibility: { nodes: true }, explode: { mode: "elementTypes", distance: 1 } }), /kent distance niet/);
  assert.equal(gezet.length, 2, "een fout laat alles staan");
  const gui = readFileSync(new URL("../src-tauri/crates/openaec-mcp-server/src/gui_tools.rs", import.meta.url), "utf8");
  assert.match(gui, /"explode": \{ "type": "object", "additionalProperties": false/, "strikt MCP-schema");
  assert.match(gui, /"mode":\{"type":"string","enum":\["levels","elementTypes"\]\}/);
  assert.match(gui, /"amount_mm":\{"type":"number","minimum":0,"maximum":10000\}/);
}
console.log("explode by element type (supports 0, columns a, beams 2a, plates 3a), selection, result, command and MCP schema: passed");

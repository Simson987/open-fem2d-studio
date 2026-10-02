import assert from "node:assert/strict";
import { addOpenFem3DPlate, addOpenFem3DPlateOpening } from "./src/components/openFem3d/openFem3dModel.ts";
import { openFem3DHistoryExtern, openFem3dHistoryReducer } from "./src/components/openFem3d/openFem3dHistory.ts";

const initial = { nodes: [
  { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 },
  { id: 3, x: 4, y: 4, z: 0 }, { id: 4, x: 0, y: 4, z: 0 },
], beams: [] };
const plateModel = addOpenFem3DPlate(initial, [1, 2, 3, 4], { thicknessM: 0.2, material: "C30/37" });
const openingNodes = [
  { id: 5, x: 1, y: 1, z: 0 }, { id: 6, x: 3, y: 1, z: 0 },
  { id: 7, x: 3, y: 3, z: 0 }, { id: 8, x: 1, y: 3, z: 0 },
];
const edit = (state, model, historyGroup, cancelHistoryGroup = false) =>
  openFem3dHistoryReducer(state, { type: "edit", model, historyGroup, cancelHistoryGroup });

let state = { model: plateModel, past: [], future: [] };
for (const node of openingNodes) {
  state = edit(state, { ...state.model, nodes: [...state.model.nodes, node] }, "opening-1");
}
state = edit(state, addOpenFem3DPlateOpening(state.model, 1, [5, 6, 7, 8]), "opening-1");
assert.equal(state.past.length, 1, "een getekende contour krijgt één herstelpunt");
assert.equal(state.model.plates[0].openings.length, 1);
state = openFem3dHistoryReducer(state, { type: "undo" });
assert.equal(state.model.nodes.length, 4, "Ongedaan maken verwijdert ook de contourknopen");
assert.equal(state.model.plates[0].openings?.length ?? 0, 0);
state = openFem3dHistoryReducer(state, { type: "redo" });
assert.equal(state.model.nodes.length, 8);
assert.equal(state.model.plates[0].openings.length, 1);

state = edit(state, { ...state.model, nodes: [...state.model.nodes, { id: 9, x: 2, y: 2, z: 0 }] }, "opening-2");
state = edit(state, { ...state.model, nodes: state.model.nodes.slice(0, -1) }, "opening-2", true);
assert.equal(state.past.length, 1, "annuleren van een contour laat geen lege herstelstap achter");
assert.equal(state.model.nodes.length, 8);

const beamModel = { ...state.model, beams: [{ id: 1, startNodeId: 1, endNodeId: 2, material: "S235", profileName: "IPE 200" }] };
state = edit(state, beamModel);
assert.equal(state.past.length, 2, "een losse wijziging houdt een eigen herstelstap");
state = openFem3dHistoryReducer(state, { type: "undo" });
assert.equal(state.model.beams.length, 0);
assert.equal(state.model.plates[0].openings.length, 1);

console.log("3D contourgeschiedenis: tekenen, annuleren en herstel zijn consistent");

// Een stap die ook iets buiten het 3D-model wijzigt, bijvoorbeeld een
// belastinggeval verwijderen (de gevallen staan in de raamwerkstore), is één
// stap: undo geeft de terug-actie, redo de vooruit-actie (#91).
{
  const extern = { terug: () => "terug", vooruit: () => "vooruit" };
  const zonderLasten = { ...beamModel, loads: [] };
  let s = { model: beamModel, past: [], future: [] };
  assert.equal(openFem3DHistoryExtern(s, "undo"), null, "geen stap, geen externe actie");
  s = openFem3dHistoryReducer(s, { type: "edit", model: zonderLasten, extern });
  assert.equal(s.past.length, 1);
  assert.equal(openFem3DHistoryExtern(s, "undo"), extern.terug, "undo zet ook de gevallen terug");
  s = openFem3dHistoryReducer(s, { type: "undo" });
  assert.equal(s.model, beamModel);
  assert.equal(openFem3DHistoryExtern(s, "undo"), null);
  assert.equal(openFem3DHistoryExtern(s, "redo"), extern.vooruit, "redo voert de gevallenwijziging weer uit");
  s = openFem3dHistoryReducer(s, { type: "redo" });
  assert.equal(s.model, zonderLasten);
  assert.equal(openFem3DHistoryExtern(s, "undo"), extern.terug);

  // Zonder 3D-lasten van dat geval blijft het model gelijk, maar het is wel een stap.
  const leeg = openFem3dHistoryReducer({ model: beamModel, past: [], future: [] }, { type: "edit", model: beamModel, extern });
  assert.equal(leeg.past.length, 1, "alleen de gevallen veranderen: toch één stap");
  assert.equal(openFem3DHistoryExtern(leeg, "undo"), extern.terug);

  // Een gewone stap erna heeft geen externe actie; de oude blijft op zijn plek.
  s = openFem3dHistoryReducer(s, { type: "edit", model: { ...zonderLasten, beams: [] } });
  assert.equal(openFem3DHistoryExtern(s, "undo"), null, "een gewone stap erft de externe actie niet");
  s = openFem3dHistoryReducer(s, { type: "undo" });
  assert.equal(openFem3DHistoryExtern(s, "undo"), extern.terug, "na één undo is de stap met de gevallen weer de laatste");

  // Een externe stap gaat nooit op in een tekengroep.
  let g = { model: beamModel, past: [], future: [] };
  g = openFem3dHistoryReducer(g, { type: "edit", model: { ...beamModel, loads: [] }, historyGroup: "schets" });
  g = openFem3dHistoryReducer(g, { type: "edit", model: { ...beamModel, beams: [] }, historyGroup: "schets", extern });
  assert.equal(g.past.length, 2, "de stap met de gevallen is een eigen stap");
  assert.equal(openFem3DHistoryExtern(g, "undo"), extern.terug);

  // Vervangen (nieuw project, openen) wist alles.
  g = openFem3dHistoryReducer(g, { type: "replace", model: initial });
  assert.equal(openFem3DHistoryExtern(g, "undo"), null);
  assert.equal(openFem3DHistoryExtern(g, "redo"), null);
}
console.log("3D-geschiedenis: een stap met een externe wijziging (gevallen) is één stap, in beide richtingen");

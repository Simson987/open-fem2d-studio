import assert from "node:assert/strict";
import { addFrame3DPlate, addFrame3DPlateOpening } from "./src/components/frame3d/frame3dModel.ts";
import { frame3dHistoryReducer } from "./src/components/frame3d/frame3dHistory.ts";

const initial = { nodes: [
  { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 },
  { id: 3, x: 4, y: 4, z: 0 }, { id: 4, x: 0, y: 4, z: 0 },
], beams: [] };
const plateModel = addFrame3DPlate(initial, [1, 2, 3, 4], { thicknessM: 0.2, material: "C30/37" });
const openingNodes = [
  { id: 5, x: 1, y: 1, z: 0 }, { id: 6, x: 3, y: 1, z: 0 },
  { id: 7, x: 3, y: 3, z: 0 }, { id: 8, x: 1, y: 3, z: 0 },
];
const edit = (state, model, historyGroup, cancelHistoryGroup = false) =>
  frame3dHistoryReducer(state, { type: "edit", model, historyGroup, cancelHistoryGroup });

let state = { model: plateModel, past: [], future: [] };
for (const node of openingNodes) {
  state = edit(state, { ...state.model, nodes: [...state.model.nodes, node] }, "opening-1");
}
state = edit(state, addFrame3DPlateOpening(state.model, 1, [5, 6, 7, 8]), "opening-1");
assert.equal(state.past.length, 1, "een getekende contour krijgt één herstelpunt");
assert.equal(state.model.plates[0].openings.length, 1);
state = frame3dHistoryReducer(state, { type: "undo" });
assert.equal(state.model.nodes.length, 4, "Ongedaan maken verwijdert ook de contourknopen");
assert.equal(state.model.plates[0].openings?.length ?? 0, 0);
state = frame3dHistoryReducer(state, { type: "redo" });
assert.equal(state.model.nodes.length, 8);
assert.equal(state.model.plates[0].openings.length, 1);

state = edit(state, { ...state.model, nodes: [...state.model.nodes, { id: 9, x: 2, y: 2, z: 0 }] }, "opening-2");
state = edit(state, { ...state.model, nodes: state.model.nodes.slice(0, -1) }, "opening-2", true);
assert.equal(state.past.length, 1, "annuleren van een contour laat geen lege herstelstap achter");
assert.equal(state.model.nodes.length, 8);

const beamModel = { ...state.model, beams: [{ id: 1, startNodeId: 1, endNodeId: 2, material: "S235", profileName: "IPE 200" }] };
state = edit(state, beamModel);
assert.equal(state.past.length, 2, "een losse wijziging houdt een eigen herstelstap");
state = frame3dHistoryReducer(state, { type: "undo" });
assert.equal(state.model.beams.length, 0);
assert.equal(state.model.plates[0].openings.length, 1);

console.log("3D contourgeschiedenis: tekenen, annuleren en herstel zijn consistent");

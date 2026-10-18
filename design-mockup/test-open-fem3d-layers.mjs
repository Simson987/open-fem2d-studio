import assert from "node:assert/strict";
import { parseOpenFem3DModel } from "./src/components/openFem3d/openFem3dModel.ts";
import { addOpenFem3DLayer, assignOpenFem3DSelectionToLayer, changedLockedOpenFem3DLayer, openFem3DSelectionForLayer,
  removeOpenFem3DLayer, updateOpenFem3DLayer } from "./src/components/openFem3d/openFem3dLayers.ts";
import { openFem3dHistoryReducer } from "./src/components/openFem3d/openFem3dHistory.ts";
import { buildOpenFem3DSolveRequest } from "./src/components/openFem3d/openFem3dSolver.ts";
import { documentNaarTekst, documentUitTekst, leegDocument, metModel3d } from "./src/api/projectDocument.ts";

const geometry = () => ({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, material: "S235", profileName: "IPE 200" }],
  supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
  loads: [{ id: 1, nodeId: 2, fx: 0, fy: 0, fz: -1, mx: 0, my: 0, mz: 0 }],
});

const old = parseOpenFem3DModel(geometry());
assert.equal(old.layers, undefined);
assert.equal(old.beams[0].layerId, undefined);

const added = addOpenFem3DLayer(old, "Constructie", "#AABBCC");
assert.deepEqual(added.layers.map((layer) => layer.id), [0, 1]);
assert.equal(added.layers[1].color, "#aabbcc");
const onLayer = parseOpenFem3DModel({ ...added,
  nodes: added.nodes.map((node) => node.id === 2 ? { ...node, layerId: 1 } : node),
  beams: [{ ...added.beams[0], layerId: 1 }],
  loads: [{ ...added.loads[0], layerId: 1 }],
});
assert.deepEqual(openFem3DSelectionForLayer(onLayer, 1), {
  type: "multi", nodeIds: [2], beamIds: [1], loads: { nodalLoad: [1] },
});

const hidden = updateOpenFem3DLayer(onLayer, 1, { visible: false, locked: true });
assert.equal(hidden.layers[1].visible, false);
assert.equal(hidden.layers[1].locked, true);
const beamEdit = { ...hidden, beams: [{ ...hidden.beams[0], profileName: "IPE 220" }] };
assert.equal(changedLockedOpenFem3DLayer(hidden, beamEdit)?.id, 1);
const state = { model: hidden, past: [], future: [] };
assert.equal(openFem3dHistoryReducer(state, { type: "edit", model: beamEdit }), state,
  "een wijziging aan een vergrendelde staaf komt niet in de geschiedenis");
assert.equal(openFem3dHistoryReducer(state, { type: "edit", model: beamEdit, ignoreLayerLocks: true }).model, beamEdit,
  "een expliciete vervanging van het hele model blijft mogelijk");
assert.equal(changedLockedOpenFem3DLayer(hidden, { ...hidden,
  beams: [{ ...hidden.beams[0], layerId: undefined }] })?.id, 1,
"ook verplaatsen uit een vergrendelde laag wordt geweigerd");
assert.equal(changedLockedOpenFem3DLayer(hidden, { ...hidden,
  nodes: hidden.nodes.map((node) => node.id === 1 ? { ...node, x: 1 } : node) }), null,
"objecten op een andere laag blijven bewerkbaar");
assert.equal(changedLockedOpenFem3DLayer(hidden, { ...hidden,
  nodes: hidden.nodes.map((node) => node.id === 1 ? { ...node, layerId: 1 } : node) })?.id, 1,
"ook toevoegen aan een vergrendelde laag wordt geweigerd");
assert.equal(changedLockedOpenFem3DLayer(hidden, updateOpenFem3DLayer(hidden, 1, { locked: false })), null,
"ontgrendelen blijft mogelijk");
const unlockedState = openFem3dHistoryReducer(state, {
  type: "edit", model: updateOpenFem3DLayer(hidden, 1, { locked: false }),
});
assert.equal(unlockedState.model.layers[1].locked, false);
assert.equal(openFem3dHistoryReducer(unlockedState, { type: "undo" }).model.layers[1].locked, true);
const saved = documentUitTekst(documentNaarTekst(metModel3d(leegDocument(), hidden)));
assert.deepEqual(saved.model3d, hidden, "lagen en toewijzingen overleven het projectbestand");
assert.deepEqual(buildOpenFem3DSolveRequest(hidden, "linear", 1), buildOpenFem3DSolveRequest(old, "linear", 1),
  "lagen veranderen de berekening niet");

assert.throws(() => parseOpenFem3DModel({ ...onLayer, beams: [{ ...onLayer.beams[0], layerId: 99 }] }), /ontbrekende laag/);
assert.throws(() => parseOpenFem3DModel({ ...onLayer, layers: [...onLayer.layers, { ...onLayer.layers[1] }] }), /dubbele/);
assert.throws(() => updateOpenFem3DLayer(onLayer, 1, { color: "geen-kleur" }), /ongeldige/);
assert.throws(() => addOpenFem3DLayer(onLayer, "constructie"), /dubbele/);
assert.throws(() => assignOpenFem3DSelectionToLayer(hidden, { type: "beam", id: 1 }, 1), /vergrendeld/);
const moved = assignOpenFem3DSelectionToLayer(onLayer, { type: "multi", nodeIds: [1], beamIds: [],
  loads: { nodalLoad: [1] } }, 1);
assert.equal(moved.nodes[0].layerId, 1);
assert.equal(moved.loads[0].layerId, 1);
const removed = parseOpenFem3DModel(removeOpenFem3DLayer(moved, 1));
assert.equal(removed.layers.length, 1);
assert.ok(removed.nodes.every((node) => node.layerId === undefined));
assert.ok(removed.beams.every((beam) => beam.layerId === undefined));
assert.throws(() => removeOpenFem3DLayer(moved, 0), /standaardlaag/);
console.log("  ✓ 3D-lagen: oude modellen, projectbestand, selectie, invoerpoort en ongewijzigde solverinvoer");

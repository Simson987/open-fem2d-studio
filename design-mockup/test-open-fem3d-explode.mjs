import assert from "node:assert/strict";
import { openFem3DExplodedGrid, openFem3DExplodedMesh, openFem3DExplodedModel, normalizeOpenFem3DExplode } from "./src/components/openFem3d/openFem3dExplode.ts";
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

let amountM = -1;
const register = appRegister({ zetExplode3D: (value) => { amountM = value; } });
const result = register.voerUit("app.view3d.explode", { mode: "levels", amountMm: 2500 }, {});
assert.deepEqual(result.uitkomst, { mode: "levels", amountMm: 2500 });
assert.equal(amountM, 2.5);
assert.throws(() => register.voerUit("app.view3d.explode", { mode: "levels", amountMm: 10001 }, {}));
assert.throws(() => register.voerUit("app.view3d.explode", { mode: "levels", amountMm: 0, typo: true }, {}));
console.log("explode by level, unchanged analysis model, visibility and API: passed");

import assert from "node:assert/strict";
import { openFem3DForceStations } from "./src/components/openFem3d/openFem3dForceStations.ts";

const line = (memberId, values) => ({
  memberId,
  points: values.map(([t, value]) => ({ t, value })),
  maxValue: Math.max(...values.map(([, value]) => value)),
  minValue: Math.min(...values.map(([, value]) => value)),
  maxAbsValue: Math.max(...values.map(([, value]) => Math.abs(value))),
});

const result = {
  memberForces: [{
    memberId: 7, lengthM: 4,
    nStartKn: -10, nEndKn: -10,
    vyStartKn: 0, vyEndKn: 0,
    vzStartKn: 8, vzEndKn: -8,
    torsionStartKnm: 0, torsionEndKnm: 0,
    myStartKnm: 0, myEndKnm: 0,
    mzStartKnm: 0, mzEndKnm: 0,
  }],
  diagrams: {
    axial: [line(7, [[0, -10], [1, -10]])],
    shearY: [line(7, [[0, 0], [1, 0]])],
    shearZ: [line(7, [[0, 8], [0.5, 0], [1, -8]])],
    torsion: [line(7, [[0, 0], [1, 0]])],
    momentY: [line(7, [[0, 0], [0.5, 8], [1, 0]])],
    momentZ: [line(7, [[0, 0], [1, 0]])],
  },
};

const stations = openFem3DForceStations(result, 7, 42);
assert.deepEqual(stations.map((station) => station.position_mm), [0, 2000, 4000]);
assert.ok(stations.every((station) => station.combination_id === 42));
assert.equal(stations[1].forces.my_ed, 8,
  "de normtoets moet het veldmoment meenemen, ook als beide eindmomenten nul zijn");
assert.equal(stations[1].forces.vz_ed, 0);
assert.equal(stations[1].forces.n_ed, -10);

console.log("3D solverstations naar normtoets: geslaagd");

import assert from "node:assert/strict";
import { facadeWindBands } from "./src/components/openFem3d/openFem3dWindZones.ts";

const long = facadeWindBands(10, 20, 5);
assert.equal(long.eM, 10);
assert.deepEqual(long.sides.map(({ zone, fromM, toM }) => [zone, fromM, toM]),
  [["A", 0, 2], ["B", 2, 10], ["C", 10, 20]]);
assert.equal(long.windward.cpe10, 0.7);
assert.equal(long.leeward.cpe10, -0.3);
assert.equal(long.sides[0].cpe10, -1.2);
assert.deepEqual(facadeWindBands(10, 1, 5).sides.map((band) => band.zone), ["A"]);
assert.deepEqual(facadeWindBands(10, 3, 5).sides.map((band) => band.zone), ["A", "B"]);
assert.throws(() => facadeWindBands(10, 0, 5), /positief/);
console.log("3D-windzones: controles geslaagd");

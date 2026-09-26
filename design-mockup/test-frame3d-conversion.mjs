import assert from "node:assert/strict";
import { convert2DTo3D } from "./src/components/frame3d/convert2DTo3D.ts";

const base = {
  nodes: [
    { id: 1, x: 0, z: 0 },
    { id: 2, x: 4000, z: 0 },
    { id: 3, x: 0, z: 1000 },
  ],
  beams: [
    { id: 1, from: 1, to: 2 },
    { id: 2, from: 2, to: 3 },
  ],
  supports: [],
};

const converted = convert2DTo3D({
  ...base,
  loads: [
    { id: 1, type: "lineLoad", caseId: 2, beamId: 1, qStart: -4, qEnd: -6, startFrac: 0.25, endFrac: 0.75 },
    { id: 2, type: "pointForce", caseId: 3, nodeId: 2, fx: 3, fz: -5 },
    { id: 3, type: "pointForce", caseId: 2, beamId: 1, posFrac: 0.5, fx: 0, fz: -10 },
    { id: 4, type: "thermal", caseId: 4, beamId: 1, deltaT: 28 },
  ],
});
assert.equal(converted.skippedLoadCount, 0);
assert.deepEqual(converted.model.loads, [{
  id: 2, nodeId: 2, caseId: 3, fx: 3, fy: 0, fz: -5, mx: 0, my: 0, mz: 0,
}]);
assert.deepEqual(converted.model.memberPointLoads, [{
  id: 3, beamId: 1, caseId: 2, py: 0, pz: -10, positionM: 2,
}]);
assert.deepEqual(converted.model.memberLoads, [{
  id: 1,
  beamId: 1,
  caseId: 2,
  qyStart: 0,
  qyEnd: 0,
  qzStart: -4,
  qzEnd: -6,
  startPositionM: 1,
  endPositionM: 3,
}]);
assert.deepEqual(converted.model.thermalLoads, [{
  id: 4, beamId: 1, caseId: 4,
  deltaTUniformK: 28, deltaTGradientYK: 0, deltaTGradientZK: 0,
}]);

// Een lokale dwarslast blijft dezelfde fysieke vector wanneer de staaf naar
// links loopt; het teken in het Z-up 3D-lokale assenstelsel wordt zo nodig
// omgekeerd.
const reverseInclined = convert2DTo3D({
  nodes: [{ id: 1, x: 1000, z: 0 }, { id: 2, x: 0, z: 1000 }],
  beams: [{ id: 1, from: 1, to: 2 }],
  supports: [],
  loads: [{ id: 8, type: "lineLoad", caseId: 1, beamId: 1, q: -2, qCoord: "local", qDir: "z" }],
});
assert.equal(reverseInclined.skippedLoadCount, 0);
assert.ok(Math.abs(reverseInclined.model.memberLoads[0].qzStart - 2) < 1e-12);
assert.ok(Math.abs(reverseInclined.model.memberLoads[0].qzEnd - 2) < 1e-12);

// De huidige 3D-kern heeft geen axiale staaflast. Een globale verticale last
// op een schuine staaf wordt daarom herkenbaar overgeslagen.
const axialComponent = convert2DTo3D({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 1000, z: 1000 }],
  beams: [{ id: 1, from: 1, to: 2 }],
  supports: [],
  loads: [{ id: 9, type: "lineLoad", caseId: 1, beamId: 1, q: -1, qCoord: "global", qDir: "z" }],
});
assert.equal(axialComponent.skippedLoadCount, 1);
assert.equal(axialComponent.model.memberLoads.length, 0);

const springSupports = convert2DTo3D({
  ...base,
  supports: [
    { nodeId: 1, type: "xSpring", k: 2.5 },
    { nodeId: 2, type: "zSpring", k: 3.75 },
    { nodeId: 3, type: "rotSpring", k: 450 },
  ],
  loads: [],
});
assert.equal(springSupports.skippedSupportCount, 0);
assert.deepEqual(springSupports.model.supports.map((support) => support.springs), [
  { kxKnPerM: 2500 }, { kzKnPerM: 3750 }, { kryKnmPerRad: 450 },
]);

console.log("frame3d-conversion: ok");

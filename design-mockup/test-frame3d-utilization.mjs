import assert from "node:assert/strict";
import {
  buildFrame3DUtilizations,
  frame3DUtilizationClass,
} from "./src/components/frame3d/frame3dUtilization.ts";

const namedCheck = (id, uc) => ({ id, kind: { data: { uc: { uc } } } });
const steel = {
  results: [{
    beam_id: 3,
    status: "Ok",
    checks: [namedCheck("cross_section", 0.62), namedCheck("deflection_total", 1.4)],
  }],
  skipped: [],
  notes: [],
};
const concrete = {
  results: [
    { beam_id: 7, status: "NotOk", uc_max: 1.08 },
    { beam_id: 9, status: "NotApplicable", uc_max: 0.2 },
  ],
  skipped: [],
  notes: [],
};

const values = buildFrame3DUtilizations(steel, concrete);
assert.deepEqual(values.map((value) => value.beamId), [3, 7, 9]);
assert.equal(values[0].standard, "EN 1993");
assert.equal(values[0].uc, 0.62, "BGT-doorbuiging mag de UGT-kleur niet bepalen");
assert.equal(values[1].standard, "EN 1992");
assert.equal(frame3DUtilizationClass(values[0]), "medium");
assert.equal(frame3DUtilizationClass(values[1]), "fail");
assert.equal(frame3DUtilizationClass(values[2]), "not-applicable");
assert.equal(frame3DUtilizationClass({ beamId: 1, uc: 0.81, status: "Ok", standard: "EN 1992" }), "high");
assert.equal(frame3DUtilizationClass({ beamId: 1, uc: 0.5, status: "Ok", standard: "EN 1993" }), "low");

console.log("3D unity-checklaag voor EN 1992 en EN 1993: geslaagd");

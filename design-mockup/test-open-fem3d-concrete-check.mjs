import assert from "node:assert/strict";
import { STANDAARD_KORF } from "./src/components/beton/wapeningskorf.ts";
import { convert2DTo3D } from "./src/components/openFem3d/convert2DTo3D.ts";
import { buildOpenFem3DConcreteCheckInputs } from "./src/components/openFem3d/openFem3dConcreteCheck.ts";
import { parseOpenFem3DModel } from "./src/components/openFem3d/openFem3dModel.ts";

const checkConfig = {
  betonKorf: STANDAARD_KORF.korf,
  betonMilieuklasse: "XC3",
  betonConstructieklasse: "S4",
  betonKolom: {
    bracing: "Geschoord",
    buckling_length: { soort: "Figuur57", geval: "ScharnierendScharnierend" },
    bracing_z: "Ongeschoord",
    buckling_length_z: { soort: "Figuur57", geval: "Console" },
    phi_inf_t0: 1.8,
  },
};
const model = {
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 3 }],
  beams: [{ id: 7, startNodeId: 1, endNodeId: 2, profileName: "300x500", material: "C30/37", checkConfig }],
  supports: [], loads: [],
};
const result = {
  memberForces: [{
    memberId: 7, lengthM: 3,
    nStartKn: -400, nEndKn: -400,
    vyStartKn: 20, vyEndKn: -20,
    vzStartKn: 30, vzEndKn: -30,
    torsionStartKnm: 4, torsionEndKnm: 4,
    myStartKnm: 45, myEndKnm: -30,
    mzStartKnm: 15, mzEndKnm: -10,
  }],
};

const built = buildOpenFem3DConcreteCheckInputs(model, result);
assert.equal(built.skipped.length, 0);
assert.equal(built.inputs.length, 1);
const input = built.inputs[0];
assert.equal(input.beam_id, 7);
assert.equal(input.concrete_class, "C30/37");
assert.deepEqual(input.section, {
  shape: "Rectangle", b_mm: 300, h_mm: 500,
  b_w_mm: null, h_f_mm: null, flange_at_bottom: false,
});
assert.equal(input.cage, checkConfig.betonKorf);
assert.equal(input.column, checkConfig.betonKolom);
assert.deepEqual(input.forces_envelope[0].forces, {
  n_ed: -400, vy_ed: 20, vz_ed: 30, mt_ed: 4, my_ed: 45, mz_ed: 15,
});
assert.deepEqual(input.forces_envelope[1].forces, {
  n_ed: -400, vy_ed: -20, vz_ed: -30, mt_ed: 4, my_ed: -30, mz_ed: -10,
});
assert.deepEqual(input.sls_frequent_envelope, []);
assert.deepEqual(input.sls_quasi_permanent_envelope, []);
assert.ok(built.notes.some((note) => note.includes("torsie")));
assert.ok(built.notes.some((note) => note.includes("My en Vz")));
assert.ok(built.notes.some((note) => note.includes("§5.8")));

const scaledResult = (scale) => ({
  ...result,
  memberForces: result.memberForces.map((member) => Object.fromEntries(
    Object.entries(member).map(([key, value]) =>
      [key, typeof value === "number" && key !== "memberId" && key !== "lengthM" ? value * scale : value]),
  )),
});
const combinations = [
  { id: 10, name: "UGT 6.10b", type: "uls", formula: "", factors: new Map([[1, 1.35]]) },
  { id: 20, name: "BGT frequent 6.15b", type: "sls", formula: "", factors: new Map([[1, 1]]) },
  { id: 30, name: "BGT quasi-blijvend 6.16b", type: "sls", formula: "", factors: new Map([[1, 0.3]]) },
];
const withCombinations = buildOpenFem3DConcreteCheckInputs(model, result, {
  combinations,
  results: new Map([[10, scaledResult(1.35)], [20, scaledResult(1)], [30, scaledResult(0.3)]]),
});
const combinationInput = withCombinations.inputs[0];
assert.deepEqual([...new Set(combinationInput.forces_envelope.map((point) => point.combination_id))], [10]);
assert.equal(combinationInput.forces_envelope[0].forces.n_ed, -540, "UGT-krachten komen uit de doorgerekende combinatie");
assert.deepEqual([...new Set(combinationInput.sls_frequent_envelope.map((point) => point.combination_id))], [20]);
assert.deepEqual([...new Set(combinationInput.sls_quasi_permanent_envelope.map((point) => point.combination_id))], [30]);
assert.equal(combinationInput.sls_quasi_permanent_envelope[0].forces.my_ed, 13.5);
assert.ok(withCombinations.notes.some((note) => note.includes("6.15b")));

const roundTrip = parseOpenFem3DModel(JSON.parse(JSON.stringify(model)));
assert.deepEqual(roundTrip.beams[0].checkConfig, checkConfig, "wapening en duurzaamheid moeten in het 3D-projectbestand blijven");

const converted = convert2DTo3D({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: 3000 }],
  beams: [{ id: 7, from: 1, to: 2, profile: "300x500", material: "C30/37", checkConfig }],
  supports: [], loads: [],
});
assert.deepEqual(converted.model.beams[0].checkConfig, checkConfig, "2D naar 3D mag de wapeningskorf niet verliezen");

const missingCage = buildOpenFem3DConcreteCheckInputs({
  ...model,
  beams: [{ ...model.beams[0], checkConfig: undefined }],
}, result);
assert.equal(missingCage.inputs.length, 0);
assert.match(missingCage.skipped[0].reason, /wapeningskorf/);

console.log("3D EN 1992 invoer, zes krachten en wapeningsroundtrip: geslaagd");

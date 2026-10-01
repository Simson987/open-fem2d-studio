import assert from "node:assert/strict";
import { solve } from "./src/components/fem/solver/engine.ts";
import { resolveSection, dichtheidVanMateriaal } from "./src/lib/sectionResolver.ts";
import { bouwMultiInput } from "./src/lib/modelNaarSolverInput.ts";

// European Aluminium, Introduction to Eurocode 9, worked example 1, p.55-56.
// De bron publiceert L=4200 mm, q_sls=23.9 kN/m, E=70000 MPa en
// Iy=1.17e8 mm4. De analytische liggeruitkomst vormt een onafhankelijke
// vergelijking voor de volledige 2D-solverroute met aluminiumstijfheid.
const E = 70000, I = 1.17e8, L = 4200, q = 23.9;
const doorsnede = resolveSection("ALU:EN AW-6063-T6", "180x320");
assert.equal(doorsnede.E, E);
assert.equal(dichtheidVanMateriaal("ALU:EN AW-6063-T6"), 2700);
const r = solve({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: L / 2, z: 0 }, { id: 3, x: L, z: 0 }],
  beams: [
    { id: 1, from: 1, to: 2, E, A: 4000, I },
    { id: 2, from: 2, to: 3, E, A: 4000, I },
  ],
  supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 3, type: "zRoller" }],
  loads: [{ beamId: 1, q: -q }, { beamId: 2, q: -q }],
});
const nabij = (actual, expected, tol) => assert.ok(
  Math.abs(actual - expected) <= tol, `${actual} ≠ ${expected} ± ${tol}`);
nabij(r.reactions.get(1)?.fz, q * L / 2, 1e-5);
nabij(r.reactions.get(3)?.fz, q * L / 2, 1e-5);
nabij(r.displacements.get(2)?.uz, -5 * q * L ** 4 / (384 * E * I), 1e-6);

// Ook de echte modeladapter moet het aluminium herkennen en niet met de
// stijfheid van staal of met een stille standaarddoorsnede doorrekenen.
const adapter = bouwMultiInput({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: L, z: 0 }],
  beams: [{ id: 1, from: 1, to: 2, material: "ALU:EN AW-6063-T6", profile: "180x320" }],
  supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
  plates: [], loadCases: [{ id: 1, name: "Q", type: "live" }],
  loads: [{ id: 1, type: "lineLoad", caseId: 1, beamId: 1, q: -q }],
  selfWeightEnabled: false, scheefstandEnabled: false,
  scheefstandNoemer: 200, scheefstandRichting: 1,
});
assert.equal(adapter.beams[0].E, E);
assert.equal(adapter.beams[0].A, 180 * 320);
assert.throws(() => bouwMultiInput({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: L, z: 0 }],
  beams: [{ id: 1, from: 1, to: 2, material: "ALU:EN AW-9999-T6", profile: "180x320" }],
  supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
  plates: [], loadCases: [{ id: 1, name: "Q", type: "live" }], loads: [],
  selfWeightEnabled: false, scheefstandEnabled: false,
  scheefstandNoemer: 200, scheefstandRichting: 1,
}), /niet ondersteund/);
console.log("Aluminium 2D-solver tegen analytische ligger: OK");

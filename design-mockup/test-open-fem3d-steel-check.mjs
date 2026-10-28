import assert from "node:assert/strict";
import {
  buildOpenFem3DSteelCheckInputs,
  openFem3DFieldDeflectionMm,
  openFem3DLocalAxes,
} from "./src/components/openFem3d/openFem3dSteelCheck.ts";

const xMember = [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 2, y: 0, z: 0 }];
const yMember = [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 2, z: 0 }];

assert.deepEqual(openFem3DLocalAxes(...xMember), {
  ex: [1, 0, 0], ey: [0, 1, 0], ez: [0, 0, 1],
});
assert.deepEqual(openFem3DLocalAxes(...yMember), {
  ex: [0, 1, 0], ey: [-1, 0, 0], ez: [0, 0, 1],
});

const zero = (nodeId) => ({ nodeId, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 });
const endX = { ...zero(2), uz: 0.006349206349206349, ry: -0.004761904761904762 };
const endY = { ...zero(2), uz: 0.006349206349206349, rx: 0.004761904761904762 };
const deflectionX = openFem3DFieldDeflectionMm(xMember[0], xMember[1], zero(1), endX);
const deflectionY = openFem3DFieldDeflectionMm(yMember[0], yMember[1], zero(1), endY);
assert.ok(deflectionX > 1, "the chord-relative field curvature must not collapse to the end-node chord");
assert.ok(Math.abs(deflectionX - deflectionY) < 1e-10, "global plan rotation must not change local deflection");

const model = {
  nodes: xMember,
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 200", material: "S235" }],
  supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
  loads: [], memberLoads: [],
};
const makeResult = (forceScale, displacementScale) => ({
  displacements: [zero(1), {
    ...endX,
    uz: endX.uz * displacementScale,
    ry: endX.ry * displacementScale,
  }],
  memberForces: [{
    memberId: 1, lengthM: 2,
    nStartKn: -10 * forceScale, nEndKn: -10 * forceScale,
    vyStartKn: 2 * forceScale, vyEndKn: -2 * forceScale,
    vzStartKn: 3 * forceScale, vzEndKn: -3 * forceScale,
    torsionStartKnm: 1 * forceScale, torsionEndKnm: -1 * forceScale,
    myStartKnm: 4 * forceScale, myEndKnm: -4 * forceScale,
    mzStartKnm: 5 * forceScale, mzEndKnm: -5 * forceScale,
  }],
});
const caseResult = makeResult(1, 1);
const combinations = [
  { id: 10, name: "UGT 6.10b", type: "uls", formula: "", factors: new Map([[1, 1.35]]) },
  { id: 20, name: "BGT karakteristiek 6.14b", type: "sls", formula: "", factors: new Map([[1, 1], [2, 1]]) },
  { id: 30, name: "BGT quasi-blijvend 6.16b zonder Q", type: "sls", formula: "", factors: new Map([[1, 1], [2, 0]]) },
];
const combinationBuilt = buildOpenFem3DSteelCheckInputs(model, caseResult, {
  combinations,
  loadCases: [{ id: 1, type: "dead" }, { id: 2, type: "live" }],
  results: new Map([[10, makeResult(1.35, 1.35)], [20, makeResult(1, 4)], [30, makeResult(1, 1.5)]]),
});
assert.equal(combinationBuilt.inputs.length, 1);
assert.deepEqual([...new Set(combinationBuilt.inputs[0].forces_envelope.map((point) => point.combination_id))], [10]);
assert.equal(combinationBuilt.inputs[0].forces_envelope[0].forces.mz_ed, 6.75);
assert.ok(combinationBuilt.inputs[0].deflection_actual_max_mm < -2,
  "staaltoets gebruikt de grootste berekende BGT-doorbuiging");
assert.ok(combinationBuilt.inputs[0].deflection_permanent_mm < 0,
  "staaltoets gebruikt de G-only-combinatie voor de blijvende zakking w1");
assert.ok(Math.abs(combinationBuilt.inputs[0].deflection_permanent_mm)
  < Math.abs(combinationBuilt.inputs[0].deflection_actual_max_mm),
"w1 blijft kleiner dan de totale maatgevende BGT-doorbuiging");
assert.ok(combinationBuilt.inputs[0].deflection_notes.some((note) => note.includes("w₁ =")),
  "de herkomst van w1 staat in het rapportspoor");
assert.ok(combinationBuilt.notes.some((note) => note.includes("3D-UGT-combinaties")));

// Doorbuigingsklasse en gevolgklasse: zonder opgave een vloerligger (deze
// staaf ligt horizontaal) en CC2, zoals in 2D en in de 3D-houttoets: w_fin
// tegen l_rep/250 en w_add tegen 3/1 000 l_rep (NEN-EN 1990:2002/NB:2019
// A1.4.3(3)/(4)). Tot oktober 2026 stond hier "Custom" met L/300 voor beide,
// geen NB-waarde, en bij deze uitkraging (knoop 2 vrij) zonder l_rep = 2 L
// (controle 2026-10, punten B15 en K5). Met een klasse uit de
// toetsinstellingen leidt de kern de NB-grens af.
const standaard = combinationBuilt.inputs[0];
assert.equal(standaard.deflection_limit_class, "Floor");
assert.equal(standaard.deflection_limit_numerator, 250);
assert.equal(standaard.deflection_add_limit_numerator, 0);
assert.equal(standaard.is_cantilever, true, "knoop 2 is vrij: l_rep = 2 L");
assert.equal(standaard.consequence_class, "CC2");
const metKlasse = (checkConfig, extra = {}) => buildOpenFem3DSteelCheckInputs(
  { ...model, beams: [{ ...model.beams[0], checkConfig }] }, caseResult,
  { combinations, loadCases: [{ id: 1, type: "dead" }, { id: 2, type: "live" }],
    results: new Map([[10, makeResult(1.35, 1.35)], [20, makeResult(1, 4)], [30, makeResult(1, 1.5)]]), ...extra },
).inputs[0];
const dak = metKlasse({ deflectionClass: "roof" }, { consequenceClass: "CC1" });
assert.equal(dak.deflection_limit_class, "Roof");
assert.equal(dak.deflection_add_limit_numerator, 0, "0 = de kern leidt de w_add-grens uit de klasse af");
assert.equal(dak.consequence_class, "CC1");
assert.equal(metKlasse({ deflectionClass: "floor" }).deflection_limit_class, "Floor");
const eigen = metKlasse({ deflectionClass: "custom", deflectionLimitNumerator: 250 });
assert.equal(eigen.deflection_limit_class, "Custom");
assert.equal(eigen.deflection_limit_numerator, 250);
assert.equal(eigen.deflection_add_limit_numerator, 250);

// Kipbelasting (#111): de last op de bovenflens (z_a = +h/2) en de equivalente q
// uit de momentenlijn, zoals in 2D. Vrij opgelegde IPE 300, L = 6 m, q = 10 kN/m:
// M(x) = q·x·(L − x)/2, dus q_equiv = 8·M_midden/L² = q = 10 N/mm.
{
  const L = 6, q = 10;
  const ligger = {
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 300", material: "S235" }],
    supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true }, { nodeId: 2, uy: true, uz: true }],
    loads: [], memberLoads: [],
  };
  const momenten = Array.from({ length: 11 }, (_, i) => ({ t: i / 10, value: q * (i / 10 * L) * (L - i / 10 * L) / 2 }));
  const uitkomst = {
    displacements: [zero(1), zero(2)],
    memberForces: [{
      memberId: 1, lengthM: L, nStartKn: 0, nEndKn: 0, vyStartKn: 0, vyEndKn: 0,
      vzStartKn: q * L / 2, vzEndKn: -q * L / 2, torsionStartKnm: 0, torsionEndKnm: 0,
      myStartKnm: 0, myEndKnm: 0, mzStartKnm: 0, mzEndKnm: 0,
    }],
    diagrams: { axial: [], shearY: [], shearZ: [], torsion: [], momentY: [{ memberId: 1, points: momenten }], momentZ: [] },
  };
  const zonderSet = buildOpenFem3DSteelCheckInputs(ligger, uitkomst).inputs[0];
  assert.equal(zonderSet.z_a_mm, 150, "z_a = h/2 van IPE 300: de last op de bovenflens");
  assert.ok(Math.abs(zonderSet.q_equiv_n_per_mm - q) < 1e-9, `q_equiv = q = 10 N/mm (${zonderSet.q_equiv_n_per_mm})`);
  // Met een combinatieset: de combinatie met de grootste |My| bepaalt q_equiv.
  const maal = (f) => ({ ...uitkomst, diagrams: { ...uitkomst.diagrams,
    momentY: [{ memberId: 1, points: momenten.map((p) => ({ ...p, value: p.value * f })) }] } });
  const metSet = buildOpenFem3DSteelCheckInputs(ligger, uitkomst, {
    combinations: [
      { id: 10, name: "UGT 6.10a", type: "uls", formula: "", factors: new Map([[1, 1.2]]) },
      { id: 11, name: "UGT 6.10b", type: "uls", formula: "", factors: new Map([[1, 1.5]]) },
    ],
    results: new Map([[10, maal(1.2)], [11, maal(1.5)]]),
  }).inputs[0];
  assert.ok(Math.abs(metSet.q_equiv_n_per_mm - 1.5 * q) < 1e-9, `q_equiv uit de maatgevende combinatie: 15 N/mm (${metSet.q_equiv_n_per_mm})`);
  assert.equal(metSet.z_a_mm, 150);
  // Een verlopende staaf: h van het beginprofiel, zoals in 2D.
  const verlopend = buildOpenFem3DSteelCheckInputs(
    { ...ligger, beams: [{ ...ligger.beams[0], profileName: "IPE 500", profileNameEnd: "IPE 300" }] }, uitkomst).inputs[0];
  assert.equal(verlopend.z_a_mm, 250, "verlopend IPE 500 → IPE 300: z_a = h/2 van het begin");
}

console.log("3D EN 1993 local axes and field deflection: geslaagd");

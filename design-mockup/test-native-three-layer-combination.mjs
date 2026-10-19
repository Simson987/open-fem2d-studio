import assert from "node:assert/strict";
import { combineResults } from "./src/components/fem/solver/combinations.ts";
import { voegNativeDrieLagencontroleToe } from "./src/components/fem/solver/nativeMembraneRoute.ts";

const originalFetch = globalThis.fetch;
let request;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "threeLayerBatch");
  request = body.inputs.input;
  return new Response(JSON.stringify({ kind: "threeLayerBatch", result: {
    checkedPoints: request.samples.length,
    status: "partial_check_passes",
    results: request.samples.map((point, index) => ({ id: point.id, positionM: point.positionM, result: {
      leverArmMm: 60,
      top: { utilizationAsX: 0.1 + index * 0.1, utilizationAsY: 0.2, utilizationCompression: 0.3,
        reinforcementCase: "x-only" },
      bottom: { utilizationAsX: 0.04, utilizationAsY: 0.05, utilizationCompression: 0.06,
        reinforcementCase: "both-directions" },
      core: { vxKnPerM: 0, vyKnPerM: 0, resultantKnPerM: 0, directionDeg: 0,
        shearReinforcementRequired: null, requiredShearMm2PerM2: null, diagonalStressMpa: null,
        utilizationShear: null, utilizationDiagonal: null },
      status: "partial_check_passes", notAssessed: ["buiging en dwarskracht niet beoordeeld"],
    } })),
  } }), { status: 200 });
};

const plateResult = (nx) => ({
  plateId: 7,
  expectedElementIds: [11],
  elements: [{ elementId: 11, corners: [
    { x: 0, z: 0 }, { x: 1000, z: 0 }, { x: 1000, z: 1000 }, { x: 0, z: 1000 },
  ], sigmaX: nx / 100, sigmaY: 0, tauXY: 0, vonMises: nx / 100,
  sigma1: nx / 100, sigma2: 0, angle: 0, nx, ny: 0, nxy: 0,
  threeLayerSamples: [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]].map(([x, z], i) => ({
    id: `quad-11-gauss-${i + 1}`, positionM: [x, z], nx, ny: 0, nxy: 0,
  })) }],
  ranges: Object.fromEntries(["sigmaX", "sigmaY", "tauXY", "vonMises", "nx", "ny", "nxy"]
    .map((key) => [key, { min: 0, max: nx }])),
});
const result = (nx) => ({
  displacements: new Map(), reactions: new Map(), elements: new Map(), maxDisplacement: 0,
  plateElements: [plateResult(nx)],
});
const cases = new Map([[1, result(10)], [2, result(20)]]);
const combination = { id: 9, name: "UGT", type: "uls", formula: "1,35G + 1,5Q",
  factors: new Map([[1, 1.35], [2, 1.5]]) };
const combined = combineResults(combination, cases);
const config = { topSkinMm: 20, bottomSkinMm: 20, topAsX: 1000, topAsY: 1000,
  bottomAsX: 1000, bottomAsY: 1000, fcdMpa: 20, fydMpa: 435, nuPrime: 0.8,
  compressionModel: "blaauwendraad2021" };

try {
  const checked = await voegNativeDrieLagencontroleToe({ plates: [{ id: 7, thickness: 100,
    threeLayer: config }] }, combined);
  assert.equal(request.configuration.thicknessMm, 100);
  assert.equal(request.samples.length, 4);
  assert.deepEqual(request.samples[0], {
    id: "quad-11-gauss-1", positionM: [0.2, 0.2],
    forces: { nx: 43.5, ny: 0, nxy: 0, mx: 0, my: 0, mxy: 0, vx: 0, vy: 0 },
  });
  assert.equal(checked.plateElements[0].elements[0].threeLayer.status, "partial_check_passes");
  assert.equal(checked.plateElements[0].elements[0].threeLayer.top.utilizationAsX, 0.4);
  assert.equal(checked.plateElements[0].elements[0].threeLayer.top.reinforcementCase, "x-only");
  assert.equal(checked.plateElements[0].elements[0].threeLayer.bottom.reinforcementCase, "both-directions");
  assert.deepEqual(checked.plateElements[0].elements[0].threeLayer.positionM, [0.2, 0.8]);
  assert.deepEqual(checked.plateElements[0].elements[0].threeLayer.notAssessed,
    ["buiging en dwarskracht niet beoordeeld"]);
  console.log("Drie-lagencontrole wordt na lineaire superpositie opnieuw berekend op de gecombineerde membraankracht.");
} finally {
  globalThis.fetch = originalFetch;
}

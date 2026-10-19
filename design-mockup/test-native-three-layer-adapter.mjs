import assert from 'node:assert/strict';
import { Mesh } from './src/core/fem/Mesh.ts';
import { buildNativeThreeLayerBatchInput } from './src/core/fem/nativeThreeLayerAdapter.ts';

const mesh = new Mesh();
const nodes = [mesh.addNode(0, 0), mesh.addNode(2, 0), mesh.addNode(2, 1), mesh.addNode(0, 1)];
mesh.addQuadElement(nodes.map((node) => node.id), 1, 0.1);
const membrane = {
  nodes: nodes.map((node) => ({ nodeId: node.id, uxM: 0, uyM: 0, rxKn: 0, ryKn: 0 })),
  quads: [{ quadId: 1, averageStrain: [0, 0, 0], averageStressMpa: [2, -3, 0.5], gaussPoints: [] }],
  iterations: 1,
  relativeResidual: 1e-9,
};
const bending = {
  nodes: nodes.map((node) => ({ nodeId: node.id, wM: 0, thetaXRad: 0, thetaYRad: 0,
    reactionFzKn: 0, reactionMxKnm: 0, reactionMyKnm: 0 })),
  elements: [{ quadId: 1, momentKnmPerM: [7, -4, 1.5], shearKnPerM: [12, -9], effectiveEMpa: 30000, maxFibreStrain: 0 }],
  iterations: 1,
  relativeResidual: 1e-9,
};
const config = {
  thicknessMm: 100, topSkinMm: 20, bottomSkinMm: 20,
  topReinforcement: { asX: 1000, asY: 1000 },
  bottomReinforcement: { asX: 1000, asY: 1000 },
  fcdMpa: 20, fydMpa: 435, nuPrime: 0.8,
  compressionModel: 'blaauwendraad2021',
};

const batch = buildNativeThreeLayerBatchInput(mesh, membrane, bending, config);
assert.deepEqual(batch.samples, [{
  id: 'quad-1-center',
  positionM: [1, 0.5],
  forces: { nx: 200, ny: -300, nxy: 50, mx: 7, my: -4, mxy: 1.5, vx: 12, vy: -9 },
}]);
assert.equal(batch.configuration.thicknessMm, 100);
assert.throws(() => buildNativeThreeLayerBatchInput(mesh, membrane, { ...bending, elements: [] }, config), /dezelfde unieke vierhoeken/);
assert.throws(() => buildNativeThreeLayerBatchInput(mesh, membrane, { ...bending, relativeResidual: 1e-3 }, config), /evenwicht/);
assert.throws(() => buildNativeThreeLayerBatchInput(mesh, { ...membrane, nodes: [] }, bending, config), /dezelfde meshknopen/);
assert.throws(() => buildNativeThreeLayerBatchInput(mesh, membrane, bending, { ...config, thicknessMm: 120 }), /uniforme plaatdikte/);
console.log('Rust membraan- en buigresultanten worden correct gecombineerd voor de drie-lagencontrole.');

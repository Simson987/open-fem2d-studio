import assert from 'node:assert/strict';
import { Mesh } from './src/core/fem/Mesh.ts';
import { buildNativeGeometricShellRequest } from './src/core/fem/nativeGeometricShellAdapter.ts';
import { solveNativeGeometricShell } from './src/lib/nativeFemClient.ts';

const mesh = new Mesh();
mesh.materials.set(1, { id: 1, name: 'shell', E: 30_000e6, nu: 0.2, rho: 0, color: '' });
const nodes = [mesh.addNode(0, 0), mesh.addNode(2, 0), mesh.addNode(2, 1), mesh.addNode(0, 1)];
mesh.addQuadElement(nodes.map((node) => node.id), 1, 0.1);
const support = { nodeId: nodes[0].id, u: true, v: false };
const load = { nodeId: nodes[1].id, fxKn: 4, fyKn: -2 };

const request = buildNativeGeometricShellRequest(mesh, 0, [], [], undefined, [], [], [support], [load]);
assert.equal(request.bending.quads.length, 1);
assert.deepEqual(request.membraneSupports, [support]);
assert.deepEqual(request.membraneLoads, [load]);

assert.throws(() => buildNativeGeometricShellRequest(mesh, 0, [], [], undefined, [], [], [
  support, { nodeId: support.nodeId, u: false, v: true },
], []), /Membraansteun voor knoop .* dubbel opgegeven/);
assert.throws(() => buildNativeGeometricShellRequest(mesh, 0, [], [], undefined, [], [], [
  { nodeId: 999, u: true },
], []), /Membraansteun knoop 999 ligt buiten het shellrooster/);
assert.throws(() => buildNativeGeometricShellRequest(mesh, 0, [], [], undefined, [], [], [
  { nodeId: support.nodeId, u: true, kuKnPerM: 100 },
], []), /kan niet vast én verend zijn/);
assert.throws(() => buildNativeGeometricShellRequest(mesh, 0, [], [], undefined, [], [], [
  { nodeId: support.nodeId, kuKnPerM: Number.POSITIVE_INFINITY },
], []), /moet eindig en positief zijn/);
assert.throws(() => buildNativeGeometricShellRequest(mesh, 0, [], [], undefined, [], [], [null], []),
  /Membraansteunen moeten geldige steunrecords zijn/);
assert.throws(() => buildNativeGeometricShellRequest(mesh, 0, [], [], undefined, [], [], [
  { nodeId: support.nodeId, u: 'false', v: false },
], []), /moet vaste richtingen als waar\/onwaar bevatten/);
assert.throws(() => buildNativeGeometricShellRequest(mesh, 0, [], [], undefined, [], [], [], [
  { nodeId: 999, fxKn: 1, fyKn: 0 },
]), /Membraanlast knoop 999 ligt buiten het shellrooster/);
assert.throws(() => buildNativeGeometricShellRequest(mesh, 0, [], [], undefined, [], [], [], [
  { nodeId: nodes[1].id, fxKn: Number.NaN, fyKn: 0 },
]), /moet eindige krachten bevatten/);
assert.throws(() => buildNativeGeometricShellRequest(mesh, 0, [], [], undefined, [], [], [], [null]),
  /Membraanlasten moeten geldige lastrecords zijn/);

const originalFetch = globalThis.fetch;
let dispatchCount = 0;
globalThis.fetch = async () => {
  dispatchCount += 1;
  throw new Error('ongeldige membraansteun mag niet worden doorgestuurd');
};
try {
  assert.throws(() => solveNativeGeometricShell(mesh, 0, [], [], undefined, [], [], [
    { nodeId: nodes[0].id, u: 'true' },
  ], []), /moet vaste richtingen als waar\/onwaar bevatten/);
  assert.equal(dispatchCount, 0, 'ongeldige membraansteun moet vóór native FEM-dispatch worden geweigerd');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Geometrische shell-adapter valideert membraansteunen, veren en lasten tegen de werkelijke mesh.');

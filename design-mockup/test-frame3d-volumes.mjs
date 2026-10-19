import assert from "node:assert/strict";
import {
  addFrame3DVolume, addFrame3DVolumeBodyLoad, addFrame3DVolumeFaceLoad, frame3DLoadedCaseIds,
  parseFrame3DModel, removeFrame3DNode, removeFrame3DVolume, removeFrame3DVolumeBodyLoad,
  removeFrame3DVolumeFaceLoad, updateFrame3DVolume, updateFrame3DVolumeBodyLoad,
  updateFrame3DVolumeFaceLoad, withFrame3DSelfWeight,
} from "./src/components/frame3d/frame3dModel.ts";

const nodes = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
].map(([x, y, z], index) => ({ id: index + 1, x, y, z }));
const old = parseFrame3DModel({ nodes, beams: [] });
assert.equal(old.volumes, undefined, "oude projecten blijven zonder volumeveld leesbaar");
const tet = { kind: "tet4", nodeIds: [1, 2, 4, 5], eMpa: 30_000, poisson: 0.2 };
const hex = { kind: "hex8", nodeIds: [1, 2, 3, 4, 5, 6, 7, 8], eMpa: 21_000, poisson: 0.3 };
const withTet = addFrame3DVolume(old, tet);
const withBoth = addFrame3DVolume(withTet, hex);
assert.deepEqual(withBoth.volumes.map(({ id, kind }) => [id, kind]), [[1, "tet4"], [2, "hex8"]]);
assert.deepEqual(parseFrame3DModel(JSON.parse(JSON.stringify(withBoth))).volumes, withBoth.volumes,
  "Tet4 en Hex8 blijven na projectopslag behouden");
assert.equal(updateFrame3DVolume(withBoth, 1, { eMpa: 25_000 }).volumes[0].eMpa, 25_000);
const withForce = addFrame3DVolumeBodyLoad(withBoth, 1, [0, 0, -25], 3);
assert.deepEqual(parseFrame3DModel(JSON.parse(JSON.stringify(withForce))).volumeBodyLoads,
  withForce.volumeBodyLoads, "volumekracht en belastinggeval blijven na projectopslag behouden");
assert.deepEqual(updateFrame3DVolumeBodyLoad(withForce, 1, [1, 0, -25]).volumeBodyLoads[0].forceKnPerM3,
  [1, 0, -25]);
assert.equal(removeFrame3DVolumeBodyLoad(withForce, 1).volumeBodyLoads.length, 0);
assert.equal(removeFrame3DVolume(withForce, 1).volumeBodyLoads.length, 0,
  "verwijderen van een volume verwijdert zijn volumekrachten");
assert.equal(removeFrame3DNode(withForce, 1).volumeBodyLoads.length, 0,
  "verwijderen van een volumeknoop verwijdert zijn volumekrachten");
assert.throws(() => addFrame3DVolumeBodyLoad(withBoth, 99, [0, 0, -25], 3), /volumekracht/);
assert.throws(() => addFrame3DVolumeBodyLoad(withBoth, 1, [0, 0, 0], 3), /volumekracht/);
assert.throws(() => addFrame3DVolumeBodyLoad(withBoth, 1, [0, 0, Infinity], 3), /volumekracht/);
const withFace = addFrame3DVolumeFaceLoad(withBoth, 2, 2, [0, 0, -10], 4);
assert.deepEqual(parseFrame3DModel(JSON.parse(JSON.stringify(withFace))).volumeFaceLoads, withFace.volumeFaceLoads,
  "Hex8-vlaktractie en belastinggeval blijven na projectopslag behouden");
assert.deepEqual([...frame3DLoadedCaseIds(withFace)], [4]);
assert.equal(updateFrame3DVolumeFaceLoad(withFace, 1, { faceIndex: 5,
  tractionKnPerM2: [0, -7, 0] }).volumeFaceLoads[0].faceIndex, 5);
assert.equal(removeFrame3DVolumeFaceLoad(withFace, 1).volumeFaceLoads.length, 0);
assert.equal(removeFrame3DVolume(withFace, 2).volumeFaceLoads.length, 0);
assert.equal(removeFrame3DNode(withFace, 8).volumeFaceLoads.length, 0);
assert.throws(() => addFrame3DVolumeFaceLoad(withBoth, 99, 0, [0, 0, -1], 4), /volumevlaktractie/);
assert.throws(() => addFrame3DVolumeFaceLoad(withBoth, 1, 4, [0, 0, -1], 4), /volumevlaktractie/);
assert.throws(() => addFrame3DVolumeFaceLoad(withBoth, 2, 6, [0, 0, -1], 4), /volumevlaktractie/);
assert.throws(() => addFrame3DVolumeFaceLoad(withBoth, 2, 1, [0, 0, 0], 4), /volumevlaktractie/);
assert.throws(() => addFrame3DVolumeFaceLoad(withBoth, 2, 1, [0, 0, Infinity], 4), /volumevlaktractie/);
const configured = parseFrame3DModel({ ...withFace, volumeBackend: "frontalWave", volumeThreads: 2 });
assert.deepEqual([configured.volumeBackend, configured.volumeThreads], ["frontalWave", 2]);
assert.deepEqual(JSON.parse(JSON.stringify(configured)).volumeBackend, "frontalWave",
  "solverkeuze blijft in het opgeslagen project behouden");
assert.throws(() => parseFrame3DModel({ ...withBoth, volumeBackend: "cg" }), /oplosstrategie/);
assert.throws(() => parseFrame3DModel({ ...withBoth, volumeThreads: 0 }), /solverthreads/);
assert.throws(() => parseFrame3DModel({ ...withBoth, volumeThreads: 33 }), /solverthreads/);
const withDensity = updateFrame3DVolume(withBoth, 1, { densityKgPerM3: 2400 });
assert.equal(parseFrame3DModel(JSON.parse(JSON.stringify(withDensity))).volumes[0].densityKgPerM3, 2400);
assert.throws(() => withFrame3DSelfWeight(withBoth, 9), /dichtheid/,
  "automatisch gewicht mag geen stilzwijgende materiaaldichtheid aannemen");
assert.throws(() => updateFrame3DVolume(withBoth, 1, { densityKgPerM3: 0 }), /dichtheid/);
const allDensities = updateFrame3DVolume(withDensity, 2, { densityKgPerM3: 2500 });
const weighted = withFrame3DSelfWeight(allDensities, 9);
assert.deepEqual([...frame3DLoadedCaseIds(weighted)], [9],
  "de app moet een geval met alleen afgeleide volumekrachten toch berekenen");
assert.equal(allDensities.volumeBodyLoads?.length ?? 0, 0, "projectmodel blijft zonder afgeleide lasten");
assert.deepEqual(weighted.volumeBodyLoads.map(({ volumeId, caseId, forceKnPerM3 }) =>
  [volumeId, caseId, forceKnPerM3]), [
  [1, 9, [0, 0, -2400 * 9.81 / 1000]],
  [2, 9, [0, 0, -2500 * 9.81 / 1000]],
]);
assert.deepEqual(removeFrame3DVolume(withBoth, 1).volumes.map(({ id }) => id), [2]);
assert.equal(removeFrame3DNode(withBoth, 1).volumes.length, 0,
  "een verwijderde knoop ruimt alle aanliggende volume-elementen op");

const invalid = [
  [{ ...tet, id: 1, nodeIds: [1, 2, 4, 4] }, /knoopverwijzingen/],
  [{ ...tet, id: 1, nodeIds: [1, 2, 4, 99] }, /knoopverwijzingen/],
  [{ ...tet, id: 1, nodeIds: [1, 2, 3] }, /knoopverwijzingen/],
  [{ ...tet, id: 1, nodeIds: [1, 2, 3, 4] }, /Tet4.*ontaard/],
  [{ ...tet, id: 1, poisson: 0.5 }, /Poisson/],
  [{ ...tet, id: 1, eMpa: 0 }, /positieve/],
  [{ ...tet, id: 1, eMpa: Infinity }, /positieve/],
  [{ ...hex, id: 1, nodeIds: [2, 1, 3, 4, 5, 6, 7, 8] }, /Hex8.*Jacobiaan/],
  [{ ...hex, id: 1, nodeIds: [1, 2, 3, 4, 1, 6, 7, 8] }, /knoopverwijzingen/],
];
for (const [volume, error] of invalid) {
  assert.throws(() => parseFrame3DModel({ nodes, beams: [], volumes: [volume] }), error);
}
assert.throws(() => parseFrame3DModel({ nodes, beams: [], volumes: [{ ...tet, id: 1 }, { ...hex, id: 1 }] }),
  /dubbele id/);
assert.throws(() => parseFrame3DModel({ nodes, beams: [], volumes: {} }), /lijst volumes/);
assert.throws(() => updateFrame3DVolume(withBoth, 2, { nodeIds: [1, 2, 3, 4] }), /knoopverwijzingen/);
console.log("3D-volumes: opslag, bewerken, verwijderen en geometrische validatie geslaagd");

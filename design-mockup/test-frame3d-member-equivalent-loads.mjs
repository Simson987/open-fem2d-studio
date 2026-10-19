import assert from "node:assert/strict";
import { frame3DMemberEquivalentLoad, frame3DMemberPointEquivalentLoad } from "./src/components/frame3d/frame3dMemberEquivalentLoads.ts";

const close = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-11, `${label}: ${actual}, verwacht ${expected}`);
const beam = { id: 8, startNodeId: 1, endNodeId: 2 };
const start = { id: 1, x: 0, y: 0, z: 0 }, end = { id: 2, x: 2, y: 0, z: 0 };
const uniform = frame3DMemberEquivalentLoad(beam, start, end, {
  id: 1, beamId: 8, qyStart: 0, qyEnd: 0, qzStart: -4, qzEnd: -4,
  startPositionM: 0, endPositionM: 2,
});
close(uniform.local[2], -4, "begin-dwarskracht");
close(uniform.local[8], -4, "eind-dwarskracht");
close(uniform.local[4], 4 / 3, "beginmoment My");
close(uniform.local[10], -4 / 3, "eindmoment My");
close(uniform.global[0].forceKn[2] + uniform.global[1].forceKn[2], -8,
  "totale verticale kracht");

const partial = frame3DMemberEquivalentLoad(beam, start, end, {
  id: 2, beamId: 8, qyStart: 2, qyEnd: 5, qzStart: 0, qzEnd: 0,
  startPositionM: 0.5, endPositionM: 1.5,
}, -2);
const fy = partial.global[0].forceKn[1] + partial.global[1].forceKn[1];
const mz = partial.global[0].momentKnm[2] + partial.global[1].momentKnm[2]
  + 2 * partial.global[1].forceKn[1];
close(fy, -7, "gedeeltelijke trapeziumlast resultante");
close(mz, -7.5, "gedeeltelijke trapeziumlast moment over begin");

const vertical = frame3DMemberEquivalentLoad(beam,
  { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 2 },
  { id: 3, beamId: 8, qyStart: 0, qyEnd: 0, qzStart: 3, qzEnd: 3,
    startPositionM: 0, endPositionM: 2 });
close(vertical.global[0].forceKn[0] + vertical.global[1].forceKn[0], 6,
  "verticale staaf, globale X-kracht bij lokale z-last");
assert.throws(() => frame3DMemberEquivalentLoad(beam, start, end, {
  id: 4, beamId: 8, qyStart: 0, qyEnd: 0, qzStart: 1, qzEnd: 1,
  startPositionM: 1.5, endPositionM: 2.5 }), /ongeldige lengte/);
const point = frame3DMemberPointEquivalentLoad(beam, start, end,
  { id: 5, beamId: 8, py: 0, pz: -8, positionM: 1 });
close(point.local[2], -4, "middenpuntlast, begin-dwarskracht");
close(point.local[8], -4, "middenpuntlast, eind-dwarskracht");
close(point.local[4], 2, "middenpuntlast, beginmoment My");
close(point.local[10], -2, "middenpuntlast, eindmoment My");
close(point.global[0].forceKn[2] + point.global[1].forceKn[2], -8,
  "middenpuntlast, verticale resultante");
close(point.global[0].momentKnm[1] + point.global[1].momentKnm[1]
  - 2 * point.global[1].forceKn[2], 8, "middenpuntlast, momentresultante");
assert.throws(() => frame3DMemberPointEquivalentLoad(beam, start, end,
  { id: 6, beamId: 8, py: 0, pz: 1, positionM: 2.5 }), /ongeldige lengte/);
console.log("3D-staaflasten: consistente eindkrachten en -momenten voor lijn- en puntlasten geslaagd");

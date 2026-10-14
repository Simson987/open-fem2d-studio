import assert from "node:assert/strict";
import { genereerWindbelasting, STANDAARD_WIND_INSTELLINGEN } from "./src/lib/wind/windGenerator.ts";
import { generateWind3DLoads } from "./src/components/openFem3d/openFem3dWindGeneration.ts";
import { clipOpenFem3DEnvelopeTriangle } from "./src/components/openFem3d/openFem3dEnvelopeZones.ts";

// Binnenportaal van een gebouw van 12 × 30 × 6 m, h.o.h. 5 m en y = 15 m.
const twoDModel = {
  nodes: [
    { id: 1, x: 0, z: 0 }, { id: 2, x: 12000, z: 0 },
    { id: 3, x: 0, z: 6000 }, { id: 4, x: 12000, z: 6000 },
  ],
  beams: [{ id: 1, from: 1, to: 3 }, { id: 2, from: 2, to: 4 }, { id: 3, from: 3, to: 4 }],
  loadCases: [{ id: 1, name: "Permanent", type: "dead" }],
};
const twoDSettings = {
  ...STANDAARD_WIND_INSTELLINGEN,
  windgebied: "II", terreincategorie: "II", stuwdrukBron: "berekend",
  richtingLinks: true, richtingRechts: false, richtingHaaks: false,
  cpiKeuze: "min", hohSpant_m: 5, gebouwlengte_m: 30,
  afstandTotKopgevel_m: 15, combinatiesGenereren: false,
};
const twoD = genereerWindbelasting(twoDModel, twoDSettings);
assert.equal(twoD.ok, true);
const xyz = [
  [0, 0, 0], [0, 0, 6], [0, 30, 6], [0, 30, 0],
  [12, 0, 0], [12, 30, 0], [12, 30, 6], [12, 0, 6],
  [12, 0, 0], [12, 0, 6], [0, 0, 6], [0, 0, 0],
  [0, 30, 0], [0, 30, 6], [12, 30, 6], [12, 30, 0],
  [0, 0, 6], [12, 0, 6], [12, 30, 6], [0, 30, 6],
];
const threeD = generateWind3DLoads({
  nodes: xyz.map(([x, y, z], index) => ({ id: index + 1, x, y, z })), beams: [],
  envelopePanels: [
    [1, [1, 2, 3, 4], "facade"], [2, [5, 6, 7, 8], "facade"],
    [3, [9, 10, 11, 12], "facade"], [4, [13, 14, 15, 16], "facade"],
    [5, [17, 18, 19, 20], "roof"],
  ].map(([id, nodeIds, type]) => ({ id, nodeIds, type, distribution: "twoWay" })),
}, { windgebied: "II", terreincategorie: "II" });
const case3d = threeD.cases.find((item) => item.direction === "+X" && item.cpi === -0.3
  && item.key.endsWith("roof:I-suction"));
assert.ok(case3d);
const threeDLoads = threeD.loads.filter((item) => item.caseKey === case3d.key);
const stripForce = (panelId, loads = threeDLoads) => loads.filter((item) => item.panelId === panelId)
  .flatMap((item) => clipOpenFem3DEnvelopeTriangle(item.triangle, 1, 12.5, 17.5)
    .map((part) => item.qOutwardKnPerM2 * part.areaM2))
  .reduce((sum, value) => sum + value, 0);
const beamForce = (beamId, result = twoD) => result.lasten.filter((item) => item.beamId === beamId)
  .reduce((sum, item) => sum + item.q * ((item.endFrac ?? 1) - (item.startFrac ?? 0))
    * (beamId === 3 ? 12 : 6), 0);
// De 2D-kolommen wijzen lokaal +z naar −X; de 3D-vlakken volgen hun buitenzijde.
assert.ok(Math.abs(stripForce(1) - beamForce(1)) < 1e-7, "loefgevel: zelfde strookkracht");
assert.ok(Math.abs(stripForce(2) + beamForce(2)) < 1e-7, "lijgevel: zelfde globale kracht");
assert.ok(Math.abs(stripForce(5) - beamForce(3)) < 1e-7, "dakzones: zelfde op-/neerwaartse kracht");
const twoDPlus = genereerWindbelasting(twoDModel, { ...twoDSettings, cpiKeuze: "plus" });
assert.equal(twoDPlus.ok, true);
const case3dPlus = threeD.cases.find((item) => item.direction === "+X" && item.cpi === 0.2
  && item.key.endsWith("roof:I-suction"));
assert.ok(case3dPlus);
const threeDLoadsPlus = threeD.loads.filter((item) => item.caseKey === case3dPlus.key);
for (const [panelId, beamId, sign] of [[1, 1, 1], [2, 2, -1], [5, 3, 1]]) {
  assert.ok(Math.abs(stripForce(panelId, threeDLoadsPlus)
    - sign * beamForce(beamId, twoDPlus)) < 1e-7,
  `c_pi=+0,2: vlak ${panelId} en staaf ${beamId} dragen dezelfde strookkracht af`);
}
console.log("3D-portaalwind = 2D-windgenerator: controles geslaagd");

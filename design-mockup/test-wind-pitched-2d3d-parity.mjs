import assert from "node:assert/strict";
import { genereerWindbelasting, STANDAARD_WIND_INSTELLINGEN } from "./src/lib/wind/windGenerator.ts";
import { generateWind3DLoads } from "./src/components/openFem3d/openFem3dWindGeneration.ts";
import { clipOpenFem3DEnvelopeTriangle } from "./src/components/openFem3d/openFem3dEnvelopeZones.ts";

const angle = 15 * Math.PI / 180;
const rise = 6 * Math.tan(angle);
const frame = {
  nodes: [
    { id: 1, x: 0, z: 0 }, { id: 2, x: 12000, z: 0 },
    { id: 3, x: 0, z: 5000 }, { id: 4, x: 6000, z: (5 + rise) * 1000 },
    { id: 5, x: 12000, z: 5000 },
  ],
  beams: [
    { id: 1, from: 1, to: 3 }, { id: 2, from: 2, to: 5 },
    { id: 3, from: 3, to: 4 }, { id: 4, from: 4, to: 5 },
  ],
  loadCases: [{ id: 1, name: "Eigen gewicht", type: "dead" }],
};
const two = genereerWindbelasting(frame, {
  ...STANDAARD_WIND_INSTELLINGEN,
  stuwdrukBron: "handmatig", qpHandmatig_kNm2: 1,
  richtingLinks: true, richtingRechts: false, richtingHaaks: false,
  cpiKeuze: "handmatig", cpiHandmatig: 0,
  hohSpant_m: 5, positieSpant: "tussenspant", gebouwlengte_m: 10,
  afstandTotKopgevel_m: 5, combinatiesGenereren: false,
  cpeDakLoef: null, cpeDakLij: null, cpeDakHaaks: null,
});
assert.equal(two.ok, true);
const twoCase = two.gevallen.find((item) => item.sleutel.endsWith("loef-lij-"));
assert.ok(twoCase);
const slopeLengthM = 6 / Math.cos(angle);
const force2dKn = two.lasten.filter((load) => load.gevalSleutel === twoCase.sleutel
  && (load.beamId === 3 || load.beamId === 4))
  .reduce((sum, load) => sum + load.q
    * ((load.endFrac ?? 1) - (load.startFrac ?? 0)) * slopeLengthM * Math.cos(angle), 0);

const node = (id, x, y, z) => ({ id, x, y, z });
const panel = (id, nodeIds, type) => ({ id, nodeIds, type, distribution: "twoWay" });
const shell = {
  nodes: [
    node(1, 0, 0, 5), node(2, 6, 0, 5 + rise), node(3, 6, 10, 5 + rise), node(4, 0, 10, 5),
    node(5, 12, 0, 5), node(6, 12, 10, 5),
    node(7, 0, 0, 0), node(8, 0, 10, 0), node(9, 12, 0, 0), node(10, 12, 10, 0),
  ], beams: [],
  envelopePanels: [
    panel(1, [1, 2, 3, 4], "roof"), panel(2, [2, 5, 6, 3], "roof"),
    panel(3, [7, 1, 4, 8], "facade"), panel(4, [9, 10, 6, 5], "facade"),
    panel(5, [7, 9, 5, 2, 1], "facade"), panel(6, [8, 4, 3, 6, 10], "facade"),
  ],
};
const three = generateWind3DLoads(shell, {
  manualPressureKnPerM2: 1, internalPressureCoefficients: [0],
});
const threeCase = three.cases.find((item) => item.direction === "+X" && item.cpi === 0
  && item.key.includes("lij:neg") && item.key.includes("loef:neg"));
assert.ok(threeCase);
const force3dKn = three.loads.filter((load) => load.caseKey === threeCase.key
  && (load.panelId === 1 || load.panelId === 2))
  .reduce((sum, load) => sum + load.qOutwardKnPerM2 * Math.cos(angle)
    * clipOpenFem3DEnvelopeTriangle(load.triangle, 1, 2.5, 7.5)
      .reduce((area, piece) => area + piece.areaM2, 0), 0);
assert.ok(Math.abs(force2dKn - force3dKn) < 1e-8,
  `2D-zadeldak ${force2dKn} kN en 3D-zadeldak ${force3dKn} kN`);
console.log("2D/3D-pariteit van Nederlandse zadeldakwind: geslaagd");

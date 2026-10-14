import assert from "node:assert/strict";
import { genereerWindbelasting, STANDAARD_WIND_INSTELLINGEN } from "./src/lib/wind/windGenerator.ts";
import { generateWind3DLoads } from "./src/components/openFem3d/openFem3dWindGeneration.ts";
import { clipOpenFem3DEnvelopeTriangle } from "./src/components/openFem3d/openFem3dEnvelopeZones.ts";

const frame = {
  nodes: [
    { id: 1, x: 0, z: 0 }, { id: 2, x: 12000, z: 0 },
    { id: 3, x: 0, z: 6000 }, { id: 4, x: 12000, z: 6000 },
  ],
  beams: [{ id: 1, from: 1, to: 3 }, { id: 2, from: 2, to: 4 },
    { id: 3, from: 3, to: 4 }],
  loadCases: [{ id: 1, name: "Eigen gewicht", type: "dead" }],
};
const two = genereerWindbelasting(frame, {
  ...STANDAARD_WIND_INSTELLINGEN,
  stuwdrukBron: "handmatig", qpHandmatig_kNm2: 1,
  richtingLinks: true, richtingRechts: false, richtingHaaks: false,
  cpiKeuze: "min", hohSpant_m: 5, positieSpant: "tussenspant",
  gebouwlengte_m: 30, afstandTotKopgevel_m: 15,
  combinatiesGenereren: false,
});
assert.equal(two.ok, true);
const roofLineLoads = two.lasten.filter((load) => load.beamId === 3);
const force2dKn = roofLineLoads.reduce((sum, load) => sum + load.q
  * ((load.endFrac ?? 1) - (load.startFrac ?? 0)) * 12, 0);

const coords = [
  [0, 0, 0], [0, 0, 6], [0, 30, 6], [0, 30, 0],
  [12, 0, 0], [12, 30, 0], [12, 30, 6], [12, 0, 6],
  [12, 0, 0], [12, 0, 6], [0, 0, 6], [0, 0, 0],
  [0, 30, 0], [0, 30, 6], [12, 30, 6], [12, 30, 0],
  [0, 0, 6], [12, 0, 6], [12, 30, 6], [0, 30, 6],
];
const shell = {
  nodes: coords.map(([x, y, z], index) => ({ id: index + 1, x, y, z })), beams: [],
  envelopePanels: [
    { id: 1, nodeIds: [1, 2, 3, 4], type: "facade", distribution: "twoWay" },
    { id: 2, nodeIds: [5, 6, 7, 8], type: "facade", distribution: "twoWay" },
    { id: 3, nodeIds: [9, 10, 11, 12], type: "facade", distribution: "twoWay" },
    { id: 4, nodeIds: [13, 14, 15, 16], type: "facade", distribution: "twoWay" },
    { id: 5, nodeIds: [17, 18, 19, 20], type: "roof", distribution: "twoWay" },
  ],
};
const three = generateWind3DLoads(shell, {
  manualPressureKnPerM2: 1, internalPressureCoefficients: [-0.3],
});
const case3d = three.cases.find((item) => item.direction === "+X" && item.cpi === -0.3
  && item.key.endsWith("roof:I-suction"));
assert.ok(case3d);
const roofSurfaceLoads = three.loads.filter((load) => load.caseKey === case3d.key
  && load.panelId === 5);
const force3dKn = roofSurfaceLoads.reduce((sum, load) => sum + load.qOutwardKnPerM2
  * clipOpenFem3DEnvelopeTriangle(load.triangle, 1, 12.5, 17.5)
    .reduce((area, piece) => area + piece.areaM2, 0), 0);
assert.ok(Math.abs(force2dKn - force3dKn) < 1e-8,
  `2D-dakkracht ${force2dKn} kN en 3D-dakkracht ${force3dKn} kN moeten overeenkomen`);

for (const scenario of [
  { name: "dakrand F", direction2d: "links", direction3d: "+X", cpi: -0.3,
    fromY: 0, toY: 2.5, position: "kopgevelspant", distance: 0,
    pressure: "manual", factor: 1 },
  { name: "binnendruk plus", direction2d: "links", direction3d: "+X", cpi: 0.2,
    fromY: 12.5, toY: 17.5, position: "tussenspant", distance: 15,
    pressure: "manual", factor: 1 },
  { name: "omgekeerde richting met berekende druk", direction2d: "rechts", direction3d: "-X", cpi: -0.3,
    fromY: 12.5, toY: 17.5, position: "tussenspant", distance: 15,
    pressure: "calculated", factor: 1.3 },
]) {
  const manual = scenario.pressure === "manual";
  const frameWind = genereerWindbelasting(frame, {
    ...STANDAARD_WIND_INSTELLINGEN,
    stuwdrukBron: manual ? "handmatig" : "berekend", qpHandmatig_kNm2: 1,
    windgebied: "II", terreincategorie: "II",
    richtingLinks: scenario.direction2d === "links",
    richtingRechts: scenario.direction2d === "rechts", richtingHaaks: false,
    cpiKeuze: scenario.cpi === 0.2 ? "plus" : "min",
    hohSpant_m: 5, positieSpant: scenario.position,
    gebouwlengte_m: 30, afstandTotKopgevel_m: scenario.distance,
    structuralFactor: scenario.factor, combinatiesGenereren: false,
  });
  assert.equal(frameWind.ok, true, scenario.name);
  const frameForce = frameWind.lasten.filter((load) => load.beamId === 3)
    .reduce((sum, load) => sum + load.q
      * ((load.endFrac ?? 1) - (load.startFrac ?? 0)) * 12, 0);
  const shellWind = generateWind3DLoads(shell, {
    ...(manual ? { manualPressureKnPerM2: 1 } : { windgebied: "II", terreincategorie: "II" }),
    internalPressureCoefficients: [scenario.cpi], structuralFactor: scenario.factor,
  });
  const windCase = shellWind.cases.find((item) => item.direction === scenario.direction3d
    && item.cpi === scenario.cpi && item.key.endsWith("roof:I-suction"));
  assert.ok(windCase, scenario.name);
  const shellForce = shellWind.loads.filter((load) => load.caseKey === windCase.key
    && load.panelId === 5)
    .reduce((sum, load) => sum + load.qOutwardKnPerM2
      * clipOpenFem3DEnvelopeTriangle(load.triangle, 1, scenario.fromY, scenario.toY)
        .reduce((area, piece) => area + piece.areaM2, 0), 0);
  assert.ok(Math.abs(frameForce - shellForce) < 1e-8,
    `${scenario.name}: 2D ${frameForce} kN en 3D ${shellForce} kN`);
}
console.log("2D/3D-pariteit van Nederlandse platdakwind: geslaagd");

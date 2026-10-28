import assert from "node:assert/strict";
import { genereerWindbelasting, STANDAARD_WIND_INSTELLINGEN } from "./src/lib/wind/windGenerator.ts";
import { generateFacadeWindLoads } from "./src/components/openFem3d/openFem3dFacadeWindLoads.ts";

// One 12 × 5 × 6 m rectangular building. The 2D portal represents the full
// 5 m width of its end walls; the 3D model uses those same physical surfaces.
const frame = {
  nodes: [
    { id: 1, x: 0, z: 0 }, { id: 2, x: 12000, z: 0 },
    { id: 3, x: 0, z: 6000 }, { id: 4, x: 12000, z: 6000 },
  ],
  beams: [{ id: 1, from: 1, to: 3 }, { id: 2, from: 2, to: 4 },
    { id: 3, from: 3, to: 4 }],
  loadCases: [{ id: 1, name: "Eigen gewicht", type: "dead" }],
};
const frameWind = genereerWindbelasting(frame, {
  ...STANDAARD_WIND_INSTELLINGEN,
  stuwdrukBron: "handmatig", qpHandmatig_kNm2: 1,
  richtingLinks: true, richtingRechts: false, richtingHaaks: false,
  cpiKeuze: "min", hohSpant_m: 5, positieSpant: "tussenspant",
  gebouwlengte_m: 5, afstandTotKopgevel_m: 2.5,
  combinatiesGenereren: false,
});
assert.equal(frameWind.ok, true);
const wallLoads = frameWind.lasten.filter((load) => load.beamId === 1 || load.beamId === 2);
assert.equal(wallLoads.length, 2);
const force2dKn = -wallLoads.reduce((sum, load) => sum + load.q * 6, 0);

const points = [
  [0, 0, 0], [0, 0, 6], [0, 5, 6], [0, 5, 0],
  [12, 0, 0], [12, 5, 0], [12, 5, 6], [12, 0, 6],
  [12, 0, 0], [12, 0, 6], [0, 0, 6], [0, 0, 0],
  [0, 5, 0], [0, 5, 6], [12, 5, 6], [12, 5, 0],
];
const shell = {
  nodes: points.map(([x, y, z], index) => ({ id: index + 1, x, y, z })), beams: [],
  envelopePanels: [
    { id: 1, nodeIds: [1, 2, 3, 4], type: "facade", distribution: "twoWay" },
    { id: 2, nodeIds: [5, 6, 7, 8], type: "facade", distribution: "twoWay" },
    { id: 3, nodeIds: [9, 10, 11, 12], type: "facade", distribution: "twoWay" },
    { id: 4, nodeIds: [13, 14, 15, 16], type: "facade", distribution: "twoWay" },
  ],
};
const shellWind = generateFacadeWindLoads(shell, {
  manualPressureKnPerM2: 1, internalPressureCoefficients: [-0.3],
});
const endWallLoads = shellWind.loads.filter((load) => load.direction === "+X"
  && load.cpi === -0.3 && (load.panelId === 1 || load.panelId === 2));
assert.ok(endWallLoads.length >= 2);
const force3dKn = endWallLoads.reduce((sum, load) => sum
  + (load.panelId === 1 ? -1 : 1) * load.qOutwardKnPerM2 * load.triangle.areaM2, 0);
assert.ok(Math.abs(force2dKn - force3dKn) < 1e-8,
  `2D ${force2dKn} kN en 3D ${force3dKn} kN moeten dezelfde X-kracht geven`);

for (const scenario of [
  { name: "overdruk binnen", direction2d: "links", direction3d: "+X", cpi: 0.2,
    pressure: "manual", factor: 1 },
  { name: "omgekeerde richting", direction2d: "rechts", direction3d: "-X", cpi: -0.3,
    pressure: "manual", factor: 1 },
  { name: "berekend profiel met constructiefactor", direction2d: "links", direction3d: "+X",
    cpi: -0.3, pressure: "calculated", factor: 1.3 },
]) {
  const manual = scenario.pressure === "manual";
  const two = genereerWindbelasting(frame, {
    ...STANDAARD_WIND_INSTELLINGEN,
    stuwdrukBron: manual ? "handmatig" : "berekend", qpHandmatig_kNm2: 1,
    windgebied: "II", terreincategorie: "II",
    richtingLinks: scenario.direction2d === "links",
    richtingRechts: scenario.direction2d === "rechts", richtingHaaks: false,
    cpiKeuze: scenario.cpi === 0.2 ? "plus" : "min",
    structuralFactor: scenario.factor,
    hohSpant_m: 5, positieSpant: "tussenspant",
    gebouwlengte_m: 5, afstandTotKopgevel_m: 2.5,
    combinatiesGenereren: false,
  });
  assert.equal(two.ok, true, scenario.name);
  const twoForce = -two.lasten.filter((load) => load.beamId === 1 || load.beamId === 2)
    .reduce((sum, load) => sum + load.q * 6, 0);
  const three = generateFacadeWindLoads(shell, {
    ...(manual ? { manualPressureKnPerM2: 1 } : { windgebied: "II", terreincategorie: "II" }),
    internalPressureCoefficients: [scenario.cpi], structuralFactor: scenario.factor,
  });
  const threeForce = three.loads.filter((load) => load.direction === scenario.direction3d
    && load.cpi === scenario.cpi && (load.panelId === 1 || load.panelId === 2))
    .reduce((sum, load) => sum
      + (load.panelId === 1 ? -1 : 1) * load.qOutwardKnPerM2 * load.triangle.areaM2, 0);
  assert.ok(Math.abs(twoForce - threeForce) < 1e-8,
    `${scenario.name}: 2D ${twoForce} kN en 3D ${threeForce} kN`);
}
console.log("2D/3D-pariteit van Nederlandse gevelwind: geslaagd");

import assert from "node:assert/strict";
import { generateWind3DLoads } from "./src/components/openFem3d/openFem3dWindGeneration.ts";
import { berekenStuwdruk } from "./src/lib/wind/windEurocode.ts";

const coords = [
  [0, 0, 0], [0, 0, 5], [0, 10, 5], [0, 10, 0],
  [20, 0, 0], [20, 10, 0], [20, 10, 5], [20, 0, 5],
  [20, 0, 0], [20, 0, 5], [0, 0, 5], [0, 0, 0],
  [0, 10, 0], [0, 10, 5], [20, 10, 5], [20, 10, 0],
  [0, 0, 5], [20, 0, 5], [20, 10, 5], [0, 10, 5],
];
const model = { nodes: coords.map(([x, y, z], index) => ({ id: index + 1, x, y, z })), beams: [],
  envelopePanels: [
    { id: 1, nodeIds: [1, 2, 3, 4], type: "facade", distribution: "twoWay" },
    { id: 2, nodeIds: [5, 6, 7, 8], type: "facade", distribution: "twoWay" },
    { id: 3, nodeIds: [9, 10, 11, 12], type: "facade", distribution: "twoWay" },
    { id: 4, nodeIds: [13, 14, 15, 16], type: "facade", distribution: "twoWay" },
    { id: 5, nodeIds: [17, 18, 19, 20], type: "roof", distribution: "twoWay" },
  ] };
const settings = { windgebied: "II", terreincategorie: "II" };
const result = generateWind3DLoads(model, settings);
assert.equal(result.cases.length, 16);
const suction = result.cases.find((item) => item.direction === "+X" && item.cpi === 0.2
  && item.key.endsWith("roof:I-suction"));
const pressure = result.cases.find((item) => item.direction === "+X" && item.cpi === 0.2
  && item.key.endsWith("roof:I-pressure"));
const loadsFor = (item) => result.loads.filter((load) => load.caseKey === item.key);
const sum = (items, zone) => items.filter((item) => item.zone === zone)
  .reduce((total, item) => total + item.triangle.areaM2, 0);
assert.ok(loadsFor(suction).some((item) => item.panelId === 1));
assert.ok(loadsFor(pressure).some((item) => item.panelId === 1));
assert.equal(sum(loadsFor(suction), "F"), 5);
assert.equal(sum(loadsFor(suction), "G"), 5);
assert.equal(sum(loadsFor(suction), "H"), 40);
assert.equal(sum(loadsFor(suction), "I"), 150);
const qp = berekenStuwdruk("II", "II", 5).qp_kNm2;
const roofForceSuction = loadsFor(suction).filter((item) => item.panelId === 5)
  .reduce((total, item) => total + item.qOutwardKnPerM2 * item.triangle.areaM2, 0);
const roofForceExpected = qp * (5 * (0.2 + 1.8) + 5 * (0.2 + 1.2)
  + 40 * (0.2 + 0.7) + 150 * (0.2 + 0.2));
assert.ok(Math.abs(roofForceSuction - roofForceExpected) < 1e-8);
assert.ok(loadsFor(pressure).filter((item) => item.panelId === 5 && item.zone === "I").length === 0,
  "zone I met c_pi = c_pe = +0,2 heeft geen vlaklast");
assert.ok(result.warnings[0].includes("beide dakvarianten"));
assert.deepEqual(generateWind3DLoads(model, settings), result);
console.log("3D-windgenerator vlak dak: controles geslaagd");

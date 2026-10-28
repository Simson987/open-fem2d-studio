import assert from "node:assert/strict";
import {
  openFem3DMaximumDisplacementM,
  openFem3DMemberFieldDeflectionMm,
  openFem3DMemberDisplacementStations,
} from "./src/components/openFem3d/openFem3dDisplacement.ts";
import { resolveSection } from "./src/lib/sectionResolver.ts";
import { STEEL_SECTION_DIMS } from "./src/lib/steelSectionDims.generated.ts";

const rotation = 0.0026182294223531335;
const model = {
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, rollAngleRad: 0 }],
};
const result = {
  displacements: [
    { nodeId: 1, ux: 0, uy: 0, uz: 0, rx: 0, ry: rotation, rz: 0 },
    { nodeId: 2, ux: 0, uy: 0, uz: 0, rx: 0, ry: -rotation, rz: 0 },
  ],
  memberForces: [],
};

const stations = openFem3DMemberDisplacementStations(model, model.beams[0], result);
assert.equal(stations.length, 21);
assert.ok(Math.abs(stations[10].t - 0.5) < 1e-12);
assert.ok(Math.abs(stations[10].uz + rotation) < 1e-12,
  "de vervormde vorm moet de veldzakking tussen twee onverplaatste steunpunten tonen");
assert.ok(Math.abs(openFem3DMaximumDisplacementM(model, result) - rotation) < 1e-12,
  "Δmax moet de staafvelden meenemen en mag niet nul blijven bij onverplaatste eindknopen");

const length = 4;
const q = 4;
const loadedBeam = { ...model.beams[0], profileName: "IPE200", material: "S235" };
const momentPoints = Array.from({ length: 21 }, (_, index) => {
  const t = index / 20;
  const x = t * length;
  return { t, value: q * x * (length - x) / 2 };
});
const loadedResult = {
  ...result,
  diagrams: {
    momentY: [{ memberId: 1, points: momentPoints }],
    momentZ: [{ memberId: 1, points: momentPoints.map((point) => ({ ...point, value: 0 })) }],
  },
};
const loadedModel = { ...model, beams: [loadedBeam] };
const iy = resolveSection("S235", "IPE200").I * 1e-12;
const exact = 5 * q * length ** 4 / (384 * 210_000 * 1000 * iy);
const integrated = openFem3DMaximumDisplacementM(loadedModel, loadedResult);
// Zonder dwarskrachtlijn (oude resultaten) is M lineair tussen de 21 lijnpunten.
// Bij 20 gelijke stukken en een vrij opgelegde ligger is de zakking in het midden
// dan precies (1 − 0,8·(1/20)²) = 0,998 maal 5qL⁴/384EI: de fout per stuk is
// q·h³/12 tegen de eenheidsmomentenlijn, samen q·h²·L²/(96·EI).
const LINEAIR = 1 - 0.8 / 20 ** 2;
assert.ok(Math.abs(integrated / exact - LINEAIR) < 1e-12,
  `M/EI-integratie zonder dwarskracht: 0,998 maal de analytische veldzakking (${integrated / exact})`);
assert.ok(Math.abs(openFem3DMemberFieldDeflectionMm(loadedModel, loadedBeam, loadedResult) / 1000 - integrated) < 1e-12);
assert.ok(integrated > rotation * 1.2,
  "de verdeelde belasting moet de door kubische eindinterpolatie gemiste veldkromming toevoegen");

const lateralResult = {
  ...result,
  diagrams: {
    momentY: [{ memberId: 1, points: momentPoints.map((point) => ({ ...point, value: 0 })) }],
    momentZ: [{ memberId: 1, points: momentPoints }],
  },
};
const iz = STEEL_SECTION_DIMS.IPE200.props.iz * 1e-12;
const exactLateral = 5 * q * length ** 4 / (384 * 210_000 * 1000 * iz);
const lateralStations = openFem3DMemberDisplacementStations(loadedModel, loadedBeam, lateralResult);
assert.ok(lateralStations[10].uy > 0, "positief Mz moet de staaf naar lokale +y laten doorbuigen");
assert.ok(Math.abs(lateralStations[10].uy / exactLateral - LINEAIR) < 1e-12,
  "ook de tweede lokale buigas volgt de veldzakking (zonder dwarskracht 0,998 maal, zie boven)");

// #113: met de dwarskrachtlijn van de kern (dM_y/dx = V_z, dM_z/dx = −V_y) is M
// per stuk kubisch en de dubbele integratie exact; de lijn hierboven zonder
// dwarskracht (oude resultaten) blijft lineair per stuk, 0,2 % te laag.
const shearPoints = momentPoints.map((point) => ({ ...point, value: q * (length / 2 - point.t * length) }));
const nul = momentPoints.map((point) => ({ ...point, value: 0 }));
const exactResult = {
  ...result,
  diagrams: {
    momentY: [{ memberId: 1, points: momentPoints }], shearZ: [{ memberId: 1, points: shearPoints }],
    momentZ: [{ memberId: 1, points: nul }], shearY: [{ memberId: 1, points: nul }],
  },
};
const exactIntegrated = openFem3DMaximumDisplacementM(loadedModel, exactResult);
assert.ok(Math.abs(exactIntegrated / exact - 1) < 1e-12,
  `vrij opgelegd: 5qL⁴/384EI exact (${exactIntegrated} tegen ${exact})`);
assert.ok(Math.abs(openFem3DMemberFieldDeflectionMm(loadedModel, loadedBeam, exactResult) / 1000 / exact - 1) < 1e-12,
  "de veldzakking van de staaltoets is exact 5qL⁴/384EI");
const exactLateralResult = {
  ...result,
  diagrams: {
    momentY: [{ memberId: 1, points: nul }], shearZ: [{ memberId: 1, points: nul }],
    momentZ: [{ memberId: 1, points: momentPoints }],
    shearY: [{ memberId: 1, points: shearPoints.map((point) => ({ ...point, value: -point.value })) }],
  },
};
const exactLateralStations = openFem3DMemberDisplacementStations(loadedModel, loadedBeam, exactLateralResult);
assert.ok(Math.abs(exactLateralStations[10].uy / exactLateral - 1) < 1e-12,
  `om de zwakke as ook exact, met dM_z/dx = −V_y (${exactLateralStations[10].uy} tegen ${exactLateral})`);

// Ingeklemd bij x = 0, opgelegd bij x = L, gelijkmatige q: M(x) = −qL²/8 + 5qLx/8 − qx²/2,
// w(x) = q·x²·(L − x)·(3L − 2x)/(48·EI), het maximum bij x ≈ 0,5785·L (geen station).
const ei = 210_000 * 1000 * iy;
const propMoment = momentPoints.map(({ t }) => ({ t, value: -q * length ** 2 / 8 + 5 * q * length * t * length / 8 - q * (t * length) ** 2 / 2 }));
const propShear = momentPoints.map(({ t }) => ({ t, value: 5 * q * length / 8 - q * t * length }));
const propped = {
  displacements: [
    { nodeId: 1, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 },
    { nodeId: 2, ux: 0, uy: 0, uz: 0, rx: 0, ry: -q * length ** 3 / (48 * ei), rz: 0 },
  ],
  memberForces: [],
  diagrams: {
    momentY: [{ memberId: 1, points: propMoment }], shearZ: [{ memberId: 1, points: propShear }],
    momentZ: [{ memberId: 1, points: nul }], shearY: [{ memberId: 1, points: nul }],
  },
};
const wProp = (x) => q * x ** 2 * (length - x) * (3 * length - 2 * x) / (48 * ei);
const propStations = openFem3DMemberDisplacementStations(loadedModel, loadedBeam, propped);
// dw/dx = 0: x·(6L² − 15Lx + 8x²) = 0, dus x* = L·(15 − √33)/16 ≈ 0,5785·L.
const propMax = wProp(length * (15 - Math.sqrt(33)) / 16);
const afwijking = Math.max(...propStations.map((s) => Math.abs(Math.abs(s.uz) - wProp(s.t * length))));
assert.ok(afwijking < 1e-12 * propMax, `ingeklemd–opgelegd: elk station op de analytische lijn (afwijking ${afwijking})`);
const propVeld = openFem3DMemberFieldDeflectionMm(loadedModel, loadedBeam, propped) / 1000;
// De top van de parabool door de drie hoogste van 201 stations: restfout orde δ³ (gemeten 5e-8).
assert.ok(Math.abs(propVeld / propMax - 1) < 1e-7,
  `ingeklemd–opgelegd: grootste veldzakking qL⁴/184,6EI binnen 1e-7, ook tussen de stations (${propVeld} tegen ${propMax})`);

console.log("3D veldverplaatsing en vervormde lijn: geslaagd");

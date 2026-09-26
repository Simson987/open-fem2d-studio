import assert from "node:assert/strict";
import {
  frame3DMaximumDisplacementM,
  frame3DMemberFieldDeflectionMm,
  frame3DMemberDisplacementStations,
} from "./src/components/frame3d/frame3dDisplacement.ts";
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

const stations = frame3DMemberDisplacementStations(model, model.beams[0], result);
assert.equal(stations.length, 21);
assert.ok(Math.abs(stations[10].t - 0.5) < 1e-12);
assert.ok(Math.abs(stations[10].uz + rotation) < 1e-12,
  "de vervormde vorm moet de veldzakking tussen twee onverplaatste steunpunten tonen");
assert.ok(Math.abs(frame3DMaximumDisplacementM(model, result) - rotation) < 1e-12,
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
const integrated = frame3DMaximumDisplacementM(loadedModel, loadedResult);
assert.ok(Math.abs(integrated / exact - 1) < 0.002,
  `M/EI-integratie moet de analytische veldzakking benaderen: ${integrated} versus ${exact}`);
assert.ok(Math.abs(frame3DMemberFieldDeflectionMm(loadedModel, loadedBeam, loadedResult) / 1000 - integrated) < 1e-12);
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
const lateralStations = frame3DMemberDisplacementStations(loadedModel, loadedBeam, lateralResult);
assert.ok(lateralStations[10].uy > 0, "positief Mz moet de staaf naar lokale +y laten doorbuigen");
assert.ok(Math.abs(lateralStations[10].uy / exactLateral - 1) < 0.002,
  "ook de tweede lokale buigas moet de analytische veldzakking volgen");

console.log("3D veldverplaatsing en vervormde lijn: geslaagd");

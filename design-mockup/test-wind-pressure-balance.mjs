import assert from "node:assert/strict";
import { balanceWindCoefficients, balanceWindPressures } from "./src/lib/wind/windPressureBalance.ts";
import { createWindSurfacePressurePlan, parseWindSurfacePressurePlan
} from "./src/lib/wind/windSurfacePressurePlan.ts";

const net = balanceWindCoefficients(0.8, -0.7, 0.2, 1.1);
assert.equal(net.inwardKnPerM2, 0.8 * (-0.7 - 0.2) * 1.1);
assert.equal(net.outwardKnPerM2, (0.2 + 0.7) * 0.8 * 1.1);
assert.equal(net.inwardKnPerM2, -net.outwardKnPerM2);
assert.deepEqual(balanceWindCoefficients(0.8, 0.2, 0.2),
  { inwardKnPerM2: 0, outwardKnPerM2: 0 });

// NBC-style pressures can have different height, gust and exposure factors.
assert.deepEqual(balanceWindPressures(-0.6, -0.2),
  { inwardKnPerM2: -0.39999999999999997, outwardKnPerM2: 0.39999999999999997 });
assert.throws(() => balanceWindCoefficients(-1, 0.8, 0.2), /niet negatief/);
assert.throws(() => balanceWindCoefficients(1, Infinity, 0.2), /eindig/);
assert.throws(() => balanceWindPressures(1, NaN), /eindig/);
const shared = createWindSurfacePressurePlan({
  codeId: "nl-en-1991-1-4-legacy", caseKey: "wind:+X:cpi+0.20", surfaceId: "wall-1",
  zone: "D", source: "EN 1991-1-4", basis: { kind: "common-reference",
    referencePressureKnPerM2: 0.8, externalCoefficient: 0.8, internalCoefficient: 0.2, factor: 1.1 },
});
assert.deepEqual(shared.pressure, balanceWindCoefficients(0.8, 0.8, 0.2, 1.1));
assert.equal(shared.caseKey, "wind:+X:cpi+0.20");
const separate = createWindSurfacePressurePlan({
  codeId: "ca-nbc-2025", caseKey: "wind:+X", surfaceId: "wall-1", zone: "windward",
  source: "NBC 2025", basis: { kind: "separate-pressures",
    externalPressureKnPerM2: 0.8, internalPressureKnPerM2: -0.2 },
});
assert.deepEqual(separate.pressure, balanceWindPressures(0.8, -0.2));
assert.deepEqual(parseWindSurfacePressurePlan(separate), separate);
assert.throws(() => parseWindSurfacePressurePlan({ ...separate,
  pressure: { ...separate.pressure, outwardKnPerM2: 0 } }), /komt niet overeen/);
assert.throws(() => createWindSurfacePressurePlan({ ...shared, codeId: "" }), /mist codeId/);
assert.throws(() => createWindSurfacePressurePlan({ ...shared, basis: { kind: "unknown" } }), /onbekende drukbasis/);
console.log("Winddrukbalans: tekens, afzonderlijke drukken en invoercontrole geslaagd");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { solveNativeCrackWidth } from "./src/lib/nativeFemClient.ts";
import {
  buildCrackWidthInput,
  CRACK_WIDTH_INPUT_FIELDS,
  INITIAL_CRACK_WIDTH_INPUT_TEXT,
} from "./src/lib/prestressedBeamCrackWidth.ts";

const fixture = JSON.parse(readFileSync(new URL("../src-tauri/crates/native-fem/examples/ec2-bonded-prestress-crack-width.json", import.meta.url), "utf8"));
const text = { ...INITIAL_CRACK_WIDTH_INPUT_TEXT,
  sigmaSMpa: "120", widthMm: "300", heightMm: "600", effectiveDepthMm: "540",
  neutralAxisMm: "120", effectiveBondedPrestressingAreaMm2: "588",
  coverToLongitudinalSteelMm: "60", barOrTendonDiameterMm: "15.2", spacingMm: "100",
  fCkMpa: "40", fCtEffMpa: "3.5", eCmMpa: "35220", kT: "0.4", k1: "1.6",
  k2: "0.5", wMaxMm: "0.2",
};
const input = buildCrackWidthInput(text);
assert.deepEqual({ bondedReinforcementAreaMm2: 0, ...input }, fixture.input);
assert.equal(CRACK_WIDTH_INPUT_FIELDS.length, 17);
assert.throws(() => buildCrackWidthInput(INITIAL_CRACK_WIDTH_INPUT_TEXT), /Vul alle verplichte waarden/);
assert.throws(() => buildCrackWidthInput({ ...text,
  bondedReinforcementAreaMm2: "", effectiveBondedPrestressingAreaMm2: "",
}), /Vul een positief hechtend/);
assert.throws(() => buildCrackWidthInput({ ...text,
  bondedReinforcementAreaMm2: "-10",
}), /Hechtende wapeningsoppervlakken mogen niet negatief zijn/);
assert.throws(() => buildCrackWidthInput({ ...text, spacingMm: "0" }),
  /De opgegeven steek van de langswapening moet positief zijn/);
assert.throws(() => buildCrackWidthInput({ ...text, sigmaSMpa: "Infinity" }), /moeten eindig zijn/);

const originalFetch = globalThis.fetch;
let request;
let corruptResult = null;
globalThis.fetch = async (url, options) => {
  request = { url, body: JSON.parse(options.body) };
  if (corruptResult === "null") return new Response(JSON.stringify({ kind: "crackWidth", result: null }), {
    status: 200, headers: { "content-type": "application/json" },
  });
  const result = {
    effectiveTensionHeightMm: 150, effectiveConcreteAreaMm2: 45000,
    effectiveReinforcementRatio: 0.0130666666667, strainDifference: 0.00036,
    tensionStiffeningFloorGoverns: true, maximumCrackSpacingMm: 273.6,
    crackSpacingEquation: "7.11 NB-bovengrens", crackWidthMm: 0.098496,
    allowableCrackWidthMm: 0.2, utilization: 0.49248, passes: true,
  };
  if (corruptResult === "nonfinite") result.crackWidthMm = Number.NaN;
  if (corruptResult === "bad-equation") result.crackSpacingEquation = "unknown";
  if (corruptResult === "inconsistent") result.passes = false;
  if (corruptResult === "over-limit") {
    result.crackWidthMm = 0.25;
    result.utilization = 1.25;
    result.passes = false;
  }
  return new Response(JSON.stringify({ kind: "crackWidth", result }), { status: 200,
    headers: { "content-type": "application/json" } });
};
try {
  const result = await solveNativeCrackWidth(input);
  assert.equal(request.url, "/api/toetsing");
  assert.deepEqual(request.body, { opdracht: "solve_native_fem", inputs: { kind: "crackWidth", input } });
  assert.equal(result.crackWidthMm, 0.098496);
  assert.equal(result.crackSpacingEquation, "7.11 NB-bovengrens");
  assert.equal(result.passes, true);
  corruptResult = "over-limit";
  const exceeded = await solveNativeCrackWidth(input);
  assert.equal(exceeded.crackWidthMm, 0.25);
  assert.equal(exceeded.utilization, 1.25);
  assert.equal(exceeded.passes, false);
  for (const corruption of ["nonfinite", "null", "bad-equation", "inconsistent"]) {
    corruptResult = corruption;
    await assert.rejects(solveNativeCrackWidth(input),
      /Rust-scheurwijdtecontrole leverde onvolledige of ongeldige resultaten terug/);
  }
} finally {
  globalThis.fetch = originalFetch;
}

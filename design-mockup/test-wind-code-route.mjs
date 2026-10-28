import assert from "node:assert/strict";
import { calculateWindReferencePressure, NEDERLANDSE_WINDROUTE,
  requireWindCodeId, windCodeIdFromProjectInfo } from "./src/lib/wind/windCodeRoute.ts";
import { berekenStuwdruk, handmatigeStuwdruk } from "./src/lib/wind/windEurocode.ts";
import { genereerWindbelasting, STANDAARD_WIND_INSTELLINGEN } from "./src/lib/wind/windGenerator.ts";

for (const heightM of [2, 6, 25]) {
  assert.deepEqual(calculateWindReferencePressure({ source: "calculated", windgebied: "II",
    terreincategorie: "III" }, heightM), berekenStuwdruk("II", "III", heightM));
  assert.deepEqual(calculateWindReferencePressure({ codeId: NEDERLANDSE_WINDROUTE,
    source: "manual", pressureKnPerM2: 1.2 }, heightM), handmatigeStuwdruk(1.2, heightM));
}
assert.equal(requireWindCodeId(undefined), NEDERLANDSE_WINDROUTE);
assert.equal(windCodeIdFromProjectInfo({}), NEDERLANDSE_WINDROUTE);
assert.equal(windCodeIdFromProjectInfo({ uitgangspunten: {} }), NEDERLANDSE_WINDROUTE);
assert.equal(windCodeIdFromProjectInfo({ uitgangspunten: { windCodeId: NEDERLANDSE_WINDROUTE } }),
  NEDERLANDSE_WINDROUTE);
assert.equal(windCodeIdFromProjectInfo({ uitgangspunten: { windCodeId: "asce-7-22" } }), "asce-7-22");
assert.throws(() => requireWindCodeId("asce-7-22"), /niet beschikbaar/);
assert.throws(() => calculateWindReferencePressure({ codeId: "asce-7-22", source: "manual",
  pressureKnPerM2: 1.2 }, 6), /niet beschikbaar/);
const manualWithSource = calculateWindReferencePressure({ source: "manual",
  pressureKnPerM2: 1.2, pressureSource: "  Projectrapport W-42, tabel 3  " }, 6);
assert.equal(manualWithSource.afleiding[0].bron, "Projectrapport W-42, tabel 3");
assert.equal(manualWithSource.qp_kNm2, handmatigeStuwdruk(1.2, 6).qp_kNm2);
assert.match(handmatigeStuwdruk(1.2, 6, 123).afleiding[0].bron, /door de gebruiker opgegeven/);

const model = { nodes: [
  { id: 1, x: 0, z: 0 }, { id: 2, x: 12000, z: 0 },
  { id: 3, x: 0, z: 6000 }, { id: 4, x: 12000, z: 6000 },
], beams: [
  { id: 1, from: 1, to: 3 }, { id: 2, from: 2, to: 4 }, { id: 3, from: 3, to: 4 },
], loadCases: [{ id: 1, name: "Eigen gewicht", type: "dead" }] };
const old = { ...STANDAARD_WIND_INSTELLINGEN, windCodeId: undefined };
const legacy = genereerWindbelasting(model, old);
const explicit = genereerWindbelasting(model, { ...old, windCodeId: NEDERLANDSE_WINDROUTE });
assert.equal(legacy.ok, true);
assert.deepEqual(explicit, legacy, "expliciete route behoudt alle 2D-resultaten");
const unsupported = genereerWindbelasting(model, { ...old, windCodeId: "asce-7-22" });
assert.equal(unsupported.ok, false);
assert.match(unsupported.meldingen[0].tekst, /niet beschikbaar/);
const manualGenerated = genereerWindbelasting(model, { ...old,
  stuwdrukBron: "handmatig", qpHandmatig_kNm2: 1.2,
  qpHandmatigBron: "Projectrapport W-42, tabel 3" });
assert.equal(manualGenerated.ok, true);
assert.equal(manualGenerated.samenvatting.stuwdruk.afleiding[0].bron,
  "Projectrapport W-42, tabel 3");

console.log("Windnormroute: oude NL-uitvoer identiek, onbekende route geweigerd");

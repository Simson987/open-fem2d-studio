import assert from "node:assert/strict";
import { standaardRegister } from "./src/api/standaardRegister.ts";
import { documentNaarTekst, documentUitTekst, leegDocument } from "./src/api/projectDocument.ts";
import { NEDERLANDSE_WINDROUTE } from "./src/lib/wind/windCodeRoute.ts";
import { berekenStuwdruk } from "./src/lib/wind/windEurocode.ts";
import { parseOpenFem3DModel } from "./src/components/openFem3d/openFem3dModel.ts";

const register = standaardRegister();
const name = "model3d.envelope.generateLoads";
assert.ok(register.heeft(name));
const document = { ...leegDocument(), model3d: {
  nodes: [
    { id: 1, x: 0, y: 0, z: 5 }, { id: 2, x: 10, y: 0, z: 5 },
    { id: 3, x: 10, y: 10, z: 5 }, { id: 4, x: 0, y: 10, z: 5 },
  ], beams: [], envelopePanels: [{ id: 1, nodeIds: [1, 2, 3, 4], type: "roof",
    distribution: "twoWay", claddingWeightKnPerM2: 0.2 }],
} };
const input = { groundSnowKnPerM2: 0.7 };
const first = register.voerUit(name, input, { document });
assert.ok(first.document.model3d.loadPanels.length > 0);
assert.ok(first.document.loadCases.some((item) => item.gegenereerd?.bron === "envelope3d"));
assert.ok(first.uitkomst.caseIds.length >= 2);
for (const id of first.uitkomst.caseIds) {
  assert.ok(first.document.combinations.some((item) => item.type === "uls" && Number(item.factors[id]) > 0),
    `gegenereerd geval ${id} telt mee in UGT`);
  assert.ok(first.document.combinations.some((item) => item.type === "sls" && Number(item.factors[id]) > 0),
    `gegenereerd geval ${id} telt mee in BGT`);
}
const second = register.voerUit(name, input, { document: first.document });
assert.equal(second.uitkomst.changed, false, "dezelfde generatie is idempotent");
assert.equal(second.document, first.document);
assert.throws(() => register.voerUit(name, { windgebied: "II" }, { document }),
  /zowel windgebied als terreincategorie/);
const facadeCoords = [
  [0, 0, 0], [0, 0, 5], [0, 10, 5], [0, 10, 0],
  [20, 0, 0], [20, 10, 0], [20, 10, 5], [20, 0, 5],
  [20, 0, 0], [20, 0, 5], [0, 0, 5], [0, 0, 0],
  [0, 10, 0], [0, 10, 5], [20, 10, 5], [20, 10, 0],
  [0, 0, 5], [20, 0, 5], [20, 10, 5], [0, 10, 5],
];
const windDocument = { ...leegDocument(), model3d: {
  nodes: facadeCoords.map(([x, y, z], index) => ({ id: index + 1, x, y, z })), beams: [],
  envelopePanels: [
    [1, [1, 2, 3, 4], "facade"], [2, [5, 6, 7, 8], "facade"],
    [3, [9, 10, 11, 12], "facade"], [4, [13, 14, 15, 16], "facade"],
    [5, [17, 18, 19, 20], "roof"],
  ].map(([id, nodeIds, type]) => ({ id, nodeIds, type, distribution: "twoWay" })),
} };
const windInput = { windgebied: "II", terreincategorie: "II", groundSnowKnPerM2: 0.7 };
const windResult = register.voerUit(name, windInput, { document: windDocument });
const explicitWind = register.voerUit(name, { ...windInput, windCodeId: NEDERLANDSE_WINDROUTE },
  { document: windDocument });
assert.deepEqual(explicitWind, windResult, "expliciete route behoudt alle 3D-resultaten");
const projectWithRoute = { ...windDocument, projectInfo: { uitgangspunten: { windCodeId: NEDERLANDSE_WINDROUTE } } };
const projectWindResult = register.voerUit(name, windInput, { document: projectWithRoute });
assert.deepEqual(projectWindResult.document.model3d.loadPanels, windResult.document.model3d.loadPanels,
  "API gebruikt de projectroute voor dezelfde 3D-windlasten");
assert.throws(() => register.voerUit(name, { ...windInput, windCodeId: "nl-en-1991-1-4-legacy" },
  { document: { ...windDocument, projectInfo: { uitgangspunten: { windCodeId: "asce-7-22" } } } }),
  /wijkt af/);
assert.throws(() => register.voerUit(name, windInput,
  { document: { ...windDocument, projectInfo: { uitgangspunten: { windCodeId: "asce-7-22" } } } }),
  /niet beschikbaar/);
assert.throws(() => register.voerUit(name, { ...windInput, windCodeId: "asce-7-22" },
  { document: windDocument }));
assert.ok(windResult.document.model3d.loadPanels.length > 100);
assert.ok(windResult.document.loadCases.some((item) => item.type === "wind" && item.gegenereerd?.bron === "envelope3d"));
assert.ok(windResult.document.loadCases.filter((item) => item.type === "wind" && item.gegenereerd?.bron === "envelope3d")
  .every((item) => item.gegenereerd.windCodeId === NEDERLANDSE_WINDROUTE));
const windPanels = windResult.document.model3d.loadPanels
  .filter((panel) => panel.generated?.internalPressureCoefficient !== undefined);
assert.ok(windPanels.some((panel) => panel.generated.panelId === 5), "ook dakwind bewaart de drukafleiding");
assert.ok(windPanels.some((panel) => panel.generated.panelId !== 5), "ook gevelwind bewaart de drukafleiding");
assert.ok(windPanels.every((panel) => panel.generated.windCodeId === NEDERLANDSE_WINDROUTE));
assert.ok(windPanels.every((panel) => panel.generated.windStructuralFactor === 1));
assert.ok(windPanels.every((panel) => panel.generated.windPressureMethod === "en-terreinprofiel"));
assert.ok(windPanels.every((panel) => panel.generated.windInternalPressureDerivation?.some(
  (line) => line.symbool === "c_pi")));
assert.ok(windPanels.every((panel) => panel.generated.windReferenceHeightM > 0
  && panel.generated.windPressureDerivation?.some((line) => line.symbool === "q_p(z_e)")));
const firstWind = windPanels[0].generated;
assert.deepEqual(firstWind.windPressureDerivation,
  berekenStuwdruk("II", "II", firstWind.windReferenceHeightM).afleiding,
  "opgeslagen afleiding hoort bij de werkelijk gebruikte hoogte");
const manualInput = { manualPressureKnPerM2: 0.9,
  manualPressureSource: "Projectspecifieke NB-tabel, dossier W-17" };
const manualWind = register.voerUit(name, manualInput, { document: windDocument });
const manualPanels = manualWind.document.model3d.loadPanels
  .filter((panel) => panel.generated?.internalPressureCoefficient !== undefined);
assert.ok(manualPanels.some((panel) => panel.generated.panelId === 5));
assert.ok(manualPanels.some((panel) => panel.generated.panelId !== 5));
assert.ok(manualPanels.every((panel) => panel.generated.referencePressureKnPerM2 === 0.9));
assert.ok(manualPanels.every((panel) => panel.generated.windPressureMethod === "handmatig-opgegeven"));
assert.ok(manualPanels.every((panel) => panel.generated.windPressureDerivation[0].bron === manualInput.manualPressureSource));
const calculatedByKey = new Map(windPanels.map((panel) => [panel.generated.key, panel]));
for (const panel of manualPanels) {
  const calculated = calculatedByKey.get(panel.generated.key);
  assert.ok(calculated, `belastingvlak ${panel.generated.key} bestaat ook op het berekende pad`);
  const expected = calculated.q * 0.9 / calculated.generated.referencePressureKnPerM2;
  assert.ok(Math.abs(panel.q - expected) < 1e-10,
    `handmatige druk schaalt dezelfde gevel- en daklast zonder andere coëfficiënten`);
}
const restoredManual = documentUitTekst(documentNaarTekst(manualWind.document));
assert.deepEqual(restoredManual.model3d.loadPanels, manualWind.document.model3d.loadPanels);
assert.equal(register.voerUit(name, manualInput, { document: manualWind.document }).uitkomst.changed, false);
assert.throws(() => register.voerUit(name, { ...manualInput, windgebied: "II", terreincategorie: "II" },
  { document: windDocument }), /Kies óf handmatige stuwdruk/);
assert.throws(() => register.voerUit(name, { manualPressureKnPerM2: 0 },
  { document: windDocument }));
assert.throws(() => register.voerUit(name, { manualPressureSource: "zonder waarde" },
  { document: windDocument }), /vraagt ook de handmatige stuwdruk/);
const factoredWind = register.voerUit(name, { ...windInput, structuralFactor: 1.4 },
  { document: windDocument });
const factoredPanels = factoredWind.document.model3d.loadPanels
  .filter((panel) => panel.generated?.internalPressureCoefficient !== undefined);
assert.ok(factoredPanels.every((panel) => panel.generated.windStructuralFactor === 1.4));
for (const panel of factoredPanels) {
  const baseline = calculatedByKey.get(panel.generated.key);
  assert.ok(baseline);
  assert.ok(Math.abs(panel.q - baseline.q * 1.4) < 1e-10);
}
assert.deepEqual(documentUitTekst(documentNaarTekst(factoredWind.document)).model3d.loadPanels,
  factoredWind.document.model3d.loadPanels);
assert.throws(() => parseOpenFem3DModel({ ...factoredWind.document.model3d,
  loadPanels: [{ ...factoredPanels[0], generated: { ...factoredPanels[0].generated,
    windStructuralFactor: 0 } }] }), /ongeldige herkomst/);
const oldWindPanel = { ...windPanels[0], generated: { ...firstWind } };
delete oldWindPanel.generated.windReferenceHeightM;
delete oldWindPanel.generated.windPressureDerivation;
delete oldWindPanel.generated.windPressureMethod;
parseOpenFem3DModel({ ...windResult.document.model3d, loadPanels: [oldWindPanel] });
assert.throws(() => parseOpenFem3DModel({ ...windResult.document.model3d,
  loadPanels: [{ ...windPanels[0], generated: { ...firstWind,
    windPressureDerivation: [{ symbool: "q_p(z_e)", waarde: "", bron: "x" }] } }],
}), /ongeldige herkomst/, "ongeldige afleiding wordt niet stilzwijgend bewaard");
assert.throws(() => parseOpenFem3DModel({ ...windResult.document.model3d,
  loadPanels: [{ ...windPanels[0], generated: { ...firstWind,
    windInternalPressureDerivation: [{ symbool: "c_pi", waarde: "", bron: "x" }] } }],
}), /ongeldige herkomst/, "ongeldige binnendrukbron wordt niet bewaard");
const restoredWind = documentUitTekst(documentNaarTekst(windResult.document));
assert.deepEqual(restoredWind.loadCases, windResult.document.loadCases, "windroute blijft bewaard op belastinggevallen");
assert.deepEqual(restoredWind.model3d.loadPanels, windResult.document.model3d.loadPanels,
  "windroute blijft bewaard op 3D-belastingvlakken");
assert.equal(register.voerUit(name, windInput, { document: windResult.document }).uitkomst.changed, false);
console.log("API 3D-schillasten: controles geslaagd");

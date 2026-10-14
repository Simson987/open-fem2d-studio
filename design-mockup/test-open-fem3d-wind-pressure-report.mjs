import assert from "node:assert/strict";
import { register } from "node:module";
import { berekenStuwdruk } from "./src/lib/wind/windEurocode.ts";
import { NEDERLANDSE_WINDROUTE } from "./src/lib/wind/windCodeRoute.ts";
import { parseOpenFem3DModel } from "./src/components/openFem3d/openFem3dModel.ts";
import { openFem3DWindPressureReport } from "./src/components/openFem3d/openFem3dWindPressureReport.ts";
import { createWindSurfacePressurePlan } from "./src/lib/wind/windSurfacePressurePlan.ts";

const pressure = berekenStuwdruk("II", "II", 5);
const generated = {
  source: "envelope3d", key: "wind:gevel:1", panelId: 1, zone: "D",
  coefficient: 0.8, internalPressureCoefficient: -0.2,
  referencePressureKnPerM2: pressure.qp_kNm2,
  windCodeId: NEDERLANDSE_WINDROUTE,
  windStructuralFactor: 1.4,
  windReferenceHeightM: pressure.ze_m,
  windPressureMethod: "en-terreinprofiel",
  windPressureDerivation: pressure.afleiding,
  windInternalPressureDerivation: [{ symbool: "c_pi", waarde: "-0,2",
    bron: "Projectdocument B-17" }],
  sourceReference: "NEN-EN 1991-1-4 tabel 7.1",
};
const panel = { id: 1, nodeIds: [1, 2, 3, 4], caseId: 1,
  q: -pressure.qp_kNm2, direction: "normal", distribution: "twoWay", generated };
const model = parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 5 },
    { id: 3, x: 0, y: 10, z: 5 }, { id: 4, x: 0, y: 10, z: 0 },
  ], beams: [], envelopePanels: [{ id: 1, nodeIds: [1, 2, 3, 4], type: "facade",
    distribution: "twoWay" }], loadPanels: [panel],
});
const grouped = openFem3DWindPressureReport([model.loadPanels[0],
  { ...model.loadPanels[0], id: 2 }]);
assert.equal(grouped.sources.length, 1);
assert.deepEqual(grouped.sources[0].loadPanelIds, [1, 2]);
assert.equal(grouped.sources[0].pressureMethod, "en-terreinprofiel");
assert.deepEqual(grouped.missingPanelIds, []);
assert.equal(grouped.internalSources.length, 1);
assert.deepEqual(grouped.internalSources[0].loadPanelIds, [1, 2]);
assert.deepEqual(grouped.missingInternalPanelIds, []);
const manualSource = "Projectspecifieke NB-tabel, dossier W-17";
const manualPanel = { ...panel, generated: { ...generated,
  referencePressureKnPerM2: 0.9,
  windPressureMethod: "handmatig-opgegeven",
  windPressureDerivation: [{ symbool: "q_p(z_e)", waarde: "0,9000 kN/m² — handmatig ingevoerd",
    bron: manualSource }] } };
const manualReport = openFem3DWindPressureReport([manualPanel]);
assert.equal(manualReport.missingPanelIds.length, 0);
assert.equal(manualReport.sources[0].pressureKnPerM2, 0.9);
assert.equal(manualReport.sources[0].derivation[0].bron, manualSource);
assert.equal(manualReport.sources[0].pressureMethod, "handmatig-opgegeven");
const legacyMethodPanel = { ...panel, generated: { ...generated } };
delete legacyMethodPanel.generated.windPressureMethod;
assert.equal(openFem3DWindPressureReport([legacyMethodPanel]).sources[0].pressureMethod, undefined);
const oldPanel = { ...panel, generated: { ...generated } };
delete oldPanel.generated.windReferenceHeightM;
delete oldPanel.generated.windPressureDerivation;
delete oldPanel.generated.windPressureMethod;
assert.deepEqual(openFem3DWindPressureReport([oldPanel]).missingPanelIds, [1]);
const oldInternalPanel = { ...panel, generated: { ...generated } };
delete oldInternalPanel.generated.windInternalPressureDerivation;
assert.deepEqual(openFem3DWindPressureReport([oldInternalPanel]).missingInternalPanelIds, [1]);

register("data:text/javascript," + encodeURIComponent(
  "export async function load(url, ctx, next) {"
  + " if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };"
  + " return next(url, ctx); }",
));
const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const i18next = (await import("i18next")).default;
const { initReactI18next } = await import("react-i18next");
const ribbon = (await import("./src/i18n/locales/nl/ribbon.json", { with: { type: "json" } })).default;
const common = (await import("./src/i18n/locales/nl/common.json", { with: { type: "json" } })).default;
const enRibbon = (await import("./src/i18n/locales/en/ribbon.json", { with: { type: "json" } })).default;
const enCommon = (await import("./src/i18n/locales/en/common.json", { with: { type: "json" } })).default;
await i18next.use(initReactI18next).init({ lng: "nl", resources: { nl: { ribbon, common },
  en: { ribbon: enRibbon, common: enCommon } },
  defaultNS: "common", initImmediate: false });
const Report = (await import("./src/components/openFem3d/OpenFem3DReport.tsx")).default;
const html = renderToStaticMarkup(React.createElement(Report, {
  model, result: null, activeLoadCaseId: 1,
}));
assert.match(html, /Winddruk — afleiding van de referentiedruk/);
assert.match(html, /q_p\(z_e\)/);
assert.match(html, /nl-en-1991-1-4-legacy/);
assert.match(html, /EN-terreinprofiel/);
assert.match(html, /<th>c<sub>s<\/sub>·c<sub>d<\/sub><\/th>/);
assert.match(html, /<td>1,4<\/td>/);
assert.match(html, /Binnendruk — afleiding van c_pi/);
assert.match(html, /Projectdocument B-17/);
assert.doesNotMatch(html, /oudere windvlakken ontbreekt de drukafleiding/);
await i18next.changeLanguage("en");
const englishHtml = renderToStaticMarkup(React.createElement(Report, {
  model, result: null, activeLoadCaseId: 1,
}));
assert.match(englishHtml, /EN terrain profile/);
assert.doesNotMatch(englishHtml, /EN-terreinprofiel/);
await i18next.changeLanguage("nl");
const oldHtml = renderToStaticMarkup(React.createElement(Report, {
  model: parseOpenFem3DModel({ ...model, loadPanels: [oldPanel] }), result: null,
  activeLoadCaseId: 1,
}));
assert.match(oldHtml, /oudere windvlakken ontbreekt de drukafleiding/);
const oldInternalHtml = renderToStaticMarkup(React.createElement(Report, {
  model: parseOpenFem3DModel({ ...model, loadPanels: [oldInternalPanel] }), result: null,
  activeLoadCaseId: 1,
}));
assert.match(oldInternalHtml, /oudere windvlakken ontbreekt de afleiding van c_pi/);
const nbcPlan = createWindSurfacePressurePlan({
  codeId: "ca-nbc-2025", caseKey: "nbc2025:uls:+X:cpi:0.2", surfaceId: "x-min-wall",
  zone: "x-min-wall", source: "NBC 2025 4.1.7.3 and 4.1.7.5",
  basis: { kind: "separate-pressures", externalPressureKnPerM2: 0.8,
    internalPressureKnPerM2: 0.2 },
});
const nbcPanel = { ...panel, q: nbcPlan.pressure.outwardKnPerM2,
  generated: { ...generated, zone: "x-min-wall",
  windCodeId: "ca-nbc-2025", windStructuralFactor: undefined,
  windPressureMethod: "nbc-static", windPressurePlan: nbcPlan,
  windPressureDerivation: [
    { symbool: "q (1/500)", waarde: "0.5", bron: "project q source" },
    { symbool: "C_ei", waarde: "0.9", bron: "NBC 2025 4.1.7.3" },
  ],
  windInternalPressureDerivation: [{ symbool: "C_pi", waarde: "0.2", bron: "project Cpi source" }],
  sourceReference: nbcPlan.source,
} };
const nbcModel = parseOpenFem3DModel({ ...model, loadPanels: [nbcPanel] });
const nbcHtml = renderToStaticMarkup(React.createElement(Report, {
  model: nbcModel, result: null, activeLoadCaseId: 1,
}));
assert.match(nbcHtml, /NBC 2025 statische procedure/);
assert.match(nbcHtml, /C_ei/);
assert.match(nbcHtml, /p<sub>e<\/sub>/);
assert.match(nbcHtml, /p<sub>i<\/sub>/);
assert.match(nbcHtml, /p<sub>net<\/sub>/);
assert.doesNotMatch(nbcHtml, /q<sub>p<\/sub> =/);
await i18next.changeLanguage("en");
const nbcEnglish = renderToStaticMarkup(React.createElement(Report, {
  model: nbcModel, result: null, activeLoadCaseId: 1,
}));
assert.match(nbcEnglish, /NBC 2025 static procedure/);
console.log("3D-rapport toont opgeslagen winddrukafleiding en migratiemelding: geslaagd");

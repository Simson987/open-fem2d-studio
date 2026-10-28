import assert from "node:assert/strict";
import { register } from "node:module";
import { berekenStuwdruk } from "./src/lib/wind/windEurocode.ts";
import { calculateWindReferencePressure, NEDERLANDSE_WINDROUTE } from "./src/lib/wind/windCodeRoute.ts";
import { windPressureReport2d } from "./src/lib/wind/windPressureReport2d.ts";
import { serializeProject, deserializeProject } from "./src/io/projectFile.ts";

const basis = berekenStuwdruk("II", "II", 6);
const kolom = berekenStuwdruk("II", "II", 2.5);
const caseOf = (id, name, pressure = basis) => ({
  id, name, type: "wind", gegenereerd: { bron: "wind", sleutel: `wind:${id}`,
    windCodeId: NEDERLANDSE_WINDROUTE, windStuwdruk: pressure },
});
const manualSource = "Projectberekening W-42, tabel 3";
const manualPressure = calculateWindReferencePressure({ source: "manual",
  pressureKnPerM2: 0.95, pressureSource: manualSource }, 6);
const cases = [caseOf(1, "Wind links"), caseOf(2, "Wind rechts"),
  caseOf(3, "Wind handmatig", manualPressure)];
const loads = [{ id: 1, type: "lineLoad", caseId: 1, beamId: 4, q: 1,
  gegenereerdDoor: "wind", windStuwdruk: kolom }];
const saved = deserializeProject(serializeProject({
  modelDimension: "2d", nodes: [], beams: [], supports: [], plates: [],
  loads, loadCases: cases, activeLoadCaseId: 1, selfWeightEnabled: false,
  nonlinearEnabled: false,
}));
const report = windPressureReport2d(saved.loadCases, saved.loads);
assert.equal(report.sources.length, 3);
assert.deepEqual(report.sources[0].cases, ["Wind links", "Wind rechts"]);
assert.equal(report.sources[0].pressure.ze_m, 6);
assert.equal(report.sources[0].pressure.drukmethode, "en-terreinprofiel");
assert.deepEqual(report.sources[1].beams, [4]);
assert.equal(report.sources[1].pressure.ze_m, 2.5);
assert.ok(report.sources[1].pressure.afleiding.length > 0);
assert.equal(report.sources[2].pressure.afleiding[0].bron, manualSource);
assert.equal(report.sources[2].pressure.drukmethode, "handmatig-opgegeven");
assert.deepEqual(report.missingCases, []);

const old = { ...caseOf(3, "Oude wind") };
delete old.gegenereerd.windStuwdruk;
assert.deepEqual(windPressureReport2d([old], []).missingCases, ["Oude wind"]);
assert.deepEqual(windPressureReport2d([{
  ...caseOf(4, "Beschadigd"), gegenereerd: { ...caseOf(4, "Beschadigd").gegenereerd,
    windStuwdruk: { qp_kNm2: 1, ze_m: 6, afleiding: [{ symbool: 4 }] } },
}], []).missingCases, ["Beschadigd"]);

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
const deRibbon = (await import("./src/i18n/locales/de/ribbon.json", { with: { type: "json" } })).default;
const deCommon = (await import("./src/i18n/locales/de/common.json", { with: { type: "json" } })).default;
const frRibbon = (await import("./src/i18n/locales/fr/ribbon.json", { with: { type: "json" } })).default;
const frCommon = (await import("./src/i18n/locales/fr/common.json", { with: { type: "json" } })).default;
await i18next.use(initReactI18next).init({ lng: "nl", resources: { nl: { ribbon, common },
  en: { ribbon: enRibbon, common: enCommon }, de: { ribbon: deRibbon, common: deCommon },
  fr: { ribbon: frRibbon, common: frCommon } },
  defaultNS: "common", initImmediate: false });
const { ReportDataProvider, EMPTY_REPORT_DATA } = await import("./src/components/report/ReportDataContext.tsx");
const ProjectSection = (await import("./src/components/report/sections/ProjectSection.tsx")).default;
const html = renderToStaticMarkup(React.createElement(ReportDataProvider,
  { value: { ...EMPTY_REPORT_DATA, loadCases: saved.loadCases, loads: saved.loads } },
  React.createElement(ProjectSection)));
assert.match(html, /Winddruk 2D — bewaarde afleiding/);
assert.match(html, /q_p\(z_e\)/);
assert.match(html, /staaf 4/);
assert.match(html, /Projectberekening W-42, tabel 3/);
assert.match(html, /EN-terreinprofiel/);
assert.match(html, /handmatig opgegeven druk/);
assert.doesNotMatch(html, /oudere windgevallen ontbreekt/);
assert.ok(html.indexOf("</table>", html.indexOf('class="rpt-meta-table"'))
  < html.indexOf('class="rpt-wind-pressure-2d"'), "drukafleiding staat buiten de smalle metadata-tabel");
await i18next.changeLanguage("en");
const englishHtml = renderToStaticMarkup(React.createElement(ReportDataProvider,
  { value: { ...EMPTY_REPORT_DATA, loadCases: saved.loadCases, loads: saved.loads } },
  React.createElement(ProjectSection)));
assert.match(englishHtml, /EN terrain profile/);
assert.match(englishHtml, /user-supplied pressure/);
assert.doesNotMatch(englishHtml, /handmatig opgegeven druk/);
for (const [language, calculated, manual] of [
  ["de", /EN-Geländeprofil/, /manuell vorgegebener Druck/],
  ["fr", /profil de terrain EN/, /pression saisie manuellement/],
]) {
  await i18next.changeLanguage(language);
  const translatedHtml = renderToStaticMarkup(React.createElement(ReportDataProvider,
    { value: { ...EMPTY_REPORT_DATA, loadCases: saved.loadCases, loads: saved.loads } },
    React.createElement(ProjectSection)));
  assert.match(translatedHtml, calculated);
  assert.match(translatedHtml, manual);
}
console.log("2D-winddruk blijft na opslaan per referentiehoogte controleerbaar: geslaagd");

import assert from "node:assert/strict";
import { register } from "node:module";
import { genereerWindbelasting, STANDAARD_WIND_INSTELLINGEN } from "./src/lib/wind/windGenerator.ts";
import { NEDERLANDSE_WINDROUTE } from "./src/lib/wind/windCodeRoute.ts";
import { windZoneReport2d } from "./src/lib/wind/windZoneReport2d.ts";
import { serializeProject, deserializeProject } from "./src/io/projectFile.ts";

const nodes = [
  { id: 1, x: 0, z: 0 }, { id: 2, x: 12000, z: 0 },
  { id: 3, x: 0, z: 6000 }, { id: 4, x: 12000, z: 6000 },
];
const beams = [
  { id: 1, from: 1, to: 3 }, { id: 2, from: 2, to: 4 },
  { id: 3, from: 3, to: 4 },
];
const dead = { id: 1, name: "Eigen gewicht", type: "dead" };
const result = genereerWindbelasting({ nodes, beams, loadCases: [dead] }, {
  ...STANDAARD_WIND_INSTELLINGEN, stuwdrukBron: "handmatig", qpHandmatig_kNm2: 1,
  richtingLinks: true, richtingRechts: false, richtingHaaks: false,
  cpiKeuze: "min", combinatiesGenereren: false, structuralFactor: 1.25,
});
assert.equal(result.ok, true);
assert.ok(result.samenvatting);
const cases = result.gevallen.map((geval, index) => ({
  id: index + 2, name: geval.naam, type: "wind",
  gegenereerd: { bron: "wind", sleutel: geval.sleutel,
    windCodeId: NEDERLANDSE_WINDROUTE,
    windStuwdruk: result.samenvatting.stuwdruk,
    windStructuralFactor: result.samenvatting.structuralFactor,
    windInternalPressureCoefficient: geval.cpi,
    windInternalPressureSource: geval.cpiBron
      ?? "NEN-EN 1991-1-4 §7.2.9; uitsluitend c_pi = -0,3 geselecteerd (te onderbouwen)",
    windRegels: result.samenvatting.perGeval.find((item) => item.sleutel === geval.sleutel).regels },
}));
const caseIdByKey = new Map(cases.map((item) => [item.gegenereerd.sleutel, item.id]));
const loads = result.lasten.map((load, index) => ({
  id: index + 1, type: "lineLoad", caseId: caseIdByKey.get(load.gevalSleutel),
  beamId: load.beamId, q: load.q, qDir: "z", qCoord: "local",
  gegenereerdDoor: "wind",
  ...(load.startFrac === undefined ? {} : { startFrac: load.startFrac, endFrac: load.endFrac }),
}));
const saved = deserializeProject(serializeProject({ modelDimension: "2d", nodes, beams,
  supports: [], plates: [], loads, loadCases: [dead, ...cases],
  activeLoadCaseId: cases[0].id, selfWeightEnabled: false, nonlinearEnabled: false }));
const report = windZoneReport2d(saved.loadCases[1]);
assert.equal(report.missing, false);
assert.deepEqual(report.rows, result.samenvatting.perGeval[0].regels);
assert.equal(saved.loadCases[1].gegenereerd.windStructuralFactor, 1.25);
assert.equal(saved.loadCases[1].gegenereerd.windInternalPressureCoefficient, -0.3);
assert.match(saved.loadCases[1].gegenereerd.windInternalPressureSource, /1991-1-4/);
assert.match(saved.loadCases[1].gegenereerd.windInternalPressureSource, /te onderbouwen/);
assert.ok(report.rows.some((row) => row.cpe !== 0 && row.bron.includes("1991-1-4")));

const old = { ...cases[0], gegenereerd: { ...cases[0].gegenereerd } };
delete old.gegenereerd.windRegels;
assert.equal(windZoneReport2d(old).missing, true);
assert.equal(windZoneReport2d(dead), null);
const corrupt = { ...cases[0], gegenereerd: { ...cases[0].gegenereerd,
  windRegels: [{ ...report.rows[0], cpe: "ongeldig" }] } };
assert.equal(windZoneReport2d(corrupt).missing, true);
const oldFactor = { ...cases[0], gegenereerd: { ...cases[0].gegenereerd } };
delete oldFactor.gegenereerd.windStructuralFactor;
const oldCpi = { ...cases[0], gegenereerd: { ...cases[0].gegenereerd } };
delete oldCpi.gegenereerd.windInternalPressureSource;

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
await i18next.use(initReactI18next).init({ lng: "nl", resources: { nl: { ribbon, common } },
  defaultNS: "common", initImmediate: false });
const { ReportDataProvider, EMPTY_REPORT_DATA } = await import("./src/components/report/ReportDataContext.tsx");
const LoadsSection = (await import("./src/components/report/sections/LoadsSection.tsx")).default;
const render = (loadCases, modelLoads) => renderToStaticMarkup(React.createElement(ReportDataProvider,
  { value: { ...EMPTY_REPORT_DATA, nodes, beams, loadCases, loads: modelLoads } },
  React.createElement(LoadsSection)));
const html = render(saved.loadCases, saved.loads);
assert.match(html, /Windzones — toegepaste vormfactoren en lijnlasten/);
assert.match(html, /data-testid="rpt-wind-zones-2d"/);
assert.match(html, /1991-1-4/);
assert.match(html, /constructiefactor c_s·c_d = 1\.250/);
assert.match(html, /Inwendige druk c_pi = -0\.300/);
assert.doesNotMatch(html, /oudere windgeval ontbreken/);
assert.doesNotMatch(html, /constructiefactor ontbreekt/);
const oldHtml = render([old], []);
assert.match(oldHtml, /oudere windgeval ontbreken/);
assert.match(render([oldFactor], []), /constructiefactor ontbreekt/);
assert.match(render([oldCpi], []), /herkomst van de binnendruk ontbreekt/);

const manual = genereerWindbelasting({ nodes, beams, loadCases: [dead] }, {
  ...STANDAARD_WIND_INSTELLINGEN, stuwdrukBron: "handmatig", qpHandmatig_kNm2: 1,
  richtingLinks: true, richtingRechts: false, richtingHaaks: false,
  cpiKeuze: "handmatig", cpiHandmatig: -0.25,
  cpiHandmatigBron: "Openingsberekening project A §3", combinatiesGenereren: false,
});
assert.equal(manual.ok, true);
assert.equal(manual.gevallen[0].cpi, -0.25);
assert.equal(manual.gevallen[0].cpiBron, "Openingsberekening project A §3");
console.log("2D-windzones blijven in projectbestand en rapport controleerbaar: geslaagd");

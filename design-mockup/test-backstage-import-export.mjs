// Issue #235: de kaarten in Bestand → Importeren en Bestand → Exporteren
// reageerden niet: het waren platte blokken zonder actie. Deze test leest de
// bron van Backstage.tsx en bewaakt dat
//   [1] er geen platte kaart (<div className="bs-export-card">) meer is;
//   [2] elke kaart een ActieKaart is met een onClick, en ActieKaart een
//       <button> rendert;
//   [3] de panelen hun acties van App.tsx krijgen (IFC-import, stalen hal,
//       PDF via het rapport, HTML, IFC en IFC structureel), en dat App.tsx
//       die props ook echt doorgeeft;
//   [4] een kaart zonder actie een melding geeft in plaats van stil te blijven.
//
// Uitvoeren: npx tsx test-backstage-import-export.mjs   (vanuit design-mockup/)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const bron = (pad) => readFileSync(join(HIER, pad), "utf8").replace(/\r\n/g, "\n");
let geslaagd = 0;
let gefaald = 0;
function check(naam, ok, detail = "") {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); }
  else { gefaald++; console.log(`  ✗ ${naam}${detail ? ` — ${detail}` : ""}`); }
}

const bs = bron("src/components/backstage/Backstage.tsx");
const app = bron("src/App.tsx");

console.log("[1] geen platte kaarten meer");
check("geen <div className=\"bs-export-card\">", !/<div className="bs-export-card"/.test(bs));

console.log("[2] elke kaart is een knop met een actie");
const actieKaart = /function ActieKaart[\s\S]*?\n}\n/.exec(bs)?.[0] ?? "";
check("ActieKaart rendert een <button type=\"button\">", /<button type="button" className="bs-export-card" onClick=\{onClick\}>/.test(actieKaart));
const kaarten = [...bs.matchAll(/<ActieKaart\b[\s\S]*?\/>/g)].map((m) => m[0]);
// Issue #87: de zesde exportkaart (Resultaten, .ifcfemresults) staat achteraan.
check("acht kaarten (2 import, 6 export)", kaarten.length === 8, `${kaarten.length}`);
check("de resultatenkaart is de laatste, de bestaande blijven op hun plaats", /asIfcResults/.test(kaarten[7] ?? ""));
check("elke kaart heeft een onClick", kaarten.every((k) => /onClick=\{/.test(k)));

console.log("[3] de acties komen van App.tsx");
const importPanel = /function ImportPanel[\s\S]*?\n}\n/.exec(bs)?.[0] ?? "";
const exportPanel = /function ExportPanel[\s\S]*?\n}\n/.exec(bs)?.[0] ?? "";
check("ImportPanel krijgt onImportIfc en onOpenSteelHall", /onImportIfc/.test(importPanel) && /onOpenSteelHall/.test(importPanel));
check("ExportPanel krijgt onPdf, onHtml, onIfc, onIfcStructural",
  ["onPdf", "onHtml", "onIfc", "onIfcStructural"].every((p) => new RegExp(`\\b${p}\\b`).test(exportPanel)));
const backstageJsx = /<Backstage\b[\s\S]*?\/>/.exec(app)?.[0] ?? "";
for (const [prop, actie] of [
  ["onImportIfcAnalysisModel", "handleImportIfcAnalyse"],
  ["onOpenSteelHall", "setStaalhalOpen(true)"],
  ["onExportPdf", "setActiveView(\"report\")"],
  ["onExportHtml", "handleExportHtmlReport"],
  ["onExportIfc", "handleExportIfc(false)"],
  ["onExportIfcStructural", "handleExportIfc(true)"],
  ["onExportIfcResults", "handleExportIfcResultaten()"],
]) {
  check(`App geeft ${prop} door (${actie})`, backstageJsx.includes(`${prop}=`) && backstageJsx.includes(actie));
}

console.log("[4] zonder actie een melding, nooit stil");
check("meldNietBeschikbaar toont een notifyInfo", /function meldNietBeschikbaar[\s\S]*?notifyInfo\(titel, tekst\)/.test(bs));
check("afbeelding-export meldt dat hij nog niet bestaat", /exportPanel\.imageSoon/.test(exportPanel));

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

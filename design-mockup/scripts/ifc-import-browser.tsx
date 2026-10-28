// "Rekenmodel importeren" in een echte (headless) browser: de knop op het
// IFC-tabblad van het lint, het keuzevenster bij twee analysemodellen, de vraag
// bij niet-opgeslagen werk, en het verslagvenster. De stroom is die van de app
// (`useIfcImportStroom`); alleen de bestandskeuze, de vraag en het toepassen
// zijn hier nagebootst. Aangestuurd door test-ifc-import-ui.mjs.
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import common from "../src/i18n/locales/nl/common.json";
import ribbon from "../src/i18n/locales/nl/ribbon.json";
import IfcTab from "../src/components/ribbon/IfcTab";
import { useIfcImportStroom } from "../src/components/ifcImport/useIfcImportStroom";
import type { IfcAnalyseImport } from "../src/io/ifcAnalyseImport";
import tekst from "../../docs/verificatie/ifc-analyse/ifc-analyse-m-n.ifc";

const tests: string[] = [];
const container = document.getElementById("root")!;
const root = createRoot(container);
function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error(message + ": " + JSON.stringify(actual) + " != " + JSON.stringify(expected));
}
function ok(value: unknown, message: string) { if (!value) throw Error(message); }
function klik(el: Element | null | undefined, wat: string) {
  if (!el) throw Error("Ontbreekt: " + wat);
  flushSync(() => (el as HTMLElement).click());
}
async function wachtOp(voorwaarde: () => unknown, wat: string) {
  for (let i = 0; i < 200; i += 1) {
    if (voorwaarde()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error("Wachten verliep: " + wat);
}
/**
 * Wacht tot de voorwaarde geldt en ga verder direct na de DOM-wijziging die
 * haar waar maakt (een microtaak), dus nog vóór React de passieve effecten
 * van die render uitvoert. Zo klikt de test op het vroegst mogelijke moment.
 */
function wachtOpDom(voorwaarde: () => unknown, wat: string): Promise<void> {
  if (voorwaarde()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const waarnemer = new MutationObserver(() => {
      if (!voorwaarde()) return;
      waarnemer.disconnect();
      clearTimeout(klok);
      resolve();
    });
    waarnemer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const klok = setTimeout(() => { waarnemer.disconnect(); reject(Error("Wachten verliep: " + wat)); }, 2000);
  });
}
// Een render die langer duurt dan een tijdsplak van de scheduler (5 ms): React
// stelt de passieve effecten van die render dan uit tot een volgende taak.
let traagMs = 0;
function Traag() {
  const tot = performance.now() + traagMs;
  while (performance.now() < tot) { /* bewust bezig */ }
  return null;
}
const knop =(label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((el) => el.textContent?.trim() === label);
const titel = () => document.querySelector(".modal-header h2")?.textContent ?? null;
const telling = (label: string) => [...document.querySelectorAll(".ifci-telling")]
  .find((el) => el.querySelector("dt")?.textContent === label)?.querySelector("dd")?.textContent ?? null;

interface Stand {
  bestand: { tekst: string; naam: string } | null;
  antwoord: boolean;
  toegepast: IfcAnalyseImport[];
  gevraagd: number;
  fouten: string[];
}
const stand: Stand = { bestand: null, antwoord: true, toegepast: [], gevraagd: 0, fouten: [] };

function Harnas() {
  const stroom = useIfcImportStroom({
    kiesBestand: async () => stand.bestand,
    bevestig: async () => { stand.gevraagd += 1; return stand.antwoord; },
    pasToe: (imp) => { stand.toegepast.push(imp); },
    meldFout: (_titel, melding) => { stand.fouten.push(melding); },
  });
  return <><IfcTab onImportAnalysisModel={() => { void stroom.start(); }} />{stroom.dialogen}<Traag /></>;
}

async function run() {
  await i18next.use(initReactI18next).init({ lng: "nl", resources: { nl: { common, ribbon } }, defaultNS: "common", initImmediate: false });
  flushSync(() => root.render(<Harnas />));
  const importKnop = () => knop("Rekenmodel importeren");
  ok(importKnop() && !importKnop()!.disabled, "knop Rekenmodel importeren op het IFC-tabblad");
  tests.push("Het IFC-tabblad heeft de knop Rekenmodel importeren");

  // Twee analysemodellen: het keuzevenster. Het venster opent in een trage
  // render en de test kiest meteen daarna, nog vóór de passieve effecten van
  // het openen: dat moment kwam eerder af en toe voor, en dan zette het
  // openen de keuze terug op het eerste model.
  stand.bestand = { tekst, naam: "ifc-analyse-m-n.ifc" };
  traagMs = 15;
  klik(importKnop(), "Rekenmodel importeren");
  await wachtOpDom(() => titel() === "Analysemodel kiezen", "keuzevenster");
  traagMs = 0;
  const modellen = [...document.querySelectorAll(".ifci-model")];
  equal(modellen.map((m) => m.querySelector(".ifci-model-naam")?.textContent), ["Hal", "Luifel"], "twee modellen");
  equal(modellen[0].querySelector(".ifci-model-aantallen")?.textContent,
    "14 knopen · 23 staven · 4 vlakken · 5 belastinggevallen · 3 combinaties", "aantallen van de hal");
  ok(document.querySelector(".ifci-intro")?.textContent?.includes("ifc-analyse-m-n.ifc bevat 2 analysemodellen"), "intro noemt het bestand");
  ok((modellen[0].querySelector("input") as HTMLInputElement).checked, "het eerste model is voorgekozen");
  tests.push("Twee analysemodellen: keuzevenster met naam, beschrijving en aantallen; het eerste voorgekozen");

  // Luifel kiezen en meteen importeren (geen pauze: de knop moet de keuze van
  // zojuist gebruiken, ook als die render nog niet gecommit is), daarna de
  // vraag bij niet-opgeslagen werk, toepassen en het verslag.
  klik(modellen[1].querySelector("input"), "keuze Luifel");
  klik(knop("Importeren"), "Importeren");
  await wachtOp(() => titel() === "Importverslag", "verslagvenster");
  equal(stand.gevraagd, 1, "de vraag bij niet-opgeslagen werk");
  equal(stand.toegepast.map((imp) => imp.verslag.model), ["Luifel"], "het gekozen model is toegepast");
  ok(document.querySelector(".ifci-verslag .ifci-intro")?.textContent?.includes('"Luifel" uit ifc-analyse-m-n.ifc'), "kop van het verslag");
  equal([telling("Knopen"), telling("Staven"), telling("Belastinggevallen"), telling("Combinaties")], ["3", "2", "4", "2"], "aantallen in het verslag");
  tests.push("Luifel gekozen: vraag bij niet-opgeslagen werk, model toegepast, verslag met 3 knopen, 2 staven, 4 gevallen, 2 combinaties");
  klik(knop("Sluiten"), "Sluiten");
  await wachtOp(() => titel() === null, "verslag dicht");

  // De hal: schijven, waarschuwingen (imperfectie) en een lege lijst "niet ingelezen".
  klik(importKnop(), "Rekenmodel importeren");
  await wachtOp(() => titel() === "Analysemodel kiezen", "keuzevenster 2");
  klik(knop("Importeren"), "Importeren");
  await wachtOp(() => titel() === "Importverslag", "verslag van de hal");
  equal(telling("Trek-alleen staven"), "3", "trek-alleen");
  equal(telling("Imperfectiegevallen"), "1", "imperfectiegevallen getoond");
  equal([...document.querySelectorAll(".ifci-verslag > .ifci-lijst:not(.fout):not(.waarschuwing) li")].slice(0, 2).map((li) => li.textContent),
    ["Schijf +3.600: 6 knopen (KPV-1, KPV-2)", "Schijf +7.200: 4 knopen (Dakschijf)"], "schijven");
  ok([...document.querySelectorAll(".ifci-lijst.waarschuwing li")].some((li) => li.textContent?.includes("imperfectiegeval")), "waarschuwing imperfectie");
  ok(document.querySelector(".ifci-geen")?.textContent === "Geen.", "niets onondersteund");
  tests.push("Hal: verslag met 3 trek-alleen staven, 1 imperfectiegeval, twee schijven en de waarschuwingen");
  klik(knop("Sluiten"), "Sluiten");
  await wachtOp(() => titel() === null, "verslag dicht 2");

  // Annuleren bij de vraag: er verandert niets.
  stand.antwoord = false;
  const voor = stand.toegepast.length;
  klik(importKnop(), "Rekenmodel importeren");
  await wachtOp(() => titel() === "Analysemodel kiezen", "keuzevenster 3");
  klik(knop("Importeren"), "Importeren");
  await wachtOp(() => titel() === null, "venster dicht na annuleren");
  equal(stand.toegepast.length, voor, "na annuleren is niets toegepast");
  tests.push("Annuleren bij de vraag om niet-opgeslagen werk: niets toegepast, geen verslag");

  // Eén analysemodel: geen keuzevenster.
  stand.antwoord = true;
  stand.bestand = { tekst: tekst.replace(/=IFCSTRUCTURALANALYSISMODEL\(('[^']*'),\$,'Luifel'/, "=IFCGROUP($1,$,'Luifel'"), naam: "hal.ifc" };
  klik(importKnop(), "Rekenmodel importeren");
  await wachtOp(() => titel() === "Importverslag", "verslag zonder keuze");
  equal(stand.toegepast[stand.toegepast.length - 1].verslag.model, "Hal", "het enige model");
  tests.push("Eén analysemodel: geen keuzevenster, meteen het verslag");
  klik(knop("Sluiten"), "Sluiten");
  await wachtOp(() => titel() === null, "verslag dicht 3");

  // Geen IFC: een melding, geen venster en niets toegepast.
  const aantalToegepast = stand.toegepast.length;
  stand.bestand = { tekst: "dit is geen ifc", naam: "notitie.txt" };
  klik(importKnop(), "Rekenmodel importeren");
  await wachtOp(() => stand.fouten.length === 1, "foutmelding");
  ok(stand.fouten[0].includes("ISO-10303-21"), "de melding zegt waarom");
  equal([titel(), stand.toegepast.length, stand.gevraagd], [null, aantalToegepast, 4], "geen venster, niets toegepast en niets gevraagd");
  tests.push("Geen IFC-bestand: een melding met de reden, geen venster, niets gevraagd of toegepast");
}

run().then(() => {
  document.getElementById("uitslag")!.textContent = JSON.stringify({ tests, error: null });
}).catch((error) => {
  document.getElementById("uitslag")!.textContent = JSON.stringify({ tests, error: String(error.stack ?? error) });
});

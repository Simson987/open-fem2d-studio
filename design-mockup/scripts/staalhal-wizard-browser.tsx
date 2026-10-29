// De wizard "Stalen hal" in een echte (headless) browser: zes stappen, mm-invoer,
// levend voorbeeld met aantallen, vertaalde problemen, en "Maken" dat het
// resultaat van de generator doorgeeft. Aangestuurd door test-staalhal-wizard-ui.mjs.
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import common from "../src/i18n/locales/nl/common.json";
import check from "../src/i18n/locales/nl/check.json";
import ribbon from "../src/i18n/locales/nl/ribbon.json";
import StaalhalWizard from "../src/components/openFem3d/wizards/StaalhalWizard";
import type { StaalhalResultaat } from "../src/components/openFem3d/wizards/staalhal";
import { NEDERLANDSE_WINDROUTE } from "../src/lib/wind/windCodeRoute";

const tests: string[] = [];
const container = document.getElementById("root")!;
const root = createRoot(container);
function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error(message + ": " + JSON.stringify(actual) + " != " + JSON.stringify(expected));
}
function ok(value: unknown, message: string) { if (!value) throw Error(message); }
/** Het veld (invoer of keuzelijst) naast een label in de wizard (die in een portaal op body staat). */
function veld<T extends HTMLElement>(label: string, soort = "input,select"): T {
  const rij = [...document.querySelectorAll(".shw-veld")].find((el) => el.querySelector(".shw-veld-label")?.textContent === label);
  const el = rij?.querySelector<T>(soort);
  if (!el) throw Error("Veld ontbreekt: " + label);
  return el;
}
/**
 * Typt een waarde en verlaat het veld; de mm-velden bevestigen pas bij het verlaten.
 * Dat verlaten is een eigen `focusout` (daar luistert Reacts onBlur naar), niet
 * el.focus()/el.blur(): Chromium verstuurt focus-, blur- en focusout-events alleen
 * als de pagina zelf focus heeft, en headless krijgt de pagina die pas even ná het
 * laden. Deze proef draait tijdens het laden, dus met el.blur() hing het bevestigen
 * af van die wedloop: zonder focus bleef de lengte 60 000 mm en het voorbeeld op
 * 165 knopen staan (#105). Zo volgt de proef bij elke start hetzelfde pad.
 */
function typ(el: HTMLInputElement, waarde: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, waarde);
  flushSync(() => el.dispatchEvent(new Event("input", { bubbles: true })));
  flushSync(() => el.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
}
function kies(el: HTMLSelectElement, waarde: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, waarde);
  flushSync(() => el.dispatchEvent(new Event("change", { bubbles: true })));
}
function klik(el: Element | null | undefined, wat: string) {
  if (!el) throw Error("Ontbreekt: " + wat);
  flushSync(() => (el as HTMLElement).click());
}
const stap = (naam: string) => klik([...document.querySelectorAll(".shw-stap")].find((el) => el.textContent?.includes(naam)), "stap " + naam);
function aantal(label: string): string | null {
  const dt = [...document.querySelectorAll(".shw-aantallen dt")].find((el) => el.textContent === label);
  return dt?.nextElementSibling?.textContent ?? null;
}
const maakKnop = () => [...document.querySelectorAll<HTMLButtonElement>(".shw-knop")].find((el) => el.textContent === "Maken")!;

async function run() {
  await i18next.use(initReactI18next).init({ lng: "nl", resources: { nl: { common, check, ribbon } }, defaultNS: "common", initImmediate: false });
  let gemaakt: StaalhalResultaat | null = null;
  const toon = (windCodeId: string) => flushSync(() => root.render(<StaalhalWizard open onClose={() => {}}
    windCodeId={windCodeId} onMaken={(hal) => { gemaakt = hal; }} />));
  toon(NEDERLANDSE_WINDROUTE);

  equal([...document.querySelectorAll(".shw-stap")].map((el) => el.textContent),
    ["1Afmetingen", "2Profielen", "3Verbanden", "4Fundering", "5Belastingen", "6Overzicht"], "zes stappen");
  equal([aantal("Knopen"), aantal("Staven"), aantal("Opleggingen")], ["165", "340", "22"], "standaardhal");
  equal(document.querySelectorAll(".shw-svg").length, 2, "doorsnede en plattegrond");
  equal(veld<HTMLInputElement>("Lengte").value, "60000", "lengte in mm");
  tests.push("Wizard opent met de voorbeeldhal: zes stappen, 165 knopen, 340 staven, 22 opleggingen, lengte 60000 mm");

  toon("asce-7-22");
  ok(document.querySelector(".shw-problemen")?.textContent?.includes("asce-7-22"), "onbekende route zichtbaar");
  ok(maakKnop().disabled, "Maken uit bij een niet beschikbare windroute");
  klik(maakKnop(), "uitgeschakelde Maken-knop");
  equal(gemaakt, null, "geen Nederlandse hal gemaakt voor een andere route");
  toon(NEDERLANDSE_WINDROUTE);
  ok(!document.querySelector(".shw-problemen") && !maakKnop().disabled, "Nederlandse route weer beschikbaar");
  tests.push("Een andere projectwindroute blokkeert de Nederlandse staalhal en toont de routecode");

  // Lengte 48 000 mm: ⌈48/6⌉ = 8 vakken → 9 spanten × (2 + 13) = 135 knopen.
  typ(veld<HTMLInputElement>("Lengte"), "48000");
  equal(aantal("Knopen"), "135", "voorbeeld volgt de lengte");
  // Zelfde lengte via het aantal vakken: 12 vakken → 13 spanten → 195 knopen.
  kies(veld<HTMLSelectElement>("Vakindeling"), "aantal");
  typ(veld<HTMLInputElement>("Aantal vakken"), "12");
  equal(aantal("Knopen"), String(13 * 15), "aantal vakken");
  kies(veld<HTMLSelectElement>("Vakindeling"), "spantafstand");
  equal(aantal("Knopen"), "135", "terug naar de spantafstand");
  tests.push("Lengte 48000 mm → 135 knopen; 12 vakken → 195 knopen; wisselen tussen spantafstand en aantal");

  stap("Fundering");
  kies(veld<HTMLSelectElement>("Fundering"), "balkrooster");
  // 9 spanten: 18 palen onder de kolommen en 9 × 4 onder de dwarsbalken.
  equal(aantal("Palen"), "54", "palen van het balkrooster");
  equal(veld<HTMLInputElement>("Diepte hart balk onder peil").value, "800", "diepte in mm");
  tests.push("Balkrooster aan: 54 palen, diepte 800 mm");

  // Scharnierende voeten zonder wandverband: melding en Maken uit.
  stap("Profielen");
  kies(veld<HTMLSelectElement>("Kolomvoet"), "scharnierend");
  stap("Verbanden");
  const wanden = [...document.querySelectorAll(".shw-vink")].find((el) => el.textContent?.startsWith("Wandverband"))!.querySelector("input")!;
  klik(wanden, "vinkje wandverband");
  ok(document.querySelector(".shw-problemen")?.textContent?.includes("in langsrichting niet stabiel"), "vertaalde stabiliteitsmelding");
  ok(maakKnop().disabled, "Maken uit bij een probleem");
  klik(wanden, "vinkje wandverband");
  ok(!document.querySelector(".shw-problemen") && !maakKnop().disabled, "probleem weg na herstel");
  tests.push("Scharnierende voeten zonder wandverband: vertaalde melding, Maken uit; hersteld: Maken aan");

  const trekAlleen = [...document.querySelectorAll(".shw-vink")].find((el) => el.textContent?.startsWith("Verbanden alleen op trek"))!.querySelector("input")!;
  // Sinds #199 begint de wizard met trek-alleen verbanden (STAALHAL_WIZARD_BEGINSTAND);
  // een klik zou ze juist uitzetten.
  ok(trekAlleen.checked, "trek-alleenverband staat in de beginstand aan (#199)");
  ok(!document.querySelector(".shw-problemen") && !maakKnop().disabled, "trek-alleenverband is geldige invoer");

  stap("Belastingen");
  typ(veld<HTMLInputElement>("Dakgebruik (Q, categorie H)"), "0.4");
  ok(!document.querySelector(".shw-problemen") && !maakKnop().disabled, "dakgebruikslast is geldige invoer");

  stap("Overzicht");
  ok(document.body.textContent?.includes("Dakgebruik (Q)"), "eigen Q-geval staat in het overzicht");
  ok(document.body.textContent?.includes("9 spanten h.o.h. 6000 mm"), "overzicht met spanten");
  klik(maakKnop(), "Maken");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const hal = gemaakt as StaalhalResultaat | null;
  ok(hal, "onMaken aangeroepen");
  equal([hal!.parameters.lengteMm, hal!.parameters.fundering.type, hal!.parameters.kolomvoet, hal!.samenvatting.aantallen.palen],
    [48000, "balkrooster", "scharnierend", 54], "resultaat van de generator");
  ok(hal!.parameters.verbanden.trekAlleen && hal!.model.beams
    .filter((beam) => [...hal!.samenvatting.groepen.dakverband, ...hal!.samenvatting.groepen.wandverband].includes(beam.id))
    .every((beam) => beam.tensionOnly === true), "wizard bewaart trek-alleen op alle verbanden");
  ok(hal!.loadCases.some((item) => item.name === "Dakgebruik (Q)" && item.categorie === "H"), "wizard bewaart Q als categorie H");
  tests.push("Maken geeft het resultaat van de generator door (48000 mm, balkrooster, scharnierend, 54 palen)");
  tests.push("Trek-alleenverband loopt van wizardkeuze naar het 3D-model");
  tests.push("Dakgebruik Q verschijnt in het overzicht en het categorie-H-belastinggeval");
}

run().then(() => {
  document.getElementById("uitslag")!.textContent = JSON.stringify({ tests, error: null });
}).catch((error) => {
  document.getElementById("uitslag")!.textContent = JSON.stringify({ tests, error: String(error.stack ?? error) });
});

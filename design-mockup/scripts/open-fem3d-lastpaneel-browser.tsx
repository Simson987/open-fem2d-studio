/**
 * Browserkant van test-open-fem3d-lastpaneel-ui.mjs (issue #108): de opmaak
 * van het lastpaneel van een staaf (Lijnlast, Puntlast, Temperatuur) en van
 * de knoopbelasting in het echte 3D-eigenschappenpaneel, zoals de app het
 * toont: in het rechterpaneel, met App.css en de CSS van de 3D-editor.
 *
 * Elk element met eigen tekst en elk invoerveld, elke keuzelijst en knop in
 * die panelen moet:
 *  - de letter van het paneel hebben (die van de sectiekop
 *    `.fem-prop-section-title`) en een paneelmaat (10 tot 12,5 px);
 *  - leesbaar zijn op zijn eigen achtergrond (contrast ≥ 2), in het lichte en
 *    het donkere thema;
 * en elk invoerveld en elke keuzelijst heeft de vorm van `.fem-prop-input` in
 * een gewone rij van hetzelfde paneel: achtergrond, tekstkleur, rand, hoogte
 * en lettermaat, in beide thema's.
 *
 * Een element zonder de klassen van het paneel valt terug op de letter van de
 * pagina of de standaard van de browser (schreef, 13,3 px, wit veld in het
 * donkere thema) en faalt hier.
 *
 * `#beeld=licht` of `#beeld=donker` bouwt alleen het beeld voor een
 * schermafbeelding: vier kolommen (lijnlast met de details, puntlast,
 * temperatuur, knoopbelasting).
 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import common from "../src/i18n/locales/nl/common.json";
import ribbon from "../src/i18n/locales/nl/ribbon.json";
import "../src/openaec/openaec-tokens.css";
import "../src/themes.css";
import "../src/App.css";
import "../src/components/openFem3d/OpenFem3DEditor.css";
import OpenFem3DProperties from "../src/components/openFem3d/OpenFem3DProperties";
import { OPEN_FEM_3D_SUPPORT_PRESETS, parseOpenFem3DModel, type OpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import type { OpenFem3DSelection } from "../src/components/openFem3d/openFem3dSelection";

const tests: { name: string; error?: string }[] = [];
const container = document.getElementById("root")!;
let root = createRoot(container);
function mount(element: React.ReactNode) {
  flushSync(() => root.unmount());
  root = createRoot(container);
  flushSync(() => root.render(element));
}
const wacht = (ms = 60) => new Promise((r) => setTimeout(r, ms));
function ok(v: unknown, m: string) { if (!v) throw Error(m); }
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); tests.push({ name }); }
  catch (e) { tests.push({ name, error: e instanceof Error ? e.message : String(e) }); }
}
function typ(el: HTMLInputElement, waarde: string) {
  el.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, waarde);
  flushSync(() => el.dispatchEvent(new Event("input", { bubbles: true })));
}

/* ── Model: een ligger van 6 m met elke lastsoort ─────────────────────── */

const model = (): OpenFem3DModel => parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 300", material: "S235" }],
  supports: [{ nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.fixed }],
  loads: [{ id: 1, nodeId: 2, fx: 0, fy: 0, fz: -10, mx: 0, my: 0, mz: 0 }],
  memberLoads: [
    { id: 1, beamId: 1, qyStart: 0, qyEnd: 0, qzStart: -5, qzEnd: -5, startPositionM: 0, endPositionM: 6 },
    // Globaal Z per projectie over een deel: Richting, het vinkje met uitleg en de details.
    { id: 2, beamId: 1, globalDirection: "z", qStart: -2, qEnd: -3, perProjection: true, startPositionM: 1, endPositionM: 5 },
  ],
  memberPointLoads: [{ id: 1, beamId: 1, py: 0, pz: -10, positionM: 3 }],
  thermalLoads: [{ id: 1, beamId: 1, deltaTUniformK: 20, deltaTGradientYK: 0, deltaTGradientZK: 5 }],
});

/** Het eigenschappenpaneel zoals in de app: in het rechterpaneel (App.tsx). */
function Paneel({ selectie, hoogte }: { selectie: OpenFem3DSelection; hoogte?: number }) {
  const [huidig, setHuidig] = useState(model);
  return <aside className="right-panel" style={{ width: 300, height: hoogte ?? 2400 }}>
    <div className="right-panel-body">
      <OpenFem3DProperties model={huidig} selection={selectie} result={null} onChange={setHuidig} />
    </div>
  </aside>;
}

/* ── Meten ───────────────────────────────────────────────────────────── */

type Rgba = [number, number, number, number];
function rgba(tekst: string): Rgba {
  const getallen = (tekst.match(/-?[\d.]+/g) ?? []).map(Number);
  // `color(srgb r g b / a)` geeft fracties, `rgb(…)`/`rgba(…)` 0–255.
  const schaal = tekst.startsWith("color(") ? 255 : 1;
  return [getallen[0] * schaal, getallen[1] * schaal, getallen[2] * schaal, getallen[3] ?? 1];
}
const over = (boven: Rgba, onder: Rgba): Rgba => {
  const a = boven[3];
  return [boven[0] * a + onder[0] * (1 - a), boven[1] * a + onder[1] * (1 - a), boven[2] * a + onder[2] * (1 - a), 1];
};
/** De zichtbare achtergrond onder een element: alle lagen tot en met de pagina. */
function achtergrond(el: Element): Rgba {
  const lagen: Rgba[] = [];
  for (let e: Element | null = el; e; e = e.parentElement) lagen.push(rgba(getComputedStyle(e).backgroundColor));
  return lagen.reverse().reduce<Rgba>((onder, laag) => over(laag, onder), [255, 255, 255, 1]);
}
function luminantie([r, g, b]: Rgba) {
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(el: Element) {
  const onder = achtergrond(el);
  const tekst = over(rgba(getComputedStyle(el).color), onder);
  const [a, b] = [luminantie(tekst), luminantie(onder)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}
const zichtbaar = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
const VELD = "input:not([type=checkbox]):not([type=radio]), select, textarea";
/** Elementen waarvan de letter telt: velden, knoppen en alles met eigen tekst. */
function tekstElementen(paneel: Element): HTMLElement[] {
  return [...paneel.querySelectorAll<HTMLElement>("*")].filter((el) => zichtbaar(el) && (
    el.matches(`${VELD}, button`) ||
    [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "")));
}
const naam = (el: Element) => {
  const tekst = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 28);
  return `<${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ").join(".")}` : ""}>${tekst ? ` "${tekst}"` : ""}`;
};
function thema(naam: "light" | "dark") { document.documentElement.setAttribute("data-oa-theme", naam); }

/**
 * Letter, maat, contrast en veldvorm van alles in `paneel`, vergeleken met de
 * sectiekop en een gewoon veld (`.fem-prop-row .fem-prop-input`) van
 * hetzelfde eigenschappenpaneel, in het lichte en het donkere thema.
 */
function controleer(paneel: Element, minimaal: { tekst: number; velden: number }) {
  const eigenschappen = paneel.closest(".fem-properties")!;
  const kop = eigenschappen.querySelector(".fem-prop-section-title");
  const gewoonVeld = eigenschappen.querySelector(".fem-prop-row .fem-prop-input");
  ok(kop && gewoonVeld, "geen sectiekop of gewoon veld om mee te vergelijken");
  // Een veld met focus heeft terecht een accentrand: vergelijk zonder focus.
  (document.activeElement as HTMLElement | null)?.blur();
  const fouten: string[] = [];
  for (const naamThema of ["light", "dark"] as const) {
    thema(naamThema);
    const letter = getComputedStyle(kop!).fontFamily;
    const elementen = tekstElementen(paneel);
    if (elementen.length < minimaal.tekst) fouten.push(`${naamThema}: maar ${elementen.length} tekstelementen gevonden`);
    for (const el of elementen) {
      const stijl = getComputedStyle(el);
      if (stijl.fontFamily !== letter) fouten.push(`${naamThema}: ${naam(el)} letter ${stijl.fontFamily} ≠ ${letter}`);
      const maat = parseFloat(stijl.fontSize);
      if (!(maat >= 10 && maat <= 12.5)) fouten.push(`${naamThema}: ${naam(el)} lettermaat ${stijl.fontSize}`);
      const c = contrast(el);
      if (!(c >= 2)) fouten.push(`${naamThema}: ${naam(el)} contrast ${c.toFixed(2)} (${stijl.color} op ${achtergrond(el).map(Math.round).join(",")})`);
    }
    const ref = getComputedStyle(gewoonVeld!);
    const velden = [...paneel.querySelectorAll<HTMLElement>(VELD)].filter(zichtbaar);
    if (velden.length < minimaal.velden) fouten.push(`${naamThema}: maar ${velden.length} velden gevonden`);
    for (const veld of velden) {
      const stijl = getComputedStyle(veld);
      for (const eigenschap of ["backgroundColor", "color", "borderTopColor", "borderTopWidth", "height", "fontSize", "fontWeight"] as const) {
        if (stijl[eigenschap] !== ref[eigenschap]) fouten.push(`${naamThema}: ${naam(veld)} ${eigenschap} ${stijl[eigenschap]} ≠ ${ref[eigenschap]}`);
      }
    }
  }
  thema("light");
  ok(fouten.length === 0, `${fouten.length} afwijkingen:\n    ${fouten.slice(0, 40).join("\n    ")}`);
}

const lastpaneel = () => container.querySelector(".open-fem3d-member-loads")!;
const tab = (n: number) => container.querySelectorAll<HTMLButtonElement>(".open-fem3d-load-tabs button")[n];

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", resources: { nl: { common, ribbon } }, defaultNS: "common", initImmediate: false,
  });
  const beeld = new URLSearchParams(location.hash.slice(1)).get("beeld");
  if (beeld) { await toonBeeld(beeld); return; }

  await test("lijnlast, globaal per projectie met details en foutmelding: letter, maat, contrast en velden als het paneel", async () => {
    mount(<Paneel selectie={{ type: "memberLoad", id: 2 }} />);
    await wacht();
    ok(lastpaneel().querySelector("[data-open-fem3d-per-projection]"), "het vinkje Per projectie staat er");
    ok(lastpaneel().querySelector(".open-fem3d-load-details"), "de details staan open");
    typ(lastpaneel().querySelector<HTMLInputElement>("input[name=endMm]")!, "99999");
    flushSync(() => lastpaneel().querySelector<HTMLButtonElement>(".open-fem3d-load-submit")!.click());
    await wacht();
    ok(lastpaneel().querySelector(".open-fem3d-error"), "de foutmelding staat er");
    controleer(lastpaneel(), { tekst: 20, velden: 5 });
  });

  await test("lijnlast, lokaal gelijkmatig (Richting en q): letter, maat, contrast en velden als het paneel", async () => {
    mount(<Paneel selectie={{ type: "memberLoad", id: 1 }} />);
    await wacht();
    ok(!lastpaneel().querySelector(".open-fem3d-load-details"), "geen details");
    controleer(lastpaneel(), { tekst: 10, velden: 2 });
  });

  await test("puntlast (Py, Pz, Positie, Opslaan): letter, maat, contrast en velden als het paneel", async () => {
    mount(<Paneel selectie={{ type: "memberPointLoad", id: 1 }} />);
    await wacht();
    ok(tab(1).getAttribute("aria-selected") === "true", "de tab Puntlast is gekozen");
    controleer(lastpaneel(), { tekst: 10, velden: 3 });
  });

  await test("temperatuur: letter, maat, contrast en velden als het paneel", async () => {
    mount(<Paneel selectie={{ type: "thermalLoad", id: 1 }} />);
    await wacht();
    ok(tab(2).getAttribute("aria-selected") === "true", "de tab Temperatuur is gekozen");
    controleer(lastpaneel(), { tekst: 10, velden: 3 });
  });

  await test("de staaf zelf gekozen, de drie tabs na elkaar: zelfde opmaak", async () => {
    mount(<Paneel selectie={{ type: "beam", id: 1 }} />);
    await wacht();
    for (const n of [0, 1, 2]) {
      flushSync(() => tab(n).click());
      await wacht(20);
      controleer(lastpaneel(), { tekst: 8, velden: 2 });
    }
  });

  await test("knoopbelasting en oplegging van een knoop: letter, maat, contrast en velden als het paneel", async () => {
    mount(<Paneel selectie={{ type: "node", id: 2 }} />);
    await wacht();
    const knoop = container.querySelector(".open-fem3d-conditions:not(.open-fem3d-member-loads)");
    ok(knoop, "het knooppaneel staat er");
    ok(knoop!.querySelector(".open-fem3d-condition-load-list"), "de lijst met de knoopbelasting staat er");
    controleer(knoop!, { tekst: 20, velden: 12 });
  });
}

/* ── Beelden voor de schermafbeeldingen (geen proeven) ──────────────── */

async function toonBeeld(beeld: string) {
  thema(beeld === "donker" ? "dark" : "light");
  const kolommen: OpenFem3DSelection[] = [
    { type: "memberLoad", id: 2 }, { type: "memberPointLoad", id: 1 }, { type: "thermalLoad", id: 1 }, { type: "node", id: 2 },
  ];
  mount(<div style={{ display: "flex", gap: 8, padding: 8, background: "var(--theme-bg)" }}>
    {kolommen.map((selectie) => <Paneel key={`${selectie!.type}${selectie!.id}`} selectie={selectie} hoogte={880} />)}
  </div>);
  await wacht(200);
  // Elke kolom op zijn lastpaneel (bij de knoop: de oplegging en de knoopbelasting).
  for (const kolom of container.querySelectorAll(".right-panel")) {
    const doel = kolom.querySelector(".open-fem3d-member-loads") ?? kolom.querySelector(".open-fem3d-conditions");
    const scroller = doel?.closest(".fem-prop-body");
    if (doel && scroller) scroller.scrollTop += doel.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 4;
  }
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el && !el.textContent) el.textContent = JSON.stringify({ tests, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, error: String(e?.stack ?? e) }); });

// Het venster Selectiefilter (issue #94) in een echte (headless) browser, in
// 3D en in 2D, met dezelfde koppeling als App.tsx: `SelectieFilterVenster3D`
// en `SelectieFilterVenster2D` met een selectie in de state. Aangestuurd door
// test-selectiefilter-ui.mjs.
//
// Standen, gekozen met de hash van de pagina:
//   (geen hash)              de controles — uitslag als JSON in <pre id="uitslag">;
//   #beeld=3d-<thema>        het venster in 3D, open, HEA 200 aangevinkt, voor een schermafbeelding;
//   #beeld=2d-<thema>        idem in 2D, met Staven en een staaftype aangevinkt.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import common from "../src/i18n/locales/nl/common.json";
import ribbon from "../src/i18n/locales/nl/ribbon.json";
import commonEn from "../src/i18n/locales/en/common.json";
import { SelectieFilterVenster2D, SelectieFilterVenster3D } from "../src/components/selectieFilter/SelectieFilterVenster";
import { filterLastGeval } from "../src/components/selectieFilter/selectieFilter";
import { selectieBelastinggevallen2D } from "../src/components/fem/selectieFilter2d";
import { openFem3DSelectieBelastinggevallen } from "../src/components/openFem3d/openFem3dSelectieFilter";
import type { OpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import type { OpenFem3DSelection } from "../src/components/openFem3d/openFem3dSelection";
import type { LoadCase, Selection } from "../src/components/fem/femTypes";
import "../src/themes.css";
import "../src/App.css";

const tests: string[] = [];
const errors: string[] = [];
const container = document.getElementById("root")!;
const root = createRoot(container);
function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error(message + ": " + JSON.stringify(actual) + " != " + JSON.stringify(expected));
}
function ok(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
function test(naam: string, fn: () => void) {
  try { fn(); tests.push(naam); } catch (e) { errors.push(`${naam}: ${e instanceof Error ? e.message : e}`); }
}

// ── Het venster bedienen (het staat in een portaal op body) ─────────────────

const dialoog = () => document.querySelector(".selectiefilter-dialog");
const rij = (kenmerk: string) => document.querySelector(`[data-selectiefilter-kenmerk="${kenmerk}"]`);
const waarden = (kenmerk: string) => [...(rij(kenmerk)?.querySelectorAll(".selectiefilter-keuze") ?? [])]
  .map((el) => `${el.querySelector(".selectiefilter-label")?.textContent}:${el.querySelector(".selectiefilter-aantal")?.textContent}`);
function vink(kenmerk: string, waarde: string) {
  const el = rij(kenmerk)?.querySelector<HTMLInputElement>(`input[data-waarde="${waarde}"]`);
  ok(el, `vinkje ${kenmerk} = ${waarde} ontbreekt`);
  flushSync(() => el.click());
}
function modus(kenmerk: string, waarde: "keep" | "remove") {
  const el = document.querySelector<HTMLSelectElement>(`[data-selectiefilter-modus="${kenmerk}"]`);
  ok(el, `modus ${kenmerk} ontbreekt`);
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, waarde);
  flushSync(() => el.dispatchEvent(new Event("change", { bubbles: true })));
}
function lengte(welke: "van" | "tot", waarde: string) {
  const el = document.querySelector<HTMLInputElement>(`[data-selectiefilter-lengte="${welke}"]`);
  ok(el, `lengteveld ${welke} ontbreekt`);
  el.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, waarde);
  flushSync(() => el.dispatchEvent(new Event("input", { bubbles: true })));
  flushSync(() => el.blur());
}
/** De telling per type: "over/basis". */
function telling(): Record<string, string> {
  return Object.fromEntries([...document.querySelectorAll<HTMLElement>("[data-selectiefilter-telling]")]
    .map((el) => [el.dataset.selectiefilterTelling!, `${el.dataset.over}/${el.dataset.basis}`]));
}
function knop(tekst: string) {
  const el = [...(dialoog()?.querySelectorAll<HTMLButtonElement>(".modal-footer button") ?? [])].find((b) => b.textContent === tekst);
  ok(el, `knop ${tekst} ontbreekt`);
  flushSync(() => el.click());
}

// ── 3D: tien staven op een rij, en daarbuiten een kolom, een HEA 200 en een IPE 300 ──
// De twee staven van 5 m buiten de selectie (12: HEA 200, 13: IPE 300) vangen
// een venster dat bij Toepassen de selectie negeert en het hele model filtert.

const loadCases: LoadCase[] = [
  { id: 1, name: "Permanent (G)", type: "dead" },
  { id: 2, name: "Veranderlijk (Q)", type: "live" },
];
const levels = [{ id: "L4", label: "Kop", position: 4000 }];
const model3d: OpenFem3DModel = {
  nodes: [
    ...Array.from({ length: 11 }, (_, i) => ({ id: i + 1, x: i * 5, y: 0, z: 0 })), { id: 12, x: 0, y: 0, z: 4 },
    { id: 13, x: 0, y: 5, z: 0 }, { id: 14, x: 5, y: 5, z: 0 },
  ],
  beams: [
    ...Array.from({ length: 10 }, (_, i) => ({
      id: i + 1, startNodeId: i + 1, endNodeId: i + 2, material: "S235",
      profileName: [1, 4, 6, 8, 10].includes(i + 1) ? "HEA 200" : "IPE 300",
    })),
    { id: 11, startNodeId: 1, endNodeId: 12, profileName: "UNP 100", material: "S355", group: "kolom" },
    { id: 12, startNodeId: 1, endNodeId: 13, profileName: "HEA 200", material: "S235" },
    { id: 13, startNodeId: 13, endNodeId: 14, profileName: "IPE 300", material: "S235" },
  ],
  supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false }],
  loads: [{ id: 1, nodeId: 12, caseId: 2, fx: 1, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
  memberLoads: [
    { id: 1, beamId: 2, caseId: 2, qyStart: 0, qyEnd: 0, qzStart: -1, qzEnd: -1, startPositionM: 0, endPositionM: 5 },
    { id: 2, beamId: 3, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -1, qzEnd: -1, startPositionM: 0, endPositionM: 5 },
  ],
  memberPointLoads: [], thermalLoads: [], plates: [], surfaceLoads: [], loadPanels: [],
};
const tienStaven: OpenFem3DSelection = { type: "multi", nodeIds: [], beamIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };

let selectie3D: OpenFem3DSelection = null;
let open3D = false;
let geval3D = 1;
/**
 * Zoals App.tsx: de lintknop zet het venster open, Toepassen zet de selectie
 * en maakt, zoals zetGefilterdeSelectie3D, met dezelfde helpers het geval van
 * de gekozen lasten actief (test-selectiefilter.mjs bewaakt die bedrading).
 */
function Proef3D({ start, beginOpen = true }: { start: OpenFem3DSelection; beginOpen?: boolean }) {
  const [selection, setSelection] = useState<OpenFem3DSelection>(start);
  const [open, setOpen] = useState(beginOpen);
  const [actief, setActief] = useState(1);
  selectie3D = selection;
  open3D = open;
  geval3D = actief;
  return <>
    <button type="button" id="filterknop" onClick={() => setOpen(true)}>Filter</button>
    <SelectieFilterVenster3D open={open} onClose={() => setOpen(false)} model={model3d} levels={levels}
      loadCases={loadCases} selection={selection} onSelect={(next, ids) => {
        setSelection(next);
        const keuze = filterLastGeval(openFem3DSelectieBelastinggevallen(model3d, ids), actief);
        if (keuze) setActief(keuze.geval);
      }} />
  </>;
}

// ── 2D: een portaal in mm met een schoor ─────────────────────────────────────

const model2d = {
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }, { id: 3, x: 0, z: 4000 }, { id: 4, x: 6000, z: 4000 }],
  beams: [
    { id: 1, from: 1, to: 3, profile: "HEA200", material: "S235" },
    { id: 2, from: 2, to: 4, profile: "HEA200", material: "S235" },
    { id: 3, from: 3, to: 4, profile: "IPE300", material: "S235" },
    { id: 4, from: 1, to: 4, profile: "L50x5", material: "S235", loadRole: "binnen" as const },
  ],
  supports: [{ nodeId: 1, type: "fixed" as const }, { nodeId: 2, type: "pinned" as const }],
  plates: [],
  loads: [
    { id: 1, type: "lineLoad" as const, caseId: 2, beamId: 3, q: -3 },
    { id: 2, type: "pointForce" as const, caseId: 1, nodeId: 3, fx: 5 },
    // Buiten de start-selectie van de lastenproef: vangt een venster dat de selectie negeert.
    { id: 3, type: "pointForce" as const, caseId: 2, nodeId: 4, fz: -2 },
  ],
};
let selectie2D: Selection = null;
let geval2D = 1;
/** Zoals App.tsx (zetGefilterdeSelectie2D): de selectie, en het geval van de gekozen lasten actief. */
function Proef2D({ start }: { start: Selection }) {
  const [selection, setSelection] = useState<Selection>(start);
  const [open, setOpen] = useState(true);
  const [actief, setActief] = useState(1);
  selectie2D = selection;
  geval2D = actief;
  return <SelectieFilterVenster2D open={open} onClose={() => setOpen(false)} model={model2d} loadCases={loadCases}
    selection={selection} onSelect={(next, ids) => {
      setSelection(next);
      const keuze = filterLastGeval(selectieBelastinggevallen2D(model2d, ids), actief);
      if (keuze) setActief(keuze.geval);
    }} />;
}

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", fallbackLng: "nl", defaultNS: "common",
    resources: { nl: { common, ribbon }, en: { common: commonEn, ribbon } },
    interpolation: { escapeValue: false }, initImmediate: false,
  });
  const beeld = /^#beeld=(3d|2d)-(light|openaec)$/.exec(location.hash);
  if (beeld) {
    document.documentElement.dataset.theme = beeld[2];
    document.body.style.cssText = "margin:0;background:var(--theme-bg)";
    if (beeld[1] === "3d") {
      flushSync(() => root.render(<Proef3D start={tienStaven} />));
      vink("profile", "HEA 200");
    } else {
      flushSync(() => root.render(<Proef2D start={null} />));
      vink("type", "beam");
      vink("direction", "vertical");
    }
    document.getElementById("uitslag")!.textContent = JSON.stringify({ tests: ["beeld"], errors });
    return;
  }
  document.documentElement.dataset.theme = "light";

  // ── 3D ──
  test("3D: de lintknop opent het venster op de selectie van tien staven", () => {
    flushSync(() => root.render(<Proef3D start={tienStaven} beginOpen={false} />));
    ok(!dialoog(), "venster al open");
    flushSync(() => document.querySelector<HTMLButtonElement>("#filterknop")!.click());
    ok(dialoog(), "venster niet open");
    equal(document.querySelector(".selectiefilter-dialog .modal-header h2")?.textContent, "Selectiefilter", "titel");
    equal(document.querySelector<HTMLElement>("[data-selectiefilter-basis]")?.dataset.selectiefilterBasis, "selectie", "basis");
    equal(telling(), { beam: "10/10" }, "telling vooraf: alleen staven");
  });
  test("3D: de keuzelijsten tonen alleen wat in de selectie voorkomt (geen UNP 100, geen lasten)", () => {
    equal(waarden("profile"), ["HEA 200:5", "IPE 300:5"], "profielen");
    equal(waarden("type"), ["Staven:10"], "typen");
    equal(waarden("direction"), ["Horizontaal:10"], "richting");
    ok(!rij("loadCase") && !rij("loadKind"), "lastrijen bij een selectie zonder lasten");
    ok(rij("length"), "lengterij ontbreekt");
  });
  test("3D: alleen HEA 200 houden → de telling loopt mee (5 van 10), Toepassen → de selectie is die vijf staven", () => {
    vink("profile", "HEA 200");
    equal(telling(), { beam: "5/10" }, "telling na HEA 200");
    ok(rij("profile")?.classList.contains("actief"), "rij profiel niet gemarkeerd");
    equal(document.querySelector<HTMLElement>("[data-selectiefilter-over]")?.dataset.selectiefilterOver, "5", "voettekst");
    knop("Toepassen");
    ok(!dialoog(), "venster bleef open");
    ok(selectie3D?.type === "multi" && !selectie3D.beamIds.includes(12), "HEA 200-staaf 12 buiten de selectie kwam erbij");
    equal(selectie3D, { type: "multi", nodeIds: [], beamIds: [1, 4, 6, 8, 10] }, "selectie na Toepassen");
  });
  test("3D: opnieuw openen begint leeg en werkt op de nieuwe selectie (vijf staven)", () => {
    flushSync(() => document.querySelector<HTMLButtonElement>("#filterknop")!.click());
    equal(telling(), { beam: "5/5" }, "basis is de nieuwe selectie");
    ok(!rij("profile")?.classList.contains("actief"), "keuze van de vorige keer staat er nog");
    equal(waarden("profile"), ["HEA 200:5"], "alleen HEA 200 in de keuzelijst");
    knop("Annuleren");
    ok(!open3D, "venster bleef open");
  });
  test("3D: Annuleren laat de selectie staan", () => {
    flushSync(() => root.render(<></>));
    flushSync(() => root.render(<Proef3D start={tienStaven} />));
    vink("profile", "IPE 300");
    equal(telling(), { beam: "5/10" }, "telling met IPE 300");
    knop("Annuleren");
    equal(selectie3D, tienStaven, "selectie veranderd na Annuleren");
  });
  test("3D: weghalen en lengte in mm (van 5000 tot 5000 houdt alle staven van 5 m)", () => {
    flushSync(() => root.render(<></>));
    flushSync(() => root.render(<Proef3D start={tienStaven} />));
    modus("profile", "remove");
    vink("profile", "HEA 200");
    equal(telling(), { beam: "5/10" }, "HEA 200 weghalen");
    lengte("van", "5001");
    equal(telling(), { beam: "0/10" }, "lengte vanaf 5001 mm");
    equal(document.querySelector(".selectiefilter-voet")?.textContent, "Er blijft niets over; Toepassen heft de selectie op.", "melding");
    lengte("van", "5000");
    lengte("tot", "5000");
    equal(telling(), { beam: "5/10" }, "lengte 5000–5000 mm");
    knop("Toepassen");
    ok(selectie3D?.type === "multi" && !selectie3D.beamIds.includes(13), "IPE 300-staaf 13 (5 m) buiten de selectie kwam erbij");
    equal(selectie3D, { type: "multi", nodeIds: [], beamIds: [2, 3, 5, 7, 9] }, "IPE 300 over");
  });
  test("3D: één staaf geselecteerd → enkelvoud in de teksten (1 element)", () => {
    flushSync(() => root.render(<></>));
    flushSync(() => root.render(<Proef3D start={{ type: "beam", id: 1 }} />));
    equal(document.querySelector("[data-selectiefilter-basis]")?.textContent, "Werkt op de huidige selectie: 1 element.", "basistekst");
    equal(document.querySelector(".selectiefilter-voet")?.textContent, "Over: 1 van 1 element", "voettekst");
    knop("Annuleren");
  });
  test("3D: Wissen zet alle keuzes terug", () => {
    flushSync(() => root.render(<></>));
    flushSync(() => root.render(<Proef3D start={tienStaven} />));
    vink("profile", "HEA 200");
    knop("Wissen");
    equal(telling(), { beam: "10/10" }, "na Wissen");
    ok(!rij("profile")?.querySelector<HTMLInputElement>("input:checked"), "vinkje staat er nog");
  });
  test("3D: niets geselecteerd → het hele model; lasten van één geval selecteren", () => {
    flushSync(() => root.render(<></>));
    flushSync(() => root.render(<Proef3D start={null} />));
    equal(document.querySelector<HTMLElement>("[data-selectiefilter-basis]")?.dataset.selectiefilterBasis, "model", "basis");
    equal(telling(), { node: "14/14", beam: "13/13", load: "3/3", support: "1/1" }, "telling van het model");
    equal(waarden("loadCase"), ["Permanent (G):1", "Veranderlijk (Q):2"], "belastinggevallen met naam");
    equal(waarden("loadKind"), ["Knooplast:1", "Lijnlast:2"], "lastsoorten");
    equal(waarden("level"), ["Kop:1"], "level met naam");
    vink("loadCase", "2");
    equal(telling(), { node: "0/14", beam: "0/13", load: "2/3", support: "0/1" }, "geval 2");
    equal(geval3D, 1, "actief geval vooraf");
    knop("Toepassen");
    equal(selectie3D, { type: "multi", nodeIds: [], beamIds: [], loads: { nodalLoad: [1], memberLoad: [1] } }, "lasten in de selectie");
    equal(geval3D, 2, "het actieve geval wisselt mee naar geval 2");
  });
  test("3D: opleggingen houden", () => {
    flushSync(() => root.render(<></>));
    flushSync(() => root.render(<Proef3D start={null} />));
    vink("type", "support");
    equal(telling(), { node: "1/14", beam: "0/13", load: "0/3", support: "1/1" }, "telling opleggingen");
    knop("Toepassen");
    equal(selectie3D, { type: "node", id: 1 }, "één knoop");
  });
  test("3D: het venster heeft geen Nederlandse sleutels in beeld en ook Engels werkt", () => {
    flushSync(() => root.render(<></>));
    flushSync(() => { void i18next.changeLanguage("en"); });
    flushSync(() => root.render(<Proef3D start={tienStaven} />));
    const tekst = dialoog()?.textContent ?? "";
    ok(!/selectieFilter\./.test(tekst), "ruwe sleutel in beeld: " + tekst.slice(0, 200));
    ok(tekst.includes("Selection filter") && tekst.includes("Keep only these"), "Engels ontbreekt: " + tekst.slice(0, 200));
    flushSync(() => { void i18next.changeLanguage("nl"); });
    flushSync(() => root.render(<></>));
  });

  // ── 2D ──
  test("2D: niets geselecteerd → het hele model; Staven houden en Toepassen → de vier staven", () => {
    flushSync(() => root.render(<Proef2D start={null} />));
    equal(document.querySelector<HTMLElement>("[data-selectiefilter-basis]")?.dataset.selectiefilterBasis, "model", "basis");
    equal(telling(), { node: "4/4", beam: "4/4", load: "3/3", support: "2/2" }, "telling 2D");
    ok(!rij("level") && !rij("group"), "2D kent geen levels en groepen");
    equal(waarden("role"), ["Linkergevel:1", "Rechtergevel:1", "Plat dak (≤ 5°):1", "Binnenstaaf (geen windvlak):1"], "staaftypen");
    vink("type", "beam");
    equal(telling(), { node: "0/4", beam: "4/4", load: "0/3", support: "0/2" }, "alleen staven");
    vink("direction", "vertical");
    equal(telling(), { node: "0/4", beam: "2/4", load: "0/3", support: "0/2" }, "verticale staven");
    knop("Toepassen");
    equal(selectie2D, { type: "multi", nodeIds: [], beamIds: [1, 2], plateIds: [] }, "2D-selectie");
    equal(geval2D, 1, "zonder lasten blijft het actieve geval staan");
  });
  test("2D: lasten van geval 2 op de selectie (last 3 van geval 2 erbuiten blijft weg); het actieve geval wisselt mee", () => {
    flushSync(() => root.render(<></>));
    flushSync(() => root.render(<Proef2D start={{ type: "multi", nodeIds: [3], beamIds: [3], plateIds: [], loadIds: [1, 2] }} />));
    equal(telling(), { node: "1/1", beam: "1/1", load: "2/2" }, "basis is de selectie");
    vink("loadCase", "2");
    equal(geval2D, 1, "actief geval vooraf");
    knop("Toepassen");
    equal(selectie2D, { type: "load", id: 1 }, "één last, niet last 3 buiten de selectie");
    equal(geval2D, 2, "het actieve geval wisselt mee naar geval 2");
  });

  flushSync(() => root.unmount());
  document.getElementById("uitslag")!.textContent = JSON.stringify({ tests, errors });
}
void run().catch((e) => { document.getElementById("uitslag")!.textContent = JSON.stringify({ tests, errors: [...errors, String(e)] }); });

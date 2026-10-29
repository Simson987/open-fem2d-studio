/**
 * Browserkant van test-kaderselectie-ui.mjs: het echte 2D-tekenvlak met de
 * echte modelstore (useFemStore) in een lokale headless browser.
 *
 *  - van rechts naar links slepen is een crossing: een staaf die door het
 *    kader loopt en een plaat die het overlapt, worden geselecteerd; het
 *    kader is gestippeld, in de kleuren van het thema (licht en donker);
 *  - van links naar rechts is een venster: doorgetrokken, alleen wat er
 *    geheel in ligt;
 *  - Escape: uit het gereedschap terug naar Selecteren (selectie blijft),
 *    tweede Escape heft de selectie op, niet in een invoerveld;
 *  - Delete verwijdert een aangeklikte plaat; ongedaan maken zet haar terug.
 */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import common from "../src/i18n/locales/nl/common.json";
import check from "../src/i18n/locales/nl/check.json";
import "../src/openaec/openaec-tokens.css";
import "../src/themes.css";
import FemCanvas from "../src/components/fem/FemCanvas";
import { DEFAULT_DISPLAY_FLAGS } from "../src/components/fem/FemResultsOverlay";
import { DEFAULT_GRID, type Tool } from "../src/components/fem/femTypes";
import { useFemStore } from "../src/hooks/useFemStore";

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
function gelijk(a: unknown, b: unknown, m: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(`${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); tests.push({ name }); }
  catch (e) { tests.push({ name, error: e instanceof Error ? e.message : String(e) }); }
}

// Een ligger L (knopen 1–2) boven een plaat P (knopen 3–6). In mm.
const MODEL = {
  nodes: [
    { id: 1, x: 1000, z: 5000 }, { id: 2, x: 11000, z: 5000 },
    { id: 3, x: 2000, z: 0 }, { id: 4, x: 6000, z: 0 }, { id: 5, x: 6000, z: 3000 }, { id: 6, x: 2000, z: 3000 },
  ],
  beams: [{ id: 1, from: 1, to: 2, material: "S235", profile: "HEA160" }],
  plates: [{ id: 1, nodeIds: [3, 4, 5, 6] }],
};

let store: ReturnType<typeof useFemStore>;
let gereedschap: Tool = "select";
function MetStore() {
  const s = useFemStore();
  store = s;
  const [tool, setTool] = useState<Tool>("select");
  gereedschap = tool;
  zetGereedschap = setTool;
  useEffect(() => {
    s.loadProjectState({
      nodes: MODEL.nodes, beams: MODEL.beams, supports: [], plates: MODEL.plates, loads: [],
      loadCases: s.loadCases, activeLoadCaseId: s.activeLoadCaseId,
    });
  }, []);
  return (
    // 1000 × 600: dezelfde maat als de beginstand van het tekenvlak, zodat een
    // late ResizeObserver-melding de schermplekken niet meer verschuift.
    <div className="fem-canvas-wrap" style={{ width: 1000, height: 600, position: "relative" }}>
      <FemCanvas
        tool={tool} onToolChange={(next) => { gereedschap = next; setTool(next); }}
        nodes={s.nodes} beams={s.beams} supports={s.supports} plates={s.plates} loads={s.loads}
        selection={s.selection} activeLoadCaseId={s.activeLoadCaseId} grid={{ ...DEFAULT_GRID, visible: false }}
        setSelection={s.setSelection} addNode={s.addNode} updateNode={s.updateNode} addBeam={s.addBeam}
        addPlate={s.addPlate} updatePlate={s.updatePlate} addSupport={s.addSupport} addLoad={s.addLoad}
        deleteSelected={s.deleteSelected} splitBeamAt={s.splitBeamAt}
        translateSelection={s.translateSelection} copySelection={s.copySelection}
        rotateSelection={s.rotateSelection} mirrorSelection={s.mirrorSelection}
        translateNodes={s.translateNodes}
        displayFlags={DEFAULT_DISPLAY_FLAGS} showLoads={false}
      />
    </div>
  );
}
let zetGereedschap: (tool: Tool) => void = () => {};

const svg = () => container.querySelector("svg.fem-canvas-svg, svg") as SVGSVGElement;
/** Schermpunt (client) van een modelknoop, gelezen van de getekende knoopcirkel. */
function knoop(id: number) {
  const index = store.nodes.findIndex((n) => n.id === id);
  const cirkel = container.querySelectorAll<SVGCircleElement>("circle.fem-node")[index];
  ok(cirkel, `knoop ${id} niet getekend`);
  const r = cirkel.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
function muis(type: string, p: { x: number; y: number }, doel?: Element, extra: MouseEventInit = {}) {
  const el = doel ?? document.elementFromPoint(p.x, p.y) ?? svg();
  flushSync(() => el.dispatchEvent(new MouseEvent(type, {
    clientX: p.x, clientY: p.y, button: 0, buttons: type === "mouseup" || type === "click" ? 0 : 1,
    bubbles: true, cancelable: true, ...extra,
  })));
}
async function sleep(van: { x: number; y: number }, naar: { x: number; y: number }, tijdens?: () => void) {
  muis("mousedown", van, svg());
  muis("mousemove", { x: (van.x + naar.x) / 2, y: (van.y + naar.y) / 2 }, svg());
  muis("mousemove", naar, svg());
  await wacht(30);
  tijdens?.();
  muis("mouseup", naar, svg());
  await wacht(30);
}
function toets(key: string, doel: EventTarget = window, extra: KeyboardEventInit = {}) {
  flushSync(() => { doel.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra })); });
}
const kader = () => container.querySelector<SVGRectElement>("rect.fem-box-select");
/**
 * Wacht tot het model geladen is en het beeld stilstaat. Het tekenvlak past
 * het beeld eenmaal in bij de eerste opmaak, en de ResizeObserver meldt de
 * echte maat pas daarna: tot dan kunnen de schermplekken nog verspringen.
 */
async function klaar() {
  let vorige = "";
  let stabiel = 0;
  for (let poging = 0; poging < 60; poging += 1) {
    await wacht(25);
    const cirkels = container.querySelectorAll("circle.fem-node");
    if (store?.nodes.length !== MODEL.nodes.length || cirkels.length !== MODEL.nodes.length) continue;
    const nu = JSON.stringify([knoop(1), knoop(3), svg().getBoundingClientRect().height]);
    stabiel = nu === vorige ? stabiel + 1 : 0;
    vorige = nu;
    if (stabiel >= 3) return;
  }
  throw Error(`tekenvlak niet klaar: knopen ${store?.nodes.length}, plekken ${vorige}`);
}

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", resources: { nl: { common, check } }, defaultNS: "common", initImmediate: false,
  });

  await test("crossing (naar links): de ligger die door het kader loopt; venster (naar rechts): niets", async () => {
    mount(<MetStore />);
    await klaar();
    gelijk(store.nodes.length, 6, "model geladen");
    const a = knoop(1), b = knoop(2);
    const midden = { x: (a.x + b.x) / 2, y: a.y };
    const rechts = { x: midden.x + 30, y: midden.y - 25 }, links = { x: midden.x - 30, y: midden.y + 25 };
    await sleep(rechts, links, () => {
      const rect = kader();
      ok(rect, "geen kader tijdens het slepen");
      gelijk(rect!.getAttribute("data-modus"), "crossing", "modus");
      ok(rect!.classList.contains("crossing"), "klasse crossing");
      const stijl = getComputedStyle(rect!);
      ok(stijl.strokeDasharray !== "none" && stijl.strokeDasharray !== "", `crossing gestippeld (${stijl.strokeDasharray})`);
      gelijk(stijl.stroke, "rgb(22, 163, 74)", "crossingkleur, licht thema");
    });
    gelijk(store.selection, { type: "beam", id: 1 }, "crossing selecteert de ligger");
    await sleep(links, rechts, () => {
      const rect = kader()!;
      gelijk(rect.getAttribute("data-modus"), "venster", "modus");
      const stijl = getComputedStyle(rect);
      gelijk(stijl.strokeDasharray, "none", "venster doorgetrokken");
      gelijk(stijl.stroke, "rgb(37, 99, 235)", "vensterkleur, licht thema");
    });
    gelijk(store.selection, null, "het venster bevat de ligger niet geheel");
  });

  await test("crossing over een hoek van de plaat: plaat en de knoop in het kader; venster: alleen de knoop", async () => {
    mount(<MetStore />);
    await klaar();
    const hoek = knoop(5); // (6000, 3000): rechtsboven van de plaat
    const rechts = { x: hoek.x + 20, y: hoek.y - 20 }, links = { x: hoek.x - 20, y: hoek.y + 20 };
    await sleep(rechts, links);
    gelijk(store.selection, { type: "multi", nodeIds: [5], beamIds: [], plateIds: [1] },
      `crossing (knoop 5 op ${JSON.stringify(hoek)}, nu op ${JSON.stringify(knoop(5))}, svg ${svg().getBoundingClientRect().height} px)`);
    await sleep(links, rechts);
    gelijk(store.selection, { type: "node", id: 5 }, "venster");
  });

  await test("donker thema: andere kaderkleuren, venster en crossing verschillend", async () => {
    document.documentElement.setAttribute("data-oa-theme", "dark");
    try {
      mount(<MetStore />);
      await klaar();
      const a = knoop(1), b = knoop(2);
      const midden = { x: (a.x + b.x) / 2, y: a.y };
      let crossing = "", venster = "";
      await sleep({ x: midden.x + 30, y: midden.y - 25 }, { x: midden.x - 30, y: midden.y + 25 },
        () => { crossing = getComputedStyle(kader()!).stroke; });
      await sleep({ x: midden.x - 30, y: midden.y - 25 }, { x: midden.x + 30, y: midden.y + 25 },
        () => { venster = getComputedStyle(kader()!).stroke; });
      gelijk([crossing, venster], ["rgb(74, 222, 128)", "rgb(96, 165, 250)"], "donkere kaderkleuren");
    } finally {
      document.documentElement.removeAttribute("data-oa-theme");
    }
  });

  await test("Escape: uit het gereedschap (selectie blijft), tweede Escape heft de selectie op; niet in een invoerveld", async () => {
    mount(<MetStore />);
    await klaar();
    flushSync(() => store.setSelection({ type: "beam", id: 1 }));
    flushSync(() => zetGereedschap("addBeam"));
    await wacht();
    const veld = document.createElement("input");
    document.body.appendChild(veld);
    veld.focus();
    toets("Escape", veld);
    veld.remove();
    await wacht();
    gelijk([gereedschap, store.selection], ["addBeam", { type: "beam", id: 1 }], "Escape in een invoerveld");
    toets("Escape");
    await wacht();
    gelijk([gereedschap, store.selection], ["select", { type: "beam", id: 1 }], "eerste Escape");
    toets("Escape");
    await wacht();
    gelijk([gereedschap, store.selection], ["select", null], "tweede Escape");
  });

  await test("Delete verwijdert een aangeklikte plaat; ongedaan maken zet haar terug", async () => {
    mount(<MetStore />);
    await klaar();
    const a = knoop(3), c = knoop(5);
    const binnen = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    const pad = document.elementFromPoint(binnen.x, binnen.y);
    ok(pad?.classList.contains("fem-plate"), `onder de klik ligt geen plaat maar ${pad?.tagName}.${pad?.getAttribute("class")}`);
    muis("mousedown", binnen, pad!);
    muis("mouseup", binnen, pad!);
    muis("click", binnen, pad!);
    await wacht();
    gelijk(store.selection, { type: "plate", id: 1 }, "plaat geselecteerd met één klik");
    toets("Delete");
    await wacht();
    gelijk([store.plates.length, store.nodes.length, store.selection], [0, 6, null], "plaat weg, knopen blijven");
    flushSync(() => store.undo());
    await wacht();
    gelijk(store.plates.map((p) => p.id), [1], "ongedaan maken zet de plaat terug");
  });

  await test("oplegging selecteren en met Ctrl+C/V tweemaal plakken: steun mee, elk plakken één undo-stap", async () => {
    mount(<MetStore />);
    await klaar();
    flushSync(() => store.addSupport(1, "pinned"));
    await wacht();
    const p = knoop(1);
    const driehoek = container.querySelector<SVGPolygonElement>('[data-support-node-id="1"] polygon');
    ok(driehoek, "opleggingssymbool ontbreekt");
    const symboolPunt = { x: p.x, y: p.y + 16 }; // buiten de knoopstraal
    muis("mousedown", symboolPunt, driehoek!);
    muis("mouseup", symboolPunt, driehoek!);
    muis("click", symboolPunt, driehoek!);
    gelijk(store.selection, { type: "node", id: 1 }, "klik op de oplegging selecteert de knoop");

    toets("c", window, { ctrlKey: true });
    toets("v", window, { ctrlKey: true });
    await wacht();
    gelijk([store.nodes.length, store.supports.length], [7, 2], "eerste plak bevat knoop en oplegging");
    const eerste = store.nodes.find((n) => n.x === 1500 && n.z === 5000);
    ok(eerste && store.supports.some((s) => s.nodeId === eerste.id && s.type === "pinned"),
      "eerste kopie staat 500 mm verder met dezelfde oplegging");

    toets("v", window, { ctrlKey: true });
    await wacht();
    gelijk([store.nodes.length, store.supports.length], [8, 3], "tweede plak bevat opnieuw knoop en oplegging");
    const tweede = store.nodes.find((n) => n.x === 2000 && n.z === 5000);
    ok(tweede && store.supports.some((s) => s.nodeId === tweede.id && s.type === "pinned"),
      "tweede kopie staat 1000 mm verder met dezelfde oplegging");

    flushSync(() => store.undo());
    gelijk([store.nodes.length, store.supports.length], [7, 2], "één undo haalt alleen de tweede plak weg");
    flushSync(() => store.undo());
    gelijk([store.nodes.length, store.supports.length], [6, 1], "tweede undo haalt de eerste plak weg");
  });
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, error: String(e?.stack ?? e) }); });

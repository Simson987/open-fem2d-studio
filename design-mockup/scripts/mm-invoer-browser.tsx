import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import common from "../src/i18n/locales/nl/common.json";
// Alleen voor de breedteproef van de rij Verbindingstolerantie (#55) in vier talen.
import commonEn from "../src/i18n/locales/en/common.json";
import commonDe from "../src/i18n/locales/de/common.json";
import commonFr from "../src/i18n/locales/fr/common.json";
import check from "../src/i18n/locales/nl/check.json";
import ribbon from "../src/i18n/locales/nl/ribbon.json";
import FemCanvas, { DimEditForm, PopoverLineLoadForm, PopoverEdgeLoadForm, PopoverPointLoadForm } from "../src/components/fem/FemCanvas";
import { DEFAULT_GRID } from "../src/components/fem/femTypes";
import { herstelSnapBeginstand, leesSnapInstellingen, zetHoekExtra, zetSnap, zetVerbindingsTolerantie } from "../src/hooks/useSnapInstellingen";
import { useFemStore } from "../src/hooks/useFemStore";
import ToastHost from "../src/components/feedback/Toast";
import ExplorerViewTab from "../src/components/fem/ExplorerViewTab";
import { DEFAULT_DISPLAY_FLAGS } from "../src/components/fem/FemResultsOverlay";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY } from "../src/components/openFem3d/openFem3dVisibility";
import FemProperties from "../src/components/fem/FemProperties";
import BarPropertiesDialog from "../src/components/fem/BarPropertiesDialog";
import KolomVelden from "../src/components/beton/KolomVelden";
import LoadCaseTabBar from "../src/components/fem/LoadCaseTabBar";
import LengthInput from "../src/components/LengthInput";
import WindGeneratorDialog from "../src/lib/wind/WindGeneratorDialog";
import { genereerWindbelasting, STANDAARD_WIND_INSTELLINGEN } from "../src/lib/wind/windGenerator";
import OpenFem3DTransformPanel from "../src/components/openFem3d/OpenFem3DTransformPanel";
import OpenFem3DProperties from "../src/components/openFem3d/OpenFem3DProperties";
import OpenFem3DMemberLoads from "../src/components/openFem3d/OpenFem3DMemberLoads";
import { transformOpenFem3D } from "../src/components/openFem3d/openFem3dTransform";
import WaterAccumulation2DDialog from "../src/components/fem/WaterAccumulation2DDialog";
import { calculateWaterAccumulation2D } from "../src/lib/waterAccumulation2d";

const tests: string[] = [];
const container = document.getElementById("root")!;
let root = createRoot(container);
function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error(message + ": " + JSON.stringify(actual) + " != " + JSON.stringify(expected));
}
function ok(value: unknown, message: string) { if (!value) throw Error(message); }
function mount(element: React.ReactNode) {
  flushSync(() => root.unmount());
  root = createRoot(container);
  flushSync(() => root.render(element));
}
function input(selector: string) {
  const el = container.querySelector<HTMLInputElement>(selector);
  if (!el) throw Error("Invoerveld ontbreekt: " + selector);
  return el;
}
function type(el: HTMLInputElement, value: string, blur = false) {
  el.focus();
  // Native setter om hetzelfde input-event als toetsenbordinvoer aan React te geven.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  flushSync(() => el.dispatchEvent(new Event("input", { bubbles: true })));
  if (blur) flushSync(() => el.blur());
}
function click(selector: string) {
  const el = container.querySelector<HTMLElement>(selector);
  if (!el) throw Error("Knop ontbreekt: " + selector);
  flushSync(() => el.click());
}
function rowInput(label: string) {
  const row = [...container.querySelectorAll(".fem-prop-row,.bar-props-row,label.wgd-getal")]
    .find(el => el.textContent?.includes(label) && el.querySelector("input"));
  if (!row) throw Error("Rij ontbreekt: " + label);
  return row.querySelector<HTMLInputElement>("input")!;
}
function key(k: string) {
  flushSync(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));
}
const nodes = [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }, { id: 3, x: 6000, z: 3000 }, { id: 4, x: 0, z: 3000 }];
const beam = { id: 1, from: 1, to: 2, material: "C24", profile: "96x281" };
const plate = { id: 1, nodeIds: [1, 2, 3, 4] };
const noop = () => {};
const propsBase = { nodes, beams: [beam], plates: [plate], supports: [], loads: [], updateNode: noop, addSupport: noop, removeSupport: noop, results: null };

// Headless met virtuele tijd maakt geen beeldframes, terwijl het tekenvlak de
// hover (en daarmee de richting van een staaf in aanbouw) één keer per frame
// bijwerkt. Laat een frame hier daarom een gewone timertaak zijn.
window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 0);
window.cancelAnimationFrame = (id) => window.clearTimeout(id);

async function run() {
  await i18next.use(initReactI18next).init({ lng: "nl", resources: { nl: { common, check, ribbon } }, defaultNS: "common", initImmediate: false });
  for (const enter of [false, true]) {
    let calls = 0;
    mount(<LengthInput required value={3} storedUnit="m" onChange={() => calls++} />);
    const el = input("input");
    type(el, "", !enter);
    if (enter) flushSync(() => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    equal(el.value, "3000", "Verplicht leeg veld herstelt opgeslagen waarde");
    equal(calls, 0, "Verplicht leeg veld schrijft niets");
    tests.push("LengthInput required: leeg + " + (enter ? "Enter" : "blur") + " herstelt 3000 mm");
  }
  const canvasProps = {
    nodes: [nodes[0]], beams: [], plates: [], supports: [], loads: [], selection: null,
    activeLoadCaseId: 1, grid: DEFAULT_GRID, setSelection: noop, addNode: () => 2,
    updateNode: noop, addBeam: noop, addPlate: noop, addSupport: noop, addLoad: noop,
    deleteSelected: noop, splitBeamAt: noop, translateSelection: noop, copySelection: noop,
    rotateSelection: noop, mirrorSelection: noop,
  };
  for (const raw of ["6000", "6000,5", "6000.5"]) {
    let point: number[] | undefined, added: number[] | undefined;
    mount(<FemCanvas {...canvasProps} tool="addBeam"
      addNode={(x, z) => { point = [x, z]; return 2; }} addBeam={(a, b) => { added = [a, b]; return 1; }} />);
    await new Promise(resolve => setTimeout(resolve, 50));
    const svg = container.querySelector<SVGSVGElement>("svg.fem-canvas-svg")!;
    const node = container.querySelector<SVGCircleElement>(".fem-node")!;
    const rect = svg.getBoundingClientRect();
    const x = rect.left + node.cx.baseVal.value, y = rect.top + node.cy.baseVal.value;
    flushSync(() => svg.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true })));
    flushSync(() => svg.dispatchEvent(new MouseEvent("click", { clientX: x, clientY: y, bubbles: true })));
    flushSync(() => svg.dispatchEvent(new MouseEvent("mousemove", { clientX: x + 500, clientY: y, bubbles: true })));
    // Het tekenvlak werkt de hover (en daarmee de richting van de staaf) één
    // keer per beeldframe bij; een mens typt nooit binnen hetzelfde frame.
    await new Promise(resolve => setTimeout(resolve, 50));
    for (const c of raw) key(c);
    ok(container.textContent!.includes("mm"), "HUD maat in mm");
    key("Enter");
    equal(point, [raw === "6000" ? 6000 : 6000.5, 0], "Getypte staaflengte in mm");
    equal(added, [1, 2], "Staaf met nieuw eindpunt");
    tests.push("Canvas staaf tekenen " + raw + " mm via muis en toetsenbord");
  }
  for (const [axis, raw, expected] of [["x", "250,5", [250.5, 0]], ["z", "-250.5", [0, -250.5]]]) {
    let moved: unknown;
    mount(<FemCanvas {...canvasProps} tool="select" selection={{ type: "node", id: 1 }}
      translateNodes={(ids, dx, dz) => moved = [ids, dx, dz]} />);
    key("g"); key(axis); for (const c of raw) key(c); key("Enter");
    equal(moved, [[1], ...expected], "G-komma/punt behoudt millimeters en teken");
    tests.push("G verplaatsen " + axis + ": " + raw + " mm");
  }
  {
    // Zoals in Blender (#54): tijdens G annuleert rechts, bevestigt links.
    let moved: unknown;
    mount(<FemCanvas {...canvasProps} tool="select" selection={{ type: "node", id: 1 }}
      translateNodes={(ids, dx, dz) => moved = [ids, dx, dz]} />);
    const svg = container.querySelector<SVGSVGElement>("svg.fem-canvas-svg")!;
    const r = svg.getBoundingClientRect();
    const muis = (button: number) => flushSync(() => svg.dispatchEvent(new MouseEvent("mousedown",
      { button, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true })));
    key("g"); key("x"); for (const c of "500") key(c);
    muis(2);
    equal(moved, undefined, "Rechtsklik annuleert de G-verplaatsing");
    ok(!container.textContent!.includes("500"), "Na annuleren is de G-modus weg");
    key("g"); key("x"); for (const c of "500") key(c);
    muis(0);
    equal(moved, [[1], 500, 0], "Linksklik bevestigt de G-verplaatsing");
    tests.push("G verplaatsen: rechtsklik annuleert, linksklik bevestigt");
  }
  {
    // #53 — tekenhulpen op het 2D-tekenvlak: hoeksnap, Shift als ortho en
    // Alt (snap tijdelijk uit). Posities in mm vanaf knoop 1 (0, 0); de
    // schaal komt uit de zoom (passend beeld), het raster is 500 mm.
    const wacht = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
    const anker = async () => {
      await wacht(50);
      const svg = container.querySelector<SVGSVGElement>("svg.fem-canvas-svg")!;
      const node = container.querySelector<SVGCircleElement>(".fem-node")!;
      const rect = svg.getBoundingClientRect();
      const x = rect.left + node.cx.baseVal.value, y = rect.top + node.cy.baseVal.value;
      const zoom = Number(/(\d+)%/.exec(container.querySelector(".fem-hud-tr")?.textContent ?? "")?.[1]);
      ok(zoom > 0, "Zoom in de HUD");
      const mmPerPx = 25 * 100 / zoom;   // 100 % = 1/25 px per mm
      // x naar rechts, z OMHOOG, in mm.
      const muis = (type: string, xMm: number, zMm: number, extra: MouseEventInit = {}) => flushSync(() =>
        svg.dispatchEvent(new MouseEvent(type, {
          clientX: x + xMm / mmPerPx, clientY: y - zMm / mmPerPx, bubbles: true, button: 0, ...extra,
        })));
      // cx/cy: de knoop in svg-coördinaten, om de hulplijn tegen te leggen.
      return { svg, muis, mmPerPx, cx: node.cx.baseVal.value, cy: node.cy.baseVal.value };
    };
    const hud = () => container.querySelector(".fem-hud-tl")?.textContent ?? "";
    const cursor = () => container.querySelector(".fem-hud-bl")?.textContent ?? "";
    const keyUp = (k: string) => flushSync(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: k, bubbles: true })));
    const keyDown = (k: string, extra: KeyboardEventInit = {}) =>
      flushSync(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...extra })));
    /**
     * De ortho-hulplijn ligt langs de verwachte as door (cx, cy): horizontaal
     * → y1 = y2 = cy, verticaal → x1 = x2 = cx.
     */
    const orthoLijnLangs = (as: "x" | "z", cx: number, cy: number, waar: string) => {
      const lijn = container.querySelector<SVGLineElement>(".fem-ortho-lijn");
      ok(lijn, "Gestippelde hulplijn " + waar);
      const [x1, y1, x2, y2] = ["x1", "y1", "x2", "y2"].map((a) => Number(lijn!.getAttribute(a)));
      const goed = as === "x"
        ? Math.abs(y1 - cy) < 0.01 && Math.abs(y2 - cy) < 0.01 && x1 !== x2
        : Math.abs(x1 - cx) < 0.01 && Math.abs(x2 - cx) < 0.01 && y1 !== y2;
      ok(goed, `Hulplijn ${waar} ${as === "x" ? "horizontaal" : "verticaal"} door het beginpunt: `
        + JSON.stringify({ x1, y1, x2, y2, cx, cy }));
    };

    // 1. Hoeksnap: eindpunt 0,29° boven horizontaal (800 mm rechts, 4 mm omhoog),
    //    raster uit zodat alleen de hoeksnap het punt kan rechtzetten.
    herstelSnapBeginstand(); zetSnap("raster", false);
    {
      let point: number[] | undefined, added: number[] | undefined;
      mount(<FemCanvas {...canvasProps} tool="addBeam"
        addNode={(x, z) => { point = [x, z]; return 2; }} addBeam={(a, b) => { added = [a, b]; return 1; }} />);
      const { muis, mmPerPx } = await anker();
      muis("mousemove", 0, 0); muis("click", 0, 0);
      muis("mousemove", 800, 4); await wacht();
      equal(container.querySelector(".fem-hoek-label")?.textContent, "0°", "Label met de vastgezette hoek");
      ok(container.querySelector(".fem-member-preview.hoek"), "Voorbeeldstaaf in de accentkleur (klasse hoek)");
      muis("click", 800, 4);
      ok(point !== undefined && point[1] === 0, "Hoeksnap: eindpunt exact horizontaal: " + JSON.stringify(point));
      ok(Math.abs(point![0] - Math.hypot(800, 4)) < mmPerPx, "Hoeksnap behoudt de lengte: " + JSON.stringify(point));
      equal(added, [1, 2], "Staaf van knoop 1 naar het nieuwe eindpunt");
      tests.push("Hoeksnap: eindpunt 0,3° uit horizontaal wordt exact horizontaal, lengte gelijk, label 0°");
    }
    {
      // Getypte lengte volgt de vastgezette hoek.
      let point: number[] | undefined;
      mount(<FemCanvas {...canvasProps} tool="addBeam" addNode={(x, z) => { point = [x, z]; return 2; }} addBeam={() => 1} />);
      const { muis } = await anker();
      muis("mousemove", 0, 0); muis("click", 0, 0);
      muis("mousemove", 600, -4); await wacht();
      for (const c of "6000") key(c);
      key("Enter");
      equal(point, [6000, 0], "Getypte lengte langs de vastgezette hoek");
      tests.push("Hoeksnap: getypte staaflengte volgt de vastgezette hoek (6000 mm exact horizontaal)");
    }
    {
      // Buiten de tolerantie (5°) blijft het punt zoals het is.
      let point: number[] | undefined;
      mount(<FemCanvas {...canvasProps} tool="addBeam" addNode={(x, z) => { point = [x, z]; return 2; }} addBeam={() => 1} />);
      const { muis, mmPerPx } = await anker();
      muis("mousemove", 0, 0); muis("click", 0, 0);
      muis("mousemove", 800, 70); await wacht();
      ok(!container.querySelector(".fem-hoek-label"), "Geen hoeklabel buiten de tolerantie");
      muis("click", 800, 70);
      ok(point !== undefined && Math.abs(point[1] - 70) < mmPerPx, "Buiten de tolerantie geen hoeksnap: " + JSON.stringify(point));
      tests.push("Hoeksnap: buiten de tolerantie (5°) geen hoeksnap");
    }
    herstelSnapBeginstand();
    {
      // Raster aan (500) en extra hoeken: een rasterpunt dat al precies op 45°
      // ligt, blijft dat rasterpunt (niet de lengte afronden naar 1500).
      zetHoekExtra(true);
      for (const [xMm, zMm] of [[1000, 1000], [-1000, 1000]]) {
        let point: number[] | undefined;
        mount(<FemCanvas {...canvasProps} tool="addBeam" addNode={(x, z) => { point = [x, z]; return 2; }} addBeam={() => 1} />);
        const { muis } = await anker();
        muis("mousemove", 0, 0); muis("click", 0, 0);
        muis("mousemove", xMm, zMm); await wacht();
        equal(container.querySelector(".fem-hoek-label")?.textContent, xMm > 0 ? "45°" : "135°", "Label bij een rasterpunt op de diagonaal");
        muis("click", xMm, zMm);
        equal(point, [xMm, zMm], "Rasterpunt op 45° blijft het rasterpunt");
      }
      herstelSnapBeginstand();
      tests.push("Hoeksnap met raster en extra hoeken: rasterpunt (1000, 1000) op 45° blijft (1000, 1000)");
    }
    {
      // Een knoop gaat voor op de hoeksnap: knoop 2 ligt 1,15° boven
      // horizontaal. De staaf gaat naar knoop 2, zonder losse knoop ernaast.
      const calls: unknown[] = [];
      mount(<FemCanvas {...canvasProps} nodes={[nodes[0], { id: 2, x: 2000, z: 40 }]} tool="addBeam"
        addNode={(x, z) => { calls.push(["addNode", x, z]); return 3; }}
        addBeam={(a, b) => { calls.push(["addBeam", a, b]); return 1; }} />);
      const { muis } = await anker();
      muis("mousemove", 0, 0); muis("click", 0, 0);
      muis("mousemove", 2000, 40); await wacht();
      ok(!container.querySelector(".fem-hoek-label"), "Op een knoop geen hoeklabel");
      muis("click", 2000, 40);
      equal(calls, [["addBeam", 1, 2]], "Knoop gaat voor op de hoeksnap");
      tests.push("Hoeksnap: een knoop binnen 2° gaat voor (staaf naar knoop 2, geen losse knoop)");
    }
    {
      // Idem voor een stramiensnijpunt (as B op x = 2000, peil +40): het
      // eindpunt wordt het snijpunt (2000, 40), niet (2000, 0).
      const calls: unknown[] = [];
      const stramien = {
        enabled: true,
        xAxes: [{ id: "b", label: "B", position: 2000 }],
        zAxes: [{ id: "p", label: "+40", position: 40 }],
      };
      mount(<FemCanvas {...canvasProps} structuralGrid={stramien} tool="addBeam"
        addNode={(x, z) => { calls.push(["addNode", x, z]); return 3; }}
        addBeam={(a, b) => { calls.push(["addBeam", a, b]); return 1; }} />);
      const { muis, mmPerPx } = await anker();
      muis("mousemove", 0, 0); muis("click", 0, 0);
      const naast = 2 * mmPerPx;   // 2 px naast het snijpunt, binnen de stramienstraal
      muis("mousemove", 2000 + naast, 40 + naast); await wacht();
      ok(!container.querySelector(".fem-hoek-label"), "Op een stramiensnijpunt geen hoeklabel");
      muis("click", 2000 + naast, 40 + naast);
      equal(calls, [["addNode", 2000, 40], ["addBeam", 1, 3]], "Stramien gaat voor op de hoeksnap");
      tests.push("Hoeksnap: een stramiensnijpunt binnen 2° gaat voor (eindpunt (2000, 40))");
    }

    // 2. Shift als ortho bij het tekenen van een staaf (raster aan): ortho
    //    bepaalt de richting, het raster de afstand.
    for (const [xMm, zMm, verwacht, naam] of [
      [602, 400, [500, 0], "horizontaal"], [200, 480, [0, 500], "verticaal"], [-602, -400, [-500, 0], "naar links"],
    ] as const) {
      let point: number[] | undefined;
      mount(<FemCanvas {...canvasProps} tool="addBeam" addNode={(x, z) => { point = [x, z]; return 2; }} addBeam={() => 1} />);
      const { muis, cx, cy } = await anker();
      muis("mousemove", 0, 0); muis("click", 0, 0);
      muis("mousemove", xMm, zMm, { shiftKey: true }); await wacht();
      ok(hud().includes("Ortho (Shift)"), "HUD toont Ortho (Shift): " + hud());
      orthoLijnLangs(verwacht[1] === 0 ? "x" : "z", cx, cy, "bij een staaf (" + naam + ")");
      muis("click", xMm, zMm, { shiftKey: true });
      equal(point, verwacht, "Shift: schuine beweging wordt " + naam + ", raster bepaalt de afstand");
      tests.push("Shift-ortho bij een staaf: schuin wordt " + naam + " " + JSON.stringify(verwacht));
    }
    {
      // Zonder Shift dezelfde schuine beweging: schuin (raster), geen HUD-melding.
      let point: number[] | undefined;
      mount(<FemCanvas {...canvasProps} tool="addBeam" addNode={(x, z) => { point = [x, z]; return 2; }} addBeam={() => 1} />);
      const { muis } = await anker();
      muis("mousemove", 0, 0); muis("click", 0, 0);
      muis("mousemove", 602, 400); await wacht();
      ok(!hud().includes("Ortho"), "Geen Ortho zonder Shift");
      ok(!container.querySelector(".fem-ortho-lijn"), "Geen hulplijn zonder Shift");
      muis("click", 602, 400);
      equal(point, [500, 500], "Zonder Shift blijft de beweging schuin");
      tests.push("Zonder Shift: schuine staaf blijft schuin");
    }
    {
      // Shift-ortho bij G-verplaatsen.
      let moved: unknown;
      mount(<FemCanvas {...canvasProps} tool="select" selection={{ type: "node", id: 1 }}
        translateNodes={(ids, dx, dz) => moved = [ids, dx, dz]} />);
      const { muis, cx, cy } = await anker();
      muis("mousemove", 0, 0); await wacht();
      key("g");
      // Een muisbeweging is een "doorlopende" gebeurtenis: React tekent hem
      // pas na het lopende frame. Wacht daarom, zoals een mens altijd doet.
      muis("mousemove", 602, 400, { shiftKey: true }); await wacht();
      ok(hud().includes("Ortho (Shift)"), "HUD toont Ortho bij G: " + hud());
      orthoLijnLangs("x", cx, cy, "bij G");
      muis("mousedown", 602, 400, { shiftKey: true });
      equal(moved, [[1], 500, 0], "G met Shift: alleen horizontaal");
      tests.push("Shift-ortho bij G-verplaatsen: schuin wordt horizontaal");
    }
    {
      // Shift-ortho bij slepen van een knoop.
      let moved: unknown;
      mount(<FemCanvas {...canvasProps} tool="select" selection={{ type: "node", id: 1 }}
        translateNodes={(ids, dx, dz) => moved = [ids, dx, dz]} />);
      const { muis, cx, cy } = await anker();
      muis("mousedown", 0, 0);
      muis("mousemove", 300, 560, { shiftKey: true }); await wacht();
      orthoLijnLangs("z", cx, cy, "bij slepen");
      muis("mouseup", 300, 560, { shiftKey: true });
      equal(moved, [[1], 0, 500], "Slepen met Shift: alleen verticaal");
      tests.push("Shift-ortho bij slepen: schuin wordt verticaal");
    }
    {
      // R-draaien houdt Shift als vrij draaien, ook met de tekenhulpen erbij.
      mount(<FemCanvas {...canvasProps} tool="select" selection={{ type: "node", id: 1 }} rotateSelection={noop} />);
      const { muis } = await anker();
      muis("mousemove", 500, 0); await wacht();
      key("r");
      const chip = () => container.querySelector(".fem-hud-tc")?.textContent ?? "";
      ok(chip().includes("[snap 15°]"), "R begint met snap 15°: " + chip());
      flushSync(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", shiftKey: true, bubbles: true })));
      await wacht();
      ok(chip().includes("[vrij]") && !chip().includes("snap 15°"), "Shift tijdens R: vrij draaien: " + chip());
      ok(!hud().includes("Ortho"), "Geen ortho tijdens R");
      keyUp("Shift");
      tests.push("R-draaien: Shift blijft vrij draaien (geen ortho)");
    }
    {
      // Shift bij klikken blijft meervoudige selectie.
      let sel: unknown;
      const twee = [{ id: 1, x: 0, z: 0 }, { id: 2, x: 5000, z: 0 }];
      mount(<FemCanvas {...canvasProps} nodes={twee} tool="select" selection={{ type: "node", id: 1 }}
        setSelection={(s) => sel = s} translateNodes={noop} />);
      await wacht(50);
      const svg = container.querySelector<SVGSVGElement>("svg.fem-canvas-svg")!;
      const rect = svg.getBoundingClientRect();
      const tweede = container.querySelectorAll<SVGCircleElement>(".fem-node")[1];
      const opTweede = (type: string) => flushSync(() => svg.dispatchEvent(new MouseEvent(type, {
        clientX: rect.left + tweede.cx.baseVal.value, clientY: rect.top + tweede.cy.baseVal.value,
        bubbles: true, button: 0, shiftKey: true,
      })));
      opTweede("mousedown"); opTweede("mouseup");
      equal(sel, { type: "multi", nodeIds: [1, 2], beamIds: [], plateIds: [] }, "Shift-klik voegt toe aan de selectie");
      tests.push("Shift-klik in Selecteren blijft meervoudige selectie");
    }
    {
      // Een Shift-klik met een paar pixels handbeweging (onder de sleepdrempel
      // van 4 px) is nog geen sleep: geen hulplijn en geen Ortho in de HUD.
      let sel: unknown;
      const twee = [{ id: 1, x: 0, z: 0 }, { id: 2, x: 1000, z: 0 }];
      mount(<FemCanvas {...canvasProps} nodes={twee} tool="select" selection={{ type: "node", id: 1 }}
        setSelection={(s) => sel = s} translateNodes={noop} />);
      const { muis, mmPerPx } = await anker();
      muis("mousedown", 1000, 0, { shiftKey: true });
      muis("mousemove", 1000 + 2 * mmPerPx, 0, { shiftKey: true }); await wacht();
      ok(!container.querySelector(".fem-ortho-lijn"), "Geen hulplijn bij een Shift-klik zonder sleep");
      ok(!hud().includes("Ortho"), "Geen Ortho in de HUD bij een Shift-klik zonder sleep: " + hud());
      muis("mouseup", 1000 + 2 * mmPerPx, 0, { shiftKey: true });
      equal(sel, { type: "multi", nodeIds: [1, 2], beamIds: [], plateIds: [] }, "Shift-klik met 2 px beweging selecteert");
      tests.push("Shift-klik met 2 px handbeweging: geen ortho-hulplijn of HUD-melding, wel selectie");
    }
    {
      // Hysterese van de ortho-as op het tekenvlak: (1000, 900) is horizontaal;
      // (1000, 1100) blijft horizontaal (1,1× < 1,25×); (1000, 1400) wordt verticaal.
      mount(<FemCanvas {...canvasProps} tool="addBeam" addNode={() => 2} addBeam={() => 1} />);
      const { muis, cx, cy } = await anker();
      muis("mousemove", 0, 0); muis("click", 0, 0);
      muis("mousemove", 1000, 900, { shiftKey: true }); await wacht();
      ok(cursor().includes("(1.00, 0.00) m"), "Shift naar (1000, 900): horizontaal: " + cursor());
      muis("mousemove", 1000, 1100, { shiftKey: true }); await wacht();
      ok(cursor().includes("(1.00, 0.00) m"), "Shift naar (1000, 1100): blijft horizontaal: " + cursor());
      orthoLijnLangs("x", cx, cy, "bij (1000, 1100)");
      muis("mousemove", 1000, 1400, { shiftKey: true }); await wacht();
      ok(cursor().includes("(0.00, 1.50) m"), "Shift naar (1000, 1400): verticaal: " + cursor());
      orthoLijnLangs("z", cx, cy, "bij (1000, 1400)");
      tests.push("Shift-ortho: hysterese — (1000, 1100) blijft horizontaal, (1000, 1400) wordt verticaal");
    }
    {
      // Slepen met Alt bij het indrukken (6 px naast de knoop) en Alt los
      // vóór het loslaten: de verplaatsing is weer een hele rasterstap.
      let moved: unknown;
      mount(<FemCanvas {...canvasProps} tool="select" selection={{ type: "node", id: 1 }}
        translateNodes={(ids, dx, dz) => moved = [ids, dx, dz]} />);
      const { muis, mmPerPx } = await anker();
      const naast = 6 * mmPerPx;
      muis("mousedown", naast, 0, { altKey: true });
      muis("mousemove", 500, 0); await wacht();
      muis("mousemove", 1000, 0); await wacht();
      muis("mouseup", 1000, 0);
      equal(moved, [[1], 1000, 0], "Alt bij indrukken, los vóór het loslaten: verplaatsing (1000, 0)");
      // Alt de hele sleep ingedrukt: vrij, muispunt min indrukpunt.
      let vrij: number[] | undefined;
      mount(<FemCanvas {...canvasProps} tool="select" selection={{ type: "node", id: 1 }}
        translateNodes={(ids, dx, dz) => vrij = [dx, dz]} />);
      const a = await anker();
      a.muis("mousedown", 6 * a.mmPerPx, 0, { altKey: true });
      a.muis("mousemove", 1003, 0, { altKey: true }); await wacht();
      a.muis("mouseup", 1003, 0, { altKey: true });
      // Binnen één pixel: de browser rondt clientX af op hele pixels.
      ok(vrij !== undefined && Math.abs(vrij[0] - (1003 - 6 * a.mmPerPx)) <= a.mmPerPx && vrij[0] % 500 !== 0
        && Math.abs(vrij[1]) < 1e-9, "Alt de hele sleep: vrije verplaatsing: " + JSON.stringify(vrij));
      tests.push("Slepen: Alt alleen bij het indrukken geeft (1000, 0); Alt de hele sleep een vrije verplaatsing");
    }
    {
      // Subknoop met Alt: de knoop komt waar de muis is, niet op het raster.
      const opStaaf = { ...canvasProps, nodes: [nodes[0], nodes[1]], beams: [beam] };
      for (const alt of [false, true]) {
        let split: number[] | undefined;
        mount(<FemCanvas {...opStaaf} tool="addSubNode" splitBeamAt={(id, x, z) => { split = [id, x, z]; }} />);
        const { muis, mmPerPx } = await anker();
        muis("mousemove", 1234, 0, { altKey: alt }); await wacht();
        equal(hud().includes("Snap tijdelijk uit (Alt)"), alt, "HUD-melding bij Subknoop, Alt " + (alt ? "aan" : "uit") + ": " + hud());
        muis("click", 1234, 0, { altKey: alt });
        if (alt) {
          ok(split !== undefined && split[0] === 1 && Math.abs(split[1] - 1234) < mmPerPx && Math.abs(split[2]) < 1e-6,
            "Subknoop met Alt op de muispositie: " + JSON.stringify(split));
        } else {
          equal(split, [1, 1000, 0], "Subknoop zonder Alt op het raster");
        }
      }
      // Lijnlast kiest een hele staaf: daar doet Alt niets, dus ook geen melding.
      mount(<FemCanvas {...opStaaf} tool="addLineLoad" />);
      const { muis } = await anker();
      muis("mousemove", 1234, 0, { altKey: true }); await wacht();
      ok(!hud().includes("Snap tijdelijk uit"), "Geen Alt-melding bij Lijnlast: " + hud());
      tests.push("Alt bij Subknoop: knoop op de muispositie (1234), zonder Alt op het raster (1000); geen melding bij Lijnlast");
    }
    {
      // Focusverlies (Alt+Tab) laat Alt los: melding weg en het punt onder de
      // muis meteen terug op het raster, zonder muisbeweging.
      mount(<FemCanvas {...canvasProps} tool="addBeam" addNode={() => 2} addBeam={() => 1} />);
      const { muis } = await anker();
      muis("mousemove", 0, 0); muis("click", 0, 0);
      muis("mousemove", 422, 214); await wacht();
      keyDown("Alt", { altKey: true }); await wacht();
      ok(hud().includes("Snap tijdelijk uit (Alt)") && cursor().includes("(0.42, 0.21) m"), "Alt ingedrukt: vrij: " + hud() + " " + cursor());
      flushSync(() => window.dispatchEvent(new Event("blur"))); await wacht();
      ok(!hud().includes("Snap tijdelijk uit"), "Na focusverlies is de Alt-melding weg: " + hud());
      ok(cursor().includes("(0.50, 0.00) m"), "Na focusverlies weer op het raster: " + cursor());
      // Hetzelfde voor Shift: geen ortho meer na focusverlies.
      muis("mousemove", 602, 400, { shiftKey: true }); await wacht();
      ok(hud().includes("Ortho (Shift)"), "Shift: ortho");
      flushSync(() => window.dispatchEvent(new Event("blur"))); await wacht();
      ok(!hud().includes("Ortho") && !container.querySelector(".fem-ortho-lijn"), "Na focusverlies geen ortho meer: " + hud());
      tests.push("Focusverlies laat Alt en Shift los: HUD-melding weg, punt terug op de snap");
    }

    // 3. Alt: snap tijdelijk uit.
    for (const alt of [false, true]) {
      let point: number[] | undefined;
      mount(<FemCanvas {...canvasProps} tool="addNode" addNode={(x, z) => { point = [x, z]; return 2; }} />);
      const { muis, mmPerPx } = await anker();
      muis("mousemove", 422, 214, { altKey: alt }); await wacht();
      equal(hud().includes("Snap tijdelijk uit (Alt)"), alt, "HUD-melding Alt " + (alt ? "aan" : "uit") + ": " + hud());
      muis("click", 422, 214, { altKey: alt });
      if (alt) {
        ok(point !== undefined && Math.abs(point[0] - 422) < mmPerPx && Math.abs(point[1] - 214) < mmPerPx,
          "Met Alt: vrij punt naast het raster: " + JSON.stringify(point));
      } else {
        equal(point, [500, 0], "Zonder Alt: rasterpunt");
      }
    }
    tests.push("Alt: een punt naast een rasterpunt blijft naast (422, 214), zonder Alt het rasterpunt (500, 0)");
    {
      // Alt indrukken en loslaten zonder de muis te bewegen: HUD en cursor volgen.
      let point: number[] | undefined;
      mount(<FemCanvas {...canvasProps} tool="addBeam" addNode={(x, z) => { point = [x, z]; return 2; }} addBeam={() => 1} />);
      const { muis } = await anker();
      muis("mousemove", 0, 0); muis("click", 0, 0);
      muis("mousemove", 422, 214); await wacht();
      ok(cursor().includes("(0.50, 0.00) m"), "Zonder Alt: cursor op het raster: " + cursor());
      flushSync(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true, bubbles: true })));
      await wacht();
      ok(hud().includes("Snap tijdelijk uit (Alt)"), "Alt ingedrukt: HUD-melding");
      ok(cursor().includes("(0.42, 0.21) m"), "Alt ingedrukt: cursor vrij: " + cursor());
      keyUp("Alt"); await wacht();
      ok(!hud().includes("Snap tijdelijk uit"), "Alt losgelaten: melding weg");
      ok(cursor().includes("(0.50, 0.00) m"), "Alt losgelaten: weer op het raster: " + cursor());
      muis("click", 422, 214);
      equal(point, [500, 0], "Na loslaten snapt de klik weer");
      tests.push("Alt indrukken en loslaten zonder muisbeweging: HUD en cursor volgen");
    }
    {
      // 4. De tab Weergave: rij Hoek met tolerantie (komma en punt) en de extra hoeken.
      herstelSnapBeginstand();
      const tab = (workspace: "2d" | "3d") => mount(<ExplorerViewTab
        displayFlags={DEFAULT_DISPLAY_FLAGS} setDisplayFlags={noop} workspace={workspace}
        gridShow={false} setGridShow={noop} stramienAan setStramienAan={noop}
        openFem3dVisibility={DEFAULT_OPEN_FEM_3D_VISIBILITY} setOpenFem3DVisibility={noop} />);
      tab("2d");
      const rij = () => [...container.querySelectorAll<HTMLButtonElement>(".explorer-view-toggle")]
        .find((el) => el.textContent === "Hoek");
      ok(rij(), "Rij Hoek in 2D");
      equal(rij()!.getAttribute("aria-checked"), "true", "Hoeksnap staat standaard aan");
      const veld = () => input('[data-snap-opties="hoek"] input[type="text"]');
      equal(veld().value, "2", "Standaardtolerantie 2°");
      const enter = () => flushSync(() => veld().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      type(veld(), "2,5"); enter();
      equal(leesSnapInstellingen().hoekTolerantie, 2.5, "Komma: 2,5°");
      equal(JSON.parse(localStorage.getItem("open-fem-studio.snapInstellingen") ?? "null")?.hoekTolerantie, 2.5,
        "Tolerantie bewaard in localStorage");
      equal(veld().value, "2,5", "Veld toont 2,5");
      type(veld(), "0.75", true);
      equal(leesSnapInstellingen().hoekTolerantie, 0.75, "Punt (bij verlaten van het veld): 0,75°");
      type(veld(), "abc"); enter();
      equal([leesSnapInstellingen().hoekTolerantie, veld().value], [0.75, "0,75"], "Ongeldig: bewaarde waarde blijft");
      type(veld(), "40"); enter();
      equal(leesSnapInstellingen().hoekTolerantie, 15, "Boven 15° wordt 15°");
      const vink = input('[data-snap-opties="hoek"] input[type="checkbox"]');
      equal(vink.checked, false, "Extra hoeken standaard uit");
      flushSync(() => vink.click());
      equal(leesSnapInstellingen().hoekExtra, true, "Extra hoeken aan");
      flushSync(() => rij()!.click());
      equal(leesSnapInstellingen().hoek, false, "Hoeksnap uit via de rij");
      tab("3d");
      ok(!rij() && !container.querySelector('[data-snap-opties="hoek"]'), "Geen rij Hoek in 3D");
      herstelSnapBeginstand();
      tests.push("Tab Weergave: rij Hoek, tolerantie met komma en punt (0,1–15), extra hoeken, alleen in 2D");
    }
    herstelSnapBeginstand();
  }
  {
    // #55 — verbindingstolerantie. (a) De rij in de tab Weergave: komma en
    // punt, begrensd op 0,1–25 mm, bewaard, uitleg als tooltip. Sinds #63
    // staat dezelfde rij ook in 3D, met de uitleg van 3D (de knoop wordt daar
    // niet verplaatst).
    herstelSnapBeginstand();
    // In een vak van 240 px: de standaardbreedte van het linkerpaneel
    // (App.tsx, leftPanelWidth). De stijl van de tab laadt test-mm-invoer-ui.
    const tab = (workspace: "2d" | "3d") => mount(<div style={{ width: 240 }}><ExplorerViewTab
      displayFlags={DEFAULT_DISPLAY_FLAGS} setDisplayFlags={noop} workspace={workspace}
      gridShow={false} setGridShow={noop} stramienAan setStramienAan={noop}
      openFem3dVisibility={DEFAULT_OPEN_FEM_3D_VISIBILITY} setOpenFem3DVisibility={noop} /></div>);
    tab("2d");
    const rij = () => container.querySelector<HTMLElement>('[data-snap-opties="verbinding"]');
    ok(rij(), "Rij Verbindingstolerantie in 2D");
    ok((rij()!.getAttribute("title") ?? "").includes("'op de staaf' of 'op dezelfde plek'"),
      "Uitleg als tooltip: " + rij()!.getAttribute("title"));
    ok(rij()!.closest(".explorer-view-section")?.querySelector(".fem-results-section-title")?.textContent === "Snap",
      "De rij staat bij de snaprijen");
    const veld = () => input('[data-snap-opties="verbinding"] input[type="text"]');
    equal(veld().getAttribute("aria-label"), "Verbindingstolerantie (mm)", "Veld met naam en eenheid");
    // Label en eenheid ZICHTBAAR bij 240 px, in alle vier talen: het label niet
    // afgekapt, de eenheid "mm" naast het veld en binnen de rij.
    const zichtbaar = (taal: string) => {
      const label = rij()!.querySelector<HTMLElement>(".explorer-view-invoer-label")!;
      const eenheid = rij()!.querySelector<HTMLElement>(".explorer-view-invoer-eenheid")!;
      ok(label && eenheid, taal + ": label en eenheid in de rij");
      equal(eenheid.textContent, "mm", taal + ": eenheid achter het veld");
      const r = rij()!.getBoundingClientRect(), e = eenheid.getBoundingClientRect(), v = veld().getBoundingClientRect();
      ok(getComputedStyle(label).textOverflow !== "ellipsis" && label.scrollWidth <= label.clientWidth + 1,
        `${taal}: label niet afgekapt (${label.scrollWidth} > ${label.clientWidth}): ${label.textContent}`);
      // Op één regel: niet midden in een woord afgebroken (het veld wijkt
      // desnoods uit naar een tweede regel).
      const l = label.getBoundingClientRect();
      const regel = parseFloat(getComputedStyle(label).lineHeight);
      ok(l.height <= regel * 1.2, `${taal}: label op één regel (${l.height} px, regel ${regel} px): ${label.textContent}`);
      ok(e.width > 0 && e.left >= v.right && e.right <= r.right + 0.5,
        `${taal}: "mm" zichtbaar rechts van het veld en binnen de rij: ${JSON.stringify([e.left, e.right, v.right, r.right])}`);
      ok(v.left >= l.right - 0.5 || v.top >= l.bottom - 0.5,
        `${taal}: veld naast of onder het label, niet erover: ${JSON.stringify([l.right, l.bottom, v.left, v.top])}`);
      return label.textContent;
    };
    equal(zichtbaar("nl"), "Verbindingstolerantie", "Label nl");
    for (const [taal, locale] of [["en", commonEn], ["de", commonDe], ["fr", commonFr]] as const) {
      i18next.addResourceBundle(taal, "common", locale, true, true);
      await i18next.changeLanguage(taal);
      tab("2d");
      equal(zichtbaar(taal), locale.zichtbaarheid.verbindingsTolerantie, "Label " + taal);
    }
    await i18next.changeLanguage("nl");
    tab("2d");
    equal(veld().value, "5", "Standaard 5 mm");
    const enter = () => flushSync(() => veld().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    type(veld(), "2,5"); enter();
    equal(leesSnapInstellingen().verbindingsTolerantie, 2.5, "Komma: 2,5 mm");
    equal(JSON.parse(localStorage.getItem("open-fem-studio.snapInstellingen") ?? "null")?.verbindingsTolerantie, 2.5,
      "Verbindingstolerantie bewaard in localStorage, met de snaps");
    equal(veld().value, "2,5", "Veld toont 2,5");
    type(veld(), "0.75", true);
    equal(leesSnapInstellingen().verbindingsTolerantie, 0.75, "Punt (bij verlaten van het veld): 0,75 mm");
    type(veld(), "abc"); enter();
    equal([leesSnapInstellingen().verbindingsTolerantie, veld().value], [0.75, "0,75"], "Ongeldig: bewaarde waarde blijft");
    type(veld(), "80"); enter();
    equal(leesSnapInstellingen().verbindingsTolerantie, 25, "Boven 25 mm wordt 25 (de helft van de kleinste rasterstap)");
    type(veld(), "0,01"); enter();
    equal(leesSnapInstellingen().verbindingsTolerantie, 0.1, "Onder 0,1 mm wordt 0,1");
    tab("2d");
    equal(veld().value, "0,1", "Opnieuw geopend: de bewaarde waarde");
    tab("3d");
    ok(rij(), "Rij Verbindingstolerantie ook in 3D (#63)");
    equal(veld().value, "0,1", "3D: dezelfde instelling als 2D");
    ok((rij()!.getAttribute("title") ?? "").includes("De knoop wordt niet verplaatst"),
      "3D: de uitleg van 3D als tooltip: " + rij()!.getAttribute("title"));
    herstelSnapBeginstand();
    tests.push("Tab Weergave: rij Verbindingstolerantie, eenheid mm zichtbaar en label heel bij 240 px (nl/en/de/fr), komma en punt (0,1–25), bewaard, tooltip; in 3D dezelfde instelling met de uitleg van 3D (#63)");
  }
  {
    // #102 — Eén klik die twee undo-stappen opslaat (een staaf naar een nieuw
    // eindpunt: eerst de knoop, dan de staaf). Daarna moet Ctrl+Z gewoon werken:
    // eerst de staaf weg, dan de knoop, en Ctrl+Y zet ze terug.
    const wacht = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
    let store: ReturnType<typeof useFemStore> | undefined;
    function MetStore() {
      const s = useFemStore();
      store = s;
      const [geladen, setGeladen] = React.useState(false);
      React.useEffect(() => {
        s.loadProjectState({
          nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 4000, z: 0 }], beams: [], supports: [], plates: [], loads: [],
          loadCases: s.loadCases, activeLoadCaseId: s.activeLoadCaseId,
        });
        setGeladen(true);
      }, []);
      return geladen ? <FemCanvas {...canvasProps} tool="addBeam"
        nodes={s.nodes} beams={s.beams} supports={s.supports} plates={s.plates} loads={s.loads}
        addNode={s.addNode} addBeam={s.addBeam} addNodeMetSplitsing={s.addNodeMetSplitsing} /> : null;
    }
    herstelSnapBeginstand();
    mount(<MetStore />);
    await wacht(80);
    const svg = container.querySelector<SVGSVGElement>("svg.fem-canvas-svg")!;
    const knoop1 = container.querySelector<SVGCircleElement>(".fem-node")!;
    const rect = svg.getBoundingClientRect();
    const x0 = rect.left + knoop1.cx.baseVal.value, y0 = rect.top + knoop1.cy.baseVal.value;
    const muis = (soort: string, dx: number, dy: number) => flushSync(() =>
      svg.dispatchEvent(new MouseEvent(soort, { clientX: x0 + dx, clientY: y0 + dy, bubbles: true, button: 0 })));
    muis("mousemove", 0, 0); muis("click", 0, 0);
    muis("mousemove", 0, -120); await wacht();
    muis("click", 0, -120); await wacht();
    equal([store!.nodes.length, store!.beams.length], [3, 1], "Staaf naar een nieuw eindpunt: knoop en staaf erbij");
    const stand = () => [store!.nodes.length, store!.beams.length];
    const doe = async (actie: "undo" | "redo") => {
      let fout: unknown = null;
      try { flushSync(() => store![actie]()); } catch (e) { fout = e; }
      await wacht();
      ok(fout === null, actie + " gaf een fout: " + String(fout));
    };
    await doe("undo"); equal(stand(), [3, 0], "Eerste Ctrl+Z: de staaf weg, de knoop blijft");
    await doe("undo"); equal(stand(), [2, 0], "Tweede Ctrl+Z: ook de nieuwe knoop weg");
    await doe("redo"); equal(stand(), [3, 0], "Ctrl+Y: de knoop terug");
    await doe("redo"); equal(stand(), [3, 1], "Ctrl+Y: de staaf terug");
    tests.push("Undo na een klik met twee stappen (#102): staaf en knoop apart terug, zonder fout");
  }
  {
    // #55 — (b) Het tekenvlak met de echte store. Ligger 2→3 op z = -996 mm,
    // 4 mm boven de rasterlijn z = -1000. Teken met Shift (ortho) een kolom
    // vanaf knoop 1 (0, 0) recht omlaag: het raster legt het eindpunt op
    // (0, -1000), 4 mm onder de ligger. Bij 5 mm sluit dat punt aan: de NIEUWE
    // knoop komt op de staafas (0, -996), zodat de ligger recht blijft, en de
    // ligger wordt daar gesplitst. Bij 1 mm sluit hij niet aan; daarna wijzigt
    // de tolerantie alleen de controle, en "Verbind" bij de bevinding of
    // "Herstel alles" splitst alsnog, op de knoop waar hij staat (4 mm naast
    // de as: de melding noemt de knik).
    const wacht = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
    const LIGGER = {
      nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: -2000, z: -996 }, { id: 3, x: 2000, z: -996 }],
      beams: [{ id: 1, from: 2, to: 3, material: "S235", profile: "HEA200" }],
    };
    let store: ReturnType<typeof useFemStore> | undefined;
    function MetStore() {
      const s = useFemStore();
      store = s;
      const [geladen, setGeladen] = React.useState(false);
      React.useEffect(() => {
        s.loadProjectState({
          nodes: LIGGER.nodes, beams: LIGGER.beams, supports: [], plates: [], loads: [],
          loadCases: s.loadCases, activeLoadCaseId: s.activeLoadCaseId,
        });
        setGeladen(true);
      }, []);
      return (
        <>
          <ToastHost />
          {/* Pas tekenen als het model er is: dan past het beeld op de ligger. */}
          {geladen && <FemCanvas {...canvasProps} tool="addBeam"
            nodes={s.nodes} beams={s.beams} supports={s.supports} plates={s.plates} loads={s.loads}
            addNode={s.addNode} addBeam={s.addBeam} addNodeMetSplitsing={s.addNodeMetSplitsing}
            verbindKnoopMetStaaf={s.verbindKnoopMetStaaf} voegKnopenSamen={s.voegKnopenSamen}
            herstelModel={s.herstelModel} />}
        </>
      );
    }
    const toasts = () => [...container.querySelectorAll(".toast")].map(el =>
      `${el.querySelector(".toast-title")?.textContent} | ${el.querySelector(".toast-text")?.textContent ?? ""}`);
    const fout = () => container.querySelector(".fem-controle-kaart.fout");
    // Drie rondes: bij 5 mm; bij 1 mm en daarna "Verbind" bij de bevinding
    // (verbindKnoopMetStaaf); bij 1 mm en daarna "Herstel alles".
    for (const [tol, knop] of [[5, ""], [1, "verbind"], [1, "alles"]] as const) {
      herstelSnapBeginstand();
      zetVerbindingsTolerantie(tol);
      mount(<MetStore />);
      await wacht(80);
      equal(store!.nodes.length, 3, "Model geladen");
      const svg = container.querySelector<SVGSVGElement>("svg.fem-canvas-svg")!;
      const knoop1 = container.querySelector<SVGCircleElement>(".fem-node")!;
      const rect = svg.getBoundingClientRect();
      const x0 = rect.left + knoop1.cx.baseVal.value, y0 = rect.top + knoop1.cy.baseVal.value;
      const zoom = Number(/(\d+)%/.exec(container.querySelector(".fem-hud-tr")?.textContent ?? "")?.[1]);
      ok(zoom > 0, "Zoom in de HUD");
      const mmPerPx = 25 * 100 / zoom;
      const muis = (soort: string, xMm: number, zMm: number, extra: MouseEventInit = {}) => flushSync(() =>
        svg.dispatchEvent(new MouseEvent(soort, {
          clientX: x0 + xMm / mmPerPx, clientY: y0 - zMm / mmPerPx, bubbles: true, button: 0, ...extra,
        })));
      muis("mousemove", 0, 0); muis("click", 0, 0);
      muis("mousemove", 10, -1003, { shiftKey: true }); await wacht();
      muis("click", 10, -1003, { shiftKey: true }); await wacht();
      const nieuw = store!.nodes.find(n => n.id === 4);
      ok(store!.beams.some(b => b.from === 1 && b.to === 4), "De kolom 1→4 is getekend");
      ok(store!.nodes.filter(n => n.id !== 4).every((n, i) => n.x === [0, -2000, 2000][i] && n.z === [0, -996, -996][i]),
        "Bestaande knopen niet verschoven: " + JSON.stringify(store!.nodes));
      if (tol === 5) {
        equal(nieuw && [nieuw.x, nieuw.z], [0, -996], "5 mm: de nieuwe knoop op de as van de ligger (kolom blijft verticaal)");
        ok(!store!.beams.some(b => b.id === 1), "5 mm: de ligger is gesplitst: " + JSON.stringify([store!.nodes, store!.beams.map(b => [b.id, b.from, b.to]), toasts(), leesSnapInstellingen()]));
        ok(store!.beams.some(b => b.from === 2 && b.to === 4) && store!.beams.some(b => b.from === 4 && b.to === 3),
          "5 mm: delen 2→4 en 4→3: " + JSON.stringify(store!.beams.map(b => [b.id, b.from, b.to])));
        ok(toasts().some(t => t === "Staaf gesplitst | Knoop 4 verbonden met staaf 1: die is gesplitst in staaf 2 en staaf 3."),
          "Melding welke staaf op welke knoop is gesplitst, zonder knik: " + JSON.stringify(toasts()));
        ok(!fout(), "5 mm: geen fout in de modelcontrole");
        tests.push("Tekenvlak, 5 mm: kolom tekenen naar 4 mm onder een ligger: knoop op de liggeras, ligger recht gesplitst, met melding");
      } else {
        equal(nieuw && [nieuw.x, nieuw.z], [0, -1000], "1 mm: eindpunt op het raster, 4 mm onder de ligger, niet verschoven");
        ok(store!.beams.some(b => b.id === 1 && b.from === 2 && b.to === 3), "1 mm: de ligger blijft heel");
        ok(!toasts().some(t => t.startsWith("Staaf gesplitst")), "1 mm: geen splitsmelding: " + JSON.stringify(toasts()));
        ok(!fout(), "1 mm: geen fout in de modelcontrole (de voet ligt verder dan 1 mm van de ligger)");
        // De tolerantie ophogen (zoals in de tab Weergave): de controle ziet de
        // voet nu op de ligger, de geometrie blijft gelijk.
        const voor = JSON.stringify(store!.nodes);
        flushSync(() => zetVerbindingsTolerantie(5));
        await wacht();
        equal(JSON.stringify(store!.nodes), voor, "Tolerantie wijzigen verplaatst geen knoop");
        ok(fout()?.textContent?.includes("Knoop 4 ligt op staaf 1"),
          "Bij 5 mm meldt de modelcontrole knoop 4 op staaf 1: " + (fout()?.textContent ?? "geen kaart"));
        // Splitsen gebeurt op de knoop waar hij staat, 4 mm naast de liggeras:
        // de melding noemt die knik.
        const knik = "De knoop lag 4 mm naast de staafas; daar zit nu een knik.";
        if (knop === "verbind") {
          // De knop bij de bevinding zelf (verbindKnoopMetStaaf), niet "Herstel alles".
          const verbind = [...container.querySelectorAll<HTMLButtonElement>(".fem-controle-regel.fout .fem-controle-fix")]
            .find(k => k.closest(".fem-controle-regel")?.textContent?.includes("Knoop 4 ligt op staaf 1"));
          ok(verbind && !verbind.classList.contains("fem-controle-alles"), "Knop Verbind bij de bevinding");
          flushSync(() => verbind!.click());
          await wacht();
          ok(!store!.beams.some(b => b.id === 1), "Verbind bij 5 mm splitst de ligger");
          ok(toasts().some(t => t === `Staaf gesplitst | Knoop 4 verbonden met staaf 1: die is gesplitst in staaf 3 en staaf 4. ${knik}`),
            "Melding na Verbind: " + JSON.stringify(toasts()));
          equal(JSON.stringify(store!.nodes), voor, "Verbind verplaatst geen knoop");
          ok(!fout(), "Na Verbind geen fout meer");
          tests.push("Tekenvlak, 1 mm: geen aansluiting; daarna 5 mm: controle meldt het, Verbind bij de bevinding splitst, met melding (incl. knik)");
        } else {
          const herstel = container.querySelector<HTMLButtonElement>(".fem-controle-alles");
          ok(herstel, "Knop Herstel alles");
          flushSync(() => herstel!.click());
          await wacht();
          ok(!store!.beams.some(b => b.id === 1), "Herstel bij 5 mm splitst de ligger");
          ok(toasts().some(t => t === `Model hersteld | Knoop 4 verbonden met staaf 1: die is gesplitst in staaf 3 en staaf 4. ${knik}`),
            "Melding na herstel: " + JSON.stringify(toasts()));
          equal(JSON.stringify(store!.nodes), voor, "Herstel verplaatst geen knoop");
          ok(!fout(), "Na herstel geen fout meer");
          tests.push("Tekenvlak, 1 mm: geen aansluiting; daarna 5 mm: controle meldt het, Herstel alles splitst, met melding (incl. knik)");
        }
      }
    }
    herstelSnapBeginstand();
  }
  for (const axis of ["x", "z"]) {
    let saved: number | undefined;
    mount(<DimEditForm axis={axis} currentMm={6000} onSubmit={v => saved = v} onCancel={noop} />);
    equal(input("input").value, "6000", "Oude maatlijn in mm");
    type(input("input"), "3000"); click(".fem-popover-primary");
    equal(saved, 3000, axis + "-as op 3000 mm");
    type(input("input"), "3000,25"); click(".fem-popover-primary");
    equal(saved, 3000.25, "Decimale maatlijn");
    for (const invalid of ["-1", "0", "abc", "12mm", ""]) {
      saved = undefined; type(input("input"), invalid); click(".fem-popover-primary");
      equal(saved, undefined, "Ongeldige maatlijn");
    }
    tests.push("DimEditForm " + axis + ": 3000 mm, komma, ongeldige en negatieve maten");
  }
  for (const Component of [PopoverLineLoadForm, PopoverEdgeLoadForm]) {
    let saved: unknown;
    mount(<Component beamLenMm={6000} randLenMm={6000} randLabel="rand 1"
      startQ={-5} startP={-5} startDir="z" onthouden={false} onSubmit={(...v) => saved = v} />);
    const fields = () => [...container.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]')];
    equal(fields().map(v => v.value), ["0", "6000"], "Volledige last in mm");
    click(".fem-popover-primary"); equal(saved, [-5, "z", undefined, undefined], "Volle lengte houdt standaardfracties");
    type(fields()[0], "1500,5"); type(fields()[1], "4500.5");
    click(".fem-popover-primary");
    equal(saved, [-5, "z", 1500.5 / 6000, 4500.5 / 6000], "Deellastfracties");
    for (const invalid of ["-1", "6001", "abc", ""]) {
      type(fields()[1], invalid);
      ok(container.querySelector<HTMLButtonElement>("button")!.disabled, "Ongeldig lastbereik geblokkeerd");
    }
    tests.push(Component.name + ": komma/punt naar fracties, lege/negatieve/buitenbereik-invoer geblokkeerd");
  }
  for (const horizontal of [false, true]) {
    for (const edge of [false, true]) {
      let saved: unknown;
      mount(<PopoverPointLoadForm beamLenMm={6000} defaultPosMm={3000} startFx={10} startFz={-10}
        horizontal={horizontal} onthouden={false} positieLabel={edge ? "Randpositie" : undefined} onSubmit={(...v) => saved = v} />);
      equal(input('input[inputmode="decimal"]').value, "3000", "Klikpositie in mm");
      type(input('input[inputmode="decimal"]'), "1500,5"); click(".fem-popover-primary");
      equal(saved, [10, -10, 1500.5 / 6000], "Puntlastfractie");
      type(input('input[inputmode="decimal"]'), "-1");
      ok(container.querySelector<HTMLButtonElement>("button")!.disabled, "Negatieve positie geblokkeerd");
      tests.push("Puntlastpopover " + (horizontal ? "H" : "V") + (edge ? " plaatrand" : " staaf"));
    }
  }
  for (const onPlate of [false, true]) {
    let patch: any;
    const address = onPlate ? { plateId: 1, edgeIndex: 0 } : { beamId: 1 };
    mount(<FemProperties {...propsBase} selection={{ type: "load", id: 1 }}
      loads={[{ id: 1, caseId: 1, type: "pointForce", posFrac: 0.5, ...address }]} updateLoad={(_, p) => patch = p} />);
    equal(rowInput("Positie").value, "3000", "Bestaande puntlastpositie");
    type(rowInput("Positie"), "1500,5", true); equal(patch, { posFrac: 1500.5 / 6000 }, "Puntlast-eigenschappen");
    patch = undefined; type(rowInput("Positie"), "6001", true); equal(patch, undefined, "Puntlast buiten as");
    tests.push("FemProperties puntlast " + (onPlate ? "plaatrand" : "staaf"));

    mount(<FemProperties {...propsBase} selection={{ type: "load", id: 2 }}
      loads={[{ id: 2, caseId: 1, type: onPlate ? "edgeLoad" : "lineLoad", q: -5, startFrac: 0.25, endFrac: 0.75, ...address }]}
      updateLoad={(_, p) => patch = p} />);
    equal(rowInput("Begin").value, "1500", "Bestaande deellast begin");
    equal(rowInput("Eind").value, "4500", "Bestaande deellast einde");
    ok(container.textContent!.includes("-15.00 kN"), "Lastsom blijft -5 kN/m × 3 m = -15 kN");
    type(rowInput("Begin"), "1000,5", true);
    equal(patch, { startFrac: 1000.5 / 6000, endFrac: 0.75 }, "Begin mm naar fractie");
    type(rowInput("Eind"), "5000.5", true);
    equal(patch, { startFrac: 1000.5 / 6000, endFrac: 5000.5 / 6000 }, "Einde mm naar fractie");
    patch = undefined; type(rowInput("Begin"), "-5", true); equal(patch, undefined, "Negatief begin geweigerd");
    tests.push("FemProperties deellast " + (onPlate ? "plaatrand" : "staaf") + ", inclusief lastsom");
  }
  // ── q-waarde direct op het tekenvlak (#52) ──────────────────────────────
  const toets = (el: HTMLElement, k: string) => flushSync(() => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));
  const qVeld = () => container.querySelector<HTMLInputElement>(".fem-q-bewerking input");
  const openQ = (index = 0) => {
    const label = container.querySelectorAll<SVGTextElement>(".fem-load-text-clickable")[index];
    ok(label, "q-label ontbreekt");
    flushSync(() => label.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const veld = qVeld();
    ok(veld, "dubbelklik opent geen invoerveld");
    return veld!;
  };
  for (const onPlate of [false, true]) {
    const updates: [number, unknown][] = [];
    const last = onPlate
      ? { id: 7, caseId: 1, type: "edgeLoad", q: -5, plateId: 1, edgeIndex: 0 }
      : { id: 7, caseId: 1, type: "lineLoad", q: -5, beamId: 1 };
    mount(<FemCanvas {...canvasProps} tool="select" nodes={nodes} beams={[beam]} plates={onPlate ? [plate] : []}
      loads={[last as never]} showLoads updateLoad={(id, patch) => updates.push([id, patch])} />);
    await new Promise(resolve => setTimeout(resolve, 50));
    let veld = openQ();
    equal(veld.value, "-5", "Het veld toont de huidige q");
    ok(container.querySelector(".fem-q-bewerking")!.textContent!.includes("kN/m"), "Eenheid naast het veld");
    ok(container.querySelector(".fem-q-bewerking-hint")!.textContent!.includes("omlaag"), "Uitleg bij het teken");
    type(veld, "-7,5"); toets(veld, "Enter");
    equal(updates, [[7, { q: -7.5 }]], "Komma en Enter leggen vast");
    ok(!qVeld(), "Na Enter is het veld dicht");
    veld = openQ(); type(veld, "abc"); toets(veld, "Enter");
    ok(qVeld(), "Ongeldige invoer: het veld blijft open");
    equal(veld.getAttribute("aria-invalid"), "true", "Ongeldige invoer is gemarkeerd");
    toets(veld, "Escape");
    ok(!qVeld(), "Esc sluit het veld");
    equal(updates.length, 1, "Ongeldige invoer en Esc leggen niets vast");
    veld = openQ(); type(veld, "-2.25"); flushSync(() => veld.blur());
    equal(updates[1], [7, { q: -2.25 }], "Punt, en ernaast klikken legt vast");
    veld = openQ(); toets(veld, "Enter");
    equal(updates.length, 2, "Een ongewijzigde waarde geeft geen stap");
    tests.push("q-waarde op het tekenvlak, " + (onPlate ? "randlast plaat" : "lijnlast staaf") + ": komma, punt, Enter, Esc, ongeldig");
  }
  {
    const updates: [number, unknown][] = [];
    mount(<FemCanvas {...canvasProps} tool="select" nodes={nodes} beams={[beam]}
      loads={[{ id: 8, caseId: 1, type: "lineLoad", qStart: -2, qEnd: -6, beamId: 1, qCoord: "local", qDir: "z" } as never]}
      showLoads updateLoad={(id, patch) => updates.push([id, patch])} />);
    await new Promise(resolve => setTimeout(resolve, 50));
    const eind = openQ(1);
    equal(eind.value, "-6", "Trapezium: het eindgetal opent q₂");
    ok(container.querySelector(".fem-q-bewerking-hint")!.textContent!.includes("lokale z-as"), "Uitleg bij een lokale last");
    type(eind, "-8"); toets(eind, "Enter");
    const begin = openQ(0); type(begin, "-1,5"); toets(begin, "Enter");
    equal(updates, [[8, { qEnd: -8 }], [8, { qStart: -1.5 }]], "Trapezium: begin en eind apart");
    tests.push("q-waarde op het tekenvlak, trapezium en lokale richting");
  }
  {
    let patch: unknown;
    mount(<FemProperties {...propsBase} selection={{ type: "load", id: 9 }}
      loads={[{ id: 9, caseId: 1, type: "lineLoad", q: -5, beamId: 1 }]} updateLoad={(_, p) => patch = p} />);
    type(rowInput("q (kN/m)"), "-7,5", true);
    equal(patch, { q: -7.5 }, "Het paneel accepteert een komma");
    tests.push("FemProperties q met komma");
  }
  for (const material of ["S235", "C24"]) {
    const b = { ...beam, material, profile: material === "S235" ? "HEA160" : "96x281",
      checkConfig: { bucklingLengthY_m: 3, bucklingLengthZ_m: 2, ltbSupportSpacing_m: 1.5 } };
    let patch: any;
    mount(<FemProperties {...propsBase} beams={[b]} selection={{ type: "beam", id: 1 }} updateBeam={(_, p) => patch = p} />);
    // Normtabblad is een eigen tab in het eigenschappenpaneel.
    const norm = [...container.querySelectorAll<HTMLButtonElement>("button")].find(el => /EN 199[35]/.test(el.textContent ?? ""));
    if (norm) flushSync(() => norm.click());
    for (const [label, field, initial] of [["L_cr,y", "bucklingLengthY_m", "3000"], ["L_cr,z", "bucklingLengthZ_m", "2000"],
      ...(material === "C24" ? [["Kipsteunafstand", "ltbSupportSpacing_m", "1500"]] : [])]) {
      equal(rowInput(label).value, initial, "Bestaande meters getoond als mm");
      type(rowInput(label), "2500,5", true);
      equal(patch.checkConfig[field], 2.5005, "Mm opgeslagen als meters");
    }
    tests.push("FemProperties knik/kip " + material + ": oude waarden en kommainvoer");
    mount(<BarPropertiesDialog beam={b} nodes={nodes} onUpdate={p => patch = p} onClose={noop} />);
    ok(container.textContent!.includes("6000 mm"), "Staaflengte naast invoer in mm");
    click(".bar-props-tab:nth-child(2)");
    for (const invalid of ["-1", "0", "12mm"]) {
      type(rowInput("L_cr,y"), invalid);
      ok(container.querySelector<HTMLButtonElement>(".bar-props-btn-primary")!.disabled, "Ongeldige kniklengte blokkeert opslaan");
    }
    type(rowInput("L_cr,y"), "3000,5");
    type(rowInput("L_cr,z"), "2000.5");
    if (material === "C24") type(rowInput("Kipsteunafstand"), "1500,5");
    click(".bar-props-btn-primary");
    equal(patch.checkConfig.bucklingLengthY_m, 3.0005, "Dialoog knik y");
    equal(patch.checkConfig.bucklingLengthZ_m, 2.0005, "Dialoog knik z");
    if (material === "C24") equal(patch.checkConfig.ltbSupportSpacing_m, 1.5005, "Dialoog kip");
    tests.push("BarPropertiesDialog " + material + ": knik/kip in m opgeslagen");
  }
  {
    let saved: any;
    const waarde = { bracing: "Geschoord", buckling_length: { soort: "Opgegeven", l0_m: 3 },
      buckling_length_z: { soort: "Opgegeven", l0_m: 2 } };
    mount(<KolomVelden waarde={waarde} lengteMm={6000} overwegendVerticaal onChange={v => saved = v} />);
    equal(input("#kolom-l0").value, "3000", "l0 oude meters");
    equal(input("#kolom-l0-z").value, "2000", "l0z oude meters");
    type(input("#kolom-l0"), "3200,5", true); equal(saved.buckling_length.l0_m, 3.2005, "l0 naar m");
    type(input("#kolom-l0-z"), "2200.5", true); equal(saved.buckling_length_z.l0_m, 2.2005, "l0z naar m");
    saved = undefined; type(input("#kolom-l0"), "-3", true); equal(saved, undefined, "Negatieve l0");
    tests.push("Beton l0 beide assen: oude meterwaarden, komma/punt en negatieve invoer");
  }
  {
    let saved: unknown;
    mount(<LoadCaseTabBar loadCases={[]} loads={[]} activeLoadCaseId={1} setActiveLoadCaseId={noop}
      addLoadCase={noop} setScheefstandEnabled={noop} scheefstandEnabled scheefstandBron="staal"
      scheefstandHoogteM={3} scheefstandAfgeleideHoogteM={6} setScheefstandHoogteM={v => saved = v} />);
    const h = input('input[inputmode="decimal"]');
    ok(parseFloat(getComputedStyle(h).width) >= 70, "Scheefstandhoogte biedt ruimte voor decimale mm");
    equal(h.value, "3000", "Oude scheefstandhoogte"); equal(h.placeholder, "6000", "Afgeleide hoogte");
    type(h, "4500,5", true); equal(saved, 4.5005, "Hoogte in m opgeslagen");
    type(h, "", true); equal(saved, null, "Leeg = afleiden");
    saved = undefined; type(h, "-1", true); equal(saved, undefined, "Negatieve hoogte geweigerd");
    tests.push("Scheefstandhoogte: mm naar m, leeg en negatief");
  }
  for (const vorm of ["gebouw", "vrijstaandDak"]) {
    let saved: any;
    const instellingen = { ...STANDAARD_WIND_INSTELLINGEN, vorm, positieSpant: "tussenspant",
      hohSpant_m: 5, gebouwlengte_m: 30, afstandTotKopgevel_m: 15, belastingbreedteOverride_m: 4,
      gevelhoogte_m: 3, vrijstaandHoogte_m: 2.5, kolomDoorsnede: "rechthoekig", kolomBreedte_mm: 300, kolomDiepte_mm: 400 };
    const model = {
      nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }, { id: 3, x: 3000, z: 1500 }],
      beams: [{ id: 1, from: 1, to: 3 }, { id: 2, from: 3, to: 2 }, { id: 3, from: 1, to: 2 }],
      loadCases: [],
    };
    mount(<WindGeneratorDialog open onClose={noop} wind={{
      instellingen, setInstellingen: p => saved = p, modelVersie: 1,
      voorbeeld: () => ({ fouten: [], overige: [], resultaat: genereerWindbelasting(model, instellingen) }),
    }} />);
    ok(container.querySelector(".wgd-schema")?.textContent?.includes("30000 mm"), "Windtekening naast invoer toont gebouwlengte in mm");
    for (const [label, field, old] of [["h.o.h.", "hohSpant_m", "5000"], ["b", "gebouwlengte_m", "30000"],
      [common.wind.distanceShort, "afstandTotKopgevel_m", "15000"], [common.wind.loadWidthShort, "belastingbreedteOverride_m", "4000"],
      ...(vorm === "gebouw" ? [[common.wind.gevelhoogte, "gevelhoogte_m", "3000"]] : [[common.wind.canopyHeight, "vrijstaandHoogte_m", "2500"]])]) {
      const el = rowInput(label);
      ok(parseFloat(getComputedStyle(el).width) >= 80 && parseFloat(getComputedStyle(el).width) < 100,
        "Windlengteveld behoudt compacte vormgeving met ruimte voor mm");
      equal(el.value, old, field + " oude opgeslagen waarde");
      type(el, "6500,5", true); equal(saved[field], 6.5005, field + " mm naar m");
      saved = undefined; type(el, "-1", true); equal(saved, undefined, field + " negatief");
    }
    if (vorm === "vrijstaandDak") {
      const column = [...container.querySelectorAll<HTMLInputElement>("input")].find(el => el.value === "300")!;
      type(column, "350,5", true); equal(saved.kolomBreedte_mm, 350.5, "Kolombreedte blijft mm");
    }
    tests.push("Wind " + vorm + ": alle bouwmaten, oude waarden, negatieve invoer en bestaande mm");
  }

  // ── 3D: invoer in mm, het 3D-model blijft in meters ──────────────────
  const portaal = {
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 3 }, { id: 3, x: 6, y: 0, z: 3 }, { id: 4, x: 6, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 2, endNodeId: 3 }, { id: 3, startNodeId: 3, endNodeId: 4 }],
  };
  {
    let command: any;
    mount(<OpenFem3DTransformPanel tool="copy" selectionLabel="Portaal" onApply={c => command = c} onCancel={noop} />);
    ok(["ΔX (mm)", "ΔY (mm)", "ΔZ (mm)"].every(label => container.textContent!.includes(label)), "ΔX/ΔY/ΔZ in mm");
    const [dx, dy] = [...container.querySelectorAll<HTMLInputElement>(".open-fem3d-transform-grid input")];
    type(dx, "3000"); click(".open-fem3d-transform-actions .primary");
    equal(command, { kind: "copy", dx: 3, dy: 0, dz: 0 }, "ΔX 3000 mm is 3 m");
    const kopie = transformOpenFem3D(portaal, { type: "multi", nodeIds: [], beamIds: [1, 2, 3] }, command).model;
    equal(kopie.nodes.slice(4).map(n => n.x), [3, 3, 9, 9], "Kopie van het portaal 3 m verderop");
    type(dx, "3000,5"); type(dy, "-250"); click(".open-fem3d-transform-actions .primary");
    equal(command, { kind: "copy", dx: 3.0005, dy: -0.25, dz: 0 }, "Komma en negatieve ΔY");
    for (const invalid of ["abc", "12mm"]) {
      command = undefined; type(dx, invalid); click(".open-fem3d-transform-actions .primary");
      equal(command, undefined, "Ongeldige ΔX past niets toe");
      equal(container.querySelector(".open-fem3d-transform-error")?.textContent, "ΔX is geen geldig getal.", "Melding bij ongeldige ΔX");
    }
    mount(<OpenFem3DTransformPanel tool="mirror" selectionLabel="Portaal" onApply={c => command = c} onCancel={noop} />);
    ok(container.textContent!.includes("Spiegelvlak op (mm)"), "Spiegelvlak in mm");
    type(input('.open-fem3d-transform-field input[inputmode="decimal"]'), "1500"); click(".open-fem3d-transform-actions .primary");
    equal(command, { kind: "mirror", axis: "z", offset: 1.5 }, "Spiegelvlak 1500 mm is 1,5 m");
    tests.push("3D kopiëren/spiegelen: 3000 mm = 3 m, komma, negatief, ongeldige invoer met melding");
  }
  {
    let changed: any;
    const model = { nodes: [{ id: 1, x: 12, y: 0, z: 5 }, { id: 2, x: 18, y: 0, z: 5 }], beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }] };
    mount(<OpenFem3DProperties model={model} selection={{ type: "node", id: 1 }} onChange={m => changed = m} result={null} />);
    equal(["X (mm)", "Y (mm)", "Z (mm)"].map(label => rowInput(label).value), ["12000", "0", "5000"], "Opgeslagen meters als mm");
    type(rowInput("X (mm)"), "15000,5", true);
    equal(changed?.nodes[0], { id: 1, x: 15.0005, y: 0, z: 5 }, "15000,5 mm is 15,0005 m");
    for (const invalid of ["abc", "12mm"]) {
      changed = undefined; type(rowInput("Y (mm)"), invalid, true);
      equal(changed, undefined, "Ongeldige coördinaat schrijft niets");
      equal(rowInput("Y (mm)").value, "0", "Veld herstelt de opgeslagen coördinaat");
    }
    changed = undefined; type(rowInput("X (mm)"), "18000", true);
    equal(changed, undefined, "Knoop op knoop 2: staaf zonder lengte geweigerd");
    equal(rowInput("X (mm)").value, "12000", "Geweigerde coördinaat: veld toont weer de opgeslagen waarde");
    tests.push("3D knoop: 12 m getoond als 12000 mm, komma naar m, ongeldig en nulstaaf geweigerd");
  }
  {
    let changed: any;
    const model = {
      nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }, { id: 3, x: 4, y: 3, z: 0 }, { id: 4, x: 0, y: 3, z: 0 }],
      beams: [], plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2, cornerRadiusM: 0.1 }],
    };
    mount(<OpenFem3DProperties model={model} selection={{ type: "plate", id: 1 }} onChange={m => changed = m} result={null} />);
    equal([rowInput("Dikte (mm)").value, rowInput("Randstraal (mm)").value], ["200", "100"], "Dikte en randstraal in mm");
    type(rowInput("Dikte (mm)"), "250", true);
    equal(changed?.plates[0].thicknessM, 0.25, "Dikte 250 mm is 0,25 m");
    for (const invalid of ["abc", "12mm", "0", "-5"]) {
      changed = undefined; type(rowInput("Dikte (mm)"), invalid, true);
      equal(changed, undefined, "Ongeldige dikte schrijft niets: " + invalid);
    }
    type(rowInput("Randstraal (mm)"), "50,5", true);
    equal(changed?.plates[0].cornerRadiusM, 0.0505, "Randstraal 50,5 mm is 0,0505 m");
    type(rowInput("Randstraal (mm)"), "", true);
    equal(changed?.plates[0].cornerRadiusM ?? 0, 0, "Lege randstraal is geen afronding");
    tests.push("3D plaat: dikte en randstraal in mm, ongeldige en niet-positieve dikte geweigerd");
  }
  {
    let changed: any;
    const model = { nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }], beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }] };
    mount(<OpenFem3DMemberLoads model={model} beamId={1} lengthM={6} onChange={m => changed = m} />);
    ok(container.textContent!.includes("staaflengte 6000 mm"), "Staaflengte in mm");
    click(".open-fem3d-load-more");
    ok(container.textContent!.includes("Belast bereik vanaf staafbegin (mm)"), "Bereik in mm");
    equal([input('input[name="startMm"]').value, input('input[name="endMm"]').value], ["0", "6000"], "Volle staaf in mm");
    type(input('input[name="startMm"]'), "1500"); type(input('input[name="endMm"]'), "4500,5");
    click(".open-fem3d-load-submit");
    const last = changed?.memberLoads?.[0];
    equal([last?.startPositionM, last?.endPositionM], [1.5, 4.5005], "Bereik 1500 tot 4500,5 mm is 1,5 tot 4,5005 m");
    for (const invalid of ["abc", "12mm", "6001"]) {
      changed = undefined; type(input('input[name="endMm"]'), invalid); click(".open-fem3d-load-submit");
      equal(changed, undefined, "Ongeldig bereik schrijft niets: " + invalid);
      equal(container.querySelector('[role="alert"]')?.textContent, "Ongeldig bereik: 0 ≤ begin < einde ≤ 6000 mm", "Melding in mm");
    }
    click(".open-fem3d-load-tabs button:nth-child(2)");
    ok(container.textContent!.includes("Positie (mm)"), "Puntlastpositie in mm");
    const positie = () => input('.open-fem3d-member-loads input[inputmode="decimal"]');
    equal(positie().value, "3000", "Standaardpositie midden van 6 m in mm");
    type(positie(), "2500"); click('.open-fem3d-member-loads form button[type="submit"]');
    equal(changed?.memberPointLoads?.[0].positionM, 2.5, "Puntlast op 2500 mm is 2,5 m");
    changed = undefined; type(positie(), "12mm"); click('.open-fem3d-member-loads form button[type="submit"]');
    equal(changed, undefined, "Ongeldige puntlastpositie schrijft niets");
    equal(container.querySelector('[role="alert"]')?.textContent, "Ongeldige positie: 0 ≤ positie ≤ 6000 mm", "Melding positie in mm");
    tests.push("3D staafbelasting: bereik en puntlastpositie in mm naar m, meldingen in mm");
  }
  {
    mount(<WaterAccumulation2DDialog open onClose={noop} selectedBeam={{ id: 1, spanM: 7.2, eiKnm2: 10000 }} />);
    await new Promise(resolve => setTimeout(resolve, 20));
    const velden = () => [...document.querySelectorAll<HTMLInputElement>(".water2d-field input")];
    equal([velden()[0].value, velden()[1].value], ["7200", "3000"], "Overspanning van de staaf en dakbreedte in mm");
    equal([...document.querySelectorAll(".water2d-field small")].slice(0, 2).map(el => el.textContent), ["mm", "mm"], "Eenheid mm");
    const bereken = () => flushSync(() => document.querySelector<HTMLButtonElement>(".modal-footer .primary")!.click());
    const n = (spanM: number) => calculateWaterAccumulation2D({ spanM, tributaryWidthM: 3, eiKnm2: 10000,
      waterLevelAboveLeftM: 0.1, slopePercent: 0, camberMm: 0, initialSagMm: 0, stiffnessModelFactor: 1 }).stiffnessRatio.toFixed(2);
    bereken();
    ok(document.querySelector(".water2d-metrics")?.textContent?.includes(n(7.2)), "Stijfheidgetal met L = 7,2 m: " + n(7.2));
    type(velden()[0], "6000,5"); bereken();
    ok(document.querySelector(".water2d-metrics")?.textContent?.includes(n(6.0005)), "Overspanning 6000,5 mm is 6,0005 m");
    type(velden()[0], "abc"); bereken();
    ok(!document.querySelector(".water2d-metrics") && !!document.querySelector('.water2d-dialog [role="alert"]'), "Ongeldige overspanning geeft een melding");
    tests.push("Wateraccumulatie: overspanning en dakbreedte in mm naar de rekenkern in m");
  }
}

run().then(() => {
  document.getElementById("uitslag")!.textContent = JSON.stringify({ tests, error: null });
}).catch(error => {
  document.getElementById("uitslag")!.textContent = JSON.stringify({ tests, error: String(error.stack ?? error) });
});

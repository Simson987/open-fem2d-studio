/**
 * Browserkant van test-profielkleur-ui.mjs: "Profielen in kleur" op het echte
 * 2D-tekenvlak (met de echte verkenner en het echte venster Zichtbaarheid op
 * dezelfde displayFlags) en in de echte 3D-werkruimte (OpenFem3DEditor met
 * ThreeFrameCanvas, WebGL), met de echte legenda.
 *
 * Zonder hash draait de testreeks en komt de uitslag als JSON in #uitslag. Met
 * `#beeld=licht|donker|drie` wordt alleen het beeld opgebouwd — daarvan maakt
 * de test op verzoek een schermafbeelding.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import common from "../src/i18n/locales/nl/common.json";
import check from "../src/i18n/locales/nl/check.json";
import ribbon from "../src/i18n/locales/nl/ribbon.json";
import "../src/themes.css";
import "../src/App.css";
import FemCanvas from "../src/components/fem/FemCanvas";
import ExplorerViewTab from "../src/components/fem/ExplorerViewTab";
import ZichtbaarheidVenster from "../src/components/fem/ZichtbaarheidVenster";
import { DEFAULT_DISPLAY_FLAGS, type DisplayFlags } from "../src/components/fem/FemResultsOverlay";
import { DEFAULT_GRID, type Beam, type Node, type Selection } from "../src/components/fem/femTypes";
import { makeInitialSnapshot } from "../src/hooks/useFemStore";
import { PROFIEL_PALET, PROFIEL_STREPEN, ZONDER_PROFIEL_KLEUR, openFem3DProfielKleuring, profielKleuring2d } from "../src/lib/profielKleur";
import OpenFem3DEditor from "../src/components/openFem3d/OpenFem3DEditor";
import OpenFem3DVisibilityDialog from "../src/components/openFem3d/OpenFem3DVisibilityDialog";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, type OpenFem3DVisibility } from "../src/components/openFem3d/openFem3dVisibility";
import { parseOpenFem3DModel, type OpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import type { OpenFem3DSteelChecks } from "../src/components/openFem3d/openFem3dSteelCheck";

// De WebGL-buffer bewaren, zodat de test de pixels van het 3D-beeld kan lezen.
const eigenGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, soort: string, opties?: Record<string, unknown>) {
  if (soort === "webgl" || soort === "webgl2") opties = { ...(opties ?? {}), preserveDrawingBuffer: true };
  return (eigenGetContext as (s: string, o?: unknown) => RenderingContext | null).call(this, soort, opties);
} as typeof HTMLCanvasElement.prototype.getContext;

const tests: { name: string; error?: string }[] = [];
const container = document.getElementById("root")!;
let root = createRoot(container);
const noop = () => {};
function mount(element: React.ReactNode) {
  flushSync(() => root.unmount());
  root = createRoot(container);
  flushSync(() => root.render(element));
}
const wacht = (ms = 80) => new Promise((r) => setTimeout(r, ms));
function ok(v: unknown, m: string) { if (!v) throw Error(m); }
function gelijk(a: unknown, b: unknown, m: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(`${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); tests.push({ name }); }
  catch (e) { tests.push({ name, error: e instanceof Error ? e.message : String(e) }); }
}
const klik = (el: Element) => flushSync(() => (el as HTMLElement).click());
const rgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
const overlapt = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const binnen = (a: DOMRect, b: DOMRect) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;

// ── 2D: het startmodel van de app ────────────────────────────────────────
// Staaf 1, 2: IPE270 (S235); 3: IPE330 (S235); 4, 5: 160x400 (GL24h); 6: 300x600 (C30/37).
const model = makeInitialSnapshot();
/** Dezelfde toekenning als FemCanvas. */
const kleuringVan = (beams: Beam[]) => profielKleuring2d(beams, (k, w) => i18next.t(k, w));

let flags: DisplayFlags = DEFAULT_DISPLAY_FLAGS;

function Proef({ begin = DEFAULT_DISPLAY_FLAGS, nodes = model.nodes, beams = model.beams, selection = null, venster = false, hoogte = 600 }: {
  begin?: DisplayFlags; nodes?: Node[]; beams?: Beam[]; selection?: Selection | null; venster?: boolean; hoogte?: number;
}) {
  const [f, setF] = React.useState<DisplayFlags>(begin);
  flags = f;
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <aside className="fem-verkenner-proef" style={{ width: 240 }}>
        <ExplorerViewTab
          displayFlags={f} setDisplayFlags={setF} workspace="2d"
          gridShow={false} setGridShow={noop} stramienAan={false} setStramienAan={noop}
          openFem3dVisibility={DEFAULT_OPEN_FEM_3D_VISIBILITY} setOpenFem3DVisibility={noop}
        />
      </aside>
      <div className="fem-canvas-wrap" style={{ width: 900, height: hoogte, position: "relative" }}>
        <FemCanvas
          tool="select" nodes={nodes} beams={beams} supports={model.supports} plates={[]} loads={model.loads}
          selection={selection as Selection} activeLoadCaseId={1} grid={{ ...DEFAULT_GRID, visible: false }}
          setSelection={noop} addNode={() => 0} updateNode={noop} addBeam={() => null}
          addPlate={() => 0} addSupport={noop} addLoad={noop} deleteSelected={noop} splitBeamAt={noop}
          translateSelection={() => false} copySelection={() => false}
          rotateSelection={() => false} mirrorSelection={() => false}
          displayFlags={f} showLoads
        />
      </div>
      {venster && <ZichtbaarheidVenster open onClose={noop} displayFlags={f} setDisplayFlags={setF} />}
    </div>
  );
}
const lijnen = () => [...container.querySelectorAll<SVGLineElement>("line.fem-member")];
const legenda = () => container.querySelector<HTMLElement>('[data-profiel-legenda="2d"]');
const legendaRegels = () => [...container.querySelectorAll<HTMLElement>('[data-profiel-legenda="2d"] .profiel-legenda-regel')];
function verkennerKnop(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>(".fem-verkenner-proef .fem-results-toggle")]
    .find((b) => b.querySelector(".fem-results-toggle-label")?.textContent === label) ?? null;
}
const AAN: DisplayFlags = { ...DEFAULT_DISPLAY_FLAGS, profielKleur: true };

/** Een model met n staven naast elkaar, elk een eigen profiel (HEA 100, 120, …). */
function vele(n: number, zonder = 0): { nodes: Node[]; beams: Beam[] } {
  const nodes: Node[] = [];
  const beams: Beam[] = [];
  for (let i = 0; i < n + zonder; i++) {
    nodes.push({ id: 2 * i + 1, x: i * 800, z: 0 }, { id: 2 * i + 2, x: i * 800, z: 3000 });
    beams.push({ id: i + 1, from: 2 * i + 1, to: 2 * i + 2, material: "S235", ...(i < n ? { profile: `HEA${100 + 20 * i}` } : {}) });
  }
  return { nodes, beams };
}

// ── 3D: een vlak raamwerk (voorvlak y = 0) in de echte werkruimte ─────────
// Vier staven, vier profielen: HEA 300 (blauw), HEB 300 (framboos), IPE 400
// (petrol), SHS 100x100x5 (groen). Plus 256 losse knopen binnen het raamwerk:
// vanaf 250 knopen neemt de 3D-weergave de snelle toevoeg- en verwijderpaden.
function raamwerk3d(): OpenFem3DModel {
  const nodes = [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 4 }, { id: 3, x: 6, y: 0, z: 4 }, { id: 4, x: 6, y: 0, z: 0 },
  ];
  for (let i = 0; i < 256; i++) nodes.push({ id: 100 + i, x: 1 + (i % 16) * 0.25, y: 0, z: 1 + Math.floor(i / 16) * 0.12 });
  return parseOpenFem3DModel({
    nodes,
    beams: [
      { id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA 300", material: "S235" },
      { id: 2, startNodeId: 4, endNodeId: 3, profileName: "HEB 300", material: "S235" },
      { id: 3, startNodeId: 2, endNodeId: 3, profileName: "IPE 400", material: "S235" },
      { id: 4, startNodeId: 1, endNodeId: 3, profileName: "SHS 100x100x5", material: "S235" },
    ],
    supports: [], loads: [], memberLoads: [], memberPointLoads: [], thermalLoads: [], plates: [], surfaceLoads: [],
  });
}
const ZICHT3D: OpenFem3DVisibility = {
  ...DEFAULT_OPEN_FEM_3D_VISIBILITY,
  nodes: false, supports: false, loads: false, grid: false, axes: false, structuralGrid: false,
  nodeNumbers: false, deformation: false, reactions: false,
};
let zicht3d: OpenFem3DVisibility = ZICHT3D;
let zetModel3d: (m: OpenFem3DModel) => void = noop;
let zetZicht3d: (v: OpenFem3DVisibility) => void = noop;
let zetChecks3d: (c: OpenFem3DSteelChecks | null) => void = noop;
function Werkruimte({ begin, beginZicht }: { begin: OpenFem3DModel; beginZicht: OpenFem3DVisibility }) {
  const [m, setM] = React.useState(begin);
  const [v, setV] = React.useState(beginZicht);
  const [c, setC] = React.useState<OpenFem3DSteelChecks | null>(null);
  zetModel3d = setM; zetZicht3d = setV; zetChecks3d = setC; zicht3d = v;
  return (
    <div style={{ width: 800, height: 500, position: "relative", display: "flex" }}>
      <OpenFem3DEditor model={m} onChange={setM} visibility={v} onVisibilityChange={setV}
        showLoadCase={false} checks={c} viewRequest={{ kind: "front", token: 1 }} />
    </div>
  );
}
const canvas3d = () => container.querySelector<HTMLCanvasElement>(".open-fem3d-canvas canvas");
const bouwstand = () => container.querySelector<HTMLElement>(".open-fem3d-canvas")?.dataset.openFem3dBuildMode;
/** Aantal pixels per tintvenster (HSV-tint in graden, verzadigd en niet te donker). */
function tintPixels(vensters: Record<string, [number, number]>): Record<string, number> {
  const bron = canvas3d()!;
  const doek = document.createElement("canvas");
  doek.width = bron.width; doek.height = bron.height;
  const ctx = doek.getContext("2d")!;
  ctx.drawImage(bron, 0, 0);
  const data = ctx.getImageData(0, 0, doek.width, doek.height).data;
  const uit: Record<string, number> = Object.fromEntries(Object.keys(vensters).map((k) => [k, 0]));
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (max < 0.25 || d / max < 0.35) continue;
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    for (const [k, [a, z]] of Object.entries(vensters)) if (h >= a && h <= z) uit[k]++;
  }
  return uit;
}
// HSV-tinten: framboos #cd2e73 ≈ 334°, petrol #1178a5 ≈ 198°, groen #298509 ≈ 104°,
// orchidee #bf6bd2 ≈ 289°; het standaardblauw #2563eb ≈ 221° valt in geen venster.
const VENSTERS: Record<string, [number, number]> = {
  framboos: [320, 348], petrol: [188, 208], groen: [92, 116], orchidee: [278, 300],
};
const legenda3d = () => container.querySelector<HTMLElement>('[data-profiel-legenda="3d"]');

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", resources: { nl: { common, check, ribbon } }, defaultNS: "common", initImmediate: false,
  });
  const t = (k: string, o?: Record<string, unknown>) => i18next.t(k, o);
  const beeld = /beeld=([\w-]+)/.exec(location.hash)?.[1];
  document.documentElement.setAttribute("data-theme", beeld === "donker" ? "openaec" : "light");
  if (beeld) {
    document.body.style.cssText = "margin:0;background:var(--theme-bg)";
    document.getElementById("uitslag")!.remove();
    if (beeld === "drie") {
      mount(<Werkruimte begin={raamwerk3d()} beginZicht={{ ...ZICHT3D, profileColors: true, profiles: true }} />);
    } else {
      // Startmodel met een losse knoop (modelcontrole rechtsonder, onder de legenda).
      mount(<Proef begin={AAN} nodes={[...model.nodes, { id: 99, x: 15000, z: 5000 }]} />);
    }
    await wacht(400);
    return;
  }
  const accent = () => getComputedStyle(document.documentElement).getPropertyValue("--theme-accent").trim();
  const accentHover = () => getComputedStyle(document.documentElement).getPropertyValue("--theme-accent-hover").trim();

  await test("standaard uit: geen legenda, de staven in de accentkleur", async () => {
    mount(<Proef />);
    await wacht();
    ok(!legenda(), "legenda staat er al");
    gelijk(lijnen().length, model.beams.length, "staaflijnen");
    for (const l of lijnen()) gelijk(getComputedStyle(l).stroke, rgb(accent().toLowerCase()), "accentkleur");
  });

  await test("de schakelaar in de verkenner: elk profiel een eigen kleur, gelijk aan de toekenning en de legenda", async () => {
    mount(<Proef />);
    const knop = verkennerKnop(t("zichtbaarheid.profielKleur"));
    ok(knop, "rij Profielen in kleur ontbreekt in de verkenner");
    gelijk(knop!.getAttribute("aria-checked"), "false", "standaard uit");
    klik(knop!);
    await wacht();
    gelijk(flags.profielKleur, true, "vlag");
    const k = kleuringVan(model.beams);
    lijnen().forEach((l, i) => gelijk(getComputedStyle(l).stroke, rgb(k.perStaaf.get(model.beams[i].id)!.kleur), `staaf ${model.beams[i].id}`));
    // Vier profielen, vier verschillende kleuren.
    gelijk(new Set(lijnen().map((l) => getComputedStyle(l).stroke)).size, 4, "verschillende kleuren");
    // De legenda: alleen de profielen van het model, met aantal staven.
    gelijk(legenda()!.querySelector(".profiel-legenda-titel")!.textContent, t("canvas.profielKleur.titel"), "titel");
    gelijk(legendaRegels().map((r) => [r.querySelector(".profiel-legenda-naam")!.textContent, r.querySelector(".profiel-legenda-aantal")!.textContent]),
      [["160x400", "2 staven"], ["300x600", "1 staaf"], ["IPE270", "2 staven"], ["IPE330", "1 staaf"]], "regels");
    legendaRegels().forEach((r, i) => {
      gelijk(r.getAttribute("data-kleur"), PROFIEL_PALET[i], `regel ${i + 1}: kleur`);
      gelijk(getComputedStyle(r.querySelector("line")!).stroke, rgb(PROFIEL_PALET[i]), `regel ${i + 1}: kleurvlak`);
    });
  });

  await test("het venster Zichtbaarheid zet dezelfde vlag (Geometrie, onder Staven); uit: legenda weg, accentkleur terug", async () => {
    mount(<Proef begin={AAN} venster />);
    await wacht();
    const rijen = [...document.querySelectorAll('.zichtbaarheid-venster [data-groep="geometrie"] [data-vlag]')].map((b) => b.getAttribute("data-vlag"));
    gelijk(rijen.slice(1, 3), ["staven", "profielKleur"], "direct onder de staven");
    const vk = document.querySelector<HTMLButtonElement>('.zichtbaarheid-venster [data-vlag="profielKleur"]')!;
    gelijk(vk.getAttribute("aria-checked"), "true", "venster toont de vlag");
    ok(legenda(), "legenda");
    klik(vk);
    await wacht();
    gelijk(flags.profielKleur, false, "venster zet de vlag uit");
    ok(!legenda(), "legenda blijft staan");
    for (const l of lijnen()) gelijk(getComputedStyle(l).stroke, rgb(accent().toLowerCase()), "accentkleur terug");
    gelijk(verkennerKnop(t("zichtbaarheid.profielKleur"))!.getAttribute("aria-checked"), "false", "verkenner volgt");
  });

  await test("de legenda rechtsonder: binnen het tekenvlak, boven de modelcontrole, niet over de andere HUD-kaarten", async () => {
    // Een losse knoop geeft een bevinding: de modelcontrole staat ook rechtsonder.
    mount(<Proef begin={AAN} nodes={[...model.nodes, { id: 99, x: 15000, z: 5000 }]} />);
    await wacht();
    const vlak = container.querySelector(".fem-canvas-wrap")!.getBoundingClientRect();
    const leg = legenda()!.getBoundingClientRect();
    const controle = container.querySelector(".fem-controle-kaart")!.getBoundingClientRect();
    ok(binnen(leg, vlak), "legenda buiten het tekenvlak");
    ok(leg.right > vlak.right - 60 && leg.bottom > vlak.bottom - 200, "legenda niet rechtsonder");
    ok(leg.bottom <= controle.top + 0.5, `legenda (${leg.bottom}) niet boven de modelcontrole (${controle.top})`);
    const anderen = [...container.querySelectorAll(".fem-hud-tl .fem-hud-card, .fem-hud-tr .fem-hud-card, .fem-hud-bl .fem-hud-card")];
    ok(anderen.length >= 4, `maar ${anderen.length} andere HUD-kaarten`);
    for (const a of anderen) ok(!overlapt(leg, a.getBoundingClientRect()), `legenda over ${a.className}`);
  });

  await test("veel profielen in een laag tekenvlak: de legenda scrolt en blijft vrij van de kaarten rechtsboven", async () => {
    const { nodes, beams } = vele(24);
    mount(<Proef begin={AAN} nodes={nodes} beams={beams} hoogte={420} />);
    await wacht();
    gelijk(legendaRegels().length, 24, "één regel per profiel");
    const lijst = legenda()!.querySelector<HTMLElement>(".profiel-legenda-lijst")!;
    ok(lijst.scrollHeight > lijst.clientHeight, "de lijst scrolt niet");
    const leg = legenda()!.getBoundingClientRect();
    ok(binnen(leg, container.querySelector(".fem-canvas-wrap")!.getBoundingClientRect()), "legenda buiten het tekenvlak");
    for (const a of container.querySelectorAll(".fem-hud-tr .fem-hud-card")) ok(!overlapt(leg, a.getBoundingClientRect()), "legenda over de kaarten rechtsboven");
  });

  await test("uitbreiding: profiel 9 gestreept en 17 gestippeld in dezelfde kleuren, ook in de legenda", async () => {
    const { nodes, beams } = vele(17);
    mount(<Proef begin={AAN} nodes={nodes} beams={beams} />);
    await wacht();
    const l = lijnen();
    const streep = (x: SVGLineElement) => getComputedStyle(x).strokeDasharray;
    gelijk([streep(l[0]), streep(l[8]), streep(l[16])], ["none", "10px, 7px", "0.1px, 6px"], "lijnsoort");
    gelijk([getComputedStyle(l[0]).stroke, getComputedStyle(l[8]).stroke, getComputedStyle(l[16]).stroke],
      [rgb(PROFIEL_PALET[0]), rgb(PROFIEL_PALET[0]), rgb(PROFIEL_PALET[0])], "dezelfde kleur");
    const regels = legendaRegels();
    gelijk([regels[8].querySelector("line")!.getAttribute("stroke-dasharray"), regels[16].querySelector("line")!.getAttribute("stroke-dasharray")],
      [PROFIEL_STREPEN[1], PROFIEL_STREPEN[2]], "legenda");
    // Uniek: 17 verschillende combinaties van kleur en lijnsoort.
    gelijk(new Set(l.map((x) => `${getComputedStyle(x).stroke}|${streep(x)}`)).size, 17, "uniek");
  });

  await test("zonder profiel: grijs, onderaan de legenda als \"zonder profiel\"", async () => {
    const { nodes, beams } = vele(2, 1);
    mount(<Proef begin={AAN} nodes={nodes} beams={beams} />);
    await wacht();
    gelijk(getComputedStyle(lijnen()[2]).stroke, rgb(ZONDER_PROFIEL_KLEUR), "grijs");
    const laatste = legendaRegels().at(-1)!;
    gelijk(laatste.querySelector(".profiel-legenda-naam")!.textContent, t("canvas.profielKleur.zonderProfiel"), "tekst");
    gelijk(laatste.querySelector(".profiel-legenda-aantal")!.textContent, "1 staaf", "aantal");
  });

  await test("de selectie gaat voor: de geselecteerde staaf in de selectiekleur, de rest in de profielkleur", async () => {
    mount(<Proef begin={AAN} selection={{ type: "beam", id: 3 } as Selection} />);
    await wacht();
    const k = kleuringVan(model.beams);
    lijnen().forEach((l, i) => {
      const id = model.beams[i].id;
      gelijk(getComputedStyle(l).stroke, id === 3 ? rgb(accentHover().toLowerCase()) : rgb(k.perStaaf.get(id)!.kleur), `staaf ${id}`);
    });
  });

  await test("aanzicht aan: de systeemlijn in de profielkleur, met haar eigen streep-stippellijn", async () => {
    mount(<Proef begin={{ ...AAN, aanzicht: true }} />);
    await wacht();
    const k = kleuringVan(model.beams);
    const l = lijnen()[0];
    ok(l.classList.contains("systeemlijn"), "geen systeemlijn");
    gelijk(getComputedStyle(l).stroke, rgb(k.perStaaf.get(1)!.kleur), "kleur");
    gelijk(getComputedStyle(l).strokeDasharray, "14px, 3px, 2px, 3px", "lijnsoort van de systeemlijn");
  });

  await test("thema: profielkleuren ≥ 3:1 op het lichte en het donkere tekenvlak; de legendatekst volgt het thema", async () => {
    mount(<Proef begin={AAN} />);
    await wacht();
    const lum = (s: string) => {
      const [r, g, b] = (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((c) => c / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const tekst: string[] = [];
    for (const thema of ["light", "openaec"]) {
      document.documentElement.setAttribute("data-theme", thema);
      const achter = getComputedStyle(container.querySelector(".fem-canvas-wrap")!).backgroundColor;
      for (const l of lijnen()) {
        const c = contrast(getComputedStyle(l).stroke, achter);
        ok(c >= 3, `${thema}: ${getComputedStyle(l).stroke} op ${achter} is ${c.toFixed(2)}:1`);
      }
      tekst.push(getComputedStyle(legenda()!.querySelector(".profiel-legenda-naam")!).color);
    }
    document.documentElement.setAttribute("data-theme", "light");
    ok(tekst[0] !== tekst[1], `legendatekst in beide thema's ${tekst[0]}`);
  });

  await test("3D-verkenner en 3D-venster: de rij Profielen in kleur zet profileColors", async () => {
    let v3 = DEFAULT_OPEN_FEM_3D_VISIBILITY;
    const Lijst = () => {
      const [v, setV] = React.useState(DEFAULT_OPEN_FEM_3D_VISIBILITY);
      v3 = v;
      return (
        <div className="fem-verkenner-proef">
          <ExplorerViewTab displayFlags={DEFAULT_DISPLAY_FLAGS} setDisplayFlags={noop} workspace="3d"
            gridShow={false} setGridShow={noop} stramienAan={false} setStramienAan={noop}
            openFem3dVisibility={v} setOpenFem3DVisibility={setV} />
          <OpenFem3DVisibilityDialog open onClose={noop} visibility={v} onChange={setV} viewSets={[]} currentView="iso"
            currentCamera={{ position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1] }} currentCombinationId={null}
            currentLoadCaseId={1} currentMode="model" combinationOptions={[]} loadCaseOptions={[]} />
        </div>
      );
    };
    mount(<Lijst />);
    const labels = [...container.querySelectorAll(".fem-verkenner-proef .fem-results-toggle-label")].map((e) => e.textContent);
    const i = labels.indexOf(t("openFem3dVisibility.profileColors"));
    ok(i > 0 && labels[i - 1] === t("openFem3dVisibility.profiles"), `rij niet direct na Profielen: ${labels.join(", ")}`);
    klik(verkennerKnop(t("openFem3dVisibility.profileColors"))!);
    gelijk(v3.profileColors, true, "verkenner");
    const vk = document.querySelector<HTMLButtonElement>('.open-fem3d-visibility-dialog [data-vlag="profileColors"]')!;
    gelijk(vk.getAttribute("aria-checked"), "true", "venster volgt");
    klik(vk);
    gelijk(v3.profileColors, false, "venster");
  });

  await test("3D-werkruimte: de staven kleuren naar hun profiel (WebGL-pixels), met de legenda in 3D-kleuren", async () => {
    mount(<Werkruimte begin={raamwerk3d()} beginZicht={ZICHT3D} />);
    await wacht(300);
    ok(canvas3d(), "geen WebGL-canvas");
    const uit = tintPixels(VENSTERS);
    ok(Object.values(uit).every((n) => n < 5), `profielkleuren zonder de optie: ${JSON.stringify(uit)}`);
    ok(!legenda3d(), "legenda zonder de optie");
    flushSync(() => zetZicht3d({ ...zicht3d, profileColors: true }));
    await wacht(300);
    const aan = tintPixels(VENSTERS);
    // HEB 300 framboos, IPE 400 petrol, SHS groen; HEA 300 is blauw (niet te scheiden van het standaardblauw).
    ok(aan.framboos > 40 && aan.petrol > 40 && aan.groen > 40, `staafkleuren: ${JSON.stringify(aan)}`);
    ok(aan.orchidee < 5, `orchidee zonder vijfde profiel: ${JSON.stringify(aan)}`);
    const k = openFem3DProfielKleuring(raamwerk3d().beams);
    gelijk([...legenda3d()!.querySelectorAll(".profiel-legenda-regel")].map((r) => [r.querySelector(".profiel-legenda-naam")!.textContent, r.getAttribute("data-kleur")]),
      k.regels.map((r) => [r.naam, r.kleur3d]), "legenda");
    gelijk(getComputedStyle(legenda3d()!.querySelector("rect")!).fill, rgb(k.regels[0].kleur3d), "kleurvlak");
    ok(legenda3d()!.classList.contains("open-fem3d-profiel-legenda"), "plaats in de werkruimte");
  });

  await test("3D: een staaf met een bestaand profiel gaat via het snelle pad; een nieuw profiel verschuift de kleuren via een volledige opbouw", async () => {
    const begin = raamwerk3d();
    mount(<Werkruimte begin={begin} beginZicht={{ ...ZICHT3D, profileColors: true }} />);
    await wacht(300);
    // Bestaand profiel (IPE 400): de kleuren blijven, het snelle toevoegpad mag.
    const m2 = { ...begin, nodes: [...begin.nodes, { id: 900, x: 3, y: 0, z: 2 }], beams: [...begin.beams, { id: 5, startNodeId: 900, endNodeId: 3, profileName: "IPE 400", material: "S235" }] };
    flushSync(() => zetModel3d(m2));
    await wacht(300);
    gelijk(bouwstand(), "append-copy", "snel toevoegpad");
    const regelIpe = [...legenda3d()!.querySelectorAll(".profiel-legenda-regel")].find((r) => r.querySelector(".profiel-legenda-naam")!.textContent === "IPE 400")!;
    gelijk(regelIpe.querySelector(".profiel-legenda-aantal")!.textContent, "2 staven", "IPE 400 telt nu twee staven");
    // Nieuw profiel HEA 200 sorteert vooraan: alle kleuren schuiven één plaats op.
    const m3 = { ...m2, nodes: [...m2.nodes, { id: 901, x: 2, y: 0, z: 3 }], beams: [...m2.beams, { id: 6, startNodeId: 901, endNodeId: 2, profileName: "HEA 200", material: "S235" }] };
    flushSync(() => zetModel3d(m3));
    await wacht(300);
    ok(bouwstand() === "full" || bouwstand() === "full-grid-reuse", `volledige opbouw verwacht, niet ${bouwstand()}`);
    const na = tintPixels(VENSTERS);
    // HEA 300 → framboos, HEB 300 → petrol, IPE 400 → groen, SHS → orchidee.
    ok(na.framboos > 40 && na.petrol > 40 && na.groen > 40 && na.orchidee > 40, `verschoven kleuren: ${JSON.stringify(na)}`);
    gelijk(legenda3d()!.querySelector(".profiel-legenda-naam")!.textContent, "HEA 200", "HEA 200 vooraan");
  });

  await test("3D: met unity checks in beeld gaat de UC-kleuring voor en verdwijnt de profiellegenda", async () => {
    const begin = raamwerk3d();
    mount(<Werkruimte begin={begin} beginZicht={{ ...ZICHT3D, profileColors: true, utilization: true }} />);
    await wacht(300);
    ok(legenda3d(), "legenda zonder toetsuitkomsten");
    const checks = {
      results: begin.beams.map((b) => ({ beam_id: b.id, status: "NotOk", checks: [{ id: "cross_section", kind: { data: { uc: { uc: 1.4 } } } }] })),
      skipped: [], notes: [],
    } as unknown as OpenFem3DSteelChecks;
    flushSync(() => zetChecks3d(checks));
    await wacht(300);
    ok(!legenda3d(), "profiellegenda naast de UC-kleuring");
    ok(container.querySelector(".open-fem3d-uc-legend"), "UC-legenda");
    const uit = tintPixels(VENSTERS);
    ok(uit.framboos < 5 && uit.petrol < 5 && uit.groen < 5, `profielkleuren door de UC-kleuring heen: ${JSON.stringify(uit)}`);
    // UC-laag uit: de profielkleuren komen terug.
    flushSync(() => zetZicht3d({ ...zicht3d, utilization: false }));
    await wacht(300);
    ok(legenda3d(), "legenda na UC uit");
    const terug = tintPixels(VENSTERS);
    ok(terug.framboos > 40 && terug.petrol > 40, `profielkleuren terug: ${JSON.stringify(terug)}`);
  });
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, error: String(e?.stack ?? e) }); });

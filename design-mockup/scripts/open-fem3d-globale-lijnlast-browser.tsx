/**
 * Browserkant van test-open-fem3d-globale-lijnlast-ui.mjs: een lijnlast in
 * een globale richting (issue #80) in de echte onderdelen, in een lokale
 * headless browser.
 *
 *  - Het lastpaneel van een staaf: de keuze Richting met Lokaal z/y en
 *    Globaal X/Y/Z; bij globaal het vinkje Per projectie met de uitleg. Een
 *    globale Z-last per projectie toevoegen, kiezen en wijzigen; terug naar
 *    lokaal; de detailvelden q begin/q eind bij een globale last.
 *  - Het tekenvlak: de pijlen van een globale Z-last op een schuine spant
 *    wijzen recht omlaag met de staart langs de staaf; per projectie een
 *    horizontale gestippelde projectielijn; klikken op een pijl kiest de last
 *    en kleurt ook de projectielijn. Een kolom onder Globaal Z (last langs de
 *    staaf): de pijlen staan naast het profiel en zijn te kiezen.
 *  - De verkenner en het rapport: de regel en de kolom Richting.
 *
 * `#beeld=…` toont alleen een beeld voor een schermafbeelding: paneel,
 * staafmeter of projectie.
 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import * as THREE from "three";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import common from "../src/i18n/locales/nl/common.json";
import ribbon from "../src/i18n/locales/nl/ribbon.json";
import "../src/openaec/openaec-tokens.css";
import "../src/themes.css";
import "../src/components/openFem3d/OpenFem3DEditor.css";
import "../src/components/fem/FemProjectTree.css";
import OpenFem3DProperties from "../src/components/openFem3d/OpenFem3DProperties";
import OpenFem3DExplorer from "../src/components/openFem3d/OpenFem3DExplorer";
import OpenFem3DReport from "../src/components/openFem3d/OpenFem3DReport";
import ThreeFrameCanvas from "../src/components/openFem3d/ThreeFrameCanvas";
import { OPEN_FEM_3D_SUPPORT_PRESETS, parseOpenFem3DModel, type OpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import { openFem3DLoadPickSegments } from "../src/components/openFem3d/openFem3dMarkers";
import type { OpenFem3DSelection } from "../src/components/openFem3d/openFem3dSelection";
import type { OpenFem3DSolveResult } from "../src/components/openFem3d/openFem3dSolver";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, type OpenFem3DVisibility } from "../src/components/openFem3d/openFem3dVisibility";
import type { OpenFem3DCameraState } from "../src/components/openFem3d/openFem3dViewSets";
import type { OpenFem3DUtilization } from "../src/components/openFem3d/openFem3dUtilization";
import { DEFAULT_DISPLAY_FLAGS } from "../src/components/fem/FemResultsOverlay";
import { DEFAULT_STRUCTURAL_GRID } from "../src/components/fem/femTypes";

// Synthetische PointerEvents hebben geen actieve aanwijzer om vast te houden.
Element.prototype.setPointerCapture = function () {};
Element.prototype.releasePointerCapture = function () {};

// De renderer, scène en camera waarmee het tekenvlak echt tekent (zoals in
// open-fem3d-bedding-browser.tsx).
let renderCamera: THREE.Camera | null = null;
let renderScene: THREE.Object3D | null = null;
Object.defineProperty(THREE.WebGLRenderer.prototype, "render", {
  configurable: true,
  set(this: THREE.WebGLRenderer, fn: (scene: THREE.Object3D, camera: THREE.Camera) => void) {
    Object.defineProperty(this, "render", {
      configurable: true, writable: true,
      value: (scene: THREE.Object3D, cam: THREE.Camera) => {
        renderCamera = cam; renderScene = scene;
        return fn.call(this, scene, cam);
      },
    });
  },
});

const tests: { name: string; error?: string }[] = [];
const container = document.getElementById("root")!;
let root = createRoot(container);
function mount(element: React.ReactNode) {
  flushSync(() => root.unmount());
  root = createRoot(container);
  flushSync(() => root.render(element));
}
const wacht = (ms = 40) => new Promise((r) => setTimeout(r, ms));
function ok(v: unknown, m: string) { if (!v) throw Error(m); }
function gelijk(a: unknown, b: unknown, m: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(`${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); tests.push({ name }); }
  catch (e) { tests.push({ name, error: e instanceof Error ? e.message : String(e) }); }
}
function typ(el: HTMLInputElement, waarde: string) {
  el.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, waarde);
  flushSync(() => el.dispatchEvent(new Event("input", { bubbles: true })));
}
function kies(el: HTMLSelectElement, waarde: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, waarde);
  flushSync(() => el.dispatchEvent(new Event("change", { bubbles: true })));
}
const q = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const richting = () => q<HTMLSelectElement>("[data-open-fem3d-line-direction]")!;
const vinkje = () => q<HTMLInputElement>("[data-open-fem3d-per-projection]");
const opslaan = () => flushSync(() => q<HTMLButtonElement>(".open-fem3d-load-submit")!.click());

/* ── Model: een schuine spant (4 m horizontaal, 3 m omhoog) en een liggende ligger ── */

const sneeuw = { globalDirection: "z", qStart: -2, qEnd: -2, perProjection: true, startPositionM: 0, endPositionM: 5 };
const spant = (memberLoads: unknown[] = []): OpenFem3DModel => parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 3 }, { id: 3, x: 8, y: 0, z: 0 }],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 300", material: "S235" },
    { id: 2, startNodeId: 2, endNodeId: 3, profileName: "IPE 300", material: "S235" },
  ],
  supports: [{ nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.pinned }, { nodeId: 3, ...OPEN_FEM_3D_SUPPORT_PRESETS.pinned }],
  memberLoads,
});

/** Een kolom (HEB 200, 4 m) onder een globale Z-last: een last langs de staaf. */
const kolomOnderZ = (): OpenFem3DModel => parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 4 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEB 200", material: "S235" }],
  supports: [{ nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.fixed }],
  memberLoads: [{ id: 1, beamId: 1, globalDirection: "z", qStart: -2, qEnd: -2, startPositionM: 0, endPositionM: 4 }],
});
const KOLOM_CAMERA: OpenFem3DCameraState = { position: [0, -40, 2], target: [0, 0, 2], up: [0, 0, 1], orthoHalfHeight: 3 };

/** Een kleine uitkomst van de kern: het rapport toont de lastentabellen pas bij een resultaat. */
function uitkomst(model: OpenFem3DModel): OpenFem3DSolveResult {
  return {
    schemaVersion: 1,
    engine: { id: "open-fem-3d", name: "Open FEM 3D", revision: "test", license: "AGPL-3.0" },
    analysis: "linear",
    displacements: model.nodes.map((node) => ({ nodeId: node.id, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 })),
    reactions: [],
    memberForces: model.beams.map((beam) => ({
      memberId: beam.id, lengthM: 5, nStartKn: 0, nEndKn: 0, vyStartKn: 0, vyEndKn: 0, vzStartKn: 0, vzEndKn: 0,
      torsionStartKnm: 0, torsionEndKnm: 0, myStartKnm: 0, myEndKnm: 0, mzStartKnm: 0, mzEndKnm: 0,
    })),
    diagrams: { momentY: [], momentZ: [], shearY: [], shearZ: [], axial: [], torsion: [] },
    buckling: { status: "notApplicable", reason: "test" },
    diagnostics: [],
  };
}

/* ── Eigenschappen in een omhulsel dat het model bijhoudt ────────────── */

let wijzigingen: OpenFem3DModel[] = [];
function Paneel({ begin, selectie }: { begin: OpenFem3DModel; selectie: OpenFem3DSelection }) {
  const [model, setModel] = useState(begin);
  return <div style={{ width: 320, background: "var(--theme-bg, #fff)" }} className="open-fem3d-editor">
    <OpenFem3DProperties model={model} selection={selectie} result={null}
      onChange={(next) => { wijzigingen.push(next); setModel(next); }} />
  </div>;
}
const laatste = () => wijzigingen[wijzigingen.length - 1];

/* ── Het tekenvlak ───────────────────────────────────────────────────── */

const GEEN_BENUTTINGEN: OpenFem3DUtilization[] = [];
let gekozen: OpenFem3DSelection = null;
function Tekenvlak({ model, zicht, camera }: { model: OpenFem3DModel; zicht: OpenFem3DVisibility; camera: OpenFem3DCameraState }) {
  const [sel, setSel] = useState<OpenFem3DSelection>(null);
  return <div className="open-fem3d-stage" style={{ width: 1000, height: 700, flex: "none" }}>
    <ThreeFrameCanvas model={model} onChange={() => {}} tool="select" selection={sel}
      onSelect={(next) => { gekozen = next; setSel(next); }}
      fitToken={0} visibility={zicht} utilizations={GEEN_BENUTTINGEN} result={null}
      cameraRequest={{ state: camera, token: 1 }} />
  </div>;
}
/** Parallel, recht van voren (camera op −y): de spant in het XZ-vlak. */
const VOOR: OpenFem3DCameraState = { position: [4, -40, 2.2], target: [4, 0, 2.2], up: [0, 0, 1], orthoHalfHeight: 4.2 };
const basisZicht: OpenFem3DVisibility = {
  ...DEFAULT_OPEN_FEM_3D_VISIBILITY, perspective: false, grid: false, axes: false, structuralGrid: false, levelMarks: false,
  nodeNumbers: false, viewCube: false, loads: true,
};
async function toon(model: OpenFem3DModel, zicht = basisZicht, camera = VOOR) {
  gekozen = null;
  mount(<Tekenvlak model={model} zicht={zicht} camera={camera} />);
  await wacht(250);
}
const canvasEl = () => container.querySelector("canvas") as HTMLCanvasElement;
/** De lijnstukken van de lasten (pijlen en staartlijnen), zoals het tekenvlak ze op schermafstand kiest. */
function lastDelen() {
  const uit: ReturnType<typeof openFem3DLoadPickSegments>[number][] = [];
  renderScene?.traverse((o) => { uit.push(...openFem3DLoadPickSegments(o)); });
  return uit.filter((deel) => deel.selection.type === "memberLoad");
}
function projectielijnen(): THREE.LineSegments[] {
  const uit: THREE.LineSegments[] = [];
  renderScene?.traverse((o) => { if (o.userData.openFem3dLoadProjection) uit.push(o as THREE.LineSegments); });
  return uit;
}
function klikWereld(p: THREE.Vector3) {
  ok(renderCamera, "er is getekend");
  const n = p.clone().project(renderCamera!);
  const rect = canvasEl().getBoundingClientRect();
  const clientX = rect.left + (n.x + 1) / 2 * rect.width;
  const clientY = rect.top + (1 - n.y) / 2 * rect.height;
  for (const [type, knoppen] of [["pointerdown", 1], ["pointerup", 0]] as const) {
    flushSync(() => canvasEl().dispatchEvent(new PointerEvent(type, {
      clientX, clientY, button: 0, buttons: knoppen, pointerId: 1, pointerType: "mouse", bubbles: true, cancelable: true,
    })));
  }
}

/* ── Proeven ──────────────────────────────────────────────────────────── */

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", resources: { nl: { common, ribbon } }, defaultNS: "common", initImmediate: false,
  });
  const beeld = new URLSearchParams(location.hash.slice(1)).get("beeld");
  if (beeld) { await toonBeeld(beeld); return; }

  await test("paneel: Richting kent Lokaal z/y en Globaal X/Y/Z; bij globaal het vinkje Per projectie met uitleg", async () => {
    wijzigingen = [];
    mount(<Paneel begin={spant()} selectie={{ type: "beam", id: 1 }} />);
    await wacht();
    gelijk([...richting().options].map((o) => o.textContent), ["Lokaal z", "Lokaal y", "Globaal X", "Globaal Y", "Globaal Z"], "de keuzes");
    ok(!vinkje(), "lokaal: geen vinkje Per projectie");
    kies(richting(), "Z");
    await wacht();
    ok(vinkje() && !vinkje()!.checked, "globaal: het vinkje staat er, uit");
    ok(container.textContent?.includes("Per projectie"), "het label");
    ok(q("[data-open-fem3d-per-projection-hint]")?.textContent?.includes("sneeuw per horizontale meter op een schuin dak"), "de uitleg");
    gelijk(q<HTMLInputElement>("input[name=uniformQ]")?.value, "-5", "de ingevulde q gaat mee naar de nieuwe richting");
  });

  await test("paneel: een globale Z-last per projectie toevoegen", async () => {
    wijzigingen = [];
    mount(<Paneel begin={spant()} selectie={{ type: "beam", id: 1 }} />);
    await wacht();
    kies(richting(), "Z");
    await wacht();
    typ(q<HTMLInputElement>("input[name=uniformQ]")!, "-2");
    flushSync(() => vinkje()!.click());
    opslaan();
    await wacht();
    gelijk(laatste()?.memberLoads, [{ id: 1, beamId: 1, caseId: 1, ...sneeuw }], "de last in het model");
    const regel = q(".open-fem3d-condition-load-list")?.textContent ?? "";
    ok(regel.includes("qZ -2→-2") && regel.includes("per proj.") && regel.includes("0–5000 mm"), `de regel in de lijst: ${regel}`);
  });

  await test("paneel: een globale last kiezen, projectie uit en opslaan", async () => {
    wijzigingen = [];
    mount(<Paneel begin={spant([{ id: 1, beamId: 1, ...sneeuw }])} selectie={{ type: "memberLoad", id: 1 }} />);
    await wacht(80);
    gelijk(richting().value, "Z", "de richting van de gekozen last");
    ok(vinkje()?.checked, "per projectie staat aan");
    gelijk(q<HTMLInputElement>("input[name=uniformQ]")?.value, "-2", "q");
    flushSync(() => vinkje()!.click());
    opslaan();
    await wacht();
    gelijk(laatste()?.memberLoads, [{ id: 1, beamId: 1, globalDirection: "z", qStart: -2, qEnd: -2, startPositionM: 0, endPositionM: 5 }],
      "per staafmeter: het veld perProjection valt weg");
  });

  await test("paneel: van globaal terug naar lokaal z", async () => {
    wijzigingen = [];
    mount(<Paneel begin={spant([{ id: 1, beamId: 1, ...sneeuw }])} selectie={{ type: "memberLoad", id: 1 }} />);
    await wacht(80);
    kies(richting(), "z");
    await wacht();
    ok(!vinkje(), "lokaal: het vinkje is weg");
    opslaan();
    await wacht();
    gelijk(laatste()?.memberLoads, [{ id: 1, beamId: 1, qyStart: 0, qyEnd: 0, qzStart: -2, qzEnd: -2, startPositionM: 0, endPositionM: 5 }],
      "een lokale z-last met dezelfde q");
  });

  await test("paneel: variabele globale last, met de velden q begin en q eind", async () => {
    wijzigingen = [];
    mount(<Paneel begin={spant([{ id: 1, beamId: 1, globalDirection: "x", qStart: 1, qEnd: 3, startPositionM: 1, endPositionM: 4 }])}
      selectie={{ type: "memberLoad", id: 1 }} />);
    await wacht(80);
    gelijk(richting().value, "X", "globaal X");
    ok(q("input[name=qStart]") && q("input[name=qEnd]") && !q("input[name=qyStart]"), "de details tonen q begin/eind, geen qy/qz");
    const labels = [...container.querySelectorAll(".open-fem3d-load-details label span")].map((s) => s.textContent);
    ok(labels.includes("q begin") && labels.includes("q eind"), `de labels: ${labels.join(", ")}`);
    gelijk([q<HTMLInputElement>("input[name=startMm]")?.value, q<HTMLInputElement>("input[name=endMm]")?.value], ["1000", "4000"], "het bereik in mm");
    typ(q<HTMLInputElement>("input[name=qEnd]")!, "5");
    opslaan();
    await wacht();
    gelijk(laatste()?.memberLoads?.[0], { id: 1, beamId: 1, globalDirection: "x", qStart: 1, qEnd: 5, startPositionM: 1, endPositionM: 4 },
      "q eind gewijzigd, de rest blijft");
  });

  await test("tekenvlak: de pijlen wijzen recht omlaag met de staart langs de spant; per projectie een horizontale projectielijn", async () => {
    await toon(spant([{ id: 1, beamId: 1, ...sneeuw }]));
    const ex = new THREE.Vector3(0.8, 0, 0.6);
    const delen = lastDelen();
    const pijlen = delen.filter((d) => Math.abs(d.b.x - d.a.x) < 1e-9 && Math.abs(d.b.y - d.a.y) < 1e-9);
    ok(pijlen.length >= 3 && pijlen.every((d) => d.b.z < d.a.z), `${pijlen.length} pijlen verticaal omlaag`);
    ok(pijlen.every((d) => Math.abs(d.b.z - 0.75 * d.b.x) < 1e-9), "de pijlpunten liggen op de spant");
    const staart = delen.filter((d) => !pijlen.includes(d));
    ok(staart.length >= 2 && staart.every((d) => Math.abs(Math.abs(d.b.clone().sub(d.a).normalize().dot(ex)) - 1) < 1e-9),
      "de staartlijn loopt evenwijdig aan de spant");
    const lijnen = projectielijnen();
    gelijk(lijnen.length, 1, "één projectielijn");
    const punten = lijnen[0].geometry.getAttribute("position");
    const zs = Array.from({ length: punten.count }, (_, i) => punten.getZ(i));
    ok(Math.max(...zs) - Math.min(...zs) < 1e-9 && Math.min(...zs) > 3, "horizontaal, boven de staarten");
  });

  await test("tekenvlak: per staafmeter geen projectielijn; een lokale z-last staat loodrecht op de spant", async () => {
    await toon(spant([{ id: 1, beamId: 1, ...sneeuw, perProjection: false }]));
    gelijk(projectielijnen().length, 0, "geen projectielijn");
    await toon(spant([{ id: 1, beamId: 1, qyStart: 0, qyEnd: 0, qzStart: -2, qzEnd: -2, startPositionM: 0, endPositionM: 5 }]));
    const ez = new THREE.Vector3(-0.6, 0, 0.8);
    ok(lastDelen().filter((d) => Math.abs(Math.abs(d.b.clone().sub(d.a).normalize().dot(ez)) - 1) < 1e-9).length >= 3,
      "ter vergelijking: lokaal z loodrecht op de staaf");
  });

  await test("tekenvlak: een klik op een pijl kiest de last; de projectielijn kleurt mee", async () => {
    await toon(spant([{ id: 1, beamId: 1, ...sneeuw }]));
    const pijl = lastDelen().find((d) => Math.abs(d.b.x - d.a.x) < 1e-9 && d.b.x > 1.5 && d.b.x < 2.5)!;
    ok(pijl, "een pijl in het midden");
    klikWereld(pijl.a.clone().lerp(pijl.b, 0.4));
    await wacht(120);
    gelijk(gekozen, { type: "memberLoad", id: 1 }, "de last gekozen");
    const kleur = (projectielijnen()[0].material as THREE.LineBasicMaterial).color.getHex();
    gelijk(kleur.toString(16), (0xffa31a).toString(16), "de projectielijn in de selectiekleur");
  });

  await test("tekenvlak: een kolom onder Globaal Z — de pijlen staan naast de kolom (niet op de staafas) en een klik op een pijl kiest de last", async () => {
    // Met profielen (HEB 200, 0,2 m breed): de pijlen liggen langs de kolom en vielen vroeger in het profiel.
    await toon(kolomOnderZ(), { ...basisZicht, profiles: true }, KOLOM_CAMERA);
    const delen = lastDelen();
    ok(delen.length >= 4, `${delen.length} lijnstukken van de last`);
    ok(delen.every((d) => Math.abs(d.a.x - d.b.x) < 1e-9 && Math.abs(d.a.y) < 1e-9 && Math.abs(d.b.y) < 1e-9),
      "alle lijnstukken verticaal, in de lastrichting");
    ok(delen.every((d) => d.a.x > 0.15), `naast de kolom: x = ${delen[0].a.x.toFixed(3)} m, de flens reikt tot 0,1 m`);
    // In beeld: de pijlen staan ruim naast de staaflijn.
    const naarScherm = (p: THREE.Vector3) => {
      const n = p.clone().project(renderCamera!);
      return (n.x + 1) / 2 * canvasEl().getBoundingClientRect().width;
    };
    const afstand = Math.abs(naarScherm(delen[0].a) - naarScherm(new THREE.Vector3(0, 0, 2)));
    ok(afstand > 15, `in beeld ${afstand.toFixed(1)} px van de staaflijn`);
    const pijl = delen.find((d) => d.b.z < d.a.z && d.b.z > 1.2 && d.b.z < 2.8)!;
    ok(pijl, "een pijl halverwege de kolom");
    klikWereld(pijl.a.clone().lerp(pijl.b, 0.4));
    await wacht(120);
    gelijk(gekozen, { type: "memberLoad", id: 1 }, "de last gekozen, niet de kolom");
  });

  await test("verkenner: de regel van een globale last", async () => {
    const model = spant([{ id: 1, beamId: 1, ...sneeuw }]);
    mount(<OpenFem3DExplorer model={model} selection={null} setSelection={() => {}} result={null}
      visibility={DEFAULT_OPEN_FEM_3D_VISIBILITY} setVisibility={() => {}} activeTab="project"
      displayFlags={DEFAULT_DISPLAY_FLAGS} setDisplayFlags={() => {}} gridShow={false} setGridShow={() => {}}
      structuralGrid={DEFAULT_STRUCTURAL_GRID} setStructuralGridEnabled={() => {}} setDiagramLabels={() => {}} />);
    await wacht();
    ok(container.textContent?.includes("qZ -2→-2 · per proj. · 0–5000 mm"), `de verkenner: ${container.textContent?.slice(0, 400)}`);
  });

  await test("rapport: de lastentabel toont de richting", async () => {
    const model = spant([
      { id: 1, beamId: 1, ...sneeuw },
      { id: 2, beamId: 2, qyStart: 1, qyEnd: 1, qzStart: -3, qzEnd: -3, startPositionM: 0, endPositionM: 5 },
      { id: 3, beamId: 2, globalDirection: "x", qStart: 1, qEnd: 2, startPositionM: 0, endPositionM: 5 },
    ]);
    mount(<OpenFem3DReport model={model} result={uitkomst(model)} />);
    await wacht();
    const rij = (sleutel: string) => q(`[data-open-fem3d-report-member-load='${sleutel}']`)?.textContent ?? "";
    ok(rij("1").includes("globaal Z, per projectie"), `globaal per projectie: ${rij("1")}`);
    ok(rij("3").includes("globaal X") && !rij("3").includes("projectie"), `globaal per staafmeter: ${rij("3")}`);
    ok(rij("2-y").includes("lokaal y") && rij("2-z").includes("lokaal z"), "een lokale last met qy én qz: twee regels");
    const kop = [...container.querySelectorAll("th")].map((th) => th.textContent);
    ok(kop.includes("Richting") && kop.includes("q begin") && kop.includes("q eind"), `de kolommen: ${kop.join(", ")}`);
  });
}

/** Beelden voor de schermafbeeldingen (geen proeven). */
async function toonBeeld(beeld: string) {
  if (beeld === "paneel") {
    mount(<div style={{ padding: 8, background: "#fff", width: 340 }}>
      <Paneel begin={spant([{ id: 1, beamId: 1, ...sneeuw }])} selectie={{ type: "memberLoad", id: 1 }} />
    </div>);
    await wacht(200);
    // Alleen het lastpaneel in beeld.
    container.querySelector(".open-fem3d-member-loads")?.scrollIntoView();
    return;
  }
  const zicht: OpenFem3DVisibility = { ...basisZicht, supports: true };
  const camera: OpenFem3DCameraState = { position: [4, -40, 2.4], target: [4, 0, 2.4], up: [0, 0, 1], orthoHalfHeight: 3.6 };
  if (beeld === "staafmeter") {
    await toon(spant([{ id: 1, beamId: 1, ...sneeuw, perProjection: false }]), zicht, camera);
    await wacht(300);
    return;
  }
  if (beeld === "projectie") {
    await toon(spant([{ id: 1, beamId: 1, ...sneeuw }]), zicht, camera);
    await wacht(300);
  }
  if (beeld === "kolom") {
    await toon(kolomOnderZ(), { ...zicht, profiles: true }, KOLOM_CAMERA);
    await wacht(300);
  }
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el && !el.textContent) el.textContent = JSON.stringify({ tests, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, error: String(e?.stack ?? e) }); });

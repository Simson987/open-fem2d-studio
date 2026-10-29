/**
 * Browserkant van test-open-fem3d-plaatbedding-ui.mjs: plaat op bedding in 3D
 * (issue #107) in de echte onderdelen, in een lokale headless browser.
 *
 *  - Eigenschappen van een plaat: het vinkje "Op bedding" zet direct
 *    k = 50 000 kN/m³ (zoals de staafbedding), in één stap; k wijzigen, alleen
 *    druk en uitvinken; een ongeldige k zet de vorige waarde terug. Een
 *    meervoudige selectie (half vinkje) zet alle platen in één keer. Een wand
 *    op bedding noemt de grondzijde (die volgt uit de plaatassen) en
 *    waarschuwt bij alleen druk. De tab
 *    Resultaten toont zakking, gronddruk, het deel zonder contact en de
 *    extremen p en s in de tabel van de plaat.
 *  - Het tekenvlak: de gearceerde grond onder de vloer (niet onder de wand),
 *    met de laag Opleggingen (uit = weg); in Volume onder de onderzijde, in
 *    Vlak en Mesh onder het middenvlak; de spleet volgt de regelaar
 *    Opleggingen (200 %).
 *  - De contour Gronddruk: grijs waar geen contact is, met een stip op elke
 *    knoop zonder contact; Zakking ook met de stippen; een andere grootheid
 *    zonder.
 *  - De verkenner: Gronddruk en Zakking in de keuzelijst alleen met platen op
 *    bedding.
 *  - Het rapport: de tabel Platen op bedding en de extremen p en s per plaat.
 *
 * `#beeld=…` toont alleen een beeld voor een schermafbeelding: eigenschappen,
 * arcering, arcering-vlak of gronddruk.
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
import { parseOpenFem3DModel, setOpenFem3DPlateBedding, type OpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import type { OpenFem3DSelection } from "../src/components/openFem3d/openFem3dSelection";
import type { OpenFem3DSolveResult } from "../src/components/openFem3d/openFem3dSolver";
import type { OpenFem3DPlateQuantity } from "../src/components/openFem3d/openFem3dPlateResults";
import { OPEN_FEM_3D_PLATE_BEDDING_NAME } from "../src/components/openFem3d/openFem3dPlateBeddingHatch";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, type OpenFem3DVisibility } from "../src/components/openFem3d/openFem3dVisibility";
import type { OpenFem3DCameraState } from "../src/components/openFem3d/openFem3dViewSets";
import type { OpenFem3DUtilization } from "../src/components/openFem3d/openFem3dUtilization";
import { DEFAULT_DISPLAY_FLAGS } from "../src/components/fem/FemResultsOverlay";
import { DEFAULT_STRUCTURAL_GRID } from "../src/components/fem/femTypes";

// Synthetische PointerEvents hebben geen actieve aanwijzer om vast te houden.
Element.prototype.setPointerCapture = function () {};
Element.prototype.releasePointerCapture = function () {};

// De scène waarmee het tekenvlak echt tekent (zoals in open-fem3d-bedding-browser.tsx).
let renderScene: THREE.Object3D | null = null;
Object.defineProperty(THREE.WebGLRenderer.prototype, "render", {
  configurable: true,
  set(this: THREE.WebGLRenderer, fn: (scene: THREE.Object3D, camera: THREE.Camera) => void) {
    Object.defineProperty(this, "render", {
      configurable: true, writable: true,
      value: (scene: THREE.Object3D, cam: THREE.Camera) => {
        renderScene = scene;
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
function ongeveer(a: number, b: number, tol: number, m: string) {
  if (!(Math.abs(a - b) <= tol)) throw Error(`${m}: ${a.toFixed(6)} ≠ ${b} (± ${tol})`);
}
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); tests.push({ name }); }
  catch (e) { tests.push({ name, error: e instanceof Error ? e.message : String(e) }); }
}
function typ(el: HTMLInputElement, waarde: string) {
  el.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, waarde);
  flushSync(() => el.dispatchEvent(new Event("input", { bubbles: true })));
  flushSync(() => el.blur());
}
const veld = (selector: string) => container.querySelector<HTMLInputElement>(selector);

/* ── Model: een vloer van 8 × 6 m op zand, met een wand erop ─────────────── */

const zand = { kKnPerM3: 20_000, compressionOnly: true };
const T = 0.25;
const gebouw = (bedding = true): OpenFem3DModel => parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 8, y: 0, z: 0 }, { id: 3, x: 8, y: 6, z: 0 }, { id: 4, x: 0, y: 6, z: 0 },
    { id: 5, x: 8, y: 6, z: 3 }, { id: 6, x: 0, y: 6, z: 3 },
  ],
  beams: [],
  plates: [
    { id: 1, nodeIds: [1, 2, 3, 4], thicknessM: T, material: "C30/37", ...(bedding ? { bedding: zand } : {}) },
    { id: 2, nodeIds: [4, 3, 5, 6], thicknessM: 0.2, material: "C30/37" },
  ],
  supports: [
    { nodeId: 1, ux: true, uy: true, uz: false, rx: false, ry: false, rz: false },
    { nodeId: 2, ux: false, uy: true, uz: false, rx: false, ry: false, rz: false },
  ],
  surfaceLoads: [{ id: 1, plateId: 1, qx: 0, qy: 0, qz: -10 }],
});

/**
 * Een verzonnen uitkomst van de kern, alleen voor de weergave: een net van
 * 1 × 1 m over de vloer, zakking s = 3 − x mm (x = 0 … 8 m), gronddruk
 * 20·s kN/m² waar s > 0; voorbij x = 3 m komt de vloer los (alleen druk).
 */
const NX = 8, NY = 6;
const knoopId = (i: number, j: number) => 1000 + j * (NX + 1) + i;
/** Knopen zonder contact: x = 3 … 8 m (bij x = 3 is s = 0, ook los), zes kolommen van zeven knopen. */
const LOS = (NX - 3 + 1) * (NY + 1);
function uitkomst(metBedding = true): OpenFem3DSolveResult {
  const nodes: { id: number; x: number; y: number; z: number }[] = [];
  const elements: { id: number; plateId: number; nodeIds: number[] }[] = [];
  for (let j = 0; j <= NY; j += 1) for (let i = 0; i <= NX; i += 1) nodes.push({ id: knoopId(i, j), x: i, y: j, z: 0 });
  for (let j = 0; j < NY; j += 1) for (let i = 0; i < NX; i += 1) {
    elements.push({ id: elements.length + 1, plateId: 1, nodeIds: [knoopId(i, j), knoopId(i + 1, j), knoopId(i + 1, j + 1), knoopId(i, j + 1)] });
  }
  const leeg = { nxxKnPerM: 0, nyyKnPerM: 0, nxyKnPerM: 0, mxxKnmPerM: 0, myyKnmPerM: 0, mxyKnmPerM: 0,
    sigmaXxTopMpa: 0, sigmaYyTopMpa: 0, tauXyTopMpa: 0, vonMisesTopMpa: 0, sigmaXxBottomMpa: 0, sigmaYyBottomMpa: 0, tauXyBottomMpa: 0, vonMisesBottomMpa: 0 };
  const beddingNodes = nodes.map((node) => {
    const s = 3 - node.x;
    return { nodeId: node.id, settlementM: s / 1000, pressureKnPerM2: s > 0 ? 20 * s : 0, active: s > 0 };
  });
  return {
    schemaVersion: 2, engine: { id: "proef", name: "proef", revision: "proef", license: "proef" }, analysis: "linear",
    displacements: nodes.map((node) => ({ nodeId: node.id, ux: 0, uy: 0, uz: -(3 - node.x) / 1000, rx: 0, ry: 0, rz: 0 })),
    reactions: [], memberForces: [], buckling: { status: "notApplicable", reason: "proef" }, diagnostics: [],
    plates: [{
      plateId: 1, axes: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }, elementCount: elements.length, nodeCount: nodes.length,
      areaM2: 48, loadResultantKn: [0, 0, -480],
      extremes: [{ quantity: "mxxKnmPerM", min: -1, minNodeId: 1000, max: 2, maxNodeId: 1001 }],
    }],
    shellNodes: nodes.map((node) => ({ ...leeg, nodeId: node.id, plateId: 1, wM: -(3 - node.x) / 1000 })),
    plateMesh: { nodes, elements, beamIntermediateNodes: new Map(), plateEdgeNodes: new Map(), plates: [], notices: [] },
    ...(metBedding ? {
      plateBedding: [{
        plateId: 1, nodes: beddingNodes, maxPressureKnPerM2: 60, minPressureKnPerM2: 0, maxSettlementM: 0.003,
        totalReactionKn: 480, liftedFraction: 0.5625,
      }],
    } : {}),
  } as unknown as OpenFem3DSolveResult;
}

/* ── Eigenschappen in een omhulsel dat het model bijhoudt ────────────── */

let wijzigingen: OpenFem3DModel[] = [];
function Paneel({ begin, selectie, result = null }: { begin: OpenFem3DModel; selectie: OpenFem3DSelection; result?: OpenFem3DSolveResult | null }) {
  const [model, setModel] = useState(begin);
  return <div style={{ width: 320, background: "var(--theme-bg, #fff)" }} className="open-fem3d-editor">
    <OpenFem3DProperties model={model} selection={selectie} result={result}
      onChange={(next) => { wijzigingen.push(next); setModel(next); }} />
  </div>;
}
const laatste = () => wijzigingen[wijzigingen.length - 1];
const plaat = (model: OpenFem3DModel | undefined, id: number) => model?.plates?.find((item) => item.id === id);

/* ── Het tekenvlak ───────────────────────────────────────────────────── */

const GEEN_BENUTTINGEN: OpenFem3DUtilization[] = [];
let zetZicht: (zicht: OpenFem3DVisibility) => void = () => {};
function Tekenvlak({ model, zicht: beginZicht, camera, result = null, plateQuantity = null }: {
  model: OpenFem3DModel; zicht: OpenFem3DVisibility; camera?: OpenFem3DCameraState; result?: OpenFem3DSolveResult | null;
  plateQuantity?: OpenFem3DPlateQuantity | null;
}) {
  const [zicht, setZicht] = useState(beginZicht);
  zetZicht = (next) => flushSync(() => setZicht(next));
  return <div className="open-fem3d-stage" style={{ width: 1000, height: 700, flex: "none" }}>
    <ThreeFrameCanvas model={model} onChange={() => {}} tool="select" selection={null} onSelect={() => {}}
      fitToken={0} visibility={zicht} utilizations={GEEN_BENUTTINGEN} result={result} plateQuantity={plateQuantity}
      cameraRequest={camera ? { state: camera, token: 1 } : undefined} viewRequest={camera ? undefined : { kind: "iso", token: 1 }} />
  </div>;
}
/** Parallel, recht van voren (camera op −y): de vloer als lijn met de grond eronder. */
const VOOR: OpenFem3DCameraState = { position: [4, -40, -0.2], target: [4, 0, -0.2], up: [0, 0, 1], orthoHalfHeight: 2 };
const ISO: OpenFem3DCameraState = { position: [12.5, -6.5, 5.5], target: [4, 2.6, -0.3], up: [0, 0, 1] };
const BOVEN: OpenFem3DCameraState = { position: [4, 3, 40], target: [4, 3, 0], up: [0, 1, 0], orthoHalfHeight: 4.2 };
const basisZicht: OpenFem3DVisibility = {
  ...DEFAULT_OPEN_FEM_3D_VISIBILITY, perspective: false, grid: false, axes: false, structuralGrid: false, levelMarks: false,
  nodeNumbers: false, viewCube: false, loads: false,
};
async function toon(model: OpenFem3DModel, zicht: OpenFem3DVisibility, camera?: OpenFem3DCameraState,
  result?: OpenFem3DSolveResult | null, plateQuantity?: OpenFem3DPlateQuantity | null) {
  mount(<Tekenvlak model={model} zicht={zicht} camera={camera} result={result} plateQuantity={plateQuantity} />);
  await wacht(250);
}
const tekenvlakEl = () => container.querySelector(".open-fem3d-canvas") as HTMLDivElement;
const plaatlaag = () => renderScene?.getObjectByName("open-fem3d-plate-overlay");
const arcering = () => plaatlaag()?.getObjectByName(OPEN_FEM_3D_PLATE_BEDDING_NAME);
/** Hoogte (z) van alle punten van een object en zijn kinderen, in wereldcoördinaten. */
function zBereik(object: THREE.Object3D): { min: number; max: number } {
  object.updateWorldMatrix(true, true);
  let min = Infinity, max = -Infinity;
  object.traverse((o) => {
    const pos = ((o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined)?.getAttribute("position");
    if (!pos) return;
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      min = Math.min(min, p.z); max = Math.max(max, p.z);
    }
  });
  return { min, max };
}

/* ── Proeven ──────────────────────────────────────────────────────────── */

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", resources: { nl: { common, ribbon } }, defaultNS: "common", initImmediate: false,
  });
  const beeld = new URLSearchParams(location.hash.slice(1)).get("beeld");
  if (beeld) { await toonBeeld(beeld); return; }

  await test("eigenschappen: Op bedding aanvinken zet k = 50 000 kN/m³ in één stap; k, alleen druk en uitvinken", async () => {
    wijzigingen = [];
    mount(<Paneel begin={gebouw(false)} selectie={{ type: "plate", id: 1 }} />);
    await wacht();
    const vinkje = veld("[data-open-fem3d-plate-bedding]");
    ok(vinkje && !vinkje.checked, "het vinkje staat in het paneel, uit");
    ok(container.textContent?.includes("Plaat op bedding") && container.textContent.includes("Op bedding"), "kop en label");
    ok(!veld("[data-open-fem3d-plate-bedding-k]"), "uit: geen k-veld");
    flushSync(() => vinkje!.click());
    await wacht();
    gelijk(wijzigingen.length, 1, "één wijziging, één stap ongedaan maken");
    gelijk(plaat(laatste(), 1)?.bedding, { kKnPerM3: 50_000 }, "k = 50 000 kN/m³, zonder alleen druk");
    gelijk(veld("[data-open-fem3d-plate-bedding-k]")?.value, "50000", "het k-veld toont 50 000");
    typ(veld("[data-open-fem3d-plate-bedding-k]")!, "20000");
    await wacht();
    gelijk(plaat(laatste(), 1)?.bedding, { kKnPerM3: 20_000 }, "k = 20 000");
    flushSync(() => veld("[data-open-fem3d-plate-bedding-compression]")!.click());
    await wacht();
    gelijk(plaat(laatste(), 1)?.bedding, { kKnPerM3: 20_000, compressionOnly: true }, "alleen druk aan");
    ok(container.textContent?.includes("trekt de grond niet"), "de uitleg bij alleen druk");
    flushSync(() => veld("[data-open-fem3d-plate-bedding-compression]")!.click());
    await wacht();
    gelijk(plaat(laatste(), 1)?.bedding, { kKnPerM3: 20_000 }, "alleen druk weer uit");
    flushSync(() => veld("[data-open-fem3d-plate-bedding]")!.click());
    await wacht();
    ok(!("bedding" in plaat(laatste(), 1)!), "uitvinken haalt de bedding weg");
    gelijk(wijzigingen.length, 5, "elke handeling één wijziging");
  });

  await test("eigenschappen: een ongeldige k zet de vorige waarde terug en verandert niets", async () => {
    wijzigingen = [];
    mount(<Paneel begin={gebouw()} selectie={{ type: "plate", id: 1 }} />);
    await wacht();
    ok(veld("[data-open-fem3d-plate-bedding]")?.checked, "aan");
    gelijk(veld("[data-open-fem3d-plate-bedding-k]")?.value, "20000", "k uit het model");
    ok(veld("[data-open-fem3d-plate-bedding-compression]")?.checked, "alleen druk uit het model");
    for (const fout of ["-5", "0", "abc", ""]) {
      typ(veld("[data-open-fem3d-plate-bedding-k]")!, fout);
      await wacht();
      gelijk(veld("[data-open-fem3d-plate-bedding-k]")?.value, "20000", `"${fout}" zet 20 000 terug`);
    }
    gelijk(wijzigingen.length, 0, "geen wijziging");
    typ(veld("[data-open-fem3d-plate-bedding-k]")!, "35000,5");
    await wacht();
    gelijk(plaat(laatste(), 1)?.bedding, { kKnPerM3: 35_000.5, compressionOnly: true }, "een komma telt als decimaalteken");
  });

  await test("eigenschappen: meervoudige selectie, half vinkje en alles in één keer", async () => {
    wijzigingen = [];
    mount(<Paneel begin={gebouw()} selectie={{ type: "multi", nodeIds: [], beamIds: [], plateIds: [1, 2] }} />);
    await wacht();
    const vinkje = veld("[data-open-fem3d-plate-bedding]")!;
    ok(vinkje.indeterminate, "één van twee platen op bedding: half vinkje");
    ok(container.textContent?.includes("Op bedding (2 platen)"), "het label noemt het aantal");
    flushSync(() => vinkje.click());
    await wacht();
    gelijk(wijzigingen.length, 1, "één wijziging");
    gelijk([1, 2].map((id) => plaat(laatste(), id)?.bedding), [zand, zand], "beide platen dezelfde bedding (die van de eerste)");
    typ(veld("[data-open-fem3d-plate-bedding-k]")!, "15000");
    await wacht();
    gelijk([1, 2].map((id) => plaat(laatste(), id)?.bedding?.kKnPerM3), [15_000, 15_000], "k voor beide in één keer");
    gelijk(wijzigingen.length, 2, "twee wijzigingen");
  });

  await test("eigenschappen: een wand op bedding noemt de grondzijde (+Y, uit de plaatassen) en waarschuwt bij alleen druk", async () => {
    wijzigingen = [];
    // Plaat 2 is een wand in het XZ-vlak op y = 6 m: de plaatassen leggen de grond aan de +Y-kant.
    mount(<Paneel begin={setOpenFem3DPlateBedding(gebouw(), [2], { kKnPerM3: 20_000 })} selectie={{ type: "plate", id: 2 }} />);
    await wacht();
    const hint = container.querySelector("[data-open-fem3d-plate-bedding-wall]");
    ok(hint && hint.getAttribute("data-open-fem3d-plate-bedding-wall") === "+Y", `de grondzijde +Y (${hint?.getAttribute("data-open-fem3d-plate-bedding-wall")})`);
    ok(hint!.textContent?.includes("aan de +Y-zijde") && hint!.textContent.includes("niet te kiezen"), hint!.textContent ?? "");
    ok(!container.querySelector("[data-open-fem3d-plate-bedding-wall-compression]"), "zonder alleen druk geen waarschuwing");
    flushSync(() => veld("[data-open-fem3d-plate-bedding-compression]")!.click());
    await wacht();
    gelijk(plaat(laatste(), 2)?.bedding, { kKnPerM3: 20_000, compressionOnly: true }, "alleen druk aan");
    const waarschuwing = container.querySelector("[data-open-fem3d-plate-bedding-wall-compression]");
    ok(waarschuwing?.textContent?.includes("zonder alleen druk"), `de waarschuwing bij alleen druk: ${waarschuwing?.textContent}`);
    // Een vloer op bedding: geen wandmelding.
    mount(<Paneel begin={gebouw()} selectie={{ type: "plate", id: 1 }} />);
    await wacht();
    ok(!container.querySelector("[data-open-fem3d-plate-bedding-wall]") && !container.querySelector("[data-open-fem3d-plate-bedding-wall-compression]"),
      "een vloer: geen wandmelding");
  });

  await test("eigenschappen: de tab Resultaten toont zakking, gronddruk, zonder contact en de extremen p en s", async () => {
    const model = gebouw();
    mount(<Paneel begin={model} selectie={{ type: "plate", id: 1 }} result={uitkomst()} />);
    await wacht();
    const tab = [...container.querySelectorAll<HTMLButtonElement>(".fem-prop-tab")].find((knop) => knop.textContent === "Resultaten");
    flushSync(() => tab!.click());
    await wacht();
    const blok = container.querySelector("[data-open-fem3d-plate-bedding-results='1']");
    ok(blok, "het blok Bedding");
    const tekst = blok!.textContent ?? "";
    ok(tekst.includes("3.000 mm") && tekst.includes("60.00 kN/m²") && tekst.includes("0.00 kN/m²") && tekst.includes("56.3 %")
      && tekst.includes("480.00 kN"), `zakking, grootste en kleinste gronddruk, zonder contact en de grondreactie: ${tekst}`);
    const rijen = [...container.querySelectorAll("[data-open-fem3d-plate-extremes='1'] tbody tr")].map((rij) => rij.textContent ?? "");
    ok(rijen.some((rij) => rij.startsWith("p") && rij.includes("60,0") && rij.includes("kN/m²")), `de extremen: gronddruk p (${rijen.join(" | ")})`);
    ok(rijen.some((rij) => rij.startsWith("s") && rij.includes("−5,00") || rij.startsWith("s") && rij.includes("-5,00")), `de extremen: zakking s tot −5 mm (${rijen.join(" | ")})`);
  });

  await test("tekenvlak: de arcering onder de vloer (niet onder de wand), met de laag Opleggingen", async () => {
    await toon(gebouw(), basisZicht, VOOR);
    gelijk(tekenvlakEl().dataset.openFem3dPlateBedding, "1", "één plaat gearceerd");
    const groep = arcering();
    ok(groep, "de groep in de plaatlaag");
    const platen = new Set<number>();
    groep!.traverse((o) => { if (o.userData.openFem3dPlateBedding !== undefined) platen.add(o.userData.openFem3dPlateBedding); });
    gelijk([...platen], [1], "alleen de vloer");
    let gestippeld = 0;
    groep!.traverse((o) => { if (o.userData.openFem3dPlateBeddingContact === "compressionOnly") gestippeld += 1; });
    gelijk(gestippeld, 1, "alleen druk: de rand gestippeld");
    zetZicht({ ...basisZicht, supports: false });
    await wacht(80);
    ok(!arcering(), "Opleggingen uit: geen arcering");
    gelijk(tekenvlakEl().dataset.openFem3dPlateBedding, "0", "en de telling 0");
  });

  await test("tekenvlak: in Volume onder de onderzijde, in Vlak en Mesh onder het middenvlak", async () => {
    await toon(gebouw(), basisZicht, VOOR);
    const volume = zBereik(arcering()!);
    ok(volume.max < -T / 2, `Volume: het grondvlak onder de onderzijde (z = ${volume.max.toFixed(3)} < ${-T / 2})`);
    let rand: THREE.Object3D | null = null;
    arcering()!.traverse((o) => { if (o.userData.openFem3dPlateBeddingSkirt) rand = o; });
    ok(rand, "de rand langs de omtrek, de grond in");
    const diep = zBereik(rand!);
    ok(Math.abs(diep.max - volume.max) < 1e-6 && diep.min < diep.max - 1e-3 && Math.abs(diep.min - volume.min) < 1e-6,
      `de rand loopt van het grondvlak (${diep.max.toFixed(3)}) de grond in (${diep.min.toFixed(3)})`);
    const spleet = -volume.max - T / 2;
    for (const stand of ["surface", "mesh"] as const) {
      zetZicht({ ...basisZicht, plateDisplay: stand });
      await wacht(80);
      const z = zBereik(arcering()!);
      ongeveer(z.max, -spleet, 1e-6, `${stand}: dezelfde spleet onder het middenvlak`);
    }
  });

  await test("tekenvlak: de spleet volgt de regelaar Opleggingen (200 % = twee keer zo groot)", async () => {
    await toon(gebouw(), { ...basisZicht, plateDisplay: "surface" }, VOOR);
    const bij100 = -zBereik(arcering()!).max;
    zetZicht({ ...basisZicht, plateDisplay: "surface", supportSizePercent: 200 });
    await wacht(80);
    const bij200 = -zBereik(arcering()!).max;
    ongeveer(bij200 / bij100, 2, 1e-6, `spleet ${bij100.toFixed(3)} → ${bij200.toFixed(3)} m`);
    gelijk(tekenvlakEl().dataset.openFem3dPlateBedding, "1", "de arcering staat er nog");
  });

  await test("resultaten: de contour Gronddruk, grijs zonder contact en een stip op elke knoop zonder contact", async () => {
    await toon(gebouw(), { ...basisZicht, deformation: false, reactions: false, utilization: false }, BOVEN, uitkomst(), "groundPressure");
    gelijk(tekenvlakEl().dataset.openFem3dPlateOverlay, "contour:groundPressure", "de contour Gronddruk");
    gelijk(tekenvlakEl().dataset.openFem3dPlateLifted, String(LOS), "stippen op de knopen zonder contact (x ≥ 3 m)");
    let contour: THREE.Mesh | null = null;
    plaatlaag()!.traverse((o) => { if (o.userData.openFem3dPlateContour === 1) contour = o as THREE.Mesh; });
    ok(contour, "het contourvlak van de vloer");
    const kleur = (contour as unknown as THREE.Mesh).geometry.getAttribute("color");
    let grijs = 0;
    for (let i = 0; i < kleur.count; i += 1) if (Math.abs(kleur.getX(i) - kleur.getY(i)) < 1e-6 && Math.abs(kleur.getY(i) - kleur.getZ(i)) < 1e-6) grijs += 1;
    gelijk(grijs, LOS, "grijs: precies de knopen zonder contact");
    // Zakking: de stippen blijven, de kleuren volgen de schaal.
    await toon(gebouw(), { ...basisZicht, deformation: false, reactions: false, utilization: false }, BOVEN, uitkomst(), "settlement");
    gelijk(tekenvlakEl().dataset.openFem3dPlateOverlay, "contour:settlement", "de contour Zakking");
    gelijk(tekenvlakEl().dataset.openFem3dPlateLifted, String(LOS), "ook bij de zakking de stippen");
    await toon(gebouw(), { ...basisZicht, deformation: false, reactions: false, utilization: false }, BOVEN, uitkomst(), "w");
    gelijk(tekenvlakEl().dataset.openFem3dPlateLifted, "0", "een andere grootheid: geen stippen");
    await toon(gebouw(), { ...basisZicht, deformation: false, reactions: false, utilization: false }, BOVEN, uitkomst(false), "groundPressure");
    gelijk(tekenvlakEl().dataset.openFem3dPlateOverlay, "none", "een kern zonder plaatbedding-uitvoer: geen contour Gronddruk");
  });

  await test("verkenner: Gronddruk en Zakking in de keuzelijst alleen met platen op bedding", async () => {
    let gekozen: OpenFem3DPlateQuantity | null = "mxx";
    const Verkenner = ({ result }: { result: OpenFem3DSolveResult }) => {
      const [q, setQ] = useState<OpenFem3DPlateQuantity | null>(gekozen);
      return <OpenFem3DExplorer model={gebouw()} selection={null} setSelection={() => {}} result={result}
        visibility={DEFAULT_OPEN_FEM_3D_VISIBILITY} setVisibility={() => {}} activeTab="results"
        displayFlags={DEFAULT_DISPLAY_FLAGS} setDisplayFlags={() => {}} gridShow={false} setGridShow={() => {}}
        structuralGrid={DEFAULT_STRUCTURAL_GRID} setStructuralGridEnabled={() => {}} setDiagramLabels={() => {}}
        plateQuantity={q} setPlateQuantity={(next) => { gekozen = next; setQ(next); }} />;
    };
    mount(<Verkenner result={uitkomst()} />);
    await wacht();
    const keuze = container.querySelector<HTMLSelectElement>("[data-open-fem3d-plate-quantity] select");
    ok(keuze, "de keuzelijst Plaatresultaat");
    const opties = [...keuze!.options].map((optie) => optie.textContent ?? "");
    ok(opties.includes("Gronddruk (kN/m²)") && opties.includes("Zakking (in de grond) (mm)") && opties.some((o) => o.startsWith("Moment mxx")),
      `Gronddruk en Zakking naast de bestaande: ${opties.join(" | ")}`);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(keuze, "groundPressure");
    flushSync(() => keuze!.dispatchEvent(new Event("change", { bubbles: true })));
    await wacht();
    gelijk(gekozen, "groundPressure", "Gronddruk gekozen");
    mount(<Verkenner result={uitkomst(false)} />);
    await wacht();
    const zonder = [...container.querySelector<HTMLSelectElement>("[data-open-fem3d-plate-quantity] select")!.options].map((o) => o.value);
    ok(!zonder.includes("groundPressure") && !zonder.includes("settlement") && zonder.includes("mxx"), `zonder bedding niet: ${zonder.join(",")}`);
  });

  await test("rapport: de tabel Platen op bedding en de extremen p en s per plaat", async () => {
    mount(<OpenFem3DReport model={gebouw()} result={uitkomst()} />);
    await wacht();
    const sectie = container.querySelector("[data-open-fem3d-report-plate-bedding]");
    ok(sectie?.textContent?.includes("Platen op bedding"), "de kop");
    const rij = sectie!.querySelector("[data-open-fem3d-report-plate-bedding-row='1']")!.textContent ?? "";
    ok(rij.includes("20.000") && rij.includes("ja") && rij.includes("3") && rij.includes("60") && rij.includes("56,3 %") && rij.includes("480"),
      `k, alleen druk, s, p max, p min, zonder contact en ΣR: ${rij}`);
    ok(!sectie!.querySelector("[data-open-fem3d-report-plate-bedding-row='2']"), "de wand zonder bedding staat er niet in");
    const resultaten = container.querySelector("[data-open-fem3d-report-plates]")?.textContent ?? "";
    ok(resultaten.includes("Gronddruk") && resultaten.includes("Zakking (in de grond)"), "de extremen per plaat noemen gronddruk en zakking");
    mount(<OpenFem3DReport model={gebouw()} result={null} />);
    await wacht();
    ok(container.querySelector("[data-open-fem3d-report-plate-bedding-row='1']")?.textContent?.includes("—"), "zonder uitkomst: de invoer en streepjes");
  });
}

/** Beelden voor de schermafbeeldingen (geen proeven). */
async function toonBeeld(beeld: string) {
  const model = gebouw();
  const volledig = { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, grid: false, structuralGrid: false, levelMarks: false, nodeNumbers: false };
  if (beeld === "eigenschappen") {
    mount(<div style={{ padding: 8, background: "#fff", width: 340 }}>
      <Paneel begin={model} selectie={{ type: "plate", id: 1 }} />
    </div>);
    await wacht(200);
    // Alleen het blok Plaat op bedding in beeld.
    container.querySelector("[data-open-fem3d-plate-bedding-section]")?.scrollIntoView();
    return;
  }
  if (beeld === "arcering") {
    await toon(model, { ...volledig, loads: false }, ISO);
    await wacht(300);
    return;
  }
  if (beeld === "arcering-vlak") {
    await toon(model, { ...volledig, loads: false, plateDisplay: "surface" }, ISO);
    await wacht(300);
    return;
  }
  if (beeld === "gronddruk") {
    await toon(model, { ...volledig, loads: false, deformation: false, reactions: false, utilization: false }, ISO, uitkomst(), "groundPressure");
    await wacht(300);
  }
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el && !el.textContent) el.textContent = JSON.stringify({ tests, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, error: String(e?.stack ?? e) }); });

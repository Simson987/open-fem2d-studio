/**
 * Browserkant van test-open-fem3d-plaatweergave-ui.mjs: de plaatweergave
 * volume, vlak of mesh (issue #78) in het echte 3D-tekenvlak (ThreeFrameCanvas,
 * WebGL), het venster Zichtbaarheid, de verkenner en het lint, in een lokale
 * headless browser.
 *
 *  - Per stand, op een vloer van 8 × 6 m (0,3 m dik, middenvlak op z = 3 m)
 *    met een opening van 2 × 1,5 m: volume heeft de dikte (2,85 … 3,15 m);
 *    vlak en mesh liggen op het middenvlak zonder dikte; vlak heeft de omtrek
 *    en de opening als lijn (28 + 7 = 35 m); mesh heeft de elementlijnen van
 *    het echte rekennet op het middenvlak, volume en vlak niet.
 *  - Kiezen: een klik op de plaat kiest hem in elke stand, een klik in de
 *    opening niet; de selectie licht op, ook na een wissel van stand.
 *  - Snel pad: wisselen bouwt alleen de plaatlaag ("plate-display"), de
 *    overige objecten van de scène blijven dezelfde; het snelle pad tekent
 *    hetzelfde als een volledige opbouw in die stand.
 *  - Resultaatcontour: in vlak en mesh op het middenvlak; de plaat blijft
 *    onder de contour doorzichtig (0,15), ook na een wissel.
 *  - Vanaf 100 platen (GPU-batch): wisselen via het snelle pad, vlak en mesh
 *    zonder dikte (ook de gebundelde randen), kiezen en oplichten per stand.
 *  - Oppervlaktelast: het gevulde lastvlak ligt in elke stand alleen de marge
 *    (5 % van de dikte) buiten de getekende plaat, in vlak en mesh dus bij
 *    het middenvlak; het snelle pad vervangt de lastlaag bij een wissel van
 *    of naar volume (ook met een GPU-batch); de plaat eronder blijft kiesbaar.
 *  - Platen uit, stand wisselen, Platen aan: de nieuwe stand verschijnt.
 *  - Oude bewaarde zichtbaarheid met mesh: true tekent als mesh.
 *  - Venster, verkenner en lint: de keuzegroep direct onder Platen (geen
 *    schakelaar Mesh), kiezen met klik en pijltjestoets, gedimd met Platen
 *    uit, zoeken; drie lintknoppen, de actieve licht op.
 *
 * `#beeld=…` toont alleen een beeld voor een schermafbeelding: volume,
 * surface, mesh (de vloer, iso), lint, venster of verkenner.
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
import "../src/components/ribbon/Ribbon.css";
import ThreeFrameCanvas from "../src/components/openFem3d/ThreeFrameCanvas";
import OpenFem3DVisibilityDialog from "../src/components/openFem3d/OpenFem3DVisibilityDialog";
import ExplorerViewTab from "../src/components/fem/ExplorerViewTab";
import HomeTab from "../src/components/ribbon/HomeTab";
import { OPEN_FEM_3D_SUPPORT_PRESETS, parseOpenFem3DModel, type OpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import {
  DEFAULT_OPEN_FEM_3D_VISIBILITY, readOpenFem3DVisibility, type OpenFem3DVisibility,
} from "../src/components/openFem3d/openFem3dVisibility";
import { OPEN_FEM_3D_PLATE_DISPLAY_STYLES, type OpenFem3DPlateDisplay } from "../src/components/openFem3d/openFem3dPlateDisplay";
import { meshOpenFem3DPlates, type OpenFem3DPlateMesh } from "../src/components/openFem3d/openFem3dPlateMesh";
import { createOpenFem3DPlateGeometry } from "../src/components/openFem3d/openFem3dPlateGeometry";
import type { OpenFem3DCameraState } from "../src/components/openFem3d/openFem3dViewSets";
import type { OpenFem3DSelection } from "../src/components/openFem3d/openFem3dSelection";
import type { OpenFem3DSolveResult } from "../src/components/openFem3d/openFem3dSolver";
import type { OpenFem3DPlateQuantity } from "../src/components/openFem3d/openFem3dPlateResults";
import type { OpenFem3DUtilization } from "../src/components/openFem3d/openFem3dUtilization";
import { DEFAULT_DISPLAY_FLAGS } from "../src/components/fem/FemResultsOverlay";


// Ontwerp 0.4 (RibbonButton): een lintknop heeft geen title-attribuut meer. De
// uitleg staat in de eigen tooltip en, voor schermlezers, in aria-label als
// "<naam>. <uitleg>".
const lintUitleg = (b?: HTMLButtonElement | null): string => {
  const label = b?.querySelector(".ribbon-btn-label")?.textContent ?? "";
  const aria = b?.getAttribute("aria-label") ?? "";
  return aria.startsWith(`${label}. `) ? aria.slice(label.length + 2) : "";
};

// Synthetische PointerEvents hebben geen actieve aanwijzer om vast te houden.
Element.prototype.setPointerCapture = function () {};
Element.prototype.releasePointerCapture = function () {};

// De renderer, scène en camera waarmee het tekenvlak echt tekent (zoals in
// open-fem3d-symboolschaal-browser.tsx).
let renderCamera: THREE.Camera | null = null;
let renderScene: THREE.Object3D | null = null;
let renderRenderer: THREE.WebGLRenderer | null = null;
Object.defineProperty(THREE.WebGLRenderer.prototype, "render", {
  configurable: true,
  set(this: THREE.WebGLRenderer, fn: (scene: THREE.Object3D, camera: THREE.Camera) => void) {
    Object.defineProperty(this, "render", {
      configurable: true, writable: true,
      value: (scene: THREE.Object3D, cam: THREE.Camera) => {
        renderCamera = cam; renderScene = scene; renderRenderer = this;
        return fn.call(this, scene, cam);
      },
    });
  },
});

const BREED = 1000;
const HOOG = 700;
const tests: { name: string; error?: string }[] = [];
const info: string[] = [];
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

/* ── Modellen ─────────────────────────────────────────────────────────── */

/**
 * Vloer van 8 × 6 m, 0,3 m dik, middenvlak op z = 3 m, met een opening van
 * 2 × 1,5 m (x 3 … 5, y 2 … 3,5) en vier kolommen HEA 200 op de hoeken.
 */
const vloer: OpenFem3DModel = parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 3 }, { id: 2, x: 8, y: 0, z: 3 }, { id: 3, x: 8, y: 6, z: 3 }, { id: 4, x: 0, y: 6, z: 3 },
    { id: 5, x: 3, y: 2, z: 3 }, { id: 6, x: 5, y: 2, z: 3 }, { id: 7, x: 5, y: 3.5, z: 3 }, { id: 8, x: 3, y: 3.5, z: 3 },
    { id: 9, x: 0, y: 0, z: 0 }, { id: 10, x: 8, y: 0, z: 0 }, { id: 11, x: 8, y: 6, z: 0 }, { id: 12, x: 0, y: 6, z: 0 },
  ],
  beams: [
    { id: 1, startNodeId: 9, endNodeId: 1, profileName: "HEA 200", material: "S235" },
    { id: 2, startNodeId: 10, endNodeId: 2, profileName: "HEA 200", material: "S235" },
    { id: 3, startNodeId: 11, endNodeId: 3, profileName: "HEA 200", material: "S235" },
    { id: 4, startNodeId: 12, endNodeId: 4, profileName: "HEA 200", material: "S235" },
  ],
  supports: [9, 10, 11, 12].map((nodeId) => ({ nodeId, ...OPEN_FEM_3D_SUPPORT_PRESETS.fixed })),
  plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.3, material: "C30/37", openings: [{ id: 1, nodeIds: [5, 6, 7, 8] }] }],
});
/** Vloer van 12 × 12 m op z = 3 m zonder opening, voor de contour. */
const contourVloer: OpenFem3DModel = parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 3 }, { id: 2, x: 12, y: 0, z: 3 }, { id: 3, x: 12, y: 12, z: 3 }, { id: 4, x: 0, y: 12, z: 3 }],
  beams: [],
  supports: [{ nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.pinned }],
  plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.3, material: "C30/37" }],
});
/** 10 × 10 platen van 1 × 1 m (0,2 m dik) op z = 0: één GPU-batch. */
const raster: OpenFem3DModel = (() => {
  const id = (i: number, j: number) => i * 11 + j + 1;
  const nodes = [];
  for (let i = 0; i <= 10; i += 1) for (let j = 0; j <= 10; j += 1) nodes.push({ id: id(i, j), x: j, y: i, z: 0 });
  const plates = [];
  for (let i = 0; i < 10; i += 1) for (let j = 0; j < 10; j += 1) {
    plates.push({ id: i * 10 + j + 1, nodeIds: [id(i, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j)], thicknessM: 0.2, material: "C30/37" });
  }
  return parseOpenFem3DModel({ nodes, beams: [], plates });
})();
/** De vloer met een oppervlaktelast van 5 kN/m² omlaag. */
const belasteVloer: OpenFem3DModel = parseOpenFem3DModel({ ...vloer, surfaceLoads: [{ id: 1, plateId: 1, qx: 0, qy: 0, qz: -5 }] });
/** Het raster (GPU-batch) met een oppervlaktelast van 5 kN/m² omlaag op plaat 35. */
const belastRaster: OpenFem3DModel = parseOpenFem3DModel({ ...raster, surfaceLoads: [{ id: 1, plateId: 35, qx: 0, qy: 0, qz: -5 }] });
/**
 * Een verzonnen resultaat, alleen voor de weergave (zoals in
 * open-fem3d-symboolschaal-browser.tsx): een net van n × n elementen over
 * plaat 1 (L × L m, op hoogte z) met een doorbuiging w als sinusbult.
 */
function plaatResultaat(L: number, n: number, z: number): { result: OpenFem3DSolveResult; plateQuantity: OpenFem3DPlateQuantity } {
  const nodes: { id: number; x: number; y: number; z: number }[] = [];
  const shellNodes: { nodeId: number; plateId: number; wM: number }[] = [];
  const elements: { id: number; plateId: number; nodeIds: number[] }[] = [];
  const id = (i: number, j: number) => 1000 + i * (n + 1) + j;
  for (let i = 0; i <= n; i += 1) for (let j = 0; j <= n; j += 1) {
    nodes.push({ id: id(i, j), x: L * j / n, y: L * i / n, z });
    shellNodes.push({ nodeId: id(i, j), plateId: 1, wM: -0.001 * Math.sin(Math.PI * i / n) * Math.sin(Math.PI * j / n) });
  }
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) {
    elements.push({ id: elements.length + 1, plateId: 1, nodeIds: [id(i, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j)] });
  }
  const result = {
    schemaVersion: 2, engine: { id: "proef", name: "proef", revision: "proef", license: "proef" }, analysis: "linear",
    displacements: [], reactions: [], memberForces: [], buckling: { modes: [] }, diagnostics: [],
    shellNodes, plates: [], shellElements: [],
    plateMesh: { nodes, elements, beamIntermediateNodes: new Map(), plateEdgeNodes: new Map(), plates: [], notices: [] },
  } as unknown as OpenFem3DSolveResult;
  return { result, plateQuantity: "w" };
}

/* ── Opstelling ───────────────────────────────────────────────────────── */

// Eén vaste lege lijst: anders neemt het tekenvlak nooit een snel pad.
const GEEN_BENUTTINGEN: OpenFem3DUtilization[] = [];
let selectie: OpenFem3DSelection = null;
let huidigZicht: OpenFem3DVisibility = DEFAULT_OPEN_FEM_3D_VISIBILITY;
let zetZicht: (zicht: OpenFem3DVisibility) => void = () => {};
interface Extra {
  camera?: OpenFem3DCameraState;
  plateMesh?: OpenFem3DPlateMesh | null;
  resultaat?: { result: OpenFem3DSolveResult; plateQuantity: OpenFem3DPlateQuantity };
}
function Tekenvlak({ model, zicht: beginZicht, extra }: { model: OpenFem3DModel; zicht: OpenFem3DVisibility; extra: Extra }) {
  const [zicht, setZicht] = useState(beginZicht);
  const [sel, setSel] = useState<OpenFem3DSelection>(null);
  zetZicht = (next) => flushSync(() => setZicht(next));
  return <div className="open-fem3d-stage" style={{ width: BREED, height: HOOG, flex: "none" }}>
    <ThreeFrameCanvas model={model} onChange={() => {}} tool="select" selection={sel}
      onSelect={(next) => { selectie = next; setSel(next); }}
      fitToken={0} visibility={zicht} utilizations={GEEN_BENUTTINGEN}
      result={extra.resultaat?.result ?? null} plateQuantity={extra.resultaat?.plateQuantity ?? null}
      // Zoals de editor: het rekennet zonder resultaat alleen in de stand mesh.
      plateMesh={zicht.plateDisplay === "mesh" && zicht.plates ? extra.plateMesh ?? null : null}
      cameraRequest={extra.camera ? { state: extra.camera, token: 1 } : undefined}
      viewRequest={extra.camera ? undefined : { kind: "iso", token: 1 }} />
  </div>;
}
async function toon(model: OpenFem3DModel, zicht: OpenFem3DVisibility, extra: Extra = {}) {
  selectie = null;
  huidigZicht = zicht;
  mount(<Tekenvlak model={model} zicht={zicht} extra={extra} />);
  await wacht(250);
}
async function zet(zicht: OpenFem3DVisibility) {
  huidigZicht = zicht;
  zetZicht(zicht);
  await wacht(60);
}
/** Een andere plaatweergave kiezen (dezelfde stand: niets, zoals de keuzegroep en het lint). */
const stand = async (plateDisplay: OpenFem3DPlateDisplay) => {
  if (huidigZicht.plateDisplay !== plateDisplay) await zet({ ...huidigZicht, plateDisplay });
};

const tekenvlakEl = () => container.querySelector(".open-fem3d-canvas") as HTMLDivElement;
const canvasEl = () => container.querySelector("canvas") as HTMLCanvasElement;
const bouwwijze = () => tekenvlakEl().dataset.openFem3dBuildMode;
const geschiedenis = () => tekenvlakEl().dataset.openFem3dBuildHistory ?? "";
/** De laatste n bouwwijzen (de geschiedenis houdt er acht bij). */
const laatste = (n: number) => geschiedenis().split(",").slice(-n);

/** Recht van boven, parallel: de hele vloer van 8 × 6 m in beeld. */
const BOVEN: OpenFem3DCameraState = { position: [4, 3, 40], target: [4, 3, 3], up: [0, 1, 0], orthoHalfHeight: 4 };
const BOVEN_CONTOUR: OpenFem3DCameraState = { position: [6, 6, 40], target: [6, 6, 3], up: [0, 1, 0], orthoHalfHeight: 7 };
const BOVEN_RASTER: OpenFem3DCameraState = { position: [5, 5, 40], target: [5, 5, 0], up: [0, 1, 0], orthoHalfHeight: 6 };
const basis: OpenFem3DVisibility = {
  ...DEFAULT_OPEN_FEM_3D_VISIBILITY, perspective: false, grid: false, axes: false, structuralGrid: false, levelMarks: false,
  nodeNumbers: false, viewCube: false,
};

/* ── Scène lezen ──────────────────────────────────────────────────────── */

/** De plaatvlakken (geen randlijnen): losse platen of GPU-batches. */
function plaatVlakken(): THREE.Mesh[] {
  const uit: THREE.Mesh[] = [];
  renderScene!.traverse((o) => { if (o.userData.type === "plate" && (o as THREE.Mesh).isMesh) uit.push(o as THREE.Mesh); });
  return uit;
}
/** De scènegroep met de modelobjecten (waar de platen in hangen). */
function scenegroep(): THREE.Object3D {
  let groep: THREE.Object3D | null = null;
  renderScene!.traverse((o) => { if (o.userData.openFem3dConditions === true) groep = o.parent; });
  ok(groep, "scènegroep");
  return groep!;
}
const isPlaatlaag = (o: THREE.Object3D) => o.userData.type === "plate" || o.userData.openFem3dPlateEdges === true;
/** Hoogte (z) van alle punten van een object en zijn kinderen, in wereldcoördinaten (zonder instanties). */
function zBereik(object: THREE.Object3D): { min: number; max: number } {
  object.updateWorldMatrix(true, true);
  let min = Infinity, max = -Infinity;
  object.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    const pos = g?.getAttribute("position");
    if (!pos) return;
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      min = Math.min(min, p.z); max = Math.max(max, p.z);
    }
  });
  return { min, max };
}
/** Lengte van de randlijnen (LineSegments) onder een object. */
function randLengte(object: THREE.Object3D): number {
  object.updateWorldMatrix(true, true);
  let lengte = 0;
  object.traverse((o) => {
    if (!(o instanceof THREE.LineSegments)) return;
    const pos = o.geometry.getAttribute("position");
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let i = 0; i + 1 < pos.count; i += 2) {
      a.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, i + 1).applyMatrix4(o.matrixWorld);
      lengte += a.distanceTo(b);
    }
  });
  return lengte;
}
const plaatlaag = () => renderScene!.getObjectByName("open-fem3d-plate-overlay");
const meshLijnen = () => (plaatlaag()?.children ?? []).filter((c) => c.userData.openFem3dPlateMesh !== undefined) as THREE.LineSegments[];
const contouren = () => (plaatlaag()?.children ?? []).filter((c) => c.userData.openFem3dPlateContour !== undefined) as THREE.Mesh[];
const materiaal = (m: THREE.Mesh) => m.material as THREE.MeshStandardMaterial;
/** De dekking van de gewone plaatvlakken (onder een contour 0,15). */
const plaatDekking = () => plaatVlakken().map((m) => materiaal(m).opacity);
/** Unieke elementranden van een net (zoals de plaatlaag ze tekent). */
function elementRanden(net: OpenFem3DPlateMesh): number {
  const randen = new Set<string>();
  for (const e of net.elements) for (let k = 0; k < 4; k += 1) {
    const a = e.nodeIds[k], b = e.nodeIds[(k + 1) % 4];
    randen.add(a < b ? `${a}-${b}` : `${b}-${a}`);
  }
  return randen.size;
}

/** Een klik op het scherm boven wereldpunt p. */
function klikWereld(p: THREE.Vector3) {
  ok(renderCamera && renderRenderer, "er is getekend");
  const canvas = canvasEl();
  const rect = canvas.getBoundingClientRect();
  const n = p.clone().project(renderCamera!);
  const clientX = rect.left + (n.x + 1) / 2 * rect.width;
  const clientY = rect.top + (1 - n.y) / 2 * rect.height;
  for (const [type, knoppen] of [["pointerdown", 1], ["pointerup", 0]] as const) {
    flushSync(() => canvas.dispatchEvent(new PointerEvent(type, {
      clientX, clientY, button: 0, buttons: knoppen, pointerId: 1, pointerType: "mouse", bubbles: true, cancelable: true,
    })));
  }
}

const S = OPEN_FEM_3D_PLATE_DISPLAY_STYLES;
const STANDEN: OpenFem3DPlateDisplay[] = ["volume", "surface", "mesh"];

/* ── Proeven ──────────────────────────────────────────────────────────── */

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", resources: { nl: { common, ribbon } }, defaultNS: "common", initImmediate: false,
  });
  // Het echte rekennet van de vloer (rechthoek met rechthoekige opening: een
  // gestructureerd raster, zonder Triangle), zoals de editor het levert.
  const net = await meshOpenFem3DPlates(vloer);
  const hash = new URLSearchParams(location.hash.slice(1));
  const beeld = hash.get("beeld");
  if (beeld) { await toonBeeld(beeld, net); return; }
  info.push(`rekennet van de vloer: ${net.elements.length} elementen, ${elementRanden(net)} randen`);

  await test("volume: de plaat heeft haar dikte (2,85 … 3,15 m); geen elementlijnen, ook met een rekennet erbij", async () => {
    await toon(vloer, { ...basis, plateDisplay: "volume" }, { camera: BOVEN, plateMesh: net });
    gelijk(tekenvlakEl().dataset.openFem3dPlateDisplay, "volume", "diagnose");
    const [plaat] = plaatVlakken();
    gelijk(plaatVlakken().length, 1, "één plaatvlak");
    const z = zBereik(plaat!);
    ongeveer(z.min, 2.85, 1e-5, "onderkant");
    ongeveer(z.max, 3.15, 1e-5, "bovenkant");
    gelijk(materiaal(plaat!).opacity, 0.7, "dekking zoals voorheen");
    gelijk(meshLijnen().length, 0, "geen elementlijnen");
    gelijk(tekenvlakEl().dataset.openFem3dPlateOverlay, "none", "plaatlaag zonder net");
  });

  await test("vlak: alleen het middenvlak (z = 3 m), halfdoorzichtig, omtrek en opening als lijn (35 m); geen elementlijnen", async () => {
    await toon(vloer, { ...basis, plateDisplay: "volume" }, { camera: BOVEN, plateMesh: net });
    await stand("surface");
    gelijk(bouwwijze(), "plate-display", "snel pad");
    gelijk(tekenvlakEl().dataset.openFem3dPlateDisplay, "surface", "diagnose");
    const [plaat] = plaatVlakken();
    const z = zBereik(plaat!);
    ongeveer(z.min, 3, 1e-6, "onderkant op het middenvlak");
    ongeveer(z.max, 3, 1e-6, "bovenkant op het middenvlak");
    gelijk(materiaal(plaat!).opacity, S.surface.opacity, "halfdoorzichtig");
    ok(materiaal(plaat!).opacity < 0.7, "doorzichtiger dan het volume");
    ongeveer(randLengte(plaat!), 35, 1e-4, "omtrek 28 m + opening 7 m");
    gelijk(meshLijnen().length, 0, "geen elementlijnen");
  });

  await test("mesh: de elementlijnen van het rekennet op het middenvlak, met een licht gevuld vlak eronder", async () => {
    await toon(vloer, { ...basis, plateDisplay: "volume" }, { camera: BOVEN, plateMesh: net });
    await stand("mesh");
    gelijk(bouwwijze(), "plate-display", "snel pad");
    const [plaat] = plaatVlakken();
    const z = zBereik(plaat!);
    ongeveer(z.max - z.min, 0, 1e-6, "geen dikte");
    ongeveer(z.min, 3, 1e-6, "op het middenvlak");
    gelijk(materiaal(plaat!).opacity, S.mesh.opacity, "licht gevuld");
    ok(materiaal(plaat!).opacity < S.surface.opacity, "lichter dan vlak");
    const lijnen = meshLijnen();
    gelijk(lijnen.length, 1, "één lijnlaag met elementranden");
    const zl = zBereik(lijnen[0]!);
    ongeveer(zl.min, 3, 1e-6, "lijnen onder");
    ongeveer(zl.max, 3, 1e-6, "lijnen boven: op het middenvlak, niet op ± t/2");
    gelijk(lijnen[0]!.geometry.getAttribute("position").count / 2, elementRanden(net), "elke elementrand één keer");
    gelijk(tekenvlakEl().dataset.openFem3dPlateOverlay, "mesh", "plaatlaag met net");
    // Terug naar vlak: de lijnen gaan weg.
    await stand("surface");
    gelijk(meshLijnen().length, 0, "vlak: weer zonder elementlijnen");
  });

  await test("wisselen raakt alleen de plaatlaag: de overige objecten blijven dezelfde, nooit een volledige opbouw", async () => {
    await toon(vloer, { ...basis, plateDisplay: "volume" }, { camera: BOVEN, plateMesh: net });
    for (const volgende of ["surface", "mesh", "volume", "mesh", "surface", "volume"] as const) {
      const groep = scenegroep();
      const voor = groep.children.filter((o) => !isPlaatlaag(o));
      const oudePlaten = groep.children.filter(isPlaatlaag);
      await stand(volgende);
      gelijk(bouwwijze(), "plate-display", `${volgende}: snel pad`);
      const na = scenegroep().children.filter((o) => !isPlaatlaag(o));
      gelijk(na.length, voor.length, `${volgende}: aantal overige objecten`);
      ok(na.every((o, i) => o === voor[i]), `${volgende}: dezelfde overige objecten`);
      ok(scenegroep().children.filter(isPlaatlaag).every((o) => !oudePlaten.includes(o)), `${volgende}: nieuwe plaatobjecten`);
    }
    gelijk(laatste(6), new Array(6).fill("plate-display"), "zes wissels, geen volledige opbouw");
  });

  await test("het snelle pad tekent hetzelfde als een volledige opbouw in die stand", async () => {
    const beschrijf = () => plaatVlakken().map((m) => {
      const g = m.geometry;
      const z = zBereik(m);
      return {
        punten: g.getAttribute("position").count, index: g.getIndex()?.count ?? 0, z: [z.min.toFixed(5), z.max.toFixed(5)],
        dekking: materiaal(m).opacity, kleur: materiaal(m).color.getHex(), terug: materiaal(m).polygonOffset,
        rand: randLengte(m).toFixed(4), lijnen: meshLijnen().map((l) => l.geometry.getAttribute("position").count),
      };
    });
    for (const doel of ["surface", "mesh"] as const) {
      await toon(vloer, { ...basis, plateDisplay: "volume" }, { camera: BOVEN, plateMesh: net });
      await stand(doel);
      gelijk(bouwwijze(), "plate-display", `${doel}: snel pad`);
      const snel = beschrijf();
      await toon(vloer, { ...basis, plateDisplay: doel }, { camera: BOVEN, plateMesh: net });
      ok(/full/.test(bouwwijze() ?? ""), `${doel}: volledige opbouw`);
      gelijk(snel, beschrijf(), `${doel}: snel = volledig`);
    }
  });

  await test("kiezen: een klik op de plaat kiest hem in elke stand, een klik in de opening niet; de selectie licht op", async () => {
    await toon(vloer, { ...basis, plateDisplay: "volume" }, { camera: BOVEN, plateMesh: net });
    for (const s of STANDEN) {
      await stand(s);
      selectie = null;
      klikWereld(new THREE.Vector3(1.5, 1.5, 3));
      await wacht();
      gelijk(selectie, { type: "plate", id: 1 }, `${s}: klik op de plaat`);
      const [plaat] = plaatVlakken();
      gelijk(materiaal(plaat!).color.getHex(), 0xffa31a, `${s}: oplichtkleur`);
      gelijk(materiaal(plaat!).opacity, S[s].selectionOpacity, `${s}: dekking geselecteerd`);
      // In de opening ligt geen plaat: de selectie gaat eraf.
      klikWereld(new THREE.Vector3(4, 2.75, 3));
      await wacht();
      gelijk(selectie, null, `${s}: klik in de opening`);
      gelijk(materiaal(plaatVlakken()[0]!).color.getHex(), S[s].color, `${s}: weer de gewone kleur`);
    }
  });

  await test("een geselecteerde plaat blijft oplichten na een wissel van stand", async () => {
    await toon(vloer, { ...basis, plateDisplay: "volume" }, { camera: BOVEN, plateMesh: net });
    klikWereld(new THREE.Vector3(6.5, 4.5, 3));
    await wacht();
    gelijk(selectie, { type: "plate", id: 1 }, "gekozen");
    for (const s of ["surface", "mesh", "volume"] as const) {
      await stand(s);
      const [plaat] = plaatVlakken();
      gelijk(materiaal(plaat!).color.getHex(), 0xffa31a, `${s}: oplichtkleur`);
      gelijk(materiaal(plaat!).opacity, S[s].selectionOpacity, `${s}: dekking geselecteerd`);
    }
  });

  await test("resultaatcontour: in elke stand op het middenvlak; vlak en mesh zonder dikte; de plaat eronder doorzichtig", async () => {
    const resultaat = plaatResultaat(12, 24, 3);
    const zicht = { ...basis, deformation: false, reactions: false };
    for (const s of STANDEN) {
      await toon(contourVloer, { ...zicht, plateDisplay: s }, { camera: BOVEN_CONTOUR, resultaat });
      gelijk(tekenvlakEl().dataset.openFem3dPlateOverlay, "contour:w", `${s}: contour`);
      const [contour] = contouren();
      ok(contour, `${s}: contourvlak`);
      const zc = zBereik(contour!);
      ongeveer(zc.min, 3, 1e-6, `${s}: contour op het middenvlak (onder)`);
      ongeveer(zc.max, 3, 1e-6, `${s}: contour op het middenvlak (boven)`);
      const zp = zBereik(plaatVlakken()[0]!);
      ongeveer(zp.max - zp.min, s === "volume" ? 0.3 : 0, 1e-5, `${s}: dikte van de plaat`);
      gelijk(plaatDekking(), [0.15], `${s}: de plaat onder de contour`);
      gelijk(meshLijnen().length, s === "mesh" ? 1 : 0, `${s}: elementlijnen`);
      if (s === "mesh") {
        const zl = zBereik(meshLijnen()[0]!);
        ongeveer(zl.max - zl.min, 0, 1e-6, "mesh: lijnen op de contour");
      }
    }
    // Wisselen met de contour erbij: snel pad, de contour blijft en de plaat doorzichtig.
    await toon(contourVloer, { ...zicht, plateDisplay: "volume" }, { camera: BOVEN_CONTOUR, resultaat });
    for (const s of ["mesh", "surface", "volume"] as const) {
      await stand(s);
      gelijk(bouwwijze(), "plate-display", `${s}: snel pad`);
      gelijk(tekenvlakEl().dataset.openFem3dPlateOverlay, "contour:w", `${s}: contour na de wissel`);
      gelijk(plaatDekking(), [0.15], `${s}: doorzichtig na de wissel`);
    }
  });

  await test("100 platen (GPU-batch): wisselen via het snelle pad; vlak en mesh zonder dikte, ook de randen; kiezen per stand", async () => {
    await toon(raster, { ...basis, plateDisplay: "volume" }, { camera: BOVEN_RASTER });
    const batch = () => {
      const b = plaatVlakken().filter((m) => m instanceof THREE.InstancedMesh) as THREE.InstancedMesh[];
      gelijk(b.length, 1, "één batch");
      gelijk(plaatVlakken().length, 1, "alleen de batch");
      return b[0]!;
    };
    const randen = () => scenegroep().children.filter((o) => o.userData.openFem3dPlateEdges === true);
    const dikte = (m: THREE.InstancedMesh) => {
      m.geometry.computeBoundingBox();
      return m.geometry.boundingBox!.max.z - m.geometry.boundingBox!.min.z;
    };
    ongeveer(dikte(batch()), 0.2, 1e-6, "volume: 0,2 m");
    gelijk(batch().count, 100, "100 instanties");
    for (const s of ["surface", "mesh", "volume", "surface"] as const) {
      const overige = scenegroep().children.filter((o) => !isPlaatlaag(o));
      await stand(s);
      gelijk(bouwwijze(), "plate-display", `${s}: snel pad`);
      const na = scenegroep().children.filter((o) => !isPlaatlaag(o));
      ok(na.length === overige.length && na.every((o, i) => o === overige[i]), `${s}: overige objecten blijven`);
      const b = batch();
      ongeveer(dikte(b), s === "volume" ? 0.2 : 0, 1e-6, `${s}: dikte`);
      gelijk((b.material as THREE.MeshStandardMaterial).opacity, S[s].opacity, `${s}: dekking`);
      gelijk(randen().length, 1, `${s}: één gebundelde randlaag`);
      const zr = zBereik(randen()[0]!);
      ongeveer(zr.min, s === "volume" ? -0.1 : 0, 1e-6, `${s}: randen onder`);
      ongeveer(zr.max, s === "volume" ? 0.1 : 0, 1e-6, `${s}: randen boven`);
      // Kiezen: plaat 35 (rij 3, kolom 4: midden op x 4,5 en y 3,5).
      selectie = null;
      klikWereld(new THREE.Vector3(4.5, 3.5, s === "volume" ? 0.1 : 0));
      await wacht();
      gelijk(selectie, { type: "plate", id: 35 }, `${s}: plaat 35 gekozen`);
      const index = (b.userData.instanceIndexById as Map<number, number>).get(35)!;
      const kleur = new THREE.Color();
      b.getColorAt(index, kleur);
      gelijk(kleur.getHex(), 0xffa31a, `${s}: plaat 35 licht op`);
      b.getColorAt((index + 1) % 100, kleur);
      gelijk(kleur.getHex(), S[s].color, `${s}: een andere plaat niet`);
    }
    gelijk(laatste(4), new Array(4).fill("plate-display"), "vier wissels, geen volledige opbouw");
  });

  await test("oppervlaktelast: het lastvlak ligt in elke stand 0,015 m buiten de getekende plaat; van of naar volume zet het snelle pad het mee", async () => {
    const lastVlakken = () => {
      const uit: THREE.Mesh[] = [];
      renderScene!.traverse((o) => { if (o.userData.openFem3dLoadSurface === true && o.userData.type === "surfaceLoad") uit.push(o as THREE.Mesh); });
      return uit;
    };
    const lastlaag = () => scenegroep().children.find((o) => o.userData.openFem3dSurfaceLoads === true);
    // Vloer 0,3 m dik: marge 5 % = 0,015 m. Volume: bovenzijde 3,15 m, lastvlak
    // 3,165 m; vlak en mesh: middenvlak 3 m, lastvlak 3,015 m.
    const afstand = (s: OpenFem3DPlateDisplay) => {
      const vlakken = lastVlakken();
      gelijk(vlakken.length, 1, `${s}: één lastvlak`);
      const zl = zBereik(vlakken[0]!);
      ongeveer(zl.max - zl.min, 0, 1e-6, `${s}: lastvlak zonder dikte`);
      const zp = zBereik(plaatVlakken()[0]!);
      ongeveer(zl.min - zp.max, 0.015, 1e-5, `${s}: afstand lastvlak tot de getekende bovenzijde`);
      ongeveer(zl.min, s === "volume" ? 3.165 : 3.015, 1e-5, `${s}: hoogte lastvlak`);
    };
    // Een klikpunt op de plaat, ver van de lastpijl (die staat op het ankerpunt).
    const anker = createOpenFem3DPlateGeometry(belasteVloer, belasteVloer.plates![0]!, undefined, "volume")!.surfaceAnchor;
    const klikpunt = [new THREE.Vector3(1, 1, 3), new THREE.Vector3(7, 5, 3)]
      .sort((a, b) => b.distanceTo(anker) - a.distanceTo(anker))[0]!;
    for (const s of STANDEN) {
      await toon(belasteVloer, { ...basis, plateDisplay: s }, { camera: BOVEN, plateMesh: net });
      ok(/full/.test(bouwwijze() ?? ""), `${s}: volledige opbouw`);
      afstand(s);
    }
    await toon(belasteVloer, { ...basis, plateDisplay: "volume" }, { camera: BOVEN, plateMesh: net });
    const wissels = [["surface", true], ["mesh", false], ["volume", true], ["mesh", true], ["surface", false]] as const;
    for (const [volgende, vervangen] of wissels) {
      const oudeLaag = lastlaag();
      ok(oudeLaag, `${volgende}: lastlaag vooraf`);
      const overige = scenegroep().children.filter((o) => !isPlaatlaag(o) && o !== oudeLaag);
      await stand(volgende);
      gelijk(bouwwijze(), "plate-display", `${volgende}: snel pad`);
      afstand(volgende);
      gelijk(lastlaag() !== oudeLaag, vervangen, `${volgende}: lastlaag ${vervangen ? "vervangen" : "blijft staan"}`);
      const na = scenegroep().children.filter((o) => !isPlaatlaag(o) && o !== lastlaag());
      ok(na.length === overige.length && na.every((o, i) => o === overige[i]), `${volgende}: overige objecten blijven`);
      // Het lastvlak laat de klik door: de plaat eronder blijft kiesbaar.
      selectie = null;
      klikWereld(klikpunt);
      await wacht();
      gelijk(selectie, { type: "plate", id: 1 }, `${volgende}: de plaat onder het lastvlak kiesbaar`);
    }
    // GPU-batch (100 platen van 0,2 m): marge 0,01 m; volume bovenzijde 0,1 m.
    await toon(belastRaster, { ...basis, plateDisplay: "volume" }, { camera: BOVEN_RASTER });
    for (const s of ["volume", "surface", "mesh", "volume"] as const) {
      if (s !== huidigZicht.plateDisplay) {
        await stand(s);
        gelijk(bouwwijze(), "plate-display", `batch ${s}: snel pad`);
      }
      const vlakken = lastVlakken();
      gelijk(vlakken.length, 1, `batch ${s}: één lastvlak`);
      const zl = zBereik(vlakken[0]!);
      ongeveer(zl.min, (s === "volume" ? 0.1 : 0) + 0.01, 1e-5, `batch ${s}: lastvlak 0,01 m boven de getekende plaat`);
      ongeveer(zl.max, zl.min, 1e-6, `batch ${s}: lastvlak zonder dikte`);
    }
  });

  await test("Platen uit, stand wisselen, Platen aan: de nieuwe stand verschijnt en is kiesbaar", async () => {
    await toon(vloer, { ...basis, plateDisplay: "volume" }, { camera: BOVEN, plateMesh: net });
    await zet({ ...huidigZicht, plates: false });
    gelijk(bouwwijze(), "plate-visibility", "Platen uit");
    await stand("surface");
    gelijk(bouwwijze(), "plate-display", "wissel met de platen uit");
    ok(plaatVlakken().every((m) => !m.visible), "verborgen gebleven");
    klikWereld(new THREE.Vector3(1.5, 1.5, 3));
    await wacht();
    gelijk(selectie, null, "verborgen: niet kiesbaar");
    await zet({ ...huidigZicht, plates: true });
    gelijk(bouwwijze(), "plate-visibility", "Platen aan: snel pad");
    const [plaat] = plaatVlakken();
    ok(plaat!.visible, "zichtbaar");
    const z = zBereik(plaat!);
    ongeveer(z.max - z.min, 0, 1e-6, "als vlak, zonder dikte");
    klikWereld(new THREE.Vector3(1.5, 1.5, 3));
    await wacht();
    gelijk(selectie, { type: "plate", id: 1 }, "kiesbaar");
    gelijk(laatste(3), ["plate-visibility", "plate-display", "plate-visibility"], "geen volledige opbouw");
  });

  await test("een oude bewaarde zichtbaarheid met mesh: true tekent de plaat als mesh", async () => {
    const SLEUTEL = "open-fem-studio.openFem3d.visibility";
    const vorige = localStorage.getItem(SLEUTEL);
    try {
      localStorage.setItem(SLEUTEL, JSON.stringify({ ...basis, plateDisplay: undefined, mesh: true }));
      const zicht = readOpenFem3DVisibility();
      gelijk(zicht.plateDisplay, "mesh", "overgenomen");
      ok(!("mesh" in zicht), "geen mesh meer in de zichtbaarheid");
      await toon(vloer, zicht, { camera: BOVEN, plateMesh: net });
      gelijk(meshLijnen().length, 1, "elementlijnen");
      const z = zBereik(plaatVlakken()[0]!);
      ongeveer(z.max - z.min, 0, 1e-6, "zonder dikte");
    } finally {
      if (vorige === null) localStorage.removeItem(SLEUTEL); else localStorage.setItem(SLEUTEL, vorige);
    }
  });

  await test("venster Zichtbaarheid: de keuze direct onder Platen, geen schakelaar Mesh; klik, pijltjestoets en Standaard", async () => {
    let zicht: OpenFem3DVisibility = { ...DEFAULT_OPEN_FEM_3D_VISIBILITY };
    const Venster = () => {
      const [v, setV] = useState(zicht);
      return <OpenFem3DVisibilityDialog open onClose={() => {}} visibility={v} onChange={(next) => { zicht = next; setV(next); }}
        viewSets={[]} currentView="iso" currentCamera={{ position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1] }}
        currentCombinationId={null} currentLoadCaseId={1} currentMode="model" combinationOptions={[]} loadCaseOptions={[]} />;
    };
    mount(<Venster />);
    const venster = () => document.querySelector(".open-fem3d-visibility-dialog")!;
    gelijk(venster().querySelectorAll('[data-vlag="mesh"]').length, 0, "geen schakelaar Mesh");
    const groep = () => venster().querySelector<HTMLElement>('[role="radiogroup"].open-fem3d-plate-display')!;
    ok(groep(), "keuzegroep");
    gelijk((groep().previousElementSibling as HTMLElement | null)?.dataset.vlag, "plates", "direct onder Platen");
    const opties = () => [...groep().querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    gelijk(opties().map((b) => b.textContent), ["Volume", "Vlak", "Mesh"], "drie opties");
    gelijk(opties().map((b) => b.getAttribute("aria-checked")), ["true", "false", "false"], "standaard volume");
    flushSync(() => opties()[1]!.click());
    gelijk(zicht.plateDisplay, "surface", "klik op Vlak");
    gelijk(opties().map((b) => b.getAttribute("aria-checked")), ["false", "true", "false"], "Vlak gekozen");
    ok(opties()[1]!.classList.contains("active"), "Vlak licht op");
    flushSync(() => groep().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    gelijk(zicht.plateDisplay, "mesh", "pijl rechts: Mesh");
    flushSync(() => groep().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    gelijk(zicht.plateDisplay, "volume", "pijl rechts rondt af: Volume");
    flushSync(() => groep().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    gelijk(zicht.plateDisplay, "mesh", "pijl links: Mesh");
    // Platen uit: de keuze blijft staan maar gedimd.
    flushSync(() => venster().querySelector<HTMLButtonElement>('[data-vlag="plates"]')!.click());
    gelijk(zicht.plates, false, "Platen uit");
    ok(groep().classList.contains("uit"), "gedimd");
    gelijk(zicht.plateDisplay, "mesh", "keuze bewaard");
    const standaard = [...document.querySelectorAll<HTMLButtonElement>(".open-fem3d-visibility-dialog .modal-footer button")]
      .find((b) => b.textContent === i18next.t("zichtbaarheid.standaard"))!;
    flushSync(() => standaard.click());
    gelijk([zicht.plates, zicht.plateDisplay], [true, "volume"], "Standaard: Platen aan, volume");
    mount(null);
  });

  await test("verkenner: de keuze direct onder Platen; klik zet de stand; gedimd met Platen uit; zoeken op 'mesh' en 'vlak'", async () => {
    let zicht: OpenFem3DVisibility = { ...DEFAULT_OPEN_FEM_3D_VISIBILITY };
    const Verkenner = () => {
      const [v, setV] = useState(zicht);
      return <div style={{ width: 240 }} className="fem-project-tree">
        <ExplorerViewTab displayFlags={DEFAULT_DISPLAY_FLAGS} setDisplayFlags={() => {}} workspace="3d"
          gridShow={false} setGridShow={() => {}} stramienAan setStramienAan={() => {}}
          openFem3dVisibility={v} setOpenFem3DVisibility={(next) => { zicht = next; setV(next); }} />
      </div>;
    };
    mount(<Verkenner />);
    const groep = () => container.querySelector<HTMLElement>('.explorer-view-section[data-workspace="3d"] [role="radiogroup"]');
    ok(groep(), "keuzegroep");
    gelijk(groep()!.previousElementSibling?.querySelector(".fem-results-toggle-label")?.textContent, "Platen", "direct onder Platen");
    const labels = [...container.querySelectorAll('.explorer-view-section[data-workspace="3d"] .fem-results-toggle-label')].map((el) => el.textContent);
    ok(!labels.some((l) => /mesh/i.test(l ?? "")), `geen schakelaar Mesh: ${labels.join(", ")}`);
    const opties = () => [...groep()!.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    flushSync(() => opties()[2]!.click());
    gelijk(zicht.plateDisplay, "mesh", "klik op Mesh");
    gelijk(groep()!.dataset.openFem3dPlateDisplay, "mesh", "groep toont de stand");
    ok(!groep()!.classList.contains("uit"), "Platen aan: niet gedimd");
    flushSync(() => groep()!.previousElementSibling!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    gelijk(zicht.plates, false, "Platen uit");
    ok(groep()!.classList.contains("uit"), "gedimd");
    flushSync(() => opties()[1]!.click());
    gelijk(zicht.plateDisplay, "surface", "gedimd maar te kiezen");
    const zoek = container.querySelector<HTMLInputElement>(".explorer-view-search input")!;
    for (const term of ["mesh", "vlak", "plaatweergave"]) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(zoek, term);
      flushSync(() => zoek.dispatchEvent(new Event("input", { bubbles: true })));
      ok(groep(), `zoeken op '${term}': de keuzegroep`);
      gelijk(groep()!.previousElementSibling?.querySelector(".fem-results-toggle-label")?.textContent, "Platen", `zoeken op '${term}': met Platen`);
    }
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(zoek, "knopen");
    flushSync(() => zoek.dispatchEvent(new Event("input", { bubbles: true })));
    ok(!groep(), "zoeken op 'knopen': geen keuzegroep");
    mount(null);
  });

  await test("lint: drie knoppen Volume, Vlak en Mesh in de groep Beeld; de actieve licht op; een klik kiest", async () => {
    const gekozen: OpenFem3DPlateDisplay[] = [];
    const Lint = () => {
      const [v, setV] = useState<OpenFem3DPlateDisplay>("surface");
      return <div className="ribbon-container"><div className="ribbon-content-wrapper"><div className="ribbon-content-panel">
        <HomeTab modelDimension="3d" openFem3dPlateDisplay={v}
          onOpenFem3DPlateDisplayChange={(stand) => { gekozen.push(stand); setV(stand); }}
          onOpenFem3DViewChange={() => {}} onOpenFem3DFit={() => {}} onToggle3DVisibility={() => {}} />
      </div></div></div>;
    };
    mount(<Lint />);
    const groepen = [...container.querySelectorAll<HTMLElement>(".ribbon-group")];
    const beeld = groepen.find((g) => g.textContent?.includes(i18next.t("ribbon:openFem3d.viewGroup")) && g.textContent?.includes("Isometrisch"));
    ok(beeld, "groep Beeld");
    const knop = (label: string) => [...beeld!.querySelectorAll<HTMLButtonElement>("button.ribbon-btn")]
      .find((b) => b.querySelector(".ribbon-btn-label")?.textContent === label)!;
    for (const label of ["Volume", "Vlak", "Mesh"]) ok(knop(label), `knop ${label}`);
    const actief = () => ["Volume", "Vlak", "Mesh"].filter((l) => knop(l).classList.contains("active"));
    gelijk(actief(), ["Vlak"], "Vlak licht op");
    flushSync(() => knop("Mesh").click());
    gelijk(gekozen, ["mesh"], "klik op Mesh");
    gelijk(actief(), ["Mesh"], "Mesh licht op");
    flushSync(() => knop("Volume").click());
    gelijk(actief(), ["Volume"], "Volume licht op");
    ok(lintUitleg(knop("Vlak")).length > 10, "toelichting bij de knop");
    mount(null);
  });
}

/** Beelden voor de schermafbeeldingen (geen proeven). */
async function toonBeeld(beeld: string, net: OpenFem3DPlateMesh) {
  if (beeld === "volume" || beeld === "surface" || beeld === "mesh") {
    await toon(vloer, {
      ...DEFAULT_OPEN_FEM_3D_VISIBILITY, structuralGrid: false, levelMarks: false, nodeNumbers: false, plateDisplay: beeld,
    }, { plateMesh: net });
    await wacht(300);
    return;
  }
  if (beeld === "lint") {
    mount(<div style={{ background: "#fff" }}><div className="ribbon-container"><div className="ribbon-content-wrapper"><div className="ribbon-content-panel">
      <HomeTab modelDimension="3d" openFem3dPlateDisplay="mesh" onOpenFem3DPlateDisplayChange={() => {}}
        onOpenFem3DViewChange={() => {}} onOpenFem3DFit={() => {}} onToggle3DVisibility={() => {}} />
    </div></div></div></div>);
    await wacht(200);
    // Alleen de groepen Selectie en Beeld: de rest van het lint valt buiten deze opdracht.
    const groepen = [...container.querySelectorAll<HTMLElement>(".ribbon-group")];
    groepen.slice(0, -2).forEach((g) => { g.style.display = "none"; });
    return;
  }
  if (beeld === "venster") {
    mount(<OpenFem3DVisibilityDialog open onClose={() => {}} visibility={{ ...DEFAULT_OPEN_FEM_3D_VISIBILITY, plateDisplay: "surface" }}
      onChange={() => {}} viewSets={[]} currentView="iso" currentCamera={{ position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1] }}
      currentCombinationId={null} currentLoadCaseId={1} currentMode="model" combinationOptions={[]} loadCaseOptions={[]} />);
    await wacht(200);
    return;
  }
  if (beeld === "verkenner") {
    mount(<div style={{ padding: 12, background: "#fff" }}>
      <div style={{ width: 240, height: 360, overflow: "hidden", border: "1px solid #cbd5e1" }} className="fem-project-tree">
        <ExplorerViewTab displayFlags={DEFAULT_DISPLAY_FLAGS} setDisplayFlags={() => {}} workspace="3d"
          gridShow={false} setGridShow={() => {}} stramienAan setStramienAan={() => {}}
          openFem3dVisibility={{ ...DEFAULT_OPEN_FEM_3D_VISIBILITY, plateDisplay: "mesh" }} setOpenFem3DVisibility={() => {}} />
      </div>
    </div>);
    await wacht(200);
  }
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el && !el.textContent) el.textContent = JSON.stringify({ tests, info, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, info, error: String(e?.stack ?? e) }); });

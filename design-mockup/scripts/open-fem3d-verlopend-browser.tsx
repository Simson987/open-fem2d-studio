/**
 * Browserkant van test-open-fem3d-verlopend-ui.mjs: verlopende profielen in 3D
 * (issue #73) in de echte onderdelen, in een lokale headless browser.
 *
 *  - Het tekenvlak, profielweergave: de verlopende spantligger is één volume
 *    met twee ringen (IPE 500 aan het begin, IPE 300 aan het eind, lineair
 *    ertussen); de kolommen blijven een prismatische extrusie; het label noemt
 *    het verloop; een klik op het smalle eind kiest de ligger en de selectie
 *    kleurt hem; in de hartlijnweergave blijft het een lijn (cilinder).
 *  - Een groot model (≥ 100 staven, GPU-batches): de verlopende staven delen
 *    een eigen batch met het volume met twee ringen.
 *  - Eigenschappen: het profiel heet "IPE 500 → IPE 300 (verlopend)"; de
 *    profielkiezer opent met Verlopend aan en het eindprofiel; Toepassen houdt
 *    het eindprofiel; het verloop uitzetten maakt de staaf prismatisch.
 *  - De wizard Stalen hal: de kiezer van de kolommen met een eindprofiel, de
 *    knop noemt het verloop en Maken geeft verlopende kolommen.
 *  - Het rapport: de staaltoets van een verlopende staaf (de echte uitkomst van
 *    de kern, als de testrunner haar kon maken) toont het VerloopBlok.
 *
 * `#beeld=spant` en `#beeld=kiezer` tonen alleen een beeld voor een
 * schermafbeelding.
 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import * as THREE from "three";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import common from "../src/i18n/locales/nl/common.json";
import check from "../src/i18n/locales/nl/check.json";
import ribbon from "../src/i18n/locales/nl/ribbon.json";
import "../src/themes.css";
import "../src/components/openFem3d/OpenFem3DEditor.css";
import OpenFem3DProperties from "../src/components/openFem3d/OpenFem3DProperties";
import OpenFem3DReport from "../src/components/openFem3d/OpenFem3DReport";
import ThreeFrameCanvas from "../src/components/openFem3d/ThreeFrameCanvas";
import StaalhalWizard from "../src/components/openFem3d/wizards/StaalhalWizard";
import type { StaalhalResultaat } from "../src/components/openFem3d/wizards/staalhal";
import { NEDERLANDSE_WINDROUTE } from "../src/lib/wind/windCodeRoute";
import { OPEN_FEM_3D_SUPPORT_PRESETS, parseOpenFem3DModel, type OpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import type { OpenFem3DSelection } from "../src/components/openFem3d/openFem3dSelection";
import type { OpenFem3DSteelChecks } from "../src/components/openFem3d/openFem3dSteelCheck";
import type { OpenFem3DSolveResult } from "../src/components/openFem3d/openFem3dSolver";
import type { BeamCheckResult } from "../src/lib/types/steel/BeamCheckResult";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, type OpenFem3DVisibility } from "../src/components/openFem3d/openFem3dVisibility";
import type { OpenFem3DCameraState } from "../src/components/openFem3d/openFem3dViewSets";
import type { OpenFem3DUtilization } from "../src/components/openFem3d/openFem3dUtilization";

// Synthetische PointerEvents hebben geen actieve aanwijzer om vast te houden.
Element.prototype.setPointerCapture = function () {};
Element.prototype.releasePointerCapture = function () {};

// De renderer, scène en camera waarmee het tekenvlak echt tekent.
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
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); tests.push({ name }); }
  catch (e) { tests.push({ name, error: e instanceof Error ? e.message : String(e) }); }
}
const q = <T extends Element = HTMLElement>(selector: string) => document.body.querySelector<T>(selector);
function klik(el: Element | null | undefined, wat: string) {
  if (!el) throw Error("Ontbreekt: " + wat);
  flushSync(() => (el as HTMLElement).click());
}
function kies(el: HTMLSelectElement, waarde: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, waarde);
  flushSync(() => el.dispatchEvent(new Event("change", { bubbles: true })));
}

/* ── Model: een spant met een verlopende ligger ───────────────────────── */

const spant = (): OpenFem3DModel => parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 6 }, { id: 3, x: 8, y: 0, z: 6 }, { id: 4, x: 8, y: 0, z: 0 },
  ],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA 300", material: "S235" },
    { id: 2, startNodeId: 4, endNodeId: 3, profileName: "HEA 300", material: "S235" },
    { id: 3, startNodeId: 2, endNodeId: 3, profileName: "IPE 500", profileNameEnd: "IPE 300", material: "S235" },
  ],
  supports: [{ nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.fixed }, { nodeId: 4, ...OPEN_FEM_3D_SUPPORT_PRESETS.fixed }],
  memberLoads: [{ id: 1, beamId: 3, qyStart: 0, qyEnd: 0, qzStart: -10, qzEnd: -10, startPositionM: 0, endPositionM: 8 }],
});

/** Een rij van 60 portalen (120 staven): de GPU-batches; de liggers verlopen. */
const rij = (): OpenFem3DModel => {
  const nodes = [], beams = [];
  for (let i = 0; i < 60; i++) {
    nodes.push({ id: 2 * i + 1, x: i * 2, y: 0, z: 0 }, { id: 2 * i + 2, x: i * 2, y: 0, z: 4 });
    beams.push({ id: beams.length + 1, startNodeId: 2 * i + 1, endNodeId: 2 * i + 2, profileName: "HEA 200", material: "S235" });
    if (i > 0) {
      beams.push({ id: beams.length + 1, startNodeId: 2 * i, endNodeId: 2 * i + 2, profileName: "IPE 400", profileNameEnd: "IPE 240", material: "S235" });
    }
  }
  return parseOpenFem3DModel({ nodes, beams });
};

/* ── Het tekenvlak ───────────────────────────────────────────────────── */

const GEEN_BENUTTINGEN: OpenFem3DUtilization[] = [];
let gekozen: OpenFem3DSelection = null;
function Tekenvlak({ model, zicht, camera }: { model: OpenFem3DModel; zicht: OpenFem3DVisibility; camera?: OpenFem3DCameraState }) {
  const [sel, setSel] = useState<OpenFem3DSelection>(null);
  return <div className="open-fem3d-stage" style={{ width: 1000, height: 700, flex: "none" }}>
    <ThreeFrameCanvas model={model} onChange={() => {}} tool="select" selection={sel}
      onSelect={(next) => { gekozen = next; setSel(next); }}
      fitToken={0} visibility={zicht} utilizations={GEEN_BENUTTINGEN} result={null}
      cameraRequest={camera ? { state: camera, token: 1 } : undefined} viewRequest={camera ? undefined : { kind: "iso", token: 1 }} />
  </div>;
}
/** Parallel, recht van voren (camera op −y). */
const VOOR: OpenFem3DCameraState = { position: [4, -40, 3.2], target: [4, 0, 3.2], up: [0, 0, 1], orthoHalfHeight: 4.2 };
const profielZicht: OpenFem3DVisibility = {
  ...DEFAULT_OPEN_FEM_3D_VISIBILITY, profiles: true, perspective: false, grid: false, axes: false, structuralGrid: false,
  levelMarks: false, nodeNumbers: false, viewCube: false, loads: false,
};
async function toon(model: OpenFem3DModel, zicht: OpenFem3DVisibility, camera?: OpenFem3DCameraState) {
  gekozen = null;
  mount(<Tekenvlak model={model} zicht={zicht} camera={camera} />);
  await wacht(250);
}
const canvasEl = () => container.querySelector("canvas") as HTMLCanvasElement;
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
function staafMesh(id: number): THREE.Mesh | undefined {
  let gevonden: THREE.Mesh | undefined;
  renderScene?.traverse((o) => {
    if (!gevonden && (o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh
      && o.userData.type === "beam" && o.userData.id === id) gevonden = o as THREE.Mesh;
  });
  return gevonden;
}
/** De hoogte (wereld-z) van de getekende staaf bij wereld-x ≈ `x`. */
function hoogteBij(mesh: THREE.Mesh, x: number): number {
  mesh.updateWorldMatrix(true, false);
  const pos = mesh.geometry.getAttribute("position");
  const p = new THREE.Vector3();
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    if (Math.abs(p.x - x) > 1e-6) continue;
    min = Math.min(min, p.z); max = Math.max(max, p.z);
  }
  return max - min;
}
function kleurVan(mesh: THREE.Mesh): number {
  return ((mesh.material as THREE.MeshStandardMaterial).color).getHex();
}

/* ── Eigenschappen in een omhulsel dat het model bijhoudt ────────────── */

let wijzigingen: OpenFem3DModel[] = [];
function Paneel({ begin, selectie }: { begin: OpenFem3DModel; selectie: OpenFem3DSelection }) {
  const [model, setModel] = useState(begin);
  return <div style={{ width: 340, background: "var(--theme-bg, #fff)" }} className="open-fem3d-editor">
    <OpenFem3DProperties model={model} selection={selectie} result={null}
      onChange={(next) => { wijzigingen.push(next); setModel(next); }} />
  </div>;
}
const laatste = () => wijzigingen[wijzigingen.length - 1];
const kiezerKnop = () => [...container.querySelectorAll<HTMLButtonElement>(".fem-prop-kiezer-btn")].find((b) => b.textContent?.includes("Profiel kiezen"));
const toepassen = () => document.body.querySelector<HTMLButtonElement>(".pk-voet .pk-knop-primair");
/**
 * Het beginprofiel in de lijst aanklikken, zoals een gebruiker doet: de kiezer
 * houdt een profielnaam met spatie ("IPE 500") niet voor een keuze uit zijn
 * lijst (die draagt "IPE500"), en Toepassen staat dan uit — ook bij een
 * prismatische staaf; dat is het gedrag van de kiezer zelf.
 */
function kiesBegin(naam: string) {
  const rij = [...document.body.querySelectorAll<HTMLButtonElement>("[role=option]")]
    .find((el) => el.textContent?.replace(/\s/g, "") === naam.replace(/\s/g, ""));
  klik(rij, `beginprofiel ${naam} in de lijst`);
}

/* ── Proeven ──────────────────────────────────────────────────────────── */

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", resources: { nl: { common, check, ribbon } }, defaultNS: "common", initImmediate: false,
  });
  const beeld = new URLSearchParams(location.hash.slice(1)).get("beeld");
  if (beeld) { await toonBeeld(beeld); return; }

  await test("tekenvlak: de verlopende ligger is één volume met twee ringen, IPE 500 aan het begin en IPE 300 aan het eind", async () => {
    await toon(spant(), profielZicht, VOOR);
    const ligger = staafMesh(3);
    ok(ligger, "de ligger is getekend");
    const pos = ligger!.geometry.getAttribute("position");
    const zLokaal = new Set<number>();
    for (let i = 0; i < pos.count; i++) zLokaal.add(Math.round(pos.getZ(i) * 1e6) / 1e6);
    ok(zLokaal.size === 2, `twee ringen, niet ${zLokaal.size}`);
    const begin = hoogteBij(ligger!, 0), eind = hoogteBij(ligger!, 8);
    ok(Math.abs(begin - 0.5) < 1e-4, `hoogte aan het begin ${begin} m (IPE 500)`);
    ok(Math.abs(eind - 0.3) < 1e-4, `hoogte aan het eind ${eind} m (IPE 300)`);
  });

  await test("tekenvlak: de prismatische kolommen blijven een extrusie van hun profiel", async () => {
    const kolom = staafMesh(1);
    ok(kolom?.geometry.type === "ExtrudeGeometry", `kolom: ${kolom?.geometry.type}`);
  });

  await test("tekenvlak: het profiellabel noemt het verloop", async () => {
    const labels = [...container.querySelectorAll(".open-fem3d-profile-label")].map((el) => el.textContent);
    ok(labels.includes("IPE 500 → IPE 300"), `labels: ${labels.join(" | ")}`);
    ok(labels.filter((l) => l === "HEA 300").length === 2, "de kolommen houden hun profielnaam");
  });

  await test("kiezen en markeren: een klik op het smalle eind kiest de ligger en kleurt hem", async () => {
    const ligger = staafMesh(3)!;
    const voor = kleurVan(ligger);
    klikWereld(new THREE.Vector3(7.4, 0, 6));
    ok(gekozen?.type === "beam" && gekozen.id === 3, `gekozen: ${JSON.stringify(gekozen)}`);
    await wacht(80);
    const na = kleurVan(staafMesh(3)!);
    ok(na !== voor, `de selectie kleurt de ligger (${voor.toString(16)} → ${na.toString(16)})`);
  });

  await test("vervormde vorm in de profielweergave: de ligger verloopt ook daar (500 → 300 mm)", async () => {
    const model = spant();
    const rust: OpenFem3DSolveResult = {
      schemaVersion: 1,
      engine: { id: "open-fem-3d", name: "Open FEM 3D", revision: "test", license: "AGPL-3.0" },
      analysis: "linear",
      displacements: model.nodes.map((node) => ({ nodeId: node.id, ux: 0, uy: 0, uz: node.id === 2 || node.id === 3 ? -0.001 : 0, rx: 0, ry: 0, rz: 0 })),
      reactions: [],
      memberForces: model.beams.map((beam) => ({
        memberId: beam.id, lengthM: beam.id === 3 ? 8 : 6, nStartKn: 0, nEndKn: 0, vyStartKn: 0, vyEndKn: 0, vzStartKn: 0, vzEndKn: 0,
        torsionStartKnm: 0, torsionEndKnm: 0, myStartKnm: 0, myEndKnm: 0, mzStartKnm: 0, mzEndKnm: 0,
      })),
      buckling: { status: "notApplicable", reason: "test" },
      diagnostics: [],
    };
    gekozen = null;
    mount(<div className="open-fem3d-stage" style={{ width: 1000, height: 700, flex: "none" }}>
      <ThreeFrameCanvas model={model} onChange={() => {}} tool="select" selection={null} onSelect={() => {}}
        fitToken={0} visibility={{ ...profielZicht, deformation: true }} utilizations={GEEN_BENUTTINGEN} result={rust}
        cameraRequest={{ state: VOOR, token: 1 }} />
    </div>);
    await wacht(250);
    let laag: THREE.Mesh | undefined;
    renderScene?.traverse((o) => {
      if (!laag && o.parent?.userData.openFem3dDeformedLayer && (o as THREE.Mesh).isMesh) laag = o as THREE.Mesh;
    });
    ok(laag, "de vervormde laag is getekend");
    const pos = laag!.geometry.getAttribute("position");
    const hoogte = (x: number) => {
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getX(i) - x) > 1e-6) continue;
        min = Math.min(min, pos.getZ(i)); max = Math.max(max, pos.getZ(i));
      }
      return max - min;
    };
    const begin = hoogte(0), eind = hoogte(8);
    ok(Math.abs(begin - 0.5) < 2e-3 && Math.abs(eind - 0.3) < 2e-3, `vervormd: ${begin.toFixed(4)} m aan het begin, ${eind.toFixed(4)} m aan het eind`);
  });

  await test("hartlijnweergave: de verlopende ligger blijft een lijn (cilinder)", async () => {
    await toon(spant(), { ...profielZicht, profiles: false }, VOOR);
    const ligger = staafMesh(3);
    ok(ligger?.geometry.type === "CylinderGeometry", `ligger: ${ligger?.geometry.type}`);
  });

  await test("groot model: de verlopende liggers delen een eigen GPU-batch met het volume met twee ringen", async () => {
    await toon(rij(), profielZicht);
    const batches: THREE.InstancedMesh[] = [];
    renderScene?.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh && typeof o.userData.openFem3dBeamBatchKey === "string") batches.push(o as THREE.InstancedMesh); });
    const verloop = batches.find((b) => String(b.userData.openFem3dBeamBatchKey).includes("→"));
    ok(verloop, `batches: ${batches.map((b) => b.userData.openFem3dBeamBatchKey).join(" | ")}`);
    ok(verloop!.count === 59, `59 verlopende liggers in de batch, niet ${verloop!.count}`);
    const pos = verloop!.geometry.getAttribute("position");
    const z = new Set<number>();
    for (let i = 0; i < pos.count; i++) z.add(Math.round(pos.getZ(i) * 1e6) / 1e6);
    ok(z.size === 2 && z.has(-0.5) && z.has(0.5), `de batchgeometrie is één meter met twee ringen (${[...z].join(", ")})`);
  });

  await test("eigenschappen: het profiel heet IPE 500 → IPE 300 (verlopend)", async () => {
    wijzigingen = [];
    mount(<Paneel begin={spant()} selectie={{ type: "beam", id: 3 }} />);
    await wacht();
    const tekst = container.querySelector("[data-open-fem3d-profile]")?.textContent ?? "";
    ok(tekst.includes("IPE 500 → IPE 300 (verlopend)") && tekst.includes("S235"), tekst);
  });

  await test("profielkiezer: opent met Verlopend aan en IPE 300 als eind; Toepassen houdt het eindprofiel", async () => {
    klik(kiezerKnop(), "Profiel kiezen");
    await wacht();
    const schakelaar = q<HTMLInputElement>(".pk-verloop-schakelaar input");
    ok(schakelaar?.checked, "Verlopend profiel staat aan");
    const eind = q<HTMLSelectElement>(".pk-verloop select");
    ok(eind && eind.value.replace(/\s/g, "") === "IPE300", `eindprofiel in de kiezer: ${eind?.value}`);
    kiesBegin("IPE 500");
    ok(q<HTMLSelectElement>(".pk-verloop select")?.value === "IPE300", "het eindprofiel blijft staan bij het kiezen van het begin");
    klik(toepassen(), "Toepassen");
    await wacht();
    const ligger = laatste()?.beams.find((b) => b.id === 3);
    ok(ligger?.profileName?.replace(/\s/g, "") === "IPE500" && ligger.profileNameEnd?.replace(/\s/g, "") === "IPE300",
      `na Toepassen: ${JSON.stringify(ligger)}`);
  });

  await test("profielkiezer: een ander eindprofiel kiezen en toepassen", async () => {
    klik(kiezerKnop(), "Profiel kiezen");
    await wacht();
    const eind = q<HTMLSelectElement>(".pk-verloop select")!;
    const optie = [...eind.options].find((o) => o.textContent?.replace(/\s/g, "") === "IPE240");
    ok(optie, "IPE 240 staat in de lijst");
    kies(eind, optie!.value);
    kiesBegin("IPE 500");
    klik(toepassen(), "Toepassen");
    await wacht();
    ok(laatste()?.beams.find((b) => b.id === 3)?.profileNameEnd === optie!.value, JSON.stringify(laatste()?.beams[2]));
    ok(container.querySelector("[data-open-fem3d-profile]")?.textContent?.includes("→"), "het paneel toont het nieuwe verloop");
  });

  await test("profielkiezer: Verlopend uitzetten en Toepassen maakt de staaf prismatisch", async () => {
    klik(kiezerKnop(), "Profiel kiezen");
    await wacht();
    klik(q(".pk-verloop-schakelaar input"), "schakelaar verlopend");
    kiesBegin("IPE 500");
    klik(toepassen(), "Toepassen");
    await wacht();
    const ligger = laatste()?.beams.find((b) => b.id === 3);
    ok(ligger && !("profileNameEnd" in ligger), JSON.stringify(ligger));
    ok(!container.querySelector("[data-open-fem3d-profile]")?.textContent?.includes("→"), "het paneel toont geen verloop meer");
  });

  await test("wizard Stalen hal: de kolommen met een eindprofiel; de knop noemt het verloop en Maken geeft verlopende kolommen", async () => {
    let gemaakt: StaalhalResultaat | null = null;
    mount(<StaalhalWizard open onClose={() => {}} windCodeId={NEDERLANDSE_WINDROUTE}
      onMaken={(hal) => { gemaakt = hal; }} />);
    await wacht();
    klik([...document.querySelectorAll(".shw-stap")].find((el) => el.textContent?.includes("Profielen")), "stap Profielen");
    klik(q("[data-staalhal-profiel='kolom']"), "profielknop kolom");
    await wacht();
    klik(q(".pk-verloop-schakelaar input"), "schakelaar verlopend");
    const eind = q<HTMLSelectElement>(".pk-verloop select")!;
    const optie = [...eind.options].find((o) => o.textContent?.replace(/\s/g, "") === "HEA300");
    ok(optie, "HEA 300 staat in de lijst");
    kies(eind, optie!.value);
    kiesBegin("HEA 450");
    klik(toepassen(), "Toepassen");
    await wacht();
    const knop = q("[data-staalhal-profiel='kolom']")?.textContent ?? "";
    ok(knop.replace(/\s/g, "").includes("HEA450→") && knop.includes("verlopend"),
      `knop: ${knop}; kiezer open: ${!!q(".pk-voet")}; Toepassen uit: ${toepassen()?.disabled}; melding: ${q(".pk-verloop-fout")?.textContent ?? "—"}; eind: ${q<HTMLSelectElement>(".pk-verloop select")?.value}`);
    klik([...document.querySelectorAll<HTMLButtonElement>(".shw-knop")].find((el) => el.textContent === "Maken"), "Maken");
    await wacht(40);
    const hal = gemaakt as StaalhalResultaat | null;
    ok(hal, "onMaken aangeroepen");
    const kolommen = hal!.samenvatting.groepen.kolom.map((id) => hal!.model.beams.find((b) => b.id === id)!);
    ok(kolommen.length > 0 && kolommen.every((b) => b.profileName?.replace(/\s/g, "") === "HEA450" && b.profileNameEnd === optie!.value),
      `kolommen: ${JSON.stringify(kolommen[0])}`);
  });

  const staaltoets = (window as unknown as { __STAALTOETS?: BeamCheckResult | null }).__STAALTOETS ?? null;
  if (staaltoets) {
    await test("rapport: de staaltoets van een verlopende staaf toont het VerloopBlok", async () => {
      const checks: OpenFem3DSteelChecks = { results: [staaltoets], skipped: [], notes: [] };
      const model = spant();
      const uitkomst: OpenFem3DSolveResult = {
        schemaVersion: 1,
        engine: { id: "open-fem-3d", name: "Open FEM 3D", revision: "test", license: "AGPL-3.0" },
        analysis: "linear",
        displacements: model.nodes.map((node) => ({ nodeId: node.id, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 })),
        reactions: [],
        memberForces: model.beams.map((beam) => ({
          memberId: beam.id, lengthM: 1, nStartKn: 0, nEndKn: 0, vyStartKn: 0, vyEndKn: 0, vzStartKn: 0, vzEndKn: 0,
          torsionStartKnm: 0, torsionEndKnm: 0, myStartKnm: 0, myEndKnm: 0, mzStartKnm: 0, mzEndKnm: 0,
        })),
        diagrams: { momentY: [], momentZ: [], shearY: [], shearZ: [], axial: [], torsion: [] },
        buckling: { status: "notApplicable", reason: "test" },
        diagnostics: [],
      };
      mount(<OpenFem3DReport model={model} result={uitkomst} checks={checks} />);
      await wacht();
      const blok = container.querySelector(`[data-open-fem3d-verloop='${staaltoets.beam_id}']`);
      ok(blok, "het blok staat in het rapport");
      const tekst = blok!.textContent ?? "";
      ok(tekst.includes("IPE 400 → IPE 200") && tekst.includes("toetsdoorsneden"), tekst.slice(0, 200));
      ok(blok!.querySelectorAll("tbody tr").length >= 6, "zes toetsdoorsneden (en het maatgevende punt)");
    });
  }
}

/** Beelden voor de schermafbeeldingen (geen proeven). */
async function toonBeeld(beeld: string) {
  if (beeld === "spant") {
    // Schuin van onderen op de ligger: het lijf loopt van 500 mm (links, begin)
    // naar 300 mm (rechts, eind); de kolommen zijn prismatische HEA 300.
    await toon(spant(), { ...profielZicht, nodes: true },
      { position: [9.5, -7.5, 4.2], target: [4, 0, 5.6], up: [0, 0, 1], orthoHalfHeight: 2.6 });
    await wacht(300);
    return;
  }
  if (beeld === "kiezer") {
    mount(<Paneel begin={spant()} selectie={{ type: "beam", id: 3 }} />);
    await wacht(100);
    klik(kiezerKnop(), "Profiel kiezen");
    await wacht(100);
    kiesBegin("IPE 500");
    await wacht(300);
  }
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el && !el.textContent) el.textContent = JSON.stringify({ tests, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, error: String(e?.stack ?? e) }); });

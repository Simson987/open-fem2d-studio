/**
 * Browserkant van test-open-fem3d-trek-schijf-ui.mjs: de echte onderdelen in
 * een lokale headless browser.
 *
 *  - eigenschappen van een staaf: het vinkje "Alleen trek" zet en wist
 *    `tensionOnly`; bij een meervoudige selectie geldt het voor alle staven;
 *  - meervoudige selectie van knopen: "Schijf maken" maakt een schijf van
 *    knopen op één hoogte en weigert knopen op verschillende hoogtes;
 *  - de verkenner toont "Schijven" met selecteren en verwijderen;
 *  - het tekenvlak tekent inactieve trek-alleen staven gestippeld met label;
 *  - het rapport noemt per combinatie de inactieve trek-alleen staven en α_cr;
 *  - montage na de permanente belasting en de kruisregel: de twee schakelaars
 *    in de analysebalk, Δ0 en "actief dankzij de kruisregel" bij een staaf,
 *    en de toelichting in het rapport.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import common from "../src/i18n/locales/nl/common.json";
import ribbon from "../src/i18n/locales/nl/ribbon.json";
import "../src/openaec/openaec-tokens.css";
import "../src/themes.css";
import "../src/components/openFem3d/OpenFem3DEditor.css";
import OpenFem3DProperties from "../src/components/openFem3d/OpenFem3DProperties";
import OpenFem3DExplorer from "../src/components/openFem3d/OpenFem3DExplorer";
import OpenFem3DReport from "../src/components/openFem3d/OpenFem3DReport";
import ThreeFrameCanvas from "../src/components/openFem3d/ThreeFrameCanvas";
import LoadCaseTabBar from "../src/components/fem/LoadCaseTabBar";
import { parseOpenFem3DModel, type OpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import type { OpenFem3DSelection } from "../src/components/openFem3d/openFem3dSelection";
import type { OpenFem3DSolveResult } from "../src/components/openFem3d/openFem3dSolver";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY } from "../src/components/openFem3d/openFem3dVisibility";
import { DEFAULT_DISPLAY_FLAGS } from "../src/components/fem/FemResultsOverlay";
import { DEFAULT_STRUCTURAL_GRID } from "../src/components/fem/femTypes";

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

const scharnier = { myStart: true, myEnd: true, mzStart: true, mzEnd: true, torsionStart: false, torsionEnd: false };
const portaal: OpenFem3DModel = parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 0, y: 0, z: 4 }, { id: 4, x: 6, y: 0, z: 4 }],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 3, profileName: "HEA 200", material: "S235" },
    { id: 2, startNodeId: 2, endNodeId: 4, profileName: "HEA 200", material: "S235" },
    { id: 3, startNodeId: 3, endNodeId: 4, profileName: "IPE 200", material: "S235", releases: scharnier },
    { id: 4, startNodeId: 1, endNodeId: 4, profileName: "CHS 88.9x4", material: "S235", releases: scharnier, tensionOnly: true },
    { id: 5, startNodeId: 2, endNodeId: 3, profileName: "CHS 88.9x4", material: "S235", releases: scharnier },
  ],
  supports: [1, 2].map((nodeId) => ({ nodeId, ux: true, uy: true, uz: true, rx: true, ry: false, rz: true })),
  loads: [{ id: 1, nodeId: 3, fx: 12, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
});

/** Een kleine uitkomst waarin de gegeven trek-alleen staven niet meedoen. */
function uitkomst(model: OpenFem3DModel, inactief: number[], alphaCr = 6.5): OpenFem3DSolveResult {
  const nul = { t: 0, value: 0 };
  return {
    schemaVersion: 1,
    engine: { id: "open-fem-3d", name: "Open FEM 3D", revision: "test", license: "AGPL-3.0" },
    analysis: "p-delta",
    displacements: model.nodes.map((node) => ({ nodeId: node.id, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 })),
    reactions: [],
    memberForces: model.beams.map((beam) => ({
      memberId: beam.id, lengthM: 1, nStartKn: 0, nEndKn: 0, vyStartKn: 0, vyEndKn: 0, vzStartKn: 0, vzEndKn: 0,
      torsionStartKnm: 0, torsionEndKnm: 0, myStartKnm: 0, myEndKnm: 0, mzStartKnm: 0, mzEndKnm: 0,
    })),
    diagrams: { momentY: [], momentZ: [], shearY: [], shearZ: [], axial: model.beams.map((beam) => ({
      memberId: beam.id, points: [nul, { t: 1, value: 0 }], maxValue: 0, minValue: 0, maxAbsValue: 0,
    })), torsion: [] },
    secondOrder: { iterations: 3, converged: true, stable: true, maxAmplification: 1.18 },
    buckling: { status: "available", modes: [{ mode: 1, loadFactor: alphaCr }], members: [] },
    diagnostics: [],
    inactiveMembers: inactief,
    tensionOnlyRounds: 3,
  };
}

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", resources: { nl: { common, ribbon } }, defaultNS: "common", initImmediate: false,
  });

  await test("eigenschappen: het vinkje Alleen trek zet en wist tensionOnly", async () => {
    let gewijzigd: OpenFem3DModel | null = null;
    mount(<OpenFem3DProperties model={portaal} selection={{ type: "beam", id: 5 }} result={null}
      onChange={(model) => { gewijzigd = model; }} />);
    await wacht();
    const vinkje = container.querySelector<HTMLInputElement>("[data-open-fem3d-tension-only]");
    ok(vinkje, "het vinkje staat in het paneel");
    ok(!vinkje!.checked, "staaf 5 is nog geen trek-alleen staaf");
    ok(container.textContent?.includes("Alleen trek"), "het label Alleen trek");
    vinkje!.click();
    await wacht();
    gelijk(gewijzigd!.beams.find((beam) => beam.id === 5)!.tensionOnly, true, "aanvinken zet tensionOnly");
    mount(<OpenFem3DProperties model={gewijzigd!} selection={{ type: "beam", id: 5 }} result={null}
      onChange={(model) => { gewijzigd = model; }} />);
    await wacht();
    container.querySelector<HTMLInputElement>("[data-open-fem3d-tension-only]")!.click();
    await wacht();
    ok(!("tensionOnly" in gewijzigd!.beams.find((beam) => beam.id === 5)!), "uitvinken laat het veld weg");
  });

  await test("eigenschappen: meervoudige selectie, half vinkje en alles tegelijk aan", async () => {
    let gewijzigd: OpenFem3DModel | null = null;
    const selectie: OpenFem3DSelection = { type: "multi", nodeIds: [], beamIds: [4, 5] };
    mount(<OpenFem3DProperties model={portaal} selection={selectie} result={null} onChange={(model) => { gewijzigd = model; }} />);
    await wacht();
    const vinkje = container.querySelector<HTMLInputElement>("[data-open-fem3d-tension-only]")!;
    ok(vinkje.indeterminate, "één van twee staven: het vinkje staat half");
    vinkje.click();
    await wacht();
    gelijk(gewijzigd!.beams.filter((beam) => beam.tensionOnly).map((beam) => beam.id), [4, 5], "beide staven trek-alleen");
  });

  await test("eigenschappen: inactieve staaf in de uitkomst krijgt een melding", async () => {
    mount(<OpenFem3DProperties model={portaal} selection={{ type: "beam", id: 4 }} result={uitkomst(portaal, [4])}
      onChange={() => {}} />);
    await wacht();
    const resultaten = [...container.querySelectorAll<HTMLButtonElement>(".fem-prop-tab")].find((knop) => knop.textContent === "Resultaten");
    ok(resultaten, "tab Resultaten");
    resultaten!.click();
    await wacht();
    ok(container.querySelector("[data-open-fem3d-inactive-member='4']"), "de melding inactief staat bij staaf 4");
  });

  await test("schijf maken van twee knopen op 4 m; knopen op 0 en 4 m worden geweigerd", async () => {
    let gewijzigd: OpenFem3DModel | null = null;
    mount(<OpenFem3DProperties model={portaal} selection={{ type: "multi", nodeIds: [3, 4], beamIds: [] }} result={null}
      onChange={(model) => { gewijzigd = model; }} />);
    await wacht();
    const knop = container.querySelector<HTMLButtonElement>("[data-open-fem3d-make-diaphragm]");
    ok(knop && knop.textContent?.includes("2 knopen"), "de knop noemt het aantal knopen");
    knop!.click();
    await wacht();
    gelijk(gewijzigd!.diaphragms, [{ id: 1, nodeIds: [3, 4] }], "een schijf van knoop 3 en 4");
    mount(<OpenFem3DProperties model={portaal} selection={{ type: "multi", nodeIds: [1, 3], beamIds: [] }} result={null}
      onChange={(model) => { gewijzigd = model; }} />);
    await wacht();
    gewijzigd = null;
    container.querySelector<HTMLButtonElement>("[data-open-fem3d-make-diaphragm]")!.click();
    await wacht();
    ok(gewijzigd === null, "geen modelwijziging bij verschillende hoogtes");
    const melding = container.querySelector("[role='alert']")?.textContent ?? "";
    ok(melding.includes("4000.0 mm"), `de melding noemt het hoogteverschil: ${melding}`);
  });

  await test("verkenner: Schijven met selecteren en verwijderen", async () => {
    const metSchijf: OpenFem3DModel = { ...portaal, diaphragms: [{ id: 1, nodeIds: [4, 3], name: "Dak" }] };
    let selectie: OpenFem3DSelection = null;
    let gewijzigd: OpenFem3DModel | null = null;
    mount(<div style={{ width: 300 }}><OpenFem3DExplorer model={metSchijf} selection={null} setSelection={(next) => { selectie = next; }}
      onChange={(model) => { gewijzigd = model; }}
      result={null} activeTab="project" setActiveTab={() => {}} visibility={DEFAULT_OPEN_FEM_3D_VISIBILITY} setVisibility={() => {}}
      displayFlags={DEFAULT_DISPLAY_FLAGS} setDisplayFlags={() => {}} gridShow={false} setGridShow={() => {}}
      structuralGrid={DEFAULT_STRUCTURAL_GRID} setStructuralGridEnabled={() => {}} /></div>);
    await wacht();
    const tak = [...container.querySelectorAll(".fem-tree-row")].find((rij) => rij.textContent?.startsWith("Schijven"));
    ok(tak && tak.textContent?.endsWith("1"), `tak Schijven met aantal 1: ${tak?.textContent}`);
    const blad = container.querySelector("[data-open-fem3d-diaphragm='1']");
    ok(blad?.textContent?.includes("Schijf 1 · Dak") && blad.textContent.includes("2 knopen"), `schijf met naam en aantal: ${blad?.textContent}`);
    blad!.querySelector<HTMLButtonElement>(".fem-tree-leaf")!.click();
    gelijk(selectie, { type: "multi", nodeIds: [3, 4], beamIds: [] }, "klikken selecteert de knopen van de schijf");
    blad!.querySelector<HTMLButtonElement>(".open-fem3d-diaphragm-delete")!.click();
    gelijk(gewijzigd!.diaphragms, [], "verwijderen haalt de schijf weg");
  });

  await test("tekenvlak: inactieve trek-alleen staaf gestippeld met label", async () => {
    mount(<div className="open-fem3d-stage" style={{ width: 800, height: 600, flex: "none" }}>
      <ThreeFrameCanvas model={portaal} onChange={() => {}} tool="select" selection={null} onSelect={() => {}}
        fitToken={0} visibility={{ ...DEFAULT_OPEN_FEM_3D_VISIBILITY, grid: false, structuralGrid: false }}
        result={uitkomst(portaal, [4])} />
    </div>);
    await wacht(300);
    const tekenvlak = container.querySelector<HTMLDivElement>(".open-fem3d-canvas")!;
    gelijk(tekenvlak.dataset.openFem3dInactiveMembers, "1", "één inactieve staaf getekend");
    ok(container.querySelector(".open-fem3d-inactive-label")?.textContent === "inactief (trek-alleen)", "label bij de staaf");
  });

  await test("rapport: inactieve trek-alleen staven en α_cr per combinatie", async () => {
    const combinaties = [
      { id: 11, name: "1,2 G + 1,5 W", type: "uls", factors: new Map([[1, 1]]) },
      { id: 12, name: "G + Q", type: "sls", factors: new Map([[1, 1]]) },
    ];
    const resultaten = new Map([[11, uitkomst(portaal, [4], 6.5)], [12, { ...uitkomst(portaal, [], 12.25), analysis: "linear" as const }]]);
    mount(<OpenFem3DReport model={portaal} result={uitkomst(portaal, [4], 6.5)}
      combinations={combinaties as never} combinationResults={resultaten} />);
    await wacht(200);
    const samenvatting = container.querySelector("[data-open-fem3d-report-tension-only]")?.textContent ?? "";
    ok(samenvatting.includes("1 van 1"), `samenvatting trek-alleen: ${samenvatting}`);
    const tabel = container.querySelector("[data-open-fem3d-report-combinations]")!;
    ok(tabel, "tabel combinaties");
    const rijen = [...tabel.querySelectorAll("tbody tr")].map((rij) => [...rij.querySelectorAll("td")].map((cel) => cel.textContent));
    gelijk(rijen.map((rij) => [rij[0], rij[5], rij[6]]), [["11", "6,5", "1 van 1"], ["12", "12,25", "0 van 1"]],
      "per combinatie α_cr en inactieve trek-alleen staven");
    ok(container.textContent?.includes("5.2.1(3)"), "de toelichting noemt EN 1993-1-1 5.2.1(3)");
  });

  await test("analysebalk: schakelaars montage na G en kruisregel", async () => {
    const gezet: [string, boolean][] = [];
    mount(<LoadCaseTabBar loadCases={[{ id: 1, name: "G", type: "dead" }] as never} activeLoadCaseId={1}
      setActiveLoadCaseId={() => {}} addLoadCase={() => {}} loads={[]}
      trekAlleenMontage={false} setTrekAlleenMontage={(aan) => gezet.push(["montage", aan])}
      kruisregel setKruisregel={(aan) => gezet.push(["kruisregel", aan])} />);
    await wacht();
    const montage = container.querySelector<HTMLLabelElement>("[data-trek-alleen-montage]");
    const kruis = container.querySelector<HTMLLabelElement>("[data-kruisregel]");
    ok(montage?.textContent === "Trek-alleen gemonteerd na G", `label montage: ${montage?.textContent}`);
    ok(kruis?.textContent === "Kruisregel" && kruis.classList.contains("active"), "kruisregel staat aan");
    ok(montage!.title.includes("blijvende belastinggevallen"), "de toelichting noemt de blijvende gevallen");
    montage!.querySelector("input")!.click();
    kruis!.querySelector("input")!.click();
    await wacht();
    gelijk(gezet, [["montage", true], ["kruisregel", false]], "klikken zet de instellingen");
    mount(<LoadCaseTabBar loadCases={[{ id: 1, name: "G", type: "dead" }] as never} activeLoadCaseId={1}
      setActiveLoadCaseId={() => {}} addLoadCase={() => {}} loads={[]} />);
    await wacht();
    ok(!container.querySelector("[data-trek-alleen-montage]") && !container.querySelector("[data-kruisregel]"),
      "zonder setters (geen trek-alleen staven of 2D) geen schakelaars");
  });

  await test("eigenschappen: Δ0 en actief dankzij de kruisregel bij een staaf", async () => {
    const resultaat = { ...uitkomst(portaal, []), tensionOnlyFit: [{ memberId: 4, deltaMm: -0.19639 }], crossRuleMembers: [4] };
    mount(<OpenFem3DProperties model={portaal} selection={{ type: "beam", id: 4 }} result={resultaat} onChange={() => {}} />);
    await wacht();
    [...container.querySelectorAll<HTMLButtonElement>(".fem-prop-tab")].find((knop) => knop.textContent === "Resultaten")!.click();
    await wacht();
    ok(container.querySelector("[data-open-fem3d-fit-delta='4']")?.textContent === "-0.196 mm", "Δ0 in mm");
    ok(container.textContent?.includes("Montage Δ0"), "het label Montage Δ0");
    ok(container.querySelector("[data-open-fem3d-cross-rule-member='4']")?.textContent?.includes("kruisregel"), "melding kruisregel");
    ok(!container.querySelector("[data-open-fem3d-inactive-member='4']"), "de staaf is niet inactief");
  });

  await test("rapport: toelichting montage na G en kruisregel", async () => {
    const model = { ...portaal, tensionOnlyFitAfterPermanent: true, tensionOnlyCrossRule: true };
    const combinaties = [{ id: 11, name: "1,2 G + 1,5 W", type: "uls", factors: new Map([[1, 1]]) }];
    mount(<OpenFem3DReport model={model} result={uitkomst(model, [])}
      combinations={combinaties as never} combinationResults={new Map([[11, uitkomst(model, [])]])} />);
    await wacht(200);
    ok(container.querySelector("[data-open-fem3d-report-fit]")?.textContent?.includes("gemonteerd na de permanente belasting"), "toelichting montage");
    ok(container.querySelector("[data-open-fem3d-report-cross-rule]")?.textContent?.startsWith("Kruisregel"), "toelichting kruisregel");
    mount(<OpenFem3DReport model={portaal} result={uitkomst(portaal, [])}
      combinations={combinaties as never} combinationResults={new Map([[11, uitkomst(portaal, [])]])} />);
    await wacht(200);
    ok(!container.querySelector("[data-open-fem3d-report-fit]") && !container.querySelector("[data-open-fem3d-report-cross-rule]"),
      "zonder instellingen geen toelichting");
  });
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el && !el.textContent) el.textContent = JSON.stringify({ tests, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, error: String(e?.stack ?? e) }); });

/**
 * Browserkant van test-open-fem3d-views-ui.mjs: de echte 3D-verkenner met de
 * echte tab Views, op een proefopstelling die de toestand van App.tsx nabootst
 * (zichtbaarheid, eigen views, rapportkeuze, actieve view, verkennertab), en het
 * echte 3D-rapport met de aangevinkte views.
 *
 * Zonder hash draait de testreeks en komt de uitslag als JSON in #uitslag. Met
 * `#beeld=tab|rapport` wordt alleen het beeld opgebouwd voor een schermafbeelding.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import nlCommon from "../src/i18n/locales/nl/common.json";
import nlRibbon from "../src/i18n/locales/nl/ribbon.json";
import enCommon from "../src/i18n/locales/en/common.json";
import deCommon from "../src/i18n/locales/de/common.json";
import frCommon from "../src/i18n/locales/fr/common.json";
import "../src/themes.css";
import "../src/App.css";
import OpenFem3DExplorer from "../src/components/openFem3d/OpenFem3DExplorer";
import OpenFem3DReport from "../src/components/openFem3d/OpenFem3DReport";
import { DEFAULT_DISPLAY_FLAGS } from "../src/components/fem/FemResultsOverlay";
import { DEFAULT_STRUCTURAL_GRID } from "../src/components/fem/femTypes";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, type OpenFem3DVisibility } from "../src/components/openFem3d/openFem3dVisibility";
import { parseOpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import type { OpenFem3DHuidigeWeergave, OpenFem3DStandaardViewId, OpenFem3DViewSet } from "../src/components/openFem3d/openFem3dViewSets";
import type { OpenFem3DViewStatus, OpenFem3DViewToepassing } from "../src/components/openFem3d/openFem3dStandaardViews";
import type { OpenFem3DSolveResult } from "../src/components/openFem3d/openFem3dSolver";

const tests: { name: string; error?: string }[] = [];
const container = document.getElementById("root")!;
let root = createRoot(container);
const noop = () => {};
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
const klik = (el: Element) => flushSync(() => (el as HTMLElement).click());
/** Een waarde in een gecontroleerd React-invoerveld zetten. */
function typ(input: HTMLInputElement, waarde: string) {
  const zet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  flushSync(() => { zet.call(input, waarde); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
const toets = (el: Element, key: string) => flushSync(() => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));

// ── Het model: een portaal met een lijnlast ──────────────────────────────
const model = parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 4 }, { id: 3, x: 6, y: 0, z: 4 }, { id: 4, x: 6, y: 0, z: 0 }],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA 300", material: "S235" },
    { id: 2, startNodeId: 2, endNodeId: 3, profileName: "IPE 400", material: "S235" },
    { id: 3, startNodeId: 4, endNodeId: 3, profileName: "HEA 300", material: "S235" },
  ],
  supports: [
    { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
    { nodeId: 4, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
  ],
  loads: [], memberPointLoads: [], thermalLoads: [], plates: [], surfaceLoads: [],
  memberLoads: [{ id: 1, beamId: 2, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -10, qzEnd: -10, startPositionM: 0, endPositionM: 6 }],
});
function resultaat(): OpenFem3DSolveResult {
  const r0 = { rx: 0, ry: 0, rz: 0 };
  return {
    schemaVersion: 1, engine: { id: "proef", name: "Proef", revision: "000000000000", license: "-" }, analysis: "linear",
    displacements: [
      { nodeId: 1, ux: 0, uy: 0, uz: 0, ...r0 }, { nodeId: 2, ux: 0.002, uy: 0, uz: -0.001, ...r0 },
      { nodeId: 3, ux: 0.002, uy: 0, uz: -0.001, ...r0 }, { nodeId: 4, ux: 0, uy: 0, uz: 0, ...r0 },
    ],
    reactions: [{ nodeId: 1, fx: 0, fy: 0, fz: 30, mx: 0, my: 0, mz: 0 }, { nodeId: 4, fx: 0, fy: 0, fz: 30, mx: 0, my: 0, mz: 0 }],
    memberForces: [1, 2, 3].map((memberId) => ({
      memberId, lengthM: 4, nStartKn: -30, nEndKn: -30, vyStartKn: 0, vyEndKn: 0,
      vzStartKn: memberId === 2 ? 30 : 0, vzEndKn: memberId === 2 ? -30 : 0,
      torsionStartKnm: 0, torsionEndKnm: 0, myStartKnm: 0, myEndKnm: 0, mzStartKnm: 0, mzEndKnm: 0,
    })),
    buckling: { status: "unavailable", reason: "-" }, diagnostics: [],
  } as unknown as OpenFem3DSolveResult;
}
const HUIDIG: OpenFem3DHuidigeWeergave = {
  view: "front", camera: { position: [3, -20, 2], target: [3, 0, 2], up: [0, 0, 1] },
  visibility: { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, momentY: true }, combinationId: null, loadCaseId: 1, mode: "loadCase",
};
const NIET: OpenFem3DViewStatus = { heeftResultaat: false, heeftCombinaties: false, heeftToetsing: false };
const ALLES: OpenFem3DViewStatus = { heeftResultaat: true, heeftCombinaties: true, heeftToetsing: true };

// ── Proefopstelling: de toestand zoals App.tsx hem bijhoudt ────────────────
let zicht: OpenFem3DVisibility = DEFAULT_OPEN_FEM_3D_VISIBILITY;
let viewSets: OpenFem3DViewSet[] = [];
let uitRapport: OpenFem3DStandaardViewId[] = [];
let toegepast: OpenFem3DViewToepassing[] = [];
let maatgevendGevraagd = 0;
let zetTab: (t: "project" | "view" | "results") => void = noop;
function Proef({ status = NIET, begin = [] as OpenFem3DViewSet[] }: { status?: OpenFem3DViewStatus; begin?: OpenFem3DViewSet[] }) {
  const [tab, setTab] = React.useState<"project" | "view" | "results">("project");
  const [z, setZ] = React.useState<OpenFem3DVisibility>(DEFAULT_OPEN_FEM_3D_VISIBILITY);
  const [vs, setVs] = React.useState<OpenFem3DViewSet[]>(begin);
  const [uit, setUit] = React.useState<OpenFem3DStandaardViewId[]>([]);
  const [actief, setActief] = React.useState<string | null>(null);
  zicht = z; viewSets = vs; uitRapport = uit; zetTab = setTab;
  return (
    <div className="left-panel-body" style={{ width: 300, height: 680, display: "flex", flexDirection: "column" }}>
      <OpenFem3DExplorer
        model={model} selection={null} setSelection={noop} result={null}
        activeTab={tab} setActiveTab={setTab} visibility={z} setVisibility={setZ}
        displayFlags={DEFAULT_DISPLAY_FLAGS} setDisplayFlags={noop} gridShow={false} setGridShow={noop}
        structuralGrid={DEFAULT_STRUCTURAL_GRID} setStructuralGridEnabled={noop}
        views={{
          viewSets: vs, onViewSetsChange: setVs, standaardUitRapport: uit, onStandaardUitRapportChange: setUit,
          status, visibility: z, actieveSleutel: actief, activeCombinationId: null, activeLoadCaseId: 1,
          maatgevendeCombinatie: () => { maatgevendGevraagd++; return 42; },
          huidig: () => HUIDIG,
          onToepassen: (w) => { toegepast.push(w); setZ(w.visibility); setActief(w.sleutel); },
        }}
      />
    </div>
  );
}
const tabs = () => [...container.querySelectorAll<HTMLButtonElement>(".fem-tree-tab")];
const viewsTab = () => container.querySelector<HTMLButtonElement>('.fem-tree-tab[data-tab="views"]')!;
const regel = (sleutel: string) => container.querySelector<HTMLLIElement>(`[data-open-fem3d-views] [data-view="${sleutel}"]`);
const knop = (sleutel: string) => regel(sleutel)!.querySelector<HTMLButtonElement>(".open-fem3d-views-toepassen")!;
const vinkje = (sleutel: string) => regel(sleutel)!.querySelector<HTMLInputElement>(".open-fem3d-views-rapport")!;

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", resources: {
      nl: { common: nlCommon, ribbon: nlRibbon }, en: { common: enCommon }, de: { common: deCommon }, fr: { common: frCommon },
    }, defaultNS: "common", fallbackNS: "common", initImmediate: false,
  });
  const t = (k: string, o?: Record<string, unknown>) => i18next.t(k, o);
  document.documentElement.setAttribute("data-theme", "light");
  const beeld = /beeld=([\w-]+)/.exec(location.hash)?.[1];
  if (beeld) {
    document.body.style.cssText = "margin:0;background:var(--theme-bg)";
    document.getElementById("uitslag")!.remove();
    if (beeld === "rapport") {
      const r = resultaat();
      mount(<div style={{ width: 1200, height: 700 }}><OpenFem3DReport model={model} result={r} caseResults={new Map([[1, r]])}
        combinationResults={new Map([[11, r]])} combinations={[{ id: 11, name: "UGT 1", type: "uls", factors: new Map([[1, 1.35]]) }]} /></div>);
      // Het beeld gaat over de views: scroll het rapport naar die sectie.
      await wacht(50);
      container.querySelector("[data-open-fem3d-rapport-views]")?.scrollIntoView();
    } else {
      const eigen = [{ id: "view-1", name: "Voorgevel", view: "front" as const, camera: HUIDIG.camera, visibility: HUIDIG.visibility, combinationId: null, loadCaseId: 1, mode: "loadCase" as const }];
      mount(<Proef status={{ heeftResultaat: true, heeftCombinaties: true, heeftToetsing: false }} begin={eigen} />);
      klik(viewsTab());
      klik(knop("standaard:vz"));
    }
    await wacht(200);
    return;
  }

  await test("3D-verkenner: vier tabs; Views toont de zes standaardviews en de eigen views", async () => {
    mount(<Proef />);
    gelijk(tabs().map((b) => b.textContent), [t("tree.projectTab"), t("tree.viewTab"), t("tree.resultsTab"), "Views"], "tabs");
    klik(viewsTab());
    ok(viewsTab().classList.contains("active"), "Views niet actief");
    gelijk([...container.querySelectorAll("[data-open-fem3d-views] [data-view] .open-fem3d-views-naam")].map((e) => e.textContent),
      ["Geometrie", "Belastingen", "Combinaties", "Dwarskracht Vz", "Reacties", "Spanningen"], "standaardviews");
    ok(container.textContent!.includes(t("openFem3dViews.eigen")) && container.textContent!.includes(t("openFem3dVisibility.noViewSets")), "eigen views");
  });

  await test("vóór Berekenen: de resultaatviews grijs met uitleg; Geometrie en Belastingen klikbaar", async () => {
    mount(<Proef />);
    klik(viewsTab());
    for (const id of ["geometrie", "belastingen"]) ok(!knop(`standaard:${id}`).disabled, `${id} uit`);
    for (const id of ["combinaties", "vz", "reacties", "spanningen"]) {
      const k = knop(`standaard:${id}`);
      ok(k.disabled, `${id} klikbaar`);
      gelijk(k.querySelector(".open-fem3d-views-sub")?.textContent, "Beschikbaar na Berekenen", `${id}: uitleg`);
      ok(regel(`standaard:${id}`)!.classList.contains("uit"), `${id}: grijs`);
    }
  });

  await test("een klik past de view toe en markeert hem; zelf een laag omzetten haalt de markering weg", async () => {
    toegepast = [];
    mount(<Proef />);
    klik(viewsTab());
    klik(knop("standaard:geometrie"));
    gelijk(toegepast.map((w) => [w.sleutel, w.view, w.camera, w.mode]), [["standaard:geometrie", "iso", null, "model"]], "toepassing");
    gelijk([zicht.profiles, zicht.loads, zicht.deformation], [true, false, false], "lagen");
    ok(regel("standaard:geometrie")!.classList.contains("actief") && knop("standaard:geometrie").getAttribute("aria-pressed") === "true", "niet gemarkeerd");
    ok(viewsTab().classList.contains("active"), "toepassen sluit de tab Views");
    // Zelf een laag aanzetten in de tab Weergave.
    klik(tabs()[1]);
    const lasten = [...container.querySelectorAll<HTMLButtonElement>(".fem-results-toggle")]
      .find((b) => b.querySelector(".fem-results-toggle-label")?.textContent === t("openFem3dVisibility.loads"))!;
    klik(lasten);
    gelijk(zicht.loads, true, "lasten aan");
    klik(viewsTab());
    ok(!regel("standaard:geometrie")!.classList.contains("actief"), "nog gemarkeerd na een eigen wijziging");
  });

  await test("na Berekenen: alles beschikbaar; Combinaties zonder actieve combinatie kiest de maatgevende", async () => {
    toegepast = []; maatgevendGevraagd = 0;
    mount(<Proef status={ALLES} />);
    klik(viewsTab());
    for (const id of ["combinaties", "vz", "reacties", "spanningen"]) ok(!knop(`standaard:${id}`).disabled, `${id} grijs`);
    gelijk(maatgevendGevraagd, 0, "pas uitrekenen als het nodig is");
    klik(knop("standaard:combinaties"));
    gelijk([maatgevendGevraagd, toegepast[0].combinationId, toegepast[0].mode, zicht.deformation], [1, 42, "results", true], "combinatie");
    klik(knop("standaard:vz"));
    gelijk([toegepast[1].combinationId, zicht.shearZ, zicht.deformation], [null, true, false], "Vz");
  });

  await test("in rapport: standaard alles aan; uitvinken en weer aanvinken wordt bewaard", async () => {
    mount(<Proef status={ALLES} />);
    klik(viewsTab());
    for (const id of ["geometrie", "belastingen", "combinaties", "vz", "reacties", "spanningen"]) ok(vinkje(`standaard:${id}`).checked, `${id} niet aangevinkt`);
    klik(vinkje("standaard:reacties"));
    klik(vinkje("standaard:geometrie"));
    gelijk(uitRapport, ["geometrie", "reacties"], "uit het rapport");
    ok(!vinkje("standaard:reacties").checked, "vinkje");
    klik(vinkje("standaard:reacties"));
    gelijk(uitRapport, ["geometrie"], "weer erin");
    ok(vinkje("standaard:reacties").getAttribute("aria-label") === "Reacties in het rapport", "toegankelijke naam");
  });

  await test("opslaan: de huidige camera en zichtbaarheid onder een naam; dezelfde naam werkt bij; in rapport aan", async () => {
    mount(<Proef />);
    klik(viewsTab());
    const naam = container.querySelector<HTMLInputElement>(".open-fem3d-views-opslaan input")!;
    gelijk(naam.placeholder, "Weergave 1", "standaardnaam");
    typ(naam, "Voorgevel");
    klik(container.querySelector(".open-fem3d-views-opslaan button")!);
    gelijk(viewSets.map((v) => [v.id, v.name, v.view, v.camera, v.mode, v.visibility.momentY]),
      [["view-1", "Voorgevel", "front", HUIDIG.camera, "loadCase", true]], "opgeslagen");
    ok(vinkje("view-1").checked, "in rapport standaard aan");
    gelijk(naam.value, "", "veld leeg na opslaan");
    // Leeg veld: de standaardnaam.
    klik(container.querySelector(".open-fem3d-views-opslaan button")!);
    gelijk(viewSets.map((v) => v.name), ["Voorgevel", "Weergave 2"], "standaardnaam");
    typ(naam, "voorgevel");
    klik(container.querySelector(".open-fem3d-views-opslaan button")!);
    gelijk(viewSets.map((v) => [v.id, v.name]), [["view-1", "voorgevel"], ["view-2", "Weergave 2"]], "bijgewerkt, geen dubbele");
  });

  await test("hernoemen (Enter), geweigerd bij een bestaande naam, Escape breekt af; verwijderen", async () => {
    const eigen = [
      { id: "view-1", name: "A", view: "iso" as const, camera: HUIDIG.camera, visibility: DEFAULT_OPEN_FEM_3D_VISIBILITY, combinationId: null },
      { id: "view-2", name: "B", view: "top" as const, camera: HUIDIG.camera, visibility: DEFAULT_OPEN_FEM_3D_VISIBILITY, combinationId: null },
    ];
    mount(<Proef begin={eigen} />);
    klik(viewsTab());
    klik(regel("view-1")!.querySelector('button[title="Hernoemen"]')!);
    const veld = regel("view-1")!.querySelector<HTMLInputElement>(".open-fem3d-views-hernoem")!;
    typ(veld, "b");
    toets(veld, "Enter");
    gelijk(container.querySelector('[role="alert"]')?.textContent, "Er is al een view met deze naam", "melding");
    gelijk(viewSets.map((v) => v.name), ["A", "B"], "ongewijzigd");
    typ(veld, "Portaal");
    toets(veld, "Enter");
    gelijk(viewSets.map((v) => v.name), ["Portaal", "B"], "hernoemd");
    ok(!container.querySelector('[role="alert"]'), "melding blijft staan");
    klik(regel("view-2")!.querySelector('button[title="Hernoemen"]')!);
    const veld2 = regel("view-2")!.querySelector<HTMLInputElement>(".open-fem3d-views-hernoem")!;
    typ(veld2, "Weg");
    toets(veld2, "Escape");
    gelijk(viewSets.map((v) => v.name), ["Portaal", "B"], "Escape");
    klik(regel("view-1")!.querySelector(`button[aria-label="${t("openFem3dVisibility.deleteViewSet", { name: "Portaal" })}"]`)!);
    gelijk(viewSets.map((v) => v.name), ["B"], "verwijderd");
  });

  await test("een eigen view toepassen: met zijn camera, belastinggeval en tab; gemarkeerd", async () => {
    toegepast = [];
    const eigen = [{ id: "view-7", name: "Gevel", view: "front" as const, camera: HUIDIG.camera, visibility: { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, reactions: false }, combinationId: 11, loadCaseId: 2, mode: "results" as const }];
    mount(<Proef begin={eigen} />);
    klik(viewsTab());
    klik(knop("view-7"));
    gelijk(toegepast.map((w) => [w.sleutel, w.view, w.camera, w.combinationId, w.loadCaseId, w.mode]),
      [["view-7", "front", HUIDIG.camera, 11, 2, "results"]], "toepassing");
    ok(regel("view-7")!.classList.contains("actief"), "niet gemarkeerd");
  });

  await test("kiest de app zelf een andere tab (Berekenen → Resultaten), dan sluit Views", async () => {
    mount(<Proef />);
    klik(viewsTab());
    ok(container.querySelector("[data-open-fem3d-views]"), "Views open");
    flushSync(() => zetTab("results"));
    ok(!container.querySelector("[data-open-fem3d-views]"), "Views blijft open");
    ok(container.querySelector("[data-open-fem3d-results-tab]"), "Resultaten niet zichtbaar");
    klik(viewsTab());
    klik(tabs()[0]);
    ok(container.querySelector(".fem-tree-body")!.textContent!.includes(t("tree.nodes")), "Project na een klik op Project");
  });

  await test("rapport: de aangevinkte views als afbeelding met titel, uitgevinkte niet; zonder berekening de reden", async () => {
    const r = resultaat();
    const eigen = [
      { id: "view-1", name: "Gevel", view: "front" as const, camera: HUIDIG.camera, visibility: { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, loads: true }, combinationId: null, loadCaseId: 1, mode: "loadCase" as const },
      { id: "view-2", name: "Niet in rapport", view: "top" as const, camera: HUIDIG.camera, visibility: DEFAULT_OPEN_FEM_3D_VISIBILITY, combinationId: null, inRapport: false },
    ];
    mount(<OpenFem3DReport model={model} result={r} caseResults={new Map([[1, r]])} combinationResults={new Map([[11, r]])}
      combinations={[{ id: 11, name: "UGT 1", type: "uls", factors: new Map([[1, 1.35]]) }]}
      viewSets={eigen} standaardViewsUitRapport={["spanningen"]} />);
    const figuren = [...container.querySelectorAll<HTMLElement>("[data-open-fem3d-rapport-views] [data-rapport-view]")];
    gelijk(figuren.map((f) => f.getAttribute("data-rapport-view")),
      ["standaard:geometrie", "standaard:belastingen", "standaard:combinaties", "standaard:vz", "standaard:reacties", "view-1"], "figuren");
    gelijk(figuren.map((f) => f.querySelector("figcaption")!.firstChild!.textContent),
      ["Geometrie", "Belastingen", "Combinaties", "Dwarskracht Vz", "Reacties", "Gevel"], "titels");
    ok(figuren.every((f) => f.querySelector("svg line[data-staaf]")), "elke figuur tekent de staven");
    ok(figuren[1].querySelectorAll("svg line[marker-end]").length >= 5, "Belastingen: lastpijlen");
    ok(figuren[2].textContent!.includes("UGT 1") && figuren[2].querySelector("svg polyline[stroke-dasharray]"), "Combinaties: vervormd, met naam");
    ok(figuren[3].querySelector('svg polygon[fill="#7c3aed"]'), "Vz: de dwarskrachtlijn");
    ok(figuren[4].querySelectorAll('svg line[stroke="#16a34a"]').length === 2, "Reacties: twee pijlen");
    ok(container.querySelector("[data-open-fem3d-rapport-views] h2")?.textContent === "Views", "sectietitel");
    // Zonder berekening: Geometrie en Belastingen wel, de resultaatviews met reden.
    mount(<OpenFem3DReport model={model} result={null} viewSets={[]} standaardViewsUitRapport={[]} />);
    const leeg = [...container.querySelectorAll<HTMLElement>("[data-rapport-view]")];
    gelijk(leeg.map((f) => Boolean(f.querySelector("svg"))), [true, true, false, false, false, false], "beeld of reden");
    gelijk(leeg[3].querySelector(".open-fem3d-report-view-leeg")?.textContent, "Beschikbaar na Berekenen", "reden");
  });

  await test("vier talen: de tab en de standaardviews in en, de en fr", async () => {
    mount(<Proef />);
    for (const [taal, tab, geo] of [["en", "Views", "Geometry"], ["de", "Ansichten", "Geometrie"], ["fr", "Vues", "Géométrie"]]) {
      await i18next.changeLanguage(taal);
      await wacht(30);
      klik(viewsTab());
      gelijk([viewsTab().textContent, knop("standaard:geometrie").querySelector(".open-fem3d-views-naam")!.textContent], [tab, geo], taal);
    }
    await i18next.changeLanguage("nl");
  });
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, error: String(e?.stack ?? e) }); });

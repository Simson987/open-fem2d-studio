// Het bedieningskanaal wacht nooit op een render die niet komt (issue #28).
//
// ── WAAROM DEZE TEST BESTAAT ───────────────────────────────────────────────
//
// `gui_set_view` naar de weergave die al actief was, wachtte 30 s en gaf dan
// "geen antwoord van de pagina". Oorzaak: `weergave_zetten` in
// src/bediening/bediening.ts riep `setActiveView(v)` aan en wachtte met
// `wachtOpRender` op de eerstvolgende commit. React slaat gelijke state over;
// was `v` al actief, dan kwam er geen commit en bleef de belofte open tot de
// time-out van Rust. `staaf_selecteren` en `analysetype_zetten` hadden
// dezelfde constructie.
//
// De reparatie: elke actie wacht op `verseRender` (een eigen tik die altijd
// commit). Deze test speelt dat na zonder app:
//
//   [1] gedrag  — `voerUit` met nagebootste acties en een `wachtOpRender` die
//                 NOOIT inlost (precies wat React doet als er niets
//                 verandert). Elke opdracht die niets verandert moet toch
//                 binnen korte tijd terugkomen, met de huidige toestand.
//   [2] bron    — in `voerUit` staat geen `await wachtOpRender()` meer, en
//                 `verseRender` zet echt een tik (anders zou [1] een
//                 nabootsing toetsen die de app niet doet).
//
// Uitvoeren: npx tsx test-bediening-wachten.mjs   (vanuit design-mockup/)
//        of: node scripts/run-tests.mjs --filter=bediening-wachten

import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));

// bediening.ts trekt via de rapportmodules stylesheets (KaTeX) mee; Node kent
// die niet. Een lege module volstaat: hier wordt geen opmaak gelezen.
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function load(url, ctx, next) {" +
        " if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };" +
        " return next(url, ctx); }",
    ),
);
const { voerUit } = await import("./src/bediening/bediening.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function check(naam, voorwaarde, detail = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}`); }
  else            { failed++; log(`  ✗ ${naam}${detail ? ` — ${detail}` : ""}`); }
}

// ── [1] gedrag ──────────────────────────────────────────────────────────────
log("\n[1] opdrachten die niets veranderen komen direct terug");

/** Nagebootste acties: een raamwerk met één staaf, weergave "default". */
function maakActies() {
  const staaf = { id: 1, nodeIds: [1, 2], material: "C30/37", checkConfig: {} };
  const toestand = { activeView: "default", selection: { type: "beam", id: 1 }, modelDimension: "2d", frameView: "iso" };
  const fem = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }],
    beams: [staaf],
    loads: [],
    loadCases: [],
    combinations: [],
    combinationResults: null,
    analysetype: "eersteOrde",
    addNode: () => 99,
    addBeam: () => 99,
    updateBeam: (id, u) => { if (id === staaf.id) Object.assign(staaf, u); },
    addSupport: () => {},
    addLoad: () => {},
    addLoadCase: () => {},
    setAnalysetype: (v) => { fem.analysetype = v; },
  };
  const acties = {
    fem,
    get modelDimension() { return toestand.modelDimension; },
    frame3d: {
      model: { nodes: [], beams: [], supports: [], loads: [] },
      visibility: { nodes: true, beams: true, profiles: false, nodeNumbers: true, beamNumbers: false, nodeCoordinates: false, supports: true, loads: true, grid: true, axes: true, structuralGrid: true },
      structuralGrid: { enabled: true, xAxes: [], yAxes: [], zAxes: [] },
      replaceModel(model) { this.model = model; toestand.modelDimension = "3d"; toestand.activeView = "frame3d"; },
      setVisibility(visibility) { this.visibility = visibility; },
      setStructuralGrid(grid) { this.structuralGrid = grid; },
      setView(view) { toestand.frameView = view; toestand.activeView = "frame3d"; },
      setSelection(selection) { toestand.selection = selection; },
      caseResults: new Map(),
      combinationResults: new Map(),
      activeCombinationId: null,
      generation: () => 0,
      },
    get activeView() { return toestand.activeView; },
    get selection() { return toestand.selection; },
    setSelection: (s) => { toestand.selection = s; },
    setActiveView: (v) => { toestand.activeView = v; },
    setBottomPanelOpen: () => {},
    handleRunMemberChecks: async () => {},
    rekenDoor: async () => ({ gelukt: true, fysisch: "nvt" }),
    rekenToestand: () => ({ herberekeningGepland: false, lopendeRekengangen: 0, generatie: 0, volledigeRekengang: null }),
    laatsteRekenfout: () => null,
    createDetachedWindow: async () => "los",
    laadProjectTekst: async () => {},
  };
  return acties;
}

// Een render die nooit komt: zo gedraagt React zich als de state niet wijzigt.
const nooit = () => new Promise(() => {});
let tikken = 0;
const vers = () => { tikken++; return Promise.resolve(); };

const GRENS_MS = 2000;
async function binnenGrens(naam, args, acties) {
  let timer;
  const verlopen = new Promise((los) => { timer = setTimeout(() => los("VERLOPEN"), GRENS_MS); });
  try {
    const uitkomst = await Promise.race([
      voerUit(naam, args, { current: acties }, nooit, vers),
      verlopen,
    ]);
    return uitkomst;
  } catch (err) {
    return { fout: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

{
  const a = maakActies();
  const t0 = tikken;
  const u = await binnenGrens("weergave_zetten", { view: "default" }, a);
  check("weergave_zetten naar de al actieve weergave komt terug (was: 30 s en een fout)",
    u !== "VERLOPEN" && u?.weergave === "default", JSON.stringify(u));
  check("… en heeft zelf een render geforceerd", tikken > t0);

  const u2 = await binnenGrens("weergave_zetten", { view: "check" }, a);
  check("weergave_zetten naar een andere weergave komt terug met die weergave",
    u2 !== "VERLOPEN" && u2?.weergave === "check", JSON.stringify(u2));
}
{
  const a = maakActies();
  const u = await binnenGrens("model_3d_bouwen", {
    nodes: [
      { x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }, { x: 6, y: 4, z: 0 }, { x: 0, y: 4, z: 0 },
      { x: 2, y: 1, z: 0 }, { x: 4, y: 1, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 2, y: 3, z: 0 },
    ],
    plates: [{ nodes: [1, 2, 3, 4], thickness_m: 0.25, material: "C30/37", corner_radius_m: 0.3,
      openings: [{ nodes: [5, 6, 7, 8], corner_radius_m: 0.15 }] }],
    surface_loads: [{ plate: 1, case_id: 2, qz: -5 }],
  }, a);
  check("model_3d_bouwen bewaart platen, ronde openingen en oppervlaktebelastingen",
    u !== "VERLOPEN" && u?.plateIds?.length === 1 && u?.aantalOppervlaktelasten === 1 && a.frame3d.model.plates[0]?.cornerRadiusM === 0.3 &&
    a.frame3d.model.plates[0]?.openings[0]?.cornerRadiusM === 0.15 && a.frame3d.model.surfaceLoads[0]?.qz === -5,
    JSON.stringify(u));
  const selected = await binnenGrens("plaat_3d_selecteren", { id: 1 }, a);
  check("plaat_3d_selecteren kiest de echte plaat in de 3D-werkruimte",
    selected !== "VERLOPEN" && selected?.id === 1 && a.selection?.type === "plate" && a.selection?.id === 1,
    JSON.stringify(selected));
}
{
  const a = maakActies();
  const u = await binnenGrens("model_3d_bouwen", {
    nodes: [{ x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }],
    beams: [{ from: 1, to: 2, profile_name: "IPE300", material: "S355" }],
    supports: [{ node: 1, type: "revoluteY", prescribed: { ux_m: 0.001 } }, { node: 2, springs: { kz_kn_per_m: 370 } }],
    loads: [{ node: 2, fz: -25 }],
    member_loads: [{ beam: 1, qz_start: -4, qz_end: -6, start_m: 1, end_m: 5 }],
    member_point_loads: [{ beam: 1, case_id: 2, py: 3, pz: -10, position_m: 2.5 }],
    thermal_loads: [{ beam: 1, case_id: 2, delta_t_uniform_k: 25, delta_t_gradient_z_k: -6 }],
  }, a);
  check("model_3d_bouwen opent één geldig 3D-model met profiel, oplegging en last",
    u !== "VERLOPEN" && u?.modelDimension === "3d" && u?.beamIds?.length === 1 &&
    a.frame3d.model.beams[0]?.profileName === "IPE300" && a.frame3d.model.supports.length === 2 &&
    a.frame3d.model.loads.length === 1 && a.frame3d.model.memberLoads[0]?.beamId === 1 &&
    a.frame3d.model.memberLoads[0]?.qzEnd === -6 && a.frame3d.model.memberLoads[0]?.endPositionM === 5 &&
    a.frame3d.model.memberPointLoads[0]?.py === 3 && a.frame3d.model.memberPointLoads[0]?.positionM === 2.5 &&
    a.frame3d.model.thermalLoads[0]?.deltaTUniformK === 25 && a.frame3d.model.thermalLoads[0]?.deltaTGradientZK === -6 &&
    u?.aantalStaafpuntlasten === 1 && u?.aantalTemperatuurlasten === 1 && u?.aantalOplegveren === 1 &&
    u?.aantalOpgelegdeVerplaatsingen === 1 && a.frame3d.model.supports[0]?.prescribed?.uxM === 0.001 &&
    a.frame3d.model.supports[1]?.springs?.kzKnPerM === 370,
    JSON.stringify(u));
  check("model_3d_bouwen bewaart een revolute Y als alleen Ry vrij",
    a.frame3d.model.supports[0]?.ux === true && a.frame3d.model.supports[0]?.uy === true &&
    a.frame3d.model.supports[0]?.uz === true && a.frame3d.model.supports[0]?.rx === true &&
    a.frame3d.model.supports[0]?.ry === false && a.frame3d.model.supports[0]?.rz === true,
    JSON.stringify(a.frame3d.model.supports[0]));

  const u2 = await binnenGrens("weergave_3d_configureren", {
    view: "top",
    visibility: { profiles: true, grid: false },
    structural_grid: {
      enabled: true,
      x_axes: [{ label: "A", position_m: 0 }],
      y_axes: [{ label: "1", position_m: 4 }],
      z_levels: [{ label: "+6", position_m: 6 }],
    },
  }, a);
  check("weergave_3d_configureren stuurt camera, profielvolume en X/Y/Z-stramien",
    u2 !== "VERLOPEN" && a.frame3d.visibility.profiles === true && a.frame3d.visibility.grid === false &&
    a.frame3d.structuralGrid.yAxes[0]?.position === 4000 && a.frame3d.structuralGrid.zAxes[0]?.position === 6000,
    JSON.stringify(u2));

  const u3 = await binnenGrens("staaf_3d_splitsen", { beamId: 1, ratio: 0.5 }, a);
  check("staaf_3d_splitsen knipt de echte modeltoestand en verdeelt alle staaflasten",
    u3 !== "VERLOPEN" && u3?.nodeId === 3 && u3?.secondBeamId === 2 &&
    a.frame3d.model.nodes.length === 3 && a.frame3d.model.beams.length === 2 &&
    a.frame3d.model.memberLoads.length === 2 && a.frame3d.model.memberLoads[1]?.beamId === 2 &&
    a.frame3d.model.memberLoads[0]?.qzEnd === -5 && a.frame3d.model.memberLoads[1]?.qzStart === -5 &&
    a.frame3d.model.memberPointLoads[0]?.beamId === 1 &&
    a.frame3d.model.thermalLoads.length === 2 && a.frame3d.model.thermalLoads[1]?.beamId === 2,
    JSON.stringify(u3));
}
{
  const a = maakActies();
  const u = await binnenGrens("staaf_selecteren", { id: 1 }, a);
  check("staaf_selecteren van de al geselecteerde staaf komt terug",
    u !== "VERLOPEN" && u?.id === 1, JSON.stringify(u));
}
{
  const a = maakActies();
  a.frame3d.replaceModel({ nodes: [], beams: [], supports: [], loads: [] });
  a.frame3d.result = null;
  a.frame3d.solveError = null;
  a.frame3d.checks = null;
  a.frame3d.concreteChecks = null;
  a.frame3d.solving = false;
  a.frame3d.checksRunning = false;
  a.frame3d.checksError = null;
  a.frame3d.solve = async () => {
    a.frame3d.result = { displacements: [], memberForces: [] };
    // React kan deze tussenrender publiceren vóór de afsluitende render.
    a.frame3d.checksRunning = true;
  };
  let renders = 0;
  const afronden = async () => {
    renders += 1;
    if (renders === 2) {
      a.frame3d.checksRunning = false;
      a.frame3d.checks = { results: [], skipped: [], notes: [] };
    }
  };
  const u = await voerUit("rekenen", {}, { current: a }, nooit, afronden);
  check("3D rekenen antwoordt pas na de afsluitende toetsingsrender",
    u?.checksRunning === false && u?.steel?.results?.length === 0 && renders === 2,
    JSON.stringify({ renders, uitkomst: u }));
}
{
  const a = maakActies();
  const u = await binnenGrens("analysetype_zetten", { analysetype: "eersteOrde" }, a);
  check("analysetype_zetten naar het huidige analysetype komt terug",
    u !== "VERLOPEN" && u?.analysetype === "eersteOrde", JSON.stringify(u));
}
{
  const a = maakActies();
  const u = await binnenGrens("model_bouwen", {}, a);
  check("model_bouwen zonder iets toe te voegen komt terug",
    u !== "VERLOPEN" && Array.isArray(u?.nodeIds) && u.nodeIds.length === 0, JSON.stringify(u));
}
{
  const a = maakActies();
  const u = await binnenGrens("model_laden", { tekst: "{}" }, a);
  check("model_laden (asynchroon) komt terug",
    u !== "VERLOPEN" && u?.aantalStaven === 1, JSON.stringify(u));
}
{
  const a = maakActies();
  const korf = { naam: "proef" };
  const u = await binnenGrens("korf_zetten", { beamId: 1, korf }, a);
  const u2 = await binnenGrens("korf_zetten", { beamId: 1, korf }, a);
  check("korf_zetten, ook twee keer dezelfde korf, komt terug",
    u !== "VERLOPEN" && u2 !== "VERLOPEN" && u2?.checkConfig?.betonKorf === korf, JSON.stringify(u2));
}
{
  // Een fout reist nog steeds mee (en niet als time-out).
  const a = maakActies();
  const u = await binnenGrens("staaf_selecteren", { id: 7 }, a);
  check("een onbekende staaf geeft direct de fout van de app",
    u !== "VERLOPEN" && /geen staaf met id 7/.test(u?.fout ?? ""), JSON.stringify(u));
}

// ── [2] bron ────────────────────────────────────────────────────────────────
log("\n[2] bronteksten");
const bron = readFileSync(join(HIER, "src", "bediening", "bediening.ts"), "utf8").replace(/\r\n/g, "\n");
const lichaam = /export async function voerUit\([\s\S]*?\n\}\n/.exec(bron)?.[0] ?? "";
check("voerUit is in de bron gevonden", lichaam.length > 1000, `lengte ${lichaam.length}`);
check("geen enkele actie in voerUit wacht kaal op de volgende render",
  !/await\s+wachtOpRender\s*\(/.test(lichaam));
check("verseRender forceert een commit met een eigen tik",
  /const verseRender = \(\) => \{\s*const p = wachtOpRender\(\);\s*setTik\(/.test(bron));

log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);

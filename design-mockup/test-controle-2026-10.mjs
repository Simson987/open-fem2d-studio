// Controle oktober 2026 (Open FEM Studio 2026.41.0): de punten K3, K5, B6, B7
// en B15 langs de app-route — model uit `testdata/controle-2026-10/`, doorrekenen
// zoals de app (engine, combinaties uit het bestand, selectie), de toetsbouwers,
// en de echte rekenkern via de toetsbrug. De verwachtingen zijn de HANDWAARDEN
// van de controle, niet wat het programma toen gaf.
//
//  K5 — uitkraging: de zakking van het vrije eind ten opzichte van de
//       inklemming, niet vanaf de koorde (2026.41.0: 3,25 mm waar 18,14 hoort),
//       en ℓ_rep = 2·L voor w_fin én w_add; ook voor hout.
//  B15 — w_fin van een stalen vloerligger tegen ℓ_rep/250, niet L/333.
//  B6 — 6.2.8 met (6.30) en één UC-definitie.
//  B7 — klasse 4 met effectieve breedtes in plaats van "niet toetsbaar".
//  K3 — hout trek met buiging (6.17).
//
// DE APP-ROUTE SINDS ISSUE #199. De toetsbouwers krijgen wat de app ze geeft:
// de UGT uit de toetsrekengang (altijd P-Δ met scheefstand φ = 1/noemer van
// het project, in +x en −x; `bepaalToetsKrachten2D`), de BGT uit de resultaten
// (`toetsSet2D`). K5 en B15 zijn BGT en lezen dus dezelfde resultaten als
// vóór #199. Voor B6 en B7 (UGT) staat bij het blok waarom de handwaarde ook
// met de toetskrachten blijft gelden; de eerste-ordewaarde van dezelfde toets
// wordt ter vergelijking getoond. K3 toetst de toetsrekengang tegen de hand
// (het knoopmoment op een scharnier; zie dat blok).
//
// Draaien met: npx tsx test-controle-2026-10.mjs
//         of : node scripts/run-tests.mjs --filter=controle-2026-10
// Vereist de release-toetsbrug: cargo build --release -p toetsbrug.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HIER, "..");
const DATA = join(HIER, "testdata", "controle-2026-10");
const win = process.platform === "win32";
const TOETSBRUG = join(REPO, "src-tauri", "target", "release", win ? "toetsbrug.exe" : "toetsbrug");

const { solveAllCases } = await import("./src/components/fem/solver/engine.ts");
const { defaultCombinations, combineResults } = await import("./src/components/fem/solver/combinations.ts");
const { selecteerCombinaties } = await import("./src/lib/combinatieSelectie.ts");
const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");
const { buildSteelCheckInputs, profileLookupKey, chordRelativeMaxMm } = await import("./src/lib/steelCheckBuilder.ts");
const { buildTimberCheckInputs } = await import("./src/lib/timberCheckBuilder.ts");
const { bepaalToetsKrachten2D, toetsSet2D } = await import("./src/lib/toetsKrachten.ts");
const { bepaalScheefstand, leidScheefstandGeometrieAf, toepasselijkeScheefstandNormen } =
  await import("./src/lib/scheefstandNorm.ts");

const PROFIELEN = JSON.parse(
  readFileSync(join(REPO, "src-tauri", "crates", "steel-profiles", "data", "profiles.json"), "utf8"),
);
const profileDb = new Map();
for (const p of PROFIELEN) {
  const k = profileLookupKey(p.name);
  if (!profileDb.has(k)) profileDb.set(k, p);
}

let passed = 0, failed = 0;
const log = (s = "") => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
}
/** Relatieve tolerantie, tegen de handwaarde. */
function dicht(naam, gemeten, hand, rel) {
  ok(naam, Number.isFinite(gemeten) && Math.abs(gemeten - hand) <= rel * Math.abs(hand),
    `${Number(gemeten).toFixed(4)} tegen hand ${hand.toFixed(4)}`);
}

// ── Doorrekenen zoals de app ────────────────────────────────────────────────
function laad(naam) {
  return JSON.parse(readFileSync(join(DATA, naam), "utf8"));
}
/** Combinaties uit het bestand (zoals de app ze opent), anders de standaardset. */
function reken(m) {
  const { perCase } = solveAllCases(bouwMultiInput(m));
  const uitBestand = (m.combinations ?? []).map((c) => ({
    ...c, factors: new Map(Object.entries(c.factors).map(([k, v]) => [Number(k), v])),
  }));
  const alle = uitBestand.length > 0 ? uitBestand : defaultCombinations(m.loadCases);
  const sel = selecteerCombinaties(alle, m.beams, m.plates ?? [], { loadCases: m.loadCases, nodes: m.nodes });
  const combinations = sel.actief;
  const combinationResults = new Map(combinations.map((c) => [c.id, combineResults(c, perCase)]));
  return { perCase, combinations, combinationResults, basis: bouwMultiInput(m) };
}
/**
 * De toetsset zoals de app hem maakt (issue #199): de UGT uit de eigen
 * toetsrekengang, de BGT uit de resultaten. Deze bestanden hebben geen
 * scheefstandvelden: dan geldt wat de app bij openen zet (vast 1/200, +x).
 */
function toetsset(m, r) {
  const normen = toepasselijkeScheefstandNormen(m.beams);
  const project = bepaalScheefstand(
    { bron: "vast", noemer: m.scheefstandNoemer ?? 200, hoogteM: null, aantalElementen: null },
    leidScheefstandGeometrieAf(m), normen,
  );
  const toets = bepaalToetsKrachten2D({
    basis: r.basis, combinaties: r.combinations,
    scheefstand: { project, normen, richting: m.scheefstandRichting ?? 1, modelAan: m.scheefstandEnabled ?? false },
    analysetype: m.analysetype ?? (m.nonlinearEnabled ? "tweedeOrdeGeometrisch" : "eersteOrde"),
    resultaten: { perCase: r.perCase, combinationResults: r.combinationResults },
  });
  if (toets.weigering) throw new Error(`toets geweigerd: ${toets.weigering.reden}`);
  return toetsSet2D(toets, { combinaties: r.combinations, combinationResults: r.combinationResults, perCase: r.perCase }, m.beams);
}
/** De toetsinvoer zoals de app: de toetsset, of met `eersteOrde` de resultaten zelf (de route van vóór #199). */
function staal(m, { eersteOrde = false } = {}) {
  const r = reken(m);
  const set = eersteOrde ? null : toetsset(m, r);
  return buildSteelCheckInputs({
    nodes: m.nodes, beams: m.beams, alleBeams: m.beams, supports: m.supports, plates: m.plates ?? [],
    combinations: set?.combinaties ?? r.combinations, combinationResults: set?.combinationResults ?? r.combinationResults,
    profileDb, loadCases: m.loadCases, ...(set ? { stabiliteit: set.stabiliteit } : {}),
  });
}
function hout(m, { eersteOrde = false } = {}) {
  const r = reken(m);
  const set = eersteOrde ? null : toetsset(m, r);
  return buildTimberCheckInputs({
    nodes: m.nodes, beams: m.beams, supports: m.supports,
    combinations: set?.combinaties ?? r.combinations, combinationResults: set?.combinationResults ?? r.combinationResults,
    loadCases: m.loadCases, gevallenMetLast: [...r.perCase.keys()], ...(set ? { stabiliteit: set.stabiliteit } : {}),
  });
}
function kern(opdracht, inputs) {
  const r = spawnSync(TOETSBRUG, [], {
    input: JSON.stringify({ opdracht, inputs }), encoding: "utf8", maxBuffer: 256 << 20,
  });
  if (r.status !== 0 || !r.stdout) throw new Error(`toetsbrug ${opdracht} faalde: ${(r.stderr ?? "").slice(0, 300)}`);
  const uit = JSON.parse(r.stdout);
  if (uit.fout) throw new Error(uit.fout);
  return uit;
}
const toets = (res, id) => res.checks.find((c) => c.id === id)?.kind?.data;
const heeftKern = existsSync(TOETSBRUG);
if (!heeftKern) ok("toetsbrug gevonden — bouw hem met `cargo build --release -p toetsbrug`", false, TOETSBRUG);

// ─────────────────────────────────────────────────────────────────────────
log("\n[K5] Stalen uitkraging HEA 200, L = 3000 mm: zakking vanaf de inklemming");
// Hand: w_G = qL⁴/8EI = 6,530 mm, w_Q = FL³/3EI = 11,608 mm (E = 210 000,
// I = 36,92·10⁶ mm⁴); w_kar = 18,138 mm. Dezelfde lijn vanaf de koorde: 3,253 mm.
// ℓ_rep = 6000 mm: w_fin ≤ 0,004·6000 = 24 mm (UC 0,756), w_add = 11,608 ≤ 18 mm
// (UC 0,645).
// ─────────────────────────────────────────────────────────────────────────
{
  const m = laad("k5-hea200-uitkraging.ifcfem");
  const E = 210000, I = 36.92e6, L = 3000;
  const wG = (5 * L ** 4) / (8 * E * I);
  const wQ = (10000 * L ** 3) / (3 * E * I);
  dicht("hand w_G = 6,530", wG, 6.530, 5e-4);
  dicht("hand w_kar = 18,138", wG + wQ, 18.138, 5e-4);

  const r = reken(m);
  const kar = r.combinations.find((c) => c.type === "sls" && c.standaard?.soort === "6.14b");
  const ef = r.combinationResults.get(kar.id).elements.get(1);
  // Ter controle van het mechanisme: de oude koordemaat geeft ~3,25 mm.
  dicht("koordemaat van dezelfde lijn ≈ 3,253 (de oude toetsmaat)", Math.abs(chordRelativeMaxMm(ef.deflection, ef.stations_mm)), 3.253, 3e-3);

  const inv = staal(m).inputs[0];
  ok("is_cantilever", inv.is_cantilever === true);
  dicht("w naar de kern = zakking vrije eind (6.14b)", -inv.deflection_actual_max_mm, wG + wQ, 2e-3);
  dicht("w₁ naar de kern = w_G (6.16b, alleen G)", -inv.deflection_permanent_mm, wG, 2e-3);
  ok("rapportregel noemt de inklemming, niet de koorde", inv.deflection_notes[0].startsWith("Uitkraging: w is de zakking"),
    inv.deflection_notes[0].slice(0, 60));
  if (heeftKern) {
    const uit = kern("check_steel_beams", [inv])[0];
    const fin = toets(uit, "deflection_w_fin"), add = toets(uit, "deflection_w_add");
    dicht("w_fin grens 0,004·ℓ_rep = 24 mm", fin.uc.rd, 24.0, 1e-12);
    dicht("w_fin UC = 18,138/24 = 0,756", fin.uc.uc, 0.756, 3e-3);
    dicht("w_add = 11,608 mm", add.uc.ed, wQ, 3e-3);
    dicht("w_add grens 0,003·ℓ_rep = 18 mm", add.uc.rd, 18.0, 1e-12);
    dicht("w_add UC = 0,645", add.uc.uc, 0.645, 3e-3);
    const L_ = (c) => c.variables.find((v) => v.symbol === "L").value;
    ok("w_fin en w_add op dezelfde ℓ_rep = 6000 mm", L_(fin) === 6000 && L_(add) === 6000, `${L_(fin)} / ${L_(add)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[K5] Houten uitkraging C24 100×300, L = 3000 mm");
// Hand: E_0,mean = 11 000, I = 2,25·10⁸ mm⁴; G: q = 1 N/mm → qL⁴/8EI = 4,0909;
// Q (cat. A, ψ₂ = 0,3): F = 2 kN op het eind → FL³/3EI = 7,2727; w_inst =
// 11,3636, w_qp = 4,0909 + 0,3·7,2727 = 6,2727, w₁ = 4,0909 mm.
// ─────────────────────────────────────────────────────────────────────────
{
  const basis = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 3000, z: 0 }],
    supports: [{ nodeId: 1, type: "fixed" }], plates: [],
    loadCases: [{ id: 1, name: "G", type: "dead" }, { id: 2, name: "Q", type: "live", categorie: "A" }],
    loads: [{ id: 1, type: "lineLoad", beamId: 1, caseId: 1, q: -1 }, { id: 2, type: "pointForce", nodeId: 2, caseId: 2, fz: -2 }],
    selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
  };
  const E = 11000, I = (100 * 300 ** 3) / 12, L = 3000;
  const wG = (1 * L ** 4) / (8 * E * I), wQ = (2000 * L ** 3) / (3 * E * I);
  for (const [naam, checkConfig] of [
    ["klasse uitkraging", { deflectionClass: "cantilever", serviceClass: 1 }],
    ["klasse vloer, vrij eind herkend", { serviceClass: 1 }],
  ]) {
    const m = { ...basis, beams: [{ id: 1, from: 1, to: 2, material: "C24", profile: "100x300", checkConfig }] };
    const inv = hout(m).inputs[0];
    dicht(`${naam}: w_inst = 11,364 (vanaf de inklemming)`, -inv.deflection_inst_mm, wG + wQ, 2e-3);
    dicht(`${naam}: w_qp = 6,273`, -inv.deflection_quasi_perm_mm, wG + 0.3 * wQ, 2e-3);
    dicht(`${naam}: w₁ = 4,091`, -inv.deflection_permanent_mm, wG, 2e-3);
    // ℓ_rep = 2·L: noemers op de staaflengte gehalveerd (250 → 125, 333 → 166,5/167).
    ok(`${naam}: w_fin-noemer op L = 125 (ℓ_rep/250)`, inv.deflection_limit_fin === 125, String(inv.deflection_limit_fin));
    ok(`${naam}: w_add-noemer op L ≈ 167 (3/1000·ℓ_rep)`, Math.abs(inv.deflection_limit_add - 1000 / 6) < 0.6, String(inv.deflection_limit_add));
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[B15] Stalen vloerligger IPE 300, L = 6000 mm: w_fin tegen ℓ_rep/250");
// Hand: w_fin = 9,617 + 5,129 = 14,746 mm tegen 24 mm → UC 0,614 (2026.41.0: 0,818).
// ─────────────────────────────────────────────────────────────────────────
{
  const inv = staal(laad("b15-ipe300-vloerligger.ifcfem")).inputs[0];
  // BGT uit de resultaten (issue #199, B6): de doorbuigingsvelden zijn die van
  // de route van vóór #199, tot op de bit.
  const doorbuiging = (i) => JSON.stringify(Object.entries(i).filter(([k]) => k.startsWith("deflection_")));
  ok("BGT: de doorbuigingsinvoer is die van de resultaten (bit-gelijk met de eerste-orderoute)",
    doorbuiging(inv) === doorbuiging(staal(laad("b15-ipe300-vloerligger.ifcfem"), { eersteOrde: true }).inputs[0]));
  ok("deflection_limit_class Floor", inv.deflection_limit_class === "Floor");
  ok("deflection_limit_numerator = 250 (de noemer die de kern toetst)", inv.deflection_limit_numerator === 250, String(inv.deflection_limit_numerator));
  dicht("w = 14,746 mm", -inv.deflection_actual_max_mm, 14.746, 2e-3);
  if (heeftKern) {
    const uit = kern("check_steel_beams", [inv])[0];
    dicht("w_fin grens = 24 mm", toets(uit, "deflection_w_fin").uc.rd, 24.0, 1e-12);
    dicht("w_fin UC = 0,614", toets(uit, "deflection_w_fin").uc.uc, 0.614, 2e-3);
    dicht("w_add UC = 0,285", toets(uit, "deflection_w_add").uc.uc, 0.285, 3e-3);
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[B6] IPE 300 S235, V_z,Ed = 300 kN: 6.2.8 volgens (6.30)");
// Hand: M_y,V,Rd = 130,70 kNm; staaf 1 (M = 100) UC 0,765, staaf 2 (M = 200)
// UC 1,530 — beide als M_y,Ed/M_y,V,Rd.
// Met de toetskrachten (issue #199): de puntlast 1,5·400 = 600 kN krijgt
// H = φ·V = 600/200 = 3 kN, die via het scharnier afgaat (N ≤ 3 kN in de
// ligger; 6.2.8 kent geen N). V en M blijven 300 kN en 100/200 kNm: de kleine
// N geeft via K_G en het P-δ-moment N·w(x) (sinds de staafkrachten uit
// (K_E + K_G)·u komen) een verwaarloosbaar verschil. De handwaarden gelden dus
// onveranderd. Gemeten: staaf 2 1,53062 tegen 1,53059 in eerste orde
// (+0,002 %; met alleen K_E·u was het 1,53063), ruim binnen de 2e-3.
// ─────────────────────────────────────────────────────────────────────────
if (heeftKern) {
  const inputs = staal(laad("b6-ipe300-buiging-dwarskracht.ifcfem")).inputs;
  const uit = kern("check_steel_beams", inputs);
  const eo = kern("check_steel_beams", staal(laad("b6-ipe300-buiging-dwarskracht.ifcfem"), { eersteOrde: true }).inputs);
  log(`    6.2.8 staaf 1/2: toetskrachten ${toets(uit[0], "6.2.8_combined_mv").uc.uc.toFixed(5)}/${toets(uit[1], "6.2.8_combined_mv").uc.uc.toFixed(5)}, ` +
    `eerste orde ${toets(eo[0], "6.2.8_combined_mv").uc.uc.toFixed(5)}/${toets(eo[1], "6.2.8_combined_mv").uc.uc.toFixed(5)}`);
  const mv1 = toets(uit[0], "6.2.8_combined_mv"), mv2 = toets(uit[1], "6.2.8_combined_mv");
  dicht("M_y,V,Rd = 130,70 kNm", mv1.value, 130.70, 5e-4);
  dicht("staaf 1: UC 0,765", mv1.uc.uc, 0.765, 2e-3);
  ok("staaf 1: voldoet", mv1.status === "Ok" && uit[0].status === "Ok", `${mv1.status} / ${uit[0].status}`);
  dicht("staaf 2: UC 1,530", mv2.uc.uc, 1.530, 2e-3);
  ok("staaf 2: één UC-definitie, ook bij voldoet niet", mv2.uc.formula_latex === "M_{y,Ed} / M_{y,V,Rd}", mv2.uc.formula_latex);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[B7] IPE 300 S355 onder druk: klasse 4 met A_eff");
// Hand: A_eff = 5269 mm², N_c,Rd = 1870,5 kN (UC 0,267), χ_z = 0,500,
// N_b,Rd = 936,0 kN (UC 0,534). 2026.41.0: alles "n.v.t.", uc_max 0.
// Met de toetskrachten (issue #199): de kop van de kolom hangt aan een rol in
// x, dus H = φ·V = 500/200 = 2,5 kN gaat rechtstreeks naar die oplegging en de
// kop verplaatst niet: geen moment, geen P-Δ. N blijft 1,5·333,3 = 500 kN en
// de handwaarden gelden onveranderd.
// ─────────────────────────────────────────────────────────────────────────
if (heeftKern) {
  const inputs = staal(laad("b7-ipe300-s355-klasse4.ifcfem")).inputs;
  const uit = kern("check_steel_beams", inputs);
  const eo = kern("check_steel_beams", staal(laad("b7-ipe300-s355-klasse4.ifcfem"), { eersteOrde: true }).inputs);
  log(`    uc_max staaf 1: toetskrachten ${uit.find((r) => r.beam_id === 1).uc_max.toFixed(5)}, ` +
    `eerste orde ${eo.find((r) => r.beam_id === 1).uc_max.toFixed(5)}`);
  const s1 = uit.find((r) => r.beam_id === 1);
  ok("staaf 1 klasse 4", s1.classification === "Class4");
  ok("staaf 1 getoetst (status niet n.v.t.)", s1.status !== "NotApplicable", s1.governing_check_id);
  dicht("N_c,Rd = 1870,5 kN", toets(s1, "6.2.4_compression").value, 1870.5, 5e-4);
  dicht("N_b,Rd = 936,0 kN", toets(s1, "6.3.1_buckling").value, 936.0, 2e-3);
  dicht("uc_max = 0,534", s1.uc_max, 0.534, 2e-3);
  for (const r of uit) {
    ok(`staaf ${r.beam_id}: nooit "voldoet" met uc_max 0`, !(r.status === "Ok" && r.uc_max === 0), `${r.status} ${r.uc_max}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[K3] GL24h 90×180 onder trek met buiging: (6.17)");
// Hand: (6.17) = 0,5480 (staaf 1) en 1,0960 (staaf 2, voldoet niet).
// LANGS DE TOETSREKENGANG VAN DE APP (issue #199, altijd P-Δ met scheefstand).
// Het maatgevende moment is het knoopmoment op het scharnier, 1,5·2 = 3,000
// kNm (staaf 1) en 6,000 kNm (staaf 2): een opgelegd moment, dat P-Δ niet
// verandert. De handwaarden gelden dus ook voor de toetskrachten.
// TOT OKTOBER 2026 gaf deze route 0,5275 / 1,0182 (3,7 % en 7,1 % aan de
// onveilige kant): de kern rekende de staafeindkrachten na P-Δ met alleen
// K_E·u (BeamForces.ts), terwijl het stelsel K_E + K_G bevat. Staaf 1 kreeg
// M = 2,831 kNm waar 3,000 kNm aangrijpt (trek 40 kN, N·L²/EI = 0,72). Met
// (K_E + K_G)·u sluit het knoopevenwicht en geeft de route de handwaarde
// (gemeten 0,54801 / 1,09603, gelijk aan eerste orde). Dit punt bewaakt dat:
// het toetst de UC van de toetsrekengang tegen de hand, en de eerste orde
// ernaast als tegenproef van de kern.
// ─────────────────────────────────────────────────────────────────────────
if (heeftKern) {
  const uit = kern("check_timber_beams", hout(laad("k3-gl24h-trek-buiging.ifcfem")).inputs);
  const eo = kern("check_timber_beams", hout(laad("k3-gl24h-trek-buiging.ifcfem"), { eersteOrde: true }).inputs);
  log(`    (6.17) staaf 1/2: toetsrekengang (P-Δ) ${[1, 2].map((id) => toets(uit.find((x) => x.beam_id === id), "6.2.3_bending_tension").uc.uc.toFixed(5)).join("/")}, ` +
    `eerste orde ${[1, 2].map((id) => toets(eo.find((x) => x.beam_id === id), "6.2.3_bending_tension").uc.uc.toFixed(5)).join("/")}`);
  for (const [id, hand] of [[1, 0.5480], [2, 1.0960]]) {
    dicht(`staaf ${id}: eerste orde (de kern met de handkrachten): (6.17) = ${hand}`,
      toets(eo.find((x) => x.beam_id === id), "6.2.3_bending_tension").uc.uc, hand, 2e-3);
  }
  for (const [id, hand, status] of [[1, 0.5480, "Ok"], [2, 1.0960, "NotOk"]]) {
    const r = uit.find((x) => x.beam_id === id);
    const t = toets(r, "6.2.3_bending_tension");
    dicht(`staaf ${id}: (6.17) = ${hand}`, t.uc.uc, hand, 2e-3);
    // De staaf als geheel: de hulplast van het model geeft ook een grote
    // doorbuiging (buiten dit punt), dus alleen de toets zelf en "voldoet niet"
    // van staaf 2 liggen hier vast.
    ok(`staaf ${id}: 6.2.3 status ${status}`, t.status === status, t.status);
    if (status === "NotOk") ok(`staaf ${id}: voldoet niet`, r.status === "NotOk", r.status);
    ok(`staaf ${id}: geen druk- of knik-UC bij trek`, toets(r, "6.1.4_compression").uc === null && toets(r, "6.3.2_column_stability").uc === null);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// K5 — HERZIENING: welk eind is vrij, en welk deel is de uitkraging.
// Een eind dat als "vrij" telt terwijl het gedragen wordt, maakt een gewone
// overspanning een uitkraging: meting vanaf de inklemming en ℓ_rep = 2·L, dus
// een twee keer te ruime grens. En bij een uitkraging is w_add het grootste
// verschil met w₁ per combinatie, niet w − w₁ van de combinatie met de
// grootste |w|.
// ─────────────────────────────────────────────────────────────────────────
const LC_GQ = [{ id: 1, name: "G", type: "dead" }, { id: 2, name: "Q", type: "live", categorie: "A" }];
const ALGEMEEN = { selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1, loadCases: LC_GQ };
const houtVan = (m, opties = {}) => {
  const r = reken(m);
  return buildTimberCheckInputs({
    nodes: m.nodes, beams: opties.beams ?? m.beams, alleBeams: opties.alleBeams ?? m.beams, supports: m.supports,
    plates: m.plates ?? [], combinations: r.combinations, combinationResults: r.combinationResults,
    loadCases: m.loadCases, gevallenMetLast: [...r.perCase.keys()],
  });
};
const staalVan = (m, opties = {}) => {
  const r = reken(m);
  return buildSteelCheckInputs({
    nodes: m.nodes, beams: opties.beams ?? m.beams, alleBeams: opties.alleBeams ?? m.beams, supports: m.supports,
    plates: m.plates ?? [], combinations: r.combinations, combinationResults: r.combinationResults, profileDb,
    loadCases: m.loadCases,
  });
};
const isKoorde = (inv) => inv.deflection_notes[0].startsWith("w is gemeten vanaf de koorde");

log("\n[K5] Hout op een scharnier en een kolom: geen uitkraging, ook bij een deelselectie (beam_ids)");
{
  // Ligger 1 van een scharnier (knoop 1) naar een kolomkop (knoop 2); kolom 2
  // staat ingeklemd op knoop 3. Knoop 2 draagt de kolom: geen vrij eind.
  const m = { ...ALGEMEEN, plates: [],
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 4000, z: 0 }, { id: 3, x: 4000, z: -3000 }],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 3, type: "fixed" }],
    loads: [{ id: 1, type: "lineLoad", beamId: 1, caseId: 1, q: -1 }, { id: 2, type: "lineLoad", beamId: 1, caseId: 2, q: -1.5 }],
    beams: [
      { id: 1, from: 1, to: 2, material: "C24", profile: "100x300", checkConfig: { serviceClass: 1 } },
      { id: 2, from: 3, to: 2, material: "C24", profile: "200x200", checkConfig: { serviceClass: 1 } },
    ],
  };
  const app = houtVan(m).inputs.find((i) => i.beam_id === 1);
  ok("app-route: noemers 250/333 (veld)", app.deflection_limit_fin === 250 && app.deflection_limit_add === 1000 / 3, `${app.deflection_limit_fin}/${app.deflection_limit_add}`);
  ok("app-route: gemeten vanaf de koorde", isKoorde(app), app.deflection_notes[0].slice(0, 50));
  // check_fem_model met beam_ids [1]: de sidecar geeft het hele model als alleBeams.
  const selectie = houtVan(m, { beams: [m.beams[0]] }).inputs[0];
  ok("selectie [1] met het hele model: 250/333, koorde (tot de herziening 125/166,5)",
    selectie.deflection_limit_fin === 250 && selectie.deflection_limit_add === 1000 / 3 && isKoorde(selectie),
    `${selectie.deflection_limit_fin}/${selectie.deflection_limit_add}`);
  // De variant (stores/variantStore.ts) toetst één staaf, nu met het hele model.
  const variant = houtVan(m, { beams: [{ ...m.beams[0], profile: "100x350" }],
    alleBeams: m.beams.map((b) => (b.id === 1 ? { ...b, profile: "100x350" } : b)) }).inputs[0];
  ok("variant-aanroepvorm (hout): 250/333", variant.deflection_limit_fin === 250 && isKoorde(variant), String(variant.deflection_limit_fin));
  const mStaal = { ...m, beams: [
    { id: 1, from: 1, to: 2, material: "S235", profile: "IPE240" },
    { id: 2, from: 3, to: 2, material: "S235", profile: "HEA200" },
  ] };
  const staalVariant = staalVan(mStaal, { beams: [{ ...mStaal.beams[0], profile: "IPE270" }],
    alleBeams: mStaal.beams.map((b) => (b.id === 1 ? { ...b, profile: "IPE270" } : b)) }).inputs[0];
  ok("variant-aanroepvorm (staal): geen uitkraging, geen vrij eind",
    staalVariant.is_cantilever === false && staalVariant.staafeinden === undefined, JSON.stringify(staalVariant.staafeinden));
  // En de variantstore geeft het hele model en de platen werkelijk mee.
  const variantBron = readFileSync(join(HIER, "src", "stores", "variantStore.ts"), "utf8");
  ok("variantStore: alleBeams en plates naar beide bouwers",
    /alleBeams: data\.beams\.map\(\(b\) => \(b\.id === variantBeam\.id \? variantBeam : b\)\)/.test(variantBron) && /plates: data\.plates,/.test(variantBron));
  const sidecarBron = readFileSync(join(HIER, "src", "mcp", "sidecar.ts"), "utf8");
  ok("sidecar: de houtbouwer krijgt het hele model en de platen",
    /const houtData = \{[\s\S]*?alleBeams: teToetsen,[\s\S]*?plates: gelezen\.model\.plates,/.test(sidecarBron));
}

log("\n[K5] Ligger op een wandschijf: hoek- en randknoop zijn geen vrij eind");
{
  // Hout op de HOEKKNOOP van een wandschijf (knoop 2 = hoek van plaat 1).
  const hoek = { ...ALGEMEEN,
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 5000, z: 0 }, { id: 4, x: 7000, z: 0 }, { id: 5, x: 7000, z: -3000 }, { id: 6, x: 5000, z: -3000 }],
    beams: [{ id: 1, from: 1, to: 2, material: "C24", profile: "100x300", checkConfig: { serviceClass: 1 } }],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 5, type: "pinned" }, { nodeId: 6, type: "pinned" }],
    plates: [{ id: 1, nodeIds: [2, 4, 5, 6], thickness: 200, materiaal: "C30/37" }],
    loads: [{ id: 1, type: "lineLoad", beamId: 1, caseId: 1, q: -1.5 }, { id: 2, type: "lineLoad", beamId: 1, caseId: 2, q: -2 }],
  };
  const h = houtVan(hoek).inputs[0];
  ok("hout op de plaathoek: 250/333 en koorde (tot de herziening 125/166,5)",
    h.deflection_limit_fin === 250 && h.deflection_limit_add === 1000 / 3 && isKoorde(h), `${h.deflection_limit_fin}/${h.deflection_limit_add}`);

  // Staal IPE 200 dat MIDDEN op de bovenrand van een wandschijf eindigt (knoop
  // 7 ligt op de rand 2–4, geen hoek). Het rekennet koppelt die knoop aan de
  // plaat; met de hand is w de veldzakking van een vrij opgelegde ligger,
  // 5qL⁴/384EI met q_kar = 3,5 N/mm, L = 5000 mm, I = 19,43·10⁶ mm⁴:
  // 6,98 mm (de wand geeft zelf nauwelijks mee).
  const rand = { ...ALGEMEEN,
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 7, x: 5000, z: 0 }, { id: 2, x: 5000, z: 1000 }, { id: 4, x: 7000, z: 1000 }, { id: 5, x: 7000, z: -3000 }, { id: 6, x: 5000, z: -3000 }],
    beams: [{ id: 1, from: 1, to: 7, material: "S235", profile: "IPE200" }],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 5, type: "pinned" }, { nodeId: 6, type: "pinned" }],
    plates: [{ id: 1, nodeIds: [2, 4, 5, 6], thickness: 200, materiaal: "C30/37" }],
    loads: [{ id: 1, type: "lineLoad", beamId: 1, caseId: 1, q: -1.5 }, { id: 2, type: "lineLoad", beamId: 1, caseId: 2, q: -2 }],
  };
  const s = staalVan(rand).inputs[0];
  ok("staal op de plaatrand: geen uitkraging (tot de herziening is_cantilever true)", s.is_cantilever === false, String(s.is_cantilever));
  ok("staal op de plaatrand: geen vrij eind", s.staafeinden === undefined, JSON.stringify(s.staafeinden));
  ok("staal op de plaatrand: gemeten vanaf de koorde", isKoorde(s));
  const I = 19.43e6, E = 210000, L = 5000;
  dicht("staal op de plaatrand: w ≈ 5·3,5·L⁴/384EI = 6,98 mm", -s.deflection_actual_max_mm, (5 * 3.5 * L ** 4) / (384 * E * I), 0.02);
  if (heeftKern) {
    const fin = toets(kern("check_steel_beams", [s])[0], "deflection_w_fin");
    dicht("staal op de plaatrand: grens ℓ_rep/250 = 20 mm (niet 40)", fin.uc.rd, 20.0, 1e-12);
  }
}

log("\n[K5] Overstek: punt omhoog onder G, omlaag onder Q — w_add per combinatie");
// IPE 300 S235 (I = 83,6·10⁶ mm⁴), veld 6 m op een scharnier en een rol, overstek
// a = 2 m. G = 15,1 kN/m alleen op het veld, Q = 41 kN op de punt. Met de hand:
//   punt onder G: omhoog qL³a/(24EI) = 15,482 mm (w₁ = +15,482)
//   punt onder Q: omlaag F·a²·(L + a)/(3EI) = 24,911 mm
//   karakteristiek (G + Q): 15,482 − 24,911 = −9,429 mm
// w_fin = max|w_c| = 15,482 mm tegen 0,004·2·2000 = 16 mm → UC 0,968;
// w_add = max|w_c − w₁| = |−9,429 − 15,482| = 24,911 mm tegen 0,003·4000 = 12 mm
// → UC 2,076. Tot de herziening: w_add = w − w₁ = 0 (UC 0).
{
  const m = { ...ALGEMEEN, plates: [],
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }, { id: 3, x: 8000, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, material: "S235", profile: "IPE300" }, { id: 2, from: 2, to: 3, material: "S235", profile: "IPE300" }],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
    loads: [{ id: 1, type: "lineLoad", beamId: 1, caseId: 1, q: -15.1 }, { id: 3, type: "pointForce", nodeId: 3, caseId: 2, fz: -41 }],
  };
  const E = 210000, I = 83.6e6, L = 6000, a = 2000;
  const wG = (15.1 * L ** 3 * a) / (24 * E * I);
  const wQ = (41000 * a ** 2 * (L + a)) / (3 * E * I);
  dicht("hand: punt omhoog onder G = 15,482 mm", wG, 15.482, 5e-4);
  dicht("hand: punt omlaag onder Q = 24,911 mm", wQ, 24.911, 5e-4);
  const inv = staalVan(m).inputs.find((i) => i.beam_id === 2);
  ok("overstek: uitkraging", inv.is_cantilever === true);
  dicht("w naar de kern = max|w_c| = 15,482 (de blijvende combinatie)", Math.abs(inv.deflection_actual_max_mm), wG, 2e-3);
  dicht("w₁ = +15,482 (omhoog)", inv.deflection_permanent_mm, wG, 2e-3);
  ok("w_add apart naar de kern", typeof inv.deflection_add_mm === "number", String(inv.deflection_add_mm));
  dicht("w_add = w_kar − w₁ = −24,911 mm", inv.deflection_add_mm, -wQ, 2e-3);
  if (heeftKern) {
    const uit = kern("check_steel_beams", [inv])[0];
    const fin = toets(uit, "deflection_w_fin"), add = toets(uit, "deflection_w_add");
    dicht("w_fin grens 0,004·4000 = 16 mm", fin.uc.rd, 16.0, 1e-12);
    dicht("w_fin UC = 15,482/16 = 0,968", fin.uc.uc, wG / 16, 2e-3);
    dicht("w_add = 24,911 mm (tot de herziening 0)", add.uc.ed, wQ, 2e-3);
    dicht("w_add grens 0,003·4000 = 12 mm", add.uc.rd, 12.0, 1e-9);
    dicht("w_add UC = 2,076: voldoet niet", add.uc.uc, wQ / 12, 2e-3);
    ok("w_add: voldoet niet", add.status === "NotOk", add.status);
  }
}

log("\n[K5] Doorgaande lijn over een kolomkop met overstek: veld en overstek apart");
// IPE 300 (I = 83,6·10⁶) van een scharnier (x = 0) over een pendelkolom HEA 300
// (x = L = 6000, scharnier aan beide einden) naar een vrij eind (x = 8000):
// delen 1 en 2 vormen één doorgaande lijn, knoop 2 draagt de kolom. G: q = 8
// kN/m over de hele lijn; Q: F = 20 kN op de punt. Met de hand (ligger op twee
// steunpunten met overstek a = 2000; de kolom kort δ_B = R_B·h/EA in):
//   punt onder G, t.o.v. de kolomkop: q·a⁴/8EI − q·L³·a/24EI + q·a³·L/6EI (+ a·δ_B/L)
//   punt onder Q, t.o.v. de kolomkop: F·a²·(L + a)/3EI (+ a·δ_B/L)
// ℓ_rep: overstek 2·2000 = 4000 mm (grenzen 16 en 12 mm), veld 6000 mm (24 en
// 18 mm) — niet 2·8000 = 16 000 mm voor de hele lijn (tot de herziening: 64 en
// 48 mm). Het overstek is hier maatgevend.
{
  const m = { ...ALGEMEEN, plates: [],
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }, { id: 3, x: 8000, z: 0 }, { id: 4, x: 6000, z: -3000 }],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 4, type: "pinned" }],
    loads: [
      { id: 1, type: "lineLoad", beamId: 1, caseId: 1, q: -8 }, { id: 2, type: "lineLoad", beamId: 2, caseId: 1, q: -8 },
      { id: 3, type: "pointForce", nodeId: 3, caseId: 2, fz: -20 },
    ],
    beams: [
      { id: 1, from: 1, to: 2, material: "S235", profile: "IPE300" },
      { id: 2, from: 2, to: 3, material: "S235", profile: "IPE300" },
      { id: 3, from: 4, to: 2, material: "S235", profile: "HEA300", releases: { endRy: true } },
    ],
  };
  const E = 210000, I = 83.6e6, L = 6000, a = 2000, h = 3000;
  const A_kolom = PROFIELEN.find((p) => p.name === "HEA 300").properties.area_mm2;
  const zakkingB = (R) => (R * h) / (E * A_kolom);
  const q = 8;
  const RG = (q * (L + a) ** 2) / (2 * L), RQ = (20000 * (L + a)) / L;
  const puntG = (q * a ** 4) / (8 * E * I) - (q * L ** 3 * a) / (24 * E * I) + (q * a ** 3 * L) / (6 * E * I) + (a * zakkingB(RG)) / L;
  const puntQ = (20000 * a ** 2 * (L + a)) / (3 * E * I) + (a * zakkingB(RQ)) / L;
  const inv = staalVan(m).inputs.find((i) => i.beam_id === 1);
  ok("lijn: getoetst als één staaf van 8 m", Math.abs(inv.length_m - 8) < 1e-9, String(inv.length_m));
  ok("lijn: het overstek is maatgevend — deel van 2 m, als uitkraging",
    inv.deflection_length_m !== undefined && Math.abs(inv.deflection_length_m - 2) < 1e-9 && inv.is_cantilever === true,
    `${inv.deflection_length_m} ${inv.is_cantilever}`);
  ok("lijn: de toelichting noemt beide delen", inv.deflection_notes.some((n) => n.startsWith("Doorgaande lijn met een overstek") && n.includes("veld") && n.includes("overstek")));
  dicht("w = zakking van de punt t.o.v. de kolomkop (G + Q)", Math.abs(inv.deflection_actual_max_mm), Math.abs(puntQ + puntG), 3e-3);
  dicht("w₁ = punt onder G (omhoog)", -inv.deflection_permanent_mm, puntG, 3e-3);
  if (heeftKern) {
    const uit = kern("check_steel_beams", [inv])[0];
    const fin = toets(uit, "deflection_w_fin"), add = toets(uit, "deflection_w_add");
    dicht("w_fin grens 0,004·2·2000 = 16 mm (tot de herziening 64 mm)", fin.uc.rd, 16.0, 1e-9);
    dicht("w_add grens 0,003·4000 = 12 mm (tot de herziening 48 mm)", add.uc.rd, 12.0, 1e-9);
    dicht("w_add = F·a²(L+a)/3EI = 12,15 mm", add.uc.ed, puntQ, 3e-3);
    ok("w_add: voldoet niet (12,15 > 12)", add.status === "NotOk", `${add.uc.ed} / ${add.uc.rd}`);
  }
  // Dezelfde lijn in hout C24 100×300: de noemers op de lijnlengte volgen uit
  // ℓ_rep van het maatgevende deel. Overstek: 250·8000/4000 = 500 en
  // (1000/3)·8000/4000 = 666,67 (= ℓ_rep/250 en 3/1000·ℓ_rep met ℓ_rep = 4000 mm, issue #236).
  const mHout = { ...m, beams: [
    { id: 1, from: 1, to: 2, material: "C24", profile: "100x300", checkConfig: { serviceClass: 1 } },
    { id: 2, from: 2, to: 3, material: "C24", profile: "100x300", checkConfig: { serviceClass: 1 } },
    { id: 3, from: 4, to: 2, material: "C24", profile: "200x200", checkConfig: { serviceClass: 1 }, releases: { endRy: true } },
  ] };
  const hi = houtVan(mHout).inputs.find((i) => i.beam_id === 1);
  ok("hout-lijn: noemers op de lijnlengte uit ℓ_rep van het overstek (500/666)",
    Math.abs(hi.deflection_limit_fin - 500) < 1e-9 && Math.abs(hi.deflection_limit_add - 2000 / 3) < 1e-9,
    `${hi.deflection_limit_fin}/${hi.deflection_limit_add}`);
  // De lijnnotitie spreekt de toets per deel niet tegen (review samenvoeging
  // 2026.42): niet "de koorde van de doorbuiging over de hele lengte" of "de
  // aansluiting niet meegeteld voor de doorbuiging" naast "veld en overstek
  // apart, vanaf de inklemming op x = 6000".
  const sn = inv.staaf_notities ?? [];
  // De notities alleen in de uitvoer bij een fout: ze zijn lang.
  const okNotities = (naam, voorwaarde, notities) => ok(naam, voorwaarde, voorwaarde ? "" : JSON.stringify(notities));
  okNotities("lijn: de notities zeggen dat de doorbuiging per deel is getoetst, met knoop 2 als grens",
    sn.some((n) => /^DOORGAANDE LIJN/.test(n) && /De doorbuiging is per deel getoetst/.test(n) && /tussenknoop 2 als grens/.test(n))
    && sn.some((n) => /^Op tussenknoop 2 sluit staaf 3 aan\./.test(n) && /Voor de doorbuiging is de knoop wel een steunpunt/.test(n)),
    sn);
  okNotities("lijn: geen tegenstrijdige zin over de doorbuiging over de hele lijn",
    !sn.some((n) => /koorde van de doorbuiging gelden voor die hele lengte/.test(n)
      || /meegeteld voor de kip en de doorbuiging/.test(n) || /De kip en de doorbuiging lopen over de hele lijn/.test(n)),
    sn);
  ok("lijn: vrij eind, dus geen kniklengte per vak (KNIK PER VAK NIET TOEGEPAST)",
    inv.buckling_length_y_m === 0 && inv.buckling_length_z_m === 0
    && sn.some((n) => /^KNIK PER VAK NIET TOEGEPAST/.test(n)),
    `${inv.buckling_length_y_m}/${inv.buckling_length_z_m}`);

  // ── Dezelfde lijn met op x = 7000 een onbelaste paal HEA 100 met vrije kop
  // (review samenvoeging 2026.42). De paal houdt niets vast (K6), dus de
  // constructie en de delen veranderen niet: veld 0–6000, overstek 6000–8000
  // vanaf de kolomkop, dezelfde zakking. Tot de review telde de paal als
  // steunpunt: overstek 7000–8000 (ℓ_rep 2000) en veld 0–7000 (ℓ_rep 7000 —
  // onveilig, want het veld is 6 m).
  const metPaal = {
    ...m,
    nodes: [...m.nodes, { id: 5, x: 7000, z: 0 }, { id: 6, x: 7000, z: 1000 }],
    beams: [
      { id: 1, from: 1, to: 2, material: "S235", profile: "IPE300" },
      { id: 2, from: 2, to: 5, material: "S235", profile: "IPE300" },
      { id: 4, from: 5, to: 3, material: "S235", profile: "IPE300" },
      { id: 3, from: 4, to: 2, material: "S235", profile: "HEA300", releases: { endRy: true } },
      { id: 5, from: 5, to: 6, material: "S235", profile: "HEA100" },
    ],
    loads: [
      { id: 1, type: "lineLoad", beamId: 1, caseId: 1, q: -8 }, { id: 2, type: "lineLoad", beamId: 2, caseId: 1, q: -8 },
      { id: 4, type: "lineLoad", beamId: 4, caseId: 1, q: -8 }, { id: 3, type: "pointForce", nodeId: 3, caseId: 2, fz: -20 },
    ],
  };
  const ip = staalVan(metPaal).inputs.find((i) => i.beam_id === 1);
  ok("met paal: één lijn van 8 m", Math.abs(ip.length_m - 8) < 1e-9, String(ip.length_m));
  ok("met paal: het overstek vanaf de kolomkop (2 m) is maatgevend, als uitkraging — niet 1 m vanaf de paal",
    ip.deflection_length_m !== undefined && Math.abs(ip.deflection_length_m - 2) < 1e-9 && ip.is_cantilever === true,
    `${ip.deflection_length_m} ${ip.is_cantilever}`);
  ok("met paal: de delen zijn veld 0–6000 en overstek 6000–8000",
    ip.deflection_notes.some((n) => /veld x = 0–6000 mm/.test(n) && /overstek x = 6000–8000 mm/.test(n)),
    (ip.deflection_notes.find((n) => n.startsWith("Doorgaande lijn met een overstek")) ?? "").slice(0, 300));
  dicht("met paal: w = zakking van de punt t.o.v. de kolomkop (G + Q), gelijk aan zonder paal",
    Math.abs(ip.deflection_actual_max_mm), Math.abs(puntQ + puntG), 3e-3);
  dicht("met paal: w₁ = punt onder G (omhoog)", -ip.deflection_permanent_mm, puntG, 3e-3);
  const snp = ip.staaf_notities ?? [];
  okNotities("met paal: de notitie bij de paal zegt dat zij geen steunpunt is voor de doorbuiging",
    snp.some((n) => /^Op tussenknoop 5 sluit staaf 5 aan, maar het andere eind daarvan is vrij/.test(n)
      && /geen steunpunt voor de doorbuiging/.test(n)),
    snp);
  if (heeftKern) {
    const uit = kern("check_steel_beams", [ip])[0];
    const fin = toets(uit, "deflection_w_fin"), add = toets(uit, "deflection_w_add");
    dicht("met paal: w_fin grens 0,004·2·2000 = 16 mm", fin.uc.rd, 16.0, 1e-9);
    dicht("met paal: w_add grens 0,003·4000 = 12 mm", add.uc.rd, 12.0, 1e-9);
    dicht("met paal: w_add = F·a²(L+a)/3EI = 12,15 mm", add.uc.ed, puntQ, 3e-3);
  }
  const hp = houtVan({ ...metPaal, beams: metPaal.beams.map((b) => ({
    ...b, material: "C24", profile: b.profile === "IPE300" ? "100x300" : "200x200", checkConfig: { serviceClass: 1 },
  })) }).inputs.find((i) => i.beam_id === 1);
  ok("hout met paal: noemers uit ℓ_rep van het overstek vanaf de kolomkop (500/666), zoals zonder paal",
    Math.abs(hp.deflection_limit_fin - 500) < 1e-9 && Math.abs(hp.deflection_limit_add - 2000 / 3) < 1e-9,
    `${hp.deflection_limit_fin}/${hp.deflection_limit_add}`);
}

log("\n[K5] Klasse 'uitkraging' zonder herkend vrij eind: vanaf het eind met de kleinste verplaatsing");
// HEA 200 S355 (I = 36,92·10⁶), L = 3000, ingeklemd op knoop 1; op de punt staat
// een (onbelaste) stijl 2 → 3, dus knoop 2 is geen vrij eind. Klasse
// "uitkraging": gemeten vanaf het eind met de kleinste verplaatsing, de
// inklemming. Hand: F = 10 kN op de punt (Q), G: q = 5 kN/m:
// w_kar = qL⁴/8EI + FL³/3EI = 6,530 + 11,608 = 18,138 mm.
{
  const m = { ...ALGEMEEN, plates: [],
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 3000, z: 0 }, { id: 3, x: 3000, z: 1000 }],
    supports: [{ nodeId: 1, type: "fixed" }],
    loads: [{ id: 1, type: "lineLoad", beamId: 1, caseId: 1, q: -5 }, { id: 2, type: "pointForce", nodeId: 2, caseId: 2, fz: -10 }],
    beams: [
      { id: 1, from: 1, to: 2, material: "S355", profile: "HEA200", checkConfig: { deflectionClass: "cantilever" } },
      { id: 2, from: 2, to: 3, material: "S355", profile: "HEA100" },
    ],
  };
  const inv = staalVan(m).inputs.find((i) => i.beam_id === 1);
  ok("geen vrij eind herkend", inv.staafeinden === undefined, JSON.stringify(inv.staafeinden));
  ok("toch uitkraging (de klasse)", inv.is_cantilever === true);
  ok("rapportregel: het eind met de kleinste verplaatsing", inv.deflection_notes[0].includes("kleinste verplaatsing"), inv.deflection_notes[0].slice(0, 120));
  dicht("w = zakking van de punt t.o.v. de inklemming = 18,138 mm (koorde: 3,25 mm)", -inv.deflection_actual_max_mm, 18.138, 3e-3);
}

log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);

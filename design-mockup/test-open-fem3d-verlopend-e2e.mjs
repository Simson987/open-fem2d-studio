// Verlopende profielen in 3D (issue #73) van eind tot eind: 3D-modellen met
// verlopende staven gaan door de rekenweg van de app (buildOpenFem3DSolveRequest
// via solveOpenFem3D en solveOpenFem3DCombination: POST naar
// /api/openFem3d/solve, hier naar de echte 3D-kern), de uitkomst door de
// 3D-staaltoets (buildOpenFem3DSteelCheckInputs → de echte toetsbrug) en het
// rapport. Dezelfde modellen in 2D gaan door de 2D-rekenkern (solveAllCases)
// en de 2D-staaltoets (buildSteelCheckInputs → toetsbrug); beide moeten
// hetzelfde getrapte model rekenen: 20 gelijke delen met de doorsnede van hun
// midden (segmentenVoorVerloop).
//
//   [1] Losse verlopende ligger IPE 500 → IPE 300, L = 8 m, ingeklemd aan het
//       brede eind en opgelegd aan het smalle (statisch onbepaald: de
//       verdeling van de stijfheid bepaalt de momenten), G = 8 kN/m + eigen
//       gewicht, Q = 10 kN/m: verzoek, reacties, momentenlijn, zakking,
//       eigen gewicht en unity checks 3D tegen 2D.
//   [2] Verlopend portaal (kolommen HEA 300 → HEA 500, ligger IPE 600 → IPE 400
//       → IPE 600 in twee staven), G met eigen gewicht, Q en wind: reacties,
//       knoopverplaatsingen, de N-lijn van de kolommen (#112: het eigen gewicht
//       langs de staafas is een verdeelde last, zoals in 2D) en unity checks
//       3D tegen 2D.
//   [3] De stalen hal uit de wizard met verlopende kolommen en spantliggers:
//       alle combinaties door de kern, evenwicht, één staaf per modelstaaf,
//       de staaltoets met een VerloopBlok per verlopende staaf.
//   [4] Tekenvlak en rapport met de echte uitkomst in een lokale headless
//       browser (scripts/open-fem3d-verlopend-e2e-browser.tsx). Met
//       OPEN_FEM3D_SCHERMAFBEELDINGEN (een bestaande map) worden er
//       schermafbeeldingen van gemaakt.
//
// WAAR 3D EN 2D BEWUST VERSCHILLEN (en dus niet gelijk worden geëist; geen
// van deze verschillen hoort bij het verloop, ze gelden ook prismatisch):
//   - een 2D-staaf die zonder oplegging doorloopt in een staaf met een
//     andere doorsnede krijgt geen stabiliteitstoets (de kern weigert met
//     reden); 3D toetst elke staaf met gaffels aan beide einden;
//
// Rekenkern: OPEN_FEM_3D_SOLVER_PATH, anders src-tauri/target/debug/open-fem-3d(.exe);
// toetsbrug: src-tauri/target/release/toetsbrug(.exe).
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function load(url, ctx, next) {" +
        " if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };" +
        " return next(url, ctx); }",
    ),
);

const { parseOpenFem3DModel, withOpenFem3DSelfWeight } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { solveOpenFem3D, solveOpenFem3DCombination } = await import("./src/components/openFem3d/openFem3dSolver.ts");
const { buildOpenFem3DSteelCheckInputs, openFem3DUlsUc } = await import("./src/components/openFem3d/openFem3dSteelCheck.ts");
const { openFem3DMemberDisplacementStations } = await import("./src/components/openFem3d/openFem3dDisplacement.ts");
const { maakStaalhal } = await import("./src/components/openFem3d/wizards/staalhal.ts");
const { solveAllCases } = await import("./src/components/fem/solver/engine.ts");
const { defaultCombinations, combineResults } = await import("./src/components/fem/solver/combinations.ts");
const { selecteerCombinaties } = await import("./src/lib/combinatieSelectie.ts");
const { bouwMultiInput, aantalVerloopSegmenten } = await import("./src/lib/modelNaarSolverInput.ts");
const { buildSteelCheckInputs, profileLookupKey } = await import("./src/lib/steelCheckBuilder.ts");
const { eigenGewichtGeval } = await import("./src/lib/eigenGewicht.ts");
const { dichtheidVanMateriaal, G } = await import("./src/lib/sectionResolver.ts");
const { eigenDoorsnedenStore } = await import("./src/lib/profieleditor/eigenDoorsnedenStore.ts");
const { startBrowser } = await import("./scripts/headlessBrowser.mjs");

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HIER, "..");
const exe = (naam) => (process.platform === "win32" ? `${naam}.exe` : naam);
const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH ?? join(REPO, "src-tauri", "target", "debug", exe("open-fem-3d"));
const TOETSBRUG = join(REPO, "src-tauri", "target", "release", exe("toetsbrug"));
assert.ok(existsSync(solverPath), `Bouw eerst de 3D-kern (${solverPath}: cargo build -p open-fem-3d) of zet OPEN_FEM_3D_SOLVER_PATH.`);
assert.ok(existsSync(TOETSBRUG), `Bouw eerst de toetsbrug (${TOETSBRUG}: cargo build --release -p toetsbrug).`);

let geslaagd = 0;
const ok = (waar, naam) => { assert.ok(waar, naam); geslaagd++; console.log(`  ✓ ${naam}`); };
const fmt = (x) => Math.abs(x) >= 0.01 || x === 0 ? x.toFixed(6) : x.toExponential(4);
/** |werkelijk − verwacht| ≤ grens; de grens staat bij elke aanroep verantwoord. */
const binnen = (werkelijk, verwacht, grens, naam) => {
  const verschil = Math.abs(werkelijk - verwacht);
  assert.ok(Number.isFinite(werkelijk) && verschil <= grens,
    `${naam}: 3D ${werkelijk}, 2D/verwacht ${verwacht}, verschil ${verschil} > ${grens}`);
  geslaagd++;
  console.log(`  ✓ ${naam} (${fmt(werkelijk)} tegen ${fmt(verwacht)}${verwacht !== 0 ? `, ${(100 * (werkelijk - verwacht) / Math.abs(verwacht)).toExponential(2)} %` : ""})`);
};
/** Relatief gelijk: |a − b| ≤ rel · max(|b|, schaal). */
const gelijk = (werkelijk, verwacht, rel, naam, schaal = 0) =>
  binnen(werkelijk, verwacht, rel * Math.max(Math.abs(verwacht), schaal), naam);

/** De rekenweg van de app in de browser: POST /api/openFem3d/solve, hier naar de echte kern (zoals vite.config.ts). */
const verzoeken = [];
globalThis.fetch = (url, options) => new Promise((klaar, mis) => {
  assert.equal(url, "/api/openFem3d/solve");
  verzoeken.push(JSON.parse(options.body));
  const kind = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  const uit = [];
  kind.stdout.on("data", (d) => uit.push(d));
  kind.on("error", mis);
  kind.on("close", (code) => {
    const tekst = Buffer.concat(uit).toString();
    klaar({ ok: code === 0, status: code === 0 ? 200 : 500, json: async () => JSON.parse(tekst) });
  });
  kind.stdin.end(options.body);
});

/** De echte staaltoets, zoals het Tauri-command `check_steel_beams`. */
const toets = (inputs) => {
  const r = spawnSync(TOETSBRUG, [], {
    input: JSON.stringify({ opdracht: "check_steel_beams", inputs }), encoding: "utf8", maxBuffer: 512 << 20,
  });
  if (r.status !== 0 || !r.stdout) throw new Error(`toetsbrug faalde: ${(r.stderr ?? "").slice(0, 400)}`);
  return JSON.parse(r.stdout);
};
const PROFIELEN = JSON.parse(readFileSync(join(REPO, "src-tauri", "crates", "steel-profiles", "data", "profiles.json"), "utf8"));
const profileDb = new Map();
for (const p of PROFIELEN) { const k = profileLookupKey(p.name); if (!profileDb.has(k)) profileDb.set(k, p); }
const ucs = (uitslag) => Object.fromEntries(uitslag.checks.map((c) => [c.id, c.kind.data.uc?.uc ?? null]));
const isDoorsnede = (id) => id.startsWith("6.2.");
const isStabiliteit = (id) => id.startsWith("6.3.");

/** Diep gelijk; getallen relatief op 1e-9 (stations in drijvende komma: 20,000000000000004 tegen 20). */
const hetzelfde = (a, b) => {
  if (typeof a === "number" && typeof b === "number") {
    return Object.is(a, b) || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const sleutels = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...sleutels].every((k) => hetzelfde(a[k], b[k]));
};

/** Een 3D-model rekenen zoals App.tsx: elk belast geval en elke combinatie als volledige lastvector. */
async function reken3D(model, loadCases, combinations, selfWeightCaseId) {
  const opties = {
    permanentCaseIds: loadCases.filter((c) => c.type === "dead").map((c) => c.id),
    ...(selfWeightCaseId !== undefined ? { selfWeightCaseId } : {}),
  };
  const gevallen = new Map();
  for (const lc of loadCases) gevallen.set(lc.id, await solveOpenFem3D(model, lc.id, "linear", opties));
  const combinaties = new Map();
  for (const c of combinations) combinaties.set(c.id, await solveOpenFem3DCombination(model, c.factors, "linear", undefined, opties));
  return { gevallen, combinaties };
}

// ── [1] Losse verlopende ligger ─────────────────────────────────────────
const L = 8;
const LIGGER_GEVALLEN = [{ id: 1, name: "G", type: "dead" }, { id: 2, name: "Q", type: "live" }];
const QG = 8, QQ = 10; // kN/m omlaag
// Dezelfde toetsinstellingen in beide (vloer), zodat de doorbuigingseis gelijk is.
const VLOER = { deflectionClass: "floor" };
const ligger2D = {
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: L * 1000, z: 0 }],
  beams: [{ id: 1, from: 1, to: 2, material: "S235", profile: "IPE500", profileEnd: "IPE300", checkConfig: VLOER }],
  supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 2, type: "zRoller" }],
  plates: [], loadCases: LIGGER_GEVALLEN,
  loads: [{ id: 1, type: "lineLoad", caseId: 1, beamId: 1, q: -QG }, { id: 2, type: "lineLoad", caseId: 2, beamId: 1, q: -QQ }],
  selfWeightEnabled: true, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
};
const liggerBasis = parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 500", profileNameEnd: "IPE 300", material: "S235", checkConfig: VLOER }],
  // Inklemming; rol: verticaal en zijdelings vast, torsie vast (gaffel), langs de as vrij.
  supports: [
    { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
    { nodeId: 2, ux: false, uy: true, uz: true, rx: true, ry: false, rz: false },
  ],
  memberLoads: [
    { id: 1, beamId: 1, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -QG, qzEnd: -QG, startPositionM: 0, endPositionM: L },
    { id: 2, beamId: 1, caseId: 2, qyStart: 0, qyEnd: 0, qzStart: -QQ, qzEnd: -QQ, startPositionM: 0, endPositionM: L },
  ],
});
const egLigger = eigenGewichtGeval(LIGGER_GEVALLEN, true);
const ligger3D = withOpenFem3DSelfWeight(liggerBasis, egLigger.id);
const liggerCombinaties = selecteerCombinaties(defaultCombinations(LIGGER_GEVALLEN), ligger2D.beams, ligger2D.plates).actief;

console.log(`[1] losse verlopende ligger IPE 500 → IPE 300, L = ${L} m, ingeklemd–opgelegd, eigen gewicht in G (${liggerCombinaties.length} combinaties)`);
const mi2 = bouwMultiInput(ligger2D);
const { perCase: ligger2DGevallen } = solveAllCases(mi2);
const ligger2DCombi = new Map(liggerCombinaties.map((c) => [c.id, combineResults(c, ligger2DGevallen)]));
verzoeken.length = 0;
const ligger3DUit = await reken3D(ligger3D, LIGGER_GEVALLEN, liggerCombinaties, egLigger.id);
let liggerToets3D;
{
  // Het verzoek: dezelfde delen als 2D.
  const verzoek = verzoeken[0];
  const lid = verzoek.members[0];
  const segmenten = mi2.beams[0].segmenten;
  ok(lid.partSectionIds?.length === 20 && segmenten.length === 20 && aantalVerloopSegmenten(L * 1000) === 20,
    `verzoek: partSectionIds met ${lid.partSectionIds?.length} delen, 2D ${segmenten.length} segmenten`);
  const sectie = (id) => verzoek.sections.find((s) => s.id === id);
  let afwA = 0, afwI = 0;
  lid.partSectionIds.forEach((id, i) => {
    afwA = Math.max(afwA, Math.abs(sectie(id).areaM2 * 1e6 - segmenten[i].A) / segmenten[i].A);
    afwI = Math.max(afwI, Math.abs(sectie(id).iyM4 * 1e12 - segmenten[i].I) / segmenten[i].I);
  });
  ok(afwA < 1e-12 && afwI < 1e-12, `A en I_y per deel gelijk aan de 2D-segmenten (grootste afwijking ${afwA.toExponential(1)}, ${afwI.toExponential(1)})`);
  ok(verzoeken.every((v) => v.members.length === 1), "elk verzoek: één staaf (de kern knipt zelf)");

  for (const lc of LIGGER_GEVALLEN) {
    const r2 = ligger2DGevallen.get(lc.id), r3 = ligger3DUit.gevallen.get(lc.id);
    assert.ok(!r3.fout, r3.fout);
    const el = r2.elements.get(1);
    const reactie3 = (n) => r3.reactions.find((r) => r.nodeId === n);
    // 2D in N en Nmm; het moment om y draagt in 2D het tegengestelde teken.
    gelijk(reactie3(1).fz, r2.reactions.get(1).fz / 1000, 1e-9, `${lc.name}: R_A (kN)`);
    gelijk(reactie3(2).fz, r2.reactions.get(2).fz / 1000, 1e-9, `${lc.name}: R_B (kN) — statisch onbepaald, volgt de stijfheidsverdeling`);
    gelijk(-reactie3(1).my, r2.reactions.get(1).my / 1e6, 1e-9, `${lc.name}: inklemmingsmoment (kNm)`);
    // De momentenlijn op alle 420 stations van 2D (21 per segment).
    const lijn = r3.diagrams.momentY.find((d) => d.memberId === 1).points;
    const op = (t) => {
      for (let i = 1; i < lijn.length; i++) {
        if (t <= lijn[i].t + 1e-12) {
          const a = lijn[i - 1], b = lijn[i];
          return b.t === a.t ? b.value : a.value + (b.value - a.value) * (t - a.t) / (b.t - a.t);
        }
      }
      return lijn.at(-1).value;
    };
    const mMax = Math.max(...el.bendingMoment.map((m) => Math.abs(m / 1e6)));
    let afw = 0;
    el.stations_mm.forEach((x, i) => { afw = Math.max(afw, Math.abs(op(x / (L * 1000)) - el.bendingMoment[i] / 1e6)); });
    binnen(afw, 0, 1e-9 * mMax, `${lc.name}: momentenlijn op alle ${el.stations_mm.length} stations gelijk aan 2D (grootste afwijking, kNm)`);
    ok(r3.memberForces.length === 1 && r3.displacements.map((d) => d.nodeId).join() === "1,2",
      `${lc.name}: één staaf terug en alleen de modelknopen`);
    ok(r3.forceBalance?.ok === true, `${lc.name}: de onafhankelijke krachtensom van de app sluit`);
    // De zakking: dezelfde momentenlijn van de kern fijn geïntegreerd (400 intervallen) tegen 2D.
    const w2 = Math.min(...el.deflection);
    const w3fijn = Math.min(...openFem3DMemberDisplacementStations(ligger3D, ligger3D.beams[0], r3, 400).map((s) => s.uz)) * 1000;
    // Grens 1e-4: trapeziumregel over de lijn van 420 punten met 20 mm per interval (gemeten ≈ 1,4e-5).
    gelijk(w3fijn, w2, 1e-4, `${lc.name}: grootste zakking (mm), M/EI van de kern op 400 intervallen tegen 2D`);
  }
  // Eigen gewicht per deel: Σ R = q·L + Σ ρ·g·A_i·L/n, in 2D en 3D.
  const rho = dichtheidVanMateriaal("S235");
  const eg = lid.partSectionIds.reduce((som, id) => som + rho * sectie(id).areaM2 * G / 1000 * L / 20, 0);
  const r3G = ligger3DUit.gevallen.get(1);
  gelijk(r3G.reactions.reduce((s, r) => s + r.fz, 0), QG * L + eg, 1e-12,
    `G: Σ R_z = q·L + Σ ρ·g·A_i·L/n (${eg.toFixed(4)} kN eigen gewicht)`);
  gelijk(r3G.reactions.reduce((s, r) => s + r.fz, 0), [...ligger2DGevallen.get(1).reactions.values()].reduce((s, r) => s + r.fz, 0) / 1000, 1e-12,
    "G: Σ R_z gelijk aan 2D (zelfde deelgrenzen voor het eigen gewicht)");

  // De toetsing.
  const in2 = buildSteelCheckInputs({
    nodes: ligger2D.nodes, beams: ligger2D.beams, supports: ligger2D.supports, combinations: liggerCombinaties,
    combinationResults: ligger2DCombi, profileDb, loadCases: LIGGER_GEVALLEN, gevallenMetLast: [1, 2],
  }).inputs[0];
  const in3 = buildOpenFem3DSteelCheckInputs(ligger3D, ligger3DUit.gevallen.get(1), {
    combinations: liggerCombinaties, results: ligger3DUit.combinaties, loadCases: LIGGER_GEVALLEN,
  }).inputs[0];
  ok(profileLookupKey(in3.profile_name) === profileLookupKey(in2.profile_name) && profileLookupKey(in3.profile_end) === profileLookupKey(in2.profile_end),
    `toetsinvoer: ${in3.profile_name} → ${in3.profile_end} (3D) en ${in2.profile_name} → ${in2.profile_end} (2D)`);
  // De krachtenomhullende per UGT-combinatie: grootste |My| en |Vz|.
  const piek = (env, veld) => {
    const m = new Map();
    for (const p of env) m.set(p.combination_id, Math.max(m.get(p.combination_id) ?? 0, Math.abs(p.forces[veld])));
    return m;
  };
  for (const veld of ["my_ed", "vz_ed"]) {
    const a = piek(in3.forces_envelope, veld), b = piek(in2.forces_envelope, veld);
    ok(a.size === b.size && [...a].every(([id, v]) => Math.abs(v - b.get(id)) <= 1e-9 * Math.max(1, b.get(id))),
      `omhullende ${veld}: per UGT-combinatie het grootste |${veld}| gelijk aan 2D (${[...a.values()].map((v) => v.toFixed(2)).join(", ")})`);
  }
  const w2Bgt = in2.deflection_actual_max_mm, w3Bgt = in3.deflection_actual_max_mm;
  // Sinds #113 integreert de 3D-route M/EI exact (M per stuk kubisch uit M en V van de kern) en zoekt
  // zij het maximum ook tussen de stations; 2D neemt het hoogste van zijn stations. Gemeten 9e-7; grens 1e-5.
  gelijk(w3Bgt, w2Bgt, 1e-5, "BGT-veldzakking van de toetsinvoer gelijk aan 2D (exacte integratie, #113)");
  // De kipbelasting (#111): 3D zet de last op de bovenflens met de equivalente q, zoals 2D.
  // Vóór #111 gaf 3D z_a = 0 en q = 0 mee; `t3oud` rekent die invoer na als regressie.
  gelijk(in3.z_a_mm, 250, 1e-12, "kip: z_a = h/2 van het beginprofiel IPE 500 (last op de bovenflens)");
  gelijk(in3.z_a_mm, in2.z_a_mm, 1e-12, "kip: z_a gelijk aan 2D");
  gelijk(in3.q_equiv_n_per_mm, in2.q_equiv_n_per_mm, 1e-9, `kip: q_equiv gelijk aan 2D (${in3.q_equiv_n_per_mm.toFixed(3)} N/mm)`);
  const [t2, t3, t3oud] = toets([in2, in3, { ...in3, z_a_mm: 0, q_equiv_n_per_mm: 0 }]);
  liggerToets3D = t3;
  const u2 = ucs(t2), u3 = ucs(t3), u3oud = ucs(t3oud);
  ok(t3.profile_name === "IPE 500 → IPE 300 (verlopend)" && t2.profile_name === t3.profile_name, `de kern noemt het verloop: ${t3.profile_name}`);
  const doorsnede = Object.keys(u3).filter((id) => isDoorsnede(id) && u3[id] !== null);
  ok(doorsnede.length >= 6 && doorsnede.every((id) => Math.abs(u3[id] - u2[id]) <= 1e-9 * Math.max(1, u2[id])),
    `doorsnedetoetsen 6.2 gelijk aan 2D: ${doorsnede.map((id) => `${id} ${u3[id].toFixed(4)}`).join(", ")}`);
  ok(hetzelfde(t3.verloop.toetsdoorsneden, t2.verloop.toetsdoorsneden) && t3.verloop.toetsdoorsneden.length >= 6,
    `VerloopBlok: dezelfde ${t3.verloop.toetsdoorsneden.length} toetsdoorsneden (x, maten, A, W, klasse, UC per toets)`);
  ok(hetzelfde(t3.verloop.maatgevend, t2.verloop.maatgevend),
    `VerloopBlok: hetzelfde maatgevende punt (x = ${t3.verloop.maatgevend.doorsnede.x_mm} mm, ${t3.verloop.maatgevend.toets_id}, UC ${t3.verloop.maatgevend.uc.toFixed(4)})`);
  const kip = "6.3.2_ltb";
  ok(Math.abs(u3[kip] - u2[kip]) <= 1e-9 * u2[kip], `kip: 3D ${u3[kip].toFixed(4)} = 2D ${u2[kip].toFixed(4)}`);
  ok(hetzelfde(t3.verloop.stabiliteit, t2.verloop.stabiliteit), "kip: dezelfde stabiliteitsdoorsnede van het verloop");
  ok(u3oud[kip] < u3[kip] - 1,
    `kip, regressie #111: met de last in het dwarskrachtcentrum (z_a = 0, q = 0) ${u3oud[kip].toFixed(4)}, met de last op de bovenflens ${u3[kip].toFixed(4)}`);
  for (const id of ["deflection_w_fin", "deflection_w_add"]) gelijk(u3[id], u2[id], 1e-5, `${id}: gelijk aan 2D (volgt de BGT-zakking)`);
}

// ── [2] Verlopend portaal ────────────────────────────────────────────────
console.log("\n[2] verlopend portaal: kolommen HEA 300 → HEA 500, ligger IPE 600 → IPE 400 → IPE 600, G met eigen gewicht, Q en wind");
const PORTAAL_GEVALLEN = [{ id: 1, name: "G", type: "dead" }, { id: 2, name: "Q", type: "live" }, { id: 3, name: "W", type: "wind" }];
const portaal2D = {
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: 6000 }, { id: 3, x: 8000, z: 6000 }, { id: 4, x: 16000, z: 6000 }, { id: 5, x: 16000, z: 0 }],
  beams: [
    { id: 1, from: 1, to: 2, material: "S235", profile: "HEA300", profileEnd: "HEA500" },
    { id: 2, from: 2, to: 3, material: "S235", profile: "IPE600", profileEnd: "IPE400" },
    { id: 3, from: 3, to: 4, material: "S235", profile: "IPE400", profileEnd: "IPE600" },
    { id: 4, from: 5, to: 4, material: "S235", profile: "HEA300", profileEnd: "HEA500" },
  ],
  supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 5, type: "fixed" }],
  plates: [], loadCases: PORTAAL_GEVALLEN,
  loads: [
    { id: 1, type: "lineLoad", caseId: 1, beamId: 2, q: -6 }, { id: 2, type: "lineLoad", caseId: 1, beamId: 3, q: -6 },
    { id: 3, type: "lineLoad", caseId: 2, beamId: 2, q: -10 }, { id: 4, type: "lineLoad", caseId: 2, beamId: 3, q: -10 },
    { id: 5, type: "pointForce", caseId: 3, nodeId: 2, fx: 15, fz: 0 },
  ],
  selfWeightEnabled: true, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
};
const VAST = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };
const portaal3D = parseOpenFem3DModel({
  nodes: portaal2D.nodes.map((n) => ({ id: n.id, x: n.x / 1000, y: 0, z: n.z / 1000 })),
  beams: portaal2D.beams.map((b) => ({ id: b.id, startNodeId: b.from, endNodeId: b.to, material: b.material, profileName: b.profile, profileNameEnd: b.profileEnd })),
  supports: [{ nodeId: 1, ...VAST }, { nodeId: 5, ...VAST }],
  memberLoads: [
    { id: 1, beamId: 2, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -6, qzEnd: -6, startPositionM: 0, endPositionM: 8 },
    { id: 2, beamId: 3, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -6, qzEnd: -6, startPositionM: 0, endPositionM: 8 },
    { id: 3, beamId: 2, caseId: 2, qyStart: 0, qyEnd: 0, qzStart: -10, qzEnd: -10, startPositionM: 0, endPositionM: 8 },
    { id: 4, beamId: 3, caseId: 2, qyStart: 0, qyEnd: 0, qzStart: -10, qzEnd: -10, startPositionM: 0, endPositionM: 8 },
  ],
  loads: [{ id: 1, nodeId: 2, caseId: 3, fx: 15, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
});
{
  const combinaties = selecteerCombinaties(defaultCombinations(PORTAAL_GEVALLEN), portaal2D.beams, portaal2D.plates).actief;
  const { perCase } = solveAllCases(bouwMultiInput(portaal2D));
  const combi2 = new Map(combinaties.map((c) => [c.id, combineResults(c, perCase)]));
  verzoeken.length = 0;
  // Het eigen gewicht in G, zoals App.tsx (#112: als globale Z-last per deel).
  const egPortaal = eigenGewichtGeval(PORTAAL_GEVALLEN, true);
  const portaal3DEg = withOpenFem3DSelfWeight(portaal3D, egPortaal.id);
  const uit3 = await reken3D(portaal3DEg, PORTAAL_GEVALLEN, combinaties, egPortaal.id);
  ok(verzoeken[0].members.every((m) => m.partSectionIds?.length === 20), "elke staaf rekent in 20 delen (kolommen 6 m, ligger 8 m)");
  for (const lc of PORTAAL_GEVALLEN) {
    const r2 = perCase.get(lc.id), r3 = uit3.gevallen.get(lc.id);
    assert.ok(!r3.fout, r3.fout);
    const fSchaal = Math.max(...[...r2.reactions.values()].map((r) => Math.max(Math.abs(r.fx), Math.abs(r.fz)))) / 1000;
    const mSchaal = Math.max(...[...r2.reactions.values()].map((r) => Math.abs(r.my))) / 1e6;
    let afwF = 0, afwM = 0;
    for (const n of [1, 5]) {
      const a = r2.reactions.get(n), b = r3.reactions.find((r) => r.nodeId === n);
      afwF = Math.max(afwF, Math.abs(b.fx - a.fx / 1000), Math.abs(b.fz - a.fz / 1000));
      afwM = Math.max(afwM, Math.abs(-b.my - a.my / 1e6));
    }
    binnen(afwF, 0, 1e-9 * fSchaal, `${lc.name}: reacties R_x en R_z in beide voeten gelijk aan 2D (grootste afwijking, kN)`);
    binnen(afwM, 0, 1e-9 * mSchaal, `${lc.name}: inklemmingsmomenten gelijk aan 2D (grootste afwijking, kNm)`);
    const uSchaal = Math.max(...[2, 3, 4].flatMap((n) => [Math.abs(r2.displacements.get(n).ux), Math.abs(r2.displacements.get(n).uz)]));
    let afwU = 0;
    for (const n of [2, 3, 4]) {
      const a = r2.displacements.get(n), b = r3.displacements.find((d) => d.nodeId === n);
      afwU = Math.max(afwU, Math.abs(b.ux * 1000 - a.ux), Math.abs(b.uz * 1000 - a.uz));
    }
    binnen(afwU, 0, 1e-9 * uSchaal, `${lc.name}: verplaatsing van goten en midden (knoop 2, 3, 4) gelijk aan 2D (grootste afwijking, mm; grootste waarde ${uSchaal.toFixed(3)} mm)`);
    // De N-lijn van de kolommen op alle 2D-stations (2D in N, trek positief zoals 3D).
    for (const id of [1, 4]) {
      const el = r2.elements.get(id);
      const n3 = r3.diagrams.axial.find((d) => d.memberId === id).points;
      const lengte = el.stations_mm.at(-1);
      const op = (t) => {
        for (let i = 1; i < n3.length; i++) {
          if (t <= n3[i].t + 1e-12) {
            const a = n3[i - 1], b = n3[i];
            return b.t === a.t ? b.value : a.value + (b.value - a.value) * (t - a.t) / (b.t - a.t);
          }
        }
        return n3.at(-1).value;
      };
      let afwN = 0;
      el.stations_mm.forEach((x, i) => { afwN = Math.max(afwN, Math.abs(op(x / lengte) - el.normalForce[i] / 1000)); });
      const nSchaal = Math.max(1, ...el.normalForce.map((v) => Math.abs(v) / 1000));
      binnen(afwN, 0, 1e-9 * nSchaal, `${lc.name}: N-lijn van kolom ${id} op alle ${el.stations_mm.length} stations gelijk aan 2D (grootste afwijking, kN)`);
    }
    ok(r3.forceBalance?.ok === true && r3.displacements.length === 5 && r3.memberForces.length === 4,
      `${lc.name}: krachtensom sluit, vijf modelknopen en vier staven terug`);
  }
  const in2 = buildSteelCheckInputs({
    nodes: portaal2D.nodes, beams: portaal2D.beams, supports: portaal2D.supports, combinations: combinaties,
    combinationResults: combi2, profileDb, loadCases: PORTAAL_GEVALLEN, gevallenMetLast: [1, 2, 3],
  }).inputs;
  const in3 = buildOpenFem3DSteelCheckInputs(portaal3DEg, uit3.gevallen.get(1), {
    combinations: combinaties, results: uit3.combinaties, loadCases: PORTAAL_GEVALLEN,
  }).inputs;
  const t2 = toets(in2), t3 = toets(in3);
  for (const id of [1, 2, 3, 4]) {
    const a = ucs(t2.find((r) => r.beam_id === id)), b = ucs(t3.find((r) => r.beam_id === id));
    const kolom = id === 1 || id === 4;
    const ids = Object.keys(b).filter((k) => b[k] !== null && (isDoorsnede(k) || (kolom && isStabiliteit(k))));
    ok(ids.every((k) => Math.abs(b[k] - a[k]) <= 1e-9 * Math.max(1, a[k])),
      `staaf ${id} (${t3.find((r) => r.beam_id === id).profile_name}): ${kolom ? "doorsnede- en stabiliteitstoetsen" : "doorsnedetoetsen"} gelijk aan 2D — ${ids.map((k) => `${k} ${b[k].toFixed(4)}`).join(", ")}`);
    if (!kolom) {
      const kip2 = t2.find((r) => r.beam_id === id).checks.find((c) => c.id === "6.3.2_ltb");
      ok(a["6.3.2_ltb"] === null && /loopt .* door in een staaf met een andere/.test(kip2.kind.data.notes.join(" ")) && Number.isFinite(b["6.3.2_ltb"]),
        `staaf ${id}: 2D weigert de kiptoets van een doorlopende ligger met reden, 3D toetst met gaffels (UC ${b["6.3.2_ltb"].toFixed(3)}; zie de kop)`);
    }
  }
}

// ── [3] Stalen hal uit de wizard ─────────────────────────────────────────
console.log("\n[3] stalen hal uit de wizard: kolommen HEA 300 → HEA 500, spantliggers IPE 600 → IPE 400 (goot → nok)");
const hal = maakStaalhal({
  lengteMm: 12_000, breedteMm: 20_000, aantalVakken: 2, gordingafstandMm: 2_500,
  profielen: {
    kolom: { profiel: "HEA 300", materiaal: "S235", profielEind: "HEA 500" },
    spantligger: { profiel: "IPE 600", materiaal: "S235", profielEind: "IPE 400" },
  },
});
// Zoals Toepassen in de app: de gelaste tussendoorsneden in de winkel.
eigenDoorsnedenStore.getState().vervangAlles([]);
for (const d of hal.eigenDoorsneden) eigenDoorsnedenStore.getState().bewaar(d);
let halGegevens;
{
  const verlopend = [...hal.samenvatting.groepen.kolom, ...hal.samenvatting.groepen.spantligger];
  ok(verlopend.every((id) => hal.model.beams.find((b) => b.id === id).profileNameEnd), `${verlopend.length} verlopende staven (kolommen en spantliggers)`);
  const eg = eigenGewichtGeval(hal.loadCases, hal.selfWeightEnabled);
  const rekenmodel = eg ? withOpenFem3DSelfWeight(hal.model, eg.id) : hal.model;
  const belast = new Set([
    ...(rekenmodel.loads ?? []), ...(rekenmodel.memberLoads ?? []), ...(rekenmodel.memberPointLoads ?? []),
    ...(rekenmodel.surfaceLoads ?? []), ...(rekenmodel.loadPanels ?? []),
  ].map((l) => l.caseId ?? 1));
  const gevallen = hal.loadCases.filter((lc) => belast.has(lc.id));
  const combinaties = defaultCombinations(hal.loadCases).filter((c) => [...belast].some((id) => (c.factors.get(id) ?? 0) !== 0));
  verzoeken.length = 0;
  const begin = Date.now();
  const uit = await reken3D(rekenmodel, gevallen, combinaties, eg?.id);
  console.log(`  (${verzoeken.length} berekeningen in ${((Date.now() - begin) / 1000).toFixed(1)} s)`);
  const lengte = (b) => {
    const a = hal.model.nodes.find((n) => n.id === b.startNodeId), e = hal.model.nodes.find((n) => n.id === b.endNodeId);
    return Math.hypot(e.x - a.x, e.y - a.y, e.z - a.z);
  };
  ok(verzoeken.every((v) => verlopend.every((id) => {
    const lid = v.members.find((m) => m.id === id);
    return lid.partSectionIds?.length === aantalVerloopSegmenten(lengte(hal.model.beams.find((b) => b.id === id)) * 1000);
  }) && v.members.filter((m) => m.partSectionIds).length === verlopend.length),
  "elk verzoek: partSectionIds bij precies de verlopende staven, n zoals 2D (aantalVerloopSegmenten)");
  const alle = [...uit.gevallen.values(), ...uit.combinaties.values()];
  ok(alle.every((r) => !r.fout), `${alle.length} uitkomsten zonder fout (${gevallen.length} gevallen, ${combinaties.length} combinaties)`);
  ok(alle.every((r) => r.forceBalance?.ok === true), `evenwicht: de onafhankelijke krachtensom sluit in alle ${alle.length} uitkomsten (grootste afwijking ${Math.max(...alle.map((r) => r.forceBalance.maxImbalanceKn)).toExponential(2)} kN)`);
  const knopen = new Set(hal.model.nodes.map((n) => n.id));
  ok(alle.every((r) => r.displacements.length === knopen.size && r.displacements.every((d) => knopen.has(d.nodeId))),
    "alleen de modelknopen terug: geen grensknopen van de delen");
  ok(alle.every((r) => r.memberForces.length === hal.model.beams.length), `één staafkrachtregel per modelstaaf (${hal.model.beams.length})`);
  // De staaltoets over alle UGT- en BGT-combinaties, zoals App.tsx.
  const invoer = buildOpenFem3DSteelCheckInputs(hal.model, uit.gevallen.values().next().value, {
    combinations: combinaties, results: uit.combinaties, loadCases: hal.loadCases,
  });
  ok(invoer.skipped.length === 0, `alle ${invoer.inputs.length} stalen staven toetsbaar (geen overgeslagen)`);
  const metEind = invoer.inputs.filter((i) => i.profile_end);
  ok(metEind.length === verlopend.length && metEind.every((i) => verlopend.includes(i.beam_id)),
    `profile_end bij precies de ${verlopend.length} verlopende staven`);
  ok(metEind.filter((i) => i.custom_section_end || i.custom_section).length > 0,
    "de gelaste tussendoorsneden van de spantligger reizen als geometrie mee (custom_section/_end)");
  const uitslagen = toets(invoer.inputs);
  const metVerloop = uitslagen.filter((u) => u.verloop);
  ok(metVerloop.length === verlopend.length && metVerloop.every((u) => /\(verlopend\)$/.test(u.profile_name)),
    `de toetsbrug: een verloop met toetsdoorsneden bij alle ${metVerloop.length} verlopende staven`);
  ok(uitslagen.every((u) => Number.isFinite(openFem3DUlsUc(u))), "alle UGT-unity checks eindig");
  const perGroep = Object.entries(hal.samenvatting.groepen).filter(([, ids]) => ids.length > 0).map(([groep, ids]) => {
    const rs = uitslagen.filter((u) => ids.includes(u.beam_id));
    const maatgevend = rs.reduce((m, u) => openFem3DUlsUc(u) > openFem3DUlsUc(m) ? u : m);
    return `${groep} ${openFem3DUlsUc(maatgevend).toFixed(3)} (${maatgevend.profile_name})`;
  });
  console.log(`  maatgevende UC per groep: ${perGroep.join("; ")}`);
  // Voor de browser: de combinatie met de grootste verplaatsing.
  const [combiId, combiUit] = [...uit.combinaties].filter(([id]) => combinaties.find((c) => c.id === id).type === "uls")
    .reduce((m, x) => Math.max(...x[1].displacements.map((d) => Math.hypot(d.ux, d.uy, d.uz))) > Math.max(...m[1].displacements.map((d) => Math.hypot(d.ux, d.uy, d.uz))) ? x : m);
  console.log(`  beeld: combinatie ${combiId} (${combinaties.find((c) => c.id === combiId).name})`);
  halGegevens = {
    model: hal.model, result: combiUit, checks: { results: uitslagen, skipped: invoer.skipped, notes: invoer.notes },
    eigenDoorsneden: hal.eigenDoorsneden, verlopend,
  };
}

// ── [4] Tekenvlak en rapport in de browser ───────────────────────────────
console.log("\n[4] tekenvlak en rapport met de echte uitkomst (browser)");
{
  const browser = [process.env.OPENAEC_BROWSER,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
  ].filter(Boolean).find(existsSync);
  assert.ok(browser, "Chromium-browser vereist; stel eventueel OPENAEC_BROWSER in");
  const map = mkdtempSync(join(tmpdir(), "open-fem3d-verlopend-e2e-"));
  try {
    const bundel = await build({
      absWorkingDir: HIER,
      entryPoints: ["scripts/open-fem3d-verlopend-e2e-browser.tsx"], bundle: true, write: false,
      outfile: join(map, "test.js"), format: "iife", platform: "browser", jsx: "automatic",
      external: ["fs", "path"],
      loader: { ".ifcfem": "text", ".svg": "dataurl", ".png": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
      define: { "process.env.NODE_ENV": '"production"' },
    });
    for (const bestand of bundel.outputFiles) writeFileSync(bestand.path, bestand.contents);
    const gegevens = {
      ligger: {
        model: liggerBasis, result: ligger3DUit.combinaties.get(liggerCombinaties.find((c) => c.type === "uls").id),
        checks: { results: [liggerToets3D], skipped: [], notes: [] }, lengteM: L, maKnm: 0,
      },
      hal: halGegevens,
    };
    // Het inklemmingsmoment van de kern in de getoonde UGT-combinatie.
    gegevens.ligger.maKnm = gegevens.ligger.result.memberForces[0].myStartKnm;
    writeFileSync(join(map, "gegevens.js"), `window.__VERLOPEND_E2E__ = ${JSON.stringify(gegevens).replace(/</g, "\\u003c")};`);
    const html = join(map, "test.html");
    writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="test.css"></head><body style="margin:0;background:#fff"><div id="root"></div>' +
      '<pre id="uitslag"></pre><script src="gegevens.js"></script><script src="test.js"></script></body></html>');
    const vlaggen = (profiel, venster) => ["--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader", "--no-first-run",
      "--no-default-browser-check", `--user-data-dir=${join(map, profiel)}`, `--window-size=${venster}`];
    const uitslag = startBrowser(browser, [...vlaggen("profiel", "1200,800"), "--virtual-time-budget=60000", "--dump-dom", pathToFileURL(html).href],
      { encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
    const gevonden = /<pre id="uitslag">([^<]*)<\/pre>/.exec(uitslag.stdout ?? "");
    assert.ok(gevonden?.[1], uitslag.error?.message ?? uitslag.stderr?.slice(0, 1500) ?? "Geen browserresultaat");
    const verslag = JSON.parse(gevonden[1].replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
    for (const proef of verslag.tests) {
      assert.ok(!proef.error, `${proef.name}: ${proef.error}`);
      geslaagd++;
      console.log(`  ✓ ${proef.name}`);
    }
    assert.equal(verslag.error, null, verslag.error);
    assert.ok(verslag.tests.length >= 5, `te weinig browserproeven: ${verslag.tests.length}`);

    const schermMap = process.env.OPEN_FEM3D_SCHERMAFBEELDINGEN;
    if (schermMap) {
      assert.ok(existsSync(schermMap), `map voor schermafbeeldingen bestaat niet: ${schermMap}`);
      for (const [bestand, beeld, venster] of [
        ["verlopend-e2e-ligger.png", "ligger", "1200,700"],
        ["verlopend-e2e-hal.png", "hal", "1200,700"],
        ["verlopend-e2e-rapport.png", "rapport", "1200,1000"],
      ]) {
        const pad = join(schermMap, bestand);
        startBrowser(browser, [...vlaggen(`profiel-${beeld}`, venster), "--hide-scrollbars", "--virtual-time-budget=15000",
          `--screenshot=${pad}`, `${pathToFileURL(html).href}#beeld=${beeld}`], { encoding: "utf8", timeout: 120_000 });
        assert.ok(existsSync(pad), `schermafbeelding niet gemaakt: ${pad}`);
        console.log(`  schermafbeelding: ${pad}`);
      }
    }
    console.log(`  (${basename(browser)})`);
  } finally {
    rmSync(map, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

console.log(`\n${geslaagd} geslaagd, 0 gefaald`);

// Trek-alleen staven in 2D — het windverband van issue #234.
//
// WAT ER MISGING
//  Het 2D-model kende geen "alleen trek". Van een kruisverband bleven beide
//  schoren actief: de getrokken strip kreeg ongeveer de helft van de kracht
//  (+5,65 kN in plaats van +12,02 kN, −53 %, onveilig) en de gedrukte strip
//  werd op knik afgekeurd (UC 38,7, te streng).
//
// HANDBEREKENING (issue #234)
//  Portaal 6 × 4 m, knopen 1 (0,0), 2 (0,4), 3 (6,4), 4 (6,0); voeten
//  scharnierend. Schoor 4 van 1 → 3 en schoor 5 van 4 → 2, Strip 50×10,
//  beide einden Ry vrij. L = √(6² + 4²) = 7,211 m, cos α = 6/7,211 = 0,832.
//  H = 10 kN naar rechts op knoop 2: schoor 4 rekt, schoor 5 wordt korter.
//  Valt schoor 5 uit, dan is het (met scharnierende knopen) een statisch
//  bepaald vakwerk:
//    knoop 2: regel 2–3 drukt H door naar knoop 3        N_regel = −10 kN
//    knoop 3: N4 · cos α = H  →  N4 = H / cos α          = +12,019 kN
//             kolom 4–3 neemt N4 · sin α op               N_kolom = −6,667 kN
//    reacties: knoop 1 Rx = −10, Rz = −6,667; knoop 4 Rz = +6,667 kN
//  Met stijve portaalhoeken draagt het portaal een klein deel mee: N4 iets
//  onder 12,02 kN (de bron noemt −0,9 % bij zijn profielen).
//
// WAT DEZE TEST VASTLEGT
//  [1] Vakwerk (scharnierende knopen): N4 = H/cos α, N5 = 0, reacties.
//  [2] Het portaal van het issue (HEA120 / IPE180, stijve hoeken): zonder
//      trek-alleen de oude verdeling (beide schoren half), mét trek-alleen
//      N5 = 0 en N4 gelijk aan het model waaruit schoor 5 is weggelaten; de
//      omgekeerde wind schakelt schoor 4 uit en N5 = N4 van [2] (symmetrie).
//  [3] Combinaties: per combinatie opgelost, niet gesuperponeerd. G + W en
//      G − W (wind beide kanten) elk gelijk aan het model met de juiste schoor
//      weggelaten; de som van de gevallen zou het fout doen.
//  [4] Tweede orde (P-Δ): gelijk aan het model zonder de gedrukte schoor.
//  [5] α_cr met de actieve staven: gelijk aan het model zonder schoor 5; met
//      alleen schoor 5 (op druk, dus uit) die van het ongeschoorde portaal.
//  [6] Staaltoets: tension_only gaat mee, de uitgeschakelde schoor krijgt
//      geen knik (6.3.1) en de trekschoor wordt op 6.2.3 getoetst.
//  [7] Poorten: projectbestand (rondgang en versie), valideerModel en de
//      sidecar (de MCP-weg).
//  [8] De Rust 2D-raamwerkroute (native-frame2d): dezelfde statuslus aan de
//      TypeScript-kant, per geval, per combinatie en tweede orde, gelijk aan
//      de TypeScript-kern.
//
// Draaien met: npx tsx test-trek-alleen.mjs  (ook tegen de sidecarbundel)

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const HIER_VP = dirname(fileURLToPath(import.meta.url));

const HIER = dirname(fileURLToPath(import.meta.url));
const NATIVE_FRAME2D = join(resolve(HIER, ".."), "src-tauri", "target", "debug",
  process.platform === "win32" ? "native-frame2d.exe" : "native-frame2d");

const { solveAllCases, solveAllCasesNonlinear } = await import("./src/components/fem/solver/engine.ts");
const { solveAllCasesNativeFrame2D, solveAllCombinationsNativeFrame2D } =
  await import("./src/components/fem/solver/nativeFrame2DRoute.ts");
const { combineResults, computeEnvelope } = await import("./src/components/fem/solver/combinations.ts");
const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");
const { bepaalAlphaCr } = await import("./src/components/fem/solver/alphaCr.ts");
const { valideerModel } = await import("./src/mcp/valideerModel.ts");
const { verwerkVerzoek } = await import("./src/mcp/sidecar.ts");
const { buildSteelCheckInputs, profileLookupKey } = await import("./src/lib/steelCheckBuilder.ts");
const { serializeProject, deserializeProject } = await import("./src/io/projectFile.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? ` — ${extra}` : ""}`); }
}
function check(naam, waarde, verwacht, absTol = 1e-3) {
  const goed = Number.isFinite(waarde) && Math.abs(waarde - verwacht) <= absTol;
  ok(`${naam}: ${Number(waarde).toFixed(4)} ≈ ${Number(verwacht).toFixed(4)}`, goed);
}

const H = 10; // kN
const L = Math.hypot(6, 4), COS = 6 / L, SIN = 4 / L;
const N_TREK_HAND = H / COS;      // 12,019 kN
const N_KOLOM_HAND = -H * SIN / COS; // −6,667 kN

const scharnier = { startRy: true, endRy: true };
/** Het portaal van het issue; `vakwerk` = alle knopen scharnierend. */
function portaal({ vakwerk = false, trek = true, zonder = [], lasten, gevallen } = {}) {
  const r = vakwerk ? { releases: { ...scharnier } } : {};
  const staven = [
    { id: 1, from: 1, to: 2, profile: "HEA120", material: "S235", ...r },
    { id: 2, from: 2, to: 3, profile: "IPE180", material: "S235", ...r },
    { id: 3, from: 4, to: 3, profile: "HEA120", material: "S235", ...r },
    { id: 4, from: 1, to: 3, profile: "Strip 50x10", material: "S235", releases: { ...scharnier }, ...(trek ? { tensionOnly: true } : {}) },
    { id: 5, from: 4, to: 2, profile: "Strip 50x10", material: "S235", releases: { ...scharnier }, ...(trek ? { tensionOnly: true } : {}) },
  ].filter((b) => !zonder.includes(b.id));
  return {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: 4000 }, { id: 3, x: 6000, z: 4000 }, { id: 4, x: 6000, z: 0 }],
    beams: staven,
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 4, type: "pinned" }],
    loadCases: gevallen ?? [{ id: 1, name: "W", type: "wind" }],
    loads: lasten ?? [{ id: 1, type: "pointForce", nodeId: 2, caseId: 1, fx: H }],
    selfWeightEnabled: false,
  };
}
const metDefaults = (m) => ({ plates: [], scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1, ...m });
const invoer = (m) => bouwMultiInput(metDefaults(m));
const N = (r, id) => (r.elements.get(id)?.N ?? NaN) / 1000;
const combo = (id, name, factors) => ({ id, name, type: "uls", formula: "", factors: new Map(Object.entries(factors).map(([k, v]) => [Number(k), v])) });

// ─────────────────────────────────────────────────────────────────────────
log(`\n[1] Vakwerk: N4 = H/cos α = ${N_TREK_HAND.toFixed(3)} kN, N5 = 0`);
// ─────────────────────────────────────────────────────────────────────────
{
  const r = solveAllCases(invoer(portaal({ vakwerk: true }))).perCase.get(1);
  check("N4 trekschoor (kN)", N(r, 4), N_TREK_HAND);
  check("N5 drukschoor uitgeschakeld (kN)", N(r, 5), 0, 1e-9);
  check("N regel 2–3 (kN)", N(r, 2), -H);
  check("N kolom 4–3 (kN)", N(r, 3), N_KOLOM_HAND);
  check("N kolom 1–2 (kN)", N(r, 1), 0);
  check("reactie knoop 1 Rx (kN)", r.reactions.get(1).fx / 1000, -H);
  check("reactie knoop 4 Rz (kN)", r.reactions.get(4).fz / 1000, -N_KOLOM_HAND);
  ok("uitgeschakeld gemeld: [5]", JSON.stringify(r.trekAlleenUitgeschakeld) === "[5]", JSON.stringify(r.trekAlleenUitgeschakeld));
  const stations = r.elements.get(5).normalForce;
  ok("N5 langs de hele staaf nul", stations.every((n) => Math.abs(n) < 1e-6), JSON.stringify(stations.slice(0, 3)));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] Het portaal van het issue (stijve hoeken)");
// ─────────────────────────────────────────────────────────────────────────
let N4portaal = NaN;
{
  const oud = solveAllCases(invoer(portaal({ trek: false }))).perCase.get(1);
  log(`    zonder trek-alleen: N4 = ${N(oud, 4).toFixed(2)} kN, N5 = ${N(oud, 5).toFixed(2)} kN (issue: +5,65 / −6,31)`);
  ok("zonder trek-alleen: beide schoren doen mee, N5 < 0 (de fout van #234)", N(oud, 5) < -1 && N(oud, 4) < 0.6 * N_TREK_HAND);

  const r = solveAllCases(invoer(portaal())).perCase.get(1);
  const ref = solveAllCases(invoer(portaal({ trek: false, zonder: [5] }))).perCase.get(1);
  N4portaal = N(r, 4);
  check("N5 = 0 (kN)", N(r, 5), 0, 1e-9);
  check("N4 = model zonder schoor 5 (kN)", N(r, 4), N(ref, 4), 1e-9);
  check("verplaatsing knoop 2 = model zonder schoor 5 (mm)", r.displacements.get(2).ux, ref.displacements.get(2).ux, 1e-9);
  check("M kolom 1–2 eind = model zonder schoor 5 (kNm)", r.elements.get(1).M_end / 1e6, ref.elements.get(1).M_end / 1e6, 1e-9);
  const d = (N4portaal / N_TREK_HAND - 1) * 100;
  ok(`N4 = ${N4portaal.toFixed(3)} kN, ${d.toFixed(2)} % van de hand (H/cos α); het portaal draagt iets mee (0 … −3 %)`, d <= 0 && d > -3);

  const omgekeerd = solveAllCases(invoer(portaal({ lasten: [{ id: 1, type: "pointForce", nodeId: 3, caseId: 1, fx: -H }] }))).perCase.get(1);
  check("wind van rechts: N4 = 0 (kN)", N(omgekeerd, 4), 0, 1e-9);
  check("wind van rechts: N5 = N4 van links (symmetrie, kN)", N(omgekeerd, 5), N4portaal, 1e-6);
  ok("wind van rechts: uitgeschakeld gemeld: [4]", JSON.stringify(omgekeerd.trekAlleenUitgeschakeld) === "[4]");
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] Combinaties: per combinatie opgelost, niet gesuperponeerd");
// ─────────────────────────────────────────────────────────────────────────
{
  const gevallen = [{ id: 1, name: "G", type: "dead" }, { id: 2, name: "W", type: "wind" }];
  const lasten = [
    { id: 1, type: "lineLoad", beamId: 2, caseId: 1, q: -5 },
    { id: 2, type: "pointForce", nodeId: 2, caseId: 2, fx: H },
  ];
  const m = portaal({ gevallen, lasten });
  const { perCase } = solveAllCases(invoer(m));
  const plus = combo(1, "1,2G + 1,5W", { 1: 1.2, 2: 1.5 });
  const min = combo(2, "1,2G − 1,5W", { 1: 1.2, 2: -1.5 });
  for (const [c, weg, actief] of [[plus, 5, 4], [min, 4, 5]]) {
    const r = combineResults(c, perCase);
    const refM = portaal({ trek: false, zonder: [weg], gevallen, lasten });
    const ref = combineResults(c, solveAllCases(invoer(refM)).perCase);
    check(`${c.name}: N${weg} = 0 (kN)`, N(r, weg), 0, 1e-9);
    check(`${c.name}: N${actief} = model zonder schoor ${weg} (kN)`, N(r, actief), N(ref, actief), 1e-9);
    check(`${c.name}: M regel 2–3 = model zonder schoor ${weg} (kNm)`, r.elements.get(2).M_end / 1e6, ref.elements.get(2).M_end / 1e6, 1e-9);
    ok(`${c.name}: uitgeschakeld gemeld: [${weg}]`, JSON.stringify(r.trekAlleenUitgeschakeld) === `[${weg}]`, JSON.stringify(r.trekAlleenUitgeschakeld));
  }
  // De som van de gevallen zou anders uitkomen: in geval G alleen (5 kN/m op
  // de regel) staan beide schoren op druk en vallen ze allebei uit; W alleen
  // schakelt alleen schoor 5 uit. 1,2·G + 1,5·W gesuperponeerd heeft dus
  // schoor 4 met de W-kracht maar zonder de G-bijdrage.
  const g = perCase.get(1), w = perCase.get(2);
  const som = 1.2 * N(g, 4) + 1.5 * N(w, 4);
  const echt = N(combineResults(plus, perCase), 4);
  log(`    superpositie zou N4 = ${som.toFixed(3)} kN geven, per combinatie ${echt.toFixed(3)} kN`);
  ok("geval G alleen: beide schoren gedrukt en uitgeschakeld", JSON.stringify(g.trekAlleenUitgeschakeld) === "[4,5]", JSON.stringify(g.trekAlleenUitgeschakeld));
  ok("per combinatie ≠ superpositie van de gevallen", Math.abs(som - echt) > 1e-3);
  const env = computeEnvelope([plus, min], perCase);
  ok("omhullende schoren 4 en 5: geen druk (N_min ≥ 0)",
    env.elements.get(4).N_min >= -1e-6 && env.elements.get(5).N_min >= -1e-6,
    `${env.elements.get(4).N_min} / ${env.elements.get(5).N_min}`);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] Tweede orde (P-Δ): gelijk aan het model zonder de gedrukte schoor");
// ─────────────────────────────────────────────────────────────────────────
{
  const gevallen = [{ id: 1, name: "G", type: "dead" }, { id: 2, name: "W", type: "wind" }];
  const lasten = [
    { id: 1, type: "pointForce", nodeId: 2, caseId: 1, fz: -200 },
    { id: 2, type: "pointForce", nodeId: 3, caseId: 1, fz: -200 },
    { id: 3, type: "pointForce", nodeId: 2, caseId: 2, fx: H },
  ];
  const c = combo(1, "1,2G + 1,5W", { 1: 1.2, 2: 1.5 });
  const r = combineResults(c, solveAllCasesNonlinear(invoer(portaal({ gevallen, lasten }))).perCase);
  const ref = combineResults(c, solveAllCasesNonlinear(invoer(portaal({ trek: false, zonder: [5], gevallen, lasten }))).perCase);
  check("2e orde: N5 = 0 (kN)", N(r, 5), 0, 1e-9);
  check("2e orde: N4 = model zonder schoor 5 (kN)", N(r, 4), N(ref, 4), 1e-6);
  check("2e orde: ux knoop 2 = model zonder schoor 5 (mm)", r.displacements.get(2).ux, ref.displacements.get(2).ux, 1e-6);
  const eerste = combineResults(c, solveAllCases(invoer(portaal({ gevallen, lasten }))).perCase);
  ok(`2e orde vergroot N4 (${N(eerste, 4).toFixed(3)} → ${N(r, 4).toFixed(3)} kN)`, N(r, 4) > N(eerste, 4));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[5] α_cr met de actieve staven");
// ─────────────────────────────────────────────────────────────────────────
{
  const gevallen = [{ id: 1, name: "G", type: "dead" }, { id: 2, name: "W", type: "wind" }];
  const lasten = [
    { id: 1, type: "pointForce", nodeId: 2, caseId: 1, fz: -150 },
    { id: 2, type: "pointForce", nodeId: 3, caseId: 1, fz: -150 },
    { id: 3, type: "pointForce", nodeId: 2, caseId: 2, fx: H },
  ];
  const c = combo(1, "1,2G + 1,5W", { 1: 1.2, 2: 1.5 });
  const inv = invoer(portaal({ gevallen, lasten }));
  const res = new Map([[1, combineResults(c, solveAllCases(inv).perCase)]]);
  const a = bepaalAlphaCr(inv, [c], res)[0];
  const invRef = invoer(portaal({ trek: false, zonder: [5], gevallen, lasten }));
  const resRef = new Map([[1, combineResults(c, solveAllCases(invRef).perCase)]]);
  const aRef = bepaalAlphaCr(invRef, [c], resRef)[0];
  log(`    α_cr = ${a.alphaCr ?? a.status}, model zonder schoor 5: ${aRef.alphaCr ?? aRef.status}`);
  ok("α_cr gelijk aan het model zonder de uitgeschakelde schoor",
    a.status === aRef.status && (a.alphaCr === null || Math.abs(a.alphaCr / aRef.alphaCr - 1) < 1e-3),
    `${JSON.stringify(a)} vs ${JSON.stringify(aRef)}`);
}

{
  // Eén schoor, die bij deze wind op druk staat: uitgeschakeld, dus α_cr van
  // het ongeschoorde portaal (zijdelingse knik) en niet dat van het
  // geschoorde. Zonder de losmaking in α_cr zou de schoor de zijdelingse
  // vorm blijven tegenhouden.
  const gevallen = [{ id: 1, name: "G", type: "dead" }, { id: 2, name: "W", type: "wind" }];
  const lasten = [
    { id: 1, type: "pointForce", nodeId: 2, caseId: 1, fz: -150 },
    { id: 2, type: "pointForce", nodeId: 3, caseId: 1, fz: -150 },
    { id: 3, type: "pointForce", nodeId: 2, caseId: 2, fx: H },
  ];
  const c = combo(1, "1,2G + 1,5W", { 1: 1.2, 2: 1.5 });
  const alpha = (m) => {
    const inv = invoer(m);
    return bepaalAlphaCr(inv, [c], new Map([[1, combineResults(c, solveAllCases(inv).perCase)]]))[0];
  };
  const trek = alpha(portaal({ zonder: [4], gevallen, lasten }));
  const ongeschoord = alpha(portaal({ trek: false, zonder: [4, 5], gevallen, lasten }));
  const gewoon = alpha(portaal({ trek: false, zonder: [4], gevallen, lasten }));
  log(`    alleen schoor 5: α_cr = ${trek.alphaCr}, ongeschoord ${ongeschoord.alphaCr}, schoor 5 als gewone staaf ${gewoon.alphaCr ?? gewoon.status}`);
  ok("alleen schoor 5 (uit): α_cr = dat van het ongeschoorde portaal",
    trek.alphaCr !== null && ongeschoord.alphaCr !== null && Math.abs(trek.alphaCr / ongeschoord.alphaCr - 1) < 1e-3);
  ok("…en niet dat met schoor 5 als gewone staaf", gewoon.status !== "bepaald" || gewoon.alphaCr > 2 * trek.alphaCr);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[6] Staaltoets: tension_only gaat mee naar de kern");
// ─────────────────────────────────────────────────────────────────────────
{
  const m = portaal();
  const c = combo(1, "W x 1,0", { 1: 1 });
  const { perCase } = solveAllCases(invoer(m));
  const combinationResults = new Map([[1, combineResults(c, perCase)]]);
  const uit = buildSteelCheckInputs({
    nodes: m.nodes, beams: m.beams, supports: m.supports, loadCases: m.loadCases,
    combinations: [c], combinationResults, plates: [],
    profileDb: new Map([["HEA120", 114], ["IPE180", 180], ["Strip 50x10", 10]]
      .map(([n, h]) => [profileLookupKey(n), { geometry: { h } }])),
  });
  const lijst = uit.inputs ?? uit;
  const s4 = lijst.find((i) => i.beam_id === 4), s5 = lijst.find((i) => i.beam_id === 5), s1 = lijst.find((i) => i.beam_id === 1);
  ok("schoor 4: tension_only = true", s4?.tension_only === true, JSON.stringify(s4 ? Object.keys(s4) : uit).slice(0, 300));
  ok("schoor 5: tension_only = true", s5?.tension_only === true);
  ok("kolom 1: geen tension_only (invoer byte-gelijk aan voorheen)", s1 !== undefined && !("tension_only" in s1));
  const nMin5 = Math.min(...(s5?.forces_envelope ?? []).map((p) => p.n_ed ?? 0));
  check("omhullende schoor 5: geen drukkracht (kN)", nMin5, 0, 1e-6);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[7] Poorten: projectbestand, valideerModel en de sidecar");
// ─────────────────────────────────────────────────────────────────────────
{
  const m = portaal();
  const v = valideerModel(m);
  ok("valideerModel: tensionOnly is een geldig veld", v.ok, JSON.stringify(v.errors));
  const fout = valideerModel({ ...m, beams: m.beams.map((b) => (b.id === 4 ? { ...b, tensionOnly: "ja" } : b)) });
  ok("valideerModel: tensionOnly moet true/false zijn", !fout.ok && fout.errors.some((e) => /tensionOnly/.test(e)), JSON.stringify(fout.errors));

  const basis = {
    nodes: m.nodes, beams: m.beams, supports: m.supports, plates: [], loads: m.loads, loadCases: m.loadCases,
    combinations: [], selfWeightEnabled: false,
  };
  let terug = null, tekst = null, err = null;
  try {
    tekst = serializeProject(basis);
    terug = deserializeProject(tekst);
  } catch (e) { err = e.message; }
  ok("projectbestand: rondgang behoudt tensionOnly", terug?.beams?.find((b) => b.id === 4)?.tensionOnly === true, err ?? "");
  ok("projectbestand: versie 10 met een trek-alleen staaf", JSON.parse(tekst ?? "{}").version === 10, String(JSON.parse(tekst ?? "{}").version));
  const zonder = JSON.parse(serializeProject({ ...basis, beams: m.beams.map(({ tensionOnly, ...b }) => b) }));
  ok("projectbestand: zonder trek-alleen staaf blijft versie 2", zonder.version === 2, String(zonder.version));

  const s = verwerkVerzoek({ v: 1, id: 1, op: "solve", payload: { model: m, combinations: [{ id: 1, name: "W x 1,0", type: "uls", factors: { 1: 1 } }] } });
  ok("sidecar solve rekent", s.ok === true, `${s.error?.code}: ${s.error?.melding}`);
  check("sidecar: N4 (kN)", s.result?.combinations?.["1"]?.elements?.["4"]?.N, N4portaal, 1e-6);
  check("sidecar: N5 (kN)", s.result?.combinations?.["1"]?.elements?.["5"]?.N, 0, 1e-9);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[8] De Rust 2D-raamwerkroute (native-frame2d)");
// ─────────────────────────────────────────────────────────────────────────
async function metNativeFrame2D(callback) {
  if (!existsSync(NATIVE_FRAME2D)) {
    throw new Error(`${NATIVE_FRAME2D} ontbreekt; bouw native-frame2d (cargo build -p openaec-native-fem --bin native-frame2d).`);
  }
  const vorige = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const result = await new Promise((res, rej) => {
      const child = spawn(NATIVE_FRAME2D, [], { stdio: ["pipe", "pipe", "pipe"] });
      const out = [], err = [];
      child.stdout.on("data", (c) => out.push(c));
      child.stderr.on("data", (c) => err.push(c));
      child.on("error", rej);
      child.on("close", (code) => {
        if (code !== 0) return rej(new Error(Buffer.concat(err).toString()));
        try { res(JSON.parse(Buffer.concat(out).toString())); } catch (e) { rej(e); }
      });
      child.stdin.end(JSON.stringify(body.inputs.input));
    });
    return new Response(JSON.stringify({ kind: "frame2d", result }), { status: 200 });
  };
  try { return await callback(); } finally { globalThis.fetch = vorige; }
}
{
  const gevallen = [{ id: 1, name: "G", type: "dead" }, { id: 2, name: "W", type: "wind" }];
  const lasten = [
    { id: 1, type: "lineLoad", beamId: 2, caseId: 1, q: -5 },
    { id: 2, type: "pointForce", nodeId: 2, caseId: 2, fx: H },
  ];
  const inv = invoer(portaal({ gevallen, lasten }));
  const plus = combo(1, "1,2G + 1,5W", { 1: 1.2, 2: 1.5 });
  const min = combo(2, "1,2G − 1,5W", { 1: 1.2, 2: -1.5 });
  const ts = solveAllCases(inv).perCase;
  await metNativeFrame2D(async () => {
    const perCase = await solveAllCasesNativeFrame2D(inv, "linear");
    check("Rust, geval W: N4 = TypeScript (kN)", N(perCase.get(2), 4), N(ts.get(2), 4), 1e-6);
    check("Rust, geval W: N5 = 0 (kN)", N(perCase.get(2), 5), 0, 1e-9);
    ok("Rust, geval W: uitgeschakeld gemeld: [5]", JSON.stringify(perCase.get(2).trekAlleenUitgeschakeld) === "[5]");
    const combis = await solveAllCombinationsNativeFrame2D(inv, [plus, min], "linear");
    for (const [c, weg, actief] of [[plus, 5, 4], [min, 4, 5]]) {
      const r = combis.get(c.id), t = combineResults(c, ts);
      check(`Rust, ${c.name}: N${weg} = 0 (kN)`, N(r, weg), 0, 1e-9);
      check(`Rust, ${c.name}: N${actief} = TypeScript (kN)`, N(r, actief), N(t, actief), 1e-6);
      check(`Rust, ${c.name}: M regel 2–3 = TypeScript (kNm)`, r.elements.get(2).M_end / 1e6, t.elements.get(2).M_end / 1e6, 1e-6);
    }
    const g2 = [{ id: 1, name: "G", type: "dead" }, { id: 2, name: "W", type: "wind" }];
    const l2 = [
      { id: 1, type: "pointForce", nodeId: 2, caseId: 1, fz: -200 },
      { id: 2, type: "pointForce", nodeId: 3, caseId: 1, fz: -200 },
      { id: 3, type: "pointForce", nodeId: 2, caseId: 2, fx: H },
    ];
    const inv2 = invoer(portaal({ gevallen: g2, lasten: l2 }));
    const r2 = (await solveAllCombinationsNativeFrame2D(inv2, [plus], "geometric")).get(1);
    const t2 = combineResults(plus, solveAllCasesNonlinear(inv2).perCase);
    check("Rust 2e orde: N5 = 0 (kN)", N(r2, 5), 0, 1e-9);
    check("Rust 2e orde: N4 = TypeScript 2e orde (kN, 0,5 %)", N(r2, 4), N(t2, 4), 0.005 * Math.abs(N(t2, 4)));
  });
}

log("[veldpatronen] trek-alleen staven maken de berekening niet-lineair (#219 × #234)");
{
  const { readFileSync } = await import("node:fs");
  const bron = (f) => readFileSync(join(HIER_VP, f), "utf8");
  const app = bron("src/App.tsx"), store = bron("src/hooks/useFemStore.ts"), sc = bron("src/mcp/sidecar.ts");
  ok("app (TS-route): geen veldsplitsing met trek-alleen staven",
    /const lineair = fem\.analysetype === "eersteOrde" && !fem\.beams\.some\(\(b\) => b\.tensionOnly\)/.test(app));
  ok("app (Rust-route): geen veldsplitsing met trek-alleen staven",
    /analysis === "linear" && !fem\.beams\.some\(\(b\) => b\.tensionOnly\) \? splitsVeldgevallen/.test(app));
  ok("store: waarschuwing in plaats van patronen", /lineair: analysetype === "eersteOrde" && !beams\.some\(\(b\) => b\.tensionOnly\)/.test(store));
  ok("sidecar: geen splitsing en wel de waarschuwing", /nonlinear \|\| metTrekAlleen \? null : splitsVeldgevallen/.test(sc)
    && (/lineair: !nonlinear && !metTrekAlleen/.test(sc)
      || (/const resultatenLineair = !nonlinear && !metTrekAlleen;/.test(sc) && /lineair: resultatenLineair/.test(sc))));
}

log(`\n${passed} geslaagd, ${failed} mislukt`);
process.exit(failed > 0 ? 1 : 0);

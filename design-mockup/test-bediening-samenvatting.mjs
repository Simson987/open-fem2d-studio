// De samenvatting van het bedieningscommando `rekenen` geeft het exacte
// veldmaximum van M en w, net als de omhullende, het rapport en MCP (issue
// #203, vervolg op #193).
//
// WAT ER MISGING
//  `samenvatting` in bediening.ts nam het grootste STATIONSWAARDE van M en w.
//  Geval 072 (ingeklemd-rol 6 m, q = 10 kN/m, IPE300): veldmoment 25,200 kNm
//  waar 9qL²/128 = 25,3125 kNm op x = 5L/8 hoort, en w = 3,986 mm op station
//  3600 waar het maximum op x = L(15 − √33)/16 = 3471 mm ligt. Bovendien gaf
//  de samenvatting alleen |M|; bij 072 is dat het inklemmingsmoment, zodat
//  het veldmaximum nergens af te lezen was. Daarom nu ook M_pos en M_neg.
//
// WAT DEZE TEST VASTLEGT
//  [1] 072: M_pos = 9qL²/128 (het stationsmaximum van dezelfde reeks is
//      25,200), M_neg = −qL²/8, M_max = |M| = qL²/8, V_max = 5qL/8, N_max = 0,
//      w_max = max q·x²(3L² − 5Lx + 2x²)/(48EI); en het stationsmaximum van w
//      ligt echt lager (de test onderscheidt oud van nieuw).
//  [2] Waar het maximum op een station ligt, verandert niets: een vrij
//      opgelegde ligger, qL²/8 en 5qL⁴/(384EI) in het midden, M_neg = 0.
//  [3] Een resultaat zonder hoekverdraaiing (`rotation`) valt voor w terug op
//      de stations, zonder fout.
//  [4] Meer combinaties: per combinatie een regel, met de factor erin.
//
// Draaien met: npx tsx test-bediening-samenvatting.mjs

const { solveAllCases } = await import("./src/components/fem/solver/engine.ts");
const { combineResults } = await import("./src/components/fem/solver/combinations.ts");
const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");
const { resolveSection } = await import("./src/lib/sectionResolver.ts");
const { combinatieSamenvatting } = await import("./src/bediening/samenvatting.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? ` — ${extra}` : ""}`); }
}
function check(naam, waarde, verwacht, relTol = 1e-5) {
  const goed = Number.isFinite(waarde) && Math.abs(waarde - verwacht) <= relTol * Math.max(1, Math.abs(verwacht));
  ok(`${naam}: ${Number(waarde).toFixed(5)} ≈ ${verwacht.toFixed(5)}`, goed);
}

const q = 10; // kN/m = N/mm
const L = 6000;
const EI = 210000 * resolveSection("S235", "IPE300").I; // N·mm²
const G = [{ id: 1, name: "G", type: "dead" }];
const COMBI = { id: 1, name: "UGT G", type: "uls", factors: new Map([[1, 1]]) };
const metDefaults = (m) => ({ plates: [], selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1, ...m });
const ligger = (steunA) => ({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: L, z: 0 }],
  beams: [{ id: 1, from: 1, to: 2, profile: "IPE300", material: "S235" }],
  supports: [steunA, { nodeId: 2, type: "zRoller" }],
  loadCases: G,
  loads: [{ id: 1, type: "lineLoad", caseId: 1, beamId: 1, q: -q }],
});
const reken = (model) => solveAllCases(bouwMultiInput(metDefaults(model))).perCase;
const samenvattingVan = (model) => {
  const res = combineResults(COMBI, reken(model));
  const s = combinatieSamenvatting(new Map([[1, res]]), [COMBI]);
  return { res, rij: s.combinaties[0], aantal: s.combinaties.length };
};
const stationsMax = (reeks) => Math.max(...reeks.map((x) => Math.abs(x)));

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] 072: ingeklemd-rol 6 m, q = 10 kN/m");
// ─────────────────────────────────────────────────────────────────────────
{
  const { res, rij, aantal } = samenvattingVan(ligger({ nodeId: 1, type: "fixed" }));
  const w = (x) => (q * x * x * (3 * L * L - 5 * L * x + 2 * x * x)) / (48 * EI);
  const wHand = w((L * (15 - Math.sqrt(33))) / 16);
  const el = res.elements.get(1);
  ok("één regel, met id en naam van de combinatie", aantal === 1 && rij.combinatie === 1 && rij.naam === "UGT G");
  check("stationsmaximum van M (de oude samenvatting) = 25,200 kNm", Math.max(...el.bendingMoment) / 1e6, 25.2);
  check("M_pos = veldmaximum 9qL²/128 = 25,3125 kNm (was 25,200)", rij.M_pos_kNm, (9 * q * 36) / 128);
  check("M_neg = −qL²/8 = −45 kNm (inklemming)", rij.M_neg_kNm, -45);
  check("M_max = grootste |M| = qL²/8 = 45 kNm", rij.M_max_kNm, 45);
  check("V_max = 5qL/8 = 37,5 kN", rij.V_max_kN, 37.5);
  check("N_max = 0", rij.N_max_kN, 0);
  check(`w_max = ${wHand.toFixed(5)} mm op x = 3471 (hand; was 3,98633 op station 3600)`, rij.w_max_mm, wHand);
  ok(`het stationsmaximum van w ligt lager (${stationsMax(el.deflection).toFixed(5)} mm): de test onderscheidt oud en nieuw`,
    stationsMax(el.deflection) < wHand * (1 - 1e-4));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] Vrij opgelegd: het maximum ligt op een station, niets verandert");
// ─────────────────────────────────────────────────────────────────────────
{
  const { res, rij } = samenvattingVan(ligger({ nodeId: 1, type: "pinned" }));
  const el = res.elements.get(1);
  check("M_pos = qL²/8 = 45 kNm", rij.M_pos_kNm, 45);
  check("M_max = M_pos", rij.M_max_kNm, rij.M_pos_kNm, 1e-12);
  check("gelijk aan het stationsmaximum", rij.M_max_kNm, stationsMax(el.bendingMoment) / 1e6, 1e-9);
  ok("M_neg = 0 (geen negatief moment)", Math.abs(rij.M_neg_kNm) < 1e-9, String(rij.M_neg_kNm));
  check("w_max = 5qL⁴/(384EI)", rij.w_max_mm, (5 * q * L ** 4) / (384 * EI));
  check("gelijk aan het stationsmaximum van w", rij.w_max_mm, stationsMax(el.deflection), 1e-9);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] Zonder hoekverdraaiing: w valt terug op de stations");
// ─────────────────────────────────────────────────────────────────────────
{
  const res = combineResults(COMBI, reken(ligger({ nodeId: 1, type: "fixed" })));
  const el = { ...res.elements.get(1) };
  delete el.rotation;
  const rij = combinatieSamenvatting(new Map([[1, { ...res, elements: new Map([[1, el]]) }]]), [COMBI]).combinaties[0];
  check("w_max = stationsmaximum", rij.w_max_mm, stationsMax(el.deflection), 1e-9);
  check("M_pos blijft het veldmaximum (V is er wel)", rij.M_pos_kNm, 25.3125);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] Twee combinaties: per combinatie een regel");
// ─────────────────────────────────────────────────────────────────────────
{
  const perCase = reken(ligger({ nodeId: 1, type: "fixed" }));
  const combis = [COMBI, { id: 7, name: "UGT 1,35 G", type: "uls", factors: new Map([[1, 1.35]]) }];
  const cr = new Map(combis.map((c) => [c.id, combineResults(c, perCase)]));
  const s = combinatieSamenvatting(cr, combis).combinaties;
  ok("twee regels, id's 1 en 7", s.length === 2 && s[0].combinatie === 1 && s[1].combinatie === 7);
  check("combinatie 7: M_pos = 1,35 · 9qL²/128", s[1].M_pos_kNm, 1.35 * 25.3125);
  ok("combinatie 7 heeft zijn eigen naam", s[1].naam === "UGT 1,35 G", s[1].naam);
}

log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);

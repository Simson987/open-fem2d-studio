// De BGT-eindtoestand van hout in een gemengd, statisch onbepaald model
// (NEN-EN 1995-1-1 + NB, 2.2.3(4), 2.2.3(5), 2.3.2.2(1)) — issue #23.
//
// WAT HIER BEWEZEN WORDT
//   [1] De melding: "niet doorgerekend (BGT)" is vervangen door de berekende
//       route; bij tweede orde en hout zonder k_def zegt de melding dat ook de
//       BGT niet is berekend.
//   [2] De varianten: elke quasi-blijvende BGT-combinatie (6.16b) krijgt een
//       BGT-eindtoestand, geen andere BGT-combinatie; id, naam en kenmerk.
//   [3] HOUT + STAAL tegen de handberekening (krachtsmethode, zie hieronder):
//       w_inst, w_qp, w_qp,fin en w₁ uit de bouwer, en w_fin en w_add uit de
//       rekenkern (toetsbrug) met de afleiding volgens 2.2.3(4).
//   [4] HOUT + BETON met φ(∞,t₀): beton krijgt E_c,eff = E_cm/(1 + φ)
//       (EN 1992-1-1 7.4.3(5)); het hout neemt dan kracht over en w_fin komt
//       GROTER uit dan de vereenvoudiging. Zonder φ houdt beton E_cm, met melding.
//   [5] Bit-identiek waar 2.2.3(5) geldt: zuiver hout, een enkele ligger en een
//       statisch bepaald gemengd model geven exact dezelfde houtinvoer als de
//       gang zonder eindtoestand, zonder het nieuwe veld.
//   [6] Geen lekkage: de staaltoets en de w_inst/w₁-keuze lezen de
//       BGT-eindtoestand niet als gewone combinatie (w₁ zelf: zie [3]).
//   [7] De MCP-weg: sidecar `check` en de MCP-server `check_fem_model` leveren
//       dezelfde w_qp,fin en dezelfde w_fin. Sinds issue #199 rekent `check` de
//       UGT-toetskrachten altijd tweede orde met scheefstand (`toetsSet2D`):
//       de houtinvoer is dan gelijk aan die van de app-gang via de toetsset,
//       en de BGT-velden blijven die van de eerste-orde-app-gang.
//
// ── HANDBEREKENING ──────────────────────────────────────────────────────────
// Ligger over twee velden A–B–C, elk L = 5000 mm, doorgaand over B.
// Veld 1 (A–B): C24 100 × 300, E_mean = 11 000 N/mm² (EN 338),
//   I₁ = 100·300³/12 = 2,25·10⁸ mm⁴ → EI₁ = 2,475·10¹² N·mm²; klimaatklasse 1,
//   k_def = 0,60 (tabel 3.2).
// Veld 2 (B–C): IPE 200, E = 210 000, I = 19,4·10⁶ → EI₂ = 4,074·10¹².
// Opleggingen A scharnier, B en C rol: n = 1. Last alleen op veld 1:
//   G = 2 kN/m (blijvend), Q = 3 kN/m (categorie A: ψ₂ = 0,3).
// BGT-combinaties (standaardset): karakteristiek G + Q = 5 kN/m,
//   quasi-blijvend G + 0,3Q = 2,9 kN/m, en alleen blijvend G = 2 kN/m.
//
// Krachtsmethode, onbekende M_B (hoekverdraaiing in B gelijk):
//   qL³/(24·EI₁) − M_B·L/(3·EI₁) = M_B·L/(3·EI₂) ⇒ M_B = (qL²/8)·EI₂/(EI₁ + EI₂).
// Zakking van veld 1 (omlaag positief), x vanaf A:
//   w(x) = q·x·(L³ − 2L·x² + x³)/(24·EI₁) − M_B·x·(L² − x²)/(6·L·EI₁).
// Maatgevend is het veldmaximum van w(x), waar θ = 0 (x ≈ 2315 mm; met EI₁/1,6
// x ≈ 2268 mm). Tot oktober 2026 mat de app het grootste van 21 stations
// (x = i·L/20, maatgevend 2250 mm) en stond hier dat stationsmaximum; sinds de
// controle van 12 oktober 2026 (punt C8, issue #193) komt het maximum tussen
// de stations mee, en is de handwaarde het echte maximum. Eindtoestand
// (2.3.2.2(1), 2.7): EI₁ → EI₁/1,6.
//
//   combinatie           EI₁        M_B [kNm]   w_max [mm]   (was w(2250))
//   G + Q (w_inst)       E_mean       9,7200      10,3803      (10,3710)
//   G + 0,3Q (w_qp)      E_mean       5,6376       6,0206       (6,0152)
//   G + 0,3Q (w_qp,fin)  E_mean,fin   6,5685       8,7251       (8,7244)
//   G (w₁)               E_mean       3,8880       4,1521       (4,1484)
//
// 2.2.3(4): w_fin = w_inst + (w_qp,fin − w_qp) = 10,3803 + (8,7251 − 6,0206)
//                 = 13,0848 mm;  w_add = w_fin − w₁ = 8,9327 mm.
// 2.2.3(5) (vereenvoudiging): w_fin = 10,3803 + 0,6·6,0206 = 13,9926 mm;
//   w_add = 9,8405 mm. Naast staal (dat niet kruipt) geeft de vereenvoudiging
//   hier dus een te GROTE zakking: het hout kruipt weg en het staal neemt
//   last over (w_qp,fin/w_qp = 1,450 in plaats van 1,6).
//
// Met beton in veld 2 (C30/37 150 × 250, E_cm = 33 000 (EN 1992-1-1 tabel 3.1),
// I = 1,953125·10⁸, EI₂ = 6,4453·10¹²) en φ(∞,t₀) = 2,5, dus E_c,eff = E_cm/3,5
// (EN 1992-1-1 7.4.3(5)), keert dat om, met dezelfde formules:
//   w_inst = 9,4234   w_qp = 5,4656   w_qp,fin = 10,3329 mm (EI₁/1,6, EI₂/3,5)
//   2.2.3(4): w_fin = 9,4234 + (10,3329 − 5,4656) = 14,2908 mm
//   2.2.3(5): w_fin = 9,4234 + 0,6·5,4656 = 12,7027 mm — hier te KLEIN:
//   het beton kruipt harder dan het hout en schuift last naar het hout.
//
// Draaien met: npx tsx test-hout-bgt-eindtoestand.mjs
//         of : node scripts/run-tests.mjs --filter=hout-bgt-eindtoestand

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HIER, "..");
const win = process.platform === "win32";
const TOETSBRUG = join(REPO, "src-tauri", "target", "release", win ? "toetsbrug.exe" : "toetsbrug");
const MCP_SERVER = join(REPO, "src-tauri", "target", "release", win ? "openaec-mcp-server.exe" : "openaec-mcp-server");

const { solveAllCases } = await import("./src/components/fem/solver/engine.ts");
const {
  combineResults, defaultCombinations, EINDTOESTAND_COMBO_OFFSET, BGT_EINDTOESTAND_VEELVOUD,
  isBgtEindtoestand, zonderBgtEindtoestand, getEindtoestandGevallen,
} = await import("./src/components/fem/solver/combinations.ts");
const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");
const {
  bepaalEindstijfheidHout, metEindtoestandVarianten, losEindtoestandOp, eindstijfheidInvoer,
} = await import("./src/lib/houtEindstijfheid.ts");
const { buildTimberCheckInputs } = await import("./src/lib/timberCheckBuilder.ts");
const { buildSteelCheckInputs, profileLookupKey } = await import("./src/lib/steelCheckBuilder.ts");
const { verwerkVerzoek } = await import("./src/mcp/sidecar.ts");
const { bepaalToetsKrachten2D, toetsSet2D } = await import("./src/lib/toetsKrachten.ts");
const { bepaalScheefstand, leidScheefstandGeometrieAf, toepasselijkeScheefstandNormen } =
  await import("./src/lib/scheefstandNorm.ts");

let passed = 0, failed = 0;
const log = (s = "") => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
}
function dicht(naam, gemeten, verwacht, tolAbs) {
  ok(naam, Number.isFinite(gemeten) && Math.abs(gemeten - verwacht) <= tolAbs,
    `${Number(gemeten).toFixed(4)} vs ${verwacht.toFixed(4)}`);
}

// ── Handberekening ──────────────────────────────────────────────────────────
const L = 5000;
const EI_HOUT = 11000 * (100 * 300 ** 3) / 12;
const EI_STAAL = 210000 * 19.4e6;
const EI_BETON = 33000 * (150 * 250 ** 3) / 12;
const KDEF = 0.6;
/** M_B in N·mm bij q in kN/m (= N/mm) op veld 1. */
const mB = (q, ei1, ei2) => (q * L * L / 8) * ei2 / (ei1 + ei2);
/**
 * Veldmaximum van veld 1, omlaag positief, in mm: het echte maximum van w(x)
 * op [0, L] (waar θ = 0), met de gulden snede. Tot oktober 2026 was dit het
 * grootste van 21 stations, omdat de app niet meer zag (punt C8).
 */
function wVeld(q, ei1, ei2) {
  const M = mB(q, ei1, ei2);
  const w = (x) => (q * x * (L ** 3 - 2 * L * x * x + x ** 3)) / (24 * ei1) - (M * x * (L * L - x * x)) / (6 * L * ei1);
  const g = (Math.sqrt(5) - 1) / 2;
  let a = 0, b = L, x1 = b - g * (b - a), x2 = a + g * (b - a);
  for (let k = 0; k < 200; k++) {
    if (w(x1) < w(x2)) { a = x1; x1 = x2; x2 = a + g * (b - a); } else { b = x2; x2 = x1; x1 = b - g * (b - a); }
  }
  return w((a + b) / 2);
}
const H = {
  inst: wVeld(5, EI_HOUT, EI_STAAL),
  qp: wVeld(2.9, EI_HOUT, EI_STAAL),
  qpFin: wVeld(2.9, EI_HOUT / (1 + KDEF), EI_STAAL),
  w1: wVeld(2, EI_HOUT, EI_STAAL),
};
H.fin = H.inst + (H.qpFin - H.qp);
H.add = H.fin - H.w1;
H.finVereenvoudigd = H.inst + KDEF * H.qp;

log("\n[0] De handberekening (zie de kop)");
dicht("M_B G+Q = 9,7200 kNm", mB(5, EI_HOUT, EI_STAAL) / 1e6, 9.72, 5e-4);
dicht("w_inst = 10,3803 mm", H.inst, 10.3803, 5e-4);
dicht("w_qp = 6,0206 mm", H.qp, 6.0206, 5e-4);
dicht("M_B G+0,3Q eindtoestand = 6,5685 kNm", mB(2.9, EI_HOUT / 1.6, EI_STAAL) / 1e6, 6.5685, 5e-4);
dicht("w_qp,fin = 8,7251 mm", H.qpFin, 8.7251, 5e-4);
dicht("w₁ = 4,1521 mm", H.w1, 4.1521, 5e-4);
dicht("w_fin (2.2.3(4)) = 13,0848 mm", H.fin, 13.0848, 5e-4);
dicht("w_add = 8,9327 mm", H.add, 8.9327, 5e-4);
dicht("w_fin vereenvoudigd (2.2.3(5)) = 13,9926 mm", H.finVereenvoudigd, 13.9926, 5e-4);

// ── Modellen ────────────────────────────────────────────────────────────────
const GEVALLEN = [{ id: 1, name: "G", type: "dead" }, { id: 2, name: "Q", type: "live", categorie: "A" }];

function tweeVelden({ veld1 = { material: "C24", profile: "100x300" }, veld2 = { material: "S235", profile: "IPE 200" }, extra = {} } = {}) {
  return {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: L, z: 0 }, { id: 3, x: 2 * L, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, ...veld1 }, { id: 2, from: 2, to: 3, ...veld2 }],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }, { nodeId: 3, type: "zRoller" }],
    plates: [],
    loadCases: GEVALLEN,
    loads: [
      { id: 1, type: "lineLoad", caseId: 1, beamId: 1, q: -2 },
      { id: 2, type: "lineLoad", caseId: 2, beamId: 1, q: -3 },
    ],
    selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
    analysetype: "eersteOrde",
    ...extra,
  };
}

/** De app-gang: bepalen, varianten, solve, eindtoestand, combineren, houtbouwer. */
function reken(m) {
  const uitkomst = bepaalEindstijfheidHout(m);
  const combinations = metEindtoestandVarianten(defaultCombinations(m.loadCases), m.loadCases, uitkomst);
  const input = bouwMultiInput(m);
  const { perCase } = solveAllCases(input);
  losEindtoestandOp(input, perCase, combinations, uitkomst);
  const combinationResults = new Map(combinations.map((c) => [c.id, combineResults(c, perCase)]));
  const data = {
    nodes: m.nodes, beams: m.beams, supports: m.supports, combinations, combinationResults,
    loadCases: m.loadCases, gevallenMetLast: [...perCase.keys()],
  };
  return { uitkomst, combinations, perCase, combinationResults, input, data, hout: buildTimberCheckInputs(data) };
}

/** De gang zonder eindtoestand: alleen de standaardcombinaties. */
function rekenOud(m) {
  const combinations = defaultCombinations(m.loadCases);
  const { perCase } = solveAllCases(bouwMultiInput(m));
  const combinationResults = new Map(combinations.map((c) => [c.id, combineResults(c, perCase)]));
  const data = {
    nodes: m.nodes, beams: m.beams, supports: m.supports, combinations, combinationResults,
    loadCases: m.loadCases, gevallenMetLast: [...perCase.keys()],
  };
  return { data, hout: buildTimberCheckInputs(data) };
}

/**
 * De houtinvoer van de app-gang sinds issue #199: de UGT uit de toetsrekengang
 * (altijd P-Δ met scheefstand φ = 1/noemer van het project, in +x en −x, zonder
 * UGT-eindtoestandvarianten), de BGT uit de resultaten van `reken` — via
 * dezelfde `bepaalToetsKrachten2D` en `toetsSet2D` als de app en de sidecar.
 */
function houtinvoerMetToetsset(m, r) {
  const normen = toepasselijkeScheefstandNormen(m.beams);
  const project = bepaalScheefstand(
    { bron: "vast", noemer: m.scheefstandNoemer, hoogteM: null, aantalElementen: null },
    leidScheefstandGeometrieAf(m), normen,
  );
  const toets = bepaalToetsKrachten2D({
    basis: r.input, combinaties: r.combinations,
    scheefstand: { project, normen, richting: m.scheefstandRichting, modelAan: m.scheefstandEnabled },
    analysetype: m.analysetype,
    resultaten: { perCase: r.perCase, combinationResults: r.combinationResults },
  });
  const set = toetsSet2D(toets, { combinaties: r.combinations, combinationResults: r.combinationResults, perCase: r.perCase }, m.beams);
  return buildTimberCheckInputs({
    ...r.data, combinations: set.combinaties, combinationResults: set.combinationResults, stabiliteit: set.stabiliteit,
  }).inputs;
}

async function kern(opdracht, inputs) {
  const antwoord = await new Promise((resolve, reject) => {
    const child = spawn(TOETSBRUG, [], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) reject(new Error(`toetsbrug stopte met code ${code ?? signal}: ${err || out}`));
      else resolve(out);
    });
    child.stdin.end(JSON.stringify({ opdracht, inputs }));
  });
  const uit = JSON.parse(antwoord);
  if (uit.fout) throw new Error(uit.fout);
  return uit;
}
const toets = (res, id) => res.checks.find((c) => c.id === id)?.kind?.data;
const heeftKern = existsSync(TOETSBRUG);
if (!heeftKern) ok("toetsbrug gevonden — bouw hem met `cargo build --release -p toetsbrug`", false, TOETSBRUG);

const BGT_OFF = EINDTOESTAND_COMBO_OFFSET * BGT_EINDTOESTAND_VEELVOUD;

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] De melding: de BGT is doorgerekend");
{
  const u = bepaalEindstijfheidHout(tweeVelden());
  ok("hout + staal → doorrekenen", u.status === "doorrekenen");
  ok("tweede melding is de BGT, nu doorgerekend",
    u.meldingen.length === 2 && u.meldingen[1].tekst.startsWith("Eindstijfheid hout doorgerekend (BGT)."),
    u.meldingen[1]?.tekst.slice(0, 60));
  ok("de oude melding \"niet doorgerekend (BGT)\" komt niet meer voor",
    u.meldingen.every((m) => !m.tekst.includes("niet doorgerekend (BGT)")));
  ok("de melding noemt 2.2.3(4), 2.7, w_qp,fin en de grens van de route (staal/beton)",
    /2\.2\.3\(4\)/.test(u.meldingen[1].tekst) && /2\.7/.test(u.meldingen[1].tekst) &&
    /w_qp,fin − w_qp/.test(u.meldingen[1].tekst) && /staal- en betonstaven/.test(u.meldingen[1].tekst));
  const tweede = bepaalEindstijfheidHout(tweeVelden({ extra: { analysetype: "tweedeOrdeGeometrisch" } }));
  ok("tweede orde: de melding zegt dat ook 2.2.3(4) niet is berekend",
    tweede.status === "alleenMelding" && /2\.2\.3\(4\)\) is niet berekend/.test(tweede.meldingen[0].tekst));
  const clt = bepaalEindstijfheidHout(tweeVelden({ veld2: { material: "C24", profile: "CLT 40/20/40/20/40" } }));
  ok("hout zonder k_def: de melding zegt dat ook 2.2.3(4) niet is berekend",
    clt.status === "alleenMelding" && /2\.2\.3\(4\)\) is niet berekend/.test(clt.meldingen[0].tekst));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] De varianten");
{
  const u = bepaalEindstijfheidHout(tweeVelden());
  const basis = defaultCombinations(GEVALLEN);
  const lijst = metEindtoestandVarianten(basis, GEVALLEN, u);
  const bgt = lijst.filter(isBgtEindtoestand);
  ok("twee BGT-eindtoestanden: de twee quasi-blijvende combinaties (7 en 8)",
    bgt.length === 2 && bgt[0].id === 7 + BGT_OFF && bgt[1].id === 8 + BGT_OFF, bgt.map((c) => c.id).join(","));
  ok("naam, kenmerk en factoren",
    bgt[0].name === "BGT quasi-blijvend 6.16b (eindtoestand BGT)" &&
    bgt[0].eindtoestand.psi2 === 1 && bgt[0].eindtoestand.bgt === true &&
    bgt[0].factors === basis.find((c) => c.id === 7).factors);
  ok("elke variant staat direct achter zijn combinatie",
    lijst.findIndex((c) => c.id === 7 + BGT_OFF) === lijst.findIndex((c) => c.id === 7) + 1);
  ok("geen variant voor 6.14b en 6.15b",
    !lijst.some((c) => isBgtEindtoestand(c) && (c.id === 5 + BGT_OFF || c.id === 6 + BGT_OFF)));
  ok("id's botsen niet met de UGT-varianten en passen in een u32",
    new Set(lijst.map((c) => c.id)).size === lijst.length && Math.max(...lijst.map((c) => c.id)) < 2 ** 32);
  ok("zonderBgtEindtoestand haalt alleen die twee weg",
    zonderBgtEindtoestand(lijst).length === lijst.length - 2 && zonderBgtEindtoestand(lijst).some((c) => c.eindtoestand?.psi2 === 1));
  ok("nvt → dezelfde lijst", metEindtoestandVarianten(basis, GEVALLEN, { status: "nvt" }) === basis);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] Hout + staal tegen de handberekening");
let rStaal;
{
  rStaal = reken(tweeVelden());
  const mi = rStaal.input.beams;
  ok("invoer volgens de kop: E·I hout en staal",
    mi[0].E === 11000 && mi[0].I === 2.25e8 && mi[1].E === 210000 && mi[1].I === 19.4e6);
  ok("de BGT-eindtoestand hangt aan perCase", getEindtoestandGevallen(rStaal.perCase, "bgt") !== undefined);
  dicht("M_B quasi-blijvend eindtoestand = 6,5685 kNm",
    Math.abs(rStaal.combinationResults.get(7 + BGT_OFF).elements.get(1).M_end) / 1e6, mB(2.9, EI_HOUT / 1.6, EI_STAAL) / 1e6, 1e-3);
  const h = rStaal.hout.inputs.find((i) => i.beam_id === 1);
  ok("houtstaaf 1 in de invoer", h !== undefined, JSON.stringify(rStaal.hout.skipped));
  dicht("w_inst = −10,3803 mm", h.deflection_inst_mm, -H.inst, 1e-3);
  dicht("w_qp = −6,0206 mm", h.deflection_quasi_perm_mm, -H.qp, 1e-3);
  dicht("w_qp,fin = −8,7251 mm", h.deflection_quasi_perm_fin_mm, -H.qpFin, 1e-3);
  dicht("w₁ = −4,1521 mm (momentaan, niet uit de eindtoestand)", h.deflection_permanent_mm, -H.w1, 1e-3);
  ok("notitie: herkomst van w_qp en w_qp,fin uit dezelfde combinatie, 2.2.3(4)",
    h.deflection_notes.some((n) => /w_qp,fin = -8,73 mm/.test(n) && /BGT quasi-blijvend 6\.16b \(eindtoestand BGT\)/.test(n) && /2\.2\.3\(4\)/.test(n)));
  ok("de oude w_qp-notitie (vereenvoudiging) is vervangen",
    !h.deflection_notes.some((n) => /Kruip volgens EN 1995-1-1 §7\.2: w_fin = w_inst \+ k_def · w_qp/.test(n)));
  ok("beide quasi-blijvende combinaties gemeten, maatgevend de grootste |w_fin|",
    h.deflection_notes.some((n) => /zonder Q/.test(n) && /grootste \|w_fin\|/.test(n)));
  ok("staalstaaf 2 is geen houtinvoer", !rStaal.hout.inputs.some((i) => i.beam_id === 2));

  if (heeftKern) {
    const [res] = (await kern("check_timber_beams", [h]));
    const fin = toets(res, "deflection_w_fin");
    const add = toets(res, "deflection_w_add");
    dicht("kern: w_fin = 13,0848 mm (2.2.3(4))", fin?.uc?.ed, H.fin, 2e-3);
    dicht("kern: w_add = 8,9327 mm", add?.uc?.ed, H.add, 2e-3);
    dicht("kern: UC w_fin = 13,0848/(5000/250)", fin?.uc?.uc, H.fin / 20, 1e-4);
    ok("kern: formule en w_qp,fin in de afleiding",
      fin?.formula_latex.includes("w_{qp,fin,z}") && fin.variables.some((v) => v.symbol === "w_{qp,fin}"));
    ok("kern: vergelijking met de vereenvoudiging (−13,99 mm) in de notitie",
      fin?.notes.some((n) => /2\.2\.3\(4\)/.test(n) && /-13,99 mm/.test(n)));
    ok("kern: w_add-notitie legt w₂ + w₃ uit", add?.notes.some((n) => /w₂ \+ w₃/.test(n)));
    // Dezelfde staaf zonder het veld: de vereenvoudiging, zoals vóór #23.
    const zonder = { ...h };
    delete zonder.deflection_quasi_perm_fin_mm;
    const [oud] = (await kern("check_timber_beams", [zonder]));
    dicht("kern zonder w_qp,fin: w_fin = 13,9926 mm (vereenvoudiging)", toets(oud, "deflection_w_fin")?.uc?.ed, H.finVereenvoudigd, 2e-3);
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] Hout + beton met en zonder φ(∞,t₀)");
{
  const PHI = 2.5;
  const beton = { material: "C30/37", profile: "150x250" };
  const hand = {
    inst: wVeld(5, EI_HOUT, EI_BETON),
    qp: wVeld(2.9, EI_HOUT, EI_BETON),
    qpFin: wVeld(2.9, EI_HOUT / 1.6, EI_BETON / (1 + PHI)),
  };
  hand.fin = hand.inst + (hand.qpFin - hand.qp);
  hand.vereenvoudigd = hand.inst + KDEF * hand.qp;
  dicht("hand: w_inst = 9,4234 mm", hand.inst, 9.4234, 5e-4);
  dicht("hand: w_qp = 5,4656 mm", hand.qp, 5.4656, 5e-4);
  dicht("hand: w_qp,fin = 10,3329 mm", hand.qpFin, 10.3329, 5e-4);
  dicht("hand: w_fin (2.2.3(4)) = 14,2908 mm", hand.fin, 14.2908, 5e-4);
  dicht("hand: w_fin vereenvoudigd = 12,7027 mm", hand.vereenvoudigd, 12.7027, 5e-4);
  log(`    hand: w_inst ${hand.inst.toFixed(4)}, w_qp ${hand.qp.toFixed(4)}, w_qp,fin ${hand.qpFin.toFixed(4)}, ` +
    `w_fin ${hand.fin.toFixed(4)}, vereenvoudigd ${hand.vereenvoudigd.toFixed(4)} mm`);

  const m = tweeVelden({ veld2: beton, extra: { betonKruipcoefficient: PHI } });
  const r = reken(m);
  ok("invoer: beton E_cm = 33 000 en I = 150·250³/12", r.input.beams[1].E === 33000 && r.input.beams[1].I === 150 * 250 ** 3 / 12);
  ok("φ per betonstaaf: staaf 2 → 2,5", r.uitkomst.betonPhiPerStaaf.get(2) === PHI);
  const bgtInvoer = eindstijfheidInvoer(r.input, r.uitkomst, "bgt");
  const ugtInvoer = eindstijfheidInvoer(r.input, r.uitkomst, 1);
  ok("BGT-eindtoestand: beton E_cm/(1 + φ), hout E_mean/(1 + k_def)",
    bgtInvoer.beams[1].E === 33000 / 3.5 && bgtInvoer.beams[0].E === 11000 / 1.6);
  ok("UGT-variant ψ₂ = 1: beton houdt E_cm (zoals #8)", ugtInvoer.beams[1].E === 33000 && ugtInvoer.beams[0].E === 11000 / 1.6);
  ok("melding noemt E_c,eff en 7.4.3(5)", /E_c,eff = E_cm\/\(1 \+ φ\(∞,t₀\)\)/.test(r.uitkomst.meldingen[1].tekst) && /7\.4\.3\(5\)/.test(r.uitkomst.meldingen[1].tekst));
  const h = r.hout.inputs.find((i) => i.beam_id === 1);
  dicht("w_qp = hand", h.deflection_quasi_perm_mm, -hand.qp, 1e-3);
  dicht("w_qp,fin = hand (beton met E_c,eff)", h.deflection_quasi_perm_fin_mm, -hand.qpFin, 1e-3);
  ok("beton kruipt harder dan hout: w_qp,fin/w_qp > 1 + k_def", hand.qpFin / hand.qp > 1.6, (hand.qpFin / hand.qp).toFixed(4));
  if (heeftKern) {
    const [res] = (await kern("check_timber_beams", [h]));
    dicht("kern: w_fin = hand, groter dan de vereenvoudiging", toets(res, "deflection_w_fin")?.uc?.ed, hand.fin, 2e-3);
    ok("... en dat is meer dan de vereenvoudiging", hand.fin > hand.vereenvoudigd);
  }

  // Staafwaarde in het §5.8-blok gaat voor de projectwaarde.
  const eigen = bepaalEindstijfheidHout(tweeVelden({
    veld2: { ...beton, checkConfig: { betonKolom: { phi_inf_t0: 1.5 } } }, extra: { betonKruipcoefficient: PHI },
  }));
  ok("staafwaarde φ = 1,5 gaat voor de projectwaarde", eigen.betonPhiPerStaaf.get(2) === 1.5);

  const zonderPhi = reken(tweeVelden({ veld2: beton }));
  ok("zonder φ: geen φ per staaf, beton houdt E_cm in de BGT-eindtoestand",
    zonderPhi.uitkomst.betonPhiPerStaaf.size === 0 &&
    eindstijfheidInvoer(zonderPhi.input, zonderPhi.uitkomst, "bgt").beams[1].E === 33000);
  ok("zonder φ: melding dat betonstaaf 2 E_cm houdt en de houtzakking te klein kan zijn",
    /Betonstaaf 2 houdt E_cm/.test(zonderPhi.uitkomst.meldingen[1].tekst) && /te klein/.test(zonderPhi.uitkomst.meldingen[1].tekst));
  const hz = zonderPhi.hout.inputs.find((i) => i.beam_id === 1);
  dicht("zonder φ: w_qp,fin met E_cm voor beton = hand",
    hz.deflection_quasi_perm_fin_mm, -wVeld(2.9, EI_HOUT / 1.6, EI_BETON), 1e-3);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[5] Bit-identiek waar 2.2.3(5) geldt");
{
  for (const [naam, m] of [
    ["zuiver hout (C24 + GL24h, klimaatklasse 1)", tweeVelden({ veld2: { material: "GL24h", profile: "100x300" } })],
    ["enkele houten ligger", (() => {
      const e = tweeVelden();
      e.nodes = e.nodes.slice(0, 2); e.beams = e.beams.slice(0, 1);
      e.supports = [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }];
      return e;
    })()],
    ["gemengd maar statisch bepaald (scharnier in B)", tweeVelden({ veld1: { material: "C24", profile: "100x300", releases: { endRy: true } } })],
  ]) {
    const nieuw = reken(m);
    const oud = rekenOud(m);
    ok(`${naam}: geen varianten`, nieuw.combinations.length === oud.data.combinations.length);
    ok(`${naam}: houtinvoer bit-identiek`, JSON.stringify(nieuw.hout) === JSON.stringify(oud.hout));
    ok(`${naam}: geen deflection_quasi_perm_fin_mm`, nieuw.hout.inputs.every((i) => !("deflection_quasi_perm_fin_mm" in i)));
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[6] Geen lekkage naar de andere toetsen");
{
  const { data, combinations } = rStaal;
  const profileDb = new Map();
  for (const p of JSON.parse(readFileSync(join(REPO, "src-tauri", "crates", "steel-profiles", "data", "profiles.json"), "utf8"))) {
    const k = profileLookupKey(p.name);
    if (!profileDb.has(k)) profileDb.set(k, p);
  }
  const staalMet = buildSteelCheckInputs({ ...data, profileDb });
  const staalZonder = buildSteelCheckInputs({ ...data, combinations: zonderBgtEindtoestand(combinations), profileDb });
  ok("staaltoets: invoer gelijk met en zonder BGT-eindtoestand in de lijst",
    JSON.stringify(staalMet) === JSON.stringify(staalZonder) && staalMet.inputs.length === 1);
  // De w₁-bepaling (`blijvendeZakking`) slaat de eindtoestand van "zonder Q"
  // over: bij [3] is w₁ = −4,1521 mm, de momentane waarde, en niet −6,0173 mm
  // uit de eindtoestand (veldmaxima, zie de kop; over de 21 stations was dat
  // −4,1484 en −6,0168 mm).
  // De houtinvoer van de gang zonder BGT-eindtoestand (alleen de UGT-varianten)
  // heeft dezelfde w_inst en w₁: de variant telt niet mee als karakteristieke
  // of blijvende combinatie.
  // LET OP: dit is een regel van de BOUWER, niet de app-route. Sinds issue
  // #199 (B10) stuurt de app geen UGT-eindtoestandvarianten meer naar de
  // houtbouwer (de toets rekent tweede orde); de bouwer moet ze wel blijven
  // herkennen als een aanroeper ze meegeeft.
  const alleenUgt = { ...data, combinations: zonderBgtEindtoestand(combinations) };
  const h0 = buildTimberCheckInputs(alleenUgt).inputs.find((i) => i.beam_id === 1);
  const h1 = rStaal.hout.inputs.find((i) => i.beam_id === 1);
  ok("hout: w_inst en w₁ gelijk met en zonder de BGT-eindtoestand",
    h0.deflection_inst_mm === h1.deflection_inst_mm && h0.deflection_permanent_mm === h1.deflection_permanent_mm);
  ok("hout zonder BGT-eindtoestand maar mét UGT-varianten: geen w_qp,fin, wél een LET OP-notitie",
    !("deflection_quasi_perm_fin_mm" in h0) && h0.deflection_notes.some((n) => /LET OP/.test(n) && /2\.2\.3\(5\)/.test(n)));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[7] De MCP-weg");
{
  const m = tweeVelden();
  const model = { nodes: m.nodes, beams: m.beams, supports: m.supports, loadCases: m.loadCases, loads: m.loads };
  const antwoord = verwerkVerzoek({ id: 1, op: "check", payload: { model } });
  const r = antwoord.result ?? antwoord.resultaat ?? antwoord;
  const h = (r.timber_check_inputs ?? []).find((i) => i.beam_id === 1);
  ok("sidecar: houtinvoer voor staaf 1", h !== undefined, JSON.stringify(r).slice(0, 300));
  if (h) {
    dicht("sidecar: w_qp,fin = −8,7251 mm", h.deflection_quasi_perm_fin_mm, -H.qpFin, 1e-3);
    // Tot issue #199 was deze invoer byte-identiek met de eerste-orde-app-gang
    // `reken`. Nu rekent `check` de UGT zelf tweede orde met scheefstand
    // (φ = 1/200, ±x; de UGT-eindtoestandvarianten vallen weg), dus verschillen
    // `forces_envelope` en de belastingduur per combinatie (nu met de varianten
    // in −x). Gelijk blijft hij met de app-gang via de toetsset — dezelfde
    // functies — en de BGT-velden met die van `reken` (B6: de BGT leest de
    // resultaten).
    // Wat dit bewijst: de sidecar volgt DEZELFDE toetsfuncties
    // (`bepaalToetsKrachten2D` + `toetsSet2D`) als de testhulp. De
    // samenvoeging in App.tsx zelf (`handleRunMemberChecks`) bewaken
    // test-toets-drie-wegen en test-toets-app-route; de BGT-eindtoestand van
    // hout langs die app-route niet.
    ok("sidecar: gelijk aan dezelfde toetsfuncties (bepaalToetsKrachten2D + toetsSet2D: UGT tweede orde met scheefstand, BGT uit de resultaten)",
      JSON.stringify(h) === JSON.stringify(houtinvoerMetToetsset(tweeVelden(), rStaal).find((i) => i.beam_id === 1)));
    const bgt = (i) => JSON.stringify(Object.fromEntries(Object.entries(i ?? {}).filter(([k]) => k.startsWith("deflection_"))));
    ok("sidecar: de BGT-velden zijn die van de eerste-orde-app-gang", bgt(h) === bgt(rStaal.hout.inputs.find((i) => i.beam_id === 1)), bgt(h));
    ok("sidecar: de UGT-toets bevat beide richtingen en geen UGT-eindtoestandvariant",
      h.forces_envelope.some((p) => p.combination_id >= 1_000_000 && p.combination_id < EINDTOESTAND_COMBO_OFFSET) &&
      !h.forces_envelope.some((p) => p.combination_id >= EINDTOESTAND_COMBO_OFFSET),
      JSON.stringify([...new Set(h.forces_envelope.map((p) => p.combination_id))]));
  }
  ok("sidecar: de BGT-melding in `warnings`",
    (r.warnings ?? []).some((w) => w.startsWith("Eindstijfheid hout doorgerekend (BGT).")) &&
    !(r.warnings ?? []).some((w) => w.includes("niet doorgerekend (BGT)")));

  if (!existsSync(MCP_SERVER)) {
    ok("MCP-server gevonden — bouw hem met `cargo build --release -p openaec-mcp-server` (na `npm run build:sidecar`)", false, MCP_SERVER);
  } else {
    const uit = await new Promise((klaar, mis) => {
      const k = spawn(MCP_SERVER, [], { stdio: ["pipe", "pipe", "pipe"] });
      const klok = setTimeout(() => { k.kill(); mis(new Error("MCP-server reageerde niet binnen 120 s")); }, 120_000);
      let buf = "";
      k.on("error", (e) => { clearTimeout(klok); mis(e); });
      k.stdout.on("data", (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const regel = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!regel) continue;
          const bericht = JSON.parse(regel);
          if (bericht.id === 2) { clearTimeout(klok); k.stdin.end(); klaar(bericht); }
        }
      });
      const schrijf = (o) => k.stdin.write(JSON.stringify(o) + "\n");
      schrijf({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-hout-bgt-eindtoestand", version: "1" } } });
      schrijf({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "check_fem_model", arguments: { model } } });
    });
    const inhoud = uit?.result?.structuredContent;
    ok("MCP check_fem_model slaagt", !uit?.error && !uit?.result?.isError, JSON.stringify(uit?.error ?? uit?.result?.content).slice(0, 300));
    const res = inhoud?.timber_results?.find((t) => t.beam_id === 1);
    ok("MCP: houtresultaat staaf 1", res !== undefined);
    if (res) {
      dicht("MCP: w_fin = 13,0848 mm (2.2.3(4))", toets(res, "deflection_w_fin")?.uc?.ed, H.fin, 2e-3);
      dicht("MCP: w_add = 8,9327 mm", toets(res, "deflection_w_add")?.uc?.ed, H.add, 2e-3);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[8] Het staalveld in de UGT-toets: zonder eindtoestandvariant (B10 van #199)");
// VERANDERD GETAL, VERANTWOORD. Tot issue #199 kreeg de staaltoets van dit
// model M_B uit de UGT-variant met E_mean,fin (2.2.2(1)P, tweede streepje):
// het hout slapper, dus meer moment naar het staal. De toets rekent nu altijd
// tweede orde en laat die varianten vallen (B10); het hout rekent met E_mean.
// HAND (1,2·G + 1,5·Q = 6,9 kN/m op veld 1, qL²/8 = 21,5625 kNm):
//   E_mean      : M_B = 21,5625 · 4,074/(2,475 + 4,074)     = 13,4136 kNm (de toets nu)
//   E_mean,fin  : M_B = 21,5625 · 4,074/(2,475/1,6 + 4,074) = 15,6285 kNm (vóór #199)
//   E_d (γ_M 1,3): M_B = 21,5625 · 4,074/(2,475/1,3 + 4,074) = 14,6952 kNm (normroute 2e orde)
// Verschil −14,2 % tegen het oude getal en −8,7 % tegen de normroute: het
// staalveld is in de toets te LICHT. Dat is een gemelde beperking tot fase 4
// (E_d per houtstaaf): de melding van de vervallen varianten zegt nu dat de
// staal- en betonstaven daardoor minder kracht krijgen en dat de eindtoestand
// apart beoordeeld moet worden. Scheefstand en P-Δ veranderen het moment hier
// nauwelijks (geen noemenswaardige normaalkracht in de ligger).
{
  const m = tweeVelden();
  const r = reken(m);
  const normen = toepasselijkeScheefstandNormen(m.beams);
  const project = bepaalScheefstand(
    { bron: "vast", noemer: m.scheefstandNoemer, hoogteM: null, aantalElementen: null },
    leidScheefstandGeometrieAf(m), normen,
  );
  const t = bepaalToetsKrachten2D({
    basis: r.input, combinaties: r.combinations,
    scheefstand: { project, normen, richting: 1, modelAan: false },
    analysetype: "eersteOrde",
    resultaten: { perCase: r.perCase, combinationResults: r.combinationResults },
  });
  const maxStaal = (map, filter = () => true) => Math.max(...[...map.entries()].filter(([id]) => filter(id))
    .map(([, res]) => Math.max(...res.elements.get(2).bendingMoment.map(Math.abs)))) / 1e6;
  const handEmean = mB(6.9, EI_HOUT, EI_STAAL) / 1e6;
  const handFin = mB(6.9, EI_HOUT / 1.6, EI_STAAL) / 1e6;
  const handEd = mB(6.9, EI_HOUT / 1.3, EI_STAAL) / 1e6;
  const inToets = maxStaal(t.combinationResults);
  const inResultaten = maxStaal(r.combinationResults, (id) => r.combinations.find((c) => c.id === id)?.type === "uls");
  log(`    staalveld max|M|: toets ${inToets.toFixed(4)} kNm, resultaten (met E_mean,fin-variant) ${inResultaten.toFixed(4)} kNm; ` +
    `hand E_mean ${handEmean.toFixed(4)}, E_mean,fin ${handFin.toFixed(4)}, E_d ${handEd.toFixed(4)}`);
  dicht("hand: M_B met E_mean = 13,4136 kNm", handEmean, 13.4136, 1e-4);
  dicht("hand: M_B met E_mean,fin = 15,6285 kNm", handFin, 15.6285, 1e-4);
  dicht("hand: M_B met E_d = E_mean/1,3 = 14,6952 kNm", handEd, 14.6952, 1e-4);
  dicht("toets: max|M| in het staalveld = 13,414 kNm (E_mean; de hand 13,4136, +0,004 %)", inToets, 13.414, 2e-3);
  dicht("resultaten: de E_mean,fin-variant geeft 15,6285 kNm (zoals vóór #199)", inResultaten, 15.6285, 2e-3);
  ok("de toets bevat geen eindtoestandvariant", ![...t.combinationResults.keys()].some((id) => id >= EINDTOESTAND_COMBO_OFFSET));
  ok("de melding zegt dat staal en beton in de toets minder kracht krijgen en dat de eindtoestand apart moet",
    t.meldingen.some((x) => /Vervallen in de toets/.test(x) && /MINDER kracht/.test(x) && /apart/.test(x)), t.meldingen.join(" | "));
}

log(`\n${failed === 0 ? "GESLAAGD" : "GEFAALD"}: ${passed} geslaagd, ${failed} gefaald.`);
process.exit(failed === 0 ? 0 : 1);

// Staven in elkaars verlengde: één lijn voor de kip en de doorbuiging, de
// knik per vak tussen de knopen waar andere staven aansluiten (controle
// oktober 2026, punt K6, issue #188, en de review daarvan).
//
// Het geval van de controle: een vakwerk 12 × 2 m. Onderrand knopen 1–5
// (x = 0/3/6/9/12 m), bovenrand knopen 6–8 (x = 3/6/9 m, z = 2 m), randen
// SHS 100×100×5 doorgaand, wandstaven SHS 80×80×4 scharnierend, S355; knoop 1
// scharnier, knoop 5 rol; G = 3 × 30 kN op de bovenrandknopen. De toetsing
// voegde de bovenrand (staven 6 en 7) samen tot één staaf van 6 m met
// L_cr = 6000 mm en UC 6.3.1 = 0,842, hoewel op de tussenknoop 7 wandstaven
// aansluiten.
//
// Handberekening (knopenmethode, EN 1993-1-1 6.3.1, knikkromme a):
//   N_G bovenrand = −(45·6 − 30·3)/2 = −90 kN;  N_Ed = 1,35·N_G = −121,5 kN
//   i = 38,62 mm (SHS: om y en z gelijk), A = 1873 mm²
//   L_cr = knoopafstand 3000 mm: λ̄ = 3000/38,62/76,41 = 1,017, χ = 0,654,
//   N_b,Rd = 434,8 kN, UC = 121,1/434,9 = 0,278 (met de N_Ed van het
//   raamwerk, 0,3 % onder de knopenmethode omdat de randen doorgaand zijn)
//   L_cr = hele lijn 6000 mm: λ̄ = 2,033, N_b,Rd = 143,8 kN, UC = 0,842
//
// ISSUE #201: OM z IS EEN AANSLUITING IN HET VLAK GEEN VAKGRENS. Tot #201
// kreeg de bovenrand ook om z de knoopafstand (3000 mm), als AANNAME in het
// rapport: dat de wandstaven op knoop 7 de rand ook loodrecht op het vlak
// vasthouden. Dat doen ze niet; een gording of een windverband wel, en dat
// moet de gebruiker opgeven (kipsteun aan beide flenzen, of L_cr,z). Zonder
// opgave rekent de kern nu om z met de hele lijn: L_cr,y = 3000 mm (vak),
// L_cr,z = 6000 mm, UC 6.3.1 = 0,278 → 0,842 (om z maatgevend). De kolom met
// een ligger aan één kant: 0,498 → 1,162 NotOk, gelijk aan de opgave
// L_cr,z = 6 m die de oude notitie voorstelde. Met een verband dat als
// zijdelingse steun is opgegeven (kipsteun aan beide flenzen op de knoop)
// blijft het vak om z gelden: 0,498.
//
// Een eerste oplossing knipte de lijn op elke knoop met een aansluiting. De
// review vond dat daarmee de knoop stil een gaffel werd voor de kip, de
// zakking van de lijn uit de doorbuiging viel, en een scharnier of veer op de
// knip de knik- en kiptoets liet weigeren bij status Ok. Nu (zie de kop van
// `src/lib/doorgaandeLijn.ts`):
//   - de lijn blijft één staaf voor de kip en de doorbuiging, ook over een
//     aansluiting, een scharnier of een veer; alleen een oplegging of een
//     plaat knipt haar;
//   - de knik IN HET VLAK krijgt zonder opgave de grootste knoopafstand
//     tussen knopen met een aansluiting die ergens aan vastzit (de
//     systeemlengte); loodrecht op het vlak niet (#201, zie hierboven);
//   - een aansluiting met een vrij ander eind (een paal met vrije kop) is geen
//     vakgrens;
//   - alleen tussen twee gaffels: bij een VRIJ of DOORLOPEND lijneind geen
//     kniklengte per vak (review van de samenvoeging 2026.42). Een kolom
//     HEA200 0–3–7 m met een vrije top en een pendelligger op 3 m kreeg per vak
//     4 m en UC 0,255 Ok; α_cr in het vlak geeft L_cr,y = 9,54 m, dus ook
//     2 × het eindvak (8 m) is te kort. Nu geldt de regel van de kern, 2·L =
//     14 m: UC 1,671 NotOk. Een lijn die doorloopt in een HEA160 kreeg 3/3 m
//     "als opgegeven" en omzeilde zo de weigering van de kern.
//
// Regressie op de UC van de kern (toetsbrug), met de gevallen van de review:
//   kolom HEA160 6 m, N_Ed = 300 kN, ligger op 3 m: om z de hele lijn,
//     1,162 NotOk (tot #201 per vak 0,498, als aanname om z); met een verband
//     op 3 m dat als zijdelingse steun is opgegeven 0,498;
//   ligger IPE300 6 m met een paal met vrije kop op 3 m: kip over 6 m
//     UC 2,235 NotOk; w_fin over 6 m 22,43 mm tegen ℓ_rep/250 = 24,0 mm
//     (vloer, NEN-EN 1990/NB A1.4.3(4), #192) UC 0,935;
//   kolom met een veer op 3 m: 6.3.1 over 6 m UC 1,162 NotOk;
//   Gerberligger 0-6-8(scharnier)-14: staaf 2 als lijn van 8 m, kip 1,430 NotOk;
//   hout C24 120×120 6 m met de veer, P-Δ, N_d = 20 kN: 1,321 NotOk.
//
// Drie wegen: de bouwer zoals de toetsstore hem aanroept, de kern via de
// toetsbrug, en `check_fem_model` via de MCP-server met de exacte aanroep van
// de controle (`testdata/controle-2026-10/k6/invoer-006-*.json`) en de
// gevallen van de review. Sinds issue #199 rekent `check_fem_model` de
// UGT-toetskrachten altijd P-Δ met scheefstand φ = 1/200; de bouwerroute
// hierboven voedt de kern nog met eerste-ordekrachten. Waar de MCP-getallen
// daardoor verschuiven, staat de verantwoording in [10].
//
// Uitvoeren: npx tsx test-vakwerk-kniklengte.mjs

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HIER, "..");
const DATA = join(HIER, "testdata", "controle-2026-10", "k6");
const win = process.platform === "win32";
const TOETSBRUG = join(REPO, "src-tauri", "target", "release", win ? "toetsbrug.exe" : "toetsbrug");
const MCP_SERVER = join(REPO, "src-tauri", "target", "release", win ? "openaec-mcp-server.exe" : "openaec-mcp-server");

const { solveAllCases } = await import("./src/components/fem/solver/engine.ts");
const { combineResults } = await import("./src/components/fem/solver/combinations.ts");
const { buildSteelCheckInputs, profileLookupKey } = await import("./src/lib/steelCheckBuilder.ts");
const { buildTimberCheckInputs } = await import("./src/lib/timberCheckBuilder.ts");
const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");

let passed = 0, failed = 0;
const log = (s = "") => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
}
function dicht(naam, gemeten, verwacht, tol) {
  ok(naam, Number.isFinite(gemeten) && Math.abs(gemeten - verwacht) <= tol,
    `${Number(gemeten).toFixed(4)} tegen ${verwacht.toFixed(4)}`);
}

// ── Handwaarden ─────────────────────────────────────────────────────────────
const E = 210000, FY = 355, A = 1873, I_STRAAL = 38.62;
const N_HAND = 1.35 * -(45.0 * 6.0 - 30.0 * 3.0) / 2.0;
function knik(lcrMm, nEd) {
  const lam1 = Math.PI * Math.sqrt(E / FY);
  const lam = lcrMm / I_STRAAL / lam1;
  const phi = 0.5 * (1 + 0.21 * (lam - 0.2) + lam * lam);
  const chi = Math.min(1, 1 / (phi + Math.sqrt(phi * phi - lam * lam)));
  const nbRd = chi * A * FY / 1000;
  return { lam, chi, nbRd, uc: Math.abs(nEd) / nbRd };
}
dicht("hand: N_Ed bovenrand = 1,35·(−90) = −121,5 kN", N_HAND, -121.5, 1e-9);
dicht("hand: λ̄ bij L_cr = 3000 mm = 1,017", knik(3000, N_HAND).lam, 1.017, 5e-4);
dicht("hand: N_b,Rd bij L_cr = 3000 mm = 434,8 kN", knik(3000, N_HAND).nbRd, 434.8, 0.1);
dicht("hand: L_cr = 6000 mm (de hele lijn) geeft N_b,Rd = 143,8 kN", knik(6000, N_HAND).nbRd, 143.8, 0.1);

// ── Model en bouwer zoals de toetsstore ─────────────────────────────────────
const PROFIELEN = JSON.parse(
  readFileSync(join(REPO, "src-tauri", "crates", "steel-profiles", "data", "profiles.json"), "utf8"),
);
const profileDb = new Map();
for (const p of PROFIELEN) {
  const k = profileLookupKey(p.name);
  if (!profileDb.has(k)) profileDb.set(k, p);
}
const combos = [
  { id: 1, name: "UGT 6.10a", type: "uls", formula: "1.35G", factors: new Map([[1, 1.35]]) },
  { id: 2, name: "BGT karakteristiek", type: "sls", formula: "G", factors: new Map([[1, 1]]),
    standaard: { soort: "6.14b", leidend: null, gevolgklasse: "CC2", kenmerk: "" } },
];
const project = (bestand) => JSON.parse(readFileSync(join(DATA, bestand), "utf8"));
const G = [{ id: 1, name: "G", type: "dead" }];

/** Rekenen en de toetsinvoer bouwen zoals `checkStore.run` dat doet. */
function bouw(m, soort = "staal") {
  const mi = bouwMultiInput({
    nodes: m.nodes, beams: m.beams, supports: m.supports, loads: m.loads, loadCases: m.loadCases ?? G,
    plates: m.plates ?? [], selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200,
    scheefstandRichting: 1,
  });
  const { perCase } = solveAllCases(mi);
  const combinationResults = new Map(combos.map((c) => [c.id, combineResults(c, perCase)]));
  const data = {
    nodes: m.nodes, beams: m.beams, alleBeams: m.beams, supports: m.supports, plates: m.plates ?? [],
    combinations: combos, combinationResults, loadCases: m.loadCases ?? G,
  };
  return soort === "staal" ? buildSteelCheckInputs({ ...data, profileDb }) : buildTimberCheckInputs(data);
}

function kern(inputs, opdracht = "check_steel_beams") {
  const r = spawnSync(TOETSBRUG, [], {
    input: JSON.stringify({ opdracht, inputs }), encoding: "utf8", maxBuffer: 256 << 20,
  });
  if (r.status !== 0 || !r.stdout) throw new Error(`toetsbrug faalde: ${(r.stderr ?? "").slice(0, 300)}`);
  const uit = JSON.parse(r.stdout);
  if (uit.fout) throw new Error(uit.fout);
  return uit;
}
const toets = (res, id) => res?.checks?.find((c) => c.id === id)?.kind?.data;
const knikToets = (res) => toets(res, "6.3.1_buckling");
const variabele = (data, symbool) => data?.variables?.find((v) => v.symbol === symbool)?.value;
const notities = (i) => i?.staaf_notities ?? [];
const heeftKern = existsSync(TOETSBRUG);
if (!heeftKern) ok("toetsbrug gevonden — bouw hem met `cargo build --release -p toetsbrug`", false, TOETSBRUG);

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] Vakwerk 006: elke rand één lijn, de knik in het vlak per vak, om z de hele lijn (#201)");
// ─────────────────────────────────────────────────────────────────────────
const vakwerk = project("model-006-vakwerk.ifcfem");
{
  const r = bouw(vakwerk);
  const invoer = (id) => r.inputs.find((i) => i.beam_id === id);
  const boven = invoer(6), onder = invoer(1);
  ok("bovenrand: staaf 7 overgeslagen als deel van de lijn die als staaf 6 is getoetst",
    r.skipped.some((s) => s.beamId === 7 && /doorgaande lijn.*staaf 6/.test(s.reason)), JSON.stringify(r.skipped));
  ok("onderrand: staven 2, 3 en 4 overgeslagen als deel van de lijn 1",
    [2, 3, 4].every((id) => r.skipped.some((s) => s.beamId === id && /doorgaande lijn.*staaf 1/.test(s.reason))));
  ok("bovenrand staaf 6: L = 6,000 m, L_cr,y = 3,000 m (de knoopafstand), L_cr,z niet gezet (de kern: de hele lijn)",
    boven?.length_m === 6 && boven.buckling_length_y_m === 3 && boven.buckling_length_z_m === 0,
    boven ? `L ${boven.length_m}, L_cr ${boven.buckling_length_y_m}/${boven.buckling_length_z_m}` : "ontbreekt");
  ok("onderrand staaf 1: L = 12,000 m, L_cr,y = 3,000 m, L_cr,z niet gezet",
    onder?.length_m === 12 && onder.buckling_length_y_m === 3 && onder.buckling_length_z_m === 0);
  ok("bovenrand: de notitie noemt de lijn, KNIK PER VAK op knoop 7, en om z GEEN vakgrens met de hele lijn",
    notities(boven).some((n) => /^DOORGAANDE LIJN/.test(n) && /6,000 m/.test(n))
    && notities(boven).some((n) => /^KNIK PER VAK\. Op knoop 7 /.test(n) && /vakken van 3,000 · 3,000 m/.test(n)
      && /L_cr,y = 3,000 m/.test(n) && /knoop 7 GEEN vakgrens/.test(n) && /L_cr,z = 6,000 m, de hele lijn/.test(n)
      && /kipsteun aan beide flenzen op, of geef L_cr,z op/.test(n) && !/AANNAME/.test(n)),
    JSON.stringify(notities(boven)));
  ok("bovenrand: de aansluiting op knoop 7 telt NIET als steun of gaffel voor kip en doorbuiging",
    notities(boven).some((n) => /Op tussenknoop 7 sluit staaf 10 aan\. Die aansluiting is NIET als steun of gaffel/.test(n)));
  ok("onderrand: vakken 3 · 3 · 3 · 3 m tussen de knopen 2, 3 en 4",
    notities(onder).some((n) => /^KNIK PER VAK\. Op knoop 2, 3, 4 /.test(n) && /3,000 · 3,000 · 3,000 · 3,000 m/.test(n)));
  ok("bovenrand: beide einden gaffel (geen staafeinden)", boven?.staafeinden === undefined);
  const n6 = Math.min(...boven.forces_envelope.map((p) => p.forces.n_ed));
  ok("N_Ed bovenrand binnen 0,5 % van de knopenmethode (−121,5 kN)", Math.abs(n6 / N_HAND - 1) < 5e-3, `${n6.toFixed(2)} kN`);
  if (heeftKern) {
    const uit = kern(r.inputs);
    const hand = knik(6000, n6);
    const k = knikToets(uit.find((b) => b.beam_id === 6));
    dicht("kern bovenrand: L_cr,y = 3000 mm (vak)", variabele(k, "L_{cr,y}"), 3000, 1e-9);
    dicht("kern bovenrand: L_cr,z = 6000 mm (de hele lijn; was 3000 als aanname)", variabele(k, "L_{cr,z}"), 6000, 1e-9);
    dicht(`kern bovenrand: N_b,Rd = 143,8 kN om z (hand ${hand.nbRd.toFixed(1)})`, k?.uc?.rd, hand.nbRd, 0.5);
    dicht(`kern bovenrand: UC 6.3.1 = ${hand.uc.toFixed(4)} (hand, om z; was 0,278)`, k?.uc?.uc, hand.uc, 0.0015);
    ok("kern bovenrand: de KNIK PER VAK-notitie staat bij de kniktoets", (k?.notes ?? []).some((n) => /^KNIK PER VAK/.test(n)));
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] Hetzelfde vakwerk met L_cr = 3 m opgegeven: zelfde UC 0,278, geen aanname");
// ─────────────────────────────────────────────────────────────────────────
{
  const r = bouw(project("model-006-vakwerk-lcr-3m.ifcfem"));
  const i = r.inputs.find((x) => x.beam_id === 6);
  ok("staaf 6: opgegeven kniklengte 3 m om beide assen", i?.buckling_length_y_m === 3 && i?.buckling_length_z_m === 3);
  ok("geen KNIK PER VAK-notitie: de opgave gaat voor",
    !notities(i).some((n) => /KNIK PER VAK\./.test(n)) && notities(i).some((n) => /opgegeven kniklengte gaat voor/.test(n)),
    JSON.stringify(notities(i)));
  if (heeftKern) {
    const k = knikToets(kern(r.inputs).find((b) => b.beam_id === 6));
    dicht("kern staaf 6: UC 6.3.1 = 0,278", k?.uc?.uc, 0.278, 0.0015);
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] Scharnier, veer of plaat op de tussenknoop (zonder andere staaf)");
// ─────────────────────────────────────────────────────────────────────────
const ligger = (releases, extra = {}) => ({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 3, x: 3000, z: 0 }, { id: 2, x: 6000, z: 0 }],
  beams: [
    { id: 1, from: 1, to: 3, material: "S235", profile: "IPE300", ...(releases ? { releases } : {}) },
    { id: 2, from: 3, to: 2, material: "S235", profile: "IPE300" },
  ],
  supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 2, type: "zRoller" }],
  loads: [{ id: 1, type: "lineLoad", caseId: 1, beamId: 2, q: -5 }, { id: 2, type: "lineLoad", caseId: 1, beamId: 1, q: -5 }],
  ...extra,
});
const houten = (m) => ({ ...m, beams: m.beams.map((b) => ({ ...b, material: "C24", profile: "96x450" })) });
{
  const zonder = bouw(ligger(null));
  ok("zonder scharnier: één lijn van 6 m (basisaudit nr 29)",
    zonder.inputs.length === 1 && zonder.inputs[0].length_m === 6, JSON.stringify(zonder.inputs.map((i) => [i.beam_id, i.length_m])));
  ok("zonder scharnier: de samenvoeging staat in de notities en bij het overgeslagen deel",
    notities(zonder.inputs[0]).some((n) => /^DOORGAANDE LIJN/.test(n) && /De kniklengte zonder opgave is de hele lijn/.test(n))
    && zonder.skipped.some((s) => s.beamId === 2 && /doorgaande lijn/.test(s.reason)));
  ok("zonder scharnier: geen kniklengte per vak (geen aansluiting)",
    zonder.inputs[0].buckling_length_y_m === 0 && zonder.inputs[0].buckling_length_z_m === 0);
  for (const [naam, model] of [
    ["scharnier", ligger({ endRy: true })],
    ["veer", { ...ligger(null), beams: ligger(null).beams.map((b) => b.id === 2 ? { ...b, veren: { startRy: 5000 } } : b) }],
  ]) {
    const r = bouw(model);
    const i = r.inputs[0];
    ok(`${naam} op knoop 3: één lijn van 6 m (de knoop steunt niets), geen staafeinden`,
      r.inputs.length === 1 && i.length_m === 6 && i.staafeinden === undefined,
      JSON.stringify(r.inputs.map((x) => [x.beam_id, x.length_m, x.staafeinden])));
    ok(`${naam} op knoop 3: de notitie noemt het, met de kanttekening over de kniklengte in het vlak`,
      notities(i).some((n) => /^Op tussenknoop 3 zit staaf \d: /.test(n) && /GROTER zijn dan de lijnlengte/.test(n)
        && (naam === "scharnier" ? /scharnier/.test(n) : /veer op de draaiing \(5000 kNm\/rad\)/.test(n))),
      JSON.stringify(notities(i)));
    const h = bouw(houten(model), "hout");
    ok(`hout met ${naam} op knoop 3: één lijn van 6 m met dezelfde notitie`,
      h.inputs.length === 1 && h.inputs[0].length_m === 6 && notities(h.inputs[0]).some((n) => /^Op tussenknoop 3 zit/.test(n)));
  }
  // Een plaat op de tussenknoop houdt hem vast zoals een oplegging: twee staven.
  const plaat = ligger(null, { plates: [{ nodeIds: [1, 3, 4, 5] }] });
  plaat.nodes = [...plaat.nodes, { id: 4, x: 3000, z: 2000 }, { id: 5, x: 0, z: 2000 }];
  const met = bouw(plaat);
  ok("plaat op knoop 3: twee staven van 3 m, geen doorgaande lijn",
    met.inputs.length === 2 && met.inputs.every((i) => i.length_m === 3)
    && !met.inputs.some((i) => notities(i).some((n) => /DOORGAANDE LIJN/.test(n))) && met.skipped.length === 0,
    JSON.stringify(met.inputs.map((i) => [i.beam_id, i.length_m])));
  const metHout = bouw(houten(plaat), "hout");
  ok("hout, plaat op knoop 3: twee staven van 3 m, geen doorgaande lijn",
    metHout.inputs.length === 2 && metHout.inputs.every((i) => i.length_m === 3)
    && !metHout.inputs.some((i) => notities(i).some((n) => /DOORGAANDE LIJN/.test(n))));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] Hout in het vakwerk: zelfde regel");
// ─────────────────────────────────────────────────────────────────────────
{
  const hout = {
    ...vakwerk,
    beams: vakwerk.beams.map((b) => ({ ...b, material: "C24", profile: b.profile === "SHS100x100x5" ? "120x120" : "90x90" })),
  };
  const r = bouw(hout, "hout");
  const boven = r.inputs.find((i) => i.beam_id === 6);
  ok("hout: bovenrand één lijn van 6 m met L_cr,y = 3 m en L_cr,z niet gezet (#201)", boven?.length_m === 6
    && boven.buckling_length_y_m === 3 && boven.buckling_length_z_m === 0,
    boven ? `L ${boven.length_m}, L_cr ${boven.buckling_length_y_m}/${boven.buckling_length_z_m}` : "ontbreekt");
  ok("hout: de KNIK PER VAK-notitie, om z de hele lijn",
    notities(boven).some((n) => /^KNIK PER VAK/.test(n) && /GEEN vakgrens/.test(n) && /L_cr,z = 6,000 m, de hele lijn/.test(n)));
  ok("hout: staaf 7 overgeslagen", r.skipped.some((s) => s.beamId === 7 && /doorgaande lijn/.test(s.reason)));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[5] Kolom HEA160 6 m, N_Ed = 300 kN, met een ligger op 3 m (review K6, geval 1a)");
// ─────────────────────────────────────────────────────────────────────────
const P = 300 / 1.35;
// HEA160 S235 (profieltabel): A = 3880 mm², I_y = 16,73·10⁶, I_z = 6,156·10⁶
// mm⁴. Om z, L_cr = 6000 mm: λ̄_z = 1,604, χ_z = 0,283, N_b,Rd = 258,2 kN,
// UC = 1,162; L_cr = 3000 mm: λ̄_z = 0,802, χ_z = 0,661, N_b,Rd = 602,6 kN,
// UC = 0,498. Om y (kromme b) met 3000 mm niet maatgevend (χ_y = 0,89).
const HEA160 = { A: 3880, Iy: 16.73e6, Iz: 6.156e6 };
const kolomMetLigger = (cfg) => ({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 3, x: 0, z: 3000 }, { id: 2, x: 0, z: 6000 }, { id: 4, x: 3000, z: 3000 }],
  beams: [
    { id: 1, from: 1, to: 3, profile: "HEA160", material: "S235", ...(cfg ? { checkConfig: cfg } : {}) },
    { id: 2, from: 3, to: 2, profile: "HEA160", material: "S235", ...(cfg ? { checkConfig: cfg } : {}) },
    { id: 3, from: 3, to: 4, profile: "IPE200", material: "S235", releases: { startRy: true } },
  ],
  supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "xRoller" }, { nodeId: 4, type: "pinned" }],
  loads: [{ id: 1, type: "pointForce", nodeId: 2, caseId: 1, fz: -P }],
});
{
  const r = bouw(kolomMetLigger(null));
  const i = r.inputs.find((x) => x.beam_id === 1);
  ok("één lijn van 6 m; in het vlak per vak 3 m, om z niet gezet (#201)", i?.length_m === 6
    && i.buckling_length_y_m === 3 && i.buckling_length_z_m === 0, `${i?.buckling_length_y_m}/${i?.buckling_length_z_m}`);
  ok("de notitie: knoop 3 is om z GEEN vakgrens, L_cr,z = de hele lijn van 6 m, met de vraag om een opgave",
    notities(i).some((n) => /^KNIK PER VAK\. Op knoop 3 /.test(n) && /knoop 3 GEEN vakgrens/.test(n)
      && /L_cr,z = 6,000 m, de hele lijn/.test(n) && /geef L_cr,z op/.test(n)),
    JSON.stringify(notities(i)));
  ok("de knoopnotitie zegt: vakgrens in het vlak, loodrecht op het vlak niet",
    notities(i).some((n) => /^Op tussenknoop 3 sluit staaf 3 aan\./.test(n) && /in het vlak is de knoop een vakgrens; loodrecht op het vlak niet/.test(n)));
  const metZ = bouw(kolomMetLigger({ bucklingLengthZ_m: 3 }));
  const iz = metZ.inputs.find((x) => x.beam_id === 1);
  ok("met L_cr,z = 3 m opgegeven: om y het vak (3 m), om z de opgave", iz?.buckling_length_y_m === 3 && iz.buckling_length_z_m === 3);
  ok("met L_cr,z opgegeven: de notitie zegt dat de opgave om z voorgaat",
    notities(iz).some((n) => /^KNIK PER VAK/.test(n) && /gaat de opgegeven L_cr,z voor/.test(n)));
  dicht("hand: HEA160 om z, L_cr = 6000 mm: UC = 300/258,2 = 1,162", knikS235(6000, -300, HEA160).uc, 1.162, 1e-3);
  if (heeftKern) {
    const uit = kern(r.inputs).find((b) => b.beam_id === 1);
    const k = knikToets(uit);
    dicht("kern: L_cr,y = 3000 mm (vak)", variabele(k, "L_{cr,y}"), 3000, 1e-9);
    dicht("kern: L_cr,z = 6000 mm (de hele lijn)", variabele(k, "L_{cr,z}"), 6000, 1e-9);
    dicht("kern: UC 6.3.1 = 1,162 (was per vak 0,498, als aanname om z)", k?.uc?.uc, knikS235(6000, -300, HEA160).uc, 1e-3);
    ok("kern: status NotOk", uit?.status === "NotOk", uit?.status);
    const kz = knikToets(kern(metZ.inputs).find((b) => b.beam_id === 1));
    dicht("kern: met L_cr,z = 3 m opgegeven UC 6.3.1 = 0,498", kz?.uc?.uc, knikS235(3000, -300, HEA160).uc, 1e-3);
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[5b] Kolom HEA160 6 m met een verband op 3 m (#201)");
// ─────────────────────────────────────────────────────────────────────────
// Een pendelstaaf (scharnierend) van knoop 3 naar een oplegging houdt de
// kolom in het vlak vast. Loodrecht op het vlak alleen als het verband als
// zijdelingse steun is opgegeven: een kipsteun aan beide flenzen op knoop 3
// (fractie 1 van staaf 1, op de lijn 0,5). Dan L_cr,z = 3 m (de kern, uit de
// kipsteunen) en UC 0,498; zonder die opgave de hele lijn, 1,162.
const kolomMetVerband = (zijdelings, materiaal = "S235", kolom = "HEA160", verband = "L80x80x8") => ({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 3, x: 0, z: 3000 }, { id: 2, x: 0, z: 6000 }, { id: 4, x: 3000, z: 0 }],
  beams: [
    { id: 1, from: 1, to: 3, profile: kolom, material: materiaal,
      ...(zijdelings ? { checkConfig: { lateralRestraints: [1], lateralRestraintsBottom: [1] } } : {}) },
    { id: 2, from: 3, to: 2, profile: kolom, material: materiaal },
    { id: 3, from: 3, to: 4, profile: verband, material: materiaal, releases: { startRy: true, endRy: true } },
  ],
  supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "xRoller" }, { nodeId: 4, type: "pinned" }],
  loads: [{ id: 1, type: "pointForce", nodeId: 2, caseId: 1, fz: -P }],
});
{
  dicht("hand: HEA160 om z, L_cr = 3000 mm: UC = 300/602,6 = 0,498", knikS235(3000, -300, HEA160).uc, 0.498, 1e-3);
  const zonder = bouw(kolomMetVerband(false));
  const i0 = zonder.inputs.find((x) => x.beam_id === 1);
  ok("verband zonder opgave: één lijn van 6 m, L_cr,y per vak 3 m, L_cr,z niet gezet",
    i0?.length_m === 6 && i0.buckling_length_y_m === 3 && i0.buckling_length_z_m === 0,
    `${i0?.length_m} ${i0?.buckling_length_y_m}/${i0?.buckling_length_z_m}`);
  ok("verband zonder opgave: de notitie geeft om z de hele lijn",
    notities(i0).some((n) => /^KNIK PER VAK/.test(n) && /L_cr,z = 6,000 m, de hele lijn/.test(n)));
  const met = bouw(kolomMetVerband(true));
  const i1 = met.inputs.find((x) => x.beam_id === 1);
  ok("verband als zijdelingse steun: L_cr,z niet gezet (de kern leidt hem af uit de kipsteunen)",
    i1?.buckling_length_y_m === 3 && i1.buckling_length_z_m === 0, `${i1?.buckling_length_y_m}/${i1?.buckling_length_z_m}`);
  ok("verband als zijdelingse steun: de notitie geeft L_cr,z = 3 m uit de kipsteunen",
    notities(i1).some((n) => /^KNIK PER VAK/.test(n) && /L_cr,z = 3,000 m, de grootste afstand tussen de kipsteunen aan beide flenzen/.test(n)
      && /Op knoop 3 staat een kipsteun aan beide flenzen/.test(n) && !/GEEN vakgrens/.test(n)),
    JSON.stringify(notities(i1)));
  const h0 = bouw(kolomMetVerband(false, "C24", "120x120", "75x75"), "hout").inputs.find((x) => x.beam_id === 1);
  const h1 = bouw(kolomMetVerband(true, "C24", "120x120", "75x75"), "hout").inputs.find((x) => x.beam_id === 1);
  ok("hout: dezelfde regel (L_cr,y 3 m, L_cr,z niet gezet; de notitie volgt de opgave)",
    h0?.buckling_length_y_m === 3 && h0.buckling_length_z_m === 0 && h1?.buckling_length_z_m === 0
    && notities(h0).some((n) => /L_cr,z = 6,000 m, de hele lijn/.test(n))
    && notities(h1).some((n) => /L_cr,z = 3,000 m, de grootste afstand/.test(n)),
    `${h0?.buckling_length_y_m}/${h0?.buckling_length_z_m} ${h1?.buckling_length_z_m}`);
  if (heeftKern) {
    const k0 = knikToets(kern(zonder.inputs).find((b) => b.beam_id === 1));
    dicht("kern zonder opgave: L_cr,z = 6000 mm", variabele(k0, "L_{cr,z}"), 6000, 1e-9);
    dicht("kern zonder opgave: UC 6.3.1 = 1,162", k0?.uc?.uc, knikS235(6000, -300, HEA160).uc, 1e-3);
    const k1 = knikToets(kern(met.inputs).find((b) => b.beam_id === 1));
    dicht("kern met zijdelingse steun: L_cr,z = 3000 mm (uit de kipsteunen)", variabele(k1, "L_{cr,z}"), 3000, 1e-9);
    dicht("kern met zijdelingse steun: UC 6.3.1 = 0,498", k1?.uc?.uc, knikS235(3000, -300, HEA160).uc, 1e-3);
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[6] Ligger IPE300 6 m met een paal met VRIJE kop op 3 m (review K6, geval 1b)");
// ─────────────────────────────────────────────────────────────────────────
const liggerMetPaal = (materiaal = "S235", profiel = "IPE300", paal = "HEA160") => ({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 3, x: 3000, z: 0 }, { id: 2, x: 6000, z: 0 }, { id: 4, x: 3000, z: 3000 }],
  beams: [
    { id: 1, from: 1, to: 3, profile: profiel, material: materiaal },
    { id: 2, from: 3, to: 2, profile: profiel, material: materiaal },
    { id: 5, from: 3, to: 4, profile: paal, material: materiaal },
  ],
  supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
  loads: [
    { id: 1, type: "lineLoad", caseId: 1, beamId: 1, q: -10 }, { id: 2, type: "lineLoad", caseId: 1, beamId: 2, q: -10 },
    { id: 9, type: "pointForce", caseId: 1, nodeId: 4, fx: 0, fz: -50 },
  ],
});
{
  const r = bouw(liggerMetPaal());
  const i = r.inputs.find((x) => x.beam_id === 1);
  ok("één lijn van 6 m, geen kniklengte per vak (de paal houdt niets vast), gaffels alleen aan de einden",
    i?.length_m === 6 && i.buckling_length_y_m === 0 && i.buckling_length_z_m === 0 && i.staafeinden === undefined);
  ok("de notitie noemt de paal met het vrije andere eind",
    notities(i).some((n) => /Op tussenknoop 3 sluit staaf 5 aan, maar het andere eind daarvan is vrij/.test(n)));
  ok("w_fin vanaf de koorde over 6 m: 22,4 mm", Math.abs(Math.abs(i?.deflection_actual_max_mm) - 22.43) < 0.05, `${i?.deflection_actual_max_mm}`);
  if (heeftKern) {
    const uit = kern(r.inputs).find((b) => b.beam_id === 1);
    dicht("kern: kip over 6 m, UC 6.3.2 = 2,235", toets(uit, "6.3.2_ltb")?.uc?.uc, 2.235, 2e-3);
    // Vloer: w_fin tegen ℓ_rep/250 (A1.4.3(4), #192), niet meer L/333.
    dicht("kern: w_fin over 6 m (ℓ_rep/250 = 24,0 mm), UC = 22,43/24,0 = 0,935", toets(uit, "deflection_w_fin")?.uc?.uc, 22.43 / 24.0, 2e-3);
    ok("kern: status NotOk", uit?.status === "NotOk");
  }
  const h = bouw(liggerMetPaal("C24", "96x450", "120x120"), "hout");
  const ih = h.inputs.find((x) => x.beam_id === 1);
  ok("hout: één lijn van 6 m zonder kniklengte per vak, met de notitie over de paal",
    ih?.length_m === 6 && ih.buckling_length_y_m === 0 && ih.buckling_length_z_m === 0
    && notities(ih).some((n) => /het andere eind daarvan is vrij/.test(n)));
  if (heeftKern) {
    const uit = kern(h.inputs, "check_timber_beams").find((b) => b.beam_id === 1);
    const notes = (uit?.checks ?? []).flatMap((c) => c.kind?.data?.notes ?? []);
    ok("hout kern: de kiptoets rekent met ℓ = 6000 mm", notes.some((n) => /ℓ = 6000 mm/.test(n)),
      JSON.stringify(notes.filter((n) => /ℓ =/.test(n)).slice(0, 2)));
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[7] Kolom met een veer op 3 m en een Gerberligger (review K6, gevallen 2a en 2b)");
// ─────────────────────────────────────────────────────────────────────────
{
  const kolom = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 3, x: 0, z: 3000 }, { id: 2, x: 0, z: 6000 }],
    beams: [
      { id: 1, from: 1, to: 3, profile: "HEA160", material: "S235" },
      { id: 2, from: 3, to: 2, profile: "HEA160", material: "S235", veren: { startRy: 2000 } },
    ],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "xRoller" }],
    loads: [{ id: 1, type: "pointForce", nodeId: 2, caseId: 1, fz: -P }],
  };
  const r = bouw(kolom);
  ok("kolom met veer: één lijn van 6 m zonder doorlopende staafeinden",
    r.inputs.length === 1 && r.inputs[0].length_m === 6 && r.inputs[0].staafeinden === undefined);
  const gerber = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }, { id: 3, x: 8000, z: 0 }, { id: 4, x: 14000, z: 0 }],
    beams: [
      { id: 1, from: 1, to: 2, profile: "IPE300", material: "S235" },
      { id: 2, from: 2, to: 3, profile: "IPE300", material: "S235" },
      { id: 3, from: 3, to: 4, profile: "IPE300", material: "S235", releases: { startRy: true } },
    ],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }, { nodeId: 4, type: "zRoller" }],
    loads: [1, 2, 3].map((b) => ({ id: b, type: "lineLoad", caseId: 1, beamId: b, q: -8 })),
  };
  const g = bouw(gerber);
  const lijn = g.inputs.find((i) => i.beam_id === 2);
  ok("Gerberligger: staaf 2 als lijn van 8 m (over het scharnier), staaf 3 overgeslagen",
    lijn?.length_m === 8 && g.skipped.some((s) => s.beamId === 3 && /doorgaande lijn.*staaf 2/.test(s.reason)));
  if (heeftKern) {
    const k = kern(r.inputs)[0];
    dicht("kern kolom met veer: UC 6.3.1 = 1,162 (L_cr,z = 6000 mm)", knikToets(k)?.uc?.uc, 1.162, 1e-3);
    ok("kern kolom met veer: status NotOk", k?.status === "NotOk");
    const kg = kern(g.inputs).find((b) => b.beam_id === 2);
    dicht("kern Gerberligger staaf 2: kip over 8 m, UC 6.3.2 = 1,430", toets(kg, "6.3.2_ltb")?.uc?.uc, 1.430, 2e-3);
    ok("kern Gerberligger staaf 2: status NotOk", kg?.status === "NotOk");
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[8] Kolom HEA200 0–3–7 m met een VRIJE top en een pendelligger op 3 m (review samenvoeging 2026.42)");
// ─────────────────────────────────────────────────────────────────────────
// Voet ingeklemd, op 3 m een pendelligger IPE200 naar een vaste oplegging
// (houdt knoop 2 horizontaal vast), top op 7 m vrij met G = 150 kN, dus
// N_Ed = 1,35·150 = 202,5 kN. HEA200 S235: A = 5380 mm², I_y = 36,9·10⁶,
// I_z = 13,4·10⁶ mm⁴; knikkromme b om y, c om z (h/b ≤ 1,2, t_f ≤ 100 mm).
//   L_cr = 2·L = 14 000 mm (vrij eind, regel van de kern): λ̄_z = 2,987,
//   χ_z = 0,0959, N_b,Rd = 121,2 kN, UC = 202,5/121,2 = 1,671.
//   Per vak (4 m) gaf UC 0,255; α_cr in het vlak = 4,15 geeft
//   L_cr,y = π·√(EI_y/(α_cr·N_Ed)) = 9,54 m: ook 2 × het eindvak (8 m) is te kort.
const HEA200 = { A: 5380, Iy: 36.9e6, Iz: 13.4e6 };
function knikS235(lcrMm, nEd, { A: a, Iy, Iz }) {
  const lam1 = Math.PI * Math.sqrt(E / 235);
  const chi = (i, alfa) => {
    const lam = lcrMm / i / lam1;
    const phi = 0.5 * (1 + alfa * (lam - 0.2) + lam * lam);
    return Math.min(1, 1 / (phi + Math.sqrt(phi * phi - lam * lam)));
  };
  const nbRd = Math.min(chi(Math.sqrt(Iy / a), 0.34), chi(Math.sqrt(Iz / a), 0.49)) * a * 235 / 1000;
  return { nbRd, uc: Math.abs(nEd) / nbRd };
}
const kolomVrijeTop = (materiaal = "S235", kolom = "HEA200", ligger = "IPE200") => ({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: 3000 }, { id: 3, x: 0, z: 7000 }, { id: 4, x: 4000, z: 3000 }],
  beams: [
    { id: 1, from: 1, to: 2, profile: kolom, material: materiaal },
    { id: 2, from: 2, to: 3, profile: kolom, material: materiaal },
    { id: 3, from: 2, to: 4, profile: ligger, material: materiaal, releases: { startRy: true, endRy: true } },
  ],
  supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 4, type: "pinned" }],
  loads: [{ id: 1, type: "pointForce", nodeId: 3, caseId: 1, fz: -150 }],
});
{
  dicht("hand: L_cr = 14 000 mm geeft N_b,Rd = 121,2 kN", knikS235(14000, -202.5, HEA200).nbRd, 121.2, 0.1);
  dicht("hand: UC 6.3.1 = 202,5/121,2 = 1,671", knikS235(14000, -202.5, HEA200).uc, 1.671, 1e-3);
  const m = kolomVrijeTop();
  const r = bouw(m);
  const i = r.inputs.find((x) => x.beam_id === 1);
  const einden = [i?.staafeinden?.begin, i?.staafeinden?.eind];
  ok("één lijn van 7 m met één vrij eind (de top)", i?.length_m === 7
    && einden.filter((e) => e === "Vrij").length === 1 && einden.filter((e) => e === "Gaffel").length === 1,
    JSON.stringify(i?.staafeinden));
  ok("geen kniklengte per vak: 0/0, de kern beslist (was 4/4)",
    i?.buckling_length_y_m === 0 && i?.buckling_length_z_m === 0, `${i?.buckling_length_y_m}/${i?.buckling_length_z_m}`);
  ok("de notitie zegt waarom KNIK PER VAK niet is toegepast",
    notities(i).some((n) => /^KNIK PER VAK NIET TOEGEPAST\. Op knoop 2 /.test(n) && /het lijneind op knoop 3 is vrij/.test(n))
    && !notities(i).some((n) => /^KNIK PER VAK\. /.test(n)),
    JSON.stringify(notities(i)));
  ok("de lijnnotitie en de knoopnotitie spreken dat niet tegen",
    notities(i).some((n) => /^DOORGAANDE LIJN/.test(n) && /volgt hier NIET uit de vakken/.test(n))
    && notities(i).some((n) => /^Op tussenknoop 2 sluit staaf 3 aan\./.test(n) && /hier GEEN vakgrens/.test(n)));
  // α_cr in het vlak: de echte kniklengte ligt tussen 2 × het eindvak en 2·L.
  const { bepaalAlphaCr } = await import("./src/components/fem/solver/alphaCr.ts");
  const mi = bouwMultiInput({
    nodes: m.nodes, beams: m.beams, supports: m.supports, loads: m.loads, loadCases: G, plates: [],
    selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
  });
  const { perCase } = solveAllCases(mi);
  const cr = new Map(combos.map((c) => [c.id, combineResults(c, perCase)]));
  const ac = bepaalAlphaCr(mi, combos, cr).find((a) => a.alphaCr !== null);
  const lcrY = ac ? Math.PI * Math.sqrt((E * HEA200.Iy) / (ac.alphaCr * 202.5 * 1000)) : NaN;
  ok("α_cr in het vlak: 8000 mm (2 × eindvak) < L_cr,y,eq < 14 000 mm (2·L)", lcrY > 8000 && lcrY < 14000,
    `α_cr ${ac?.alphaCr?.toFixed(3)}, L_cr,y,eq ${lcrY.toFixed(0)} mm`);
  if (heeftKern) {
    const uit = kern(r.inputs).find((b) => b.beam_id === 1);
    const k = knikToets(uit);
    dicht("kern: L_cr,y = 14 000 mm (2·L, vrij eind)", variabele(k, "L_{cr,y}"), 14000, 1e-9);
    dicht("kern: L_cr,z = 14 000 mm", variabele(k, "L_{cr,z}"), 14000, 1e-9);
    dicht("kern: UC 6.3.1 = 1,671 (was per vak 0,255)", k?.uc?.uc, knikS235(14000, -202.5, HEA200).uc, 2e-3);
    ok("kern: status NotOk", uit?.status === "NotOk", uit?.status);
  }
  // Hout in dezelfde opzet: ook geen kniklengte per vak.
  const h = bouw(kolomVrijeTop("GL24h", "200x200", "100x200"), "hout");
  const ih = h.inputs.find((x) => x.beam_id === 1);
  ok("hout: één lijn van 7 m zonder kniklengte per vak, met de notitie",
    ih?.length_m === 7 && ih.buckling_length_y_m === 0 && ih.buckling_length_z_m === 0
    && notities(ih).some((n) => /^KNIK PER VAK NIET TOEGEPAST/.test(n)),
    ih ? `L ${ih.length_m}, L_cr ${ih.buckling_length_y_m}/${ih.buckling_length_z_m}` : "ontbreekt");
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[9] Lijn HEA200 0–3–6 m die DOORLOOPT in een HEA160 tot 9 m (review samenvoeging 2026.42)");
// ─────────────────────────────────────────────────────────────────────────
// Pendelligger op 3 m, scharnier onder, horizontale steun boven, G = 200 kN op
// de top. Het lijneind op 6 m is DOORLOPEND (basisaudit nr 29): de kern
// weigert de kniktoets zonder opgave van L_cr,y én L_cr,z. KNIK PER VAK zette
// 3/3 m "als opgegeven" en omzeilde zo die weigering (UC 0,280 Ok, terwijl
// α_cr L_cr,y = 6,2 m geeft). Nu: geen per-vak-lengte, 6.3.1 geweigerd, status
// n.v.t. met de reden — en niet door rekenruis in M (M_y ≈ 6,6·10⁻¹⁸ kNm).
{
  const m = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: 3000 }, { id: 3, x: 0, z: 6000 }, { id: 5, x: 0, z: 9000 },
      { id: 4, x: 4000, z: 3000 }],
    beams: [
      { id: 1, from: 1, to: 2, profile: "HEA200", material: "S235" },
      { id: 2, from: 2, to: 3, profile: "HEA200", material: "S235" },
      { id: 4, from: 3, to: 5, profile: "HEA160", material: "S235" },
      { id: 3, from: 2, to: 4, profile: "IPE200", material: "S235", releases: { startRy: true, endRy: true } },
    ],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 5, type: "xRoller" }, { nodeId: 4, type: "pinned" }],
    loads: [{ id: 1, type: "pointForce", nodeId: 5, caseId: 1, fz: -200 }],
  };
  const r = bouw(m);
  const i = r.inputs.find((x) => x.beam_id === 1);
  const einden = [i?.staafeinden?.begin, i?.staafeinden?.eind];
  ok("lijn HEA200 van 6 m met één doorlopend eind", i?.length_m === 6 && einden.includes("Doorlopend"),
    JSON.stringify(i?.staafeinden));
  ok("geen kniklengte per vak: 0/0 (was 3/3)", i?.buckling_length_y_m === 0 && i?.buckling_length_z_m === 0,
    `${i?.buckling_length_y_m}/${i?.buckling_length_z_m}`);
  ok("de notitie noemt het doorlopende eind",
    notities(i).some((n) => /^KNIK PER VAK NIET TOEGEPAST\. Op knoop 2 /.test(n) && /op knoop 3 loopt de lijn zonder oplegging door/.test(n)),
    JSON.stringify(notities(i)));
  if (heeftKern) {
    const uit = kern(r.inputs).find((b) => b.beam_id === 1);
    ok("kern: 6.3.1 geweigerd (n.v.t., geen UC)", knikToets(uit)?.status === "NotApplicable" && knikToets(uit)?.uc?.uc == null,
      JSON.stringify(knikToets(uit)?.uc ?? null));
    ok("kern: status n.v.t., niet Ok", uit?.status === "NotApplicable", uit?.status);
    ok("kern: de reden is de geweigerde kolomknik, niet rekenruis in M",
      /^NIET VOLLEDIG GETOETST: de kolomknik \(6\.3\.1\) bij druk niet getoetst/.test(uit?.governing_check_id ?? "")
      && !/kip/.test(uit?.governing_check_id ?? ""),
      uit?.governing_check_id);
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[10] MCP: check_fem_model met de aanroepen van de controle en de gevallen van de review");
// ─────────────────────────────────────────────────────────────────────────
function mcp(aanroepen) {
  return new Promise((klaar, mis) => {
    const k = spawn(MCP_SERVER, [], { stdio: ["pipe", "pipe", "pipe"] });
    const klok = setTimeout(() => { k.kill(); mis(new Error("MCP-server reageerde niet binnen 180 s")); }, 180_000);
    let buf = "";
    const antwoorden = new Map();
    k.on("error", (e) => { clearTimeout(klok); mis(e); });
    k.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const regel = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!regel) continue;
        const bericht = JSON.parse(regel);
        antwoorden.set(bericht.id, bericht);
        if (antwoorden.size === aanroepen.length + 1) {
          clearTimeout(klok);
          k.stdin.end();
          klaar(aanroepen.map((_, n) => antwoorden.get(n + 2)));
        }
      }
    });
    const schrijf = (o) => k.stdin.write(JSON.stringify(o) + "\n");
    schrijf({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-vakwerk-kniklengte", version: "1" } } });
    aanroepen.forEach((a, n) => schrijf({ jsonrpc: "2.0", id: n + 2, method: "tools/call", params: { name: a.tool, arguments: a.arguments } }));
  });
}
if (!existsSync(MCP_SERVER)) {
  ok("MCP-server gevonden — bouw hem met `cargo build --release -p openaec-mcp-server` (na `npm run build:sidecar`)", false, MCP_SERVER);
} else {
  const model = (m) => ({ ...m, loadCases: [{ id: 1, name: "Permanent", type: "dead" }], selfWeightEnabled: false });
  const tool = "check_fem_model";
  const houtKolom = (nD) => ({
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 3, x: 0, z: 3000 }, { id: 2, x: 0, z: 6000 }],
    beams: [
      { id: 1, from: 1, to: 3, profile: "120x120", material: "C24" },
      { id: 2, from: 3, to: 2, profile: "120x120", material: "C24", veren: { startRy: 2000 } },
    ],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "xRoller" }],
    loads: [{ id: 1, type: "pointForce", nodeId: 2, caseId: 1, fz: -nD / 1.35 }],
  });
  const aanroepen = [
    ...["invoer-006-a.json", "invoer-006-b.json"].map((n) => JSON.parse(readFileSync(join(DATA, n), "utf8"))),
    { tool, arguments: { model: model(kolomMetLigger(null)), beam_ids: [1, 2] } },
    { tool, arguments: { model: model(liggerMetPaal()), beam_ids: [1, 2] } },
    { tool, arguments: { model: model(houtKolom(20)) } },
    { tool, arguments: { model: model(kolomVrijeTop()), beam_ids: [1, 2] } },
  ];
  const [a, b, kolom, paal, hout, vrijeTop] = await mcp(aanroepen);
  const inhoud = (x) => x?.result?.structuredContent ?? JSON.parse(x?.result?.content?.[0]?.text ?? "null");
  for (const [naam, antwoord, lcrZ] of [["006-a (zonder opgave)", a, 6000], ["006-b (L_cr 3 m opgegeven)", b, 3000]]) {
    const d = inhoud(antwoord);
    ok(`MCP ${naam}: slaagt`, d && !antwoord?.result?.isError, JSON.stringify(antwoord?.error ?? "").slice(0, 200));
    if (!d) continue;
    ok(`MCP ${naam}: staaf 7 overgeslagen als deel van de lijn 6`,
      (d.skipped_beams ?? []).some((s) => s.beam_id === 7 && /doorgaande lijn/.test(s.reason)), JSON.stringify(d.skipped_beams));
    const k = knikToets(d.results.find((r) => r.beam_id === 6) ?? { checks: [] });
    dicht(`MCP ${naam}: bovenrand L_cr,y = 3000 mm`, variabele(k, "L_{cr,y}"), 3000, 1e-9);
    dicht(`MCP ${naam}: bovenrand L_cr,z = ${lcrZ} mm`, variabele(k, "L_{cr,z}"), lcrZ, 1e-9);
    // Issue #199: de toets rekent P-Δ met scheefstand φ = 1/200. H = φ·V op de
    // drie bovenrandknopen is samen 1,35·90/200 = 0,6075 kN, dus |ΔN| in de
    // bovenrand ≤ 0,61 kN: |ΔUC| ≤ 0,61/434,8 = 0,0014 bij L_cr,z = 3000 mm
    // (gemeten 0,2788 tegen 0,2784 in eerste orde) en ≤ 0,61/143,8 = 0,0042
    // bij L_cr,z = 6000 mm (issue #201: om z de hele lijn). Hand met de N van
    // de knopenmethode 0,8452; het raamwerk geeft 0,3 % minder N (−0,0025) en
    // P-Δ hooguit +0,0042. Gemeten 0,8434.
    if (lcrZ === 3000) dicht(`MCP ${naam}: bovenrand UC 6.3.1 = 0,278`, k?.uc?.uc, 0.278, 0.0015);
    else dicht(`MCP ${naam}: bovenrand UC 6.3.1 = 0,842 (om z de hele lijn, #201; was 0,278)`, k?.uc?.uc, knik(6000, N_HAND).uc, 0.0045);
  }
  const dk = inhoud(kolom);
  const rk = dk?.results?.find((r) => r.beam_id === 1);
  // Issue #201: om z de hele lijn (was per vak 0,498, als aanname). De kop
  // hangt aan een rol: H = φ·V gaat rechtstreeks naar de oplegging en buigt
  // de kolom niet; de UC blijft die van de eerste orde, 1,162.
  dicht("MCP kolom met ligger: UC 6.3.1 = 1,162 (om z de hele lijn, #201)", knikToets(rk)?.uc?.uc, knikS235(6000, -300, HEA160).uc, 1e-3);
  ok("MCP kolom met ligger: de notitie om z staat bij de kniktoets",
    (knikToets(rk)?.notes ?? []).some((n) => /^KNIK PER VAK/.test(n) && /GEEN vakgrens/.test(n)));
  const dp = inhoud(paal);
  const rp = dp?.results?.find((r) => r.beam_id === 1);
  // Issue #199: de toets rekent altijd P-Δ met scheefstand φ = 1/200. De
  // paallast 1,35·50 = 67,5 kN krijgt H = 0,3375 kN op de vrije paalkop
  // (h = 3 m): M_I = 1,0125 kNm, vergroot met 1/(1 − 67,5/963,2) = 1,0754
  // (N_cr van de ingeklemd-vrije HEA 160, I_y = 16,73·10⁶ mm⁴, L_cr = 6 m) tot
  // 1,089 kNm. Dat moment grijpt midden op de ligger aan en tilt het
  // veldmoment aan één kant op met 1,089/2 = 0,544 kNm: 162,0 → 162,544 kNm
  // (+0,34 %), dus kip 2,235 · 162,544/162,0 = 2,2425 (de bouwerroute hierboven,
  // eerste orde, houdt 2,2354). Gemeten 2,2431; de tolerantie 2e-3 blijft.
  dicht("MCP ligger met paal: kip UC 2,2425 (P-Δ met scheefstand; eerste orde 2,235)",
    toets(rp, "6.3.2_ltb")?.uc?.uc, 2.235 * 162.544 / 162.0, 2e-3);
  dicht("MCP ligger met paal: w_fin UC 22,43/24,0 = 0,935 (ℓ_rep/250, #192)", toets(rp, "deflection_w_fin")?.uc?.uc, 22.43 / 24.0, 2e-3);
  ok("MCP ligger met paal: status NotOk", rp?.status === "NotOk");
  const dh = inhoud(hout);
  const rh = dh?.timber_results?.find((r) => r.beam_id === 1);
  ok("MCP hout met veer (P-Δ): één lijn, staaf 2 overgeslagen",
    (dh?.skipped_beams ?? []).some((s) => s.beam_id === 2 && /doorgaande lijn/.test(s.reason)));
  // De aanroep stuurde tot issue #199 `nonlinear: true` mee (P-Δ zonder
  // scheefstand); dat argument bestaat niet meer, de toets rekent altijd P-Δ
  // met φ = 1/200. De kop hangt aan een rol, dus H = φ·V gaat rechtstreeks
  // naar de oplegging en buigt de kolom niet: de UC blijft 1,321 (gemeten 1,3209).
  dicht("MCP hout met veer (P-Δ, N_d = 20 kN): UC 1,321 (L_cr = 6000 mm)", rh?.uc_max, 1.321, 2e-3);
  ok("MCP hout met veer: status NotOk", rh?.status === "NotOk");
  const rv = inhoud(vrijeTop)?.results?.find((r) => r.beam_id === 1);
  // Issue #199: L_cr,y = 7000 mm waar het 14 000 mm (2·L) was. De toets rekent
  // altijd P-Δ met scheefstand φ = 1/200, en die is minstens de eigen φ van
  // deze vrijstaande lijn (EN 1993-1-1 (5.5), h = 7 m, m = 1: α_h = 2/√7 =
  // 0,756, φ_eigen = 1/265), dus de systeemlengte L van de hele lijn
  // (5.2.2(7)b) — nog steeds niet per vak (dat was 4000 mm). De UC verandert
  // niet: knik om z met 2·L = 14 m blijft maatgevend (1,671, hieronder).
  dicht("MCP kolom met vrije top: L_cr,y = 7 000 mm (L met P-Δ en scheefstand, geen kniklengte per vak)",
    variabele(knikToets(rv), "L_{cr,y}"), 7000, 1e-9);
  dicht("MCP kolom met vrije top: UC 6.3.1 = 1,671", knikToets(rv)?.uc?.uc, knikS235(14000, -202.5, HEA200).uc, 2e-3);
  ok("MCP kolom met vrije top: status NotOk", rv?.status === "NotOk", rv?.status);
}

log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);

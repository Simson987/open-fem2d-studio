// De UGT-toets in de 2D-app (issue #199, taak A2): de route van App.tsx naar
// de rekenkern, UITGEVOERD. `handleRunMemberChecks` wordt in de AST opgezocht en
// gedraaid (scripts/bron-uitvoeren.mjs) met de echte lib-functies; de
// checkStore en de bouwers draaien echt, met de toetsbrug als kern. Bewaakt:
//   1. een eerste-ordemodel zonder scheefstand: de UGT-toets rekent tweede orde
//      (P-Δ) met scheefstand φ = 1/200 in +x en −x; de BGT-toets (h/300) leest
//      de resultaten; de toetsset zegt uit welke resultaten hij komt;
//   2. de UGT-invoer van de staalkern is bit-gelijk aan die van een
//      resultaatrekengang P-Δ met de scheefstand aan (de route van vóór #199
//      met die instellingen), de BGT-invoer bit-gelijk aan die op de
//      resultaten; de vrije kop krijgt L (5.2.2(7)b);
//   3. de kern toetst de buiging met het tweede-ordemoment van de toets;
//   4. hergebruik: zijn de resultaten al P-Δ met de scheefstand aan en dezelfde
//      φ, dan is de toetsset die resultaten (dezelfde objecten);
//   5. een divergerende toets (α_cr < 1): de toetsing is geweigerd met de reden
//      per combinatie en α_cr, er is geen uitslag, en de resultaten blijven;
//   6. de export ziet aan `resultaten` of de toetsing bij het scherm hoort: de
//      toetsset is een andere Map dan de resultaten;
//   7. de namen van de toetscombinaties voor het rapport (geen "comb. 1000007"),
//      met per combinatie of haar krachten tweede orde met scheefstand zijn;
//   8. de toetsanalyse van de ronde in de store (voor paneel en rapport), ook
//      bij een weigering; de weigering als FOUT in Inzichten, en weg zodra de
//      toets weer krachten heeft (taak 7, B7 en B14).
//
// Uitvoeren: npx tsx test-toets-app-route.mjs   (vanuit design-mockup/)
// Vereist de toetsbrug: cargo build --release -p toetsbrug  (vanuit src-tauri)

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { declaratie, leesBron, voerUitIn } from "./scripts/bron-uitvoeren.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const TOETSBRUG = join(
  resolve(HIER, ".."), "src-tauri", "target", "release",
  process.platform === "win32" ? "toetsbrug.exe" : "toetsbrug",
);

const { defaultCombinations, combineResults, metScheefstandRichtingen, SCHEEFSTAND_COMBO_OFFSET } =
  await import("./src/components/fem/solver/combinations.ts");
const { solveAllCases, solveAllCasesNonlinear } = await import("./src/components/fem/solver/engine.ts");
const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");
const { bepaalScheefstand, leidScheefstandGeometrieAf, toepasselijkeScheefstandNormen } =
  await import("./src/lib/scheefstandNorm.ts");
const { DEFAULT_LOAD_CASES } = await import("./src/hooks/useFemStore.ts");
const { useCheckStore, getProfileDb } = await import("./src/stores/checkStore.ts");
const { buildSteelCheckInputs } = await import("./src/lib/steelCheckBuilder.ts");
const { rekenVoorwaardenNu } = await import("./src/bediening/rapportExport.ts");
const { toetsCombinatieNamen } = await import("./src/components/report/checkReportUtils.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function check(naam, voorwaarde, detail = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}`); }
  else            { failed++; log(`  ✗ ${naam}${detail ? ` — ${detail}` : ""}`); }
}
const binnen = (a, b, rel) => Math.abs(a - b) <= Math.abs(b) * rel;

if (!existsSync(TOETSBRUG)) {
  failed++;
  log(`  ✗ toetsbrug ontbreekt (${TOETSBRUG}). Bouw eerst: cargo build --release -p toetsbrug`);
  log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(1);
}
// De dev-brug (`/api/toetsing`) nagebootst met de echte toetsbrug.
globalThis.fetch = async (_url, init) => {
  const r = spawnSync(TOETSBRUG, [], { input: init.body, maxBuffer: 1 << 28 });
  return { ok: r.status === 0, status: r.status === 0 ? 200 : 400, text: async () => r.stdout.toString() };
};

// ── Het model: een ingeklemde HEA 200-kolom met een vrije kop ───────────────
//
// h = 4000 mm, S235. G op de kop (verticaal), W op de kop (horizontaal 5 kN).
// Drie combinaties uit de standaardset: 6.10a (1,35·G), 6.10b wind leidend
// (1,2·G + 1,5·W) en de karakteristieke BGT met wind leidend (G + W).
//
// HANDBEREKENING bij G = 200 kN, combinatie 6.10b (+x):
//   N_Ed = 1,2 · 200 = 240 kN;  H = 1,5 · 5 + φ·N_Ed = 7,5 + 240/200 = 8,7 kN
//   M_I  = 8,7 · 4 = 34,8 kNm (eerste orde met scheefstand)
//   HEA 200: I_y = 36,92·10⁶ mm⁴ → N_cr = π²·E·I/(2h)² = 1 195,6 kN
//   M_II ligt tussen M_I en M_I/(1 − N/N_cr) = 34,8/(1 − 0,2007) = 43,5 kNm.
// De resultaten (eerste orde, geen scheefstand) geven 7,5 · 4 = 30 kNm.
const H_MM = 4000;
const model = (gKn, scheefstandEnabled = false) => ({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: H_MM }],
  beams: [{ id: 1, from: 1, to: 2, material: "S235", profile: "HEA200" }],
  supports: [{ id: 1, nodeId: 1, type: "fixed" }],
  plates: [],
  loadCases: DEFAULT_LOAD_CASES,
  loads: [
    { id: 1, type: "pointForce", caseId: 1, nodeId: 2, fz: -gKn },
    { id: 2, type: "pointForce", caseId: 4, nodeId: 2, fx: 5 },
  ],
  selfWeightEnabled: false,
  scheefstandEnabled, scheefstandNoemer: 200, scheefstandRichting: 1,
});
const COMBOS = defaultCombinations().filter((c) => [2, 7, 17].includes(c.id));
const WIND = 7, WIND_TEGEN = 7 + SCHEEFSTAND_COMBO_OFFSET;

const app = leesBron("src/App.tsx");

/**
 * De toetsing zoals App.tsx haar draait na een rekengang `analysetype` met de
 * schakelaar Scheefstand `aan`: `handleRunMemberChecks` met de uitkomst van die
 * rekengang, de echte checkStore en de toetsbrug.
 */
async function toetsViaApp(m, { analysetype = "eersteOrde" } = {}) {
  const aan = m.scheefstandEnabled;
  const basis = bouwMultiInput(m);
  const { perCase } = analysetype === "eersteOrde" ? solveAllCases(basis) : solveAllCasesNonlinear(basis);
  const actieveCombinaties = metScheefstandRichtingen(COMBOS, aan, 1);
  const resultaten = new Map(actieveCombinaties.map((c) => [c.id, combineResults(c, perCase)]));
  const meldingen = [];
  // Wat `setStabiliteitsMelding` kreeg: de FOUT in Inzichten → Fouten.
  const stabiliteitsMeldingen = [];
  const fem = {
    nodes: m.nodes, beams: m.beams, supports: m.supports, plates: [],
    actieveCombinaties, gevolgklasse: "CC2", nationaleBijlage: "NL", loadCases: m.loadCases,
    analysetype, scheefstandEnabled: aan, scheefstandRichting: 1,
    betonKruipcoefficient: null, betonKruipInvoer: null, combinationResults: null, multiLcResult: null,
  };
  useCheckStore.getState().clear();
  const handle = await voerUitIn(app, declaratie(app, "handleRunMemberChecks"), {
    fem, rekenGeneratieRef: { current: 0 }, rekenFoutRef: { current: null }, laatsteMultiInputRef: { current: null },
    gemeldeWeigeringRef: { current: null },
    dynamischeImport: async () => ({ notifyInfo() {}, notifyWarning: (titel, tekst) => meldingen.push({ titel, tekst }) }),
    setActiveView() {},
    setStabiliteitsMelding: (t) => stabiliteitsMeldingen.push(t),
    // De vertaling is hier geen onderwerp: de sleutel zelf.
    i18next: { t: (k) => k },
    checkRun: (d) => useCheckStore.getState().run(d),
    checkWeiger: (reden, toets) => useCheckStore.getState().weiger(reden, toets),
    computeAndStoreSolverOutputs: () => { throw new Error("de rekengang is meegegeven"); },
    rekenToetsFysisch: async () => { throw new Error("geen fysisch niet-lineaire ronde bij P-Δ"); },
    scheefstandUitkomst: bepaalScheefstand(
      { bron: "vast", noemer: 200, hoogteM: null, aantalElementen: null },
      leidScheefstandGeometrieAf(m), toepasselijkeScheefstandNormen(m.beams),
    ),
  });
  await handle({ openPanel: false, outputs: { combinationResults: resultaten, perCase, multiInput: basis } });
  return { resultaten, perCase, basis, meldingen, stabiliteitsMeldingen, actieveCombinaties, store: useCheckStore.getState() };
}
/** Het voetmoment |M| in kNm van een combinatieresultaat (reactie aan knoop 1). */
const mVoet = (r) => Math.abs(r.reactions.get(1).my) / 1e6;

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] Eerste-ordemodel zonder scheefstand: de UGT-toets rekent P-Δ met φ = 1/200");
const eo = await toetsViaApp(model(200));
const d = eo.store.lastRunData;
{
  check("de toetsing liep zonder fout", eo.store.error === null && eo.store.results.length === 1, String(eo.store.error));
  check("de toetsset: elke UGT-combinatie in +x en −x, de BGT zoals de resultaten",
    d?.combinations.map((c) => c.id).join(",") === `2,${2 + SCHEEFSTAND_COMBO_OFFSET},${WIND},${WIND_TEGEN},17`,
    d?.combinations.map((c) => c.id).join(","));
  check("de BGT-krachten zijn de resultaten zelf (B6)", d.combinationResults.get(17) === eo.resultaten.get(17));
  check("de toetsset zegt uit welke resultaten hij komt", d.resultaten === eo.resultaten);
  check("de stabiliteit is die van de toets: tweede orde, scheefstand aan, φ = 1/200",
    d.stabiliteit.analysetype === "tweedeOrdeGeometrisch" && d.stabiliteit.scheefstandAan === true
      && d.stabiliteit.scheefstandPhi === 1 / 200, JSON.stringify({ ...d.stabiliteit, alphaCr: d.stabiliteit.alphaCr.length }));
  check("α_cr één keer per basiscombinatie, bepaald", d.stabiliteit.alphaCr.length === 2
    && d.stabiliteit.alphaCr.every((u) => u.status === "bepaald"), JSON.stringify(d.stabiliteit.alphaCr));
  check("de toetsanalyse staat bij de toetsing: niet hergebruikt, de schakelaar van het model uit",
    d.toets?.analyse.hergebruikt === false && d.toets?.analyse.scheefstandModelAan === false && d.toets?.analyse.noemer === 200);

  const E = 210000, I = 36.92e6;
  const nCr = (Math.PI ** 2 * E * I) / (2 * H_MM) ** 2 / 1000;
  const mI = (1.5 * 5 + (1.2 * 200) / 200) * H_MM / 1000;
  const mGrens = mI / (1 - (1.2 * 200) / nCr);
  const m = mVoet(d.combinationResults.get(WIND));
  log(`    N_cr = ${nCr.toFixed(1)} kN; M_voet 6.10b +x: toets ${m.toFixed(3)} kNm, M_I ${mI.toFixed(3)}, M_I/(1 − N/N_cr) ${mGrens.toFixed(3)}, resultaten ${mVoet(eo.resultaten.get(WIND)).toFixed(3)}`);
  check("handberekening: N_cr = 1 195,6 kN", binnen(nCr, 1195.6, 1e-3), nCr.toFixed(2));
  check("de resultaten (eerste orde, geen scheefstand) geven 7,5 · 4 = 30 kNm", binnen(mVoet(eo.resultaten.get(WIND)), 30, 1e-9));
  check("de toets: M_I = 34,8 kNm < M_voet ≤ M_I/(1 − N/N_cr) = 43,5 kNm (P-Δ met scheefstand)",
    m > mI * 1.05 && m <= mGrens * (1 + 1e-6), `${m}`);
  check("−x: de scheefstand tegen de wind in, dus een kleiner moment dan +x",
    mVoet(d.combinationResults.get(WIND_TEGEN)) < m);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] De invoer van de staalkern: UGT als P-Δ met scheefstand, BGT als de resultaten");
const profileDb = await getProfileDb();
const s = eo.store.lastRunInputs?.steel?.[0];
{
  const m = model(200);
  const bouw = (combinations, combinationResults, stabiliteit) => buildSteelCheckInputs({
    nodes: m.nodes, beams: m.beams, alleBeams: m.beams, supports: m.supports, plates: [],
    combinations, combinationResults, gevolgklasse: "CC2", nationaleBijlage: "NL", loadCases: m.loadCases,
    gevallenMetLast: [...eo.perCase.keys()], stabiliteit, profileDb,
  }).inputs[0];
  // De route van vóór #199 met Analyse P-Δ en de scheefstand aan: dezelfde UGT.
  const mRef = model(200, true);
  const pRef = solveAllCasesNonlinear(bouwMultiInput(mRef)).perCase;
  const cRef = metScheefstandRichtingen(COMBOS, true, 1);
  const ref = bouw(cRef, new Map(cRef.map((c) => [c.id, combineResults(c, pRef)])),
    { analysetype: "tweedeOrdeGeometrisch", alphaCr: [], scheefstandAan: true, scheefstandPhi: 1 / 200 });
  check("forces_envelope (UGT) bit-gelijk aan een resultaatrekengang P-Δ met de scheefstand aan",
    s && JSON.stringify(s.forces_envelope) === JSON.stringify(ref.forces_envelope));
  check("… met de toetsvariant −x erin", s.forces_envelope.some((p) => p.combination_id === WIND_TEGEN));
  check("vrije kop, φ_toets = 1/200 ≥ de eigen φ van een kolom van 4 m: L om y (5.2.2(7)b)",
    JSON.stringify(s.zijdelingse_knik_in_analyse) === JSON.stringify({ y: true, z: false }),
    JSON.stringify(s.zijdelingse_knik_in_analyse));
  // De BGT op de resultaten, zoals vóór #199 bij de beginstand (eerste orde,
  // geen scheefstand). h/300 van de kolom: de kopverplaatsing onder G + W.
  const opResultaten = bouw(COMBOS, eo.resultaten,
    { analysetype: "eersteOrde", alphaCr: [], scheefstandAan: false });
  const bgt = (i) => JSON.stringify(Object.fromEntries(Object.entries(i).filter(([k]) => k.startsWith("deflection_") || k === "is_cantilever")));
  check("de BGT-invoer (doorbuiging, h/300) bit-gelijk aan die op de resultaten", bgt(s) === bgt(opResultaten), bgt(s));
  check("… en dus zonder scheefstand: anders dan op de resultaten met scheefstand",
    bgt(s) !== bgt(bouw(cRef, new Map(cRef.map((c) => [c.id, combineResults(c, solveAllCases(bouwMultiInput(mRef)).perCase)])),
      { analysetype: "eersteOrde", alphaCr: [], scheefstandAan: true, scheefstandPhi: 1 / 200 })));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] De kern toetst de buiging met het tweede-ordemoment van de toets");
{
  const r = eo.store.results[0];
  const buiging = r?.checks.find((c) => c.id === "6.2.5_bending_y")?.kind.data;
  const comb = buiging?.force_state.combination_id;
  // Het grootste moment in de staaf van die combinatie, uit de stations
  // waaruit de bouwer `forces_envelope` maakt (aan de voet).
  const el = (d.combinationResults.get(comb) ?? d.combinationResults.get(WIND)).elements.get(1);
  const mToets = Math.max(...el.bendingMoment.map((v) => Math.abs(v))) / 1e6;
  check("de maatgevende buiging hoort bij een UGT-toetscombinatie (6.10b, +x)", comb === WIND, String(comb));
  check("M_Ed van de kern = het grootste moment van die toetscombinatie in de staaf",
    buiging && binnen(Math.abs(buiging.force_state.forces.my_ed), mToets, 1e-6),
    `${buiging?.force_state.forces.my_ed} vs ${mToets}`);
  check("… en niet dat van de resultaten (30 kNm)", buiging && Math.abs(Math.abs(buiging.force_state.forces.my_ed) - 30) > 1);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] Hergebruik: de resultaten zijn al P-Δ met de scheefstand aan en φ = 1/200");
{
  const pd = await toetsViaApp(model(200, true), { analysetype: "tweedeOrdeGeometrisch" });
  const t = pd.store.lastRunData;
  check("de toetsing liep zonder fout", pd.store.error === null, String(pd.store.error));
  check("hergebruikt, met de schakelaar aan", t.toets?.analyse.hergebruikt === true && t.toets?.analyse.scheefstandModelAan === true);
  check("de toetsset is de resultaten: dezelfde lijst en dezelfde objecten",
    t.combinations.map((c) => c.id).join(",") === pd.actieveCombinaties.map((c) => c.id).join(",")
      && [...pd.resultaten].every(([id, r]) => t.combinationResults.get(id) === r)
      && t.combinationResults.size === pd.resultaten.size);
  check("de UGT-invoer van de kern is dezelfde als zonder hergebruik ([1])",
    JSON.stringify(pd.store.lastRunInputs.steel[0].forces_envelope) === JSON.stringify(s.forces_envelope));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[5] Divergentie: N_Ed boven N_cr — de toets geweigerd, de resultaten blijven");
{
  // G = 1100 kN: 6.10a N = 1 485 kN, 6.10b N = 1 320 kN, beide boven
  // N_cr = 1 195,6 kN (α_cr < 1). De eerste-orderesultaten bestaan gewoon.
  const div = await toetsViaApp(model(1100));
  const fout = div.store.error ?? "";
  log(`    ${fout.split("\n")[0].slice(0, 120)}…`);
  check("de resultaten zijn er (eerste orde)", div.resultaten.size === 3 && [...div.resultaten.values()].every((r) => r.reactions.has(1)));
  check("de toetsing is geweigerd: geen uitslag, geen toetsronde", div.store.results.length === 0
    && div.store.lastRunAt === null && div.store.lastRunData === null);
  check("de reden: de tweede orde van de toets faalt; niet teruggevallen op eerste orde",
    fout.includes("De toetskrachten zijn niet te bepalen") && fout.includes("niet teruggevallen op eerste orde"), fout);
  check("per combinatie een regel met de naam en α_cr",
    fout.includes("• UGT 6.10b — Wind (W) leidend") && fout.includes("• UGT 6.10a") && /α_cr = 0,\d+/.test(fout), fout);
  check("een melding op het scherm", div.meldingen.some((m) => m.titel === "common:app.check.refused" && m.tekst === fout),
    JSON.stringify(div.meldingen.map((m) => m.titel)));
  // Taak 7: de weigering is de enige FOUT (B7, B14), in Inzichten → Fouten,
  // en de store houdt de toetsanalyse vast, zodat het rapport zegt welke
  // berekening faalde.
  const laatste = div.stabiliteitsMeldingen.at(-1);
  // In Inzichten staat het vertaalde label "Toetsing geweigerd" er al boven;
  // de regel zelf is de reden, zonder het Nederlandse voorvoegsel "TOETSING
  // GEWEIGERD:" (dat dubbel en in elke taal Nederlands was).
  check("de FOUT in Inzichten: de reden zelf, zonder voorvoegsel",
    typeof laatste === "string" && laatste === fout && !laatste.startsWith("TOETSING GEWEIGERD"), String(laatste));
  const t = div.store.toets;
  check("de store houdt de toetsanalyse van de geweigerde toets: weigering, φ = 1/200, α_cr < 1",
    t?.weigering === fout && t.analyse.noemer === 200 && t.alphaCr.length === 2
      && t.alphaCr.every((u) => u.status === "bepaald" && u.alphaCr < 1), JSON.stringify(t && { ...t, weigering: t.weigering?.slice(0, 40) }));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[6] De export: hoort de toetsing bij de resultaten op het scherm?");
{
  const acties = (combinationResults) => ({
    modelDimension: "2d",
    fem: { analysetype: "eersteOrde", nodes: model(200).nodes, beams: model(200).beams, plates: [], combinationResults },
    rekenToestand: () => ({ herberekeningGepland: false, lopendeRekengangen: 0, generatie: 0, volledigeRekengang: combinationResults }),
    laatsteRekenfout: () => null,
  });
  // Opnieuw de toetsing van [1] (de stappen hierboven wisten de store).
  const nu = await toetsViaApp(model(200));
  check("de toetsset is een andere Map dan de resultaten (de UGT is eigen)",
    nu.store.lastRunData.combinationResults !== nu.resultaten);
  check("de export: de toetsing hoort bij deze resultaten", rekenVoorwaardenNu(acties(nu.resultaten)).toetsingHoortBijResultaten === true);
  check("… en niet bij andere resultaten (een latere rekengang)",
    rekenVoorwaardenNu(acties(new Map(nu.resultaten))).toetsingHoortBijResultaten === false);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[7] De namen van de toetscombinaties voor het rapport");
{
  const namen = useCheckStore.getState().toetsCombinaties;
  const tegen = namen.find((c) => c.id === WIND_TEGEN);
  check("de store kent de toetsvariant −x bij naam", tegen?.name.includes("(scheefstand −x)"), JSON.stringify(tegen));
  const kaart = toetsCombinatieNamen(COMBOS, namen);
  check("het rapport noemt haar zo, ook al kent het model haar id niet",
    !COMBOS.some((c) => c.id === WIND_TEGEN) && kaart.get(WIND_TEGEN) === tegen?.name);
  check("de namen van de toetsing gaan voor die van het model",
    kaart.get(WIND) === namen.find((c) => c.id === WIND).name && kaart.get(WIND) !== COMBOS.find((c) => c.id === WIND).name);
  // Taak 7: het label "2e orde + scheefstand" hoort bij de UGT-toetskrachten,
  // niet bij de BGT (die komt uit de resultaten, B6).
  check("de UGT-toetscombinaties (ook −x) dragen tweedeOrde, de BGT niet",
    namen.filter((c) => c.id !== 17).every((c) => c.tweedeOrde === true) && namen.find((c) => c.id === 17)?.tweedeOrde === false,
    JSON.stringify(namen.map((c) => [c.id, c.tweedeOrde])));
  useCheckStore.getState().weiger("test");
  check("een geweigerde toets laat geen namen achter", useCheckStore.getState().toetsCombinaties.length === 0);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[8] De toetsanalyse van de ronde, voor het paneel en het rapport");
{
  const nu = await toetsViaApp(model(200));
  const t = nu.store.toets;
  check("de store: tweede orde, φ = 1/200 (vaste noemer), niet hergebruikt, geen weigering",
    t?.analyse.soort === "tweedeOrdeGeometrisch" && t.analyse.noemer === 200 && t.analyse.bron === "vast"
      && t.analyse.hergebruikt === false && t.weigering === null, JSON.stringify(t?.analyse));
  check("… met α_cr van de toets (één per basiscombinatie) en haar meldingen",
    t.alphaCr === nu.store.lastRunData.stabiliteit.alphaCr && t.alphaCr.length === 2 && Array.isArray(t.meldingen));
  check("de toets heeft krachten: de FOUT in Inzichten is weg", nu.stabiliteitsMeldingen.at(-1) === null,
    JSON.stringify(nu.stabiliteitsMeldingen));
  useCheckStore.getState().clear();
  check("clear() wist de toetsanalyse", useCheckStore.getState().toets === null);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[9] Profielvarianten: dezelfde toetsset én dezelfde stabiliteit als de toetsing");
{
  // De varianten (stores/variantStore.ts) toetsen een andere doorsnede op de
  // krachten van de toetsing ernaast (`lastRunData`). Sinds #199 is die
  // toetsset altijd tweede orde met scheefstand, dus krijgt een vrije kop L om
  // y (5.2.2(7)b). Zonder de stabiliteit van de toetsing rekende een variant
  // met 2·L: een andere kniklengte dan de toetsing waarnaast hij staat.
  const { useVariantStore } = await import("./src/stores/variantStore.ts");
  const nu = await toetsViaApp(model(200));
  const toetsInvoer = nu.store.lastRunInputs.steel[0];
  const naarKern = [];
  const vorige = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const antwoord = await vorige(url, init);
    const tekst = await antwoord.text();
    naarKern.push({ verzoek: JSON.parse(init.body), uit: JSON.parse(tekst) });
    return { ...antwoord, text: async () => tekst };
  };
  try { await useVariantStore.getState().bereken(1); } finally { globalThis.fetch = vorige; }
  const staalVerzoeken = naarKern.filter((v) => v.verzoek.opdracht === "check_steel_beams");
  const varianten = staalVerzoeken.flatMap((v) => v.verzoek.inputs);
  const uitkomsten = staalVerzoeken.flatMap((v) => (Array.isArray(v.uit) ? v.uit : []));
  const lcrY = (r) => r?.checks?.find((c) => c.id === "6.3.1_buckling")?.kind?.data?.deelstappen?.find((d) => d.id === "l_cr_y")?.value;
  check("de varianten gingen naar de kern", varianten.length > 0, `${varianten.length} invoer(en)`);
  check("elke variant: de zijdelingse knik in de analyse zoals de toetsing ({y: true, z: false})",
    varianten.length > 0 && varianten.every((i) =>
      JSON.stringify(i.zijdelingse_knik_in_analyse) === JSON.stringify(toetsInvoer.zijdelingse_knik_in_analyse)),
    JSON.stringify(varianten.map((i) => i.zijdelingse_knik_in_analyse ?? null)));
  check("de kern: L_cr,y = 4000 mm (L) voor elke variant, zoals bij de toetsing; niet 8000 mm (2·L)",
    uitkomsten.length === varianten.length && uitkomsten.every((r) => lcrY(r) === 4000),
    JSON.stringify(uitkomsten.map(lcrY)));
}

log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed === 0 ? 0 : 1);

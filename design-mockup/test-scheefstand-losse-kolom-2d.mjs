// Eigen scheefstand per losse kolom in 2D (issue #199, fase 3, bouwsteen D in
// de engine). De 3D-tegenhanger is test-open-fem3d-scheefstand-losse-kolom.mjs.
//
// Bewaakt:
//   1. de herkenning (`eigenKolomScheefstand2D`): een kolomlijn waarvan geen
//      knoop boven de voet een oplegging heeft, in een plaat ligt of een andere
//      staaf raakt, is los; de stijlen van een portaal niet;
//   2. φ_eigen volgens de norm van het materiaal, h = de eigen hoogte, m = 1;
//   3. de engine: de lasten op een staaf of knoop in de map krijgen hun eigen φ,
//      de rest de model-φ; ΣH = Σφ_i·V_i (handberekening), zonder map
//      bit-gelijk;
//   4. de toets: `bepaalToetsKrachten2D` met `eigenKolommen` zet de φ per
//      staaf en knoop, meldt elke losse kolom, hergebruikt de resultaten niet,
//      en de toetsset geeft de staaltoets per staaf de toegepaste φ, zodat de
//      φ-eis van een vrij staafeind gehaald is (L, NEN-EN 1993-1-1 5.2.2(7)b);
//   5. uit (de standaard): geen melding, geen map, dezelfde krachten als vóór
//      fase 3;
//   6. de MCP-weg (`check` van de sidecar): het modelveld
//      `scheefstandEigenKolom` geeft dezelfde melding en L voor de losse kolom.
// Uitvoeren: npx tsx test-scheefstand-losse-kolom-2d.mjs

const {
  bepaalToetsKrachten2D, eigenKolomScheefstand2D, eigenKolomPhiKaarten, toetsSet2D,
} = await import("./src/lib/toetsKrachten.ts");
const { solveAllCases } = await import("./src/components/fem/solver/engine.ts");
const { combineResults } = await import("./src/components/fem/solver/combinations.ts");
const { zijdelingseKnikInVlakModel } = await import("./src/components/fem/solver/alphaCr.ts");
const { bepaalScheefstand, leidScheefstandGeometrieAf, phiVolgensNorm } = await import("./src/lib/scheefstandNorm.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function check(name, cond, detail = "") {
  if (cond) { passed++; log(`  ✓ ${name}`); }
  else      { failed++; log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const binnen = (a, b, rel) => Math.abs(a - b) <= Math.abs(b) * rel;

// ── Het model ───────────────────────────────────────────────────────────────
// Een portaal (stijlen x = 0 en x = 6000, ligger op z = 4000) en een losse
// kolom HEA 160 op x = 10 000, h = 4000 mm, ingeklemd, kop vrij.
// Lasten (G, UGT-factor 1,0): 100 kN op elke portaalknoop, 50 kN op de kop van
// de losse kolom, en een lijnlast van 2 kN/m op de losse kolom zelf in −z
// (gelijkwaardig aan het eigen gewicht: V = 2·4 = 8 kN langs de staaf).
//
// HANDBEREKENING
//   model-φ volgens EN 1993-1-1 (5.5): h = 4 m → α_h = 2/√4 = 1,0;
//   m = 3 kolomlijnen → α_m = √(0,5·(1 + 1/3)) = 0,81650;
//   φ_model = 1/200 · 1,0 · 0,81650 = 1/244,95.
//   φ_eigen van de losse kolom: h = 4 m, m = 1 → 1/200 · 1,0 · 1,0 = 1/200.
//   max(φ_model, φ_eigen) = 1/200.
//   ΣH(+x), eerste orde = Σφ_i·V_i:
//     portaal  2·100/244,95                 = 0,816497 kN
//     kolom    (50 + 8)/200                 = 0,290000 kN
//     totaal                                = 1,106497 kN
//   zonder eigen φ: 258/244,95              = 1,053281 kN
//   reactie Rx aan de voet van de losse kolom (statisch bepaald deel):
//     met eigen φ  −0,290000 kN; zonder −58/244,95 = −0,236784 kN.
const S235 = { material: "S235", profile: "HEA 160" };
const E = 210000, A = 3877, I = 1.673e7;
const ui = {
  nodes: [
    { id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: 4000 }, { id: 3, x: 6000, z: 0 }, { id: 4, x: 6000, z: 4000 },
    { id: 5, x: 10000, z: 0 }, { id: 6, x: 10000, z: 4000 },
  ],
  beams: [
    { id: 1, from: 1, to: 2, ...S235 }, { id: 2, from: 3, to: 4, ...S235 }, { id: 3, from: 2, to: 4, ...S235 },
    { id: 4, from: 5, to: 6, ...S235 },
  ],
  supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 3, type: "fixed" }, { nodeId: 5, type: "fixed" }],
  plates: [],
};
const basis = () => ({
  nodes: ui.nodes.map((n) => ({ ...n })),
  beams: ui.beams.map((b) => ({ id: b.id, from: b.from, to: b.to, E, A, I })),
  supports: ui.supports.map((s) => ({ ...s })),
  cases: [{ id: 1, name: "G" }],
  loads: [{ beamId: 4, q: -2, qDir: "z", qCoord: "global", caseId: 1 }],
  pointLoads: [
    { nodeId: 2, fz: -100000, caseId: 1 }, { nodeId: 4, fz: -100000, caseId: 1 }, { nodeId: 6, fz: -50000, caseId: 1 },
  ],
});
const ULS = { id: 1, name: "G", type: "uls", formula: "", factors: new Map([[1, 1]]) };

const geometrie = leidScheefstandGeometrieAf(ui);
const project = bepaalScheefstand({ bron: "en1993" }, geometrie, ["en1993"]);
const PHI_MODEL = 1 / 200 * Math.sqrt(0.5 * (1 + 1 / 3));
const PHI_EIGEN = 1 / 200;

log("\n[1] Herkenning en φ_eigen");
{
  check("model-φ = 1/244,95 (m = 3, h = 4 m)", binnen(project.noemer, 1 / PHI_MODEL, 1e-9), `${project.noemer}`);
  const kolommen = eigenKolomScheefstand2D(ui);
  check("één losse kolom: staaf 4", kolommen.length === 1 && kolommen[0].staafIds.join() === "4", JSON.stringify(kolommen));
  check("knopen boven de voet: 6", kolommen[0]?.knoopIds.join() === "6");
  check("h = 4,000 m, EN 1993, φ_eigen = 1/200",
    kolommen[0]?.hoogteM === 4 && kolommen[0]?.norm === "en1993" && binnen(kolommen[0].phiEigen, PHI_EIGEN, 1e-12));
  // Een houten losse kolom van 6 m: EN 1995-1-1 (5.1), 0,005·√(5/6) = 1/219,09.
  const hout = eigenKolomScheefstand2D({
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: 6000 }],
    beams: [{ id: 1, from: 1, to: 2, material: "C24", profile: "100x200" }],
    supports: [{ nodeId: 1, type: "fixed" }],
  });
  check("hout h = 6 m: EN 1995-1-1 (5.1), φ_eigen = 0,005·√(5/6) = 1/219,09",
    hout[0]?.norm === "en1995" && binnen(hout[0].phiEigen, 0.005 * Math.sqrt(5 / 6), 1e-12), JSON.stringify(hout));
  check("phiVolgensNorm spiegelt de handberekening", binnen(phiVolgensNorm("en1995", 6, 1).phi, 1 / 219.089, 1e-5));
  // Een kolom met een oplegging op de kop is niet los.
  const gesteund = eigenKolomScheefstand2D({ ...ui, supports: [...ui.supports, { nodeId: 6, type: "roller" }] });
  check("een oplegging op de kop: niet los", gesteund.length === 0);
  // Een kolom in een wandschijf is niet los.
  const inPlaat = eigenKolomScheefstand2D({
    ...ui,
    nodes: [...ui.nodes, { id: 7, x: 12000, z: 0 }, { id: 8, x: 12000, z: 4000 }],
    plates: [{ nodeIds: [5, 7, 8, 6] }],
  });
  check("de kop in een plaat: niet los", inPlaat.length === 0);
}

/** ΣH van alle opleggingen (N), en Rx aan knoop 5. */
const reacties = (r) => {
  let som = 0;
  for (const [, re] of r.reactions) som += re.fx;
  return { som, rx5: r.reactions.get(5).fx };
};

log("\n[2] De engine: φ per staaf en knoop, eerste orde");
{
  const kaarten = eigenKolomPhiKaarten(eigenKolomScheefstand2D(ui), PHI_MODEL);
  const met = solveAllCases({ ...basis(), scheefstand: { phi: PHI_MODEL, richting: 1, phiPerStaaf: kaarten.perStaaf, phiPerKnoop: kaarten.perKnoop } });
  const zonder = solveAllCases({ ...basis(), scheefstand: { phi: PHI_MODEL, richting: 1 } });
  const leeg = solveAllCases({ ...basis(), scheefstand: { phi: PHI_MODEL, richting: 1, phiPerStaaf: new Map(), phiPerKnoop: new Map() } });
  const rMet = reacties(met.perCase.get(1));
  const rZonder = reacties(zonder.perCase.get(1));
  const handMet = 200000 * PHI_MODEL + 58000 * PHI_EIGEN;
  const handZonder = 258000 * PHI_MODEL;
  log(`    ΣH met eigen φ ${(-rMet.som / 1e3).toFixed(6)} kN (hand ${(handMet / 1e3).toFixed(6)}), zonder ${(-rZonder.som / 1e3).toFixed(6)} kN (hand ${(handZonder / 1e3).toFixed(6)})`);
  check("ΣH met eigen φ = 2·100/244,95 + 58/200 = 1,106497 kN", binnen(-rMet.som, handMet, 1e-9), `${-rMet.som}`);
  check("ΣH zonder = 258/244,95 = 1,053281 kN", binnen(-rZonder.som, handZonder, 1e-9), `${-rZonder.som}`);
  check("Rx aan de voet van de losse kolom = −58/200 = −0,290 kN", binnen(rMet.rx5, -290, 1e-9), `${rMet.rx5}`);
  check("zonder eigen φ: Rx = −58/244,95 = −0,236784 kN", binnen(rZonder.rx5, -58000 * PHI_MODEL, 1e-9), `${rZonder.rx5}`);
  const zMap = zonder.perCase.get(1), lMap = leeg.perCase.get(1);
  check("lege kaarten: bit-gelijk aan zonder kaarten",
    [...zMap.reactions].every(([id, r]) => lMap.reactions.get(id).fx === r.fx && lMap.reactions.get(id).my === r.my));
}

log("\n[3] De toets: P-Δ met de eigen φ, de φ-eis gehaald");
{
  const kolommen = eigenKolomScheefstand2D(ui);
  const invoer = (eigen) => ({
    basis: basis(),
    combinaties: [ULS],
    scheefstand: { project, normen: ["en1993"], richting: 1, modelAan: false, ...(eigen ? { eigenKolommen: kolommen } : {}) },
    analysetype: "eersteOrde",
  });
  const met = bepaalToetsKrachten2D(invoer(true));
  const zonder = bepaalToetsKrachten2D(invoer(false));
  check("geen weigering", met.weigering === null && zonder.weigering === null);
  check("met: een melding noemt staaf 4, h = 4,000 m, φ_eigen = 1/200",
    met.meldingen.some((m) => /losse kolom/.test(m) && /staaf 4 \(h = 4,000 m, EN 1993-1-1 \(5\.5\), φ_eigen = 1\/200/.test(m)),
    JSON.stringify(met.meldingen));
  check("zonder: geen melding over losse kolommen", !zonder.meldingen.some((m) => /losse kolom/.test(m)));
  check("met: φ per staaf 4 = 1/200", met.eigenKolom?.perStaaf.get(4) === Math.max(PHI_MODEL, PHI_EIGEN));
  check("zonder: geen eigenKolom", zonder.eigenKolom === undefined);
  // De reactie in P-Δ: de horizontale som blijft Σφ_i·V_i (K_G heeft
  // rijsommen nul), dus Rx aan de voet van de losse kolom is exact −58/200 kN
  // in +x en +58/200 kN in −x.
  const plus = met.combinationResults.get(1).reactions.get(5).fx;
  const min = met.combinationResults.get(1 + 1_000_000).reactions.get(5).fx;
  check("P-Δ +x: Rx(5) = −0,290 kN", binnen(plus, -290, 1e-6), `${plus}`);
  check("P-Δ −x: Rx(5) = +0,290 kN", binnen(min, 290, 1e-6), `${min}`);
  const plusZonder = zonder.combinationResults.get(1).reactions.get(5).fx;
  check("zonder eigen φ: Rx(5) = −0,236784 kN (de krachten van vóór fase 3)", binnen(plusZonder, -58000 * PHI_MODEL, 1e-6), `${plusZonder}`);
  // Het voetmoment van de losse kolom: eerste orde 50·4/200 + 8·2/200 = 1,08 kNm
  // (kopkracht 0,25 kN × 4 m, lijnlast 0,04 kN/m × 4²/2); P-Δ vergroot.
  const mVoet = Math.abs(met.combinationResults.get(1).reactions.get(5).my);
  check("voetmoment losse kolom > eerste orde 1,08 kNm (P-Δ vergroot) en < 1,2 kNm",
    mVoet > 1.08e6 && mVoet < 1.2e6, `${mVoet}`);

  const set = toetsSet2D(met, { combinaties: [ULS], combinationResults: new Map(), perCase: null }, ui.beams);
  check("toetsset: φ per staaf 4 in de stabiliteit", set.stabiliteit.scheefstandPhiPerStaaf?.get(4) === PHI_EIGEN);
  const besluit = zijdelingseKnikInVlakModel(set.stabiliteit, true, 4, [4]);
  check("φ-eis gehaald met de eigen φ: veld y = true (L)", besluit.veld?.y === true && !besluit.notitie, JSON.stringify(besluit));
  const setZonder = toetsSet2D(zonder, { combinaties: [ULS], combinationResults: new Map(), perCase: null }, ui.beams);
  const besluitZonder = zijdelingseKnikInVlakModel(setZonder.stabiliteit, true, 4, [4]);
  check("zonder eigen φ: φ_model 1/244,95 < 1/200, dus 2·L met kanttekening",
    besluitZonder.veld === undefined && /2·L/.test(besluitZonder.notitie ?? ""), JSON.stringify(besluitZonder));
  // Een staaf die niet in de map staat, houdt de model-φ.
  const ander = zijdelingseKnikInVlakModel(set.stabiliteit, true, 4, [1]);
  check("een andere staaf (1) houdt de model-φ (2·L)", ander.veld === undefined);
}

log("\n[4] Gelijk aan combineResults op een eigen eerste-ordesom (controle van de richting)");
{
  const kaarten = eigenKolomPhiKaarten(eigenKolomScheefstand2D(ui), PHI_MODEL);
  const min = solveAllCases({ ...basis(), scheefstand: { phi: PHI_MODEL, richting: -1, phiPerStaaf: kaarten.perStaaf, phiPerKnoop: kaarten.perKnoop } });
  const r = combineResults(ULS, min.perCase);
  check("−x: Rx(5) = +0,290 kN", binnen(r.reactions.get(5).fx, 290, 1e-9), `${r.reactions.get(5).fx}`);
}

log("\n[5] MCP (`check`, de sidecar): dezelfde regel via `scheefstandEigenKolom` in het model");
{
  const { verwerkVerzoek } = await import("./src/mcp/sidecar.ts");
  const { readFileSync } = await import("node:fs");
  const PROFIELEN = JSON.parse(readFileSync(
    new URL("../src-tauri/crates/steel-profiles/data/profiles.json", import.meta.url), "utf8"));
  const model = (eigen) => ({
    nodes: ui.nodes, beams: ui.beams, supports: ui.supports, plates: [],
    loadCases: [{ id: 1, name: "G", type: "dead" }],
    loads: [
      { id: 1, type: "pointForce", nodeId: 2, fz: -100, caseId: 1 },
      { id: 2, type: "pointForce", nodeId: 4, fz: -100, caseId: 1 },
      { id: 3, type: "pointForce", nodeId: 6, fz: -50, caseId: 1 },
    ],
    scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
    scheefstandBron: "en1993", scheefstandHoogteM: null, scheefstandAantalElementen: null,
    ...(eigen === undefined ? {} : { scheefstandEigenKolom: eigen }),
  });
  const vraag = (eigen) => verwerkVerzoek({ v: 1, id: 1, op: "check", payload: {
    model: model(eigen), profiles: PROFIELEN,
    combinations: [{ id: 1, name: "G", type: "uls", formula: "G", factors: { 1: 1 } }],
  } });
  const v = verwerkVerzoek({ v: 1, id: 1, op: "validate", payload: { model: model(true) } });
  check("validate accepteert scheefstandEigenKolom", v.ok === true && v.result?.ok === true, JSON.stringify(v.result?.errors ?? v.error));
  const fout = verwerkVerzoek({ v: 1, id: 1, op: "validate", payload: { model: { ...model(true), scheefstandEigenKolom: "ja" } } });
  check("validate weigert een niet-boolean", fout.result?.ok === false, JSON.stringify(fout.result?.errors));
  const met = vraag(true), zonder = vraag(undefined);
  check("check slaagt (met en zonder)", met.ok === true && zonder.ok === true, met.error?.melding ?? zonder.error?.melding ?? "");
  const kolom = (a) => a.result?.steel_check_inputs?.find((i) => i.beam_id === 4);
  check("met: warnings noemen de losse kolom staaf 4 met φ_eigen = 1/200",
    (met.result?.warnings ?? []).some((w) => /losse kolom/.test(w) && /staaf 4 \(h = 4,000 m/.test(w)));
  check("met: de staalinvoer van staaf 4 heeft zijdelingse_knik_in_analyse y = true (L)",
    kolom(met)?.zijdelingse_knik_in_analyse?.y === true, JSON.stringify(kolom(met)?.zijdelingse_knik_in_analyse));
  check("zonder (standaard uit): geen zijdelingse knik in de analyse (2·L) en geen melding",
    kolom(zonder) !== undefined && kolom(zonder).zijdelingse_knik_in_analyse === undefined
      && !(zonder.result?.warnings ?? []).some((w) => /losse kolom/.test(w)),
    JSON.stringify(kolom(zonder)?.zijdelingse_knik_in_analyse));
}

log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);

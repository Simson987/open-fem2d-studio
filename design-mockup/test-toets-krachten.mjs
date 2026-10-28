// De toetsrekengang 2D (issue #199, bouwsteen A): `bepaalToetsKrachten2D` maakt
// de UGT-toetskrachten ALTIJD met tweede orde (P-Δ) en scheefstand, los van de
// analyse-instelling en de scheefstandschakelaar van het model. Bewaakt:
//   1. een vrijstaande kolom in een eerste-ordemodel zonder scheefstand: de
//      toets-N is de belasting en M aan de voet = φ·V·h·1/(1 − N/N_cr) binnen
//      1 % (handberekening hieronder); de resultaten zelf geven M = 0;
//   2. beide richtingen: elke UGT-combinatie in +x en −x, met id en
//      id + 1 000 000, ook als de primaire richting −x is;
//   3. alleen UGT: BGT-combinaties en eindtoestandvarianten (E_mean,fin) vallen
//      eruit, de laatste met een melding en zonder uitzondering;
//   4. α_cr één keer per basiscombinatie, ook als de lijst al ontvouwd is;
//   5. hergebruik van een P-Δ-resultaatrekengang met de schakelaar aan en
//      dezelfde φ: dezelfde objecten, geen extra som, en bit-gelijk aan een
//      verse toetsrekengang;
//   6. geen hergebruik bij eerste orde, zonder scheefstand, met een andere φ
//      of met een eindtoestandvariant — en dan blijft de tweede-orde-status
//      van de resultaten onaangeroerd (geen gedeelde cache);
//   7. de toets-φ: de projectinstelling, ook met de schakelaar uit; met hout
//      minstens NEN-EN 1995-1-1 (5.1) met de modelhoogte; een waarschuwing bij
//      een vaste noemer onder de normafleiding;
//   8. divergentie (α_cr < 1): een weigering per combinatie met de reden en
//      α_cr, geen uitzondering, geen toetskrachten, en de resultaten blijven;
//   9. het analysetype tweedeOrdeFysisch maakt de toets fysisch.
//  10. de toetsset voor de bouwers (`toetsSet2D`): de UGT uit de toets, de BGT
//      uit de resultaten, de stabiliteit van de toets en de eerste orde voor
//      §5.8 (UGT uit de toets, quasi-blijvend uit de resultaten).
// Praat alleen met engine, combinations, scheefstandNorm en toetsKrachten —
// alles in de barrel — en draait dus ook tegen de bundel: de sidecar gebruikt
// straks dezelfde functie.
// Uitvoeren: npx tsx test-toets-krachten.mjs

const { bepaalToetsKrachten2D, bepaalToetsScheefstand, toetsScheefstandNormen, toetsSet2D, weigeringTekst } =
  await import("./src/lib/toetsKrachten.ts");
const {
  solveAllCases, solveAllCasesNonlinear, getSecondOrderState,
} = await import("./src/components/fem/solver/engine.ts");
const { bepaalAlphaCr } = await import("./src/components/fem/solver/alphaCr.ts");
const {
  combineResults, metScheefstandRichtingen, SCHEEFSTAND_COMBO_OFFSET, EINDTOESTAND_COMBO_OFFSET, BGT_EINDTOESTAND_VEELVOUD,
} = await import("./src/components/fem/solver/combinations.ts");
const {
  bepaalScheefstand, leidScheefstandGeometrieAf, phiVolgensNorm,
} = await import("./src/lib/scheefstandNorm.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function check(name, cond, detail = "") {
  if (cond) { passed++; log(`  ✓ ${name}`); }
  else      { failed++; log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const binnen = (a, b, pct) => Math.abs(a - b) <= Math.abs(b) * pct / 100;

// ── Het model: een ingeklemde kolom met een vrije kop ───────────────────────
//
// HANDBEREKENING (ingeklemd-vrij, last centrisch op de kop):
//   h = 5000 mm, E·I = 210 000 · 1,0·10⁸ = 2,1·10¹³ Nmm²
//   N_cr = π²·EI/(2h)² = 9,8696 · 2,1·10¹³ / 10⁸ = 2 072 621 N
//   G = 60 kN op de kop; UGT 1,35·G → V = N_Ed = 81 000 N
//   N_Ed/N_cr = 81 000 / 2 072 621 = 0,03908
//   φ = 1/200 (vaste noemer, de beginstand) → H = φ·V = 405 N op de kop
//   M_I = H·h = 405 · 5000 = 2,025·10⁶ Nmm = 2,025 kNm
//   M_II = M_I · 1/(1 − N/N_cr) = 2,025 · 1,04067 = 2,1074 kNm
// Ter controle de exacte oplossing van de ingeklemd-vrije staaf met kopkracht:
//   M_II = H·tan(kh)/k, kh = (π/2)·√(N/N_cr) = 0,31053
//   tan(kh)/(kh) = 1,0334 → M_II = 2,0926 kNm.
// De benadering 1/(1 − N/N_cr) ligt 0,7 % boven de exacte waarde (aan de
// veilige kant), dus de 1 % van de taak is haalbaar én onderscheidend: eerste
// orde (factor 1,000) ligt 3,9 % onder de handberekening.
// Eerste orde zonder scheefstand (de resultaten van dit model) geeft M = 0:
// de last staat centrisch.
const E = 210000, A = 7810, I = 1.0e8, H_MM = 5000;
const N_CR = (Math.PI ** 2 * E * I) / (2 * H_MM) ** 2;
const kolom = (Gk, hoogte = H_MM) => ({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: hoogte }],
  beams: [{ id: 1, from: 1, to: 2, E, A, I }],
  supports: [{ nodeId: 1, type: "fixed" }],
  cases: [{ id: 1, name: "G" }, { id: 2, name: "Q" }],
  loads: [],
  pointLoads: [{ nodeId: 2, fz: -Gk, caseId: 1 }],
});
const uls = (id, name, factors, extra = {}) => ({ id, name, type: "uls", formula: "", factors: new Map(factors), ...extra });
const sls = (id, name, factors, extra = {}) => ({ id, name, type: "sls", formula: "", factors: new Map(factors), ...extra });
const ULS1 = uls(1, "1,35G", [[1, 1.35]]);
const ULS2 = uls(2, "1,2G+1,5Q", [[1, 1.2], [2, 1.5]]);
const SLS3 = sls(3, "G+Q karakteristiek", [[1, 1], [2, 1]]);

const geometrie5 = leidScheefstandGeometrieAf(kolom(60000));
/** De scheefstand van de projectinstelling, zoals de app hem bepaalt. */
const project = (keuze, normen = ["en1993"], geometrie = geometrie5) => bepaalScheefstand(keuze, geometrie, normen);
const vast200 = project({ bron: "vast", noemer: 200 });

/** Het voetmoment (reactie my, Nmm) van combinatie `id`. */
const mVoet = (res, id) => res.get(id).reactions.get(1).my;
/** De normaalkracht in de kolom (N, trek positief) van combinatie `id`. */
const nKolom = (res, id) => res.get(id).elements.get(1).N;

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] Vrijstaande kolom, eerste-ordemodel zonder scheefstand: de toets rekent P-Δ met φ");
{
  const basis = kolom(60000);
  // De resultaatrekengang zoals de app hem nu draait: eerste orde, schakelaar uit.
  const { perCase } = solveAllCases(basis);
  const resultaten = new Map([ULS1, ULS2, SLS3].map((c) => [c.id, combineResults(c, perCase)]));
  const toets = bepaalToetsKrachten2D({
    basis,
    combinaties: [ULS1, ULS2, SLS3],
    scheefstand: { project: vast200, normen: ["en1993"], richting: 1, modelAan: false },
    analysetype: "eersteOrde",
    resultaten: { perCase, combinationResults: resultaten },
  });
  const V = 1.35 * 60000;
  const mI = (1 / 200) * V * H_MM;
  const mHand = mI / (1 - V / N_CR);
  const kh = (Math.PI / 2) * Math.sqrt(V / N_CR);
  const mExact = mI * Math.tan(kh) / kh;
  const m = Math.abs(mVoet(toets.combinationResults, 1));
  log(`    N_cr = ${(N_CR / 1e3).toFixed(1)} kN, N/N_cr = ${(V / N_CR).toFixed(5)}`);
  log(`    M_voet: toets ${(m / 1e6).toFixed(4)} kNm, hand ${(mHand / 1e6).toFixed(4)} kNm, exact ${(mExact / 1e6).toFixed(4)} kNm, eerste orde ${(mI / 1e6).toFixed(4)} kNm`);
  check("handberekening: N_cr = 2 072,6 kN", binnen(N_CR, 2072621, 0.01), `${N_CR}`);
  check("de toets-N is de belasting: N = −1,35·G = −81 kN (druk)", binnen(nKolom(toets.combinationResults, 1), -V, 0.01), `${nKolom(toets.combinationResults, 1)}`);
  check("M_voet = φ·V·h·1/(1 − N/N_cr) binnen 1 %", binnen(m, mHand, 1), `${m} vs ${mHand}`);
  check("M_voet = de exacte H·tan(kh)/k binnen 0,3 %", binnen(m, mExact, 0.3), `${m} vs ${mExact}`);
  check("M_voet ligt duidelijk boven de eerste orde φ·V·h (vergroting > 3 %)", m > mI * 1.03, `${m} vs ${mI}`);
  check("de resultaten zelf (eerste orde, schakelaar uit) geven M_voet = 0", Math.abs(mVoet(resultaten, 1)) < 1e-6, `${mVoet(resultaten, 1)}`);
  // DE STAAFKRACHTEN, NIET ALLEEN DE REACTIE. De bouwers lezen
  // elements.bendingMoment (steelCheckBuilder `forcePointsForCombination`),
  // niet de reactie. Tot oktober 2026 rekende de kern de staafeindkrachten na
  // P-Δ met alleen K_E·u: dan was het voetmoment 2,1029 kNm tegen een reactie
  // van 2,0927 en stond er aan de vrije kop −0,0068 kNm waar 0 hoort. Met
  // (K_E + K_G)·u sluit het evenwicht: kop 0, voet = reactie, en beide tegen
  // de hand (binnen 1 % van 1/(1 − N/N_cr), 0,3 % van de exacte waarde).
  const momenten = toets.combinationResults.get(1).elements.get(1).bendingMoment;
  const stations = toets.combinationResults.get(1).elements.get(1).stations_mm;
  const iKop = stations.length - 1;
  const mStaafVoet = Math.abs(momenten[0]);
  log(`    staafmoment: voet ${(mStaafVoet / 1e6).toFixed(4)} kNm, kop ${(momenten[iKop] / 1e6).toFixed(6)} kNm, reactie ${(m / 1e6).toFixed(4)} kNm`);
  check("staafmoment aan de voet = φ·V·h·1/(1 − N/N_cr) binnen 1 %", binnen(mStaafVoet, mHand, 1), `${mStaafVoet} vs ${mHand}`);
  check("staafmoment aan de voet = de exacte H·tan(kh)/k binnen 0,3 %", binnen(mStaafVoet, mExact, 0.3), `${mStaafVoet} vs ${mExact}`);
  check("staafmoment aan de voet = de reactie (knoopevenwicht, 1e-6)", binnen(mStaafVoet, m, 1e-4), `${mStaafVoet} vs ${m}`);
  check("staafmoment aan de vrije kop = 0 (|M_kop| < 1e-6·M_voet)", Math.abs(momenten[iKop]) < 1e-6 * mStaafVoet, `${momenten[iKop]}`);
  check("analyse: P-Δ, φ = 1/200, bron vast, schakelaar uit, niet hergebruikt",
    toets.analyse.soort === "tweedeOrdeGeometrisch" && toets.analyse.phi === 1 / 200 && toets.analyse.noemer === 200 &&
    toets.analyse.bron === "vast" && toets.analyse.scheefstandModelAan === false && toets.analyse.hergebruikt === false,
    JSON.stringify(toets.analyse));
  check("geen weigering", toets.weigering === null);
  check("de toets-perCase draagt een eigen tweede-orde-status met de toets-φ",
    toets.perCase !== perCase && getSecondOrderState(toets.perCase)?.input.scheefstand?.phi === 1 / 200);
  check("de resultaten houden hun eerste-ordestatus (geen tweede-orde-status eraan gehangen)", getSecondOrderState(perCase) === undefined);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] Beide richtingen: elke UGT-combinatie in +x en −x");
for (const richting of [1, -1]) {
  const toets = bepaalToetsKrachten2D({
    basis: kolom(60000),
    combinaties: [ULS1, ULS2],
    scheefstand: { project: vast200, normen: ["en1993"], richting, modelAan: false },
    analysetype: "eersteOrde",
  });
  const ids = toets.ugtCombinaties.map((c) => c.id);
  const verwacht = [1, 1 + SCHEEFSTAND_COMBO_OFFSET, 2, 2 + SCHEEFSTAND_COMBO_OFFSET];
  const r = richting > 0 ? "+x" : "−x";
  check(`primair ${r}: id's 1, 1 000 001, 2, 1 000 002`, ids.join(",") === verwacht.join(","), ids.join(","));
  check(`primair ${r}: id 1 rekent ${r}, id 1 000 001 de tegengestelde richting`,
    toets.ugtCombinaties[0].scheefstandRichting === richting && toets.ugtCombinaties[1].scheefstandRichting === -richting &&
    toets.ugtCombinaties[0].name === `1,35G (scheefstand ${r})`);
  check(`primair ${r}: alle vier varianten hebben toetskrachten`, verwacht.every((id) => toets.combinationResults.has(id)));
  const plus = mVoet(toets.combinationResults, 1), min = mVoet(toets.combinationResults, 1 + SCHEEFSTAND_COMBO_OFFSET);
  check(`primair ${r}: voetmomenten even groot en tegengesteld`, Math.sign(plus) === -Math.sign(min) && binnen(Math.abs(plus), Math.abs(min), 1e-7), `${plus} / ${min}`);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] Alleen UGT; een eindtoestandvariant valt eruit, met een melding");
{
  // De UGT-eindtoestandvariant zoals `metEindtoestandVarianten` hem maakt
  // (id + EINDTOESTAND_COMBO_OFFSET·round(100·ψ₂)). In een tweede-orde-
  // rekengang zou `combineResults` erop gooien; de toets laat hem weg.
  const eind = uls(1 + EINDTOESTAND_COMBO_OFFSET * 30, "1,35G (eindtoestand ψ₂ = 0,3)", [[1, 1.35]], { eindtoestand: { psi2: 0.3 } });
  let toets = null, fout = null;
  try {
    toets = bepaalToetsKrachten2D({
      basis: kolom(60000),
      combinaties: [ULS1, SLS3, eind],
      scheefstand: { project: vast200, normen: ["en1993"], richting: 1, modelAan: false },
      analysetype: "eersteOrde",
    });
  } catch (e) { fout = e; }
  check("geen uitzondering", fout === null, String(fout));
  const ids = toets ? [...toets.combinationResults.keys()].sort((a, b) => a - b) : [];
  check("alleen de UGT-combinatie, in twee richtingen", ids.join(",") === `1,${1 + SCHEEFSTAND_COMBO_OFFSET}`, ids.join(","));
  check("de lijst toetscombinaties bevat geen BGT en geen eindtoestand",
    toets?.ugtCombinaties.every((c) => c.type === "uls" && c.eindtoestand === undefined));
  check("een melding noemt de vervallen eindtoestandvariant", toets?.meldingen.some((m) => /eindtoestand/i.test(m) && /1,35G \(eindtoestand/.test(m)),
    JSON.stringify(toets?.meldingen));
  check("geen melding zonder eindtoestandvariant",
    !bepaalToetsKrachten2D({
      basis: kolom(60000), combinaties: [ULS1],
      scheefstand: { project: vast200, normen: ["en1993"], richting: 1, modelAan: false }, analysetype: "eersteOrde",
    }).meldingen.some((m) => /eindtoestand/i.test(m)));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] α_cr één keer per basiscombinatie");
{
  const invoer = {
    basis: kolom(60000),
    scheefstand: { project: vast200, normen: ["en1993"], richting: 1, modelAan: false },
    analysetype: "eersteOrde",
  };
  const toets = bepaalToetsKrachten2D({ ...invoer, combinaties: [ULS1, ULS2, SLS3] });
  check("twee basiscombinaties → twee α_cr (niet vier)", toets.alphaCr.length === 2, `${toets.alphaCr.length}`);
  check("op de id's 1 en 2", toets.alphaCr.map((u) => u.combinatieId).join(",") === "1,2");
  // α_cr = N_cr/N_Ed; met twee elementen per staaf ligt N_cr binnen ~0,1 %.
  const a1 = toets.alphaCr[0].alphaCr, a2 = toets.alphaCr[1].alphaCr;
  check("α_cr(1,35G) = N_cr/(1,35·G) = 25,59 binnen 1 %", binnen(a1, N_CR / (1.35 * 60000), 1), `${a1}`);
  check("α_cr(1,2G) = N_cr/(1,2·G) = 28,79 binnen 1 %", binnen(a2, N_CR / (1.2 * 60000), 1), `${a2}`);
  // Een lijst die al ontvouwd is (de store doet dat met de schakelaar aan).
  const ontvouwd = metScheefstandRichtingen([ULS1, ULS2, SLS3], true, 1);
  const toets2 = bepaalToetsKrachten2D({ ...invoer, combinaties: ontvouwd });
  check("al ontvouwde lijst: dezelfde vier varianten, niet nog eens ontvouwd", toets2.ugtCombinaties.length === 4);
  check("al ontvouwde lijst: nog steeds twee α_cr", toets2.alphaCr.length === 2 && toets2.alphaCr.map((u) => u.combinatieId).join(",") === "1,2");
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[5] Hergebruik: P-Δ-resultaten met de schakelaar aan en dezelfde φ");
{
  // De resultaatrekengang zoals de app hem draait bij tweede orde met de
  // schakelaar aan: φ = 1/noemer (`bouwMultiInput`), de combinaties ontvouwd.
  const basis = { ...kolom(60000), scheefstand: { phi: 1 / vast200.noemer, richting: 1 } };
  const combinaties = metScheefstandRichtingen([ULS1, ULS2, SLS3], true, 1);
  const { perCase } = solveAllCasesNonlinear(basis);
  const resultaten = new Map(combinaties.map((c) => [c.id, combineResults(c, perCase)]));
  const cacheVoor = getSecondOrderState(perCase).cache.size;
  const invoer = {
    basis, combinaties,
    scheefstand: { project: vast200, normen: ["en1993"], richting: 1, modelAan: true },
    analysetype: "tweedeOrdeGeometrisch",
  };
  const toets = bepaalToetsKrachten2D({ ...invoer, resultaten: { perCase, combinationResults: resultaten } });
  const ugtIds = [1, 1 + SCHEEFSTAND_COMBO_OFFSET, 2, 2 + SCHEEFSTAND_COMBO_OFFSET];
  check("hergebruikt = true", toets.analyse.hergebruikt === true);
  check("de toets-perCase is die van de resultaten", toets.perCase === perCase);
  check("elke toetskracht is hetzelfde object als het resultaat", ugtIds.every((id) => toets.combinationResults.get(id) === resultaten.get(id)));
  check("geen BGT in de toetsset", !toets.combinationResults.has(3) && !toets.combinationResults.has(3 + SCHEEFSTAND_COMBO_OFFSET));
  check("geen extra som: de cache van de resultaten is niet gegroeid", getSecondOrderState(perCase).cache.size === cacheVoor,
    `${cacheVoor} → ${getSecondOrderState(perCase).cache.size}`);
  // Bit-gelijk aan een verse toetsrekengang met dezelfde invoer.
  const vers = bepaalToetsKrachten2D(invoer);
  check("een verse toetsrekengang hergebruikt niet", vers.analyse.hergebruikt === false && vers.perCase !== perCase);
  const bitGelijk = ugtIds.every((id) => {
    const a = toets.combinationResults.get(id), b = vers.combinationResults.get(id);
    const ea = a.elements.get(1), eb = b.elements.get(1);
    return a.reactions.get(1).my === b.reactions.get(1).my && a.reactions.get(1).fx === b.reactions.get(1).fx &&
      ea.N === eb.N && ea.bendingMoment.every((v, i) => v === eb.bendingMoment[i]) &&
      a.displacements.get(2).ux === b.displacements.get(2).ux;
  });
  check("hergebruik is bit-gelijk aan de verse toetsrekengang", bitGelijk);
  check("α_cr bit-gelijk", toets.alphaCr.every((u, i) => u.alphaCr === vers.alphaCr[i].alphaCr));

  // α_cr van de resultaten overnemen (geen tweede bisectie). De app bepaalt
  // α_cr van de resultaten op dezelfde invoer en dezelfde krachten; bij
  // hergebruik is dat precies wat de toets zou rekenen.
  const vanResultaten = bepaalAlphaCr(basis, combinaties, resultaten);
  const overgenomen = bepaalToetsKrachten2D({
    ...invoer, resultaten: { perCase, combinationResults: resultaten, alphaCr: vanResultaten },
  });
  check("hergebruik met α_cr van de resultaten: dezelfde objecten (niet opnieuw bepaald), alleen de basiscombinaties",
    overgenomen.alphaCr.length === 2 && overgenomen.alphaCr.every((u) => vanResultaten.includes(u))
      && overgenomen.alphaCr.map((u) => u.combinatieId).join() === "1,2",
    JSON.stringify(overgenomen.alphaCr.map((u) => u.combinatieId)));
  check("… en gelijk aan wat de toets zelf zou bepalen",
    overgenomen.alphaCr.every((u, i) => u.alphaCr === toets.alphaCr[i].alphaCr));
  // Zonder hergebruik telt de meegegeven α_cr niet: andere invoer, andere N.
  const eigen = bepaalToetsKrachten2D({
    ...invoer, analysetype: "eersteOrde",
    resultaten: { perCase, combinationResults: resultaten, alphaCr: vanResultaten },
  });
  check("zonder hergebruik bepaalt de toets α_cr zelf", eigen.analyse.hergebruikt === false
    && !eigen.alphaCr.some((u) => vanResultaten.includes(u)));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[6] Geen hergebruik, en geen gedeelde tweede-orde-status");
{
  const combinaties = [ULS1, ULS2];
  const scheef = (project, normen = ["en1993"]) => ({ project, normen, richting: 1, modelAan: true });

  // a. P-Δ zonder scheefstand: de status van de resultaten kent geen φ.
  {
    const basis = kolom(60000);
    const { perCase } = solveAllCasesNonlinear(basis);
    const resultaten = new Map(combinaties.map((c) => [c.id, combineResults(c, perCase)]));
    const cacheVoor = getSecondOrderState(perCase).cache.size;
    const toets = bepaalToetsKrachten2D({
      basis, combinaties, scheefstand: { ...scheef(vast200), modelAan: false },
      analysetype: "tweedeOrdeGeometrisch", resultaten: { perCase, combinationResults: resultaten },
    });
    check("P-Δ zonder scheefstand: niet hergebruikt", toets.analyse.hergebruikt === false && toets.perCase !== perCase);
    check("P-Δ zonder scheefstand: cache van de resultaten onaangeroerd", getSecondOrderState(perCase).cache.size === cacheVoor);
    check("P-Δ zonder scheefstand: de toets heeft wél een voetmoment", Math.abs(mVoet(toets.combinationResults, 1)) > 1e6);
  }
  // b. Eerste orde met scheefstand aan: geen tweede-orde-status om te hergebruiken.
  {
    const basis = { ...kolom(60000), scheefstand: { phi: 1 / 200, richting: 1 } };
    const { perCase } = solveAllCases(basis);
    const ontvouwd = metScheefstandRichtingen(combinaties, true, 1);
    const resultaten = new Map(ontvouwd.map((c) => [c.id, combineResults(c, perCase)]));
    const toets = bepaalToetsKrachten2D({
      basis, combinaties: ontvouwd, scheefstand: scheef(vast200),
      analysetype: "eersteOrde", resultaten: { perCase, combinationResults: resultaten },
    });
    check("eerste orde: niet hergebruikt", toets.analyse.hergebruikt === false && toets.perCase !== perCase);
    check("eerste orde: de toets vergroot het voetmoment van de resultaten",
      Math.abs(mVoet(toets.combinationResults, 1)) > Math.abs(mVoet(resultaten, 1)) * 1.03,
      `${mVoet(toets.combinationResults, 1)} vs ${mVoet(resultaten, 1)}`);
  }
  // c. P-Δ met scheefstand, maar een andere φ: hout tilt de toets-φ naar EN 1995-1-1 (5.1).
  {
    const vast300 = project({ bron: "vast", noemer: 300 }, ["en1993", "en1995"]);
    const basis = { ...kolom(60000), scheefstand: { phi: 1 / vast300.noemer, richting: 1 } };
    const { perCase } = solveAllCasesNonlinear(basis);
    const ontvouwd = metScheefstandRichtingen(combinaties, true, 1);
    const resultaten = new Map(ontvouwd.map((c) => [c.id, combineResults(c, perCase)]));
    const cacheVoor = getSecondOrderState(perCase).cache.size;
    const toets = bepaalToetsKrachten2D({
      basis, combinaties: ontvouwd, scheefstand: scheef(vast300, ["en1993", "en1995"]),
      analysetype: "tweedeOrdeGeometrisch", resultaten: { perCase, combinationResults: resultaten },
    });
    check("andere φ (1/300 → 1/200 door hout): niet hergebruikt", toets.analyse.hergebruikt === false && toets.perCase !== perCase);
    check("andere φ: de toetsstatus rekent met φ = 0,005", getSecondOrderState(toets.perCase).input.scheefstand.phi === 0.005);
    check("andere φ: de status van de resultaten houdt φ = 1/300 en haar cache", getSecondOrderState(perCase).input.scheefstand.phi === 1 / 300 &&
      getSecondOrderState(perCase).cache.size === cacheVoor);
    // Zelfde V en φ als [1], dus hetzelfde voetmoment als daar.
    const ref = bepaalToetsKrachten2D({
      basis: kolom(60000), combinaties, scheefstand: { ...scheef(vast200), modelAan: false }, analysetype: "eersteOrde",
    });
    check("andere φ: voetmoment gelijk aan de toets met φ = 1/200 uit [1]",
      binnen(mVoet(toets.combinationResults, 1), mVoet(ref.combinationResults, 1), 1e-9),
      `${mVoet(toets.combinationResults, 1)} vs ${mVoet(ref.combinationResults, 1)}`);
  }
  // d. Een UGT-eindtoestandvariant in de lijst: geen hergebruik (volgens het ontwerp).
  {
    const basis = { ...kolom(60000), scheefstand: { phi: 1 / 200, richting: 1 } };
    const { perCase } = solveAllCasesNonlinear(basis);
    const ontvouwd = metScheefstandRichtingen(combinaties, true, 1);
    const resultaten = new Map(ontvouwd.map((c) => [c.id, combineResults(c, perCase)]));
    const eind = uls(1 + EINDTOESTAND_COMBO_OFFSET * 30, "1,35G (eindtoestand)", [[1, 1.35]], { eindtoestand: { psi2: 0.3 } });
    const toets = bepaalToetsKrachten2D({
      basis, combinaties: [...ontvouwd, eind], scheefstand: scheef(vast200),
      analysetype: "tweedeOrdeGeometrisch", resultaten: { perCase, combinationResults: resultaten },
    });
    check("met een UGT-eindtoestandvariant: niet hergebruikt", toets.analyse.hergebruikt === false);
    check("met een UGT-eindtoestandvariant: wel toetskrachten, zonder de variant",
      toets.weigering === null && toets.combinationResults.size === 4 && !toets.combinationResults.has(eind.id));
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[7] De toets-φ: projectinstelling, hout volgens EN 1995-1-1 (5.1), waarschuwing bij een te kleine vaste φ");
{
  // a. De beginstand: vast 1/200, staal. Geen melding.
  {
    const t = bepaalToetsScheefstand(vast200, ["en1993"]);
    check("vast 1/200, staal: φ = 1/200, bron vast, geen melding", t.phi === 1 / 200 && t.noemer === 200 && t.bron === "vast" && t.meldingen.length === 0,
      JSON.stringify(t));
  }
  // b. Hout in het model, h = 5 m: EN 1995-1-1 (5.1) φ = 0,005 > 1/300.
  {
    const t = bepaalToetsScheefstand(project({ bron: "vast", noemer: 300 }, ["en1993", "en1995"]), ["en1993", "en1995"]);
    check("hout, vast 1/300, h = 5 m: φ = 0,005 (EN 1995-1-1 (5.1), h ≤ 5 m)", t.phi === 0.005 && t.noemer === 200 && t.bron === "en1995", JSON.stringify(t));
    check("hout: een melding dat de φ is verhoogd", t.meldingen.some((m) => /NEN-EN 1995-1-1 \(5\.1\)/.test(m) && /1\/300/.test(m) && /1\/200/.test(m)), JSON.stringify(t.meldingen));
  }
  // c. Hout, h = 20 m: (5.1) φ = 0,005·√(5/20) = 0,0025 = 1/400 < 1/300 → 1/300 blijft.
  {
    const geo20 = leidScheefstandGeometrieAf(kolom(60000, 20000));
    const t = bepaalToetsScheefstand(project({ bron: "vast", noemer: 300 }, ["en1993", "en1995"], geo20), ["en1993", "en1995"]);
    check("hout, h = 20 m: (5.1) geeft 1/400 < 1/300, dus φ = 1/300 blijft, zonder verhoging", t.phi === 1 / 300 && t.bron === "vast" &&
      !t.meldingen.some((m) => /verhoogd/.test(m)), JSON.stringify(t));
  }
  // d. Normbron EN 1993 met h = 9 m en m = 2 (handmatig): 1/346; hout (5.1): 1/268.
  {
    const p = project({ bron: "en1993", noemer: 200, hoogteM: 9, aantalElementen: 2 }, ["en1993", "en1995"]);
    const hout = 0.005 * Math.sqrt(5 / 9);
    const t = bepaalToetsScheefstand(p, ["en1993", "en1995"]);
    check("EN 1993 1/346 met hout bij h = 9 m: φ = 0,005·√(5/9) = 1/268", binnen(1 / p.phi, 346.4, 0.05) && binnen(t.phi, hout, 1e-9) &&
      t.bron === "en1995", `${1 / p.phi} → ${1 / t.phi}`);
  }
  // e. Ongunstigste met hout: de projectwaarde is al het maximum; geen verhoging.
  {
    const p = project({ bron: "ongunstigste", noemer: 200 }, ["en1993", "en1995"]);
    const t = bepaalToetsScheefstand(p, ["en1993", "en1995"]);
    check("ongunstigste (EN 1993 en 1995): geen verhoging, bron blijft", t.bron === "ongunstigste" &&
      !t.meldingen.some((m) => /verhoogd/.test(m)) && binnen(t.phi, 0.005, 1e-9), JSON.stringify(t));
  }
  // f. Vaste noemer 400 bij een stalen kolom van 5 m: EN 1993-1-1 (5.5) geeft
  //    1/200·(2/√5)·1 = 1/223,6 > 1/400 → waarschuwing.
  {
    const phiNorm = phiVolgensNorm("en1993", 5, 1).phi;
    const t = bepaalToetsScheefstand(project({ bron: "vast", noemer: 400 }), ["en1993"]);
    check("handberekening: EN 1993-1-1 (5.5) bij h = 5 m, m = 1 is 1/223,6", binnen(1 / phiNorm, 223.6, 0.01), `${1 / phiNorm}`);
    check("vast 1/400 < 1/223,6: de toets rekent met 1/400, met een waarschuwing", t.phi === 1 / 400 &&
      t.meldingen.some((m) => /onder de normafleiding/.test(m) && /1\/224/.test(m)), JSON.stringify(t.meldingen));
    const t200 = bepaalToetsScheefstand(vast200, ["en1993"]);
    check("vast 1/200 ≥ 1/223,6: geen waarschuwing", !t200.meldingen.some((m) => /normafleiding/.test(m)));
  }
  // g. Een vlak model (h = 0): geen normafleiding om mee te vergelijken.
  {
    const geoVlak = leidScheefstandGeometrieAf({
      nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }], beams: [{ id: 1, from: 1, to: 2 }],
      supports: [{ nodeId: 1 }, { nodeId: 2 }],
    });
    const t = bepaalToetsScheefstand(project({ bron: "vast", noemer: 400 }, ["en1993"], geoVlak), ["en1993"]);
    check("vlak model, vast 1/400: geen waarschuwing", t.phi === 1 / 400 && t.meldingen.length === 0, JSON.stringify(t.meldingen));
  }
  // h. Via de toetsrekengang: φ uit de projectinstelling, ook met de schakelaar uit,
  //    en de houtmelding over E_mean.
  {
    const p = project({ bron: "vast", noemer: 300 }, ["en1993", "en1995"]);
    const toets = bepaalToetsKrachten2D({
      basis: kolom(60000), combinaties: [ULS1],
      scheefstand: { project: p, normen: ["en1993", "en1995"], richting: 1, modelAan: false },
      analysetype: "eersteOrde",
    });
    check("toetsrekengang met hout, schakelaar uit: φ = 0,005, bron en1995", toets.analyse.phi === 0.005 && toets.analyse.bron === "en1995" &&
      toets.analyse.scheefstandModelAan === false);
    check("toetsrekengang met hout: de melding over E_mean en 2·L", toets.meldingen.some((m) => /E_mean/.test(m) && /2·L/.test(m)), JSON.stringify(toets.meldingen));
    const staal = bepaalToetsKrachten2D({
      basis: kolom(60000), combinaties: [ULS1],
      scheefstand: { project: vast200, normen: ["en1993"], richting: 1, modelAan: false }, analysetype: "eersteOrde",
    });
    check("zonder hout: geen houtmelding", !staal.meldingen.some((m) => /E_mean/.test(m)));
  }
}

// i. Een houten WANDSCHIJF in een stalen model (2D-plaat met houtmateriaal,
//    getoetst volgens EN 1995): de toetsnormen tellen de platen mee, dus geldt
//    ook dan het hout-minimum van (5.1) (B5).
//    HAND: EN 1993-1-1 (5.5), h = 9 m, m = 4: α_h = 2/√9 = 0,667, α_m =
//    √(0,5·(1 + 1/4)) = 0,7906 → φ = 1/200·0,667·0,7906 = 1/379,5.
//    (5.1): φ = 0,005·√(5/9) = 1/268,3 > 1/379,5 → de toets rekent 1/268,3.
{
  const staven = [{ id: 1, from: 1, to: 2, material: "S235", profile: "HEA200" }];
  const normenStaal = toetsScheefstandNormen(staven, []);
  const normenMetSchijf = toetsScheefstandNormen(staven, [{ materiaal: "C24" }]);
  check("toetsnormen: alleen staven → EN 1993; met een houten schijf ook EN 1995",
    JSON.stringify(normenStaal) === JSON.stringify(["en1993"]) && JSON.stringify(normenMetSchijf) === JSON.stringify(["en1993", "en1995"]),
    `${JSON.stringify(normenStaal)} / ${JSON.stringify(normenMetSchijf)}`);
  check("een schijf zonder materiaal of met een onbekend materiaal brengt geen norm mee",
    JSON.stringify(toetsScheefstandNormen(staven, [{}, { materiaal: "onzin" }])) === JSON.stringify(["en1993"]));
  check("een stalen of betonnen schijf: EN 1993 resp. EN 1992",
    JSON.stringify(toetsScheefstandNormen([], [{ materiaal: "S235" }, { materiaal: "C30/37" }])) === JSON.stringify(["en1993", "en1992"]));
  const p = project({ bron: "en1993", noemer: 200, hoogteM: 9, aantalElementen: 4 }, ["en1993"]);
  const t = bepaalToetsScheefstand(p, normenMetSchijf);
  check("handberekening: EN 1993-1-1 (5.5) bij h = 9 m, m = 4 is 1/379,5", binnen(1 / p.phi, 379.5, 0.05), `${1 / p.phi}`);
  check("met de houten schijf: φ verhoogd naar 1/268,3 (EN 1995 (5.1)), met de melding",
    binnen(t.phi, 0.005 * Math.sqrt(5 / 9), 1e-9) && t.bron === "en1995" && t.meldingen.some((m) => /verhoogd naar/.test(m)),
    JSON.stringify(t));
  check("zonder de schijf: φ blijft 1/379,5", bepaalToetsScheefstand(p, normenStaal).phi === p.phi);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[8] Divergentie (α_cr < 1): weigering per combinatie, de resultaten blijven");
{
  // 1,35·G = 1,2·N_cr → α_cr = 1/1,2 = 0,833 (divergeert);
  // 0,9·G = 0,8·N_cr → α_cr = 1,25 (convergeert, langzaam).
  const Gk = (1.2 * N_CR) / 1.35;
  const ULS9 = uls(2, "0,9G", [[1, 0.9]]);
  const basis = kolom(Gk);
  const { perCase } = solveAllCases(basis);
  const resultaten = new Map([ULS1, ULS9].map((c) => [c.id, combineResults(c, perCase)]));
  const voor = JSON.stringify([...resultaten].map(([id, r]) => [id, r.reactions.get(1), r.elements.get(1).N]));
  let toets = null, fout = null;
  try {
    toets = bepaalToetsKrachten2D({
      basis, combinaties: [ULS1, ULS9],
      scheefstand: { project: vast200, normen: ["en1993"], richting: 1, modelAan: false },
      analysetype: "eersteOrde",
      resultaten: { perCase, combinationResults: resultaten },
    });
  } catch (e) { fout = e; }
  check("geen uitzondering", fout === null, String(fout));
  check("een weigering", toets?.weigering != null);
  const per = toets?.weigering?.perCombinatie ?? [];
  check("per combinatie: alleen de twee varianten van 1,35G", per.map((p) => p.id).join(",") === `1,${1 + SCHEEFSTAND_COMBO_OFFSET}`,
    per.map((p) => p.id).join(","));
  check("de reden per combinatie: niet convergent, met α_cr = 0,83", per.every((p) => /niet convergent/.test(p.reden) && /α_cr = 0,83/.test(p.reden)),
    JSON.stringify(per));
  check("de reden van de weigering: geweigerd, geen terugval op eerste orde",
    /geweigerd/.test(toets?.weigering?.reden ?? "") && /niet teruggevallen op eerste orde/.test(toets?.weigering?.reden ?? ""),
    toets?.weigering?.reden);
  check("de toets heeft geen krachten", toets?.combinationResults.size === 0);
  check("α_cr per basiscombinatie: 0,833 en 1,25 binnen 1 %", toets?.alphaCr.length === 2 &&
    binnen(toets.alphaCr[0].alphaCr, 1 / 1.2, 1) && binnen(toets.alphaCr[1].alphaCr, 1.25, 1),
    JSON.stringify(toets?.alphaCr.map((u) => u.alphaCr)));
  const na = JSON.stringify([...resultaten].map(([id, r]) => [id, r.reactions.get(1), r.elements.get(1).N]));
  check("de resultaten blijven ongewijzigd staan", voor === na && resultaten.size === 2 && getSecondOrderState(perCase) === undefined);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[9] Analysetype tweedeOrdeFysisch: de toets is fysisch");
{
  const invoer = {
    basis: kolom(60000), combinaties: [ULS1],
    scheefstand: { project: vast200, normen: ["en1993"], richting: 1, modelAan: false },
  };
  check("tweedeOrdeFysisch → soort tweedeOrdeFysisch",
    bepaalToetsKrachten2D({ ...invoer, analysetype: "tweedeOrdeFysisch" }).analyse.soort === "tweedeOrdeFysisch");
  check("tweedeOrdeGeometrisch → soort tweedeOrdeGeometrisch",
    bepaalToetsKrachten2D({ ...invoer, analysetype: "tweedeOrdeGeometrisch" }).analyse.soort === "tweedeOrdeGeometrisch");
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[10] De toetsset voor de bouwers: UGT uit de toets, BGT uit de resultaten");
{
  // `toetsSet2D` (taak A2): de UGT-combinaties vervangen door hun toetsvarianten
  // (+x, −x), in de volgorde van de resultaatlijst; de BGT (ook de
  // BGT-eindtoestand van hout) zoals de resultaten haar rekenden; de stabiliteit
  // van de toets; en de eerste orde voor de betonkolomtoets: de UGT uit de
  // toetsrekengang, de quasi-blijvende uit de resultaten.
  const basis = kolom(60000);
  const { perCase } = solveAllCases(basis);
  const SLS4 = sls(4, "BGT quasi-blijvend 6.16b", [[1, 1]]);
  const BGT_EIND = sls(4 + EINDTOESTAND_COMBO_OFFSET * BGT_EINDTOESTAND_VEELVOUD, "BGT quasi-blijvend 6.16b (eindtoestand BGT)",
    [[1, 1]], { eindtoestand: { psi2: 1, bgt: true } });
  const UGT_EIND = uls(1 + EINDTOESTAND_COMBO_OFFSET * 100, "1,35G (eindtoestand ψ₂ = 1,00)", [[1, 1.35]], { eindtoestand: { psi2: 1 } });
  const combinaties = [ULS1, UGT_EIND, SLS3, ULS2, SLS4, BGT_EIND];
  const resultaten = new Map([ULS1, SLS3, ULS2, SLS4].map((c) => [c.id, combineResults(c, perCase)]));
  // De eindtoestandvarianten hebben eigen gevallen (`losEindtoestandOp`); hier
  // gaat het alleen om waar ze heen gaan, dus een merkteken als resultaat.
  resultaten.set(UGT_EIND.id, { merkteken: "UGT-eindtoestand" });
  resultaten.set(BGT_EIND.id, { merkteken: "BGT-eindtoestand" });
  const toets = bepaalToetsKrachten2D({
    basis, combinaties,
    scheefstand: { project: vast200, normen: ["en1993"], richting: 1, modelAan: false },
    analysetype: "eersteOrde",
    resultaten: { perCase, combinationResults: resultaten },
  });
  const kolomBalk = [{ id: 1, from: 1, to: 2, checkConfig: { betonKorf: {}, betonKolom: {} } }];
  const set = toetsSet2D(toets, { combinaties, combinationResults: resultaten, perCase }, kolomBalk);
  const T = SCHEEFSTAND_COMBO_OFFSET;
  check("de volgorde van de resultaatlijst, de UGT in +x en −x, zonder UGT-eindtoestand",
    set.combinaties.map((c) => c.id).join(",") === `1,${1 + T},3,2,${2 + T},4,${BGT_EIND.id}`,
    set.combinaties.map((c) => c.id).join(","));
  check("de UGT-krachten zijn die van de toets",
    [1, 1 + T, 2, 2 + T].every((id) => set.combinationResults.get(id) === toets.combinationResults.get(id)));
  check("de BGT-krachten zijn de resultaten zelf, ook de BGT-eindtoestand (B6, B10)",
    [3, 4, BGT_EIND.id].every((id) => set.combinationResults.get(id) === resultaten.get(id)));
  check("geen UGT-eindtoestand in de krachten", !set.combinationResults.has(UGT_EIND.id));
  check("de stabiliteit van de toets: tweede orde, scheefstand aan, de toets-φ, α_cr van de toets",
    set.stabiliteit.analysetype === "tweedeOrdeGeometrisch" && set.stabiliteit.scheefstandAan === true
      && set.stabiliteit.scheefstandPhi === 1 / 200 && set.stabiliteit.alphaCr === toets.alphaCr);
  const eo = set.eersteOrdeResultaten;
  check("de eerste orde voor §5.8: de UGT in ±x en de quasi-blijvende",
    eo && [...eo.keys()].sort((a, b) => a - b).join(",") === `1,2,4,${1 + T},${2 + T}`, eo ? [...eo.keys()].join(",") : "geen");
  // De eerste orde van de toets heeft de scheefstand: H = φ·V = 405 N op de
  // kop, M_I = 405 · 5000 = 2,025 kNm aan de voet (de last staat centrisch).
  check("de UGT-eerste orde komt uit de toetsrekengang: M_voet = φ·V·h = 2,025 kNm",
    binnen(Math.abs(mVoet(eo, 1)), (1 / 200) * 1.35 * 60000 * H_MM, 1e-6), `${mVoet(eo, 1)}`);
  check("de quasi-blijvende uit de resultaten (eerste orde, zonder imperfectie): hetzelfde object",
    eo.get(4) === resultaten.get(4));
  check("zonder betonkolom: geen eerste-orde-kaart (niets extra gerekend)",
    toetsSet2D(toets, { combinaties, combinationResults: resultaten, perCase }, [{ id: 1, from: 1, to: 2 }]).eersteOrdeResultaten === undefined);
  // Hergebruik: dezelfde lijst en dezelfde objecten als de resultaten.
  const aan = metScheefstandRichtingen([ULS1, SLS3], true, 1);
  const pd = solveAllCasesNonlinear({ ...basis, scheefstand: { phi: 1 / 200, richting: 1 } }).perCase;
  const pdRes = new Map(aan.map((c) => [c.id, combineResults(c, pd)]));
  const herToets = bepaalToetsKrachten2D({
    basis, combinaties: aan, analysetype: "tweedeOrdeGeometrisch",
    scheefstand: { project: vast200, normen: ["en1993"], richting: 1, modelAan: true },
    resultaten: { perCase: pd, combinationResults: pdRes },
  });
  const her = toetsSet2D(herToets, { combinaties: aan, combinationResults: pdRes, perCase: pd }, []);
  check("hergebruik: de toetsset is de resultatenlijst, met dezelfde objecten",
    herToets.analyse.hergebruikt && her.combinaties.map((c) => c.id).join(",") === aan.map((c) => c.id).join(",")
      && [...pdRes].every(([id, r]) => her.combinationResults.get(id) === r));
  // Een geweigerde toets heeft geen krachten om samen te voegen.
  let fout = null;
  try {
    toetsSet2D({ ...toets, weigering: { reden: "geweigerd", perCombinatie: [] } }, { combinaties, combinationResults: resultaten, perCase }, []);
  } catch (e) { fout = e; }
  check("een geweigerde toets: een fout, geen halve set", fout instanceof Error && /geweigerd/.test(fout.message), String(fout));
  check("weigeringTekst: de reden en per combinatie een regel",
    weigeringTekst({ reden: "R.", perCombinatie: [{ id: 1, naam: "A", reden: "x" }, { id: 2, naam: "B", reden: "y" }] }) === "R.\n• A: x\n• B: y");
}

log(`\n${"─".repeat(50)}`);
log(`Resultaat: ${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

// De weergave van de toetskrachten (issue #199, taak 7: rapport, UI en i18n).
//
// De UGT-toets rekent altijd tweede orde (P-Δ) met scheefstand; de instellingen
// Analyse en Scheefstand gelden alleen voor de resultaten. Deze test legt vast
// dat het scherm en het rapport dat zeggen — uitgevoerd, niet gelezen:
//
//  [1] App.tsx, `scheefstandTekst` (uit de AST, scripts/bron-uitvoeren.mjs):
//      nooit leeg, ook met de schakelaar uit, en hij zegt dat de toets er
//      altijd mee rekent; tot 2026.42 was hij dan leeg.
//  [2] App.tsx, `analyseTekst`: de resultaten (de gekozen analyse, met of
//      zonder scheefstand) en de toetskrachten (2e orde P-Δ met scheefstand
//      φ = 1/…) elk op een eigen regel — vóór de toets met de φ die de toets zal
//      nemen, daarna met de toets van de ronde (α_cr, meldingen, weigering).
//  [3] het toetsingspaneel (`CheckBlock`, `CheckPanel`): de combinatie bij naam
//      en "2e orde + scheefstand φ = 1/200" bij een UGT-toetscombinatie,
//      "resultaten" bij een BGT-combinatie; de toetsanalyse boven de kaarten.
//  [4] het live rapport (`DerivationBlock`, `CheckTableSection`): hetzelfde;
//      een geweigerde toets met haar reden (B7), en de belastingduur van hout
//      met de combinaties bij naam.
//  [5] de taal: dezelfde regels in het Engels, Duits en Frans;
//  [6] de instellingen (`LoadCaseTabBar`): de φ-velden staan er altijd, ook met
//      de schakelaar Scheefstand uit (B4), en Analyse en Scheefstand zeggen dat
//      zij voor de resultaten gelden.
//
// Uitvoeren: npx tsx test-toetskrachten-weergave.mjs   (vanuit design-mockup/)

import { declaratie, leesBron, voerUitIn } from "./scripts/bron-uitvoeren.mjs";

const { zetTaal } = await import("./scripts/i18n-voor-tests.mjs");
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const { bepaalScheefstand, leidScheefstandGeometrieAf } = await import("./src/lib/scheefstandNorm.ts");
const { useCheckStore } = await import("./src/stores/checkStore.ts");
const CheckBlock = (await import("./src/components/panels/CheckBlock.tsx")).default;
const CheckPanel = (await import("./src/components/panels/CheckPanel.tsx")).default;
const { DerivationBlock } = await import("./src/components/report/sections/CheckDetailSection.tsx");
const CheckTableSection = (await import("./src/components/report/sections/CheckTableSection.tsx")).default;
const LoadCaseTabBar = (await import("./src/components/fem/LoadCaseTabBar.tsx")).default;

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function check(naam, voorwaarde, detail = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}`); }
  else            { failed++; log(`  ✗ ${naam}${detail ? ` — ${detail}` : ""}`); }
}
/** HTML zonder opmaak, met één spatie tussen de woorden. */
const tekst = (html) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&quot;/g, "\"").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

// Een portaal met een kolom: genoeg voor de afleiding van h en m.
const MODEL = {
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: 4000 }, { id: 3, x: 6000, z: 4000 }, { id: 4, x: 6000, z: 0 }],
  beams: [
    { id: 1, from: 1, to: 2, material: "S235", profile: "HEA200" },
    { id: 2, from: 2, to: 3, material: "S235", profile: "IPE300" },
    { id: 3, from: 4, to: 3, material: "S235", profile: "HEA200" },
  ],
  supports: [{ id: 1, nodeId: 1, type: "fixed" }, { id: 2, nodeId: 4, type: "fixed" }],
};
const geometrie = leidScheefstandGeometrieAf(MODEL);
const project = bepaalScheefstand({ bron: "vast", noemer: 200, hoogteM: null, aantalElementen: null }, geometrie, ["en1993"]);

const app = leesBron("src/App.tsx");

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] App.tsx: de scheefstandtekst is nooit leeg");
{
  const maak = async (aan) => (await voerUitIn(app, declaratie(app, "scheefstandTekst"), {
    fem: { scheefstandEnabled: aan, beams: MODEL.beams },
    scheefstandUitkomst: project, scheefstandGeometrie: geometrie,
  }))();
  const uit = await maak(false);
  const aan = await maak(true);
  // GEWIJZIGD door issue #199: tot 2026.42 was deze tekst met de schakelaar uit
  // leeg ("er zit geen scheefstand in een toetskracht"). De toets rekent nu
  // altijd met φ, dus het rapport noemt haar altijd.
  check("met de schakelaar uit: niet leeg, met de vaste noemer en +x én −x", uit.trim() !== ""
    && /vaste noemer/.test(uit) && /\+x én in −x/.test(uit), uit);
  check("… en zegt dat de UGT-toets er altijd mee rekent, ook met de schakelaar uit",
    /De UGT-toets rekent elke combinatie/.test(uit) && /ook als de schakelaar Scheefstand uit staat/.test(uit), uit);
  check("aan en uit: dezelfde tekst (de schakelaar geldt alleen voor de resultaten)", aan === uit);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] App.tsx: de analysetoelichting noemt resultaten en toetskrachten");
{
  const alphaResultaten = [{ combinatieId: 2, naam: "UGT 6.10a", alphaCr: 4.2, status: "bepaald" }];
  const maak = async (toetsVanRonde, fem = {}) => (await voerUitIn(app, declaratie(app, "analyseTekst"), {
    fem: {
      // `combinationResults`: er is gerekend (de tekst hangt daaraan, niet meer
      // aan α_cr van de resultaten, die `rekenDoor` alleen nog bepaalt als de
      // toets er geen opleverde).
      combinationResults: new Map(), plates: [],
      stabiliteit: alphaResultaten, analysetype: "eersteOrde", scheefstandEnabled: false,
      eindstijfheid: { meldingen: [] }, beams: MODEL.beams, ...fem,
    },
    scheefstandUitkomst: project, toetsVanRonde,
  }))();
  const voor = await maak(null);
  const regels = voor.split("\n");
  check("regel 1: de resultaten — 1e orde, zonder scheefstand", /^Resultaten: 1e orde, zonder scheefstand\./.test(regels[0]), regels[0]);
  check("regel 2: de toetskrachten — 2e orde (P-Δ) met scheefstand φ = 1/200 (vaste noemer), al vóór de toetsronde",
    /^Toetskrachten \(UGT\): 2e orde \(P-Δ\) met scheefstand φ = 1\/200 \(vaste noemer\)/.test(regels[1]), regels[1]);
  check("α_cr van de resultaten zolang er geen toets is; informatief, geen '!'-regel (B14)",
    /α_cr = 4,20   \[UGT 6\.10a\]/.test(voor) && !/^!/m.test(voor) && !/NIET TOEGESTAAN/.test(voor), voor);
  check("leeg zolang er niet gerekend is", (await maak(null, { stabiliteit: null, combinationResults: null })) === "");

  const toets = {
    analyse: { soort: "tweedeOrdeGeometrisch", phi: 1 / 250, noemer: 250, bron: "en1993", scheefstandModelAan: false, hergebruikt: false },
    meldingen: ["Hout in de toets: test."],
    alphaCr: [{ combinatieId: 2, naam: "UGT 6.10a (scheefstand +x)", alphaCr: 4.3, status: "bepaald" }],
    weigering: null,
  };
  const na = await maak(toets, { eindstijfheid: { meldingen: [{ tekst: "Eindstijfheid: test." }] } });
  check("met de toets van de ronde: haar φ en bron, α_cr van de toets",
    /^Toetskrachten \(UGT\): 2e orde \(P-Δ\) met scheefstand φ = 1\/250 \(EN 1993-1-1 \(5\.5\)\)/m.test(na)
      && /α_cr = 4,30   \[UGT 6\.10a \(scheefstand \+x\)\]/.test(na), na);
  check("… met de eindstijfheid en de meldingen van de toets als '!'-regels",
    /^! Eindstijfheid: test\./m.test(na) && /^! Hout in de toets: test\./m.test(na), na);
  // De gewone rekengang: α_cr van de resultaten is niet bepaald (dat doet de
  // toets), de tekst staat er toch, met α_cr van de toets.
  const lui = await maak(toets, { stabiliteit: null });
  check("zonder α_cr van de resultaten (de toets bepaalde hem): de tekst met α_cr van de toets",
    /α_cr = 4,30   \[UGT 6\.10a \(scheefstand \+x\)\]/.test(lui), lui);
  const geweigerd = await maak({ ...toets, weigering: "De toetskrachten zijn niet te bepalen: test." });
  check("een geweigerde toets: '! TOETSING GEWEIGERD' met de reden (B7)",
    /^! TOETSING GEWEIGERD: De toetskrachten zijn niet te bepalen: test\./m.test(geweigerd), geweigerd);
  const pd = await maak(null, { analysetype: "tweedeOrdeGeometrisch", scheefstandEnabled: true });
  check("resultaten P-Δ met de schakelaar aan: 'met scheefstand φ = 1/200'",
    /^Resultaten: 2e orde \(P-Δ\), met scheefstand φ = 1\/200\./.test(pd), pd.split("\n")[0]);
}

// ── Een toetsronde in de store ────────────────────────────────────────────
const kracht = (id, combinatie) => ({
  id, title: `Toets ${id}`, article: "EN 1993-1-1 6.2.4 (6.9)",
  force_state: { combination_id: combinatie, position_mm: 0, forces: { n_ed: -100, vy_ed: 0, vz_ed: 5, mt_ed: 0, my_ed: 20, mz_ed: 0 } },
  formula_latex: "N_{c,Rd} = A f_y / \\gamma_{M0}", variables: [], value: 1000, unit: "kN",
  uc: { ed: 100, rd: 1000, uc: 0.1, formula_latex: "UC" }, status: "Ok", notes: [], deelstappen: [],
});
const TOETS = {
  analyse: { soort: "tweedeOrdeGeometrisch", phi: 1 / 200, noemer: 200, bron: "vast", scheefstandModelAan: false, hergebruikt: false },
  meldingen: ["Vervallen in de toets: test."],
  alphaCr: [],
  weigering: null,
};
const COMBINATIES = [
  { id: 7, name: "UGT 6.10b (scheefstand +x)", tweedeOrde: true },
  { id: 1_000_007, name: "UGT 6.10b (scheefstand −x)", tweedeOrde: true },
  { id: 17, name: "BGT karakteristiek", tweedeOrde: false },
];
// renderToStaticMarkup leest een zustand-store via de SERVERmomentopname, en
// dat is de begintoestand (`getInitialState`), niet `getState`. Voor deze
// weergave zetten we de toestand daarom op beide.
const zet = (staat) => {
  const vol = { toetsCombinaties: [], toets: null, results: [], lastRunAt: null, ...staat };
  useCheckStore.setState(vol);
  Object.assign(useCheckStore.getInitialState(), vol);
};

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] Het toetsingspaneel: de herkomst bij elke toetskracht");
{
  zet({ toetsCombinaties: COMBINATIES, toets: TOETS });
  const ugt = tekst(renderToStaticMarkup(React.createElement(CheckBlock, { check: kracht("a", 1_000_007) })));
  check("UGT in −x: de naam van de toetscombinatie, geen kaal id", /Combinatie UGT 6\.10b \(scheefstand −x\)/.test(ugt) && !/1000007/.test(ugt), ugt.slice(0, 200));
  check("… met '2e orde + scheefstand φ = 1/200'", /· 2e orde \+ scheefstand φ = 1\/200/.test(ugt), ugt.slice(0, 200));
  const bgt = tekst(renderToStaticMarkup(React.createElement(CheckBlock, { check: kracht("b", 17) })));
  check("BGT: 'resultaten' (B6)", /Combinatie BGT karakteristiek · resultaten/.test(bgt) && !/scheefstand φ/.test(bgt), bgt.slice(0, 200));
  zet({ toetsCombinaties: COMBINATIES.map(({ id, name }) => ({ id, name })), toets: null });
  const oud = tekst(renderToStaticMarkup(React.createElement(CheckBlock, { check: kracht("c", 7) })));
  check("zonder herkomst (een ouder snapshot): de naam, geen label", /Combinatie UGT 6\.10b \(scheefstand \+x\)/.test(oud) && !/2e orde|resultaten/.test(oud), oud.slice(0, 200));

  zet({ toetsCombinaties: COMBINATIES, toets: TOETS });
  const paneel = tekst(renderToStaticMarkup(React.createElement(CheckPanel, {})));
  check("het paneel noemt de toetskrachten: 2e orde (P-Δ) met scheefstand φ = 1/200 (vaste noemer), los van de instellingen",
    /Toetskrachten UGT: 2e orde \(P-Δ\) met scheefstand φ = 1\/200 \(vaste noemer\), altijd, los van de instellingen Analyse en Scheefstand\./.test(paneel), paneel.slice(0, 400));
  check("… met de meldingen van de toets", /Meldingen bij de toetskrachten \(1\)/.test(paneel) && /Vervallen in de toets: test\./.test(paneel));
  zet({ toets: { ...TOETS, analyse: { ...TOETS.analyse, hergebruikt: true } } });
  check("… en bij hergebruik dat de toets niets extra rekende",
    /de toets rekende niets extra/.test(tekst(renderToStaticMarkup(React.createElement(CheckPanel, {})))));
  zet({});
  check("zonder toets geen regel over de toetskrachten", !/Toetskrachten UGT/.test(tekst(renderToStaticMarkup(React.createElement(CheckPanel, {})))));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] Het live rapport: dezelfde herkomst");
{
  zet({ toetsCombinaties: COMBINATIES, toets: TOETS });
  const blok = (combinatie) => tekst(renderToStaticMarkup(React.createElement(DerivationBlock, {
    check: kracht("d", combinatie), governing: false, metTussenwaarden: false,
  })));
  const ugt = blok(1_000_007);
  check("UGT in −x: de naam en '(2e orde + scheefstand φ = 1/200)'",
    /Combinatie UGT 6\.10b \(scheefstand −x\) \(2e orde \+ scheefstand φ = 1\/200\)/.test(ugt), ugt.slice(0, 200));
  check("BGT: '(resultaten)'", /Combinatie BGT karakteristiek \(resultaten\)/.test(blok(17)), blok(17).slice(0, 200));

  const staaf = {
    beam_id: 1, profile_name: "HEA200", steel_grade: "S235", classification: "Class1",
    checks: [{ id: "a", kind: { type: "Resistance", data: kracht("a", 7) } }],
    uc_max: 0.1, status: "Ok", governing_check_id: "a",
  };
  zet({ toetsCombinaties: COMBINATIES, toets: TOETS, results: [staaf], lastRunAt: Date.now() });
  const tabel = tekst(renderToStaticMarkup(React.createElement(CheckTableSection)));
  check("het toetsingsoverzicht noemt de toetskrachten onder de toetsbasis",
    /Toetskrachten UGT: 2e orde \(P-Δ\) met scheefstand φ = 1\/200 \(vaste noemer\)/.test(tabel), tabel.slice(-600));
  zet({ results: [staaf], lastRunAt: Date.now() });
  check("… zonder toetsanalyse niet", !/Toetskrachten UGT/.test(tekst(renderToStaticMarkup(React.createElement(CheckTableSection)))));

  // GEWEIGERD (B7): de store wist de uitslag (results = [], lastRunAt = null)
  // en bewaart de toets met de reden. Het overzicht hoort dat te zeggen, niet
  // "Nog niet getoetst — voer de normtoetsing uit".
  zet({
    toetsCombinaties: [], results: [], skipped: [], lastRunAt: null,
    toets: { ...TOETS, weigering: "De toetskrachten zijn niet te bepalen: test.\n• UGT 6.10b: divergeert" },
  });
  const geweigerd = tekst(renderToStaticMarkup(React.createElement(CheckTableSection)));
  check("geweigerde toets: 'Toetsing geweigerd' met de reden per combinatie, niet 'Nog niet getoetst'",
    /Toetsing geweigerd/.test(geweigerd) && /De toetskrachten zijn niet te bepalen: test\./.test(geweigerd)
      && /• UGT 6\.10b: divergeert/.test(geweigerd) && !/Nog niet getoetst/.test(geweigerd), geweigerd.slice(0, 400));
  check("… met de toetskrachtenalinea erbij (welke berekening faalde)", /Toetskrachten UGT: 2e orde/.test(geweigerd), geweigerd.slice(0, 600));
  zet({ toets: null, results: [], lastRunAt: null });
  check("zonder toets en zonder ronde blijft het 'Nog niet getoetst'",
    /Nog niet getoetst/.test(tekst(renderToStaticMarkup(React.createElement(CheckTableSection)))));

  // De belastingduur van hout noemt de combinaties bij naam: de −x-variant
  // (id + 1 000 000) staat in geen lijst van het model.
  const { belastingduurTekst, toetsCombinatieNamen } = await import("./src/components/report/checkReportUtils.ts");
  const namen = toetsCombinatieNamen([], COMBINATIES);
  const tt = (_k, d) => (typeof d === "string" ? d : _k);
  const duur = belastingduurTekst({
    load_duration: "ShortTerm",
    k_mod_per_load_duration: [{ load_duration: "ShortTerm", k_mod: 0.9, combination_ids: [7, 1_000_007] }],
    governing_combination_id: 1_000_007,
  }, tt, tt, (id) => namen.get(id) ?? String(id));
  check("belastingduur: de combinaties bij naam, geen 'comb. 1000007'",
    /UGT 6\.10b \(scheefstand −x\)/.test(duur) && !/1000007/.test(duur), duur);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[5] De taal: hetzelfde in het Engels, Duits en Frans");
{
  const VERWACHT = {
    en: [/2nd order \+ sway φ = 1\/200/, /ULS check forces: 2nd order \(P-Δ\) with sway imperfection φ = 1\/200 \(fixed denominator\)/],
    de: [/Th\. II\. O\. \+ Schiefstellung φ = 1\/200/, /GZT-Nachweisschnittgrößen: Theorie II\. Ordnung \(P-Δ\) mit Schiefstellung φ = 1\/200 \(fester Nenner\)/],
    fr: [/2nd ordre \+ défaut d'aplomb φ = 1\/200/, /Efforts de vérification ELU : Second ordre \(P-Δ\) avec défaut d'aplomb φ = 1\/200 \(dénominateur fixe\)/],
  };
  for (const taal of ["en", "de", "fr"]) {
    await zetTaal(taal);
    zet({ toetsCombinaties: COMBINATIES, toets: TOETS });
    const blok = tekst(renderToStaticMarkup(React.createElement(CheckBlock, { check: kracht("e", 7) })));
    const paneel = tekst(renderToStaticMarkup(React.createElement(CheckPanel, {})));
    check(`${taal}: het label bij de toetskracht`, VERWACHT[taal][0].test(blok), blok.slice(0, 200));
    check(`${taal}: de regel over de toetskrachten in het paneel`, VERWACHT[taal][1].test(paneel), paneel.slice(0, 300));
  }
  await zetTaal("nl");
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[6] De instellingen: de φ-velden altijd zichtbaar");
{
  const noop = () => {};
  const balk = (props) => renderToStaticMarkup(React.createElement(LoadCaseTabBar, {
    loadCases: [{ id: 1, name: "G", type: "dead" }], activeLoadCaseId: 1, setActiveLoadCaseId: noop,
    addLoadCase: noop, loads: [],
    analysetype: "eersteOrde", setAnalysetype: noop,
    setScheefstandEnabled: noop, setScheefstandNoemer: noop, setScheefstandBron: noop,
    setScheefstandHoogteM: noop, setScheefstandAantalElementen: noop,
    scheefstandNoemer: 200, scheefstandRichting: 1, scheefstandPhiNoemer: 200,
    scheefstandAfgeleideHoogteM: 4, scheefstandAfgeleidAantal: 2,
    ...props,
  }));
  // GEWIJZIGD door issue #199 (B4): tot 2026.42 verdwenen de φ-velden zodra
  // de schakelaar uit stond, terwijl de toets die φ nu altijd gebruikt.
  const uitVast = tekst(balk({ scheefstandEnabled: false, scheefstandBron: "vast" }));
  check("schakelaar uit, vaste noemer: 'φ uit', 'φ = 1/' en de richting ±x staan er",
    /φ uit/.test(uitVast) && /φ = 1\//.test(uitVast) && /±x/.test(uitVast), uitVast);
  const uitNorm = balk({ scheefstandEnabled: false, scheefstandBron: "en1993" });
  check("schakelaar uit, normbron: h en m staan er (met de uitkomst φ = 1/200)",
    /h =/.test(tekst(uitNorm)) && /φ = 1\/200/.test(tekst(uitNorm)) && (uitNorm.match(/lc-tab-phi-input/g) ?? []).length >= 2, tekst(uitNorm));
  const aan = tekst(balk({ scheefstandEnabled: true, scheefstandBron: "vast" }));
  check("met de schakelaar aan: dezelfde velden (alleen het vinkje verschilt)", aan === uitVast);
  const html = balk({ scheefstandEnabled: false, scheefstandBron: "vast" }).replace(/&quot;/g, "\"").replace(/&#x27;/g, "'");
  check("de tooltip van Analyse: de keuze geldt voor de resultaten, de UGT-toets rekent altijd tweede orde met scheefstand",
    /De UGT-toets rekent altijd zelf tweede orde \(P-Δ\) met scheefstand/.test(html), html.slice(0, 300));
  check("de tooltip van Scheefstand: in de resultaten; de UGT-toets rekent altijd met deze scheefstand",
    /in de resultaten meenemen/.test(html) && /De UGT-toets rekent altijd met deze scheefstand, ook als dit vinkje uit staat/.test(html));
}

zet({});
log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed === 0 ? 0 : 1);

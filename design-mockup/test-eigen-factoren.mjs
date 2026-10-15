// Eigen factoren, bewust gekozen (issue #196, punt "Message on opening").
//
// WAAROM DEZE TEST BESTAAT
// Een project met bewust gekozen combinatiefactoren (1,22 / 1,08, de
// referentieprojecten P01, P03 en P04) kreeg bij het openen de melding dat het
// patroon "ontstaat in een projectbestand van vóór september 2026" en dat de
// last "met de verkeerde factoren" telt. Dat stond er zonder enige voorwaarde,
// ook bij een bestand uit deze versie (met id-tellers, zonder wees-factoren en
// zonder oude kolom). De melding noemde niet wat de NB geeft, herkende de
// consequente schaal K_FI = 0,9 maal NB.4 niet, en er was geen manier om de
// factoren bewust te houden: een blijvende FOUT in de projectboom, het venster
// en het rapport, en MCP validate gaf ok:false.
//
// WAT HIER VASTLIGT
//  [1] P01, P03 en P04 geopend onder CC1, CC2 en CC3 (de klasse is bij het
//      openen een terugval naar het vorige project): geen "september 2026",
//      geen "verkeerde factoren", wel per factor de schaal en de NB-waarde
//      (1,22 ≈ 0,9 × 1,35 = 1,215; NB.5 CC1 geeft 1,2 — 1,08 = 0,9 × 1,2;
//      NB.5 CC1 geeft 1,1) en de consequente schaal over G én Q
//      (0,54 = 0,9 · 1,5 · 0,4 en 1,35 = 0,9 · 1,5). De tekst hangt niet van
//      de klasse af.
//  [2] een nieuw project uit deze versie met consequent 1,22 / 1,08 op de
//      blijvende gevallen (de proef van de vaststelling): geen "september
//      2026", en na "Behoud eigen factoren" geen FOUT meer — ook niet "N
//      standaardcombinatie(s) ontbreken" — ook na opslaan en heropenen.
//  [3] de bevestiging hoort bij de exacte waarde: 1,22 → 1,25 brengt de FOUT
//      terug voor die factor; hernoemen houdt haar, een ander type niet.
//  [4] een echt spoor blijft gemeld: wees-factoren in hetzelfde bestand en de
//      kolom van de oude standaardset worden genoemd, maar zonder datum (uit
//      de factoren is de leeftijd niet af te leiden, PR #126); een andere
//      factor dan een ander blijvend geval geeft een neutrale herkomst. De oude standaardset
//      wordt nooit bevestigd.
//  [5] de MCP-weg: validate ok:false zonder en ok:true met bevestiging, de
//      bevestiging reist mee door load_project en terug.
//  [6] de API: project.combinations.confirmOwnFactors en revokeOwnFactors.
//  [7] de rekenwaarde verandert niet: de bevestiging is geen factor.
//
// Draaien met: npx tsx test-eigen-factoren.mjs
//         of: node scripts/run-tests.mjs --filter=eigen-factoren   (ook --bundel)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));

const B = await import("./src/lib/combinatieBeheer.ts");
const { standaardBelastinggevallen } = await import("./src/lib/eigenGewicht.ts");
const {
  serializeProject, deserializeProject, combinationsToFile, combinationsFromFile,
} = await import("./src/io/projectFile.ts");
const { verwerkVerzoek } = await import("./src/mcp/sidecar.ts");
const { maakRegister } = await import("./src/api/register.ts");
const { documentUitTekst } = await import("./src/api/projectDocument.ts");
const { PROJECT_COMMANDOS } = await import("./src/api/commands/project.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); }
  else { gefaald++; console.log(`  ✗ ${naam}${detail ? `\n      ${String(detail).slice(0, 1500)}` : ""}`); }
};

const SEPT = /september 2026/;
const lees = (naam) => readFileSync(join(HIER, "referentie-projecten", `${naam}.femp`), "utf8");

/** Openen zoals de app (loadProjectState): klasse uit bestand, kenmerk of terugval. */
function openTekst(tekst, terugval) {
  const p = deserializeProject(tekst);
  const combinations = combinationsFromFile(p.combinations);
  const { klasse } = B.gevolgklasseBijOpenen({
    bestand: p.projectInfo?.uitgangspunten?.gevolgklasse ?? null, combinations, terugval,
  });
  const bijlage = B.bijlageUitKenmerk(combinations) ?? "NL";
  const o = B.openCombinatieStaat({
    loadCases: p.loadCases, combinations, gevolgklasse: klasse, bijlage, idTellers: p.idTellers,
  });
  return { ...o, p, klasse, bijlage, combinations };
}

/** De meldingen na elke wijziging, zoals de store ze maakt. */
const meldingen = (staat, loads, selfWeightEnabled = false) => B.meldingenBelastinggevallen({
  loadCases: staat.loadCases, combinations: staat.combinations, alleCombinaties: staat.combinations,
  gevolgklasse: staat.gevolgklasse, bijlage: staat.bijlage, loads, selfWeightEnabled,
});
const fouten = (m) => m.filter((x) => x.niveau === "fout");
const alleTekst = (o, m) => [o.afwijking?.samenvatting ?? "", ...m.map((x) => x.tekst)].join(" | ");

/** Opslaan zoals de app (combinationsToFile + idTellers) en weer openen. */
function opslaanEnOpenen(staat, p, terugval = "CC2") {
  const tekst = serializeProject({
    nodes: p.nodes ?? [], beams: p.beams ?? [], supports: p.supports ?? [], plates: p.plates ?? [],
    loads: p.loads ?? [], loadCases: staat.loadCases, activeLoadCaseId: staat.loadCases[0].id,
    selfWeightEnabled: p.selfWeightEnabled ?? false,
    combinations: combinationsToFile(staat.combinations),
    idTellers: { belastinggeval: staat.volgendGevalId, combinatie: staat.volgendCombinatieId },
  });
  return { tekst, ...openTekst(tekst, terugval) };
}

const factorenVan = (l) => JSON.stringify(l.map((c) => [c.id, [...c.factors].sort((a, b) => a[0] - b[0])]));

// ─────────────────────────────────────────────────────────────────────────
console.log("[1] P01, P03 en P04 onder CC1, CC2 en CC3");
for (const naam of ["P01", "P03", "P04"]) {
  const tekst = lees(naam);
  const teksten = new Set();
  for (const k of ["CC1", "CC2", "CC3"]) {
    const o = openTekst(tekst, k);
    const m = meldingen(o.staat, o.p.loads, o.p.selfWeightEnabled);
    const alles = alleTekst(o, m);
    const s = o.afwijking?.samenvatting ?? "";
    teksten.add(s);
    check(`${naam} ${k}: geopend met klasse ${k} (terugval), niets vervangen, factoren ongewijzigd`,
      o.klasse === k && o.vervanging === null && factorenVan(o.staat.combinations) === factorenVan(o.combinations));
    check(`${naam} ${k}: geen "september 2026" en geen "verkeerde factoren" in melding of meldingen`,
      !SEPT.test(alles) && !/verkeerde factoren/.test(alles), alles);
    check(`${naam} ${k}: de melding noemt 1,22 ≈ 0,9 × 1,35 (K_FI CC1 op NB.4) en dat NB.5 CC1 1,2 geeft`,
      /1,22 ≈ 0,9 × 1,35 \(K_FI CC1 op NB\.4[^)]*; NB\.5 CC1 geeft 1,2\)/.test(s), s);
    check(`${naam} ${k}: en 1,08 = 0,9 × 1,2 (K_FI CC1 op NB.4), NB.5 CC1 geeft 1,1`,
      /1,08 = 0,9 × 1,2 \(K_FI CC1 op NB\.4[^)]*; NB\.5 CC1 geeft 1,1\)/.test(s), s);
    check(`${naam} ${k}: de set is herkend als consequent K_FI = 0,9 maal NB.4, voor G én Q`,
      /consequent K_FI = 0,9 \(CC1\) maal NB\.4, voor G én Q/.test(s), s);
    check(`${naam} ${k}: zonder bevestiging een FOUT op geval 1, met het aanbod om de factoren te houden`,
      fouten(m).length === 1 && fouten(m)[0].caseId === 1 && fouten(m)[0].bevestigAdvies === true
        && o.afwijking?.bevestigbaar === true && /Behoud eigen factoren/.test(s),
      JSON.stringify(fouten(m).map((x) => [x.caseId, x.bevestigAdvies])));
  }
  check(`${naam}: de melding is gelijk onder CC1, CC2 en CC3 (hangt niet van de terugvalklasse af)`, teksten.size === 1);
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n[2] een nieuw project uit deze versie met consequent 1,22 / 1,08 op G");
// Zelfde opzet als de proef van de vaststelling (controle-65-consequent.mts):
// de standaardgevallen, CC2, en in elke UGT-combinatie 1,35 → 1,22 en
// 1,2 → 1,08 op de twee blijvende gevallen. γ_G,inf = 0,9 blijft staan.
let nieuw = B.openCombinatieStaat({ loadCases: standaardBelastinggevallen(), gevolgklasse: "CC2" }).staat;
const blijvend = nieuw.loadCases.filter((c) => c.type === "dead").map((c) => c.id);
for (const c of nieuw.combinations) {
  if (c.type !== "uls") continue;
  const f = new Map(c.factors);
  for (const id of blijvend) {
    const fo = c.factors.get(id) ?? 0;
    if (fo === 1.35) f.set(id, 1.22);
    else if (fo === 1.2) f.set(id, 1.08);
  }
  nieuw = B.wijzigCombinatie(nieuw, c.id, { factors: f });
}
const lastenNieuw = [{ id: 1, type: "lineLoad", beamId: 1, caseId: 1, q: -5 }];
const pNieuw = { loads: lastenNieuw, selfWeightEnabled: true };
{
  const o = opslaanEnOpenen(nieuw, pNieuw);
  check("(opzet) het bestand draagt id-tellers, niets vervangen, geen wees-factoren",
    o.p.idTellers !== undefined && o.vervanging === null && (o.afwijking?.weesFactoren.length ?? 0) === 0);
  const m = meldingen(o.staat, lastenNieuw, true);
  const alles = alleTekst(o, m);
  check("geen \"september 2026\" bij een bestand uit deze versie", !SEPT.test(alles), alles);
  check("de FOUT op beide blijvende gevallen noemt de schaal: 1,22 ≈ 0,9 × 1,35",
    [5, 1].every((id) => fouten(m).some((x) => x.caseId === id && /1,22 ≈ 0,9 × 1,35/.test(x.tekst) && x.bevestigAdvies)),
    alles);
  check("G is 0,9 maal NB.4 en Q is NB.4 zelf: dat staat er, als niet consequent",
    /G-factoren zijn K_FI = 0,9 \(CC1\) maal NB\.4, de Q-factoren zijn NB\.4 zelf/.test(alles), alles);
  const ontbreekt = fouten(m).find((x) => x.caseId === null);
  check("de afgeleide set mist standaardcombinaties (CC2), en het houden van de eigen factoren lost dat op",
    /standaardcombinatie\(s\) ontbreken/.test(ontbreekt?.tekst ?? "") && ontbreekt?.bevestigAdvies === true,
    ontbreekt?.tekst);

  // De opzet wijzigde elke UGT-combinatie (ook de vijf met γ_G,inf = 0,9, die
  // daardoor zonder kenmerk maar met dezelfde factoren staan): twaalf eigen
  // combinaties, de BGT-combinaties bleven standaard.
  const { staat: bevestigd, bevestigd: ids } = B.bevestigEigenFactoren(o.staat);
  const eigenIds = o.staat.combinations.filter((c) => !c.standaard).map((c) => c.id);
  check("Behoud eigen factoren bevestigt de twaalf eigen UGT-combinaties, niet de standaardcombinaties",
    eigenIds.length === 12 && JSON.stringify(ids) === JSON.stringify(eigenIds)
      && bevestigd.combinations.every((c) => (c.bevestigdeFactoren !== undefined) === !c.standaard), JSON.stringify(ids));
  check("de factoren zelf veranderen niet", factorenVan(bevestigd.combinations) === factorenVan(o.staat.combinations));
  const mb = meldingen(bevestigd, lastenNieuw, true);
  check("na bevestigen geen FOUT meer (ook niet \"standaardcombinaties ontbreken\")", fouten(mb).length === 0,
    fouten(mb).map((x) => x.tekst).join(" | "));
  const her = opslaanEnOpenen(bevestigd, pNieuw);
  check("het bestand bewaart de bevestiging (bevestigdeFactoren)", /"bevestigdeFactoren"/.test(her.tekst));
  check("na opslaan en heropenen: geen melding bij openen en geen FOUT",
    her.afwijking === null && fouten(meldingen(her.staat, lastenNieuw, true)).length === 0,
    her.afwijking?.samenvatting);
  check("de gelezen bevestiging is precies wat er bevestigd was",
    JSON.stringify(her.staat.combinations.map((c) => c.bevestigdeFactoren ?? null))
      === JSON.stringify(bevestigd.combinations.map((c) => c.bevestigdeFactoren ?? null)));
  // Een nieuw veranderlijk geval: de standaardset krijgt nieuwe opstellingen,
  // en de bevestigde eigen combinaties dekken die niet.
  const metQ2 = B.voegBelastinggevalToe(her.staat, "Q vloer 2", "live").staat;
  check("een nieuw veranderlijk geval: de bevestiging dekt de nieuwe opstellingen niet (FOUT: ontbreken)",
    fouten(meldingen(metQ2, lastenNieuw, true)).some((x) => x.caseId === null && /ontbreken/.test(x.tekst)));
  // Een andere gevolgklasse: de standaardformules dragen dan andere factoren
  // (CC3: 1,5·G …), en een set die onder CC2 bewust op K_FI = 0,9 is gezet,
  // dekt die niet stil.
  const cc3 = B.zetGevolgklasse(her.staat, "CC3");
  check("na een andere gevolgklasse (CC3) vervangen de bevestigde CC2-afgeleiden de standaardset niet meer (FOUT: ontbreken)",
    fouten(meldingen(cc3, lastenNieuw, true)).some((x) => x.caseId === null && /ontbreken/.test(x.tekst)));
  // Een bevestigde combinatie weg: haar opstelling ontbreekt weer.
  const zonder = B.verwijderCombinatie(her.staat, ids[0]);
  check("een bevestigde combinatie verwijderen: haar opstelling ontbreekt weer (FOUT)",
    fouten(meldingen(zonder, lastenNieuw, true)).some((x) => x.caseId === null && /ontbreken/.test(x.tekst)));
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n[3] de bevestiging hoort bij de exacte waarde");
{
  const o = openTekst(lees("P01"), "CC2");
  const { staat } = B.bevestigEigenFactoren(o.staat);
  check("P01 bevestigd: geen FOUT, geen melding bij heropenen",
    fouten(meldingen(staat, o.p.loads)).length === 0
      && B.beoordeelCombinatiesBijOpenen({ combinations: staat.combinations, loadCases: staat.loadCases }) === null);
  check("P01 bevestigd: de bevestiging noemt elke factor ≠ 0 van elke eigen combinatie",
    JSON.stringify(staat.combinations[0].bevestigdeFactoren) === JSON.stringify({ 1: 1.22, 2: 0.54 }),
    JSON.stringify(staat.combinations[0].bevestigdeFactoren));
  const c1 = staat.combinations.find((c) => c.name === "UGT 6.10a");
  const anders = B.wijzigCombinatie(staat, c1.id, { factors: new Map([[1, 1.25], [2, 0.54]]) });
  const ma = meldingen(anders, o.p.loads);
  const f = fouten(ma).find((x) => x.caseId === 1);
  check("1,22 → 1,25: de FOUT komt terug, met 1,25 als eigen factor die niet uit NB.4/NB.5 komt",
    f !== undefined && /"UGT 6\.10a" 1,25 \(eigen factor, niet uit NB\.4\/NB\.5/.test(f.tekst), f?.tekst);
  check("en noemt wat de NB in 6.10a geeft: 1,2 (CC1), 1,35 (CC2), 1,5 (CC3)",
    /γ_G,sup in 6\.10a: 1,2 \(CC1\), 1,35 \(CC2\), 1,5 \(CC3\)/.test(f?.tekst ?? ""), f?.tekst);
  check("de nog bevestigde 1,08 in 6.10b staat er niet in", !/"UGT 6\.10b"/.test(f?.tekst ?? ""), f?.tekst);
  const na = anders.combinations.find((c) => c.id === c1.id);
  check("de bevestiging van de gewijzigde factor is weg, die van de ongewijzigde (0,54) blijft",
    JSON.stringify(na.bevestigdeFactoren) === JSON.stringify({ 2: 0.54 }), JSON.stringify(na.bevestigdeFactoren));
  const terug = B.wijzigCombinatie(anders, c1.id, { factors: new Map([[1, 1.22], [2, 0.54]]) });
  check("terug naar 1,22 brengt de bevestiging niet stil terug: opnieuw bevestigen",
    fouten(meldingen(terug, o.p.loads)).some((x) => x.caseId === 1));
  const hernoemd = B.wijzigCombinatie(staat, c1.id, { name: "UGT 6.10a (eigen)" });
  check("hernoemen houdt de bevestiging", fouten(meldingen(hernoemd, o.p.loads)).length === 0);
  const ander = B.wijzigCombinatie(staat, c1.id, { type: "sls" });
  check("een ander type (UGT → BGT) laat de bevestiging vervallen",
    ander.combinations.find((c) => c.id === c1.id).bevestigdeFactoren === undefined);
  const { staat: ingetrokken, ingetrokken: weg } = B.trekBevestigingIn(staat);
  check("intrekken: alle bevestigingen weg, de FOUT terug",
    weg.length === 5 && ingetrokken.combinations.every((c) => c.bevestigdeFactoren === undefined)
      && fouten(meldingen(ingetrokken, o.p.loads)).length === 1, JSON.stringify(weg));
  const info = B.bevestigdeEigenFactoren({ loadCases: staat.loadCases, combinations: staat.combinations });
  const infoTekst = B.tekstBevestigdeEigenFactoren(info);
  check("het rapport en de MCP-weg krijgen de bevestigde afwijking als vermelding (geen FOUT)",
    info.length === 1 && info[0].caseId === 1 && /bewust gekozen/.test(infoTekst) && /1,22 ≈ 0,9 × 1,35/.test(infoTekst),
    infoTekst);
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n[4] een echt spoor blijft gemeld");
{
  // Wees-factoren in hetzelfde bestand: een factor voor geval 9 dat niet bestaat.
  const ruw = JSON.parse(lees("P01"));
  ruw.combinations[0].factors["9"] = 0.9;
  const o = openTekst(JSON.stringify(ruw), "CC2");
  const s = o.afwijking?.samenvatting ?? "";
  // Een echt spoor wordt genoemd, maar zonder datum: uit de factoren is de
  // leeftijd van het project niet af te leiden (PR #126).
  check("wees-factoren in het bestand: het spoor van een eerdere versie staat erbij, zonder datum",
    o.afwijking?.weesFactoren.length === 1 && !SEPT.test(s) && /spoor van een eerdere versie/.test(s)
      && /niet \(meer\) bestaan|niet \(meer\) bestaat/.test(s), s);
  check("en de schaal en de NB-waarde staan er ook", /1,22 ≈ 0,9 × 1,35/.test(s), s);
  const mz = meldingen(o.staat, o.p.loads);
  check("de meldingen na het openen kennen dat spoor niet meer: daar geen datum",
    !SEPT.test(mz.map((x) => x.tekst).join(" ")), mz.map((x) => x.tekst).join(" | "));
}
{
  // Een andere factor dan een ander blijvend geval in dezelfde combinatie is
  // geen bewijs van een oud bestand: één factor met de hand gewijzigd.
  let s = B.openCombinatieStaat({ loadCases: standaardBelastinggevallen(), gevolgklasse: "CC2" }).staat;
  const c610a = s.combinations.find((c) => c.standaard?.sleutel === "6.10a");
  const f = new Map(c610a.factors);
  f.set(1, 1.22);
  s = B.wijzigCombinatie(s, c610a.id, { factors: f });
  const m = meldingen(s, [{ caseId: 1 }, { caseId: 5 }], true);
  const fout = fouten(m).find((x) => x.caseId === 1);
  check("één factor met de hand: FOUT op geval 1, zonder datum, met de neutrale herkomst",
    fout !== undefined && !SEPT.test(fout.tekst) && /met de hand is aangepast/.test(fout.tekst)
      && /blijvend geval 5 heeft daar 1,35/.test(fout.tekst), fout?.tekst);
}
{
  // De kolom van de oude standaardset (route 3 van test-belastingcombinaties):
  // het windgeval 4 verwijderd, "Permanent afbouw" kreeg id 4 en zijn kolom.
  const OUD = B.OUDE_STANDAARDSET.map((o, i) => ({
    id: i + 1, name: o.naam, type: o.type, formula: o.naam,
    factors: new Map(Object.entries(o.factoren).map(([k, v]) => [Number(k), v])),
  }));
  const gevallen = [
    { id: 1, name: "Permanent (G)", type: "dead" }, { id: 2, name: "Variabel (Q)", type: "live" },
    { id: 3, name: "Sneeuw (S)", type: "snow" }, { id: 4, name: "Permanent afbouw", type: "dead" },
  ];
  const staat = {
    loadCases: gevallen, combinations: OUD, gevolgklasse: "CC2", bijlage: "NL", volgendGevalId: 5, volgendCombinatieId: 9,
  };
  const m = meldingen(staat, [{ caseId: 1 }, { caseId: 4 }]);
  const f = fouten(m).find((x) => x.caseId === 4);
  // De kolom wordt genoemd, zonder datum (PR #126). Het aanbod om te behouden
  // ontbreekt: geen van deze ongewijzigde oude standaardcombinaties kan
  // bevestigd worden (zie hieronder), dus de knop zou niets doen.
  check("de oude kolom: \"het windgeval (W)\" zonder datum, zonder het aanbod om te behouden",
    f !== undefined && !SEPT.test(f.tekst) && /oude standaardkolom voor belastinggeval 4, het windgeval \(W\)/.test(f.tekst)
      && !f.bevestigAdvies, f?.tekst);
  const uit = B.bevestigEigenFactoren(staat);
  check("de oude standaardset wordt nooit bevestigd: alle acht overgeslagen, met reden",
    uit.bevestigd.length === 0 && uit.overgeslagen.length === 8 && uit.overgeslagen.every((x) => /0\.3\.11/.test(x.reden)),
    JSON.stringify(uit.overgeslagen.slice(0, 1)));
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n[5] de MCP-weg (sidecar in dit proces)");
{
  const inhoud = lees("P01");
  const v0 = verwerkVerzoek({ v: 1, id: 1, op: "validate", payload: { project: { inhoud } } });
  check("validate P01 zonder bevestiging: ok:false, met de FOUT", v0.ok && v0.result.ok === false
    && v0.result.errors.some((e) => /1,22 ≈ 0,9 × 1,35/.test(e)), JSON.stringify(v0.result?.errors));
  const l0 = verwerkVerzoek({ v: 1, id: 2, op: "load_project", payload: { inhoud } });
  check("load_project P01: geen \"september 2026\" in de waarschuwingen",
    l0.ok && !SEPT.test(l0.result.warnings.join(" ")), l0.result?.warnings?.join(" | "));

  const o = openTekst(inhoud, "CC2");
  const bevestigd = opslaanEnOpenen(B.bevestigEigenFactoren(o.staat).staat, o.p);
  const v1 = verwerkVerzoek({ v: 1, id: 3, op: "validate", payload: { project: { inhoud: bevestigd.tekst } } });
  check("validate na bevestigen: ok:true, en de bevestigde factoren staan als vermelding in de waarschuwingen",
    v1.ok && v1.result.ok === true && v1.result.warnings.some((w) => /bewust gekozen/.test(w) && /1,22/.test(w)),
    JSON.stringify(v1.result));
  const l1 = verwerkVerzoek({ v: 1, id: 4, op: "load_project", payload: { inhoud: bevestigd.tekst } });
  check("load_project geeft de bevestiging mee in de combinaties",
    l1.ok && l1.result.combinations[0].bevestigdeFactoren?.["1"] === 1.22, JSON.stringify(l1.result?.combinations?.[0]));
  // solve_fem_model / check_fem_model nemen de combinaties van load_project
  // ongewijzigd terug (het schema kent `bevestigdeFactoren`).
  const fouten = (r) => (r.result?.warnings ?? []).filter((w) => w.startsWith("FOUT:"));
  const s2 = verwerkVerzoek({
    v: 1, id: 5, op: "solve",
    payload: { model: l1.result.model, combinations: l1.result.combinations, gevolgklasse: l1.result.gevolgklasse },
  });
  check("solve met de combinaties van load_project, ongewijzigd: geen FOUT, wel de vermelding",
    s2.ok && fouten(s2).length === 0 && s2.result.warnings.some((w) => /bewust gekozen/.test(w)),
    JSON.stringify(s2.ok ? fouten(s2) : s2.error));
  const zonder = l1.result.combinations.map(({ bevestigdeFactoren: _weg, ...c }) => c);
  const s3 = verwerkVerzoek({
    v: 1, id: 6, op: "solve",
    payload: { model: l1.result.model, combinations: zonder, gevolgklasse: l1.result.gevolgklasse },
  });
  check("dezelfde combinaties zonder bevestiging: FOUT op geval 1",
    s3.ok && fouten(s3).some((w) => /Belastinggeval 1 /.test(w)), JSON.stringify(s3.ok ? fouten(s3) : s3.error));
  check("de uitkomsten zijn met en zonder bevestiging gelijk (geen rekenwaarde)",
    s2.ok && s3.ok && Object.keys(s2.result.combinations ?? {}).length === 5
      && JSON.stringify(s2.result.combinations) === JSON.stringify(s3.result.combinations),
    Object.keys(s2.result?.combinations ?? {}).join(","));
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n[6] de API: project.combinations.confirmOwnFactors en revokeOwnFactors");
{
  const register = maakRegister(PROJECT_COMMANDOS);
  let doc = documentUitTekst(lees("P01"));
  const doe = (naam, invoer) => {
    const r = register.voerUit(naam, invoer, { document: doc });
    if (r.document) doc = r.document;
    return r.uitkomst;
  };
  const faalt = (naam, invoer) => { try { register.voerUit(naam, invoer, { document: doc }); return null; } catch (e) { return e; } };
  const voor = doe("project.get", {});
  check("project.get zonder bevestiging: de melding bij openen staat erbij",
    voor.meldingen.some((x) => /LET OP: belastinggeval 1/.test(x)), JSON.stringify(voor.meldingen));
  const uit = doe("project.combinations.confirmOwnFactors", {});
  check("confirmOwnFactors zonder ids: alle vijf eigen combinaties bevestigd, geen melding meer",
    uit.confirmedCombinationIds.length === 5 && uit.meldingen.length === 0
      && doc.combinations.every((c) => c.bevestigdeFactoren !== undefined), JSON.stringify(uit));
  check("project.get daarna: geen LET OP", doe("project.get", {}).meldingen.length === 0);
  check("de factoren in het document zijn niet veranderd",
    JSON.stringify(doc.combinations.map((c) => c.factors)) === JSON.stringify(JSON.parse(lees("P01")).combinations.map((c) => c.factors)));
  const terug = doe("project.combinations.revokeOwnFactors", { ids: [1] });
  check("revokeOwnFactors met ids: alleen die combinatie, en de melding komt terug",
    terug.revokedCombinationIds.length === 1 && doc.combinations[0].bevestigdeFactoren === undefined
      && doc.combinations[1].bevestigdeFactoren !== undefined && terug.meldingen.some((x) => /LET OP/.test(x)),
    JSON.stringify(terug));
  check("een onbekende combinatie → NIET_GEVONDEN",
    faalt("project.combinations.confirmOwnFactors", { ids: [99] })?.code === "NIET_GEVONDEN");
  // Een standaardcombinatie wordt niet bevestigd: de app houdt haar bij.
  const leeg = documentUitTekst(serializeProject({
    nodes: [], beams: [], supports: [], plates: [], loads: [], loadCases: standaardBelastinggevallen(),
    activeLoadCaseId: 1, selfWeightEnabled: true,
  }));
  const std = register.voerUit("project.get", {}, { document: leeg }).uitkomst.combinations[0];
  let fout = null;
  try {
    register.voerUit("project.combinations.confirmOwnFactors", { ids: [std.id] }, { document: leeg });
  } catch (e) { fout = e; }
  check("een standaardcombinatie bevestigen → GEWEIGERD, met de reden",
    fout?.code === "GEWEIGERD" && /standaardcombinatie/.test(fout.message), fout?.message);
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n[7] de bevestiging is geen rekenwaarde");
{
  const o = openTekst(lees("P01"), "CC2");
  const { staat } = B.bevestigEigenFactoren(o.staat);
  const g = (l) => l.map((c) => ({ id: c.id, type: c.type, factors: [...c.factors] }));
  check("de combinaties die de solver krijgt (id, type, factoren) zijn voor en na gelijk",
    JSON.stringify(g(o.staat.combinations)) === JSON.stringify(g(staat.combinations)));
  check("gelijkeInhoud: de bevestiging telt niet als andere rekeninhoud",
    staat.combinations.every((c, i) => B.gelijkeInhoud(c, o.staat.combinations[i])));
}

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

// Verouderde resultaten — na een wijziging van de rekeninstellingen, en na een
// mislukte toetsronde, mag er geen oude uitkomst blijven staan.
//
// WAT HIER MISGING (audit september 2026)
//  - Resultaten en unity checks werden alleen gewist als knopen, staven,
//    opleggingen, lasten of platen veranderden. Na een wijziging van een
//    combinatiefactor, het eigen gewicht, de scheefstand of het analysetype
//    bleven UC-badges en "Berekend om" staan. Gemeten in de app: Q-factor in
//    6.10b van 1,5 naar 3,0 — badges ongewijzigd; pas na Berekenen hout
//    0,39 → 0,56.
//  - Een mislukte toetsronde zette alleen de fout en liet de UC's van de vorige
//    ronde staan. Gemeten (IPE300, q = −18 kN/m): na "eigen gewicht aan" en een
//    mislukte ronde bleef 1,6766 staan waar 1,7074 hoorde.
//
// WAT DEZE TEST VASTLEGT
//  [1] De versie van de rekeninstellingen verandert bij ELK veld, en de lijst
//      velden in de test dekt ELK veld van `RekenInstellingen` — een nieuw veld
//      zonder testgeval laat deze test falen.
//  [2] Beide invalidatie-effecten (App.tsx en useFemStore.ts) lezen die versie
//      en wissen wat bij het oude model hoort — in de store ook α_cr
//      (`stabiliteit`). Effecten, afhankelijkheden, de versie-memo en de
//      resultaatselectie worden in de AST opgezocht en UITGEVOERD zonder DOM
//      (scripts/bron-uitvoeren.mjs); er wordt geen broncodetekst vergeleken.
//  [3] Een mislukte toetsronde wist dezelfde velden als `clear()` — met een
//      nagebootste onbereikbare kern, dus zonder binary.
//  [4] Hetzelfde met de echte toetsbrug: na een geslaagde ronde en een
//      mislukte ronde staat er geen UC meer. Luid overgeslagen als de binary
//      ontbreekt.
//
// Uitvoeren: npx tsx test-verouderd.mjs   (vanuit design-mockup/)

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  argumentVan, context, declaratie, declaratieDeps, effect, evalueer, importNaam, leesBron, merktekenNaden, noemt,
  stateNaden, voerUitIn,
} from "./scripts/bron-uitvoeren.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const TOETSBRUG = join(
  resolve(HIER, ".."), "src-tauri", "target", "release",
  process.platform === "win32" ? "toetsbrug.exe" : "toetsbrug",
);

const { rekenInstellingenVersie, REKENINSTELLINGEN_VELDEN } =
  await import("./src/lib/rekenInstellingen.ts");
const { defaultCombinations, combineResults } =
  await import("./src/components/fem/solver/combinations.ts");
const { DEFAULT_LOAD_CASES } = await import("./src/hooks/useFemStore.ts");
const { useCheckStore } = await import("./src/stores/checkStore.ts");
const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");
const { solveAllCases } = await import("./src/components/fem/solver/engine.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function check(naam, voorwaarde, detail = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}`); }
  else            { failed++; log(`  ✗ ${naam}${detail ? ` — ${detail}` : ""}`); }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] Elke rekeninstelling verandert de versie");
{
  const basis = () => ({
    loadCases: DEFAULT_LOAD_CASES.map((lc) => ({ ...lc })),
    combinations: defaultCombinations().map((c) => ({ ...c, factors: new Map(c.factors) })),
    selfWeightEnabled: false,
    analysetype: "eersteOrde",
    axialMaterialLoadPath: [1],
    betonSegmentLengteMm: 400,
    betonKruipcoefficient: null,
    betonKruipInvoer: null,
    scheefstandEnabled: false,
    scheefstandNoemer: 200,
    scheefstandRichting: 1,
    scheefstandBron: "vast",
    scheefstandHoogteM: null,
    scheefstandAantalElementen: null,
    gevolgklasse: "CC2",
    // De nationale bijlage (normnaad): zij bepaalt de nationaal bepaalde
    // parameters van elke toetsing, dus een wijziging hoort de resultaten te
    // laten vervallen.
    nationaleBijlage: "NL",
  });
  const v0 = rekenInstellingenVersie(basis());

  check("dezelfde instellingen geven dezelfde versie", rekenInstellingenVersie(basis()) === v0);

  // De volgorde waarin factoren in een Map zijn gezet telt niet mee.
  const omgekeerd = basis();
  omgekeerd.combinations = omgekeerd.combinations.map((c) => ({
    ...c, factors: new Map([...c.factors.entries()].reverse()),
  }));
  check("volgorde van de factoren telt niet mee", rekenInstellingenVersie(omgekeerd) === v0);

  // Eén wijziging per veld. De Q-factor in de eerste UGT-combinatie ×2 is het
  // gemeten faalscenario (1,5 → 3,0).
  const wijzigingen = {
    loadCases: (m) => { m.loadCases[1] = { ...m.loadCases[1], type: "snow" }; },
    combinations: (m) => {
      const c = m.combinations.find((x) => x.type === "uls" && x.factors.has(2));
      c.factors.set(2, c.factors.get(2) * 2);
    },
    selfWeightEnabled: (m) => { m.selfWeightEnabled = true; },
    analysetype: (m) => { m.analysetype = "tweedeOrdeGeometrisch"; },
    axialMaterialLoadPath: (m) => { m.axialMaterialLoadPath = [1, 0]; },
    betonSegmentLengteMm: (m) => { m.betonSegmentLengteMm = 200; },
    // φ(∞,t₀) bepaalt via (7.20) de effectieve elasticiteitsmodulus en dus
    // elke betonstijfheid: van "niet opgegeven" naar 2,0 moet een nieuwe
    // versie geven, anders blijft de zakking zonder kruip op het scherm staan.
    betonKruipcoefficient: (m) => { m.betonKruipcoefficient = 2.0; },
    // De invoer voor φ(∞,t₀) volgens bijlage B: van "uit" naar RH 50 %, t₀ 28 d,
    // cement N bepaalt de kruip van elke betonstaaf zonder opgegeven φ.
    betonKruipInvoer: (m) => { m.betonKruipInvoer = { rhProcent: 50, t0Dagen: 28, cementklasse: "N" }; },
    scheefstandEnabled: (m) => { m.scheefstandEnabled = true; },
    scheefstandNoemer: (m) => { m.scheefstandNoemer = 300; },
    scheefstandRichting: (m) => { m.scheefstandRichting = -1; },
    scheefstandBron: (m) => { m.scheefstandBron = "en1993"; },
    scheefstandHoogteM: (m) => { m.scheefstandHoogteM = 6; },
    scheefstandAantalElementen: (m) => { m.scheefstandAantalElementen = 3; },
    gevolgklasse: (m) => { m.gevolgklasse = "CC3"; },
    // Er is vandaag maar één gevulde bijlage; "naar niets" is de enige
    // wijziging die te maken is, en ook die hoort een nieuwe versie te geven.
    nationaleBijlage: (m) => { m.nationaleBijlage = null; },
  };
  for (const [veld, wijzig] of Object.entries(wijzigingen)) {
    const m = basis();
    wijzig(m);
    check(`wijziging van ${veld} geeft een nieuwe versie`, rekenInstellingenVersie(m) !== v0);
  }
  const zonderGeval = REKENINSTELLINGEN_VELDEN.filter((v) => !(v in wijzigingen));
  check(
    "elk veld van RekenInstellingen heeft hierboven een testgeval",
    zonderGeval.length === 0,
    `zonder testgeval: ${zonderGeval.join(", ")}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] Beide invalidatie-effecten lezen de versie — uitgevoerd, niet gelezen");
{
  // De effecten en de waarden worden in de AST opgezocht en UITGEVOERD
  // (scripts/bron-uitvoeren.mjs): de test kijkt naar wat ze doen, niet naar
  // hoe de broncode eruitziet.
  const app = leesBron("src/App.tsx");
  const store = leesBron("src/hooks/useFemStore.ts");
  const ref = (current) => ({ current });
  /** Verandert de afhankelijkhedenlijst als `wijzig` iets wijzigt? Zo beslist React of een effect opnieuw draait. */
  const reageertOp = (deps, ctx, wijzig) => {
    const voor = evalueer(deps, ctx);
    wijzig();
    const na = evalueer(deps, ctx);
    return voor.length !== na.length || na.some((v, i) => !Object.is(v, voor[i]));
  };

  // ── App.tsx: het effect dat bij een modelwijziging de toetsing wist ──
  const appEffect = effect(app, ({ body, deps }) => noemt(deps, "rekenInstellingenVersie") && noemt(body, "checkClear"));
  let gewist = 0;
  const femApp = {
    nodes: [], beams: [], supports: [], loads: [], plates: [], rekenInstellingenVersie: "v1",
    setEnvelopeView() {}, setActiveCombinationId() {},
  };
  const appToestand = { solverErrorText: "oud", stabiliteitsMelding: "oud", solverStatus: { kind: "solved" } };
  const ctxApp = await context(app, stateNaden(app, appToestand, {
    fem: femApp,
    checkClear() { gewist++; }, stijfheidClear() {},
    rekenGeneratieRef: ref(1), lopendeRekengangenRef: ref(1),
    rapportRekenPogingRef: ref(true), volledigeRekengangRef: ref(new Map()),
    rekenFoutRef: ref("oud"), liveRekenenRef: ref(false),
  }), [appEffect.body, appEffect.deps]);
  for (const veld of ["nodes", "beams", "supports", "loads", "plates"]) {
    check(`App.tsx: het invalidatie-effect draait opnieuw na een andere fem.${veld}`,
      reageertOp(appEffect.deps, ctxApp, () => { femApp[veld] = []; }));
  }
  check("App.tsx: … en na een andere versie van de rekeninstellingen",
    reageertOp(appEffect.deps, ctxApp, () => { femApp.rekenInstellingenVersie = "v2"; }));
  evalueer(appEffect.body, ctxApp)();
  check(
    "App.tsx: dat effect wist de toetsuitslagen, de rekenfout en de stabiliteitsmelding",
    gewist === 1 && ctxApp.rekenGeneratieRef.current === 2 && ctxApp.volledigeRekengangRef.current === null
      && ctxApp.rekenFoutRef.current === null && appToestand.solverErrorText === null
      && appToestand.stabiliteitsMelding === null,
  );

  // ── useFemStore.ts: het store-effect wist ELKE solveruitvoer ──
  // De vier uitvoervelden die `setSolverOutputs` samen zet. Ook α_cr hoort bij
  // het oude model: bleef `stabiliteit` staan, dan kreeg het rapport de
  // analysetoelichting van het vorige model, en de toets via het API-pad de
  // α_cr van vóór de wijziging.
  const storeEffect = effect(store, ({ deps }) => noemt(deps, "rekenInstellingenVersie"));
  const OUD = "uitvoer van het oude model";
  const storeToestand = {
    nodes: [], beams: [], supports: [], plates: [], loads: [],
    multiLcResult: OUD, combinationResults: OUD, envelope: OUD, stabiliteit: OUD,
  };
  const ctxStore = await context(store, stateNaden(store, storeToestand, { rekenInstellingenVersie: "v1" }),
    [storeEffect.body, storeEffect.deps]);
  for (const veld of ["nodes", "beams", "supports", "plates", "loads"]) {
    check(`useFemStore.ts: het store-effect draait opnieuw na andere ${veld}`,
      reageertOp(storeEffect.deps, ctxStore, () => { storeToestand[veld] = []; }));
  }
  check("useFemStore.ts: … en na een andere versie van de rekeninstellingen",
    reageertOp(storeEffect.deps, ctxStore, () => { ctxStore.rekenInstellingenVersie = "v2"; }));
  evalueer(storeEffect.body, ctxStore)();
  for (const veld of ["multiLcResult", "combinationResults", "envelope", "stabiliteit"]) {
    check(`useFemStore.ts: na een modelwijziging is ${veld} gewist`, storeToestand[veld] === null, String(storeToestand[veld]));
  }

  // ── useFemStore.ts: de versie komt uit ELK veld van de rekeninstellingen ──
  // De fabriek van de useMemo draait met een spion op de versiefunctie en een
  // eigen merkteken per stuk storetoestand: elk veld moet een eigen stuk
  // toestand dragen, en de memo moet op elk daarvan opnieuw rekenen.
  const versieFabriek = declaratie(store, "rekenInstellingenVersie");
  const versieDeps = declaratieDeps(store, "rekenInstellingenVersie");
  const spion = importNaam(store, "lib/rekenInstellingen", "rekenInstellingenVersie");
  const merk = merktekenNaden(versieFabriek, [spion]);
  let gevraagd = null;
  const ctxVersie = await context(store, {
    ...merk, [spion]: (instellingen) => { gevraagd = instellingen; return "versie"; },
  }, [versieFabriek, versieDeps]);
  evalueer(versieFabriek, ctxVersie)();
  const merktekens = Object.values(merk);
  const zonderToestand = REKENINSTELLINGEN_VELDEN.filter((v) => !gevraagd || !merktekens.includes(gevraagd[v]));
  check("useFemStore.ts: de versie krijgt elk veld uit een eigen stuk storetoestand",
    gevraagd !== null && zonderToestand.length === 0
      && new Set(REKENINSTELLINGEN_VELDEN.map((v) => gevraagd[v])).size === REKENINSTELLINGEN_VELDEN.length,
    `zonder toestand: ${zonderToestand.join(", ")}`);
  const memoDeps = evalueer(versieDeps, ctxVersie);
  const nietInDeps = REKENINSTELLINGEN_VELDEN.filter((v) => gevraagd && !memoDeps.includes(gevraagd[v]));
  check("useFemStore.ts: de versie rekent opnieuw bij een wijziging van elk veld",
    gevraagd !== null && nietInDeps.length === 0, `niet in de afhankelijkheden: ${nietInDeps.join(", ")}`);

  // ── App.tsx → store: de uitgangspunten van het project gaan de store in ──
  const opties = await voerUitIn(app, argumentVan(app, "useFemStore"), {
    projectInfo: { uitgangspunten: { gevolgklasse: "CC3", nationaleBijlage: "NL" } },
  });
  check("App.tsx: de gevolgklasse uit de uitgangspunten gaat de store in", opties.gevolgklasse === "CC3", JSON.stringify(opties));
  check("App.tsx: de nationale bijlage uit de uitgangspunten gaat de store in", opties.nationaleBijlage === "NL", JSON.stringify(opties));
  const zonder = await voerUitIn(app, argumentVan(app, "useFemStore"), { projectInfo: {} });
  check("App.tsx: zonder uitgangspunten geen klasse en geen bijlage (de store laat de combinaties dan ongemoeid)",
    zonder.gevolgklasse === null && zonder.nationaleBijlage === null, JSON.stringify(zonder));

  // ── App.tsx: tijdens het herberekenen geen oude resultaten in de eigenschappen ──
  check(
    "App.tsx: eigenschappen lezen geen oude resultaten tijdens herberekenen",
    await voerUitIn(app, declaratie(app, "solverResult"), {
      solverStatus: { kind: "rekenen" }, fem: { multiLcResult: new Map([[1, { oud: true }]]), activeLoadCaseId: 1 },
    }) === null,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Een fetch die zich gedraagt als de dev-brug (vite.config.ts): "aan" roept de
// echte toetsbrug aan, "503" is een kern die niet gebouwd is.
let brug = "503";
globalThis.fetch = async (_url, init) => {
  const body = init.body;
  const antwoord = (status, tekst) => ({
    ok: status >= 200 && status < 300, status, text: async () => tekst,
  });
  if (brug === "503") {
    return antwoord(503, JSON.stringify({ fout: "De rekenkern is nog niet gebouwd (nagebootst)." }));
  }
  const r = await new Promise((resolve, reject) => {
    const child = spawn(TOETSBRUG, [], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({
      code: code ?? signal,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
    child.stdin.end(body);
  });
  return antwoord(typeof r.code === "number" && r.code === 0 ? 200 : 400, r.stdout || r.stderr);
};

log("\n[3] Een mislukte toetsronde wist de vorige uitslag");
{
  // De toestand van een eerdere, geslaagde ronde — met de hand gezet, zodat dit
  // blok geen binary nodig heeft.
  const oud = {
    beam_id: 1, profile_name: "IPE300", steel_grade: "S235", checks: [],
    uc_max: 1.6766, status: "NotOk", governing_check_id: "6.2.5_bending_y",
  };
  useCheckStore.setState({
    results: [oud],
    skipped: [{ beamId: 9, reason: "oud" }],
    beff: [],
    lastRunAt: 123,
    lastRunData: { nodes: [], beams: [], combinations: [], combinationResults: new Map() },
    toetsCombinaties: [{ id: 1_000_003, name: "oud (scheefstand −x)" }],
    lastRunInputs: { steel: [], timber: [], clt: [], beton: [], spanning: [] },
    error: null,
  });
  brug = "503";
  await useCheckStore.getState().run({
    nodes: [], beams: [], supports: [], combinations: [], combinationResults: new Map(),
  });
  const s = useCheckStore.getState();
  check("de fout staat er", typeof s.error === "string" && s.error.includes("niet gebouwd"), String(s.error));
  check("geen oude resultaten", s.results.length === 0, JSON.stringify(s.results));
  check("geen oude overgeslagen staven", s.skipped.length === 0);
  check("geen oude run-tijd", s.lastRunAt === null);
  check("geen oude modelinvoer", s.lastRunData === null && s.lastRunInputs === null);
  // Issue #199: de namen van de toetscombinaties (voor het rapport) horen bij
  // de oude ronde.
  check("geen oude namen van toetscombinaties", s.toetsCombinaties.length === 0);
  check("de ronde is afgesloten", s.isRunning === false);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] Met de echte rekenkern: geen oude UC na een mislukte ronde");
if (!existsSync(TOETSBRUG)) {
  failed++;
  log(`  ✗ OVERGESLAGEN: toetsbrug ontbreekt (${TOETSBRUG}). Bouw eerst: cargo build --release -p toetsbrug`);
} else {
  const model = (eigenGewicht) => ({
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, material: "S235", profile: "IPE300" }],
    supports: [{ id: 1, nodeId: 1, type: "pinned" }, { id: 2, nodeId: 2, type: "zRoller" }],
    plates: [],
    loadCases: [{ id: 1, name: "Permanent", type: "dead" }, { id: 2, name: "Variabel", type: "live" }],
    loads: [{ id: 1, type: "lineLoad", caseId: 2, beamId: 1, q: -18 }],
    selfWeightEnabled: eigenGewicht, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
  });
  const runData = (m) => {
    const combos = defaultCombinations();
    const { perCase } = solveAllCases(bouwMultiInput(m));
    const cr = new Map(combos.map((c) => [c.id, combineResults(c, perCase)]));
    return { nodes: m.nodes, beams: m.beams, supports: m.supports, combinations: combos, combinationResults: cr };
  };

  useCheckStore.getState().clear();
  brug = "aan";
  await useCheckStore.getState().run(runData(model(false)));
  const uc1 = useCheckStore.getState().results[0]?.uc_max;
  check("ronde 1 levert een UC", Number.isFinite(uc1) && uc1 > 0, String(uc1));

  // Eigen gewicht aan — het oude effect wiste hier niets — en de ronde faalt.
  const d2 = runData(model(true));
  brug = "503";
  await useCheckStore.getState().run(d2);
  const na = useCheckStore.getState();
  check("na de mislukte ronde staat de UC van ronde 1 er NIET meer", na.results.length === 0,
    `getoond: ${na.results.map((r) => r.uc_max).join(", ")}`);
  check("en de fout wel", na.error !== null);

  // Tegenproef: dezelfde ronde met een bereikbare kern geeft een hogere UC —
  // het eigen gewicht (IPE300, 42,2 kg/m) komt bovenop q = 18 kN/m. Precies het
  // getal dat met de oude catch door 1,6766 werd verborgen.
  brug = "aan";
  await useCheckStore.getState().run(d2);
  const uc2 = useCheckStore.getState().results[0]?.uc_max;
  check("met eigen gewicht is de UC hoger dan zonder", uc2 > uc1, `${uc1} → ${uc2}`);
}

log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed === 0 ? 0 : 1);

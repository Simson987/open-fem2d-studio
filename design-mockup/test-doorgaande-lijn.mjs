// Doorgaande lijn en staafeinden (basisaudit nr 29 en het kipgedrag bij een
// tussenknoop en een vrij eind). Bewaakt dat de toetsbouwers een door een
// tussenknoop geknipte staaf als ÉÉN staaf aanbieden — met de volle lengte,
// de aaneengeregen krachten en zakking en de omgerekende kipsteunen — en dat
// een vrij of doorlopend staafeind als zodanig naar de kern gaat.
//
// Zonder deze samenvoeging kreeg elk deel de halve lengte: HEA160 6 m met
// N = 300 kN ging van UC 1,162 naar 0,500, en IPE 300 6 m van UC_kip 0,720
// naar 0,406 — zonder dat er een steun bij kwam.
//
// Praat alleen met engine, combinations en de bouwers, dus draait ook tegen
// de sidecarbundel. Uitvoeren: npx tsx test-doorgaande-lijn.mjs

const { solveAllCases } = await import("./src/components/fem/solver/engine.ts");
const { combineResults } = await import("./src/components/fem/solver/combinations.ts");
const { buildSteelCheckInputs } = await import("./src/lib/steelCheckBuilder.ts");
const { buildTimberCheckInputs } = await import("./src/lib/timberCheckBuilder.ts");
const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function check(name, cond, detail = "") {
  if (cond) { passed++; log(`  ✓ ${name}`); }
  else      { failed++; log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const approx = (a, b, tol) => Math.abs(a - b) <= tol;

const profileDb = new Map([
  ["IPE300", { geometry: { h: 300 } }],
  ["IPE200", { geometry: { h: 200 } }],
  ["HEA160", { geometry: { h: 152 } }],
]);
const combos = [
  { id: 1, name: "UGT", type: "uls", formula: "1.35G", factors: new Map([[1, 1.35]]) },
  { id: 2, name: "BGT karakteristiek", type: "sls", formula: "G", factors: new Map([[1, 1]]),
    standaard: { soort: "6.14b", leidend: null, gevolgklasse: "CC2", kenmerk: "" } },
];
const loadCases = [{ id: 1, name: "G", type: "dead" }];

/** Reken een model door en bouw de staalinvoer. */
function staal(model, extra = {}) {
  const mi = bouwMultiInput({
    plates: [], loadCases, selfWeightEnabled: false,
    scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
    ...model,
  });
  const { perCase } = solveAllCases(mi);
  const combinationResults = new Map(combos.map((c) => [c.id, combineResults(c, perCase)]));
  return buildSteelCheckInputs({
    nodes: model.nodes, beams: model.beams, supports: model.supports,
    combinations: combos, combinationResults, profileDb, ...extra,
  });
}
const q = (beamId) => ({ id: beamId, type: "lineLoad", caseId: 1, beamId, q: -10 });
const maxMy = (inp) => Math.max(...inp.forces_envelope.map((p) => Math.abs(p.forces.my_ed)));

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] IPE 300 vrij opgelegd 6 m: ongesplitst tegen gesplitst op 3 m (knoop zonder oplegging)");
const heel = staal({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }],
  beams: [{ id: 1, from: 1, to: 2, material: "S235", profile: "IPE300",
    checkConfig: { lateralRestraints: [0.25, 0.5, 0.75] } }],
  supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
  loads: [q(1)],
});
const gesplitst = staal({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 3, x: 3000, z: 0 }, { id: 2, x: 6000, z: 0 }],
  beams: [
    // De kipsteunen zoals `splitsCheckConfig` ze na het splitsen zet.
    { id: 1, from: 1, to: 3, material: "S235", profile: "IPE300", checkConfig: { lateralRestraints: [0.5, 1] } },
    { id: 2, from: 3, to: 2, material: "S235", profile: "IPE300", checkConfig: { lateralRestraints: [0, 0.5] } },
  ],
  supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
  loads: [q(1), q(2)],
});
{
  check("één toetsinvoer, onder staaf 1", gesplitst.inputs.length === 1 && gesplitst.inputs[0].beam_id === 1);
  check("staaf 2 overgeslagen met reden 'doorgaande lijn … als staaf 1'",
    gesplitst.skipped.length === 1 && gesplitst.skipped[0].beamId === 2 && /doorgaande lijn.*staaf 1/.test(gesplitst.skipped[0].reason),
    JSON.stringify(gesplitst.skipped));
  const a = heel.inputs[0], b = gesplitst.inputs[0];
  check("lengte 6,000 m (niet 3)", b.length_m === 6);
  check("max |M_y,Ed| gelijk aan ongesplitst", approx(maxMy(a), maxMy(b), 1e-9), `${maxMy(a)} vs ${maxMy(b)}`);
  check("stations lopen van 0 tot 6000 mm, 41 punten (21 + 20)",
    b.forces_envelope.length === 41 && b.forces_envelope[0].position_mm === 0 && b.forces_envelope[40].position_mm === 6000);
  check("zakking vanaf de koorde van de hele lijn = ongesplitst",
    approx(a.deflection_actual_max_mm, b.deflection_actual_max_mm, 1e-6 * Math.abs(a.deflection_actual_max_mm)),
    `${a.deflection_actual_max_mm} vs ${b.deflection_actual_max_mm}`);
  check("kipsteunen omgerekend naar de lijn: [0.25, 0.5, 0.75]",
    JSON.stringify(b.lateral_bracing.top_flange_positions) === "[0.25,0.5,0.75]", JSON.stringify(b.lateral_bracing.top_flange_positions));
  check("q_equiv gelijk", approx(a.q_equiv_n_per_mm, b.q_equiv_n_per_mm, 1e-9));
  check("kniklengtes leeg (0) → de kern neemt de hele lijn", b.buckling_length_y_m === 0 && b.buckling_length_z_m === 0);
  check("staaf_notities noemt de doorgaande lijn en de lengte",
    Array.isArray(b.staaf_notities) && /DOORGAANDE LIJN/.test(b.staaf_notities[0]) && /6,000 m/.test(b.staaf_notities[0]));
  check("geen staafeinden (beide einden opgelegd = gaffel)", b.staafeinden === undefined);
  check("de ongesplitste invoer heeft geen staaf_notities", a.staaf_notities === undefined);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] Deel 2 tegen de lijnrichting in getekend (2→3): zelfde uitkomst");
{
  const r = staal({
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 3, x: 3000, z: 0 }, { id: 2, x: 6000, z: 0 }],
    beams: [
      { id: 1, from: 1, to: 3, material: "S235", profile: "IPE300", checkConfig: { lateralRestraints: [0.5, 1] } },
      { id: 2, from: 2, to: 3, material: "S235", profile: "IPE300", checkConfig: { lateralRestraints: [0.5, 1] } },
    ],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
    loads: [q(1), q(2)],
  });
  const b = r.inputs[0], a = heel.inputs[0];
  check("één invoer, L = 6", r.inputs.length === 1 && b.length_m === 6);
  check("max |M| en zakking gelijk aan ongesplitst",
    approx(maxMy(a), maxMy(b), 1e-9) && approx(a.deflection_actual_max_mm, b.deflection_actual_max_mm, 1e-6 * Math.abs(a.deflection_actual_max_mm)));
  check("gespiegelde kipsteunen [0.5, 1] van deel 2 → 0.75 en 0.5 op de lijn",
    JSON.stringify(b.lateral_bracing.top_flange_positions) === "[0.25,0.5,0.75]", JSON.stringify(b.lateral_bracing.top_flange_positions));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] Oplegging op de tussenknoop: twee overspanningen, NIET samengevoegd");
{
  const r = staal({
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 3, x: 3000, z: 0 }, { id: 2, x: 6000, z: 0 }],
    beams: [
      { id: 1, from: 1, to: 3, material: "S235", profile: "IPE300" },
      { id: 2, from: 3, to: 2, material: "S235", profile: "IPE300" },
    ],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 3, type: "zRoller" }, { nodeId: 2, type: "zRoller" }],
    loads: [q(1), q(2)],
  });
  check("twee invoeren van 3 m", r.inputs.length === 2 && r.inputs.every((i) => i.length_m === 3));
  check("niets overgeslagen, geen staafeinden", r.skipped.length === 0 && r.inputs.every((i) => i.staafeinden === undefined));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] Zonder opleggingenlijst wordt er niet samengevoegd (steunpunt niet te onderscheiden)");
{
  const model = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 3, x: 3000, z: 0 }, { id: 2, x: 6000, z: 0 }],
    beams: [
      { id: 1, from: 1, to: 3, material: "S235", profile: "IPE300" },
      { id: 2, from: 3, to: 2, material: "S235", profile: "IPE300" },
    ],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
    loads: [q(1), q(2)],
  };
  const r = staal(model, { supports: undefined });
  check("twee invoeren van 3 m", r.inputs.length === 2 && r.inputs.every((i) => i.length_m === 3));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[5] Uitkraging 3 m: het vrije eind gaat als 'Vrij' naar de kern");
{
  const r = staal({
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 3000, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, material: "S235", profile: "IPE300" }],
    supports: [{ nodeId: 1, type: "fixed" }],
    loads: [q(1)],
  });
  const i = r.inputs[0];
  check("staafeinden { begin: Gaffel, eind: Vrij }", JSON.stringify(i.staafeinden) === JSON.stringify({ begin: "Gaffel", eind: "Vrij" }), JSON.stringify(i.staafeinden));
  // Andersom getekend (van het vrije eind naar de inklemming): de
  // referentierichting draait hem om, dus het begin blijft de inklemming.
  const r2 = staal({
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 3000, z: 0 }],
    beams: [{ id: 1, from: 2, to: 1, material: "S235", profile: "IPE300" }],
    supports: [{ nodeId: 1, type: "fixed" }],
    loads: [q(1)],
  });
  check("andersom getekend: in referentierichting nog steeds begin Gaffel, eind Vrij",
    JSON.stringify(r2.inputs[0].staafeinden) === JSON.stringify({ begin: "Gaffel", eind: "Vrij" }), JSON.stringify(r2.inputs[0].staafeinden));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[6] Vrijstaande kolom in een plaat: de plaathoek is geen vrij eind");
{
  const model = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: 3000 }],
    beams: [{ id: 1, from: 1, to: 2, material: "S235", profile: "HEA160" }],
    supports: [{ nodeId: 1, type: "fixed" }],
    loads: [{ id: 1, type: "pointForce", caseId: 1, nodeId: 2, fx: 0, fz: -100 }],
  };
  const zonder = staal(model);
  const met = staal(model, { plates: [{ nodeIds: [2, 5, 6, 7] }] });
  check("zonder plaat: kop Vrij", zonder.inputs[0].staafeinden?.eind === "Vrij");
  check("met plaat op de kop: gaffel (geen staafeinden meegegeven)", met.inputs[0].staafeinden === undefined);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[7] Doorlopend in een ander profiel (IPE 300 → IPE 200, geen oplegging): 'Doorlopend' aan weerszijden");
{
  const r = staal({
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 3, x: 3000, z: 0 }, { id: 2, x: 6000, z: 0 }],
    beams: [
      { id: 1, from: 1, to: 3, material: "S235", profile: "IPE300" },
      { id: 2, from: 3, to: 2, material: "S235", profile: "IPE200" },
    ],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
    loads: [q(1), q(2)],
  });
  check("twee invoeren (niet samengevoegd)", r.inputs.length === 2);
  const i1 = r.inputs.find((i) => i.beam_id === 1), i2 = r.inputs.find((i) => i.beam_id === 2);
  check("staaf 1: eind Doorlopend", i1.staafeinden?.begin === "Gaffel" && i1.staafeinden?.eind === "Doorlopend", JSON.stringify(i1.staafeinden));
  check("staaf 2: begin Doorlopend", i2.staafeinden?.begin === "Doorlopend" && i2.staafeinden?.eind === "Gaffel", JSON.stringify(i2.staafeinden));
}

// ─────────────────────────────────────────────────────────────────────────
// Een kolom die op de tussenknoop STAAT (met een vrije kop) steunt de ligger
// nergens: de liggers blijven één lijn van 6 m, voor de kip, de doorbuiging
// én de knik, met een notitie over de aansluiting. Een eerste oplossing van K6
// (controle oktober 2026, #188) knipte de lijn hier en maakte de knoop stil
// een gaffel (kip-UC 2,235 → 1,207, w_fin 1,245 → 0,502); zie
// test-vakwerk-kniklengte.mjs [6] voor de kern.
log("\n[8] Kolom die op de tussenknoop staat: wél samengevoegd, mét notitie over de aansluiting");
{
  const r = staal({
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 3, x: 3000, z: 0 }, { id: 2, x: 6000, z: 0 }, { id: 4, x: 3000, z: 3000 }],
    beams: [
      { id: 1, from: 1, to: 3, material: "S235", profile: "IPE300" },
      { id: 2, from: 3, to: 2, material: "S235", profile: "IPE300" },
      { id: 5, from: 3, to: 4, material: "S235", profile: "HEA160" },
    ],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
    loads: [q(1), q(2), { id: 9, type: "pointForce", caseId: 1, nodeId: 4, fx: 0, fz: -50 }],
  });
  const lijn = r.inputs.find((i) => i.beam_id === 1);
  check("lijn 1+2 als staaf 1 van 6 m; kolom 5 apart", r.inputs.length === 2 && lijn.length_m === 6 && r.inputs.some((i) => i.beam_id === 5));
  check("notitie noemt staaf 5 op tussenknoop 3", lijn.staaf_notities.some((n) => /tussenknoop 3/.test(n) && /staaf 5/.test(n)), JSON.stringify(lijn.staaf_notities));
  check("de kolom heeft een vrije kop: geen kniklengte per vak, geen gaffel op knoop 3",
    lijn.buckling_length_y_m === 0 && lijn.buckling_length_z_m === 0 && lijn.staafeinden === undefined);
  const kolom = r.inputs.find((i) => i.beam_id === 5);
  check("kolom 5: voet op de ligger is een aansluiting (gaffel), kop vrij", kolom.staafeinden?.begin === "Gaffel" && kolom.staafeinden?.eind === "Vrij", JSON.stringify(kolom.staafeinden));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[9] Opgegeven kniklengtes van de delen: de grootste wint, met notitie");
{
  const r = staal({
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 3, x: 0, z: 3000 }, { id: 2, x: 0, z: 6000 }],
    beams: [
      { id: 1, from: 1, to: 3, material: "S235", profile: "HEA160", checkConfig: { bucklingLengthY_m: 6, bucklingLengthZ_m: 3 } },
      { id: 2, from: 3, to: 2, material: "S235", profile: "HEA160", checkConfig: { bucklingLengthY_m: 6, bucklingLengthZ_m: 2 } },
    ],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "xRoller" }],
    loads: [{ id: 1, type: "pointForce", caseId: 1, nodeId: 2, fx: 0, fz: -200 }],
  });
  const i = r.inputs[0];
  check("L = 6 m, L_cr,y = 6 (gelijk), L_cr,z = 3 (grootste)", i.length_m === 6 && i.buckling_length_y_m === 6 && i.buckling_length_z_m === 3);
  check("notitie over het verschil in L_cr,z", i.staaf_notities.some((n) => /kniklengte om de z-as/.test(n) && /3,000 m/.test(n)));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[10] Hout: C24 96x450 gesplitst → één invoer van 6 m met staaf_notities");
{
  const model = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 3, x: 3000, z: 0 }, { id: 2, x: 6000, z: 0 }],
    beams: [
      { id: 1, from: 1, to: 3, material: "C24", profile: "96x450" },
      { id: 2, from: 3, to: 2, material: "C24", profile: "96x450" },
    ],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
    loads: [q(1), q(2)],
  };
  const mi = bouwMultiInput({ plates: [], loadCases, selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1, ...model });
  const { perCase } = solveAllCases(mi);
  const combinationResults = new Map(combos.map((c) => [c.id, combineResults(c, perCase)]));
  const r = buildTimberCheckInputs({ nodes: model.nodes, beams: model.beams, supports: model.supports, combinations: combos, combinationResults });
  check("één houtinvoer van 6 m", r.inputs.length === 1 && r.inputs[0].length_m === 6);
  check("staaf 2 overgeslagen met reden", r.skipped.length === 1 && /doorgaande lijn/.test(r.skipped[0].reason));
  check("staaf_notities aanwezig", Array.isArray(r.inputs[0].staaf_notities) && r.inputs[0].staaf_notities.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[11] Twee liggers scharnierend op een middenkolom: geen doorgaande lijn over het momentscharnier");
{
  // Raamwerk met twee beuken van 6 m (vondst bij de voorbeeldprojecten): de
  // IPE 300-liggers 5 en 6 sluiten aan beide einden scharnierend aan op de
  // kolommen. Tot nu toe één lijn van 12 m op kip. Nu elk 6 m, gaffel op de
  // kolom, en het moment per ligger qL²/8 = 1,35·10·6²/8 = 60,75 kNm.
  const ligger = (id, from, to, releases = { startRy: true, endRy: true }) => ({ id, from, to, material: "S235",
    profile: "IPE300", releases });
  // Zonder middenkolom: een Gerberligger, star op de buitenkolommen met één
  // scharnier op knoop 4 (anders een mechanisme).
  const raam = (metKolom) => staal({
    nodes: [{ id: 1, x: 0, z: 0 }, ...(metKolom ? [{ id: 2, x: 6000, z: 0 }] : []), { id: 9, x: 12000, z: 0 },
      { id: 3, x: 0, z: 3500 }, { id: 4, x: 6000, z: 3500 }, { id: 5, x: 12000, z: 3500 }],
    beams: [
      { id: 1, from: 1, to: 3, material: "S235", profile: "HEA160" },
      ...(metKolom ? [{ id: 2, from: 2, to: 4, material: "S235", profile: "HEA160" }] : []),
      { id: 3, from: 9, to: 5, material: "S235", profile: "HEA160" },
      ...(metKolom ? [ligger(5, 3, 4), ligger(6, 4, 5)] : [ligger(5, 3, 4, { endRy: true }), ligger(6, 4, 5, {})]),
    ],
    supports: [{ nodeId: 1, type: "fixed" }, ...(metKolom ? [{ nodeId: 2, type: "fixed" }] : []), { nodeId: 9, type: "fixed" }],
    loads: [q(5), q(6)],
  });
  const r = raam(true);
  const l5 = r.inputs.find((i) => i.beam_id === 5), l6 = r.inputs.find((i) => i.beam_id === 6);
  check("ligger 5 en 6 elk apart getoetst, 6 m (niet één lijn van 12 m)",
    l5?.length_m === 6 && l6?.length_m === 6 && !r.skipped.some((x) => x.beamId === 5 || x.beamId === 6),
    JSON.stringify({ l5: l5?.length_m, l6: l6?.length_m, skipped: r.skipped }));
  check("eind op de middenkolom is een gaffel (geen 'Doorlopend', geen weigering van de kip)",
    (l5?.staafeinden?.eind ?? "Gaffel") === "Gaffel" && (l6?.staafeinden?.begin ?? "Gaffel") === "Gaffel",
    JSON.stringify([l5?.staafeinden, l6?.staafeinden]));
  check("M_Ed per ligger = qL²/8 = 60,75 kNm", approx(maxMy(l5), 60.75, 0.05) && approx(maxMy(l6), 60.75, 0.05),
    `${maxMy(l5)} / ${maxMy(l6)}`);
  // Zonder middenkolom houdt niets de scharnierknoop vast (een Gerberscharnier
  // zonder steun): daar blijft het één lijn, zoals in de kop van doorgaandeLijn.ts.
  const g = raam(false);
  check("zonder middenkolom (Gerberscharnier, niets houdt de knoop vast): wel één lijn van 12 m",
    g.inputs.some((i) => i.beam_id === 5 && i.length_m === 12) && g.skipped.some((x) => x.beamId === 6),
    JSON.stringify(g.inputs.map((i) => [i.beam_id, i.length_m])));
}

log(`\n${"─".repeat(50)}`);
log(`Resultaat: ${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

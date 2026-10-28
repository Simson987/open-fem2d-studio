// Issue #87: resultaten opslaan als .ifcfemresults (IFC4: model + resultaten).
//
// Wat deze test bewijst:
//  1. de exacte getalnotatie: elke double komt na het verschuiven van de
//     decimale komma (mm → m, kN → N, MPa → Pa) BIT-GELIJK terug;
//  2. 2D: een ligger op twee steunpunten plus een portaal met een wandschijf,
//     twee belastinggevallen en twee combinaties, gerekend met de echte
//     solver. Het bestand is geldig (valideerIfc), draagt per geval en
//     combinatie een IfcStructuralResultGroup met HasResults en
//     ResultForLoadGroup, en de oplegreactie staat in newton in het bestand
//     zoals de hand hem geeft (R = qL/2). Teruglezen geeft ALLE getallen
//     exact terug (===, geen tolerantie);
//  3. 3D: een synthetisch resultaat (knopen, reacties, eindkrachten,
//     snedekrachtlijnen, schaalelementen en -knopen) komt exact terug;
//  4. het ingebedde projectbestand komt teken-voor-teken terug, ook met
//     accenten, aanhalingstekens en backslashes;
//  5. twee exports van hetzelfde model zijn identiek (deterministisch).
//
// Draaien: npx tsx test-ifc-resultaten.mjs

const { bouwIfcResultaten, leesIfcResultaten, reeelExact, leesExact } = await import("./src/io/ifcResultaten.ts");
const { valideerIfc } = await import("./src/io/ifcExport.ts");
const { leesStep, StepGetal, StepRef } = await import("./src/io/stepLezer.ts");
const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");
const { solveAllCases } = await import("./src/components/fem/solver/engine.ts");
const { combineResults } = await import("./src/components/fem/solver/combinations.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function ok(naam, cond, detail = "") {
  if (cond) { passed++; log(`  ✓ ${naam}`); }
  else { failed++; log(`  ✗ ${naam}${detail ? ` — ${detail}` : ""}`); }
}

/** Exacte diepe vergelijking; geeft het eerste verschil terug (of null). */
function verschil(a, b, pad = "") {
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) && Number.isNaN(b)) return null;
    return a === b ? null : `${pad}: ${a} ≠ ${b}`;
  }
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return `${pad}: Map-grootte ${a.size} ≠ ${b.size}`;
    for (const [k, v] of a) {
      if (!b.has(k)) return `${pad}: sleutel ${k} ontbreekt`;
      const d = verschil(v, b.get(k), `${pad}[${k}]`);
      if (d) return d;
    }
    return null;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${pad}: lengte ${a.length} ≠ ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = verschil(a[i], b[i], `${pad}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of Object.keys(a)) {
      if (a[k] === undefined) continue;
      const d = verschil(a[k], b[k], `${pad}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : `${pad}: ${String(a)} ≠ ${String(b)}`;
}

// ── 1. Exacte getallen ─────────────────────────────────────────────────────
log("\n[1] Exacte getalnotatie (komma verschuiven in de tekst)");
{
  let fout = null;
  let n = 0;
  // Deterministische pseudo-random reeks (LCG), plus randgevallen.
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const waarden = [1, -1, 0.1, 0.2 + 0.1, 1 / 3, 5e-324, 1.7976931348623157e308, 123456789.123, -0.000123, 2.5e-7];
  for (let i = 0; i < 20000; i++) waarden.push((rnd() - 0.5) * 10 ** Math.floor(rnd() * 24 - 12));
  for (const x of waarden) {
    for (const k of [-3, 0, 3, 6]) {
      const tekst = reeelExact(x, k);
      const terug = leesExact(new StepGetal(tekst, Number(tekst)), k);
      n++;
      if (terug !== x && !fout) fout = `${x} (×10^${k}) → '${tekst}' → ${terug}`;
    }
  }
  ok(`${n} waarden × verschuiving komen bit-gelijk terug`, fout === null, fout ?? "");
  // Ter vergelijking: de naïeve weg (×1000 en terug) is NIET altijd exact.
  let naiefFout = 0;
  for (const x of waarden) if ((x / 1000) * 1000 !== x) naiefFout++;
  ok(`de naïeve weg x/1000·1000 verliest bits bij ${naiefFout} van ${waarden.length} waarden (daarom de tekstverschuiving)`, naiefFout > 0);
  ok("schrijfwijze: 0,00822 kNm/m → '8.22E0' N·m/m", reeelExact(0.00822, 3) === "8.22E0", reeelExact(0.00822, 3));
  ok("schrijfwijze: 5 mm → '5.E-3' m", reeelExact(5, -3) === "5.E-3", reeelExact(5, -3));
  ok("een gewone STEP-waarde '12.5' (ander programma) in m → 12500 mm", leesExact(new StepGetal("12.5", 12.5), -3) === 12500);
}

// ── 2. 2D: echte solver ─────────────────────────────────────────────────────
log("\n[2] 2D: ligger, portaal met wandschijf, gevallen en combinaties");
const projectTekst = JSON.stringify({ format: "open-fem-studio-v2", naam: "Café 'De Brug' \\ test — ±5 kN·m²" });
const model2d = {
  nodes: [
    { id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 },
    // Portaal met wandschijf ernaast.
    { id: 3, x: 10000, z: 0 }, { id: 4, x: 10000, z: 3000 }, { id: 5, x: 14000, z: 3000 }, { id: 6, x: 14000, z: 0 },
  ],
  beams: [
    { id: 1, from: 1, to: 2, material: "S235", profile: "IPE 300" },
    { id: 2, from: 3, to: 4, material: "S235", profile: "HEA 200" },
  ],
  supports: [
    { nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" },
    { nodeId: 3, type: "fixed" }, { nodeId: 6, type: "pinned" },
  ],
  plates: [{ id: 1, nodeIds: [4, 5, 6, 3], thickness: 200, materiaal: "C30/37", meshSize: 1000 }],
  loadCases: [{ id: 1, name: "G", type: "dead" }, { id: 2, name: "Q", type: "live", categorie: "A" }],
  loads: [
    { id: 1, type: "lineLoad", caseId: 1, beamId: 1, q: -5 },
    { id: 2, type: "lineLoad", caseId: 2, beamId: 1, q: -3 },
    { id: 3, type: "pointForce", caseId: 2, nodeId: 4, fx: 10, fz: 0 },
  ],
  selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
};
const { perCase } = solveAllCases(bouwMultiInput(model2d));
const combo = (id, name, type, f) => ({ id, name, type, formula: "", factors: new Map(Object.entries(f).map(([k, v]) => [Number(k), v])) });
const combinaties = [combo(11, "UGT 6.10b", "uls", { 1: 1.2, 2: 1.5 }), combo(12, "BGT kar.", "sls", { 1: 1, 2: 1 })];
const combinatieResultaten = new Map(combinaties.map((c) => [c.id, combineResults(c, perCase)]));
const ifcInvoer = {
  projectNaam: "Resultaten-test",
  nodes: model2d.nodes, beams: model2d.beams, supports: model2d.supports, loads: model2d.loads,
  loadCases: model2d.loadCases, plates: model2d.plates, combinations: combinaties, analysetype: "eersteOrde",
};
const ifc = bouwIfcResultaten(ifcInvoer, { tweeD: { perCase, combinaties: combinatieResultaten }, projectTekst });
{
  const v = valideerIfc(ifc);
  ok("valideerIfc: geen fouten", v.fouten.length === 0, v.fouten.join(" | "));
  ok("deterministisch: tweede export identiek",
    bouwIfcResultaten(ifcInvoer, { tweeD: { perCase, combinaties: combinatieResultaten }, projectTekst }) === ifc);

  const bestand = leesStep(ifc);
  const recs = [...bestand.records.values()];
  const groepen = recs.filter((r) => r.type === "IFCSTRUCTURALRESULTGROUP");
  ok("vier IfcStructuralResultGroup's (2 gevallen + 2 combinaties)", groepen.length === 4, String(groepen.length));
  const model = recs.find((r) => r.type === "IFCSTRUCTURALANALYSISMODEL");
  const hasResults = Array.isArray(model.args[8]) ? model.args[8].map((x) => x.id).sort() : [];
  ok("analysemodel: HasResults wijst naar alle vier groepen",
    JSON.stringify(hasResults) === JSON.stringify(groepen.map((g) => g.id).sort()));
  const geldig = groepen.every((g) => g.args[6] instanceof StepRef
    && bestand.records.get(g.args[6].id)?.type === "IFCSTRUCTURALLOADGROUP");
  ok("elke resultaatgroep: ResultForLoadGroup → een IfcStructuralLoadGroup", geldig);
  const combiGroep = groepen.find((g) => g.args[4] === "OpenFEM:2D:combinatie:11");
  const lg = bestand.records.get(combiGroep.args[6].id);
  ok("combinatie 11 hoort bij een LOAD_COMBINATION-groep", lg.args[5]?.waarde === "LOAD_COMBINATION");
  ok("eerste orde: FIRST_ORDER_THEORY, IsLinear .T.",
    combiGroep.args[5]?.waarde === "FIRST_ORDER_THEORY" && combiGroep.args[7]?.waarde === "T");

  // Handberekening: ligger L = 6 m, q_G = 5 kN/m → R = qL/2 = 15 kN = 15000 N
  // omhoog op knoop 1, in het bestand als ForceZ (newton, SI-eenheid).
  const geval1 = groepen.find((g) => g.args[4] === "OpenFEM:2D:geval:1");
  const toek = recs.find((r) => r.type === "IFCRELASSIGNSTOGROUP" && r.args[6]?.id === geval1.id);
  const reactie = toek.args[4].map((x) => bestand.records.get(x.id))
    .find((r) => r.type === "IFCSTRUCTURALPOINTREACTION" && r.args[4] === "OpenFEM:reactie:1");
  const kracht = bestand.records.get(reactie.args[7].id);
  const Rz = kracht.args[3];
  ok(`hand: R_z,1 = q·L/2 = 5·6/2 = 15 kN → bestand ${Rz} N`, Math.abs(Rz - 15000) < 1e-6);
  // Moment midden: M = qL²/8 = 5·36/8 = 22,5 kNm; in het bestand N·m (MomentZ, lokaal).
  const k = toek.args[4].map((x) => bestand.records.get(x.id))
    .find((r) => r.args[4] === "OpenFEM:staaf:1:krachten");
  const config = bestand.records.get(k.args[7].id);
  const Mmax = Math.max(...config.args[1].map((x) => Math.abs(bestand.records.get(x.id).args[6])));
  ok(`hand: M_max = qL²/8 = 22,5 kNm → bestand ${Mmax} N·m`, Math.abs(Mmax - 22500) < 1e-6);
  const verbonden = recs.filter((r) => r.type === "IFCRELCONNECTSSTRUCTURALACTIVITY"
    && bestand.records.get(r.args[5].id)?.type === "IFCSTRUCTURALCURVEREACTION");
  ok("snedekrachten hangen aan hun IfcStructuralCurveMember",
    verbonden.length > 0 && verbonden.every((r) => bestand.records.get(r.args[4].id)?.type === "IFCSTRUCTURALCURVEMEMBER"));
  ok("plaatelementen als IfcStructuralSurfaceReaction",
    recs.some((r) => r.type === "IFCSTRUCTURALSURFACEREACTION"));
}
{
  const terug = leesIfcResultaten(ifc);
  ok("projectbestand komt teken-voor-teken terug", terug.projectTekst === projectTekst, terug.projectTekst);
  ok("2 gevallen en 2 combinaties gelezen", terug.tweeD.perCase.size === 2 && terug.tweeD.combinaties.size === 2);
  const heeftPlaat = [...perCase.values()].every((r) => (r.plateElements?.[0]?.elements.length ?? 0) > 0);
  ok("het model heeft werkelijk plaatelementen met spanningen", heeftPlaat);
  for (const [id, r] of perCase) {
    const d = verschil(r, terug.tweeD.perCase.get(id), `geval ${id}`);
    ok(`geval ${id}: alle getallen exact gelijk (verplaatsingen, reacties, ${r.elements.size} staven, plaat)`, d === null, d ?? "");
  }
  for (const [id, r] of combinatieResultaten) {
    const d = verschil(r, terug.tweeD.combinaties.get(id), `combinatie ${id}`);
    ok(`combinatie ${id}: alle getallen exact gelijk`, d === null, d ?? "");
  }
}

// ── 3. 3D: synthetisch resultaat ───────────────────────────────────────────
log("\n[3] 3D: knopen, reacties, eindkrachten, snedekrachtlijnen, schaal");
{
  const model3d = {
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 3.2 }, { id: 3, x: 5.4, y: 0, z: 3.2 },
      { id: 4, x: 5.4, y: 4, z: 3.2 }, { id: 5, x: 0, y: 4, z: 3.2 },
    ],
    beams: [
      { id: 1, startNodeId: 1, endNodeId: 2 },
      { id: 2, startNodeId: 2, endNodeId: 3 },
    ],
    supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
    plates: [{ id: 1, nodeIds: [2, 3, 4, 5], thicknessM: 0.2, material: "C30/37" }],
    loads: [{ id: 1, nodeId: 3, caseId: 1, fx: 0, fy: 0, fz: -10, mx: 0, my: 0, mz: 0 }],
  };
  const getal = (i) => Math.sin(i * 12.9898) * 43758.5453 % 1 / 7;
  let i = 0;
  const schaal = () => {
    const v = {};
    for (const k of ["nxxKnPerM", "nyyKnPerM", "nxyKnPerM", "mxxKnmPerM", "myyKnmPerM", "mxyKnmPerM", "vxKnPerM", "vyKnPerM",
      "sigmaXxTopMpa", "sigmaYyTopMpa", "tauXyTopMpa", "vonMisesTopMpa",
      "sigmaXxBottomMpa", "sigmaYyBottomMpa", "tauXyBottomMpa", "vonMisesBottomMpa"]) v[k] = getal(i++);
    return v;
  };
  const diagram = (memberId) => {
    const points = [0, 0.1, 0.25, 0.5, 0.75, 1].map((t) => ({ t, value: getal(i++) * 100 }));
    const vals = points.map((p) => p.value);
    return { memberId, points, maxValue: Math.max(...vals), minValue: Math.min(...vals), maxAbsValue: Math.max(...vals.map(Math.abs)) };
  };
  const resultaat = (analysis) => ({
    schemaVersion: 2,
    engine: { id: "open-fem-3d", name: "Open FEM 3D", revision: "abc123", license: "LGPL" },
    analysis,
    displacements: [1, 2, 3, 4, 5, 1001].map((nodeId) => ({
      nodeId, ux: getal(i++) / 100, uy: getal(i++) / 100, uz: getal(i++) / 100, rx: getal(i++) / 1000, ry: getal(i++) / 1000, rz: getal(i++) / 1000,
    })),
    reactions: [{ nodeId: 1, fx: getal(i++), fy: getal(i++), fz: 123.456, mx: getal(i++), my: getal(i++), mz: getal(i++) }],
    memberForces: [1, 2].map((memberId) => {
      const m = { memberId, lengthM: memberId === 1 ? 3.2 : 5.4 };
      for (const k of ["n", "vy", "vz"]) { m[`${k}StartKn`] = getal(i++); m[`${k}EndKn`] = getal(i++); }
      for (const k of ["torsion", "my", "mz"]) { m[`${k}StartKnm`] = getal(i++); m[`${k}EndKnm`] = getal(i++); }
      return m;
    }),
    diagrams: Object.fromEntries(["momentY", "momentZ", "shearY", "shearZ", "axial", "torsion"].map((c) => [c, [diagram(1), diagram(2)]])),
    buckling: { status: "notApplicable", reason: "x" },
    diagnostics: [],
    shellElements: [11, 12].map((elementId) => ({ elementId, plateId: 1, centroidM: [getal(i++), getal(i++), 3.2], ...schaal() })),
    shellNodes: [1001, 1002].map((nodeId) => ({ nodeId, plateId: 1, wM: getal(i++) / 10, ...schaal() })),
    inactiveMembers: [2],
  });
  const per3d = new Map([[1, resultaat("linear")]]);
  const combi3d = new Map([[11, resultaat("p-delta")]]);
  const ifc3 = bouwIfcResultaten({ ...ifcInvoer, model3d }, {
    tweeD: { perCase, combinaties: combinatieResultaten },
    drieD: { perCase: per3d, combinaties: combi3d },
    projectTekst,
  });
  const v = valideerIfc(ifc3);
  ok("valideerIfc: geen fouten (2D + 3D)", v.fouten.length === 0, v.fouten.join(" | "));
  const bestand = leesStep(ifc3);
  const modellen = [...bestand.records.values()].filter((r) => r.type === "IFCSTRUCTURALANALYSISMODEL");
  const aantallen = modellen.map((m) => (Array.isArray(m.args[8]) ? m.args[8].length : 0)).sort();
  ok("twee analysemodellen met eigen HasResults: 3D 2 groepen, 2D 4 groepen",
    JSON.stringify(aantallen) === "[2,4]", JSON.stringify(aantallen));
  const terug = leesIfcResultaten(ifc3);
  for (const [naam, origineel, gelezen] of [
    ["geval 1", per3d.get(1), terug.drieD.perCase.get(1)],
    ["combinatie 11", combi3d.get(11), terug.drieD.combinaties.get(11)],
  ]) {
    const kern = (r) => ({
      schemaVersion: r.schemaVersion, engine: r.engine, analysis: r.analysis,
      displacements: r.displacements, reactions: r.reactions, memberForces: r.memberForces,
      diagrams: r.diagrams, shellElements: r.shellElements, shellNodes: r.shellNodes, inactiveMembers: r.inactiveMembers,
    });
    const d = verschil(kern(origineel), kern(gelezen ?? {}), naam);
    ok(`3D ${naam}: alle opgeslagen getallen exact gelijk`, d === null, d ?? "");
  }
  const g3 = terug.groepen.find((g) => g.dimensie === "3D" && g.soort === "combinatie");
  ok("3D-combinatie met P-Δ: SECOND_ORDER_THEORY, niet lineair", g3?.theorie === "SECOND_ORDER_THEORY" && g3.lineair === false);
  ok("2D-resultaten staan er ongewijzigd naast",
    verschil(perCase.get(1), terug.tweeD.perCase.get(1)) === null);
}

log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);

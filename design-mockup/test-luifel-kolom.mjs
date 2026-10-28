// De luifel- of T-kolom (issue #199, fase 3, vervolg): een kolom met alleen een
// uitkragende ligger op de kop hangt nergens aan.
//
// Tot oktober 2026 gold de kop van zo'n kolom als gaffel ("er sluit een staaf
// aan"), in 2D (`bepaalStaafeinden`) en in 3D (`openFem3DEinden.vrijEind`). De
// staaltoets nam dan L als kniklengte, terwijl het een ingeklemd-vrije kolom is
// (K = 2, NEN-EN 1993-1-1; de ligger houdt de kop nergens vast). En de eigen
// scheefstand per losse kolom sloeg haar over.
//
// Bewaakt (2D en 3D):
//   1. het eind: de kop van de T-kolom is VRIJ; het inklemmingseind van de
//      ligger blijft een gaffel, haar punt vrij. Met een oplegging onder de
//      punt, een ligger naar een tweede kolom of een hanger naar de grond is de
//      kop weer een gaffel;
//   2. de eigen φ: de T-kolom is een losse kolom; de ligger hangt eraan en
//      krijgt dezelfde φ. ΣH = Σφ_i·V_i (handberekening hieronder);
//   3. de knik: zonder eigen φ 2·L (het veld blijft weg, met de kanttekening),
//      met eigen φ L.
//
// HANDBEREKENING (2D)
//   portaal: stijlen x = 0 en 6000, h = 4000, ligger erop; T-kolom HEA 160 op
//   x = 10 000, h = 4000, ingeklemd; ligger van de kop naar x = 12 000.
//   m = 3 kolomlijnen, h = 4 m: φ_model = 1/200·1,0·√(0,5·(1 + 1/3)) = 1/244,95.
//   T-kolom: h = 4 m, m = 1 → φ_eigen = 1/200.
//   lasten: 100 kN op elke portaalknoop, 30 kN op de punt van de luifel, en
//   2 kN/m op de luifelligger (2 m → 4 kN).
//   ΣH(+x) = 200/244,95 + (30 + 4)/200 = 0,816497 + 0,170000 = 0,986497 kN
//   zonder eigen φ: 234/244,95 = 0,955301 kN.
//   Rx aan de voet van de T-kolom: −(30 + 4)/200 = −0,170 kN.
//
// Uitvoeren: npx tsx test-luifel-kolom.mjs

const { bepaalStaafeinden, hangendDeel } = await import("./src/lib/doorgaandeLijn.ts");
const { bepaalToetsKrachten2D, eigenKolomScheefstand2D, toetsSet2D } = await import("./src/lib/toetsKrachten.ts");
const { zijdelingseKnikInVlakModel } = await import("./src/components/fem/solver/alphaCr.ts");
const { bepaalScheefstand, leidScheefstandGeometrieAf } = await import("./src/lib/scheefstandNorm.ts");
const { openFem3DEinden } = await import("./src/components/openFem3d/openFem3dUitkraging.ts");
const {
  eigenKolomScheefstand3D, leidScheefstandGeometrieAf3D, bepaalScheefstand3D, metScheefstandLasten,
  metScheefstandRichtingen3D, scheefstandVanCombinatie,
} = await import("./src/components/openFem3d/openFem3dScheefstand.ts");
const { parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function check(name, cond, detail = "") {
  if (cond) { passed++; log(`  ✓ ${name}`); }
  else      { failed++; log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const binnen = (a, b, rel) => Math.abs(a - b) <= Math.abs(b) * rel;

// ── 2D ──────────────────────────────────────────────────────────────────────
const S = { material: "S235", profile: "HEA 160" };
const model2D = (extra = {}) => {
  const m = {
    nodes: [
      { id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: 4000 }, { id: 3, x: 6000, z: 0 }, { id: 4, x: 6000, z: 4000 },
      { id: 5, x: 10000, z: 0 }, { id: 6, x: 10000, z: 4000 }, { id: 7, x: 12000, z: 4000 },
    ],
    beams: [
      { id: 1, from: 1, to: 2, ...S }, { id: 2, from: 3, to: 4, ...S }, { id: 3, from: 2, to: 4, ...S },
      { id: 4, from: 5, to: 6, ...S }, { id: 5, from: 6, to: 7, material: "S235", profile: "IPE 200" },
    ],
    supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 3, type: "fixed" }, { nodeId: 5, type: "fixed" }],
    plates: [],
  };
  if (extra.puntOpgelegd) m.supports.push({ nodeId: 7, type: "pinned" });
  if (extra.hanger) {
    m.nodes.push({ id: 8, x: 12000, z: 0 });
    m.beams.push({ id: 6, from: 8, to: 7, material: "S235", profile: "HEA 100" });
    m.supports.push({ nodeId: 8, type: "pinned" });
  }
  if (extra.naarPortaal) m.beams.push({ id: 7, from: 4, to: 6, material: "S235", profile: "IPE 200" });
  return m;
};
const beam = (m, id) => m.beams.find((b) => b.id === id);
const einden = (m, id) => bepaalStaafeinden(beam(m, id), m.nodes, m.beams, m.supports, new Set([id]), m.plates);

log("\n[1] 2D: de kop van de T-kolom is vrij");
{
  const m = model2D();
  check("T-kolom 4: voet gaffel, kop VRIJ (tot oktober 2026: gaffel)",
    JSON.stringify(einden(m, 4)) === JSON.stringify({ begin: "Gaffel", eind: "Vrij" }), JSON.stringify(einden(m, 4)));
  check("luifelligger 5: inklemming op de kolom gaffel, punt vrij",
    JSON.stringify(einden(m, 5)) === JSON.stringify({ begin: "Gaffel", eind: "Vrij" }), JSON.stringify(einden(m, 5)));
  check("portaalstijl 1: kop gaffel (de ligger gaat naar een opgelegde stijl)", einden(m, 1).eind === "Gaffel");
  check("hangendDeel vanaf de kop: staaf 5 en knoop 7",
    JSON.stringify(hangendDeel(6, m, new Set([4]), new Set([5]))) === JSON.stringify({ staafIds: [5], knoopIds: [7] }));
  for (const [naam, extra] of [["oplegging onder de punt", { puntOpgelegd: true }], ["hanger naar de grond", { hanger: true }],
    ["ligger naar het portaal", { naarPortaal: true }]]) {
    const m2 = model2D(extra);
    check(`${naam}: kop weer gaffel en geen losse kolom`,
      einden(m2, 4).eind === "Gaffel" && eigenKolomScheefstand2D(m2).length === 0,
      `${JSON.stringify(einden(m2, 4))} ${JSON.stringify(eigenKolomScheefstand2D(m2))}`);
  }
}

log("\n[2] 2D: de eigen φ van de T-kolom en haar luifel");
const PHI_MODEL = 1 / 200 * Math.sqrt(0.5 * (1 + 1 / 3));
{
  const m = model2D();
  const kolommen = eigenKolomScheefstand2D(m);
  check("één losse kolom: staaf 4 met de aanhangende staaf 5, knopen 6 en 7, φ_eigen = 1/200",
    kolommen.length === 1 && kolommen[0].staafIds.join() === "4" && kolommen[0].aanhangendeStaafIds?.join() === "5"
      && kolommen[0].knoopIds.join() === "6,7" && binnen(kolommen[0].phiEigen, 1 / 200, 1e-12),
    JSON.stringify(kolommen));
  const project = bepaalScheefstand({ bron: "en1993" }, leidScheefstandGeometrieAf(m), ["en1993"]);
  check("model-φ = 1/244,95", binnen(project.noemer, 1 / PHI_MODEL, 1e-9), `${project.noemer}`);
  const basis = {
    nodes: m.nodes, beams: m.beams.map((b) => ({ id: b.id, from: b.from, to: b.to, E: 210000, A: 3877, I: 1.673e7 })),
    supports: m.supports, cases: [{ id: 1, name: "G" }],
    loads: [{ beamId: 5, q: -2, qDir: "z", qCoord: "global", caseId: 1 }],
    pointLoads: [{ nodeId: 2, fz: -100000, caseId: 1 }, { nodeId: 4, fz: -100000, caseId: 1 }, { nodeId: 7, fz: -30000, caseId: 1 }],
  };
  const ULS = { id: 1, name: "G", type: "uls", formula: "", factors: new Map([[1, 1]]) };
  const toets = (eigen) => bepaalToetsKrachten2D({
    basis, combinaties: [ULS], analysetype: "eersteOrde",
    scheefstand: { project, normen: ["en1993"], richting: 1, modelAan: false, ...(eigen ? { eigenKolommen: kolommen } : {}) },
  });
  const met = toets(true), zonder = toets(false);
  const som = (t) => [...t.combinationResults.get(1).reactions.values()].reduce((s, r) => s + r.fx, 0);
  log(`    ΣH met ${(-som(met) / 1e3).toFixed(6)} kN, zonder ${(-som(zonder) / 1e3).toFixed(6)} kN`);
  check("ΣH(+x) met eigen φ = 200/244,95 + 34/200 = 0,986497 kN", binnen(-som(met), 200000 * PHI_MODEL + 34000 / 200, 1e-6), `${-som(met)}`);
  check("ΣH(+x) zonder = 234/244,95 = 0,955301 kN", binnen(-som(zonder), 234000 * PHI_MODEL, 1e-6), `${-som(zonder)}`);
  check("Rx aan de voet van de T-kolom = −34/200 = −0,170 kN",
    binnen(met.combinationResults.get(1).reactions.get(5).fx, -170, 1e-6), `${met.combinationResults.get(1).reactions.get(5).fx}`);
  check("de melding noemt de aanhangende staaf", met.meldingen.some((t) => /staaf 4 met de aanhangende staaf 5/.test(t)));

  log("\n[3] 2D: de knik van de T-kolom");
  const setMet = toetsSet2D(met, { combinaties: [ULS], combinationResults: new Map(), perCase: null }, m.beams);
  const setZonder = toetsSet2D(zonder, { combinaties: [ULS], combinationResults: new Map(), perCase: null }, m.beams);
  const bMet = zijdelingseKnikInVlakModel(setMet.stabiliteit, true, 4, [4]);
  const bZonder = zijdelingseKnikInVlakModel(setZonder.stabiliteit, true, 4, [4]);
  check("met eigen φ: L (veld y = true)", bMet.veld?.y === true, JSON.stringify(bMet));
  check("zonder: 2·L met kanttekening (φ_model 1/244,95 < 1/200)", bZonder.veld === undefined && /2·L/.test(bZonder.notitie ?? ""));
}

// ── 3D ──────────────────────────────────────────────────────────────────────
// Dezelfde opzet in 3D: een portaal (stijlen x = 0 en 6 m, y = 0, h = 4 m) en
// een T-kolom op x = 10 m met een luifel in +X van 2 m. Rijen evenwijdig aan X
// (y = 0): 3 kolommen → m_X = 3; evenwijdig aan Y: elk 1 → m_Y = 1.
//   φ_X = 1/200·1,0·√(0,5·(4/3)) = 1/244,95; φ_Y = 1/200.
//   +X: ΣH = 200/244,95 + 30/200 = 0,966497 kN (zonder: 230/244,95 = 0,938971).
const model3D = (extra = {}) => {
  const vast = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };
  const nodes = [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 4 }, { id: 3, x: 6, y: 0, z: 0 }, { id: 4, x: 6, y: 0, z: 4 },
    { id: 5, x: 10, y: 0, z: 0 }, { id: 6, x: 10, y: 0, z: 4 }, { id: 7, x: 12, y: 0, z: 4 },
  ];
  const beams = [
    { id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA 160", material: "S235" },
    { id: 2, startNodeId: 3, endNodeId: 4, profileName: "HEA 160", material: "S235" },
    { id: 3, startNodeId: 2, endNodeId: 4, profileName: "IPE 200", material: "S235" },
    { id: 4, startNodeId: 5, endNodeId: 6, profileName: "HEA 160", material: "S235" },
    { id: 5, startNodeId: 6, endNodeId: 7, profileName: "IPE 200", material: "S235" },
  ];
  const supports = [1, 3, 5].map((nodeId) => ({ nodeId, ...vast }));
  if (extra.puntOpgelegd) supports.push({ nodeId: 7, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false });
  const load = (id, nodeId, fz) => ({ id, nodeId, fx: 0, fy: 0, fz, mx: 0, my: 0, mz: 0, caseId: 1 });
  const loads = [load(1, 2, -100), load(2, 4, -100), load(3, 7, -30)];
  return parseOpenFem3DModel({ nodes, beams, supports, loads });
};

log("\n[4] 3D: de kop van de T-kolom is vrij, de luifel hangt eraan");
{
  const m = model3D();
  const e = openFem3DEinden(m);
  const b = (id) => m.beams.find((x) => x.id === id);
  check("T-kolom 4: kop vrij, voet niet", e.vrijEind(b(4), 6) && !e.vrijEind(b(4), 5));
  check("luifel 5: op de kolom niet vrij, punt vrij", !e.vrijEind(b(5), 6) && e.vrijEind(b(5), 7));
  check("portaalstijl 1: kop niet vrij", !e.vrijEind(b(1), 2));
  const m2 = model3D({ puntOpgelegd: true });
  const e2 = openFem3DEinden(m2);
  check("oplegging onder de punt: kop niet vrij", !e2.vrijEind(m2.beams.find((x) => x.id === 4), 6));

  const project = bepaalScheefstand3D({ bron: "en1993", noemer: 200 }, leidScheefstandGeometrieAf3D(m), ["en1993"]);
  const phiX = (1 / 200) * Math.sqrt(0.5 * (1 + 1 / 3));
  check("φ_X = 1/244,95 (m_X = 3), φ_Y = 1/200 (m_Y = 1)",
    binnen(project.phi.x, phiX, 1e-12) && binnen(project.phi.y, 1 / 200, 1e-12), JSON.stringify(project.phi));
  const eigen = eigenKolomScheefstand3D(m, project.phi);
  check("één losse kolom: staaf 4 met de luifel 5; φ op staaf 5 en knoop 7 = 1/200",
    eigen.kolommen.length === 1 && eigen.kolommen[0].aanhangendeStaafIds?.join() === "5"
      && binnen(eigen.perStaaf.get(5).x, 1 / 200, 1e-12) && binnen(eigen.perKnoop.get(7).x, 1 / 200, 1e-12),
    JSON.stringify(eigen.kolommen));
  check("oplegging onder de punt: geen losse kolom", eigenKolomScheefstand3D(m2, project.phi).kolommen.length === 0);
  const basis = { id: 1, name: "UGT", type: "uls", formula: "", factors: new Map([[1, 1]]) };
  const [plusX] = metScheefstandRichtingen3D([basis], project.phi);
  const verzoek = {
    nodes: m.nodes, members: m.beams.map((x) => ({ id: x.id, startNodeId: x.startNodeId, endNodeId: x.endNodeId })),
    nodalLoads: m.loads.map(({ caseId: _c, ...l }) => l), memberLoads: [], memberPointLoads: [],
  };
  const som = (v) => v.nodalLoads.slice(verzoek.nodalLoads.length).reduce((t, l) => t + l.fx, 0);
  check("+X met eigen φ: ΣH = 200/244,95 + 30/200 = 0,966497 kN",
    binnen(som(metScheefstandLasten(verzoek, scheefstandVanCombinatie(plusX, project.phi, null, eigen))), 200 * phiX + 0.15, 1e-12));
  check("+X zonder: ΣH = 230/244,95 = 0,938971 kN",
    binnen(som(metScheefstandLasten(verzoek, scheefstandVanCombinatie(plusX, project.phi))), 230 * phiX, 1e-12));
}

log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);

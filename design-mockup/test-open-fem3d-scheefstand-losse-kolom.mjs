// Issue #199, fase 3 (3D): de eigen scheefstand per losse kolom.
//
// Een kolom met een vrije kop hangt nergens aan en middelt haar scheefstand
// met niets. Met de instelling `scheefstandEigenKolom` krijgen haar lasten in
// de UGT-toets φ = max(φ_model, φ_eigen), φ_eigen volgens de norm van haar
// materiaal met h = haar eigen hoogte en m = 1 (vervangen, nooit optellen).
// Daarmee haalt een stalen losse kolom de φ-eis van het vrije eind en krijgt
// zij de systeemlengte L (NEN-EN 1993-1-1 5.2.2(7)b) in plaats van 2·L.
//
// Model: raamwerk 6 × 5 m met vier kolommen HEA 200 van 6 m en liggers op de
// kop, plus een losse kolom HEA 160 van 4 m op x = 20 m, y = 0.
// Handberekening (EN 1993-1-1 (5.5), bron en1993, h_model = 6 m):
//   α_h = 2/√6 = 0,81650
//   rijen evenwijdig aan X: y = 0 (x = 0, 6, 20: 3 kolommen), y = 5 (2) → m_X = 2
//     φ_X = 1/200 · 0,81650 · √0,75 = 1/282,84
//   rijen evenwijdig aan Y: x = 0 (2), x = 6 (2), x = 20 (1) → m_Y = 1
//     φ_Y = 1/200 · 0,81650 · 1 = 1/244,95
//   losse kolom, h = 4 m: α_h = 2/√4 = 1,0, m = 1 → φ_eigen = 1/200
//   toegepast op haar lasten: max(1/282,84, 1/200) = 1/200 in X,
//   max(1/244,95, 1/200) = 1/200 in Y.
// Lasten: 100 kN op elke raamwerkkop, 50 kN op de kop van de losse kolom.
//   +X: ΣH = 4·100/282,84 + 50/200 = 1,41421 + 0,25 = 1,66421 kN
//   zonder de instelling: 450/282,84 = 1,59099 kN
//
// Uitvoeren: npx tsx test-open-fem3d-scheefstand-losse-kolom.mjs (vanuit design-mockup/)
const {
  leidScheefstandGeometrieAf3D, bepaalScheefstand3D, eigenKolomScheefstand3D, metScheefstandLasten,
  metScheefstandRichtingen3D, scheefstandVanCombinatie,
} = await import("./src/components/openFem3d/openFem3dScheefstand.ts");
const { planToetsKrachten3D, stelToetsKrachten3DSamen, toetsSet3D } = await import("./src/components/openFem3d/openFem3dToetsKrachten.ts");
const { openFem3DZijdelingseKnik } = await import("./src/components/openFem3d/openFem3dUitkraging.ts");
const { parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { toetsScheefstand3D: toetsScheefstandSidecar } = await import("./src/mcp/toets3dSidecar.ts");

let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const dichtbij = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

function maakModel({ materiaalLos = "S235", profielLos = "HEA 160", rol } = {}) {
  const nodes = [], beams = [], supports = [], loads = [];
  let n = 1;
  const kop = {};
  for (const [x, y] of [[0, 0], [6, 0], [0, 5], [6, 5]]) {
    nodes.push({ id: n, x, y, z: 0 }, { id: n + 1, x, y, z: 6 });
    beams.push({ id: beams.length + 1, startNodeId: n, endNodeId: n + 1, profileName: "HEA 200", material: "S235" });
    supports.push({ nodeId: n, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true });
    loads.push({ id: loads.length + 1, nodeId: n + 1, fx: 0, fy: 0, fz: -100, mx: 0, my: 0, mz: 0, caseId: 1 });
    kop[`${x},${y}`] = n + 1;
    n += 2;
  }
  for (const [a, b] of [["0,0", "6,0"], ["0,5", "6,5"], ["0,0", "0,5"], ["6,0", "6,5"]]) {
    beams.push({ id: beams.length + 1, startNodeId: kop[a], endNodeId: kop[b], profileName: "IPE 300", material: "S235" });
  }
  // De losse kolom.
  nodes.push({ id: 100, x: 20, y: 0, z: 0 }, { id: 101, x: 20, y: 0, z: 4 });
  beams.push({ id: 50, startNodeId: 100, endNodeId: 101, profileName: profielLos, material: materiaalLos,
    ...(rol !== undefined ? { rollAngleRad: rol } : {}) });
  supports.push({ nodeId: 100, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true });
  loads.push({ id: loads.length + 1, nodeId: 101, fx: 0, fy: 0, fz: -50, mx: 0, my: 0, mz: 0, caseId: 1 });
  return parseOpenFem3DModel({ nodes, beams, supports, loads });
}

const model = maakModel();
const geo = leidScheefstandGeometrieAf3D(model);
const project = bepaalScheefstand3D({ bron: "en1993", noemer: 200 }, geo, ["en1993"]);
const phiX = (1 / 200) * (2 / Math.sqrt(6)) * Math.sqrt(0.75);
const phiY = (1 / 200) * (2 / Math.sqrt(6));

log("[1] de model-φ en de herkenning van de losse kolom");
check("φ_X = 1/282,84 (m_X = 2) en φ_Y = 1/244,95 (m_Y = 1) — hand",
  dichtbij(project.phi.x, phiX, 1e-12) && dichtbij(project.phi.y, phiY, 1e-12),
  `${1 / project.phi.x}, ${1 / project.phi.y}`);
const eigen = eigenKolomScheefstand3D(model, project.phi);
check("precies één losse kolom: staaf 50, h = 4 m, EN 1993, φ_eigen = 1/200 (hand: α_h = 1, m = 1)",
  eigen.kolommen.length === 1 && eigen.kolommen[0].staafIds.join() === "50"
    && dichtbij(eigen.kolommen[0].hoogteM, 4) && eigen.kolommen[0].norm === "en1993"
    && dichtbij(eigen.kolommen[0].phiEigen, 1 / 200, 1e-12),
  JSON.stringify(eigen.kolommen));
check("de raamwerkkolommen (met liggers op de kop) zijn geen losse kolom",
  [1, 2, 3, 4].every((id) => !eigen.perStaaf.has(id)));
check("toegepast op de losse kolom: max(φ_model, φ_eigen) = 1/200 in X en in Y",
  dichtbij(eigen.perStaaf.get(50).x, 1 / 200, 1e-12) && dichtbij(eigen.perStaaf.get(50).y, 1 / 200, 1e-12)
    && dichtbij(eigen.perKnoop.get(101).x, 1 / 200, 1e-12) && !eigen.perKnoop.has(100));

log("\n[2] de lasten: φ_eigen vervangt φ_model op de losse kolom, nooit optellen");
{
  const basis = { id: 1, name: "UGT", type: "uls", formula: "", factors: new Map([[1, 1]]) };
  const [plusX, , plusY] = metScheefstandRichtingen3D([basis], project.phi);
  const verzoek = {
    nodes: model.nodes, members: model.beams.map((b) => ({ id: b.id, startNodeId: b.startNodeId, endNodeId: b.endNodeId })),
    nodalLoads: model.loads.map(({ caseId: _c, ...l }) => l), memberLoads: [], memberPointLoads: [],
  };
  const som = (v, as) => v.nodalLoads.slice(verzoek.nodalLoads.length).reduce((t, l) => t + (as === "x" ? l.fx : l.fy), 0);
  const metX = metScheefstandLasten(verzoek, scheefstandVanCombinatie(plusX, project.phi, null, eigen));
  const zonderX = metScheefstandLasten(verzoek, scheefstandVanCombinatie(plusX, project.phi));
  check("+X met eigen φ: ΣH = 4·100/282,84 + 50/200 = 1,66421 kN (hand)",
    dichtbij(som(metX, "x"), 400 * phiX + 50 / 200, 1e-12), String(som(metX, "x")));
  check("+X zonder: ΣH = 450/282,84 = 1,59099 kN (ongewijzigd)", dichtbij(som(zonderX, "x"), 450 * phiX, 1e-12));
  const kopLos = metX.nodalLoads.slice(verzoek.nodalLoads.length).find((l) => l.nodeId === 101);
  check("op de kop van de losse kolom H = 50/200 = 0,25 kN", dichtbij(kopLos.fx, 0.25, 1e-12), String(kopLos.fx));
  const metY = metScheefstandLasten(verzoek, scheefstandVanCombinatie(plusY, project.phi, null, eigen));
  check("+Y met eigen φ: ΣH = 4·100/244,95 + 50/200 (hand)", dichtbij(som(metY, "y"), 400 * phiY + 0.25, 1e-12));
}

log("\n[3] de φ-eis van het vrije eind: L met de eigen φ, 2·L zonder");
{
  const basis = { id: 1, name: "UGT", type: "uls", formula: "", factors: new Map([[1, 1]]) };
  const uls = metScheefstandRichtingen3D([basis], project.phi);
  const losse = model.beams.find((b) => b.id === 50);
  const met = openFem3DZijdelingseKnik(model, uls, () => "p-delta", project.phi, eigen.perStaaf)(losse);
  const zonder = openFem3DZijdelingseKnik(model, uls, () => "p-delta", project.phi)(losse);
  check("met de eigen φ: om y en om z gedekt (L, NEN-EN 1993-1-1 5.2.2(7)b)",
    met.veld?.y === true && met.veld?.z === true && met.notitie === undefined, JSON.stringify(met));
  check("zonder: φ_X = 1/283 < 1/200 → 2·L met de kanttekening", zonder.notitie?.includes("2·L") && !zonder.veld?.y,
    JSON.stringify(zonder).slice(0, 200));
  // Een 30° om haar as gedraaide kolom: φ_eigen/max(|cos|, |sin|) = (1/200)/0,866.
  const gedraaid = maakModel({ rol: Math.PI / 6 });
  const geoG = leidScheefstandGeometrieAf3D(gedraaid);
  const projG = bepaalScheefstand3D({ bron: "en1993", noemer: 200 }, geoG, ["en1993"]);
  const eigenG = eigenKolomScheefstand3D(gedraaid, projG.phi);
  check("gedraaid 30°: toegepast (1/200)/cos 30° = 1/173,2 (hand), en weer om beide assen gedekt",
    dichtbij(eigenG.perStaaf.get(50).x, (1 / 200) / Math.cos(Math.PI / 6), 1e-12)
      && openFem3DZijdelingseKnik(gedraaid, metScheefstandRichtingen3D([basis], projG.phi), () => "p-delta", projG.phi,
        eigenG.perStaaf)(gedraaid.beams.find((b) => b.id === 50)).veld?.z === true);
}

log("\n[4] andere materialen: φ_eigen volgens hun eigen norm");
{
  const hout = maakModel({ materiaalLos: "GL24h", profielLos: "200x200" });
  const eh = eigenKolomScheefstand3D(hout, project.phi);
  check("houten losse kolom, h = 4 m ≤ 5 m: φ_eigen = 0,005 (EN 1995-1-1 (5.1), hand)",
    eh.kolommen[0]?.norm === "en1995" && dichtbij(eh.kolommen[0].phiEigen, 0.005, 1e-12), JSON.stringify(eh.kolommen));
}

log("\n[5] de UGT-toets en de MCP-weg");
{
  const basis = { id: 1, name: "UGT", type: "uls", formula: "", factors: new Map([[1, 1]]) };
  const met = planToetsKrachten3D({
    model, combinaties: [basis], scheefstand: { project, normen: ["en1993"], modelAan: true, eigenKolom: true },
  });
  check("de toets draagt de eigen φ in elke run", met.runs.length === 4
    && met.runs.every((r) => r.scheefstand?.phiPerStaaf?.get(50) === 1 / 200 && r.scheefstand?.phiPerKnoop?.get(101) === 1 / 200));
  check("de toets meldt de losse kolom met h en φ_eigen",
    met.meldingen.some((m) => m.includes("losse kolom") && m.includes("staaf 50") && m.includes("1/200")), met.meldingen.join(" | "));
  const zonder = planToetsKrachten3D({
    model, combinaties: [basis], scheefstand: { project, normen: ["en1993"], modelAan: true },
  });
  check("zonder de instelling: geen eigen φ (zoals vóór fase 3)",
    zonder.runs.every((r) => r.scheefstand?.phiPerStaaf === undefined) && !zonder.meldingen.some((m) => m.includes("losse kolom")));
  // De toetsset geeft de staaltoets per losse kolom de toegepaste φ mee
  // (`scheefstandPhiPerStaaf`), zodat `openFem3DZijdelingseKnik` L kiest.
  const uitkomsten = new Map(met.runs.map((r) => [r.sleutel, { resultaat: { analysis: "p-delta", forceBalance: { ok: true } } }]));
  const toets = stelToetsKrachten3DSamen(met, uitkomsten);
  const set = toetsSet3D(toets, { combinaties: [basis], combinationResults: new Map() });
  check("de toetsset draagt de φ van de losse kolom naar de staaltoets",
    toets.weigering === null && set.scheefstandPhiPerStaaf?.get(50)?.x === 1 / 200 && set.combinations.length === 4,
    JSON.stringify(toets.weigering));
  const sc = toetsScheefstandSidecar({ scheefstandBron: "en1993", scheefstandEigenKolom: true }, model);
  check("MCP (toets3dSidecar) leest scheefstandEigenKolom uit het projectbestand", sc.eigenKolom === true);
}

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
if (gefaald > 0) process.exit(1);

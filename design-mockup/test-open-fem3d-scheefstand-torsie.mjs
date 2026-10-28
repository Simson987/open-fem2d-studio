// Issue #212: de 3D-scheefstand met een handmatige m per richting en de
// torsievarianten van NEN-EN 1993-1-1 5.3.2(10) (figuur 5.5).
//
// Handberekeningen (EN 1993-1-1 (5.5)): φ = φ0·α_h·α_m, φ0 = 1/200,
// α_h = 2/√h (2/3 ≤ α_h ≤ 1), α_m = √(0,5·(1 + 1/m)).
//
// Hal van 4 × 2 kolommen (x = 0, 6, 12, 18 m; y = 0 en 15 m), h = 6 m:
//   α_h = 2/√6 = 0,81650
//   afgeleid m_X = 4 → φ_X = 1/309,8; m_Y = 2 → φ_Y = 1/282,8 (issue #194)
//   handmatig m_X = 2 → α_m = √0,75 = 0,86603 → φ_X = 0,0035355 = 1/282,84
//   handmatig m_Y = 3 → α_m = √(2/3) = 0,81650 → φ_Y = 0,81650²/200 = 1/300,00
//
// Torsievariant in X (5.3.2(10)): de rijen y = 0 (s = +1) en y = 15 m
// (s = −1) staan tegengesteld scheef. Elke kolomkop draagt F_z = −100 kN:
//   ΣH_X = φ·Σ s·V = φ·(4·100 − 4·100) = 0
//   moment om de verticale as (om de oorsprong): M_z = −Σ y·F_x
//     = −15·4·(−φ·100) = 6000·φ kNm = φ·V_rij·b met V_rij = 400 kN, b = 15 m.
//
// Uitvoeren: npx tsx test-open-fem3d-scheefstand-torsie.mjs (vanuit design-mockup/)
const {
  leidScheefstandGeometrieAf3D, metScheefstandRichtingen3D, metScheefstandLasten,
  scheefstandVanCombinatie, bepaalScheefstand3D, scheefstandToelichting3D, torsieRijen3D,
  trapeziumVanProduct, zonderScheefstandVariant,
} = await import("./src/components/openFem3d/openFem3dScheefstand.ts");
const { planToetsKrachten3D } = await import("./src/components/openFem3d/openFem3dToetsKrachten.ts");
const { eersteOrdeZonderScheefstandOmZ } = await import("./src/components/openFem3d/openFem3dConcreteCheck.ts");
const { parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { SCHEEFSTAND_COMBO_OFFSET } = await import("./src/components/fem/solver/combinations.ts");
const { toetsScheefstand3D: toetsScheefstandSidecar } = await import("./src/mcp/toets3dSidecar.ts");

let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const dichtbij = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// ── De hal ───────────────────────────────────────────────────────────────
const kn = [], st = [], op = [], lasten = [];
let n = 1;
for (const x of [0, 6, 12, 18]) for (const y of [0, 15]) {
  kn.push({ id: n, x, y, z: 0 }, { id: n + 1, x, y, z: 6 });
  st.push({ id: st.length + 1, startNodeId: n, endNodeId: n + 1, profileName: "HEA 200", material: "S235" });
  op.push({ nodeId: n, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true });
  lasten.push({ id: lasten.length + 1, nodeId: n + 1, fx: 0, fy: 0, fz: -100, mx: 0, my: 0, mz: 0, caseId: 1 });
  n += 2;
}
const hal = parseOpenFem3DModel({ nodes: kn, beams: st, supports: op, loads: lasten });
const geo = leidScheefstandGeometrieAf3D(hal);

log("[1] m per richting: afgeleid en handmatig");
{
  const afgeleid = bepaalScheefstand3D({ bron: "en1993", noemer: 200 }, geo, ["en1993"]);
  check("afgeleid m_X = 4, φ_X = 1/309,8", geo.perAs.x.aantalElementen === 4 && dichtbij(1 / afgeleid.phi.x, 309.84, 1e-4),
    String(1 / afgeleid.phi.x));
  check("afgeleid m_Y = 2, φ_Y = 1/282,8", geo.perAs.y.aantalElementen === 2 && dichtbij(1 / afgeleid.phi.y, 282.84, 1e-4),
    String(1 / afgeleid.phi.y));

  const hand = bepaalScheefstand3D({ bron: "en1993", noemer: 200, aantalPerAs: { x: 2, y: 3 } }, geo, ["en1993"]);
  const phiX = (1 / 200) * (2 / Math.sqrt(6)) * Math.sqrt(0.75);
  const phiY = (1 / 200) * (2 / Math.sqrt(6)) * Math.sqrt(0.5 * (1 + 1 / 3));
  check("handmatig m_X = 2 → φ_X = 1/282,84 (hand)", dichtbij(hand.phi.x, phiX, 1e-12) && dichtbij(1 / hand.phi.x, 282.84, 1e-4),
    String(1 / hand.phi.x));
  check("handmatig m_Y = 3 → φ_Y = 1/300,00 (hand)", dichtbij(hand.phi.y, phiY, 1e-12) && dichtbij(1 / hand.phi.y, 300, 1e-9),
    String(1 / hand.phi.y));
  check("m_X en m_Y heten handmatig", hand.x.aantalHandmatig && hand.y.aantalHandmatig && hand.x.aantalElementen === 2 && hand.y.aantalElementen === 3);

  // Alleen m_Y handmatig; de gedeelde m geldt dan voor X.
  const half = bepaalScheefstand3D({ bron: "en1993", noemer: 200, aantalElementen: 6, aantalPerAs: { y: 3 } }, geo, ["en1993"]);
  check("gedeelde m = 6 voor X, eigen m_Y = 3",
    half.x.aantalElementen === 6 && half.y.aantalElementen === 3, `${half.x.aantalElementen}/${half.y.aantalElementen}`);
  const zonder = bepaalScheefstand3D({ bron: "en1993", noemer: 200, aantalPerAs: { x: null, y: null } }, geo, ["en1993"]);
  check("null per richting = de afleiding (bit-gelijk aan zonder aantalPerAs)",
    zonder.phi.x === afgeleid.phi.x && zonder.phi.y === afgeleid.phi.y);

  const tekst = scheefstandToelichting3D(hand, geo);
  check("de toelichting noemt m_X en m_Y handmatig naast de afgeleide m",
    tekst.includes("m_X is handmatig opgegeven: 2 (afgeleid uit de rijen: 4)")
      && tekst.includes("m_Y is handmatig opgegeven: 3 (afgeleid uit de rijen: 2)"), tekst);
  check("zonder torsie meldt de toelichting dat 5.3.2(10) niet is meegenomen",
    tekst.includes("Niet meegenomen") && tekst.includes("5.3.2(10)"));
  const metTorsie = scheefstandToelichting3D(hand, geo, { torsie: true });
  check("met torsie noemt de toelichting de varianten en de buitenste rijen",
    metTorsie.includes("Meegenomen") && metTorsie.includes("y = 0 tot 15000 mm") && metTorsie.includes("x = 0 tot 18000 mm"),
    metTorsie);
}

log("\n[2] de varianten");
const rijen = torsieRijen3D(geo);
check("buitenste rijen: X op y = 0 … 15 m, Y op x = 0 … 18 m",
  JSON.stringify(rijen) === JSON.stringify({ x: { vanM: 0, totM: 15 }, y: { vanM: 0, totM: 18 } }), JSON.stringify(rijen));
const basis = { id: 3, name: "UGT", type: "uls", formula: "", factors: new Map([[1, 1]]) };
{
  const zonderT = metScheefstandRichtingen3D([basis], { x: 0.004, y: 0.004 });
  const metT = metScheefstandRichtingen3D([basis], { x: 0.004, y: 0.004 }, { torsie: rijen });
  check("zonder torsie vier varianten (ongewijzigd)", zonderT.length === 4);
  check("met torsie acht varianten, de torsie op id + 4…7·10⁶",
    metT.length === 8 && metT.slice(4).every((c, i) => c.scheefstandTorsie === true && c.id === 3 + (4 + i) * SCHEEFSTAND_COMBO_OFFSET),
    JSON.stringify(metT.map((c) => [c.id, c.name])));
  check("de eerste vier zijn bit-gelijk aan die zonder torsie",
    JSON.stringify(metT.slice(0, 4).map((c) => ({ ...c, factors: [...c.factors] })))
      === JSON.stringify(zonderT.map((c) => ({ ...c, factors: [...c.factors] }))));
  check("namen: (scheefstand torsie +X) … (scheefstand torsie −Y)",
    metT[4].name === "UGT (scheefstand torsie +X)" && metT[7].name === "UGT (scheefstand torsie −Y)");
  check("zonderScheefstandVariant geeft de basis terug", zonderScheefstandVariant(metT[5]).name === "UGT" && zonderScheefstandVariant(metT[5]).id === 3);
  const alleenX = metScheefstandRichtingen3D([basis], { x: 0.004, y: 0.004 }, { torsie: { x: rijen.x } });
  check("een richting zonder twee rijen krijgt geen torsievariant", alleenX.length === 6);
  let fout = "";
  try { scheefstandVanCombinatie(metT[4], { x: 0.004, y: 0.004 }, null); } catch (e) { fout = e.message; }
  check("een torsievariant zonder rijen weigert met reden", fout.includes("5.3.2(10)"), fout);
}

log("\n[3] de lasten van de torsievariant in X: ΣH = 0, M_z = φ·V_rij·b");
{
  const phi = 1 / 309.84;
  const verzoek = {
    nodes: kn, members: st.map((s) => ({ id: s.id, startNodeId: s.startNodeId, endNodeId: s.endNodeId })),
    nodalLoads: lasten.map(({ caseId: _c, ...l }) => l), memberLoads: [], memberPointLoads: [],
  };
  const uit = metScheefstandLasten(verzoek, { phi, as: "x", richting: 1, torsie: rijen.x });
  const extra = uit.nodalLoads.slice(lasten.length);
  const knoop = new Map(kn.map((k) => [k.id, k]));
  const somX = extra.reduce((t, l) => t + l.fx, 0);
  const mz = extra.reduce((t, l) => t + knoop.get(l.nodeId).x * l.fy - knoop.get(l.nodeId).y * l.fx, 0);
  check("acht horizontale lasten in X, geen in Y", extra.length === 8 && extra.every((l) => l.fy === 0 && l.fz === 0));
  check("ΣH_X = 0 (hand: φ·(4·100 − 4·100))", Math.abs(somX) < 1e-12, String(somX));
  check("M_z = 6000·φ = 19,365 kNm (hand: φ·400 kN·15 m)", dichtbij(mz, 6000 * phi, 1e-12), `${mz} vs ${6000 * phi}`);
  check("rij y = 0: +φ·100 = +0,32275 kN; rij y = 15: −0,32275 kN",
    extra.every((l) => dichtbij(l.fx, (knoop.get(l.nodeId).y === 0 ? 1 : -1) * 100 * phi, 1e-12)));
  // De gewone variant (zonder torsie) blijft φ·ΣV = 8·100·φ in +X.
  const gewoon = metScheefstandLasten(verzoek, { phi, as: "x", richting: 1 });
  const somGewoon = gewoon.nodalLoads.slice(lasten.length).reduce((t, l) => t + l.fx, 0);
  check("de gewone variant: ΣH_X = φ·800 kN (ongewijzigd)", dichtbij(somGewoon, 800 * phi, 1e-12));
  // −richting: alles gespiegeld.
  const min = metScheefstandLasten(verzoek, { phi, as: "x", richting: -1, torsie: rijen.x });
  check("torsie −X: de krachten gespiegeld",
    min.nodalLoads.slice(lasten.length).every((l, i) => l.fx === -extra[i].fx));
}

log("\n[4] een kwadratisch verloop als gelijkwaardig trapezium");
{
  // q(t) = −20·t kN/m over een ligger van 15 m langs Y (x = 0, y = 0 → 15),
  // s(t) = 1 − 2t. Hand: I0 = ∫q·s dt = −10 + 40/3 = 10/3, I1 = ∫q·s·t dt =
  // −20/3 + 10 = 10/3 → T1 = 4·I0 − 6·I1 = −20/3, T2 = 6·I1 − 2·I0 = 40/3.
  const [t1, t2] = trapeziumVanProduct(0, -20, 1, -1);
  check("T1 = −6,667 en T2 = 13,333 (hand)", dichtbij(t1, -20 / 3, 1e-12) && dichtbij(t2, 40 / 3, 1e-12), `${t1}, ${t2}`);
  // Resultante en werklijn gelijk aan de exacte integraal (numeriek, Simpson).
  const N = 2000;
  let r = 0, m = 0;
  for (let i = 0; i <= N; i++) {
    const t = i / N, w = i === 0 || i === N ? 1 : i % 2 ? 4 : 2;
    const f = (-20 * t) * (1 - 2 * t);
    r += w * f; m += w * f * t;
  }
  r /= 3 * N; m /= 3 * N;
  check("resultante en eerste moment gelijk aan ∫q·s (Simpson)",
    dichtbij((t1 + t2) / 2, r, 1e-12) && dichtbij((t1 + 2 * t2) / 6, m, 1e-12), `${r}, ${m}`);
  check("constante s geeft precies (q1·s, q2·s)", JSON.stringify(trapeziumVanProduct(-3, -7, 1, 1)) === JSON.stringify([-3, -7]));

  // In het rekenverzoek: een globale lijnlast in Z op de ligger langs Y.
  const knopen = [{ id: 1, x: 0, y: 0, z: 6 }, { id: 2, x: 0, y: 15, z: 6 }];
  const verzoek = {
    nodes: knopen, members: [{ id: 1, startNodeId: 1, endNodeId: 2 }], nodalLoads: [],
    memberLoads: [{ id: 1, memberId: 1, globalDirection: "z", qStartKnPerM: 0, qEndKnPerM: -20 }],
    memberPointLoads: [],
  };
  const phi = 1 / 300;
  const uit = metScheefstandLasten(verzoek, { phi, as: "x", richting: 1, torsie: { vanM: 0, totM: 15 } });
  const h = uit.memberLoads[1];
  check("de torsielast is een globale lijnlast in X: −φ·T1 → −φ·T2",
    h.globalDirection === "x" && dichtbij(h.qStartKnPerM, -phi * t1, 1e-12) && dichtbij(h.qEndKnPerM, -phi * t2, 1e-12),
    JSON.stringify(h));
  // ΣH = −φ·∫q·s·L = −φ·15·10/3 = −50·φ; zonder torsie −φ·∫q·L = +150·φ.
  check("ΣH_X = −φ·L·I0 = −0,16667 kN (hand)", dichtbij((h.qStartKnPerM + h.qEndKnPerM) / 2 * 15, -50 * phi, 1e-12));

  // Een vlaklast op een plaat: weigeren met reden.
  let fout = "";
  try {
    metScheefstandLasten({ ...verzoek, surfaceLoads: [{ id: 1, plateId: 1, qxKnPerM2: 0, qyKnPerM2: 0, qzKnPerM2: -2 }] },
      { phi, as: "x", richting: 1, torsie: { vanM: 0, totM: 15 } });
  } catch (e) { fout = e.message; }
  check("torsie met een verticale vlaklast op een plaat: geweigerd met reden", fout.includes("vlaklast") && fout.includes("5.3.2(10)"), fout);
}

log("\n[5] de UGT-toets: varianten, α_cr en de melding");
{
  const project = bepaalScheefstand3D({ bron: "en1993", noemer: 200 }, geo, ["en1993"]);
  const plan = planToetsKrachten3D({
    model: hal, combinaties: [basis],
    scheefstand: { project, normen: ["en1993"], modelAan: false, torsie: rijen },
  });
  check("acht P-Δ-runs (4 gewone + 4 torsie)", plan.runs.length === 8 && plan.runs.every((r) => r.analyse === "p-delta"));
  const torsieRuns = plan.runs.filter((r) => r.combinatie.scheefstandTorsie);
  check("de torsieruns dragen de rijen en de φ van hun richting",
    torsieRuns.length === 4 && torsieRuns.every((r) => r.scheefstand?.torsie && r.scheefstand.phi === project.phi[r.scheefstand.as]));
  check("de toets meldt de torsievarianten", plan.meldingen.some((m) => m.includes("5.3.2(10)")), plan.meldingen.join(" | "));
  const zonder = planToetsKrachten3D({
    model: hal, combinaties: [basis], scheefstand: { project, normen: ["en1993"], modelAan: false },
  });
  check("zonder de instelling vier runs, zoals vóór #212", zonder.runs.length === 4 && !zonder.meldingen.some((m) => m.includes("5.3.2(10)")));
  // De MCP-weg leest de instelling uit het projectbestand.
  const sidecar = toetsScheefstandSidecar({ scheefstandBron: "en1993", scheefstandAantalX: 2, scheefstandAantalY: 3, scheefstandTorsie: true }, hal);
  check("MCP (toets3dSidecar): m_X = 2, m_Y = 3 en de torsierijen uit het projectbestand",
    sidecar.project.x.aantalElementen === 2 && sidecar.project.y.aantalElementen === 3
      && JSON.stringify(sidecar.torsie) === JSON.stringify(rijen));
  const sidecarUit = toetsScheefstandSidecar({ scheefstandBron: "en1993" }, hal);
  check("MCP zonder de velden: afgeleid en geen torsie (zoals vóór #212)",
    sidecarUit.torsie === null && sidecarUit.project.x.aantalElementen === 4);
}

log("\n[6] beton §5.8: M_z zonder scheefstand ook over de torsieparen");
{
  // Lineair: het gemiddelde van een tegengesteld paar is het moment zonder
  // scheefstand. Basis 10 kNm, ±1 kNm per paar.
  const p = (variant, mz) => ({ combination_id: 5 + variant * SCHEEFSTAND_COMBO_OFFSET, position_mm: 0, forces: { n_ed: 0, vy_ed: 0, vz_ed: 0, my_ed: 0, mz_ed: mz, t_ed: 0 } });
  const uit = eersteOrdeZonderScheefstandOmZ([p(0, 11), p(1, 9), p(2, 12), p(3, 8), p(4, 10.5), p(5, 9.5), p(6, 13), p(7, 7)]);
  check("alle acht varianten krijgen M_z = 10 kNm", uit.every((q) => q.forces.mz_ed === 10), JSON.stringify(uit.map((q) => q.forces.mz_ed)));
}

log("\n[7] de API: project.sway.set en project.sway.get");
{
  const { PROJECT_COMMANDOS } = await import("./src/api/commands/project.ts");
  const { leegDocument } = await import("./src/api/projectDocument.ts");
  const zet = PROJECT_COMMANDOS.find((c) => c.naam === "project.sway.set");
  const lees = PROJECT_COMMANDOS.find((c) => c.naam === "project.sway.get");
  check("de commando's bestaan", !!zet && !!lees);
  if (zet && lees) {
    const uit = await zet.uitvoeren({ membersX: 2, membersY: 3, torsion: true, source: "en1993" }, { document: leegDocument() });
    check("het document draagt m_X, m_Y en de torsie",
      uit.document.scheefstandAantalX === 2 && uit.document.scheefstandAantalY === 3 && uit.document.scheefstandTorsie === true
        && uit.document.scheefstandBron === "en1993");
    const terug = await lees.uitvoeren({}, { document: uit.document });
    check("project.sway.get leest ze terug",
      terug.uitkomst.membersX === 2 && terug.uitkomst.membersY === 3 && terug.uitkomst.torsion === true, JSON.stringify(terug.uitkomst));
    const weer = await zet.uitvoeren({ membersX: null }, { document: uit.document });
    check("null zet m_X terug op afleiden; de rest blijft", weer.document.scheefstandAantalX === null && weer.document.scheefstandAantalY === 3);
  }
}

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
if (gefaald > 0) process.exit(1);

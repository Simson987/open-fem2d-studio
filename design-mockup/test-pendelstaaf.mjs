// Pendelstaaf (scharnier aan BEIDE einden): condensatie-exactheid.
//
// Bug die deze test borgt: applyEndReleases behandelde K_cc als diagonaal
// bij meerdere released DOF's. De rotaties van een dubbel scharnier zijn
// echter gekoppeld (K(θ1,θ2) = 2EI/L), waardoor een pendelstaaf NEGATIEVE
// dwarsstijfheid kreeg (-6EI/L³ i.p.v. exact 0) en elk model met
// pendelstaven vervuilde.
//
// [1] Matrixniveau: buigblok met [θ1,θ2] gecondenseerd → v-terme exact 0,
//     EA-blok onaangetast.
// [2] Systeemniveau: twee ingeklemde kolommen, toppen gekoppeld met een
//     pendelstaaf, Fx op kolom 1 → exact 50/50-verdeling (gelijke EI),
//     pendel draagt N = -F/2 (druk, trek-positief), geen moment in de
//     pendel.
const { applyEndReleases } = await import("./src/core/solver/Assembler.ts");
const { Matrix } = await import("./src/core/math/Matrix.ts");
const { solveAllCases } = await import("./src/components/fem/solver/engine.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");

function check(name, actual, expected, tolPct = 0.5) {
  const tol = Math.abs(expected) * tolPct / 100 + 1e-9;
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) { passed++; log(`  ✓ ${name}: ${actual.toFixed(6)} ≈ ${expected.toFixed(6)}`); }
  else    { failed++; log(`  ✗ ${name}: ${actual.toFixed(6)} vs ${expected.toFixed(6)}`); }
}

log("\n[1] Condensatie [θ1,θ2] op het buigblok → exact 0 dwarsstijfheid");
{
  const f = 1; // EI/L³ genormaliseerd, L=1
  const K = new Matrix(6, 6);
  const set = (i, j, v) => { K.set(i, j, v); K.set(j, i, v); };
  set(0, 0, 1); set(0, 3, -1); set(3, 3, 1);
  set(1, 1, 12 * f); set(1, 2, 6 * f); set(1, 4, -12 * f); set(1, 5, 6 * f);
  set(2, 2, 4 * f); set(2, 4, -6 * f); set(2, 5, 2 * f);
  set(4, 4, 12 * f); set(4, 5, -6 * f);
  set(5, 5, 4 * f);
  applyEndReleases(K, [2, 5]);
  check("K(v1,v1) = 0", K.get(1, 1), 0);
  check("K(v1,v2) = 0", K.get(1, 4), 0);
  check("K(v2,v2) = 0", K.get(4, 4), 0);
  check("K(u1,u1) = 1 (EA-blok onaangetast)", K.get(0, 0), 1);
  // Krachtcondensatie: symmetrische q-eindkrachten op een dubbel scharnier
  // moeten volledig naar de v-DOF's gaan (elk qL/2), momenten weg.
  const K2 = new Matrix(6, 6);
  const set2 = (i, j, v) => { K2.set(i, j, v); K2.set(j, i, v); };
  set2(0, 0, 1); set2(0, 3, -1); set2(3, 3, 1);
  set2(1, 1, 12 * f); set2(1, 2, 6 * f); set2(1, 4, -12 * f); set2(1, 5, 6 * f);
  set2(2, 2, 4 * f); set2(2, 4, -6 * f); set2(2, 5, 2 * f);
  set2(4, 4, 12 * f); set2(4, 5, -6 * f);
  set2(5, 5, 4 * f);
  const F = [0, 0.5, 1 / 12, 0, 0.5, -1 / 12]; // vaste-inklemmingskrachten qL=1
  applyEndReleases(K2, [2, 5], F);
  check("F(v1) = 0.5 (qL/2)", F[1], 0.5);
  check("F(v2) = 0.5 (qL/2)", F[4], 0.5);
  check("F(θ1) = 0", F[2], 0);
  check("F(θ2) = 0", F[5], 0);
}

log("\n[2] Twee kolommen + pendelstaaf-koppeling, Fx=10 kN op top kolom 1");
{
  const E0 = 210000, A0 = 3877, I0 = 1.673e7, H = 3000, F = 10000;
  const r = solveAllCases({
    nodes: [
      { id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: H },       // kolom 1
      { id: 3, x: 4000, z: 0 }, { id: 4, x: 4000, z: H }, // kolom 2
    ],
    beams: [
      { id: 1, from: 1, to: 2, E: E0, A: A0, I: I0 },
      { id: 2, from: 3, to: 4, E: E0, A: A0, I: I0 },
      { id: 3, from: 2, to: 4, E: E0, A: A0, I: I0, startConnection: "hinge", endConnection: "hinge" },
    ],
    supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 3, type: "fixed" }],
    cases: [{ id: 1, name: "G" }],
    loads: [],
    pointLoads: [{ nodeId: 2, fx: F, caseId: 1 }],
  }).perCase.get(1);

  // De toppen verschillen exact de axiale verkorting van de pendel:
  // Δu = |N|·L_pendel/(EA) — scherper dan "ongeveer gelijk".
  const duVerwacht = (F / 2) * 4000 / (E0 * A0);
  check("topverschil = |N|·L/EA (mm)", r.displacements.get(2).ux - r.displacements.get(4).ux, duVerwacht, 1);
  check("voet 1 draagt F/2 (kN)", Math.abs(r.reactions.get(1).fx) / 1e3, F / 2 / 1e3, 1);
  check("voet 2 draagt F/2 (kN)", Math.abs(r.reactions.get(3).fx) / 1e3, F / 2 / 1e3, 1);
  check("pendel: N = -F/2 (druk, kN)", r.elements.get(3).N / 1e3, -F / 2 / 1e3, 1);
  const p = r.elements.get(3);
  check("pendel: M_start = 0 (kNm)", p.M_start / 1e6, 0, 0.01);
  check("pendel: M_end = 0 (kNm)", p.M_end / 1e6, 0, 0.01);
  check("pendel: geen dwarskracht (kN)", p.V / 1e3, 0, 0.01);
  check("evenwicht ΣFx (kN)", (r.reactions.get(1).fx + r.reactions.get(3).fx + F) / 1e3, 0, 0.001);
}

// [3] Een losse knoop: de melding noemt de KNOOP en de RICHTING. De
//     stelseloplosser zei alleen "Matrix is singular or nearly singular at
//     column N" — een positie in de matrix, geen knoop. Gemeten: pendelstaaf
//     met een scharnier op een scharnieroplegging (column 2), portaal met
//     pendelkolom (column 11), losse knoop (column 6).
//     De eerste twee waren een onbepaalde knoopdraaiing, geen mechanisme: sinds
//     de controle van 12 oktober 2026 (punt B10, issue #191) zet de kern die
//     draaiing vast en rekenen ze, tegen de hand (3a, 3b). Alleen de losse
//     knoop (3c) blijft een weigering.
log("\n[3] Singulier stelsel → knoopnummer en richting in de melding; een vrije knoopdraaiing rekent");
{
  const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");
  const { beeldKernfoutAf } = await import("./src/mcp/fouten.ts");
  const waar = (name, cond, detail = "") => {
    if (cond) { passed++; log(`  ✓ ${name}`); }
    else      { failed++; log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
  };
  const melding = (m) => {
    try { solveAllCases(bouwMultiInput(m)); return null; }
    catch (e) { return e instanceof Error ? e.message : String(e); }
  };
  const st = (id, from, to, extra = {}) => ({ id, from, to, material: "S235", profile: "IPE300", ...extra });
  const basis = {
    plates: [], loadCases: [{ id: 1, name: "G", type: "dead" }],
    selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
  };

  // 3a — vrij opgelegde ligger met een scharnier (Ry) op de scharnieroplegging:
  //      de draaiing van knoop 1 is onbepaald, de ligger zelf niet. Hand:
  //      R = qL/2 = 30 kN, M_midden = qL²/8 = 45 kNm.
  const ligger3a = {
    ...basis,
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }],
    beams: [st(1, 1, 2, { releases: { startRy: true } })],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
    loads: [{ id: 1, type: "lineLoad", caseId: 1, beamId: 1, q: -10 }],
  };
  const m1 = melding(ligger3a);
  waar("scharnier op scharnieroplegging: rekent (was: \"knoop 1 kan vrij draaien\")", m1 === null, m1);
  if (m1 === null) {
    const r = solveAllCases(bouwMultiInput(ligger3a)).perCase.get(1);
    check("3a R₁ = qL/2 (kN)", r.reactions.get(1).fz / 1e3, 30, 0.01);
    check("3a R₂ = qL/2 (kN)", r.reactions.get(2).fz / 1e3, 30, 0.01);
    check("3a M_midden = qL²/8 (kNm)", r.elements.get(1).bendingMoment[10] / 1e6, 45, 0.01);
  }

  // 3b — portaal, pendelkolom met scharnier aan beide einden op een scharniervoet.
  //      Evenwicht: de pendel draagt geen moment en geen dwarskracht, en de
  //      verticale reacties zijn samen q·L = 60 kN.
  const portaal3b = {
    ...basis,
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: 4000 }, { id: 3, x: 6000, z: 4000 }, { id: 4, x: 6000, z: 0 }],
    beams: [st(1, 1, 2, { profile: "HEA200" }), st(2, 2, 3), st(3, 4, 3, { profile: "HEA160", releases: { startRy: true, endRy: true } })],
    supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 4, type: "pinned" }],
    loads: [{ id: 1, type: "lineLoad", caseId: 1, beamId: 2, q: -10 }],
  };
  const m2 = melding(portaal3b);
  waar("pendelkolom op scharniervoet: rekent (was: \"knoop 4 kan vrij draaien\")", m2 === null, m2);
  if (m2 === null) {
    const r = solveAllCases(bouwMultiInput(portaal3b)).perCase.get(1);
    const pendel = r.elements.get(3);
    check("3b ΣR_z = q·L (kN)", (r.reactions.get(1).fz + r.reactions.get(4).fz) / 1e3, 60, 0.01);
    check("3b pendel: M = 0 (kNm)", Math.max(Math.abs(pendel.M_start), Math.abs(pendel.M_end)) / 1e6, 0, 0.01);
    check("3b pendel: V = 0 (kN)", pendel.V / 1e3, 0, 0.01);
    check("3b geen reactiemoment op de scharniervoet (kNm)", r.reactions.get(4).my / 1e6, 0, 0.01);
  }

  // 3c — een losse knoop (een kolom verwijderd, knoop 3 blijft staan).
  const m3 = melding({
    ...basis,
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }, { id: 3, x: 6000, z: 3000 }],
    beams: [st(1, 1, 2)],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
    loads: [{ id: 1, type: "lineLoad", caseId: 1, beamId: 1, q: -10 }],
  });
  waar("losse knoop 3: genoemd als losse knoop",
    /^Het stelsel is singulier: knoop 3 op \(6000, 3000\) mm kan vrij .*losse knoop/.test(m3 ?? ""), m3);
  waar("de oorspronkelijke kolommelding blijft erachter staan (voor diagnose)",
    /Oorspronkelijke melding: Matrix is singular or nearly singular at column \d+/.test(m3 ?? ""));

  // 3d — de MCP-weg geeft de melding ongewijzigd door, niet als "mechanisme".
  const mcp = beeldKernfoutAf(m3 ?? "");
  waar("MCP: herkend, MODEL_ONOPLOSBAAR, tekst ongewijzigd",
    mcp.herkend && mcp.code === "MODEL_ONOPLOSBAAR" && mcp.melding === m3, JSON.stringify(mcp));
}

log(`\n${failed === 0 ? "✅" : "❌"} ${passed} geslaagd, ${failed} gefaald`);
process.exit(failed === 0 ? 0 : 1);

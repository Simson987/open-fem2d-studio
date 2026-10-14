// Controle oktober 2026, punt K5, in 3D: bij een uitkraging meet de staal- en
// de houttoets de zakking vanaf het ingeklemde eind en niet vanaf de koorde
// tussen de verplaatste staafeinden; ℓ_rep = 2·L.
//
// Het geval: uitkraging langs x, L = 3 m, knoop 1 volledig ingeklemd, knoop 2
// vrij, een eindlast P omlaag. Met de hand (Euler-Bernoulli):
//   δ = P·L³/(3·E·I), θ = P·L²/(2·E·I);
//   de lijn w(ξ) = δ·(3ξ² − ξ³)/2 wijkt hoogstens 0,1925·δ af van de koorde
//   (bij ξ = 1 − 1/√3) — dat was de oude toetsmaat.
// Staal HEA 200 (I = 36,92·10⁶ mm⁴), P = 10 kN: δ = 11,608 mm.
// Hout C24 100×300 (E_0,mean = 11 000, I = 2,25·10⁸ mm⁴), P = 2 kN: δ = 7,2727 mm.
//
// Draaien met: npx tsx test-controle-2026-10-3d.mjs

import assert from "node:assert/strict";

const { buildOpenFem3DSteelCheckInputs } = await import("./src/components/openFem3d/openFem3dSteelCheck.ts");
const { buildOpenFem3DTimberCheckInputs } = await import("./src/components/openFem3d/openFem3dTimberCheck.ts");
const { openFem3DMemberFieldDeflectionMm } = await import("./src/components/openFem3d/openFem3dDisplacement.ts");

const L = 3;
const nodes = [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 }];
const vast = { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };
const nul = (nodeId) => ({ nodeId, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 });

/** Het resultaat van een eindlast P (kN) op een uitkraging met stijfheid EI (kNm²). */
function uitkomst(pKn, eiKnm2) {
  const delta = (pKn * L ** 3) / (3 * eiKnm2);
  const theta = (pKn * L ** 2) / (2 * eiKnm2);
  return {
    delta,
    result: {
      // Omlaag: u_z < 0; de rotatie volgt r_y = −dw/dx (zie openFem3dDisplacement).
      displacements: [nul(1), { ...nul(2), uz: -delta, ry: theta }],
      memberForces: [{
        memberId: 1, lengthM: L, nStartKn: 0, nEndKn: 0, vyStartKn: 0, vyEndKn: 0,
        vzStartKn: pKn, vzEndKn: pKn, torsionStartKnm: 0, torsionEndKnm: 0,
        myStartKnm: -pKn * L, myEndKnm: 0, mzStartKnm: 0, mzEndKnm: 0,
      }],
    },
  };
}

let geslaagd = 0;
const dicht = (naam, gemeten, hand, rel) => {
  assert.ok(Math.abs(gemeten - hand) <= rel * Math.abs(hand), `${naam}: ${gemeten} tegen hand ${hand}`);
  geslaagd++;
  console.log(`  ✓ ${naam}: ${gemeten.toFixed(4)} ≈ ${hand.toFixed(4)}`);
};

// ── Staal ──────────────────────────────────────────────────────────────────
{
  const ei = 210e6 * 36.92e-6; // kNm²
  const { delta, result } = uitkomst(10, ei);
  dicht("hand δ staal = 11,608 mm", delta * 1000, 11.608, 1e-3);
  const model = {
    nodes, supports: [vast], loads: [], memberLoads: [],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA 200", material: "S355",
      checkConfig: { deflectionClass: "cantilever" } }],
  };
  // De oude maat (koorde) en de nieuwe (vanaf de inklemming), op dezelfde lijn.
  dicht("koordemaat = 0,1925·δ (de oude toetsmaat)", openFem3DMemberFieldDeflectionMm(model, model.beams[0], result), 0.19245 * delta * 1000, 2e-3);
  dicht("vanaf de inklemming = δ", openFem3DMemberFieldDeflectionMm(model, model.beams[0], result, "begin"), delta * 1000, 1e-6);

  const inv = buildOpenFem3DSteelCheckInputs(model, result).inputs[0];
  assert.equal(inv.is_cantilever, true); geslaagd++;
  assert.deepEqual(inv.staafeinden, { begin: "Gaffel", eind: "Vrij" }); geslaagd++;
  dicht("staal: w naar de kern = zakking vrije eind", -inv.deflection_actual_max_mm, delta * 1000, 1e-6);
  assert.equal(inv.deflection_limit_class, "Cantilever"); geslaagd++;
  assert.equal(inv.deflection_limit_numerator, 250, "buiten Custom de w_max-noemer van A1.4.3(4)"); geslaagd++;
  assert.ok(inv.deflection_notes.some((n) => n.startsWith("Uitkraging: w is de verplaatsing")), "rapportregel"); geslaagd++;
}

// ── Hout ───────────────────────────────────────────────────────────────────
{
  const ei = 11e6 * 2.25e-4; // kNm²
  const { delta, result } = uitkomst(2, ei);
  dicht("hand δ hout = 7,2727 mm", delta * 1000, 7.2727, 1e-4);
  const model = {
    nodes, supports: [vast], loads: [], memberLoads: [],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "100x300", material: "C24" }],
  };
  const inv = buildOpenFem3DTimberCheckInputs(model, result).inputs[0];
  assert.ok(inv, "houten uitkraging getoetst"); geslaagd++;
  dicht("hout: w_inst naar de kern = zakking vrije eind", -inv.deflection_inst_mm, delta * 1000, 1e-6);
  // Zonder klasse "uitkraging", maar met een vrij eind: ℓ_rep = 2·L, dus de
  // vloer-noemers 250 en 333 op de staaflengte gehalveerd.
  assert.equal(inv.deflection_limit_fin, 125); geslaagd++;
  assert.equal(inv.deflection_limit_add, 166.5); geslaagd++;
  assert.ok(inv.deflection_notes.some((n) => n.startsWith("Uitkraging: w is de verplaatsing")), "rapportregel"); geslaagd++;
}

// ── Herziening: welk eind is vrij, de klasse zonder vrij eind, w_add ───────
const { spawnSync } = await import("node:child_process");
const { existsSync } = await import("node:fs");
const { dirname, join, resolve } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOETSBRUG = join(REPO, "src-tauri", "target", "release", process.platform === "win32" ? "toetsbrug.exe" : "toetsbrug");
const kern = (inputs) => {
  const r = spawnSync(TOETSBRUG, [], { input: JSON.stringify({ opdracht: "check_steel_beams", inputs }), encoding: "utf8", maxBuffer: 256 << 20 });
  if (r.status !== 0 || !r.stdout) throw new Error(`toetsbrug faalde: ${(r.stderr ?? "").slice(0, 300)}`);
  return JSON.parse(r.stdout);
};
const heeftKern = existsSync(TOETSBRUG);
const toetsVan = (res, id) => res.checks.find((c) => c.id === id).kind.data;

// [1] Ligger op een wandplaat: de knoop op de plaat is geen vrij eind — op de
//     hoek en ook midden op de rand. Tot de herziening: uitkraging, staal
//     is_cantilever true en hout de noemers gehalveerd (125/166,5).
console.log("\n[3D] Ligger op een wandplaat: geen uitkraging");
{
  // Wand in het vlak x = 5 m, van y = −1 tot 2 m en z = 0 tot 3 m. Knoop 2 ligt
  // midden op de bovenrand (geen hoekknoop); knoop 7 is een hoekknoop.
  const nodes = [
    { id: 1, x: 0, y: 0, z: 3 }, { id: 2, x: 5, y: 0, z: 3 },
    { id: 3, x: 5, y: -1, z: 3 }, { id: 4, x: 5, y: -1, z: 0 }, { id: 5, x: 5, y: 2, z: 0 }, { id: 6, x: 5, y: 2, z: 3 },
    { id: 7, x: 0, y: 2, z: 3 },
  ];
  const steun = (nodeId) => ({ nodeId, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false });
  const nul = (nodeId) => ({ nodeId, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 });
  const L = 5, q = 2, ei = 11e6 * 2.25e-4;
  const krachten = (memberId) => ({ memberId, lengthM: L, nStartKn: 0, nEndKn: 0, vyStartKn: 0, vyEndKn: 0,
    vzStartKn: q * L / 2, vzEndKn: -q * L / 2, torsionStartKnm: 0, torsionEndKnm: 0,
    myStartKnm: 0, myEndKnm: 0, mzStartKnm: 0, mzEndKnm: 0 });
  const result = {
    displacements: [{ ...nul(1), ry: q * L ** 3 / (24 * ei) }, { ...nul(2), ry: -q * L ** 3 / (24 * ei) },
      nul(3), nul(4), nul(5), nul(6), { ...nul(7), ry: -q * L ** 3 / (24 * ei) }],
    memberForces: [krachten(1)],
  };
  const plaat = { id: 1, nodeIds: [3, 4, 5, 6], thicknessM: 0.2, material: "C30/37" };
  for (const [naam, eindknoop] of [["randknoop", 2], ["hoekknoop", 6]]) {
    const basis = { nodes, supports: [steun(1), steun(4), steun(5)], loads: [], memberLoads: [], plates: [plaat] };
    const s = buildOpenFem3DSteelCheckInputs({ ...basis, beams: [{ id: 1, startNodeId: 1, endNodeId: eindknoop, profileName: "IPE 240", material: "S235", checkConfig: { deflectionClass: "floor" } }] }, result).inputs[0];
    assert.equal(s.is_cantilever, false, `staal ${naam}: geen uitkraging`); geslaagd++;
    assert.deepEqual(s.staafeinden, { begin: "Gaffel", eind: "Gaffel" }, `staal ${naam}: geen vrij eind`); geslaagd++;
    assert.ok(!s.deflection_notes.some((n) => n.startsWith("Uitkraging")), `staal ${naam}: koorde`); geslaagd++;
    const h = buildOpenFem3DTimberCheckInputs({ ...basis, beams: [{ id: 1, startNodeId: 1, endNodeId: eindknoop, profileName: "100x300", material: "C24" }] }, result).inputs[0];
    assert.equal(h.deflection_limit_fin, 250, `hout ${naam}: w_fin-noemer 250`); geslaagd++;
    assert.equal(h.deflection_limit_add, 333, `hout ${naam}: w_add-noemer 333`); geslaagd++;
    console.log(`  ✓ ${naam} van de wand: staal en hout geen uitkraging (250/333)`);
  }
  // Tegenproef: zonder plaat is knoop 2 wél vrij (alleen een oplegging op 1).
  const zonder = buildOpenFem3DSteelCheckInputs({ nodes, supports: [steun(1)], loads: [], memberLoads: [],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 240", material: "S235" }] }, result).inputs[0];
  assert.equal(zonder.is_cantilever, true, "zonder plaat is het eind vrij"); geslaagd++;
}

// [2] Balkon: twee uitkragingen met klasse "uitkraging" en een randligger over
//     de koppen. Geen vrij eind, dus tot de herziening de koordemaat (2,234 mm,
//     0,1925·δ); nu vanaf het eind met de kleinste verplaatsing: δ = PL³/3EI.
console.log("\n[3D] Balkon: klasse 'uitkraging' zonder vrij eind meet vanaf de inklemming");
{
  const ei = 210e6 * 36.92e-6, P = 10;
  const delta = (P * L ** 3) / (3 * ei), theta = (P * L ** 2) / (2 * ei);
  const knopen = [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 }, { id: 3, x: L, y: 2, z: 0 }, { id: 4, x: 0, y: 2, z: 0 }];
  const inklem = (nodeId) => ({ nodeId, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true });
  const nul = (nodeId) => ({ nodeId, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 });
  const mf = (memberId, len, v, m0) => ({ memberId, lengthM: len, nStartKn: 0, nEndKn: 0, vyStartKn: 0, vyEndKn: 0,
    vzStartKn: v, vzEndKn: v, torsionStartKnm: 0, torsionEndKnm: 0, myStartKnm: m0, myEndKnm: 0, mzStartKnm: 0, mzEndKnm: 0 });
  const uit = {
    displacements: [nul(1), { ...nul(2), uz: -delta, ry: theta }, { ...nul(3), uz: -delta, ry: theta }, nul(4)],
    memberForces: [mf(1, L, P, -P * L), mf(2, L, P, -P * L), mf(3, 2, 0, 0)],
  };
  for (const [soort, mat, prof] of [["staal", "S355", "HEA 200"], ["hout", "C24", "100x300"]]) {
    const model = { nodes: knopen, supports: [inklem(1), inklem(4)], loads: [], memberLoads: [],
      beams: [
        { id: 1, startNodeId: 1, endNodeId: 2, profileName: prof, material: mat, checkConfig: { deflectionClass: "cantilever" } },
        { id: 2, startNodeId: 4, endNodeId: 3, profileName: prof, material: mat, checkConfig: { deflectionClass: "cantilever" } },
        { id: 3, startNodeId: 2, endNodeId: 3, profileName: prof, material: mat },
      ] };
    const inv = (soort === "staal" ? buildOpenFem3DSteelCheckInputs(model, uit) : buildOpenFem3DTimberCheckInputs(model, uit))
      .inputs.find((x) => x.beam_id === 1);
    const w = -(inv.deflection_actual_max_mm ?? inv.deflection_inst_mm);
    dicht(`${soort}: w = δ = PL³/3EI = 11,608 mm (koorde: 2,234 mm)`, w, delta * 1000, 1e-6);
    assert.ok(inv.deflection_notes.some((n) => n.includes("kleinste verplaatsing")), `${soort}: rapportregel`); geslaagd++;
    if (soort === "staal") { assert.equal(inv.is_cantilever, true); geslaagd++; }
  }
}

// [3] Staal zonder doorbuigingsklasse: een horizontale staaf is een vloerligger,
//     zoals in 2D en in de 3D-houttoets — bij een uitkraging met ℓ_rep = 2·L.
//     HEA 200, L = 3 m, eindlast 10 kN: δ = 11,608 mm tegen 0,004·6000 = 24 mm,
//     UC 0,484. Tot de herziening: "Custom" L/300 op de staaflengte, 10 mm, UC
//     1,161 — 2,4 keer te streng.
console.log("\n[3D] Staal zonder klasse: vloerligger, bij een uitkraging ℓ_rep = 2·L");
{
  const ei = 210e6 * 36.92e-6;
  const { delta, result } = uitkomst(10, ei);
  const model = { nodes, supports: [vast], loads: [], memberLoads: [],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA 200", material: "S355" }] };
  const inv = buildOpenFem3DSteelCheckInputs(model, result).inputs[0];
  assert.equal(inv.deflection_limit_class, "Floor"); geslaagd++;
  assert.equal(inv.deflection_limit_numerator, 250); geslaagd++;
  assert.equal(inv.deflection_add_limit_numerator, 0, "de kern leidt de w_add-grens uit de klasse af"); geslaagd++;
  assert.equal(inv.is_cantilever, true); geslaagd++;
  // Een kolom (verticaal) zonder klasse houdt h/300 uit A1.4.3(7).
  const kolom = buildOpenFem3DSteelCheckInputs({ ...model, nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: L }] },
    { ...result, memberForces: result.memberForces }).inputs[0];
  assert.equal(kolom.deflection_limit_class, "Custom"); geslaagd++;
  assert.equal(kolom.deflection_limit_numerator, 300); geslaagd++;
  console.log("  ✓ horizontaal: Floor/250, is_cantilever; verticaal: h/300");
  if (heeftKern) {
    const r = kern([inv])[0];
    dicht("w_fin grens 0,004·2·3000 = 24 mm", toetsVan(r, "deflection_w_fin").uc.rd, 24.0, 1e-12);
    dicht("w_fin UC = 11,608/24 = 0,484 (tot de herziening 1,161)", toetsVan(r, "deflection_w_fin").uc.uc, delta * 1000 / 24, 1e-6);
  }
}

// [4] w_add bij een tekenwissel: onder G gaat de punt 5 mm OMHOOG, onder G + Q
//     8 mm OMLAAG. w₂ + w₃ = w_tot − w₁ = −8 − (+5) = −13 mm. De 3D-maat is een
//     grootte; tot de herziening werd w_add |w| − |w₁| = 8 − 5 = 3 mm.
console.log("\n[3D] Staal: w_add bij een tekenwissel tussen G en G + Q");
{
  const tip = (dMm) => ({
    // Vorm van een uitkraging met eindlast: θ = 3δ/(2L); omhoog = +u_z, en de
    // rotatie volgt r_y = −dw/dx (zie openFem3dDisplacement).
    displacements: [nul(1), { ...nul(2), uz: dMm / 1000, ry: -(3 * dMm / 1000) / (2 * L) }],
    memberForces: [{ memberId: 1, lengthM: L, nStartKn: 0, nEndKn: 0, vyStartKn: 0, vyEndKn: 0,
      vzStartKn: 1, vzEndKn: 1, torsionStartKnm: 0, torsionEndKnm: 0, myStartKnm: -L, myEndKnm: 0, mzStartKnm: 0, mzEndKnm: 0 }],
  });
  const model = { nodes, supports: [vast], loads: [], memberLoads: [],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA 200", material: "S355", checkConfig: { deflectionClass: "cantilever" } }] };
  const combinations = [
    { id: 10, name: "UGT 6.10b", type: "uls", formula: "", factors: new Map([[1, 1.35], [2, 1.5]]) },
    { id: 20, name: "BGT karakteristiek 6.14b", type: "sls", formula: "", factors: new Map([[1, 1], [2, 1]]) },
    { id: 30, name: "BGT quasi-blijvend 6.16b zonder Q", type: "sls", formula: "", factors: new Map([[1, 1], [2, 0]]) },
  ];
  const inv = buildOpenFem3DSteelCheckInputs(model, tip(-8), {
    combinations, loadCases: [{ id: 1, type: "dead" }, { id: 2, type: "live" }],
    results: new Map([[10, tip(-12)], [20, tip(-8)], [30, tip(5)]]),
  }).inputs[0];
  dicht("w = 8 mm (de grootste |w|)", -inv.deflection_actual_max_mm, 8, 1e-6);
  dicht("w₁ = 5 mm", Math.abs(inv.deflection_permanent_mm), 5, 1e-6);
  dicht("w_add apart naar de kern: 13 mm (verandering van het veld)", -inv.deflection_add_mm, 13, 1e-6);
  if (heeftKern) {
    const r = kern([inv])[0];
    dicht("kern: w_add = 13 mm (tot de herziening 3 mm)", toetsVan(r, "deflection_w_add").uc.ed, 13, 1e-9);
  }
}

console.log(`\nK5 in 3D: ${geslaagd} controles geslaagd`);

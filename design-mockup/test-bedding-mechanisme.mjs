// Issue #246 (controle 26 oktober 2026, N2): de modelcontrole weigerde een
// stabiele ligger op bedding als mechanisme.
//
// WAT ER MISGING
//  Twee staven HEA200/S235 van 6 m op bedding (k = 50 000 kN/m³, b = 200 mm),
//  alleen knoop 1 een `xRoller`, 100 kN op knoop 2. De bedding draagt de
//  ligger verticaal en tegen draaien, maar de modelcontrole telde alleen
//  opleggingen: `validate`, `solve` en `check` weigerden met "kan verticaal
//  zakken" en "niets verhindert … roteert" ([INVOER_ONGELDIG]).
//
// WAT DEZE TEST VASTLEGT
//  [1] Het model van de controle: validate ok:true, solve rekent de lineaire
//      handwaarden volgens Hetényi (oneindig lange ligger, βL_half = 4,5 > π):
//        k·b = 0,05 N/mm³ · 200 mm = 10 N/mm², EI = 210 000 · I_HEA200,
//        β = (kb/(4EI))^¼, w = Pβ/(2kb) = 3,768 mm, M = P/(4β) = 33,18 kNm.
//      (De ligger is eindig en per staaf in segmenten verdeeld; w binnen
//      0,5 %, M binnen 1 %. 2026.41 gaf 3,769 mm en 33,06 kNm.)
//  [2] Zonder enige oplegging: nog steeds een fout, met de reden dat de
//      bedding horizontaal niet steunt (de wrijving in de kern is een
//      numeriek hulpmiddel); de solve weigert ook.
//  [3] Een ECHT mechanisme naast de bedding blijft geweigerd: een kolom op
//      knoop 2, aan beide einden scharnierend, met een vrije kop.
//
// Draaien met: npx tsx test-bedding-mechanisme.mjs  (ook tegen de sidecarbundel)

const { verwerkVerzoek } = await import("./src/mcp/sidecar.ts");
const { resolveSection } = await import("./src/lib/sectionResolver.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? ` — ${extra}` : ""}`); }
}
function check(naam, waarde, verwacht, relTol) {
  const goed = Number.isFinite(waarde) && Math.abs(waarde - verwacht) <= relTol * Math.abs(verwacht);
  ok(`${naam}: ${Number(waarde).toFixed(4)} ≈ ${verwacht.toFixed(4)} (±${(relTol * 100).toFixed(1)} %)`, goed);
}

const COMBI = [{ id: 1, name: "K1", type: "uls", factors: { 1: 1 } }];
const BEDDING = { k: 50000, b: 200 };
const ligger = (supports) => ({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }, { id: 3, x: 12000, z: 0 }],
  beams: [
    { id: 1, from: 1, to: 2, profile: "HEA200", material: "S235", bedding: BEDDING },
    { id: 2, from: 2, to: 3, profile: "HEA200", material: "S235", bedding: BEDDING },
  ],
  supports,
  loadCases: [{ id: 1, name: "P", type: "dead" }],
  loads: [{ id: 1, type: "pointForce", nodeId: 2, fz: -100, caseId: 1 }],
});
const vraag = (op, payload) => verwerkVerzoek({ v: 1, id: 1, op, payload });

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] Ligger op bedding met één xRoller: stabiel, Hetényi");
// ─────────────────────────────────────────────────────────────────────────
{
  const EI = 210000 * resolveSection("S235", "HEA200").I; // N·mm²
  const kb = BEDDING.k * 1e-6 * BEDDING.b;                 // N/mm²
  const beta = (kb / (4 * EI)) ** 0.25;                     // 1/mm
  const P = 100e3;                                          // N
  const w = P * beta / (2 * kb);                            // mm
  const M = P / (4 * beta) / 1e6;                           // kNm
  log(`  hand: β = ${beta.toExponential(4)} /mm, βL/2 = ${(beta * 6000).toFixed(2)}, w = ${w.toFixed(3)} mm, M = ${M.toFixed(2)} kNm`);
  const model = ligger([{ nodeId: 1, type: "xRoller" }]);
  const v = vraag("validate", { model, combinations: COMBI });
  ok("validate ok:true (was: twee mechanismefouten)", v.result?.ok === true, JSON.stringify(v.result?.errors));
  for (const op of ["solve", "check"]) {
    const s = vraag(op, { model, combinations: COMBI });
    ok(`${op} rekent (was: INVOER_ONGELDIG)`, s.ok === true, `${s.error?.code}: ${s.error?.melding}`);
  }
  const s = vraag("solve", { model, combinations: COMBI });
  const r = s.result?.combinations?.["1"];
  check("zakking onder de last = Pβ/(2kb)", -(r?.displacements?.["2"]?.uz), w, 0.005);
  check("moment onder de last = P/(4β)", Math.abs(r?.elements?.["1"]?.M_end), M, 0.01);
  ok("symmetrie: M links = M rechts van de last",
    Math.abs(Math.abs(r?.elements?.["1"]?.M_end) - Math.abs(r?.elements?.["2"]?.M_start)) < 1e-6);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] Alleen bedding, geen oplegging: fout met de horizontale reden");
// ─────────────────────────────────────────────────────────────────────────
{
  const model = ligger([]);
  const v = vraag("validate", { model, combinations: COMBI });
  ok("validate ok:false en noemt de horizontale richting en een xRoller",
    v.result?.ok === false && (v.result?.errors ?? []).some((e) => e.includes("niet horizontaal") && e.includes("xRoller")),
    JSON.stringify(v.result?.errors));
  ok("geen melding 'constructiedeel zonder oplegging' (de bedding steunt het deel)",
    !(v.result?.errors ?? []).some((e) => e.includes("heeft geen enkele oplegging")), JSON.stringify(v.result?.errors));
  const s = vraag("solve", { model, combinations: COMBI });
  ok("solve weigert", s.ok === false, JSON.stringify(s.error));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] Een echt mechanisme naast de bedding blijft geweigerd");
// ─────────────────────────────────────────────────────────────────────────
{
  const model = ligger([{ nodeId: 1, type: "xRoller" }]);
  model.nodes.push({ id: 4, x: 6000, z: 3000 });
  model.beams.push({ id: 3, from: 2, to: 4, profile: "HEA200", material: "S235", releases: { startRy: true, endRy: true } });
  model.loads.push({ id: 2, type: "pointForce", nodeId: 4, fx: 5, caseId: 1 });
  const v = vraag("validate", { model, combinations: COMBI });
  ok("pendelkolom met vrije kop op de ligger: validate ok:false met mechanisme",
    v.result?.ok === false && (v.result?.errors ?? []).some((e) => e.includes("mechanisme") && e.includes("knoop 4")),
    JSON.stringify(v.result?.errors));
  const s = vraag("solve", { model, combinations: COMBI });
  ok("solve weigert met MODEL_ONOPLOSBAAR", s.ok === false && s.error?.code === "MODEL_ONOPLOSBAAR",
    `${s.error?.code}: ${s.error?.melding}`);
}

log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);

// Issue #223 (controle 26 oktober 2026, B5): een dubbele oplegging
// overschreef de eerdere steun en gaf fictieve reacties.
//
// WAT ER MISGING
//  Twee opleggingen op één knoop werden niet per vrijheidsgraad samengevoegd:
//  de engine zette per oplegging ALLE vrijheidsgraden van de knoop opnieuw,
//  dus alleen de laatste telde, en de reactietabel las de EERSTE.
//   - `pinned` dan `rotSpring`: knoop 1 alleen verend tegen rotatie, x en z
//     vrij → weigering "knoop … kan vrij horizontaal verschuiven";
//   - `rotSpring` dan `pinned`: vrij opgelegd gerekend (M_veld 45 kNm), maar
//     een fictief reactiemoment k·θ = 44,98 kNm in de tabel.
//  `validate_fem_model` gaf in alle gevallen `ok: true` zonder melding.
//
// WAT DEZE TEST VASTLEGT (handberekening)
//  [1] IPE300/S235, L = 6 m, q = 10 kN/m, knoop 1 `pinned` + `rotSpring`
//      k = 3EI/L, knoop 2 `zRoller`, in BEIDE volgorden gelijk:
//        κ = kL/(3EI) = 1, M_A = (qL²/8)·κ/(1+κ) = 22,50 kNm,
//        R1 = qL/2 + M_A/L = 33,75 kN, R2 = 26,25 kN,
//        M_veld = R1²/(2q) − M_A = 34,45 kNm, reactiemoment knoop 1 = M_A.
//      (κ en M_A met de EI uit de profieldatabase van de app.)
//      validate: ok:true met een waarschuwing dat de opleggingen per richting
//      zijn samengevoegd.
//  [2] IPE200, L = 4 m, q = 5 kN/m, knoop 1 `pinned` + `rotSpring` k = 1000
//      kNm/rad, knoop 2 `pinned`: M_A = (qL²/8)·κ/(1+κ), R1 = qL/2 + M_A/L;
//      knoop 1 zakt niet (was: 225,5 mm zakking, uitkraging qL²/2 = 40 kNm).
//  [3] `xRoller` + `zSpring` op knoop 1, `zSpring` op knoop 2 (k = 5 kN/mm):
//      in beide volgorden R = 30/30 kN en veerzakking R/k = 6 mm (was:
//      geweigerd, met een melding die van de volgorde afhing).
//  [4] Tegenstrijdig (`pinned` + `zSpring` op één knoop, of twee
//      `rotSpring`): validate ok:false met knoop en richting, solve weigert.
//
// Draaien met: npx tsx test-dubbele-oplegging.mjs  (ook tegen de sidecarbundel)

const { verwerkVerzoek } = await import("./src/mcp/sidecar.ts");
const { resolveSection } = await import("./src/lib/sectionResolver.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? ` — ${extra}` : ""}`); }
}
function check(naam, waarde, verwacht, relTol = 1e-3) {
  const goed = Number.isFinite(waarde) && Math.abs(waarde - verwacht) <= relTol * Math.max(1, Math.abs(verwacht));
  ok(`${naam}: ${Number(waarde).toFixed(4)} ≈ ${verwacht.toFixed(4)}`, goed);
}

const COMBI = [{ id: 1, name: "UGT G", type: "uls", factors: { 1: 1 } }];
const ligger = (profiel, L, q, supports) => ({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: L, z: 0 }],
  beams: [{ id: 1, from: 1, to: 2, profile: profiel, material: "S235" }],
  supports,
  loadCases: [{ id: 1, name: "G", type: "dead" }],
  loads: [{ id: 1, type: "lineLoad", beamId: 1, q: -q, caseId: 1 }],
});
const vraag = (op, payload) => verwerkVerzoek({ v: 1, id: 1, op, payload });
const maxM = (e) => Math.max(...(e?.M_x ?? [NaN]).map((m) => Math.abs(m)));

/** Ligger met verend ingeklemd begin: M_A, R1, R2 en het veldmoment (kN, kNm). */
function handVerend(EI_kNm2, L_m, q, k) {
  const kappa = k * L_m / (3 * EI_kNm2);
  const MA = q * L_m * L_m / 8 * kappa / (1 + kappa);
  const R1 = q * L_m / 2 + MA / L_m;
  return { kappa, MA, R1, R2: q * L_m - R1, Mveld: R1 * R1 / (2 * q) - MA };
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] IPE300, L = 6 m: pinned + rotSpring (k = 3EI/L) in beide volgorden");
// ─────────────────────────────────────────────────────────────────────────
{
  const EI = 210000 * resolveSection("S235", "IPE300").I / 1e9; // kNm²
  const k = 8773.8; // kNm/rad = 3EI/L met I = 8356 cm⁴ (de controle)
  const h = handVerend(EI, 6, 10, k);
  log(`  hand: κ = ${h.kappa.toFixed(4)}, M_A = ${h.MA.toFixed(3)} kNm, R1 = ${h.R1.toFixed(3)} kN, M_veld = ${h.Mveld.toFixed(3)} kNm`);
  ok("hand: κ ≈ 1 en M_A ≈ 22,50 kNm (controle)", Math.abs(h.kappa - 1) < 2e-3 && Math.abs(h.MA - 22.5) < 0.03);
  for (const [naam, supports] of [
    ["pinned → rotSpring", [{ nodeId: 1, type: "pinned" }, { nodeId: 1, type: "rotSpring", k }, { nodeId: 2, type: "zRoller" }]],
    ["rotSpring → pinned", [{ nodeId: 1, type: "rotSpring", k }, { nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }]],
  ]) {
    const model = ligger("IPE300", 6000, 10, supports);
    const v = vraag("validate", { model, combinations: COMBI });
    ok(`${naam}: validate ok:true`, v.result?.ok === true, JSON.stringify(v.result?.errors));
    ok(`${naam}: validate meldt de samenvoeging per richting`,
      (v.result?.warnings ?? []).some((w) => w.includes("Knoop 1 heeft meer dan één oplegging")
        && w.includes("x star, z star, rotatie verend")), JSON.stringify(v.result?.warnings));
    const s = vraag("solve", { model, combinations: COMBI, detail: "stations" });
    ok(`${naam}: solve rekent (was: weigering resp. vrij opgelegd)`, s.ok === true, s.error?.melding ?? "");
    const r = s.result?.combinations?.["1"];
    check(`${naam}: inklemmingsmoment staaf |M_start| = M_A`, Math.abs(r?.elements?.["1"]?.M_start), h.MA);
    check(`${naam}: reactiemoment knoop 1 = M_A (was 44,98 fictief)`, Math.abs(r?.reactions?.["1"]?.my), h.MA);
    check(`${naam}: R1 = qL/2 + M_A/L`, r?.reactions?.["1"]?.fz, h.R1);
    check(`${naam}: R2 = qL/2 − M_A/L`, r?.reactions?.["2"]?.fz, h.R2);
    // Het veldmaximum valt tussen twee stations (x = R1/q = 3,375 m); de
    // stations liggen 0,3 m uit elkaar, dus binnen 0,2 % onder het maximum.
    check(`${naam}: veldmoment (stations) ≈ R1²/(2q) − M_A`, maxM(r?.elements?.["1"]), h.Mveld, 2e-3);
    ok(`${naam}: geen horizontale verplaatsing van knoop 1`, Math.abs(r?.displacements?.["1"]?.ux ?? NaN) < 1e-9
      && Math.abs(r?.displacements?.["1"]?.uz ?? NaN) < 1e-9);
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] IPE200, L = 4 m, q = 5 kN/m: pinned + rotSpring k = 1000, knoop 2 pinned");
// ─────────────────────────────────────────────────────────────────────────
{
  const EI = 210000 * resolveSection("S235", "IPE200").I / 1e9;
  const h = handVerend(EI, 4, 5, 1000);
  const model = ligger("IPE200", 4000, 5, [
    { nodeId: 1, type: "pinned" }, { nodeId: 1, type: "rotSpring", k: 1000 }, { nodeId: 2, type: "pinned" },
  ]);
  const s = vraag("solve", { model, combinations: COMBI });
  ok("solve rekent", s.ok === true, s.error?.melding ?? "");
  const r = s.result?.combinations?.["1"];
  check(`M_A = (qL²/8)·κ/(1+κ) = ${h.MA.toFixed(3)} kNm (was 40 = qL²/2)`, Math.abs(r?.elements?.["1"]?.M_start), h.MA);
  check("R1 = qL/2 + M_A/L (was 0)", r?.reactions?.["1"]?.fz, h.R1);
  ok("knoop 1 zakt niet (was 225,5 mm)", Math.abs(r?.displacements?.["1"]?.uz ?? NaN) < 1e-9);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] xRoller + zSpring op knoop 1, zSpring op knoop 2: volgorde-onafhankelijk");
// ─────────────────────────────────────────────────────────────────────────
for (const [naam, eerst] of [["xRoller → zSpring", true], ["zSpring → xRoller", false]]) {
  const een = [{ nodeId: 1, type: "xRoller" }, { nodeId: 1, type: "zSpring", k: 5 }];
  const model = ligger("IPE300", 6000, 10, [...(eerst ? een : een.reverse()), { nodeId: 2, type: "zSpring", k: 5 }]);
  const v = vraag("validate", { model, combinations: COMBI });
  ok(`${naam}: validate ok:true`, v.result?.ok === true, JSON.stringify(v.result?.errors));
  const s = vraag("solve", { model, combinations: COMBI });
  ok(`${naam}: solve rekent (was: geweigerd)`, s.ok === true, s.error?.melding ?? "");
  const r = s.result?.combinations?.["1"];
  check(`${naam}: R1 = 30 kN`, r?.reactions?.["1"]?.fz, 30);
  check(`${naam}: R2 = 30 kN`, r?.reactions?.["2"]?.fz, 30);
  check(`${naam}: veerzakking knoop 1 = R/k = −6 mm`, r?.displacements?.["1"]?.uz, -6);
  check(`${naam}: veerzakking knoop 2 = R/k = −6 mm`, r?.displacements?.["2"]?.uz, -6);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] Tegenstrijdige opleggingen: geweigerd met knoop en richting");
// ─────────────────────────────────────────────────────────────────────────
for (const [naam, supports, richting] of [
  ["pinned + zSpring", [{ nodeId: 1, type: "pinned" }, { nodeId: 1, type: "zSpring", k: 5 }, { nodeId: 2, type: "zRoller" }],
    "verticale richting (z)"],
  ["twee rotSpring", [{ nodeId: 1, type: "pinned" }, { nodeId: 1, type: "rotSpring", k: 100 },
    { nodeId: 1, type: "rotSpring", k: 200 }, { nodeId: 2, type: "zRoller" }], "rotatie (ry)"],
]) {
  const model = ligger("IPE300", 6000, 10, supports);
  const v = vraag("validate", { model, combinations: COMBI });
  const fout = (v.result?.errors ?? []).find((e) => e.includes("Knoop 1 heeft twee opleggingen")) ?? "";
  ok(`${naam}: validate ok:false met knoop 1 en de ${richting}`, v.result?.ok === false && fout.includes(richting),
    JSON.stringify(v.result?.errors));
  const s = vraag("solve", { model, combinations: COMBI });
  ok(`${naam}: solve weigert met MODEL_ONOPLOSBAAR`, s.ok === false && s.error?.code === "MODEL_ONOPLOSBAAR"
    && (s.error?.melding ?? "").includes("Knoop 1 heeft twee opleggingen"),
    `${s.error?.code}: ${s.error?.melding}`);
}

log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);

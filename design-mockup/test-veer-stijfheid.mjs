// Issue #222 (controle 26 oktober 2026, B4): een veer met niet-positieve
// stijfheid werd stil als star steunpunt berekend.
//
// WAT ER MISGING
//  Een 2D-`zSpring` met k = −5 kN/mm of k = 0 rekende als star steunpunt.
//  `validate_fem_model` gaf alleen een waarschuwing ("rekent daarom als een
//  starre oplegging") en `ok: true`; `solve_fem_model` rekende met
//  `warnings: []`. Bedoeld was +5 kN/mm: zakking 6 mm werd 0 mm (−100 %),
//  doorbuiging midden 12,61 mm werd 9,61 mm (−24 %).
//
// WAT DEZE TEST VASTLEGT (handberekening; IPE300/S235, L = 6 m, q = 10 kN/m)
//  [1] k = −5, k = 0 en geen k: validate ok:false met knoop en reden, solve
//      weigert (MODEL_ONOPLOSBAAR) in plaats van star te rekenen.
//  [2] De bedoelde k = +5 kN/mm = 5000 kN/m rekent de handwaarden:
//        R1 = R2 = qL/2 = 30 kN, veerzakking R/k = 30/5 = 6,00 mm,
//        doorbuiging midden = 5qL⁴/(384EI) + 6/2 = 9,61 + 3,00 = 12,61 mm,
//        M_midden = qL²/8 = 45 kNm.
//  [3] Ook een rotatieveer en een horizontale veer met k <= 0 worden
//      geweigerd.
//
// Draaien met: npx tsx test-veer-stijfheid.mjs  (ook tegen de sidecarbundel)

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
// Knoop 3 in het midden, zodat de doorbuiging daar een knoopverplaatsing is.
const ligger = (veer, eerste = { nodeId: 1, type: "pinned" }) => ({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 3, x: 3000, z: 0 }, { id: 2, x: 6000, z: 0 }],
  beams: [
    { id: 1, from: 1, to: 3, profile: "IPE300", material: "S235" },
    { id: 2, from: 3, to: 2, profile: "IPE300", material: "S235" },
  ],
  supports: [eerste, { nodeId: 2, ...veer }],
  loadCases: [{ id: 1, name: "G", type: "dead" }],
  loads: [
    { id: 1, type: "lineLoad", beamId: 1, q: -10, caseId: 1 },
    { id: 2, type: "lineLoad", beamId: 2, q: -10, caseId: 1 },
  ],
});
const vraag = (op, payload) => verwerkVerzoek({ v: 1, id: 1, op, payload });

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] zSpring met k = −5, k = 0 of zonder k: geweigerd, niet star");
// ─────────────────────────────────────────────────────────────────────────
for (const [naam, veer, reden] of [
  ["k = −5 kN/mm", { type: "zSpring", k: -5 }, "met stijfheid k = −5 kN/mm"],
  ["k = 0", { type: "zSpring", k: 0 }, "met stijfheid k = 0 kN/mm"],
  ["zonder k", { type: "zSpring" }, "zonder stijfheid (`k` ontbreekt)"],
]) {
  const model = ligger(veer);
  const v = vraag("validate", { model, combinations: COMBI });
  const fout = (v.result?.errors ?? []).find((e) => e.startsWith("Oplegging op knoop 2 is een verticale veer (zSpring)")) ?? "";
  ok(`${naam}: validate ok:false (was ok:true met waarschuwing)`, v.result?.ok === false && fout.includes(reden),
    JSON.stringify(v.result?.errors));
  ok(`${naam}: geen waarschuwing meer dat hij star rekent`,
    !(v.result?.warnings ?? []).some((w) => w.includes("starre oplegging")), JSON.stringify(v.result?.warnings));
  const s = vraag("solve", { model, combinations: COMBI });
  ok(`${naam}: solve weigert met MODEL_ONOPLOSBAAR (was: star, warnings [])`,
    s.ok === false && s.error?.code === "MODEL_ONOPLOSBAAR" && (s.error?.melding ?? "").includes(reden),
    `${s.error?.code}: ${s.error?.melding ?? JSON.stringify(s.result?.combinations?.["1"]?.displacements?.["2"])}`);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] De bedoelde k = +5 kN/mm: handwaarden");
// ─────────────────────────────────────────────────────────────────────────
{
  const EI = 210000 * resolveSection("S235", "IPE300").I; // N·mm²
  const q = 10, L = 6000, k = 5; // N/mm, mm, kN/mm
  const wBuiging = 5 * q * L ** 4 / (384 * EI);
  const wVeer = (q * L / 2 / 1000) / k;
  log(`  hand: buiging ${wBuiging.toFixed(3)} mm + halve veerzakking ${(wVeer / 2).toFixed(3)} mm`);
  const model = ligger({ type: "zSpring", k });
  const v = vraag("validate", { model, combinations: COMBI });
  ok("validate ok:true", v.result?.ok === true, JSON.stringify(v.result?.errors));
  const s = vraag("solve", { model, combinations: COMBI });
  ok("solve rekent", s.ok === true, s.error?.melding ?? "");
  const r = s.result?.combinations?.["1"];
  check("R1 = qL/2 = 30 kN", r?.reactions?.["1"]?.fz, 30);
  check("R2 (veer) = qL/2 = 30 kN", r?.reactions?.["2"]?.fz, 30);
  check("veerzakking knoop 2 = R/k = −6,00 mm (was 0)", r?.displacements?.["2"]?.uz, -wVeer);
  check("doorbuiging midden = −(5qL⁴/384EI + 3,00) = −12,61 mm (was −9,61)", r?.displacements?.["3"]?.uz,
    -(wBuiging + wVeer / 2));
  check("M_midden = qL²/8 = 45 kNm", Math.abs(r?.elements?.["1"]?.M_end), 45);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] Rotatie- en horizontale veer met k <= 0: ook geweigerd");
// ─────────────────────────────────────────────────────────────────────────
for (const [naam, veer, eerste, deel] of [
  ["rotSpring k = −1", { type: "rotSpring", k: -1 }, { nodeId: 1, type: "pinned" }, "rotatieveer (rotSpring)"],
  ["xSpring k = 0", { type: "xSpring", k: 0 }, { nodeId: 1, type: "zRoller" }, "horizontale veer (xSpring)"],
]) {
  const model = ligger(veer, eerste);
  model.supports.push({ nodeId: 2, type: "zRoller" });
  const v = vraag("validate", { model, combinations: COMBI });
  ok(`${naam}: validate ok:false`, v.result?.ok === false
    && (v.result?.errors ?? []).some((e) => e.startsWith(`Oplegging op knoop 2 is een ${deel}`)),
    JSON.stringify(v.result?.errors));
  const s = vraag("solve", { model, combinations: COMBI });
  ok(`${naam}: solve weigert`, s.ok === false && (s.error?.melding ?? "").includes(deel),
    `${s.error?.code}: ${s.error?.melding}`);
}

log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);

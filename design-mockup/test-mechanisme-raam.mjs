// Issue #248 (controle 26 oktober 2026, N4): `validate_fem_model` keurde een
// scharnierend raam met een mechanisme goed.
//
// WAT ER MISGING
//  Een rechthoekig raam met alle staafeinden scharnierend (startRy en endRy
//  vrij) op twee scharnieropleggingen kan als parallellogram scheefvallen.
//  De validatie toetste alleen noodzakelijke voorwaarden (x, z en rotatie van
//  het geheel ergens gesteund) en gaf `ok: true` zonder melding; de berekening
//  weigerde daarna terecht ("knoop 3 … kan vrij horizontaal verschuiven").
//
// WAT DEZE TEST VASTLEGT
//  [1] Raam zonder diagonaal, horizontale (F_x = 10 kN) en verticale
//      (F_z = −10 kN) last op knoop 2: validate ok:false met een
//      mechanismemelding die dezelfde knoop en richting noemt als de solve;
//      solve weigert met MODEL_ONOPLOSBAAR.
//  [2] Met een scharnierende diagonaal 1→3 is het raam een stabiel vakwerk:
//      validate ok:true, solve rekent de handwaarden (evenwicht):
//        tan α = 4/6, N_diag = F/cos α = 10·√(6²+4²)/6 = 12,019 kN (trek),
//        N_ligger = −10 kN, N_kolom3 = −F·h/b = −10·4/6 = −6,667 kN,
//        R1: F_x = −10 kN, F_z = −6,667 kN; R4: F_z = +6,667 kN.
//  [3] Geen valse weigering: een vakwerk met alleen scharnierende staven
//      (onbepaalde knoopdraaiingen, die de kern vastzet) en een ingeklemde
//      portaalvorm blijven door de validatie komen.
//
// Draaien met: npx tsx test-mechanisme-raam.mjs  (ook tegen de sidecarbundel)

const { verwerkVerzoek } = await import("./src/mcp/sidecar.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? ` — ${extra}` : ""}`); }
}
function check(naam, waarde, verwacht, absTol = 1e-3) {
  const goed = Number.isFinite(waarde) && Math.abs(waarde - verwacht) <= absTol;
  ok(`${naam}: ${Number(waarde).toFixed(4)} ≈ ${verwacht.toFixed(4)}`, goed);
}

const COMBI = [{ id: 1, name: "UGT G", type: "uls", factors: { 1: 1 } }];
const SCHARNIER = { startRy: true, endRy: true };
const raam = ({ diagonaal, last }) => ({
  nodes: [
    { id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: 4000 },
    { id: 3, x: 6000, z: 4000 }, { id: 4, x: 6000, z: 0 },
  ],
  beams: [[1, 1, 2], [2, 2, 3], [3, 4, 3], ...(diagonaal ? [[4, 1, 3]] : [])]
    .map(([id, from, to]) => ({ id, from, to, profile: "HEA200", material: "S235", releases: SCHARNIER })),
  supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 4, type: "pinned" }],
  loadCases: [{ id: 1, name: "G", type: "dead" }],
  loads: [{ id: 1, type: "pointForce", nodeId: 2, ...last, caseId: 1 }],
});
const vraag = (op, payload) => verwerkVerzoek({ v: 1, id: 1, op, payload });

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] Raam zonder diagonaal: validate meldt het mechanisme, solve weigert");
// ─────────────────────────────────────────────────────────────────────────
for (const [naam, last] of [["H (F_x = 10 kN)", { fx: 10 }], ["V (F_z = −10 kN)", { fz: -10 }]]) {
  const model = raam({ diagonaal: false, last });
  const v = vraag("validate", { model, combinations: COMBI });
  ok(`${naam}: validate ok:false (was ok:true zonder melding)`, v.ok && v.result?.ok === false,
    JSON.stringify(v.result));
  const melding = (v.result?.errors ?? []).find((e) => /mechanisme/.test(e)) ?? "";
  ok(`${naam}: de melding noemt mechanisme, knoop 3 en horizontaal verschuiven`,
    /knoop 3/.test(melding) && /horizontaal verschuiven/.test(melding), melding);
  const s = vraag("solve", { model, combinations: COMBI });
  ok(`${naam}: solve weigert met MODEL_ONOPLOSBAAR`, s.ok === false && s.error?.code === "MODEL_ONOPLOSBAAR",
    `${s.error?.code}: ${s.error?.melding}`);
  ok(`${naam}: validate en solve noemen dezelfde knoop en richting`,
    (s.error?.melding ?? "").includes("knoop 3 op (6000, 4000) mm kan vrij horizontaal verschuiven (x)")
      && melding.includes("knoop 3 op (6000, 4000) mm kan vrij horizontaal verschuiven (x)"));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] Met scharnierende diagonaal: stabiel vakwerk, handwaarden");
// ─────────────────────────────────────────────────────────────────────────
{
  const model = raam({ diagonaal: true, last: { fx: 10 } });
  const v = vraag("validate", { model, combinations: COMBI });
  ok("validate ok:true", v.result?.ok === true, JSON.stringify(v.result?.errors));
  const s = vraag("solve", { model, combinations: COMBI });
  ok("solve rekent", s.ok === true, s.error?.melding ?? "");
  const r = s.result?.combinations?.["1"];
  const nDiag = 10 * Math.hypot(6, 4) / 6;
  check("N diagonaal = F/cos α = +12,019 kN", r?.elements?.["4"]?.N, nDiag);
  check("N ligger = −10,0 kN", r?.elements?.["2"]?.N, -10);
  check("N kolom 3 = −F·h/b = −6,667 kN", r?.elements?.["3"]?.N, -10 * 4 / 6);
  check("R1 F_x = −10 kN", r?.reactions?.["1"]?.fx, -10);
  check("R1 F_z = −6,667 kN", r?.reactions?.["1"]?.fz, -10 * 4 / 6);
  check("R4 F_z = +6,667 kN", r?.reactions?.["4"]?.fz, 10 * 4 / 6);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] Geen valse weigering van stabiele modellen");
// ─────────────────────────────────────────────────────────────────────────
{
  // Driehoeksvakwerk, alle staven scharnierend: de knoopdraaiingen zijn
  // onbepaald en worden door de kern vastgezet — geen mechanisme.
  const vakwerk = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }, { id: 3, x: 3000, z: 2000 }],
    beams: [[1, 1, 2], [2, 1, 3], [3, 3, 2]]
      .map(([id, from, to]) => ({ id, from, to, profile: "HEA200", material: "S235", releases: SCHARNIER })),
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
    loadCases: [{ id: 1, name: "G", type: "dead" }],
    loads: [{ id: 1, type: "pointForce", nodeId: 3, fz: -10, caseId: 1 }],
  };
  const v = vraag("validate", { model: vakwerk, combinations: COMBI });
  ok("scharnierend driehoeksvakwerk: validate ok:true", v.result?.ok === true, JSON.stringify(v.result?.errors));
  // Hetzelfde raam zonder scharnieren: een portaal, stabiel.
  const portaal = raam({ diagonaal: false, last: { fx: 10 } });
  for (const b of portaal.beams) delete b.releases;
  const p = vraag("validate", { model: portaal, combinations: COMBI });
  ok("star portaal op scharnieren: validate ok:true", p.result?.ok === true, JSON.stringify(p.result?.errors));
}

log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);

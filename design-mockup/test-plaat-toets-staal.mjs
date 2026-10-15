// Plaattoets STAAL (issue #15, stap 1): van model tot unity check.
//
// WAT HIER VASTLIGT
//  [a] De bouwer (`lib/plaatCheckBuilder`) zet de elementspanningen van elke
//      doorgerekende UGT-combinatie ONGEWIJZIGD in de kerninvoer, met het
//      materiaal zoals de stijfheid het herkende en de dikte waarmee gerekend
//      is. BGT-combinaties gaan niet mee.
//  [b] Een plaat zonder materiaal, of met een onbruikbaar materiaal, gaat niet
//      naar de kern maar staat met reden in `skipped`. Een herkend materiaal
//      dat de kern niet toetst (kruislaaghout) gaat wél, zonder spanningen.
//  [c] De sidecar (`check`) levert `plate_check_inputs` en `skipped_plates`
//      met dezelfde bouwer — de MCP-weg van `check_fem_model`.
//  [d] De echte kern via de toetsbrug: UC tegen de handberekening.
//
// DE HANDBEREKENING — trekwand, dezelfde als test-plaat-randlast.mjs
//   B = 2000 mm, H = 3000 mm, t = 20 mm, meshSize 500; onderrand op zRollers
//   met het midden scharnierend, zodat de dwarscontractie vrij is en de
//   éénassige oplossing geldt: σ_y = p/t, σ_x = τ = 0.
//   p = 1000 kN/m omhoog op de bovenrand (geval 1) → p/t = 1000/20 = 50 N/mm².
//   Combinatie 1 (UGT, 1,5·Q): σ_y = 75 N/mm²  → UC = 75/235  = 0,319149
//   Combinatie 2 (UGT, 3,0·Q): σ_y = 150 N/mm² → UC = 150/235 = 0,638298
//   Combinatie 3 (BGT, 1,0·Q): niet in de toetsinvoer.
//   S235, t = 20 mm ≤ 40 mm → f_y = 235 N/mm² (tabel 3.1), γ_M0 = 1,00.
//   Elementgemiddelde spanning: binnen 2 % van de analytische waarde, zoals
//   test-plaat-randlast dat voor σ_y al vastlegt.
//
// DE TOETS REKENT MET SCHEEFSTAND (issue #199). De UGT-toetskrachten van
// `check` zijn altijd tweede orde met scheefstand φ = 1/200, elke combinatie in
// +x en −x (id en id + 1 000 000), ook zonder scheefstandschakelaar. De randlast
// krijgt dan een metgezel H = φ·V langs de bovenrand en de wand buigt in zijn
// vlak (Bernoulli, I = t·B³/12 = 20·2000³/12 = 1,3333·10¹⁰ mm⁴):
//   combinatie 2: ΣH = 3,0·1000·2/200 = 30 kN; onderste randelement (hart
//   x = 750 mm uit het midden, z = 250 mm; een lineair verloop middelt naar de
//   waarde in het hart): σ_b = 30·10³·2750·750/1,3333·10¹⁰ = 4,64 N/mm² →
//   σ_y = 154,64 N/mm², UC = 0,6580 (was 0,638298, +3,1 %);
//   combinatie 1: de helft, σ_b = 2,32 → σ_y = 77,32, UC = 0,3290 (was
//   0,319149, +3,1 %).
// Het gemiddelde van σ_y over alle elementen blijft f·p/t (verticaal evenwicht;
// de buiging is antisymmetrisch en middelt weg), en geen element wijkt meer af
// dan σ_b van het randelement. σ_x en τ blijven klein: τ_gem = ΣH/(B·t) =
// 0,5 % van σ_y. P-Δ speelt bij deze trekwand geen rol.
//
// Uitvoeren: npx tsx test-plaat-toets-staal.mjs   (vanuit design-mockup/)

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const TOETSBRUG = join(
  resolve(HIER, ".."), "src-tauri", "target", "release",
  process.platform === "win32" ? "toetsbrug.exe" : "toetsbrug",
);

const { verwerkVerzoek } = await import("./src/mcp/sidecar.ts");
const { buildPlaatCheckInputs } = await import("./src/lib/plaatCheckBuilder.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function checkTrue(name, ok, detail = "") {
  if (ok) { passed++; log(`  ✓ ${name}${detail ? `: ${detail}` : ""}`); }
  else    { failed++; log(`  ✗ ${name}${detail ? `: ${detail}` : ""}`); }
}
function checkRel(name, actual, expected, tolRel) {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= tolRel * Math.abs(expected);
  checkTrue(name, ok, `${Number(actual).toPrecision(7)} ≈ ${Number(expected).toPrecision(7)}`);
}

const B = 2000, H = 3000, S = 500, T = 20, P = 1000;
const SIGMA = P / T; // N/mm² (kN/m = N/mm)
const F_Y = 235;

function model(plaat = {}) {
  const nodes = [];
  for (let i = 0; i <= 4; i++) nodes.push({ id: 1 + i, x: i * S, z: 0 });
  nodes.push({ id: 6, x: 0, z: H }, { id: 7, x: B, z: H });
  return {
    nodes,
    beams: [],
    supports: nodes.slice(0, 5).map((n) => ({ nodeId: n.id, type: n.id === 3 ? "pinned" : "zRoller" })),
    plates: [{ id: 1, nodeIds: [1, 5, 7, 6], thickness: T, meshSize: S, materiaal: "S235", ...plaat }],
    loadCases: [{ id: 1, name: "Q", type: "live" }],
    loads: [{ id: 1, type: "edgeLoad", caseId: 1, plateId: 1, edge: "top", q: P, qDir: "z" }],
  };
}
const COMBINATIES = [
  { id: 1, name: "UGT 1,5·Q", type: "uls", formula: "1,5·Q", factors: { 1: 1.5 } },
  { id: 2, name: "UGT 3,0·Q", type: "uls", formula: "3,0·Q", factors: { 1: 3.0 } },
  { id: 3, name: "BGT Q", type: "sls", formula: "Q", factors: { 1: 1.0 } },
];

// ─────────────────────────────────────────────────────────────────────────
log("\n[c] sidecar `check`: plate_check_inputs uit dezelfde bouwer");
const antw = verwerkVerzoek({ v: 1, id: 1, op: "check", payload: { model: model(), combinations: COMBINATIES } });
checkTrue("check slaagt", antw.ok === true, antw.error?.melding ?? "");
const invoer = antw.result?.plate_check_inputs ?? [];
checkTrue("één plaat in de toetsinvoer", invoer.length === 1, String(invoer.length));
checkTrue("skipped_plates leeg", Array.isArray(antw.result?.skipped_plates) && antw.result.skipped_plates.length === 0);
const p1 = invoer[0];

log("\n[a] de invoer: materiaal, dikte, alleen UGT, spanningen ongewijzigd");
checkTrue("soort Staal, materiaal S235", p1?.soort === "Staal" && p1?.materiaal === "S235", `${p1?.soort} ${p1?.materiaal}`);
checkTrue("dikte 20 mm", p1?.thickness_mm === T);
checkTrue("bijlage NL", p1?.bijlage === "NL");
// Tot issue #199 "[1,2]": de toets rekent nu elke UGT-combinatie in +x en −x.
checkTrue(
  "alleen de UGT-combinaties 1 en 2, elk in +x en −x",
  JSON.stringify(p1?.combinations.map((c) => c.combination_id)) === "[1,1000001,2,1000002]",
  JSON.stringify(p1?.combinations.map((c) => c.combination_id)),
);
/** σ_b van het onderste randelement bij factor f (Bernoulli, zie de kop). */
const sigmaB = (f) => ((f * P * B) / 200) * (H - S / 2) * (B / 2 - S / 2) / ((T * B ** 3) / 12);
for (const [id, factor] of [[1, 1.5], [1_000_001, 1.5], [2, 3.0], [1_000_002, 3.0]]) {
  const els = p1?.combinations.find((c) => c.combination_id === id)?.elements ?? [];
  checkTrue(`combinatie ${id}: 16 of meer elementen`, els.length >= 16, String(els.length));
  const gem = els.reduce((s, e) => s + e.sigma_y_mpa, 0) / Math.max(1, els.length);
  checkRel(`combinatie ${id}: gemiddelde σ_y = ${factor}·p/t (verticaal evenwicht)`, gem, factor * SIGMA, 0.02);
  // Tot issue #199 lag elk element binnen 2 % van f·p/t; met de buiging uit de
  // scheefstand wijkt een randelement tot σ_b (3,1 %) af.
  checkTrue(
    `combinatie ${id}: elk element binnen σ_b = ${sigmaB(factor).toFixed(2)} N/mm² (+ 2 %) van ${factor}·p/t`,
    els.every((e) => Math.abs(e.sigma_y_mpa - factor * SIGMA) <= sigmaB(factor) + 0.02 * factor * SIGMA),
    String(Math.max(...els.map((e) => Math.abs(e.sigma_y_mpa - factor * SIGMA)))),
  );
  checkTrue(
    `combinatie ${id}: σ_x en τ klein (< 2 % van σ_y)`,
    els.every((e) => Math.abs(e.sigma_x_mpa) < 0.02 * factor * SIGMA && Math.abs(e.tau_xy_mpa) < 0.02 * factor * SIGMA),
  );
}

log("\n[b] bouwer: zonder materiaal, onbruikbaar materiaal, kruislaaghout");
{
  const plaat = model().plates[0];
  const uit = buildPlaatCheckInputs({
    plates: [
      { ...plaat, id: 11, materiaal: undefined },
      { ...plaat, id: 12, materiaal: "S999" },
      { ...plaat, id: 13, materiaal: "CLT C24 40/20/40", cltG12Bovengrens: true },
    ],
    combinations: [],
    combinationResults: new Map(),
  });
  checkTrue("plaat zonder materiaal overgeslagen met reden",
    uit.skipped.some((s) => s.plateId === 11 && s.reason.includes("geen materiaal")));
  checkTrue("onbruikbaar materiaal overgeslagen met reden",
    uit.skipped.some((s) => s.plateId === 12 && s.reason.includes("S999")));
  const clt = uit.inputs.find((i) => i.plate_id === 13);
  checkTrue("kruislaaghout gaat naar de kern, zonder spanningen",
    clt?.soort === "Kruislaaghout" && clt.combinations.length === 0);
  checkTrue("niets dubbel of kwijt", uit.inputs.length + uit.skipped.length === 3);
}

log("\n[d] de kern via de toetsbrug");
if (!existsSync(TOETSBRUG)) {
  checkTrue(`toetsbrug aanwezig (${TOETSBRUG}) — bouw hem met cargo build --release -p toetsbrug`, false);
} else {
  const antwoord = await new Promise((resolve, reject) => {
    const child = spawn(TOETSBRUG, [], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) reject(new Error(`toetsbrug stopte met code ${code ?? signal}: ${err || out}`));
      else resolve(out);
    });
    child.stdin.end(JSON.stringify({ opdracht: "check_plates", inputs: invoer }));
  });
  let res = null;
  try { res = JSON.parse(antwoord); } catch { /* hieronder gemeld */ }
  checkTrue("toetsbrug antwoordt met een lijst", Array.isArray(res), antwoord.slice(0, 200));
  const u = Array.isArray(res) ? res[0] : null;
  checkTrue("niet geweigerd", u && u.geweigerd === undefined, u?.geweigerd ?? "");
  // Met de buiging uit de scheefstand (zie de kop); was 150/235 = 0,638298.
  checkRel("UC_max = (150 + 4,64)/235 = 0,6580 (combinatie 2)", u?.uc_max, (3.0 * SIGMA + sigmaB(3.0)) / F_Y, 0.02);
  checkTrue("maatgevende combinatie 2", u?.governing_combination_id === 2, String(u?.governing_combination_id));
  const c1 = u?.combinaties?.find((c) => c.combination_id === 1);
  // Was 75/235 = 0,319149; met σ_b = 2,32 N/mm² 0,3290.
  checkRel("combinatie 1: UC = (75 + 2,32)/235 = 0,3290", c1?.uc, (1.5 * SIGMA + sigmaB(1.5)) / F_Y, 0.02);
  checkTrue("omhullende per element aanwezig", (u?.elementen?.length ?? 0) === p1.combinations[0].elements.length);
  checkTrue("status Ok", u?.status === "Ok");
  checkTrue("plooi staat als niet getoetst", (u?.niet_getoetst ?? []).some((n) => n.id === "en1993_1_5_plooi"));
  const calc = u?.checks?.[0]?.kind?.data;
  checkTrue("afleiding: artikel 6.2.1(5) (6.1)", calc?.article === "art. 6.2.1(5) (6.1)", calc?.article);
  checkRel("afleiding: f_y = 235", calc?.deelstappen?.find((d) => d.id === "f_y")?.value, F_Y, 1e-12);
}

log(`\n${passed} geslaagd, ${failed} mislukt`);
process.exit(failed > 0 ? 1 : 0);

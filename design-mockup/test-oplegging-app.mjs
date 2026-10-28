// De app-kant van de opleggingscontrole (controle 26 oktober 2026):
// issue #223 (dubbele oplegging) en issue #222 (veer met k <= 0).
//
// WAT DEZE TEST VASTLEGT
//  [1] De modelcontrole van de app (`controleerModel`, en daarmee de
//      rekenpoort `controleerVoorRekenen`) meldt tegenstrijdige opleggingen
//      op één knoop als FOUT en een samenvoeging zonder tegenspraak als
//      waarschuwing — dezelfde regel als de engine (`opleggingen.ts`).
//  [2] De vertaalbare tekst: de Nederlandse vertaling van de sleutel is
//      letterlijk de Nederlandse tekst; en/de/fr bestaan en zijn vertaald.
//  [1b] Een veer met k <= 0 of zonder k is een FOUT in de modelcontrole
//      (#222); de rekenpoort weigert hem, in plaats van hem star te rekenen.
//  [3] De Rust-raamwerkroute van de app (`buildNativeFrame2DRequest`) voegt
//      met dezelfde regel samen en weigert dezelfde tegenstrijdigheid, en een
//      veer met k <= 0 (was: star, `else entry.uy = true`).
//
// Draaien met: npx tsx test-oplegging-app.mjs  (alleen tegen de bron)

const { zetTaal, default: i18next } = await import("./scripts/i18n-voor-tests.mjs");
const { vertaal } = await import("./src/lib/vertaalbareTekst.ts");
const { controleerModel } = await import("./src/lib/modelControle.ts");
const { controleerVoorRekenen } = await import("./src/lib/rekenPoort.ts");
const { buildNativeFrame2DRequest } = await import("./src/components/fem/solver/nativeFrame2DRoute.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? ` — ${extra}` : ""}`); }
}

const model = (supports) => ({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }],
  beams: [{ id: 1, from: 1, to: 2, material: "S235", profile: "IPE300" }],
  supports,
});
const t = (taal) => i18next.getFixedT(taal);

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] Modelcontrole van de app: tegenstrijdig = fout, samengevoegd = waarschuwing");
// ─────────────────────────────────────────────────────────────────────────
const tegen = controleerModel(model([
  { nodeId: 1, type: "pinned" }, { nodeId: 1, type: "zSpring", k: 5 }, { nodeId: 2, type: "zRoller" },
]));
const fout = tegen.find((b) => b.soort === "oplegging" && b.ernst === "fout");
ok("pinned + zSpring op knoop 1: fout met knoop 1", fout?.nodeIds?.[0] === 1, JSON.stringify(tegen));
let geweigerd = "";
try {
  controleerVoorRekenen(model([
    { nodeId: 1, type: "pinned" }, { nodeId: 1, type: "zSpring", k: 5 }, { nodeId: 2, type: "zRoller" },
  ]));
} catch (e) { geweigerd = e.message; }
ok("de rekenpoort van de app weigert", geweigerd.includes("Knoop 1 heeft tegenstrijdige opleggingen"), geweigerd);

const samen = controleerModel(model([
  { nodeId: 1, type: "pinned" }, { nodeId: 1, type: "rotSpring", k: 8773.8 }, { nodeId: 2, type: "zRoller" },
]));
const waarsch = samen.find((b) => b.soort === "oplegging");
ok("pinned + rotSpring: alleen een waarschuwing", waarsch?.ernst === "waarschuwing"
  && !samen.some((b) => b.ernst === "fout"), JSON.stringify(samen));
ok("één oplegging per knoop: geen bevinding",
  !controleerModel(model([{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }])).some((b) => b.soort === "oplegging"));

// ─────────────────────────────────────────────────────────────────────────
log("\n[1b] Veer met k <= 0: fout in de modelcontrole van de app (#222)");
// ─────────────────────────────────────────────────────────────────────────
const veerFouten = [];
for (const k of [-5, 0, undefined]) {
  const bev = controleerModel(model([{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zSpring", k }]));
  const f = bev.find((b) => b.soort === "oplegging" && b.ernst === "fout");
  ok(`zSpring k = ${k}: fout op knoop 2`, f?.nodeIds?.[0] === 2 && f.tekst.includes("zonder positieve stijfheid"),
    JSON.stringify(bev));
  if (f) veerFouten.push(f);
  let melding = "";
  try { controleerVoorRekenen(model([{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zSpring", k }])); }
  catch (e) { melding = e.message; }
  ok(`zSpring k = ${k}: de rekenpoort weigert`, melding.includes("Oplegging op knoop 2 is een veer (zSpring)"), melding);
}
ok("zSpring k = 5: geen bevinding",
  !controleerModel(model([{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zSpring", k: 5 }])).some((b) => b.soort === "oplegging"));

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] Vertaalbare tekst: nl = tekst, en/de/fr vertaald");
// ─────────────────────────────────────────────────────────────────────────
for (const b of [fout, waarsch, veerFouten[0]].filter(Boolean)) {
  await zetTaal("nl");
  ok(`nl: ${b.tekstVertaalbaar.sleutel} = de Nederlandse tekst`, vertaal(t("nl"), b.tekstVertaalbaar) === b.tekst,
    vertaal(t("nl"), b.tekstVertaalbaar));
  for (const taal of ["en", "de", "fr"]) {
    const v = vertaal(t(taal), b.tekstVertaalbaar);
    ok(`${taal}: ${b.tekstVertaalbaar.sleutel} vertaald`, v !== b.tekst && !v.includes("canvas.modelCheck") && v.includes(String(b.nodeIds[0])), v);
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] Rust-raamwerkroute: dezelfde samenvoeging en weigering");
// ─────────────────────────────────────────────────────────────────────────
const invoer = (supports) => ({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }],
  beams: [{ id: 1, from: 1, to: 2, E: 210000, A: 5381, I: 8.356e7 }],
  supports,
  loads: [{ beamId: 1, q: -10, caseId: 1 }],
  cases: [{ id: 1, name: "G" }],
});
{
  const req = buildNativeFrame2DRequest(invoer([
    { nodeId: 1, type: "rotSpring", k: 8.7738e9 }, { nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" },
  ]), () => 1, "linear");
  const s1 = req.supports.find((s) => s.nodeId === 1);
  ok("rotSpring + pinned: knoop 1 x en z star, rotatie verend 8773,8 kNm/rad",
    s1?.ux === true && s1?.uy === true && s1?.rz === false && Math.abs((s1?.krzKnmPerRad ?? 0) - 8773.8) < 1e-6,
    JSON.stringify(s1));
  let melding = "";
  try {
    buildNativeFrame2DRequest(invoer([
      { nodeId: 1, type: "rotSpring", k: 1e8 }, { nodeId: 1, type: "rotSpring", k: 2e8 },
      { nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" },
    ]), () => 1, "linear");
  } catch (e) { melding = e.message; }
  ok("twee rotSpring op één knoop: geweigerd (was: de tweede overschreef de eerste stil)",
    melding.includes("Knoop 1 heeft twee opleggingen in de rotatie (ry)"), melding);
  let veer = "";
  try {
    buildNativeFrame2DRequest(invoer([{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zSpring", k: -5000 }]),
      () => 1, "linear");
  } catch (e) { veer = e.message; }
  ok("zSpring k = −5 kN/mm: geweigerd (was: star)",
    veer.startsWith("Oplegging op knoop 2 is een verticale veer (zSpring) met stijfheid k = −5 kN/mm"), veer);
}

log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);

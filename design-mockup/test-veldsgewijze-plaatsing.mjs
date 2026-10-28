// Veranderlijke vloerbelasting veldsgewijs ongunstig geplaatst (issue #219).
//
// WAT ER MISGING
//  Een veranderlijk belastinggeval ging op alle velden tegelijk aan of uit.
//  NEN-EN 1991-1-1 6.2.1(1) eist dat vloerbelasting als vrije belasting op de
//  ongunstigste velden staat (NEN-EN 1992-1-1 5.1.3, NEN-EN 1993-1-1 AB.2).
//  IPE240 over drie velden van 5 m, G = 10, Q (categorie A, ψ₀ = 0,4) = 5 kN/m,
//  CC2, eigen gewicht uit. Gemeten in 2026.42:
//    M_B −48,75 kNm   (hand −51,88)    M veld 1/3 39,00 (hand 42,84)
//    M veld 2 12,19   (hand 21,56)     R tussensteun 107,25 kN (hand 111,00)
//
// DE HANDBEREKENING (hier onafhankelijk van de code uitgevoerd)
//  Driemomentenvergelijking voor drie gelijke velden, EI constant, einden
//  scharnierend, w_i = lijnlast op veld i:
//    4·M_B + M_C = −(w₁ + w₂)·L²/4
//    M_B + 4·M_C = −(w₂ + w₃)·L²/4
//  Veldmoment M(x) = M_l(1 − x/L) + M_r·x/L + w·x(L − x)/2, maximum waar
//  V = 0. Reactie = som van de dwarskrachten links en rechts. Over ALLE
//  2³ = 8 Q-patronen en de UGT-uitdrukkingen van de NB (CC2): 6.10a
//  1,35·G + 1,5·ψ₀·Q en 1,35·G; 6.10b 1,2·G + 1,5·Q en 0,9·G + 1,5·Q.
//
// WAT DEZE TEST VASTLEGT
//  [1] De app-route (dezelfde functies als App.tsx): omhullende = hand, en
//      zonder de veldpatronen precies de oude getallen van het issue.
//  [2] Superpositie: de deelgevallen tellen exact op tot het geval.
//  [3] Patronen, namen en id's: 6 patronen + "geen veld", geen 2ⁿ; G-only-
//      combinaties krijgen geen variant; id's uniek en binnen u32.
//  [4] Niets verandert waar niets te plaatsen valt (één veld, dak cat. H,
//      sneeuw), en bij niet-lineair rekenen een waarschuwing in plaats van
//      stilte.
//  [5] De staaltoets leest de varianten (forces_envelope).
//  [6] De MCP-route: solve_fem_model en check_fem_model (gebouwde server).
//
// Draaien met: npx tsx test-veldsgewijze-plaatsing.mjs  (ook tegen de bundel)

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { solveAllCases, gevalResultaten } = await import("./src/components/fem/solver/engine.ts");
const { combineResults, computeEnvelope, defaultCombinations } = await import("./src/components/fem/solver/combinations.ts");
const {
  splitsVeldgevallen, veldpatronenUitkomst, veldpatroonMeldingen, bepaalVelden,
  VELD_GEVAL_OFFSET, VELD_COMBO_OFFSET,
} = await import("./src/components/fem/solver/veldpatronen.ts");
const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");
const { buildSteelCheckInputs } = await import("./src/lib/steelCheckBuilder.ts");

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HIER, "..");
const win = process.platform === "win32";
const MCP_SERVER = join(REPO, "src-tauri", "target", "release", win ? "openaec-mcp-server.exe" : "openaec-mcp-server");

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

// ── Het model van het issue ─────────────────────────────────────────────────
const L = 5; // m
const GEVALLEN = [{ id: 1, name: "G", type: "dead" }, { id: 2, name: "Q", type: "live", categorie: "A" }];
const model = (extra = {}) => ({
  nodes: [0, 5000, 10000, 15000].map((x, i) => ({ id: i + 1, x, z: 0 })),
  beams: [1, 2, 3].map((i) => ({ id: i, from: i, to: i + 1, profile: "IPE240", material: "S235" })),
  supports: [
    { nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" },
    { nodeId: 3, type: "zRoller" }, { nodeId: 4, type: "zRoller" },
  ],
  plates: [],
  loadCases: GEVALLEN,
  loads: [1, 2, 3].flatMap((b) => [
    { id: b, type: "lineLoad", caseId: 1, beamId: b, q: -10 },
    { id: 10 + b, type: "lineLoad", caseId: 2, beamId: b, q: -5 },
  ]),
  selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
  ...extra,
});

// ── De handberekening ───────────────────────────────────────────────────────
/** Steunmomenten (kNm, hogging negatief) voor lijnlasten w = [w1, w2, w3] (kN/m). */
function steunmomenten(w) {
  const r1 = -(w[0] + w[1]) * L * L / 4, r2 = -(w[1] + w[2]) * L * L / 4;
  return [(4 * r1 - r2) / 15, (4 * r2 - r1) / 15];
}
function hand(w) {
  const [MB, MC] = steunmomenten(w);
  const M = [0, MB, MC, 0];
  const veldMax = w.map((wi, i) => {
    const Ml = M[i], Mr = M[i + 1];
    const m = (x) => Ml * (1 - x / L) + Mr * x / L + wi * x * (L - x) / 2;
    // V(x) = (Mr − Ml)/L + wi(L − 2x)/2 = 0
    const x = wi > 0 ? Math.min(L, Math.max(0, L / 2 + (Mr - Ml) / (wi * L))) : 0;
    return Math.max(m(x), m(0), m(L));
  });
  // Dwarskracht aan de einden van veld i: V_l = wL/2 + (Mr − Ml)/L, V_r = wL/2 − (Mr − Ml)/L.
  const Vl = w.map((wi, i) => wi * L / 2 + (M[i + 1] - M[i]) / L);
  const Vr = w.map((wi, i) => wi * L / 2 - (M[i + 1] - M[i]) / L);
  return { MB, MC, veldMax, RB: Vr[0] + Vl[1], RA: Vl[0] };
}
const UGT = [[1.35, 1.5 * 0.4], [1.35, 0], [1.2, 1.5], [0.9, 1.5]];
const handExtremen = { MB: Infinity, veld1: -Infinity, veld2: -Infinity, RB: -Infinity, RA_min: Infinity };
for (const [g, q] of UGT) {
  for (let p = 0; p < 8; p++) {
    const w = [0, 1, 2].map((i) => g * 10 + ((p >> i) & 1 ? q * 5 : 0));
    const h = hand(w);
    handExtremen.MB = Math.min(handExtremen.MB, h.MB, h.MC);
    handExtremen.veld1 = Math.max(handExtremen.veld1, h.veldMax[0], h.veldMax[2]);
    handExtremen.veld2 = Math.max(handExtremen.veld2, h.veldMax[1]);
    handExtremen.RB = Math.max(handExtremen.RB, h.RB);
    handExtremen.RA_min = Math.min(handExtremen.RA_min, h.RA);
  }
}
// Alleen "alles aan / alles uit" — het oude gedrag (het issue).
const oud = { MB: Infinity, veld2: -Infinity };
for (const [g, q] of UGT) for (const p of [0, 7]) {
  const w = [0, 1, 2].map((i) => g * 10 + ((p >> i) & 1 ? q * 5 : 0));
  const h = hand(w);
  oud.MB = Math.min(oud.MB, h.MB); oud.veld2 = Math.max(oud.veld2, h.veldMax[1]);
}

/** De app-route: dezelfde stappen als App.tsx `computeAndStoreSolverOutputs` (eerste orde). */
function appRoute(m) {
  const combos = defaultCombinations(m.loadCases, "CC2");
  const mi = bouwMultiInput(m);
  const splitsing = splitsVeldgevallen(mi, m.loadCases);
  const { perCase } = solveAllCases(splitsing?.input ?? mi);
  const veld = veldpatronenUitkomst(splitsing, m.loadCases, combos, perCase);
  return {
    combos, splitsing, perCase, veld,
    env: computeEnvelope(veld.combinaties, perCase),
    envOud: computeEnvelope(combos, perCase),
    results: new Map(veld.combinaties.map((c) => [c.id, combineResults(c, perCase)])),
  };
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[0] Handberekening (driemomentenvergelijking, 8 patronen × NB-uitdrukkingen)");
check("M_B = −51,875 kNm (issue: −51,88)", handExtremen.MB, -51.875);
check("M veld 1/3 = 42,84 kNm (issue)", handExtremen.veld1, 42.84, 0.005);
check("M veld 2 = 21,5625 kNm (issue: 21,56)", handExtremen.veld2, 21.5625);
check("R tussensteun = 111,00 kN (issue)", handExtremen.RB, 111);
check("oud gedrag M_B = −48,75 (issue)", oud.MB, -48.75);
check("oud gedrag M veld 2 = 12,1875 (issue: 12,19)", oud.veld2, 12.1875);

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] App-route: de omhullende plaatst Q veldsgewijs");
const a = appRoute(model());
{
  const e1 = a.env.elements.get(1), e2 = a.env.elements.get(2), e3 = a.env.elements.get(3);
  check("staaf 1: M_min (steunpunt B) = hand", e1.M_min / 1e6, handExtremen.MB);
  check("staaf 2: M_min = hand", e2.M_min / 1e6, handExtremen.MB);
  check("staaf 1: M_max = hand veld 1", e1.M_max / 1e6, handExtremen.veld1);
  check("staaf 3: M_max = hand veld 3", e3.M_max / 1e6, handExtremen.veld1);
  check("staaf 2: M_max = hand veld 2 (was 12,19)", e2.M_max / 1e6, handExtremen.veld2);
  check("reactie knoop 2: fz_max = hand R_B (was 107,25)", a.env.reactions.get(2).fz_max / 1e3, handExtremen.RB);
  check("reactie knoop 3: fz_max = hand R_C", a.env.reactions.get(3).fz_max / 1e3, handExtremen.RB);
  check("reactie knoop 1: fz_min = hand (0,9·G, Q op veld 2)", a.env.reactions.get(1).fz_min / 1e3, handExtremen.RA_min);
  // Zonder varianten: precies de getallen die het issue meldt.
  check("zonder varianten: M_B = −48,75 (de melding)", a.envOud.elements.get(1).M_min / 1e6, -48.75);
  check("zonder varianten: M veld 2 = 12,1875 (de melding)", a.envOud.elements.get(2).M_max / 1e6, 12.1875);
  check("zonder varianten: R_B = 107,25 (de melding)", a.envOud.reactions.get(2).fz_max / 1e3, 107.25);
  // De maatgevende combinatie van het middenveld is een variant met Q alleen op veld 2.
  const gov = a.veld.combinaties.find((c) => c.id === e2.governingCombinationId);
  ok("maatgevend voor staaf 2 is een variant", gov?.veldpatroon !== undefined, gov?.name);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] Superpositie: de deelgevallen tellen exact op tot Q");
{
  ok("drie deelgevallen, één per veld", a.splitsing?.deelgevallen.length === 3
    && a.splitsing.deelgevallen.every((d, i) => d.veld === i + 1 && d.ouderId === 2 && d.id === VELD_GEVAL_OFFSET + i + 1),
  JSON.stringify(a.splitsing?.deelgevallen));
  let maxAfwijking = 0;
  const q = a.perCase.get(2);
  for (const bid of [1, 2, 3]) {
    const ref = q.elements.get(bid).bendingMoment;
    ref.forEach((m, i) => {
      const som = a.splitsing.deelgevallen.reduce((s, d) => s + (a.perCase.get(d.id)?.elements.get(bid)?.bendingMoment[i] ?? 0), 0);
      maxAfwijking = Math.max(maxAfwijking, Math.abs(som - m));
    });
  }
  ok(`Σ M(deelgevallen) = M(Q) op elk station (max afwijking ${maxAfwijking.toExponential(2)} N·mm)`, maxAfwijking < 1e-3);
  ok("gevalResultaten toont de deelgevallen niet", [...gevalResultaten(a.perCase).keys()].sort().join(",") === "1,2");
  ok("velden: drie, staaf 1 / 2 / 3", JSON.stringify(bepaalVelden(bouwMultiInput(model())).map((v) => v.staven)) === "[[1],[2],[3]]");
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] Patronen, namen en id's");
{
  const v = a.veld.uitkomst.combinaties;
  const patronen = new Set(v.map((c) => c.name.split("veldpatroon: ")[1]));
  ok(`6 veldpatronen + "geen veld" (geen 2ⁿ per combinatie): ${[...patronen].join(" | ")}`,
    patronen.size === 7 && patronen.has("Q op veld 2") && patronen.has("Q op veld 1 + veld 3") && patronen.has("Q op geen veld"));
  ok("geen variant met Q op alle velden (dat is de combinatie zelf)", ![...patronen].includes("Q op veld 1 + veld 2 + veld 3"));
  const gOnly = a.combos.filter((c) => !c.factors.has(2)).map((c) => c.id);
  ok("combinaties zonder Q krijgen geen variant", v.every((c) => !gOnly.includes(c.veldpatroon.basisId)));
  ok("id's uniek, boven VELD_COMBO_OFFSET en binnen u32",
    new Set(a.veld.combinaties.map((c) => c.id)).size === a.veld.combinaties.length
    && v.every((c) => c.id > VELD_COMBO_OFFSET && c.id < 2 ** 32));
  ok("elke variant staat direct achter haar basis", a.veld.combinaties.every((c, i, l) =>
    !c.veldpatroon || l[i - 1].id === c.veldpatroon.basisId || l[i - 1].veldpatroon?.basisId === c.veldpatroon.basisId));
  ok("varianten behouden de soort (standaardkenmerk)", v.every((c) => c.standaard?.soort === a.combos.find((b) => b.id === c.veldpatroon.basisId).standaard?.soort));
  ok("deelgevallen als belastinggevallen: type en categorie van Q",
    a.veld.uitkomst.gevallen.length === 3 && a.veld.uitkomst.gevallen.every((g) => g.type === "live" && g.categorie === "A"));
  ok("geen afkappingsmelding", a.veld.uitkomst.meldingen.length === 0);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] Niets te plaatsen → niets verandert; niet-lineair → waarschuwing");
const eenVeldModel = () => {
  const m = model();
  return { ...m, loads: [...m.loads.filter((l) => l.caseId === 1), { id: 20, type: "lineLoad", caseId: 2, beamId: 2, q: -5 }] };
};
{
  ok("Q op één veld: geen splitsing", splitsVeldgevallen(bouwMultiInput(eenVeldModel()), GEVALLEN) === null);
  const dak = model({ loadCases: [GEVALLEN[0], { id: 2, name: "Q dak", type: "live", categorie: "H" }] });
  ok("categorie H (dak): geen splitsing", splitsVeldgevallen(bouwMultiInput(dak), dak.loadCases) === null);
  const sneeuw = model({ loadCases: [GEVALLEN[0], { id: 2, name: "S", type: "snow" }] });
  ok("sneeuw: geen splitsing", splitsVeldgevallen(bouwMultiInput(sneeuw), sneeuw.loadCases) === null);
  const m = model();
  const lin = veldpatroonMeldingen({ ...m, lineair: true });
  const nl = veldpatroonMeldingen({ ...m, lineair: false });
  ok("eerste orde: geen melding", lin.length === 0);
  ok("niet-lineair: waarschuwing voor geval 2 met 3 velden en artikel 6.2.1(1)",
    nl.length === 1 && nl[0].caseId === 2 && nl[0].velden === 3 && /6\.2\.1\(1\)/.test(nl[0].tekst), JSON.stringify(nl));
  ok("niet-lineair, Q op één veld: geen melding", veldpatroonMeldingen({ ...eenVeldModel(), lineair: false }).length === 0);
  // Een uitkraging is een eigen veld: ligger 0–6 m, uitkraging tot 8 m.
  const uitk = {
    beams: [{ id: 1, from: 1, to: 2 }, { id: 2, from: 2, to: 3 }],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
  };
  ok("uitkraging = eigen veld", bepaalVelden(uitk).length === 2);
  // Een ligger zonder tussensteun, in twee staven geknipt, is één veld.
  const geknipt = {
    beams: [{ id: 1, from: 1, to: 2 }, { id: 2, from: 2, to: 3 }],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 3, type: "zRoller" }],
  };
  ok("geknipte ligger zonder tussensteun = één veld", bepaalVelden(geknipt).length === 1);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[5] De staaltoets leest de varianten");
{
  const m = model();
  const profileDb = new Map([["IPE240", { geometry: { h: 240 } }]]);
  const { inputs } = buildSteelCheckInputs({
    nodes: m.nodes, beams: m.beams, supports: m.supports,
    combinations: a.veld.combinaties, combinationResults: a.results, profileDb,
    loadCases: [...m.loadCases, ...a.veld.uitkomst.gevallen],
  });
  const van = (bid) => inputs.find((i) => i.beam_id === bid);
  const fe2 = van(2)?.forces_envelope ?? [];
  check("staaf 2: my_ed max in de toetsinvoer = 21,5625 kNm (was 12,19)", Math.max(...fe2.map((p) => p.forces.my_ed)), handExtremen.veld2);
  check("staaf 2: my_ed min = −51,875 kNm", Math.min(...fe2.map((p) => p.forces.my_ed)), handExtremen.MB);
  const fe1 = van(1)?.forces_envelope ?? [];
  check("staaf 1: my_ed max = 42,84 kNm", Math.max(...fe1.map((p) => p.forces.my_ed)), handExtremen.veld1, 0.005);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[6] De MCP-route (gebouwde server)");
function mcp(aanroepen) {
  return new Promise((klaar, mis) => {
    const k = spawn(MCP_SERVER, [], { stdio: ["pipe", "pipe", "pipe"] });
    const klok = setTimeout(() => { k.kill(); mis(new Error("MCP-server reageerde niet binnen 120 s")); }, 120_000);
    let buf = "";
    const antwoorden = new Map();
    k.on("error", (e) => { clearTimeout(klok); mis(e); });
    k.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const regel = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!regel) continue;
        const bericht = JSON.parse(regel);
        antwoorden.set(bericht.id, bericht);
        if (antwoorden.size === aanroepen.length + 1) {
          clearTimeout(klok);
          k.stdin.end();
          klaar(aanroepen.map((_, n) => antwoorden.get(n + 2)));
        }
      }
    });
    const schrijf = (o) => k.stdin.write(JSON.stringify(o) + "\n");
    schrijf({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-veldsgewijze-plaatsing", version: "1" } } });
    aanroepen.forEach((x, n) => schrijf({ jsonrpc: "2.0", id: n + 2, method: "tools/call", params: { name: x.name, arguments: x.arguments } }));
  });
}
function lees(antwoord) {
  if (antwoord?.error) return { fout: JSON.stringify(antwoord.error) };
  const r = antwoord?.result;
  const tekst = r?.content?.[0]?.text ?? "";
  if (r?.isError) return { fout: tekst };
  try { return { uit: r?.structuredContent ?? JSON.parse(tekst) }; } catch { return { fout: tekst }; }
}

if (!existsSync(MCP_SERVER)) {
  ok("MCP-server gevonden — bouw hem met `cargo build --release -p openaec-mcp-server` (na `npm run build:sidecar`)", false, MCP_SERVER);
} else {
  const mcpModel = model();
  const [s, c, nl, een] = (await mcp([
    { name: "solve_fem_model", arguments: { model: mcpModel } },
    { name: "check_fem_model", arguments: { model: mcpModel } },
    { name: "solve_fem_model", arguments: { model: mcpModel, nonlinear: true } },
    { name: "solve_fem_model", arguments: { model: eenVeldModel() } },
  ])).map(lees);
  ok("solve_fem_model zonder fout", !s.fout, s.fout);
  const env = s.uit?.envelope;
  check("MCP: staaf 1 M_min = −51,875 kNm", env?.elements?.["1"]?.M_min, handExtremen.MB);
  check("MCP: staaf 1 M_max = 42,84 kNm", env?.elements?.["1"]?.M_max, handExtremen.veld1, 0.005);
  check("MCP: staaf 2 M_max = 21,5625 kNm", env?.elements?.["2"]?.M_max, handExtremen.veld2);
  check("MCP: staaf 3 M_max = 42,84 kNm", env?.elements?.["3"]?.M_max, handExtremen.veld1, 0.005);
  check("MCP: reactie knoop 2 fz_max = 111,00 kN", env?.reactions?.["2"]?.fz_max, handExtremen.RB);
  const fp = s.uit?.field_patterns;
  ok("MCP: field_patterns noemt geval 2 met drie velden", fp?.cases?.[0]?.case_id === 2 && fp.cases[0].fields.length === 3,
    JSON.stringify(fp?.cases));
  ok("MCP: elke variant staat in `combinations`", (fp?.combinations ?? []).length > 0
    && fp.combinations.every((v) => s.uit.combinations[String(v.id)] !== undefined));
  ok("MCP: per_case zonder deelgevallen", Object.keys(s.uit?.per_case ?? {}).sort().join(",") === "1,2");
  ok("MCP: cases_solved zonder deelgevallen", JSON.stringify(s.uit?.cases_solved) === "[1,2]", JSON.stringify(s.uit?.cases_solved));
  // check_fem_model: de staaltoetsinvoer van het middenveld.
  ok("check_fem_model zonder fout", !c.fout, c.fout);
  const inv2 = (c.uit?.steel_check_inputs ?? []).find((i) => i.beam_id === 2);
  const fe = inv2?.forces_envelope ?? [];
  check("MCP check: staaf 2 my_ed max = 21,5625 kNm", Math.max(...fe.map((p) => p.forces.my_ed)), handExtremen.veld2);
  // Niet-lineair: geen varianten, wel de waarschuwing.
  ok("MCP niet-lineair: geen field_patterns", !nl.fout && nl.uit?.field_patterns === undefined, nl.fout);
  ok("MCP niet-lineair: waarschuwing 6.2.1(1)", (nl.uit?.warnings ?? []).some((w) => /NIET veldsgewijs/.test(w) && /6\.2\.1\(1\)/.test(w)),
    JSON.stringify(nl.uit?.warnings));
  // Q op één veld: geen field_patterns, zelfde antwoord als voorheen.
  ok("MCP Q op één veld: geen field_patterns", !een.fout && een.uit?.field_patterns === undefined, een.fout);
}

log(`\n${failed === 0 ? "GESLAAGD" : "GEFAALD"}: ${passed} geslaagd, ${failed} gefaald.`);
process.exit(failed === 0 ? 0 : 1);

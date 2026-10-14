// Lasten met een foute verwijzing of zonder waarde: `solve` en `check` weigeren
// zoals `validate` en de app (controle 12 oktober 2026, punt K1, issue #183).
//
// WAT ER MISGING
//  `validate_fem_model` en de app vonden een last op een staaf die niet bestaat
//  (of in een belastinggeval dat niet bestaat) en weigerden. `solve_fem_model`
//  en `check_fem_model` draaiden die controle niet: de last viel in de mapping
//  stil weg en het antwoord had `warnings: []`. Gemeten op 2026.41.0 en op de
//  stand van 14 oktober 2026:
//    051 — lijnlast q = −10 kN/m op staaf 7 (bestaat niet) + 5 kN op knoop 3:
//          R = 2,5 kN en M = 7,5 kNm waar 32,5 kN en 52,5 kNm hoort;
//    052 — vier foute lasten: alles 0, en de melding over de weggehaalde
//          factoren van geval 5 zei "Ze vermenigvuldigden geen enkele last",
//          terwijl last 1 in geval 5 stond.
//  Daarnaast zag de controle zelf een koppel met zijn waarde in `fz` in plaats
//  van `my` niet: de mapping maakte er `my: 0` van (ook in de app).
//
// WAT DEZE TEST VASTLEGT (handwaarden: ligger 6 m, scharnier/rol)
//  [1] 051 en 052 zoals ingevoerd: solve én check weigeren (INVOER_ONGELDIG),
//      met dezelfde bevindingen als validate; 052 noemt ook het koppel.
//  [2] Een koppel met `fz` naast een geldige lijnlast: geweigerd, niet stil 0.
//  [2b] Een lijnlast met een omgekeerd (startFrac 0,8, endFrac 0,2) of leeg
//      (0,5/0,5) belast deel naast 1 kN in het midden: validate, solve en
//      check weigeren. Zonder die weigering gaf solve R = 0,5/0,5 kN (de
//      lijnlast stil weg); correct ingevoerd (0,2/0,8) R = 18,5/18,5 kN.
//  [3] Het bedoelde model rekent de handwaarden: 051 R = qL/2 + F/2 = 32,5 kN,
//      M = qL²/8 + FL/4 = 52,5 kNm, w = 5qL⁴/384EI + FL³/48EI;
//      052 R₁/R₂ = 49 ∓ 7/6 kN, M_midden = 92,0 kNm, M(knoop 1) = 7,0 kNm.
//  [4] Het projectbestand: de melding over wees-factoren noemt de last.
//  [5] Een model zonder fouten rekent als voorheen (geen valse weigering).
//  [6] De gebouwde MCP-server: solve_fem_model, check_fem_model en
//      validate_fem_model met dezelfde invoer.
//
// Draaien met: npx tsx test-last-verwijzing-mcp.mjs  (ook tegen de sidecarbundel)

import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { verwerkVerzoek } = await import("./src/mcp/sidecar.ts");
const { valideerModel } = await import("./src/mcp/valideerModel.ts");
const { openCombinatieStaat } = await import("./src/lib/combinatieBeheer.ts");
const { resolveSection } = await import("./src/lib/sectionResolver.ts");

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HIER, "..");
const win = process.platform === "win32";
const MCP_SERVER = join(REPO, "src-tauri", "target", "release", win ? "openaec-mcp-server.exe" : "openaec-mcp-server");
const PROJECT_052 = join(HIER, "testdata", "controle-2026-10", "vier-verkeerd-geadresseerde-lasten.ifcfem");

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

// ── De modellen van de controle (alleen de rekenvelden) ─────────────────
const ligger = (knopen, staven) => ({
  nodes: knopen.map(([id, x]) => ({ id, x, z: 0 })),
  beams: staven.map(([id, from, to]) => ({ id, from, to, profile: "IPE300", material: "S235" })),
  supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
  loadCases: [{ id: 1, name: "G", type: "dead" }],
});
const COMBI = [{ id: 1, name: "UGT G", type: "uls", factors: { 1: 1 } }];

const M051 = (fout) => ({
  ...ligger([[1, 0], [2, 6000], [3, 3000]], [[1, 1, 3], [2, 3, 2]]),
  loads: fout
    ? [
      { id: 1, type: "lineLoad", beamId: 7, q: -10, caseId: 1 },
      { id: 2, type: "pointForce", nodeId: 3, fz: -5, caseId: 1 },
    ]
    : [
      { id: 1, type: "lineLoad", beamId: 1, q: -10, caseId: 1 },
      { id: 3, type: "lineLoad", beamId: 2, q: -10, caseId: 1 },
      { id: 2, type: "pointForce", nodeId: 3, fz: -5, caseId: 1 },
    ],
});
const M052 = (fout) => ({
  ...ligger([[1, 0], [2, 6000]], [[1, 1, 2]]),
  loads: fout
    ? [
      { id: 1, type: "lineLoad", beamId: 1, q: -10, caseId: 5 },
      { id: 2, type: "pointForce", posFrac: 0.5, fz: -20, caseId: 1 },
      { id: 3, type: "pointMoment", nodeId: 1, fz: -7, caseId: 1 },
      { id: 4, type: "lineLoad", beamId: 1, fz: -3, caseId: 1 },
    ]
    : [
      { id: 1, type: "lineLoad", beamId: 1, q: -10, caseId: 1 },
      { id: 2, type: "pointForce", beamId: 1, posFrac: 0.5, fz: -20, caseId: 1 },
      { id: 3, type: "pointMoment", nodeId: 1, my: -7, caseId: 1 },
      { id: 4, type: "lineLoad", beamId: 1, q: -3, caseId: 1 },
    ],
});
const COMBI_052 = [{ id: 1, name: "UGT", type: "uls", factors: { 1: 1, 5: 1 } }];

const vraag = (op, payload) => verwerkVerzoek({ v: 1, id: 1, op, payload });
const noemt = (lijst, deel) => (lijst ?? []).some((m) => m.includes(deel));

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] Zoals ingevoerd: solve en check weigeren met de bevindingen van validate");
// ─────────────────────────────────────────────────────────────────────────
for (const [naam, model, combinations, kern] of [
  ["051", M051(true), COMBI, ["Last 1 verwijst naar staaf 7, die niet bestaat."]],
  ["052", M052(true), COMBI_052, [
    "Last 1 verwijst naar belastinggeval 5, dat niet bestaat.",
    "Last 2 (type \"pointForce\") levert geen invoer",
    "Koppel 3 op knoop 1 heeft geen waarde in `my`: `fz` wordt bij een koppel niet gelezen.",
    "Lijnlast 4 op staaf 1 heeft geen waarde: `fz` wordt bij een lijnlast niet gelezen.",
  ]],
]) {
  const v = vraag("validate", { model, combinations });
  ok(`${naam} validate: ok:false`, v.ok && v.result?.ok === false, JSON.stringify(v.result?.errors));
  for (const deel of kern) ok(`${naam} validate noemt "${deel.slice(0, 48)}…"`, noemt(v.result?.errors, deel), JSON.stringify(v.result?.errors));
  for (const op of ["solve", "check"]) {
    const a = vraag(op, { model, combinations });
    ok(`${naam} ${op}: geweigerd met INVOER_ONGELDIG`, a.ok === false && a.error?.code === "INVOER_ONGELDIG",
      `${a.error?.code}: ${(a.error?.melding ?? JSON.stringify(a.result?.combinations ?? {})).slice(0, 160)}`);
    ok(`${naam} ${op}: de melding zegt waarom en noemt de modelcontrole`,
      /Model niet doorgerekend/.test(a.error?.melding ?? "") && a.error?.melding.includes(kern[0]),
      (a.error?.melding ?? "").slice(0, 200));
    ok(`${naam} ${op}: detail.fouten = de fouten van validate`,
      JSON.stringify(a.error?.detail?.fouten) === JSON.stringify(v.result?.errors),
      JSON.stringify(a.error?.detail?.fouten));
    ok(`${naam} ${op}: geen resultaat bij een ander model`, a.result === undefined);
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] Een koppel met zijn waarde in fz (of fx) naast een geldige lijnlast");
// ─────────────────────────────────────────────────────────────────────────
for (const veld of ["fz", "fx"]) {
  const model = {
    ...ligger([[1, 0], [2, 6000]], [[1, 1, 2]]),
    loads: [
      { id: 1, type: "lineLoad", beamId: 1, q: -10, caseId: 1 },
      { id: 2, type: "pointMoment", nodeId: 1, [veld]: -7, caseId: 1 },
    ],
  };
  const v = valideerModel(model);
  ok(`koppel met ${veld}: validate weigert en noemt het veld`,
    !v.ok && noemt(v.errors, `Koppel 2 op knoop 1 heeft geen waarde in \`my\`: \`${veld}\``), JSON.stringify(v.errors));
  const a = vraag("solve", { model, combinations: COMBI });
  ok(`koppel met ${veld}: solve weigert (was: R 30/30 kN zonder melding)`, a.ok === false && a.error?.code === "INVOER_ONGELDIG",
    a.error?.melding ?? "GEEN WEIGERING");
}
{
  // Een koppel MET `my` en een kracht erbij: de kracht zou stil wegvallen.
  const model = {
    ...ligger([[1, 0], [2, 6000]], [[1, 1, 2]]),
    loads: [
      { id: 1, type: "lineLoad", beamId: 1, q: -10, caseId: 1 },
      { id: 2, type: "pointMoment", nodeId: 1, my: -7, fz: -3, caseId: 1 },
    ],
  };
  const v = valideerModel(model);
  ok("koppel met my én fz: validate weigert (fz zou wegvallen)", !v.ok && noemt(v.errors, "wordt bij een koppel niet gelezen en zou wegvallen"), JSON.stringify(v.errors));
  // Met alleen `my` rekent hij: R = qL/2 ∓ 7/6 (hand).
  const goed = { ...model, loads: [model.loads[0], { id: 2, type: "pointMoment", nodeId: 1, my: -7, caseId: 1 }] };
  const a = vraag("solve", { model: goed, combinations: COMBI });
  const r = a.result?.combinations?.["1"]?.reactions;
  ok("koppel met alleen my: solve rekent", a.ok === true, a.error?.melding ?? "");
  check("R₁ = 30 − 7/6 kN", r?.["1"]?.fz, 30 - 7 / 6);
  check("R₂ = 30 + 7/6 kN", r?.["2"]?.fz, 30 + 7 / 6);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2b] Een lijnlast met een omgekeerd of leeg belast deel");
// ─────────────────────────────────────────────────────────────────────────
const MET_DEEL = (deel) => ({
  ...ligger([[1, 0], [2, 6000]], [[1, 1, 2]]),
  loads: [
    { id: 1, type: "lineLoad", beamId: 1, ...deel, caseId: 1 },
    { id: 2, type: "pointForce", beamId: 1, posFrac: 0.5, fz: -1, caseId: 1 },
  ],
});
const OMGEKEERD = { q: -10, startFrac: 0.8, endFrac: 0.2 };
for (const [naam, deel] of [
  ["omgekeerd (0,8 → 0,2)", OMGEKEERD],
  ["leeg (0,5 → 0,5)", { qStart: -10, qEnd: -10, startFrac: 0.5, endFrac: 0.5 }],
]) {
  const model = MET_DEEL(deel);
  const kern = "Lijnlast 1 op staaf 1: het belaste deel begint niet vóór zijn einde";
  const v = vraag("validate", { model, combinations: COMBI });
  ok(`${naam}: validate ok:false en noemt het belaste deel`, v.result?.ok === false && noemt(v.result?.errors, kern),
    JSON.stringify(v.result?.errors));
  for (const op of ["solve", "check"]) {
    const a = vraag(op, { model, combinations: COMBI });
    ok(`${naam}: ${op} weigert met INVOER_ONGELDIG (was: R = 0,5/0,5 kN, de lijnlast stil weg)`,
      a.ok === false && a.error?.code === "INVOER_ONGELDIG" && (a.error?.melding ?? "").includes(kern),
      `${a.error?.code}: ${(a.error?.melding ?? JSON.stringify(a.result?.combinations?.["1"]?.reactions ?? {})).slice(0, 200)}`);
  }
}
{
  const a = vraag("solve", { model: MET_DEEL({ q: -10, startFrac: 0.2, endFrac: 0.8 }), combinations: COMBI });
  ok("correct (0,2 → 0,8): solve rekent", a.ok === true, a.error?.melding ?? "");
  check("R₁ = 10·3,6/2 + 1/2 = 18,5 kN", a.result?.combinations?.["1"]?.reactions?.["1"]?.fz, 18.5);
  check("R₂ = 18,5 kN", a.result?.combinations?.["1"]?.reactions?.["2"]?.fz, 18.5);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] Het bedoelde model rekent de handwaarden");
// ─────────────────────────────────────────────────────────────────────────
const EI = 210000 * resolveSection("S235", "IPE300").I; // N·mm²
{
  const a = vraag("solve", { model: M051(false), combinations: COMBI, detail: "stations" });
  ok("051 bedoeld: solve rekent", a.ok === true, a.error?.melding ?? "");
  const c = a.result?.combinations?.["1"];
  check("051 R₁ = qL/2 + F/2 = 32,5 kN", c?.reactions?.["1"]?.fz, 32.5);
  check("051 R₂ = 32,5 kN", c?.reactions?.["2"]?.fz, 32.5);
  check("051 M_midden = qL²/8 + FL/4 = 52,5 kNm", c?.elements?.["1"]?.M_end, 52.5);
  const w = (5 * 10 * 6000 ** 4) / (384 * EI) + (5000 * 6000 ** 3) / (48 * EI);
  check(`051 zakking midden = 5qL⁴/384EI + FL³/48EI = ${w.toFixed(3)} mm (hand met I van de catalogus: 10,89)`,
    -c?.displacements?.["3"]?.uz, w);
  // In-proces zonder profieldatabase: alleen die ene melding mag er staan.
  const overig = (a.result?.warnings ?? []).filter((m) => !m.startsWith("Geen profieldatabase meegegeven"));
  ok("051 bedoeld: geen waarschuwing over het model", overig.length === 0, JSON.stringify(overig));
}
{
  const a = vraag("solve", { model: M052(false), combinations: COMBI, detail: "stations" });
  ok("052 bedoeld: solve rekent", a.ok === true, a.error?.melding ?? "");
  const c = a.result?.combinations?.["1"];
  check("052 som verticaal = 10·6 + 20 + 3·6 = 98 kN", (c?.reactions?.["1"]?.fz ?? 0) + (c?.reactions?.["2"]?.fz ?? 0), 98);
  check("052 R₁ = 49 − 7/6 = 47,833 kN", c?.reactions?.["1"]?.fz, 49 - 7 / 6);
  check("052 R₂ = 49 + 7/6 = 50,167 kN", c?.reactions?.["2"]?.fz, 49 + 7 / 6);
  const st = c?.elements?.["1"];
  const midden = st?.stations_mm?.findIndex((x) => Math.abs(x - 3000) < 1e-6) ?? -1;
  check("052 M_midden = 92,0 kNm", st?.M_x?.[midden], 92.0);
  check("052 |M(knoop 1)| = 7,0 kNm (het koppel)", Math.abs(st?.M_start ?? NaN), 7.0);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] Projectbestand: de melding over wees-factoren noemt de last");
// ─────────────────────────────────────────────────────────────────────────
{
  const inhoud = readFileSync(PROJECT_052, "utf8");
  const v = vraag("validate", { project: { inhoud } });
  const wees = (v.result?.warnings ?? []).find((m) => m.includes("belastinggeval 5")) ?? "";
  ok("validate (project): ok:false", v.result?.ok === false);
  ok("de melding over de wees-factoren noemt last 1 in geval 5", /LET OP: er staat wél een last in een geval dat niet bestaat: last 1 \(geval 5\)/.test(wees), wees);
  ok("en zegt niet meer dat ze geen enkele last vermenigvuldigden", !/geen enkele last/.test(wees), wees);
  for (const op of ["solve", "check"]) {
    const a = vraag(op, { project: { inhoud } });
    ok(`${op} (project): geweigerd met de vier bevindingen`, a.ok === false && a.error?.detail?.fouten?.length === 4,
      JSON.stringify(a.error?.detail?.fouten));
  }
  // De functie zelf: zonder last in het weesgeval blijft de geruststelling
  // staan, en zonder lastenlijst beweert de melding niets over lasten.
  const geval = [{ id: 1, name: "G", type: "dead" }];
  const combi = [{ id: 1, name: "UGT", type: "uls", formula: "", factors: new Map([[1, 1], [5, 1]]) }];
  const zonderLast = openCombinatieStaat({ loadCases: geval, combinations: combi, gevolgklasse: "CC2", loads: [{ id: 1, caseId: 1 }] });
  ok("zonder last in geval 5: \"Er stond geen last in\"", /Er stond geen last in/.test(zonderLast.afwijking?.samenvatting ?? ""), zonderLast.afwijking?.samenvatting);
  const onbekend = openCombinatieStaat({ loadCases: geval, combinations: combi, gevolgklasse: "CC2" });
  ok("zonder lastenlijst: geen bewering over lasten", !/last/.test((onbekend.afwijking?.samenvatting ?? "").replace(/belastinggeval|belastingcombinatie/g, "")),
    onbekend.afwijking?.samenvatting);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[5] Een model zonder fouten rekent als voorheen");
// ─────────────────────────────────────────────────────────────────────────
{
  // Een fout die de KERN al weigert, houdt zijn eigen code: geen opleggingen.
  const zonder = { ...M051(false), supports: [] };
  const a = vraag("solve", { model: zonder, combinations: COMBI });
  ok("geen opleggingen: nog steeds MODEL_ONOPLOSBAAR (de kern gaat voor)", a.ok === false && a.error?.code === "MODEL_ONOPLOSBAAR",
    `${a.error?.code}: ${a.error?.melding}`);
  // Een onbekend profiel: nog steeds DOORSNEDE_ONBEKEND.
  const onbekend = M051(false);
  onbekend.beams[0].profile = "IPE299";
  const b = vraag("solve", { model: onbekend, combinations: COMBI });
  ok("onbekend profiel: nog steeds DOORSNEDE_ONBEKEND", b.ok === false && b.error?.code === "DOORSNEDE_ONBEKEND", `${b.error?.code}`);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[6] De gebouwde MCP-server");
// ─────────────────────────────────────────────────────────────────────────
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
    schrijf({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-last-verwijzing-mcp", version: "1" } } });
    aanroepen.forEach((a, n) => schrijf({ jsonrpc: "2.0", id: n + 2, method: "tools/call", params: { name: a.name, arguments: a.arguments } }));
  });
}
/** Het tool-antwoord als object, of de fouttekst. */
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
  const aanroepen = [
    { name: "solve_fem_model", arguments: { model: M051(true), combinations: COMBI } },
    { name: "check_fem_model", arguments: { model: M051(true), combinations: COMBI } },
    { name: "solve_fem_model", arguments: { model: M052(true), combinations: COMBI_052 } },
    { name: "check_fem_model", arguments: { model: M052(true), combinations: COMBI_052 } },
    { name: "validate_fem_model", arguments: { model: M052(true) } },
    { name: "solve_fem_model", arguments: { project_path: PROJECT_052 } },
    { name: "solve_fem_model", arguments: { model: M051(false), combinations: COMBI } },
    { name: "solve_fem_model", arguments: { model: M052(false), combinations: COMBI } },
    { name: "solve_fem_model", arguments: { model: MET_DEEL(OMGEKEERD), combinations: COMBI } },
  ];
  const a = (await mcp(aanroepen)).map(lees);
  ok("MCP solve 051: geweigerd, noemt staaf 7", /INVOER_ONGELDIG/.test(a[0].fout ?? "") && /Last 1 verwijst naar staaf 7/.test(a[0].fout ?? ""), (a[0].fout ?? JSON.stringify(a[0].uit)).slice(0, 200));
  ok("MCP check 051: geweigerd, noemt staaf 7", /INVOER_ONGELDIG/.test(a[1].fout ?? "") && /Last 1 verwijst naar staaf 7/.test(a[1].fout ?? ""), (a[1].fout ?? "").slice(0, 200));
  ok("MCP solve 052: geweigerd, noemt het koppel", /INVOER_ONGELDIG/.test(a[2].fout ?? "") && /Koppel 3 op knoop 1/.test(a[2].fout ?? ""), (a[2].fout ?? "").slice(0, 300));
  ok("MCP check 052: geweigerd", /INVOER_ONGELDIG/.test(a[3].fout ?? ""), (a[3].fout ?? "").slice(0, 200));
  ok("MCP validate 052: ok:false met vier fouten", a[4].uit?.ok === false && a[4].uit?.errors?.length === 4, JSON.stringify(a[4].uit?.errors ?? a[4].fout));
  ok("MCP solve met project_path 052: geweigerd", /INVOER_ONGELDIG/.test(a[5].fout ?? ""), (a[5].fout ?? "").slice(0, 200));
  const c051 = a[6].uit?.combinations?.["1"];
  check("MCP 051 bedoeld: R₁ = 32,5 kN", c051?.reactions?.["1"]?.fz, 32.5);
  check("MCP 051 bedoeld: M_midden = 52,5 kNm", c051?.elements?.["1"]?.M_end, 52.5);
  const c052 = a[7].uit?.combinations?.["1"];
  check("MCP 052 bedoeld: R₁ = 47,833 kN", c052?.reactions?.["1"]?.fz, 49 - 7 / 6);
  check("MCP 052 bedoeld: R₂ = 50,167 kN", c052?.reactions?.["2"]?.fz, 49 + 7 / 6);
  ok("MCP solve met een omgekeerd belast deel: geweigerd", /INVOER_ONGELDIG/.test(a[8].fout ?? "") && /het belaste deel begint niet vóór zijn einde/.test(a[8].fout ?? ""),
    (a[8].fout ?? JSON.stringify(a[8].uit?.combinations?.["1"]?.reactions)).slice(0, 200));
}

log(`\n${failed === 0 ? "GESLAAGD" : "GEFAALD"}: ${passed} geslaagd, ${failed} gefaald.`);
process.exit(failed === 0 ? 0 : 1);

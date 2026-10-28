// Een lijnlast met alleen qStart en qEnd is een trapeziumlast — ook zonder `q`
// (controle 12 oktober 2026, punt K2, issue #184).
//
// WAT ER MISGING
//  `bouwMultiInput` nam een lijnlast alleen mee met `q`. Een driehoekslast
//  0 → 6 kN/m met alleen qStart/qEnd werd op het tekenvlak getekend maar viel
//  uit de berekening: via de MCP stil (R_A = 37,5 / R_B = 12,5 kN waar 43,5 /
//  24,5 kN hoort, `warnings: []`), in de app met een programmeursmelding. Met
//  een willekeurige `q` erbij (ook +999) rekende hij wél exact met qStart/qEnd:
//  `q` werkte als aan/uit-schakelaar.
//
// WAT DEZE TEST VASTLEGT (ligger 6 m, scharnier A, rol B; handwaarden)
//  [1] 028-a: deellast 10 kN/m over 0–3 m + driehoek 0 → 6 kN/m zonder q +
//      20 kN op 1,5 m: R_B = (30·1,5 + 18·4 + 20·1,5)/6 = 24,5 kN, R_A = 43,5 kN;
//      M_max waar V = 23,5 − 10x − x²/2 = 0, x = 2,124 m.
//  [2] 028-b: driehoek zonder q, met q, en qStart = qEnd zonder q:
//      R = 6 / 12 kN en M_max = q₀L²/(9√3) op x = L/√3; uniform 18 / 18 kN.
//  [3] `q` is geen schakelaar: met qStart en qEnd wordt q (ook +999) niet
//      gebruikt.
//  [4] Een lijnlast zonder waarde: een begrijpelijke melding ("Lijnlast 2 op
//      staaf 1 heeft geen waarde"), en solve weigert in plaats van stil te
//      rekenen — ook in een geval met andere lasten.
//  [5] De gebouwde MCP-server: solve_fem_model en check_fem_model.
//
// Draaien met: npx tsx test-trapeziumlast-zonder-q.mjs  (ook tegen de sidecarbundel)

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { verwerkVerzoek } = await import("./src/mcp/sidecar.ts");
const { valideerModel } = await import("./src/mcp/valideerModel.ts");
const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");

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
function check(naam, waarde, verwacht, relTol = 1e-4) {
  const goed = Number.isFinite(waarde) && Math.abs(waarde - verwacht) <= relTol * Math.max(1, Math.abs(verwacht));
  ok(`${naam}: ${Number(waarde).toFixed(4)} ≈ ${verwacht.toFixed(4)}`, goed);
}

const L = 6; // m
const ligger = (gevallen, loads) => ({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }],
  beams: [{ id: 1, from: 1, to: 2, profile: "IPE300", material: "S235" }],
  supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
  loadCases: gevallen,
  loads,
});
const M028a = (driehoek = { qStart: 0, qEnd: -6 }) => ligger(
  [{ id: 1, name: "G", type: "dead" }],
  [
    { id: 1, type: "lineLoad", beamId: 1, q: -10, startFrac: 0, endFrac: 0.5, caseId: 1 },
    { id: 2, type: "lineLoad", beamId: 1, ...driehoek, caseId: 1 },
    { id: 3, type: "pointForce", beamId: 1, posFrac: 0.25, fz: -20, caseId: 1 },
  ],
);
const COMBI_A = [{ id: 1, name: "G x 1,0", type: "uls", factors: { 1: 1 } }];
const M028b = () => ligger(
  [
    { id: 1, name: "A driehoek zonder q", type: "dead" },
    { id: 2, name: "B driehoek met q", type: "dead" },
    { id: 3, name: "C qStart=qEnd zonder q", type: "dead" },
  ],
  [
    { id: 1, type: "lineLoad", beamId: 1, qStart: 0, qEnd: -6, startFrac: 0, endFrac: 1, caseId: 1 },
    { id: 2, type: "lineLoad", beamId: 1, qStart: 0, qEnd: -6, q: -6, caseId: 2 },
    { id: 3, type: "lineLoad", beamId: 1, qStart: -6, qEnd: -6, caseId: 3 },
  ],
);
const COMBI_B = [1, 2, 3].map((id) => ({ id, name: "ABC"[id - 1], type: "uls", factors: { [id]: 1 } }));

const vraag = (op, payload) => verwerkVerzoek({ v: 1, id: 1, op, payload });

// Handwaarden 028-a: veld 1,5 < x < 3 m, V(x) = 23,5 − 10x − x²/2 (kN, m).
const x028 = -10 + Math.sqrt(100 + 47); // wortel van x² + 20x − 47 = 0
const M028 = 43.5 * x028 - 20 * (x028 - 1.5) - 5 * x028 ** 2 - x028 ** 3 / 6;
// Driehoek 0 → q₀ over L: M_max = q₀L²/(9√3) op x = L/√3.
const Mdriehoek = (6 * L * L) / (9 * Math.sqrt(3));

// ─────────────────────────────────────────────────────────────────────────
log(`\n[1] 028-a: driehoek zonder q in een geval met andere lasten (hand: M_max ${M028.toFixed(3)} kNm op x = ${x028.toFixed(4)} m)`);
// ─────────────────────────────────────────────────────────────────────────
{
  const mi = bouwMultiInput({ ...M028a(), plates: [], selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1 });
  ok("de mapping neemt de driehoek mee (twee lijnlasten in de solverinvoer)", mi.loads.length === 2, JSON.stringify(mi.loads));
  const d = mi.loads.find((l) => l.qEnd === -6);
  ok("de driehoek gaat als qStart 0 / qEnd −6 naar de engine", d?.qStart === 0 && d?.qEnd === -6, JSON.stringify(d));
  const v = valideerModel(M028a());
  ok("validate: ok:true", v.ok, JSON.stringify(v.errors));
  const a = vraag("solve", { model: M028a(), combinations: COMBI_A, detail: "stations" });
  ok("solve rekent", a.ok === true, a.error?.melding ?? "");
  const c = a.result?.combinations?.["1"];
  check("R_A = 43,5 kN (was 37,5)", c?.reactions?.["1"]?.fz, 43.5);
  check("R_B = 24,5 kN (was 12,5)", c?.reactions?.["2"]?.fz, 24.5);
  check("M_max veld (omhullende)", a.result?.envelope?.elements?.["1"]?.M_max, M028);
  check("plaats van M_max (mm)", a.result?.envelope?.elements?.["1"]?.governingMPos_mm, x028 * 1000);
  ok("geen geval overgeslagen", (a.result?.cases_skipped_empty ?? []).length === 0, JSON.stringify(a.result?.cases_skipped_empty));
  // Met q = −6 erbij (het bestand "zoals de app hem wel rekende"): identiek.
  const b = vraag("solve", { model: M028a({ qStart: 0, qEnd: -6, q: -6 }), combinations: COMBI_A });
  check("met q = −6 erbij: zelfde R_A", b.result?.combinations?.["1"]?.reactions?.["1"]?.fz, 43.5);
}

// ─────────────────────────────────────────────────────────────────────────
log(`\n[2] 028-b: drie losse gevallen (hand: driehoek 6 / 12 kN, M_max ${Mdriehoek.toFixed(3)} kNm; uniform 18 / 18 kN)`);
// ─────────────────────────────────────────────────────────────────────────
{
  const a = vraag("solve", { model: M028b(), combinations: COMBI_B, detail: "stations" });
  ok("solve rekent", a.ok === true, a.error?.melding ?? "");
  ok("cases_solved = [1, 2, 3], niets overgeslagen",
    JSON.stringify(a.result?.cases_solved) === "[1,2,3]" && (a.result?.cases_skipped_empty ?? []).length === 0,
    JSON.stringify([a.result?.cases_solved, a.result?.cases_skipped_empty]));
  for (const [id, naam] of [[1, "A zonder q"], [2, "B met q"]]) {
    const c = a.result?.combinations?.[String(id)];
    check(`${naam}: R_A = 6,0 kN`, c?.reactions?.["1"]?.fz, 6);
    check(`${naam}: R_B = 12,0 kN`, c?.reactions?.["2"]?.fz, 12);
  }
  const cC = a.result?.combinations?.["3"];
  check("C qStart = qEnd zonder q: R_A = 18 kN", cC?.reactions?.["1"]?.fz, 18);
  check("C: R_B = 18 kN", cC?.reactions?.["2"]?.fz, 18);
  // Het veldmaximum van de driehoek ligt op L/√3 = 3464 mm, tussen de
  // stations 3300 en 3600: exact door de verfijning (punt C8).
  const env = a.result?.envelope?.elements?.["1"];
  ok("omhullende: M_max van C = qL²/8 = 27 kNm is maatgevend", Math.abs((env?.M_max ?? 0) - 27) < 1e-6, String(env?.M_max));
  const alleenA = vraag("solve", { model: M028b(), combinations: [COMBI_B[0]] });
  check("A alleen: M_max = q₀L²/(9√3)", alleenA.result?.envelope?.elements?.["1"]?.M_max, Mdriehoek);
  check("A alleen: op x = L/√3 (mm)", alleenA.result?.envelope?.elements?.["1"]?.governingMPos_mm, 6000 / Math.sqrt(3));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] q is geen aan/uit-schakelaar meer");
// ─────────────────────────────────────────────────────────────────────────
{
  const model = M028b();
  model.loads = [{ id: 1, type: "lineLoad", beamId: 1, qStart: 0, qEnd: -6, q: 999, caseId: 1 }];
  const a = vraag("solve", { model, combinations: [COMBI_B[0]] });
  const c = a.result?.combinations?.["1"];
  check("met q = +999 naast qStart 0 / qEnd −6: R_A = 6,0 kN (q niet gebruikt)", c?.reactions?.["1"]?.fz, 6);
  check("R_B = 12,0 kN", c?.reactions?.["2"]?.fz, 12);
  // Zonder q en met q: dezelfde solverinvoer voor de engine (qStart/qEnd).
  const zonder = bouwMultiInput({ ...M028b(), plates: [], selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1 });
  ok("lijnlast zonder q telt mee in de solverinvoer (drie lijnlasten)", zonder.loads.length === 3, String(zonder.loads.length));
  // q blijft de terugval voor een ontbrekend uiteinde: qStart −2 met q −6 → −2 → −6.
  const half = vraag("solve", { model: { ...M028b(), loads: [{ id: 1, type: "lineLoad", beamId: 1, qStart: -2, q: -6, caseId: 1 }] }, combinations: [COMBI_B[0]] });
  // −2 → −6 over 6 m: 12 kN uniform + driehoek 12 kN: R_A = 6 + 4 = 10, R_B = 6 + 8 = 14.
  check("qStart −2 met q −6 als terugval voor qEnd: R_A = 10 kN", half.result?.combinations?.["1"]?.reactions?.["1"]?.fz, 10);
  check("R_B = 14 kN", half.result?.combinations?.["1"]?.reactions?.["2"]?.fz, 14);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] Een lijnlast zonder waarde: begrijpelijke melding, en solve weigert");
// ─────────────────────────────────────────────────────────────────────────
{
  const geen = M028a({});
  const v = valideerModel(geen);
  ok("validate: \"Lijnlast 2 op staaf 1 heeft geen waarde\"",
    !v.ok && v.errors.some((e) => e.startsWith("Lijnlast 2 op staaf 1 heeft geen waarde.")), JSON.stringify(v.errors));
  ok("en niet daarnaast de algemene programmeursmelding", !v.errors.some((e) => e.includes("levert geen invoer")), JSON.stringify(v.errors));
  for (const op of ["solve", "check"]) {
    const a = vraag(op, { model: geen, combinations: COMBI_A });
    ok(`${op}: geweigerd, ook al heeft het geval andere lasten`, a.ok === false && a.error?.code === "INVOER_ONGELDIG"
      && /Lijnlast 2 op staaf 1 heeft geen waarde/.test(a.error?.melding ?? ""), a.error?.melding ?? JSON.stringify(a.result?.warnings));
  }
  const half = valideerModel(M028a({ qStart: 0 }));
  ok("alleen qStart: \"heeft wel `qStart` maar geen `qEnd`\"",
    !half.ok && half.errors.some((e) => e.includes("Lijnlast 2 op staaf 1 heeft wel `qStart` maar geen `qEnd`")), JSON.stringify(half.errors));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[5] De gebouwde MCP-server");
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
    schrijf({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-trapeziumlast-zonder-q", version: "1" } } });
    aanroepen.forEach((a, n) => schrijf({ jsonrpc: "2.0", id: n + 2, method: "tools/call", params: { name: a.name, arguments: a.arguments } }));
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
  const a = (await mcp([
    { name: "solve_fem_model", arguments: { model: M028a(), combinations: COMBI_A } },
    { name: "solve_fem_model", arguments: { model: M028b(), combinations: COMBI_B } },
    { name: "check_fem_model", arguments: { model: M028a(), combinations: COMBI_A } },
    { name: "solve_fem_model", arguments: { model: M028a({}), combinations: COMBI_A } },
  ])).map(lees);
  const c = a[0].uit?.combinations?.["1"];
  check("MCP 028-a: R_A = 43,5 kN", c?.reactions?.["1"]?.fz, 43.5);
  check("MCP 028-a: R_B = 24,5 kN", c?.reactions?.["2"]?.fz, 24.5);
  check("MCP 028-a: M_max", a[0].uit?.envelope?.elements?.["1"]?.M_max, M028);
  ok("MCP 028-a: geen waarschuwing", (a[0].uit?.warnings ?? []).length === 0, JSON.stringify(a[0].uit?.warnings));
  const b = a[1].uit?.combinations;
  check("MCP 028-b A (zonder q): R_A = 6 kN", b?.["1"]?.reactions?.["1"]?.fz, 6);
  check("MCP 028-b A: R_B = 12 kN", b?.["1"]?.reactions?.["2"]?.fz, 12);
  check("MCP 028-b C (qStart = qEnd, zonder q): R_A = 18 kN", b?.["3"]?.reactions?.["1"]?.fz, 18);
  const fe = a[2].uit?.steel_check_inputs?.[0]?.forces_envelope ?? [];
  const begin = fe.find((p) => p.position_mm === 0);
  check("MCP check 028-a: V_Ed bij de oplegging = 43,5 kN (was 37,5)", Math.abs(begin?.forces?.vz_ed ?? NaN), 43.5);
  ok("MCP solve zonder waarde: geweigerd met \"heeft geen waarde\"", /INVOER_ONGELDIG/.test(a[3].fout ?? "") && /Lijnlast 2 op staaf 1 heeft geen waarde/.test(a[3].fout ?? ""), (a[3].fout ?? "").slice(0, 200));
}

log(`\n${failed === 0 ? "GESLAAGD" : "GEFAALD"}: ${passed} geslaagd, ${failed} gefaald.`);
process.exit(failed === 0 ? 0 : 1);

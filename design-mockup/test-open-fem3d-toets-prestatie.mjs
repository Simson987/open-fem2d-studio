// Issue #213: de rekentijd van de 3D-UGT-toets op de standaardhal met
// trek-alleen verbanden, zichtbaar in de testuitvoer.
//
// Sinds #199 rekent de UGT-toets elke UGT-combinatie in +X, −X, +Y en −Y met
// P-Δ en scheefstand; met trek-alleen staven itereert elke variant ook de
// trek-alleenstatus. Deze proef rekent de 28 toetsverzoeken van de hal
// (`staalhal_maken`, balkrooster, trek-alleen wand- en dakverbanden) door de
// 3D-kern, zoals de MCP-server (4 tegelijk), en drukt per variant de tijd, de
// statusrondes en de P-Δ-iteraties af. Getallen worden niet hard getoetst (de
// tijd hangt van de machine af); wel dat elke variant slaagt en dat de
// symbolische analyse van K + K_G per P-Δ-som één keer wordt gemaakt en daarna
// hergebruikt (`tweede_orde.rs`, vast patroon).
//
// Meting bij #213 (release-binary, 8 kernen, druk systeem; som over de 28
// verzoeken van het minimum van 3 runs, afwisselend oud/nieuw):
//   vóór (verse symbolische analyse per iteratie) 24,81 s, na 23,26 s (−6 %).
// Profiel van één variant (≈ 450 ms): 3 lineaire statusrondes ≈ 70 ms, het
// fijne model + eerste orde ≈ 55 ms, assemblage ≈ 30 ms, de knikanalyse
// (Lanczos van de vastgezette kern, stabiliteitspoort) ≈ 170 ms, 4–6 P-Δ-
// iteraties ≈ 90 ms (waarvan de symbolische analyse ≈ 8 ms per iteratie),
// eindstap ≈ 50 ms.
//
// Rekenkern: OPEN_FEM_3D_SOLVER_PATH, anders de release- en dan de debugbuild.
// Uitvoeren: npx tsx test-open-fem3d-toets-prestatie.mjs (vanuit design-mockup/)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { verwerkVerzoek } from "./src/mcp/kernel-exports.ts";

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};

const exe = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const pad = (soort) => fileURLToPath(new URL(`../src-tauri/target/${soort}/${exe}`, import.meta.url));
const kernPad = process.env.OPEN_FEM_3D_SOLVER_PATH ?? [pad("release"), pad("debug")].find(existsSync);
if (!kernPad) {
  check("3D-kern gevonden (cargo build --release -p open-fem-3d)", false);
  process.exit(1);
}

const kern = (request) => new Promise((resolve) => {
  const t0 = performance.now();
  const child = spawn(kernPad, [], { stdio: ["pipe", "pipe", "pipe"] });
  const uit = [];
  child.stdout.on("data", (d) => uit.push(d));
  child.on("close", (code) => {
    const ms = performance.now() - t0;
    const tekst = Buffer.concat(uit).toString();
    let r = null;
    try { r = JSON.parse(tekst); } catch { /* fout hieronder */ }
    resolve({ ms, code, r });
  });
  child.stdin.end(JSON.stringify(request));
});

const a = verwerkVerzoek({
  v: 1, id: 1, op: "staalhal_maken",
  payload: { hal: { fundering: { type: "balkrooster" }, verbanden: { trekAlleen: true } }, reken: {} },
});
check("staalhal_maken met trek-alleen verbanden", a.ok, JSON.stringify(a.error));
const verzoeken = a.result.toetsverzoeken;
const eerste = verzoeken[0].verzoek;
console.log(`  hal: ${eerste.members.length} staven (${eerste.members.filter((m) => m.tensionOnly).length} trek-alleen), ` +
  `${eerste.nodes.length} knopen; ${verzoeken.length} toetsverzoeken (P-Δ, ±X/±Y); kern ${kernPad.includes("release") ? "release" : "debug"}`);

const TEGELIJK = Math.max(1, Math.min(4, availableParallelism()));
const uitkomsten = new Array(verzoeken.length);
let volgende = 0;
const t0 = performance.now();
await Promise.all(Array.from({ length: TEGELIJK }, async () => {
  while (volgende < verzoeken.length) {
    const i = volgende++;
    uitkomsten[i] = await kern(verzoeken[i].verzoek);
  }
}));
const wand = performance.now() - t0;

const richting = ["+X", "−X", "+Y", "−Y"];
console.log("  variant            tijd    statusrondes  P-Δ-iteraties  symbolisch (gemaakt/hergebruikt)");
let allesGoed = true, allesHergebruik = true;
for (const [i, v] of verzoeken.entries()) {
  const u = uitkomsten[i];
  const diag = u.r?.diagnostics ?? [];
  const rondes = diag.map((d) => /(\d+) statusronde/.exec(d)?.[1]).find(Boolean) ?? "-";
  const pd = diag.find((d) => d.startsWith("Tweede orde:")) ?? "";
  const it = /(\d+) iteraties/.exec(pd)?.[1] ?? "-";
  const sym = /symbolische analyse (\d+) keer gemaakt, (\d+) keer hergebruikt/.exec(pd);
  if (u.code !== 0) allesGoed = false;
  if (!sym || sym[1] !== "1") allesHergebruik = false;
  const naam = `${v.id % 1_000_000} ${richting[Math.floor(v.id / 1_000_000)]}`;
  console.log(`  ${naam.padEnd(16)} ${u.ms.toFixed(0).padStart(6)} ms  ${String(rondes).padStart(6)}  ${String(it).padStart(12)}      ${sym ? `${sym[1]}/${sym[2]}` : "-"}`);
}
const tijden = uitkomsten.map((u) => u.ms).sort((p, q) => p - q);
console.log(`  totaal ${(wand / 1000).toFixed(2)} s wandtijd (${TEGELIJK} tegelijk), som ${(tijden.reduce((t, x) => t + x, 0) / 1000).toFixed(2)} s, ` +
  `mediaan ${tijden[tijden.length >> 1].toFixed(0)} ms, max ${tijden.at(-1).toFixed(0)} ms per variant`);

check("elke toetsvariant slaagt (P-Δ met trek-alleen verbanden)", allesGoed);
check("per P-Δ-som één symbolische analyse, daarna hergebruikt (vast patroon van K + K_G)", allesHergebruik);
check("elke variant is P-Δ", uitkomsten.every((u) => u.r?.analysis === "p-delta"));

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
if (gefaald > 0) process.exit(1);

// De wandverbanden van de halwizard (issue #199): de wizard begint met
// TREK-ALLEEN verbanden (`STAALHAL_WIZARD_BEGINSTAND`).
//
// WAAROM. De UGT-toets rekent altijd P-Δ met scheefstand. In het
// voorbeeldmodel (`STAALHAL_STANDAARD`, verbanden niet trek-alleen) knikken de
// wandverbanden CHS 88,9×4 van ruim 10 m zelf onder "wind langs":
//   π²·E·I/L² = 19,97 kN tegen N = −29,3 kN (6.10b) → α_cr = 0,688
// (test-open-fem3d-staalhal-pdelta.mjs), en de toets van de standaardhal werd
// geweigerd. Met trek-alleen verbanden doet een gedrukte diagonaal niet mee:
// geen druk in een verband, dus geen knik van het verband, en de toets heeft
// krachten.
//
// Bewaakt:
//   1. de beginstand is het voorbeeldmodel met alleen trekAlleen = true; het
//      voorbeeldmodel zelf blijft (de referentie van de verificatie);
//   2. de wizard start met die beginstand (broncontrole; de UI-test vraagt een
//      browser);
//   3. de UGT-toetsverzoeken van de hal uit die beginstand (opleggingen, ±X/±Y,
//      P-Δ) slagen allemaal in de 3D-kern, met α_cr > 1. Een actief verband
//      draagt hooguit de kleine druk van de kruisregel (in een kruis waarin
//      geen diagonaal op trek staat, blijft die met de grootste N actief; de
//      kern meldt dat): per staaf ligt die ruim onder zijn eigen knikkracht
//      π²·E·I/L² (hand, met E·I van CHS 88,9×4 en de staaflengte).
// Rekenkern: OPEN_FEM_3D_SOLVER_PATH, anders de release- en dan de debugbuild.
// Uitvoeren: npx tsx test-staalhal-wizard-verbanden.mjs
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { STAALHAL_STANDAARD, STAALHAL_WIZARD_BEGINSTAND } from "./src/components/openFem3d/wizards/staalhal.ts";
import { verwerkVerzoek } from "./src/mcp/kernel-exports.ts";
import { resolveSection } from "./src/lib/sectionResolver.ts";

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};

console.log("[1] de beginstand");
check("trek-alleen in de beginstand, niet in het voorbeeldmodel",
  STAALHAL_WIZARD_BEGINSTAND.verbanden.trekAlleen === true && STAALHAL_STANDAARD.verbanden.trekAlleen === false);
check("verder gelijk aan het voorbeeldmodel",
  JSON.stringify({ ...STAALHAL_WIZARD_BEGINSTAND, verbanden: { ...STAALHAL_WIZARD_BEGINSTAND.verbanden, trekAlleen: false } })
    === JSON.stringify(STAALHAL_STANDAARD));
const wizard = readFileSync(new URL("./src/components/openFem3d/wizards/StaalhalWizard.tsx", import.meta.url), "utf8");
check("de wizard start met de beginstand", /function standaardToestand\(\)[\s\S]{0,200}const s = STAALHAL_WIZARD_BEGINSTAND;/.test(wizard));

console.log("\n[2] de UGT-toets van de hal uit de beginstand");
const exe = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const pad = (soort) => fileURLToPath(new URL(`../src-tauri/target/${soort}/${exe}`, import.meta.url));
const kernPad = process.env.OPEN_FEM_3D_SOLVER_PATH ?? [pad("release"), pad("debug")].find(existsSync);
if (!kernPad) {
  check("3D-kern gevonden (cargo build -p open-fem-3d)", false);
} else {
  const kern = (request) => new Promise((resolve) => {
    const child = spawn(kernPad, [], { stdio: ["pipe", "pipe", "pipe"] });
    const uit = [];
    child.stdout.on("data", (d) => uit.push(d));
    child.on("close", (code) => {
      let r = null;
      try { r = JSON.parse(Buffer.concat(uit).toString()); } catch { /* hieronder */ }
      resolve({ code, r });
    });
    child.stdin.end(JSON.stringify(request));
  });
  const a = verwerkVerzoek({ v: 1, id: 1, op: "staalhal_maken", payload: { hal: { verbanden: { trekAlleen: true } }, reken: {} } });
  check("staalhal_maken met de verbanden van de beginstand", a.ok, JSON.stringify(a.error));
  const verzoeken = a.result?.toetsverzoeken ?? [];
  const trekAlleen = new Set((verzoeken[0]?.verzoek.members ?? []).filter((m) => m.tensionOnly).map((m) => m.id));
  console.log(`  ${verzoeken.length} toetsverzoeken, ${trekAlleen.size} trek-alleen verbanden`);
  const uitkomsten = new Array(verzoeken.length);
  let volgende = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(4, availableParallelism())) }, async () => {
    while (volgende < verzoeken.length) {
      const i = volgende++;
      uitkomsten[i] = await kern(verzoeken[i].verzoek);
    }
  }));
  check("er zijn toetsverzoeken (UGT × ±X/±Y) en trek-alleen verbanden", verzoeken.length >= 4 && trekAlleen.size > 0);
  check("elke toetsvariant slaagt, P-Δ", uitkomsten.every((u) => u.code === 0 && u.r?.analysis === "p-delta"),
    uitkomsten.filter((u) => u.code !== 0).map((u) => JSON.stringify(u.r ?? {}).slice(0, 200)).join(" | "));
  const alpha = uitkomsten.map((u) => u.r?.buckling?.modes?.[0]?.loadFactor ?? null);
  console.log(`  α_cr: kleinste ${Math.min(...alpha.filter((x) => x !== null)).toFixed(3)} over ${alpha.length} varianten`);
  check("α_cr bepaald en > 1 in elke variant (de standaardhal zonder trek-alleen: 0,688)",
    alpha.every((x) => typeof x === "number" && x > 1), JSON.stringify(alpha.slice(0, 8)));
  const d = resolveSection("S235", "CHS 88.9x4");
  const ei = d.E * 1000 * d.I * 1e-12; // kNm²
  const knoop = new Map(verzoeken[0].verzoek.nodes.map((n) => [n.id, n]));
  const staaf = new Map(verzoeken[0].verzoek.members.map((m) => [m.id, m]));
  let minAlpha = Infinity, maxDruk = 0;
  for (const u of uitkomsten) {
    for (const f of u.r?.memberForces ?? []) {
      if (!trekAlleen.has(f.memberId)) continue;
      const n = Math.min(f.nStartKn ?? 0, f.nEndKn ?? 0);
      if (n >= -1e-9) continue;
      const m = staaf.get(f.memberId), a = knoop.get(m.startNodeId), b = knoop.get(m.endNodeId);
      const l = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      maxDruk = Math.min(maxDruk, n);
      minAlpha = Math.min(minAlpha, (Math.PI ** 2 * ei) / (l * l * -n));
    }
  }
  console.log(`  grootste druk in een actief verband (kruisregel) ${maxDruk.toFixed(3)} kN, kleinste N_cr/|N| = ${minAlpha.toFixed(2)}`);
  check("een actief verband op druk (kruisregel) blijft ruim onder zijn knikkracht: N_cr/|N| > 3", minAlpha > 3, `${minAlpha}`);
}

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
if (gefaald > 0) process.exit(1);

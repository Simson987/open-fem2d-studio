// Knikfactor van de 3D-kern bij staven zonder tussenknopen (controle oktober
// 2026, punt K4, issue #186), langs de twee wegen die de controle naspeelde.
//
// 1. De app: het projectbestand → `deserializeProject` → het rekenverzoek
//    zoals `solveOpenFem3D` het bij tweede orde bouwt
//    (`buildOpenFem3DSolveRequest`, "p-delta") → de 3D-kern
//    (src-tauri/target/debug/open-fem-3d, of OPEN_FEM_3D_SOLVER_PATH). De
//    modellen gebruiken catalogusprofielen, dus de handwaarden rekenen met de
//    doorsneden uit het verzoek.
// 2. De MCP-server: `solve_open_fem_3d` met de exacte aanroepen van de
//    controle (losse A, I, J).
//
// De kern rekende elke staaf zonder tussenknopen als één element: N_cr =
// 12·EI/L² in plaats van π²·EI/L² (+21,6 %), en bij staven met scharnieren aan
// beide einden geen eigen knikvorm (α_cr ×65 tot ×434), of bij een aan beide
// einden ingeklemde staaf geen knikfactor en een geblokkeerde tweede orde. De
// adapter verdeelt de staven nu voor knik en tweede orde in vier delen; dan
// ligt α_cr 0,06 % (scharnierend) tot 0,75 % (ingeklemd) boven de exacte
// Euler-waarde. Handwaarden:
//   021 pendelstaaf 5 m, N = 300 kN:   α_cr = π²EI/(L²N)
//   045 regel 4 m scharnier-scharnier: α_cr = π²EI/(L²N_regel)
//   061/062 driepoot, poot 3,786 m:     α_cr = π²EI/(L²N_poot)
//   038 ingeklemd 5 m, ΔT = +30 K:      N = E·A·α·ΔT, α_cr = 4π²EI_z/(L²N)
//
// Uitvoeren: npx tsx test-open-fem3d-knik-onderverdeling.mjs

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenFem3DSolveRequest } from "./src/components/openFem3d/openFem3dSolver.ts";
import { deserializeProject } from "./src/io/projectFile.ts";

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HIER, "..");
const DATA = join(HIER, "testdata", "controle-2026-10", "k4");
const win = process.platform === "win32";
const SOLVER = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? join(REPO, "src-tauri", "target", "debug", win ? "open-fem-3d.exe" : "open-fem-3d");
const MCP_SERVER = join(REPO, "src-tauri", "target", "release", win ? "openaec-mcp-server.exe" : "openaec-mcp-server");
const E = 210e6; // kN/m²

let mislukt = 0;
function controle(naam, voorwaarde, extra = "") {
  console.log(`  ${voorwaarde ? "✓" : "✗"} ${naam}${extra ? `  (${extra})` : ""}`);
  if (!voorwaarde) mislukt++;
}
/** FE-waarde boven de exacte, en hoogstens `max` relatief erboven. */
function boven(naam, waarde, hand, max) {
  const r = (waarde - hand) / hand;
  controle(naam, Number.isFinite(r) && r >= -1e-9 && r <= max,
    `${Number(waarde).toFixed(4)} tegen hand ${hand.toFixed(4)}, ${(r * 100).toFixed(3)} %`);
}

const reken = (verzoek) => new Promise((klaar, mis) => {
  const kind = spawn(SOLVER, [], { stdio: ["pipe", "pipe", "pipe"] });
  const uit = [], fout = [];
  kind.stdout.on("data", (d) => uit.push(d));
  kind.stderr.on("data", (d) => fout.push(d));
  kind.on("error", mis);
  kind.on("close", (code) => {
    const tekst = Buffer.concat(uit).toString();
    if (code !== 0) return mis(new Error(`3D-kern: exit ${code}; ${Buffer.concat(fout).toString().slice(0, 400)} ${tekst.slice(0, 400)}`));
    try { klaar(JSON.parse(tekst)); } catch (e) { mis(e); }
  });
  kind.stdin.end(JSON.stringify(verzoek));
});

const knikfactor = (r) => {
  assert.equal(r.buckling?.status, "available", `knikanalyse: ${JSON.stringify(r.buckling).slice(0, 300)}`);
  return r.buckling.modes[0].loadFactor;
};
const lengte = (verzoek, staaf) => {
  const knoop = (id) => verzoek.nodes.find((n) => n.id === id);
  const a = knoop(staaf.startNodeId), b = knoop(staaf.endNodeId);
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
};
const doorsnede = (verzoek, staafId) => {
  const staaf = verzoek.members.find((m) => m.id === staafId);
  return verzoek.sections.find((s) => s.id === staaf.sectionId);
};
/** De eerste-ordenormaalkracht van een staaf uit de knikgegevens (trek positief). */
const nKnik = (r, staafId) => r.buckling.members.find((m) => m.memberId === staafId)?.axialForceKn;

// ─────────────────────────────────────────────────────────────────────────
console.log("\n[1] De app: projectbestand → rekenverzoek bij tweede orde → 3D-kern");
// ─────────────────────────────────────────────────────────────────────────
if (!existsSync(SOLVER)) {
  controle("3D-kern gevonden — bouw hem met `cargo build -p open-fem-3d`", false, SOLVER);
} else {
  const app = async (bestand) => {
    const project = deserializeProject(readFileSync(join(DATA, bestand), "utf8"));
    const verzoek = buildOpenFem3DSolveRequest(project.model3d, "p-delta", project.activeLoadCaseId ?? 1);
    controle(`${bestand}: tweede orde met knikanalyse gevraagd`, verzoek.analysis === "p-delta" && verzoek.bucklingModes > 0);
    return { verzoek, r: await reken(verzoek) };
  };
  {
    // 021: HEA 200, 5 m, scharnier-scharnier, N = 300 kN; knik om de zwakke as.
    const { verzoek, r } = await app("model-021-pendelstaaf.ifcfem");
    const d = doorsnede(verzoek, 1);
    const hand = Math.PI ** 2 * E * Math.min(d.iyM4, d.izM4) / (5 ** 2 * Math.abs(nKnik(r, 1)));
    boven("021 HEA 200: α_cr = π²EI_z/(L²N) = 3,703 (één element gaf 4,502)", knikfactor(r), hand, 2e-3);
    const f = r.memberForces.find((m) => m.memberId === 1);
    controle("021: geen moment bij de scharnieren",
      [f.myStartKnm, f.myEndKnm, f.mzStartKnm, f.mzEndKnm].every((m) => Math.abs(m) < 1e-6), JSON.stringify(f));
    controle("021: één staaf, twee knopen, 21 punten per lijn (zoals zonder onderverdeling)",
      r.memberForces.length === 1 && r.displacements.length === 2 && r.diagrams.momentY[0].points.length === 21);
  }
  {
    // 045: de regel (staaf 3, HEA 160, 4 m) met scharnieren aan beide einden knikt zelf.
    const { verzoek, r } = await app("model-045-geschoord-frame.ifcfem");
    const d = doorsnede(verzoek, 3);
    const l = lengte(verzoek, verzoek.members.find((m) => m.id === 3));
    const hand = Math.PI ** 2 * E * Math.min(d.iyM4, d.izM4) / (l * l * Math.abs(nKnik(r, 3)));
    boven(`045 regel ${l} m: α_cr = π²EI_z/(L²N) ≈ 79,8 (één element gaf 17 924)`, knikfactor(r), hand, 2e-3);
  }
  for (const [bestand, staafId, wat] of [
    ["model-061-driepoot.ifcfem", 2, "061 driepoot, één staaf per poot (gaf 1928)"],
    ["model-062-driepoot-vier-delen.ifcfem", null, "062 driepoot, vier staven per poot"],
  ]) {
    const { verzoek, r } = await app(bestand);
    // De poot met de grootste druk; bij 062 bestaat een poot uit vier staven.
    const gedrukt = r.buckling.members.reduce((a, b) => (b.axialForceKn < a.axialForceKn ? b : a));
    const d = doorsnede(verzoek, staafId ?? gedrukt.memberId);
    const poot = Math.hypot(2, 1.1547, 3);
    const hand = Math.PI ** 2 * E * d.iyM4 / (poot * poot * Math.abs(gedrukt.axialForceKn));
    boven(`${wat}: α_cr = π²EI/(L²N) ≈ 4,014`, knikfactor(r), hand, 2e-3);
  }
  {
    // 038: staaf 1 (5 m) aan beide einden ingeklemd onder ΔT = +30 K. De tweede
    // orde werd geblokkeerd ("geen positieve fysieke knikfactor").
    const { verzoek, r } = await app("model-038-temperatuur.ifcfem");
    const d = doorsnede(verzoek, 1);
    const n = E * d.areaM2 * 12e-6 * 30;
    controle("038: N staaf 1 = E·A·α·ΔT", Math.abs(Math.abs(nKnik(r, 1)) / n - 1) < 1e-6, `${nKnik(r, 1)} tegen ${n.toFixed(2)}`);
    const hand = 4 * Math.PI ** 2 * E * Math.min(d.iyM4, d.izM4) / (5 ** 2 * n);
    boven("038: α_cr = 4π²EI_z/(L²N) ≈ 4,92 (was: geen uitkomst)", knikfactor(r), hand, 1e-2);
  }
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n[2] MCP: solve_open_fem_3d met de aanroepen van de controle");
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
    schrijf({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-knik-onderverdeling", version: "1" } } });
    aanroepen.forEach((a, n) => schrijf({ jsonrpc: "2.0", id: n + 2, method: "tools/call", params: { name: "solve_open_fem_3d", arguments: a.arguments } }));
  });
}
if (!existsSync(MCP_SERVER)) {
  controle("MCP-server gevonden — bouw hem met `cargo build --release -p openaec-mcp-server`", false, MCP_SERVER);
} else {
  const namen = ["021", "038", "045", "061", "062"];
  const aanroepen = namen.map((n) => JSON.parse(readFileSync(join(DATA, `invoer-${n}.json`), "utf8")));
  // 038 heeft een temperatuurverschil over de hoogte; sinds #221 vraagt de kern
  // de werkelijke profielhoogte (IPE300: 300 mm) in plaats van √(12I/A).
  aanroepen[namen.indexOf("038")].arguments.sections[0].heightM = 0.3;
  const antwoorden = await mcp(aanroepen);
  const uitkomst = Object.fromEntries(namen.map((n, i) => {
    const a = antwoorden[i];
    const tekst = a?.result?.content?.[0]?.text;
    return [n, a?.result?.structuredContent ?? (a?.result?.isError ? null : JSON.parse(tekst ?? "null"))];
  }));
  for (const n of namen) controle(`MCP ${n}: slaagt`, uitkomst[n] !== null, JSON.stringify(antwoorden[namen.indexOf(n)]?.result?.content ?? "").slice(0, 300));
  const pi2 = Math.PI ** 2;
  const poot = Math.hypot(2, 1.1547, 3);
  if (uitkomst["021"]) {
    boven("MCP 021: α_cr = 10,20 (was 12,41)", knikfactor(uitkomst["021"]), pi2 * E * 3.692e-5 / 25 / 300, 2e-3);
    const k = Math.sqrt(300 / (E * 3.692e-5));
    const veld = 2 / (k * k) * (1 / Math.cos(k * 2.5) - 1);
    const midden = Math.abs(uitkomst["021"].diagrams.momentY[0].points.find((p) => Math.abs(p.t - 0.5) < 1e-9).value);
    controle("MCP 021: veldmoment tweede orde = q/k²·(sec(kL/2) − 1) = 6,948 kNm (was 6,615)",
      Math.abs(midden / veld - 1) < 1e-3, `${midden.toFixed(4)} tegen ${veld.toFixed(4)}`);
    const f = uitkomst["021"].memberForces[0];
    controle("MCP 021: moment bij de scharnieren 0 (was 0,365 kNm)",
      Math.abs(f.myStartKnm) < 1e-6 && Math.abs(f.myEndKnm) < 1e-6, `${f.myStartKnm} / ${f.myEndKnm}`);
  }
  if (uitkomst["038"]) {
    const n = E * 0.005 * 12e-6 * 30;
    boven("MCP 038: α_cr = 5,30 (was: geen knikfactor)", knikfactor(uitkomst["038"]), 4 * pi2 * E * 6.04e-6 / 25 / n, 1e-2);
  }
  if (uitkomst["045"]) boven("MCP 045: α_cr = 129,5 (was 8400)", knikfactor(uitkomst["045"]), pi2 * E * 1e-5 / 16 / 10, 2e-3);
  for (const n of ["061", "062"]) {
    if (!uitkomst[n]) continue;
    const nPoot = Math.abs(uitkomst[n].memberForces.find((f) => f.memberId === 2).nStartKn);
    boven(`MCP ${n}: α_cr = 4,167 (061 was 1807)`, knikfactor(uitkomst[n]), pi2 * E * 1e-6 / (poot * poot) / nPoot, 2e-3);
  }
}

console.log(mislukt === 0 ? "\nknikanalyse met onderverdeling: geslaagd" : `\n${mislukt} controle(s) mislukt`);
if (mislukt > 0) process.exit(1);

// NAFEMS-benchmarks in 3D (issue #217): drie wegen naar de kern en de getoonde plaatwaarden.
//
// Bron en meetpunten: zie docs/verificatie/nafems/README.md en
// src-tauri/crates/open-fem-3d/tests/nafems.rs (NAFEMS TNSB Rev. 3, 1990).
//
// [1] Drie wegen (LE1, elliptisch membraan, net 24×12): het verzoek in
//     docs/verificatie/nafems/le1-membraan-24x12.request.json gaat door
//       a. de stdin/stdout-kern `open-fem-3d` (de browserroute /api/openFem3d/solve),
//       b. de MCP-server, tool `solve_open_fem_3d`,
//     en beide moeten σyy in D gelijk geven aan de waarde die de Rust-test via
//     `open_fem_3d::solve` (= het Tauri-commando) vastlegt (…verwacht.json), tot op 1e-9.
// [2] Getoonde waarden (LE6, scheve plaat): dezelfde benchmark als appmodel (plaat met vier
//     hoekknopen en het midden E als knoop, randopleggingen u_z, S235, druk 0,7 kN/m²) langs de
//     weg van de app: parseOpenFem3DModel → meshOpenFem3DPlates → buildOpenFem3DSolveRequest →
//     kern. Daarna dezelfde functies die tekenvlak, legenda en eigenschappenpaneel gebruiken
//     (openFem3dPlateResults, openFem3dPlateOverlay): knoopwaarden, legendabereik, extremen,
//     opmaak, contourkleur en vervormde ligging van E moeten de kernuitvoer zijn.
//     De app toont geen hoofdspanning; σ1 aan de onderzijde wordt hier uit de getoonde
//     momenten berekend (σ = 6m/t², positief moment = trek onder) en naast de NAFEMS-waarde
//     0,802 MPa gelegd (tolerantie 5 %, dezelfde als de Rust-test).
//
// Niet zonder Chromium te testen en hier dus NIET gedekt: het getekende beeld (WebGL), labels en
// tooltips in de DOM, de rapporttabel in OpenFem3DReport.tsx.
//
// Vereist: cargo build --release -p open-fem-3d -p openaec-mcp-server (src-tauri/target/release).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOpenFem3DModel } from "./src/components/openFem3d/openFem3dModel.ts";
import { meshOpenFem3DPlates } from "./src/components/openFem3d/openFem3dPlateMesh.ts";
import { buildOpenFem3DSolveRequest, openFem3DGlobalForceBalance } from "./src/components/openFem3d/openFem3dSolver.ts";
import {
  formatOpenFem3DPlateValue, openFem3DContourColor, openFem3DPlateExtremes, openFem3DPlateQuantityRange,
  openFem3DPlateQuantityValues,
} from "./src/components/openFem3d/openFem3dPlateResults.ts";
import { buildOpenFem3DPlateOverlay } from "./src/components/openFem3d/openFem3dPlateOverlay.ts";

const stil = console.log;
console.log = (...args) => { if (!String(args[0] ?? "").startsWith("[TriangleService]")) stil(...args); };

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HIER, "..");
const win = process.platform === "win32";
const RELEASE = join(REPO, "src-tauri", "target", "release");
const KERN = process.env.OPEN_FEM_3D_SOLVER_PATH ?? join(RELEASE, win ? "open-fem-3d.exe" : "open-fem-3d");
const MCP_SERVER = join(RELEASE, win ? "openaec-mcp-server.exe" : "openaec-mcp-server");
const NAFEMS = join(REPO, "docs", "verificatie", "nafems");

let passed = 0, failed = 0;
async function check(naam, fn) {
  try { await fn(); passed++; stil(`  ✓ ${naam}`); }
  catch (e) { failed++; stil(`  ✗ ${naam}\n      ${String(e?.message ?? e).split("\n").join("\n      ")}`); }
}

function reken(request) {
  return new Promise((resolveP, reject) => {
    const child = spawn(KERN, [], { stdio: ["pipe", "pipe", "pipe"] });
    const uit = [], fout = [];
    child.stdout.on("data", (d) => uit.push(d));
    child.stderr.on("data", (d) => fout.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      const tekst = Buffer.concat(uit).toString();
      if (code !== 0) return reject(new Error(`3D-kern: exit ${code}; ${tekst.slice(0, 400)} ${Buffer.concat(fout).toString().slice(0, 200)}`));
      try { resolveP(JSON.parse(tekst)); } catch (e) { reject(e); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

function mcp(aanroepen) {
  return new Promise((resolveP, reject) => {
    const k = spawn(MCP_SERVER, [], { stdio: ["pipe", "pipe", "pipe"] });
    const antwoorden = new Map();
    let buffer = "";
    const klok = setTimeout(() => { k.kill(); reject(new Error("MCP-server: geen antwoord binnen 120 s")); }, 120_000);
    k.on("error", reject);
    k.stdout.on("data", (d) => {
      buffer += d.toString();
      let n;
      while ((n = buffer.indexOf("\n")) >= 0) {
        const regel = buffer.slice(0, n).trim();
        buffer = buffer.slice(n + 1);
        if (!regel) continue;
        const bericht = JSON.parse(regel);
        antwoorden.set(bericht.id, bericht);
        if (antwoorden.size === aanroepen.length + 1) {
          clearTimeout(klok);
          k.stdin.end();
          resolveP(aanroepen.map((_, i) => antwoorden.get(i + 2)));
        }
      }
    });
    const schrijf = (o) => k.stdin.write(JSON.stringify(o) + "\n");
    schrijf({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-nafems-3d", version: "1" } } });
    aanroepen.forEach((a, i) => schrijf({ jsonrpc: "2.0", id: i + 2, method: "tools/call", params: { name: a.name, arguments: a.arguments } }));
  });
}

const sigmaYyD = (resultaat) => {
  const d = resultaat.shellNodes.find((n) => n.nodeId === 1 && n.plateId === 1);
  return d.nyyKnPerM / 0.1 / 1000;
};

/* ── [1] Drie wegen (LE1) ─────────────────────────────────────────────── */
stil("[1] NAFEMS LE1 langs drie wegen naar de 3D-kern");
const verzoek = JSON.parse(readFileSync(join(NAFEMS, "le1-membraan-24x12.request.json"), "utf8"));
const verwacht = JSON.parse(readFileSync(join(NAFEMS, "le1-membraan-24x12.verwacht.json"), "utf8"));
const gelijk = (a, b) => Math.abs(a - b) <= 1e-9 * Math.abs(b);

await check("kernbinary en MCP-server gebouwd (cargo build --release -p open-fem-3d -p openaec-mcp-server)", () => {
  assert.ok(existsSync(KERN), KERN);
  assert.ok(existsSync(MCP_SERVER), MCP_SERVER);
});
let viaKern = null;
await check("stdin/stdout-kern (browserroute): σyy D = vastgelegde waarde van open_fem_3d::solve (Tauri-weg)", async () => {
  viaKern = await reken(verzoek);
  const s = sigmaYyD(viaKern);
  assert.ok(gelijk(s, verwacht.sigmaYyDMpa), `${s} tegen ${verwacht.sigmaYyDMpa}`);
  stil(`      σyy D = ${s.toFixed(4)} MPa; NAFEMS ${verwacht.doelMpa} MPa (${((s / verwacht.doelMpa - 1) * 100).toFixed(2)} % op dit net)`);
});
await check("MCP-tool solve_open_fem_3d: zelfde σyy D en zelfde knoopwaarden als de kernbinary", async () => {
  const [antwoord] = await mcp([{ name: "solve_open_fem_3d", arguments: verzoek }]);
  assert.equal(antwoord?.result?.isError, false, JSON.stringify(antwoord).slice(0, 400));
  const uit = antwoord.result.structuredContent ?? JSON.parse(antwoord.result.content[0].text);
  const s = sigmaYyD(uit);
  assert.ok(gelijk(s, verwacht.sigmaYyDMpa), `${s} tegen ${verwacht.sigmaYyDMpa}`);
  assert.ok(viaKern, "kernresultaat ontbreekt");
  assert.equal(uit.shellNodes.length, viaKern.shellNodes.length);
  for (const [k, n] of uit.shellNodes.entries()) {
    const m = viaKern.shellNodes[k];
    assert.equal(n.nodeId, m.nodeId);
    for (const veld of ["nxxKnPerM", "nyyKnPerM", "nxyKnPerM"]) {
      assert.ok(Math.abs(n[veld] - m[veld]) <= 1e-9 * Math.max(1, Math.abs(m[veld])), `knoop ${n.nodeId} ${veld}`);
    }
  }
});

/* ── [2] Getoonde plaatwaarden (LE6 als appmodel) ─────────────────────── */
stil("\n[2] NAFEMS LE6 via de app-route en de weergavefuncties");
const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
const E = { x: 0.5 + c / 2, y: s / 2 };
const T = 0.01;
const model = parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 1, y: 0, z: 0 }, { id: 3, x: 1 + c, y: s, z: 0 },
    { id: 4, x: c, y: s, z: 0 }, { id: 5, x: E.x, y: E.y, z: 0 },
  ],
  beams: [],
  plates: [{
    id: 1, nodeIds: [1, 2, 3, 4], thicknessM: T, material: "S235", meshSizeM: 1 / 32,
    // Alle randen u_z = 0, rotaties vrij ("zacht" vrij opgelegd, zoals NAFEMS LE6).
    edgeSupports: [0, 1, 2, 3].map((edge) => ({ edge, ux: false, uy: false, uz: true, rx: false, ry: false, rz: false })),
  }],
  // u_x = u_y = 0 in A, u_y = 0 in B (starre lichaamsbeweging in het vlak).
  supports: [
    { nodeId: 1, ux: true, uy: true, uz: false, rx: false, ry: false, rz: false },
    { nodeId: 2, ux: false, uy: true, uz: false, rx: false, ry: false, rz: false },
  ],
  surfaceLoads: [{ id: 1, plateId: 1, caseId: 1, qx: 0, qy: 0, qz: -0.7 }],
});
const mesh = await meshOpenFem3DPlates(model);
const request = { ...buildOpenFem3DSolveRequest(model, "linear", 1, mesh), bucklingModes: 0 };
const r = await reken(request);
const resultaat = { ...r, plateMesh: mesh };
const knoopE = r.shellNodes.find((n) => n.nodeId === 5 && n.plateId === 1);

await check(`appnet: ${mesh.elements.length} elementen (${mesh.plates[0].method}), E is een rekenknoop, materiaal E = 210 GPa / ν = 0,3`, () => {
  assert.ok(knoopE, "knoop E heeft een plaatresultaat");
  assert.equal(request.materials[0].eMpa, 210_000);
  assert.equal(request.materials[0].nu, 0.3);
  assert.equal(request.plates[0].thicknessM, T);
  assert.ok(openFem3DGlobalForceBalance(request, r).ok, "krachten- en momentenbalans");
  const somR = r.reactions.reduce((a, x) => a + x.fz, 0);
  assert.ok(Math.abs(somR - 0.7 * s) < 1e-9, `Σ Rz = ${somR} kN (q·A = ${0.7 * s})`);
});
await check("getoonde knoopwaarden (contour, eigenschappenpaneel) = kernuitvoer in E", () => {
  for (const [key, veld, factor] of [
    ["mxx", "mxxKnmPerM", 1], ["myy", "myyKnmPerM", 1], ["mxy", "mxyKnmPerM", 1],
    ["w", "wM", 1000], ["vonMisesBottom", "vonMisesBottomMpa", 1],
  ]) {
    const getoond = openFem3DPlateQuantityValues(resultaat, key, 1).get(5);
    assert.equal(getoond, knoopE[veld] * factor, key);
  }
});
let sigma1 = NaN;
await check("σ1 onderzijde in E uit de getoonde momenten binnen 5 % van NAFEMS LE6 (0,802 MPa)", () => {
  const sigma = (m) => 6 * m / (T * T) / 1000; // MPa, positief moment = trek onder
  const [sx, sy, txy] = ["mxx", "myy", "mxy"].map((k) => sigma(openFem3DPlateQuantityValues(resultaat, k, 1).get(5)));
  sigma1 = (sx + sy) / 2 + Math.hypot((sx - sy) / 2, txy);
  // Consistentie: de getoonde Von Mises-onderzijde volgt uit dezelfde componenten (membraan ≈ 0).
  const vm = Math.sqrt(sx * sx - sx * sy + sy * sy + 3 * txy * txy);
  assert.ok(Math.abs(vm - knoopE.vonMisesBottomMpa) < 1e-3 * vm, `σvm ${vm} tegen ${knoopE.vonMisesBottomMpa}`);
  stil(`      σ1 = ${sigma1.toFixed(4)} MPa (${((sigma1 / 0.802 - 1) * 100).toFixed(2)} %), getoond als mxx = ${formatOpenFem3DPlateValue(knoopE.mxxKnmPerM)} kNm/m`);
  assert.ok(Math.abs(sigma1 / 0.802 - 1) < 0.05, `σ1 = ${sigma1}`);
});
await check("legenda: bereik = min/max van de kernknopen; extremen in het paneel = PlateSummary3D van de kern", () => {
  for (const [key, veld, factor] of [["mxx", "mxxKnmPerM", 1], ["w", "wM", 1000], ["vonMisesBottom", "vonMisesBottomMpa", 1]]) {
    const waarden = r.shellNodes.filter((n) => n.plateId === 1).map((n) => n[veld] * factor);
    const bereik = openFem3DPlateQuantityRange(resultaat, key);
    assert.equal(bereik.min, Math.min(...waarden), `${key} min`);
    assert.equal(bereik.max, Math.max(...waarden), `${key} max`);
    const extreem = openFem3DPlateExtremes(resultaat, 1).find((x) => x.definition.key === key);
    assert.ok(Math.abs(extreem.min - bereik.min) <= 1e-12 * Math.max(1, Math.abs(bereik.min)), `${key}: paneel-min ${extreem.min} tegen ${bereik.min}`);
    assert.ok(Math.abs(extreem.max - bereik.max) <= 1e-12 * Math.max(1, Math.abs(bereik.max)), `${key}: paneel-max ${extreem.max} tegen ${bereik.max}`);
  }
});
await check("opmaak: NL-notatie, minstens drie significante cijfers (B3 opgelost)", () => {
  assert.equal(formatOpenFem3DPlateValue(0.8021), "0,802");
  assert.equal(formatOpenFem3DPlateValue(92.7), "92,70");
  assert.equal(formatOpenFem3DPlateValue(-108), "-108,0");
  assert.equal(formatOpenFem3DPlateValue(0), "0,000");
  // Bevinding B3 (#217, docs/verificatie/nafems): onder 1 rondde de opmaak af op vaste
  // decimalen, zodat het veldmoment in E van LE6 als "0,008" verscheen (één significant
  // cijfer). Nu drie significante cijfers: de kernwaarde mxx_E zelf, en de waarden uit de
  // bevinding (myy = 0,01314 en mxy = −0,00142 kNm/m).
  const verwacht = knoopE.mxxKnmPerM.toLocaleString("nl-NL", { maximumSignificantDigits: 3, minimumSignificantDigits: 3 });
  assert.equal(formatOpenFem3DPlateValue(knoopE.mxxKnmPerM), verwacht);
  assert.match(verwacht, /^0,00\d{3}$/, `mxx_E = ${knoopE.mxxKnmPerM}: drie significante cijfers na 0,00`);
  assert.equal(formatOpenFem3DPlateValue(0.00822), "0,00822");
  assert.equal(formatOpenFem3DPlateValue(0.01314), "0,0131");
  assert.equal(formatOpenFem3DPlateValue(-0.00142), "-0,00142");
  assert.equal(formatOpenFem3DPlateValue(3e-17), "0,0000000000");
});
await check("contour en vervormde vorm: kleur en ligging van E in de tekenlaag volgen uit de kernwaarden", () => {
  const schaal = 200;
  const overlay = buildOpenFem3DPlateOverlay({
    model, mesh, result: resultaat, quantity: "mxx", showMesh: false, showPlates: true,
    deformation: true, deformationScale: schaal,
  });
  assert.equal(overlay.contourShown, true);
  const vlak = overlay.group.children.find((child) => child.userData.openFem3dPlateContour === 1);
  const pos = vlak.geometry.getAttribute("position"), kleur = vlak.geometry.getAttribute("color");
  const u = r.displacements.find((d) => d.nodeId === 5);
  const doel = [E.x + schaal * u.ux, E.y + schaal * u.uy, schaal * u.uz];
  let gevonden = -1;
  for (let i = 0; i < pos.count; i += 1) {
    if (Math.hypot(pos.getX(i) - doel[0], pos.getY(i) - doel[1], pos.getZ(i) - doel[2]) < 1e-5) { gevonden = i; break; }
  }
  assert.ok(gevonden >= 0, `E niet gevonden op de vervormde plaats ${doel}`);
  const bereik = openFem3DPlateQuantityRange(resultaat, "mxx");
  const verwachteKleur = openFem3DContourColor((knoopE.mxxKnmPerM - bereik.min) / (bereik.max - bereik.min));
  for (let k = 0; k < 3; k += 1) {
    assert.ok(Math.abs(kleur.getComponent(gevonden, k) - verwachteKleur[k]) < 1e-6, `kleurkanaal ${k}`);
  }
});

stil(`\n${failed === 0 ? "GESLAAGD" : "GEFAALD"}: ${passed} geslaagd, ${failed} gefaald.`);
process.exit(failed === 0 ? 0 : 1);

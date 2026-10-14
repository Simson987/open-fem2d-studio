// Staalhal 60 × 30 m als 3D-raamwerk: een groot, herhaalbaar voorbeeldmodel
// voor de GUI én een evenwichts- en doorbuigingsproef met de 3D-kern.
//
// 11 spanten h.o.h. 6 m, goothoogte 8 m, zadeldak met nok op 9,5 m.
// Kolommen HEA 450 (ingeklemd, 90° gedraaid: lijf in het spantvlak),
// spantbenen IPE 600, gordingen IPE 160 en randliggers HEA 160 (scharnierend
// tussen de spanten), dak- en wandverbanden CHS 88,9×4 in beide kopvakken.
//
// Het model komt uit de generator van de wizard "Stalen hal"
// (src/components/openFem3d/wizards/staalhal.ts) met zijn STANDAARDPARAMETERS.
// Het projectbestand is gemaakt door de handgeschreven opbouw die hier eerder
// stond; dat het met de generator gelijk blijft, is de proef dat de generator
// het voorbeeldmodel knoop voor knoop reproduceert.
//
// Schrijf het projectbestand opnieuw met: node test-open-fem3d-staalhal.mjs --write-fixture
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildOpenFem3DSolveRequest, openFem3DGlobalForceBalance } from "./src/components/openFem3d/openFem3dSolver.ts";
import { openFem3DMaximumDisplacementM } from "./src/components/openFem3d/openFem3dDisplacement.ts";
import { withOpenFem3DSelfWeight } from "./src/components/openFem3d/openFem3dModel.ts";
import { maakStaalhal, requireStaalhalWindRoute, staalhalProject, STAALHAL_STANDAARD } from "./src/components/openFem3d/wizards/staalhal.ts";
import { DEFAULT_UITGANGSPUNTEN } from "./src/lib/projectBasisDefaults.ts";
import { resolveSection } from "./src/lib/sectionResolver.ts";
import { deserializeProject, serializeProject } from "./src/io/projectFile.ts";

const HAL = { breedte: 30, goothoogte: 8 };
const hal = maakStaalhal({});
const GEVALLEN = hal.loadCases.filter((c) => !c.eigenGewicht);
const EIGEN_GEWICHT = hal.loadCases.find((c) => c.eigenGewicht);
// De standaardparameters zijn precies het voorbeeldmodel.
assert.equal(STAALHAL_STANDAARD.lengteMm, 60000);
assert.equal(STAALHAL_STANDAARD.breedteMm, 30000);
assert.deepEqual(hal.loadCases, [
  { id: 5, name: "Eigen gewicht", type: "dead", eigenGewicht: true },
  { id: 1, name: "Permanent (G)", type: "dead" },
  { id: 2, name: "Sneeuw (S)", type: "snow" },
  { id: 3, name: "Wind dwars (W)", type: "wind" },
  { id: 4, name: "Wind langs (W)", type: "wind" },
], "belastinggevallen");

const model = hal.model;
assert.deepEqual(
  [model.nodes.length, model.beams.length, model.supports.length, model.loads.length, model.memberLoads.length],
  [165, 340, 22, 13, 412], "aantallen");
for (const profiel of new Set(model.beams.map((b) => b.profileName))) {
  assert.equal(resolveSection("S235", profiel).reden, undefined, `${profiel} staat in de catalogus`);
}

const fixturePath = fileURLToPath(new URL("../docs/verificatie/3d-raamwerk/staalhal-60x30.ifcfem", import.meta.url));
// Het projectnummer is dat van het voorbeeld; de generator zelf laat het leeg.
const project = staalhalProject(hal, { projectNumber: "VB-3D-HAL-01" });
assert.deepEqual(project.projectInfo, { name: "Staalhal 60 × 30 m", projectNumber: "VB-3D-HAL-01",
  uitgangspunten: DEFAULT_UITGANGSPUNTEN });
assert.deepEqual(staalhalProject(hal, { uitgangspunten: { gevolgklasse: "CC3" } }).projectInfo.uitgangspunten,
  { ...DEFAULT_UITGANGSPUNTEN, gevolgklasse: "CC3" }, "gedeeltelijke projectbasis behoudt volledige defaults");
assert.doesNotThrow(() => requireStaalhalWindRoute({}));
assert.throws(() => requireStaalhalWindRoute({ uitgangspunten: { windCodeId: "asce-7-22" } }), /niet beschikbaar/);
assert.throws(() => staalhalProject(hal, { uitgangspunten: { windCodeId: "asce-7-22" } }), /niet beschikbaar/);
assert.throws(() => staalhalProject(hal, { uitgangspunten: null }), /object/);
if (process.argv.includes("--write-fixture")) writeFileSync(fixturePath, serializeProject(project));
assert.ok(existsSync(fixturePath), "projectbestand staalhal ontbreekt (schrijf het met --write-fixture)");
const geladen = deserializeProject(readFileSync(fixturePath, "utf8"));
assert.deepEqual(geladen.model3d, model, "het projectbestand is gelijk aan het model uit deze test");
assert.deepEqual(geladen.projectInfo.uitgangspunten, DEFAULT_UITGANGSPUNTEN,
  "het projectbestand bewaart de complete uitgangspunten met windroute");
assert.equal(geladen.modelDimension, "3d");
console.log("  ✓ model: 165 knopen, 340 staven, 22 inklemmingen; projectbestand gelijk");

const solverBinary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${solverBinary}`, import.meta.url));
assert.ok(existsSync(solverPath), "Bouw eerst de Rust-rekenkern.");
const reken = (request) => new Promise((resolve, reject) => {
  const child = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  const uit = [], fout = [];
  child.stdout.on("data", (d) => uit.push(d));
  child.stderr.on("data", (d) => fout.push(d));
  child.on("error", reject);
  child.on("close", (code) => {
    if (code !== 0) return reject(new Error(`3D-kern: exit ${code}; ${Buffer.concat(fout).toString().slice(0, 400)}`));
    try { resolve(JSON.parse(Buffer.concat(uit).toString())); } catch (e) { reject(e); }
  });
  child.stdin.end(JSON.stringify(request));
});
const som = (r, k) => r.reactions.reduce((t, x) => t + x[k], 0);
const dichtbij = (a, b, label) => assert.ok(Math.abs(a - b) <= 1e-3, `${label}: verwacht ${b}, berekend ${a}`);
const goot = new Set(model.nodes.filter((n) => Math.abs(n.z - HAL.goothoogte) < 1e-9).map((n) => n.id));

// Reacties uit ΣF = 0 met de handgetallen (projectie: 60 × 30 = 1800 m²):
//   G  0,30 · 1800 = 540 kN         S  0,56 · 1800 = 1008 kN
//   W dwars: kolommen (0,64 + 0,40) · 8 · (9 · 6 + 2 · 3) = 499,2 kN in +Y, dak 0,48 · 1800 = 864 kN omhoog
//   W langs: 0,64 · 30 · 8,75 / 2 = 84 kN in +X
const verwacht = {
  1: { fx: 0, fy: 0, fz: 540 },
  2: { fx: 0, fy: 0, fz: 1008 },
  3: { fx: 0, fy: -499.2, fz: -864 },
  4: { fx: -84, fy: 0, fz: 0 },
};
const grenzen = { doorbuiging: HAL.breedte / 250, zijverplaatsing: HAL.goothoogte / 150 };
for (const geval of GEVALLEN) {
  const request = { ...buildOpenFem3DSolveRequest(model, "linear", geval.id), bucklingModes: 0 };
  const r = await reken(request);
  assert.equal(r.equilibrium?.equilibriumOk, true, `${geval.name}: kerncontrole evenwicht`);
  assert.equal(openFem3DGlobalForceBalance(request, r).ok, true, `${geval.name}: onafhankelijke balans`);
  for (const [as, waarde] of Object.entries(verwacht[geval.id])) dichtbij(som(r, as), waarde, `${geval.name}: ΣR ${as}`);
  const umax = openFem3DMaximumDisplacementM(model, r);
  const zij = Math.max(...r.displacements.filter((d) => goot.has(d.nodeId)).map((d) => Math.hypot(d.ux, d.uy)));
  assert.ok(umax < grenzen.doorbuiging, `${geval.name}: u_max ${(umax * 1000).toFixed(1)} mm ≥ L/250`);
  assert.ok(zij < grenzen.zijverplaatsing, `${geval.name}: zijverplaatsing ${(zij * 1000).toFixed(1)} mm ≥ h/150`);
  console.log(`  ✓ ${geval.name}: reacties volgens de hand, evenwicht; u_max ${(umax * 1000).toFixed(1)} mm (< L/250), goot ${(zij * 1000).toFixed(1)} mm (< h/150)`);
}
// Eigen gewicht: ΣR_z = Σ ρ · A · g · L over alle staven, met ρ = 7850 kg/m³,
// g = 9,81 m/s² en de bruto doorsnede uit de catalogus.
{
  const lengte = (b) => {
    const a = model.nodes.find((n) => n.id === b.startNodeId), e = model.nodes.find((n) => n.id === b.endNodeId);
    return Math.hypot(e.x - a.x, e.y - a.y, e.z - a.z);
  };
  const gewicht = model.beams.reduce((t, b) => {
    const d = resolveSection("S235", b.profileName);
    return t + 7850 * (d.aBruto ?? d.A) * 1e-6 * 9.81 / 1000 * lengte(b);
  }, 0);
  const request = { ...buildOpenFem3DSolveRequest(withOpenFem3DSelfWeight(model, EIGEN_GEWICHT.id), "linear", EIGEN_GEWICHT.id), bucklingModes: 0 };
  const r = await reken(request);
  assert.equal(r.equilibrium?.equilibriumOk, true, "eigen gewicht: kerncontrole evenwicht");
  assert.equal(openFem3DGlobalForceBalance(request, r).ok, true, "eigen gewicht: onafhankelijke balans");
  dichtbij(som(r, "fz"), gewicht, "eigen gewicht: ΣR fz");
  dichtbij(som(r, "fx"), 0, "eigen gewicht: ΣR fx");
  dichtbij(som(r, "fy"), 0, "eigen gewicht: ΣR fy");
  const umax = openFem3DMaximumDisplacementM(model, r);
  assert.ok(umax < grenzen.doorbuiging, `eigen gewicht: u_max ${(umax * 1000).toFixed(1)} mm ≥ L/250`);
  console.log(`  ✓ Eigen gewicht: ΣR_z = ${gewicht.toFixed(1)} kN (ρ · A · g · L); u_max ${(umax * 1000).toFixed(1)} mm`);
}
console.log("staalhal: geslaagd");

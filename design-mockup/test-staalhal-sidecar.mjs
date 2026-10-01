// De sidecarbewerkingen achter de MCP-tool `open_fem_3d_staalhal_maken`:
// `staalhal_maken` (de generator van de wizard, plus de rekenverzoeken voor de
// 3D-kern) en `staalhal_uitwerken` (controles en EN 1993-toetsinvoer uit de
// resultaten). Tussen de twee rekent hier — net als in de MCP-server — de
// vastgezette 3D-kern elk verzoek.
//
// Draait tegen de BRON én tegen de BUNDEL (npm run test:bundel): de MCP-server
// voert de bundel uit, dus hoort juist daar bewezen te worden dat de hal
// dezelfde is als in de app en dat de keten sluit.
//
// Verwachte reacties: de handgetallen van de staalhal (test-open-fem3d-staalhal):
//   G 0,30 · 60 · 30 = 540 kN;  S 0,56 · 1800 = 1008 kN;
//   W dwars (0,64 + 0,40) · 8 · 60 = 499,2 kN in +Y, dak 0,48 · 1800 = 864 kN omhoog;
//   W langs 0,64 · 30 · 8,75 / 2 = 84 kN in +X.
// Rekenkern: OPEN_FEM_3D_SOLVER_PATH, anders src-tauri/target/debug/open-fem-3d(.exe).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { verwerkVerzoek, maakStaalhal, defaultCombinations } from "./src/mcp/kernel-exports.ts";

let geslaagd = 0;
const ok = (label) => { geslaagd += 1; console.log(`  ✓ ${label}`); };
let volgnummer = 0;
const vraag = (op, payload) => verwerkVerzoek({ v: 1, id: ++volgnummer, op, payload });
const dichtbij = (a, b, label, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${label}: verwacht ${b}, berekend ${a}`);

// ── Protocol ─────────────────────────────────────────────────────────────────
{
  const h = vraag("handshake", {});
  assert.ok(h.ok && h.result.ops.includes("staalhal_maken") && h.result.ops.includes("staalhal_uitwerken"));
  ok("handshake meldt staalhal_maken en staalhal_uitwerken");
}

// ── staalhal_maken ───────────────────────────────────────────────────────────
{
  const a = vraag("staalhal_maken", {});
  assert.equal(a.ok, true, JSON.stringify(a.error));
  const r = a.result;
  assert.deepEqual(r.project.model3d, maakStaalhal({}).model, "dezelfde hal als de generator van de app");
  assert.equal(r.project.modelDimension, "3d");
  assert.equal(r.project.structuralGrid.xAxes.length, 11, "stramien gaat mee in het projectbestand");
  assert.deepEqual([r.samenvatting.aantallen.knopen, r.samenvatting.aantallen.staven], [165, 340]);
  assert.equal(r.rekenverzoeken, undefined, "zonder `reken` geen rekenverzoeken");
  const zonder = vraag("staalhal_maken", { stramien: false });
  assert.equal(zonder.result.project.structuralGrid, undefined);
  ok("staalhal_maken zonder parameters: de voorbeeldhal, projectbestand met stramien");
}
{
  const fout = vraag("staalhal_maken", { hal: { profielen: { kolom: { profile: "HEA 400" } } } });
  assert.equal(fout.ok, false);
  assert.equal(fout.error.code, "INVOER_ONGELDIG");
  assert.deepEqual(fout.error.detail.problemen.map((p) => [p.code, p.veld]), [["onbekendVeld", "profielen.kolom.profile"]]);
  const vreemd = vraag("staalhal_maken", { hall: {} });
  assert.equal(vreemd.ok, false);
  assert.equal(vreemd.error.detail.problemen[0].veld, "hall");
  const analyse = vraag("staalhal_maken", { reken: { analyse: "tweede orde" } });
  assert.equal(analyse.ok, false);
  assert.equal(analyse.error.detail.problemen[0].veld, "reken.analyse");
  ok("onbekende velden in hal, payload en reken geweigerd als INVOER_ONGELDIG, met code en veld per probleem");
}

// ── De keten: verzoeken → 3D-kern → uitwerken ────────────────────────────────
const solverBinary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${solverBinary}`, import.meta.url));
assert.ok(existsSync(solverPath), "Bouw eerst de Rust-rekenkern (of zet OPEN_FEM_3D_SOLVER_PATH).");
const reken = (request) => new Promise((resolve, reject) => {
  const child = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  const uit = [];
  child.stdout.on("data", (d) => uit.push(d));
  child.on("error", reject);
  child.on("close", (code) => code !== 0
    ? reject(new Error(`3D-kern: exit ${code}; ${Buffer.concat(uit).toString().slice(0, 400)}`))
    : resolve(JSON.parse(Buffer.concat(uit).toString())));
  child.stdin.end(JSON.stringify(request));
});

{
  const hal = { fundering: { type: "balkrooster" } };
  const a = vraag("staalhal_maken", { hal, reken: {} });
  assert.equal(a.ok, true, JSON.stringify(a.error));
  const { rekenverzoeken, combinaties, reken: instellingen } = a.result;
  assert.deepEqual(instellingen, { analyse: "linear", gevolgklasse: "CC2" });
  const gevallen = rekenverzoeken.filter((v) => v.soort === "geval");
  assert.deepEqual(gevallen.map((v) => v.id), [5, 1, 2, 3, 4], "elk belast geval, in de volgorde van de gevallen");
  // De standaardcombinaties van deze vijf gevallen, zonder combinaties zonder belast geval.
  const verwacht = defaultCombinations(maakStaalhal(hal).loadCases);
  assert.deepEqual(combinaties.map((c) => c.id), verwacht.map((c) => c.id));
  assert.equal(rekenverzoeken.length, 5 + verwacht.length);
  assert.equal(new Set(rekenverzoeken.map((v) => v.sleutel)).size, rekenverzoeken.length, "unieke sleutels");
  assert.ok(rekenverzoeken.every((v) => v.verzoek.analysis === "linear" && v.verzoek.bucklingModes === 0));

  const resultaten = {};
  for (const v of rekenverzoeken) resultaten[v.sleutel] = await reken(v.verzoek);
  const u = vraag("staalhal_uitwerken", { hal, reken: {}, resultaten });
  assert.equal(u.ok, true, JSON.stringify(u.error));
  const perGeval = Object.fromEntries(u.result.gevallen.map((g) => [g.id, g]));
  const hand = { 1: [0, 0, 540], 2: [0, 0, 1008], 3: [0, -499.2, -864], 4: [-84, 0, 0] };
  for (const [id, [fx, fy, fz]] of Object.entries(hand)) {
    const g = perGeval[id];
    dichtbij(g.reactiesomKn.fx, fx, `${g.naam} ΣRx`);
    dichtbij(g.reactiesomKn.fy, fy, `${g.naam} ΣRy`);
    dichtbij(g.reactiesomKn.fz, fz, `${g.naam} ΣRz`);
    dichtbij(g.paalreacties.somFzKn, fz, `${g.naam} Σ paalreacties`);
    assert.equal(g.paalreacties.aantal, 66);
  }
  for (const g of [...u.result.gevallen, ...u.result.combinaties]) {
    assert.equal(g.evenwicht.kern, true, `${g.naam}: evenwicht volgens de kern`);
    assert.equal(g.evenwicht.onafhankelijk, true, `${g.naam}: onafhankelijke krachtensom`);
    dichtbij(g.belastingsomKn.fz, -g.reactiesomKn.fz, `${g.naam}: Σ last = −Σ reactie`);
  }
  // Eigen gewicht: staal + beton, beide als Σ ρ·A·g·L (zie de generatortest).
  dichtbij(perGeval[5].reactiesomKn.fz, 809.947 + 5.886 * (2 * 60 + 11 * 30 + 22 * 0.8), "eigen gewicht", 1e-2);
  // Toetsinvoer voor elke stalen staaf; beton (balken en poeren) met reden overgeslagen.
  assert.equal(u.result.toetsinvoer.length, 340);
  assert.equal(u.result.nietGetoetst.length, 75 + 22);
  assert.ok(u.result.toetsinvoer.every((t) => t.forces_envelope.length > 0 && t.steel_grade === "S235"));
  assert.deepEqual(u.result.grenzen, { doorbuigingMm: 120, zijverplaatsingMm: 8000 / 150 });
  ok(`keten op het balkrooster: ${rekenverzoeken.length} verzoeken, ΣR en Σ paalreacties = hand, evenwicht overal, 340 toetsinvoeren`);

  // Een resultaat dat ontbreekt of bij een andere hal hoort, wordt geweigerd.
  const zonder = { ...resultaten };
  delete zonder["geval:1"];
  const mis = vraag("staalhal_uitwerken", { hal, reken: {}, resultaten: zonder });
  assert.equal(mis.ok, false);
  assert.equal(mis.error.detail.problemen[0].veld, "resultaten.geval:1");
  const ander = vraag("staalhal_uitwerken", { hal: {}, reken: {}, resultaten });
  assert.equal(ander.ok, false, "resultaten van het rooster passen niet bij de hal zonder rooster");
  ok("uitwerken weigert een ontbrekend resultaat en resultaten van een andere hal");
}

console.log(`${geslaagd} geslaagd, 0 gefaald`);

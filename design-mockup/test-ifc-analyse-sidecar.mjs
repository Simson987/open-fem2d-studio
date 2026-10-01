// De sidecarbewerkingen achter de MCP-tool `open_fem_3d_ifc_importeren`:
// `ifc_importeren` (de import van de app, plus de rekenverzoeken voor de
// 3D-kern) en `ifc_uitwerken` (reactiesommen, evenwicht en EN 1993-
// toetsinvoer uit de resultaten). Tussen de twee rekent hier — net als in de
// MCP-server — de vastgezette 3D-kern elk verzoek.
//
// Draait tegen de BRON én tegen de BUNDEL (npm run test:bundel): de MCP-server
// voert de bundel uit, dus hoort juist daar bewezen te worden dat de import
// dezelfde is als in de app en dat de keten sluit.
//
// Verwachte reacties van de luifel (zie test-ifc-analyse-import.mjs):
//   G 2,0 kN/m per geprojecteerde lengte over 3 m = 6 kN; S 0,8 · √9,25 kN;
//   Q 5 + 3 = 8 kN; W 0,5 · 3 = 1,5 kN in +X.
// Rekenkern: OPEN_FEM_3D_SOLVER_PATH, anders src-tauri/target/debug/open-fem-3d(.exe).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  verwerkVerzoek, importeerIfcAnalyseModel, buildOpenFem3DSolveRequest, withOpenFem3DSelfWeight,
} from "./src/mcp/kernel-exports.ts";

let geslaagd = 0;
const ok = (label) => { geslaagd += 1; console.log(`  ✓ ${label}`); };
let volgnummer = 0;
const vraag = (op, payload) => verwerkVerzoek({ v: 1, id: ++volgnummer, op, payload });
const dichtbij = (a, b, label, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${label}: verwacht ${b}, berekend ${a}`);
const inhoud = readFileSync(fileURLToPath(new URL("../docs/verificatie/ifc-analyse/ifc-analyse-m-n.ifc", import.meta.url)), "utf8");

// ── Protocol en foutpaden ────────────────────────────────────────────────────
{
  const h = vraag("handshake", {});
  assert.ok(h.ok && h.result.ops.includes("ifc_importeren") && h.result.ops.includes("ifc_uitwerken"));
  ok("handshake meldt ifc_importeren en ifc_uitwerken");

  const zonderKeuze = vraag("ifc_importeren", { inhoud });
  assert.equal(zonderKeuze.ok, false);
  assert.equal(zonderKeuze.error.code, "INVOER_ONGELDIG");
  assert.equal(zonderKeuze.error.detail.reden, "modelKeuzeNodig");
  assert.deepEqual(zonderKeuze.error.detail.modellen.map((m) => m.naam), ["Hal", "Luifel"]);
  ok("twee analysemodellen zonder keuze: INVOER_ONGELDIG met de lijst modellen");

  const vreemd = vraag("ifc_importeren", { inhoud, analysemodell: 1 });
  assert.equal(vreemd.ok, false);
  assert.equal(vreemd.error.code, "INVOER_ONGELDIG");
  assert.equal(vreemd.error.detail.veld, "analysemodell");
  const reken = vraag("ifc_importeren", { inhoud, analysemodel: 2, reken: { analyse: "tweede orde" } });
  assert.equal(reken.error.detail.veld, "reken.analyse");
  ok("onbekende velden en waarden geweigerd als INVOER_ONGELDIG, met het veld");

  const geenIfc = vraag("ifc_importeren", { inhoud: "dit is geen ifc" });
  assert.equal(geenIfc.ok, false);
  assert.equal(geenIfc.error.code, "BESTAND_ONLEESBAAR");
  const geenModel = vraag("ifc_importeren", { inhoud: inhoud.replace(/IFCSTRUCTURALANALYSISMODEL/g, "IFCGROUP") });
  assert.equal(geenModel.error.code, "BESTAND_ONLEESBAAR");
  assert.equal(geenModel.error.detail.reden, "geenAnalysemodel");
  ok("geen STEP-bestand of geen analysemodel: BESTAND_ONLEESBAAR met reden");
}

// ── ifc_importeren: dezelfde import als de app ───────────────────────────────
{
  const a = vraag("ifc_importeren", { inhoud, pad: "C:/proef/hal.ifc", analysemodel: "Luifel" });
  assert.equal(a.ok, true, JSON.stringify(a.error));
  const r = a.result;
  const app = importeerIfcAnalyseModel(inhoud, { model: "Luifel" });
  assert.deepEqual(r.project.model3d, app.model3d, "het model is dat van de import in de app");
  assert.deepEqual(r.verslag, app.verslag);
  assert.equal(r.pad, "C:/proef/hal.ifc");
  assert.deepEqual(r.analysemodel, { nummer: 2, naam: "Luifel" });
  assert.equal(r.modellen.length, 2);
  assert.equal(r.project.modelDimension, "3d");
  assert.equal(r.project.scheefstandEnabled, false);
  assert.equal(r.project.projectInfo.name, "Voorbeeldhal - Luifel");
  assert.deepEqual(r.groepen, { Kolom: [1], Luifelligger: [2] });
  assert.equal(r.rekenverzoeken, undefined, "zonder `reken` geen rekenverzoeken");
  ok("ifc_importeren: projectbestand, verslag en modellen; het model is dat van de app");
}

// ── Een model dat de kern (nog) niet kan rekenen: reden, geen stil weglaten ──
{
  const a = vraag("ifc_importeren", { inhoud, analysemodel: 1, reken: {} });
  assert.equal(a.ok, true, JSON.stringify(a.error));
  const app = importeerIfcAnalyseModel(inhoud, { model: 1 });
  let verwacht = null;
  try {
    buildOpenFem3DSolveRequest(withOpenFem3DSelfWeight(app.model3d, 1), "linear", 1);
  } catch (fout) {
    verwacht = fout.message;
  }
  if (verwacht) {
    assert.equal(a.result.rekenen.mogelijk, false);
    assert.equal(a.result.rekenen.reden, verwacht);
    assert.equal(a.result.rekenverzoeken, undefined);
    ok(`de hal (trek-alleen en schijven): niet gerekend, met de reden van de rekenroute`);
  } else {
    assert.equal(a.result.rekenen.mogelijk, true);
    assert.ok(a.result.rekenverzoeken.length > 0);
    ok("de hal wordt gerekend (de kern kent trek-alleen en schijven)");
  }
}

// ── De keten: verzoeken → 3D-kern → uitwerken ────────────────────────────────
const solverBinary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${solverBinary}`, import.meta.url));
assert.ok(existsSync(solverPath), "Bouw eerst de Rust-rekenkern (cargo build -p open-fem-3d) of zet OPEN_FEM_3D_SOLVER_PATH.");
const kern = (request) => new Promise((resolve, reject) => {
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
  const a = vraag("ifc_importeren", { inhoud, analysemodel: 2, reken: {} });
  assert.equal(a.ok, true, JSON.stringify(a.error));
  const { rekenverzoeken, combinaties, reken, rekenen } = a.result;
  assert.deepEqual(reken, { analyse: "linear", gevolgklasse: "CC2" });
  assert.deepEqual(rekenen, { mogelijk: true, combinatiebron: "bestand" });
  assert.deepEqual(rekenverzoeken.map((v) => v.sleutel), ["geval:1", "geval:2", "geval:3", "geval:4", "combinatie:1", "combinatie:2"]);
  assert.deepEqual(combinaties.map((c) => [c.name, c.type, c.factors]), [
    ["Luifel UGT", "uls", { 1: 1.35, 2: 1.5 }], ["Luifel BGT", "sls", { 1: 1, 3: 1 }],
  ]);
  assert.ok(rekenverzoeken.every((v) => v.verzoek.analysis === "linear" && v.verzoek.bucklingModes === 0));

  const resultaten = {};
  for (const v of rekenverzoeken) resultaten[v.sleutel] = await kern(v.verzoek);
  const u = vraag("ifc_uitwerken", { inhoud, analysemodel: 2, reken: {}, resultaten });
  assert.equal(u.ok, true, JSON.stringify(u.error));
  const perGeval = Object.fromEntries(u.result.gevallen.map((g) => [g.id, g]));
  const hand = { 1: [0, 0, 6], 2: [0, 0, 0.8 * Math.sqrt(9.25)], 3: [0, 0, 8], 4: [-1.5, 0, 0] };
  for (const [id, [fx, fy, fz]] of Object.entries(hand)) {
    const g = perGeval[id];
    dichtbij(g.reactiesomKn.fx, fx, `${g.naam} ΣRx`);
    dichtbij(g.reactiesomKn.fy, fy, `${g.naam} ΣRy`);
    dichtbij(g.reactiesomKn.fz, fz, `${g.naam} ΣRz`);
  }
  for (const g of [...u.result.gevallen, ...u.result.combinaties]) {
    assert.equal(g.evenwicht.kern, true, `${g.naam}: evenwicht volgens de kern`);
    assert.equal(g.evenwicht.onafhankelijk, true, `${g.naam}: onafhankelijke krachtensom`);
    dichtbij(g.belastingsomKn.fz, -g.reactiesomKn.fz, `${g.naam}: Σ last = −Σ reactie`);
  }
  // UGT: 1,35 · 6 + 1,5 · 0,8 · √9,25.
  dichtbij(u.result.combinaties[0].reactiesomKn.fz, 1.35 * 6 + 1.5 * 0.8 * Math.sqrt(9.25), "Luifel UGT ΣRz");
  assert.equal(u.result.toetsinvoer.length, 2, "beide stalen staven krijgen toetsinvoer");
  assert.deepEqual(u.result.nietGetoetst, []);
  assert.deepEqual(u.result.groepen, { Kolom: [1], Luifelligger: [2] });
  ok(`keten voor de luifel: ${rekenverzoeken.length} verzoeken, ΣR = hand, evenwicht overal, 2 toetsinvoeren`);

  const zonder = { ...resultaten };
  delete zonder["geval:1"];
  const mis = vraag("ifc_uitwerken", { inhoud, analysemodel: 2, reken: {}, resultaten: zonder });
  assert.equal(mis.ok, false);
  assert.equal(mis.error.detail.veld, "resultaten.geval:1");
  const ander = vraag("ifc_uitwerken", { inhoud, analysemodel: 2, reken: {}, resultaten: { ...resultaten, "geval:9": resultaten["geval:1"] } });
  assert.equal(ander.ok, false);
  assert.equal(ander.error.detail.veld, "resultaten");
  ok("uitwerken weigert een ontbrekend resultaat en een onbekende sleutel");
}

console.log(`${geslaagd} geslaagd, 0 gefaald`);

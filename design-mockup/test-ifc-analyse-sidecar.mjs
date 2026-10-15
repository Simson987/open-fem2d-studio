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
//
// DE TOETSKRACHTEN (issue #199, B9). `reken.analyse` geldt alleen voor de
// resultaten. De UGT-toets rekent altijd zelf P-Δ met scheefstand in +X, −X,
// +Y en −Y (`toetsverzoeken`), met φ van het projectbestand van de import
// (geen scheefstandvelden: vast 1/200). Handcontrole voor "Luifel UGT"
// (1,35·G + 1,5·S): ΣR_z = 1,35·6 + 1,5·0,8·√9,25 = 11,7497 kN, en in de
// scheefstandrichting ΣR = −richting·φ·ΣR_z = ∓0,05875 kN (de luifel heeft
// verder geen horizontale last in deze combinatie).
// Rekenkern: OPEN_FEM_3D_SOLVER_PATH, anders src-tauri/target/debug/open-fem-3d(.exe).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  verwerkVerzoek, importeerIfcAnalyseModel, buildOpenFem3DSolveRequest, withOpenFem3DSelfWeight,
  deserializeProject,
} from "./src/mcp/kernel-exports.ts";

let geslaagd = 0;
const ok = (label) => { geslaagd += 1; console.log(`  ✓ ${label}`); };
let volgnummer = 0;
const vraag = (op, payload) => verwerkVerzoek({ v: 1, id: ++volgnummer, op, payload });
/** De φ van de toets: het projectbestand van de import heeft geen scheefstandvelden → vast 1/200. */
const PHI_VAST = 1 / 200;
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

// ── #233: de tekst van het .ifcfem-bestand, voor `uitvoerpad` ─────────────────
{
  const zonder = vraag("ifc_importeren", { inhoud, analysemodel: "Hal" });
  assert.equal(zonder.ok, true, JSON.stringify(zonder.error));
  assert.equal(zonder.result.projectTekst, undefined, "zonder `projectbestand` geen bestandstekst");
  const met = vraag("ifc_importeren", { inhoud, analysemodel: "Hal", projectbestand: true });
  assert.equal(met.ok, true, JSON.stringify(met.error));
  assert.equal(typeof met.result.projectTekst, "string");
  const bestand = JSON.parse(met.result.projectTekst);
  assert.equal(bestand.format, "open-fem-studio-v2", JSON.stringify(bestand.format));
  assert.ok(Number.isInteger(bestand.version) && bestand.version >= 1, String(bestand.version));
  assert.ok(!Number.isNaN(Date.parse(bestand.savedAt)), "savedAt is een datum");
  // Dezelfde lezer als Openen in de app (`deserializeProject`) leest het terug,
  // met het model van de import.
  const terug = deserializeProject(met.result.projectTekst);
  assert.equal(terug.modelDimension, "3d");
  assert.deepEqual(terug.model3d.nodes.length, met.result.project.model3d.nodes.length);
  assert.deepEqual(terug.model3d.beams.length, met.result.project.model3d.beams.length);
  assert.equal(terug.loadCases.length, met.result.project.loadCases.length);
  const fout = vraag("ifc_importeren", { inhoud, analysemodel: "Hal", projectbestand: "ja" });
  assert.equal(fout.ok, false);
  assert.equal(fout.error.detail.veld, "projectbestand");
  ok(`projectbestand: true geeft de .ifcfem-tekst (${terug.model3d.nodes.length} knopen, ${terug.model3d.beams.length} staven) die deserializeProject terugleest`);
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
    // De hal draagt de scheefstand als imperfectiegeval ("Imp G +X"), maar
    // alleen in de BGT-combinaties; "UGT 1" bevat het niet. De toets (alleen
    // UGT) telt de scheefstand dus niet dubbel, en zegt daar niets over. Tot
    // oktober 2026 meldde de toets hier "dubbel" voor elk imperfectiegeval
    // in het bestand; nu zet zij een imperfectiegeval in een UGT-combinatie op
    // factor 0 (dat geval: test-open-fem3d-toets-krachten [11]).
    assert.equal(a.result.verslag.aantallen.imperfectieGevallen, 1);
    assert.equal(a.result.toetsverzoeken.length, 4, "één UGT-combinatie in vier richtingen");
    assert.ok(!a.result.toetsanalyse.meldingen.some((m) => m.includes("op factor 0") || m.includes("dubbel")),
      a.result.toetsanalyse.meldingen.join("\n"));
    ok("de hal wordt gerekend (de kern kent trek-alleen en schijven); het imperfectiegeval zit niet in de UGT, dus geen melding");
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
  const { rekenverzoeken, toetsverzoeken, toetsanalyse, combinaties, reken, rekenen } = a.result;
  assert.deepEqual(reken, { analyse: "linear", gevolgklasse: "CC2" });
  assert.deepEqual(rekenen, { mogelijk: true, combinatiebron: "bestand" });
  assert.deepEqual(rekenverzoeken.map((v) => v.sleutel), ["geval:1", "geval:2", "geval:3", "geval:4", "combinatie:1", "combinatie:2"]);
  assert.deepEqual(combinaties.map((c) => [c.name, c.type, c.factors]), [
    ["Luifel UGT", "uls", { 1: 1.35, 2: 1.5 }], ["Luifel BGT", "sls", { 1: 1, 3: 1 }],
  ]);
  assert.ok(rekenverzoeken.every((v) => v.verzoek.analysis === "linear" && v.verzoek.bucklingModes === 0));
  // De toets: "Luifel UGT" in +X, −X, +Y en −Y, P-Δ met één knikvorm; φ = 1/200 (vast).
  assert.deepEqual(toetsverzoeken.map((v) => v.sleutel), ["toets:1", "toets:1000001", "toets:2000001", "toets:3000001"]);
  assert.ok(toetsverzoeken.every((v) => v.soort === "toets" && v.verzoek.analysis === "p-delta" && v.verzoek.bucklingModes === 1));
  assert.equal(toetsanalyse.analysis_type, "tweedeOrdeGeometrisch");
  assert.equal(toetsanalyse.model_analysis_type, "linear");
  assert.deepEqual(toetsanalyse.scheefstand,
    {
      phi: 1 / 200, noemer: 200, bron: "vast", model_scheefstand_aan: false, afgedwongen: true,
      // Issue #194: φ per richting; met de vaste noemer gelijk aan φ.
      phi_x: 1 / 200, phi_y: 1 / 200, noemer_x: 200, noemer_y: 200,
    });
  assert.deepEqual(toetsanalyse.meldingen, [], "geen imperfectiegeval, geen hout");
  const zonderToets = vraag("ifc_importeren", { inhoud, analysemodel: 2, reken: {}, toetsen: false });
  assert.equal(zonderToets.result.toetsverzoeken, undefined);
  const fout = vraag("ifc_importeren", { inhoud, analysemodel: 2, reken: {}, toetsen: 1 });
  assert.equal(fout.error.detail.veld, "toetsen");
  ok("ifc_importeren met reken: 6 resultaatverzoeken (lineair) en 4 toetsverzoeken (P-Δ, φ = 1/200, ±X/±Y)");

  const resultaten = {};
  for (const v of rekenverzoeken) resultaten[v.sleutel] = await kern(v.verzoek);
  const toetsresultaten = {};
  for (const v of toetsverzoeken) toetsresultaten[v.sleutel] = { resultaat: await kern(v.verzoek) };
  const u = vraag("ifc_uitwerken", { inhoud, analysemodel: 2, reken: {}, resultaten, toetsresultaten });
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
  const ugtZ = 1.35 * 6 + 1.5 * 0.8 * Math.sqrt(9.25);
  dichtbij(u.result.combinaties[0].reactiesomKn.fz, ugtZ, "Luifel UGT ΣRz");
  assert.equal(u.result.toetsinvoer.length, 2, "beide stalen staven krijgen toetsinvoer");
  assert.deepEqual(u.result.nietGetoetst, []);
  assert.deepEqual(u.result.groepen, { Kolom: [1], Luifelligger: [2] });
  ok(`keten voor de luifel: ${rekenverzoeken.length} verzoeken, ΣR = hand, evenwicht overal, 2 toetsinvoeren`);

  // De toets: ΣR per richting volgens de hand (zie de kop), evenwicht, α_cr > 1,
  // en de UGT-krachten van de toetsinvoer zijn die van de vier toetsvarianten.
  const t = u.result.toetsanalyse;
  assert.equal(t.geweigerd, false);
  const verwacht = { 1: [-PHI_VAST * ugtZ, 0], 1000001: [PHI_VAST * ugtZ, 0], 2000001: [0, -PHI_VAST * ugtZ], 3000001: [0, PHI_VAST * ugtZ] };
  for (const b of t.berekeningen) {
    dichtbij(b.reactiesomKn.fx, verwacht[b.id][0], `${b.naam} ΣRx`, 1e-6);
    dichtbij(b.reactiesomKn.fy, verwacht[b.id][1], `${b.naam} ΣRy`, 1e-6);
    dichtbij(b.reactiesomKn.fz, ugtZ, `${b.naam} ΣRz`, 1e-6);
    assert.equal(b.evenwicht.kern, true, b.naam);
    assert.equal(b.evenwicht.onafhankelijk, true, b.naam);
    assert.ok(b.alphaCr > 1, `${b.naam}: α_cr ${b.alphaCr}`);
  }
  assert.deepEqual(t.alpha_cr.map((x) => [x.combination_id, x.status]), [[1, "bepaald"]]);
  const ids = new Set(u.result.toetsinvoer.flatMap((x) => x.forces_envelope.map((p) => p.combination_id)));
  assert.deepEqual([...ids].sort((p, q) => p - q), [1, 1000001, 2000001, 3000001]);
  assert.ok(u.result.notities.some((n) => n.includes("tweede orde (P-Δ) met scheefstand φ = 1/200")));
  ok("toets van de luifel: 4 berekeningen, ΣR_x/ΣR_y = ∓φ·ΣR_z volgens de hand, toetsinvoer uit de toetsvarianten");

  const zonder = { ...resultaten };
  delete zonder["geval:1"];
  const mis = vraag("ifc_uitwerken", { inhoud, analysemodel: 2, reken: {}, resultaten: zonder, toetsresultaten });
  assert.equal(mis.ok, false);
  assert.equal(mis.error.detail.veld, "resultaten.geval:1");
  const ander = vraag("ifc_uitwerken", { inhoud, analysemodel: 2, reken: {}, resultaten: { ...resultaten, "geval:9": resultaten["geval:1"] }, toetsresultaten });
  assert.equal(ander.ok, false);
  assert.equal(ander.error.detail.veld, "resultaten");
  const geenToets = vraag("ifc_uitwerken", { inhoud, analysemodel: 2, reken: {}, resultaten });
  assert.equal(geenToets.error.detail.veld, "toetsresultaten");
  const uit = vraag("ifc_uitwerken", { inhoud, analysemodel: 2, reken: {}, resultaten, toetsen: false });
  assert.equal(uit.ok, true, JSON.stringify(uit.error));
  assert.equal(uit.result.toetsinvoer, undefined, "zonder toets geen toetsinvoer (ook niet op de resultaten)");
  ok("uitwerken weigert een ontbrekend resultaat, een onbekende sleutel en een ontbrekende toets");

  // Een mislukte toetsberekening: de toets wordt geweigerd met de reden, de resultaten blijven.
  const geweigerd = vraag("ifc_uitwerken", { inhoud, analysemodel: 2, reken: {}, resultaten,
    toetsresultaten: { ...toetsresultaten, "toets:2000001": { fout: "proef: instabiel" } } });
  assert.equal(geweigerd.ok, true, JSON.stringify(geweigerd.error));
  assert.equal(geweigerd.result.toetsinvoer, undefined);
  assert.equal(geweigerd.result.gevallen.length, 4);
  assert.deepEqual(geweigerd.result.toetsweigering.per_combinatie,
    [{ combination_id: 2000001, name: "Luifel UGT (scheefstand +Y)", reason: `P-Δ: proef: instabiel (${t.alpha_cr[0].label})` }]);
  assert.match(geweigerd.result.toetsweigering.suggestie, /Verstijf het model/);
  ok("een mislukte toetsberekening: weigering met de reden per combinatie, geen toetsinvoer, de resultaten blijven");
}

console.log(`${geslaagd} geslaagd, 0 gefaald`);

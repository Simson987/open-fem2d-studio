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
//
// DE TOETSKRACHTEN (issue #199, B9). `reken.analyse` geldt alleen voor de
// resultaten. De UGT-toets rekent altijd zelf P-Δ met scheefstand in +X, −X,
// +Y en −Y (`toetsverzoeken`), met φ van het projectbestand: zonder
// scheefstandvelden vast 1/200, zoals de app dat bestand opent. Handcontrole
// per toetsberekening: ΣR = Σ γ·ΣR(geval), en in de scheefstandrichting
// daarbij −richting·φ·ΣR_z (elke verticale last V krijgt φ·V horizontaal; K_G
// voert bij een starre translatie geen kracht af, zie
// test-open-fem3d-staalhal-pdelta). De standaardhal wordt geweigerd: zijn
// wandverbanden CHS 88,9×4 knikken onder "Wind langs" zelf (α_cr 0,66–0,75,
// 8 van de 28 toetsberekeningen); met trek-alleen verbanden is elke
// toetsberekening stabiel.
// Rekenkern: OPEN_FEM_3D_SOLVER_PATH, anders src-tauri/target/debug/open-fem-3d(.exe).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
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
  assert.deepEqual(r.project.projectInfo.uitgangspunten, {
    en1993: false, en1995: false, en1992: false, normenHandmatig: [],
    gevolgklasse: "CC2", levensduurklasse: "4", nationaleBijlage: "NL",
    windCodeId: "nl-en-1991-1-4-legacy", windgebied: "II", terreincategorie: "II",
  }, "MCP-project bewaart volledige uitgangspunten en Nederlandse windroute");
  assert.equal(r.project.structuralGrid.xAxes.length, 11, "stramien gaat mee in het projectbestand");
  assert.deepEqual([r.samenvatting.aantallen.knopen, r.samenvatting.aantallen.staven], [165, 340]);
  assert.equal(r.rekenverzoeken, undefined, "zonder `reken` geen rekenverzoeken");
  const zonder = vraag("staalhal_maken", { stramien: false });
  assert.equal(zonder.result.project.structuralGrid, undefined);
  ok("staalhal_maken zonder parameters: de voorbeeldhal, projectbestand met stramien");
}
{
  const a = vraag("staalhal_maken", { hal: { lasten: { dakgebruikKnM2: 0.4 } } });
  assert.equal(a.ok, true, JSON.stringify(a.error));
  assert.deepEqual(a.result.project.loadCases.find((item) => item.id === 6),
    { id: 6, name: "Dakgebruik (Q)", type: "live", categorie: "H" });
  dichtbij(a.result.samenvatting.belastingsom[6].fz, -0.4 * 60 * 30, "sidecar Q: Σ last");
  assert.ok(a.result.project.model3d.memberLoads.some((item) => item.caseId === 6));
  ok("staalhal_maken bewaart dakgebruik Q en de volledige last op de gordingen");
}
{
  const a = vraag("staalhal_maken", { hal: { verbanden: { kopgevels: true, trekAlleen: true } } });
  assert.equal(a.ok, true, JSON.stringify(a.error));
  const ids = a.result.samenvatting.groepen.kopgevelverband;
  assert.equal(ids.length, 4);
  assert.equal(a.result.project.model3d.tensionOnlyCrossRule, true);
  assert.ok(ids.every((id) => a.result.project.model3d.beams.find((beam) => beam.id === id)?.tensionOnly));
  ok("staalhal_maken bewaart trek-alleen kopgevelkruizen in het projectbestand");
}
{
  const a = vraag("staalhal_maken", { hal: { lengteMm: 12000, breedteMm: 12000, aantalVakken: 2,
    dak: { type: "platdak" }, gordingafstandMm: 3000, aantalOverspanningen: 3,
    fundering: { type: "balkrooster" } } });
  assert.equal(a.ok, true, JSON.stringify(a.error));
  assert.deepEqual(a.result.project.structuralGrid.yAxes.map((as) => as.position), [0, 4000, 8000, 12000]);
  assert.equal(a.result.samenvatting.groepen.kolom.length, 12);
  assert.equal(a.result.samenvatting.paalknopen.length, 12);
  ok("staalhal_maken bewaart drie overspanningen met binnenkolommen en palen");
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

// ── staalhal_maken met reken: de resultaten én de UGT-toets (issue #199) ─────
{
  const a = vraag("staalhal_maken", { reken: {} });
  assert.equal(a.ok, true, JSON.stringify(a.error));
  const { rekenverzoeken, toetsverzoeken, toetsanalyse, combinaties } = a.result;
  // De resultaten: lineair, zonder scheefstand en zonder knikvormen, zoals voorheen.
  assert.ok(rekenverzoeken.every((v) => v.verzoek.analysis === "linear" && v.verzoek.bucklingModes === 0));
  // De toets: elke UGT-combinatie in +X, −X, +Y en −Y (id + k·1 000 000), P-Δ met één knikvorm.
  const ugt = combinaties.filter((c) => c.type === "uls");
  assert.equal(ugt.length, 7, "zeven UGT-combinaties in de standaardset van deze vijf gevallen");
  assert.deepEqual(toetsverzoeken.map((v) => v.id), ugt.flatMap((c) => [0, 1, 2, 3].map((k) => c.id + k * 1_000_000)));
  assert.ok(toetsverzoeken.every((v) => v.soort === "toets" && v.sleutel === `toets:${v.id}`
    && v.verzoek.analysis === "p-delta" && v.verzoek.bucklingModes === 1));
  assert.equal(toetsanalyse.analysis_type, "tweedeOrdeGeometrisch");
  assert.equal(toetsanalyse.model_analysis_type, "linear");
  assert.equal(toetsanalyse.hergebruikt, false);
  // φ: het projectbestand van de hal heeft geen scheefstandvelden → vast 1/200 (useFemStore bij openen).
  assert.deepEqual(toetsanalyse.scheefstand,
    {
      phi: 1 / 200, noemer: 200, bron: "vast", model_scheefstand_aan: false, afgedwongen: true,
      // Issue #194: φ per richting; met de vaste noemer gelijk aan φ.
      phi_x: 1 / 200, phi_y: 1 / 200, noemer_x: 200, noemer_y: 200,
    });
  assert.deepEqual(toetsanalyse.richtingen, ["+X", "−X", "+Y", "−Y"]);
  assert.equal(toetsanalyse.aantal_berekeningen, 28);
  assert.equal(toetsanalyse.alpha_cr, undefined, "α_cr pas na de berekening");
  ok("staalhal_maken met reken: 19 resultaatverzoeken (lineair) en 28 toetsverzoeken (P-Δ, φ = 1/200, ±X/±Y)");

  const pDelta = vraag("staalhal_maken", { reken: { analyse: "p-delta" } });
  assert.ok(pDelta.result.rekenverzoeken.every((v) => v.verzoek.analysis === "p-delta"));
  assert.equal(pDelta.result.toetsanalyse.model_analysis_type, "p-delta");
  assert.equal(pDelta.result.toetsanalyse.hergebruikt, false, "de resultaten hebben geen scheefstand: geen hergebruik");
  assert.deepEqual(pDelta.result.toetsverzoeken.map((v) => v.sleutel), toetsverzoeken.map((v) => v.sleutel));
  const zonder = vraag("staalhal_maken", { reken: {}, toetsen: false });
  assert.equal(zonder.ok, true, JSON.stringify(zonder.error));
  assert.equal(zonder.result.toetsverzoeken, undefined);
  assert.equal(zonder.result.toetsanalyse, undefined);
  assert.equal(zonder.result.rekenverzoeken.length, rekenverzoeken.length);
  const fout = vraag("staalhal_maken", { reken: {}, toetsen: "ja" });
  assert.equal(fout.ok, false);
  assert.equal(fout.error.detail.problemen[0].veld, "toetsen");
  ok("de toets volgt `reken.analyse` niet; `toetsen: false` laat hem weg, een ander type wordt geweigerd");
}

// ── De keten: verzoeken → 3D-kern → uitwerken ────────────────────────────────
const solverBinary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${solverBinary}`, import.meta.url));
assert.ok(existsSync(solverPath), "Bouw eerst de Rust-rekenkern (of zet OPEN_FEM_3D_SOLVER_PATH).");
/** Eén verzoek door de kern, als apart proces: `{ resultaat }` of `{ fout }` (de melding van de kern). */
const kern = (request) => new Promise((resolve, reject) => {
  const child = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  const uit = [];
  child.stdout.on("data", (d) => uit.push(d));
  child.on("error", reject);
  child.on("close", (code) => {
    const tekst = Buffer.concat(uit).toString();
    if (code === 0) resolve({ resultaat: JSON.parse(tekst) });
    else resolve({ fout: (() => { try { return JSON.parse(tekst).fout; } catch { return `3D-kern: exit ${code}; ${tekst.slice(0, 400)}`; } })() });
  });
  child.stdin.end(JSON.stringify(request));
});
/** Zoals de MCP-server: alle verzoeken door de kern, een paar tegelijk. */
const TEGELIJK = Math.max(1, Math.min(4, availableParallelism()));
async function rekenAlle(verzoeken) {
  const uit = new Array(verzoeken.length);
  let volgende = 0;
  await Promise.all(Array.from({ length: Math.min(TEGELIJK, verzoeken.length) }, async () => {
    while (volgende < verzoeken.length) {
      const i = volgende++;
      uit[i] = await kern(verzoeken[i].verzoek);
    }
  }));
  return Object.fromEntries(verzoeken.map((v, i) => [v.sleutel, uit[i]]));
}
/** De resultaten: elke berekening hoort te slagen (de MCP-server breekt anders af). */
async function resultatenVan(verzoeken) {
  const uit = await rekenAlle(verzoeken);
  for (const [sleutel, u] of Object.entries(uit)) assert.ok(u.resultaat, `${sleutel}: ${u.fout}`);
  return Object.fromEntries(Object.entries(uit).map(([k, u]) => [k, u.resultaat]));
}
const PHI = 1 / 200;
/**
 * ΣR van een toetsberekening volgens de hand: Σ γ·ΣR(geval), en in de
 * scheefstandrichting daarbij −richting·φ·ΣR_z. Variant k = ⌊id / 10⁶⌋:
 * 0 = +X, 1 = −X, 2 = +Y, 3 = −Y.
 */
function toetsReactiesom(combinaties, hand, id) {
  const c = combinaties.find((x) => x.id === id % 1_000_000);
  const som = [0, 1, 2].map((as) => Object.entries(c.factors).reduce((t, [geval, f]) => t + f * hand[geval][as], 0));
  const k = Math.floor(id / 1_000_000);
  som[k < 2 ? 0 : 1] -= (k % 2 === 0 ? 1 : -1) * PHI * som[2];
  return som;
}

{
  // De keten op het balkrooster. De verbanden trek-alleen: de standaardverbanden
  // knikken in de toets zelf (zie het volgende blok); met trek-alleen verbanden
  // is elke toetsberekening stabiel. De resultaten (ΣR, Σ paalreacties) zijn
  // daarmee niet anders: het blijven dezelfde lasten.
  const hal = { fundering: { type: "balkrooster" }, verbanden: { trekAlleen: true } };
  const a = vraag("staalhal_maken", { hal, reken: {} });
  assert.equal(a.ok, true, JSON.stringify(a.error));
  const { rekenverzoeken, toetsverzoeken, combinaties, reken: instellingen } = a.result;
  assert.deepEqual(instellingen, { analyse: "linear", gevolgklasse: "CC2" });
  const gevallen = rekenverzoeken.filter((v) => v.soort === "geval");
  assert.deepEqual(gevallen.map((v) => v.id), [5, 1, 2, 3, 4], "elk belast geval, in de volgorde van de gevallen");
  // De standaardcombinaties van deze vijf gevallen, zonder combinaties zonder belast geval.
  const verwacht = defaultCombinations(maakStaalhal(hal).loadCases);
  assert.deepEqual(combinaties.map((c) => c.id), verwacht.map((c) => c.id));
  assert.equal(rekenverzoeken.length, 5 + verwacht.length);
  assert.equal(new Set(rekenverzoeken.map((v) => v.sleutel)).size, rekenverzoeken.length, "unieke sleutels");
  assert.ok(rekenverzoeken.every((v) => v.verzoek.analysis === "linear" && v.verzoek.bucklingModes === 0));
  assert.equal(toetsverzoeken.length, 28);

  const resultaten = await resultatenVan(rekenverzoeken);
  const toetsresultaten = await rekenAlle(toetsverzoeken);
  const u = vraag("staalhal_uitwerken", { hal, reken: {}, resultaten, toetsresultaten });
  assert.equal(u.ok, true, JSON.stringify(u.error));
  const perGeval = Object.fromEntries(u.result.gevallen.map((g) => [g.id, g]));
  // Eigen gewicht: staal + beton, beide als Σ ρ·A·g·L (zie de generatortest).
  const eigenGewicht = 809.947 + 5.886 * (2 * 60 + 11 * 30 + 22 * 0.8);
  const hand = { 1: [0, 0, 540], 2: [0, 0, 1008], 3: [0, -499.2, -864], 4: [-84, 0, 0], 5: [0, 0, eigenGewicht] };
  for (const id of [1, 2, 3, 4]) {
    const [fx, fy, fz] = hand[id];
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
  dichtbij(perGeval[5].reactiesomKn.fz, eigenGewicht, "eigen gewicht", 1e-2);
  assert.deepEqual(u.result.grenzen, { doorbuigingMm: 120, zijverplaatsingMm: 8000 / 150 });
  ok(`keten op het balkrooster: ${rekenverzoeken.length} resultaatverzoeken, ΣR en Σ paalreacties = hand, evenwicht overal`);

  // De toets: 28 P-Δ-berekeningen, elk stabiel, ΣR = hand met φ·ΣV in de scheefstandrichting.
  const t = u.result.toetsanalyse;
  assert.equal(t.geweigerd, false);
  assert.equal(u.result.toetsweigering, undefined);
  assert.equal(t.berekeningen.length, 28);
  for (const b of t.berekeningen) {
    assert.equal(b.analyse, "p-delta", b.naam);
    assert.ok(b.alphaCr > 1, `${b.naam}: α_cr ${b.alphaCr}`);
    assert.equal(b.evenwicht.kern, true, `${b.naam}: evenwicht volgens de kern`);
    assert.equal(b.evenwicht.onafhankelijk, true, `${b.naam}: onafhankelijke krachtensom`);
    const [fx, fy, fz] = toetsReactiesom(combinaties, hand, b.id);
    dichtbij(b.reactiesomKn.fx, fx, `${b.naam} ΣRx`, 1e-2);
    dichtbij(b.reactiesomKn.fy, fy, `${b.naam} ΣRy`, 1e-2);
    dichtbij(b.reactiesomKn.fz, fz, `${b.naam} ΣRz`, 1e-2);
  }
  // α_cr één keer per UGT-basiscombinatie: die van de +X-variant (informatief).
  assert.deepEqual(t.alpha_cr.map((x) => x.combination_id), combinaties.filter((c) => c.type === "uls").map((c) => c.id));
  for (const x of t.alpha_cr) {
    assert.equal(x.status, "bepaald");
    assert.equal(x.alpha_cr, t.berekeningen.find((b) => b.id === x.combination_id).alphaCr);
  }
  // Toetsinvoer voor elke stalen staaf; beton (balken en poeren) met reden overgeslagen.
  // De UGT-krachten zijn die van de toetsvarianten, niet die van de resultaten.
  assert.equal(u.result.toetsinvoer.length, 340);
  assert.equal(u.result.nietGetoetst.length, 75 + 22);
  assert.ok(u.result.toetsinvoer.every((x) => x.forces_envelope.length > 0 && x.steel_grade === "S235"));
  const ids = new Set(u.result.toetsinvoer.flatMap((x) => x.forces_envelope.map((p) => p.combination_id)));
  assert.deepEqual([...ids].sort((p, q) => p - q), toetsverzoeken.map((v) => v.id).sort((p, q) => p - q));
  assert.ok(u.result.notities.some((n) => n.includes("tweede orde (P-Δ) met scheefstand φ = 1/200")), u.result.notities.join("\n"));
  ok("toets op het balkrooster: 28 berekeningen stabiel, ΣR = hand met φ = 1/200, α_cr per basiscombinatie, 340 toetsinvoeren met de toetsvarianten");

  // Een resultaat dat ontbreekt of bij een andere hal hoort, wordt geweigerd;
  // net zo een toetsuitkomst die ontbreekt, onbekend is of geen rekenresultaat is.
  const zonder = { ...resultaten };
  delete zonder["geval:1"];
  const mis = vraag("staalhal_uitwerken", { hal, reken: {}, resultaten: zonder, toetsresultaten });
  assert.equal(mis.ok, false);
  assert.equal(mis.error.detail.problemen[0].veld, "resultaten.geval:1");
  const ander = vraag("staalhal_uitwerken", { hal: {}, reken: {}, resultaten, toetsresultaten });
  assert.equal(ander.ok, false, "resultaten van het rooster passen niet bij de hal zonder rooster");
  const geenToets = vraag("staalhal_uitwerken", { hal, reken: {}, resultaten });
  assert.equal(geenToets.ok, false);
  assert.equal(geenToets.error.detail.problemen[0].veld, "toetsresultaten");
  const { "toets:1": _weg, ...toetsZonder } = toetsresultaten;
  const half = vraag("staalhal_uitwerken", { hal, reken: {}, resultaten, toetsresultaten: toetsZonder });
  assert.equal(half.ok, false);
  assert.match(half.error.melding, /Ontbrekende toetssleutels: toets:1\b/);
  const vreemd = vraag("staalhal_uitwerken", { hal, reken: {}, resultaten, toetsresultaten: { ...toetsresultaten, "toets:9": toetsresultaten["toets:1"] } });
  assert.match(vreemd.error.melding, /Onbekende toetssleutels: toets:9/);
  const kapot = vraag("staalhal_uitwerken", { hal, reken: {}, resultaten, toetsresultaten: { ...toetsresultaten, "toets:1": { resultaat: resultaten["geval:1"].reactions } } });
  assert.equal(kapot.error.detail.problemen[0].veld, "toetsresultaten.toets:1");
  const uit = vraag("staalhal_uitwerken", { hal, reken: {}, resultaten, toetsen: false });
  assert.equal(uit.ok, true, JSON.stringify(uit.error));
  assert.equal(uit.result.toetsinvoer, undefined, "zonder toets geen toetsinvoer (ook niet op de resultaten)");
  assert.equal(uit.result.toetsanalyse, undefined);
  const beide = vraag("staalhal_uitwerken", { hal, reken: {}, resultaten, toetsen: false, toetsresultaten });
  assert.equal(beide.error.detail.problemen[0].veld, "toetsresultaten");
  ok("uitwerken weigert ontbrekende, vreemde en kapotte (toets)resultaten; `toetsen: false` geeft geen toetsinvoer");
}

{
  // De standaardhal: de resultaten rekenen, de toets wordt geweigerd. Onder
  // "Wind langs (W) leidend" (combinaties 4 en 7) krijgen de wandverbanden CHS
  // 88,9×4 van 10 m meer druk dan hun eigen knikkracht (α_cr 0,66–0,75, zie
  // test-open-fem3d-staalhal-pdelta): 8 van de 28 toetsberekeningen. Nooit een
  // terugval op eerste orde (B7).
  const a = vraag("staalhal_maken", { reken: {} });
  assert.equal(a.ok, true, JSON.stringify(a.error));
  const resultaten = await resultatenVan(a.result.rekenverzoeken);
  const toetsresultaten = await rekenAlle(a.result.toetsverzoeken);
  const mislukt = Object.keys(toetsresultaten).filter((k) => toetsresultaten[k].fout).map((k) => Number(k.slice(6)));
  const windLangs = [4, 7].flatMap((id) => [0, 1, 2, 3].map((k) => id + k * 1_000_000));
  assert.deepEqual(mislukt.sort((p, q) => p - q), windLangs.sort((p, q) => p - q));
  const u = vraag("staalhal_uitwerken", { hal: {}, reken: {}, resultaten, toetsresultaten });
  assert.equal(u.ok, true, JSON.stringify(u.error));
  assert.equal(u.result.gevallen.length, 5, "de resultaten blijven");
  assert.equal(u.result.combinaties.length, 14);
  assert.equal(u.result.toetsinvoer, undefined, "geen toetsinvoer bij een geweigerde toets");
  assert.equal(u.result.toetsanalyse.geweigerd, true);
  const w = u.result.toetsweigering;
  assert.match(w.reden, /faalt in 8 van de 28 toetsberekeningen/);
  assert.match(w.reden, /niet teruggevallen op eerste orde/);
  assert.deepEqual(w.per_combinatie.map((c) => c.combination_id).sort((p, q) => p - q), windLangs);
  const wandverband = new Set(a.result.samenvatting.groepen.wandverband);
  for (const c of w.per_combinatie) {
    assert.match(c.reason, /^P-Δ: tweede-orde 3D-berekening wijst op instabiliteit/, c.name);
    assert.match(c.reason, /eigen knikkracht/, c.name);
    const staven = [...c.reason.matchAll(/staaf (\d+) \(CHS 88\.9x4/g)].map((m) => Number(m[1]));
    assert.ok(staven.length > 0 && staven.every((id) => wandverband.has(id)), `${c.name}: ${staven} zijn wandverbanden`);
  }
  assert.match(w.suggestie, /wandverband \d+/);
  assert.match(w.suggestie, /maak de verbanden trek-alleen \(`hal\.verbanden\.trekAlleen: true`\) of kies zwaardere verbanden/);
  assert.match(w.suggestie, /nu CHS 88\.9x4 S235/);
  // α_cr per basiscombinatie: bij 4 en 7 niet bepaald (de +X-variant faalt), de rest bepaald en > 1.
  for (const x of u.result.toetsanalyse.alpha_cr) {
    if (x.combination_id === 4 || x.combination_id === 7) {
      assert.equal(x.status, "niet_bepaald", x.name);
      assert.match(x.reason, /alpha_cr=0\.\d+/, x.name);
    } else {
      assert.equal(x.status, "bepaald", x.name);
      assert.ok(x.alpha_cr > 1, `${x.name}: ${x.alpha_cr}`);
    }
  }
  ok("standaardhal: de resultaten blijven, de toets geweigerd (8 × Wind langs, de wandverbanden knikken), met de suggestie trek-alleen of zwaardere verbanden");
}

{
  const hal = { lengteMm: 12000, breedteMm: 8000, aantalVakken: 2,
    dak: { type: "platdak" }, gordingafstandMm: 2000,
    profielen: {
      kolom: { materiaal: "GL28h", profiel: "200x400" },
      spantligger: { materiaal: "GL28h", profiel: "160x400" },
      gording: { materiaal: "C24", profiel: "80x200" },
      randligger: { materiaal: "C24", profiel: "100x200" },
      verband: { materiaal: "C24", profiel: "100x100" },
    } };
  const a = vraag("staalhal_maken", { hal, reken: {} });
  assert.equal(a.ok, true, JSON.stringify(a.error));
  const resultaten = await resultatenVan(a.result.rekenverzoeken);
  const toetsresultaten = await rekenAlle(a.result.toetsverzoeken);
  const u = vraag("staalhal_uitwerken", { hal, reken: {}, resultaten, toetsresultaten });
  assert.equal(u.ok, true, JSON.stringify(u.error));
  assert.equal(u.result.toetsinvoer.length, 0, "geen staaltoets voor houten staven");
  assert.equal(u.result.houtToetsinvoer.length, a.result.project.model3d.beams.length);
  assert.ok(u.result.houtToetsinvoer.every((item) => item.forces_envelope?.length > 0));
  assert.ok(u.result.houtToetsinvoer.some((item) => item.strength_class === "GL28h"));
  assert.ok(u.result.houtToetsinvoer.some((item) => item.strength_class === "C24"));
  // Hout: φ volgens NEN-EN 1995-1-1 (5.1) bij h = 8 m is 0,005·√(5/8) = 0,00395 < 1/200,
  // dus de φ van de projectinstelling blijft; de toets meldt dat hij met E_mean rekent (B10).
  const t = u.result.toetsanalyse;
  assert.deepEqual(t.scheefstand, {
      phi: 1 / 200, noemer: 200, bron: "vast", model_scheefstand_aan: false, afgedwongen: true,
      // Issue #194: φ per richting; met de vaste noemer gelijk aan φ.
      phi_x: 1 / 200, phi_y: 1 / 200, noemer_x: 200, noemer_y: 200,
    });
  assert.ok(t.meldingen.some((m) => m.includes("E_mean")), t.meldingen.join("\n"));
  const ids = new Set(u.result.houtToetsinvoer.flatMap((x) => x.forces_envelope.map((p) => p.combination_id)));
  assert.ok([...ids].every((id) => a.result.toetsverzoeken.some((v) => v.id === id)), "de UGT uit de toetsvarianten");
  ok("houten hal: de toets (P-Δ, φ = 1/200, met de houtmelding) levert voor elke staaf EN 1995-toetsinvoer");
}

console.log(`${geslaagd} geslaagd, 0 gefaald`);

// De generator van de wizard "Stalen hal" (src/components/openFem3d/wizards/staalhal.ts):
// aantallen voor enkele parametersets, de strikte invoerpoort, de windlasten uit
// de stuwdruk, en per belastinggeval een rekenproef met de 3D-kern — ook met het
// balkrooster als fundering.
//
// ALLE verwachte getallen hieronder zijn handwerk uit de parameters, niet
// afgelezen uit de generator of de kern:
//   - aantallen uit de indeling (spanten, gordingvelden, vakken, palen);
//   - ΣR per geval uit last × oppervlak of last × strook × hoogte;
//   - eigen gewicht als Σ ρ·A·g·L (staal uit de catalogus, beton b·h).
//
// Rekenkern: OPEN_FEM_3D_SOLVER_PATH, anders src-tauri/target/debug/open-fem-3d(.exe).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  leesStaalhalInvoer,
  maakStaalhal,
  metBelastinggevalIds,
  probeerStaalhal,
  staalhalProject,
  STAALHAL_GEVAL,
  STAALHAL_STANDAARD,
  StaalhalFout,
} from "./src/components/openFem3d/wizards/staalhal.ts";
import { buildOpenFem3DSolveRequest, openFem3DGlobalForceBalance } from "./src/components/openFem3d/openFem3dSolver.ts";
import { withOpenFem3DSelfWeight } from "./src/components/openFem3d/openFem3dModel.ts";
import { dichtheidVanMateriaal, resolveSection } from "./src/lib/sectionResolver.ts";
import { zorgVoorBelastinggevallen } from "./src/lib/combinatieBeheer.ts";
import { standaardBelastinggevallen } from "./src/lib/eigenGewicht.ts";
import { defaultCombinations } from "./src/components/fem/solver/combinations.ts";

let geslaagd = 0;
const ok = (label) => { geslaagd += 1; console.log(`  ✓ ${label}`); };
const dichtbij = (a, b, label, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${label}: verwacht ${b}, berekend ${a}`);
const aantallen = (hal) => {
  const a = hal.samenvatting.aantallen;
  return [a.knopen, a.staven, a.opleggingen, a.palen, a.knoopbelastingen, a.staafbelastingen];
};
const telGroepen = (hal) => Object.fromEntries(Object.entries(hal.samenvatting.groepen).map(([k, v]) => [k, v.length]));

// ── 1. Standaardparameters = het voorbeeldmodel ──────────────────────────────
{
  assert.deepEqual(leesStaalhalInvoer({}), STAALHAL_STANDAARD);
  assert.deepEqual(leesStaalhalInvoer(), STAALHAL_STANDAARD);
  const hal = maakStaalhal({});
  // 11 spanten × (2 voeten + 13 dakknopen) = 165; staven: 22 kolommen, 11 × 12
  // spantdelen, 10 × 11 gordingen + 10 × 2 randliggers, 2 vakken × 12 velden ×
  // 2 dakdiagonalen, 2 vakken × 2 gevels × 2 wanddiagonalen.
  assert.deepEqual(aantallen(hal), [165, 340, 22, 0, 13, 412]);
  assert.deepEqual(telGroepen(hal), {
    kolom: 22, spantligger: 132, gording: 110, randligger: 20, dakverband: 48, wandverband: 8, kopgevelverband: 0, funderingsbalk: 0, poer: 0,
  });
  const m = hal.samenvatting.maten;
  assert.deepEqual([m.aantalSpanten, m.spantafstandMm, m.aantalGordingvelden, m.gordingafstandMm, m.verbandvakken],
    [11, 6000, 12, 2500, [1, 10]]);
  dichtbij(m.hellingGraden, Math.atan(1.5 / 15) * 180 / Math.PI, "dakhelling", 1e-12);
  // De belastingsom uit het overzicht is die van de hand (zie de staalhaltest).
  const som = hal.samenvatting.belastingsom;
  dichtbij(som[1].fz, -540, "Σ G"); dichtbij(som[2].fz, -1008, "Σ S");
  dichtbij(som[3].fy, 499.2, "Σ W dwars y"); dichtbij(som[3].fz, 864, "Σ W dwars z"); dichtbij(som[4].fx, 84, "Σ W langs");
  assert.equal(hal.waarschuwingen.length, 0);
  ok("standaardparameters: 165 knopen, 340 staven, 22 inklemmingen, 13 + 412 lasten; belastingsom = hand");
}

// ── 2. Lessenaarsdak, scharnierende voeten ───────────────────────────────────
const LESSENAAR = {
  lengteMm: 36000, breedteMm: 18000, aantalVakken: 6, goothoogteMm: 6000,
  dak: { type: "lessenaarsdak", nokhoogteMm: 7800 }, gordingafstandMm: 2000, kolomvoet: "scharnierend",
  lasten: { dakafwerkingKnM2: 0.4, sneeuwKnM2: 0.7, wind: { drukKnM2: 0.7, zuigingKnM2: 0.45, dakZuigingKnM2: 0.5 } },
};
{
  const hal = maakStaalhal(LESSENAAR);
  // 7 spanten × (2 + 10) = 84 knopen; 14 + 7·9 + 6·10 + 2·9·2 + 2·2·2 = 181 staven;
  // 60 gordingen × 3 lasten + 14 kolommen = 194 staaflasten.
  assert.deepEqual(aantallen(hal), [84, 181, 14, 0, 10, 194]);
  const hoog = hal.model.nodes.filter((n) => n.y === 18);
  assert.ok(hoog.every((n) => n.z === 0 || Math.abs(n.z - 7.8) < 1e-9), "hoge zijde op 7,8 m");
  assert.ok(hal.model.supports.every((s) => s.ux && s.uy && s.uz && !s.rx && !s.ry && !s.rz), "scharnierende voeten");
  ok("lessenaarsdak 36 × 18 m: 84 knopen, 181 staven, 14 scharnieren; hoge zijde 7,8 m");
}

// ── 3. Plat dak, aantal vakken, eigen verbandvakken ───────────────────────────
{
  const hal = maakStaalhal({
    lengteMm: 40000, breedteMm: 20000, aantalVakken: 5, goothoogteMm: 7000, dak: { type: "platdak" },
    gordingafstandMm: 3000, verbanden: { vakken: [5, 1, 3, 3] },
  });
  // ⌈20/3⌉ = 7 velden → 8 dakknopen; 6 × 10 = 60 knopen;
  // 12 + 6·7 + 5·8 + 3·7·2 + 3·2·2 = 148 staven; 40 × 3 + 12 = 132 staaflasten.
  assert.deepEqual(aantallen(hal), [60, 148, 12, 0, 8, 132]);
  assert.deepEqual(hal.samenvatting.maten.verbandvakken, [1, 3, 5], "vakken gesorteerd en ontdubbeld");
  assert.ok(hal.model.nodes.every((n) => n.z === 0 || n.z === 7), "plat dak op 7 m");
  dichtbij(hal.samenvatting.maten.gordingafstandMm, 20000 / 7, "werkelijke gordingafstand", 1e-9);
  ok("plat dak 40 × 20 m, 5 vakken, verbanden in vak 1, 3 en 5: 60 knopen, 148 staven");
}

// ── 4. Spantafstand als maximum, helling in graden ───────────────────────────
{
  const hal = maakStaalhal({ lengteMm: 50000, spantafstandMm: 6000, dak: { type: "zadeldak", hellingGraden: 10 } });
  assert.equal(hal.parameters.aantalVakken, 9, "⌈50/6⌉ = 9 vakken");
  dichtbij(hal.samenvatting.maten.spantafstandMm, 50000 / 9, "spantafstand", 1e-9);
  dichtbij(hal.parameters.dak.nokhoogteMm, 8000 + Math.tan(10 * Math.PI / 180) * 15000, "nok uit 10°", 1e-9);
  assert.equal(hal.waarschuwingen.length, 0, "10° valt nog binnen de projectiegrens");
  const steil = maakStaalhal({ dak: { type: "zadeldak", hellingGraden: 20 } });
  assert.equal(steil.waarschuwingen.length, 1, "20° krijgt de waarschuwing over lasten per m² projectie");
  ok("spantafstand 6 m over 50 m → 9 vakken van 5,556 m; nok uit 10°; waarschuwing bij 20°");
}

// ── 5. De invoerpoort: alles weigeren wat niet deugt ─────────────────────────
{
  const codes = (invoer) => {
    const r = probeerStaalhal(invoer);
    assert.equal(r.ok, false, `${JSON.stringify(invoer)} hoort geweigerd te worden`);
    return r.problemen.map((p) => `${p.code}@${p.veld}`);
  };
  assert.deepEqual(codes({ lengte: 60000 }), ["onbekendVeld@lengte"]);
  assert.deepEqual(codes({ profielen: { kolom: { profile: "HEA 400" } } }), ["onbekendVeld@profielen.kolom.profile"]);
  assert.deepEqual(codes({ fundering: { type: "balkrooster", paalkz: 50 } }), ["onbekendVeld@fundering.paalkz"]);
  assert.deepEqual(codes({ spantafstandMm: 6000, aantalVakken: 10 }), ["spantafstandEnAantal@aantalVakken"]);
  assert.deepEqual(codes({ dak: { type: "zadeldak", nokhoogteMm: 9000, hellingGraden: 5 } }), ["nokEnHelling@dak"]);
  assert.deepEqual(codes({ dak: { type: "zadeldak", nokhoogteMm: 7000 } }), ["nokTeLaag@dak.nokhoogteMm"]);
  assert.deepEqual(codes({ dak: { type: "platdak", nokhoogteMm: 9000 } }), ["ongeldigeKeuze@dak"]);
  assert.deepEqual(codes({ dak: { type: "koepel" } }), ["ongeldigeKeuze@dak.type"]);
  assert.deepEqual(codes({ lengteMm: -5, breedteMm: "30000" }), ["buitenBereik@lengteMm", "geenGetal@breedteMm"]);
  assert.deepEqual(codes({ aantalVakken: 2.5 }), ["geenGeheelGetal@aantalVakken"]);
  assert.deepEqual(codes({ aantalVakken: 101 }), ["buitenBereik@aantalVakken"]);
  assert.deepEqual(codes({ aantalOverspanningen: 0 }), ["buitenBereik@aantalOverspanningen"]);
  assert.deepEqual(codes({ aantalOverspanningen: 2.5 }), ["geenGeheelGetal@aantalOverspanningen"]);
  assert.deepEqual(codes({ aantalOverspanningen: 11 }), ["buitenBereik@aantalOverspanningen"]);
  assert.deepEqual(codes({ spantafstandMm: 100 }), ["teVeelVakken@spantafstandMm"]);
  assert.deepEqual(codes({ gordingafstandMm: 100 }), ["teVeelGordingvelden@gordingafstandMm"]);
  assert.deepEqual(codes({ kolomvoet: "scharnierend", verbanden: { wanden: false } }), ["instabielLangs@verbanden"]);
  assert.deepEqual(codes({ kolomvoet: "scharnierend", verbanden: { vakken: "geen" } }), ["instabielLangs@verbanden"]);
  assert.deepEqual(codes({ profielen: { kolom: { materiaal: "hout" } } }), ["geenStaal@profielen.kolom.materiaal"]);
  assert.deepEqual(codes({ profielen: { kolom: { materiaal: "C24", profiel: "IPE 400" } } }), ["profielOnbekend@profielen.kolom.profiel"]);
  assert.deepEqual(codes({ profielen: { gording: { profiel: "IPE 999" } } }), ["profielOnbekend@profielen.gording.profiel"]);
  assert.deepEqual(codes({ verbanden: { vakken: [0, 11] } }), ["verbandVak@verbanden.vakken", "verbandVak@verbanden.vakken"]);
  assert.deepEqual(codes({ verbanden: { vakken: "sommige" } }), ["ongeldigeKeuze@verbanden.vakken"]);
  assert.deepEqual(codes({ fundering: { type: "balkrooster", betonklasse: "C99/99" } }), ["geenBeton@fundering.betonklasse"]);
  assert.deepEqual(codes({ fundering: { type: "balkrooster", paalAfstandMm: 500 }, lengteMm: 500000, aantalVakken: 100 }),
    ["teVeelPalen@fundering.paalAfstandMm"]);
  assert.deepEqual(codes({ eigenGewicht: "ja" }), ["geenJaNee@eigenGewicht"]);
  assert.deepEqual(codes(["hal"]), ["geenObject@invoer"]);
  // De genormaliseerde parameters lezen zichzelf terug (de wizard en de
  // MCP-tool geven ze door): leesStaalhalInvoer ∘ leesStaalhalInvoer = leesStaalhalInvoer.
  for (const invoer of [{}, LESSENAAR, { dak: { type: "platdak" } }, { dak: { hellingGraden: 12 } },
    { aantalVakken: 7, verbanden: { vakken: [3, 1] }, fundering: { type: "balkrooster" } },
    { aantalOverspanningen: 3, fundering: { type: "balkrooster" } }]) {
    const eenmaal = leesStaalhalInvoer(invoer);
    assert.deepEqual(leesStaalhalInvoer(eenmaal), eenmaal, `idempotent: ${JSON.stringify(invoer)}`);
  }
  // Een fout gooit StaalhalFout met ALLE problemen en een Nederlandse melding.
  assert.throws(() => maakStaalhal({ lengte: 1, kolomvoet: "los" }), (e) =>
    e instanceof StaalhalFout && e.problemen.length === 2 && /Onbekend veld `lengte`/.test(e.message));
  ok("invoerpoort: onbekende velden, typen, bereik, combinaties, profielen, stabiliteit en beton geweigerd met code en veld");
}

// ── 6. Wind uit de stuwdruk (NEN-EN 1991-1-4), met de hand nagerekend ────────
{
  const hal = maakStaalhal({ lasten: { wind: { bron: "stuwdruk", windgebied: "II", terreincategorie: "III", cDak: 0.6 } } });
  // q_p(z = 9,5 m), gebied II (v_b,0 = 27 m/s), terrein III (z0 = 0,3 m):
  const vb = 27, z0 = 0.3, z = 9.5;
  const kr = 0.19 * (z0 / 0.05) ** 0.07;
  const vm = kr * Math.log(z / z0) * vb;
  const qp = (1 + 7 / Math.log(z / z0)) * 0.5 * 1.25 * vm * vm / 1000;
  // c_pe,10 tabel 7.1, lineair tussen h/d = 0,25 en 1: dwars h/d = 9,5/30, langs 9,5/60 (→ rij 0,25).
  const f = (9.5 / 30 - 0.25) / 0.75;
  const dD = 0.7 + 0.1 * f, dE = -0.3 - 0.2 * f;
  const l = hal.samenvatting.lasten;
  dichtbij(l.stuwdruk.qpKnM2, qp, "q_p", 1e-9);
  dichtbij(l.windDwarsDrukKnM2, dD * qp, "druk dwars", 1e-9);
  dichtbij(l.windDwarsZuigingKnM2, -dE * qp, "zuiging dwars", 1e-9);
  dichtbij(l.windLangsDrukKnM2, 0.7 * qp, "druk langs", 1e-9);
  dichtbij(l.dakZuigingKnM2, 0.6 * qp, "dakzuiging", 1e-9);
  ok(`wind uit de stuwdruk: q_p = ${qp.toFixed(3)} kN/m², c_pe D/E dwars ${dD.toFixed(3)}/${dE.toFixed(3)}, langs 0,700`);
}

// ── 7. Balkrooster: indeling en aantallen ────────────────────────────────────
{
  const hal = maakStaalhal({ fundering: { type: "balkrooster" } });
  // Palen: 22 onder de kolommen (spantafstand 6 m = paalafstand, geen tussenpalen
  // langs), onder elk van de 11 dwarsbalken ⌈30/6⌉ − 1 = 4 tussenpalen → 66.
  // Staven: 2 × 10 langs, 11 × 5 dwars, 22 poeren (diepte 800 mm).
  assert.deepEqual(aantallen(hal), [165 + 66, 340 + 20 + 55 + 22, 66, 66, 13, 412]);
  assert.equal(telGroepen(hal).funderingsbalk, 75);
  assert.equal(telGroepen(hal).poer, 22);
  const paal = new Set(hal.samenvatting.paalknopen);
  assert.ok(hal.model.supports.every((s) => paal.has(s.nodeId) && s.springs?.kzKnPerM === 100000
    && s.springs.kxKnPerM === 5000 && s.springs.kyKnPerM === 5000 && !s.ux && !s.uy && !s.uz), "palen als veren");
  assert.ok(hal.model.nodes.filter((n) => paal.has(n.id)).every((n) => Math.abs(n.z + 0.8) < 1e-12), "palen op de systeemlijn");
  const balk = hal.model.beams.find((b) => b.id === hal.samenvatting.groepen.funderingsbalk[0]);
  assert.deepEqual([balk.profileName, balk.material], ["400x600", "C20/25"]);
  const poer = hal.model.beams.find((b) => b.id === hal.samenvatting.groepen.poer[0]);
  assert.equal(poer.rollAngleRad, Math.PI / 2, "poer met de lange zijde in het spantvlak");
  assert.ok(hal.samenvatting.groepen.kolom.every((id) => !hal.model.beams.find((b) => b.id === id).releases), "ingeklemd op het rooster");

  const variant = maakStaalhal({
    kolomvoet: "scharnierend",
    fundering: { type: "balkrooster", dwarsbalken: "kopspanten", diepteMm: 0, paalHorizontaal: "statischBepaald", paalAfstandMm: 3000 },
  });
  // Langs: per vak ⌈6/3⌉ − 1 = 1 tussenpaal → 2 × (11 + 10) = 42; dwars (2 kopspanten):
  // ⌈30/3⌉ − 1 = 9 → 18; samen 60. Rooster op peil: de kolomvoeten zijn zelf roosterknopen,
  // dus 20 + 18 = 38 nieuwe knopen; staven 2 × 20 langs + 2 × 10 dwars, geen poeren.
  assert.deepEqual(aantallen(variant), [165 + 38, 340 + 60, 60, 60, 13, 412]);
  const horizontaal = variant.model.supports.filter((s) => s.ux || s.uy);
  assert.deepEqual(horizontaal.map((s) => [s.ux, s.uy]), [[true, true], [false, true]], "statisch bepaald: u_x+u_y en u_y");
  assert.ok(variant.samenvatting.groepen.kolom.every((id) => {
    const r = variant.model.beams.find((b) => b.id === id).releases;
    return r?.myStart && r.mzStart && !r.torsionStart && !r.myEnd;
  }), "scharnierende kolomvoet als eindscharnier op het rooster");
  assert.equal(variant.waarschuwingen.length, 1, "waarschuwing bij de statisch bepaalde horizontale oplegging");
  ok("balkrooster: 66 palen, 75 balken, 22 poeren; variant op peil, kopspanten, statisch bepaald: 60 palen");
}

// ── 8. Hulpfuncties: projectbestand en gevallen van het project ──────────────
{
  const hal = maakStaalhal({ lengteMm: 24000, breedteMm: 12500, aantalVakken: 4 });
  const project = staalhalProject(hal);
  assert.equal(project.projectInfo.name, "Staalhal 24 × 12,5 m");
  assert.equal(project.modelDimension, "3d");
  const naar = new Map([[1, 11], [2, 12], [3, 13], [4, 14]]);
  const omgezet = metBelastinggevalIds(hal.model, (id) => naar.get(id));
  assert.deepEqual([...new Set([...omgezet.loads, ...omgezet.memberLoads].map((l) => l.caseId))].sort(), [11, 13, 14]
    .concat([12]).sort());
  assert.equal(omgezet.nodes, hal.model.nodes, "geometrie ongemoeid");
  const zonderEg = maakStaalhal({ eigenGewicht: false });
  assert.deepEqual(zonderEg.loadCases.map((c) => c.id), [1, 2, 3, 4]);
  assert.equal(zonderEg.selfWeightEnabled, false);
  ok("projectbestand, omzetting naar de gevallen van een project, hal zonder eigen gewicht");
}
{
  // Stramien: assen 1…11 op de spanten (h.o.h. 6000), A/B op de gevels, en de
  // levels fundering (−800), peil, goot en nok; een plat dak heeft geen nok.
  const hal = maakStaalhal({ fundering: { type: "balkrooster" } });
  assert.deepEqual(hal.stramien.xAxes.map((a) => [a.label, a.position]),
    Array.from({ length: 11 }, (_, i) => [String(i + 1), i * 6000]));
  assert.deepEqual(hal.stramien.yAxes.map((a) => [a.label, a.position]), [["A", 0], ["B", 30000]]);
  assert.deepEqual(hal.stramien.zAxes.map((a) => [a.id, a.position]),
    [["fundering", -800], ["peil", 0], ["goot", 8000], ["nok", 9500]]);
  assert.deepEqual(maakStaalhal({ dak: { type: "platdak" } }).stramien.zAxes.map((a) => a.id), ["peil", "goot"]);
  assert.equal(staalhalProject(hal).structuralGrid, undefined, "zonder optie blijft het projectbestand dat van het voorbeeld");
  assert.deepEqual(staalhalProject(hal, {}, { stramien: true }).structuralGrid, hal.stramien);
  ok("stramien: spanten 1…11, gevels A/B, levels fundering/peil/goot/nok");
}

// ── 8b. Koppelen aan de belastinggevallen van een project (de wizard) ────────
{
  const hal = maakStaalhal({});
  // Een nieuw project: Eigen gewicht (5, gekenmerkt), Permanent (1), Variabel (2),
  // Sneeuw (3), Wind (4). Hergebruikt: 5, 1 en 3 (naam en type gelijk); nieuw: 6 en 7.
  const nieuw = standaardBelastinggevallen();
  const staat = {
    loadCases: nieuw, combinations: defaultCombinations(nieuw), gevolgklasse: "CC2", bijlage: "NL",
    volgendGevalId: 6, volgendCombinatieId: 100,
  };
  const r = zorgVoorBelastinggevallen(staat, hal.loadCases);
  assert.deepEqual(r.ids, [5, 1, 3, 6, 7]);
  assert.deepEqual(r.staat.loadCases.map((c) => [c.id, c.name, c.type]), [
    [5, "Eigen gewicht", "dead"], [1, "Permanent (G)", "dead"], [2, "Variabel (Q)", "live"], [3, "Sneeuw (S)", "snow"],
    [4, "Wind (W)", "wind"], [6, "Wind dwars (W)", "wind"], [7, "Wind langs (W)", "wind"],
  ], "bestaande gevallen blijven staan, twee komen erbij");
  assert.ok(r.staat.combinations.some((c) => (c.factors.get(6) ?? 0) !== 0), "de standaardcombinaties kennen het nieuwe windgeval");
  const nogmaals = zorgVoorBelastinggevallen(r.staat, hal.loadCases);
  assert.deepEqual(nogmaals.ids, r.ids, "tweemaal dezelfde hal: dezelfde gevallen");
  assert.deepEqual(nogmaals.staat.loadCases, r.staat.loadCases);
  // Een oud project zonder gekenmerkt geval: het eigen gewicht verhuist uit het
  // eerste blijvende geval naar een nieuw geval vooraan (aanbod van issue #42).
  const oud = [{ id: 1, name: "Permanent (G)", type: "dead" }, { id: 2, name: "Variabel (Q)", type: "live" }];
  const o = zorgVoorBelastinggevallen({
    loadCases: oud, combinations: defaultCombinations(oud), gevolgklasse: "CC2", bijlage: "NL",
    volgendGevalId: 3, volgendCombinatieId: 100,
  }, hal.loadCases);
  assert.deepEqual(o.ids, [3, 1, 4, 5, 6]);
  assert.deepEqual(o.staat.loadCases[0], { id: 3, name: "Eigen gewicht", type: "dead", eigenGewicht: true });
  ok("koppelen aan de gevallen van een project: hergebruik op naam en type, eigen gewicht op kenmerk, nieuwe ids van de teller");
}

// ── 9. Rekenproef met de 3D-kern ─────────────────────────────────────────────
const solverBinary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${solverBinary}`, import.meta.url));
assert.ok(existsSync(solverPath), "Bouw eerst de Rust-rekenkern (of zet OPEN_FEM_3D_SOLVER_PATH).");
const reken = (request) => new Promise((resolve, reject) => {
  const child = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  const uit = [], fout = [];
  child.stdout.on("data", (d) => uit.push(d));
  child.stderr.on("data", (d) => fout.push(d));
  child.on("error", reject);
  child.on("close", (code) => {
    if (code !== 0) return reject(new Error(`3D-kern: exit ${code}; ${Buffer.concat(uit).toString().slice(0, 400)}${Buffer.concat(fout).toString().slice(0, 400)}`));
    try { resolve(JSON.parse(Buffer.concat(uit).toString())); } catch (e) { reject(e); }
  });
  child.stdin.end(JSON.stringify(request));
});
const som = (r, k) => r.reactions.reduce((t, x) => t + x[k], 0);
/** Σ ρ·A·g·L, met ρ uit de materiaaldata en g = 9,81 m/s². */
const eigenGewicht = (model) => model.beams.reduce((t, b) => {
  const a = model.nodes.find((n) => n.id === b.startNodeId), e = model.nodes.find((n) => n.id === b.endNodeId);
  const rho = dichtheidVanMateriaal(b.material);
  const d = resolveSection(b.material, b.profileName);
  return t + rho * (d.aBruto ?? d.A) * 1e-6 * 9.81 / 1000 * Math.hypot(e.x - a.x, e.y - a.y, e.z - a.z);
}, 0);

async function rekenproef(label, hal, verwacht, extra = () => {}) {
  const model = withOpenFem3DSelfWeight(hal.model, STAALHAL_GEVAL.eigenGewicht);
  for (const [geval, waarden] of Object.entries(verwacht)) {
    const request = { ...buildOpenFem3DSolveRequest(model, "linear", Number(geval)), bucklingModes: 0 };
    const r = await reken(request);
    assert.equal(r.equilibrium?.equilibriumOk, true, `${label} geval ${geval}: kerncontrole evenwicht`);
    assert.equal(openFem3DGlobalForceBalance(request, r).ok, true, `${label} geval ${geval}: onafhankelijke balans`);
    for (const [as, waarde] of Object.entries(waarden)) dichtbij(som(r, as), waarde, `${label} geval ${geval}: ΣR ${as}`);
    extra(Number(geval), r);
  }
}

{
  // Een compacte houten hal, met rechthoekige C24- en GL28h-staven in alle
  // vijf profielgroepen. De steunreacties komen uit de echte 3D-kern.
  const hal = maakStaalhal({ lengteMm: 12000, breedteMm: 8000, aantalVakken: 2,
    dak: { type: "platdak" }, gordingafstandMm: 2000,
    profielen: {
      kolom: { materiaal: "GL28h", profiel: "200x400" },
      spantligger: { materiaal: "GL28h", profiel: "160x400" },
      gording: { materiaal: "C24", profiel: "80x200" },
      randligger: { materiaal: "C24", profiel: "100x200" },
      verband: { materiaal: "C24", profiel: "100x100" },
    },
  });
  assert.ok(hal.model.beams.every((beam) => beam.material === "C24" || beam.material === "GL28h"));
  assert.equal(staalhalProject(hal).projectInfo.name, "Houten hal 12 × 8 m");
  assert.equal(hal.samenvatting.eigenGewichtKn.staal, 0);
  assert.equal(hal.samenvatting.eigenGewichtKn.beton, 0);
  dichtbij(hal.samenvatting.eigenGewichtKn.hout, eigenGewicht(hal.model), "eigen gewicht houten hal", 1e-6);
  await rekenproef("houten hal", hal, {
    1: { fz: 28.8 }, 2: { fz: 53.76 },
    5: { fz: eigenGewicht(hal.model) },
  });
  ok("houten hal: C24 en GL28h, eigen gewicht en evenwicht in de 3D-kern");
}

{
  // Drie gelijke overspanningen van 4 m. De gevraagde maximale
  // gordingafstand is 3 m, maar 6 velden van 2 m zijn nodig om de twee
  // binnenkolommen precies onder een dakknoop te zetten.
  const invoer = { lengteMm: 12000, breedteMm: 12000, aantalVakken: 2,
    dak: { type: "platdak" }, gordingafstandMm: 3000, aantalOverspanningen: 3 };
  const hal = maakStaalhal(invoer);
  assert.deepEqual(aantallen(hal), [33, 76, 12, 0, 7, 48]);
  assert.deepEqual(hal.stramien.yAxes.map((as) => [as.label, as.position]),
    [["A", 0], ["B", 4000], ["C", 8000], ["D", 12000]]);
  assert.equal(hal.samenvatting.maten.aantalGordingvelden, 6);
  assert.equal(hal.samenvatting.maten.gordingafstandMm, 2000);
  assert.equal(hal.samenvatting.groepen.kolom.length, 12);
  for (const beamId of hal.samenvatting.groepen.kolom) {
    const beam = hal.model.beams.find((item) => item.id === beamId);
    const a = hal.model.nodes.find((node) => node.id === beam.startNodeId);
    const b = hal.model.nodes.find((node) => node.id === beam.endNodeId);
    assert.equal(a.y, b.y, "binnenkolom sluit op een dakknoop aan");
  }
  await rekenproef("drie overspanningen op vaste voeten", hal, {
    1: { fz: 43.2 }, 2: { fz: 80.64 }, 3: { fy: -99.84, fz: -69.12 },
  });
  const rooster = maakStaalhal({ ...invoer, fundering: { type: "balkrooster" } });
  assert.deepEqual(aantallen(rooster), [45, 105, 12, 12, 7, 48]);
  assert.equal(new Set(rooster.samenvatting.paalknopen).size, 12, "geen dubbele palen onder kruisingen");
  await rekenproef("drie overspanningen op balkrooster", rooster, { 1: { fz: 43.2 } });
  const gevel = maakStaalhal({ ...invoer, verbanden: { kopgevels: true, trekAlleen: true } });
  assert.equal(gevel.samenvatting.groepen.kopgevelverband.length, 12, "twee diagonalen per vak in twee kopgevels");
  for (const id of gevel.samenvatting.groepen.kopgevelverband) {
    const beam = gevel.model.beams.find((item) => item.id === id);
    const a = gevel.model.nodes.find((node) => node.id === beam.startNodeId);
    const b = gevel.model.nodes.find((node) => node.id === beam.endNodeId);
    assert.equal(Math.abs(a.y - b.y), 4, "kopgevelverband blijft binnen één overspanning");
    assert.equal(beam.tensionOnly, true);
  }
  const zadel = maakStaalhal({ ...invoer, dak: { type: "zadeldak", nokhoogteMm: 8600 } });
  assert.equal(zadel.samenvatting.maten.aantalGordingvelden, 6, "nok en binnenkolommen liggen op dakknooppunten");
  await rekenproef("drie overspanningen met zadeldak", zadel, { 1: { fz: 43.2 } });
  ok("drie gelijke overspanningen: binnenkolommen, stramien, balkrooster en echt 3D-evenwicht");
}

{
  const hal = maakStaalhal({ lengteMm: 12000, breedteMm: 10000, aantalVakken: 2,
    gordingafstandMm: 2500, lasten: { dakgebruikKnM2: 0.4 } });
  const q = hal.loadCases.find((item) => item.id === STAALHAL_GEVAL.dakgebruik);
  assert.deepEqual(q, { id: 6, name: "Dakgebruik (Q)", type: "live", categorie: "H" });
  dichtbij(hal.samenvatting.belastingsom[6].fz, -0.4 * 12 * 10, "dakgebruik: ΣQ");
  assert.ok(hal.model.memberLoads?.filter((item) => item.caseId === 6).length > 0);
  const combinations = defaultCombinations(hal.loadCases);
  assert.ok(combinations.some((item) => item.type === "uls" && (item.factors.get(6) ?? 0) > 0));
  assert.ok(combinations.some((item) => item.type === "sls" && (item.factors.get(6) ?? 0) > 0));
  const request = { ...buildOpenFem3DSolveRequest(hal.model, "linear", 6), bucklingModes: 0 };
  const result = await reken(request);
  assert.equal(result.equilibrium?.equilibriumOk, true);
  assert.equal(openFem3DGlobalForceBalance(request, result).ok, true);
  dichtbij(som(result, "fz"), 48, "dakgebruik: ΣR");
  assert.ok(!maakStaalhal({ lasten: { dakgebruikKnM2: 0 } }).loadCases.some((item) => item.id === 6));
  ok("dakgebruik Q als eigen categorie-H-geval: krachtensom, UGT/BGT en echte 3D-kern");
}

{
  const hal = maakStaalhal({ lengteMm: 12000, breedteMm: 10000, aantalVakken: 2,
    gordingafstandMm: 2500, verbanden: { trekAlleen: true } });
  const verbandIds = [...hal.samenvatting.groepen.dakverband, ...hal.samenvatting.groepen.wandverband];
  assert.ok(verbandIds.length > 0 && verbandIds.every((id) => hal.model.beams.find((beam) => beam.id === id)?.tensionOnly));
  assert.ok(hal.model.beams.filter((beam) => !verbandIds.includes(beam.id)).every((beam) => !beam.tensionOnly));
  assert.equal(hal.model.tensionOnlyCrossRule, true);
  const request = { ...buildOpenFem3DSolveRequest(hal.model, "linear", STAALHAL_GEVAL.windLangs), bucklingModes: 0 };
  assert.equal(request.tensionOnlyCrossRule, true);
  assert.equal(request.members.filter((beam) => beam.tensionOnly).length, verbandIds.length);
  const result = await reken(request);
  assert.equal(result.equilibrium?.equilibriumOk, true, "trek-alleen hal: kernevenwicht");
  assert.equal(openFem3DGlobalForceBalance(request, result).ok, true, "trek-alleen hal: onafhankelijk evenwicht");
  assert.ok(result.diagnostics?.some((line) => line.startsWith("Trek-alleen:")), "kern rekent de trek-alleenstatus");
  ok("dak- en wandverbanden optioneel trek-alleen: echte 3D-kern, kruisregel en evenwicht");
}

{
  const hal = maakStaalhal({ lengteMm: 12000, breedteMm: 10000, aantalVakken: 2,
    gordingafstandMm: 2500, verbanden: { vakken: "geen", dak: false, wanden: false, kopgevels: true, trekAlleen: true } });
  const ids = hal.samenvatting.groepen.kopgevelverband;
  assert.equal(ids.length, 4, "twee diagonalen per kopgevel");
  assert.equal(hal.samenvatting.groepen.dakverband.length, 0);
  assert.equal(hal.samenvatting.groepen.wandverband.length, 0);
  assert.equal(hal.model.tensionOnlyCrossRule, true);
  for (const id of ids) {
    const beam = hal.model.beams.find((item) => item.id === id);
    assert.equal(beam.tensionOnly, true);
    assert.equal(beam.releases.myStart && beam.releases.myEnd && beam.releases.mzStart && beam.releases.mzEnd, true);
    const nodes = [beam.startNodeId, beam.endNodeId].map((nodeId) => hal.model.nodes.find((node) => node.id === nodeId));
    assert.equal(nodes[0].x, nodes[1].x, "verband blijft in kopgevelvlak");
    assert.ok(nodes.some((node) => node.z === 0) && nodes.some((node) => node.z === 8), "diagonaal van voet naar goot");
  }
  const request = { ...buildOpenFem3DSolveRequest(hal.model, "linear", STAALHAL_GEVAL.windDwars), bucklingModes: 0 };
  const result = await reken(request);
  assert.equal(result.equilibrium?.equilibriumOk, true);
  assert.equal(openFem3DGlobalForceBalance(request, result).ok, true);
  ok("optionele trek-alleen kruizen in beide kopgevels: geometrie en 3D-evenwicht");
}

{
  // Lessenaarsdak 36 × 18 m. G 0,4 · 36 · 18 = 259,2; S 0,7 · 648 = 453,6;
  // W dwars: (0,7 · 6 + 0,45 · 7,8) · 36 = 277,56 in +Y, dak 0,5 · 648 = 324 omhoog;
  // W langs: 0,7 · 18 · (6 + 7,8)/2 / 2 = 43,47 in +X.
  const hal = maakStaalhal(LESSENAAR);
  await rekenproef("lessenaarsdak", hal, {
    1: { fx: 0, fy: 0, fz: 259.2 },
    2: { fx: 0, fy: 0, fz: 453.6 },
    3: { fx: 0, fy: -277.56, fz: -324 },
    4: { fx: -43.47, fy: 0, fz: 0 },
    5: { fx: 0, fy: 0, fz: eigenGewicht(hal.model) },
  });
  ok("rekenproef lessenaarsdak: ΣR per geval gelijk aan de hand, evenwicht (kern en onafhankelijk)");
}
{
  // Standaardhal op het balkrooster. De lasten van de hal zijn die van het
  // voorbeeld; het eigen gewicht is staal + beton:
  //   beton q = 2500 · 0,4 · 0,6 · 9,81 / 1000 = 5,886 kN/m over
  //   2 · 60 (langs) + 11 · 30 (dwars) + 22 · 0,8 (poeren) = 467,6 m → 2752,29 kN.
  const hal = maakStaalhal({ fundering: { type: "balkrooster" } });
  const beton = 5.886 * (2 * 60 + 11 * 30 + 22 * 0.8);
  const staal = eigenGewicht(maakStaalhal({}).model);
  const paal = new Set(hal.samenvatting.paalknopen);
  let zij = 0;
  const goot = new Set(hal.model.nodes.filter((n) => Math.abs(n.z - 8) < 1e-9).map((n) => n.id));
  await rekenproef("balkrooster", hal, {
    1: { fx: 0, fy: 0, fz: 540 },
    2: { fx: 0, fy: 0, fz: 1008 },
    3: { fx: 0, fy: -499.2, fz: -864 },
    4: { fx: -84, fy: 0, fz: 0 },
    5: { fx: 0, fy: 0, fz: staal + beton },
  }, (geval, r) => {
    assert.ok(r.reactions.every((x) => paal.has(x.nodeId)), `geval ${geval}: alleen palen dragen af`);
    zij = Math.max(zij, ...r.displacements.filter((d) => goot.has(d.nodeId)).map((d) => Math.hypot(d.ux, d.uy)));
  });
  dichtbij(hal.samenvatting.eigenGewichtKn.beton, beton, "eigen gewicht beton in het overzicht", 1e-6);
  assert.ok(zij < 8 / 150, `zijverplaatsing goot op het rooster ${(zij * 1000).toFixed(1)} mm ≥ h/150`);
  ok(`rekenproef balkrooster: Σ paalreacties = Σ lasten, eigen gewicht ${(staal + beton).toFixed(1)} kN = staal ${staal.toFixed(1)} + beton ${beton.toFixed(1)}; goot ${(zij * 1000).toFixed(1)} mm < h/150`);
}
{
  // Statisch bepaald: de twee aangewezen palen nemen ALLE horizontale last.
  const hal = maakStaalhal({
    fundering: { type: "balkrooster", dwarsbalken: "kopspanten", diepteMm: 0, paalHorizontaal: "statischBepaald", paalAfstandMm: 3000 },
  });
  const vast = new Set(hal.model.supports.filter((s) => s.ux || s.uy).map((s) => s.nodeId));
  await rekenproef("statisch bepaald", hal, {
    3: { fx: 0, fy: -499.2, fz: -864 },
    4: { fx: -84, fy: 0, fz: 0 },
  }, (geval, r) => {
    for (const x of r.reactions) {
      if (!vast.has(x.nodeId)) assert.ok(x.fx === 0 && x.fy === 0, `geval ${geval}: paal ${x.nodeId} heeft geen horizontale reactie`);
    }
  });
  ok("rekenproef statisch bepaalde horizontale oplegging: alleen de twee aangewezen palen nemen horizontale last");
}

console.log(`${geslaagd} geslaagd, 0 gefaald`);
console.log("staalhalgenerator: geslaagd");

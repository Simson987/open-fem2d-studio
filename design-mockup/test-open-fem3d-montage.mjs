// Trek-alleen staven gemonteerd na de permanente belasting, de kruisregel en
// het eigen gewicht van trek-alleen staven als knooplasten (kabelwerking),
// vanaf het app-model:
//  1. modelinstellingen: alleen true wordt bewaard, een niet-boolean wordt
//     geweigerd, aan en uit, en het projectbestand heen en terug;
//  2. de verzoekopbouw: tensionOnlyFit uit de blijvende gevallen met factor
//     1,0, met eigen gewicht en belastingvlakken van die gevallen en zonder de
//     andere gevallen; zonder instelling of trek-alleen staven geen veld;
//  3. kabelwerking: het eigen gewicht van een trek-alleen staaf als twee
//     gelijke knooplasten, ΣRz gelijk aan het totale gewicht, geen moment;
//  4. rekenen via de Rust-kern: onder G alleen zijn de strips spanningsloos en
//     actief met Δ0 = −s·P·h/(E·A); G + W geeft dezelfde N als W alleen;
//     zonder instelling vallen beide strips onder G weg;
//  5. de kruisregel via de app: grote G, kleine W, N uit de stijfheid;
//  6. het bedieningskanaal (model_3d_bouwen) met de twee instellingen.
//
// Bouw eerst de kern: cd src-tauri && cargo build -p open-fem-3d (of zet
// OPEN_FEM_3D_SOLVER_PATH).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { parseOpenFem3DModel, withOpenFem3DSelfWeight } from "./src/components/openFem3d/openFem3dModel.ts";
import { addOpenFem3DLoadPanel } from "./src/components/openFem3d/openFem3dLoadPanels.ts";
import {
  buildOpenFem3DSolveRequest, openFem3DGlobalForceBalance, OPEN_FEM_3D_CABLE_SELF_WEIGHT_NOTICE,
  withOpenFem3DCableSelfWeightNotice,
} from "./src/components/openFem3d/openFem3dSolver.ts";
import { setOpenFem3DTensionOnlySetting } from "./src/components/openFem3d/openFem3dTrekSchijf.ts";
import { deserializeProject, serializeProject } from "./src/io/projectFile.ts";
import { G, RHO_STAAL, resolveSection } from "./src/lib/sectionResolver.ts";

let geslaagd = 0;
const ok = (waar, naam) => { assert.ok(waar, naam); geslaagd++; console.log(`  ✓ ${naam}`); };
const gelijk = (werkelijk, verwacht, naam, relatief = 1e-9, absoluut = 1e-9) => {
  const verschil = Math.abs(werkelijk - verwacht);
  assert.ok(verschil <= Math.max(absoluut, Math.abs(verwacht) * relatief),
    `${naam}: berekend ${werkelijk}, verwacht ${verwacht} (verschil ${verschil})`);
  geslaagd++;
  console.log(`  ✓ ${naam}`);
};

const E = 210_000 * 1000; // kN/m²
const A = (profiel) => resolveSection("S235", profiel).A * 1e-6; // m², uit de profieltabel
const gewicht = (profiel, lengte) => RHO_STAAL * G * A(profiel) * lengte / 1000; // kN
const scharnier = { myStart: true, myEnd: true, mzStart: true, mzEnd: true, torsionStart: false, torsionEnd: false };
const vast = (nodeId) => ({ nodeId, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true });
const voet = (nodeId) => ({ nodeId, ux: true, uy: true, uz: true, rx: true, ry: false, rz: true });
const last = (id, nodeId, fx, fz, caseId) => ({ id, nodeId, fx, fy: 0, fz, mx: 0, my: 0, mz: 0, caseId });

/**
 * Portaal 6 × 4 m in het XZ-vlak: kolommen HEA 200, scharnierende ligger IPE
 * 200, kruis van twee trek-alleen staven RD 24. Geval 1 (G): P op beide
 * koppen; geval 2 (W): H op knoop 3. `voeten`: scharnierend in het vlak of
 * ingeklemd.
 */
const portaal = ({ p, h, voeten = voet, instellingen = {} }) => parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 0, y: 0, z: 4 }, { id: 4, x: 6, y: 0, z: 4 }],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 3, profileName: "HEA 200", material: "S235" },
    { id: 2, startNodeId: 2, endNodeId: 4, profileName: "HEA 200", material: "S235" },
    { id: 3, startNodeId: 3, endNodeId: 4, profileName: "IPE 200", material: "S235", releases: scharnier },
    { id: 4, startNodeId: 1, endNodeId: 4, profileName: "RD 24", material: "S235", releases: scharnier, tensionOnly: true },
    { id: 5, startNodeId: 2, endNodeId: 3, profileName: "RD 24", material: "S235", releases: scharnier, tensionOnly: true },
  ],
  supports: [voeten(1), voeten(2)],
  loads: [last(1, 3, 0, -p, 1), last(2, 4, 0, -p, 1), last(3, 3, h, 0, 2)],
  ...instellingen,
});

console.log("[1] modelinstellingen");
{
  const model = portaal({ p: 100, h: 12 });
  ok(!("tensionOnlyFitAfterPermanent" in model) && !("tensionOnlyCrossRule" in model), "standaard staan beide instellingen uit");
  const aan = setOpenFem3DTensionOnlySetting(setOpenFem3DTensionOnlySetting(model, "tensionOnlyFitAfterPermanent", true), "tensionOnlyCrossRule", true);
  ok(aan.tensionOnlyFitAfterPermanent === true && aan.tensionOnlyCrossRule === true, "aanzetten");
  const uit = setOpenFem3DTensionOnlySetting(aan, "tensionOnlyCrossRule", false);
  ok(!("tensionOnlyCrossRule" in uit) && uit.tensionOnlyFitAfterPermanent === true, "uitzetten laat het veld weg");
  ok(!("tensionOnlyCrossRule" in parseOpenFem3DModel({ ...model, tensionOnlyCrossRule: false })), "false wordt niet bewaard");
  assert.throws(() => parseOpenFem3DModel({ ...model, tensionOnlyFitAfterPermanent: "ja" }), /ongeldige instelling tensionOnlyFitAfterPermanent/);
  ok(true, "een niet-boolean wordt geweigerd");
  const project = (model3d) => ({
    nodes: [], beams: [], supports: [], plates: [], loads: [], loadCases: [{ id: 1, name: "G", type: "dead" }],
    modelDimension: "3d", model3d,
  });
  const terug = deserializeProject(serializeProject(project(aan))).model3d;
  ok(terug.tensionOnlyFitAfterPermanent === true && terug.tensionOnlyCrossRule === true, "projectbestand heen en terug");
}

console.log("\n[2] verzoekopbouw");
{
  // Doos 6 × 4 × 4 m: vier ingeklemde kolommen HEA 200, scharnierende
  // dakliggers IPE 200, een kruis RD 24 in de wand y = 0. Geval 1 (G, blijvend):
  // 10 kN op elke kolomkop en een dakvlak van 2 kN/m²; geval 2 (W): 5 kN in X;
  // geval 3 (Q): 7 kN op knoop 6 en een dakvlak van 3 kN/m²; geval 4: eigen gewicht.
  const knopen = [];
  const hoeken = [[0, 0], [6, 0], [6, 4], [0, 4]];
  hoeken.forEach(([x, y], i) => { knopen.push({ id: i + 1, x, y, z: 0 }); knopen.push({ id: i + 5, x, y, z: 4 }); });
  const kop = (i) => i + 5;
  let doos = parseOpenFem3DModel({
    nodes: knopen.sort((a, b) => a.id - b.id),
    beams: [
      ...[0, 1, 2, 3].map((i) => ({ id: i + 1, startNodeId: i + 1, endNodeId: kop(i), profileName: "HEA 200", material: "S235" })),
      ...[0, 1, 2, 3].map((i) => ({ id: i + 5, startNodeId: kop(i), endNodeId: kop((i + 1) % 4), profileName: "IPE 200", material: "S235", releases: scharnier })),
      { id: 9, startNodeId: 1, endNodeId: 6, profileName: "RD 24", material: "S235", releases: scharnier, tensionOnly: true },
      { id: 10, startNodeId: 2, endNodeId: 5, profileName: "RD 24", material: "S235", releases: scharnier, tensionOnly: true },
    ],
    supports: [1, 2, 3, 4].map(vast),
    loads: [...[5, 6, 7, 8].map((n, i) => last(i + 1, n, 0, -10, 1)), last(5, 5, 5, 0, 2), last(6, 6, 0, -7, 3)],
    tensionOnlyFitAfterPermanent: true,
  });
  doos = addOpenFem3DLoadPanel(doos, [5, 6, 7, 8], { q: 2, direction: "gravity", distribution: "twoWay", caseId: 1 });
  doos = addOpenFem3DLoadPanel(doos, [5, 6, 7, 8], { q: 3, direction: "gravity", distribution: "twoWay", caseId: 3 });
  const rekenmodel = withOpenFem3DSelfWeight(doos, 4);
  const opties = { permanentCaseIds: [1, 4] };
  const eigen = 4 * gewicht("HEA 200", 4) + 2 * (gewicht("IPE 200", 6) + gewicht("IPE 200", 4)) + 2 * gewicht("RD 24", Math.hypot(6, 4));
  const som = (verzoek, lasten) => openFem3DGlobalForceBalance({ ...verzoek, ...lasten }, { reactions: [] }).imbalanceKn;

  const wind = buildOpenFem3DSolveRequest(rekenmodel, "linear", 2, undefined, opties);
  ok(wind.tensionOnlyFit !== undefined, "met de instelling gaat tensionOnlyFit mee");
  ok(JSON.stringify(wind.nodalLoads.map((l) => [l.nodeId, l.fx])) === "[[5,5]]" && wind.memberLoads.length === 0,
    "het rekengeval zelf blijft alleen W");
  const fit = som(wind, wind.tensionOnlyFit);
  // Montagelast = G (4 × 10 kN), het blijvende dakvlak (2 kN/m² × 24 m²) en het eigen gewicht.
  gelijk(fit[2], -(40 + 2 * 24 + eigen), "montagelast in Z = G + dakvlak G + eigen gewicht", 1e-9);
  gelijk(fit[0], 0, "montagelast in X", 0, 1e-9);
  const ids = new Set(wind.tensionOnlyFit.nodalLoads.map((l) => l.id));
  ok(ids.size === wind.tensionOnlyFit.nodalLoads.length, "unieke id's in de montagelasten");
  ok(Object.keys(wind.tensionOnlyFit).sort().join(",") === "memberLoads,memberPointLoads,nodalLoads,thermalLoads",
    "zonder platen geen surfaceLoads in de montagelasten");

  const combinatie = buildOpenFem3DSolveRequest(rekenmodel, "p-delta", new Map([[1, 1.35], [2, 1.5], [3, 1.5], [4, 1.35]]), undefined, opties);
  gelijk(som(combinatie, combinatie.tensionOnlyFit)[2], fit[2], "in een combinatie blijft de montagelast factor 1,0");
  gelijk(som(combinatie, {})[2], -1.35 * (40 + 48 + eigen) - 1.5 * (7 + 3 * 24), "de combinatie zelf rekent met haar factoren", 1e-9);

  ok(!("tensionOnlyFit" in buildOpenFem3DSolveRequest({ ...rekenmodel, tensionOnlyFitAfterPermanent: undefined }, "linear", 2, undefined, opties)),
    "zonder instelling geen tensionOnlyFit");
  const zonderTrekAlleen = { ...rekenmodel, beams: rekenmodel.beams.map(({ tensionOnly: _t, ...beam }) => beam) };
  ok(!("tensionOnlyFit" in buildOpenFem3DSolveRequest(zonderTrekAlleen, "linear", 2, undefined, opties)),
    "zonder trek-alleen staven geen tensionOnlyFit");
  assert.throws(() => buildOpenFem3DSolveRequest(rekenmodel, "linear", 2), /blijvende belastinggevallen ontbreken/);
  ok(true, "aan zonder blijvende gevallen in de aanroep: een duidelijke fout");
  ok(!("tensionOnlyCrossRule" in wind), "kruisregel uit: geen veld");
  ok(buildOpenFem3DSolveRequest({ ...rekenmodel, tensionOnlyCrossRule: true }, "linear", 2, undefined, opties).tensionOnlyCrossRule === true,
    "kruisregel aan: tensionOnlyCrossRule");
}

const solverBinary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${solverBinary}`, import.meta.url));
assert.ok(existsSync(solverPath), "Bouw eerst de 3D-kern: cd src-tauri && cargo build -p open-fem-3d");
const reken = (request) => new Promise((resolve, reject) => {
  const child = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  const uit = [], fout = [];
  child.stdout.on("data", (d) => uit.push(d));
  child.stderr.on("data", (d) => fout.push(d));
  child.on("error", reject);
  child.on("close", () => {
    try { resolve(JSON.parse(Buffer.concat(uit).toString())); }
    catch (error) { reject(new Error(`${error.message}; ${Buffer.concat(fout).toString().slice(0, 400)}`)); }
  });
  child.stdin.end(JSON.stringify(request));
});
const rekenModel = async (model, selection, opties = { permanentCaseIds: [1] }) => {
  const request = { ...buildOpenFem3DSolveRequest(model, "linear", selection, undefined, opties), bucklingModes: 0 };
  const result = await reken(request);
  assert.ok(!result.fout, `kern: ${result.fout}`);
  return { request, result, balans: openFem3DGlobalForceBalance(request, result) };
};
const kracht = (result, id) => result.memberForces.find((f) => f.memberId === id);
const delta = (result, id) => result.tensionOnlyFit.find((f) => f.memberId === id).deltaMm;

console.log("\n[3] kabelwerking: eigen gewicht van trek-alleen staven als knooplasten");
{
  // Twee ingeklemde kolommen HEA 200 (4 m) met een horizontale trekstaaf RD 24
  // van 6 m tussen de koppen. Als scharnierende staaf zou zij onder haar eigen
  // gewicht buigen (q·L²/8 in het midden); als kabel gaat het gewicht ρ·A·g·L
  // half naar elk einde.
  const model = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 0, y: 0, z: 4 }, { id: 4, x: 6, y: 0, z: 4 }],
    beams: [
      { id: 1, startNodeId: 1, endNodeId: 3, profileName: "HEA 200", material: "S235" },
      { id: 2, startNodeId: 2, endNodeId: 4, profileName: "HEA 200", material: "S235" },
      { id: 3, startNodeId: 3, endNodeId: 4, profileName: "RD 24", material: "S235", releases: scharnier, tensionOnly: true },
    ],
    supports: [vast(1), vast(2)],
  });
  const metGewicht = withOpenFem3DSelfWeight(model, 1);
  const wTrek = gewicht("RD 24", 6);
  ok(!(metGewicht.memberLoads ?? []).some((l) => l.beamId === 3), "geen verdeelde last op de trek-alleen staaf");
  const eindlasten = metGewicht.loads.filter((l) => l.nodeId === 3 || l.nodeId === 4).filter((l) => l.fx === 0 && l.fy === 0 && Math.abs(l.fz + wTrek / 2) < 1e-12);
  ok(eindlasten.length === 2 && eindlasten[0].fz === eindlasten[1].fz && eindlasten[0].nodeId !== eindlasten[1].nodeId,
    `twee gelijke knooplasten −ρ·A·g·L/2 = ${(-wTrek / 2).toFixed(6)} kN op begin- en eindknoop`);
  const { result, balans } = await rekenModel(metGewicht, 1);
  const totaal = 2 * gewicht("HEA 200", 4) + wTrek;
  gelijk(result.reactions.reduce((s, r) => s + r.fz, 0), totaal, "ΣRz = gewicht van kolommen en trekstaaf");
  ok(balans.ok, "onafhankelijke kracht- en momentensom sluit");
  ok((result.inactiveMembers ?? []).length === 0, "de trekstaaf doet mee (N = 0, geen druk)");
  const staaf = kracht(result, 3);
  ok([staaf.myStartKnm, staaf.myEndKnm, staaf.mzStartKnm, staaf.mzEndKnm].every((m) => Math.abs(m) < 1e-12), "geen eindmomenten");
  for (const reeks of ["momentY", "momentZ"]) {
    const lijn = result.diagrams[reeks].find((d) => d.memberId === 3);
    ok(lijn.maxAbsValue < 1e-12, `geen ${reeks} langs de trekstaaf (als ligger: q·L²/8 = ${(wTrek / 6 * 36 / 8).toFixed(4)} kNm)`);
  }
}

console.log("\n[4] montage na de permanente belasting via de Rust-kern");
{
  // Scharnierend portaal: zonder strips een mechanisme dat onder verticale last
  // niet opzij gaat. Onder G (P = 100 kN per kop) verkort elke kolom
  // δ = P·h/(E·A); de koorden van beide strips verkorten s·δ, s = 4/√52.
  const p = 100, h = 12;
  const s = 4 / Math.hypot(6, 4);
  const d0 = -s * p * 4 / (E * A("HEA 200")) * 1000; // mm
  const aan = portaal({ p, h, instellingen: { tensionOnlyFitAfterPermanent: true } });
  const g = await rekenModel(aan, 1);
  ok(JSON.stringify(g.result.inactiveMembers) === "[]", "onder G alleen doen beide strips mee");
  for (const id of [4, 5]) {
    gelijk(kracht(g.result, id).nStartKn, 0, `strip ${id}: N ≈ 0 onder G`, 0, 1e-6);
    gelijk(delta(g.result, id), d0, `strip ${id}: Δ0 = −s·P·h/(E·A) = ${d0.toFixed(5)} mm`, 1e-6);
  }
  ok(g.balans.ok, "kracht- en momentensom sluit met de montage (temperatuurlast is in evenwicht)");
  ok(g.result.diagnostics.some((m) => m.startsWith("Montage trek-alleen: 2 van 2")), "melding met het aantal gepaste staven");

  // G + W met montage = W alleen: strip 5 valt weg, strip 4 draagt H·d/L
  // (het portaal met één strip is statisch bepaald).
  const d = Math.hypot(6, 4);
  const gw = await rekenModel(aan, new Map([[1, 1], [2, 1]]));
  const w = await rekenModel(aan, 2);
  ok(JSON.stringify(gw.result.inactiveMembers) === "[5]" && JSON.stringify(w.result.inactiveMembers) === "[5]",
    "G + W en W alleen: dezelfde actieve set");
  gelijk(kracht(gw.result, 4).nStartKn, h * d / 6, "G + W: N strip 4 = H·d/L", 1e-6);
  gelijk(kracht(gw.result, 4).nStartKn, kracht(w.result, 4).nStartKn, "G + W = W alleen (superpositie)", 1e-6);

  // Zonder de instelling drukt de kolomverkorting beide strips. Het portaal
  // wordt dan een mechanisme, maar G stoot de zijdelingse beweging niet aan.
  // GEWIJZIGD door issue #195 (een mechanisme dat de belasting niet aanstoot:
  // een uitkomst met een melding, geen fout). Tot #195 werd het portaal hier
  // afgekeurd. Nu: beide strips inactief, de melding noemt het zwaaien, en de
  // kolommen dragen elk P = 100 kN (ΣR_z = 2·P), zonder zijdelingse uitwijking.
  const uitRequest = { ...buildOpenFem3DSolveRequest(portaal({ p, h }), "linear", 1, undefined, { permanentCaseIds: [1] }), bucklingModes: 0 };
  const uit = await reken(uitRequest);
  const mechanisme = (uit.diagnostics ?? []).find((m) => m.startsWith("Mechanisme:"));
  ok(!uit.fout && JSON.stringify(uit.inactiveMembers) === "[4,5]" && /kunnen samen bewegen in X/.test(mechanisme ?? ""),
    `zonder montage vallen beide strips weg: een uitkomst met de melding over het zwaaien (${uit.fout ?? mechanisme})`);
  gelijk(uit.reactions.reduce((t, r) => t + r.fz, 0), 2 * p, "zonder montage: ΣR_z = 2·P", 1e-9);
  ok(uitRequest.tensionOnlyFit === undefined && uit.tensionOnlyFit === undefined, "zonder montage geen montagevelden");
}

console.log("\n[5] kruisregel via de app");
{
  // Ingeklemde voeten, P = 1000 kN per kop, H = 1 kN. Zonder regel staan beide
  // strips op druk en vallen ze weg; met de regel blijft strip 4 actief (H rekt
  // haar). Met alleen strip 4 actief, in het vlak per kop: kolom k_h = 3EI/h³
  // (kop draait vrij) en k_v = EA/h, ligger k_b = EA/L, strip k_d = EA/L_d:
  //   (k_h + k_b)·u3 − k_b·u4 = H
  //   −k_b·u3 + (k_h + k_b + k_d c²)·u4 + k_d c s·w4 = 0
  //   k_d c s·u4 + (k_v + k_d s²)·w4 = −P
  // en N4 = k_d·(c·u4 + s·w4). Een verticale staaf buigt in het XZ-vlak om
  // haar sterke as (Iy).
  const p = 1000, h = 1;
  const ld = Math.hypot(6, 4), c = 6 / ld, s = 4 / ld;
  const kv = E * A("HEA 200") / 4;
  const kh = 3 * E * resolveSection("S235", "HEA 200").I * 1e-12 / 64;
  const kb = E * A("IPE 200") / 6;
  const kd = E * A("RD 24") / ld;
  const noemer = kh + kb + kd * c * c - kb * kb / (kh + kb) - (kd * c * s) ** 2 / (kv + kd * s * s);
  const u4 = (kb * h / (kh + kb) + kd * c * s * p / (kv + kd * s * s)) / noemer;
  const w4 = (-p - kd * c * s * u4) / (kv + kd * s * s);
  const n4 = kd * (c * u4 + s * w4);
  const zonder = await rekenModel(portaal({ p, h, voeten: vast }), new Map([[1, 1], [2, 1]]));
  ok(JSON.stringify(zonder.result.inactiveMembers) === "[4,5]", "zonder regel vallen beide strips weg");
  const met = await rekenModel(portaal({ p, h, voeten: vast, instellingen: { tensionOnlyCrossRule: true } }), new Map([[1, 1], [2, 1]]));
  ok(met.request.tensionOnlyCrossRule === true, "de instelling gaat mee in het verzoek");
  ok(JSON.stringify(met.result.inactiveMembers) === "[5]" && JSON.stringify(met.result.crossRuleMembers) === "[4]",
    "met de regel blijft strip 4 actief");
  ok(n4 < 0, `de gehouden strip houdt een kleine drukkracht (${n4.toFixed(3)} kN)`);
  gelijk(kracht(met.result, 4).nStartKn, n4, "N strip 4 uit de stijfheid", 1e-6);
  ok(met.balans.ok, "kracht- en momentensom sluit");
  ok(met.result.diagnostics.some((m) => m.startsWith("Kruisregel: 1 kruis(en)") && m.includes("(staaf 4)")), "melding van de kruisregel");
}

console.log("\n[6] bedieningskanaal");
{
  register(
    "data:text/javascript," +
      encodeURIComponent(
        "export async function load(url, ctx, next) {" +
          " if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };" +
          " return next(url, ctx); }",
      ),
  );
  const { voerUit } = await import("./src/bediening/bediening.ts");
  const acties = () => ({
    fem: { nodes: [], beams: [], loads: [], loadCases: [], combinations: [], combinationResults: null },
    modelDimension: "3d",
    openFem3d: {
      model: { nodes: [], beams: [] },
      visibility: { nodes: true, beams: true, structuralGrid: true },
      structuralGrid: { enabled: true, xAxes: [], yAxes: [], zAxes: [] },
      replaceModel(model) { this.model = model; },
      setVisibility() {}, setView() {}, setSelection() {},
    },
    setActiveView() {},
  });
  const voer = async (naam, args, a) => {
    try {
      return await voerUit(naam, args, { current: a }, () => new Promise(() => {}), () => Promise.resolve());
    } catch (fout) {
      return { fout: fout instanceof Error ? fout.message : String(fout) };
    }
  };
  const bouw = {
    nodes: [{ x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }, { x: 0, y: 0, z: 4 }, { x: 6, y: 0, z: 4 }],
    beams: [
      { from: 1, to: 3, profile_name: "HEA 200", material: "S235" },
      { from: 2, to: 4, profile_name: "HEA 200", material: "S235" },
      { from: 1, to: 4, profile_name: "RD 24", material: "S235", tension_only: true },
      { from: 2, to: 3, profile_name: "RD 24", material: "S235", tension_only: true },
    ],
    supports: [{ node: 1, type: "fixed" }, { node: 2, type: "fixed" }],
    tension_only_fit_after_permanent: true,
    tension_only_cross_rule: true,
  };
  const a = acties();
  const antwoord = await voer("model_3d_bouwen", bouw, a);
  ok(!antwoord.fout, `model_3d_bouwen met beide instellingen${antwoord.fout ? `: ${antwoord.fout}` : ""}`);
  ok(antwoord.trekAlleenGemonteerdNaPermanent === true && antwoord.kruisregel === true, "het antwoord noemt de instellingen");
  ok(a.openFem3d.model.tensionOnlyFitAfterPermanent === true && a.openFem3d.model.tensionOnlyCrossRule === true, "de instellingen staan in het model");
  const zonder = await voer("model_3d_bouwen", { ...bouw, tension_only_fit_after_permanent: undefined, tension_only_cross_rule: false }, acties());
  ok(zonder.trekAlleenGemonteerdNaPermanent === false && zonder.kruisregel === false, "weglaten of false: uit");
  const fout = await voer("model_3d_bouwen", { ...bouw, tension_only_cross_rule: "ja" }, acties());
  ok(fout.fout && /ongeldige instelling tensionOnlyCrossRule/.test(fout.fout), `een niet-boolean wordt geweigerd: ${fout.fout}`);
}

console.log("\n[7] melding van de kabelwerking bij de uitkomst");
{
  const model = portaal({ p: 100, h: 12 });
  const uitkomst = { diagnostics: ["kern"] };
  const met = withOpenFem3DCableSelfWeightNotice(uitkomst, model, new Map([[3, 1.35]]), { selfWeightCaseId: 3 });
  ok(met.diagnostics.at(-1) === OPEN_FEM_3D_CABLE_SELF_WEIGHT_NOTICE && OPEN_FEM_3D_CABLE_SELF_WEIGHT_NOTICE.includes("kabelwerking"),
    "een uitkomst met het eigen-gewichtgeval meldt de kabelwerking");
  ok(withOpenFem3DCableSelfWeightNotice(uitkomst, model, 2, { selfWeightCaseId: 3 }) === uitkomst, "zonder eigen gewicht in de uitkomst geen melding");
  ok(withOpenFem3DCableSelfWeightNotice(uitkomst, model, 3, {}) === uitkomst, "zonder eigen-gewichtgeval geen melding");
  const zonderTrekAlleen = { ...model, beams: model.beams.map(({ tensionOnly: _t, ...beam }) => beam) };
  ok(withOpenFem3DCableSelfWeightNotice(uitkomst, zonderTrekAlleen, 3, { selfWeightCaseId: 3 }) === uitkomst, "zonder trek-alleen staven geen melding");
}
console.log(`\n${geslaagd} controles geslaagd.`);

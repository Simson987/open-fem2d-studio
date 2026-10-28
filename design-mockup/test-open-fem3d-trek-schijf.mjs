// Trek-alleen staven en starre schijven in de 3D-rekenroute, en de eigen
// tweede orde (P-Δ) van de adapter, vanaf het app-model:
//  1. modelbewerkingen: trek-alleen aan/uit, een schijf maken en weigeren;
//  2. de verzoekopbouw: tensionOnly alleen als het aan staat, schijven als
//     { id, nodeIds } zonder naam, en geen blokkade meer;
//  3. rekenen via de Rust-kern (target/debug/open-fem-3d): kruisverband
//     H/cos θ, twee kolommen onder een starre vloer, P-Δ-kolom met de
//     onafhankelijke momentensom en het tweede-ordemoment;
//  4. de rapportregels: inactieve trek-alleen staven en α_cr per uitkomst;
//  5. het bedieningskanaal (model_3d_bouwen) met tension_only en diaphragms;
//  6. trek-alleen per belastinggeval en per combinatie, en de staalhal van
//     60 × 30 m in tweede orde (issue #60) met reacties gelijk aan de lasten.
//
// Bouw eerst de kern: cd src-tauri && cargo build -p open-fem-3d (of zet
// OPEN_FEM_3D_SOLVER_PATH).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { parseOpenFem3DModel, withOpenFem3DSelfWeight } from "./src/components/openFem3d/openFem3dModel.ts";
import { resolveSection } from "./src/lib/sectionResolver.ts";
import { deserializeProject } from "./src/io/projectFile.ts";
import { buildOpenFem3DSolveRequest, openFem3DGlobalForceBalance } from "./src/components/openFem3d/openFem3dSolver.ts";
import {
  addOpenFem3DDiaphragm,
  openFem3DDiaphragmOfNode,
  openFem3DStabilityRow,
  openFem3DTensionOnlySummary,
  removeOpenFem3DDiaphragm,
  setOpenFem3DTensionOnly,
} from "./src/components/openFem3d/openFem3dTrekSchijf.ts";

let geslaagd = 0;
const ok = (waar, naam) => { assert.ok(waar, naam); geslaagd++; console.log(`  ✓ ${naam}`); };
const gelijk = (werkelijk, verwacht, naam, relatief = 1e-9, absoluut = 1e-9) => {
  const verschil = Math.abs(werkelijk - verwacht);
  assert.ok(verschil <= Math.max(absoluut, Math.abs(verwacht) * relatief),
    `${naam}: berekend ${werkelijk}, verwacht ${verwacht} (verschil ${verschil})`);
  geslaagd++;
  console.log(`  ✓ ${naam}`);
};

// Portaal 6 × 4 m in het XZ-vlak: scharnierende voeten in het vlak (Ry vrij),
// scharnierende ligger, kruisverband van twee trek-alleen diagonalen.
const scharnier = { myStart: true, myEnd: true, mzStart: true, mzEnd: true, torsionStart: false, torsionEnd: false };
const voet = (nodeId) => ({ nodeId, ux: true, uy: true, uz: true, rx: true, ry: false, rz: true });
const kruisportaal = (h) => parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 0, y: 0, z: 4 }, { id: 4, x: 6, y: 0, z: 4 }],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 3, profileName: "HEA 200", material: "S235" },
    { id: 2, startNodeId: 2, endNodeId: 4, profileName: "HEA 200", material: "S235" },
    { id: 3, startNodeId: 3, endNodeId: 4, profileName: "IPE 200", material: "S235", releases: scharnier },
    { id: 4, startNodeId: 1, endNodeId: 4, profileName: "CHS 88.9x4", material: "S235", releases: scharnier, tensionOnly: true },
    { id: 5, startNodeId: 2, endNodeId: 3, profileName: "CHS 88.9x4", material: "S235", releases: scharnier, tensionOnly: true },
  ],
  supports: [voet(1), voet(2)],
  loads: [{ id: 1, nodeId: 3, fx: h, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
});

console.log("[1] modelbewerkingen");
{
  const model = kruisportaal(12);
  const uit = setOpenFem3DTensionOnly(model, [4], false);
  ok(!("tensionOnly" in uit.beams.find((beam) => beam.id === 4)), "trek-alleen uit laat het veld weg");
  ok(uit.beams.find((beam) => beam.id === 5).tensionOnly === true, "de andere staaf houdt trek-alleen");
  const aan = setOpenFem3DTensionOnly(uit, [3, 4], true);
  ok(aan.beams.filter((beam) => beam.tensionOnly).map((beam) => beam.id).join(",") === "3,4,5", "meer staven tegelijk aan");

  const gemaakt = addOpenFem3DDiaphragm(model, [3, 4], " Dak ");
  ok(gemaakt.ok && gemaakt.id === 1, "schijf van twee knopen op 4 m");
  ok(JSON.stringify(gemaakt.model.diaphragms) === JSON.stringify([{ id: 1, nodeIds: [3, 4], name: "Dak" }]), "schijf met naam");
  ok(openFem3DDiaphragmOfNode(gemaakt.model, 4)?.id === 1, "knoop 4 hoort bij schijf 1");
  const tweede = addOpenFem3DDiaphragm(gemaakt.model, [4, 3]);
  ok(!tweede.ok && tweede.refusal.kind === "alreadyInDiaphragm" && tweede.refusal.diaphragmId === 1, "een knoop in twee schijven wordt geweigerd");
  const scheef = addOpenFem3DDiaphragm(model, [1, 3]);
  ok(!scheef.ok && scheef.refusal.kind === "notLevel" && Math.abs(scheef.refusal.differenceMm - 4000) < 1e-9,
    "knopen op 0 en 4 m: 4000 mm verschil geweigerd");
  const binnen = addOpenFem3DDiaphragm({ ...model, nodes: model.nodes.map((n) => n.id === 4 ? { ...n, z: 4.001 } : n) }, [3, 4]);
  ok(binnen.ok, "1 mm hoogteverschil is toegestaan");
  ok(!addOpenFem3DDiaphragm(model, [3]).ok, "één knoop is geen schijf");
  ok(!addOpenFem3DDiaphragm(model, [3, 99]).ok, "een ontbrekende knoop wordt geweigerd");
  ok((removeOpenFem3DDiaphragm(gemaakt.model, 1).diaphragms ?? []).length === 0, "schijf verwijderen");
}

console.log("\n[2] verzoekopbouw");
{
  const model = { ...kruisportaal(12), diaphragms: [{ id: 7, nodeIds: [3, 4], name: "Dak" }] };
  const verzoek = buildOpenFem3DSolveRequest(parseOpenFem3DModel(model), "p-delta");
  ok(verzoek.members.filter((m) => m.tensionOnly === true).map((m) => m.id).join(",") === "4,5", "trek-alleen gaat mee");
  ok(verzoek.members.filter((m) => !m.tensionOnly).every((m) => !("tensionOnly" in m)), "zonder trek-alleen geen veld");
  ok(JSON.stringify(verzoek.diaphragms) === JSON.stringify([{ id: 7, nodeIds: [3, 4] }]), "schijf als { id, nodeIds }, zonder naam");
  const zonder = buildOpenFem3DSolveRequest(kruisportaal(12), "linear");
  ok(!("diaphragms" in zonder), "zonder schijven geen veld");
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
const rekenModel = async (model, analysis, bucklingModes = 0, selection = undefined) => {
  const request = { ...buildOpenFem3DSolveRequest(model, analysis, selection), bucklingModes };
  const result = await reken(request);
  assert.ok(!result.fout, `kern: ${result.fout}`);
  return { request, result, balans: openFem3DGlobalForceBalance(request, result) };
};
const kracht = (result, id) => result.memberForces.find((f) => f.memberId === id).nStartKn;
const verplaatsing = (result, id) => result.displacements.find((d) => d.nodeId === id);

console.log("\n[3] rekenen via de kern");
{
  // Zonder verband is het raam een mechanisme: de diagonaal op trek draagt
  // H/cos θ = H·d/L met d = √(6² + 4²) = 7,2111 m; bij H = 12 kN 14,4222 kN.
  const d = Math.hypot(6, 4);
  for (const [h, trek, druk] of [[12, 4, 5], [-12, 5, 4]]) {
    const { result, balans } = await rekenModel(kruisportaal(h), "linear");
    ok(JSON.stringify(result.inactiveMembers) === JSON.stringify([druk]), `H = ${h}: staaf ${druk} op druk, inactief`);
    gelijk(kracht(result, trek), Math.abs(h) * d / 6, `H = ${h}: N staaf ${trek} = H·d/L`);
    ok(kracht(result, druk) === 0 && result.diagrams.axial.some((lijn) => lijn.memberId === druk && lijn.maxAbsValue === 0),
      `H = ${h}: inactieve staaf met N = 0 en een nul-lijn`);
    ok(balans.ok, `H = ${h}: onafhankelijke kracht- en momentensom sluit`);
  }

  // Twee ingeklemde kolommen (3 m) zonder ligger, alleen verbonden door een
  // starre vloer: gelijke verplaatsing, verdeling naar stijfheid. Voor een
  // verticale staaf is lokaal z = globaal X, dus buiging om Iy (sterke as):
  // u = H·h³/(3E(Iy₁ + Iy₂)), V_i = H·Iy_i/(Iy₁ + Iy₂).
  const vloer = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 5, y: 0, z: 0 }, { id: 3, x: 0, y: 0, z: 3 }, { id: 4, x: 5, y: 0, z: 3 }],
    beams: [
      { id: 1, startNodeId: 1, endNodeId: 3, profileName: "HEA 200", material: "S235" },
      { id: 2, startNodeId: 2, endNodeId: 4, profileName: "HEA 300", material: "S235" },
    ],
    supports: [1, 2].map((nodeId) => ({ nodeId, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true })),
    loads: [{ id: 1, nodeId: 3, fx: 30, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
    diaphragms: [{ id: 1, nodeIds: [3, 4] }],
  });
  const { request, result, balans } = await rekenModel(vloer, "linear");
  const iy = (id) => request.sections.find((s) => s.id === request.members.find((m) => m.id === id).sectionId).iyM4;
  const som = iy(1) + iy(2);
  const u = 30 * 27 / (3 * 210e6 * som);
  gelijk(verplaatsing(result, 3).ux, u, "kolom 1: u = H·h³/(3E·ΣIy)", 1e-8, 1e-12);
  gelijk(verplaatsing(result, 4).ux, u, "kolom 2: dezelfde verplaatsing", 1e-8, 1e-12);
  gelijk(result.reactions.find((r) => r.nodeId === 1).fx, -30 * iy(1) / som, "V₁ = H·Iy₁/ΣIy", 1e-8);
  gelijk(result.reactions.find((r) => r.nodeId === 2).fx, -30 * iy(2) / som, "V₂ = H·Iy₂/ΣIy", 1e-8);
  ok(balans.ok && result.equilibrium?.residualOk === true, "evenwicht en gereduceerd residu");

  // Ingeklemde kolom van 4 m (HEA 200, 8 delen) onder P en H in tweede orde.
  // De momentensom in de onvervormde stand is daar het tweede-ordemoment:
  // Σ N·(e_x × Δu) = −P·δ·ŷ (N = −P, e_x = ẑ, Δu = δ·x̂ aan de kop).
  const kolom = parseOpenFem3DModel({
    nodes: Array.from({ length: 9 }, (_, i) => ({ id: i + 1, x: 0, y: 0, z: i * 0.5 })),
    beams: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, startNodeId: i + 1, endNodeId: i + 2, profileName: "HEA 200", material: "S235" })),
    supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
    loads: [{ id: 1, nodeId: 9, fx: 5, fy: 0, fz: -300, mx: 0, my: 0, mz: 0 }],
  });
  const tweede = await rekenModel(kolom, "p-delta", 1);
  const delta = verplaatsing(tweede.result, 9).ux;
  ok(tweede.result.secondOrder?.converged === true && tweede.result.secondOrder?.stable === true, "P-Δ convergeert en is stabiel");
  gelijk(tweede.balans.secondOrderMomentKnm[1], -300 * delta, "tweede-ordemoment = −P·δ om Y", 1e-9, 1e-12);
  ok(tweede.balans.ok, "onafhankelijke kracht- en momentensom sluit met het tweede-ordemoment");
  const zonderCorrectie = openFem3DGlobalForceBalance(tweede.request, { reactions: tweede.result.reactions });
  ok(!zonderCorrectie.ok && Math.abs(zonderCorrectie.momentImbalanceKnm[1] + 300 * delta) < 1e-6,
    "zonder tweede-ordemoment wijkt de momentensom precies P·δ af");
  const knik = tweede.result.buckling.modes[0].loadFactor;
  ok(knik > 1, `α_cr = ${knik.toFixed(3)} > 1`);

  console.log("\n[4] rapportregels");
  // Tweede orde met trek-alleen: één inactieve diagonaal, α_cr uit de kern.
  const portaal = { ...kruisportaal(12), loads: [
    { id: 1, nodeId: 3, fx: 12, fy: 0, fz: -50, mx: 0, my: 0, mz: 0 },
    { id: 2, nodeId: 4, fx: 0, fy: 0, fz: -50, mx: 0, my: 0, mz: 0 },
  ] };
  const pd = await rekenModel(parseOpenFem3DModel(portaal), "p-delta", 1);
  ok(pd.result.inactiveMembers?.length === 1 && pd.result.tensionOnlyRounds >= 3,
    `P-Δ: één diagonaal inactief, ${pd.result.tensionOnlyRounds} statusrondes (lineair en tweede orde)`);
  ok(pd.balans.ok, "P-Δ met trek-alleen: evenwicht sluit");
  const samenvatting = openFem3DTensionOnlySummary(portaal, pd.result);
  ok(samenvatting.total === 2 && samenvatting.inactive === 1, "samenvatting: 1 van 2 trek-alleen staven inactief");
  const regel = openFem3DStabilityRow(portaal, pd.result);
  ok(regel.inactiveTensionOnly === 1 && regel.alphaCr === pd.result.buckling.modes[0].loadFactor,
    `rapportregel: α_cr ${regel.alphaCr.toFixed(3)}, 1 inactief`);
  ok(regel.firstOrderSufficient === (regel.alphaCr >= 10), "eerste orde volstaat alleen bij α_cr ≥ 10 (EN 1993-1-1 5.2.1)");
  ok(openFem3DStabilityRow(vloer, result).inactiveTensionOnly === null, "zonder trek-alleen staven geen telling");
  ok(openFem3DTensionOnlySummary(vloer, result) === null, "zonder trek-alleen staven geen samenvatting");
}

console.log("\n[5] bedieningskanaal");
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
      { from: 1, to: 4, profile_name: "CHS 88.9x4", material: "S235", tension_only: true },
    ],
    supports: [{ node: 1, type: "fixed" }, { node: 2, type: "fixed" }],
    diaphragms: [{ nodes: [3, 4], name: "Dak" }],
  };
  const a = acties();
  const uit = await voer("model_3d_bouwen", bouw, a);
  ok(!uit.fout, `model_3d_bouwen met tension_only en diaphragms${uit.fout ? `: ${uit.fout}` : ""}`);
  ok(JSON.stringify(uit.diaphragmIds) === "[1]" && uit.aantalTrekAlleen === 1, "het antwoord noemt de schijf en de trek-alleen staaf");
  ok(a.openFem3d.model.beams[2].tensionOnly === true && !("tensionOnly" in a.openFem3d.model.beams[0]), "trek-alleen alleen op staaf 3");
  ok(JSON.stringify(a.openFem3d.model.diaphragms) === JSON.stringify([{ id: 1, nodeIds: [3, 4], name: "Dak" }]), "schijf in het model");
  const dubbel = await voer("model_3d_bouwen", { ...bouw, diaphragms: [{ nodes: [3, 4] }, { nodes: [4, 1] }] }, acties());
  ok(dubbel.fout && /hoogstens één schijf/.test(dubbel.fout), `een knoop in twee schijven geweigerd: ${dubbel.fout}`);
  const geenBoolean = await voer("model_3d_bouwen", { ...bouw, beams: [{ ...bouw.beams[0], tension_only: "ja" }, ...bouw.beams.slice(1)] }, acties());
  ok(geenBoolean.fout && /trek-alleen/.test(geenBoolean.fout), `tension_only moet een boolean zijn: ${geenBoolean.fout}`);
}

console.log("\n[6] per belastinggeval, per combinatie, en de staalhal in tweede orde");
{
  // Geval 1: H = 12 kN in +X; geval 2: H = 12 kN in −X. Elk geval en elke
  // combinatie krijgt zijn eigen set actieve staven: 1,0·G1 + 0,25·G2 geeft
  // netto 9 kN in +X, dus staaf 5 valt weg en staaf 4 draagt 9·d/L.
  const d = Math.hypot(6, 4);
  const model = parseOpenFem3DModel({
    ...kruisportaal(12),
    loads: [
      { id: 1, nodeId: 3, caseId: 1, fx: 12, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 },
      { id: 2, nodeId: 3, caseId: 2, fx: -12, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 },
    ],
  });
  const geval1 = await rekenModel(model, "linear", 0, 1);
  const geval2 = await rekenModel(model, "linear", 0, 2);
  const lineair = await rekenModel(model, "linear", 0, new Map([[1, 1], [2, 0.25]]));
  const combinatie = await rekenModel(model, "p-delta", 1, new Map([[1, 1], [2, 0.25]]));
  ok(JSON.stringify(geval1.result.inactiveMembers) === "[5]" && JSON.stringify(geval2.result.inactiveMembers) === "[4]",
    "geval 1 laat staaf 5 vallen, geval 2 staaf 4");
  ok(JSON.stringify(lineair.result.inactiveMembers) === "[5]" && JSON.stringify(combinatie.result.inactiveMembers) === "[5]",
    "de combinatie heeft haar eigen set: staaf 5 inactief, lineair en in tweede orde");
  gelijk(kracht(lineair.result, 4), 9 * d / 6, "combinatie lineair: N staaf 4 = 9·d/L", 1e-9);
  // In tweede orde staat kolom 2 onder 9·h/L = 6 kN druk (de verticale
  // component van de diagonaal); die leunende kolom vraagt P·δ/h extra van het
  // verband. Met δ ≈ 0,1 mm is dat orde 6·10⁻⁴/(9·4) ≈ 2·10⁻⁵ relatief.
  gelijk(kracht(combinatie.result, 4), 9 * d / 6, "combinatie in tweede orde: N staaf 4 ≈ 9·d/L (+ P-Δ van de leunende kolom)", 1e-4);
  ok(kracht(combinatie.result, 4) > kracht(lineair.result, 4), "de tweede orde vergroot de verbandkracht");
  ok(combinatie.balans.ok, "combinatie: evenwicht sluit");

  // De staalhal (docs/verificatie/3d-raamwerk/staalhal-60x30.ifcfem,
  // 165 knopen, 340 staven) in tweede orde onder 1,2·(EG + G) + 1,5·W dwars.
  // Handgetallen uit test-open-fem3d-staalhal.mjs: W dwars geeft 499,2 kN in
  // +Y en 864 kN omhoog, G 540 kN omlaag; EG = Σ ρ·A·g·L. ΣR moet daaraan
  // gelijk zijn, ook in tweede orde.
  const project = deserializeProject(readFileSync(fileURLToPath(
    new URL("../docs/verificatie/3d-raamwerk/staalhal-60x30.ifcfem", import.meta.url)), "utf8"));
  const egCase = project.loadCases.find((item) => item.eigenGewicht).id;
  const hal = withOpenFem3DSelfWeight(project.model3d, egCase);
  const lengte = (beam) => {
    const a = hal.nodes.find((n) => n.id === beam.startNodeId), b = hal.nodes.find((n) => n.id === beam.endNodeId);
    return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  };
  const eigenGewicht = hal.beams.reduce((som, beam) => {
    const doorsnede = resolveSection("S235", beam.profileName);
    return som + 7850 * (doorsnede.aBruto ?? doorsnede.A) * 1e-6 * 9.81 / 1000 * lengte(beam);
  }, 0);
  const factoren = new Map([[egCase, 1.2], [1, 1.2], [3, 1.5]]);
  const start = performance.now();
  const halUitkomst = await rekenModel(hal, "p-delta", 1, factoren);
  const ms = performance.now() - start;
  const som = (as) => halUitkomst.result.reactions.reduce((totaal, reactie) => totaal + reactie[as], 0);
  ok(halUitkomst.result.secondOrder?.converged === true && halUitkomst.result.secondOrder?.stable === true,
    `staalhal: P-Δ convergeert in ${halUitkomst.result.secondOrder?.iterations} iteraties (${ms.toFixed(0)} ms)`);
  gelijk(som("fy"), -1.5 * 499.2, "staalhal: ΣRy = −1,5 · 499,2 kN", 1e-9, 1e-6);
  gelijk(som("fz"), 1.2 * (eigenGewicht + 540) - 1.5 * 864, "staalhal: ΣRz = 1,2·(EG + 540) − 1,5·864 kN", 1e-9, 1e-6);
  gelijk(som("fx"), 0, "staalhal: ΣRx = 0", 0, 1e-6);
  ok(halUitkomst.balans.ok, "staalhal: onafhankelijke kracht- en momentensom sluit (met het tweede-ordemoment)");
  ok(halUitkomst.result.buckling.status === "available" && halUitkomst.result.buckling.modes[0].loadFactor > 1,
    `staalhal: α_cr = ${halUitkomst.result.buckling.modes[0]?.loadFactor.toFixed(2)}`);
}

console.log(`\n${geslaagd} geslaagd, 0 gefaald`);

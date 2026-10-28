// Metselwerkwand met openingen en latei (issue #97), langs de API, het
// rekennet en de 3D-kern (orthotrope wandplaat, #79/#97).
//
// Handberekeningen (γ = 20 kN/m³, t = 0,1 m, wand 6 × 2,7 m in het XZ-vlak):
//  [3] Wand zonder opening op een vrij opgelegde HEA 200 (L = 6 m). Met
//      E horizontaal ≈ 0 werkt de wand niet mee: M = (γ·t·h + q_balk)·L²/8,
//      ΣR = (γ·t·h + q_balk)·L.
//  [4] Opening 1,2 × 1,2 m (onderkant 0,9 m, bovenkant 2,1 m; 0,6 m metselwerk
//      erboven) met latei HEA 100 en 0,1 m oplegging. Het rekenmodel legt de
//      volle hoogte op de latei. Over de dagmaat draagt de latei
//      (γ·t·0,6 + q_latei)·1,2 kN. Het moment ligt tussen q·L0²/8 en
//      q·(L0 + 2b)²/8 (oplegging over de opleglengte verdeeld).
//  [5] Dezelfde wand op de slappe balk: de latei koppelt de penanten niet
//      (knoopkoppelingen), dus M_balk = de wand als last. Met gedeelde knopen
//      werkte de latei als drukstaaf en kwam M_balk 7,8 % te laag uit.
//  [2] Lateibelasting voor de toets: een driehoek van 60° op L = L0 + b = 1,3 m
//      is 1,3·√3/2 = 1,126 m hoog. Met 0,6 m metselwerk erboven valt de toets
//      terug op de volle hoogte. Met 1,5 m erboven: W = γ·t·L·h_d/2 = 1,4636 kN,
//      M = W·L/6 = 0,3171 kNm, V = W/2.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { register as registreerLader } from "node:module";
import { fileURLToPath } from "node:url";

// Het bedieningskanaal importeert componenten met stylesheets; Node kent die niet.
registreerLader(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function load(url, ctx, next) {" +
        " if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };" +
        " return next(url, ctx); }",
    ),
);

const stil = console.log;
console.log = (...args) => { if (!String(args[0] ?? "").startsWith("[TriangleService]")) stil(...args); };

const { maakRegister } = await import("./src/api/register.ts");
const { leegDocument, model3dVan } = await import("./src/api/projectDocument.ts");
const { MODEL3D_GEOMETRIE_COMMANDOS } = await import("./src/api/commands/model3dGeometrie.ts");
const { parseOpenFem3DModel, withOpenFem3DSelfWeight } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { meshOpenFem3DPlates } = await import("./src/components/openFem3d/openFem3dPlateMesh.ts");
const { buildOpenFem3DSolveRequest } = await import("./src/components/openFem3d/openFem3dSolver.ts");
const { openFem3DLintelDesign } = await import("./src/components/openFem3d/openFem3dMetselwerkwand.ts");
const { metselwerkUit3d } = await import("./src/lib/metselwerkUit3d.ts");
const { bouwMetselwerkInvoer, leegMetselwerkFormulier } = await import("./src/lib/metselwerkCheckBuilder.ts");
const { serializeProject, deserializeProject, PROJECT_FORMAT_VERSION_3D_MASONRY } = await import("./src/io/projectFile.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; stil(`  ✓ ${naam}${detail ? " — " + detail : ""}`); }
  else { gefaald++; stil(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const dichtbij = (a, b, rel) => Math.abs(a - b) <= rel * Math.abs(b);

const register = maakRegister([...MODEL3D_GEOMETRIE_COMMANDOS]);
const nieuwDocument = () => {
  let doc = leegDocument();
  const doe = (naam, invoer) => {
    const r = register.voerUit(naam, invoer, { document: doc });
    if (r.document) doc = r.document;
    return r.uitkomst;
  };
  const faalt = (naam, invoer) => { try { register.voerUit(naam, invoer, { document: doc }); return null; } catch (e) { return e; } };
  return { doe, faalt, model: () => model3dVan(doc) };
};

const GAMMA = 20, T = 0.1, L = 6, H = 2.7;

/** Wand 6 × 2,7 m op een funderingsbalk HEA 200, met vorkopleggingen. */
function wandOpBalk({ opening, wandTop = H, zonderBalk = false } = {}) {
  const d = nieuwDocument();
  for (const [x, z] of [[0, 0], [L, 0], [L, wandTop], [0, wandTop]]) d.doe("model3d.node.add", { x, y: 0, z });
  d.doe("model3d.plate.add", { nodeIds: [1, 2, 3, 4], thicknessM: T, material: "C20/25" });
  if (!zonderBalk) d.doe("model3d.beam.add", { startNodeId: 1, endNodeId: 2, profileName: "HEA 200", material: "S235" });
  if (opening) {
    const [s0, s1, z0, z1] = opening;
    const ids = [[s0, z0], [s1, z0], [s1, z1], [s0, z1]].map(([x, z]) => d.doe("model3d.node.add", { x, y: 0, z }).node.id);
    d.doe("model3d.plate.addOpening", { plateId: 1, nodeIds: ids });
  }
  return d;
}

function opleggen(model) {
  return {
    ...model,
    supports: [
      { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: false, rz: false },
      { nodeId: 2, ux: false, uy: true, uz: true, rx: true, ry: false, rz: false },
    ],
  };
}

const solverBinary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${solverBinary}`, import.meta.url));
assert.ok(existsSync(solverPath), "Bouw eerst de Rust-rekenkern (cargo build -p open-fem-3d).");
const reken = (request) => new Promise((resolve, reject) => {
  const child = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  const uit = [], fout = [];
  child.stdout.on("data", (b) => uit.push(b));
  child.stderr.on("data", (b) => fout.push(b));
  child.on("error", reject);
  child.on("close", (code) => {
    const tekst = Buffer.concat(uit).toString();
    if (code !== 0) return reject(new Error(`3D-kern: exit ${code}; ${tekst.slice(0, 600)} ${Buffer.concat(fout).toString().slice(0, 300)}`));
    try { resolve(JSON.parse(tekst)); } catch (e) { reject(e); }
  });
  child.stdin.end(JSON.stringify(request));
});

async function rekenEigenGewicht(model, { zonderOpleggingen = false } = {}) {
  const metGewicht = withOpenFem3DSelfWeight(zonderOpleggingen ? model : opleggen(model), 1);
  const mesh = await meshOpenFem3DPlates(metGewicht);
  const request = { ...buildOpenFem3DSolveRequest(metGewicht, "linear", 1, mesh), bucklingModes: 0 };
  const result = await reken(request);
  const qStaaf = (beamId) => metGewicht.memberLoads.filter((l) => l.beamId === beamId).reduce((s, l) => s + l.qStart, 0);
  return { request, result, qStaaf };
}

const momentVan = (result, memberId) => [...result.diagrams.momentY, ...result.diagrams.momentZ]
  .filter((d) => d.memberId === memberId).reduce((m, d) => Math.max(m, d.maxAbsValue), 0);

stil("[1] API: metselwerkwand en latei");
{
  const d = wandOpBalk({ opening: [2.4, 3.6, 0.9, 2.1] });
  const wand = { unitWeightKnM3: GAMMA, eMpa: 5000 };
  d.doe("model3d.plate.setMasonry", { plateId: 1, masonry: wand });
  check("setMasonry zet de wand", JSON.stringify(d.model().plates[0].masonry) === JSON.stringify(wand));
  check("tikfout in de wand → INVOER_ONGELDIG", d.faalt("model3d.plate.setMasonry", { plateId: 1, masonry: { unitWeight: 20, eMpa: 5000 } })?.code === "INVOER_ONGELDIG");
  const uit = d.doe("model3d.plate.setLintel", { plateId: 1, openingId: 1, lintel: { bearingM: 0.1, loadSpread: "triangle60", profileName: "HEA 100" } });
  const beamId = uit.opening.lintel.beamId;
  const latei = d.model().beams.find((b) => b.id === beamId);
  const knoop = (id) => d.model().nodes.find((n) => n.id === id);
  check("de latei is een staaf van 2,3 tot 3,7 m op 2,1 m", latei && Math.abs(knoop(latei.startNodeId).x - 2.3) < 1e-9
    && Math.abs(knoop(latei.endNodeId).x - 3.7) < 1e-9 && knoop(latei.startNodeId).z === 2.1 && latei.profileName === "HEA 100");
  check("lateiontwerp valt terug op volle hoogte (0,6 m < 1,126 m)", uit.design.applied === "fullHeight" && /60°/.test(uit.design.note ?? ""),
    `h_d = ${uit.design.triangleHeightM.toFixed(3)} m`);
  const rond = parseOpenFem3DModel(JSON.parse(JSON.stringify(d.model())));
  check("bewaren en lezen behoudt wand en latei", JSON.stringify(rond.plates[0].masonry) === JSON.stringify(wand)
    && rond.plates[0].openings[0].lintel.beamId === beamId);
  const tekst = serializeProject({ modelDimension: "3d", model3d: d.model(), nodes: [], beams: [], supports: [], plates: [], loads: [], loadCases: [] });
  check("projectbestand: formaatversie 12 (metselwerk)", JSON.parse(tekst).version === PROJECT_FORMAT_VERSION_3D_MASONRY && PROJECT_FORMAT_VERSION_3D_MASONRY === 12);
  check("projectbestand: terug te lezen", deserializeProject(tekst).model3d.plates[0].openings[0].lintel.beamId === beamId);
  const ander = d.doe("model3d.plate.setLintel", { plateId: 1, openingId: 1, lintel: { bearingM: 0.2, loadSpread: "fullHeight" } });
  check("andere opleglengte: dezelfde staaf, nieuwe eindpunten", ander.opening.lintel.beamId === beamId
    && Math.abs(knoop(d.model().beams.find((b) => b.id === beamId).startNodeId).x - 2.2) < 1e-9);
  check("oplegging buiten de wand → geweigerd", d.faalt("model3d.plate.setLintel", { plateId: 1, openingId: 1, lintel: { bearingM: 3, loadSpread: "fullHeight" } }) !== null);
  d.doe("model3d.beam.delete", { id: beamId });
  check("staaf weg → latei weg", !("lintel" in d.model().plates[0].openings[0]));
  // Een horizontale plaat kan geen metselwerkwand zijn.
  const v = nieuwDocument();
  for (const [x, y] of [[0, 0], [4, 0], [4, 3], [0, 3]]) v.doe("model3d.node.add", { x, y, z: 0 });
  v.doe("model3d.plate.add", { nodeIds: [1, 2, 3, 4], thicknessM: 0.2 });
  check("vloer als metselwerkwand → geweigerd", /verticaal/.test(v.faalt("model3d.plate.setMasonry", { plateId: 1, masonry: wand })?.message ?? ""));
}

stil("\n[1b] bedieningskanaal (model_3d_bouwen) met plates[].masonry");
{
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
    try { return await voerUit(naam, args, { current: a }, () => new Promise(() => {}), () => Promise.resolve()); }
    catch (fout) { return { fout: fout instanceof Error ? fout.message : String(fout) }; }
  };
  const bouw = (masonry) => ({
    nodes: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 0, z: 2.7 }, { x: 0, y: 0, z: 2.7 }],
    beams: [], plates: [{ nodes: [1, 2, 3, 4], thickness_m: 0.1, masonry }], supports: [{ node: 1, type: "fixed" }],
  });
  const a = acties();
  const antwoord = await voer("model_3d_bouwen", bouw({ unit_weight_kn_m3: 19, e_mpa: 4000 }), a);
  check("model_3d_bouwen zet de metselwerkwand in modelvorm", !antwoord.fout
    && JSON.stringify(a.openFem3d.model.plates[0].masonry) === JSON.stringify({ unitWeightKnM3: 19, eMpa: 4000 }), antwoord.fout ?? "");
  const tik = await voer("model_3d_bouwen", bouw({ unit_weight: 19, e_mpa: 4000 }), acties());
  check("tikfout in masonry → geweigerd", /onbekend veld/.test(tik.fout ?? ""), tik.fout ?? "");
}

stil("\n[2] lateibelasting voor de toets (driehoek 60°)");
{
  const d = wandOpBalk({ opening: [2.4, 3.6, 0.2, 1.2] });
  d.doe("model3d.plate.setMasonry", { plateId: 1, masonry: { unitWeightKnM3: GAMMA, eMpa: 5000 } });
  d.doe("model3d.plate.setLintel", { plateId: 1, openingId: 1, lintel: { bearingM: 0.1, loadSpread: "triangle60" } });
  const plaat = d.model().plates[0];
  const ontwerp = openFem3DLintelDesign(d.model(), plaat, plaat.openings[0]);
  const Lt = 1.3, hd = Lt * Math.sqrt(3) / 2, W = GAMMA * T * Lt * hd / 2;
  check("driehoek toegepast (1,5 m ≥ 1,126 m)", ontwerp.applied === "triangle60");
  check("W = γ·t·L·h_d/2", dichtbij(ontwerp.loadKn, W, 1e-12), `${ontwerp.loadKn.toFixed(4)} kN (hand ${W.toFixed(4)})`);
  check("M = W·L/6, V = W/2", dichtbij(ontwerp.momentKnm, W * Lt / 6, 1e-12) && dichtbij(ontwerp.supportKn, W / 2, 1e-12),
    `M = ${ontwerp.momentKnm.toFixed(4)} kNm`);
  const q = GAMMA * T * 1.5;
  check("modelwaarde: volle hoogte q·L²/8", dichtbij(ontwerp.modelMomentKnm, q * Lt * Lt / 8, 1e-12), `${ontwerp.modelMomentKnm.toFixed(4)} kNm`);
}

stil("\n[3] wand zonder opening op een funderingsbalk");
{
  const d = wandOpBalk();
  d.doe("model3d.plate.setMasonry", { plateId: 1, masonry: { unitWeightKnM3: GAMMA, eMpa: 5000 } });
  const { request, result, qStaaf } = await rekenEigenGewicht(d.model());
  const o = request.plates[0].orthotropy;
  check("orthotropie in het verzoek: Ey = E, Ex = 1e-6·E, G = 0,4·E", o.eYMpa === 5000 && o.eXMpa === 5000e-6 && o.gXyMpa === 2000);
  const vlak = request.surfaceLoads.find((s) => s.plateId === 1);
  check("eigen gewicht γ·t", dichtbij(-vlak.qzKnPerM2, GAMMA * T, 1e-12), `${(-vlak.qzKnPerM2).toFixed(6)} kN/m²`);
  const q = GAMMA * T * H - qStaaf(1);
  const R = result.reactions.reduce((s, r) => s + r.fz, 0);
  check("ΣR = (γ·t·h + q_balk)·L", dichtbij(R, q * L, 1e-6), `${R.toFixed(4)} kN (hand ${(q * L).toFixed(4)})`);
  const M = momentVan(result, 1);
  check("de wand werkt niet mee: M_balk = q·L²/8 (1 %)", dichtbij(M, q * L * L / 8, 0.01), `${M.toFixed(3)} kNm (hand ${(q * L * L / 8).toFixed(3)})`);
}

stil("\n[4] wand met opening en latei op een stijve fundering: volle hoogte op de latei");
{
  const d = wandOpBalk({ opening: [2.4, 3.6, 0.9, 2.1], zonderBalk: true });
  d.doe("model3d.plate.setMasonry", { plateId: 1, masonry: { unitWeightKnM3: GAMMA, eMpa: 5000 } });
  const beamId = d.doe("model3d.plate.setLintel", { plateId: 1, openingId: 1, lintel: { bearingM: 0.1, loadSpread: "fullHeight", profileName: "HEA 100" } }).opening.lintel.beamId;
  // De onderrand ligt op een stijve fundering (randoplegging op rand 0).
  d.doe("model3d.plate.update", { id: 1, edgeSupports: [{ edge: 0, ux: true, uy: true, uz: true, rx: true, ry: false, rz: false }] });
  const { result, qStaaf } = await rekenEigenGewicht(d.model(), { zonderOpleggingen: true });
  const wandGewicht = GAMMA * T * (L * H - 1.2 * 1.2);
  const R = result.reactions.reduce((s, r) => s + r.fz, 0);
  const totaal = wandGewicht - qStaaf(beamId) * 1.4;
  check("ΣR = wand − opening + latei", dichtbij(R, totaal, 1e-6), `${R.toFixed(4)} kN (hand ${totaal.toFixed(4)})`);
  const q = GAMMA * T * 0.6 - qStaaf(beamId);
  const M = momentVan(result, beamId);
  const ondergrens = q * 1.2 ** 2 / 8, bovengrens = q * 1.4 ** 2 / 8;
  check("lateimoment tussen q·L0²/8 en q·(L0+2b)²/8", M >= ondergrens * 0.98 && M <= bovengrens * 1.02,
    `${M.toFixed(4)} kNm (${ondergrens.toFixed(4)} … ${bovengrens.toFixed(4)})`);
  const V = [...result.diagrams.shearY, ...result.diagrams.shearZ].filter((x) => x.memberId === beamId)
    .reduce((m, x) => Math.max(m, x.maxAbsValue), 0);
  check("lateidwarskracht ≈ q·L0/2 (10 %)", dichtbij(V, q * 1.2 / 2, 0.1), `${V.toFixed(4)} kN (hand ${(q * 0.6).toFixed(4)})`);
}

stil("\n[5] dezelfde wand op de slappe funderingsbalk: de latei koppelt de penanten niet");
{
  // Hand: balk 6 m vrij opgelegd. Wand γ·t·h = 5,4 kN/m buiten de opening,
  // 1,8 kN/m onder de opening (borstwering 0,9 m). De latei brengt het
  // metselwerk boven de dagmaat (2·0,6·1,2 = 1,44 kN) en haar eigen gewicht
  // naar de opleggingen (hart op 2,35 en 3,65 m). Daarbij komt het eigen
  // gewicht van de balk. M_midden = R_A·3 − Σ F·arm.
  const d = wandOpBalk({ opening: [2.4, 3.6, 0.9, 2.1] });
  d.doe("model3d.plate.setMasonry", { plateId: 1, masonry: { unitWeightKnM3: GAMMA, eMpa: 5000 } });
  const beamId = d.doe("model3d.plate.setLintel", { plateId: 1, openingId: 1, lintel: { bearingM: 0.1, loadSpread: "fullHeight", profileName: "HEA 100" } }).opening.lintel.beamId;
  const { request, result, qStaaf } = await rekenEigenGewicht(d.model());
  check("de latei hangt met knoopkoppelingen aan de wand (alleen de eerste ook langs de wand)",
    request.nodeLinks?.length > 2 && request.nodeLinks.filter((k) => k.ux).length === 1 && request.nodeLinks.every((k) => k.uz && k.uy && k.rx));
  const qb = -qStaaf(1), latei = (GAMMA * T * 0.6 * 1.2 - qStaaf(beamId) * 1.4) / 2;
  const wand = [[GAMMA * T * H, 0, 2.4], [GAMMA * T * 0.9, 2.4, 3]];
  const RA = wand.reduce((s, [q, a, b]) => s + q * (b - a), 0) + latei + qb * 3;
  const hand = RA * 3 - wand.reduce((s, [q, a, b]) => s + q * (b - a) * (3 - (a + b) / 2), 0) - latei * (3 - 2.35) - qb * 3 * 1.5;
  const Mbalk = momentVan(result, 1);
  check("funderingsbalk: M zoals de wand als last (1,5 %)", dichtbij(Mbalk, hand, 0.015), `${Mbalk.toFixed(3)} kNm (hand ${hand.toFixed(3)})`);
}

stil("\n[6] koppeling naar de metselwerktoets (#98)");
{
  // Wand op een stijve fundering met opening en latei; N per meter uit n_yy.
  // Een rij elementen op hoogte z draagt γ·t·(h − z) buiten de opening.
  const d = wandOpBalk({ opening: [2.4, 3.6, 0.9, 2.1], zonderBalk: true });
  d.doe("model3d.plate.setMasonry", { plateId: 1, masonry: { unitWeightKnM3: GAMMA, eMpa: 5000 } });
  d.doe("model3d.plate.setLintel", { plateId: 1, openingId: 1, lintel: { bearingM: 0.1, loadSpread: "fullHeight", profileName: "HEA 100" } });
  d.doe("model3d.plate.update", { id: 1, edgeSupports: [{ edge: 0, ux: true, uy: true, uz: true, rx: true, ry: false, rz: false }] });
  const { result } = await rekenEigenGewicht(d.model(), { zonderOpleggingen: true });
  const uit = metselwerkUit3d(d.model(), 1, result);
  const f = uit.formulier;
  const rijOnder = 0.1; // strook van één elementgrootte aan de voet
  check("geometrie t = 100 mm, h = 2,7 m, l = 6 m", f.t === "100" && f.h === "2.7" && f.l === "6");
  // Het maatgevende element onderin is een penant naast de opening: daar komt
  // ook de lateilast bij. Ondergrens: de volle wand op die hoogte.
  check("N onder ≥ γ·t·(h − z_rij)", Number(f.nOnder) >= GAMMA * T * (H - rijOnder) * 0.999, `${f.nOnder} kN/m (wand ${(GAMMA * T * (H - rijOnder)).toFixed(2)})`);
  const top = uit.niveaus.boven;
  // Aan de kop is de wand bijna onbelast; de kleine, scheve elementen van het
  // driehoeksnet geven daar ruis van enkele tienden kN/m (hand op z = 2,61 m:
  // 0,18 kN/m). Getoetst: de volgorde en minder dan 10 % van N onder.
  check("0 < N boven < N midden en N onder, N boven < 10 % van N onder",
    top.n > 0 && top.n < Math.min(uit.niveaus.midden.n, uit.niveaus.onder.n) && top.n < 0.1 * uit.niveaus.onder.n,
    `${top.n.toFixed(3)} / ${uit.niveaus.midden.n.toFixed(3)} / ${uit.niveaus.onder.n.toFixed(3)} kN/m`);
  // Onder de lateioplegging (0,1 m) spreidt de last nauwelijks (E horizontaal
  // ≈ 0): daar is N per meter het grootst.
  check("N midden ≥ γ·t·h/2 (penant naast de opening)", uit.niveaus.midden.n >= GAMMA * T * (H / 2 - 0.05) * 0.999,
    `${uit.niveaus.midden.n.toFixed(3)} kN/m`);
  check("lateioplegging: l_b = 100 mm, a1 = 2300 mm, h_c = 2,1 m", f.metGeconcentreerd && f.lB === "100" && f.a1 === "2300" && f.hC === "2.1",
    `N_Edc = ${f.nEdc} kN`);
  const formulier = { ...leegMetselwerkFormulier(), ...f, fb: "20", ndp: { ...leegMetselwerkFormulier().ndp,
    k: { waarde: "0.55", bron: "test" }, gammaM: { waarde: "2.0", bron: "test" } } };
  const bouw = bouwMetselwerkInvoer(formulier);
  check("het formulier bouwt een geldige toetsinvoer", bouw.fouten.length === 0 && bouw.invoer?.geconcentreerd.length === 1,
    JSON.stringify(bouw.fouten));
}

console.log = stil;
stil(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
if (gefaald > 0) process.exit(1);

// Doorgaande lijnen in 3D (issue #207): een staaf die op een knoop zonder
// oplegging, aansluiting, plaat of schijf is geknipt, wordt als ÉÉN staaf
// getoetst, zoals in 2D (lib/doorgaandeLijn.ts). Loopt de lijn door in een
// andere doorsnede, dan is dat eind DOORLOPEND (staal) of krijgt het een
// kanttekening (hout, dat geen doorlopend eind kent).
//
//  [1] de herkenning (zonder kern): wat samengaat en wat niet, met de reden;
//  [2] staal, een gesplitste kolom (scharnierend, 6 m, geknipt op 3 m):
//      L = 6 m en UC 6.3.1 tegen de hand (χ_z bij λ̄_z = 1,606) en gelijk aan
//      de ongesplitste kolom; per deel gaf het 3 m;
//  [3] staal, een gesplitste ligger (IPE 300, 6 m, q = 10 kN/m, geknipt op
//      3 m): de zakking 5qL⁴/(384EI) = 9,62 mm over de hele lijn, de kip-UC
//      gelijk aan de ongesplitste ligger; een tegengesteld getekend deel geeft
//      dezelfde invoer;
//  [4] staal, een kolom die doorloopt in een kleinere doorsnede: geen
//      samenvoeging, beide einden op de knoop DOORLOPEND, de kern toetst niet
//      volledig;
//  [5] hout, een gesplitste kolom: één staaf van 6 m; doorloop in een andere
//      doorsnede: een kanttekening, geen veld (de houtkern kent het niet);
//  [6] de weergave: de UC van de lijn op elk deel.
//
// Met de 3D-kern (OPEN_FEM_3D_SOLVER_PATH, anders
// src-tauri/target/debug/open-fem-3d(.exe)) en de toetsbrug
// (src-tauri/target/release/toetsbrug(.exe)).
//
// Uitvoeren: npx tsx test-open-fem3d-doorgaande-lijn.mjs   (vanuit design-mockup/)
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { solveOpenFem3DCombination } = await import("./src/components/openFem3d/openFem3dSolver.ts");
const { openFem3DDoorgaandeLijnen, openFem3DDoorlopendeEinden } =
  await import("./src/components/openFem3d/openFem3dDoorgaandeLijn.ts");
const { buildOpenFem3DSteelCheckInputs, runOpenFem3DSteelChecks, openFem3DUlsUc } =
  await import("./src/components/openFem3d/openFem3dSteelCheck.ts");
const { buildOpenFem3DTimberCheckInputs } = await import("./src/components/openFem3d/openFem3dTimberCheck.ts");
const { buildOpenFem3DUtilizations } = await import("./src/components/openFem3d/openFem3dUtilization.ts");

let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const binnen = (a, b, rel) => Math.abs(a - b) <= Math.abs(b) * rel;
const JS = (x) => JSON.stringify(x);

// ── De kern en de toetsbrug ────────────────────────────────────────────────
const exe = (naam) => (process.platform === "win32" ? `${naam}.exe` : naam);
const KERN = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${exe("open-fem-3d")}`, import.meta.url));
const TOETSBRUG = fileURLToPath(new URL(`../src-tauri/target/release/${exe("toetsbrug")}`, import.meta.url));
for (const [naam, pad, bouw] of [["3D-kern", KERN, "cargo build -p open-fem-3d"], ["toetsbrug", TOETSBRUG, "cargo build --release -p toetsbrug"]]) {
  if (!existsSync(pad)) {
    log(`  ✗ ${naam} ontbreekt (${pad}). Bouw eerst: ${bouw}`);
    process.exit(1);
  }
}
globalThis.fetch = (url, options) => {
  if (url === "/api/toetsing") {
    const r = spawnSync(TOETSBRUG, [], { input: options.body, maxBuffer: 1 << 28 });
    const tekst = r.stdout.toString();
    return Promise.resolve({
      ok: r.status === 0, status: r.status === 0 ? 200 : 400,
      text: async () => tekst, json: async () => JSON.parse(tekst),
    });
  }
  if (url !== "/api/openFem3d/solve") return Promise.reject(new Error(`onbekende url ${url}`));
  return new Promise((resolve, reject) => {
    const kind = spawn(KERN, [], { stdio: ["pipe", "pipe", "pipe"] });
    const uit = [], fout = [];
    kind.stdout.on("data", (d) => uit.push(d));
    kind.stderr.on("data", (d) => fout.push(d));
    kind.on("error", reject);
    kind.on("close", (code) => {
      const tekst = Buffer.concat(uit).toString();
      resolve({
        ok: code === 0, status: code === 0 ? 200 : 500,
        json: async () => (tekst ? JSON.parse(tekst) : { fout: Buffer.concat(fout).toString().slice(0, 600) }),
      });
    });
    kind.stdin.end(options.body);
  });
};

const UGT = { id: 1, name: "UGT", type: "uls", formula: "1,0·Q", factors: new Map([[1, 1]]) };
const BGT = { id: 2, name: "BGT", type: "sls", formula: "1,0·Q", factors: new Map([[1, 1]]) };
/** Reken UGT en BGT lineair en geef de combinatieset zoals de app hem aan de bouwers geeft. */
async function reken(model) {
  const results = new Map();
  for (const c of [UGT, BGT]) results.set(c.id, await solveOpenFem3DCombination(model, c.factors, "linear", null));
  return { result: results.get(1), set: { combinations: [UGT, BGT], results, loadCases: [{ id: 1, type: "live" }], consequenceClass: "CC2" } };
}
const vast = (nodeId, extra = {}) => ({ nodeId, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false, ...extra });
const staaf = (id, a, b, profileName, material = "S235", extra = {}) => ({ id, startNodeId: a, endNodeId: b, profileName, material, ...extra });
const ucVan = (res, id, checkId) => res.results.find((r) => r.beam_id === id)?.checks.find((c) => c.id === checkId)?.kind.data.uc?.uc;

// ── [1] herkenning ─────────────────────────────────────────────────────────
log("[1] herkenning: wat samengaat en wat niet");
{
  const kolom = (extra = {}) => parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 3 }, { id: 3, x: 0, y: 0, z: 6 }, { id: 4, x: 4, y: 0, z: 3 }],
    beams: [staaf(1, 1, 2, "HEA 160"), staaf(2, 2, 3, "HEA 160"), ...(extra.beams ?? [])],
    supports: [vast(1, { rz: true }), vast(3, { uz: false }), ...(extra.supports ?? [])],
    loads: [], ...(extra.model ?? {}),
  });
  const l = openFem3DDoorgaandeLijnen(kolom());
  check("kolom 0–3–6 m zonder iets op 3 m: één lijn (staaf 1 en 2), tussenknoop 2, 6 m",
    l.length === 1 && l[0].id === 1 && JS(l[0].delen.map((d) => d.beam.id)) === "[1,2]" && JS(l[0].tussenknopen) === "[2]"
    && Math.abs(l[0].lengteM - 6) < 1e-12 && l[0].startNodeId === 1 && l[0].endNodeId === 3, JS(l));
  check("een staaf die op 3 m aansluit: geen lijn", openFem3DDoorgaandeLijnen(kolom({ beams: [staaf(3, 2, 4, "IPE 200")] })).length === 0);
  check("een oplegging op 3 m: geen lijn", openFem3DDoorgaandeLijnen(kolom({ supports: [vast(2)] })).length === 0);
  check("een starre schijf op 3 m: geen lijn",
    openFem3DDoorgaandeLijnen(kolom({ model: { diaphragms: [{ id: 1, nodeIds: [2, 4] }] } })).length === 0);
  const ander = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 3 }, { id: 3, x: 0, y: 0, z: 6 }],
    beams: [staaf(1, 1, 2, "HEA 200"), staaf(2, 2, 3, "HEA 160")],
    supports: [vast(1, { rz: true }), vast(3, { uz: false })], loads: [],
  });
  check("een andere doorsnede: geen lijn", openFem3DDoorgaandeLijnen(ander).length === 0);
  const d = openFem3DDoorlopendeEinden(ander);
  const d1 = d(ander.beams[0]), d2 = d(ander.beams[1]);
  check("… staaf 1 eindigt DOORLOPEND op knoop 2, staaf 2 begint er DOORLOPEND, met de reden",
    !d1.begin && d1.eind && d2.begin && !d2.eind && /andere doorsnede \(HEA 200 en HEA 160\)/.test(d1.redenen.join(" ")), JS([d1, d2]));
  const scharnier = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 3 }, { id: 3, x: 0, y: 0, z: 6 }],
    beams: [staaf(1, 1, 2, "HEA 160", "S235", { releases: { myStart: false, mzStart: false, torsionStart: false, myEnd: true, mzEnd: true, torsionEnd: false } }),
      staaf(2, 2, 3, "HEA 160")],
    supports: [vast(1, { rz: true }), vast(3, { uz: false })], loads: [],
  });
  check("een scharnier op de knoop: geen lijn, wel doorlopend",
    openFem3DDoorgaandeLijnen(scharnier).length === 0 && openFem3DDoorlopendeEinden(scharnier)(scharnier.beams[0]).eind);
  const gedraaid = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 3 }, { id: 3, x: 0, y: 0, z: 6 }],
    beams: [staaf(1, 1, 2, "HEA 160"), staaf(2, 2, 3, "HEA 160", "S235", { rollAngleRad: Math.PI / 2 })],
    supports: [vast(1, { rz: true }), vast(3, { uz: false })], loads: [],
  });
  check("een deel 90° om de as gedraaid (andere stand): geen lijn, met de reden",
    openFem3DDoorgaandeLijnen(gedraaid).length === 0
    && /andere stand/.test(openFem3DDoorlopendeEinden(gedraaid)(gedraaid.beams[0]).redenen.join(" ")));
  const omgekeerd = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 3 }, { id: 3, x: 0, y: 0, z: 6 }],
    beams: [staaf(5, 1, 2, "HEA 160"), staaf(4, 3, 2, "HEA 160")],
    supports: [vast(1, { rz: true }), vast(3, { uz: false })], loads: [],
  });
  const lo = openFem3DDoorgaandeLijnen(omgekeerd);
  // De lijnrichting is die van het eerste deel zoals het getekend is (hier
  // staaf 4, van knoop 3 naar 2); staaf 5 staat daartegen in.
  check("een tegengesteld getekend deel: één lijn met het laagste nummer (4), staaf 5 met s_x = −1 en s_y = −1",
    lo.length === 1 && lo[0].id === 4 && lo[0].startNodeId === 3 && lo[0].endNodeId === 1
    && JS(lo[0].delen.map((d) => [d.beam.id, d.sx, d.sy, d.sz])) === "[[4,1,1,1],[5,-1,-1,1]]", JS(lo));
}

// ── [2] staal, gesplitste kolom ────────────────────────────────────────────
log("\n[2] staal: een kolom van 6 m, geknipt op 3 m (scharnierend, N = 300 kN)");
// HANDBEREKENING (HEA 160, S235, NEN-EN 1993-1-1 6.3.1): A = 3 880 mm²,
// i_z = 39,8 mm, λ₁ = 93,9; L_cr = 6 000 mm (de hele kolom):
//   λ̄_z = 6000/39,8/93,9 = 1,606; kromme c (α = 0,49):
//   Φ = 0,5·(1 + 0,49·(1,606 − 0,2) + 1,606²) = 2,134; χ_z = 1/(Φ + √(Φ² − λ̄²)) = 0,2826;
//   N_b,Rd = 0,2826·3 880·235 = 257,7 kN → UC = 300/257,7 = 1,164.
// Per deel (L = 3 m, de oude toets) gaf dat UC ≈ 0,50 (basisaudit).
const lambda = 6000 / 39.8 / 93.9;
const fi = 0.5 * (1 + 0.49 * (lambda - 0.2) + lambda ** 2);
const chi = 1 / (fi + Math.sqrt(fi ** 2 - lambda ** 2));
const UC_HAND = 300 / (chi * 3880 * 235 / 1000);
const kolomModel = (gesplitst) => parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, ...(gesplitst ? [{ id: 2, x: 0, y: 0, z: 3 }] : []), { id: 3, x: 0, y: 0, z: 6 }],
  beams: gesplitst ? [staaf(1, 1, 2, "HEA 160"), staaf(2, 2, 3, "HEA 160")] : [staaf(1, 1, 3, "HEA 160")],
  supports: [vast(1, { rz: true }), vast(3, { uz: false })],
  loads: [{ id: 1, nodeId: 3, fx: 0, fy: 0, fz: -300, mx: 0, my: 0, mz: 0, caseId: 1 }],
});
{
  const gesplitst = kolomModel(true), heel = kolomModel(false);
  const rg = await reken(gesplitst), rh = await reken(heel);
  const bouw = buildOpenFem3DSteelCheckInputs(gesplitst, rg.result, rg.set);
  const invoer = bouw.inputs.find((i) => i.beam_id === 1);
  check("één invoer voor de lijn (staaf 1), L = 6 m, beide einden gaffel",
    bouw.inputs.length === 1 && invoer?.length_m === 6 && JS(invoer.staafeinden) === JS({ begin: "Gaffel", eind: "Gaffel" }), JS(bouw.inputs.map((i) => [i.beam_id, i.length_m])));
  check("staaf 2 is overgeslagen met de reden: deel van de lijn die als staaf 1 is getoetst",
    bouw.skipped.some((s) => s.beamId === 2 && /doorgaande lijn die als staaf 1 is getoetst/.test(s.reason)), JS(bouw.skipped));
  check("de krachtlijn loopt over de hele lijn (0 tot 6 000 mm), N = −300 kN overal",
    Math.min(...invoer.forces_envelope.map((p) => p.position_mm)) === 0
    && Math.abs(Math.max(...invoer.forces_envelope.map((p) => p.position_mm)) - 6000) < 1e-6
    && invoer.forces_envelope.every((p) => Math.abs(Math.abs(p.forces.n_ed) - 300) < 1e-6), JS(invoer.forces_envelope.slice(0, 3)));
  check("de notitie DOORGAANDE LIJN noemt de staven en de tussenknoop",
    invoer.staaf_notities.some((n) => /^DOORGAANDE LIJN\. Deze staaf is de doorgaande lijn van de staven 1, 2/.test(n) && /tussenknoop 2/.test(n)));
  const sg = await runOpenFem3DSteelChecks(gesplitst, rg.result, rg.set);
  const sh = await runOpenFem3DSteelChecks(heel, rh.result, rh.set);
  const ug = ucVan(sg, 1, "6.3.1_buckling"), uh = ucVan(sh, 1, "6.3.1_buckling");
  check(`UC 6.3.1 van de lijn = ${ug?.toFixed(4)}: de hand ${UC_HAND.toFixed(4)} (L_cr = 6 m)`, binnen(ug, UC_HAND, 5e-3), String(ug));
  check(`… en gelijk aan de ongesplitste kolom (${uh?.toFixed(4)})`, binnen(ug, uh, 1e-9), `${ug} ${uh}`);
  const weergave = buildOpenFem3DUtilizations(sg, null, null);
  check("[6] de weergave: staaf 1 én staaf 2 krijgen de UC van de lijn",
    weergave.length === 2 && weergave.every((w) => binnen(w.uc, openFem3DUlsUc(sg.results[0]), 1e-12)), JS(weergave));
}

// ── [3] staal, gesplitste ligger ───────────────────────────────────────────
log("\n[3] staal: een ligger IPE 300 van 6 m, geknipt op 3 m, q = 10 kN/m");
// HANDBEREKENING: w = 5·q·L⁴/(384·E·I_y) = 5·10·6000⁴/(384·210 000·83,56·10⁶) = 9,617 mm.
// Per deel (de koorde van 3 m) was de gemeten veldzakking vrijwel nul.
const W_HAND = 5 * 10 * 6000 ** 4 / (384 * 210000 * 83.56e6);
const liggerModel = (soort) => {
  const delen = soort === "heel" ? [staaf(1, 1, 3, "IPE 300")]
    : soort === "omgekeerd" ? [staaf(1, 1, 2, "IPE 300"), staaf(2, 3, 2, "IPE 300")]
      : [staaf(1, 1, 2, "IPE 300"), staaf(2, 2, 3, "IPE 300")];
  const last = (id, beamId, lengte) => ({ id, beamId, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -10, qzEnd: -10, startPositionM: 0, endPositionM: lengte });
  return parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, ...(soort === "heel" ? [] : [{ id: 2, x: 3, y: 0, z: 0 }]), { id: 3, x: 6, y: 0, z: 0 }],
    beams: delen,
    supports: [vast(1, { rx: true }), vast(3, { ux: false, rx: true })],
    loads: [],
    memberLoads: soort === "heel" ? [last(1, 1, 6)] : [last(1, 1, 3), last(2, 2, 3)],
  });
};
{
  const uit = {};
  for (const soort of ["heel", "gesplitst", "omgekeerd"]) {
    const m = liggerModel(soort);
    const r = await reken(m);
    uit[soort] = { m, r, invoer: buildOpenFem3DSteelCheckInputs(m, r.result, r.set).inputs, toets: await runOpenFem3DSteelChecks(m, r.result, r.set) };
  }
  const g = uit.gesplitst.invoer.find((i) => i.beam_id === 1), h = uit.heel.invoer[0], o = uit.omgekeerd.invoer.find((i) => i.beam_id === 1);
  check(`gesplitst: zakking ${Math.abs(g.deflection_actual_max_mm).toFixed(3)} mm over de hele lijn = 5qL⁴/(384EI) = ${W_HAND.toFixed(3)} mm`,
    binnen(Math.abs(g.deflection_actual_max_mm), W_HAND, 2e-3), String(g.deflection_actual_max_mm));
  check("… gelijk aan de ongesplitste ligger", binnen(g.deflection_actual_max_mm, h.deflection_actual_max_mm, 1e-6),
    `${g.deflection_actual_max_mm} ${h.deflection_actual_max_mm}`);
  const kg = ucVan(uit.gesplitst.toets, 1, "6.3.2_ltb"), kh = ucVan(uit.heel.toets, 1, "6.3.2_ltb");
  check(`kip-UC van de lijn ${kg?.toFixed(4)} = die van de ongesplitste ligger ${kh?.toFixed(4)} (één kipveld van 6 m)`,
    kg !== undefined && binnen(kg, kh, 1e-6), `${kg} ${kh}`);
  const station = (inv, x) => inv.forces_envelope.filter((p) => Math.abs(p.position_mm - x) < 1e-6 && p.combination_id === 1);
  const mMidden = station(g, 3000).map((p) => p.forces.my_ed);
  check("M_y op 3 m = qL²/8 = 45 kNm (in de waarde, beide kanten van de knoop)",
    mMidden.length >= 1 && mMidden.every((m) => binnen(Math.abs(m), 45, 1e-6)), JS(mMidden));
  check("een tegengesteld getekend tweede deel: dezelfde krachtlijn (positie, N, V, M) als de gelijk getekende",
    g.forces_envelope.length === o.forces_envelope.length
    && g.forces_envelope.every((p, i) => {
      const q = o.forces_envelope[i];
      return Math.abs(p.position_mm - q.position_mm) < 1e-6
        && ["n_ed", "vy_ed", "vz_ed", "mt_ed", "my_ed", "mz_ed"].every((k) => Math.abs(p.forces[k] - q.forces[k]) < 1e-6);
    }), JS([g.forces_envelope.slice(-3), o.forces_envelope.slice(-3)]));
  check("… en dezelfde zakking", binnen(o.deflection_actual_max_mm, g.deflection_actual_max_mm, 1e-9),
    `${o.deflection_actual_max_mm} ${g.deflection_actual_max_mm}`);
}

// ── [4] staal, doorloop in een kleinere doorsnede ─────────────────────────
log("\n[4] staal: een kolom HEA 200 (0–3 m) die doorloopt in HEA 160 (3–6 m)");
{
  const m = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 3 }, { id: 3, x: 0, y: 0, z: 6 }],
    beams: [staaf(1, 1, 2, "HEA 200"), staaf(2, 2, 3, "HEA 160")],
    supports: [vast(1, { rz: true }), vast(3, { uz: false })],
    loads: [{ id: 1, nodeId: 3, fx: 0, fy: 0, fz: -300, mx: 0, my: 0, mz: 0, caseId: 1 }],
  });
  const r = await reken(m);
  const bouw = buildOpenFem3DSteelCheckInputs(m, r.result, r.set);
  const i1 = bouw.inputs.find((i) => i.beam_id === 1), i2 = bouw.inputs.find((i) => i.beam_id === 2);
  check("twee invoeren van 3 m, niet samengevoegd", bouw.inputs.length === 2 && i1?.length_m === 3 && i2?.length_m === 3);
  check("staaf 1: eind DOORLOPEND; staaf 2: begin DOORLOPEND",
    JS(i1.staafeinden) === JS({ begin: "Gaffel", eind: "Doorlopend" }) && JS(i2.staafeinden) === JS({ begin: "Doorlopend", eind: "Gaffel" }),
    JS([i1.staafeinden, i2.staafeinden]));
  check("… met de kanttekening die de knoop, de andere staaf en de doorsneden noemt",
    i1.staaf_notities.some((n) => /^DOORLOPEND STAAFEIND/.test(n) && /knoop 2: de staaf loopt door in staaf 2, met een andere doorsnede \(HEA 200 en HEA 160\)/.test(n)),
    JS(i1.staaf_notities.filter((n) => /DOORLOPEND/.test(n))));
  const s = await runOpenFem3DSteelChecks(m, r.result, r.set);
  const st = s.results.map((x) => x.status);
  check("de kern toetst knik niet volledig (een doorlopend eind zonder kniklengtes): status NotApplicable",
    st.length === 2 && st.every((x) => x === "NotApplicable"), JS(st));
}

// ── [5] hout ──────────────────────────────────────────────────────────────
log("\n[5] hout: een gesplitste kolom, en een doorloop in een andere doorsnede");
{
  const m = (tweede) => parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 3 }, { id: 3, x: 0, y: 0, z: 6 }],
    beams: [staaf(1, 1, 2, "100x200", "C24"), staaf(2, 2, 3, tweede, "C24")],
    supports: [vast(1, { rz: true }), vast(3, { uz: false })],
    loads: [{ id: 1, nodeId: 3, fx: 0, fy: 0, fz: -20, mx: 0, my: 0, mz: 0, caseId: 1 }],
  });
  const gelijk = m("100x200");
  const r = await reken(gelijk);
  const b = buildOpenFem3DTimberCheckInputs(gelijk, r.result, r.set);
  check("één houtinvoer van 6 m voor de lijn, staaf 2 met reden overgeslagen",
    b.inputs.length === 1 && b.inputs[0].beam_id === 1 && b.inputs[0].length_m === 6
    && b.skipped.some((s) => s.beamId === 2 && /doorgaande lijn/.test(s.reason)), JS([b.inputs.map((i) => [i.beam_id, i.length_m]), b.skipped]));
  check("… met de notitie DOORGAANDE LIJN", b.inputs[0].staaf_notities.some((n) => /^DOORGAANDE LIJN/.test(n)));
  const anders = m("100x160");
  const ra = await reken(anders);
  const ba = buildOpenFem3DTimberCheckInputs(anders, ra.result, ra.set);
  check("andere doorsnede: twee invoeren van 3 m", ba.inputs.length === 2 && ba.inputs.every((i) => i.length_m === 3));
  // Sinds issue #205 kent de houtkern het doorlopende eind: het gaat als
  // staafeind mee en de kern weigert zonder kniklengtes art. 6.3.2.
  check("… met de kanttekening dat de houtkern zonder kniklengtes weigert",
    ba.inputs.every((i) => i.staaf_notities.some((n) => /^DOORLOPEND STAAFEIND/.test(n) && /houtkern weigert/.test(n))));
  check("… en het doorlopende eind als staafeind naar de houtkern",
    ba.inputs.some((i) => i.staafeinden?.eind === "Doorlopend") && ba.inputs.some((i) => i.staafeinden?.begin === "Doorlopend"),
    JS(ba.inputs.map((i) => i.staafeinden)));
  check("gelijke doorsnede: geen doorlopend eind meer (één lijn)",
    b.inputs[0].staafeinden?.begin !== "Doorlopend" && b.inputs[0].staafeinden?.eind !== "Doorlopend", JS(b.inputs[0].staafeinden));
}

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

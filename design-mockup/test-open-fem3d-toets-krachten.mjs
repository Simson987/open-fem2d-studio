// Toetskrachten in 3D (issue #199, bouwsteen B): de UGT-toets rekent ALTIJD
// tweede orde (P-Δ) met scheefstand in +X, −X, +Y en −Y, los van de analyse-
// instelling en de scheefstandschakelaar van het model. Die twee bepalen alleen
// nog de RESULTATEN (momentenlijnen, zakkingen, reacties); de BGT-toetsen komen
// uit de resultaten (besluit B6).
//
// Met de echte 3D-kern (OPEN_FEM_3D_SOLVER_PATH, anders
// src-tauri/target/debug/open-fem-3d(.exe)) via de rekenweg van de app
// (`solveOpenFem3DCombination`, POST /api/openFem3d/solve) en, voor de UC, de
// toetsbrug (src-tauri/target/release/toetsbrug(.exe)) via /api/toetsing:
//
//  [1] vrijstaande kolom, model eerste orde zonder scheefstand: de toets rekent
//      P-Δ met φ = 1/200; het voetmoment tegen de hand (H·tan(kL)/k);
//  [2] de vier richtingen: id's, ΣR per richting tegen de hand, BGT uit de
//      resultaten (dezelfde objecten);
//  [3] α_cr één keer per basiscombinatie, tegen π²·E·I_z/(2h)²/N;
//  [4] hergebruik: resultaten al P-Δ met de scheefstand aan en dezelfde φ →
//      geen enkele extra berekening, dezelfde objecten, en bit-gelijk aan de
//      eigen toetsrekengang; geen hergebruik bij een andere φ of bij eerste orde;
//  [5] divergentie (α_cr < 1): weigering per combinatie met de reden van de
//      kern, geen toetskrachten, geen uitzondering; de resultaten blijven;
//  [6] platen: de toets weigert vooraf met de reden; de kern valt met
//      `tweedeOrdeVerplicht` niet stil terug op lineair;
//  [7] een hal: acht P-Δ-toetsberekeningen (2 UGT × 4 richtingen), ΣR_x en ΣR_y
//      tegen φ·ΣV, en de staal-UC van de kolommen uit de toets boven die uit de
//      eerste-orderesultaten;
//  [8] beton: `first_order_envelope` uit de eerste orde van de toetsruns,
//      tegen de hand, om z zonder de globale scheefstand (de kern telt daar
//      e_i en e₂ zelf op); zonder kolomblok geen extra berekening en geen veld;
//  [9] de app: de 3D-tak van `handleSolve` uit de AST van App.tsx
//      (scripts/bron-uitvoeren.mjs) met de echte kern en de echte toetsen: de
//      resultaten lineair, de toets P-Δ in vier richtingen met één knikvorm,
//      de toetsset (UGT uit de toets, BGT uit de resultaten, φ altijd); een
//      divergerende toets en een model met platen blokkeren alleen de toets;
// [10] het 3D-rapport (taak 7): de toetskrachten naast de analyse van de
//      resultaten, een eigen hoofdstuk met de φ, α_cr van de toets en de
//      meldingen, en de weigering met haar reden;
// [11] imperfectiegevallen (`LoadCase.imperfectie`) op factor 0 in de
//      UGT-toets, met een melding en zonder hergebruik;
// [12] geen UGT-toetscombinatie: staal- en betonbouwer slaan de staaf over in
//      plaats van terug te vallen op het actieve geval;
// [13] hout: de toets-φ verhoogd naar NEN-EN 1995-1-1 (5.1) in het 3D-plan;
// [14] een opgegeven L_cr,z > L bij een kolom: de kanttekening dubbele sway.
//
// Uitvoeren: npx tsx test-open-fem3d-toets-krachten.mjs   (vanuit design-mockup/)
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { declaratie, leesBron, stateNaden, voerUitIn } from "./scripts/bron-uitvoeren.mjs";

const { parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { solveOpenFem3DCombination, OPEN_FEM_3D_PLATES_NO_SECOND_ORDER } =
  await import("./src/components/openFem3d/openFem3dSolver.ts");
const {
  leidScheefstandGeometrieAf3D, metScheefstandRichtingen3D, scheefstandVanCombinatie, toepasselijkeScheefstandNormen3D,
  bepaalScheefstand3D,
} = await import("./src/components/openFem3d/openFem3dScheefstand.ts");
const { bepaalToetsKrachten3D, planToetsKrachten3D, toetsSet3D } =
  await import("./src/components/openFem3d/openFem3dToetsKrachten.ts");
const { buildOpenFem3DSteelCheckInputs, runOpenFem3DSteelChecks, openFem3DUlsUc } =
  await import("./src/components/openFem3d/openFem3dSteelCheck.ts");
const { buildOpenFem3DConcreteCheckInputs } = await import("./src/components/openFem3d/openFem3dConcreteCheck.ts");
const { SCHEEFSTAND_COMBO_OFFSET } = await import("./src/components/fem/solver/combinations.ts");
const { resolveSection } = await import("./src/lib/sectionResolver.ts");
const { STEEL_SECTION_DIMS } = await import("./src/lib/steelSectionDims.generated.ts");
const { STANDAARD_KORF } = await import("./src/components/beton/wapeningskorf.ts");

let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const binnen = (a, b, rel) => Math.abs(a - b) <= Math.abs(b) * rel;
const kn = (x) => x.toFixed(3).replace(".", ",");

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
// De twee dev-bruggen van de app (vite.config.ts), hier naar de echte processen.
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

// ── Hulpjes ────────────────────────────────────────────────────────────────

/**
 * De scheefstand van de projectinstelling (vast 1/noemer), zoals de app hem
 * afleidt: sinds issue #194 φ_X en φ_Y (`bepaalScheefstand3D`); met de vaste
 * noemer zijn die gelijk.
 */
const projectScheefstand = (model, noemer = 200) => bepaalScheefstand3D(
  { bron: "vast", noemer }, leidScheefstandGeometrieAf3D(model), toepasselijkeScheefstandNormen3D(model));

/**
 * De resultaatrekengang zoals App.tsx hem draait: de combinaties ontvouwd als
 * de schakelaar aan staat (φ > 0), sinds issue #194 ook de BGT, elke
 * combinatie apart door de kern. `phi` is één getal voor X en Y.
 */
async function resultaatRekengang(model, combinaties, { analyse, phi = 0 }) {
  const perAs = phi > 0 ? { x: phi, y: phi } : null;
  const lijst = metScheefstandRichtingen3D(combinaties, perAs, { bgt: true });
  const paren = await Promise.all(lijst.map(async (c) =>
    [c.id, await solveOpenFem3DCombination(model, c.factors, analyse, scheefstandVanCombinatie(c, perAs))]));
  return { combinaties: lijst, combinationResults: new Map(paren), phi: perAs };
}

/** De rekenfunctie van de toets zoals de app hem geeft, met een teller. */
function rekenaar(model) {
  const runs = [];
  const reken = async (run) => {
    runs.push(run);
    return solveOpenFem3DCombination(model, run.combinatie.factors, run.analyse, run.scheefstand,
      { bucklingModes: run.bucklingModes, tweedeOrdeVerplicht: run.analyse === "p-delta" });
  };
  return { runs, reken };
}

/** De toets op `model`, met de resultaatrekengang `res`. */
async function toets(model, res, { noemer = 200, modelAan = res.phi !== null } = {}) {
  const { runs, reken } = rekenaar(model);
  const uitkomst = await bepaalToetsKrachten3D({
    model,
    combinaties: res.combinaties,
    scheefstand: { project: projectScheefstand(model, noemer), normen: toepasselijkeScheefstandNormen3D(model), modelAan },
    resultaten: { combinationResults: res.combinationResults, phi: res.phi },
  }, reken);
  return { uitkomst, runs };
}

const reactie = (r, nodeId) => r.reactions.find((x) => x.nodeId === nodeId);
const som = (r, k) => r.reactions.reduce((t, x) => t + x[k], 0);
const ID = (basis, k) => basis + k * SCHEEFSTAND_COMBO_OFFSET;   // k: 0 = +X, 1 = −X, 2 = +Y, 3 = −Y

// ── Het model: een ingeklemde HEA 200-kolom met een vrije kop ──────────────
//
// h = 4 m, S235. Geval 1 (G): F_z = −G op de kop; geval 4 (W): F_x = +5 kN op de
// kop. UGT "UGT 6.10b" = 1,2·G + 1,5·W, BGT "BGT karakteristiek" = G + W.
const H = 4;
const kolomModel = (gKn) => parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: H }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA 200", material: "S235" }],
  supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
  loads: [
    { id: 1, nodeId: 2, fx: 0, fy: 0, fz: -gKn, mx: 0, my: 0, mz: 0, caseId: 1 },
    { id: 2, nodeId: 2, fx: 5, fy: 0, fz: 0, mx: 0, my: 0, mz: 0, caseId: 4 },
  ],
});
const UGT = { id: 7, name: "UGT 6.10b", type: "uls", formula: "1,2·G + 1,5·W", factors: new Map([[1, 1.2], [4, 1.5]]) };
const BGT = { id: 17, name: "BGT karakteristiek", type: "sls", formula: "G + W", factors: new Map([[1, 1], [4, 1]]) };

// HANDBEREKENING (G = 200 kN): N_Ed = 1,2·200 = 240 kN, φ = 1/200.
//   HEA 200: E = 210 000 N/mm², I_y = 36,9·10⁶ mm⁴ (om de sterke as), I_z = 13,4·10⁶ mm⁴.
//   Een staande staaf heeft in de kern lokaal z = globaal X (`openFem3DLocalAxes`):
//   uitwijken in X buigt om de sterke as, in Y om de zwakke.
//   Console met normaalkracht P en koplast H: M_voet = H·tan(kL)/k, k = √(P/EI)
//   (exact elastisch, P-Δ én P-δ; de kern rekent een gedrukte staaf in vier delen).
const sectie = resolveSection("S235", "HEA 200");
const E = sectie.E, IY = sectie.I, IZ = STEEL_SECTION_DIMS.HEA200.props.iz;
check("catalogus HEA 200: E = 210 000, I_y = 36,9·10⁶, I_z = 13,4·10⁶ mm⁴",
  E === 210000 && IY === 36.9e6 && IZ === 13.4e6, `${E} ${IY} ${IZ}`);
const N = 1.2 * 200, PHI = 1 / 200;
const momentHand = (hKn, I) => {
  const k = Math.sqrt(N * 1e3 / (E * I));                 // 1/mm
  return hKn * 1e3 * Math.tan(k * H * 1e3) / k / 1e6;    // kNm
};
const HX_PLUS = 1.5 * 5 + PHI * N;    // 8,7 kN
const HX_MIN = 1.5 * 5 - PHI * N;     // 6,3 kN
const HY = PHI * N;                   // 1,2 kN
const NCR_Z = Math.PI ** 2 * E * IZ / (2 * H * 1e3) ** 2 / 1e3;   // kN, console: L_cr = 2h

log("[1] vrijstaande kolom, eerste orde zonder scheefstand: de toets rekent P-Δ met φ = 1/200");
const kolom = kolomModel(200);
const resLin = await resultaatRekengang(kolom, [UGT, BGT], { analyse: "linear" });
const { uitkomst: t1, runs: runs1 } = await toets(kolom, resLin);
check("geen weigering", t1.weigering === null, JSON.stringify(t1.weigering));
check("toetsanalyse: tweede orde geometrisch, φ = 1/200, vast, schakelaar uit, niet hergebruikt",
  t1.analyse.soort === "tweedeOrdeGeometrisch" && t1.analyse.phi === PHI && t1.analyse.noemer === 200
  && t1.analyse.bron === "vast" && t1.analyse.scheefstandModelAan === false && t1.analyse.hergebruikt === false,
  JSON.stringify(t1.analyse));
check("vier P-Δ-berekeningen met één knikvorm, elk met scheefstand φ = 1/200; geen eerste orde zonder betonkolom",
  runs1.length === 4 && runs1.every((r) => r.soort === "toets" && r.analyse === "p-delta" && r.bucklingModes === 1
    && r.scheefstand?.phi === PHI),
  JSON.stringify(runs1.map((r) => [r.soort, r.analyse, r.bucklingModes, r.scheefstand])));
const r1 = t1.combinationResults.get(ID(7, 0));
const mResultaat = Math.abs(reactie(resLin.combinationResults.get(7), 1).my);
const mToets = Math.abs(reactie(r1, 1).my);
const mHand = momentHand(HX_PLUS, IY);
// Resultaten: lineair, zonder scheefstand: M = 1,5·5·4 = 30 kNm.
check(`de resultaten blijven eerste orde: M_voet = 1,5·5·4 = 30 kNm (kern ${kn(mResultaat)})`,
  binnen(mResultaat, 30, 1e-6) && resLin.combinationResults.get(7).analysis === "linear");
// Toets +X: H = 7,5 + 240/200 = 8,7 kN; eerste orde 8,7·4 = 34,8 kNm; exact
// H·tan(kL)/k met I_y: k = √(240 000/(210 000·36,9·10⁶)) = 1,7599·10⁻⁴ /mm,
// kL = 0,7040, M = 8,7·4,8246 m = 41,97 kNm. De vier delen van de kern: binnen 0,3 %.
check(`toets +X: M_voet = H·tan(kL)/k = ${kn(mHand)} kNm (kern ${kn(mToets)}), boven de eerste orde 34,8`,
  r1.analysis === "p-delta" && binnen(mToets, mHand, 3e-3) && mToets > 34.8, `${mToets} / ${mHand}`);
check(`toets: N_Ed = 1,2·200 = 240 kN (ΣR_z ${kn(som(r1, "fz"))})`, binnen(som(r1, "fz"), N, 1e-9));

log("\n[2] de vier richtingen, en de BGT uit de resultaten");
check("toetscombinaties: +X houdt het id, −X, +Y en −Y krijgen +1, +2, +3 miljoen",
  JSON.stringify(t1.ugtCombinaties.map((c) => [c.id, c.scheefstandAs, c.scheefstandRichting]))
  === JSON.stringify([[ID(7, 0), "x", 1], [ID(7, 1), "x", -1], [ID(7, 2), "y", 1], [ID(7, 3), "y", -1]]));
// ΣR is tegengesteld aan de lasten: R_x = −(1,5·5 + richting·φ·N) bij ±X; bij ±Y
// alleen de wind in X, en R_y = −richting·φ·N.
const sommen = [
  ["+X", 0, -HX_PLUS, 0], ["−X", 1, -HX_MIN, 0], ["+Y", 2, -7.5, -HY], ["−Y", 3, -7.5, HY],
];
for (const [label, k, rx, ry] of sommen) {
  const r = t1.combinationResults.get(ID(7, k));
  check(`${label}: ΣR_x = ${kn(rx)}, ΣR_y = ${kn(ry)} kN`,
    Math.abs(som(r, "fx") - rx) < 1e-6 && Math.abs(som(r, "fy") - ry) < 1e-6, `${som(r, "fx")} ${som(r, "fy")}`);
}
// +Y buigt om de zwakke as: M_x,voet = 1,2·tan(kL)/k met I_z (k = 2,9204·10⁻⁴ /mm,
// kL = 1,1682) = 1,2·8,0399 m = 9,65 kNm; eerste orde 1,2·4 = 4,8 kNm.
const mY = Math.abs(reactie(t1.combinationResults.get(ID(7, 2)), 1).mx);
check(`toets +Y: M_x,voet = 1,2·tan(kL)/k = ${kn(momentHand(HY, IZ))} kNm (kern ${kn(mY)})`,
  binnen(mY, momentHand(HY, IZ), 3e-3), String(mY));
const set1 = toetsSet3D(t1, { combinaties: resLin.combinaties, combinationResults: resLin.combinationResults, loadCases: [] });
check("toetsset: de vier UGT-varianten en de BGT, in de volgorde van de resultaten",
  JSON.stringify(set1.combinations.map((c) => c.id)) === JSON.stringify([ID(7, 0), ID(7, 1), ID(7, 2), ID(7, 3), 17]));
check("… de UGT uit de toets, de BGT is hetzelfde object als in de resultaten",
  set1.results.get(ID(7, 0)) === r1 && set1.results.get(17) === resLin.combinationResults.get(17));
// GEWIJZIGD door issue #194: φ per richting (φ_X, φ_Y); met de vaste noemer gelijk.
check("… met de toets-φ per richting voor de φ-eis bij een vrij staafeind",
  JSON.stringify(set1.scheefstandPhi) === JSON.stringify({ x: PHI, y: PHI }), JSON.stringify(set1.scheefstandPhi));

log("\n[3] α_cr één keer per basiscombinatie");
// α_cr = N_cr,z/N = π²·210 000·13,4·10⁶/(2·4000)²/240 000 = 433,9/240 = 1,808 (de
// zwakke as; om de sterke as 1 195 kN). De kern rekent de knikvorm met vier
// delen per staaf: binnen 0,2 %.
check(`één α_cr voor de ene basiscombinatie, ${kn(NCR_Z / N)} (kern ${t1.alphaCr[0]?.alphaCr?.toFixed(4)})`,
  t1.alphaCr.length === 1 && t1.alphaCr[0].combinatieId === 7 && t1.alphaCr[0].status === "bepaald"
  && binnen(t1.alphaCr[0].alphaCr, NCR_Z / N, 2e-3), JSON.stringify(t1.alphaCr));

log("\n[4] hergebruik");
const resPd = await resultaatRekengang(kolom, [UGT, BGT], { analyse: "p-delta", phi: projectScheefstand(kolom).phi.x });
const { uitkomst: t4, runs: runs4 } = await toets(kolom, resPd);
check("resultaten P-Δ met de schakelaar aan en dezelfde φ: geen enkele toetsberekening",
  runs4.length === 0 && t4.analyse.hergebruikt === true, String(runs4.length));
check("… de toetskrachten zijn de resultaten zelf (dezelfde objecten)",
  [0, 1, 2, 3].every((k) => t4.combinationResults.get(ID(7, k)) === resPd.combinationResults.get(ID(7, k))));
check("… en bit-gelijk aan de eigen toetsrekengang (staafkrachten en reacties)",
  [0, 1, 2, 3].every((k) =>
    JSON.stringify(t4.combinationResults.get(ID(7, k)).memberForces) === JSON.stringify(t1.combinationResults.get(ID(7, k)).memberForces)
    && JSON.stringify(t4.combinationResults.get(ID(7, k)).reactions) === JSON.stringify(t1.combinationResults.get(ID(7, k)).reactions)));
const resPd300 = await resultaatRekengang(kolom, [UGT, BGT], { analyse: "p-delta", phi: 1 / 300 });
const { uitkomst: t4b, runs: runs4b } = await toets(kolom, resPd300);
check("resultaten P-Δ met een andere φ (1/300): vier eigen toetsberekeningen met 1/200",
  runs4b.length === 4 && t4b.analyse.hergebruikt === false && runs4b.every((r) => r.scheefstand.phi === PHI));
const resLinScheef = await resultaatRekengang(kolom, [UGT, BGT], { analyse: "linear", phi: PHI });
const { uitkomst: t4c, runs: runs4c } = await toets(kolom, resLinScheef);
check("resultaten eerste orde met de scheefstand aan: geen hergebruik (de toets is altijd P-Δ)",
  runs4c.length === 4 && t4c.analyse.hergebruikt === false);
const { uitkomst: t4d, runs: runs4d } = await toets(kolom, resPd, { modelAan: false });
check("resultaten P-Δ met φ, maar de schakelaar volgens de invoer uit: geen hergebruik",
  runs4d.length === 4 && t4d.analyse.hergebruikt === false);

log("\n[5] divergentie: α_cr < 1 weigert de toets, de resultaten blijven");
// G = 400 kN: N = 480 kN > N_cr,z = 433,9 kN, dus α_cr = 0,904 < 1.
const zwak = kolomModel(400);
const resZwak = await resultaatRekengang(zwak, [UGT, BGT], { analyse: "linear" });
let t5, gegooid = null;
try { ({ uitkomst: t5 } = await toets(zwak, resZwak)); } catch (e) { gegooid = e; }
check("geen uitzondering", gegooid === null, String(gegooid));
check("de toets is geweigerd, zonder toetskrachten",
  t5?.weigering !== null && t5?.combinationResults.size === 0, JSON.stringify(t5?.weigering));
check("… met de reden per combinatie (alle vier de richtingen) en α_cr van de kern",
  t5?.weigering?.perCombinatie.length === 4
  && t5.weigering.perCombinatie.every((p) => /alpha_cr|α_cr/.test(p.reden)),
  JSON.stringify(t5?.weigering?.perCombinatie));
check("… de samenvatting noemt P-Δ, de scheefstand en geen terugval op eerste orde",
  /P-Δ/.test(t5?.weigering?.reden ?? "") && /1\/200/.test(t5.weigering.reden) && /niet teruggevallen op eerste orde/.test(t5.weigering.reden));
check("de resultaten (eerste orde) zijn onaangeroerd",
  resZwak.combinationResults.size === 2 && binnen(Math.abs(reactie(resZwak.combinationResults.get(7), 1).my), 30, 1e-6));
let setGegooid = null;
try { toetsSet3D(t5, { combinaties: resZwak.combinaties, combinationResults: resZwak.combinationResults }); } catch (e) { setGegooid = e; }
check("een geweigerde toets levert geen toetsset", setGegooid !== null);

log("\n[6] platen: geen P-Δ, dus de toets weigert");
const metPlaat = parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }, { id: 3, x: 4, y: 4, z: 0 }, { id: 4, x: 0, y: 4, z: 0 },
    { id: 5, x: 0, y: 0, z: -3 },
  ],
  beams: [{ id: 1, startNodeId: 5, endNodeId: 1, profileName: "HEA 200", material: "S235" }],
  plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2, material: "C30/37", meshSizeM: 1, edgeSupports: [
    { edge: 1, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false },
    { edge: 3, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false },
  ] }],
  supports: [{ nodeId: 5, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
  surfaceLoads: [{ id: 1, plateId: 1, qx: 0, qy: 0, qz: -5, caseId: 1 }],
});
{
  const plan = planToetsKrachten3D({
    model: metPlaat, combinaties: [UGT, BGT],
    scheefstand: { project: projectScheefstand(metPlaat), normen: toepasselijkeScheefstandNormen3D(metPlaat), modelAan: false },
  });
  check("weigering vooraf, zonder één berekening",
    plan.weigering !== null && plan.runs.length === 0, JSON.stringify(plan.weigering));
  check("… met de reden: geen tweede-ordeberekening met platen",
    plan.weigering?.reden.includes(OPEN_FEM_3D_PLATES_NO_SECOND_ORDER) && /eerste orde/.test(plan.weigering.reden),
    plan.weigering?.reden);
  let fout = null;
  try {
    await solveOpenFem3DCombination(metPlaat, UGT.factors, "p-delta", null, { tweedeOrdeVerplicht: true });
  } catch (e) { fout = e; }
  check("de rekenweg met tweedeOrdeVerplicht valt niet stil terug op lineair, maar weigert met dezelfde reden",
    fout?.message === OPEN_FEM_3D_PLATES_NO_SECOND_ORDER, String(fout));
  const lineair = await solveOpenFem3DCombination(metPlaat, UGT.factors, "p-delta", null);
  check("zonder die vlag (de resultaten) blijft de terugval met melding zoals hij was",
    lineair.analysis === "linear" && lineair.diagnostics.some((d) => /eerste orde \(lineair\)/.test(d)));
}

log("\n[7] een hal: eerste orde → P-Δ-toets in vier richtingen, en de staal-UC");
// Vier HEA 200-kolommen van 5 m, ingeklemd; twee IPE 300-spanten van 10 m langs
// X (y = 0 en y = 6) en twee HEA 140-koppelingen langs Y, alles stijf verbonden.
// G: q_z = −4 kN/m op beide spanten (geval 1); Q: q_z = −3 kN/m (geval 2);
// W: F_x = +4 kN op beide kolomkoppen bij x = 0 (geval 4).
const hal = parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 10, y: 0, z: 0 }, { id: 3, x: 0, y: 6, z: 0 }, { id: 4, x: 10, y: 6, z: 0 },
    { id: 5, x: 0, y: 0, z: 5 }, { id: 6, x: 10, y: 0, z: 5 }, { id: 7, x: 0, y: 6, z: 5 }, { id: 8, x: 10, y: 6, z: 5 },
  ],
  beams: [
    ...[[1, 5], [2, 6], [3, 7], [4, 8]].map(([a, b], i) => ({ id: i + 1, startNodeId: a, endNodeId: b, profileName: "HEA 200", material: "S235" })),
    { id: 5, startNodeId: 5, endNodeId: 6, profileName: "IPE 300", material: "S235" },
    { id: 6, startNodeId: 7, endNodeId: 8, profileName: "IPE 300", material: "S235" },
    { id: 7, startNodeId: 5, endNodeId: 7, profileName: "HEA 140", material: "S235" },
    { id: 8, startNodeId: 6, endNodeId: 8, profileName: "HEA 140", material: "S235" },
  ],
  supports: [1, 2, 3, 4].map((nodeId) => ({ nodeId, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true })),
  memberLoads: [
    { id: 1, beamId: 5, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -4, qzEnd: -4, startPositionM: 0, endPositionM: 10 },
    { id: 2, beamId: 6, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -4, qzEnd: -4, startPositionM: 0, endPositionM: 10 },
    { id: 3, beamId: 5, caseId: 2, qyStart: 0, qyEnd: 0, qzStart: -3, qzEnd: -3, startPositionM: 0, endPositionM: 10 },
    { id: 4, beamId: 6, caseId: 2, qyStart: 0, qyEnd: 0, qzStart: -3, qzEnd: -3, startPositionM: 0, endPositionM: 10 },
  ],
  loads: [
    { id: 1, nodeId: 5, fx: 4, fy: 0, fz: 0, mx: 0, my: 0, mz: 0, caseId: 4 },
    { id: 2, nodeId: 7, fx: 4, fy: 0, fz: 0, mx: 0, my: 0, mz: 0, caseId: 4 },
  ],
});
const HAL_COMBOS = [
  { id: 3, name: "UGT 6.10b Q leidend", type: "uls", formula: "", factors: new Map([[1, 1.2], [2, 1.5]]) },
  { id: 7, name: "UGT 6.10b W leidend", type: "uls", formula: "", factors: new Map([[1, 1.2], [4, 1.5]]) },
  { id: 13, name: "BGT karakteristiek Q leidend", type: "sls", formula: "", factors: new Map([[1, 1], [2, 1]]) },
];
{
  const res = await resultaatRekengang(hal, HAL_COMBOS, { analyse: "linear" });
  const { uitkomst: t7, runs: runs7 } = await toets(hal, res);
  check("acht P-Δ-toetsberekeningen (2 UGT × 4 richtingen), geen weigering",
    t7.weigering === null && runs7.length === 8 && runs7.every((r) => r.analyse === "p-delta")
    && [...t7.combinationResults.values()].every((r) => r.analysis === "p-delta" && r.secondOrder?.converged),
    JSON.stringify(t7.weigering));
  // ΣV van "UGT 6.10b Q leidend" = (1,2·4 + 1,5·3)·10·2 = 186 kN; de scheefstand
  // voegt φ·ΣV = 0,93 kN toe in de richting van de variant.
  const sv = (1.2 * 4 + 1.5 * 3) * 10 * 2;
  for (const [label, k, as, teken] of [["+X", 0, "fx", 1], ["−X", 1, "fx", -1], ["+Y", 2, "fy", 1], ["−Y", 3, "fy", -1]]) {
    const r = t7.combinationResults.get(ID(3, k));
    check(`Q leidend ${label}: ΣR_z = ${kn(sv)} kN, Σ${as === "fx" ? "R_x" : "R_y"} = −φ·ΣV = ${kn(-teken * PHI * sv)} kN`,
      Math.abs(som(r, "fz") - sv) < 1e-6 && Math.abs(som(r, as) + teken * PHI * sv) < 1e-6, `${som(r, "fz")} ${som(r, as)}`);
  }
  check("twee α_cr's, één per basiscombinatie", t7.alphaCr.length === 2
    && t7.alphaCr.map((a) => a.combinatieId).join() === "3,7" && t7.alphaCr.every((a) => a.status === "bepaald" && a.alphaCr > 1));
  // De staaltoets (toetsbrug) met de toetsset tegen dezelfde toets met alleen de
  // resultaten (de route van vóór #199 bij eerste orde zonder scheefstand).
  const set7 = toetsSet3D(t7, { combinaties: res.combinaties, combinationResults: res.combinationResults, loadCases: [], consequenceClass: "CC2" });
  const actief = res.combinationResults.get(3);
  const metToets = await runOpenFem3DSteelChecks(hal, actief, set7);
  const oud = await runOpenFem3DSteelChecks(hal, actief, {
    combinations: res.combinaties, results: res.combinationResults, loadCases: [], consequenceClass: "CC2",
  });
  const ucVan = (uit, id) => openFem3DUlsUc(uit.results.find((r) => r.beam_id === id));
  for (const id of [1, 2]) {
    check(`kolom ${id}: UGT-UC uit de toets (${ucVan(metToets, id).toFixed(4)}) boven die uit de eerste-orderesultaten (${ucVan(oud, id).toFixed(4)})`,
      ucVan(metToets, id) > ucVan(oud, id));
  }
  const invoer = buildOpenFem3DSteelCheckInputs(hal, actief, set7).inputs.find((i) => i.beam_id === 1);
  check("de staalinvoer: UGT-krachten van de acht toetsvarianten, de BGT-zakking uit de resultaten",
    JSON.stringify([...new Set(invoer.forces_envelope.map((p) => p.combination_id))].sort((a, b) => a - b))
      === JSON.stringify([3, 7, ID(3, 1), ID(7, 1), ID(3, 2), ID(7, 2), ID(3, 3), ID(7, 3)].sort((a, b) => a - b)));
  check("… en de notitie dat de UGT-krachten tweede orde met scheefstand zijn",
    invoer.staaf_notities.some((n) => /tweede orde \(P-Δ\) met scheefstand φ = 1\/200/.test(n) && /5\.2\.2\(7\)b/.test(n)));
}

log("\n[8] beton: first_order_envelope uit de eerste orde van de toetsruns");
// Een betonkolom 300×500 (C30/37) van 3 m, ingeklemd met een vrije kop, met een
// korf en een §5.8-blok. G = 400 kN, W = 5 kN in X. UGT = 1,2·G + 1,5·W.
const betonConfig = {
  betonKorf: STANDAARD_KORF.korf, betonMilieuklasse: "XC3", betonConstructieklasse: "S4",
  betonKolom: {
    bracing: "Ongeschoord", buckling_length: { soort: "Figuur57", geval: "Console" },
    bracing_z: "Ongeschoord", buckling_length_z: { soort: "Figuur57", geval: "Console" }, phi_inf_t0: 1.8,
  },
};
const betonModel = (config) => parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 3 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "300x500", material: "C30/37", ...(config ? { checkConfig: config } : {}) }],
  supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
  loads: [
    { id: 1, nodeId: 2, fx: 0, fy: 0, fz: -400, mx: 0, my: 0, mz: 0, caseId: 1 },
    { id: 2, nodeId: 2, fx: 5, fy: 0, fz: 0, mx: 0, my: 0, mz: 0, caseId: 4 },
  ],
});
const QP = { id: 21, name: "BGT quasi-blijvend", type: "sls", formula: "G", factors: new Map([[1, 1]]) };
{
  const beton = betonModel(betonConfig);
  const res = await resultaatRekengang(beton, [UGT, QP], { analyse: "linear" });
  const { uitkomst: t8, runs: runs8 } = await toets(beton, res);
  const eerste = runs8.filter((r) => r.soort === "eersteOrde");
  check("vier P-Δ-toetsruns en vier lineaire eerste-ordruns (dezelfde varianten, dezelfde φ); de quasi-blijvende uit de resultaten",
    runs8.filter((r) => r.soort === "toets").length === 4 && eerste.length === 4
    && eerste.every((r) => r.analyse === "linear" && r.scheefstand?.phi === PHI)
    && t8.eersteOrdeResultaten?.get(21) === res.combinationResults.get(21),
    JSON.stringify(runs8.map((r) => [r.soort, r.combinatie.id])));
  const set8 = toetsSet3D(t8, { combinaties: res.combinaties, combinationResults: res.combinationResults, loadCases: [] });
  const invoer = buildOpenFem3DConcreteCheckInputs(beton, res.combinationResults.get(7), set8).inputs[0];
  const voet = (lijst, id) => lijst.find((p) => p.combination_id === id && p.position_mm === 0)?.forces;
  // Eerste orde +X: M_y,voet = (1,5·5 + 480/200)·3 = 9,9·3 = 29,7 kNm (teken van de kern).
  const m0 = Math.abs(voet(invoer.first_order_envelope, ID(7, 0))?.my_ed ?? NaN);
  const m2 = Math.abs(voet(invoer.forces_envelope, ID(7, 0))?.my_ed ?? NaN);
  check(`first_order_envelope +X: M₀,voet = (7,5 + 2,4)·3 = 29,7 kNm (kern ${kn(m0)})`, binnen(m0, 29.7, 1e-6), String(m0));
  check(`forces_envelope +X is tweede orde: M_voet ${kn(m2)} > 29,7 kNm`, m2 > 29.7 * (1 + 1e-4), String(m2));
  check("first_order_envelope draagt alle vier de varianten",
    JSON.stringify([...new Set(invoer.first_order_envelope.map((p) => p.combination_id))]) === JSON.stringify([0, 1, 2, 3].map((k) => ID(7, k))));
  check("de quasi-blijvende omhullende komt uit de (eerste-orde) resultaten",
    invoer.sls_quasi_permanent_envelope.every((p) => p.combination_id === 21) && invoer.sls_quasi_permanent_envelope.length > 0);

  // OM z TELT DE IMPERFECTIE ÉÉN KEER. De toets rekent ook in ±Y; die
  // varianten geven om de andere as een moment φ·N·h (P-Δ vergroot). De kern
  // telt om z zelf N·(e_i + e₂) op. M₀Ed,z hoort daarom de eerste orde ZONDER
  // globale scheefstand te zijn: hier nul, want er staat geen last in Y.
  //   HAND: N_Ed = 1,2·400 = 480 kN; l = 3 m, console → l₀,z = 6 m;
  //   α_h = 2/√3 → 1; θ_i = 1/300; e_i = θ_i·l₀/2 = 6000/600 = 10,0 mm.
  //   M_Edz = max{M₀Edz + N·(e_i + e₂); N·e₀}, met M₀Edz = 0 en e₀ = 20 mm.
  //   Zonder deze stap kwam er φ·N·h = 480/200·3 = 7,2 kNm (vergroot door P-Δ)
  //   bij, met e_i en e₂ er nog bovenop.
  const tweede = invoer.forces_envelope.filter((p) => Math.floor(p.combination_id / SCHEEFSTAND_COMBO_OFFSET) >= 2);
  const mzTweede = Math.max(...tweede.map((p) => Math.abs(p.forces.mz_ed)));
  check(`de toets in ±Y geeft een tweede-ordemoment om de andere as (${kn(mzTweede)} kNm > φ·N·h = 7,2 kNm)`,
    mzTweede > 7.2, String(mzTweede));
  check("first_order_envelope: M_z zonder globale scheefstand (alle varianten 0)",
    invoer.first_order_envelope.every((p) => Math.abs(p.forces.mz_ed) < 1e-9),
    JSON.stringify(invoer.first_order_envelope.map((p) => p.forces.mz_ed)));
  check("first_order_envelope: M_y van +X houdt de scheefstand (om y zoals in 2D)", binnen(m0, 29.7, 1e-6));
  const { runOpenFem3DConcreteChecks } = await import("./src/components/openFem3d/openFem3dConcreteCheck.ts");
  const uitBeton = await runOpenFem3DConcreteChecks(beton, res.combinationResults.get(7), set8);
  const mz = uitBeton.results[0]?.checks.find((c) => c.id === "5.8.9_moment_z")?.kind.data;
  const v = (sym) => mz?.variables.find((x) => x.symbol === sym)?.value;
  const mHand = Math.max(v("M_0Edz") + v("N_Ed") * (v("e_i") + v("e_2")) * 1e-3, v("N_Ed") * v("e_0") * 1e-3);
  log(`    om z: N_Ed ${kn(v("N_Ed") ?? NaN)} kN, M₀Edz ${kn(v("M_0Edz") ?? NaN)}, e_i ${kn(v("e_i") ?? NaN)} mm, ` +
    `e₂ ${kn(v("e_2") ?? NaN)} mm, M_Edz ${kn(v("M_Edz") ?? NaN)} kNm (hand ${kn(mHand)})`);
  check("de kern: M₀Edz = 0 (geen φ·N·h om z)", mz !== undefined && Math.abs(v("M_0Edz")) < 1e-9, JSON.stringify(mz?.variables));
  check("de kern: e_i om z = θ_i·l₀,z/2 = 10,0 mm", binnen(v("e_i"), 10, 1e-9), String(v("e_i")));
  check("de kern: N_Ed om z = 480 kN uit de toetskrachten", binnen(v("N_Ed"), 480, 1e-6), String(v("N_Ed")));
  check("de kern: M_Edz = max{0 + N·(e_i + e₂); N·e₀} (de hand, met e₂ van de kern)", binnen(v("M_Edz"), mHand, 1e-9),
    `${v("M_Edz")} vs ${mHand}`);
  check("… en de toelichting noemt de eerste orde om z", mz?.notes.some((n) => n.includes("UIT DE EERSTE ORDE")));
  // De notitie bij beton noemt geen staalregel: voor beton is de P-Δ
  // elastisch, §5.8 blijft ongewijzigd en l₀ volgt §5.8.3.2.
  const betonNotities = buildOpenFem3DConcreteCheckInputs(beton, res.combinationResults.get(7), set8).notes;
  check("beton: de toetsnotitie noemt §5.8 en de elastische stijfheid, niet 'de systeemlengte als kniklengte nemen'",
    betonNotities.some((n) => /tweede orde \(P-Δ\) met scheefstand/.test(n) && /§5\.8/.test(n) && /ongescheurde elastische stijfheid/.test(n))
      && !betonNotities.some((n) => /mag de staaftoets de systeemlengte als kniklengte nemen/.test(n)),
    betonNotities.join(" | "));
  // Resultaten P-Δ: de quasi-blijvende moet dan apart eerste orde gerekend worden.
  const resPdBeton = await resultaatRekengang(beton, [UGT, QP], { analyse: "p-delta" });
  const { runs: runs8b } = await toets(beton, resPdBeton);
  check("resultaten P-Δ: ook de quasi-blijvende combinatie krijgt een lineaire eerste-ordrun (zonder scheefstand)",
    runs8b.some((r) => r.soort === "eersteOrde" && r.combinatie.id === 21 && r.analyse === "linear" && r.scheefstand === null));
  // Zonder kolomblok leest de kern geen eerste orde: geen extra berekening en geen veld.
  const zonder = betonModel({ ...betonConfig, betonKolom: undefined });
  const resZ = await resultaatRekengang(zonder, [UGT, QP], { analyse: "linear" });
  const { uitkomst: t8z, runs: runs8z } = await toets(zonder, resZ);
  const setZ = toetsSet3D(t8z, { combinaties: resZ.combinaties, combinationResults: resZ.combinationResults, loadCases: [] });
  const invZ = buildOpenFem3DConcreteCheckInputs(zonder, resZ.combinationResults.get(7), setZ).inputs[0];
  check("zonder §5.8-blok: alleen de vier toetsruns, en geen first_order_envelope",
    runs8z.length === 4 && t8z.eersteOrdeResultaten === undefined && invZ && !("first_order_envelope" in invZ));
}

log("\n[9] de app: de 3D-tak van handleSolve, uitgevoerd");
{
  // De weigering staat in de taal van de app ("geweigerd — …", i18n): de
  // vertalingen moeten geladen zijn.
  await import("./scripts/i18n-voor-tests.mjs");
  const app = leesBron("src/App.tsx");
  const { solveOpenFem3DCombination: echt } = await import("./src/components/openFem3d/openFem3dSolver.ts");
  async function berekenen(model, { analysetype = "eersteOrde", scheefstandAan = false } = {}) {
    const kern = [];
    const meldingen = [];
    const toestand = { openFem3dSolvedCombinations: [], openFem3dCombinationResults: new Map(), openFem3dVisibility: {} };
    const naden = stateNaden(app, toestand, {
      modelDimension: "3d",
      getSetting: async (_sleutel, standaard) => standaard,
      resolveSolver: () => ({}),
      leesSnapInstellingen: () => ({ verbindingsTolerantie: 5 }),
      openFem3d: model, openFem3dCalculationModel: model,
      openFem3dCalculation: { selfWeightError: undefined, selfWeightCaseId: undefined },
      openFem3dSolveGenerationRef: { current: 0 },
      openFem3dScheefstandUitkomst: projectScheefstand(model),
      // Issue #212: de torsievarianten van 5.3.2(10) staan uit.
      openFem3dTorsieRijen: null,
      fem: {
        analysetype, scheefstandEnabled: scheefstandAan, activeLoadCaseId: 1,
        combinations: [UGT, BGT], loadCases: [{ id: 1, type: "dead" }, { id: 4, type: "wind" }], gevolgklasse: "CC2",
      },
      setActiveView() {},
      dynamischeImport: async () => ({ notifyInfo() {}, notifyWarning: (titel, tekst) => meldingen.push({ titel, tekst }) }),
      solveOpenFem3DCombination: async (...args) => { kern.push(args); return echt(...args); },
    });
    const handleSolve = await voerUitIn(app, declaratie(app, "handleSolve"), naden);
    await handleSolve();
    return { kern, toestand, meldingen };
  }
  const { kern, toestand } = await berekenen(kolom);
  const resultaatRuns = kern.filter(([, , , , opties]) => opties?.tweedeOrdeVerplicht !== true);
  const toetsRuns = kern.filter(([, , , , opties]) => opties?.tweedeOrdeVerplicht === true);
  check("de resultaten: elke combinatie één keer lineair, zonder scheefstand (de instelling)",
    resultaatRuns.length === 2 && resultaatRuns.every(([, , analyse, scheef]) => analyse === "linear" && scheef === null),
    JSON.stringify(resultaatRuns.map(([, , a, s]) => [a, s])));
  check("de toets: vier P-Δ-runs met scheefstand in +X, −X, +Y en −Y, elk met één knikvorm",
    toetsRuns.length === 4 && toetsRuns.every(([, , analyse, , opties]) => analyse === "p-delta" && opties.bucklingModes === 1)
    && toetsRuns.map(([, , , s]) => `${s.richting > 0 ? "+" : "−"}${s.as}`).sort().join(" ") === "+x +y −x −y",
    JSON.stringify(toetsRuns.map(([, , a, s, o]) => [a, s, o?.bucklingModes])));
  check("de weergave toont de resultaten: lineair, de combinaties niet ontvouwd",
    toestand.openFem3dSolvedCombinations.length === 2
    && [...toestand.openFem3dCombinationResults.values()].every((r) => r.analysis === "linear"));
  check("de toets staat in de toestand: P-Δ, φ = 1/200, niet hergebruikt",
    toestand.openFem3dToets?.analyse?.soort === "tweedeOrdeGeometrisch" && toestand.openFem3dToets.analyse.phi === PHI
    && toestand.openFem3dToets.analyse.hergebruikt === false, JSON.stringify(toestand.openFem3dToets?.analyse));
  const staal = toestand.openFem3dChecks?.results?.[0];
  check("de staaltoets draaide (toetsbrug), zonder toetsfout", staal?.beam_id === 1 && toestand.openFem3dChecksError === null,
    String(toestand.openFem3dChecksError));
  // De kolom heeft een vrije kop. φ_toets = 1/200 ≥ φ van de kolom zelf
  // (EN 1993 (5.5), h = 4 m: α_h = 2/√4 = 1, m = 1 → 1/200), dus de kniklengte
  // is L = 4 m (5.2.2(7)b) in plaats van 2·L = 8 m bij de eerste orde van vóór #199.
  const stappen = staal?.checks?.find((c) => c.id === "6.3.1_buckling")?.kind?.data?.deelstappen ?? [];
  const lcr = (as) => stappen.find((s) => s.id === `l_cr_${as}`)?.value;
  check(`vrije kop: P-Δ met scheefstand in X en Y, dus L_cr,y = L_cr,z = L = 4000 mm, niet 2·L (kern ${lcr("y")} en ${lcr("z")})`,
    lcr("y") === 4000 && lcr("z") === 4000);

  const zwakApp = await berekenen(zwak);
  check("divergente toets: de resultaten staan (lineair, geen rekenfout)",
    zwakApp.toestand.openFem3dCombinationResults.size === 2 && zwakApp.toestand.openFem3dSolveError === null
    && zwakApp.toestand.openFem3dResult !== null);
  check("… de toetsing is geblokkeerd met de reden (P-Δ, α_cr) en zonder uitslag",
    /P-Δ/.test(zwakApp.toestand.openFem3dChecksError ?? "") && /alpha_cr|α_cr/.test(zwakApp.toestand.openFem3dChecksError)
    && zwakApp.toestand.openFem3dChecks === null && zwakApp.toestand.openFem3dToets?.weigering !== null,
    String(zwakApp.toestand.openFem3dChecksError));
  check("… en de toets loopt niet meer", zwakApp.toestand.openFem3dChecksRunning === false);

  const plaatApp = await berekenen(metPlaat);
  check("model met platen: de resultaten staan (lineair, zoals vóór #199), zonder rekenfout",
    plaatApp.toestand.openFem3dCombinationResults.size === 2 && plaatApp.toestand.openFem3dSolveError === null
    && [...plaatApp.toestand.openFem3dCombinationResults.values()].every((r) => r.analysis === "linear"));
  check("… de toets is geweigerd met de reden, zonder één toetsberekening en zonder uitslag",
    (plaatApp.toestand.openFem3dChecksError ?? "").includes(OPEN_FEM_3D_PLATES_NO_SECOND_ORDER)
    && plaatApp.kern.every(([, , , , opties]) => opties?.tweedeOrdeVerplicht !== true)
    && plaatApp.toestand.openFem3dChecks === null && plaatApp.toestand.openFem3dToets?.weigering !== null,
    String(plaatApp.toestand.openFem3dChecksError));
  // Het voorvoegsel komt uit i18n (ribbon:openFem3d.report.checksRefusedShort),
  // niet vast Nederlands in App.tsx.
  check("… met het vertaalde voorvoegsel 'geweigerd — ' (nl)",
    (plaatApp.toestand.openFem3dChecksError ?? "").startsWith("geweigerd — "), String(plaatApp.toestand.openFem3dChecksError));

  const pdApp = await berekenen(kolom, { analysetype: "tweedeOrdeGeometrisch", scheefstandAan: true });
  check("instelling P-Δ met scheefstand en dezelfde φ: de toets hergebruikt, geen extra kernaanroep",
    pdApp.toestand.openFem3dToets?.analyse?.hergebruikt === true
    // GEWIJZIGD door issue #194: 4 UGT- en nu ook 4 BGT-varianten (de BGT met
    // scheefstand in de resultaten, zoals 2D) = 8 resultaatruns; was 4 + 1 = 5.
    && pdApp.kern.every(([, , , , opties]) => opties?.tweedeOrdeVerplicht !== true) && pdApp.kern.length === 8,
    String(pdApp.kern.length));
}

log("\n[10] het 3D-rapport noemt de toetskrachten (taak 7)");
{
  // De rapportmodules importeren stylesheets; scripts/bron-uitvoeren.mjs heeft
  // de lader daarvoor al geregistreerd.
  await import("./scripts/i18n-voor-tests.mjs");
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const Report = (await import("./src/components/openFem3d/OpenFem3DReport.tsx")).default;
  const html = (toets) => renderToStaticMarkup(React.createElement(Report, {
    model: kolom, result: resLin.combinationResults.get(7), combinations: resLin.combinaties,
    combinationResults: resLin.combinationResults, toets,
  }));
  const tekst = (h) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
  const met = html(t1);
  check("de samenvatting: Toetskrachten (UGT) — 2e orde (P-Δ) + scheefstand φ = 1/200, naast de analyse 1e orde",
    /Toetskrachten \(UGT\) 2e orde \(P-Δ\) \+ scheefstand φ = 1\/200/.test(tekst(met)) && /Analyse 1e orde/.test(tekst(met)),
    tekst(met).slice(0, 400));
  const hoofdstuk = tekst(met.slice(met.indexOf("data-open-fem3d-toetskrachten")));
  check("het hoofdstuk Toetskrachten: P-Δ met φ = 1/200 (vaste noemer) in +X, −X, +Y en −Y, los van de instellingen",
    // Issue #194: de richtingen met hun φ (φ_X voor ±X, φ_Y voor ±Y).
    /UGT-toets rekent altijd een eigen tweede-ordeberekening \(P-Δ\) met scheefstand φ = 1\/200 \(vaste noemer\), elke UGT-combinatie in \+X en −X \(φ_X\) en \+Y en −Y \(φ_Y\)/.test(hoofdstuk),
    hoofdstuk.slice(0, 400));
  check("… met α_cr van de toets per basiscombinatie (1,808, uit de +X-berekening)",
    /UGT 6\.10b \(scheefstand \+X\) 1,80\d/.test(hoofdstuk), hoofdstuk.slice(0, 600));
  const geweigerd = tekst(html(t5));
  check("een geweigerde toets: 'Toetsing geweigerd' met de reden per combinatie",
    /Toetsing geweigerd: De toetskrachten zijn niet te bepalen/.test(geweigerd) && /• UGT 6\.10b/.test(geweigerd), geweigerd.slice(-600));
  check("zonder toets geen hoofdstuk en geen kaart", !/Toetskrachten/.test(tekst(html(null))));
}

log("\n[11] imperfectiegevallen (de scheefstand al als knooplasten): factor 0 in de UGT-toets");
// Een IFC-analysemodel kan de scheefstand als belastinggeval dragen
// (SYSTEM_IMPERFECTION, `LoadCase.imperfectie`). De toets rekent altijd met de
// scheefstand van de projectinstelling; met het geval erbij telde zij dubbel.
{
  const IMP = { id: 9, name: "UGT met imperfectie", type: "uls", formula: "1,2·G + 1,5·W + 1,0·Imp",
    factors: new Map([[1, 1.2], [4, 1.5], [6, 1.0]]) };
  const BGT_IMP = { id: 19, name: "BGT met imperfectie", type: "sls", formula: "G + W + Imp",
    factors: new Map([[1, 1], [4, 1], [6, 1]]) };
  const gevallen = [{ id: 1, name: "G" }, { id: 4, name: "W" }, { id: 6, name: "Imp +X", imperfectie: true }];
  const plan = (loadCases, resultaten) => planToetsKrachten3D({
    model: kolom, combinaties: [IMP, BGT_IMP], loadCases, resultaten,
    scheefstand: { project: projectScheefstand(kolom), normen: toepasselijkeScheefstandNormen3D(kolom), modelAan: true },
  });
  const p = plan(gevallen);
  check("vier toetsruns, elk met factor 0 op het imperfectiegeval en de overige factoren ongewijzigd",
    p.runs.length === 4 && p.runs.every((r) => r.combinatie.factors.get(6) === 0
      && r.combinatie.factors.get(1) === 1.2 && r.combinatie.factors.get(4) === 1.5),
    JSON.stringify(p.runs.map((r) => [...r.combinatie.factors])));
  check("de melding noemt het geval, factor 0 en de dubbeltelling",
    p.meldingen.some((m) => m.includes('"Imp +X"') && m.includes("op factor 0") && m.includes("dubbel")), p.meldingen.join(" | "));
  check("de combinatie van de resultaten zelf houdt haar factor (niet gemuteerd)", IMP.factors.get(6) === 1.0);
  // Ook met resultaten die P-Δ met dezelfde φ zijn: andere combinaties, dus geen hergebruik.
  const nep = { analysis: "p-delta" };
  const ontvouwd = metScheefstandRichtingen3D([IMP], true);
  const ph = plan(gevallen, { combinationResults: new Map(ontvouwd.map((c) => [c.id, nep])), phi: PHI });
  check("geen hergebruik van resultaten met het imperfectiegeval erin", ph.analyse.hergebruikt === false && ph.runs.length === 4);
  const zonder = plan([{ id: 1, name: "G" }, { id: 4, name: "W" }, { id: 6, name: "Imp +X" }]);
  check("zonder kenmerk: geen melding en de factor blijft (gedrag zoals voorheen)",
    !zonder.meldingen.some((m) => m.includes("op factor 0")) && zonder.runs.every((r) => r.combinatie.factors.get(6) === 1.0));
}

log("\n[12] geen UGT-toetscombinatie: de bouwers vallen niet terug op het actieve geval");
// Met alleen een BGT-combinatie heeft de toets geen krachten. Vroeger toetste
// de staalbouwer dan op `result` (het actieve geval: ongefactoreerd, eerste
// orde, zonder scheefstand) met de notitie "tweede orde met scheefstand".
{
  const res = await resultaatRekengang(kolom, [BGT], { analyse: "linear" });
  const { uitkomst: t12, runs: runs12 } = await toets(kolom, res);
  check("geen UGT: geen toetsruns en geen weigering", runs12.length === 0 && t12.weigering === null && t12.ugtCombinaties.length === 0);
  const set12 = toetsSet3D(t12, { combinaties: res.combinaties, combinationResults: res.combinationResults, loadCases: [] });
  const staal = buildOpenFem3DSteelCheckInputs(kolom, res.combinationResults.get(17), set12);
  check("staal: geen invoer, de staaf overgeslagen met de reden 'geen UGT-toetscombinatie'",
    staal.inputs.length === 0 && staal.skipped.some((s) => s.beamId === 1 && /geen UGT-toetscombinatie/.test(s.reason)),
    JSON.stringify(staal.skipped));
  const betonRes = await resultaatRekengang(betonModel(betonConfig), [QP], { analyse: "linear" });
  const { uitkomst: tb } = await toets(betonModel(betonConfig), betonRes);
  const setB = toetsSet3D(tb, { combinaties: betonRes.combinaties, combinationResults: betonRes.combinationResults, loadCases: [] });
  const beton = buildOpenFem3DConcreteCheckInputs(betonModel(betonConfig), betonRes.combinationResults.get(21), setB);
  check("beton: geen invoer, de staaf overgeslagen met dezelfde reden",
    beton.inputs.length === 0 && beton.skipped.some((s) => s.beamId === 1 && /geen UGT-toetscombinatie/.test(s.reason)),
    JSON.stringify(beton.skipped));
  // Zonder toetsset (een aanroeper buiten de toets) blijft de oude terugval.
  check("zonder toetsset: de terugval op het rekenresultaat blijft",
    buildOpenFem3DSteelCheckInputs(kolom, res.combinationResults.get(17)).inputs.length === 1);
}

log("\n[13] hout in 3D: de toets-φ minstens die van NEN-EN 1995-1-1 (5.1)");
// Een houten kolom van 4 m met een vaste noemer 300 in de projectinstelling.
// HAND: (5.1) φ = 0,005·√(5/h) met h ≤ 5 m → 0,005 = 1/200 > 1/300. De toets
// rekent dus 1/200, bron EN 1995, met de melding dat de φ is verhoogd; de
// runs in alle vier de richtingen dragen φ = 1/200.
{
  const hout = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: H }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "200x200", material: "C24" }],
    supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
    loads: [{ id: 1, nodeId: 2, fx: 0, fy: 0, fz: -50, mx: 0, my: 0, mz: 0, caseId: 1 }],
  });
  const normen = toepasselijkeScheefstandNormen3D(hout);
  check("normen van het houtmodel bevatten EN 1995", normen.includes("en1995"), JSON.stringify(normen));
  const p = planToetsKrachten3D({
    model: hout, combinaties: [UGT],
    scheefstand: { project: projectScheefstand(hout, 300), normen, modelAan: false },
  });
  check("toets-φ = 1/200, bron en1995 (verhoogd van de projectnoemer 1/300)",
    p.analyse.noemer === 200 && Math.abs(p.analyse.phi - 1 / 200) < 1e-15 && p.analyse.bron === "en1995", JSON.stringify(p.analyse));
  check("de runs rekenen met φ = 1/200 in alle vier de richtingen",
    p.runs.length === 4 && p.runs.every((r) => Math.abs(r.scheefstand.phi - 1 / 200) < 1e-15), JSON.stringify(p.runs.map((r) => r.scheefstand)));
  check("met de melding 'verhoogd naar φ = 1/200 volgens NEN-EN 1995-1-1 (5.1)' en de houtmelding",
    p.meldingen.some((m) => /verhoogd naar φ = 1\/200 volgens NEN-EN 1995-1-1 \(5\.1\)/.test(m))
      && p.meldingen.some((m) => /Hout in de toets/.test(m)), p.meldingen.join(" | "));
}

log("\n[14] opgegeven L_cr,z > L bij een kolom in 3D: de kanttekening dubbele sway om z");
// De kern zet "DUBBELE SWAY" alleen om y; in 3D rekent de toets ook in ±Y, dus
// zit de sway om de zwakke as ook in de krachten (B13). Geen getal verandert.
{
  const metLcrZ = (lCrZ) => parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: H }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA 200", material: "S235",
      checkConfig: { bucklingLengthZ_m: lCrZ } }],
    supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
    loads: [],
  });
  const notities = (lCrZ, set) => buildOpenFem3DSteelCheckInputs(metLcrZ(lCrZ), resLin.combinationResults.get(7), set)
    .inputs[0]?.staaf_notities ?? [];
  const n8 = notities(8, set1);
  check("L_cr,z = 8 m > L = 4 m met de toetsset: de kanttekening, met L_cr,z, L en de toets in ±Y",
    n8.some((n) => /DUBBELE SWAY OM z/.test(n) && /L_cr,z = 8\.000 mm/.test(n) && /L = 4\.000 mm/.test(n) && /\+Y en −Y/.test(n)),
    n8.filter((n) => /SWAY/.test(n)).join(" | "));
  check("L_cr,z = L: geen kanttekening", !notities(4, set1).some((n) => /DUBBELE SWAY OM z/.test(n)));
  check("zonder toetsset: geen kanttekening", !notities(8, undefined).some((n) => /DUBBELE SWAY OM z/.test(n)));
}

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

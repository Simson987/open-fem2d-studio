// Betonnen T- en L-doorsneden in 3D (issue #197).
//
// WAT ER MISGING
//  De 3D-adapter kende voor beton alleen de rechthoek. "T 400x450 bw=200
//  hf=50" werd geweigerd met "mist Iz en J voor een ruimtelijke berekening",
//  terwijl de 2D-solver A en I_y van dezelfde T al had.
//
// WAT DEZE TEST VASTLEGT (maten in mm)
//  [1] De gedeelde hulpfunctie `betonDoorsnedeGrootheden` tegen de hand:
//      T 400×450, b_w = 200, h_f = 50: flens 400×50, lijf 200×400.
//        A = 20 000 + 80 000 = 100 000 mm²
//        z_G = (20 000·425 + 80 000·200)/100 000 = 245 mm vanaf de onderrand
//        I_y = 400·50³/12 + 20 000·180² + 200·400³/12 + 80 000·45²
//            = 4,1667 + 648 + 1066,667 + 162 = 1880,833·10⁶ mm⁴
//        I_z = 50·400³/12 + 400·200³/12 = 533,333·10⁶ mm⁴ (lijf in het midden)
//        I_t = Σ deelrechthoeken (NEN-EN 1992-1-1 6.3.1(3)), Saint-Venant
//        A_v,z = 5/6·200·450 = 75 000, A_v,y = 5/6·A = 83 333 mm²
//      L met dezelfde maten: lijf aan de rand, y_G = 120 mm,
//        I_z = 266,667 + 20 000·80² + 266,667 + 80 000·20² = 693,333·10⁶ mm⁴,
//        I_yz = 20 000·80·180 + 80 000·(−20)·(−45) = 360·10⁶ mm⁴ (wordt
//        niet gebruikt: de rekenassen blijven de geometrische assen).
//      flens=onder geeft dezelfde A, I_y, I_z; een rechthoek b×h de bekende
//      waarden.
//  [2] De 2D-solver (`resolveSection`) leest A en I_y uit dezelfde functie,
//      met dezelfde getallen als vóór #197.
//  [3] Het 3D-verzoek: de T en de L geven A, I_y, I_z en I_t; met
//      afschuifvervorming ook A_v,y en A_v,z.
//  [4] De 3D-kern: een uitkraging L = 3 m van C30/37 (E_cm = 33 000 MPa)
//      met 10 kN aan het eind, w = P·L³/(3·E·I) om beide assen.
//
// Draaien met: npx tsx test-open-fem3d-beton-tl.mjs

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { betonDoorsnedeGrootheden, rechthoekTorsieconstante } = await import("./src/lib/betonDoorsnedeGrootheden.ts");
const { parseConcreteSection } = await import("./src/lib/betonCheckBuilder.ts");
const { resolveSection, CONCRETE_E_CM } = await import("./src/lib/sectionResolver.ts");
const { parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { buildOpenFem3DSolveRequest } = await import("./src/components/openFem3d/openFem3dSolver.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? ` — ${extra}` : ""}`); }
}
function check(naam, waarde, verwacht, relTol = 1e-9) {
  const goed = Number.isFinite(waarde) && Math.abs(waarde - verwacht) <= relTol * Math.max(1, Math.abs(verwacht));
  ok(`${naam}: ${Number(waarde).toPrecision(8)} ≈ ${Number(verwacht).toPrecision(8)}`, goed);
}
const lees = (naam) => {
  const u = parseConcreteSection(naam);
  if (!u.ok) throw new Error(u.reden);
  return betonDoorsnedeGrootheden(u.doorsnede);
};

const T = "T 400x450 bw=200 hf=50";
const Lv = "L 400x450 bw=200 hf=50";
const IY_HAND = 400 * 50 ** 3 / 12 + 20000 * 180 ** 2 + 200 * 400 ** 3 / 12 + 80000 * 45 ** 2;
const IT_HAND = rechthoekTorsieconstante(400, 50) + rechthoekTorsieconstante(200, 400);

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] De gedeelde hulpfunctie tegen de hand");
// ─────────────────────────────────────────────────────────────────────────
{
  const t = lees(T);
  check("T: A = 100 000 mm²", t.A, 100000);
  check("T: I_y = 1880,833·10⁶ mm⁴", t.Iy, IY_HAND);
  check("T: I_y (getal)", t.Iy / 1e6, 1880.8333333333, 1e-9);
  check("T: I_z = 533,333·10⁶ mm⁴", t.Iz, 50 * 400 ** 3 / 12 + 400 * 200 ** 3 / 12);
  check("T: I_yz = 0 (symmetrisch)", t.Iyz, 0);
  check("T: I_t = I_t(400×50) + I_t(200×400)", t.It, IT_HAND);
  // Saint-Venant met de hand: 400·50³·(1/3 − 0,21·0,125·(1 − 0,125⁴/12)) en
  // 400·200³·(1/3 − 0,21·0,5·(1 − 0,5⁴/12)).
  const flens = 400 * 50 ** 3 * (1 / 3 - 0.21 * 0.125 * (1 - 0.125 ** 4 / 12));
  const lijf = 400 * 200 ** 3 * (1 / 3 - 0.21 * 0.5 * (1 - 0.5 ** 4 / 12));
  check("T: I_t = 15,354 + 732,42 = 747,77·10⁶ mm⁴", t.It, flens + lijf);
  check("T: A_v,z = 5/6·b_w·h = 75 000 mm²", t.AvZ, 75000);
  check("T: A_v,y = 5/6·A = 83 333 mm²", t.AvY, 100000 * 5 / 6);

  const l = lees(Lv);
  check("L: A gelijk aan de T", l.A, 100000);
  check("L: I_y gelijk aan de T", l.Iy, IY_HAND);
  check("L: I_z = 693,333·10⁶ mm⁴ (lijf aan de rand, y_G = 120)", l.Iz,
    50 * 400 ** 3 / 12 + 20000 * 80 ** 2 + 400 * 200 ** 3 / 12 + 80000 * 20 ** 2);
  check("L: I_yz = 360·10⁶ mm⁴", l.Iyz, 360e6);
  check("L: I_t gelijk aan de T", l.It, IT_HAND);

  const onder = lees("T 400x450 bw=200 hf=50 flens=onder");
  ok("flens=onder: dezelfde A, I_y, I_z en I_t", onder.A === t.A && onder.Iy === t.Iy && onder.Iz === t.Iz && onder.It === t.It);

  const r = lees("300x500");
  check("rechthoek 300×500: I_y = b·h³/12", r.Iy, 300 * 500 ** 3 / 12);
  check("rechthoek 300×500: I_z = h·b³/12", r.Iz, 500 * 300 ** 3 / 12);
  check("rechthoek 300×500: A_v,y = A_v,z = 5/6·b·h", r.AvY, 125000);
  ok("rechthoek: A_v,z = A_v,y", r.AvZ === r.AvY);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] De 2D-solver uit dezelfde functie, met dezelfde getallen");
// ─────────────────────────────────────────────────────────────────────────
{
  const t = resolveSection("C30/37", T);
  ok("T: bron beton-vorm", t.bron === "beton-vorm", t.bron);
  check("T: A", t.A, 100000);
  check("T: I = I_y (ongewijzigd t.o.v. vóór #197)", t.I, IY_HAND);
  const r = resolveSection("C30/37", "300x500");
  ok("rechthoek: bron beton-bxh", r.bron === "beton-bxh", r.bron);
  check("rechthoek: I = b·h³/12", r.I, 300 * 500 ** 3 / 12);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] Het 3D-verzoek");
// ─────────────────────────────────────────────────────────────────────────
const LENGTE = 3;
const P = 10;
const model = (profileName, extra = {}, last = { fz: -P }) => parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: LENGTE, y: 0, z: 0 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, material: "C30/37", profileName, ...extra }],
  supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
  loads: [{ id: 1, nodeId: 2, caseId: 1, fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0, ...last }],
});
let verzoekT = null, verzoekL = null;
{
  let fout = null;
  try { verzoekT = buildOpenFem3DSolveRequest(model(T), "linear", 1); } catch (e) { fout = e.message; }
  ok("T: geen weigering meer (was: mist Iz en J)", verzoekT !== null, fout ?? "");
  const s = verzoekT?.sections[0];
  check("T: areaM2", s?.areaM2, 0.1);
  check("T: iyM4", s?.iyM4, IY_HAND * 1e-12);
  check("T: izM4", s?.izM4, (50 * 400 ** 3 / 12 + 400 * 200 ** 3 / 12) * 1e-12);
  check("T: torsionJM4", s?.torsionJM4, IT_HAND * 1e-12);
  ok("T zonder afschuifvervorming: geen afschuifoppervlakken", s?.shearAreaYM2 === undefined && s?.shearAreaZM2 === undefined);
  const metAfschuiving = buildOpenFem3DSolveRequest(model(T, { shearDeformation: true }), "linear", 1).sections[0];
  check("T met afschuifvervorming: shearAreaZM2 = 0,075 m²", metAfschuiving.shearAreaZM2, 0.075);
  check("T met afschuifvervorming: shearAreaYM2 = 0,08333 m²", metAfschuiving.shearAreaYM2, 100000 * 5 / 6 * 1e-6);
  verzoekL = buildOpenFem3DSolveRequest(model(Lv), "linear", 1);
  check("L: izM4", verzoekL.sections[0].izM4, 693.3333333333e6 * 1e-12, 1e-9);
  let foutT2 = null;
  try { buildOpenFem3DSolveRequest(model("T 400x450 hf=50"), "linear", 1); } catch (e) { foutT2 = e.message; }
  ok("T zonder bw: nog steeds een duidelijke weigering", foutT2 !== null && /lijfbreedte|bw/.test(foutT2), foutT2 ?? "geen fout");
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] De 3D-kern: uitkraging 3 m, 10 kN aan het eind");
// ─────────────────────────────────────────────────────────────────────────
{
  const kern = process.env.OPEN_FEM_3D_SOLVER_PATH
    ?? fileURLToPath(new URL(`../src-tauri/target/debug/open-fem-3d${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
  if (!existsSync(kern)) {
    ok(`3D-kern aanwezig (bouw: cargo build -p open-fem-3d) — ${kern}`, false);
  } else {
    const los = (verzoek) => {
      const run = spawnSync(kern, [], { input: JSON.stringify({ ...verzoek, bucklingModes: 0 }) });
      if (run.status !== 0) throw new Error(run.stderr.toString());
      return JSON.parse(run.stdout.toString()).displacements.find((d) => d.nodeId === 2);
    };
    const E = CONCRETE_E_CM["C30/37"] * 1000; // kN/m²
    const w = (I) => P * LENGTE ** 3 / (3 * E * I * 1e-12);
    const uz = los(verzoekT).uz;
    check(`T, F_z: w = P·L³/(3·E·I_y) = ${w(IY_HAND).toExponential(5)} m`, -uz, w(IY_HAND), 1e-6);
    const uy = los(buildOpenFem3DSolveRequest(model(T, {}, { fy: -P }), "linear", 1)).uy;
    check(`T, F_y: w = P·L³/(3·E·I_z) = ${w(533.3333333333e6).toExponential(5)} m`, -uy, w(533.3333333333e6), 1e-6);
    const uyL = los(buildOpenFem3DSolveRequest(model(Lv, {}, { fy: -P }), "linear", 1)).uy;
    check("L, F_y: w = P·L³/(3·E·I_z) om de geometrische as", -uyL, w(693.3333333333e6), 1e-6);
  }
}

log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);

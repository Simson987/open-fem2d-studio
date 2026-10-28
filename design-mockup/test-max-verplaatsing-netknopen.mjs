// #228: de grootste verplaatsing in de samenvatting telt de netknopen van
// platen en schijven mee, per belastinggeval, per combinatie, in de omhullende
// en in de 3D-app.
//
//   [1] 2D-wandschijf 6000 × 600 × 20 mm, staal (E = 210 000, ν = 0,3), Quad4,
//       meshSize 100, scharnier links onder, rol rechts onder, bovenrand
//       q = −10 kN/m. Handberekening: I = 20·600³/12 = 3,6·10⁸ mm⁴,
//       buiging 5qL⁴/(384EI) = 2,232 mm, met afschuiving en dwarscontractie
//       circa 2,283 mm. Een belastinggeval gaf 2,309 mm; de combinatie 1,0·G
//       en de omhullende gaven 0,732 mm (alleen ux van hoekknoop 2). Nu
//       moeten alle drie gelijk zijn.
//   [2] 3D-plaatstrook 6,0 × 1,0 m, dikte 0,20 m, C30/37, vier hoeken
//       opgelegd, q = −5 kN/m². Hand (ligger): 5qL⁴/(384·E_cm·I) met
//       E_cm = 32 837 N/mm², I = 1·0,2³/12 → 3,85 mm. De samenvatting gaf
//       0 mm (alleen de hoekknopen van het model).
//
// Uitvoeren: npx tsx test-max-verplaatsing-netknopen.mjs   (vanuit design-mockup/)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { solveAllCases } = await import("./src/components/fem/solver/engine.ts");
const { combineResults, computeEnvelope } = await import("./src/components/fem/solver/combinations.ts");
const { parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { meshOpenFem3DPlates } = await import("./src/components/openFem3d/openFem3dPlateMesh.ts");
const { buildOpenFem3DSolveRequest } = await import("./src/components/openFem3d/openFem3dSolver.ts");
const { openFem3DMaximumDisplacementM } = await import("./src/components/openFem3d/openFem3dDisplacement.ts");
const { CONCRETE_E_CM } = await import("./src/lib/sectionResolver.ts");

const stil = console.log;
console.log = (...args) => { if (!String(args[0] ?? "").startsWith("[TriangleService]")) stil(...args); };

let failed = 0;
function check(naam, ok, detail = "") {
  stil(`  ${ok ? "✓" : "✗"} ${naam}${detail ? `: ${detail}` : ""}`);
  if (!ok) failed++;
}

// ─────────────────────────────────────────────────────────────────────────
stil("\n[1] 2D-wandschijf: belastinggeval, combinatie en omhullende gelijk");
{
  const L = 6000, H = 600, T = 20, E = 210000, q = 10; // mm, N/mm², N/mm = kN/m
  const model = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: L, z: 0 }, { id: 3, x: L, z: H }, { id: 4, x: 0, z: H }],
    beams: [],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
    loads: [],
    plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thickness: T, E, nu: 0.3, rho: 7850, meshSize: 100, meshType: "vierhoeken" }],
    edgeLoads: [{ plateId: 1, caseId: 1, edge: "top", p: -q, dir: "z" }],
    cases: [{ id: 1, name: "G" }],
  };
  const { perCase } = solveAllCases(model);
  const geval = perCase.get(1);
  const I = T * H ** 3 / 12;
  const buiging = 5 * q * L ** 4 / (384 * E * I);
  check("hand: buiging 5qL⁴/(384EI) = 2,232 mm", Math.abs(buiging - 2.232) < 1e-3, buiging.toFixed(4));
  check("belastinggeval: u_max ≈ 2,283 mm (binnen 3 %)", Math.abs(geval.maxDisplacement / 2.283 - 1) < 0.03,
    geval.maxDisplacement.toFixed(4));
  check("belastinggeval draagt de netknopen", (geval.plateNodeDisplacements?.size ?? 0) > 4,
    String(geval.plateNodeDisplacements?.size));
  const combo = { id: 1, name: "1,0·G", type: "sls", formula: "1,0·G", factors: new Map([[1, 1.0]]) };
  const comb = combineResults(combo, perCase);
  check("combinatie 1,0·G: u_max = belastinggeval (was 0,732 mm)",
    Math.abs(comb.maxDisplacement - geval.maxDisplacement) < 1e-9 * geval.maxDisplacement,
    `${comb.maxDisplacement.toFixed(6)} tegen ${geval.maxDisplacement.toFixed(6)}`);
  const env = computeEnvelope([combo], perCase);
  check("omhullende: u_max = belastinggeval",
    Math.abs(env.maxDisplacement - geval.maxDisplacement) < 1e-9 * geval.maxDisplacement, env.maxDisplacement.toFixed(6));
  const anderhalf = combineResults({ ...combo, id: 2, factors: new Map([[1, 1.35]]) }, perCase);
  check("combinatie 1,35·G: u_max = 1,35 × belastinggeval (lineair)",
    Math.abs(anderhalf.maxDisplacement - 1.35 * geval.maxDisplacement) < 1e-9 * geval.maxDisplacement,
    anderhalf.maxDisplacement.toFixed(6));
}

// ─────────────────────────────────────────────────────────────────────────
stil("\n[2] 3D-plaatstrook op vier hoeken: maxVerplaatsing telt de netknopen");
const solverBinary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${solverBinary}`, import.meta.url));
if (!existsSync(solverPath)) {
  check("3D-kern gevonden — bouw hem met `cargo build -p open-fem-3d`", false, solverPath);
} else {
  const reken = (request) => new Promise((resolve, reject) => {
    const child = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] });
    const uit = [];
    child.stdout.on("data", (d) => uit.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      const tekst = Buffer.concat(uit).toString();
      if (code !== 0) return reject(new Error(`3D-kern: exit ${code}; ${tekst.slice(0, 600)}`));
      try { resolve(JSON.parse(tekst)); } catch (e) { reject(e); }
    });
    child.stdin.end(JSON.stringify(request));
  });
  const knoop = (id, x, y, z) => ({ id, x, y, z });
  const model = parseOpenFem3DModel({
    nodes: [knoop(1, 0, 0, 0), knoop(2, 6, 0, 0), knoop(3, 6, 1, 0), knoop(4, 0, 1, 0)],
    beams: [],
    plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2, material: "C30/37", meshSizeM: 0.25 }],
    supports: [
      { nodeId: 1, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false },
      { nodeId: 2, ux: false, uy: true, uz: true, rx: false, ry: false, rz: false },
      { nodeId: 3, ux: false, uy: false, uz: true, rx: false, ry: false, rz: false },
      { nodeId: 4, ux: false, uy: false, uz: true, rx: false, ry: false, rz: false },
    ],
    surfaceLoads: [{ id: 1, plateId: 1, caseId: 1, qx: 0, qy: 0, qz: -5 }],
  });
  const mesh = await meshOpenFem3DPlates(model);
  const request = { ...buildOpenFem3DSolveRequest(model, "linear", 1, mesh), bucklingModes: 0 };
  const r = await reken(request);
  const result = { ...r, plateMesh: mesh };
  const ligger = (eMpa) => 5 * 5 * 6 ** 4 / (384 * eMpa * 1000 * (1 * 0.2 ** 3 / 12)) * 1000; // mm
  check("hand uit het issue: E_cm = 32 837 N/mm² → w = 3,85 mm", Math.abs(ligger(32837) - 3.85) < 0.01, ligger(32837).toFixed(4));
  // De app rekent met E_cm uit EN 1992-1-1 tabel 3.1 (C30/37: 33 000 N/mm²).
  const hand = ligger(CONCRETE_E_CM["C30/37"]);
  check("hand met de E_cm van de app (33 000 N/mm²): w = 3,835 mm", Math.abs(hand - 3.835) < 0.001, hand.toFixed(4));
  const netMax = Math.max(...r.displacements.map((d) => Math.hypot(d.ux, d.uy, d.uz))) * 1000;
  const samenvatting = openFem3DMaximumDisplacementM(model, result) * 1000;
  check("samenvatting = grootste netknoopverplaatsing (was 0 mm)", Math.abs(samenvatting - netMax) < 1e-9 * netMax,
    `${samenvatting.toFixed(4)} tegen ${netMax.toFixed(4)} mm`);
  check("samenvatting ≈ hand 3,85 mm (binnen 3 %)", Math.abs(samenvatting / hand - 1) < 0.03, samenvatting.toFixed(4));
  const zonderNet = openFem3DMaximumDisplacementM(model, r) * 1000;
  check("zonder rekennet in het resultaat blijven alleen de (opgelegde) hoekknopen: 0 mm", zonderNet < 1e-9,
    zonderNet.toExponential(2));
}

stil(failed === 0 ? "\nmaximale verplaatsing met netknopen: geslaagd" : `\n${failed} controle(s) mislukt`);
if (failed > 0) process.exit(1);

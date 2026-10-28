// Kipsteunen en kniklengtes in de 3D-staaltoets. De toetsinstellingen van de
// staaf (zoals in 2D) gaan naar de kern. Een ligger die de last van een vloer-
// of dakvlak draagt, krijgt zonder eigen opgave een doorgaand gesteunde
// bovenflens, als zichtbare aanname.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const { parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { buildOpenFem3DSolveRequest } = await import("./src/components/openFem3d/openFem3dSolver.ts");
const { buildOpenFem3DSteelCheckInputs, liggersOnderVloerOfDak } = await import("./src/components/openFem3d/openFem3dSteelCheck.ts");
const HIER = dirname(fileURLToPath(import.meta.url));
let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => { if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); } };

// Vloerveld 6 (X) × 4 (Y) m op +3 m op vier kolommen. Het vlak overspant in X,
// dus de twee liggers langs Y (staaf 5 en 6) dragen; de randliggers langs X
// (7 en 8) liggen evenwijdig aan de overspanning en dragen niets.
const nodes = [
  { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6, y: 4, z: 0 }, { id: 4, x: 0, y: 4, z: 0 },
  { id: 5, x: 0, y: 0, z: 3 }, { id: 6, x: 6, y: 0, z: 3 }, { id: 7, x: 6, y: 4, z: 3 }, { id: 8, x: 0, y: 4, z: 3 },
];
const staaf = (id, a, b, profileName, extra = {}) => ({ id, startNodeId: a, endNodeId: b, profileName, material: "S235", ...extra });
const scharnier = { myStart: true, myEnd: true, mzStart: true, mzEnd: true, torsionStart: false, torsionEnd: false };
const model = parseOpenFem3DModel({
  nodes,
  beams: [
    staaf(1, 1, 5, "HEB 200"), staaf(2, 2, 6, "HEB 200"), staaf(3, 3, 7, "HEB 200"),
    staaf(4, 4, 8, "HEB 200", { checkConfig: { bucklingLengthY_m: 2.5, bucklingLengthZ_m: 1.5 } }),
    staaf(5, 5, 8, "IPE 270", { releases: scharnier }),                                                    // draagt: aanname
    staaf(6, 6, 7, "IPE 270", { releases: scharnier, checkConfig: { lateralRestraints: [0.5] } }),          // draagt: eigen steun
    staaf(7, 5, 6, "IPE 240", { releases: scharnier }), staaf(8, 8, 7, "IPE 240", { releases: scharnier }), // evenwijdig
  ],
  supports: [1, 2, 3, 4].map((nodeId) => ({ nodeId, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true })),
  loadPanels: [{ id: 1, nodeIds: [5, 6, 7, 8], caseId: 1, q: 5, direction: "gravity", distribution: "oneWay", spanDirection: { x: 1, y: 0, z: 0 } }],
});

log("[1] welke liggers onder het vloervlak liggen");
check("de twee dragende liggers (dwars op de overspanning), niet de randliggers",
  JSON.stringify([...liggersOnderVloerOfDak(model)].sort()) === "[5,6]", JSON.stringify([...liggersOnderVloerOfDak(model)]));
const wand = parseOpenFem3DModel({ ...model, loadPanels: [{ ...model.loadPanels[0], direction: "normal" }] });
check("een windvlak (loodrecht op het vlak) steunt geen flens", liggersOnderVloerOfDak(wand).size === 0);

log("\n[2] de toetsinvoer (met de 3D-kern)");
const solverBinary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH ?? join(HIER, "..", "src-tauri", "target", "debug", solverBinary);
if (!existsSync(solverPath)) {
  log("  · overgeslagen: bouw eerst de 3D-kern (cargo build -p open-fem-3d)");
} else {
  const request = { ...buildOpenFem3DSolveRequest(model, "linear", 1), bucklingModes: 0 };
  const result = await new Promise((ok, fout) => {
    const c = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] }); const uit = [];
    c.stdout.on("data", (d) => uit.push(d)); c.on("error", fout);
    c.on("close", () => { try { ok(JSON.parse(Buffer.concat(uit).toString())); } catch (e) { fout(e); } });
    c.stdin.end(JSON.stringify(request));
  });
  const { inputs } = buildOpenFem3DSteelCheckInputs(model, result);
  const invoer = (id) => inputs.find((i) => i.beam_id === id);
  check("dragende ligger zonder opgave: bovenflens om de L/10 gesteund, onderflens vrij",
    JSON.stringify(invoer(5).lateral_bracing) === JSON.stringify({ top_flange_positions: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9], bottom_flange_positions: [] }));
  check("… en de aanname staat bij de staaf", invoer(5).staaf_notities.some((n) => /bovenflens is doorgaand gesteund/.test(n)));
  check("eigen kipsteun gaat voor de aanname", JSON.stringify(invoer(6).lateral_bracing.top_flange_positions) === "[0.5]"
    && !invoer(6).staaf_notities.some((n) => /bovenflens is doorgaand gesteund/.test(n)));
  check("randligger evenwijdig aan de overspanning: geen steun", invoer(7).lateral_bracing.top_flange_positions.length === 0);
  check("kniklengtes uit de toetsinstellingen", invoer(4).buckling_length_y_m === 2.5 && invoer(4).buckling_length_z_m === 1.5);
  check("zonder opgave 0: de kern kiest de staaflengte", invoer(1).buckling_length_y_m === 0 && invoer(1).buckling_length_z_m === 0);
}

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

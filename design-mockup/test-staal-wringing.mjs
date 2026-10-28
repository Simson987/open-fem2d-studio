// Staaltoets: wringing volgens NEN-EN 1993-1-1 6.2.7 langs de 3D-route (#249).
//
// ── WAAROM DEZE TEST BESTAAT ───────────────────────────────────────────────
//
// De 3D-kern berekent het wringend moment (mt_ed in de krachtentoestand),
// maar de staaltoets kende 6.2.7 niet: een uitkraging CHS 88,9×4 S235 met
// |T_Ed| = 1,35·5 = 6,75 kNm kreeg status Ok met UC 0. Handberekening
// (Saint-Venant, gesloten buis):
//
//   I_t = 1 926 800 mm⁴, r = 44,45 mm  →  W_t = I_t/r = 43 347,6 mm³
//   τ_t,Ed = 6,75·10⁶/43 347,6 = 155,7 N/mm²
//   τ_Rd   = f_y/(√3·γ_M0) = 235/√3 = 135,7 N/mm²
//   T_Rd   = 135,68·43 347,6 = 5,881 kNm  →  UC = 6,75/5,881 = 1,148, NotOk
//
// Een open IPE 300 onder wringing kan de kern niet toetsen (de welving en het
// bimoment komen niet uit de staafanalyse): 6.2.7 staat dan als "n.v.t." met
// reden, en de staaf is NIET VOLLEDIG GETOETST — nooit Ok.
//
// De toets loopt door de 3D-staalbouwer (`openFem3dSteelCheck`) en de
// toetsbrug als apart proces. Ontbreekt die binary, dan faalt deze test luid:
// bouw hem met  cargo build --release -p toetsbrug  (src-tauri).
//
// Uitvoeren: npx tsx test-staal-wringing.mjs   (vanuit design-mockup/)
//        of: node scripts/run-tests.mjs --filter=staal-wringing

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const TOETSBRUG = join(
  resolve(HIER, ".."), "src-tauri", "target", "release",
  process.platform === "win32" ? "toetsbrug.exe" : "toetsbrug",
);

const { parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { buildOpenFem3DSteelCheckInputs, openFem3DUlsUc } =
  await import("./src/components/openFem3d/openFem3dSteelCheck.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}${extra ? ` — ${extra}` : ""}`); }
  else            { failed++; log(`  ✗ ${naam}${extra ? ` — ${extra}` : ""}`); }
}
const dichtbij = (a, b, rel) => Math.abs(a - b) <= rel * Math.abs(b);

const kern = (opdracht, inputs) => {
  const r = spawnSync(TOETSBRUG, [], {
    input: JSON.stringify({ opdracht, inputs }),
    maxBuffer: 64 * 1024 * 1024,
    encoding: "utf8",
  });
  if (r.error) throw r.error;
  const data = JSON.parse(r.stdout);
  if (data && !Array.isArray(data) && typeof data === "object" && "fout" in data) throw new Error(data.fout);
  return data;
};
const toets = (resultaat, id) => resultaat.checks.find((c) => c.id === id)?.kind?.data;

/** Een uitkraging van 1 m langs x, ingeklemd in knoop 1, met overal T = t kNm. */
function uitkraging(profileName, t) {
  const model = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 1, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName, material: "S235" }],
    supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
    loads: [], memberLoads: [], memberPointLoads: [],
  });
  const nul = (nodeId) => ({ nodeId, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 });
  const resultaat = {
    displacements: [nul(1), nul(2)],
    memberForces: [{
      memberId: 1, lengthM: 1,
      nStartKn: 0, nEndKn: 0, vyStartKn: 0, vyEndKn: 0, vzStartKn: 0, vzEndKn: 0,
      torsionStartKnm: t, torsionEndKnm: t, myStartKnm: 0, myEndKnm: 0, mzStartKnm: 0, mzEndKnm: 0,
    }],
  };
  return buildOpenFem3DSteelCheckInputs(model, resultaat);
}

log("\n[1] De 3D-staalbouwer geeft het wringend moment door");
const chs = uitkraging("CHS 88.9x4", -6.75);
ok("de staaf wordt getoetst", chs.inputs.length === 1, JSON.stringify(chs.skipped));
ok("mt_ed = −6,75 kNm in de omhullende",
  chs.inputs[0]?.forces_envelope?.every((p) => Math.abs(Math.abs(p.forces.mt_ed) - 6.75) < 1e-12),
  JSON.stringify(chs.inputs[0]?.forces_envelope?.[0]?.forces));

if (!existsSync(TOETSBRUG)) {
  failed++;
  log(`\n  ✗ de rekenkern ontbreekt: ${TOETSBRUG}`);
  log("    bouw hem met  cargo build --release -p toetsbrug  vanuit src-tauri.");
} else {
  log("\n[2] CHS 88,9×4 S235, |T_Ed| = 6,75 kNm: 6.2.7 voldoet niet");
  const [r] = kern("check_steel_beams", chs.inputs);
  const w = toets(r, "6.2.7_torsion");
  const wT = 1_926_800 / 44.45;
  const tRd = (235 / Math.sqrt(3)) * wT * 1e-6;
  ok("T_Rd = 135,68·43 347,6 = 5,881 kNm", w && dichtbij(w.value, tRd, 1e-9) && dichtbij(w.value, 5.881, 1e-3),
    `${w?.value}`);
  ok("UC = 6,75/5,881 = 1,148", w?.uc && dichtbij(w.uc.uc, 6.75 / tRd, 1e-9), `${w?.uc?.uc}`);
  ok("status van de staaf NotOk, 6.2.7 maatgevend",
    r.status === "NotOk" && r.governing_check_id === "6.2.7_torsion", `${r.status} ${r.governing_check_id}`);
  ok("de UGT-UC in de 3D-weergave is de wring-UC", dichtbij(openFem3DUlsUc(r), 6.75 / tRd, 1e-9),
    `${openFem3DUlsUc(r)}`);

  log("\n[3] IPE 300 onder wringing: niet getoetst, nooit Ok");
  const [i] = kern("check_steel_beams", uitkraging("IPE 300", 1.0).inputs);
  const wi = toets(i, "6.2.7_torsion");
  ok("6.2.7 n.v.t. met reden (welving)", wi?.status === "NotApplicable" && wi.uc === null
    && wi.notes[0].includes("welving"), wi?.notes?.[0]);
  ok("staaf NIET VOLLEDIG GETOETST", i.status === "NotApplicable"
    && i.governing_check_id.startsWith("NIET VOLLEDIG GETOETST"), `${i.status} ${i.governing_check_id}`);
}

log(`\n${failed === 0 ? "ALLES GOED" : "FOUTEN"} — ${passed} geslaagd, ${failed} gefaald`);
process.exit(failed === 0 ? 0 : 1);

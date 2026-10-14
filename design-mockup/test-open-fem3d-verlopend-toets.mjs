// Verlopende profielen in 3D (issue #73) — de TOETSING.
//
// WAT HIER BEWEZEN WORDT
//   [1] De 3D-toetsinvoer van een verlopende staaf draagt `profile_end` precies
//       zoals de 2D-bouwer het doet (zelfde profielnamen); een prismatische
//       staaf houdt een invoer zonder het veld.
//   [2] De echte kern (toetsbrug): de 3D-staaltoets van een verlopende stalen
//       uitkrager IPE 400 → IPE 200 (L = 6 m, M = 200·(1 − u) kNm) geeft
//       dezelfde toetsdoorsneden, hetzelfde maatgevende punt en dezelfde
//       doorsnedetoetsen als de 2D-staaltoets met dezelfde krachten
//       (test-verlopend-toetsing.mjs [4]), en de handwaarde van daar:
//         u = 0,4: h = 320, b = 148, t_w = 7,4, t_f = 11,5
//         W_pl = 148·11,5·308,5 + 7,4·297²/4 = 688 253,65 mm³
//         M_Rd = 161,74 kNm → UC = 120/161,74 = 0,741936 op x = 2400 mm.
//
// Draaien met: npx tsx test-open-fem3d-verlopend-toets.mjs
// De kern: `cargo build --release -p toetsbrug` (zonder kern faalt de test met die melding).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HIER, "..");
const TOETSBRUG = join(REPO, "src-tauri", "target", "release", process.platform === "win32" ? "toetsbrug.exe" : "toetsbrug");

const { parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { buildOpenFem3DSteelCheckInputs } = await import("./src/components/openFem3d/openFem3dSteelCheck.ts");
const { solveAllCases } = await import("./src/components/fem/solver/engine.ts");
const { defaultCombinations, combineResults } = await import("./src/components/fem/solver/combinations.ts");
const { selecteerCombinaties } = await import("./src/lib/combinatieSelectie.ts");
const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");
const { buildSteelCheckInputs, profileLookupKey } = await import("./src/lib/steelCheckBuilder.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
}
function rel(naam, gemeten, verwacht, tolRel) {
  const afw = Math.abs(gemeten - verwacht) / Math.max(Math.abs(verwacht), 1e-300);
  ok(naam, Number.isFinite(gemeten) && afw <= tolRel, `${Number(gemeten).toPrecision(7)} vs ${verwacht.toPrecision(7)}`);
}

const L = 6;
/** Een uitkrager van 6 m langs X, ingeklemd in knoop 1; `eind` = eindprofiel of niets. */
const model3d = (eind) => parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE400", material: "S235", ...(eind ? { profileNameEnd: eind } : {}) }],
  supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
});
/** Een rekenuitkomst met M_y = 200·(1 − u) kNm op elf stations (de krachten van de 2D-referentie). */
const uitkomst = {
  displacements: [1, 2].map((nodeId) => ({ nodeId, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 })),
  memberForces: [{
    memberId: 1, lengthM: L, nStartKn: 0, nEndKn: 0, vyStartKn: 0, vyEndKn: 0, vzStartKn: 0, vzEndKn: 0,
    torsionStartKnm: 0, torsionEndKnm: 0, myStartKnm: 200, myEndKnm: 0, mzStartKnm: 0, mzEndKnm: 0,
  }],
  diagrams: {
    momentY: [{ memberId: 1, points: Array.from({ length: 11 }, (_, i) => ({ t: i / 10, value: 200 * (1 - i / 10) })) }],
    momentZ: [], shearY: [], shearZ: [], axial: [], torsion: [],
  },
};

log("\n[1] De toetsinvoer: profile_end zoals in 2D");
const verlopend = buildOpenFem3DSteelCheckInputs(model3d("IPE200"), uitkomst).inputs[0];
const prismatisch = buildOpenFem3DSteelCheckInputs(model3d(undefined), uitkomst).inputs[0];
ok("3D: profile_name en profile_end", verlopend.profile_name === "IPE400" && verlopend.profile_end === "IPE200",
  `${verlopend.profile_name} → ${verlopend.profile_end}`);
ok("3D prismatisch: geen profile_end", !("profile_end" in prismatisch));
// Alleen de zakking verschilt: die volgt uit M/EI(x) met I per deel (de verlopende staaf is slapper).
const { profile_end: _weg, deflection_actual_max_mm: wVerlopend, ...zonder } = verlopend;
const { deflection_actual_max_mm: wPrismatisch, ...prismatischZonder } = prismatisch;
ok("verder gelijk aan de prismatische invoer (op de zakking na)", JSON.stringify(zonder) === JSON.stringify(prismatischZonder));
ok("de veldzakking volgt I(x): de verlopende staaf zakt meer", Math.abs(wVerlopend) > Math.abs(wPrismatisch),
  `${wVerlopend.toFixed(3)} mm tegen ${wPrismatisch.toFixed(3)} mm`);
// De 2D-bouwer op dezelfde staaf (een ligger op twee steunpunten): dezelfde velden.
const PROFIELEN = JSON.parse(readFileSync(join(REPO, "src-tauri", "crates", "steel-profiles", "data", "profiles.json"), "utf8"));
const profileDb = new Map();
for (const p of PROFIELEN) { const k = profileLookupKey(p.name); if (!profileDb.has(k)) profileDb.set(k, p); }
const m2 = {
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }],
  beams: [{ id: 1, from: 1, to: 2, material: "S235", profile: "IPE400", profileEnd: "IPE200" }],
  supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
  plates: [], loadCases: [{ id: 1, name: "G", type: "dead" }], loads: [{ id: 1, type: "lineLoad", caseId: 1, beamId: 1, q: -10 }],
  selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
};
const { perCase } = solveAllCases(bouwMultiInput(m2));
const combinations = selecteerCombinaties(defaultCombinations(m2.loadCases), m2.beams, m2.plates).actief;
const twee = buildSteelCheckInputs({
  nodes: m2.nodes, beams: m2.beams, supports: m2.supports, combinations,
  combinationResults: new Map(combinations.map((c) => [c.id, combineResults(c, perCase)])),
  profileDb, loadCases: m2.loadCases, gevallenMetLast: [...perCase.keys()],
}).inputs[0];
ok("2D: dezelfde profile_name en profile_end", twee.profile_name === verlopend.profile_name && twee.profile_end === verlopend.profile_end,
  `${twee.profile_name} → ${twee.profile_end}`);

log("\n[2] De echte kern: 3D tegen 2D met dezelfde krachten");
if (!existsSync(TOETSBRUG)) {
  ok("toetsbrug gevonden — bouw hem met `cargo build --release -p toetsbrug`", false, TOETSBRUG);
} else {
  const kern = (inputs) => {
    const r = spawnSync(TOETSBRUG, [], { input: JSON.stringify({ opdracht: "check_steel_beams", inputs }), encoding: "utf8", maxBuffer: 256 << 20 });
    if (r.status !== 0 || !r.stdout) throw new Error(`toetsbrug faalde: ${(r.stderr ?? "").slice(0, 300)}`);
    return JSON.parse(r.stdout);
  };
  // De 2D-referentie uit test-verlopend-toetsing.mjs [4], letterlijk.
  const punten = Array.from({ length: 11 }, (_, i) => ({
    combination_id: 1, position_mm: (i * 6000) / 10,
    forces: { n_ed: 0, vy_ed: 0, vz_ed: 0, mt_ed: 0, my_ed: 200 * (1 - i / 10), mz_ed: 0 },
  }));
  const referentie = {
    beam_id: 1, profile_name: "IPE400", profile_end: "IPE200", steel_grade: "S235",
    length_m: 6.0, forces_envelope: punten,
    lateral_bracing: { top_flange_positions: [], bottom_flange_positions: [] },
    deflection_limit_class: "Floor", deflection_limit_numerator: 333,
    deflection_actual_max_mm: 0, is_cantilever: false, consequence_class: "CC1",
  };
  const [drie, ref] = kern([verlopend, referentie]);
  const uc = (r, id) => r.checks.find((c) => c.id === id)?.kind?.data?.uc?.uc;
  const pos = (r, id) => r.checks.find((c) => c.id === id)?.kind?.data?.force_state?.position_mm;
  ok("3D: de kern noemt het verloop", drie.profile_name === "IPE 400 → IPE 200 (verlopend)", drie.profile_name);
  // Positie t·L in drijvende komma (0,4·6000 = 2400,0000000000005): getallen
  // vergelijken met een relatieve marge van 1e-12, tekst en structuur exact.
  const gelijkGetal = (a, b) => Object.is(a, b) || (typeof a === "number" && typeof b === "number"
    && Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b)));
  const hetzelfde = (a, b) => {
    if (typeof a === "number" || typeof b === "number") return gelijkGetal(a, b);
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const sleutels = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...sleutels].every((k) => hetzelfde(a[k], b[k]));
  };
  ok("3D: het maatgevende punt ligt op x = 2400 mm", gelijkGetal(pos(drie, "6.2.5_bending_y"), 2400), String(pos(drie, "6.2.5_bending_y")));
  rel("3D: UC buiging = 120/161,74 (de handwaarde van 2D)", uc(drie, "6.2.5_bending_y"), 0.741936, 5e-4);
  ok("3D en 2D: dezelfde toetsdoorsneden (x, maten, A, W, klasse, hoogste UC)",
    drie.verloop?.toetsdoorsneden?.length === 6 && hetzelfde(drie.verloop?.toetsdoorsneden, ref.verloop?.toetsdoorsneden),
    `${drie.verloop?.toetsdoorsneden?.length} doorsneden`);
  ok("3D en 2D: hetzelfde maatgevende punt", drie.verloop?.maatgevend !== undefined && hetzelfde(drie.verloop?.maatgevend, ref.verloop?.maatgevend));
  ok("3D en 2D: dezelfde stabiliteitsdoorsnede", hetzelfde(drie.verloop?.stabiliteit, ref.verloop?.stabiliteit));
  const doorsnede = (r) => r.checks.filter((c) => c.id.startsWith("6.2.")).map((c) => [c.id, c.kind.data.uc?.uc]);
  ok("3D en 2D: dezelfde doorsnedetoetsen 6.2", hetzelfde(doorsnede(drie), doorsnede(ref)),
    doorsnede(drie).map(([id, u]) => `${id} ${u?.toFixed(4)}`).join(", "));
  const [prism] = kern([prismatisch]);
  ok("de prismatische IPE 400 toetst lager dan de verlopende staaf", uc(prism, "6.2.5_bending_y") < uc(drie, "6.2.5_bending_y"),
    `${uc(prism, "6.2.5_bending_y")?.toFixed(4)} < ${uc(drie, "6.2.5_bending_y")?.toFixed(4)}`);
}

log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

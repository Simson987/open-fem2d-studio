// CHS-profielnamen en de kiptoets van een ronde buis (#240).
//
// ── WAAROM DEZE TEST BESTAAT ───────────────────────────────────────────────
//
// De catalogus noemt vijf buizen met ".0" ("CHS 168.3x8.0"), de rest zonder
// ("CHS 168.3x10"). "CHS 168.3x8" en "CHS168.3x8" werden niet herkend: de
// sleutel haalde de punten weg, zodat "8.0" als "80" las. Een ronde buis kreeg
// bovendien een kiptoets 6.3.2 met teksten over flenzen, terwijl NEN-EN
// 1993-1-1 6.3.2.1(2) een ronde buis niet kipgevoelig noemt.
//
//   [1] DE SLEUTEL — `profielSleutel` (lib/strip.ts) en de Rust-lookup zoeken,
//       als de gewone sleutel geen profiel is, op de sleutel zonder
//       nul-decimalen: "CHS 168.3x8", "CHS168.3x8" en "chs 168.3 x 8.00" geven
//       de catalogussleutel "CHS1683X80" van "CHS 168.3x8.0"; die sleutel zelf
//       (zo staat hij op een staaf in een opgeslagen model) blijft werken, en
//       elke catalogusnaam houdt een eigen sleutel.
//   [2] DE TOETS   — CHS 168,3×8 S355, L = 4 m, N = −600 kN, M_y 0 → 20 kNm,
//       V_z = 5 kN via de 3D-staalbouwer en de toetsbrug, met de naam
//       "CHS168.3x8": hand χ = 0,7190 (kromme a, λ̄ = 0,9225),
//       N_b,Rd = 1028,3 kN; (6.61) = 0,817 en (6.62) = 0,724 met χ_LT = 1;
//       6.3.2 "n.v.t." met reden en zonder UC.
//
// Uitvoeren: npx tsx test-chs-profielnaam.mjs   (vanuit design-mockup/)
//        of: node scripts/run-tests.mjs --filter=chs-profielnaam

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const TOETSBRUG = join(
  resolve(HIER, ".."), "src-tauri", "target", "release",
  process.platform === "win32" ? "toetsbrug.exe" : "toetsbrug",
);

const { profielSleutel, zonderNulDecimalen } = await import("./src/lib/strip.ts");
const { profileLookupKey, isSteelProfile } = await import("./src/lib/steelCheckBuilder.ts");
const { parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { buildOpenFem3DSteelCheckInputs } = await import("./src/components/openFem3d/openFem3dSteelCheck.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}${extra ? ` — ${extra}` : ""}`); }
  else            { failed++; log(`  ✗ ${naam}${extra ? ` — ${extra}` : ""}`); }
}
const dichtbij = (a, b, abs) => Math.abs(a - b) <= abs;

log("\n[1] De sleutel");
ok("8.0 → 8, 8.00 → 8, 6.30 → 6.3, 10.05 en 100 blijven",
  zonderNulDecimalen("CHS 168.3x8.0") === "CHS 168.3x8" && zonderNulDecimalen("x8.00") === "x8"
  && zonderNulDecimalen("6.30") === "6.3" && zonderNulDecimalen("10.05") === "10.05"
  && zonderNulDecimalen("HEA 100") === "HEA 100");
const doel = profielSleutel("CHS 168.3x8.0");
ok("de catalogussleutel blijft CHS1683X80", doel === "CHS1683X80" && profielSleutel("CHS1683X80") === doel, doel);
for (const naam of ["CHS 168.3x8", "CHS168.3x8", "chs 168.3 x 8.00"]) {
  ok(`"${naam}" heeft de sleutel van "CHS 168.3x8.0"`, profielSleutel(naam) === doel && profileLookupKey(naam) === doel,
    profielSleutel(naam));
}
ok("de staalherkenning kent \"CHS168.3x8\"", isSteelProfile("CHS168.3x8"));
const catalogus = JSON.parse(readFileSync(
  join(resolve(HIER, ".."), "src-tauri", "crates", "steel-profiles", "data", "profiles.json"), "utf8"));
const sleutels = new Map();
for (const p of catalogus) {
  const k = profielSleutel(p.name);
  sleutels.set(k, [...(sleutels.get(k) ?? []), p.name]);
}
const dubbel = [...sleutels.values()].filter((v) => v.length > 1);
ok("elke catalogusnaam heeft een eigen sleutel", dubbel.length === 0, JSON.stringify(dubbel));

log("\n[2] De toets via de 3D-staalbouwer en de toetsbrug");
const model = parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "CHS168.3x8", material: "S355" }],
  supports: [
    { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: false, rz: false },
    { nodeId: 2, ux: false, uy: true, uz: true, rx: false, ry: false, rz: false },
  ],
  loads: [], memberLoads: [], memberPointLoads: [],
});
const nul = (nodeId) => ({ nodeId, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 });
const gebouwd = buildOpenFem3DSteelCheckInputs(model, {
  displacements: [nul(1), nul(2)],
  memberForces: [{
    memberId: 1, lengthM: 4,
    nStartKn: -600, nEndKn: -600, vyStartKn: 0, vyEndKn: 0, vzStartKn: 5, vzEndKn: 5,
    torsionStartKnm: 0, torsionEndKnm: 0, myStartKnm: 0, myEndKnm: 20, mzStartKnm: 0, mzEndKnm: 0,
  }],
});
ok("de staaf wordt getoetst", gebouwd.inputs.length === 1, JSON.stringify(gebouwd.skipped));

if (!existsSync(TOETSBRUG)) {
  failed++;
  log(`\n  ✗ de rekenkern ontbreekt: ${TOETSBRUG}`);
  log("    bouw hem met  cargo build --release -p toetsbrug  vanuit src-tauri.");
} else {
  const r = spawnSync(TOETSBRUG, [], {
    input: JSON.stringify({ opdracht: "check_steel_beams", inputs: gebouwd.inputs }),
    maxBuffer: 64 * 1024 * 1024, encoding: "utf8",
  });
  const [res] = JSON.parse(r.stdout);
  const toets = (id) => res.checks.find((c) => c.id === id)?.kind?.data;
  ok("de kern vindt \"CHS168.3x8\"", res.checks.length > 0 && !res.governing_check_id.startsWith("ERROR"),
    res.governing_check_id);
  const knik = toets("6.3.1_buckling");
  ok("N_b,Rd = 1028,3 kN", knik && dichtbij(knik.value, 1028.2, 0.2), `${knik?.value}`);
  const kip = toets("6.3.2_ltb");
  ok("kip 6.3.2: n.v.t. met reden (6.3.2.1(2)), geen UC, geen flens",
    kip?.status === "NotApplicable" && kip.uc === null && kip.notes[0].includes("6.3.2.1(2)")
    && !kip.notes.join(" ").toLowerCase().includes("flens"), kip?.notes?.[0]);
  // De 3D-bouwer geeft eigen C_my/kniklengtes mee; de handwaarden gelden bij
  // L_cr = L. Controleer alleen dat 6.3.3 gerekend is met χ_LT = 1.
  const i61 = toets("6.3.3_eq_6_61");
  const chiLt = i61?.variables?.find((v) => v.symbol === "\\chi_{LT}")?.value;
  ok("6.3.3 gerekend met χ_LT = 1", i61?.uc && chiLt === 1, `UC ${i61?.uc?.uc}, χ_LT ${chiLt}`);
}

log(`\n${failed === 0 ? "ALLES GOED" : "FOUTEN"} — ${passed} geslaagd, ${failed} gefaald`);
process.exit(failed === 0 ? 0 : 1);

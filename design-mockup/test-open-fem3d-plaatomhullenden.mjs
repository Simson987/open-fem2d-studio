// Plaatuitkomsten over alle combinaties in het 3D-rapport (issue #197):
// de omhullende per plaat en grootheid, en de randreacties per plaat.
//
// HANDWAARDEN (vierkante vloer a = 4 m, t = 0,20 m, C30/37, q = 10 kN/m²
// omlaag; eerste orde, dus elke uitkomst lineair in de factor)
//  [1] Alle vier randen opgelegd (scharnier om de randas): ΣF_z = q·a² = 160
//      kN per eenheidsfactor; door de symmetrie per rand q·a²/4 = 40 kN. Een
//      hoekknoop op twee opgelegde randen telt voor elk de helft, zodat de
//      som van de randen de plaatsom is. F_x = F_y = 0.
//  [2] Alleen twee tegenoverliggende randen (een eenzijdig dragende vloer):
//      per rand q·a²/2 = 80 kN; de hoeken liggen elk op één opgelegde rand.
//  [3] De omhullende over UGT 1,35·G en BGT 1,0·G: per grenstoestand de
//      uitersten van die combinatie, met de combinatie en de knoop erbij;
//      w(UGT) = 1,35·w(BGT) op dezelfde knoop. Twee UGT-combinaties (1,35 en
//      1,2): het maximum van |w| komt uit 1,35. Een ontbrekend resultaat telt
//      niet als nul.
//  [4] Randreactie-omhullende: UGT F_z rand = 1,35·40 = 54 kN, plaat 216 kN.
//
// Draaien met: npx tsx test-open-fem3d-plaatomhullenden.mjs

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

// Het rapport importeert zijn CSS; in Node is dat een lege module.
register("data:text/javascript," + encodeURIComponent(
  "export async function load(url, ctx, next) {" +
  " if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };" +
  " return next(url, ctx); }",
));

const stil = console.log;
console.log = (...args) => { if (!String(args[0] ?? "").startsWith("[TriangleService]")) stil(...args); };

const { OPEN_FEM_3D_SUPPORT_PRESETS, parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { meshOpenFem3DPlates } = await import("./src/components/openFem3d/openFem3dPlateMesh.ts");
const { buildOpenFem3DSolveRequest } = await import("./src/components/openFem3d/openFem3dSolver.ts");
const {
  openFem3DPlaatOmhullenden, openFem3DPlaatRandreacties, openFem3DPlaatRandreactieOmhullenden,
} = await import("./src/components/openFem3d/openFem3dPlaatOmhullenden.ts");

let passed = 0, failed = 0;
const log = (s) => stil(s);
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? ` — ${extra}` : ""}`); }
}
function check(naam, waarde, verwacht, absTol = 1e-6) {
  ok(`${naam}: ${Number(waarde).toFixed(6)} ≈ ${Number(verwacht).toFixed(6)}`,
    Number.isFinite(waarde) && Math.abs(waarde - verwacht) <= absTol);
}

const kern = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/open-fem-3d${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
if (!existsSync(kern)) {
  ok(`3D-kern aanwezig (bouw: cargo build -p open-fem-3d) — ${kern}`, false);
  log(`\n${passed} geslaagd, ${failed} mislukt`);
  process.exit(1);
}

const A = 4, Q = 10;
const vloer = (randen) => parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: A, y: 0, z: 0 }, { id: 3, x: A, y: A, z: 0 }, { id: 4, x: 0, y: A, z: 0 }],
  beams: [],
  plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2, material: "C30/37", meshSizeM: 0.5,
    edgeSupports: randen.map(([edge, preset]) => ({ edge, ...OPEN_FEM_3D_SUPPORT_PRESETS[preset] })) }],
  surfaceLoads: [{ id: 1, plateId: 1, caseId: 1, qx: 0, qy: 0, qz: -Q }],
});
/** Rekenen zoals `solveOpenFem3DCombination`: kernuitkomst met het rekennet erbij. */
async function reken(model, factor) {
  const mesh = await meshOpenFem3DPlates(model);
  const verzoek = { ...buildOpenFem3DSolveRequest(model, "linear", new Map([[1, factor]]), mesh), bucklingModes: 0 };
  const run = spawnSync(kern, [], { input: JSON.stringify(verzoek), maxBuffer: 256 << 20 });
  if (run.status !== 0) throw new Error(run.stderr.toString());
  return { ...JSON.parse(run.stdout.toString()), plateMesh: mesh };
}
const som = (rijen, rand) => rijen.find((r) => r.rand === rand);

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] Vier randen opgelegd: per rand q·a²/4, samen q·a²");
// ─────────────────────────────────────────────────────────────────────────
const vier = vloer([[0, "revoluteX"], [1, "revoluteY"], [2, "revoluteX"], [3, "revoluteY"]]);
const bgt = await reken(vier, 1);
{
  const rijen = openFem3DPlaatRandreacties(vier, bgt);
  ok("vier randrijen en één plaatrij", rijen.length === 5 && rijen.filter((r) => r.rand === null).length === 1);
  for (const rand of [0, 1, 2, 3]) check(`rand ${rand + 1}: F_z = q·a²/4 = 40 kN`, som(rijen, rand).fz, Q * A * A / 4, 1e-6);
  check("plaat: ΣF_z = q·a² = 160 kN", som(rijen, null).fz, Q * A * A, 1e-6);
  check("som van de randen = plaatsom (hoeken half)", [0, 1, 2, 3].reduce((s, r) => s + som(rijen, r).fz, 0), som(rijen, null).fz, 1e-9);
  check("plaat: ΣF_x = 0", som(rijen, null).fx, 0, 1e-6);
  check("plaat: ΣF_y = 0", som(rijen, null).fy, 0, 1e-6);
  const hoek = som(rijen, 0).knoopIds.filter((id) => som(rijen, 1).knoopIds.includes(id));
  ok("rand 1 en 2 delen precies één hoekknoop (knoop 2)", hoek.length === 1 && hoek[0] === 2, JSON.stringify(hoek));
  ok("zonder rekennet geen randreacties", openFem3DPlaatRandreacties(vier, { ...bgt, plateMesh: undefined }).length === 0);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] Twee tegenoverliggende randen: per rand q·a²/2");
// ─────────────────────────────────────────────────────────────────────────
{
  const twee = vloer([[1, "revoluteY"], [3, "revoluteY"]]);
  const r = await reken(twee, 1);
  const rijen = openFem3DPlaatRandreacties(twee, r);
  ok("twee randrijen en één plaatrij", rijen.length === 3);
  check("rand 2: F_z = q·a²/2 = 80 kN", som(rijen, 1).fz, Q * A * A / 2, 1e-6);
  check("rand 4: F_z = q·a²/2 = 80 kN", som(rijen, 3).fz, Q * A * A / 2, 1e-6);
  check("plaat: ΣF_z = 160 kN", som(rijen, null).fz, Q * A * A, 1e-6);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] De omhullende van de plaatgrootheden, UGT en BGT apart");
// ─────────────────────────────────────────────────────────────────────────
const ugt = await reken(vier, 1.35);
const ugt12 = await reken(vier, 1.2);
const combinaties = [
  { id: 1, name: "UGT 1,35·G", type: "uls" },
  { id: 2, name: "UGT 1,2·G", type: "uls" },
  { id: 3, name: "BGT G", type: "sls" },
  { id: 4, name: "UGT zonder resultaat", type: "uls" },
];
const resultaten = new Map([[1, ugt], [2, ugt12], [3, bgt]]);
{
  const rijen = openFem3DPlaatOmhullenden(combinaties, resultaten);
  const w = (soort) => rijen.find((r) => r.soort === soort && r.plateId === 1 && r.grootheid === "w");
  const wBgt = w("sls"), wUgt = w("uls");
  ok("w staat in beide grenstoestanden", wBgt !== undefined && wUgt !== undefined);
  ok("BGT: alleen combinatie 3 telt mee", wBgt && [...wBgt.combinatieIds].join() === "3");
  ok("UGT: combinaties 1 en 2, de ontbrekende 4 niet (geen nul)", wUgt && [...wUgt.combinatieIds].sort().join() === "1,2");
  const eBgt = bgt.plates[0].extremes.find((e) => e.quantity === "wM");
  check("BGT: w_min = de kleinste knoopwaarde van combinatie 3 (mm)", wBgt.min.waarde, eBgt.min * 1000, 1e-9);
  ok("BGT: met de knoop van dat minimum", wBgt.min.knoopId === eBgt.minNodeId, `${wBgt.min.knoopId} / ${eBgt.minNodeId}`);
  check("UGT: w_min = 1,35 · w_min(BGT) (lineair)", wUgt.min.waarde, 1.35 * wBgt.min.waarde, 1e-6);
  ok("UGT: w_min komt uit combinatie 1 (1,35), op dezelfde knoop",
    wUgt.min.combinatieId === 1 && wUgt.min.combinatie === "UGT 1,35·G" && wUgt.min.knoopId === wBgt.min.knoopId);
  const mxx = rijen.find((r) => r.soort === "uls" && r.grootheid === "mxx");
  ok("mxx (kNm/m) staat erin, met symbool en eenheid", mxx?.symbool === "mxx" && mxx?.eenheid === "kNm/m");
  ok("geen gronddruk zonder bedding", !rijen.some((r) => r.grootheid === "groundPressure"));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] De omhullende van de randreacties");
// ─────────────────────────────────────────────────────────────────────────
{
  const rijen = openFem3DPlaatRandreactieOmhullenden(vier, combinaties, resultaten);
  const rij = (soort, rand, g) => rijen.find((r) => r.soort === soort && r.plateId === 1 && r.rand === rand && r.grootheid === g);
  check("UGT rand 1: F_z,max = 1,35·40 = 54 kN", rij("uls", 0, "Fz").max.waarde, 54, 1e-6);
  ok("UGT rand 1: uit combinatie 1", rij("uls", 0, "Fz").max.combinatieId === 1);
  check("UGT rand 1: F_z,min = 1,2·40 = 48 kN (combinatie 2)", rij("uls", 0, "Fz").min.waarde, 48, 1e-6);
  check("UGT plaat: F_z,max = 1,35·160 = 216 kN", rij("uls", null, "Fz").max.waarde, 216, 1e-6);
  check("BGT plaat: F_z = 160 kN", rij("sls", null, "Fz").max.waarde, 160, 1e-6);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[5] Het 3D-rapport toont beide tabellen (React, server-side)");
// ─────────────────────────────────────────────────────────────────────────
{
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const i18next = (await import("i18next")).default;
  const { initReactI18next } = await import("react-i18next");
  const { readFileSync } = await import("node:fs");
  const locale = (ns) => JSON.parse(readFileSync(new URL(`./src/i18n/locales/nl/${ns}.json`, import.meta.url), "utf8"));
  await i18next.use(initReactI18next).init({
    lng: "nl", ns: ["ribbon", "common"], defaultNS: "ribbon", showSupportNotice: false,
    resources: { nl: { ribbon: locale("ribbon"), common: locale("common") } },
  });
  const OpenFem3DReport = (await import("./src/components/openFem3d/OpenFem3DReport.tsx")).default;
  let html = "";
  let fout = null;
  try {
    html = renderToStaticMarkup(React.createElement(OpenFem3DReport, {
      model: vier, result: bgt, combinations: combinaties, combinationResults: resultaten,
    }));
  } catch (e) { fout = e; }
  ok("het rapport rendert", fout === null, String(fout?.stack ?? fout).slice(0, 400));
  ok("sectie Omhullenden per plaat", /data-open-fem3d-report-plate-envelopes/.test(html) && /Omhullenden per plaat/.test(html));
  ok("rij UGT w van plaat 1", /data-open-fem3d-report-plate-envelope-row="uls-1-w"/.test(html));
  ok("rij BGT randreactie F_z van de hele plaat", /data-open-fem3d-report-plate-edge-row="sls-1-plaat-Fz"/.test(html)
    && /hele plaat/.test(html));
  ok("de toelichting over de hoekknopen staat erbij", /telt voor elk de helft/.test(html));
}

log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);

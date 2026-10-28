// Massief rond staal (reeks "RD") — van profielnaam tot normtoets.
//
// ── WAAROM DEZE TEST BESTAAT ───────────────────────────────────────────────
//
// Windverbanden van rond staal (Ø24, Ø30 S235) in een 3D-staalhal werden
// overgeslagen: het profiel stond niet in de catalogus, dus de 3D-rekenroute
// vond geen I_z en J, en de staaltoets herkende de staaf niet als staal. Deze
// test loopt de hele keten langs, met handgetallen:
//
//   [1] DE NAAM      — "RD 24" en de schrijfwijzen "Ø24", "Ø 24", "ROND 24",
//                      "RD24" wijzen hetzelfde profiel aan; `rondStaalNaam`
//                      normaliseert naar "RD 24".
//   [2] DE DOORSNEDE — resolveSection geeft A en I_y van de volle cirkel:
//                      A = π·24²/4 = 452,389 mm², I = π·24⁴/64 = 16 286 mm⁴.
//   [3] 3D           — buildOpenFem3DSolveRequest neemt een RD-staaf aan, met
//                      I_z = I_y = 16 286 mm⁴ en J = π·24⁴/32 = 32 572 mm⁴.
//   [4] KIEZER EN TEKENING — de reeks staat in de profielkiezer (17 maten, op
//                      maat), "Ø24" vindt hem in het zoekveld, de tekening is een
//                      volle cirkel en de IFC-export schrijft een
//                      IfcCircleProfileDef.
//   [5] DE TOETS     — de 3D-staaltoets slaat de staaf niet meer over, en de
//                      rekenkern (toetsbrug, apart proces) toetst het draadeind:
//                      M24, A_s = π/4·(24 − 0,9382·3)² = 352,50 mm²,
//                      N_t,Rd,draad = 0,9·360·352,50/1,25 = 91,37 kN, tegen
//                      N_pl,Rd = 452,389·235 = 106,31 kN. Bij 80 kN trek is het
//                      draadeind maatgevend: UC = 80/91,37 = 0,876. Kip staat
//                      er als "n.v.t." met reden, en een staaf op trek krijgt
//                      geen knik-UC. Aliassen komen via de kern op hetzelfde uit.
//
// [5] start de toetsbrug als apart proces. Ontbreekt die binary, dan faalt deze
// test luid: bouw hem met  cargo build --release -p toetsbrug  (src-tauri).
//
// Uitvoeren: npx tsx test-rond-staal.mjs   (vanuit design-mockup/)
//        of: node scripts/run-tests.mjs --filter=rond-staal

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const TOETSBRUG = join(
  resolve(HIER, ".."), "src-tauri", "target", "release",
  process.platform === "win32" ? "toetsbrug.exe" : "toetsbrug",
);

const { resolveSection } = await import("./src/lib/sectionResolver.ts");
const { isSteelProfile, profileLookupKey } = await import("./src/lib/steelCheckBuilder.ts");
const { rondStaalNaam, rondStaalSleutel } = await import("./src/lib/rondStaal.ts");
const { STEEL_SECTION_DIMS } = await import("./src/lib/steelSectionDims.generated.ts");
const { buildOpenFem3DSolveRequest } = await import("./src/components/openFem3d/openFem3dSolver.ts");
const { parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { buildOpenFem3DSteelCheckInputs } = await import("./src/components/openFem3d/openFem3dSteelCheck.ts");
const { REEKSEN, profielenVanReeks, reeksVanProfiel } = await import("./src/lib/profieleditor/catalogus.ts");
const { zoekProfielen, catalogusZoekReeksen } = await import("./src/lib/profielZoeken.ts");
const { shapeVanProfiel, shapePath, buitenmaten } = await import("./src/components/shared/profielVorm.ts");
const { bouwIfcRekenmodel } = await import("./src/io/ifcExport.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}${extra ? ` — ${extra}` : ""}`); }
  else            { failed++; log(`  ✗ ${naam}${extra ? ` — ${extra}` : ""}`); }
}
const dichtbij = (a, b, rel = 1e-5) => Math.abs(a - b) <= rel * Math.abs(b);

// Handgetallen voor RD 24 (d = 24 mm). De catalogus schrijft zes significante
// cijfers, vandaar de relatieve grens 1e-5.
const A24 = (Math.PI * 24 ** 2) / 4;   // 452,389 mm²
const I24 = (Math.PI * 24 ** 4) / 64;  // 16 286,0 mm⁴
const J24 = (Math.PI * 24 ** 4) / 32;  // 32 572,0 mm⁴

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] De naam: RD 24 en zijn schrijfwijzen");
const ALIASSEN = ["RD 24", "RD24", "rd 24", "Ø24", "Ø 24", "ø24", "⌀24", "ROND 24", "rond24"];
for (const naam of ALIASSEN) {
  ok(`"${naam}" → "RD 24"`, rondStaalNaam(naam) === "RD 24", String(rondStaalNaam(naam)));
  ok(`"${naam}" heeft de sleutel RD24`, profileLookupKey(naam) === "RD24", profileLookupKey(naam));
}
ok("geen massief rond → null", rondStaalNaam("HEA 200") === null && rondStaalNaam("RHS 100x50x5") === null);
ok("een koker blijft een koker", profileLookupKey("RHS 100x50x5") === "RHS100X50X5");
ok("alleen cijfers na het voorvoegsel", rondStaalSleutel("Ø24X3") === "Ø24X3");

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] De doorsnede: resolveSection en isSteelProfile");
for (const naam of ALIASSEN) {
  const s = resolveSection("S235", naam);
  ok(`resolveSection("S235", "${naam}")`,
    s.bron === "staal-db" && dichtbij(s.A, A24) && dichtbij(s.I, I24) && s.E === 210000,
    `A = ${s.A}, I = ${s.I}, bron ${s.bron}`);
  ok(`isSteelProfile("${naam}")`, isSteelProfile(naam));
}
const dims = STEEL_SECTION_DIMS.RD24;
ok("de maattabel kent RD 24 als RoundBar", dims?.kind === "RoundBar" && dims.naam === "RD 24");
ok("W_el = π·24³/32 = 1357,17; W_pl = 24³/6 = 2304; i = 6; A_v = 0,75·A",
  dichtbij(dims.props.welY, (Math.PI * 24 ** 3) / 32) && dims.props.wplY === 2304 &&
  dims.props.iRadY === 6 && dichtbij(dims.props.avZ, 0.75 * A24));
ok("I_t = π·24⁴/32 en I_w = 0", dichtbij(dims.props.it, J24) && dims.props.iw === 0);
const reeks = ["RD 10", "RD 12", "RD 16", "RD 20", "RD 24", "RD 27", "RD 30", "RD 33", "RD 36",
  "RD 39", "RD 42", "RD 45", "RD 48", "RD 52", "RD 56", "RD 60", "RD 64"];
ok("de hele reeks is staal", reeks.every((n) => isSteelProfile(n)));

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] 3D: de rekenroute neemt een RD-staaf aan met de juiste I_z en J");
{
  // Een windverband van 6 m tussen twee opgelegde knopen, met een knooplast.
  const model = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "Ø24", material: "S235" }],
    supports: [
      { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
      { nodeId: 2, ux: false, uy: true, uz: true, rx: false, ry: false, rz: false },
    ],
    loads: [{ id: 1, nodeId: 2, caseId: 1, fx: 80, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
    memberLoads: [],
    memberPointLoads: [],
  });
  let request = null;
  try {
    request = buildOpenFem3DSolveRequest(model, "linear");
  } catch (e) {
    ok("buildOpenFem3DSolveRequest geeft geen fout", false, e.message);
  }
  const sectie = request?.sections?.[0];
  ok("één doorsnede", request?.sections?.length === 1, JSON.stringify(request?.sections));
  ok("A = 452,389 mm² = 4,52389e-4 m²", sectie && dichtbij(sectie.areaM2, A24 * 1e-6), `${sectie?.areaM2}`);
  ok("I_y = 16 286 mm⁴", sectie && dichtbij(sectie.iyM4, I24 * 1e-12), `${sectie?.iyM4}`);
  ok("I_z = I_y = 16 286 mm⁴", sectie && dichtbij(sectie.izM4, I24 * 1e-12), `${sectie?.izM4}`);
  ok("J = π·24⁴/32 = 32 572 mm⁴", sectie && dichtbij(sectie.torsionJM4, J24 * 1e-12), `${sectie?.torsionJM4}`);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] Profielkiezer, zoeken, tekening en IFC");
{
  ok("de reeks RD staat in de profielkiezer", REEKSEN.some((r) => r.id === "RD"));
  const rd = profielenVanReeks("RD");
  ok("17 maten, op maat gesorteerd",
    rd.length === 17 && rd.join() === reeks.map((n) => n.replace(" ", "")).join(), rd.join(", "));
  ok("reeksVanProfiel(\"Ø30\") = RD", reeksVanProfiel("Ø30") === "RD");
  for (const term of ["Ø24", "ø 24", "RD24", "rond 24"]) {
    const u = zoekProfielen(term, catalogusZoekReeksen());
    const g = u.groepen.find((x) => x.reeksId === "RD");
    ok(`zoeken op "${term}" vindt RD 24`, g?.treffers.includes("RD24"), JSON.stringify(g?.treffers));
  }
  const vorm = shapeVanProfiel("RD 24");
  ok("tekenvorm: volle cirkel met d = 24", vorm?.type === "rond" && vorm.d === 24, JSON.stringify(vorm));
  const maten = vorm ? buitenmaten(vorm) : null;
  ok("buitenmaten 24 × 24", maten?.b === 24 && maten?.h === 24);
  const pad = vorm ? shapePath(vorm, 1, 0, 0) : null;
  // Twee halve bogen met straal 12 om (12, 12), geen gat (geen evenodd).
  ok("SVG-pad: twee bogen r = 12, zonder gat",
    pad?.d === "M 0.00 12.00 a 12.00 12.00 0 1 0 24.00 0 a 12.00 12.00 0 1 0 -24.00 0 Z" && !pad.fillRule,
    pad?.d);
  const ifc = bouwIfcRekenmodel({
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, material: "S235", profile: "RD 24" }],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "pinned" }],
    loads: [],
    loadCases: [{ id: 1, name: "Permanent", type: "dead" }],
  });
  // IfcCircleProfileDef: ProfileType, ProfileName, Position, Radius = 0,012 m.
  const cirkel = /^#\d+=IFCCIRCLEPROFILEDEF\(\.AREA\.,'[^']*',[^,]*,0\.012\);$/m.test(ifc);
  ok("IFC: IfcCircleProfileDef met straal 0,012 m", cirkel,
    (ifc.match(/^#\d+=IFCCIRCLE.*$/m) ?? ["geen"])[0]);
  ok("IFC: geen buisprofiel", !ifc.includes("IFCCIRCLEHOLLOWPROFILEDEF"));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[5] De toets: 3D-bouwer en rekenkern, met het draadeind");
const KERN_AANWEZIG = existsSync(TOETSBRUG);
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

// De 3D-staaltoets met een trekkracht van 80 kN over de hele staaf.
const model3d = parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }],
  beams: [{ id: 7, startNodeId: 1, endNodeId: 2, profileName: "Ø24", material: "S235" }],
  supports: [
    { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
    { nodeId: 2, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
  ],
  loads: [], memberLoads: [], memberPointLoads: [],
});
const nul = (nodeId) => ({ nodeId, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 });
const resultaat3d = {
  displacements: [nul(1), nul(2)],
  memberForces: [{
    memberId: 7, lengthM: 6,
    nStartKn: 80, nEndKn: 80, vyStartKn: 0, vyEndKn: 0, vzStartKn: 0, vzEndKn: 0,
    torsionStartKnm: 0, torsionEndKnm: 0, myStartKnm: 0, myEndKnm: 0, mzStartKnm: 0, mzEndKnm: 0,
  }],
};
const gebouwd = buildOpenFem3DSteelCheckInputs(model3d, resultaat3d);
ok("de 3D-staaltoets slaat het windverband niet over",
  gebouwd.skipped.length === 0 && gebouwd.inputs.length === 1, JSON.stringify(gebouwd.skipped));

if (!KERN_AANWEZIG) {
  failed++;
  log(`\n  ✗ de rekenkern ontbreekt: ${TOETSBRUG}`);
  log("    bouw hem met  cargo build --release -p toetsbrug  vanuit src-tauri;");
  log("    zonder hem is de toets op het draadeind niet nagerekend.");
} else {
  const [r] = kern("check_steel_beams", gebouwd.inputs);
  const trek = toets(r, "6.2.3_tension");
  const draad = toets(r, "6.2.3_threaded_end");
  ok("klasse 1", r.classification === "Class1", r.classification);
  ok("trek brutodoorsnede: N_pl,Rd = 452,389·235 = 106,31 kN",
    trek && dichtbij(trek.value, 106.311, 1e-4), `${trek?.value}`);
  ok("draadeind in de uitvoer, met naam en artikel",
    draad?.title === "Trek in het draadeind (M24)" && draad.article === "NEN-EN 1993-1-8 tabel 3.4",
    `${draad?.title} [${draad?.article}]`);
  const as = draad?.deelstappen?.find((d) => d.id === "a_s")?.value;
  ok("A_s = π/4·(24 − 0,9382·3)² = 352,50 mm²", as !== undefined && dichtbij(as, 352.503, 1e-5), `${as}`);
  ok("N_t,Rd,draad = 0,9·360·352,50/1,25 = 91,37 kN",
    draad && dichtbij(draad.value, 91.369, 1e-4), `${draad?.value}`);
  ok("UC draadeind = 80/91,37 = 0,876", draad?.uc && dichtbij(draad.uc.uc, 80 / 91.369, 1e-4),
    `${draad?.uc?.uc}`);
  // #226: zonder opgegeven eindafwerking is het draadeind een AANNAME en
  // alleen informatie; maatgevend is de brutodoorsnede, UC 80/106,31 = 0,753.
  ok("zonder eindafwerking: draadeind is informatie, trek maatgevend",
    r.governing_check_id === "6.2.3_tension" && dichtbij(r.uc_max, 80 / 106.311, 1e-4)
    && draad?.notes?.[0]?.startsWith("AANNAME"), `${r.governing_check_id} ${r.uc_max}`);
  const [g] = kern("check_steel_beams", [{ ...gebouwd.inputs[0], draadeind: "Gesneden" }]);
  ok("met draadeind \"Gesneden\" is het draadeind maatgevend (kleinste trekweerstand)",
    g.governing_check_id === "6.2.3_threaded_end" && dichtbij(g.uc_max, 80 / 91.369, 1e-4),
    g.governing_check_id);
  const kip = toets(r, "6.3.2_ltb");
  ok("kip: n.v.t. met reden, geen unity check",
    kip?.status === "NotApplicable" && kip.uc === null && kip.notes[0].startsWith("Niet van toepassing"),
    kip?.notes?.[0]);
  const knik = toets(r, "6.3.1_buckling");
  ok("op trek geen knik-UC", knik?.status === "NotApplicable" && knik.uc === null, knik?.notes?.[0]);

  // Dezelfde staaf onder de andere schrijfwijzen: de kern vindt hetzelfde
  // profiel, en dat is de proef dat `lib/rondStaal.ts` en de Rust-lookup
  // dezelfde regel volgen.
  for (const naam of ["RD 24", "ROND 24", "ø 24", "⌀24"]) {
    const [a] = kern("check_steel_beams", [{ ...gebouwd.inputs[0], profile_name: naam }]);
    const d = toets(a, "6.2.3_threaded_end");
    ok(`kern met "${naam}": zelfde draadeind`, d && dichtbij(d.value, 91.369, 1e-4),
      a.governing_check_id);
  }
}

log(`\n${failed === 0 ? "ALLES GOED" : "FOUTEN"} — ${passed} geslaagd, ${failed} gefaald`);
process.exit(failed === 0 ? 0 : 1);

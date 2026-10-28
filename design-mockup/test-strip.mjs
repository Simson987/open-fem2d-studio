// Platstaal (reeks "Strip <b>x<t>") — van profielnaam tot normtoets.
//
// ── WAAROM DEZE TEST BESTAAT ───────────────────────────────────────────────
//
// Windverbanden van strip (platstaal, "Strip 80x10") in een 3D-staalhal werden
// overgeslagen: het profiel stond niet in de catalogus, dus de 3D-rekenroute
// vond geen I_z en J, en de staaltoets herkende de staaf niet als staal. Deze
// test loopt de hele keten langs, met handgetallen:
//
//   [1] DE NAAM      — "Strip 80x10" en de schrijfwijzen "FL 80x10",
//                      "Platstaal 80x10", "Strip 80 x 10", "strip80x10" wijzen
//                      hetzelfde profiel aan; `stripNaam` normaliseert naar
//                      "Strip 80x10" (de ProfileName uit een IFC-import).
//   [2] DE DOORSNEDE — resolveSection geeft A en I_y van de rechthoek, met de
//                      breedte langs z: A = 80·10 = 800 mm²,
//                      I_y = 10·80³/12 = 426 667 mm⁴ (de sterke as).
//   [3] 3D           — buildOpenFem3DSolveRequest neemt een strip aan, met
//                      I_z = 80·10³/12 = 6 666,67 mm⁴ en
//                      J = 80·10³·(1/3 − 0,21·0,125·(1 − 10⁴/(12·80⁴)))
//                        = 24 566,7 mm⁴ — dezelfde formule als
//                      `rectangleTorsionConstant` in de 3D-rekenroute.
//   [4] KIEZER EN TEKENING — de reeks staat in de profielkiezer (97 maten, op
//                      maat), "FL 80x10" en "platstaal 80x10" vinden hem in het
//                      zoekveld, de tekening is een volle rechthoek 10 × 80 (op
//                      zijn kant) en de IFC-export schrijft een
//                      IfcRectangleProfileDef met XDim = 0,01 en YDim = 0,08 m.
//   [5] DE TOETS     — de 3D-staaltoets slaat de staaf niet meer over, en de
//                      rekenkern (toetsbrug, apart proces) toetst trek op de
//                      brutodoorsnede: N_pl,Rd = 800·235/1,0 = 188,0 kN, bij
//                      150 kN trek UC = 150/188,0 = 0,798. Geen draadeind; kip
//                      staat er als "n.v.t." met reden, en een staaf op trek
//                      krijgt geen knik-UC. Aliassen komen via de kern op
//                      hetzelfde uit.
//   [6] TREK-ALLEEN  — een trek-alleen staaf krijgt `tension_only` mee, en de
//                      kern toetst dan alleen trek en meldt de druk als
//                      speling, niet getoetst.
//
// [5] start de toetsbrug als apart proces. Ontbreekt die binary, dan faalt deze
// test luid: bouw hem met  cargo build --release -p toetsbrug  (src-tauri).
//
// Uitvoeren: npx tsx test-strip.mjs   (vanuit design-mockup/)
//        of: node scripts/run-tests.mjs --filter=strip

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
const { stripNaam, stripSleutel } = await import("./src/lib/strip.ts");
const { STEEL_SECTION_DIMS } = await import("./src/lib/steelSectionDims.generated.ts");
const { buildOpenFem3DSolveRequest } = await import("./src/components/openFem3d/openFem3dSolver.ts");
const { parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { buildOpenFem3DSteelCheckInputs } = await import("./src/components/openFem3d/openFem3dSteelCheck.ts");
const { REEKSEN, profielenVanReeks, reeksVanProfiel, basisprofielVan } = await import("./src/lib/profieleditor/catalogus.ts");
const { zoekProfielen, catalogusZoekReeksen } = await import("./src/lib/profielZoeken.ts");
const { shapeVanProfiel, buitenmaten } = await import("./src/components/shared/profielVorm.ts");
const { bouwIfcRekenmodel } = await import("./src/io/ifcExport.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}${extra ? ` — ${extra}` : ""}`); }
  else            { failed++; log(`  ✗ ${naam}${extra ? ` — ${extra}` : ""}`); }
}
const dichtbij = (a, b, rel = 1e-5) => Math.abs(a - b) <= rel * Math.abs(b);

// Handgetallen voor Strip 80x10 (b = 80, t = 10, breedte langs z). De
// catalogus schrijft zes significante cijfers, vandaar de grens 1e-5.
const A = 80 * 10;                     // 800 mm²
const IY = (10 * 80 ** 3) / 12;        // 426 666,7 mm⁴
const IZ = (80 * 10 ** 3) / 12;        // 6 666,67 mm⁴
const J = 80 * 10 ** 3 * (1 / 3 - 0.21 * (10 / 80) * (1 - 10 ** 4 / (12 * 80 ** 4))); // 24 566,7 mm⁴

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] De naam: Strip 80x10 en zijn schrijfwijzen");
const ALIASSEN = ["Strip 80x10", "FL 80x10", "Platstaal 80x10", "Strip 80 x 10", "strip80x10",
  "STRIP 80X10", "Strip 80×10", "fl80x10", "Strip 10x80"];
for (const naam of ALIASSEN) {
  ok(`"${naam}" → "Strip 80x10"`, stripNaam(naam) === "Strip 80x10", String(stripNaam(naam)));
  ok(`"${naam}" heeft de sleutel STRIP80X10`, profileLookupKey(naam) === "STRIP80X10", profileLookupKey(naam));
}
ok("geen platstaal → null", stripNaam("HEA 200") === null && stripNaam("RD 24") === null);
ok("massief rond blijft massief rond", profileLookupKey("Ø24") === "RD24");
ok("alleen <cijfers>x<cijfers> na het voorvoegsel",
  stripSleutel("STRIP80") === "STRIP80" && stripSleutel("FLB80X10") === "FLB80X10");

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] De doorsnede: resolveSection en isSteelProfile");
for (const naam of ALIASSEN) {
  const s = resolveSection("S235", naam);
  ok(`resolveSection("S235", "${naam}")`,
    s.bron === "staal-db" && s.A === A && dichtbij(s.I, IY) && s.E === 210000,
    `A = ${s.A}, I = ${s.I}, bron ${s.bron}`);
  ok(`isSteelProfile("${naam}")`, isSteelProfile(naam));
}
const dims = STEEL_SECTION_DIMS.STRIP80X10;
ok("de maattabel kent Strip 80x10 als FlatBar", dims?.kind === "FlatBar" && dims.naam === "Strip 80x10");
ok("stand: h = 80 (breedte, langs z), b = t_w = t_f = 10 (dikte)",
  dims.h === 80 && dims.b === 10 && dims.tw === 10 && dims.tf === 10, JSON.stringify(dims));
ok("W_el,y = 10·80²/6, W_pl,y = 10·80²/4 = 16 000, W_pl,z = 80·10²/4 = 2000",
  dichtbij(dims.props.welY, (10 * 80 ** 2) / 6) && dims.props.wplY === 16000 && dims.props.wplZ === 2000);
ok("I_z = 6666,67, I_t = 24 566,7, I_w = 0, A_v = ⅔·A",
  dichtbij(dims.props.iz, IZ) && dichtbij(dims.props.it, J) && dims.props.iw === 0 &&
  dichtbij(dims.props.avZ, (2 * A) / 3));

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] 3D: de rekenroute neemt een strip aan met de juiste I_z en J");
{
  const model = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "FL 80x10", material: "S235" }],
    supports: [
      { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
      { nodeId: 2, ux: false, uy: true, uz: true, rx: false, ry: false, rz: false },
    ],
    loads: [{ id: 1, nodeId: 2, caseId: 1, fx: 150, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
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
  ok("A = 800 mm² = 8,0e-4 m²", sectie && dichtbij(sectie.areaM2, A * 1e-6), `${sectie?.areaM2}`);
  ok("I_y = 10·80³/12 = 426 667 mm⁴ (sterke as)", sectie && dichtbij(sectie.iyM4, IY * 1e-12), `${sectie?.iyM4}`);
  ok("I_z = 80·10³/12 = 6 666,67 mm⁴", sectie && dichtbij(sectie.izM4, IZ * 1e-12), `${sectie?.izM4}`);
  ok("J = 24 566,7 mm⁴ (formule van rectangleTorsionConstant)",
    sectie && dichtbij(sectie.torsionJM4, J * 1e-12), `${sectie?.torsionJM4}`);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] Profielkiezer, zoeken, tekening en IFC");
{
  ok("de reeks STRIP staat in de profielkiezer", REEKSEN.some((r) => r.id === "STRIP"));
  const strips = profielenVanReeks("STRIP");
  ok("97 maten (b ≥ 2t)", strips.length === 97, `${strips.length}`);
  ok("op maat gesorteerd: eerst Strip 30x5, laatst Strip 200x20",
    strips[0] === "STRIP30X5" && strips[strips.length - 1] === "STRIP200X20", `${strips[0]} … ${strips.at(-1)}`);
  ok("reeksVanProfiel(\"FL 80x10\") = STRIP", reeksVanProfiel("FL 80x10") === "STRIP");
  for (const term of ["Strip 80x10", "FL 80x10", "fl80x10", "platstaal 80x10", "strip 80×10"]) {
    const u = zoekProfielen(term, catalogusZoekReeksen());
    const g = u.groepen.find((x) => x.reeksId === "STRIP");
    ok(`zoeken op "${term}" vindt Strip 80x10`, g?.treffers.includes("STRIP80X10"), JSON.stringify(g?.treffers));
  }
  const vorm = shapeVanProfiel("Strip 80x10");
  ok("tekenvorm: volle rechthoek, h = 80 (breedte) en b = 10 (dikte)",
    vorm?.type === "rect" && vorm.h === 80 && vorm.b === 10, JSON.stringify(vorm));
  const maten = vorm ? buitenmaten(vorm) : null;
  ok("buitenmaten 10 × 80 (op zijn kant)", maten?.b === 10 && maten?.h === 80);
  const basis = basisprofielVan("Strip 80x10");
  ok("profieleditor: basisprofiel als motorsoort Rechthoek, h = 80, b = 10",
    basis?.soort === "Rechthoek" && basis.h === 80 && basis.b === 10, JSON.stringify(basis));
  const ifc = bouwIfcRekenmodel({
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, material: "S235", profile: "Strip 80x10" }],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "pinned" }],
    loads: [],
    loadCases: [{ id: 1, name: "Permanent", type: "dead" }],
  });
  // IfcRectangleProfileDef: ProfileType, ProfileName, Position, XDim, YDim.
  const regel = (ifc.match(/^#\d+=IFCRECTANGLEPROFILEDEF\(.*$/m) ?? ["geen"])[0];
  ok("IFC: IfcRectangleProfileDef 'Strip 80x10' met XDim = 0,01 en YDim = 0,08 m",
    /^#\d+=IFCRECTANGLEPROFILEDEF\(\.AREA\.,'Strip 80x10',[^,]*,0\.01,0\.08\);$/m.test(ifc), regel);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[5] De toets: 3D-bouwer en rekenkern, trek op de brutodoorsnede");
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

// De 3D-staaltoets met een trekkracht van 150 kN over de hele staaf.
const model3d = parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }],
  beams: [{ id: 7, startNodeId: 1, endNodeId: 2, profileName: "Strip 80x10", material: "S235" }],
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
    nStartKn: 150, nEndKn: 150, vyStartKn: 0, vyEndKn: 0, vzStartKn: 0, vzEndKn: 0,
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
  log("    zonder hem is de trektoets niet nagerekend.");
} else {
  const [r] = kern("check_steel_beams", gebouwd.inputs);
  const trek = toets(r, "6.2.3_tension");
  ok("klasse 1 (geen druk)", r.classification === "Class1", r.classification);
  ok("trek brutodoorsnede: N_pl,Rd = 800·235/1,0 = 188,0 kN",
    trek && dichtbij(trek.value, 188.0, 1e-12), `${trek?.value}`);
  ok("UC trek = 150/188,0 = 0,798", trek?.uc && dichtbij(trek.uc.uc, 150 / 188, 1e-12), `${trek?.uc?.uc}`);
  ok("de trektoets is maatgevend", r.governing_check_id === "6.2.3_tension", r.governing_check_id);
  ok("geen draadeind bij een strip", !r.checks.some((c) => c.id === "6.2.3_threaded_end"));
  const kip = toets(r, "6.3.2_ltb");
  ok("kip: n.v.t. met reden, geen unity check",
    kip?.status === "NotApplicable" && kip.uc === null && kip.notes[0].startsWith("Niet van toepassing"),
    kip?.notes?.[0]);
  const knik = toets(r, "6.3.1_buckling");
  ok("op trek geen knik-UC", knik?.status === "NotApplicable" && knik.uc === null, knik?.notes?.[0]);

  // Dezelfde staaf onder de andere schrijfwijzen: de kern vindt hetzelfde
  // profiel, en dat is de proef dat `lib/strip.ts` en de Rust-lookup
  // dezelfde regel volgen.
  for (const naam of ["FL 80x10", "Platstaal 80x10", "Strip 80 x 10", "strip80x10"]) {
    const [a] = kern("check_steel_beams", [{ ...gebouwd.inputs[0], profile_name: naam }]);
    const t = toets(a, "6.2.3_tension");
    ok(`kern met "${naam}": zelfde trekweerstand`, t && dichtbij(t.value, 188.0, 1e-12), a.governing_check_id);
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[6] Trek-alleen: de 3D-bouwer zet de vlag, de kern toetst alleen trek");
{
  const modelTa = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }],
    beams: [{ id: 8, startNodeId: 1, endNodeId: 2, profileName: "Strip 80x10", material: "S235", tensionOnly: true }],
    supports: [
      { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
      { nodeId: 2, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
    ],
    loads: [], memberLoads: [], memberPointLoads: [],
  });
  // Een kleine druk (speling): 0,3 kN.
  const resultaatTa = {
    displacements: [nul(1), nul(2)],
    memberForces: [{
      memberId: 8, lengthM: 6,
      nStartKn: -0.3, nEndKn: -0.3, vyStartKn: 0, vyEndKn: 0, vzStartKn: 0, vzEndKn: 0,
      torsionStartKnm: 0, torsionEndKnm: 0, myStartKnm: 0, myEndKnm: 0, mzStartKnm: 0, mzEndKnm: 0,
    }],
  };
  const ta = buildOpenFem3DSteelCheckInputs(modelTa, resultaatTa);
  ok("de bouwer zet tension_only voor een trek-alleen staaf", ta.inputs[0]?.tension_only === true,
    JSON.stringify(ta.inputs[0]?.tension_only));
  ok("een gewone staaf krijgt de vlag niet", !("tension_only" in gebouwd.inputs[0]));
  if (KERN_AANWEZIG) {
    const [r] = kern("check_steel_beams", ta.inputs);
    const ids = r.checks.map((c) => c.id);
    ok("alleen de trektoets en de drukregel", ids.join() === "6.2.3_tension,trek_alleen", ids.join());
    const regel = toets(r, "trek_alleen");
    ok("de drukregel noemt speling/voorspanning, niet getoetst",
      regel?.notes?.[0]?.includes("trek-alleen staaf: drukkracht geldt als speling/voorspanning, niet getoetst"),
      regel?.notes?.[0]);
  }
}

log(`\n${failed === 0 ? "ALLES GOED" : "FOUTEN"} — ${passed} geslaagd, ${failed} gefaald`);
process.exit(failed === 0 ? 0 : 1);

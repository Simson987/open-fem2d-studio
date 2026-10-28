// Een staaf die NIET (volledig) getoetst is — status "NotApplicable" van de
// kern: een klasse 4-doorsnede zonder effectieve breedtes ("NIET TOETSBAAR"),
// of een geweigerde lijfplooitoets bij dwarskracht ("NIET VOLLEDIG
// GETOETST") — mag nergens als "voldoet" lezen: geen UC in de kleur van
// voldoet, geen "✓ OK", en nooit als maatgevende staaf (controle 2026-10,
// punt B7). Deze test legt dat vast voor elke plek die de staafstatus toont:
//
//  [1] het HTML-rapport (`io/reportExport.ts`): "— NIET GETOETST", UC "—";
//  [2] de UC per groep in het 3D-rapport (`openFem3dRapportSamenvatting.ts`):
//      niet meegeteld, nooit maatgevend, wel geteld als niet getoetst;
//  [3] de weergaven zelf (2D-toetspaneel, 2D-tekenvlak, 3D-rapport,
//      3D-eigenschappen, het React-rapport en de staafeigenschappen): een
//      broncontrole op de tak voor "NotApplicable";
//  [4] de teksten in nl/en/de/fr.
//
// Draaien met: node scripts/run-tests.mjs --filter=niet-getoetst-weergave

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const { buildReportHtml } = await import("./src/io/reportExport.ts");
const { openFem3DUcPerGroep } = await import("./src/components/openFem3d/openFem3dRapportSamenvatting.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); }
  else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};

/** Een staalresultaat zoals de kern het geeft, met één doorsnedetoets. */
const staal = (beam_id, status, uc_max, governing_check_id) => ({
  beam_id, profile_name: "IPE600", steel_grade: "S460", classification: "Class4",
  uc_max, status, governing_check_id,
  checks: [{
    id: "6.2.4_compression",
    kind: { type: "Resistance", data: {
      id: "6.2.4_compression", title: "Druk", article: "art. 6.2.4", value: 1, unit: "kN",
      uc: { ed: uc_max, rd: 1, uc: uc_max, formula_latex: "" }, status: "Ok", notes: [],
      variables: [], formula_latex: "", deelstappen: [],
      force_state: { combination_id: 1, position_mm: 0, forces: {} },
    } },
  }],
});

// ── [1] Het HTML-rapport ────────────────────────────────────────────────────
console.log("[1] HTML-rapport");
{
  const html = buildReportHtml({
    nodes: [], beams: [], supports: [], loads: [], loadCases: [],
    result: { maxDisplacement: 0, reactions: new Map(), elements: new Map() },
    checks: [
      staal(1, "Ok", 0.42, "6.2.4_compression"),
      staal(2, "NotApplicable", 0.67, "NIET VOLLEDIG GETOETST: lijfplooi onder schuifkracht"),
    ],
  });
  const rij = (id) => html.split("<tr").find((r) => r.includes(`<td>${id}</td>`)) ?? "";
  check("de getoetste staaf: UC en ✓ OK", rij(1).includes("0,420") || rij(1).includes("0.420"), rij(1).slice(0, 200));
  check("de getoetste staaf: ✓ OK", rij(1).includes("✓ OK"));
  check("de niet getoetste staaf: — NIET GETOETST", rij(2).includes("— NIET GETOETST"), rij(2).slice(0, 300));
  check("de niet getoetste staaf: geen ✓ OK", !rij(2).includes("✓ OK"));
  check("de niet getoetste staaf: geen UC-getal (0,67)", !rij(2).includes("0,670") && !rij(2).includes("0.670"));
  check("de niet getoetste staaf: de reden staat erbij", rij(2).includes("NIET VOLLEDIG GETOETST"));
}

// ── [2] UC per groep in het 3D-rapport ──────────────────────────────────────
console.log("\n[2] 3D: UC per groep");
{
  const staaf = (id) => ({ id, startNodeId: 1, endNodeId: 2, group: "liggers" });
  const toets = (id, uc) => ({ id, kind: { data: { uc: { uc } } } });
  const uitkomst = (beam_id, status, uc) => ({
    beam_id, profile_name: "IPE 600", steel_grade: "S460", status, checks: [toets("6.2.4_compression", uc)],
  });
  const gemengd = openFem3DUcPerGroep(
    { beams: [staaf(1), staaf(2), staaf(3)] },
    [uitkomst(1, "Ok", 0.42), uitkomst(2, "NotApplicable", 0.67), uitkomst(3, "Ok", 0.55)],
  )[0];
  check("de niet getoetste staaf telt niet mee in ucMax (0,55, niet 0,67)", Math.abs(gemengd.ucMax - 0.55) < 1e-12, String(gemengd.ucMax));
  check("de niet getoetste staaf is niet maatgevend", gemengd.maatgevendeStaaf === 3, String(gemengd.maatgevendeStaaf));
  check("wel geteld: één niet getoetst, drie staven", gemengd.aantalNietGetoetst === 1 && gemengd.aantal === 3);
  const alleen = openFem3DUcPerGroep({ beams: [staaf(2)] }, [uitkomst(2, "NotApplicable", 0.67)])[0];
  check("alleen niet getoetst: ucMax null (\"—\"), geen maatgevende toets", alleen.ucMax === null && alleen.maatgevendeToets === "—");
  const eerstNiet = openFem3DUcPerGroep(
    { beams: [staaf(2), staaf(1)] },
    [uitkomst(2, "NotApplicable", 0.9), uitkomst(1, "Ok", 0.42)],
  )[0];
  check("eerst een niet getoetste, dan een getoetste: die laatste is maatgevend", eerstNiet.ucMax === 0.42 && eerstNiet.maatgevendeStaaf === 1);
}

// ── [3] De weergaven ─────────────────────────────────────────────────────────
console.log("\n[3] Weergaven: de tak voor status NotApplicable");
{
  const bron = (pad) => readFileSync(join(HIER, "src", ...pad.split("/")), "utf8");
  const paneel = bron("components/panels/CheckPanel.tsx");
  check("2D-toetspaneel: UC \"—\" en een neutrale klasse bij n.v.t.",
    /result\.status === "NotApplicable" \? "cp-uc-na"/.test(paneel) && /result\.status === "NotApplicable" \? "—"/.test(paneel));
  check("2D-toetspaneel: de klasse cp-uc-na bestaat", /\.cp-uc-na\b/.test(bron("components/panels/CheckPanel.css")));
  const canvas = bron("components/fem/FemCanvas.tsx");
  check("2D-tekenvlak: het UC-label zegt 'niet getoetst' en is niet groen",
    /const nietGetoetst = r\.status === "NotApplicable";/.test(canvas)
    && /const ok = !nietGetoetst && r\.uc_max <= 1\.0;/.test(canvas)
    && /canvas\.uc\.nietGetoetst/.test(canvas));
  const rapport3d = bron("components/openFem3d/OpenFem3DReport.tsx");
  check("3D-rapport: staaltabel toont 'niet getoetst' en UC \"—\"",
    /const nietGetoetst = check\.status === "NotApplicable";/.test(rapport3d)
    && /nietGetoetst \? "—" : number\(uc\)/.test(rapport3d)
    && /nietGetoetst \? t\("openFem3d\.check\.notChecked"\)/.test(rapport3d));
  check("3D-rapport: UC per groep toont \"—\" zonder getoetste staaf",
    /rij\.ucMax === null \? "—"/.test(rapport3d));
  const eigenschappen = bron("components/openFem3d/OpenFem3DProperties.tsx");
  check("3D-eigenschappen: aparte tak voor n.v.t., zonder 'voldoet'",
    /beamCheck && beamCheck\.status === "NotApplicable" &&/.test(eigenschappen)
    && /beamCheck && beamCheck\.status !== "NotApplicable" &&/.test(eigenschappen)
    && /open-fem3d-check-na/.test(eigenschappen));
  check("3D-verkenner: n.v.t. telt niet mee in de grootste staal-UC",
    /check\.status !== "NotApplicable"/.test(bron("components/openFem3d/OpenFem3DExplorer.tsx")));
  // Het React-rapport (overzicht en toetsing per staaf) en de staafeigenschappen:
  // sinds K6 krijgt ook een staaf met een doorlopend eind status n.v.t. met een
  // UC onder 1 (review samenvoeging 2026.42). Daar stond "UC = 0,61 · N.v.t.".
  const tabel = bron("components/report/sections/CheckTableSection.tsx");
  check("React-rapport, overzicht: UC \"—\" en geen faalkleur bij n.v.t.",
    /r\.status === "NotApplicable" \? "—" : fmtUc\(r\.uc_max\)/.test(tabel)
    && /r\.status !== "NotApplicable" && r\.uc_max > 1/.test(tabel));
  const detail = bron("components/report/sections/CheckDetailSection.tsx");
  check("React-rapport, toetsing per staaf: UC = \"—\" bij n.v.t.",
    /result\.status === "NotApplicable" \? "—" : fmtUc\(result\.uc_max\)/.test(detail)
    && /result\.status !== "NotApplicable" && result\.uc_max > 1/.test(detail));
  const dialoog = bron("components/fem/BarPropertiesDialog.tsx");
  check("staafeigenschappen: de maatgevende regel zonder UC-getal bij n.v.t.",
    /memberResult\.status === "NotApplicable" \? "—" : memberResult\.uc_max\.toFixed\(2\)/.test(dialoog));
}

// ── [4] Teksten ──────────────────────────────────────────────────────────────
console.log("\n[4] Teksten in nl/en/de/fr");
for (const taal of ["nl", "en", "de", "fr"]) {
  const lees = (bestand) => JSON.parse(readFileSync(join(HIER, "src", "i18n", "locales", taal, bestand), "utf8"));
  const lint = lees("ribbon.json");
  const algemeen = lees("common.json");
  check(`${taal}: openFem3d.check.notChecked en notCheckedReason`,
    typeof lint.openFem3d?.check?.notChecked === "string" && lint.openFem3d.check.notChecked.length > 0
    && /\{\{reason\}\}/.test(lint.openFem3d?.check?.notCheckedReason ?? ""));
  check(`${taal}: canvas.uc.nietGetoetst`, typeof algemeen.canvas?.uc?.nietGetoetst === "string");
}

console.log(`\n${geslaagd} geslaagd, ${gefaald} mislukt`);
if (gefaald > 0) process.exit(1);

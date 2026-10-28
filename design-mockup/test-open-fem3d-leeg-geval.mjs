// Issue #245 (controle 26 oktober 2026, K8): een leeg ACTIEF belastinggeval
// gaf via `gui_solve` geen resultaat en liet het 3D-resultatenpaneel leeg.
//
// WAT ER MISGING
//  3D-kolom HEA200, h = 4 m, voet ingeklemd, F_x = 10 kN aan de kop in geval
//  1; actief geval 3 leeg. De rekengang rekende geval 1 en de combinaties
//  (M_voet = F·h = 40 kNm, u = Fh³/(3EI) = 27,52 mm), `handleSolve` koos zelfs
//  een terugval — maar het effect dat op een nieuwe resultaatset reageert zette
//  het resultaat daarna terug op dat van het actieve geval: `null`. Gevolg:
//  paneel "Klik op Berekenen", en `gui_solve` gooide "3D doorrekenen mislukt:
//  de rekengang leverde geen resultaat" met `rekenfout: null`.
//
// WAT DEZE TEST VASTLEGT
//  [1] `kiesOpenFem3DResultaat` (één regel voor rekengang en effect):
//      actief geval berekend → dat; leeg actief geval → eerste berekende
//      combinatie in lijstvolgorde, als actieve combinatie; geen combinaties →
//      een berekend geval wordt het actieve geval; niets → null.
//  [2] App.tsx gebruikt die regel in het effect én in `handleSolve`; de oude
//      regel `caseResults.get(fem.activeLoadCaseId) ?? null` is weg.
//  [3] De bediening (`gui_solve`/`gui_run_checks`) faalt niet meer op een leeg
//      actief geval en meldt het in `melding` / `actiefBelastinggeval`.
//  [4] De melding in de verkenner bestaat in nl/en/de/fr.
//
// Draaien met: npx tsx test-open-fem3d-leeg-geval.mjs  (alleen tegen de bron)

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const { kiesOpenFem3DResultaat } = await import("./src/lib/openFem3dResultaatKeuze.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? ` — ${extra}` : ""}`); }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] De keuze van het getoonde resultaat");
// ─────────────────────────────────────────────────────────────────────────
{
  // Het K8-geval: geval 1 berekend (de kolom), gevallen 2 en 3 leeg, twee
  // combinaties met geval 1. De resultaten zijn hier labels; de keuze hangt
  // niet van de getallen af.
  const gevallen = new Map([[1, "geval 1: M_voet 40 kNm"]]);
  const combinaties = new Map([[12, "combinatie 12"], [11, "combinatie 11"]]);
  const volgorde = [{ id: 11 }, { id: 12 }];

  const k1 = kiesOpenFem3DResultaat(gevallen, combinaties, 1, volgorde);
  ok("actief geval 1 berekend: dat resultaat, geen combinatie, niet leeg",
    k1.result === "geval 1: M_voet 40 kNm" && k1.combinationId === null && !k1.actiefGevalLeeg && k1.wisselNaarGeval === null);

  const k3 = kiesOpenFem3DResultaat(gevallen, combinaties, 3, volgorde);
  ok("actief geval 3 leeg: de eerste combinatie in lijstvolgorde (11), als actieve combinatie (was: null)",
    k3.result === "combinatie 11" && k3.combinationId === 11 && k3.actiefGevalLeeg && k3.wisselNaarGeval === null,
    JSON.stringify(k3));
  ok("nooit het resultaat van een ánder geval onder de naam van het lege geval",
    k3.result !== "geval 1: M_voet 40 kNm");

  const zonderCombi = kiesOpenFem3DResultaat(gevallen, new Map(), 3, []);
  ok("geen combinaties: geval 1 wordt het actieve geval",
    zonderCombi.result === "geval 1: M_voet 40 kNm" && zonderCombi.wisselNaarGeval === 1 && zonderCombi.actiefGevalLeeg,
    JSON.stringify(zonderCombi));

  const niets = kiesOpenFem3DResultaat(new Map(), new Map(), 3, volgorde);
  ok("niets berekend: null, niet leeg", niets.result === null && !niets.actiefGevalLeeg && niets.wisselNaarGeval === null);

  const alleenCombi = kiesOpenFem3DResultaat(new Map(), new Map([[7, "c7"]]), 3, []);
  ok("alleen combinaties (geen volgorde opgegeven): de eerste", alleenCombi.result === "c7" && alleenCombi.combinationId === 7);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] App.tsx: één regel in het effect en in handleSolve");
// ─────────────────────────────────────────────────────────────────────────
{
  const app = readFileSync(join(HIER, "src", "App.tsx"), "utf8");
  const aanroepen = app.match(/kiesOpenFem3DResultaat\(/g) ?? [];
  ok("kiesOpenFem3DResultaat in het effect én in handleSolve", aanroepen.length === 2, `${aanroepen.length}×`);
  ok("de oude regel (resultaat van het actieve geval of null) is weg",
    !app.includes("openFem3dCaseResults.get(fem.activeLoadCaseId) ?? null"));
  ok("de oude terugval op een ánder geval in handleSolve is weg",
    !app.includes("caseResults.get(fem.activeLoadCaseId) ?? casePairs[0]?.[1]"));
  ok("het effect reageert ook op de combinatieresultaten",
    /\}, \[fem\.activeLoadCaseId, modelDimension, openFem3dCaseResults, openFem3dCombinationResults\]\);/.test(app));
  ok("de verkenner krijgt de melding over het lege actieve geval", app.includes("activeCaseEmpty={openFem3dActiefGevalLeeg}"));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] Bediening: geen fout bij een leeg actief geval, wél een melding");
// ─────────────────────────────────────────────────────────────────────────
{
  const bed = readFileSync(join(HIER, "src", "bediening", "bediening.ts"), "utf8");
  ok("faalt alleen bij een rekenfout of als er niets berekend is (rekenen én toetsen)",
    (bed.match(/state\.solveError \|\| \(!state\.result && state\.caseResults\.size === 0 && state\.combinationResults\.size === 0\)/g) ?? []).length === 2);
  ok("de oude voorwaarde (!state.result || state.solveError) is weg", !bed.includes("if (!state.result || state.solveError)"));
  ok("de 3D-uitlezing geeft melding en actiefBelastinggeval",
    bed.includes("actiefBelastinggeval:") && /heeft geen belasting en dus geen eigen resultaat/.test(bed));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] De melding in de verkenner, in vier talen");
// ─────────────────────────────────────────────────────────────────────────
{
  const { default: i18next } = await import("./scripts/i18n-voor-tests.mjs");
  for (const taal of ["nl", "en", "de", "fr"]) {
    const t = i18next.getFixedT(taal, "common");
    const v = t("tree.activeCaseEmpty3d", { getoond: "UGT 1" });
    ok(`${taal}: tree.activeCaseEmpty3d bestaat en noemt wat getoond wordt`, !v.includes("tree.") && v.includes("UGT 1"), v);
    ok(`${taal}: tree.activeCaseEmpty3dNothing bestaat`, !t("tree.activeCaseEmpty3dNothing").includes("tree."));
  }
  const nl = i18next.getFixedT("nl", "common")("tree.activeCaseEmpty3d", { getoond: "x" });
  ok("en/de/fr zijn geen Nederlands gebleven",
    ["en", "de", "fr"].every((taal) => i18next.getFixedT(taal, "common")("tree.activeCaseEmpty3d", { getoond: "x" }) !== nl));
}

log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);

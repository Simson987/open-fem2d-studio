// Tweede orde (P-Δ) van de stalen en de houten hal uit de wizard (issues #60,
// #202), van eind tot
// eind: elk belastinggeval en elke standaardcombinatie (defaultCombinations)
// gaat door de rekenweg van de app (solveOpenFem3D / solveOpenFem3DCombination:
// eigen gewicht, verzoekopbouw, scheefstand, POST naar /api/openFem3d/solve en
// de onafhankelijke krachtensom) naar de echte 3D-kern, zoals App.tsx dat doet
// bij de analyse "tweede orde".
//
// Tot oktober 2026 faalde P-Δ in de externe kern vanaf ongeveer 64 vrije
// vrijheidsgraden in de matrixfactorisatie; de standaardhal heeft er 858
// (165 knopen × 6, min 22 inklemmingen × 6).
// De adapter (src-tauri/crates/open-fem-3d/src/tweede_orde.rs) factoriseert nu
// elke iteratie opnieuw. Deze test bewaakt dat dat op een echt model blijft
// werken, voor elk geval en elke combinatie:
//   - de analyse is "p-delta" (geen stille terugval naar eerste orde), de
//     iteratie convergeert en is stabiel (α_cr > 1, knikfactor beschikbaar);
//   - ΣR in X, Y en Z is de handsom: per geval last × oppervlak of
//     last × strook × hoogte, eigen gewicht Σ ρ·A·g·L; per combinatie
//     Σ γ·(handsom per geval), met scheefstand nog −richting·φ·ΣR_z in de
//     scheefstandrichting (elke verticale last V krijgt φ·V horizontaal).
//     K_G voert bij een starre translatie geen kracht af, dus ook in tweede
//     orde is de reactiesom exact die van de lasten;
//   - de onafhankelijke kracht- en momentensom van de app sluit (met het
//     tweede-ordemoment Σ N·(e_x × Δu)).
//
// Uitzondering sinds de knikanalyse de staven in vier delen rekent
// (controle oktober 2026, K4, #186): in de standaardhal (verbanden niet
// trek-alleen) krijgen de wandverbanden CHS 88,9×4 van 10 m onder "Wind langs
// (W) leidend" in de UGT en de karakteristieke BGT meer druk dan hun eigen
// knikkracht π²·E·I/L² = 19,97 kN (UGT 6.10b: N = −29,3 kN, α_cr = 0,688).
// Met één element per staaf zag de knikanalyse die knik niet en rekende de
// tweede orde door. Nu weigert de stabiliteitspoort terecht, met de staven
// in de melding. Deze test eist die weigering waar de hand haar voorspelt:
// α_cr van de kern ligt dan 0–0,2 % boven min π²·E·I/(L²·|N|) over de
// verbanden, met N (gemiddeld over de staaf) uit de eerste orde van dezelfde
// combinatie, en die is kleiner dan 1. Elke andere fout blijft een fout.
// (De kern rekent elk deel met zijn eigen N; bij het eigen gewicht van een
// schuin verband verloopt N maar weinig en symmetrisch rond het midden, waar
// de knikvorm het gemiddelde weegt.)
//
// Varianten: de standaardhal (= docs/verificatie/3d-raamwerk/staalhal-60x30.ifcfem),
// dezelfde hal met scheefstand ±X/±Y (alleen de UGT-varianten: de gevallen en
// de BGT-combinaties zijn gelijk aan die zonder), een lessenaarsdak met
// scharnierende voeten, een plat dak, de standaardhal op een balkrooster met
// palen, en de houten hal van de wizard (GL28h en C24, dezelfde als in
// test-open-fem3d-staalhal-generator.mjs en test-staalhal-sidecar.mjs) zonder
// en met scheefstand volgens EN 1995-1-1 (issue #202). Dezelfde handgetallen
// staan in test-open-fem3d-staalhal.mjs en test-open-fem3d-staalhal-generator.mjs
// (eerste orde).
//
// Rekenkern: OPEN_FEM_3D_SOLVER_PATH, anders src-tauri/target/debug/open-fem-3d(.exe).
// Vier berekeningen tegelijk (de app rekent ze allemaal tegelijk).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { withOpenFem3DSelfWeight } from "./src/components/openFem3d/openFem3dModel.ts";
import { solveOpenFem3D, solveOpenFem3DCombination } from "./src/components/openFem3d/openFem3dSolver.ts";
import {
  leidScheefstandGeometrieAf3D, metScheefstandRichtingen3D, scheefstandVanCombinatie, toepasselijkeScheefstandNormen3D,
  bepaalScheefstand3D,
} from "./src/components/openFem3d/openFem3dScheefstand.ts";
import { maakStaalhal, STAALHAL_GEVAL } from "./src/components/openFem3d/wizards/staalhal.ts";
import { defaultCombinations } from "./src/components/fem/solver/combinations.ts";
import { dichtheidVanMateriaal, resolveSection } from "./src/lib/sectionResolver.ts";

const solverBinary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${solverBinary}`, import.meta.url));
assert.ok(existsSync(solverPath), `Bouw eerst de Rust-rekenkern (${solverPath}) of zet OPEN_FEM_3D_SOLVER_PATH.`);

/** De rekenweg van de app in de browser: POST /api/openFem3d/solve, hier naar de echte kern (zoals vite.config.ts). */
globalThis.fetch = (url, options) => new Promise((resolve, reject) => {
  assert.equal(url, "/api/openFem3d/solve");
  const kind = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  const uit = [], fout = [];
  kind.stdout.on("data", (d) => uit.push(d));
  kind.stderr.on("data", (d) => fout.push(d));
  kind.on("error", reject);
  kind.on("close", (code) => {
    const tekst = Buffer.concat(uit).toString();
    resolve({
      ok: code === 0, status: code === 0 ? 200 : 500,
      json: async () => tekst ? JSON.parse(tekst) : { fout: Buffer.concat(fout).toString().slice(0, 400) },
    });
  });
  kind.stdin.end(options.body);
});

const fmt = (x) => x === undefined ? "-" : Math.abs(x) >= 0.01 || x === 0 ? x.toFixed(4) : x.toExponential(1);
const som = (r, k) => r.reactions.reduce((t, x) => t + x[k], 0);
// De kern sluit de krachtensom op afrondruis (≈ 1e-10 kN); 1e-3 kN is de grens
// van de andere staalhaltests en vangt elke ontbrekende of dubbele last.
const GRENS_KN = 1e-3;

/** Σ ρ·A·g·L met ρ = 7850 kg/m³ (staal, bruto doorsnede uit de catalogus) en g = 9,81 m/s². */
const staalgewicht = (model) => model.beams.reduce((t, b) => {
  const a = model.nodes.find((n) => n.id === b.startNodeId), e = model.nodes.find((n) => n.id === b.endNodeId);
  const d = resolveSection(b.material, b.profileName);
  return t + 7850 * (d.aBruto ?? d.A) * 1e-6 * 9.81 / 1000 * Math.hypot(e.x - a.x, e.y - a.y, e.z - a.z);
}, 0);

/** Σ ρ·A·g·L met ρ van het materiaal (hout: de gemiddelde volumieke massa van de sterkteklasse), g = 9,81 m/s². */
const houtgewicht = (model) => model.beams.reduce((t, b) => {
  const a = model.nodes.find((n) => n.id === b.startNodeId), e = model.nodes.find((n) => n.id === b.endNodeId);
  const d = resolveSection(b.material, b.profileName);
  return t + dichtheidVanMateriaal(b.material) * (d.aBruto ?? d.A) * 1e-6 * 9.81 / 1000 * Math.hypot(e.x - a.x, e.y - a.y, e.z - a.z);
}, 0);

/** Het profiel van de wandverbanden van de standaardhal. */
const VERBAND = "CHS 88.9x4";

/**
 * α_cr volgens de hand voor de knik van de verbanden zelf: min π²·E·I/(L²·|N|)
 * over de gedrukte staven met profiel `VERBAND`, N gemiddeld over de staaf uit
 * de eerste orde.
 */
function verbandknik(model, eersteOrde) {
  const d = resolveSection("S235", VERBAND);
  const ei = d.E * 1000 * d.I * 1e-12;
  let alpha = Infinity;
  for (const b of model.beams.filter((b) => b.profileName === VERBAND)) {
    const a = model.nodes.find((n) => n.id === b.startNodeId), e = model.nodes.find((n) => n.id === b.endNodeId);
    const l = Math.hypot(e.x - a.x, e.y - a.y, e.z - a.z);
    const f = eersteOrde.memberForces.find((m) => m.memberId === b.id);
    // De gemiddelde N over de staaf: het eigen gewicht van het schuine verband
    // laat N langs de staaf iets verlopen. De kern rekent elk van de vier delen
    // met zijn eigen N; voor de halve sinus van een scharnierende staaf weegt
    // dat (tot op de 0,2 % hierboven) als het gemiddelde.
    const n = (f.nStartKn + f.nEndKn) / 2;
    if (n < 0) alpha = Math.min(alpha, Math.PI ** 2 * ei / (l * l * -n));
  }
  return alpha;
}

const LESSENAAR = {
  lengteMm: 36000, breedteMm: 18000, aantalVakken: 6, goothoogteMm: 6000,
  dak: { type: "lessenaarsdak", nokhoogteMm: 7800 }, gordingafstandMm: 2000, kolomvoet: "scharnierend",
  lasten: { dakafwerkingKnM2: 0.4, sneeuwKnM2: 0.7, wind: { drukKnM2: 0.7, zuigingKnM2: 0.45, dakZuigingKnM2: 0.5 } },
};
const PLATDAK = {
  lengteMm: 40000, breedteMm: 20000, aantalVakken: 5, goothoogteMm: 7000, dak: { type: "platdak" },
  gordingafstandMm: 3000, verbanden: { vakken: [5, 1, 3, 3] },
};
// De houten hal van de wizard: 12 × 8 m, plat dak, goot 8 m (standaard), twee
// vakken, gelamineerde spanten en kolommen, gordingen en verbanden in C24.
const HOUTHAL = {
  lengteMm: 12000, breedteMm: 8000, aantalVakken: 2, dak: { type: "platdak" }, gordingafstandMm: 2000,
  profielen: {
    kolom: { materiaal: "GL28h", profiel: "200x400" },
    spantligger: { materiaal: "GL28h", profiel: "160x400" },
    gording: { materiaal: "C24", profiel: "80x200" },
    randligger: { materiaal: "C24", profiel: "100x200" },
    verband: { materiaal: "C24", profiel: "100x100" },
  },
};
const G = STAALHAL_GEVAL;
// Houten hal 12 × 8 m (96 m²) op 8 m, standaardlasten:
//   G 0,30 · 96 = 28,8   S 0,56 · 96 = 53,76
//   W dwars (0,64 + 0,40) · 8 · 12 = 99,84 in +Y, dak 0,48 · 96 = 46,08 omhoog
//   W langs 0,64 · 8 · 8 / 2 = 20,48 in +X
const HOUT = (hal) => ({
  [G.permanent]: [0, 0, 28.8], [G.sneeuw]: [0, 0, 53.76], [G.windDwars]: [0, -99.84, -46.08],
  [G.windLangs]: [-20.48, 0, 0], [G.eigenGewicht]: [0, 0, houtgewicht(hal.model)],
});

// Handsommen per geval als ΣR = [fx, fy, fz] in kN (reactie = −last).
// Standaardhal 60 × 30 m, goot 8 m, nok 9,5 m (projectie 1800 m²):
//   G 0,30 · 1800 = 540        S 0,56 · 1800 = 1008
//   W dwars (0,64 + 0,40) · 8 · (9 · 6 + 2 · 3) = 499,2 in +Y, dak 0,48 · 1800 = 864 omhoog
//   W langs 0,64 · 30 · (8 + 9,5)/2 / 2 = 84 in +X
const STANDAARD = (eigenGewicht) => ({
  [G.permanent]: [0, 0, 540], [G.sneeuw]: [0, 0, 1008], [G.windDwars]: [0, -499.2, -864],
  [G.windLangs]: [-84, 0, 0], [G.eigenGewicht]: [0, 0, eigenGewicht],
});
const VARIANTEN = [
  // `knikkendeVerbanden`: zoveel berekeningen weigert de stabiliteitspoort omdat
  // de verbanden zelf knikken (zie de kop).
  { naam: "standaardhal 60 × 30 m", invoer: {}, knikkendeVerbanden: 3, hand: (hal) => STANDAARD(staalgewicht(hal.model)) },
  {
    naam: "standaardhal, scheefstand ±X/±Y", invoer: {}, scheefstand: true, knikkendeVerbanden: 8,
    hand: (hal) => STANDAARD(staalgewicht(hal.model)),
  },
  {
    // Lessenaarsdak 36 × 18 m (648 m²), goot 6 m, hoge zijde 7,8 m:
    //   G 0,4 · 648 = 259,2   S 0,7 · 648 = 453,6
    //   W dwars (0,7 · 6 + 0,45 · 7,8) · 36 = 277,56 in +Y, dak 0,5 · 648 = 324 omhoog
    //   W langs 0,7 · 18 · (6 + 7,8)/2 / 2 = 43,47 in +X
    naam: "lessenaarsdak 36 × 18 m, scharnierende voeten", invoer: LESSENAAR,
    hand: (hal) => ({
      [G.permanent]: [0, 0, 259.2], [G.sneeuw]: [0, 0, 453.6], [G.windDwars]: [0, -277.56, -324],
      [G.windLangs]: [-43.47, 0, 0], [G.eigenGewicht]: [0, 0, staalgewicht(hal.model)],
    }),
  },
  {
    // Plat dak 40 × 20 m (800 m²) op 7 m, standaardlasten:
    //   G 0,30 · 800 = 240   S 0,56 · 800 = 448
    //   W dwars (0,64 + 0,40) · 7 · 40 = 291,2 in +Y, dak 0,48 · 800 = 384 omhoog
    //   W langs 0,64 · 20 · 7 / 2 = 44,8 in +X
    naam: "plat dak 40 × 20 m", invoer: PLATDAK,
    hand: (hal) => ({
      [G.permanent]: [0, 0, 240], [G.sneeuw]: [0, 0, 448], [G.windDwars]: [0, -291.2, -384],
      [G.windLangs]: [-44.8, 0, 0], [G.eigenGewicht]: [0, 0, staalgewicht(hal.model)],
    }),
  },
  {
    // Standaardhal op een balkrooster met palen: de lasten van de hal, en als
    // eigen gewicht staal + beton, met beton q = 2500 · 0,4 · 0,6 · 9,81 / 1000
    // = 5,886 kN/m over 2 · 60 + 11 · 30 + 22 · 0,8 (poeren) = 467,6 m.
    naam: "standaardhal op een balkrooster met palen", invoer: { fundering: { type: "balkrooster" } }, knikkendeVerbanden: 3,
    hand: () => STANDAARD(staalgewicht(maakStaalhal({}).model) + 5.886 * (2 * 60 + 11 * 30 + 22 * 0.8)),
  },
  { naam: "houten hal 12 × 8 m", invoer: HOUTHAL, hand: HOUT },
  { naam: "houten hal, scheefstand ±X/±Y (EN 1995)", invoer: HOUTHAL, scheefstand: true, norm: "en1995", hand: HOUT },
];

/** Voert taken uit met hoogstens `n` tegelijk; de uitkomsten in de volgorde van de taken. */
async function inPool(taken, n) {
  const uitkomsten = new Array(taken.length);
  let volgende = 0;
  await Promise.all(Array.from({ length: Math.min(n, taken.length) }, async () => {
    while (volgende < taken.length) {
      const index = volgende++;
      uitkomsten[index] = await taken[index]();
    }
  }));
  return uitkomsten;
}
const TEGELIJK = Math.max(1, Math.min(4, availableParallelism()));

let geslaagd = 0;
const fouten = [];
const totaal = { maxDF: 0, maxDM: 0, minAlpha: Infinity, maxB: 0, maxIt: 0 };
const gestart = performance.now();

for (const variant of VARIANTEN) {
  const hal = maakStaalhal(variant.invoer);
  const hand = variant.hand(hal);
  const model = withOpenFem3DSelfWeight(hal.model, G.eigenGewicht);
  // Zoals App.tsx: de blijvende gevallen voor montage, het eigen-gewichtgeval voor de meldingen.
  const options = {
    permanentCaseIds: hal.loadCases.filter((c) => c.type === "dead").map((c) => c.id),
    selfWeightCaseId: G.eigenGewicht,
  };
  // φ zoals de app hem bij de norm bepaalt, sinds issue #194 per richting met m per
  // rij kolommen (EN 1993-1-1 5.3.2(3)); staal EN 1993-1-1 (φ0 = 1/200 met α_h en α_m),
  // hout EN 1995-1-1 (φ = 0,005·√(5/h) boven 5 m).
  const phi = variant.scheefstand
    ? bepaalScheefstand3D({ bron: variant.norm ?? "en1993", noemer: 200 }, leidScheefstandGeometrieAf3D(hal.model),
      toepasselijkeScheefstandNormen3D(hal.model)).phi
    : null;
  const combinaties = metScheefstandRichtingen3D(defaultCombinations(hal.loadCases), phi)
    .filter((c) => !variant.scheefstand || c.scheefstandRichting !== undefined);
  const gevallen = variant.scheefstand ? [] : hal.loadCases;
  assert.equal(hal.loadCases.length, 5, `${variant.naam}: vijf belastinggevallen`);
  assert.equal(combinaties.length, variant.scheefstand ? 28 : 14,
    `${variant.naam}: ${variant.scheefstand ? "7 UGT-combinaties × 4 richtingen" : "14 standaardcombinaties"}`);

  const taken = [
    ...gevallen.map((geval) => ({
      label: `geval ${geval.id} ${geval.name}`,
      verwacht: hand[geval.id],
      reken: () => solveOpenFem3D(model, geval.id, "p-delta", options),
    })),
    ...combinaties.map((c) => {
      const verwacht = [0, 1, 2].map((as) =>
        [...c.factors].reduce((t, [geval, factor]) => t + factor * (hand[geval]?.[as] ?? 0), 0));
      const scheef = scheefstandVanCombinatie(c, phi);
      if (scheef) verwacht[scheef.as === "x" ? 0 : 1] -= scheef.richting * scheef.phi * verwacht[2];
      return {
        label: c.name, verwacht,
        reken: () => solveOpenFem3DCombination(model, c.factors, "p-delta", scheef, options),
        eersteOrde: () => solveOpenFem3DCombination(model, c.factors, "linear", scheef, options),
      };
    }),
  ];
  for (const taak of taken) {
    assert.ok(taak.verwacht?.every(Number.isFinite), `${variant.naam}, ${taak.label}: handsom bekend`);
  }
  console.log(`\n[${variant.naam}] ${hal.model.nodes.length} knopen, ${hal.model.beams.length} staven, `
    + `${hal.model.supports.length} opleggingen; ${gevallen.length} gevallen, ${combinaties.length} combinaties`
    + (phi ? `, φ_X = 1/${(1 / phi.x).toFixed(1)}, φ_Y = 1/${(1 / phi.y).toFixed(1)}` : ""));
  const variantGestart = performance.now();
  const uitkomsten = await inPool(taken.map((taak) => async () => {
    const t0 = performance.now();
    try { return { r: await taak.reken(), ms: performance.now() - t0 }; }
    catch (fout) { return { fout, ms: performance.now() - t0 }; }
  }), TEGELIJK);

  let geweigerd = 0;
  for (const [index, taak] of taken.entries()) {
    const { r, fout, ms } = uitkomsten[index];
    const naam = `${variant.naam}, ${taak.label}`;
    try {
      const melding = String(fout?.message ?? fout ?? "");
      const alphaKern = Number(/alpha_cr=([0-9.]+)/.exec(melding)?.[1]);
      if (fout && variant.knikkendeVerbanden && taak.eersteOrde && Number.isFinite(alphaKern)) {
        // Terecht geweigerd? Alleen als de hand de knik van een verband voorspelt.
        const hand = verbandknik(hal.model, await taak.eersteOrde());
        assert.ok(hand <= 1, `${naam}: geweigerd met α_cr ${alphaKern}, maar de verbanden knikken volgens de hand niet (${hand})`);
        assert.ok(alphaKern >= hand * (1 - 1e-6) && alphaKern <= hand * 1.002,
          `${naam}: α_cr ${alphaKern} tegen de knik van het verband ${hand}`);
        assert.ok(melding.includes(VERBAND) && melding.includes("eigen knikkracht"), `${naam}: de melding noemt het verband: ${melding}`);
        geweigerd++;
        geslaagd++;
        console.log(`  ✓ ${taak.label.padEnd(62)} terecht geweigerd: het verband knikt zelf, α_cr ${fmt(alphaKern)} `
          + `(hand π²EI/(L²|N|) = ${fmt(hand)})`);
        continue;
      }
      if (fout) throw fout;
      assert.equal(r.analysis, "p-delta", `${naam}: tweede orde gerekend, niet terug naar eerste orde`);
      assert.equal(r.secondOrder?.converged, true, `${naam}: de iteratie convergeert`);
      assert.equal(r.secondOrder?.stable, true, `${naam}: stabiel`);
      assert.ok(Number.isFinite(r.secondOrder.maxAmplification), `${naam}: eindige versterking`);
      const alpha = r.buckling?.status === "available" ? r.buckling.modes[0]?.loadFactor : undefined;
      assert.ok(alpha > 1, `${naam}: eerste knikfactor beschikbaar en > 1 (${alpha})`);
      ["fx", "fy", "fz"].forEach((as, i) => {
        const verschil = Math.abs(som(r, as) - taak.verwacht[i]);
        assert.ok(verschil <= GRENS_KN,
          `${naam}: ΣR ${as} = ${som(r, as)}, handsom ${taak.verwacht[i]}, verschil ${verschil.toExponential(2)} kN`);
      });
      const fb = r.forceBalance;
      assert.ok(fb?.secondOrderMomentKnm, `${naam}: de krachtensom rekent met het tweede-ordemoment`);
      assert.equal(fb.ok, true,
        `${naam}: onafhankelijke krachtensom (ΔF ${fb.maxImbalanceKn} kN, ΔM ${fb.maxMomentImbalanceKnm} kNm)`);
      totaal.maxDF = Math.max(totaal.maxDF, fb.maxImbalanceKn);
      totaal.maxDM = Math.max(totaal.maxDM, fb.maxMomentImbalanceKnm);
      totaal.minAlpha = Math.min(totaal.minAlpha, alpha);
      totaal.maxB = Math.max(totaal.maxB, r.secondOrder.maxAmplification);
      totaal.maxIt = Math.max(totaal.maxIt, r.secondOrder.iterations);
      geslaagd++;
      console.log(`  ✓ ${taak.label.padEnd(62)} it ${r.secondOrder.iterations}, B ${r.secondOrder.maxAmplification.toFixed(4)}, `
        + `α_cr ${fmt(alpha)}, ΣR (${taak.verwacht.map(fmt).join("; ")}) = hand, `
        + `ΔF ${fmt(fb.maxImbalanceKn)} kN, ΔM ${fmt(fb.maxMomentImbalanceKnm)} kNm, ${ms.toFixed(0)} ms`);
    } catch (e) {
      fouten.push(String(e?.message ?? e));
      console.log(`  ✗ ${taak.label}: ${String(e?.message ?? e).slice(0, 400)}`);
    }
  }
  if (geweigerd !== (variant.knikkendeVerbanden ?? 0)) {
    const tekst = `${variant.naam}: ${geweigerd} berekening(en) geweigerd om knikkende verbanden, verwacht ${variant.knikkendeVerbanden ?? 0}`;
    fouten.push(tekst);
    console.log(`  ✗ ${tekst}`);
  }
  console.log(`  (${variant.naam}: ${((performance.now() - variantGestart) / 1000).toFixed(1)} s, ${TEGELIJK} tegelijk)`);
}

console.log(`\nP-Δ over alle berekeningen: grootste ΔF ${fmt(totaal.maxDF)} kN, grootste ΔM ${fmt(totaal.maxDM)} kNm, `
  + `kleinste α_cr ${fmt(totaal.minAlpha)}, grootste versterking ${totaal.maxB.toFixed(4)}, hoogstens ${totaal.maxIt} iteraties; `
  + `looptijd ${((performance.now() - gestart) / 1000).toFixed(1)} s`);
console.log(`${geslaagd} geslaagd, ${fouten.length} gefaald`);
if (fouten.length > 0) {
  console.error(`\nMislukt:\n${fouten.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("staalhal P-Δ: geslaagd");

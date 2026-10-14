// De app-kant van de controle van 12 oktober 2026 (punten K1, K2 en C8): de
// modelcontrole en de rekenpoort van de app, de vertaling van de nieuwe
// meldingen, en het veldmaximum in de momentenlijn van het tekenvlak.
//
// WAT ER MISGING
//  K1: een koppel met zijn waarde in `fz` in plaats van `my` kwam door de
//      modelcontrole van de app: de mapping maakte er `my: 0` van, en
//      `teltLastMee` zag een invoerregel en zei "telt mee". Zonder andere
//      lasten werd het geval zelfs stil overgeslagen.
//  K2: een lijnlast met alleen qStart/qEnd werd getekend, maar de rekenpoort
//      weigerde hem met "levert geen invoer voor de solver op … een lijnlast
//      heeft `beamId` en `q` nodig" — een programmeursmelding in vaste
//      Nederlandse tekst.
//  C8: de momentenlijn op het tekenvlak verfijnde het veldextreem met een
//      parabool door drie stations; exact bij een gelijkmatige last, bij een
//      trapezium op afronding na. Nu met V = dM/dx, dezelfde regel als de
//      omhullende en de toetsinvoer (die tot oktober 2026 wél op de stations
//      bleven hangen).
//
// WAT DEZE TEST VASTLEGT
//  [1] 052 zoals ingevoerd: de modelcontrole noemt alle vier de lasten, ook
//      het koppel; de rekenpoort weigert. Alleen het koppel: ook geweigerd.
//  [2] 028-a (driehoek zonder q) gaat door de poort en rekent 43,5 / 24,5 kN.
//      Een lijnlast zonder waarde: "Lijnlast 2 op staaf 1 heeft geen waarde".
//  [2b] Een lijnlast met een omgekeerd (startFrac 0,8, endFrac 0,2) of leeg
//      (0,5/0,5) belast deel: geweigerd. Zonder die weigering viel de last in
//      zijn geheel weg (R = 0,5/0,5 kN van alleen de puntlast van 1 kN);
//      correct ingevoerd (0,2/0,8) R = 10·3,6/2 + 1/2 = 18,5 kN per oplegging.
//  [3] De nieuwe meldingen: Nederlands = de tekst van het .ts-bestand, en in
//      en/de/fr een eigen vertaling.
//  [4] De momentenlijn op het tekenvlak toont het veldmaximum: 25,3 kNm bij
//      de ingeklemde ligger, 13,9 kNm bij de driehoekslast (één decimaal),
//      en bij een driehoek van 600 kN/m het exacte 1385,6 kNm en niet de
//      1385,8 kNm van de oude parabool door drie stations.
//
// Draaien met: npx tsx test-lastwaarde-modelcontrole.mjs  (alleen tegen de bron)

import { renderToStaticMarkup } from "react-dom/server";
const { zetTaal, default: i18next } = await import("./scripts/i18n-voor-tests.mjs");
const React = (await import("react")).default;

const { controleerModel, lastWaardeFout } = await import("./src/lib/modelControle.ts");
const { controleerVoorRekenen } = await import("./src/lib/rekenPoort.ts");
const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");
const { solveAllCases } = await import("./src/components/fem/solver/engine.ts");
const { vertaal } = await import("./src/lib/vertaalbareTekst.ts");
const overlay = await import("./src/components/fem/FemResultsOverlay.tsx");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? ` — ${extra}` : ""}`); }
}

const ligger = (loads) => ({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }],
  beams: [{ id: 1, from: 1, to: 2, profile: "IPE300", material: "S235" }],
  supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
  plates: [],
  loadCases: [{ id: 1, name: "G", type: "dead" }],
  loads,
});
const fouten = (model) => controleerModel(model).filter((b) => b.ernst === "fout");
const weigering = (model) => {
  try { controleerVoorRekenen(model); return null; } catch (e) { return e.message; }
};
const metDefaults = (m) => ({ selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1, ...m });

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] K1 — 052 zoals ingevoerd, en het koppel met fz");
// ─────────────────────────────────────────────────────────────────────────
{
  const m052 = ligger([
    { id: 1, type: "lineLoad", beamId: 1, q: -10, caseId: 5 },
    { id: 2, type: "pointForce", posFrac: 0.5, fz: -20, caseId: 1 },
    { id: 3, type: "pointMoment", nodeId: 1, fz: -7, caseId: 1 },
    { id: 4, type: "lineLoad", beamId: 1, fz: -3, caseId: 1 },
  ]);
  const f = fouten(m052);
  ok("vier bevindingen (was drie: het koppel ontbrak)", f.length === 4, f.map((b) => b.tekst.slice(0, 40)).join(" | "));
  ok("het koppel: \"Koppel 3 op knoop 1 heeft geen waarde in `my`: `fz` …\"",
    f.some((b) => b.tekst.startsWith("Koppel 3 op knoop 1 heeft geen waarde in `my`: `fz` wordt bij een koppel niet gelezen.")));
  ok("de lijnlast met fz: \"Lijnlast 4 op staaf 1 heeft geen waarde: `fz` …\"",
    f.some((b) => b.tekst.startsWith("Lijnlast 4 op staaf 1 heeft geen waarde: `fz` wordt bij een lijnlast niet gelezen.")));
  ok("de rekenpoort weigert", /Model niet doorgerekend — 4 bevindingen/.test(weigering(m052) ?? ""), weigering(m052) ?? "GEEN WEIGERING");

  const alleenKoppel = ligger([{ id: 3, type: "pointMoment", nodeId: 1, fz: -7, caseId: 1 }]);
  ok("alleen het koppel met fz: geweigerd (was: geval stil overgeslagen)", /Koppel 3 op knoop 1/.test(weigering(alleenKoppel) ?? ""), weigering(alleenKoppel) ?? "GEEN WEIGERING");
  const mi = bouwMultiInput(metDefaults(alleenKoppel));
  ok("de mapping maakt er geen koppel van 0 meer van", (mi.pointLoads ?? []).length === 0, JSON.stringify(mi.pointLoads));
  const metQ = ligger([
    { id: 1, type: "lineLoad", beamId: 1, q: -10, caseId: 1 },
    { id: 2, type: "pointMoment", nodeId: 1, fz: -7, caseId: 1 },
  ]);
  ok("koppel met fz naast een lijnlast: geweigerd (was: R 30/30 kN, M[knoop 1] = 0)", weigering(metQ) !== null);
  const goed = ligger([
    { id: 1, type: "lineLoad", beamId: 1, q: -10, caseId: 1 },
    { id: 2, type: "pointMoment", nodeId: 1, my: -7, caseId: 1 },
  ]);
  ok("koppel met my: geen bevinding", fouten(goed).length === 0, JSON.stringify(fouten(goed)));
  const r = solveAllCases(bouwMultiInput(metDefaults(goed))).perCase.get(1);
  ok("koppel met my: R₁ = 30 − 7/6 kN (hand)", Math.abs(r.reactions.get(1).fz / 1000 - (30 - 7 / 6)) < 1e-6, String(r.reactions.get(1).fz));
  ok("koppel met my: |M(knoop 1)| = 7 kNm", Math.abs(Math.abs(r.elements.get(1).M_start) / 1e6 - 7) < 1e-6, String(r.elements.get(1).M_start));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] K2 — de driehoek zonder q in de app, en een lijnlast zonder waarde");
// ─────────────────────────────────────────────────────────────────────────
{
  const m028a = (driehoek) => ligger([
    { id: 1, type: "lineLoad", beamId: 1, q: -10, startFrac: 0, endFrac: 0.5, caseId: 1 },
    { id: 2, type: "lineLoad", beamId: 1, ...driehoek, caseId: 1 },
    { id: 3, type: "pointForce", beamId: 1, posFrac: 0.25, fz: -20, caseId: 1 },
  ]);
  const zonderQ = m028a({ qStart: 0, qEnd: -6 });
  ok("driehoek zonder q: geen bevinding in de modelcontrole", fouten(zonderQ).length === 0, JSON.stringify(fouten(zonderQ)));
  ok("de rekenpoort laat hem door (was: \"levert geen invoer voor de solver op\")", weigering(zonderQ) === null, weigering(zonderQ) ?? "");
  const r = solveAllCases(bouwMultiInput(metDefaults(zonderQ))).perCase.get(1);
  ok("R_A = 43,5 kN (hand)", Math.abs(r.reactions.get(1).fz / 1000 - 43.5) < 1e-6, String(r.reactions.get(1).fz / 1000));
  ok("R_B = 24,5 kN (hand)", Math.abs(r.reactions.get(2).fz / 1000 - 24.5) < 1e-6, String(r.reactions.get(2).fz / 1000));

  const geen = m028a({});
  const f = fouten(geen);
  ok("zonder waarde: één bevinding, \"Lijnlast 2 op staaf 1 heeft geen waarde.\"",
    f.length === 1 && f[0].tekst.startsWith("Lijnlast 2 op staaf 1 heeft geen waarde."), JSON.stringify(f.map((b) => b.tekst)));
  ok("de bevinding is vertaalbaar (tekenvlak in de taal van de gebruiker)", f[0]?.tekstVertaalbaar?.sleutel === "common:canvas.modelCheck.loadValue.lineNone");
  ok("de rekenpoort weigert met die tekst", /Lijnlast 2 op staaf 1 heeft geen waarde/.test(weigering(geen) ?? ""), weigering(geen) ?? "");
  ok("geen programmeursmelding meer", !/levert geen invoer/.test(weigering(geen) ?? ""));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2b] K2 — een lijnlast met een omgekeerd of leeg belast deel");
// ─────────────────────────────────────────────────────────────────────────
{
  const metDeel = (deel) => ligger([
    { id: 1, type: "lineLoad", beamId: 1, ...deel, caseId: 1 },
    { id: 2, type: "pointForce", beamId: 1, posFrac: 0.5, fz: -1, caseId: 1 },
  ]);
  for (const [naam, deel, kern] of [
    ["omgekeerd (0,8 → 0,2)", { q: -10, startFrac: 0.8, endFrac: 0.2 }, "(startFrac 0.8, endFrac 0.2)"],
    ["leeg (0,5 → 0,5), trapezium", { qStart: -10, qEnd: -10, startFrac: 0.5, endFrac: 0.5 }, "(startFrac 0.5, endFrac 0.5)"],
    ["geheel voorbij het einde (1,2 → 1,5)", { q: -10, startFrac: 1.2, endFrac: 1.5 }, "(startFrac 1.2, endFrac 1.5)"],
  ]) {
    const model = metDeel(deel);
    const f = fouten(model);
    ok(`${naam}: één bevinding, "Lijnlast 1 op staaf 1: het belaste deel begint niet vóór zijn einde ${kern}"`,
      f.length === 1 && f[0].tekst.startsWith(`Lijnlast 1 op staaf 1: het belaste deel begint niet vóór zijn einde ${kern}.`),
      JSON.stringify(f.map((b) => b.tekst)));
    ok(`${naam}: vertaalbaar (lineRange)`, f[0]?.tekstVertaalbaar?.sleutel === "common:canvas.modelCheck.loadValue.lineRange");
    ok(`${naam}: de rekenpoort weigert (was: R = 0,5/0,5 kN, de last stil weg)`,
      /het belaste deel begint niet vóór zijn einde/.test(weigering(model) ?? ""), weigering(model) ?? "GEEN WEIGERING");
  }
  const goed = metDeel({ q: -10, startFrac: 0.2, endFrac: 0.8 });
  ok("correct (0,2 → 0,8): geen bevinding", fouten(goed).length === 0, JSON.stringify(fouten(goed)));
  ok("correct (0,2 → 0,8): de rekenpoort laat hem door", weigering(goed) === null, weigering(goed) ?? "");
  const r = solveAllCases(bouwMultiInput(metDefaults(goed))).perCase.get(1);
  ok("correct: R₁ = 10·3,6/2 + 1/2 = 18,5 kN (hand)", Math.abs(r.reactions.get(1).fz / 1000 - 18.5) < 1e-6, String(r.reactions.get(1).fz / 1000));
  ok("correct: R₂ = 18,5 kN (hand)", Math.abs(r.reactions.get(2).fz / 1000 - 18.5) < 1e-6, String(r.reactions.get(2).fz / 1000));
  // Een deel dat maar GEDEELTELIJK buiten de staaf valt, is een ingekorte last
  // en geen lege: geen bevinding (de engine klemt op 0..1).
  ok("gedeeltelijk buiten de staaf (−0,1 → 0,5): geen bevinding",
    fouten(metDeel({ q: -10, startFrac: -0.1, endFrac: 0.5 })).length === 0);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] De nieuwe meldingen in vier talen");
// ─────────────────────────────────────────────────────────────────────────
{
  const monsters = [
    { id: 2, type: "lineLoad", beamId: 1 },
    { id: 2, type: "lineLoad", beamId: 1, fz: -3 },
    { id: 2, type: "lineLoad", beamId: 1, qStart: 0 },
    { id: 2, type: "lineLoad", beamId: 1, q: -5, my: 2 },
    { id: 2, type: "lineLoad", beamId: 1, q: -5, startFrac: 0.8, endFrac: 0.2 },
    { id: 3, type: "pointMoment", nodeId: 1 },
    { id: 3, type: "pointMoment", nodeId: 1, fz: -7 },
    { id: 3, type: "pointMoment", nodeId: 1, my: -7, fx: 2 },
    { id: 4, type: "pointForce", nodeId: 1 },
    { id: 4, type: "pointForce", nodeId: 1, my: 3 },
    { id: 4, type: "pointForce", nodeId: 1, fz: -3, my: 3 },
  ].map((l) => lastWaardeFout(l));
  ok("elk monster geeft een melding", monsters.every((m) => m !== null), String(monsters.filter((m) => m === null).length));
  ok("geldige lasten geven geen melding", [
    { id: 1, type: "lineLoad", beamId: 1, q: -5 },
    { id: 1, type: "lineLoad", beamId: 1, qStart: 0, qEnd: -5 },
    { id: 1, type: "lineLoad", beamId: 1, q: -5, fz: 0 },
    { id: 1, type: "lineLoad", beamId: 1, q: -5, startFrac: 0.2, endFrac: 0.8 },
    { id: 1, type: "pointMoment", nodeId: 1, my: 4 },
    { id: 1, type: "pointForce", nodeId: 1, fx: 2 },
  ].every((l) => lastWaardeFout(l) === null));
  await zetTaal("nl");
  const tNl = i18next.getFixedT("nl", "common");
  const afwijkend = monsters.filter((m) => vertaal(tNl, m.tekstVertaalbaar) !== m.tekst);
  ok("nl: de vertaling is letterlijk de tekst van het .ts-bestand", afwijkend.length === 0,
    afwijkend.map((m) => `"${vertaal(tNl, m.tekstVertaalbaar)}" ≠ "${m.tekst}"`).join(" | "));
  for (const taal of ["en", "de", "fr"]) {
    await zetTaal(taal);
    const t = i18next.getFixedT(taal, "common");
    const vertaald = monsters.map((m) => vertaal(t, m.tekstVertaalbaar));
    ok(`${taal}: elke melding vertaald (geen sleutel, geen Nederlands)`,
      vertaald.every((v, i) => !v.includes("canvas.modelCheck") && v !== monsters[i].tekst && !/ heeft geen waarde| wordt bij een /.test(v)),
      vertaald.slice(0, 2).join(" | "));
    ok(`${taal}: getallen komen mee`, vertaald[0].includes("2") && vertaald[0].includes("1"), vertaald[0]);
  }
  await zetTaal("nl");
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] C8 — de momentenlijn op het tekenvlak toont het veldmaximum");
// ─────────────────────────────────────────────────────────────────────────
{
  const rendereer = (model) => {
    const result = solveAllCases(bouwMultiInput(metDefaults(model))).perCase.get(1);
    return renderToStaticMarkup(React.createElement(overlay.default, {
      nodes: model.nodes, beams: model.beams, supports: model.supports, result,
      worldToScreen: (x, z) => ({ x: 60 + x * 0.08, y: 300 - z * 0.08 }), canvasW: 1200, canvasH: 600,
      displayFlags: {
        ...overlay.DEFAULT_DISPLAY_FLAGS,
        deflection: false, reactions: false, N: false, V: false, rotation: false,
        M: true, showExtremes: true,
      },
    }));
  };
  const ingeklemd = ligger([{ id: 1, type: "lineLoad", beamId: 1, q: -10, caseId: 1 }]);
  ingeklemd.supports = [{ nodeId: 1, type: "fixed" }, { nodeId: 2, type: "zRoller" }];
  const svg = rendereer(ingeklemd);
  ok("ingeklemd-rol: veldmaximum 25,3 kNm = 9qL²/128", svg.includes("25,3 kNm"), (svg.match(/[−\d,]+ kNm/g) ?? []).join(" "));
  const driehoek = ligger([{ id: 1, type: "lineLoad", beamId: 1, qStart: 0, qEnd: -6, caseId: 1 }]);
  const svg2 = rendereer(driehoek);
  ok("driehoekslast zonder q: veldmaximum 13,9 kNm = q₀L²/(9√3)", svg2.includes("13,9 kNm"), (svg2.match(/[−\d,]+ kNm/g) ?? []).join(" "));

  // Onderscheid tussen de Hermite-verfijning (V als helling) en de oude
  // parabool door drie stations. Bij q₀ = 6 kN/m ronden beide af op 13,9; de
  // parabool zit q₀-onafhankelijk ~1,2e-4 relatief te hoog. Bij q₀ = 600 kN/m
  // is dat 0,16 kNm, genoeg voor een ander label met één decimaal. De test
  // rekent de parabool van de stations zelf na en eist dat die echt een ander
  // label geeft; anders zegt deze controle niets.
  const q0 = 600;
  const zwaar = ligger([{ id: 1, type: "lineLoad", beamId: 1, qStart: 0, qEnd: -q0, caseId: 1 }]);
  const ef = solveAllCases(bouwMultiInput(metDefaults(zwaar))).perCase.get(1).elements.get(1);
  const M = ef.bendingMoment.map((m) => m / 1e6);
  let i = 1;
  for (let k = 1; k < M.length - 1; k++) if (Math.abs(M[k]) > Math.abs(M[i])) i = k;
  const [y0, y1, y2] = [M[i - 1], M[i], M[i + 1]];
  const parabool = y1 - 0.25 * (y0 - y2) * ((0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2));
  const exact = (q0 * 36) / (9 * Math.sqrt(3)); // q₀L²/(9√3), L = 6 m
  const label = (v) => `${overlay.fmtNl(v)} kNm`;
  ok(`voorwaarde: parabool (${label(parabool)}) en exact (${label(exact)}) geven een ander label`, label(parabool) !== label(exact));
  const svg3 = rendereer(zwaar);
  const labels3 = (svg3.match(/[−\d,]+ kNm/g) ?? []).join(" ");
  ok(`driehoek q₀ = 600 kN/m: het label is het exacte veldmaximum, ${label(exact)}`, svg3.includes(label(exact)), labels3);
  ok(`driehoek q₀ = 600 kN/m: niet de parabool, ${label(parabool)}`, !svg3.includes(label(parabool)), labels3);
}

log(`\n${failed === 0 ? "GESLAAGD" : "GEFAALD"}: ${passed} geslaagd, ${failed} gefaald.`);
process.exit(failed === 0 ? 0 : 1);

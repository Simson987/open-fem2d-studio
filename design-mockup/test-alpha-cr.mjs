// Kritieke lastfactor α_cr per combinatie (basisaudit nr 27). Bewaakt:
//   1. α_cr van het meetportaal (6 × 4 m, HEA160, q = 20 kN/m, γ = 1,35) komt
//      overeen met de factor waarbij de tweede-orde-berekening van dezelfde
//      motor divergeert: scharnierende voeten 5,75·G → α_cr = 5,75/1,35 = 4,26,
//      ingeklemde voeten 23,73·G → 17,58 (gemeten in de basisaudit met
//      meet-alphacr.mjs). Met twee elementen per staaf ligt de knikvorm iets
//      lager dan met één; de toleranties laten dat toe;
//   2. de Euler-kolom: pinned-pinned, P = 0,1·P_E → α_cr = 10 binnen 1 %
//      (met één element per staaf zou het 12,2 zijn — 21,6 % te hoog);
//   3. een ligger zonder druk geeft "geen_druk"; een BGT-combinatie wordt
//      overgeslagen;
//   4. de meldingen (issue #199, B14): α_cr is INFORMATIEF. De toets rekent
//      altijd zelf tweede orde (P-Δ) met scheefstand, dus eerste orde met
//      α_cr < 10 is geen FOUT meer maar een info-regel over de RESULTATEN;
//      tweede orde zonder scheefstand ook. De enige FOUT is een geweigerde
//      toets (B7);
//   5. de toelichting noemt de resultaten (de gekozen analyse, met of zonder
//      scheefstand) en de toetskrachten (tweede orde P-Δ met scheefstand
//      φ = 1/…, systeemlengte 5.2.2(7)b) elk op een eigen regel; de regel
//      "eerste orde is toegestaan" gaat alleen over de resultaten.
// Praat alleen met engine, combinations en alphaCr; draait ook tegen de bundel.
// Uitvoeren: npx tsx test-alpha-cr.mjs

const { solveAllCases } = await import("./src/components/fem/solver/engine.ts");
const { combineResults } = await import("./src/components/fem/solver/combinations.ts");
const { bepaalAlphaCr, stabiliteitsMeldingen, analyseToelichting, alphaCrLabel, toetsKrachtenRegel } =
  await import("./src/components/fem/solver/alphaCr.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function check(name, cond, detail = "") {
  if (cond) { passed++; log(`  ✓ ${name}`); }
  else      { failed++; log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const binnen = (a, b, pct) => Math.abs(a - b) <= Math.abs(b) * pct / 100;

const E = 210000, A = 3877, I = 1.673e7;
const uls = (id, name, factors) => ({ id, name, type: "uls", formula: "", factors: new Map(factors) });

function portaal(basis, q) {
  const h = 4000, b = 6000;
  return {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: h }, { id: 3, x: b, z: h }, { id: 4, x: b, z: 0 }],
    beams: [
      { id: 1, from: 1, to: 2, E, A, I },
      { id: 2, from: 2, to: 3, E, A, I },
      { id: 3, from: 3, to: 4, E, A, I },
    ],
    supports: [{ nodeId: 1, type: basis }, { nodeId: 4, type: basis }],
    cases: [{ id: 1, name: "G" }],
    loads: [{ beamId: 2, q: -q, caseId: 1 }],
  };
}
function reken(input, combos) {
  const { perCase } = solveAllCases(input);
  const combinationResults = new Map(combos.map((c) => [c.id, combineResults(c, perCase)]));
  return bepaalAlphaCr(input, combos, combinationResults);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] Portaal 6×4 m HEA160, q = 20 kN/m, 1,35G: α_cr tegen de P-Δ-divergentie van de motor");
{
  const combos = [uls(1, "1.35G", [[1, 1.35]])];
  const p = reken(portaal("pinned", 20), combos)[0];
  check(`scharnierende voeten: bepaald, α_cr ≈ 4,26 (±3 %) — ${alphaCrLabel(p)}`, p.status === "bepaald" && binnen(p.alphaCr, 4.26, 3), `${p.alphaCr}`);
  const f = reken(portaal("fixed", 20), combos)[0];
  check(`ingeklemde voeten: bepaald, α_cr ≈ 17,58 (±3 %) — ${alphaCrLabel(f)}`, f.status === "bepaald" && binnen(f.alphaCr, 17.58, 3), `${f.alphaCr}`);
  check("de laagste ligt onder 10, de andere erboven", p.alphaCr < 10 && f.alphaCr > 10);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] Euler-kolom pinned-pinned, P = 0,1·P_E → α_cr = 10 (±1 %)");
{
  const L = 3000;
  const P_E = Math.PI ** 2 * E * I / (L * L);  // N
  const input = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: L }],
    beams: [{ id: 1, from: 1, to: 2, E, A, I }],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "xRoller" }],
    cases: [{ id: 1, name: "P" }],
    loads: [],
    pointLoads: [{ nodeId: 2, fz: -0.1 * P_E, caseId: 1 }],
  };
  const u = reken(input, [uls(1, "P", [[1, 1]])])[0];
  check(`α_cr = ${alphaCrLabel(u)} ≈ 10,0`, u.status === "bepaald" && binnen(u.alphaCr, 10, 1), `${u.alphaCr}`);
  const u2 = reken({ ...input, pointLoads: [{ nodeId: 2, fz: -0.005 * P_E, caseId: 1 }] }, [uls(1, "P", [[1, 1]])])[0];
  check("P = 0,005·P_E → boven de zoekgrens (α_cr > 100)", u2.status === "boven_grens" && u2.grens === 100, JSON.stringify(u2));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] Ligger zonder druk → geen_druk; BGT-combinatie overgeslagen");
{
  const input = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, E, A, I }],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
    cases: [{ id: 1, name: "G" }],
    loads: [{ beamId: 1, q: -10, caseId: 1 }],
  };
  const combos = [uls(1, "UGT", [[1, 1.35]]), { id: 2, name: "BGT", type: "sls", formula: "", factors: new Map([[1, 1]]) }];
  const r = reken(input, combos);
  check("één uitkomst (alleen UGT)", r.length === 1 && r[0].combinatieId === 1);
  check("status geen_druk", r[0].status === "geen_druk");
  check("geen meldingen bij geen druk", stabiliteitsMeldingen(r, "eersteOrde", false).length === 0);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] Meldingen (B14): α_cr is informatief; alleen een geweigerde toets is een FOUT");
{
  const combos = [uls(1, "1.35G", [[1, 1.35]])];
  const r = reken(portaal("pinned", 20), combos);
  // GEWIJZIGD door issue #199 (B14). Tot 2026.42 was eerste orde met
  // α_cr = 4,26 < 10 een FOUT ("EERSTE ORDE NIET TOEGESTAAN … unity checks NIET
  // bruikbaar"), met een melding op het scherm en een rood vak in Inzichten, en
  // tweede orde zonder scheefstand een waarschuwing. De toets rekent nu altijd
  // zelf P-Δ met scheefstand (5.2.2(3)b en (7)b); α_cr < 10 zegt dan alleen nog
  // iets over de RESULTATEN, en is dus een info-regel. Hetzelfde α_cr = 4,26.
  const eo = stabiliteitsMeldingen(r, "eersteOrde", false);
  check("eerste orde: één info-regel met 5.2.1(3) en de combinatienaam, geen FOUT",
    eo.length === 1 && eo[0].niveau === "info" && /5\.2\.1\(3\)/.test(eo[0].tekst) && /1\.35G/.test(eo[0].tekst), JSON.stringify(eo));
  check("… over de resultaten, met de toets als tweede orde met scheefstand; geen 'niet toegestaan'",
    /resultaten/.test(eo[0].tekst) && /toets/.test(eo[0].tekst) && /scheefstand/.test(eo[0].tekst)
      && !/NIET TOEGESTAAN|NIET bruikbaar/i.test(eo[0].tekst), eo[0].tekst);
  const w = stabiliteitsMeldingen(r, "tweedeOrdeGeometrisch", false);
  check("tweede orde zonder scheefstand: info (was een waarschuwing)",
    w.length === 1 && w[0].niveau === "info" && /scheefstand/.test(w[0].tekst), JSON.stringify(w));
  const i = stabiliteitsMeldingen(r, "tweedeOrdeGeometrisch", true);
  check("tweede orde met scheefstand: alleen info", i.length === 1 && i[0].niveau === "info");
  const ok = stabiliteitsMeldingen(reken(portaal("fixed", 20), combos), "eersteOrde", false);
  check("ingeklemd (α_cr 17,6): geen melding", ok.length === 0, JSON.stringify(ok));
  const geweigerd = stabiliteitsMeldingen(r, "eersteOrde", false, "De toetskrachten zijn niet te bepalen: test.");
  const fouten = geweigerd.filter((m) => m.niveau === "fout");
  check("een geweigerde toets (B7): één FOUT met de reden, naast de info-regel",
    fouten.length === 1 && /TOETSING GEWEIGERD/.test(fouten[0].tekst) && /niet te bepalen: test/.test(fouten[0].tekst)
      && geweigerd.some((m) => m.niveau === "info"), JSON.stringify(geweigerd));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4b] De toelichting: de resultaten en de toetskrachten, elk op een eigen regel");
{
  const combos = [uls(1, "1.35G", [[1, 1.35]])];
  const r = reken(portaal("pinned", 20), combos);
  const eersteOrde = {
    resultaten: { analysetype: "eersteOrde", label: "1e orde", omschrijving: "Eerste orde, lineair.", scheefstandAan: false },
    toets: { label: "2e orde (P-Δ)", noemer: 200, bronLabel: "vaste noemer", richtingen: "2d", hergebruikt: false },
    alphaCr: r,
  };
  const tekst = analyseToelichting(eersteOrde);
  const regels = tekst.split("\n");
  check("regel 1: de resultaten — 1e orde, zonder scheefstand, ook voor de BGT-toetsen",
    /^Resultaten: 1e orde, zonder scheefstand\. Eerste orde, lineair\./.test(regels[0]) && /BGT-toetsen/.test(regels[0]), regels[0]);
  check("regel 2: de toetskrachten — 2e orde (P-Δ) met scheefstand φ = 1/200 (vaste noemer), in +x en −x, 5.2.2(3)b en (7)b",
    /^Toetskrachten \(UGT\): 2e orde \(P-Δ\) met scheefstand φ = 1\/200 \(vaste noemer\)/.test(regels[1])
      && /\+x en −x/.test(regels[1]) && /systeemlengte/.test(regels[1]) && /5\.2\.2\(3\)b en \(7\)b/.test(regels[1]), regels[1]);
  check("α_cr per combinatie staat erin", /α_cr = 4,\d\d   \[1\.35G\]/.test(tekst), tekst);
  check("de regel over eerste orde (α_cr ≥ 10) gaat alleen over de resultaten",
    /eerste orde is voor de resultaten toegestaan wanneer α_cr ≥ 10/i.test(tekst) && !/^Eerste orde is toegestaan/m.test(tekst), tekst);
  check("geen '!'-regel: α_cr is informatief (B14)", !/^!/m.test(tekst), tekst);

  const pd = analyseToelichting({
    resultaten: { analysetype: "tweedeOrdeGeometrisch", label: "2e orde (P-Δ)", omschrijving: "Tweede orde.", scheefstandAan: true, scheefstandNoemer: 250 },
    toets: { label: "2e orde (P-Δ)", noemer: 250, bronLabel: "vaste noemer", richtingen: "2d", hergebruikt: true },
    alphaCr: r,
    meldingen: ["Hout in de toets: test."],
    weigering: "De toetskrachten zijn niet te bepalen: test.",
  });
  check("met de schakelaar aan: 'met scheefstand φ = 1/250' bij de resultaten",
    /^Resultaten: 2e orde \(P-Δ\), met scheefstand φ = 1\/250\./.test(pd), pd.split("\n")[0]);
  check("hergebruik: de toets gebruikt de resultaten zonder nieuwe som", /zonder nieuwe som/.test(pd.split("\n")[1]));
  check("de meldingen van de toets als '!'-regel", /^! Hout in de toets: test\./m.test(pd), pd);
  check("de weigering als '! TOETSING GEWEIGERD'-regel", /^! TOETSING GEWEIGERD: De toetskrachten zijn niet te bepalen: test\./m.test(pd), pd);

  // Beton in het model: de regel zegt dat 5.2.2(7)b (een staalregel) daar
  // niet geldt en dat §5.8 ongewijzigd blijft (de P-Δ is elastisch).
  const metBeton = toetsKrachtenRegel({ label: "2e orde (P-Δ)", noemer: 200, bronLabel: "vaste noemer", richtingen: "2d", hergebruikt: false, metBeton: true });
  const zonderBeton = toetsKrachtenRegel({ label: "2e orde (P-Δ)", noemer: 200, bronLabel: "vaste noemer", richtingen: "2d", hergebruikt: false });
  check("met beton: de regel noemt §5.8 ongewijzigd en de ongescheurde elastische stijfheid",
    /Voor beton geldt dat niet/.test(metBeton) && /§5\.8/.test(metBeton) && /ongescheurde elastische stijfheid/.test(metBeton), metBeton);
  check("zonder beton: geen betonzin", !/beton/i.test(zonderBeton), zonderBeton);

  const drieD = analyseToelichting({ ...eersteOrde, toets: { ...eersteOrde.toets, noemer: 230.94, bronLabel: "EN 1993-1-1 (5.5)", richtingen: "3d" } });
  check("3D: in +X, −X, +Y en −Y; een gebroken noemer op één decimaal",
    /φ = 1\/230,9 \(EN 1993-1-1 \(5\.5\)\)/.test(drieD) && /\+X, −X, \+Y en −Y/.test(drieD), drieD.split("\n")[1]);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[5] Model met wandschijf: niet bepaald, met reden en een info-regel");
{
  const input = {
    ...portaal("pinned", 20),
    plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thickness: 200, E: 30000, nu: 0.2, rho: 2.5e-6, meshSize: 2000 }],
  };
  const r = bepaalAlphaCr(input, [uls(1, "1.35G", [[1, 1.35]])], new Map());
  check("niet_bepaald met reden 'wandschijven'", r[0].status === "niet_bepaald" && /wandschijven/.test(r[0].reden));
  // GEWIJZIGD door issue #199 (B14): was een waarschuwing. De voorwaarde
  // α_cr ≥ 10 gaat alleen nog over de resultaten; de toets rekent tweede orde.
  check("eerste orde: info dat de voorwaarde voor de resultaten niet is gecontroleerd",
    stabiliteitsMeldingen(r, "eersteOrde", false).some((m) => m.niveau === "info" && /niet gecontroleerd/.test(m.tekst)));
}

log(`\n${"─".repeat(50)}`);
log(`Resultaat: ${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

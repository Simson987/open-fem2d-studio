// Hout in de UGT-toets volgens NEN-EN 1995-1-1 (issue #199, fase 4; instelling
// `houtToetsEN1995`, standaard uit).
//
// Bewaakt:
//   1. γ_M per houtsoort (tabel 2.3 met de NB): massief 1,30, gelamineerd 1,25;
//   2. de boogimperfectie e = 0,0025·l (5.4.4(2)) als vervangende lasten
//      q = 8·N·e/l² en 4·N·e/l, met N uit de eerste orde; de lasten zijn in
//      evenwicht (ΣRx = −H, onveranderd);
//   3. E_d = E_mean/γ_M (2.2.2(1)P) en de boog in de ongunstige richting: het
//      voetmoment van een ingeklemde houten kolom met een vrije kop tegen de
//      exacte oplossing van de differentiaalvergelijking (handberekening);
//   4. de knik: met de instelling L voor een staande houten staaf met een vrij
//      eind (`zijdelingse_knik_in_analyse`), als φ ≥ (5.1) met h = haar lengte;
//      anders 2·L met een kanttekening;
//   5. uit: de krachten en de melding van vóór fase 4 (E_mean, 2·L);
//   6. de MCP-weg (`check` van de sidecar) met het modelveld `houtToetsEN1995`.
//
// HANDBEREKENING
//   Kolom C24 200×200, h = 3000 mm, ingeklemd, kop vrij. E_0,mean = 11 000
//   N/mm², I = 200⁴/12 = 1,3333·10⁸ mm⁴. V = 100 kN op de kop (UGT-factor 1,0),
//   φ = 1/200 (vast; EN 1995-1-1 (5.1) met h = 3 m geeft ook 0,005), H = 0,5 kN.
//   E_d = 11 000/1,3 = 8 461,5 N/mm².
//   Boog: e = 0,0025·3000 = 7,5 mm; q = 8·100 000·7,5/3000² = 0,6667 N/mm,
//   eindkrachten 4·100 000·7,5/3000 = 1 000 N.
//   Exact (balk-kolom, u'' = M/EI met M(y) = (H − F)(h − y) + q(h − y)²/2
//   + N(u(h) − u(y)), boog tegen de scheefstand in, dus q = −0,6667 en F = −1000):
//     zonder boog, E_mean:  M_voet = H·tan(kh)/k = 1,9070 kNm
//     zonder boog, E_d:     M_voet = 2,0869 kNm
//     met boog,    E_d:     M_voet = 2,3884 kNm   (numeriek geïntegreerd, 60 000 stappen)
//   De boog MEE met de scheefstand zou het voetmoment verlagen (1,7853 kNm): bij
//   een ingeklemde kolom met een vrije kop heeft alleen de boog tegen de
//   scheefstand in de kromming van de knikvorm.
// Uitvoeren: npx tsx test-hout-toets-en1995.mjs

const {
  bepaalToetsKrachten2D, houtStavenVoorToets, toetsSet2D, TOETS_HOUT_EN1995_MELDING, TOETS_HOUT_MELDING,
} = await import("./src/lib/toetsKrachten.ts");
const { zijdelingseKnikHoutInVlakModel } = await import("./src/components/fem/solver/alphaCr.ts");
const { bepaalScheefstand, leidScheefstandGeometrieAf } = await import("./src/lib/scheefstandNorm.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function check(name, cond, detail = "") {
  if (cond) { passed++; log(`  ✓ ${name}`); }
  else      { failed++; log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const binnen = (a, b, rel) => Math.abs(a - b) <= Math.abs(b) * rel;

const H_MM = 3000, E = 11000, A = 40000, I = 200 ** 4 / 12;
const ui = {
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: H_MM }],
  beams: [{ id: 1, from: 1, to: 2, material: "C24", profile: "200x200" }],
  supports: [{ nodeId: 1, type: "fixed" }],
};
const basis = {
  nodes: ui.nodes, supports: ui.supports, beams: [{ id: 1, from: 1, to: 2, E, A, I }],
  cases: [{ id: 1, name: "G" }], loads: [], pointLoads: [{ nodeId: 2, fz: -100000, caseId: 1 }],
};
const ULS = { id: 1, name: "G", type: "uls", formula: "", factors: new Map([[1, 1]]) };
const project = bepaalScheefstand({ bron: "vast", noemer: 200 }, leidScheefstandGeometrieAf(ui), ["en1995"]);
const toets = (hout) => bepaalToetsKrachten2D({
  basis, combinaties: [ULS], analysetype: "eersteOrde",
  scheefstand: { project, normen: ["en1995"], richting: 1, modelAan: false },
  ...(hout ? { hout: { gammaM: houtStavenVoorToets(ui.beams) } } : {}),
});
const mVoet = (t, id = 1) => Math.abs(t.combinationResults.get(id).reactions.get(1).my) / 1e6;

log("\n[1] γ_M per houtsoort");
{
  const g = houtStavenVoorToets([
    { id: 1, material: "C24", profile: "200x200" }, { id: 2, material: "GL24h", profile: "200x400" },
    { id: 3, material: "S235", profile: "HEA 200" },
  ]);
  check("C24 → 1,30; GL24h → 1,25; staal niet", g.get(1) === 1.3 && g.get(2) === 1.25 && !g.has(3), JSON.stringify([...g]));
}

log("\n[2] De boog en het voetmoment");
const met = toets(true), zonder = toets(false);
{
  check("geen weigering", met.weigering === null && zonder.weigering === null);
  const b = met.hout?.bogen.get(1)?.[0];
  check("boog: N = 100 kN, e = 7,5 mm, q = 0,6667 N/mm, eindkracht 1 000 N",
    b && binnen(b.nDruk, 100000, 1e-6) && binnen(b.e, 7.5, 1e-12) && binnen(b.q, 2 / 3, 1e-6) && binnen(b.eindkracht, 1000, 1e-6),
    JSON.stringify(b));
  check("boog tegen de scheefstand in (+x): lokale +y = −x, zin = +1", b?.zin === 1, JSON.stringify(b));
  const bMin = met.hout?.bogen.get(1 + 1_000_000)?.[0];
  check("−x-variant: de boog keert mee (zin = −1)", bMin?.zin === -1, JSON.stringify(bMin));
  const som = [...met.combinationResults.get(1).reactions.values()].reduce((s, r) => s + r.fx, 0);
  check("ΣRx = −H = −500 N (de vervangende lasten van de boog zijn in evenwicht)", binnen(som, -500, 1e-6), `${som}`);
  log(`    M_voet: met ${mVoet(met).toFixed(4)} kNm (exact 2,3884), zonder ${mVoet(zonder).toFixed(4)} kNm (exact 1,9070)`);
  check("met E_d en boog: M_voet = 2,3884 kNm binnen 1 %", binnen(mVoet(met), 2.3884, 0.01), `${mVoet(met)}`);
  check("zonder (E_mean, geen boog, vóór fase 4): M_voet = 1,9070 kNm binnen 1 %", binnen(mVoet(zonder), 1.9070, 0.01), `${mVoet(zonder)}`);
  check("−x: even groot", binnen(mVoet(met, 1 + 1_000_000), mVoet(met), 1e-6));
  check("melding: de route van EN 1995 met, de oude zonder",
    met.meldingen.includes(TOETS_HOUT_EN1995_MELDING) && !met.meldingen.includes(TOETS_HOUT_MELDING)
      && zonder.meldingen.includes(TOETS_HOUT_MELDING));
  check("geen hergebruik met de instelling", met.analyse.hergebruikt === false);
}

log("\n[3] De knik van een staand vrij houten eind");
{
  const set = toetsSet2D(met, { combinaties: [ULS], combinationResults: new Map(), perCase: null }, ui.beams);
  const setZonder = toetsSet2D(zonder, { combinaties: [ULS], combinationResults: new Map(), perCase: null }, ui.beams);
  check("toetsset: houtEN1995", set.stabiliteit.houtEN1995 === true && setZonder.stabiliteit.houtEN1995 === undefined);
  const b = zijdelingseKnikHoutInVlakModel(set.stabiliteit, true, 3, [1]);
  check("h = 3 m, φ = 1/200 ≥ (5.1) 1/200: L (veld y)", b.veld?.y === true && !b.notitie, JSON.stringify(b));
  check("zonder de instelling: niets (2·L)", JSON.stringify(zijdelingseKnikHoutInVlakModel(setZonder.stabiliteit, true, 3, [1])) === "{}");
  check("liggend: niets", JSON.stringify(zijdelingseKnikHoutInVlakModel(set.stabiliteit, false, 3, [1])) === "{}");
  // φ = 1/250 < 1/200: 2·L met kanttekening.
  const krap = zijdelingseKnikHoutInVlakModel({ ...set.stabiliteit, scheefstandPhi: 1 / 250 }, true, 3, [1]);
  check("φ = 1/250 < 1/200: 2·L met kanttekening", krap.veld === undefined && /2·L/.test(krap.notitie ?? ""), JSON.stringify(krap));
  // h = 6 m: (5.1) 0,005·√(5/6) = 1/219,09; φ = 1/219,09 dekt precies.
  const zes = zijdelingseKnikHoutInVlakModel({ ...set.stabiliteit, scheefstandPhi: 0.005 * Math.sqrt(5 / 6) }, true, 6, [1]);
  check("h = 6 m, φ = 0,005·√(5/6) = 1/219,09: L", zes.veld?.y === true);
}

log("\n[4] MCP (`check`, de sidecar): het modelveld `houtToetsEN1995`");
{
  const { verwerkVerzoek } = await import("./src/mcp/sidecar.ts");
  const model = (aan) => ({
    ...ui, plates: [], loadCases: [{ id: 1, name: "G", type: "dead" }],
    loads: [{ id: 1, type: "pointForce", nodeId: 2, fz: -100, caseId: 1 }],
    scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
    ...(aan === undefined ? {} : { houtToetsEN1995: aan }),
  });
  const v = verwerkVerzoek({ v: 1, id: 1, op: "validate", payload: { model: model(true) } });
  check("validate accepteert houtToetsEN1995", v.ok === true && v.result?.ok === true, JSON.stringify(v.result?.errors ?? v.error));
  const vraag = (aan) => verwerkVerzoek({ v: 1, id: 1, op: "check", payload: {
    model: model(aan), combinations: [{ id: 1, name: "G", type: "uls", formula: "G", factors: { 1: 1 } }],
  } });
  const a = vraag(true), z = vraag(undefined);
  check("check slaagt", a.ok === true && z.ok === true, a.error?.melding ?? z.error?.melding ?? "");
  const hi = (r) => r.result?.timber_check_inputs?.find((i) => i.beam_id === 1);
  check("met: zijdelingse_knik_in_analyse.y = true en de EN 1995-notitie",
    hi(a)?.zijdelingse_knik_in_analyse?.y === true && (hi(a)?.staaf_notities ?? []).some((n) => /VOLGENS NEN-EN 1995-1-1/.test(n)),
    JSON.stringify(hi(a)?.zijdelingse_knik_in_analyse));
  check("zonder (standaard): geen veld (2·L)", hi(z) !== undefined && hi(z).zijdelingse_knik_in_analyse === undefined);
  check("met: warnings noemen de route van EN 1995", (a.result?.warnings ?? []).some((w) => /Hout EN 1995/.test(w)));
}

log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);

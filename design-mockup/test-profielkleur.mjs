// "Profielen in kleur" (verkenner, tab Weergave; 2D en 3D), de pure kant:
//   - het vaste palet: acht kleuren, leesbaar op het lichte en het donkere
//     tekenvlak en op het witte 3D-vlak (≥ 3:1), geen oranje/amber (dat is de
//     accent- en selectiekleur), buren onderscheidbaar bij protanopie en
//     deuteranopie (Machado-Oliveira-Fernandes 2009, ernst 1,0) en bij normaal
//     zien, gemeten als ΔE in OKLab ×100;
//   - de toekenning (lib/profielKleur.ts): stabiel, uniek, onafhankelijk van
//     de staafvolgorde en de taal, numeriek gesorteerd, "IPE 200" = "IPE200",
//     materiaal alleen waar het onderscheidt, "zonder profiel" neutraal en
//     onderaan, en de uitbreiding voorbij acht profielen (2D lijnsoort, 3D tint);
//   - de voorrang in 3D (UC-kleuring gaat voor) en de weergavevlaggen en
//     teksten in vier talen;
//   - de aansluiting in de bron: 2D-tekenvlak, 3D-tekenvlak en 3D-legenda
//     lezen dezelfde toekenning.
// Het gedrag in de browser (legenda, gekleurde staven, selectie, thema)
// bewaakt test-profielkleur-ui.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const P = await import("./src/lib/profielKleur.ts");
const Z = await import("./src/lib/zichtbaarheid.ts");
const { DEFAULT_DISPLAY_FLAGS } = await import("./src/components/fem/FemResultsOverlay.tsx");
const { DEFAULT_OPEN_FEM_3D_VISIBILITY } = await import("./src/components/openFem3d/openFem3dVisibility.ts");
const { parseOpenFem3DViewSets } = await import("./src/components/openFem3d/openFem3dViewSets.ts");
const { makeInitialSnapshot } = await import("./src/hooks/useFemStore.ts");

let passed = 0, failed = 0;
function test(naam, fn) {
  try { fn(); passed++; console.log(`  ✓ ${naam}`); }
  catch (e) { failed++; console.log(`  ✗ ${naam}\n      ${e.message.split("\n").join("\n      ")}`); }
}
const bron = (pad) => readFileSync(new URL(pad, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const lees = (taal) => JSON.parse(readFileSync(new URL(`./src/i18n/locales/${taal}/common.json`, import.meta.url), "utf8"));
const pad = (o, p) => p.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);

// ── Kleurmeetkunde: WCAG-contrast en OKLab (ΔE ×100) ─────────────────────
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16) / 255).map(lin);
const lum = (h) => { const [r, g, b] = rgb(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
// Machado, Oliveira & Fernandes (2009), ernst 1,0, lineair RGB.
const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
};
const simuleer = (h, soort) => {
  const c = rgb(h);
  if (!soort) return c;
  return MACHADO[soort].map((rij) => Math.max(0, Math.min(1, rij[0] * c[0] + rij[1] * c[1] + rij[2] * c[2])));
};
const dE = (a, b, soort) => { const p = oklab(simuleer(a, soort)), q = oklab(simuleer(b, soort)); return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const tint = (h) => { const [, a, b] = oklab(rgb(h)); return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360; };
const chroma = (h) => { const [, a, b] = oklab(rgb(h)); return Math.hypot(a, b); };

const LICHT = "#FAFAF9", DONKER = "#27272A", WIT = "#FFFFFF";   // themes.css: light, openaec; 3D-vlak

console.log("[1] het palet");
test("acht geldige, verschillende kleuren; 3D drie rondes van acht, alle 24 verschillend", () => {
  assert.equal(P.PROFIEL_PALET.length, 8);
  for (const k of P.PROFIEL_PALET) assert.match(k, /^#[0-9a-f]{6}$/);
  assert.equal(new Set(P.PROFIEL_PALET).size, 8);
  assert.equal(P.PROFIEL_PALET_3D.length, 3);
  assert.deepEqual(P.PROFIEL_PALET_3D[0], P.PROFIEL_PALET);
  const alle = P.PROFIEL_PALET_3D.flat();
  for (const k of alle) assert.match(k, /^#[0-9a-f]{6}$/);
  assert.equal(new Set(alle).size, 24);
  assert.deepEqual(P.PROFIEL_STREPEN, ["", "10 7", "0.1 6"]);
});
test("leesbaar: ≥ 3:1 op het lichte en het donkere tekenvlak en op het witte 3D-vlak", () => {
  for (const k of [...P.PROFIEL_PALET, P.ZONDER_PROFIEL_KLEUR]) {
    for (const [naam, vlak] of [["licht", LICHT], ["donker", DONKER], ["wit", WIT]]) {
      assert.ok(contrast(k, vlak) >= 3, `${k} op ${naam}: ${contrast(k, vlak).toFixed(2)}`);
    }
  }
  // De donkere 3D-variant staat alleen op het witte 3D-vlak: daar ruim leesbaar.
  for (const k of P.PROFIEL_PALET_3D[1]) assert.ok(contrast(k, WIT) >= 4.5, `${k} op wit`);
});
test("geen oranje of amber in het palet: dat blijft de accent- en selectiekleur", () => {
  for (const k of P.PROFIEL_PALET) {
    const h = tint(k);
    assert.ok(h < 20 || h > 92, `${k}: tint ${h.toFixed(0)}° in de oranje band`);
  }
  // …en elke kleur ver genoeg van de accent- (#D97706) en selectiekleur (#EA580C).
  for (const k of P.PROFIEL_PALET) for (const acc of ["#d97706", "#ea580c"]) assert.ok(dE(k, acc) >= 12, `${k} ↔ ${acc}: ${dE(k, acc).toFixed(1)}`);
});
test("buren in de legenda onderscheidbaar: kleurenblind ΔE ≥ 8, normaal ΔE ≥ 15 (ook de overgang naar de tweede ronde)", () => {
  const p = P.PROFIEL_PALET;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const cvd = Math.min(dE(a, b, "protan"), dE(a, b, "deutan"));
    assert.ok(cvd >= 8, `${a} ↔ ${b}: kleurenblind ΔE ${cvd.toFixed(1)}`);
    assert.ok(dE(a, b) >= 15, `${a} ↔ ${b}: normaal ΔE ${dE(a, b).toFixed(1)}`);
  }
  // En geen twee kleuren in het hele palet die op elkaar lijken (normaal zien).
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) assert.ok(dE(p[i], p[j]) >= 10, `${p[i]} ↔ ${p[j]}: ${dE(p[i], p[j]).toFixed(1)}`);
});
test("zonder profiel: neutraal grijs, geen tint", () => {
  assert.ok(chroma(P.ZONDER_PROFIEL_KLEUR) < 0.01);
  assert.ok(!P.PROFIEL_PALET.includes(P.ZONDER_PROFIEL_KLEUR));
});

console.log("\n[2] de toekenning");
const model = makeInitialSnapshot();
// Een vertaalfunctie zonder woordenboek: een vertaalbare naam wordt zijn sleutel.
const tKaal = (sleutel) => sleutel;
const k2d = (beams) => P.profielKleuring2d(beams, tKaal);
const kern = (k) => k.regels.map((r) => ({ sleutel: r.sleutel, naam: r.naam, kleur: r.kleur, streep: r.streep, kleur3d: r.kleur3d, staven: r.staven }));
test("startmodel: 160x400 (2), 300x600 (1), IPE270 (2), IPE330 (1) — numeriek gesorteerd, de eerste vier paletkleuren", () => {
  const k = k2d(model.beams);
  assert.deepEqual(k.regels.map((r) => [r.naam, r.aantal, r.kleur]), [
    ["160x400", 2, P.PROFIEL_PALET[0]], ["300x600", 1, P.PROFIEL_PALET[1]],
    ["IPE270", 2, P.PROFIEL_PALET[2]], ["IPE330", 1, P.PROFIEL_PALET[3]],
  ]);
  assert.deepEqual(k.regels.map((r) => r.staven), [[4, 5], [6], [1, 2], [3]]);
  for (const b of model.beams) assert.equal(k.perStaaf.get(b.id).staven.includes(b.id), true);
  assert.equal(k.perStaaf.size, model.beams.length);
});
test("stabiel en onafhankelijk van de staafvolgorde (tien permutaties)", () => {
  const basis = kern(k2d(model.beams));
  let zaad = 7;
  const rnd = () => { zaad = (zaad * 16807) % 2147483647; return zaad / 2147483647; };
  for (let n = 0; n < 10; n++) {
    const geschud = [...model.beams].sort(() => rnd() - 0.5);
    assert.deepEqual(kern(k2d(geschud)), basis, `permutatie ${n}`);
  }
  assert.deepEqual(kern(k2d(model.beams)), basis, "tweede aanroep");
});
test("numerieke sortering: HEA 100 < HEA 200 < IPE 80 < IPE 200 < IPE 600", () => {
  const namen = ["IPE 600", "IPE 80", "HEA 200", "IPE 200", "HEA 100"];
  const k = P.profielKleuring(namen.map((profiel, i) => ({ id: i + 1, profiel })));
  assert.deepEqual(k.regels.map((r) => r.naam), ["HEA 100", "HEA 200", "IPE 80", "IPE 200", "IPE 600"]);
});
test("\"IPE 200\", \"IPE200\" en \" ipe  200 \" zijn één profiel, met een vaste schrijfwijze", () => {
  const varianten = [["IPE200", " ipe  200 ", "IPE 200"], ["IPE 200", "IPE200", " ipe  200 "], [" ipe  200 ", "IPE 200", "IPE200"]];
  for (const v of varianten) {
    const k = P.profielKleuring(v.map((profiel, i) => ({ id: i + 1, profiel })));
    assert.equal(k.regels.length, 1);
    assert.equal(k.regels[0].naam, "IPE 200");
    assert.equal(k.regels[0].aantal, 3);
  }
});
test("zelfde naam in verschillende materialen: per materiaal een regel; één materiaal: geen toevoeging", () => {
  const k = P.profielKleuring([
    { id: 1, profiel: "200x600", materiaal: "GL24h" }, { id: 2, profiel: "200x600", materiaal: "C24" },
    { id: 3, profiel: "IPE200", materiaal: "S235" }, { id: 4, profiel: "IPE200", materiaal: "S235" },
    { id: 5, profiel: "200x600", materiaal: "GL24h" },
  ]);
  assert.deepEqual(k.regels.map((r) => [r.naam, r.materiaal, r.staven]), [
    ["200x600 · C24", "C24", [2]], ["200x600 · GL24h", "GL24h", [1, 5]], ["IPE200", null, [3, 4]],
  ]);
  assert.equal(new Set(k.regels.map((r) => r.kleur)).size, 3);
});
test("zonder profiel: neutraal, onderaan, en neemt geen paletkleur in", () => {
  const k = P.profielKleuring([{ id: 1, profiel: null }, { id: 2, profiel: "HEA200" }, { id: 3, profiel: "  " }, { id: 4 }]);
  assert.deepEqual(k.regels.map((r) => [r.zonderProfiel, r.kleur, r.staven]), [
    [false, P.PROFIEL_PALET[0], [2]], [true, P.ZONDER_PROFIEL_KLEUR, [1, 3, 4]],
  ]);
  assert.equal(k.regels[1].kleur3d, P.ZONDER_PROFIEL_KLEUR);
  assert.equal(k.regels[1].streep, "");
  assert.deepEqual(P.profielKleuring([]).regels, []);
});
test("uniek: tot 24 profielen elk een eigen (kleur, lijnsoort) in 2D en een eigen kleur in 3D", () => {
  const profielen = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, profiel: `HEA ${100 + 20 * i}` }));
  const k = P.profielKleuring(profielen);
  assert.equal(k.regels.length, 30);
  const eerste24 = k.regels.slice(0, 24);
  assert.equal(new Set(eerste24.map((r) => `${r.kleur}|${r.streep}`)).size, 24);
  assert.equal(new Set(eerste24.map((r) => r.kleur3d)).size, 24);
  // De uitbreiding: tweede ronde gestreept en donker, derde gestippeld en licht.
  assert.deepEqual([k.regels[8].slot, k.regels[8].ronde, k.regels[8].kleur, k.regels[8].streep, k.regels[8].kleur3d],
    [0, 1, P.PROFIEL_PALET[0], "10 7", P.PROFIEL_PALET_3D[1][0]]);
  assert.deepEqual([k.regels[17].slot, k.regels[17].ronde, k.regels[17].streep, k.regels[17].kleur3d],
    [1, 2, "0.1 6", P.PROFIEL_PALET_3D[2][1]]);
  // Boven de 24 herhaalt het patroon zich (gedocumenteerd).
  assert.deepEqual([k.regels[24].kleur, k.regels[24].streep, k.regels[24].kleur3d], [P.PROFIEL_PALET[0], "", P.PROFIEL_PALET[0]]);
});
test("taalonafhankelijk: de vertaalde weergave verandert naam, niet sleutel of kleur", () => {
  const nl = P.profielKleuring([{ id: 1, profiel: "IPE 300 → IPE 200 (verlopend)" }, { id: 2, profiel: "IPE 300" }]);
  const en = P.profielKleuring([
    { id: 1, profiel: "IPE 300 → IPE 200 (verlopend)", weergave: "IPE 300 → IPE 200 (tapered)" },
    { id: 2, profiel: "IPE 300" },
  ]);
  assert.deepEqual(nl.regels.map((r) => [r.sleutel, r.kleur]), en.regels.map((r) => [r.sleutel, r.kleur]));
  assert.equal(en.perStaaf.get(1).naam, "IPE 300 → IPE 200 (tapered)");
  assert.notEqual(nl.perStaaf.get(1).kleur, nl.perStaaf.get(2).kleur, "verlopend is een eigen profiel");
});
test("2D: verlopende staaf is een eigen profiel; sleutel uit de Nederlandse naam, legenda vertaald; zonder materiaal S235", () => {
  const beams = [
    { id: 1, material: "S235", profile: "IPE 300", profileEnd: "IPE 200" },
    { id: 2, material: "S235", profile: "IPE 300" },
    { id: 3, profile: "IPE 300" },
  ];
  const k = P.profielKleuring2d(beams, (sleutel, w) => (sleutel === "common:profileName.tapered" ? `${w.begin} → ${w.eind} (tapered)` : sleutel));
  assert.deepEqual(k.regels.map((r) => [r.naam, r.staven]), [["IPE 300", [2, 3]], ["IPE 300 → IPE 200 (tapered)", [1]]]);
  assert.equal(k.regels[1].sleutel, "IPE300 → IPE200 (VERLOPEND)", "sleutel uit de Nederlandse naam");
});
test("een profiel erbij schuift alleen de profielen die erna sorteren", () => {
  const voor = P.profielKleuring([{ id: 1, profiel: "HEA 200" }, { id: 2, profiel: "IPE 300" }]);
  const na = P.profielKleuring([{ id: 1, profiel: "HEA 200" }, { id: 2, profiel: "IPE 300" }, { id: 3, profiel: "HEB 200" }]);
  assert.equal(na.perStaaf.get(1).kleur, voor.perStaaf.get(1).kleur, "HEA 200 houdt zijn kleur");
  assert.equal(na.perStaaf.get(3).kleur, P.PROFIEL_PALET[1]);
  assert.equal(na.perStaaf.get(2).kleur, P.PROFIEL_PALET[2]);
});

console.log("\n[3] 3D: voorrang en invoer");
test("de UC-kleuring gaat voor zolang die in beeld is; anders de profielkleur", () => {
  assert.equal(P.profielKleurenActief3d({ profileColors: true, utilization: true }, 0), true, "geen toetsuitkomsten");
  assert.equal(P.profielKleurenActief3d({ profileColors: true, utilization: true }, 3), false, "UC in beeld");
  assert.equal(P.profielKleurenActief3d({ profileColors: true, utilization: false }, 3), true, "UC-laag uit");
  assert.equal(P.profielKleurenActief3d({ profileColors: false, utilization: false }, 0), false, "optie uit");
  assert.equal(P.profielKleurenActief3d(DEFAULT_OPEN_FEM_3D_VISIBILITY, 0), false, "standaard uit");
});
test("3D-staven: profileName en material, kleur als getal voor Three.js", () => {
  const k = P.openFem3DProfielKleuring([
    { id: 7, profileName: "IPE 200", material: "S235" }, { id: 8, profileName: "IPE200", material: "S355" }, { id: 9 },
  ]);
  assert.deepEqual(k.regels.map((r) => r.naam), ["IPE 200 · S235", "IPE 200 · S355", ""]);
  assert.equal(P.kleurGetal("#508ff9"), 0x508ff9);
  assert.equal(P.kleurGetal(k.perStaaf.get(7).kleur3d), parseInt(P.PROFIEL_PALET[0].slice(1), 16));
});

console.log("\n[4] weergavevlaggen");
test("2D: vlag profielKleur, standaard uit, in Geometrie direct onder de staven, onthouden per gebruiker", () => {
  assert.equal(DEFAULT_DISPLAY_FLAGS.profielKleur, false);
  const geo = Z.ZICHTBAARHEID.geometrie.map((r) => r.sleutel);
  assert.equal(geo.indexOf("profielKleur"), geo.indexOf("staven") + 1);
  assert.ok(Z.WEERGAVE_VOORKEUREN.includes("profielKleur"));
  const terug = Z.metVoorkeuren(DEFAULT_DISPLAY_FLAGS, JSON.parse(JSON.stringify(Z.voorkeurenVan({ ...DEFAULT_DISPLAY_FLAGS, profielKleur: true }))));
  assert.equal(terug.profielKleur, true);
});
test("3D: profileColors, standaard uit, direct na profiles; ook in het venster en in opgeslagen weergaven", () => {
  assert.equal(DEFAULT_OPEN_FEM_3D_VISIBILITY.profileColors, false);
  const sleutels = Object.keys(DEFAULT_OPEN_FEM_3D_VISIBILITY);
  assert.equal(sleutels.indexOf("profileColors"), sleutels.indexOf("profiles") + 1, "verkenner toont de rijen in deze volgorde");
  assert.match(bron("./src/components/openFem3d/OpenFem3DVisibilityDialog.tsx"), /"profiles", "profileColors"/);
  const camera = { position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1] };
  const [v] = parseOpenFem3DViewSets([{ id: "view-1", name: "Kleur", view: "iso", camera, visibility: { profileColors: true }, combinationId: null }]);
  assert.equal(v.visibility.profileColors, true);
  const [oud] = parseOpenFem3DViewSets([{ id: "view-1", name: "Oud", view: "iso", camera, visibility: { beams: true }, combinationId: null }]);
  assert.equal(oud.visibility.profileColors, false, "een oudere weergave zonder het veld: uit");
});

console.log("\n[5] teksten in vier talen");
test("label, toelichting, 3D-label en legenda in nl, en, de en fr", () => {
  const sleutels = ["zichtbaarheid.profielKleur", "zichtbaarheid.profielKleurHint", "openFem3dVisibility.profileColors",
    "canvas.profielKleur.titel", "canvas.profielKleur.aria", "canvas.profielKleur.zonderProfiel", "tree.barCount_one", "tree.barCount_other"];
  const teksten = {};
  for (const taal of ["nl", "en", "de", "fr"]) {
    const c = lees(taal);
    for (const k of sleutels) assert.equal(typeof pad(c, k), "string", `${taal}: ${k}`);
    teksten[taal] = pad(c, "zichtbaarheid.profielKleur");
  }
  assert.equal(new Set(Object.values(teksten)).size, 4, "vier eigen vertalingen");
});

console.log("\n[6] aansluiting in de bron");
test("2D-tekenvlak: dezelfde toekenning voor staaflijn en legenda; selectie en snap gaan voor in de CSS", () => {
  const canvas = bron("./src/components/fem/FemCanvas.tsx");
  assert.match(canvas, /profielKleuring2d\(beams, tCommon\)/);
  assert.match(canvas, /perStaaf\.get\(b\.id\)/);
  assert.match(canvas, /<ProfielKleurLegenda regels=\{profielKleuren\.regels\} variant="2d"/);
  const css = bron("./src/components/fem/FemCanvas.css");
  assert.match(css, /\.fem-member\.profielkleur \{ stroke: var\(--fem-profielkleur\); \}/);
  assert.match(css, /\.fem-member\.profielkleur\.selected \{ stroke: var\(--theme-accent-hover\); \}/);
  assert.match(css, /\.fem-member\.profielkleur:not\(\.systeemlijn\) \{ stroke-dasharray/);
});
test("3D-tekenvlak: elke staafkleur via staafKleur (UC, dan profiel, dan standaard); nieuwe profielen → volledige opbouw", () => {
  const drie = bron("./src/components/openFem3d/ThreeFrameCanvas.tsx");
  assert.equal((drie.match(/OPEN_FEM_3D_UTILIZATION_COLORS\[utilizationClass\] : 0x2563eb/g) ?? []).length, 0, "nog een losse staafkleur");
  assert.ok((drie.match(/staafKleur\(beam\.id/g) ?? []).length >= 5, "alle vijf de plekken die een staaf kleuren");
  assert.equal((drie.match(/&& profielKleurenStabiel/g) ?? []).length, 3, "toevoegen (twee paden) en verwijderen");
  assert.match(drie, /profielKleurenActief3d\(visibility, utilizations\.length\)/);
  const editor = bron("./src/components/openFem3d/OpenFem3DEditor.tsx");
  assert.match(editor, /profielKleurenActief3d\(canvasVisibility, utilizations\.length\)/);
  assert.match(editor, /<ProfielKleurLegenda regels=\{profielKleuren\.regels\} variant="3d"/);
});

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

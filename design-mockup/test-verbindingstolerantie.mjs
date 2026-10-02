// Verbindingstolerantie van het 2D-model (issue #55).
//
// WAT ER WAS
//  Eén vaste tekentolerantie van 1 mm (`CONTROLE_TOL_MM`) besliste of een
//  knoop "op een staaf" of "op dezelfde plek als een andere knoop" lag. Een
//  kolomvoet die 3 mm naast een ligger was getekend, gold dus als los: geen
//  bevinding, geen aansluiting bij het plaatsen, en de solver kwam pas later
//  met een singuliere matrix.
//
// WAT DEZE TEST VASTLEGT
//  [1] Standaard 5 mm, grenzen 0,1–25 mm, invoer met komma of punt; "op
//      dezelfde plek" is een afstand (euclidisch), niet een maat per as.
//  [2] knoopOpStaaf bij 1, 5 en 10 mm: een knoop op 3 mm van de staafas is
//      bij 1 mm geen bevinding en bij 5 en 10 mm wel; op 7 mm alleen bij 10.
//  [3] Bij een staafEINDE wordt niet geknipt: binnen de tolerantie van een
//      eindknoop is het een samenvoeg-geval (dubbeleKnoop), geen splitsing.
//  [4] Schuine staaf: per knoop hooguit één bevinding, en geen stil gat
//      tussen "op de staaf" en "op dezelfde plek als het einde".
//  [5] Plaatsen op 4 mm van een staaf sluit aan bij 5 mm en niet bij 1 mm. Een
//      NIEUWE knoop op één staaf komt op de staafas (de staaf blijft recht);
//      een hergebruikte knoop of een kruising splitst op de plek zelf, en de
//      uitkomst noemt de afwijking (de knik). Hergebruik volgt de tolerantie
//      en kiest de DICHTSTBIJZIJNDE knoop.
//  [6] Het wijzigen van de tolerantie verandert geen geometrie; alleen de
//      controle en de volgende plaatsing of het herstel gebruiken de waarde.
//  [7] De plaatrandregels volgen de instelling NIET: de engine koppelt een
//      staafeinde alleen binnen 1 mm aan een plaatrand.
//  [8] De rekenpoort volgt de tolerantie die hij krijgt (standaard 5 mm).
//  [9] Terugkoppeling: welke staaf op welke knoop is gesplitst, in vier talen.
//  [10] De instelling wordt bewaard met de snapinstellingen.
//  [11] Het tekenvlak, de store-aanroepen en de rekenpoort in App.tsx krijgen
//       de instelling mee (bronscan).
//  [12] Samenvoegen houdt een plaathoek (daarna een oplegging) op zijn plek,
//       ongeacht de tekenvolgorde; één oorzaak, één fout.
//  [13] De tekst bij knopen binnen de tolerantie noemt de echte afstand of
//       staaflengte en de tolerantie, niet "lengte nul".
//  [14] Bij de bovengrens (25 mm) zijn naburige rasterpunten (50 mm) geen
//       dezelfde plek en een evenwijdige staaf één rasterstap verderop niet
//       "op de staaf".
//  [15] Subknoop: op het voetpunt op de staafas, en niet binnen de tolerantie
//       van een staafeinde.
//
// Uitvoeren: npx tsx test-verbindingstolerantie.mjs   (vanuit design-mockup/)

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));

const mc = await import("./src/lib/modelControle.ts");
const {
  CONTROLE_TOL_MM, PLAATRAND_TOL_MM, VERBINDINGSTOLERANTIE_MIN_MM, VERBINDINGSTOLERANTIE_MAX_MM,
  begrensVerbindingstolerantie, leesVerbindingstolerantie, opZelfdePlek,
  controleerModel, zoekKnopenOpStaaf, zoekDubbeleKnopen, puntOpStaaf, heeftFouten, tussenpuntOpStaaf,
} = mc;
const {
  computeKnoopMetSplitsing, computeModelHerstel, computeBeamSplitOpKnoop, computeBeamSplit,
  splitsingRegel, samenvoegRegel,
} = await import("./src/hooks/useFemStore.ts");
const { isAsgelijndeRechthoek } = await import("./src/components/fem/femTypes.ts");
const { controleerVoorRekenen } = await import("./src/lib/rekenPoort.ts");
const { vertaal } = await import("./src/lib/vertaalbareTekst.ts");
const { zetTaal, default: i18next } = await import("./scripts/i18n-voor-tests.mjs");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function check(naam, voorwaarde, detail = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}`); }
  else            { failed++; log(`  ✗ ${naam}${detail ? ` — ${detail}` : ""}`); }
}
const json = (x) => JSON.stringify(x);
const soorten = (bev) => bev.map((b) => `${b.soort}:${b.nodeIds.join("+")}${b.beamId !== undefined ? "@" + b.beamId : ""}`);

/**
 * Ligger 1→2 van (0, 0) tot (4000, 0), opgelegd; kolom 3→4 met de voet op
 * (2000, dz) en de kop op (2000, 3000), kop horizontaal gesteund.
 */
function kolomOpLigger(dz) {
  return {
    nodes: [
      { id: 1, x: 0, z: 0 }, { id: 2, x: 4000, z: 0 },
      { id: 3, x: 2000, z: dz }, { id: 4, x: 2000, z: 3000 },
    ],
    beams: [
      { id: 1, from: 1, to: 2, material: "S235", profile: "HEA 200" },
      { id: 2, from: 3, to: 4, material: "S235", profile: "HEA 200" },
    ],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }, { nodeId: 4, type: "xRoller" }],
    plates: [],
    loads: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[1] Standaard, grenzen en invoer");
check("standaard 5 mm (CONTROLE_TOL_MM)", CONTROLE_TOL_MM === 5, String(CONTROLE_TOL_MM));
// Bovengrens 25 mm: de helft van de kleinste rasterstap (50 mm). Eerst was
// het 50; dan werden twee naburige rasterpunten "dezelfde plek" (zie [14]).
check("grenzen 0,1 en 25 mm", VERBINDINGSTOLERANTIE_MIN_MM === 0.1 && VERBINDINGSTOLERANTIE_MAX_MM === 25);
check("begrenzen: 0,05 → 0,1; 99 → 25; 7 blijft 7",
  begrensVerbindingstolerantie(0.05) === 0.1 && begrensVerbindingstolerantie(99) === 25
  && begrensVerbindingstolerantie(7) === 7);
check("begrenzen: geen getal → de standaard", begrensVerbindingstolerantie(NaN) === 5
  && begrensVerbindingstolerantie(Infinity) === 5);
check("komma en punt: '2,5' en '2.5' zijn 2,5",
  leesVerbindingstolerantie("2,5") === 2.5 && leesVerbindingstolerantie("2.5") === 2.5);
check("met eenheid en spaties: ' 3 mm ' is 3", leesVerbindingstolerantie(" 3 mm ") === 3);
check("buiten de grenzen wordt begrensd", leesVerbindingstolerantie("0,01") === 0.1 && leesVerbindingstolerantie("80") === 25
  && leesVerbindingstolerantie("50") === 25 && leesVerbindingstolerantie("25") === 25);
check("geen getal, leeg, nul of negatief: null",
  ["abc", "", "0", "-2", "1,2,3", "mm"].every((t) => leesVerbindingstolerantie(t) === null));
check("de plaatrand houdt 1 mm (PLAATRAND_TOL_MM, gelijk aan de engine)", PLAATRAND_TOL_MM === 1);
check("opZelfdePlek: de afstand (euclidisch), grens inbegrepen: (3; 4) is 5 mm",
  opZelfdePlek({ x: 0, z: 0 }, { x: 3, z: -4 }, 5) && !opZelfdePlek({ x: 0, z: 0 }, { x: 5.01, z: 0 }, 5));
check("opZelfdePlek: schuin (4,2; 4,2) is 5,9 mm, dus NIET dezelfde plek bij 5 mm (per as was het wel)",
  !opZelfdePlek({ x: 0, z: 0 }, { x: 4.2, z: 4.2 }, 5) && !opZelfdePlek({ x: 0, z: 0 }, { x: 5, z: -5 }, 5));

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] Knoop op 3 mm van een staaf: bij 1 mm niets, bij 5 en 10 mm een bevinding");
{
  const m3 = kolomOpLigger(3);
  const bij = (tol) => zoekKnopenOpStaaf(m3, tol);
  check("1 mm: geen bevinding", bij(1).length === 0, json(soorten(bij(1))));
  for (const tol of [5, 10]) {
    const b = bij(tol);
    check(`${tol} mm: knoop 3 ligt op staaf 1, met een verbind-actie`,
      b.length === 1 && b[0].nodeIds[0] === 3 && b[0].beamId === 1
      && b[0].herstel?.soort === "verbind" && b[0].ernst === "fout", json(soorten(b)));
  }
  check("controleerModel volgt de tolerantie: fout bij 5 mm, geen fout bij 1 mm",
    heeftFouten(controleerModel(m3, 5)) && !heeftFouten(controleerModel(m3, 1)),
    json([soorten(controleerModel(m3, 5)), soorten(controleerModel(m3, 1))]));
  check("zonder tolerantie: de standaard (5 mm)", heeftFouten(controleerModel(m3)));
  const m7 = kolomOpLigger(7);
  check("7 mm: alleen bij 10 mm een bevinding",
    zoekKnopenOpStaaf(m7, 1).length === 0 && zoekKnopenOpStaaf(m7, 5).length === 0
    && zoekKnopenOpStaaf(m7, 10).length === 1);
  check("puntOpStaaf: 3 mm telt bij 5, niet bij 1",
    puntOpStaaf(m3.nodes, m3.beams[0], 2000, 3, 5) !== null && puntOpStaaf(m3.nodes, m3.beams[0], 2000, 3, 1) === null);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] Bij een staafeinde: samenvoegen, niet knippen");
{
  // Kolom 3→4 met de voet 3 mm vóór het einde van de ligger (knoop 2 op 4000).
  const eind = (voet) => ({
    nodes: [
      { id: 1, x: 0, z: 0 }, { id: 2, x: 4000, z: 0 },
      { id: 3, ...voet }, { id: 4, x: voet.x, z: 3000 },
    ],
    beams: [{ id: 1, from: 1, to: 2 }, { id: 2, from: 3, to: 4 }],
    supports: [{ nodeId: 1 }, { nodeId: 2 }, { nodeId: 4 }],
    plates: [],
  });
  const opAs = eind({ x: 3997, z: 0 });
  for (const tol of [5, 10]) {
    const bev = controleerModel(opAs, tol).filter((b) => b.ernst === "fout");
    check(`${tol} mm, 3 mm vóór het einde op de as: één samenvoeg-geval (2 en 3), geen splitsing`,
      bev.length === 1 && bev[0].soort === "dubbeleKnoop"
      && bev[0].herstel?.soort === "voegSamen" && bev[0].herstel.bewaarId === 2 && bev[0].herstel.verwijderId === 3,
      json(soorten(bev)));
  }
  const bev1 = controleerModel(opAs, 1).filter((b) => b.ernst === "fout");
  check("1 mm: 3 mm vóór het einde ligt wél op de staaf (verder dan 1 mm van het einde)",
    bev1.length === 1 && bev1[0].soort === "knoopOpStaaf" && bev1[0].nodeIds[0] === 3, json(soorten(bev1)));
  const naast = eind({ x: 3998, z: 3 });
  const bevNaast = controleerModel(naast, 5).filter((b) => b.ernst === "fout");
  check("5 mm, 2 mm vóór en 3 mm naast het einde: samenvoegen, geen splitsing",
    bevNaast.length === 1 && bevNaast[0].soort === "dubbeleKnoop", json(soorten(bevNaast)));
  const voorbij = eind({ x: 4003, z: 0 });
  const bevVoorbij = controleerModel(voorbij, 5).filter((b) => b.ernst === "fout");
  check("5 mm, 3 mm voorbij het einde: samenvoegen", bevVoorbij.length === 1 && bevVoorbij[0].soort === "dubbeleKnoop",
    json(soorten(bevVoorbij)));

  // Het herstel bij 5 mm voegt samen; de ligger blijft één staaf.
  const h = computeModelHerstel({ ...opAs, loads: [] }, 5);
  check("herstel bij 5 mm: knoop 3 samengevoegd met knoop 2, geen staaf gesplitst",
    h !== null && h.stappen.length === 1 && /Knoop 3 samengevoegd met knoop 2/.test(h.stappen[0])
    && h.beams.length === 2 && h.nodes.every((n) => n.id !== 3), json(h?.stappen));
  check("…en daarna is het model schoon bij 5 mm", h !== null && !heeftFouten(controleerModel(h, 5)));
  // Plaatsen binnen de tolerantie van het einde hergebruikt de eindknoop.
  const p = computeKnoopMetSplitsing({ nodes: opAs.nodes.slice(0, 2), beams: [opAs.beams[0]], loads: [] }, 3996, 2, 5);
  check("plaatsen 4 mm vóór en 2 mm naast het einde: de eindknoop wordt hergebruikt, niets gesplitst",
    p.nodeId === 2 && p.gesplitsteStaven.length === 0 && p.nodes.length === 2, json(p));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] Schuine staaf: hooguit één bevinding per knoop, geen stil gat");
{
  // Staaf 1→2 onder 30°, 4000 mm lang. Een raster van punten rond de
  // beginknoop, alle binnen 4,5 mm van de staafas (een halve millimeter van
  // de grens, zodat afronding in de laatste decimaal niet meetelt).
  const L = 4000, hoek = Math.PI / 6;
  const ux = Math.cos(hoek), uz = Math.sin(hoek), nx = -uz, nz = ux;
  let meerdere = [], stil = [];
  for (let langs = -6; langs <= 12; langs += 0.5) {
    for (let dwars = -4.5; dwars <= 4.5; dwars += 0.5) {
      const x = langs * ux + dwars * nx, z = langs * uz + dwars * nz;
      const model = {
        nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: L * ux, z: L * uz }, { id: 3, x, z }],
        beams: [{ id: 1, from: 1, to: 2 }], plates: [],
      };
      const bev = [...zoekKnopenOpStaaf(model, 5), ...zoekDubbeleKnopen(model, 5)]
        .filter((b) => b.nodeIds.includes(3));
      if (bev.length > 1) meerdere.push([langs, dwars]);
      // Binnen de staaf (langs > 0) en binnen 5 mm van de as: altijd een bevinding.
      if (langs > 0 && bev.length === 0) stil.push([langs, dwars]);
    }
  }
  check("nergens twee bevindingen (splitsen én samenvoegen) voor één knoop", meerdere.length === 0,
    json(meerdere.slice(0, 5)));
  check("nergens een stil gat: binnen 5 mm van de as is een knoop op de staaf óf op het einde", stil.length === 0,
    json(stil.slice(0, 5)));
  // Een punt op de as, 5,5 mm van het begin (4,8 en 2,8 mm per as). "Op
  // dezelfde plek" is een AFSTAND (euclidisch): 5,5 mm > 5 mm, dus op de
  // staaf (knippen geeft een deel van 5,5 mm, geen nieuwe samenvoeg-fout). Per
  // as gold het als dezelfde plek als het begin. Op 4,5 mm: samenvoegen.
  const opAs = (d) => ({
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: L * ux, z: L * uz }, { id: 3, x: d * ux, z: d * uz }],
    beams: [{ id: 1, from: 1, to: 2 }], plates: [],
  });
  const b55 = controleerModel(opAs(5.5), 5).filter((b) => b.ernst === "fout");
  check("op de as 5,5 mm van het begin (4,8 en 2,8 mm per as): op de staaf, één bevinding",
    b55.length === 1 && b55[0].soort === "knoopOpStaaf" && b55[0].beamId === 1, json(soorten(b55)));
  const h55 = computeModelHerstel({ ...opAs(5.5), supports: [], loads: [] }, 5);
  check("…het herstel splitst, en geeft daarna geen samenvoeg-fout (deel van 5,5 mm)",
    h55 !== null && h55.beams.length === 2 && !controleerModel(h55, 5).some((b) => b.soort === "dubbeleKnoop"),
    json(h55?.stappen));
  const b45 = controleerModel(opAs(4.5), 5).filter((b) => b.ernst === "fout");
  check("op de as 4,5 mm van het begin: samenvoegen, niet knippen",
    b45.length === 1 && b45[0].soort === "dubbeleKnoop", json(soorten(b45)));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[5] Plaatsen op 4 mm van een staaf");
{
  const ligger = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 4000, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, material: "S235", profile: "HEA 200" }],
    loads: [{ id: 1, type: "lineLoad", caseId: 1, beamId: 1, q: -5 }],
  };
  const bij5 = computeKnoopMetSplitsing(ligger, 1500, 4, 5);
  check("5 mm: de staaf wordt op de nieuwe knoop gesplitst", bij5.gesplitsteStaven.length === 1
    && bij5.gesplitsteStaven[0] === 1 && bij5.beams.length === 2
    && bij5.beams.every((b) => b.from === bij5.nodeId || b.to === bij5.nodeId), json(bij5.beams));
  // De NIEUWE knoop komt op de staafas (1500, 0), niet op (1500, 4): anders
  // knikt de ligger 4 mm (bij 25 mm tot 24 mm). Bestaande knopen blijven staan.
  check("5 mm: de nieuwe knoop op de staafas (1500, 0); bestaande knopen niet verschoven",
    json(bij5.nodes.find((n) => n.id === bij5.nodeId)) === json({ id: 3, x: 1500, z: 0 })
    && bij5.nodes.filter((n) => n.id !== bij5.nodeId).every((n, i) => n.x === ligger.nodes[i].x && n.z === ligger.nodes[i].z),
    json(bij5.nodes));
  check("5 mm: de splitsing staat in de uitkomst (staaf, knoop, delen, geen knik)",
    json(bij5.splitsingen) === json([{ staafId: 1, knoopId: 3, delen: [2, 3], afwijkingMm: 0 }]), json(bij5.splitsingen));
  check("5 mm: de lijnlast gaat mee naar beide delen",
    bij5.loads.length === 2 && bij5.loads.every((l) => l.q === -5));
  const bij1 = computeKnoopMetSplitsing(ligger, 1500, 4, 1);
  check("1 mm: een losse knoop, de staaf blijft heel",
    bij1.gesplitsteStaven.length === 0 && bij1.beams.length === 1 && bij1.nodes.length === 3
    && json(bij1.splitsingen) === "[]");
  check("zonder tolerantie: de standaard (5 mm) sluit aan", computeKnoopMetSplitsing(ligger, 1500, 4).gesplitsteStaven.length === 1);
  // Bij de bovengrens: 24 mm naast de as wordt nog steeds een rechte splitsing.
  const bij25 = computeKnoopMetSplitsing(ligger, 1500, 24, 25);
  check("25 mm: 24 mm naast de as komt de knoop op de as; beide delen liggen op z = 0",
    json(bij25.nodes.find((n) => n.id === bij25.nodeId)) === json({ id: 3, x: 1500, z: 0 })
    && bij25.splitsingen.length === 1 && bij25.splitsingen[0].afwijkingMm === 0, json([bij25.nodes, bij25.splitsingen]));

  // Een HERGEBRUIKTE knoop splitst op zijn eigen plek: knoop 3 lag al 3 mm
  // naast de ligger. De uitkomst noemt de knik, de melding ook.
  const metLos = { ...ligger, nodes: [...ligger.nodes, { id: 3, x: 1500, z: 3 }] };
  const herg = computeKnoopMetSplitsing(metLos, 1500, 4, 5);
  check("hergebruikte knoop 3 (1500; 3): niet verschoven, de ligger op hem gesplitst, knik 3 mm",
    herg.nodeId === 3 && json(herg.nodes) === json(metLos.nodes)
    && herg.splitsingen.length === 1 && Math.abs(herg.splitsingen[0].afwijkingMm - 3) < 1e-9, json(herg.splitsingen));
  check("…en de melding noemt de knik",
    splitsingRegel(herg.splitsingen[0]).tekst
      === "Knoop 3 verbonden met staaf 1: die is gesplitst in staaf 2 en staaf 3. De knoop lag 3 mm naast de staafas; daar zit nu een knik.",
    splitsingRegel(herg.splitsingen[0]).tekst);
  // Op een KRUISING van twee staven: geen projectie (op welke as?), splitsen
  // op de plek zelf; per staaf de afwijking.
  const kruis = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 4000, z: 0 }, { id: 3, x: 2000, z: -2000 }, { id: 4, x: 2000, z: 2000 }],
    beams: [{ id: 1, from: 1, to: 2 }, { id: 2, from: 3, to: 4 }], loads: [],
  };
  const kr = computeKnoopMetSplitsing(kruis, 2003, 2, 5);
  check("kruising: één nieuwe knoop op (2003; 2), beide staven gesplitst, knik 2 en 3 mm",
    json(kr.nodes.find((n) => n.id === kr.nodeId)) === json({ id: 5, x: 2003, z: 2 })
    && json(kr.splitsingen.map((x) => [x.staafId, Math.round(x.afwijkingMm * 1e6) / 1e6])) === json([[1, 2], [2, 3]]),
    json(kr.splitsingen));

  // Hergebruik volgt de tolerantie (niet de standaard): één knoop op (0, 0).
  const een = { nodes: [{ id: 1, x: 0, z: 0 }], beams: [], loads: [] };
  const plaats = (x, tol) => computeKnoopMetSplitsing(een, x, 0, tol);
  check("plaatsen op 3 mm van knoop 1: bij 1 mm een nieuwe knoop, bij 5 mm knoop 1",
    plaats(3, 1).nodeId === 2 && plaats(3, 1).nodes.length === 2 && plaats(3, 5).nodeId === 1 && !plaats(3, 5).gewijzigd);
  check("plaatsen op 7 mm van knoop 1: bij 10 mm knoop 1, bij 5 mm een nieuwe knoop",
    plaats(7, 10).nodeId === 1 && plaats(7, 5).nodeId === 2);
  // De DICHTSTBIJZIJNDE knoop, niet de eerste in de lijst.
  const twee = { nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 15, z: 0 }], beams: [], loads: [] };
  const omgekeerd = { ...twee, nodes: [...twee.nodes].reverse() };
  check("10 mm, knopen op 0 en 15 mm, plaatsen op 9 mm: knoop 2 (6 mm weg), in elke volgorde",
    computeKnoopMetSplitsing(twee, 9, 0, 10).nodeId === 2 && computeKnoopMetSplitsing(omgekeerd, 9, 0, 10).nodeId === 2);
  check("…en op 6 mm: knoop 1 (6 mm weg, tegen 9 mm)",
    computeKnoopMetSplitsing(twee, 6, 0, 10).nodeId === 1 && computeKnoopMetSplitsing(omgekeerd, 6, 0, 10).nodeId === 1);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[6] De tolerantie wijzigen verandert geen geometrie");
{
  const m3 = { ...kolomOpLigger(3) };
  const voor = json(m3);
  controleerModel(m3, 10); controleerModel(m3, 1);
  check("controleren bij 10 en 1 mm laat het model ongemoeid", json(m3) === voor);
  check("herstel bij 1 mm: niets te doen", computeModelHerstel(m3, 1) === null);
  const h = computeModelHerstel(m3, 5);
  check("herstel bij 5 mm: de ligger op knoop 3 gesplitst", h !== null
    && h.beams.some((b) => b.from === 1 && b.to === 3) && h.beams.some((b) => b.from === 3 && b.to === 2), json(h?.beams));
  check("…en alle knopen staan nog op hun plek (knoop 3 op 3 mm boven de as)",
    h !== null && json(h.nodes) === json(m3.nodes), json(h?.nodes));
  check("…het herstelde model is schoon bij 5 mm", h !== null && !heeftFouten(controleerModel(h, 5)));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[7] Plaatranden volgen de instelling niet (de engine koppelt binnen 1 mm)");
{
  // Wand 4 × 3 m; kolom 5→6 met de voet 3 mm boven de bovenrand (z = 3003).
  const wand = {
    nodes: [
      { id: 1, x: 0, z: 0 }, { id: 2, x: 4000, z: 0 }, { id: 3, x: 4000, z: 3000 }, { id: 4, x: 0, z: 3000 },
      { id: 5, x: 1500, z: 3003 }, { id: 6, x: 1500, z: 5000 },
    ],
    beams: [{ id: 1, from: 5, to: 6 }],
    supports: [{ nodeId: 1 }, { nodeId: 2 }, { nodeId: 6 }],
    plates: [{ id: 1, nodeIds: [1, 2, 3, 4] }],
    loads: [],
  };
  for (const tol of [1, 5, 10]) {
    const bev = controleerModel(wand, tol).filter((b) => b.soort === "staafeindeBijPlaatrand");
    check(`${tol} mm: de voet 3 mm boven de plaatrand is een fout (niet gekoppeld)`,
      bev.length === 1 && bev[0].ernst === "fout" && /ligt 3 mm van rand 3 van de omtrek/.test(bev[0].tekst),
      json(bev.map((b) => b.tekst)));
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[8] De rekenpoort volgt de tolerantie");
{
  const fout = (f) => { try { f(); return null; } catch (e) { return e instanceof Error ? e.message : String(e); } };
  const m3 = kolomOpLigger(3);
  check("1 mm: de poort laat het model door", fout(() => controleerVoorRekenen(m3, 1)) === null);
  const bij5 = fout(() => controleerVoorRekenen(m3, 5));
  check("5 mm: de poort houdt het tegen, met knoop 3 en staaf 1 in de melding",
    /^Model niet doorgerekend/.test(bij5 ?? "") && /Knoop 3 ligt op staaf 1/.test(bij5 ?? ""), bij5);
  check("zonder tolerantie: de standaard (5 mm) houdt het tegen", fout(() => controleerVoorRekenen(m3)) !== null);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[9] Terugkoppeling: welke staaf op welke knoop is gesplitst");
{
  const regel = splitsingRegel({ staafId: 1, knoopId: 3, delen: [5, 6] });
  check("de Nederlandse regel noemt knoop, staaf en de twee delen",
    regel.tekst === "Knoop 3 verbonden met staaf 1: die is gesplitst in staaf 5 en staaf 6.", regel.tekst);
  const samen = samenvoegRegel(2, 3);
  check("samenvoegen: 'Knoop 3 samengevoegd met knoop 2.'", samen.tekst === "Knoop 3 samengevoegd met knoop 2.", samen.tekst);
  await zetTaal("nl");
  const t = i18next.t.bind(i18next);
  check("nl: de vertaling is letterlijk de Nederlandse tekst",
    vertaal(t, regel) === regel.tekst && vertaal(t, samen) === samen.tekst, `${vertaal(t, regel)} | ${vertaal(t, samen)}`);
  check("nl: titel 'Staaf gesplitst' / 'Staven gesplitst'",
    t("common:canvas.modelCheck.splitTitle", { count: 1 }) === "Staaf gesplitst"
    && t("common:canvas.modelCheck.splitTitle", { count: 2 }) === "Staven gesplitst");
  // Met een knik (de knoop lag naast de staafas): een tweede zin met de maat.
  const knik = splitsingRegel({ staafId: 1, knoopId: 3, delen: [5, 6], afwijkingMm: 2.54 });
  check("met knik: de regel noemt de afwijking (afgerond op 0,1 mm, met komma)",
    knik.tekst === "Knoop 3 verbonden met staaf 1: die is gesplitst in staaf 5 en staaf 6. De knoop lag 2,5 mm naast de staafas; daar zit nu een knik."
    && knik.sleutel === "common:canvas.modelCheck.splitLineOffset" && vertaal(t, knik) === knik.tekst, knik.tekst);
  check("onder 0,05 mm geen knik-zin (afrondingsruis)",
    splitsingRegel({ staafId: 1, knoopId: 3, delen: [5, 6], afwijkingMm: 0.04 }).tekst === regel.tekst);
  for (const taal of ["en", "de", "fr"]) {
    await zetTaal(taal);
    const tt = i18next.t.bind(i18next);
    const r = vertaal(tt, regel), s = vertaal(tt, samen), titel = tt("common:canvas.modelCheck.splitTitle", { count: 1 });
    check(`${taal}: regels vertaald, met de nummers erin`,
      r !== regel.tekst && /3/.test(r) && /1/.test(r) && /5/.test(r) && /6/.test(r)
      && s !== samen.tekst && !r.includes("canvas.") && !titel.includes("canvas.") && titel !== "Staaf gesplitst",
      `${r} | ${s} | ${titel}`);
    const k = vertaal(tt, knik);
    check(`${taal}: de knik-zin vertaald, met de maat`, k !== knik.tekst && k.includes("2,5") && k.startsWith(r), k);
  }
  await zetTaal("nl");

  // De delen in de uitkomst van het splitsen en het herstel.
  const m3 = kolomOpLigger(3);
  const deel = computeBeamSplitOpKnoop(m3, 1, 3);
  check("computeBeamSplitOpKnoop geeft de ids van beide delen", json(deel?.delen) === json([3, 4]), json(deel?.delen));
  // Het herstel splitst op de knoop waar hij staat; de kolomvoet lag 3 mm
  // boven de liggeras, dus de regel noemt de knik.
  const h = computeModelHerstel(m3, 5);
  check("het herstel meldt de splitsing (staaf 1 op knoop 3, delen 3 en 4) en de knik van 3 mm",
    h !== null && h.stappen.length === 1
    && h.stappen[0] === "Knoop 3 verbonden met staaf 1: die is gesplitst in staaf 3 en staaf 4. De knoop lag 3 mm naast de staafas; daar zit nu een knik.",
    json(h?.stappen));
  check("…met dezelfde regel als vertaalbare tekst voor de melding",
    h !== null && h.regels.length === 1 && h.regels[0].sleutel === "common:canvas.modelCheck.splitLineOffset"
    && h.regels[0].tekst === h.stappen[0], json(h?.regels));
  // Precies op de as: geen knik-zin.
  const h0 = computeModelHerstel(kolomOpLigger(0), 5);
  check("op de as (0 mm): alleen de splitsing, sleutel splitLine",
    h0 !== null && h0.stappen.length === 1
    && h0.stappen[0] === "Knoop 3 verbonden met staaf 1: die is gesplitst in staaf 3 en staaf 4."
    && h0.regels[0].sleutel === "common:canvas.modelCheck.splitLine", json(h0?.stappen));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[10] Bewaard met de snapinstellingen");
{
  const SLEUTEL = "open-fem-studio.snapInstellingen";
  const opslag = new Map();
  globalThis.localStorage = {
    getItem: (k) => (opslag.has(k) ? opslag.get(k) : null),
    setItem: (k, v) => { opslag.set(k, String(v)); },
    removeItem: (k) => { opslag.delete(k); },
  };
  let teller = 0;
  const verseModule = () => import(`./src/hooks/useSnapInstellingen.ts?verbinding=${++teller}`);
  try {
    const snap = await verseModule();
    check("beginstand: 5 mm", snap.leesSnapInstellingen().verbindingsTolerantie === 5
      && snap.SNAP_BEGINSTAND.verbindingsTolerantie === 5);
    snap.zetVerbindingsTolerantie(2.5);
    check("zetten: 2,5 mm", snap.leesSnapInstellingen().verbindingsTolerantie === 2.5);
    check("bewaard als JSON onder dezelfde sleutel als de snaps",
      JSON.parse(opslag.get(SLEUTEL) ?? "null")?.verbindingsTolerantie === 2.5, opslag.get(SLEUTEL));
    check("een nieuwe start laadt 2,5 mm", (await verseModule()).leesSnapInstellingen().verbindingsTolerantie === 2.5);
    snap.zetVerbindingsTolerantie(0.01);
    check("onder 0,1 wordt 0,1", snap.leesSnapInstellingen().verbindingsTolerantie === 0.1);
    snap.zetVerbindingsTolerantie(500);
    check("boven 25 wordt 25", snap.leesSnapInstellingen().verbindingsTolerantie === 25);
    check("vreemde opslag: de standaard of begrensd (een bewaarde 50 van vóór de grens van 25 wordt 25)",
      snap.snapInstellingenUitOpslag(json({ verbindingsTolerantie: "veel" })).verbindingsTolerantie === 5
      && snap.snapInstellingenUitOpslag(json({ verbindingsTolerantie: 99 })).verbindingsTolerantie === 25
      && snap.snapInstellingenUitOpslag(json({ verbindingsTolerantie: 50 })).verbindingsTolerantie === 25
      && snap.snapInstellingenUitOpslag(json({ knoop: false })).verbindingsTolerantie === 5);
    snap.herstelSnapBeginstand();
    check("herstel beginstand: weer 5 mm", snap.leesSnapInstellingen().verbindingsTolerantie === 5);
  } finally {
    delete globalThis.localStorage;
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[11] De instelling komt overal aan (bron)");
{
  const lees = (...pad) => readFileSync(join(HIER, "src", ...pad), "utf8").replace(/\r\n/g, "\n");
  const canvas = lees("components", "fem", "FemCanvas.tsx");
  check("FemCanvas gebruikt geen vaste CONTROLE_TOL_MM meer", !/CONTROLE_TOL_MM/.test(canvas));
  check("FemCanvas: de live controle krijgt de verbindingstolerantie",
    /controleerModel\(\{[^}]*\}, verbindingsTolerantie\)/.test(canvas));
  check("FemCanvas: plaatsen en herstellen krijgen de verbindingstolerantie",
    /addNodeMetSplitsing\(x, z, verbindingsTolerantie\)/.test(canvas) && /herstelModel\(verbindingsTolerantie\)/.test(canvas));
  // Knoop/oplegging op een staaf onder de muis én het subknoop-gereedschap:
  // dezelfde regel (tussenpuntOpStaaf, met opZelfdePlek voor de uiteinden).
  check("FemCanvas: staaf onder de muis en subknoop volgen tussenpuntOpStaaf met de tolerantie",
    (canvas.match(/tussenpuntOpStaaf\(nodes, b, sb\.x, sb\.z, verbindingsTolerantie\)/g) ?? []).length === 2);
  check("FemCanvas: de subknoop splitst op het voetpunt, met de tolerantie",
    /splitBeamAt\(sb\.beamId, p\.x, p\.z, verbindingsTolerantie\)/.test(canvas)
    && /if \(p\.eindknoop !== null\) \{\s*notifyInfo\(i18next\.t\("common:canvas\.subNode\.atEndTitle"\)/.test(canvas));
  const app = lees("App.tsx");
  check("App.tsx: de rekenpoort krijgt de verbindingstolerantie",
    /controleerVoorRekenen\(\{[\s\S]*?\}, leesSnapInstellingen\(\)\.verbindingsTolerantie\)/.test(app));
  const tab = lees("components", "fem", "ExplorerViewTab.tsx");
  check("de tab Weergave heeft het veld", /zetVerbindingsTolerantie/.test(tab) && /data-snap-opties="verbinding"/.test(tab));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[12] Samenvoegen: een plaathoek (daarna een oplegging) blijft staan");
{
  // Kolom met de kop 3 mm naast de linkeronderhoek van een wand. Is de staaf
  // EERST getekend, dan hebben zijn knopen de laagste ids. Met "de laagste id
  // blijft" schoof de plaathoek naar de kolomkop: de asgelijnde rechthoek werd
  // een polygoon en de randlast "bovenrand" een nieuwe blokkerende fout.
  const wandMetKolom = (eerst) => {
    const kolom = [{ x: -3, z: -3000 }, { x: -3, z: 0 }];
    const hoeken = [{ x: 0, z: 0 }, { x: 4000, z: 0 }, { x: 4000, z: 3000 }, { x: 0, z: 3000 }];
    const punten = eerst === "staaf" ? [...kolom, ...hoeken] : [...hoeken, ...kolom];
    const nodes = punten.map((p, i) => ({ id: i + 1, ...p }));
    const kolomIds = eerst === "staaf" ? [1, 2] : [5, 6];
    const hoekIds = eerst === "staaf" ? [3, 4, 5, 6] : [1, 2, 3, 4];
    return {
      nodes,
      beams: [{ id: 1, from: kolomIds[0], to: kolomIds[1], material: "S235", profile: "HEA 200" }],
      supports: [{ nodeId: kolomIds[0], type: "pinned" }],
      plates: [{ id: 1, nodeIds: hoekIds, materiaal: "C30/37", dikte: 200 }],
      loads: [{ id: 1, type: "edgeLoad", plateId: 1, edge: "top", q: -5, caseId: 1 }],
      kolomkop: kolomIds[1], hoek: hoekIds[0],
    };
  };
  const fouten = (model, tol) => controleerModel(model, tol).filter((b) => b.ernst === "fout");
  for (const eerst of ["staaf", "plaat"]) {
    const m = wandMetKolom(eerst);
    const bij1 = fouten(m, 1);
    check(`${eerst} eerst getekend, 1 mm: alleen 'staafeinde bij de plaatrand' voor de kolomkop`,
      bij1.length === 1 && bij1[0].soort === "staafeindeBijPlaatrand" && bij1[0].nodeIds[0] === m.kolomkop,
      json(soorten(bij1)));
    const bij5 = fouten(m, 5);
    check(`${eerst} eerst, 5 mm: één fout (samenvoegen), de plaathoek blijft, de randfout vervalt`,
      bij5.length === 1 && bij5[0].soort === "dubbeleKnoop"
      && bij5[0].herstel?.bewaarId === m.hoek && bij5[0].herstel?.verwijderId === m.kolomkop,
      json(soorten(bij5)) + " " + json(bij5.map((b) => b.herstel)));
    const h = computeModelHerstel(m, 5);
    const hoeken = h?.plates[0].nodeIds.map((id) => h.nodes.find((n) => n.id === id)) ?? [];
    check(`${eerst} eerst, herstel: 'Knoop ${m.kolomkop} samengevoegd met knoop ${m.hoek}.', de wand ongewijzigd`,
      h !== null && json(h.stappen) === json([`Knoop ${m.kolomkop} samengevoegd met knoop ${m.hoek}.`])
      && json(hoeken.map((p) => [p.x, p.z])) === json([[0, 0], [4000, 0], [4000, 3000], [0, 3000]])
      && isAsgelijndeRechthoek(hoeken), json([h?.stappen, hoeken]));
    check(`${eerst} eerst, na het herstel: geen fout, de randlast 'bovenrand' blijft geldig`,
      h !== null && fouten(h, 5).length === 0 && h.beams[0].to === m.hoek, json(h && fouten(h, 5).map((b) => b.tekst)));
  }
  // Twee knopen binnen de tolerantie; de HOOGSTE id draagt een oplegging: die blijft staan.
  const gesteund = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 3000, z: 0 }, { id: 3, x: 3003, z: 0 }, { id: 4, x: 3003, z: 3000 }],
    beams: [{ id: 1, from: 1, to: 2 }, { id: 2, from: 3, to: 4 }],
    supports: [{ nodeId: 1 }, { nodeId: 3 }], plates: [],
  };
  const d = zoekDubbeleKnopen(gesteund, 5);
  check("een oplegging gaat voor de laagste id: knoop 3 (gesteund) blijft, knoop 2 verhuist",
    d.length === 1 && d[0].herstel?.bewaarId === 3 && d[0].herstel?.verwijderId === 2, json(d.map((b) => b.herstel)));
  const zonder = { ...gesteund, supports: [{ nodeId: 1 }] };
  check("zonder plaathoek of oplegging: de laagste id blijft",
    zoekDubbeleKnopen(zonder, 5)[0]?.herstel?.bewaarId === 2);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[13] De tekst noemt de echte afstand en de tolerantie, niet 'lengte nul'");
{
  const kort = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 3000, z: 0 }, { id: 3, x: 3004, z: 0 }, { id: 4, x: 6000, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2 }, { id: 2, from: 2, to: 3 }, { id: 3, from: 3, to: 4 }],
    supports: [{ nodeId: 1 }, { nodeId: 4 }], plates: [],
  };
  const k5 = zoekDubbeleKnopen(kort, 5);
  check("staaf van 4 mm bij 5 mm: lengte en tolerantie in de tekst, met de plek van de instelling",
    k5.length === 1 && k5[0].tekst === "Knoop 2 (3000; 0) en knoop 3 (3004; 0) mm zijn verbonden met een staaf van 4 mm, "
      + "korter dan de verbindingstolerantie van 5 mm (tab Weergave); voeg ze samen.", k5[0]?.tekst);
  check("…en niet 'lengte nul'", k5.length === 1 && !k5[0].tekst.includes("lengte nul"));
  check("bij 1 mm: geen bevinding voor de staaf van 4 mm", zoekDubbeleKnopen(kort, 1).length === 0);
  const los = { nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 4.5, z: 0 }], beams: [] };
  const l = zoekDubbeleKnopen(los, 5);
  check("los paar 4,5 mm uit elkaar: afstand en tolerantie in de tekst",
    l.length === 1 && l[0].tekst === "Knoop 1 (0; 0) en knoop 2 (4,5; 0) mm liggen 4,5 mm uit elkaar, binnen de "
      + "verbindingstolerantie van 5 mm (tab Weergave), en gelden dus als dezelfde plek. Ze zijn NIET met elkaar "
      + "verbonden; voeg ze samen of verplaats er één.", l[0]?.tekst);
  check("een decimale tolerantie met komma: '2,5 mm'",
    (zoekDubbeleKnopen({ nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 2, z: 0 }], beams: [] }, 2.5)[0]?.tekst ?? "")
      .includes("de verbindingstolerantie van 2,5 mm (tab Weergave)"));
  const nul = zoekDubbeleKnopen({ nodes: [{ id: 1, x: 7, z: 0 }, { id: 2, x: 7, z: 0 }], beams: [{ id: 1, from: 1, to: 2 }] }, 5);
  check("echt op elkaar: nog steeds 'op dezelfde plek' en 'lengte nul'",
    nul.length === 1 && nul[0].tekst === "Knoop 1 en knoop 2 liggen op dezelfde plek (7, 0) mm en zijn met een staaf "
      + "van lengte nul verbonden; voeg ze samen.", nul[0]?.tekst);
  // Euclidisch: een schuine staaf van 7 mm is bij 5 mm geen samenvoeg-geval.
  const schuin = { nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 4.95, z: 4.95 }], beams: [{ id: 1, from: 1, to: 2 }] };
  check("schuine staaf van 7 mm (4,95 mm per as) bij 5 mm: geen bevinding", zoekDubbeleKnopen(schuin, 5).length === 0);
  check("…bij 7,5 mm wel, met 'een staaf van 7 mm'",
    (zoekDubbeleKnopen(schuin, 7.5)[0]?.tekst ?? "")
      .includes("verbonden met een staaf van 7 mm, korter dan de verbindingstolerantie van 7,5 mm"),
    zoekDubbeleKnopen(schuin, 7.5)[0]?.tekst);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[14] Bij de bovengrens (25 mm): naburige rasterpunten blijven gescheiden");
{
  const tol = VERBINDINGSTOLERANTIE_MAX_MM;
  const buren = { nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 50, z: 0 }, { id: 3, x: 50, z: 50 }], beams: [] };
  check("knopen één rasterstap (50 mm) uit elkaar, ook schuin: geen dubbeleKnoop",
    zoekDubbeleKnopen(buren, tol).length === 0);
  check("25 mm zelf telt mee (grens inbegrepen)",
    zoekDubbeleKnopen({ nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 25, z: 0 }], beams: [] }, tol).length === 1);
  const p = computeKnoopMetSplitsing({ nodes: [{ id: 1, x: 0, z: 0 }], beams: [], loads: [] }, 50, 0, tol);
  check("plaatsen op het naburige rasterpunt (50; 0) geeft een nieuwe knoop", p.nodeId === 2 && p.nodes.length === 2);
  const evenwijdig = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 4000, z: 0 }, { id: 3, x: 1000, z: 50 }, { id: 4, x: 3000, z: 50 }],
    beams: [{ id: 1, from: 1, to: 2 }, { id: 2, from: 3, to: 4 }],
    supports: [{ nodeId: 1 }, { nodeId: 2 }, { nodeId: 3 }, { nodeId: 4 }], plates: [],
  };
  check("evenwijdige staaf één rasterstap verderop: geen 'op de staaf'",
    zoekKnopenOpStaaf(evenwijdig, tol).length === 0 && !heeftFouten(controleerModel(evenwijdig, tol)),
    json(soorten(controleerModel(evenwijdig, tol))));
  const q = computeKnoopMetSplitsing({ ...evenwijdig, loads: [] }, 2000, 50, tol);
  check("plaatsen op de evenwijdige staaf splitst die staaf, niet de ligger 50 mm lager",
    json(q.splitsingen.map((x) => x.staafId)) === json([2]), json(q.splitsingen));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[15] Subknoop: op de staafas, en niet binnen de tolerantie van een staafeinde");
{
  const lig = { nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }], beams: [{ id: 1, from: 1, to: 2 }], loads: [] };
  check("tussenpuntOpStaaf: 3 mm van het begin is bij 5 mm het begin zelf (eindknoop 1)",
    tussenpuntOpStaaf(lig.nodes, lig.beams[0], 3, 0, 5)?.eindknoop === 1);
  check("…en 2 mm vóór het einde, 1 mm ernaast: eindknoop 2",
    tussenpuntOpStaaf(lig.nodes, lig.beams[0], 5998, 1, 5)?.eindknoop === 2);
  check("…in het midden, 4 mm ernaast: het voetpunt (3000; 0), geen eindknoop",
    json(tussenpuntOpStaaf(lig.nodes, lig.beams[0], 3000, 4, 5)) === json({ x: 3000, z: 0, t: 0.5, eindknoop: null }));
  check("splitsen op 3 mm van het begin bij 5 mm: geweigerd (geen staaf van 3 mm, geen samenvoeg-fout)",
    computeBeamSplit(lig, 1, 3, 0, 5) === null && computeBeamSplit(lig, 1, 5998, 1, 5) === null);
  const bij1 = computeBeamSplit(lig, 1, 3, 0, 1);
  check("…bij 1 mm mag het wel (3 mm > 1 mm), zonder fout bij 1 mm",
    bij1 !== null && !controleerModel({ ...bij1, supports: [{ nodeId: 1 }, { nodeId: 2 }] }, 1).some((b) => b.ernst === "fout"),
    json(bij1 && soorten(controleerModel(bij1, 1))));
  const midden = computeBeamSplit(lig, 1, 3000, 4, 5);
  check("splitsen in het midden, 4 mm naast de as: de knoop op de as (3000; 0), de staaf blijft recht",
    json(midden?.nodes.find((n) => n.id === midden.newNodeId)) === json({ id: 3, x: 3000, z: 0 }));
  const oud = computeBeamSplit(lig, 1, 3000, 4);
  check("zonder tolerantie (de bestaande aanroepers en tests): op het punt zelf, zoals vroeger",
    json(oud?.nodes.find((n) => n.id === oud.newNodeId)) === json({ id: 3, x: 3000, z: 4 }));
}

log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);

// Tekenhulpen van het 3D-tekenvlak (#84): objectspoor (zoals in CAD), Shift
// als ortho, Alt zonder snap en de maat tijdens het tekenen. De rekenregels
// staan in src/components/openFem3d/openFem3dTekenhulp.ts; het tekenvlak
// (ThreeFrameCanvas) geeft het muispunt op het werkvlak, de schermprojectie en
// de kandidaten van knoop-, stramien- en rastersnap, en tekent wat hier uitkomt.
//
//  [1]  werkvlak: assen in het vlak, projectie, richting in het vlak
//  [2]  verwerven: hoogstens 7, de oudste valt af, bijwerken na een modelwijziging
//  [3]  uitlijnen op een verworven knoop (X/Y, ook vanaf een ander level)
//  [4]  snijpunt van twee spoorlijnen; een knoop gaat voor
//  [5]  verlengen van een verworven staaf (alleen voorbij een einde)
//  [6]  loodrecht: voetpunt en richting
//  [7]  parallel aan een verworven staaf
//  [8]  voorrang: knoop > snijpunt > spoorlijn > stramien > raster
//  [9]  Alt: alle snaps tijdelijk uit
//  [10] Shift: ortho langs een globale as in het werkvlak (Z bij verticaal tekenen)
//  [11] directe lengte-invoer (mm, komma of punt, Backspace, Esc, Enter)
//  [12] teksten bij de cursor en het maatlabel
//  [13] prestatie: alleen verworven punten en staven
//  [14] de snapinstelling Objectspoor (bewaard, standaard aan)
//  [15] de bedrading: tekenvlak, statusbalk, tab Weergave, App, dekking, teksten
//  [16] de vangzone loodrecht in beeld, ook in schuine aanzichten (perspectief)
//  [17] aansluiten op een bestaande staaf: splitsen op tekenpunt, snijpunt of voetpunt
//  [18] het maatlabel wijkt uit voor de tekst bij de cursor
//
// Alle afstanden in het model in meter (zoals het 3D-model), maten in beeld en
// bij de invoer in mm. Schermprojectie in de proeven: bovenaanzicht met 100 px
// per meter, x naar rechts en y omhoog (in [16] een echte perspectiefcamera).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const hulp = await import("./src/components/openFem3d/openFem3dTekenhulp.ts");
const {
  assenInWerkvlak, opWerkvlak, richtingInWerkvlak, verwerf, verworvenNaModel, kiesTekenpunt, spoorLijnen,
  maatToets, leesMaat, maatEindpunt, toonMaatMm, maatTekst, tekenpuntTekst,
  ratioOpStaaf, snijpuntLijnStaaf, staafSplitsing, uitwijking,
  SPOOR_TOLERANTIE_PX, SPOOR_SNIJPUNT_PX, SPOOR_VERWERF_MS, SPOOR_MAX_VERWORVEN,
} = hulp;
const HIER = dirname(fileURLToPath(import.meta.url));
let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const json = (v) => JSON.stringify(v);
const P = (x, y, z = 0) => ({ x, y, z });
const gelijkPunt = (a, b, tol = 0) => !!a && Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.z - b.z) <= tol;
const exact = (a, b) => !!a && a.x === b.x && a.y === b.y && a.z === b.z;

const VLAK_BOVEN = { punt: P(0, 0, 0), normaal: P(0, 0, 1) };
const VLAK_VOOR = { punt: P(0, 0, 0), normaal: P(0, 1, 0) };
const BOVEN = (p) => ({ x: 400 + p.x * 100, y: 300 - p.y * 100 });
const BOVEN50 = (p) => ({ x: 400 + p.x * 50, y: 300 - p.y * 50 });
const VOOR = (p) => ({ x: 400 + p.x * 100, y: 300 - p.z * 100 });
const ALLES = { knoop: true, stramien: true, raster: true, spoor: true };
const knoop = (id, p) => ({ soort: "knoop", id, punt: p });
const staaf = (id, a, b) => ({ soort: "staaf", id, a, b });
/** kiesTekenpunt met de standaard van een proef: bovenaanzicht, alle snaps aan, geen kandidaten. */
const kies = (cursor, over = {}) => {
  const naarScherm = over.naarScherm ?? BOVEN;
  return kiesTekenpunt({
    cursor, cursorPx: naarScherm(cursor), naarScherm, vlak: VLAK_BOVEN, start: null, verworven: [],
    instellingen: ALLES, toetsen: { alt: false, shift: false },
    knoop: null, stramien: null, raster: null, rasterStap: null, ...over,
  });
};

log("[1] werkvlak: assen in het vlak, projectie en richting");
check("boven (normaal Z): X en Y", json(assenInWerkvlak(P(0, 0, 1))) === json(["x", "y"]));
check("voor (normaal Y): X en Z", json(assenInWerkvlak(P(0, -1, 0))) === json(["x", "z"]));
check("zij (normaal X): Y en Z", json(assenInWerkvlak(P(1, 0, 0))) === json(["y", "z"]));
check("schuin dakvlak (normaal 0; −0,6; 0,8): alleen X", json(assenInWerkvlak(P(0, -0.6, 0.8))) === json(["x"]));
check("helemaal schuin (1; 1; 1)/√3: geen as", assenInWerkvlak(P(1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3))).length === 0);
check("projectie op het werkvlak z = 0,1 is exact (geen 0,10000000000000009)",
  exact(opWerkvlak(P(1, 2, 3), { punt: P(5, 5, 0.1), normaal: P(0, 0, 1) }), P(1, 2, 0.1)));
check("projectie op een schuin vlak ligt in het vlak",
  Math.abs(((p) => -0.6 * p.y + 0.8 * p.z)(opWerkvlak(P(1, 2, 3), { punt: P(0, 0, 0), normaal: P(0, -0.6, 0.8) }))) < 1e-12);
for (const [normaal, delta, graden, naam] of [
  [P(0, 0, 1), P(1, 1, 0), 45, "boven: 45° van +X naar +Y"],
  [P(0, 0, -1), P(1, 1, 0), 45, "boven met omgekeerde normaal: ook 45°"],
  [P(0, 0, 1), P(-1, 0, 0), 180, "boven: −X is 180°"],
  [P(0, 0, 1), P(0, -2, 0), 270, "boven: −Y is 270°"],
  [P(0, 1, 0), P(0, 0, 3), 90, "voor: +Z is 90°"],
  [P(0, -1, 0), P(1, 0, 0), 0, "voor: +X is 0°"],
  [P(1, 0, 0), P(0, 1, 0), 0, "zij: +Y is 0°"],
  [P(-1, 0, 0), P(0, -1, 1), 135, "zij: (−Y, +Z) is 135°"],
]) {
  const r = richtingInWerkvlak(normaal, delta);
  check(naam, r !== null && Math.abs(r - graden) < 1e-9, String(r));
}
check("richting zonder lengte: null", richtingInWerkvlak(P(0, 0, 1), P(0, 0, 0)) === null);

log("\n[2] verwerven");
check("hoogstens 7 tegelijk, ±0,4 s boven een knoop of staaf", SPOOR_MAX_VERWORVEN === 7 && SPOOR_VERWERF_MS === 400);
{
  let lijst = [];
  for (let id = 1; id <= 9; id += 1) lijst = verwerf(lijst, knoop(id, P(id, 0)));
  check("na negen knopen: de oudste twee zijn afgevallen", json(lijst.map((i) => i.id)) === json([3, 4, 5, 6, 7, 8, 9]));
  lijst = verwerf(lijst, knoop(4, P(4, 1)));
  check("een al verworven knoop opnieuw: één keer, als nieuwste, met de nieuwe plek",
    json(lijst.map((i) => i.id)) === json([3, 5, 6, 7, 8, 9, 4]) && lijst.at(-1).punt.y === 1);
  lijst = verwerf(lijst, staaf(4, P(0, 0), P(1, 0)));
  check("staaf 4 is iets anders dan knoop 4; de oudste (knoop 3) valt af",
    json(lijst.map((i) => `${i.soort}:${i.id}`)) === json(["knoop:5", "knoop:6", "knoop:7", "knoop:8", "knoop:9", "knoop:4", "staaf:4"]));
  const knopen = new Map([[5, P(5, 0)], [6, P(6, 2)], [7, P(7, 0)], [8, P(8, 0)], [4, P(4, 1)], [10, P(0, 0)], [11, P(3, 0)]]);
  const staven = new Map([[4, { startNodeId: 10, endNodeId: 11 }]]);
  const na = verworvenNaModel(lijst, knopen, staven);
  check("na een modelwijziging: verdwenen knoop 9 valt weg, knoop 6 krijgt zijn nieuwe plek, staaf 4 zijn knopen",
    json(na.map((i) => `${i.soort}:${i.id}`)) === json(["knoop:5", "knoop:6", "knoop:7", "knoop:8", "knoop:4", "staaf:4"])
    && na[1].punt.y === 2 && exact(na.at(-1).b, P(3, 0)));
  check("ongewijzigd model: dezelfde lijst (geen nieuwe array)", verworvenNaModel(na, knopen, staven) === na);
}

log("\n[3] uitlijnen op een verworven knoop");
const A = knoop(12, P(2, 3));
check("de vangzone is ±8 px", SPOOR_TOLERANTIE_PX === 8);
{
  const r = kies(P(5, 3.05), { verworven: [A] });
  check("5 px naast de X-lijn door knoop 12: precies op y = 3", r.soort === "spoor" && exact(r.punt, P(5, 3, 0)), json(r));
  check("... uitlijnen X met knoop 12, afstand 3 m", r.lijnen.length === 1 && r.lijnen[0].soort === "uitlijnen"
    && r.lijnen[0].as === "x" && r.lijnen[0].knoopId === 12 && Math.abs(r.afstand - 3) < 1e-12, json(r.lijnen));
  const g = kies(P(5.13, 3.05), { verworven: [A], rasterStap: 0.5, raster: P(5, 3, 0) });
  check("met raster: de vrije coördinaat langs de lijn op het raster (x = 5), y exact van de knoop", g.soort === "spoor" && exact(g.punt, P(5, 3, 0)), json(g.punt));
  const v = kies(P(5, 3.1), { verworven: [A] });
  check("10 px ernaast: geen spoor (vrij punt)", v.soort === "vrij" && exact(v.punt, P(5, 3.1)), json(v));
  const y = kies(P(2.04, 1), { verworven: [A] });
  check("Y-lijn door knoop 12: x = 2", y.soort === "spoor" && exact(y.punt, P(2, 1, 0)) && y.lijnen[0].as === "y");
  const hoog = kies(P(5, 3.05), { verworven: [knoop(12, P(2, 3, 3))] });
  check("een knoop op een ander level lijnt uit in het werkvlak (z = 0)", hoog.soort === "spoor" && exact(hoog.punt, P(5, 3, 0)), json(hoog.punt));
  const ver = kies(P(5, 3.1), { verworven: [A], naarScherm: BOVEN50 });
  check("uitgezoomd (50 px/m) ligt 0,1 m binnen de 8 px", ver.soort === "spoor" && exact(ver.punt, P(5, 3, 0)));
  const begin = kies(P(4, 0.04), { start: { punt: P(1, 0), knoopId: 1 } });
  check("het beginpunt van de staaf in aanbouw is vanzelf verworven", begin.soort === "spoor"
    && exact(begin.punt, P(4, 0, 0)) && begin.lijnen[0].knoopId === 1 && begin.lijnen[0].as === "x");
  const uit = kies(P(5, 3.05), { verworven: [A], instellingen: { ...ALLES, spoor: false } });
  check("objectspoor uit: geen spoor", uit.soort === "vrij");
}

log("\n[4] snijpunt van twee spoorlijnen");
const B = knoop(5, P(6, 1));
{
  const r = kies(P(6.05, 3.04), { verworven: [A, B] });
  check("X door knoop 12 en Y door knoop 5: precies (6; 3)", r.soort === "snijpunt" && exact(r.punt, P(6, 3, 0)), json(r));
  check("... met beide lijnen", r.lijnen.length === 2
    && json(r.lijnen.map((l) => `${l.as}${l.knoopId}`).sort()) === json(["x12", "y5"]), json(r.lijnen));
  const k = kies(P(6.05, 3.04), { verworven: [A, B], knoop: { id: 8, punt: P(6.02, 3) } });
  check("een knoop binnen de snapzone gaat voor", k.soort === "knoop" && k.knoopId === 8 && exact(k.punt, P(6.02, 3)));
  const z = kies(P(2.03, 3.02), { verworven: [A], instellingen: { ...ALLES, knoop: false } });
  check("zonder knoopsnap: X en Y door dezelfde knoop vangen het verworven punt zelf", z.soort === "snijpunt" && exact(z.punt, P(2, 3, 0)));
  const ver = kies(P(6.1, 3.04), { verworven: [A, B] });
  check("te ver van de Y-lijn (10 px): alleen de X-lijn", ver.soort === "spoor" && exact(ver.punt, P(6.1, 3, 0)));
  // De snijpuntzone (12 px): de X-lijn door knoop 12 en de verlenging van
  // staaf 8 onder 30° door (5; 3). De cursor op de X-lijn, 11 of 13 px van het
  // snijpunt, ligt 5,5 of 6,5 px van de schuine lijn: beide lijnen zijn actief.
  const c30 = Math.cos(Math.PI / 6), s30 = Math.sin(Math.PI / 6);
  const s8 = staaf(8, P(5 - 2 * c30, 3 - 2 * s30), P(5 - c30, 3 - s30));
  const binnen = kies(P(5.11, 3), { verworven: [A, s8] });
  check(`snijpuntzone ${SPOOR_SNIJPUNT_PX} px: 11 px van het snijpunt vangt het snijpunt (5; 3)`, SPOOR_SNIJPUNT_PX === 12
    && binnen.soort === "snijpunt" && gelijkPunt(binnen.punt, P(5, 3, 0), 1e-9), json(binnen));
  const buiten = kies(P(5.13, 3), { verworven: [A, s8] });
  check("13 px van het snijpunt: geen snijpunt, de dichtstbijzijnde lijn (X door knoop 12)", buiten.soort === "spoor"
    && exact(buiten.punt, P(5.13, 3, 0)) && buiten.lijnen[0].soort === "uitlijnen", json(buiten));
  // Twee lijnen onder een kleine hoek: beide binnen 8 px, maar hun snijpunt
  // ligt 5 m (500 px) verderop; zonder de grens sprong het punt daarheen.
  const s9 = staaf(9, P(-10, 2.9), P(-5, 2.95));
  const klein = kies(P(5, 3.03), { verworven: [A, s9] });
  check("lijnen onder een kleine hoek: het verre snijpunt vangt niet, de dichtstbijzijnde lijn wel (verlengen staaf 9)",
    klein.soort === "spoor" && klein.lijnen[0].soort === "verlengen" && klein.lijnen[0].staafId === 9
    && Math.abs(klein.punt.x - 5) < 0.01, json(klein));
}

log("\n[5] verlengen van een verworven staaf");
{
  const s4 = staaf(4, P(0, 0), P(3, 0));
  const r = kies(P(4.5, 0.05), { verworven: [s4] });
  check("voorbij het eind: op de verlenging (y = 0), 1,5 m van het eind", r.soort === "spoor" && exact(r.punt, P(4.5, 0, 0))
    && r.lijnen[0].soort === "verlengen" && r.lijnen[0].staafId === 4 && Math.abs(r.afstand - 1.5) < 1e-12, json(r));
  const l = kies(P(-1, 0.03), { verworven: [s4] });
  check("voorbij het begin: ook, 1 m van het begin", l.soort === "spoor" && exact(l.punt, P(-1, 0, 0)) && Math.abs(l.afstand - 1) < 1e-12);
  check("boven de staaf zelf: geen verlenging", kies(P(1.5, 0.05), { verworven: [s4] }).soort === "vrij");
  const s7 = staaf(7, P(0, 0), P(3, 4));
  // b + r·4,8 + n·0,04 met r = (0,6; 0,8) en n = (−0,8; 0,6): 4 px naast de verlenging.
  const c = P(3 + 0.6 * 4.8 - 0.8 * 0.04, 4 + 0.8 * 4.8 + 0.6 * 0.04);
  const s = kies(c, { verworven: [s7], rasterStap: 0.5 });
  check("schuine staaf met raster 500 mm: de afstand vanaf het eind wordt 5000 mm → (6; 8)",
    s.soort === "spoor" && s.lijnen[0].soort === "verlengen" && exact(s.punt, P(6, 8, 0)) && Math.abs(s.afstand - 5) < 1e-9, json(s));
  const z = kies(c, { verworven: [s7] });
  check("zonder raster: het voetpunt op de verlenging", z.soort === "spoor" && Math.abs(-0.8 * (z.punt.x - 3) + 0.6 * (z.punt.y - 4)) < 1e-9
    && Math.abs(z.afstand - 4.8) < 1e-9, json(z));
  const hoog = kies(P(4.5, 0.05), { verworven: [staaf(4, P(0, 0, 3), P(3, 0, 3))] });
  check("een staaf op een ander level verlengt in het werkvlak", hoog.soort === "spoor" && exact(hoog.punt, P(4.5, 0, 0)));
  check("een kolom (loodrecht op het werkvlak) geeft geen verlenging",
    kies(P(0.03, 0.02), { verworven: [staaf(9, P(0, 0, 0), P(0, 0, 3))], instellingen: { ...ALLES, knoop: false } }).soort === "vrij");
  // Een kolom 1 mm uit het lood: de projectie (0,99 mm) heeft geen
  // betrouwbare richting; vroeger gaf hij lijnen onder 45°.
  const kolom = staaf(9, P(6, 0, 0), P(6.0007, 0.0007, 8));
  const S = { punt: P(0, 0), knoopId: 1 };
  check("een kolom 1 mm uit het lood: geen verlengen, loodrecht of parallel",
    spoorLijnen(VLAK_BOVEN, S, [kolom]).every((l) => l.staafId !== 9), json(spoorLijnen(VLAK_BOVEN, S, [kolom]).filter((l) => l.staafId === 9)));
  const rk = kies(P(3.013, 3), { start: S, verworven: [kolom], rasterStap: 0.5, raster: P(3, 3, 0) });
  check("... en bij (3,013; 3) gewoon het rasterpunt, niet 'parallel aan staaf 9'", rk.soort === "raster" && exact(rk.punt, P(3, 3, 0)), json(rk));
  // Het oude voetpunt vanaf (0; 0) op de schijnrichting onder 45° door (6; 0) lag op (3; −3).
  check("... ook geen voetpunt", kies(P(3.01, -3), { start: S, verworven: [kolom] }).soort === "vrij");
  check("een schuine kolom (projectie 500 mm op 8 m: 6 %) geeft wel lijnen",
    spoorLijnen(VLAK_BOVEN, null, [staaf(10, P(6, 0, 0), P(6.5, 0, 8))]).some((l) => l.staafId === 10));
}

log("\n[6] loodrecht op een verworven staaf");
{
  const S = { punt: P(0, 0), knoopId: 1 };
  const s7 = staaf(7, P(4, 0), P(0, 4));
  const v = kies(P(2.03, 2.01), { start: S, verworven: [s7] });
  check("het voetpunt vanaf het beginpunt: precies (2; 2)", v.soort === "voetpunt" && exact(v.punt, P(2, 2, 0)) && v.staafId === 7, json(v));
  const r = kies(P(3, 3.03), { start: S, verworven: [s7] });
  check("de richting loodrecht op staaf 7 door het beginpunt", r.soort === "spoor" && r.lijnen[0].soort === "loodrecht"
    && r.lijnen[0].staafId === 7 && Math.abs(r.punt.x - r.punt.y) < 1e-9 && Math.abs(r.afstand - 3.015 * Math.SQRT2) < 1e-9, json(r));
  check("zonder beginpunt geen loodrecht", kies(P(3, 3.03), { verworven: [s7] }).soort === "vrij");
  const g = kies(P(2.84, 2.86), { start: S, verworven: [s7], rasterStap: 0.5 });
  check("met raster: de afstand vanaf het beginpunt in stappen van 500 mm", g.soort === "spoor" && Math.abs(g.afstand - 4) < 1e-9
    && Math.abs(g.punt.x - 4 / Math.SQRT2) < 1e-9, json(g));
}

log("\n[7] parallel aan een verworven staaf");
{
  const S = { punt: P(0, 0), knoopId: 1 };
  const s3 = staaf(3, P(5, 0), P(8, 4));
  const r = kies(P(3.02, 4), { start: S, verworven: [s3] });
  check("de richting van staaf 3 door het beginpunt", r.soort === "spoor" && r.lijnen[0].soort === "parallel"
    && r.lijnen[0].staafId === 3 && Math.abs(0.8 * r.punt.x - 0.6 * r.punt.y) < 1e-9, json(r));
  const g = kies(P(3.02, 4), { start: S, verworven: [s3], rasterStap: 0.5 });
  check("met raster: 5000 mm vanaf het begin → (3; 4)", g.soort === "spoor" && exact(g.punt, P(3, 4, 0)), json(g.punt));
}

log("\n[8] voorrang");
{
  const stramien = { punt: P(5, 3.05), assen: ["x"] };
  const s = kies(P(5.03, 3.05), { verworven: [A], stramien, instellingen: { ...ALLES, spoor: false } });
  check("objectspoor uit: het stramien", s.soort === "stramien" && exact(s.punt, P(5, 3.05)));
  const sp = kies(P(5.03, 3.05), { verworven: [A], stramien });
  check("spoorlijn gaat voor het stramien; langs de lijn neemt hij de stramienas (x = 5)", sp.soort === "spoor" && exact(sp.punt, P(5, 3, 0)), json(sp));
  const r = kies(P(5.03, 3.2), { verworven: [A], stramien, raster: P(5, 3, 0) });
  check("geen spoor binnen bereik: stramien gaat voor raster", r.soort === "stramien");
  const ra = kies(P(5.03, 3.2), { verworven: [A], raster: P(5, 3, 0) });
  check("dan het raster", ra.soort === "raster" && exact(ra.punt, P(5, 3, 0)));
  check("raster uit in de instellingen: vrij", kies(P(5.03, 3.2), { raster: P(5, 3, 0), instellingen: { ...ALLES, raster: false } }).soort === "vrij");
  check("knoopsnap uit: de knoopkandidaat telt niet", kies(P(6.05, 3.04), { verworven: [A, B], knoop: { id: 8, punt: P(6.02, 3) },
    instellingen: { ...ALLES, knoop: false } }).soort === "snijpunt");
}

log("\n[9] Alt: alle snaps tijdelijk uit");
{
  const alt = { alt: true, shift: false };
  const r = kies(P(6.05, 3.04), { verworven: [A, B], knoop: { id: 8, punt: P(6.02, 3) },
    stramien: { punt: P(6, 3), assen: ["x", "y"] }, raster: P(6, 3, 0), rasterStap: 0.5, toetsen: alt });
  check("met knoop, snijpunt, stramien en raster in de buurt: het muispunt zelf", r.soort === "vrij" && exact(r.punt, P(6.05, 3.04)) && r.alt === true, json(r));
  const o = kies(P(4.23, 1.4), { start: { punt: P(1, 1), knoopId: 1 }, rasterStap: 0.5, raster: P(4, 1.5, 0), toetsen: { alt: true, shift: true } });
  check("Alt + Shift: ortho zonder snap (x = 4,23)", o.soort === "ortho" && o.orthoAs === "x" && exact(o.punt, P(4.23, 1, 0)), json(o));
}

log("\n[10] Shift: ortho langs een globale as in het werkvlak");
{
  const S = { punt: P(1, 1), knoopId: 1 };
  const shift = { alt: false, shift: true };
  const r = kies(P(4.2, 1.4), { start: S, toetsen: shift, rasterStap: 0.5, raster: P(4, 1.5, 0) });
  check("schuin naar rechts: X, de lengte op het raster → (4; 1)", r.soort === "ortho" && r.orthoAs === "x" && exact(r.punt, P(4, 1, 0)), json(r));
  check("zonder raster: (4,2; 1)", exact(kies(P(4.2, 1.4), { start: S, toetsen: shift }).punt, P(4.2, 1, 0)));
  const w = kies(P(3, 3.6), { start: S, toetsen: shift, vorigeOrthoAs: "x" });
  check("hysterese: van X naar Y pas als |dy| > 1,25·|dx| (2,6 > 2,5)", w.orthoAs === "y" && exact(w.punt, P(1, 3.6, 0)), json(w));
  const b = kies(P(3, 3.4), { start: S, toetsen: shift, vorigeOrthoAs: "x" });
  check("... bij 2,4 blijft hij op X", b.orthoAs === "x" && exact(b.punt, P(3, 1, 0)));
  check("zonder vorige as wint de grootste component (Y)", kies(P(3, 3.4), { start: S, toetsen: shift }).orthoAs === "y");
  const v = kies(P(1.2, 0, 4), { start: { punt: P(1, 0, 1), knoopId: 2 }, toetsen: shift, vlak: VLAK_VOOR, naarScherm: VOOR });
  check("vooraanzicht (verticaal tekenen): Z → (1; 0; 4)", v.orthoAs === "z" && exact(v.punt, P(1, 0, 4)), json(v));
  const k = kies(P(6.2, 1.8), { start: S, toetsen: shift, knoop: { id: 9, punt: P(6.3, 2) } });
  check("een knoop in de buurt geeft de maat langs de as (x = 6,3)", k.soort === "ortho" && exact(k.punt, P(6.3, 1, 0)) && k.knoopId === 9, json(k));
  const t = kies(P(3.05, 1.6), { start: S, toetsen: shift, verworven: [knoop(4, P(3, 5))] });
  check("ortho X snijdt de Y-spoorlijn door knoop 4: precies (3; 1)", t.soort === "snijpunt" && exact(t.punt, P(3, 1, 0))
    && json(t.lijnen.map((l) => l.soort).sort()) === json(["ortho", "uitlijnen"]), json(t));
  const n = kies(P(3.05, 1.6), { start: S, toetsen: shift, verworven: [knoop(4, P(3, 5))], instellingen: { ...ALLES, spoor: false } });
  check("objectspoor uit: alleen ortho", n.soort === "ortho" && exact(n.punt, P(3.05, 1, 0)));
  check("zonder beginpunt doet Shift niets", kies(P(4.2, 1.4), { toetsen: shift }).soort === "vrij");
  const schuin = { punt: P(0, 0, 0), normaal: P(1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)) };
  check("een vlak zonder globale as: Shift doet niets", kies(P(1, -1, 0), { start: { punt: P(0, 0, 0) }, toetsen: shift, vlak: schuin }).soort === "vrij");
}

log("\n[11] directe lengte-invoer");
{
  let tekst = null;
  const typ = (...toetsen) => { let laatst; for (const t of toetsen) { laatst = maatToets(tekst, t); tekst = laatst.tekst; } return laatst; };
  typ("4", "5", "0", "0");
  check("4, 5, 0, 0 → 4500", tekst === "4500" && leesMaat(tekst) === 4500);
  typ("Backspace", "Backspace");
  check("Backspace wist een teken", tekst === "45");
  typ(",", "5", ",", ".");
  check("komma wordt decimaalteken; een tweede decimaalteken telt niet", tekst === "45.5" && leesMaat(tekst) === 45.5);
  check("Enter bevestigt", maatToets(tekst, "Enter").actie === "bevestig");
  const esc = maatToets(tekst, "Escape");
  check("Esc wist alleen de getypte maat", esc.actie === "wis" && esc.tekst === null);
  check("Esc zonder getypte maat: niets (het gereedschap stopt dan zoals altijd)", maatToets(null, "Escape").actie === "geen");
  check("Enter of Backspace zonder getypte maat: niets", maatToets(null, "Enter").actie === "geen" && maatToets(null, "Backspace").actie === "geen");
  check("een letter: niets", maatToets("12", "a").actie === "geen" && maatToets("12", "a").tekst === "12");
  check("alles weg met Backspace: geen maat meer", maatToets("4", "Backspace").tekst === null);
  check("punt als eerste teken: ,5 mm", maatToets(null, ".").tekst === "." && leesMaat(".5") === 0.5);
  check("nul, leeg of geen getal: geen maat", [null, "", "0", ".", "0.0"].every((t) => leesMaat(t) === null));
  const e = maatEindpunt(P(1, 1), P(9, 1), 4500);
  check("langs +X: 4500 mm → (5,5; 1) exact", exact(e, P(5.5, 1, 0)), json(e));
  const s = maatEindpunt(P(1, 1), P(5, 4), 4500);
  check("schuin: precies 4500 mm in de richting van de muis", s !== null && Math.abs(Math.hypot(s.x - 1, s.y - 1) - 4.5) < 1e-12
    && Math.abs((s.x - 1) / (s.y - 1) - 4 / 3) < 1e-12, json(s));
  check("verticaal (−Z): exact", exact(maatEindpunt(P(2, 0, 3), P(2, 0, 1), 3000), P(2, 0, 0)));
  check("geen richting (muis op het beginpunt): geen eindpunt", maatEindpunt(P(1, 1), P(1, 1), 4500) === null);
}

log("\n[12] teksten bij de cursor en het maatlabel");
{
  const lees = (taal, ns) => JSON.parse(readFileSync(join(HIER, "src", "i18n", "locales", taal, `${ns}.json`), "utf8"));
  const vertaler = (taal) => {
    const bronnen = { ribbon: lees(taal, "ribbon"), common: lees(taal, "common") };
    return (sleutel, waarden = {}) => {
      const [ns, pad] = sleutel.includes(":") ? sleutel.split(":") : ["ribbon", sleutel];
      const tekst = pad.split(".").reduce((o, k) => o?.[k], bronnen[ns]);
      if (typeof tekst !== "string") return `??${sleutel}`;
      return tekst.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(waarden[k]));
    };
  };
  const nl = vertaler("nl");
  const S = { punt: P(0, 0), knoopId: 1 };
  const tekst = (r) => tekenpuntTekst(r, nl, "nl");
  check("'uitlijnen X met knoop 12 · 3000 mm'", tekst(kies(P(5, 3.05), { verworven: [A] })) === "uitlijnen X met knoop 12 · 3000 mm",
    tekst(kies(P(5, 3.05), { verworven: [A] })));
  check("'verlengen staaf 4 · 1500 mm'", tekst(kies(P(4.5, 0.05), { verworven: [staaf(4, P(0, 0), P(3, 0))] })) === "verlengen staaf 4 · 1500 mm");
  check("'loodrecht op staaf 7 · …'", tekst(kies(P(3, 3.03), { start: S, verworven: [staaf(7, P(4, 0), P(0, 4))] })).startsWith("loodrecht op staaf 7 · "));
  check("voetpunt: 'loodrecht op staaf 7 (voetpunt)'", tekst(kies(P(2.03, 2.01), { start: S, verworven: [staaf(7, P(4, 0), P(0, 4))] })) === "loodrecht op staaf 7 (voetpunt)");
  check("'parallel aan staaf 3 · …'", tekst(kies(P(3.02, 4), { start: S, verworven: [staaf(3, P(5, 0), P(8, 4))] })).startsWith("parallel aan staaf 3 · "));
  const sn = tekst(kies(P(6.05, 3.04), { verworven: [A, B] }));
  check("snijpunt noemt beide lijnen", /^snijpunt: uitlijnen [XY] met knoop (12|5) en uitlijnen [XY] met knoop (12|5)$/.test(sn), sn);
  check("ortho: 'ortho X'", tekst(kies(P(4.2, 1.4), { start: { punt: P(1, 1), knoopId: 1 }, toetsen: { alt: false, shift: true } })) === "ortho X");
  check("Alt: 'snap uit (Alt)'", tekst(kies(P(1, 1), { toetsen: { alt: true, shift: false } })) === nl("openFem3d.spoor.snapUit")
    && nl("openFem3d.spoor.snapUit").includes("Alt"));
  check("knoop, stramien, raster: de naam van de snap", tekst(kies(P(1, 1), { knoop: { id: 3, punt: P(1, 1) } })) === "Knoop"
    && tekst(kies(P(1, 1), { stramien: { punt: P(1, 1), assen: ["x"] } })) === "Stramien" && tekst(kies(P(1, 1), { raster: P(1, 1) })) === "Raster");
  check("een vrij punt: geen tekst", tekst(kies(P(1, 1))) === null);
  const en = vertaler("en");
  check("Engels: 'align X with node 12 · 3000 mm'", tekenpuntTekst(kies(P(5, 3.05), { verworven: [A] }), en, "en") === "align X with node 12 · 3000 mm",
    tekenpuntTekst(kies(P(5, 3.05), { verworven: [A] }), en, "en"));
  const r30 = { x: 4.5 * Math.cos(Math.PI / 6), y: 4.5 * Math.sin(Math.PI / 6), z: 0 };
  check("maatlabel: '4500 mm · 30°'", maatTekst(P(0, 0), r30, P(0, 0, 1), "nl") === "4500 mm · 30°", maatTekst(P(0, 0), r30, P(0, 0, 1), "nl"));
  check("maatlabel met decimalen: nl met komma, en met punt",
    maatTekst(P(0, 0), P(2, 4), P(0, 0, 1), "nl") === "4472,1 mm · 63,4°" && maatTekst(P(0, 0), P(2, 4), P(0, 0, 1), "en") === "4472.1 mm · 63.4°",
    `${maatTekst(P(0, 0), P(2, 4), P(0, 0, 1), "nl")} | ${maatTekst(P(0, 0), P(2, 4), P(0, 0, 1), "en")}`);
  check("verticaal in vooraanzicht: 90°", maatTekst(P(0, 0, 0), P(0, 0, 3), P(0, 1, 0), "nl") === "3000 mm · 90°");
  check("lengte nul: geen maatlabel", maatTekst(P(1, 1), P(1, 1), P(0, 0, 1), "nl") === null);
  check("hele mm zonder decimalen en zonder duizendtalpunt", toonMaatMm(12.5, "nl") === "12500" && toonMaatMm(0.0004, "nl") === "0,4" && toonMaatMm(-0.00001, "nl") === "0");
}

log("\n[13] prestatie: het spoor rekent alleen met verworven punten en staven");
{
  const verworven = [];
  for (let i = 0; i < 4; i += 1) verworven.push(knoop(100 + i, P(i * 1.7, 2.3 * i)));
  for (let i = 0; i < 3; i += 1) verworven.push(staaf(200 + i, P(i, 0), P(i + 2, 3 + i)));
  const start = { punt: P(0.5, 0.5), knoopId: 1 };
  const n = 20000;
  const t0 = performance.now();
  let vangsten = 0;
  for (let i = 0; i < n; i += 1) {
    const c = P((i % 400) * 0.02, Math.floor(i / 400) * 0.02);
    if (kies(c, { start, verworven, rasterStap: 0.5, raster: P(0, 0) }).soort !== "raster") vangsten += 1;
  }
  const ms = (performance.now() - t0) / n;
  check(`7 verworven + beginpunt: gemiddeld ${ms.toFixed(4)} ms per muisstand (< 0,1 ms)`, ms < 0.1);
  check("en er wordt ook echt gevangen", vangsten > 0, String(vangsten));

  // Een hal van de omvang van een stalen hal (972 knopen, 2484 staven) met de
  // echte schermprojectie en snapindex van het tekenvlak: per muisstand de
  // knoopsnap (index) plus het spoor; verwerven na stilstand doorzoekt de
  // staven één keer. (In de browserproef staat de klok stil: virtuele tijd.)
  const THREE = await import("three");
  const { buildOpenFem3DNodeSnapScreenIndex, findOpenFem3DNodeScreenSnap } = await import("./src/components/openFem3d/openFem3dNodeSnapIndex.ts");
  const { findOpenFem3DBeamNearScreenPoint } = await import("./src/components/openFem3d/openFem3dBeamScreenPick.ts");
  const knopen = [], staven = [];
  const id = (i, j, laag) => 1 + laag * 324 + j * 18 + i;
  for (let laag = 0; laag < 3; laag += 1) for (let j = 0; j < 18; j += 1) for (let i = 0; i < 18; i += 1) knopen.push({ id: id(i, j, laag), x: 2 * i, y: 2 * j, z: 4 * laag });
  for (let laag = 0; laag < 3; laag += 1) for (let j = 0; j < 18; j += 1) for (let i = 0; i < 18; i += 1) {
    if (i < 17) staven.push({ id: staven.length + 1, startNodeId: id(i, j, laag), endNodeId: id(i + 1, j, laag) });
    if (j < 17) staven.push({ id: staven.length + 1, startNodeId: id(i, j, laag), endNodeId: id(i, j + 1, laag) });
    if (laag < 2) staven.push({ id: staven.length + 1, startNodeId: id(i, j, laag), endNodeId: id(i, j, laag + 1) });
  }
  const knoopMap = new Map(knopen.map((k) => [k.id, k]));
  const camera = new THREE.PerspectiveCamera(50, 820 / 540, 0.01, 1000);
  camera.up.set(0, 1, 0);
  camera.position.set(13, 13, 38);
  camera.lookAt(13, 13, 8);
  camera.updateMatrixWorld();
  const B = 820, H = 540;
  const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
  const naarScherm = (p) => {
    const w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
    if (!(w > 1e-12)) return null;
    return { x: ((m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12]) / w + 1) * B / 2, y: (1 - (m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13]) / w) * H / 2 };
  };
  const index = buildOpenFem3DNodeSnapScreenIndex(knopen, camera, B, H);
  const hal = [knoop(687, P(4, 4, 8)), knoop(654, P(10, 2, 8)), knoop(705, P(16, 12, 8)), knoop(770, P(26, 20, 8)),
    staaf(1, P(6, 6, 8), P(8, 6, 8)), staaf(2, P(12, 14, 8), P(12, 16, 8)), staaf(3, P(20, 24, 8), P(22, 24, 8))];
  const vlak8 = { punt: P(0, 0, 8), normaal: P(0, 0, 1) };
  const n8 = 4000;
  let spoor = 0;
  const t1 = performance.now();
  for (let i = 0; i < n8; i += 1) {
    const cursor = P(0.5 + (i % 80) * 0.33, 0.5 + Math.floor(i / 80) * 0.5, 8);
    const px = naarScherm(cursor);
    const hit = findOpenFem3DNodeScreenSnap(index, px.x, px.y, 14);
    const r = kiesTekenpunt({ cursor, cursorPx: px, naarScherm, vlak: vlak8, start: { punt: P(0, 0, 8), knoopId: 649 }, verworven: hal,
      instellingen: ALLES, toetsen: { alt: false, shift: false }, knoop: hit ? { id: hit.point.id, punt: knoopMap.get(hit.point.id) } : null,
      stramien: null, raster: P(Math.round(cursor.x * 2) / 2, Math.round(cursor.y * 2) / 2, 8), rasterStap: 0.5 });
    if (r.soort === "spoor" || r.soort === "snijpunt" || r.soort === "voetpunt") spoor += 1;
  }
  const perStand = (performance.now() - t1) / n8;
  check(`hal (972 knopen): knoopsnap + spoor gemiddeld ${perStand.toFixed(4)} ms per muisstand (< 1 ms)`, perStand < 1 && spoor > 0, `spoor ${spoor}×`);
  const t2 = performance.now();
  const keer = 50;
  for (let i = 0; i < keer; i += 1) {
    const px = naarScherm(P(7 + i * 0.01, 6, 8));
    findOpenFem3DBeamNearScreenPoint(staven, knoopMap, camera, B, H, px.x, px.y, 6);
  }
  const verwerven = (performance.now() - t2) / keer;
  check(`hal (2484 staven): verwerven na stilstand ${verwerven.toFixed(3)} ms (< 10 ms, één keer per 0,4 s stilstand)`, verwerven < 10);
}

log("\n[14] de snapinstelling Objectspoor");
{
  const snap = await import("./src/hooks/useSnapInstellingen.ts");
  snap.herstelSnapBeginstand();
  check("standaard aan", snap.leesSnapInstellingen().spoor === true && snap.SNAP_BEGINSTAND.spoor === true);
  check("de 3D-schakelaars: knoop, stramien, raster, objectspoor", json(snap.SNAP_SCHAKELAARS_3D) === json(["knoop", "stramien", "raster", "spoor"]));
  check("de puntsnaps en de 2D-schakelaars blijven zoals ze waren", json(snap.SNAP_SOORTEN) === json(["knoop", "stramien", "raster"])
    && json(snap.SNAP_SCHAKELAARS) === json(["knoop", "stramien", "raster", "hoek"]));
  check("oude opslag zonder de sleutel: aan", snap.snapInstellingenUitOpslag(json({ knoop: false })).spoor === true);
  check("bewaard uit: uit", snap.snapInstellingenUitOpslag(json({ spoor: false })).spoor === false
    && snap.snapInstellingenUitOpslag(json({ spoor: "nee" })).spoor === true);
  snap.wisselSnap("spoor");
  check("wisselen", snap.leesSnapInstellingen().spoor === false);
  snap.zetAlleSnaps(true, snap.SNAP_SCHAKELAARS_3D);
  check("alle 3D-snaps aan zet ook het objectspoor aan", snap.leesSnapInstellingen().spoor === true);
  snap.zetSnap("hoek", false);
  snap.zetAlleSnaps(false, snap.SNAP_SCHAKELAARS_3D);
  const s = snap.leesSnapInstellingen();
  check("alle 3D-snaps uit laat de hoeksnap van 2D staan", !s.knoop && !s.stramien && !s.raster && !s.spoor && s.hoek === false, json(s));
  snap.zetAlleSnaps(true);
  check("alle 2D-schakelaars aan raakt het objectspoor niet", snap.leesSnapInstellingen().spoor === false && snap.leesSnapInstellingen().hoek === true);
  snap.herstelSnapBeginstand();
}

log("\n[15] de bedrading");
{
  const bron = (...pad) => readFileSync(join(HIER, ...pad), "utf8").replace(/\r\n/g, "\n");
  const canvas = bron("src", "components", "openFem3d", "ThreeFrameCanvas.tsx");
  check("het tekenvlak kiest zijn punt met kiesTekenpunt en verwerft met verwerf",
    /from "\.\/openFem3dTekenhulp"/.test(canvas) && /kiesTekenpunt\(\{/.test(canvas) && /verwerf\(/.test(canvas)
    && /SPOOR_VERWERF_MS/.test(canvas));
  check("verwerven zoekt knopen in de snapindex en staven alleen na stilstand",
    /verwerfOnderMuis[\s\S]{0,900}findOpenFem3DNodeScreenSnap\([\s\S]{0,600}findOpenFem3DBeamNearScreenPoint\(/.test(canvas));
  check("Alt en Shift (ook zonder muisbeweging), Backspace, Enter en Esc voor de maat",
    /event\.key === "Alt"/.test(canvas) && /event\.key === "Shift"/.test(canvas) && /maatToets\(/.test(canvas)
    && /maatEindpunt\(/.test(canvas));
  check("aansluiten op een staaf: voetpunt met ratioOpStaaf, een geraakte staaf met staafSplitsing, anders het raakpunt",
    /tekenpunt\?\.soort === "voetpunt"[\s\S]{0,300}ratioOpStaaf\(/.test(canvas) && /const keuze = staafSplitsing\(\{/.test(canvas)
    && /if \(viaRaakpunt\) return opStaaf\(staaf, raakRatio\)/.test(canvas));
  check("een getypte maat vervalt bij elke klik met een tekengereedschap en bij een ander beginpunt",
    /if \(isTekenhulpTool\(activeTool\)\) wisMaat\(\);/.test(canvas) && /tekenStart\(\)\?\.id \?\? null\) !== maatStart/.test(canvas));
  check("het maatlabel wijkt uit voor de tekst bij de cursor", /uitwijking\(maatLabel\.getBoundingClientRect\(\), previewHint\.getBoundingClientRect\(\)/.test(canvas));
  check("knoop, staaf, plaat- en openingsomtrek en belastingvlak tekenen met de tekenhulp",
    /const isTekenhulpTool = \(tool: OpenFem3DTool\) => tool === "addNode" \|\| tool === "addBeam"\s*\|\| isPlateSketchTool\(tool\) \|\| isOpeningTool\(tool\)/.test(canvas));
  const app = bron("src", "App.tsx");
  check("App: de snapknopjes in de statusbalk ook in 3D, met het objectspoor",
    /toonSnap=\{\(!isFullWidthView && modelDimension === "2d"\) \|\| activeView === "openFem3d"\}/.test(app)
    && /snapSchakelaars=\{activeView === "openFem3d" \? SNAP_SCHAKELAARS_3D : SNAP_SOORTEN\}/.test(app));
  const statusbalk = bron("src", "components", "StatusBar.tsx");
  check("statusbalk: de schakelaars komen uit de prop snapSchakelaars", /snapSchakelaars\.map\(/.test(statusbalk));
  const tab = bron("src", "components", "fem", "ExplorerViewTab.tsx");
  check("tab Weergave: in 3D een rij Objectspoor en 'alle' over de 3D-schakelaars",
    /workspace === "2d" \? SNAP_SCHAKELAARS : SNAP_SCHAKELAARS_3D/.test(tab) && /zetSnap\("spoor", value\)/.test(tab));
  const { SNELTOETSEN_3D } = await import("./src/api/dekking.ts");
  check("dekking: Alt, Shift, Backspace, komma en punt staan erin (tekenhulp, geen commando)",
    ["Alt", "Shift", "Backspace", ",", "."].every((k) => SNELTOETSEN_3D[k] && "fase" in SNELTOETSEN_3D[k]));
  for (const taal of ["nl", "en", "de", "fr"]) {
    const lees = (ns) => JSON.parse(bron("src", "i18n", "locales", taal, `${ns}.json`));
    const c = lees("common"), r = lees("ribbon");
    const nodig = [c.snap?.spoor, c.statusBar?.snapExplain?.spoor, c.zichtbaarheid?.spoorHint,
      ...["uitlijnen", "uitlijnenBegin", "verlengen", "loodrecht", "voetpunt", "parallel", "snijpunt", "ortho", "snapUit"]
        .map((k) => r.openFem3d?.spoor?.[k])];
    check(`teksten in het ${taal}`, nodig.every((t) => typeof t === "string" && t.length > 0), json(nodig));
  }
}

log("\n[16] de vangzone loodrecht in beeld, ook in een schuin aanzicht");
{
  // Een echte perspectiefcamera (fov 50, z omhoog) zoals in het tekenvlak; de
  // cursor ligt d px loodrecht in beeld naast de X-lijn door knoop 5 (y = 3),
  // bij het punt Q. Het werkvlak is peil 0.
  const THREE = await import("three");
  const B = 820, H = 540;
  const camera = (positie, doel) => {
    const cam = new THREE.PerspectiveCamera(50, B / H, 0.01, 1000);
    cam.up.set(0, 0, 1);
    cam.position.set(...positie);
    cam.lookAt(...doel);
    cam.updateMatrixWorld();
    const m = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
    const naarScherm = (p) => {
      const w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
      if (!(w > 1e-12)) return null;
      return { x: ((m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12]) / w + 1) * B / 2, y: (1 - (m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13]) / w) * H / 2 };
    };
    const straal = new THREE.Raycaster();
    const vlak = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const naarWerkvlak = (px) => {
      straal.setFromCamera(new THREE.Vector2(px.x / B * 2 - 1, 1 - px.y / H * 2), cam);
      const v = straal.ray.intersectPlane(vlak, new THREE.Vector3());
      return v ? P(v.x, v.y, v.z) : null;
    };
    return { naarScherm, naarWerkvlak };
  };
  /** Het schermpunt d px loodrecht naast de beeldlijn door Q in de richting `richting`. */
  const naastLijn = (cam, q, richting, d) => {
    const s = cam.naarScherm(q), s2 = cam.naarScherm(P(q.x + 0.1 * richting.x, q.y + 0.1 * richting.y, q.z));
    const l = Math.hypot(s2.x - s.x, s2.y - s.y);
    return { x: s.x - d * (s2.y - s.y) / l, y: s.y + d * (s2.x - s.x) / l };
  };
  const K5 = knoop(5, P(2, 3));
  const proef = (cam, q, d) => {
    const cursorPx = naastLijn(cam, q, P(1, 0), d);
    const cursor = cam.naarWerkvlak(cursorPx);
    const r = kiesTekenpunt({ cursor, cursorPx, naarScherm: cam.naarScherm, vlak: VLAK_BOVEN, start: null, verworven: [K5],
      instellingen: ALLES, toetsen: { alt: false, shift: false }, knoop: null, stramien: null, raster: null, rasterStap: null });
    // Het punt van de lijn onder de cursor: in beeld het voetpunt (Q).
    const inBeeld = r.soort === "spoor" ? Math.hypot(cam.naarScherm(r.punt).x - cam.naarScherm(q).x, cam.naarScherm(r.punt).y - cam.naarScherm(q).y) : NaN;
    return { r, inBeeld };
  };
  const iso = camera([4 + 1.4 * 8, 3 - 1.4 * 8, 8], [4, 3, 0]);
  for (const d of [5, 7, 7.9]) {
    const { r, inBeeld } = proef(iso, P(5, 3), d);
    check(`iso: ${d} px loodrecht in beeld naast de X-lijn → spoor, y exact 3, het punt in beeld onder de cursor (${inBeeld.toFixed(4)} px)`,
      r.soort === "spoor" && r.punt.y === 3 && r.punt.z === 0 && inBeeld < 0.01, json(r.punt));
  }
  check("iso: 8,5 px ernaast → geen spoor", proef(iso, P(5, 3), 8.5).r.soort === "vrij");
  // Laag en schuin (azimut 45°): het voetpunt in de wereld lag hier in beeld
  // 10 tot 33 px van de cursor, bij 3 tot 7 px echte afstand.
  for (const [graden, d] of [[15, 5], [15, 7], [5, 3], [5, 6]]) {
    const h = graden * Math.PI / 180;
    const laag = camera([4.3 + 10 * Math.cos(h) * Math.SQRT1_2, 3 - 10 * Math.cos(h) * Math.SQRT1_2, 10 * Math.sin(h)], [4.3, 3, 0]);
    const { r, inBeeld } = proef(laag, P(4.3, 3), d);
    check(`elevatie ${graden}°, ${d} px loodrecht in beeld → spoor (vroeger vrij), het punt onder de cursor (${inBeeld.toFixed(4)} px)`,
      r.soort === "spoor" && r.punt.y === 3 && inBeeld < 0.01, json(r));
  }
  // Shift in iso: het ortho-punt is het voetpunt in beeld, niet in de wereld.
  const cursorPx = naastLijn(iso, P(4, 1), P(1, 0), 20);
  const cursor = iso.naarWerkvlak(cursorPx);
  const o = kiesTekenpunt({ cursor, cursorPx, naarScherm: iso.naarScherm, vlak: VLAK_BOVEN, start: { punt: P(1, 1), knoopId: 1 }, verworven: [],
    instellingen: ALLES, toetsen: { alt: false, shift: true }, knoop: null, stramien: null, raster: null, rasterStap: null });
  check("iso met Shift: ortho X, het punt in beeld recht onder de cursor (x = 4)", o.soort === "ortho" && o.orthoAs === "x"
    && o.punt.y === 1 && Math.abs(o.punt.x - 4) < 1e-6, json(o.punt));
}

log("\n[17] aansluiten op een bestaande staaf");
{
  const a = P(4.25, 0), b = P(4.25, 3);
  check("ratioOpStaaf: op de as", ratioOpStaaf(P(4.25, 1.5), a, b) === 0.5);
  check("ratioOpStaaf: een eind", ratioOpStaaf(P(4.25, 3), a, b) === 1 && ratioOpStaaf(P(4.25, 0), a, b) === 0);
  check("ratioOpStaaf: 0,2 mm naast de as, of op de verlenging: geen plek op de staaf",
    ratioOpStaaf(P(4.2502, 1.5), a, b) === null && ratioOpStaaf(P(4.25, 3.5), a, b) === null);
  // De staaf in aanbouw begint op knoop 3 (0; 1,3); de cursor 1 px naast de
  // as van staaf 1, iets onder de X-lijn door het beginpunt.
  const start = { punt: P(0, 1.3), knoopId: 3 };
  const cursor = P(4.26, 1.25);
  const tp = kies(cursor, { start, rasterStap: 0.5, raster: P(4.5, 1.5, 0) });
  check("het tekenpunt (spoor, de vrije maat op het raster) ligt naast staaf 1: (4,5; 1,3)", tp.soort === "spoor" && exact(tp.punt, P(4.5, 1.3, 0)), json(tp));
  const basis = { vlak: VLAK_BOVEN, a, b, cursorPx: BOVEN(cursor), naarScherm: BOVEN };
  const s = staafSplitsing({ ...basis, punt: tp.punt, lijnen: tp.lijnen });
  check("de geraakte staaf splitst op het snijpunt van de spoorlijn met de staaf: (4,25; 1,3), ratio 1,3/3",
    s?.via === "lijn" && exact(s.punt, P(4.25, 1.3, 0)) && Math.abs(s.ratio - 1.3 / 3) < 1e-12, json(s));
  const vrij = kies(cursor, { start, instellingen: { ...ALLES, raster: false } });
  const sv = staafSplitsing({ ...basis, punt: vrij.punt, lijnen: vrij.lijnen });
  check("raster uit: ook daar (het tekenpunt lag 10 mm naast de staaf)", vrij.soort === "spoor" && sv?.via === "lijn" && exact(sv.punt, P(4.25, 1.3, 0)), json(sv));
  const o = kies(cursor, { start, toetsen: { alt: false, shift: true }, rasterStap: 0.5 });
  const so = staafSplitsing({ ...basis, punt: o.punt, lijnen: o.lijnen });
  check("Shift: het snijpunt van de ortholijn met de staaf", o.soort === "ortho" && so?.via === "lijn" && exact(so.punt, P(4.25, 1.3, 0)), json(so));
  const op = staafSplitsing({ ...basis, punt: P(4.25, 1.3, 0), lijnen: tp.lijnen });
  check("ligt het tekenpunt op de staaf: precies daar", op?.via === "punt" && exact(op.punt, P(4.25, 1.3, 0)));
  check("een getypte maat naast de staaf (geen lijnen): geen splitsing (de maat blijft exact)",
    staafSplitsing({ ...basis, punt: P(4.5, 1.3), lijnen: [] }) === null);
  const yLijn = { soort: "uitlijnen", oorsprong: P(4.5, 0, 0), richting: P(0, 1, 0), as: "y" };
  check("een lijn evenwijdig aan de staaf: geen snijpunt", staafSplitsing({ ...basis, punt: P(4.5, 1.3), lijnen: [yLijn] }) === null);
  const xHoog = { soort: "uitlijnen", oorsprong: P(0, 3.5, 0), richting: P(1, 0, 0), as: "x" };
  check("het snijpunt voorbij het eind van de staaf: geen", snijpuntLijnStaaf(xHoog, VLAK_BOVEN, a, b) === null);
  check("het snijpunt ver van de cursor (> 12 px): geen",
    staafSplitsing({ ...basis, cursorPx: BOVEN(P(4.26, 2.5)), punt: P(4.5, 1.3), lijnen: tp.lijnen }) === null);
  const hoog = snijpuntLijnStaaf(tp.lijnen[0], VLAK_BOVEN, P(4.25, 0, 3), P(4.25, 3, 3));
  check("een staaf op een ander level: het punt op de staaf zelf (z = 3)", hoog !== null && gelijkPunt(hoog.punt, P(4.25, 1.3, 3), 1e-12), json(hoog));
  // Loodrecht op staaf 1 (0; 0)–(6; 0) vanaf (2,3; 3,7): het voetpunt ligt op de staaf.
  const voet = kies(P(2.3, -0.06), { start: { punt: P(2.3, 3.7), knoopId: 3 }, verworven: [staaf(1, P(0, 0), P(6, 0))] });
  check("voetpunt 6 px naast staaf 1: op de staaf, ratio 2,3/6", voet.soort === "voetpunt" && voet.staafId === 1
    && Math.abs(ratioOpStaaf(voet.punt, P(0, 0), P(6, 0)) - 2.3 / 6) < 1e-12, json(voet));
  // Op de verlenging valt het voetpunt samen met het snijpunt van verlengen en
  // loodrecht (dat voorgaat); het ligt niet op de staaf, dus geen splitsing.
  const verlengd = kies(P(7.06, 0), { start: { punt: P(7, 3), knoopId: 3 }, verworven: [staaf(1, P(0, 0), P(6, 0))] });
  check("voetpunt op de verlenging (7; 0): geen plek op de staaf (niet splitsen)", exact(verlengd.punt, P(7, 0, 0))
    && ratioOpStaaf(verlengd.punt, P(0, 0), P(6, 0)) === null, json(verlengd));
}

log("\n[18] het maatlabel wijkt uit voor de tekst bij de cursor");
{
  const raakt = (p, q, marge = 0) => p.left < q.right + marge && p.right > q.left - marge && p.top < q.bottom + marge && p.bottom > q.top - marge;
  const schuif = (r, u) => ({ left: r.left + u.dx, right: r.right + u.dx, top: r.top + u.dy, bottom: r.bottom + u.dy });
  // Gemeten bij een staaf van 1118 mm schuin omhoog: label over 'Raster'.
  const label = { left: 282, top: 322, right: 368, bottom: 339 }, tekst = { left: 345, top: 323, right: 386, bottom: 341 };
  const u = uitwijking(label, tekst, 3);
  check("overlappend: de kleinste verschuiving (19 px omhoog), daarna 3 px vrij", raakt(label, tekst)
    && u.dx === 0 && u.dy === -19 && !raakt(schuif(label, u), tekst, 2.999), json(u));
  const v = uitwijking({ left: 100, top: 100, right: 180, bottom: 117 }, { left: 170, top: 90, right: 230, bottom: 140 }, 3);
  check("een hoge tekst ernaast: opzij (13 px naar links)", v.dx === -13 && v.dy === 0, json(v));
  check("niet overlappend: niet verschuiven", json(uitwijking({ left: 0, top: 0, right: 50, bottom: 15 }, { left: 60, top: 0, right: 90, bottom: 15 }, 3)) === json({ dx: 0, dy: 0 }));
}

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
if (gefaald > 0) process.exit(1);

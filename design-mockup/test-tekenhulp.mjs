// Tekenhulpen op het 2D-tekenvlak (#53): Shift als ortho en de hoeksnap bij
// het tekenen van een staaf. De rekenregels staan in src/lib/tekenhulp.ts;
// het tekenvlak roept ze alleen aan. Daarnaast: de bewaarde snapinstellingen
// (hoeksnap aan/uit, tolerantie, extra hoeken) en de plek in FemCanvas en de
// tab Weergave.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const {
  orthoPunt, hoekSnap, hoekSnapHoeken, hoekPuntOpRaster, leesHoekTolerantie, begrensHoekTolerantie,
  ORTHO_WISSEL_FACTOR, HOEKSNAP_STANDAARD_TOLERANTIE, HOEKSNAP_MIN_TOLERANTIE, HOEKSNAP_MAX_TOLERANTIE,
} = await import("./src/lib/tekenhulp.ts");
const HIER = dirname(fileURLToPath(import.meta.url));
let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => { if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); } };
const rad = (graden) => graden * Math.PI / 180;
const punt = (start, lengte, graden) => ({ x: start.x + lengte * Math.cos(rad(graden)), z: start.z + lengte * Math.sin(rad(graden)) });
const lengte = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
const json = (v) => JSON.stringify(v);

log("[1] hoeksnap: 0° en 90° met de standaardtolerantie");
const basis = hoekSnapHoeken(false);
const start = { x: 1000, z: 2000 };
{
  const p = punt(start, 5000, 0.3);
  const r = hoekSnap(start, p, HOEKSNAP_STANDAARD_TOLERANTIE, basis);
  check("0,3° boven horizontaal wordt exact horizontaal (z = z van het begin)", r !== null && r.punt.z === start.z && r.hoekGraden === 0, json(r));
  check("... met dezelfde lengte", r !== null && Math.abs(lengte(start, r.punt) - 5000) < 1e-9, json(r));
}
{
  const p = punt(start, 4000, 90.3);
  const r = hoekSnap(start, p, HOEKSNAP_STANDAARD_TOLERANTIE, basis);
  check("0,3° uit het lood wordt exact verticaal (x = x van het begin), zelfde lengte",
    r !== null && r.punt.x === start.x && r.hoekGraden === 90 && Math.abs(r.punt.z - (start.z + 4000)) < 1e-9, json(r));
}
check("de standaardtolerantie is 2°", HOEKSNAP_STANDAARD_TOLERANTIE === 2);
check("binnen de tolerantie (1,9°) vangt hij", hoekSnap(start, punt(start, 3000, 1.9), 2, basis)?.hoekGraden === 0);
check("buiten de tolerantie (2,1°) niets", hoekSnap(start, punt(start, 3000, 2.1), 2, basis) === null);
check("halverwege (20°) niets", hoekSnap(start, punt(start, 3000, 20), 2, basis) === null);
check("een kleinere tolerantie (0,1°) laat 0,3° vrij", hoekSnap(start, punt(start, 3000, 0.3), 0.1, basis) === null);

log("\n[2] negatieve richtingen en spiegelingen");
for (const [graden, verwacht] of [[179.6, 180], [180.4, 180], [-0.4, 0], [270.2, 270], [-89.7, 270]]) {
  const r = hoekSnap(start, punt(start, 2500, graden), 2, basis);
  const exact = verwacht % 180 === 0 ? r?.punt.z === start.z : r?.punt.x === start.x;
  check(`${graden}° → ${verwacht}°, exact op de as, lengte gelijk`,
    r !== null && r.hoekGraden === verwacht && exact && Math.abs(lengte(start, r.punt) - 2500) < 1e-9, json(r));
}
{
  const r = hoekSnap(start, punt(start, 2500, 179.6), 2, basis);
  check("naar links blijft naar links (x kleiner dan het begin)", r !== null && r.punt.x < start.x && Math.abs(r.punt.x - (start.x - 2500)) < 1e-9);
}

log("\n[3] 30°, 45° en 60° alleen met de extra hoeken");
const extra = hoekSnapHoeken(true);
check("de basishoeken zijn 0° en 90°", json(basis) === json([0, 90]), json(basis));
check("met de extra hoeken: 0°, 30°, 45°, 60°, 90°", json(extra) === json([0, 30, 45, 60, 90]), json(extra));
check("44,5° zonder extra hoeken: niets", hoekSnap(start, punt(start, 3000, 44.5), 2, basis) === null);
{
  const r = hoekSnap(start, punt(start, 3000, 44.5), 2, extra);
  check("44,5° met extra hoeken: 45°, zelfde lengte",
    r !== null && r.hoekGraden === 45 && Math.abs(lengte(start, r.punt) - 3000) < 1e-9
    && Math.abs((r.punt.x - start.x) - (r.punt.z - start.z)) < 1e-9, json(r));
}
for (const [graden, verwacht] of [[134.2, 135], [-45.5, 315], [31, 30], [148.8, 150], [-60.4, 300], [59.1, 60], [-119.5, 240]]) {
  const r = hoekSnap(start, punt(start, 1800, graden), 2, extra);
  check(`${graden}° → ${verwacht}° (spiegelingen)`, r?.hoekGraden === verwacht, json(r));
}
check("de dichtstbijzijnde hoek wint (tolerantie 15°: 40° → 45°, niet 30°)", hoekSnap(start, punt(start, 1000, 40), 15, extra)?.hoekGraden === 45);

log("\n[4] lengte nul en ongeldige invoer");
check("eindpunt gelijk aan het begin: niets", hoekSnap(start, { ...start }, 2, basis) === null);
check("tolerantie 0: niets", hoekSnap(start, punt(start, 1000, 0.3), 0, basis) === null);
check("NaN in het punt: niets", hoekSnap(start, { x: NaN, z: 0 }, 2, basis) === null);
check("lege hoekenlijst: niets", hoekSnap(start, punt(start, 1000, 0.3), 2, []) === null);

log("\n[5] hoekpunt op het raster");
{
  // Begin (0, 0), rasterpunt (5000, 100): 1,15° — de hoeksnap draait naar
  // (5001,0) en het raster legt hem terug op x = 5000.
  const o = { x: 0, z: 0 };
  const r = hoekSnap(o, { x: 5000, z: 100 }, 2, basis);
  check("rasterpunt 1,15° boven horizontaal vangt op 0°", r?.hoekGraden === 0, json(r));
  const p = hoekPuntOpRaster(o, r, 100);
  check("horizontaal: x op het raster, z van het begin", json(p) === json({ x: 5000, z: 0 }), json(p));
  const s = { x: 1234, z: 0 };
  const r2 = hoekSnap(s, { x: 6200, z: 100 }, 2, basis);
  const p2 = hoekPuntOpRaster(s, r2, 100);
  check("begin buiten het raster: x op het raster (6200), z van het begin", json(p2) === json({ x: 6200, z: 0 }), json(p2));
  const r3 = hoekSnap(o, { x: -100, z: -4000 }, 2, basis);
  const p3 = hoekPuntOpRaster(o, r3, 100);
  check("verticaal naar beneden: z op het raster, x van het begin", r3?.hoekGraden === 270 && json(p3) === json({ x: 0, z: -4000 }), json(p3));
  // Schuin (45°): het dichtstbijzijnde rasterpunt dat exact op de straal ligt.
  // (3500, 3600) ligt op 45,8°; gedraaid (3550,4; 3550,4), en het rasterpunt
  // op de straal daarbij is (3600, 3600) — niet een afgeronde lengte, want een
  // veelvoud van de rasterstap maal √2 is geen rasterpunt.
  const r4 = hoekSnap(o, { x: 3500, z: 3600 }, 2, extra);
  const p4 = hoekPuntOpRaster(o, r4, 100);
  check("schuin (45°): het rasterpunt op de straal (3600, 3600)",
    r4?.hoekGraden === 45 && json(p4) === json({ x: 3600, z: 3600 }), json(p4));
  const kort = hoekSnap(o, { x: 40, z: 1 }, 2, basis);
  const pk = hoekPuntOpRaster(o, kort, 100);
  check("zou het raster het punt op het begin leggen, dan blijft het gedraaide punt",
    pk.z === 0 && Math.abs(pk.x - Math.hypot(40, 1)) < 1e-9, json(pk));
  check("zonder rasterstap: ongewijzigd", json(hoekPuntOpRaster(o, r, 0)) === json(r.punt));
}

log("\n[5b] een punt dat al op de hoek ligt, blijft (raster 500, extra hoeken)");
{
  const o = { x: 0, z: 0 };
  for (const [x, z] of [[1000, 1000], [2000, 2000], [3000, 3000], [-1500, 1500], [2500, -2500]]) {
    const r = hoekSnap(o, { x, z }, 2, extra);
    const p = r && hoekPuntOpRaster(o, r, 500);
    check(`(${x}, ${z}) ligt al op ${r?.hoekGraden}° en blijft precies (${x}, ${z})`,
      r !== null && r.hoekGraden % 45 === 0 && json(r.punt) === json({ x, z }) && json(p) === json({ x, z }), json(p));
  }
  const r0 = hoekSnap(o, { x: 4000, z: 0 }, 2, basis);
  check("langs een as: (4000, 0) komt ongewijzigd terug", json(r0?.punt) === json({ x: 4000, z: 0 }), json(r0));
  // Zonder raster: geen afrondingsruis op een punt dat al op 45° ligt.
  const r1 = hoekSnap({ x: 0.1, z: 0.2 }, { x: 1000.1, z: 1000.2 }, 2, extra);
  check("zonder raster: (1000,1; 1000,2) vanaf (0,1; 0,2) blijft hetzelfde punt", json(r1?.punt) === json({ x: 1000.1, z: 1000.2 }), json(r1));
  // Een rasterpunt net naast 45°: naar het rasterpunt op de straal, niet ernaast.
  const r2 = hoekSnap(o, { x: 3000, z: 2900 }, 2, extra);
  check("(3000, 2900) bij 44,0° wordt het rasterpunt op de straal (3000, 3000)",
    json(hoekPuntOpRaster(o, r2, 100)) === json({ x: 3000, z: 3000 }), json(r2));
  // 30°: geen rasterpunt op de straal; dan de lengte op de rasterstap, en het
  // punt afgerond (z = 3000, niet 2999,9999999999995).
  const r3 = hoekSnap(o, { x: 5000, z: 3000 }, 2, extra);
  const p3 = hoekPuntOpRaster(o, r3, 500);
  check("(5000, 3000) bij 30°: lengte 6000, z precies 3000",
    r3?.hoekGraden === 30 && p3.z === 3000 && Math.abs(lengte(o, p3) - 6000) < 1e-5 && Math.abs(p3.x - 5196.152423) < 1e-9, json(p3));
  // 45° vanaf een beginpunt naast het raster: geen rasterpunt op de straal →
  // lengte op de rasterstap, richting blijft 45°.
  const s = { x: 1234, z: 0 };
  const r5 = hoekSnap(s, { x: 4000, z: 2800 }, 2, extra);
  const p5 = hoekPuntOpRaster(s, r5, 500);
  check("45° vanaf (1234, 0): lengte 4000, richting 45°",
    r5?.hoekGraden === 45 && Math.abs(lengte(s, p5) - 4000) < 1e-5 && Math.abs((p5.x - s.x) - (p5.z - s.z)) < 1e-5, json(p5));
}

log("\n[6] ortho: as uit de grootste component, met hysterese");
const o = { x: 0, z: 0 };
{
  const r = orthoPunt(o, { x: 1000, z: 300 }, null);
  check("zonder vorige as: grootste component (x) → horizontaal, z van het begin", r.as === "x" && json(r.punt) === json({ x: 1000, z: 0 }), json(r));
  const v = orthoPunt(o, { x: -200, z: -900 }, null);
  check("negatieve richting: verticaal naar beneden, x van het begin", v.as === "z" && json(v.punt) === json({ x: 0, z: -900 }), json(v));
}
check("de wisselfactor is 1,25", ORTHO_WISSEL_FACTOR === 1.25);
{
  // Vorige as x: z moet duidelijk groter zijn voordat hij wisselt.
  check("as x, z iets groter (1,1×): blijft x", orthoPunt(o, { x: 1000, z: 1100 }, "x").as === "x");
  check("as x, z 1,2×: blijft x", orthoPunt(o, { x: 1000, z: 1200 }, "x").as === "x");
  check("as x, z 1,3×: wisselt naar z", orthoPunt(o, { x: 1000, z: 1300 }, "x").as === "z");
  check("as z, x 1,2×: blijft z", orthoPunt(o, { x: -1200, z: 1000 }, "z").as === "z");
  check("as z, x 1,3×: wisselt naar x", orthoPunt(o, { x: -1300, z: 1000 }, "z").as === "x");
  // Vlak bij het begin: ook het minimumverschil moet gehaald zijn.
  check("dicht bij het begin (verschil kleiner dan het minimum): blijft", orthoPunt(o, { x: 1, z: 3 }, "x", 5).as === "x");
  check("met genoeg verschil: wisselt", orthoPunt(o, { x: 1, z: 8 }, "x", 5).as === "z");
  // Heen en weer langs de diagonaal: geen springen.
  let as = null; const assen = [];
  for (const [x, z] of [[1000, 900], [1000, 1050], [1000, 980], [1000, 1100], [1000, 1240], [1000, 1260], [1050, 1000], [1240, 1000], [1300, 1000]]) {
    as = orthoPunt(o, { x, z }, as, 5).as; assen.push(as);
  }
  check("langs de diagonaal wisselt hij pas na 1,25×", assen.join("") === "xxxxxzzzx", assen.join(""));
  const nul = orthoPunt(o, { x: 0, z: 0 }, null);
  check("cursor op het begin: geen fout, punt is het begin", json(nul.punt) === json(o) && (nul.as === "x" || nul.as === "z"), json(nul));
  check("cursor op het begin met vorige as z: blijft z", orthoPunt(o, { x: 0, z: 0 }, "z").as === "z");
}

log("\n[7] tolerantie invoeren");
check("grenzen 0,1° en 15°", HOEKSNAP_MIN_TOLERANTIE === 0.1 && HOEKSNAP_MAX_TOLERANTIE === 15);
check("komma en punt: '2,5' en '2.5' zijn 2,5", leesHoekTolerantie("2,5") === 2.5 && leesHoekTolerantie("2.5") === 2.5);
check("met graadteken en spaties", leesHoekTolerantie(" 3 ° ") === 3);
check("onder het minimum wordt 0,1", leesHoekTolerantie("0,01") === 0.1);
check("boven het maximum wordt 15", leesHoekTolerantie("40") === 15);
check("geen getal, leeg, nul of negatief: null", ["abc", "", "0", "-2", "1,2,3"].every((t) => leesHoekTolerantie(t) === null));
check("begrenzen: NaN wordt de standaard", begrensHoekTolerantie(NaN) === 2 && begrensHoekTolerantie(99) === 15 && begrensHoekTolerantie(0.05) === 0.1);

log("\n[8] snapinstellingen: hoeksnap, tolerantie en extra hoeken");
{
  const snap = await import("./src/hooks/useSnapInstellingen.ts");
  snap.herstelSnapBeginstand();
  const s0 = snap.leesSnapInstellingen();
  check("beginstand: hoeksnap aan, 2°, extra hoeken uit", s0.hoek === true && s0.hoekTolerantie === 2 && s0.hoekExtra === false, json(s0));
  check("de puntsnaps blijven knoop, stramien, raster (3D en statusbalk ongewijzigd)", json(snap.SNAP_SOORTEN) === json(["knoop", "stramien", "raster"]));
  check("de schakelaars zijn de puntsnaps plus hoek", json(snap.SNAP_SCHAKELAARS) === json(["knoop", "stramien", "raster", "hoek"]));
  snap.zetSnap("hoek", false);
  check("hoeksnap uit", snap.leesSnapInstellingen().hoek === false);
  snap.zetHoekTolerantie(40);
  check("tolerantie begrensd op 15", snap.leesSnapInstellingen().hoekTolerantie === 15);
  snap.zetHoekExtra(true);
  check("extra hoeken aan", snap.leesSnapInstellingen().hoekExtra === true);
  snap.zetAlleSnaps(true);
  check("alle snapsoorten aan zet ook de hoeksnap aan", snap.leesSnapInstellingen().hoek === true);
  snap.zetAlleSnaps(false, snap.SNAP_SOORTEN);
  const s1 = snap.leesSnapInstellingen();
  check("alle puntsnaps uit (3D) laat de hoeksnap staan", !s1.knoop && !s1.stramien && !s1.raster && s1.hoek, json(s1));
  // Sinds #55 draagt de stand ook de verbindingstolerantie (mm, standaard 5);
  // die heeft zijn eigen test in test-verbindingstolerantie. Sinds #84 ook het
  // objectspoor van 3D (standaard aan, ook in een oude stand zonder de
  // sleutel); dat heeft zijn eigen test in test-open-fem3d-tekenhulp. Sinds
  // #63 ook "knopen op staven aansluiten" in 3D (standaard aan, ook in een
  // oude stand zonder de sleutel); zie test-open-fem3d-aansluiten.
  check("opslag: de stand gaat als JSON mee", typeof snap.snapInstellingenUitOpslag === "function"
    && json(snap.snapInstellingenUitOpslag(json({ knoop: false, hoek: false, hoekTolerantie: 3.5, hoekExtra: true })))
      === json({ knoop: false, stramien: true, raster: true, hoek: false, spoor: true, hoekTolerantie: 3.5, hoekExtra: true,
        verbindingsTolerantie: 5, knopenAansluiten: true }));
  check("opslag: kapotte of vreemde waarden vallen terug op de beginstand",
    json(snap.snapInstellingenUitOpslag("{kapot")) === json(snap.SNAP_BEGINSTAND)
    && snap.snapInstellingenUitOpslag(json({ hoekTolerantie: "veel", raster: "ja" })).hoekTolerantie === 2
    && snap.snapInstellingenUitOpslag(json({ hoekTolerantie: 99 })).hoekTolerantie === 15
    && snap.snapInstellingenUitOpslag(json({ raster: "ja" })).raster === true);
  snap.herstelSnapBeginstand();
}

log("\n[8b] snapinstellingen: bewaard in localStorage en bij een nieuwe start weer geladen");
{
  // Onder Node bestaat localStorage niet; een stub zoals die van de browser.
  const SLEUTEL = "open-fem-studio.snapInstellingen";
  const opslag = new Map();
  globalThis.localStorage = {
    getItem: (k) => (opslag.has(k) ? opslag.get(k) : null),
    setItem: (k, v) => { opslag.set(k, String(v)); },
    removeItem: (k) => { opslag.delete(k); },
  };
  let teller = 0;
  // Een nieuwe start van het venster: de module opnieuw laden (eigen URL).
  const verseModule = () => import(`./src/hooks/useSnapInstellingen.ts?start=${++teller}`);
  try {
    const snap = await import("./src/hooks/useSnapInstellingen.ts");
    snap.zetHoekTolerantie(3.5);
    snap.zetHoekExtra(true);
    snap.zetSnap("raster", false);
    const bewaard = JSON.parse(opslag.get(SLEUTEL) ?? "null");
    check("een wijziging gaat als JSON onder 'open-fem-studio.snapInstellingen'",
      bewaard?.hoekTolerantie === 3.5 && bewaard?.hoekExtra === true && bewaard?.raster === false, json(bewaard));
    const vers = await verseModule();
    const s = vers.leesSnapInstellingen();
    check("een nieuwe start laadt tolerantie 3,5°, extra hoeken en raster uit",
      s.hoekTolerantie === 3.5 && s.hoekExtra === true && s.raster === false && s.knoop === true && s.hoek === true, json(s));
    opslag.set(SLEUTEL, "{kapot");
    check("kapotte opslag: een nieuwe start begint met de beginstand",
      json((await verseModule()).leesSnapInstellingen()) === json(snap.SNAP_BEGINSTAND));
    globalThis.localStorage = { getItem: () => { throw Error("geblokkeerd"); }, setItem: () => { throw Error("geblokkeerd"); } };
    const geblokkeerd = await verseModule();
    geblokkeerd.zetHoekTolerantie(4);
    check("geblokkeerde opslag: beginstand, en wijzigen werkt deze sessie wel",
      geblokkeerd.leesSnapInstellingen().hoekTolerantie === 4 && geblokkeerd.leesSnapInstellingen().raster === true);
    snap.herstelSnapBeginstand();
  } finally {
    delete globalThis.localStorage;
  }
}

log("\n[9] het tekenvlak en de tab Weergave gebruiken de tekenhulp");
const lees = (...pad) => readFileSync(join(HIER, "src", ...pad), "utf8").replace(/\r\n/g, "\n");
const canvas = lees("components", "fem", "FemCanvas.tsx");
check("FemCanvas importeert orthoPunt, hoekSnap en hoekPuntOpRaster uit lib/tekenhulp",
  /import \{[^}]*orthoPunt[^}]*\} from "\.\.\/\.\.\/lib\/tekenhulp"/.test(canvas)
  && /hoekSnap\(/.test(canvas) && /hoekPuntOpRaster\(/.test(canvas));
check("Alt zet de snap tijdelijk uit, Shift is ortho (HUD-teksten)",
  /canvas\.hud\.snapOff/.test(canvas) && /canvas\.hud\.ortho/.test(canvas));
check("R-draaien houdt Shift als vrij draaien", /snap: !e\.shiftKey/.test(canvas));
const tab = lees("components", "fem", "ExplorerViewTab.tsx");
check("de tab Weergave heeft een rij Hoek met tolerantie en extra hoeken",
  /zetHoekTolerantie/.test(tab) && /zetHoekExtra/.test(tab) && /snap\.hoek/.test(tab));
for (const taal of ["nl", "en", "de", "fr"]) {
  const c = JSON.parse(lees("i18n", "locales", taal, "common.json"));
  const nodig = [c.snap?.hoek, c.zichtbaarheid?.hoekTolerantie, c.zichtbaarheid?.hoekExtra, c.zichtbaarheid?.hoekHint,
    c.canvas?.hud?.snapOff, c.canvas?.hud?.ortho];
  check(`teksten in het ${taal}`, nodig.every((t) => typeof t === "string" && t.length > 0), json(nodig));
}

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
if (gefaald > 0) process.exit(1);

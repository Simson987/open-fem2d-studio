// Kaderselectie zoals in CAD (lib/kaderSelectie.ts), gedeeld door het 2D- en
// het 3D-tekenvlak: van links naar rechts een venster (alleen wat er geheel
// in valt), van rechts naar links een crossing (alles wat het kader raakt).
// Plus de Escape-regel (lib/escapeToets.ts) en de bronteksten die beide
// tekenvlakken en de thematokens eraan koppelen.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const {
  kaderModus, kaderUitPunten, puntInKader, lijnstukRaaktKader, puntInVeelhoek,
  driehoekRaaktKader, veelhoekRaaktKader, selecteerInKader,
} = await import("./src/lib/kaderSelectie.ts");
const { escapeActie, isInvoerVeld, volgDialoogBijToets } = await import("./src/lib/escapeToets.ts");

const HIER = dirname(fileURLToPath(import.meta.url));
let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => { if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); } };
const P = (x, y) => ({ x, y });
const K = { left: 100, top: 100, right: 200, bottom: 160 };

log("[1] sleeprichting en kader");
check("naar rechts gesleept → venster", kaderModus(50, 300) === "venster");
check("naar links gesleept → crossing", kaderModus(300, 50) === "crossing");
check("verticaal gesleept (geen x-verschil) → venster", kaderModus(80, 80) === "venster");
const zelfdeKader = (a, b) => ["left", "top", "right", "bottom"].every((k) => a[k] === b[k]);
check("kader uit twee hoeken, in elke richting gelijk",
  zelfdeKader(kaderUitPunten(P(200, 160), P(100, 100)), K) && zelfdeKader(kaderUitPunten(P(100, 160), P(200, 100)), K));
check("rand hoort bij het kader", puntInKader(P(100, 160), K) && !puntInKader(P(99.999, 130), K));

log("\n[2] lijnstuk tegen kader (Liang–Barsky)");
check("dwars erdoor, beide einden buiten", lijnstukRaaktKader(P(0, 130), P(400, 130), K));
check("schuin door een hoek", lijnstukRaaktKader(P(90, 90), P(110, 110), K));
check("geheel binnen", lijnstukRaaktKader(P(120, 120), P(180, 150), K));
check("één eind binnen", lijnstukRaaktKader(P(150, 130), P(500, 700), K));
check("raakt alleen de rand", lijnstukRaaktKader(P(0, 100), P(400, 100), K));
check("evenwijdig erlangs, net ernaast", !lijnstukRaaktKader(P(0, 99), P(400, 99), K));
check("schuin langs een hoek, zonder te raken", !lijnstukRaaktKader(P(180, 0), P(260, 99), K));
// y = 0,6 x + 20 gaat door (100, 80)–(200, 140): raakt het kader over x ∈ [133,3; 200].
check("schuin: snijdt de bovenrand", lijnstukRaaktKader(P(0, 20), P(300, 200), K));
// y = 64 + 0,98 x kruist de onderrand y = 160 bij x = 97,96.
check("schuin: mist het kader net langs de hoek, raakt het iets verder", !lijnstukRaaktKader(P(0, 64), P(100, 162), { left: 99, top: 100, right: 200, bottom: 160 })
  && lijnstukRaaktKader(P(0, 64), P(100, 162), { left: 97, top: 100, right: 200, bottom: 160 }));
check("puntlijnstuk binnen/buiten", lijnstukRaaktKader(P(150, 150), P(150, 150), K) && !lijnstukRaaktKader(P(50, 50), P(50, 50), K));

log("\n[3] veelhoek en driehoek");
const vierkant = [P(0, 0), P(400, 0), P(400, 400), P(0, 400)];
const gat = [P(90, 90), P(210, 90), P(210, 170), P(90, 170)];
check("punt in veelhoek (even-oneven)", puntInVeelhoek(P(10, 10), vierkant) && !puntInVeelhoek(P(-1, 10), vierkant));
check("kader geheel binnen een plaat → raakt", veelhoekRaaktKader(vierkant, [], K));
check("kader geheel binnen een opening → raakt de plaat niet", !veelhoekRaaktKader(vierkant, [gat], K));
check("kader over de rand van de opening → raakt", veelhoekRaaktKader(vierkant, [[P(150, 90), P(300, 90), P(300, 300), P(150, 300)]], K));
check("plaat geheel binnen het kader → raakt", veelhoekRaaktKader([P(120, 120), P(140, 120), P(140, 140)], [], K));
check("plaat naast het kader → raakt niet", !veelhoekRaaktKader([P(300, 300), P(350, 300), P(350, 350)], [], K));
check("driehoek over het kader heen (geen hoek binnen)", driehoekRaaktKader(P(0, 0), P(1000, 0), P(0, 1000), K));
check("driehoek met alleen een rand erdoor", driehoekRaaktKader(P(150, 0), P(160, 0), P(155, 400), K));
check("driehoek ernaast", !driehoekRaaktKader(P(300, 0), P(400, 0), P(350, 90), K));

log("\n[4] selectie per modus");
// Staaf 1 loopt door het kader (einden buiten), staaf 2 ligt er geheel in,
// staaf 3 ligt ernaast. Plaat 7 overlapt het kader, plaat 8 ligt erin.
const elementen = {
  knopen: [
    { id: 1, p: P(50, 130) }, { id: 2, p: P(300, 130) },
    { id: 3, p: P(120, 110) }, { id: 4, p: P(180, 150) },
    { id: 5, p: P(300, 300) }, { id: 6, p: P(400, 300) },
  ],
  staven: [
    { id: 1, a: P(50, 130), b: P(300, 130) },
    { id: 2, a: P(120, 110), b: P(180, 150) },
    { id: 3, a: P(300, 300), b: P(400, 300) },
  ],
  platen: [
    { id: 7, rand: [P(180, 140), P(260, 140), P(260, 260), P(180, 260)] },
    { id: 8, rand: [P(110, 105), P(130, 105), P(130, 125)] },
  ],
};
const venster = selecteerInKader(elementen, K, "venster");
const crossing = selecteerInKader(elementen, K, "crossing");
check("venster: knopen binnen", JSON.stringify(venster.knoopIds) === "[3,4]", JSON.stringify(venster.knoopIds));
check("venster: alleen de staaf die er geheel in ligt", JSON.stringify(venster.staafIds) === "[2]", JSON.stringify(venster.staafIds));
check("venster: alleen de plaat die er geheel in ligt", JSON.stringify(venster.plaatIds) === "[8]", JSON.stringify(venster.plaatIds));
check("crossing: dezelfde knopen", JSON.stringify(crossing.knoopIds) === "[3,4]");
check("crossing: ook de staaf die erdoor loopt, niet die ernaast", JSON.stringify(crossing.staafIds) === "[1,2]", JSON.stringify(crossing.staafIds));
check("crossing: ook de overlappende plaat", JSON.stringify(crossing.plaatIds) === "[7,8]", JSON.stringify(crossing.plaatIds));

log("\n[5] Escape: eerst uit het gereedschap, dan de selectie weg");
check("tekengereedschap → terug naar Selecteren (selectie blijft)", escapeActie("addBeam", true) === "naarSelecteren");
check("3D-transformatie (Verplaatsen) → terug naar Selecteren", escapeActie("move", true) === "naarSelecteren");
check("oplegging plaatsen, zonder selectie → terug naar Selecteren", escapeActie("support:fixed", false) === "naarSelecteren");
check("Selecteren met selectie → selectie opheffen", escapeActie("select", true) === "selectieOpheffen");
check("Selecteren zonder selectie → niets", escapeActie("select", false) === "niets");
check("invoerveld, tekstvak, keuzelijst en bewerkbaar element: niet van het tekenvlak",
  ["INPUT", "TEXTAREA", "SELECT"].every((tagName) => isInvoerVeld({ tagName }))
  && isInvoerVeld({ tagName: "DIV", isContentEditable: true }));
check("knop, canvas en document wel", !isInvoerVeld({ tagName: "BUTTON" }) && !isInvoerVeld({ tagName: "CANVAS" }) && !isInvoerVeld(null));
{
  // Een dialoog die bij Escape zelf sluit (op het document) is bij een echte
  // toetsaanslag al weg vóór de luisteraar op window; de vangfase legt de
  // stand van vóór de toets vast.
  const venster = new EventTarget();
  let dialoogOpen = true;
  const dialoog = volgDialoogBijToets(() => dialoogOpen, venster);
  let gezien = null;
  venster.addEventListener("keydown", () => { dialoogOpen = false; gezien = dialoog.open(); });
  venster.dispatchEvent(new Event("keydown"));
  check("Escape die een dialoog sluit, telt voor het tekenvlak nog als 'dialoog open'", gezien === true);
  venster.dispatchEvent(new Event("keydown"));
  check("… de volgende toets niet meer", gezien === false);
  dialoog.stop();
  dialoogOpen = true;
  venster.dispatchEvent(new Event("keydown"));
  check("stop() haalt de vanger weg: de stand van vóór de toets wordt niet meer vastgelegd", gezien === false);
}

log("\n[6] bedrading in de bron");
const lees = (...pad) => readFileSync(join(HIER, ...pad), "utf8").replace(/\r\n/g, "\n");
const canvas2d = lees("src", "components", "fem", "FemCanvas.tsx");
check("2D: de kaderselectie gebruikt selecteerInKader met de sleeprichting",
  /kaderModus\(boxSelect\.startSX, boxSelect\.endSX\)[\s\S]{0,400}selecteerInKader\(/.test(canvas2d));
check("2D: het rubberen kader krijgt de modus als klasse en data-modus",
  /data-modus=\{modus\}[\s\S]{0,120}fem-box-select\$\{modus === "crossing" \? " crossing" : ""\}/.test(canvas2d));
check("2D: Escape via escapeActie; de selectie blijft bij het verlaten van een gereedschap",
  /escapeActie\(tool, selection !== null\)[\s\S]{0,160}naarSelecteren[\s\S]{0,60}onToolChange\?\.\("select"\)[\s\S]{0,80}selectieOpheffen[\s\S]{0,40}setSelection\(null\)/.test(canvas2d));
check("2D: grab/rotate/getypte staaflengte vangen Escape nog vóór de algemene regel",
  canvas2d.indexOf('if (e.key === "Escape") { e.preventDefault(); cancelGrab(); return; }') < canvas2d.indexOf("escapeActie(tool")
  && canvas2d.indexOf('if (e.key === "Escape" && beamLengte !== null)') < canvas2d.indexOf("escapeActie(tool"));
check("2D: Delete en Backspace verwijderen de selectie (ook een plaat)", /e\.key === "Delete" \|\| e\.key === "Backspace"[\s\S]{0,80}deleteSelected\(\)/.test(canvas2d));
const canvas3d = lees("src", "components", "openFem3d", "ThreeFrameCanvas.tsx");
check("3D: Escape niet in invoervelden of onder een dialoog (stand van vóór de toets)",
  /volgDialoogBijToets\(erIsEenDialoogOpen\)[\s\S]{0,300}isInvoerVeld\(event\.target\) \|\| dialog\.open\(\)/.test(canvas3d)
  && /dialog\.stop\(\)/.test(canvas3d));
check("2D: de dialoogtoets gebruikt ook de stand van vóór de toets",
  /if \(dialoog\.open\(\)\) return;/.test(canvas2d) && /const dialoog = volgDialoogBijToets\(erIsEenDialoogOpen\)/.test(canvas2d)
  && /dialoog\.stop\(\)/.test(canvas2d));
check("3D: Escape zet het gereedschap terug of heft de selectie op",
  /escapeActie\(toolRef\.current, selectionRef\.current !== null\)[\s\S]{0,1500}toolChangeRef\.current\?\.\("select"\)[\s\S]{0,80}selectRef\.current\(null\)/.test(canvas3d));
const editor3d = lees("src", "components", "openFem3d", "OpenFem3DEditor.tsx");
check("3D-editor geeft onToolChange door aan het tekenvlak", /onToolChange=\{onToolChange\}/.test(editor3d));
check("3D-editor: Delete verwijdert de selectie, niet in invoervelden",
  /event\.key === "Delete"[\s\S]{0,200}isInvoerVeld\(event\.target\) \|\| erIsEenDialoogOpen\(\)[\s\S]{0,120}deleteSelectionRef\.current\(\)/.test(editor3d));

log("\n[7] thematokens: venster doorgetrokken, crossing gestippeld, in elk thema");
// Ontwerp 0.4 (OpenAEC Blueprint): het thema hangt aan `data-oa-theme`, de vijf
// thema's zijn light, dark, blueprint, high-contrast-dark en high-contrast-light
// (2026.42: light, forge, openaec, blueprint, contrast). De tokens worden per
// thema uitgerekend zoals de browser dat doet (scripts/thema-tokens.mjs), dus
// ook een waarde die via `var(--…-light)` binnenkomt telt.
const themes = lees("src", "themes.css");
const { THEMAS, themaTokens } = await import("./scripts/thema-tokens.mjs");
const kader = Object.fromEntries(THEMAS.map((t) => [t, themaTokens(t)]));
const kleur = (thema, naam) => kader[thema].get(`--theme-select-${naam}`);
for (const thema of THEMAS) {
  check(`thema ${thema}: vier selectietokens`,
    ["window-stroke", "window-fill", "crossing-stroke", "crossing-fill"].every((t) => kleur(thema, t)));
}
const donkereThemas = THEMAS.filter((t) => kader[t].get("color-scheme") === "dark");
check("er zijn donkere thema's (dark, blueprint, high-contrast-dark)", donkereThemas.length === 3, donkereThemas.join(", "));
for (const thema of donkereThemas) {
  check(`donker thema ${thema}: andere kaderkleuren dan op een licht vlak`,
    kleur(thema, "window-stroke") !== "#2563EB" && kleur(thema, "crossing-stroke") !== "#16A34A");
}
check("venster en crossing hebben een andere kleur, in elk thema",
  THEMAS.every((t) => kleur(t, "window-stroke") !== kleur(t, "crossing-stroke")));
check("licht vlak (licht thema en 3D-podium): vaste waarden", /--theme-select-window-stroke-light:\s*#2563EB/.test(themes) && /--theme-select-crossing-fill-light:/.test(themes));
const css2d = lees("src", "components", "fem", "FemCanvas.css");
check("2D-kader: venster zonder streepjes, crossing gestippeld, beide via tokens",
  /\.fem-box-select \{[^}]*stroke: var\(--theme-select-window-stroke\)[^}]*\}/.test(css2d)
  && !/\.fem-box-select \{[^}]*stroke-dasharray/.test(css2d)
  && /\.fem-box-select\.crossing \{[^}]*stroke: var\(--theme-select-crossing-stroke\)[^}]*stroke-dasharray/.test(css2d));
const css3d = lees("src", "components", "openFem3d", "OpenFem3DEditor.css");
check("3D-kader: doorgetrokken venster, gestippelde crossing via tokens",
  /\.open-fem3d-selection-box \{[^}]*border: 1px solid var\(--theme-select-window-stroke\)/.test(css3d)
  && /\.open-fem3d-selection-box\[data-modus="crossing"\] \{[^}]*border-style: dashed[^}]*var\(--theme-select-crossing-stroke\)/.test(css3d));
check("3D-podium (altijd wit) neemt de kaderkleuren voor een licht vlak",
  /\.open-fem3d-stage \{[^}]*--theme-select-window-stroke: var\(--theme-select-window-stroke-light\)/.test(css3d));

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

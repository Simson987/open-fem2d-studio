// Pijlen van een lijnlast op het 2D-tekenvlak: een vaste h.o.h.-afstand in
// plaats van een vast aantal per staaf. Een korte staaf liep vol met pijlen en
// op een lange staaf vielen gaten. De afstand wordt gemeten bij passend beeld,
// zodat in- en uitzoomen het aantal pijlen niet verandert (#101).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const { lijnlastPijlIntervallen, LIJNLAST_PIJL_HOH_PX: H } = await import("./src/lib/lijnlastPijlen.ts");
const HIER = dirname(fileURLToPath(import.meta.url));
let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => { if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); } };

log("[1] afstand tussen de pijlen");
let slechtste = { min: Infinity, max: 0 };
for (let lengte = H / 2; lengte <= 2000; lengte += 0.5) {
  const n = lijnlastPijlIntervallen(lengte);
  const hoh = lengte / n;
  slechtste = { min: Math.min(slechtste.min, hoh), max: Math.max(slechtste.max, hoh) };
}
check(`vanaf een halve h.o.h. ligt de afstand tussen ${H / 2} en ${1.5 * H} px`,
  slechtste.min >= H / 2 - 1e-9 && slechtste.max <= 1.5 * H + 1e-9, JSON.stringify(slechtste));
check("een lange staaf krijgt pijlen naar rato (600 px → 25 intervallen)", lijnlastPijlIntervallen(600) === 25);
check("een korte staaf houdt alleen zijn twee eindpijlen (10 px → 1 interval)", lijnlastPijlIntervallen(10) === 1);
check("ongeldige invoer geeft één interval", [0, -5, NaN, Infinity].every((v) => lijnlastPijlIntervallen(v) === 1));

log("\n[2] het tekenvlak gebruikt de vaste afstand, gemeten bij passend beeld (#101)");
const canvas = readFileSync(join(HIER, "src", "components", "fem", "FemCanvas.tsx"), "utf8");
check("lijnlast op een staaf en randlast op een plaat rekenen het aantal pijlen in modelmaat × de schaal van passend beeld",
  (canvas.match(/const N = lijnlastPijlIntervallen\(Math\.hypot\(sdx, sdy\) \* pijlSchaal\);/g) ?? []).length === 2,
  "verwacht twee keer: lijnlastPijlIntervallen(Math.hypot(sdx, sdy) * pijlSchaal)");
check("pijlSchaal = passend beeld / huidige zoom, met passendBeeldSchaal",
  /const pijlSchaal = fitSchaal !== null \? fitSchaal \/ view\.scale : 1;/.test(canvas)
  && /passendBeeldSchaal\(/.test(canvas));
check("Passend beeld (knop en toets F) gebruikt dezelfde schaal",
  (canvas.match(/passendBeeldSchaal\(/g) ?? []).length >= 3);
check("het oude vaste aantal (8 per volle lengte) is weg", !/Math\.round\(8 \* \(bF - aF\)\)/.test(canvas));

log("\n[3] één label per keten van gelijke lijnlasten");
const { verborgenLijnlastLabels } = await import("./src/lib/lijnlastLabels.ts");
const knopen = [{ id: 1, x: 0, z: 0 }, { id: 2, x: 1100, z: 0 }, { id: 3, x: 2200, z: 0 }, { id: 4, x: 3300, z: 0 }, { id: 5, x: 3300, z: 2000 }];
const staven = [{ id: 1, from: 1, to: 2 }, { id: 2, from: 2, to: 3 }, { id: 3, from: 3, to: 4 }, { id: 4, from: 4, to: 5 }];
const last = (id, beamId, extra = {}) => ({ id, beamId, caseId: 1, q: -0.1, trapezium: false, qDir: "z", qCoord: "global", startFrac: 0, endFrac: 1, stapelOffset: 0, ...extra });
const drie = verborgenLijnlastLabels([last(11, 1), last(12, 2), last(13, 3)], staven, knopen);
check("drie staven op één lijn met dezelfde last: alleen de middelste houdt het label",
  JSON.stringify([...drie].sort()) === "[11,13]", JSON.stringify([...drie]));
check("een andere waarde is een eigen keten",
  verborgenLijnlastLabels([last(11, 1), last(12, 2, { q: -0.2 })], staven, knopen).size === 0);
check("een ander belastinggeval is een eigen keten",
  verborgenLijnlastLabels([last(11, 1), last(12, 2, { caseId: 2 })], staven, knopen).size === 0);
check("een hoek (staaf 3 → 4) is geen keten",
  verborgenLijnlastLabels([last(13, 3), last(14, 4)], staven, knopen).size === 0);
check("een deellast, trapezium of gestapelde band houdt zijn eigen label",
  verborgenLijnlastLabels([last(11, 1), last(12, 2, { endFrac: 0.5 })], staven, knopen).size === 0
  && verborgenLijnlastLabels([last(11, 1), last(12, 2, { trapezium: true, q: undefined })], staven, knopen).size === 0
  && verborgenLijnlastLabels([last(11, 1), last(12, 2, { stapelOffset: 30 })], staven, knopen).size === 0);
check("het tekenvlak slaat het label van de verborgen lasten over (alleen bij de lijnlast op een staaf)",
  (canvas.match(/\{verborgenLabels\.has\(l\.id\) \? null : isTrap \? \(/g) ?? []).length === 1
  && /const verborgenLabels = verborgenLijnlastLabels\(/.test(readFileSync(join(HIER, "src", "components", "fem", "FemCanvas.tsx"), "utf8")));

log("\n[4] de schaal van passend beeld");
const { passendBeeldSchaal } = await import("./src/lib/lijnlastPijlen.ts");
const grenzen = { min: 1 / 200, max: 1 / 2 };
const portaal = [{ x: 0, z: 0 }, { x: 6000, z: 0 }, { x: 6000, z: 4000 }, { x: 0, z: 4000 }];
// 10% marge rondom: 1000 × 600 px bruikbaar → 800/6000 en 480/4000; de kleinste telt.
check("het hele model met 10% marge, de krapste richting telt",
  Math.abs(passendBeeldSchaal(portaal, { w: 1000, h: 600 }, grenzen) - 480 / 4000) < 1e-12,
  String(passendBeeldSchaal(portaal, { w: 1000, h: 600 }, grenzen)));
check("begrensd tot de zoomgrenzen",
  passendBeeldSchaal([{ x: 0, z: 0 }, { x: 1e7, z: 0 }], { w: 1000, h: 600 }, grenzen) === grenzen.min
  && passendBeeldSchaal([{ x: 0, z: 0 }, { x: 1, z: 0 }], { w: 1000, h: 600 }, grenzen) === grenzen.max);
check("geen knopen of geen ruimte: null",
  passendBeeldSchaal([], { w: 1000, h: 600 }, grenzen) === null
  && passendBeeldSchaal(portaal, { w: 0, h: 600 }, grenzen) === null
  && passendBeeldSchaal(portaal, { w: 1000, h: -5 }, grenzen) === null);
// Het aantal pijlen hangt alleen van de modelmaat en passend beeld af: bij passend
// beeld is het gelijk aan de oude schermregel, bij elke andere zoom ook.
const fit = passendBeeldSchaal(portaal, { w: 1000, h: 600 }, grenzen);
const aantal = (lengteMm, zoom) => lijnlastPijlIntervallen(lengteMm * zoom * (fit / zoom));
check("een staaf van 6 m: zelfde aantal bij passend beeld, ingezoomd en uitgezoomd",
  [fit, fit * 4, fit / 3].every((zoom) => aantal(6000, zoom) === lijnlastPijlIntervallen(6000 * fit)));
check("korte en lange staven naar rato (1 m tegen 6 m)",
  lijnlastPijlIntervallen(1000 * fit) < lijnlastPijlIntervallen(6000 * fit)
  && Math.abs(lijnlastPijlIntervallen(6000 * fit) / lijnlastPijlIntervallen(1000 * fit) - 6) <= 2);

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

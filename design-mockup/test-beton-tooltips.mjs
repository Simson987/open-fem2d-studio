// Het betonprofielvenster: uitleg staat achter een (i)-icoon bij het veld waar
// hij over gaat, niet als lopende tekst onder de velden. Alleen de waarschuwing
// dat de dwarskrachttoets zonder s en n niet draait, blijft (kort) zichtbaar,
// en bij zijstaven blijft zichtbaar hoeveel er in de doorsnede liggen.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HIER = dirname(fileURLToPath(import.meta.url));
let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => { if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); } };
const lees = (...p) => readFileSync(join(HIER, ...p), "utf8").replace(/\r\n/g, "\n");

const korf = lees("src", "components", "beton", "KorfVelden.tsx");
const kiezer = lees("src", "components", "fem", "ProfielKiezer.tsx");

log("[1] korf");
check("Getal, GetalOptioneel en Rij kunnen een (i)-uitleg tonen",
  (korf.match(/\{info && <InfoTip id=\{`\$\{id\}-info`\}>\{info\}<\/InfoTip>\}/g) ?? []).length === 3);
check("de hoek van de beugels staat in de tooltip bij Beugel",
  /t\("concrete\.cage\.stirrup"\)\}<InfoTip[^>]*>\{t\("concrete\.cage\.stirrupAngleHint"\)\}<\/InfoTip>/.test(korf));
check("s_t en f_ywk: uitleg in de tooltip van hun veld",
  /info=\{<>\s*s<sub>t<\/sub> \{t\("concrete\.cage\.stEmptyAllowed"\)\}/.test(korf) && /info=\{<>f<sub>ywk<\/sub> \{t\("concrete\.cage\.fywkEmpty"\)\}<\/>\}/.test(korf));
const hints = [...korf.matchAll(/className="beton-hint">\s*([^\n]*)/g)].map((m) => m[1]);
check("als lopende tekst blijft alleen de foutmelding van de dekkingstoets over",
  hints.length === 1 && /coverCheckFailed/.test(hints[0]), JSON.stringify(hints));
check("milieuklasse en per zijde: uitleg in een tooltip",
  korf.includes('exposureClass")}<InfoTip id={`${idPrefix}-milieuklasse-info`}>') && korf.includes("<InfoTip id={`${idPrefix}-zijden-info`}>"));
check("de waarschuwing zonder s en n blijft zichtbaar, de achtergrond in een tooltip",
  /className="beton-waarschuwing" role="note">\s*\{t\("concrete\.cage\.noShearCheck"\)\}\s*<InfoTip/.test(korf));
check("zijstaven: het aantal in de doorsnede blijft zichtbaar, de uitleg in de tooltip",
  /sideBarsTotal", \{ n: 2 \* zijstaafRij\(korf\)\.count \}\)\}<\/strong>/.test(korf)
  && /info=\{zijstaafRij\(korf\)\.count > 0\s*\? hoofdletter\(t\("concrete\.cage\.sideBarsHint"\)/.test(korf)
  && /: t\("concrete\.cage\.noSideBarsHint"\)\}/.test(korf));

log("\n[2] profielkiezer");
check("A_c, I_y,c en E_cm: uitleg achter het (i) bij A_c", /<span>A_c<InfoTip id="pk-ongescheurd-info">/.test(kiezer));
check("… en niet meer als tekst onder de waarden", !/className="pk-hint">\s*A<sub>c<\/sub>/.test(kiezer));

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

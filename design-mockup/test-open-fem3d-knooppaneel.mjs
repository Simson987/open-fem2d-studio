// Het knooppaneel van de 3D-module (oplegging, veren, opgelegde verplaatsing,
// knooplast): vinkjes werken direct, veren en opgelegde waarden worden bij het
// verlaten van het veld weggeschreven, en een veer blijft staan als alle
// vinkjes uit gaan.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const M = await import("./src/components/openFem3d/openFem3dModel.ts");
const HIER = dirname(fileURLToPath(import.meta.url));
let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => { if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); } };

log("[1] modelregels achter het paneel");
const basis = M.parseOpenFem3DModel({ nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 3 }], beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA 200", material: "S235" }] });
const metVeer = M.setOpenFem3DSupportSprings(basis, 1, { kzKnPerM: 20000 });
const allesUit = M.setOpenFem3DSupport(metVeer, 1, { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false });
check("alle vinkjes uit met een veer: de oplegging (met veer) blijft", allesUit.supports?.[0]?.springs?.kzKnPerM === 20000);
const uzVast = M.setOpenFem3DSupport(metVeer, 1, { ux: false, uy: false, uz: true, rx: false, ry: false, rz: false });
check("een richting vastzetten haalt de veer op die richting weg", uzVast.supports?.[0]?.springs?.kzKnPerM === undefined && uzVast.supports?.[0]?.uz === true);
check("Vrij verwijdert de oplegging", (M.removeOpenFem3DSupport(uzVast, 1).supports ?? []).length === 0);
check("de actieve standaardoplegging is herkenbaar", M.openFem3DSupportPresetOf(M.OPEN_FEM_3D_SUPPORT_PRESETS.fixed) === "fixed"
  && M.openFem3DSupportPresetOf({ ux: true, uy: false, uz: true, rx: false, ry: false, rz: false }) === "custom");

log("\n[2] het paneel");
const bron = readFileSync(join(HIER, "src", "components", "openFem3d", "OpenFem3DNodeConditions.tsx"), "utf8").replace(/\r\n/g, "\n");
const css = readFileSync(join(HIER, "src", "components", "openFem3d", "OpenFem3DNodeConditions.css"), "utf8").replace(/\r\n/g, "\n");
check("een vinkje werkt direct (geen knop Toepassen)", /onChange=\{\(event\) => pasRichtingenToe\(/.test(bron) && !/t\("openFem3d\.apply"\)/.test(bron));
check("alles uit zonder veer of opgelegde waarde = geen oplegging", /!vast && !heeftVeerOfOpgelegd\s*\?\s*removeOpenFem3DSupport/.test(bron));
check("veren en opgelegde verplaatsingen: wegschrijven bij het verlaten van het veld",
  /onBlur=\{bevestigVeren\}/.test(bron) && /onBlur=\{bevestigOpgelegd\}/.test(bron));
check("… en alleen als er echt iets veranderde (geen lege stap in ongedaan maken)",
  /gelijkeWaarden\(support\?\.springs, springs\)\) return/.test(bron) && /gelijkeWaarden\(support\?\.prescribed, prescribed\)\) return/.test(bron));
check("geen losse knoppen voor veren en verplaatsingen meer", !/Veren toepassen|Verplaatsingen toepassen/.test(bron));
check("de actieve standaardoplegging licht op", /aria-pressed=\{actievePreset === preset\}/.test(bron));
check("eigen klassenamen (geen botsing met de aslabels van het tekenvlak)",
  !/open-fem3d-axis-/.test(bron) && !/\.open-fem3d-axis-/.test(css) && /\.open-fem3d-nc-label \{/.test(css));
check("lange namen breken niet af maar lopen door", /\.open-fem3d-nc-presets button \{[\s\S]{0,400}white-space: normal;/.test(css));
check("… tussen woorden, nooit midden in een woord (geen \"Inklemmin-g\")",
  /\.open-fem3d-nc-presets button \{[\s\S]{0,500}overflow-wrap: normal;/.test(css) && !/overflow-wrap: anywhere/.test(css));
check("de lastlijst toont afgeronde waarden met eenheid, geen ruwe floats",
  /new Intl\.NumberFormat\(locale, \{ maximumFractionDigits: 3 \}\)/.test(bron) && /"kN" : "kNm"/.test(bron)
  && /describeLoad\(load, i18n\.language\)/.test(bron));
check("de invoervelden tonen 6 significante cijfers",
  /String\(Number\(load\[axis\]\.toPrecision\(6\)\)\)/.test(bron));

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

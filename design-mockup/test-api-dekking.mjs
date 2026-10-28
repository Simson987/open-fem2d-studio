// Dekking van de 3D-bediening door de API (src/api/dekking.ts): elke functie
// van de 3D-editor wijst naar een commando dat bestaat, of naar een latere
// fase met een reden. De lijsten worden hier tegen de bediening zelf gelegd:
//
//   [1] elke dekking is geldig: het commando bestaat, het genoemde invoerveld
//       staat in zijn schema, een fase is 2, 3 of 4 met een reden (fase 1, het
//       3D-model, is af: daar wacht niets meer op);
//   [2] het 3D-lint wordt getekend (HomeTab in 3D, i18n in cimode, dus met de
//       labelsleutels): elke knop staat in LINT_3D, en LINT_3D noemt geen
//       knop die er niet is;
//   [3] de knoppen van het eigenschappenpaneel en zijn onderdelen, gelezen
//       uit de bron: idem tegen PANEEL_3D;
//   [4] de sneltoetsen: de toetsreeksen van lib/commandoReeks.ts en de
//       toetsen die de editor, het tekenvlak en de app afvangen;
//   [5] de gereedschappen en de modelvelden: hun volledigheid bewaakt de
//       typecontrole (`satisfies` in dekking.ts, `npx tsc --noEmit`); hier
//       alleen dat de lijsten er zijn.
//
// Uitvoeren: npx tsx test-api-dekking.mjs   (vanuit design-mockup/)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const bron = (pad) => readFileSync(join(HIER, pad), "utf8");

const { GEREEDSCHAP_3D, LINT_3D, VELDEN_3D, PANEEL_3D, SNELTOETSEN_3D } = await import("./src/api/dekking.ts");
const { standaardRegister } = await import("./src/api/standaardRegister.ts");
const { COMMANDO_REEKSEN, DIRECTE_COMMANDO_S } = await import("./src/lib/commandoReeks.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
/** Wat in `a` staat en niet in `b`. */
const zonder = (a, b) => [...a].filter((x) => !b.has(x));

// ── Schema's ────────────────────────────────────────────────────────────────

const catalogus = new Map(standaardRegister().catalogus().map((c) => [c.naam, c]));

/** De schema's waar een veld in kan staan: door oneOf en de items van een lijst heen. */
function alternatieven(schema) {
  if (!schema || typeof schema !== "object") return [];
  if (Array.isArray(schema.oneOf)) return schema.oneOf.flatMap(alternatieven);
  if (schema.type === "array") return alternatieven(schema.items);
  return [schema];
}

/** Staat het veld (met punten: dieper) in het invoerschema? */
function heeftVeld(schema, pad) {
  let huidig = [schema];
  for (const deel of pad.split(".")) {
    huidig = huidig.flatMap(alternatieven).map((s) => s.properties?.[deel]).filter(Boolean);
    if (huidig.length === 0) return false;
  }
  return true;
}

function probleem(d) {
  if (!d || typeof d !== "object") return "geen dekking";
  if ("commando" in d) {
    for (const naam of Array.isArray(d.commando) ? d.commando : [d.commando]) {
      const commando = catalogus.get(naam);
      if (!commando) return `commando ${naam} bestaat niet`;
      if ("veld" in d && !heeftVeld(commando.invoer, d.veld)) return `${naam} heeft geen invoerveld ${d.veld}`;
    }
    return null;
  }
  if ("fase" in d) return [2, 3, 4].includes(d.fase) && typeof d.reden === "string" && d.reden.trim() ? null : `fase ${d.fase} zonder geldige reden`;
  if ("afgeleid" in d) return typeof d.afgeleid === "string" && d.afgeleid.trim() ? null : "afgeleid zonder reden";
  return "onbekende soort dekking";
}

console.log("[1] elke dekking is geldig");
const lijsten = {
  GEREEDSCHAP_3D, LINT_3D, SNELTOETSEN_3D,
  ...Object.fromEntries(Object.entries(VELDEN_3D).map(([soort, velden]) => [`VELDEN_3D.${soort}`, velden])),
  ...Object.fromEntries(Object.entries(PANEEL_3D).map(([bestand, knoppen]) => [`PANEEL_3D.${bestand}`, knoppen])),
};
const fouten = [];
let aantal = 0;
for (const [lijst, items] of Object.entries(lijsten)) {
  for (const [naam, d] of Object.entries(items)) {
    aantal++;
    const p = probleem(d);
    if (p) fouten.push(`${lijst}.${naam}: ${p}`);
  }
}
check(`${aantal} functies: elk commando bestaat, elk veld staat in zijn schema, elke fase heeft een reden`, fouten.length === 0, fouten.join("; "));
const fase1 = Object.entries(lijsten).flatMap(([lijst, items]) =>
  Object.entries(items).filter(([, d]) => "fase" in d && d.fase < 2).map(([naam]) => `${lijst}.${naam}`));
check("niets wacht nog op fase 1 (het 3D-model)", fase1.length === 0, fase1.join(", "));

// ── [2] Het 3D-lint ────────────────────────────────────────────────────────

console.log("\n[2] het 3D-lint");
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const i18next = (await import("i18next")).default;
const { initReactI18next } = await import("react-i18next");
await i18next.use(initReactI18next).init({
  lng: "cimode", appendNamespaceToCIMode: true, ns: ["ribbon", "common"], defaultNS: "ribbon", resources: {}, showSupportNotice: false,
});
const HomeTab = (await import("./src/components/ribbon/HomeTab.tsx")).default;
const niets = () => {};
const handlers = Object.fromEntries([
  "onSettingsClick", "onProjectSettingsClick", "onFemToolChange", "onDelete", "onUndo", "onRedo", "onOpenGrids", "onSolve",
  "onOpenLoadCases", "onOpenLoadCombinations", "onOpenWindGenerator", "onOpenWaterAccumulation", "onFilterSelection",
  "onNewProject", "onOpenProject", "onSaveProject", "onSaveProjectAs", "onConvertTo3D", "onOpenSteelHall",
  "onOpenFem3DToolChange", "onOpenFem3DFit", "onOpenFem3DViewChange", "onToggle3DVisibility", "onOpenFem3DSupportPreset",
  "onOpenFem3DSpringTool", "onOpenFem3DRequestNodalLoad", "onOpenFem3DRequestMemberLoad", "onOpenFem3DRequestMemberPointLoad",
  "onOpenFem3DRequestThermalLoad", "onOpenFem3DRequestSurfaceLoad", "onOpenFem3DConvertPlateToLoadPanel",
  "onOpenFem3DPinBeamsToColumns", "onOpenFem3DConnectNodes", "onOpenFem3DMergeNodes", "onOpenFem3DPlateDisplayChange", "onOpenFem3DSectionBoxToggle",
].map((naam) => [naam, niets]));
const html = renderToStaticMarkup(React.createElement(HomeTab, {
  ...handlers, modelDimension: "3d", availableOpenFem3DTools: Object.keys(GEREEDSCHAP_3D),
  hasOpenFem3DNodeSelection: true, hasOpenFem3DBeamSelection: true, hasOpenFem3DPlateSelection: true,
  canOpenFem3DDelete: true, canUndo: true, canRedo: true,
}));
const knoppen = new Set([...html.matchAll(/class="ribbon-btn-label">([^<]*)</g)].map((m) => m[1]));
check("het lint is getekend, met sleutels als label", knoppen.size > 30 && [...knoppen].every((k) => /^[a-z]+:[\w.]+$/.test(k)),
  [...knoppen].slice(0, 5).join(", "));
const lintZonder = zonder(knoppen, new Set(Object.keys(LINT_3D)));
check("elke knop van het 3D-lint staat in LINT_3D", lintZonder.length === 0, `ontbreekt: ${lintZonder.join(", ")}`);
const lintOud = zonder(new Set(Object.keys(LINT_3D)), knoppen);
check("LINT_3D noemt geen knop die er niet is", lintOud.length === 0, `te veel: ${lintOud.join(", ")}`);

// ── [3] Knoppen in het eigenschappenpaneel ─────────────────────────────────

console.log("\n[3] knoppen in het eigenschappenpaneel");
/**
 * De knoppen in een bronbestand: op de eerste letterlijke sleutel in een
 * `t(...)`-aanroep (ook in een aria-label), anders op de functie die de klik
 * aanroept, met het eerste tekstargument erbij.
 */
function knopIds(tekst) {
  const ids = new Set();
  for (const blok of tekst.match(/<button\b[\s\S]*?<\/button>/g) ?? []) {
    let id = null;
    for (const aanroep of blok.match(/\bt\(([^)]*)\)/g) ?? []) {
      const sleutel = aanroep.match(/["`]([\w.:-]+)["`]/);
      if (sleutel) { id = sleutel[1]; break; }
    }
    if (!id) {
      const klik = blok.match(/onClick=\{(?:\([^)]*\)\s*=>\s*)?([A-Za-z_$][\w$.]*)(?:\(\s*"([^"]*)")?/);
      if (klik) id = klik[2] !== undefined ? `${klik[1]}("${klik[2]}")` : klik[1];
    }
    ids.add(id ?? `? ${blok.replace(/\s+/g, " ").slice(0, 80)}`);
  }
  return ids;
}
for (const [bestand, gedekt] of Object.entries(PANEEL_3D)) {
  // Met een map ervoor (een venster dat 2D en 3D delen) onder src/components/.
  const gevonden = knopIds(bron(bestand.includes("/") ? `src/components/${bestand}` : `src/components/openFem3d/${bestand}`));
  const nieuw = zonder(gevonden, new Set(Object.keys(gedekt)));
  const weg = zonder(new Set(Object.keys(gedekt)), gevonden);
  check(`${bestand}: ${gevonden.size} knoppen, alle gedekt`, gevonden.size > 0 && nieuw.length === 0 && weg.length === 0,
    `${nieuw.length ? `ontbreekt: ${nieuw.join(", ")}` : ""}${weg.length ? ` te veel: ${weg.join(", ")}` : ""}`);
}

// ── [4] Sneltoetsen ────────────────────────────────────────────────────────

console.log("\n[4] sneltoetsen");
const toetsen = new Set([
  ...Object.keys(DIRECTE_COMMANDO_S),
  ...Object.entries(COMMANDO_REEKSEN).flatMap(([eerste, rest]) => Object.keys(rest).map((tweede) => eerste + tweede)),
]);
for (const pad of ["src/components/openFem3d/OpenFem3DEditor.tsx", "src/components/openFem3d/ThreeFrameCanvas.tsx", "src/App.tsx"]) {
  const tekst = bron(pad);
  for (const m of tekst.matchAll(/\b(?:event|e)\.key(?:\.toLowerCase\(\))?\s*[!=]==\s*"([^"]*)"/g)) toetsen.add(m[1]);
  // App.tsx: `const k = e.key.toLowerCase()` en dan `k === "z"`.
  for (const m of tekst.matchAll(/\bk\s*===\s*"([^"]*)"/g)) toetsen.add(m[1]);
}
const toetsZonder = zonder(toetsen, new Set(Object.keys(SNELTOETSEN_3D)));
check(`${toetsen.size} toetsen, elk in SNELTOETSEN_3D`, toetsZonder.length === 0, `ontbreekt: ${toetsZonder.map((k) => JSON.stringify(k)).join(", ")}`);
const toetsOud = zonder(new Set(Object.keys(SNELTOETSEN_3D)), toetsen);
check("SNELTOETSEN_3D noemt geen toets die niemand afvangt", toetsOud.length === 0, `te veel: ${toetsOud.join(", ")}`);

// ── [5] Gereedschappen en velden ───────────────────────────────────────────

console.log("\n[5] gereedschappen en modelvelden (volledigheid: tsc)");
check("elk gereedschap, met de opleggingen en veren", Object.keys(GEREEDSCHAP_3D).length >= 29, String(Object.keys(GEREEDSCHAP_3D).length));
check("de modelvelden per type", Object.keys(VELDEN_3D).length >= 20 && Object.values(VELDEN_3D).every((velden) => Object.keys(velden).length > 0));

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

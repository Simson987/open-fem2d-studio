/**
 * Thematokens zoals de browser ze uitrekent, voor tests zonder browser.
 *
 * Sinds de restyling naar OpenAEC Blueprint 0.4 staan de kleuren niet meer
 * als hexwaarde per `[data-theme=…]`-blok in `src/themes.css`. Het thema hangt
 * aan `<html data-oa-theme="…">`; de waarden staan in
 * `src/openaec/openaec-tokens.css` (`--oa-*`, gegenereerd uit de Blueprint-
 * tokens) en `src/themes.css` koppelt de `--theme-*`-namen van de app daaraan
 * met `var(--oa-…)`. Een test die "de achtergrond van thema X" wil weten, moet
 * dus dezelfde cascade doorlopen als de browser:
 *
 *   1. de blokken uit openaec-tokens.css, dan die uit themes.css (zo importeert
 *      `main.tsx` ze: tokens eerst, themes.css via App.css daarna);
 *   2. per blok alleen als zijn selectorlijst `:root` of
 *      `[data-oa-theme="X"]` bevat. `:root` en een attribuutselector hebben
 *      dezelfde specificiteit (0,1,0), dus de bronvolgorde beslist — precies
 *      wat "laatste declaratie wint" hieronder doet;
 *   3. `var(--naam, terugval)` recursief invullen.
 *
 * Samengestelde selectors als `[data-oa-theme="dark"][data-oa-workspace="light"]`
 * (instellingen Werkruimte/Statusbalk) tellen niet mee: dit is de stand
 * "werkruimte en statusbalk volgen het thema", de standaard.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "src");

/** De vijf thema's van ontwerp 0.4, met hun waarde voor `data-oa-theme`. */
export const THEMAS = ["light", "dark", "blueprint", "high-contrast-dark", "high-contrast-light"];

const lees = (pad) => readFileSync(pad, "utf8").replace(/\r\n/g, "\n");
export const TOKENS_CSS = lees(join(SRC, "openaec", "openaec-tokens.css"));
export const THEMES_CSS = lees(join(SRC, "themes.css"));

/** Alle vlakke `selector { declaraties }`-blokken, zonder commentaar. */
function blokken(css) {
  const zonderCommentaar = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...zonderCommentaar.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(",").map((s) => s.trim()).filter(Boolean),
    body: m[2],
  }));
}

const ALLE_BLOKKEN = [...blokken(TOKENS_CSS), ...blokken(THEMES_CSS)];

function geldtVoor(selectors, thema) {
  return selectors.some((s) => s === ":root" || s === `[data-oa-theme="${thema}"]`);
}

/** De ruwe (niet ingevulde) declaraties die voor `thema` gelden, laatste wint. */
function ruw(thema) {
  if (!THEMAS.includes(thema)) throw new Error(`onbekend thema: ${thema}`);
  const uit = new Map();
  for (const { selectors, body } of ALLE_BLOKKEN) {
    if (!geldtVoor(selectors, thema)) continue;
    for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) uit.set(m[1], m[2].trim());
    const schema = /color-scheme\s*:\s*([^;]+);/.exec(body);
    if (schema) uit.set("color-scheme", schema[1].trim());
  }
  return uit;
}

function vulIn(waarde, ruweTokens, diepte = 0) {
  if (diepte > 20) throw new Error(`var()-kringloop in ${waarde}`);
  return waarde.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, naam, terugval) => {
    const v = ruweTokens.get(naam);
    if (v !== undefined) return vulIn(v, ruweTokens, diepte + 1);
    if (terugval !== undefined) return vulIn(terugval.trim(), ruweTokens, diepte + 1);
    throw new Error(`token ${naam} heeft geen waarde en geen terugval`);
  });
}

/**
 * Alle custom properties (en `color-scheme`) zoals ze in `thema` uitpakken.
 * @returns {Map<string, string>} sleutel inclusief `--`
 */
export function themaTokens(thema) {
  const r = ruw(thema);
  const uit = new Map();
  for (const [k, v] of r) uit.set(k, vulIn(v, r));
  return uit;
}

/** Eén token in één thema; gooit als hij ontbreekt. `naam` met of zonder `--`. */
export function token(thema, naam) {
  const sleutel = naam.startsWith("--") ? naam : `--${naam}`;
  const v = themaTokens(thema).get(sleutel);
  if (v === undefined) throw new Error(`token ${sleutel} ontbreekt in thema ${thema}`);
  return v;
}

/** Zoals `token`, maar `null` als het thema hem niet zet. */
export function tokenOfNiets(thema, naam) {
  const sleutel = naam.startsWith("--") ? naam : `--${naam}`;
  return themaTokens(thema).get(sleutel) ?? null;
}

/** `#rgb`, `#rrggbb` of `rgba(r, g, b, a)` → `[r, g, b, a]`. */
export function kleur(waarde) {
  const w = waarde.trim();
  if (w.startsWith("#")) {
    const h = w.slice(1);
    const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    if (v.length !== 6) throw new Error(`onbekende kleur ${waarde}`);
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)).concat(1);
  }
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(w);
  if (!m) throw new Error(`onbekende kleur ${waarde}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
}

/**
 * html2canvas kent de kleurfunctie `color()` niet. Chromium geeft `color-mix(…)`
 * in de berekende stijl terug als `color(srgb …)`, en dan stopt html2canvas met
 * "Attempting to parse an unsupported color function \"color\"" (#100).
 *
 * `maakKleurenCompatibel` loopt in `onclone` de KLOON zelf na, met de
 * berekende stijl van het kloonvenster, en zet elke `color()` om naar rgba().
 * Vroeger koppelde de app elementen van het origineel en de kloon op volgorde;
 * html2canvas kloont `<script>` niet, dus na het eerste script in de `<head>`
 * schoof die koppeling en bleven de `color()`-waarden staan.
 */

/** De eigenschappen waarin html2canvas een kleur leest. */
const KLEUR_EIGENSCHAPPEN = [
  "color", "background-color", "background-image",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "outline-color", "text-decoration-color", "column-rule-color", "caret-color",
  "-webkit-text-stroke-color", "-webkit-text-fill-color",
  "fill", "stroke", "stop-color", "flood-color", "lighting-color",
  "box-shadow", "text-shadow",
] as const;

/** Zet elke `color(srgb|display-p3 …)` in een stijlwaarde om naar rgba(). */
export function compatibeleKleur(waarde: string): string {
  return waarde.replace(
    /color\(\s*(?:srgb|display-p3)\s+([^)]*)\)/gi,
    (_volledig, inhoud: string) => {
      const [kanalen, alfaTekst] = inhoud.split("/").map((deel) => deel.trim());
      const getallen = kanalen.split(/\s+/).map((deel) =>
        deel.endsWith("%") ? Number.parseFloat(deel) / 100 : Number.parseFloat(deel));
      if (getallen.length < 3 || getallen.some((getal) => !Number.isFinite(getal))) return "rgba(0,0,0,0)";
      const alfa = alfaTekst === undefined
        ? 1
        : alfaTekst.endsWith("%") ? Number.parseFloat(alfaTekst) / 100 : Number.parseFloat(alfaTekst);
      const kleur = getallen.slice(0, 3).map((getal) => Math.round(Math.max(0, Math.min(1, getal)) * 255));
      return `rgba(${kleur[0]},${kleur[1]},${kleur[2]},${Number.isFinite(alfa) ? Math.max(0, Math.min(1, alfa)) : 1})`;
    },
  );
}

/** Voor `onclone` van html2canvas: elke `color()` in de kloon wordt rgba(). */
export function maakKleurenCompatibel(kopie: Document): void {
  const venster = kopie.defaultView;
  if (!venster) return;
  const elementen = [kopie.documentElement, ...kopie.querySelectorAll<HTMLElement | SVGElement>("*")];
  for (const element of elementen) {
    const berekend = venster.getComputedStyle(element);
    for (const eigenschap of KLEUR_EIGENSCHAPPEN) {
      const waarde = berekend.getPropertyValue(eigenschap);
      if (waarde.includes("color(")) element.style.setProperty(eigenschap, compatibeleKleur(waarde), "important");
    }
  }
}

import { useLayoutEffect, type RefObject } from "react";

/** De klasse waarmee Ribbon.css de namen van de kleine en middelgrote knoppen inkort (72 px, met …). */
export const RIBBON_TIGHT_CLASS = "ribbon-tight";
/** De klasse waarmee Ribbon.css de kleine en middelgrote knoppen alleen als pictogram toont. */
export const RIBBON_COMPACT_CLASS = "ribbon-compact";

const teBreed = (element: HTMLElement) => element.scrollWidth > element.clientWidth + 1;

/**
 * Krap en compact lint, in drie trappen, gemeten:
 *  1. past de inhoud van het lint met volledige namen in de breedte van het
 *     venster, dan blijft alles zoals het is;
 *  2. anders krijgt het element de klasse `ribbon-tight`: Ribbon.css kort de
 *     namen van de kleine en middelgrote knoppen in tot 72 px (met …);
 *  3. past het ook zo niet, dan de klasse `ribbon-compact` (en niet meer
 *     `ribbon-tight`): alleen pictogrammen bij de kleine en middelgrote
 *     knoppen. Hun naam blijft in de tooltip en in aria-label. Past het ook
 *     zo niet, dan schuift het lint horizontaal.
 *
 * Er wordt altijd eerst mét volledige namen gemeten (de klassen eraf): zo
 * komen de namen terug zodra er weer ruimte is, bij een breder venster, in 2D
 * (een smaller lint dan in 3D) of in een taal met kortere namen. Een vaste
 * schermbreedte kan dat niet: het 3D-lint is met namen ruim twee keer zo breed
 * als het 2D-lint, en de breedte verschilt per taal.
 *
 * Opnieuw meten bij een andere breedte (venster of ResizeObserver) en bij
 * andere inhoud (MutationObserver op knoppen en teksten), niet bij elke
 * render. Het meten en zetten gebeurt vóór het tekenen, dus zonder flikkeren.
 */
export function useRibbonCompact(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const meet = () => {
      element.classList.remove(RIBBON_TIGHT_CLASS, RIBBON_COMPACT_CLASS);
      if (!teBreed(element)) return;
      element.classList.add(RIBBON_TIGHT_CLASS);
      if (!teBreed(element)) return;
      element.classList.remove(RIBBON_TIGHT_CLASS);
      element.classList.add(RIBBON_COMPACT_CLASS);
    };
    meet();
    window.addEventListener("resize", meet);
    const formaat = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(meet);
    formaat?.observe(element);
    // Alleen knoppen en teksten: de klassen zelf (een attribuut) tellen niet mee, anders meet hij zichzelf opnieuw.
    const inhoud = typeof MutationObserver === "undefined" ? null : new MutationObserver(meet);
    inhoud?.observe(element, { childList: true, subtree: true, characterData: true });
    return () => {
      window.removeEventListener("resize", meet);
      formaat?.disconnect();
      inhoud?.disconnect();
    };
  }, [ref]);
}

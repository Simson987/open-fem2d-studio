/**
 * Escape op het tekenvlak, in 2D en 3D gelijk:
 *
 *  1. in een ander gereedschap dan Selecteren breekt Escape het lopende
 *     gereedschap af en zet het terug op Selecteren; de selectie blijft staan;
 *  2. in Selecteren heft een (tweede) Escape de selectie op.
 *
 * In een invoerveld hoort Escape bij het veld (bijvoorbeeld de invoer
 * herstellen); het tekenvlak laat de toets dan met rust.
 */
export type EscapeActie = "naarSelecteren" | "selectieOpheffen" | "niets";

export function escapeActie(gereedschap: string, heeftSelectie: boolean): EscapeActie {
  if (gereedschap !== "select") return "naarSelecteren";
  return heeftSelectie ? "selectieOpheffen" : "niets";
}

/** Een tekstveld, keuzelijst of bewerkbaar element: daar zijn sneltoetsen van het veld. */
export function isInvoerVeld(doel: EventTarget | null): boolean {
  const element = doel as HTMLElement | null;
  if (!element || typeof element !== "object") return false;
  if (element.isContentEditable) return true;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName ?? "");
}

/**
 * Stond er een dialoog open toen de toets werd ingedrukt?
 *
 * Een dialoog sluit bij Escape zelf, met een luisteraar op het document. Bij
 * een echte toetsaanslag verwerkt React die sluiting (en ruimt de dialoog
 * zich af) al vóórdat de luisteraar van het tekenvlak op window aan de beurt
 * is; een vraag naar "staat er een dialoog open?" komt dan te laat en Escape
 * zou ook nog het gereedschap of de selectie wegnemen. De vangfase op window
 * loopt vóór alle andere luisteraars: daar wordt de stand vastgelegd.
 */
export function volgDialoogBijToets(
  isOpen: () => boolean,
  doel: EventTarget = window,
): { open: () => boolean; stop: () => void } {
  let openBijToets = false;
  const vang = () => { openBijToets = isOpen(); };
  const vangfase = { capture: true };
  doel.addEventListener("keydown", vang, vangfase);
  return {
    open: () => openBijToets || isOpen(),
    stop: () => doel.removeEventListener("keydown", vang, vangfase),
  };
}

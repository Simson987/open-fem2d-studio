// Iconen uit de OpenAEC Blueprint (B2-set en FEM-ontwerpen) als SVG-string
// voor RibbonButton. De data staat in b2IconData.ts; die wordt gemaakt door
// `node scripts/b2-iconen.mjs <pad naar OpenAEC-Blueprint>`, dat de id's uit
// de b2("…")-aanroepen in de broncode haalt. Een nieuw icoon: een b2-aanroep met de Blueprint-id in de
// code zetten en het script opnieuw draaien.
//
// De hoofdkleur is currentColor, het accent --icon-accent (zie Ribbon.css).
// Waar Blueprint een 16 px-tekening heeft, gaat die mee en toont de CSS hem
// bij kleine knoppen; schalen van 24 naar 16 px maakt iconen korrelig.
import { B2_DATA } from "./b2IconData";

interface B2Opties {
  /** Draaiing in graden om het midden, bv. 90 voor de X-variant van een oplegging. */
  draai?: number;
}

function svg(klasse: string, viewBox: string, inhoud: string, draai?: number): string {
  const [, , b, h] = viewBox.split(/\s+/).map(Number);
  const binnen = draai ? `<g transform="rotate(${draai} ${b / 2} ${h / 2})">${inhoud}</g>` : inhoud;
  return `<svg class="b2 ${klasse}" viewBox="${viewBox}" aria-hidden="true">${binnen}</svg>`;
}

export function b2(id: string, opties: B2Opties = {}): string {
  const d = B2_DATA[id];
  if (!d) throw new Error(`B2-icoon "${id}" ontbreekt; draai scripts/b2-iconen.mjs`);
  const [vb24, inhoud24, vb16, inhoud16] = d;
  if (!vb16) return svg("b2-alle", vb24, inhoud24, opties.draai);
  return svg("b2-24", vb24, inhoud24, opties.draai) + svg("b2-16", vb16, inhoud16, opties.draai);
}

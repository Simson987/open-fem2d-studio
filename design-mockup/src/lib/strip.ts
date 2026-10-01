/**
 * strip — de schrijfwijzen van platstaal herleiden tot de naam in de
 * profieldatabase.
 *
 * De catalogus kent platstaal als "Strip <b>x<t>" (b de breedte, t de dikte,
 * in mm: "Strip 80x10"); dat is ook de ProfileName die een IFC-model bij een
 * IfcRectangleProfileDef meegeeft. In tekeningen en modellen staat hetzelfde
 * profiel ook als "FL 80x10", "Platstaal 80x10", "Strip 80 x 10" of
 * "strip80x10". Die schrijfwijzen krijgen hier de sleutel van "Strip 80x10",
 * zodat de doorsnede, de 3D-rekenkern, de tekening en de toetsing ze allemaal
 * herkennen.
 *
 * Dit is de SPIEGEL van `strip_sleutel` in
 * `src-tauri/crates/steel-profiles/src/lib.rs`: de Rust-kern zoekt een
 * profielnaam met precies dezelfde regel op, dus wat hier "Strip 80x10" wordt,
 * vindt de toetsing ook. `test-strip.mjs` houdt de twee tegen elkaar.
 *
 * De STAND van een strip ligt in de catalogus vast: de breedte b loopt langs de
 * lokale z-as, de dikte t langs de lokale y-as. I_y = t·b³/12 is dus de sterke
 * as, zoals bij elk ander profiel; in de maattabel staat h = b en b = t.
 *
 * Bewust alleen afhankelijk van `rondStaal.ts` (dat zelf geen afhankelijkheden
 * heeft): `steelCheckBuilder`, `sectionResolver`, de IFC-export en de
 * 3D-rekenroute lezen dit bestand allemaal, en sommige daarvan importeren
 * elkaar.
 */
import { rondStaalSleutel } from "./rondStaal";

/**
 * De voorvoegsels waarmee platstaal geschreven wordt, na het normaliseren
 * (hoofdletters, zonder spaties, koppeltekens en punten).
 */
const VOORVOEGSELS = ["STRIP", "PLATSTAAL", "FL"] as const;

/**
 * Een al genormaliseerde profielsleutel → de sleutel van "Strip <b>x<t>" als
 * het platstaal aanduidt ("FL80X10", "PLATSTAAL80X10", "STRIP80×10" →
 * "STRIP80X10"), anders de sleutel zelf. Alleen een voorvoegsel gevolgd door
 * `<cijfers>x<cijfers>` telt (x, ×, *); de grootste maat komt voorop, want een
 * strip 10×80 is dezelfde doorsnede als 80×10.
 */
export function stripSleutel(sleutel: string): string {
  for (const v of VOORVOEGSELS) {
    if (!sleutel.startsWith(v)) continue;
    const m = /^(\d+)[X×*](\d+)$/.exec(sleutel.slice(v.length));
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    return `STRIP${Math.max(a, b)}X${Math.min(a, b)}`;
  }
  return sleutel;
}

/**
 * De aliasregels van de catalogus samen: massief rond ("Ø24" → "RD24", zie
 * `rondStaal.ts`) en platstaal ("FL80X10" → "STRIP80X10"). De invoer is een
 * al genormaliseerde sleutel; dit is wat de Rust-kern in `lookup_key` doet.
 */
export function profielAliasSleutel(sleutel: string): string {
  return stripSleutel(rondStaalSleutel(sleutel));
}

/**
 * De databasenaam "Strip <b>x<t>" bij een schrijfwijze van platstaal
 * ("FL 80x10", "platstaal 80 x 10" → "Strip 80x10"), of `null` als de naam
 * geen platstaal is. Of die maat ook in de catalogus staat, zegt deze functie
 * niet — daarvoor is er de profieldatabase.
 */
export function stripNaam(naam: string): string | null {
  const sleutel = stripSleutel(naam.replace(/[\s\-.]/g, "").toUpperCase());
  const m = /^STRIP(\d+)X(\d+)$/.exec(sleutel);
  return m ? `Strip ${m[1]}x${m[2]}` : null;
}

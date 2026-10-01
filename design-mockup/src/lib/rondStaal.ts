/**
 * rondStaal — de schrijfwijzen van massief rond staal herleiden tot de naam
 * in de profieldatabase.
 *
 * De catalogus kent massief rond als "RD <d>" (d in mm: "RD 24"). In tekeningen,
 * modellen en IFC-bestanden staat hetzelfde profiel ook als "Ø24", "Ø 24" of
 * "ROND 24". Die schrijfwijzen krijgen hier de sleutel van "RD 24", zodat de
 * doorsnede, de 3D-rekenkern, de tekening en de toetsing ze allemaal
 * herkennen.
 *
 * Dit is de SPIEGEL van `rond_staal_sleutel` in
 * `src-tauri/crates/steel-profiles/src/lib.rs`: de Rust-kern zoekt een
 * profielnaam met precies dezelfde regel op, dus wat hier "RD 24" wordt, vindt
 * de toetsing ook. `test-rond-staal.mjs` houdt de twee tegen elkaar.
 *
 * Bewust geen afhankelijkheden: `steelCheckBuilder`, `sectionResolver`, de
 * IFC-export en de 3D-rekenroute lezen dit bestand allemaal, en sommige
 * daarvan importeren elkaar.
 */

/**
 * De voorvoegsels waarmee massief rond geschreven wordt, na het normaliseren
 * (hoofdletters: "ø" is dan "Ø"). "⌀" (U+2300) is het eigenlijke
 * diameterteken; "Ø" (U+00D8) is wat een toetsenbord meestal oplevert.
 */
const VOORVOEGSELS = ["RD", "ROND", "Ø", "⌀"] as const;

/**
 * Een al genormaliseerde profielsleutel (hoofdletters, zonder spaties,
 * koppeltekens en punten) → de sleutel van "RD <d>" als het massief rond
 * aanduidt ("Ø24", "ROND24" → "RD24"), anders de sleutel zelf. Alleen een
 * voorvoegsel gevolgd door uitsluitend cijfers telt: "RHS…" blijft "RHS…".
 */
export function rondStaalSleutel(sleutel: string): string {
  for (const v of VOORVOEGSELS) {
    if (!sleutel.startsWith(v)) continue;
    const rest = sleutel.slice(v.length);
    if (/^\d+$/.test(rest)) return `RD${rest}`;
  }
  return sleutel;
}

/**
 * De databasenaam "RD <d>" bij een schrijfwijze van massief rond ("Ø24",
 * "rond 24", "RD24" → "RD 24"), of `null` als de naam geen massief rond is.
 * Of die maat ook in de catalogus staat, zegt deze functie niet — daarvoor
 * is er de profieldatabase.
 */
export function rondStaalNaam(naam: string): string | null {
  const sleutel = rondStaalSleutel(naam.replace(/[\s\-.]/g, "").toUpperCase());
  const m = /^RD(\d+)$/.exec(sleutel);
  return m ? `RD ${m[1]}` : null;
}

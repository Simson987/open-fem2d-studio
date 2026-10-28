/**
 * Een lastwaarde zoals een gebruiker hem typt (#52): komma of punt als
 * decimaalteken, een gewoon of typografisch min-teken, spaties, en de eenheid
 * (kN/m, kN/m², kN, kNm) mag erachter. Null als het geen eindig getal is; een
 * duizendtalscheiding of twee decimaaltekens zijn dat ook niet.
 */
export function leesLastWaarde(tekst: string): number | null {
  const schoon = tekst
    .replace(/\s+/g, "")
    .replace(/[−–]/g, "-")
    .replace(/kN(\/m[²2]?|m)?$/i, "");
  if (!/^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/.test(schoon)) return null;
  const waarde = Number(schoon.replace(",", "."));
  return Number.isFinite(waarde) ? waarde : null;
}

/** Een lastwaarde voor een invoerveld: komma als decimaalteken, geen overbodige nullen. */
export function toonLastWaarde(waarde: number): string {
  const afgerond = Math.round(waarde * 1e6) / 1e6;
  return String(Object.is(afgerond, -0) ? 0 : afgerond).replace(".", ",");
}

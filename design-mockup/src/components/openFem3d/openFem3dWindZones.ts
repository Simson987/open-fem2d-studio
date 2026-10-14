/** Windzones van rechthoekige gebouwen, met de normtabellen van de 2D-generator. */
import { berekenE, cpeWand, type WandZone } from "../../lib/wind/windEurocode";

export interface FacadeWindBand {
  zone: WandZone;
  /** Afstand vanaf de loefgevel, in meters. */
  fromM: number;
  toM: number;
  cpe10: number;
}

/**
 * De zijgevel krijgt A over e/5, B over de rest van e en C daarachter;
 * als het gebouw korter is worden lege zones weggelaten. D en E zijn de
 * volledige loef- en lijgevel. EN 1991-1-4 figuur 7.5 en tabel 7.1.
 */
export function facadeWindBands(
  widthAcrossWindM: number, depthAlongWindM: number, heightM: number,
): { eM: number; windward: FacadeWindBand; leeward: FacadeWindBand; sides: FacadeWindBand[] } {
  if (![widthAcrossWindM, depthAlongWindM, heightM].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("Gebouwbreedte, diepte en hoogte voor windzones moeten positief en eindig zijn.");
  }
  const eM = berekenE(widthAcrossWindM, heightM);
  const cpe = cpeWand(heightM / depthAlongWindM);
  const sides: FacadeWindBand[] = [];
  const append = (zone: WandZone, fromM: number, toM: number) => {
    if (toM > fromM + 1e-9) sides.push({ zone, fromM, toM, cpe10: cpe[zone] });
  };
  append("A", 0, Math.min(depthAlongWindM, eM / 5));
  append("B", Math.min(depthAlongWindM, eM / 5), Math.min(depthAlongWindM, eM));
  append("C", Math.min(depthAlongWindM, eM), depthAlongWindM);
  return {
    eM,
    windward: { zone: "D", fromM: 0, toM: depthAlongWindM, cpe10: cpe.D },
    leeward: { zone: "E", fromM: 0, toM: depthAlongWindM, cpe10: cpe.E },
    sides,
  };
}

/**
 * Sneeuw op eenvoudige daken volgens NEN-EN 1991-1-3:2003+A1:2015.
 *
 * s = μ · C_e · C_t · s_k werkt verticaal per m² horizontale projectie.
 * μ₁ hoort bij vlakke, lessenaar- en afzonderlijke zadeldakvlakken. De
 * herziene tabel 5.2 geeft ook μ₂ en μ₃ voor overige dakvormen. Voor een
 * zadeldak zijn de drie verdelingen (μ₁, μ₁), (½μ₁, μ₁) en
 * (μ₁, ½μ₁) uit figuur 5.3 maatgevend te onderzoeken.
 */

export interface SnowShapeCoefficients {
  slopeDeg: number;
  mu1: number;
  mu2: number;
  mu3: number | null;
  source: string;
}

export const SNOW_SHAPE_SOURCE = "NEN-EN 1991-1-3:2003+A1:2015 tabel 5.2 en figuur 5.3";

export function snowShapeCoefficients(slopeDeg: number): SnowShapeCoefficients {
  if (!Number.isFinite(slopeDeg) || slopeDeg < 0 || slopeDeg > 90) {
    throw new Error("Dakhelling voor sneeuw moet tussen 0° en 90° liggen.");
  }
  const mu1 = slopeDeg <= 30 ? 0.8 : slopeDeg < 60 ? 0.8 * (60 - slopeDeg) / 30 : 0;
  // Tabel 5.2 na A1:2015. μ₃ geldt voor ophoping bij meervoudige daken;
  // voor α ≥ 60° geeft de tabel daarvoor geen waarde.
  const mu2 = slopeDeg <= 30 ? 0.8 : slopeDeg < 60 ? 0.8 * (60 - slopeDeg) / 30 : 0;
  const mu3 = slopeDeg <= 30 ? 0.8 + 0.8 * slopeDeg / 30 : slopeDeg < 60 ? 1.6 : null;
  return { slopeDeg, mu1, mu2, mu3, source: SNOW_SHAPE_SOURCE };
}

export function snowRoofPressure(
  coefficient: number, groundSnowKnPerM2: number, exposure: number, thermal: number,
): number {
  if (![coefficient, groundSnowKnPerM2, exposure, thermal].every(
    (value) => Number.isFinite(value) && value >= 0,
  )) throw new Error("Sneeuwcoëfficiënten en karakteristieke grondlast moeten niet-negatief en eindig zijn.");
  return coefficient * groundSnowKnPerM2 * exposure * thermal;
}

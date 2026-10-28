/**
 * Aluminium extrusieprofielen als profielnaam, gedeeld door de solver
 * (`sectionResolver.ts`) en de toetsbouwer (`aluminiumCheckBuilder.ts`), zodat
 * stijfheid en toetsing dezelfde doorsnede zien.
 *
 * Schrijfwijzen (maten in mm):
 *  - `ALU-I h×b×tw×tf`  dubbelsymmetrisch I-profiel, bijv. "ALU-I 200x100x6x10";
 *  - `ALU-K h×b×t`      rechthoekige koker,           bijv. "ALU-K 120x60x4";
 *  - `b×h`              massieve rechthoek (via `parseRechthoek`).
 *
 * Zonder afrondingsstralen, net als de toetskern (`nen-en-1999-1-1`,
 * `doorsnede.rs`): A en I_y zijn daardoor de waarden waarmee de kern toetst.
 */
import type { AluDoorsnede } from "./types/aluminium/AluDoorsnede";

const GETAL = String.raw`(\d+(?:[.,]\d+)?)`;
const X = String.raw`\s*[x×*]\s*`;
const I_PATROON = new RegExp(String.raw`^\s*ALU[-\s]?I\s*${GETAL}${X}${GETAL}${X}${GETAL}${X}${GETAL}\s*$`, "i");
const K_PATROON = new RegExp(String.raw`^\s*ALU[-\s]?K\s*${GETAL}${X}${GETAL}${X}${GETAL}\s*$`, "i");

const getal = (s: string) => Number(s.replace(",", "."));

/** Herkent een aluminium profielnaam; `null` als het er geen is of de maten niet kloppen. */
export function parseAluminiumProfiel(naam: string | undefined): AluDoorsnede | null {
  const t = naam ?? "";
  const i = I_PATROON.exec(t);
  if (i) {
    const [h, b, tw, tf] = i.slice(1, 5).map(getal);
    if ([h, b, tw, tf].every((v) => v > 0) && h > 2 * tf && b > tw) {
      return { vorm: "IProfiel", h_mm: h, b_mm: b, tw_mm: tw, tf_mm: tf };
    }
    return null;
  }
  const k = K_PATROON.exec(t);
  if (k) {
    const [h, b, wand] = k.slice(1, 4).map(getal);
    if ([h, b, wand].every((v) => v > 0) && h > 2 * wand && b > 2 * wand) {
      return { vorm: "Koker", h_mm: h, b_mm: b, t_mm: wand };
    }
  }
  return null;
}

/** De profielnaam bij een doorsnede (omgekeerde van `parseAluminiumProfiel`). */
export function aluminiumProfielNaam(d: AluDoorsnede): string {
  switch (d.vorm) {
    case "IProfiel": return `ALU-I ${d.h_mm}x${d.b_mm}x${d.tw_mm}x${d.tf_mm}`;
    case "Koker": return `ALU-K ${d.h_mm}x${d.b_mm}x${d.t_mm}`;
    case "Rechthoek": return `${d.b_mm}x${d.h_mm}`;
  }
}

/** Bruto A (mm²) en I_y (mm⁴) zonder afrondingsstralen. */
export function aluminiumGrootheden(d: AluDoorsnede): { A: number; Iy: number } {
  switch (d.vorm) {
    case "IProfiel": {
      const hw = d.h_mm - 2 * d.tf_mm;
      return {
        A: 2 * d.b_mm * d.tf_mm + hw * d.tw_mm,
        Iy: (d.b_mm * d.h_mm ** 3 - (d.b_mm - d.tw_mm) * hw ** 3) / 12,
      };
    }
    case "Koker": {
      const hi = d.h_mm - 2 * d.t_mm;
      const bi = d.b_mm - 2 * d.t_mm;
      return {
        A: d.b_mm * d.h_mm - bi * hi,
        Iy: (d.b_mm * d.h_mm ** 3 - bi * hi ** 3) / 12,
      };
    }
    case "Rechthoek":
      return { A: d.b_mm * d.h_mm, Iy: (d.b_mm * d.h_mm ** 3) / 12 };
  }
}

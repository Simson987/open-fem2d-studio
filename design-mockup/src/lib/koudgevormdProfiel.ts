/**
 * Koudgevormde profielen als profielnaam, gedeeld door de solver
 * (`sectionResolver.ts`) en de toetsbouwer (`koudgevormdCheckBuilder.ts`), zodat
 * stijfheid en toetsing dezelfde doorsnede zien (issue #4).
 *
 * Schrijfwijzen (maten in mm, buitenwerks; t = KERNdikte zonder zinklaag;
 * r = binnenstraal van de zettingen):
 *  - `KV-C h×b×c×t r<r>`  C-profiel (met lippen), bijv. "KV-C 200x70x20x2 r3";
 *  - `KV-Z h×b×c×t r<r>`  Z-profiel met lippen,   bijv. "KV-Z 200x70x20x2 r3";
 *  - `KV-U h×b×t r<r>`    U-profiel zonder lippen, bijv. "KV-U 150x50x3 r3".
 *
 * A en I_y volgen het hartlijnmodel van de kern (`nen-en-1993-1-3`,
 * `doorsnede.rs`): scherpe hoeken met δ van §5.1(4) als de stralen niet
 * verwaarloosbaar zijn (§5.1(3)).
 */
import type { KvDoorsnede } from "./types/koudgevormd/KvDoorsnede";

const GETAL = String.raw`(\d+(?:[.,]\d+)?)`;
const X = String.raw`\s*[x×*]\s*`;
const R = String.raw`\s+r\s*=?\s*${GETAL}`;
const CZ_PATROON = new RegExp(String.raw`^\s*KV[-\s]?([CZ])\s*${GETAL}${X}${GETAL}${X}${GETAL}${X}${GETAL}${R}\s*$`, "i");
const U_PATROON = new RegExp(String.raw`^\s*KV[-\s]?U\s*${GETAL}${X}${GETAL}${X}${GETAL}${R}\s*$`, "i");

const getal = (s: string) => Number(s.replace(",", "."));

/** Dezelfde geldigheid als `KvDoorsnede::valideer` in de kern. */
export function koudgevormdGeldig(d: KvDoorsnede): boolean {
  const pos = (v: number) => Number.isFinite(v) && v > 0;
  const { h_mm: h, b_mm: b, t_mm: t, r_mm: r } = d;
  const c = d.vorm === "UProfiel" ? 0 : d.c_mm;
  if (!(pos(h) && pos(b) && pos(t)) || !(Number.isFinite(r) && r >= 0)) return false;
  if (h <= 2 * t + 2 * r || b <= t + r) return false;
  if (d.vorm !== "UProfiel" && !(c > t / 2 + r && c < h / 2)) return false;
  return true;
}

/** Herkent een koudgevormde profielnaam; `null` als het er geen is of de maten niet kloppen. */
export function parseKoudgevormdProfiel(naam: string | undefined): KvDoorsnede | null {
  const s = naam ?? "";
  const cz = CZ_PATROON.exec(s);
  let d: KvDoorsnede | null = null;
  if (cz) {
    const [h, b, c, t, r] = cz.slice(2, 7).map(getal);
    d = cz[1].toUpperCase() === "C"
      ? { vorm: "CProfiel", h_mm: h, b_mm: b, c_mm: c, t_mm: t, r_mm: r }
      : { vorm: "ZProfiel", h_mm: h, b_mm: b, c_mm: c, t_mm: t, r_mm: r };
  } else {
    const u = U_PATROON.exec(s);
    if (u) {
      const [h, b, t, r] = u.slice(1, 5).map(getal);
      d = { vorm: "UProfiel", h_mm: h, b_mm: b, t_mm: t, r_mm: r };
    }
  }
  return d && koudgevormdGeldig(d) ? d : null;
}

/** Is dit een koudgevormde profielNAAM (ook als de maten niet kloppen)? */
export function isKoudgevormdProfielNaam(naam: string | undefined): boolean {
  return /^\s*KV[-\s]?[CZU]\b/i.test(naam ?? "");
}

/** De profielnaam bij een doorsnede (omgekeerde van `parseKoudgevormdProfiel`). */
export function koudgevormdProfielNaam(d: KvDoorsnede): string {
  switch (d.vorm) {
    case "CProfiel": return `KV-C ${d.h_mm}x${d.b_mm}x${d.c_mm}x${d.t_mm} r${d.r_mm}`;
    case "ZProfiel": return `KV-Z ${d.h_mm}x${d.b_mm}x${d.c_mm}x${d.t_mm} r${d.r_mm}`;
    case "UProfiel": return `KV-U ${d.h_mm}x${d.b_mm}x${d.t_mm} r${d.r_mm}`;
  }
}

/**
 * Bruto A (mm²) en I_y (mm⁴) volgens het hartlijnmodel van de kern, met
 * `A·(1 − δ)` en `I·(1 − 2δ)` (§5.1(4)). Hartlijnmaten: h_p = h − t,
 * b_p = b − t (met lip) of b − t/2 (U), c_p = c − t/2.
 */
export function koudgevormdGrootheden(d: KvDoorsnede): { A: number; Iy: number; delta: number } {
  const t = d.t_mm;
  const lip = d.vorm !== "UProfiel";
  const hp = d.h_mm - t;
  const bp = lip ? d.b_mm - t : d.b_mm - t / 2;
  const cp = lip ? d.c_mm - t / 2 : 0;
  const A = t * (hp + 2 * bp + 2 * cp);
  const Iy = t * hp ** 3 / 12 + 2 * bp * t * (hp / 2) ** 2
    + (lip ? 2 * (t * cp ** 3 / 12 + cp * t * (hp / 2 - cp / 2) ** 2) : 0);
  // §5.1(3): verwaarloosbaar als r ≤ 5t en r ≤ 0,10·b_p (kleinste vlakke deel).
  const bpMin = Math.min(hp, bp, ...(lip ? [cp] : []));
  const verwaarloosbaar = d.r_mm <= 5 * t && d.r_mm <= 0.1 * bpMin;
  const delta = verwaarloosbaar ? 0 : (0.43 * (lip ? 4 : 2) * d.r_mm) / (hp + 2 * bp + 2 * cp);
  return { A: A * (1 - delta), Iy: Iy * (1 - 2 * delta), delta };
}

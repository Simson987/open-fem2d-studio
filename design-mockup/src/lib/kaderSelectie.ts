/**
 * Kaderselectie zoals in CAD, gedeeld door het 2D- en het 3D-tekenvlak.
 *
 *  - Van links naar rechts slepen is een VENSTER: alleen wat volledig binnen
 *    het kader valt, wordt geselecteerd. Getekend met een doorgetrokken rand.
 *  - Van rechts naar links slepen is een CROSSING: alles wat het kader raakt
 *    of snijdt, wordt geselecteerd — ook een staaf die door het kader loopt
 *    terwijl zijn eindknopen erbuiten liggen. Getekend met een gestippelde
 *    rand en een lichtere vulling.
 *
 * Alle maten in schermpixels, y naar beneden. Geen React, geen Three: het
 * 2D-tekenvlak (SVG) en het 3D-tekenvlak (geprojecteerde geometrie) gebruiken
 * dezelfde meetkunde.
 */

export type KaderModus = "venster" | "crossing";

export interface SchermPunt {
  x: number;
  y: number;
}

export interface SchermKader {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Sleeprichting → modus: naar links (eind vóór begin) is crossing. */
export function kaderModus(startX: number, eindX: number): KaderModus {
  return eindX < startX ? "crossing" : "venster";
}

/** Het asgelijnde kader tussen twee hoekpunten, in welke richting ook gesleept. */
export function kaderUitPunten(a: SchermPunt, b: SchermPunt): SchermKader {
  return {
    left: Math.min(a.x, b.x),
    right: Math.max(a.x, b.x),
    top: Math.min(a.y, b.y),
    bottom: Math.max(a.y, b.y),
  };
}

/** Ligt het punt in het kader? De rand hoort erbij. */
export function puntInKader(p: SchermPunt, k: SchermKader): boolean {
  return p.x >= k.left && p.x <= k.right && p.y >= k.top && p.y <= k.bottom;
}

/**
 * Raakt of snijdt het lijnstuk ab het kader (rand inbegrepen)? Liang–Barsky:
 * het deel van het lijnstuk binnen elk van de vier halfvlakken wordt
 * afgeknipt; er blijft iets over precies wanneer het lijnstuk het kader raakt.
 * Een lijnstuk dat geheel binnen het kader ligt, raakt het ook.
 */
export function lijnstukRaaktKader(a: SchermPunt, b: SchermPunt, k: SchermKader): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - k.left, k.right - a.x, a.y - k.top, k.bottom - a.y];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i += 1) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}

/** Even-oneven-regel; de rand is hier niet eenduidig en ook niet nodig. */
export function puntInVeelhoek(p: SchermPunt, veelhoek: readonly SchermPunt[]): boolean {
  let binnen = false;
  for (let i = 0, j = veelhoek.length - 1; i < veelhoek.length; j = i, i += 1) {
    const a = veelhoek[i];
    const b = veelhoek[j];
    if ((a.y > p.y) !== (b.y > p.y)
      && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) binnen = !binnen;
  }
  return binnen;
}

/** Overlapt de driehoek abc het kader? Voor geprojecteerde meshdriehoeken. */
export function driehoekRaaktKader(a: SchermPunt, b: SchermPunt, c: SchermPunt, k: SchermKader): boolean {
  if (puntInKader(a, k) || puntInKader(b, k) || puntInKader(c, k)) return true;
  if (lijnstukRaaktKader(a, b, k) || lijnstukRaaktKader(b, c, k) || lijnstukRaaktKader(c, a, k)) return true;
  // Geen hoek binnen en geen rand erdoor: het kader ligt geheel binnen of
  // geheel buiten de driehoek.
  return puntInVeelhoek({ x: k.left, y: k.top }, [a, b, c]);
}

/**
 * Overlapt de veelhoek (een plaat, met openingen als gaten) het kader?
 * Een kader dat geheel binnen een opening valt, raakt de plaat niet.
 */
export function veelhoekRaaktKader(
  buiten: readonly SchermPunt[],
  gaten: readonly (readonly SchermPunt[])[],
  k: SchermKader,
): boolean {
  if (buiten.length === 0) return false;
  if (buiten.some((p) => puntInKader(p, k))) return true;
  for (const ring of [buiten, ...gaten]) {
    for (let i = 0; i < ring.length; i += 1) {
      if (lijnstukRaaktKader(ring[i], ring[(i + 1) % ring.length], k)) return true;
    }
  }
  // Geen rand door het kader: het kader ligt in zijn geheel in de plaat, in
  // een opening, of ernaast. Het midden beslist.
  const midden = { x: (k.left + k.right) / 2, y: (k.top + k.bottom) / 2 };
  return puntInVeelhoek(midden, buiten) && !gaten.some((gat) => puntInVeelhoek(midden, gat));
}

export interface KaderElementen {
  knopen: readonly { id: number; p: SchermPunt }[];
  staven: readonly { id: number; a: SchermPunt; b: SchermPunt }[];
  platen: readonly { id: number; rand: readonly SchermPunt[]; gaten?: readonly (readonly SchermPunt[])[] }[];
}

export interface KaderSelectie {
  knoopIds: number[];
  staafIds: number[];
  plaatIds: number[];
}

/**
 * Wat een kader selecteert, in schermcoördinaten.
 *
 *  - Knopen: binnen het kader, in beide modi.
 *  - Staven: venster = beide eindpunten binnen; crossing = het lijnstuk raakt het kader.
 *  - Platen: venster = alle hoeken binnen; crossing = de plaat overlapt het kader.
 */
export function selecteerInKader(elementen: KaderElementen, k: SchermKader, modus: KaderModus): KaderSelectie {
  const knoopIds = elementen.knopen.filter((knoop) => puntInKader(knoop.p, k)).map((knoop) => knoop.id);
  const staafIds = elementen.staven.filter((staaf) => modus === "crossing"
    ? lijnstukRaaktKader(staaf.a, staaf.b, k)
    : puntInKader(staaf.a, k) && puntInKader(staaf.b, k)).map((staaf) => staaf.id);
  const plaatIds = elementen.platen.filter((plaat) => modus === "crossing"
    ? veelhoekRaaktKader(plaat.rand, plaat.gaten ?? [], k)
    : plaat.rand.length > 0 && plaat.rand.every((p) => puntInKader(p, k))).map((plaat) => plaat.id);
  return { knoopIds, staafIds, plaatIds };
}

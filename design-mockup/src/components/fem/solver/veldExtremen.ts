/**
 * veldExtremen — het veldmaximum van M en w TUSSEN de stations.
 *
 * WAAROM (controle 12 oktober 2026, punt C8)
 * Elke rekenstaaf levert 21 stations (x = i·L/20, `core/fem/BeamForces.ts`).
 * De omhullende, de grootste verplaatsing en de toetsinvoer namen tot oktober
 * 2026 het grootste STATIONSWAARDE, terwijl het echte veldmaximum van het
 * moment ligt waar V = 0 en dat van de zakking waar θ = 0 — vaak tussen twee
 * stations in. Gemeten: een ingeklemde ligger 6 m onder q = 10 kN/m gaf
 * M_veld = 25,200 kNm (stations 3600 en 3900 mm) waar 9qL²/128 = 25,3125 hoort
 * (−0,44 %), en w_max = 3,986 mm waar 4,00 mm hoort (−0,34 %): klein, maar
 * aan de onveilige kant.
 *
 * HOE: HERMITE MET DE AFGELEIDE DIE ER AL IS
 * De stations dragen naast M ook V = dM/dx (dezelfde tekenafspraak, zie
 * `lib/referentierichting.ts`), en naast w ook θ = dw/dx (analytisch, niet
 * gedifferentieerd). Op een interval [x₀, x₁] tussen twee stations bepalen
 * waarde en helling aan beide kanten precies één derdegraads polynoom (kubische
 * Hermite-interpolatie). Binnen één rekenelement is de verdeelde last lineair
 * (een deellastgrens, een staafpuntlast of een segmentgrens is een knip en dus
 * een elementgrens), dus is M(x) daar hooguit van de derde graad: de Hermite-
 * kubiek IS dan M(x), en zijn stationaire punt het exacte veldmaximum. Voor
 * w(x) (graad vier of vijf) is de kubiek een benadering met een restfout van
 * hooguit w''''·h⁴/384; met h = L/20 per element is dat relatief ≈ 1e-6 van
 * de zakking — vier ordes kleiner dan wat het stationsraster kostte.
 *
 * WAAROM NA HET COMBINEREN. De combinatie telt per stationsindex op
 * (`combineResults`) en gaat ervan uit dat elk belastinggeval hetzelfde raster
 * heeft. Een extra station per geval op zijn eigen V = 0 zou die superpositie
 * breken. M en V (en w en θ) van een combinatie zijn lineaire combinaties van
 * die van de gevallen, dus de Hermite-kubiek van de combinatie is de
 * combinatie van de kubieken: deze verfijning hoort na het combineren en
 * werkt zo voor elk geval, elke combinatie en de omhullende.
 *
 * Wat niet verandert: reacties, knoopwaarden, eindmomenten en de stations
 * zelf. Een extreem dat op een station valt (een symmetrische ligger), geeft
 * geen nieuwe waarde. Een interval van lengte nul (de dubbele stations op een
 * knip, waar V of θ mag springen) wordt overgeslagen.
 */

/** Een stationair punt binnen een stationsinterval. */
export interface VeldPunt {
  /** Positie langs de staaf (mm vanaf de startknoop, zelfde as als `stations_mm`). */
  x: number;
  /** Waarde van de grootheid daar (M in N·mm, w in mm). */
  waarde: number;
  /** Index van het station links van het punt. */
  i: number;
  /** Fractie 0..1 binnen het interval [i, i+1]. */
  s: number;
}

/** Relatieve marge: een stationair punt binnen deze fractie van een station valt OP dat station. */
const RAND = 1e-9;

/**
 * Passen waarde en helling op dit interval bij één lineaire verdeelde last?
 *
 * Voor M met V = dM/dx en een last q(x) = q₀ + k·x die binnen het interval
 * niet van teken wisselt, wijkt de trapeziumregel h·(V₀ + V₁)/2 hooguit
 * h·|V₁ − V₀|/6 af van M₁ − M₀ (de rest is k·h³/12; gelijkheid bij een
 * driehoek die op x₀ in nul begint). Springt V binnen het interval — een
 * doorgaande lijn (`lib/doorgaandeLijn.ts`) neemt het naadstation één keer
 * op als w en θ er doorlopen, met de dwarskracht van het deel ervóór, ook als
 * daar een puntlast of een aansluitende staaf zit — dan is de Hermite-kubiek
 * niet M(x) en zou hij een extreem verzinnen. Zo'n interval wordt overgeslagen: dan geldt de
 * stationswaarde, zoals vóór deze verfijning. Gemeten zonder deze toets: een
 * doorgaande lijn met 5 kN op de tussenknoop kreeg 52,52 kNm op x = 3019
 * waar 52,50 kNm op de knoop hoort.
 */
function passendBijLijnlast(h: number, f0: number, f1: number, d0: number, d1: number): boolean {
  const rest = Math.abs(f1 - f0 - (h * (d0 + d1)) / 2);
  const ruis = 1e-9 * (Math.abs(f0) + Math.abs(f1) + h * (Math.abs(d0) + Math.abs(d1)));
  return rest <= (1.01 * h * Math.abs(d1 - d0)) / 6 + ruis;
}

/**
 * De stationaire punten van de Hermite-kubiek door (x₀, f₀, f′₀) en
 * (x₁, f₁, f′₁), strikt binnen het interval. Leeg als er geen zijn, als het
 * interval lengte nul heeft of als een getal niet eindig is. Met `strikt`
 * ook leeg als waarde en helling niet bij één lineaire last passen (zie
 * `passendBijLijnlast`).
 */
function stationairInInterval(
  x0: number, x1: number, f0: number, f1: number, d0: number, d1: number, strikt: boolean,
): { s: number; waarde: number }[] {
  const h = x1 - x0;
  if (!(h > 0) || ![f0, f1, d0, d1].every(Number.isFinite)) return [];
  if (strikt && !passendBijLijnlast(h, f0, f1, d0, d1)) return [];
  // p(s) = h00·f0 + h10·h·d0 + h01·f1 + h11·h·d1, s ∈ [0, 1];
  // p'(s) = a·s² + b·s + c met:
  const a = 6 * (f0 - f1) + 3 * h * (d0 + d1);
  const b = 6 * (f1 - f0) - h * (4 * d0 + 2 * d1);
  const c = h * d0;
  const wortels: number[] = [];
  const schaal = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  if (schaal === 0) return [];
  if (Math.abs(a) <= 1e-12 * schaal) {
    if (Math.abs(b) > 1e-12 * schaal) wortels.push(-c / b);
  } else {
    const D = b * b - 4 * a * c;
    if (D < 0) return [];
    const wD = Math.sqrt(D);
    // Numeriek stabiele vorm van de abc-formule.
    const qq = -0.5 * (b + (b >= 0 ? wD : -wD));
    if (qq !== 0) wortels.push(c / qq);
    wortels.push(qq / a);
  }
  const p = (s: number): number => {
    const s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * f0 + (s3 - 2 * s2 + s) * h * d0
      + (-2 * s3 + 3 * s2) * f1 + (s3 - s2) * h * d1;
  };
  return wortels
    .filter((s) => Number.isFinite(s) && s > RAND && s < 1 - RAND)
    .map((s) => ({ s, waarde: p(s) }));
}

/**
 * Alle stationaire punten van f tussen de stations, met f′ als helling
 * (M met V, of w met θ). De arrays moeten even lang zijn als `x`; zo niet,
 * dan is er niets te verfijnen en komt er een lege lijst terug.
 *
 * `soort` "moment" toetst per interval of M en V bij één lineaire last passen
 * (`passendBijLijnlast`); een sprong in V daartussen geeft dan geen punt.
 * Bij "zakking" toetst deze functie niets: ze rekent erop dat de stations w
 * en θ aan beide kanten van een sprong in θ dragen. Op een knip binnen een
 * staaf (engine) en op een naad van een doorgaande lijn waar θ of w springt
 * (een scharnier, `lib/doorgaandeLijn.ts`) staat het station daarom dubbel:
 * een interval van lengte nul, dat wordt overgeslagen. Met θ van alleen het
 * linkerdeel op de naad verzon de kubiek rechts ervan een extreem (C8,
 * Gerberligger: −7,7226 mm waar −7,5947 mm hoort).
 */
export function veldPunten(
  x: readonly number[],
  f: readonly number[],
  afgeleide: readonly number[] | undefined,
  soort: "moment" | "zakking" = "moment",
): VeldPunt[] {
  const n = x.length;
  if (n < 2 || f.length !== n || !afgeleide || afgeleide.length !== n) return [];
  const strikt = soort === "moment";
  const uit: VeldPunt[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (const { s, waarde } of stationairInInterval(x[i], x[i + 1], f[i], f[i + 1], afgeleide[i], afgeleide[i + 1], strikt)) {
      uit.push({ x: x[i] + s * (x[i + 1] - x[i]), waarde, i, s });
    }
  }
  return uit;
}

/** Het grootste en het kleinste moment van een staaf, met hun plaats (mm). */
export interface MomentExtremen {
  max: { M: number; x: number };
  min: { M: number; x: number };
}

/**
 * Marge waarmee een punt tussen de stations een stationswaarde moet
 * overtreffen om mee te tellen: 1e-9 van de grootste |waarde|. Bij een
 * constant moment (zuivere eindmomenten) of een rechte zakkingslijn is de
 * Hermite-kubiek een rechte lijn op afrondruis na; die ruis mag de plaats van
 * het maximum niet van het eerste station naar ergens in het veld schuiven.
 */
export const VELD_MARGE = 1e-9;

/** Grootste |waarde| van een reeks (0 bij een lege reeks). */
function grootste(reeks: readonly number[]): number {
  let m = 0;
  for (const v of reeks) if (Number.isFinite(v) && Math.abs(v) > m) m = Math.abs(v);
  return m;
}

/**
 * Grootste en kleinste M(x) over de hele staaf: de stations plus de
 * stationaire punten ertussen (V = 0). Bij gelijke waarde wint het eerste
 * punt, zodat de plaats niet van afrondruis afhangt. `null` zonder stations.
 */
export function momentExtremen(ef: {
  stations_mm: readonly number[];
  bendingMoment: readonly number[];
  shearForce: readonly number[];
}): MomentExtremen | null {
  const n = ef.stations_mm.length;
  if (n === 0) return null;
  let max = { M: -Infinity, x: ef.stations_mm[0] ?? 0 };
  let min = { M: Infinity, x: ef.stations_mm[0] ?? 0 };
  for (let i = 0; i < n; i++) {
    const m = ef.bendingMoment[i] ?? 0;
    if (m > max.M) max = { M: m, x: ef.stations_mm[i] };
    if (m < min.M) min = { M: m, x: ef.stations_mm[i] };
  }
  const marge = VELD_MARGE * grootste(ef.bendingMoment);
  for (const p of veldPunten(ef.stations_mm, ef.bendingMoment, ef.shearForce)) {
    if (p.waarde > max.M + marge) max = { M: p.waarde, x: p.x };
    if (p.waarde < min.M - marge) min = { M: p.waarde, x: p.x };
  }
  return { max, min };
}

/**
 * Stationaire punten van w tussen de stations (θ = 0) die de grootste
 * stationswaarde van |w| met meer dan `VELD_MARGE` overtreffen — de
 * kandidaten voor de grootste doorbuiging. Leeg als `rotation` ontbreekt (een
 * resultaat van vóór de hoekverdraaiing): dan blijft het bij de stations.
 */
export function zakkingPunten(ef: {
  stations_mm: readonly number[];
  deflection: readonly number[];
  rotation?: readonly number[];
}): VeldPunt[] {
  const top = grootste(ef.deflection);
  const marge = VELD_MARGE * top;
  return veldPunten(ef.stations_mm, ef.deflection, ef.rotation, "zakking")
    .filter((p) => Math.abs(p.waarde) > top + marge);
}

/** Lineaire interpolatie van een stationsreeks op interval i, fractie s. */
export function tussenStations(reeks: readonly number[], i: number, s: number): number {
  const a = reeks[i] ?? 0;
  const b = reeks[i + 1] ?? a;
  return a + s * (b - a);
}

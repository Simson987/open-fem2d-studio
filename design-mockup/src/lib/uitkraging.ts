/**
 * uitkraging.ts — de zakking van een uitkraging, gemeten vanaf het ingeklemde
 * eind en niet vanaf de koorde tussen de verplaatste staafeinden.
 *
 * WAAROM. De doorbuigingstoetsen meten bij een gewone ligger de zakking vanaf
 * de koorde tussen de twee verplaatste staafeinden (`chordRelativeMaxMm`): de
 * starre verplaatsing en rotatie van de staaf tellen dan niet mee, alleen de
 * kromming ertussen. Bij een UITKRAGING beweegt het vrije eind zelf mee, en
 * trekt de koorde vrijwel de hele zakking weg. Gemeten bij een HEA 200 S355,
 * L = 3 m, ingeklemd, q = 5 kN/m en F = 10 kN op het vrije eind: de zakking
 * van het vrije eind is 18,15 mm, de koordemaat 3,25 mm — 82 % viel weg en de
 * toets keurde een te slappe uitkraging goed (controle 2026-10, punt K5).
 *
 * WAT HIER GEMETEN WORDT. NEN-EN 1990:2002/NB:2019 A1.4.3 begrenst de zakking
 * van de uitkraging ten opzichte van haar oplegging, met ℓ_rep = tweemaal de
 * uitkraaglengte. De zakking is daarom w(x) − w(x_inklemming): de verplaatsing
 * van het ingeklemde eind wordt afgetrokken (die hoort bij de constructie
 * waaraan de uitkraging hangt), zijn ROTATIE niet. Draait het ingeklemde eind
 * mee — een uitkraging over een oplegging van een doorgaande ligger — dan is
 * die rotatie juist een groot deel van de zakking van het vrije eind, en die
 * hoort erbij. Bij een volledige inklemming is dit de absolute zakking.
 */
import type { Staafeinden } from "./types/steel/Staafeinden";

/**
 * Welk eind de inklemming is: het begin (x = 0) of het eind (x = L) van de
 * staaf in haar referentierichting, of — als geen vrij eind te herkennen is
 * maar de gebruiker de klasse "uitkraging" koos — het eind met de kleinste
 * verplaatsing in de gemeten combinatie.
 */
export type Inklemming = "begin" | "eind" | "kleinste";

/**
 * De inklemming van een staaf, of `null` voor een gewone overspanning. Eén
 * vrij eind (geen oplegging en geen aansluitende staaf) maakt de staaf een
 * uitkraging, met het andere eind als inklemming. Zonder herkend vrij eind telt
 * alleen de expliciete klasse "uitkraging". Twee vrije einden zijn een
 * mechanisme; dan geen uitspraak.
 */
export function inklemmingVanStaaf(
  einden: Staafeinden,
  klasseUitkraging: boolean,
): Inklemming | null {
  const beginVrij = einden.begin === "Vrij";
  const eindVrij = einden.eind === "Vrij";
  if (beginVrij && !eindVrij) return "eind";
  if (eindVrij && !beginVrij) return "begin";
  return klasseUitkraging ? "kleinste" : null;
}

/**
 * max |w(x) − w(inklemming)| over de stations, teken behouden (mm, negatief =
 * omlaag, dezelfde tekenafspraak als de kern).
 */
export function uitkragingZakkingMm(w: readonly number[], inklemming: Inklemming): number {
  const n = w.length;
  if (n === 0) return 0;
  const begin = w[0];
  const eind = w[n - 1];
  let ref: number;
  if (inklemming === "begin") ref = begin;
  else if (inklemming === "eind") ref = eind;
  else ref = Math.abs(begin) <= Math.abs(eind) ? begin : eind;
  // Een onbruikbare eindwaarde: dan de absolute zakking, niet stil nul.
  if (!Number.isFinite(ref)) ref = 0;
  let max = 0;
  for (const v of w) {
    if (!Number.isFinite(v)) continue;
    const d = v - ref;
    if (Math.abs(d) > Math.abs(max)) max = d;
  }
  return max;
}

/** De regel voor `deflection_notes` bij een uitkraging. */
export function uitkragingNotitie(inklemming: Inklemming, deel?: DoorbuigingsDeel): string {
  const getal = (v: number) => String(Math.round(v)).replace(".", ",");
  // Het overstek van een lijn in delen: de inklemming is de knoop waar het
  // overstek aan hangt, niet een eind van de hele staaf.
  const plaats =
    deel && deel.soort === "overstek"
      ? `de inklemming van het overstek op x = ${getal(inklemming === "eind" ? deel.totMm : deel.vanMm)} mm (de knoop waar het ` +
        "overstek aan de rest van de constructie hangt)"
      : inklemming === "begin"
        ? "het begin van de staaf (x = 0)"
        : inklemming === "eind"
          ? "het eind van de staaf (x = L)"
          : "het eind met de kleinste verplaatsing (er is geen vrij staafeind herkend; de klasse 'uitkraging' is gekozen)";
  return (
    `Uitkraging: w is de zakking ten opzichte van het ingeklemde eind, ${plaats}: ` +
    "w(x) − w(inklemming). De verplaatsing van dat eind is afgetrokken, zijn rotatie niet — " +
    "die hoort bij de zakking van het vrije eind. Niet gemeten vanaf de koorde tussen de " +
    "verplaatste staafeinden: bij een uitkraging beweegt het vrije eind zelf mee, en dan zou " +
    "de zakking grotendeels wegvallen. ℓ_rep = 2·L voor w_fin én w_add " +
    "(NEN-EN 1990:2002/NB:2019 A1.4.3)."
  );
}

/**
 * Een deel van een (virtuele) staaf waarvan de zakking apart wordt getoetst,
 * in mm langs de staaf in haar referentierichting.
 *
 * WAAROM. Een doorgaande lijn (`lib/doorgaandeLijn.ts`) die over een kolomkop
 * doorloopt in een overstek, is voor knik en kip één staaf, maar voor de
 * doorbuiging niet: NEN-EN 1990:2002/NB:2019 A1.4.3 neemt voor ℓ_rep "de lengte
 * van een overspanning of tweemaal de lengte van een uitkraging". Het veld
 * (tot de kolomkop) en het overstek (vanaf de kolomkop) hebben elk hun eigen
 * ℓ_rep en hun eigen meetlijn. Tot oktober 2026 werd zo'n lijn als één
 * uitkraging van de hele lijnlengte getoetst: ℓ_rep = 2 × 8 m waar het veld
 * 6 m en het overstek 2 × 2 m heeft — grenzen 2,7 tot 4 keer te ruim (controle
 * 2026-10, punt K5).
 */
export interface DoorbuigingsDeel {
  /** Begin van het deel (mm vanaf x = 0 van de staaf). */
  vanMm: number;
  /** Eind van het deel (mm vanaf x = 0 van de staaf). */
  totMm: number;
  /**
   * Is het deel een uitkraging, dan het eind van het DEEL dat de inklemming
   * is (`"begin"` = bij `vanMm`); `null` = een veld, gemeten vanaf de koorde
   * tussen de twee eindpunten van het deel.
   */
  inklemming: Inklemming | null;
  /** "veld" of "overstek" van een lijn, of "staaf" als het de hele staaf is. */
  soort: "veld" | "overstek" | "staaf";
}

/**
 * De delen waarop de doorbuiging van een staaf getoetst wordt.
 *
 * Is de staaf een uitkraging (één vrij eind, `inklemming` "begin" of "eind")
 * en ligt er tussen de einden een steunpunt — een tussenknoop van een
 * doorgaande lijn waar een andere staaf of een plaat aansluit, zie
 * `steunpuntenOpLijn` — dan is alleen het stuk vanaf het steunpunt dat het
 * dichtst bij het vrije eind ligt de uitkraging (het overstek, met dat
 * steunpunt als inklemming), en de rest een veld (vanaf de koorde, met het
 * opgelegde lijneind en het steunpunt als eindpunten). Een aansluiting verder
 * in het veld telt daarbij niet als steunpunt van het veld: of zij de lijn
 * werkelijk draagt, zegt een vlak model niet, en de koorde over het hele veld
 * is dan de veilige kant.
 *
 * In elk ander geval één deel: de hele staaf, met de gegeven inklemming.
 */
export function doorbuigingsDelen(
  lengteMm: number,
  inklemming: Inklemming | null,
  steunpuntenMm: readonly number[],
): DoorbuigingsDeel[] {
  // Een steunpunt binnen 1 mm van een staafeind is dat eind.
  const binnen = steunpuntenMm.filter((x) => x > 1 && x < lengteMm - 1);
  if (inklemming === "begin" && binnen.length > 0) {
    const p = Math.max(...binnen);
    return [
      { vanMm: 0, totMm: p, inklemming: null, soort: "veld" },
      { vanMm: p, totMm: lengteMm, inklemming: "begin", soort: "overstek" },
    ];
  }
  if (inklemming === "eind" && binnen.length > 0) {
    const p = Math.min(...binnen);
    return [
      { vanMm: 0, totMm: p, inklemming: "eind", soort: "overstek" },
      { vanMm: p, totMm: lengteMm, inklemming: null, soort: "veld" },
    ];
  }
  return [{ vanMm: 0, totMm: lengteMm, inklemming, soort: "staaf" }];
}

/** ℓ_rep van een deel: zijn lengte, of tweemaal die lengte als het een uitkraging is. */
export function lRepVanDeelMm(deel: DoorbuigingsDeel): number {
  const l = deel.totMm - deel.vanMm;
  return deel.inklemming ? 2 * l : l;
}

/** De regel voor `deflection_notes` bij een lijn die in delen is getoetst. */
export function delenNotitie(
  delen: readonly DoorbuigingsDeel[],
  perDeel: readonly { wFinMm: number; wAddMm: number }[],
  maatgevend: number,
): string {
  const nl = (v: number, d = 0) => v.toFixed(d).replace(".", ",");
  const regels = delen.map((d, i) => {
    const meetlijn = d.inklemming
      ? `gemeten vanaf de inklemming op x = ${nl(d.inklemming === "begin" ? d.vanMm : d.totMm)} mm`
      : "gemeten vanaf de koorde tussen de eindpunten van het deel";
    return (
      `${d.soort} x = ${nl(d.vanMm)}–${nl(d.totMm)} mm, ${meetlijn}, ℓ_rep = ` +
      (d.inklemming ? `2 × ${nl(d.totMm - d.vanMm)} = ` : "") +
      `${nl(lRepVanDeelMm(d))} mm: w = ${nl(perDeel[i].wFinMm, 2)} mm, w_add = ${nl(perDeel[i].wAddMm, 2)} mm`
    );
  });
  return (
    "Doorgaande lijn met een overstek: de doorbuiging is per deel getoetst, want ℓ_rep is " +
    "de lengte van de overspanning of tweemaal die van de uitkraging (NEN-EN 1990:2002/NB:2019 " +
    "A1.4.3), niet de lijnlengte. " +
    regels.join("; ") +
    `. Maatgevend (de grootste verhouding tot de grens) is het ${delen[maatgevend].soort}; dat deel ` +
    "staat in deze toets, met zijn eigen lengte en ℓ_rep."
  );
}

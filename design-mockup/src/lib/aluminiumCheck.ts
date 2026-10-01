/**
 * Afgebakende EN 1999-1-1:2007+A1:2009 berekening voor een ongelaste,
 * zijdelings gesteunde I-ligger in zuivere buiging. Geen volledige staaf-UC:
 * andere doorsneden, HAZ, dwarskrachtinteractie en instabiliteit worden geweigerd.
 * Bron: European Aluminium, Introduction to Eurocode 9, voorbeeld 1, p. 55-56.
 */
export interface AluminiumILiggerInvoer {
  legering: "EN AW-6063-T6";
  lasstatus: "geen" | "aanwezig" | "onbekend";
  /** Bevestigd voor deze belastingrichting, over de gehele ligger. */
  zijdelingsGesteund: boolean;
  lengteMm: number;
  flensBreedteMm: number;
  flensDikteMm: number;
  lijfDikteMm: number;
  totaleHoogteMm: number;
  /** Exacte bruto Iy, bijvoorbeeld uit de profieleditor. */
  iyMm4: number;
  /** Absoluut maatgevend eerste-orde buigmoment; geen normaalkracht/torsie. */
  momentEdNmm: number;
  /** Maatgevende BGT gelijkmatig verdeelde last, N/mm. */
  qSlsNmm: number;
  /** Projecteis, bijvoorbeeld 360 voor L/360. Geen normdefault. */
  doorbuigingsNoemer: number;
}

export interface AluminiumILiggerUitkomst {
  norm: "EN 1999-1-1:2007+A1:2009";
  /** Alleen buiging en doorbuiging; nooit een volledige staafgoedkeuring. */
  status: "deelcontrole_voldoet" | "deelcontrole_overschreden" | "niet_getoetst";
  nietBeoordeeld: string[];
  redenen: string[];
  epsilon: number;
  betaFlens: number;
  betaLijf: number;
  momentRdNmm: number | null;
  doorbuigingMm: number;
  doorbuigingGrensMm: number;
  ucMoment: number | null;
  ucDoorbuiging: number;
}

const E_ALU = 70000; // N/mm², Europese Aluminium voorbeeld 1
const FO_6063_T6 = 160; // N/mm², idem; alleen dit profiel en deze normeditie
const GAMMA_M1 = 1.1; // idem; niet als algemene Nederlandse NB-waarde gebruiken

function positief(v: number): boolean { return Number.isFinite(v) && v > 0; }

export function toetsAluminiumILigger(i: AluminiumILiggerInvoer): AluminiumILiggerUitkomst {
  if (i.legering !== "EN AW-6063-T6" ||
      !["geen", "aanwezig", "onbekend"].includes(i.lasstatus)) {
    throw new Error("Alleen EN AW-6063-T6 met een expliciete lasstatus is in deze referentietoets bekend.");
  }
  const maten = [i.lengteMm, i.flensBreedteMm, i.flensDikteMm, i.lijfDikteMm,
    i.totaleHoogteMm, i.iyMm4, i.doorbuigingsNoemer];
  if (maten.some((v) => !positief(v)) ||
      !Number.isFinite(i.momentEdNmm) || i.momentEdNmm < 0 ||
      !Number.isFinite(i.qSlsNmm) || i.qSlsNmm < 0 ||
      i.totaleHoogteMm <= 2 * i.flensDikteMm ||
      i.flensBreedteMm <= i.lijfDikteMm) {
    throw new Error("Ongeldige aluminiumligger: maten, Iy en lasten moeten fysisch geldig zijn.");
  }
  const epsilon = Math.sqrt(250 / FO_6063_T6);
  // Symmetrische I: twee uitkragende flenshelften; lijf onder zuivere buiging
  // heeft psi = -1 en beta = (0,7 + 0,3 psi) * vrije lijfhoogte / t_w.
  const betaFlens = i.flensBreedteMm / (2 * i.flensDikteMm);
  const betaLijf = 0.4 * (i.totaleHoogteMm - 2 * i.flensDikteMm) / i.lijfDikteMm;
  const redenen: string[] = [];
  if (i.lasstatus !== "geen") redenen.push("HAZ bij lassen is nog niet berekend; lasstatus moet expliciet 'geen' zijn.");
  if (!i.zijdelingsGesteund) redenen.push("Kip is nog niet getoetst; volledige zijdelingse steun is vereist.");
  if (betaFlens > 6 * epsilon || betaLijf > 22 * epsilon) {
    redenen.push("Doorsnede is niet bewezen als klasse 3 of gunstiger; lokale plooi vergt de effectieve doorsnede.");
  }
  const doorbuigingMm = 5 * i.qSlsNmm * i.lengteMm ** 4 / (384 * E_ALU * i.iyMm4);
  const doorbuigingGrensMm = i.lengteMm / i.doorbuigingsNoemer;
  const ucDoorbuiging = doorbuigingMm / doorbuigingGrensMm;
  const momentRdNmm = redenen.length === 0
    ? i.iyMm4 / (i.totaleHoogteMm / 2) * FO_6063_T6 / GAMMA_M1
    : null;
  const ucMoment = momentRdNmm === null ? null : i.momentEdNmm / momentRdNmm;
  return {
    norm: "EN 1999-1-1:2007+A1:2009",
    status: redenen.length ? "niet_getoetst" :
      (ucMoment! <= 1 && ucDoorbuiging <= 1 ? "deelcontrole_voldoet" : "deelcontrole_overschreden"),
    nietBeoordeeld: ["Dwarskracht en interactie", "Normaalkracht en interactie",
      "Verbindingen en bevestigingen", "Brand", "EN 1999:2025 en Nederlandse Nationale Bijlage"],
    redenen, epsilon, betaFlens, betaLijf, momentRdNmm,
    doorbuigingMm, doorbuigingGrensMm, ucMoment, ucDoorbuiging,
  };
}

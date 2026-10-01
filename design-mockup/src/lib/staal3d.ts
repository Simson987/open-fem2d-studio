import { valideerStaafResultaat3D, type StaafResultaat3D } from "./toetsResultaat3d";

/** Conservatieve 3D-doorsnedecontrole volgens EN 1993-1-1 6.2.1(7).
 * Weerstanden zijn expliciete ontwerpwaarden voor een doorsnede van klasse 1–3.
 * Dwarskracht, torsie en staafstabiliteit vereisen aparte controles; deze
 * functie kan daarom nooit een volledige goedkeuring afgeven. */
export interface StaalDoorsnede3DInvoer {
  resultaat: StaafResultaat3D;
  doorsnedeKlasse: 1 | 2 | 3;
  nRdKN: number;
  myRdKNm: number;
  mzRdKNm: number;
}
export interface StaalDoorsnede3DUitkomst {
  status: "deelcontrole_voldoet" | "deelcontrole_overschreden";
  uc: number;
  maatgevendXM: number;
  nietBeoordeeld: string[];
}

export function toetsStaalDoorsnede3D(i: StaalDoorsnede3DInvoer): StaalDoorsnede3DUitkomst {
  valideerStaafResultaat3D(i.resultaat);
  if (![1, 2, 3].includes(i.doorsnedeKlasse) ||
      ![i.nRdKN, i.myRdKNm, i.mzRdKNm].every((v) => Number.isFinite(v) && v > 0)) {
    throw new Error("Geef een doorsnede van klasse 1–3 en drie positieve ontwerpweerstanden op.");
  }
  let uc = -1;
  let maatgevendXM = 0;
  for (const s of i.resultaat.stations) {
    const waarde = Math.abs(s.n) / i.nRdKN +
      Math.abs(s.my) / i.myRdKNm + Math.abs(s.mz) / i.mzRdKNm;
    if (waarde > uc) { uc = waarde; maatgevendXM = s.xM; }
  }
  return {
    status: uc > 1 ? "deelcontrole_overschreden" : "deelcontrole_voldoet",
    uc, maatgevendXM,
    nietBeoordeeld: [
      "Dwarskracht en interactie met buiging",
      "Torsie en interactie met dwarskracht",
      "Knik, kip en gecombineerde staafstabiliteit in twee assen",
      "Doorsnedeclassificatie en weerstandsaandeel van gaten",
      "Nationale Bijlage en toepasselijkheid van de opgegeven weerstanden",
    ],
  };
}

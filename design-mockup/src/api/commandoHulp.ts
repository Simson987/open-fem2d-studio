/**
 * Hulp bij het schrijven van API-commando's: een documentcommando krijgt het
 * document direct (het register heeft al gecontroleerd dat het er is), en een
 * ontbrekend element geeft overal dezelfde fout.
 *
 * Zuiver: geen React, geen DOM. Gaat mee in de sidecarbundel.
 */
import { ApiFout, type ApiCommando, type ApiUitkomst } from "./register";
import { eigenDoorsnedenNaarWinkel, metGebruikteEigenDoorsneden, type ApiDocument } from "./projectDocument";
import type { ApiObjectSchema } from "./schema";

export interface DocumentCommandoDefinitie<I, U> {
  naam: string;
  beschrijving: string;
  invoer: ApiObjectSchema;
  uitvoeren(invoer: I, document: ApiDocument): ApiUitkomst<U>;
}

export function documentCommando<I, U>(definitie: DocumentCommandoDefinitie<I, U>): ApiCommando<I, U> {
  return {
    naam: definitie.naam,
    beschrijving: definitie.beschrijving,
    invoer: definitie.invoer,
    soort: "document",
    // De eigen doorsneden reizen met het document mee, zoals bij Openen en
    // Opslaan in de app: vóór het commando in de winkel, erna in het document
    // voor zover zijn staven ernaar verwijzen.
    uitvoeren: (invoer, context) => {
      eigenDoorsnedenNaarWinkel(context.document!);
      const uitkomst = definitie.uitvoeren(invoer, context.document!);
      return uitkomst.document ? { ...uitkomst, document: metGebruikteEigenDoorsneden(uitkomst.document) } : uitkomst;
    },
  };
}

/** `NIET_GEVONDEN` met het soort element en zijn id, bijvoorbeeld "3D-staaf 4 bestaat niet." */
export function nietGevonden(soort: string, id: number, veld = "id"): ApiFout {
  return new ApiFout("NIET_GEVONDEN", `${soort} ${id} bestaat niet.`, { [veld]: id });
}

/** De id's die in `voor` staan en niet meer in `na`. */
export function verdwenenIds(voor: readonly { id: number }[] = [], na: readonly { id: number }[] = []): number[] {
  const over = new Set(na.map((item) => item.id));
  return voor.filter((item) => !over.has(item.id)).map((item) => item.id);
}

/** Het element dat in `na` staat en niet in `voor` (het nieuwe element van een toevoeging). */
export function nieuwElement<T extends { id: number }>(voor: readonly T[] = [], na: readonly T[] = []): T {
  const bestond = new Set(voor.map((item) => item.id));
  const nieuw = na.find((item) => !bestond.has(item.id));
  if (!nieuw) throw new ApiFout("GEWEIGERD", "Er is niets toegevoegd.");
  return nieuw;
}

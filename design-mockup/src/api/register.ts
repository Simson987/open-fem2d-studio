/**
 * Het commandoregister van de API: de enige bron voor alles wat een AI (of
 * een script) in Open FEM Studio kan doen. Het bedieningskanaal van de app en
 * de MCP-tools volgen uit de catalogus van dit register.
 *
 * Een commando heeft een naam (`domein.object.actie`, Engels, zoals
 * `model3d.node.add`), een Nederlandse beschrijving, een streng invoerschema
 * en een soort:
 *  - `document`: zuiver, van projectdocument naar projectdocument plus een
 *    uitkomst; werkt in de app én zonder app (sidecar, op een bestand);
 *  - `app`: alleen in de draaiende app (weergave, selectie, ongedaan maken).
 *
 * Foutcodes (ApiFout.code): ONBEKEND_COMMANDO, INVOER_ONGELDIG (detail:
 * problemen), GEEN_DOCUMENT, NIET_GEVONDEN, GEWEIGERD (een modelregel
 * weigert; de melding van de modelfunctie), ALLEEN_IN_APP.
 *
 * Zuiver: geen React, geen DOM. Gaat mee in de sidecarbundel.
 */
import { isStrikt, valideer, type ApiSchema } from "./schema";
import type { ApiDocument } from "./projectDocument";

export type ApiSoort = "document" | "app";

export interface ApiContext {
  /** Het projectdocument; nodig voor een documentcommando. */
  document?: ApiDocument;
  /** De draaiende app (alleen via het bedieningskanaal), voor app-commando's. */
  app?: unknown;
}

export interface ApiUitkomst<U = unknown> {
  uitkomst: U;
  /** Het nieuwe document; ontbreekt als het commando het document niet wijzigt. */
  document?: ApiDocument;
  /**
   * Het document is een nieuw project, geen bewerking van het huidige: de app
   * laadt het zoals Bestand → Nieuw (zonder bestand, zonder ongedaan maken).
   * Zonder bestand, omdat Opslaan anders het vorige bestand zou overschrijven.
   */
  nieuwProject?: true;
}

export interface ApiCommando<I = any, U = unknown> {
  naam: string;
  beschrijving: string;
  /** Streng objectschema: op elk niveau `additionalProperties: false`. */
  invoer: ApiSchema;
  soort: ApiSoort;
  uitvoeren(invoer: I, context: ApiContext): ApiUitkomst<U> | Promise<ApiUitkomst<U>>;
}

export class ApiFout extends Error {
  readonly code: string;
  readonly detail?: unknown;
  constructor(code: string, melding: string, detail?: unknown) {
    super(melding);
    this.name = "ApiFout";
    this.code = code;
    this.detail = detail;
  }
}

export interface ApiCatalogusItem {
  naam: string;
  beschrijving: string;
  invoer: ApiSchema;
  soort: ApiSoort;
}

export interface ApiRegister {
  /** Alle commando's, gesorteerd op naam, zonder hun uitvoering. */
  catalogus(): ApiCatalogusItem[];
  heeft(naam: string): boolean;
  /**
   * Valideer de invoer en voer het commando uit. Fouten bij het opzoeken en
   * valideren komen synchroon als ApiFout; een zuiver commando geeft synchroon
   * antwoord, een app-commando mag een belofte geven.
   */
  voerUit(naam: string, invoer: unknown, context: ApiContext): ApiUitkomst<unknown> | Promise<ApiUitkomst<unknown>>;
}

const NAAM = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

/** Een fout uit een commando als ApiFout; een gewone Error wordt GEWEIGERD. */
function alsApiFout(fout: unknown): ApiFout {
  if (fout instanceof ApiFout) return fout;
  return new ApiFout("GEWEIGERD", fout instanceof Error ? fout.message : String(fout));
}

function afstand(a: string, b: string): number {
  const vorige = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let linksBoven = vorige[0];
    vorige[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const boven = vorige[j];
      vorige[j] = Math.min(boven + 1, vorige[j - 1] + 1, linksBoven + (a[i - 1] === b[j - 1] ? 0 : 1));
      linksBoven = boven;
    }
  }
  return vorige[b.length];
}

/** Hoogstens drie bestaande namen die op `naam` lijken. */
function suggesties(naam: string, namen: readonly string[]): string[] {
  return namen
    .map((kandidaat) => ({ kandidaat, d: afstand(naam, kandidaat) }))
    .filter(({ d }) => d <= Math.max(3, Math.floor(naam.length / 3)))
    .sort((p, q) => p.d - q.d || (p.kandidaat < q.kandidaat ? -1 : 1))
    .slice(0, 3)
    .map(({ kandidaat }) => kandidaat);
}

export function maakRegister(commandos: readonly ApiCommando[]): ApiRegister {
  const perNaam = new Map<string, ApiCommando>();
  for (const commando of commandos) {
    if (!NAAM.test(commando.naam)) {
      throw new Error(`Ongeldige commandonaam "${commando.naam}": verwacht domein.object.actie, kleine beginletter.`);
    }
    if (perNaam.has(commando.naam)) throw new Error(`Dubbele commandonaam "${commando.naam}".`);
    if (!("type" in commando.invoer) || commando.invoer.type !== "object") {
      throw new Error(`De invoer van ${commando.naam} moet een objectschema zijn.`);
    }
    const los = isStrikt(commando.invoer);
    if (los.length > 0) {
      throw new Error(`Het invoerschema van ${commando.naam} is niet streng op: ${los.map((p) => p || "(invoer)").join(", ")}.`);
    }
    perNaam.set(commando.naam, commando);
  }
  const namen = [...perNaam.keys()].sort();

  return {
    catalogus: () => namen.map((naam) => {
      const { beschrijving, invoer, soort } = perNaam.get(naam)!;
      return { naam, beschrijving, invoer, soort };
    }),
    heeft: (naam) => perNaam.has(naam),
    voerUit(naam, invoer, context) {
      const commando = perNaam.get(naam);
      if (!commando) {
        throw new ApiFout("ONBEKEND_COMMANDO", `Onbekend commando "${naam}".`, { suggesties: suggesties(naam, namen) });
      }
      const gegeven = invoer ?? {};
      const problemen = valideer(commando.invoer, gegeven);
      if (problemen.length > 0) {
        throw new ApiFout(
          "INVOER_ONGELDIG",
          `Ongeldige invoer voor ${naam}: ${problemen.map((p) => `${p.pad || "(invoer)"} ${p.melding}`).join("; ")}.`,
          { problemen },
        );
      }
      if (commando.soort === "document" && !context.document) {
        throw new ApiFout("GEEN_DOCUMENT", `${naam} werkt op een project, maar er is geen project meegegeven.`);
      }
      let uitkomst: ApiUitkomst<unknown> | Promise<ApiUitkomst<unknown>>;
      try {
        uitkomst = commando.uitvoeren(gegeven, context);
      } catch (fout) {
        throw alsApiFout(fout);
      }
      return uitkomst instanceof Promise ? uitkomst.catch((fout: unknown) => { throw alsApiFout(fout); }) : uitkomst;
    },
  };
}

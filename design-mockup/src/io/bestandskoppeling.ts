/**
 * bestandskoppeling.ts — de interfacekant van "openen met een dubbelklik"
 * (issue #90).
 *
 * Rust (`src-tauri/src/bestandskoppeling.rs`) haalt de te openen bestanden uit
 * de argumenten van de start, uit een tweede start terwijl de app al draait
 * (tauri-plugin-single-instance) of uit RunEvent::Opened op macOS. Hij geeft
 * precies die projectbestanden vrij in de fs-scope en zet de paden in een
 * wachtrij. Deze module haalt de wachtrij op bij het starten van de interface
 * en opnieuw na elk event, en geeft elk pad aan de BESTAANDE open-weg van de
 * app (`handleOpenFilePath` in App.tsx: de vraag over niet-opgeslagen werk,
 * recente bestanden, 2D of 3D uit het bestand).
 *
 * Waarom een wachtrij en niet alleen een event: bij de eerste start zet Rust de
 * paden klaar vóór de pagina geladen is; een event van toen zou niemand horen.
 * Ophalen leegt de wachtrij, dus een pad komt nooit twee keer.
 *
 * Zonder React en zonder Tauri, zodat test-bestandskoppeling.mjs het gedrag met
 * een nagebootste Rust-kant kan toetsen; de hook staat in
 * `hooks/useBestandskoppeling.ts`.
 */
import { PROJECT_FILE_EXTS } from "./projectFile";

/** Het Tauri-command dat de wachtrij ophaalt en leegt (src-tauri/src/lib.rs). */
export const COMMANDO_OPHALEN = "bestandskoppeling_ophalen";
/** Het event waarmee Rust meldt dat er paden klaarstaan (bestandskoppeling.rs). */
export const EVENT_BESTANDEN = "bestandskoppeling:bestanden";

/** Het laatste deel van een pad, met `\` of `/` als scheiding. */
export function bestandsnaam(pad: string): string {
  return pad.split(/[\\/]/).pop() ?? pad;
}

/** Een projectbestand: de extensie is er een van Openen, hoofdletters maken niet uit. */
export function isProjectbestand(pad: string): boolean {
  const naam = bestandsnaam(pad);
  const punt = naam.lastIndexOf(".");
  if (punt <= 0) return false;
  return PROJECT_FILE_EXTS.includes(naam.slice(punt + 1).toLowerCase());
}

/**
 * Een poort die dicht is zolang `isDicht()` waar is. In App.tsx: zolang er al
 * een vraag over niet-opgeslagen werk openstaat (bijvoorbeeld die van het
 * kruisje) of het venster op het punt van sluiten staat.
 *
 * Waarom: de vraag kan maar één keer tegelijk openstaan; `confirmUnsavedAction`
 * zegt "niet doorgaan" zolang er al een openstaat. Een bestand dat in die tijd
 * via de koppeling binnenkomt, is al uit de wachtrij van Rust; het zou zonder
 * melding wegvallen. Met de poort wacht het tot de vraag beantwoord is: kiest
 * de gebruiker Annuleren, dan opent het daarna (met een eigen vraag); sluit de
 * app, dan blijft de poort dicht en opent er niets.
 */
export interface Wachtpoort {
  /** Vervuld zodra de poort open is; meteen als hij al open is. */
  wacht: () => Promise<void>;
  /**
   * Roep aan na elke verandering die de poort kan openen. Wie wacht, kijkt
   * opnieuw en wacht verder als de poort nog dicht is.
   */
  misschienOpen: () => void;
}

export function maakWachtpoort(isDicht: () => boolean): Wachtpoort {
  const wachtenden = new Set<() => void>();
  return {
    wacht: async () => {
      while (isDicht()) {
        await new Promise<void>((verder) => { wachtenden.add(verder); });
      }
    },
    misschienOpen: () => {
      const nu = [...wachtenden];
      wachtenden.clear();
      for (const verder of nu) verder();
    },
  };
}

export interface BestandskoppelingAfhankelijkheden {
  /** Haal de klaarstaande paden op; Rust leegt daarbij zijn wachtrij. */
  haalOp: () => Promise<string[]>;
  /** Luister naar "er staan paden klaar"; geeft de afmelder terug. */
  luister: (bijMelding: () => void) => Promise<() => void>;
  /**
   * De bestaande open-weg van de app, mét de vraag over niet-opgeslagen werk.
   * In App.tsx: wachten op de poort (`maakWachtpoort`), het welkomstscherm en
   * de backstage dicht, dan `handleOpenFilePath`.
   */
  open: (pad: string) => Promise<void>;
  /** Een pad dat geen projectbestand is ("Openen met" op een ander bestandstype). */
  meldGeenProject: (pad: string) => void;
}

export interface Bestandskoppeling {
  /** Vervuld als er geluisterd wordt en de eerste wachtrij verwerkt is. */
  gereed: Promise<void>;
  stop: () => void;
}

/**
 * Start de koppeling: eerst luisteren, dan de wachtrij ophalen — in die
 * volgorde, zodat er tussen die twee niets kan wegvallen.
 *
 * Elke ophaalronde wacht op de vorige, en binnen een ronde opent elk bestand
 * pas als het vorige klaar is: twee vragen over niet-opgeslagen werk door
 * elkaar heen zou de gebruiker niet kunnen volgen. Een gestopte koppeling
 * haalt niets meer op (React StrictMode start een effect, stopt het meteen en
 * start het opnieuw; de wachtrij hoort dan bij de tweede start).
 */
export function startBestandskoppeling(deps: BestandskoppelingAfhankelijkheden): Bestandskoppeling {
  let gestopt = false;
  let afmelden: (() => void) | null = null;
  let rij: Promise<void> = Promise.resolve();

  const verwerk = (): Promise<void> => {
    rij = rij.then(async () => {
      if (gestopt) return;
      let paden: string[];
      try {
        paden = await deps.haalOp();
      } catch (fout) {
        console.error("[bestandskoppeling] ophalen mislukt:", fout);
        return;
      }
      // Opgehaald is uit de wachtrij van Rust: afmaken, ook na stop().
      for (const pad of paden) {
        if (!isProjectbestand(pad)) {
          deps.meldGeenProject(pad);
          continue;
        }
        try {
          await deps.open(pad);
        } catch (fout) {
          console.error(`[bestandskoppeling] openen van ${pad} mislukt:`, fout);
        }
      }
    });
    return rij;
  };

  const gereed = (async () => {
    try {
      const af = await deps.luister(() => { void verwerk(); });
      if (gestopt) af();
      else afmelden = af;
    } catch (fout) {
      console.error("[bestandskoppeling] luisteren mislukt:", fout);
    }
    await verwerk();
  })();

  return {
    gereed,
    stop: () => {
      gestopt = true;
      afmelden?.();
      afmelden = null;
    },
  };
}

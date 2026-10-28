/**
 * useSnapInstellingen — welke snaps staan aan, gedeeld door het canvas en de
 * statusbalk.
 *
 * WAAROM EEN EIGEN WINKELTJE EN GEEN PROP
 * De knopjes staan in de statusbalk onderin (`components/StatusBar.tsx`) en de
 * snap zelf zit in `FemCanvas`. Die twee zijn in de boom broer en zus, met
 * `App.tsx` ertussen; de instelling erdoorheen prop-drillen zou App.tsx nog een
 * stuk canvas-toestand geven die daar niets te zoeken heeft. Dit is bewust een
 * piepklein extern winkeltje op `useSyncExternalStore`: geen bibliotheek, geen
 * context-provider, en beide kanten lezen exact dezelfde waarde.
 *
 * De instelling wordt BEWAARD tussen sessies (localStorage van dit venster) en
 * hoort niet in het projectbestand: het is een tekenhulp, geen modelgegeven.
 * Kapotte of ontbrekende opslag geeft gewoon de beginstand.
 *
 * HOEKSNAP (#53)
 * Naast de drie puntsnaps (knoop, stramien, raster — die vangen een PUNT) is
 * er de hoeksnap: die zet de RICHTING van een staaf in aanbouw op 0°/90°
 * (desgewenst ook 30°, 45°, 60°) als hij daar binnen de tolerantie bij ligt.
 * Hij hoort alleen bij het 2D-tekenvlak; `SNAP_SOORTEN` blijft daarom de lijst
 * van de puntsnaps (statusbalk en 3D), `SNAP_SCHAKELAARS` is die lijst plus de
 * hoeksnap (tab Weergave in 2D). De rekenregels staan in `lib/tekenhulp.ts`.
 *
 * OBJECTSPOOR (#84)
 * Alleen op het 3D-tekenvlak: uitlijnen op verworven knopen en staven
 * (spoorlijnen, snijpunten, verlengen, loodrecht, parallel), zie
 * `components/openFem3d/openFem3dTekenhulp.ts`. Standaard aan; een oude stand
 * zonder de sleutel krijgt hem ook aan. `SNAP_SCHAKELAARS_3D` zijn de
 * schakelaars van de 3D-werkruimte (statusbalk en tab Weergave).
 *
 * VERBINDINGSTOLERANTIE (#55, in 3D sinds #63)
 * Ook hier bewaard, maar geen snap: binnen deze afstand (mm) geldt een knoop
 * als "op de staaf" of "op dezelfde plek" voor de modelcontrole, de rekenpoort,
 * het plaatsen van een knoop en het herstel. De regels en de grenzen (0,1–25
 * mm, standaard 5) staan in `lib/modelControle.ts`. Een andere waarde
 * verplaatst niets: alleen de controle en de volgende plaatsing of het
 * volgende herstel gebruiken hem.
 *
 * Sinds issue #63 geldt dezelfde waarde ook in 3D: daar bepaalt hij welke
 * knoop "op een staaf" ligt voor de modelcontrole van het 3D-tekenvlak, de
 * waarschuwing vóór het rekenen, de knop Knopen aansluiten en het automatisch
 * aansluiten (`components/openFem3d/openFem3dAansluiten.ts`). Eén instelling
 * voor beide werkruimten, net als de snaps: het is dezelfde vraag (hoe ver
 * mag een getekende knoop naast de staaf liggen), en een project dat van 2D
 * naar 3D gaat, houdt zo dezelfde maat. Anders dan in 2D wordt een knoop in
 * 3D nooit verschoven: de staaf wordt op de knoop zelf gesplitst. En de
 * afstand tot een staafeind meet 3D langs de staafas, niet tot de eindknoop:
 * zo geeft een knoop net naast de as vlak bij een eind geen steil stompje.
 *
 * KNOPEN AUTOMATISCH SAMENVOEGEN EN AANSLUITEN (#63 en #75, alleen 3D)
 * `knopenAansluiten` (standaard aan): na het tekenen, verplaatsen of kopiëren
 * van knopen en staven, een levelwijziging en na het importeren worden
 * knopen die dan op een staaf liggen meteen aangesloten (de staaf wordt daar
 * gesplitst), in dezelfde stap ongedaan maken. Sinds #75 voegt dezelfde
 * schakelaar eerst een punt binnen de verbindingstolerantie van een bestaande
 * knoop samen met die knoop (niet na het importeren). Eén schakelaar: het is
 * dezelfde vraag met dezelfde tolerantie, en de sleutel blijft
 * `knopenAansluiten`, zodat een bewaarde keuze geldig blijft. Geen snap:
 * "alle snaps" laat hem staan. Bewaard zoals de snaps, want het is een
 * tekenhulp en geen modelgegeven.
 */
import { useSyncExternalStore } from "react";
import { begrensHoekTolerantie, HOEKSNAP_STANDAARD_TOLERANTIE } from "../lib/tekenhulp";
import { begrensVerbindingstolerantie, CONTROLE_TOL_MM } from "../lib/modelControle";

/** De puntsnaps, in de volgorde waarin ze voorrang hebben. */
export const SNAP_SOORTEN = ["knoop", "stramien", "raster"] as const;
export type SnapSoort = (typeof SNAP_SOORTEN)[number];

/** Alle snapschakelaars van 2D: de puntsnaps plus de hoeksnap van een staaf (#53). */
export const SNAP_SCHAKELAARS = [...SNAP_SOORTEN, "hoek"] as const;
/** De snapschakelaars van 3D: de puntsnaps plus het objectspoor (#84). */
export const SNAP_SCHAKELAARS_3D = [...SNAP_SOORTEN, "spoor"] as const;
export type SnapSchakelaar3D = (typeof SNAP_SCHAKELAARS_3D)[number];
export type SnapSchakelaar = (typeof SNAP_SCHAKELAARS)[number] | SnapSchakelaar3D;

export interface SnapInstellingen {
  /** Vangen op een bestaande knoop — de sterkste snap. */
  knoop: boolean;
  /** Vangen op een stramienas (verticale as of niveaulijn). */
  stramien: boolean;
  /** Vangen op het achtergrondraster — de zwakste snap. */
  raster: boolean;
  /** Hoeksnap bij het tekenen van een staaf: richting op 0°/90° (#53). */
  hoek: boolean;
  /** Objectspoor op het 3D-tekenvlak (#84). */
  spoor: boolean;
  /** Tolerantie van de hoeksnap in graden (0,1–15). */
  hoekTolerantie: number;
  /** Ook 30°, 45° en 60° (en hun spiegelingen). */
  hoekExtra: boolean;
  /**
   * Verbindingstolerantie in mm (0,1–25, #55; sinds #63 ook in 3D): binnen
   * deze afstand ligt een knoop op een staaf of op dezelfde plek als een andere.
   */
  verbindingsTolerantie: number;
  /** 3D: knopen automatisch samenvoegen (#75) en op staven aansluiten (#63) na een bewerking. */
  knopenAansluiten: boolean;
}

/** NL-labels + uitleg voor de knopjes in de statusbalk (terugval als een vertaling ontbreekt). */
export const SNAP_LABELS: Record<SnapSoort | "spoor", { kort: string; uitleg: string }> = {
  knoop: {
    kort: "Knoop",
    uitleg: "Vangen op bestaande knopen. Wint van stramien en raster.",
  },
  stramien: {
    kort: "Stramien",
    uitleg: "Vangen op stramienassen en niveaulijnen. Wint van het raster.",
  },
  raster: {
    kort: "Raster",
    uitleg: "Vangen op het achtergrondraster — de zwakste snap.",
  },
  spoor: {
    kort: "Objectspoor",
    uitleg: "Uitlijnen op verworven knopen en staven (alleen in 3D).",
  },
};

export const SNAP_BEGINSTAND: SnapInstellingen = {
  knoop: true, stramien: true, raster: true,
  hoek: true, spoor: true, hoekTolerantie: HOEKSNAP_STANDAARD_TOLERANTIE, hoekExtra: false,
  verbindingsTolerantie: CONTROLE_TOL_MM,
  knopenAansluiten: true,
};

const OPSLAG_SLEUTEL = "open-fem-studio.snapInstellingen";

/**
 * Lees een bewaarde stand. Alleen bekende velden met het juiste type tellen;
 * de rest komt uit de beginstand. Kapotte JSON → de beginstand.
 */
export function snapInstellingenUitOpslag(tekst: string | null): SnapInstellingen {
  if (!tekst) return SNAP_BEGINSTAND;
  let ruw: unknown;
  try {
    ruw = JSON.parse(tekst);
  } catch {
    return SNAP_BEGINSTAND;
  }
  if (!ruw || typeof ruw !== "object" || Array.isArray(ruw)) return SNAP_BEGINSTAND;
  const r = ruw as Record<string, unknown>;
  const vlag = (k: SnapSchakelaar) => (typeof r[k] === "boolean" ? r[k] as boolean : SNAP_BEGINSTAND[k]);
  return {
    knoop: vlag("knoop"),
    stramien: vlag("stramien"),
    raster: vlag("raster"),
    hoek: vlag("hoek"),
    spoor: vlag("spoor"),
    hoekTolerantie: typeof r.hoekTolerantie === "number"
      ? begrensHoekTolerantie(r.hoekTolerantie) : SNAP_BEGINSTAND.hoekTolerantie,
    hoekExtra: typeof r.hoekExtra === "boolean" ? r.hoekExtra : SNAP_BEGINSTAND.hoekExtra,
    verbindingsTolerantie: typeof r.verbindingsTolerantie === "number"
      ? begrensVerbindingstolerantie(r.verbindingsTolerantie) : SNAP_BEGINSTAND.verbindingsTolerantie,
    knopenAansluiten: typeof r.knopenAansluiten === "boolean" ? r.knopenAansluiten : SNAP_BEGINSTAND.knopenAansluiten,
  };
}

function laad(): SnapInstellingen {
  try {
    if (typeof localStorage === "undefined") return SNAP_BEGINSTAND;
    return snapInstellingenUitOpslag(localStorage.getItem(OPSLAG_SLEUTEL));
  } catch {
    return SNAP_BEGINSTAND;
  }
}

function bewaar(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(OPSLAG_SLEUTEL, JSON.stringify(stand));
  } catch {
    // Privé venster of volle opslag: de stand geldt dan alleen deze sessie.
  }
}

let stand: SnapInstellingen = laad();
const luisteraars = new Set<() => void>();

function meld() {
  bewaar();
  for (const l of luisteraars) l();
}

function abonneer(l: () => void): () => void {
  luisteraars.add(l);
  return () => { luisteraars.delete(l); };
}

function lees(): SnapInstellingen {
  return stand;
}

/** Zet één snapsoort (of de hoeksnap, of het objectspoor) aan of uit. */
export function zetSnap(soort: SnapSchakelaar, aan: boolean): void {
  if (stand[soort] === aan) return;
  stand = { ...stand, [soort]: aan };
  meld();
}

/** Wissel één snapsoort. */
export function wisselSnap(soort: SnapSchakelaar): void {
  zetSnap(soort, !stand[soort]);
}

/**
 * Zet alle snaps in één keer aan of uit. Standaard de schakelaars van 2D, de
 * hoeksnap inbegrepen; de 3D-weergave geeft `SNAP_SCHAKELAARS_3D` mee (de
 * puntsnaps en het objectspoor), want daar bestaat de hoeksnap niet.
 */
export function zetAlleSnaps(aan: boolean, soorten: readonly SnapSchakelaar[] = SNAP_SCHAKELAARS): void {
  if (soorten.every((s) => stand[s] === aan)) return;
  const volgend = { ...stand };
  for (const s of soorten) volgend[s] = aan;
  stand = volgend;
  meld();
}

/** Tolerantie van de hoeksnap in graden, begrensd op 0,1–15. */
export function zetHoekTolerantie(graden: number): void {
  const waarde = begrensHoekTolerantie(graden);
  if (stand.hoekTolerantie === waarde) return;
  stand = { ...stand, hoekTolerantie: waarde };
  meld();
}

/** Ook 30°, 45° en 60° voor de hoeksnap. */
export function zetHoekExtra(aan: boolean): void {
  if (stand.hoekExtra === aan) return;
  stand = { ...stand, hoekExtra: aan };
  meld();
}

/** Verbindingstolerantie in mm (2D en 3D), begrensd op 0,1–25 (#55). */
export function zetVerbindingsTolerantie(mm: number): void {
  const waarde = begrensVerbindingstolerantie(mm);
  if (stand.verbindingsTolerantie === waarde) return;
  stand = { ...stand, verbindingsTolerantie: waarde };
  meld();
}

/** 3D: knopen automatisch samenvoegen en op staven aansluiten aan of uit (#63, #75). */
export function zetKnopenAansluiten(aan: boolean): void {
  if (stand.knopenAansluiten === aan) return;
  stand = { ...stand, knopenAansluiten: aan };
  meld();
}

/** Huidige stand buiten React om (voor tests en niet-reactieve lezers). */
export function leesSnapInstellingen(): SnapInstellingen {
  return stand;
}

/** Terug naar de beginstand — alleen voor tests. */
export function herstelSnapBeginstand(): void {
  stand = SNAP_BEGINSTAND;
  meld();
}

/** React-hook: leest de actuele stand en hertekent bij elke wijziging. */
export function useSnapInstellingen(): SnapInstellingen {
  return useSyncExternalStore(abonneer, lees, lees);
}

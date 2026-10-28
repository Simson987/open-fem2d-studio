/**
 * openFem3dUitkraging.ts — welk eind van een 3D-staaf vrij is, en vanaf welk
 * eind de doorbuiging van een uitkraging gemeten wordt. Gedeeld door de staal-
 * en de houttoets, zodat beide dezelfde staaf als uitkraging zien.
 *
 * WAAROM. Een vrij eind maakt een staaf een uitkraging: de zakking wordt dan
 * vanaf de inklemming gemeten en ℓ_rep = 2·L (NEN-EN 1990:2002/NB:2019
 * A1.4.3). Een eind dat in werkelijkheid gedragen wordt maar als vrij telt,
 * geeft dus een twee keer te ruime doorbuigingsgrens. Tot oktober 2026 keken
 * de 3D-toetsen alleen naar opleggingen en naar het aantal staven op de knoop:
 * een ligger die op een wand (plaat) eindigde, gold als uitkraging (controle
 * 2026-10, punt K5). En zonder herkend vrij eind telde de gekozen klasse
 * "uitkraging" niet mee voor de meetlijn: een balkon met een randligger over de
 * koppen werd vanaf de koorde gemeten, en 81 % van de zakking viel weg.
 *
 * EEN KNOOP IS NIET VRIJ als
 *  - er een oplegging op staat;
 *  - er een andere staaf op aansluit;
 *  - de staaf zelf op bedding ligt (de grond draagt haar over de hele lengte);
 *  - hij in of op een plaat ligt — hoekknoop, randknoop of tussenknoop: het
 *    rekennet maakt elke modelknoop in het plaatvlak die binnen of op de
 *    buitenrand ligt (en niet in een opening) tot een harde knoop van de plaat
 *    (`openFem3dPlateMesh.ts`). Een randoplegging of plaatbedding hoort bij
 *    zo'n plaat en is daarmee ook gedekt.
 */
import type { OpenFem3DBeam, OpenFem3DModel, OpenFem3DPlate } from "./openFem3dModel";
import { classifyOpenFem3DPlatePoint, openFem3DPlatePlane, type OpenFem3DPlatePlane } from "./openFem3dPlateMesh";
import type { LoadCombination } from "../fem/solver/combinations";
import { phiLosseKolom, VERTICAAL_VANAF_GRADEN } from "../../lib/scheefstandNorm";

/**
 * Het eind van de staaf dat de inklemming is ("begin" = de startknoop), of —
 * zonder herkend vrij eind maar met de klasse "uitkraging" — het eind met de
 * kleinste verplaatsing in de gemeten combinatie ("kleinste"), dezelfde regel
 * als in 2D (`lib/uitkraging.ts`).
 */
export type OpenFem3DInklemming = "begin" | "eind" | "kleinste";

/** Vlakafstand (m) waarbinnen een knoop in het plaatvlak ligt — die van het rekennet (10·1e-6). */
const VLAK_TOL_M = 1e-5;

/** De herkenning van vrije einden voor één model, met zijn eigen tussenstanden. */
export interface OpenFem3DEinden {
  /** Ligt de knoop in of op een plaat (hoek-, rand- of tussenknoop)? */
  knoopInPlaat(nodeId: number): boolean;
  /** Is dit eind van de staaf vrij? */
  vrijEind(beam: OpenFem3DBeam, nodeId: number): boolean;
  /** De inklemming van de staaf, of `null` voor een gewone overspanning. */
  inklemming(beam: OpenFem3DBeam): OpenFem3DInklemming | null;
}

/**
 * De herkenning van vrije einden voor `model`. De vlakken van de platen en de
 * uitkomst per knoop worden binnen deze ene aanroep onthouden; maak per
 * toetsronde een nieuwe.
 */
export function openFem3DEinden(model: OpenFem3DModel): OpenFem3DEinden {
  const vlakken = new Map<number, OpenFem3DPlatePlane | null>();
  const perKnoop = new Map<number, boolean>();
  const vlakVan = (plate: OpenFem3DPlate): OpenFem3DPlatePlane | null => {
    if (!vlakken.has(plate.id)) {
      try {
        vlakken.set(plate.id, openFem3DPlatePlane(model, plate));
      } catch {
        // Een plaat zonder bruikbaar vlak kan geen knoop dragen; het rekennet
        // weigert haar ook.
        vlakken.set(plate.id, null);
      }
    }
    return vlakken.get(plate.id) ?? null;
  };
  const ligtInPlaat = (plate: OpenFem3DPlate, punt: { x: number; y: number; z: number }): boolean => {
    const vlak = vlakVan(plate);
    if (!vlak) return false;
    const afstand =
      (punt.x - vlak.origin.x) * vlak.normal.x +
      (punt.y - vlak.origin.y) * vlak.normal.y +
      (punt.z - vlak.origin.z) * vlak.normal.z;
    if (Math.abs(afstand) > VLAK_TOL_M) return false;
    try {
      const ligging = classifyOpenFem3DPlatePoint(model, plate, punt);
      return ligging === "inside" || ligging === "boundary";
    } catch {
      return false;
    }
  };
  const knoopInPlaat = (nodeId: number): boolean => {
    const bekend = perKnoop.get(nodeId);
    if (bekend !== undefined) return bekend;
    const knoop = model.nodes.find((node) => node.id === nodeId);
    const uit = knoop !== undefined && (model.plates ?? []).some((plate) =>
      plate.nodeIds.includes(nodeId)
      || (plate.openings ?? []).some((opening) => opening.nodeIds.includes(nodeId))
      || ligtInPlaat(plate, knoop));
    perKnoop.set(nodeId, uit);
    return uit;
  };
  const vrijEind = (beam: OpenFem3DBeam, nodeId: number): boolean => {
    if ((model.supports ?? []).some((support) => support.nodeId === nodeId)) return false;
    if (beam.bedding) return false;
    if (model.beams.some((other) => other.id !== beam.id && (other.startNodeId === nodeId || other.endNodeId === nodeId))) {
      return false;
    }
    return !knoopInPlaat(nodeId);
  };
  const inklemming = (beam: OpenFem3DBeam): OpenFem3DInklemming | null => {
    const beginVrij = vrijEind(beam, beam.startNodeId);
    const eindVrij = vrijEind(beam, beam.endNodeId);
    if (beginVrij && !eindVrij) return "eind";
    if (eindVrij && !beginVrij) return "begin";
    return beam.checkConfig?.deflectionClass === "cantilever" ? "kleinste" : null;
  };
  return { knoopInPlaat, vrijEind, inklemming };
}

/**
 * Of de 3D-UGT-krachten de zijdelingse knik van een STALEN staaf met een vrij
 * eind al bevatten: het kernveld `zijdelingse_knik_in_analyse`. Om een gedekte
 * as kiest de kern dan L in plaats van 2·L (NEN-EN 1993-1-1 5.2.2(7)b). Gedekt
 * (beide assen) is het alleen als
 *  - ELKE getoetste UGT-combinatie tweede orde (P-Δ) is gerekend: eerste orde
 *    vergroot niets;
 *  - elke UGT-combinatie een scheefstand draagt, en de scheefstand in beide
 *    horizontale richtingen (X en Y) voorkomt: zonder scheefstand verplaatst
 *    een centrisch gedrukte kolom niet zijdelings, en tweede orde vergroot nul;
 *  - de staaf overwegend verticaal staat (≥ 75°): de scheefstand is een
 *    horizontale metgezel bij de verticale last en stoot alleen de
 *    zijdelingse knikvorm van een kolom aan, niet die van een liggende
 *    uitkraging met druk. Zo'n staaf houdt 2·L;
 *  - de φ van de berekening (`phi`) minstens die van de kolom ZELF is
 *    (`phiLosseKolom`: h = haar lengte, m = 1). De φ van het model middelt
 *    over alle kolommen en de hoogte van het gebouw; een kolom met een vrije
 *    kop hangt nergens aan en middelt met niets. Bij een om haar as gedraaide
 *    kolom telt de component langs haar hoofdassen: φ·max(|cos α|, |sin α|).
 *
 * Alleen voor staal; hout houdt 2·L (zie `zijdelingseKnikInVlakModel`).
 *
 * `analyseVan` geeft de analyse van de berekende combinatie ("p-delta" of
 * "linear"). Uitkomst per staaf: het veld, of — als alles klopt behalve de
 * φ-eis — een kanttekening die zegt waarom het 2·L blijft.
 */
export function openFem3DZijdelingseKnik(
  model: Pick<OpenFem3DModel, "nodes">,
  uls: readonly LoadCombination[],
  analyseVan: (combinatieId: number) => string | undefined,
  phi: number | undefined,
): (beam: OpenFem3DBeam) => { veld?: { y: boolean; z: boolean }; notitie?: string } {
  const tweedeOrde = uls.length > 0 && uls.every((c) => analyseVan(c.id) === "p-delta");
  const allemaalScheef = uls.every((c) => c.scheefstandRichting !== undefined);
  const assen = new Set(uls.map((c) => c.scheefstandAs ?? "x"));
  const gedekt = tweedeOrde && allemaalScheef && assen.has("x") && assen.has("y");
  const minSinus = Math.sin((VERTICAAL_VANAF_GRADEN * Math.PI) / 180);
  const getal = (x: number, d: number) => x.toFixed(d).replace(".", ",");
  return (beam) => {
    if (!gedekt) return {};
    const a = model.nodes.find((n) => n.id === beam.startNodeId);
    const b = model.nodes.find((n) => n.id === beam.endNodeId);
    if (!a || !b) return {};
    const lengte = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (!(lengte > 0) || Math.abs(b.z - a.z) / lengte < minSinus) return {};
    const nodig = phiLosseKolom(lengte);
    // Een om haar as gedraaide kolom: de scheefstand werkt in ±X en ±Y, dus
    // langs elke hoofdas met hooguit φ·max(|cos α|, |sin α|) — bij 45° maar
    // 0,71·φ. Die component moet aan de eis voldoen, niet de globale φ.
    const rol = beam.rollAngleRad ?? 0;
    const factor = Number.isFinite(rol) ? Math.max(Math.abs(Math.cos(rol)), Math.abs(Math.sin(rol))) : 0;
    const langsAs = phi !== undefined && Number.isFinite(phi) ? phi * factor : undefined;
    if (langsAs !== undefined && langsAs >= nodig * (1 - 1e-9)) return { veld: { y: true, z: true } };
    const gedraaid = factor < 1 - 1e-9;
    return {
      notitie:
        "VRIJ STAAFEIND, TWEEDE ORDE: de berekening is P-Δ met scheefstand in X en Y, maar de " +
        (langsAs !== undefined && langsAs > 0
          ? `scheefstand φ = 1/${getal(1 / langsAs, 0)} ` +
            (gedraaid
              ? `langs de hoofdassen van deze kolom (zij is ${getal((rol * 180) / Math.PI, 1)}° om haar as ` +
                `gedraaid, dus φ_model·${getal(factor, 3)}) is kleiner dan `
              : "van het model is kleiner dan ")
          : "scheefstand φ van het model is niet bekend en dus niet aantoonbaar minstens ") +
        `φ = 1/${getal(1 / nodig, 0)} die deze kolom zelf hoort te krijgen (NEN-EN 1993-1-1 (5.5) met ` +
        `h = ${getal(lengte, 3)} m, haar eigen lengte, en m = 1: een kolom met een vrije kop hangt ` +
        "nergens aan en middelt haar scheefstand met niets). Haar zijdelingse knik zit dus niet volledig in " +
        "de krachten, en de kniklengte blijft om beide assen 2·L. Wie L wil gebruiken, rekent met een " +
        "scheefstand van minstens die φ of geeft de kniklengtes zelf op.",
    };
  };
}

/** De rapportregel bij een uitkraging, voor staal en hout. */
export function openFem3DUitkragingNotitie(inklemming: OpenFem3DInklemming): string {
  const plaats = inklemming === "begin"
    ? "het begin van de staaf (de startknoop)"
    : inklemming === "eind"
      ? "het eind van de staaf (de eindknoop)"
      : "het eind met de kleinste verplaatsing (er is geen vrij staafeind herkend; de klasse 'uitkraging' is gekozen)";
  return (
    `Uitkraging: w is de verplaatsing loodrecht op de staafas ten opzichte van het ingeklemde eind, ${plaats} ` +
    "(de verplaatsing van dat eind afgetrokken, zijn rotatie niet), niet vanaf de koorde tussen de " +
    "verplaatste staafeinden. ℓ_rep = 2·L (NEN-EN 1990:2002/NB:2019 A1.4.3)."
  );
}

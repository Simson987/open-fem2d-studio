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
 *  - er een andere staaf op aansluit die ergens aan vastzit (een staaf die
 *    alleen aan deze knoop hangt, zoals de uitkragende ligger op een luifel-
 *    of T-kolom, houdt niets vast; issue #199), of die in het verlengde
 *    doorloopt;
 *  - de staaf zelf op bedding ligt (de grond draagt haar over de hele lengte);
 *  - hij in of op een plaat ligt — hoekknoop, randknoop of tussenknoop: het
 *    rekennet maakt elke modelknoop in het plaatvlak die binnen of op de
 *    buitenrand ligt (en niet in een opening) tot een harde knoop van de plaat
 *    (`openFem3dPlateMesh.ts`). Een randoplegging of plaatbedding hoort bij
 *    zo'n plaat en is daarmee ook gedekt.
 */
import { openFem3DMemberAxes, type OpenFem3DBeam, type OpenFem3DModel, type OpenFem3DPlate } from "./openFem3dModel";
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
  /**
   * Loopt de staaf aan dit eind zonder steun in het verlengde door (issue
   * #205)? Zie `doorlopendEind` hieronder.
   */
  doorlopendEind(beam: OpenFem3DBeam, nodeId: number): boolean;
  /** De inklemming van de staaf, of `null` voor een gewone overspanning. */
  inklemming(beam: OpenFem3DBeam): OpenFem3DInklemming | null;
  /**
   * Het deel dat alleen aan `nodeId` hangt, zonder de staven in `uitgesloten`
   * (issue #199, de luifel- of T-kolom); `null` als het ergens aan vastzit.
   * Zie `hangendDeel3D`.
   */
  hangendDeel(
    nodeId: number,
    uitgesloten: ReadonlySet<number>,
    verboden?: ReadonlySet<number>,
    stop?: ReadonlySet<number>,
    staafMagNiet?: (b: OpenFem3DBeam) => boolean,
  ): { staafIds: number[]; knoopIds: number[] } | null;
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
  // HET HANGENDE DEEL (issue #199): vanaf `nodeId` over alle staaven behalve
  // `uitgesloten`. Bereikt de tocht een oplegging, een knoop in of op een
  // plaat, een staaf op bedding of een knoop uit `verboden`, dan zit het deel
  // ergens aan vast (`null`). Knopen in `stop` worden bereikt maar niet
  // doorlopen; `staafMagNiet` weigert een bereikte staaf. De 3D-tegenhanger
  // van `hangendDeel` in `lib/doorgaandeLijn.ts`.
  const opgelegd = new Set((model.supports ?? []).map((support) => support.nodeId));
  const hangendDeel = (
    nodeId: number,
    uitgesloten: ReadonlySet<number>,
    verboden: ReadonlySet<number> = new Set(),
    stop: ReadonlySet<number> = new Set(),
    staafMagNiet: (b: OpenFem3DBeam) => boolean = () => false,
  ): { staafIds: number[]; knoopIds: number[] } | null => {
    const staven = new Set<number>();
    const knopen = new Set<number>([nodeId]);
    const rij = [nodeId];
    while (rij.length > 0) {
      const n = rij.pop()!;
      for (const b of model.beams) {
        if (uitgesloten.has(b.id) || staven.has(b.id) || (b.startNodeId !== n && b.endNodeId !== n)) continue;
        if (b.bedding || staafMagNiet(b)) return null;
        staven.add(b.id);
        const ander = b.startNodeId === n ? b.endNodeId : b.startNodeId;
        if (knopen.has(ander)) continue;
        knopen.add(ander);
        if (stop.has(ander)) continue;
        if (opgelegd.has(ander) || verboden.has(ander) || knoopInPlaat(ander)) return null;
        rij.push(ander);
      }
    }
    knopen.delete(nodeId);
    for (const id of stop) knopen.delete(id);
    return { staafIds: [...staven].sort((a, b) => a - b), knoopIds: [...knopen].sort((a, b) => a - b) };
  };
  const vrijEind = (beam: OpenFem3DBeam, nodeId: number): boolean => {
    if (opgelegd.has(nodeId)) return false;
    if (beam.bedding) return false;
    if (knoopInPlaat(nodeId)) return false;
    if (!model.beams.some((other) => other.id !== beam.id && (other.startNodeId === nodeId || other.endNodeId === nodeId))) {
      return true;
    }
    // DE LUIFEL- OF T-KOLOM (issue #199). Een voortzetting in het verlengde is
    // doorlopend (`doorlopendEind`), niet vrij. Hangt verder alles wat hier
    // aansluit alleen aan deze knoop — een uitkragende ligger op de kop van een
    // kolom, zonder oplegging, plaat of verbinding terug naar de staaf — dan
    // houdt het de knoop nergens vast en is het eind vrij. Tot oktober 2026
    // telde elke aansluitende staaf, en kreeg zo'n kolom L in plaats van 2·L.
    if (doorlopendEind(beam, nodeId)) return false;
    const ander = beam.startNodeId === nodeId ? beam.endNodeId : beam.startNodeId;
    return hangendDeel(nodeId, new Set([beam.id]), new Set([ander])) !== null;
  };
  // DOORLOPEND (issue #205): geen oplegging, geen bedding, niet in een plaat,
  // en ALLEEN staven in het verlengde op de knoop (binnen 1e-6 op het
  // uitwendig product van de eenheidsrichtingen). Zo'n eind is geen gaffel en
  // niet zijdelings gesteund. In 2D voegt de bouwer staven met dezelfde
  // doorsnede eerst samen tot een doorgaande lijn; in 3D gebeurt dat niet, dus
  // geldt hier elke voortzetting in het verlengde als doorlopend — ook met
  // dezelfde doorsnede. Anders kreeg elk deel de eigen lengte als
  // kniklengte, alsof de tussenknoop gesteund is.
  const richting = (b: OpenFem3DBeam): { x: number; y: number; z: number } | null => {
    const a = model.nodes.find((node) => node.id === b.startNodeId);
    const e = model.nodes.find((node) => node.id === b.endNodeId);
    if (!a || !e) return null;
    const d = { x: e.x - a.x, y: e.y - a.y, z: e.z - a.z };
    const l = Math.hypot(d.x, d.y, d.z);
    return l > 0 ? { x: d.x / l, y: d.y / l, z: d.z / l } : null;
  };
  const doorlopendEind = (beam: OpenFem3DBeam, nodeId: number): boolean => {
    if ((model.supports ?? []).some((support) => support.nodeId === nodeId)) return false;
    if (beam.bedding) return false;
    const anderen = model.beams.filter((other) => other.id !== beam.id
      && (other.startNodeId === nodeId || other.endNodeId === nodeId));
    if (anderen.length === 0) return false;
    const r = richting(beam);
    if (!r) return false;
    const inVerlengde = anderen.every((other) => {
      const d = richting(other);
      return d !== null && Math.hypot(r.y * d.z - r.z * d.y, r.z * d.x - r.x * d.z, r.x * d.y - r.y * d.x) <= 1e-6;
    });
    return inVerlengde && !knoopInPlaat(nodeId);
  };
  const inklemming = (beam: OpenFem3DBeam): OpenFem3DInklemming | null => {
    const beginVrij = vrijEind(beam, beam.startNodeId);
    const eindVrij = vrijEind(beam, beam.endNodeId);
    if (beginVrij && !eindVrij) return "eind";
    if (eindVrij && !beginVrij) return "begin";
    return beam.checkConfig?.deflectionClass === "cantilever" ? "kleinste" : null;
  };
  return { knoopInPlaat, vrijEind, doorlopendEind, inklemming, hangendDeel };
}

/**
 * Of de 3D-UGT-krachten de zijdelingse knik van een STALEN staaf met een vrij
 * eind al bevatten: het kernveld `zijdelingse_knik_in_analyse`. Om een gedekte
 * as kiest de kern dan L in plaats van 2·L (NEN-EN 1993-1-1 5.2.2(7)b). Gedekt
 * is een as alleen als
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
 *    kop hangt nergens aan en middelt met niets. PER AS (issue #194): de
 *    scheefstand langs een hoofdas e van de kolom is max(φ_X·|e_X|, φ_Y·|e_Y|),
 *    bij een om haar as gedraaide kolom dus minder dan φ. Om de as y (uitbuigen
 *    langs de lokale z) en om de as z (langs de lokale y) geldt de eis apart;
 *    een as die voldoet, is gedekt, ook als de andere dat niet is.
 *
 * Alleen voor staal; hout houdt 2·L (zie `zijdelingseKnikInVlakModel`).
 *
 * In de app krijgt deze functie de TOETSSET (`toetsSet3D`, issue #199): die
 * is altijd P-Δ met scheefstand in X en Y, met de φ van de toets.
 * De eerste twee voorwaarden zijn daar dus altijd waar; ze blijven staan als
 * bewaking voor een aanroeper met een eigen combinatieset. De voorwaarde
 * "staand" en de φ-eis blijven echte voorwaarden (tot de eigen φ per losse
 * kolom er is).
 *
 * `analyseVan` geeft de analyse van de berekende combinatie ("p-delta" of
 * "linear"). Uitkomst per staaf: het veld, of — als alles klopt behalve de
 * φ-eis — een kanttekening die zegt waarom het 2·L blijft.
 */
export function openFem3DZijdelingseKnik(
  model: Pick<OpenFem3DModel, "nodes">,
  uls: readonly LoadCombination[],
  analyseVan: (combinatieId: number) => string | undefined,
  phi: number | { x: number; y: number } | undefined,
  /**
   * Per staaf de φ van haar lasten als die afwijkt van `phi`: de eigen
   * scheefstand van een losse kolom (issue #199, fase 3). Daarmee haalt die
   * kolom de φ-eis hieronder altijd.
   */
  phiPerStaaf?: ReadonlyMap<number, { x: number; y: number }>,
): (beam: OpenFem3DBeam) => { veld?: { y: boolean; z: boolean }; notitie?: string } {
  const tweedeOrde = uls.length > 0 && uls.every((c) => analyseVan(c.id) === "p-delta");
  const allemaalScheef = uls.every((c) => c.scheefstandRichting !== undefined);
  const assen = new Set(uls.map((c) => c.scheefstandAs ?? "x"));
  const gedekt = tweedeOrde && allemaalScheef && assen.has("x") && assen.has("y");
  const minSinus = Math.sin((VERTICAAL_VANAF_GRADEN * Math.PI) / 180);
  const getal = (x: number, d: number) => x.toFixed(d).replace(".", ",");
  // φ_X en φ_Y (issue #194); één getal geldt in beide richtingen.
  const modelX = typeof phi === "number" ? phi : phi?.x;
  const modelY = typeof phi === "number" ? phi : phi?.y;
  return (beam) => {
    const eigen = phiPerStaaf?.get(beam.id);
    const phiX = eigen?.x ?? modelX;
    const phiY = eigen?.y ?? modelY;
    const bekend = phiX !== undefined && phiY !== undefined && Number.isFinite(phiX) && Number.isFinite(phiY);
    if (!gedekt) return {};
    const a = model.nodes.find((n) => n.id === beam.startNodeId);
    const b = model.nodes.find((n) => n.id === beam.endNodeId);
    if (!a || !b) return {};
    const lengte = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (!(lengte > 0) || Math.abs(b.z - a.z) / lengte < minSinus) return {};
    const nodig = phiLosseKolom(lengte);
    // De scheefstand werkt in ±X (φ_X) en ±Y (φ_Y), één richting tegelijk.
    // Langs een hoofdas e van de kolom werkt dus hooguit
    // max(φ_X·|e_X|, φ_Y·|e_Y|): bij een kolom die 45° om haar as gedraaid is
    // maar 0,71·φ. Uitbuigen om de sterke as y gaat langs de lokale z, om de
    // zwakke as z langs de lokale y; elke as krijgt zo haar eigen eis.
    const rol = beam.rollAngleRad ?? 0;
    let langsY: number | undefined; // langs de lokale y: knik om z
    let langsZ: number | undefined; // langs de lokale z: knik om y
    if (bekend && Number.isFinite(rol)) {
      const { ey, ez } = openFem3DMemberAxes(a, b, rol);
      langsY = Math.max(phiX! * Math.abs(ey[0]), phiY! * Math.abs(ey[1]));
      langsZ = Math.max(phiX! * Math.abs(ez[0]), phiY! * Math.abs(ez[1]));
    }
    const dektY = langsZ !== undefined && langsZ >= nodig * (1 - 1e-9);
    const dektZ = langsY !== undefined && langsY >= nodig * (1 - 1e-9);
    if (dektY && dektZ) return { veld: { y: true, z: true } };
    const factor = Number.isFinite(rol) ? Math.max(Math.abs(Math.cos(rol)), Math.abs(Math.sin(rol))) : 0;
    const gedraaid = factor < 1 - 1e-9;
    const noemer = (w: number) => `1/${getal(1 / w, 0)}`;
    let tekort: string;
    if (langsY === undefined || langsZ === undefined) {
      tekort = "scheefstand φ van het model is niet bekend en dus niet aantoonbaar minstens ";
    } else if (!dektY && !dektZ && Math.abs(langsY - langsZ) <= 1e-12 * Math.max(langsY, langsZ)) {
      // Beide assen even weinig: één getal, zoals bij één φ voor het hele model.
      tekort = langsY > 0
        ? `scheefstand φ = ${noemer(langsY)} ` +
          (gedraaid
            ? `langs de hoofdassen van deze kolom (zij is ${getal((rol * 180) / Math.PI, 1)}° om haar as ` +
              `gedraaid, dus φ_model·${getal(factor, 3)}) is kleiner dan `
            : "van het model is kleiner dan ")
        : "scheefstand φ van het model is niet bekend en dus niet aantoonbaar minstens ";
    } else {
      const delen = [
        ...(!dektY ? [`scheefstand langs de lokale z-as van deze kolom (uitbuigen om de sterke as y), φ = ${noemer(langsZ)}`] : []),
        ...(!dektZ ? [`scheefstand langs de lokale y-as van deze kolom (uitbuigen om de zwakke as z), φ = ${noemer(langsY)}`] : []),
      ];
      tekort = `${delen.join(", en de ")}, ${delen.length > 1 ? "zijn" : "is"} kleiner dan `;
    }
    const open = !dektY && !dektZ ? "om beide assen" : !dektY ? "om de as y" : "om de as z";
    const dicht = dektY ? " Om de as y is zij gedekt: daar geldt L." : dektZ ? " Om de as z is zij gedekt: daar geldt L." : "";
    return {
      ...(dektY || dektZ ? { veld: { y: dektY, z: dektZ } } : {}),
      notitie:
        "VRIJ STAAFEIND, TWEEDE ORDE: de berekening is P-Δ met scheefstand in X en Y, maar de " + tekort +
        `φ = 1/${getal(1 / nodig, 0)} die deze kolom zelf hoort te krijgen (NEN-EN 1993-1-1 (5.5) met ` +
        `h = ${getal(lengte, 3)} m, haar eigen lengte, en m = 1: een kolom met een vrije kop hangt ` +
        "nergens aan en middelt haar scheefstand met niets). Haar zijdelingse knik zit dus niet volledig in " +
        `de krachten, en de kniklengte blijft ${open} 2·L.${dicht} Wie L wil gebruiken, rekent met een ` +
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

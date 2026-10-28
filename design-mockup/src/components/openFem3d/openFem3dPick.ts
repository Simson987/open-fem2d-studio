import type { OpenFem3DSelectionType } from "./openFem3dSelection";

/**
 * Wat één klik in het 3D-tekenvlak selecteert.
 *
 * Het tekenvlak verzamelt per klik de kandidaten (raycasttreffers op lasten,
 * opleggingstekens, staven en platen; een pijl of staartlijn binnen enkele
 * pixels; de knoop onder de cursor; de staaf waarvan de systeemlijn binnen
 * de klikzone ligt) en laat de keuze aan deze functie.
 * Afstanden zijn in meters vanaf de camera, zoals een raycast ze geeft.
 *
 * Voorrang:
 *  1. Een lastteken onder de cursor wint — tenzij een getekende staaf of een
 *     opleggingsteken het op die pixel afdekt, of het duidelijk achter de
 *     staaf of knoop ligt (een last van een ander element verderop).
 *  2. Een knoop waarvan de getekende bol onder de klik ligt — tenzij een
 *     profiel er ver voor ligt.
 *  3. Een opleggingsteken onder de cursor selecteert zijn knoop — tenzij een
 *     profiel of (buiten de plaatband) een plaat ervoor ligt.
 *  4. De staaf: wat getekend onder de cursor ligt (profiel, analytische as,
 *     diagram), of anders de staaf waarvan de systeemlijn binnen de klikzone
 *     ligt. Ligt die systeemlijn vóór het geraakte profiel, dan wint zij: een
 *     dun verband voor een zware ligger blijft zo aanklikbaar. Een staaf
 *     achter een halfdoorzichtige plaat wint alleen binnen de plaatband.
 *  5. De plaat.
 */

export type OpenFem3DLoadSelectionType = "nodalLoad" | "memberLoad" | "memberPointLoad" | "thermalLoad" | "surfaceLoad";

export interface OpenFem3DPickPoint {
  x: number;
  y: number;
  z: number;
}

export interface OpenFem3DPickCandidates {
  /** Eerste raycasttreffer op een lastteken (pijl, lijn, ring). */
  load?: { type: OpenFem3DLoadSelectionType; id: number; distance: number } | null;
  /** Knoop waarvan de klikzone (zichtbare bol, met een minimum in pixels) onder de klik ligt. */
  node?: { id: number; distance: number; radiusM: number } | null;
  /** Eerste raycasttreffer op een opleggingsteken (blok, kegel, bol, voetplaat, veer) van knoop `nodeId`. */
  support?: { nodeId: number; distance: number } | null;
  /** Eerste raycasttreffer op een getekende staaf. `halfSizeM`: halve doorsnede. */
  rayBeam?: { id: number; distance: number; halfSizeM: number; point: OpenFem3DPickPoint } | null;
  /** Staaf waarvan de systeemlijn binnen de klikzone ligt; `distance` tot het punt op die lijn. */
  lineBeam?: { id: number; distance: number; halfSizeM: number; point: OpenFem3DPickPoint } | null;
  /** Eerste raycasttreffer op een plaat; `bandM`: tot hoever erachter een staaf nog zichtbaar meetelt. */
  plate?: { id: number; distance: number; bandM: number } | null;
  /** Tot hoever een lastteken achter de voorkant van een staaf of knoop nog wint (m). */
  loadDepthToleranceM: number;
}

export type OpenFem3DPickReason = "load" | "node" | "support" | "beam-ray" | "beam-line" | "plate";

export interface OpenFem3DPick {
  type: OpenFem3DSelectionType;
  id: number;
  /** Op de staafas of het geraakte oppervlak; bruikbaar om een staaf te splitsen. */
  point?: OpenFem3DPickPoint;
  reason: OpenFem3DPickReason;
}

type OpenFem3DBeamCandidate = NonNullable<OpenFem3DPickCandidates["rayBeam"]>;

/**
 * De staaf: het getekende profiel onder de cursor, of de systeemlijn binnen
 * de klikzone als die ervóór ligt. `front`: de voorkant van de staaf (m).
 */
function frontBeam(
  rayBeam: OpenFem3DBeamCandidate | null | undefined, lineBeam: OpenFem3DBeamCandidate | null | undefined,
): { id: number; front: number; point: OpenFem3DPickPoint; reason: "beam-ray" | "beam-line" } | null {
  if (rayBeam && lineBeam && lineBeam.id !== rayBeam.id
    && lineBeam.distance - lineBeam.halfSizeM < rayBeam.distance) {
    return { id: lineBeam.id, front: lineBeam.distance - lineBeam.halfSizeM, point: lineBeam.point, reason: "beam-line" };
  }
  if (rayBeam) return { id: rayBeam.id, front: rayBeam.distance, point: rayBeam.point, reason: "beam-ray" };
  if (lineBeam) return { id: lineBeam.id, front: lineBeam.distance - lineBeam.halfSizeM, point: lineBeam.point, reason: "beam-line" };
  return null;
}

/** Een knoop aan een staafeinde zit ín het profiel; alleen een profiel dat er ruim voor ligt, verbergt hem. */
function nodeHiddenByProfile(profile: { distance: number; halfSizeM: number } | null | undefined, nodeFront: number): boolean {
  return profile !== null && profile !== undefined
    && profile.distance < nodeFront - Math.max(2 * profile.halfSizeM, 0.1);
}

export function chooseOpenFem3DPick(candidates: OpenFem3DPickCandidates): OpenFem3DPick | null {
  const { load, node, support, rayBeam, lineBeam, plate, loadDepthToleranceM } = candidates;
  const beam = frontBeam(rayBeam, lineBeam);
  const nodeFront = node ? node.distance - node.radiusM : Infinity;

  if (load) {
    // Een geraakt profiel dekt alles erachter af; een systeemlijn naast de
    // cursor en een knoop niet, dus daar mag de pijl binnen de tolerantie
    // (een pijllengte) achter liggen.
    const beamLimit = !beam ? Infinity
      : beam.reason === "beam-ray" ? beam.front + 1e-9 : beam.front + loadDepthToleranceM;
    const nodeLimit = node ? nodeFront + loadDepthToleranceM : Infinity;
    // Een opleggingsteken is massief: een pijl erachter is op die pixel niet te zien.
    const supportLimit = support ? support.distance + 1e-9 : Infinity;
    if (load.distance <= Math.min(beamLimit, nodeLimit, supportLimit)) {
      return { type: load.type, id: load.id, reason: "load" };
    }
  }

  if (node && !nodeHiddenByProfile(rayBeam, nodeFront)) return { type: "node", id: node.id, reason: "node" };

  if (support) {
    // Het teken ligt onder de cursor. Alleen wat op die pixel ervoor getekend
    // is, dekt het af: een profiel, of een plaat ruim (buiten de band) ervoor.
    // Een systeemlijn naast de cursor niet.
    const coveredByProfile = rayBeam !== null && rayBeam !== undefined && rayBeam.distance < support.distance;
    const coveredByPlate = plate !== null && plate !== undefined && plate.distance + plate.bandM < support.distance;
    if (!coveredByProfile && !coveredByPlate) return { type: "node", id: support.nodeId, reason: "support" };
  }

  if (beam && (!plate || beam.front <= plate.distance + plate.bandM)) {
    return { type: "beam", id: beam.id, point: beam.point, reason: beam.reason };
  }
  return plate ? { type: "plate", id: plate.id, reason: "plate" } : null;
}

/** Een getekende staaf of plaat op de straal door de knoop zelf (afstand in m vanaf de camera). */
export type OpenFem3DNodeRayHit =
  | { type: "beam"; id: number; distance: number; halfSizeM: number }
  | { type: "plate"; id: number; distance: number; bandM: number };

export interface OpenFem3DPlacementNodeCandidate {
  id: number;
  /** Afstand van het knoopmiddelpunt tot de camera (m), zoals een raycast meet. */
  distance: number;
  radiusM: number;
  /** Staven waarvan de knoop begin- of eindknoop is: hij zit in hun profiel, dus zij dekken hem niet af. */
  beamIds?: readonly number[];
  /** Platen in wier middenvlak de knoop ligt: zij dekken hem evenmin af. */
  plateIds?: readonly number[];
  /**
   * De getekende staven en platen op de straal door het schermpunt van de
   * knoop zelf, vóór de knoop. Of de knoop zichtbaar is, hangt af van wat op
   * zijn eigen pixel vóór hem ligt, niet van wat de klikstraal ernaast raakt:
   * een staaf of plaat die naar de camera toe loopt, ligt op de klikplek al
   * gauw tientallen centimeters vóór de knoop zonder hem af te dekken.
   * Afgedekt is hij door een profiel van een andere staaf dat er ruim voor
   * ligt, of door een andere plaat die verder dan haar band voor hem ligt
   * (een knoop op de vloer onder een plaat hoort niet bij deze klik).
   * Ontbreekt de lijst, dan is er niets gemeten en telt de knoop als zichtbaar.
   */
  ownRay?: readonly OpenFem3DNodeRayHit[];
}

export type OpenFem3DPlacementCandidates = Pick<OpenFem3DPickCandidates, "support" | "rayBeam" | "lineBeam"> & {
  /** De knoop binnen de snapzone. */
  node?: OpenFem3DPlacementNodeCandidate | null;
  /** Eerste raycasttreffer op een plaat, met het raakpunt (m). */
  plate?: { id: number; distance: number; bandM: number; point: OpenFem3DPickPoint } | null;
};

export type OpenFem3DPlacementPick =
  | { type: "node"; id: number; reason: "node" | "support" }
  | { type: "beam"; id: number; point: OpenFem3DPickPoint; reason: "beam-ray" | "beam-line" }
  | { type: "plate"; id: number; point: OpenFem3DPickPoint };

/** Is de knoop op zijn eigen schermpunt afgedekt door een staaf of plaat waar hij niet bij hoort? */
export function openFem3DPlacementNodeHidden(node: OpenFem3DPlacementNodeCandidate): boolean {
  const front = node.distance - node.radiusM;
  return (node.ownRay ?? []).some((hit) => hit.type === "beam"
    ? !(node.beamIds ?? []).includes(hit.id) && nodeHiddenByProfile(hit, front)
    : !(node.plateIds ?? []).includes(hit.id) && hit.distance + hit.bandM < front);
}

/**
 * Wat één klik met een plaatsgereedschap raakt (oplegging, veer, puntlast;
 * issues #76 en #77). Anders dan bij selecteren tellen lasttekens niet, en
 * wint een knoop binnen de snapzone (`node`: 14 px, of de getekende bol als
 * die groter is) van de staaf of plaat eronder:
 *
 *  1. de knoop binnen de snapzone — tenzij hij op zijn eigen schermpunt
 *     afgedekt is (zie `OpenFem3DPlacementNodeCandidate.ownRay`);
 *  2. een opleggingsteken onder de cursor: zijn knoop (zoals bij selecteren);
 *  3. de staaf onder of vlak naast de cursor, met het punt op de staaf —
 *     tenzij hij buiten de plaatband achter een geraakte plaat ligt;
 *  4. de plaat, met het raakpunt op haar oppervlak;
 *  5. niets: leeg tekenvlak (het werkvlak).
 */
export function chooseOpenFem3DPlacement(candidates: OpenFem3DPlacementCandidates): OpenFem3DPlacementPick | null {
  const { node, support, rayBeam, lineBeam, plate } = candidates;
  const behindPlate = (front: number) => plate !== null && plate !== undefined && front > plate.distance + plate.bandM;
  if (node && !openFem3DPlacementNodeHidden(node)) return { type: "node", id: node.id, reason: "node" };
  if (support) {
    const coveredByProfile = rayBeam !== null && rayBeam !== undefined && rayBeam.distance < support.distance;
    if (!coveredByProfile && !behindPlate(support.distance)) return { type: "node", id: support.nodeId, reason: "support" };
  }
  const beam = frontBeam(rayBeam, lineBeam);
  if (beam && !behindPlate(beam.front)) return { type: "beam", id: beam.id, point: beam.point, reason: beam.reason };
  return plate ? { type: "plate", id: plate.id, point: plate.point } : null;
}

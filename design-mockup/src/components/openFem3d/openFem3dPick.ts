import type { OpenFem3DSelectionType } from "./openFem3dSelection";

/**
 * Wat één klik in het 3D-tekenvlak selecteert.
 *
 * Het tekenvlak verzamelt per klik de kandidaten (raycasttreffers op lasten,
 * staven en platen; de knoop onder de cursor; de staaf waarvan de
 * systeemlijn binnen de klikzone ligt) en laat de keuze aan deze functie.
 * Afstanden zijn in meters vanaf de camera, zoals een raycast ze geeft.
 *
 * Voorrang:
 *  1. Een lastteken dat echt geraakt wordt, wint — tenzij een getekende staaf
 *     het op die pixel afdekt, of het duidelijk achter de staaf of knoop ligt
 *     (een last van een ander element verderop in het model).
 *  2. Een knoop waarvan de getekende bol onder de klik ligt — tenzij een
 *     profiel er ver voor ligt.
 *  3. De staaf: wat getekend onder de cursor ligt (profiel, analytische as,
 *     diagram), of anders de staaf waarvan de systeemlijn binnen de klikzone
 *     ligt. Ligt die systeemlijn vóór het geraakte profiel, dan wint zij: een
 *     dun verband voor een zware ligger blijft zo aanklikbaar. Een staaf
 *     achter een halfdoorzichtige plaat wint alleen binnen de plaatband.
 *  4. De plaat.
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
  /** Eerste raycasttreffer op een getekende staaf. `halfSizeM`: halve doorsnede. */
  rayBeam?: { id: number; distance: number; halfSizeM: number; point: OpenFem3DPickPoint } | null;
  /** Staaf waarvan de systeemlijn binnen de klikzone ligt; `distance` tot het punt op die lijn. */
  lineBeam?: { id: number; distance: number; halfSizeM: number; point: OpenFem3DPickPoint } | null;
  /** Eerste raycasttreffer op een plaat; `bandM`: tot hoever erachter een staaf nog zichtbaar meetelt. */
  plate?: { id: number; distance: number; bandM: number } | null;
  /** Tot hoever een lastteken achter de voorkant van een staaf of knoop nog wint (m). */
  loadDepthToleranceM: number;
}

export type OpenFem3DPickReason = "load" | "node" | "beam-ray" | "beam-line" | "plate";

export interface OpenFem3DPick {
  type: OpenFem3DSelectionType;
  id: number;
  /** Op de staafas of het geraakte oppervlak; bruikbaar om een staaf te splitsen. */
  point?: OpenFem3DPickPoint;
  reason: OpenFem3DPickReason;
}

export function chooseOpenFem3DPick(candidates: OpenFem3DPickCandidates): OpenFem3DPick | null {
  const { load, node, rayBeam, lineBeam, plate, loadDepthToleranceM } = candidates;
  // De staaf: het getekende profiel onder de cursor, of de systeemlijn
  // binnen de klikzone als die ervóór ligt.
  let beam: { id: number; front: number; point: OpenFem3DPickPoint; reason: "beam-ray" | "beam-line" } | null = null;
  if (rayBeam && lineBeam && lineBeam.id !== rayBeam.id
    && lineBeam.distance - lineBeam.halfSizeM < rayBeam.distance) {
    beam = { id: lineBeam.id, front: lineBeam.distance - lineBeam.halfSizeM, point: lineBeam.point, reason: "beam-line" };
  } else if (rayBeam) {
    beam = { id: rayBeam.id, front: rayBeam.distance, point: rayBeam.point, reason: "beam-ray" };
  } else if (lineBeam) {
    beam = { id: lineBeam.id, front: lineBeam.distance - lineBeam.halfSizeM, point: lineBeam.point, reason: "beam-line" };
  }
  const nodeFront = node ? node.distance - node.radiusM : Infinity;

  if (load) {
    // Een geraakt profiel dekt alles erachter af; een systeemlijn naast de
    // cursor en een knoop niet, dus daar mag de pijl binnen de tolerantie
    // (een pijllengte) achter liggen.
    const beamLimit = !beam ? Infinity
      : beam.reason === "beam-ray" ? beam.front + 1e-9 : beam.front + loadDepthToleranceM;
    const nodeLimit = node ? nodeFront + loadDepthToleranceM : Infinity;
    if (load.distance <= Math.min(beamLimit, nodeLimit)) {
      return { type: load.type, id: load.id, reason: "load" };
    }
  }

  if (node) {
    // Een knoop aan een staafeinde zit ín het profiel; alleen een profiel dat
    // er ruim voor ligt, verbergt hem.
    const hidden = rayBeam !== null && rayBeam !== undefined
      && rayBeam.distance < nodeFront - Math.max(2 * rayBeam.halfSizeM, 0.1);
    if (!hidden) return { type: "node", id: node.id, reason: "node" };
  }

  if (beam && (!plate || beam.front <= plate.distance + plate.bandM)) {
    return { type: "beam", id: beam.id, point: beam.point, reason: beam.reason };
  }
  return plate ? { type: "plate", id: plate.id, reason: "plate" } : null;
}

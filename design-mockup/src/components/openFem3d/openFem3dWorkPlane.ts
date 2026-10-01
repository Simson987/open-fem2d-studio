import type { GridAxisLine } from "../fem/femTypes";
import type { OpenFem3DView } from "./openFem3dCommands";
import { openFem3DLevelHeightM, openFem3DLevelsByHeight } from "./openFem3dLevels";

/**
 * Het werkvlak voor tekenen in 3D (knoop, staaf, plaat, opening).
 *
 * Standaard is dat het horizontale vlak van het ACTIEVE LEVEL: peil 0 (z = 0),
 * tenzij de gebruiker een ander level kiest. Een klik in een leeg deel van het
 * tekenvlak landt daar, in bovenaanzicht én in een scheve (isometrische)
 * camerastand — en niet meer op de hoogte van het richtpunt van de camera, die
 * na pannen of Passend beeld willekeurig is.
 *
 * De voorrang blijft zoals hij was (ThreeFrameCanvas): een bestaande knoop gaat
 * voor; een plaat onder de cursor bepaalt in een scheve stand het vlak van een
 * staaf of plaat; een staaf of plaatcontour blijft in het vlak door haar eerste
 * punt; een opening ligt in haar plaat. In voor- en zijaanzicht staat een
 * horizontaal vlak op zijn kant; daar blijft het verticale vlak van het aanzicht
 * door het richtpunt.
 */

export interface OpenFem3DWorkLevel {
  /** Het actieve level, of null voor peil 0 zonder eigen level. */
  levelId: string | null;
  /** Hoogte in meter (3D-model). */
  zM: number;
}

type Point = { x: number; y: number; z: number };

/** Een level binnen deze afstand van 0 (mm) is "peil 0". */
const PEIL_NUL_TOLERANCE_MM = 0.5;

/**
 * Het actieve level: het gekozen level als dat (nog) bestaat, anders het level
 * op peil 0, anders peil 0 zelf (z = 0).
 */
export function openFem3DWorkLevel(
  levels: readonly Pick<GridAxisLine, "id" | "position">[], activeLevelId: string | null | undefined,
): OpenFem3DWorkLevel {
  const chosen = activeLevelId ? levels.find((level) => level.id === activeLevelId) : undefined;
  if (chosen) return { levelId: chosen.id, zM: openFem3DLevelHeightM(chosen) };
  const peilNul = levels.find((level) => Math.abs(level.position) <= PEIL_NUL_TOLERANCE_MM);
  return peilNul ? { levelId: peilNul.id, zM: openFem3DLevelHeightM(peilNul) } : { levelId: null, zM: 0 };
}

/** Een keuze in de lijst "Werkvlak": `value` "" is peil 0 zonder eigen level. */
export interface OpenFem3DWorkPlaneOption {
  value: string;
  level: Pick<GridAxisLine, "id" | "label" | "position"> | null;
}

/** De levels van laag naar hoog, met peil 0 vooraan als geen level op 0 ligt. */
export function openFem3DWorkPlaneOptions(
  levels: readonly Pick<GridAxisLine, "id" | "label" | "position">[],
): OpenFem3DWorkPlaneOption[] {
  const options: OpenFem3DWorkPlaneOption[] = openFem3DLevelsByHeight(levels).map((level) => ({ value: level.id, level }));
  if (!levels.some((level) => Math.abs(level.position) <= PEIL_NUL_TOLERANCE_MM)) {
    const firstAbove = options.findIndex((option) => option.level!.position > 0);
    options.splice(firstAbove < 0 ? options.length : firstAbove, 0, { value: "", level: null });
  }
  return options;
}

/** Horizontaal werkvlak in boven- en scheef aanzicht; in voor- en zijaanzicht verticaal. */
export function openFem3DWorkPlaneIsHorizontal(view: OpenFem3DView): boolean {
  return view === "top" || view === "iso";
}

/** Normaal van het standaardwerkvlak per aanzicht (Z blijft verticaal). */
export function openFem3DWorkPlaneNormal(view: OpenFem3DView): [number, number, number] {
  return view === "front" ? [0, 1, 0] : view === "side" ? [1, 0, 0] : [0, 0, 1];
}

/**
 * Een punt van het standaardwerkvlak: in boven- en scheef aanzicht op de
 * hoogte van het actieve level, in voor- en zijaanzicht het richtpunt.
 */
export function openFem3DWorkPlaneOrigin(view: OpenFem3DView, target: Point, workZ: number): Point {
  return openFem3DWorkPlaneIsHorizontal(view)
    ? { x: target.x, y: target.y, z: workZ }
    : { x: target.x, y: target.y, z: target.z };
}

/**
 * Waar een kijkstraal het standaardwerkvlak raakt, of null als de straal
 * evenwijdig loopt of het vlak achter de camera ligt — net als
 * THREE.Ray.intersectPlane, dat het tekenvlak zelf gebruikt.
 */
export function intersectOpenFem3DWorkPlane(
  rayOrigin: Point, rayDirection: Point, view: OpenFem3DView, target: Point, workZ: number,
): Point | null {
  const [nx, ny, nz] = openFem3DWorkPlaneNormal(view);
  const point = openFem3DWorkPlaneOrigin(view, target, workZ);
  const denominator = nx * rayDirection.x + ny * rayDirection.y + nz * rayDirection.z;
  if (Math.abs(denominator) < 1e-12) return null;
  const t = (nx * (point.x - rayOrigin.x) + ny * (point.y - rayOrigin.y) + nz * (point.z - rayOrigin.z)) / denominator;
  if (t < 0) return null;
  return { x: rayOrigin.x + t * rayDirection.x, y: rayOrigin.y + t * rayDirection.y, z: rayOrigin.z + t * rayDirection.z };
}

import { bepaalPlaatStijfheid } from "../../lib/plaatMateriaal";
import type { OpenFem3DPlate } from "./openFem3dModel";

/** Isotrope plaateigenschappen voor de 3D-kern. */
export interface OpenFem3DPlateMaterial {
  /** Materiaalnaam zoals op de plaat (bijv. "C30/37"). */
  name: string;
  /** Elasticiteitsmodulus (N/mm² = MPa). */
  eMpa: number;
  nu: number;
  /** Volumieke massa (kg/m³) voor het eigen gewicht ρ·g·t. */
  rhoKgM3: number;
}

/**
 * E, ν en ρ van een 3D-plaat uit dezelfde materiaalbepaling als de 2D-platen.
 * De externe 3D-kern rekent platen isotroop; hout en kruislaaghout (richting-
 * afhankelijk) worden daarom geweigerd in plaats van stil isotroop gemaakt.
 */
export function resolveOpenFem3DPlateMaterial(plate: Pick<OpenFem3DPlate, "id" | "material">): OpenFem3DPlateMaterial {
  const name = plate.material?.trim() ?? "";
  if (!name) throw new Error(`3D-plaat ${plate.id}: wijs eerst een materiaal toe.`);
  const outcome = bepaalPlaatStijfheid({ materiaal: name });
  if (!outcome.ok) throw new Error(`3D-plaat ${plate.id}: ${outcome.reden}`);
  const stiffness = outcome.stijfheid;
  if (stiffness.orthotroop) {
    throw new Error(
      `3D-plaat ${plate.id}: materiaal "${name}" is richtingsafhankelijk (orthotroop). ` +
      "De 3D-plaatkern rekent alleen isotroop; kies beton, staal, aluminium of een vrij isotroop materiaal.",
    );
  }
  return { name, eMpa: stiffness.E1, nu: stiffness.nu12, rhoKgM3: stiffness.rho };
}

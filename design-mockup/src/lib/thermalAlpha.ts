/**
 * Thermische uitzettingscoëfficiënt per staafmateriaal (1/K) voor thermische
 * lasten (SolverThermalLoadInput.alpha — de engine honoreert een per-last α
 * exact, zie engine.ts buildMesh).
 *  - Staal: α = 1,2e-5 /K (EN 1993-1-1).
 *  - Beton: α = 1,0e-5 /K (EN 1992-1-1, gebruikelijke ontwerpwaarde).
 *  - Hout:  α = 5,0e-6 /K — α∥ (vezelrichting), bovengrens van de
 *    literatuurrange 3–5e-6 /K en dus conservatief voor de krachten uit
 *    verhinderde thermische vervorming.
 * Houtdetectie via de sterkteklassentabel (TIMBER_E_MEAN); al het overige
 * (staal, onbekend) rekent met de staal-α.
 *
 * Deze constante stond eerder in FemCanvas.tsx — een React-bestand van 3.900+
 * regels dat in Node niet te importeren is (het trekt CSS en DOM mee). De
 * modelmapping (modelNaarSolverInput.ts) moet buiten de browser draaibaar
 * zijn, dus staat de α-keuze hier: één bron voor het canvas-pad én het
 * multi-LC-pad.
 */
import { CONCRETE_E_CM, TIMBER_E_MEAN } from "./sectionResolver";

export const ALPHA_STAAL = 1.2e-5;
export const ALPHA_BETON = 1.0e-5;
export const ALPHA_HOUT = 5.0e-6;

export function thermalAlphaForMaterial(material: string | undefined): number {
  if (material !== undefined && material in CONCRETE_E_CM) return ALPHA_BETON;
  if (material !== undefined && material in TIMBER_E_MEAN) return ALPHA_HOUT;
  return ALPHA_STAAL;
}

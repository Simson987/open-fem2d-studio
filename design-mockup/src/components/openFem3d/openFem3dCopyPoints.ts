import type { Punt3 } from "./openFem3dTekenhulp";
import type { OpenFem3DTransformCommand } from "./openFem3dTransform";

/**
 * Kopiëren met basispunt en doelpunt (gereedschap Kopiëren in het 3D-tekenvlak).
 * De eerste klik legt het basispunt vast (`anchor`) en verandert niets; de
 * tweede geeft de kopie over doelpunt − basispunt, dezelfde opdracht als ΔX/ΔY/ΔZ
 * in het paneel Kopiëren (en `model3d.transform` met `kind: "copy"`). Een
 * doelpunt binnen 1e-9 m van het basispunt maakt geen kopie (geen dubbele
 * geometrie op dezelfde plek); het basispunt blijft dan staan. Punten in m.
 */
export function openFem3DCopyPointStep(anchor: Punt3 | null, point: Punt3): {
  anchor: Punt3;
  command: Extract<OpenFem3DTransformCommand, { kind: "copy" }> | null;
} {
  if (![point.x, point.y, point.z, ...(anchor ? [anchor.x, anchor.y, anchor.z] : [])].every(Number.isFinite)) {
    throw new Error("Kopieerpunten moeten eindige coördinaten hebben.");
  }
  if (!anchor) return { anchor: { ...point }, command: null };
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const dz = point.z - anchor.z;
  if (![dx, dy, dz].every(Number.isFinite)) {
    throw new Error("De kopieerverplaatsing moet uit eindige getallen bestaan.");
  }
  return {
    anchor,
    command: Math.hypot(dx, dy, dz) <= 1e-9 ? null : { kind: "copy", dx, dy, dz },
  };
}

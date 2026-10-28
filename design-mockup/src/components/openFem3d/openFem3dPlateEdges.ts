/**
 * Randen van de buitencontour van een 3D-plaat en de randopleggingen erop.
 * Rand k is het randstuk k van `boundary`, of zonder getekende contour de rand
 * van contourknoop k naar k+1 (cyclisch) — dezelfde nummering als
 * `OpenFem3DPlateEdgeSupport.edge` en `OpenFem3DPlateMesh.plateEdgeNodes`.
 */
import {
  OPEN_FEM_3D_SUPPORT_PRESETS,
  type OpenFem3DPlate,
  type OpenFem3DPlateEdgeSupport,
  type OpenFem3DSupportPreset,
} from "./openFem3dModel";

export interface OpenFem3DPlateEdge {
  index: number;
  startNodeId: number;
  endNodeId: number;
  /** Alleen bij een cirkelboog: het tussenpunt waar de boog door gaat. */
  controlNodeId?: number;
}

export function openFem3DPlateEdges(plate: Pick<OpenFem3DPlate, "nodeIds" | "boundary">): OpenFem3DPlateEdge[] {
  if (plate.boundary?.length) {
    return plate.boundary.map((segment, index) => ({
      index,
      startNodeId: segment.startNodeId,
      endNodeId: segment.endNodeId,
      ...(segment.kind === "arc" ? { controlNodeId: segment.controlNodeId } : {}),
    }));
  }
  return plate.nodeIds.map((id, index) => ({
    index, startNodeId: id, endNodeId: plate.nodeIds[(index + 1) % plate.nodeIds.length],
  }));
}

/**
 * Keuzes voor een randoplegging. Een scharnier om X of Y is een lijnscharnier
 * langs een rand evenwijdig aan die as: w = 0 én geen draaiing langs de rand
 * ("hard" vrij opgelegd). Het ruimtelijk scharnier laat alle draaiingen vrij.
 */
export const OPEN_FEM_3D_EDGE_SUPPORT_CHOICES = [
  "zRoller", "pinned", "fixed", "revoluteX", "revoluteY", "revoluteZ", "xRoller", "yRoller",
] as const satisfies readonly OpenFem3DSupportPreset[];

/** Nieuwe lijst randopleggingen met rand `edge` op `preset`, of zonder oplegging bij `null`. */
export function withOpenFem3DPlateEdgeSupport(
  edgeSupports: readonly OpenFem3DPlateEdgeSupport[] | undefined,
  edge: number,
  preset: OpenFem3DSupportPreset | null,
): OpenFem3DPlateEdgeSupport[] {
  const next = (edgeSupports ?? []).filter((item) => item.edge !== edge);
  if (preset) next.push({ edge, ...OPEN_FEM_3D_SUPPORT_PRESETS[preset] });
  return next.sort((a, b) => a.edge - b.edge);
}

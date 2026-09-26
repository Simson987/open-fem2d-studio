/** Display preferences for the 3D workspace; they do not change project geometry. */
export interface Frame3DVisibility {
  nodes: boolean;
  beams: boolean;
  plates: boolean;
  /** Volumetric member representation; off shows slender analytical axes. */
  profiles: boolean;
  nodeNumbers: boolean;
  beamNumbers: boolean;
  nodeCoordinates: boolean;
  supports: boolean;
  loads: boolean;
  grid: boolean;
  axes: boolean;
  structuralGrid: boolean;
  deformation: boolean;
  reactions: boolean;
  /** Colour members and show labels for EN 1992 / EN 1993 unity checks. */
  utilization: boolean;
  axialForce: boolean;
  shearY: boolean;
  shearZ: boolean;
  torsion: boolean;
  momentY: boolean;
  momentZ: boolean;
}

export const DEFAULT_FRAME_3D_VISIBILITY: Frame3DVisibility = {
  nodes: true,
  beams: true,
  plates: true,
  profiles: false,
  nodeNumbers: true,
  beamNumbers: false,
  nodeCoordinates: false,
  supports: true,
  loads: true,
  grid: true,
  axes: true,
  structuralGrid: true,
  deformation: true,
  reactions: true,
  utilization: true,
  axialForce: false,
  shearY: false,
  shearZ: false,
  torsion: false,
  momentY: false,
  momentZ: false,
};

const STORAGE_KEY = "open-fem-studio.frame3d.visibility";

export function readFrame3DVisibility(): Frame3DVisibility {
  if (typeof localStorage === "undefined") return { ...DEFAULT_FRAME_3D_VISIBILITY };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Record<string, unknown> | null;
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return { ...DEFAULT_FRAME_3D_VISIBILITY };
    const result = { ...DEFAULT_FRAME_3D_VISIBILITY };
    for (const key of Object.keys(result) as (keyof Frame3DVisibility)[]) {
      if (typeof saved[key] === "boolean") result[key] = saved[key];
    }
    return result;
  } catch {
    return { ...DEFAULT_FRAME_3D_VISIBILITY };
  }
}

export function saveFrame3DVisibility(value: Frame3DVisibility): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Private browsing or a full store must not interrupt drawing.
  }
}

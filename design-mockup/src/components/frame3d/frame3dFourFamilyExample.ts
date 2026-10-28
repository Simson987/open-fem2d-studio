import type { Frame3DModel } from "./frame3dModel";
import { parseFrame3DFourFamilyExample } from "./frame3dVolumeExample";
// Vite-only `?raw` import. Kept out of frame3dVolumeExample.ts so that module
// (and the tests importing it) loads under plain tsx/Node as well, which do
// not understand the `?raw` query (ERR_UNKNOWN_FILE_EXTENSION). Tests read the
// same file with fs and call parseFrame3DFourFamilyExample.
import fourFamilyProject from "../../../../docs/verificatie/3d-volume/tet4-hex8-tri3-raamwerk-j2-gekoppeld.ifcfem2d?raw";

/** The saved four-family verification model, available directly in the 3D editor. */
export function buildFrame3DFourFamilyExample(): Frame3DModel {
  return parseFrame3DFourFamilyExample(fourFamilyProject);
}

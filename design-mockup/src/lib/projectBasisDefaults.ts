import type { Uitgangspunten } from "../components/project/ProjectSettingsDialog";
import { STANDAARD_BIJLAGE } from "./normAanduidingen";
import { NEDERLANDSE_WINDROUTE } from "./wind/windCodeRoute";

/**
 * Initial design basis for a new project. Keep this outside the React dialog
 * so standalone project generators and the MCP sidecar store the same complete
 * basis, including the wind route, without importing UI code at runtime.
 */
export const DEFAULT_UITGANGSPUNTEN: Uitgangspunten = {
  en1993: false,
  en1995: false,
  en1992: false,
  normenHandmatig: [],
  gevolgklasse: "CC2",
  levensduurklasse: "4",
  nationaleBijlage: STANDAARD_BIJLAGE,
  windCodeId: NEDERLANDSE_WINDROUTE,
  windgebied: "II",
  terreincategorie: "II",
};

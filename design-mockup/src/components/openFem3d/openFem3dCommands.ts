/** Commands shared by the 3D ribbon and editor. */
import type { OpenFem3DSupportPreset } from "./openFem3dModel";

/** Een oplegveer in één globale richting: translatie (kx, ky, kz) of rotatie (krx, kry, krz). */
export type OpenFem3DSpringAxis = "kx" | "ky" | "kz" | "krx" | "kry" | "krz";

/**
 * `addLoadPanel` tekent een belastingvlak door hoekknopen aan te klikken,
 * zoals een plaat. `loadPanelSpan` legt de overspanningsrichting van het
 * geselecteerde belastingvlak vast met twee knopen of één staaf.
 */
export type OpenFem3DTool = "select" | "addNode" | "addBeam" | "addSubNode" | "addPlate" | "addPlateArc" | "addOpening" | "addOpeningArc" | "addMemberLoad" | "addLoadPanel" | "loadPanelSpan" | "move" | "rotate" | "copy" | "mirror" | `support:${OpenFem3DSupportPreset}` | `spring:${OpenFem3DSpringAxis}`;

/** Z stays vertical. Top is XY, front is XZ and side is YZ. */
export type OpenFem3DView = "iso" | "top" | "front" | "side";

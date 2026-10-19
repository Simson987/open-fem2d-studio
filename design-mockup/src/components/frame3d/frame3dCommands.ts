/** Commands shared by the 3D ribbon and editor. */
import type { Frame3DSupportPreset } from "./frame3dModel";

export type Frame3DTool = "select" | "addNode" | "addBeam" | "addSubNode" | "addPlate" | "addPlateArc" | "addOpening" | "addOpeningArc" | "addTet4" | "addHex8" | "addMemberLoad" | "move" | "rotate" | "copy" | "mirror" | `support:${Frame3DSupportPreset}`;

/** Z stays vertical. Top is XY, front is XZ and side is YZ. */
export type Frame3DView = "iso" | "top" | "front" | "side";

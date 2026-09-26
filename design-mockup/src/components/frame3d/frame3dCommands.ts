/** Commands shared by the 3D ribbon and editor. */
export type Frame3DTool = "select" | "addNode" | "addBeam" | "addSubNode" | "addPlate" | "addPlateArc" | "addOpening" | "move" | "rotate" | "copy" | "mirror";

/** Z stays vertical. Top is XY, front is XZ and side is YZ. */
export type Frame3DView = "iso" | "top" | "front" | "side";

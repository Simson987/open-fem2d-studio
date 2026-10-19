import { parseFrame3DModel, type Frame3DModel } from "./frame3dModel";
import steelProject from "../../../../docs/verificatie/3d-raamwerk/staalgebouw-2432-staven-acht-bouwlagen.ifcfem2d?raw";

/** The reproducible large steel-building verification model for the 3D editor. */
export function buildFrame3DSteelExample(): Frame3DModel {
  const project = JSON.parse(steelProject) as { model3d?: unknown };
  if (!project.model3d) throw new Error("3D-staalproefmodel mist model3d.");
  return parseFrame3DModel(project.model3d);
}

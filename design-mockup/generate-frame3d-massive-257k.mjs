/** Rebuild the saved 257,728-volume acceptance model without hand-editing mesh JSON. */
import { readFileSync, writeFileSync } from "node:fs";
import { buildFrame3DVolumeExample } from "./src/components/frame3d/frame3dVolumeExample.ts";
import { MASSIVE_IRREGULAR_DIMENSIONS } from "./src/components/volume3d/irregularMixed3dModel.ts";

const source = new URL("../docs/verificatie/3d-volume/groot-gemengd-55232-volumes.ifcfem2d", import.meta.url);
const target = new URL("../docs/verificatie/3d-volume/massief-gemengd-257728-volumes.ifcfem2d", import.meta.url);
const project = JSON.parse(readFileSync(source, "utf8"));
project.savedAt = "2026-10-08T00:00:00.000Z";
project.model3d = buildFrame3DVolumeExample(MASSIVE_IRREGULAR_DIMENSIONS);
project.projectInfo = {
  name: "Massief onregelmatig volume-raamwerk",
  projectNumber: "VF-3D-MIXED-257728",
};
project.selfWeightEnabled = false;
if (project.model3d.nodes.length !== 84_746 || project.model3d.volumes.length !== 257_728)
  throw new Error("Onverwachte element- of knooptelling in het massieve 3D-model.");
writeFileSync(target, JSON.stringify(project));
console.log(`${project.model3d.nodes.length} knopen, ${project.model3d.volumes.length} volumes: ${target.pathname}`);

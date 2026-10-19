import { readFileSync, writeFileSync } from "node:fs";
import { deserializeProject } from "./src/io/projectFile.ts";
import { defaultCombinations } from "./src/components/fem/solver/combinations.ts";
import { solveFrame3DCombination } from "./src/components/frame3d/frame3dSolver.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/tet4-hex8-j2-buigraamwerk.ifcfem2d", import.meta.url), "utf8"));
const combination = defaultCombinations(project.loadCases)
  .find(item => item.factors.get(project.activeLoadCaseId) === 0.3);
if (!combination) throw new Error("No factor 0.3 combination");
let captured;
globalThis.fetch = async (_url, options) => {
  captured = JSON.parse(options.body).inputs;
  throw new Error("captured request");
};
try {
  await solveFrame3DCombination(project.model3d, combination.factors,
    "material", "openaec-native-fem");
} catch (error) {
  if (String(error) !== "Error: captured request") throw error;
}
if (!captured || captured.kind !== "volume3dFiniteJ2FrameCoupled") {
  throw new Error("Wrong or missing native request");
}
writeFileSync(new URL("../src-tauri/crates/native-fem/tests/fixtures/finite_j2_frame_combo_03.json", import.meta.url),
  JSON.stringify(captured) + "\n");

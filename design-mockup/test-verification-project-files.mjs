import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deserializeProject, serializeProject } from "./src/io/projectFile.ts";

const root = fileURLToPath(new URL("../docs/verificatie", import.meta.url));
function projects(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return projects(path);
    return entry.isFile() && entry.name.endsWith(".ifcfem2d") ? [path] : [];
  });
}

const files = projects(root).sort();
assert.ok(files.length >= 33, `expected the verification corpus, found ${files.length}`);
let threeDimensional = 0;
let largestVolumeCount = 0;
for (const path of files) {
  const label = path.slice(root.length + 1);
  const opened = deserializeProject(readFileSync(path, "utf8"));
  const { format: _format, version: _version, savedAt: _savedAt, ...state } = opened;
  const reopened = deserializeProject(serializeProject(state));
  assert.equal(reopened.modelDimension, opened.modelDimension, `${label}: dimension`);
  for (const key of ["nodes", "beams", "supports", "plates", "loads", "loadCases", "combinations"]) {
    assert.deepEqual(reopened[key], opened[key], `${label}: ${key} round trip`);
  }
  if (opened.modelDimension === "3d") {
    threeDimensional++;
    assert.ok(opened.model3d, `${label}: missing 3D model`);
    assert.deepEqual(reopened.model3d, opened.model3d, `${label}: 3D geometry, material, support and load round trip`);
    const model = opened.model3d;
    const ids = new Set(model.nodes.map(node => node.id));
    assert.equal(ids.size, model.nodes.length, `${label}: duplicate 3D node ID`);
    for (const volume of model.volumes ?? []) {
      assert.ok(volume.nodeIds.every(id => ids.has(id)), `${label}: volume ${volume.id} refers to missing node`);
    }
    largestVolumeCount = Math.max(largestVolumeCount, model.volumes?.length ?? 0);
  }
}
assert.ok(threeDimensional >= 30, `expected the 3D verification fixtures, found ${threeDimensional}`);
assert.ok(largestVolumeCount >= 250_000, `expected a large volume project, found ${largestVolumeCount}`);
console.log(`${files.length} verification projects round-trip; ${threeDimensional} 3D, `
  + `largest volume model ${largestVolumeCount} cells`);

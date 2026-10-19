import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/tet4-eindige-rek-j2-kracht-ontlasten-membraan.ifcfem2d",
  import.meta.url), "utf8"));
const binary = fileURLToPath(new URL("../src-tauri/target/debug/toetsbrug", import.meta.url));
const requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  requests.push(body.inputs);
  const answer = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    child.stdout.on("data", chunk => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", code => resolve({ code, json: Buffer.concat(chunks).toString() }));
    child.stdin.end(JSON.stringify(body));
  });
  return new Response(answer.json, { status: answer.code === 0 ? 200 : 400 });
};

const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const sub = (a, b) => a.map((value, i) => value - b[i]);
const norm = a => Math.hypot(...a);

try {
  const model = project.model3d;
  assert.deepEqual([model.volumes.length, model.plates.length, model.beams.length, model.supports.length],
    [48, 8, 1, 26]);
  assert.deepEqual(model.materialLoadPath, [1, 0]);
  const results = [];
  for (const backend of ["automatic", "frontalWave", "matrixFreeGmresLarge"]) {
    const result = await solveFrame3D({ ...model, volumeBackend: backend }, project.activeLoadCaseId,
      "material", "openaec-native-fem");
    const request = requests.at(-1);
    assert.equal(request.kind, "volume3dFiniteJ2MembraneCoupled");
    const input = request.input;
    assert.deepEqual([input.volume.mesh.tets.length, input.trusses.length, input.membranes.length], [48, 1, 8]);
    assert.equal(input.volume.targets.length, 2);
    assert.deepEqual(input.volume.targets[0].loadsKn[13], [500000, -250000, 150000]);
    assert.deepEqual(input.volume.targets[1].loadsKn[13], [0, 0, 0]);
    assert.ok(input.volume.targets[1].loadsKn.flat().every(value => value === 0));
    assert.ok(input.volume.targets[1].prescribedM.every((triplet, node) => node === 13
      ? triplet.every(value => value === null) : triplet.every(value => value === 0)));
    assert.ok(Math.abs(input.trusses[0].areaM2 - 0.002) < 1e-12);
    assert.deepEqual(result.materialLoadPath, [1, 0]);
    assert.ok(result.volume3D.elements.some(element => element.equivalentPlasticStrain > 0));
    assert.equal(result.volume3D.membranes.length, 8);
    assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk);
    const center = result.displacements.find(node => node.nodeId === 114);
    assert.ok(center);
    const expected = [0.00095288729501524, 0.00010739166882957, 0.00056696144486024];
    for (const [axis, value] of [center.ux, center.uy, center.uz].entries()) {
      assert.ok(Math.abs(value - expected[axis]) < 1e-7, `${backend}: unloaded center ${axis}`);
    }
    // Rebuild the elastic finite truss force from current endpoint positions.
    const ends = [114, 115].map(id => model.nodes.find(node => node.id === id));
    const endU = [114, 115].map(id => result.displacements.find(node => node.nodeId === id));
    const current = ends.map((node, i) => [node.x + endU[i].ux, node.y + endU[i].uy, node.z + endU[i].uz]);
    const stretch = norm(sub(current[1], current[0])) / norm(sub(
      [ends[1].x, ends[1].y, ends[1].z], [ends[0].x, ends[0].y, ends[0].z]));
    const trussKn = 1000 * 210000 * 0.002 * (stretch ** 2 - 1) / 2 * stretch;
    assert.ok(Math.abs(result.memberForces[0].nStartKn - trussKn) < 1e-7);
    // Rebuild a membrane PK2 stress from its deformed corner coordinates.
    const plateIndex = model.plates.findIndex(plate => plate.nodeIds.includes(114));
    const plate = model.plates[plateIndex];
    const p = plate.nodeIds.map(id => model.nodes.find(node => node.id === id));
    const u = plate.nodeIds.map(id => result.displacements.find(node => node.nodeId === id));
    const x = p.map(node => [node.x, node.y, node.z]);
    const q = p.map((node, i) => [node.x + u[i].ux, node.y + u[i].uy, node.z + u[i].uz]);
    const edge1 = sub(x[1], x[0]), edge2 = sub(x[2], x[0]);
    const l1 = norm(edge1), e1 = edge1.map(value => value / l1);
    const x2 = dot(edge2, e1), y2 = norm(sub(edge2, e1.map(value => value * x2)));
    const g1 = sub(q[1], q[0]).map(value => value / l1);
    const g2 = sub(sub(q[2], q[0]), g1.map(value => value * x2)).map(value => value / y2);
    const green = [(dot(g1, g1) - 1) / 2, (dot(g2, g2) - 1) / 2, dot(g1, g2)];
    const youngs = plate.membraneEMpa, nu = plate.membranePoisson, c = youngs / (1 - nu ** 2);
    const pk2 = [c * (green[0] + nu * green[1]), c * (nu * green[0] + green[1]),
      youngs * green[2] / (2 * (1 + nu))];
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(result.volume3D.membranes[plateIndex].stressMpa[axis] - pk2[axis]) < 1e-5,
        `${backend}: membrane PK2 ${axis}`);
    }
    results.push(result);
  }
  const reference = results[0].displacements.find(node => node.nodeId === 114);
  for (const result of results.slice(1)) {
    const actual = result.displacements.find(node => node.nodeId === 114);
    for (const axis of ["ux", "uy", "uz"]) {
      assert.ok(Math.abs(actual[axis] - reference[axis]) < 1e-7);
    }
  }
  console.log("Saved 48 Tet4 + 8 Tri3 + truss load/unload: 3 app backends, plastic history, force and PK2 references OK");
} finally {
  globalThis.fetch = originalFetch;
}

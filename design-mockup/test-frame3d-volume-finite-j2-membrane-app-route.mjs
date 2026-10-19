import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";
import { resolveSolver } from "./src/core/solver/SolverRegistry.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/tet4-eindige-rek-j2-trekstaaf-membraan.ifcfem2d",
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
  assert.equal(model.volumes.length, 48);
  assert.equal(model.beams.length, 1);
  assert.equal(model.plates.length, 1);
  assert.equal(resolveSolver("openaec-native-fem", {
    schemaVersion: 1, dimension: "3d", analysis: "material-nonlinear",
    elementFamilies: ["solid", "frame", "plate"],
  }).id, "openaec-native-fem");
  const result = await solveFrame3D(model, project.activeLoadCaseId,
    "material", "openaec-native-fem");
  assert.equal(requests[0].kind, "volume3dFiniteJ2MembraneCoupled");
  assert.equal(requests[0].input.volume.mesh.tets.length, 48);
  assert.equal(requests[0].input.trusses.length, 1);
  assert.equal(requests[0].input.membranes.length, 1);
  assert.equal(result.volume3D.membranes.length, 1);
  assert.ok(result.volume3D.elements.some(element => element.equivalentPlasticStrain > 0));
  assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk);

  // Reconstruct the reference-plane Green strains from the *app's* deformed
  // node coordinates independently of the Rust element arrays.
  const plate = model.plates[0];
  const p = plate.nodeIds.map(id => model.nodes.find(node => node.id === id));
  const u = plate.nodeIds.map(id => result.displacements.find(node => node.nodeId === id));
  const x = p.map(node => [node.x, node.y, node.z]);
  const current = p.map((node, i) => [node.x + u[i].ux, node.y + u[i].uy, node.z + u[i].uz]);
  const edge1 = sub(x[1], x[0]);
  const edge2 = sub(x[2], x[0]);
  const l1 = norm(edge1);
  const e1 = edge1.map(value => value / l1);
  const x2 = dot(edge2, e1);
  const y2 = norm(sub(edge2, e1.map(value => value * x2)));
  const g1 = sub(current[1], current[0]).map(value => value / l1);
  const g2 = sub(sub(current[2], current[0]), g1.map(value => value * x2))
    .map(value => value / y2);
  const green = [(dot(g1, g1) - 1) / 2, (dot(g2, g2) - 1) / 2, dot(g1, g2)];
  const youngs = plate.membraneEMpa, nu = plate.membranePoisson;
  const c = youngs / (1 - nu ** 2);
  const expected = [c * (green[0] + nu * green[1]),
    c * (nu * green[0] + green[1]), youngs * green[2] / (2 * (1 + nu))];
  const membrane = result.volume3D.membranes[0];
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(membrane.stressMpa[i] - expected[i]) < 1e-5,
      `membrane stress ${i}: ${membrane.stressMpa[i]} vs ${expected[i]}`);
    assert.ok(Math.abs(membrane.resultantsKnPerM[i]
      - 1000 * plate.thicknessM * expected[i]) < 2e-4);
  }
  const baseline = await solveFrame3D({ ...model, plates: [] }, project.activeLoadCaseId,
    "material", "openaec-native-fem");
  assert.equal(requests[1].kind, "volume3dFiniteJ2Coupled");
  const center = result.displacements.find(node => node.nodeId === 114);
  const centerBaseline = baseline.displacements.find(node => node.nodeId === 114);
  assert.ok(Math.hypot(center.ux - centerBaseline.ux,
    center.uy - centerBaseline.uy, center.uz - centerBaseline.uz) > 1e-9,
  "the membrane must alter the shared free solid node");
  const parallel = await solveFrame3D({ ...model,
    volumeBackend: "matrixFreeGmres", volumeThreads: 4 }, project.activeLoadCaseId,
  "material", "openaec-native-fem");
  assert.equal(requests[2].kind, "volume3dFiniteJ2MembraneCoupled");
  assert.equal(parallel.volume3D.backendUsed, "matrixFreeGmres");
  assert.ok(Math.abs(parallel.volume3D.membranes[0].stressMpa[0] - membrane.stressMpa[0]) < 1e-4);
  console.log("Saved 48 Tet4 + finite truss + finite Tri3 membrane: independent Green stress, shared free node, 4-thread parity OK");
} finally {
  globalThis.fetch = originalFetch;
}

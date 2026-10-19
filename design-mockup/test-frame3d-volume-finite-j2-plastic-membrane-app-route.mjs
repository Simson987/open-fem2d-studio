import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith(".css")) return { format: "module", source: "export {};", shortCircuit: true };
  return nextLoad(url, context);
} });
const { default: Frame3DReport } = await import("./src/components/frame3d/Frame3DReport.tsx");

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/tet4-eindige-rek-j2-plastische-trekstaaf-en-membraan.ifcfem2d",
  import.meta.url), "utf8"));
const binary = fileURLToPath(new URL("../src-tauri/target/release/toetsbrug", import.meta.url));
const originalFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  requests.push(body.inputs);
  const answer = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const output = [], errors = [];
    child.stdout.on("data", chunk => output.push(chunk));
    child.stderr.on("data", chunk => errors.push(chunk));
    child.on("error", reject);
    child.on("close", code => resolve({ code,
      text: Buffer.concat(output).toString(), error: Buffer.concat(errors).toString() }));
    child.stdin.end(JSON.stringify(body));
  });
  if (answer.code !== 0) throw new Error(answer.error || answer.text);
  return new Response(answer.text, { status: 200 });
};

try {
  const model = project.model3d;
  assert.deepEqual([model.volumes.length, model.plates.length, model.beams.length], [48, 8, 1]);
  assert.deepEqual(model.materialLoadPath, [1, 0]);
  const results = [];
  for (const backend of ["automatic", "frontalWave", "matrixFreeGmresLarge"]) {
    const result = await solveFrame3D({ ...model, volumeBackend: backend },
      project.activeLoadCaseId, "material", "openaec-native-fem");
    const request = requests.at(-1);
    assert.equal(request.kind, "volume3dFiniteJ2MembraneCoupled");
    assert.deepEqual([request.input.volume.mesh.tets.length,
      request.input.trusses.length, request.input.membranes.length], [48, 1, 8]);
    assert.deepEqual(request.input.membranes[0].plasticity,
      { yieldMpa: 20, hardeningMpa: model.plates[0].membraneEMpa * 0.01 / 0.99 });
    assert.ok(request.input.membranes.slice(1).every(membrane => !membrane.plasticity));
    assert.equal(request.input.volume.targets.length, 2);
    assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk);
    assert.ok(result.volume3D.elements.some(element => element.equivalentPlasticStrain > 0));
    assert.ok(result.memberForces[0].axialHistory?.equivalentPlasticStrain > 0);
    assert.equal(result.volume3D.membranes.length, 8);
    const membrane = result.volume3D.membranes[0];
    assert.equal(membrane.plateId, model.plates[0].id);
    assert.equal(membrane.stressMeasure, "cauchy");
    assert.ok(membrane.equivalentPlasticStrain > 0);
    assert.ok(membrane.thicknessStretch > 0 && Number.isFinite(membrane.thicknessStretch));
    assert.ok(membrane.stressMpa.every(Number.isFinite));
    assert.ok(membrane.resultantsKnPerM.every(Number.isFinite));
    for (let component = 0; component < 3; component++) {
      const expected = 1000 * model.plates[0].thicknessM
        * membrane.thicknessStretch * membrane.stressMpa[component];
      assert.ok(Math.abs(membrane.resultantsKnPerM[component] - expected) < 1e-6,
        `${backend}: current membrane resultant ${component}`);
    }
    assert.ok(result.volume3D.membranes.slice(1).every(other =>
      other.stressMeasure === "secondPiolaKirchhoff"
      && other.equivalentPlasticStrain === undefined));
    results.push(result);
  }
  const reference = results[0].displacements.find(node => node.nodeId === 114);
  for (const result of results.slice(1)) {
    const actual = result.displacements.find(node => node.nodeId === 114);
    for (const axis of ["ux", "uy", "uz"]) {
      assert.ok(Math.abs(actual[axis] - reference[axis]) < 1e-7, `backend ${axis}`);
    }
    assert.ok(Math.abs(result.volume3D.membranes[0].equivalentPlasticStrain
      - results[0].volume3D.membranes[0].equivalentPlasticStrain) < 1e-7);
  }
  const report = renderToStaticMarkup(React.createElement(Frame3DReport,
    { model, result: results[0], activeLoadCaseId: project.activeLoadCaseId }));
  assert.match(report, /Spanningsmaat/);
  assert.match(report, /Cauchy, huidig/);
  assert.match(report, /2e Piola–Kirchhoff, referentie/);
  assert.match(report, /Dikterekfactor/);
  console.log("Saved 48 Tet4 + plastic truss + 1 plastic/7 elastic Tri3: 3 backends, force balance and committed history OK");
} finally {
  globalThis.fetch = originalFetch;
}

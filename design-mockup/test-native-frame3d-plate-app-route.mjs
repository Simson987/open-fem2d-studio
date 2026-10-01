import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { solveFrame3D, solveFrame3DCombination } from "./src/components/frame3d/frame3dSolver.ts";
import { parseFrame3DModel, withFrame3DSelfWeight } from "./src/components/frame3d/frame3dModel.ts";
import { frame3DMaximumDisplacementM } from "./src/components/frame3d/frame3dDisplacement.ts";
import { resolveSolver } from "./src/core/solver/SolverRegistry.ts";
import { CONCRETE_E_CM } from "./src/lib/sectionResolver.ts";
import Frame3DReportViews from "./src/components/frame3d/Frame3DReportViews.tsx";

const executable = (name) => fileURLToPath(new URL(`../src-tauri/target/debug/${name}`, import.meta.url));
const invoke = (binary, input) => new Promise((resolve, reject) => {
  const child = spawn(executable(binary), [], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [], errors = [];
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => errors.push(chunk));
  child.on("error", reject);
  child.on("close", (code) => code === 0
    ? resolve(JSON.parse(Buffer.concat(output).toString()))
    : reject(new Error(Buffer.concat(errors).toString() || Buffer.concat(output).toString())));
  child.stdin.end(JSON.stringify(input));
});

const model = {
  nodes: [
    { id: 11, x: 0, y: 0, z: 3 }, { id: 22, x: 2, y: 0, z: 3 },
    { id: 33, x: 2, y: 2, z: 3 }, { id: 44, x: 0, y: 2, z: 3 },
  ],
  beams: [], plates: [{ id: 7, nodeIds: [11, 22, 33, 44], thicknessM: 0.2, material: "C30/37" }],
  supports: [11, 22, 33, 44].map((nodeId) => ({ nodeId,
    ux: true, uy: true, uz: true, rx: false, ry: false, rz: false })),
  loads: [], surfaceLoads: [
    { id: 1, plateId: 7, caseId: 1, qx: 0, qy: 0, qz: -1 },
    { id: 2, plateId: 7, caseId: 2, qx: 0, qy: 0, qz: -2 },
  ],
};

const plateRequest = { schemaVersion: 1, dimension: "3d", analysis: "linear", elementFamilies: ["plate"] };
assert.equal(resolveSolver("openaec-native-fem", plateRequest).id, "openaec-native-fem");
assert.throws(() => resolveSolver("automatic", plateRequest), /Kies.*Open FEM Rust/);
assert.throws(() => resolveSolver("openaec-native-fem", { ...plateRequest, elementFamilies: ["frame", "plate"] }), /does not support/);
assert.throws(() => resolveSolver("openaec-native-fem", { ...plateRequest, analysis: "p-delta" }), /does not support/);
assert.equal(resolveSolver("openaec-native-fem", { ...plateRequest, analysis: "material-nonlinear" }).id,
  "openaec-native-fem");

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  const { kind, input } = body.inputs;
  calls.push({ kind, input });
  const binary = { quadMesh: "native-quad-mesh", hybridPlate: "native-hybrid-plate" }[kind];
  assert.ok(binary, `onverwachte kern: ${kind}`);
  const result = await invoke(binary, input);
  return new Response(JSON.stringify({ kind, result }), { status: 200 });
};
try {
  const first = await solveFrame3D(parseFrame3DModel(model), 1, "linear", "openaec-native-fem");
  assert.equal(first.engine.id, "openaec-native-fem");
  assert.equal(first.plateBending.plateId, 7);
  assert.equal(first.plateBending.nodes.length, 25);
  assert.equal(first.plateBending.elements.length, 16);
  assert.equal(first.displacements.length, 4);
  assert.equal(first.memberForces.length, 0);
  assert.equal(first.forceBalance.ok, true);
  assert.ok(first.forceBalance.maxImbalanceKn < 1e-8);
  assert.ok(first.forceBalance.maxMomentImbalanceKnm < 1e-8);
  assert.ok(Math.abs(first.reactions.reduce((sum, reaction) => sum + reaction.fz, 0) - 4) < 1e-8);
  assert.ok(frame3DMaximumDisplacementM(model, first) > 1e-5,
    "de grootste zakking ligt binnen de plaat en moet uit de roosterknopen komen");
  assert.ok(first.plateBending.nodes.some((node) => node.wM < -1e-5));
  assert.ok(first.plateBending.elements.some((element) => element.momentKnmPerM.some((value) => Math.abs(value) > 0.1)));
  const reportViews = renderToStaticMarkup(React.createElement(Frame3DReportViews, { model, result: first }));
  assert.ok((reportViews.match(/<polygon/g) ?? []).length >= 32,
    "de drie rapportaanzichten moeten het onvervormde en het vervormde plaatrooster tekenen");

  const combined = await solveFrame3DCombination(model, new Map([[1, 1], [2, 0.5]]), "linear", "openaec-native-fem");
  assert.ok(Math.abs(combined.reactions.reduce((sum, reaction) => sum + reaction.fz, 0) - 8) < 1e-8);
  assert.ok(Math.abs(frame3DMaximumDisplacementM(model, combined) / frame3DMaximumDisplacementM(model, first) - 2) < 1e-8);
  assert.equal(combined.forceBalance.ok, true);
  assert.deepEqual(calls.map((call) => call.kind), ["quadMesh", "hybridPlate", "quadMesh", "hybridPlate"]);
  assert.equal(calls[0].input.maxCellSizeM, 0.5);
  assert.equal(calls[1].input.pressureKnM2, -1);
  assert.equal(calls[3].input.pressureKnM2, -2);

  const asymmetric = { ...model, supports: model.supports.map((support) => support.nodeId === 11
    ? { ...support, rx: true, ry: true } : support) };
  const fixedCorner = await solveFrame3D(asymmetric, 1, "linear", "openaec-native-fem");
  assert.equal(fixedCorner.forceBalance.ok, true,
    "reactiemomenten van een enkel ingeklemde hoek moeten het globale momentenevenwicht sluiten");
  assert.ok(fixedCorner.forceBalance.maxMomentImbalanceKnm < 1e-8);
  assert.ok(Math.abs(fixedCorner.reactions[0].mx) > 0.1);
  const pointMoment = { ...asymmetric, loads: [{ id: 3, nodeId: 22, caseId: 1,
    fx: 0, fy: 0, fz: 0, mx: 0, my: 0.1, mz: 0 }] };
  const withMoment = await solveFrame3D(pointMoment, 1, "linear", "openaec-native-fem");
  assert.equal(withMoment.forceBalance.ok, true, "een globaal My-puntmoment moet ook met het plaatteken sluiten");
  assert.equal(calls.at(-1).input.loads[0].my, -0.1,
    "het globale puntmoment krijgt bij de plaatgrens de tegengestelde lokale tekenconventie");
  const meshCorner = withMoment.plateBending.nodes.find((node) => node.x === 2 && node.y === 0);
  assert.ok(Math.abs(meshCorner.thetaYRad - withMoment.displacements.find((node) => node.nodeId === 22).ry) < 1e-12);

  // Rotate the complete structural problem around Y and then Z. A bending
  // plate must give the same local w, moments and scalar reactions regardless
  // of its orientation in global XYZ.
  const theta = Math.PI / 6, psi = Math.PI / 7;
  const rotate = ([x, y, z]) => {
    const x1 = Math.cos(theta) * x + Math.sin(theta) * z;
    const z1 = -Math.sin(theta) * x + Math.cos(theta) * z;
    return [Math.cos(psi) * x1 - Math.sin(psi) * y,
      Math.sin(psi) * x1 + Math.cos(psi) * y, z1];
  };
  const tilted = {
    ...model,
    nodes: model.nodes.map((node) => {
      const [x, y, z] = rotate([node.x, node.y, node.z]);
      return { ...node, x, y, z };
    }),
    surfaceLoads: model.surfaceLoads.map((load) => {
      const [qx, qy, qz] = rotate([0, 0, load.qz]);
      return { ...load, qx, qy, qz };
    }),
  };
  const tiltedResult = await solveFrame3D(parseFrame3DModel(tilted), 1, "linear", "openaec-native-fem");
  assert.equal(tiltedResult.forceBalance.ok, true);
  assert.ok(tiltedResult.forceBalance.maxImbalanceKn < 1e-8);
  assert.ok(tiltedResult.forceBalance.maxMomentImbalanceKnm < 1e-8);
  for (let index = 0; index < first.plateBending.nodes.length; index++) {
    const baseNode = first.plateBending.nodes[index], tiltedNode = tiltedResult.plateBending.nodes[index];
    assert.ok(Math.abs(baseNode.wM - tiltedNode.wM) < 1e-10,
      `node ${index}: ${baseNode.wM} vs ${tiltedNode.wM}`);
    const expected = rotate([baseNode.x, baseNode.y, baseNode.z]);
    assert.ok(Math.hypot(tiltedNode.x - expected[0], tiltedNode.y - expected[1], tiltedNode.z - expected[2]) < 1e-9);
  }
  for (let index = 0; index < first.reactions.length; index++) {
    const expected = rotate([first.reactions[index].fx, first.reactions[index].fy, first.reactions[index].fz]);
    const actual = tiltedResult.reactions[index];
    assert.ok(Math.hypot(actual.fx - expected[0], actual.fy - expected[1], actual.fz - expected[2]) < 1e-8);
    const baseDisplacement = first.displacements[index], tiltedDisplacement = tiltedResult.displacements[index];
    const expectedDisplacement = rotate([baseDisplacement.ux, baseDisplacement.uy, baseDisplacement.uz]);
    assert.ok(Math.hypot(tiltedDisplacement.ux - expectedDisplacement[0],
      tiltedDisplacement.uy - expectedDisplacement[1], tiltedDisplacement.uz - expectedDisplacement[2]) < 1e-10);
  }
  const reversed = { ...model, plates: [{ ...model.plates[0], nodeIds: [11, 44, 33, 22] }] };
  const reversedResult = await solveFrame3D(reversed, 1, "linear", "openaec-native-fem");
  assert.equal(reversedResult.forceBalance.ok, true);
  for (const node of first.displacements) {
    const actual = reversedResult.displacements.find((value) => value.nodeId === node.nodeId);
    assert.ok(Math.abs(actual.uz - node.uz) < 1e-10, "omgekeerde contourvolgorde mag de globale zakking niet wijzigen");
  }
  assert.ok(reversedResult.plateBending.basis.normal[2] < -0.999);
  const rotatedFixed = {
    ...tilted,
    supports: tilted.supports.map((support) => support.nodeId === 11
      ? { ...support, rx: true, ry: true, rz: true } : support),
    loads: pointMoment.loads.map((load) => {
      const [mx, my, mz] = rotate([load.mx, load.my, load.mz]);
      return { ...load, mx, my, mz };
    }),
  };
  const tiltedMoment = await solveFrame3D(rotatedFixed, 1, "linear", "openaec-native-fem");
  assert.equal(tiltedMoment.forceBalance.ok, true);
  assert.ok(Math.abs(tiltedMoment.plateBending.nodes[12].wM - withMoment.plateBending.nodes[12].wM) < 1e-10);
  await assert.rejects(solveFrame3D({ ...tilted,
    surfaceLoads: [{ ...tilted.surfaceLoads[0], qx: tilted.surfaceLoads[0].qx + 0.25 }],
  }, 1, "linear", "openaec-native-fem"), /oppervlaktebelasting normaal/);
  await assert.rejects(solveFrame3D({ ...tilted,
    supports: tilted.supports.map((support) => support.nodeId === 11 ? { ...support, ux: false, uy: false } : support),
  }, 1, "linear", "openaec-native-fem"), /alle drie globale translatie-assen/);
  await assert.rejects(solveFrame3D(withFrame3DSelfWeight(tilted, 3),
    3, "linear", "openaec-native-fem"), /oppervlaktebelasting normaal/,
  "zwaartekracht op een schuine plaat heeft ook niet-ondersteunde schijfwerking");

  const weighted = withFrame3DSelfWeight(model, 3);
  const ownWeight = weighted.surfaceLoads.at(-1);
  assert.equal(ownWeight.plateId, 7);
  assert.equal(ownWeight.caseId, 3);
  assert.ok(Math.abs(ownWeight.qz + 4.905) < 1e-12);
  const weightResult = await solveFrame3D(weighted, 3, "linear", "openaec-native-fem");
  assert.ok(Math.abs(weightResult.reactions.reduce((sum, reaction) => sum + reaction.fz, 0) - 19.62) < 1e-8);
  assert.equal(weightResult.forceBalance.ok, true);

  const initialE = CONCRETE_E_CM["C30/37"];
  const softeningCurve = [{ strain: 0, eMpa: initialE }, { strain: 1e-10, eMpa: initialE / 2 }];
  const materialModel = parseFrame3DModel({ ...model,
    plates: [{ ...model.plates[0], modulusCurve: softeningCurve }], materialLoadPath: [1] });
  assert.deepEqual(materialModel.plates[0].modulusCurve, softeningCurve,
    "de FNL-curve moet de projectmodelparser passeren");
  const softened = await solveFrame3D(materialModel, 1, "material", "openaec-native-fem");
  assert.equal(softened.analysis, "material");
  assert.ok(softened.materialIterations > 1);
  assert.equal(softened.forceBalance.ok, true);
  assert.ok(softened.plateBending.elements.every((element) =>
    Math.abs(element.effectiveEMpa - initialE / 2) < 1e-8 && element.maxFibreStrain > 1e-10));
  assert.ok(Math.abs(frame3DMaximumDisplacementM(model, softened)
    / frame3DMaximumDisplacementM(model, first) - 2) < 1e-7,
  "halvering van E moet bij verzadigde secantcurve de elastische zakking verdubbelen");
  const softenedCombination = await solveFrame3DCombination(materialModel,
    new Map([[1, 1], [2, 0.5]]), "material", "openaec-native-fem");
  assert.equal(softenedCombination.forceBalance.ok, true);
  assert.ok(Math.abs(frame3DMaximumDisplacementM(model, softenedCombination)
    / frame3DMaximumDisplacementM(model, softened) - 2) < 1e-7,
  "de FNL-combinatie moet als verdubbelde volledige lastvector door de Rust-kern gaan");
  const unloaded = await solveFrame3D({ ...materialModel, materialLoadPath: [1, 0] },
    1, "material", "openaec-native-fem");
  assert.equal(unloaded.forceBalance.ok, true);
  assert.ok(frame3DMaximumDisplacementM(model, unloaded) < 1e-9);
  assert.ok(unloaded.plateBending.elements.every((element) =>
    Math.abs(element.effectiveEMpa - initialE / 2) < 1e-8 && element.maxFibreStrain > 1e-10));
  await assert.rejects(solveFrame3D(model, 1, "material", "openaec-native-fem"), /expliciete E-rekcurve/);
  await assert.rejects(solveFrame3D({ ...materialModel,
    plates: [{ ...materialModel.plates[0], modulusCurve: [{ strain: 0, eMpa: initialE * 1.1 }, softeningCurve[1]] }],
  },
  1, "material", "openaec-native-fem"), /materiaaleigen E/);
  assert.throws(() => parseFrame3DModel({ ...materialModel,
    plates: [{ ...materialModel.plates[0], modulusCurve: [{ strain: 0, eMpa: initialE * 1.1 }, softeningCurve[1]] }],
  }), /materiaaleigen E/, "ook de plaateditor moet een foutieve begin-E direct weigeren");
  assert.throws(() => parseFrame3DModel({ ...model,
    plates: [{ ...model.plates[0], modulusCurve: [{ strain: 0, eMpa: initialE }, { strain: 0.001, eMpa: initialE * 1.1 }] }],
  }), /niet-toenemende E/);

  await assert.rejects(solveFrame3D({ ...model, plates: [{ ...model.plates[0], openings: [{ id: 1, nodeIds: [11, 22, 33] }] }] },
    1, "linear", "openaec-native-fem"), /zonder bogen.*openingen/);
  await assert.rejects(solveFrame3D({ ...model, surfaceLoads: [{ ...model.surfaceLoads[0], qx: 1 }] },
    1, "linear", "openaec-native-fem"), /alleen een oppervlaktebelasting normaal/);
  await assert.rejects(solveFrame3D(model, 1, "p-delta", "openaec-native-fem"), /lineaire of FNL Open FEM Rust-plaatroute/);
  console.log("3D-plaatroute via Rust: evenwicht, combinaties, rotaties, FNL-E(rek), ontlasten en afwijzingen geslaagd.");
} finally {
  globalThis.fetch = originalFetch;
}

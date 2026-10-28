import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseFrame3DModel, withFrame3DSelfWeight } from "./src/components/frame3d/frame3dModel.ts";
import { buildFrame3DSolveRequest, frame3DAnalysisForProject,
  solveFrame3D, solveFrame3DCombination } from "./src/components/frame3d/frame3dSolver.ts";
import { resolveSolver } from "./src/core/solver/SolverRegistry.ts";
import { deserializeProject } from "./src/io/projectFile.ts";

const binary = fileURLToPath(new URL("../src-tauri/target/debug/native-mixed3d", import.meta.url));
const solidE = 1200, solidNu = 0.2, membraneE = 3000, membraneNu = 0.25, thickness = 0.08;
const lam = solidE * solidNu / ((1 + solidNu) * (1 - 2 * solidNu));
const mu = solidE / (2 * (1 + solidNu));
const stiffness = 1000 * ((lam + 2 * mu) / 6 + membraneE / (1 - membraneNu ** 2) * thickness / 2);
const close = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
const restrained = (nodeId, ux = true) =>
  ({ nodeId, ux, uy: true, uz: true, rx: false, ry: false, rz: false });
const model = parseFrame3DModel({
  nodes: [{ id: 10, x: 0, y: 0, z: 0 }, { id: 20, x: 1, y: 0, z: 0 },
    { id: 30, x: 0, y: 1, z: 0 }, { id: 40, x: 0, y: 0, z: 1 }],
  beams: [],
  volumes: [{ id: 1, kind: "tet4", nodeIds: [10, 20, 30, 40],
    eMpa: solidE, poisson: solidNu, densityKgPerM3: 2500 }],
  plates: [{ id: 2, nodeIds: [10, 20, 30], thicknessM: thickness, material: "C30/37",
    membraneOnly: true, membraneEMpa: membraneE, membranePoisson: membraneNu }],
  supports: [restrained(10), restrained(20, false), restrained(30), restrained(40)],
  loads: [{ id: 1, nodeId: 20, caseId: 1, fx: 10, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
  surfaceLoads: [{ id: 2, plateId: 2, caseId: 2, qx: 6, qy: 0, qz: 0 }],
});
assert.equal(model.plates[0].membraneOnly, true);
const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/tet4-tri3-membraan.ifcfem2d", import.meta.url), "utf8"));
assert.equal(project.modelDimension, "3d");
assert.equal(project.model3d.plates[0].membraneOnly, true);
assert.equal(resolveSolver("automatic", { schemaVersion: 1, dimension: "3d", analysis: "linear",
  elementFamilies: ["solid", "plate"] }).id, "openaec-native-fem");
assert.throws(() => parseFrame3DModel({ ...model,
  plates: [{ ...model.plates[0], openings: [{ id: 1, nodeIds: [10, 20, 30] }] }] }), /Tri3|opening/i);

const previousFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.inputs.kind, "mixed3d");
  requests.push(body.inputs.input);
  const native = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const output = [], errors = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve(JSON.parse(Buffer.concat(output).toString()))
      : reject(new Error(Buffer.concat(errors).toString() || Buffer.concat(output).toString())));
    child.stdin.end(JSON.stringify(body.inputs.input));
  });
  return new Response(JSON.stringify({ kind: "mixed3d", result: native }), { status: 200 });
};

try {
  const saved = await solveFrame3D(project.model3d, project.activeLoadCaseId,
    "linear", "openaec-native-fem");
  close(saved.displacements.find((node) => node.nodeId === 20).ux, 10 / stiffness, 1e-11,
    "opgeslagen projectbestand via normale app-route");
  for (const backend of ["dense", "sparseDirect", "sparsePcg", "frontalWave", "matrixFreePcg", "automatic"]) {
    const result = await solveFrame3D({ ...model, volumeBackend: backend }, 1, "linear", "openaec-native-fem");
    const request = requests.at(-1);
    assert.deepEqual(request.mesh.tets, [[0, 1, 2, 3]]);
    assert.deepEqual(request.membranes[0], { nodes: [0, 1, 2], eMpa: membraneE,
      nu: membraneNu, thicknessM: thickness });
    close(result.displacements.find((node) => node.nodeId === 20).ux, 10 / stiffness, 1e-11,
      `${backend} gedeelde Tet4/Tri3-verplaatsing`);
    const membrane = result.volume3D.membranes[0];
    close(membrane.stressMpa[0], membraneE / (1 - membraneNu ** 2) * 10 / stiffness, 1e-8,
      `${backend} lokale membraanspanning`);
    close(membrane.resultantsKnPerM[0], 1000 * thickness * membrane.stressMpa[0], 1e-8,
      `${backend} membraanresultante`);
    assert.ok(result.forceBalance.ok);
    assert.ok(result.volume3D.relativeResidual < 1e-8);
  }
  const pressure = await solveFrame3D(model, 2, "linear", "openaec-native-fem");
  assert.deepEqual(requests.at(-1).membraneTractions,
    [{ element: 0, tractionKnPerM2: [6, 0, 0] }]);
  assert.ok(requests.at(-1).loadsKn.every((load) => load.every((value) => value === 0)));
  close(pressure.displacements.find((node) => node.nodeId === 20).ux, 1 / stiffness, 1e-11,
    "consistente driehoeksvlaklast per knoop A q / 3");
  close(pressure.reactions.reduce((sum, item) => sum + item.fx, 0), -3, 1e-8,
    "driehoeksvlaklastreactie");
  assert.ok(pressure.forceBalance.ok);
  const combined = await solveFrame3DCombination(model, new Map([[1, 1.5], [2, -2]]),
    "linear", "openaec-native-fem");
  assert.deepEqual(requests.at(-1).membraneTractions,
    [{ element: 0, tractionKnPerM2: [-12, 0, 0] }]);
  assert.deepEqual(requests.at(-1).loadsKn[1], [15, 0, 0]);
  close(combined.displacements.find((node) => node.nodeId === 20).ux, 13 / stiffness, 1e-11,
    "membraan plus volume met combinatiefactoren");
  assert.ok(combined.forceBalance.ok);
  const weighted = withFrame3DSelfWeight(model, 7);
  assert.equal(weighted.volumeBodyLoads.length, 1);
  assert.equal(weighted.surfaceLoads.length, 2);
  const gravity = await solveFrame3D(weighted, 7, "linear", "openaec-native-fem");
  assert.ok(gravity.forceBalance.ok);
  assert.ok(gravity.volume3D.relativeResidual < 1e-8);
  const hexNodes = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const hexModel = parseFrame3DModel({
    nodes: hexNodes.map(([x, y, z], index) => ({ id: index + 1, x, y, z })),
    beams: [],
    volumes: [{ id: 1, kind: "hex8", nodeIds: [1, 2, 3, 4, 5, 6, 7, 8],
      eMpa: solidE, poisson: solidNu }],
    plates: [{ id: 2, nodeIds: [1, 2, 4], thicknessM: thickness,
      membraneOnly: true, membraneEMpa: membraneE, membranePoisson: membraneNu }],
    supports: hexNodes.map((_, index) => restrained(index + 1, index !== 1)),
    loads: [{ id: 1, nodeId: 2, caseId: 1, fx: 10, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
    volumeBackend: "matrixFreePcg",
  });
  const hexResult = await solveFrame3D(hexModel, 1, "linear", "openaec-native-fem");
  const hexStiffness = 1000 * (lam + 4 * mu) / 9;
  const membraneStiffness = 1000 * membraneE / (1 - membraneNu ** 2) * thickness / 2;
  close(hexResult.displacements.find((node) => node.nodeId === 2).ux,
    10 / (hexStiffness + membraneStiffness), 1e-11, "gedeelde Hex8/Tri3-verplaatsing");
  assert.equal(hexResult.volume3D.elements[0].gaussStressMpa.length, 8);
  assert.ok(hexResult.forceBalance.ok);
  const frameModel = parseFrame3DModel({ ...model,
    nodes: [...model.nodes, { id: 50, x: 1, y: 1, z: 0 }],
    beams: [{ id: 3, startNodeId: 20, endNodeId: 50, profileName: "200x100",
      material: "VRIJ:Teststaal E=200000 rho=7850 f=235" }],
    supports: model.supports.map((support) => support.nodeId === 20
      ? { ...support, rx: true, ry: true, rz: true } : support),
    loads: [{ id: 1, nodeId: 50, caseId: 1, fx: 10, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
  });
  const frameRequest = buildFrame3DSolveRequest(frameModel, "linear", 1, true);
  const frameSection = frameRequest.sections.find(section =>
    section.id === frameRequest.members[0].sectionId);
  const frameMaterial = frameRequest.materials.find(material =>
    material.id === frameRequest.members[0].materialId);
  const frameFlexuralStiffness = 1000 * frameMaterial.eMpa * frameSection.izM4;
  const expectedFrameTipUx = 10 / stiffness + 10 / (3 * frameFlexuralStiffness);
  for (const backend of ["dense", "frontalWave", "matrixFreePcg"]) {
    const coupled = await solveFrame3D({ ...frameModel, volumeBackend: backend }, 1,
      "linear", "openaec-native-fem");
    close(coupled.displacements.find(node => node.nodeId === 20).ux, 10 / stiffness,
      1e-9, `${backend} gedeelde Tet4/Tri3/raamwerk-wortel`);
    close(coupled.displacements.find(node => node.nodeId === 50).ux,
      expectedFrameTipUx, 1e-8, `${backend} onafhankelijke serie-parallel-veerstijfheid`);
    assert.equal(coupled.volume3D.membranes.length, 1);
    assert.equal(coupled.memberForces.length, 1);
    assert.ok(coupled.forceBalance.ok && coupled.equilibrium.equilibriumOk);
  }
  // Independent spring reference: the Hex8, Tet4 and Tri3 share only the
  // released x translation at node 2. The frame is a cantilever in series.
  const fourFamilyModel = parseFrame3DModel({ ...hexModel,
    nodes: [...hexModel.nodes, { id: 9, x: 1, y: -1, z: 0 },
      { id: 10, x: 2, y: 0, z: 0 }, { id: 11, x: 2, y: 1, z: 0 },
      { id: 12, x: 2, y: 0, z: 1 }],
    volumes: [...hexModel.volumes, { id: 4, kind: "tet4", nodeIds: [2, 10, 11, 12],
      eMpa: solidE, poisson: solidNu }],
    beams: [{ ...frameModel.beams[0], startNodeId: 2, endNodeId: 9 }],
    supports: [...hexModel.supports.map(support => support.nodeId === 2
      ? { ...support, rx: true, ry: true, rz: true } : support),
      restrained(10), restrained(11), restrained(12)],
    loads: [{ ...hexModel.loads[0], nodeId: 9 }],
  });
  const fourFamilyRootStiffness = hexStiffness + 1000 * (lam + 2 * mu) / 6
    + membraneStiffness;
  const fourFamilyTip = 10 / fourFamilyRootStiffness
    + 10 / (3 * frameFlexuralStiffness);
  for (const backend of ["dense", "frontalWave", "matrixFreePcg"]) {
    const result = await solveFrame3D({ ...fourFamilyModel, volumeBackend: backend },
      1, "linear", "openaec-native-fem");
    close(result.displacements.find(node => node.nodeId === 2).ux,
      10 / fourFamilyRootStiffness, 1e-9,
      `${backend} gedeelde Tet4/Hex8/Tri3/raamwerk-wortel`);
    close(result.displacements.find(node => node.nodeId === 9).ux,
      fourFamilyTip, 1e-8, `${backend} vier-families-serie-parallel-referentie`);
    assert.deepEqual(requests.at(-1).mesh.tets, [[1, 9, 10, 11]]);
    assert.equal(result.volume3D.elements.length, 2);
    assert.equal(result.volume3D.membranes.length, 1);
    assert.equal(result.memberForces.length, 1);
    assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk);
  }
  const j2FrameModel = parseFrame3DModel({ ...frameModel,
    volumes: frameModel.volumes.map(volume => ({ ...volume,
      materialLaw: { kind: "steelJ2", yieldMpa: 1_000_000, hardeningMpa: 2_000 } })),
    volumeMaterialKinematics: "finiteStrain", volumeResidualTolerance: 1e-8,
    materialLoadPath: [0.5, 1],
    loads: frameModel.loads.map(load => ({ ...load, fx: 0.05 })),
  });
  const bridge = fileURLToPath(new URL("../src-tauri/target/release/toetsbrug", import.meta.url));
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/toetsing");
    const body = JSON.parse(options.body);
    assert.equal(body.inputs.kind, "volume3dFiniteJ2FrameCoupled");
    assert.equal(body.inputs.input.membranes.length, 1);
    assert.equal(body.inputs.input.frames.length, 1);
    const response = await new Promise((resolve, reject) => {
      const child = spawn(bridge, [], { stdio: ["pipe", "pipe", "pipe"] });
      const chunks = [], errors = [];
      child.stdout.on("data", chunk => chunks.push(chunk));
      child.stderr.on("data", chunk => errors.push(chunk));
      child.on("error", reject);
      child.on("close", code => resolve({ code,
        output: Buffer.concat(chunks).toString(), error: Buffer.concat(errors).toString() }));
      child.stdin.end(JSON.stringify(body));
    });
    return new Response(response.output || response.error,
      { status: response.code === 0 ? 200 : 400 });
  };
  for (const backend of ["dense", "frontalWave"]) {
    const nonlinear = await solveFrame3D({ ...j2FrameModel, volumeBackend: backend }, 1,
      "material", "openaec-native-fem");
    close(nonlinear.displacements.find(node => node.nodeId === 20).ux,
      0.05 / stiffness, 1e-8, `${backend} J2-volume/Tri3/raamwerk-wortel`);
    close(nonlinear.displacements.find(node => node.nodeId === 50).ux,
      expectedFrameTipUx * 0.005, 1e-8, `${backend} J2-volume/Tri3/raamwerk-tip`);
    assert.equal(nonlinear.volume3D.membranes.length, 1);
    assert.equal(nonlinear.memberForces.length, 1);
    assert.ok(nonlinear.forceBalance.ok && nonlinear.equilibrium.equilibriumOk);
  }
  const combinedShellFrame = await solveFrame3D({ ...j2FrameModel, volumeBackend: "frontalWave" },
    1, "combined", "openaec-native-fem");
  close(combinedShellFrame.displacements.find(node => node.nodeId === 50).ux,
    expectedFrameTipUx * 0.005, 1e-8, "gekoppelde GNL/FNL Tet4/Tri3/raamwerk-tip");
  assert.equal(combinedShellFrame.volume3D.membranes.length, 1);
  assert.equal(combinedShellFrame.diagrams.momentZ.length, 1);
  assert.ok(combinedShellFrame.forceBalance.ok && combinedShellFrame.equilibrium.equilibriumOk);
  const j2FourFamily = parseFrame3DModel({ ...fourFamilyModel,
    volumes: fourFamilyModel.volumes.map(volume => ({ ...volume,
      materialLaw: { kind: "steelJ2", yieldMpa: 1_000_000, hardeningMpa: 2_000 } })),
    volumeMaterialKinematics: "finiteStrain", volumeResidualTolerance: 1e-8,
    materialLoadPath: [0.5, 1],
    loads: fourFamilyModel.loads.map(load => ({ ...load, fx: 0.05 })),
  });
  for (const [analysis, backend] of [["material", "dense"],
    ["material", "frontalWave"], ["combined", "frontalWave"]]) {
    const result = await solveFrame3D({ ...j2FourFamily, volumeBackend: backend },
      1, analysis, "openaec-native-fem");
    close(result.displacements.find(node => node.nodeId === 2).ux,
      0.05 / fourFamilyRootStiffness, 1e-8,
      `${analysis}/${backend} vier-families-wortel in elastische J2-limiet`);
    close(result.displacements.find(node => node.nodeId === 9).ux,
      fourFamilyTip * 0.005, 1e-8,
      `${analysis}/${backend} vier-families-tip in elastische J2-limiet`);
    assert.equal(result.volume3D.elements.length, 2);
    assert.equal(result.volume3D.membranes.length, 1);
    assert.equal(result.memberForces.length, 1);
    assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk);
  }
  const plasticFourFamily = parseFrame3DModel({ ...j2FourFamily,
    volumes: j2FourFamily.volumes.map(volume => ({ ...volume,
      materialLaw: { kind: "steelJ2", yieldMpa: 0.001, hardeningMpa: 300 } })),
    materialLoadPath: [0.25, 0.5, 1],
    loads: j2FourFamily.loads.map(load => ({ ...load, fx: 5 })),
  });
  const plasticResults = [];
  for (const backend of ["dense", "frontalWave"]) {
    const result = await solveFrame3D({ ...plasticFourFamily, volumeBackend: backend },
      1, "material", "openaec-native-fem");
    assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk);
    assert.ok(result.volume3D.elements.every(element => element.equivalentPlasticStrain > 0));
    for (const element of result.volume3D.elements) {
      assert.ok(element.vonMisesMpa <= 0.001 + 300 * element.equivalentPlasticStrain
        + 1e-5, `${backend} ${element.kind} gemiddelde J2-vloeigrens`);
    }
    assert.ok(result.displacements.find(node => node.nodeId === 2).ux
      > 5 / fourFamilyRootStiffness,
    `${backend}: plastificatie vergroot de gedeelde wortelverplaatsing`);
    plasticResults.push(result);
  }
  close(plasticResults[0].displacements.find(node => node.nodeId === 9).ux,
    plasticResults[1].displacements.find(node => node.nodeId === 9).ux,
    1e-7, "plastisch vier-families-model: dicht/frontaal parity");
  const plasticCombined = await solveFrame3D({ ...plasticFourFamily,
    volumeBackend: "frontalWave" }, 1, "combined", "openaec-native-fem");
  assert.ok(plasticCombined.volume3D.elements.every(element =>
    element.equivalentPlasticStrain > 0));
  for (const element of plasticCombined.volume3D.elements) {
    assert.ok(element.vonMisesMpa <= 0.001 + 300 * element.equivalentPlasticStrain
      + 1e-5, `combined ${element.kind} gemiddelde J2-vloeigrens`);
  }
  assert.ok(plasticCombined.forceBalance.ok && plasticCombined.equilibrium.equilibriumOk);
  const unloadedFourFamily = parseFrame3DModel({ ...plasticFourFamily,
    materialLoadPath: [0.25, 0.5, 1, 0],
  });
  const unloadedResults = [];
  for (const backend of ["dense", "frontalWave"]) {
    const result = await solveFrame3D({ ...unloadedFourFamily,
      volumeBackend: backend }, 1, "material", "openaec-native-fem");
    assert.ok(result.volume3D.elements.every(element => element.equivalentPlasticStrain > 0));
    assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk);
    assert.ok(Math.abs(result.displacements.find(node => node.nodeId === 9).ux) > 1e-8,
      `${backend} plastisch restveld na volledige ontlasting`);
    unloadedResults.push(result);
  }
  close(unloadedResults[0].displacements.find(node => node.nodeId === 9).ux,
    unloadedResults[1].displacements.find(node => node.nodeId === 9).ux,
    1e-7, "vier-families-ontlasting: dicht/frontaal parity");
  const unloadedCombined = await solveFrame3D({ ...unloadedFourFamily,
    volumeBackend: "frontalWave" }, 1, "combined", "openaec-native-fem");
  assert.ok(unloadedCombined.volume3D.elements.every(element =>
    element.equivalentPlasticStrain > 0));
  assert.ok(unloadedCombined.forceBalance.ok && unloadedCombined.equilibrium.equilibriumOk);
  assert.ok(Math.abs(unloadedCombined.displacements.find(node => node.nodeId === 9).ux) > 1e-8);
  close(unloadedCombined.displacements.find(node => node.nodeId === 9).ux,
    unloadedCombined.displacements.find(node => node.nodeId === 2).ux,
    1e-8, "ontlaste elastische staaf draagt geen restbuiging");
  const savedThreeWay = deserializeProject(readFileSync(new URL(
    "../docs/verificatie/3d-volume/tet4-tri3-raamwerk-j2-gekoppeld.ifcfem2d",
    import.meta.url), "utf8"));
  assert.deepEqual([savedThreeWay.model3d.volumes.length, savedThreeWay.model3d.plates.length,
    savedThreeWay.model3d.beams.length], [1, 1, 1]);
  const savedAnalysis = frame3DAnalysisForProject(savedThreeWay.model3d, savedThreeWay.analysetype);
  assert.equal(savedAnalysis, "combined");
  const savedThreeWayResult = await solveFrame3D(savedThreeWay.model3d,
    savedThreeWay.activeLoadCaseId, savedAnalysis, "openaec-native-fem");
  close(savedThreeWayResult.displacements.find(node => node.nodeId === 50).ux,
    combinedShellFrame.displacements.find(node => node.nodeId === 50).ux,
    1e-10, "opgeslagen Tet4/Tri3/raamwerk-project via app-route");
  const savedFourFamily = deserializeProject(readFileSync(new URL(
    "../docs/verificatie/3d-volume/tet4-hex8-tri3-raamwerk-j2-gekoppeld.ifcfem2d",
    import.meta.url), "utf8"));
  assert.deepEqual([savedFourFamily.model3d.volumes.length,
    savedFourFamily.model3d.plates.length, savedFourFamily.model3d.beams.length],
    [2, 1, 1]);
  const savedFourFamilyAnalysis = frame3DAnalysisForProject(savedFourFamily.model3d,
    savedFourFamily.analysetype);
  assert.equal(savedFourFamilyAnalysis, "combined");
  const savedFourFamilyResult = await solveFrame3D(savedFourFamily.model3d,
    savedFourFamily.activeLoadCaseId, savedFourFamilyAnalysis, "openaec-native-fem");
  close(savedFourFamilyResult.displacements.find(node => node.nodeId === 9).ux,
    fourFamilyTip * 0.005, 1e-8,
    "opgeslagen Tet4/Hex8/Tri3/raamwerk-project via app-route");
  assert.ok(savedFourFamilyResult.forceBalance.ok && savedFourFamilyResult.equilibrium.equilibriumOk);
  const savedPlastic = deserializeProject(readFileSync(new URL(
    "../docs/verificatie/3d-volume/tet4-hex8-tri3-raamwerk-j2-plastisch.ifcfem2d",
    import.meta.url), "utf8"));
  assert.equal(frame3DAnalysisForProject(savedPlastic.model3d, savedPlastic.analysetype),
    "combined");
  const savedPlasticResult = await solveFrame3D(savedPlastic.model3d,
    savedPlastic.activeLoadCaseId, "combined", "openaec-native-fem");
  close(savedPlasticResult.displacements.find(node => node.nodeId === 9).ux,
    plasticCombined.displacements.find(node => node.nodeId === 9).ux,
    1e-8, "opgeslagen plastisch vier-families-project via app-route");
  assert.ok(savedPlasticResult.volume3D.elements.every(element =>
    element.equivalentPlasticStrain > 0));
  const savedUnload = deserializeProject(readFileSync(new URL(
    "../docs/verificatie/3d-volume/tet4-hex8-tri3-raamwerk-j2-ontlasten.ifcfem2d",
    import.meta.url), "utf8"));
  assert.deepEqual(savedUnload.model3d.materialLoadPath, [0.25, 0.5, 1, 0]);
  const savedUnloadResult = await solveFrame3D(savedUnload.model3d,
    savedUnload.activeLoadCaseId,
    frame3DAnalysisForProject(savedUnload.model3d, savedUnload.analysetype),
    "openaec-native-fem");
  close(savedUnloadResult.displacements.find(node => node.nodeId === 9).ux,
    unloadedCombined.displacements.find(node => node.nodeId === 9).ux,
    1e-8, "opgeslagen vier-families-ontlastproject via app-route");
  assert.ok(savedUnloadResult.volume3D.elements.every(element =>
    element.equivalentPlasticStrain > 0));
  // Sinds de gekoppelde XY-DKT-buigplaten (frame3dVolumeSolver,
  // bendingPlateTriangles) rekent de lineaire volumeroute een buigplaat wél
  // mee; de weigering geldt nog voor een niet-lineaire analyse buiten de
  // eindige-rek J2-route (hier: materiaal-FNL zonder eindige rek). Vroeger
  // stond hier "linear", wat nu een echte
  // mixed3d-berekening start in plaats van de bedoelde weigering.
  await assert.rejects(solveFrame3D({ ...model, plates: [{ ...model.plates[0], membraneOnly: false }] },
    1, "material", "openaec-native-fem"), /buigplaten/i);
  console.log("Gedeelde Tri3/Tet4/Hex8/3D-staaf-app-route: analytische stijfheid, plastische volumes, J2/GNL, backend-pariteit en opgeslagen projecten geslaagd."
    + ` Ontlastrest u_tip=${unloadedCombined.displacements.find(node => node.nodeId === 9).ux.toExponential(6)} m.`);
} finally {
  globalThis.fetch = previousFetch;
}

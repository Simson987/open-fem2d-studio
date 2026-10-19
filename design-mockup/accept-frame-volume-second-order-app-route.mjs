import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { buildFrame3DSolveRequest, frame3DAnalysisForProject, solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/tet4-hex8-j2-buigraamwerk.ifcfem2d",
  import.meta.url), "utf8"));
const model = { ...project.model3d,
  volumeResidualTolerance: 1e-8,
  loads: project.model3d.loads.map(load => load.id === 1
    ? { ...load, fx: -250, fz: -0.1 } : load),
};
assert.deepEqual([model.beams.length, model.volumes.length], [1, 3]);
assert.equal(frame3DAnalysisForProject(model, "axiaalFysischRust"), "combined");
assert.equal(frame3DAnalysisForProject(model, "tweedeOrdeFysisch"), "combined");

const frameRequest = buildFrame3DSolveRequest(model, "combined", project.activeLoadCaseId, true);
const beam = frameRequest.members.find(member => member.id === 1);
const section = frameRequest.sections.find(item => item.id === beam.sectionId);
const material = frameRequest.materials.find(item => item.id === beam.materialId);
const length = 1;
const flexuralRigidity = material.eMpa * 1_000 * section.iyM4;
const axialLoad = 250;
const lateralLoad = 0.1;
const waveNumber = Math.sqrt(axialLoad / flexuralRigidity);
const expectedFirstOrder = lateralLoad * length ** 3 / (3 * flexuralRigidity);
// Closed cantilever beam-column solution of EI*w'''' + P*w'' = 0, with
// w(0)=w'(0)=w''(L)=0 and a lateral end shear H. The root translations
// cancel when tip and shared Tet4/Hex8 root displacements are subtracted.
const expectedSecondOrder = lateralLoad / axialLoad
  * (Math.tan(waveNumber * length) / waveNumber - length);

// Independent constant-coefficient EI*w''''+P*w''=q beam-column solution.
// Propagate displacement/slope/curvature/third derivative from the clamp;
// solve the two free-end conditions for the unknown clamp curvature and shear.
function beamColumnTipUnderMemberLoad(pointKn = 0, uniformKnPerM = 0,
  pointAtM = length / 2) {
  const k = waveNumber, ei = flexuralRigidity, p = axialLoad;
  const propagate = ([w, theta, curvature, third], span, q = 0) => {
    const sine = Math.sin(k * span), cosine = Math.cos(k * span);
    const forcing = q / (ei * k * k);
    return [
      w + theta * span + curvature * (1 - cosine) / (k * k)
        + third * (span / (k * k) - sine / (k ** 3))
        + forcing * (span * span / 2 - (1 - cosine) / (k * k)),
      theta + curvature * sine / k + third * (1 - cosine) / (k * k)
        + forcing * (span - sine / k),
      curvature * cosine + third * sine / k + forcing * (1 - cosine),
      -curvature * k * sine + third * cosine + forcing * k * sine,
    ];
  };
  const basisC = propagate([0, 0, 1, 0], length);
  const basisD = propagate([0, 0, 0, 1], length);
  const particular = pointKn
    ? propagate([0, 0, 0, pointKn / ei], length - pointAtM)
    : propagate([0, 0, 0, 0], length, uniformKnPerM);
  const shear = state => ei * state[3] + p * state[1];
  const determinant = basisC[2] * shear(basisD) - basisD[2] * shear(basisC);
  const clampCurvature = (-particular[2] * shear(basisD)
    + basisD[2] * shear(particular)) / determinant;
  const clampThird = (-basisC[2] * shear(particular)
    + particular[2] * shear(basisC)) / determinant;
  return particular[0] + clampCurvature * basisC[0] + clampThird * basisD[0];
}

const binary = process.env.NATIVE_FEM_BINARY
  ?? fileURLToPath(new URL("../src-tauri/target/release/toetsbrug", import.meta.url));
const originalFetch = globalThis.fetch;
const requested = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "volume3dFiniteJ2FrameCoupled");
  requested.push(body.inputs.input);
  const answer = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", code => resolve({ code,
      output: Buffer.concat(stdout).toString(), error: Buffer.concat(stderr).toString() }));
    child.stdin.end(JSON.stringify(body));
  });
  if (answer.code !== 0) throw new Error(answer.error || answer.output);
  return new Response(answer.output, { status: 200 });
};

try {
  const results = [];
  for (const backend of ["frontalWave", "sparseGmres", "matrixFreeGmres"]) {
    const solved = await solveFrame3D({ ...model, volumeBackend: backend },
      project.activeLoadCaseId, "combined", "openaec-native-fem");
    assert.equal(requested.at(-1).volume.options.geometricFrames, true);
    assert.deepEqual([requested.at(-1).volume.mesh.tets.length,
      requested.at(-1).hexes.length, requested.at(-1).frames.length], [2, 1, 1]);
    assert.equal(solved.analysis, "combined");
    assert.ok(solved.forceBalance.ok && solved.equilibrium.equilibriumOk);
    assert.ok(solved.diagnostics.some(message => message.includes("geometrische tweede-orde-stijfheid")),
      `${backend}: gecombineerde raamwerkdiagnose`);
    assert.equal(solved.diagnostics.some(message => message.includes("GMRES bevestigt het algebraïsche evenwicht")),
      backend !== "frontalWave", `${backend}: GMRES-stabiliteitsduiding`);
    assert.equal(solved.volume3D.elements.length, 3);
    assert.equal(solved.memberForces.length, 1);
    const root = solved.displacements.find(node => node.nodeId === 9);
    const tip = solved.displacements.find(node => node.nodeId === 10);
    const relativeDeflection = Math.abs(tip.uz - root.uz);
    assert.ok(Math.abs(relativeDeflection - expectedSecondOrder) / expectedSecondOrder < 0.05,
      `${backend}: beam-column deflection ${relativeDeflection}, analytic ${expectedSecondOrder}`);
    assert.ok(relativeDeflection > 1.1 * expectedFirstOrder,
      `${backend}: second-order amplification is too small`);
    const momentStations = solved.diagrams.momentY[0].points;
    const midMoment = momentStations.find(point => Math.abs(point.t - 0.5) < 1e-12).value;
    const analyticMidMoment = lateralLoad / waveNumber
      * Math.abs(Math.sin(waveNumber * 0.5)
        - Math.tan(waveNumber * length) * Math.cos(waveNumber * 0.5));
    assert.ok(Math.abs(Math.abs(midMoment) - analyticMidMoment) / analyticMidMoment < 0.05,
      `${backend}: second-order field moment ${midMoment}, analytic ${analyticMidMoment}`);
    assert.ok(Math.abs(momentStations.at(-1).value) < 1e-5,
      `${backend}: free beam-column tip moment ${momentStations.at(-1).value}`);
    results.push({ backend, relativeDeflection });
  }
  for (const result of results.slice(1)) {
    assert.ok(Math.abs(result.relativeDeflection - results[0].relativeDeflection) < 1e-7,
      `${result.backend}: backend parity`);
  }
  const automaticSolved = await solveFrame3D({ ...model, volumeBackend: "automatic" },
    project.activeLoadCaseId, "combined", "openaec-native-fem");
  assert.equal(automaticSolved.volume3D.backendUsed, "sparseGmres");
  assert.ok(automaticSolved.diagnostics.some(message =>
    message.includes("GMRES bevestigt het algebraïsche evenwicht")));
  assert.equal(automaticSolved.buckling.status, "notApplicable");
  // Exercise a substantially amplified, still stable beam-column state.
  // The local J2 foundation can move, but subtracting the shared root
  // translation isolates the exact Euler-Bernoulli frame compliance.
  const highCompressionKn = 350;
  const highWaveNumber = Math.sqrt(highCompressionKn / flexuralRigidity);
  const highExpected = lateralLoad / highCompressionKn
    * (Math.tan(highWaveNumber * length) / highWaveNumber - length);
  const highModel = { ...model,
    loads: model.loads.map(load => ({ ...load, fx: -highCompressionKn })),
    volumeBackend: "frontalWave" };
  const highSolved = await solveFrame3D(highModel, project.activeLoadCaseId,
    "combined", "openaec-native-fem");
  const highRoot = highSolved.displacements.find(node => node.nodeId === 9);
  const highTip = highSolved.displacements.find(node => node.nodeId === 10);
  const highDeflection = Math.abs(highTip.uz - highRoot.uz);
  assert.ok(Math.abs(highDeflection - highExpected) / highExpected < 0.05,
    `amplified beam-column: ${highDeflection}, analytic ${highExpected}`);
  assert.ok(highDeflection > 1.1 * expectedFirstOrder);
  assert.ok(highSolved.forceBalance.ok && highSolved.equilibrium.equilibriumOk);
  // At 1,000 kN the frame is past the isolated weak-axis cantilever Euler
  // load. GMRES can still return an equilibrium on that unstable branch;
  // the positive-pivot frontal route must refuse to certify it as stable.
  const weakAxisCriticalKn = Math.PI ** 2 * material.eMpa * 1_000
    * Math.min(section.iyM4, section.izM4) / (4 * length ** 2);
  assert.ok(1_000 > weakAxisCriticalKn);
  await assert.rejects(() => solveFrame3D({ ...highModel,
    loads: highModel.loads.map(load => ({ ...load, fx: -1_000 })) },
  project.activeLoadCaseId, "combined", "openaec-native-fem"),
  /non-positive or singular frontal pivot/);
  // Regression: the first-order frame balances reference-arm moments even
  // though its attached J2 volumes use finite-strain kinematics. Deformed
  // arms would invent an absent P-Δ couple and reject this converged solve.
  const firstOrderMaterial = await solveFrame3D({ ...model, volumeBackend: "frontalWave" },
    project.activeLoadCaseId, "material", "openaec-native-fem");
  const materialRoot = firstOrderMaterial.displacements.find(node => node.nodeId === 9);
  const materialTip = firstOrderMaterial.displacements.find(node => node.nodeId === 10);
  const materialDeflection = Math.abs(materialTip.uz - materialRoot.uz);
  assert.ok(firstOrderMaterial.forceBalance.ok && firstOrderMaterial.equilibrium.equilibriumOk);
  assert.ok(firstOrderMaterial.diagnostics.some(message =>
    message.includes("zonder geometrische of materiële staafnietlineariteit")));
  assert.ok(Math.abs(materialDeflection - expectedFirstOrder) / expectedFirstOrder < 0.05,
    `first-order material frame ${materialDeflection}, cantilever reference ${expectedFirstOrder}`);
  assert.ok(results[0].relativeDeflection > 1.1 * materialDeflection,
    "geometric frame response must amplify the first-order material response");
  const pointLoad = { id: 2, beamId: 1, caseId: project.activeLoadCaseId,
    py: 0, pz: -lateralLoad, positionM: length / 2 };
  const pointModel = { ...model, loads: [], memberPointLoads: [pointLoad],
    volumeBackend: "frontalWave" };
  const pointSolved = await solveFrame3D(pointModel, project.activeLoadCaseId,
    "combined", "openaec-native-fem");
  const pointRoot = pointSolved.displacements.find(node => node.nodeId === 9);
  const pointTip = pointSolved.displacements.find(node => node.nodeId === 10);
  const pointDeflection = pointTip.uz - pointRoot.uz;
  const expectedPointDeflection = -lateralLoad * (length / 2) ** 2
    * (3 * length - length / 2) / (6 * flexuralRigidity);
  assert.ok(Math.abs(pointDeflection - expectedPointDeflection) < 1e-7,
    `coupled point load: ${pointDeflection}, analytic ${expectedPointDeflection}`);
  assert.ok(Math.abs(Math.abs(pointSolved.memberForces[0].myStartKnm)
    - lateralLoad * length / 2) < 1e-5);
  const pointQuarterMoment = pointSolved.diagrams.momentY[0].points
    .find(point => Math.abs(point.t - 0.25) < 1e-12).value;
  assert.ok(Math.abs(Math.abs(pointQuarterMoment) - lateralLoad * length / 4) < 1e-5,
    `coupled point load: quarter-span moment ${pointQuarterMoment}`);
  assert.ok(pointSolved.forceBalance.ok && pointSolved.equilibrium.equilibriumOk);
  const lineLoad = { id: 3, beamId: 1, caseId: project.activeLoadCaseId,
    qyStart: 0, qyEnd: 0, qzStart: -lateralLoad, qzEnd: -lateralLoad,
    startPositionM: 0, endPositionM: length };
  const lineSolved = await solveFrame3D({ ...model, loads: [], memberLoads: [lineLoad],
    volumeBackend: "frontalWave" }, project.activeLoadCaseId,
  "combined", "openaec-native-fem");
  const lineRoot = lineSolved.displacements.find(node => node.nodeId === 9);
  const lineTip = lineSolved.displacements.find(node => node.nodeId === 10);
  const expectedLineDeflection = -lateralLoad * length ** 4 / (8 * flexuralRigidity);
  assert.ok(Math.abs(lineTip.uz - lineRoot.uz - expectedLineDeflection) < 1e-7,
    `coupled line load: ${lineTip.uz - lineRoot.uz}, analytic ${expectedLineDeflection}`);
  assert.ok(Math.abs(Math.abs(lineSolved.memberForces[0].myStartKnm)
    - lateralLoad * length ** 2 / 2) < 1e-5);
  const lineQuarterMoment = lineSolved.diagrams.momentY[0].points
    .find(point => Math.abs(point.t - 0.25) < 1e-12).value;
  assert.ok(Math.abs(Math.abs(lineQuarterMoment)
    - lateralLoad * (length * 0.75) ** 2 / 2) < 1e-5,
  `coupled uniform load: quarter-span moment ${lineQuarterMoment}`);
  assert.ok(lineSolved.forceBalance.ok && lineSolved.equilibrium.equilibriumOk);
  const compressionOnly = await solveFrame3D({ ...model,
    loads: model.loads.map(load => ({ ...load, fz: 0 })), volumeBackend: "frontalWave" },
  project.activeLoadCaseId, "combined", "openaec-native-fem");
  const baseRoot = compressionOnly.displacements.find(node => node.nodeId === 9);
  const baseTip = compressionOnly.displacements.find(node => node.nodeId === 10);
  const baseRelativeUz = baseTip.uz - baseRoot.uz;
  // The same compressed model with geometricFrames disabled has the ordinary
  // Euler-Bernoulli response to loads applied inside the span. This catches
  // false P-Delta moments in the material-only equilibrium audit as well as
  // errors in equivalent nodal loads for point and distributed member loads.
  const materialCompressionOnly = await solveFrame3D({ ...model,
    loads: model.loads.map(load => ({ ...load, fz: 0 })),
    volumeBackend: "frontalWave" }, project.activeLoadCaseId,
  "material", "openaec-native-fem");
  const materialBaseRoot = materialCompressionOnly.displacements.find(node => node.nodeId === 9);
  const materialBaseTip = materialCompressionOnly.displacements.find(node => node.nodeId === 10);
  const materialBaseRelativeUz = materialBaseTip.uz - materialBaseRoot.uz;
  const loadComparisons = [];
  for (const [kind, loads, reference, firstOrder] of [
    ["point", { memberPointLoads: [pointLoad] }, beamColumnTipUnderMemberLoad(lateralLoad),
      -expectedPointDeflection],
    ["line", { memberLoads: [lineLoad] }, beamColumnTipUnderMemberLoad(0, lateralLoad),
      -expectedLineDeflection],
  ]) {
    const solved = await solveFrame3D({ ...model,
      loads: model.loads.map(load => ({ ...load, fz: 0 })), ...loads,
      volumeBackend: "frontalWave" }, project.activeLoadCaseId,
    "combined", "openaec-native-fem");
    const root = solved.displacements.find(node => node.nodeId === 9);
    const tip = solved.displacements.find(node => node.nodeId === 10);
    const incremental = Math.abs(tip.uz - root.uz - baseRelativeUz);
    assert.ok(Math.abs(incremental - reference) / reference < 0.05,
      `compressed ${kind} load: ${incremental}, beam-column reference ${reference}`);
    assert.ok(incremental > firstOrder * 1.05,
      `compressed ${kind} load must amplify the first-order deflection`);
    assert.ok(solved.forceBalance.ok && solved.equilibrium.equilibriumOk);
    const materialSolved = await solveFrame3D({ ...model,
      loads: model.loads.map(load => ({ ...load, fz: 0 })), ...loads,
      volumeBackend: "frontalWave" }, project.activeLoadCaseId,
    "material", "openaec-native-fem");
    const materialLoadedRoot = materialSolved.displacements.find(node => node.nodeId === 9);
    const materialLoadedTip = materialSolved.displacements.find(node => node.nodeId === 10);
    const materialIncremental = Math.abs(materialLoadedTip.uz - materialLoadedRoot.uz
      - materialBaseRelativeUz);
    assert.ok(Math.abs(materialIncremental - firstOrder) / firstOrder < 0.05,
      `first-order compressed ${kind} load: ${materialIncremental}, analytic ${firstOrder}`);
    assert.ok(materialSolved.forceBalance.ok && materialSolved.equilibrium.equilibriumOk);
    loadComparisons.push(`${kind} ${incremental.toExponential(6)}/${reference.toExponential(6)} m`);
  }
  const storedProject = deserializeProject(readFileSync(new URL(
    "../docs/verificatie/3d-volume/tet4-hex8-j2-raamwerk-punt-en-lijnlast.ifcfem2d",
    import.meta.url), "utf8"));
  assert.deepEqual([storedProject.model3d.volumes.length, storedProject.model3d.beams.length,
    storedProject.model3d.memberPointLoads.length, storedProject.model3d.memberLoads.length],
  [3, 1, 1, 1]);
  assert.equal(frame3DAnalysisForProject(storedProject.model3d, storedProject.analysetype), "combined");
  const storedSolved = await solveFrame3D(storedProject.model3d,
    storedProject.activeLoadCaseId, "combined", "openaec-native-fem");
  const storedRoot = storedSolved.displacements.find(node => node.nodeId === 9);
  const storedTip = storedSolved.displacements.find(node => node.nodeId === 10);
  const storedIncremental = Math.abs(storedTip.uz - storedRoot.uz - baseRelativeUz);
  const storedReference = beamColumnTipUnderMemberLoad(lateralLoad)
    + beamColumnTipUnderMemberLoad(0, lateralLoad);
  assert.ok(Math.abs(storedIncremental - storedReference) / storedReference < 0.05,
    `stored mixed-load model: ${storedIncremental}, independent ${storedReference}`);
  assert.ok(storedSolved.forceBalance.ok && storedSolved.equilibrium.equilibriumOk);
  const materialOnly = await solveFrame3D({ ...storedProject.model3d, loads: [] },
    storedProject.activeLoadCaseId, "material", "openaec-native-fem");
  assert.equal(materialOnly.analysis, "material");
  const materialMoment = materialOnly.diagrams.momentY[0].points;
  const materialShear = materialOnly.diagrams.shearZ[0].points;
  const station = (points, t) => points.find((point) => Math.abs(point.t - t) < 1e-12).value;
  const materialMember = materialOnly.memberForces[0];
  const qz = storedProject.model3d.memberLoads[0].qzStart;
  const pz = storedProject.model3d.memberPointLoads[0].pz;
  assert.ok(Math.abs(Math.abs(materialMember.myStartKnm)
    - (Math.abs(pz) * 0.5 + Math.abs(qz) / 2)) < 1e-6,
  "J2-volume met elastische staaf: onafhankelijk uitkragend wortelmoment");
  assert.ok(Math.abs(station(materialMoment, 0.25)
    - (materialMember.myStartKnm + materialMember.vzStartKn * 0.25 + qz * 0.25 ** 2 / 2)) < 1e-7,
  "J2-volume met elastische staaf: veldmoment vóór puntlast");
  assert.ok(Math.abs(station(materialShear, 0.75)
    - (materialMember.vzStartKn + qz * 0.75 + pz)) < 1e-7,
  "J2-volume met elastische staaf: dwarskrachtsprong na puntlast");
  assert.ok(Math.abs(station(materialMoment, 1)) < 1e-6
    && Math.abs(station(materialShear, 1)) < 1e-6,
  "J2-volume met elastische staaf: vrij einde heeft nul moment en dwarskracht");
  assert.ok(materialOnly.forceBalance.ok && materialOnly.equilibrium.equilibriumOk);
  const materialUnloaded = await solveFrame3D({ ...storedProject.model3d, loads: [],
    materialLoadPath: [1, 0] }, storedProject.activeLoadCaseId,
  "material", "openaec-native-fem");
  for (const key of ["momentY", "momentZ", "shearY", "shearZ", "axial", "torsion"]) {
    assert.ok(materialUnloaded.diagrams[key][0].maxAbsValue < 1e-6,
      `J2-volume ontlasting: ${key} bevat een fictief veldresultaat`);
  }
  loadComparisons.push(`stored ${storedIncremental.toExponential(6)}/${storedReference.toExponential(6)} m`);
  const unloaded = await solveFrame3D({ ...storedProject.model3d, loads: [],
    materialLoadPath: [1, 0] }, storedProject.activeLoadCaseId,
  "combined", "openaec-native-fem");
  assert.ok(unloaded.forceBalance.ok && unloaded.equilibrium.equilibriumOk);
  const unloadedActions = unloaded.memberForces[0];
  for (const key of ["nStartKn", "nEndKn", "vyStartKn", "vyEndKn",
    "vzStartKn", "vzEndKn", "torsionStartKnm", "torsionEndKnm",
    "myStartKnm", "myEndKnm", "mzStartKnm", "mzEndKnm"]) {
    assert.ok(Math.abs(unloadedActions[key]) < 1e-6,
      `zero final load must have zero frame ${key}, got ${unloadedActions[key]}`);
  }
  for (const key of ["momentY", "momentZ", "shearY", "shearZ", "axial", "torsion"]) {
    assert.ok(unloaded.diagrams[key][0].maxAbsValue < 1e-6,
      `zero final load must have zero second-order ${key} stations`);
  }
  const memberOnly = { ...storedProject.model3d, loads: [] };
  const halfDirect = await solveFrame3D({ ...memberOnly, materialLoadPath: [0.5] },
    storedProject.activeLoadCaseId, "combined", "openaec-native-fem");
  const halfAfterPeak = await solveFrame3D({ ...memberOnly, materialLoadPath: [1, 0.5] },
    storedProject.activeLoadCaseId, "combined", "openaec-native-fem");
  for (const key of ["nStartKn", "nEndKn", "vyStartKn", "vyEndKn",
    "vzStartKn", "vzEndKn", "torsionStartKnm", "torsionEndKnm",
    "myStartKnm", "myEndKnm", "mzStartKnm", "mzEndKnm"]) {
    assert.ok(Math.abs(halfAfterPeak.memberForces[0][key] - halfDirect.memberForces[0][key]) < 1e-6,
      `half-load history changed elastic frame ${key}`);
  }
  for (const key of ["momentY", "momentZ", "shearY", "shearZ", "axial", "torsion"]) {
    const historical = halfAfterPeak.diagrams[key][0].points;
    const direct = halfDirect.diagrams[key][0].points;
    assert.equal(historical.length, direct.length);
    historical.forEach((point, index) => {
      assert.ok(Math.abs(point.value - direct[index].value) < 1e-6,
        `half-load history changed second-order ${key} station ${index}`);
    });
  }
  await assert.rejects(() => solveFrame3D({ ...model, volumeMaterialKinematics: "smallStrain" },
    project.activeLoadCaseId, "combined", "openaec-native-fem"), /eindige-rek J2/);
  console.log(`Coupled Tet4/Hex8 + second-order frame: first-order ${materialDeflection.toExponential(6)} m, analytic ${expectedFirstOrder.toExponential(6)} m; beam-column ${results[0].relativeDeflection.toExponential(6)} m, analytic ${expectedSecondOrder.toExponential(6)} m; ${highCompressionKn} kN ${highDeflection.toExponential(6)}/${highExpected.toExponential(6)} m; compressed ${loadComparisons.join(", ")}, three backend routes OK`);
} finally {
  globalThis.fetch = originalFetch;
}

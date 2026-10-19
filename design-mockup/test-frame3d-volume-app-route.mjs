import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseFrame3DModel, withFrame3DSelfWeight } from "./src/components/frame3d/frame3dModel.ts";
import { solveFrame3D, solveFrame3DCombination } from "./src/components/frame3d/frame3dSolver.ts";
import { deserializeProject } from "./src/io/projectFile.ts";
import { eigenGewichtGeval } from "./src/lib/eigenGewicht.ts";

// Exercise the ordinary 3D model route all the way through /api/toetsing and
// the real Rust sidecar. The expected spring constants come from integrating
// the Tet4 / Hex8 shape-function gradients, independently of the solver output.
const binary = process.env.OPEN_FEM_NATIVE_MIXED3D_BIN
  ?? fileURLToPath(new URL("../src-tauri/target/debug/native-mixed3d", import.meta.url));
const invoke = input => new Promise((resolve, reject) => {
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [], errors = [];
  child.stdout.on("data", chunk => output.push(chunk));
  child.stderr.on("data", chunk => errors.push(chunk));
  child.on("error", reject);
  child.on("close", code => {
    const raw = Buffer.concat(output).toString();
    if (code === 0) resolve(JSON.parse(raw));
    else reject(new Error(`${input.backend} ${input.hexes?.length ?? 0} Hex8: `
      + (raw || Buffer.concat(errors).toString())));
  });
  child.stdin.end(JSON.stringify(input));
});

const eMpa = 1200, poisson = 0.2;
const lambda = eMpa * poisson / ((1 + poisson) * (1 - 2 * poisson));
const mu = eMpa / (2 * (1 + poisson));
const tetStiffnessKnPerM = 1000 * (lambda + 2 * mu) / 6;
const hexStiffnessKnPerM = 1000 * (lambda + 4 * mu) / 9;
const restraint = (nodeId, ux = true) => ({ nodeId, ux, uy: true, uz: true, rx: false, ry: false, rz: false });
const makeModel = kind => {
  const coordinates = kind === "tet4"
    ? [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]
    : [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
      [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const ids = [101, 205, 306, 407, 508, 609, 710, 811].slice(0, coordinates.length);
  return parseFrame3DModel({
    nodes: coordinates.map(([x, y, z], index) => ({ id: ids[index], x, y, z })),
    beams: [],
    volumes: [{ id: kind === "tet4" ? 21 : 22, kind, nodeIds: ids, eMpa, poisson }],
    supports: ids.map(id => restraint(id, id !== 205)),
    loads: [
      { id: 1, nodeId: 205, caseId: 1, fx: 10, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 },
      { id: 2, nodeId: 205, caseId: 2, fx: 4, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 },
    ],
  });
};
const makeCoupledModel = () => parseFrame3DModel({
  nodes: [
    { id: 101, x: 0, y: 0, z: 0 },
    { id: 205, x: 1, y: 0, z: 0 },
    { id: 306, x: 0, y: 1, z: 0 },
    { id: 407, x: 0, y: 0, z: 1 },
    { id: 509, x: 2, y: 0, z: 0 },
  ],
  beams: [{ id: 77, startNodeId: 205, endNodeId: 509, profileName: "200x100",
    material: "VRIJ:Teststaal E=200000 rho=7850 f=235" }],
  volumes: [{ id: 21, kind: "tet4", nodeIds: [101, 205, 306, 407], eMpa, poisson }],
  supports: [
    restraint(101),
    { ...restraint(205), uz: false, rx: true, ry: true, rz: true },
    restraint(306), restraint(407),
  ],
  loads: [{ id: 1, nodeId: 509, caseId: 1, fx: 0, fy: 0, fz: 10, mx: 0, my: 0, mz: 0 }],
});

const previousFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const request = JSON.parse(options.body);
  assert.equal(request.opdracht, "solve_native_fem");
  assert.equal(request.inputs.kind, "mixed3d");
  requests.push(request.inputs.input);
  const result = await invoke(request.inputs.input);
  return new Response(JSON.stringify({ kind: "mixed3d", result }), { status: 200 });
};

const close = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual}, verwacht ${expected}`);

try {
  for (const [kind, expectedStiffness] of [["tet4", tetStiffnessKnPerM], ["hex8", hexStiffnessKnPerM]]) {
    const model = makeModel(kind);
    const elementId = kind === "tet4" ? 21 : 22;
    const single = await solveFrame3D(model, 1, "linear", "openaec-native-fem");
    assert.equal(single.analysis, "linear");
    assert.equal(single.engine.id, "openaec-native-fem");
    const free = single.displacements.find(item => item.nodeId === 205);
    close(free.ux, 10 / expectedStiffness, 1e-10, `${kind} u_x`);
    close(free.uy, 0, 1e-12, `${kind} u_y`);
    close(free.uz, 0, 1e-12, `${kind} u_z`);
    close(single.reactions.reduce((sum, item) => sum + item.fx, 0), -10, 1e-7, `${kind} reactiesom`);
    assert.equal(single.volume3D.elements.length, 1);
    assert.equal(single.volume3D.elements[0].elementId, elementId);
    assert.equal(single.volume3D.elements[0].kind, kind);
    assert.ok(single.volume3D.relativeResidual < 1e-8);
    if (kind === "tet4") {
      close(single.volume3D.elements[0].stressMpa[0], (lambda + 2 * mu) * free.ux, 1e-7,
        "Tet4 σxx uit constante rek");
    } else {
      assert.equal(single.volume3D.elements[0].gaussStressMpa.length, 8);
    }

    const combination = await solveFrame3DCombination(model, new Map([[1, 1.5], [2, -0.5]]),
      "linear", "openaec-native-fem");
    const combinedForceKn = 1.5 * 10 - 0.5 * 4;
    close(combination.displacements.find(item => item.nodeId === 205).ux,
      combinedForceKn / expectedStiffness, 1e-10, `${kind} combinatiefactoren`);
    close(combination.reactions.reduce((sum, item) => sum + item.fx, 0),
      -combinedForceKn, 1e-7, `${kind} gecombineerde reactiesom`);
  }

  assert.equal(requests.length, 4);
  assert.deepEqual(requests[0].mesh.tets, [[0, 1, 2, 3]], "arbitraire knoop-id's worden naar compacte indices vertaald");
  assert.deepEqual(requests[2].hexes[0].nodes, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(requests[0].loadsKn[1][0], 10);
  assert.equal(requests[1].loadsKn[1][0], 13);

  // A Tet4 shear spring and a frame cantilever share node 205. Their
  // compliances add in series: F/(1000 μ V) + F L³/(3·1000 E Iy).
  // The rectangle has b=0.2 m, h=0.1 m, so Iy=b h³/12 exactly.
  const coupled = await solveFrame3D(makeCoupledModel(), 1, "linear", "openaec-native-fem");
  const beamE = 200_000, beamIyM4 = 0.2 * 0.1 ** 3 / 12, lengthM = 1;
  const solidUz = 10 / (1000 * mu / 6);
  const beamUz = 10 * lengthM ** 3 / (3 * 1000 * beamE * beamIyM4);
  const tipThetaY = -10 * lengthM ** 2 / (2 * 1000 * beamE * beamIyM4);
  close(coupled.displacements.find(item => item.nodeId === 205).uz, solidUz, 1e-10,
    "gedeelde Tet4/staafknoop z-verplaatsing");
  close(coupled.displacements.find(item => item.nodeId === 509).uz, solidUz + beamUz, 1e-10,
    "staande cantilever in serie met Tet4");
  close(coupled.displacements.find(item => item.nodeId === 509).ry, tipThetaY, 1e-10,
    "3D-staafrotatie op modelknoop 509");
  close(coupled.volume3D.elements[0].stressMpa[5], mu * solidUz, 1e-8,
    "Tet4-schuifspanning σzx");
  assert.equal(coupled.memberForces.length, 1);
  assert.equal(coupled.memberForces[0].memberId, 77);
  close(Math.abs(coupled.memberForces[0].vzStartKn), 10, 1e-7, "staafdwarskracht begin");
  close(Math.abs(coupled.memberForces[0].myStartKnm), 10 * lengthM, 1e-7, "staafmoment begin");
  close(coupled.memberForces[0].myEndKnm, 0, 1e-7, "staafmoment vrij einde");
  close(Math.abs(coupled.reactions.find(item => item.nodeId === 205).my), 10 * lengthM, 1e-7,
    "momentreactie bij gedeelde knoop");
  close(coupled.reactions.reduce((sum, item) => sum + item.fz, 0), -10, 1e-7,
    "gekoppeld globaal z-evenwicht");
  assert.equal(requests[4].frames.length, 1);
  assert.deepEqual(requests[4].frames[0].nodes, [1, 4]);
  close(requests[4].frames[0].iyM4, beamIyM4, 1e-15, "doorgifte rechthoek-Iy");

  const projectText = readFileSync(new URL(
    "../docs/verificatie/3d-volume/tet4-hex8-raamwerk.ifcfem2d", import.meta.url,
  ), "utf8");
  const project = deserializeProject(projectText);
  assert.equal(project.modelDimension, "3d");
  assert.equal(project.model3d.volumes.length, 3);
  assert.equal(project.model3d.beams.length, 1);
  const example = await solveFrame3D(project.model3d, project.activeLoadCaseId,
    "linear", "openaec-native-fem");
  assert.equal(requests[5].mesh.tets.length, 2);
  assert.equal(requests[5].hexes.length, 1);
  assert.equal(requests[5].frames.length, 1);
  assert.equal(example.volume3D.elements.length, 3);
  assert.deepEqual(example.volume3D.elements.map(item => [item.elementId, item.kind]),
    [[2, "tet4"], [3, "tet4"], [1, "hex8"]]);
  assert.equal(example.displacements.length, 10);
  assert.equal(example.reactions.length, 10);
  assert.equal(example.memberForces.length, 1);
  assert.ok(example.displacements.some(item => Math.hypot(item.ux, item.uy, item.uz) > 0));
  for (const element of example.volume3D.elements) {
    assert.ok(element.stressMpa.every(Number.isFinite));
    assert.ok(Number.isFinite(element.vonMisesMpa) && element.vonMisesMpa >= 0);
  }
  assert.ok(example.volume3D.relativeResidual < 1e-8);
  assert.ok(example.forceBalance.ok, "voorbeeld voldoet aan globaal kracht- en momentevenwicht");
  for (const component of example.forceBalance.imbalanceKn) close(component, 0, 1e-6, "krachtenevenwicht");
  for (const component of example.forceBalance.momentImbalanceKnm) close(component, 0, 1e-6, "momentevenwicht");

  // The ordinary 3D editor must preserve an axial-only member and dispatch it
  // to the native truss array, while the adjacent solid retains its Tet4 path.
  const tetWithTruss = parseFrame3DModel({ ...makeModel("tet4"), beams: [{ id: 88,
    startNodeId: 101, endNodeId: 205, axialOnly: true, profileName: "10x10",
    material: "VRIJ:Teststaal E=200000 rho=7850 f=235" }] });
  assert.equal(tetWithTruss.beams[0].axialOnly, true);
  const trussResult = await solveFrame3D(tetWithTruss, 1, "linear", "openaec-native-fem");
  const trussInput = requests.at(-1);
  assert.equal(trussInput.trusses.length, 1);
  assert.equal(trussInput.frames.length, 0);
  assert.deepEqual(trussInput.trusses[0].nodes, [0, 1]);
  const axialStiffness = 1000 * 200_000 * 0.01 ** 2;
  const trussUx = 10 / (tetStiffnessKnPerM + axialStiffness);
  close(trussResult.displacements.find(item => item.nodeId === 205).ux, trussUx, 1e-10,
    "Tet4 en axiale trekstaaf als onafhankelijke parallelveren");
  const trussForce = trussResult.memberForces.find(item => item.memberId === 88);
  close(trussForce.nStartKn, axialStiffness * trussUx, 1e-7, "trekstaaf normaalkracht begin");
  close(trussForce.nEndKn, axialStiffness * trussUx, 1e-7, "trekstaaf normaalkracht eind");
  close(trussForce.myStartKnm, 0, 1e-12, "trekstaaf buigmoment nul");
  assert.ok(trussResult.forceBalance.ok);
  const frameAndTruss = parseFrame3DModel({ ...makeCoupledModel(), beams: [
    ...makeCoupledModel().beams,
    { id: 88, startNodeId: 205, endNodeId: 509, axialOnly: true, profileName: "10x10",
      material: "VRIJ:Teststaal E=200000 rho=7850 f=235" },
  ] });
  const frameAndTrussResult = await solveFrame3D(frameAndTruss, 1, "linear", "openaec-native-fem");
  assert.equal(requests.at(-1).frames.length, 1);
  assert.equal(requests.at(-1).trusses.length, 1);
  assert.deepEqual(frameAndTrussResult.memberForces.map(item => item.memberId), [77, 88]);
  close(frameAndTrussResult.displacements.find(item => item.nodeId === 509).uz,
    coupled.displacements.find(item => item.nodeId === 509).uz, 1e-10,
    "gecombineerde raamstaaf en trekstaaf behouden onafhankelijke buiging");
  close(frameAndTrussResult.memberForces[1].nStartKn, 0, 1e-7,
    "axiale parallelstaaf draagt geen dwarse kracht");
  assert.throws(() => parseFrame3DModel({ ...tetWithTruss,
    beams: [{ ...tetWithTruss.beams[0], axialOnly: "yes" }] }), /axialOnly/);
  assert.throws(() => parseFrame3DModel({ ...tetWithTruss,
    beams: [{ ...tetWithTruss.beams[0], releases: { myStart: true } }] }), /trekstaaf|scharnier/i);

  const tet = makeModel("tet4");
  const freeTrussModel = { ...tetWithTruss, volumes: [],
    nodes: tetWithTruss.nodes.filter((node) => [101, 205].includes(node.id)),
    supports: tetWithTruss.supports.filter((support) => [101, 205].includes(support.nodeId)) };
  const freeTruss = await solveFrame3D(freeTrussModel, 1, "linear", "openaec-native-fem");
  close(freeTruss.displacements.find(item => item.nodeId === 205).ux,
    10 / axialStiffness, 1e-10, "volumevrij staafmodel: analytische EA/L");
  close(freeTruss.memberForces[0].nStartKn, 10, 1e-8, "volumevrije staafkracht");
  assert.equal(requests.at(-1).mesh.tets.length, 0);
  assert.equal(requests.at(-1).hexes.length, 0);
  assert.ok(freeTruss.forceBalance.ok);
  const freeMixedBars = parseFrame3DModel({ ...freeTrussModel,
    beams: [...freeTrussModel.beams, { id: 89, startNodeId: 101, endNodeId: 205,
      profileName: "10x10", material: "VRIJ:Teststaal E=200000 rho=7850 f=235" }],
    supports: [
      { ...freeTrussModel.supports.find((support) => support.nodeId === 101),
        rx: true, ry: true, rz: true },
      freeTrussModel.supports.find((support) => support.nodeId === 205),
    ],
    volumeBackend: "frontalWave" });
  const mixedBars = await solveFrame3D(freeMixedBars, 1, "linear", "openaec-native-fem");
  close(mixedBars.displacements.find(item => item.nodeId === 205).ux,
    10 / (2 * axialStiffness), 1e-10, "vrije trekstaaf en buigende raamstaaf als parallelveren");
  assert.equal(requests.at(-1).trusses.length, 1);
  assert.equal(requests.at(-1).frames.length, 1);
  assert.ok(mixedBars.forceBalance.ok);
  const callsBeforeRejections = requests.length;
  await assert.rejects(solveFrame3D(makeModel("hex8"), 1, "p-delta", "openaec-native-fem"), /alleen Tet4/i);
  await assert.rejects(solveFrame3D(tet, 1, "linear", "dedaliano"), /Rust-kern/i);
  await assert.rejects(solveFrame3D({ ...tet, plates: [{ id: 1, nodeIds: [101, 205, 306], thicknessM: 0.1 }] },
    1, "linear", "openaec-native-fem"), /plaat|volume/i);
  await assert.rejects(solveFrame3D({ ...tet, memberLoads: [{ id: 1, beamId: 1, caseId: 1,
    qyStart: 1, qyEnd: 1, qzStart: 0, qzEnd: 0, startPositionM: 0, endPositionM: 1 }] },
  1, "linear", "openaec-native-fem"), /staaf|eindknoop/i);
  assert.equal(requests.length, callsBeforeRejections, "ongeldige combinaties mogen de kern niet aanroepen");

  // Uniform body force: independent volume and V/n consistent nodal-load
  // reference. The solver receives a body-force record, never doubled nodal loads.
  for (const [kind, forceDensity, totalForce, expectedStiffness] of [
    ["tet4", 24, 4, tetStiffnessKnPerM], ["hex8", 8, 8, hexStiffnessKnPerM],
  ]) {
    const original = makeModel(kind);
    const volumeId = original.volumes[0].id;
    const bodyModel = parseFrame3DModel({ ...original, loads: [],
      volumeBodyLoads: [{ id: 31, volumeId, caseId: 3, forceKnPerM3: [forceDensity, 0, 0] }] });
    const body = await solveFrame3D(bodyModel, 3, "linear", "openaec-native-fem");
    const request = requests.at(-1);
    assert.ok(request.loadsKn.every(force => force.every(component => component === 0)));
    assert.deepEqual(kind === "tet4" ? request.tetBodyForces : request.hexBodyForces,
      [{ element: 0, forceKnPerM3: [forceDensity, 0, 0] }]);
    close(body.displacements.find(item => item.nodeId === 205).ux,
      totalForce / original.nodes.length / expectedStiffness, 1e-10, `${kind} volumekracht u_x`);
    close(body.reactions.reduce((sum, item) => sum + item.fx, 0), -totalForce, 1e-7,
      `${kind} volumekracht reactiesom`);
    assert.ok(body.forceBalance.ok, `${kind} volumekracht volledig kracht- en momentevenwicht`);
    const half = await solveFrame3DCombination(bodyModel, new Map([[3, 0.5]]), "linear", "openaec-native-fem");
    close(half.displacements.find(item => item.nodeId === 205).ux,
      totalForce / original.nodes.length / expectedStiffness / 2, 1e-10,
      `${kind} volumekracht met combinatiefactor`);
    assert.ok(half.forceBalance.ok);
  }
  for (const [kind, volumeM3] of [["tet4", 1 / 6], ["hex8", 1]]) {
    const base = makeModel(kind);
    const modelWithDensity = parseFrame3DModel({ ...base,
      volumes: [{ ...base.volumes[0], densityKgPerM3: 2500 }] });
    const weightModel = withFrame3DSelfWeight(modelWithDensity, 7);
    const weight = await solveFrame3D(weightModel, 7, "linear", "openaec-native-fem");
    const expectedWeightKn = 2500 * 9.81 / 1000 * volumeM3;
    close(weight.reactions.reduce((sum, item) => sum + item.fz, 0), expectedWeightKn, 1e-7,
      `${kind} automatisch eigen gewicht`);
    assert.ok(weight.forceBalance.ok);
    assert.equal(weightModel.volumeBodyLoads.length, 1);
    assert.equal(weightModel.volumeBodyLoads[0].caseId, 7);
    assert.equal(modelWithDensity.volumeBodyLoads?.length ?? 0, 0,
      "afgeleid eigen gewicht mag niet in het bewaarde projectmodel terechtkomen");
  }
  const gravityProject = deserializeProject(readFileSync(new URL(
    "../docs/verificatie/3d-volume/hex8-eigengewicht.ifcfem2d", import.meta.url,
  ), "utf8"));
  assert.equal(gravityProject.modelDimension, "3d");
  assert.equal(gravityProject.model3d.volumes[0].densityKgPerM3, 2500);
  const gravityCase = eigenGewichtGeval(gravityProject.loadCases, gravityProject.selfWeightEnabled);
  assert.equal(gravityCase?.id, 5);
  const gravityModel = withFrame3DSelfWeight(gravityProject.model3d, gravityCase.id);
  const gravityResult = await solveFrame3D(gravityModel, gravityCase.id, "linear", "openaec-native-fem");
  close(gravityResult.reactions.reduce((sum, item) => sum + item.fz, 0), 24.525, 1e-6,
    "opgeslagen Hex8-eigengewichtproject, verticale reactiesom");
  assert.ok(gravityResult.displacements.some((node) => node.uz < -1e-7));
  assert.ok(gravityResult.forceBalance.ok && gravityResult.volume3D.relativeResidual < 1e-8);
  assert.deepEqual(requests.at(-1).hexBodyForces,
    [{ element: 0, forceKnPerM3: [0, 0, -24.525] }]);

  const coupledLine = { ...makeCoupledModel(), loads: [], memberLoads: [{
    id: 91, beamId: 77, caseId: 4, qyStart: 0, qyEnd: 0,
    qzStart: -4, qzEnd: -4, startPositionM: 0, endPositionM: 1,
  }] };
  const lineResult = await solveFrame3D(coupledLine, 4, "linear", "openaec-native-fem");
  assert.deepEqual(requests.at(-1).frameMemberLoads, [{ element: 0,
    qyStartKnPerM: 0, qyEndKnPerM: 0, qzStartKnPerM: -4, qzEndKnPerM: -4,
    startPositionM: 0, endPositionM: 1 }]);
  assert.ok(requests.at(-1).loadsKn.every((force) => force.every((value) => value === 0)),
    "de lineaire app-route telt equivalente staaflasten niet dubbel in loadsKn");
  const lineSolidUz = -4 / (1000 * mu / 6);
  const lineBeamUz = -4 / (8 * 1000 * beamE * beamIyM4);
  close(lineResult.displacements.find(item => item.nodeId === 205).uz, lineSolidUz, 1e-10,
    "verdeelde staaflast: gedeelde Tet4-knoop");
  close(lineResult.displacements.find(item => item.nodeId === 509).uz, lineSolidUz + lineBeamUz, 1e-10,
    "verdeelde staaflast: analytische cantilever plus volumeveer");
  close(Math.abs(lineResult.memberForces[0].vzStartKn), 4, 1e-8,
    "verdeelde staaflast: dwarskracht bij vaste staafeind");
  close(Math.abs(lineResult.memberForces[0].myStartKnm), 2, 1e-8,
    "verdeelde staaflast: vast moment qL²/2");
  close(lineResult.memberForces[0].vzEndKn, 0, 1e-8,
    "verdeelde staaflast: werkelijk vrij einde na aftrek equivalente last");
  assert.ok(lineResult.forceBalance.ok);
  const halfLine = await solveFrame3DCombination(coupledLine, new Map([[4, 0.5]]),
    "linear", "openaec-native-fem");
  close(halfLine.displacements.find(item => item.nodeId === 509).uz,
    (lineSolidUz + lineBeamUz) / 2, 1e-10, "verdeelde staaflast met combinatiefactor");
  close(Math.abs(halfLine.memberForces[0].myStartKnm), 1, 1e-8,
    "verdeeld vast moment met combinatiefactor");
  assert.ok(halfLine.forceBalance.ok);
  const partialLoad = { ...coupledLine.memberLoads[0], id: 92,
    qzStart: -2, qzEnd: -5, startPositionM: 0.2, endPositionM: 0.8 };
  const partialLineResult = await solveFrame3D({ ...coupledLine, memberLoads: [partialLoad] },
    4, "linear", "openaec-native-fem");
  const a = partialLoad.startPositionM, b = partialLoad.endPositionM, span = b - a;
  const slope = (partialLoad.qzEnd - partialLoad.qzStart) / span;
  const intercept = partialLoad.qzStart - slope * a;
  const partialForce = (partialLoad.qzStart + partialLoad.qzEnd) * span / 2;
  const antiderivative = s => intercept * s ** 3
    + (3 * slope - intercept) * s ** 4 / 4 - slope * s ** 5 / 5;
  const partialBeamUz = (antiderivative(b) - antiderivative(a))
    / (6 * 1000 * beamE * beamIyM4);
  close(partialLineResult.displacements.find(item => item.nodeId === 509).uz,
    partialForce / (1000 * mu / 6) + partialBeamUz, 1e-10,
    "gedeeltelijke trapeziumlast: analytische puntlast-invloedslijn plus volumeveer");
  const partialMoment = intercept * (b ** 2 - a ** 2) / 2
    + slope * (b ** 3 - a ** 3) / 3;
  close(Math.abs(partialLineResult.memberForces[0].myStartKnm), Math.abs(partialMoment), 1e-8,
    "gedeeltelijke trapeziumlast: analytisch vast moment");
  assert.ok(partialLineResult.forceBalance.ok);

  const pointLoad = { id: 93, beamId: 77, caseId: 4, py: 0, pz: -4, positionM: 0.5 };
  const pointResult = await solveFrame3D({ ...coupledLine, memberLoads: [],
    memberPointLoads: [pointLoad] }, 4, "linear", "openaec-native-fem");
  assert.deepEqual(requests.at(-1).frameMemberPointLoads,
    [{ element: 0, pyKn: 0, pzKn: -4, positionM: 0.5 }]);
  assert.ok(requests.at(-1).momentsKnm.every((moment) => moment.every((value) => value === 0)),
    "de lineaire app-route telt equivalente staafmomenten niet dubbel in momentsKnm");
  const pointBeamUz = -4 * 0.5 ** 2 * (3 - 0.5) / (6 * 1000 * beamE * beamIyM4);
  close(pointResult.displacements.find(item => item.nodeId === 509).uz,
    lineSolidUz + pointBeamUz, 1e-10,
    "staafpuntlast: onafhankelijke cantileverformule plus volumeveer");
  close(Math.abs(pointResult.memberForces[0].vzStartKn), 4, 1e-8,
    "staafpuntlast: werkelijke worteldwarskracht");
  close(Math.abs(pointResult.memberForces[0].myStartKnm), 2, 1e-8,
    "staafpuntlast: werkelijk wortelmoment P·a");
  close(pointResult.memberForces[0].vzEndKn, 0, 1e-8,
    "staafpuntlast: werkelijk vrij einde na aftrek equivalente last");
  assert.ok(pointResult.forceBalance.ok);
  const halfPoint = await solveFrame3DCombination({ ...coupledLine, memberLoads: [],
    memberPointLoads: [pointLoad] }, new Map([[4, 0.5]]), "linear", "openaec-native-fem");
  close(halfPoint.displacements.find(item => item.nodeId === 509).uz,
    (lineSolidUz + pointBeamUz) / 2, 1e-10,
    "staafpuntlast met combinatiefactor");
  assert.ok(halfPoint.forceBalance.ok);

  const coupledWithDensity = parseFrame3DModel({ ...makeCoupledModel(), loads: [],
    volumes: [{ ...makeCoupledModel().volumes[0], densityKgPerM3: 2400 }] });
  const coupledGravity = withFrame3DSelfWeight(coupledWithDensity, 7);
  assert.equal(coupledGravity.volumeBodyLoads.length, 1);
  assert.equal(coupledGravity.memberLoads.length, 1);
  const coupledWeightResult = await solveFrame3D(coupledGravity, 7, "linear", "openaec-native-fem");
  const solidWeightKn = 2400 * 9.81 / 1000 / 6;
  const beamWeightKn = 7850 * (0.2 * 0.1) * 9.81 / 1000;
  close(coupledWeightResult.reactions.reduce((sum, item) => sum + item.fz, 0),
    solidWeightKn + beamWeightKn, 1e-6, "gemengd Tet4/staaf eigen gewicht");
  assert.ok(coupledWeightResult.forceBalance.ok);

  const mixedGravityProject = deserializeProject(readFileSync(new URL(
    "../docs/verificatie/3d-volume/tet4-hex8-raamwerk-eigengewicht.ifcfem2d", import.meta.url,
  ), "utf8"));
  const mixedGravityCase = eigenGewichtGeval(mixedGravityProject.loadCases,
    mixedGravityProject.selfWeightEnabled);
  assert.equal(mixedGravityCase?.id, 5);
  const mixedGravityModel = withFrame3DSelfWeight(mixedGravityProject.model3d, mixedGravityCase.id);
  assert.equal(mixedGravityModel.volumeBodyLoads.length, 3);
  assert.equal(mixedGravityModel.memberLoads.length, 1);
  const mixedGravityResult = await solveFrame3D(mixedGravityModel, mixedGravityCase.id,
    "linear", "openaec-native-fem");
  assert.equal(mixedGravityResult.volume3D.elements.length, 3);
  assert.equal(mixedGravityResult.memberForces.length, 1);
  assert.ok(mixedGravityResult.forceBalance.ok);
  assert.ok(mixedGravityResult.volume3D.relativeResidual < 1e-8);
  assert.ok(mixedGravityResult.displacements.some((node) => node.uz < -1e-7));
  const combinedGravity = await solveFrame3DCombination(mixedGravityModel,
    new Map([[mixedGravityCase.id, 1.2], [1, 1.5]]), "linear", "openaec-native-fem");
  assert.ok(combinedGravity.forceBalance.ok && combinedGravity.volume3D.relativeResidual < 1e-8);
  for (const [kind, faceIndex, traction, totalForce, stiffness] of [
    ["tet4", 1, 6, 3, tetStiffnessKnPerM],
    ["hex8", 2, 4, 4, hexStiffnessKnPerM],
  ]) {
    const base = makeModel(kind);
    const faceModel = parseFrame3DModel({ ...base, loads: [], volumeFaceLoads: [{
      id: 1, volumeId: kind === "tet4" ? 21 : 22, faceIndex, caseId: 8,
      tractionKnPerM2: [traction, 0, 0],
    }] });
    const faceResult = await solveFrame3D(faceModel, 8, "linear", "openaec-native-fem");
    close(faceResult.displacements.find((node) => node.nodeId === 205).ux, 1 / stiffness, 1e-10,
      `${kind} vlaktractie: analytische consistente knoopkracht`);
    close(faceResult.reactions.reduce((sum, node) => sum + node.fx, 0), -totalForce, 1e-7,
      `${kind} vlaktractie: reactiesom`);
    assert.ok(faceResult.forceBalance.ok);
    const request = requests.at(-1);
    assert.equal(request.loadsKn[1][0], 0, "vlaktractie wordt in de Rust-kern geassembleerd");
    if (kind === "tet4") assert.deepEqual(request.tetFaceTractions, [{
      element: 0, nodes: [0, 1, 3], tractionKnPerM2: [6, 0, 0],
    }]);
    else assert.deepEqual(request.hexFaceTractions, [{
      element: 0, faceNodes: [0, 1, 5, 4], tractionKnPerM2: [4, 0, 0],
    }]);
    const half = await solveFrame3DCombination(faceModel, new Map([[8, 0.5]]),
      "linear", "openaec-native-fem");
    close(half.displacements.find((node) => node.nodeId === 205).ux, 0.5 / stiffness, 1e-10,
      `${kind} vlaktractie met combinatiefactor`);
    assert.ok(half.forceBalance.ok);
  }
  const faceProject = deserializeProject(readFileSync(new URL(
    "../docs/verificatie/3d-volume/tet4-hex8-raamwerk-vlaktractie.ifcfem2d", import.meta.url,
  ), "utf8"));
  assert.equal(faceProject.model3d.volumeFaceLoads.length, 2);
  const faceProjectResult = await solveFrame3D(faceProject.model3d, faceProject.activeLoadCaseId,
    "linear", "openaec-native-fem");
  assert.equal(faceProjectResult.volume3D.elements.length, 3);
  assert.equal(faceProjectResult.memberForces.length, 1);
  assert.ok(faceProjectResult.forceBalance.ok && faceProjectResult.volume3D.relativeResidual < 1e-8);
  assert.equal(requests.at(-1).hexFaceTractions.length, 1);
  assert.equal(requests.at(-1).tetFaceTractions.length, 1);
  for (const backend of ["dense", "sparseDirect", "sparsePcg", "matrixFreePcg", "frontalWave"]) {
    const configured = parseFrame3DModel({ ...makeModel("hex8"), volumeBackend: backend, volumeThreads: 2 });
    const result = await solveFrame3D(configured, 1, "linear", "openaec-native-fem");
    assert.equal(requests.at(-1).backend, backend, `${backend} bereikt de Rust-kern`);
    assert.equal(requests.at(-1).threads, 2);
    assert.equal(result.volume3D.backendUsed, backend, `${backend} is daadwerkelijk gebruikt`);
    close(result.displacements.find((node) => node.nodeId === 205).ux,
      10 / hexStiffnessKnPerM, 1e-8, `${backend} analytische Hex8-referentie`);
    assert.ok(result.forceBalance.ok);
  }
  const loadedFrame = parseFrame3DModel({ ...makeCoupledModel(), loads: [],
    memberLoads: [{ id: 81, beamId: 77, caseId: 1, qyStart: 0, qyEnd: 0,
      qzStart: -2, qzEnd: -2, startPositionM: 0, endPositionM: 1 }],
    memberPointLoads: [{ id: 82, beamId: 77, caseId: 1, py: 0, pz: -4, positionM: 0.5 }] });
  const loaded = await solveFrame3D(loadedFrame, 1, "linear", "openaec-native-fem");
  const my = loaded.diagrams.momentY[0].points;
  const vz = loaded.diagrams.shearZ[0].points;
  const member = loaded.memberForces[0];
  const at = (points, t) => points.find((point) => Math.abs(point.t - t) < 1e-12).value;
  close(at(my, 0.25), member.myStartKnm + member.vzStartKn * 0.25 - 0.25 ** 2,
    1e-8, "gekoppelde staaf: parabolisch veldmoment vóór puntlast");
  close(at(my, 0.75), member.myStartKnm + member.vzStartKn * 0.75 - 0.75 ** 2 - 4 * 0.25,
    1e-8, "gekoppelde staaf: veldmoment na puntlast");
  close(at(vz, 0.25), member.vzStartKn - 2 * 0.25, 1e-8,
    "gekoppelde staaf: dwarskracht vóór puntlast");
  close(at(vz, 0.75), member.vzStartKn - 2 * 0.75 - 4, 1e-8,
    "gekoppelde staaf: dwarskrachtsprong na puntlast");
  close(at(my, 1), 0, 1e-7, "vrije staafpunt: analytisch nul eindmoment");
  close(at(vz, 1), 0, 1e-7, "vrije staafpunt: analytisch nul einddwarskracht");
  const halfLoaded = await solveFrame3DCombination(loadedFrame, new Map([[1, 0.5]]),
    "linear", "openaec-native-fem");
  close(at(halfLoaded.diagrams.momentY[0].points, 0.75), at(my, 0.75) / 2,
    1e-8, "gekoppelde staaf: halve last schaalt veldmoment");
  assert.ok(loaded.forceBalance.ok && halfLoaded.forceBalance.ok);
  console.log("Gewone 3D-modelroute: Tet4/Hex8, gekoppelde 3D-staaf en opgeslagen voorbeeldproject, onafhankelijke referenties en evenwicht geslaagd.");
} finally {
  globalThis.fetch = previousFetch;
}

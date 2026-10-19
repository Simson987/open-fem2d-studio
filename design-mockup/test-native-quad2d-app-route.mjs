import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildMesh, solveAllCases, getScheefstandRichtingen, SCHEEFSTAND_ID_OFFSET } from "./src/components/fem/solver/engine.ts";
import { berekenPlaatMeshSignatuur } from "./src/components/fem/femTypes.ts";
import { solveAllCasesNativeMembrane2D as solveAllCasesNativeQuad2D,
  solveAllCombinationsNativeMembrane2D as solveAllCombinationsNativeQuad2D }
  from "./src/components/fem/solver/nativeMembraneRoute.ts";
import { combineResults, computeEnvelope } from "./src/components/fem/solver/combinations.ts";
import { resolveSolver } from "./src/core/solver/SolverRegistry.ts";

const binary = fileURLToPath(new URL("../src-tauri/target/debug/native-quad2d", import.meta.url));
const mixedBinary = fileURLToPath(new URL("../src-tauri/target/debug/native-mixed2d", import.meta.url));
const meshBinary = fileURLToPath(new URL("../src-tauri/target/debug/native-quad-mesh", import.meta.url));
const invoke = (executable, input) => new Promise((resolve, reject) => {
  const child = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"] });
  const out = [], err = [];
  child.stdout.on("data", chunk => out.push(chunk));
  child.stderr.on("data", chunk => err.push(chunk));
  child.on("error", reject);
  child.on("close", code => code === 0
    ? resolve(JSON.parse(Buffer.concat(out).toString()))
    : reject(new Error(`${Buffer.concat(out).toString()} ${Buffer.concat(err).toString()}`)));
  child.stdin.end(JSON.stringify(input));
});
const originalFetch = globalThis.fetch;
let calls = 0;
let nativeMeshCalls = 0;
let corruptNextQuadResult = null;
let corruptNextMixedResult = null;
let corruptNextNativeMesh = null;
const nativeInputs = [];
const nativeMeshInputs = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  const kind = body.inputs.kind;
  if (kind === "mixed2d") {
    calls++;
    nativeInputs.push(body.inputs.input);
    const result = await invoke(mixedBinary, body.inputs.input);
    if (corruptNextMixedResult) {
      const corruption = corruptNextMixedResult;
      corruptNextMixedResult = null;
      if (corruption === "null-node-record") result.nodes[0] = null;
      else if (corruption === "null-triangle-record") result.triangles[0] = null;
      else if (corruption === "null-triangle-stress") result.triangles[0].stressMpa = null;
      else if (corruption === "null-quad-record") result.quads[0] = null;
      else if (corruption === "null-gauss-point") result.quads[0].gaussPoints[0] = null;
      else if (corruption === "null-stress-vector") result.quads[0].gaussPoints[0].stressMpa = null;
      else if (corruption === "negative-residual") result.relativeResidual = -1;
    }
    return new Response(JSON.stringify({ kind, result }), { status: 200 });
  }
  if (kind === "quadMesh") {
    nativeMeshCalls++;
    nativeMeshInputs.push(body.inputs.input);
    const result = await invoke(meshBinary, body.inputs.input);
    if (corruptNextNativeMesh) {
      const corruption = corruptNextNativeMesh;
      corruptNextNativeMesh = null;
      if (corruption === "null-node-record") result.nodes[0] = null;
      else if (corruption === "null-quad-record") result.quads[0] = null;
      else if (corruption === "wrong-material") result.quads[0].materialId += 1;
      else if (corruption === "wrong-thickness") result.quads[0].thicknessM *= 2;
    }
    return new Response(JSON.stringify({ kind, result }), { status: 200 });
  }
  assert.equal(kind, "quad2d");
  calls++;
  nativeInputs.push(body.inputs.input);
  const result = await invoke(binary, body.inputs.input);
  if (corruptNextQuadResult) {
    const corruption = corruptNextQuadResult;
    corruptNextQuadResult = null;
    if (corruption === "null-node-record") result.nodes[0] = null;
    else if (corruption === "null-element-record") result.quads[0] = null;
    else if (corruption === "null-gauss-point") result.quads[0].gaussPoints[0] = null;
    else if (corruption === "null-stress-vector") result.quads[0].gaussPoints[0].stressMpa = null;
    else if (corruption === "duplicate-node-id") result.nodes[1].nodeId = result.nodes[0].nodeId;
  }
  return new Response(JSON.stringify({ kind, result }), { status: 200 });
};
const close = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${label}: Rust ${actual}, bestaande solver ${expected}, grens ${tolerance}`,
);
try {
  const request = { schemaVersion: 1, dimension: "2d", analysis: "linear", elementFamilies: ["plate"] };
  assert.equal(resolveSolver("openaec-native-fem", request).id, "openaec-native-fem");
  assert.equal(resolveSolver("automatic", request).id, "open-fem-2d");
  assert.throws(() => resolveSolver("openaec-native-fem", { ...request, elementFamilies: ["frame", "plate"] }));
  assert.equal(resolveSolver("openaec-native-fem", { ...request, analysis: "material-nonlinear" }).id,
    "openaec-native-fem");
  const input = {
    nodes: [
      { id: 1, x: 0, z: 0 }, { id: 2, x: 1000, z: 0 },
      { id: 3, x: 0, z: 1000 }, { id: 4, x: 1000, z: 1000 },
    ],
    beams: [],
    plates: [{ id: 9, nodeIds: [1, 2, 4, 3], thickness: 20,
      E: 210000, nu: 0.3, rho: 7850, meshSize: 500, meshType: "vierhoeken" }],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 3, type: "xRoller" }],
    cases: [{ id: 1, name: "G" }, { id: 2, name: "Q" }, { id: 3, name: "leeg" }],
    loads: [], pointLoads: [],
    edgeLoads: [
      { plateId: 9, edge: "right", p: 10, dir: "x", caseId: 1 },
      { plateId: 9, edge: "right", p: 4, dir: "x", caseId: 2 },
    ],
  };
  const built = buildMesh(input, caseId => caseId === 1 ? 1 : 0);
  assert.equal(built.plateInfo[0].region.elementIds.length, 4);
  const native = await solveAllCasesNativeQuad2D(input);
  for (const element of native.get(1).plateElements[0].elements) {
    assert.equal(element.threeLayerSamples.length, 4);
    assert.equal(new Set(element.threeLayerSamples.map(sample => sample.id)).size, 4);
    for (const sample of element.threeLayerSamples) {
      assert.ok(Number.isFinite(sample.positionM[0]) && Number.isFinite(sample.positionM[1]));
      assert.ok([sample.nx, sample.ny, sample.nxy].every(Number.isFinite));
    }
  }
  const reference = solveAllCases(input).perCase;
  assert.equal(calls, 2);
  assert.equal(nativeMeshCalls, 2, "de rechthoekige appmesh moet per belastingsgeval door de Rust-vierkantsmesher komen");
  assert.equal(native.has(3), false);
  for (const caseId of [1, 2]) {
    const actual = native.get(caseId), expected = reference.get(caseId);
    assert.ok(actual && expected);
    close(actual.maxDisplacement, expected.maxDisplacement, 1e-5, `geval ${caseId} grootste verplaatsing`);
    for (const [id, node] of actual.displacements) {
      const other = expected.displacements.get(id);
      assert.ok(other);
      close(node.ux, other.ux, 1e-5, `geval ${caseId} knoop ${id} ux`);
      close(node.uz, other.uz, 1e-5, `geval ${caseId} knoop ${id} uz`);
    }
    for (const [id, reaction] of actual.reactions) {
      const other = expected.reactions.get(id);
      assert.ok(other);
      close(reaction.fx, other.fx, 1e-2, `geval ${caseId} knoop ${id} Rx`);
      close(reaction.fz, other.fz, 1e-2, `geval ${caseId} knoop ${id} Rz`);
    }
    const plate = actual.plateElements[0], otherPlate = expected.plateElements[0];
    assert.equal(plate.plateId, 9);
    assert.deepEqual(plate.expectedElementIds, otherPlate.expectedElementIds);
    for (const element of plate.elements) {
      const other = otherPlate.elements.find(item => item.elementId === element.elementId);
      assert.ok(other);
      for (const key of ["sigmaX", "sigmaY", "tauXY", "nx", "ny", "nxy"])
        close(element[key], other[key], 1e-3, `geval ${caseId} element ${element.elementId} ${key}`);
    }
  }
  const perforatedInput = {
    ...input,
    cases: [{ id: 1, name: "G" }],
    edgeLoads: [{ plateId: 9, edge: "right", p: 10, dir: "x", caseId: 1 }],
    plates: [{ ...input.plates[0], openingen: [{ id: 4, punten: [
      { x: 250, z: 250 }, { x: 750, z: 250 }, { x: 750, z: 750 }, { x: 250, z: 750 },
    ] }] }],
  };
  const perforatedBuilt = buildMesh(perforatedInput, () => 1);
  assert.equal(perforatedBuilt.plateInfo[0].region.elementIds.length, 8);
  const meshCallsBeforeOpening = nativeMeshCalls;
  const perforatedNative = await solveAllCasesNativeQuad2D(perforatedInput);
  const perforatedReference = solveAllCases(perforatedInput).perCase;
  assert.equal(nativeMeshCalls, meshCallsBeforeOpening + 1,
    "rechthoekige openingen moeten via het Rust-Q4-rooster lopen");
  assert.deepEqual(nativeMeshInputs.at(-1).openings,
    [{ xM: 0.25, yM: 0.25, widthM: 0.5, heightM: 0.5 }]);
  const perforatedActual = perforatedNative.get(1), perforatedExpected = perforatedReference.get(1);
  assert.ok(perforatedActual && perforatedExpected);
  assert.equal(perforatedActual.plateElements[0].elements.length, 8);
  close(perforatedActual.maxDisplacement, perforatedExpected.maxDisplacement, 1e-5,
    "openingsmesh grootste verplaatsing");
  for (const [id, displacement] of perforatedActual.displacements) {
    const expectedDisplacement = perforatedExpected.displacements.get(id);
    assert.ok(expectedDisplacement);
    close(displacement.ux, expectedDisplacement.ux, 1e-5, `openingenmesh knoop ${id} ux`);
    close(displacement.uz, expectedDisplacement.uz, 1e-5, `openingenmesh knoop ${id} uz`);
  }
  for (const [id, reaction] of perforatedActual.reactions) {
    const expectedReaction = perforatedExpected.reactions.get(id);
    assert.ok(expectedReaction);
    close(reaction.fx, expectedReaction.fx, 1e-2, `openingenmesh knoop ${id} Rx`);
    close(reaction.fz, expectedReaction.fz, 1e-2, `openingenmesh knoop ${id} Rz`);
  }
  const lCorners = [
    { x: 0, z: 0 }, { x: 2000, z: 0 }, { x: 2000, z: 1000 },
    { x: 1000, z: 1000 }, { x: 1000, z: 2000 }, { x: 0, z: 2000 },
  ];
  const lPoints = [
    { x: 0, z: 0 }, { x: 1000, z: 0 }, { x: 2000, z: 0 }, { x: 2000, z: 1000 },
    { x: 1000, z: 1000 }, { x: 1000, z: 2000 }, { x: 0, z: 2000 }, { x: 0, z: 1000 },
  ];
  const lCache = {
    signature: berekenPlaatMeshSignatuur(lCorners, 1000, { openingen: [], meshType: "vierhoeken" }),
    points: lPoints,
    triangles: [],
    quads: [[0, 1, 4, 7], [1, 2, 3, 4], [7, 4, 5, 6]],
    meshSoort: "vierhoeken",
    edgeNodeIndices: [[0, 1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7, 0]],
  };
  const cachedPolygonInput = {
    nodes: lCorners.map((point, index) => ({ id: index + 1, x: point.x, z: point.z })),
    beams: [],
    plates: [{ id: 15, nodeIds: [1, 2, 3, 4, 5, 6], thickness: 25,
      E: 30000, nu: 0.2, rho: 2500, meshSize: 1000, meshType: "vierhoeken", meshCache: lCache }],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 6, type: "xRoller" }],
    cases: [{ id: 1, name: "L-plaat" }], loads: [],
    pointLoads: [{ nodeId: 3, fx: 1000, caseId: 1 }], edgeLoads: [],
  };
  const cachedPolygonMeshCalls = nativeMeshCalls;
  const cachedPolygonRequestStart = nativeInputs.length;
  const cachedPolygonNative = await solveAllCasesNativeQuad2D(cachedPolygonInput);
  const cachedPolygonReference = solveAllCases(cachedPolygonInput).perCase;
  assert.equal(nativeMeshCalls, cachedPolygonMeshCalls,
    "een opgeslagen polygoonmesh moet behouden blijven en niet stil opnieuw worden gemesht");
  const cachedPolygonRequest = nativeInputs[cachedPolygonRequestStart];
  assert.equal(cachedPolygonRequest.quads.length, 3);
  const cachedPolygonActual = cachedPolygonNative.get(1), cachedPolygonExpected = cachedPolygonReference.get(1);
  assert.ok(cachedPolygonActual && cachedPolygonExpected);
  assert.equal(cachedPolygonActual.plateElements[0].plateId, 15);
  assert.equal(cachedPolygonActual.plateElements[0].elements.length, 3);
  close(cachedPolygonActual.maxDisplacement, cachedPolygonExpected.maxDisplacement, 1e-5,
    "opgeslagen L-polygoonmesh grootste verplaatsing");
  for (const [id, displacement] of cachedPolygonActual.displacements) {
    const expectedDisplacement = cachedPolygonExpected.displacements.get(id);
    assert.ok(expectedDisplacement);
    close(displacement.ux, expectedDisplacement.ux, 1e-5, `L-polygoon knoop ${id} ux`);
    close(displacement.uz, expectedDisplacement.uz, 1e-5, `L-polygoon knoop ${id} uz`);
  }
  for (const [id, reaction] of cachedPolygonActual.reactions) {
    const expectedReaction = cachedPolygonExpected.reactions.get(id);
    assert.ok(expectedReaction);
    close(reaction.fx, expectedReaction.fx, 1e-2, `L-polygoon knoop ${id} Rx`);
    close(reaction.fz, expectedReaction.fz, 1e-2, `L-polygoon knoop ${id} Rz`);
  }
  const cachedActualElements = cachedPolygonActual.plateElements[0].elements;
  const cachedExpectedElements = cachedPolygonExpected.plateElements[0].elements;
  for (const element of cachedActualElements) {
    const expectedElement = cachedExpectedElements.find(item => item.elementId === element.elementId);
    assert.ok(expectedElement);
    for (const key of ["sigmaX", "sigmaY", "tauXY", "nx", "ny", "nxy"])
      close(element[key], expectedElement[key], 1e-3, `L-polygoon element ${element.elementId} ${key}`);
  }
  const cachedPolygonFnlInput = { ...cachedPolygonInput, axialMaterialLoadPath: [1, 0, 0.5],
    plates: [{ ...cachedPolygonInput.plates[0],
      modulusCurve: [{ strain: 0.000001, eMpa: 15000 }] }],
  };
  const cachedPolygonFnl = await solveAllCasesNativeQuad2D(cachedPolygonFnlInput, "material");
  const cachedPolygonFnlRequest = nativeInputs.at(-1);
  const cachedPolygonFnlResult = cachedPolygonFnl.get(1);
  assert.deepEqual(cachedPolygonFnlRequest.loadPath, [1, 0, 0.5]);
  assert.equal(cachedPolygonFnlRequest.quads.length, 3,
    "de FNL-oplossing moet de opgeslagen Q4-elementen behouden");
  assert.equal(cachedPolygonFnlRequest.modulusCurves.length, 1,
    "de E-curve moet aan de Rust-kern worden doorgegeven voor de opgeslagen mesh");
  assert.ok(cachedPolygonFnlResult?.plateElements[0].elements.some(element => element.effectiveEMpa < 30000),
    "de opgeslagen polygon-Q4 moet de secans-E-verzwakking in Rust-resultaten tonen");
  const mixedCache = { ...lCache,
    triangles: [[0, 1, 4], [0, 4, 7], [7, 4, 5], [7, 5, 6]],
    quads: [[1, 2, 3, 4]],
    meshSoort: "gemengd",
  };
  const mixedPolygonInput = { ...cachedPolygonInput,
    plates: [{ ...cachedPolygonInput.plates[0], meshCache: mixedCache }],
  };
  const mixedPolygonMeshCalls = nativeMeshCalls;
  const mixedPolygonNative = await solveAllCasesNativeQuad2D(mixedPolygonInput);
  const mixedPolygonReference = solveAllCases(mixedPolygonInput).perCase;
  assert.equal(nativeMeshCalls, mixedPolygonMeshCalls,
    "het gemengde polygonmesh moet met zijn gedeelde app-knopen naar Rust worden gestuurd");
  const mixedPolygonRequest = nativeInputs.at(-1);
  assert.equal(mixedPolygonRequest.triangles.length, 4);
  assert.equal(mixedPolygonRequest.quads.length, 1);
  const mixedPolygonActual = mixedPolygonNative.get(1), mixedPolygonExpected = mixedPolygonReference.get(1);
  assert.ok(mixedPolygonActual && mixedPolygonExpected);
  assert.equal(mixedPolygonActual.plateElements[0].elements.length, 5);
  close(mixedPolygonActual.maxDisplacement, mixedPolygonExpected.maxDisplacement, 1e-5,
    "gemengde polygonmesh grootste verplaatsing");
  for (const [id, displacement] of mixedPolygonActual.displacements) {
    const expectedDisplacement = mixedPolygonExpected.displacements.get(id);
    assert.ok(expectedDisplacement);
    close(displacement.ux, expectedDisplacement.ux, 1e-5, `gemengd polygoon knoop ${id} ux`);
    close(displacement.uz, expectedDisplacement.uz, 1e-5, `gemengd polygoon knoop ${id} uz`);
  }
  for (const [id, reaction] of mixedPolygonActual.reactions) {
    const expectedReaction = mixedPolygonExpected.reactions.get(id);
    assert.ok(expectedReaction);
    close(reaction.fx, expectedReaction.fx, 1e-2, `gemengd polygoon knoop ${id} Rx`);
    close(reaction.fz, expectedReaction.fz, 1e-2, `gemengd polygoon knoop ${id} Rz`);
  }
  const mixedActualElements = mixedPolygonActual.plateElements[0].elements;
  const mixedExpectedElements = mixedPolygonExpected.plateElements[0].elements;
  for (const element of mixedActualElements) {
    const expectedElement = mixedExpectedElements.find(item => item.elementId === element.elementId);
    assert.ok(expectedElement);
    for (const key of ["sigmaX", "sigmaY", "tauXY", "nx", "ny", "nxy"])
      close(element[key], expectedElement[key], 1e-3, `gemengd element ${element.elementId} ${key}`);
  }
  const mixedFnlInput = { ...mixedPolygonInput,
    plates: [{ ...mixedPolygonInput.plates[0], modulusCurve: [{ strain: 0.000001, eMpa: 15000 }] }],
  };
  const mixedFnl = await solveAllCasesNativeQuad2D({ ...mixedFnlInput, axialMaterialLoadPath: [1, 0, 0.5] }, "material");
  const mixedFnlRequest = nativeInputs.at(-1);
  assert.equal(mixedFnlRequest.analysis, "material");
  assert.deepEqual(mixedFnlRequest.loadPath, [1, 0, 0.5]);
  assert.equal(mixedFnlRequest.modulusCurves.length, 1);
  const mixedFnlActual = mixedFnl.get(1);
  assert.ok(mixedFnlActual && Number.isFinite(mixedFnlActual.maxDisplacement));
  close([...mixedFnlActual.reactions.values()].reduce((sum, reaction) => sum + reaction.fx, 0), -500, 1e-2,
    "gemengde FNL-reacties sluiten op de halve eindlast na ontlasten en herbelasten");
  close([...mixedFnlActual.reactions.values()].reduce((sum, reaction) => sum + reaction.fz, 0), 0, 1e-2,
    "gemengde FNL-reacties sluiten verticaal");
  const mixedFnlElements = mixedFnlActual.plateElements[0].elements;
  assert.ok(mixedFnlElements.some(element => element.effectiveEMpa < 30000),
    "gemengde CST/Q4-FNL moet secans-E-historie in beide elementfamilies teruggeven");
  for (const [corruption, message] of [
    ["null-node-record", /geldige knoop-, CST- of Q4-records/],
    ["null-triangle-record", /geldige knoop-, CST- of Q4-records/],
    ["null-triangle-stress", /ongeldige spannings- of materiaaltoestanden/],
    ["null-quad-record", /geldige knoop-, CST- of Q4-records/],
    ["null-gauss-point", /ongeldig Rust-resultaat op de vier Gauss-punten/],
    ["null-stress-vector", /ongeldig Rust-resultaat op de vier Gauss-punten/],
    ["negative-residual", /geen voldoende klein residu/],
  ]) {
    corruptNextMixedResult = corruption;
    await assert.rejects(solveAllCasesNativeQuad2D({ ...mixedPolygonInput,
      cases: [{ id: 1, name: "G" }],
    }), message);
  }
  const adjacentPlatesInput = {
    nodes: [
      { id: 1, x: 0, z: 0 }, { id: 2, x: 1000, z: 0 }, { id: 3, x: 2000, z: 0 },
      { id: 4, x: 0, z: 1000 }, { id: 5, x: 1000, z: 1000 }, { id: 6, x: 2000, z: 1000 },
    ],
    beams: [],
    plates: [
      { id: 11, nodeIds: [1, 2, 5, 4], thickness: 20, E: 210000, nu: 0.3, rho: 7850,
        meshSize: 500, meshType: "vierhoeken" },
      { id: 12, nodeIds: [2, 3, 6, 5], thickness: 20, E: 210000, nu: 0.3, rho: 7850,
        meshSize: 500, meshType: "vierhoeken" },
    ],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 4, type: "xRoller" }],
    cases: [{ id: 1, name: "G" }], loads: [], pointLoads: [],
    edgeLoads: [{ plateId: 12, edge: "right", p: 10, dir: "x", caseId: 1 }],
  };
  const sharedMeshCallsBefore = nativeMeshCalls;
  const adjacentNative = await solveAllCasesNativeQuad2D(adjacentPlatesInput);
  const adjacentReference = solveAllCases(adjacentPlatesInput).perCase;
  assert.equal(nativeMeshCalls, sharedMeshCallsBefore + 2,
    "iedere rechthoekige plaat moet met de Rust-mesher worden opgebouwd");
  const adjacentActual = adjacentNative.get(1), adjacentExpected = adjacentReference.get(1);
  assert.ok(adjacentActual && adjacentExpected);
  assert.equal(adjacentActual.plateElements.length, 2);
  assert.deepEqual(adjacentActual.plateElements.map(plate => plate.plateId), [11, 12]);
  assert.ok(adjacentActual.plateElements.every(plate => plate.elements.length === 4));
  close(adjacentActual.maxDisplacement, adjacentExpected.maxDisplacement, 1e-5,
    "aangrenzende platen grootste verplaatsing");
  for (const [id, displacement] of adjacentActual.displacements) {
    const expectedDisplacement = adjacentExpected.displacements.get(id);
    assert.ok(expectedDisplacement);
    close(displacement.ux, expectedDisplacement.ux, 1e-5, `aangrenzende platen knoop ${id} ux`);
    close(displacement.uz, expectedDisplacement.uz, 1e-5, `aangrenzende platen knoop ${id} uz`);
  }
  for (const [id, reaction] of adjacentActual.reactions) {
    const expectedReaction = adjacentExpected.reactions.get(id);
    assert.ok(expectedReaction);
    close(reaction.fx, expectedReaction.fx, 1e-2, `aangrenzende platen knoop ${id} Rx`);
    close(reaction.fz, expectedReaction.fz, 1e-2, `aangrenzende platen knoop ${id} Rz`);
  }
  const varyingMaterialInput = { ...adjacentPlatesInput,
    axialMaterialLoadPath: [1, 0, 0.5],
    plates: [
      { ...adjacentPlatesInput.plates[0], modulusCurve: [{ strain: 0.000001, eMpa: 150000 }] },
      { ...adjacentPlatesInput.plates[1], E: 105000, thickness: 30,
        modulusCurve: [{ strain: 0.000001, eMpa: 75000 }] },
    ],
  };
  const varyingMaterialNative = await solveAllCasesNativeQuad2D(varyingMaterialInput, "material");
  const varyingMaterialRequest = nativeInputs.at(-1);
  assert.deepEqual(varyingMaterialRequest.loadPath, [1, 0, 0.5],
    "een heterogeen Q4-model moet hetzelfde belasten/ontlasten/herbelastenpad gebruiken");
  assert.equal(varyingMaterialRequest.modulusCurves.length, 2,
    "beide aangrenzende platen moeten hun eigen E-curve aan Rust doorgeven");
  assert.notEqual(varyingMaterialRequest.quads[0].materialId,
    varyingMaterialRequest.quads.at(-1).materialId,
    "verschillende E en dikte moeten verschillende materiaalidentiteiten behouden");
  const varyingMaterialResult = varyingMaterialNative.get(1);
  assert.ok(varyingMaterialResult && varyingMaterialResult.plateElements.length === 2);
  const leftE = varyingMaterialResult.plateElements[0].elements.map(element => element.effectiveEMpa);
  const rightE = varyingMaterialResult.plateElements[1].elements.map(element => element.effectiveEMpa);
  assert.ok(leftE.every(value => Math.abs(value - 150000) < 1e-3),
    "de linker plaat moet zijn eigen secans-E behouden");
  assert.ok(rightE.every(value => Math.abs(value - 75000) < 1e-3),
    "de rechter plaat moet zijn eigen secans-E behouden");
  assert.ok(varyingMaterialResult.maxDisplacement > 0,
    "het heterogene Q4-FNL-model moet een niet-nul vervormingsoplossing geven");
  const largeInput = { ...input,
    plates: [{ ...input.plates[0], meshSize: 25 }],
  };
  assert.throws(() => buildMesh(largeInput, caseId => caseId === 1 ? 1 : 0), /Model te groot/,
    "de bestaande dense solver houdt zijn schaalgrens");
  const largeBuilt = buildMesh(largeInput, caseId => caseId === 1 ? 1 : 0,
    { solverCapacity: "native" });
  assert.ok(largeBuilt.mesh.nodes.size * 3 > 4000,
    "native routeproef moet de oude 4.000-DOF-grens echt overschrijden");
  const largeNative = await solveAllCasesNativeQuad2D(largeInput);
  assert.ok(largeNative.get(1)?.maxDisplacement > 0,
    "Rust sparse Quad4 moet het grotere app-model oplossen");
  const orthotropicInput = { ...input,
    plates: [{ ...input.plates[0], materiaal: "C24", E: undefined, nu: undefined, rho: undefined,
      hoofdrichting: 23 }],
  };
  const orthotropicRequestStart = nativeInputs.length;
  const orthotropicNative = await solveAllCasesNativeQuad2D(orthotropicInput);
  const orthotropicReference = solveAllCases(orthotropicInput).perCase;
  const orthotropicRequest = nativeInputs[orthotropicRequestStart];
  assert.equal(orthotropicRequest.orthotropicMaterials.length, 1);
  close(orthotropicRequest.orthotropicMaterials[0].angleRad, 23 * Math.PI / 180, 1e-12,
    "de hoofdrichting van hout gaat in radialen naar de kern");
  const orthotropicActual = orthotropicNative.get(1), orthotropicExpected = orthotropicReference.get(1);
  assert.ok(orthotropicActual && orthotropicExpected);
  for (const [id, displacement] of orthotropicActual.displacements) {
    const expectedDisplacement = orthotropicExpected.displacements.get(id);
    assert.ok(expectedDisplacement);
    close(displacement.ux, expectedDisplacement.ux, 1e-5, `orthotroop C24 knoop ${id} ux`);
    close(displacement.uz, expectedDisplacement.uz, 1e-5, `orthotroop C24 knoop ${id} uz`);
  }
  for (const [id, reaction] of orthotropicActual.reactions) {
    const expectedReaction = orthotropicExpected.reactions.get(id);
    assert.ok(expectedReaction);
    close(reaction.fx, expectedReaction.fx, 1e-2, `orthotroop C24 knoop ${id} Rx`);
    close(reaction.fz, expectedReaction.fz, 1e-2, `orthotroop C24 knoop ${id} Rz`);
  }
  const combination = { id: 10, name: "ULS", type: "uls", formula: "test", factors: new Map([[1, 1.35], [2, 1.5]]) };
  const actual = combineResults(combination, native);
  const expected = combineResults(combination, reference);
  close(actual.maxDisplacement, expected.maxDisplacement, 1e-5, "combinatieverplaatsing");
  assert.equal(actual.plateElements[0].elements.length, expected.plateElements[0].elements.length);
  const imperfectionInput = { ...input,
    plates: [{ ...input.plates[0], nonlinearLaw: { kind: "steelBilinear", yieldMpa: 0.1, hardeningRatio: 0.05 } }],
    scheefstand: { phi: 0.005, richting: 1 },
    edgeLoads: [],
    pointLoads: [{ nodeId: 2, fz: -10000, caseId: 1 }],
  };
  const imperfectionReference = solveAllCases(imperfectionInput).perCase;
  const imperfectionNative = await solveAllCasesNativeQuad2D(imperfectionInput);
  assert.deepEqual(getScheefstandRichtingen(imperfectionNative),
    { primair: 1, offset: SCHEEFSTAND_ID_OFFSET });
  for (const caseId of [1, 1 + SCHEEFSTAND_ID_OFFSET]) {
    const actualCase = imperfectionNative.get(caseId), expectedCase = imperfectionReference.get(caseId);
    assert.ok(actualCase && expectedCase, `scheefstandgeval ${caseId} ontbreekt`);
    for (const [id, displacement] of actualCase.displacements) {
      const expectedDisplacement = expectedCase.displacements.get(id);
      assert.ok(expectedDisplacement);
      close(displacement.ux, expectedDisplacement.ux, 1e-5, `scheefstand ${caseId} knoop ${id} ux`);
      close(displacement.uz, expectedDisplacement.uz, 1e-5, `scheefstand ${caseId} knoop ${id} uz`);
    }
    for (const [id, reaction] of actualCase.reactions) {
      const expectedReaction = expectedCase.reactions.get(id);
      assert.ok(expectedReaction);
      close(reaction.fx, expectedReaction.fx, 1e-2, `scheefstand ${caseId} knoop ${id} Rx`);
      close(reaction.fz, expectedReaction.fz, 1e-2, `scheefstand ${caseId} knoop ${id} Rz`);
    }
  }
  const primaryHorizontalLoad = nativeInputs.at(-2).loads.reduce((sum, load) => sum + load.fx, 0);
  const oppositeHorizontalLoad = nativeInputs.at(-1).loads.reduce((sum, load) => sum + load.fx, 0);
  assert.ok(primaryHorizontalLoad > 0 && oppositeHorizontalLoad < 0,
    "de Q4 scheefstand moet H = φV in beide richtingen als horizontale last meesturen");
  const imperfectionCombos = await solveAllCombinationsNativeQuad2D(imperfectionInput,
    [
      { ...combination, id: 11, scheefstandRichting: 1 },
      { ...combination, id: 12, scheefstandRichting: -1 },
    ], "material");
  assert.ok(imperfectionCombos.get(11) && imperfectionCombos.get(12));
  assert.notEqual(imperfectionCombos.get(11).displacements.get(2).ux,
    imperfectionCombos.get(12).displacements.get(2).ux,
    "niet-lineaire Q4-combinaties moeten hun eigen scheefstandrichting gebruiken");
  const springInput = { ...input,
    supports: [...input.supports, { nodeId: 2, type: "xSpring", k: 4200 }] };
  const springNative = await solveAllCasesNativeQuad2D(springInput);
  const springReference = solveAllCases(springInput).perCase;
  const springRequest = nativeInputs.at(-1);
  const nativeSpringNodeId = springRequest.nodes.find(node => node.x === 1 && node.y === 0)?.id;
  const mappedSpring = springRequest.supports.find(support => support.nodeId === nativeSpringNodeId);
  assert.ok(nativeSpringNodeId);
  assert.equal(mappedSpring.kxKnPerM, 4200,
    "N/m from the app mesh must become kN/m in the Rust membrane request");
  const springActual = springNative.get(1), springExpected = springReference.get(1);
  assert.ok(springActual && springExpected);
  for (const [id, result] of springActual.displacements) {
    const other = springExpected.displacements.get(id);
    assert.ok(other);
    close(result.ux, other.ux, 1e-5, `veerx model knoop ${id} ux`);
    close(result.uz, other.uz, 1e-5, `veerx model knoop ${id} uz`);
  }
  assert.ok(springActual.reactions.get(2)?.fx < 0,
    "the native result must expose the x-spring's resisting reaction");
  close(springActual.reactions.get(2).fx, springExpected.reactions.get(2).fx, 1e-2,
    "veerx reactiekracht");
  const nonlinearInput = { ...input,
    plates: [{ ...input.plates[0], nonlinearLaw: { kind: "steelBilinear", yieldMpa: 0.1, hardeningRatio: 0.05 } }] };
  const nonlinearCases = await solveAllCasesNativeQuad2D(nonlinearInput, "material");
  const direct = await solveAllCombinationsNativeQuad2D(nonlinearInput, [combination], "material");
  const directResult = direct.get(combination.id);
  assert.ok(directResult);
  const superposed = combineResults(combination, nonlinearCases);
  assert.ok(Math.abs(directResult.maxDisplacement - superposed.maxDisplacement) > 1e-5,
    "een FNL-combinatie mag geen superpositie van afzonderlijke gevallen zijn");
  const equivalentInput = { ...nonlinearInput,
    cases: [{ id: 4, name: "volledige combinatie" }],
    edgeLoads: [{ plateId: 9, edge: "right", p: 19.5, dir: "x", caseId: 4 }] };
  const equivalent = (await solveAllCasesNativeQuad2D(equivalentInput, "material")).get(4);
  close(directResult.maxDisplacement, equivalent.maxDisplacement, 1e-6,
    "FNL-combinatie is directe oplossing van de volledige lastvector");
  const envelope = computeEnvelope([combination], nonlinearCases, direct);
  close(envelope.maxDisplacement, directResult.maxDisplacement, 1e-9, "FNL-omhullende gebruikt directe uitkomst");
  const curveInput = { ...input,
    plates: [{ ...input.plates[0], modulusCurve: [{ strain: 0.000001, eMpa: 100000 }] }] };
  const curve = (await solveAllCasesNativeQuad2D(curveInput, "material")).get(1);
  assert.ok(curve.maxDisplacement > native.get(1).maxDisplacement,
    "een afnemende E-curve moet de vervorming vergroten");
  assert.ok(curve.plateElements[0].elements.some(element => element.effectiveEMpa < 210000),
    "de verlaagde E moet in de plaatresultaten zichtbaar zijn");
  const historyInput = { ...curveInput, axialMaterialLoadPath: [1, 0, 0.5] };
  await solveAllCombinationsNativeQuad2D(historyInput, [combination], "material");
  assert.deepEqual(nativeInputs.at(-1).loadPath, [1, 0, 0.5],
    "Q4 FNL moet het ingestelde belasten-ontlasten-herbelastenpad aan de Rust-kern doorgeven");
  const concreteInput = { ...input,
    plates: [{ ...input.plates[0], materiaal: "C30/37", E: undefined, nu: undefined, rho: undefined,
      nonlinearLaw: { kind: "concreteCracking", tensileMpa: 0.1, residualRatio: 0.05 } }] };
  const concrete = (await solveAllCasesNativeQuad2D(concreteInput, "material")).get(1);
  assert.ok(concrete.plateElements[0].elements.some(element => element.tensileDamage > 0),
    "betonscheuren moeten als Gauss-punt-schade in de plaatresultaten staan");
  const combinedConcrete = await solveAllCombinationsNativeQuad2D(concreteInput, [combination], "combined");
  const combinedConcreteResult = combinedConcrete.get(combination.id);
  assert.ok(combinedConcreteResult?.maxDisplacement > 0,
    "gecombineerde GNL+FNL met betonscheuren moet een directe plaatuitkomst geven");
  assert.ok(combinedConcreteResult.plateElements[0].elements.some(element => element.tensileDamage > 0),
    "de app-route moet betonschade uit gecombineerde GNL+FNL doorgeven");
  assert.equal(nativeInputs.at(-1).analysis, "combined",
    "de betonplaatwet moet als gecombineerde analyse in Rust aankomen");
  const combined = await solveAllCombinationsNativeQuad2D({ ...curveInput,
    axialMaterialLoadPath: [1, 0, 0.5] }, [combination], "combined");
  assert.ok(combined.get(combination.id)?.maxDisplacement > 0,
    "gecombineerde GNL+FNL-analyse geeft een directe plaatuitkomst");
  assert.deepEqual(nativeInputs.at(-1).loadPath, [1, 0, 0.5],
    "gecombineerde Q4 GNL+FNL moet hetzelfde belastingspad gebruiken");
  await assert.rejects(solveAllCasesNativeQuad2D({ ...concreteInput,
    plates: [{ ...concreteInput.plates[0], nonlinearLaw: nonlinearInput.plates[0].nonlinearLaw }] }, "material"),
  /past niet bij het gekozen materiaal/);
  await assert.rejects(solveAllCasesNativeQuad2D(input, "material"), /minstens één plaat/);
  await assert.rejects(solveAllCasesNativeQuad2D({ ...curveInput,
    plates: [{ ...curveInput.plates[0], nonlinearLaw: nonlinearInput.plates[0].nonlinearLaw }] }, "material"),
  /of een E-curve, niet beide/);
  await assert.rejects(solveAllCasesNativeQuad2D({ ...input, beams: [{}] }), /uitsluitend platen/);
  for (const [corruption, message] of [
    ["null-node-record", /ongeldige of ontbrekende knoop-\/elementrecords/],
    ["null-element-record", /mist geldige knoop- of elementrecords/],
    ["null-gauss-point", /ongeldig Rust-resultaat op de vier Gauss-punten/],
    ["null-stress-vector", /ongeldig Rust-resultaat op de vier Gauss-punten/],
    ["duplicate-node-id", /volledige, unieke knoop- en elementidentiteit/],
  ]) {
    corruptNextQuadResult = corruption;
    await assert.rejects(solveAllCasesNativeQuad2D({ ...input, cases: [{ id: 1, name: "G" }] }), message);
  }
  const referenceForMeshFallback = solveAllCases(input).perCase.get(1);
  for (const corruption of ["null-node-record", "null-quad-record", "wrong-material", "wrong-thickness"]) {
    corruptNextNativeMesh = corruption;
    const fallback = await solveAllCasesNativeQuad2D({ ...input, cases: [{ id: 1, name: "G" }] });
    close(fallback.get(1).maxDisplacement, referenceForMeshFallback.maxDisplacement, 1e-5,
      `ongeldige Rust-mesh ${corruption} moet de appmesh behouden`);
  }
  console.log("Rust 2D-plaat app-route: Q4/CST/gemengde lineaire en FNL-pariteit plus ongeldige responsrecords slagen.");
} finally {
  globalThis.fetch = originalFetch;
}

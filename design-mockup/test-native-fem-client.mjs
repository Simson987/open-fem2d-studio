import assert from "node:assert/strict";
import { solveNativeFem, solveNativeQuad2D, solveNativeHybridPlate, solveNativeGeometricShell,
  solveNativePlateBending, solveNativePrestressedBeam, solveNativeCrackWidth } from "./src/lib/nativeFemClient.ts";
import { Mesh } from "./src/core/fem/Mesh.ts";

const originalFetch = globalThis.fetch;
let request;
globalThis.fetch = async (url, options) => {
  request = { url, options };
  return new Response(JSON.stringify({ kind: "squareMesh", result: { nodes: [1, 2] } }), {
    status: 200, headers: { "content-type": "application/json" },
  });
};
try {
  const input = { originX: 0, originY: 0, widthM: 1, heightM: 1,
    cellSizeM: 1, materialId: 1, thicknessM: 0.1 };
  const result = await solveNativeFem("squareMesh", input);
  assert.deepEqual(result, { nodes: [1, 2] });
  assert.equal(request.url, "/api/toetsing");
  assert.deepEqual(JSON.parse(request.options.body), {
    opdracht: "solve_native_fem", inputs: { kind: "squareMesh", input },
  });
  const prestressedInput = {
    spanM: 10,
    section: { areaM2: 0.5, inertiaM4: 0.02, topFibreM: 0.3, bottomFibreM: 0.3, eMpa: 30000 },
    tendon: { kind: "parabolic", endEccentricityM: 0, midEccentricityM: 0.2 },
    initialForceKn: 1000, lossFraction: 0.2, serviceUniformDownwardKnPerM: 16,
    stationsXM: [2.5, 7.5],
  };
  const stage = { forceKn: 800, endEccentricityM: 0, midEccentricityM: 0.2,
    equivalentUniformUpwardKnPerM: 12.8, endMomentKnm: 0, endVerticalForceMagnitudeKn: 64,
    externalLeftReactionKn: 80, externalRightReactionKn: 80, leftReactionKn: 16, rightReactionKn: 16,
    prestressMidspanMomentKnm: -160, externalMidspanMomentKnm: 200,
    endStress: { topMpa: -1.6, bottomMpa: -1.6 }, midspanStress: { topMpa: 0, bottomMpa: 0 },
    axialShorteningM: -0.0002666666667, prestressCamberM: -0.0001111111111,
    externalMidspanDeflectionM: 0.0003472222222, totalMidspanDeflectionM: 0.0002361111111,
    stations: [0, 2.5, 7.5, 10].map((xM) => ({
      xM, tendonEccentricityM: xM === 2.5 || xM === 7.5 ? 0.15 : 0, effectiveEMpa: 30000,
      externalMomentKnm: xM === 2.5 || xM === 7.5 ? 150 : 0,
      prestressMomentKnm: xM === 2.5 || xM === 7.5 ? -120 : 0,
      totalMomentKnm: xM === 2.5 || xM === 7.5 ? 30 : 0,
      shearKn: xM === 0 ? 16 : xM === 2.5 ? 8 : xM === 7.5 ? -8 : -16,
      fibreStress: { topMpa: -1.6, bottomMpa: -1.6 },
      prestressDeflectionM: xM === 0 || xM === 10 ? 0 : -0.0019791666667,
      externalDeflectionM: xM === 0 || xM === 10 ? 0 : 0.0024739583333,
      totalDeflectionM: xM === 0 || xM === 10 ? 0 : 0.0004947916666,
    })) };
  stage.criticalStations = [stage.stations[0], stage.stations.at(-1)];
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ kind: "prestressedBeam", result: { transfer: stage, service: stage } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  const prestressed = await solveNativePrestressedBeam(prestressedInput);
  assert.equal(prestressed.service.equivalentUniformUpwardKnPerM, 12.8);
  assert.equal(prestressed.service.stations.length, 4);
  const prestressedRequest = JSON.parse(request.options.body);
  assert.equal(prestressedRequest.inputs.kind, "prestressedBeam");
  assert.deepEqual(prestressedRequest.inputs.input, prestressedInput);
  const crackInput = { sigmaSMpa: 120, widthMm: 300, heightMm: 600,
    effectiveDepthMm: 540, neutralAxisMm: 120, effectiveBondedPrestressingAreaMm2: 588,
    coverToLongitudinalSteelMm: 60, barOrTendonDiameterMm: 15.2, spacingMm: 100,
    fCkMpa: 40, fCtEffMpa: 3.5, eCmMpa: 35220, kT: 0.4, k1: 1.6, k2: 0.5,
    wMaxMm: 0.2 };
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ kind: "crackWidth", result: {
      effectiveTensionHeightMm: 150, effectiveConcreteAreaMm2: 45000,
      effectiveReinforcementRatio: 0.0130666667, strainDifference: 0.00036,
      tensionStiffeningFloorGoverns: true, maximumCrackSpacingMm: 273.6,
      crackSpacingEquation: "7.11 NB-bovengrens", crackWidthMm: 0.098496,
      allowableCrackWidthMm: 0.2, utilization: 0.49248, passes: true,
    } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const crack = await solveNativeCrackWidth(crackInput);
  assert.equal(crack.crackWidthMm, 0.098496);
  const crackRequest = JSON.parse(request.options.body);
  assert.equal(crackRequest.inputs.kind, "crackWidth");
  assert.deepEqual(crackRequest.inputs.input, crackInput);
  const mesh = new Mesh();
  mesh.materials.set(1, { id: 1, name: "patch", E: 1e9, nu: 0, rho: 0, color: "" });
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) mesh.addNode(x, y);
  mesh.addQuadElement([1, 2, 4, 3], 1, 0.1);
  mesh.nodes.get(1).constraints.x = true;
  mesh.nodes.get(1).constraints.y = true;
  mesh.nodes.get(3).constraints.x = true;
  mesh.nodes.get(2).loads.fx = 50_000;
  mesh.nodes.get(4).loads.fx = 50_000;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ kind: "quad2d", result: {
      nodes: [{ nodeId: 2, uxM: 0.001 }], quads: [], iterations: 1, relativeResidual: 0,
    } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const quad = await solveNativeQuad2D(mesh);
  assert.equal(quad.nodes[0].uxM, 0.001);
  const wrapped = JSON.parse(request.options.body);
  assert.equal(wrapped.inputs.kind, "quad2d");
  assert.equal(wrapped.inputs.input.materials[0].eMpa, 1000);
  assert.deepEqual(wrapped.inputs.input.loads.map(load => load.fx), [50, 50]);
  const dkt = new Mesh();
  dkt.materials.set(1, { id: 1, name: "orthotropic", E: 11e9, nu: 0.25, rho: 0, color: "",
    orthotroop: { E1: 11e9, E2: 370e6, nu12: 0.25, G12: 690e6, hoek: 23 * Math.PI / 180 } });
  for (const [x, y] of [[0, 0], [1, 0], [0, 1]]) dkt.addNode(x, y);
  dkt.addTriangleElement([1, 2, 3], 1, 0.02);
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ kind: "plateBending", result: {
      nodes: [], elements: [], relativeResidual: 0,
    } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const dktCurve = [{ materialId: 1, points: [{ strain: 0, eMpa: 11_000 },
    { strain: 1e-12, eMpa: 5_500 }] }];
  await solveNativePlateBending(dkt, dktCurve, [1, 0, 1]);
  const dktRequest = JSON.parse(request.options.body).inputs;
  assert.equal(dktRequest.kind, "plateBending");
  assert.equal(dktRequest.input.orthotropicMaterials[0].angleRad, 23 * Math.PI / 180);
  assert.deepEqual(dktRequest.input.modulusCurves, dktCurve);
  assert.deepEqual(dktRequest.input.loadPath, [1, 0, 1]);
  await solveNativePlateBending(dkt, [], [], 'frontalWave', 64);
  const frontalDktRequest = JSON.parse(request.options.body).inputs;
  assert.equal(frontalDktRequest.kind, 'plateBending');
  assert.equal(frontalDktRequest.input.linearBackend, 'frontalWave');
  assert.equal(frontalDktRequest.input.frontalMaxFrontDofs, 64);
  assert.throws(() => solveNativePlateBending(dkt, dktCurve, [], 'frontalWave'),
    /alleen lineaire elasticiteit/);
  const bending = new Mesh();
  bending.materials.set(1, { id: 1, name: "concrete", E: 30e9, nu: 0.2, rho: 0, color: "" });
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) bending.addNode(x, y);
  bending.addQuadElement([1, 2, 4, 3], 1, 0.2);
  const steel = { limitState: "service", fckMpa: 20, fctmMpa: 2.2, gammaC: 1.5,
    fydMpa: 435, fywdMpa: 435, esMpa: 200000, coverMm: 30, barDiameterMm: 12,
    topXMm2PerM: 1000, topYMm2PerM: 1000,
    bottomXMm2PerM: 1000, bottomYMm2PerM: 1000 };
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ kind: "hybridPlate", result: {
      nodes: [], elements: [], iterations: 1, relativeResidual: 0,
    } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  await solveNativeHybridPlate(bending, -10, [], [], steel,
    [{ quadId: 1, nodalPressureKnM2: [0, -1, -1, 0] }]);
  const hybridRequest = JSON.parse(request.options.body);
  assert.equal(hybridRequest.inputs.kind, "hybridPlate");
  assert.equal(hybridRequest.inputs.input.pressureKnM2, -10);
  assert.equal(hybridRequest.inputs.input.reinforcement.limitState, "service");
  assert.deepEqual(hybridRequest.inputs.input.quadPressures,
    [{ quadId: 1, nodalPressureKnM2: [0, -1, -1, 0] }]);
  await solveNativeHybridPlate(bending, -10, [], [], steel, [], [], 'frontalWave', 64);
  const frontalHybridRequest = JSON.parse(request.options.body).inputs;
  assert.equal(frontalHybridRequest.kind, 'hybridPlate');
  assert.equal(frontalHybridRequest.input.linearBackend, 'frontalWave');
  assert.equal(frontalHybridRequest.input.frontalMaxFrontDofs, 64);
  assert.throws(() => solveNativeHybridPlate(bending, 0, dktCurve, [], undefined, [], [], 'frontalWave'),
    /alleen lineaire elasticiteit/);
  const shell = new Mesh();
  shell.materials.set(1, { id: 1, name: "steel", E: 30e9, nu: 0, rho: 0, color: "" });
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) shell.addNode(x, y);
  shell.addQuadElement([1, 2, 4, 3], 1, 0.1);
  shell.nodes.get(1).constraints.y = true;
  shell.nodes.get(3).constraints.y = true;
  shell.nodes.get(2).constraints.y = true;
  shell.nodes.get(4).constraints.y = true;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ kind: "geometricShell", result: {
      nodes: [], elements: [], iterations: 2, relativeResidual: 0,
    } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const shellResult = await solveNativeGeometricShell(shell, 0, [], [], undefined, [], [], [
    { nodeId: 1, u: true, v: true }, { nodeId: 4, u: true, v: true },
  ], [
    { nodeId: 2, fxKn: 2.5, fyKn: 0 }, { nodeId: 4, fxKn: 2.5, fyKn: 0 },
  ]);
  assert.equal(shellResult.iterations, 2);
  const shellInput = JSON.parse(request.options.body).inputs;
  assert.equal(shellInput.kind, "geometricShell");
  assert.deepEqual(shellInput.input.membraneSupports, [
    { nodeId: 1, u: true, v: true }, { nodeId: 4, u: true, v: true },
  ]);
  assert.deepEqual(shellInput.input.membraneLoads, [
    { nodeId: 2, fxKn: 2.5, fyKn: 0 }, { nodeId: 4, fxKn: 2.5, fyKn: 0 },
  ]);
  globalThis.fetch = async () => new Response(JSON.stringify({ kind: "quad2d", result: {} }), {
    status: 200, headers: { "content-type": "application/json" },
  });
  await assert.rejects(solveNativeFem("squareMesh", input), /geen squareMesh-resultaat/);
  console.log("Native FEM-client route en resultaattype slagen.");
} finally {
  globalThis.fetch = originalFetch;
}

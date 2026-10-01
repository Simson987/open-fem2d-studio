import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { solve } from "./src/components/fem/solver/engine.ts";

const binary = fileURLToPath(new URL(`../src-tauri/target/debug/native-frame2d${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
const invoke = (request) => new Promise((resolve, reject) => {
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [], errors = [];
  child.stdout.on("data", chunk => output.push(chunk));
  child.stderr.on("data", chunk => errors.push(chunk));
  child.on("error", reject);
  child.on("close", code => {
    if (code !== 0) return reject(new Error(`${Buffer.concat(output)} ${Buffer.concat(errors)}`));
    resolve(JSON.parse(Buffer.concat(output).toString()));
  });
  child.stdin.end(JSON.stringify(request));
});
const close = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${label}: Rust ${actual}, TypeScript ${expected}, grens ${tolerance}`,
);

const material = { id: 1, eMpa: 210_000 };
const section = { id: 1, areaM2: 0.01, inertiaM4: 8e-6 };
const scenarios = [
  {
    name: "uitkraging met eindlast",
    app: {
      nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 3000, z: 0 }],
      beams: [{ id: 1, from: 1, to: 2, E: 210_000, A: 10_000, I: 8e6 }],
      supports: [{ nodeId: 1, type: "fixed" }], loads: [],
      pointLoads: [{ nodeId: 2, fz: -10_000 }],
    },
    rust: {
      nodes: [{ id: 1, x: 0, y: 0 }, { id: 2, x: 3, y: 0 }],
      supports: [{ nodeId: 1, ux: true, uy: true, rz: true }],
      nodalLoads: [{ nodeId: 2, fx: 0, fy: -10, mz: 0 }],
    },
  },
  {
    name: "vrij opgelegde ligger met gelijkmatige last",
    app: {
      nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }],
      beams: [{ id: 1, from: 1, to: 2, E: 210_000, A: 10_000, I: 8e6 }],
      supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
      loads: [{ beamId: 1, q: -5 }],
    },
    rust: {
      nodes: [{ id: 1, x: 0, y: 0 }, { id: 2, x: 6, y: 0 }],
      supports: [{ nodeId: 1, ux: true, uy: true, rz: false },
        { nodeId: 2, ux: false, uy: true, rz: false }],
      memberLoads: [{ memberId: 1, qxStartKnPerM: 0, qxEndKnPerM: 0,
        qyStartKnPerM: -5, qyEndKnPerM: -5 }],
    },
  },
  {
    name: "schuine uitkraging met globale verticale last",
    app: {
      nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 4000, z: 3000 }],
      beams: [{ id: 1, from: 1, to: 2, E: 210_000, A: 10_000, I: 8e6 }],
      supports: [{ nodeId: 1, type: "fixed" }],
      loads: [{ beamId: 1, q: -3, qDir: "z" }],
    },
    rust: {
      nodes: [{ id: 1, x: 0, y: 0 }, { id: 2, x: 4, y: 3 }],
      supports: [{ nodeId: 1, ux: true, uy: true, rz: true }],
      memberLoads: [{ memberId: 1, qxStartKnPerM: -1.8, qxEndKnPerM: -1.8,
        qyStartKnPerM: -2.4, qyEndKnPerM: -2.4 }],
    },
  },
  {
    name: "uitkraging met staafpuntlast halverwege",
    app: {
      nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 3000, z: 0 }],
      beams: [{ id: 1, from: 1, to: 2, E: 210_000, A: 10_000, I: 8e6 }],
      supports: [{ nodeId: 1, type: "fixed" }], loads: [],
      beamPointLoads: [{ beamId: 1, posFrac: 0.5, fz: -8000 }],
    },
    rust: {
      nodes: [{ id: 1, x: 0, y: 0 }, { id: 2, x: 3, y: 0 }],
      supports: [{ nodeId: 1, ux: true, uy: true, rz: true }],
      memberPointLoads: [{ memberId: 1, pxKn: 0, pyKn: -8, positionM: 1.5 }],
    },
  },
  {
    name: "uitkraging met gedeeltelijke trapeziumlast",
    app: {
      nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 3000, z: 0 }],
      beams: [{ id: 1, from: 1, to: 2, E: 210_000, A: 10_000, I: 8e6 }],
      supports: [{ nodeId: 1, type: "fixed" }],
      loads: [{ beamId: 1, q: -2, qStart: -2, qEnd: -6, startFrac: 0.2, endFrac: 0.8 }],
    },
    rust: {
      nodes: [{ id: 1, x: 0, y: 0 }, { id: 2, x: 3, y: 0 }],
      supports: [{ nodeId: 1, ux: true, uy: true, rz: true }],
      memberLoads: [{ memberId: 1, qxStartKnPerM: 0, qxEndKnPerM: 0,
        qyStartKnPerM: -2, qyEndKnPerM: -6, startPositionM: 0.6, endPositionM: 2.4 }],
    },
  },
  {
    name: "uitkraging met axiale veer",
    app: {
      nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 3000, z: 0 }],
      beams: [{ id: 1, from: 1, to: 2, E: 210_000, A: 10_000, I: 8e6 }],
      supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 2, type: "xSpring", k: 1000 }],
      loads: [], pointLoads: [{ nodeId: 2, fx: 100_000 }],
    },
    rust: {
      nodes: [{ id: 1, x: 0, y: 0 }, { id: 2, x: 3, y: 0 }],
      supports: [{ nodeId: 1, ux: true, uy: true, rz: true },
        { nodeId: 2, ux: false, uy: false, rz: false, kxKnPerM: 1000 }],
      nodalLoads: [{ nodeId: 2, fx: 100, fy: 0, mz: 0 }],
    },
  },
];

for (const scenario of scenarios) {
  const app = solve(scenario.app);
  const rust = await invoke({ analysis: "linear", ...scenario.rust,
    materials: [material], sections: [section],
    members: [{ id: 1, startNodeId: 1, endNodeId: 2, materialId: 1, sectionId: 1 }],
  });
  assert.ok(rust.equilibriumResidual < 1e-8, scenario.name);
  for (const node of rust.nodes) {
    const displacement = app.displacements.get(node.nodeId);
    assert.ok(displacement, `${scenario.name}: knoop ${node.nodeId}`);
    close(node.displacement[0] * 1000, displacement.ux, 1e-6, `${scenario.name} ux ${node.nodeId}`);
    close(node.displacement[1] * 1000, displacement.uz, 1e-6, `${scenario.name} uz ${node.nodeId}`);
    close(node.displacement[2], displacement.ry, 1e-8, `${scenario.name} rotatie ${node.nodeId}`);
    const reaction = app.reactions.get(node.nodeId);
    if (reaction) {
      close(node.reaction[0] * 1000, reaction.fx, 1e-4, `${scenario.name} Rx ${node.nodeId}`);
      close(node.reaction[1] * 1000, reaction.fz, 1e-4, `${scenario.name} Rz ${node.nodeId}`);
      close(node.reaction[2] * 1e6, reaction.my, 1e-3, `${scenario.name} My ${node.nodeId}`);
    }
  }
  if (!["uitkraging met staafpuntlast halverwege", "uitkraging met gedeeltelijke trapeziumlast"].includes(scenario.name)) {
    const member = rust.members[0];
    const reference = app.elements.get(1);
    assert.ok(reference);
    for (const [nativeKey, appKey, scale, tolerance] of [
      ["normalForceKn", "normalForce", 1000, 1e-5],
      ["shearForceKn", "shearForce", 1000, 1e-5],
      ["bendingMomentKnm", "bendingMoment", 1e6, 1e-3],
      ["deflectionM", "deflection", 1000, 1e-6],
      ["axialDispM", "axialDisp", 1000, 1e-6],
      ["rotationRad", "rotation", 1, 1e-8],
    ]) {
      member[nativeKey].forEach((value, index) => close(value * scale, reference[appKey][index], tolerance,
        `${scenario.name} ${nativeKey} station ${index}`));
    }
  }
}
const portalApp = {
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: 3000 }, { id: 3, x: 4000, z: 3000 }],
  beams: [{ id: 1, from: 1, to: 2, E: 210_000, A: 10_000, I: 8e6 },
    { id: 2, from: 2, to: 3, E: 210_000, A: 10_000, I: 8e6 }],
  supports: [{ nodeId: 1, type: "fixed" }],
  loads: [{ beamId: 2, q: -2 }],
  pointLoads: [{ nodeId: 3, fx: 5000, fz: -10_000 }],
};
const portalNative = await invoke({ analysis: "linear",
  nodes: [{ id: 1, x: 0, y: 0 }, { id: 2, x: 0, y: 3 }, { id: 3, x: 4, y: 3 }],
  materials: [material], sections: [section],
  members: [{ id: 1, startNodeId: 1, endNodeId: 2, materialId: 1, sectionId: 1 },
    { id: 2, startNodeId: 2, endNodeId: 3, materialId: 1, sectionId: 1 }],
  supports: [{ nodeId: 1, ux: true, uy: true, rz: true }],
  nodalLoads: [{ nodeId: 3, fx: 5, fy: -10, mz: 0 }],
  memberLoads: [{ memberId: 2, qxStartKnPerM: 0, qxEndKnPerM: 0,
    qyStartKnPerM: -2, qyEndKnPerM: -2 }],
});
const portalReference = solve(portalApp);
assert.ok(portalNative.equilibriumResidual < 1e-8);
for (const node of portalNative.nodes) {
  const expected = portalReference.displacements.get(node.nodeId);
  close(node.displacement[0] * 1000, expected.ux, 1e-6, `portaal knoop ${node.nodeId} ux`);
  close(node.displacement[1] * 1000, expected.uz, 1e-6, `portaal knoop ${node.nodeId} uz`);
  close(node.displacement[2], expected.ry, 1e-8, `portaal knoop ${node.nodeId} ry`);
}
for (const member of portalNative.members) {
  const expected = portalReference.elements.get(member.memberId);
  member.bendingMomentKnm.forEach((value, index) => close(value * 1e6, expected.bendingMoment[index],
    1e-3, `portaal staaf ${member.memberId} moment ${index}`));
  member.normalForceKn.forEach((value, index) => close(value * 1000, expected.normalForce[index],
    1e-5, `portaal staaf ${member.memberId} N ${index}`));
}
console.log(`Native 2D-raamwerk: ${scenarios.length} liggergevallen en een tweestaafs portaal stemmen overeen met de bestaande solver.`);

import assert from "node:assert/strict";
// De werkbank haalt zijn teksten uit de locales; zonder i18n gaf t() de sleutel terug.
import "./scripts/i18n-voor-tests.mjs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Mixed3DWorkbench, { buildIrregularCutawayFaces, IrregularCutaway,
  IrregularSection, Mixed3DResults } from "./src/components/volume3d/Mixed3DWorkbench.tsx";
import { buildIrregularMixed3DModel, LARGE_IRREGULAR_DIMENSIONS, MEDIUM_IRREGULAR_DIMENSIONS,
  SMALL_IRREGULAR_DIMENSIONS } from "./src/components/volume3d/irregularMixed3dModel.ts";

const page = renderToStaticMarkup(React.createElement(Mixed3DWorkbench));
assert.match(page, /Laad groot proefmodel \(55\.232 volume-elementen\)/);
assert.match(page, /Laad proefmodel \(2\.248 volume-elementen\)/);
assert.match(page, /Laad onregelmatig proefmodel \(klein\)/);
const preview = renderToStaticMarkup(React.createElement(IrregularSection, { dims: LARGE_IRREGULAR_DIMENSIONS }));
assert.match(preview, /interne holte en L-uitsparing/);
assert.match(preview, /Doorsnede z-laag/);
assert.ok((preview.match(/<rect /g) ?? []).length < 32 * 24, "the section exposes the cut and cavity");

const large = buildIrregularMixed3DModel(LARGE_IRREGULAR_DIMENSIONS);
const cutawayFaces = buildIrregularCutawayFaces(LARGE_IRREGULAR_DIMENSIONS);
assert.ok(cutawayFaces.length > 700 && cutawayFaces.length < 2500, "only exposed cutaway faces should render");
assert.ok(cutawayFaces.some((face) => face.family === "hex8" && face.side === "top"));
assert.ok(cutawayFaces.some((face) => face.family === "tet4" && face.side === "top"));
assert.ok(cutawayFaces.some((face) => face.key === "4-8-7-top"), "void floor must be exposed");
assert.ok(cutawayFaces.some((face) => face.key === "3-8-8-east"), "void wall must be exposed");
assert.ok(cutawayFaces.some((face) => face.key === "23-16-0-east"), "L-cut edge must be exposed");
const cutaway = renderToStaticMarkup(React.createElement(IrregularCutaway, {
  dims: LARGE_IRREGULAR_DIMENSIONS, model: large,
}));
assert.match(cutaway, /Isometrisch 3D-overzicht/);
assert.match(cutaway, /data-family="hex8"/);
assert.match(cutaway, /data-family="tet4"/);
assert.match(cutaway, /data-member="truss"/);
assert.match(cutaway, /data-member="frame"/);
assert.equal((cutaway.match(/<polygon /g) ?? []).length, cutawayFaces.length);
assert.equal(large.mesh.tets.length, 46_080);
assert.equal(large.hexes.length, 9_152);
assert.equal(large.tetMaterials.length, large.mesh.tets.length);
assert.equal(large.trusses.length, 1);
assert.equal(large.frames.length, 1);
assert.equal(large.threads, 4);
assert.equal(large.backend, "matrixFreePcg");
assert.equal(large.mesh.nodes.length, large.loadsKn.length);
assert.equal(large.mesh.nodes.length, large.momentsKnm.length);
assert.equal(large.mesh.nodes.length, large.prescribedM.length);
assert.equal(large.mesh.nodes.length, large.prescribedRotationsRad.length);
assert.ok(large.mesh.nodes.length < 33 * 25 * 25);
for (const tet of large.mesh.tets) for (const node of tet) assert.ok(node >= 0 && node < large.mesh.nodes.length);
for (const hex of large.hexes) for (const node of hex.nodes) assert.ok(node >= 0 && node < large.mesh.nodes.length);
for (const frame of large.frames) for (const node of frame.nodes) assert.ok(node >= 0 && node < large.mesh.nodes.length);
assert.deepEqual(large.prescribedRotationsRad[large.frames[0].nodes[0]], [0, 0, 0]);
assert.deepEqual(large.loadsKn[large.frames[0].nodes[1]], [0.75, -0.8, 3]);
assert.deepEqual(large.momentsKnm[large.frames[0].nodes[1]], [0.1, 0.25, -0.15]);
assert.equal(large.loadsKn.reduce((sum, load) => sum + load[0], 0), 4.35);

const small = buildIrregularMixed3DModel(SMALL_IRREGULAR_DIMENSIONS);
assert.ok(small.mesh.tets.length > 0 && small.hexes.length > 0);
const medium = buildIrregularMixed3DModel(MEDIUM_IRREGULAR_DIMENSIONS);
assert.equal(medium.mesh.tets.length, 1_872);
assert.equal(medium.hexes.length, 376);
assert.equal(medium.mesh.nodes.length, 972);
assert.equal(medium.trusses.length, 1);
assert.equal(medium.frames.length, 1);
const binary = fileURLToPath(new URL("../src-tauri/target/debug/native-mixed3d", import.meta.url));
const smallResult = await new Promise((resolve, reject) => {
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [], errors = [];
  child.stdout.on("data", chunk => output.push(chunk));
  child.stderr.on("data", chunk => errors.push(chunk));
  child.on("error", reject);
  child.on("close", code => code === 0
    ? resolve(JSON.parse(Buffer.concat(output).toString()))
    : reject(new Error(Buffer.concat(errors).toString() || Buffer.concat(output).toString())));
  child.stdin.end(JSON.stringify(small));
});
assert.equal(smallResult.backendUsed, "matrixFreePcg");
assert.equal(smallResult.nodalDisplacementsM.length, small.mesh.nodes.length);
assert.equal(smallResult.solidElementStressMpa.length, small.mesh.tets.length);
assert.equal(smallResult.hexGaussStressMpa.length, small.hexes.length);
assert.ok(smallResult.relativeResidual < 1e-8);
const mockResult = {
  nodalDisplacementsM: Array.from({ length: 100 }, () => [0, 0, 0.001]),
  nodalReactionsKn: Array.from({ length: 100 }, () => [0, 0, 0]),
  nodalRotationsRad: Array.from({ length: 100 }, (_, i) => i === 99 ? [0, 0, 0.01] : null),
  nodalMomentReactionsKnm: Array.from({ length: 100 }, () => null),
  solidElementStressMpa: Array.from({ length: 100 }, () => [1, 2, 3, 4, 5, 6]),
  hexGaussStressMpa: Array.from({ length: 100 }, () => Array.from({ length: 8 }, () => [1, 2, 3, 4, 5, 6])),
  trussAxialForceKn: [12],
  frameEndForcesLocal: [[[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]]],
  relativeResidual: 1e-9, backendUsed: "matrixFreePcg", frontalMaximumFrontDofs: null, linearIterations: 250,
};
const resultView = renderToStaticMarkup(React.createElement(Mixed3DResults, { model: small, result: mockResult }));
assert.match(resultView, /maximaal 24 regels per categorie/);
assert.match(resultView, /grootste \|u\|/);
assert.ok((resultView.match(/<tr>/g) ?? []).length < 120, "large responses must stay bounded in the DOM");
assert.match(resultView, /<td>99<\/td>/); // A sparse rotation after the row cap remains visible.
console.log(`Irregular model in app: ${large.mesh.tets.length} Tet4 + ${large.hexes.length} Hex8, bounded result tables.`);

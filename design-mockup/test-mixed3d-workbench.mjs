import assert from "node:assert/strict";
// De werkbank haalt zijn teksten uit de locales; zonder i18n gaf t() de sleutel terug.
import "./scripts/i18n-voor-tests.mjs";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Mixed3DWorkbench, { Mixed3DResults } from "./src/components/volume3d/Mixed3DWorkbench.tsx";

const fixture = JSON.parse(readFileSync(new URL(
  "../src-tauri/crates/native-fem/examples/mixed3d-hex8-tet4-truss.json", import.meta.url,
), "utf8"));
const editor = renderToStaticMarkup(React.createElement(Mixed3DWorkbench));
assert.match(editor, /Mixed3D model-JSON/);
assert.match(editor, /mixed3d-hex8-tet4-truss\.json/);
assert.match(editor, /Laad voorbeeld met verdeelde lasten/);
assert.match(editor, /Laad automatisch herstelvoorbeeld/);
assert.match(editor, /Laad Tet4 met buigende raamstaaf/);
assert.match(editor, /Laad Tet4, Hex8 en matrixvrij raamwerk/);
assert.match(editor, /Laad Tet4 met 3D-membraan/);
assert.match(editor, /Open modelbestand/);
assert.match(editor, /matrixFreePcg/);
assert.match(editor, /Automatisch: matrixvrij/);
assert.match(editor, /Automatisch probeert matrixvrije PCG, ook met buigende raamstaven/);
assert.match(editor, /&quot;hexes&quot;/);
assert.match(editor, /&quot;trusses&quot;/);

const binary = fileURLToPath(new URL("../src-tauri/target/debug/native-mixed3d", import.meta.url));
const input = { ...fixture.input, backend: "sparsePcg" };
const result = await new Promise((resolve, reject) => {
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [], errors = [];
  child.stdout.on("data", chunk => output.push(chunk));
  child.stderr.on("data", chunk => errors.push(chunk));
  child.on("error", reject);
  child.on("close", code => code === 0
    ? resolve(JSON.parse(Buffer.concat(output).toString()))
    : reject(new Error(Buffer.concat(errors).toString() || Buffer.concat(output).toString())));
  child.stdin.end(JSON.stringify(input));
});
const view = renderToStaticMarkup(React.createElement(Mixed3DResults, { model: input, result }));
assert.match(view, /Gebruikte methode: <strong>sparsePcg<\/strong>/);
assert.match(view, /Knoopverplaatsingen \(m\) en reacties \(kN\)/);
assert.match(view, /Tet4-spanningen \(MPa\)/);
assert.match(view, /Hex8 Gauss-spanningen \(MPa\)/);
assert.match(view, /Staafnormaalkrachten \(kN\)/);
assert.match(view, /0–8/);
assert.equal((view.match(/<td>8<\/td>/g) ?? []).length > 0, true);
const frameFixture = JSON.parse(readFileSync(new URL(
  "../src-tauri/crates/native-fem/examples/mixed3d-tet4-frame-bending.json", import.meta.url,
), "utf8"));
const frameResult = await new Promise((resolve, reject) => {
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [], errors = [];
  child.stdout.on("data", chunk => output.push(chunk));
  child.stderr.on("data", chunk => errors.push(chunk));
  child.on("error", reject);
  child.on("close", code => code === 0
    ? resolve(JSON.parse(Buffer.concat(output).toString()))
    : reject(new Error(Buffer.concat(errors).toString() || Buffer.concat(output).toString())));
  child.stdin.end(JSON.stringify(frameFixture.input));
});
const frameView = renderToStaticMarkup(React.createElement(Mixed3DResults, {
  model: frameFixture.input, result: frameResult,
}));
assert.match(frameView, /Knooprotaties \(rad\) en momentreacties \(kNm\)/);
assert.match(frameView, /Raamwerk-eindkrachten in lokale assen \(kN, kNm\)/);
assert.match(frameView, /<th>θᵧ<\/th>/);
assert.match(frameView, /<th>Mᵧ<\/th>/);
console.log("Mixed3D workbench toont fixture, backend, knopen, reacties, spanningen en raamwerkrotaties/eindkrachten.");

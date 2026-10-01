import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import OpenFem3DReportViews from "./src/components/openFem3d/OpenFem3DReportViews.tsx";

const model = {
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 },
    { id: 2, x: 5, y: 0, z: 0 },
    { id: 3, x: 5, y: 3, z: 4 },
  ],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, material: "S235", profileName: "IPE 200" },
    { id: 2, startNodeId: 2, endNodeId: 3, material: "C30/37", profileName: "300x500" },
  ],
  supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
  loads: [],
};

const result = {
  displacements: [
    { nodeId: 1, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 },
    { nodeId: 2, ux: 0.001, uy: 0, uz: -0.002, rx: 0, ry: 0, rz: 0 },
    { nodeId: 3, ux: 0.002, uy: 0.001, uz: -0.004, rx: 0, ry: 0, rz: 0 },
  ],
};

const checks = {
  results: [{ beam_id: 1, status: "Ok", checks: [{ id: "cross_section", kind: { data: { uc: { uc: 0.72 } } } }] }],
  skipped: [], notes: [],
};
const concreteChecks = {
  results: [{ beam_id: 2, status: "NotOk", uc_max: 1.08 }],
  skipped: [], notes: [],
};

const html = renderToStaticMarkup(React.createElement(OpenFem3DReportViews, {
  model, result, checks, concreteChecks,
}));

assert.equal((html.match(/<svg/g) ?? []).length, 3, "isometrisch, voor- en bovenaanzicht moeten aanwezig zijn");
assert.match(html, /Isometrisch/);
assert.match(html, /Vooraanzicht X\/Z/);
assert.match(html, /Bovenaanzicht X\/Y/);
assert.match(html, /#84cc16/, "staalstaaf met UC 0,72 krijgt de middelste unity-checkkleur");
assert.match(html, /#dc2626/, "overschreden betonstaaf en vervormde lijn zijn rood");
assert.match(html, /stroke-dasharray="8 5"/, "vervormde vorm wordt gestreept getekend");
assert.match(html, /K1/);
assert.match(html, /automatisch vergroot/);

console.log("3D rapportaanzichten, unity-checkkleuren en vervormde vorm: geslaagd");

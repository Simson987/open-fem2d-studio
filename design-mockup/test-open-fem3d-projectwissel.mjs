// Een tweede 3D-project met platen openen in dezelfde sessie (vondst bij de
// voorbeeldprojecten in examples/): "APP BOOTSTRAP ERROR".
//
// OORZAAK
// App wiste de 3D-resultaten in een effect op het model, dus pas NA de render
// met het nieuwe model. Effecten lopen van kind naar ouder: het tekenvlak
// bouwde zijn plaatlaag eerst, met het nieuwe model en het oude resultaat. Het
// oude rekennet wees naar hoekknopen die in het nieuwe project niet bestaan;
// `place` las `undefined` en de TypeError in het effect brak de hele app af.
//
//  [1] de plaatlaag met een net dat niet bij het model past (oud resultaat of
//      oud weergavenet): geen fout, geen contour; met het eigen net wel;
//  [2] de toets `openFem3DPlateMeshFitsModel` (knopen en platen);
//  [3] App wist de resultaten al tijdens de render zodra het model een ander is.
//
// Uitvoeren: npx tsx test-open-fem3d-projectwissel.mjs   (vanuit design-mockup/)
import { readFileSync } from "node:fs";

const { buildOpenFem3DPlateOverlay, openFem3DPlateMeshFitsModel } = await import("./src/components/openFem3d/openFem3dPlateOverlay.ts");
const { parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};

// Project A: vloer 4 × 2 m op z = 3 met hoekknopen 1–4. Project B: een wand
// met hoekknopen 21–24 (andere ids, zoals bij een ander project).
const plaat = (ids, punten) => parseOpenFem3DModel({
  nodes: ids.map((id, i) => ({ id, ...punten[i] })),
  beams: [], supports: [], loads: [], memberLoads: [],
  plates: [{ id: 1, nodeIds: ids, thicknessMm: 200 }],
});
const projectA = plaat([1, 2, 3, 4], [{ x: 0, y: 0, z: 3 }, { x: 4, y: 0, z: 3 }, { x: 4, y: 2, z: 3 }, { x: 0, y: 2, z: 3 }]);
const projectB = plaat([21, 22, 23, 24], [{ x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }, { x: 6, y: 0, z: 3 }, { x: 0, y: 0, z: 3 }]);
// Het net van A: twee elementen met de hoeken 1–4 en twee netknopen (1001, 1002) halverwege.
const netA = {
  nodes: [{ id: 1001, x: 2, y: 0, z: 3 }, { id: 1002, x: 2, y: 2, z: 3 }],
  elements: [{ id: 1, plateId: 1, nodeIds: [1, 1001, 1002, 4] }, { id: 2, plateId: 1, nodeIds: [1001, 2, 3, 1002] }],
  beamIntermediateNodes: new Map(), plateEdgeNodes: new Map(), plates: [], notices: [],
};
const netB = {
  nodes: [{ id: 2001, x: 3, y: 0, z: 0 }, { id: 2002, x: 3, y: 0, z: 3 }],
  elements: [{ id: 1, plateId: 1, nodeIds: [21, 2001, 2002, 24] }, { id: 2, plateId: 1, nodeIds: [2001, 22, 23, 2002] }],
  beamIntermediateNodes: new Map(), plateEdgeNodes: new Map(), plates: [], notices: [],
};
const resultaat = (net, ids) => ({
  displacements: [], plateMesh: net,
  shellNodes: ids.map((nodeId, i) => ({ nodeId, plateId: 1, wM: -0.001 * (i + 1) })),
});
const resultaatA = resultaat(netA, [1, 2, 3, 4, 1001, 1002]);
const laag = (model, result, mesh = null) => buildOpenFem3DPlateOverlay({
  model, mesh, result, quantity: "w", showMesh: true, showPlates: true, deformation: true, deformationScale: 50,
});

console.log("\n[1] de plaatlaag na een projectwissel");
{
  const eigen = laag(projectA, resultaatA);
  check("project A met zijn eigen resultaat: contour", eigen.contourShown === true);
  let fout = null, uit = null;
  try { uit = laag(projectB, resultaatA); } catch (e) { fout = e; }
  check("project B met het oude resultaat van A: geen fout (was TypeError op een onbekende knoop)", fout === null, String(fout));
  check("en geen contour uit het oude resultaat", uit?.contourShown === false);
  let fout2 = null, uit2 = null;
  try { uit2 = laag(projectB, null, netA); } catch (e) { fout2 = e; }
  check("project B met het oude weergavenet van A: geen fout, niets getekend",
    fout2 === null && uit2?.group.children.length === 0, String(fout2));
  const b = laag(projectB, resultaat(netB, [21, 22, 23, 24, 2001, 2002]));
  check("project B met zijn eigen resultaat: contour", b.contourShown === true);
}

console.log("\n[2] past het net bij het model");
{
  check("net A bij A", openFem3DPlateMeshFitsModel(netA, projectA));
  check("net A bij B niet (hoekknopen 1–4 ontbreken)", !openFem3DPlateMeshFitsModel(netA, projectB));
  const zonderPlaat = { ...projectA, plates: [] };
  check("net A bij A zonder plaat 1 niet", !openFem3DPlateMeshFitsModel(netA, zonderPlaat));
}

console.log("\n[3] App wist de resultaten tijdens de render bij een ander model");
{
  const app = readFileSync(new URL("./src/App.tsx", import.meta.url), "utf8");
  check("resultaten horen bij het model; wissen tijdens de render",
    /const \[openFem3dResultaatModel, setOpenFem3dResultaatModel\] = useState\(openFem3d\);\s*if \(openFem3dResultaatModel !== openFem3d\) \{\s*setOpenFem3dResultaatModel\(openFem3d\);\s*setOpenFem3dResult\(null\);\s*setOpenFem3dCaseResults\(new Map\(\)\);\s*setOpenFem3dCombinationResults\(new Map\(\)\);/.test(app));
}

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

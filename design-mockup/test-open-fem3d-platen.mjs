// 3D-platen: rekennet en berekening met de externe 3D-kern (MITC4).
//
// Deel 1 toetst het net zonder kern: rechthoek als raster, boogrand en
// opening als driehoeken → vierhoeken, gedeelde knopen tussen plaat–plaat en
// plaat–staaf, doorstekende kolom. Deel 2 rekent met de kernbinary
// (OPEN_FEM_3D_SOLVER_PATH of src-tauri/target/debug) tegen de
// plaattheorie: vrij opgelegde en ingeklemde vierkante plaat (ook via
// randopleggingen in het model), vloer op randliggers (evenwicht) en het
// eigen gewicht.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  OPEN_FEM_3D_SUPPORT_PRESETS, parseOpenFem3DModel, updateOpenFem3DPlate, withOpenFem3DSelfWeight,
} from "./src/components/openFem3d/openFem3dModel.ts";
import { meshOpenFem3DPlates } from "./src/components/openFem3d/openFem3dPlateMesh.ts";
import { openFem3DPlateEdges, withOpenFem3DPlateEdgeSupport } from "./src/components/openFem3d/openFem3dPlateEdges.ts";
import { buildOpenFem3DSolveRequest, openFem3DGlobalForceBalance } from "./src/components/openFem3d/openFem3dSolver.ts";
import { CONCRETE_E_CM, NU_BETON } from "./src/lib/sectionResolver.ts";

const stil = console.log;
// TriangleService logt elke aanroep; houd de testuitvoer leesbaar.
console.log = (...args) => { if (!String(args[0] ?? "").startsWith("[TriangleService]")) stil(...args); };

const knoop = (id, x, y, z) => ({ id, x, y, z });
const punt = (mesh, model, id) => mesh.nodes.find((n) => n.id === id) ?? model.nodes.find((n) => n.id === id);
const opLijn = (p, a, b) => {
  const d = [b.x - a.x, b.y - a.y, b.z - a.z];
  const l = Math.hypot(...d);
  const t = ((p.x - a.x) * d[0] + (p.y - a.y) * d[1] + (p.z - a.z) * d[2]) / l;
  const q = [a.x + d[0] * t / l, a.y + d[1] * t / l, a.z + d[2] * t / l];
  return Math.hypot(p.x - q[0], p.y - q[1], p.z - q[2]) < 1e-6 && t > -1e-6 && t < l + 1e-6;
};
const oppervlak = (mesh, model, element) => {
  const [a, b, c, d] = element.nodeIds.map((id) => punt(mesh, model, id));
  const tri = (p, q, r) => {
    const u = [q.x - p.x, q.y - p.y, q.z - p.z], v = [r.x - p.x, r.y - p.y, r.z - p.z];
    return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  };
  return tri(a, b, c) + tri(a, c, d);
};
const convexEnTegenDeKlok = (mesh, model, element, normaal) => element.nodeIds.every((id, k) => {
  const p = punt(mesh, model, id);
  const q = punt(mesh, model, element.nodeIds[(k + 1) % 4]);
  const r = punt(mesh, model, element.nodeIds[(k + 2) % 4]);
  const u = [q.x - p.x, q.y - p.y, q.z - p.z], v = [r.x - q.x, r.y - q.y, r.z - q.z];
  const c = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return c[0] * normaal[0] + c[1] * normaal[1] + c[2] * normaal[2] > 0;
});

// ── Deel 1: het net ─────────────────────────────────────────────────────────

// 1a. Rechthoek → raster, h = 0,375 m: 16 × 16 vierhoeken.
const vierkant = parseOpenFem3DModel({
  nodes: [knoop(1, 0, 0, 0), knoop(2, 6, 0, 0), knoop(3, 6, 6, 0), knoop(4, 0, 6, 0)],
  beams: [],
  plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.06, material: "C30/37", meshSizeM: 0.375 }],
});
{
  const mesh = await meshOpenFem3DPlates(vierkant);
  assert.equal(mesh.plates[0].method, "raster");
  assert.equal(mesh.elements.length, 256);
  assert.ok(mesh.elements.every((e) => convexEnTegenDeKlok(mesh, vierkant, e, [0, 0, 1])));
  const totaal = mesh.elements.reduce((s, e) => s + oppervlak(mesh, vierkant, e), 0);
  assert.ok(Math.abs(totaal - 36) < 1e-9, `oppervlak ${totaal}`);
  assert.ok(mesh.elements.flatMap((e) => e.nodeIds).includes(1), "hoekknopen blijven modelknopen");
  stil("  ✓ rechthoek: raster 16×16, convex, tegen de klok in, oppervlak 36 m²");
  // Randknopen per rand (voor randopleggingen): rand k loopt van knoop k naar k+1.
  const randen = mesh.plateEdgeNodes.get(1);
  assert.equal(randen.length, 4);
  for (const [k, [van, naar]] of [[1, 2], [2, 3], [3, 4], [4, 1]].entries()) {
    const ids = randen[k];
    assert.equal(ids.length, 17, `rand ${k + 1}: 17 knopen`);
    assert.equal(ids[0], van);
    assert.equal(ids[ids.length - 1], naar);
    const a = punt(mesh, vierkant, van), b = punt(mesh, vierkant, naar);
    assert.ok(ids.every((id) => opLijn(punt(mesh, vierkant, id), a, b)), `rand ${k + 1}: alle knopen op de rand`);
    const afstand = ids.map((id) => { const p = punt(mesh, vierkant, id); return Math.hypot(p.x - a.x, p.y - a.y); });
    assert.ok(afstand.every((d, i) => i === 0 || d > afstand[i - 1]), `rand ${k + 1}: van begin naar eind`);
  }
  stil("  ✓ randknopen: 4 randen × 17 knopen, op volgorde van begin- naar eindknoop");
}

// 1b. Rechthoek met kolomknoop in het veld en rechthoekige opening → nog steeds raster.
{
  const model = parseOpenFem3DModel({
    nodes: [
      knoop(1, 0, 0, 0), knoop(2, 8, 0, 0), knoop(3, 8, 6, 0), knoop(4, 0, 6, 0),
      knoop(5, 5, 2, 0), knoop(6, 6.5, 2, 0), knoop(7, 6.5, 4, 0), knoop(8, 5, 4, 0),
      knoop(9, 2.3, 3.1, 0), knoop(10, 2.3, 3.1, -3),
    ],
    beams: [{ id: 1, startNodeId: 10, endNodeId: 9, profileName: "HEB200", material: "S235" }],
    plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.25, material: "C30/37", meshSizeM: 0.5,
      openings: [{ id: 1, nodeIds: [5, 6, 7, 8] }] }],
  });
  const mesh = await meshOpenFem3DPlates(model);
  assert.equal(mesh.plates[0].method, "raster", "kolomknoop en opening passen in het raster");
  assert.ok(mesh.elements.some((e) => e.nodeIds.includes(9)), "de kolomkop is een plaatknoop");
  const totaal = mesh.elements.reduce((s, e) => s + oppervlak(mesh, model, e), 0);
  assert.ok(Math.abs(totaal - (48 - 3)) < 1e-9, `oppervlak ${totaal}`);
  assert.ok(!mesh.elements.some((e) => {
    const c = e.nodeIds.map((id) => punt(mesh, model, id)).reduce((s, p) => [s[0] + p.x / 4, s[1] + p.y / 4], [0, 0]);
    return c[0] > 5 && c[0] < 6.5 && c[1] > 2 && c[1] < 4;
  }), "geen element in de opening");
  stil(`  ✓ rechthoek met kolom en opening: raster, ${mesh.elements.length} elementen, oppervlak 45 m²`);
}

// 1c. Boogrand + opening met boog → driehoeken gesplitst in vierhoeken.
{
  const model = parseOpenFem3DModel({
    nodes: [
      knoop(1, 0, 0, 0), knoop(2, 6, 0, 0), knoop(3, 6, 4, 0), knoop(4, 0, 4, 0), knoop(5, 3, -1.5, 0),
      knoop(6, 2, 1, 0), knoop(7, 4, 1, 0), knoop(8, 4, 3, 0), knoop(9, 2, 3, 0), knoop(10, 3, 0.5, 0),
    ],
    beams: [],
    plates: [{
      id: 1, nodeIds: [1, 5, 2, 3, 4], thicknessM: 0.2, material: "C30/37", meshSizeM: 0.25,
      boundary: [
        { kind: "arc", startNodeId: 1, controlNodeId: 5, endNodeId: 2 },
        { kind: "line", startNodeId: 2, endNodeId: 3 },
        { kind: "line", startNodeId: 3, endNodeId: 4 },
        { kind: "line", startNodeId: 4, endNodeId: 1 },
      ],
      openings: [{
        id: 1, nodeIds: [6, 10, 7, 8, 9],
        boundary: [
          { kind: "arc", startNodeId: 6, controlNodeId: 10, endNodeId: 7 },
          { kind: "line", startNodeId: 7, endNodeId: 8 },
          { kind: "line", startNodeId: 8, endNodeId: 9 },
          { kind: "line", startNodeId: 9, endNodeId: 6 },
        ],
      }],
    }],
  });
  const mesh = await meshOpenFem3DPlates(model);
  assert.equal(mesh.plates[0].method, "driehoeken");
  assert.ok(mesh.elements.every((e) => convexEnTegenDeKlok(mesh, model, e, [0, 0, 1])), "alle vierhoeken convex");
  // Cirkel door (0,0), (3,−1,5), (6,0): middelpunt (3, 2,25), straal 3,75.
  const opBoog = (p) => Math.abs(Math.hypot(p.x - 3, p.y - 2.25) - 3.75) < 1e-6;
  // Randknopen: knopen van elementranden die maar in één element voorkomen.
  const telling = new Map();
  for (const e of mesh.elements) for (let k = 0; k < 4; k += 1) {
    const [p, q] = [e.nodeIds[k], e.nodeIds[(k + 1) % 4]];
    const sleutel = p < q ? `${p}-${q}` : `${q}-${p}`;
    telling.set(sleutel, (telling.get(sleutel) ?? 0) + 1);
  }
  const rand = new Set([...telling].filter(([, n]) => n === 1).flatMap(([k]) => k.split("-").map(Number)));
  const randknopen = [...rand].map((id) => punt(mesh, model, id)).filter((p) => p.y < -1e-9);
  assert.ok(randknopen.length > 10 && randknopen.every(opBoog), "alle randknopen onder y = 0 liggen op de boog");
  assert.ok(mesh.elements.some((e) => e.nodeIds.includes(5)), "de stuurknoop van de boog is een plaatknoop");
  // Oppervlak: rechthoek + cirkelsegment onder y = 0 − opening. De boog van
  // de opening buigt onder y = 1 uit: opening = rechthoek 2×2 + segment.
  const segment = (r, koorde) => { const h = 2 * Math.asin(koorde / (2 * r)); return r * r * (h - Math.sin(h)) / 2; };
  const openingsboog = { r: 1.25, koorde: 2 }; // door (2,1), (3; 0,5), (4,1): middelpunt (3; 1,75)
  const exact = 24 + segment(3.75, 6) - (4 + segment(openingsboog.r, openingsboog.koorde));
  const totaal = mesh.elements.reduce((s, e) => s + oppervlak(mesh, model, e), 0);
  assert.ok(Math.abs(totaal - exact) / exact < 1e-3, `oppervlak ${totaal} tegen ${exact}`);
  stil(`  ✓ boogrand en boogopening: ${mesh.elements.length} vierhoeken, knopen op de cirkel, oppervlak ${totaal.toFixed(3)} (exact ${exact.toFixed(3)} m²)`);
  // De boogrand (rand 1) als randoplegging: alle knopen op de cirkel, van knoop 1 naar 2.
  const boog = mesh.plateEdgeNodes.get(1)[0];
  assert.equal(boog[0], 1);
  assert.equal(boog[boog.length - 1], 2);
  assert.ok(boog.includes(5), "de stuurknoop ligt op de boogrand");
  assert.ok(boog.every((id) => opBoog(punt(mesh, model, id))), "alleen knopen op de cirkel");
  assert.equal(boog.length, randknopen.length + 2, "alle randknopen onder y = 0 plus de twee eindknopen");
  const hoeken = boog.map((id) => { const p = punt(mesh, model, id); return Math.atan2(p.y - 2.25, p.x - 3); });
  assert.ok(hoeken.every((h, i) => i === 0 || h > hoeken[i - 1]), "op volgorde langs de boog");
  assert.deepEqual(openFem3DPlateEdges(model.plates[0]).map((e) => e.controlNodeId), [5, undefined, undefined, undefined]);
  stil(`  ✓ randknopen op de boogrand: ${boog.length}, op volgorde langs de boog`);
}

// 1c'. Randopleggingen in het model: controle en bewerken.
{
  const basis = { nodes: vierkant.nodes, beams: [] };
  const met = (edgeSupports) => parseOpenFem3DModel({ ...basis, plates: [{ ...vierkant.plates[0], edgeSupports }] });
  const scharnier = OPEN_FEM_3D_SUPPORT_PRESETS.pinned;
  assert.throws(() => met([{ edge: 4, ...scharnier }]), /ongeldige of dubbele rand/);
  assert.throws(() => met([{ edge: 1, ...scharnier }, { edge: 1, ...scharnier }]), /ongeldige of dubbele rand/);
  assert.throws(() => met([{ edge: 0.5, ...scharnier }]), /ongeldige of dubbele rand/);
  assert.throws(() => met([{ edge: 0, ux: false, uy: false, uz: false, rx: false, ry: false, rz: false }]), /blokkeert niets/);
  const model = met([{ edge: 2, ...scharnier }, { edge: 0, ...OPEN_FEM_3D_SUPPORT_PRESETS.fixed }]);
  assert.deepEqual(model.plates[0].edgeSupports.map((e) => e.edge), [0, 2], "gesorteerd op rand");
  const bijgewerkt = updateOpenFem3DPlate(model, 1, {
    edgeSupports: withOpenFem3DPlateEdgeSupport(model.plates[0].edgeSupports, 0, null),
  });
  assert.deepEqual(bijgewerkt.plates[0].edgeSupports, [{ edge: 2, ...scharnier }]);
  const leeg = updateOpenFem3DPlate(bijgewerkt, 1, {
    edgeSupports: withOpenFem3DPlateEdgeSupport(bijgewerkt.plates[0].edgeSupports, 2, null),
  });
  assert.ok(!("edgeSupports" in leeg.plates[0]), "zonder randopleggingen verdwijnt het veld");
  assert.deepEqual(parseOpenFem3DModel(JSON.parse(JSON.stringify(model))).plates[0].edgeSupports, model.plates[0].edgeSupports,
    "randopleggingen overleven opslaan en laden");
  stil("  ✓ randopleggingen: ongeldige en dubbele randen geweigerd, bewerken en opslaan");
}

// 1d. Wand onder een vloerrand en wand op het vloerveld: gedeelde knopen.
{
  const model = parseOpenFem3DModel({
    nodes: [
      knoop(1, 0, 0, 3), knoop(2, 6, 0, 3), knoop(3, 6, 5, 3), knoop(4, 0, 5, 3),
      knoop(5, 0, 0, 0), knoop(6, 6, 0, 0),
      knoop(7, 1, 2.2, 3), knoop(8, 4.3, 2.2, 3), knoop(9, 4.3, 2.2, 0), knoop(10, 1, 2.2, 0),
    ],
    beams: [],
    plates: [
      { id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2, material: "C30/37", meshSizeM: 0.4 },
      { id: 2, nodeIds: [5, 6, 2, 1], thicknessM: 0.2, material: "C30/37", meshSizeM: 0.3 },
      { id: 3, nodeIds: [10, 9, 8, 7], thicknessM: 0.2, material: "C30/37", meshSizeM: 0.5 },
    ],
  });
  const mesh = await meshOpenFem3DPlates(model);
  const knopenOp = (plaat, a, b) => new Set(mesh.elements.filter((e) => e.plateId === plaat)
    .flatMap((e) => e.nodeIds).filter((id) => opLijn(punt(mesh, model, id), a, b)));
  const gelijk = (x, y) => x.size === y.size && [...x].every((v) => y.has(v));
  const rand = [model.nodes[0], model.nodes[1]];
  assert.ok(gelijk(knopenOp(1, ...rand), knopenOp(2, ...rand)), "vloerrand en wandkop delen dezelfde knopen");
  assert.ok(knopenOp(1, ...rand).size >= 16, "de fijnste maat (0,3 m → 2·0,3 grof + middens) bepaalt de gedeelde rand");
  const lijn = [model.nodes[6], model.nodes[7]];
  const wandKop = knopenOp(3, ...lijn), vloerLijn = knopenOp(1, ...lijn);
  assert.ok([...wandKop].every((id) => vloerLijn.has(id)) && wandKop.size === vloerLijn.size,
    "de kop van de wand op het vloerveld ligt als lijn in het vloernet");
  stil(`  ✓ plaat–plaat: vloerrand/wand ${knopenOp(1, ...rand).size} gedeelde knopen, wand in het veld ${wandKop.size}`);
}

// 1d-bis. Gemengd: vloer met boogrand (driehoeken → vierhoeken) naast een
// rechthoekige wand (raster) op de rechte vloerrand; beide nets delen de rand.
{
  const model = parseOpenFem3DModel({
    nodes: [
      knoop(1, 0, 0, 3), knoop(2, 6, 0, 3), knoop(3, 6, 5, 3), knoop(4, 0, 5, 3), knoop(5, 3, 6.5, 3),
      knoop(6, 0, 0, 0), knoop(7, 6, 0, 0),
    ],
    beams: [],
    plates: [
      { id: 1, nodeIds: [1, 2, 3, 5, 4], thicknessM: 0.2, material: "C30/37", meshSizeM: 0.35,
        boundary: [
          { kind: "line", startNodeId: 1, endNodeId: 2 },
          { kind: "line", startNodeId: 2, endNodeId: 3 },
          { kind: "arc", startNodeId: 3, controlNodeId: 5, endNodeId: 4 },
          { kind: "line", startNodeId: 4, endNodeId: 1 },
        ] },
      { id: 2, nodeIds: [6, 7, 2, 1], thicknessM: 0.25, material: "C30/37", meshSizeM: 0.35 },
    ],
  });
  const mesh = await meshOpenFem3DPlates(model);
  assert.deepEqual(mesh.plates.map((p) => p.method), ["driehoeken", "raster"]);
  const knopenOp = (plaat, a, b) => new Set(mesh.elements.filter((e) => e.plateId === plaat)
    .flatMap((e) => e.nodeIds).filter((id) => opLijn(punt(mesh, model, id), a, b)));
  const rand = [model.nodes[0], model.nodes[1]];
  const vloer = knopenOp(1, ...rand), wand = knopenOp(2, ...rand);
  assert.ok(vloer.size === wand.size && [...vloer].every((id) => wand.has(id)),
    `driehoeksnet en raster delen de rand (${vloer.size} tegen ${wand.size} knopen)`);
  assert.ok(mesh.elements.every((e) => convexEnTegenDeKlok(mesh, model, e,
    e.plateId === 1 ? [0, 0, 1] : [0, -1, 0])), "alle vierhoeken convex rond hun eigen plaatnormaal");
  stil(`  ✓ driehoeksnet naast raster: ${vloer.size} gedeelde randknopen`);
}

// 1e. Randligger en doorstekende kolom: tussenknopen op de staaf.
{
  const model = parseOpenFem3DModel({
    nodes: [
      knoop(1, 0, 0, 0), knoop(2, 4, 0, 0), knoop(3, 4, 4, 0), knoop(4, 0, 4, 0),
      knoop(5, 1.7, 2.1, -3), knoop(6, 1.7, 2.1, 3),
    ],
    beams: [
      { id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA200", material: "S235" },
      { id: 2, startNodeId: 5, endNodeId: 6, profileName: "HEB200", material: "S235" },
    ],
    plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2, material: "C30/37", meshSizeM: 0.5 }],
  });
  const mesh = await meshOpenFem3DPlates(model);
  const randknopen = new Set(mesh.elements.flatMap((e) => e.nodeIds)
    .filter((id) => id !== 1 && id !== 2 && opLijn(punt(mesh, model, id), model.nodes[0], model.nodes[1])));
  const tussen = mesh.beamIntermediateNodes.get(1) ?? [];
  assert.equal(tussen.length, randknopen.size, "elke randknoop is tussenknoop van de ligger");
  assert.ok(tussen.every((id, k) => k === 0 || punt(mesh, model, id).x > punt(mesh, model, tussen[k - 1]).x), "geordend");
  const kolom = mesh.beamIntermediateNodes.get(2) ?? [];
  assert.equal(kolom.length, 1, "de doorstekende kolom krijgt één knoop in het vloervlak");
  const doorsteek = punt(mesh, model, kolom[0]);
  assert.ok(Math.abs(doorsteek.z) < 1e-9 && Math.abs(doorsteek.x - 1.7) < 1e-9 && Math.abs(doorsteek.y - 2.1) < 1e-9);
  assert.ok(mesh.elements.some((e) => e.nodeIds.includes(kolom[0])), "en die knoop is een plaatknoop");
  stil(`  ✓ plaat–staaf: randligger ${tussen.length} tussenknopen, kolom doorsteekknoop gedeeld`);
}

// ── Deel 2: rekenen met de kern ─────────────────────────────────────────────

const solverBinary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${solverBinary}`, import.meta.url));
assert.ok(existsSync(solverPath), "Bouw eerst de Rust-rekenkern (cargo build -p open-fem-3d).");
const reken = (request) => new Promise((resolve, reject) => {
  const child = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  const uit = [], fout = [];
  child.stdout.on("data", (d) => uit.push(d));
  child.stderr.on("data", (d) => fout.push(d));
  child.on("error", reject);
  child.on("close", (code) => {
    const tekst = Buffer.concat(uit).toString();
    if (code !== 0) return reject(new Error(`3D-kern: exit ${code}; ${tekst.slice(0, 600)} ${Buffer.concat(fout).toString().slice(0, 300)}`));
    try { resolve(JSON.parse(tekst)); } catch (e) { reject(e); }
  });
  child.stdin.end(JSON.stringify(request));
});

/**
 * Vierkante vloer a × a, dikte t, ν = 0,2 (beton). Het model kent (nog) alleen
 * knoopopleggingen; voor de lijnoplegging langs de randen krijgen hier alle
 * rekenknopen op de randen een oplegging in het rekenverzoek.
 */
async function vierkantePlaat({ a, t, q, h, ingeklemd, driehoeken = false }) {
  const model = parseOpenFem3DModel({
    // Knoop 5 in het midden: een meetpunt dat ook in het driehoeksnet een knoop is.
    nodes: [knoop(1, 0, 0, 0), knoop(2, a, 0, 0), knoop(3, a, a, 0), knoop(4, 0, a, 0), knoop(5, a / 2, a / 2, 0)],
    beams: [],
    plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: t, material: "C30/37", meshSizeM: h }],
    supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false }],
    surfaceLoads: [{ id: 1, plateId: 1, caseId: 1, qx: 0, qy: 0, qz: -q }],
  });
  const mesh = await meshOpenFem3DPlates(model, { forceTriangulation: driehoeken });
  const request = { ...buildOpenFem3DSolveRequest(model, "linear", 1, mesh), bucklingModes: 0 };
  const opRand = (n) => Math.min(n.x, a - n.x, n.y, a - n.y) < 1e-9;
  request.supports = request.nodes.filter(opRand).map((n) => {
    const langsX = n.y < 1e-9 || a - n.y < 1e-9; // rand evenwijdig aan x
    const langsY = n.x < 1e-9 || a - n.x < 1e-9;
    return {
      nodeId: n.id, ux: n.id === 1, uy: n.id === 1 || n.id === 2, uz: true,
      // "Hard" vrij opgelegd: de draaiing om de randnormaal is vast (w = 0 langs de rand).
      rx: langsY || (ingeklemd && langsX), ry: langsX || (ingeklemd && langsY), rz: false,
    };
  });
  const r = await reken(request);
  const midden = request.nodes.find((n) => Math.abs(n.x - a / 2) < 1e-9 && Math.abs(n.y - a / 2) < 1e-9);
  const randMidden = request.nodes.find((n) => n.x < 1e-9 && Math.abs(n.y - a / 2) < 1e-9);
  return { model, mesh, request, r, midden, randMidden };
}

{
  // E en ν van een betonplaat komen uit dezelfde tabel als bij 2D-platen en staven.
  const { request } = await vierkantePlaat({ a: 6, t: 0.06, q: 10, h: 0.375, ingeklemd: false });
  assert.equal(request.schemaVersion, 2);
  assert.equal(request.materials[0].eMpa, CONCRETE_E_CM["C30/37"]);
  assert.equal(request.materials[0].nu, NU_BETON);
}

const D = (e, t, nu) => e * 1000 * t ** 3 / (12 * (1 - nu * nu));
for (const [soort, driehoeken, grens] of [["raster", false, 0.02], ["driehoeken → vierhoeken", true, 0.03]]) {
  const a = 6, t = 0.06, q = 10;
  const { request, r, midden, mesh } = await vierkantePlaat({ a, t, q, h: 0.375, ingeklemd: false, driehoeken });
  const e = request.materials[0].eMpa, nu = request.materials[0].nu;
  const w = -r.displacements.find((d) => d.nodeId === midden.id).uz;
  const wExact = 0.00406 * q * a ** 4 / D(e, t, nu);
  const knoopMidden = r.shellNodes.find((n) => n.nodeId === midden.id);
  // Bij ν = 0,2 is β = 0,0479·(1,2/1,3)… — gebruik de Navier-reeks voor mx.
  let som = 0;
  for (let m = 1; m <= 49; m += 2) for (let n = 1; n <= 49; n += 2) {
    const teken = (((m - 1) / 2 + (n - 1) / 2) % 2 === 0) ? 1 : -1;
    som += teken * (m * m + nu * n * n) / (m * n * (m * m + n * n) ** 2);
  }
  const mExact = 16 * q * a * a / Math.PI ** 4 * som;
  const fouten = [(w - wExact) / wExact, (knoopMidden.mxxKnmPerM - mExact) / mExact];
  stil(`  ✓ vrij opgelegd (${soort}, ${mesh.elements.length} el.): w = ${(w * 1000).toFixed(3)} mm (${(fouten[0] * 100).toFixed(2)} %), ` +
    `mxx = ${knoopMidden.mxxKnmPerM.toFixed(3)} kNm/m (Navier ${mExact.toFixed(3)}, ${(fouten[1] * 100).toFixed(2)} %)`);
  assert.ok(Math.abs(fouten[0]) < grens && Math.abs(fouten[1]) < grens, `${soort}: ${fouten.map((f) => (f * 100).toFixed(2))} %`);
  assert.ok(openFem3DGlobalForceBalance(request, r).ok, "onafhankelijke krachten- en momentenbalans met vlaklast");
  const somR = r.reactions.reduce((s, x) => s + x.fz, 0);
  assert.ok(Math.abs(somR - q * a * a) < 1e-6 * q * a * a, `Σ Rz = ${somR}`);
}
{
  const a = 6, t = 0.06, q = 10;
  const { request, r, midden, randMidden } = await vierkantePlaat({ a, t, q, h: 0.25, ingeklemd: true });
  const e = request.materials[0].eMpa, nu = request.materials[0].nu;
  const w = -r.displacements.find((d) => d.nodeId === midden.id).uz;
  // Tabelwaarden (ν = 0,3) gelden hier niet exact voor ν = 0,2: de doorbuiging
  // van een ingeklemde plaat hangt niet van ν af (D wel), het inklemmoment
  // van de rand is exact −0,0513·q·a² (m_x = D·w,xx bij w,yy = 0 langs de rand).
  const wExact = 0.00126 * q * a ** 4 / D(e, t, nu);
  const mRand = r.shellNodes.find((n) => n.nodeId === randMidden.id).mxxKnmPerM;
  const mExact = -0.0513 * q * a * a;
  stil(`  ✓ ingeklemd (24×24): w = ${(w * 1000).toFixed(3)} mm (${((w - wExact) / wExact * 100).toFixed(2)} %), ` +
    `inklemmoment ${mRand.toFixed(3)} kNm/m (${((mRand - mExact) / mExact * 100).toFixed(2)} %)`);
  assert.ok(Math.abs(w - wExact) / wExact < 0.02);
  assert.ok(Math.abs(mRand - mExact) / Math.abs(mExact) < 0.02);
}

// Dezelfde vierkante plaat met randopleggingen uit het model, zonder ingrepen
// in het rekenverzoek. Scharnier om X/Y langs randen evenwijdig aan X/Y is
// de "harde" vrije oplegging van hierboven; de steun in het plaatvlak die de
// randopleggingen extra geven verandert bij een vlakke plaat onder een
// loodrechte last niets aan de buiging (eerste orde: membraan en buiging
// ontkoppeld).
async function vierkantMetRanden({ a, t, q, h, randen, supports = [] }) {
  const model = parseOpenFem3DModel({
    nodes: [knoop(1, 0, 0, 0), knoop(2, a, 0, 0), knoop(3, a, a, 0), knoop(4, 0, a, 0), knoop(5, a / 2, a / 2, 0)],
    beams: [],
    plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: t, material: "C30/37", meshSizeM: h,
      edgeSupports: randen.map((preset, edge) => ({ edge, ...OPEN_FEM_3D_SUPPORT_PRESETS[preset] })) }],
    supports,
    surfaceLoads: [{ id: 1, plateId: 1, caseId: 1, qx: 0, qy: 0, qz: -q }],
  });
  const mesh = await meshOpenFem3DPlates(model);
  const request = { ...buildOpenFem3DSolveRequest(model, "linear", 1, mesh), bucklingModes: 0 };
  const r = await reken(request);
  const midden = request.nodes.find((n) => Math.abs(n.x - a / 2) < 1e-9 && Math.abs(n.y - a / 2) < 1e-9);
  const randMidden = request.nodes.find((n) => n.x < 1e-9 && Math.abs(n.y - a / 2) < 1e-9);
  return {
    request, r,
    w: -r.displacements.find((d) => d.nodeId === midden.id).uz,
    mMidden: r.shellNodes.find((n) => n.nodeId === midden.id).mxxKnmPerM,
    mRand: r.shellNodes.find((n) => n.nodeId === randMidden.id).mxxKnmPerM,
  };
}
{
  const a = 6, t = 0.06, q = 10;
  const hard = await vierkantMetRanden({ a, t, q, h: 0.375, randen: ["revoluteX", "revoluteY", "revoluteX", "revoluteY"] });
  assert.equal(hard.request.supports.length, 64, "alle 64 randknopen krijgen een oplegging");
  assert.ok(hard.request.supports.every((s) => s.ux && s.uy && s.uz), "scharnier om X/Y: translatievast");
  const hoek = hard.request.supports.find((s) => s.nodeId === 2);
  assert.ok(hoek.rx && hoek.ry, "in de hoek tellen de blokkeringen van beide randen");
  const verwijzing = await vierkantePlaat({ a, t, q, h: 0.375, ingeklemd: false });
  const wVerwijzing = -verwijzing.r.displacements.find((d) => d.nodeId === verwijzing.midden.id).uz;
  const mVerwijzing = verwijzing.r.shellNodes.find((n) => n.nodeId === verwijzing.midden.id).mxxKnmPerM;
  assert.ok(Math.abs(hard.w - wVerwijzing) < 1e-9 * wVerwijzing, `w ${hard.w} tegen ${wVerwijzing}`);
  assert.ok(Math.abs(hard.mMidden - mVerwijzing) < 1e-6 * Math.abs(mVerwijzing), `m ${hard.mMidden} tegen ${mVerwijzing}`);
  const e = hard.request.materials[0].eMpa, nu = hard.request.materials[0].nu;
  const wExact = 0.00406 * q * a ** 4 / D(e, t, nu);
  assert.ok(Math.abs(hard.w - wExact) / wExact < 0.02);
  assert.ok(openFem3DGlobalForceBalance(hard.request, hard.r).ok);
  assert.ok(Math.abs(hard.r.reactions.reduce((sum, x) => sum + x.fz, 0) - q * a * a) < 1e-6 * q * a * a);
  stil(`  ✓ randopleggingen scharnier om X/Y: w = ${(hard.w * 1000).toFixed(3)} mm (${((hard.w - wExact) / wExact * 100).toFixed(2)} % ` +
    "t.o.v. 0,00406·qa⁴/D), gelijk aan de opleggingen per randknoop");

  // Ruimtelijk scharnier: de draaiing langs de rand is vrij ("zacht" vrij opgelegd).
  const zacht = await vierkantMetRanden({ a, t, q, h: 0.375, randen: ["pinned", "pinned", "pinned", "pinned"] });
  // Z-rollen met steun in het vlak via twee knoopopleggingen: voor de buiging hetzelfde.
  const rollen = await vierkantMetRanden({
    a, t, q, h: 0.375, randen: ["zRoller", "zRoller", "zRoller", "zRoller"],
    supports: [
      { nodeId: 1, ux: true, uy: true, uz: false, rx: false, ry: false, rz: false },
      { nodeId: 2, ux: false, uy: true, uz: false, rx: false, ry: false, rz: false },
    ],
  });
  const knoop1 = rollen.request.supports.find((sup) => sup.nodeId === 1);
  assert.ok(knoop1.ux && knoop1.uy && knoop1.uz, "knoopoplegging en randoplegging samengevoegd");
  assert.ok(Math.abs(rollen.w - zacht.w) < 1e-9 * zacht.w, `Z-rollen ${rollen.w} tegen scharnieren ${zacht.w}`);
  assert.ok(Math.abs(zacht.w - wExact) / wExact < 0.03, `zacht vrij opgelegd: ${((zacht.w - wExact) / wExact * 100).toFixed(2)} %`);
  stil(`  ✓ randopleggingen scharnier / Z-rol + knoopsteun in het vlak: w = ${(zacht.w * 1000).toFixed(3)} mm ` +
    `(${((zacht.w - wExact) / wExact * 100).toFixed(2)} %), beide gelijk`);

  // Alleen Z-rollen: de plaat kan in haar vlak schuiven; de kern weigert met uitleg.
  await assert.rejects(vierkantMetRanden({ a, t, q, h: 0.75, randen: ["zRoller", "zRoller", "zRoller", "zRoller"] }),
    /mechanisme[\s\S]*steun in haar vlak/);

  // Veer en randoplegging op dezelfde vrijheidsgraad: expliciete fout.
  await assert.rejects(vierkantMetRanden({
    a, t, q, h: 0.75, randen: ["pinned", "pinned", "pinned", "pinned"],
    supports: [{ nodeId: 3, ux: false, uy: false, uz: false, rx: false, ry: false, rz: false, springs: { kzKnPerM: 5000 } }],
  }), /veer op UZ/);
  stil("  ✓ alleen Z-rollen: mechanisme met uitleg; veer op een geblokkeerde vrijheidsgraad: fout");
}
{
  const a = 6, t = 0.06, q = 10;
  const vast = await vierkantMetRanden({ a, t, q, h: 0.25, randen: ["fixed", "fixed", "fixed", "fixed"] });
  const e = vast.request.materials[0].eMpa, nu = vast.request.materials[0].nu;
  const wExact = 0.00126 * q * a ** 4 / D(e, t, nu);
  const mExact = -0.0513 * q * a * a;
  assert.ok(Math.abs(vast.w - wExact) / wExact < 0.02);
  assert.ok(Math.abs(vast.mRand - mExact) / Math.abs(mExact) < 0.02);
  stil(`  ✓ randopleggingen inklemming: w = ${(vast.w * 1000).toFixed(3)} mm (${((vast.w - wExact) / wExact * 100).toFixed(2)} %), ` +
    `inklemmoment ${vast.mRand.toFixed(3)} kNm/m (${((vast.mRand - mExact) / mExact * 100).toFixed(2)} %)`);
}

// Vloer op randliggers en kolommen: alles in het model, geen ingrepen in het verzoek.
{
  const nodes = [
    knoop(1, 0, 0, 3), knoop(2, 6, 0, 3), knoop(3, 6, 5, 3), knoop(4, 0, 5, 3),
    knoop(5, 0, 0, 0), knoop(6, 6, 0, 0), knoop(7, 6, 5, 0), knoop(8, 0, 5, 0),
  ];
  const beams = [
    ...[[1, 2], [2, 3], [3, 4], [4, 1]].map(([s, e], k) => ({ id: k + 1, startNodeId: s, endNodeId: e, profileName: "HEA300", material: "S235" })),
    ...[[5, 1], [6, 2], [7, 3], [8, 4]].map(([s, e], k) => ({ id: k + 5, startNodeId: s, endNodeId: e, profileName: "HEB200", material: "S235" })),
  ];
  const model = parseOpenFem3DModel({
    nodes, beams,
    plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2, material: "C30/37" }],
    supports: [5, 6, 7, 8].map((nodeId) => ({ nodeId, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true })),
    surfaceLoads: [{ id: 1, plateId: 1, caseId: 2, qx: 0, qy: 0, qz: -3 }],
  });
  const mesh = await meshOpenFem3DPlates(model);
  const nuttig = { ...buildOpenFem3DSolveRequest(model, "linear", 2, mesh), bucklingModes: 0 };
  const r = await reken(nuttig);
  const somR = r.reactions.reduce((s, x) => s + x.fz, 0);
  assert.ok(Math.abs(somR - 3 * 30) < 1e-6, `Σ Rz = ${somR}`);
  assert.equal(r.equilibrium?.equilibriumOk, true);
  assert.ok(openFem3DGlobalForceBalance(nuttig, r).ok);
  assert.equal(r.memberForces.length, 8, "elke gebruikersstaaf blijft één staaf in het resultaat");
  const randligger = nuttig.members.find((m) => m.id === 1);
  assert.ok(randligger.intermediateNodeIds.length >= 10, "de randligger hangt aan alle randknopen van de vloer");
  const plaat = r.plates[0];
  assert.ok(plaat.extremes.find((x) => x.quantity === "mxxKnmPerM").max > 0, "veldmoment positief");
  // Eigen gewicht: plaat (ρ·g·t·A) + staven, allemaal in −Z.
  const eg = withOpenFem3DSelfWeight(model, 1);
  const egRequest = { ...buildOpenFem3DSolveRequest(eg, "linear", 1, mesh), bucklingModes: 0 };
  const egR = await reken(egRequest);
  const plaatGewicht = 2500 * 9.81 * 0.2 * 30 / 1000;
  // Het eigen gewicht van de staven is een globale Z-last per staafmeter (#112).
  assert.ok(eg.memberLoads.every((l) => l.globalDirection === "z" && !l.perProjection), "eigen gewicht van de staven als globale Z-last");
  const staafGewicht = eg.memberLoads.reduce((s, l) => s + (-l.qStart - l.qEnd) / 2 * (l.endPositionM - l.startPositionM), 0)
    + eg.loads.reduce((s, l) => s - l.fz, 0);
  const somEg = egR.reactions.reduce((s, x) => s + x.fz, 0);
  assert.ok(Math.abs(somEg - plaatGewicht - staafGewicht) < 1e-6 * somEg, `eigen gewicht ${somEg} tegen ${plaatGewicht + staafGewicht}`);
  assert.ok(openFem3DGlobalForceBalance(egRequest, egR).ok);
  stil(`  ✓ vloer op randliggers en kolommen: Σ Rz = q·A = 90 kN; eigen gewicht Σ Rz = ${somEg.toFixed(2)} kN ` +
    `(plaat ρ·g·t·A = ${plaatGewicht.toFixed(2)} kN + staven); veldmoment ${plaat.extremes.find((x) => x.quantity === "mxxKnmPerM").max.toFixed(2)} kNm/m`);
  // Tweede orde met platen wordt door de kern expliciet geweigerd.
  await assert.rejects(reken({ ...nuttig, analysis: "p-delta" }), /P-Delta/);
}

console.log = stil;
console.log("3D-platen (net, platen–staven, analytische plaatproeven): geslaagd");

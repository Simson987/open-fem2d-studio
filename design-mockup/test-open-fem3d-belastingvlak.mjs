// Belastingvlakken in 3D: afdracht van een oppervlaktelast naar de liggers.
//
// Alles hier is met de hand na te rekenen:
//  1. éénrichting op evenwijdige liggers: binnenliggers q·s, randliggers q·s/2, Σ = q·A;
//  2. tweerichting, vierkant op vier randliggers: driehoek met piek q·L/2, Σ = q·L²;
//     rechthoek a×b: twee trapezia en twee driehoeken, Σ = q·a·b;
//  3. hellend dakvlak: projectiemodus Σ verticaal = q × horizontale projectie,
//     loodrecht-modus resultante loodrecht op het vlak = q × vlakoppervlak;
//  4. de staalhal 60 × 30 m: twee dakvlakken geven op elke gording precies de
//     lijnlast die test-open-fem3d-staalhal.mjs met de hand invoert;
//  5. plaat omzetten, opslaan/laden en een rekenproef met de 3D-kern
//     (reacties = Σ lasten, onafhankelijke krachten- en momentensom);
//  6. het bedieningskanaal (gui_build_3d_model) met levels: het vlak hangt
//     aan zijn hoekknopen en gaat mee als een level van hoogte verandert.
//
// De proeven met de kern vragen de gebouwde Rust-kern; zet zo nodig
// OPEN_FEM_3D_SOLVER_PATH.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import {
  openFem3DMemberAxes,
  parseOpenFem3DModel,
  removeOpenFem3DBeam,
  removeOpenFem3DLoadPanel,
  removeOpenFem3DNode,
  splitOpenFem3DBeam,
} from "./src/components/openFem3d/openFem3dModel.ts";
import {
  addOpenFem3DLoadPanel,
  analyseOpenFem3DLoadPanel,
  analyseOpenFem3DLoadPanels,
  convertOpenFem3DPlateToLoadPanels,
  duplicateOpenFem3DLoadPanel,
  openFem3DLoadPanelGeometry,
  openFem3DSpanFromNodes,
  updateOpenFem3DLoadPanel,
  withOpenFem3DLoadPanels,
} from "./src/components/openFem3d/openFem3dLoadPanels.ts";
import { buildOpenFem3DSolveRequest, openFem3DGlobalForceBalance } from "./src/components/openFem3d/openFem3dSolver.ts";
import { deserializeProject, serializeProject, PROJECT_FORMAT_VERSION_3D, PROJECT_FORMAT_VERSION_MAX } from "./src/io/projectFile.ts";
import {
  OPEN_FEM_3D_LOAD_CASE_COLORS,
  OPEN_FEM_3D_LOAD_SURFACE_OPACITY,
  openFem3DLoadCaseColor,
  openFem3DLoadPanelSurface,
  openFem3DPickThroughDepth,
  openFem3DSolidIntersections,
  openFem3DSurfaceLoadSurface,
} from "./src/components/openFem3d/openFem3dLoadSurfaces.ts";
import { openFem3DLoadSurfaceObjects } from "./src/components/openFem3d/openFem3dLoadPanelVisuals.ts";

let geslaagd = 0;
const ok = (voorwaarde, melding) => { assert.ok(voorwaarde, melding); geslaagd += 1; };
const gelijk = (berekend, verwacht, melding, tolerantie = 1e-9) => {
  assert.ok(Math.abs(berekend - verwacht) <= tolerantie * Math.max(1, Math.abs(verwacht)),
    `${melding}: verwacht ${verwacht}, berekend ${berekend}`);
  geslaagd += 1;
};
const staaf = (id, startNodeId, endNodeId) => ({ id, startNodeId, endNodeId, profileName: "IPE 200", material: "S235" });
const vast = (nodeId) => ({ nodeId, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true });

/** Σ van alle toegepaste lasten in globale assen, via de onafhankelijke krachtensom van de adapter. */
function somLasten(model, geval) {
  const request = buildOpenFem3DSolveRequest(model, "linear", geval);
  return openFem3DGlobalForceBalance(request, { reactions: [] }).imbalanceKn;
}
/** De afgeleide lijnlast van één staaf als functie van de positie (kN/m, langs de lastrichting). */
function breedteOp(resultaat, beamId, positie) {
  const last = resultaat.beamLoads.find((item) => item.beamId === beamId);
  if (!last) return 0;
  let totaal = 0;
  for (const stuk of last.pieces) {
    if (positie < stuk.startPositionM - 1e-12 || positie > stuk.endPositionM + 1e-12) continue;
    const t = (positie - stuk.startPositionM) / (stuk.endPositionM - stuk.startPositionM);
    totaal = Math.max(totaal, stuk.widthStartM + t * (stuk.widthEndM - stuk.widthStartM));
  }
  return totaal;
}

// ── 1. Éénrichting op evenwijdige liggers ───────────────────────────────────
{
  // Vlak 6 × 10 m op z = 3; liggers langs X op y = 0; 2,5; 5; 7,5; 10 (s = 2,5 m),
  // zijliggers langs Y (evenwijdig aan de overspanning Y) krijgen niets.
  const nodes = [], beams = [];
  const knoop = (i, j) => 1 + j * 2 + i;
  for (let j = 0; j <= 4; j += 1) for (let i = 0; i <= 1; i += 1) nodes.push({ id: knoop(i, j), x: 6 * i, y: 2.5 * j, z: 3 });
  for (let j = 0; j <= 4; j += 1) beams.push(staaf(beams.length + 1, knoop(0, j), knoop(1, j)));
  for (let j = 0; j < 4; j += 1) for (let i = 0; i <= 1; i += 1) beams.push(staaf(beams.length + 1, knoop(i, j), knoop(i, j + 1)));
  let model = parseOpenFem3DModel({ nodes, beams, supports: [vast(knoop(0, 0)), vast(knoop(1, 0)), vast(knoop(0, 4)), vast(knoop(1, 4))] });
  const q = 2;
  model = addOpenFem3DLoadPanel(model, [knoop(0, 0), knoop(1, 0), knoop(1, 4), knoop(0, 4)], {
    q, direction: "gravity", distribution: "oneWay", spanDirection: { x: 0, y: 1, z: 0 }, caseId: 1,
  });
  const resultaat = analyseOpenFem3DLoadPanel(model, model.loadPanels[0]);
  gelijk(resultaat.geometry.areaM2, 60, "éénrichting: oppervlak 6 × 10");
  assert.deepEqual(resultaat.receiverBeamIds, [1, 2, 3, 4, 5], "alleen de liggers dwars op de overspanning dragen");
  assert.deepEqual(resultaat.parallelBeamIds.sort((a, b) => a - b), [6, 7, 8, 9, 10, 11, 12, 13], "zijliggers langs de overspanning");
  for (const beamId of [1, 2, 3, 4, 5]) {
    const last = resultaat.beamLoads.find((item) => item.beamId === beamId);
    const s = beamId === 1 || beamId === 5 ? 1.25 : 2.5;
    assert.equal(last.pieces.length, 1, `ligger ${beamId}: één gelijkmatig stuk`);
    gelijk(last.pieces[0].startPositionM, 0, `ligger ${beamId}: begin`);
    gelijk(last.pieces[0].endPositionM, 6, `ligger ${beamId}: eind`);
    gelijk(last.pieces[0].widthStartM, s, `ligger ${beamId}: belastingbreedte ${s} m`);
    gelijk(last.pieces[0].widthEndM, s, `ligger ${beamId}: belastingbreedte ${s} m (eind)`);
  }
  ok(resultaat.warnings.length === 0, "geen meldingen bij een volledig ondersteund vlak");
  const omgezet = withOpenFem3DLoadPanels(model).model;
  ok(omgezet.loadPanels === undefined, "het rekenmodel draagt geen vlakken meer");
  for (const beamId of [1, 2, 3, 4, 5]) {
    const last = omgezet.memberLoads.find((item) => item.beamId === beamId);
    const s = beamId === 1 || beamId === 5 ? 1.25 : 2.5;
    // Horizontale ligger langs +X: lokale z wijst omhoog, dus neerwaarts negatief.
    gelijk(last.qzStart, -q * s, `ligger ${beamId}: qz = −q·s`);
    gelijk(last.qyStart, 0, `ligger ${beamId}: geen qy`);
    assert.equal(last.caseId, 1);
  }
  const som = somLasten(model, 1);
  gelijk(som[2], -q * 60, "éénrichting: Σ = q·A");
  gelijk(som[0], 0, "éénrichting: geen horizontale som");
  console.log("  ✓ éénrichting: binnenliggers q·s, randliggers q·s/2, Σ = q·A");

  // Twee klikken (knoop naar knoop) geven dezelfde overspanning.
  const klik = openFem3DSpanFromNodes(model, knoop(0, 0), knoop(0, 4));
  assert.deepEqual(klik, { x: 0, y: 10, z: 0 });
  const viaKlik = analyseOpenFem3DLoadPanel(updateOpenFem3DLoadPanel(model, 1, { spanDirection: klik }), { ...model.loadPanels[0], spanDirection: klik });
  gelijk(breedteOp(viaKlik, 3, 3), 2.5, "overspanning uit twee klikken");

  // Rand zonder ligger dwars op de overspanning: de bovenste ligger weg geeft
  // een overstek van 2,5 m naar de ligger op y = 7,5, met een melding.
  const zonderRand = removeOpenFem3DBeam(model, 5);
  const overstek = analyseOpenFem3DLoadPanel(zonderRand, zonderRand.loadPanels[0]);
  gelijk(breedteOp(overstek, 4, 3), 1.25 + 2.5, "overstek naar de dichtstbijzijnde ligger");
  ok(overstek.warnings.some((melding) => /geen ligger dwars op de overspanning/.test(melding) && /overstek/.test(melding)),
    "melding bij een rand zonder ligger");
  gelijk(overstek.assignedAreaM2, 60, "overstek: Σ nog steeds q·A");

  // Een uitgesloten ligger krijgt niets; zijn strook gaat naar de buren.
  const uitgesloten = updateOpenFem3DLoadPanel(model, 1, { excludedBeamIds: [3] });
  const zonder3 = analyseOpenFem3DLoadPanel(uitgesloten, uitgesloten.loadPanels[0]);
  ok(!zonder3.receiverBeamIds.includes(3), "uitgesloten ligger draagt niet");
  gelijk(breedteOp(zonder3, 2, 3), 1.25 + 2.5, "buurligger neemt de halve strook over");
  gelijk(zonder3.assignedAreaM2, 60, "uitsluiten: Σ nog steeds q·A");
  console.log("  ✓ éénrichting: twee klikken, overstek met melding, uitgesloten ligger");
}

// ── 2. Tweerichting: vierkant en rechthoek op vier randliggers ─────────────
function rechthoek(a, b, extra = {}) {
  const nodes = [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: a, y: 0, z: 0 }, { id: 3, x: a, y: b, z: 0 }, { id: 4, x: 0, y: b, z: 0 },
    ...(extra.nodes ?? []),
  ];
  const beams = [staaf(1, 1, 2), staaf(2, 2, 3), staaf(3, 3, 4), staaf(4, 4, 1), ...(extra.beams ?? [])];
  return parseOpenFem3DModel({ nodes, beams, supports: [1, 2, 3, 4].map(vast) });
}
{
  const L = 4, q = 3;
  let model = rechthoek(L, L);
  model = addOpenFem3DLoadPanel(model, [1, 2, 3, 4], { q, direction: "gravity", distribution: "twoWay", caseId: 1 });
  const resultaat = analyseOpenFem3DLoadPanel(model, model.loadPanels[0]);
  for (const beamId of [1, 2, 3, 4]) {
    const last = resultaat.beamLoads.find((item) => item.beamId === beamId);
    assert.equal(last.pieces.length, 2, `ligger ${beamId}: driehoek in twee stukken`);
    gelijk(last.pieces[0].startPositionM, 0, `ligger ${beamId}: driehoek begint op 0`);
    gelijk(last.pieces[0].widthStartM, 0, `ligger ${beamId}: breedte 0 in de hoek`);
    gelijk(last.pieces[0].endPositionM, L / 2, `ligger ${beamId}: top op L/2`);
    gelijk(last.pieces[0].widthEndM, L / 2, `ligger ${beamId}: piekbreedte L/2`);
    gelijk(last.pieces[1].widthEndM, 0, `ligger ${beamId}: breedte 0 in de andere hoek`);
    gelijk(last.areaM2, L * L / 4, `ligger ${beamId}: kwart van het vlak`);
  }
  const omgezet = withOpenFem3DLoadPanels(model).model;
  const piek = omgezet.memberLoads.find((item) => item.beamId === 1 && Math.abs(item.endPositionM - L / 2) < 1e-12);
  gelijk(-piek.qzEnd, q * L / 2, "piek van de driehoek = q·L/2");
  gelijk(somLasten(model, 1)[2], -q * L * L, "vierkant: Σ = q·L²");
  console.log("  ✓ tweerichting vierkant: vier driehoeken met piek q·L/2, Σ = q·L²");
}
{
  const a = 6, b = 4, q = 2.5;
  let model = rechthoek(a, b);
  model = addOpenFem3DLoadPanel(model, [1, 2, 3, 4], { q, direction: "gravity", distribution: "twoWay", caseId: 1 });
  const resultaat = analyseOpenFem3DLoadPanel(model, model.loadPanels[0]);
  for (const beamId of [1, 3]) {
    const last = resultaat.beamLoads.find((item) => item.beamId === beamId);
    assert.deepEqual(last.pieces.map((stuk) => [stuk.startPositionM, stuk.endPositionM]).flat().map((x) => Math.round(x * 1e9) / 1e9),
      [0, 2, 2, 4, 4, 6], `lange ligger ${beamId}: knikken op b/2 en a − b/2`);
    gelijk(breedteOp(resultaat, beamId, 3), b / 2, `lange ligger ${beamId}: vlak deel b/2`);
    gelijk(last.areaM2, (2 * a - b) * b / 4, `lange ligger ${beamId}: trapezium (2a − b)·b/4`);
  }
  for (const beamId of [2, 4]) {
    const last = resultaat.beamLoads.find((item) => item.beamId === beamId);
    gelijk(breedteOp(resultaat, beamId, 2), b / 2, `korte ligger ${beamId}: driehoek met piek b/2`);
    gelijk(last.areaM2, b * b / 4, `korte ligger ${beamId}: driehoek b²/4`);
  }
  gelijk(resultaat.assignedAreaM2, a * b, "rechthoek: Σ oppervlak = a·b");
  gelijk(somLasten(model, 1)[2], -q * a * b, "rechthoek: Σ = q·a·b");
  console.log("  ✓ tweerichting rechthoek: twee trapezia en twee driehoeken, Σ = q·a·b");

  // Tussenligger: twee vierkante velden. De tussenligger krijgt van beide
  // kanten een driehoek; samen een driehoek met piek L.
  const L = 4;
  let gedeeld = parseOpenFem3DModel({
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 2 * L, y: 0, z: 0 }, { id: 3, x: 2 * L, y: L, z: 0 }, { id: 4, x: 0, y: L, z: 0 },
      { id: 5, x: L, y: 0, z: 0 }, { id: 6, x: L, y: L, z: 0 },
    ],
    beams: [staaf(1, 1, 2), staaf(2, 2, 3), staaf(3, 3, 4), staaf(4, 4, 1), staaf(5, 5, 6)],
    supports: [1, 2, 3, 4].map(vast),
  });
  gedeeld = addOpenFem3DLoadPanel(gedeeld, [1, 2, 3, 4], { q: 1, distribution: "twoWay" });
  const velden = analyseOpenFem3DLoadPanel(gedeeld, gedeeld.loadPanels[0]);
  gelijk(breedteOp(velden, 5, L / 2), L, "tussenligger: piek L (twee halve driehoeken)");
  gelijk(breedteOp(velden, 1, L), 0, "onderligger: nul bij de tussenligger");
  gelijk(breedteOp(velden, 1, L / 2), L / 2, "onderligger: eerste driehoek");
  gelijk(breedteOp(velden, 1, 3 * L / 2), L / 2, "onderligger: tweede driehoek");
  gelijk(velden.assignedAreaM2, 2 * L * L, "tussenligger: Σ = q·A");
  ok(velden.warnings.length === 0, "tussenligger: geen meldingen");
  // Sluit de tussenligger uit: dan is het weer één rechthoek 2L × L.
  const zonderTussen = analyseOpenFem3DLoadPanel(
    updateOpenFem3DLoadPanel(gedeeld, 1, { excludedBeamIds: [5] }), { ...gedeeld.loadPanels[0], excludedBeamIds: [5] });
  gelijk(breedteOp(zonderTussen, 1, L), L / 2, "tussenligger uitgesloten: onderligger trapezium");
  console.log("  ✓ tweerichting: tussenligger en uitgesloten ligger");

  // Rand zonder ligger (bovenligger weg): melding en de last naar de
  // dichtstbijzijnde liggers; het totaal blijft q·A.
  const open = removeOpenFem3DBeam(model, 3);
  const zonderBoven = analyseOpenFem3DLoadPanel(open, open.loadPanels[0]);
  ok(zonderBoven.warnings.some((melding) => /Rand (3–4|4–3) .*geen ligger/.test(melding)), "melding bij een rand zonder ligger");
  gelijk(zonderBoven.assignedAreaM2, a * b, "rand zonder ligger: Σ oppervlak = a·b", 1e-6);
  gelijk(somLasten(open, 1)[2], -q * a * b, "rand zonder ligger: Σ = q·a·b", 1e-6);

  // L-vormig vlak op zes randliggers: de inspringende hoek geeft een kromme
  // grens; het totaal sluit toch.
  let lvorm = parseOpenFem3DModel({
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6, y: 3, z: 0 },
      { id: 4, x: 3, y: 3, z: 0 }, { id: 5, x: 3, y: 6, z: 0 }, { id: 6, x: 0, y: 6, z: 0 },
    ],
    beams: [staaf(1, 1, 2), staaf(2, 2, 3), staaf(3, 3, 4), staaf(4, 4, 5), staaf(5, 5, 6), staaf(6, 6, 1)],
    supports: [1, 2, 3, 5, 6].map(vast),
  });
  lvorm = addOpenFem3DLoadPanel(lvorm, [1, 2, 3, 4, 5, 6], { q: 1, distribution: "twoWay", caseId: 1 });
  const hoek = analyseOpenFem3DLoadPanel(lvorm, lvorm.loadPanels[0]);
  gelijk(hoek.geometry.areaM2, 27, "L-vorm: oppervlak 27 m²");
  gelijk(hoek.assignedAreaM2, 27, "L-vorm: Σ afgedragen = oppervlak", 1e-6);
  ok(hoek.pointShares.some((share) => share.nodeId === 4 && share.areaM2 > 0), "L-vorm: gebied rond de inspringende hoek naar knoop 4");
  gelijk(somLasten(lvorm, 1)[2], -27, "L-vorm: Σ = q·A", 1e-6);
  console.log("  ✓ tweerichting: rand zonder ligger en L-vorm sluiten op q·A");
}

// ── 3. Hellend dakvlak: projectie en loodrecht ──────────────────────────────
{
  // Vlak van (0,0,0)–(6,0,0) naar (6,4,2)–(0,4,2): helling 2 op 4.
  const nodes = [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6, y: 4, z: 2 }, { id: 4, x: 0, y: 4, z: 2 },
  ];
  const beams = [staaf(1, 1, 2), staaf(2, 2, 3), staaf(3, 3, 4), staaf(4, 4, 1)];
  const basis = parseOpenFem3DModel({ nodes, beams, supports: [1, 2, 3, 4].map(vast) });
  const q = 0.8;
  const ware = 6 * Math.hypot(4, 2), projectie = 6 * 4;
  const zwaartekracht = addOpenFem3DLoadPanel(basis, [1, 2, 3, 4], { q, direction: "gravity", distribution: "twoWay", caseId: 1 });
  const geometrie = openFem3DLoadPanelGeometry(zwaartekracht, zwaartekracht.loadPanels[0]);
  gelijk(geometrie.areaM2, ware, "hellend: ware oppervlak");
  gelijk(geometrie.projectedAreaM2, projectie, "hellend: horizontale projectie");
  const somZ = somLasten(zwaartekracht, 1);
  gelijk(somZ[2], -q * projectie, "projectiemodus: Σ verticaal = q × horizontale projectie");
  gelijk(somZ[0], 0, "projectiemodus: geen X-component");
  gelijk(somZ[1], 0, "projectiemodus: geen Y-component", 1e-9);
  const zwaar = analyseOpenFem3DLoadPanel(zwaartekracht, zwaartekracht.loadPanels[0]);
  ok(zwaar.notes.some((notitie) => /langs de staafas/.test(notitie)), "hellende randliggers: axiaal deel als knooplast gemeld");

  const loodrecht = addOpenFem3DLoadPanel(basis, [1, 2, 3, 4], { q, direction: "normal", distribution: "twoWay", caseId: 1 });
  const somN = somLasten(loodrecht, 1);
  const n = openFem3DLoadPanelGeometry(loodrecht, loodrecht.loadPanels[0]).normal;
  gelijk(Math.hypot(...somN), q * ware, "loodrecht: |resultante| = q × vlakoppervlak");
  const cos = (somN[0] * n[0] + somN[1] * n[1] + somN[2] * n[2]) / Math.hypot(...somN);
  gelijk(cos, 1, "loodrecht: resultante langs de vlaknormaal");
  ok(n[2] < 0, "de vaste normaal wijst naar beneden");
  // De normaal hangt niet af van de klikvolgorde.
  const omgekeerd = addOpenFem3DLoadPanel(basis, [4, 3, 2, 1], { q, direction: "normal", distribution: "twoWay" });
  const afgerond = (vector) => vector.map((x) => Math.round(x * 1e12) / 1e12 + 0);
  assert.deepEqual(afgerond(openFem3DLoadPanelGeometry(omgekeerd, omgekeerd.loadPanels[0]).normal), afgerond(n),
    "normaal onafhankelijk van de hoekvolgorde");
  console.log("  ✓ hellend dakvlak: projectie q·A_proj verticaal, loodrecht q·A langs n");

  // Een verticaal vlak kan geen last per horizontale projectie dragen.
  const wand = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }, { id: 3, x: 4, y: 0, z: 3 }, { id: 4, x: 0, y: 0, z: 3 }],
    beams: [staaf(1, 1, 2), staaf(2, 2, 3), staaf(3, 3, 4), staaf(4, 4, 1)],
  });
  assert.throws(() => addOpenFem3DLoadPanel(wand, [1, 2, 3, 4], { direction: "gravity" }), /staat verticaal/);
  const windwand = addOpenFem3DLoadPanel(wand, [1, 2, 3, 4], { q: 0.6, direction: "normal", distribution: "twoWay" });
  const wandN = openFem3DLoadPanelGeometry(windwand, windwand.loadPanels[0]).normal;
  assert.deepEqual(wandN.map((x) => Math.round(x * 1e12) / 1e12 + 0), [0, -1, 0], "verticale wand in XZ: normaal −Y");
  // Geen enkele ligger in het vlak: weigeren, niet stil negeren.
  const kaal = parseOpenFem3DModel({ nodes: wand.nodes, beams: [] });
  assert.throws(() => analyseOpenFem3DLoadPanel(
    { ...kaal, loadPanels: [{ id: 1, nodeIds: [1, 2, 3, 4], q: 1, direction: "normal", distribution: "twoWay" }] },
    { id: 1, nodeIds: [1, 2, 3, 4], q: 1, direction: "normal", distribution: "twoWay" }), /geen ligger in het vlak/);
  const zonderLigger = { ...kaal, loadPanels: [{ id: 1, nodeIds: [1, 2, 3, 4], q: 1, direction: "normal", distribution: "twoWay" }] };
  assert.equal(analyseOpenFem3DLoadPanels(zonderLigger)[0].error?.includes("geen ligger"), true, "analyse per vlak geeft de fout terug");
  // Overspanning onder 45° op een vlak met alleen randliggers langs X en Z:
  // geen ligger dwars op de overspanning → het rekenen weigert met die reden.
  const schuin = { ...wand, supports: [vast(1), vast(2)], loadPanels: [
    { id: 1, nodeIds: [1, 2, 3, 4], caseId: 1, q: 1, direction: "normal", distribution: "oneWay", spanDirection: { x: 1, y: 0, z: 1 } },
  ] };
  assert.throws(() => buildOpenFem3DSolveRequest(schuin, "linear", 1), /geen ligger dwars op de overspanningsrichting/);
  console.log("  ✓ weigeringen: verticaal vlak in projectiemodus, vlak zonder (dwarse) ligger");
}

// ── 4. Staalhal 60 × 30 m: dakvlakken tegen de handinvoer ──────────────────
{
  const fixture = fileURLToPath(new URL("../docs/verificatie/3d-raamwerk/staalhal-60x30.ifcfem", import.meta.url));
  const hal = deserializeProject(readFileSync(fixture, "utf8")).model3d;
  const knoopOp = (x, y, z) => hal.nodes.find((node) =>
    Math.abs(node.x - x) < 1e-9 && Math.abs(node.y - y) < 1e-9 && Math.abs(node.z - z) < 1e-9).id;
  const hand = hal.memberLoads.filter((load) => load.caseId === 1);
  const gordingen = new Set(hand.map((load) => load.beamId));
  // Zelfde model zonder de handlasten van geval 1, met twee dakvlakken (q = 0,30 kN/m² projectie).
  let model = { ...hal, memberLoads: hal.memberLoads.filter((load) => load.caseId !== 1) };
  for (const [y0, y1] of [[0, 15], [15, 30]]) {
    const z = (y) => y === 15 ? 9.5 : 8;
    model = addOpenFem3DLoadPanel(model, [knoopOp(0, y0, z(y0)), knoopOp(60, y0, z(y0)), knoopOp(60, y1, z(y1)), knoopOp(0, y1, z(y1))], {
      q: 0.3, direction: "gravity", distribution: "oneWay", spanDirection: { x: 0, y: 1, z: 0 }, caseId: 1,
    });
  }
  const analyses = analyseOpenFem3DLoadPanels(model);
  ok(analyses.every((analysis) => analysis.result), "beide dakvlakken dragen af");
  const dragers = new Set(analyses.flatMap((analysis) => analysis.result.receiverBeamIds));
  assert.deepEqual([...dragers].sort((a, b) => a - b), [...gordingen].sort((a, b) => a - b),
    "alleen de gordingen dragen; spantbenen (langs) en dakverbanden (schuin) niet");
  // Dakverbanden: 2 eindvakken × 6 velden × 2 diagonalen per dakhelft.
  for (const analysis of analyses) {
    assert.equal(analysis.result.skewBeamIds.length, 24, "24 dakverbanden per dakvlak als schuin gemeld");
    ok(analysis.result.skewBeamIds.every((beamId) => model.beams.find((beam) => beam.id === beamId).profileName === "CHS 88.9x4"),
      "de schuine staven zijn precies de verbanden");
  }
  const omgezet = withOpenFem3DLoadPanels(model).model;
  const afgeleid = new Map();
  for (const load of omgezet.memberLoads.filter((item) => item.caseId === 1)) {
    afgeleid.set(load.beamId, (afgeleid.get(load.beamId) ?? 0) + (load.qzStart + load.qzEnd) / 2 * (load.endPositionM - load.startPositionM));
    gelijk(load.qzStart, load.qzEnd, `gording ${load.beamId}: gelijkmatig`);
  }
  for (const load of hand) {
    const totaal = load.qzStart * (load.endPositionM - load.startPositionM);
    gelijk(afgeleid.get(load.beamId), totaal, `gording ${load.beamId}: afgeleid = handinvoer (${load.qzStart} kN/m)`);
  }
  gelijk(somLasten(model, 1)[2], -540, "staalhal G: Σ = 0,30 × 1800 = 540 kN");
  console.log(`  ✓ staalhal: ${hand.length} gordingen krijgen exact de handlast; Σ = 540 kN`);
}

// ── 5. Plaat omzetten, bewerken, opslaan en laden ───────────────────────────
const vloer = (() => {
  // Vloer 8 × 5 m op 3 m hoogte op vier kolommen, randliggers en een middenligger.
  const nodes = [
    { id: 1, x: 0, y: 0, z: 3 }, { id: 2, x: 8, y: 0, z: 3 }, { id: 3, x: 8, y: 5, z: 3 }, { id: 4, x: 0, y: 5, z: 3 },
    { id: 5, x: 4, y: 0, z: 3 }, { id: 6, x: 4, y: 5, z: 3 },
    { id: 11, x: 0, y: 0, z: 0 }, { id: 12, x: 8, y: 0, z: 0 }, { id: 13, x: 8, y: 5, z: 0 }, { id: 14, x: 0, y: 5, z: 0 },
  ];
  const beams = [
    staaf(1, 1, 5), staaf(2, 5, 2), staaf(3, 2, 3), staaf(4, 3, 6), staaf(5, 6, 4), staaf(6, 4, 1), staaf(7, 5, 6),
    { ...staaf(8, 11, 1), profileName: "HEA 200" }, { ...staaf(9, 12, 2), profileName: "HEA 200" },
    { ...staaf(10, 13, 3), profileName: "HEA 200" }, { ...staaf(11, 14, 4), profileName: "HEA 200" },
  ];
  return parseOpenFem3DModel({
    nodes, beams, supports: [11, 12, 13, 14].map(vast),
    plates: [{ id: 1, nodeIds: [1, 5, 2, 3, 6, 4], thicknessM: 0.2, material: "C30/37" }],
    surfaceLoads: [{ id: 1, plateId: 1, caseId: 2, qx: 0, qy: 0, qz: -5 }],
  });
})();
{
  // Platen rekenen sinds de plaatkoppeling mee; het verzoek vraagt dan eerst
  // om het rekennet (de app maakt dat vooraf, zie solveWithPlates).
  assert.throws(() => buildOpenFem3DSolveRequest(vloer, "linear", 2), /plaatnet/, "een plaat vraagt eerst een rekennet");
  const { model, panelIds } = convertOpenFem3DPlateToLoadPanels(vloer, 1, { caseId: 1 });
  assert.equal(model.plates.length, 0, "de plaat is weg");
  assert.equal(model.surfaceLoads.length, 0, "de oppervlaktebelasting is weg");
  assert.deepEqual(panelIds, [1]);
  assert.deepEqual(model.loadPanels, [{ id: 1, nodeIds: [1, 5, 2, 3, 6, 4], caseId: 2, q: 5, direction: "gravity", distribution: "twoWay" }],
    "qz = −5 kN/m² per m² plaat wordt q = 5 kN/m² zwaartekracht (horizontaal vlak)");
  const zonderLast = convertOpenFem3DPlateToLoadPanels({ ...vloer, surfaceLoads: [] }, 1, { caseId: 3 });
  assert.deepEqual(zonderLast.model.loadPanels[0], { id: 1, nodeIds: [1, 5, 2, 3, 6, 4], caseId: 3, q: 1, direction: "gravity", distribution: "twoWay" },
    "zonder oppervlaktelast: één vlak met q = 1 kN/m² in het gekozen geval");
  assert.throws(() => convertOpenFem3DPlateToLoadPanels({
    ...vloer, surfaceLoads: [{ id: 1, plateId: 1, qx: 1, qy: 0, qz: -5 }],
  }, 1), /staat schuin op de plaat/);
  assert.throws(() => convertOpenFem3DPlateToLoadPanels(parseOpenFem3DModel({
    ...vloer, plates: [{ ...vloer.plates[0], cornerRadiusM: 0.3 }],
  }), 1), /afgeronde hoeken/);
  console.log("  ✓ plaat → belastingvlak: plaat en oppervlaktelast vervangen, weigert wat niet exact past");

  // Bewerken en de randen van het model.
  const dubbel = duplicateOpenFem3DLoadPanel(model, 1, 4);
  assert.equal(dubbel.panelId, 2);
  assert.equal(dubbel.model.loadPanels[1].caseId, 4, "kopie in een ander belastinggeval");
  const eenrichting = updateOpenFem3DLoadPanel(model, 1, { distribution: "oneWay" });
  assert.deepEqual(eenrichting.loadPanels[0].spanDirection, { x: 1, y: 0, z: 0 }, "éénrichting krijgt een standaardoverspanning");
  assert.throws(() => updateOpenFem3DLoadPanel(model, 1, { q: 0 }), /ongeldige intensiteit/);
  assert.throws(() => parseOpenFem3DModel({ ...model, loadPanels: [{ ...model.loadPanels[0], direction: "schuin" }] }), /onbekende lastrichting/);
  assert.throws(() => parseOpenFem3DModel({ ...model, loadPanels: [{ ...model.loadPanels[0], distribution: "oneWay" }] }), /mist de overspanningsrichting/);
  assert.throws(() => parseOpenFem3DModel({ ...model, loadPanels: [{ ...model.loadPanels[0], excludedBeamIds: [99] }] }), /ontbrekende of dubbele staaf/);
  const metUitsluiting = updateOpenFem3DLoadPanel(model, 1, { excludedBeamIds: [7] });
  const geknipt = splitOpenFem3DBeam(metUitsluiting, 7, 0.5);
  assert.deepEqual(geknipt.model.loadPanels[0].excludedBeamIds, [7, geknipt.secondBeamId], "knippen neemt de uitsluiting mee");
  assert.equal(removeOpenFem3DBeam(metUitsluiting, 7).loadPanels[0].excludedBeamIds, undefined, "verwijderde staaf uit de uitsluiting");
  assert.equal(removeOpenFem3DNode(model, 6).loadPanels.length, 0, "hoekknoop weg: vlak weg");
  assert.equal(removeOpenFem3DLoadPanel(model, 1).loadPanels.length, 0);
  console.log("  ✓ bewerken: kopie per geval, keuring, knippen/verwijderen houden verwijzingen geldig");

  // Projectbestand: oude bestanden blijven leesbaar, een vlak gaat heen en terug.
  const project = (model3d) => ({
    nodes: [], beams: [], supports: [], plates: [], loads: [], loadCases: [{ id: 1, name: "G", type: "dead" }],
    modelDimension: "3d", model3d,
  });
  const tekst = serializeProject(project(model));
  const terug = deserializeProject(tekst);
  assert.deepEqual(terug.model3d, model, "belastingvlak overleeft opslaan en laden");
  assert.equal(terug.version, PROJECT_FORMAT_VERSION_3D + 1, "een bestand met belastingvlakken krijgt versie 4");
  const oud = deserializeProject(serializeProject(project(vloer)));
  assert.equal(oud.version, PROJECT_FORMAT_VERSION_3D, "zonder belastingvlakken blijft het versie 3");
  assert.equal(oud.model3d.loadPanels, undefined, "een oud bestand krijgt er geen lijst bij");
  // Een versie boven de hoogste leesbare (sinds de bedding van #106 is dat 5) wordt geweigerd.
  assert.throws(() => deserializeProject(JSON.stringify({ ...JSON.parse(tekst), version: PROJECT_FORMAT_VERSION_MAX + 1 })), /nieuwere versie/);
  console.log("  ✓ projectbestand: versie 4 met vlakken, versie 3 zonder, oude bestanden leesbaar");
}

// ── 6. Rekenproef met de 3D-kern ────────────────────────────────────────────
{
  const solverBinary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
  const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH
    ?? fileURLToPath(new URL(`../src-tauri/target/debug/${solverBinary}`, import.meta.url));
  assert.ok(existsSync(solverPath), `Bouw eerst de Rust-rekenkern (${solverPath}) of zet OPEN_FEM_3D_SOLVER_PATH.`);
  const reken = (request) => new Promise((resolve, reject) => {
    const child = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] });
    const uit = [], fout = [];
    child.stdout.on("data", (d) => uit.push(d));
    child.stderr.on("data", (d) => fout.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`3D-kern: exit ${code}; ${Buffer.concat(fout).toString().slice(0, 400)}`));
      try { resolve(JSON.parse(Buffer.concat(uit).toString())); } catch (e) { reject(e); }
    });
    child.stdin.end(JSON.stringify(request));
  });
  let model = convertOpenFem3DPlateToLoadPanels(vloer, 1).model;
  // Plus een windvlak loodrecht op de langsgevel (y = 0), in een eigen geval.
  model = addOpenFem3DLoadPanel(model, [11, 12, 2, 5, 1], { q: 0.7, direction: "normal", distribution: "twoWay", caseId: 3 });
  for (const [geval, verwacht] of [[2, [0, 0, -5 * 40]], [3, [0, -0.7 * 24, 0]]]) {
    const request = { ...buildOpenFem3DSolveRequest(model, "linear", geval), bucklingModes: 0 };
    const resultaat = await reken(request);
    const reactie = [0, 1, 2].map((as) => resultaat.reactions.reduce((som, r) => som + [r.fx, r.fy, r.fz][as], 0));
    for (const as of [0, 1, 2]) gelijk(-reactie[as], verwacht[as], `geval ${geval}: Σ reactie ${"xyz"[as]} = −Σ last`, 1e-6);
    const balans = openFem3DGlobalForceBalance(request, resultaat);
    ok(balans.ok, `geval ${geval}: onafhankelijke krachten- en momentensom sluit (${balans.maxImbalanceKn} kN, ${balans.maxMomentImbalanceKnm} kNm)`);
  }
  // De windwand staat in XZ; de kolommen 8 en 9 zijn randligger (verticaal) en
  // de vloerliggers 1 en 2 bovenrand; de onderrand heeft geen ligger → melding.
  const wind = analyseOpenFem3DLoadPanel(model, model.loadPanels[1]);
  ok(wind.warnings.some((melding) => /Rand (11–12|12–11) .*geen ligger/.test(melding)), "windwand: onderrand zonder ligger gemeld");
  console.log("  ✓ 3D-kern: reacties = Σ lasten (vloer 200 kN, wind 16,8 kN), evenwicht onafhankelijk bevestigd");
}

// ── 7. Lastvlakken in het tekenvlak ─────────────────────────────────────────
{
  const bron = (pad) => readFileSync(fileURLToPath(new URL(pad, import.meta.url)), "utf8");
  const oppervlak = (positions) => {
    let som = 0;
    for (let k = 0; k + 8 < positions.length; k += 9) {
      const u = [positions[k + 3] - positions[k], positions[k + 4] - positions[k + 1], positions[k + 5] - positions[k + 2]];
      const v = [positions[k + 6] - positions[k], positions[k + 7] - positions[k + 1], positions[k + 8] - positions[k + 2]];
      som += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
    }
    return som;
  };
  // Belastingvlak: de vulling is precies de veelhoek over de hoekknopen.
  let rechthoekig = rechthoek(6, 4);
  rechthoekig = addOpenFem3DLoadPanel(rechthoekig, [1, 2, 3, 4], { q: 1, distribution: "twoWay" });
  const vulling = openFem3DLoadPanelSurface(rechthoekig, rechthoekig.loadPanels[0]);
  gelijk(vulling.areaM2, 24, "vulling belastingvlak = 6 × 4 m²");
  gelijk(oppervlak(vulling.positions), 24, "driehoeken van de vulling samen 24 m²");
  ok(vulling.positions.every((waarde, index) => index % 3 !== 2 || Math.abs(waarde) < 1e-12), "vulling ligt in het vlak z = 0");
  assert.equal(vulling.outlines.length, 1);
  assert.equal(vulling.outlines[0].length, 4, "omtrek over de vier hoeken");
  // Niet-convex (L-vorm) en hellend: de vulling volgt het werkelijke vlak.
  let lvorm = parseOpenFem3DModel({
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6, y: 3, z: 0 },
      { id: 4, x: 3, y: 3, z: 0 }, { id: 5, x: 3, y: 6, z: 0 }, { id: 6, x: 0, y: 6, z: 0 },
    ],
    beams: [staaf(1, 1, 2), staaf(2, 2, 3), staaf(3, 3, 4), staaf(4, 4, 5), staaf(5, 5, 6), staaf(6, 6, 1)],
  });
  lvorm = addOpenFem3DLoadPanel(lvorm, [1, 2, 3, 4, 5, 6], { q: 1 });
  gelijk(openFem3DLoadPanelSurface(lvorm, lvorm.loadPanels[0]).areaM2, 27, "vulling L-vorm = 27 m² (inspringende hoek niet gevuld)");
  let hellend = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6, y: 4, z: 2 }, { id: 4, x: 0, y: 4, z: 2 }],
    beams: [staaf(1, 1, 2), staaf(2, 2, 3), staaf(3, 3, 4), staaf(4, 4, 1)],
  });
  hellend = addOpenFem3DLoadPanel(hellend, [1, 2, 3, 4], { q: 1 });
  gelijk(openFem3DLoadPanelSurface(hellend, hellend.loadPanels[0]).areaM2, 6 * Math.hypot(4, 2), "vulling hellend vlak = ware oppervlak");
  // Een scheef getrokken vlak krijgt geen vulling (alleen een rode omtrek).
  const scheef = { ...hellend, nodes: hellend.nodes.map((node) => node.id === 3 ? { ...node, z: 2.5 } : node) };
  assert.equal(openFem3DLoadPanelSurface(scheef, scheef.loadPanels[0]), null, "geen vulling voor een niet-vlak belastingvlak");

  // Oppervlaktelast op een plaat met opening: plaatomtrek min opening, net
  // buiten de plaat aan de kant waar de last aangrijpt.
  const plaatModel = parseOpenFem3DModel({
    nodes: [
      { id: 1, x: 0, y: 0, z: 3 }, { id: 2, x: 6, y: 0, z: 3 }, { id: 3, x: 6, y: 4, z: 3 }, { id: 4, x: 0, y: 4, z: 3 },
      { id: 5, x: 2, y: 1, z: 3 }, { id: 6, x: 3, y: 1, z: 3 }, { id: 7, x: 3, y: 2, z: 3 }, { id: 8, x: 2, y: 2, z: 3 },
    ],
    beams: [],
    plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2, material: "C30/37", openings: [{ id: 1, nodeIds: [5, 6, 7, 8] }] }],
    surfaceLoads: [{ id: 1, plateId: 1, qx: 0, qy: 0, qz: -5 }],
  });
  const omlaag = openFem3DSurfaceLoadSurface(plaatModel, plaatModel.plates[0], { qx: 0, qy: 0, qz: -5 });
  gelijk(omlaag.areaM2, 24 - 1, "vulling oppervlaktelast = plaat 24 m² min opening 1 m²");
  assert.equal(omlaag.outlines.length, 2, "omtrek van de plaat en van de opening");
  const hoogtes = omlaag.positions.filter((_, index) => index % 3 === 2);
  ok(hoogtes.every((z) => z > 3 + 0.1), "neerwaartse last: vulling boven de plaat (boven de bovenzijde)");
  const omhoog = openFem3DSurfaceLoadSurface(plaatModel, plaatModel.plates[0], { qx: 0, qy: 0, qz: 5 });
  ok(omhoog.positions.filter((_, index) => index % 3 === 2).every((z) => z < 3 - 0.1), "opwaartse last: vulling onder de plaat");

  // Kleur per soort geval: dezelfde als de typelabels van de tabbalk.
  const tabbalk = bron("./src/components/fem/LoadCaseTabBar.css");
  for (const [soort, kleur] of Object.entries(OPEN_FEM_3D_LOAD_CASE_COLORS)) {
    const treffer = tabbalk.match(new RegExp(`\\.lc-tab-type-${soort}\\s*\\{\\s*background:\\s*#([0-9a-f]{6})`, "i"));
    ok(treffer && parseInt(treffer[1], 16) === kleur, `kleur ${soort} gelijk aan de tabbalk`);
  }
  assert.equal(openFem3DLoadCaseColor("onbekend"), OPEN_FEM_3D_LOAD_CASE_COLORS.other);
  ok(OPEN_FEM_3D_LOAD_SURFACE_OPACITY >= 0.15 && OPEN_FEM_3D_LOAD_SURFACE_OPACITY <= 0.25, "licht doorzichtig (0,15–0,25)");

  // De Three-objecten: dubbelzijdig, doorzichtig, klikken gaat erdoorheen.
  const [vlak, rand] = openFem3DLoadSurfaceObjects(vulling, OPEN_FEM_3D_LOAD_CASE_COLORS.live, { type: "loadPanel", id: 1 });
  ok(vlak.material.transparent && vlak.material.opacity === OPEN_FEM_3D_LOAD_SURFACE_OPACITY, "vulling doorzichtig");
  ok(vlak.material.side === 2 /* THREE.DoubleSide */, "vulling dubbelzijdig");
  ok(vlak.material.depthWrite === false, "vulling schrijft geen diepte (staven erachter blijven zichtbaar)");
  ok(vlak.userData.pickThrough === true && vlak.userData.type === "loadPanel", "vulling laat klikken door");
  ok(rand.userData.pickable === false, "omtrek is niet klikbaar");

  // Bronteksttoetsen op het tekenvlak: klikken gaat door lastvlakken heen en
  // de vlakken zijn alleen zichtbaar met lasten aan, in het actieve geval.
  // De klikregel zelf, los van het tekenvlak: wat telt er naast een lastvlak?
  const treffer = (soort, afstand, doorlaatbaar = false) => ({ distance: afstand, object: { userData: { type: soort, ...(doorlaatbaar ? { pickThrough: true } : {}) } } });
  const diepte = openFem3DPickThroughDepth(14);
  gelijk(diepte, 0.5, "klikdiepte bij een klein model 0,5 m");
  gelijk(openFem3DPickThroughDepth(70), 1.4, "klikdiepte bij een groot model 2 %");
  const vlak21 = treffer("loadPanel", 21, true);
  assert.deepEqual(openFem3DSolidIntersections([vlak21, treffer("beam", 27)], diepte), [],
    "een kolom ver achter het vlak steelt de klik niet: het vlak wordt gekozen");
  assert.deepEqual(openFem3DSolidIntersections([treffer("beam", 20.9), vlak21], diepte).map((t) => t.object.userData.type), ["beam"],
    "een profiel dat boven het vlak uitsteekt, wint");
  assert.deepEqual(openFem3DSolidIntersections([vlak21, treffer("beam", 21.03)], diepte).map((t) => t.object.userData.type), ["beam"],
    "een dunne staaf in het vlak wint, ook net achter de vulling");
  assert.deepEqual(openFem3DSolidIntersections([treffer("surfaceLoad", 10, true), treffer("plate", 10.12)], diepte).map((t) => t.object.userData.type), ["plate"],
    "de plaat onder een oppervlaktelast blijft aanklikbaar");
  assert.deepEqual(openFem3DSolidIntersections([treffer("beam", 5), treffer("node", 6)], diepte).length, 2, "zonder lastvlak verandert er niets");
  // Een lastpijl steekt boven het vlak uit: het venster begint bij de vulling,
  // niet bij de pijl. Zo wint de middenligger onder de middelste pijl.
  const pijl = (afstand) => ({ distance: afstand, object: { userData: { type: "loadPanel", pickThrough: true } } });
  const vulling21 = { distance: 21, object: { userData: { type: "loadPanel", pickThrough: true, openFem3dLoadSurface: true } } };
  assert.deepEqual(openFem3DSolidIntersections([pijl(19.9), vulling21, treffer("beam", 20.97)], diepte).map((t) => t.object.userData.type), ["beam"],
    "een ligger onder een lastpijl blijft aanklikbaar");
  assert.deepEqual(openFem3DSolidIntersections([pijl(19.9), vulling21, treffer("plate", 24)], diepte), [],
    "ook met een pijl ervoor steelt een vloer ver onder het vlak de klik niet");
  assert.deepEqual(openFem3DSolidIntersections([pijl(12), treffer("beam", 30)], diepte), [],
    "alleen een pijl geraakt: het venster begint bij de pijl");
  ok(/arrow\.traverse\(\(child\) => \{ child\.userData = \{ type: "loadPanel", id: panel\.id, pickThrough: true \}; \}\)/
    .test(bron("./src/components/openFem3d/openFem3dLoadPanelVisuals.ts")), "de lastpijlen van een belastingvlak laten de klik door");
  const canvas = bron("./src/components/openFem3d/ThreeFrameCanvas.tsx");
  ok(/const throughDepth = openFem3DPickThroughDepth\(/.test(canvas)
    && /const solidIntersections = openFem3DSolidIntersections\(intersections, throughDepth\);/.test(canvas)
    && /for \(const candidate of solidIntersections\)/.test(canvas),
    "het tekenvlak gebruikt deze klikregel voor de treffers per soort");
  ok(/for \(const candidate of solidIntersections\) \{[\s\S]{0,300}loadHit = \{/.test(canvas), "een last wint alleen als vaste treffer");
  ok(/const throughPick = !pick && throughHit \? identity\(throughHit\) : null;/.test(canvas)
    && /const type = pick\?\.type \?\? throughPick\?\.type;/.test(canvas),
    "het lastvlak zelf alleen als er verder niets onder de muis ligt");
  // De afstand van de knoop meet zoals de raycast (perspectief: vanaf het
  // oogpunt; parallel: langs de kijkrichting), zie openFem3dProjectie.ts.
  ok(/const hitNodeDistance = hitNode \? openFem3DCameraAfstand\(camera, hitNode\) : Number\.POSITIVE_INFINITY;/.test(canvas)
    && /node: nodeHit && hitNode\s*&& hitNodeDistance <= throughLimitM/.test(canvas)
    && /lineBeam: beamScreenHit && beamScreenHit\.distance <= throughLimitM/.test(canvas),
    "ook een knoop of systeemlijn ver achter het lastvlak steelt de klik niet");
  ok(/if \(!visibility\.loads \|\| !visibility\.loadPanels\) return;/.test(canvas), "belastingvlakken alleen met lasten zichtbaar");
  ok(/const addSurfaceLoadMarkers[\s\S]{0,400}if \(!visibility\.loads\) return;[\s\S]{0,300}openFem3DLoadCaseId\(load\) === activeLoadCaseId/.test(canvas),
    "oppervlaktelastvlakken alleen met lasten zichtbaar en in het actieve geval");
  ok(/openFem3DSurfaceLoadSurface\(model, plate, load/.test(canvas), "oppervlaktelast krijgt een gevuld vlak");
  console.log("  ✓ tekenvlak: licht doorzichtige vlakken voor belastingvlak en oppervlaktelast, klik gaat erdoorheen");
}

// ── 8. Bedieningskanaal: gui_build_3d_model met load_panels en levels ──────
{
  // De bediening haalt via de app React-onderdelen met stylesheets binnen;
  // Node kent die niet. Een lege module volstaat (zoals test-open-fem3d-levels.mjs).
  register(
    "data:text/javascript," +
      encodeURIComponent(
        "export async function load(url, ctx, next) {" +
          " if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };" +
          " return next(url, ctx); }",
      ),
  );
  const { voerUit } = await import("./src/bediening/bediening.ts");
  const { applyOpenFem3DLevels } = await import("./src/components/openFem3d/openFem3dLevels.ts");
  /** Nagebootste app, zoals test-open-fem3d-levels.mjs: levels volgen App.tsx (applyOpenFem3DLevels). */
  const acties = () => ({
    fem: { nodes: [], beams: [], loads: [], loadCases: [], combinations: [], combinationResults: null },
    modelDimension: "3d",
    openFem3d: {
      model: { nodes: [], beams: [] },
      visibility: { nodes: true, beams: true, structuralGrid: true },
      structuralGrid: { enabled: true, xAxes: [], yAxes: [], zAxes: [] },
      replaceModel(model, levels) {
        this.model = model;
        if (levels) this.structuralGrid = { ...this.structuralGrid, zAxes: levels };
      },
      setStructuralGrid(grid) {
        const r = applyOpenFem3DLevels(this.model, grid.zAxes);
        if (!r.ok) throw new Error(`geweigerd: ${r.refusal.kind}`);
        this.model = r.model;
        this.structuralGrid = grid;
      },
      setVisibility() {}, setView() {}, setSelection() {},
    },
    setActiveView() {},
  });
  const voer = async (naam, args, a) => {
    try {
      return await voerUit(naam, args, { current: a }, () => new Promise(() => {}), () => Promise.resolve());
    } catch (fout) {
      return { fout: fout instanceof Error ? fout.message : String(fout) };
    }
  };
  // Vak 6 × 4 m: vier kolommen van Peil 0 naar het Dak (3 m), vier randliggers,
  // één belastingvlak q = 2 kN/m² in twee richtingen.
  const bouw = {
    levels: [{ label: "Peil 0", position_m: 0 }, { label: "Dak", position_m: 3 }],
    nodes: [
      { x: 0, y: 0, z: 0, level: 1 }, { x: 6, y: 0, z: 0, level: 1 }, { x: 6, y: 4, z: 0, level: 1 }, { x: 0, y: 4, z: 0, level: 1 },
      { x: 0, y: 0, z: 3, level: 2 }, { x: 6, y: 0, z: 3, level: 2 }, { x: 6, y: 4, z: 3, level: 2 }, { x: 0, y: 4, z: 3, level: 2 },
    ],
    beams: [
      { from: 1, to: 5 }, { from: 2, to: 6 }, { from: 3, to: 7 }, { from: 4, to: 8 },
      { from: 5, to: 6 }, { from: 6, to: 7 }, { from: 7, to: 8 }, { from: 8, to: 5 },
    ].map((beam) => ({ ...beam, profile_name: "HEA 200", material: "S235" })),
    supports: [1, 2, 3, 4].map((node) => ({ node, type: "fixed" })),
    load_panels: [{ nodes: [5, 6, 7, 8], q: 2, direction: "gravity", distribution: "twoWay", case_id: 1 }],
  };
  const a = acties();
  const u = await voer("model_3d_bouwen", bouw, a);
  ok(!u.fout, `gui_build_3d_model met load_panels: ${u.fout}`);
  assert.deepEqual(u.loadPanelIds, [1]);
  assert.deepEqual(u.belastingvlakken.map((item) => ({ ...item, dragendeStaven: [...item.dragendeStaven].sort((x, y) => x - y) })),
    [{ id: 1, dragendeStaven: [5, 6, 7, 8], meldingen: [] }], "per vlak de dragende staven, zonder melding");
  const vlak = a.openFem3d.model.loadPanels[0];
  assert.deepEqual({ q: vlak.q, direction: vlak.direction, distribution: vlak.distribution, caseId: vlak.caseId },
    { q: 2, direction: "gravity", distribution: "twoWay", caseId: 1 }, "vlak zoals opgegeven");
  gelijk(somLasten(a.openFem3d.model, 1)[2], -2 * 24, "Σ = q·A = 48 kN");
  const dak = a.openFem3d.structuralGrid.zAxes[1].id;
  ok(a.openFem3d.model.nodes.filter((knoop) => vlak.nodeIds.includes(knoop.id)).every((knoop) => knoop.levelId === dak),
    "hoekknopen hangen aan het Dak");
  // Het Dak naar 3,5 m: de hoekknopen, dus het vlak, gaan mee; de afdracht blijft q·A.
  const v = await voer("weergave_3d_configureren", {
    structural_grid: { z_levels: [{ label: "Peil 0", position_m: 0 }, { label: "Dak", position_m: 3.5 }] },
  }, a);
  ok(!v.fout, `Dak naar 3,5 m: ${v.fout}`);
  ok(a.openFem3d.model.nodes.filter((knoop) => vlak.nodeIds.includes(knoop.id)).every((knoop) => knoop.z === 3.5),
    "hoekknopen op 3,5 m");
  gelijk(openFem3DLoadPanelGeometry(a.openFem3d.model, a.openFem3d.model.loadPanels[0]).centroid[2], 3.5,
    "het vlak ligt nu op 3,5 m");
  gelijk(somLasten(a.openFem3d.model, 1)[2], -2 * 24, "Σ na de levelwijziging nog steeds 48 kN");
  // Geen stille standaardwaarden: zonder q of met een onbekende lastrichting weigert de bouw.
  const zonderQ = await voer("model_3d_bouwen",
    { ...bouw, load_panels: [{ nodes: [5, 6, 7, 8], direction: "gravity", distribution: "twoWay" }] }, acties());
  ok(zonderQ.fout && /intensiteit q/.test(zonderQ.fout), `zonder q geweigerd: ${zonderQ.fout}`);
  const tikfout = await voer("model_3d_bouwen",
    { ...bouw, load_panels: [{ nodes: [5, 6, 7, 8], q: 2, direction: "down", distribution: "twoWay" }] }, acties());
  ok(tikfout.fout && /lastrichting/.test(tikfout.fout), `onbekende lastrichting geweigerd: ${tikfout.fout}`);
  console.log("  ✓ bedieningskanaal: load_panels met levels, vlak gaat mee met het level, geen stille standaardwaarden");
}

console.log(`\n${geslaagd} geslaagd, 0 gefaald`);

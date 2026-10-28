// Knopen samenvoegen in 3D (issue #75). Knopen die binnen de
// verbindingstolerantie samenvallen, worden één knoop (de laagste id blijft);
// alles wat ernaar verwijst gaat mee.
//
//  [1] de hoek van twee platen en een staaf: twee platen die apart getekend
//      zijn en een kolomkop er net naast worden één hoek, met de getekende
//      rand en de randoplegging; transitief binnen de groep;
//  [2] een staaf die lengte 0 krijgt verdwijnt met haar lasten; een staaf
//      die omhangt houdt haar lasten over de volle lengte (posities schalen);
//  [3] een dubbele staaf in dezelfde en in omgekeerde richting: één staaf,
//      met alle lasten (lokaal, globaal, punt, temperatuur), gespiegeld en
//      met het teken zoals de lokale assen het vragen; de last in het
//      wereldstelsel is na het samenvoegen dezelfde; scharnieren aan de
//      juiste einden; verschillen in profiel, oriëntatie, scharnieren,
//      toetsinstellingen of uitsluiting in een belastingvlak → geweigerd;
//  [4] opleggingen: OR, veer en blokkering (de blokkering wint, met een
//      notitie), twee veren of twee opgelegde waarden → geweigerd;
//  [5] platen, openingen en belastingvlakken: een hoek minder, te weinig
//      hoeken, niet meer vlak, een ontaarde boog, een randoplegging op een rand
//      van lengte 0;
//  [6] schijven en levels;
//  [7] de groep: breder dan 2 × de tolerantie geweigerd, de laagste id blijft
//      (automatisch: de dichtstbijzijnde bestaande knoop), het bereik, de
//      tolerantie;
//  [8] automatisch na een bewerking (tekenen, kopiëren, verplaatsen, een
//      plaatcontour die sluit), vóór het aansluiten op staven, één stap
//      ongedaan maken; alleen wat de bewerking raakte: een punt tussen twee
//      bestaande knopen gaat op in één ervan, de andere blijft; niets bij de
//      schakelaar uit, een lastwijziging of het openen van een project
//      (vervangen in de historie); de selectie na een transformatie; een klik
//      op een staaf vlak bij haar eind wordt die eindknoop, geen stompje;
//  [9] de modelcontrole, de knop en de melding (met de tolerantie, levels bij
//      naam);
//  [10] de bedrading: App, editor, tekenvlak, lint, dekking en teksten;
//  [11] grote modellen: de modelcontrole schaalt lineair met het model.
//
// Uitvoeren: npx tsx test-open-fem3d-samenvoegen.mjs   (vanuit design-mockup/)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { parseOpenFem3DModel, openFem3DMemberAxes, addOpenFem3DNode, updateOpenFem3DNode, splitOpenFem3DBeam } =
  await import("./src/components/openFem3d/openFem3dModel.ts");
const {
  OPEN_FEM_3D_MERGE_TOLERANCE_MM, findOpenFem3DCoincidentNodes, mergeOpenFem3DNodes, openFem3DMergeCheck, openFem3DMergeScope,
  openFem3DMergeButton, openFem3DMergeMessage, openFem3DSelectionAfterMerge, openFem3DNodeNearPoint, openFem3DMergeRefusalPart,
  openFem3DBeamEndNear,
} = await import("./src/components/openFem3d/openFem3dSamenvoegen.ts");
const { openFem3DEditWithAutoConnect, autoMergeOpenFem3DEdit, openFem3DSelectionAfterAutoEdit } =
  await import("./src/components/openFem3d/openFem3dAansluiten.ts");
const { transformOpenFem3D } = await import("./src/components/openFem3d/openFem3dTransform.ts");
const { openFem3dHistoryReducer } = await import("./src/components/openFem3d/openFem3dHistory.ts");

const HIER = dirname(fileURLToPath(import.meta.url));
const bron = (...pad) => readFileSync(join(HIER, ...pad), "utf8").replace(/\r\n/g, "\n");
let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => { if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); } };
const dicht = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const json = JSON.stringify;
const fout = (fn) => { try { fn(); return null; } catch (e) { return e instanceof Error ? e.message : String(e); } };
const staaf = (model, id) => model.beams.find((b) => b.id === id);
const knoop = (model, id) => model.nodes.find((n) => n.id === id);
const leeg = { supports: [], loads: [], memberLoads: [], memberPointLoads: [], thermalLoads: [], plates: [], surfaceLoads: [] };
const snap = { knopenAansluiten: true, verbindingsTolerantie: 5 };

/**
 * De verdeelde last in het wereldstelsel (kN/m) van alle lijnlasten op de
 * staven `beamIds` (die langs de globale X-as liggen) op wereld-x `x`: de
 * lokale componenten met de lokale assen van de kern (openFem3DMemberAxes),
 * de globale in hun richting. Zo is te zien dat samenvoegen de last in de
 * wereld niet verandert.
 */
function wereldLast(model, beamIds, x) {
  const som = [0, 0, 0];
  for (const beamId of beamIds) {
    const b = staaf(model, beamId);
    const a = knoop(model, b.startNodeId), e = knoop(model, b.endNodeId);
    const s = Math.abs(x - a.x);
    const { ey, ez } = openFem3DMemberAxes(a, e, b.rollAngleRad ?? 0);
    for (const l of model.memberLoads.filter((m) => m.beamId === beamId)) {
      if (s < l.startPositionM - 1e-12 || s > l.endPositionM + 1e-12) continue;
      const f = (s - l.startPositionM) / (l.endPositionM - l.startPositionM);
      if (l.globalDirection) {
        const q = l.qStart + (l.qEnd - l.qStart) * f;
        som[{ x: 0, y: 1, z: 2 }[l.globalDirection]] += q;
      } else {
        const qy = l.qyStart + (l.qyEnd - l.qyStart) * f, qz = l.qzStart + (l.qzEnd - l.qzStart) * f;
        for (let i = 0; i < 3; i++) som[i] += qy * ey[i] + qz * ez[i];
      }
    }
  }
  return som;
}
/** Puntlasten in het wereldstelsel op staven langs de X-as: [wereld-x, kracht]. */
function wereldPuntlasten(model, beamIds) {
  return beamIds.flatMap((beamId) => {
    const b = staaf(model, beamId);
    const a = knoop(model, b.startNodeId), e = knoop(model, b.endNodeId);
    const { ex, ey, ez } = openFem3DMemberAxes(a, e, b.rollAngleRad ?? 0);
    return model.memberPointLoads.filter((p) => p.beamId === beamId).map((p) => [
      Math.round((a.x + ex[0] * p.positionM) * 1e6) / 1e6,
      [0, 1, 2].map((i) => Math.round((p.py * ey[i] + p.pz * ez[i]) * 1e9) / 1e9 || 0),
    ]);
  }).sort((p, q) => p[0] - q[0]);
}

log("[1] de hoek van twee platen en een staaf");
// Plaat 1 (knopen 1–4) van (0; 0) tot (4; 3); plaat 2 (5–8) apart ernaast
// getekend van (4; 0) tot (8; 3), maar knoop 5 ligt 2 mm en knoop 8 3 mm naast
// de hoeken 2 en 3 van plaat 1. Een kolom (staaf 1, knoop 9 → 10) eronder met
// haar kop 10 op (4,002; 2,998): 2,8 mm van hoek 3 en 5,4 mm van knoop 8,
// dus via hoek 3 in dezelfde groep (transitief).
const tweePlaten = () => parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }, { id: 3, x: 4, y: 3, z: 0 }, { id: 4, x: 0, y: 3, z: 0 },
    { id: 5, x: 4.002, y: 0, z: 0 }, { id: 6, x: 8, y: 0, z: 0 }, { id: 7, x: 8, y: 3, z: 0 }, { id: 8, x: 4, y: 3.003, z: 0 },
    { id: 9, x: 4.002, y: 2.998, z: -3 }, { id: 10, x: 4.002, y: 2.998, z: 0 },
  ],
  beams: [{ id: 1, startNodeId: 9, endNodeId: 10, profileName: "HEA 200", material: "S235" }],
  plates: [
    { id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2 },
    { id: 2, nodeIds: [5, 6, 7, 8], thicknessM: 0.2,
      boundary: [{ kind: "line", startNodeId: 5, endNodeId: 6 }, { kind: "line", startNodeId: 6, endNodeId: 7 },
        { kind: "line", startNodeId: 7, endNodeId: 8 }, { kind: "line", startNodeId: 8, endNodeId: 5 }],
      edgeSupports: [{ edge: 3, ux: false, uy: false, uz: true, rx: false, ry: false, rz: false }] },
  ],
  supports: [{ nodeId: 9, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
  loads: [{ id: 1, nodeId: 10, fx: 0, fy: 0, fz: -20, mx: 0, my: 0, mz: 0 }],
  surfaceLoads: [{ id: 1, plateId: 2, qx: 0, qy: 0, qz: -3 }],
});
{
  const voor = tweePlaten();
  const groepen = findOpenFem3DCoincidentNodes(voor);
  check("twee groepen: {2, 5} en {3, 8, 10} (8 en 10 liggen 5,4 mm uit elkaar, maar elk binnen 5 mm van 3)",
    json(groepen.map((g) => [g.nodeIds, g.keepNodeId])) === json([[[2, 5], 2], [[3, 8, 10], 3]])
    && dicht(groepen[1].spanMm, 5.385, 1e-3) && dicht(groepen[1].distanceMm, 3, 1e-9), json(groepen));
  check("standaardtolerantie 5 mm, gelijk aan 2D en het aansluiten", OPEN_FEM_3D_MERGE_TOLERANCE_MM === 5);
  const r = mergeOpenFem3DNodes(voor);
  const na = r.model;
  check("het verslag: 5 → 2 en 8, 10 → 3; drie knopen weg, niets geweigerd",
    json(r.groups.map((g) => [g.keepNodeId, g.nodeIds])) === json([[2, [5]], [3, [8, 10]]]) && r.nodeCount === 3 && r.refused.length === 0, json(r.groups));
  check("de knopen: 5, 8 en 10 zijn weg; 2 en 3 staan nog op hun plek (de laagste id blijft, verschuift niet)",
    json(na.nodes.map((n) => n.id)) === json([1, 2, 3, 4, 6, 7, 9])
    && json(knoop(na, 2)) === json({ id: 2, x: 4, y: 0, z: 0 }) && json(knoop(na, 3)) === json({ id: 3, x: 4, y: 3, z: 0 }));
  const plaat2 = na.plates.find((p) => p.id === 2);
  check("plaat 2 deelt nu de rand 2–3 met plaat 1: hoeken [2, 6, 7, 3], de getekende rand mee, de randoplegging op dezelfde rand",
    json(plaat2.nodeIds) === json([2, 6, 7, 3])
    && json(plaat2.boundary.map((s) => [s.startNodeId, s.endNodeId])) === json([[2, 6], [6, 7], [7, 3], [3, 2]])
    && json(plaat2.edgeSupports) === json([{ edge: 3, ux: false, uy: false, uz: true, rx: false, ry: false, rz: false }]), json(plaat2));
  check("de kolom hangt aan hoek 3, de knooplast op haar kop ook; plaat 1 en de vlaklast ongewijzigd",
    json([staaf(na, 1).startNodeId, staaf(na, 1).endNodeId]) === json([9, 3]) && na.loads[0].nodeId === 3
    && na.plates[0] === voor.plates[0] && json(na.surfaceLoads) === json(voor.surfaceLoads));
  check("het model opent weer", fout(() => parseOpenFem3DModel(na)) === null, fout(() => parseOpenFem3DModel(na)));
  check("opnieuw samenvoegen: niets te doen, hetzelfde model", mergeOpenFem3DNodes(na).model === na && mergeOpenFem3DNodes(na).groups.length === 0);
  check("met 2 mm tolerantie alleen 2 en 5 (2 mm); 3 en 8 (3 mm) niet",
    json(mergeOpenFem3DNodes(voor, { toleranceMm: 2 }).groups.map((g) => [g.keepNodeId, g.nodeIds])) === json([[2, [5]]]));
  check("de tolerantie wordt begrensd zoals de instelling (0,1–25 mm): 60 mm telt als 25",
    findOpenFem3DCoincidentNodes(parseOpenFem3DModel({ nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0.03, y: 0, z: 0 }], beams: [] }), 60).length === 0);
}

log("\n[2] een staaf van lengte 0 verdwijnt; een omgehangen staaf houdt haar lasten over de volle lengte");
{
  // Staaf 1 van knoop 1 naar 2 (4 mm lang) met een lijn- en een puntlast;
  // staaf 2 van 2 naar 3 (3,996 m) met een last over de volle lengte.
  const m = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0.004, y: 0, z: 0 }, { id: 3, x: 4, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 2, endNodeId: 3 }],
    memberLoads: [
      { id: 1, beamId: 1, qyStart: 0, qyEnd: 0, qzStart: -1, qzEnd: -1, startPositionM: 0, endPositionM: 0.004 },
      { id: 2, beamId: 2, qyStart: 0, qyEnd: 0, qzStart: -2, qzEnd: -4, startPositionM: 0, endPositionM: 3.996 },
      { id: 3, beamId: 2, globalDirection: "z", qStart: -1, qEnd: -1, startPositionM: 1.998, endPositionM: 3.996 },
    ],
    memberPointLoads: [{ id: 1, beamId: 1, py: 0, pz: -5, positionM: 0.002 }, { id: 2, beamId: 2, py: 0, pz: -5, positionM: 1.998 }],
    thermalLoads: [{ id: 1, beamId: 1, deltaTUniformK: 10, deltaTGradientYK: 0, deltaTGradientZK: 0 }],
    loadPanels: [],
  });
  const r = mergeOpenFem3DNodes(m);
  check("staaf 1 (beide einden in de groep) is weg, met haar drie lasten; het verslag noemt het",
    !staaf(r.model, 1) && json(r.removedBeams) === json([{ beamId: 1, loadCount: 3 }])
    && r.model.memberLoads.every((l) => l.beamId !== 1) && r.model.memberPointLoads.every((l) => l.beamId !== 1)
    && r.model.thermalLoads.length === 0, json(r.removedBeams));
  const s2 = staaf(r.model, 2);
  check("staaf 2 hangt nu aan knoop 1 en is 4 m lang", s2.startNodeId === 1 && s2.endNodeId === 3);
  const l2 = r.model.memberLoads.find((l) => l.id === 2), l3 = r.model.memberLoads.find((l) => l.id === 3);
  const p2 = r.model.memberPointLoads.find((l) => l.id === 2);
  check("de lastposities schalen mee: de last over de volle lengte loopt tot 4 m, het midden blijft het midden; intensiteiten gelijk",
    l2.startPositionM === 0 && dicht(l2.endPositionM, 4) && dicht(l3.startPositionM, 2) && dicht(l3.endPositionM, 4) && dicht(p2.positionM, 2)
    && l2.qzStart === -2 && l2.qzEnd === -4, json([l2, l3, p2]));
  check("het model opent weer", fout(() => parseOpenFem3DModel(r.model)) === null, fout(() => parseOpenFem3DModel(r.model)));
}

log("\n[3] dubbele staven: één staaf met alle lasten, ook omgekeerd");
// Staaf 1 van knoop 1 (0; 0) naar 2 (6; 0); staaf 2 ligt erop, in dezelfde
// richting (knoop 3 → 4, 2 mm ernaast) of omgekeerd (4 → 3).
const LIJN_B = [
  { id: 2, beamId: 2, caseId: 1, qyStart: 1, qyEnd: 3, qzStart: -2, qzEnd: -4, startPositionM: 1, endPositionM: 4 },
  { id: 3, beamId: 2, caseId: 2, globalDirection: "z", qStart: -1, qEnd: -3, startPositionM: 0, endPositionM: 6 },
  { id: 4, beamId: 2, caseId: 2, globalDirection: "y", qStart: 2, qEnd: 2, perProjection: true, startPositionM: 3, endPositionM: 6 },
];
const dubbel = ({ omgekeerd = false, extraB = {}, extraA = {}, panels } = {}) => parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 0, y: 0.002, z: 0 }, { id: 4, x: 6, y: 0.002, z: 0 },
    { id: 5, x: 3, y: 4, z: 0 }],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 300", material: "S235", releases: { myEnd: true }, ...extraA },
    { id: 2, startNodeId: omgekeerd ? 4 : 3, endNodeId: omgekeerd ? 3 : 4, profileName: "IPE 300", material: "S235",
      releases: omgekeerd ? { myStart: true } : { myEnd: true }, ...extraB },
  ],
  memberLoads: [{ id: 1, beamId: 1, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -5, qzEnd: -5, startPositionM: 0, endPositionM: 6 }, ...LIJN_B],
  memberPointLoads: [{ id: 1, beamId: 2, caseId: 1, py: 3, pz: -5, positionM: 2 }],
  thermalLoads: [{ id: 1, beamId: 2, caseId: 1, deltaTUniformK: 10, deltaTGradientYK: 4, deltaTGradientZK: 2 }],
  ...(panels ? { loadPanels: panels } : {}),
});
{
  const zelfde = dubbel();
  const r = mergeOpenFem3DNodes(zelfde);
  check("dezelfde richting: staaf 2 gaat op in staaf 1 (laagste id); het verslag noemt de vijf lasten",
    !staaf(r.model, 2) && json(r.mergedBeams) === json([{ beamId: 2, intoBeamId: 1, reversed: false, loadCount: 5 }]), json(r.mergedBeams));
  const op1 = (lijst) => lijst.filter((l) => l.beamId === 1);
  check("… de lasten op dezelfde posities met dezelfde waarden (de lokale assen zijn gelijk)",
    json(op1(r.model.memberLoads).filter((l) => l.id !== 1).map(({ beamId, ...l }) => l))
      === json(LIJN_B.map(({ beamId, ...l }) => l))
    && json(r.model.memberPointLoads) === json([{ id: 1, beamId: 1, caseId: 1, py: 3, pz: -5, positionM: 2 }])
    && json(r.model.thermalLoads) === json([{ id: 1, beamId: 1, caseId: 1, deltaTUniformK: 10, deltaTGradientYK: 4, deltaTGradientZK: 2 }]),
    json(r.model.memberLoads));

  const omgekeerd = dubbel({ omgekeerd: true });
  // De lokale assen van de kern: staaf 1 langs +X heeft e_y = +Y, e_z = +Z;
  // staaf 2 langs −X (zelfde rolhoek) e_y = −Y, e_z = +Z.
  const k = (id) => knoop(omgekeerd, id);
  const assen1 = openFem3DMemberAxes(k(1), k(2), 0), assen2 = openFem3DMemberAxes(k(4), k(3), 0);
  check("openFem3DMemberAxes: omgekeerd met dezelfde rolhoek is e_y' = −e_y en e_z' = e_z",
    dicht(assen1.ey[1], 1) && dicht(assen2.ey[1], -1) && dicht(assen1.ez[2], 1) && dicht(assen2.ez[2], 1));
  const ro = mergeOpenFem3DNodes(omgekeerd);
  check("omgekeerde richting: staaf 2 gaat op in staaf 1, als omgekeerd gemeld",
    !staaf(ro.model, 2) && json(ro.mergedBeams) === json([{ beamId: 2, intoBeamId: 1, reversed: true, loadCount: 5 }]), json(ro.mergedBeams));
  const lijn = (id) => ro.model.memberLoads.find((l) => l.id === id);
  check("… lokaal trapezium [1; 4] m vanaf knoop 4 → [2; 5] m vanaf knoop 1; begin en eind gewisseld; qy van teken om, qz niet",
    json(lijn(2)) === json({ id: 2, beamId: 1, caseId: 1, qyStart: -3, qyEnd: -1, qzStart: -4, qzEnd: -2, startPositionM: 2, endPositionM: 5 }),
    json(lijn(2)));
  check("… globaal: richting gelijk, posities gespiegeld, qStart en qEnd gewisseld; per projectie blijft",
    json(lijn(3)) === json({ id: 3, beamId: 1, caseId: 2, globalDirection: "z", qStart: -3, qEnd: -1, startPositionM: 0, endPositionM: 6 })
    && json(lijn(4)) === json({ id: 4, beamId: 1, caseId: 2, globalDirection: "y", qStart: 2, qEnd: 2, perProjection: true, startPositionM: 0, endPositionM: 3 }),
    json([lijn(3), lijn(4)]));
  check("… puntlast op 2 m vanaf knoop 4 → 4 m vanaf knoop 1, py van teken om, pz niet; temperatuurgradiënt in y om, in z niet",
    json(ro.model.memberPointLoads) === json([{ id: 1, beamId: 1, caseId: 1, py: -3, pz: -5, positionM: 4 }])
    && json(ro.model.thermalLoads) === json([{ id: 1, beamId: 1, caseId: 1, deltaTUniformK: 10, deltaTGradientYK: -4, deltaTGradientZK: 2 }]),
    json([ro.model.memberPointLoads, ro.model.thermalLoads]));
  // De last in het wereldstelsel langs de staaf, vóór (staaf 1 en 2 samen) en na (staaf 1).
  const xs = [0, 0.5, 1, 1.5, 2.2, 3, 3.7, 4, 4.5, 5, 5.9, 6];
  const verschil = (voor, na) => Math.max(...xs.map((x) => {
    const a = wereldLast(voor, [1, 2], x), b = wereldLast(na, [1], x);
    return Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  }));
  check("de lijnlast in het wereldstelsel is overal langs de staaf dezelfde, in beide richtingen",
    verschil(zelfde, r.model) < 1e-9 && verschil(omgekeerd, ro.model) < 1e-9);
  check("de puntlast in het wereldstelsel ook (plek en kracht)",
    json(wereldPuntlasten(omgekeerd, [2])) === json(wereldPuntlasten(ro.model, [1])) && json(wereldPuntlasten(ro.model, [1])) === json([[4, [0, -3, -5]]]),
    json([wereldPuntlasten(omgekeerd, [2]), wereldPuntlasten(ro.model, [1])]));
  check("scharnieren: myStart van de omgekeerde staaf hoort bij myEnd van de blijvende (gelijk, dus samengevoegd)",
    ro.refused.length === 0 && staaf(ro.model, 1).releases.myEnd === true);
  check("beide modellen openen weer", fout(() => parseOpenFem3DModel(r.model)) === null && fout(() => parseOpenFem3DModel(ro.model)) === null);

  // Weigeringen: verschillen worden niet stil gekozen.
  const weigering = (model) => { const x = mergeOpenFem3DNodes(model); return x.refused.map((w) => w.reason); };
  // Per groep: {1, 3} gaat door (staaf 2 hangt dan van 1 naar 4, nog geen
  // dubbele staaf); {2, 4} zou staaf 2 op staaf 1 leggen en wordt geweigerd.
  const anderProfiel = mergeOpenFem3DNodes(dubbel({ extraB: { profileName: "HEA 200" } }));
  check("ander profiel → de groep die de staven zou laten samenvallen ({2, 4}) geweigerd (profiel); de andere groep gaat door",
    json(anderProfiel.refused) === json([{ nodeIds: [2, 4], keepNodeId: 2, reason: { kind: "beamProperties", beamId: 1, otherBeamId: 2, properties: ["profile"] } }])
    && json(anderProfiel.groups.map((g) => g.nodeIds)) === json([[3]]) && staaf(anderProfiel.model, 2).endNodeId === 4, json(anderProfiel.refused));
  check("omgekeerd met hetzelfde scharnier aan het EIND (dat is het begin van de blijvende) → geweigerd (scharnieren)",
    json(weigering(dubbel({ omgekeerd: true, extraB: { releases: { myEnd: true } } })).map((w) => w.properties)) === json([["releases"]]));
  check("een andere rolhoek (90°) → geweigerd (oriëntatie); omgekeerd met dezelfde rolhoek 0,3 rad ook",
    json(weigering(dubbel({ extraB: { rollAngleRad: Math.PI / 2 } })).map((w) => w.properties)) === json([["orientation"]])
    && json(weigering(dubbel({ omgekeerd: true, extraA: { rollAngleRad: 0.3 }, extraB: { rollAngleRad: 0.3 } })).map((w) => w.properties)) === json([["orientation"]]));
  const gespiegeld = mergeOpenFem3DNodes(dubbel({ omgekeerd: true, extraA: { rollAngleRad: 0.3 }, extraB: { rollAngleRad: -0.3 } }));
  check("omgekeerd met de gespiegelde rolhoek (−0,3 rad) is dezelfde doorsnede: samengevoegd, lasten volgens e_y'·e_y en e_z'·e_z",
    gespiegeld.refused.length === 0 && gespiegeld.mergedBeams.length === 1
    && verschil(dubbel({ omgekeerd: true, extraA: { rollAngleRad: 0.3 }, extraB: { rollAngleRad: -0.3 } }), gespiegeld.model) < 1e-9);
  check("trek-alleen, bedding, groep en materiaal tellen ook mee",
    json(weigering(dubbel({ extraB: { tensionOnly: true, group: "wind", material: "S355" } })).map((w) => w.properties))
      === json([["material", "tensionOnly", "group"]]));
  check("toetsinstellingen: een kipsteun op 0,25 van de omgekeerde staaf is dezelfde als op 0,75 van de blijvende",
    mergeOpenFem3DNodes(dubbel({ omgekeerd: true, extraA: { checkConfig: { lateralRestraints: [0.75] } }, extraB: { checkConfig: { lateralRestraints: [0.25] } } })).refused.length === 0
    && json(weigering(dubbel({ omgekeerd: true, extraA: { checkConfig: { lateralRestraints: [0.25] } }, extraB: { checkConfig: { lateralRestraints: [0.25] } } })).map((w) => w.properties))
      === json([["checkConfig"]]));
  const vlak = (excludedBeamIds) => [{ id: 7, nodeIds: [1, 2, 5], q: -2, direction: "gravity", distribution: "twoWay", ...(excludedBeamIds ? { excludedBeamIds } : {}) }];
  check("een belastingvlak dat er maar één van uitsluit → geweigerd; beide uitgesloten → samengevoegd, de verdwenen staaf uit de lijst",
    json(weigering(dubbel({ panels: vlak([2]) }))) === json([{ kind: "beamExcluded", beamId: 1, otherBeamId: 2, panelId: 7 }])
    && json(mergeOpenFem3DNodes(dubbel({ panels: vlak([1, 2]) })).model.loadPanels[0].excludedBeamIds) === json([1]));
  check("de naam (alleen weergave) weigert niet: de naam van de blijvende staaf blijft",
    staaf(mergeOpenFem3DNodes(dubbel({ extraA: { name: "A" }, extraB: { name: "B" } })).model, 1).name === "A");
}

log("\n[4] opleggingen");
{
  const paar = (steunA, steunB) => parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0.002, y: 0, z: 0 }], beams: [],
    supports: [steunA && { nodeId: 1, ...steunA }, steunB && { nodeId: 2, ...steunB }].filter(Boolean),
  });
  const vrij = { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };
  const ok1 = mergeOpenFem3DNodes(paar({ ...vrij, ux: true, uy: true, uz: true }, { ...vrij, rx: true, ry: true, springs: { krzKnmPerRad: 500 } }));
  check("vrijheidsgraden samengevoegd (OR), de veer in rz blijft",
    json(ok1.model.supports) === json([{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: false, springs: { krzKnmPerRad: 500 } }])
    && ok1.notes.length === 0, json(ok1.model.supports));
  const veren = mergeOpenFem3DNodes(paar({ ...vrij, springs: { kzKnPerM: 1000 } }, { ...vrij, springs: { kzKnPerM: 2000 } }));
  check("veren in dezelfde richting op beide knopen → geweigerd met de richting",
    veren.groups.length === 0 && json(veren.refused) === json([{ nodeIds: [1, 2], keepNodeId: 1, reason: { kind: "springs", dof: "uz" } }]));
  const wint = mergeOpenFem3DNodes(paar({ ...vrij, uz: true }, { ...vrij, springs: { kzKnPerM: 1000 } }));
  check("een veer en een blokkering in dezelfde richting: de blokkering wint, met een notitie",
    json(wint.model.supports) === json([{ nodeId: 1, ...vrij, uz: true }])
    && json(wint.notes) === json([{ kind: "springOverruled", nodeId: 2, keepNodeId: 1, dof: "uz" }]), json([wint.model.supports, wint.notes]));
  const opgelegd = mergeOpenFem3DNodes(paar({ ...vrij, uz: true, prescribed: { uzM: -0.01 } }, { ...vrij, uz: true }));
  check("opgelegde verplaatsing −10 mm tegen een blokkering (0) in dezelfde richting → geweigerd",
    json(opgelegd.refused.map((w) => w.reason)) === json([{ kind: "prescribed", dof: "uz" }]));
  const gelijk = mergeOpenFem3DNodes(paar({ ...vrij, uz: true, prescribed: { uzM: -0.01 } }, { ...vrij, ux: true, uz: true, prescribed: { uzM: -0.01 } }));
  check("dezelfde opgelegde waarde → samengevoegd, de waarde blijft",
    json(gelijk.model.supports) === json([{ nodeId: 1, ...vrij, ux: true, uz: true, prescribed: { uzM: -0.01 } }]));
  const alleenB = mergeOpenFem3DNodes(paar(null, { ...vrij, uz: true }));
  check("alleen de verdwijnende knoop heeft een oplegging: die gaat naar de blijvende",
    json(alleenB.model.supports) === json([{ nodeId: 1, ...vrij, uz: true }]));
  check("alle uitkomsten openen weer", [ok1, wint, gelijk, alleenB].every((x) => fout(() => parseOpenFem3DModel(x.model)) === null));
}

log("\n[5] platen, openingen en belastingvlakken");
{
  // Plaat 1 (knopen 11–14) op z = 0; knoop 10 ligt 3 mm boven hoek 13 en
  // heeft de laagste id: de hoek zou naar knoop 10 gaan en de plaat scheef.
  const scheef = parseOpenFem3DModel({
    nodes: [{ id: 10, x: 4, y: 3, z: 0.003 }, { id: 11, x: 0, y: 0, z: 0 }, { id: 12, x: 4, y: 0, z: 0 }, { id: 13, x: 4, y: 3, z: 0 }, { id: 14, x: 0, y: 3, z: 0 }],
    beams: [], plates: [{ id: 1, nodeIds: [11, 12, 13, 14], thicknessM: 0.2 }],
  });
  const rs = mergeOpenFem3DNodes(scheef);
  check("een plaat die niet meer vlak zou zijn → geweigerd, het model ongewijzigd",
    rs.model === scheef && json(rs.refused.map((w) => w.reason)) === json([{ kind: "plateNotPlanar", plateId: 1 }]), json(rs.refused));
  // Een vijfhoek met twee hoeken 3 mm uit elkaar (12 en 13): na het
  // samenvoegen een vierhoek. Randoplegging op rand 3 (14 → 15) wordt rand 2.
  const vijf = (randen) => parseOpenFem3DModel({
    nodes: [{ id: 11, x: 0, y: 0, z: 0 }, { id: 12, x: 4, y: 0, z: 0 }, { id: 13, x: 4, y: 0.003, z: 0 }, { id: 14, x: 4, y: 3, z: 0 }, { id: 15, x: 0, y: 3, z: 0 }],
    beams: [], plates: [{ id: 1, nodeIds: [11, 12, 13, 14, 15], thicknessM: 0.2,
      edgeSupports: randen.map((edge) => ({ edge, ux: false, uy: false, uz: true, rx: false, ry: false, rz: false })) }],
  });
  const rv = mergeOpenFem3DNodes(vijf([3]));
  check("een vijfhoek met twee naburige hoeken op 3 mm wordt een vierhoek; de randoplegging schuift mee (rand 4 → 3)",
    json(rv.model.plates[0].nodeIds) === json([11, 12, 14, 15]) && json(rv.model.plates[0].edgeSupports.map((e) => e.edge)) === json([2])
    && json(rv.plates) === json([{ plateId: 1, corners: 4, removedCorners: 1 }]), json(rv.model.plates[0]));
  check("… maar een randoplegging op de rand die lengte 0 krijgt → geweigerd (rand 2)",
    json(mergeOpenFem3DNodes(vijf([1])).refused.map((w) => w.reason)) === json([{ kind: "plateEdgeSupport", plateId: 1, edge: 2 }]));
  const drie = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0.003, y: 0, z: 0 }, { id: 3, x: 0, y: 3, z: 0 }],
    beams: [], plates: [{ id: 1, nodeIds: [1, 2, 3], thicknessM: 0.2 }],
  });
  check("een driehoek met een rand van 3 mm → geweigerd (minder dan drie hoeken)",
    json(mergeOpenFem3DNodes(drie).refused.map((w) => w.reason)) === json([{ kind: "plateCorners", plateId: 1 }]));
  // Een rand met een boog waarvan de stuurknoop (13) 3 mm van het begin (12) ligt.
  const boog = parseOpenFem3DModel({
    nodes: [{ id: 11, x: 0, y: 0, z: 0 }, { id: 12, x: 4, y: 0, z: 0 }, { id: 13, x: 4.002, y: 0.002, z: 0 }, { id: 14, x: 0, y: 3, z: 0 }],
    beams: [], plates: [{ id: 1, nodeIds: [11, 12, 13, 14], thicknessM: 0.2, boundary: [
      { kind: "line", startNodeId: 11, endNodeId: 12 }, { kind: "arc", startNodeId: 12, controlNodeId: 13, endNodeId: 14 },
      { kind: "line", startNodeId: 14, endNodeId: 11 }] }],
  });
  check("een boog waarvan de stuurknoop op het begin valt → geweigerd (boog)",
    json(mergeOpenFem3DNodes(boog).refused.map((w) => w.reason)) === json([{ kind: "plateArc", plateId: 1 }]));
  // Een opening (knopen 21–24) in plaat 1 met een hoek die 2 mm naast een
  // andere knoop (20) ligt: de opening gaat mee naar knoop 20.
  const opening = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6, y: 6, z: 0 }, { id: 4, x: 0, y: 6, z: 0 },
      { id: 20, x: 2.002, y: 2, z: 0 }, { id: 21, x: 2, y: 2, z: 0 }, { id: 22, x: 4, y: 2, z: 0 }, { id: 23, x: 4, y: 4, z: 0 }, { id: 24, x: 2, y: 4, z: 0 }],
    beams: [], plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2, openings: [{ id: 1, nodeIds: [21, 22, 23, 24] }] }],
  });
  const ro = mergeOpenFem3DNodes(opening);
  check("een hoek van een opening gaat mee naar de blijvende knoop (20)",
    json(ro.model.plates[0].openings[0].nodeIds) === json([20, 22, 23, 24]) && fout(() => parseOpenFem3DModel(ro.model)) === null);
  // Belastingvlakken.
  const vlak = (extra) => parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 3 }, { id: 2, x: 4, y: 0, z: 3 }, { id: 3, x: 4, y: 3, z: 3 }, { id: 4, x: 0, y: 3, z: 3 }, ...extra],
    beams: [],
    loadPanels: [{ id: 1, nodeIds: [1, 2, 3, 4, ...extra.map((n) => n.id)], q: -2, direction: "gravity", distribution: "twoWay" }],
  });
  const rp = mergeOpenFem3DNodes(vlak([{ id: 5, x: 0.002, y: 3, z: 3 }]));
  check("een belastingvlak met een hoek 2 mm naast een andere: een hoek minder",
    json(rp.model.loadPanels[0].nodeIds) === json([1, 2, 3, 4]) && rp.groups.length === 1);
  const drieVlak = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 3 }, { id: 2, x: 0.003, y: 0, z: 3 }, { id: 3, x: 0, y: 3, z: 3 }], beams: [],
    loadPanels: [{ id: 1, nodeIds: [1, 2, 3], q: -2, direction: "gravity", distribution: "twoWay" }],
  });
  check("een belastingvlak dat minder dan drie hoeken zou houden → geweigerd",
    json(mergeOpenFem3DNodes(drieVlak).refused.map((w) => w.reason)) === json([{ kind: "panelCorners", panelId: 1 }]));
}

log("\n[6] schijven en levels");
{
  const schijfModel = (diaphragms, extraNodes = []) => parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 3 }, { id: 2, x: 0.002, y: 0, z: 3 }, { id: 3, x: 5, y: 0, z: 3 }, { id: 4, x: 5, y: 5, z: 3 }, ...extraNodes],
    beams: [], diaphragms,
  });
  const twee = mergeOpenFem3DNodes(schijfModel([{ id: 1, nodeIds: [1, 3] }, { id: 2, nodeIds: [2, 4] }]));
  check("een knoop in twee verschillende schijven → geweigerd",
    json(twee.refused.map((w) => w.reason)) === json([{ kind: "diaphragms", diaphragmIds: [1, 2] }]) && twee.groups.length === 0);
  const een = mergeOpenFem3DNodes(schijfModel([{ id: 1, nodeIds: [2, 3, 4] }]));
  check("de verdwijnende knoop in een schijf: de blijvende knoop neemt zijn plaats in",
    json(een.model.diaphragms) === json([{ id: 1, nodeIds: [1, 3, 4] }]));
  const weg = mergeOpenFem3DNodes(schijfModel([{ id: 1, nodeIds: [1, 2] }]));
  check("een schijf die nog maar één knoop zou koppelen verdwijnt, met een notitie",
    json(weg.model.diaphragms) === json([]) && json(weg.notes) === json([{ kind: "diaphragmRemoved", diaphragmId: 1 }]));
  // Knoop 5 ligt 3 mm lager dan de schijf (1, 3, 4) en heeft de laagste id.
  const hoog = parseOpenFem3DModel({
    nodes: [{ id: 5, x: 0, y: 0, z: 2.997 }, { id: 6, x: 0, y: 0, z: 3 }, { id: 7, x: 5, y: 0, z: 3 }], beams: [],
    diaphragms: [{ id: 1, nodeIds: [6, 7] }],
  });
  check("een schijf die daardoor niet meer op één hoogte ligt (3 mm) → geweigerd",
    json(mergeOpenFem3DNodes(hoog).refused.map((w) => w.reason)) === json([{ kind: "diaphragmHeight", diaphragmId: 1 }]));

  const levels = (a, b, plaat = false) => parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 3, ...a }, { id: 2, x: 0.002, y: 0, z: 3, ...b }, { id: 3, x: 4, y: 0, z: 3, levelId: "L1" }, { id: 4, x: 4, y: 3, z: 3, levelId: "L1" }],
    beams: [], ...(plaat ? { plates: [{ id: 1, nodeIds: [2, 3, 4], thicknessM: 0.2, levelId: "L1" }] } : {}),
  });
  check("verschillende levels → geweigerd",
    json(mergeOpenFem3DNodes(levels({ levelId: "L1" }, { levelId: "L2" })).refused.map((w) => w.reason)) === json([{ kind: "levels", levelIds: ["L1", "L2"] }]));
  const overgenomen = mergeOpenFem3DNodes(levels({}, { levelId: "L1" }, true));
  check("de blijvende knoop zonder level op dezelfde hoogte neemt het level over; de plaat op het level blijft gekoppeld",
    knoop(overgenomen.model, 1).levelId === "L1" && overgenomen.model.plates[0].levelId === "L1"
    && json(parseOpenFem3DModel(overgenomen.model).plates[0].levelId) === json("L1"), json(overgenomen.refused));
  check("de blijvende knoop met level houdt het; de andere zonder level gaat erin op",
    knoop(mergeOpenFem3DNodes(levels({ levelId: "L1" }, {})).model, 1).levelId === "L1");
  const lager = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 2.998 }, { id: 2, x: 0, y: 0, z: 3, levelId: "L1" }, { id: 3, x: 4, y: 0, z: 3, levelId: "L1" }, { id: 4, x: 4, y: 3, z: 3, levelId: "L1" }],
    beams: [], plates: [{ id: 1, nodeIds: [2, 3, 4], thicknessM: 0.2, levelId: "L1" }],
  });
  check("niet op dezelfde hoogte: de blijvende knoop krijgt het level niet, en een plaat op dat level weigert de groep",
    json(mergeOpenFem3DNodes(lager).refused.map((w) => w.reason)) === json([{ kind: "levelPlate", plateId: 1, levelId: "L1" }]));
}

log("\n[7] de groep: 2 × de tolerantie, de blijvende knoop, het bereik");
{
  const ketting = (n, stap) => parseOpenFem3DModel({ nodes: Array.from({ length: n }, (_, i) => ({ id: i + 1, x: i * stap, y: 0, z: 0 })), beams: [] });
  const drie = mergeOpenFem3DNodes(ketting(3, 0.004));
  check("drie knopen op 4 mm (8 mm breed, binnen 2 × 5 mm): één groep, knoop 1 blijft",
    json(drie.groups) === json([{ keepNodeId: 1, nodeIds: [2, 3], distanceMm: 8 }]));
  const vier = mergeOpenFem3DNodes(ketting(4, 0.004));
  check("vier knopen op 4 mm (12 mm breed, meer dan 2 × 5 mm) → geweigerd met de breedte; er verschuift niets",
    vier.groups.length === 0 && vier.model.nodes.length === 4
    && json(vier.refused) === json([{ nodeIds: [1, 2, 3, 4], keepNodeId: 1, reason: { kind: "tooWide", spanMm: 12, limitMm: 10 } }]), json(vier.refused));
  check("… per selectie gaat het wel (knoop 1: alleen de paren met knoop 1, dus 1 en 2)",
    json(mergeOpenFem3DNodes(ketting(4, 0.004), { nodeIds: [1] }).groups) === json([{ keepNodeId: 1, nodeIds: [2], distanceMm: 4 }]));
  const twee = parseOpenFem3DModel({ nodes: [{ id: 3, x: 0, y: 0, z: 0 }, { id: 9, x: 0.001, y: 0, z: 0 }, { id: 4, x: 0, y: 0.004, z: 0 }], beams: [] });
  check("de laagste id blijft, ongeacht de volgorde in het model", mergeOpenFem3DNodes(twee).groups[0]?.keepNodeId === 3);
  // Automatisch: knoop 3 is geplaatst; 9 ligt op 1 mm, 4 op 4 mm, en 9 en 4
  // liggen 4,1 mm uit elkaar. Alleen de dichtstbijzijnde bestaande knoop telt.
  const auto = mergeOpenFem3DNodes(twee, { placedNodeIds: [3] });
  check("met placedNodeIds (automatisch): de geplaatste knoop gaat op in de dichtstbijzijnde bestaande knoop (9 op 1 mm), die blijft; 4 doet niet mee",
    json(auto.groups) === json([{ keepNodeId: 9, nodeIds: [3], distanceMm: 1 }]) && auto.refused.length === 0 && Boolean(knoop(auto.model, 4)),
    json(auto));
  // Twee geplaatste punten op 3 mm van elkaar, elk het dichtst bij een andere
  // bestaande knoop (1 en 2, 9 mm uit elkaar): de keten zou 1 en 2 samenvoegen.
  const keten = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0.009, y: 0, z: 0 }, { id: 3, x: 0.003, y: 0, z: 0 }, { id: 4, x: 0.006, y: 0, z: 0 }], beams: [],
  });
  const ketenR = mergeOpenFem3DNodes(keten, { nodeIds: [3, 4], placedNodeIds: [3, 4] });
  check("… twee bestaande knopen in één groep (via de geplaatste punten) → geweigerd met de bestaande knopen; er verschuift niets",
    ketenR.groups.length === 0 && ketenR.model === keten
    && json(ketenR.refused) === json([{ nodeIds: [1, 2, 3, 4], keepNodeId: 1, reason: { kind: "existingNodes", existingNodeIds: [1, 2] } }]),
    json(ketenR.refused));
  // De einden van twee kopieën in een rij (5 en 6, beide geplaatst, 2 mm uit
  // elkaar, geen bestaande knoop in de buurt).
  const rij = parseOpenFem3DModel({ nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 5, x: 10, y: 0, z: 0 }, { id: 6, x: 10.002, y: 0, z: 0 }], beams: [] });
  check("… geplaatste punten onderling (de einden van twee kopieën in een rij) worden wel één knoop, de laagste id",
    json(mergeOpenFem3DNodes(rij, { nodeIds: [5, 6], placedNodeIds: [5, 6] }).groups) === json([{ keepNodeId: 5, nodeIds: [6], distanceMm: 2 }]));
  const paren = parseOpenFem3DModel({ nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0.002, y: 0, z: 0 }, { id: 3, x: 5, y: 0, z: 0 }, { id: 4, x: 5.002, y: 0, z: 0 }], beams: [] });
  check("bereik: alleen de groepen rond de genoemde knopen",
    json(mergeOpenFem3DNodes(paren, { nodeIds: [4] }).groups.map((g) => g.keepNodeId)) === json([3]));
  check("bereik uit de selectie: knoop, staaf (met eindknopen), plaat (met hoeken), groep; niets → het hele model",
    openFem3DMergeScope(tweePlaten(), null) === undefined
    && json(openFem3DMergeScope(tweePlaten(), { type: "node", id: 5 })) === json({ nodeIds: [5], count: 1 })
    && json(openFem3DMergeScope(tweePlaten(), { type: "beam", id: 1 })) === json({ nodeIds: [9, 10], count: 1 })
    && json(openFem3DMergeScope(tweePlaten(), { type: "plate", id: 2 })) === json({ nodeIds: [5, 6, 7, 8], count: 1 })
    && json(openFem3DMergeScope(tweePlaten(), { type: "multi", nodeIds: [1, 99], beamIds: [1], plateIds: [] })) === json({ nodeIds: [1, 9, 10], count: 2 })
    && openFem3DMergeScope(tweePlaten(), { type: "nodalLoad", id: 1 }) === undefined);
  const near = openFem3DNodeNearPoint(tweePlaten().nodes, { x: 4.003, y: 0.001, z: 0 }, 5);
  check("het tekenvlak: het dichtstbijzijnde punt binnen de tolerantie (knoop 5 op 1,4 mm, niet 2 op 3,2 mm); buiten de tolerantie niets",
    near?.id === 5 && openFem3DNodeNearPoint(tweePlaten().nodes, { x: 4.01, y: 0, z: 0 }, 5) === undefined
    && openFem3DNodeNearPoint(tweePlaten().nodes, { x: 4.003, y: 0.001, z: 0 }, 5, (n) => n.id !== 5)?.id === 2);
}

log("\n[8] automatisch na een bewerking");
{
  // Een ligger van knoop 1 (0; 0) naar 2 (6; 0) en een losse knoop 3 op (10; 0).
  const ligger = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 10, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }], ...leeg,
  });
  // Tekenen: een staaf van knoop 3 naar een nieuw punt 3 mm naast knoop 2.
  const getekend = { ...ligger, nodes: [...ligger.nodes, { id: 4, x: 6.003, y: 0, z: 0 }], beams: [...ligger.beams, { id: 2, startNodeId: 3, endNodeId: 4 }] };
  const stap = openFem3DEditWithAutoConnect(ligger, getekend, snap);
  check("getekend punt 3 mm naast knoop 2: het wordt knoop 2 (de bestaande knoop blijft); de nieuwe staaf loopt 3 → 2",
    stap.merge?.groups.length === 1 && json(stap.merge.groups[0]) === json({ keepNodeId: 2, nodeIds: [4], distanceMm: 3 })
    && !knoop(stap.model, 4) && json([staaf(stap.model, 2).startNodeId, staaf(stap.model, 2).endNodeId]) === json([3, 2]), json(stap.merge));
  let historie = { model: ligger, past: [], future: [] };
  historie = openFem3dHistoryReducer(historie, { type: "edit", model: stap.model });
  check("één stap ongedaan maken: tekenen en samenvoegen samen", historie.past.length === 1 && openFem3dHistoryReducer(historie, { type: "undo" }).model === ligger);
  check("met de schakelaar uit: niets, precies het model van de bewerking",
    (() => { const uit = openFem3DEditWithAutoConnect(ligger, getekend, { ...snap, knopenAansluiten: false }); return uit.merge === null && uit.model === getekend; })());
  check("een punt 6 mm ernaast bij 5 mm tolerantie niet; bij 10 mm wel (de tolerantie in mm)",
    (() => {
      const zes = { ...getekend, nodes: [...ligger.nodes, { id: 4, x: 6.006, y: 0, z: 0 }] };
      return openFem3DEditWithAutoConnect(ligger, zes, snap).merge === null
        && openFem3DEditWithAutoConnect(ligger, zes, { ...snap, verbindingsTolerantie: 10 }).merge?.groups.length === 1;
    })());
  // Samenvoegen gaat vóór het aansluiten: een punt 3 mm voorbij het staafeind
  // valt buiten de eindmarge van het aansluiten (#63) en wordt samengevoegd; een
  // punt halverwege de staaf wordt aangesloten.
  const tweeVerder = { ...ligger, nodes: [...ligger.nodes, { id: 4, x: 6.003, y: 0, z: 0 }, { id: 5, x: 3, y: 0.002, z: 0 }] };
  const beide = openFem3DEditWithAutoConnect(ligger, tweeVerder, snap);
  check("in één stap: punt 4 (bij het staafeind) samengevoegd met 2, punt 5 (halverwege) op de staaf aangesloten",
    beide.merge?.groups.length === 1 && beide.result?.splits.length === 1 && json(beide.result.splits[0].nodeIds) === json([5])
    && !knoop(beide.model, 4), json([beide.merge?.groups, beide.result?.splits]));
  // Kopiëren: staaf 1 met 6,002 m opgeschoven: het begin van de kopie landt
  // 2 mm naast knoop 2. De selectie blijft de kopie.
  const kopie = transformOpenFem3D(ligger, { type: "beam", id: 1 }, { kind: "copy", dx: 6.002, dy: 0, dz: 0 });
  const kopieStap = openFem3DEditWithAutoConnect(ligger, kopie.model, snap);
  const kopieStaaf = kopieStap.model.beams.find((b) => b.id !== 1);
  check("kopiëren: het begin van de kopie wordt knoop 2, de kopie loopt van knoop 2 verder",
    kopieStap.merge?.groups.length === 1 && kopieStaaf?.startNodeId === 2 && kopieStap.model.nodes.length === 4, json(kopieStap.model));
  check("… eerst samenvoegen, dan aansluiten: de kopie loopt door de losse knoop 3 (10 m) en is daar gesplitst; de selectie wijst beide delen aan",
    kopieStap.result?.splits.length === 1 && json(kopieStap.result.splits[0].nodeIds) === json([3])
    && json(openFem3DSelectionAfterAutoEdit(kopie.selection, kopieStap)) === json({ type: "multi", nodeIds: [], beamIds: [2, 3] }),
    json(openFem3DSelectionAfterAutoEdit(kopie.selection, kopieStap)));
  // Verplaatsen: knoop 3 naar 2 mm naast knoop 2. De selectie wordt knoop 2.
  const verplaatst = transformOpenFem3D(ligger, { type: "node", id: 3 }, { kind: "move", dx: -3.998, dy: 0, dz: 0 });
  const verplaatsStap = openFem3DEditWithAutoConnect(ligger, verplaatst.model, snap);
  check("verplaatsen: knoop 3 landt 2 mm naast knoop 2 en wordt knoop 2 (die staat er al); de selectie wordt knoop 2",
    !knoop(verplaatsStap.model, 3) && json(knoop(verplaatsStap.model, 2)) === json({ id: 2, x: 6, y: 0, z: 0 })
    && json(openFem3DSelectionAfterAutoEdit(verplaatst.selection, verplaatsStap)) === json({ type: "node", id: 2 }));
  // Een coördinaat wijzigen in het eigenschappenpaneel: hetzelfde.
  const paneel = updateOpenFem3DNode(ligger, 3, { x: 6.004 });
  check("coördinaten wijzigen (eigenschappenpaneel): idem", openFem3DEditWithAutoConnect(ligger, paneel, snap).merge?.groups[0]?.keepNodeId === 2);
  // Alleen wat de bewerking raakte: de bestaande knopen 1 (0; 0) en 2 (8 mm
  // verder) vallen bij 5 mm niet samen. Staaf 1 loopt 3 → 1, staaf 2 is een
  // kolom op knoop 2. Een punt dat midden ertussen landt (4 mm van elk), mag
  // knoop 2 niet meetrekken: de kolom zou 8 mm verschuiven en scheef staan.
  const tussen = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0.008, y: 0, z: 0 }, { id: 3, x: -3, y: 0, z: 0 }, { id: 4, x: 0.008, y: 0, z: 3 },
      { id: 5, x: 5, y: 5, z: 0 }, { id: 6, x: 6, y: 6, z: 0 }, { id: 7, x: 6, y: 9, z: 0 }],
    beams: [{ id: 1, startNodeId: 3, endNodeId: 1 }, { id: 2, startNodeId: 2, endNodeId: 4 }, { id: 3, startNodeId: 6, endNodeId: 7 }], ...leeg,
  });
  const kolomBlijft = (m) => json(knoop(m, 2)) === json(knoop(tussen, 2)) && json(staaf(m, 2)) === json(staaf(tussen, 2));
  const naarMidden = transformOpenFem3D(tussen, { type: "node", id: 5 }, { kind: "move", dx: 0.004 - 5, dy: -5, dz: 0 });
  const middenStap = openFem3DEditWithAutoConnect(tussen, naarMidden.model, snap);
  check("verplaatsen tussen twee bestaande knopen (8 mm uit elkaar): het punt gaat op in één ervan (gelijke afstand: de laagste id, 1); knoop 2 en de kolom erop blijven",
    json(middenStap.merge?.groups) === json([{ keepNodeId: 1, nodeIds: [5], distanceMm: 4 }]) && middenStap.merge.refused.length === 0
    && kolomBlijft(middenStap.model) && json(staaf(middenStap.model, 1)) === json(staaf(tussen, 1)), json(middenStap.merge));
  const kopieMidden = transformOpenFem3D(tussen, { type: "beam", id: 3 }, { kind: "copy", dx: 0.004 - 6, dy: -6, dz: 0 });
  const kopieMiddenStap = openFem3DEditWithAutoConnect(tussen, kopieMidden.model, snap);
  const kopieStaafMidden = kopieMiddenStap.model.beams.find((b) => b.id > 3);
  check("kopiëren met het begin tussen dezelfde twee knopen: het begin wordt knoop 1; knoop 2 en de kolom blijven",
    json(kopieMiddenStap.merge?.groups.map((g) => g.keepNodeId)) === json([1]) && kopieStaafMidden?.startNodeId === 1
    && kolomBlijft(kopieMiddenStap.model), json(kopieMiddenStap.merge));
  check("… de knop met het punt geselecteerd voegt wel alle drie samen: dat kiest de gebruiker",
    json(mergeOpenFem3DNodes(naarMidden.model, { nodeIds: [5] }).groups) === json([{ keepNodeId: 1, nodeIds: [2, 5], distanceMm: 8 }]));
  // Een klik op een staaf (raakpunt, voetpunt of snijpunt van de tekenhulp)
  // 3 mm van haar begin: het tekenvlak neemt dan de beginknoop
  // (openFem3DBeamEndNear) in plaats van een stompje van 3 mm af te knippen.
  // Staaf 1 van 6 m met een lijnlast en een puntlast op positie 0.
  const balk = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 300", material: "S235" }],
    supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: false, rz: false }, { nodeId: 2, ux: false, uy: true, uz: true, rx: false, ry: false, rz: false }],
    memberLoads: [{ id: 1, beamId: 1, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -5, qzEnd: -5, startPositionM: 0, endPositionM: 6 }],
    memberPointLoads: [{ id: 1, beamId: 1, caseId: 1, py: 0, pz: -10, positionM: 0 }],
  });
  const [b1, b2] = [knoop(balk, 1), knoop(balk, 2)];
  check("een klik op de staaf 3 mm van het begin: de beginknoop (1), 3 mm van het eind: de eindknoop (2), geen splitsing",
    openFem3DBeamEndNear(b1, b2, 0.003 / 6, 5) === 1 && openFem3DBeamEndNear(b1, b2, 1 - 0.003 / 6, 5) === 2);
  check("… 6 mm van het begin, of 3 mm bij een tolerantie van 2 mm: null (dan splitst het tekenvlak daar)",
    openFem3DBeamEndNear(b1, b2, 0.006 / 6, 5) === null && openFem3DBeamEndNear(b1, b2, 0.003 / 6, 2) === null);
  const kort = { id: 9, x: 0.008, y: 0, z: 0 };
  check("… een staaf van 8 mm: het dichtstbijzijnde eind (3 mm → begin, 5 mm → eind)",
    openFem3DBeamEndNear(b1, kort, 3 / 8, 5) === 1 && openFem3DBeamEndNear(b1, kort, 5 / 8, 5) === 9);
  // De keten van het tekenvlak bij die klik: de eindknoop is het begin van de
  // nieuwe staaf, dus het model krijgt alleen die staaf erbij (naar een punt
  // ernaast getekend). Geen staaf verdwijnt, de lasten blijven, en de
  // volgende klik gaat verder vanaf knoop 1, die er nog is.
  const verder = { ...balk, nodes: [...balk.nodes, { id: 3, x: 0, y: 2, z: 0 }], beams: [...balk.beams, { id: 2, startNodeId: 1, endNodeId: 3 }] };
  const verderStap = openFem3DEditWithAutoConnect(balk, verder, snap);
  check("… de getekende staaf begint op knoop 1: staaf 1 en haar lijn- en puntlast blijven, de totale last ook; de staafketting loopt door",
    verderStap.merge === null && verderStap.result === null && verderStap.model === verder
    && json(staaf(verderStap.model, 1)) === json(staaf(balk, 1)) && json(verderStap.model.memberPointLoads) === json(balk.memberPointLoads)
    && json(verderStap.model.memberLoads) === json(balk.memberLoads) && Boolean(knoop(verderStap.model, 1)), json(verderStap.merge));
  // Ter vergelijking de oude weg: splitsen op 3 mm, dan de pijplijn. Het
  // stompje 1 → 3 krijgt lengte 0 en verdwijnt met de puntlast op positie 0.
  const stompje = openFem3DEditWithAutoConnect(balk, splitOpenFem3DBeam(balk, 1, 0.003 / 6).model, snap);
  check("(zonder die regel: het stompje van 3 mm verdween met de puntlast; daarom splitst het tekenvlak daar niet)",
    stompje.merge?.removedBeams.length === 1 && stompje.model.memberPointLoads.length === 0, json(stompje.merge?.removedBeams));
  // Alleen wat de bewerking raakte: een oud project met twee samenvallende knopen.
  const oud = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0.002, y: 0, z: 0 }, { id: 3, x: 5, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 2, endNodeId: 3 }], ...leeg,
  });
  check("dezelfde stand vóór en na (geen bewerking): niets", openFem3DEditWithAutoConnect(oud, oud, snap).merge === null);
  // Openen gaat niet door de pijplijn: App vervangt het model in de historie
  // ({ type: "replace" }); [10] bewaakt dat pasProjectToe en replaceModel
  // alleen die weg nemen.
  const geopend = openFem3dHistoryReducer({ model: ligger, past: [], future: [] }, { type: "replace", model: oud });
  check("openen van een project: de historie neemt het model precies zoals het binnenkwam (1 en 2 blijven los), zonder stap",
    geopend.model === oud && geopend.past.length === 0 && openFem3DMergeCheck(geopend.model, 5).groups.length === 1);
  const metLast = { ...oud, loads: [{ id: 1, nodeId: 3, fx: 0, fy: 0, fz: -1, mx: 0, my: 0, mz: 0 }] };
  check("een lastwijziging raakt geen knoop: de samenvallende knopen 1 en 2 blijven", openFem3DEditWithAutoConnect(oud, metLast, snap).merge === null);
  const elders = addOpenFem3DNode(oud, { x: 9, y: 0, z: 0 }).model;
  check("een nieuwe knoop elders: alleen die knoop telt, 1 en 2 blijven los", autoMergeOpenFem3DEdit(oud, elders, { enabled: true, toleranceMm: 5 }) === null);
  // Een plaatcontour in aanbouw (tekengroep): pas als de plaat er is.
  const conceptKnoop = { ...ligger, nodes: [...ligger.nodes, { id: 4, x: 0.002, y: 0, z: 0 }] };
  check("tekengroep met een open contour: niets", openFem3DEditWithAutoConnect(ligger, conceptKnoop, snap, "plaat-1").merge === null);
  const plaatAf = {
    ...conceptKnoop,
    nodes: [...conceptKnoop.nodes, { id: 5, x: 4, y: 0.5, z: 0 }, { id: 6, x: 0, y: 3, z: 0 }],
    plates: [{ id: 1, nodeIds: [4, 5, 6], thicknessM: 0.2 }],
  };
  const af = openFem3DEditWithAutoConnect(conceptKnoop, plaatAf, snap, "plaat-1");
  check("de contour sluit: de plaathoek 2 mm naast knoop 1 wordt knoop 1",
    af.merge?.groups.length === 1 && json(af.model.plates[0].nodeIds) === json([1, 5, 6]), json(af.merge?.refused));
  // Een geweigerde groep (profiel) laat het model en meldt het.
  const metProfiel = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA 300" }], ...leeg,
  });
  const dubbelGetekend = {
    ...metProfiel, nodes: [...metProfiel.nodes, { id: 3, x: 0.002, y: 0, z: 0 }, { id: 4, x: 6.002, y: 0, z: 0 }],
    beams: [...metProfiel.beams, { id: 2, startNodeId: 3, endNodeId: 4, profileName: "IPE 200" }],
  };
  const geweigerd = openFem3DEditWithAutoConnect(metProfiel, dubbelGetekend, snap);
  check("een tweede staaf getekend over een staaf met een ander profiel: geweigerd, de punten blijven los, met de reden",
    geweigerd.merge?.groups.length === 1 && geweigerd.merge.refused.length === 1
    && geweigerd.merge.refused[0].reason.kind === "beamProperties", json(geweigerd.merge));
}

log("\n[9] modelcontrole, knop en melding");
{
  const voor = tweePlaten();
  const vooraf = json(voor);
  const controle = openFem3DMergeCheck(voor, 5);
  check("de modelcontrole: twee groepen, niets geweigerd, drie knopen samen te voegen; het model blijft hetzelfde",
    controle.groups.length === 2 && controle.refused.length === 0 && controle.mergeable === 3 && json(voor) === vooraf, json(controle));
  const vier = parseOpenFem3DModel({ nodes: Array.from({ length: 4 }, (_, i) => ({ id: i + 1, x: i * 0.004, y: 0, z: 0 })), beams: [] });
  const breed = openFem3DMergeCheck(vier, 5);
  check("de modelcontrole van een te brede groep: de reden, en niets samen te voegen (de knop staat uit)",
    breed.groups.length === 1 && breed.refused[0]?.reason.kind === "tooWide" && breed.mergeable === 0);
  check("zonder samenvallende knopen: niets", openFem3DMergeCheck(mergeOpenFem3DNodes(voor).model, 5).groups.length === 0);
  const knop = openFem3DMergeButton(voor, { type: "node", id: 5 }, { verbindingsTolerantie: 5 }, "selectie");
  check("de lintknop met knoop 5 geselecteerd: alleen 5 → 2, de melding 'binnen de selectie (1)'",
    json(knop.result.groups.map((g) => [g.keepNodeId, g.nodeIds])) === json([[2, [5]]]) && knop.model === knop.result.model
    && json(knop.context) === json({ scope: "selection", count: 1, toleranceMm: 5 }));
  const model = openFem3DMergeButton(voor, { type: "node", id: 5 }, { verbindingsTolerantie: 5 }, "model");
  check("de knop Samenvoegen in de modelcontrole: het hele model, ook met een selectie",
    model.result.groups.length === 2 && json(model.context) === json({ scope: "all", toleranceMm: 5 }));
  check("de lintknop zonder selectie: het hele model; de tolerantie in mm",
    json(openFem3DMergeButton(voor, null, { verbindingsTolerantie: 2 }, "selectie").context) === json({ scope: "all", toleranceMm: 2 })
    && openFem3DMergeButton(voor, null, { verbindingsTolerantie: 2 }, "selectie").result.groups.length === 1);
  const melding = openFem3DMergeMessage(model.result, model.context);
  check("melding: geslaagd, '3 knopen samengevoegd', per groep welke knopen in welke opgingen, in het hele model",
    melding.level === "success" && melding.title.key === "ribbon:openFem3d.mergeNodesDone" && melding.title.count === 3
    && json(melding.details.filter((d) => d.key === "ribbon:openFem3d.mergeNodesGroup").map((d) => [d.values.nodes, d.values.keep, d.count]))
      === json([["5", 2, 1], ["8, 10", 3, 2]])
    && melding.details.at(-1).key === "ribbon:openFem3d.mergeNodesScopeAll", json(melding));
  const dubbelR = mergeOpenFem3DNodes(dubbel({ omgekeerd: true }));
  const dubbelMelding = openFem3DMergeMessage(dubbelR, { scope: "auto", toleranceMm: 5 });
  check("melding: de samengevoegde staaf (omgekeerd, met het aantal lasten) en 'automatisch'",
    dubbelMelding.details.some((d) => d.key === "ribbon:openFem3d.mergeNodesBeamMergedReversed" && d.values.beam === 2 && d.values.into === 1 && d.count === 5)
    && dubbelMelding.details.some((d) => d.key === "ribbon:openFem3d.mergeNodesScopeAuto"), json(dubbelMelding));
  const nul = openFem3DMergeMessage(mergeOpenFem3DNodes(parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0.004, y: 0, z: 0 }], beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }],
    memberLoads: [{ id: 1, beamId: 1, qyStart: 0, qyEnd: 0, qzStart: -1, qzEnd: -1, startPositionM: 0, endPositionM: 0.004 }],
  })), { scope: "all", toleranceMm: 5 });
  check("melding: een staaf van lengte 0 verwijderd, met haar last",
    nul.details.some((d) => d.key === "ribbon:openFem3d.mergeNodesBeamRemoved" && d.values.beam === 1 && d.count === 1), json(nul));
  const niets = openFem3DMergeMessage(mergeOpenFem3DNodes(mergeOpenFem3DNodes(voor).model), { scope: "selection", count: 2, toleranceMm: 2.5 });
  check("niets te doen: info, met het bereik en de tolerantie in de regel van het bereik",
    niets.level === "info" && niets.title.key === "ribbon:openFem3d.mergeNodesNone" && niets.title.values === undefined
    && niets.details.some((d) => d.key === "ribbon:openFem3d.mergeNodesScopeSelection" && d.count === 2 && d.values?.mm === "2.5"), json(niets));
  // De gebruikte tolerantie staat in elke melding (geslaagd, waarschuwing,
  // automatisch), in de regel van het bereik: de lintknop gebruikt de
  // verbindingstolerantie, die ook voor 2D en het automatisch samenvoegen geldt.
  const ver = parseOpenFem3DModel({ nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0.015, y: 0, z: 0 }], beams: [] });
  const twintig = openFem3DMergeButton(ver, null, { verbindingsTolerantie: 20 }, "selectie");
  const bereikRegel = (m) => m.details.at(-1);
  check("de tolerantie (20 mm) staat in de melding na Knopen samenvoegen: geslaagd, in het hele model",
    twintig.result.nodeCount === 1 && json(bereikRegel(openFem3DMergeMessage(twintig.result, twintig.context)))
      === json({ key: "ribbon:openFem3d.mergeNodesScopeAll", values: { mm: "20" } }));
  check("… ook bij een waarschuwing (alles geweigerd) en automatisch na een bewerking",
    json(bereikRegel(openFem3DMergeMessage(mergeOpenFem3DNodes(vier), { scope: "all", toleranceMm: 5 })))
      === json({ key: "ribbon:openFem3d.mergeNodesScopeAll", values: { mm: "5" } })
    && json(bereikRegel(dubbelMelding)) === json({ key: "ribbon:openFem3d.mergeNodesScopeAuto", values: { mm: "5" } }));
  // Een weigering om levels noemt de levels bij naam en hoogte, niet hun id.
  const stramien = [{ id: "z-1759600000000", label: "Verdieping 1", position: 3000 }, { id: "z-1759600000123", label: "", position: 3002 }];
  const levelsWeigering = mergeOpenFem3DNodes(parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 3, levelId: "z-1759600000000" }, { id: 2, x: 0.002, y: 0, z: 3.002, levelId: "z-1759600000123" }], beams: [],
  })).refused[0];
  const levelRegel = openFem3DMergeRefusalPart(levelsWeigering, stramien);
  check("de weigering om levels: de naam met de hoogte in mm (zonder naam de peilmaat), niet de id; het verslag houdt de id's",
    levelRegel.values.levels === "Verdieping 1 (3000 mm), +3,00 m (3002 mm)"
    && json(levelsWeigering.reason.levelIds) === json(["z-1759600000000", "z-1759600000123"]), json(levelRegel));
  check("… ook in de melding; een onbekend level houdt zijn id",
    openFem3DMergeMessage({ ...mergeOpenFem3DNodes(ver), groups: [], refused: [levelsWeigering] }, { scope: "all", toleranceMm: 5 }, stramien)
      .details[0].values.levels === "Verdieping 1 (3000 mm), +3,00 m (3002 mm)"
    && openFem3DMergeRefusalPart(levelsWeigering, [stramien[0]]).values.levels === "Verdieping 1 (3000 mm), z-1759600000123");
  const bestaandeRegel = openFem3DMergeRefusalPart({ nodeIds: [1, 2, 3, 4], keepNodeId: 1, reason: { kind: "existingNodes", existingNodeIds: [1, 2] } });
  check("de weigering 'meer dan één bestaande knoop' noemt die knopen",
    json(bestaandeRegel) === json({ key: "ribbon:openFem3d.mergeNodesRefusal.existingNodes", values: { nodes: "1, 2, 3, 4", keep: 1, existing: "1, 2" } }));
  const alleenGeweigerd = openFem3DMergeMessage(mergeOpenFem3DNodes(vier), { scope: "all", toleranceMm: 5 });
  check("alles geweigerd: een waarschuwing met de reden (breedte en grens), niet 'niets te doen'",
    alleenGeweigerd.level === "warning" && alleenGeweigerd.title.key === "ribbon:openFem3d.mergeNodesFailed" && alleenGeweigerd.title.count === 1
    && json(alleenGeweigerd.details[0]) === json({ key: "ribbon:openFem3d.mergeNodesRefusal.tooWide", values: { nodes: "1, 2, 3, 4", keep: 1, span: "12", limit: "10" } }),
    json(alleenGeweigerd));
  const eigenschappen = openFem3DMergeRefusalPart({ nodeIds: [1, 3], keepNodeId: 1, reason: { kind: "beamProperties", beamId: 1, otherBeamId: 2, properties: ["profile", "releases"] } });
  check("de reden 'eigenschappen' noemt ze als lijst van vertaalsleutels",
    json(eigenschappen.lists) === json({ properties: ["ribbon:openFem3d.mergeNodesProperty.profile", "ribbon:openFem3d.mergeNodesProperty.releases"] }));
  const veer = openFem3DMergeMessage(mergeOpenFem3DNodes(parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0.002, y: 0, z: 0 }], beams: [],
    supports: [{ nodeId: 1, ux: false, uy: false, uz: true, rx: false, ry: false, rz: false },
      { nodeId: 2, ux: false, uy: false, uz: false, rx: false, ry: false, rz: false, springs: { kzKnPerM: 100 } }],
  })), { scope: "all", toleranceMm: 5 });
  check("melding: de veer die voor een blokkering wijkt staat erin",
    veer.details.some((d) => d.key === "ribbon:openFem3d.mergeNodesSpringOverruled" && d.values.node === 2 && d.values.dof === "uz"));
  // De selectie na een samenvoeging.
  const merge = { groups: [{ keepNodeId: 2, nodeIds: [5], distanceMm: 2 }], mergedBeams: [{ beamId: 7, intoBeamId: 3, reversed: false, loadCount: 0 }], removedBeams: [{ beamId: 8, loadCount: 0 }] };
  check("de selectie: een verdwenen knoop wordt de blijvende, een dubbele staaf de blijvende, een staaf van lengte 0 valt weg",
    json(openFem3DSelectionAfterMerge({ type: "node", id: 5 }, merge)) === json({ type: "node", id: 2 })
    && json(openFem3DSelectionAfterMerge({ type: "beam", id: 7 }, merge)) === json({ type: "beam", id: 3 })
    && openFem3DSelectionAfterMerge({ type: "beam", id: 8 }, merge) === null
    && json(openFem3DSelectionAfterMerge({ type: "multi", nodeIds: [5, 2, 9], beamIds: [7, 3, 8, 4], plateIds: [1] }, merge))
      === json({ type: "multi", nodeIds: [2, 9], beamIds: [3, 4], plateIds: [1] })
    && openFem3DSelectionAfterMerge(null, merge) === null);
}

log("\n[10] de bedrading");
{
  const app = bron("src", "App.tsx");
  const setter = app.slice(app.indexOf("const setOpenFem3d = useCallback"), app.indexOf("const [openFem3dTool, setOpenFem3dTool]"));
  check("App: elke bewerking (setOpenFem3d) voegt samen in dezelfde stap en meldt het",
    setter.includes("openFem3DEditWithAutoConnect(current, model, snap, meta?.historyGroup)")
    && setter.includes("changedLockedOpenFem3DLayer(current, stap.model)")
    && /if \(stap\.merge\) \{\s*meldOpenFem3DSamenvoegen\([\s\S]{0,200}femRef\.current\.structuralGrid\.zAxes\);/.test(setter)
    && setter.includes("return stap;"), setter.slice(0, 1200));
  check("App: ook na een levelwijziging (met de nieuwe levels voor de namen)",
    /const commitLevels = useCallback[\s\S]{0,1400}if \(stap\.merge\) \{\s*meldOpenFem3DSamenvoegen\([\s\S]{0,200}nextLevels\);/.test(app));
  check("App: de melding vertaalt level-id's naar namen met de levels van het stramien",
    /function meldOpenFem3DSamenvoegen\(stap: OpenFem3DMergeStep, levels: readonly OpenFem3DLevel\[\]\): void \{\s*const message = openFem3DMergeMessage\(stap\.result, stap\.context, levels\);/.test(app)
    && /const handleOpenFem3DMergeNodes = [\s\S]{0,600}meldOpenFem3DSamenvoegen\(stap, fem\.structuralGrid\.zAxes\);/.test(app));
  // Openen van een project verandert niets (punt 3 van #75): pasProjectToe en
  // replaceModel (bedieningskanaal) zetten het model alleen in de historie
  // ({ type: "replace" }), niet door de pijplijn of een knop.
  const deel = (begin, eind) => app.slice(app.indexOf(begin), app.indexOf(eind, app.indexOf(begin)));
  const openen = deel("const pasProjectToe = useCallback", "const handleOpenProject = useCallback");
  const vervangen = deel("replaceModel: (model, levels) => {", "applySteelHall:");
  const samenvoegWeg = /openFem3DEditWithAutoConnect|setOpenFem3d\(|openFem3DMergeButton|meldOpenFem3DSamenvoegen|mergeOpenFem3DNodes|handleOpenFem3DMergeNodes|sluitAanNaImport|type: "edit"/;
  check("App: openen (pasProjectToe) en vervangen (replaceModel) zetten het model alleen in de historie, zonder samenvoegen of aansluiten",
    openen.length > 1000 && openen.includes('dispatchOpenFem3D({ type: "replace", model: withoutUnknownOpenFem3DLevelLinks(')
    && !samenvoegWeg.test(openen)
    && vervangen.length > 100 && vervangen.includes('dispatchOpenFem3D({ type: "replace", model });') && !samenvoegWeg.test(vervangen),
    `openen: ${openen.match(samenvoegWeg)?.[0] ?? "-"}, vervangen: ${vervangen.match(samenvoegWeg)?.[0] ?? "-"}`);
  check("App: de lintknop en de knop in de modelcontrole: de stap van de knop met de selectie en de snapinstellingen, één stap",
    /const handleOpenFem3DMergeNodes = [\s\S]{0,300}openFem3DMergeButton\(current, openFem3dSelection, leesSnapInstellingen\(\), bereik\)/.test(app)
    && /onOpenFem3DMergeNodes=\{\(\) => handleOpenFem3DMergeNodes\("selectie"\)\}/.test(app)
    && /onMergeNodes=\{\(\) => handleOpenFem3DMergeNodes\("model"\)\}/.test(app));
  check("App: voegt nergens zelf samen buiten de stappen om", !/mergeOpenFem3DNodes\(|autoMergeOpenFem3DEdit\(/.test(app));
  const editor = bron("src", "components", "openFem3d", "OpenFem3DEditor.tsx");
  check("editor: de modelcontrole met de samenvallende knopen (live, met de tolerantie) en de knop Samenvoegen",
    /openFem3DMergeCheck\(model, verbindingsTolerantie\)/.test(editor) && /mergeGroups=\{samenvoegControle\.groups\}/.test(editor)
    && /onMerge=\{voegKnopenSamen\}/.test(editor));
  check("editor: de selectie na een transformatie volgt het samenvoegen en het aansluiten",
    editor.includes("setSelection(openFem3DSelectionAfterAutoEdit(transformed.selection, stap));"));
  const kaartBron = bron("src", "components", "openFem3d", "OpenFem3DModelCheck.tsx");
  check("editor en kaart: de levels van het stramien gaan mee naar de regel van een weigering (namen in plaats van id's)",
    /onMerge=\{voegKnopenSamen\} levels=\{levels\}/.test(editor) && /const levels = structuralGrid\?\.zAxes \?\? \[\];/.test(editor)
    && kaartBron.includes("openFem3DMergeRefusalPart(geweigerd, levels)"));
  const canvas = bron("src", "components", "openFem3d", "ThreeFrameCanvas.tsx");
  check("tekenvlak: met de schakelaar aan wordt een getekend punt binnen de tolerantie de bestaande knoop",
    /snapsRef\.current\.knopenAansluiten[\s\S]{0,900}openFem3DNodeNearPoint\(current\.nodes, position, snapsRef\.current\.verbindingsTolerantie/.test(canvas));
  check("tekenvlak: een klik op een staaf binnen de tolerantie van een staafeind wordt die eindknoop, vóór het splitsen (raakpunt, voetpunt, snijpunt)",
    /const opStaaf = [\s\S]{0,1200}if \(snapsRef\.current\.knopenAansluiten\) \{\s*const eind = openFem3DBeamEndNear\(staaf\.start, staaf\.end, ratio, snapsRef\.current\.verbindingsTolerantie\);\s*if \(eind !== null\) \{[\s\S]{0,120}return eind;[\s\S]{0,40}\}\s*\}\s*const split = splitOpenFem3DBeam\(current, staaf\.beam\.id, ratio\);/.test(canvas));
  check("tekenvlak: de tussenknoop (addSubNode) ook: binnen de tolerantie van een staafeind de eindknoop, geen splitsing",
    /activeTool === "addSubNode"[\s\S]{0,1400}const eind = snapsRef\.current\.knopenAansluiten && ratio > 1e-6 && ratio < 1 - 1e-6\s*\? openFem3DBeamEndNear\(start, end, ratio, snapsRef\.current\.verbindingsTolerantie\) : null;[\s\S]{0,250}else if \(eind !== null\) selectRef\.current\(\{ type: "node", id: eind \}\);\s*else \{\s*const split = splitOpenFem3DBeam\(current, id, ratio\);/.test(canvas));
  const lint = bron("src", "components", "ribbon", "HomeTab.tsx");
  check("lint: de knop Knopen samenvoegen in de groep Bewerken (3D)",
    /label=\{t\("home\.modify"\)\}[\s\S]*label=\{t\("openFem3d\.mergeNodes"\)\}[\s\S]*label=\{t\("home\.selection"\)\}/.test(lint)
    && /onClick=\{onOpenFem3DMergeNodes\}/.test(lint));
  check("lint: elk icoon met zijn eigen uitleg erboven (samenvoegen, aansluiten)",
    /\/\*\* Knopen samenvoegen:[^\n]*\*\/\nconst mergeNodesIcon = /.test(lint) && /\/\*\* Knopen aansluiten:[^\n]*\*\/\nconst connectNodesIcon = /.test(lint));
  const dekking = bron("src", "api", "dekking.ts");
  check("dekking: lintknop en de knop in de modelcontrole → model3d.nodes.merge",
    /"ribbon:openFem3d\.mergeNodes": \{ commando: "model3d\.nodes\.merge" \}/.test(dekking)
    && /"openFem3d\.modelCheck\.mergeTitle": \{ commando: "model3d\.nodes\.merge" \}/.test(dekking));
  const sleutels = {
    ribbon: [
      "openFem3d.mergeNodes", "openFem3d.mergeNodesHint", "openFem3d.mergeNodesDone_one", "openFem3d.mergeNodesDone_other",
      "openFem3d.mergeNodesNone", "openFem3d.mergeNodesGroup_one", "openFem3d.mergeNodesGroup_other", "openFem3d.mergeNodesMore_one",
      "openFem3d.mergeNodesMore_other", "openFem3d.mergeNodesMoreRefused_one", "openFem3d.mergeNodesMoreRefused_other",
      "openFem3d.mergeNodesBeamRemoved_one", "openFem3d.mergeNodesBeamRemoved_other",
      "openFem3d.mergeNodesBeamMerged_one", "openFem3d.mergeNodesBeamMerged_other",
      "openFem3d.mergeNodesBeamMergedReversed_one", "openFem3d.mergeNodesBeamMergedReversed_other",
      "openFem3d.mergeNodesPlate_one", "openFem3d.mergeNodesPlate_other", "openFem3d.mergeNodesSpringOverruled", "openFem3d.mergeNodesDiaphragmRemoved",
      "openFem3d.mergeNodesFailed_one", "openFem3d.mergeNodesFailed_other", "openFem3d.mergeNodesSkipped_one", "openFem3d.mergeNodesSkipped_other",
      "openFem3d.mergeNodesScopeSelection_one", "openFem3d.mergeNodesScopeSelection_other", "openFem3d.mergeNodesScopeAll", "openFem3d.mergeNodesScopeAuto",
      ...["tooWide", "existingNodes", "levels", "levelPlate", "diaphragms", "diaphragmHeight", "springs", "prescribed", "beamProperties", "beamExcluded",
        "plateCorners", "plateLoop", "plateArc", "plateNotPlanar", "openingCorners", "openingLoop", "openingArc", "openingNotPlanar",
        "plateEdgeSupport", "panelCorners", "panelLoop", "panelInvalid", "invalid"].map((k) => `openFem3d.mergeNodesRefusal.${k}`),
      ...["profile", "material", "orientation", "releases", "tensionOnly", "bedding", "checkConfig", "group"].map((k) => `openFem3d.mergeNodesProperty.${k}`),
      "openFem3d.modelCheck.mergeHeading_one", "openFem3d.modelCheck.mergeHeading_other", "openFem3d.modelCheck.mergeLine_one",
      "openFem3d.modelCheck.mergeLine_other", "openFem3d.modelCheck.merge", "openFem3d.modelCheck.mergeTitle", "openFem3d.modelCheck.mergeNothing",
    ],
    common: ["zichtbaarheid.knopenAansluiten", "zichtbaarheid.knopenAansluitenHint"],
  };
  const pak = (o, pad) => pad.split(".").reduce((x, k) => x?.[k], o);
  for (const taal of ["nl", "en", "de", "fr"]) {
    const ontbreekt = Object.entries(sleutels).flatMap(([ns, lijst]) => {
      const tekst = JSON.parse(bron("src", "i18n", "locales", taal, `${ns}.json`));
      return lijst.filter((s) => typeof pak(tekst, s) !== "string" || !pak(tekst, s).trim()).map((s) => `${ns}:${s}`);
    });
    check(`teksten in ${taal}`, ontbreekt.length === 0, ontbreekt.join(", "));
    const r = JSON.parse(bron("src", "i18n", "locales", taal, "ribbon.json")).openFem3d;
    const zonderMm = ["mergeNodesScopeSelection_one", "mergeNodesScopeSelection_other", "mergeNodesScopeAll", "mergeNodesScopeAuto"]
      .filter((k) => !r[k].includes("{{mm}}"));
    check(`… ${taal}: de regel van het bereik noemt de tolerantie ({{mm}}), de titel 'niets te doen' niet nog eens`,
      zonderMm.length === 0 && !r.mergeNodesNone.includes("{{mm}}") && r.mergeNodesRefusal.existingNodes.includes("{{existing}}"),
      zonderMm.join(", "));
  }
  const nl = JSON.parse(bron("src", "i18n", "locales", "nl", "common.json"));
  check("de schakelaar heet nu 'Knopen automatisch samenvoegen en aansluiten' en noemt beide in de uitleg",
    nl.zichtbaarheid.knopenAansluiten === "Knopen automatisch samenvoegen en aansluiten"
    && /samengevoegd/.test(nl.zichtbaarheid.knopenAansluitenHint) && /gesplitst/.test(nl.zichtbaarheid.knopenAansluitenHint));
  const ribbonNl = JSON.parse(bron("src", "i18n", "locales", "nl", "ribbon.json"));
  check("de melding 'automatisch' van het aansluiten noemt de nieuwe naam van de schakelaar",
    ribbonNl.openFem3d.connectNodesScopeAuto.includes("Knopen automatisch samenvoegen en aansluiten")
    && ribbonNl.openFem3d.mergeNodesScopeAuto.includes("Knopen automatisch samenvoegen en aansluiten"));
}

log("\n[11] grote modellen: de modelcontrole schaalt lineair");
{
  // Een raster van N × N kolommen (voet en kop) met liggers die elk hun eigen
  // eindknopen hebben, 2 mm naast de kolomkop: per kop één groep van tot vijf
  // knopen. De modelcontrole voegt het hele model op proef samen, bij elke
  // wijziging van de geometrie. Met een werkmodel met indexen kost een groep
  // alleen wat eraan hangt; zonder (elke groep het hele model) groeit de tijd
  // per groep met het model mee (gemeten: 5,9 × van 15 × 15 naar 40 × 40).
  const raster = (N) => {
    const nodes = [], beams = [];
    let nid = 1, bid = 1;
    for (let i = 0; i < N; i++) for (let k = 0; k < N; k++) {
      nodes.push({ id: nid++, x: i * 6, y: k * 6, z: 0 }, { id: nid++, x: i * 6, y: k * 6, z: 4 });
      beams.push({ id: bid++, startNodeId: nid - 2, endNodeId: nid - 1 });
    }
    for (let i = 0; i < N; i++) for (let k = 0; k < N; k++) {
      if (i + 1 < N) {
        nodes.push({ id: nid++, x: i * 6 + 0.002, y: k * 6, z: 4 }, { id: nid++, x: (i + 1) * 6 - 0.002, y: k * 6, z: 4 });
        beams.push({ id: bid++, startNodeId: nid - 2, endNodeId: nid - 1 });
      }
      if (k + 1 < N) {
        nodes.push({ id: nid++, x: i * 6, y: k * 6 + 0.002, z: 4 }, { id: nid++, x: i * 6, y: (k + 1) * 6 - 0.002, z: 4 });
        beams.push({ id: bid++, startNodeId: nid - 2, endNodeId: nid - 1 });
      }
    }
    return parseOpenFem3DModel({ nodes, beams, ...leeg });
  };
  const meet = (model) => {
    let ms = Infinity, controle;
    for (let r = 0; r < 5; r++) { const t0 = performance.now(); controle = openFem3DMergeCheck(model, 5); ms = Math.min(ms, performance.now() - t0); }
    return { controle, ms };
  };
  const klein = raster(15), groot = raster(40);
  meet(klein);
  const k = meet(klein), g = meet(groot);
  check("40 × 40: 1600 groepen (elke kolomkop), 6240 knopen samen te voegen, niets geweigerd",
    g.controle.groups.length === 1600 && g.controle.mergeable === 6240 && g.controle.refused.length === 0, json(g.controle.refused.slice(0, 3)));
  const verhouding = (g.ms / g.controle.groups.length) / (k.ms / k.controle.groups.length);
  check(`de tijd per groep groeit niet met het model: ${k.ms.toFixed(1)} ms voor ${k.controle.groups.length} groepen, `
    + `${g.ms.toFixed(1)} ms voor ${g.controle.groups.length} (verhouding per groep ${verhouding.toFixed(2)}, grens 2,5)`, verhouding < 2.5);
  const samen = mergeOpenFem3DNodes(groot);
  const kop = (i, k) => 2 * (i * 40 + k) + 2;
  const ligger = samen.model.beams.find((b) => b.id === 1601);
  check("… en echt samengevoegd: 3200 knopen over, elke ligger tussen twee kolomkoppen, het model opent weer",
    samen.model.nodes.length === 3200 && ligger.startNodeId === kop(0, 0) && ligger.endNodeId === kop(1, 0)
    && samen.model.beams.every((b) => b.id <= 1600 || (b.startNodeId <= 3200 && b.endNodeId <= 3200))
    && fout(() => parseOpenFem3DModel(samen.model)) === null, json(ligger));
}

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

// Knopen op staven aansluiten in 3D (issue #63). Een knoop die op een staaf
// ligt (binnen de verbindingstolerantie op de as, niet bij een staafeinde)
// maar er niet aan vastzit, wordt aangesloten door de staaf op die knoop te
// splitsen; meerdere knopen op één staaf in één keer.
//
//  [1] de zuivere functie: een ligger met drie tussenknopen wordt vier staven,
//      met lijnlasten (trapezium, gedeeltelijk, lokaal en globaal),
//      puntlasten, temperatuur, scharnieren aan de juiste einden, profiel,
//      materiaal, rolhoek, bedding en groep; het verslag;
//  [2] een knoop binnen 5 mm naast de as: niet verschoven, de delen lopen
//      naar de knoop, de lastposities schalen mee; net buiten de tolerantie,
//      net voorbij of vlak bij een staafeinde (langs de as gemeten, ook op
//      een balk met bedding): niets;
//  [2b] lastgrenzen precies op de knoop met coördinaten die binair niet
//      exact zijn: geen last van lengte 0, geen snipper, opslaan en openen;
//      een fuzz op en naast de as, verticaal en schuin;
//  [3] tolerantie, bereik (knopen, staven), twee knopen vlak bij elkaar, een
//      staaf die dubbel zou komen, trek-alleen, opnieuw toepassen;
//  [4] automatisch na een bewerking: alleen wat de bewerking raakte (nieuwe
//      of verplaatste knoop, nieuwe of verplaatste staaf, kopiëren), niet bij
//      een lastwijziging of het openen van een oud project, niet met de
//      schakelaar uit of tijdens een tekengroep; één stap ongedaan maken;
//  [4b] de stappen die App aanroept: schakelaar, tolerantie in mm, het bereik
//      uit de selectie (een kolom met haar voet) en het importeren;
//  [4c] de selectie na een transformatie die een staaf splitste: twee keer
//      verplaatsen, een kopie van een kopie;
//  [5] de modelcontrole (waarschuwing per knoop, met de reden als aansluiten
//      niet kan), het bereik vanuit de selectie en de melding (ook als alles
//      overgeslagen is: overlappende staven);
//  [6] de instelling (bewaard met de snapinstellingen, standaard aan) en de
//      bedrading: App, editor, browserproef, lint, tab Weergave, teksten in
//      vier talen.
//
// Uitvoeren: npx tsx test-open-fem3d-aansluiten.mjs   (vanuit design-mockup/)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { parseOpenFem3DModel, addOpenFem3DNode, addOpenFem3DBeam, addOpenFem3DPlate, updateOpenFem3DNode, updateOpenFem3DMemberLoad } =
  await import("./src/components/openFem3d/openFem3dModel.ts");
const {
  OPEN_FEM_3D_CONNECT_TOLERANCE_MM, autoConnectOpenFem3DEdit, connectOpenFem3DNodesToBeams, findOpenFem3DNodesOnBeams,
  openFem3DConnectMessage, openFem3DConnectScope, openFem3DGeometryChanges, openFem3DEditWithAutoConnect, openFem3DConnectButton,
  openFem3DConnectAfterImport, openFem3DSelectionAfterConnect, openFem3DConnectCheck,
} = await import("./src/components/openFem3d/openFem3dAansluiten.ts");
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
const lengte = (model, id) => {
  const b = staaf(model, id), a = knoop(model, b.startNodeId), e = knoop(model, b.endNodeId);
  return Math.hypot(e.x - a.x, e.y - a.y, e.z - a.z);
};
/** Resultante van een lineaire lijnlast (kN): het gemiddelde maal de belaste lengte. */
const resultante = (q0, q1, s0, s1) => (q0 + q1) / 2 * (s1 - s0);

// ── Het model ─────────────────────────────────────────────────────────────
// Een funderingsbalk van 12 m langs X (knoop 1 → 2, IPE 300 S355, rolhoek
// 0,3 rad, groep "fundering", op bedding) met drie kolommen erop (voeten 3, 4,
// 5 op x = 3, 6 en 9 m; koppen 6, 7, 8). De voeten liggen op de balk maar
// zitten er niet aan vast. Begin: My en Mz los; eind: alleen My los.
const RELEASES = { myStart: true, mzStart: true, torsionStart: false, myEnd: true, mzEnd: false, torsionEnd: false };
const balkMetKolommen = () => parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 12, y: 0, z: 0 },
    { id: 3, x: 3, y: 0, z: 0 }, { id: 4, x: 6, y: 0, z: 0 }, { id: 5, x: 9, y: 0, z: 0 },
    { id: 6, x: 3, y: 0, z: 3 }, { id: 7, x: 6, y: 0, z: 3 }, { id: 8, x: 9, y: 0, z: 3 },
  ],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 300", material: "S355", rollAngleRad: 0.3,
      releases: RELEASES, group: "fundering", name: "Balk A", bedding: { kKnPerM3: 20000, widthM: 0.6 } },
    { id: 2, startNodeId: 3, endNodeId: 6, profileName: "HEA 200", material: "S235" },
    { id: 3, startNodeId: 4, endNodeId: 7, profileName: "HEA 200", material: "S235" },
    { id: 4, startNodeId: 5, endNodeId: 8, profileName: "HEA 200", material: "S235" },
  ],
  supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: false, rz: false }],
  loads: [{ id: 1, nodeId: 7, fx: 0, fy: 0, fz: -50, mx: 0, my: 0, mz: 0 }],
  memberLoads: [
    // Lokaal trapezium, gedeeltelijk: qz −2 → −6 kN/m van 2 tot 10 m.
    { id: 1, beamId: 1, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -2, qzEnd: -6, startPositionM: 2, endPositionM: 10 },
    // Globaal Z over de hele balk, −3 kN/m.
    { id: 2, beamId: 1, caseId: 2, globalDirection: "z", qStart: -3, qEnd: -3, startPositionM: 0, endPositionM: 12 },
    // Globaal Y, trapezium van 1 tot 11 m, per projectie.
    { id: 3, beamId: 1, caseId: 2, globalDirection: "y", qStart: 1, qEnd: 4, perProjection: true, startPositionM: 1, endPositionM: 11 },
    // Alleen op het laatste stuk: 10 tot 12 m.
    { id: 4, beamId: 1, caseId: 1, qyStart: 0.5, qyEnd: 0.5, qzStart: 0, qzEnd: 0, startPositionM: 10, endPositionM: 12 },
  ],
  memberPointLoads: [
    { id: 1, beamId: 1, caseId: 1, py: 0, pz: -10, positionM: 7.5 },
    { id: 2, beamId: 1, caseId: 1, py: 2, pz: 0, positionM: 1 },
  ],
  thermalLoads: [{ id: 1, beamId: 1, deltaTUniformK: 15, deltaTGradientYK: 0, deltaTGradientZK: 5 }],
});

log("[1] een ligger met drie tussenknopen wordt vier staven");
{
  const voor = balkMetKolommen();
  const gevonden = findOpenFem3DNodesOnBeams(voor);
  check("de controle vindt de drie kolomvoeten op staaf 1, op volgorde langs de staaf",
    json(gevonden.map((g) => [g.nodeId, g.beamId])) === json([[3, 1], [4, 1], [5, 1]])
    && dicht(gevonden[0].t, 0.25) && dicht(gevonden[1].t, 0.5) && dicht(gevonden[2].t, 0.75)
    && gevonden.every((g) => g.distanceM === 0), json(gevonden));
  check("standaardtolerantie 5 mm, gelijk aan 2D", OPEN_FEM_3D_CONNECT_TOLERANCE_MM === 5);
  const r = connectOpenFem3DNodesToBeams(voor);
  const na = r.model;
  check("vier delen: 1 (1→3), 5 (3→4), 6 (4→5), 7 (5→2); de oorspronkelijke id blijft bij het eerste deel",
    json([1, 5, 6, 7].map((id) => [staaf(na, id)?.startNodeId, staaf(na, id)?.endNodeId])) === json([[1, 3], [3, 4], [4, 5], [5, 2]])
    && na.beams.length === 7, json(na.beams.map((b) => [b.id, b.startNodeId, b.endNodeId])));
  check("het verslag: staaf 1 in vier delen op knopen 3, 4 en 5",
    json(r.splits) === json([{ beamId: 1, nodeIds: [3, 4, 5], beamIds: [1, 5, 6, 7], parts: 4 }])
    && r.nodeCount === 3 && r.skipped.length === 0, json(r));
  check("de knopen zijn niet verplaatst en er is geen knoop bijgekomen",
    json(na.nodes) === json(voor.nodes));
  check("het model opent weer (parseOpenFem3DModel)", fout(() => parseOpenFem3DModel(na)) === null, fout(() => parseOpenFem3DModel(na)));
  const delen = [1, 5, 6, 7].map((id) => staaf(na, id));
  check("profiel, materiaal, rolhoek, groep, naam en bedding op elk deel",
    delen.every((b) => b.profileName === "IPE 300" && b.material === "S355" && b.rollAngleRad === 0.3 && b.group === "fundering"
      && b.name === "Balk A" && b.bedding?.kKnPerM3 === 20000 && b.bedding?.widthM === 0.6), json(delen));
  check("scharnieren: het begin op het eerste deel, het eind op het laatste, ertussen momentvast",
    staaf(na, 1).releases.myStart && staaf(na, 1).releases.mzStart && !staaf(na, 1).releases.myEnd && !staaf(na, 1).releases.mzEnd
    && [5, 6].every((id) => Object.values(staaf(na, id).releases).every((v) => v === false))
    && staaf(na, 7).releases.myEnd && !staaf(na, 7).releases.mzEnd && !staaf(na, 7).releases.myStart,
    json(delen.map((b) => b.releases)));
  // Lokaal trapezium −2 → −6 van 2 tot 10 m: q(x) = −2 − 0,5·(x − 2).
  const lokaal = na.memberLoads.filter((l) => l.qzStart !== undefined && l.qzStart !== 0 || l.qzEnd);
  const perDeel = (id) => na.memberLoads.filter((l) => l.beamId === id);
  const trap = (id) => perDeel(id).find((l) => l.caseId === 1 && l.qzStart !== undefined && (l.qzStart !== 0 || l.qzEnd !== 0));
  check("lokaal trapezium per deel: [2,3] −2→−2,5; [0,3] −2,5→−4; [0,3] −4→−5,5; [0,1] −5,5→−6",
    json([1, 5, 6, 7].map((id) => { const l = trap(id); return [l.startPositionM, l.endPositionM, l.qzStart, l.qzEnd]; }))
      === json([[2, 3, -2, -2.5], [0, 3, -2.5, -4], [0, 3, -4, -5.5], [0, 1, -5.5, -6]]),
    json([1, 5, 6, 7].map((id) => trap(id))));
  check("… de resultante blijft −32 kN",
    dicht(lokaal.filter((l) => l.caseId === 1 && l.qzStart !== 0).reduce((s, l) => s + resultante(l.qzStart, l.qzEnd, l.startPositionM, l.endPositionM), 0), -32));
  const globaalZ = na.memberLoads.filter((l) => l.globalDirection === "z");
  check("globaal Z over de hele balk: vier delen van 3 m, −3 kN/m, geval 2",
    globaalZ.length === 4 && globaalZ.every((l) => l.qStart === -3 && l.qEnd === -3 && l.caseId === 2 && l.startPositionM === 0 && dicht(l.endPositionM, 3)),
    json(globaalZ));
  const globaalY = na.memberLoads.filter((l) => l.globalDirection === "y");
  check("globaal Y trapezium per projectie: per deel geïnterpoleerd, per projectie op elk deel, resultante 25 kN",
    globaalY.length === 4 && globaalY.every((l) => l.perProjection === true)
    && dicht(globaalY.reduce((s, l) => s + resultante(l.qStart, l.qEnd, l.startPositionM, l.endPositionM), 0), 25)
    && dicht(globaalY.find((l) => l.beamId === 5).qStart, 1.6) && dicht(globaalY.find((l) => l.beamId === 7).qEnd, 4),
    json(globaalY));
  check("een last alleen op het laatste stuk (10 tot 12 m) staat op deel 7 van 1 tot 3 m",
    json(perDeel(7).filter((l) => l.qyStart === 0.5).map((l) => [l.startPositionM, l.endPositionM])) === json([[1, 3]]));
  const punt = na.memberPointLoads;
  check("puntlasten: 7,5 m → deel 6 op 1,5 m; 1 m → deel 1 op 1 m",
    punt.find((p) => p.id === 1).beamId === 6 && dicht(punt.find((p) => p.id === 1).positionM, 1.5)
    && punt.find((p) => p.id === 2).beamId === 1 && punt.find((p) => p.id === 2).positionM === 1, json(punt));
  check("temperatuur op elk deel, met dezelfde waarden",
    json([1, 5, 6, 7].map((id) => na.thermalLoads.filter((l) => l.beamId === id).map((l) => [l.deltaTUniformK, l.deltaTGradientZK])))
      === json([[[15, 5]], [[15, 5]], [[15, 5]], [[15, 5]]]), json(na.thermalLoads));
  check("de kolommen en hun knooplast blijven zoals ze waren",
    json(na.beams.filter((b) => b.id >= 2 && b.id <= 4)) === json(voor.beams.filter((b) => b.id >= 2 && b.id <= 4))
    && json(na.loads) === json(voor.loads));
  check("opnieuw aansluiten vindt niets en geeft hetzelfde model terug",
    findOpenFem3DNodesOnBeams(na).length === 0 && connectOpenFem3DNodesToBeams(na).model === na);
}

log("\n[2] een knoop naast de as, bij een staafeinde of voorbij het eind");
{
  // Ligger 10 m langs X met een gelijkmatige last over de hele lengte en een
  // puntlast op 7 m. Knoop 3 ligt 3 mm naast de as op 4 m.
  const ligger = (extra) => parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 10, y: 0, z: 0 }, ...extra],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 300", material: "S235" }],
    supports: [], loads: [],
    memberLoads: [{ id: 1, beamId: 1, qyStart: 0, qyEnd: 0, qzStart: -4, qzEnd: -4, startPositionM: 0, endPositionM: 10 }],
    memberPointLoads: [{ id: 1, beamId: 1, py: 0, pz: -5, positionM: 7 }],
  });
  const naast = ligger([{ id: 3, x: 4, y: 0.003, z: 0 }]);
  const gevonden = findOpenFem3DNodesOnBeams(naast);
  check("3 mm naast de as: gevonden, afstand 3 mm", gevonden.length === 1 && dicht(gevonden[0].distanceM, 0.003) && dicht(gevonden[0].t, 0.4),
    json(gevonden));
  const na = connectOpenFem3DNodesToBeams(naast).model;
  check("de knoop is NIET verschoven; de delen lopen naar de knoop (1→3, 3→2)",
    json(knoop(na, 3)) === json({ id: 3, x: 4, y: 0.003, z: 0 })
    && staaf(na, 1).endNodeId === 3 && staaf(na, 2).startNodeId === 3 && staaf(na, 2).endNodeId === 2);
  const l1 = lengte(na, 1), l2 = lengte(na, 2);
  const last1 = na.memberLoads.find((l) => l.beamId === 1), last2 = na.memberLoads.find((l) => l.beamId === 2);
  check("de lijnlast dekt elk deel precies (eind = de werkelijke deellengte)",
    last1.startPositionM === 0 && dicht(last1.endPositionM, l1, 1e-12) && last2.startPositionM === 0 && dicht(last2.endPositionM, l2, 1e-12)
    && l1 > 4 && l2 > 6, json([last1, last2, l1, l2]));
  check("… de resultante wijkt minder dan 1e-6 relatief af (−40 kN)",
    Math.abs((-4 * (l1 + l2)) / -40 - 1) < 1e-6);
  const punt = na.memberPointLoads[0];
  check("de puntlast op 7 m staat op deel 2, op 3 m langs dat deel (geschaald)",
    punt.beamId === 2 && dicht(punt.positionM, 3 * l2 / 6, 1e-12), json(punt));
  check("het model opent weer", fout(() => parseOpenFem3DModel(na)) === null, fout(() => parseOpenFem3DModel(na)));
  check("5 mm schuin naast de as (3 en 4 mm): nog net aangesloten",
    findOpenFem3DNodesOnBeams(ligger([{ id: 3, x: 4, y: 0.003, z: 0.004 }])).length === 1);
  check("6 mm naast de as: niet", findOpenFem3DNodesOnBeams(ligger([{ id: 3, x: 4, y: 0.006, z: 0 }])).length === 0);
  check("met 10 mm tolerantie wel", findOpenFem3DNodesOnBeams(ligger([{ id: 3, x: 4, y: 0.006, z: 0 }]), 10).length === 1);
  const voorbij = ligger([{ id: 3, x: 10.002, y: 0, z: 0 }]);
  check("een knoop net voorbij het staafeinde (2 mm) splitst niet",
    findOpenFem3DNodesOnBeams(voorbij).length === 0 && connectOpenFem3DNodesToBeams(voorbij).model === voorbij);
  const bijEind = ligger([{ id: 3, x: 0.004, y: 0, z: 0 }, { id: 4, x: 9.996, y: 0.001, z: 0 }]);
  check("een knoop binnen de tolerantie van een staafeinde (4 mm erin) maakt geen stompje",
    findOpenFem3DNodesOnBeams(bijEind).length === 0);
  check("net verder dan de tolerantie van het eind (6 mm erin) wel",
    findOpenFem3DNodesOnBeams(ligger([{ id: 3, x: 0.006, y: 0, z: 0 }])).length === 1);
  // De eindmarge langs de as (anders dan 2D): een kolomvoet vlak bij het
  // begin van een funderingsbalk op bedding, net naast de as. Met de afstand
  // tot de eindknoop werd 1,5 mm erin en 4,9 mm erboven een steil stompje van
  // ~5 mm (|ez| 0,96), en weigerde opslaan het model (geen verticale k).
  const voetBijEind = (voet) => parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 10, y: 0, z: 0 }, { id: 3, x: voet[0], y: voet[1], z: voet[2] }, { id: 4, x: voet[0], y: 0, z: 3 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA 300", material: "S235", bedding: { kKnPerM3: 20000, widthM: 0.6 } },
      { id: 2, startNodeId: 3, endNodeId: 4, profileName: "HEA 200", material: "S235" }],
  });
  check("eindmarge langs de as: 1,5 mm erin en 4,9 mm naast de as ligt niet op de staaf (geen stompje), ook niet 1 mm erin en 5 mm ernaast",
    findOpenFem3DNodesOnBeams(voetBijEind([0.0015, 0, 0.0049])).length === 0 && findOpenFem3DNodesOnBeams(voetBijEind([0.001, 0, 0.005])).length === 0
    && connectOpenFem3DNodesToBeams(voetBijEind([0.0015, 0, 0.0049])).splits.length === 0);
  {
    const verder = connectOpenFem3DNodesToBeams(voetBijEind([0.0051, 0, 0.0049]));
    const deel = staaf(verder.model, 1), a = knoop(verder.model, deel.startNodeId), e = knoop(verder.model, deel.endNodeId);
    const ez = Math.abs(e.z - a.z) / lengte(verder.model, 1);
    const { serializeProject } = await import("./src/io/projectFile.ts");
    check("5,1 mm erin en 4,9 mm ernaast wel: het eerste deel is hoogstens 45° steil (|ez| < 0,95), en de balk op bedding is op te slaan",
      verder.splits.length === 1 && ez <= Math.SQRT1_2 + 1e-9
      && fout(() => serializeProject({ modelDimension: "3d", model3d: verder.model })) === null,
      `|ez| ${ez.toFixed(3)}; ${fout(() => serializeProject({ modelDimension: "3d", model3d: verder.model }))}`);
  }
}

log("\n[2b] lastgrenzen precies op de knoop, met coördinaten die binair niet exact zijn");
{
  const { serializeProject, deserializeProject } = await import("./src/io/projectFile.ts");
  // Een ligger in hele mm van (10,243; 28,757; 0,822) naar (20,225; …): de
  // kolomvoet op x = 10,243 + 7,6 geeft een knipafstand van 7,6000000000000005.
  // De lasten lopen tot en vanaf 7,6 m: precies de knoop.
  const zonder = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 10.243, y: 28.757, z: 0.822 }, { id: 2, x: 20.225, y: 28.757, z: 0.822 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 300", material: "S235" }],
    memberLoads: [
      { id: 1, beamId: 1, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -1, qzEnd: -1, startPositionM: 0, endPositionM: 7.6 },
      { id: 2, beamId: 1, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -2, qzEnd: -2, startPositionM: 7.6, endPositionM: 20.225 - 10.243 },
      { id: 3, beamId: 1, caseId: 2, globalDirection: "z", qStart: -1, qEnd: -3, startPositionM: 7.6, endPositionM: 9 },
    ],
  });
  const met = { ...zonder,
    nodes: [...zonder.nodes, { id: 3, x: 10.243 + 7.6, y: 28.757, z: 0.822 }, { id: 4, x: 10.243 + 7.6, y: 28.757, z: 3.822 }],
    beams: [...zonder.beams, { id: 2, startNodeId: 3, endNodeId: 4, profileName: "HEA 200", material: "S235" }] };
  const auto = autoConnectOpenFem3DEdit(zonder, met, { enabled: true, toleranceMm: 5 });
  const lasten = auto?.model.memberLoads ?? [];
  const l1 = lengte(auto.model, 1);
  check("de kolomvoet wordt aangesloten; geen extra lastregels (drie lasten, elk geheel op één deel)",
    auto !== null && json(auto.splits) === json([{ beamId: 1, nodeIds: [3], beamIds: [1, 3], parts: 2 }]) && lasten.length === 3,
    json(lasten));
  check("last 1 eindigt precies op het eind van deel 1, last 2 en 3 beginnen op 0 van deel 3; geen last van lengte 0",
    json(lasten.map((l) => [l.id, l.beamId, l.startPositionM])) === json([[1, 1, 0], [2, 3, 0], [3, 3, 0]])
    && lasten[0].endPositionM === l1 && lasten.every((l) => l.endPositionM - l.startPositionM > 1e-6), json(lasten));
  const tekst = fout(() => serializeProject({ modelDimension: "3d", model3d: auto.model }));
  check("opslaan, openen en de modelkeuring: rondgang zonder fout, dezelfde lasten",
    tekst === null && (() => {
      const terug = deserializeProject(serializeProject({
        modelDimension: "3d", model3d: auto.model, nodes: [], beams: [], supports: [], plates: [], loads: [], loadCases: [],
      })).model3d;
      return json(parseOpenFem3DModel(terug).memberLoads) === json(auto.model.memberLoads);
    })(), tekst ?? "");
  // Ook de oude knip zonder knoop (handmatig splitsen): een last tot 1e-16 m
  // voorbij het knippunt geeft geen snipper meer op het tweede deel.
  const { splitOpenFem3DBeam } = await import("./src/components/openFem3d/openFem3dModel.ts");
  const ratio = 7.6000000000000005 / (20.225 - 10.243);
  const hand = splitOpenFem3DBeam(zonder, 1, ratio);
  check("handmatig splitsen op dezelfde plek: ook daar geen snipper (~1e-16 m) en geen extra lastregel",
    hand.model.memberLoads.length === 3 && hand.model.memberLoads.every((l) => l.endPositionM - l.startPositionM > 1e-6)
    && fout(() => serializeProject({ modelDimension: "3d", model3d: hand.model })) === null,
    json(hand.model.memberLoads.map((l) => [l.id, l.beamId, l.startPositionM, l.endPositionM])));
  // Een kleine fuzz zoals de review: knopen in hele mm, langs X, 2–4 mm naast
  // de as, verticaal (kolom) en schuin (spant), de lastgrens op de knoop (in
  // hele mm langs de as; bij de schuine staaf de projectie van de afgeronde
  // knoop). Elke last houdt één regel; geen lengte 0, geen snipper; het model
  // is op te slaan.
  let s = 4321;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const mm = (v) => Math.round(v * 1000) / 1000;
  const fouten = [];
  let gevallen = 0;
  for (let i = 0; i < 2000 && fouten.length < 3; i++) {
    const soort = i % 4;
    const a = [mm(rnd() * 30), mm(rnd() * 30), mm(rnd() * 8)];
    const L = mm(2 + rnd() * 12);
    let d = mm(0.3 + rnd() * (L - 0.6));
    let b, p;
    if (soort <= 1) { b = [mm(a[0] + L), a[1], a[2]]; p = [mm(a[0] + d), soort === 1 ? mm(a[1] + 0.002 + rnd() * 0.002) : a[1], a[2]]; }
    else if (soort === 2) { b = [a[0], a[1], mm(a[2] + L)]; p = [a[0], a[1], mm(a[2] + d)]; }
    else {
      const hoek = (5 + rnd() * 40) * Math.PI / 180;
      b = [mm(a[0] + L * Math.cos(hoek)), a[1], mm(a[2] + L * Math.sin(hoek))];
      const Lb = Math.hypot(b[0] - a[0], b[2] - a[2]);
      p = [mm(a[0] + (b[0] - a[0]) * d / Lb), a[1], mm(a[2] + (b[2] - a[2]) * d / Lb)];
      d = ((p[0] - a[0]) * (b[0] - a[0]) + (p[2] - a[2]) * (b[2] - a[2])) / Lb;
    }
    const Lw = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (!(d < Lw - 0.01)) continue;
    const m = parseOpenFem3DModel({
      nodes: [{ id: 1, x: a[0], y: a[1], z: a[2] }, { id: 2, x: b[0], y: b[1], z: b[2] }, { id: 3, x: p[0], y: p[1], z: p[2] }],
      beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }],
      memberLoads: [
        { id: 1, beamId: 1, qyStart: 0, qyEnd: 0, qzStart: -1, qzEnd: -1, startPositionM: 0, endPositionM: d },
        { id: 2, beamId: 1, qyStart: 0, qyEnd: 0, qzStart: -2, qzEnd: -2, startPositionM: d, endPositionM: Lw },
      ],
    });
    const r = connectOpenFem3DNodesToBeams(m);
    if (r.splits.length === 0) continue;
    gevallen++;
    const ls = r.model.memberLoads;
    const opslaan = fout(() => serializeProject({ modelDimension: "3d", model3d: r.model }));
    if (ls.length !== 2 || ls.some((l) => !(l.endPositionM - l.startPositionM > 1e-9)) || opslaan !== null) {
      fouten.push({ a, b, p, d, lasten: ls.map((l) => [l.id, l.beamId, l.startPositionM, l.endPositionM]), opslaan });
    }
  }
  check(`fuzz (${gevallen} knippen op een lastgrens, op en naast de as, verticaal en schuin): elke last één regel, geen lengte 0 of snipper, op te slaan`,
    gevallen > 1500 && fouten.length === 0, json(fouten));
}

log("\n[3] bereik, tolerantie, buren, dubbele staven en trek-alleen");
{
  const r = connectOpenFem3DNodesToBeams(balkMetKolommen(), { nodeIds: [4] });
  check("alleen knoop 4: staaf 1 in twee delen op knoop 4",
    json(r.splits) === json([{ beamId: 1, nodeIds: [4], beamIds: [1, 5], parts: 2 }]), json(r.splits));
  const kruis = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }, { id: 3, x: 2, y: -2, z: 0 }, { id: 4, x: 2, y: 2, z: 0 },
      { id: 5, x: 2, y: 0, z: 0 }, { id: 6, x: 2, y: 1, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 3, endNodeId: 4 }],
  });
  const kruisAlles = connectOpenFem3DNodesToBeams(kruis);
  check("een knoop op twee kruisende staven: beide gesplitst (knoop 5 op 1 en 2, knoop 6 op 2)",
    json(kruisAlles.splits.map((s) => [s.beamId, s.nodeIds])) === json([[1, [5]], [2, [5, 6]]]), json(kruisAlles.splits));
  const alleenStaaf2 = connectOpenFem3DNodesToBeams(kruis, { beamIds: [2] });
  check("alleen staaf 2: staaf 1 blijft heel", json(alleenStaaf2.splits.map((s) => s.beamId)) === json([2]));
  const beide = connectOpenFem3DNodesToBeams(kruis, { nodeIds: [6], beamIds: [1] });
  check("knopen én staven: de paren met een gekozen knoop of een gekozen staaf (6 op 2, 5 op 1)",
    json(beide.splits.map((s) => [s.beamId, s.nodeIds])) === json([[1, [5]], [2, [6]]]), json(beide.splits));
  check("tolerantie begrensd op 0,1–25 mm: 0 → 0,1 mm, 99 → 25 mm",
    findOpenFem3DNodesOnBeams(parseOpenFem3DModel({ nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }, { id: 3, x: 2, y: 0.0002, z: 0 }],
      beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }] }), 0).length === 0
    && findOpenFem3DNodesOnBeams(parseOpenFem3DModel({ nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }, { id: 3, x: 2, y: 0.024, z: 0 }],
      beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }] }), 99).length === 1);
  // Twee knopen 3 mm uit elkaar op de staaf: de tweede zou een stompje van 3 mm maken.
  const buren = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 10, y: 0, z: 0 }, { id: 3, x: 5, y: 0, z: 0 }, { id: 4, x: 5.003, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }],
  });
  const burenR = connectOpenFem3DNodesToBeams(buren);
  check("twee knopen 3 mm uit elkaar: één splitsing, de tweede overgeslagen (te dicht bij een andere knoop)",
    json(burenR.splits) === json([{ beamId: 1, nodeIds: [3], beamIds: [1, 2], parts: 2 }])
    && json(burenR.skipped.map((s) => [s.nodeId, s.beamId, s.reason, s.otherNodeId])) === json([[4, 1, "nearNode", 3]]), json(burenR));
  // Twee staven die elkaar half overlappen: 1 (0→2) en 2 (1→3) op één lijn.
  const overlap = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 2, y: 0, z: 0 }, { id: 3, x: 1, y: 0, z: 0 }, { id: 4, x: 3, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 3, endNodeId: 4 }],
  });
  const overlapFout = fout(() => connectOpenFem3DNodesToBeams(overlap));
  const overlapR = overlapFout ? null : connectOpenFem3DNodesToBeams(overlap);
  check("overlappende staven: geen fout; wat een staaf zou verdubbelen wordt overgeslagen en gemeld",
    overlapR !== null && overlapR.splits.length === 1 && overlapR.skipped.length === 1 && overlapR.skipped[0].reason === "duplicate"
    && overlapR.skipped[0].otherBeamId !== undefined
    && fout(() => parseOpenFem3DModel(overlapR.model)) === null, overlapFout ?? json(overlapR?.skipped));
  const trek = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 3 }, { id: 3, x: 2, y: 0, z: 1.5 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "Rond 20", material: "S235", tensionOnly: true }],
  });
  const trekNa = connectOpenFem3DNodesToBeams(trek).model;
  check("een schuin trek-alleen verband: beide delen trek-alleen, ook schuin",
    trekNa.beams.length === 2 && trekNa.beams.every((b) => b.tensionOnly === true && b.profileName === "Rond 20"));
  // Groot model: boven 50 000 paren zoekt de functie via een raster. Dezelfde
  // uitkomst als alle paren met de hand langslopen (de regel hier opnieuw).
  {
    const nodes = [], beams = [];
    const id = (i, j, k) => 1 + i + 12 * j + 144 * k;
    for (let k = 0; k < 3; k++) for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) nodes.push({ id: id(i, j, k), x: i * 6, y: j * 5, z: k * 3.5 });
    for (let k = 0; k < 3; k++) for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) {
      if (i < 11) beams.push({ id: beams.length + 1, startNodeId: id(i, j, k), endNodeId: id(i + 1, j, k) });
      if (j < 11) beams.push({ id: beams.length + 1, startNodeId: id(i, j, k), endNodeId: id(i, j + 1, k) });
      if (k < 2) beams.push({ id: beams.length + 1, startNodeId: id(i, j, k), endNodeId: id(i, j, k + 1) });
    }
    // Een lang verband schuin over het hele veld, en losse knopen: op een ligger, op een kolom (twee), 3 mm
    // ernaast, 7 mm ernaast, 3 mm van een staafeind, 2 mm van een knoop, op het lange verband, en precies op
    // een bestaande knoop (dubbel, geen knip).
    beams.push({ id: beams.length + 1, startNodeId: id(0, 0, 0), endNodeId: id(11, 11, 2) });
    const los = [[3, 0, 0], [12, 2.5, 7], [42, 0, 1.75], [6, 5, 1], [33, 10.003, 3.5], [12, 2.5, 7.007], [6.003, 20, 0],
      [24, 15.002, 7], [33, 27.5, 3.5], [30, 25, 0]];
    los.forEach(([x, y, z], i) => nodes.push({ id: 1000 + i, x, y, z }));
    const groot = { nodes, beams };
    const knoopOp = new Map(nodes.map((n) => [n.id, n]));
    const hand = [];
    for (const b of beams) for (const p of nodes) {
      if (p.id === b.startNodeId || p.id === b.endNodeId) continue;
      const a = knoopOp.get(b.startNodeId), e = knoopOp.get(b.endNodeId);
      const v = [e.x - a.x, e.y - a.y, e.z - a.z], w = [p.x - a.x, p.y - a.y, p.z - a.z];
      const L = Math.hypot(...v), t = (w[0] * v[0] + w[1] * v[1] + w[2] * v[2]) / (L * L);
      const d = Math.hypot(w[1] * v[2] - w[2] * v[1], w[2] * v[0] - w[0] * v[2], w[0] * v[1] - w[1] * v[0]) / L;
      // De eindmarge langs de as: t·L en (1 − t)·L groter dan de tolerantie.
      if (t > 0 && t < 1 && d <= 0.005 + 1e-12 && t * L > 0.005 + 1e-12 && (1 - t) * L > 0.005 + 1e-12) hand.push(`${p.id}:${b.id}`);
    }
    const tijd = performance.now();
    const viaRaster = findOpenFem3DNodesOnBeams(groot).map((g) => `${g.nodeId}:${g.beamId}`);
    const ms = performance.now() - tijd;
    check(`groot model (${nodes.length} knopen, ${beams.length} staven, via het raster): dezelfde ${hand.length} paren als alle paren langslopen (${ms.toFixed(0)} ms)`,
      hand.length >= 6 && json([...viaRaster].sort()) === json([...hand].sort()), json({ viaRaster, hand }));
  }
  const losseKnoop = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }, { id: 3, x: 2, y: 0.5, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }],
  });
  check("een knoop ver van de staaf: niets, hetzelfde model terug",
    connectOpenFem3DNodesToBeams(losseKnoop).model === losseKnoop && connectOpenFem3DNodesToBeams(losseKnoop).splits.length === 0);
}

log("\n[4] automatisch na een bewerking");
{
  const aan = { enabled: true, toleranceMm: 5 };
  // Een ligger 1→2 met een losse knoop 3 erop: zo staat een oud project open.
  const oud = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 8, y: 0, z: 0 }, { id: 3, x: 2, y: 0, z: 0 },
      { id: 4, x: 0, y: 4, z: 0 }, { id: 5, x: 8, y: 4, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 4, endNodeId: 5 }],
    memberLoads: [{ id: 1, beamId: 2, qyStart: 0, qyEnd: 0, qzStart: -1, qzEnd: -1, startPositionM: 0, endPositionM: 8 }],
  });
  const lastGewijzigd = updateOpenFem3DMemberLoad(oud, 1, { qyStart: 0, qyEnd: 0, qzStart: -2, qzEnd: -2, startPositionM: 0, endPositionM: 8 });
  check("een lastwijziging raakt geen geometrie: niets aangesloten (het oude project verandert niet stil)",
    autoConnectOpenFem3DEdit(oud, lastGewijzigd, aan) === null
    && json(openFem3DGeometryChanges(oud, lastGewijzigd)) === json({ nodeIds: [], beamIds: [] }));
  const { model: metKnoop } = addOpenFem3DNode(oud, { x: 3, y: 4, z: 0 });
  const auto1 = autoConnectOpenFem3DEdit(oud, metKnoop, aan);
  check("een nieuwe knoop op staaf 2: staaf 2 gesplitst op die knoop; de losse knoop 3 op staaf 1 blijft los",
    auto1 !== null && json(auto1.splits) === json([{ beamId: 2, nodeIds: [6], beamIds: [2, 3], parts: 2 }])
    && findOpenFem3DNodesOnBeams(auto1.model).map((g) => g.nodeId).join() === "3", json(auto1?.splits));
  const verplaatst = updateOpenFem3DNode(metKnoop, 6, { x: 5, y: 0, z: 0 });
  const auto2 = autoConnectOpenFem3DEdit(metKnoop, verplaatst, aan);
  check("een knoop verplaatsen naar staaf 1: staaf 1 gesplitst op die knoop (en niet op de losse knoop 3)",
    auto2 !== null && json(auto2.splits) === json([{ beamId: 1, nodeIds: [6], beamIds: [1, 3], parts: 2 }]), json(auto2?.splits));
  const { model: metStaaf } = addOpenFem3DBeam(oud, { startNodeId: 3, endNodeId: 4 });
  const doorKnoop = (() => {
    const { model: m1 } = addOpenFem3DNode(oud, { x: 2, y: -2, z: 0 });
    const { model: m2 } = addOpenFem3DNode(m1, { x: 2, y: 6, z: 0 });
    return m2;
  })();
  const { model: kruisend } = addOpenFem3DBeam(doorKnoop, { startNodeId: 6, endNodeId: 7 });
  const auto3 = autoConnectOpenFem3DEdit(doorKnoop, kruisend, aan);
  check("een nieuwe staaf die door de losse knoop 3 loopt: de nieuwe staaf gesplitst op knoop 3 (staaf 1 en 2 blijven heel)",
    auto3 !== null && json(auto3.splits.map((s) => [s.beamId, s.nodeIds])) === json([[3, [3]]]), json(auto3?.splits));
  check("een nieuwe staaf vanaf de losse knoop 3 (niet door een andere knoop): niets; knoop 3 zelf is niet gewijzigd",
    autoConnectOpenFem3DEdit(oud, metStaaf, aan) === null);
  check("de schakelaar uit: niets", autoConnectOpenFem3DEdit(oud, metKnoop, { ...aan, enabled: false }) === null);
  check("tijdens een tekengroep (een open plaatcontour): niets", autoConnectOpenFem3DEdit(oud, metKnoop, { ...aan, historyGroup: "plaat-1" }) === null);
  // De contour gesloten: de plaat komt erbij (nog in de tekengroep). Haar hoekknoop 6 ligt op staaf 2.
  const plaatModel = (() => {
    let m = addOpenFem3DNode(metKnoop, { x: 3, y: 8, z: 0 }).model;
    m = addOpenFem3DNode(m, { x: 0, y: 8, z: 0 }).model;
    return addOpenFem3DPlate(m, [4, 6, 7, 8]);
  })();
  const metPlaatSchets = { ...plaatModel, plates: [] };
  const plaatAf = autoConnectOpenFem3DEdit(metPlaatSchets, plaatModel, { ...aan, historyGroup: "plaat-1" });
  check("tekengroep met de plaat af: haar hoekknoop 6 op staaf 2 wordt aangesloten, in dezelfde stap",
    plaatAf !== null && json(plaatAf.splits.map((s) => [s.beamId, s.nodeIds])) === json([[2, [6]]]), json(plaatAf?.splits));
  // Kopiëren: een kolom (knoop 4 → 9) een halve rasterstap verschuiven zodat haar voet op staaf 1 komt.
  const metKolom = parseOpenFem3DModel({
    nodes: [...oud.nodes, { id: 9, x: 6, y: 1, z: 3 }, { id: 10, x: 6, y: 1, z: 0 }],
    beams: [...oud.beams, { id: 3, startNodeId: 10, endNodeId: 9 }],
    memberLoads: oud.memberLoads,
  });
  const kopie = transformOpenFem3D(metKolom, { type: "beam", id: 3 }, { kind: "copy", dx: 0, dy: -1, dz: 0 });
  const auto4 = autoConnectOpenFem3DEdit(metKolom, kopie.model, aan);
  check("kopiëren: de voet van de gekopieerde kolom komt op staaf 1 → staaf 1 gesplitst op die voet",
    auto4 !== null && auto4.splits.length === 1 && auto4.splits[0].beamId === 1
    && knoop(auto4.model, auto4.splits[0].nodeIds[0]).x === 6 && knoop(auto4.model, auto4.splits[0].nodeIds[0]).y === 0, json(auto4?.splits));
  // Eén klik, twee wijzigingen: het tekenvlak legt eerst een nieuwe eindknoop
  // op staaf 2 (de app sluit hem aan) en zet daarna de staaf, gerekend op zijn
  // eigen model van vóór het aansluiten (staaf 2 nog heel, het volgende
  // staafnummer is dat van het tweede deel). Het aansluiten van de tweede
  // wijziging herstelt de splitsing; geen dubbele nummers, lasten één keer.
  const klik1 = addOpenFem3DNode(oud, { x: 5, y: 4, z: 0 }).model;
  const app1 = autoConnectOpenFem3DEdit(oud, klik1, aan).model;
  const klik2 = { ...klik1, beams: [...klik1.beams, { id: 3, startNodeId: 3, endNodeId: 6, profileName: "IPE 200", material: "S235" }] };
  const app2 = autoConnectOpenFem3DEdit(app1, klik2, aan);
  check("één klik, twee wijzigingen op het eigen model van het tekenvlak: staaf 2 weer op knoop 6 gesplitst, de getekende staaf heel",
    app2 !== null && json(app2.model.beams.map((b) => [b.id, b.startNodeId, b.endNodeId]).sort((a, b) => a[0] - b[0]))
      === json([[1, 1, 2], [2, 4, 6], [3, 3, 6], [4, 6, 5]])
    && json(app2.model.memberLoads.map((l) => [l.id, l.beamId, l.startPositionM, l.endPositionM])) === json([[1, 2, 0, 5], [2, 4, 0, 3]])
    && fout(() => parseOpenFem3DModel(app2.model)) === null, json(app2?.model.beams));
  // Eén stap ongedaan maken: de bewerking en het aansluiten samen.
  let historie = { model: oud, past: [], future: [] };
  historie = openFem3dHistoryReducer(historie, { type: "edit", model: auto1.model });
  check("één stap: na ongedaan maken het model van vóór de bewerking (zonder de knoop en zonder splitsing)",
    historie.past.length === 1 && openFem3dHistoryReducer(historie, { type: "undo" }).model === oud);
  check("de verschillen: een nieuwe knoop, een verplaatste knoop met zijn staven",
    json(openFem3DGeometryChanges(oud, metKnoop)) === json({ nodeIds: [6], beamIds: [] })
    && json(openFem3DGeometryChanges(metKnoop, updateOpenFem3DNode(metKnoop, 1, { x: -1 }))) === json({ nodeIds: [1], beamIds: [1] }));
}

log("\n[4b] de stappen van de app: schakelaar, tolerantie in mm, bereik en importeren");
{
  // Wat App.tsx aanroept, met de snapinstellingen zoals useSnapInstellingen ze
  // geeft (verbindingsTolerantie in mm). Een ligger 0 → 10 m en een nieuwe
  // knoop op 4 m, 3 of 6 mm naast de as.
  const ligger = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 10, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }],
  });
  const metKnoop = (dy) => addOpenFem3DNode(ligger, { x: 4, y: dy, z: 0 }).model;
  const snap = { knopenAansluiten: true, verbindingsTolerantie: 5 };
  const drie = openFem3DEditWithAutoConnect(ligger, metKnoop(0.003), snap);
  check("bewerking: 3 mm naast de as bij 5 mm wordt aangesloten, in hetzelfde model voor de historie; de melding 'automatisch'",
    drie.result !== null && drie.model === drie.result.model && json(drie.result.splits.map((s) => s.beamId)) === json([1])
    && json(drie.context) === json({ scope: "auto", toleranceMm: 5 }), json(drie));
  const na6 = metKnoop(0.006);
  const zes = openFem3DEditWithAutoConnect(ligger, na6, snap);
  check("bewerking: 6 mm naast de as bij 5 mm niet (de tolerantie is in mm, niet in m)",
    zes.result === null && zes.model === na6);
  check("bewerking: 6 mm naast de as bij 10 mm wel",
    openFem3DEditWithAutoConnect(ligger, na6, { ...snap, verbindingsTolerantie: 10 }).result?.splits.length === 1);
  const opAs = metKnoop(0);
  const uit = openFem3DEditWithAutoConnect(ligger, opAs, { ...snap, knopenAansluiten: false });
  check("bewerking met de schakelaar uit: niets, precies het model van de bewerking",
    uit.result === null && uit.model === opAs && uit.model.beams.length === 1);
  check("bewerking in een tekengroep (open contour): niets",
    openFem3DEditWithAutoConnect(ligger, metKnoop(0), snap, "plaat-1").result === null);

  // De knoppen: een balk 1 (0 → 10 m) met een kolom 2 (voet 3 op 4 m, kop 4),
  // en een tweede losse knoop 5 op 7 m.
  const balk = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 10, y: 0, z: 0 }, { id: 3, x: 4, y: 0, z: 0 }, { id: 4, x: 4, y: 0, z: 3 },
      { id: 5, x: 7, y: 0.003, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 3, endNodeId: 4 }],
  });
  const kolom = openFem3DConnectButton(balk, { type: "beam", id: 2 }, snap, "selectie");
  check("lintknop met alleen de kolom geselecteerd: de kolomvoet (haar eindknoop) wordt aangesloten, knoop 5 niet; de melding 'binnen de selectie (1)'",
    json(kolom.result.splits) === json([{ beamId: 1, nodeIds: [3], beamIds: [1, 3], parts: 2 }]) && kolom.model === kolom.result.model
    && json(kolom.context) === json({ scope: "selection", count: 1, toleranceMm: 5 }), json(kolom));
  const geheel = openFem3DConnectButton(balk, { type: "beam", id: 2 }, snap, "model");
  check("de knop Aansluiten in de modelcontrole: het hele model, ook met een selectie (knoop 3 en 5)",
    json(geheel.result.splits.map((s) => s.nodeIds)) === json([[3, 5]]) && json(geheel.context) === json({ scope: "all", toleranceMm: 5 }));
  check("lintknop zonder selectie: het hele model",
    json(openFem3DConnectButton(balk, null, snap, "selectie").context) === json({ scope: "all", toleranceMm: 5 }));
  check("lintknop: de tolerantie in mm (knoop 5 ligt 3 mm naast de as: bij 2 mm niet, bij 5 mm wel)",
    openFem3DConnectButton(balk, { type: "node", id: 5 }, { verbindingsTolerantie: 2 }, "selectie").result.splits.length === 0
    && openFem3DConnectButton(balk, { type: "node", id: 5 }, { verbindingsTolerantie: 5 }, "selectie").result.splits.length === 1);
  check("lintknop: de schakelaar uit doet niets af aan de knop (het is een opdracht)",
    openFem3DConnectButton(balk, null, { ...snap, knopenAansluiten: false }, "model").result.splits.length === 1);
  const importUit = openFem3DConnectAfterImport(balk, { ...snap, knopenAansluiten: false });
  check("na importeren met de schakelaar uit: niets, het model zoals het binnenkwam",
    importUit.result === null && importUit.model === balk);
  const importAan = openFem3DConnectAfterImport(balk, snap);
  check("na importeren met de schakelaar aan: alles aangesloten, de melding 'na het importeren'",
    importAan.result?.nodeCount === 2 && importAan.model === importAan.result.model
    && json(importAan.context) === json({ scope: "import", toleranceMm: 5 }));
  check("na importeren: de tolerantie in mm (bij 2 mm alleen knoop 3)",
    openFem3DConnectAfterImport(balk, { ...snap, verbindingsTolerantie: 2 }).result?.nodeCount === 1);
  check("na importeren zonder losse knopen: niets",
    openFem3DConnectAfterImport(importAan.model, snap).result === null);
}

log("\n[4c] de selectie na een transformatie die een staaf splitste");
{
  const snap = { knopenAansluiten: true, verbindingsTolerantie: 5 };
  // Zoals OpenFem3DEditor.applyTransform met App.setOpenFem3d: transformeren,
  // aansluiten (de stap van de app), dan de selectie op alle delen.
  const stap = (model, selection, command, instelling = snap) => {
    const t = transformOpenFem3D(model, selection, command);
    const app = openFem3DEditWithAutoConnect(model, t.model, instelling);
    return { model: app.model, selection: openFem3DSelectionAfterConnect(t.selection, app.result?.splits ?? []), result: app.result };
  };
  // Ligger 1 (0 → 10 m) op y = 0; een kolom 3 met haar voet 5 op (4; 1; 0).
  const m0 = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 10, y: 0, z: 0 }, { id: 5, x: 4, y: 1, z: 0 }, { id: 6, x: 4, y: 1, z: 3 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 3, startNodeId: 5, endNodeId: 6 }],
  });
  const s1 = stap(m0, { type: "beam", id: 1 }, { kind: "move", dx: 0, dy: 1, dz: 0 });
  check("verplaatsen op de kolomvoet: de ligger gesplitst op knoop 5; de selectie wijst beide delen aan (geen knippunt)",
    json(s1.result?.splits.map((s) => s.beamIds)) === json([[1, 4]])
    && json(s1.selection) === json({ type: "multi", nodeIds: [], beamIds: [1, 4] }), json(s1.selection));
  const s2 = stap(s1.model, s1.selection, { kind: "move", dx: 0, dy: 1, dz: 0 });
  check("nog eens verplaatsen: de hele ligger gaat mee (knoop 1, 5 en 2 op y = 2), geen knik halverwege",
    [1, 5, 2].every((id) => knoop(s2.model, id).y === 2), json(s2.model.nodes));
  // Kopie van een kopie: ligger 1 (0 → 10 m) op y = 0 en een dwarsligger van
  // (5; −1) naar (5; 3) met een knoop 7 op (5; 2), waar de eerste kopie komt.
  const k0 = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 10, y: 0, z: 0 }, { id: 3, x: 5, y: -1, z: 0 }, { id: 4, x: 5, y: 3, z: 0 },
      { id: 7, x: 5, y: 2, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 3, endNodeId: 7 }, { id: 3, startNodeId: 7, endNodeId: 4 }],
  });
  const c1 = stap(k0, { type: "beam", id: 1 }, { kind: "copy", dx: 0, dy: 2, dz: 0 });
  check("kopiëren door knoop 7: de kopie is op knoop 7 gesplitst en de selectie wijst beide delen van de kopie aan",
    c1.result?.splits.length === 1 && c1.selection?.type === "multi" && c1.selection.beamIds.length === 2, json(c1.selection));
  const c2 = stap(c1.model, c1.selection, { kind: "copy", dx: 0, dy: 2, dz: 0 });
  const nieuw = c2.model.beams.filter((b) => !c1.model.beams.some((x) => x.id === b.id));
  const xs = nieuw.flatMap((b) => [knoop(c2.model, b.startNodeId).x, knoop(c2.model, b.endNodeId).x]);
  check("de kopie van de kopie is een hele ligger van 0 tot 10 m op y = 4 (beide delen), geen halve",
    nieuw.length === 2 && Math.min(...xs) === 0 && Math.max(...xs) === 10
    && nieuw.every((b) => knoop(c2.model, b.startNodeId).y === 4 && knoop(c2.model, b.endNodeId).y === 4), json(nieuw));
  check("zonder splitsing blijft de selectie hetzelfde object; een knoopselectie verandert nooit",
    openFem3DSelectionAfterConnect({ type: "beam", id: 9 }, s1.result.splits).id === 9
    && json(openFem3DSelectionAfterConnect({ type: "node", id: 1 }, s1.result.splits)) === json({ type: "node", id: 1 })
    && openFem3DSelectionAfterConnect(null, s1.result.splits) === null);
  check("een groep met een gesplitste staaf: de delen erbij, knopen, platen en lasten blijven",
    json(openFem3DSelectionAfterConnect({ type: "multi", nodeIds: [6], beamIds: [3, 1], plateIds: [2] }, s1.result.splits))
      === json({ type: "multi", nodeIds: [6], beamIds: [3, 1, 4], plateIds: [2] }));
}

log("\n[5] modelcontrole, bereik uit de selectie en de melding");
{
  const oud = balkMetKolommen();
  const controle = findOpenFem3DNodesOnBeams(oud);
  check("bij openen: een waarschuwing per knoop (3 op 1, 4 op 1, 5 op 1); het model zelf blijft hetzelfde",
    controle.length === 3 && json(oud) === json(balkMetKolommen()));
  check("bereik uit de selectie: niets → het hele model; knoop → die knoop; staaf → de staaf met haar eindknopen; groep → knopen en staven",
    openFem3DConnectScope(oud, null) === undefined
    && json(openFem3DConnectScope(oud, { type: "node", id: 4 })) === json({ nodeIds: [4], beamIds: [], count: 1 })
    && json(openFem3DConnectScope(oud, { type: "beam", id: 1 })) === json({ nodeIds: [1, 2], beamIds: [1], count: 1 })
    && json(openFem3DConnectScope(oud, { type: "multi", nodeIds: [3, 99], beamIds: [2], plateIds: [] })) === json({ nodeIds: [3, 6], beamIds: [2], count: 2 })
    && openFem3DConnectScope(oud, { type: "plate", id: 1 }) === undefined);
  const alleenKolom = connectOpenFem3DNodesToBeams(oud, openFem3DConnectScope(oud, { type: "beam", id: 3 }));
  check("alleen kolom 3 geselecteerd (de handeling uit het issue): haar voet 4 wordt aangesloten, de andere voeten niet",
    json(alleenKolom.splits) === json([{ beamId: 1, nodeIds: [4], beamIds: [1, 5], parts: 2 }]), json(alleenKolom.splits));
  const kolomMelding = openFem3DConnectMessage(alleenKolom, { scope: "selection", count: 1, toleranceMm: 5 });
  check("… en de melding zegt 'gesplitst', binnen de selectie van 1",
    kolomMelding.level === "success" && kolomMelding.details.some((d) => d.key === "ribbon:openFem3d.connectNodesScopeSelection" && d.count === 1));
  const r = connectOpenFem3DNodesToBeams(oud);
  const melding = openFem3DConnectMessage(r, { scope: "all", toleranceMm: 5 });
  check("melding na aansluiten: geslaagd, '1 staaf gesplitst', staaf 1 in 4 delen, in het hele model",
    melding.level === "success" && melding.title.key === "ribbon:openFem3d.connectNodesDone" && melding.title.count === 1
    && melding.details.some((d) => d.key === "ribbon:openFem3d.connectNodesBeam" && d.values?.beam === 1 && d.values?.parts === 4)
    && melding.details.some((d) => d.key === "ribbon:openFem3d.connectNodesScopeAll"), json(melding));
  const niets = openFem3DConnectMessage(connectOpenFem3DNodesToBeams(r.model), { scope: "selection", count: 2, toleranceMm: 5 });
  check("niets te doen: info met de tolerantie en het bereik",
    niets.level === "info" && niets.title.key === "ribbon:openFem3d.connectNodesNone" && niets.title.values?.mm === "5"
    && niets.details.some((d) => d.key === "ribbon:openFem3d.connectNodesScopeSelection" && d.count === 2), json(niets));
  const auto = openFem3DConnectMessage(r, { scope: "auto", toleranceMm: 2.5 });
  check("automatisch: de melding zegt dat het automatisch ging en hoe het uit kan",
    auto.details.some((d) => d.key === "ribbon:openFem3d.connectNodesScopeAuto"), json(auto));
  const veel = { model: oud, splits: Array.from({ length: 9 }, (_, i) => ({ beamId: i + 1, nodeIds: [100], beamIds: [i + 1, 50 + i], parts: 2 })), skipped: [{ nodeId: 1, beamId: 2, reason: "nearNode" }], nodeCount: 9 };
  const veelMelding = openFem3DConnectMessage(veel, { scope: "all", toleranceMm: 5 });
  check("veel staven: de eerste zes bij naam, 'en nog 3', en de overgeslagen knopen met hun reden",
    veelMelding.details.filter((d) => d.key === "ribbon:openFem3d.connectNodesBeam").length === 6
    && veelMelding.details.some((d) => d.key === "ribbon:openFem3d.connectNodesMore" && d.count === 3)
    && veelMelding.details.some((d) => d.key === "ribbon:openFem3d.connectNodesSkipped" && d.count === 1)
    && veelMelding.details.some((d) => d.key === "ribbon:openFem3d.modelCheck.blocked" && d.values?.node === 1), json(veelMelding));

  // Overlappende staven: staaf 1 (0 → 10 m) en staaf 2 (knoop 3 op 4 m → 10 m).
  // Knoop 3 ligt op staaf 1, maar een knip daar zou staaf 2 verdubbelen.
  const overlap = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 10, y: 0, z: 0 }, { id: 3, x: 4, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 3, endNodeId: 2 }],
  });
  const overlapR = connectOpenFem3DNodesToBeams(overlap);
  check("overlap: niets gesplitst, knoop 3 overgeslagen omdat staaf 2 verdubbeld zou worden",
    overlapR.splits.length === 0 && overlapR.model === overlap
    && json(overlapR.skipped) === json([{ nodeId: 3, beamId: 1, reason: "duplicate", otherBeamId: 2 }]), json(overlapR.skipped));
  const overlapMelding = openFem3DConnectMessage(overlapR, { scope: "all", toleranceMm: 5 });
  check("… de melding is een waarschuwing '1 knoop kon niet aangesloten worden' met de reden (staaf 1 en 2 overlappen), niet 'geen knoop'",
    overlapMelding.level === "warning" && overlapMelding.title.key === "ribbon:openFem3d.connectNodesFailed" && overlapMelding.title.count === 1
    && json(overlapMelding.details[0]) === json({ key: "ribbon:openFem3d.modelCheck.overlap", values: { node: 3, beam: 1, other: 2 } })
    && !json(overlapMelding).includes("connectNodesNone"), json(overlapMelding));
  const overlapControle = openFem3DConnectCheck(overlap, 5);
  check("… de modelcontrole meldt knoop 3 op staaf 1 met die reden, en de knop Aansluiten heeft niets te doen (connectable 0)",
    json(overlapControle.findings.map((f) => [f.nodeId, f.beamId])) === json([[3, 1]])
    && json(overlapControle.skipped.map((s) => [s.nodeId, s.reason, s.otherBeamId])) === json([[3, "duplicate", 2]])
    && overlapControle.connectable === 0, json(overlapControle));
  const fundering = balkMetKolommen();
  const vooraf = json(fundering);
  const gemengd = openFem3DConnectCheck(fundering, 5);
  check("de modelcontrole van de funderingsbalk: drie knopen, alle drie aan te sluiten, geen reden",
    gemengd.findings.length === 3 && gemengd.skipped.length === 0 && gemengd.connectable === 3);
  check("de modelcontrole laat het model met rust (een proefknip zonder lasten)", json(fundering) === vooraf);
}

log("\n[6] de instelling en de bedrading");
{
  const snap = await import("./src/hooks/useSnapInstellingen.ts");
  check("standaard aan, en bewaard met de snapinstellingen",
    snap.SNAP_BEGINSTAND.knopenAansluiten === true
    && snap.snapInstellingenUitOpslag(json({ knoop: false })).knopenAansluiten === true
    && snap.snapInstellingenUitOpslag(json({ knopenAansluiten: false })).knopenAansluiten === false
    && snap.snapInstellingenUitOpslag(json({ knopenAansluiten: "nee" })).knopenAansluiten === true);
  snap.zetKnopenAansluiten(false);
  check("zetten: uit", snap.leesSnapInstellingen().knopenAansluiten === false);
  snap.zetAlleSnaps(true, snap.SNAP_SCHAKELAARS_3D);
  check("'Alle snaps' raakt de schakelaar niet (het is geen snap)", snap.leesSnapInstellingen().knopenAansluiten === false);
  snap.herstelSnapBeginstand();
  check("de uitleg bij de verbindingstolerantie noemt nu ook 3D", /3D/.test(bron("src", "hooks", "useSnapInstellingen.ts").split("VERBINDINGSTOLERANTIE")[1] ?? ""));

  const app = bron("src", "App.tsx");
  // De schakelaar, de tolerantie in mm, het bereik uit de selectie en de
  // importguard zitten in de stappen van openFem3dAansluiten.ts (getoetst in
  // [4b]); App geeft ze alleen de snapinstellingen zoals ze zijn. Deze regels
  // leggen die aanroepen letterlijk vast, en dat App niet om de stappen heen
  // zelf aansluit.
  const setter = app.slice(app.indexOf("const setOpenFem3d = useCallback"), app.indexOf("const [openFem3dTool, setOpenFem3dTool]"));
  check("App: elke bewerking via setOpenFem3d sluit automatisch aan (de stap van de app, met de snapinstellingen), in dezelfde stap",
    setter.includes("openFem3DEditWithAutoConnect(current, model, snap, meta?.historyGroup)")
    && setter.includes("changedLockedOpenFem3DLayer(current, model)")
    && setter.includes("changedLockedOpenFem3DLayer(current, stap.model)")
    && setter.includes('dispatchOpenFem3D({ type: "edit", model: stap.model, ...meta })')
    // Sinds #75 de hele stap terug (met ook het samenvoegen); het verslag van het aansluiten is stap.result.
    && setter.includes("return stap;"), setter.slice(0, 900));
  const levelCommit = app.slice(app.indexOf("const commitLevels = useCallback"), app.indexOf("const setStructuralGrid3D = useCallback"));
  check("App: ook na een levelwijziging (knopen schuiven mee)",
    levelCommit.includes("openFem3DEditWithAutoConnect(model, result.model, leesSnapInstellingen())")
    && levelCommit.includes('dispatchOpenFem3D({ type: "edit", model: stap.model, levels })')
    && levelCommit.includes('explodeAmountRef.current > 0'));
  const naImport = app.slice(app.indexOf("const sluitAanNaImport = useCallback"), app.indexOf("const handleConvertTo3D = useCallback"));
  check("App: na importeren (IFC-analysemodel, 2D omzetten) aansluiten als eigen stap, met de guard van de stap; openen van een project niet",
    naImport.includes("openFem3DConnectAfterImport(current, leesSnapInstellingen())")
    && naImport.includes("changedLockedOpenFem3DLayer(current, stap.model)")
    && naImport.includes("if (!stap.result) return;") && naImport.includes('dispatchOpenFem3D({ type: "edit", model: stap.model })')
    && /const pasIfcImportToe = useCallback[\s\S]{0,700}sluitAanNaImport\(/.test(app)
    && /const handleConvertTo3D = useCallback[\s\S]{0,700}sluitAanNaImport\(/.test(app)
    && !/const pasProjectToe = useCallback[\s\S]{0,1500}sluitAanNaImport/.test(app), naImport);
  check("App: de lintknop en de knop in de modelcontrole: de stap van de knop met de selectie en de snapinstellingen",
    /const handleOpenFem3DConnectNodes = [\s\S]{0,300}openFem3DConnectButton\(current, openFem3dSelection, leesSnapInstellingen\(\), bereik\)/.test(app)
    && app.includes('if (stap.model !== current) dispatchOpenFem3D({ type: "edit", model: stap.model });')
    && /onOpenFem3DConnectNodes=\{\(\) => handleOpenFem3DConnectNodes\("selectie"\)\}/.test(app)
    && /onConnectNodes=\{\(\) => handleOpenFem3DConnectNodes\("model"\)\}/.test(app));
  check("App: sluit nergens zelf aan buiten de stappen om, en deelt de tolerantie nergens door 1000",
    !/autoConnectOpenFem3DEdit\(|connectOpenFem3DNodesToBeams\(/.test(app) && !/verbindingsTolerantie\s*\/\s*1000/.test(app));
  check("App: een melding 'kon niet aangesloten worden' is een waarschuwing",
    app.includes('message.level === "warning" ? notifyWarning'));
  const harnas = bron("scripts", "open-fem3d-aansluiten-browser.tsx");
  check("de browserproef roept dezelfde stappen aan als App (bewerking, knop, lint)",
    harnas.includes("openFem3DEditWithAutoConnect(historyRef.current.model, next, leesSnapInstellingen(), meta?.historyGroup)")
    && /openFem3DConnectButton\(historyRef\.current\.model, selectieRef\.current, leesSnapInstellingen\(\), "model"\)/.test(harnas)
    && /openFem3DConnectButton\(historyRef\.current\.model, selectieRef\.current, leesSnapInstellingen\(\), "selectie"\)/.test(harnas)
    && !/autoConnectOpenFem3DEdit\(|connectOpenFem3DNodesToBeams\(/.test(harnas));
  check("App: vóór het rekenen een waarschuwing (de berekening gaat door) en de modelcontrole open; wat het plaatnet verbindt telt niet (#97)",
    /if \(modelDimension === "3d"\) \{[\s\S]{0,400}findOpenFem3DNodesOnBeams\(openFem3d, leesSnapInstellingen\(\)\.verbindingsTolerantie, undefined, "all"\)/.test(app)
    && /setOpenFem3dModelCheckToken\(/.test(app));
  const editor = bron("src", "components", "openFem3d", "OpenFem3DEditor.tsx");
  check("editor: de modelcontrole live met de verbindingstolerantie, met de redenen en wat aan te sluiten valt",
    /openFem3DConnectCheck\(model, verbindingsTolerantie\)/.test(editor) && /<OpenFem3DModelCheck\b/.test(editor)
    && /skipped=\{modelControle\.skipped\}/.test(editor) && /connectable=\{modelControle\.connectable\}/.test(editor));
  check("editor: na een transformatie die een geselecteerde staaf splitste, alle delen in de selectie",
    // Sinds #75 via openFem3DSelectionAfterAutoEdit: eerst het samenvoegen, dan de delen van een gesplitste staaf.
    editor.includes("const stap = transformed.model !== model ? onChange(transformed.model) : null;")
    && editor.includes("setSelection(openFem3DSelectionAfterAutoEdit(transformed.selection, stap));")
    && /return openFem3DSelectionAfterConnect\(openFem3DSelectionAfterMerge\(selection, step\.merge\), step\.result\?\.splits \?\? \[\]\);/
      .test(bron("src", "components", "openFem3d", "openFem3dAansluiten.ts")));
  check("editor: de modelcontrole staat in één kolom met de kopregel (geen vaste hoogte meer)",
    /<div className="open-fem3d-stage-top">\s*<div className="open-fem3d-stage-header">/.test(editor)
    && !/\.open-fem3d-model-check \{[^}]*top:/.test(bron("src", "components", "openFem3d", "OpenFem3DEditor.css")));
  const lint = bron("src", "components", "ribbon", "HomeTab.tsx");
  check("lint: de knop Knopen aansluiten in 3D",
    /label=\{t\("openFem3d\.connectNodes"\)\}/.test(lint) && /onClick=\{onOpenFem3DConnectNodes\}/.test(lint));
  const tab = bron("src", "components", "fem", "ExplorerViewTab.tsx");
  check("tab Weergave in 3D: de schakelaar en de verbindingstolerantie",
    /zetKnopenAansluiten/.test(tab) && /zichtbaarheid\.knopenAansluiten/.test(tab) && /verbindingsTolerantieHint3d/.test(tab));
  const dekking = bron("src", "api", "dekking.ts");
  check("dekking: lintknop en modelcontrole → model3d.beam.connectNodes",
    /"ribbon:openFem3d\.connectNodes": \{ commando: "model3d\.beam\.connectNodes" \}/.test(dekking)
    && /"OpenFem3DModelCheck\.tsx"/.test(dekking));
  const sleutels = {
    ribbon: ["openFem3d.connectNodes", "openFem3d.connectNodesHint", "openFem3d.connectNodesDone_one", "openFem3d.connectNodesDone_other",
      "openFem3d.connectNodesNone", "openFem3d.connectNodesBeam", "openFem3d.connectNodesScopeAll", "openFem3d.connectNodesScopeAuto",
      "openFem3d.connectNodesScopeImport", "openFem3d.connectNodesScopeSelection_one", "openFem3d.connectNodesScopeSelection_other",
      "openFem3d.modelCheck.title_one", "openFem3d.modelCheck.title_other", "openFem3d.modelCheck.nodeOnBeam", "openFem3d.modelCheck.connect",
      "openFem3d.connectNodesMore_one", "openFem3d.connectNodesMore_other", "openFem3d.connectNodesSkipped_one", "openFem3d.connectNodesSkipped_other",
      "openFem3d.modelCheck.connectTitle", "openFem3d.modelCheck.toggleTitle", "openFem3d.modelCheck.more_one", "openFem3d.modelCheck.more_other",
      "openFem3d.modelCheck.solveText", "openFem3d.connectNodesFailed_one", "openFem3d.connectNodesFailed_other",
      "openFem3d.modelCheck.overlap", "openFem3d.modelCheck.nearNode", "openFem3d.modelCheck.blocked", "openFem3d.modelCheck.connectNothing"],
    common: ["zichtbaarheid.knopenAansluiten", "zichtbaarheid.knopenAansluitenHint", "zichtbaarheid.verbindingsTolerantieHint3d"],
  };
  const pak = (o, pad) => pad.split(".").reduce((x, k) => x?.[k], o);
  for (const taal of ["nl", "en", "de", "fr"]) {
    const ontbreekt = Object.entries(sleutels).flatMap(([ns, lijst]) => {
      const tekst = JSON.parse(bron("src", "i18n", "locales", taal, `${ns}.json`));
      return lijst.filter((s) => typeof pak(tekst, s) !== "string" || !pak(tekst, s).trim()).map((s) => `${ns}:${s}`);
    });
    check(`teksten in ${taal}`, ontbreekt.length === 0, ontbreekt.join(", "));
  }
  const nl = JSON.parse(bron("src", "i18n", "locales", "nl", "ribbon.json"));
  check("de waarschuwing per knoop: 'Knoop {{node}} ligt op staaf {{beam}} maar is niet verbonden.'",
    nl.openFem3d?.modelCheck?.nodeOnBeam === "Knoop {{node}} ligt op staaf {{beam}} maar is niet verbonden.");
}

{
  log("\n[7] knopen die het plaatnet al verbindt (lateien in de metselwerkwand, #97)");
  // Wand 6 × 2,7 m in het vlak y = 0 met een opening 1–3 m × 0–2,2 m; de
  // latei loopt van x = 0,85 tot 3,15 m op z = 2,2 m (oplegging 0,15 m). De
  // bovenhoeken van de opening (knopen 7 en 8) liggen exact op de latei, maar
  // het plaatnet geeft de latei ze als tussenknoop en de lateikoppeling hangt
  // eraan: geen losse knoop. Een vrije knoop op de latei die niet van de wand
  // is (9), en een plaatknoop 3 mm naast de as (die het net niet koppelt),
  // blijven wel een vondst.
  const wand = (extra = []) => parseOpenFem3DModel({
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6, y: 0, z: 2.7 }, { id: 4, x: 0, y: 0, z: 2.7 },
      { id: 5, x: 1, y: 0, z: 0.9 }, { id: 6, x: 3, y: 0, z: 0.9 }, { id: 7, x: 3, y: 0, z: 2.2 }, { id: 8, x: 1, y: 0, z: 2.2 },
      { id: 10, x: 0.85, y: 0, z: 2.2 }, { id: 11, x: 3.15, y: 0, z: 2.2 }, ...extra,
    ],
    beams: [{ id: 1, startNodeId: 10, endNodeId: 11, profile: "HEA 200" }],
    plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessMm: 100, openings: [{ id: 1, nodeIds: [5, 6, 7, 8], lintel: { beamId: 1, bearingM: 0.15, loadSpread: "triangle60" } }] }],
    supports: [], loads: [], memberLoads: [],
  });
  const m = wand();
  check("model ingelezen met latei", m.plates?.[0]?.openings?.[0]?.lintel?.beamId === 1, JSON.stringify(m.plates?.[0]?.openings));
  check("openingshoeken 7 en 8 op de latei: geen vondst", findOpenFem3DNodesOnBeams(m).length === 0,
    JSON.stringify(findOpenFem3DNodesOnBeams(m)));
  check("modelcontrole: niets te melden, Aansluiten laat de latei heel",
    openFem3DConnectCheck(m).findings.length === 0 && connectOpenFem3DNodesToBeams(m).model === m);
  const los = wand([{ id: 9, x: 2, y: 0, z: 2.2 }]);
  check("een vrije knoop op de latei (geen wandknoop) blijft een vondst",
    JSON.stringify(findOpenFem3DNodesOnBeams(los).map((p) => [p.nodeId, p.beamId])) === "[[9,1]]");
  const naast = parseOpenFem3DModel({ ...m, nodes: m.nodes.map((n) => n.id === 7 ? { ...n, z: 2.203 } : n) });
  check("een wandknoop 3 mm naast de as blijft een vondst (het net koppelt hem niet)",
    JSON.stringify(findOpenFem3DNodesOnBeams(naast).map((p) => p.nodeId)) === "[7]");
  // Het voorbeeldproject: 14 meldingen in de oorspronkelijke versie, 12
  // openingshoeken onder een latei en 2 paalknopen (45, 46) midden op de
  // onderrand van een wand, onder een funderingsbalk. Ook die zat via het
  // plaatnet vast (zelfde reacties met en zonder knip); sinds 64b4f0c1 is de
  // balk er bovendien op geknipt. De modelcontrole is schoon.
  const huis = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "examples", "masonry-house.ifcfem"), "utf8"));
  const vondst = findOpenFem3DNodesOnBeams(parseOpenFem3DModel(huis.model3d), 5, undefined, "all").map((p) => `${p.nodeId}@${p.beamId}`);
  check("examples/masonry-house: modelcontrole schoon", JSON.stringify(vondst) === "[]", JSON.stringify(vondst));
}

{
  log("\n[7b] een knoop op de plaatrand of in het veld: het plaatnet neemt hem op");
  // Wand 8,4 × 2,7 m in y = 0 met een opening x 2–4, z 1–2. Funderingsbalk 1
  // langs de onderrand (knopen 1 → 2); paalknoop 5 op (4,2; 0; 0) midden op
  // die rand, niet in de contour. Het plaatnet neemt elke modelknoop in het
  // vlak die op de rand of binnen de plaat ligt op (openFem3dPlateMesh.ts),
  // en geeft hem aan de balk als tussenknoop: verbonden, geen melding.
  const wandMet = (extraNodes, extraBeams = []) => parseOpenFem3DModel({
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 8.4, y: 0, z: 0 }, { id: 3, x: 8.4, y: 0, z: 2.7 }, { id: 4, x: 0, y: 0, z: 2.7 },
      { id: 11, x: 2, y: 0, z: 1 }, { id: 12, x: 4, y: 0, z: 1 }, { id: 13, x: 4, y: 0, z: 2 }, { id: 14, x: 2, y: 0, z: 2 },
      ...extraNodes,
    ],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "400x500", material: "C30/37" }, ...extraBeams],
    plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessMm: 120, openings: [{ id: 1, nodeIds: [11, 12, 13, 14] }] }],
    supports: [{ nodeId: 5, ux: false, uy: false, uz: true, rx: false, ry: false, rz: false }], loads: [], memberLoads: [],
  });
  const paren = (m, modus) => JSON.stringify(findOpenFem3DNodesOnBeams(m, 5, undefined, modus).map((p) => [p.nodeId, p.beamId]));
  const rand = wandMet([{ id: 5, x: 4.2, y: 0, z: 0 }]);
  check("paalknoop midden op de onderrand: geen melding in de modelcontrole", paren(rand, "all") === "[]", paren(rand, "all"));
  check("Aansluiten (standaard) knipt wel: een gewone staaf mag op de randknoop gesplitst worden", paren(rand, undefined) === "[[5,1]]");
  // Een balk door het veld (z = 0,5) met knoop 6 in het veld: ook opgenomen.
  const veld = wandMet([{ id: 5, x: 7, y: 0, z: 0 }, { id: 6, x: 1, y: 0, z: 0.5 }, { id: 7, x: 0, y: 0, z: 0.5 }, { id: 8, x: 8.4, y: 0, z: 0.5 }],
    [{ id: 2, startNodeId: 7, endNodeId: 8, profileName: "HEA 100", material: "S235" }]);
  check("knoop in het plaatveld op een balk in het vlak: geen melding", !paren(veld, "all").includes("[6,2]"), paren(veld, "all"));
  // Een balk door de opening (z = 1,5) met knoop 9 binnen de opening: niet in de plaat, wel een melding.
  const opening = wandMet([{ id: 5, x: 7, y: 0, z: 0 }, { id: 9, x: 3, y: 0, z: 1.5 }, { id: 15, x: 0, y: 0, z: 1.5 }, { id: 16, x: 8.4, y: 0, z: 1.5 }],
    [{ id: 3, startNodeId: 15, endNodeId: 16, profileName: "HEA 100", material: "S235" }]);
  check("knoop binnen de opening: blijft een melding", paren(opening, "all").includes("[9,3]"), paren(opening, "all"));
  // Buiten het plaatvlak (y = 0,2): het net neemt hem niet op.
  const buiten = wandMet([{ id: 5, x: 7, y: 0, z: 0 }, { id: 17, x: 0, y: 0.2, z: 0 }, { id: 18, x: 8.4, y: 0.2, z: 0 }, { id: 19, x: 4, y: 0.2, z: 0 }],
    [{ id: 4, startNodeId: 17, endNodeId: 18, profileName: "HEA 100", material: "S235" }]);
  check("balk en knoop naast het plaatvlak: blijft een melding", paren(buiten, "all").includes("[19,4]"), paren(buiten, "all"));
  // Op de rand maar voorbij de plaat (x = 9): niet in de plaat.
  const voorbij = wandMet([{ id: 5, x: 7, y: 0, z: 0 }, { id: 20, x: 10, y: 0, z: 0 }, { id: 21, x: 9, y: 0, z: 0 }],
    [{ id: 5, startNodeId: 2, endNodeId: 20, profileName: "HEA 100", material: "S235" }]);
  check("knoop op de balk voorbij de plaatrand: blijft een melding", paren(voorbij, "all").includes("[21,5]"), paren(voorbij, "all"));
}

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

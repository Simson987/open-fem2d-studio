// Plaatsen op een object in 3D (issues #76 en #77): een oplegging, veer of
// puntlast komt op een bestaande knoop, op een staaf (die daar gesplitst
// wordt; een puntlast wordt een staafpuntlast op die plek), op een plaat (een
// nieuwe knoop in het middenvlak) of op een vrij punt van het werkvlak.
//
//  [1] de keuze bij een klik: knoop (binnen de snapzone) vóór staaf vóór
//      plaat; een knoop die op zijn eigen straal ver achter een andere plaat
//      of een ander profiel ligt, telt niet; zijn eigen staven en plaat
//      dekken hem nooit af, ook niet aan de camerazijde;
//  [2] op een staaf: splitsen zoals de tussenknoop, lasten en scharnieren
//      goed verdeeld; aan een staafeinde geen splitsing;
//  [3] op een plaat: de knoop in het middenvlak (loodrecht geprojecteerd),
//      met het level van de plaat, niet in een opening of buiten de plaat;
//      het rekennet neemt hem mee en wordt opnieuw gemaakt;
//  [4] oplegging of veer + knoop zijn samen één modelwijziging (één stap
//      ongedaan maken);
//  [5] puntlast: op een knoop een knooplast, op een staaf een staafpuntlast
//      op de plek, in het gekozen belastinggeval, met de standaardwaarde;
//  [6] de bedrading: lint, App, editor, tekenvlak, teksten in vier talen.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { parseOpenFem3DModel, OPEN_FEM_3D_SUPPORT_PRESETS } = await import("./src/components/openFem3d/openFem3dModel.ts");
const {
  OPEN_FEM_3D_DEFAULT_POINT_LOAD_KN, openFem3DPlacementNodeOwners, placeOpenFem3DPointLoad, projectOpenFem3DPointOnPlate,
  resolveOpenFem3DPlacementNode,
} = await import("./src/components/openFem3d/openFem3dPlaatsen.ts");
const { placeOpenFem3DNodeCondition } = await import("./src/components/openFem3d/openFem3dNodeTools.ts");
const { chooseOpenFem3DPlacement } = await import("./src/components/openFem3d/openFem3dPick.ts");
const { meshOpenFem3DPlates } = await import("./src/components/openFem3d/openFem3dPlateMesh.ts");
const { openFem3DPlateMeshFor } = await import("./src/components/openFem3d/openFem3dSolver.ts");
const { openFem3dHistoryReducer } = await import("./src/components/openFem3d/openFem3dHistory.ts");

const HIER = dirname(fileURLToPath(import.meta.url));
let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => { if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); } };
const dicht = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const fout = (fn) => { try { fn(); return null; } catch (e) { return e instanceof Error ? e.message : String(e); } };

/**
 * Een portaal 6 m breed en 3 m hoog (knopen 1–4, ligger 3 op level v1 met een
 * scharnier aan beide einden), een vloerplaat op level v1 (y 1 … 5, 0,3 m dik,
 * opening x 2 … 3, y 2 … 3) en een schuin dakvlak (y 6 … 8, z 3 … 4).
 * Op de ligger: een trapeziumlast van 1 tot 5 m (geval 2), twee puntlasten
 * (1,0 m in geval 1 en 4,5 m in geval 2) en een temperatuurlast.
 */
const portaal = parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 },
    { id: 3, x: 0, y: 0, z: 3, levelId: "v1" }, { id: 4, x: 6, y: 0, z: 3, levelId: "v1" },
    { id: 5, x: 0, y: 1, z: 3, levelId: "v1" }, { id: 6, x: 6, y: 1, z: 3, levelId: "v1" },
    { id: 7, x: 6, y: 5, z: 3, levelId: "v1" }, { id: 8, x: 0, y: 5, z: 3, levelId: "v1" },
    { id: 9, x: 2, y: 2, z: 3, levelId: "v1" }, { id: 10, x: 3, y: 2, z: 3, levelId: "v1" },
    { id: 11, x: 3, y: 3, z: 3, levelId: "v1" }, { id: 12, x: 2, y: 3, z: 3, levelId: "v1" },
    { id: 13, x: 0, y: 6, z: 3 }, { id: 14, x: 6, y: 6, z: 3 }, { id: 15, x: 6, y: 8, z: 4 }, { id: 16, x: 0, y: 8, z: 4 },
  ],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 3, profileName: "HEA 200", material: "S235" },
    { id: 2, startNodeId: 2, endNodeId: 4, profileName: "HEA 200", material: "S235" },
    { id: 3, startNodeId: 3, endNodeId: 4, profileName: "IPE 300", material: "S235",
      releases: { myStart: true, myEnd: true, mzStart: true, mzEnd: false, torsionStart: false, torsionEnd: false } },
  ],
  supports: [], loads: [],
  memberLoads: [{ id: 1, beamId: 3, caseId: 2, qyStart: 0, qyEnd: 0, qzStart: -2, qzEnd: -6, startPositionM: 1, endPositionM: 5 }],
  memberPointLoads: [
    { id: 1, beamId: 3, caseId: 1, py: 0, pz: -7, positionM: 1 },
    { id: 2, beamId: 3, caseId: 2, py: 1, pz: -3, positionM: 4.5 },
  ],
  thermalLoads: [{ id: 1, beamId: 3, deltaTUniformK: 20, deltaTGradientYK: 0, deltaTGradientZK: 0 }],
  plates: [
    { id: 1, nodeIds: [5, 6, 7, 8], thicknessM: 0.3, material: "C30/37", levelId: "v1",
      openings: [{ id: 1, nodeIds: [9, 10, 11, 12] }] },
    { id: 2, nodeIds: [13, 14, 15, 16], thicknessM: 0.2, material: "C30/37" },
  ],
  surfaceLoads: [],
});

log("[1] de keuze bij een klik: knoop vóór staaf vóór plaat");
const staafRay = { id: 3, distance: 10, halfSizeM: 0.17, point: { x: 1, y: 0, z: 3 } };
const plaatTreffer = { id: 1, distance: 10.2, bandM: 0.4, point: { x: 1, y: 1.2, z: 3.15 } };
check("knoop binnen de snapzone wint van de staaf en de plaat eronder",
  JSON.stringify(chooseOpenFem3DPlacement({ node: { id: 3, distance: 10.05, radiusM: 0.04 }, rayBeam: staafRay, plate: plaatTreffer }))
    === JSON.stringify({ type: "node", id: 3, reason: "node" }));
check("zonder knoop: de staaf vóór de plaat",
  chooseOpenFem3DPlacement({ rayBeam: staafRay, plate: plaatTreffer })?.type === "beam"
  && chooseOpenFem3DPlacement({ rayBeam: staafRay, plate: plaatTreffer }).point === staafRay.point);
check("een systeemlijn naast de cursor telt als staaf",
  chooseOpenFem3DPlacement({ lineBeam: { ...staafRay, id: 2 }, plate: plaatTreffer })?.id === 2);
check("alleen de plaat: de plaat met het raakpunt",
  JSON.stringify(chooseOpenFem3DPlacement({ plate: plaatTreffer })) === JSON.stringify({ type: "plate", id: 1, point: plaatTreffer.point }));
check("niets geraakt: leeg tekenvlak", chooseOpenFem3DPlacement({}) === null);
// Of de knoop zichtbaar is, beslist zijn eigen straal (`ownRay`: wat op zijn
// eigen schermpunt vóór hem getekend is), niet de klikstraal ernaast.
const plaatOpEigenStraal = { type: "plate", id: 1, distance: 10.2, bandM: 0.4 };
check("een knoop ver achter de plaat (vloer eronder, de plaat op zijn eigen straal) telt niet: de plaat",
  chooseOpenFem3DPlacement({ node: { id: 1, distance: 13, radiusM: 0.04, ownRay: [plaatOpEigenStraal] }, plate: plaatTreffer })?.type === "plate");
check("een knoop in het plaatvlak (binnen de band) wint wél",
  chooseOpenFem3DPlacement({ node: { id: 5, distance: 10.3, radiusM: 0.04, ownRay: [plaatOpEigenStraal] }, plate: plaatTreffer })?.type === "node");
check("een knoop ver achter een profiel van een andere staaf (op zijn eigen straal) telt niet: de staaf",
  chooseOpenFem3DPlacement({
    node: { id: 1, distance: 14, radiusM: 0.04, beamIds: [1], ownRay: [{ type: "beam", id: 3, distance: 10, halfSizeM: 0.17 }] },
    rayBeam: staafRay,
  })?.type === "beam");

// De camerazijde (bevinding #76): ligger 3 loopt naar de camera toe; 6 px
// naast knoop 4 raakt de klikstraal de ligger 0,24 m vóór de knoop, ruim
// meer dan de marge (0,1 m) plus de knoopstraal. Toch is de knoop zichtbaar.
const naastKnoop4 = { id: 3, distance: 19.544, halfSizeM: 0.035, point: { x: 5.745, y: 0, z: 3 } };
check("camerazijde: de klikstraal raakt de ligger ver vóór knoop 4, op zijn eigen straal niets → knoop 4",
  JSON.stringify(chooseOpenFem3DPlacement({
    node: { id: 4, distance: 19.78, radiusM: 0.077, beamIds: [2, 3], ownRay: [] }, rayBeam: naastKnoop4, lineBeam: naastKnoop4,
  })) === JSON.stringify({ type: "node", id: 4, reason: "node" }));
check("de eigen staaf (of zijn scharnierbol) vóór de knoop op zijn eigen straal dekt hem niet af, ook als je langs de staaf kijkt",
  chooseOpenFem3DPlacement({
    node: { id: 4, distance: 19.78, radiusM: 0.077, beamIds: [2, 3], ownRay: [{ type: "beam", id: 3, distance: 14, halfSizeM: 0.035 }] },
    rayBeam: naastKnoop4,
  })?.type === "node");
check("… een andere staaf op dezelfde plek wél: de geraakte staaf",
  chooseOpenFem3DPlacement({
    node: { id: 4, distance: 19.78, radiusM: 0.077, beamIds: [2, 3], ownRay: [{ type: "beam", id: 7, distance: 14, halfSizeM: 0.035 }] },
    rayBeam: naastKnoop4,
  })?.id === 3);
check("een plaat aan de camerazijde: de klik raakt de plaat 0,6 m vóór kolomkop 13 in die plaat → knoop 13",
  chooseOpenFem3DPlacement({
    node: { id: 13, distance: 19.0, radiusM: 0.077, beamIds: [4], plateIds: [1], ownRay: [{ type: "plate", id: 1, distance: 18.85, bandM: 0.375 }] },
    plate: { id: 1, distance: 18.4, bandM: 0.375, point: { x: 4.34, y: 2.96, z: 3.125 } },
  })?.type === "node");
check("… zijn eigen plaat dekt hem zelfs bij scherende blik niet af (oppervlak ver vóór het middenvlak)",
  chooseOpenFem3DPlacement({
    node: { id: 13, distance: 19.0, radiusM: 0.077, plateIds: [1], ownRay: [{ type: "plate", id: 1, distance: 17.5, bandM: 0.375 }] },
    plate: { id: 1, distance: 17.4, bandM: 0.375, point: { x: 4.34, y: 2.96, z: 3.125 } },
  })?.type === "node");

log("\n[1b] waar een knoop bij hoort (openFem3DPlacementNodeOwners)");
check("knoop 3: kolom 1 en ligger 3; wel in het vlak van vloerplaat 1 (z = 3 m) maar ernaast, dus geen plaat",
  JSON.stringify(openFem3DPlacementNodeOwners(portaal, 3)) === JSON.stringify({ beamIds: [1, 3], plateIds: [] }));
check("voetknoop 1: alleen kolom 1 (hij ligt in het verlengde van het dakvlak, maar ver erbuiten)",
  JSON.stringify(openFem3DPlacementNodeOwners(portaal, 1)) === JSON.stringify({ beamIds: [1], plateIds: [] }));
check("hoekknoop 5 hoort bij de vloerplaat, hoekknoop 13 bij het dakvlak",
  JSON.stringify(openFem3DPlacementNodeOwners(portaal, 5).plateIds) === "[1]" && JSON.stringify(openFem3DPlacementNodeOwners(portaal, 13).plateIds) === "[2]");
const metKnoop = (x, y, z) => ({ ...portaal, nodes: [...portaal.nodes, { id: 30, x, y, z }] });
check("binnen de halve dikte plus 1 mm (0,3 m dik: tot 0,151 m) hoort hij bij de plaat, erbuiten niet",
  openFem3DPlacementNodeOwners(metKnoop(4, 4, 3.15), 30).plateIds.includes(1) && !openFem3DPlacementNodeOwners(metKnoop(4, 4, 3.16), 30).plateIds.includes(1));
check("in de opening hoort hij niet bij de plaat", openFem3DPlacementNodeOwners(metKnoop(2.5, 2.5, 3), 30).plateIds.length === 0);
check("alleen de gevraagde platen worden bekeken; een onbekende knoop hoort nergens bij",
  openFem3DPlacementNodeOwners(metKnoop(4, 4, 3), 30, [2]).plateIds.length === 0
  && JSON.stringify(openFem3DPlacementNodeOwners(metKnoop(4, 4, 3), 30, [1, 2]).plateIds) === "[1]"
  && JSON.stringify(openFem3DPlacementNodeOwners(portaal, 99)) === JSON.stringify({ beamIds: [], plateIds: [] }));
check("een opleggingsteken kiest zijn knoop, vóór de staaf",
  JSON.stringify(chooseOpenFem3DPlacement({ support: { nodeId: 4, distance: 9.8 }, rayBeam: staafRay }))
    === JSON.stringify({ type: "node", id: 4, reason: "support" }));
check("een staaf ruim achter de plaat (buiten de band): de plaat",
  chooseOpenFem3DPlacement({ lineBeam: { ...staafRay, distance: 12 }, plate: plaatTreffer })?.type === "plate");

log("\n[2] op een staaf: splitsen zoals de tussenknoop");
const gesplitst = resolveOpenFem3DPlacementNode(portaal, { beamId: 3, positionM: 2.5 });
const nieuweKnoop = gesplitst.model.nodes.find((n) => n.id === gesplitst.nodeId);
check("nieuwe knoop 17 op 2,5 m langs de ligger, op het level van de ligger",
  gesplitst.created === "beamSplit" && gesplitst.nodeId === 17
  && JSON.stringify(nieuweKnoop) === JSON.stringify({ id: 17, x: 2.5, y: 0, z: 3, levelId: "v1" }), JSON.stringify(nieuweKnoop));
const deel1 = gesplitst.model.beams.find((b) => b.id === 3), deel2 = gesplitst.model.beams.find((b) => b.id === gesplitst.split?.secondBeamId);
check("ligger 3 loopt van knoop 3 tot 17, het tweede deel van 17 tot 4, met hetzelfde profiel",
  deel1?.startNodeId === 3 && deel1.endNodeId === 17 && deel2?.startNodeId === 17 && deel2.endNodeId === 4
  && deel2.profileName === "IPE 300" && gesplitst.split?.beamId === 3);
check("scharnieren: het begin houdt myStart/mzStart, het eind myEnd; de nieuwe knoop is star",
  deel1.releases.myStart && deel1.releases.mzStart && !deel1.releases.myEnd && !deel1.releases.mzEnd
  && !deel2.releases.myStart && !deel2.releases.mzStart && deel2.releases.myEnd && !deel2.releases.mzEnd);
const lijn = gesplitst.model.memberLoads;
const resultante = (loads) => loads.reduce((s, l) => s + (l.qzStart + l.qzEnd) / 2 * (l.endPositionM - l.startPositionM), 0);
check("de trapeziumlast is op het knippunt verdeeld, de resultante blijft (−16 kN)",
  lijn.length === 2 && dicht(resultante(lijn), -16) && dicht(lijn[0].qzEnd, -3.5) && dicht(lijn[1].qzStart, -3.5)
  && lijn[1].beamId === deel2.id && dicht(lijn[1].endPositionM, 2.5) && lijn.every((l) => l.caseId === 2), JSON.stringify(lijn));
const punten = gesplitst.model.memberPointLoads;
check("puntlasten naar het juiste deel: 1,0 m blijft, 4,5 m wordt 2,0 m op het tweede deel (geval behouden)",
  punten.find((l) => l.id === 1)?.beamId === 3 && punten.find((l) => l.id === 1)?.positionM === 1
  && punten.find((l) => l.id === 2)?.beamId === deel2.id && dicht(punten.find((l) => l.id === 2).positionM, 2)
  && punten.find((l) => l.id === 2).caseId === 2);
check("de temperatuurlast geldt voor beide delen", gesplitst.model.thermalLoads.map((l) => l.beamId).sort().join() === [3, deel2.id].sort().join());
check("het oorspronkelijke model blijft onaangeroerd", portaal.beams.length === 3 && portaal.nodes.length === 16);
check("ook met t (0–1): t = 0,25 → 1,5 m", JSON.stringify(resolveOpenFem3DPlacementNode(portaal, { beamId: 3, t: 0.25 }).model.nodes.at(-1))
  === JSON.stringify({ id: 17, x: 1.5, y: 0, z: 3, levelId: "v1" }));
const opBegin = resolveOpenFem3DPlacementNode(portaal, { beamId: 3, positionM: 0 });
const opEind = resolveOpenFem3DPlacementNode(portaal, { beamId: 3, t: 1 });
check("op een staafeinde: de eindknoop, geen splitsing", opBegin.nodeId === 3 && opBegin.created === "existing" && opBegin.model === portaal
  && opEind.nodeId === 4 && opEind.model === portaal);
check("een kolom zonder level: de nieuwe knoop krijgt geen level",
  !("levelId" in resolveOpenFem3DPlacementNode(portaal, { beamId: 1, positionM: 1 }).model.nodes.at(-1)));
check("buiten de staaf of een onbekende staaf → fout",
  /binnen|lengte|staaf/i.test(fout(() => resolveOpenFem3DPlacementNode(portaal, { beamId: 3, positionM: 7 })) ?? "")
  && /bestaat niet/.test(fout(() => resolveOpenFem3DPlacementNode(portaal, { beamId: 99, t: 0.5 })) ?? ""));

log("\n[3] op een plaat: nieuwe knoop in het middenvlak");
const opPlaat = resolveOpenFem3DPlacementNode(portaal, { plateId: 1, point: { x: 4.2, y: 4.1, z: 3.15 } });
const plaatKnoop = opPlaat.model.nodes.find((n) => n.id === opPlaat.nodeId);
check("het raakpunt op de bovenkant (z = 3,15) komt in het middenvlak (z = 3), met level v1",
  opPlaat.created === "plate" && JSON.stringify(plaatKnoop) === JSON.stringify({ id: 17, x: 4.2, y: 4.1, z: 3, levelId: "v1" }), JSON.stringify(plaatKnoop));
check("de plaat zelf verandert niet (geen contourknoop erbij)", JSON.stringify(opPlaat.model.plates) === JSON.stringify(portaal.plates));
check("een punt in de opening → geweigerd",
  /opening/i.test(fout(() => resolveOpenFem3DPlacementNode(portaal, { plateId: 1, point: { x: 2.5, y: 2.5, z: 3.15 } })) ?? ""));
check("een punt buiten de plaat → geweigerd",
  /buiten/i.test(fout(() => resolveOpenFem3DPlacementNode(portaal, { plateId: 1, point: { x: 7, y: 3, z: 3 } })) ?? ""));
const opHoek = resolveOpenFem3DPlacementNode(portaal, { plateId: 1, point: { x: 0, y: 1, z: 3.15 } });
check("op een bestaande (hoek)knoop: die knoop, geen nieuwe", opHoek.nodeId === 5 && opHoek.created === "existing" && opHoek.model === portaal);
const n = { x: 0, y: -1 / Math.sqrt(5), z: 2 / Math.sqrt(5) };
const opDak = resolveOpenFem3DPlacementNode(portaal, { plateId: 2, point: { x: 3 + 0.1 * n.x, y: 7 + 0.1 * n.y, z: 3.5 + 0.1 * n.z } });
const dakKnoop = opDak.model.nodes.find((k) => k.id === opDak.nodeId);
check("schuin dakvlak: loodrecht op het vlak geprojecteerd (3; 7; 3,5), zonder level",
  dicht(dakKnoop.x, 3) && dicht(dakKnoop.y, 7) && dicht(dakKnoop.z, 3.5) && !("levelId" in dakKnoop), JSON.stringify(dakKnoop));
const afgerond = projectOpenFem3DPointOnPlate(portaal, 1, { x: 4.2004, y: 4.0996, z: 3.15 }, { roundToMm: true });
check("tekenvlak: hele millimeters in het vlak, de hoogte exact het middenvlak",
  afgerond.state === "inside" && afgerond.point.x === 4.2 && afgerond.point.y === 4.1 && afgerond.point.z === 3, JSON.stringify(afgerond));
const dakAfgerond = projectOpenFem3DPointOnPlate(portaal, 2, { x: 2.0004, y: 7.2003, z: 3.7 }, { roundToMm: true });
check("schuin vlak afgerond: x en y op hele mm, z volgt exact uit het vlak (z = 3 + (y − 6)/2)",
  dakAfgerond.point.x === 2 && dicht(dakAfgerond.point.z, 3 + (dakAfgerond.point.y - 6) / 2, 1e-12)
  && dicht(dakAfgerond.point.y * 1000, Math.round(dakAfgerond.point.y * 1000), 1e-9), JSON.stringify(dakAfgerond));
check("de toestand van een punt: binnen, rand, opening, buiten",
  projectOpenFem3DPointOnPlate(portaal, 1, { x: 1, y: 3, z: 3 }).state === "inside"
  && projectOpenFem3DPointOnPlate(portaal, 1, { x: 3, y: 1, z: 3 }).state === "boundary"
  && projectOpenFem3DPointOnPlate(portaal, 1, { x: 2.5, y: 2.5, z: 3 }).state === "opening"
  && projectOpenFem3DPointOnPlate(portaal, 1, { x: -1, y: 3, z: 3 }).state === "outside");

const netVoor = await meshOpenFem3DPlates(portaal);
const netNa = await meshOpenFem3DPlates(opPlaat.model);
// De modelknoop zelf (geen nieuwe meshknoop met hetzelfde nummer) is hoekpunt van elementen.
const inNet = (net, id) => net.elements.some((e) => e.nodeIds.includes(id)) && !net.nodes.some((k) => k.id === id);
/** Ligt er een elementhoek op punt p (modelknoop of meshknoop)? */
const hoekOp = (net, model, p) => {
  const plek = new Map([...model.nodes, ...net.nodes].map((k) => [k.id, k]));
  return net.elements.some((e) => e.nodeIds.some((id) => {
    const q = plek.get(id);
    return q && Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) < 1e-6;
  }));
};
const PLAATPUNT = { x: 4.2, y: 4.1, z: 3 };
check("het rekennet neemt de nieuwe plaatknoop mee als hoekpunt van elementen (raster)",
  !hoekOp(netVoor, portaal, PLAATPUNT) && inNet(netNa, 17) && netNa.elements.filter((e) => e.nodeIds.includes(17)).length === 4,
  `${netNa.elements.filter((e) => e.nodeIds.includes(17)).length} elementen`);
const netDriehoek = await meshOpenFem3DPlates(opPlaat.model, { forceTriangulation: true });
check("… ook in het driehoekspad", inNet(netDriehoek, 17));
const netDak = await meshOpenFem3DPlates(opDak.model);
check("… en in het schuine dakvlak", inNet(netDak, opDak.nodeId));
const cacheVoor = openFem3DPlateMeshFor(portaal), cacheNa = openFem3DPlateMeshFor(opPlaat.model);
check("de weergave/rekening maakt het net opnieuw (andere knopenlijst → nieuw net)",
  cacheVoor !== cacheNa && openFem3DPlateMeshFor(opPlaat.model) === cacheNa && inNet(await cacheNa, 17)
  && !hoekOp(await cacheVoor, portaal, PLAATPUNT));

log("\n[4] oplegging of veer: knoop en voorwaarde samen één stap");
const scharnier = { kind: "support", preset: "pinned" };
const opStaaf = placeOpenFem3DNodeCondition(portaal, { beamId: 3, positionM: 2.5 }, scharnier, 0);
const steun = opStaaf.model.supports.find((s) => s.nodeId === opStaaf.nodeId);
check("oplegging op een staaf: gesplitst, nieuwe knoop met een scharnieroplegging",
  opStaaf.createdNode && opStaaf.created === "beamSplit" && opStaaf.model.beams.length === 4
  && ["ux", "uy", "uz", "rx", "ry", "rz"].every((k) => steun?.[k] === OPEN_FEM_3D_SUPPORT_PRESETS.pinned[k]));
let historie = { model: portaal, past: [], future: [] };
historie = openFem3dHistoryReducer(historie, { type: "edit", model: opStaaf.model });
check("één historiestap", historie.past.length === 1);
historie = openFem3dHistoryReducer(historie, { type: "undo" });
check("één keer ongedaan maken: staaf weer heel, knoop en oplegging weg", historie.model === portaal);
const veerOpPlaat = placeOpenFem3DNodeCondition(portaal, { plateId: 1, point: { x: 1, y: 4, z: 3.15 } }, { kind: "spring", axis: "kz" }, 12_000);
const veer = veerOpPlaat.model.supports.find((s) => s.nodeId === veerOpPlaat.nodeId);
check("veer op een plaat: nieuwe plaatknoop met een Z-veer, in één model",
  veerOpPlaat.created === "plate" && veer?.springs?.kzKnPerM === 12_000 && veer.uz === false
  && veerOpPlaat.model.nodes.at(-1).levelId === "v1");
const opKnoop = placeOpenFem3DNodeCondition(portaal, { nodeId: 4 }, { kind: "support", preset: "fixed" }, 0);
check("op een knoop: zoals voorheen, geen nieuwe knoop", !opKnoop.createdNode && opKnoop.created === "existing" && opKnoop.model.nodes === portaal.nodes);
check("in een opening: geweigerd, er verandert niets",
  /opening/i.test(fout(() => placeOpenFem3DNodeCondition(portaal, { plateId: 1, point: { x: 2.5, y: 2.5, z: 3 } }, scharnier, 0)) ?? ""));

log("\n[5] puntlast: op een knoop een knooplast, op een staaf een staafpuntlast");
check("standaardwaarde −10 kN (omlaag), dezelfde als de bestaande puntlastknop", OPEN_FEM_3D_DEFAULT_POINT_LOAD_KN === -10);
const knoopLast = placeOpenFem3DPointLoad(portaal, { nodeId: 4 }, 2);
const kl = knoopLast.model.loads.at(-1);
check("knoop 4: knooplast Fz = −10 kN in geval 2, de rest 0; selectie op de nieuwe last",
  kl.nodeId === 4 && kl.fz === -10 && kl.fx === 0 && kl.my === 0 && kl.caseId === 2
  && JSON.stringify(knoopLast.selection) === JSON.stringify({ type: "nodalLoad", id: kl.id }) && knoopLast.kind === "nodal");
const staafLast = placeOpenFem3DPointLoad(portaal, { beamId: 3, positionM: 2.4 }, 2);
const sl = staafLast.model.memberPointLoads.at(-1);
check("ligger 3 op 2,4 m: staafpuntlast Pz = −10 kN op die plek in geval 2; selectie op de nieuwe last",
  sl.beamId === 3 && sl.positionM === 2.4 && sl.pz === -10 && sl.py === 0 && sl.caseId === 2 && sl.id === 3
  && JSON.stringify(staafLast.selection) === JSON.stringify({ type: "memberPointLoad", id: 3 }) && staafLast.kind === "memberPoint");
check("de staaf wordt niet gesplitst", staafLast.model.beams === portaal.beams && staafLast.model.nodes === portaal.nodes);
check("met t (0–1): t = 0,75 → 4,5 m", placeOpenFem3DPointLoad(portaal, { beamId: 3, t: 0.75 }, 1).model.memberPointLoads.at(-1).positionM === 4.5);
check("eigen waarden: knoop Fx = 5 kN, staaf Py = 3 kN",
  placeOpenFem3DPointLoad(portaal, { nodeId: 3 }, 1, { fx: 5 }).model.loads.at(-1).fx === 5
  && placeOpenFem3DPointLoad(portaal, { nodeId: 3 }, 1, { fx: 5 }).model.loads.at(-1).fz === 0
  && placeOpenFem3DPointLoad(portaal, { beamId: 3, positionM: 1 }, 1, { py: 3 }).model.memberPointLoads.at(-1).pz === 0);
historie = openFem3dHistoryReducer({ model: portaal, past: [], future: [] }, { type: "edit", model: staafLast.model });
check("één stap ongedaan maken per klik", openFem3dHistoryReducer(historie, { type: "undo" }).model === portaal);
check("onbekende knoop of staaf → fout",
  /bestaat niet/.test(fout(() => placeOpenFem3DPointLoad(portaal, { nodeId: 99 }, 1)) ?? "")
  && /bestaat niet/.test(fout(() => placeOpenFem3DPointLoad(portaal, { beamId: 99, t: 0.5 }, 1)) ?? ""));

log("\n[6] bedrading");
const lees = (...pad) => readFileSync(join(HIER, ...pad), "utf8").replace(/\r\n/g, "\n");
const commands = lees("src", "components", "openFem3d", "openFem3dCommands.ts");
check("gereedschap addPointLoad bestaat", /"addPointLoad"/.test(commands));
const app = lees("src", "App.tsx");
/** De tekst van handler `naam` in App.tsx, van `const naam = ` tot de afsluitende `};` op inspringing 2. */
const handler = (naam) => {
  const begin = app.indexOf(`  const ${naam} = `);
  const eind = begin < 0 ? -1 : app.indexOf("\n  };", begin);
  return eind < 0 ? "" : app.slice(begin, eind);
};
const aantal = (tekst, deel) => tekst.split(deel).length - 1;
const puntlastHandler = handler("applyOpenFem3DPointLoadTool");
check("App: puntlastgereedschap → placeOpenFem3DPointLoad in het actieve geval, last geselecteerd, paneel open",
  /onPlacePointLoad=\{\(target\) => applyOpenFem3DPointLoadTool\(target\)\}/.test(app)
  && /placeOpenFem3DPointLoad\(current, target, fem\.activeLoadCaseId\);\n\s*setOpenFem3d\(placed\.model\);[\s\S]{0,300}setOpenFem3dSelection\(placed\.selection\);[\s\S]{0,80}setRightPanelOpen\(true\)/.test(puntlastHandler));
// Elke setOpenFem3d is een eigen historiestap: één klik moet er precies één zijn.
check("App: precies één modelwijziging per klik met het puntlastgereedschap (één setOpenFem3d, geen andere dispatch)",
  aantal(puntlastHandler, "setOpenFem3d(") === 1 && aantal(puntlastHandler, "dispatchOpenFem3D(") === 0
  && aantal(puntlastHandler, "setOpenFem3dHistoryState(") === 0, `${aantal(puntlastHandler, "setOpenFem3d(")}× setOpenFem3d`);
const knoopHandler = handler("applyOpenFem3DNodeTool");
check("App: oplegging of veer per klik via openFem3DNodeToolClick, precies één setOpenFem3d",
  /openFem3DNodeToolClick\(/.test(knoopHandler) && aantal(knoopHandler, "setOpenFem3d(") === 1
  && aantal(knoopHandler, "dispatchOpenFem3D(") === 0);
const proef = lees("scripts", "open-fem3d-plaatsen-browser.tsx");
check("de browserproef gebruikt dezelfde helpers als App (geen eigen kopie van de rekenregel)",
  /openFem3DNodeToolClick\(modelRef\.current, target, tool\)/.test(proef) && /placeOpenFem3DPointLoad\(modelRef\.current, target, GEVAL\)/.test(proef)
  && !/placeOpenFem3DNodeCondition/.test(proef));
const canvas = lees("src", "components", "openFem3d", "ThreeFrameCanvas.tsx");
check("tekenvlak: plaatsgereedschappen kiezen met chooseOpenFem3DPlacement (knoop binnen 14 px, staaf, plaat)",
  /chooseOpenFem3DPlacement\(/.test(canvas) && /PLACEMENT_NODE_SNAP_RADIUS_PX = 14/.test(canvas));
const editor = lees("src", "components", "openFem3d", "OpenFem3DEditor.tsx");
check("editor: hulptekst bij het puntlastgereedschap", /addPointLoad: "openFem3d\.pointLoadPlacementHelp"/.test(editor));
for (const taal of ["nl", "en", "de", "fr"]) {
  const lint3d = JSON.parse(readFileSync(join(HIER, "src", "i18n", "locales", taal, "ribbon.json"), "utf8")).openFem3d;
  check(`teksten ${taal}: hulp bij puntlast, melding naast een knoop of staaf, hulp bij oplegging en veer noemt staaf en plaat`,
    ["pointLoadPlacementHelp", "pointLoadPlacementMissed"].every((k) => typeof lint3d[k] === "string" && lint3d[k].length > 0)
    && ["supportPlacementHelp", "springPlacementHelp"].every((k) => /staaf|beam|Stab|barre/i.test(lint3d[k]) && /plaat|plate|Platte|plaque/i.test(lint3d[k])));
}

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

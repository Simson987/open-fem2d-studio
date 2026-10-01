// Selecteren en draaien in het 3D-tekenvlak, analytisch met een echte
// THREE.PerspectiveCamera (en een echte OrbitControls):
//   [1] projectie van een staafas, ook als hij deels achter de camera ligt;
//   [2] de staaf naast de klik: perspectief-correct punt op de systeemlijn;
//   [3] voorrang bij één klik: last, knoop, staaf (onder of naast de cursor), plaat;
//   [4] crossing-selectie (van rechts naar links) tegenover het venster;
//   [5] draaien rond het midden van de selectie: het draaipunt blijft op zijn schermplek;
//   [6] verwijderen van de selectie (ook platen met openingen) en ongedaan maken.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
const { openFem3DProjectSegment, findOpenFem3DBeamNearScreenPoint } = await import("./src/components/openFem3d/openFem3dBeamScreenPick.ts");
const { chooseOpenFem3DPick } = await import("./src/components/openFem3d/openFem3dPick.ts");
const { selectOpenFem3DInScreenBox } = await import("./src/components/openFem3d/openFem3dBoxSelection.ts");
const { openFem3DSelectionPivot, openFem3DOrbitPivotShift } = await import("./src/components/openFem3d/openFem3dOrbitPivot.ts");
const {
  addOpenFem3DPlate, addOpenFem3DPlateOpening, addOpenFem3DSurfaceLoad, parseOpenFem3DModel, removeOpenFem3DSelection,
} = await import("./src/components/openFem3d/openFem3dModel.ts");
const { createOpenFem3DPlateGeometry } = await import("./src/components/openFem3d/openFem3dPlateGeometry.ts");
const { openFem3dHistoryReducer } = await import("./src/components/openFem3d/openFem3dHistory.ts");

let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => { if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); } };
const B = 800, H = 600;
const camera = (positie, doel, up = [0, 0, 1], fov = 50) => {
  const cam = new THREE.PerspectiveCamera(fov, B / H, 0.1, 1000);
  cam.up.set(...up);
  cam.position.set(...positie);
  cam.lookAt(new THREE.Vector3(...doel));
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
};
const matrix = (cam) => new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
const scherm = (cam, p) => {
  const n = new THREE.Vector3(p.x, p.y, p.z).project(cam);
  return { x: (n.x + 1) * B / 2, y: (1 - n.y) * H / 2 };
};

log("[1] projectie van een staafas, afgeknipt op het nabije vlak");
{
  // Camera in de hal, kijkt langs +y; de gording loopt van achter de camera tot ver ervoor.
  const cam = camera([0, 0, 2], [0, 10, 2]);
  const a = { x: 1, y: -8, z: 2.5 }, b = { x: 1, y: 30, z: 2.5 };
  const seg = openFem3DProjectSegment(matrix(cam), a, b, B, H);
  check("een staaf die achter de camera begint, wordt niet weggelaten", seg !== null);
  // Het afgeknipte begin ligt op het nabije vlak (0,1 m voor de camera, langs y).
  const s0Punt = new THREE.Vector3(a.x, a.y, a.z).lerp(new THREE.Vector3(b.x, b.y, b.z), seg.s0);
  check("het begin is afgeknipt op het nabije vlak", Math.abs(s0Punt.y - 0.1) < 1e-9 && seg.s1 === 1, `y=${s0Punt.y} s1=${seg.s1}`);
  check("… met clip-w gelijk aan de nabije afstand", Math.abs(seg.w0 - 0.1) < 1e-9, String(seg.w0));
  const eind = scherm(cam, b);
  check("het eindpunt valt op zijn gewone projectie", Math.abs(seg.bx - eind.x) < 1e-9 && Math.abs(seg.by - eind.y) < 1e-9);
  check("geheel achter de camera → geen lijnstuk", openFem3DProjectSegment(matrix(cam), { x: 0, y: -9, z: 2 }, { x: 3, y: -1, z: 2 }, B, H) === null);
}

log("\n[2] de staaf vlak naast de klik");
{
  const cam = camera([-14, -20, 12], [3, 2, 1.5]);
  const knopen = new Map([
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 4, z: 3 },
    { id: 3, x: 0, y: 6, z: 0 }, { id: 4, x: 6, y: 6, z: 0 },
  ].map((n) => [n.id, n]));
  const staven = [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 3, endNodeId: 4 }];
  const p = new THREE.Vector3(0, 0, 0).lerp(new THREE.Vector3(6, 4, 3), 0.3);
  const s = scherm(cam, p);
  const hit = findOpenFem3DBeamNearScreenPoint(staven, knopen, cam, B, H, s.x, s.y);
  check("klik op de systeemlijn → staaf 1", hit?.beamId === 1);
  check("het punt onder de cursor is perspectief-correct het punt op 30 % van de staaf",
    hit && hit.point.distanceTo(p) < 1e-7, hit && `${hit.point.toArray()} ≠ ${p.toArray()}`);
  check("… en de afstand is die van de camera tot dat punt (als een raycast)",
    hit && Math.abs(hit.distance - cam.position.distanceTo(p)) < 1e-7);
  // Loodrecht op de geprojecteerde staaf verschuiven.
  const a = scherm(cam, knopen.get(1)), e = scherm(cam, knopen.get(2));
  const l = Math.hypot(e.x - a.x, e.y - a.y), nx = -(e.y - a.y) / l, ny = (e.x - a.x) / l;
  const naast = (d) => findOpenFem3DBeamNearScreenPoint(staven, knopen, cam, B, H, s.x + nx * d, s.y + ny * d);
  check("5 px naast de lijn: nog staaf 1", naast(5)?.beamId === 1 && Math.abs(naast(5).distancePx - 5) < 1e-6);
  check("7 px naast de lijn: niets", naast(7) === null);
  // Ingezoomd: de staaf begint achter de camera maar is voor de camera zichtbaar.
  const binnen = camera([0, 0, 2], [0, 10, 2]);
  const lang = new Map([{ id: 1, x: 1, y: -8, z: 2.5 }, { id: 2, x: 1, y: 30, z: 2.5 }].map((n) => [n.id, n]));
  const zicht = scherm(binnen, { x: 1, y: 12, z: 2.5 });
  check("een staaf die achter de camera begint, is aanklikbaar",
    findOpenFem3DBeamNearScreenPoint([{ id: 9, startNodeId: 1, endNodeId: 2 }], lang, binnen, B, H, zicht.x, zicht.y)?.beamId === 9);
}

log("\n[3] voorrang bij één klik");
{
  const punt = { x: 0, y: 0, z: 0 };
  const kies = (k) => chooseOpenFem3DPick({ loadDepthToleranceM: 1.6, ...k });
  const lijn = (id, distance, halfSizeM = 0.035) => ({ id, distance, halfSizeM, point: punt });
  check("niets geraakt → geen selectie", kies({}) === null);
  check("alleen een systeemlijn binnen 6 px → die staaf", kies({ lineBeam: lijn(4, 20) })?.id === 4);
  check("lastpijl op de staaf zelf (ervoor) → de last",
    kies({ load: { type: "memberLoad", id: 8, distance: 19.7 }, lineBeam: lijn(4, 20) })?.type === "memberLoad");
  check("lastpijl die net achter de staafas eindigt (binnen een pijllengte) → de last",
    kies({ load: { type: "memberLoad", id: 8, distance: 21.2 }, lineBeam: lijn(4, 20) })?.type === "memberLoad");
  const ver = kies({ load: { type: "memberLoad", id: 8, distance: 30 }, lineBeam: lijn(4, 20) });
  check("last van een ander element tien meter verderop → de staaf ervoor", ver?.type === "beam" && ver.id === 4, JSON.stringify(ver));
  check("een geraakt profiel dekt een pijl erachter af → de staaf",
    kies({ load: { type: "memberLoad", id: 8, distance: 20.3 }, rayBeam: lijn(4, 20.2, 0.3) })?.type === "beam");
  check("een pijl vóór het profiel → de last",
    kies({ load: { type: "memberLoad", id: 8, distance: 19.9 }, rayBeam: lijn(4, 20.2, 0.3) })?.type === "memberLoad");
  const knoop = { id: 3, distance: 20, radiusM: 0.08 };
  check("klik op de knoopbol → de knoop, ook met een staaf eronder",
    kies({ node: knoop, lineBeam: lijn(4, 20) })?.type === "node");
  check("knoop aan het staafeinde, binnen het profiel → de knoop",
    kies({ node: knoop, rayBeam: lijn(4, 19.75, 0.32) })?.type === "node");
  check("knoop ver achter een profiel → het profiel",
    kies({ node: knoop, rayBeam: lijn(4, 12, 0.32) })?.type === "beam");
  check("nodale last op de knoop → de last",
    kies({ node: knoop, load: { type: "nodalLoad", id: 2, distance: 19.5 } })?.type === "nodalLoad");
  check("dun verband vóór een zware ligger (lijn ervoor) → het verband",
    kies({ rayBeam: lijn(10, 25, 0.32), lineBeam: lijn(11, 18, 0.044) })?.id === 11);
  check("verband achter het geraakte profiel → het profiel",
    kies({ rayBeam: lijn(10, 18, 0.32), lineBeam: lijn(11, 25, 0.044) })?.id === 10);
  check("de geraakte staaf en de lijn zijn dezelfde → die staaf, met het geraakte punt",
    kies({ rayBeam: { id: 10, distance: 18, halfSizeM: 0.3, point: { x: 1, y: 2, z: 3 } }, lineBeam: lijn(10, 18.2) })?.point?.x === 1);
  const plaat = { id: 5, distance: 20, bandM: 0.35 };
  check("randstaaf in het plaatvlak, klik op de plaat vlak naast de staaf → de staaf",
    kies({ plate: plaat, lineBeam: lijn(4, 20.2) })?.type === "beam");
  check("staaf ver achter de halfdoorzichtige plaat → de plaat",
    kies({ plate: plaat, lineBeam: lijn(4, 26) })?.type === "plate");
  check("alleen de plaat → de plaat", kies({ plate: plaat })?.type === "plate");
  check("de reden staat erbij (diagnose)", kies({ lineBeam: lijn(4, 20) })?.reason === "beam-line"
    && kies({ rayBeam: lijn(4, 20) })?.reason === "beam-ray");
}

log("\n[4] crossing (van rechts naar links) tegenover het venster");
{
  const cam = camera([0, 0, 12], [0, 0, 0], [0, 1, 0]);
  const model = parseOpenFem3DModel({
    nodes: [
      { id: 1, x: -5, y: 0, z: 0 }, { id: 2, x: 5, y: 0, z: 0 },
      { id: 3, x: 0.2, y: 0.1, z: 0 }, { id: 4, x: -5, y: -2, z: 0 }, { id: 5, x: 5, y: -2, z: 0 },
      { id: 6, x: -5, y: 2, z: 0 }, { id: 7, x: 5, y: 2, z: 0 },
    ],
    beams: [
      { id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 4, endNodeId: 5 },
      { id: 3, startNodeId: 6, endNodeId: 7 },
    ],
  });
  const staaf = (id, geometrie, positie = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(geometrie, new THREE.MeshBasicMaterial());
    mesh.position.set(...positie);
    mesh.userData = { type: "beam", id };
    mesh.updateMatrixWorld();
    return mesh;
  };
  // Staaf 1: dunne as door het midden. Staaf 2 (y = −2) ligt ernaast. Staaf 3
  // (y = +2) heeft een doorsnede van 3 m hoog: zijn getekende profiel reikt
  // tot y = +0,5, zijn systeemlijn niet.
  const meshes = [
    staaf(1, new THREE.BoxGeometry(10, 0.07, 0.07)),
    staaf(2, new THREE.BoxGeometry(10, 0.07, 0.07), [0, -2, 0]),
    staaf(3, new THREE.BoxGeometry(10, 3, 0.2), [0, 2, 0]),
  ];
  const kaderRond = (x0, y0, x1, y1) => {
    const a = scherm(cam, { x: x0, y: y0, z: 0 }), b = scherm(cam, { x: x1, y: y1, z: 0 });
    return { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
  };
  const midden = kaderRond(-1, -0.4, 1, 0.3);
  const sel = (kader, modus, huidig = null, extra = false) =>
    selectOpenFem3DInScreenBox(model, meshes, cam, B, H, kader, huidig, extra, true, modus);
  const venster = sel(midden, "venster");
  check("venster over het midden van staaf 1: alleen de knoop erin", venster?.type === "node" && venster.id === 3, JSON.stringify(venster));
  const crossing = sel(midden, "crossing");
  check("crossing over het midden: staaf 1 (einden erbuiten) én de knoop",
    crossing?.type === "multi" && crossing.beamIds.join() === "1" && crossing.nodeIds.join() === "3", JSON.stringify(crossing));
  const profielKader = kaderRond(-1, 0.45, 1, 0.9);
  check("crossing raakt alleen het getekende profiel van staaf 3 (niet zijn systeemlijn)",
    JSON.stringify(sel(profielKader, "crossing")) === JSON.stringify({ type: "beam", id: 3 }), JSON.stringify(sel(profielKader, "crossing")));
  check("… het venster selecteert hem daar niet", sel(profielKader, "venster") === null);
  check("crossing met Shift voegt toe aan de selectie",
    JSON.stringify(sel(profielKader, "crossing", { type: "beam", id: 2 }, true)) === JSON.stringify({ type: "multi", nodeIds: [], beamIds: [2, 3] }));
  // GPU-batch: de systeemlijn van exemplaar 1 (staaf 1) wordt gebruikt.
  const batch = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.07, 0.07), new THREE.MeshBasicMaterial(), 2);
  batch.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(0, 0, 0), new THREE.Quaternion(), new THREE.Vector3(10, 1, 1)));
  batch.setMatrixAt(1, new THREE.Matrix4().compose(new THREE.Vector3(0, -2, 0), new THREE.Quaternion(), new THREE.Vector3(10, 1, 1)));
  batch.userData = { type: "beam", instanceIds: [1, 2] };
  batch.updateMatrixWorld();
  const batchSel = selectOpenFem3DInScreenBox(model, [batch], cam, B, H, midden, null, false, false, "crossing");
  check("crossing in een GPU-batch: alleen het exemplaar dat het kader raakt", JSON.stringify(batchSel) === JSON.stringify({ type: "beam", id: 1 }), JSON.stringify(batchSel));
  // Plaat met opening: een kader in de opening raakt de plaat niet, over de rand wel.
  const plaatModel = addOpenFem3DPlateOpening(addOpenFem3DPlate(parseOpenFem3DModel({
    nodes: [
      { id: 1, x: -3, y: -2, z: 0 }, { id: 2, x: 3, y: -2, z: 0 }, { id: 3, x: 3, y: 2, z: 0 }, { id: 4, x: -3, y: 2, z: 0 },
      { id: 5, x: -1, y: -1, z: 0 }, { id: 6, x: 1, y: -1, z: 0 }, { id: 7, x: 1, y: 1, z: 0 }, { id: 8, x: -1, y: 1, z: 0 },
    ],
    beams: [],
  }), [1, 2, 3, 4], { thicknessM: 0.2 }), 1, [5, 6, 7, 8]);
  const gebouwd = createOpenFem3DPlateGeometry(plaatModel, plaatModel.plates[0]);
  const plaatMesh = new THREE.Mesh(gebouwd.geometry, new THREE.MeshBasicMaterial());
  plaatMesh.position.copy(gebouwd.position);
  plaatMesh.quaternion.copy(gebouwd.quaternion);
  plaatMesh.userData = { type: "plate", id: 1 };
  plaatMesh.updateMatrixWorld();
  const plaatSel = (kader, modus) => selectOpenFem3DInScreenBox(plaatModel, [plaatMesh], cam, B, H, kader, null, false, false, modus);
  check("crossing geheel in de opening → de plaat niet", plaatSel(kaderRond(-0.5, -0.5, 0.5, 0.5), "crossing") === null);
  check("crossing over de rand van de opening → de plaat", JSON.stringify(plaatSel(kaderRond(0.5, -0.5, 1.5, 0.5), "crossing")) === JSON.stringify({ type: "plate", id: 1 }));
  check("… het venster daar niet; een venster om de hele plaat wel",
    plaatSel(kaderRond(0.5, -0.5, 1.5, 0.5), "venster") === null
    && JSON.stringify(plaatSel(kaderRond(-3.5, -2.5, 3.5, 2.5), "venster")) === JSON.stringify({ type: "plate", id: 1 }));
}

log("\n[5] draaien rond het midden van de selectie");
{
  const model = parseOpenFem3DModel({
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6, y: 4, z: 3 }, { id: 4, x: 0, y: 4, z: 3 },
    ],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 2, endNodeId: 3 }],
    loads: [{ id: 5, nodeId: 3, fx: 0, fy: 0, fz: -10, mx: 0, my: 0, mz: 0 }],
    memberLoads: [{ id: 6, beamId: 2, qyStart: 0, qyEnd: 0, qzStart: -1, qzEnd: -1, startPositionM: 0, endPositionM: 5 }],
  });
  const metPlaat = addOpenFem3DSurfaceLoad(addOpenFem3DPlate(model, [1, 2, 3, 4], { thicknessM: 0.2 }), 1, { qx: 0, qy: 0, qz: -2 });
  const v = (sel) => openFem3DSelectionPivot(metPlaat, sel)?.toArray().map((x) => +x.toFixed(9)).join(",");
  check("knoop → de knoop", v({ type: "node", id: 3 }) === "6,4,3");
  check("staaf → het midden van de staaf", v({ type: "beam", id: 2 }) === "6,2,1.5");
  check("plaat → het midden van het omhullende kader van de hoeken", v({ type: "plate", id: 1 }) === "3,2,1.5");
  check("meervoudig → het midden van knopen, staafeinden en plaathoeken samen",
    v({ type: "multi", nodeIds: [1], beamIds: [2], plateIds: [] }) === "3,2,1.5");
  check("lasten draaien om hun element", v({ type: "nodalLoad", id: 5 }) === "6,4,3" && v({ type: "memberLoad", id: 6 }) === "6,2,1.5"
    && v({ type: "surfaceLoad", id: 1 }) === "3,2,1.5");
  check("geen selectie of een verdwenen element → geen draaipunt",
    openFem3DSelectionPivot(metPlaat, null) === null && openFem3DSelectionPivot(metPlaat, { type: "beam", id: 99 }) === null);

  // De echte OrbitControls, zonder DOM: rotateLeft/rotateUp roepen update()
  // aan en melden `change`; daar volgt de correctie net als in het tekenvlak.
  const draai = (metDraaipunt) => {
    const cam = new THREE.PerspectiveCamera(50, B / H, 0.1, 1000);
    cam.up.set(0, 0, 1);
    cam.position.set(20, -30, 15);
    const controls = new OrbitControls(cam);
    controls.target.set(0, 0, 0);
    controls.update();
    const draaipunt = new THREE.Vector3(8, 3, 4);
    const q = cam.quaternion.clone();
    if (metDraaipunt) {
      controls.addEventListener("change", () => {
        const shift = openFem3DOrbitPivotShift(q, cam.quaternion, draaipunt, controls.target);
        cam.position.add(shift);
        controls.target.add(shift);
        q.copy(cam.quaternion);
      });
    }
    cam.updateMatrixWorld();
    const voor = draaipunt.clone().project(cam);
    const afstandVoor = cam.position.distanceTo(draaipunt);
    const doelVoor = controls.target.clone();
    const qVoor = cam.quaternion.clone();
    const stappen = [];
    for (const [links, omhoog] of [[0.12, 0.05], [0.2, -0.08], [-0.05, 0.1], [0.3, 0.02]]) {
      controls.rotateLeft(links);
      controls.rotateUp(omhoog);
      cam.updateMatrixWorld();
      stappen.push(draaipunt.clone().project(cam));
    }
    return { voor, stappen, afstandVoor, afstandNa: cam.position.distanceTo(draaipunt), doelVoor, doelNa: controls.target.clone(), hoek: qVoor.angleTo(cam.quaternion) };
  };
  const met = draai(true);
  const afwijking = Math.max(...met.stappen.map((p) => Math.hypot((p.x - met.voor.x) * B / 2, (p.y - met.voor.y) * H / 2)));
  check("na elke draaistap staat het draaipunt op dezelfde schermplek (< 1e-6 px)", afwijking < 1e-6, `${afwijking} px`);
  check("… ook na de eerste stap: geen sprong", Math.hypot((met.stappen[0].x - met.voor.x) * B / 2, (met.stappen[0].y - met.voor.y) * H / 2) < 1e-6);
  check("de camera draait werkelijk (en blijft op afstand van het draaipunt)",
    met.hoek > 0.3 && Math.abs(met.afstandNa - met.afstandVoor) < 1e-9, `hoek ${met.hoek}, afstand ${met.afstandVoor} → ${met.afstandNa}`);
  check("het doel van de besturing schuift mee", met.doelNa.distanceTo(met.doelVoor) > 1);
  const zonder = draai(false);
  const verschuiving = Math.hypot((zonder.stappen.at(-1).x - zonder.voor.x) * B / 2, (zonder.stappen.at(-1).y - zonder.voor.y) * H / 2);
  check("zonder draaipunt (geen selectie): gewoon om het doel, het punt schuift over het scherm",
    verschuiving > 20 && zonder.doelNa.distanceTo(zonder.doelVoor) < 1e-12, `${verschuiving.toFixed(1)} px`);
  // (I − R)(c − t) is nul als het draaipunt het doel is.
  const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.4);
  check("draaipunt gelijk aan het doel → geen verschuiving",
    openFem3DOrbitPivotShift(q0, q1, new THREE.Vector3(1, 2, 3), new THREE.Vector3(1, 2, 3)).length() < 1e-15);
}

log("\n[6] verwijderen van de selectie en ongedaan maken");
{
  const basis = parseOpenFem3DModel({
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6, y: 4, z: 0 }, { id: 4, x: 0, y: 4, z: 0 },
      { id: 5, x: 2, y: 1, z: 0 }, { id: 6, x: 4, y: 1, z: 0 }, { id: 7, x: 4, y: 3, z: 0 }, { id: 8, x: 2, y: 3, z: 0 },
    ],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 2, endNodeId: 3 }],
    memberLoads: [{ id: 1, beamId: 1, qyStart: 0, qyEnd: 0, qzStart: -2, qzEnd: -2, startPositionM: 0, endPositionM: 6 }],
  });
  const model = addOpenFem3DSurfaceLoad(addOpenFem3DPlateOpening(
    addOpenFem3DPlate(basis, [1, 2, 3, 4], { thicknessM: 0.2 }), 1, [5, 6, 7, 8]), 1, { qx: 0, qy: 0, qz: -3 });
  const zonderPlaat = removeOpenFem3DSelection(model, { type: "plate", id: 1 });
  check("plaat weg, met haar opening en oppervlaktelast", (zonderPlaat.plates ?? []).length === 0 && (zonderPlaat.surfaceLoads ?? []).length === 0);
  check("… knopen, staven en de staaflast blijven", zonderPlaat.nodes.length === 8 && zonderPlaat.beams.length === 2 && zonderPlaat.memberLoads.length === 1);
  const multi = removeOpenFem3DSelection(model, { type: "multi", nodeIds: [5], beamIds: [1], plateIds: [] });
  check("meervoudig: een knoop van de opening neemt de plaat mee; de staaf gaat met zijn last",
    (multi.plates ?? []).length === 0 && multi.beams.map((b) => b.id).join() === "2" && multi.memberLoads.length === 0
    && !multi.nodes.some((n) => n.id === 5));
  check("geen selectie → model ongewijzigd", removeOpenFem3DSelection(model, null) === model);
  let historie = { model, past: [], future: [] };
  historie = openFem3dHistoryReducer(historie, { type: "edit", model: zonderPlaat });
  historie = openFem3dHistoryReducer(historie, { type: "undo" });
  check("Ctrl+Z zet de plaat met opening en last terug (hetzelfde model)", historie.model === model
    && historie.model.plates[0].openings.length === 1 && historie.model.surfaceLoads.length === 1);
  historie = openFem3dHistoryReducer(historie, { type: "redo" });
  check("opnieuw doen verwijdert haar weer", historie.model === zonderPlaat);
}

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

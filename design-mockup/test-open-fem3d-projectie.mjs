// Perspectief of parallel in het 3D-tekenvlak (issue #85, deel B): de
// omrekening bij het wisselen (h = d · tan(fov/2), heen en terug identiek),
// één wereldmaat per pixel bij het doel in beide standen, hetzelfde beeld in
// het vlak door het doel, de afstand tot de camera zoals de raycast meet, de
// plek van de parallelle camera (alles vóór het nabije vlak), passend beeld
// met dezelfde marge, de wielstap rond het anker en pannen één op één met de
// echte OrbitControls. Daarnaast de bewaarde schaal in views (orthoHalfHeight)
// en de zichtbaarheidssleutel `perspective`. Verder: bij knopen precies
// achter elkaar (parallel vallen ze samen) kiezen klik en tekensnap de
// voorste, en de muisstraal raakt het werkvlak in parallel over de hele lijn.
//
// Uitvoeren: npx tsx test-open-fem3d-projectie.mjs
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
const {
  OPEN_FEM_3D_FOV_GRADEN, isOpenFem3DOrtho, openFem3DCameraAfstand, openFem3DOrthoAfstand, openFem3DOrthoHalveHoogte,
  openFem3DOrthoHalveHoogteVan, openFem3DOrthoPassendeHalveHoogte, openFem3DOrthoWielStap, openFem3DPerspectiefAfstand,
  openFem3DStraalOpVlak, openFem3DWereldmaatPerPixel, openFem3DZetOrthoFrustum,
} = await import("./src/components/openFem3d/openFem3dProjectie.ts");
const {
  OPEN_FEM_3D_NODE_SNAP_GELIJK_PX, buildOpenFem3DNodeSnapScreenIndex, findOpenFem3DNodeAtScreenPoint, findOpenFem3DNodeScreenSnap,
} = await import("./src/components/openFem3d/openFem3dNodeSnapIndex.ts");
const { bewaarOpenFem3DViewSet, parseOpenFem3DViewSets } = await import("./src/components/openFem3d/openFem3dViewSets.ts");
const { DEFAULT_OPEN_FEM_3D_VISIBILITY, OPEN_FEM_3D_RESULT_LAYERS } = await import("./src/components/openFem3d/openFem3dVisibility.ts");

let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => { if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); } };
const BREED = 1000, HOOG = 700, ASPECT = BREED / HOOG;

/** Een perspectiefcamera en de parallelle camera die er bij het wisselen uit volgt. */
function cameraPaar(positie, doel, up = [0, 0, 1], fov = OPEN_FEM_3D_FOV_GRADEN) {
  const p = new THREE.PerspectiveCamera(fov, ASPECT, 0.01, 1e5);
  p.up.set(...up);
  p.position.set(...positie);
  p.lookAt(...doel);
  p.updateMatrixWorld();
  const d = p.position.distanceTo(new THREE.Vector3(...doel));
  const o = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1e5);
  openFem3DZetOrthoFrustum(o, openFem3DOrthoHalveHoogte(d, fov), ASPECT);
  o.up.set(...up);
  // Verder terug langs dezelfde richting: het beeld hangt er niet van af.
  o.position.copy(new THREE.Vector3(...doel)).addScaledVector(p.position.clone().sub(new THREE.Vector3(...doel)).normalize(), 3 * d + 40);
  o.lookAt(...doel);
  o.updateMatrixWorld();
  return { p, o, d };
}
const scherm = (camera, punt) => {
  const n = punt.clone().project(camera);
  return { x: (n.x + 1) * BREED / 2, y: (1 - n.y) * HOOG / 2 };
};

log("[1] omrekening perspectief ↔ parallel: h = d · tan(fov/2), heen en terug identiek binnen 1e-9");
{
  const fouten = [];
  let n = 0;
  for (const fov of [10, 35, 50, 75, 120]) {
    for (let e = -3; e <= 5; e += 0.125) {
      const d = 10 ** e;
      n++;
      const h = openFem3DOrthoHalveHoogte(d, fov);
      if (Math.abs(h - d * Math.tan(fov * Math.PI / 360)) > 1e-12 * Math.max(1, h)) fouten.push(`h(${d}, ${fov})`);
      const terug = openFem3DPerspectiefAfstand(h, fov);
      if (Math.abs(terug - d) > 1e-9 * Math.max(1, d)) fouten.push(`d → h → d: ${d} → ${terug}`);
      const heen = openFem3DOrthoHalveHoogte(openFem3DPerspectiefAfstand(d, fov), fov);
      if (Math.abs(heen - d) > 1e-9 * Math.max(1, d)) fouten.push(`h → d → h: ${d} → ${heen}`);
    }
  }
  check(`${n} afstanden (1 mm tot 100 km) bij vijf gezichtshoeken, heen en terug`, fouten.length === 0, fouten.slice(0, 4).join("; "));
  check("standaard: de gezichtshoek van het tekenvlak (50°)", OPEN_FEM_3D_FOV_GRADEN === 50
    && Math.abs(openFem3DOrthoHalveHoogte(10) - 10 * Math.tan(25 * Math.PI / 180)) < 1e-12);
}

log("\n[2] het ortho-frustum: symmetrisch, breedte naar de beeldverhouding, zoom meegerekend");
{
  const o = new THREE.OrthographicCamera();
  openFem3DZetOrthoFrustum(o, 4, 1.5);
  check("top/bottom = ±h, left/right = ±h · aspect, zoom 1",
    o.top === 4 && o.bottom === -4 && o.left === -6 && o.right === 6 && o.zoom === 1);
  check("halve hoogte terug te lezen", openFem3DOrthoHalveHoogteVan(o) === 4);
  o.zoom = 2;
  o.updateProjectionMatrix();
  check("met zoom 2 (knijpen in OrbitControls) is de zichtbare halve hoogte de helft", openFem3DOrthoHalveHoogteVan(o) === 2);
  check("projectiematrix: pixels per meter = 1/h (clip-w 1)", Math.abs(o.projectionMatrix.elements[5] - 1 / 2) < 1e-15
    && o.projectionMatrix.elements[15] === 1 && o.projectionMatrix.elements[11] === 0);
  check("herkenning van het cameratype", isOpenFem3DOrtho(o) && !isOpenFem3DOrtho(new THREE.PerspectiveCamera()));
}

log("\n[3] dezelfde zichtbare grootte bij het doel: wereldmaat per pixel en schermposities gelijk");
{
  const fouten = [];
  for (const [positie, doel, up] of [
    [[14, -18, 12], [0.5, 0, 3], [0, 0, 1]], [[3, 7.5, 30], [3, 7.5, 8.75], [0, 1, 0]],
    [[0.2, -0.3, 0.4], [0, 0, 0], [0, 0, 1]], [[-600, 700, 500], [9, 4, -3], [0, 0, 1]],
  ]) {
    const { p, o } = cameraPaar(positie, doel, up);
    const t = new THREE.Vector3(...doel);
    const wp = openFem3DWereldmaatPerPixel(p, t, HOOG), wo = openFem3DWereldmaatPerPixel(o, t, HOOG);
    if (Math.abs(wp - wo) > 1e-12 * wp) fouten.push(`wereldmaat ${wp} ≠ ${wo}`);
    // Punten in het vlak door het doel, loodrecht op de kijkrichting.
    const rechts = new THREE.Vector3(1, 0, 0).applyQuaternion(p.quaternion);
    const boven = new THREE.Vector3(0, 1, 0).applyQuaternion(p.quaternion);
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [-3, 2], [5, -4]]) {
      const punt = t.clone().addScaledVector(rechts, a * wp * 50).addScaledVector(boven, b * wp * 50);
      const sp = scherm(p, punt), so = scherm(o, punt);
      if (Math.hypot(sp.x - so.x, sp.y - so.y) > 1e-6) fouten.push(`${positie}: (${a}, ${b}) ${sp.x},${sp.y} ≠ ${so.x},${so.y}`);
    }
    // En de wereldmaat zelf: 100 px in het vlak door het doel = 100 · w meter.
    const honderd = scherm(o, t.clone().addScaledVector(rechts, 100 * wo));
    if (Math.abs(honderd.x - BREED / 2 - 100) > 1e-6) fouten.push(`100 px ≠ ${honderd.x - BREED / 2}`);
  }
  check("vier camera's (ook bovenaanzicht en zeer ver): identiek in het vlak door het doel", fouten.length === 0, fouten.slice(0, 4).join("; "));
  const { p, o } = cameraPaar([14, -18, 12], [0.5, 0, 3]);
  const achter = new THREE.Vector3(0.5, 0, 3).addScaledVector(p.position.clone().sub(new THREE.Vector3(0.5, 0, 3)).normalize(), -10);
  const sp = scherm(p, achter.clone().add(new THREE.Vector3(3, 0, 0))), so = scherm(o, achter.clone().add(new THREE.Vector3(3, 0, 0)));
  check("opzet: achter het doel verschillen de twee beelden wel (perspectief verkleint)", Math.hypot(sp.x - so.x, sp.y - so.y) > 5);
}

log("\n[4] afstand tot de camera zoals de raycast meet (perspectief: oogpunt; parallel: langs de kijkrichting)");
{
  const vlak = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  vlak.rotation.x = 0.3;
  vlak.position.set(1, 2, -1);
  vlak.updateMatrixWorld();
  const straal = new THREE.Raycaster();
  const fouten = [];
  const { p, o } = cameraPaar([14, -18, 12], [0.5, 0, 3]);
  for (const camera of [p, o]) {
    for (const [x, y] of [[0, 0], [0.4, -0.3], [-0.7, 0.6], [0.9, 0.9]]) {
      straal.setFromCamera(new THREE.Vector2(x, y), camera);
      const treffer = straal.intersectObject(vlak)[0];
      if (!treffer) { fouten.push(`${camera.type} (${x}, ${y}): geen treffer`); continue; }
      const afstand = openFem3DCameraAfstand(camera, treffer.point);
      if (Math.abs(afstand - treffer.distance) > 1e-9 * Math.max(1, treffer.distance)) {
        fouten.push(`${camera.type} (${x}, ${y}): ${afstand} ≠ ${treffer.distance}`);
      }
    }
  }
  check("gelijk aan de afstand van de raycasttreffer, in beide standen", fouten.length === 0, fouten.join("; "));
  const punt = new THREE.Vector3(9, 4, 2);
  check("parallel ≠ euclidisch naast de kijkas (de oude meting zou ernaast zitten)",
    Math.abs(openFem3DCameraAfstand(o, punt) - o.position.distanceTo(punt)) > 0.1);
}

log("\n[5] plek van de parallelle camera: alles vóór het nabije vlak, in elke kijkrichting");
{
  const bol = { middelpunt: new THREE.Vector3(30, 15, 4), straal: 40 };
  const fouten = [];
  let n = 0;
  for (const doel of [[30, 15, 4], [0, 0, 0], [200, -150, 30]]) {
    for (const h of [0.01, 3, 50, 4000]) {
      const { afstand, near, far } = openFem3DOrthoAfstand(h, new THREE.Vector3(...doel), bol);
      if (afstand < openFem3DPerspectiefAfstand(h) - 1e-9) fouten.push(`afstand < perspectiefafstand bij h = ${h}`);
      for (let i = 0; i < 40; i++) {
        n++;
        const r = new THREE.Vector3(Math.sin(i * 2.4) * Math.cos(i), Math.cos(i * 2.4) * Math.cos(i), Math.sin(i)).normalize();
        const camera = new THREE.Vector3(...doel).addScaledVector(r, afstand);
        // Het dichtste en verste punt van de bol langs de kijkrichting (−r).
        const centrumDiepte = bol.middelpunt.clone().sub(camera).dot(r.clone().negate());
        if (centrumDiepte - bol.straal < near + 0.5 || centrumDiepte + bol.straal > far - 0.5) {
          fouten.push(`doel ${doel}, h ${h}, richting ${i}: ${(centrumDiepte - bol.straal).toFixed(2)}..${(centrumDiepte + bol.straal).toFixed(2)} buiten ${near}..${far.toFixed(2)}`);
        }
      }
    }
  }
  check(`${n} standen (drie doelen, ook ver buiten het model; vier schalen): de hele bol tussen near en far`, fouten.length === 0, fouten.slice(0, 3).join("; "));
  const dicht = openFem3DOrthoAfstand(openFem3DOrthoHalveHoogte(500), new THREE.Vector3(30, 15, 4), bol);
  check("ver uitgezoomd: de camera staat op de perspectiefafstand (dezelfde positie als in perspectief)",
    Math.abs(dicht.afstand - 500) < 1e-9);
}

log("\n[6] passend beeld in parallel: dezelfde marge als in perspectief");
{
  const bruikbaar = { breedte: 1 - 48 / BREED, hoogte: 1 - 88 / HOOG };
  const box = new THREE.Box3(new THREE.Vector3(-5, 0, 0), new THREE.Vector3(6, 0.2, 6));
  const fouten = [];
  for (const richting of [[1.4, -1.4, 1], [0, -1, 0], [0, 0, 1], [1, 0, 0], [-1, 1, -1]]) {
    const up = richting[0] === 0 && richting[1] === 0 ? [0, 1, 0] : [0, 0, 1];
    const r = new THREE.Vector3(...richting).normalize();
    const midden = box.getCenter(new THREE.Vector3());
    const o = new THREE.OrthographicCamera();
    o.up.set(...up);
    o.position.copy(midden).addScaledVector(r, 100);
    o.lookAt(midden);
    o.updateMatrixWorld();
    // Halve schermmaten van de acht hoeken (zoals ThreeFrameCanvas ze projecteert).
    const rechts = new THREE.Vector3().crossVectors(o.up, r).normalize(), verticaal = new THREE.Vector3().crossVectors(r, rechts);
    let halfWidth = 0, halfHeight = 0;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const v = new THREE.Vector3(x, y, z).sub(midden);
      halfWidth = Math.max(halfWidth, Math.abs(v.dot(rechts)));
      halfHeight = Math.max(halfHeight, Math.abs(v.dot(verticaal)));
    }
    const h = openFem3DOrthoPassendeHalveHoogte({ halfWidth, halfHeight }, ASPECT, bruikbaar);
    openFem3DZetOrthoFrustum(o, h, ASPECT);
    let maxX = 0, maxY = 0;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const n = new THREE.Vector3(x, y, z).project(o);
      maxX = Math.max(maxX, Math.abs(n.x));
      maxY = Math.max(maxY, Math.abs(n.y));
    }
    // Binnen het bruikbare deel met de marge 1,08, en in één richting precies daarop.
    const rx = maxX / (bruikbaar.breedte / 1.08), ry = maxY / (bruikbaar.hoogte / 1.08);
    if (rx > 1 + 1e-9 || ry > 1 + 1e-9 || Math.abs(Math.max(rx, ry) - 1) > 1e-9) {
      if (h > openFem3DOrthoHalveHoogte(2) + 1e-12) fouten.push(`${richting}: ${rx.toFixed(6)}, ${ry.toFixed(6)}`);
    }
  }
  check("vijf kijkrichtingen: alle hoeken binnen het bruikbare beeld (÷ 1,08), aan één kant precies passend", fouten.length === 0, fouten.join("; "));
  check("een klein model: nooit kleiner dan bij 2 m perspectiefafstand",
    openFem3DOrthoPassendeHalveHoogte({ halfWidth: 0.01, halfHeight: 0.01 }, ASPECT, bruikbaar) === openFem3DOrthoHalveHoogte(2));
}

log("\n[7] wielstap in parallel: het anker blijft op zijn schermplek");
{
  const fouten = [];
  for (const [anker, schaal] of [[[3, 0, 6], 0.7], [[-5, 0, 0], 1.4], [[20, -8, 1], 0.95 ** 12], [[0.5, 0, 3], 0.5]]) {
    const { o } = cameraPaar([14, -18, 12], [0.5, 0, 3]);
    const a = new THREE.Vector3(...anker);
    const voor = scherm(o, a);
    const doel = new THREE.Vector3(0.5, 0, 3);
    const richting = o.position.clone().sub(doel).normalize();
    const stap = openFem3DOrthoWielStap(doel, a, openFem3DOrthoHalveHoogteVan(o), schaal);
    openFem3DZetOrthoFrustum(o, stap.halveHoogte, ASPECT);
    o.position.copy(stap.doel).addScaledVector(richting, 80);
    o.lookAt(stap.doel);
    o.updateMatrixWorld();
    const na = scherm(o, a);
    if (Math.hypot(na.x - voor.x, na.y - voor.y) > 1e-6) fouten.push(`${anker}: ${voor.x.toFixed(3)},${voor.y.toFixed(3)} → ${na.x.toFixed(3)},${na.y.toFixed(3)}`);
    if (Math.abs(stap.halveHoogte - openFem3DOrthoHalveHoogte(new THREE.Vector3(14, -18, 12).distanceTo(doel)) * schaal) > 1e-9) fouten.push("schaal");
  }
  check("vier ankers (op het doel, ver ernaast, in en uit): op 1e-6 px op zijn plek, halve hoogte × schaal", fouten.length === 0, fouten.join("; "));
}

log("\n[8] pannen in parallel met de echte OrbitControls (panSpeed 1): elk punt gaat één op één met de muis mee");
{
  const { o } = cameraPaar([14, -18, 12], [0.5, 0, 3]);
  const controls = new OrbitControls(o);
  controls.domElement = { clientWidth: BREED, clientHeight: HOOG };
  controls.screenSpacePanning = true;
  controls.panSpeed = 1;
  controls.target.set(0.5, 0, 3);
  controls.update();
  o.updateMatrixWorld();
  const punten = [new THREE.Vector3(0.5, 0, 3), new THREE.Vector3(6, 0, 6), new THREE.Vector3(-5, 30, -2)];
  const voor = punten.map((p) => scherm(o, p));
  // Muis 40 px naar rechts en 25 px omhoog (OrbitControls: _pan na deltas × panSpeed).
  controls._pan(40 * controls.panSpeed, -25 * controls.panSpeed);
  controls.update();
  o.updateMatrixWorld();
  const na = punten.map((p) => scherm(o, p));
  const fout = punten.map((_, i) => Math.hypot(na[i].x - voor[i].x - 40, na[i].y - voor[i].y + 25));
  check("drie punten op verschillende diepte: precies (+40, −25) px", fout.every((f) => f < 1e-6), fout.map((f) => f.toExponential(2)).join(", "));
}

log("\n[9] bewaarde schaal (orthoHalfHeight) in views; oude views zonder veld zoals nu");
{
  const cam = { position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1] };
  const [oud, parallel, fout] = parseOpenFem3DViewSets([
    { id: "view-1", name: "Oud", view: "iso", camera: cam, visibility: { beams: true }, combinationId: null },
    { id: "view-2", name: "Parallel", view: "iso", camera: { ...cam, orthoHalfHeight: 3.25 }, visibility: { perspective: false }, combinationId: null },
    { id: "view-3", name: "Fout", view: "iso", camera: { ...cam, orthoHalfHeight: -1 }, visibility: {}, combinationId: null },
  ]);
  check("oude view: geen orthoHalfHeight, perspectief aan", !("orthoHalfHeight" in oud.camera) && oud.visibility.perspective === true);
  check("parallelle view: schaal en perspective = uit bewaard", parallel.camera.orthoHalfHeight === 3.25 && parallel.visibility.perspective === false);
  check("een ongeldige schaal valt weg", !("orthoHalfHeight" in fout.camera));
  const opgeslagen = bewaarOpenFem3DViewSet([], "Gevel", {
    view: "front", camera: { ...cam, orthoHalfHeight: 7.5 }, visibility: { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, perspective: false },
    combinationId: null, loadCaseId: 1, mode: "model",
  });
  check("opslaan neemt de schaal mee", opgeslagen[0].camera.orthoHalfHeight === 7.5 && opgeslagen[0].visibility.perspective === false);
  const perspectief = bewaarOpenFem3DViewSet([], "Iso", {
    view: "iso", camera: cam, visibility: DEFAULT_OPEN_FEM_3D_VISIBILITY, combinationId: null, loadCaseId: 1, mode: "model",
  });
  check("in perspectief geen schaalveld", !("orthoHalfHeight" in perspectief[0].camera));
  const terug = parseOpenFem3DViewSets(JSON.parse(JSON.stringify(opgeslagen)));
  check("heen en terug door het projectbestand (JSON)", terug[0].camera.orthoHalfHeight === 7.5);
}

log("\n[10] zichtbaarheid `perspective`: standaard aan, geen resultaatlaag");
check("standaard aan", DEFAULT_OPEN_FEM_3D_VISIBILITY.perspective === true);
check("geen resultaatlaag (staat onder Weergave)", !OPEN_FEM_3D_RESULT_LAYERS.includes("perspective"));

log("\n[11] knopen precies achter elkaar: klik en tekensnap kiezen de voorste (ook als de afronding de achterste een fractie dichterbij legt)");
{
  // Raster 3 × 4 × 2 knopen; muis op hele pixels.
  const knopen = [];
  for (const z of [0, 4]) for (const y of [0, 6, 12, 18]) for (const x of [0, 6, 12]) knopen.push({ id: knopen.length + 1, x, y, z });
  const cameras = [];
  // Voor-, zij- en bovenaanzicht in parallel, bij drie doelen, drie afstanden en drie schalen (27 per aanzicht).
  for (const [naam, richting, up] of [["voor", [0, -1, 0], [0, 0, 1]], ["zij", [1, 0, 0], [0, 0, 1]], ["boven", [0, 0, 1], [0, 1, 0]]]) {
    for (const doel of [[6, 9, 2], [5.3, 8.1, 1.7], [0.37, 2.9, 3.3]]) for (const afstand of [25, 61.3, 140]) for (const h of [7.1, 11.66, 23.9]) {
      const o = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1000);
      openFem3DZetOrthoFrustum(o, h, ASPECT);
      o.up.set(...up);
      o.position.set(doel[0] + richting[0] * afstand, doel[1] + richting[1] * afstand, doel[2] + richting[2] * afstand);
      o.lookAt(...doel);
      o.updateMatrixWorld();
      cameras.push([naam, o, doel]);
    }
  }
  const fouten = [];
  let samen = 0, ongelijk = 0, n = 0;
  for (const [naam, o] of cameras) {
    const index = buildOpenFem3DNodeSnapScreenIndex(knopen, o, BREED, HOOG);
    const punten = [...index.buckets.values()].flat();
    for (const punt of punten) {
      const x = Math.round(punt.xPx), y = Math.round(punt.yPx);
      // Alle knopen op (vrijwel) hetzelfde schermpunt; de voorste heeft de kleinste diepte.
      const groep = punten.filter((q) => Math.hypot(q.xPx - punt.xPx, q.yPx - punt.yPx) < 1e-6);
      const voorste = groep.reduce((a, b) => (b.depth < a.depth ? b : a));
      if (groep.length > 1) {
        samen++;
        if (new Set(groep.map((q) => Math.hypot(q.xPx - x, q.yPx - y))).size > 1) ongelijk++;
      }
      n++;
      const klik = findOpenFem3DNodeAtScreenPoint(index, x, y, () => 6, 48);
      const snap = findOpenFem3DNodeScreenSnap(index, x, y);
      if (klik?.point.id !== voorste.id) fouten.push(`${naam} klik (${x}, ${y}): ${klik?.point.id} ≠ ${voorste.id}`);
      if (snap?.point.id !== voorste.id) fouten.push(`${naam} snap (${x}, ${y}): ${snap?.point.id} ≠ ${voorste.id}`);
    }
  }
  check(`opzet: in ${samen} van ${n} keuzes liggen knopen achter elkaar; in ${ongelijk} daarvan verschillen hun afstanden alleen door afronding`,
    samen > 100 && ongelijk > 10);
  check("parallel (voor, zij, boven; 81 camera's): klik en tekensnap geven altijd de voorste knoop", fouten.length === 0, fouten.slice(0, 4).join("; "));
  check("de marge is een afronding, geen klikzone (≤ 0,01 px)", OPEN_FEM_3D_NODE_SNAP_GELIJK_PX > 0 && OPEN_FEM_3D_NODE_SNAP_GELIJK_PX <= 0.01);
  // Twee knopen 0,5 px uit elkaar zijn niet gelijk: de dichtste wint, ook als hij erachter ligt.
  const [, o, doel] = cameras[0];
  const wp = openFem3DWereldmaatPerPixel(o, new THREE.Vector3(...doel), HOOG);
  const naast = buildOpenFem3DNodeSnapScreenIndex([{ id: 1, x: 6, y: 0, z: 4 }, { id: 2, x: 6 + 0.5 * wp, y: 18, z: 4 }], o, BREED, HOOG);
  const p1 = [...naast.buckets.values()].flat().find((q) => q.id === 1);
  check("0,5 px naast elkaar: de dichtste wint (hier de achterste, de muis staat erop)",
    findOpenFem3DNodeScreenSnap(naast, p1.xPx + 0.5, p1.yPx)?.point.id === 2
    && findOpenFem3DNodeAtScreenPoint(naast, p1.xPx + 0.5, p1.yPx, () => 6, 48)?.point.id === 2);
  // In perspectief vallen ze niet samen; een klik precies op een knoop kiest die knoop.
  const p = new THREE.PerspectiveCamera(50, ASPECT, 0.01, 1e5);
  p.up.set(0, 0, 1);
  p.position.set(6, -25, 2);
  p.lookAt(6, 9, 2);
  p.updateMatrixWorld();
  const pIndex = buildOpenFem3DNodeSnapScreenIndex(knopen, p, BREED, HOOG);
  const pFouten = [];
  for (const punt of [...pIndex.buckets.values()].flat()) {
    const keuze = findOpenFem3DNodeAtScreenPoint(pIndex, punt.xPx, punt.yPx, () => 6, 48);
    if (keuze?.point.id !== punt.id) pFouten.push(`${punt.id} → ${keuze?.point.id}`);
  }
  check("perspectief: een klik precies op een knoop kiest die knoop", pFouten.length === 0, pFouten.join(", "));
}

log("\n[12] de muisstraal op het werkvlak: parallel de hele lijn, perspectief de halve straal");
{
  // Lage kijkhoek (10°), 25 m van het doel; de parallelle camera staat op
  // die plek (near 0): onderin het beeld ligt het werkvlak z = 0 achter het cameravlak.
  const e = 10 * Math.PI / 180;
  const positie = [0.5, -25 * Math.cos(e), 3 + 25 * Math.sin(e)];
  const { p, o } = cameraPaar(positie, [0.5, 0, 3]);
  o.position.set(...positie);
  o.lookAt(0.5, 0, 3);
  o.updateMatrixWorld();
  const werkvlak = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const straal = new THREE.Raycaster();
  const fouten = [];
  let achter = 0;
  for (const py of [100, 350, 500, 600, 660, 690]) {
    straal.setFromCamera(new THREE.Vector2(0, 1 - py / HOOG * 2), o);
    const punt = openFem3DStraalOpVlak(o, straal.ray, werkvlak, new THREE.Vector3());
    if (!punt) { fouten.push(`${py} px: geen punt`); continue; }
    if (Math.abs(punt.z) > 1e-9) fouten.push(`${py} px: z = ${punt.z}`);
    const terug = scherm(o, punt);
    if (Math.abs(terug.y - py) > 1e-6 || Math.abs(terug.x - BREED / 2) > 1e-6) fouten.push(`${py} px: terug op ${terug.x}, ${terug.y}`);
    if (straal.ray.intersectPlane(werkvlak, new THREE.Vector3()) === null) achter++;
  }
  check("parallel: elke pixel raakt het werkvlak, en het punt ligt precies onder die pixel", fouten.length === 0, fouten.join("; "));
  check("opzet: voor de onderste pixels ligt het snijpunt achter het cameravlak (de halve straal gaf daar niets)", achter >= 2, String(achter));
  const evenwijdig = new THREE.Ray(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0));
  check("parallel: een straal evenwijdig aan het vlak geeft null", openFem3DStraalOpVlak(o, evenwijdig, werkvlak, new THREE.Vector3()) === null);
  // Perspectief: hetzelfde als Ray.intersectPlane, boven de horizon dus niets.
  let zelfde = true, boven = 0;
  for (const py of [20, 120, 300, 500, 690]) {
    straal.setFromCamera(new THREE.Vector2(0, 1 - py / HOOG * 2), p);
    const a = openFem3DStraalOpVlak(p, straal.ray, werkvlak, new THREE.Vector3());
    const b = straal.ray.intersectPlane(werkvlak, new THREE.Vector3());
    if ((a === null) !== (b === null) || (a && b && a.distanceTo(b) > 1e-12)) zelfde = false;
    if (a === null) boven++;
  }
  check("perspectief: hetzelfde als Ray.intersectPlane (boven de horizon geen punt)", zelfde && boven >= 1, `boven de horizon: ${boven}`);
}

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

// Zoomen met het wiel in de 3D-weergave: het anker ligt op de cursorstraal,
// zodat het punt onder de muis na een wielstap op dezelfde schermplek staat.
// Naast het model ligt het anker op de diepte van het modelmidden.
import * as THREE from "three";
const { wheelAnchor } = await import("./src/components/openFem3d/openFem3dWheelAnchor.ts");

let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => { if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); } };
const dichtbij = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

// Camera zoals in de app: perspectief, kijkt naar een portaal van 12 × 5 m.
const camera = new THREE.PerspectiveCamera(45, 1.5, 0.1, 5000);
camera.position.set(-20, -30, 18);
const target = new THREE.Vector3(6, 0, 2.5);
camera.up.set(0, 0, 1);
camera.lookAt(target);
camera.updateMatrixWorld();
const bounds = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(12, 0, 5));
const viewNormal = camera.getWorldDirection(new THREE.Vector3());
const straal = (ndcX, ndcY) => {
  const r = new THREE.Raycaster();
  r.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  return r.ray;
};
/** Waar een wereldpunt op het scherm valt (NDC). */
const scherm = (cam, p) => p.clone().project(cam);
/** Eén wielstap: camera en doel schalen rond het anker (zoals ThreeFrameCanvas). */
const zoom = (anker, schaal) => {
  const cam = camera.clone();
  cam.position.sub(anker).multiplyScalar(schaal).add(anker);
  const doel = target.clone().sub(anker).multiplyScalar(schaal).add(anker);
  cam.lookAt(doel);
  cam.updateMatrixWorld();
  return cam;
};

log("[1] keuze van het anker");
{
  const hit = new THREE.Vector3(3, 0, 5);
  const a = wheelAnchor(straal(0.1, 0.1), hit, bounds, viewNormal, target);
  check("geometrie onder de cursor → dat punt", a.source === "geometry" && a.point.equals(hit) && a.point !== hit);
}
{
  const ray = straal(0, 0);
  const a = wheelAnchor(ray, null, new THREE.Box3(), viewNormal, target);
  check("leeg model → het vlak door het camerapunt", a.source === "camera" && dichtbij(a.point.clone().sub(target).dot(viewNormal), 0, 1e-6));
}
{
  // Een straal die het kader raakt: midden van het portaal.
  const ray = straal(scherm(camera, new THREE.Vector3(6, 0, 2.5)).x, scherm(camera, new THREE.Vector3(6, 0, 2.5)).y);
  const a = wheelAnchor(ray, null, bounds, viewNormal, target);
  // Het kader van een vlak portaal heeft dikte 0 in Y: controleer met een marge van 1 nm.
  check("straal door het kader → waar hij het kader binnengaat",
    a.source === "bounds" && bounds.clone().expandByScalar(1e-9).containsPoint(a.point), `${a.source} ${a.point.toArray()}`);
}

log("\n[2] naast het model: punt onder de cursor, op de diepte van het modelmidden");
{
  const ray = straal(-0.9, 0.85); // linksboven, ver naast het portaal
  const a = wheelAnchor(ray, null, bounds, viewNormal, target);
  const midden = bounds.getCenter(new THREE.Vector3());
  check("bron cursor-model-depth", a.source === "cursor-model-depth", a.source);
  check("het anker ligt op de cursorstraal", ray.distanceSqToPoint(a.point) < 1e-12);
  check("… op de diepte van het modelmidden", dichtbij(a.point.clone().sub(midden).dot(viewNormal), 0, 1e-9));
  for (const schaal of [0.884, 1 / 0.884]) {
    const cam = zoom(a.point, schaal);
    const voor = scherm(camera, a.point), na = scherm(cam, a.point);
    check(`${schaal < 1 ? "inzoomen" : "uitzoomen"}: het punt onder de muis blijft op zijn schermplek`,
      Math.abs(voor.x - na.x) < 1e-9 && Math.abs(voor.y - na.y) < 1e-9, `${voor.x},${voor.y} → ${na.x},${na.y}`);
  }
  // Het portaal blijft in beeld na één wielstap in (de eerdere klacht bij een ver cameravlak).
  const cam = zoom(a.point, 0.884);
  const hoeken = [[0, 0, 0], [12, 0, 0], [0, 0, 5], [12, 0, 5]].map(([x, y, z]) => scherm(cam, new THREE.Vector3(x, y, z)));
  check("één wielstap in: het portaal blijft grotendeels in beeld",
    hoeken.filter((h) => Math.abs(h.x) <= 1 && Math.abs(h.y) <= 1).length >= 3, JSON.stringify(hoeken.map((h) => [h.x.toFixed(2), h.y.toFixed(2)])));
}

log("\n[3] modelmidden achter de camera → terugval op het midden");
{
  const achter = new THREE.Box3(new THREE.Vector3(-60, -90, 40), new THREE.Vector3(-58, -88, 42));
  const a = wheelAnchor(straal(0.9, -0.9), null, achter, viewNormal, target);
  check("bron bounds-center", a.source === "bounds-center", a.source);
}

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

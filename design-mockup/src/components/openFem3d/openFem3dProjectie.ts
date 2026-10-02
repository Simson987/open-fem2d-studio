/**
 * openFem3dProjectie.ts — perspectief of parallel (orthografisch) in het
 * 3D-tekenvlak (issue #85, deel B; zichtbaarheid `perspective`).
 *
 * Twee camera's, één beeld. Bij het wisselen blijven doel, kijkrichting en up
 * gelijk, en ook de zichtbare grootte in het vlak door het doel:
 *
 *   perspectief → parallel:  halve hoogte h = d · tan(fov/2)
 *   parallel → perspectief:  d = h / tan(fov/2)
 *
 * met d de afstand camera–doel en h de halve hoogte van het ortho-frustum.
 * Het beeld van de parallelle camera hangt niet af van zijn afstand tot het
 * doel; die staat daarom zo ver terug dat model, raster en assen in elke
 * kijkrichting vóór de camera liggen (openFem3DOrthoAfstand).
 *
 * Alles in het tekenvlak wat van de camera afhangt (wielzoom, pannen, kiezen,
 * de lijndikte van een raycast, passend beeld) rekent met de functies hier,
 * zodat het in beide standen klopt. Geen React; wel Three (cameratypen).
 */
import * as THREE from "three";

export type OpenFem3DCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

type Punt = { x: number; y: number; z: number };

/** Verticale gezichtshoek van de perspectiefcamera, in graden. */
export const OPEN_FEM_3D_FOV_GRADEN = 50;

const halveTangens = (fovGraden: number) => Math.tan(THREE.MathUtils.degToRad(fovGraden) / 2);

/** Perspectief → parallel: de halve hoogte van het ortho-frustum bij afstand `afstand` tot het doel. */
export function openFem3DOrthoHalveHoogte(afstand: number, fovGraden = OPEN_FEM_3D_FOV_GRADEN): number {
  return afstand * halveTangens(fovGraden);
}

/** Parallel → perspectief: de afstand tot het doel waarbij het doel even groot in beeld staat. */
export function openFem3DPerspectiefAfstand(halveHoogte: number, fovGraden = OPEN_FEM_3D_FOV_GRADEN): number {
  return halveHoogte / halveTangens(fovGraden);
}

export const isOpenFem3DOrtho = (camera: THREE.Camera): camera is THREE.OrthographicCamera =>
  (camera as THREE.OrthographicCamera).isOrthographicCamera === true;

/**
 * De zichtbare halve hoogte (m) van een parallelle camera, met de zoom die de
 * besturing (OrbitControls, bijvoorbeeld bij knijpen) er eventueel op zette.
 */
export function openFem3DOrthoHalveHoogteVan(camera: THREE.OrthographicCamera): number {
  return (camera.top - camera.bottom) / (2 * Math.max(camera.zoom, 1e-12));
}

/**
 * Het ortho-frustum symmetrisch om de kijkas: halve hoogte `halveHoogte`, de
 * breedte naar de beeldverhouding `aspect`, zoom 1. Werkt de projectiematrix bij.
 */
export function openFem3DZetOrthoFrustum(camera: THREE.OrthographicCamera, halveHoogte: number, aspect: number): void {
  const h = Math.max(halveHoogte, 1e-9);
  const a = Math.max(aspect, 1e-6);
  camera.top = h;
  camera.bottom = -h;
  camera.left = -h * a;
  camera.right = h * a;
  camera.zoom = 1;
  camera.updateProjectionMatrix();
}

/**
 * Wereldmaat (m) per schermpixel in het vlak door het doel van de camera:
 * perspectief 2 · d · tan(fov/2) / H, parallel 2 · h / H. Eén maat voor
 * alles wat "zoveel pixels" in meters moet weten.
 */
export function openFem3DWereldmaatPerPixel(camera: OpenFem3DCamera, doel: Punt, hoogtePx: number): number {
  const hoogte = Math.max(hoogtePx, 1);
  if (isOpenFem3DOrtho(camera)) return 2 * openFem3DOrthoHalveHoogteVan(camera) / hoogte;
  const afstand = Math.hypot(camera.position.x - doel.x, camera.position.y - doel.y, camera.position.z - doel.z);
  return 2 * afstand * halveTangens(camera.fov) / hoogte;
}

const kijkrichting = new THREE.Vector3();

/**
 * Afstand van de camera tot `punt` zoals een raycast hem meet, om treffers
 * langs de straal met elkaar te vergelijken. Perspectief: vanaf het oogpunt
 * (daar begint de straal). Parallel: langs de kijkrichting vanaf het
 * cameravlak (de straal begint in dat vlak, recht achter de muis).
 */
export function openFem3DCameraAfstand(camera: THREE.Camera, punt: Punt): number {
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  const px = e[12], py = e[13], pz = e[14];
  if (!isOpenFem3DOrtho(camera)) return Math.hypot(punt.x - px, punt.y - py, punt.z - pz);
  kijkrichting.set(-e[8], -e[9], -e[10]).normalize();
  return (punt.x - px) * kijkrichting.x + (punt.y - py) * kijkrichting.y + (punt.z - pz) * kijkrichting.z;
}

/**
 * Passend beeld in parallelle projectie: de kleinste halve hoogte waarbij het
 * model (zijn halve maten op het scherm, rond het doel) in het bruikbare deel
 * van het beeld past, met dezelfde marge (×1,08) en dezelfde vrije randen als
 * passend beeld in perspectief. Nooit kleiner dan bij 2 m perspectiefafstand.
 */
export function openFem3DOrthoPassendeHalveHoogte(
  maten: { halfWidth: number; halfHeight: number },
  aspect: number,
  bruikbaar: { breedte: number; hoogte: number },
  fovGraden = OPEN_FEM_3D_FOV_GRADEN,
): number {
  const nodig = Math.max(
    maten.halfHeight / Math.max(bruikbaar.hoogte, 1e-6),
    maten.halfWidth / Math.max(Math.max(aspect, 0.05) * bruikbaar.breedte, 1e-6),
  ) * 1.08;
  return Math.max(openFem3DOrthoHalveHoogte(2, fovGraden), nodig);
}

/**
 * Plek van de parallelle camera. Zijn beeld hangt niet van de afstand af,
 * dus: minstens de perspectiefafstand bij dezelfde halve hoogte (dan is de
 * camerapositie dezelfde als in perspectief), en ver genoeg terug dat de bol
 * om model, raster en assen in elke kijkrichting vóór de camera ligt.
 * `near`/`far` omsluiten die bol ruim; in parallelle projectie is de
 * dieptenauwkeurigheid lineair, een near van 0 kost niets.
 */
export function openFem3DOrthoAfstand(
  halveHoogte: number,
  doel: Punt,
  bol: { middelpunt: Punt; straal: number },
  fovGraden = OPEN_FEM_3D_FOV_GRADEN,
): { afstand: number; near: number; far: number } {
  const m = bol.middelpunt;
  const straal = Math.max(bol.straal, 0);
  const marge = Math.max(1, 0.1 * straal);
  // Zo ver reikt de scène vanaf het doel, in welke richting ook.
  const bereik = Math.hypot(doel.x - m.x, doel.y - m.y, doel.z - m.z) + straal;
  const afstand = Math.max(openFem3DPerspectiefAfstand(halveHoogte, fovGraden), bereik + marge);
  return { afstand, near: 0, far: afstand + bereik + marge };
}

/**
 * Een wielstap in parallelle projectie: de halve hoogte schaalt met `schaal`
 * (< 1 is inzoomen) en het doel schuift naar het anker toe, zó dat het anker
 * op dezelfde schermplek blijft: doel' = anker + schaal · (doel − anker).
 * Hetzelfde schalen rond het anker als in perspectief, waar ook de camera
 * mee schaalt.
 */
export function openFem3DOrthoWielStap(
  doel: Punt, anker: Punt, halveHoogte: number, schaal: number,
): { doel: THREE.Vector3; halveHoogte: number } {
  return {
    doel: new THREE.Vector3(
      anker.x + schaal * (doel.x - anker.x),
      anker.y + schaal * (doel.y - anker.y),
      anker.z + schaal * (doel.z - anker.z),
    ),
    halveHoogte: halveHoogte * schaal,
  };
}

/**
 * Het snijpunt van de muisstraal met een vlak (werkvlak, plaatvlak), in `uit`.
 * Perspectief: alleen vóór het oogpunt (de halve straal, zoals
 * `Ray.intersectPlane`). Parallel: de hele lijn. De straal begint daar in het
 * cameravlak, en dat staat op een afstand die alleen model, raster en assen
 * vóór de camera houdt (openFem3DOrthoAfstand). Het oneindige werkvlak reikt
 * verder: bij een lage kijkhoek lag het snijpunt voor de onderste pixels
 * achter het cameravlak, en was het werkvlak daar niet te raken. Het beeld
 * van een parallelle camera hangt niet van die afstand af, dus het punt hoort
 * gewoon bij die pixel. Null als de straal evenwijdig aan het vlak loopt.
 */
export function openFem3DStraalOpVlak(
  camera: THREE.Camera, straal: THREE.Ray, vlak: THREE.Plane, uit: THREE.Vector3,
): THREE.Vector3 | null {
  if (!isOpenFem3DOrtho(camera)) return straal.intersectPlane(vlak, uit);
  const noemer = vlak.normal.dot(straal.direction);
  if (noemer === 0) return vlak.distanceToPoint(straal.origin) === 0 ? uit.copy(straal.origin) : null;
  const t = -(straal.origin.dot(vlak.normal) + vlak.constant) / noemer;
  return uit.copy(straal.origin).addScaledVector(straal.direction, t);
}

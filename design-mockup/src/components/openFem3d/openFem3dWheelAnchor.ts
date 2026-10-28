import * as THREE from "three";

export type WheelAnchorSource = "geometry" | "bounds" | "cursor-model-depth" | "bounds-center" | "camera";

/**
 * Het punt waar een wielstap naartoe of vandaan zoomt. De camera schaalt
 * rond dit punt; ligt het op de cursorstraal, dan blijft het punt onder de
 * muis op dezelfde schermplek. De keuze bepaalt alleen de diepte:
 *
 * - `geometry`: de staaf, knoop of plaat onder de cursor;
 * - `bounds`: waar de cursorstraal het kader van het model binnengaat;
 * - `cursor-model-depth`: naast het model, het punt onder de cursor op de
 *   diepte van het modelmidden. Een ver weg gelegen cameravlak zou het
 *   raamwerk bij één wielstap uit beeld duwen; het modelmidden zelf legt de
 *   focus niet bij de muis;
 * - `bounds-center`: alleen als het modelmidden achter de camera ligt;
 * - `camera`: leeg model, het vlak door het camerapunt van de besturing.
 */
export function wheelAnchor(
  ray: THREE.Ray,
  hit: THREE.Vector3 | null,
  bounds: THREE.Box3,
  viewNormal: THREE.Vector3,
  cameraTarget: THREE.Vector3,
): { point: THREE.Vector3; source: WheelAnchorSource } {
  if (hit) return { point: hit.clone(), source: "geometry" };
  const point = new THREE.Vector3();
  if (bounds.isEmpty()) {
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(viewNormal, cameraTarget);
    return { point: ray.intersectPlane(plane, point) ? point : cameraTarget.clone(), source: "camera" };
  }
  if (ray.intersectBox(bounds, point)) return { point, source: "bounds" };
  const center = bounds.getCenter(new THREE.Vector3());
  const modelDepth = new THREE.Plane().setFromNormalAndCoplanarPoint(viewNormal, center);
  if (ray.intersectPlane(modelDepth, point)) return { point, source: "cursor-model-depth" };
  return { point: center, source: "bounds-center" };
}

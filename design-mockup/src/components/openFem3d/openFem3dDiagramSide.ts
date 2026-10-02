/**
 * Naar welke kant een snedekrachtlijn in 3D uitslaat. Momentenlijnen staan aan
 * de trekzijde, zoals in Nederland gebruikelijk:
 *  - een positief My (het veldmoment van een ligger onder zwaartekracht) trekt
 *    de −z-kant van de staaf, dus My slaat uit langs −ez;
 *  - een positief Mz trekt de +y-kant, dus Mz slaat uit langs +ey.
 * Dwarskrachten volgen hun eigen as (Vy langs ey, Vz langs ez).
 *
 * De tekens zijn die van de 3D-kern; test-open-fem3d-momentlijn.mjs legt ze
 * vast met een echte berekening.
 */
import * as THREE from "three";

export type OpenFem3DDiagramComponent = "shearY" | "shearZ" | "momentY" | "momentZ";

export function openFem3DDiagramDirection(
  component: OpenFem3DDiagramComponent,
  axes: { ey: THREE.Vector3; ez: THREE.Vector3 },
): THREE.Vector3 {
  switch (component) {
    case "shearY": return axes.ey.clone();
    case "shearZ": return axes.ez.clone();
    case "momentY": return axes.ez.clone().negate();
    case "momentZ": return axes.ey.clone();
  }
}

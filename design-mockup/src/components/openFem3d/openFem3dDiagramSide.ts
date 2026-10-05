/**
 * Naar welke kant een snedekrachtlijn in 3D uitslaat. Momentenlijnen staan aan
 * de trekzijde, zoals in Nederland gebruikelijk:
 *  - een positief My (het veldmoment van een ligger onder zwaartekracht) trekt
 *    de −z-kant van de staaf, dus My slaat uit langs −ez;
 *  - een positief Mz trekt de +y-kant, dus Mz slaat uit langs +ey.
 * Dwarskrachten volgen hun eigen as (Vy langs ey, Vz langs ez).
 *
 * De gronddruk onder een staaf op bedding (issue #106) staat aan de kant van
 * de grond: een positieve gronddruk (de grond duwt de staaf omhoog) slaat uit
 * naar beneden, loodrecht op de staaf in het verticale vlak door de staafas,
 * los van de profielrotatie.
 *
 * De tekens zijn die van de 3D-kern; test-open-fem3d-momentlijn.mjs legt ze
 * vast met een echte berekening.
 */
import * as THREE from "three";

export type OpenFem3DDiagramComponent = "shearY" | "shearZ" | "momentY" | "momentZ" | "groundPressure";

export function openFem3DDiagramDirection(
  component: OpenFem3DDiagramComponent,
  axes: { ex?: THREE.Vector3; ey: THREE.Vector3; ez: THREE.Vector3 },
): THREE.Vector3 {
  switch (component) {
    case "shearY": return axes.ey.clone();
    case "shearZ": return axes.ez.clone();
    case "momentY": return axes.ez.clone().negate();
    case "momentZ": return axes.ey.clone();
    case "groundPressure": {
      // −(Z min zijn deel langs de staafas): omlaag, loodrecht op de staaf.
      const ex = axes.ex;
      const down = new THREE.Vector3(0, 0, -1);
      if (ex) down.addScaledVector(ex, -down.dot(ex));
      return down.lengthSq() > 1e-12 ? down.normalize() : axes.ez.clone().negate();
    }
  }
}

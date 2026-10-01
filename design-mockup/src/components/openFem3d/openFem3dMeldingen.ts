import type { OpenFem3DModel } from "./openFem3dModel";

/**
 * De meldingen van de externe 3D-kern, geschikt voor het rapport (#61).
 *
 * De kern toetst staven zonder oriëntatievector op "bijna verticaal" tegen de
 * globale Y-as, terwijl haar eigen lokale assen — en Open FEM 3D — Z omhoog
 * gebruiken. Daardoor kreeg elke staaf langs Y die melding en een echt bijna
 * verticale staaf niet. Die meldingen vallen hier weg; in plaats daarvan volgt
 * de juiste toets met Z omhoog.
 *
 * Wanneer telt een staaf als "bijna verticaal"? De lokale assen kiezen hun
 * referentierichting op |e_x · Z| > 0,999 (`openFem3DLocalAxes`): daarboven X,
 * daaronder Z. Een staaf net onder die grens (vanaf 0,995) heeft slecht
 * bepaalde lokale y/z-assen; een exact verticale staaf niet.
 */
const ONTERECHT = /^Element \d+ is nearly vertical \(\|cos\|=/;
export const BIJNA_VERTICAAL_ONDERGRENS = 0.995;
export const OMSLAG_REFERENTIERICHTING = 0.999;

export interface OpenFem3DMeldingen {
  /** Meldingen van de kern die blijven staan (onvertaald, zoals de kern ze geeft). */
  kern: string[];
  /** Staven die bijna, maar niet precies verticaal staan, met |cos| t.o.v. Z. */
  bijnaVerticaal: { beamId: number; cos: number }[];
}

export function openFem3DMeldingen(diagnostics: readonly string[], model: OpenFem3DModel): OpenFem3DMeldingen {
  const kern = diagnostics.filter((melding) => !ONTERECHT.test(melding));
  const knoop = new Map(model.nodes.map((n) => [n.id, n]));
  const bijnaVerticaal: OpenFem3DMeldingen["bijnaVerticaal"] = [];
  for (const staaf of model.beams) {
    const a = knoop.get(staaf.startNodeId), b = knoop.get(staaf.endNodeId);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const lengte = Math.hypot(dx, dy, dz);
    if (!(lengte > 0)) continue;
    const cos = Math.abs(dz) / lengte;
    if (cos > BIJNA_VERTICAAL_ONDERGRENS && cos <= OMSLAG_REFERENTIERICHTING) {
      bijnaVerticaal.push({ beamId: staaf.id, cos });
    }
  }
  return { kern, bijnaVerticaal };
}

/**
 * openFem3dResultaatKeuze — welk 3D-resultaat toont de app na een rekengang?
 *
 * WAAROM DIT BESTAAT (issue #245, controle 26 oktober 2026, K8)
 * De 3D-rekengang rekent alleen de belastinggevallen MET last (en de
 * combinaties die daar iets van gebruiken). Stond het ACTIEVE geval leeg —
 * bijvoorbeeld geval 3 actief terwijl alleen geval 1 een kracht heeft — dan
 * koos `handleSolve` wel een terugval (het eerste berekende geval), maar het
 * effect dat bij een gewijzigde resultaatset het resultaat van het actieve
 * geval zet, maakte het daarna weer `null`. Gevolg: de staaltoets stond er
 * ("EN 1993 · UC 0,66"), het resultatenpaneel bleef op "Klik op Berekenen", en
 * `gui_solve` meldde "3D doorrekenen mislukt: de rekengang leverde geen
 * resultaat" — met `rekenfout: null`.
 *
 * DE REGEL (één functie voor de rekengang én het effect, zodat de twee niet
 * meer uit elkaar kunnen lopen):
 *  1. Heeft het actieve geval een resultaat: dat, zonder combinatie.
 *  2. Anders, als er combinaties zijn berekend: de eerste berekende combinatie
 *     (in de volgorde van de combinatielijst), en die wordt de ACTIEVE
 *     combinatie — de verkenner licht haar op, dus het is te zien wát er
 *     getoond wordt. Nooit stil het resultaat van een ánder geval onder de
 *     naam van het actieve geval.
 *  3. Anders, als er een ander geval is berekend: dat geval wordt het actieve
 *     geval (`wisselNaarGeval`), zodat tab en resultaat bij elkaar horen.
 *  4. Niets berekend: `null`.
 * In 2 en 3 is `actiefGevalLeeg` waar; de app toont dan een gerichte melding.
 */

export interface OpenFem3DResultaatKeuze<R> {
  result: R | null;
  /** De combinatie die getoond wordt, of null (een geval). */
  combinationId: number | null;
  /** Het actieve geval heeft geen eigen resultaat (geen last). */
  actiefGevalLeeg: boolean;
  /** Regel 3: schakel het actieve geval om naar dit geval. */
  wisselNaarGeval: number | null;
}

export function kiesOpenFem3DResultaat<R>(
  caseResults: ReadonlyMap<number, R>,
  combinationResults: ReadonlyMap<number, R>,
  activeLoadCaseId: number,
  combinatieVolgorde: readonly { id: number }[] = [],
): OpenFem3DResultaatKeuze<R> {
  const eigen = caseResults.get(activeLoadCaseId);
  if (eigen !== undefined) {
    return { result: eigen, combinationId: null, actiefGevalLeeg: false, wisselNaarGeval: null };
  }
  if (caseResults.size === 0 && combinationResults.size === 0) {
    return { result: null, combinationId: null, actiefGevalLeeg: false, wisselNaarGeval: null };
  }
  const geordend = [
    ...combinatieVolgorde.map((c) => c.id).filter((id) => combinationResults.has(id)),
    ...[...combinationResults.keys()],
  ];
  const combinatieId = geordend[0];
  if (combinatieId !== undefined) {
    return {
      result: combinationResults.get(combinatieId)!, combinationId: combinatieId,
      actiefGevalLeeg: true, wisselNaarGeval: null,
    };
  }
  const [gevalId, gevalResultaat] = [...caseResults][0];
  return { result: gevalResultaat, combinationId: null, actiefGevalLeeg: true, wisselNaarGeval: gevalId };
}

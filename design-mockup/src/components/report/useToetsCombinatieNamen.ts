/**
 * De namen van de combinaties waarop getoetst is, voor het rapport en het
 * paneel (issue #199).
 *
 * De toets rekent elke UGT-combinatie ook in de tegengestelde richting, onder
 * id + 1 000 000. Dat id staat in geen combinatielijst van het model; zonder
 * deze namen stond er "comb. 1000003". De combinaties van het model en die van
 * de laatste toetsronde (`checkStore.toetsCombinaties`) samen, met
 * `toetsCombinatieNamen` — dezelfde functie als het toetsingsoverzicht.
 */
import { useMemo } from "react";
import { useCheckStore } from "../../stores/checkStore";
import { useReportData } from "./ReportDataContext";
import { toetsCombinatieNamen } from "./checkReportUtils";

/** De naam van een combinatie-id, of het id als tekst als de naam onbekend is. */
export type CombinatieLabel = (id: number) => string;

export function useToetsCombinatieNamen(): CombinatieLabel {
  const toetsCombinaties = useCheckStore((s) => s.toetsCombinaties);
  const { combinations } = useReportData();
  return useMemo(() => {
    const namen = toetsCombinatieNamen(combinations, toetsCombinaties);
    return (id: number) => namen.get(id) ?? String(id);
  }, [combinations, toetsCombinaties]);
}

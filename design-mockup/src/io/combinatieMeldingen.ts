/**
 * combinatieMeldingen.ts — de meldingen over de belastingcombinaties bij het
 * openen van een project, met hun knop.
 *
 *  - Zijn verouderde combinaties VERVANGEN (lib/combinatieBeheer,
 *    `vervangVerouderdeCombinaties`), dan staat "Ongedaan maken" in de melding.
 *  - Draagt een blijvend geval eigen factoren die bewust gekozen kunnen zijn
 *    (issue #196, bijvoorbeeld K_FI × NB tabel NB.4), dan staat "Eigen factoren
 *    houden" in de melding (`CombinatieAfwijking.bevestigbaar`). Bij de kolom
 *    van de oude standaardset niet: daar hoort vervangen bij.
 * Dezelfde knoppen staan blijvend in Belastinggevallen & combinaties.
 *
 * Een eigen module zodat App.tsx en de browserproef
 * (scripts/eigen-factoren-browser.tsx) precies dezelfde meldingen maken.
 */
import i18next from "i18next";
import { notifyWarning } from "./notify";
import type { CombinatieAfwijking, CombinatieVervanging } from "../lib/combinatieBeheer";

/** Hoe lang een melding met een knop blijft staan (ms): tijd om te lezen en te kiezen. */
const DUUR_MET_KNOP = 30000;

export function meldCombinatiesBijOpenen(p: {
  vervanging: CombinatieVervanging | null;
  afwijking: CombinatieAfwijking | null;
  /** "Ongedaan maken" van de vervanging. */
  maakOngedaan: () => void;
  /** "Behoud eigen factoren" (`bevestigEigenFactoren`). */
  houdEigenFactoren: () => void;
}): void {
  if (p.vervanging) {
    notifyWarning(i18next.t("common:app.file.combosReplacedTitle"), p.vervanging.samenvatting, {
      actie: { label: i18next.t("common:undo"), onClick: p.maakOngedaan },
      duur: DUUR_MET_KNOP,
    });
  }
  if (p.afwijking) {
    notifyWarning(
      i18next.t("common:app.file.combosNoticeTitle"),
      p.afwijking.samenvatting,
      p.afwijking.bevestigbaar
        ? { actie: { label: i18next.t("common:loadCases.keepCustomFactors"), onClick: p.houdEigenFactoren }, duur: DUUR_MET_KNOP }
        : undefined,
    );
  }
}

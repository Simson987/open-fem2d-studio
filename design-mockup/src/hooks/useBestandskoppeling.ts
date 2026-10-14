import { useEffect, useRef } from "react";
import i18next from "i18next";
import { isTauriApp } from "../lib/tauri";
import {
  COMMANDO_OPHALEN, EVENT_BESTANDEN, bestandsnaam, startBestandskoppeling,
} from "../io/bestandskoppeling";

/**
 * Open bestanden die het besturingssysteem aan de app geeft (dubbelklik,
 * "Openen met", een tweede start terwijl de app al draait; issue #90) langs
 * `open` — in App.tsx is dat `openUitBestandskoppeling`: wachten tot een
 * openstaande vraag over niet-opgeslagen werk beantwoord is, welkomstscherm en
 * backstage dicht, dan `handleOpenFilePath`, de weg van de recente bestanden,
 * met de vraag over niet-opgeslagen werk.
 *
 * Start één keer, zodra `klaar` waar is (in App.tsx: de recente bestanden
 * zijn uit de store geladen). Tot dan wachten de paden in de wachtrij van
 * Rust. `open` verandert van identiteit als het model verandert; de koppeling
 * roept daarom altijd de laatste aan (ref), zonder opnieuw te luisteren.
 */
export function useBestandskoppeling(open: (pad: string) => Promise<void>, klaar: boolean): void {
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!klaar || !isTauriApp()) return;
    const koppeling = startBestandskoppeling({
      haalOp: async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        return invoke<string[]>(COMMANDO_OPHALEN);
      },
      luister: async (bijMelding) => {
        const { listen } = await import("@tauri-apps/api/event");
        return listen(EVENT_BESTANDEN, () => bijMelding());
      },
      open: (pad) => openRef.current(pad),
      meldGeenProject: (pad) => {
        void import("../io/notify").then(({ notifyWarning }) => {
          notifyWarning(
            i18next.t("common:app.file.notAProjectTitle"),
            i18next.t("common:app.file.notAProjectBody", { naam: bestandsnaam(pad) }),
          );
        });
      },
    });
    return () => koppeling.stop();
  }, [klaar]);
}

/**
 * ToetsWeergaveBalk — de schakelaar "Toetskrachten (2e orde)" op het tekenvlak
 * (issue #199, fase 6). Staat het tekenvlak op de toetsset, dan zegt de balk
 * welke krachten er te zien zijn en hoe je terug gaat naar de resultaten;
 * anders biedt hij de toetskrachten aan zolang er een toetsronde is.
 */
import { useTranslation } from "react-i18next";
import "./CanvasMeldingen.css";
import "./ToetsWeergaveBalk.css";

interface Props {
  /** De naam van de getoonde toetscombinatie; `null` = het tekenvlak toont de resultaten. */
  getoond: string | null;
  /** 1/φ van de toets, om te tonen. */
  noemer: string | null;
  /** Kan de toetsset getoond worden (er is een toetsronde met krachten)? */
  beschikbaar: boolean;
  onAan: () => void;
  onUit: () => void;
}

export default function ToetsWeergaveBalk({ getoond, noemer, beschikbaar, onAan, onUit }: Props) {
  const { t } = useTranslation();
  if (getoond === null && !beschikbaar) return null;
  return (
    <div className="toetsweergave-balk" data-toetsweergave={getoond !== null ? "aan" : "uit"}>
      {getoond !== null ? (
        <div className="canvas-melding toetsweergave-melding" role="status">
          <span className="canvas-melding-tekst">
            {t("common:app.check.forcesViewOn", { naam: getoond, noemer: noemer ?? "?" })}
          </span>
          <button className="canvas-melding-knop" onClick={onUit}>{t("common:app.check.forcesViewBack")}</button>
        </div>
      ) : (
        <button className="canvas-melding-knop toetsweergave-knop" onClick={onAan}
          title={t("common:app.check.forcesViewShowTitle")}>
          {t("common:app.check.forcesViewShow")}
        </button>
      )}
    </div>
  );
}

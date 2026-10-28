import { useTranslation } from "react-i18next";
import type { ImportMelding } from "./manifest";
import "./ImportVerslagVenster.css";

export interface ImportVerslag {
  bestand: string;
  extensie: { name: string; version: string };
  meldingen: ImportMelding[];
}

export default function ImportVerslagVenster({ verslag, sluiten }: { verslag: ImportVerslag; sluiten(): void }) {
  const { t } = useTranslation("backstage");
  return (
    <div className="ext-report-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) sluiten(); }}>
      <section className="ext-report" role="dialog" aria-modal="true" aria-label={t("extensionManager.reportTitle")}>
        <h2>{t("extensionManager.reportTitle")}</h2>
        <p>{verslag.bestand} · {verslag.extensie.name} v{verslag.extensie.version}</p>
        <ul>
          {verslag.meldingen.map((melding, index) => (
            <li key={index} className={melding.level === "warning" ? "ext-report-warning" : ""}>
              {melding.text}
            </li>
          ))}
        </ul>
        <button autoFocus onClick={sluiten}>{t("extensionManager.closeReport")}</button>
      </section>
    </div>
  );
}

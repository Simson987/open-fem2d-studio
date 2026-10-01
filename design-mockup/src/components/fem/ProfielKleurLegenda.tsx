/**
 * ProfielKleurLegenda — de legenda van "Profielen in kleur": per profiel dat in
 * het model voorkomt een kleurvlak, de profielnaam en het aantal staven, in de
 * volgorde van de toekenning (lib/profielKleur.ts), "zonder profiel" onderaan.
 *
 * Eén component voor beide tekenvlakken: in 2D een HUD-kaart in de kolom
 * rechtsonder (boven de modelcontrole, zie FemCanvas), met het kleurvlak als
 * lijnstukje in de lijnsoort van de staaf; in 3D een kaart rechtsonder boven
 * de statusregel, met een kleurvlak in de 3D-tint.
 */
import { useTranslation } from "react-i18next";
import type { ProfielKleurRegel } from "../../lib/profielKleur";
import "./ProfielKleurLegenda.css";

interface Props {
  regels: readonly ProfielKleurRegel[];
  variant: "2d" | "3d";
  className?: string;
}

export default function ProfielKleurLegenda({ regels, variant, className = "" }: Props) {
  const { t } = useTranslation("common");
  if (regels.length === 0) return null;
  return (
    <div
      className={`profiel-legenda profiel-legenda-${variant} ${className}`.trim()}
      role="group"
      aria-label={t("canvas.profielKleur.aria")}
      data-profiel-legenda={variant}
    >
      <div className="profiel-legenda-titel">{t("canvas.profielKleur.titel")}</div>
      <ul className="profiel-legenda-lijst">
        {regels.map((r) => {
          const kleur = variant === "3d" ? r.kleur3d : r.kleur;
          const naam = r.zonderProfiel ? t("canvas.profielKleur.zonderProfiel") : r.naam;
          const aantal = t("tree.barCount", { count: r.aantal });
          return (
            <li
              key={r.sleutel}
              className={`profiel-legenda-regel${r.zonderProfiel ? " zonder-profiel" : ""}`}
              data-profiel={r.sleutel}
              data-kleur={kleur}
              title={`${naam} · ${aantal}`}
            >
              <svg className="profiel-legenda-staal" width="26" height="10" viewBox="0 0 26 10" aria-hidden="true">
                {variant === "2d" ? (
                  <line x1="3" y1="5" x2="23" y2="5" stroke={kleur} strokeWidth="3" strokeLinecap="round"
                    strokeDasharray={r.streep || undefined} />
                ) : (
                  <rect x="1" y="1" width="24" height="8" rx="2" fill={kleur} />
                )}
              </svg>
              <span className="profiel-legenda-naam">{naam}</span>
              <span className="profiel-legenda-aantal">{aantal}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

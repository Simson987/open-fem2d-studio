/**
 * Meldingen over het hele model (caseId null) bovenaan het canvas, als
 * melding van ontwerp 0.4. Dezelfde meldingen staan ook in de projectboom
 * onder Belastingen; hier staan ze in beeld, met een knop die naar de oorzaak
 * wijst. Sluiten geldt tot de tekst van de melding verandert.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GevalMelding } from "../../lib/combinatieBeheer";
import { vertaal } from "../../lib/vertaalbareTekst";
import "./CanvasMeldingen.css";

/** De houtmeldingen (lib/houtEindstijfheid.ts) herkennen aan hun kop. */
function isHoutMelding(m: GevalMelding): boolean {
  return !!m.kop && m.kop.sleutel.includes("timberFinalStiffness");
}

interface Props {
  meldingen: GevalMelding[];
  /** Selecteer de houtstaven, waar de eindstijfheid over gaat. */
  onToonHout: () => void;
  onOpenCombinaties: () => void;
}

export default function CanvasMeldingen({ meldingen, onToonHout, onOpenCombinaties }: Props) {
  const { t } = useTranslation();
  const [gesloten, setGesloten] = useState<ReadonlySet<string>>(new Set());
  const zichtbaar = meldingen.filter((m) => m.caseId === null && !gesloten.has(m.tekst));
  if (zichtbaar.length === 0) return null;

  return (
    <div className="canvas-meldingen">
      {zichtbaar.map((m) => (
        <div
          key={m.tekst}
          className={`canvas-melding canvas-melding-${m.niveau}`}
          role={m.niveau === "fout" ? "alert" : "status"}
          title={m.tekst}
        >
          <span className="canvas-melding-teken" aria-hidden="true">⚠</span>
          <span className="canvas-melding-tekst">{m.kop ? vertaal(t, m.kop) : m.tekst.split(". ")[0]}.</span>
          {isHoutMelding(m) && (
            <button className="canvas-melding-knop" onClick={onToonHout}>{t("common:canvasMelding.showTimber")}</button>
          )}
          {m.vervangAdvies && (
            <button className="canvas-melding-knop" onClick={onOpenCombinaties}>{t("common:canvasMelding.openCombinations")}</button>
          )}
          <button
            className="canvas-melding-sluit"
            aria-label={t("common:canvasMelding.close")}
            onClick={() => setGesloten((s) => new Set(s).add(m.tekst))}
          >×</button>
        </div>
      ))}
    </div>
  );
}

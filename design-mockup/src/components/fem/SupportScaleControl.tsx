import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "./SupportScaleControl.css";

interface Props {
  value: number;
  onChange: (value: number) => void;
  showHint?: boolean;
}

/** Weergave-instelling voor oplegsymbolen, gedeeld door de 2D- en 3D-verkenner. */
export default function SupportScaleControl({ value, onChange, showHint = false }: Props) {
  const { t } = useTranslation("common");
  const scale = Number.isFinite(value) ? Math.max(0.25, Math.min(3, value)) : 1;
  const percentage = Math.round(scale * 100);
  const [draft, setDraft] = useState(String(percentage));
  useEffect(() => setDraft(String(percentage)), [percentage]);
  const commitPercentage = () => {
    const entered = Number(draft.replace(",", "."));
    if (draft.trim() && Number.isFinite(entered)) {
      const bounded = Math.max(25, Math.min(300, Math.round(entered)));
      onChange(bounded / 100);
      setDraft(String(bounded));
    } else {
      setDraft(String(percentage));
    }
  };
  return (
    <div className="fem-support-scale-control">
      <span>{t("zichtbaarheid.supportScale")}</span>
      <div className="fem-support-scale-fields">
        <input type="range" min="0.25" max="3" step="0.01" value={scale}
          aria-label={t("zichtbaarheid.supportScale")}
          onChange={(event) => onChange(Number(event.target.value))} />
        <div className="fem-support-scale-number">
          <input type="text" inputMode="decimal" value={draft}
            aria-label={`${t("zichtbaarheid.supportScale")} (%)`}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitPercentage}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") { setDraft(String(percentage)); event.currentTarget.blur(); }
            }} />
          <span aria-hidden="true">%</span>
        </div>
      </div>
      {showHint && <small>{t("zichtbaarheid.supportScaleHint")}</small>}
    </div>
  );
}

/**
 * Overzicht van alle sneltoetsen (? of F1). De lijst komt uit
 * lib/sneltoetsen.ts, dezelfde bron als de tooltips en de toetsafhandeling.
 */
import { useTranslation } from "react-i18next";
import Modal from "./Modal";
import { SNELTOETSEN, type SneltoetsGroep } from "../lib/sneltoetsen";
import "./SneltoetsenDialog.css";

const GROEPEN: SneltoetsGroep[] = ["file", "edit", "draw", "canvas", "calc"];

export default function SneltoetsenDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal open={open} onClose={onClose} title={t("common:shortcuts.title")} width={720}>
      <p className="sneltoetsen-intro">{t("common:shortcuts.intro")}</p>
      <div className="sneltoetsen-raster">
        {GROEPEN.map((groep) => (
          <section key={groep} className="sneltoetsen-groep">
            <h3>{t(`common:shortcuts.groups.${groep}`)}</h3>
            {SNELTOETSEN.filter((s) => s.groep === groep).map((s) => (
              <div key={s.toets + s.label} className="sneltoetsen-regel">
                <span>{t(s.label)}</span>
                <span>{s.toets.split(" / ").map((k) => <kbd key={k}>{k}</kbd>)}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}

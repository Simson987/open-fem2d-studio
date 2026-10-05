import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { OPEN_FEM_3D_PLATE_DISPLAYS, type OpenFem3DPlateDisplay } from "./openFem3dPlateDisplay";
import { plateMeshIcon, plateSurfaceIcon, plateVolumeIcon } from "../ribbon/icons";
import "../fem/FemProjectTree.css";
import "./OpenFem3DEditor.css";

/** Pictogram per plaatweergave; dezelfde als de knoppen in het lint. */
export const OPEN_FEM_3D_PLATE_DISPLAY_ICONS: Readonly<Record<OpenFem3DPlateDisplay, string>> = {
  volume: plateVolumeIcon,
  surface: plateSurfaceIcon,
  mesh: plateMeshIcon,
};

/** De tekstsleutel per stand (openFem3dVisibility.plateDisplay…; de toelichting erachter met …Hint). */
export const OPEN_FEM_3D_PLATE_DISPLAY_KEYS: Readonly<Record<OpenFem3DPlateDisplay, string>> = {
  volume: "plateDisplayVolume",
  surface: "plateDisplaySurface",
  mesh: "plateDisplayMesh",
};

/**
 * De keuze voor de plaatweergave (issue #78) onder de schakelaar Platen, in
 * het venster Zichtbaarheid en in de verkenner (tab Weergave): drie opties in
 * één groep (radiogroep), Volume, Vlak en Mesh. Met Platen uit blijft de keuze
 * bruikbaar maar gedimd: hij geldt zodra de platen weer zichtbaar zijn.
 * Pijltjestoetsen gaan naar de vorige of volgende stand.
 */
export default function OpenFem3DPlateDisplayChoice({ value, onChange, dimmed = false, variant = "explorer" }: {
  value: OpenFem3DPlateDisplay;
  onChange: (display: OpenFem3DPlateDisplay) => void;
  /** De platen staan uit: de keuze gedimd (en bewaard). */
  dimmed?: boolean;
  /** Verkenner (subregel onder de schakelaar) of venster Zichtbaarheid. */
  variant?: "explorer" | "dialog";
}) {
  const { t } = useTranslation("common");
  const kies = (stand: OpenFem3DPlateDisplay) => { if (stand !== value) onChange(stand); };
  const toets = (event: KeyboardEvent<HTMLDivElement>) => {
    const stap = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!stap) return;
    event.preventDefault();
    const n = OPEN_FEM_3D_PLATE_DISPLAYS.length;
    const volgende = OPEN_FEM_3D_PLATE_DISPLAYS[(OPEN_FEM_3D_PLATE_DISPLAYS.indexOf(value) + stap + n) % n]!;
    kies(volgende);
    // De focus gaat mee naar de gekozen optie (zwervende tabindex).
    const groep = event.currentTarget;
    requestAnimationFrame(() => groep.querySelector<HTMLButtonElement>(`[data-plate-display="${volgende}"]`)?.focus());
  };
  return <div role="radiogroup" aria-label={t("openFem3dVisibility.plateDisplay")} title={t("openFem3dVisibility.plateDisplayHint")}
    className={`open-fem3d-plate-display open-fem3d-plate-display-${variant}${dimmed ? " uit" : ""}`}
    data-open-fem3d-plate-display={value} onKeyDown={toets}>
    <span className="open-fem3d-plate-display-label" aria-hidden="true">{t("openFem3dVisibility.plateDisplay")}</span>
    <span className="open-fem3d-plate-display-options">
      {OPEN_FEM_3D_PLATE_DISPLAYS.map((stand) => (
        <button key={stand} type="button" role="radio" aria-checked={value === stand} tabIndex={value === stand ? 0 : -1}
          data-plate-display={stand} className={`open-fem3d-plate-display-option${value === stand ? " active" : ""}`}
          title={t(`openFem3dVisibility.${OPEN_FEM_3D_PLATE_DISPLAY_KEYS[stand]}Hint`)} onClick={() => kies(stand)}>
          <span className="open-fem3d-plate-display-icon" aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: OPEN_FEM_3D_PLATE_DISPLAY_ICONS[stand] }} />
          <span className="open-fem3d-plate-display-text">{t(`openFem3dVisibility.${OPEN_FEM_3D_PLATE_DISPLAY_KEYS[stand]}`)}</span>
        </button>
      ))}
    </span>
  </div>;
}

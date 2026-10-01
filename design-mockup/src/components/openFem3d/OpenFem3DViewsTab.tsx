/**
 * OpenFem3DViewsTab — de tab Views van de 3D-verkenner: de zes standaardviews
 * (altijd aanwezig, niet te verwijderen, wel toe te passen; resultaatviews
 * grijs met uitleg tot er gerekend is) en de eigen views (opslaan, hernoemen,
 * verwijderen). Per view een vinkje "in rapport". Eén klik past een view toe;
 * de actieve view is gemarkeerd.
 *
 * Geen eigen opslag: de eigen views zijn dezelfde lijst als die van de knop
 * "Views" in de 3D-werkruimte (projectveld `openFem3dViewSets`), met dezelfde
 * functies (openFem3dViewSets.ts); de rapportkeuze van de standaardviews is
 * het projectveld `openFem3dStandaardViewsUitRapport`. Toepassen doet de app
 * (App.tsx), op dezelfde manier als het venster Views.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  OPEN_FEM_3D_STANDAARD_VIEWS,
  openFem3DStandaardViewReden,
  openFem3DStandaardViewToepassing,
  openFem3DViewActief,
  openFem3DViewSetToepassing,
  standaardViewSleutel,
  zetOpenFem3DStandaardViewInRapport,
  type OpenFem3DStandaardViewId,
  type OpenFem3DViewStatus,
  type OpenFem3DViewToepassing,
} from "./openFem3dStandaardViews";
import {
  bewaarOpenFem3DViewSet,
  hernoemOpenFem3DViewSet,
  openFem3DViewSetInRapport,
  verwijderOpenFem3DViewSet,
  zetOpenFem3DViewSetInRapport,
  type OpenFem3DHuidigeWeergave,
  type OpenFem3DViewSet,
} from "./openFem3dViewSets";
import type { OpenFem3DVisibility } from "./openFem3dVisibility";
import "./OpenFem3DViewsTab.css";

export interface OpenFem3DViewsTabProps {
  viewSets: OpenFem3DViewSet[];
  onViewSetsChange: (viewSets: OpenFem3DViewSet[]) => void;
  standaardUitRapport: OpenFem3DStandaardViewId[];
  onStandaardUitRapportChange: (uit: OpenFem3DStandaardViewId[]) => void;
  status: OpenFem3DViewStatus;
  /** De huidige zichtbaarheid: basis van een standaardview en van de markering "actief". */
  visibility: OpenFem3DVisibility;
  /** De laatst toegepaste view (`standaard:<id>` of de id van een eigen view). */
  actieveSleutel: string | null;
  activeCombinationId: number | null;
  activeLoadCaseId: number;
  /** De maatgevende combinatie, pas uitgerekend als hij nodig is. */
  maatgevendeCombinatie: () => number | null;
  /** De huidige weergave (camera, tab, resultaat) voor "opslaan". */
  huidig: () => OpenFem3DHuidigeWeergave;
  onToepassen: (toepassing: OpenFem3DViewToepassing) => void;
}

export default function OpenFem3DViewsTab(props: OpenFem3DViewsTabProps) {
  const { t } = useTranslation("common");
  const { viewSets, onViewSetsChange, standaardUitRapport, status, visibility, actieveSleutel } = props;
  const [naam, setNaam] = useState("");
  const [bewerk, setBewerk] = useState<{ id: string; naam: string } | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const standaardNaam = t("openFem3dVisibility.defaultViewName", { n: viewSets.length + 1 });
  const basis = { visibility, activeCombinationId: props.activeCombinationId, maatgevendeCombinationId: null, activeLoadCaseId: props.activeLoadCaseId };

  const opslaan = () => {
    const gekozen = (naam.trim() || standaardNaam).trim();
    onViewSetsChange(bewaarOpenFem3DViewSet(viewSets, gekozen, props.huidig()));
    setNaam("");
    setFout(null);
  };
  const hernoem = () => {
    if (!bewerk) return;
    const r = hernoemOpenFem3DViewSet(viewSets, bewerk.id, bewerk.naam);
    if (r.fout) { setFout(r.fout === "leeg" ? "openFem3dViews.foutLeeg" : "openFem3dViews.foutBestaat"); return; }
    onViewSetsChange(r.viewSets);
    setBewerk(null);
    setFout(null);
  };
  const modus = (vs: OpenFem3DViewSet) => vs.mode === "model" ? t("openFem3dVisibility.modeModel")
    : vs.mode === "results" ? t("openFem3dVisibility.modeResults")
      : vs.mode === "loadCase" ? t("openFem3dVisibility.modeLoadCase") : t("openFem3dVisibility.modeCurrent");

  return (
    <div className="open-fem3d-views-tab" data-open-fem3d-views>
      <div className="fem-results-section-title open-fem3d-views-kop">
        <span>{t("openFem3dViews.standaard")}</span>
        <span className="open-fem3d-views-kolom">{t("openFem3dViews.inRapport")}</span>
      </div>
      <ul className="open-fem3d-views-lijst">
        {OPEN_FEM_3D_STANDAARD_VIEWS.map((v) => {
          const sleutel = standaardViewSleutel(v.id);
          const reden = openFem3DStandaardViewReden(v.id, status);
          const actief = openFem3DViewActief(sleutel, actieveSleutel, openFem3DStandaardViewToepassing(v.id, basis), visibility);
          const titel = t(`openFem3dViews.titel.${v.id}`);
          return (
            <li key={v.id} className={`open-fem3d-views-regel${actief ? " actief" : ""}${reden ? " uit" : ""}`} data-view={sleutel}>
              <button
                type="button" className="open-fem3d-views-toepassen" disabled={Boolean(reden)} aria-pressed={actief}
                title={reden ? t(reden) : t(`openFem3dViews.uitleg.${v.id}`)}
                onClick={() => props.onToepassen(openFem3DStandaardViewToepassing(v.id, {
                  ...basis,
                  maatgevendeCombinationId: v.id === "combinaties" && props.activeCombinationId === null ? props.maatgevendeCombinatie() : null,
                }))}
              >
                <span className="open-fem3d-views-naam">{titel}</span>
                {reden && <span className="open-fem3d-views-sub">{t(reden)}</span>}
              </button>
              <input
                type="checkbox" className="open-fem3d-views-rapport" checked={!standaardUitRapport.includes(v.id)}
                aria-label={t("openFem3dViews.inRapportVan", { naam: titel })} title={t("openFem3dViews.inRapportHint")}
                onChange={(e) => props.onStandaardUitRapportChange(zetOpenFem3DStandaardViewInRapport(standaardUitRapport, v.id, e.target.checked))}
              />
            </li>
          );
        })}
      </ul>

      <div className="fem-results-section-title open-fem3d-views-kop">
        <span>{t("openFem3dViews.eigen")}</span>
        <span className="open-fem3d-views-kolom">{t("openFem3dViews.inRapport")}</span>
      </div>
      {viewSets.length === 0
        ? <p className="open-fem3d-views-leeg">{t("openFem3dVisibility.noViewSets")}</p>
        : (
          <ul className="open-fem3d-views-lijst">
            {viewSets.map((vs) => {
              const actief = openFem3DViewActief(vs.id, actieveSleutel, openFem3DViewSetToepassing(vs), visibility);
              return (
                <li key={vs.id} className={`open-fem3d-views-regel${actief ? " actief" : ""}`} data-view={vs.id}>
                  {bewerk?.id === vs.id ? (
                    <input
                      className="open-fem3d-views-hernoem" value={bewerk.naam} autoFocus
                      aria-label={t("openFem3dViews.hernoemenVan", { naam: vs.name })}
                      onChange={(e) => setBewerk({ id: vs.id, naam: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); hernoem(); }
                        if (e.key === "Escape") { e.preventDefault(); setBewerk(null); setFout(null); }
                      }}
                    />
                  ) : (
                    <button
                      type="button" className="open-fem3d-views-toepassen" aria-pressed={actief} title={vs.name}
                      onClick={() => props.onToepassen(openFem3DViewSetToepassing(vs))}
                      onDoubleClick={() => { setBewerk({ id: vs.id, naam: vs.name }); setFout(null); }}
                    >
                      <span className="open-fem3d-views-naam">{vs.name}</span>
                      <span className="open-fem3d-views-sub">{vs.view} · {modus(vs)}</span>
                    </button>
                  )}
                  {bewerk?.id === vs.id ? (
                    <button type="button" className="open-fem3d-views-knop" onClick={hernoem}
                      aria-label={t("openFem3dViews.hernoemBevestig")} title={t("openFem3dViews.hernoemBevestig")}>✓</button>
                  ) : (
                    <button type="button" className="open-fem3d-views-knop" onClick={() => { setBewerk({ id: vs.id, naam: vs.name }); setFout(null); }}
                      aria-label={t("openFem3dViews.hernoemenVan", { naam: vs.name })} title={t("openFem3dViews.hernoemen")}>✎</button>
                  )}
                  <button type="button" className="open-fem3d-views-knop"
                    onClick={() => { onViewSetsChange(verwijderOpenFem3DViewSet(viewSets, vs.id)); if (bewerk?.id === vs.id) setBewerk(null); }}
                    aria-label={t("openFem3dVisibility.deleteViewSet", { name: vs.name })} title={t("delete")}>×</button>
                  <input
                    type="checkbox" className="open-fem3d-views-rapport" checked={openFem3DViewSetInRapport(vs)}
                    aria-label={t("openFem3dViews.inRapportVan", { naam: vs.name })} title={t("openFem3dViews.inRapportHint")}
                    onChange={(e) => onViewSetsChange(zetOpenFem3DViewSetInRapport(viewSets, vs.id, e.target.checked))}
                  />
                </li>
              );
            })}
          </ul>
        )}
      {fout && <p className="open-fem3d-views-fout" role="alert">{t(fout)}</p>}
      <form className="open-fem3d-views-opslaan" onSubmit={(e) => { e.preventDefault(); opslaan(); }}>
        <input
          value={naam} onChange={(e) => setNaam(e.target.value)} placeholder={standaardNaam}
          aria-label={t("openFem3dVisibility.viewSetName")}
        />
        <button type="submit" title={t("openFem3dViews.opslaanHint")}>{t("openFem3dViews.opslaan")}</button>
      </form>
      <p className="open-fem3d-views-leeg">{t("openFem3dViews.rapportNoot")}</p>
    </div>
  );
}

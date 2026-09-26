import { useTranslation } from "react-i18next";
import { useState, type Dispatch, type SetStateAction } from "react";
import type { DisplayFlags } from "./FemResultsOverlay";
import { vlagAan, zetVlag, type AanUitVlag } from "../../lib/zichtbaarheid";
import {
  SNAP_SOORTEN,
  useSnapInstellingen,
  zetAlleSnaps,
  zetSnap,
  type SnapSoort,
} from "../../hooks/useSnapInstellingen";
import type { Frame3DVisibility } from "../frame3d/frame3dVisibility";
import {
  arrowIcon,
  barIcon,
  bcPinnedIcon,
  gridIcon,
  linkIcon,
  loadCasesIcon,
  loadPointIcon,
  nodeIcon,
  plateIcon,
  sectionsIcon,
  selectIcon,
  tableElementsIcon,
  tableIcon,
  tableNodesIcon,
  viewerMeasureIcon,
  viewerSectionIcon,
  viewerWireframeIcon,
} from "../ribbon/icons";

interface Props {
  displayFlags: DisplayFlags;
  setDisplayFlags: Dispatch<SetStateAction<DisplayFlags>>;
  gridShow: boolean;
  setGridShow: (show: boolean) => void;
  stramienAan: boolean;
  setStramienAan: (show: boolean) => void;
  frame3dVisibility: Frame3DVisibility;
  setFrame3DVisibility: (visibility: Frame3DVisibility) => void;
  workspace: "2d" | "3d";
}

function ToggleRow({
  label, hint, icon, value, onChange, sub = false,
}: {
  label: string;
  hint?: string;
  icon: string;
  value: boolean;
  onChange: (value: boolean) => void;
  sub?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      className={`fem-results-toggle explorer-view-toggle${value ? " active" : ""}${sub ? " sub" : ""}`}
      title={hint}
      onClick={() => onChange(!value)}
    >
      <span
        className="explorer-view-toggle-icon"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: icon }}
      />
      <span className="fem-results-toggle-label">{label}</span>
      <span className={`fem-switch${value ? " on" : ""}`} aria-hidden="true">
        <span className="fem-switch-dot" />
      </span>
    </button>
  );
}

export default function ExplorerViewTab({
  displayFlags,
  setDisplayFlags,
  gridShow,
  setGridShow,
  stramienAan,
  setStramienAan,
  frame3dVisibility,
  setFrame3DVisibility,
  workspace,
}: Props) {
  const { t } = useTranslation("common");
  const [query, setQuery] = useState("");
  const snaps = useSnapInstellingen();
  const allSnaps = SNAP_SOORTEN.every((key) => snaps[key]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = (label: string) => !normalizedQuery || label.toLocaleLowerCase().includes(normalizedQuery);

  const setFlag = (key: AanUitVlag, value: boolean) =>
    setDisplayFlags((flags) => zetVlag(flags, key, value));

  const row2d = (key: AanUitVlag, label: string, icon: string, hint?: string, sub = false) => matches(label) ? (
    <ToggleRow
      key={key}
      label={label}
      hint={hint}
      icon={icon}
      value={vlagAan(displayFlags, key)}
      onChange={(value) => setFlag(key, value)}
      sub={sub}
    />
  ) : null;

  const rows2d = (
    <section className="explorer-view-section" data-workspace="2d">
      <div className="fem-results-section-title">
        {t("zichtbaarheid.view2d")}{workspace === "2d" ? ` · ${t("zichtbaarheid.activeWorkspace")}` : ""}
      </div>
      <div className="fem-results-toggle-list">
        {row2d("knopen", t("zichtbaarheid.knopen"), nodeIcon, t("zichtbaarheid.knopenHint"))}
        {row2d("staven", t("zichtbaarheid.staven"), barIcon, t("zichtbaarheid.stavenHint"))}
        {row2d("platen", t("zichtbaarheid.platen"), plateIcon, t("zichtbaarheid.platenHint"))}
        {row2d("opleggingen", t("zichtbaarheid.opleggingen"), bcPinnedIcon, t("zichtbaarheid.opleggingenHint"))}
        {row2d("belastingen", t("zichtbaarheid.belastingen"), loadPointIcon, t("zichtbaarheid.belastingenHint"))}
        {row2d("lastWaarden", t("zichtbaarheid.lastWaarden"), loadCasesIcon, t("zichtbaarheid.lastWaardenHint"), true)}
        {row2d("scharnieren", t("zichtbaarheid.scharnieren"), linkIcon, t("zichtbaarheid.scharnierenHint"))}
        {row2d("kipsteunen", t("tree.rowKipsteunen"), bcPinnedIcon, t("tree.rowKipsteunenHint"))}
        {row2d("aanzicht", t("tree.rowAanzicht"), viewerWireframeIcon, t("tree.rowAanzichtHint"))}
        {row2d("aanzichtBreedte", t("zichtbaarheid.aanzichtBreedte"), viewerSectionIcon, t("zichtbaarheid.aanzichtBreedteHint"), true)}
        {row2d("assenstelsel", t("zichtbaarheid.assenstelsel"), arrowIcon, t("zichtbaarheid.assenstelselHint"))}
        {matches(t("zichtbaarheid.raster")) && <ToggleRow icon={gridIcon} label={t("zichtbaarheid.raster")} hint={t("zichtbaarheid.rasterHint")} value={gridShow} onChange={setGridShow} />}
        {matches(t("zichtbaarheid.stramien")) && <ToggleRow icon={tableIcon} label={t("zichtbaarheid.stramien")} hint={t("zichtbaarheid.stramienHint")} value={stramienAan} onChange={setStramienAan} />}
        {row2d("peilmaten", t("zichtbaarheid.peilmaten"), viewerMeasureIcon, t("zichtbaarheid.peilmatenHint"), true)}
        {row2d("maatlijnen", t("zichtbaarheid.maatlijnen"), viewerMeasureIcon, t("zichtbaarheid.maatlijnenHint"), true)}
      </div>
      <div className="explorer-view-subtitle">{t("zichtbaarheid.labels")}</div>
      <div className="fem-results-toggle-list">
        {row2d("knoopnummers", t("zichtbaarheid.knoopnummers"), tableNodesIcon, t("zichtbaarheid.knoopnummersHint"))}
        {row2d("staafnummers", t("zichtbaarheid.staafnummers"), tableElementsIcon, t("zichtbaarheid.staafnummersHint"))}
        {row2d("profielLabels", t("tree.rowProfileName"), sectionsIcon, t("tree.rowProfileNameHint"))}
      </div>
    </section>
  );

  const rows3d = (
    <section className="explorer-view-section" data-workspace="3d">
      <div className="fem-results-section-title">
        {t("zichtbaarheid.view3d")}{workspace === "3d" ? ` · ${t("zichtbaarheid.activeWorkspace")}` : ""}
      </div>
      <div className="fem-results-toggle-list">
        {(Object.keys(frame3dVisibility) as (keyof Frame3DVisibility)[]).filter((key) => matches(t(`frame3dVisibility.${key}`))).map((key) => (
          <ToggleRow
            key={key}
            label={t(`frame3dVisibility.${key}`)}
            icon={FRAME_3D_ICONS[key]}
            value={frame3dVisibility[key]}
            onChange={(value) => setFrame3DVisibility({ ...frame3dVisibility, [key]: value })}
          />
        ))}
      </div>
    </section>
  );

  const snapRows = (
    <section className="explorer-view-section">
      <div className="fem-results-section-title">{t("zichtbaarheid.snap")}</div>
      <div className="fem-results-toggle-list">
        {matches(t("zichtbaarheid.snapAll")) && <ToggleRow icon={selectIcon} label={t("zichtbaarheid.snapAll")} value={allSnaps} onChange={zetAlleSnaps} />}
        {SNAP_SOORTEN.filter((key: SnapSoort) => matches(t(`snap.${key}`))).map((key: SnapSoort) => (
          <ToggleRow
            key={key}
            label={t(`snap.${key}`)}
            icon={SNAP_ICONS[key]}
            value={snaps[key]}
            onChange={(value) => zetSnap(key, value)}
            sub
          />
        ))}
      </div>
    </section>
  );

  return (
    <div className="explorer-view-tab">
      <div className="explorer-view-search">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" />
          <path d="m16 16 5 5" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`${t("search")}…`}
          aria-label={t("search")}
        />
      </div>
      {workspace === "3d" ? <>{rows3d}{snapRows}</> : <>{rows2d}{snapRows}</>}
    </div>
  );
}

const FRAME_3D_ICONS: Record<keyof Frame3DVisibility, string> = {
  nodes: nodeIcon,
  beams: barIcon,
  plates: plateIcon,
  profiles: sectionsIcon,
  nodeNumbers: tableNodesIcon,
  beamNumbers: tableElementsIcon,
  nodeCoordinates: arrowIcon,
  supports: bcPinnedIcon,
  loads: loadPointIcon,
  grid: gridIcon,
  structuralGrid: tableIcon,
  axes: arrowIcon,
  deformation: viewerWireframeIcon,
  reactions: loadPointIcon,
  utilization: sectionsIcon,
  axialForce: barIcon,
  shearY: arrowIcon,
  shearZ: arrowIcon,
  torsion: arrowIcon,
  momentY: arrowIcon,
  momentZ: arrowIcon,
};

const SNAP_ICONS: Record<SnapSoort, string> = {
  knoop: nodeIcon,
  stramien: tableIcon,
  raster: gridIcon,
};

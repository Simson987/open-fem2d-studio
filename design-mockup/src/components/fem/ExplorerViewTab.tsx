import { useTranslation } from "react-i18next";
import { Fragment, useState, type Dispatch, type SetStateAction } from "react";
import type { DisplayFlags } from "./FemResultsOverlay";
import { vlagAan, zetVlag, type AanUitVlag } from "../../lib/zichtbaarheid";
import {
  SNAP_SCHAKELAARS,
  SNAP_SCHAKELAARS_3D,
  SNAP_SOORTEN,
  useSnapInstellingen,
  zetAlleSnaps,
  zetHoekExtra,
  zetHoekTolerantie,
  zetKnopenAansluiten,
  zetSnap,
  zetVerbindingsTolerantie,
  type SnapSoort,
} from "../../hooks/useSnapInstellingen";
import { leesHoekTolerantie } from "../../lib/tekenhulp";
import { leesVerbindingstolerantie } from "../../lib/modelControle";
import {
  OPEN_FEM_3D_RESULT_LAYERS, OPEN_FEM_3D_VISIBILITY_FLAGS, type OpenFem3DVisibility, type OpenFem3DVisibilityFlag,
} from "../openFem3d/openFem3dVisibility";
import OpenFem3DSymbolScaleControl from "../openFem3d/OpenFem3DSymbolScaleControl";
import OpenFem3DPlateDisplayChoice, { OPEN_FEM_3D_PLATE_DISPLAY_KEYS } from "../openFem3d/OpenFem3DPlateDisplayChoice";
import { OPEN_FEM_3D_PLATE_DISPLAYS } from "../openFem3d/openFem3dPlateDisplay";
import SupportScaleControl from "./SupportScaleControl";
import {
  arrowIcon,
  barIcon,
  bcPinnedIcon,
  gridIcon,
  linkIcon,
  loadCasesIcon,
  loadPanelIcon,
  loadPointIcon,
  nodeIcon,
  plateIcon,
  sectionsIcon,
  selectIcon,
  tableElementsIcon,
  tableIcon,
  tableNodesIcon,
  viewerMeasureIcon,
  viewerOrbitIcon,
  viewerPerspectiveIcon,
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
  openFem3dVisibility: OpenFem3DVisibility;
  setOpenFem3DVisibility: (visibility: OpenFem3DVisibility) => void;
  workspace: "2d" | "3d";
  /** Opent het venster Zichtbaarheid (issue #47) met dezelfde vlaggen. */
  onOpenZichtbaarheid?: () => void;
}

function ToggleRow({
  label, hint, icon, value, onChange, sub = false, wrap = false,
}: {
  label: string;
  hint?: string;
  icon: string;
  value: boolean;
  onChange: (value: boolean) => void;
  sub?: boolean;
  /** Een lang label op twee regels in plaats van afgekapt (Knopen automatisch samenvoegen en aansluiten, #63 en #75). */
  wrap?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      className={`fem-results-toggle explorer-view-toggle${value ? " active" : ""}${sub ? " sub" : ""}${wrap ? " wrap" : ""}`}
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

/**
 * Invoer van een tolerantie, komma of punt. Pas bij Enter of het verlaten van
 * het veld vastgelegd; ongeldige invoer zet het veld terug op de bewaarde
 * waarde, Escape breekt af. Gedeeld door de hoeksnap (#53) en de
 * verbindingstolerantie (#55): `lees` begrenst, `zet` bewaart.
 */
function TolerantieInvoer({ waarde, label, lees, zet }: {
  waarde: number;
  label: string;
  lees: (tekst: string) => number | null;
  zet: (waarde: number) => void;
}) {
  const { i18n } = useTranslation("common");
  const decimaal = i18n.language?.startsWith("en") ? "." : ",";
  const toon = (v: number) => String(Math.round(v * 100) / 100).replace(".", decimaal);
  // Tijdens het typen de getypte tekst; anders de bewaarde waarde.
  const [bewerk, setBewerk] = useState<string | null>(null);
  const legVast = () => {
    if (bewerk === null) return;
    const gelezen = lees(bewerk);
    if (gelezen !== null) zet(gelezen);
    setBewerk(null);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      value={bewerk ?? toon(waarde)}
      aria-label={label}
      onChange={(e) => setBewerk(e.target.value)}
      onBlur={legVast}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); legVast(); }
        if (e.key === "Escape") { e.preventDefault(); setBewerk(null); }
      }}
    />
  );
}

/**
 * Opties van de hoeksnap (#53), als sub-rij onder de rij Hoek: de tolerantie
 * in graden (komma of punt, 0,1–15) en of ook 30°, 45° en 60° vangen.
 */
function HoekSnapOpties({ tolerantie, extra, actief }: { tolerantie: number; extra: boolean; actief: boolean }) {
  const { t } = useTranslation("common");
  return (
    <div className={`explorer-view-hoek-opties${actief ? "" : " uit"}`} data-snap-opties="hoek">
      <label className="explorer-view-hoek-veld" title={t("zichtbaarheid.hoekTolerantieHint")}>
        <span>{t("zichtbaarheid.hoekTolerantie")}</span>
        <TolerantieInvoer waarde={tolerantie} label={t("zichtbaarheid.hoekTolerantie")}
          lees={leesHoekTolerantie} zet={zetHoekTolerantie} />
      </label>
      <label className="explorer-view-hoek-vink" title={t("zichtbaarheid.hoekExtraHint")}>
        <input type="checkbox" checked={extra} onChange={(e) => zetHoekExtra(e.target.checked)} />
        <span>{t("zichtbaarheid.hoekExtra")}</span>
      </label>
    </div>
  );
}

/**
 * De verbindingstolerantie (#55; sinds #63 ook in 3D), als rij bij de snaps:
 * binnen deze afstand (mm, 0,1–25, komma of punt) geldt een knoop als "op de
 * staaf" of "op dezelfde plek". De uitleg staat in de tooltip, per werkruimte
 * (`hint`): in 3D wordt een knoop nooit verschoven. Bewaard met de
 * snapinstellingen; een andere waarde verplaatst niets.
 *
 * De eenheid staat als vaste tekst direct achter het veld, niet in het label:
 * bij de standaardbreedte van het paneel (240 px) paste "… (mm)" in geen van
 * de vier talen, en het afgekapte label liet juist de eenheid weg. Past label
 * plus veld niet op één regel, dan schuift het veld naar een tweede regel
 * (zie `.explorer-view-invoer-rij` in FemProjectTree.css); het label wordt
 * niet afgekapt.
 */
function VerbindingsTolerantieRij({ waarde, hint }: { waarde: number; hint: string }) {
  const { t } = useTranslation("common");
  const label = t("zichtbaarheid.verbindingsTolerantie");
  return (
    <label className="explorer-view-invoer-rij" data-snap-opties="verbinding" title={hint}>
      <span className="explorer-view-toggle-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: linkIcon }} />
      <span className="explorer-view-invoer-label">{label}</span>
      <span className="explorer-view-invoer-veld">
        <TolerantieInvoer waarde={waarde} label={`${label} (mm)`}
          lees={leesVerbindingstolerantie} zet={zetVerbindingsTolerantie} />
        <span className="explorer-view-invoer-eenheid" aria-hidden="true">mm</span>
      </span>
    </label>
  );
}

export default function ExplorerViewTab({
  displayFlags,
  setDisplayFlags,
  gridShow,
  setGridShow,
  stramienAan,
  setStramienAan,
  openFem3dVisibility,
  setOpenFem3DVisibility,
  workspace,
  onOpenZichtbaarheid,
}: Props) {
  const { t } = useTranslation("common");
  const [query, setQuery] = useState("");
  const snaps = useSnapInstellingen();
  // De hoeksnap bestaat alleen op het 2D-tekenvlak, het objectspoor alleen op
  // het 3D-tekenvlak (#84); "alle" gaat over de schakelaars van de werkruimte.
  const snapSchakelaars = workspace === "2d" ? SNAP_SCHAKELAARS : SNAP_SCHAKELAARS_3D;
  const allSnaps = snapSchakelaars.every((key) => snaps[key]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = (label: string) => !normalizedQuery || label.toLocaleLowerCase().includes(normalizedQuery);
  const matchesSnapGroup = Boolean(normalizedQuery)
    && t("zichtbaarheid.snap").toLocaleLowerCase().includes(normalizedQuery);
  const matchesSnap = (label: string) => matchesSnapGroup || matches(label);
  // Zoeken op "plaatweergave", "vlak" of "mesh" toont Platen met de keuze eronder.
  const matchesPlateDisplay = Boolean(normalizedQuery) && (matches(t("openFem3dVisibility.plateDisplay"))
    || OPEN_FEM_3D_PLATE_DISPLAYS.some((stand) => matches(t(`openFem3dVisibility.${OPEN_FEM_3D_PLATE_DISPLAY_KEYS[stand]}`))));

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
      {/* Tandwiel: het venster Zichtbaarheid met alle weergave-instellingen
          bij elkaar (issue #47). Zelfde vlaggen als de schakelaars hieronder. */}
      <div className="fem-results-section-title fem-results-section-title-met-knop">
        <span>{t("zichtbaarheid.view2d")}{workspace === "2d" ? ` · ${t("zichtbaarheid.activeWorkspace")}` : ""}</span>
        {onOpenZichtbaarheid && (
          <button
            type="button"
            className="fem-results-title-knop"
            onClick={onOpenZichtbaarheid}
            title={t("tree.openZichtbaarheid")}
            aria-label={t("tree.openZichtbaarheid")}
            data-actie="zichtbaarheid"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        )}
      </div>
      <div className="fem-results-toggle-list">
        {row2d("knopen", t("zichtbaarheid.knopen"), nodeIcon, t("zichtbaarheid.knopenHint"))}
        {row2d("staven", t("zichtbaarheid.staven"), barIcon, t("zichtbaarheid.stavenHint"))}
        {row2d("profielKleur", t("zichtbaarheid.profielKleur"), sectionsIcon, t("zichtbaarheid.profielKleurHint"), true)}
        {row2d("platen", t("zichtbaarheid.platen"), plateIcon, t("zichtbaarheid.platenHint"))}
        {row2d("plaatMesh", t("zichtbaarheid.mesh"), gridIcon, t("zichtbaarheid.meshHint"))}
        {row2d("opleggingen", t("zichtbaarheid.opleggingen"), bcPinnedIcon, t("zichtbaarheid.opleggingenHint"))}
        {(matches(t("zichtbaarheid.opleggingen")) || matches(t("zichtbaarheid.supportScale"))) &&
          <SupportScaleControl value={displayFlags.supportScale ?? 1}
            onChange={(supportScale) => setDisplayFlags((flags) => ({ ...flags, supportScale }))} />}
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
        {/* Alleen de modellagen; de resultaatlagen staan onder Resultaten. */}
        {OPEN_FEM_3D_VISIBILITY_FLAGS
          .filter((key) => !OPEN_FEM_3D_RESULT_LAYERS.includes(key) && (matches(t(`openFem3dVisibility.${key}`))
            || (key === "nodes" || key === "supports") && matches(t("openFem3dSymbolScale.size"))
            || key === "plates" && matchesPlateDisplay)).map((key) => {
          // Onder Knopen en Opleggingen de regelaar Grootte (issue #82), als
          // subregel zoals Waarden onder de snedekrachtlijnen.
          const schaal = key === "nodes" ? "nodeSizePercent" : key === "supports" ? "supportSizePercent" : null;
          return <Fragment key={key}>
            <ToggleRow
              label={t(`openFem3dVisibility.${key}`)}
              icon={OPEN_FEM_3D_ICONS[key]}
              value={openFem3dVisibility[key]}
              onChange={(value) => setOpenFem3DVisibility({ ...openFem3dVisibility, [key]: value })}
            />
            {schaal && (key === "nodes" || key === "supports") && <OpenFem3DSymbolScaleControl
              target={key} percent={openFem3dVisibility[schaal]} disabled={!openFem3dVisibility[key]}
              onChange={(percent) => setOpenFem3DVisibility({ ...openFem3dVisibility, [schaal]: percent })} />}
            {/* Onder Platen de plaatweergave: Volume, Vlak of Mesh (issue #78). */}
            {key === "plates" && <OpenFem3DPlateDisplayChoice value={openFem3dVisibility.plateDisplay}
              dimmed={!openFem3dVisibility.plates}
              onChange={(plateDisplay) => setOpenFem3DVisibility({ ...openFem3dVisibility, plateDisplay })} />}
          </Fragment>;
        })}
      </div>
    </section>
  );

  const snapRows = (
    <section className="explorer-view-section">
      <div className="fem-results-section-title">{t("zichtbaarheid.snap")}</div>
      <div className="fem-results-toggle-list">
        {matchesSnap(t("zichtbaarheid.snapAll")) && <ToggleRow icon={selectIcon} label={t("zichtbaarheid.snapAll")} value={allSnaps} onChange={(value) => zetAlleSnaps(value, snapSchakelaars)} />}
        {SNAP_SOORTEN.filter((key: SnapSoort) => matchesSnap(t(`snap.${key}`))).map((key: SnapSoort) => (
          <ToggleRow
            key={key}
            label={t(`snap.${key}`)}
            icon={SNAP_ICONS[key]}
            value={snaps[key]}
            onChange={(value) => zetSnap(key, value)}
            sub
          />
        ))}
        {/* Objectspoor bij het tekenen (#84), alleen in 3D. */}
        {workspace === "3d" && matchesSnap(t("snap.spoor")) && (
          <ToggleRow
            label={t("snap.spoor")}
            hint={t("zichtbaarheid.spoorHint")}
            icon={SPOOR_ICON}
            value={snaps.spoor}
            onChange={(value) => zetSnap("spoor", value)}
            sub
          />
        )}
        {/* Hoeksnap bij het tekenen van een staaf (#53), alleen in 2D. */}
        {workspace === "2d" && matchesSnap(t("snap.hoek")) && (
          <>
            <ToggleRow
              label={t("snap.hoek")}
              hint={t("zichtbaarheid.hoekHint")}
              icon={HOEK_ICON}
              value={snaps.hoek}
              onChange={(value) => zetSnap("hoek", value)}
              sub
            />
            <HoekSnapOpties tolerantie={snaps.hoekTolerantie} extra={snaps.hoekExtra} actief={snaps.hoek} />
          </>
        )}
        {/* Knopen automatisch samenvoegen en aansluiten (#63, #75), alleen in 3D. Geen
            snap: "Alle snapsoorten" laat hem staan. */}
        {workspace === "3d" && matchesSnap(t("zichtbaarheid.knopenAansluiten")) && (
          <ToggleRow
            label={t("zichtbaarheid.knopenAansluiten")}
            hint={t("zichtbaarheid.knopenAansluitenHint")}
            icon={linkIcon}
            value={snaps.knopenAansluiten}
            onChange={zetKnopenAansluiten}
            wrap
          />
        )}
        {/* Verbindingstolerantie (#55): in 2D en, sinds #63, in 3D; één
            instelling, met de uitleg van de werkruimte. */}
        {matchesSnap(t("zichtbaarheid.verbindingsTolerantie")) && (
          <VerbindingsTolerantieRij waarde={snaps.verbindingsTolerantie}
            hint={t(workspace === "3d" ? "zichtbaarheid.verbindingsTolerantieHint3d" : "zichtbaarheid.verbindingsTolerantieHint")} />
        )}
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

const OPEN_FEM_3D_ICONS: Record<OpenFem3DVisibilityFlag, string> = {
  nodes: nodeIcon,
  beams: barIcon,
  plates: plateIcon,
  profiles: sectionsIcon,
  profileColors: sectionsIcon,
  nodeNumbers: tableNodesIcon,
  beamNumbers: tableElementsIcon,
  nodeCoordinates: arrowIcon,
  supports: bcPinnedIcon,
  loads: loadPointIcon,
  loadPanels: loadPanelIcon,
  envelopePanels: loadPanelIcon,
  grid: gridIcon,
  structuralGrid: tableIcon,
  // Hetzelfde pictogram als de peilmaten in 2D.
  levelMarks: viewerMeasureIcon,
  axes: arrowIcon,
  memberAxes: arrowIcon,
  viewCube: viewerOrbitIcon,
  perspective: viewerPerspectiveIcon,
  deformation: viewerWireframeIcon,
  reactions: loadPointIcon,
  utilization: sectionsIcon,
  axialForce: barIcon,
  shearY: arrowIcon,
  shearZ: arrowIcon,
  torsion: arrowIcon,
  momentY: arrowIcon,
  momentZ: arrowIcon,
  // Gronddruk onder staven op bedding (#106), net als de snedekrachtlijnen.
  groundPressure: arrowIcon,
};

/** Een hoek tussen twee benen met een boogje — voor de hoeksnap. */
const HOEK_ICON = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 19h16M4 19 15 6"/><path stroke-linecap="round" stroke-width="2" d="M11 19a7 7 0 0 0-1.6-4.5"/></svg>`;

/** Objectspoor: een verworven punt (kruisje) met een gestippelde spoorlijn. */
const SPOOR_ICON = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-width="2" d="m4 4 4 4M8 4 4 8"/><path stroke-linecap="round" stroke-width="2" stroke-dasharray="2 3" d="M6 12v8M10 6h10"/><circle cx="6" cy="20" r="1.6" fill="currentColor" stroke="none"/></svg>`;

const SNAP_ICONS: Record<SnapSoort, string> = {
  knoop: nodeIcon,
  stramien: tableIcon,
  raster: gridIcon,
};

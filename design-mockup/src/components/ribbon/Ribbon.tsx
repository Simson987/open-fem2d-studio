import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import RibbonTab from "./RibbonTab";
import HomeTab from "./HomeTab";
import TableTab from "./TableTab";
import SettingsTab from "./SettingsTab";
import InsightsTab from "./InsightsTab";
import IfcTab from "./IfcTab";
import ReportTab from "./ReportTab";
import type { OpenFem3DSpringAxis, OpenFem3DTool, OpenFem3DView } from "../openFem3d/openFem3dCommands";
import type { OpenFem3DSupportPreset } from "../openFem3d/openFem3dModel";
import "./Ribbon.css";

interface RibbonProps {
  onFileTabClick?: () => void;
  onSettingsClick?: () => void;
  onProjectSettingsClick?: () => void;
  /** Actieve app-thema ("light" / "openaec" / …) — voor de Instellingen-tab. */
  theme?: string;
  /** Themawissel vanaf de Instellingen-tab (direct toepassen + persist). */
  onThemeSelect?: (theme: string) => void;
  /** Open de alleen-lezen bibliotheek-dialoog (profielen / materialen). */
  onOpenLibrary?: (tab: "sections" | "materials") => void;
  /** Open Instellingen op het tabblad AI-assistent (MCP) (issue #109). */
  onOpenAiAssistant?: () => void;
  activeView: string;
  onViewChange: (view: string) => void;
  modelDimension?: "2d" | "3d";
  onConvertTo3D?: () => void;
  /** Opent de wizard "Stalen hal…" (een complete hal als 3D-model). */
  onOpenSteelHall?: () => void;
  /** Active FEM canvas tool. Routed into HomeTab so draw buttons can highlight + dispatch. */
  femTool?: import("../fem/femTypes").Tool;
  onFemToolChange?: (t: import("../fem/femTypes").Tool) => void;
  /** Start de volledige 2D-berekening vanaf de 2D-tab. */
  onSolve?: () => void;
  /** True when any solver result is available; lights up the Berekenen button on Home. */
  hasResults?: boolean;
  /** Delete currently-selected node/beam/plate from the store. */
  onDelete?: () => void;
  /** Undo / Redo callbacks + availability flags. */
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  /** Opens the Stramien / Grids dialog. */
  onOpenGrids?: () => void;
  /** Opens the load-cases + combinations dialog. */
  onOpenLoadCases?: () => void;
  /** Opens the same dialog on the Combinaties tab. */
  onOpenLoadCombinations?: () => void;
  /** Opens the wind load generator (EN 1991-1-4 + NL NB). */
  onOpenWindGenerator?: () => void;
  onOpenWaterAccumulation?: () => void;
  /** Show a specific Insights sub-view (element-K / system-K / dof / logs / errors). */
  onShowInsightsMode?: (mode: "element" | "system" | "dof" | "logs" | "errors") => void;
  /** Export all stiffness matrices as CSV. */
  onExportMatrixCsv?: () => void;
  /** Opent het venster Zichtbaarheid (tab Inzicht, issue #47). */
  onOpenZichtbaarheid?: () => void;
  onFilterSelection?: () => void;
  /** Export standalone HTML report (browser + Tauri). */
  onExportHtml?: () => void;
  /**
   * De afleiding van de initiële scheefstand als tekstblok, uit App.tsx.
   *
   * Gaat ongewijzigd door naar de Rapport-tab, die hem in de PDF-uitdraai zet.
   * De ribbon leest hem niet en rekent er niets mee: φ hoort op één plaats te
   * ontstaan, en dat is App.tsx.
   */
  scheefstandToelichting?: string;
  /** Het analysetype en α_cr per combinatie, zoals App.tsx het opstelt (basisaudit nr 27). */
  analyseToelichting?: string;
  /** De omschrijving van de gegenereerde windlasten, voor de PDF (issue #16). */
  windToelichting?: string;
  /** IFC4-export van het rekenmodel (Structural Analysis Domain). */
  onExportIfc?: () => void;
  /** Idem, maar alleen het draagsysteem — zonder belastinggevallen. */
  onExportIfcStructural?: () => void;
  /** Controleert de IFC-export en meldt de uitslag. */
  onValidateIfc?: () => void;
  /** Schakelt naar het IFC-tabblad (boomstructuur / STEP / statistieken). */
  onOpenIfcView?: () => void;
  /** Importeert een IFC4-analysemodel als nieuw 3D-project. */
  onImportIfcAnalysisModel?: () => void;
  /** File-menu actions (Home tab + Backstage). */
  onNewProject?: () => void;
  onOpenProject?: () => void;
  onSaveProject?: () => void;
  onSaveProjectAs?: () => void;
  /** 3D-gereedschap voor hetzelfde modellint wanneer het project 3D is. */
  openFem3dTool?: OpenFem3DTool;
  availableOpenFem3DTools?: readonly OpenFem3DTool[];
  onOpenFem3DToolChange?: (tool: OpenFem3DTool) => void;
  canOpenFem3DDelete?: boolean;
  onOpenFem3DFit?: () => void;
  onOpenFem3DViewChange?: (view: OpenFem3DView) => void;
  openFem3dView?: OpenFem3DView;
  onToggle3DVisibility?: () => void;
  visibility3DOpen?: boolean;
  /** Plaatweergave in 3D (issue #78): volume, vlak of mesh. */
  openFem3dPlateDisplay?: import("../openFem3d/openFem3dPlateDisplay").OpenFem3DPlateDisplay;
  onOpenFem3DPlateDisplayChange?: (display: import("../openFem3d/openFem3dPlateDisplay").OpenFem3DPlateDisplay) => void;
  /** Section box in 3D (issue #86): aan (de knop licht op) en aan/uit zetten. */
  openFem3dSectionBox?: boolean;
  onOpenFem3DSectionBoxToggle?: () => void;
  openFem3dExploded?: boolean;
  onOpenFem3DExplodeToggle?: () => void;
  hasOpenFem3DNodeSelection?: boolean;
  hasOpenFem3DBeamSelection?: boolean;
  hasOpenFem3DPlateSelection?: boolean;
  onOpenFem3DSupportPreset?: (preset: OpenFem3DSupportPreset) => void;
  /** 3D: veergereedschap in deze richting (een geselecteerde knoop krijgt de veer meteen). */
  onOpenFem3DSpringTool?: (axis: OpenFem3DSpringAxis) => void;
  onOpenFem3DRequestNodalLoad?: (kind: "force" | "moment") => void;
  onOpenFem3DRequestMemberLoad?: () => void;
  onOpenFem3DRequestMemberPointLoad?: () => void;
  onOpenFem3DRequestThermalLoad?: () => void;
  onOpenFem3DRequestSurfaceLoad?: () => void;
  onOpenFem3DConvertPlateToLoadPanel?: () => void;
  /** 3D: liggers scharnierend op kolommen (de selectie, of alle staven). */
  onOpenFem3DPinBeamsToColumns?: () => void;
  /** 3D: knopen op staven aansluiten (de selectie, of het hele model), issue #63. */
  onOpenFem3DConnectNodes?: () => void;
  /** 3D: samenvallende knopen samenvoegen (de selectie, of het hele model), issue #75. */
  onOpenFem3DMergeNodes?: () => void;
  /** @deprecated — read from useReportStore in the Report tab/preview. Kept for prop-compat. */
  pageSize?: "A4" | "A3";
  /** @deprecated */
  orientation?: "portrait" | "landscape";
  /** @deprecated */
  onPageSizeChange?: (size: "A4" | "A3") => void;
  /** @deprecated */
  onOrientationChange?: (orientation: "portrait" | "landscape") => void;
  // ── Tabel-tab wiring ──────────────────────────────────────────────────
  /** Actieve dataset van de tabel-editor (highlight op de Tabel-tab). */
  tableDataset?: import("../table/tableTypes").TableDataset;
  /** Dataset kiezen — App schakelt daarbij ook de hoofdweergave om. */
  onTableDataset?: (d: import("../table/tableTypes").TableDataset) => void;
  /** Actieve tabel als CSV downloaden. */
  onTableExportCsv?: () => void;
  /** Actieve tabel als TSV naar het klembord. */
  onTableCopy?: () => void;
  /** Filterveld boven de tabel focussen. */
  onTableFocusFilter?: () => void;
}

const TABS = ["home", "table", "settings", "insights", "ifc", "report"] as const;
type TabId = (typeof TABS)[number];

export default function Ribbon({
  onFileTabClick, onSettingsClick, onProjectSettingsClick, activeView, onViewChange,
  modelDimension = "2d", onConvertTo3D, onOpenSteelHall,
  theme, onThemeSelect, onOpenLibrary, onOpenAiAssistant,
  femTool, onFemToolChange, onSolve, hasResults,
  onDelete, onUndo, onRedo, canUndo, canRedo, onOpenGrids,
  onOpenLoadCases, onOpenLoadCombinations, onOpenWindGenerator, onOpenWaterAccumulation, onNewProject, onOpenProject,
  onSaveProject, onSaveProjectAs,
  openFem3dTool, availableOpenFem3DTools, onOpenFem3DToolChange, canOpenFem3DDelete,
  onOpenFem3DFit, onOpenFem3DViewChange, openFem3dView,
  onToggle3DVisibility, visibility3DOpen, openFem3dPlateDisplay, onOpenFem3DPlateDisplayChange, openFem3dSectionBox, onOpenFem3DSectionBoxToggle, openFem3dExploded, onOpenFem3DExplodeToggle, hasOpenFem3DNodeSelection, hasOpenFem3DBeamSelection, hasOpenFem3DPlateSelection,
  onOpenFem3DSupportPreset, onOpenFem3DSpringTool, onOpenFem3DRequestNodalLoad, onOpenFem3DRequestMemberLoad,
  onOpenFem3DRequestMemberPointLoad, onOpenFem3DRequestThermalLoad, onOpenFem3DRequestSurfaceLoad,
  onOpenFem3DConvertPlateToLoadPanel, onOpenFem3DPinBeamsToColumns, onOpenFem3DConnectNodes, onOpenFem3DMergeNodes,
  onShowInsightsMode, onExportMatrixCsv, onOpenZichtbaarheid,
  onFilterSelection,
  onExportHtml, scheefstandToelichting, analyseToelichting, windToelichting,
  onExportIfc, onExportIfcStructural, onValidateIfc, onOpenIfcView, onImportIfcAnalysisModel,
  tableDataset, onTableDataset, onTableExportCsv, onTableCopy, onTableFocusFilter,
}: RibbonProps) {
  const { t, i18n } = useTranslation("ribbon");
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [prevTab, setPrevTab] = useState<TabId | null>(null);
  const [animating, setAnimating] = useState(false);
  const [direction, setDirection] = useState<"left" | "right">("right");
  const tabsRef = useRef<HTMLDivElement>(null);
  const borderRef = useRef<HTMLDivElement>(null);
  const gapRef = useRef<HTMLDivElement>(null);

  const updateHighlight = useCallback(() => {
    const tabsEl = tabsRef.current;
    const borderEl = borderRef.current;
    const gapEl = gapRef.current;
    if (!tabsEl || !borderEl || !gapEl) return;

    const activeEl = tabsEl.querySelector(".ribbon-tab.active") as HTMLElement | null;
    if (!activeEl) {
      borderEl.style.opacity = "0";
      gapEl.style.opacity = "0";
      return;
    }

    const tabsRect = tabsEl.getBoundingClientRect();
    const activeRect = activeEl.getBoundingClientRect();
    const left = activeRect.left - tabsRect.left;
    const top = activeRect.top - tabsRect.top;
    const width = activeRect.width;
    const height = activeRect.height;

    borderEl.style.opacity = "1";
    borderEl.style.left = `${left}px`;
    borderEl.style.top = `${top}px`;
    borderEl.style.width = `${width}px`;
    borderEl.style.height = `${height}px`;

    gapEl.style.opacity = "1";
    gapEl.style.left = `${left + 1}px`;
    gapEl.style.width = `${width - 2}px`;
  }, []);

  const switchTab = useCallback((newTab: TabId) => {
    if (newTab === activeTab) return;
    const oldIndex = TABS.indexOf(activeTab);
    const newIndex = TABS.indexOf(newTab);
    setDirection(newIndex > oldIndex ? "right" : "left");
    setPrevTab(activeTab);
    setActiveTab(newTab);
    setAnimating(true);

    // Alleen een expliciete tabklik wisselt de hoofdweergave.
    if (newTab === "ifc") onViewChange("ifc");
    else if (newTab === "report") onViewChange("report");
    else if (newTab === "insights") onViewChange("insights");
    else if (newTab === "table") onViewChange("table");
    else onViewChange(modelDimension === "3d" ? "openFem3d" : "default");
  }, [activeTab, modelDimension, onViewChange]);

  // Houd de ribbon-tab in sync wanneer App de hoofdview programmatisch
  // wisselt (bv. TitleBar-Afdrukken → rapportweergave). Alleen voor views
  // die 1-op-1 bij een tab horen; "default" hoort bij meerdere tabs
  // (2D/Tabel/Instellingen) en blijft daarom ongemoeid, behalve wanneer een
  // programma-actie de 3D-weergave verlaat (bv. Nieuw project/Berekenen).
  useEffect(() => {
    if (
      (activeView === "report" || activeView === "ifc" || activeView === "insights" ||
       activeView === "table") &&
      activeTab !== activeView
    ) {
      switchTab(activeView as TabId);
    } else if (activeView === "openFem3d" && activeTab !== "home") {
      switchTab("home");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView]);

  useEffect(() => {
    updateHighlight();
    requestAnimationFrame(updateHighlight);
  }, [activeTab, i18n.language, updateHighlight]);

  useEffect(() => {
    window.addEventListener("resize", updateHighlight);
    return () => window.removeEventListener("resize", updateHighlight);
  }, [updateHighlight]);

  useEffect(() => {
    if (!animating) return;
    const timer = setTimeout(() => {
      setAnimating(false);
      setPrevTab(null);
    }, 250);
    return () => clearTimeout(timer);
  }, [animating]);

  const renderContent = (tab: TabId) => {
    switch (tab) {
      case "home":
        return <HomeTab
          onSettingsClick={onSettingsClick}
          onProjectSettingsClick={onProjectSettingsClick}
          femTool={femTool}
          onFemToolChange={onFemToolChange}
          onDelete={onDelete}
          onUndo={onUndo}
          onRedo={onRedo}
          canUndo={canUndo}
          canRedo={canRedo}
          onOpenGrids={onOpenGrids}
          onSolve={onSolve}
          hasResults={hasResults}
          onOpenLoadCases={onOpenLoadCases}
          onOpenLoadCombinations={onOpenLoadCombinations}
          onOpenWindGenerator={onOpenWindGenerator}
          onOpenWaterAccumulation={onOpenWaterAccumulation}
          onFilterSelection={onFilterSelection}
          onNewProject={onNewProject}
          onOpenProject={onOpenProject}
          onSaveProject={onSaveProject}
          onSaveProjectAs={onSaveProjectAs}
          modelDimension={modelDimension}
          onConvertTo3D={onConvertTo3D}
          onOpenSteelHall={onOpenSteelHall}
          openFem3dTool={openFem3dTool}
          availableOpenFem3DTools={availableOpenFem3DTools}
          onOpenFem3DToolChange={onOpenFem3DToolChange}
          canOpenFem3DDelete={canOpenFem3DDelete}
          onOpenFem3DFit={onOpenFem3DFit}
          onOpenFem3DViewChange={onOpenFem3DViewChange}
          openFem3dView={openFem3dView}
          onToggle3DVisibility={onToggle3DVisibility}
          visibility3DOpen={visibility3DOpen}
          openFem3dPlateDisplay={openFem3dPlateDisplay}
          onOpenFem3DPlateDisplayChange={onOpenFem3DPlateDisplayChange}
          openFem3dSectionBox={openFem3dSectionBox}
          onOpenFem3DSectionBoxToggle={onOpenFem3DSectionBoxToggle}
          openFem3dExploded={openFem3dExploded}
          onOpenFem3DExplodeToggle={onOpenFem3DExplodeToggle}
          hasOpenFem3DNodeSelection={hasOpenFem3DNodeSelection}
          hasOpenFem3DBeamSelection={hasOpenFem3DBeamSelection}
          hasOpenFem3DPlateSelection={hasOpenFem3DPlateSelection}
          onOpenFem3DSupportPreset={onOpenFem3DSupportPreset}
          onOpenFem3DSpringTool={onOpenFem3DSpringTool}
          onOpenFem3DRequestNodalLoad={onOpenFem3DRequestNodalLoad}
          onOpenFem3DRequestMemberLoad={onOpenFem3DRequestMemberLoad}
          onOpenFem3DRequestMemberPointLoad={onOpenFem3DRequestMemberPointLoad}
          onOpenFem3DRequestThermalLoad={onOpenFem3DRequestThermalLoad}
          onOpenFem3DRequestSurfaceLoad={onOpenFem3DRequestSurfaceLoad}
          onOpenFem3DConvertPlateToLoadPanel={onOpenFem3DConvertPlateToLoadPanel}
          onOpenFem3DPinBeamsToColumns={onOpenFem3DPinBeamsToColumns}
          onOpenFem3DConnectNodes={onOpenFem3DConnectNodes}
          onOpenFem3DMergeNodes={onOpenFem3DMergeNodes}
        />;
      case "table":
        return <TableTab
          activeDataset={tableDataset}
          onSelectDataset={onTableDataset}
          onExportCsv={onTableExportCsv}
          onCopyTable={onTableCopy}
          onFocusFilter={onTableFocusFilter}
        />;
      case "settings":
        return <SettingsTab
          onSettingsClick={onSettingsClick}
          onProjectSettingsClick={onProjectSettingsClick}
          theme={theme}
          onThemeSelect={onThemeSelect}
          onOpenLibrary={onOpenLibrary}
          onOpenAiAssistant={onOpenAiAssistant}
        />;
      case "insights":
        return <InsightsTab onShowInsights={() => onViewChange("insights")} onShowInsightsMode={onShowInsightsMode} onExportMatrixCsv={onExportMatrixCsv} onOpenZichtbaarheid={onOpenZichtbaarheid} />;
      case "ifc":
        return <IfcTab
          onExportIfc={onExportIfc}
          onExportIfcStructural={onExportIfcStructural}
          onValidateIfc={onValidateIfc}
          onOpenIfcView={onOpenIfcView}
          onImportAnalysisModel={onImportIfcAnalysisModel}
        />;
      case "report":
        return <ReportTab
          onExportHtml={onExportHtml}
          scheefstandToelichting={scheefstandToelichting}
          analyseToelichting={analyseToelichting}
          windToelichting={windToelichting}
        />;
    }
  };

  return (
    <div className="ribbon-container">
      <div className="ribbon-tabs" ref={tabsRef}>
        <RibbonTab label={t("tabs.file")} isFileTab onClick={() => onFileTabClick?.()} />
        {TABS.map((tab) => (
          <RibbonTab
            key={tab}
            label={tab === "home" ? modelDimension.toUpperCase() : t(`tabs.${tab}`)}
            isActive={activeTab === tab}
            onClick={() => switchTab(tab)}
          />
        ))}
        <div className="ribbon-tab-border" ref={borderRef} />
        <div className="ribbon-tab-gap" ref={gapRef} />
      </div>

      <div className="ribbon-content-wrapper">
        {animating && prevTab && (
          <div
            className={`ribbon-content-panel ribbon-panel-exit-${direction}`}
            key={`prev-${prevTab}`}
            inert
            aria-hidden="true"
          >
            {renderContent(prevTab)}
          </div>
        )}
        <div
          className={`ribbon-content-panel${animating ? ` ribbon-panel-enter-${direction}` : ""}`}
          key={`active-${activeTab}`}
        >
          {renderContent(activeTab)}
        </div>
      </div>
    </div>
  );
}

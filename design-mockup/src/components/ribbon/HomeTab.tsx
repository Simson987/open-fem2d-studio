import { useRef } from "react";
import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";
import RibbonButtonStack from "./RibbonButtonStack";
import { useRibbonCompact } from "./useRibbonCompact";
import type { OpenFem3DSpringAxis, OpenFem3DTool, OpenFem3DView } from "../openFem3d/openFem3dCommands";
import type { OpenFem3DSupportPreset } from "../openFem3d/openFem3dModel";
import type { OpenFem3DPlateDisplay } from "../openFem3d/openFem3dPlateDisplay";
import {
  fileNewIcon,
  fileOpenIcon,
  fileSaveIcon,
  projectInfoIcon,
  selectIcon,
  barIcon,
  nodeIcon,
  plateIcon,
  openingIcon,
  gridIcon,
  bcPinnedIcon,
  bcXRollerIcon,
  bcZRollerIcon,
  bcZSpringIcon,
  bcXSpringIcon,
  bcRotSpringIcon,
  bcFixedIcon,
  loadPointIcon,
  loadPointHIcon,
  loadLineIcon,
  loadPanelIcon,
  loadMomentIcon,
  loadTempIcon,
  loadCasesIcon,
  loadCombinationsIcon,
  windGeneratorIcon,
  waterAccumulationIcon,
  moveIcon,
  rotateIcon,
  undoIcon,
  redoIcon,
  copyIcon,
  filterIcon,
  zichtbaarheidIcon,
  plateVolumeIcon,
  plateSurfaceIcon,
  plateMeshIcon,
} from "./icons";
import { b2 } from "./b2Icons";
import { toetsVoor } from "../../lib/sneltoetsen";

interface HomeTabProps {
  onSettingsClick?: () => void;
  onProjectSettingsClick?: () => void;
  femTool?: import("../fem/femTypes").Tool;
  onFemToolChange?: (t: import("../fem/femTypes").Tool) => void;
  onDelete?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onOpenGrids?: () => void;
  /** Run linear analysis (all load cases + envelope). Same handler as Toetsing > Toetsen uitvoeren. */
  onSolve?: () => void;
  hasResults?: boolean;
  /** Opens the load-cases + combinations dialog (Gevallen tab). */
  onOpenLoadCases?: () => void;
  /** Opens the same dialog but jumps straight to the Combinaties tab. */
  onOpenLoadCombinations?: () => void;
  /** Opens the wind load generator (EN 1991-1-4 + NL NB). */
  onOpenWindGenerator?: () => void;
  onOpenWaterAccumulation?: () => void;
  /** Venster Selectiefilter: de selectie (of het hele model) verfijnen (issue #94). */
  onFilterSelection?: () => void;
  /** Wired file-menu actions. */
  onNewProject?: () => void;
  onOpenProject?: () => void;
  onSaveProject?: () => void;
  onSaveProjectAs?: () => void;
  modelDimension?: "2d" | "3d";
  onConvertTo3D?: () => void;
  /** Opent de wizard "Stalen hal…"; staat in 2D en 3D (de hal is altijd een 3D-model). */
  onOpenSteelHall?: () => void;
  openFem3dTool?: OpenFem3DTool;
  availableOpenFem3DTools?: readonly OpenFem3DTool[];
  onOpenFem3DToolChange?: (tool: OpenFem3DTool) => void;
  canOpenFem3DDelete?: boolean;
  onOpenFem3DFit?: () => void;
  onOpenFem3DViewChange?: (view: OpenFem3DView) => void;
  openFem3dView?: OpenFem3DView;
  onToggle3DVisibility?: () => void;
  visibility3DOpen?: boolean;
  /** Plaatweergave in 3D (issue #78): volume, vlak of mesh; de actieve knop licht op. */
  openFem3dPlateDisplay?: OpenFem3DPlateDisplay;
  onOpenFem3DPlateDisplayChange?: (display: OpenFem3DPlateDisplay) => void;
  /** Section box in 3D (issue #86): staat hij aan (de knop licht op), en aan/uit zetten. */
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
  /** Zet de geselecteerde 3D-plaat om in een belastingvlak (geen stijfheid, alleen lastafdracht). */
  onOpenFem3DConvertPlateToLoadPanel?: () => void;
  /** 3D: liggers scharnierend op kolommen; de geselecteerde staven, of alle staven zonder selectie. */
  onOpenFem3DPinBeamsToColumns?: () => void;
  /** 3D: knopen op staven aansluiten (issue #63); de geselecteerde knopen en staven, of het hele model. */
  onOpenFem3DConnectNodes?: () => void;
  /** 3D: samenvallende knopen samenvoegen (issue #75); de selectie, of het hele model. */
  onOpenFem3DMergeNodes?: () => void;
}

const stub = (label: string) => () => console.log(`TODO: ${label}`);

// Reusable trash icon — there isn't one in icons.ts yet.
const deleteIcon = b2("edit.delete");
const subnodeIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12h18M12 8v8"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>`;
const mirrorIcon = b2("transform.mirror");
const plateArcIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 19h16M4 19Q12 2 20 19"/><circle cx="4" cy="19" r="1.5" fill="currentColor" stroke="none"/><circle cx="20" cy="19" r="1.5" fill="currentColor" stroke="none"/></svg>`;
// Solve / "play" icon — used for the Berekenen button.
const solveIcon = b2("fem.solve-linear");
const cubeIcon = b2("view.isometric");
const fitIcon = b2("view.fit");
const topIcon = b2("view.top");
const frontIcon = b2("view.front");
const sideIcon = b2("view.right");
const steelHallIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="1.8" stroke-linejoin="round" d="M3 20V10l9-6 9 6v10M3 10h18"/><path stroke-width="1.4" d="M7 20v-9.5M12 20V7M17 20v-9.5M3 20h18"/></svg>`;
const revoluteIcon = (axis: "X" | "Y" | "Z") => `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="1.8" stroke-linecap="round" d="M7 16a7 7 0 1 1 10 0"/><path stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="m6 12 1 4 4-1"/><circle cx="12" cy="12" r="2"/><text x="12" y="22" text-anchor="middle" fill="currentColor" stroke="none" font-size="6" font-family="sans-serif">${axis}</text></svg>`;
/** Veer in Y (3D): het X-veersymbool met een letter, zoals de Y-rol. */
const ySpringIcon = `<svg fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 16 16"><path d="M15,8 L13,8 L11.5,4 L9.5,12 L7.5,4 L5.5,12 L4,8 L3,8"/><line x1="1" y1="2" x2="1" y2="14" stroke="#333"/><text x="13" y="4.5" text-anchor="middle" fill="currentColor" stroke="none" font-size="5" font-family="sans-serif">Y</text></svg>`;
/** Rotatieveer om een globale as (3D). */
const rotSpringIcon = (axis: string) => `<svg fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round" viewBox="0 0 16 16"><path d="M4,4 A5,5 0 0,1 12,4"/><path d="M12,12 A5,5 0 0,1 4,12"/><circle cx="8" cy="8" r="1.5" fill="#f59e0b"/><text x="14" y="15.5" text-anchor="middle" fill="currentColor" stroke="none" font-size="5" font-family="sans-serif">${axis}</text></svg>`;
/** Scharnier aan staafeind: een staaf met een open bolletje net vóór de knoop. */
const beamEndHingeIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2" stroke-linecap="round" d="M2 12h11.4"/><circle cx="16" cy="12" r="2.6" stroke-width="1.6"/><circle cx="21" cy="12" r="1.8" fill="currentColor" stroke="none"/></svg>`;
/** Liggers scharnierend op kolommen: een portaal met een open bolletje aan elk liggereind. */
const pinBeamsToColumnsIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2" stroke-linecap="round" d="M5 21V6m14 15V6M5 6h.6m4 0h4.8m4 0H19"/><circle cx="7.6" cy="6" r="2" stroke-width="1.6"/><circle cx="16.4" cy="6" r="2" stroke-width="1.6"/><path stroke-width="1.4" d="M2 21h20"/></svg>`;
/** Section box: een doos met gestippelde binnenribben en een greep (pijltje) op het voorvlak. */
const sectionBoxIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="1.7" stroke-linejoin="round" d="m11 3 8 4.5v9L11 21l-8-4.5v-9z"/><path stroke-width="1.3" stroke-dasharray="2 1.6" d="m3 7.5 8 4.5 8-4.5M11 12v9"/><path stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M19 12h3m-1.4-1.6L22 12l-1.4 1.6"/></svg>`;
/** Knopen samenvoegen: twee knopen die naar één knoop toe lopen. */
const mergeNodesIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="5.5" r="2.2" stroke-width="1.6"/><circle cx="5" cy="18.5" r="2.2" stroke-width="1.6"/><path stroke-width="1.6" stroke-linecap="round" d="m7 7.2 6.4 3.6M7 16.8l6.4-3.6"/><circle cx="17.5" cy="12" r="3.2" fill="currentColor" stroke="none"/><path stroke-width="1.6" stroke-linecap="round" d="M20.7 12H23"/></svg>`;
/** Knopen aansluiten: een staaf met drie knopen erop, de middelste gesplitst. */
const connectNodesIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2" stroke-linecap="round" d="M2 14h5.2m3.6 0h2.4m3.6 0H22"/><circle cx="9" cy="14" r="1.8" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1.8" fill="currentColor" stroke="none"/><path stroke-width="1.6" stroke-linecap="round" d="M9 11V4m6 7V4"/></svg>`;
const yRollerIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="1.8" stroke-linejoin="round" d="M5 12h14l-7-7-7 7Z"/><circle cx="9" cy="16" r="2"/><circle cx="15" cy="16" r="2"/><path stroke-width="1.8" d="M4 20h16"/><text x="20" y="8" text-anchor="middle" fill="currentColor" stroke="none" font-size="6" font-family="sans-serif">Y</text></svg>`;

export default function HomeTab({
  onSettingsClick: _onSettingsClick,
  onProjectSettingsClick,
  femTool = "select",
  onFemToolChange,
  onDelete, onUndo, onRedo, canUndo, canRedo, onOpenGrids,
  onSolve, hasResults,
  onOpenLoadCases, onOpenLoadCombinations, onOpenWindGenerator, onOpenWaterAccumulation, onNewProject, onOpenProject,
  onSaveProject, onSaveProjectAs,
  onFilterSelection,
  modelDimension = "2d", onConvertTo3D, onOpenSteelHall,
  openFem3dTool = "select", availableOpenFem3DTools = ["select", "addNode", "addBeam", "addSubNode", "addPlate", "addPlateArc", "addOpening", "addOpeningArc", "move", "rotate", "copy", "mirror"],
  onOpenFem3DToolChange, canOpenFem3DDelete,
  onOpenFem3DFit, onOpenFem3DViewChange, openFem3dView = "iso",
  onToggle3DVisibility, visibility3DOpen, openFem3dPlateDisplay = "volume", onOpenFem3DPlateDisplayChange,
  openFem3dSectionBox = false, onOpenFem3DSectionBoxToggle,
  openFem3dExploded = false, onOpenFem3DExplodeToggle,
  hasOpenFem3DNodeSelection, hasOpenFem3DBeamSelection, hasOpenFem3DPlateSelection, onOpenFem3DSupportPreset, onOpenFem3DSpringTool,
  onOpenFem3DRequestNodalLoad, onOpenFem3DRequestMemberLoad, onOpenFem3DRequestMemberPointLoad, onOpenFem3DRequestThermalLoad, onOpenFem3DRequestSurfaceLoad,
  onOpenFem3DConvertPlateToLoadPanel, onOpenFem3DPinBeamsToColumns, onOpenFem3DConnectNodes, onOpenFem3DMergeNodes,
}: HomeTabProps) {
  const { t } = useTranslation("ribbon");
  const is3D = modelDimension === "3d";
  const unsupported3D = t("home.notAvailable3D");
  const frameToolFor = (tool: import("../fem/femTypes").Tool): OpenFem3DTool | undefined => {
    if (tool === "select" || tool === "addNode" || tool === "addBeam" || tool === "addSubNode" ||
        tool === "addPlate" || tool === "addOpening" || tool === "move" || tool === "rotate" || tool === "copy" || tool === "mirror") return tool;
    return undefined;
  };
  const frameToolAvailable = (tool: import("../fem/femTypes").Tool) => {
    const mapped = frameToolFor(tool);
    return mapped !== undefined && availableOpenFem3DTools.includes(mapped);
  };
  const setTool = (tool: import("../fem/femTypes").Tool) => {
    if (!is3D) onFemToolChange?.(tool);
    else {
      const mapped = frameToolFor(tool);
      if (mapped && availableOpenFem3DTools.includes(mapped)) onOpenFem3DToolChange?.(mapped);
    }
  };
  const toolActive = (tool: import("../fem/femTypes").Tool) => is3D
    ? frameToolFor(tool) === openFem3dTool
    : femTool === tool;
  const nodeConditionTitle = hasOpenFem3DNodeSelection ? undefined : t("openFem3d.selectNodeFirst");
  const supportPlacementTitle = t("openFem3d.supportPlacementHelp", { defaultValue: t("openFem3d.selectNodeFirst") });
  const springPlacementTitle = t("openFem3d.springPlacementHelp", { defaultValue: t("openFem3d.selectNodeFirst") });
  const beamConditionTitle = hasOpenFem3DBeamSelection ? undefined : t("openFem3d.selectBeamFirst", "Selecteer eerst een 3D-staaf.");
  const drawingOpening3D = openFem3dTool === "addOpening" || openFem3dTool === "addOpeningArc";
  // Past het lint met namen niet in het venster (het 3D-lint vooral), dan eerst ingekorte namen en
  // pas daarna alleen pictogrammen bij de kleine knoppen (gemeten, useRibbonCompact).
  const contentRef = useRef<HTMLDivElement>(null);
  useRibbonCompact(contentRef);

  return (
    <div className="ribbon-content ribbon-content-home" ref={contentRef}>
      <div className="ribbon-groups">
        {/* Berekening — Berekenen (large primary action) */}
        <RibbonGroup label={t("home.calculation")}>
          <RibbonButton
            icon={solveIcon}
            label={t("home.solve")}
            shortcut={toetsVoor("berekenen")}
            size="large"
            active={hasResults}
            onClick={() => onSolve?.()}
            disabled={!onSolve}
          />
        </RibbonGroup>

        {/* File — large New, stacked Open/Save */}
        <RibbonGroup label={t("home.file")}>
          <RibbonButton
            icon={fileNewIcon}
            label={t("home.new")}
            shortcut={toetsVoor("nieuw")}
            size="large"
            onClick={onNewProject ?? stub("New project (no handler)")}
          />
          <RibbonButtonStack>
            <RibbonButton
              icon={fileOpenIcon}
              label={t("home.open")}
              shortcut={toetsVoor("openen")}
              size="small"
              onClick={onOpenProject ?? stub("Open project (no handler)")}
            />
            <RibbonButton
              icon={fileSaveIcon}
              label={t("home.save")}
              shortcut={toetsVoor("opslaan")}
              size="small"
              onClick={onSaveProject ?? stub("Save project (no handler)")}
            />
            <RibbonButton
              icon={fileSaveIcon}
              label={t("home.saveAs")}
              shortcut={toetsVoor("opslaanAls")}
              size="small"
              onClick={onSaveProjectAs ?? stub("Save project as (no handler)")}
            />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* Project — gegevens en uitgangspunten horen bij de start van elk
            project (rapportkop, normkeuzes, rekeninstellingen), dus die
            knoppen staan hier vooraan in plaats van verstopt onder
            Instellingen. Zelfde handlers als de Instellingen-tab. */}
        <RibbonGroup label={t("home.projectGroep", "Project")}>
          {/* Projectgegevens bevat óók de uitgangspunten (normen,
              gevolgklasse, ontwerplevensduur) — één ingang, geen aparte
              knop meer. */}
          <RibbonButton
            icon={projectInfoIcon}
            label={t("home.projectInfo", "Projectgegevens & uitgangspunten")}
            size="large"
            onClick={onProjectSettingsClick ?? stub("Project info dialog")}
          />
          {!is3D && (
            <RibbonButton
              icon={cubeIcon}
              label={t("home.to3D")}
              size="small"
              onClick={onConvertTo3D}
              disabled={!onConvertTo3D}
              title={t("home.to3DHint")}
            />
          )}
          <RibbonButton
            icon={steelHallIcon}
            label={t("staalhal.knop")}
            size="small"
            onClick={onOpenSteelHall}
            disabled={!onOpenSteelHall}
            title={t("staalhal.knopHint")}
          />
        </RibbonGroup>

        {/* Draw — Select (large), Bar/Node/Plate/Grids (mix) */}
        <RibbonGroup label={t("home.draw")}>
          <RibbonButton
            icon={selectIcon}
            label={t("home.select")}
            size="large"
            active={toolActive("select")}
            onClick={() => setTool("select")}
          />
          <RibbonButton
            icon={barIcon}
            label={t("home.bar")}
            shortcut={is3D ? undefined : toetsVoor("staaf")}
            size="large"
            active={toolActive("addBeam")}
            onClick={() => setTool("addBeam")}
          />
          <RibbonButtonStack>
            <RibbonButton
              icon={nodeIcon}
              label={t("home.node")}
              shortcut={is3D ? undefined : toetsVoor("knoop")}
              size="small"
              active={toolActive("addNode")}
              onClick={() => setTool("addNode")}
            />
            <RibbonButton
              icon={subnodeIcon}
              label={t("home.subNode")}
              size="small"
              active={toolActive("addSubNode")}
              onClick={() => setTool("addSubNode")}
              disabled={is3D && !frameToolAvailable("addSubNode")}
              title={is3D && !frameToolAvailable("addSubNode") ? unsupported3D : undefined}
            />
            <RibbonButton
              icon={plateIcon}
              label={t("home.plate")}
              shortcut={is3D ? undefined : toetsVoor("plaat")}
              size="small"
              active={toolActive("addPlate")}
              onClick={() => setTool("addPlate")}
              disabled={is3D && !frameToolAvailable("addPlate")}
              title={is3D ? t("home.plate3DHint") : undefined}
            />
            {is3D && <RibbonButton
              icon={plateArcIcon}
              label={t("home.plateArc")}
              size="small"
              active={openFem3dTool === "addPlateArc" || openFem3dTool === "addOpeningArc"}
              onClick={() => onOpenFem3DToolChange?.(drawingOpening3D ? "addOpeningArc" : "addPlateArc")}
              disabled={!availableOpenFem3DTools.includes(drawingOpening3D ? "addOpeningArc" : "addPlateArc")}
              title={drawingOpening3D ? t("home.openingArcHint") : t("home.plateArcHint")}
            />}
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton
              icon={openingIcon}
              label={t("home.opening")}
              size="small"
              active={is3D ? drawingOpening3D : toolActive("addOpening")}
              onClick={() => setTool("addOpening")}
              disabled={is3D && (!frameToolAvailable("addOpening") || (!hasOpenFem3DPlateSelection && !drawingOpening3D))}
              title={is3D ? (hasOpenFem3DPlateSelection || drawingOpening3D
                ? t("home.opening3DHint")
                : t("home.selectPlate3DFirst")) : undefined}
            />
            {/* Knopen op staven aansluiten (#63): de selectie, of het hele model. */}
            {is3D && <RibbonButton
              icon={connectNodesIcon}
              label={t("openFem3d.connectNodes")}
              size="small"
              onClick={onOpenFem3DConnectNodes}
              disabled={!onOpenFem3DConnectNodes}
              title={t("openFem3d.connectNodesHint")}
            />}
          </RibbonButtonStack>
          <RibbonButtonStack>
            {is3D && <RibbonButton
              icon={loadLineIcon}
              label={t("home.surfaceLoad")}
              size="small"
              onClick={onOpenFem3DRequestSurfaceLoad}
              disabled={!hasOpenFem3DPlateSelection || !onOpenFem3DRequestSurfaceLoad}
              title={hasOpenFem3DPlateSelection ? t("home.surfaceLoadHint") : t("home.selectPlate3DFirst")}
            />}
            <RibbonButton
              icon={gridIcon}
              label={t("home.grids")}
              shortcut={toetsVoor("stramien")}
              size="small"
              onClick={() => onOpenGrids?.()}
            />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* Boundary Conditions — Pinned large, others stacked */}
        <RibbonGroup label={t("home.boundaryConditions")}>
          <RibbonButton
            icon={bcPinnedIcon}
            label={t("home.pinned")}
            shortcut={is3D ? undefined : toetsVoor("scharnier")}
            size="large"
            active={is3D ? openFem3dTool === "support:pinned" : toolActive("addPinned")}
            onClick={() => is3D ? onOpenFem3DSupportPreset?.("pinned") : setTool("addPinned")}
            disabled={is3D && !onOpenFem3DSupportPreset}
            title={is3D ? supportPlacementTitle : undefined}
          />
          <RibbonButtonStack>
            <RibbonButton
              icon={bcXRollerIcon}
              label={t("home.xRoller")}
              size="small"
              active={is3D ? openFem3dTool === "support:xRoller" : toolActive("addXRoller")}
              onClick={() => is3D ? onOpenFem3DSupportPreset?.("xRoller") : setTool("addXRoller")}
              disabled={is3D && !onOpenFem3DSupportPreset}
              title={is3D ? supportPlacementTitle : undefined}
            />
            <RibbonButton
              icon={bcZRollerIcon}
              label={t("home.zRoller")}
              size="small"
              active={is3D ? openFem3dTool === "support:zRoller" : toolActive("addZRoller")}
              onClick={() => is3D ? onOpenFem3DSupportPreset?.("zRoller") : setTool("addZRoller")}
              disabled={is3D && !onOpenFem3DSupportPreset}
              title={is3D ? supportPlacementTitle : undefined}
            />
            {is3D && <RibbonButton
              icon={yRollerIcon}
              label={t("openFem3d.yRoller", "Y-rol")}
              size="small"
              active={openFem3dTool === "support:yRoller"}
              onClick={() => onOpenFem3DSupportPreset?.("yRoller")}
              disabled={!onOpenFem3DSupportPreset}
              title={supportPlacementTitle}
            />}
            <RibbonButton
              icon={bcFixedIcon}
              label={t("home.fixed")}
              size="small"
              active={is3D ? openFem3dTool === "support:fixed" : toolActive("addFixed")}
              onClick={() => is3D ? onOpenFem3DSupportPreset?.("fixed") : setTool("addFixed")}
              disabled={is3D && !onOpenFem3DSupportPreset}
              title={is3D ? supportPlacementTitle : undefined}
            />
          </RibbonButtonStack>
          {is3D && <RibbonButtonStack>
            {(["X", "Y", "Z"] as const).map((axis) => {
              const preset = `revolute${axis}` as OpenFem3DSupportPreset;
              return <RibbonButton
                key={axis}
                icon={revoluteIcon(axis)}
                label={t(`openFem3d.revolute${axis}`)}
                size="small"
                active={openFem3dTool === `support:${preset}`}
                onClick={() => onOpenFem3DSupportPreset?.(preset)}
                disabled={!onOpenFem3DSupportPreset}
                title={`${t("openFem3d.revoluteHint", { axis })} ${supportPlacementTitle}`}
              />;
            })}
          </RibbonButtonStack>}
          {/* 3D: veren zijn gereedschappen zoals de opleggingen (klik op een
              knoop of in leeg canvas); drie translatie- en drie rotatieveren. */}
          {is3D ? <>
            <RibbonButtonStack>
              {(["kx", "ky", "kz"] as const).map((axis) => <RibbonButton
                key={axis}
                icon={axis === "kx" ? bcXSpringIcon : axis === "ky" ? ySpringIcon : bcZSpringIcon}
                label={axis === "ky" ? t("openFem3d.ySpring") : t(axis === "kx" ? "home.xSpring" : "home.zSpring")}
                size="small"
                active={openFem3dTool === `spring:${axis}`}
                onClick={() => onOpenFem3DSpringTool?.(axis)}
                disabled={!onOpenFem3DSpringTool}
                title={springPlacementTitle}
              />)}
            </RibbonButtonStack>
            <RibbonButtonStack>
              {(["krx", "kry", "krz"] as const).map((axis) => <RibbonButton
                key={axis}
                icon={rotSpringIcon(axis.slice(2).toUpperCase())}
                label={t(`openFem3d.rotSpring${axis.slice(2).toUpperCase()}`)}
                size="small"
                active={openFem3dTool === `spring:${axis}`}
                onClick={() => onOpenFem3DSpringTool?.(axis)}
                disabled={!onOpenFem3DSpringTool}
                title={springPlacementTitle}
              />)}
            </RibbonButtonStack>
            {/* Scharnieren aan staafeinden (#93): een gereedschap per eind, en
                in één keer alle liggers scharnierend op hun kolommen. */}
            <RibbonButtonStack>
              <RibbonButton
                icon={beamEndHingeIcon}
                label={t("openFem3d.beamEndHinge")}
                size="small"
                active={openFem3dTool === "beamEndHinge"}
                onClick={() => onOpenFem3DToolChange?.("beamEndHinge")}
                disabled={!onOpenFem3DToolChange}
                title={t("openFem3d.beamEndHingeHint")}
              />
              <RibbonButton
                icon={pinBeamsToColumnsIcon}
                label={t("openFem3d.pinBeamsToColumns")}
                size="small"
                onClick={onOpenFem3DPinBeamsToColumns}
                disabled={!onOpenFem3DPinBeamsToColumns}
                title={t("openFem3d.pinBeamsToColumnsHint")}
              />
            </RibbonButtonStack>
          </> : <RibbonButtonStack>
            <RibbonButton
              icon={bcZSpringIcon}
              label={t("home.zSpring")}
              size="small"
              active={toolActive("addZSpring")}
              onClick={() => setTool("addZSpring")}
            />
            <RibbonButton
              icon={bcXSpringIcon}
              label={t("home.xSpring")}
              size="small"
              active={toolActive("addXSpring")}
              onClick={() => setTool("addXSpring")}
            />
            <RibbonButton
              icon={bcRotSpringIcon}
              label={t("home.rotSpring")}
              size="small"
              active={toolActive("addRotSpring")}
              onClick={() => setTool("addRotSpring")}
            />
          </RibbonButtonStack>}
        </RibbonGroup>

        {/* Loads — Point + Line large, rest stacked */}
        <RibbonGroup label={t("home.loads")}>
          {/* 3D (#77): met een geselecteerde staaf of knoop het formulier van
              de staafpuntlast of knooplast, zoals altijd; zonder selectie het
              gereedschap Puntlast (klik op een knoop of staaf). */}
          <RibbonButton
            icon={loadPointIcon}
            label={t("home.pointLoad")}
            shortcut={is3D ? undefined : toetsVoor("puntlast")}
            size="large"
            active={is3D ? openFem3dTool === "addPointLoad" : toolActive("addPointLoad")}
            onClick={() => is3D
              ? hasOpenFem3DBeamSelection && onOpenFem3DRequestMemberPointLoad
                ? onOpenFem3DRequestMemberPointLoad()
                : hasOpenFem3DNodeSelection && onOpenFem3DRequestNodalLoad
                  ? onOpenFem3DRequestNodalLoad("force")
                  : onOpenFem3DToolChange?.("addPointLoad")
              : setTool("addPointLoad")}
            disabled={is3D && !(
              (hasOpenFem3DNodeSelection && onOpenFem3DRequestNodalLoad) ||
              (hasOpenFem3DBeamSelection && onOpenFem3DRequestMemberPointLoad) ||
              onOpenFem3DToolChange
            )}
            title={is3D && !hasOpenFem3DBeamSelection && !hasOpenFem3DNodeSelection ? t("openFem3d.pointLoadPlacementHelp") : undefined}
          />
          <RibbonButton
            icon={loadLineIcon}
            label={t("home.lineLoad")}
            shortcut={is3D ? undefined : toetsVoor("lijnlast")}
            size="large"
            active={is3D ? openFem3dTool === "addMemberLoad" : toolActive("addLineLoad")}
            onClick={() => is3D ? onOpenFem3DRequestMemberLoad?.() : setTool("addLineLoad")}
            disabled={is3D && !onOpenFem3DRequestMemberLoad}
            title={is3D ? t("openFem3d.memberLoadPlacementHelp") : undefined}
          />
          {is3D && <RibbonButtonStack>
            <RibbonButton
              icon={loadPanelIcon}
              label={t("home.envelopePanel")}
              size="small"
              active={openFem3dTool === "addEnvelopePanel"}
              onClick={() => onOpenFem3DToolChange?.("addEnvelopePanel")}
              disabled={!onOpenFem3DToolChange}
              title={t("home.envelopePanelHint")}
            />
            <RibbonButton
              icon={loadPanelIcon}
              label={t("home.loadPanel")}
              size="small"
              active={openFem3dTool === "addLoadPanel"}
              onClick={() => onOpenFem3DToolChange?.("addLoadPanel")}
              disabled={!onOpenFem3DToolChange}
              title={t("home.loadPanelHint")}
            />
            <RibbonButton
              icon={plateIcon}
              label={t("home.plateToLoadPanel")}
              size="small"
              onClick={onOpenFem3DConvertPlateToLoadPanel}
              disabled={!hasOpenFem3DPlateSelection || !onOpenFem3DConvertPlateToLoadPanel}
              title={hasOpenFem3DPlateSelection ? t("home.plateToLoadPanelHint") : t("home.selectPlate3DFirst")}
            />
          </RibbonButtonStack>}
          <RibbonButtonStack>
            <RibbonButton
              icon={loadPointHIcon}
              label={t("home.pointLoadH")}
              size="small"
              active={!is3D && toolActive("addPointLoadH")}
              onClick={() => is3D ? onOpenFem3DRequestNodalLoad?.("force") : setTool("addPointLoadH")}
              disabled={is3D && (!hasOpenFem3DNodeSelection || !onOpenFem3DRequestNodalLoad)}
              title={is3D ? nodeConditionTitle : undefined}
            />
            <RibbonButton
              icon={loadMomentIcon}
              label={t("home.moment")}
              size="small"
              active={!is3D && toolActive("addMoment")}
              onClick={() => is3D ? onOpenFem3DRequestNodalLoad?.("moment") : setTool("addMoment")}
              disabled={is3D && (!hasOpenFem3DNodeSelection || !onOpenFem3DRequestNodalLoad)}
              title={is3D ? nodeConditionTitle : undefined}
            />
            <RibbonButton
              icon={loadTempIcon}
              label={t("home.temp")}
              size="small"
              active={!is3D && toolActive("addThermal")}
              onClick={() => is3D ? onOpenFem3DRequestThermalLoad?.() : setTool("addThermal")}
              disabled={is3D && (!hasOpenFem3DBeamSelection || !onOpenFem3DRequestThermalLoad)}
              title={is3D ? beamConditionTitle : undefined}
            />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton
              icon={loadCasesIcon}
              label={t("home.loadCases")}
              shortcut={toetsVoor("belastinggevallen")}
              size="small"
              onClick={onOpenLoadCases ?? stub("Load cases dialog (no handler)")}
              disabled={!onOpenLoadCases}
            />
            <RibbonButton
              icon={loadCombinationsIcon}
              label={t("home.combinations")}
              size="small"
              onClick={onOpenLoadCombinations ?? stub("Load combinations dialog (no handler)")}
              disabled={!onOpenLoadCombinations}
            />
            {/* Windbelastinggenerator — EN 1991-1-4 + Nederlandse NB. */}
            <RibbonButton
              icon={windGeneratorIcon}
              label={is3D ? t("home.generateEnvelopeLoads", "Schillasten genereren") : t("home.windGenerator")}
              size="small"
              onClick={onOpenWindGenerator ?? stub("Wind generator dialog (no handler)")}
              disabled={!onOpenWindGenerator}
            />
            <RibbonButton
              icon={waterAccumulationIcon}
              label={t("home.waterAccumulation")}
              size="small"
              onClick={onOpenWaterAccumulation ?? stub("Wateraccumulatie 2D")}
              disabled={is3D || !onOpenWaterAccumulation}
              title={is3D ? t("home.waterAccumulation2DOnly") : undefined}
            />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* Modify — Move/Rotate large, Undo/Redo/Copy stacked, + Delete */}
        <RibbonGroup label={t("home.modify")}>
          <RibbonButton
            icon={moveIcon}
            label={t("home.move")}
            size="large"
            active={toolActive("move")}
            onClick={() => setTool("move")}
            disabled={is3D && (!frameToolAvailable("move") || !canOpenFem3DDelete)}
            title={is3D && !frameToolAvailable("move") ? unsupported3D : undefined}
          />
          <RibbonButtonStack>
            <RibbonButton
              icon={rotateIcon}
              label={t("home.rotate")}
              size="small"
              active={toolActive("rotate")}
              onClick={() => setTool("rotate")}
              disabled={is3D && (!frameToolAvailable("rotate") || !canOpenFem3DDelete)}
              title={is3D && !frameToolAvailable("rotate") ? unsupported3D : undefined}
            />
            <RibbonButton
              icon={copyIcon}
              label={t("home.copy")}
              size="small"
              active={toolActive("copy")}
              onClick={() => setTool("copy")}
              disabled={is3D && (!frameToolAvailable("copy") || !canOpenFem3DDelete)}
              title={is3D && !frameToolAvailable("copy") ? unsupported3D : undefined}
            />
            <RibbonButton
              icon={mirrorIcon}
              label={t("home.mirror")}
              size="small"
              active={toolActive("mirror")}
              onClick={() => setTool("mirror")}
              disabled={is3D && (!frameToolAvailable("mirror") || !canOpenFem3DDelete)}
              title={is3D && !frameToolAvailable("mirror") ? unsupported3D : undefined}
            />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton
              icon={undoIcon}
              label={t("home.undo")}
              shortcut={toetsVoor("ongedaan")}
              size="small"
              onClick={() => onUndo?.()}
              disabled={!canUndo}
            />
            <RibbonButton
              icon={redoIcon}
              label={t("home.redo")}
              shortcut={toetsVoor("opnieuw")}
              size="small"
              onClick={() => onRedo?.()}
              disabled={!canRedo}
            />
            <RibbonButton
              icon={deleteIcon}
              label={t("common:delete")}
              shortcut={toetsVoor("verwijderen")}
              size="small"
              onClick={() => onDelete?.()}
              disabled={is3D && !canOpenFem3DDelete}
            />
          </RibbonButtonStack>
          {/* Knopen samenvoegen (#75): de selectie, of het hele model zonder selectie. */}
          {is3D && <RibbonButtonStack>
            <RibbonButton
              icon={mergeNodesIcon}
              label={t("openFem3d.mergeNodes")}
              size="small"
              onClick={onOpenFem3DMergeNodes}
              disabled={!onOpenFem3DMergeNodes}
              title={t("openFem3d.mergeNodesHint")}
            />
          </RibbonButtonStack>}
        </RibbonGroup>

        {/* Selectie — Filter (groot): het venster Selectiefilter, in 2D en 3D (issue #94). */}
        <RibbonGroup label={t("home.selection")}>
          <RibbonButton
            icon={filterIcon}
            label={t("home.filterSelection")}
            size="large"
            onClick={onFilterSelection ?? stub("Filter selection (no handler)")}
            title={t("home.filterSelectionHint")}
          />
        </RibbonGroup>

        {is3D && (
          <RibbonGroup label={t("openFem3d.viewGroup")}>
            <RibbonButton icon={fitIcon} label={t("openFem3d.fit")} onClick={onOpenFem3DFit} disabled={!onOpenFem3DFit} />
            <RibbonButtonStack>
              <RibbonButton icon={cubeIcon} label={t("openFem3d.isoView")} size="small" active={openFem3dView === "iso"} onClick={() => onOpenFem3DViewChange?.("iso")} disabled={!onOpenFem3DViewChange} />
              <RibbonButton icon={topIcon} label={t("openFem3d.topView")} size="small" active={openFem3dView === "top"} onClick={() => onOpenFem3DViewChange?.("top")} disabled={!onOpenFem3DViewChange} />
            </RibbonButtonStack>
            <RibbonButtonStack>
              <RibbonButton icon={frontIcon} label={t("openFem3d.frontView")} size="small" active={openFem3dView === "front"} onClick={() => onOpenFem3DViewChange?.("front")} disabled={!onOpenFem3DViewChange} />
              <RibbonButton icon={sideIcon} label={t("openFem3d.sideView")} size="small" active={openFem3dView === "side"} onClick={() => onOpenFem3DViewChange?.("side")} disabled={!onOpenFem3DViewChange} />
              <RibbonButton icon={zichtbaarheidIcon} label={t("openFem3d.visibility")} size="small" active={visibility3DOpen} onClick={onToggle3DVisibility} disabled={!onToggle3DVisibility} />
            </RibbonButtonStack>
            {/* Plaatweergave (issue #78): dezelfde keuze als onder Platen in Zichtbaarheid en de verkenner. */}
            <RibbonButtonStack>
              <RibbonButton icon={plateVolumeIcon} label={t("openFem3d.plateDisplayVolume")} title={t("openFem3d.plateDisplayVolumeHint")} size="small" active={openFem3dPlateDisplay === "volume"} onClick={() => onOpenFem3DPlateDisplayChange?.("volume")} disabled={!onOpenFem3DPlateDisplayChange} />
              <RibbonButton icon={plateSurfaceIcon} label={t("openFem3d.plateDisplaySurface")} title={t("openFem3d.plateDisplaySurfaceHint")} size="small" active={openFem3dPlateDisplay === "surface"} onClick={() => onOpenFem3DPlateDisplayChange?.("surface")} disabled={!onOpenFem3DPlateDisplayChange} />
              <RibbonButton icon={plateMeshIcon} label={t("openFem3d.plateDisplayMesh")} title={t("openFem3d.plateDisplayMeshHint")} size="small" active={openFem3dPlateDisplay === "mesh"} onClick={() => onOpenFem3DPlateDisplayChange?.("mesh")} disabled={!onOpenFem3DPlateDisplayChange} />
            </RibbonButtonStack>
            {/* Section box (issue #86): dezelfde schakelaar als in het menu ▾ van de view cube. */}
            <RibbonButtonStack>
              <RibbonButton icon={sectionBoxIcon} label={t("openFem3d.sectionBox")} title={t("openFem3d.sectionBoxHint")} size="small" active={openFem3dSectionBox} onClick={onOpenFem3DSectionBoxToggle} disabled={!onOpenFem3DSectionBoxToggle} />
              <RibbonButton icon={cubeIcon} label={t("openFem3d.explode")} size="small" active={openFem3dExploded} onClick={onOpenFem3DExplodeToggle} disabled={!onOpenFem3DExplodeToggle} />
            </RibbonButtonStack>
          </RibbonGroup>
        )}

        {/* De vroegere View-groep (Grafiek / Agent / Console) is verwijderd:
            de toggles zetten alleen App-state die nergens werd geconsumeerd —
            er bestond geen grafiek-split-, agent- of consolepaneel. */}
      </div>
    </div>
  );
}

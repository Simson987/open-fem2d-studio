import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";
import RibbonButtonStack from "./RibbonButtonStack";
import type { Frame3DTool, Frame3DView } from "../frame3d/frame3dCommands";
import type { Frame3DSupportPreset } from "../frame3d/frame3dModel";
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
  loadMomentIcon,
  loadTempIcon,
  loadCasesIcon,
  loadCombinationsIcon,
  windGeneratorIcon,
  moveIcon,
  rotateIcon,
  undoIcon,
  redoIcon,
  copyIcon,
  filterIcon,
  zichtbaarheidIcon,
} from "./icons";

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
  /** Quick filter: reduce current selection to one type only. */
  onFilterSelection?: () => void;
  /** Wired file-menu actions. */
  onNewProject?: () => void;
  onOpenProject?: () => void;
  onSaveProject?: () => void;
  onSaveProjectAs?: () => void;
  modelDimension?: "2d" | "3d";
  onConvertTo3D?: () => void;
  frame3dTool?: Frame3DTool;
  availableFrame3DTools?: readonly Frame3DTool[];
  onFrame3DToolChange?: (tool: Frame3DTool) => void;
  canFrame3DDelete?: boolean;
  onFrame3DFit?: () => void;
  onFrame3DViewChange?: (view: Frame3DView) => void;
  frame3dView?: Frame3DView;
  onToggle3DVisibility?: () => void;
  visibility3DOpen?: boolean;
  hasFrame3DNodeSelection?: boolean;
  hasFrame3DBeamSelection?: boolean;
  hasFrame3DPlateSelection?: boolean;
  onFrame3DSupportPreset?: (preset: Frame3DSupportPreset) => void;
  onFrame3DRequestSpring?: (axis: "kx" | "ky" | "kz" | "krx" | "kry" | "krz") => void;
  onFrame3DRequestNodalLoad?: (kind: "force" | "moment") => void;
  onFrame3DRequestMemberLoad?: () => void;
  onFrame3DRequestMemberPointLoad?: () => void;
  onFrame3DRequestThermalLoad?: () => void;
  onFrame3DRequestSurfaceLoad?: () => void;
}

const stub = (label: string) => () => console.log(`TODO: ${label}`);

// Reusable trash icon — there isn't one in icons.ts yet.
const deleteIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"/></svg>`;
const subnodeIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12h18M12 8v8"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>`;
const mirrorIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16M6 8l-3 4 3 4M18 8l3 4-3 4"/></svg>`;
const plateArcIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 19h16M4 19Q12 2 20 19"/><circle cx="4" cy="19" r="1.5" fill="currentColor" stroke="none"/><circle cx="20" cy="19" r="1.5" fill="currentColor" stroke="none"/></svg>`;
// Solve / "play" icon — used for the Berekenen button.
const solveIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3l14 9-14 9V3z"/></svg>`;
const cubeIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="1.8" stroke-linejoin="round" d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5m-9 5v10"/></svg>`;
const fitIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2" stroke-linecap="round" d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>`;
const topIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" stroke-width="2"/><path d="M12 4v16M4 12h16" stroke-width="1"/></svg>`;
const frontIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2" d="M4 20V4m0 16h16"/><path stroke-width="1.5" d="M7 17V9l5-4 5 4v8H7z"/></svg>`;
const sideIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2" d="M4 20V4m0 16h16"/><path stroke-width="1.5" d="M8 17V7h9v10H8z"/></svg>`;
const revoluteIcon = (axis: "X" | "Y" | "Z") => `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="1.8" stroke-linecap="round" d="M7 16a7 7 0 1 1 10 0"/><path stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="m6 12 1 4 4-1"/><circle cx="12" cy="12" r="2"/><text x="12" y="22" text-anchor="middle" fill="currentColor" stroke="none" font-size="6" font-family="sans-serif">${axis}</text></svg>`;
const yRollerIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="1.8" stroke-linejoin="round" d="M5 12h14l-7-7-7 7Z"/><circle cx="9" cy="16" r="2"/><circle cx="15" cy="16" r="2"/><path stroke-width="1.8" d="M4 20h16"/><text x="20" y="8" text-anchor="middle" fill="currentColor" stroke="none" font-size="6" font-family="sans-serif">Y</text></svg>`;

export default function HomeTab({
  onSettingsClick: _onSettingsClick,
  onProjectSettingsClick,
  femTool = "select",
  onFemToolChange,
  onDelete, onUndo, onRedo, canUndo, canRedo, onOpenGrids,
  onSolve, hasResults,
  onOpenLoadCases, onOpenLoadCombinations, onOpenWindGenerator, onNewProject, onOpenProject,
  onSaveProject, onSaveProjectAs,
  onFilterSelection,
  modelDimension = "2d", onConvertTo3D,
  frame3dTool = "select", availableFrame3DTools = ["select", "addNode", "addBeam", "addSubNode", "addPlate", "addPlateArc", "addOpening", "move", "rotate", "copy", "mirror"],
  onFrame3DToolChange, canFrame3DDelete,
  onFrame3DFit, onFrame3DViewChange, frame3dView = "iso",
  onToggle3DVisibility, visibility3DOpen,
  hasFrame3DNodeSelection, hasFrame3DBeamSelection, hasFrame3DPlateSelection, onFrame3DSupportPreset, onFrame3DRequestSpring,
  onFrame3DRequestNodalLoad, onFrame3DRequestMemberLoad, onFrame3DRequestMemberPointLoad, onFrame3DRequestThermalLoad, onFrame3DRequestSurfaceLoad,
}: HomeTabProps) {
  const { t } = useTranslation("ribbon");
  const is3D = modelDimension === "3d";
  const unsupported3D = t("home.notAvailable3D");
  const frameToolFor = (tool: import("../fem/femTypes").Tool): Frame3DTool | undefined => {
    if (tool === "select" || tool === "addNode" || tool === "addBeam" || tool === "addSubNode" ||
        tool === "addPlate" || tool === "addOpening" || tool === "move" || tool === "rotate" || tool === "copy" || tool === "mirror") return tool;
    return undefined;
  };
  const frameToolAvailable = (tool: import("../fem/femTypes").Tool) => {
    const mapped = frameToolFor(tool);
    return mapped !== undefined && availableFrame3DTools.includes(mapped);
  };
  const setTool = (tool: import("../fem/femTypes").Tool) => {
    if (!is3D) onFemToolChange?.(tool);
    else {
      const mapped = frameToolFor(tool);
      if (mapped && availableFrame3DTools.includes(mapped)) onFrame3DToolChange?.(mapped);
    }
  };
  const toolActive = (tool: import("../fem/femTypes").Tool) => is3D
    ? frameToolFor(tool) === frame3dTool
    : femTool === tool;
  const nodeConditionTitle = hasFrame3DNodeSelection ? undefined : t("frame3d.selectNodeFirst");
  const beamConditionTitle = hasFrame3DBeamSelection ? undefined : t("frame3d.selectBeamFirst", "Selecteer eerst een 3D-staaf.");

  return (
    <div className="ribbon-content">
      <div className="ribbon-groups">
        {/* Berekening — Berekenen (large primary action) */}
        <RibbonGroup label={t("home.calculation")}>
          <RibbonButton
            icon={solveIcon}
            label={t("home.solve")}
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
            size="large"
            onClick={onNewProject ?? stub("New project (no handler)")}
          />
          <RibbonButtonStack>
            <RibbonButton
              icon={fileOpenIcon}
              label={t("home.open")}
              size="small"
              onClick={onOpenProject ?? stub("Open project (no handler)")}
            />
            <RibbonButton
              icon={fileSaveIcon}
              label={t("home.save")}
              size="small"
              onClick={onSaveProject ?? stub("Save project (no handler)")}
            />
            <RibbonButton
              icon={fileSaveIcon}
              label={t("home.saveAs")}
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
            size="large"
            active={toolActive("addBeam")}
            onClick={() => setTool("addBeam")}
          />
          <RibbonButtonStack>
            <RibbonButton
              icon={nodeIcon}
              label={t("home.node")}
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
              size="small"
              active={toolActive("addPlate")}
              onClick={() => setTool("addPlate")}
              disabled={is3D && !frameToolAvailable("addPlate")}
              title={is3D ? "Teken rechte plaatranden; eindpunten worden automatisch als knoop gemaakt. Klik de eerste knoop om te sluiten." : undefined}
            />
            {is3D && <RibbonButton
              icon={plateArcIcon}
              label="Boogrand"
              size="small"
              active={frame3dTool === "addPlateArc"}
              onClick={() => onFrame3DToolChange?.("addPlateArc")}
              disabled={!availableFrame3DTools.includes("addPlateArc")}
              title="Klik een stuurpunt en daarna het boogeindpunt. Wissel tijdens dezelfde plaat tussen Lijn en Boogrand."
            />}
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton
              icon={openingIcon}
              label={t("home.opening")}
              size="small"
              active={toolActive("addOpening")}
              onClick={() => setTool("addOpening")}
              disabled={is3D && (!frameToolAvailable("addOpening") || !hasFrame3DPlateSelection)}
              title={is3D ? (hasFrame3DPlateSelection ? "Klik de hoekknopen en sluit door opnieuw op de eerste knoop te klikken." : "Selecteer eerst een 3D-plaat.") : undefined}
            />
          </RibbonButtonStack>
          <RibbonButtonStack>
            {is3D && <RibbonButton
              icon={loadLineIcon}
              label="Oppervlaktelast"
              size="small"
              onClick={onFrame3DRequestSurfaceLoad}
              disabled={!hasFrame3DPlateSelection || !onFrame3DRequestSurfaceLoad}
              title={hasFrame3DPlateSelection ? "Voeg een globale belasting in kN/m² toe." : "Selecteer eerst een 3D-plaat."}
            />}
            <RibbonButton
              icon={gridIcon}
              label={t("home.grids")}
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
            size="large"
            active={!is3D && toolActive("addPinned")}
            onClick={() => is3D ? onFrame3DSupportPreset?.("pinned") : setTool("addPinned")}
            disabled={is3D && (!hasFrame3DNodeSelection || !onFrame3DSupportPreset)}
            title={is3D ? nodeConditionTitle : undefined}
          />
          <RibbonButtonStack>
            <RibbonButton
              icon={bcXRollerIcon}
              label={t("home.xRoller")}
              size="small"
              active={!is3D && toolActive("addXRoller")}
              onClick={() => is3D ? onFrame3DSupportPreset?.("xRoller") : setTool("addXRoller")}
              disabled={is3D && (!hasFrame3DNodeSelection || !onFrame3DSupportPreset)}
              title={is3D ? nodeConditionTitle : undefined}
            />
            <RibbonButton
              icon={bcZRollerIcon}
              label={t("home.zRoller")}
              size="small"
              active={!is3D && toolActive("addZRoller")}
              onClick={() => is3D ? onFrame3DSupportPreset?.("zRoller") : setTool("addZRoller")}
              disabled={is3D && (!hasFrame3DNodeSelection || !onFrame3DSupportPreset)}
              title={is3D ? nodeConditionTitle : undefined}
            />
            {is3D && <RibbonButton
              icon={yRollerIcon}
              label={t("frame3d.yRoller", "Y-rol")}
              size="small"
              onClick={() => onFrame3DSupportPreset?.("yRoller")}
              disabled={!hasFrame3DNodeSelection || !onFrame3DSupportPreset}
              title={nodeConditionTitle}
            />}
            <RibbonButton
              icon={bcFixedIcon}
              label={t("home.fixed")}
              size="small"
              active={!is3D && toolActive("addFixed")}
              onClick={() => is3D ? onFrame3DSupportPreset?.("fixed") : setTool("addFixed")}
              disabled={is3D && (!hasFrame3DNodeSelection || !onFrame3DSupportPreset)}
              title={is3D ? nodeConditionTitle : undefined}
            />
          </RibbonButtonStack>
          {is3D && <RibbonButtonStack>
            {(["X", "Y", "Z"] as const).map((axis) => {
              const preset = `revolute${axis}` as Frame3DSupportPreset;
              return <RibbonButton
                key={axis}
                icon={revoluteIcon(axis)}
                label={t(`frame3d.revolute${axis}`)}
                size="small"
                onClick={() => onFrame3DSupportPreset?.(preset)}
                disabled={!hasFrame3DNodeSelection || !onFrame3DSupportPreset}
                title={hasFrame3DNodeSelection ? t("frame3d.revoluteHint", { axis }) : nodeConditionTitle}
              />;
            })}
          </RibbonButtonStack>}
          <RibbonButtonStack>
            <RibbonButton
              icon={bcZSpringIcon}
              label={t("home.zSpring")}
              size="small"
              active={!is3D && toolActive("addZSpring")}
              onClick={() => is3D ? onFrame3DRequestSpring?.("kz") : setTool("addZSpring")}
              disabled={is3D && (!hasFrame3DNodeSelection || !onFrame3DRequestSpring)}
              title={is3D ? nodeConditionTitle : undefined}
            />
            <RibbonButton
              icon={bcXSpringIcon}
              label={t("home.xSpring")}
              size="small"
              active={!is3D && toolActive("addXSpring")}
              onClick={() => is3D ? onFrame3DRequestSpring?.("kx") : setTool("addXSpring")}
              disabled={is3D && (!hasFrame3DNodeSelection || !onFrame3DRequestSpring)}
              title={is3D ? nodeConditionTitle : undefined}
            />
            <RibbonButton
              icon={bcRotSpringIcon}
              label={t("home.rotSpring")}
              size="small"
              active={!is3D && toolActive("addRotSpring")}
              onClick={() => is3D ? onFrame3DRequestSpring?.("kry") : setTool("addRotSpring")}
              disabled={is3D && (!hasFrame3DNodeSelection || !onFrame3DRequestSpring)}
              title={is3D ? nodeConditionTitle : undefined}
            />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* Loads — Point + Line large, rest stacked */}
        <RibbonGroup label={t("home.loads")}>
          <RibbonButton
            icon={loadPointIcon}
            label={t("home.pointLoad")}
            size="large"
            active={!is3D && toolActive("addPointLoad")}
            onClick={() => is3D
              ? hasFrame3DBeamSelection
                ? onFrame3DRequestMemberPointLoad?.()
                : onFrame3DRequestNodalLoad?.("force")
              : setTool("addPointLoad")}
            disabled={is3D && !(
              (hasFrame3DNodeSelection && onFrame3DRequestNodalLoad) ||
              (hasFrame3DBeamSelection && onFrame3DRequestMemberPointLoad)
            )}
            title={is3D ? (hasFrame3DBeamSelection ? beamConditionTitle : nodeConditionTitle) : undefined}
          />
          <RibbonButton
            icon={loadLineIcon}
            label={t("home.lineLoad")}
            size="large"
            active={!is3D && toolActive("addLineLoad")}
            onClick={() => is3D ? onFrame3DRequestMemberLoad?.() : setTool("addLineLoad")}
            disabled={is3D && (!hasFrame3DBeamSelection || !onFrame3DRequestMemberLoad)}
            title={is3D ? beamConditionTitle : undefined}
          />
          <RibbonButtonStack>
            <RibbonButton
              icon={loadPointHIcon}
              label={t("home.pointLoadH")}
              size="small"
              active={!is3D && toolActive("addPointLoadH")}
              onClick={() => is3D ? onFrame3DRequestNodalLoad?.("force") : setTool("addPointLoadH")}
              disabled={is3D && (!hasFrame3DNodeSelection || !onFrame3DRequestNodalLoad)}
              title={is3D ? nodeConditionTitle : undefined}
            />
            <RibbonButton
              icon={loadMomentIcon}
              label={t("home.moment")}
              size="small"
              active={!is3D && toolActive("addMoment")}
              onClick={() => is3D ? onFrame3DRequestNodalLoad?.("moment") : setTool("addMoment")}
              disabled={is3D && (!hasFrame3DNodeSelection || !onFrame3DRequestNodalLoad)}
              title={is3D ? nodeConditionTitle : undefined}
            />
            <RibbonButton
              icon={loadTempIcon}
              label={t("home.temp")}
              size="small"
              active={!is3D && toolActive("addThermal")}
              onClick={() => is3D ? onFrame3DRequestThermalLoad?.() : setTool("addThermal")}
              disabled={is3D && (!hasFrame3DBeamSelection || !onFrame3DRequestThermalLoad)}
              title={is3D ? beamConditionTitle : undefined}
            />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton
              icon={loadCasesIcon}
              label={t("home.loadCases")}
              size="small"
              onClick={onOpenLoadCases ?? stub("Load cases dialog (no handler)")}
              disabled={is3D}
              title={is3D ? unsupported3D : undefined}
            />
            <RibbonButton
              icon={loadCombinationsIcon}
              label={t("home.combinations")}
              size="small"
              onClick={onOpenLoadCombinations ?? stub("Load combinations dialog (no handler)")}
              disabled={is3D}
              title={is3D ? unsupported3D : undefined}
            />
            {/* Windbelastinggenerator — EN 1991-1-4 + Nederlandse NB. */}
            <RibbonButton
              icon={windGeneratorIcon}
              label={t("home.windGenerator")}
              size="small"
              onClick={onOpenWindGenerator ?? stub("Wind generator dialog (no handler)")}
              disabled={is3D}
              title={is3D ? unsupported3D : undefined}
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
            disabled={is3D && (!frameToolAvailable("move") || !canFrame3DDelete)}
            title={is3D && !frameToolAvailable("move") ? unsupported3D : undefined}
          />
          <RibbonButtonStack>
            <RibbonButton
              icon={rotateIcon}
              label={t("home.rotate")}
              size="small"
              active={toolActive("rotate")}
              onClick={() => setTool("rotate")}
              disabled={is3D && (!frameToolAvailable("rotate") || !canFrame3DDelete)}
              title={is3D && !frameToolAvailable("rotate") ? unsupported3D : undefined}
            />
            <RibbonButton
              icon={copyIcon}
              label={t("home.copy")}
              size="small"
              active={toolActive("copy")}
              onClick={() => setTool("copy")}
              disabled={is3D && (!frameToolAvailable("copy") || !canFrame3DDelete)}
              title={is3D && !frameToolAvailable("copy") ? unsupported3D : undefined}
            />
            <RibbonButton
              icon={mirrorIcon}
              label={t("home.mirror")}
              size="small"
              active={toolActive("mirror")}
              onClick={() => setTool("mirror")}
              disabled={is3D && (!frameToolAvailable("mirror") || !canFrame3DDelete)}
              title={is3D && !frameToolAvailable("mirror") ? unsupported3D : undefined}
            />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton
              icon={undoIcon}
              label={t("home.undo")}
              size="small"
              onClick={() => onUndo?.()}
              disabled={!canUndo}
            />
            <RibbonButton
              icon={redoIcon}
              label={t("home.redo")}
              size="small"
              onClick={() => onRedo?.()}
              disabled={!canRedo}
            />
            <RibbonButton
              icon={deleteIcon}
              label={t("common:delete")}
              size="small"
              onClick={() => onDelete?.()}
              disabled={is3D && !canFrame3DDelete}
            />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* Selection — Filter (large) */}
        <RibbonGroup label={t("home.selection")}>
          <RibbonButton
            icon={filterIcon}
            label={t("home.filterSelection")}
            size="large"
            onClick={onFilterSelection ?? stub("Filter selection (no handler)")}
            disabled={is3D}
            title={is3D ? unsupported3D : undefined}
          />
        </RibbonGroup>

        {is3D && (
          <RibbonGroup label={t("frame3d.viewGroup")}>
            <RibbonButton icon={fitIcon} label={t("frame3d.fit")} onClick={onFrame3DFit} disabled={!onFrame3DFit} />
            <RibbonButtonStack>
              <RibbonButton icon={cubeIcon} label={t("frame3d.isoView")} size="small" active={frame3dView === "iso"} onClick={() => onFrame3DViewChange?.("iso")} disabled={!onFrame3DViewChange} />
              <RibbonButton icon={topIcon} label={t("frame3d.topView")} size="small" active={frame3dView === "top"} onClick={() => onFrame3DViewChange?.("top")} disabled={!onFrame3DViewChange} />
            </RibbonButtonStack>
            <RibbonButtonStack>
              <RibbonButton icon={frontIcon} label={t("frame3d.frontView")} size="small" active={frame3dView === "front"} onClick={() => onFrame3DViewChange?.("front")} disabled={!onFrame3DViewChange} />
              <RibbonButton icon={sideIcon} label={t("frame3d.sideView")} size="small" active={frame3dView === "side"} onClick={() => onFrame3DViewChange?.("side")} disabled={!onFrame3DViewChange} />
              <RibbonButton icon={zichtbaarheidIcon} label={t("frame3d.visibility")} size="small" active={visibility3DOpen} onClick={onToggle3DVisibility} disabled={!onToggle3DVisibility} />
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

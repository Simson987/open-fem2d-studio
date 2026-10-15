import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ThreeFrameCanvas from "./ThreeFrameCanvas";
import OpenFem3DVisibilityDialog from "./OpenFem3DVisibilityDialog";
import { readOpenFem3DVisibility, saveOpenFem3DVisibility, type OpenFem3DVisibility } from "./openFem3dVisibility";
import type { OpenFem3DTool, OpenFem3DView } from "./openFem3dCommands";
import { verwerkToets, type Prefix } from "../../lib/commandoReeks";
import {
  openFem3DLoadCaseId,
  removeOpenFem3DSelection,
  type OpenFem3DModel,
} from "./openFem3dModel";
import { isInvoerVeld } from "../../lib/escapeToets";
import { erIsEenDialoogOpen } from "../Modal";
import type { StructuralGrid } from "../fem/femTypes";
import { OPEN_FEM_3D_PLATES_LINEAR_NOTICE, openFem3DPlateMeshFor, type OpenFem3DSolveResult } from "./openFem3dSolver";
import type { OpenFem3DPlateMesh } from "./openFem3dPlateMesh";
import {
  formatOpenFem3DPlateValue, openFem3DContourGradientCss, openFem3DPlateQuantity, openFem3DPlateQuantityRange,
  type OpenFem3DPlateQuantity,
} from "./openFem3dPlateResults";
import { openFem3DMaximumDisplacementM } from "./openFem3dDisplacement";
import type { OpenFem3DSteelChecks } from "./openFem3dSteelCheck";
import type { OpenFem3DConcreteChecks } from "./openFem3dConcreteCheck";
import { buildOpenFem3DUtilizations } from "./openFem3dUtilization";
import type { OpenFem3DTimberChecks } from "./openFem3dTimberCheck";
import { openFem3DStaalgewicht } from "./openFem3dStaalgewicht";
import OpenFem3DTransformPanel from "./OpenFem3DTransformPanel";
import { transformOpenFem3D, type OpenFem3DTransformCommand } from "./openFem3dTransform";
import { openFem3DCopyPointStep } from "./openFem3dCopyPoints";
import type { Punt3 } from "./openFem3dTekenhulp";
import { openFem3DBeddingRefusal } from "./openFem3dBedding";
import {
  OPEN_FEM_3D_LOAD_SELECTION_TYPES, openFem3DSelectionFromIds, openFem3DSelectionGeometryCount,
  type OpenFem3DLoadIds, type OpenFem3DLoadSelectionType, type OpenFem3DSelection,
} from "./openFem3dSelection";
import type { OpenFem3DCameraState, OpenFem3DViewSet } from "./openFem3dViewSets";
import { openFem3DStartCamera } from "./openFem3dViewCube";
import type { OpenFem3DEditMeta } from "./openFem3dHistory";
import type { OpenFem3DNodeTarget } from "./openFem3dNodeTools";
import type { OpenFem3DPointLoadTarget } from "./openFem3dPlaatsen";
import type { OpenFem3DDeformationDisplay } from "./openFem3dDeformationDisplay";
import type { OpenFem3DDiagramLabels } from "./openFem3dDiagramLabels";
import { openFem3DWorkLevel, openFem3DWorkPlaneIsHorizontal, openFem3DWorkPlaneOptions } from "./openFem3dWorkPlane";
import { openFem3DLevelName } from "./openFem3dLevels";
import OpenFem3DEnvelopeGridPanel from "./OpenFem3DEnvelopeGridPanel";
import { addOpenFem3DEnvelopePanelFromGrid } from "./openFem3dEnvelopePanels";
import {
  OPEN_FEM_3D_EXPLODE_MODES, isOpenFem3DExplodeMode, openFem3DExplodedGrid, openFem3DExplodedMesh, openFem3DExplodedModel,
  openFem3DExplodedResult, openFem3DExplodeSourceSelection, type OpenFem3DExplode,
} from "./openFem3dExplode";
import { DEFAULT_OPEN_FEM_3D_SECTION_BOX } from "./openFem3dSectionBox";
import { toonMm } from "../../lib/lengthInput";
import { openFem3DProfielKleuring, profielKleurenActief3d } from "../../lib/profielKleur";
import ProfielKleurLegenda from "../fem/ProfielKleurLegenda";
import OpenFem3DModelCheck from "./OpenFem3DModelCheck";
import {
  openFem3DConnectButton, openFem3DConnectCheck, openFem3DSelectionAfterAutoEdit, type OpenFem3DAutoEditStep,
} from "./openFem3dAansluiten";
import { openFem3DMergeButton, openFem3DMergeCheck } from "./openFem3dSamenvoegen";
import { useSnapInstellingen } from "../../hooks/useSnapInstellingen";
import "./OpenFem3DEditor.css";

const DRAW_HELP_KEYS: Partial<Record<OpenFem3DTool, string>> = {
  addNode: "openFem3d.nodeHelp",
  addBeam: "openFem3d.beamHelp",
  addPlate: "openFem3d.plateHelp",
  addPlateArc: "openFem3d.plateArcHelp",
  addOpening: "openFem3d.openingHelp",
  addOpeningArc: "openFem3d.openingArcHelp",
  addMemberLoad: "openFem3d.memberLoadPlacementHelp",
  addPointLoad: "openFem3d.pointLoadPlacementHelp",
  addLoadPanel: "openFem3d.loadPanelHelp",
  addEnvelopePanel: "openFem3d.envelopePanelHelp",
  loadPanelSpan: "openFem3d.loadPanelSpanHelp",
  beamEndHinge: "openFem3d.beamEndHingeHelp",
};

interface Props {
  model: OpenFem3DModel;
  calculationModel?: OpenFem3DModel;
  /**
   * Een modelwijziging. Voegt de app daarbij knopen samen (issue #75) of sluit
   * hij knopen op staven aan (issue #63), dan geeft hij de stap terug: een
   * transformatie zet haar selectie dan op de knoop waarin een verplaatste
   * knoop opging en op alle delen van een gesplitste staaf.
   */
  onChange: (model: OpenFem3DModel, meta?: OpenFem3DEditMeta) => OpenFem3DAutoEditStep | null | void;
  visibilityOpen?: boolean;
  onVisibilityOpen?: () => void;
  onVisibilityClose?: () => void;
  tool?: OpenFem3DTool;
  onToolChange?: (tool: OpenFem3DTool) => void;
  /** Oplegging- of veergereedschap: klik op een knoop, staaf, plaat of in leeg canvas (werkvlak). */
  onPlaceNodeCondition?: (target: OpenFem3DNodeTarget) => void;
  /** Puntlastgereedschap: klik op een knoop (knooplast) of op een staaf (staafpuntlast op die plek). */
  onPlacePointLoad?: (target: OpenFem3DPointLoadTarget) => void;
  /** Vergroting van de vervormde vorm en het onvervormde model erachter. */
  deformationDisplay?: OpenFem3DDeformationDisplay;
  /** Getallen bij de snedekrachtlijnen (Waarden, weinig … veel); ook mee in een view uit het venster Views. */
  diagramLabels?: OpenFem3DDiagramLabels;
  deleteToken?: number;
  fitRequest?: number;
  viewRequest?: { kind: OpenFem3DView; token: number };
  onCameraViewChange?: (view: OpenFem3DView) => void;
  initialCamera?: OpenFem3DCameraState | null;
  onCameraStateChange?: (state: OpenFem3DCameraState) => void;
  selection?: OpenFem3DSelection;
  onSelectionChange?: (selection: OpenFem3DSelection) => void;
  onOpenCheckForBeam?: (beamId: number) => void;
  visibility?: OpenFem3DVisibility;
  onVisibilityChange?: (visibility: OpenFem3DVisibility) => void;
  showLoadCase?: boolean;
  resultsActive?: boolean;
  structuralGrid?: StructuralGrid;
  gridSpacingM?: number;
  result?: OpenFem3DSolveResult | null;
  /** Grootheid van de plaatcontour; `null` = geen contour. */
  plateQuantity?: OpenFem3DPlateQuantity | null;
  checks?: OpenFem3DSteelChecks | null;
  concreteChecks?: OpenFem3DConcreteChecks | null;
  timberChecks?: OpenFem3DTimberChecks | null;
  solving?: boolean;
  solveError?: string | null;
  activeLoadCaseId?: number;
  viewSets?: OpenFem3DViewSet[];
  currentView?: OpenFem3DView;
  currentCombinationId?: number | null;
  combinationOptions?: { id: number; name: string }[];
  loadCaseOptions?: { id: number; name: string }[];
  onViewSetsChange?: (viewSets: OpenFem3DViewSet[]) => void;
  onApplyViewSet?: (viewSet: OpenFem3DViewSet) => void;
  /** Een camera van buiten (een eigen view uit de verkenner, tab Views); elke nieuwe token past hem toe. */
  cameraVerzoek?: { state: OpenFem3DCameraState; token: number };
  /** Soort per belastinggeval, voor de kleur van de lastvlakken. */
  loadCaseTypes?: ReadonlyMap<number, string>;
  /**
   * De knop Aansluiten in de modelcontrole (issue #63): knopen op staven
   * aansluiten in het hele model, met de melding. Zonder: hier zelf, één
   * modelwijziging via `onChange`.
   */
  onConnectNodes?: () => void;
  /**
   * De knop Samenvoegen in de modelcontrole (issue #75): samenvallende knopen
   * samenvoegen in het hele model, met de melding. Zonder: hier zelf, één
   * modelwijziging via `onChange`.
   */
  onMergeNodes?: () => void;
  /** Elke nieuwe waarde klapt de modelcontrole open (Berekenen met losse knopen). */
  modelCheckToken?: number;
}

/** Canvas only: 3D uses the shared ribbon, Explorer and Properties panels. */
export default function OpenFem3DEditor({
  model, calculationModel, onChange, visibilityOpen = false, onVisibilityOpen, onVisibilityClose,
  tool = "select", onToolChange, onPlaceNodeCondition, onPlacePointLoad, deformationDisplay, diagramLabels, deleteToken = 0, fitRequest = 0, viewRequest, onCameraViewChange,
  initialCamera, onCameraStateChange,
  selection: controlledSelection, onSelectionChange, onOpenCheckForBeam,
  visibility: visibilityProp, onVisibilityChange, showLoadCase = true, resultsActive = false, structuralGrid, gridSpacingM,
  result = null, plateQuantity = null, checks = null, concreteChecks = null, timberChecks = null,
  solving = false, solveError = null, activeLoadCaseId,
  viewSets = [], currentView = "iso", currentCombinationId = null, combinationOptions = [], loadCaseOptions = [],
  onViewSetsChange, onApplyViewSet, cameraVerzoek, loadCaseTypes, onConnectNodes, onMergeNodes, modelCheckToken = 0,
}: Props) {
  const { t, i18n } = useTranslation("ribbon");
  const [internalSelection, setInternalSelection] = useState<OpenFem3DSelection>(null);
  const selection = controlledSelection === undefined ? internalSelection : controlledSelection;
  const setSelection = (next: OpenFem3DSelection) => {
    if (controlledSelection === undefined) setInternalSelection(next);
    onSelectionChange?.(next);
  };
  const [fitToken, setFitToken] = useState(0);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [copyAnchor, setCopyAnchor] = useState<Punt3 | null>(null);
  // Het actieve level voor tekenen; null = het level op peil 0, of peil 0 zelf.
  const [workLevelId, setWorkLevelId] = useState<string | null>(null);
  const levels = structuralGrid?.zAxes ?? [];
  const workLevel = openFem3DWorkLevel(levels, workLevelId);
  const workPlaneOptions = openFem3DWorkPlaneOptions(levels);
  const [internalVisibility, setInternalVisibility] = useState(readOpenFem3DVisibility);
  const [cameraState, setCameraState] = useState<OpenFem3DCameraState>(() => initialCamera ?? openFem3DStartCamera());
  const [cameraRequest, setCameraRequest] = useState<{ state: OpenFem3DCameraState; token: number } | undefined>(
    initialCamera ? { state: initialCamera, token: 1 } : undefined,
  );
  const visibility = visibilityProp ?? internalVisibility;
  const [animatedExplodeAmount, setAnimatedExplodeAmount] = useState(visibility.explode.amountM);
  const previousExplodeAmount = useRef(visibility.explode.amountM);
  useEffect(() => {
    const target = visibility.explode.amountM;
    const enter = previousExplodeAmount.current === 0 && target > 0;
    previousExplodeAmount.current = target;
    if (!enter || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setAnimatedExplodeAmount(target);
      return;
    }
    let timer = 0;
    let steps = 0;
    const tick = () => {
      const progress = ++steps / 8;
      setAnimatedExplodeAmount(target * (1 - (1 - progress) ** 3));
      if (progress < 1) timer = window.setTimeout(tick, 50);
    };
    timer = window.setTimeout(tick, 50);
    return () => clearTimeout(timer);
  }, [visibility.explode.amountM]);
  const exploded = visibility.explode.amountM > 0 || animatedExplodeAmount > 0;
  // Per level of per elementsoort (issue #198); de animatie loopt over de afstand.
  const explodeMode = visibility.explode.mode;
  const animatedExplode = useMemo<OpenFem3DExplode>(
    () => ({ mode: explodeMode, amountM: animatedExplodeAmount }), [explodeMode, animatedExplodeAmount]);
  // Een ander gereedschap, een andere selectie, een gewijzigd model of de
  // explodeweergave aan of uit: het bronpunt van kopiëren met punten vervalt.
  useEffect(() => { setCopyAnchor(null); }, [tool, selection, model, exploded]);
  const displayModel = useMemo(
    () => openFem3DExplodedModel(model, levels, animatedExplode),
    [model, levels, animatedExplode],
  );
  const displayConditionModel = useMemo(
    () => calculationModel ? openFem3DExplodedModel(calculationModel, levels, animatedExplode) : undefined,
    [calculationModel, levels, animatedExplode],
  );
  const displayGrid = useMemo(() => openFem3DExplodedGrid(structuralGrid, animatedExplode),
    [structuralGrid, animatedExplode]);
  const displayResult = useMemo(() => openFem3DExplodedResult(result, model, displayModel, levels, animatedExplode),
    [result, model, displayModel, levels, animatedExplode]);
  // Model: geen belastingen. Resultaten: ook geen ingevoerde belastingen, net
  // als in 2D; dan staan alleen de uitkomsten (vervorming, reacties, M/V/N, UC)
  // in beeld. Belastinggeval: de belastingen met hun labels.
  const canvasVisibility = useMemo(
    () => ({ ...visibility,
      ...(!showLoadCase || resultsActive ? { loads: false } : {}),
      ...(exploded ? { sectionBox: DEFAULT_OPEN_FEM_3D_SECTION_BOX } : {}),
    }),
    [showLoadCase, resultsActive, visibility, exploded],
  );
  // Modelcontrole (issue #63): knopen die op een staaf liggen zonder eraan
  // vast te zitten, live met het model en de verbindingstolerantie (dezelfde
  // instelling als in 2D). Ook direct na het openen van een oud project: het
  // model verandert dan niet stil, de controle meldt het met een knop. Een
  // knoop die Aansluiten niet kan aansluiten (overlappende staven, te dicht
  // bij een ander knippunt) krijgt zijn reden; kan geen enkele, dan staat de
  // knop uit.
  const { verbindingsTolerantie } = useSnapInstellingen();
  const modelControle = useMemo(
    () => openFem3DConnectCheck(model, verbindingsTolerantie),
    [model.nodes, model.beams, verbindingsTolerantie],
  );
  const sluitKnopenAan = onConnectNodes ?? (() => {
    const stap = openFem3DConnectButton(model, null, { verbindingsTolerantie }, "model");
    if (stap.model !== model) onChange(stap.model);
  });
  // Samenvallende knopen (issue #75), in dezelfde modelcontrole: de groepen
  // binnen de verbindingstolerantie, met de reden als Samenvoegen een groep
  // niet kan samenvoegen. Een proef zonder lasten; alleen wat bepaalt of een
  // groep doorgaat, staat in de afhankelijkheden.
  const samenvoegControle = useMemo(
    () => openFem3DMergeCheck(model, verbindingsTolerantie),
    [model.nodes, model.beams, model.plates, model.supports, model.diaphragms, model.loadPanels, verbindingsTolerantie],
  );
  const voegKnopenSamen = onMergeNodes ?? (() => {
    const stap = openFem3DMergeButton(model, null, { verbindingsTolerantie }, "model");
    if (stap.model !== model) onChange(stap.model);
  });
  // Staalgewicht (ρ·A·L per stalen staaf) voor de onderrand van het venster.
  const staalgewicht = useMemo(() => openFem3DStaalgewicht(model), [model.nodes, model.beams]);
  const kgTekst = (kg: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(kg);
  const staalTitel = [
    t("openFem3d.steelWeightTitle"),
    ...staalgewicht.perProfiel.slice(0, 12).map((p) =>
      `${p.profiel} ${p.staalsoort}: ${p.aantal}× · ${p.lengteM.toLocaleString(i18n.language, { maximumFractionDigits: 1 })} m · ${kgTekst(p.kg)} kg`),
    ...(staalgewicht.perProfiel.length > 12 ? ["…"] : []),
    ...(staalgewicht.onbekend.length > 0 ? [t("openFem3d.steelWeightUnknown", { count: staalgewicht.onbekend.length })] : []),
  ].join("\n");
  const lastDeleteToken = useRef(deleteToken);
  const setVisibility = (next: OpenFem3DVisibility) => {
    if (onVisibilityChange) onVisibilityChange(next);
    else setInternalVisibility(next);
  };

  useEffect(() => { saveOpenFem3DVisibility(visibility); }, [visibility]);
  // Na het passend beeld van de view (viewRequest) de exacte camera van de view.
  // Alleen een NIEUW verzoek: na opnieuw openen van de werkruimte geldt de
  // laatst bekende camera (initialCamera), niet een oud verzoek.
  const cameraVerzoekToken = useRef(cameraVerzoek?.token);
  useEffect(() => {
    if (!cameraVerzoek || cameraVerzoek.token === cameraVerzoekToken.current) return;
    cameraVerzoekToken.current = cameraVerzoek.token;
    setCameraRequest((previous) => ({ state: cameraVerzoek.state, token: (previous?.token ?? 0) + 1 }));
  }, [cameraVerzoek?.token]);
  useEffect(() => {
    if (!selection) return;
    const loadInActiveCase = (load: { caseId?: number }) =>
      showLoadCase && (activeLoadCaseId === undefined || openFem3DLoadCaseId(load) === activeLoadCaseId);
    if (selection.type === "multi") {
      const nodeIds = selection.nodeIds.filter((id) => model.nodes.some((node) => node.id === id));
      const beamIds = selection.beamIds.filter((id) => model.beams.some((beam) => beam.id === id));
      const plateIds = (selection.plateIds ?? []).filter((id) => (model.plates ?? []).some((plate) => plate.id === id));
      // Lasten uit het selectiefilter (issue #94) blijven staan zolang ze
      // bestaan, ook in een ander belastinggeval: de groep is één keuze.
      const loadsOfType: Record<OpenFem3DLoadSelectionType, readonly { id: number }[] | undefined> = {
        nodalLoad: model.loads, memberLoad: model.memberLoads, memberPointLoad: model.memberPointLoads,
        thermalLoad: model.thermalLoads, surfaceLoad: model.surfaceLoads, loadPanel: model.loadPanels,
      };
      const loads: OpenFem3DLoadIds = {};
      let loadsChanged = false;
      for (const type of OPEN_FEM_3D_LOAD_SELECTION_TYPES) {
        const chosen = selection.loads?.[type];
        if (!chosen?.length) continue;
        const present = new Set((loadsOfType[type] ?? []).map((load) => load.id));
        const kept = chosen.filter((id) => present.has(id));
        if (kept.length !== chosen.length) loadsChanged = true;
        if (kept.length) loads[type] = kept;
      }
      if (loadsChanged || nodeIds.length !== selection.nodeIds.length || beamIds.length !== selection.beamIds.length || plateIds.length !== (selection.plateIds?.length ?? 0)) {
        setSelection(openFem3DSelectionFromIds({ nodeIds, beamIds, plateIds, loads }));
      }
      return;
    }
    const exists = selection.type === "node" ? model.nodes.some((node) => node.id === selection.id)
      : selection.type === "beam" ? model.beams.some((beam) => beam.id === selection.id)
      : selection.type === "nodalLoad" ? (model.loads ?? []).some((load) => load.id === selection.id && loadInActiveCase(load))
      : selection.type === "memberLoad" ? (model.memberLoads ?? []).some((load) => load.id === selection.id && loadInActiveCase(load))
      : selection.type === "memberPointLoad" ? (model.memberPointLoads ?? []).some((load) => load.id === selection.id && loadInActiveCase(load))
      : selection.type === "thermalLoad" ? (model.thermalLoads ?? []).some((load) => load.id === selection.id && loadInActiveCase(load))
      : selection.type === "plate" ? (model.plates ?? []).some((plate) => plate.id === selection.id)
      : selection.type === "envelopePanel" ? (model.envelopePanels ?? []).some((panel) => panel.id === selection.id)
      : selection.type === "loadPanel" ? (model.loadPanels ?? []).some((panel) => panel.id === selection.id && loadInActiveCase(panel))
      : (model.surfaceLoads ?? []).some((load) => load.id === selection.id && loadInActiveCase(load));
    if (!exists) setSelection(null);
  }, [model.nodes, model.beams, model.plates, model.envelopePanels, model.loads, model.memberLoads, model.memberPointLoads, model.thermalLoads, model.surfaceLoads, model.loadPanels, selection, showLoadCase, activeLoadCaseId]);

  // Verwijderen via de lintknop (deleteToken) of de Delete-toets: dezelfde
  // bewerking, één stap in de historie (Ctrl+Z zet alles terug).
  const deleteSelection = () => {
    if (!selection) return;
    onChange(removeOpenFem3DSelection(model, selection));
    setSelection(null);
  };
  const deleteSelectionRef = useRef(deleteSelection);
  deleteSelectionRef.current = deleteSelection;
  useEffect(() => {
    if (deleteToken === lastDeleteToken.current) return;
    lastDeleteToken.current = deleteToken;
    deleteSelection();
  }, [deleteToken]);

  // Het rekennet voor de plaatweergave "mesh" (issue #78) zonder resultaat:
  // asynchroon (Triangle) en met een korte vertraging, zodat slepen niet elke
  // tussenstap meshed.
  const [displayMesh, setDisplayMesh] = useState<OpenFem3DPlateMesh | null>(null);
  const [meshMessage, setMeshMessage] = useState<string | null>(null);
  const needsDisplayMesh = visibility.plateDisplay === "mesh" && visibility.plates && (model.plates ?? []).length > 0 && !result?.plateMesh;
  const displayPlateMesh = useMemo(() => openFem3DExplodedMesh(
    needsDisplayMesh ? displayMesh : null, model, levels, animatedExplode),
  [needsDisplayMesh, displayMesh, model, levels, animatedExplode]);
  useEffect(() => {
    if (!needsDisplayMesh) { setMeshMessage(null); return; }
    let cancelled = false;
    setMeshMessage(t("openFem3dPlate.meshPending", { ns: "common" }));
    const timer = window.setTimeout(() => {
      const pending = openFem3DPlateMeshFor(model);
      if (!pending) return;
      pending.then((mesh) => {
        if (cancelled) return;
        setDisplayMesh(mesh);
        setMeshMessage(null);
      }, (error: unknown) => {
        if (cancelled) return;
        setDisplayMesh(null);
        setMeshMessage(t("openFem3dPlate.meshFailed", {
          ns: "common", message: error instanceof Error ? error.message : String(error),
        }));
      });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [needsDisplayMesh, model.plates, model.nodes, model.beams]);
  const contourRange = result && plateQuantity && visibility.plates
    ? openFem3DPlateQuantityRange(result, plateQuantity) : null;
  const platesLinear = result?.diagnostics.includes(OPEN_FEM_3D_PLATES_LINEAR_NOTICE) ?? false;
  const maxDisplacement = result ? openFem3DMaximumDisplacementM(model, result) : 0;
  const utilizations = useMemo(
    () => buildOpenFem3DUtilizations(checks, concreteChecks, timberChecks),
    [checks, concreteChecks, timberChecks],
  );
  // Dezelfde regel en toekenning als ThreeFrameCanvas (lib/profielKleur.ts):
  // de legenda staat er alleen als de staven ook echt naar profiel kleuren.
  const profielKleuren = useMemo(
    () => (canvasVisibility.beams && profielKleurenActief3d(canvasVisibility, utilizations.length)
      ? openFem3DProfielKleuring(model.beams, t) : null),
    [canvasVisibility, utilizations.length, model.beams, t],
  );
  // Dezelfde toetscommando's als het 2D-tekenvlak: M (verplaatsen), MV en CO
  // (kopiëren); zie lib/commandoReeks.ts. Niet in invoervelden.
  const toetsPrefixRef = useRef<Prefix>(null);
  const onToolChangeRef = useRef(onToolChange);
  onToolChangeRef.current = onToolChange;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Delete verwijdert de selectie, net als de lintknop Verwijderen. Niet
      // in invoervelden en niet onder een open dialoog.
      if (event.key === "Delete") {
        if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
        if (isInvoerVeld(event.target) || erIsEenDialoogOpen()) return;
        event.preventDefault();
        deleteSelectionRef.current();
        return;
      }
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.key.length !== 1) return;
      const doel = event.target as HTMLElement | null;
      if (doel && (doel.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(doel.tagName))) return;
      const r = verwerkToets(toetsPrefixRef.current, event.key, Date.now());
      toetsPrefixRef.current = r.prefix;
      if (r.tool) { event.preventDefault(); onToolChangeRef.current?.(r.tool); return; }
      if (r.verbruikt) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const transformTool = (["move", "rotate", "copy", "mirror"] as const)
    .find((candidate) => candidate === tool);
  // Een groep met alleen lasten (selectiefilter, issue #94) heeft geen knopen om te verplaatsen.
  const transformSelection = selection && (
    selection.type === "node" || selection.type === "beam" || selection.type === "plate" || selection.type === "envelopePanel"
    || (selection.type === "multi" && openFem3DSelectionGeometryCount(selection) > 0)
  ) ? selection : null;
  const applyTransform = (command: OpenFem3DTransformCommand) => {
    if (!transformSelection) return;
    const transformed = transformOpenFem3D(model, transformSelection, command);
    // Ging een verplaatste knoop op in een bestaande (automatisch samenvoegen,
    // issue #75), dan die knoop in de selectie; splitste het automatisch
    // aansluiten een geselecteerde staaf (issue #63), dan alle delen: anders
    // verplaatst of kopieert de volgende bewerking maar een halve staaf.
    const stap = transformed.model !== model ? onChange(transformed.model) : null;
    setSelection(openFem3DSelectionAfterAutoEdit(transformed.selection, stap));
    setCopyAnchor(null);
    setDrawError(null);
    onToolChange?.("select");
  };
  const applyCopyPoint = (point: Punt3) => {
    if (!transformSelection) return;
    try {
      const step = openFem3DCopyPointStep(copyAnchor, point);
      if (step.command) applyTransform(step.command);
      else setCopyAnchor(step.anchor);
      setDrawError(null);
    } catch (reason) {
      const bedding = openFem3DBeddingRefusal(reason);
      setDrawError(bedding ? t(bedding.key, bedding.values)
        : reason instanceof Error ? reason.message : String(reason));
    }
  };
  // In de explodeweergave is een klik op het tekenvlak een selectie (geen
  // puntkeuze) en is het model niet te wijzigen (App): dan geen puntuitleg in
  // kopregel en paneel, maar de melding dat Exploderen eerst uit moet.
  const copyPointHelp = exploded ? t("openFem3d.explodeEditBlocked")
    : t(copyAnchor ? "openFem3d.transform.copyTarget" : "openFem3d.transform.copySource", {
      defaultValue: copyAnchor ? "Klik het doelpunt om de selectie te kopiëren." : "Klik het bronpunt van de kopie.",
    });

  return (
    <div className="open-fem3d-editor">
      <div className="open-fem3d-stage">
        <ThreeFrameCanvas
          model={displayModel}
          conditionModel={displayConditionModel}
          onChange={exploded ? () => undefined : onChange}
          onDrawError={setDrawError}
          tool={exploded ? "select" : tool}
          selection={selection}
          // Per elementsoort staat een knoop ook als weergaveknoop bij een
          // hogere soort: kiezen daarvan selecteert de echte knoop.
          onSelect={(next) => setSelection(openFem3DExplodeSourceSelection(next))}
          copyAnchor={copyAnchor}
          // Kopiëren met basispunt en doelpunt; in de explodeweergave liggen de
          // levels uit elkaar, dus geen puntkeuze (net als tekenen).
          onCopyPoint={tool === "copy" && transformSelection && !exploded ? applyCopyPoint : undefined}
          onOpenCheckForBeam={onOpenCheckForBeam}
          fitToken={fitToken + fitRequest}
          viewRequest={viewRequest}
          currentView={currentView}
          visibility={canvasVisibility}
          structuralGrid={displayGrid}
          gridSpacingM={gridSpacingM}
          workPlaneZ={workLevel.zM}
          result={displayResult}
          plateMesh={displayPlateMesh}
          plateQuantity={plateQuantity}
          utilizations={utilizations}
          activeLoadCaseId={activeLoadCaseId}
          cameraRequest={cameraRequest}
          onCameraChange={(state) => {
            setCameraState(state);
            onCameraStateChange?.(state);
          }}
          onCameraViewChange={onCameraViewChange}
          loadCaseTypes={loadCaseTypes}
          onToolChange={onToolChange}
          onPlaceNodeCondition={exploded ? undefined : onPlaceNodeCondition}
          onPlacePointLoad={exploded ? undefined : onPlacePointLoad}
          deformationDisplay={deformationDisplay}
          diagramLabels={diagramLabels}
          // Menu-item Perspectief van de view cube: dezelfde zichtbaarheid als
          // de schakelaar in Weergave en in het venster Zichtbaarheid.
          onPerspectiveChange={(perspective) => setVisibility({ ...visibility, perspective })}
          // De section box (issue #86) hoort bij de weergave: in de
          // zichtbaarheid, bewaard en in opgeslagen views.
          onSectionBoxChange={(sectionBox) => setVisibility({ ...visibility, sectionBox })}
          onExplodeChange={(amountM) => setVisibility({ ...visibility, explode: { mode: visibility.explode.mode, amountM } })}
        />
        {/* Kopregel en modelcontrole in één kolom: loopt de uitleg over meer
            regels (smal tekenvlak, lange uitleg, andere taal), dan schuift de
            modelcontrole mee naar beneden in plaats van eroverheen te liggen. */}
        <div className="open-fem3d-stage-top">
          <div className="open-fem3d-stage-header">
            <strong>{t("openFem3d.title")}</strong>
            <span>{tool === "copy" ? transformSelection || exploded ? copyPointHelp
              : t("openFem3d.transform.copySelect", "Selecteer eerst de knopen, staven of platen die je wilt kopiëren.")
              : t(tool.startsWith("support:") ? "openFem3d.supportPlacementHelp"
              : tool.startsWith("spring:") ? "openFem3d.springPlacementHelp"
                : DRAW_HELP_KEYS[tool] ?? "openFem3d.axisHelp", { defaultValue: t("openFem3d.axisHelp") })}</span>
            {/* Het werkvlak voor tekenen: een klik in leeg canvas landt op het
                actieve level (standaard peil 0). In voor- en zijaanzicht staat
                een horizontaal vlak op zijn kant; daar geldt het aanzichtvlak. */}
            <label className="open-fem3d-workplane" title={t("openFem3d.workPlane.title")}
              data-open-fem3d-work-plane-z={workLevel.zM} data-open-fem3d-work-plane-level={workLevel.levelId ?? ""}>
              <span>{t("openFem3d.workPlane.label")}</span>
              <select value={workLevel.levelId ?? ""} onChange={(event) => setWorkLevelId(event.target.value || null)}>
                {workPlaneOptions.map((option) => <option key={option.value || "peil-0"} value={option.value}>
                  {option.level
                    ? t("openFem3d.levels.option", { name: openFem3DLevelName(option.level), height: toonMm(option.level.position) })
                    : t("openFem3d.workPlane.zero")}
                </option>)}
              </select>
              {!openFem3DWorkPlaneIsHorizontal(currentView) && <em>{t("openFem3d.workPlane.vertical")}</em>}
            </label>
            <button type="button" className="open-fem3d-views-button" onClick={onVisibilityOpen}>{t("openFem3d.viewsButton", { n: viewSets.length })}</button>
            {/* Passend beeld in dezelfde rij als Views: zo liggen ze nooit over elkaar, in geen enkele taal. */}
            <button className="open-fem3d-fit" onClick={() => setFitToken((n) => n + 1)} type="button">
              {t("openFem3d.fit")}
            </button>
          </div>
          {tool === "addEnvelopePanel" && structuralGrid && !exploded &&
            <OpenFem3DEnvelopeGridPanel grid={structuralGrid} onCreate={(choice) => {
              try {
                const next = addOpenFem3DEnvelopePanelFromGrid(model, structuralGrid, choice);
                onChange(next);
                const panel = next.envelopePanels?.[next.envelopePanels.length - 1];
                if (panel) setSelection({ type: "envelopePanel", id: panel.id });
                setDrawError(null);
              } catch (cause) {
                setDrawError(cause instanceof Error ? cause.message : String(cause));
              }
            }} />}
          <label className="open-fem3d-explode" data-open-fem3d-explode={visibility.explode.amountM}
            data-open-fem3d-explode-mode={visibility.explode.mode}>
            <span>{t("openFem3d.explode")}</span>
            <select value={visibility.explode.mode} aria-label={t("openFem3d.explodeMode")}
              title={t(visibility.explode.mode === "levels" ? "openFem3d.explodeLevelsHint" : "openFem3d.explodeElementTypesHint")}
              onChange={(event) => {
                const mode = event.target.value;
                if (isOpenFem3DExplodeMode(mode)) setVisibility({ ...visibility, explode: { ...visibility.explode, mode } });
              }}>
              {OPEN_FEM_3D_EXPLODE_MODES.map((mode) => <option key={mode} value={mode}>
                {t(mode === "levels" ? "openFem3d.explodeLevels" : "openFem3d.explodeElementTypes")}
              </option>)}
            </select>
            <input type="range" min="0" max="10000" step="100" value={Math.round(visibility.explode.amountM * 1000)}
              aria-label={t(visibility.explode.mode === "levels" ? "openFem3d.explodeAmount" : "openFem3d.explodeAmountElementTypes")}
              onChange={(event) => setVisibility({ ...visibility, explode: { mode: visibility.explode.mode, amountM: Number(event.target.value) / 1000 } })} />
            <output>{Math.round(visibility.explode.amountM * 1000)} mm</output>
          </label>
          <OpenFem3DModelCheck findings={modelControle.findings} skipped={modelControle.skipped}
            connectable={modelControle.connectable} toleranceMm={verbindingsTolerantie}
            onConnect={sluitKnopenAan}
            mergeGroups={samenvoegControle.groups} mergeRefused={samenvoegControle.refused}
            mergeable={samenvoegControle.mergeable} onMerge={voegKnopenSamen} levels={levels}
            openToken={modelCheckToken} />
        </div>
        {drawError && <div className="open-fem3d-draw-error" role="alert">
          <span>{drawError}</span>
          <button type="button" aria-label={t("openFem3d.closeMessage")} onClick={() => setDrawError(null)}>×</button>
        </div>}
        {transformTool && transformSelection && <OpenFem3DTransformPanel
          tool={transformTool}
          pointHelp={transformTool === "copy" ? copyPointHelp : undefined}
          // Alleen knopen, staven en platen: lasten in de groep (selectiefilter,
          // issue #94) worden niet zelf getransformeerd en tellen hier niet mee.
          selectionLabel={transformSelection.type === "multi"
            ? t("openFem3d.multiSelection", {
              count: openFem3DSelectionGeometryCount(transformSelection), nodes: transformSelection.nodeIds.length,
              beams: transformSelection.beamIds.length, plates: transformSelection.plateIds?.length ?? 0,
            })
            : transformSelection.type === "node" ? t("tree.nodeLabel", { ns: "common", id: transformSelection.id })
              : transformSelection.type === "beam" ? t("tree.barLabel", { ns: "common", id: transformSelection.id })
                : t("tree.plateLabel", { ns: "common", id: transformSelection.id })}
          onApply={applyTransform}
          onCancel={() => onToolChange?.("select")}
        />}
        {visibility.utilization && utilizations.length > 0 && (
          <div className="open-fem3d-uc-legend" aria-label={t("openFem3d.utilizationLegend")}>
            <strong>{t("openFem3d.utilization")}</strong>
            <span><i data-uc="low" />≤ 0,50</span>
            <span><i data-uc="medium" />0,50–0,80</span>
            <span><i data-uc="high" />0,80–1,00</span>
            <span><i data-uc="fail" />&gt; 1,00</span>
            <span><i data-uc="not-applicable" />{t("openFem3d.notChecked")}</span>
          </div>
        )}
        {profielKleuren && (
          <ProfielKleurLegenda regels={profielKleuren.regels} variant="3d" className="open-fem3d-profiel-legenda" />
        )}
        {contourRange && plateQuantity && (
          <div className="open-fem3d-plate-legend" role="img"
            aria-label={t("openFem3dPlate.legend", { ns: "common" })} data-open-fem3d-plate-legend={plateQuantity}>
            <strong>
              {t(`openFem3dPlate.quantity.${plateQuantity}`, { ns: "common" })} ({openFem3DPlateQuantity(plateQuantity).unit})
            </strong>
            <span className="open-fem3d-plate-legend-bar" style={{ background: openFem3DContourGradientCss() }} />
            <span className="open-fem3d-plate-legend-values">
              <span>{formatOpenFem3DPlateValue(contourRange.min)}</span>
              <span>{formatOpenFem3DPlateValue(contourRange.max)}</span>
            </span>
            {/* Gronddruk en Zakking (#107): hun eigen tekenafspraak, en wat geen contact is. */}
            {openFem3DPlateQuantity(plateQuantity).bedding ? <>
              <small>{t("openFem3dPlate.beddingNote", { ns: "common" })}</small>
              {(result?.plateBedding ?? []).some((plate) => plate.nodes.some((node) => !node.active)) &&
                <small data-open-fem3d-plate-no-contact>{t(plateQuantity === "groundPressure"
                  ? "openFem3dPlate.noContactGrey" : "openFem3dPlate.noContactDots", { ns: "common" })}</small>}
            </> : <small>{t("openFem3dPlate.signNote", { ns: "common" })}</small>}
            {platesLinear && <small>{t("openFem3dPlate.linearNotice", { ns: "common" })}</small>}
          </div>
        )}
        {meshMessage && <div className="open-fem3d-plate-mesh-message" role="status">{meshMessage}</div>}
        {showLoadCase && (result?.inactiveMembers?.length ?? 0) > 0 && (
          <div className="open-fem3d-inactive-legend" data-open-fem3d-inactive-legend
            title={t("openFem3d.trekSchijf.legendHint")}>
            <i />{t("openFem3d.trekSchijf.legendInactive", { count: result?.inactiveMembers?.length ?? 0 })}
          </div>
        )}
        {model.nodes.length === 0 && <div className="open-fem3d-empty">{t("openFem3d.empty")}</div>}
        <div className="open-fem3d-stage-footer">
          <span>
            {t("openFem3d.nodeCount", { count: model.nodes.length })} · {t("openFem3d.beamCount", { count: model.beams.length })}
            {staalgewicht.aantalStaven > 0 && (
              <span data-open-fem3d-staalgewicht={Math.round(staalgewicht.totaalKg)} title={staalTitel}>
                {" · "}{t("openFem3d.steelWeight", { kg: kgTekst(staalgewicht.totaalKg) })}
              </span>
            )}
          </span>
          <span data-open-fem-3d-status={solveError ? "error" : solving ? "solving" : result?.forceBalance?.ok === false ? "warning" : result ? "solved" : "ready"}>
            {solveError ? solveError
              : solving ? t("openFem3d.solving")
              : result?.forceBalance?.ok === false ? `Evenwicht wijkt af: ${result.forceBalance.maxImbalanceKn.toFixed(3)} kN` +
                (Number.isFinite(result.forceBalance.maxMomentImbalanceKnm) ? ` / ${result.forceBalance.maxMomentImbalanceKnm.toFixed(3)} kNm` : "") +
                " · resultaat niet geverifieerd"
              : result ? t("openFem3d.solved", { engine: result.engine.name, value: (maxDisplacement * 1000).toPrecision(4) })
              : t("openFem3d.readyToCalculate")}
          </span>
        </div>
      </div>
      <OpenFem3DVisibilityDialog
        open={visibilityOpen}
        onClose={() => onVisibilityClose?.()}
        visibility={visibility}
        onChange={setVisibility}
        viewSets={viewSets}
        currentView={currentView}
        currentCamera={cameraState}
        currentCombinationId={currentCombinationId}
        currentLoadCaseId={activeLoadCaseId ?? 1}
        currentMode={!showLoadCase ? "model" : resultsActive ? "results" : "loadCase"}
        currentDiagramLabels={diagramLabels}
        combinationOptions={combinationOptions}
        loadCaseOptions={loadCaseOptions}
        onViewSetsChange={onViewSetsChange}
        onApplyViewSet={(viewSet) => {
          setCameraRequest((previous) => ({ state: viewSet.camera, token: (previous?.token ?? 0) + 1 }));
          onApplyViewSet?.(viewSet);
        }}
      />
    </div>
  );
}

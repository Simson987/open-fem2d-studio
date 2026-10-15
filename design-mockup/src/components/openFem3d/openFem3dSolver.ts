import type { Frame3DAnalysisKind, Frame3DSolveResult } from "../frame3d/frame3dSolver";
import { isTauriApp } from "../../lib/tauri";
import { openFem3DNativeFeatures } from "./openFem3dNativeModel";
import {
  CONCRETE_E_CM,
  NU_BETON,
  NU_STAAL,
  TIMBER_G_MEAN,
  parseRechthoek,
  resolveSection,
} from "../../lib/sectionResolver";
import { STEEL_GRADES } from "../../lib/steelGrades";
import { STEEL_SECTION_DIMS } from "../../lib/steelSectionDims.generated";
import { isEigenProfiel, zoekEigenDoorsnede } from "../../lib/profieleditor/eigenDoorsnedenStore";
import { profielSleutel } from "../../lib/strip";
import { thermalAlphaForMaterial } from "../../lib/thermalAlpha";
import { betonDoorsnedeGrootheden } from "../../lib/betonDoorsnedeGrootheden";
import { parseConcreteSection } from "../../lib/betonCheckBuilder";
import {
  OPEN_FEM_3D_BEDDING_ALL_ROUND_COSINE, isOpenFem3DGlobalMemberLoad, openFem3DGlobalDirectionVector, openFem3DGlobalMemberLoadFactor,
  openFem3DLoadCaseId, openFem3DMemberAxes, readOpenFem3DBeamBedding, readOpenFem3DPlateBedding, type OpenFem3DBeamBedding,
  type OpenFem3DPlateBedding,
  type OpenFem3DGlobalDirection, type OpenFem3DMemberLoad,
  type OpenFem3DModel,
  type OpenFem3DSupport,
} from "./openFem3dModel";
import {
  OPEN_FEM_3D_BEDDING_LATERAL_BALANCE_NOTICE, openFem3DBeddingPileLateralForces, openFem3DBeddingTributaryLengths,
} from "./openFem3dBedding";
import { openFem3DPlateAxisZ, openFem3DPlateBeddingTributaryAreas } from "./openFem3dPlateBedding";
import { withOpenFem3DLoadPanels } from "./openFem3dLoadPanels";
import { metScheefstandLasten, type OpenFem3DScheefstand } from "./openFem3dScheefstand";
import { meshOpenFem3DPlates, type OpenFem3DPlateMesh } from "./openFem3dPlateMesh";
import { resolveOpenFem3DPlateMaterial } from "./openFem3dPlateMaterial";
import { openFem3DSecondOrderMomentKnm, type OpenFem3DSecondOrderMemberParts } from "./openFem3dTrekSchijf";
import { fromOpenFem3DPrincipalResult, openFem3DPrincipalSection, toOpenFem3DPrincipal } from "./openFem3dPrincipalAxes";
import { resolveOpenFem3DAnalysisMaterial } from "./openFem3dAnalysisMaterial";
import {
  openFem3DVerloopDelen, openFem3DVerloopDoorsnede, rechthoekTorsieconstante, type OpenFem3DVerloopDoorsnede,
} from "./openFem3dVerloop";

export type OpenFem3DAnalysisKind = "linear" | "p-delta";

export interface OpenFem3DDisplacement {
  nodeId: number;
  ux: number; uy: number; uz: number;
  rx: number; ry: number; rz: number;
}

export interface OpenFem3DReaction {
  nodeId: number;
  fx: number; fy: number; fz: number;
  mx: number; my: number; mz: number;
}

export interface OpenFem3DMemberForces {
  memberId: number;
  lengthM: number;
  nStartKn: number; nEndKn: number;
  vyStartKn: number; vyEndKn: number;
  vzStartKn: number; vzEndKn: number;
  torsionStartKnm: number; torsionEndKnm: number;
  myStartKnm: number; myEndKnm: number;
  mzStartKnm: number; mzEndKnm: number;
}

export interface OpenFem3DDiagramPoint {
  /** Relatieve positie langs de staaf: 0 = begin, 1 = einde. */
  t: number;
  value: number;
}

export interface OpenFem3DMemberDiagram {
  memberId: number;
  points: OpenFem3DDiagramPoint[];
  maxValue: number;
  minValue: number;
  maxAbsValue: number;
}

export interface OpenFem3DDiagrams {
  momentY: OpenFem3DMemberDiagram[];
  momentZ: OpenFem3DMemberDiagram[];
  shearY: OpenFem3DMemberDiagram[];
  shearZ: OpenFem3DMemberDiagram[];
  axial: OpenFem3DMemberDiagram[];
  torsion: OpenFem3DMemberDiagram[];
}

export interface OpenFem3DBucklingMember {
  memberId: number;
  axialForceKn: number;
  criticalForceKn: number;
  effectiveLengthFactor: number;
  effectiveLengthM: number;
  lengthM: number;
  slendernessY: number;
  slendernessZ: number;
}

export type OpenFem3DBuckling =
  | { status: "available"; modes: { mode: number; loadFactor: number }[]; members: OpenFem3DBucklingMember[] }
  | { status: "notApplicable" | "failed"; reason: string };

/** Plaatgrootheden in één punt, in plaatassen (zie de Rust-adapter, module shell). */
export interface OpenFem3DShellValues {
  /** Membraankrachten n = ∫σ dz (kN/m), trek positief. */
  nxxKnPerM: number; nyyKnPerM: number; nxyKnPerM: number;
  /** Momenten (kNm/m), positief bij trek aan de onderzijde (−z van de plaatassen). */
  mxxKnmPerM: number; myyKnmPerM: number; mxyKnmPerM: number;
  /** Dwarskrachten v = ∫τ dz (kN/m) op een snede met normaal +x resp. +y, positief in +z. */
  vxKnPerM?: number; vyKnPerM?: number;
  /** Spanningen aan de bovenzijde (+z) en onderzijde (−z), MPa. */
  sigmaXxTopMpa: number; sigmaYyTopMpa: number; tauXyTopMpa: number; vonMisesTopMpa: number;
  sigmaXxBottomMpa: number; sigmaYyBottomMpa: number; tauXyBottomMpa: number; vonMisesBottomMpa: number;
}

export interface OpenFem3DShellElementResult extends OpenFem3DShellValues {
  elementId: number;
  plateId: number;
  centroidM: [number, number, number];
}

export interface OpenFem3DShellNodeResult extends OpenFem3DShellValues {
  nodeId: number;
  plateId: number;
  /** Verplaatsing langs de plaatnormaal z (m). */
  wM: number;
}

export interface OpenFem3DPlateExtreme {
  quantity: string;
  min: number;
  minNodeId: number;
  max: number;
  maxNodeId: number;
}

export interface OpenFem3DPlateSummary {
  plateId: number;
  axes: { x: [number, number, number]; y: [number, number, number]; z: [number, number, number] };
  elementCount: number;
  nodeCount: number;
  areaM2: number;
  /** Vlaklasten plus knooplasten op de plaatknopen, globaal (kN); zie `PlateSummary3D` (#244). */
  loadResultantKn: [number, number, number];
  extremes: OpenFem3DPlateExtreme[];
}

export interface OpenFem3DSolveResult {
  /** 1: alleen staven; 2: met platen, vlaklasten en tussenknopen. */
  schemaVersion: 1 | 2;
  engine: { id: string; name: string; revision: string; license: string };
  analysis: OpenFem3DAnalysisKind;
  displacements: OpenFem3DDisplacement[];
  reactions: OpenFem3DReaction[];
  memberForces: OpenFem3DMemberForces[];
  /** Sinds contract 1.1: door de solver bemonsterde snedekrachtlijnen. */
  diagrams?: OpenFem3DDiagrams;
  secondOrder?: { iterations: number; converged: boolean; stable: boolean; maxAmplification: number };
  buckling: OpenFem3DBuckling;
  equilibrium?: { relativeResidual: number; residualOk: boolean; maxImbalanceKn: number; equilibriumOk: boolean };
  /** Onafhankelijke globale kracht- en momentensom, inclusief hefboomarmen om de oorsprong. */
  forceBalance?: {
    imbalanceKn: [number, number, number]; maxImbalanceKn: number; toleranceKn: number;
    momentImbalanceKnm: [number, number, number]; maxMomentImbalanceKnm: number; momentToleranceKnm: number;
    /**
     * Alleen bij P-Δ: het tweede-ordemoment Σ N·(e_x × Δu) om de oorsprong.
     * De momentensom in de onvervormde stand is daar precies dit moment; de
     * momentafwijking hierboven is al verminderd met dit moment.
     */
    secondOrderMomentKnm?: [number, number, number];
    ok: boolean;
  };
  solverPath?: string;
  diagnostics: string[];
  /** Staaf-id's waarvan de knikslankheden om de hoofdassen u/v gelden. */
  principalAxesMemberIds?: number[];
  /** Contract 2: samenvatting per plaat. */
  plates?: OpenFem3DPlateSummary[];
  /** Contract 2: plaatgrootheden per element (midden). */
  shellElements?: OpenFem3DShellElementResult[];
  /** Contract 2: plaatgrootheden per knoop, per plaat gemiddeld. */
  shellNodes?: OpenFem3DShellNodeResult[];
  /**
   * Het rekennet waarmee dit resultaat is berekend (geen deel van het
   * rekencontract; voor weergave en rapport).
   */
  plateMesh?: OpenFem3DPlateMesh;
  /**
   * Trek-alleen staven die in deze berekening op druk stonden en niet
   * meededen (oplopend); zij staan met nul-krachten in de uitvoer. Ontbreekt
   * bij een kern van vóór trek-alleen.
   */
  inactiveMembers?: number[];
  /** Aantal statusrondes van de trek-alleen-lus; 0 zonder trek-alleen staven. */
  tensionOnlyRounds?: number;
  /**
   * Montageverlenging Δ0 per trek-alleen staaf (mm): de spanningsloze lengte
   * is L + Δ0. Alleen bij een verzoek met montagelasten (`tensionOnlyFit`).
   */
  tensionOnlyFit?: { memberId: number; deltaMm: number }[];
  /** Trek-alleen staven die alleen dankzij de kruisregel actief zijn (oplopend). */
  crossRuleMembers?: number[];
  /**
   * Staven op bedding (issue #106): per staaf de zakking en de gronddruk op de
   * knopen die de kern maakte. Alleen als het model staven op bedding heeft;
   * ontbreekt bij een kern van vóór de bedding.
   */
  bedding?: OpenFem3DBeddingMemberResult[];
  /**
   * Platen op bedding (issue #107): per plaat de zakking en de gronddruk op de
   * knopen van het rekennet. Alleen als het model platen op bedding heeft;
   * ontbreekt bij een kern van vóór de plaatbedding.
   */
  plateBedding?: OpenFem3DPlateBeddingResult[];
  /**
   * Alleen bij P-Δ: per staaf de delen waarmee de kern de geometrische
   * stijfheid rekende, met hun N en Δu (controle oktober 2026, K4): een
   * gedrukte staaf in vier delen per stuk. De onafhankelijke momentensom telt
   * daarmee (`openFem3DSecondOrderMomentKnm`). Ontbreekt bij een kern van
   * vóór K4 en bij een lineaire berekening.
   */
  secondOrderParts?: OpenFem3DSecondOrderMemberParts[];
  /**
   * Alleen bij de native Rust-route (openFem3dNativeRoute): de volledige
   * analysesoort van die route, waaronder materiaal-FNL ("material") en
   * gecombineerd ("combined"). `analysis` geeft dan alleen de meetkundige
   * orde (lineair of P-Δ).
   */
  nativeAnalysis?: Frame3DAnalysisKind;
  /** Alleen bij de native Rust-route: spanningen en rekken van de volumes en membranen. */
  nativeVolume3D?: Frame3DSolveResult["volume3D"];
}

/** Eén knoop van het rekennet van een plaat op bedding (#107). */
export interface OpenFem3DPlateBeddingNode {
  nodeId: number;
  /** Zakking loodrecht op de plaat in m, positief de grond in (tegen de plaatnormaal in). */
  settlementM: number;
  /** Gronddruk k·zakking in kN/m², positief bij druk; 0 waar de veer bij alleen druk wegviel. */
  pressureKnPerM2: number;
  /** False waar de veer bij alleen druk is weggevallen (geen contact). */
  active: boolean;
}

/** De uitkomst van één plaat op bedding (#107). */
export interface OpenFem3DPlateBeddingResult {
  plateId: number;
  nodes: OpenFem3DPlateBeddingNode[];
  maxPressureKnPerM2: number;
  minPressureKnPerM2: number;
  maxSettlementM: number;
  /** De som van alle veerkrachten van de plaat, kN. */
  totalReactionKn: number;
  /** Het deel van het plaatoppervlak zonder contact (0 … 1). */
  liftedFraction: number;
}

/** Eén punt van een staaf op bedding: een knoop van de kern, met de einden. */
export interface OpenFem3DBeddingPoint {
  /** Relatieve positie langs de staaf: 0 = begin, 1 = eind. */
  t: number;
  /** Verticale zakking in m, positief omlaag. */
  settlementM: number;
  /** De lijnlast die de grond op de staaf zet (k·b·zakking), kN/m, positief omhoog; 0 waar de veer wegviel. */
  pressureKnPerM: number;
  /**
   * Zijdelingse lijnlast van de grond op de staaf (kN/m), alleen bij een zijdelingse bedding: bij een liggende
   * of schuine staaf de component met teken langs de horizontale normaal n = Z × e_x (genormeerd; positief langs
   * +n, de grond duwt tegen de verplaatsing in), bij een staaf steiler dan 45° (rondom, een (schoor)paal) de grootte
   * van de resultante loodrecht op de as.
   */
  lateralKnPerM?: number;
  /** False waar de verticale veer bij alleen druk is weggevallen (geen contact). */
  active: boolean;
}

export interface OpenFem3DBeddingMemberResult {
  memberId: number;
  points: OpenFem3DBeddingPoint[];
  maxPressureKnPerM: number;
  minPressureKnPerM: number;
  maxSettlementM: number;
  /** De som van alle (verticale) veerkrachten van de staaf, kN. */
  totalReactionKn: number;
  /** Het deel van de lengte zonder contact (0 … 1). */
  liftedFraction: number;
}

/**
 * Controleer de globale statica onafhankelijk van de kern: de kracht- en
 * momentensom van lasten en reacties om de oorsprong. Bij een P-Δ-uitkomst
 * staat het evenwicht in de vervormde stand; de momentensom in de
 * onvervormde stand is daar exact het tweede-ordemoment Σ N·(e_x × Δu), dat
 * hier uit de staafkrachten en verplaatsingen van dezelfde uitkomst volgt
 * (per deel van een onderverdeelde staaf, zie `openFem3DSecondOrderMomentKnm`).
 */
export function openFem3DGlobalForceBalance(
  input: Omit<OpenFem3DSolveRequestBody, "bucklingModes">,
  result: Pick<OpenFem3DSolveResult, "reactions">
    & Partial<Pick<OpenFem3DSolveResult,
      "analysis" | "displacements" | "memberForces" | "bedding" | "plateBedding" | "plates" | "secondOrderParts">>,
): NonNullable<OpenFem3DSolveResult["forceBalance"]> {
  const applied: [number, number, number] = [0, 0, 0];
  const appliedMoment: [number, number, number] = [0, 0, 0];
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const memberById = new Map(input.members.map((member) => [member.id, member]));
  type Vector3 = [number, number, number];
  const cross = (a: Vector3, b: Vector3): Vector3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const add = (target: Vector3, value: Vector3) => {
    for (let axis = 0; axis < 3; axis++) target[axis] += value[axis];
  };
  const addForceAt = (force: Vector3, position: Vector3, couple: Vector3 = [0, 0, 0]) => {
    add(applied, force);
    add(appliedMoment, cross(position, force));
    add(appliedMoment, couple);
  };
  const memberGeometry = (memberId: number) => {
    const member = memberById.get(memberId);
    const start = member && nodeById.get(member.startNodeId);
    const end = member && nodeById.get(member.endNodeId);
    if (!start || !end) throw new Error(`Staaf ${memberId} ontbreekt bij de onafhankelijke krachtensom.`);
    return { start, ...openFem3DMemberAxes(start, end, member?.rollAngleRad ?? 0) };
  };
  const localVector = (ey: readonly number[], ez: readonly number[], fy: number, fz: number): Vector3 => [
    fy * ey[0] + fz * ez[0], fy * ey[1] + fz * ez[1], fy * ey[2] + fz * ez[2],
  ];
  const memberPoint = (start: { x: number; y: number; z: number }, ex: readonly number[], distance: number): Vector3 => [
    start.x + distance * ex[0], start.y + distance * ex[1], start.z + distance * ex[2],
  ];
  const addLocalMemberForce = (memberId: number, fy: number, fz: number, positionM: number) => {
    const { start, ex, ey, ez } = memberGeometry(memberId);
    addForceAt(localVector(ey, ez, fy, fz), memberPoint(start, ex, positionM));
  };
  for (const load of input.nodalLoads) {
    const node = nodeById.get(load.nodeId);
    if (!node) throw new Error(`Knoop ${load.nodeId} ontbreekt bij de onafhankelijke krachtensom.`);
    addForceAt([load.fx, load.fy, load.fz], [node.x, node.y, node.z], [load.mx, load.my, load.mz]);
  }
  for (const load of input.memberLoads) {
    const { start, ex, ey, ez } = memberGeometry(load.memberId);
    const length = load.endPositionM - load.startPositionM;
    if (isOpenFem3DGlobalMemberLoad(load)) {
      // Globale lijnlast (#80): per staafmeter f·q(s) langs d, met f = 1 of,
      // per projectie, |e_x × d|. Kracht d·f·∫q ds, moment om de oorsprong
      // start × F + e_x × d·f·∫s·q(s) ds (s vanaf het staafbegin).
      const d = openFem3DGlobalDirectionVector(load.globalDirection);
      const f = openFem3DGlobalMemberLoadFactor(ex, load.globalDirection, load.perProjection);
      const total = f * (load.qStartKnPerM + load.qEndKnPerM) * length / 2;
      const force: Vector3 = [d[0] * total, d[1] * total, d[2] * total];
      add(applied, force);
      add(appliedMoment, cross([start.x, start.y, start.z], force));
      const s = load.startPositionM * total + f * length ** 2 * (load.qStartKnPerM / 6 + load.qEndKnPerM / 3);
      add(appliedMoment, cross(ex as Vector3, [d[0] * s, d[1] * s, d[2] * s]));
      continue;
    }
    const fy = (load.qyStartKnPerM + load.qyEndKnPerM) * length / 2;
    const fz = (load.qzStartKnPerM + load.qzEndKnPerM) * length / 2;
    const force = localVector(ey, ez, fy, fz);
    add(applied, force);
    add(appliedMoment, cross([start.x, start.y, start.z], force));
    // ∫s·q(s)ds over a linearly varying load; a is measured from the member start.
    const sy = load.startPositionM * fy
      + length ** 2 * (load.qyStartKnPerM / 6 + load.qyEndKnPerM / 3);
    const sz = load.startPositionM * fz
      + length ** 2 * (load.qzStartKnPerM / 6 + load.qzEndKnPerM / 3);
    add(appliedMoment, cross(ex as Vector3, localVector(ey, ez, sy, sz)));
  }
  for (const load of input.memberPointLoads) addLocalMemberForce(load.memberId, load.pyKn, load.pzKn, load.positionM);
  // Vlaklasten: per plaatelement de resultante q·A in het zwaartepunt van
  // het elementoppervlak (twee driehoeken), onafhankelijk van de knoopverdeling.
  const surfaceByPlate = new Map<number, Vector3>();
  for (const load of input.surfaceLoads ?? []) {
    const sum = surfaceByPlate.get(load.plateId) ?? [0, 0, 0];
    surfaceByPlate.set(load.plateId, [sum[0] + load.qxKnPerM2, sum[1] + load.qyKnPerM2, sum[2] + load.qzKnPerM2]);
  }
  for (const element of input.shellElements ?? []) {
    const q = surfaceByPlate.get(element.plateId);
    if (!q) continue;
    const corners = element.nodeIds.map((id) => {
      const node = nodeById.get(id);
      if (!node) throw new Error(`Knoop ${id} van plaatelement ${element.id} ontbreekt bij de krachtensom.`);
      return [node.x, node.y, node.z] as Vector3;
    });
    for (const [a, b, c] of [[corners[0], corners[1], corners[2]], [corners[0], corners[2], corners[3]]]) {
      const area = Math.hypot(...cross(
        [b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]])) / 2;
      const centroid: Vector3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      addForceAt([q[0] * area, q[1] * area, q[2] * area], centroid);
    }
  }
  const imbalanceKn: [number, number, number] = [...applied];
  const momentImbalanceKnm: [number, number, number] = [...appliedMoment];
  // Platen op bedding (#107): de grondveren staan niet bij de oplegreacties.
  // Geeft een kern ze toch als reactie op een knoop van het rekennet zonder
  // oplegging, dan tellen ze hieronder via plateBedding, niet dubbel.
  const supportedNodes = new Set(input.supports.map((support) => support.nodeId));
  const plateBeddingNodes = new Set((result.plateBedding ?? []).flatMap((plate) => plate.nodes.map((node) => node.nodeId)));
  for (const reaction of result.reactions) {
    if (plateBeddingNodes.has(reaction.nodeId) && !supportedNodes.has(reaction.nodeId)) continue;
    const node = nodeById.get(reaction.nodeId);
    if (!node) throw new Error(`Reactieknoop ${reaction.nodeId} ontbreekt bij de onafhankelijke momentensom.`);
    imbalanceKn[0] += reaction.fx;
    imbalanceKn[1] += reaction.fy;
    imbalanceKn[2] += reaction.fz;
    add(momentImbalanceKnm, cross([node.x, node.y, node.z], [reaction.fx, reaction.fy, reaction.fz]));
    add(momentImbalanceKnm, [reaction.mx, reaction.my, reaction.mz]);
  }
  // Grondveren van staven op bedding (#106): de kern zet ze op zijn knopen
  // langs de staaf, elk met k·b maal de halve stukken ernaast. De veerkracht
  // is dus de gronddruk maal die lengte, verticaal in globaal +Z, op het punt
  // t. Ze werken als reacties (de oplegreacties zelf bevatten ze niet). De
  // zijdelingse grondkracht van een liggende staaf werkt langs n = Z × e_x;
  // die van een staaf steiler dan 45° (rondom, een (schoor)paal) staat alleen
  // als grootte in het resultaat en telt hier niet mee (zie
  // openFem3DBeddingPileLateralForces).
  for (const member of result.bedding ?? []) {
    const { start, ex } = memberGeometry(member.memberId);
    const definition = memberById.get(member.memberId)!;
    const end = nodeById.get(definition.endNodeId)!;
    const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
    const lengths = openFem3DBeddingTributaryLengths(member.points, length);
    const pile = Math.abs(ex[2]) > OPEN_FEM_3D_BEDDING_ALL_ROUND_COSINE;
    const side = cross([0, 0, 1], ex as Vector3);
    const sideLength = Math.hypot(...side);
    member.points.forEach((point, index) => {
      const lateral = !pile && sideLength > 0 ? (point.lateralKnPerM ?? 0) * lengths[index] / sideLength : 0;
      const force: Vector3 = [lateral * side[0], lateral * side[1], point.pressureKnPerM * lengths[index] + lateral * side[2]];
      const position = memberPoint(start, ex, point.t * length);
      add(imbalanceKn, force);
      add(momentImbalanceKnm, cross(position, force));
    });
  }
  // Grondveren van platen op bedding (#107): de kern zet op elke knoop van het
  // rekennet een veer k·A_trib langs de plaatnormaal (A_trib consistent uit de
  // elementen van die plaat). De veerkracht is dus de gronddruk maal A_trib,
  // langs de plaatnormaal (de grond ligt eronder en duwt de plaat omhoog).
  for (const plate of result.plateBedding ?? []) {
    const elements = (input.shellElements ?? []).filter((element) => element.plateId === plate.plateId);
    const areas = openFem3DPlateBeddingTributaryAreas(elements, (id) => {
      const node = nodeById.get(id);
      return node ? [node.x, node.y, node.z] : undefined;
    });
    const axes = result.plates?.find((summary) => summary.plateId === plate.plateId)?.axes.z;
    const normal = axes ?? openFem3DPlateNormalFromElements(elements, nodeById);
    for (const point of plate.nodes) {
      const node = nodeById.get(point.nodeId);
      if (!node) throw new Error(`Knoop ${point.nodeId} van plaat ${plate.plateId} op bedding ontbreekt bij de krachtensom.`);
      const magnitude = point.pressureKnPerM2 * (areas.get(point.nodeId) ?? 0);
      const force: Vector3 = [magnitude * normal[0], magnitude * normal[1], magnitude * normal[2]];
      add(imbalanceKn, force);
      add(momentImbalanceKnm, cross([node.x, node.y, node.z], force));
    }
  }
  const secondOrderMomentKnm = result.analysis === "p-delta" && result.displacements && result.memberForces
    ? openFem3DSecondOrderMomentKnm(input, {
      displacements: result.displacements, memberForces: result.memberForces, secondOrderParts: result.secondOrderParts,
    })
    : undefined;
  if (secondOrderMomentKnm) {
    for (let axis = 0; axis < 3; axis++) momentImbalanceKnm[axis] -= secondOrderMomentKnm[axis];
  }
  const maxImbalanceKn = Math.max(...imbalanceKn.map(Math.abs));
  const maxMomentImbalanceKnm = Math.max(...momentImbalanceKnm.map(Math.abs));
  const scaleKn = Math.max(1, ...applied.map(Math.abs));
  const scaleKnm = Math.max(1, ...appliedMoment.map(Math.abs));
  const toleranceKn = 1e-5 * scaleKn;
  const momentToleranceKnm = 1e-5 * scaleKnm;
  return {
    imbalanceKn, maxImbalanceKn, toleranceKn,
    momentImbalanceKnm, maxMomentImbalanceKnm, momentToleranceKnm,
    ...(secondOrderMomentKnm ? { secondOrderMomentKnm } : {}),
    ok: Number.isFinite(maxImbalanceKn) && Number.isFinite(maxMomentImbalanceKnm)
      && maxImbalanceKn <= toleranceKn && maxMomentImbalanceKnm <= momentToleranceKnm,
  };
}

/**
 * De plaatnormaal volgens de afspraak van de kern (z-as van de plaatassen)
 * uit de elementen van één plaat, voor een uitkomst zonder plaatsamenvatting.
 */
function openFem3DPlateNormalFromElements(
  elements: readonly { nodeIds: readonly number[] }[],
  nodeById: ReadonlyMap<number, { x: number; y: number; z: number }>,
): [number, number, number] {
  const sum: [number, number, number] = [0, 0, 0];
  let reference: [number, number, number] | null = null;
  for (const element of elements) {
    const p = element.nodeIds.map((id) => nodeById.get(id)!);
    // Oppervlaktevector van de vierhoek: ½ (d1 × d2) van de diagonalen.
    const d1 = [p[2].x - p[0].x, p[2].y - p[0].y, p[2].z - p[0].z];
    const d2 = [p[3].x - p[1].x, p[3].y - p[1].y, p[3].z - p[1].z];
    const area: [number, number, number] = [
      (d1[1] * d2[2] - d1[2] * d2[1]) / 2, (d1[2] * d2[0] - d1[0] * d2[2]) / 2, (d1[0] * d2[1] - d1[1] * d2[0]) / 2,
    ];
    reference ??= area;
    const sign = area[0] * reference[0] + area[1] * reference[1] + area[2] * reference[2] < 0 ? -1 : 1;
    for (let axis = 0; axis < 3; axis += 1) sum[axis] += sign * area[axis];
  }
  return openFem3DPlateAxisZ(sum);
}

/**
 * Welke 3D-belastingen één solveraanroep vormen. Een getal rekent één
 * belastinggeval; een Map rekent een volledige combinatie. De factoren
 * worden vóór de Rust-grens op iedere kracht, elk moment en elke
 * staafbelasting toegepast. Daardoor doorloopt ook een combinatie als één
 * geheel de P-Delta-iteraties en wordt zij niet achteraf lineair opgeteld.
 */
export type OpenFem3DLoadSelection = number | ReadonlyMap<number, number>;

function factorForLoad(selection: OpenFem3DLoadSelection | undefined, caseId: number): number {
  if (selection === undefined) return 1;
  if (typeof selection === "number") return caseId === selection ? 1 : 0;
  const factor = selection.get(caseId) ?? 0;
  if (!Number.isFinite(factor)) throw new Error(`Belastinggeval ${caseId} heeft een ongeldige combinatiefactor.`);
  return factor;
}

/** Sleutel van de profieltabellen; "Ø24" wordt "RD24" en "FL 80x10" "STRIP80X10" (`lib/strip.ts`). */
function profileKey(value: string): string {
  return profielSleutel(value);
}

function timberGMean(material: string): number | undefined {
  const grade = Object.keys(TIMBER_G_MEAN).find((name) => name.toLowerCase() === material.toLowerCase());
  return grade ? TIMBER_G_MEAN[grade] : undefined;
}

function poisson(material: string): number {
  if (timberGMean(material) !== undefined) return 0;
  if (/^CLT(?:\b|[-_])/i.test(material)) {
    throw new Error(`Kruislaaghout "${material}" heeft in 3D nog geen betrouwbare orthotrope staafstijfheid.`);
  }
  if (material in CONCRETE_E_CM) return NU_BETON;
  if (STEEL_GRADES.includes(material.toUpperCase())) return NU_STAAL;
  if (/^(EN\s*AW|ALUMINIUM|ALUMINUM|VRIJ:)/i.test(material)) return NU_STAAL;
  throw new Error(
    `Materiaal "${material}" heeft in 3D nog geen betrouwbare torsiestijfheid. ` +
    "Gebruik een bekende houtsterkteklasse, staal, beton, aluminium of een vrij isotroop materiaal.",
  );
}

/** Wat een rekenverzoek naast model, analyse en lastkeuze nodig kan hebben. */
export interface OpenFem3DSolveOptions {
  /**
   * De blijvende belastinggevallen (type "dead"). Staat
   * `tensionOnlyFitAfterPermanent` aan, dan zijn hun lasten met factor 1,0 —
   * inclusief eigen gewicht en belastingvlakken in die gevallen — de
   * montagelasten van de trek-alleen staven.
   */
  permanentCaseIds?: readonly number[];
  /**
   * Het geval waarin het automatische eigen gewicht staat. Rekent een
   * uitkomst dat geval mee en heeft het model trek-alleen staven, dan meldt
   * de uitkomst dat hun eigen gewicht als knooplasten werkt (kabelwerking).
   */
  selfWeightCaseId?: number;
  /**
   * Hoeveel knikvormen de kern bij P-Δ rapporteert; zonder opgave 3 (de
   * weergave). De toetsruns (issue #199, `openFem3dToetsKrachten.ts`) vragen
   * er één: alleen α_cr van de eerste vorm wordt gemeld, en de
   * stabiliteitspoort van de kern rekent er hoe dan ook minstens één. Een
   * lineaire berekening rekent er altijd geen.
   */
  bucklingModes?: number;
  /**
   * De toets (issue #199): P-Δ is verplicht. Kan de kern dit model alleen
   * lineair rekenen (platen), dan een fout met de reden
   * (`OPEN_FEM_3D_PLATES_NO_SECOND_ORDER`) in plaats van de terugval naar
   * eerste orde die de resultaten wel krijgen.
   */
  tweedeOrdeVerplicht?: boolean;
}

/** De lasten van één lastkeuze, met de factoren toegepast, in modelvorm. */
function selectedLoads(model: OpenFem3DModel, loadSelection: OpenFem3DLoadSelection | undefined) {
  const nodalLoads = (model.loads ?? []).flatMap((load) => {
    const factor = factorForLoad(loadSelection, openFem3DLoadCaseId(load));
    if (factor === 0) return [];
    return [{
      ...load,
      fx: load.fx * factor, fy: load.fy * factor, fz: load.fz * factor,
      mx: load.mx * factor, my: load.my * factor, mz: load.mz * factor,
    }];
  });
  const memberLoads = (model.memberLoads ?? []).flatMap((load): OpenFem3DMemberLoad[] => {
    const factor = factorForLoad(loadSelection, openFem3DLoadCaseId(load));
    if (factor === 0) return [];
    if (isOpenFem3DGlobalMemberLoad(load)) return [{ ...load, qStart: load.qStart * factor, qEnd: load.qEnd * factor }];
    return [{
      ...load,
      qyStart: load.qyStart * factor, qyEnd: load.qyEnd * factor,
      qzStart: load.qzStart * factor, qzEnd: load.qzEnd * factor,
    }];
  });
  const memberPointLoads = (model.memberPointLoads ?? []).flatMap((load) => {
    const factor = factorForLoad(loadSelection, openFem3DLoadCaseId(load));
    if (factor === 0) return [];
    return [{ ...load, py: load.py * factor, pz: load.pz * factor }];
  });
  const thermalLoads = (model.thermalLoads ?? []).flatMap((load) => {
    const factor = factorForLoad(loadSelection, openFem3DLoadCaseId(load));
    if (factor === 0) return [];
    return [{
      ...load,
      deltaTUniformK: load.deltaTUniformK * factor,
      deltaTGradientYK: load.deltaTGradientYK * factor,
      deltaTGradientZK: load.deltaTGradientZK * factor,
    }];
  });
  const surfaceLoads = (model.surfaceLoads ?? []).flatMap((load) => {
    const factor = factorForLoad(loadSelection, openFem3DLoadCaseId(load));
    if (factor === 0) return [];
    return [{
      id: load.id, plateId: load.plateId,
      qxKnPerM2: load.qx * factor, qyKnPerM2: load.qy * factor, qzKnPerM2: load.qz * factor,
    }];
  });
  return { nodalLoads, memberLoads, memberPointLoads, thermalLoads, surfaceLoads };
}

/** Dezelfde lasten in de vorm van het rekencontract (zonder vlaklasten). */
function contractLoads(loads: ReturnType<typeof selectedLoads>, angles: ReadonlyMap<number, number> = new Map()) {
  const rotate = (memberId: number, y: number, z: number): [number, number] => {
    const angle = angles.get(memberId);
    return angle === undefined ? [y, z] : toOpenFem3DPrincipal(y, z, angle);
  };
  return {
    nodalLoads: loads.nodalLoads.map(({ caseId: _caseId, generated: _generated, layerId: _layerId, ...load }) => load),
    memberLoads: loads.memberLoads.map((load): OpenFem3DMemberLoadBody => {
      if (isOpenFem3DGlobalMemberLoad(load)) {
        // Globaal (#80): de kern projecteert op de reeds gedraaide staafassen.
        return {
          id: load.id,
          memberId: load.beamId,
          globalDirection: load.globalDirection,
          qStartKnPerM: load.qStart,
          qEndKnPerM: load.qEnd,
          ...(load.perProjection ? { perProjection: true } : {}),
          startPositionM: load.startPositionM,
          endPositionM: load.endPositionM,
        };
      }
      const [qyStartKnPerM, qzStartKnPerM] = rotate(load.beamId, load.qyStart, load.qzStart);
      const [qyEndKnPerM, qzEndKnPerM] = rotate(load.beamId, load.qyEnd, load.qzEnd);
      return { id: load.id, memberId: load.beamId,
        qyStartKnPerM, qyEndKnPerM, qzStartKnPerM, qzEndKnPerM,
        startPositionM: load.startPositionM, endPositionM: load.endPositionM };
    }),
    memberPointLoads: loads.memberPointLoads.map((load) => {
      const [pyKn, pzKn] = rotate(load.beamId, load.py, load.pz);
      return { id: load.id, memberId: load.beamId, pyKn, pzKn, positionM: load.positionM };
    }),
    thermalLoads: loads.thermalLoads.map((load) => {
      const [deltaTGradientYK, deltaTGradientZK] = rotate(load.beamId, load.deltaTGradientYK, load.deltaTGradientZK);
      return { id: load.id, memberId: load.beamId, deltaTUniformK: load.deltaTUniformK,
        deltaTGradientYK, deltaTGradientZK };
    }),
  };
}

/**
 * Resolve every member before the Rust call. A/Iy still come from the same
 * resolver as 2D; Iz/J come from the steel catalogue or exact rectangle
 * geometry. An incomplete 3D section is rejected rather than supplemented
 * with hidden defaults.
 */
export function buildOpenFem3DSolveRequest(
  input: OpenFem3DModel,
  analysis: OpenFem3DAnalysisKind = "p-delta",
  loadSelection?: OpenFem3DLoadSelection,
  plateMesh?: OpenFem3DPlateMesh,
  options: OpenFem3DSolveOptions = {},
): OpenFem3DSolveRequestBody {
  // Volumes, membraanplaten, axiale staven en materiaalwetten rekent alleen de
  // native Rust-route (openFem3dNativeRoute); deze kern zou ze stil overslaan.
  const nativeFeatures = openFem3DNativeFeatures(input);
  if (nativeFeatures.length > 0) {
    throw new Error(`Dit 3D-model bevat onderdelen die alleen Open FEM Rust rekent (${nativeFeatures.join(", ")}); `
      + "Open FEM 3D rekent het niet.");
  }
  // Belastingvlakken worden hier, vóór de kern, gewone staaf- en knooplasten
  // in hun eigen belastinggeval. Een vlak dat niet kan afdragen, blokkeert
  // het rekenen met zijn melding: een last valt nooit stil weg.
  const model = (input.loadPanels?.length ?? 0) > 0 ? withOpenFem3DLoadPanels(input).model : input;
  const plates = model.plates ?? [];
  if (plates.length > 0 && !plateMesh) {
    // Het net is asynchroon (Triangle); `solveOpenFem3D` maakt het vooraf.
    throw new Error("Het model bevat 3D-platen; maak eerst het plaatnet (meshOpenFem3DPlates).");
  }
  if ((model.surfaceLoads ?? []).some((load) => !plates.some((plate) => plate.id === load.plateId))) {
    throw new Error("Een 3D-oppervlaktebelasting verwijst naar een plaat die niet bestaat.");
  }
  if (model.nodes.length < 2 || (model.beams.length === 0 && plates.length === 0)) {
    throw new Error("Voeg minstens twee knopen en één staaf of plaat toe voordat je rekent.");
  }
  // Grondveren van staven (#106) en platen (#107) op bedding tellen als oplegging, net als in de kern.
  if ((model.supports ?? []).length === 0 && !plates.some((plate) => (plate.edgeSupports?.length ?? 0) > 0)
    && !model.beams.some((beam) => beam.bedding) && !plates.some((plate) => plate.bedding)) {
    throw new Error("Voeg minstens één 3D-oplegging toe.");
  }
  const selected = selectedLoads(model, loadSelection);
  const { nodalLoads, memberLoads, memberPointLoads, thermalLoads, surfaceLoads } = selected;
  // Montage van de trek-alleen staven na de permanente belasting: de
  // blijvende gevallen met factor 1,0 zijn de montagelasten. Zonder
  // trek-alleen staven heeft de instelling geen betekenis en gaat niets mee.
  const tensionOnly = model.beams.some((beam) => beam.tensionOnly);
  let fit: ReturnType<typeof selectedLoads> | undefined;
  if (tensionOnly && model.tensionOnlyFitAfterPermanent) {
    if (!options.permanentCaseIds) {
      throw new Error(
        "Trek-alleen staven gemonteerd na de permanente belasting: de blijvende belastinggevallen ontbreken in de aanroep.",
      );
    }
    fit = selectedLoads(model, new Map(options.permanentCaseIds.map((caseId) => [caseId, 1] as const)));
  }
  const hasPrescribedDisplacement = (model.supports ?? []).some((support) =>
    Object.keys(support.prescribed ?? {}).length > 0);
  if (nodalLoads.length === 0 && memberLoads.length === 0 && memberPointLoads.length === 0
    && thermalLoads.length === 0 && surfaceLoads.length === 0 && !hasPrescribedDisplacement) {
    throw new Error(loadSelection === undefined
      ? "Voeg minstens één 3D-belasting of opgelegde verplaatsing toe."
      : typeof loadSelection === "number"
        ? `Belastinggeval ${loadSelection} bevat geen 3D-belastingen.`
        : "De geselecteerde combinatie bevat geen 3D-belastingen met een niet-nulfactor.");
  }

  const materials: { id: number; name: string; eMpa: number; nu: number; gMpa?: number; alphaPerK: number }[] = [];
  const sections: OpenFem3DSolveRequestBody["sections"] = [];
  const materialIds = new Map<string, number>();
  const sectionIds = new Map<string, number>();
  const principalAngles = new Map<number, number>();

  const nodeIndex = new Map(model.nodes.map((node) => [node.id, node]));
  const members = model.beams.map((beam) => {
    const material = beam.material?.trim();
    const profile = beam.profileName?.trim();
    if (!material || !profile) {
      throw new Error(`Staaf ${beam.id}: wijs eerst een materiaal en profiel toe.`);
    }
    // Staaf op bedding (#106): dezelfde keuring als het model, zodat een
    // ongeldige bedding (bijv. een verticale k op een kolom) vóór de kern
    // een Nederlandse melding geeft.
    const bedding: OpenFem3DBeamBedding | undefined = beam.bedding
      ? readOpenFem3DBeamBedding(beam.bedding, nodeIndex.get(beam.startNodeId)!, nodeIndex.get(beam.endNodeId)!, `Staaf ${beam.id}`)
      : undefined;
    const resolved = resolveSection(material, profile);
    if (resolved.bron === "default") throw new Error(`Staaf ${beam.id}: ${resolved.reden ?? "doorsnede onbekend"}.`);
    const principal = openFem3DPrincipalSection(profile);
    if (principal) {
      if (beam.shearDeformation) {
        throw new Error(`Staaf ${beam.id}: afschuifvervorming voor een eigen doorsnede met gedraaide hoofdassen vereist Av;u en Av;v; die zijn niet bepaald.`);
      }
      for (const end of ["Start", "End"] as const) {
        if ((beam.releases?.[`my${end}`] ?? false) !== (beam.releases?.[`mz${end}`] ?? false)) {
          throw new Error(`Staaf ${beam.id}: een enkel My- of Mz-scharnier kan bij gedraaide hoofdassen niet exact worden omgezet; kies beide of geen van beide.`);
        }
      }
      principalAngles.set(beam.id, principal.angleRad);
    }
    // Verlopende staaf (#73): gelijke delen met de doorsnede van hun midden;
    // een eindprofiel dat niet bij het begin past, stopt hier met de reden.
    const start = nodeIndex.get(beam.startNodeId)!, end = nodeIndex.get(beam.endNodeId)!;
    const indeling = beam.profileNameEnd !== undefined
      ? openFem3DVerloopDelen(beam, Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z))
      : null;
    if (indeling && beam.shearDeformation) {
      throw new Error(`Staaf ${beam.id}: afschuifvervorming is nog niet beschikbaar voor een verlopend profiel.`);
    }

    let materialId = materialIds.get(material);
    if (!materialId) {
      materialId = materials.length + 1;
      materialIds.set(material, materialId);
      const analysisMaterial = resolveOpenFem3DAnalysisMaterial(material, resolved.E, poisson(material), model);
      materials.push({
        id: materialId, name: material, eMpa: analysisMaterial.eMpa, nu: analysisMaterial.nu,
        ...(timberGMean(material) !== undefined ? { gMpa: timberGMean(material) } : {}),
        alphaPerK: thermalAlphaForMaterial(material),
      });
    }

    // Een doorsnede van een verloop heet naar haar maten en wordt gedeeld op
    // die maten (exact), los van een catalogusdoorsnede met dezelfde naam.
    const verloopSectie = (doorsnede: OpenFem3DVerloopDoorsnede): number => {
      const key = `${material}\u0000verloop\u0000${JSON.stringify(doorsnede.maten)}`;
      let id = sectionIds.get(key);
      if (!id) {
        id = sections.length + 1;
        sectionIds.set(key, id);
        sections.push({
          id,
          name: doorsnede.naam,
          areaM2: doorsnede.areaMm2 * 1e-6,
          iyM4: doorsnede.iyMm4 * 1e-12,
          izM4: doorsnede.izMm4 * 1e-12,
          torsionJM4: doorsnede.itMm4 * 1e-12,
          // Werkelijke maten voor een temperatuurverschil over de doorsnede (#221).
          heightM: doorsnede.maten.h * 1e-3,
          widthM: doorsnede.maten.b * 1e-3,
        });
      }
      return id;
    };
    // Het contract vraagt 2 ≤ n. Onder 50 mm is er één deel (zoals in 2D):
    // dan rekent de staaf met de doorsnede van zijn midden, zonder lijst.
    const partSectionIds = indeling && indeling.delen.length >= 2
      ? indeling.delen.map((deel) => verloopSectie(deel.doorsnede))
      : undefined;
    const sectionKey = `${material}\u0000${profile}\u0000${beam.shearDeformation ? "timoshenko" : "bernoulli"}`;
    let sectionId = indeling
      ? verloopSectie(partSectionIds ? openFem3DVerloopDoorsnede(indeling.verloop, 0) : indeling.delen[0].doorsnede)
      : sectionIds.get(sectionKey);
    if (!sectionId) {
      let iyMm4 = resolved.I;
      let izMm4: number;
      let torsionJMm4: number;
      let shearAreaYMm2: number | undefined;
      let shearAreaZMm2: number | undefined;
      // Werkelijke hoogte (lokaal z) en breedte (lokaal y) in mm: een
      // temperatuurverschil over de doorsnede werkt daarover (EN 1991-1-5,
      // #221). Onbekend: niet meesturen, de kern weigert dan een gradiënt.
      let heightMm: number | undefined;
      let widthMm: number | undefined;
      const catalogueDims = STEEL_SECTION_DIMS[profileKey(profile)];
      const catalogue = catalogueDims?.props;
      const rectangle = parseRechthoek(profile);
      const eigen = isEigenProfiel(profile) ? zoekEigenDoorsnede(profile) : undefined;
      if (eigen) {
        const props = eigen.eigenschappen;
        iyMm4 = principal?.iuMm4 ?? props.iy_mm4;
        izMm4 = principal?.ivMm4 ?? props.iz_mm4;
        torsionJMm4 = props.it_mm4;
        shearAreaYMm2 = props.av_y_mm2;
        shearAreaZMm2 = props.av_z_mm2;
        // Bij gedraaide hoofdassen liggen h en b niet langs lokaal z en y.
        if (!principal) { heightMm = props.h_mm; widthMm = props.b_mm; }
      } else if (catalogue) {
        izMm4 = catalogue.iz;
        torsionJMm4 = catalogue.it;
        shearAreaYMm2 = catalogue.avY;
        shearAreaZMm2 = catalogue.avZ;
        heightMm = catalogueDims.h;
        widthMm = catalogueDims.b;
      } else if (rectangle) {
        izMm4 = rectangle.h * rectangle.b ** 3 / 12;
        torsionJMm4 = rechthoekTorsieconstante(rectangle.b, rectangle.h);
        shearAreaYMm2 = shearAreaZMm2 = 5 / 6 * rectangle.b * rectangle.h;
        heightMm = rectangle.h;
        widthMm = rectangle.b;
      } else if (resolved.bron === "beton-vorm") {
        // Betonnen T of L (issue #197): I_z, I_t en de afschuifoppervlakken
        // uit dezelfde hulpfunctie als A en I_y (`lib/betonDoorsnedeGrootheden`).
        const vorm = parseConcreteSection(profile);
        const g = vorm.ok ? betonDoorsnedeGrootheden(vorm.doorsnede) : null;
        if (!g) throw new Error(`Staaf ${beam.id}: betondoorsnede "${profile}" levert geen geldige grootheden.`);
        iyMm4 = g.Iy;
        izMm4 = g.Iz;
        torsionJMm4 = g.It;
        shearAreaYMm2 = g.AvY;
        shearAreaZMm2 = g.AvZ;
      } else {
        throw new Error(
          `Staaf ${beam.id}: profiel "${profile}" mist Iz en J voor een ruimtelijke berekening. ` +
          "Kies een bewaarde eigen doorsnede, catalogusprofiel, rechthoek b×h of betonnen T/L (\"T 400x450 bw=200 hf=50\").",
        );
      }
      if (![resolved.A, iyMm4, izMm4, torsionJMm4].every((value) => Number.isFinite(value) && value > 0)) {
        throw new Error(`Staaf ${beam.id}: profiel "${profile}" heeft geen geldige A, Iy, Iz of J voor de 3D-berekening.`);
      }
      if (beam.shearDeformation && (![shearAreaYMm2, shearAreaZMm2].every((value) =>
        typeof value === "number" && Number.isFinite(value) && value > 0))) {
        throw new Error(`Staaf ${beam.id}: profiel "${profile}" heeft geen geldige afschuifoppervlakken Av;y en Av;z.`);
      }
      sectionId = sections.length + 1;
      sectionIds.set(sectionKey, sectionId);
      sections.push({
        id: sectionId,
        name: profile,
        areaM2: resolved.A * 1e-6,
        iyM4: iyMm4 * 1e-12,
        izM4: izMm4 * 1e-12,
        torsionJM4: torsionJMm4 * 1e-12,
        ...(heightMm !== undefined && Number.isFinite(heightMm) && heightMm > 0 ? { heightM: heightMm * 1e-3 } : {}),
        ...(widthMm !== undefined && Number.isFinite(widthMm) && widthMm > 0 ? { widthM: widthMm * 1e-3 } : {}),
        ...(beam.shearDeformation ? {
          shearAreaYM2: shearAreaYMm2! * 1e-6,
          shearAreaZM2: shearAreaZMm2! * 1e-6,
        } : {}),
      });
    }
    return {
      id: beam.id,
      startNodeId: beam.startNodeId,
      endNodeId: beam.endNodeId,
      materialId,
      sectionId,
      // Alleen bij een verlopende staaf: een oudere kern kent het veld niet.
      ...(partSectionIds ? { partSectionIds } : {}),
      releases: beam.releases ?? {},
      ...(principal || beam.rollAngleRad !== undefined
        ? { rollAngleRad: (beam.rollAngleRad ?? 0) + (principal?.angleRad ?? 0) } : {}),
      ...(plateMesh?.beamIntermediateNodes.get(beam.id)?.length
        ? { intermediateNodeIds: plateMesh.beamIntermediateNodes.get(beam.id)! }
        : {}),
      // Alleen meesturen als het aan staat: een oudere kern kent het veld niet.
      ...(beam.tensionOnly ? { tensionOnly: true } : {}),
      // Idem voor de bedding: alleen bij een staaf op bedding (contract #106).
      ...(bedding ? { bedding } : {}),
    };
  });

  // Platen: eigen materiaalregels (isotroop, uit dezelfde bepaling als 2D).
  const plateEntries = plates.map((plate) => {
    const material = resolveOpenFem3DPlateMaterial(plate);
    const key = `plaat\u0000${material.name}`;
    let materialId = materialIds.get(key);
    if (!materialId) {
      materialId = materials.length + 1;
      materialIds.set(key, materialId);
      const analysisMaterial = resolveOpenFem3DAnalysisMaterial(material.name, material.eMpa, material.nu, model);
      materials.push({
        id: materialId, name: material.name, eMpa: analysisMaterial.eMpa, nu: analysisMaterial.nu,
        alphaPerK: thermalAlphaForMaterial(material.name),
      });
    }
    // Plaat op bedding (#107): dezelfde keuring als het model, zodat een
    // ongeldige bedding vóór de kern een Nederlandse melding geeft. Alleen
    // meesturen bij een plaat op bedding: een oudere kern kent het veld niet.
    const bedding: OpenFem3DPlateBedding | undefined = plate.bedding
      ? readOpenFem3DPlateBedding(plate.bedding, `3D-plaat ${plate.id}`)
      : undefined;
    return { id: plate.id, materialId, thicknessM: plate.thicknessM, ...(bedding ? { bedding } : {}) };
  });
  const shellElements = (plateMesh?.elements ?? []).map((element) => ({
    id: element.id, plateId: element.plateId, nodeIds: [...element.nodeIds],
  }));
  // Knopen: bij platen alleen de knopen waar iets aan hangt (een afgeronde
  // plaathoek ligt bijvoorbeeld buiten de plaat), plus de nieuwe meshknopen.
  let nodes: { id: number; x: number; y: number; z: number }[] = model.nodes;
  if (plateMesh && (plateMesh.elements.length > 0 || plateMesh.beamIntermediateNodes.size > 0)) {
    const referenced = new Set<number>();
    for (const beam of model.beams) { referenced.add(beam.startNodeId); referenced.add(beam.endNodeId); }
    for (const element of plateMesh.elements) for (const id of element.nodeIds) referenced.add(id);
    for (const ids of plateMesh.beamIntermediateNodes.values()) for (const id of ids) referenced.add(id);
    for (const support of model.supports ?? []) referenced.add(support.nodeId);
    for (const load of nodalLoads) referenced.add(load.nodeId);
    for (const load of fit?.nodalLoads ?? []) referenced.add(load.nodeId);
    nodes = [...model.nodes.filter((node) => referenced.has(node.id)), ...plateMesh.nodes];
  }
  // Randopleggingen van platen: elke rekenknoop op die rand krijgt de
  // blokkeringen; samen met een knoopoplegging op dezelfde knoop tellen beide.
  const dofs = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;
  const springKeys = ["kxKnPerM", "kyKnPerM", "kzKnPerM", "krxKnmPerRad", "kryKnmPerRad", "krzKnmPerRad"] as const;
  const supports: OpenFem3DSupport[] = (model.supports ?? []).map((support) => ({ ...support }));
  const supportIndex = new Map(supports.map((support, index) => [support.nodeId, index]));
  for (const plate of plates) {
    const edges = plateMesh?.plateEdgeNodes.get(plate.id);
    for (const edgeSupport of plate.edgeSupports ?? []) {
      const edgeNodes = edges?.[edgeSupport.edge] ?? [];
      if (edgeNodes.length === 0) {
        throw new Error(`3D-plaat ${plate.id}: de randoplegging op rand ${edgeSupport.edge + 1} vindt geen rekenknopen op die rand.`);
      }
      for (const nodeId of edgeNodes) {
        const index = supportIndex.get(nodeId);
        if (index === undefined) {
          supportIndex.set(nodeId, supports.length);
          supports.push({ nodeId, ...Object.fromEntries(dofs.map((dof) => [dof, edgeSupport[dof]])) } as OpenFem3DSupport);
          continue;
        }
        const existing = supports[index];
        dofs.forEach((dof, k) => {
          if (!edgeSupport[dof]) return;
          if (existing.springs?.[springKeys[k]] !== undefined) {
            throw new Error(
              `Knoop ${nodeId} heeft een veer op ${dof.toUpperCase()}, maar de randoplegging van plaat ${plate.id} ` +
              "blokkeert die vrijheidsgraad. Kies één van beide.",
            );
          }
          existing[dof] = true;
        });
      }
    }
  }
  const usesContract2 = plateEntries.length > 0
    || members.some((member) => "intermediateNodeIds" in member);

  return {
    schemaVersion: usesContract2 ? 2 : 1,
    analysis,
    // Alleen de meetkunde: de kern weigert onbekende velden (deny_unknown_fields),
    // en een levelkoppeling (`levelId`) of naam is modelinvoer, geen rekeninvoer.
    nodes: nodes.map(({ id, x, y, z }) => ({ id, x, y, z })),
    materials,
    sections,
    members,
    supports: supports.map(({ springs, prescribed, layerId: _layerId, ...support }) => ({
      ...support,
      ...(springs ?? {}),
      ...(prescribed?.uxM !== undefined ? { uxPrescribedM: prescribed.uxM } : {}),
      ...(prescribed?.uyM !== undefined ? { uyPrescribedM: prescribed.uyM } : {}),
      ...(prescribed?.uzM !== undefined ? { uzPrescribedM: prescribed.uzM } : {}),
      ...(prescribed?.rxRad !== undefined ? { rxPrescribedRad: prescribed.rxRad } : {}),
      ...(prescribed?.ryRad !== undefined ? { ryPrescribedRad: prescribed.ryRad } : {}),
      ...(prescribed?.rzRad !== undefined ? { rzPrescribedRad: prescribed.rzRad } : {}),
    })),
    ...contractLoads(selected, principalAngles),
    // Alleen meesturen als er platen zijn: een staafmodel blijft zo exact
    // het contract van versie 1.
    ...(plateEntries.length > 0 ? { plates: plateEntries, shellElements, surfaceLoads } : {}),
    // Starre schijven: alleen id en knopen; de naam is modelinvoer. Hoogte,
    // dubbele knopen en opleggingen keurt de kern met een duidelijke melding.
    ...((model.diaphragms?.length ?? 0) > 0
      ? { diaphragms: model.diaphragms!.map(({ id, nodeIds }) => ({ id, nodeIds: [...nodeIds] })) }
      : {}),
    // Alleen meesturen als het aan staat en er trek-alleen staven zijn: zonder
    // de velden rekent de kern precies als voorheen.
    ...(fit
      ? { tensionOnlyFit: { ...contractLoads(fit, principalAngles), ...(plateEntries.length > 0 ? { surfaceLoads: fit.surfaceLoads } : {}) } }
      : {}),
    ...(tensionOnly && model.tensionOnlyCrossRule ? { tensionOnlyCrossRule: true } : {}),
    maxIterations: 50,
    tolerance: 1e-8,
    bucklingModes: 3,
  };
}

/**
 * Het rekennet van de platen, één keer per modelstand. Het model is
 * onveranderlijk: zolang platen, knopen en staven dezelfde objecten zijn,
 * rekenen alle belastinggevallen en combinaties met hetzelfde net.
 */
const plateMeshCache = new WeakMap<object, {
  nodes: OpenFem3DModel["nodes"]; beams: OpenFem3DModel["beams"]; mesh: Promise<OpenFem3DPlateMesh>;
}>();

export function openFem3DPlateMeshFor(model: OpenFem3DModel): Promise<OpenFem3DPlateMesh> | null {
  const plates = model.plates;
  if (!plates || plates.length === 0) return null;
  const cached = plateMeshCache.get(plates);
  if (cached && cached.nodes === model.nodes && cached.beams === model.beams) return cached.mesh;
  const mesh = meshOpenFem3DPlates(model);
  // Een mislukt net niet bewaren: de volgende poging meldt de fout opnieuw.
  mesh.catch(() => plateMeshCache.delete(plates));
  plateMeshCache.set(plates, { nodes: model.nodes, beams: model.beams, mesh });
  return mesh;
}

/** De tekst die meegaat als platen eerste orde rekenen terwijl tweede orde gevraagd was. */
export const OPEN_FEM_3D_PLATES_LINEAR_NOTICE =
  "Tweede orde (P-Δ) is voor platen in de 3D-kern nog niet beschikbaar; dit resultaat is eerste orde (lineair) berekend.";

/**
 * De reden waarom de toets (issue #199, besluit B8) een model met platen
 * weigert: de toets rekent altijd P-Δ met scheefstand, en voor platen kan de
 * 3D-kern dat niet. Een terugval op eerste orde is voor de toets uitgesloten.
 */
export const OPEN_FEM_3D_PLATES_NO_SECOND_ORDER =
  "Geen tweede-ordeberekening met platen: de 3D-rekenkern kent voor plaatelementen geen geometrische " +
  "stijfheid (K_G), dus de P-Δ-berekening met scheefstand waarop de toets rust, is voor dit model niet " +
  "uit te voeren.";

/** Eén rekenverzoek aan de 3D-kern, met wat nodig is om de uitkomst te lezen. */
export interface OpenFem3DRekenverzoek {
  /** Het verzoek zoals het naar de kern gaat (met scheefstand en knikvormen). */
  input: OpenFem3DSolveRequestBody;
  /** Per staaf de hoek tussen de hoofdassen en de modelassen; leeg als die overal samenvallen. */
  principalAngles: ReadonlyMap<number, number>;
  /** De analyse die de kern werkelijk rekent: lineair bij een model met platen. */
  effective: OpenFem3DAnalysisKind;
}

/**
 * Het rekenverzoek van één lastkeuze, precies zoals de knop Berekenen het naar
 * de 3D-kern stuurt: de analyse (lineair bij platen), het verzoek van
 * `buildOpenFem3DSolveRequest`, de scheefstand (`metScheefstandLasten`) en het
 * aantal knikvormen. De app rekent ermee (`solveOpenFem3DCombination`), de
 * 3D-MCP-paden (`mcp/toets3dSidecar.ts`) geven het verzoek aan Rust; zo rekent
 * de toets langs beide wegen met hetzelfde verzoek.
 */
export function openFem3DRekenverzoek(
  model: OpenFem3DModel,
  selection: OpenFem3DLoadSelection | undefined,
  analysis: OpenFem3DAnalysisKind,
  /** Initiële scheefstand in één richting (EN 1993-1-1 §5.3.2); null = zonder. */
  scheefstand: OpenFem3DScheefstand | null = null,
  options: OpenFem3DSolveOptions = {},
  mesh?: OpenFem3DPlateMesh,
): OpenFem3DRekenverzoek {
  // De externe 3D-kern kent voor plaatelementen geen geometrische stijfheid
  // in de P-Delta-iteratie; een model met platen rekent daarom lineair, en
  // het resultaat zegt dat zichtbaar.
  const effective: OpenFem3DAnalysisKind = mesh && mesh.elements.length > 0 ? "linear" : analysis;
  // De toets vraagt P-Δ en weigert de terugval (issue #199, B8).
  if (options.tweedeOrdeVerplicht && effective !== analysis) throw new Error(OPEN_FEM_3D_PLATES_NO_SECOND_ORDER);
  const opgebouwd = buildOpenFem3DSolveRequest(model, effective, selection, mesh, options);
  // De hoofdashoek wordt uit het gebouwde verzoek afgeleid, zodat een wijziging
  // in de profielbibliotheek tijdens de asynchrone solvercall de uitkomst niet
  // met een andere hoek kan terugdraaien.
  const principalAngles = new Map(model.beams.flatMap((beam) => {
    const member = opgebouwd.members.find((item) => item.id === beam.id);
    const offset = (member?.rollAngleRad ?? 0) - (beam.rollAngleRad ?? 0);
    return Math.abs(offset) > 1e-12 ? [[beam.id, offset] as const] : [];
  }));
  const request = scheefstand ? metScheefstandLasten(opgebouwd, scheefstand) : opgebouwd;
  const input = effective === "linear"
    ? { ...request, bucklingModes: 0 }
    : options.bucklingModes !== undefined ? { ...request, bucklingModes: options.bucklingModes } : request;
  return { input, principalAngles, effective };
}

/**
 * Een uitkomst van de 3D-kern voor een model zonder platen, zoals de app hem
 * na `solveOpenFem3DCombination` heeft: met de onafhankelijke krachtensom,
 * terug in de modelassen, en met de meldingen van de belastingvlakken en de
 * kabelwerking. Voor de 3D-MCP-paden, die de kern via Rust aanroepen.
 */
export function openFem3DUitkomstVanKern(
  model: OpenFem3DModel,
  selection: OpenFem3DLoadSelection | undefined,
  verzoek: Pick<OpenFem3DRekenverzoek, "input" | "principalAngles">,
  ruw: OpenFem3DSolveResult,
  options: OpenFem3DSolveOptions = {},
): OpenFem3DSolveResult {
  const result = fromOpenFem3DPrincipalResult(metOpenFem3DKrachtensom(verzoek.input, ruw), verzoek.principalAngles);
  return withOpenFem3DCableSelfWeightNotice(withLoadPanelDiagnostics(result, model, selection), model, selection, options);
}

async function solveWithPlates(
  model: OpenFem3DModel,
  selection: OpenFem3DLoadSelection | undefined,
  analysis: OpenFem3DAnalysisKind,
  /** Initiële scheefstand in één richting (EN 1993-1-1 §5.3.2); null = zonder. */
  scheefstand: OpenFem3DScheefstand | null = null,
  options: OpenFem3DSolveOptions = {},
): Promise<OpenFem3DSolveResult> {
  const meshPromise = openFem3DPlateMeshFor(model);
  const mesh = meshPromise ? await meshPromise : undefined;
  const { input, principalAngles, effective } = openFem3DRekenverzoek(model, selection, analysis, scheefstand, options, mesh);
  const result = fromOpenFem3DPrincipalResult(await callOpenFem3DSolver(input), principalAngles);
  if (!mesh) return result;
  const notices = [...mesh.notices];
  if (effective !== analysis) notices.unshift(OPEN_FEM_3D_PLATES_LINEAR_NOTICE);
  return { ...result, plateMesh: mesh, diagnostics: [...notices, ...result.diagnostics] };
}

/**
 * Meldingen van de belastingvlakken die in deze rekengang meedoen: een rand
 * zonder ligger of een strook die als puntlast verhuist, hoort bij het
 * resultaat te staan en niet alleen in het eigenschappenpaneel.
 */
function withLoadPanelDiagnostics(
  result: OpenFem3DSolveResult, model: OpenFem3DModel, selection: OpenFem3DLoadSelection | undefined,
): OpenFem3DSolveResult {
  if ((model.loadPanels?.length ?? 0) === 0) return result;
  const messages = withOpenFem3DLoadPanels(model).warnings
    .filter((warning) => factorForLoad(selection, warning.caseId) !== 0)
    .map((warning) => warning.message);
  return messages.length > 0 ? { ...result, diagnostics: [...result.diagnostics, ...messages] } : result;
}

/** De melding dat het eigen gewicht van trek-alleen staven als knooplasten werkt. */
export const OPEN_FEM_3D_CABLE_SELF_WEIGHT_NOTICE =
  "Eigen gewicht van trek-alleen staven als knooplasten op hun einden (kabelwerking): elk einde de helft van ρ·A·g·L in −Z; geen buigend moment in de staaf.";

/**
 * Zet die melding bij een uitkomst die het eigen-gewichtgeval meerekent, als
 * het model trek-alleen staven heeft (zie `withOpenFem3DSelfWeight`).
 */
export function withOpenFem3DCableSelfWeightNotice<R extends { diagnostics: string[] }>(
  result: R, model: OpenFem3DModel, selection: OpenFem3DLoadSelection | undefined,
  options: OpenFem3DSolveOptions,
): R {
  if (options.selfWeightCaseId === undefined || !model.beams.some((beam) => beam.tensionOnly)) return result;
  if (factorForLoad(selection, options.selfWeightCaseId) === 0) return result;
  return { ...result, diagnostics: [...result.diagnostics, OPEN_FEM_3D_CABLE_SELF_WEIGHT_NOTICE] };
}

export async function solveOpenFem3D(
  model: OpenFem3DModel,
  activeLoadCaseId?: number,
  analysis: OpenFem3DAnalysisKind = "p-delta",
  options: OpenFem3DSolveOptions = {},
): Promise<OpenFem3DSolveResult> {
  const result = await solveWithPlates(model, activeLoadCaseId, analysis, null, options);
  return withOpenFem3DCableSelfWeightNotice(withLoadPanelDiagnostics(result, model, activeLoadCaseId), model, activeLoadCaseId, options);
}

/** Los één belastingcombinatie rechtstreeks als tweede-ordeprobleem op. */
export async function solveOpenFem3DCombination(
  model: OpenFem3DModel,
  factors: ReadonlyMap<number, number>,
  analysis: OpenFem3DAnalysisKind = "p-delta",
  /** Initiële scheefstand in één richting (EN 1993-1-1 §5.3.2); null = zonder. */
  scheefstand: OpenFem3DScheefstand | null = null,
  options: OpenFem3DSolveOptions = {},
): Promise<OpenFem3DSolveResult> {
  const result = await solveWithPlates(model, factors, analysis, scheefstand, options);
  return withOpenFem3DCableSelfWeightNotice(withLoadPanelDiagnostics(result, model, factors), model, factors, options);
}

/**
 * Een lijnlast in het rekencontract: lokaal (qy/qz) of, sinds issue #80, in
 * een globale richting met q langs die as (Z negatief = omlaag), per
 * staafmeter of met `perProjection` per meter projectie loodrecht op de
 * lastrichting. Een globale last draagt geen lokale velden.
 */
export type OpenFem3DMemberLoadBody =
  | {
      id: number; memberId: number; qyStartKnPerM: number; qyEndKnPerM: number;
      qzStartKnPerM: number; qzEndKnPerM: number; startPositionM: number; endPositionM: number;
      globalDirection?: undefined;
    }
  | {
      id: number; memberId: number; globalDirection: OpenFem3DGlobalDirection;
      qStartKnPerM: number; qEndKnPerM: number; perProjection?: boolean;
      startPositionM: number; endPositionM: number;
    };

/** Het versievaste rekenverzoek aan de Rust-adapter (contract 1 of 2). */
export interface OpenFem3DSolveRequestBody {
  schemaVersion: 1 | 2;
  analysis: OpenFem3DAnalysisKind;
  nodes: { id: number; x: number; y: number; z: number }[];
  materials: { id: number; name: string; eMpa: number; nu: number; gMpa?: number; alphaPerK: number }[];
  sections: { id: number; name: string; areaM2: number; iyM4: number; izM4: number; torsionJM4: number;
    shearAreaYM2?: number; shearAreaZM2?: number;
    /** Werkelijke hoogte langs lokaal z en breedte langs lokaal y in m (#221). */
    heightM?: number; widthM?: number }[];
  members: {
    id: number; startNodeId: number; endNodeId: number; materialId: number; sectionId: number;
    /**
     * Verlopende staaf (#73): de staaf in n = lengte gelijke delen, deel i
     * (vanaf de beginknoop) met doorsnede partSectionIds[i]; 2 ≤ n ≤ 64.
     * `sectionId` is dan de doorsnede van het begin.
     */
    partSectionIds?: number[];
    releases: Partial<Record<"myStart" | "myEnd" | "mzStart" | "mzEnd" | "torsionStart" | "torsionEnd", boolean>>;
    rollAngleRad?: number;
    intermediateNodeIds?: number[];
    tensionOnly?: boolean;
    /** Staaf op bedding: dezelfde velden als in het model (m, kN/m³). */
    bedding?: OpenFem3DBeamBedding;
  }[];
  supports: (Record<string, unknown> & { nodeId: number })[];
  nodalLoads: { id: number; nodeId: number; fx: number; fy: number; fz: number; mx: number; my: number; mz: number }[];
  memberLoads: OpenFem3DMemberLoadBody[];
  memberPointLoads: { id: number; memberId: number; pyKn: number; pzKn: number; positionM: number }[];
  thermalLoads: {
    id: number; memberId: number; deltaTUniformK: number; deltaTGradientYK: number; deltaTGradientZK: number;
  }[];
  /** Plaat op bedding (#107): dezelfde velden als in het model (kN/m³). */
  plates?: { id: number; materialId: number; thicknessM: number; bedding?: OpenFem3DPlateBedding }[];
  shellElements?: { id: number; plateId: number; nodeIds: number[] }[];
  surfaceLoads?: { id: number; plateId: number; qxKnPerM2: number; qyKnPerM2: number; qzKnPerM2: number }[];
  diaphragms?: { id: number; nodeIds: number[] }[];
  /** Montagelasten van de trek-alleen staven: de blijvende gevallen met factor 1,0. */
  tensionOnlyFit?: OpenFem3DTensionOnlyFitBody;
  /** Kruisregel: van twee kruisende trek-alleen staven blijft er altijd één actief. */
  tensionOnlyCrossRule?: boolean;
  maxIterations: number;
  tolerance: number;
  bucklingModes: number;
}

/** De montagelasten in het rekencontract: dezelfde vorm als de gewone lasten. */
export interface OpenFem3DTensionOnlyFitBody {
  nodalLoads: OpenFem3DSolveRequestBody["nodalLoads"];
  memberLoads: OpenFem3DSolveRequestBody["memberLoads"];
  memberPointLoads: OpenFem3DSolveRequestBody["memberPointLoads"];
  thermalLoads: OpenFem3DSolveRequestBody["thermalLoads"];
  surfaceLoads?: NonNullable<OpenFem3DSolveRequestBody["surfaceLoads"]>;
}

/**
 * De onafhankelijke krachtensom bij een uitkomst van de kern (`forceBalance`),
 * zoals elke berekening van de app hem krijgt.
 */
export function metOpenFem3DKrachtensom(
  input: OpenFem3DSolveRequestBody, result: OpenFem3DSolveResult,
): OpenFem3DSolveResult {
  // Met zijdelingse grondkrachten op een paal sluit de onafhankelijke som
  // niet (hun richting staat niet in het resultaat); zeg dat in plaats van
  // een afwijking te melden die er niet is.
  if (openFem3DBeddingPileLateralForces(input, result)) {
    const { forceBalance: _niet, ...rest } = result;
    return { ...rest, diagnostics: [...result.diagnostics, OPEN_FEM_3D_BEDDING_LATERAL_BALANCE_NOTICE] };
  }
  return { ...result, forceBalance: openFem3DGlobalForceBalance(input, result) };
}

async function callOpenFem3DSolver(input: OpenFem3DSolveRequestBody): Promise<OpenFem3DSolveResult> {
  const checked = (result: OpenFem3DSolveResult): OpenFem3DSolveResult => metOpenFem3DKrachtensom(input, result);
  const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
  const usesLegacyCompatibleLoads = input.schemaVersion === 1
    && input.memberLoads.length === 0
    && input.memberPointLoads.length === 0
    && input.thermalLoads.length === 0;
  const isLegacyMaterialContract = (error: unknown) => usesLegacyCompatibleLoads
    && errorText(error).includes("unknown field `alphaPerK`");
  const legacyInput = () => {
    const {
      memberLoads: _memberLoads,
      memberPointLoads: _memberPointLoads,
      thermalLoads: _thermalLoads,
      ...legacy
    } = input;
    return {
      ...legacy,
      materials: input.materials.map(({ alphaPerK: _alphaPerK, ...material }) => material),
    };
  };
  if (isTauriApp()) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      return checked(await invoke<OpenFem3DSolveResult>("solve_open_fem_3d", { input }));
    } catch (error) {
      if (!isLegacyMaterialContract(error)) throw error;
      return checked(await invoke<OpenFem3DSolveResult>("solve_open_fem_3d", { input: legacyInput() }));
    }
  }
  const post = async (request: typeof input | ReturnType<typeof legacyInput>) => {
    const response = await fetch("/api/openFem3d/solve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const data = await response.json().catch(() => ({})) as OpenFem3DSolveResult & { fout?: string };
    if (!response.ok || data.fout) throw new Error(data.fout || `3D-rekenkern gaf HTTP ${response.status}`);
    return checked(data);
  };
  try {
    return await post(input);
  } catch (error) {
    if (!isLegacyMaterialContract(error)) throw error;
    return post(legacyInput());
  }
}

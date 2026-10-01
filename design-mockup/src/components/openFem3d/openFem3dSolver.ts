import { isTauriApp } from "../../lib/tauri";
import {
  CONCRETE_E_CM,
  NU_BETON,
  NU_STAAL,
  parseRechthoek,
  resolveSection,
} from "../../lib/sectionResolver";
import { STEEL_GRADES } from "../../lib/steelGrades";
import { STEEL_SECTION_DIMS } from "../../lib/steelSectionDims.generated";
import { profielAliasSleutel } from "../../lib/strip";
import { thermalAlphaForMaterial } from "../../lib/thermalAlpha";
import {
  openFem3DLoadCaseId, openFem3DMemberAxes, type OpenFem3DModel, type OpenFem3DSupport,
} from "./openFem3dModel";
import { withOpenFem3DLoadPanels } from "./openFem3dLoadPanels";
import { metScheefstandLasten, type OpenFem3DScheefstand } from "./openFem3dScheefstand";
import { meshOpenFem3DPlates, type OpenFem3DPlateMesh } from "./openFem3dPlateMesh";
import { resolveOpenFem3DPlateMaterial } from "./openFem3dPlateMaterial";
import { openFem3DSecondOrderMomentKnm } from "./openFem3dTrekSchijf";

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
}

/**
 * Controleer de globale statica onafhankelijk van de kern: de kracht- en
 * momentensom van lasten en reacties om de oorsprong. Bij een P-Δ-uitkomst
 * staat het evenwicht in de vervormde stand; de momentensom in de
 * onvervormde stand is daar exact het tweede-ordemoment Σ N·(e_x × Δu), dat
 * hier uit de staafkrachten en verplaatsingen van dezelfde uitkomst volgt.
 */
export function openFem3DGlobalForceBalance(
  input: Omit<OpenFem3DSolveRequestBody, "bucklingModes">,
  result: Pick<OpenFem3DSolveResult, "reactions">
    & Partial<Pick<OpenFem3DSolveResult, "analysis" | "displacements" | "memberForces">>,
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
  for (const reaction of result.reactions) {
    const node = nodeById.get(reaction.nodeId);
    if (!node) throw new Error(`Reactieknoop ${reaction.nodeId} ontbreekt bij de onafhankelijke momentensom.`);
    imbalanceKn[0] += reaction.fx;
    imbalanceKn[1] += reaction.fy;
    imbalanceKn[2] += reaction.fz;
    add(momentImbalanceKnm, cross([node.x, node.y, node.z], [reaction.fx, reaction.fy, reaction.fz]));
    add(momentImbalanceKnm, [reaction.mx, reaction.my, reaction.mz]);
  }
  const secondOrderMomentKnm = result.analysis === "p-delta" && result.displacements && result.memberForces
    ? openFem3DSecondOrderMomentKnm(input, { displacements: result.displacements, memberForces: result.memberForces })
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
  return profielAliasSleutel(
    value.toUpperCase().split("").filter((character) => ![" ", "-", "."].includes(character)).join(""),
  );
}

function rectangleTorsionConstant(bMm: number, hMm: number): number {
  const long = Math.max(bMm, hMm);
  const short = Math.min(bMm, hMm);
  return long * short ** 3 * (1 / 3 - 0.21 * (short / long) * (1 - short ** 4 / (12 * long ** 4)));
}

function poisson(material: string): number {
  if (material in CONCRETE_E_CM) return NU_BETON;
  if (STEEL_GRADES.includes(material.toUpperCase())) return NU_STAAL;
  if (/^(EN\s*AW|ALUMINIUM|ALUMINUM|VRIJ:)/i.test(material)) return NU_STAAL;
  throw new Error(
    `Materiaal "${material}" heeft in 3D nog geen betrouwbare torsiestijfheid. ` +
    "Gebruik voor deze eerste rekenroute staal, beton, aluminium of een vrij isotroop materiaal.",
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
  const memberLoads = (model.memberLoads ?? []).flatMap((load) => {
    const factor = factorForLoad(loadSelection, openFem3DLoadCaseId(load));
    if (factor === 0) return [];
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
function contractLoads(loads: ReturnType<typeof selectedLoads>) {
  return {
    nodalLoads: loads.nodalLoads.map(({ caseId: _caseId, ...load }) => load),
    memberLoads: loads.memberLoads.map((load) => ({
      id: load.id,
      memberId: load.beamId,
      qyStartKnPerM: load.qyStart,
      qyEndKnPerM: load.qyEnd,
      qzStartKnPerM: load.qzStart,
      qzEndKnPerM: load.qzEnd,
      startPositionM: load.startPositionM,
      endPositionM: load.endPositionM,
    })),
    memberPointLoads: loads.memberPointLoads.map((load) => ({
      id: load.id,
      memberId: load.beamId,
      pyKn: load.py,
      pzKn: load.pz,
      positionM: load.positionM,
    })),
    thermalLoads: loads.thermalLoads.map((load) => ({
      id: load.id,
      memberId: load.beamId,
      deltaTUniformK: load.deltaTUniformK,
      deltaTGradientYK: load.deltaTGradientYK,
      deltaTGradientZK: load.deltaTGradientZK,
    })),
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
  if ((model.supports ?? []).length === 0 && !plates.some((plate) => (plate.edgeSupports?.length ?? 0) > 0)) {
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

  const materials: { id: number; name: string; eMpa: number; nu: number; alphaPerK: number }[] = [];
  const sections: { id: number; name: string; areaM2: number; iyM4: number; izM4: number; torsionJM4: number }[] = [];
  const materialIds = new Map<string, number>();
  const sectionIds = new Map<string, number>();

  const members = model.beams.map((beam) => {
    const material = beam.material?.trim();
    const profile = beam.profileName?.trim();
    if (!material || !profile) {
      throw new Error(`Staaf ${beam.id}: wijs eerst een materiaal en profiel toe.`);
    }
    const resolved = resolveSection(material, profile);
    if (resolved.bron === "default") throw new Error(`Staaf ${beam.id}: ${resolved.reden ?? "doorsnede onbekend"}.`);

    let materialId = materialIds.get(material);
    if (!materialId) {
      materialId = materials.length + 1;
      materialIds.set(material, materialId);
      materials.push({
        id: materialId, name: material, eMpa: resolved.E, nu: poisson(material),
        alphaPerK: thermalAlphaForMaterial(material),
      });
    }

    const sectionKey = `${material}\u0000${profile}`;
    let sectionId = sectionIds.get(sectionKey);
    if (!sectionId) {
      let izMm4: number;
      let torsionJMm4: number;
      const catalogue = STEEL_SECTION_DIMS[profileKey(profile)]?.props;
      const rectangle = parseRechthoek(profile);
      if (catalogue) {
        izMm4 = catalogue.iz;
        torsionJMm4 = catalogue.it;
      } else if (rectangle) {
        izMm4 = rectangle.h * rectangle.b ** 3 / 12;
        torsionJMm4 = rectangleTorsionConstant(rectangle.b, rectangle.h);
      } else {
        throw new Error(
          `Staaf ${beam.id}: profiel "${profile}" mist Iz en J voor een ruimtelijke berekening. ` +
          "Kies een catalogusprofiel of rechthoek b×h.",
        );
      }
      sectionId = sections.length + 1;
      sectionIds.set(sectionKey, sectionId);
      sections.push({
        id: sectionId,
        name: profile,
        areaM2: resolved.A * 1e-6,
        iyM4: resolved.I * 1e-12,
        izM4: izMm4 * 1e-12,
        torsionJM4: torsionJMm4 * 1e-12,
      });
    }
    return {
      id: beam.id,
      startNodeId: beam.startNodeId,
      endNodeId: beam.endNodeId,
      materialId,
      sectionId,
      releases: beam.releases ?? {},
      ...(beam.rollAngleRad !== undefined ? { rollAngleRad: beam.rollAngleRad } : {}),
      ...(plateMesh?.beamIntermediateNodes.get(beam.id)?.length
        ? { intermediateNodeIds: plateMesh.beamIntermediateNodes.get(beam.id)! }
        : {}),
      // Alleen meesturen als het aan staat: een oudere kern kent het veld niet.
      ...(beam.tensionOnly ? { tensionOnly: true } : {}),
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
      materials.push({
        id: materialId, name: material.name, eMpa: material.eMpa, nu: material.nu,
        alphaPerK: thermalAlphaForMaterial(material.name),
      });
    }
    return { id: plate.id, materialId, thicknessM: plate.thicknessM };
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
    supports: supports.map(({ springs, prescribed, ...support }) => ({
      ...support,
      ...(springs ?? {}),
      ...(prescribed?.uxM !== undefined ? { uxPrescribedM: prescribed.uxM } : {}),
      ...(prescribed?.uyM !== undefined ? { uyPrescribedM: prescribed.uyM } : {}),
      ...(prescribed?.uzM !== undefined ? { uzPrescribedM: prescribed.uzM } : {}),
      ...(prescribed?.rxRad !== undefined ? { rxPrescribedRad: prescribed.rxRad } : {}),
      ...(prescribed?.ryRad !== undefined ? { ryPrescribedRad: prescribed.ryRad } : {}),
      ...(prescribed?.rzRad !== undefined ? { rzPrescribedRad: prescribed.rzRad } : {}),
    })),
    ...contractLoads(selected),
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
      ? { tensionOnlyFit: { ...contractLoads(fit), ...(plateEntries.length > 0 ? { surfaceLoads: fit.surfaceLoads } : {}) } }
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
  // De externe 3D-kern kent voor plaatelementen geen geometrische stijfheid
  // in de P-Delta-iteratie; een model met platen rekent daarom lineair, en
  // het resultaat zegt dat zichtbaar.
  const effective: OpenFem3DAnalysisKind = mesh && mesh.elements.length > 0 ? "linear" : analysis;
  const opgebouwd = buildOpenFem3DSolveRequest(model, effective, selection, mesh, options);
  const request = scheefstand ? metScheefstandLasten(opgebouwd, scheefstand) : opgebouwd;
  const input = effective === "linear" ? { ...request, bucklingModes: 0 } : request;
  const result = await callOpenFem3DSolver(input);
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

/** Het versievaste rekenverzoek aan de Rust-adapter (contract 1 of 2). */
export interface OpenFem3DSolveRequestBody {
  schemaVersion: 1 | 2;
  analysis: OpenFem3DAnalysisKind;
  nodes: { id: number; x: number; y: number; z: number }[];
  materials: { id: number; name: string; eMpa: number; nu: number; alphaPerK: number }[];
  sections: { id: number; name: string; areaM2: number; iyM4: number; izM4: number; torsionJM4: number }[];
  members: {
    id: number; startNodeId: number; endNodeId: number; materialId: number; sectionId: number;
    releases: Partial<Record<"myStart" | "myEnd" | "mzStart" | "mzEnd" | "torsionStart" | "torsionEnd", boolean>>;
    rollAngleRad?: number;
    intermediateNodeIds?: number[];
    tensionOnly?: boolean;
  }[];
  supports: (Record<string, unknown> & { nodeId: number })[];
  nodalLoads: { id: number; nodeId: number; fx: number; fy: number; fz: number; mx: number; my: number; mz: number }[];
  memberLoads: {
    id: number; memberId: number; qyStartKnPerM: number; qyEndKnPerM: number;
    qzStartKnPerM: number; qzEndKnPerM: number; startPositionM: number; endPositionM: number;
  }[];
  memberPointLoads: { id: number; memberId: number; pyKn: number; pzKn: number; positionM: number }[];
  thermalLoads: {
    id: number; memberId: number; deltaTUniformK: number; deltaTGradientYK: number; deltaTGradientZK: number;
  }[];
  plates?: { id: number; materialId: number; thicknessM: number }[];
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

async function callOpenFem3DSolver(input: OpenFem3DSolveRequestBody): Promise<OpenFem3DSolveResult> {
  const checked = (result: OpenFem3DSolveResult): OpenFem3DSolveResult => ({
    ...result,
    forceBalance: openFem3DGlobalForceBalance(input, result),
  });
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

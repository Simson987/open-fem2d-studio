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
import { thermalAlphaForMaterial } from "../../lib/thermalAlpha";
import { frame3DLoadCaseId, frame3DMemberAxes, type Frame3DModel } from "./frame3dModel";

export type Frame3DAnalysisKind = "linear" | "p-delta";

export interface Frame3DDisplacement {
  nodeId: number;
  ux: number; uy: number; uz: number;
  rx: number; ry: number; rz: number;
}

export interface Frame3DReaction {
  nodeId: number;
  fx: number; fy: number; fz: number;
  mx: number; my: number; mz: number;
}

export interface Frame3DMemberForces {
  memberId: number;
  lengthM: number;
  nStartKn: number; nEndKn: number;
  vyStartKn: number; vyEndKn: number;
  vzStartKn: number; vzEndKn: number;
  torsionStartKnm: number; torsionEndKnm: number;
  myStartKnm: number; myEndKnm: number;
  mzStartKnm: number; mzEndKnm: number;
}

export interface Frame3DDiagramPoint {
  /** Relatieve positie langs de staaf: 0 = begin, 1 = einde. */
  t: number;
  value: number;
}

export interface Frame3DMemberDiagram {
  memberId: number;
  points: Frame3DDiagramPoint[];
  maxValue: number;
  minValue: number;
  maxAbsValue: number;
}

export interface Frame3DDiagrams {
  momentY: Frame3DMemberDiagram[];
  momentZ: Frame3DMemberDiagram[];
  shearY: Frame3DMemberDiagram[];
  shearZ: Frame3DMemberDiagram[];
  axial: Frame3DMemberDiagram[];
  torsion: Frame3DMemberDiagram[];
}

export interface Frame3DBucklingMember {
  memberId: number;
  axialForceKn: number;
  criticalForceKn: number;
  effectiveLengthFactor: number;
  effectiveLengthM: number;
  lengthM: number;
  slendernessY: number;
  slendernessZ: number;
}

export type Frame3DBuckling =
  | { status: "available"; modes: { mode: number; loadFactor: number }[]; members: Frame3DBucklingMember[] }
  | { status: "notApplicable" | "failed"; reason: string };

export interface Frame3DSolveResult {
  schemaVersion: 1;
  engine: { id: string; name: string; revision: string; license: string };
  analysis: Frame3DAnalysisKind;
  displacements: Frame3DDisplacement[];
  reactions: Frame3DReaction[];
  memberForces: Frame3DMemberForces[];
  /** Sinds contract 1.1: door de solver bemonsterde snedekrachtlijnen. */
  diagrams?: Frame3DDiagrams;
  secondOrder?: { iterations: number; converged: boolean; stable: boolean; maxAmplification: number };
  buckling: Frame3DBuckling;
  equilibrium?: { relativeResidual: number; residualOk: boolean; maxImbalanceKn: number; equilibriumOk: boolean };
  /** Onafhankelijke som van aangebrachte krachten en oplegreacties in globale assen. */
  forceBalance?: { imbalanceKn: [number, number, number]; maxImbalanceKn: number; toleranceKn: number; ok: boolean };
  solverPath?: string;
  diagnostics: string[];
}

/** Controleer de globale krachtensom ook wanneer de P-Delta-kern geen eigen evenwichtsobject levert. */
export function frame3DGlobalForceBalance(
  input: ReturnType<typeof buildFrame3DSolveRequest>,
  result: Pick<Frame3DSolveResult, "reactions">,
): NonNullable<Frame3DSolveResult["forceBalance"]> {
  const applied: [number, number, number] = [0, 0, 0];
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const memberById = new Map(input.members.map((member) => [member.id, member]));
  const addLocalMemberForce = (memberId: number, fy: number, fz: number) => {
    const member = memberById.get(memberId);
    const start = member && nodeById.get(member.startNodeId);
    const end = member && nodeById.get(member.endNodeId);
    if (!start || !end) throw new Error(`Staaf ${memberId} ontbreekt bij de onafhankelijke krachtensom.`);
    const { ey, ez } = frame3DMemberAxes(start, end, member?.rollAngleRad ?? 0);
    for (let axis = 0; axis < 3; axis++) applied[axis] += fy * ey[axis] + fz * ez[axis];
  };
  for (const load of input.nodalLoads) {
    applied[0] += load.fx;
    applied[1] += load.fy;
    applied[2] += load.fz;
  }
  for (const load of input.memberLoads) {
    const length = load.endPositionM - load.startPositionM;
    addLocalMemberForce(load.memberId,
      (load.qyStartKnPerM + load.qyEndKnPerM) * length / 2,
      (load.qzStartKnPerM + load.qzEndKnPerM) * length / 2);
  }
  for (const load of input.memberPointLoads) addLocalMemberForce(load.memberId, load.pyKn, load.pzKn);
  const imbalanceKn: [number, number, number] = [...applied];
  for (const reaction of result.reactions) {
    imbalanceKn[0] += reaction.fx;
    imbalanceKn[1] += reaction.fy;
    imbalanceKn[2] += reaction.fz;
  }
  const maxImbalanceKn = Math.max(...imbalanceKn.map(Math.abs));
  const scaleKn = Math.max(1, ...applied.map(Math.abs));
  const toleranceKn = 1e-5 * scaleKn;
  return { imbalanceKn, maxImbalanceKn, toleranceKn, ok: Number.isFinite(maxImbalanceKn) && maxImbalanceKn <= toleranceKn };
}

/**
 * Welke 3D-belastingen één solveraanroep vormen. Een getal rekent één
 * belastinggeval; een Map rekent een volledige combinatie. De factoren
 * worden vóór de Rust-grens op iedere kracht, elk moment en elke
 * staafbelasting toegepast. Daardoor doorloopt ook een combinatie als één
 * geheel de P-Delta-iteraties en wordt zij niet achteraf lineair opgeteld.
 */
export type Frame3DLoadSelection = number | ReadonlyMap<number, number>;

function factorForLoad(selection: Frame3DLoadSelection | undefined, caseId: number): number {
  if (selection === undefined) return 1;
  if (typeof selection === "number") return caseId === selection ? 1 : 0;
  const factor = selection.get(caseId) ?? 0;
  if (!Number.isFinite(factor)) throw new Error(`Belastinggeval ${caseId} heeft een ongeldige combinatiefactor.`);
  return factor;
}

function profileKey(value: string): string {
  return value.toUpperCase().split("").filter((character) => ![" ", "-", "."].includes(character)).join("");
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

/**
 * Resolve every member before the Rust call. A/Iy still come from the same
 * resolver as 2D; Iz/J come from the steel catalogue or exact rectangle
 * geometry. An incomplete 3D section is rejected rather than supplemented
 * with hidden defaults.
 */
export function buildFrame3DSolveRequest(
  model: Frame3DModel,
  analysis: Frame3DAnalysisKind = "p-delta",
  loadSelection?: Frame3DLoadSelection,
) {
  if ((model.plates?.length ?? 0) > 0 || (model.surfaceLoads?.length ?? 0) > 0) {
    throw new Error(
      "Het model bevat 3D-platen of oppervlaktebelastingen. De geverifieerde " +
      "plaatkernel en mesh zijn nog niet aangesloten; rekenen is geblokkeerd om " +
      "te voorkomen dat platen of hun lasten stil worden genegeerd.",
    );
  }
  if (model.nodes.length < 2 || model.beams.length === 0) {
    throw new Error("Voeg minstens twee knopen en één staaf toe voordat je rekent.");
  }
  if ((model.supports ?? []).length === 0) throw new Error("Voeg minstens één 3D-oplegging toe.");
  const nodalLoads = (model.loads ?? []).flatMap((load) => {
    const factor = factorForLoad(loadSelection, frame3DLoadCaseId(load));
    if (factor === 0) return [];
    return [{
      ...load,
      fx: load.fx * factor, fy: load.fy * factor, fz: load.fz * factor,
      mx: load.mx * factor, my: load.my * factor, mz: load.mz * factor,
    }];
  });
  const memberLoads = (model.memberLoads ?? []).flatMap((load) => {
    const factor = factorForLoad(loadSelection, frame3DLoadCaseId(load));
    if (factor === 0) return [];
    return [{
      ...load,
      qyStart: load.qyStart * factor, qyEnd: load.qyEnd * factor,
      qzStart: load.qzStart * factor, qzEnd: load.qzEnd * factor,
    }];
  });
  const memberPointLoads = (model.memberPointLoads ?? []).flatMap((load) => {
    const factor = factorForLoad(loadSelection, frame3DLoadCaseId(load));
    if (factor === 0) return [];
    return [{ ...load, py: load.py * factor, pz: load.pz * factor }];
  });
  const thermalLoads = (model.thermalLoads ?? []).flatMap((load) => {
    const factor = factorForLoad(loadSelection, frame3DLoadCaseId(load));
    if (factor === 0) return [];
    return [{
      ...load,
      deltaTUniformK: load.deltaTUniformK * factor,
      deltaTGradientYK: load.deltaTGradientYK * factor,
      deltaTGradientZK: load.deltaTGradientZK * factor,
    }];
  });
  const hasPrescribedDisplacement = (model.supports ?? []).some((support) =>
    Object.keys(support.prescribed ?? {}).length > 0);
  if (nodalLoads.length === 0 && memberLoads.length === 0 && memberPointLoads.length === 0 && thermalLoads.length === 0 && !hasPrescribedDisplacement) {
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
    };
  });

  return {
    schemaVersion: 1,
    analysis,
    nodes: model.nodes,
    materials,
    sections,
    members,
    supports: (model.supports ?? []).map(({ springs, prescribed, ...support }) => ({
      ...support,
      ...(springs ?? {}),
      ...(prescribed?.uxM !== undefined ? { uxPrescribedM: prescribed.uxM } : {}),
      ...(prescribed?.uyM !== undefined ? { uyPrescribedM: prescribed.uyM } : {}),
      ...(prescribed?.uzM !== undefined ? { uzPrescribedM: prescribed.uzM } : {}),
      ...(prescribed?.rxRad !== undefined ? { rxPrescribedRad: prescribed.rxRad } : {}),
      ...(prescribed?.ryRad !== undefined ? { ryPrescribedRad: prescribed.ryRad } : {}),
      ...(prescribed?.rzRad !== undefined ? { rzPrescribedRad: prescribed.rzRad } : {}),
    })),
    nodalLoads: nodalLoads.map(({ caseId: _caseId, ...load }) => load),
    memberLoads: memberLoads.map((load) => ({
      id: load.id,
      memberId: load.beamId,
      qyStartKnPerM: load.qyStart,
      qyEndKnPerM: load.qyEnd,
      qzStartKnPerM: load.qzStart,
      qzEndKnPerM: load.qzEnd,
      startPositionM: load.startPositionM,
      endPositionM: load.endPositionM,
    })),
    memberPointLoads: memberPointLoads.map((load) => ({
      id: load.id,
      memberId: load.beamId,
      pyKn: load.py,
      pzKn: load.pz,
      positionM: load.positionM,
    })),
    thermalLoads: thermalLoads.map((load) => ({
      id: load.id,
      memberId: load.beamId,
      deltaTUniformK: load.deltaTUniformK,
      deltaTGradientYK: load.deltaTGradientYK,
      deltaTGradientZK: load.deltaTGradientZK,
    })),
    maxIterations: 50,
    tolerance: 1e-8,
    bucklingModes: 3,
  } as const;
}

export async function solveFrame3D(model: Frame3DModel, activeLoadCaseId?: number): Promise<Frame3DSolveResult> {
  const input = buildFrame3DSolveRequest(model, "p-delta", activeLoadCaseId);
  return callFrame3DSolver(input);
}

/** Los één belastingcombinatie rechtstreeks als tweede-ordeprobleem op. */
export async function solveFrame3DCombination(
  model: Frame3DModel,
  factors: ReadonlyMap<number, number>,
): Promise<Frame3DSolveResult> {
  const input = buildFrame3DSolveRequest(model, "p-delta", factors);
  return callFrame3DSolver(input);
}

async function callFrame3DSolver(input: ReturnType<typeof buildFrame3DSolveRequest>): Promise<Frame3DSolveResult> {
  const checked = (result: Frame3DSolveResult): Frame3DSolveResult => ({
    ...result,
    forceBalance: frame3DGlobalForceBalance(input, result),
  });
  const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
  const usesLegacyCompatibleLoads = input.memberLoads.length === 0
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
      return checked(await invoke<Frame3DSolveResult>("solve_frame3d", { input }));
    } catch (error) {
      if (!isLegacyMaterialContract(error)) throw error;
      return checked(await invoke<Frame3DSolveResult>("solve_frame3d", { input: legacyInput() }));
    }
  }
  const post = async (request: typeof input | ReturnType<typeof legacyInput>) => {
    const response = await fetch("/api/frame3d/solve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const data = await response.json().catch(() => ({})) as Frame3DSolveResult & { fout?: string };
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

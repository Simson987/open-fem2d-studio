import { solveNativeFem } from "../../../lib/nativeFemClient";
import { registreerScheefstandRichtingen, SCHEEFSTAND_ID_OFFSET } from "./engine";
import { grootsteVerplaatsing } from "./grootsteVerplaatsing";
import type { LoadCombination } from "./combinations";
import type { ElementForces, MultiInput, SolverResult } from "./types";

type FrameAnalysis = "linear" | "geometric" | "material" | "combined";
type NativeAxialLaw =
  | { kind: "steelBilinear"; yield_mpa: number; hardening_ratio: number }
  | { kind: "concreteCracking"; tensile_mpa: number; residual_ratio: number };

function isMaterialAnalysis(analysis: FrameAnalysis): boolean {
  return analysis === "material" || analysis === "combined";
}

interface NativeFrame2DResult {
  nodes: Array<{ nodeId: number; displacement: [number, number, number]; reaction: [number, number, number] }>;
  members: Array<{
    memberId: number; localEndForces: number[]; stationsM: number[];
    normalForceKn: number[]; shearForceKn: number[]; bendingMomentKnm: number[];
    deflectionM: number[]; axialDispM: number[]; rotationRad: number[];
    axialHistory?: { plasticStrain: number; equivalentPlasticStrain: number;
      tensileDamage: number; tangentEMpa: number };
  }>;
  equilibriumResidual: number;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} moet eindig zijn voor de Rust 2D-raamwerkkern.`);
  return value;
}

/** App plane X/Z in mm, N, Nmm -> Rust plane X/Y in m, kN, kNm. */
export function buildNativeFrame2DRequest(
  input: MultiInput, factor: (caseId: number) => number, analysis: FrameAnalysis = "linear",
) {
  if (input.plates?.length || !input.beams.length) {
    throw new Error("De Rust 2D-raamwerkroute vereist uitsluitend staven, zonder gekoppelde platen.");
  }
  if (input.edgeLoads?.length || input.edgePointLoads?.length) {
    throw new Error("Plaatrandlasten zijn nog niet gekoppeld aan de Rust 2D-raamwerkroute.");
  }
  if (input.scheefstand && (!(finite(input.scheefstand.phi, "Scheefstand φ") >= 0)
      || input.scheefstand.richting !== 1 && input.scheefstand.richting !== -1)) {
    throw new Error("Ongeldige scheefstand voor de Rust 2D-raamwerkroute.");
  }
  const schFactor = input.scheefstand
    ? input.scheefstand.phi * input.scheefstand.richting : 0;
  const nodes = input.nodes.map(node => ({ id: node.id,
    x: finite(node.x, `Knoop ${node.id} X`) / 1000,
    y: finite(node.z, `Knoop ${node.id} Z`) / 1000 }));
  const byId = new Map(input.nodes.map(node => [node.id, node]));
  const beamById = new Map(input.beams.map(beam => [beam.id, beam]));
  const geometry = new Map(input.beams.map(beam => {
    const start = byId.get(beam.from), end = byId.get(beam.to);
    if (!start || !end) throw new Error(`Staaf ${beam.id} verwijst naar een onbekende knoop.`);
    const lengthMm = Math.hypot(end.x - start.x, end.z - start.z);
    if (!(lengthMm > 0)) throw new Error(`Staaf ${beam.id} heeft geen lengte.`);
    return [beam.id, { lengthM: lengthMm / 1000,
      c: (end.x - start.x) / lengthMm, s: (end.z - start.z) / lengthMm }] as const;
  }));
  if (isMaterialAnalysis(analysis) && !input.beams.some(beam => beam.axialMaterialLaw)) {
    throw new Error("Geef minstens één staaf een axiale FNL-materiaalwet voor de Rust 2D-raamwerkroute.");
  }
  const materials = input.beams.map(beam => {
    let law: NativeAxialLaw | undefined;
    if (isMaterialAnalysis(analysis) && beam.axialMaterialLaw) {
      const source = beam.axialMaterialLaw;
      const strength = source.kind === "steelBilinear" ? source.yieldMpa : source.tensileMpa;
      const ratio = source.kind === "steelBilinear" ? source.hardeningRatio : source.residualRatio;
      if (!(finite(strength, `Staaf ${beam.id} FNL-sterkte`) > 0)
          || !(finite(ratio, `Staaf ${beam.id} FNL-stijfheidsverhouding`) >= 0 && ratio <= 1)) {
        throw new Error(`Staaf ${beam.id}: ongeldige axiale FNL-materiaalwet.`);
      }
      law = source.kind === "steelBilinear"
        ? { kind: "steelBilinear", yield_mpa: source.yieldMpa, hardening_ratio: source.hardeningRatio }
        : { kind: "concreteCracking", tensile_mpa: source.tensileMpa, residual_ratio: source.residualRatio };
    }
    return { id: beam.id, eMpa: finite(beam.E ?? 210000, `Staaf ${beam.id} E`), ...(law ? { law } : {}) };
  });
  const sections = input.beams.map(beam => ({ id: beam.id,
    areaM2: finite(beam.A ?? 3877, `Staaf ${beam.id} A`) * 1e-6,
    inertiaM4: finite(beam.I ?? 1.673e7, `Staaf ${beam.id} I`) * 1e-12 }));
  const members = input.beams.map(beam => {
    if (beam.bedding || beam.segmenten?.length || beam.extraSneden?.length || beam.veren) {
      throw new Error(`Staaf ${beam.id}: bedding, segmenten, extra sneden en eindveren zijn nog niet gekoppeld aan de Rust 2D-raamwerkroute.`);
    }
    if (beam.releases?.startTx || beam.releases?.startTz
        || beam.releases?.endTx || beam.releases?.endTz) {
      throw new Error(`Staaf ${beam.id}: translatiehulzen zijn nog niet gekoppeld aan de Rust 2D-raamwerkroute.`);
    }
    const rzStart = !!beam.releases?.startRy || beam.startConnection === "hinge";
    const rzEnd = !!beam.releases?.endRy || beam.endConnection === "hinge";
    return { id: beam.id, startNodeId: beam.from, endNodeId: beam.to,
      materialId: beam.id, sectionId: beam.id,
      releases: { rzStart, rzEnd } };
  });
  type Support = { nodeId: number; ux: boolean; uy: boolean; rz: boolean;
    kxKnPerM?: number; kyKnPerM?: number; krzKnmPerRad?: number };
  const supportsByNode = new Map<number, Support>();
  for (const support of input.supports) {
    const entry: Support = supportsByNode.get(support.nodeId) ?? { nodeId: support.nodeId, ux: false, uy: false, rz: false };
    const k = finite(support.k ?? 0, `Oplegging ${support.nodeId} k`);
    if (support.type === "fixed") { entry.ux = true; entry.uy = true; entry.rz = true; }
    else if (support.type === "pinned") { entry.ux = true; entry.uy = true; }
    else if (support.type === "xRoller") entry.ux = true;
    else if (support.type === "zRoller") entry.uy = true;
    else if (support.type === "xSpring") { if (k > 0) entry.kxKnPerM = k; else entry.ux = true; }
    else if (support.type === "zSpring") { if (k > 0) entry.kyKnPerM = k; else entry.uy = true; }
    else if (support.type === "rotSpring") { if (k > 0) entry.krzKnmPerRad = k / 1e6; else entry.rz = true; }
    supportsByNode.set(support.nodeId, entry);
  }
  const supports = [...supportsByNode.values()];
  for (const support of supports) {
    if (support.ux && support.kxKnPerM || support.uy && support.kyKnPerM || support.rz && support.krzKnmPerRad) {
      throw new Error(`Knoop ${support.nodeId} is tegelijk vast en verend in dezelfde vrijheidsgraad.`);
    }
  }
  const nodalLoads = (input.pointLoads ?? []).flatMap(load => {
    const scale = finite(factor(load.caseId), `Belastinggeval ${load.caseId}`);
    if (scale === 0) return [];
    const fz = finite(load.fz ?? 0, "Knooplast Fz");
    const values = { nodeId: load.nodeId,
      fx: (finite(load.fx ?? 0, "Knooplast Fx") - schFactor * fz) * scale / 1000,
      fy: fz * scale / 1000,
      mz: finite(load.my ?? 0, "Knoopmoment My") * scale / 1e6 };
    return values.fx || values.fy || values.mz ? [values] : [];
  });
  const memberLoads = input.loads.flatMap(load => {
    const scale = finite(factor(load.caseId), `Belastinggeval ${load.caseId}`);
    if (scale === 0) return [];
    const axes = geometry.get(load.beamId);
    if (!axes) throw new Error(`Lijnlast verwijst naar onbekende staaf ${load.beamId}.`);
    const project = (value: number) => {
      const q = finite(value, `Staaf ${load.beamId} lijnlast`) * scale;
      const [qx, qy] = load.qCoord === "local"
        ? load.qDir === "x" ? [q, 0] : [0, q]
        : load.qDir === "x" ? [axes.c * q, -axes.s * q] : [axes.s * q, axes.c * q];
      if (!schFactor) return [qx, qy];
      const globalVertical = axes.s * qx + axes.c * qy;
      return [qx - schFactor * axes.c * globalVertical,
        qy + schFactor * axes.s * globalVertical];
    };
    const [qxStartKnPerM, qyStartKnPerM] = project(load.qStart ?? load.q);
    const [qxEndKnPerM, qyEndKnPerM] = project(load.qEnd ?? load.q);
    if (![qxStartKnPerM, qyStartKnPerM, qxEndKnPerM, qyEndKnPerM].some(value => value !== 0)) return [];
    return [{ memberId: load.beamId, qxStartKnPerM, qxEndKnPerM,
      qyStartKnPerM, qyEndKnPerM,
      startPositionM: finite(load.startFrac ?? 0, "Deellast begin") * axes.lengthM,
      endPositionM: finite(load.endFrac ?? 1, "Deellast eind") * axes.lengthM }];
  });
  const memberPointLoads = (input.beamPointLoads ?? []).flatMap(load => {
    const scale = finite(factor(load.caseId), `Belastinggeval ${load.caseId}`);
    const axes = geometry.get(load.beamId);
    const beam = beamById.get(load.beamId);
    if (!axes || !beam) throw new Error(`Puntlast verwijst naar onbekende staaf ${load.beamId}.`);
    const fxInput = finite(load.fx ?? 0, "Staafpuntlast Fx");
    const fzInput = finite(load.fz ?? 0, "Staafpuntlast Fz");
    const fx = (fxInput - schFactor * fzInput) * scale / 1000;
    const fz = fzInput * scale / 1000;
    const mz = finite(load.my ?? 0, "Staafpuntmoment My") * scale / 1e6;
    const position = finite(load.posFrac, "Staafpuntlast positie");
    if (position === 0 || position === 1) {
      if (fx || fz || mz) nodalLoads.push({ nodeId: position === 0 ? beam.from : beam.to, fx, fy: fz, mz });
      return [];
    }
    if (mz) throw new Error(`Staaf ${load.beamId}: een puntmoment binnen de staaf is nog niet gekoppeld aan Rust.`);
    // Ook bij factor nul blijft dit station bestaan. Alle belastinggevallen
    // moeten hetzelfde raster hebben voordat combineResults ze superponeert.
    return [{ memberId: load.beamId, pxKn: axes.c * fx + axes.s * fz,
      pyKn: -axes.s * fx + axes.c * fz,
      positionM: position * axes.lengthM }];
  });
  const thermalLoads = (input.thermalLoads ?? []).flatMap(load => {
    const scale = finite(factor(load.caseId), `Belastinggeval ${load.caseId}`);
    if (!beamById.has(load.beamId)) throw new Error(`Temperatuurlast verwijst naar onbekende staaf ${load.beamId}.`);
    const deltaTK = finite(load.deltaT, `Staaf ${load.beamId} temperatuur`) * scale;
    const deltaTGradientK = finite(load.deltaTGradient ?? 0,
      `Staaf ${load.beamId} temperatuurgradiënt`) * scale;
    const alphaPerK = finite(load.alpha ?? 1.2e-5, `Staaf ${load.beamId} uitzettingscoëfficiënt`);
    if (alphaPerK < 0) throw new Error(`Staaf ${load.beamId}: uitzettingscoëfficiënt mag niet negatief zijn.`);
    let depthM: number | undefined;
    if (deltaTGradientK !== 0) {
      depthM = finite(load.thermalDepthMm ?? NaN, `Staaf ${load.beamId} gradiënthoogte`) / 1000;
      if (!(depthM > 0)) throw new Error(`Staaf ${load.beamId}: gradiënthoogte moet positief zijn.`);
    }
    return deltaTK === 0 && deltaTGradientK === 0 ? []
      : [{ memberId: load.beamId, deltaTK, alphaPerK,
        ...(depthM !== undefined ? { deltaTGradientK, depthM } : {}) }];
  });
  const loadPath = isMaterialAnalysis(analysis) ? input.axialMaterialLoadPath ?? [1] : [];
  if (isMaterialAnalysis(analysis) && (!Array.isArray(loadPath) || loadPath.length === 0
      || loadPath.length > 100 || loadPath.some(value => !Number.isFinite(value)))) {
    throw new Error("Ongeldig axiaal FNL-lastpad voor de Rust 2D-raamwerkroute.");
  }
  return { analysis, nodes, materials, sections, members, supports,
    nodalLoads, memberLoads, memberPointLoads, thermalLoads,
    ...(isMaterialAnalysis(analysis) ? { loadPath } : {}) };
}

export function nativeFrame2DResultToSolverResult(
  request: ReturnType<typeof buildNativeFrame2DRequest>, native: NativeFrame2DResult,
): SolverResult {
  if (!Number.isFinite(native.equilibriumResidual) || native.equilibriumResidual > 1e-8
      || native.nodes?.length !== request.nodes.length || native.members?.length !== request.members.length) {
    throw new Error("De Rust 2D-raamwerkkern leverde geen volledig evenwichtig resultaat.");
  }
  const nodeIds = new Set(request.nodes.map(node => node.id));
  const memberIds = new Set(request.members.map(member => member.id));
  const supported = new Set(request.supports.map(support => support.nodeId));
  const displacements = new Map<number, { ux: number; uz: number; ry: number }>();
  const reactions = new Map<number, { fx: number; fz: number; my: number }>();
  for (const node of native.nodes) {
    if (!nodeIds.has(node.nodeId) || displacements.has(node.nodeId)
        || node.displacement?.length !== 3 || node.reaction?.length !== 3
        || [...node.displacement, ...node.reaction].some(value => !Number.isFinite(value))) {
      throw new Error("De Rust 2D-raamwerkkern leverde ongeldige knoopwaarden.");
    }
    displacements.set(node.nodeId, { ux: node.displacement[0] * 1000,
      uz: node.displacement[1] * 1000, ry: node.displacement[2] });
    if (supported.has(node.nodeId)) reactions.set(node.nodeId, {
      fx: node.reaction[0] * 1000, fz: node.reaction[1] * 1000, my: node.reaction[2] * 1e6,
    });
  }
  const elements = new Map<number, ElementForces>();
  for (const member of native.members) {
    const arrays = [member.stationsM, member.normalForceKn, member.shearForceKn,
      member.bendingMomentKnm, member.deflectionM, member.axialDispM, member.rotationRad];
    const count = member.stationsM?.length ?? 0;
    if (!memberIds.has(member.memberId) || elements.has(member.memberId)
        || member.localEndForces?.length !== 6 || count < 2
        || arrays.some(array => !Array.isArray(array) || array.length !== count
          || array.some(value => !Number.isFinite(value)))
        || member.localEndForces.some(value => !Number.isFinite(value))) {
      throw new Error("De Rust 2D-raamwerkkern leverde ongeldige staafdiagrammen.");
    }
    if (isMaterialAnalysis(request.analysis)) {
      const history = member.axialHistory;
      if (!history || [history.plasticStrain, history.equivalentPlasticStrain,
        history.tensileDamage, history.tangentEMpa].some(value => !Number.isFinite(value))) {
        throw new Error("De Rust 2D-raamwerkkern leverde geen geldige axiale materiaaltoestand.");
      }
    }
    elements.set(member.memberId, {
      N: member.normalForceKn[0] * 1000, V: member.shearForceKn[0] * 1000,
      ...(member.axialHistory ? { axialHistory: { ...member.axialHistory } } : {}),
      M_start: member.bendingMomentKnm[0] * 1e6,
      M_end: member.bendingMomentKnm[count - 1] * 1e6,
      L_mm: member.stationsM[count - 1] * 1000,
      stations_mm: member.stationsM.map(value => value * 1000),
      normalForce: member.normalForceKn.map(value => value * 1000),
      shearForce: member.shearForceKn.map(value => value * 1000),
      bendingMoment: member.bendingMomentKnm.map(value => value * 1e6),
      deflection: member.deflectionM.map(value => value * 1000),
      axialDisp: member.axialDispM.map(value => value * 1000),
      rotation: [...member.rotationRad],
    });
  }
  return { displacements, reactions, elements,
    maxDisplacement: grootsteVerplaatsing(displacements.values(), elements.values()) };
}

export async function solveAllCasesNativeFrame2D(
  input: MultiInput, analysis: FrameAnalysis = "linear",
): Promise<Map<number, SolverResult>> {
  const perCase = new Map<number, SolverResult>();
  if (input.scheefstand && input.cases.some(loadCase => loadCase.id >= SCHEEFSTAND_ID_OFFSET)) {
    throw new Error("Belastinggeval-id botst met de scheefstandvarianten van de Rust 2D-raamwerkroute.");
  }
  const solveDirection = async (richting: 1 | -1 | undefined, offset: number) => {
    const directionalInput = richting === undefined ? input
      : { ...input, scheefstand: { ...input.scheefstand!, richting } };
    for (const loadCase of input.cases) {
      const request = buildNativeFrame2DRequest(directionalInput,
        caseId => caseId === loadCase.id ? 1 : 0, analysis);
      if (!request.nodalLoads.length && !request.memberLoads.length
          && !request.memberPointLoads.some(load => load.pxKn !== 0 || load.pyKn !== 0)
          && !request.thermalLoads.length) continue;
      const result = await solveNativeFem<NativeFrame2DResult>("frame2d", request);
      perCase.set(loadCase.id + offset, nativeFrame2DResultToSolverResult(request, result));
    }
  };
  await solveDirection(input.scheefstand?.richting, 0);
  if (input.scheefstand) {
    await solveDirection((-input.scheefstand.richting) as 1 | -1, SCHEEFSTAND_ID_OFFSET);
    registreerScheefstandRichtingen(perCase, input.scheefstand.richting);
  }
  return perCase;
}

/** Each second-order combination is solved at its full factored load. */
export async function solveAllCombinationsNativeFrame2D(
  input: MultiInput, combinations: readonly LoadCombination[],
  analysis: "geometric" | "material" | "combined" = "geometric",
): Promise<Map<number, SolverResult>> {
  const results = new Map<number, SolverResult>();
  for (const combination of combinations) {
    if (combination.eindtoestand !== undefined) {
      throw new Error(`Combinatie ${combination.name}: eindstijfheidvariant is niet ondersteund door de Rust 2D-raamwerkroute.`);
    }
    const directionalInput = input.scheefstand && combination.scheefstandRichting !== undefined
      ? { ...input, scheefstand: { ...input.scheefstand, richting: combination.scheefstandRichting } }
      : input;
    const request = buildNativeFrame2DRequest(directionalInput,
      caseId => combination.factors.get(caseId) ?? 0, analysis);
    const result = await solveNativeFem<NativeFrame2DResult>("frame2d", request);
    results.set(combination.id, nativeFrame2DResultToSolverResult(request, result));
  }
  return results;
}

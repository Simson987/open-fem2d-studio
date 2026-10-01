import { solveNativeFem } from "../../../lib/nativeFemClient";
import { beddingSplitsFracties, MIN_SEGMENT_MM, normaliseerSegmenten,
  registreerScheefstandRichtingen, SCHEEFSTAND_ID_OFFSET } from "./engine";
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

interface FrameSegment {
  id: number;
  t0: number;
  t1: number;
  startNodeId: number;
  endNodeId: number;
  sourceSegmentIndex?: number;
  inertiaMm4?: number;
  areaMm2?: number;
}

interface FrameMesh {
  originalNodeIds: Set<number>;
  segmentsByBeam: Map<number, FrameSegment[]>;
}

// Metadata stays on the client side; the Rust request schema rejects unknown fields.
const frameMeshes = new WeakMap<object, FrameMesh>();

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
  const sections: Array<{ id: number; areaM2: number; inertiaM4: number }> = [];
  let nextNodeId = Math.max(0, ...input.nodes.map(node => node.id)) + 1;
  let nextMemberId = Math.max(0, ...input.beams.map(beam => beam.id)) + 1;
  const segmentsByBeam = new Map<number, FrameSegment[]>();
  const members = input.beams.flatMap(beam => {
    if (beam.veren) {
      throw new Error(`Staaf ${beam.id}: eindveren zijn nog niet gekoppeld aan de Rust 2D-raamwerkroute.`);
    }
    if (beam.releases?.startTx || beam.releases?.startTz
        || beam.releases?.endTx || beam.releases?.endTz) {
      throw new Error(`Staaf ${beam.id}: translatiehulzen zijn nog niet gekoppeld aan de Rust 2D-raamwerkroute.`);
    }
    const rzStart = !!beam.releases?.startRy || beam.startConnection === "hinge";
    const rzEnd = !!beam.releases?.endRy || beam.endConnection === "hinge";
    const axes = geometry.get(beam.id)!;
    const lengthMm = axes.lengthM * 1000;
    const definitions = normaliseerSegmenten(beam.id, beam.segmenten, lengthMm);
    const kLijn = beam.bedding?.kLijn;
    if (kLijn !== undefined && !(finite(kLijn, `Staaf ${beam.id} bedding`) > 0)) {
      throw new Error(`Staaf ${beam.id}: beddingstijfheid moet positief zijn.`);
    }
    const partialLoad = input.loads.some(load => load.beamId === beam.id
      && ((load.qStart ?? load.q) !== 0 || (load.qEnd ?? load.q) !== 0)
      && ((load.startFrac ?? 0) > 0 || (load.endFrac ?? 1) < 1));
    const meshNeeded = kLijn !== undefined || definitions !== undefined
      || !!beam.extraSneden?.length || partialLoad;
    const forced = meshNeeded ? (input.beamPointLoads ?? [])
      .filter(load => load.beamId === beam.id && Number.isFinite(load.posFrac)
        && load.posFrac > 1e-6 && load.posFrac < 1 - 1e-6)
      .map(load => load.posFrac) : [];
    const cuts = forced.sort((a, b) => a - b).filter((t, i, sorted) =>
      i === 0 || t - sorted[i - 1] > 1e-9);
    const minFraction = MIN_SEGMENT_MM / lengthMm;
    const mandatory = [0, ...cuts, 1];
    for (const definition of definitions?.slice(1) ?? []) {
      if (mandatory.some(t => Math.abs(t - definition.t0) < minFraction)) continue;
      cuts.push(definition.t0);
    }
    if (meshNeeded) {
      const candidates = [...(beam.extraSneden ?? []),
        ...input.loads.filter(load => load.beamId === beam.id
          && ((load.qStart ?? load.q) !== 0 || (load.qEnd ?? load.q) !== 0))
          .flatMap(load => [load.startFrac ?? 0, load.endFrac ?? 1]),
        ...(kLijn === undefined ? [] : beddingSplitsFracties(lengthMm,
          beam.E ?? 210000, beam.I ?? 1.673e7, kLijn))];
      const start = byId.get(beam.from)!, end = byId.get(beam.to)!;
      for (const t of candidates.sort((a, b) => a - b)) {
        if (!Number.isFinite(t) || t <= minFraction || t >= 1 - minFraction
            || cuts.some(existing => Math.abs(existing - t) < minFraction)) continue;
        const x = start.x + t * (end.x - start.x);
        const z = start.z + t * (end.z - start.z);
        if (nodes.some(node => Math.hypot(node.x * 1000 - x, node.y * 1000 - z) < 1)) continue;
        cuts.push(t);
      }
    }
    const start = byId.get(beam.from)!, end = byId.get(beam.to)!;
    const segmentNodes = [beam.from], fractions = [0];
    for (const t of cuts.sort((a, b) => a - b)) {
      const x = (start.x + t * (end.x - start.x)) / 1000;
      const y = (start.z + t * (end.z - start.z)) / 1000;
      const existing = nodes.find(node => Math.hypot(node.x - x, node.y - y) < 0.001);
      const id = existing?.id ?? nextNodeId++;
      if (id === segmentNodes[segmentNodes.length - 1] || id === beam.to) continue;
      if (!existing) nodes.push({ id, x, y });
      segmentNodes.push(id);
      fractions.push(t);
    }
    segmentNodes.push(beam.to);
    fractions.push(1);
    const segments: FrameSegment[] = fractions.slice(0, -1).map((t0, index) => {
      const t1 = fractions[index + 1];
      const source = definitions?.find(definition => (t0 + t1) / 2 >= definition.t0
        && (t0 + t1) / 2 < definition.t1) ?? definitions?.[definitions.length - 1];
      const id = index === 0 ? beam.id : nextMemberId++;
      const areaMm2 = source?.A_mm2 ?? beam.A ?? 3877;
      const inertiaMm4 = source?.I_mm4 ?? beam.I ?? 1.673e7;
      sections.push({ id,
        areaM2: finite(areaMm2, `Staaf ${beam.id} doorsnede A`) * 1e-6,
        inertiaM4: finite(inertiaMm4, `Staaf ${beam.id} doorsnede I`) * 1e-12 });
      return { id, t0, t1,
        startNodeId: segmentNodes[index], endNodeId: segmentNodes[index + 1],
        ...(source ? { sourceSegmentIndex: source.index, inertiaMm4: source.I_mm4,
          ...(source.A_mm2 !== undefined ? { areaMm2: source.A_mm2 } : {}) } : {}),
      };
    });
    segmentsByBeam.set(beam.id, segments);
    return segments.map((segment, index) => ({ id: segment.id,
      startNodeId: segment.startNodeId, endNodeId: segment.endNodeId,
      materialId: beam.id, sectionId: segment.id,
      releases: { rzStart: index === 0 && rzStart,
        rzEnd: index === segments.length - 1 && rzEnd },
      ...(kLijn === undefined ? {} : { foundationKnPerM2: kLijn * 1000 }),
    }));
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
    const startFrac = finite(load.startFrac ?? 0, "Deellast begin");
    const endFrac = finite(load.endFrac ?? 1, "Deellast eind");
    if (!(startFrac >= 0 && endFrac <= 1 && endFrac > startFrac)) {
      throw new Error(`Staaf ${load.beamId}: ongeldige grenzen voor de deellast.`);
    }
    return segmentsByBeam.get(load.beamId)!.flatMap(segment => {
      const a = Math.max(startFrac, segment.t0), b = Math.min(endFrac, segment.t1);
      if (b - a <= 1e-12) return [];
      const interpolate = (first: number, last: number, t: number) =>
        first + (last - first) * (t - startFrac) / (endFrac - startFrac);
      return [{ memberId: segment.id,
        qxStartKnPerM: interpolate(qxStartKnPerM, qxEndKnPerM, a),
        qxEndKnPerM: interpolate(qxStartKnPerM, qxEndKnPerM, b),
        qyStartKnPerM: interpolate(qyStartKnPerM, qyEndKnPerM, a),
        qyEndKnPerM: interpolate(qyStartKnPerM, qyEndKnPerM, b),
        startPositionM: (a - segment.t0) * axes.lengthM,
        endPositionM: (b - segment.t0) * axes.lengthM }];
    });
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
    const segment = segmentsByBeam.get(load.beamId)?.find(item =>
      position >= item.t0 - 1e-12 && position <= item.t1 + 1e-12);
    if (!segment) throw new Error(`Staaf ${load.beamId}: puntlast ligt buiten de staaf.`);
    if (position === segment.t0 || position === segment.t1) {
      if (fx || fz || mz) nodalLoads.push({ nodeId: position === segment.t0
        ? segment.startNodeId : segment.endNodeId, fx, fy: fz, mz });
      return [];
    }
    return [{ memberId: segment.id, pxKn: axes.c * fx + axes.s * fz,
      pyKn: -axes.s * fx + axes.c * fz,
      positionM: (position - segment.t0) * axes.lengthM }];
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
      : segmentsByBeam.get(load.beamId)!.map(segment => ({ memberId: segment.id,
        deltaTK, alphaPerK,
        ...(depthM !== undefined ? { deltaTGradientK, depthM } : {}) }));
  });
  const loadPath = isMaterialAnalysis(analysis) ? input.axialMaterialLoadPath ?? [1] : [];
  if (isMaterialAnalysis(analysis) && (!Array.isArray(loadPath) || loadPath.length === 0
      || loadPath.length > 100 || loadPath.some(value => !Number.isFinite(value)))) {
    throw new Error("Ongeldig axiaal FNL-lastpad voor de Rust 2D-raamwerkroute.");
  }
  const request = { analysis, nodes, materials, sections, members, supports,
    nodalLoads, memberLoads, memberPointLoads, thermalLoads,
    ...(isMaterialAnalysis(analysis) ? { loadPath } : {}) };
  frameMeshes.set(request, { originalNodeIds: new Set(input.nodes.map(node => node.id)), segmentsByBeam });
  return request;
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
  const mesh = frameMeshes.get(request);
  if (!mesh) throw new Error("De Rust 2D-raamwerkroute mist de bijbehorende staafindeling.");
  const supported = new Set(request.supports.map(support => support.nodeId));
  const displacements = new Map<number, { ux: number; uz: number; ry: number }>();
  const reactions = new Map<number, { fx: number; fz: number; my: number }>();
  const seenNodes = new Set<number>();
  for (const node of native.nodes) {
    if (!nodeIds.has(node.nodeId) || seenNodes.has(node.nodeId)
        || node.displacement?.length !== 3 || node.reaction?.length !== 3
        || [...node.displacement, ...node.reaction].some(value => !Number.isFinite(value))) {
      throw new Error("De Rust 2D-raamwerkkern leverde ongeldige knoopwaarden.");
    }
    seenNodes.add(node.nodeId);
    if (!mesh.originalNodeIds.has(node.nodeId)) continue;
    displacements.set(node.nodeId, { ux: node.displacement[0] * 1000,
      uz: node.displacement[1] * 1000, ry: node.displacement[2] });
    if (supported.has(node.nodeId)) reactions.set(node.nodeId, {
      fx: node.reaction[0] * 1000, fz: node.reaction[1] * 1000, my: node.reaction[2] * 1e6,
    });
  }
  const segmentElements = new Map<number, ElementForces>();
  for (const member of native.members) {
    const arrays = [member.stationsM, member.normalForceKn, member.shearForceKn,
      member.bendingMomentKnm, member.deflectionM, member.axialDispM, member.rotationRad];
    const count = member.stationsM?.length ?? 0;
    if (!memberIds.has(member.memberId) || segmentElements.has(member.memberId)
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
    segmentElements.set(member.memberId, {
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
  const elements = new Map<number, ElementForces>();
  const diagramKeys = ["stations_mm", "normalForce", "shearForce", "bendingMoment",
    "deflection", "axialDisp"] as const;
  for (const [beamId, segments] of mesh.segmentsByBeam) {
    const first = segmentElements.get(segments[0].id)!;
    const last = segmentElements.get(segments[segments.length - 1].id)!;
    const merged: ElementForces = { ...first, M_end: last.M_end,
      L_mm: segments.reduce((sum, segment) => sum + segmentElements.get(segment.id)!.L_mm, 0),
      stations_mm: [], normalForce: [], shearForce: [], bendingMoment: [],
      deflection: [], axialDisp: [], rotation: [] };
    const segmentOutput: NonNullable<ElementForces["segmenten"]> = [];
    let offsetMm = 0;
    for (const segment of segments) {
      const part = segmentElements.get(segment.id)!;
      for (const key of diagramKeys) {
        if (key === "stations_mm") merged.stations_mm.push(...part.stations_mm.map(x => x + offsetMm));
        else merged[key].push(...part[key]);
      }
      merged.rotation!.push(...part.rotation!);
      if (segment.sourceSegmentIndex !== undefined) {
        let maximum = 0;
        for (let index = 1; index < part.bendingMoment.length; index++) {
          if (Math.abs(part.bendingMoment[index]) > Math.abs(part.bendingMoment[maximum])) maximum = index;
        }
        segmentOutput.push({ xStart: offsetMm, xEnd: offsetMm + part.L_mm,
          I: segment.inertiaMm4!,
          ...(segment.areaMm2 !== undefined ? { A: segment.areaMm2 } : {}),
          segmentIndex: segment.sourceSegmentIndex,
          N_start: part.normalForce[0], N_end: part.normalForce[part.normalForce.length - 1],
          M_start: part.bendingMoment[0], M_end: part.bendingMoment[part.bendingMoment.length - 1],
          M_max: part.bendingMoment[maximum], N_bij_M_max: part.normalForce[maximum] });
      }
      offsetMm += part.L_mm;
    }
    if (segmentOutput.length) merged.segmenten = segmentOutput;
    if (isMaterialAnalysis(request.analysis)) {
      // The app exposes one history per UI beam. For a beam with multiple
      // Rust elements, report the most advanced plastic or damage state.
      const histories = segments.map(segment => segmentElements.get(segment.id)!.axialHistory!);
      merged.axialHistory = { ...histories.reduce((worst, current) =>
        current.tensileDamage > worst.tensileDamage
          || current.tensileDamage === worst.tensileDamage
            && current.equivalentPlasticStrain > worst.equivalentPlasticStrain
          ? current : worst) };
    }
    elements.set(beamId, merged);
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

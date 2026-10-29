import { solveNativeFem, type NativeMixed2DResult } from "../../../lib/nativeFemClient";
import { beddingSplitsFracties, MIN_SEGMENT_MM, normaliseerSegmenten,
  buildMesh, registreerScheefstandRichtingen, SCHEEFSTAND_ID_OFFSET } from "./engine";
import { grootsteVerplaatsing } from "./grootsteVerplaatsing";
import { combineerOpleggingen } from "./opleggingen";
import type { LoadCombination } from "./combinations";
import type { ElementForces, MultiInput, SolverResult } from "./types";
import { materialOptions, nativeMembraneResultToSolverResult, voegNativeDrieLagencontroleToe } from "./nativeMembraneRoute";
import type { NativeMaterialLaw, NativeModulusCurve } from "../../../core/fem/nativePlate2DAdapter";

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
    sectionHistory?: { maximumAbsPlasticStrain: number; maximumEquivalentPlasticStrain: number;
      maximumTensileDamage: number };
  }>;
  equilibriumResidual: number;
  frontalMaximumFrontDofs?: number | null;
  membraneTriangles?: NativeMixed2DResult["triangles"];
  membraneQuads?: NativeMixed2DResult["quads"];
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

function distanceToSegment(point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1,
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function pointInPolygon(point: { x: number; y: number }, polygon: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y)
        && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** App plane X/Z in mm, N, Nmm -> Rust plane X/Y in m, kN, kNm. */
export function buildNativeFrame2DRequest(
  input: MultiInput, factor: (caseId: number) => number, analysis: FrameAnalysis = "linear",
  allowMaterialWithoutBeamLaw = false,
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
  if (isMaterialAnalysis(analysis) && !allowMaterialWithoutBeamLaw
      && !input.beams.some(beam => beam.axialMaterialLaw)) {
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
    const rzStart = !!beam.releases?.startRy || beam.startConnection === "hinge";
    const rzEnd = !!beam.releases?.endRy || beam.endConnection === "hinge";
    const spring = (value: number | undefined, label: string, released: boolean, rotation = false) => {
      if (value === undefined || released || value <= 0) return undefined;
      const k = finite(value, `Staaf ${beam.id} ${label}`);
      return rotation ? k / 1e6 : k; // Nmm/rad → kNm/rad; N/mm = kN/m.
    };
    const kSTx = spring(beam.veren?.startTx, "startTx-veer", !!beam.releases?.startTx);
    const kSTz = spring(beam.veren?.startTz, "startTz-veer", !!beam.releases?.startTz);
    const kSRy = spring(beam.veren?.startRy, "startRy-veer", rzStart, true);
    const kETx = spring(beam.veren?.endTx, "endTx-veer", !!beam.releases?.endTx);
    const kETz = spring(beam.veren?.endTz, "endTz-veer", !!beam.releases?.endTz);
    const kERy = spring(beam.veren?.endRy, "endRy-veer", rzEnd, true);
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
    const axialFnlDistributedLoad = isMaterialAnalysis(analysis) && input.loads.some(load => {
      if (load.beamId !== beam.id) return false;
      const projectedAxial = (value: number) => {
        const q = value;
        const [qx, qy] = load.qCoord === "local"
          ? load.qDir === "x" ? [q, 0] : [0, q]
          : load.qDir === "x" ? [axes.c * q, -axes.s * q] : [axes.s * q, axes.c * q];
        return qx - schFactor * axes.c * (axes.s * qx + axes.c * qy);
      };
      return Math.abs(projectedAxial(load.qStart ?? load.q)) > 1e-12
        || Math.abs(projectedAxial(load.qEnd ?? load.q)) > 1e-12;
    });
    const axialFnlSubdivisions = Math.max(1, Math.ceil(lengthMm / 100));
    const internalPointMoment = (input.beamPointLoads ?? []).some(load =>
      load.beamId === beam.id && Number.isFinite(load.posFrac)
      && load.posFrac > 1e-6 && load.posFrac < 1 - 1e-6
      && Number.isFinite(load.my) && load.my !== 0);
    const meshNeeded = kLijn !== undefined || definitions !== undefined
      || !!beam.extraSneden?.length || partialLoad
      || axialFnlDistributedLoad || internalPointMoment;
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
        ...(axialFnlDistributedLoad
          ? Array.from({ length: axialFnlSubdivisions - 1 },
            (_, index) => (index + 1) / axialFnlSubdivisions)
          : []),
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
      releases: { uxStart: index === 0 && !!beam.releases?.startTx,
        uyStart: index === 0 && !!beam.releases?.startTz,
        rzStart: index === 0 && rzStart,
        uxEnd: index === segments.length - 1 && !!beam.releases?.endTx,
        uyEnd: index === segments.length - 1 && !!beam.releases?.endTz,
        rzEnd: index === segments.length - 1 && rzEnd },
      springs: {
        ...(index === 0 && kSTx !== undefined ? { uxStartKnPerM: kSTx } : {}),
        ...(index === 0 && kSTz !== undefined ? { uyStartKnPerM: kSTz } : {}),
        ...(index === 0 && kSRy !== undefined ? { rzStartKnmPerRad: kSRy } : {}),
        ...(index === segments.length - 1 && kETx !== undefined ? { uxEndKnPerM: kETx } : {}),
        ...(index === segments.length - 1 && kETz !== undefined ? { uyEndKnPerM: kETz } : {}),
        ...(index === segments.length - 1 && kERy !== undefined ? { rzEndKnmPerRad: kERy } : {}),
      },
      ...(kLijn === undefined ? {} : { foundationKnPerM2: kLijn * 1000 }),
    }));
  });
  type Support = { nodeId: number; ux: boolean; uy: boolean; rz: boolean;
    kxKnPerM?: number; kyKnPerM?: number; krzKnmPerRad?: number };
  // Per knoop samengevoegd per vrijheidsgraad, met dezelfde regel als de
  // TS-engine (`opleggingen.ts`, issue #223): tegenstrijdige opleggingen
  // (star én verend, of twee veren in één richting) worden geweigerd. Vroeger
  // overschreef een tweede veer in dezelfde richting de eerste stil.
  const opleggingen = combineerOpleggingen(input.supports, "solver");
  const opleggingFouten = opleggingen.bevindingen.filter((b) => b.ernst === "fout");
  if (opleggingFouten.length > 0) throw new Error(opleggingFouten.map((f) => f.tekst).join(" "));
  const supports: Support[] = [...opleggingen.perKnoop.values()].map((steun) => {
    const entry: Support = { nodeId: steun.nodeId,
      ux: steun.x.soort === "star", uy: steun.z.soort === "star", rz: steun.ry.soort === "star" };
    if (steun.x.soort === "veer") entry.kxKnPerM = finite(steun.x.k, `Oplegging ${steun.nodeId} k`);
    if (steun.z.soort === "veer") entry.kyKnPerM = finite(steun.z.k, `Oplegging ${steun.nodeId} k`);
    if (steun.ry.soort === "veer") entry.krzKnmPerRad = finite(steun.ry.k, `Oplegging ${steun.nodeId} k`) / 1e6;
    return entry;
  });
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
    if (mz) throw new Error(`Staaf ${load.beamId}: een puntmoment binnen de staaf kon niet naar een Rust-knoop worden gesplitst.`);
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

/** Build one app request for a directly conforming frame/membrane mesh. */
function buildNativeConformingFrame2DRequest(
  input: MultiInput,
  factor: (caseId?: number) => number,
  analysis: FrameAnalysis,
) {
  if (!input.plates?.length || !input.beams.length) {
    throw new Error("Gekoppelde Rust-invoer vereist minstens één plaat en één staaf.");
  }
  const plateInput: MultiInput = {
    ...input,
    beams: [], loads: [], pointLoads: [], beamPointLoads: [], thermalLoads: [],
  };
  const built = buildMesh(plateInput, factor, { solverCapacity: "native" });
  if (built.randKoppelingen.length) {
    throw new Error("De gekoppelde Rust-route ondersteunt nog geen niet-conforme randkoppelingen.");
  }
  const plateNodeIds = new Set<number>();
  const plateElements = [...built.mesh.elements.values()];
  if (!plateElements.length) throw new Error("Het plaatmesh bevat geen CST- of Q4-elementen.");
  for (const element of plateElements) {
    if (element.nodeIds.length !== 3 && element.nodeIds.length !== 4) {
      throw new Error(`Plaatmesh-element ${element.id} is geen CST- of Q4-element.`);
    }
    element.nodeIds.forEach((id: number) => plateNodeIds.add(id));
  }

  const plateNodes = [...plateNodeIds].map(id => {
    const node = built.mesh.getNode(id);
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      throw new Error(`Plaatmesh-knoop ${id} heeft ongeldige coördinaten.`);
    }
    return node;
  });
  const elementPolygons: Array<Array<{ x: number; y: number }>> = plateElements.map(element => element.nodeIds.map((id: number) => {
    const node = built.mesh.getNode(id);
    if (!node) throw new Error(`Plaatmesh-element ${element.id} mist knoop ${id}.`);
    return { x: node.x, y: node.y };
  }));
  for (const beam of input.beams) {
    const start = input.nodes.find(node => node.id === beam.from);
    const end = input.nodes.find(node => node.id === beam.to);
    if (!start || !end) throw new Error(`Staaf ${beam.id} verwijst naar een onbekende knoop.`);
    const a = { x: start.x / 1000, y: start.z / 1000 };
    const b = { x: end.x / 1000, y: end.z / 1000 };
    const dx = b.x - a.x, dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    if (!(length2 > 0)) throw new Error(`Staaf ${beam.id} heeft geen lengte.`);
    const stations = [0, 1];
    for (const polygon of elementPolygons) for (let index = 0; index < polygon.length; index++) {
      const c = polygon[index], d = polygon[(index + 1) % polygon.length];
      const ex = d.x - c.x, ey = d.y - c.y;
      const denominator = dx * ey - dy * ex;
      const qx = c.x - a.x, qy = c.y - a.y;
      if (Math.abs(denominator) < 1e-14) {
        if (Math.abs(qx * dy - qy * dx) < 1e-10) {
          for (const point of [c, d]) {
            const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2;
            if (t > 0 && t < 1) stations.push(t);
          }
        }
      } else {
        const t = (qx * ey - qy * ex) / denominator;
        const u = (qx * dy - qy * dx) / denominator;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) stations.push(t);
      }
    }
    stations.sort((x, y) => x - y);
    const uniqueStations = stations.filter((t, index) => index === 0 || t - stations[index - 1] > 1e-9);
    for (const t of uniqueStations) {
      const point = { x: a.x + t * dx, y: a.y + t * dy };
      const touchesPlateEdge = elementPolygons.some(polygon => polygon.some((vertex: { x: number; y: number }, edgeIndex: number) =>
        distanceToSegment(point, vertex, polygon[(edgeIndex + 1) % polygon.length]) <= 1e-8));
      if (touchesPlateEdge && !plateNodes.some(node => Math.hypot(node.x - point.x, node.y - point.y) <= 0.001 + 1e-12)) {
        throw new Error(`Staaf ${beam.id} raakt een plaatelement tussen rekenknopen; stem de mesh af of gebruik MPC-koppeling.`);
      }
    }
    for (let index = 0; index + 1 < uniqueStations.length; index++) {
      if (uniqueStations[index + 1] - uniqueStations[index] < 1e-10) continue;
      const t = (uniqueStations[index] + uniqueStations[index + 1]) / 2;
      const point = { x: a.x + t * dx, y: a.y + t * dy };
      const crossesAnElementInterior = elementPolygons.some(polygon => pointInPolygon(point, polygon)
        && polygon.reduce((minimum: number, vertex: { x: number; y: number }, edgeIndex: number) => Math.min(minimum,
          distanceToSegment(point, vertex, polygon[(edgeIndex + 1) % polygon.length])), Infinity) > 1e-8);
      if (crossesAnElementInterior) {
        throw new Error(`Staaf ${beam.id} loopt door het binnenvlak van een plaat; daarvoor is een niet-conforme MPC-koppeling nodig.`);
      }
    }
  }
  // The common FEM Studio mesher shares all coincident frame/plate nodes. Give
  // the Rust frame the same edge stations so both element families use those
  // exact shared translations.
  const beams = input.beams.map(beam => {
    const start = input.nodes.find(node => node.id === beam.from);
    const end = input.nodes.find(node => node.id === beam.to);
    if (!start || !end) throw new Error(`Staaf ${beam.id} verwijst naar een onbekende knoop.`);
    const dx = (end.x - start.x) / 1000, dy = (end.z - start.z) / 1000;
    const length2 = dx * dx + dy * dy;
    const edgeStations = plateNodes.flatMap(node => {
      const px = node.x - start.x / 1000, py = node.y - start.z / 1000;
      const t = (px * dx + py * dy) / length2;
      const distance = Math.abs(px * dy - py * dx) / Math.sqrt(length2);
      return t > 1e-9 && t < 1 - 1e-9 && distance <= 0.001
        ? [t] : [];
    });
    const extraSneden = [...(beam.extraSneden ?? []), ...edgeStations]
      .sort((a, b) => a - b)
      .filter((value, index, values) => index === 0 || value - values[index - 1] > 1e-9);
    return { ...beam, extraSneden };
  });
  const frameInput: MultiInput = {
    ...input, beams, plates: undefined, edgeLoads: undefined, edgePointLoads: undefined,
  };
  const request = buildNativeFrame2DRequest(frameInput, factor, analysis, true) as ReturnType<typeof buildNativeFrame2DRequest> & {
    membrane: {
      materials: Array<{ id: number; eMpa: number; nu: number; law: NativeMaterialLaw }>;
      triangles: Array<{ id: number; nodeIds: [number, number, number]; materialId: number; thicknessM: number }>;
      quads: Array<{ id: number; nodeIds: [number, number, number, number]; materialId: number; thicknessM: number }>;
      orthotropicMaterials: Array<{ materialId: number; e1Mpa: number; e2Mpa: number; nu12: number; g12Mpa: number; angleRad: number }>;
      modulusCurves: NativeModulusCurve[];
    };
  };

  const nextNodeId = Math.max(0, ...request.nodes.map(node => node.id)) + 1;
  let next = nextNodeId;
  const coupledNodeId = new Map<number, number>();
  for (const plateNode of plateNodes) {
    const matches = request.nodes.map(node => ({ node,
      distance: Math.hypot(node.x - plateNode.x, node.y - plateNode.y),
    })).filter(match => match.distance <= 0.001 + 1e-12)
      .sort((a, b) => a.distance - b.distance);
    if (matches.length > 1 && Math.abs(matches[0].distance - matches[1].distance) < 1e-9) {
      throw new Error("Een plaatknoop valt binnen 1 mm van twee verschillende raamwerknodes.");
    }
    const id = matches[0]?.node.id ?? next++;
    if (!matches.length) request.nodes.push({ id, x: plateNode.x, y: plateNode.y });
    coupledNodeId.set(plateNode.id, id);
  }

  // Keep the UI node → mesh node map aligned with the IDs used in the Rust
  // request. The plate result adapter uses it to restore the original node IDs.
  built.nodeIdMap = new Map([...built.nodeIdMap].map(([uiId, meshId]) => {
    const oldNode = built.mesh.getNode(meshId);
    const uiNode = input.nodes.find(node => node.id === uiId);
    if (!oldNode || !uiNode) throw new Error(`UI-knoop ${uiId} ontbreekt in het plaatmesh.`);
    const match = request.nodes.find(node =>
      Math.hypot(node.x - uiNode.x / 1000, node.y - uiNode.z / 1000) <= 0.001 + 1e-12);
    if (!match) throw new Error(`UI-knoop ${uiId} ontbreekt in het gekoppelde Rust-mesh.`);
    return [uiId, match.id];
  }));

  const materials = new Map<number, { id: number; eMpa: number; nu: number; law: NativeMaterialLaw }>();
  const orthotropicMaterials: Array<{ materialId: number; e1Mpa: number; e2Mpa: number; nu12: number; g12Mpa: number; angleRad: number }> = [];
  for (const info of built.plateInfo) {
    const id = info.region.materialId;
    if (materials.has(id)) continue;
    const material = built.mesh.getMaterial(id);
    if (!material || !(material.E > 0) || !(material.nu > -1 && material.nu < 0.5)) {
      throw new Error(`Plaat ${info.plateId}: ongeldige elastische materiaalparameters.`);
    }
    materials.set(id, { id, eMpa: material.E / 1e6, nu: material.nu, law: { kind: "elastic" } });
    if (material.orthotroop) orthotropicMaterials.push({
      materialId: id,
      e1Mpa: material.orthotroop.E1 / 1e6,
      e2Mpa: material.orthotroop.E2 / 1e6,
      nu12: material.orthotroop.nu12,
      g12Mpa: material.orthotroop.G12 / 1e6,
      angleRad: material.orthotroop.hoek,
    });
  }
  const { laws, curves } = materialOptions(input, built, analysis, false);
  if (isMaterialAnalysis(analysis)
      && !input.beams.some(beam => beam.axialMaterialLaw)
      && laws.size === 0 && curves.length === 0) {
    throw new Error("Geef minstens één staaf of plaat een FNL-materiaalwet of afnemende E-curve.");
  }
  for (const [id, material] of materials) material.law = laws.get(id) ?? { kind: "elastic" };
  const triangles: NonNullable<typeof request.membrane>["triangles"] = [];
  const quads: NonNullable<typeof request.membrane>["quads"] = [];
  for (const element of plateElements) {
    const nodeIds = element.nodeIds.map((id: number) => {
      const coupled = coupledNodeId.get(id);
      if (coupled === undefined) throw new Error(`Plaatmesh-element ${element.id} mist gekoppelde knoop ${id}.`);
      return coupled;
    });
    const thicknessM = element.thickness;
    if (!(Number.isFinite(thicknessM) && thicknessM > 0)) {
      throw new Error(`Plaatmesh-element ${element.id} heeft een ongeldige dikte.`);
    }
    if (nodeIds.length === 3) triangles.push({ id: element.id,
      nodeIds: nodeIds as [number, number, number], materialId: element.materialId, thicknessM });
    else quads.push({ id: element.id,
      nodeIds: nodeIds as [number, number, number, number], materialId: element.materialId, thicknessM });
  }
  request.membrane = { materials: [...materials.values()], triangles, quads, orthotropicMaterials,
    modulusCurves: curves };

  const frameMemberNodeIds = new Set(request.members.flatMap(member => [member.startNodeId, member.endNodeId]));
  for (const plateNode of plateNodes) {
    const load = plateNode.loads;
    if (!load.fx && !load.fy && !load.moment) continue;
    const nodeId = coupledNodeId.get(plateNode.id)!;
    if (load.moment && !frameMemberNodeIds.has(nodeId)) {
      throw new Error("Een plaatrandmoment op een membraanknoop zonder raamwerkrotatie wordt niet ondersteund.");
    }
    request.nodalLoads.push({ nodeId, fx: load.fx / 1000, fy: load.fy / 1000, mz: load.moment / 1000 });
  }
  return { request, built };
}

export function nativeFrame2DResultToSolverResult(
  request: ReturnType<typeof buildNativeFrame2DRequest>, native: NativeFrame2DResult,
): SolverResult {
  const residualLimit = isMaterialAnalysis(request.analysis) ? 1e-5 : 1e-8;
  if (!native || typeof native !== "object" || !Array.isArray(native.nodes)
      || !Array.isArray(native.members) || native.nodes.length !== request.nodes.length
      || native.members.length !== request.members.length
      || native.nodes.some(node => !node || typeof node !== "object")
      || native.members.some(member => !member || typeof member !== "object")
      || !Number.isFinite(native.equilibriumResidual) || native.equilibriumResidual < 0
      || native.equilibriumResidual > residualLimit) {
    throw new Error(`De Rust 2D-raamwerkkern leverde geen volledig evenwichtig resultaat `
      + `(residu ${native.equilibriumResidual}, knopen ${native.nodes?.length}/${request.nodes.length}, `
      + `staven ${native.members?.length}/${request.members.length}).`);
  }
  const nodeIds = new Set(request.nodes.map(node => node.id));
  const memberIds = new Set(request.members.map(member => member.id));
  const requestNodes = new Map(request.nodes.map(node => [node.id, node]));
  const mesh = frameMeshes.get(request);
  if (!mesh) throw new Error("De Rust 2D-raamwerkroute mist de bijbehorende staafindeling.");
  const supported = new Set(request.supports.map(support => support.nodeId));
  const displacements = new Map<number, { ux: number; uz: number; ry: number }>();
  const reactions = new Map<number, { fx: number; fz: number; my: number }>();
  const seenNodes = new Set<number>();
  for (const node of native.nodes) {
    if (!nodeIds.has(node.nodeId) || seenNodes.has(node.nodeId)
        || !Array.isArray(node.displacement) || node.displacement.length !== 3
        || !Array.isArray(node.reaction) || node.reaction.length !== 3
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
    const count = Array.isArray(member.stationsM) ? member.stationsM.length : 0;
    const requestedMember = request.members.find(entry => entry.id === member.memberId);
    const start = requestedMember && requestNodes.get(requestedMember.startNodeId);
    const end = requestedMember && requestNodes.get(requestedMember.endNodeId);
    const expectedLengthM = start && end ? Math.hypot(end.x - start.x, end.y - start.y) : NaN;
    const stationToleranceM = Math.max(1e-9, expectedLengthM * 1e-9);
    if (!memberIds.has(member.memberId) || segmentElements.has(member.memberId)
        || !Array.isArray(member.localEndForces) || member.localEndForces.length !== 6 || count < 2
        || arrays.some(array => !Array.isArray(array) || array.length !== count
          || array.some(value => !Number.isFinite(value)))
        || !Number.isFinite(expectedLengthM) || !(expectedLengthM > 0)
        || Math.abs(member.stationsM[0]) > stationToleranceM
        || Math.abs(member.stationsM[count - 1] - expectedLengthM) > stationToleranceM
        // Repeated abscissae are valid at concentrated-load jumps; a reversal is not.
        || member.stationsM.some((station, index) => index > 0
          && station < member.stationsM[index - 1] - stationToleranceM)
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
    if (member.sectionHistory) {
      const history = member.sectionHistory;
      if ([history.maximumAbsPlasticStrain, history.maximumEquivalentPlasticStrain,
        history.maximumTensileDamage].some(value => !Number.isFinite(value) || value < 0)
          || history.maximumTensileDamage > 1) {
        throw new Error("De Rust 2D-raamwerkkern leverde een ongeldige doorsnedegeschiedenis.");
      }
    }
    segmentElements.set(member.memberId, {
      N: member.normalForceKn[0] * 1000, V: member.shearForceKn[0] * 1000,
      ...(member.axialHistory ? { axialHistory: { ...member.axialHistory } } : {}),
      ...(member.sectionHistory ? { sectionHistory: { ...member.sectionHistory } } : {}),
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
      const sectionHistories = segments.map(segment => segmentElements.get(segment.id)!.sectionHistory)
        .filter((history): history is NonNullable<ElementForces["sectionHistory"]> => !!history);
      if (sectionHistories.length) merged.sectionHistory = {
        maximumAbsPlasticStrain: Math.max(...sectionHistories.map(history => history.maximumAbsPlasticStrain)),
        maximumEquivalentPlasticStrain: Math.max(...sectionHistories.map(history => history.maximumEquivalentPlasticStrain)),
        maximumTensileDamage: Math.max(...sectionHistories.map(history => history.maximumTensileDamage)),
      };
    }
    elements.set(beamId, merged);
  }
  return { displacements, reactions, elements,
    maxDisplacement: grootsteVerplaatsing(displacements.values(), elements.values()) };
}

async function nativeConformingFrameResultToSolverResult(
  input: MultiInput,
  request: ReturnType<typeof buildNativeFrame2DRequest> & { membrane: NonNullable<ReturnType<typeof buildNativeConformingFrame2DRequest>["request"]["membrane"]> },
  built: ReturnType<typeof buildMesh>,
  native: NativeFrame2DResult,
  supports: MultiInput["supports"],
): Promise<SolverResult> {
  const frameResult = nativeFrame2DResultToSolverResult(request, native);
  const expectedTriangles = [...built.mesh.elements.values()].filter(element => element.nodeIds.length === 3).length;
  const expectedQuads = [...built.mesh.elements.values()].filter(element => element.nodeIds.length === 4).length;
  const triangles = native.membraneTriangles ?? [];
  const quads = native.membraneQuads ?? [];
  if (triangles.length !== expectedTriangles || quads.length !== expectedQuads) {
    throw new Error(`De Rust-kern leverde geen volledig gekoppeld plaatresultaat terug `
      + `(CST ${triangles.length}/${expectedTriangles}, Q4 ${quads.length}/${expectedQuads}).`);
  }
  if (expectedTriangles && input.plates?.some(plate => plate.threeLayer)) {
    throw new Error("De Blaauwendraad drie-lagencontrole vereist een uitsluitend Q4-plaatmesh.");
  }
  const membraneResult = nativeMembraneResultToSolverResult(built, {
    nodes: native.nodes.map(node => ({
      nodeId: node.nodeId,
      uxM: node.displacement[0],
      uyM: node.displacement[1],
      rxKn: node.reaction[0],
      ryKn: node.reaction[1],
    })),
  }, [
    ...triangles.map(element => ({
      elementId: element.triangleId,
      stressMpa: element.stressMpa,
      effectiveEMpa: element.effectiveEMpa,
      maxEquivalentStrain: element.maxEquivalentStrain,
      equivalentPlasticStrain: element.equivalentPlasticStrain,
      tensileDamage: element.tensileDamage,
    })),
    ...quads.map(quad => ({
      elementId: quad.quadId,
      stressMpa: quad.averageStressMpa,
      effectiveEMpa: quad.gaussPoints.reduce((sum, point) => sum + point.effectiveEMpa, 0) / 4,
      maxEquivalentStrain: Math.max(...quad.gaussPoints.map(point => point.maxEquivalentStrain)),
      equivalentPlasticStrain: Math.max(...quad.gaussPoints.map(point => point.equivalentPlasticStrain)),
      tensileDamage: Math.max(...quad.gaussPoints.map(point => point.tensileDamage)),
      threeLayerSamples: quad.gaussPoints.map((point, index) => {
        const element = built.mesh.getElement(quad.quadId)!;
        const nodeCoordinates = element.nodeIds.map((id: number) => built.mesh.getNode(id)!);
        const a = 1 / Math.sqrt(3);
        const positions = [[-a, -a], [a, -a], [a, a], [-a, a]] as const;
        const [xi, eta] = positions[index];
        const weights = [(1 - xi) * (1 - eta) / 4, (1 + xi) * (1 - eta) / 4,
          (1 + xi) * (1 + eta) / 4, (1 - xi) * (1 + eta) / 4];
        const positionM: [number, number] = [
          weights.reduce((sum, weight, i) => sum + weight * nodeCoordinates[i].x, 0),
          weights.reduce((sum, weight, i) => sum + weight * nodeCoordinates[i].y, 0),
        ];
        return {
          id: `quad-${quad.quadId}-gauss-${index + 1}`,
          positionM,
          nx: point.stressMpa[0] * element.thickness * 1000,
          ny: point.stressMpa[1] * element.thickness * 1000,
          nxy: point.stressMpa[2] * element.thickness * 1000,
        };
      }),
    })),
  ], supports, {
    required: new Set(built.nodeIdMap.values()),
    allowed: new Set(request.nodes.map(node => node.id)),
  });
  frameResult.plateElements = membraneResult.plateElements;
  frameResult.maxDisplacement = Math.max(frameResult.maxDisplacement, membraneResult.maxDisplacement);
  if (membraneResult.plateNodeDisplacements) frameResult.plateNodeDisplacements = membraneResult.plateNodeDisplacements;
  return input.plates?.some(plate => plate.threeLayer)
    ? voegNativeDrieLagencontroleToe(input, frameResult)
    : frameResult;
}

async function solveNativeFrame2DWithRecovery(
  request: ReturnType<typeof buildNativeFrame2DRequest> & { membrane?: unknown },
): Promise<NativeFrame2DResult> {
  // The ordinary assembled matrix has a hard 20,000-DOF cap. The linear
  // frontal path assembles members directly and can handle a narrow front
  // above that global size. Its own front-width limit remains explicit.
  const largeLinearFrame = request.analysis === "linear" && !request.membrane
    && request.nodes.length * 3 > 20_000;
  try {
    return await solveNativeFem<NativeFrame2DResult>("frame2d", largeLinearFrame
      ? { ...request, linearBackend: "frontalWave", frontalMaxFrontDofs: 256 }
      : request);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const iterativeFailure = /sparse solver did not converge within|sparse solve lost residual accuracy/.test(reason);
    if (largeLinearFrame || request.analysis !== "linear" || request.membrane || request.members.length > 2500
        || !iterativeFailure) throw error;
    try {
      return await solveNativeFem<NativeFrame2DResult>("frame2d", {
        ...request, linearBackend: "frontalWave", frontalMaxFrontDofs: 256,
      });
    } catch (frontalError) {
      const secondReason = frontalError instanceof Error ? frontalError.message : String(frontalError);
      throw new Error(`2D-raamwerk: de iteratieve en frontale oplossers faalden: ${reason}; ${secondReason}`);
    }
  }
}

// ── Trek-alleen staven (issue #234) ─────────────────────────────────────────
//
// De Rust-raamwerkkern kent geen trek-alleen staaf, wel een normaalkrachthuls
// per staafeind (`releases.uxEnd`). De statuslus staat daarom hier, met
// dezelfde regels als de TypeScript-kern (`losOpMetAxiaalVoorwaarden` in
// core/solver/NonlinearSolver.ts):
//   - een actieve trek-alleen staaf met een gemiddelde drukkracht valt uit:
//     huls aan het eind van zijn laatste deelelement;
//   - een uitgeschakelde staaf doet weer mee als hij in de nieuwe stand zou
//     rekken: N_proef = E·A·(δ/L − α·ΔT) > 0, δ de verlenging tussen zijn
//     eindknopen;
//   - bij tweede orde (en FNL zonder schijven) convergeert de verzameling
//     eerst met lineaire rondes, daarna de niet-lineaire vanaf die stand;
//   - een terugkerende stand of te veel rondes is een fout.

type FrameRequest = ReturnType<typeof buildNativeFrame2DRequest> & { membrane?: unknown };

const MAX_TREK_RONDES = 50;

function metAxiaalLos(request: FrameRequest, losseLeden: Set<number>): FrameRequest {
  const kopie = {
    ...request,
    members: request.members.map(member => {
      if (!losseLeden.has(member.id)) return member;
      // Een axiale eindveer vervalt met de huls: een veer op een losse
      // vrijheidsgraad telt niet (zelfde regel als bij het opbouwen).
      const { uxEndKnPerM: _veer, ...springs } = member.springs as Record<string, number>;
      return { ...member, releases: { ...member.releases, uxEnd: true }, springs };
    }),
  } as FrameRequest;
  const mesh = frameMeshes.get(request);
  if (mesh) frameMeshes.set(kopie, mesh);
  return kopie;
}

/**
 * De last langs de as van een uitgeschakelde staaf over BEIDE eindknopen,
 * zoals bij een actieve staaf; zie `verdeelEigenAxiaalLast` in
 * core/solver/NonlinearSolver.ts. De huls aan het eind zet de axiale
 * lijnlast (eigen gewicht van een schuine diagonaal) en een axiale puntlast
 * anders helemaal op de beginknoop; met eigen gewicht en scheefstand bleef de
 * lus daardoor wisselen. Hier: R_eind = ∫ q(x)·x/L dx + Σ P·x/L als knooplast
 * langs de as op de eindknoop, −R_eind op de beginknoop. `ketens` = per
 * uitgeschakelde staaf zijn segment-id's, van begin naar eind.
 */
function metEigenAxiaalLast(request: FrameRequest, basis: FrameRequest, ketens: number[][]): FrameRequest {
  if (ketens.length === 0) return request;
  const knopen = new Map(basis.nodes.map(node => [node.id, node]));
  const leden = new Map(basis.members.map(member => [member.id, member]));
  const extra: typeof basis.nodalLoads = [];
  for (const ketting of ketens) {
    const eerste = leden.get(ketting[0]!), laatste = leden.get(ketting[ketting.length - 1]!);
    if (!eerste || !laatste) continue;
    const begin = knopen.get(eerste.startNodeId)!, eind = knopen.get(laatste.endNodeId)!;
    const L = Math.hypot(eind.x - begin.x, eind.y - begin.y);
    if (!(L > 0)) continue;
    const c = (eind.x - begin.x) / L, sn = (eind.y - begin.y) / L;
    const inKetting = new Map<number, number>(); // segment-id → plaats van zijn begin langs de staaf (m)
    for (const id of ketting) {
      const lid = leden.get(id);
      if (!lid) continue;
      const a = knopen.get(lid.startNodeId)!;
      inKetting.set(id, (a.x - begin.x) * c + (a.y - begin.y) * sn);
    }
    let rEind = 0;
    for (const load of basis.memberLoads) {
      const x0 = inKetting.get(load.memberId);
      if (x0 === undefined) continue;
      const xa = x0 + load.startPositionM, xb = x0 + load.endPositionM;
      // ∫ q(x)·x dx over [xa, xb] voor q lineair van qa naar qb.
      rEind += (xb - xa) * (load.qxStartKnPerM * (2 * xa + xb) + load.qxEndKnPerM * (xa + 2 * xb)) / 6 / L;
    }
    for (const load of basis.memberPointLoads) {
      const x0 = inKetting.get(load.memberId);
      if (x0 === undefined) continue;
      rEind += load.pxKn * (x0 + load.positionM) / L;
    }
    if (rEind === 0) continue;
    extra.push({ nodeId: eind.id, fx: rEind * c, fy: rEind * sn, mz: 0 });
    extra.push({ nodeId: begin.id, fx: -rEind * c, fy: -rEind * sn, mz: 0 });
  }
  if (extra.length === 0) return request;
  const kopie = { ...request, nodalLoads: [...request.nodalLoads, ...extra] } as FrameRequest;
  const mesh = frameMeshes.get(request);
  if (mesh) frameMeshes.set(kopie, mesh);
  return kopie;
}

function lineaireKopie(request: FrameRequest): FrameRequest {
  const { loadPath: _loadPath, ...rest } = request as FrameRequest & { loadPath?: unknown };
  const kopie = {
    ...rest,
    analysis: "linear",
    materials: request.materials.map(({ id, eMpa }) => ({ id, eMpa })),
  } as FrameRequest;
  const mesh = frameMeshes.get(request);
  if (mesh) frameMeshes.set(kopie, mesh);
  return kopie;
}

/**
 * Los één Rust-verzoek op, met de trek-alleen-lus als `input` zulke staven
 * heeft. `uit` = de model-id's van de uitgeschakelde staven, of `undefined`
 * als het model er geen heeft.
 */
async function solveNativeFrame2DTrekAlleen(
  input: MultiInput, request: FrameRequest,
): Promise<{ native: NativeFrame2DResult; request: FrameRequest; uit?: number[] }> {
  const trekStaven = input.beams.filter(beam => beam.tensionOnly === true);
  if (trekStaven.length === 0) {
    return { native: await solveNativeFrame2DWithRecovery(request), request };
  }
  const mesh = frameMeshes.get(request);
  if (!mesh) throw new Error("De Rust 2D-raamwerkroute mist de bijbehorende staafindeling.");
  const knopen = new Map(request.nodes.map(node => [node.id, node]));
  const doorsnede = new Map(request.sections.map(section => [section.id, section]));
  const materiaal = new Map(request.materials.map(material => [material.id, material]));
  const thermisch = new Map<number, number>();
  for (const load of request.thermalLoads) {
    thermisch.set(load.memberId, (thermisch.get(load.memberId) ?? 0) + load.deltaTK * load.alphaPerK);
  }
  const naam = (ids: Iterable<number>) => [...ids].sort((a, b) => a - b).join(", ");

  const fase = async (basis: FrameRequest, start: Set<number>) => {
    let uit = new Set(start);
    const gezien = new Set<string>();
    for (let ronde = 1; ronde <= MAX_TREK_RONDES; ronde++) {
      const losseLeden = new Set([...uit].map(beamId => {
        const segmenten = mesh.segmentsByBeam.get(beamId)!;
        return segmenten[segmenten.length - 1].id;
      }));
      const verzoek = metEigenAxiaalLast(metAxiaalLos(basis, losseLeden), basis, [...uit].map(beamId =>
        mesh.segmentsByBeam.get(beamId)!.map(segment => segment.id)));
      const native = await solveNativeFrame2DWithRecovery(verzoek);
      const leden = new Map(native.members.map(member => [member.memberId, member]));
      const verplaatsing = new Map(native.nodes.map(node => [node.nodeId, node.displacement]));
      const kracht = new Map<number, number>();
      let schaal = 0;
      for (const beam of trekStaven) {
        const segmenten = mesh.segmentsByBeam.get(beam.id)!;
        let som = 0;
        for (const segment of segmenten) {
          if (!uit.has(beam.id)) {
            const n = leden.get(segment.id)?.normalForceKn ?? [];
            som += n.length ? n.reduce((a, b) => a + b, 0) / n.length : 0;
          } else {
            const a = knopen.get(segment.startNodeId)!, b = knopen.get(segment.endNodeId)!;
            const ua = verplaatsing.get(segment.startNodeId)!, ub = verplaatsing.get(segment.endNodeId)!;
            const L = Math.hypot(b.x - a.x, b.y - a.y);
            const c = (b.x - a.x) / L, sn = (b.y - a.y) / L;
            const delta = (ub[0] - ua[0]) * c + (ub[1] - ua[1]) * sn;
            const ea = materiaal.get(beam.id)!.eMpa * 1000 * doorsnede.get(segment.id)!.areaM2;
            som += ea * (delta / L - (thermisch.get(segment.id) ?? 0));
          }
        }
        const n = som / segmenten.length;
        kracht.set(beam.id, n);
        schaal = Math.max(schaal, Math.abs(n));
      }
      const tol = 1e-9 * Math.max(schaal, 1);
      const volgende = new Set<number>();
      for (const beam of trekStaven) {
        const n = kracht.get(beam.id)!;
        if (uit.has(beam.id) ? !(n > tol) : n < -tol) volgende.add(beam.id);
      }
      if (naam(volgende) === naam(uit)) return { native, request: verzoek, uit };
      gezien.add(naam(uit));
      if (gezien.has(naam(volgende))) {
        throw new Error("De trek-alleen-iteratie keert terug naar een eerdere stand en convergeert niet "
          + `(uitgeschakeld afwisselend ${naam(uit) || "geen"} en ${naam(volgende) || "geen"}). `
          + "Er is geen eenduidige krachtsverdeling met alleen getrokken verbanden.");
      }
      uit = volgende;
    }
    throw new Error(`De trek-alleen-iteratie is na ${MAX_TREK_RONDES} rondes niet geconvergeerd; `
      + "er wordt geen krachtsverdeling gegeven.");
  };

  let start = new Set<number>();
  if (request.analysis !== "linear" && !request.membrane) {
    start = (await fase(lineaireKopie(request), start)).uit;
  }
  const eind = await fase(request, start);
  return { native: eind.native, request: eind.request, uit: [...eind.uit].sort((a, b) => a - b) };
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
      const factor = (caseId?: number) => caseId === loadCase.id ? 1 : 0;
      const coupled = input.plates?.length
        ? buildNativeConformingFrame2DRequest(directionalInput, factor, analysis)
        : undefined;
      const request = coupled?.request ?? buildNativeFrame2DRequest(directionalInput, factor, analysis);
      if (!request.nodalLoads.length && !request.memberLoads.length
          && !request.memberPointLoads.some(load => load.pxKn !== 0 || load.pyKn !== 0)
          && !request.thermalLoads.length) continue;
      const { native: result, request: opgelost, uit } = await solveNativeFrame2DTrekAlleen(directionalInput, request);
      const uitkomst = coupled
        ? await nativeConformingFrameResultToSolverResult(directionalInput,
          opgelost as typeof coupled.request, coupled.built, result, directionalInput.supports)
        : nativeFrame2DResultToSolverResult(opgelost, result);
      if (uit) uitkomst.trekAlleenUitgeschakeld = uit;
      perCase.set(loadCase.id + offset, uitkomst);
    }
  };
  await solveDirection(input.scheefstand?.richting, 0);
  if (input.scheefstand) {
    await solveDirection((-input.scheefstand.richting) as 1 | -1, SCHEEFSTAND_ID_OFFSET);
    registreerScheefstandRichtingen(perCase, input.scheefstand.richting);
  }
  return perCase;
}

/**
 * Each combination is solved at its full factored load: second order and FNL
 * always, first order ("linear") when the model has tension-only members
 * (issue #234) and superposition no longer holds.
 */
export async function solveAllCombinationsNativeFrame2D(
  input: MultiInput, combinations: readonly LoadCombination[],
  analysis: FrameAnalysis = "geometric",
): Promise<Map<number, SolverResult>> {
  const results = new Map<number, SolverResult>();
  for (const combination of combinations) {
    if (combination.eindtoestand !== undefined) {
      throw new Error(`Combinatie ${combination.name}: eindstijfheidvariant is niet ondersteund door de Rust 2D-raamwerkroute.`);
    }
    const directionalInput = input.scheefstand && combination.scheefstandRichting !== undefined
      ? { ...input, scheefstand: { ...input.scheefstand, richting: combination.scheefstandRichting } }
      : input;
    const factor = (caseId?: number) => caseId === undefined ? 0 : combination.factors.get(caseId) ?? 0;
    const coupled = input.plates?.length
      ? buildNativeConformingFrame2DRequest(directionalInput, factor, analysis)
      : undefined;
    const request = coupled?.request ?? buildNativeFrame2DRequest(directionalInput, factor, analysis);
    // Een combinatie zonder enige last: hetzelfde als de superpositie (nul).
    if (analysis === "linear" && !request.nodalLoads.length && !request.memberLoads.length
        && !request.memberPointLoads.some(load => load.pxKn !== 0 || load.pyKn !== 0)
        && !request.thermalLoads.length) continue;
    const { native: result, request: opgelost, uit } = await solveNativeFrame2DTrekAlleen(directionalInput, request);
    const uitkomst = coupled
      ? await nativeConformingFrameResultToSolverResult(directionalInput,
        opgelost as typeof coupled.request, coupled.built, result, directionalInput.supports)
      : nativeFrame2DResultToSolverResult(opgelost, result);
    if (uit) uitkomst.trekAlleenUitgeschakeld = uit;
    results.set(combination.id, uitkomst);
  }
  return results;
}

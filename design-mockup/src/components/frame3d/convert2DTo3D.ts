import type { Beam, Load, Node, Support } from "../fem/femTypes";
import type {
  Frame3DModel,
  Frame3DMemberLoad,
  Frame3DMemberPointLoad,
  Frame3DNodalLoad,
  Frame3DThermalLoad,
  Frame3DSupport,
  Frame3DSupportRestraints,
} from "./frame3dModel";
import { frame3DMemberAxes } from "./frame3dModel";

export interface ConversionResult {
  model: Frame3DModel;
  skippedLoadCount: number;
  skippedSupportCount: number;
}

const supportMap: Partial<Record<Support["type"], Frame3DSupportRestraints>> = {
  pinned:  { ux: true,  uy: true, uz: true,  rx: false, ry: false, rz: false },
  fixed:   { ux: true,  uy: true, uz: true,  rx: true,  ry: true,  rz: true  },
  xRoller: { ux: true,  uy: true, uz: false, rx: false, ry: false, rz: false },
  zRoller: { ux: false, uy: true, uz: true,  rx: false, ry: false, rz: false },
};

/**
 * Lift a planar X/Z frame into the X/Y/Z workspace at Y = 0.
 * Geometry, rigid restraints, nodal forces/moments and transverse member
 * loads are copied. Entity numbers stay equal so IFC and audit output can
 * keep referring to them. A 2D line load with an axial component cannot be
 * represented by the current 3D member-load contract and is counted as
 * skipped instead of being silently changed.
 */
export function convert2DTo3D(input: {
  nodes: readonly Node[];
  beams: readonly Beam[];
  supports: readonly Support[];
  loads: readonly Load[];
}): ConversionResult {
  const nodes = input.nodes.map((node) => ({
    id: node.id,
    x: node.x / 1000,
    y: 0,
    z: node.z / 1000,
  }));
  const beams = input.beams.map((beam) => ({
    id: beam.id,
    startNodeId: beam.from,
    endNodeId: beam.to,
    ...(beam.profile ? { profileName: beam.profile } : {}),
    ...(beam.material ? { material: beam.material } : {}),
    ...(beam.checkConfig ? { checkConfig: beam.checkConfig } : {}),
  }));

  const supports: Frame3DSupport[] = [];
  let skippedSupportCount = 0;
  for (const support of input.supports) {
    const restraints = supportMap[support.type];
    if (restraints) {
      supports.push({ nodeId: support.nodeId, ...restraints });
      continue;
    }
    if (support.type === "xSpring" || support.type === "zSpring" || support.type === "rotSpring") {
      if (!(typeof support.k === "number" && Number.isFinite(support.k) && support.k > 0)) {
        skippedSupportCount += 1;
        continue;
      }
      supports.push({
        nodeId: support.nodeId,
        ux: false, uy: true, uz: false, rx: false, ry: false, rz: false,
        springs: support.type === "xSpring"
          ? { kxKnPerM: support.k * 1000 }
          : support.type === "zSpring"
            ? { kzKnPerM: support.k * 1000 }
            : { kryKnmPerRad: support.k },
      });
      continue;
    }
    {
      skippedSupportCount += 1;
      continue;
    }
  }

  const loads: Frame3DNodalLoad[] = [];
  const memberLoads: Frame3DMemberLoad[] = [];
  const memberPointLoads: Frame3DMemberPointLoad[] = [];
  const thermalLoads: Frame3DThermalLoad[] = [];
  let skippedLoadCount = 0;
  for (const load of input.loads) {
    if (load.type === "lineLoad") {
      if (load.beamId === undefined) {
        skippedLoadCount += 1;
        continue;
      }
      const beam = input.beams.find((item) => item.id === load.beamId);
      const start = beam && input.nodes.find((node) => node.id === beam.from);
      const end = beam && input.nodes.find((node) => node.id === beam.to);
      if (!beam || !start || !end) {
        skippedLoadCount += 1;
        continue;
      }
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const lengthMm = Math.hypot(dx, dz);
      const startFraction = load.startFrac ?? 0;
      const endFraction = load.endFrac ?? 1;
      const qStart = load.qStart ?? load.q ?? 0;
      const qEnd = load.qEnd ?? load.q ?? 0;
      if (!(lengthMm > 0) || startFraction < 0 || endFraction > 1 || startFraction >= endFraction ||
          ![qStart, qEnd, startFraction, endFraction].every(Number.isFinite)) {
        skippedLoadCount += 1;
        continue;
      }

      const exX = dx / lengthMm;
      const exZ = dz / lengthMm;
      // De 3D-kern kiest lokale z uit global-up, behalve bij een verticale
      // staaf; daar gebruikt hij global X. Dit is dezelfde afspraak als de
      // viewer en de Rust-kern.
      const vertical = Math.abs(exZ) > 0.999;
      const ezX = vertical ? 1 : -exZ * exX / Math.abs(exX);
      const ezZ = vertical ? 0 : Math.abs(exX);
      const components = (q: number): [number, number] => {
        if ((load.qCoord ?? "global") === "local") {
          return (load.qDir ?? "z") === "x"
            ? [q * exX, q * exZ]
            : [-q * exZ, q * exX];
        }
        return (load.qDir ?? "z") === "x" ? [q, 0] : [0, q];
      };
      const [gxStart, gzStart] = components(qStart);
      const [gxEnd, gzEnd] = components(qEnd);
      const axialStart = gxStart * exX + gzStart * exZ;
      const axialEnd = gxEnd * exX + gzEnd * exZ;
      const tolerance = Math.max(1, Math.abs(qStart), Math.abs(qEnd)) * 1e-10;
      if (Math.abs(axialStart) > tolerance || Math.abs(axialEnd) > tolerance) {
        skippedLoadCount += 1;
        continue;
      }
      const qzStart = gxStart * ezX + gzStart * ezZ;
      const qzEnd = gxEnd * ezX + gzEnd * ezZ;
      if (Math.abs(qzStart) <= tolerance && Math.abs(qzEnd) <= tolerance) {
        skippedLoadCount += 1;
        continue;
      }
      memberLoads.push({
        id: load.id,
        beamId: load.beamId,
        caseId: load.caseId,
        qyStart: 0,
        qyEnd: 0,
        qzStart,
        qzEnd,
        startPositionM: startFraction * lengthMm / 1000,
        endPositionM: endFraction * lengthMm / 1000,
      });
      continue;
    }

    if (load.type === "pointForce" && load.beamId !== undefined && load.posFrac !== undefined) {
      const beam = input.beams.find((item) => item.id === load.beamId);
      const start = beam && input.nodes.find((node) => node.id === beam.from);
      const end = beam && input.nodes.find((node) => node.id === beam.to);
      const fraction = load.posFrac;
      if (!beam || !start || !end || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
        skippedLoadCount += 1;
        continue;
      }
      const lengthMm = Math.hypot(end.x - start.x, end.z - start.z);
      const axes = frame3DMemberAxes(
        { x: start.x, y: 0, z: start.z },
        { x: end.x, y: 0, z: end.z },
      );
      const global: [number, number, number] = [load.fx ?? 0, 0, load.fz ?? 0];
      const dot = (axis: [number, number, number]) =>
        global[0] * axis[0] + global[1] * axis[1] + global[2] * axis[2];
      const px = dot(axes.ex), py = dot(axes.ey), pz = dot(axes.ez);
      const tolerance = Math.max(1, Math.abs(global[0]), Math.abs(global[2])) * 1e-10;
      if (!(lengthMm > 0) || Math.abs(px) > tolerance || (Math.abs(py) <= tolerance && Math.abs(pz) <= tolerance)) {
        skippedLoadCount += 1;
        continue;
      }
      memberPointLoads.push({
        id: load.id, beamId: load.beamId, caseId: load.caseId,
        py, pz, positionM: fraction * lengthMm / 1000,
      });
      continue;
    }

    if (load.type === "thermal" && load.beamId !== undefined && load.deltaT !== undefined &&
        input.beams.some((beam) => beam.id === load.beamId) && Number.isFinite(load.deltaT) && load.deltaT !== 0) {
      thermalLoads.push({
        id: load.id, beamId: load.beamId, caseId: load.caseId,
        deltaTUniformK: load.deltaT, deltaTGradientYK: 0, deltaTGradientZK: 0,
      });
      continue;
    }

    if (load.nodeId === undefined || (load.type !== "pointForce" && load.type !== "pointMoment")) {
      skippedLoadCount += 1;
      continue;
    }
    const converted: Frame3DNodalLoad = {
      id: load.id,
      nodeId: load.nodeId,
      caseId: load.caseId,
      fx: load.type === "pointForce" ? load.fx ?? 0 : 0,
      fy: 0,
      fz: load.type === "pointForce" ? load.fz ?? 0 : 0,
      mx: 0,
      my: load.type === "pointMoment" ? load.my ?? 0 : 0,
      mz: 0,
    };
    if ([converted.fx, converted.fy, converted.fz, converted.mx, converted.my, converted.mz].some((value) => value !== 0)) {
      loads.push(converted);
    } else {
      skippedLoadCount += 1;
    }
  }

  return { model: { nodes, beams, supports, loads, memberLoads, memberPointLoads, thermalLoads }, skippedLoadCount, skippedSupportCount };
}

import { buildIrregularMixed3DModel, SMALL_IRREGULAR_DIMENSIONS,
  type IrregularDimensions } from "../volume3d/irregularMixed3dModel";
import { parseFrame3DModel, type Frame3DModel, type Frame3DSupport } from "./frame3dModel";

/** A reproducible mixed solid/frame example for the ordinary 3D editor. */
export const LARGE_FRAME3D_VOLUME_DIMENSIONS: IrregularDimensions = { nx: 12, ny: 8, nz: 8 };

/** Parse the saved four-family verification project (text of the .ifcfem2d file). */
export function parseFrame3DFourFamilyExample(projectText: string): Frame3DModel {
  const project = JSON.parse(projectText) as { model3d?: unknown };
  if (!project.model3d) throw new Error("Vier-families-proefmodel mist model3d.");
  return parseFrame3DModel(project.model3d);
}

export function buildFrame3DVolumeExample(
  dimensions: IrregularDimensions = SMALL_IRREGULAR_DIMENSIONS,
): Frame3DModel {
  const native = buildIrregularMixed3DModel(dimensions);
  const nodeId = (index: number) => index + 1;
  const hexes = native.hexes ?? [];
  const tets = native.mesh.tets;
  const supports: Frame3DSupport[] = [];
  native.prescribedM.forEach((prescribed, index) => {
    const rotations = native.prescribedRotationsRad?.[index] ?? [null, null, null];
    if (prescribed.every((value) => value === null) && rotations.every((value) => value === null)) return;
    supports.push({
      nodeId: nodeId(index),
      ux: prescribed[0] !== null, uy: prescribed[1] !== null, uz: prescribed[2] !== null,
      rx: rotations[0] !== null, ry: rotations[1] !== null, rz: rotations[2] !== null,
    });
  });
  const loads = native.loadsKn.flatMap(([fx, fy, fz], index) => {
    const [mx, my, mz] = native.momentsKnm?.[index] ?? [0, 0, 0];
    return fx || fy || fz || mx || my || mz
      ? [{ id: index + 1, nodeId: nodeId(index), caseId: 1, fx, fy, fz, mx, my, mz }]
      : [];
  });
  const frame = native.frames?.[0];
  return parseFrame3DModel({
    nodes: native.mesh.nodes.map(([x, y, z], index) => ({ id: nodeId(index), x, y, z })),
    beams: frame ? [{ id: 1, startNodeId: nodeId(frame.nodes[0]), endNodeId: nodeId(frame.nodes[1]),
      profileName: "200x100", material: "VRIJ:Teststaal E=210000 rho=7850 f=235" }] : [],
    volumes: [
      ...hexes.map((hex, index) => ({ id: index + 1, kind: "hex8" as const,
        nodeIds: hex.nodes.map(nodeId), eMpa: hex.eMpa, poisson: hex.poisson,
        densityKgPerM3: 2500 })),
      ...tets.map((tet, index) => ({ id: hexes.length + index + 1, kind: "tet4" as const,
        nodeIds: tet.map(nodeId), eMpa: native.tetMaterials?.[index]?.eMpa ?? native.solidMaterial.eMpa,
        poisson: native.tetMaterials?.[index]?.poisson ?? native.solidMaterial.poisson,
        densityKgPerM3: 2500 })),
    ],
    supports,
    loads,
    volumeBackend: "matrixFreePcg",
    volumeThreads: 4,
  });
}

/** A surface membrane cap tied to the upper Hex8 nodes, plus the existing solids and frame. */
export function buildFrame3DVolumeMembraneExample(
  dimensions: IrregularDimensions = LARGE_FRAME3D_VOLUME_DIMENSIONS,
): Frame3DModel {
  const base = buildFrame3DVolumeExample(dimensions);
  const nodes = new Map(base.nodes.map((node) => [node.id, node]));
  const upperHexes = (base.volumes ?? []).filter((volume) => volume.kind === "hex8"
    && volume.nodeIds.slice(4).every((id) => (nodes.get(id)?.z ?? -Infinity) > 1 - 0.5 / dimensions.nz));
  const plates = upperHexes.flatMap((hex, index) => {
    const [a, b, c, d] = hex.nodeIds.slice(4);
    return [[a, b, c], [a, c, d]].map((nodeIds, part) => ({
      id: 2 * index + part + 1, nodeIds, thicknessM: 0.08,
      material: "C30/37", membraneOnly: true as const,
      membraneEMpa: 30_000, membranePoisson: 0.2,
    }));
  });
  if (plates.length === 0) throw new Error("Geen bovenvlakken voor het 3D-membraanproefmodel.");
  return parseFrame3DModel({ ...base, plates,
    surfaceLoads: plates.map((plate) => ({ id: plate.id, plateId: plate.id,
      caseId: 2, qx: 20, qy: 0, qz: 0 })) });
}

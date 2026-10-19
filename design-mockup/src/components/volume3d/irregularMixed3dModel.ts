import type { NativeMixed3DInput } from "../../lib/nativeFemClient";

/** Browser counterpart of mixed3d_irregular_large_release_acceptance.rs (v1). */
export type IrregularDimensions = { nx: number; ny: number; nz: number };
export const LARGE_IRREGULAR_DIMENSIONS: IrregularDimensions = { nx: 32, ny: 24, nz: 24 };
export const MASSIVE_IRREGULAR_DIMENSIONS: IrregularDimensions = { nx: 64, ny: 48, nz: 28 };
export const MEDIUM_IRREGULAR_DIMENSIONS: IrregularDimensions = { nx: 12, ny: 8, nz: 8 };
export const SMALL_IRREGULAR_DIMENSIONS: IrregularDimensions = { nx: 8, ny: 6, nz: 6 };

export function irregularCellRemoved({ nx, ny, nz }: IrregularDimensions, i: number, j: number, k: number): boolean {
  const lCut = i >= Math.floor(3 * nx / 4) && j >= Math.floor(2 * ny / 3);
  const innerVoid = i >= Math.floor(nx / 8) && i < Math.floor(nx / 4)
    && j >= Math.floor(ny / 3) && j < Math.floor(ny / 2)
    && k >= Math.floor(nz / 3) && k < Math.floor(nz / 2);
  return lCut || innerVoid;
}

/** The same small nonaffine grid warp as the Rust acceptance generator. */
export function irregularGridPoint({ nx, ny, nz }: IrregularDimensions, i: number, j: number, k: number): [number, number, number] {
  const x = i / nx, y = j / ny, z = k / nz;
  return [
    x + 0.002 * x * Math.sin(0.37 * j) * Math.sin(0.23 * k),
    y + 0.002 * Math.sin(0.30 * i) * Math.sin(0.21 * k),
    z + 0.002 * Math.sin(0.25 * i) * Math.sin(0.27 * j),
  ];
}

export function buildIrregularMixed3DModel(dims: IrregularDimensions): NativeMixed3DInput {
  const { nx, ny, nz } = dims;
  if (nx < 8 || ny < 6 || nz < 6 || nx % 2 !== 0 || ![nx, ny, nz].every(Number.isInteger)) {
    throw new Error("Ongeldige afmetingen voor het onregelmatige 3D-proefmodel.");
  }
  const id = (i: number, j: number, k: number) => i + (nx + 1) * (j + (ny + 1) * k);
  const split = nx / 2;
  const nodes: Array<[number, number, number]> = [];
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    nodes.push(irregularGridPoint(dims, i, j, k));
  }
  const hexes: NonNullable<NativeMixed3DInput["hexes"]> = [];
  const tets: NativeMixed3DInput["mesh"]["tets"] = [];
  const tetMaterials: NonNullable<NativeMixed3DInput["tetMaterials"]> = [];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (irregularCellRemoved(dims, i, j, k)) continue;
    const a = id(i, j, k), b = id(i + 1, j, k), c = id(i, j + 1, k), d = id(i + 1, j + 1, k);
    const e = id(i, j, k + 1), f = id(i + 1, j, k + 1), g = id(i, j + 1, k + 1), h = id(i + 1, j + 1, k + 1);
    if (i < split) {
      hexes.push({ nodes: [a, b, d, c, e, f, h, g], eMpa: j < ny / 2 ? 8_000 : 11_000, poisson: 0.23 });
    } else {
      tets.push([a, b, d, h], [a, d, c, h], [a, c, g, h], [a, g, e, h], [a, e, f, h], [a, f, b, h]);
      for (let n = 0; n < 6; n++) tetMaterials.push({ eMpa: k < nz / 2 ? 12_000 : 15_000, poisson: 0.21 });
    }
  }
  const trussOld: [number, number] = [id(split - 1, Math.floor(ny / 4), Math.floor(nz / 4)),
    id(split + 2, Math.floor(ny / 4) + 2, Math.floor(nz / 4) + 1)];
  const baseOld = id(nx - 2, Math.floor(ny / 4), nz / 2);
  const tipOld = nodes.length;
  const [baseX, baseY, baseZ] = nodes[baseOld];
  nodes.push([baseX + 0.15, baseY, baseZ]);

  // The Rust gate uses this same deterministic used-node compaction.
  const used = new Uint8Array(nodes.length);
  for (const tet of tets) for (const node of tet) used[node] = 1;
  for (const hex of hexes) for (const node of hex.nodes) used[node] = 1;
  for (const node of [...trussOld, baseOld, tipOld]) used[node] = 1;
  const remap = new Int32Array(nodes.length).fill(-1);
  const compactNodes: typeof nodes = [];
  for (let old = 0; old < nodes.length; old++) if (used[old]) {
    remap[old] = compactNodes.length;
    compactNodes.push(nodes[old]);
  }
  const mappedTets = tets.map((tet) => tet.map((node) => remap[node]) as typeof tet);
  const mappedHexes = hexes.map((hex) => ({ ...hex, nodes: hex.nodes.map((node) => remap[node]) as typeof hex.nodes }));
  const loadsKn: NativeMixed3DInput["loadsKn"] = compactNodes.map(() => [0, 0, 0]);
  for (const j of [Math.floor(ny / 8), Math.floor(ny / 4), Math.floor(ny / 2)]) {
    for (const k of [Math.floor(nz / 6), nz / 2, Math.floor(5 * nz / 6)]) {
      const node = remap[id(nx, j, k)];
      if (node < 0) throw new Error("Lastknoop ontbreekt in het proefmodel.");
      loadsKn[node][0] += 0.4;
      loadsKn[node][1] += 0.05;
      loadsKn[node][2] -= 0.3;
    }
  }
  loadsKn[remap[tipOld]] = [0.75, -0.8, 3.0];
  const momentsKnm: NonNullable<NativeMixed3DInput["momentsKnm"]> = compactNodes.map(() => [0, 0, 0]);
  momentsKnm[remap[tipOld]] = [0.1, 0.25, -0.15];
  const prescribedM: NativeMixed3DInput["prescribedM"] = compactNodes.map(([x]) =>
    Math.abs(x) < 1e-14 ? [0, 0, 0] : [null, null, null]);
  const prescribedRotationsRad: NonNullable<NativeMixed3DInput["prescribedRotationsRad"]> =
    compactNodes.map(() => [null, null, null]);
  prescribedRotationsRad[remap[baseOld]] = [0, 0, 0];
  return {
    mesh: { nodes: compactNodes, tets: mappedTets },
    solidMaterial: { eMpa: 12_000, poisson: 0.21 },
    tetMaterials,
    hexes: mappedHexes,
    trusses: [{ nodes: [remap[trussOld[0]], remap[trussOld[1]]], eMpa: 210_000, areaM2: 0.0004 }],
    frames: [{ nodes: [remap[baseOld], remap[tipOld]], eMpa: 210_000, poisson: 0.3,
      areaM2: 0.003, iyM4: 0.00002, izM4: 0.00003, torsionJM4: 0.00005, rollAngleRad: 0 }],
    loadsKn, momentsKnm, prescribedM, prescribedRotationsRad,
    backend: "matrixFreePcg", maxFrontDofs: 128, threads: 4, maxPcgIterations: 15_000,
  };
}

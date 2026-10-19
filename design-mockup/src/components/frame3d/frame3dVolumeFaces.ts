/** Outward cyclic local-node order, shared by rendering and native face loads. */
export const TET_FACES = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]] as const;
export const HEX_FACES = [
  [0, 3, 2, 1], [4, 5, 6, 7],
  [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
] as const;

export function frame3DVolumeFaces(kind: "tet4" | "hex8"): readonly (readonly number[])[] {
  return kind === "tet4" ? TET_FACES : HEX_FACES;
}

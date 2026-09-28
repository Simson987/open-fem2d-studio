import type { Frame3DModel } from "./frame3dModel";

export interface Frame3DGridLayout {
  sizeM: number;
  divisions: number;
  visibleSpacingM: number;
  centerX: number;
  centerY: number;
}

/** Houd het tekenraster rond het model, met hoogstens 200 vakken per richting. */
export function frame3DGridLayout(
  nodes: Frame3DModel["nodes"],
  snapSpacingM: number,
): Frame3DGridLayout {
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  if (nodes.length > 0) {
    minX = maxX = nodes[0]!.x;
    minY = maxY = nodes[0]!.y;
    for (let index = 1; index < nodes.length; index += 1) {
      const node = nodes[index]!;
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y);
      maxY = Math.max(maxY, node.y);
    }
  }
  const spacing = Math.max(0.001, snapSpacingM);
  const desiredSize = Math.max(20, 1.6 * Math.max(maxX - minX, maxY - minY));
  const visibleSpacingM = Math.ceil(desiredSize / (200 * spacing)) * spacing;
  const divisions = Math.max(2, 2 * Math.ceil(desiredSize / visibleSpacingM / 2));
  return {
    sizeM: divisions * visibleSpacingM,
    divisions,
    visibleSpacingM,
    centerX: Math.round((minX + maxX) / (2 * visibleSpacingM)) * visibleSpacingM,
    centerY: Math.round((minY + maxY) / (2 * visibleSpacingM)) * visibleSpacingM,
  };
}

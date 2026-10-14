/**
 * Lastvlakken in het 3D-tekenvlak: de meetkunde van het licht doorzichtige,
 * gevulde vlak van een belastingvlak en van een oppervlaktelast op een plaat.
 *
 * Bewust zonder Three-objecten of DOM: alleen getallen (driehoeken, omtrek,
 * oppervlak), zodat de tests in Node kunnen nagaan dat het getekende vlak
 * precies het belaste vlak is. Het tekenvlak maakt er meshes van.
 */
import * as THREE from "three";
import type { OpenFem3DLoadPanel, OpenFem3DModel, OpenFem3DNode, OpenFem3DPlate, OpenFem3DSurfaceLoad } from "./openFem3dModel";
import { openFem3DLoadPanelGeometry } from "./openFem3dLoadPanels";
import { openFem3DPlateShape } from "./openFem3dPlateGeometry";
import {
  DEFAULT_OPEN_FEM_3D_PLATE_DISPLAY, openFem3DPlateDrawnHalfThickness, type OpenFem3DPlateDisplay,
} from "./openFem3dPlateDisplay";

/**
 * Kleur per soort belastinggeval, gelijk aan de typelabels van de tabbalk
 * (LoadCaseTabBar.css: G grijs, Q blauw, S cyaan, W groen, overig oranje).
 * Het 3D-tekenvlak heeft in licht én donker thema een witte achtergrond, dus
 * dezelfde kleuren blijven daar leesbaar.
 */
export const OPEN_FEM_3D_LOAD_CASE_COLORS = {
  dead: 0x6b7280,
  live: 0x2563eb,
  snow: 0x06b6d4,
  wind: 0x10b981,
  other: 0xf59e0b,
} as const;

export function openFem3DLoadCaseColor(type: string | undefined): number {
  return OPEN_FEM_3D_LOAD_CASE_COLORS[type as keyof typeof OPEN_FEM_3D_LOAD_CASE_COLORS]
    ?? OPEN_FEM_3D_LOAD_CASE_COLORS.other;
}

/**
 * Hoe diep achter een lastvlak iets nog "in of onder het vlak" ligt: een
 * staaf in het vlak of de plaat onder een oppervlaktelast. Minstens 0,5 m,
 * bij grote modellen 2 % van de modelgrootte.
 */
export function openFem3DPickThroughDepth(modelSizeM: number): number {
  return Math.max(0.5, 0.02 * (Number.isFinite(modelSizeM) ? modelSizeM : 0));
}

/**
 * De treffers van een klik die meetellen naast een licht doorzichtig
 * lastvlak (`userData.pickThrough`: de vulling en de pijlen van een
 * belastingvlak, de vulling van een oppervlaktelast). Die tellen zelf niet
 * mee, en ook niet wat er ver achter het vlak ligt (een kolom aan de
 * overkant, een vloer een verdieping lager): alleen wat vóór het vlak of
 * hoogstens `depth` erachter ligt. Het venster begint bij de vulling
 * (`openFem3dLoadSurface`), niet bij een lastpijl die boven het vlak uitsteekt;
 * raakt de klik alleen een pijl, dan bij die pijl. Blijft er niets over, dan
 * klikt de gebruiker bewust op het vlak en selecteert het tekenvlak dat.
 */
export function openFem3DSolidIntersections<T extends { distance: number; object: { userData: Record<string, unknown> } }>(
  intersections: readonly T[], depth: number,
): T[] {
  const through = (candidate: T) => candidate.object.userData.pickThrough === true;
  const reference = intersections.find((candidate) => through(candidate) && candidate.object.userData.openFem3dLoadSurface === true)
    ?? intersections.find(through);
  return intersections.filter((candidate) => !through(candidate)
    && (!reference || candidate.distance <= reference.distance + depth));
}

/** Doorzichtigheid van de vulling: licht, maar zichtbaar op de witte 3D-achtergrond. */
export const OPEN_FEM_3D_LOAD_SURFACE_OPACITY = 0.2;
/** Iets sterker zodra het vlak geselecteerd is. */
export const OPEN_FEM_3D_LOAD_SURFACE_SELECTED_OPACITY = 0.36;

type Vec3 = [number, number, number];

export interface OpenFem3DLoadSurface {
  /** Driehoeken in wereldcoördinaten (m): negen getallen per driehoek. */
  positions: number[];
  /** Gesloten omtrekken (buitenrand en eventuele openingen) in wereldcoördinaten. */
  outlines: Vec3[][];
  /** Oppervlak van de vulling (m²); gelijk aan het belaste vlak. */
  areaM2: number;
  normal: Vec3;
  /** Punt op het vlak voor een label. */
  anchor: Vec3;
}

function triangleArea(positions: readonly number[], index: number): number {
  const ax = positions[index], ay = positions[index + 1], az = positions[index + 2];
  const ux = positions[index + 3] - ax, uy = positions[index + 4] - ay, uz = positions[index + 5] - az;
  const vx = positions[index + 6] - ax, vy = positions[index + 7] - ay, vz = positions[index + 8] - az;
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

function totalArea(positions: readonly number[]): number {
  let area = 0;
  for (let index = 0; index + 8 < positions.length; index += 9) area += triangleArea(positions, index);
  return area;
}

/** Het gevulde vlak van een belastingvlak: precies de veelhoek over de hoekknopen. */
export function openFem3DLoadPanelSurface(
  model: Pick<OpenFem3DModel, "nodes">,
  panel: OpenFem3DLoadPanel,
  nodeById?: ReadonlyMap<number, OpenFem3DNode>,
): OpenFem3DLoadSurface | null {
  let geometry: ReturnType<typeof openFem3DLoadPanelGeometry>;
  try {
    geometry = openFem3DLoadPanelGeometry(model, panel, nodeById);
  } catch {
    return null;
  }
  const to3D = (p: readonly [number, number]): Vec3 => [
    geometry.origin[0] + geometry.axisU[0] * p[0] + geometry.axisV[0] * p[1],
    geometry.origin[1] + geometry.axisU[1] * p[0] + geometry.axisV[1] * p[1],
    geometry.origin[2] + geometry.axisU[2] * p[0] + geometry.axisV[2] * p[1],
  ];
  const contour = geometry.polygon.map((p) => new THREE.Vector2(p[0], p[1]));
  const holes = geometry.holePolygons.map((loop) => loop.map((p) => new THREE.Vector2(p[0], p[1])));
  const points = [geometry.polygon, ...geometry.holePolygons].flat();
  const positions: number[] = [];
  for (const triangle of THREE.ShapeUtils.triangulateShape(contour, holes)) {
    for (const index of triangle) positions.push(...to3D(points[index]));
  }
  return {
    positions,
    outlines: [geometry.polygon, ...geometry.holePolygons].map((loop) => loop.map(to3D)),
    areaM2: totalArea(positions),
    normal: geometry.normal,
    anchor: geometry.centroid,
  };
}

/**
 * Afstand van het vlak van een oppervlaktelast tot de getekende plaatzijde:
 * 5 % van de dikte, minstens 5 mm. Genoeg om niet samen te vallen met het
 * plaatvlak (geen flikkering), klein genoeg om er zichtbaar bij te horen.
 */
export function openFem3DSurfaceLoadMarginM(thicknessM: number): number {
  return Math.max(0.005, thicknessM * 0.05);
}

/**
 * Het gevulde vlak van een oppervlaktelast op een plaat: de plaatomtrek met
 * bogen, afronding en openingen, net buiten de getekende plaat aan de kant
 * waar de last op aangrijpt (daar begint ook de lastpijl). Zo valt het vlak
 * niet samen met de plaatzijde en flikkert het niet.
 *
 * "Net buiten" volgt de plaatweergave (issue #78): in Volume buiten de boven-
 * of onderzijde (halve dikte plus marge), in Vlak en Mesh, waar de plaat
 * alleen als middenvlak getekend wordt, alleen de marge boven of onder het
 * middenvlak. Zonder keuze: Volume.
 */
export function openFem3DSurfaceLoadSurface(
  model: OpenFem3DModel,
  plate: OpenFem3DPlate,
  load: Pick<OpenFem3DSurfaceLoad, "qx" | "qy" | "qz">,
  nodeIndex?: ReadonlyMap<number, OpenFem3DNode>,
  display: OpenFem3DPlateDisplay = DEFAULT_OPEN_FEM_3D_PLATE_DISPLAY,
): OpenFem3DLoadSurface | null {
  const outline = openFem3DPlateShape(model, plate, nodeIndex);
  if (!outline) return null;
  const { shape, position, u, v, normal } = outline;
  const along = load.qx * normal.x + load.qy * normal.y + load.qz * normal.z;
  const side = along > 0 ? -1 : 1;
  const offset = side * (openFem3DPlateDrawnHalfThickness(plate.thicknessM, display)
    + openFem3DSurfaceLoadMarginM(plate.thicknessM));
  const lift = normal.clone().multiplyScalar(offset);
  const to3D = (p: THREE.Vector2): Vec3 => {
    const point = position.clone().addScaledVector(u, p.x).addScaledVector(v, p.y).add(lift);
    return [point.x, point.y, point.z];
  };
  const flat = new THREE.ShapeGeometry(shape, 10);
  const local = flat.getAttribute("position");
  const index = flat.getIndex();
  const positions: number[] = [];
  const vertexCount = index ? index.count : local.count;
  for (let k = 0; k < vertexCount; k += 1) {
    const vertex = index ? index.getX(k) : k;
    positions.push(...to3D(new THREE.Vector2(local.getX(vertex), local.getY(vertex))));
  }
  flat.dispose();
  const outlines = [shape.getPoints(10), ...shape.holes.map((hole) => hole.getPoints(10))]
    .map((points) => points.map(to3D));
  let anchor: Vec3 = to3D(new THREE.Vector2(0, 0));
  let largest = 0;
  for (let k = 0; k + 8 < positions.length; k += 9) {
    const area = triangleArea(positions, k);
    if (area > largest) {
      largest = area;
      anchor = [
        (positions[k] + positions[k + 3] + positions[k + 6]) / 3,
        (positions[k + 1] + positions[k + 4] + positions[k + 7]) / 3,
        (positions[k + 2] + positions[k + 5] + positions[k + 8]) / 3,
      ];
    }
  }
  return {
    positions,
    outlines,
    areaM2: totalArea(positions),
    normal: [normal.x * side, normal.y * side, normal.z * side],
    anchor,
  };
}

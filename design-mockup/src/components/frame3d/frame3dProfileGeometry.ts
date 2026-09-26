import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import {
  buitenmaten,
  shapePath,
  shapeVanProfiel,
} from "../shared/profielVorm";

export interface Frame3DProfileSection {
  shapes: THREE.Shape[];
  /** Zwaartepunt in millimeters; de cataloguscontour blijft tot de extrusie in mm. */
  centroid: THREE.Vector2;
  widthM: number;
  heightM: number;
}

/**
 * Instanced profielgeometrie is één meter lang op de lokale z-as. Alleen die
 * as mag met de staaflengte schalen; x en y zijn de echte catalogusdoorsnede.
 */
export function frame3DProfileInstanceScale(lengthM: number): THREE.Vector3 {
  return new THREE.Vector3(1, 1, lengthM);
}

const sectionCache = new Map<string, Frame3DProfileSection | null>();
const svgLoader = new SVGLoader();

/** Oppervlaktezwaartepunt van de werkelijk getrianguleerde contour, inclusief gaten. */
function sectionCentroid(shapes: readonly THREE.Shape[]): THREE.Vector2 {
  let areaTotal = 0;
  const weighted = new THREE.Vector2();
  for (const shape of shapes) {
    const points = shape.extractPoints(16);
    const vertices = [...points.shape, ...points.holes.flat()];
    for (const [ia, ib, ic] of THREE.ShapeUtils.triangulateShape(points.shape, points.holes)) {
      const a = vertices[ia], b = vertices[ib], c = vertices[ic];
      const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
      if (!(area > 0)) continue;
      weighted.x += area * (a.x + b.x + c.x) / 3;
      weighted.y += area * (a.y + b.y + c.y) / 3;
      areaTotal += area;
    }
  }
  return areaTotal > 0 ? weighted.multiplyScalar(1 / areaTotal) : new THREE.Vector2();
}

/**
 * De gekozen catalogus-, beton- of rechthoekdoorsnede als echte 2D-contour.
 * De afmetingen en afrondingen komen uit dezelfde bron als de doorsnedetekening
 * en de rekenkern. De contour blijft in millimeters om alle catalogusmaten te
 * behouden; de voltooide geometrie wordt daarna één keer naar meters geschaald.
 */
export function frame3DProfileSection(profileName: string | undefined): Frame3DProfileSection | null {
  const name = profileName?.trim();
  if (!name) return null;
  if (sectionCache.has(name)) return sectionCache.get(name) ?? null;
  const sectionShape = shapeVanProfiel(name);
  if (!sectionShape) {
    sectionCache.set(name, null);
    return null;
  }
  const size = buitenmaten(sectionShape);
  // `shapePath` schrijft twee decimalen. Houd de contour daarom eerst in mm.
  // Met schaal 0,001 zou bijvoorbeeld 6,2 mm naar stappen van 10 mm afronden.
  const path = shapePath(sectionShape, 1, -size.b / 2, -size.h / 2);
  const fillRule = path.fillRule ?? "nonzero";
  const document = svgLoader.parse(
    `<svg xmlns="http://www.w3.org/2000/svg"><path d="${path.d}" fill="#000" fill-rule="${fillRule}"/></svg>`,
  );
  const shapes = document.paths.flatMap((item) => SVGLoader.createShapes(item));
  if (shapes.length === 0) {
    sectionCache.set(name, null);
    return null;
  }
  const section = {
    shapes,
    centroid: sectionCentroid(shapes),
    widthM: size.b / 1000,
    heightM: size.h / 1000,
  };
  sectionCache.set(name, section);
  return section;
}

/** Maak een prismatische extrusie, gecentreerd om zwaartepunt en staafmidden. */
export function createFrame3DProfileGeometry(
  profileName: string | undefined,
  lengthM: number,
): THREE.ExtrudeGeometry | null {
  const section = frame3DProfileSection(profileName);
  if (!section || !(lengthM > 0)) return null;
  const lengthMm = lengthM * 1000;
  const geometry = new THREE.ExtrudeGeometry(section.shapes, {
    depth: lengthMm,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 8,
  });
  geometry.translate(-section.centroid.x, -section.centroid.y, -lengthMm / 2);
  geometry.scale(0.001, 0.001, 0.001);
  geometry.computeVertexNormals();
  return geometry;
}

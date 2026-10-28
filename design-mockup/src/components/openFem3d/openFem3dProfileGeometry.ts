import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import {
  buitenmaten,
  shapePath,
  shapeVanProfiel,
} from "../shared/profielVorm";
import type { VerlopendeDoorsnede, VerloopMaten } from "../../lib/sectionResolver";
import { openFem3DBeamVerloop, type OpenFem3DVerloopStaaf } from "./openFem3dVerloop";

export interface OpenFem3DProfileSection {
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
export function openFem3DProfileInstanceScale(lengthM: number): THREE.Vector3 {
  return new THREE.Vector3(1, 1, lengthM);
}

const sectionCache = new Map<string, OpenFem3DProfileSection | null>();
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
export function openFem3DProfileSection(profileName: string | undefined): OpenFem3DProfileSection | null {
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
export function createOpenFem3DProfileGeometry(
  profileName: string | undefined,
  lengthM: number,
): THREE.ExtrudeGeometry | null {
  const section = openFem3DProfileSection(profileName);
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

// ── Verlopende staaf (issue #73) ─────────────────────────────────────────────

/** Catalogusnamen als `IPE 200` en `IPE200` delen dezelfde GPU-batch. */
export function openFem3DProfileBatchName(profileName: string): string {
  return profileName.trim().toUpperCase().replace(/\s+(?=\d)/g, "");
}

/** Het geldige verloop van een staaf, of `null` (prismatisch of een verloop dat niet klopt). */
function geldigVerloop(beam: OpenFem3DVerloopStaaf): VerlopendeDoorsnede | null {
  if ((beam.profileNameEnd?.trim() ?? "") === "") return null;
  const uitkomst = openFem3DBeamVerloop(beam);
  return uitkomst.status === "verlopend" ? uitkomst.verloop : null;
}

/**
 * De sleutel van de getekende geometrie van een staaf: het profiel, en bij een
 * verlopende staaf begin → eind. Een eindprofiel dat geen verloop is (hetzelfde
 * profiel, of een verloop dat niet klopt) tekent als het beginprofiel en deelt
 * dus diens sleutel. `null` zonder profiel.
 */
export function openFem3DBeamProfileKey(beam: OpenFem3DVerloopStaaf): string | null {
  const begin = beam.profileName?.trim();
  if (!begin) return null;
  return geldigVerloop(beam)
    ? `${openFem3DProfileBatchName(begin)}→${openFem3DProfileBatchName(beam.profileNameEnd!)}`
    : openFem3DProfileBatchName(begin);
}

/**
 * De contour van een doorsnede van het verloop in mm, tegen de klok in, om het
 * zwaartepunt (beide vormen zijn dubbelsymmetrisch): x langs b (lokaal y), y
 * langs h (lokaal z). Een gelast I-profiel zonder afrondingsstraal — precies
 * de vorm waarmee de kern en de toetsing het verloop rekenen — of een
 * rechthoek. Elk punt is lineair in de maten, dus de doorsnede van het volume
 * tussen twee ringen is op elke plaats exact de doorsnede van het verloop.
 */
export function openFem3DVerloopContour(soort: VerlopendeDoorsnede["soort"], m: VerloopMaten): THREE.Vector2[] {
  const b = m.b / 2, h = m.h / 2;
  if (soort === "rechthoek") {
    return [new THREE.Vector2(-b, -h), new THREE.Vector2(b, -h), new THREE.Vector2(b, h), new THREE.Vector2(-b, h)];
  }
  const tw = (m.tw ?? 0) / 2, tf = m.tf ?? 0;
  return [
    [-b, -h], [b, -h], [b, -h + tf], [tw, -h + tf], [tw, h - tf], [b, h - tf],
    [b, h], [-b, h], [-b, h - tf], [-tw, h - tf], [-tw, -h + tf], [-b, -h + tf],
  ].map(([x, y]) => new THREE.Vector2(x, y));
}

/**
 * Het volume van een verlopende staaf: twee ringen (begin op z = −L/2, eind op
 * z = +L/2, zoals de prismatische extrusie om het staafmidden) met rechte
 * zijvlakken ertussen en een dichte kop aan beide einden. Lineair en exact
 * (zie {@link openFem3DVerloopContour}); in meters.
 */
export function createOpenFem3DTaperedGeometry(verloop: VerlopendeDoorsnede, lengthM: number): THREE.BufferGeometry {
  const begin = openFem3DVerloopContour(verloop.soort, verloop.begin);
  const eind = openFem3DVerloopContour(verloop.soort, verloop.eind);
  const z0 = -lengthM / 2, z1 = lengthM / 2;
  const posities: number[] = [];
  const punt = (p: THREE.Vector2, z: number) => posities.push(p.x / 1000, p.y / 1000, z);
  // Zijvlakken: per rand van de ring twee driehoeken, naar buiten gericht.
  for (let i = 0; i < begin.length; i++) {
    const j = (i + 1) % begin.length;
    punt(begin[i], z0); punt(begin[j], z0); punt(eind[j], z1);
    punt(begin[i], z0); punt(eind[j], z1); punt(eind[i], z1);
  }
  // Koppen: de contour getrianguleerd; begin kijkt naar −z, eind naar +z.
  for (const [ring, z, richting] of [[begin, z0, -1], [eind, z1, 1]] as const) {
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(ring, [])) {
      const [pa, pb, pc] = [ring[a], ring[b], ring[c]];
      const nz = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
      if (nz * richting >= 0) { punt(pa, z); punt(pb, z); punt(pc, z); } else { punt(pa, z); punt(pc, z); punt(pb, z); }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(posities, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * De getekende geometrie van een staaf: bij een verlopende staaf het volume met
 * twee ringen, anders de prismatische extrusie van het profiel. `null` zonder
 * bekende doorsnede.
 */
export function createOpenFem3DBeamProfileGeometry(
  beam: OpenFem3DVerloopStaaf, lengthM: number,
): THREE.BufferGeometry | null {
  if (!(lengthM > 0)) return null;
  const verloop = geldigVerloop(beam);
  return verloop ? createOpenFem3DTaperedGeometry(verloop, lengthM) : createOpenFem3DProfileGeometry(beam.profileName, lengthM);
}

/**
 * De omhullende maten van de getekende doorsnede van een staaf (voor
 * begrenzing, kiezen en scharnierbolletjes): bij een verlopende staaf de
 * grootste van begin en eind, om het zwaartepunt; anders de profieldoorsnede.
 */
export function openFem3DBeamProfileExtent(
  beam: OpenFem3DVerloopStaaf,
): Pick<OpenFem3DProfileSection, "centroid" | "widthM" | "heightM"> | null {
  const verloop = geldigVerloop(beam);
  if (!verloop) return openFem3DProfileSection(beam.profileName);
  return {
    centroid: new THREE.Vector2(),
    widthM: Math.max(verloop.begin.b, verloop.eind.b) / 1000,
    heightM: Math.max(verloop.begin.h, verloop.eind.h) / 1000,
  };
}

const verloopSecties = new Map<string, OpenFem3DProfileSection>();

/** Een doorsnede van het verloop als profieldoorsnede (contour om het zwaartepunt, in mm). */
function verloopSectie(soort: VerlopendeDoorsnede["soort"], m: VerloopMaten): OpenFem3DProfileSection {
  const sleutel = `${soort}:${m.b}:${m.h}:${m.tw ?? ""}:${m.tf ?? ""}`;
  let sectie = verloopSecties.get(sleutel);
  if (!sectie) {
    sectie = {
      shapes: [new THREE.Shape(openFem3DVerloopContour(soort, m))],
      centroid: new THREE.Vector2(),
      widthM: m.b / 1000,
      heightM: m.h / 1000,
    };
    verloopSecties.set(sleutel, sectie);
  }
  return sectie;
}

/**
 * De doorsneden voor de vervormde vorm in de profielweergave: bij een
 * verlopende staaf begin en eind (de gelaste contour, dezelfde als het volume
 * met twee ringen), anders de profieldoorsnede; `null` zonder bekende doorsnede.
 */
export function openFem3DBeamSweepSections(
  beam: OpenFem3DVerloopStaaf,
): { section: OpenFem3DProfileSection; sectionEnd?: OpenFem3DProfileSection } | null {
  const verloop = geldigVerloop(beam);
  if (verloop) {
    return { section: verloopSectie(verloop.soort, verloop.begin), sectionEnd: verloopSectie(verloop.soort, verloop.eind) };
  }
  const section = openFem3DProfileSection(beam.profileName);
  return section ? { section } : null;
}

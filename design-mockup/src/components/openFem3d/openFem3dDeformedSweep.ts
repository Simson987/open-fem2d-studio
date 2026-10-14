import * as THREE from "three";
import type { OpenFem3DProfileSection } from "./openFem3dProfileGeometry";

/**
 * De vervormde staaf als één doorlopend profiel.
 *
 * Voorheen stond op elk stuk tussen twee verplaatsingsstations een los recht
 * profiel met eigen kopvlakken: in het halfdoorzichtige rood gaf dat bij
 * iedere naad een dwarsstreep, en in een bocht overlapten of kierden de
 * stukken. Hier wordt de doorsnede langs alle stations geveegd:
 *
 *  - per station een ring met dezelfde contourpunten, en de zijwanden tussen
 *    opeenvolgende ringen delen hun hoekpunten; de normalen volgen de kromme,
 *    dus geen naad en geen dwarslijn;
 *  - scherpe hoeken van de doorsnede (flensranden) houden een eigen normaal,
 *    ronde delen (buizen, afrondingen) een gladde;
 *  - alleen aan de twee staafeinden een kopvlak.
 *
 * De oriëntatie volgt de onvervormde staaf: contour-x ligt langs de lokale y
 * (`referenceY`, loodrecht op de raaklijn geprojecteerd), contour-y langs
 * z = raaklijn × y — dezelfde afspraak als de rechte profielextrusie.
 */
export interface OpenFem3DSweepInput {
  section: OpenFem3DProfileSection;
  /**
   * Verlopende staaf (#73): de doorsnede aan het eind. De ringen verlopen dan
   * lineair van `section` (eerste station) naar deze (laatste station); beide
   * contouren moeten punt voor punt bij elkaar horen (dezelfde opbouw), anders
   * telt alleen `section`.
   */
  sectionEnd?: OpenFem3DProfileSection;
  /** Stations langs de vervormde staaf (m), van begin naar eind. */
  points: readonly THREE.Vector3[];
  /** Lokale y-as van de onvervormde staaf. */
  referenceY: THREE.Vector3;
}

interface SweepSlot { x: number; y: number; nx: number; ny: number }
interface SweepContour {
  /** Ringpunten met hun normaal; een scherpe hoek staat er twee keer in. */
  slots: SweepSlot[];
  /** Per wandvlak: begin- en eindslot. */
  walls: [number, number][];
  /** Kopvlak: punten (m) en driehoeken met positieve oriëntatie (tegen de klok in). */
  cap: { points: THREE.Vector2[]; triangles: [number, number, number][] };
}

/** Ronder dan dit (hoek tussen twee randnormalen) geldt als glad. */
const SMOOTH_COS = Math.cos(THREE.MathUtils.degToRad(35));
/**
 * Boogstukken per kromme van de contour: een halve cirkel (zo schrijft de
 * profieltekening een buis) wordt 8 stukken van 22,5°, een afronding 8 van
 * 11,25°. Rond genoeg voor een gladde buis, zonder dat honderden staven
 * onnodig zware geometrie krijgen.
 */
const DEFAULT_CURVE_SEGMENTS = 4;
const contourCache = new WeakMap<OpenFem3DProfileSection, Map<number, SweepContour>>();

function contourOf(section: OpenFem3DProfileSection, curveSegments: number): SweepContour {
  let perSegments = contourCache.get(section);
  if (!perSegments) {
    perSegments = new Map();
    contourCache.set(section, perSegments);
  }
  const cached = perSegments.get(curveSegments);
  if (cached) return cached;
  const slots: SweepSlot[] = [];
  const walls: [number, number][] = [];
  const capPoints: THREE.Vector2[] = [];
  const capTriangles: [number, number, number][] = [];
  const toMeters = (p: THREE.Vector2) =>
    new THREE.Vector2((p.x - section.centroid.x) * 0.001, (p.y - section.centroid.y) * 0.001);
  const clean = (loop: THREE.Vector2[]) => {
    const points = loop.map(toMeters);
    if (points.length > 1 && points[0].distanceTo(points[points.length - 1]) < 1e-9) points.pop();
    return points.filter((point, index) => index === 0 || point.distanceTo(points[index - 1]) > 1e-9);
  };
  const addLoop = (loop: THREE.Vector2[]) => {
    const n = loop.length;
    if (n < 3) return;
    const edgeNormal = (i: number) => {
      const a = loop[i], b = loop[(i + 1) % n];
      return new THREE.Vector2(b.y - a.y, -(b.x - a.x)).normalize();
    };
    const normals = loop.map((_, i) => edgeNormal(i));
    const slotIn: number[] = [];
    const slotOut: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const incoming = normals[(i - 1 + n) % n], outgoing = normals[i];
      if (incoming.dot(outgoing) >= SMOOTH_COS) {
        const average = incoming.clone().add(outgoing).normalize();
        slots.push({ x: loop[i].x, y: loop[i].y, nx: average.x, ny: average.y });
        slotIn[i] = slotOut[i] = slots.length - 1;
      } else {
        slots.push({ x: loop[i].x, y: loop[i].y, nx: incoming.x, ny: incoming.y });
        slotIn[i] = slots.length - 1;
        slots.push({ x: loop[i].x, y: loop[i].y, nx: outgoing.x, ny: outgoing.y });
        slotOut[i] = slots.length - 1;
      }
    }
    for (let i = 0; i < n; i += 1) walls.push([slotOut[i], slotIn[(i + 1) % n]]);
  };
  for (const shape of section.shapes) {
    const extracted = shape.extractPoints(curveSegments);
    // Buitenrand tegen de klok in, gaten met de klok mee: dan wijst de
    // randnormaal (dy, −dx) overal van het materiaal af.
    const outer = clean(extracted.shape);
    if (THREE.ShapeUtils.isClockWise(outer)) outer.reverse();
    const holes = extracted.holes.map(clean).filter((hole) => hole.length >= 3);
    holes.forEach((hole) => { if (!THREE.ShapeUtils.isClockWise(hole)) hole.reverse(); });
    addLoop(outer);
    holes.forEach(addLoop);
    const offset = capPoints.length;
    const vertices = [...outer, ...holes.flat()];
    capPoints.push(...vertices);
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(outer, holes)) {
      const pa = vertices[a], pb = vertices[b], pc = vertices[c];
      const cross = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
      capTriangles.push(cross >= 0 ? [offset + a, offset + b, offset + c] : [offset + a, offset + c, offset + b]);
    }
  }
  const contour = { slots, walls, cap: { points: capPoints, triangles: capTriangles } };
  perSegments.set(curveSegments, contour);
  return contour;
}

/** Raaklijn en assen per station: y = referentie-y loodrecht op de raaklijn, z = raaklijn × y. */
function stationFrames(points: readonly THREE.Vector3[], referenceY: THREE.Vector3) {
  return points.map((_, index) => {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const tangent = next.clone().sub(previous).normalize();
    let y = referenceY.clone().addScaledVector(tangent, -referenceY.dot(tangent));
    if (y.lengthSq() < 1e-12) {
      y = new THREE.Vector3(1, 0, 0).addScaledVector(tangent, -tangent.x);
      if (y.lengthSq() < 1e-12) y = new THREE.Vector3(0, 1, 0).addScaledVector(tangent, -tangent.y);
    }
    y.normalize();
    const z = new THREE.Vector3().crossVectors(tangent, y).normalize();
    return { tangent, y, z };
  });
}

function appendSweep(
  input: OpenFem3DSweepInput,
  curveSegments: number,
  positions: number[],
  normals: number[],
  indices: number[],
) {
  const points = input.points;
  if (points.length < 2 || !(points[points.length - 1].distanceTo(points[0]) > 1e-12)) return;
  const contour = contourOf(input.section, curveSegments);
  if (contour.slots.length === 0) return;
  // Verlopend: een tweede contour met dezelfde opbouw, lineair per station.
  const eindContour = input.sectionEnd ? contourOf(input.sectionEnd, curveSegments) : null;
  const zelfdeOpbouw = eindContour !== null && eindContour.slots.length === contour.slots.length
    && eindContour.cap.points.length === contour.cap.points.length
    && JSON.stringify(eindContour.walls) === JSON.stringify(contour.walls);
  const eind = zelfdeOpbouw ? eindContour : null;
  const frames = stationFrames(points, input.referenceY);
  const slotCount = contour.slots.length;
  const base = positions.length / 3;
  frames.forEach(({ y, z }, station) => {
    const p = points[station];
    const t = station / (points.length - 1);
    contour.slots.forEach((beginSlot, index) => {
      const eindSlot = eind?.slots[index];
      const sx = eindSlot ? beginSlot.x + (eindSlot.x - beginSlot.x) * t : beginSlot.x;
      const sy = eindSlot ? beginSlot.y + (eindSlot.y - beginSlot.y) * t : beginSlot.y;
      positions.push(p.x + y.x * sx + z.x * sy, p.y + y.y * sx + z.y * sy, p.z + y.z * sx + z.z * sy);
      normals.push(y.x * beginSlot.nx + z.x * beginSlot.ny, y.y * beginSlot.nx + z.y * beginSlot.ny, y.z * beginSlot.nx + z.z * beginSlot.ny);
    });
  });
  for (let station = 0; station < points.length - 1; station += 1) {
    const ring = base + station * slotCount, nextRing = ring + slotCount;
    for (const [start, end] of contour.walls) {
      const a = ring + start, b = ring + end, c = nextRing + end, d = nextRing + start;
      indices.push(a, b, c, a, c, d);
    }
  }
  // Alleen aan de staafeinden een kopvlak: begin met −raaklijn, eind met +raaklijn.
  for (const [station, sign] of [[0, -1], [points.length - 1, 1]] as const) {
    const { tangent, y, z } = frames[station];
    const p = points[station];
    const capBase = positions.length / 3;
    for (const q of (sign > 0 && eind ? eind : contour).cap.points) {
      positions.push(p.x + y.x * q.x + z.x * q.y, p.y + y.y * q.x + z.y * q.y, p.z + y.z * q.x + z.z * q.y);
      normals.push(tangent.x * sign, tangent.y * sign, tangent.z * sign);
    }
    for (const [a, b, c] of contour.cap.triangles) {
      if (sign > 0) indices.push(capBase + a, capBase + b, capBase + c);
      else indices.push(capBase + a, capBase + c, capBase + b);
    }
  }
}

function toGeometry(positions: number[], normals: number[], indices: number[]): THREE.BufferGeometry | null {
  if (indices.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(positions.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(indices, 1) : new THREE.Uint16BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Eén vervormde staaf als doorlopend profiel. */
export function createOpenFem3DSweptProfileGeometry(input: OpenFem3DSweepInput, curveSegments = DEFAULT_CURVE_SEGMENTS): THREE.BufferGeometry | null {
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  appendSweep(input, curveSegments, positions, normals, indices);
  return toGeometry(positions, normals, indices);
}

/** Alle vervormde staven in één geometrie: één tekenaanroep, ook bij honderden staven. */
export function createOpenFem3DSweptProfilesGeometry(inputs: readonly OpenFem3DSweepInput[], curveSegments = DEFAULT_CURVE_SEGMENTS): THREE.BufferGeometry | null {
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  for (const input of inputs) appendSweep(input, curveSegments, positions, normals, indices);
  return toGeometry(positions, normals, indices);
}

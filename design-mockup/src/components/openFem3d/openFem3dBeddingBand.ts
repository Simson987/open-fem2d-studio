/**
 * openFem3dBeddingBand.ts — het teken van een staaf op bedding in 3D (issue
 * #106): een gearceerde band onder de staaf, aan de kant van de grond, zoals
 * de bedding in 2D. Een (bijna) verticale staaf (een paal) heeft alleen
 * zijdelingse bedding en krijgt de arcering aan twee zijden; een liggende
 * staaf met zijdelingse bedding krijgt die smallere banden erbij, horizontaal
 * links en rechts. Bij een staaf steiler dan 45° (een schoorpaal) werkt de
 * zijdelingse bedding rondom; die banden staan dan aan weerszijden in het
 * verticale vlak door de staaf, zoals een schoorpaal in doorsnede getekend
 * wordt. Bij alleen druk is de contactlijn gestippeld: daar kan de staaf
 * loskomen.
 *
 * De band hoort bij de laag Opleggingen en volgt de regelaar Opleggingen
 * (issue #82): `size` is de opleggingsmaat. De lichte vulling is aanklikbaar
 * en kiest de staaf; de lijnen kleuren mee bij selectie.
 */
import * as THREE from "three";
import { openFem3DBeamIsColumn, openFem3DBeddingAllRound, type OpenFem3DBeam, type OpenFem3DModel } from "./openFem3dModel";

/** Kleur van de bedding: de band en de gronddruklijn. */
export const OPEN_FEM_3D_BEDDING_COLOR = 0x8b5e34;

/** Eén band: een rechthoek langs de staaf, `offset` tot `offset + depth` naar `normal`. */
export interface OpenFem3DBeddingStrip {
  /** Waar de band naar toe wijst: weg van de staaf (de grond). */
  normal: THREE.Vector3;
  /** Afstand van de staafas tot de contactlijn (m). */
  offset: number;
  /** Diepte van de band (m). */
  depth: number;
  /** Contactlijn gestippeld: alleen druk. */
  dashedContact: boolean;
}

export interface OpenFem3DBeddingBandShape {
  beamId: number;
  start: THREE.Vector3;
  end: THREE.Vector3;
  /** "ground": onder de staaf (verticale bedding); "pile": een (schoor)paal, alleen zijdelings aan twee zijden. */
  kind: "ground" | "pile";
  strips: OpenFem3DBeddingStrip[];
}

const Z = new THREE.Vector3(0, 0, 1);

/**
 * De banden van alle staven op bedding, bij opleggingsmaat `size` (m).
 * Zuiver (alleen meetkunde), zodat de vorm te toetsen is zonder WebGL.
 */
export function openFem3DBeddingBandShapes(
  model: Pick<OpenFem3DModel, "nodes" | "beams">, size: number,
): OpenFem3DBeddingBandShape[] {
  const nodes = new Map(model.nodes.map((node) => [node.id, node]));
  const shapes: OpenFem3DBeddingBandShape[] = [];
  for (const beam of model.beams) {
    const bedding = beam.bedding;
    const a = nodes.get(beam.startNodeId), b = nodes.get(beam.endNodeId);
    if (!bedding || !a || !b) continue;
    const start = new THREE.Vector3(a.x, a.y, a.z), end = new THREE.Vector3(b.x, b.y, b.z);
    const ex = end.clone().sub(start);
    if (ex.lengthSq() < 1e-18) continue;
    ex.normalize();
    const gap = 0.15 * size, depth = 0.5 * size;
    const strips: OpenFem3DBeddingStrip[] = [];
    if (openFem3DBeamIsColumn(beam, nodes)) {
      // Paal: arcering aan twee zijden, in het vlak door de staaf en X (of Y).
      const side = new THREE.Vector3(1, 0, 0).addScaledVector(ex, -ex.x);
      const normal = side.lengthSq() > 1e-12 ? side.normalize() : new THREE.Vector3(0, 1, 0);
      for (const sign of [1, -1]) {
        strips.push({ normal: normal.clone().multiplyScalar(sign), offset: gap, depth, dashedContact: false });
      }
      shapes.push({ beamId: beam.id, start, end, kind: "pile", strips });
      continue;
    }
    if (bedding.kKnPerM3 !== undefined) {
      // Omlaag, loodrecht op de staaf in het verticale vlak door de staafas.
      const down = Z.clone().negate().addScaledVector(ex, ex.z).normalize();
      strips.push({ normal: down, offset: gap, depth, dashedContact: bedding.compressionOnly === true });
    }
    const allRound = openFem3DBeddingAllRound(beam, nodes);
    if (bedding.kLateralKnPerM3 !== undefined) {
      // Rondom (schoorpaal): in het verticale vlak door de staaf, loodrecht
      // op de as; anders horizontaal loodrecht op de staaf.
      const side = allRound
        ? Z.clone().addScaledVector(ex, -ex.z).normalize()
        : new THREE.Vector3().crossVectors(ex, Z).normalize();
      for (const sign of [1, -1]) {
        strips.push({ normal: side.clone().multiplyScalar(sign), offset: gap, depth: depth * 0.6, dashedContact: false });
      }
    }
    const kind = allRound && bedding.kKnPerM3 === undefined ? "pile" : "ground";
    if (strips.length > 0) shapes.push({ beamId: beam.id, start, end, kind, strips });
  }
  return shapes;
}

/** Hoogstens zoveel arceringslijnen per band; een lange staaf krijgt dan een ruimere arcering. */
const MAX_HATCH = 160;

/**
 * De lijnstukken van één band: de contactlijn (als die niet gestippeld is), de
 * buitenrand, de twee kopse kanten en de arcering onder 45° (in de band).
 */
export function openFem3DBeddingStripSegments(
  start: THREE.Vector3, end: THREE.Vector3, strip: OpenFem3DBeddingStrip,
): { segments: THREE.Vector3[]; contact: [THREE.Vector3, THREE.Vector3]; corners: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] } {
  const length = start.distanceTo(end);
  const ex = end.clone().sub(start).normalize();
  const at = (along: number, depth: number) => start.clone().addScaledVector(ex, along).addScaledVector(strip.normal, strip.offset + depth);
  const h = strip.depth;
  const contact: [THREE.Vector3, THREE.Vector3] = [at(0, 0), at(length, 0)];
  const corners: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] = [at(0, 0), at(length, 0), at(length, h), at(0, h)];
  const segments: THREE.Vector3[] = [];
  if (!strip.dashedContact) segments.push(...contact);
  segments.push(at(0, h), at(length, h), at(0, 0), at(0, h), at(length, 0), at(length, h));
  // Arcering: lijnen van de contactlijn op s schuin naar de buitenrand op s − h,
  // geknipt op de band (0 … L).
  const step = Math.max(h * 0.7, (length + h) / MAX_HATCH);
  for (let s = step; s < length + h - 1e-9; s += step) {
    const from = Math.min(length, s), to = Math.max(0, s - h);
    if (from - to < 1e-9) continue;
    segments.push(at(from, s - from), at(to, s - to));
  }
  return { segments, contact, corners };
}

/** Een staaf op bedding (voor het snelle pad van de regelaar Opleggingen). */
export function openFem3DHasBedding(beams: readonly Pick<OpenFem3DBeam, "bedding">[]): boolean {
  return beams.some((beam) => beam.bedding !== undefined);
}

/**
 * Teken de banden in `group` (de laag Opleggingen). Per staaf één lichte
 * vulling (kiest de staaf) en één set lijnen; geeft het aantal banden terug.
 */
export function addOpenFem3DBeddingBands(group: THREE.Group, model: Pick<OpenFem3DModel, "nodes" | "beams">, size: number): number {
  const shapes = openFem3DBeddingBandShapes(model, size);
  for (const shape of shapes) {
    const fill: number[] = [];
    const lines: THREE.Vector3[] = [];
    const dashed: THREE.Vector3[] = [];
    for (const strip of shape.strips) {
      const { segments, contact, corners } = openFem3DBeddingStripSegments(shape.start, shape.end, strip);
      lines.push(...segments);
      if (strip.dashedContact) dashed.push(...contact);
      const [p0, p1, p2, p3] = corners;
      for (const p of [p0, p1, p2, p0, p2, p3]) fill.push(p.x, p.y, p.z);
    }
    const data = { type: "beam", id: shape.beamId, openFem3dBeddingBand: true };
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(fill, 3)),
      new THREE.MeshBasicMaterial({ color: OPEN_FEM_3D_BEDDING_COLOR, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.userData = { ...data };
    group.add(mesh);
    const outline = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(lines),
      new THREE.LineBasicMaterial({ color: OPEN_FEM_3D_BEDDING_COLOR }),
    );
    outline.userData = { ...data, pickable: false };
    group.add(outline);
    if (dashed.length > 0) {
      const depth = shape.strips[0]?.depth ?? size * 0.5;
      const contactLine = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(dashed),
        new THREE.LineDashedMaterial({ color: OPEN_FEM_3D_BEDDING_COLOR, dashSize: depth * 0.35, gapSize: depth * 0.25 }),
      );
      contactLine.computeLineDistances();
      contactLine.userData = { ...data, pickable: false, openFem3dBeddingContact: "compressionOnly" };
      group.add(contactLine);
    }
  }
  return shapes.length;
}

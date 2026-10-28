/**
 * openFem3dPlateBeddingHatch.ts — het teken van een plaat op bedding in 3D
 * (issue #107): een gearceerd grondvlak onder de plaat, aan de kant van de
 * grond, met langs de omtrek een gearceerde rand die de grond in gaat, zoals
 * de band onder een staaf op bedding (#106); die rand maakt de grond ook van
 * opzij en schuin van boven zichtbaar. Grondvlak en rand volgen de omtrek van
 * de plaat (bogen en afgeronde hoeken), de openingen blijven open. Bij alleen
 * druk is de contactlijn (de bovenrand van de grond) gestippeld: daar kan de
 * plaat loskomen.
 *
 * De kant van de grond is die van de rekenkern: tegen de plaatnormaal in (de
 * z-as van de plaatassen; bij een vloer onder, bij een wand de kant die de kern
 * kiest), dus niet de volgorde van de knopen. Het vlak ligt net onder de
 * getekende onderzijde: in de plaatweergave Volume onder de halve dikte, in
 * Vlak en Mesh onder het middenvlak (issue #78).
 *
 * Hoort bij de laag Opleggingen en volgt de regelaar Opleggingen (issue #82),
 * net als de randopleggingen in dezelfde plaatlaag. Niet kiesbaar: de plaat
 * zelf blijft het aanklikbare object.
 */
import * as THREE from "three";
import type { OpenFem3DModel } from "./openFem3dModel";
import { OPEN_FEM_3D_BEDDING_COLOR } from "./openFem3dBeddingBand";
import { openFem3DConditionMarkerSize } from "./openFem3dMarkers";
import { openFem3DPlateDrawnHalfThickness, type OpenFem3DPlateDisplay } from "./openFem3dPlateDisplay";
import { openFem3DPlateShape } from "./openFem3dPlateGeometry";
import { openFem3DPlateGroundDirection } from "./openFem3dPlateBedding";
import { openFem3DScaledSymbolSize } from "./openFem3dSymbolScale";

/** Naam van de groep met de arceringen binnen de plaatlaag. */
export const OPEN_FEM_3D_PLATE_BEDDING_NAME = "open-fem3d-plate-bedding";

/** Hoogstens zoveel arceringslijnen per plaat; een grote vloer krijgt dan een ruimere arcering. */
const MAX_HATCH = 200;
/** Fijnheid van bogen en afgeronde hoeken in de omtrek. */
const CURVE_SEGMENTS = 12;

export interface OpenFem3DPlateBeddingHatchShape {
  plateId: number;
  /** Waar de grond ligt (eenheidsvector): tegen de plaatnormaal in. */
  ground: THREE.Vector3;
  /** Afstand van het middenvlak tot het grondvlak (m). */
  offset: number;
  /** De omtrek en de openingen, op het grondvlak. */
  loops: THREE.Vector3[][];
  /** De arceringslijnen onder 45° in het plaatvlak, als paren begin–eind. */
  hatch: THREE.Vector3[];
  /** Diepte van de rand langs de omtrek, de grond in (m). */
  skirtDepth: number;
  /** De arcering van de rand onder 45°, als paren; elk stuk ligt op één zijvlak. */
  skirtHatch: THREE.Vector3[];
  /** De onderrand van de rand en de staande lijnen in de hoeken, als paren. */
  skirtEdges: THREE.Vector3[];
  /** Alleen druk: de rand gestippeld. */
  compressionOnly: boolean;
  /** De omtrek als vlakke vorm (voor de lichte vulling), met de afbeelding naar het grondvlak. */
  shape: THREE.Shape;
  matrix: THREE.Matrix4;
}

type P2 = { x: number; y: number };

/**
 * De arceringslijnen u − v = c door een vlakke vorm met gaten, geknipt
 * (even-oneven): per lijn de snijpunten met alle randen, op volgorde langs de
 * lijn, in paren.
 */
function hatchSegments(loops: readonly P2[][], spacing: number): [P2, P2][] {
  const all = loops.flat();
  if (all.length === 0) return [];
  const cs = all.map((p) => p.x - p.y);
  const cMin = Math.min(...cs), cMax = Math.max(...cs);
  // Loodrechte afstand tussen de lijnen u − v = c is Δc/√2.
  const step = Math.max(spacing * Math.SQRT2, (cMax - cMin) / MAX_HATCH);
  const segments: [P2, P2][] = [];
  for (let c = cMin + step / 2; c < cMax; c += step) {
    const hits: P2[] = [];
    for (const loop of loops) {
      for (let k = 0; k < loop.length; k += 1) {
        const p = loop[k], q = loop[(k + 1) % loop.length];
        const fp = p.x - p.y - c, fq = q.x - q.y - c;
        // Halfopen: een hoekpunt precies op de lijn telt één keer.
        if ((fp <= 0) === (fq <= 0)) continue;
        const t = fp / (fp - fq);
        hits.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
      }
    }
    hits.sort((a, b) => (a.x + a.y) - (b.x + b.y));
    for (let k = 0; k + 1 < hits.length; k += 2) {
      if (Math.hypot(hits[k + 1].x - hits[k].x, hits[k + 1].y - hits[k].y) > 1e-9) segments.push([hits[k], hits[k + 1]]);
    }
  }
  return segments;
}

/** Een knik in de omtrek groter dan dit (rad) krijgt een staande lijn in de rand. */
const CORNER_ANGLE = 20 * Math.PI / 180;

/**
 * De rand langs een gesloten lus op het grondvlak: de lus opengevouwen langs
 * haar booglengte s, met de diepte d de grond in. De arcering loopt van (s, 0)
 * naar (s − h, h), rond de lus, en wordt op elk hoekpunt geknipt zodat elk
 * stuk op één zijvlak ligt; de onderrand en de staande lijnen in de knikken
 * maken de vorm af.
 */
function skirt(loop: readonly THREE.Vector3[], ground: THREE.Vector3, depth: number): { hatch: THREE.Vector3[]; edges: THREE.Vector3[] } {
  const n = loop.length;
  const s: number[] = [0];
  for (let k = 1; k <= n; k += 1) s.push(s[k - 1] + loop[k - 1].distanceTo(loop[k % n]));
  const total = s[n];
  const hatch: THREE.Vector3[] = [], edges: THREE.Vector3[] = [];
  if (!(total > 1e-9)) return { hatch, edges };
  const at = (arc: number, d: number) => {
    const t = ((arc % total) + total) % total;
    let k = 0;
    while (k < n - 1 && s[k + 1] < t) k += 1;
    const span = s[k + 1] - s[k];
    const f = span > 1e-12 ? (t - s[k]) / span : 0;
    return loop[k].clone().lerp(loop[(k + 1) % n], f).addScaledVector(ground, d);
  };
  for (let k = 0; k < n; k += 1) {
    edges.push(loop[k].clone().addScaledVector(ground, depth), loop[(k + 1) % n].clone().addScaledVector(ground, depth));
    const before = loop[k].clone().sub(loop[(k + n - 1) % n]), after = loop[(k + 1) % n].clone().sub(loop[k]);
    if (before.lengthSq() > 1e-18 && after.lengthSq() > 1e-18 && before.angleTo(after) > CORNER_ANGLE) {
      edges.push(loop[k].clone(), loop[k].clone().addScaledVector(ground, depth));
    }
  }
  const step = Math.max(depth * 0.7, total / MAX_HATCH);
  for (let top = step / 2; top < total; top += step) {
    const bottom = top - depth;
    // De hoekpunten tussen bottom en top (ook rond het begin van de lus), op volgorde van boven naar onder.
    const knips: number[] = [];
    for (let k = 0; k < n; k += 1) {
      for (const sk of [s[k], s[k] - total]) if (sk < top - 1e-12 && sk > bottom + 1e-12) knips.push(sk);
    }
    knips.sort((a, b) => b - a);
    let vorige = top;
    for (const knip of [...knips, bottom]) {
      hatch.push(at(vorige, top - vorige), at(knip, top - knip));
      vorige = knip;
    }
  }
  return { hatch, edges };
}

/**
 * De arceringen van alle platen op bedding, bij opleggingsmaat `size` (m) en
 * plaatweergave `display`. Zuiver (alleen meetkunde), zodat de vorm te toetsen
 * is zonder WebGL.
 */
export function openFem3DPlateBeddingHatchShapes(
  model: OpenFem3DModel, size: number, display: OpenFem3DPlateDisplay,
): OpenFem3DPlateBeddingHatchShape[] {
  const nodeIndex = new Map(model.nodes.map((node) => [node.id, node]));
  const shapes: OpenFem3DPlateBeddingHatchShape[] = [];
  for (const plate of model.plates ?? []) {
    if (!plate.bedding) continue;
    const outline = openFem3DPlateShape(model, plate, nodeIndex);
    const groundArray = openFem3DPlateGroundDirection(model, plate, nodeIndex);
    if (!outline || !groundArray) continue;
    const ground = new THREE.Vector3(...groundArray);
    const offset = openFem3DPlateDrawnHalfThickness(plate.thicknessM, display) + 0.15 * size;
    // Van de vlakassen van de plaat (u, v, normaal uit de knoopvolgorde) naar het grondvlak.
    const matrix = new THREE.Matrix4().makeBasis(outline.u, outline.v, outline.normal)
      .setPosition(outline.position.clone().addScaledVector(ground, offset));
    const { shape: rand, holes } = outline.shape.extractPoints(CURVE_SEGMENTS);
    // Een gesloten omtrek kan zijn beginpunt herhalen; dat stuk heeft lengte 0.
    const open = (loop: THREE.Vector2[]) => loop.length > 1 && loop[0].distanceTo(loop[loop.length - 1]) < 1e-12 ? loop.slice(0, -1) : loop;
    const loops2 = [open(rand), ...holes.map(open)].filter((loop) => loop.length >= 3);
    const to3 = (p: P2) => new THREE.Vector3(p.x, p.y, 0).applyMatrix4(matrix);
    const hatch = hatchSegments(loops2, 0.6 * size).flatMap(([a, b]) => [to3(a), to3(b)]);
    const loops = loops2.map((loop) => loop.map(to3));
    // De rand de grond in: even diep als de band onder een staaf op bedding.
    const skirtDepth = 0.5 * size;
    const randen = loops.map((loop) => skirt(loop, ground, skirtDepth));
    shapes.push({
      plateId: plate.id, ground, offset, loops, hatch,
      skirtDepth, skirtHatch: randen.flatMap((rand) => rand.hatch), skirtEdges: randen.flatMap((rand) => rand.edges),
      compressionOnly: plate.bedding.compressionOnly === true, shape: outline.shape, matrix,
    });
  }
  return shapes;
}

/** Een plaat op bedding (voor het snelle pad van de regelaar Opleggingen). */
export function openFem3DHasPlateBedding(model: Pick<OpenFem3DModel, "plates">): boolean {
  return (model.plates ?? []).some((plate) => plate.bedding !== undefined);
}

/**
 * De arceringen als groep in de plaatlaag (laag Opleggingen), met dezelfde
 * maat als de band van een staaf op bedding; null zonder plaat op bedding.
 * Per plaat een lichte vulling, de arcering en de rand (gestippeld bij alleen
 * druk).
 */
export function buildOpenFem3DPlateBeddingHatch(
  model: OpenFem3DModel, supportSizePercent: number | undefined, display: OpenFem3DPlateDisplay,
): THREE.Group | null {
  if (!openFem3DHasPlateBedding(model)) return null;
  const size = openFem3DScaledSymbolSize(openFem3DConditionMarkerSize(model.nodes), supportSizePercent);
  const shapes = openFem3DPlateBeddingHatchShapes(model, size, display);
  if (shapes.length === 0) return null;
  const group = new THREE.Group();
  group.name = OPEN_FEM_3D_PLATE_BEDDING_NAME;
  for (const shape of shapes) {
    const data = { openFem3dPlateBedding: shape.plateId, pickable: false };
    const fillGeometry = new THREE.ShapeGeometry(shape.shape, CURVE_SEGMENTS);
    fillGeometry.applyMatrix4(shape.matrix);
    const fill = new THREE.Mesh(fillGeometry, new THREE.MeshBasicMaterial({
      color: OPEN_FEM_3D_BEDDING_COLOR, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
    }));
    fill.userData = { ...data };
    group.add(fill);
    // De rand de grond in: per stuk van de omtrek een lichte vulling.
    const skirtFill: number[] = [];
    for (const loop of shape.loops) {
      loop.forEach((p, k) => {
        const q = loop[(k + 1) % loop.length];
        const pd = p.clone().addScaledVector(shape.ground, shape.skirtDepth), qd = q.clone().addScaledVector(shape.ground, shape.skirtDepth);
        for (const v of [p, q, qd, p, qd, pd]) skirtFill.push(v.x, v.y, v.z);
      });
    }
    const skirtMesh = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(skirtFill, 3)),
      new THREE.MeshBasicMaterial({ color: OPEN_FEM_3D_BEDDING_COLOR, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }),
    );
    skirtMesh.userData = { ...data, openFem3dPlateBeddingSkirt: true };
    group.add(skirtMesh);
    const segments: THREE.Vector3[] = [...shape.hatch, ...shape.skirtHatch, ...shape.skirtEdges];
    const rand: THREE.Vector3[] = [];
    for (const loop of shape.loops) {
      loop.forEach((point, k) => rand.push(point, loop[(k + 1) % loop.length]));
    }
    if (!shape.compressionOnly) segments.push(...rand);
    const lines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(segments),
      new THREE.LineBasicMaterial({ color: OPEN_FEM_3D_BEDDING_COLOR, transparent: true, opacity: 0.85 }),
    );
    lines.userData = { ...data };
    group.add(lines);
    if (shape.compressionOnly) {
      const dash = 0.35 * size;
      const contact = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(rand),
        new THREE.LineDashedMaterial({ color: OPEN_FEM_3D_BEDDING_COLOR, dashSize: dash, gapSize: dash * 0.7 }),
      );
      contact.computeLineDistances();
      contact.userData = { ...data, openFem3dPlateBeddingContact: "compressionOnly" };
      group.add(contact);
    }
  }
  group.userData.openFem3dPlateBeddingCount = shapes.length;
  return group;
}

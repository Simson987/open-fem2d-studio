/**
 * Laag voor het 3D-tekenvlak met het rekennet van de platen (elementranden)
 * en de resultaatcontour. Staat los van de modelopbouw in ThreeFrameCanvas:
 * het tekenvlak roept `buildOpenFem3DPlateOverlay` na elke herbouw aan en hangt
 * de groep in de scène.
 */
import * as THREE from "three";
import { sampleCircularArc3D } from "./openFem3dCircularArc";
import { addOpenFem3DSupportGlyphs, openFem3DConditionMarkerSize } from "./openFem3dMarkers";
import type { OpenFem3DModel, OpenFem3DSupportRestraints } from "./openFem3dModel";
import { openFem3DPlateEdges } from "./openFem3dPlateEdges";
import type { OpenFem3DPlateMesh } from "./openFem3dPlateMesh";
import type { OpenFem3DSolveResult } from "./openFem3dSolver";
import {
  openFem3DContourColor, openFem3DPlateQuantity, openFem3DPlateQuantityRange, type OpenFem3DPlateQuantity,
} from "./openFem3dPlateResults";

export interface OpenFem3DPlateOverlayInput {
  model: OpenFem3DModel;
  /** Net zonder resultaat (weergave "Mesh" in de modeltab). */
  mesh: OpenFem3DPlateMesh | null;
  result: OpenFem3DSolveResult | null;
  quantity: OpenFem3DPlateQuantity | null;
  showMesh: boolean;
  showPlates: boolean;
  /** Randopleggingen tekenen (weergave "Opleggingen"). */
  showSupports?: boolean;
  deformation: boolean;
  /** Vergroting van de verplaatsingen (dezelfde als de staven). */
  deformationScale: number;
}

export interface OpenFem3DPlateOverlay {
  group: THREE.Group;
  /** De contour is getekend: maak de gewone plaatvlakken doorzichtiger. */
  contourShown: boolean;
}

type V3 = [number, number, number];

export function buildOpenFem3DPlateOverlay(input: OpenFem3DPlateOverlayInput): OpenFem3DPlateOverlay {
  const group = new THREE.Group();
  group.name = "open-fem3d-plate-overlay";
  if (input.showSupports) addEdgeSupportMarkers(group, input.model);
  const resultMesh = input.result?.plateMesh && (input.result.shellNodes?.length ?? 0) > 0 ? input.result.plateMesh : null;
  const mesh = resultMesh ?? input.mesh;
  if (!input.showPlates || !mesh || mesh.elements.length === 0) return { group, contourShown: false };
  const positions = new Map<number, V3>();
  for (const node of input.model.nodes) positions.set(node.id, [node.x, node.y, node.z]);
  for (const node of mesh.nodes) positions.set(node.id, [node.x, node.y, node.z]);
  const thickness = new Map((input.model.plates ?? []).map((plate) => [plate.id, plate.thicknessM]));
  const contour = input.quantity && resultMesh ? input.quantity : null;
  const displacement = new Map<number, V3>();
  const deformed = Boolean(input.result && input.deformation && resultMesh);
  if (deformed) for (const d of input.result!.displacements) displacement.set(d.nodeId, [d.ux, d.uy, d.uz]);
  const place = (id: number, offset: V3 = [0, 0, 0]): V3 => {
    const p = positions.get(id)!;
    const u = displacement.get(id);
    const s = deformed && u ? input.deformationScale : 0;
    return [p[0] + (u ? u[0] * s : 0) + offset[0], p[1] + (u ? u[1] * s : 0) + offset[1], p[2] + (u ? u[2] * s : 0) + offset[2]];
  };
  const byPlate = new Map<number, typeof mesh.elements>();
  for (const element of mesh.elements) {
    const list = byPlate.get(element.plateId);
    if (list) list.push(element); else byPlate.set(element.plateId, [element]);
  }
  const definition = contour ? openFem3DPlateQuantity(contour) : null;
  const range = contour ? openFem3DPlateQuantityRange(input.result, contour) : null;
  for (const [plateId, elements] of byPlate) {
    // Normaal uit het eerste element (alle elementen van een plaat liggen in één vlak).
    const [a, b, c, d] = elements[0].nodeIds.map((id) => positions.get(id)!);
    const diagonal1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const diagonal2 = [d[0] - b[0], d[1] - b[1], d[2] - b[2]];
    const normal = new THREE.Vector3().crossVectors(
      new THREE.Vector3(...diagonal1), new THREE.Vector3(...diagonal2)).normalize();
    const half = (thickness.get(plateId) ?? 0.2) / 2 + 0.002;
    if (contour && definition && range) {
      const values = new Map<number, number>();
      for (const node of input.result!.shellNodes ?? []) {
        if (node.plateId !== plateId) continue;
        const value = definition.read(node);
        if (value !== undefined && Number.isFinite(value)) values.set(node.nodeId, value);
      }
      const index = new Map<number, number>();
      const vertexPositions: number[] = [];
      const colors: number[] = [];
      const faces: number[] = [];
      const span = range.max - range.min;
      const vertex = (id: number) => {
        let k = index.get(id);
        if (k === undefined) {
          k = index.size;
          index.set(id, k);
          vertexPositions.push(...place(id));
          const value = values.get(id);
          const t = value === undefined ? 0.5 : span > 1e-12 ? (value - range.min) / span : 0.5;
          colors.push(...openFem3DContourColor(t));
        }
        return k;
      };
      for (const element of elements) {
        const [p, q, r, s] = element.nodeIds.map(vertex);
        faces.push(p, q, r, p, r, s);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertexPositions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(faces);
      geometry.computeBoundingSphere();
      const surface = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      }));
      surface.userData = { openFem3dPlateContour: plateId, pickable: false };
      group.add(surface);
    }
    if (input.showMesh) {
      const edges = new Set<string>();
      const segments: number[] = [];
      // Zonder contour liggen de lijnen op beide plaatvlakken, anders op de contour.
      const offsets: V3[] = contour
        ? [[0, 0, 0]]
        : [[normal.x * half, normal.y * half, normal.z * half], [-normal.x * half, -normal.y * half, -normal.z * half]];
      for (const element of elements) {
        for (let k = 0; k < 4; k += 1) {
          const from = element.nodeIds[k], to = element.nodeIds[(k + 1) % 4];
          const key = from < to ? `${from}-${to}` : `${to}-${from}`;
          if (edges.has(key)) continue;
          edges.add(key);
          for (const offset of offsets) segments.push(...place(from, offset), ...place(to, offset));
        }
      }
      const lines = new THREE.LineSegments(
        new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(segments, 3)),
        new THREE.LineBasicMaterial({ color: contour ? 0x0f172a : 0x475569, transparent: true, opacity: contour ? 0.45 : 0.75 }),
      );
      lines.userData = { openFem3dPlateMesh: plateId, pickable: false };
      group.add(lines);
    }
  }
  return { group, contourShown: Boolean(contour && range) };
}

/**
 * Randopleggingen: een lijn langs de opgelegde rand met om de zoveel meter
 * hetzelfde symbool als een knoopoplegging (niet selecteerbaar; de plaat
 * zelf blijft het aanklikbare object).
 */
function addEdgeSupportMarkers(group: THREE.Group, model: OpenFem3DModel): void {
  const plates = (model.plates ?? []).filter((plate) => (plate.edgeSupports?.length ?? 0) > 0);
  if (plates.length === 0) return;
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const size = openFem3DConditionMarkerSize(model.nodes) * 0.55;
  const markers = new THREE.Group();
  markers.name = "open-fem3d-plate-edge-supports";
  const segments: number[] = [];
  const glyphs: { point: THREE.Vector3; restraints: OpenFem3DSupportRestraints }[] = [];
  for (const plate of plates) {
    const edges = openFem3DPlateEdges(plate);
    for (const support of plate.edgeSupports ?? []) {
      const edge = edges[support.edge];
      const start = edge && byId.get(edge.startNodeId), end = edge && byId.get(edge.endNodeId);
      if (!edge || !start || !end) continue;
      const control = edge.controlNodeId === undefined ? undefined : byId.get(edge.controlNodeId);
      const polyline = (control ? sampleCircularArc3D(start, control, end, 48) : null) ?? [start, end];
      const points = polyline.map((p) => new THREE.Vector3(p.x, p.y, p.z));
      const lengths = [0];
      for (let k = 1; k < points.length; k += 1) lengths.push(lengths[k - 1] + points[k].distanceTo(points[k - 1]));
      const length = lengths[lengths.length - 1];
      if (!(length > 1e-9)) continue;
      // Bij afgeronde hoeken alleen het rechte deel van de rand.
      const trim = control ? 0 : Math.min(plate.cornerRadiusM ?? 0, 0.45 * length);
      const at = (distance: number) => {
        let k = 1;
        while (k < lengths.length - 1 && lengths[k] < distance) k += 1;
        const span = lengths[k] - lengths[k - 1];
        const f = span > 0 ? (distance - lengths[k - 1]) / span : 0;
        return points[k - 1].clone().lerp(points[k], f);
      };
      const usable = length - 2 * trim;
      const count = Math.max(1, Math.min(12, Math.round(usable / (3 * size))));
      for (let k = 0; k < count; k += 1) glyphs.push({ point: at(trim + usable * (k + 0.5) / count), restraints: support });
      const from = trim > 0 ? at(trim) : points[0];
      const to = trim > 0 ? at(length - trim) : points[points.length - 1];
      const line = trim > 0 ? [from, to] : points;
      for (let k = 1; k < line.length; k += 1) segments.push(...line[k - 1].toArray(), ...line[k].toArray());
    }
  }
  addOpenFem3DSupportGlyphs(markers, glyphs, size);
  if (segments.length > 0) {
    const lines = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(segments, 3)),
      new THREE.LineBasicMaterial({ color: 0xd97706 }),
    );
    lines.userData = { pickable: false, openFem3dSupportGlyph: true };
    markers.add(lines);
  }
  group.add(markers);
}

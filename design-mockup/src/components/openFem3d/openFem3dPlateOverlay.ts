/**
 * Laag voor het 3D-tekenvlak met het rekennet van de platen (elementranden)
 * en de resultaatcontour. Staat los van de modelopbouw in ThreeFrameCanvas:
 * het tekenvlak roept `buildOpenFem3DPlateOverlay` na elke herbouw aan en hangt
 * de groep in de scène. Elementranden en contour liggen op het middenvlak van
 * de plaat; de elementranden alleen in de plaatweergave "mesh" (issue #78).
 */
import * as THREE from "three";
import { sampleCircularArc3D } from "./openFem3dCircularArc";
import { addOpenFem3DSupportGlyphs, openFem3DConditionMarkerSize } from "./openFem3dMarkers";
import { openFem3DScaledSymbolSize } from "./openFem3dSymbolScale";
import type { OpenFem3DModel, OpenFem3DSupportRestraints } from "./openFem3dModel";
import { openFem3DPlateEdges } from "./openFem3dPlateEdges";
import type { OpenFem3DPlateMesh } from "./openFem3dPlateMesh";
import type { OpenFem3DSolveResult } from "./openFem3dSolver";
import {
  openFem3DContourColor, openFem3DPlateQuantity, openFem3DPlateQuantityRange, openFem3DPlateQuantityValues,
  type OpenFem3DPlateQuantity,
} from "./openFem3dPlateResults";
import { buildOpenFem3DPlateBeddingHatch } from "./openFem3dPlateBeddingHatch";
import type { OpenFem3DPlateDisplay } from "./openFem3dPlateDisplay";

/** Grijs voor een knoop zonder contact in de contour Gronddruk (#107): daar draagt de grond niets. */
export const OPEN_FEM_3D_PLATE_NO_CONTACT_COLOR: [number, number, number] = [0.62, 0.62, 0.62];

export interface OpenFem3DPlateOverlayInput {
  model: OpenFem3DModel;
  /** Net zonder resultaat (plaatweergave "mesh" in de modeltab). */
  mesh: OpenFem3DPlateMesh | null;
  result: OpenFem3DSolveResult | null;
  quantity: OpenFem3DPlateQuantity | null;
  /** De elementranden tekenen: alleen in de plaatweergave "mesh" (issue #78). */
  showMesh: boolean;
  showPlates: boolean;
  /** Randopleggingen tekenen (weergave "Opleggingen"). */
  showSupports?: boolean;
  /** Grootte van de opleggingssymbolen in % van de automatische maat (issue #82); ontbreekt: 100 %. */
  supportSizePercent?: number;
  /**
   * De plaatweergave (issue #78): de arcering van een plaat op bedding (#107)
   * ligt onder de getekende onderzijde (Volume) of onder het middenvlak.
   * Ontbreekt: "volume".
   */
  plateDisplay?: OpenFem3DPlateDisplay;
  deformation: boolean;
  /** Vergroting van de verplaatsingen (dezelfde als de staven). */
  deformationScale: number;
}

export interface OpenFem3DPlateOverlay {
  group: THREE.Group;
  /** De contour is getekend: maak de gewone plaatvlakken doorzichtiger. */
  contourShown: boolean;
  /** Aantal gemarkeerde knopen zonder contact (contour Gronddruk of Zakking, #107). */
  liftedNodes: number;
}

type V3 = [number, number, number];

export function buildOpenFem3DPlateOverlay(input: OpenFem3DPlateOverlayInput): OpenFem3DPlateOverlay {
  const group = new THREE.Group();
  group.name = "open-fem3d-plate-overlay";
  if (input.showSupports) {
    const edgeSupports = buildOpenFem3DPlateEdgeSupports(input.model, input.supportSizePercent);
    if (edgeSupports) group.add(edgeSupports);
    // Platen op bedding (#107): de gearceerde grond onder de plaat, ook in de laag Opleggingen.
    const hatch = buildOpenFem3DPlateBeddingHatch(input.model, input.supportSizePercent, input.plateDisplay ?? "volume");
    if (hatch) group.add(hatch);
  }
  const resultMesh = input.result?.plateMesh && (input.result.shellNodes?.length ?? 0) > 0 ? input.result.plateMesh : null;
  const mesh = resultMesh ?? input.mesh;
  if (!input.showPlates || !mesh || mesh.elements.length === 0) return { group, contourShown: false, liftedNodes: 0 };
  const positions = new Map<number, V3>();
  for (const node of input.model.nodes) positions.set(node.id, [node.x, node.y, node.z]);
  for (const node of mesh.nodes) positions.set(node.id, [node.x, node.y, node.z]);
  const contour = input.quantity && resultMesh ? input.quantity : null;
  const displacement = new Map<number, V3>();
  const deformed = Boolean(input.result && input.deformation && resultMesh);
  if (deformed) for (const d of input.result!.displacements) displacement.set(d.nodeId, [d.ux, d.uy, d.uz]);
  const place = (id: number): V3 => {
    const p = positions.get(id)!;
    const u = displacement.get(id);
    const s = deformed && u ? input.deformationScale : 0;
    return [p[0] + (u ? u[0] * s : 0), p[1] + (u ? u[1] * s : 0), p[2] + (u ? u[2] * s : 0)];
  };
  const byPlate = new Map<number, typeof mesh.elements>();
  for (const element of mesh.elements) {
    const list = byPlate.get(element.plateId);
    if (list) list.push(element); else byPlate.set(element.plateId, [element]);
  }
  const definition = contour ? openFem3DPlateQuantity(contour) : null;
  const range = contour ? openFem3DPlateQuantityRange(input.result, contour) : null;
  let contourShown = false;
  let liftedNodes = 0;
  for (const [plateId, elements] of byPlate) {
    const values = contour && definition && range ? openFem3DPlateQuantityValues(input.result, contour, plateId) : null;
    // Gronddruk en Zakking (#107) bestaan alleen bij een plaat op bedding: een andere plaat krijgt geen contour.
    if (contour && definition && range && values && values.size > 0) {
      contourShown = true;
      // Geen contact (alleen druk): in de contour Gronddruk grijs, en bij beide grootheden een stip.
      const noContact = new Set(definition.bedding
        ? (input.result!.plateBedding?.find((plate) => plate.plateId === plateId)?.nodes ?? [])
          .filter((node) => !node.active).map((node) => node.nodeId)
        : []);
      const grey = contour === "groundPressure";
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
          colors.push(...(grey && noContact.has(id) ? OPEN_FEM_3D_PLATE_NO_CONTACT_COLOR : openFem3DContourColor(t)));
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
      if (noContact.size > 0) {
        // Een stip op elke knoop zonder contact; zonder dieptetoets, dus van boven en van onder te zien.
        const dots: number[] = [];
        for (const id of noContact) if (index.has(id)) dots.push(...place(id));
        const points = new THREE.Points(
          new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(dots, 3)),
          new THREE.PointsMaterial({ color: 0x374151, size: 5, sizeAttenuation: false, depthTest: false, transparent: true }),
        );
        points.renderOrder = 3;
        points.userData = { openFem3dPlateLifted: plateId, pickable: false };
        group.add(points);
        liftedNodes += dots.length / 3;
      }
    }
    if (input.showMesh) {
      const edges = new Set<string>();
      const segments: number[] = [];
      // Op het middenvlak (de rekenknopen), met of zonder contour: in de
      // plaatweergave "mesh" heeft de plaat geen dikte (issue #78). Het
      // gevulde vlak eronder wijkt in de diepte terug (polygonOffset).
      for (const element of elements) {
        for (let k = 0; k < 4; k += 1) {
          const from = element.nodeIds[k], to = element.nodeIds[(k + 1) % 4];
          const key = from < to ? `${from}-${to}` : `${to}-${from}`;
          if (edges.has(key)) continue;
          edges.add(key);
          segments.push(...place(from), ...place(to));
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
  return { group, contourShown, liftedNodes };
}

/** Naam van de groep met randopleggingen binnen de plaatlaag. */
export const OPEN_FEM_3D_PLATE_EDGE_SUPPORTS_NAME = "open-fem3d-plate-edge-supports";

/**
 * Randopleggingen: een lijn langs de opgelegde rand met om de zoveel meter
 * hetzelfde symbool als een knoopoplegging (niet selecteerbaar; de plaat
 * zelf blijft het aanklikbare object). Null als geen plaat een randoplegging
 * heeft. Los aan te roepen, zodat het tekenvlak bij de regelaar Opleggingen
 * (issue #82) alleen deze groep vervangt en niet het net en de contour.
 */
export function buildOpenFem3DPlateEdgeSupports(model: OpenFem3DModel, supportSizePercent?: number): THREE.Group | null {
  const plates = (model.plates ?? []).filter((plate) => (plate.edgeSupports?.length ?? 0) > 0);
  if (plates.length === 0) return null;
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  // Dezelfde regelaar als de knoopopleggingen (issue #82). Een groter teken
  // staat ook verder uit elkaar (om de 3 maten), zodat ze niet overlappen.
  const size = openFem3DScaledSymbolSize(openFem3DConditionMarkerSize(model.nodes) * 0.55, supportSizePercent);
  const markers = new THREE.Group();
  markers.name = OPEN_FEM_3D_PLATE_EDGE_SUPPORTS_NAME;
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
  return markers;
}

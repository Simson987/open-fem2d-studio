import type { Frame3DConcreteChecks } from "./frame3dConcreteCheck";
import type { Frame3DModel, Frame3DNode } from "./frame3dModel";
import type { Frame3DSolveResult } from "./frame3dSolver";
import type { Frame3DSteelChecks } from "./frame3dSteelCheck";
import {
  buildFrame3DUtilizations,
  FRAME_3D_UTILIZATION_COLORS,
  frame3DUtilizationClass,
} from "./frame3dUtilization";
import { frame3DMaximumDisplacementM, frame3DMemberDisplacementStations } from "./frame3dDisplacement";

type Projection = "isometric" | "front" | "top";
type Point2D = { u: number; v: number };

interface Props {
  model: Frame3DModel;
  result: Frame3DSolveResult;
  checks?: Frame3DSteelChecks | null;
  concreteChecks?: Frame3DConcreteChecks | null;
}

const WIDTH = 560;
const HEIGHT = 260;
const PADDING = 28;

function project(node: Pick<Frame3DNode, "x" | "y" | "z">, projection: Projection): Point2D {
  if (projection === "front") return { u: node.x, v: node.z };
  if (projection === "top") return { u: node.x, v: node.y };
  // Eenvoudige axonometrie met Z verticaal; deterministisch en dus geschikt
  // voor afdrukken en regressiecontrole, zonder afhankelijkheid van WebGL.
  return { u: node.x - node.y, v: node.z - 0.48 * (node.x + node.y) };
}

function fit(points: Point2D[]) {
  let minU = 0, maxU = 0, minV = 0, maxV = 0;
  for (const point of points) {
    if (point.u < minU) minU = point.u;
    if (point.u > maxU) maxU = point.u;
    if (point.v < minV) minV = point.v;
    if (point.v > maxV) maxV = point.v;
  }
  const spanU = Math.max(maxU - minU, 1e-6);
  const spanV = Math.max(maxV - minV, 1e-6);
  const scale = Math.min((WIDTH - 2 * PADDING) / spanU, (HEIGHT - 2 * PADDING) / spanV);
  const drawnW = spanU * scale, drawnH = spanV * scale;
  const offsetX = (WIDTH - drawnW) / 2 - minU * scale;
  const offsetY = (HEIGHT - drawnH) / 2 + maxV * scale;
  return (point: Point2D) => ({ x: offsetX + point.u * scale, y: offsetY - point.v * scale });
}

function materialColor(material: string | undefined) {
  if (/^C\d/i.test(material ?? "")) return "#64748b";
  if (/^S\d/i.test(material ?? "")) return "#2563eb";
  return "#7c3f00";
}

function utilizationColor(value: ReturnType<typeof buildFrame3DUtilizations>[number] | undefined) {
  if (!value) return null;
  return `#${FRAME_3D_UTILIZATION_COLORS[frame3DUtilizationClass(value)].toString(16).padStart(6, "0")}`;
}

function deformationScale(model: Frame3DModel, result: Frame3DSolveResult) {
  if (model.nodes.length === 0) return 1;
  let minX = Number.POSITIVE_INFINITY, maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY, maxZ = Number.NEGATIVE_INFINITY;
  for (const node of model.nodes) {
    if (node.x < minX) minX = node.x;
    if (node.x > maxX) maxX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.y > maxY) maxY = node.y;
    if (node.z < minZ) minZ = node.z;
    if (node.z > maxZ) maxZ = node.z;
  }
  const modelSize = Math.max(Math.hypot(
    maxX - minX,
    maxY - minY,
    maxZ - minZ,
  ), 1);
  const maxDisplacement = frame3DMaximumDisplacementM(model, result);
  return maxDisplacement > 1e-15 ? Math.min(10_000, modelSize * 0.12 / maxDisplacement) : 1;
}

function View({
  model, result, projection, title, checks, concreteChecks,
}: Props & { projection: Projection; title: string }) {
  const nodeById = new Map<number, Frame3DNode>();
  for (const node of model.nodes) nodeById.set(node.id, node);
  const utilization = new Map(buildFrame3DUtilizations(checks, concreteChecks).map((value) => [value.beamId, value]));
  const magnification = deformationScale(model, result);
  const undeformed = model.nodes.map((node) => project(node, projection));
  const deformedBeams = new Map<number, Array<{ x: number; y: number; z: number }>>(model.beams.map((beam) => {
    const start = nodeById.get(beam.startNodeId), end = nodeById.get(beam.endNodeId);
    if (!start || !end) return [beam.id, []];
    return [beam.id, frame3DMemberDisplacementStations(model, beam, result).map((station) => ({
      x: start.x + (end.x - start.x) * station.t + magnification * station.ux,
      y: start.y + (end.y - start.y) * station.t + magnification * station.uy,
      z: start.z + (end.z - start.z) * station.t + magnification * station.uz,
    }))];
  }));
  const deformed = [...deformedBeams.values()].flat().map((node) => project(node, projection));
  const plateNodes = result.plateBending?.nodes ?? [];
  const undeformedPlate = plateNodes.map((node) => project(node, projection));
  const deformedPlate = plateNodes.map((node) => project({ ...node, z: node.z + magnification * node.wM }, projection));
  const toCanvas = fit([...undeformed, ...deformed, ...undeformedPlate, ...deformedPlate]);
  const plateById = new Map(plateNodes.map((node) => [node.meshNodeId, node]));

  return <figure className={`frame3d-report-projection frame3d-report-projection-${projection}`}>
    <figcaption>{title}</figcaption>
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${title} van het 3D-model`}>
      <rect x="0" y="0" width={WIDTH} height={HEIGHT} fill="#fff" />
      {result.plateBending?.quads.map((quad) => {
        const corners = quad.nodeIds.map((id) => plateById.get(id));
        if (corners.some((node) => !node)) return null;
        const polygon = (displaced: boolean) => corners.map((node) => {
          const point = toCanvas(project({ ...node!, z: node!.z + (displaced ? magnification * node!.wM : 0) }, projection));
          return `${point.x},${point.y}`;
        }).join(" ");
        return <g key={`plate-quad-${quad.id}`}>
          <polygon points={polygon(false)} fill="#dbeafe" fillOpacity="0.45" stroke="#64748b" strokeWidth="0.7" />
          {projection !== "top" && <polygon points={polygon(true)} fill="none" stroke="#dc2626" strokeWidth="1" strokeDasharray="3 2" />}
        </g>;
      })}
      {model.beams.map((beam) => {
        const start = nodeById.get(beam.startNodeId), end = nodeById.get(beam.endNodeId);
        if (!start || !end) return null;
        const a = toCanvas(project(start, projection)), b = toCanvas(project(end, projection));
        const color = utilizationColor(utilization.get(beam.id)) ?? materialColor(beam.material);
        return <g key={`beam-${beam.id}`}>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth="5" strokeLinecap="round" />
          <text x={(a.x + b.x) / 2 + 5} y={(a.y + b.y) / 2 - 5} className="frame3d-report-svg-label">{beam.id}</text>
        </g>;
      })}
      {model.beams.map((beam) => {
        const stations = deformedBeams.get(beam.id) ?? [];
        if (stations.length < 2) return null;
        const points = stations.map((station) => {
          const point = toCanvas(project(station, projection));
          return `${point.x},${point.y}`;
        }).join(" ");
        return <polyline key={`deformed-${beam.id}`} points={points} fill="none"
          stroke="#dc2626" strokeWidth="2.4" strokeDasharray="8 5" strokeLinecap="round" strokeLinejoin="round" />;
      })}
      {(model.supports ?? []).map((support) => {
        const node = nodeById.get(support.nodeId);
        if (!node) return null;
        const point = toCanvas(project(node, projection));
        return <path key={`support-${support.nodeId}`}
          d={`M ${point.x} ${point.y + 4} l -8 13 h 16 z`}
          fill="#fff" stroke="#111827" strokeWidth="2" />;
      })}
      {model.nodes.map((node) => {
        const point = toCanvas(project(node, projection));
        return <g key={`node-${node.id}`}>
          <circle cx={point.x} cy={point.y} r="4.2" fill="#fff" stroke="#111827" strokeWidth="2" />
          <text x={point.x + 6} y={point.y + 15} className="frame3d-report-svg-node">K{node.id}</text>
        </g>;
      })}
      <g className="frame3d-report-axis-key" transform="translate(24 226)">
        <line x1="0" y1="0" x2="34" y2="0" stroke="#dc2626" strokeWidth="2" />
        <text x="38" y="4">X</text>
        {projection !== "front" && <><line x1="0" y1="0" x2="-14" y2="-22" stroke="#16a34a" strokeWidth="2" /><text x="-25" y="-25">Y</text></>}
        {projection !== "top" && <><line x1="0" y1="0" x2="0" y2="-32" stroke="#2563eb" strokeWidth="2" /><text x="4" y="-28">Z</text></>}
      </g>
    </svg>
  </figure>;
}

/** Drie printvaste vectoraanzichten met dezelfde resultaatkleuren als de 3D-werkruimte. */
export default function Frame3DReportViews(props: Props) {
  return <div className="frame3d-report-views">
    <View {...props} projection="isometric" title="Isometrisch" />
    <View {...props} projection="front" title="Vooraanzicht X/Z" />
    <View {...props} projection="top" title="Bovenaanzicht X/Y" />
    <p className="frame3d-report-view-legend">
      {props.result.plateBending ? "Blauw: onvervormd plaatrooster. Rood gestreept: berekende doorbuiging"
        : "Staafkleur: UGT-unity check volgens EN 1992 of EN 1993 indien beschikbaar. Rood gestreept: vervormde vorm"},
      automatisch vergroot ×{numberForLegend(deformationScale(props.model, props.result))}.
    </p>
  </div>;
}

function numberForLegend(value: number) {
  return Number.isFinite(value) ? value.toLocaleString("nl-NL", { maximumFractionDigits: 1 }) : "1";
}

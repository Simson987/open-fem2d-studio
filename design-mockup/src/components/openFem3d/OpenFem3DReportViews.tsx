import type { OpenFem3DConcreteChecks } from "./openFem3dConcreteCheck";
import type { OpenFem3DModel, OpenFem3DNode } from "./openFem3dModel";
import type { OpenFem3DSolveResult } from "./openFem3dSolver";
import type { OpenFem3DSteelChecks } from "./openFem3dSteelCheck";
import type { OpenFem3DTimberChecks } from "./openFem3dTimberCheck";
import {
  buildOpenFem3DUtilizations,
  OPEN_FEM_3D_UTILIZATION_COLORS,
  openFem3DUtilizationClass,
} from "./openFem3dUtilization";
import { openFem3DMaximumDisplacementM, openFem3DMemberDisplacementStations } from "./openFem3dDisplacement";
import { useId } from "react";
import { openFem3DRapportOpleggingPad, type RapportBeeld } from "./openFem3dRapportBeeld";

type Projection = "isometric" | "front" | "top";
type Point2D = { u: number; v: number };

interface Props {
  model: OpenFem3DModel;
  result: OpenFem3DSolveResult;
  checks?: OpenFem3DSteelChecks | null;
  concreteChecks?: OpenFem3DConcreteChecks | null;
  timberChecks?: OpenFem3DTimberChecks | null;
}

const WIDTH = 560;
const HEIGHT = 260;
const PADDING = 28;

function project(node: Pick<OpenFem3DNode, "x" | "y" | "z">, projection: Projection): Point2D {
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

function utilizationColor(value: ReturnType<typeof buildOpenFem3DUtilizations>[number] | undefined) {
  if (!value) return null;
  return `#${OPEN_FEM_3D_UTILIZATION_COLORS[openFem3DUtilizationClass(value)].toString(16).padStart(6, "0")}`;
}

function deformationScale(model: OpenFem3DModel, result: OpenFem3DSolveResult) {
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
  const maxDisplacement = openFem3DMaximumDisplacementM(model, result);
  return maxDisplacement > 1e-15 ? Math.min(10_000, modelSize * 0.12 / maxDisplacement) : 1;
}

function View({
  model, result, projection, title, checks, concreteChecks, timberChecks,
}: Props & { projection: Projection; title: string }) {
  const nodeById = new Map<number, OpenFem3DNode>();
  for (const node of model.nodes) nodeById.set(node.id, node);
  const utilization = new Map(buildOpenFem3DUtilizations(checks, concreteChecks, timberChecks).map((value) => [value.beamId, value]));
  const magnification = deformationScale(model, result);
  const undeformed = model.nodes.map((node) => project(node, projection));
  const deformedBeams = new Map<number, Array<{ x: number; y: number; z: number }>>(model.beams.map((beam) => {
    const start = nodeById.get(beam.startNodeId), end = nodeById.get(beam.endNodeId);
    if (!start || !end) return [beam.id, []];
    return [beam.id, openFem3DMemberDisplacementStations(model, beam, result).map((station) => ({
      x: start.x + (end.x - start.x) * station.t + magnification * station.ux,
      y: start.y + (end.y - start.y) * station.t + magnification * station.uy,
      z: start.z + (end.z - start.z) * station.t + magnification * station.uz,
    }))];
  }));
  const deformed = [...deformedBeams.values()].flat().map((node) => project(node, projection));
  const toCanvas = fit([...undeformed, ...deformed]);

  return <figure className={`open-fem3d-report-projection open-fem3d-report-projection-${projection}`}>
    <figcaption>{title}</figcaption>
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${title} van het 3D-raamwerk`}>
      <rect x="0" y="0" width={WIDTH} height={HEIGHT} fill="#fff" />
      {model.beams.map((beam) => {
        const start = nodeById.get(beam.startNodeId), end = nodeById.get(beam.endNodeId);
        if (!start || !end) return null;
        const a = toCanvas(project(start, projection)), b = toCanvas(project(end, projection));
        const color = utilizationColor(utilization.get(beam.id)) ?? materialColor(beam.material);
        return <g key={`beam-${beam.id}`}>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth="5" strokeLinecap="round" />
          <text x={(a.x + b.x) / 2 + 5} y={(a.y + b.y) / 2 - 5} className="open-fem3d-report-svg-label">{beam.id}</text>
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
          <text x={point.x + 6} y={point.y + 15} className="open-fem3d-report-svg-node">K{node.id}</text>
        </g>;
      })}
      <g className="open-fem3d-report-axis-key" transform="translate(24 226)">
        <line x1="0" y1="0" x2="34" y2="0" stroke="#dc2626" strokeWidth="2" />
        <text x="38" y="4">X</text>
        {projection !== "front" && <><line x1="0" y1="0" x2="-14" y2="-22" stroke="#16a34a" strokeWidth="2" /><text x="-25" y="-25">Y</text></>}
        {projection !== "top" && <><line x1="0" y1="0" x2="0" y2="-32" stroke="#2563eb" strokeWidth="2" /><text x="4" y="-28">Z</text></>}
      </g>
    </svg>
  </figure>;
}

/** Drie printvaste vectoraanzichten met dezelfde resultaatkleuren als de 3D-werkruimte. */
export default function OpenFem3DReportViews(props: Props) {
  return <div className="open-fem3d-report-views">
    <View {...props} projection="isometric" title="Isometrisch" />
    <View {...props} projection="front" title="Vooraanzicht X/Z" />
    <View {...props} projection="top" title="Bovenaanzicht X/Y" />
    <p className="open-fem3d-report-view-legend">
      Staafkleur: UGT-unity check volgens EN 1992 of EN 1993 indien beschikbaar. Rood gestreept: vervormde vorm,
      automatisch vergroot ×{numberForLegend(deformationScale(props.model, props.result))}.
    </p>
  </div>;
}

function numberForLegend(value: number) {
  return Number.isFinite(value) ? value.toLocaleString("nl-NL", { maximumFractionDigits: 1 }) : "1";
}

/**
 * Eén view uit de tab Views als afbeelding met titel (openFem3dRapportBeeld.ts
 * levert het beeld). Zonder beeld: de reden, zodat een aangevinkte view nooit
 * stil uit het rapport verdwijnt.
 */
export function OpenFem3DViewFiguur({ beeld, titel, ondertitel, reden, vergrotingTekst, sleutel }: {
  beeld: RapportBeeld | null;
  titel: string;
  ondertitel?: string;
  reden?: string;
  vergrotingTekst?: string;
  sleutel: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const pijlkop = (kleur: string) => `url(#${id}-${kleur.slice(1)})`;
  const kleuren = beeld ? [...new Set([...beeld.lastpijlen, ...beeld.reacties].map((p) => p.kleur))] : [];
  return <figure className="open-fem3d-report-projection open-fem3d-report-view" data-rapport-view={sleutel}>
    <figcaption>{titel}{ondertitel ? <span className="open-fem3d-report-view-sub"> · {ondertitel}</span> : null}</figcaption>
    {beeld ? <svg viewBox={`0 0 ${beeld.breedte} ${beeld.hoogte}`} role="img" aria-label={titel}>
      <defs>
        {kleuren.map((kleur) => <marker key={kleur} id={`${id}-${kleur.slice(1)}`} viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={kleur} /></marker>)}
      </defs>
      <rect x="0" y="0" width={beeld.breedte} height={beeld.hoogte} fill="#fff" />
      {beeld.platen.map((p, i) => <polygon key={`p${i}`} points={p.punten} fill="#94a3b8" fillOpacity="0.22" stroke="#64748b" strokeWidth="1" />)}
      {beeld.diagrammen.map((d, i) => <g key={`d${i}`}>
        <polygon points={d.vlak} fill={d.kleur} fillOpacity="0.18" stroke="none" />
        <polyline points={d.lijn} fill="none" stroke={d.kleur} strokeWidth="1.6" strokeLinejoin="round" />
      </g>)}
      {beeld.staven.map((s) => <line key={`s${s.id}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.kleur}
        strokeWidth="4" strokeLinecap="round" data-staaf={s.id} />)}
      {beeld.vervorming.map((punten, i) => <polyline key={`v${i}`} points={punten} fill="none" stroke="#dc2626"
        strokeWidth="2.2" strokeDasharray="8 5" strokeLinecap="round" strokeLinejoin="round" />)}
      {beeld.lijnlasten.map((l, i) => <polyline key={`l${i}`} points={l.punten} fill="none" stroke={l.kleur} strokeWidth="1.2" />)}
      {[...beeld.lastpijlen, ...beeld.reacties].map((p, i) => <g key={`a${i}`} className={p.kleur === "#16a34a" ? "open-fem3d-report-reactie" : "open-fem3d-report-last"}>
        <line x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={p.kleur} strokeWidth="1.6" markerEnd={pijlkop(p.kleur)} />
        {p.label && <text x={p.x1 + 4} y={p.y1 - 4} className="open-fem3d-report-svg-label" fill={p.kleur}>{p.label}</text>}
      </g>)}
      {/* De maten van oplegging en knoop volgen de regelaars van de view (issue #82). */}
      {/* De top van het teken ligt vlak onder de knoopcirkel, ook als de schalen verschillen. */}
      {beeld.opleggingen.map((q, i) => <path key={`o${i}`}
        d={openFem3DRapportOpleggingPad(q, beeld.knoopStraal, beeld.opleggingSchaal)} fill="#fff" stroke="#111827" strokeWidth="2" />)}
      {beeld.knopen.map((k) => <circle key={`k${k.id}`} cx={k.x} cy={k.y} r={beeld.knoopStraal} fill="#fff" stroke="#111827" strokeWidth="1.6" />)}
      {beeld.teksten.map((tekst, i) => <text key={`t${i}`} x={tekst.x} y={tekst.y} className="open-fem3d-report-svg-node" style={{ fill: tekst.kleur }}>{tekst.tekst}</text>)}
    </svg> : <p className="open-fem3d-report-note open-fem3d-report-view-leeg">{reden}</p>}
    {beeld && (beeld.legenda.length > 0 || vergrotingTekst) && <p className="open-fem3d-report-view-legend">
      {beeld.legenda.map((l) => <span key={l.tekst} className="open-fem3d-report-view-key"><i style={{ background: l.kleur }} />{l.tekst}</span>)}
      {vergrotingTekst && <span>{vergrotingTekst}</span>}
    </p>}
  </figure>;
}

import type { BeamCheckConfig } from "../fem/femTypes";
import { dichtheidVanMateriaal, G, resolveSection } from "../../lib/sectionResolver";

/** Geometry for the 3D workspace. Coordinates are metres; Z is vertical, like 2D. */
export interface Frame3DNode {
  id: number;
  x: number;
  y: number;
  z: number;
}

export interface Frame3DBeam {
  id: number;
  startNodeId: number;
  endNodeId: number;
  /** Optional model metadata; the centre-line remains valid without it. */
  profileName?: string;
  material?: string;
  /** Dezelfde materiaal- en norminstellingen als bij een 2D-staaf. */
  checkConfig?: BeamCheckConfig;
  /** Rotatie van de lokale y/z-assen om de staafas, in radialen. */
  rollAngleRad?: number;
  /** Moment- en torsiescharnieren aan de staafeinden, in lokale assen. */
  releases?: Frame3DEndReleases;
}

export interface Frame3DEndReleases {
  myStart: boolean;
  myEnd: boolean;
  mzStart: boolean;
  mzEnd: boolean;
  torsionStart: boolean;
  torsionEnd: boolean;
}

/** True means that this global displacement or rotation is restrained. */
export interface Frame3DSupportRestraints {
  ux: boolean;
  uy: boolean;
  uz: boolean;
  rx: boolean;
  ry: boolean;
  rz: boolean;
}

export interface Frame3DSupport extends Frame3DSupportRestraints {
  nodeId: number;
  /** Globale oplegveren. Translatie in kN/m, rotatie in kNm/rad. */
  springs?: Frame3DSupportSprings;
  /** Opgelegde waarden op geblokkeerde globale DOF's; m en rad. */
  prescribed?: Frame3DPrescribedDisplacements;
}

export interface Frame3DSupportSprings {
  kxKnPerM?: number;
  kyKnPerM?: number;
  kzKnPerM?: number;
  krxKnmPerRad?: number;
  kryKnmPerRad?: number;
  krzKnmPerRad?: number;
}

export interface Frame3DPrescribedDisplacements {
  uxM?: number;
  uyM?: number;
  uzM?: number;
  rxRad?: number;
  ryRad?: number;
  rzRad?: number;
}

/** Forces are kN, moments kNm, all in the global X/Y/Z axes. */
export interface Frame3DNodalLoadComponents {
  fx: number;
  fy: number;
  fz: number;
  mx: number;
  my: number;
  mz: number;
}

export interface Frame3DNodalLoad extends Frame3DNodalLoadComponents {
  id: number;
  nodeId: number;
  /** Belastinggeval uit de gedeelde projectlijst. Ontbrekend in oude bestanden = geval 1. */
  caseId?: number;
}

/** Trapezoidal staafbelasting in lokale y/z-richting; afstanden in m, intensiteiten in kN/m. */
export interface Frame3DMemberLoad {
  id: number;
  beamId: number;
  /** Belastinggeval uit de gedeelde projectlijst. Ontbrekend in oude bestanden = geval 1. */
  caseId?: number;
  qyStart: number;
  qyEnd: number;
  qzStart: number;
  qzEnd: number;
  startPositionM: number;
  endPositionM: number;
}

/** Puntlast op een staaf in lokale y/z-richting; positie in m en krachten in kN. */
export interface Frame3DMemberPointLoad {
  id: number;
  beamId: number;
  /** Belastinggeval uit de gedeelde projectlijst. Ontbrekend in oude bestanden = geval 1. */
  caseId?: number;
  py: number;
  pz: number;
  positionM: number;
}

/** Temperatuurbelasting op een staaf; alle waarden zijn temperatuurverschillen in K. */
export interface Frame3DThermalLoad {
  id: number;
  beamId: number;
  caseId?: number;
  deltaTUniformK: number;
  /** Verschil over de doorsnede in lokale y-richting; veroorzaakt Mz. */
  deltaTGradientYK: number;
  /** Verschil over de doorsnede in lokale z-richting; veroorzaakt My. */
  deltaTGradientZK: number;
}

export interface Frame3DPlateOpening {
  id: number;
  /** Knoopvolgorde rond de opening; dezelfde vlakke basis als de plaat. */
  nodeIds: number[];
  /** Getekende gesloten contour. Een boog gebruikt begin-, stuur- en eindknoop. */
  boundary?: Frame3DPlateBoundarySegment[];
  cornerRadiusM?: number;
}

export type Frame3DPlateBoundarySegment =
  | { kind: "line"; startNodeId: number; endNodeId: number }
  | { kind: "arc"; startNodeId: number; controlNodeId: number; endNodeId: number };

export interface Frame3DPlate {
  id: number;
  /** Knoopvolgorde rond de buitenrand, minimaal drie. */
  nodeIds: number[];
  /** Werkelijke getekende rand; ontbreekt bij oudere hoekpuntplaten. */
  boundary?: Frame3DPlateBoundarySegment[];
  thicknessM: number;
  material?: string;
  /** Werkelijke afrondingsstraal van de plaatrand. */
  cornerRadiusM?: number;
  openings?: Frame3DPlateOpening[];
}

/** Oppervlaktebelasting in globale assen, kN/m². */
export interface Frame3DSurfaceLoad {
  id: number;
  plateId: number;
  caseId?: number;
  qx: number;
  qy: number;
  qz: number;
}

export interface Frame3DModel {
  nodes: Frame3DNode[];
  beams: Frame3DBeam[];
  /** Optional so models made before nodal conditions remain readable. */
  supports?: Frame3DSupport[];
  loads?: Frame3DNodalLoad[];
  memberLoads?: Frame3DMemberLoad[];
  memberPointLoads?: Frame3DMemberPointLoad[];
  thermalLoads?: Frame3DThermalLoad[];
  plates?: Frame3DPlate[];
  surfaceLoads?: Frame3DSurfaceLoad[];
}

export const EMPTY_FRAME_3D: Frame3DModel = {
  nodes: [], beams: [], supports: [], loads: [], memberLoads: [], memberPointLoads: [], thermalLoads: [], plates: [], surfaceLoads: [],
};

export const FRAME3D_SUPPORT_PRESETS = {
  fixed: { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
  pinned: { ux: true, uy: true, uz: true, rx: false, ry: false, rz: false },
  /** Ruimtelijke rolpresets blokkeren precies de genoemde globale translatie. */
  xRoller: { ux: true, uy: false, uz: false, rx: false, ry: false, rz: false },
  yRoller: { ux: false, uy: true, uz: false, rx: false, ry: false, rz: false },
  zRoller: { ux: false, uy: false, uz: true, rx: false, ry: false, rz: false },
  /** Translatievast; alleen rotatie om de gekozen globale as blijft vrij. */
  revoluteX: { ux: true, uy: true, uz: true, rx: false, ry: true, rz: true },
  revoluteY: { ux: true, uy: true, uz: true, rx: true, ry: false, rz: true },
  revoluteZ: { ux: true, uy: true, uz: true, rx: true, ry: true, rz: false },
} as const satisfies Record<string, Frame3DSupportRestraints>;

export type Frame3DSupportPreset = keyof typeof FRAME3D_SUPPORT_PRESETS;

/** Herken een standaardoplegging zonder een tweede, potentieel strijdige typecode op te slaan. */
export function frame3DSupportPresetOf(
  support: Frame3DSupportRestraints,
): Frame3DSupportPreset | "custom" {
  const axes = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;
  for (const [name, preset] of Object.entries(FRAME3D_SUPPORT_PRESETS)) {
    if (axes.every((axis) => support[axis] === preset[axis])) return name as Frame3DSupportPreset;
  }
  return "custom";
}

export function frame3DRevoluteAxis(
  support: Frame3DSupportRestraints,
): "x" | "y" | "z" | null {
  const preset = frame3DSupportPresetOf(support);
  return preset === "revoluteX" ? "x" : preset === "revoluteY" ? "y" : preset === "revoluteZ" ? "z" : null;
}

const SUPPORT_DOF = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;
const SPRING_DOF = ["kxKnPerM", "kyKnPerM", "kzKnPerM", "krxKnmPerRad", "kryKnmPerRad", "krzKnmPerRad"] as const;
const PRESCRIBED_DOF = ["uxM", "uyM", "uzM", "rxRad", "ryRad", "rzRad"] as const;
const LOAD_DOF = ["fx", "fy", "fz", "mx", "my", "mz"] as const;
const RELEASE_DOF = ["myStart", "myEnd", "mzStart", "mzEnd", "torsionStart", "torsionEnd"] as const;

function readEndReleases(value: unknown): Frame3DEndReleases | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Een 3D-staaf bevat ongeldige eindscharnieren.");
  }
  const releases = value as Record<string, unknown>;
  if (RELEASE_DOF.some((axis) => releases[axis] !== undefined && typeof releases[axis] !== "boolean")) {
    throw new Error("Een 3D-staaf bevat een ongeldig eindscharnier.");
  }
  return Object.fromEntries(RELEASE_DOF.map((axis) => [axis, releases[axis] === true])) as unknown as Frame3DEndReleases;
}

type Vector3 = [number, number, number];

/** Dezelfde Z-up lokale assen als de solver, inclusief profielrotatie. */
export function frame3DMemberAxes(
  start: Pick<Frame3DNode, "x" | "y" | "z">,
  end: Pick<Frame3DNode, "x" | "y" | "z">,
  rollAngleRad = 0,
): { ex: Vector3; ey: Vector3; ez: Vector3 } {
  const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  if (!(length > 0) || !Number.isFinite(rollAngleRad)) throw new Error("Een 3D-staaf heeft ongeldige lokale assen.");
  const ex: Vector3 = [(end.x - start.x) / length, (end.y - start.y) / length, (end.z - start.z) / length];
  const up: Vector3 = Math.abs(ex[2]) > 0.999 ? [1, 0, 0] : [0, 0, 1];
  const projection = ex[0] * up[0] + ex[1] * up[1] + ex[2] * up[2];
  const ezBase: Vector3 = [
    up[0] - projection * ex[0], up[1] - projection * ex[1], up[2] - projection * ex[2],
  ];
  const ezLength = Math.hypot(...ezBase);
  const ez0: Vector3 = [ezBase[0] / ezLength, ezBase[1] / ezLength, ezBase[2] / ezLength];
  const ey0: Vector3 = [
    ez0[1] * ex[2] - ez0[2] * ex[1],
    ez0[2] * ex[0] - ez0[0] * ex[2],
    ez0[0] * ex[1] - ez0[1] * ex[0],
  ];
  const cosine = Math.cos(rollAngleRad), sine = Math.sin(rollAngleRad);
  const ey: Vector3 = [
    cosine * ey0[0] + sine * ez0[0],
    cosine * ey0[1] + sine * ez0[1],
    cosine * ey0[2] + sine * ez0[2],
  ];
  const ez: Vector3 = [
    cosine * ez0[0] - sine * ey0[0],
    cosine * ez0[1] - sine * ey0[1],
    cosine * ez0[2] - sine * ey0[2],
  ];
  return { ex, ey, ez };
}

function readOptionalCaseId(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error("Een 3D-belasting heeft een ongeldig belastinggeval.");
  }
  return Number(value);
}

export function frame3DLoadCaseId(load: { caseId?: number }): number {
  return load.caseId ?? 1;
}

/**
 * Voeg het automatische eigen gewicht toe aan een vluchtige kopie van het
 * 3D-model. Het gewicht werkt altijd in globale -Z. De verdeelde last wordt
 * ontbonden in lokale y/z-componenten; de lokale axiale component (qx), die
 * het huidige Dedaliano-contract nog niet rechtstreeks kent, krijgt de exact
 * equivalente halve normaalkracht op beide eindknopen.
 */
export function withFrame3DSelfWeight(model: Frame3DModel, caseId: number): Frame3DModel {
  if (!Number.isSafeInteger(caseId) || caseId <= 0) throw new Error("Het belastinggeval voor 3D-eigen gewicht is ongeldig.");
  const loads = [...(model.loads ?? [])];
  const memberLoads = [...(model.memberLoads ?? [])];
  let nextLoadId = Math.max(0, ...loads.map((load) => load.id)) + 1;
  let nextMemberLoadId = Math.max(0, ...memberLoads.map((load) => load.id)) + 1;

  for (const beam of model.beams) {
    const start = model.nodes.find((node) => node.id === beam.startNodeId)!;
    const end = model.nodes.find((node) => node.id === beam.endNodeId)!;
    const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
    const { ex, ey, ez } = frame3DMemberAxes(start, end, beam.rollAngleRad ?? 0);

    const resolved = resolveSection(beam.material?.trim() ?? "", beam.profileName?.trim() ?? "");
    if (resolved.bron === "default") {
      throw new Error(`Staaf ${beam.id}: eigen gewicht kan niet worden bepaald: ${resolved.reden ?? "doorsnede onbekend"}.`);
    }
    const areaM2 = (resolved.aBruto ?? resolved.A) * 1e-6;
    const qGlobal: [number, number, number] = [
      0, 0, -(dichtheidVanMateriaal(beam.material) * areaM2 * G) / 1000,
    ];
    const dot = (axis: [number, number, number]) =>
      qGlobal[0] * axis[0] + qGlobal[1] * axis[1] + qGlobal[2] * axis[2];
    const qx = dot(ex), qy = dot(ey), qz = dot(ez);

    if (Math.abs(qy) > 1e-12 || Math.abs(qz) > 1e-12) {
      memberLoads.push({
        id: nextMemberLoadId++, beamId: beam.id, caseId,
        qyStart: qy, qyEnd: qy, qzStart: qz, qzEnd: qz,
        startPositionM: 0, endPositionM: length,
      });
    }
    if (Math.abs(qx) > 1e-12) {
      const endForce = qx * length / 2;
      for (const nodeId of [beam.startNodeId, beam.endNodeId]) {
        loads.push({
          id: nextLoadId++, nodeId, caseId,
          fx: ex[0] * endForce, fy: ex[1] * endForce, fz: ex[2] * endForce,
          mx: 0, my: 0, mz: 0,
        });
      }
    }
  }
  return { ...model, loads, memberLoads };
}

function readSupportRestraints(value: Record<string, unknown>): Frame3DSupportRestraints {
  if (SUPPORT_DOF.some((axis) => typeof value[axis] !== "boolean")) {
    throw new Error("Een 3D-oplegging moet zes geldige vrijheidsgraden hebben.");
  }
  return Object.fromEntries(SUPPORT_DOF.map((axis) => [axis, value[axis]])) as unknown as Frame3DSupportRestraints;
}

function readSupportSprings(value: unknown): Frame3DSupportSprings | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Een 3D-oplegging bevat ongeldige veerstijfheden.");
  }
  const raw = value as Record<string, unknown>;
  const springs: Frame3DSupportSprings = {};
  for (const key of SPRING_DOF) {
    const stiffness = raw[key];
    if (stiffness === undefined) continue;
    if (typeof stiffness !== "number" || !Number.isFinite(stiffness) || stiffness <= 0) {
      throw new Error(`Een 3D-oplegging bevat een ongeldige positieve veerstijfheid ${key}.`);
    }
    springs[key] = stiffness;
  }
  return Object.keys(springs).length > 0 ? springs : undefined;
}

function readPrescribedDisplacements(value: unknown): Frame3DPrescribedDisplacements | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Een 3D-oplegging bevat ongeldige opgelegde verplaatsingen.");
  }
  const raw = value as Record<string, unknown>;
  const prescribed: Frame3DPrescribedDisplacements = {};
  for (const key of PRESCRIBED_DOF) {
    const displacement = raw[key];
    if (displacement === undefined) continue;
    if (typeof displacement !== "number" || !Number.isFinite(displacement)) {
      throw new Error(`Een 3D-oplegging bevat een ongeldige opgelegde waarde ${key}.`);
    }
    if (displacement !== 0) prescribed[key] = displacement;
  }
  return Object.keys(prescribed).length > 0 ? prescribed : undefined;
}

function readNodalLoadComponents(value: Record<string, unknown>): Frame3DNodalLoadComponents {
  if (LOAD_DOF.some((axis) => typeof value[axis] !== "number" || !Number.isFinite(value[axis])) ||
      !LOAD_DOF.some((axis) => value[axis] !== 0)) {
    throw new Error("Een 3D-knoopbelasting moet zes eindige componenten en minstens één niet-nulwaarde hebben.");
  }
  return Object.fromEntries(LOAD_DOF.map((axis) => [axis, value[axis]])) as unknown as Frame3DNodalLoadComponents;
}

function requireNode(model: Frame3DModel, nodeId: number) {
  if (!model.nodes.some((node) => node.id === nodeId)) {
    throw new Error(`3D-knoop ${nodeId} bestaat niet.`);
  }
}

function beamLength(model: Frame3DModel, beamId: number): number {
  const beam = model.beams.find((item) => item.id === beamId);
  if (!beam) throw new Error(`3D-staaf ${beamId} bestaat niet.`);
  const start = model.nodes.find((node) => node.id === beam.startNodeId)!;
  const end = model.nodes.find((node) => node.id === beam.endNodeId)!;
  return Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
}

function readMemberLoad(
  value: Record<string, unknown>, model: Frame3DModel, id: number, beamId: number,
): Frame3DMemberLoad {
  const components = ["qyStart", "qyEnd", "qzStart", "qzEnd"] as const;
  if (components.some((name) => typeof value[name] !== "number" || !Number.isFinite(value[name])) ||
      components.every((name) => value[name] === 0)) {
    throw new Error("Een 3D-staafbelasting moet vier eindige componenten en minstens één niet-nulwaarde hebben.");
  }
  const length = beamLength(model, beamId);
  const startPositionM = Number(value.startPositionM);
  const endPositionM = Number(value.endPositionM);
  if (!Number.isFinite(startPositionM) || !Number.isFinite(endPositionM) ||
      startPositionM < 0 || endPositionM <= startPositionM || endPositionM > length + 1e-9) {
    throw new Error(`Een 3D-staafbelasting moet binnen de staaflengte van ${length} m liggen.`);
  }
  const caseId = readOptionalCaseId(value.caseId);
  return {
    id, beamId, ...(caseId !== undefined ? { caseId } : {}),
    qyStart: Number(value.qyStart), qyEnd: Number(value.qyEnd),
    qzStart: Number(value.qzStart), qzEnd: Number(value.qzEnd),
    startPositionM, endPositionM,
  };
}

function readMemberPointLoad(
  value: Record<string, unknown>, model: Frame3DModel, id: number, beamId: number,
): Frame3DMemberPointLoad {
  const py = Number(value.py), pz = Number(value.pz), positionM = Number(value.positionM);
  if (![py, pz].every(Number.isFinite) || (py === 0 && pz === 0)) {
    throw new Error("Een 3D-staafpuntlast moet twee eindige componenten en minstens één niet-nulwaarde hebben.");
  }
  const length = beamLength(model, beamId);
  if (!Number.isFinite(positionM) || positionM < 0 || positionM > length + 1e-9) {
    throw new Error(`Een 3D-staafpuntlast moet binnen de staaflengte van ${length} m liggen.`);
  }
  const caseId = readOptionalCaseId(value.caseId);
  return { id, beamId, ...(caseId !== undefined ? { caseId } : {}), py, pz, positionM };
}

function readThermalLoad(
  value: Record<string, unknown>, model: Frame3DModel, id: number, beamId: number,
): Frame3DThermalLoad {
  beamLength(model, beamId);
  const deltaTUniformK = Number(value.deltaTUniformK);
  const deltaTGradientYK = Number(value.deltaTGradientYK ?? 0);
  const deltaTGradientZK = Number(value.deltaTGradientZK ?? 0);
  if (![deltaTUniformK, deltaTGradientYK, deltaTGradientZK].every(Number.isFinite) ||
      [deltaTUniformK, deltaTGradientYK, deltaTGradientZK].every((component) => component === 0)) {
    throw new Error("Een 3D-temperatuurbelasting moet eindige waarden en minstens één niet-nulwaarde hebben.");
  }
  const caseId = readOptionalCaseId(value.caseId);
  return { id, beamId, ...(caseId !== undefined ? { caseId } : {}), deltaTUniformK, deltaTGradientYK, deltaTGradientZK };
}

function readPlateNodeLoop(value: unknown, nodeIds: Set<number>, label: string): number[] {
  if (!Array.isArray(value) || value.length < 3) throw new Error(`${label} moet minstens drie hoekknopen hebben.`);
  const result = value.map(Number);
  if (result.some((id, index) => !Number.isSafeInteger(id) || !nodeIds.has(id) || result.indexOf(id) !== index)) {
    throw new Error(`${label} bevat een ongeldige, ontbrekende of dubbele knoop.`);
  }
  return result;
}

function readPlateBoundary(
  value: unknown, loop: number[], nodeIds: Set<number>, label: string,
): Frame3DPlateBoundarySegment[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 2) throw new Error(`${label} bevat geen geldige getekende contour.`);
  const segments = value.map((raw, index): Frame3DPlateBoundarySegment => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${label} bevat een ongeldig randsegment.`);
    const segment = raw as Record<string, unknown>;
    const startNodeId = Number(segment.startNodeId), endNodeId = Number(segment.endNodeId);
    if (!nodeIds.has(startNodeId) || !nodeIds.has(endNodeId) || startNodeId === endNodeId ||
        !loop.includes(startNodeId) || !loop.includes(endNodeId)) {
      throw new Error(`${label} bevat een randsegment met een ongeldige knoopverwijzing.`);
    }
    if (segment.kind === "line") return { kind: "line", startNodeId, endNodeId };
    if (segment.kind === "arc") {
      const controlNodeId = Number(segment.controlNodeId);
      if (!nodeIds.has(controlNodeId) || !loop.includes(controlNodeId) ||
          controlNodeId === startNodeId || controlNodeId === endNodeId) {
        throw new Error(`${label} bevat een boog met een ongeldige stuurknoop.`);
      }
      return { kind: "arc", startNodeId, controlNodeId, endNodeId };
    }
    throw new Error(`${label} bevat een onbekend randsegment op positie ${index + 1}.`);
  });
  for (let index = 0; index < segments.length; index += 1) {
    const current = segments[index], next = segments[(index + 1) % segments.length];
    if (current.endNodeId !== next.startNodeId) throw new Error(`${label} moet één aansluitende gesloten contour vormen.`);
  }
  return segments;
}

function validatePlatePlane(nodes: Frame3DNode[], nodeIds: number[], label: string): void {
  const points = nodeIds.map((id) => nodes.find((node) => node.id === id)!);
  const a = points[0];
  let normal: [number, number, number] | null = null;
  for (let index = 1; index < points.length - 1 && !normal; index += 1) {
    const b = points[index], c = points[index + 1];
    const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
    const ac = [c.x - a.x, c.y - a.y, c.z - a.z];
    const candidate: [number, number, number] = [
      ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0],
    ];
    if (Math.hypot(...candidate) > 1e-10) normal = candidate;
  }
  if (!normal) throw new Error(`${label} heeft geen oppervlakte.`);
  const length = Math.hypot(...normal);
  const scale = Math.max(1, ...points.map((point) => Math.hypot(point.x - a.x, point.y - a.y, point.z - a.z)));
  if (points.some((point) => Math.abs((point.x - a.x) * normal![0] + (point.y - a.y) * normal![1] + (point.z - a.z) * normal![2]) / length > scale * 1e-7)) {
    throw new Error(`${label} moet vlak zijn.`);
  }
}

/** Reject malformed geometry at the file boundary instead of showing a partial model. */
export function parseFrame3DModel(value: unknown): Frame3DModel {
  if (value === undefined) return { nodes: [], beams: [] };
  if (!value || typeof value !== "object") throw new Error("Het 3D-model is geen object.");
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.beams)) {
    throw new Error("Het 3D-model mist de lijsten nodes en beams.");
  }
  const nodes: Frame3DNode[] = [];
  const nodeIds = new Set<number>();
  for (const item of raw.nodes) {
    if (!item || typeof item !== "object") throw new Error("Het 3D-model bevat een ongeldige knoop.");
    const node = item as Record<string, unknown>;
    if (!Number.isSafeInteger(node.id) || Number(node.id) <= 0 ||
        ![node.x, node.y, node.z].every((n) => typeof n === "number" && Number.isFinite(n)) ||
        nodeIds.has(Number(node.id))) {
      throw new Error("Het 3D-model bevat een knoop met ongeldige of dubbele id/coördinaten.");
    }
    const id = Number(node.id);
    nodes.push({ id, x: Number(node.x), y: Number(node.y), z: Number(node.z) });
    nodeIds.add(id);
  }
  const beams: Frame3DBeam[] = [];
  const beamIds = new Set<number>();
  for (const item of raw.beams) {
    if (!item || typeof item !== "object") throw new Error("Het 3D-model bevat een ongeldige staaf.");
    const beam = item as Record<string, unknown>;
    const id = Number(beam.id);
    const startNodeId = Number(beam.startNodeId);
    const endNodeId = Number(beam.endNodeId);
    if (!Number.isSafeInteger(beam.id) || id <= 0 || beamIds.has(id) ||
        !Number.isSafeInteger(beam.startNodeId) || !Number.isSafeInteger(beam.endNodeId) ||
        !nodeIds.has(startNodeId) || !nodeIds.has(endNodeId) || startNodeId === endNodeId) {
      throw new Error("Het 3D-model bevat een staaf met ongeldige id of knoopverwijzing.");
    }
    const start = nodes.find((node) => node.id === startNodeId)!;
    const end = nodes.find((node) => node.id === endNodeId)!;
    if (start.x === end.x && start.y === end.y && start.z === end.z) {
      throw new Error("Het 3D-model bevat een staaf zonder lengte.");
    }
    beams.push({
      id,
      startNodeId,
      endNodeId,
      ...(typeof beam.profileName === "string" && beam.profileName.trim() ? { profileName: beam.profileName.trim() } : {}),
      ...(typeof beam.material === "string" && beam.material.trim() ? { material: beam.material.trim() } : {}),
      ...(beam.checkConfig && typeof beam.checkConfig === "object" && !Array.isArray(beam.checkConfig)
        ? { checkConfig: beam.checkConfig as BeamCheckConfig }
        : {}),
      ...(beam.rollAngleRad !== undefined
        ? typeof beam.rollAngleRad === "number" && Number.isFinite(beam.rollAngleRad)
          ? { rollAngleRad: beam.rollAngleRad }
          : (() => { throw new Error("Een 3D-staaf bevat een ongeldige profielrotatie."); })()
        : {}),
      ...(beam.releases !== undefined ? { releases: readEndReleases(beam.releases)! } : {}),
    });
    beamIds.add(id);
  }
  const plates: Frame3DPlate[] = [];
  const plateIds = new Set<number>();
  if (raw.plates !== undefined && !Array.isArray(raw.plates)) throw new Error("Het 3D-model bevat geen geldige lijst plates.");
  for (const item of (raw.plates ?? []) as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Het 3D-model bevat een ongeldige plaat.");
    const plate = item as Record<string, unknown>;
    const id = Number(plate.id);
    if (!Number.isSafeInteger(plate.id) || id <= 0 || plateIds.has(id)) throw new Error("Het 3D-model bevat een plaat met een ongeldige of dubbele id.");
    const loop = readPlateNodeLoop(plate.nodeIds, nodeIds, `3D-plaat ${id}`);
    validatePlatePlane(nodes, loop, `3D-plaat ${id}`);
    const boundary = readPlateBoundary(plate.boundary, loop, nodeIds, `3D-plaat ${id}`);
    const thicknessM = Number(plate.thicknessM ?? 0.2);
    const cornerRadiusM = Number(plate.cornerRadiusM ?? 0);
    if (!(thicknessM > 0) || !Number.isFinite(thicknessM) || cornerRadiusM < 0 || !Number.isFinite(cornerRadiusM)) {
      throw new Error(`3D-plaat ${id} heeft een ongeldige dikte of randstraal.`);
    }
    const openingIds = new Set<number>();
    const openings: Frame3DPlateOpening[] = [];
    if (plate.openings !== undefined && !Array.isArray(plate.openings)) throw new Error(`3D-plaat ${id} bevat geen geldige lijst openingen.`);
    for (const rawOpening of (plate.openings ?? []) as unknown[]) {
      if (!rawOpening || typeof rawOpening !== "object" || Array.isArray(rawOpening)) throw new Error(`3D-plaat ${id} bevat een ongeldige opening.`);
      const opening = rawOpening as Record<string, unknown>;
      const openingId = Number(opening.id);
      if (!Number.isSafeInteger(opening.id) || openingId <= 0 || openingIds.has(openingId)) throw new Error(`3D-plaat ${id} bevat een opening met ongeldige of dubbele id.`);
      const openingLoop = readPlateNodeLoop(opening.nodeIds, nodeIds, `Opening ${openingId} van 3D-plaat ${id}`);
      validatePlatePlane(nodes, openingLoop, `Opening ${openingId} van 3D-plaat ${id}`);
      const openingBoundary = readPlateBoundary(opening.boundary, openingLoop, nodeIds, `Opening ${openingId} van 3D-plaat ${id}`);
      const openingRadius = Number(opening.cornerRadiusM ?? 0);
      if (openingRadius < 0 || !Number.isFinite(openingRadius)) throw new Error(`Opening ${openingId} heeft een ongeldige randstraal.`);
      openings.push({ id: openingId, nodeIds: openingLoop,
        ...(openingBoundary ? { boundary: openingBoundary } : {}),
        ...(openingRadius > 0 ? { cornerRadiusM: openingRadius } : {}) });
      openingIds.add(openingId);
    }
    plates.push({ id, nodeIds: loop, thicknessM,
      ...(boundary ? { boundary } : {}),
      ...(typeof plate.material === "string" && plate.material.trim() ? { material: plate.material.trim() } : {}),
      ...(cornerRadiusM > 0 ? { cornerRadiusM } : {}), ...(openings.length ? { openings } : {}) });
    plateIds.add(id);
  }
  const supports: Frame3DSupport[] = [];
  const supportedNodes = new Set<number>();
  if (raw.supports !== undefined && !Array.isArray(raw.supports)) {
    throw new Error("Het 3D-model bevat geen geldige lijst supports.");
  }
  for (const item of (raw.supports ?? []) as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Het 3D-model bevat een ongeldige oplegging.");
    }
    const support = item as Record<string, unknown>;
    const nodeId = Number(support.nodeId);
    if (!Number.isSafeInteger(support.nodeId) || !nodeIds.has(nodeId) || supportedNodes.has(nodeId)) {
      throw new Error("Het 3D-model bevat een oplegging met ongeldige, dubbele of ontbrekende knoopverwijzing.");
    }
    const restraints = readSupportRestraints(support);
    const springs = readSupportSprings(support.springs);
    const prescribed = readPrescribedDisplacements(support.prescribed);
    if (!SUPPORT_DOF.some((axis) => restraints[axis]) && !springs) {
      throw new Error("Een 3D-oplegging moet minstens één vrijheidsgraad blokkeren of veren.");
    }
    for (let index = 0; index < SUPPORT_DOF.length; index += 1) {
      if (restraints[SUPPORT_DOF[index]] && springs?.[SPRING_DOF[index]] !== undefined) {
        throw new Error("Een 3D-oplegging kan dezelfde vrijheidsgraad niet tegelijk blokkeren en veren.");
      }
      if (prescribed?.[PRESCRIBED_DOF[index]] !== undefined && !restraints[SUPPORT_DOF[index]]) {
        throw new Error("Een opgelegde 3D-verplaatsing vereist een geblokkeerde vrijheidsgraad.");
      }
    }
    supports.push({ nodeId, ...restraints, ...(springs ? { springs } : {}), ...(prescribed ? { prescribed } : {}) });
    supportedNodes.add(nodeId);
  }

  const loads: Frame3DNodalLoad[] = [];
  const loadIds = new Set<number>();
  if (raw.loads !== undefined && !Array.isArray(raw.loads)) {
    throw new Error("Het 3D-model bevat geen geldige lijst loads.");
  }
  for (const item of (raw.loads ?? []) as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Het 3D-model bevat een ongeldige knoopbelasting.");
    }
    const load = item as Record<string, unknown>;
    const id = Number(load.id);
    const nodeId = Number(load.nodeId);
    if (!Number.isSafeInteger(load.id) || id <= 0 || loadIds.has(id) ||
        !Number.isSafeInteger(load.nodeId) || !nodeIds.has(nodeId)) {
      throw new Error("Het 3D-model bevat een knoopbelasting met ongeldige, dubbele of ontbrekende knoopverwijzing.");
    }
    const caseId = readOptionalCaseId(load.caseId);
    loads.push({ id, nodeId, ...readNodalLoadComponents(load), ...(caseId !== undefined ? { caseId } : {}) });
    loadIds.add(id);
  }
  const model: Frame3DModel = {
    nodes, beams, ...(raw.plates !== undefined ? { plates } : {}), supports, loads,
    ...(raw.memberLoads !== undefined ? { memberLoads: [] } : {}),
    ...(raw.memberPointLoads !== undefined ? { memberPointLoads: [] } : {}),
    ...(raw.thermalLoads !== undefined ? { thermalLoads: [] } : {}),
    ...(raw.surfaceLoads !== undefined ? { surfaceLoads: [] } : {}),
  };
  const memberLoadIds = new Set<number>();
  if (raw.memberLoads !== undefined && !Array.isArray(raw.memberLoads)) {
    throw new Error("Het 3D-model bevat geen geldige lijst memberLoads.");
  }
  for (const item of (raw.memberLoads ?? []) as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Het 3D-model bevat een ongeldige staafbelasting.");
    }
    const load = item as Record<string, unknown>;
    const id = Number(load.id);
    const beamId = Number(load.beamId);
    if (!Number.isSafeInteger(load.id) || id <= 0 || memberLoadIds.has(id) ||
        !Number.isSafeInteger(load.beamId) || !beamIds.has(beamId)) {
      throw new Error("Het 3D-model bevat een staafbelasting met ongeldige, dubbele of ontbrekende staafverwijzing.");
    }
    model.memberLoads!.push(readMemberLoad(load, model, id, beamId));
    memberLoadIds.add(id);
  }
  const memberPointLoadIds = new Set<number>();
  if (raw.memberPointLoads !== undefined && !Array.isArray(raw.memberPointLoads)) {
    throw new Error("Het 3D-model bevat geen geldige lijst memberPointLoads.");
  }
  for (const item of (raw.memberPointLoads ?? []) as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Het 3D-model bevat een ongeldige staafpuntlast.");
    }
    const load = item as Record<string, unknown>;
    const id = Number(load.id), beamId = Number(load.beamId);
    if (!Number.isSafeInteger(load.id) || id <= 0 || memberPointLoadIds.has(id) ||
        !Number.isSafeInteger(load.beamId) || !beamIds.has(beamId)) {
      throw new Error("Het 3D-model bevat een staafpuntlast met ongeldige, dubbele of ontbrekende staafverwijzing.");
    }
    model.memberPointLoads!.push(readMemberPointLoad(load, model, id, beamId));
    memberPointLoadIds.add(id);
  }
  const thermalLoadIds = new Set<number>();
  if (raw.thermalLoads !== undefined && !Array.isArray(raw.thermalLoads)) {
    throw new Error("Het 3D-model bevat geen geldige lijst thermalLoads.");
  }
  for (const item of (raw.thermalLoads ?? []) as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Het 3D-model bevat een ongeldige temperatuurbelasting.");
    }
    const load = item as Record<string, unknown>;
    const id = Number(load.id), beamId = Number(load.beamId);
    if (!Number.isSafeInteger(load.id) || id <= 0 || thermalLoadIds.has(id) ||
        !Number.isSafeInteger(load.beamId) || !beamIds.has(beamId)) {
      throw new Error("Het 3D-model bevat een temperatuurbelasting met ongeldige, dubbele of ontbrekende staafverwijzing.");
    }
    model.thermalLoads!.push(readThermalLoad(load, model, id, beamId));
    thermalLoadIds.add(id);
  }
  const surfaceLoadIds = new Set<number>();
  if (raw.surfaceLoads !== undefined && !Array.isArray(raw.surfaceLoads)) throw new Error("Het 3D-model bevat geen geldige lijst surfaceLoads.");
  for (const item of (raw.surfaceLoads ?? []) as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Het 3D-model bevat een ongeldige oppervlaktebelasting.");
    const load = item as Record<string, unknown>;
    const id = Number(load.id), plateId = Number(load.plateId);
    const qx = Number(load.qx ?? 0), qy = Number(load.qy ?? 0), qz = Number(load.qz ?? 0);
    if (!Number.isSafeInteger(load.id) || id <= 0 || surfaceLoadIds.has(id) || !Number.isSafeInteger(load.plateId) || !plateIds.has(plateId) ||
        ![qx, qy, qz].every(Number.isFinite) || [qx, qy, qz].every((component) => component === 0)) {
      throw new Error("Het 3D-model bevat een oppervlaktebelasting met ongeldige waarden of plaatverwijzing.");
    }
    const caseId = readOptionalCaseId(load.caseId);
    model.surfaceLoads!.push({ id, plateId, ...(caseId !== undefined ? { caseId } : {}), qx, qy, qz });
    surfaceLoadIds.add(id);
  }
  return model;
}

export function setFrame3DSupport(
  model: Frame3DModel, nodeId: number, restraints: Frame3DSupportRestraints,
): Frame3DModel {
  requireNode(model, nodeId);
  const previous = model.supports ?? [];
  const existing = previous.find((item) => item.nodeId === nodeId);
  const parsed = readSupportRestraints(restraints as unknown as Record<string, unknown>);
  const springs = existing?.springs ? { ...existing.springs } : undefined;
  const prescribed = existing?.prescribed ? { ...existing.prescribed } : undefined;
  for (let index = 0; index < SUPPORT_DOF.length; index += 1) {
    if (parsed[SUPPORT_DOF[index]]) {
      if (springs) delete springs[SPRING_DOF[index]];
    } else if (prescribed) {
      delete prescribed[PRESCRIBED_DOF[index]];
    }
  }
  const support: Frame3DSupport = {
    nodeId, ...parsed,
    ...(springs && Object.keys(springs).length > 0 ? { springs } : {}),
    ...(prescribed && Object.keys(prescribed).length > 0 ? { prescribed } : {}),
  };
  return {
    ...model,
    supports: previous.some((item) => item.nodeId === nodeId)
      ? previous.map((item) => item.nodeId === nodeId ? support : item)
      : [...previous, support],
  };
}

/** Zet de zes globale oplegveren en maakt de bijbehorende vaste DOF vrij. */
export function setFrame3DSupportSprings(
  model: Frame3DModel, nodeId: number, springs: Frame3DSupportSprings,
): Frame3DModel {
  requireNode(model, nodeId);
  const parsed = readSupportSprings(springs);
  const previous = model.supports ?? [];
  const existing = previous.find((item) => item.nodeId === nodeId);
  const restraints: Frame3DSupportRestraints = existing
    ? Object.fromEntries(SUPPORT_DOF.map((axis) => [axis, existing[axis]])) as unknown as Frame3DSupportRestraints
    : { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };
  const prescribed = existing?.prescribed ? { ...existing.prescribed } : undefined;
  for (let index = 0; index < SUPPORT_DOF.length; index += 1) {
    if (parsed?.[SPRING_DOF[index]] !== undefined) {
      restraints[SUPPORT_DOF[index]] = false;
      if (prescribed) delete prescribed[PRESCRIBED_DOF[index]];
    }
  }
  if (!parsed && !SUPPORT_DOF.some((axis) => restraints[axis])) return removeFrame3DSupport(model, nodeId);
  const support: Frame3DSupport = {
    nodeId, ...restraints,
    ...(parsed ? { springs: parsed } : {}),
    ...(prescribed && Object.keys(prescribed).length > 0 ? { prescribed } : {}),
  };
  return {
    ...model,
    supports: existing
      ? previous.map((item) => item.nodeId === nodeId ? support : item)
      : [...previous, support],
  };
}

/** Zet opgelegde waarden op globale DOF's en blokkeert die DOF's automatisch. */
export function setFrame3DSupportPrescribed(
  model: Frame3DModel, nodeId: number, values: Frame3DPrescribedDisplacements,
): Frame3DModel {
  requireNode(model, nodeId);
  const prescribed = readPrescribedDisplacements(values);
  const previous = model.supports ?? [];
  const existing = previous.find((item) => item.nodeId === nodeId);
  if (!existing && !prescribed) return model;
  const restraints: Frame3DSupportRestraints = existing
    ? Object.fromEntries(SUPPORT_DOF.map((axis) => [axis, existing[axis]])) as unknown as Frame3DSupportRestraints
    : { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };
  const springs = existing?.springs ? { ...existing.springs } : undefined;
  for (let index = 0; index < SUPPORT_DOF.length; index += 1) {
    if (prescribed?.[PRESCRIBED_DOF[index]] !== undefined) {
      restraints[SUPPORT_DOF[index]] = true;
      if (springs) delete springs[SPRING_DOF[index]];
    }
  }
  const support: Frame3DSupport = {
    nodeId, ...restraints,
    ...(springs && Object.keys(springs).length > 0 ? { springs } : {}),
    ...(prescribed ? { prescribed } : {}),
  };
  return {
    ...model,
    supports: existing
      ? previous.map((item) => item.nodeId === nodeId ? support : item)
      : [...previous, support],
  };
}

export function removeFrame3DSupport(model: Frame3DModel, nodeId: number): Frame3DModel {
  return { ...model, supports: (model.supports ?? []).filter((item) => item.nodeId !== nodeId) };
}

export function addFrame3DNodalLoad(
  model: Frame3DModel, nodeId: number, components: Frame3DNodalLoadComponents, caseId?: number,
): Frame3DModel {
  requireNode(model, nodeId);
  const values = readNodalLoadComponents(components as unknown as Record<string, unknown>);
  const validCaseId = readOptionalCaseId(caseId);
  const previous = model.loads ?? [];
  const id = Math.max(0, ...previous.map((load) => load.id)) + 1;
  return { ...model, loads: [...previous, { id, nodeId, ...values, ...(validCaseId !== undefined ? { caseId: validCaseId } : {}) }] };
}

export function updateFrame3DNodalLoad(
  model: Frame3DModel, loadId: number, components: Frame3DNodalLoadComponents,
): Frame3DModel {
  const previous = model.loads ?? [];
  if (!previous.some((load) => load.id === loadId)) throw new Error(`3D-knoopbelasting ${loadId} bestaat niet.`);
  const values = readNodalLoadComponents(components as unknown as Record<string, unknown>);
  return {
    ...model,
    loads: previous.map((load) => load.id === loadId ? { ...load, ...values } : load),
  };
}

export function removeFrame3DNodalLoad(model: Frame3DModel, loadId: number): Frame3DModel {
  return { ...model, loads: (model.loads ?? []).filter((load) => load.id !== loadId) };
}

export function addFrame3DMemberLoad(
  model: Frame3DModel,
  beamId: number,
  values: Omit<Frame3DMemberLoad, "id" | "beamId" | "caseId">,
  caseId?: number,
): Frame3DModel {
  const previous = model.memberLoads ?? [];
  const id = Math.max(0, ...previous.map((load) => load.id)) + 1;
  const load = readMemberLoad({ ...values, ...(caseId !== undefined ? { caseId } : {}) } as unknown as Record<string, unknown>, model, id, beamId);
  return { ...model, memberLoads: [...previous, load] };
}

export function updateFrame3DMemberLoad(
  model: Frame3DModel,
  loadId: number,
  values: Omit<Frame3DMemberLoad, "id" | "beamId" | "caseId">,
): Frame3DModel {
  const previous = model.memberLoads ?? [];
  const old = previous.find((load) => load.id === loadId);
  if (!old) throw new Error(`3D-staafbelasting ${loadId} bestaat niet.`);
  const load = readMemberLoad({ ...values, ...(old.caseId !== undefined ? { caseId: old.caseId } : {}) } as unknown as Record<string, unknown>, model, loadId, old.beamId);
  return { ...model, memberLoads: previous.map((item) => item.id === loadId ? load : item) };
}

export function removeFrame3DMemberLoad(model: Frame3DModel, loadId: number): Frame3DModel {
  return { ...model, memberLoads: (model.memberLoads ?? []).filter((load) => load.id !== loadId) };
}

export function addFrame3DMemberPointLoad(
  model: Frame3DModel,
  beamId: number,
  values: Omit<Frame3DMemberPointLoad, "id" | "beamId" | "caseId">,
  caseId?: number,
): Frame3DModel {
  const previous = model.memberPointLoads ?? [];
  const id = Math.max(0, ...previous.map((load) => load.id)) + 1;
  const load = readMemberPointLoad(
    { ...values, ...(caseId !== undefined ? { caseId } : {}) } as unknown as Record<string, unknown>,
    model, id, beamId,
  );
  return { ...model, memberPointLoads: [...previous, load] };
}

export function updateFrame3DMemberPointLoad(
  model: Frame3DModel,
  loadId: number,
  values: Omit<Frame3DMemberPointLoad, "id" | "beamId" | "caseId">,
): Frame3DModel {
  const previous = model.memberPointLoads ?? [];
  const old = previous.find((load) => load.id === loadId);
  if (!old) throw new Error(`3D-staafpuntlast ${loadId} bestaat niet.`);
  const load = readMemberPointLoad(
    { ...values, ...(old.caseId !== undefined ? { caseId: old.caseId } : {}) } as unknown as Record<string, unknown>,
    model, loadId, old.beamId,
  );
  return { ...model, memberPointLoads: previous.map((item) => item.id === loadId ? load : item) };
}

export function removeFrame3DMemberPointLoad(model: Frame3DModel, loadId: number): Frame3DModel {
  return { ...model, memberPointLoads: (model.memberPointLoads ?? []).filter((load) => load.id !== loadId) };
}

export function addFrame3DThermalLoad(
  model: Frame3DModel,
  beamId: number,
  values: Omit<Frame3DThermalLoad, "id" | "beamId" | "caseId">,
  caseId?: number,
): Frame3DModel {
  const previous = model.thermalLoads ?? [];
  const id = Math.max(0, ...previous.map((load) => load.id)) + 1;
  const load = readThermalLoad(
    { ...values, ...(caseId !== undefined ? { caseId } : {}) } as unknown as Record<string, unknown>,
    model, id, beamId,
  );
  return { ...model, thermalLoads: [...previous, load] };
}

export function updateFrame3DThermalLoad(
  model: Frame3DModel,
  loadId: number,
  values: Omit<Frame3DThermalLoad, "id" | "beamId" | "caseId">,
): Frame3DModel {
  const previous = model.thermalLoads ?? [];
  const old = previous.find((load) => load.id === loadId);
  if (!old) throw new Error(`3D-temperatuurbelasting ${loadId} bestaat niet.`);
  const load = readThermalLoad(
    { ...values, ...(old.caseId !== undefined ? { caseId: old.caseId } : {}) } as unknown as Record<string, unknown>,
    model, loadId, old.beamId,
  );
  return { ...model, thermalLoads: previous.map((item) => item.id === loadId ? load : item) };
}

export function removeFrame3DThermalLoad(model: Frame3DModel, loadId: number): Frame3DModel {
  return { ...model, thermalLoads: (model.thermalLoads ?? []).filter((load) => load.id !== loadId) };
}

/** Reconnect a member while preserving its loads, section, releases and checks. */
export function setFrame3DBeamNodes(
  model: Frame3DModel,
  beamId: number,
  startNodeId: number,
  endNodeId: number,
): Frame3DModel {
  const beam = model.beams.find((item) => item.id === beamId);
  if (!beam) throw new Error(`3D-staaf ${beamId} bestaat niet.`);
  const start = model.nodes.find((node) => node.id === startNodeId);
  const end = model.nodes.find((node) => node.id === endNodeId);
  if (!start || !end) throw new Error("Begin- en eindknoop moeten bestaande 3D-knopen zijn.");
  if (startNodeId === endNodeId || (start.x === end.x && start.y === end.y && start.z === end.z)) {
    throw new Error("Een 3D-staaf moet twee verschillende knopen met een niet-nulle lengte verbinden.");
  }
  return {
    ...model,
    beams: model.beams.map((item) => item.id === beamId
      ? { ...item, startNodeId, endNodeId }
      : item),
  };
}

export interface Frame3DBeamSplitResult {
  model: Frame3DModel;
  nodeId: number;
  firstBeamId: number;
  secondBeamId: number;
}

const RIGID_FRAME3D_END: Frame3DEndReleases = {
  myStart: false, myEnd: false,
  mzStart: false, mzEnd: false,
  torsionStart: false, torsionEnd: false,
};

/**
 * Knip een staaf op een relatieve positie. De oorspronkelijke staaf-id blijft
 * bij het eerste deel, zodat verwijzingen zo stabiel mogelijk blijven.
 *
 * Lokale staaflasten behouden hun resulterende: trapeziumlasten worden op het
 * knippunt geïnterpoleerd, puntlasten worden naar het juiste kind verplaatst
 * en temperatuurbelasting geldt voor beide delen. Alleen de oorspronkelijke
 * buitenste eindvrijgaven blijven bestaan; de nieuwe tussenknoop is star.
 */
export function splitFrame3DBeam(
  model: Frame3DModel,
  beamId: number,
  ratio: number,
): Frame3DBeamSplitResult {
  const beam = model.beams.find((item) => item.id === beamId);
  if (!beam) throw new Error(`3D-staaf ${beamId} bestaat niet.`);
  if (!Number.isFinite(ratio) || ratio <= 1e-6 || ratio >= 1 - 1e-6) {
    throw new Error("De subknoop moet binnen de 3D-staaf liggen.");
  }
  const start = model.nodes.find((node) => node.id === beam.startNodeId);
  const end = model.nodes.find((node) => node.id === beam.endNodeId);
  if (!start || !end) throw new Error("De 3D-staaf verwijst naar een ontbrekende knoop.");
  const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  if (length <= 1e-12) throw new Error("Een 3D-staaf zonder lengte kan niet worden geknipt.");

  const splitPoint = {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
    z: start.z + (end.z - start.z) * ratio,
  };
  const existingNode = model.nodes.find((node) =>
    node.id !== start.id && node.id !== end.id &&
    Math.hypot(node.x - splitPoint.x, node.y - splitPoint.y, node.z - splitPoint.z) <= 1e-8);
  const nodeId = existingNode?.id ?? Math.max(0, ...model.nodes.map((node) => node.id)) + 1;
  const secondBeamId = Math.max(0, ...model.beams.map((item) => item.id)) + 1;
  const duplicateSegment = model.beams.find((item) => item.id !== beamId && (
    (item.startNodeId === beam.startNodeId && item.endNodeId === nodeId) ||
    (item.startNodeId === nodeId && item.endNodeId === beam.startNodeId) ||
    (item.startNodeId === nodeId && item.endNodeId === beam.endNodeId) ||
    (item.startNodeId === beam.endNodeId && item.endNodeId === nodeId)
  ));
  if (duplicateSegment) {
    throw new Error(`Splitsen zou 3D-staaf ${duplicateSegment.id} verdubbelen.`);
  }

  const originalReleases = beam.releases;
  const firstBeam: Frame3DBeam = {
    ...beam,
    endNodeId: nodeId,
    ...(originalReleases ? {
      releases: {
        ...RIGID_FRAME3D_END,
        myStart: originalReleases.myStart,
        mzStart: originalReleases.mzStart,
        torsionStart: originalReleases.torsionStart,
      },
    } : {}),
  };
  const secondBeam: Frame3DBeam = {
    ...beam,
    id: secondBeamId,
    startNodeId: nodeId,
    ...(originalReleases ? {
      releases: {
        ...RIGID_FRAME3D_END,
        myEnd: originalReleases.myEnd,
        mzEnd: originalReleases.mzEnd,
        torsionEnd: originalReleases.torsionEnd,
      },
    } : {}),
  };
  const beams = model.beams.flatMap((item) => item.id === beamId ? [firstBeam, secondBeam] : [item]);
  const splitDistance = ratio * length;

  let nextMemberLoadId = Math.max(0, ...(model.memberLoads ?? []).map((load) => load.id)) + 1;
  const memberLoads = (model.memberLoads ?? []).flatMap((load): Frame3DMemberLoad[] => {
    if (load.beamId !== beamId) return [load];
    if (load.endPositionM <= splitDistance) return [load];
    if (load.startPositionM >= splitDistance) {
      return [{
        ...load,
        beamId: secondBeamId,
        startPositionM: load.startPositionM - splitDistance,
        endPositionM: load.endPositionM - splitDistance,
      }];
    }
    const loadRatio = (splitDistance - load.startPositionM) /
      (load.endPositionM - load.startPositionM);
    const qyAtSplit = load.qyStart + (load.qyEnd - load.qyStart) * loadRatio;
    const qzAtSplit = load.qzStart + (load.qzEnd - load.qzStart) * loadRatio;
    return [
      { ...load, qyEnd: qyAtSplit, qzEnd: qzAtSplit, endPositionM: splitDistance },
      {
        ...load,
        id: nextMemberLoadId++,
        beamId: secondBeamId,
        qyStart: qyAtSplit,
        qzStart: qzAtSplit,
        startPositionM: 0,
        endPositionM: load.endPositionM - splitDistance,
      },
    ];
  });

  const memberPointLoads = (model.memberPointLoads ?? []).map((load): Frame3DMemberPointLoad => {
    if (load.beamId !== beamId || load.positionM < splitDistance) return load;
    return { ...load, beamId: secondBeamId, positionM: load.positionM - splitDistance };
  });

  let nextThermalLoadId = Math.max(0, ...(model.thermalLoads ?? []).map((load) => load.id)) + 1;
  const thermalLoads = (model.thermalLoads ?? []).flatMap((load): Frame3DThermalLoad[] =>
    load.beamId !== beamId
      ? [load]
      : [load, { ...load, id: nextThermalLoadId++, beamId: secondBeamId }]);

  return {
    model: {
      ...model,
      nodes: existingNode ? model.nodes : [...model.nodes, { id: nodeId, ...splitPoint }],
      beams,
      memberLoads,
      memberPointLoads,
      thermalLoads,
    },
    nodeId,
    firstBeamId: beamId,
    secondBeamId,
  };
}

export function removeFrame3DBeam(model: Frame3DModel, beamId: number): Frame3DModel {
  return {
    ...model,
    beams: model.beams.filter((beam) => beam.id !== beamId),
    memberLoads: (model.memberLoads ?? []).filter((load) => load.beamId !== beamId),
    memberPointLoads: (model.memberPointLoads ?? []).filter((load) => load.beamId !== beamId),
    thermalLoads: (model.thermalLoads ?? []).filter((load) => load.beamId !== beamId),
  };
}

export function addFrame3DPlate(
  model: Frame3DModel,
  nodeIds: number[],
  options: { thicknessM?: number; material?: string; cornerRadiusM?: number; boundary?: Frame3DPlateBoundarySegment[] } = {},
): Frame3DModel {
  const id = Math.max(0, ...(model.plates ?? []).map((plate) => plate.id)) + 1;
  return parseFrame3DModel({
    ...model,
    plates: [...(model.plates ?? []), {
      id, nodeIds, thicknessM: options.thicknessM ?? 0.2, material: options.material ?? "C30/37",
      ...(options.boundary?.length ? { boundary: options.boundary } : {}),
      ...(options.cornerRadiusM && options.cornerRadiusM > 0 ? { cornerRadiusM: options.cornerRadiusM } : {}),
    }],
  });
}

export function updateFrame3DPlate(
  model: Frame3DModel, plateId: number,
  patch: Partial<Pick<Frame3DPlate, "thicknessM" | "material" | "cornerRadiusM">>,
): Frame3DModel {
  if (!(model.plates ?? []).some((plate) => plate.id === plateId)) throw new Error(`3D-plaat ${plateId} bestaat niet.`);
  return parseFrame3DModel({ ...model, plates: (model.plates ?? []).map((plate) => plate.id === plateId ? { ...plate, ...patch } : plate) });
}

export function addFrame3DPlateOpening(
  model: Frame3DModel, plateId: number, nodeIds: number[], cornerRadiusM = 0,
): Frame3DModel {
  const plate = (model.plates ?? []).find((item) => item.id === plateId);
  if (!plate) throw new Error(`3D-plaat ${plateId} bestaat niet.`);
  const id = Math.max(0, ...(plate.openings ?? []).map((opening) => opening.id)) + 1;
  return parseFrame3DModel({
    ...model,
    plates: (model.plates ?? []).map((item) => item.id === plateId ? {
      ...item,
      openings: [...(item.openings ?? []), { id, nodeIds, ...(cornerRadiusM > 0 ? { cornerRadiusM } : {}) }],
    } : item),
  });
}

export function removeFrame3DPlate(model: Frame3DModel, plateId: number): Frame3DModel {
  return { ...model, plates: (model.plates ?? []).filter((plate) => plate.id !== plateId),
    surfaceLoads: (model.surfaceLoads ?? []).filter((load) => load.plateId !== plateId) };
}

export function addFrame3DSurfaceLoad(
  model: Frame3DModel, plateId: number, values: Pick<Frame3DSurfaceLoad, "qx" | "qy" | "qz">, caseId?: number,
): Frame3DModel {
  const id = Math.max(0, ...(model.surfaceLoads ?? []).map((load) => load.id)) + 1;
  return parseFrame3DModel({ ...model, surfaceLoads: [...(model.surfaceLoads ?? []), { id, plateId, ...values, ...(caseId ? { caseId } : {}) }] });
}

export function updateFrame3DSurfaceLoad(
  model: Frame3DModel, loadId: number, values: Pick<Frame3DSurfaceLoad, "qx" | "qy" | "qz">,
): Frame3DModel {
  if (!(model.surfaceLoads ?? []).some((load) => load.id === loadId)) throw new Error(`3D-oppervlaktebelasting ${loadId} bestaat niet.`);
  return parseFrame3DModel({ ...model, surfaceLoads: (model.surfaceLoads ?? []).map((load) => load.id === loadId ? { ...load, ...values } : load) });
}

export function removeFrame3DSurfaceLoad(model: Frame3DModel, loadId: number): Frame3DModel {
  return { ...model, surfaceLoads: (model.surfaceLoads ?? []).filter((load) => load.id !== loadId) };
}

/** Keep all other node conditions when one node is deleted. */
export function removeFrame3DNode(model: Frame3DModel, nodeId: number): Frame3DModel {
  const removedBeamIds = new Set(model.beams
    .filter((beam) => beam.startNodeId === nodeId || beam.endNodeId === nodeId)
    .map((beam) => beam.id));
  const removedPlateIds = new Set((model.plates ?? []).filter((plate) =>
    plate.nodeIds.includes(nodeId) || (plate.openings ?? []).some((opening) => opening.nodeIds.includes(nodeId)))
    .map((plate) => plate.id));
  return {
    ...model,
    nodes: model.nodes.filter((node) => node.id !== nodeId),
    beams: model.beams.filter((beam) => beam.startNodeId !== nodeId && beam.endNodeId !== nodeId),
    supports: (model.supports ?? []).filter((support) => support.nodeId !== nodeId),
    loads: (model.loads ?? []).filter((load) => load.nodeId !== nodeId),
    memberLoads: (model.memberLoads ?? []).filter((load) => !removedBeamIds.has(load.beamId)),
    memberPointLoads: (model.memberPointLoads ?? []).filter((load) => !removedBeamIds.has(load.beamId)),
    thermalLoads: (model.thermalLoads ?? []).filter((load) => !removedBeamIds.has(load.beamId)),
    plates: (model.plates ?? []).filter((plate) => !removedPlateIds.has(plate.id)),
    surfaceLoads: (model.surfaceLoads ?? []).filter((load) => !removedPlateIds.has(load.plateId)),
  };
}

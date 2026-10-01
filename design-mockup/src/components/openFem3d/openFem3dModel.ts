import type { BeamCheckConfig } from "../fem/femTypes";
import { dichtheidVanMateriaal, G, resolveSection } from "../../lib/sectionResolver";
import { sampleCircularArc3D, type ArcPoint3D } from "./openFem3dCircularArc";
import type { OpenFem3DSelection } from "./openFem3dSelection";
import { resolveOpenFem3DPlateMaterial } from "./openFem3dPlateMaterial";

/** Geometry for the 3D workspace. Coordinates are metres; Z is vertical, like 2D. */
export interface OpenFem3DNode {
  id: number;
  x: number;
  y: number;
  z: number;
  /**
   * Level waaraan de knoop gekoppeld is: het id van een horizontale
   * stramienas (`StructuralGrid.zAxes`). De knoop ligt dan op de hoogte van
   * dat level en schuift mee als die hoogte verandert (zie openFem3dLevels).
   * Ontbreekt in oude bestanden en bij een vrije knoop. Alleen modelinvoer:
   * de rekenkern krijgt het veld niet.
   */
  levelId?: string;
  /** Naam uit een bronmodel (bijvoorbeeld een IFC-analysemodel); alleen voor weergave en rapport. */
  name?: string;
}

export interface OpenFem3DBeam {
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
  releases?: OpenFem3DEndReleases;
  /**
   * Trek-alleen staaf, zoals een windverband van rond staal: zij telt alleen
   * mee zolang zij op trek staat. Komt zij in een belastinggeval of combinatie
   * op druk, dan valt zij voor die berekening weg (normaalkracht 0).
   */
  tensionOnly?: boolean;
  /** Naam uit een bronmodel (bijvoorbeeld een IFC-analysemodel); alleen voor weergave en rapport. */
  name?: string;
  /** Onderdeel of groep (kolom, vloerligger, windverband …); alleen voor weergave, selectie en rapport. */
  group?: string;
}

/**
 * Starre schijf in het horizontale vlak, zoals een kanaalplaatvloer met
 * druklaag: de knopen verplaatsen in X en Y en roteren om Z samen als één
 * star lichaam. De verticale verplaatsing en de rotaties om X en Y blijven per
 * knoop vrij. Alle knopen liggen op dezelfde hoogte.
 */
export interface OpenFem3DDiaphragm {
  id: number;
  /** Knopen die de schijf koppelt, minimaal twee. Een knoop hoort bij hoogstens één schijf. */
  nodeIds: number[];
  /** Naam voor weergave en rapport, bijvoorbeeld "Vloer +3.600". */
  name?: string;
}

export interface OpenFem3DEndReleases {
  myStart: boolean;
  myEnd: boolean;
  mzStart: boolean;
  mzEnd: boolean;
  torsionStart: boolean;
  torsionEnd: boolean;
}

/** True means that this global displacement or rotation is restrained. */
export interface OpenFem3DSupportRestraints {
  ux: boolean;
  uy: boolean;
  uz: boolean;
  rx: boolean;
  ry: boolean;
  rz: boolean;
}

export interface OpenFem3DSupport extends OpenFem3DSupportRestraints {
  nodeId: number;
  /** Globale oplegveren. Translatie in kN/m, rotatie in kNm/rad. */
  springs?: OpenFem3DSupportSprings;
  /** Opgelegde waarden op geblokkeerde globale DOF's; m en rad. */
  prescribed?: OpenFem3DPrescribedDisplacements;
}

export interface OpenFem3DSupportSprings {
  kxKnPerM?: number;
  kyKnPerM?: number;
  kzKnPerM?: number;
  krxKnmPerRad?: number;
  kryKnmPerRad?: number;
  krzKnmPerRad?: number;
}

export interface OpenFem3DPrescribedDisplacements {
  uxM?: number;
  uyM?: number;
  uzM?: number;
  rxRad?: number;
  ryRad?: number;
  rzRad?: number;
}

/** Forces are kN, moments kNm, all in the global X/Y/Z axes. */
export interface OpenFem3DNodalLoadComponents {
  fx: number;
  fy: number;
  fz: number;
  mx: number;
  my: number;
  mz: number;
}

export interface OpenFem3DNodalLoad extends OpenFem3DNodalLoadComponents {
  id: number;
  nodeId: number;
  /** Belastinggeval uit de gedeelde projectlijst. Ontbrekend in oude bestanden = geval 1. */
  caseId?: number;
}

/** Trapezoidal staafbelasting in lokale y/z-richting; afstanden in m, intensiteiten in kN/m. */
export interface OpenFem3DMemberLoad {
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
export interface OpenFem3DMemberPointLoad {
  id: number;
  beamId: number;
  /** Belastinggeval uit de gedeelde projectlijst. Ontbrekend in oude bestanden = geval 1. */
  caseId?: number;
  py: number;
  pz: number;
  positionM: number;
}

/** Temperatuurbelasting op een staaf; alle waarden zijn temperatuurverschillen in K. */
export interface OpenFem3DThermalLoad {
  id: number;
  beamId: number;
  caseId?: number;
  deltaTUniformK: number;
  /** Verschil over de doorsnede in lokale y-richting; veroorzaakt Mz. */
  deltaTGradientYK: number;
  /** Verschil over de doorsnede in lokale z-richting; veroorzaakt My. */
  deltaTGradientZK: number;
}

export interface OpenFem3DPlateOpening {
  id: number;
  /** Knoopvolgorde rond de opening; dezelfde vlakke basis als de plaat. */
  nodeIds: number[];
  /** Getekende gesloten contour. Een boog gebruikt begin-, stuur- en eindknoop. */
  boundary?: OpenFem3DPlateBoundarySegment[];
  cornerRadiusM?: number;
}

export type OpenFem3DPlateBoundarySegment =
  | { kind: "line"; startNodeId: number; endNodeId: number }
  | { kind: "arc"; startNodeId: number; controlNodeId: number; endNodeId: number };

export interface OpenFem3DPlate {
  id: number;
  /** Knoopvolgorde rond de buitenrand, minimaal drie. */
  nodeIds: number[];
  /** Werkelijke getekende rand; ontbreekt bij oudere hoekpuntplaten. */
  boundary?: OpenFem3DPlateBoundarySegment[];
  thicknessM: number;
  material?: string;
  /** Werkelijke afrondingsstraal van de plaatrand. */
  cornerRadiusM?: number;
  openings?: OpenFem3DPlateOpening[];
  /**
   * Level waarop de plaat horizontaal ligt (id van een `StructuralGrid.zAxes`).
   * Dan draagt elke knoop van de plaat, ook die van de openingen, hetzelfde
   * `levelId`; `parseOpenFem3DModel` laat een koppeling die daar niet aan
   * voldoet vallen.
   */
  levelId?: string;
  /**
   * Elementgrootte van het rekennet in m. Ontbreekt: automatisch, een tiende
   * van de kleinste plaatmaat, begrensd tussen 0,1 en 0,5 m.
   */
  meshSizeM?: number;
  /** Lijnopleggingen langs randen van de buitencontour. */
  edgeSupports?: OpenFem3DPlateEdgeSupport[];
}

/**
 * Oplegging langs één rand van de buitencontour van een plaat. Blokkeert de
 * gekozen globale verplaatsingen en rotaties in álle rekenknopen op die rand.
 */
export interface OpenFem3DPlateEdgeSupport extends OpenFem3DSupportRestraints {
  /**
   * Rand k: het randstuk k van `boundary`, of zonder getekende contour de
   * rand van contourknoop k naar k+1 (cyclisch).
   */
  edge: number;
}

/** Oppervlaktebelasting in globale assen, kN/m². */
export interface OpenFem3DSurfaceLoad {
  id: number;
  plateId: number;
  caseId?: number;
  qx: number;
  qy: number;
  qz: number;
}

/**
 * Lastrichting van een belastingvlak:
 *  - "gravity": q werkt in globale −Z, per m² HORIZONTALE PROJECTIE (sneeuw,
 *    vloer, dakafwerking). Σ verticaal = q × projectie-oppervlak.
 *  - "normal": q werkt loodrecht op het vlak, per m² VLAK (wind). Positief in
 *    de richting van de vaste vlaknormaal (zie `openFem3dLoadPanels.ts`).
 */
export type OpenFem3DLoadPanelDirection = "gravity" | "normal";
/**
 * Afdracht naar de liggers in het vlak:
 *  - "oneWay": naar de liggers dwars op de overspanningsrichting, elk met de
 *    halve afstand tot de buren als belastingbreedte.
 *  - "twoWay": naar alle liggers in het vlak volgens de 45°-lijnen (driehoek
 *    en trapezium); algemeen: elk punt naar de dichtstbijzijnde ligger.
 */
export type OpenFem3DLoadPanelDistribution = "oneWay" | "twoWay";

export interface OpenFem3DVector {
  x: number;
  y: number;
  z: number;
}

/**
 * Belastingvlak: een vlakke veelhoek over bestaande knopen die geen
 * stijfheid heeft en alleen zijn oppervlaktelast afdraagt naar de liggers in
 * het vlak. De omzetting naar staaflasten gebeurt in TypeScript vóór de
 * rekenkern (`openFem3dLoadPanels.ts`); de kern zelf kent geen vlakken.
 */
export interface OpenFem3DLoadPanel {
  id: number;
  /** Hoekknopen rond de omtrek, minimaal drie en in één vlak. */
  nodeIds: number[];
  /** Belastinggeval uit de gedeelde projectlijst. Ontbrekend = geval 1. */
  caseId?: number;
  /** Intensiteit in kN/m² (per horizontale projectie of per vlak, zie `direction`). */
  q: number;
  direction: OpenFem3DLoadPanelDirection;
  distribution: OpenFem3DLoadPanelDistribution;
  /** Globale overspanningsrichting; wordt op het vlak geprojecteerd. Verplicht bij éénrichting. */
  spanDirection?: OpenFem3DVector;
  /** Staven in het vlak die bewust géén last krijgen (bijvoorbeeld windverbanden). */
  excludedBeamIds?: number[];
}

export interface OpenFem3DModel {
  nodes: OpenFem3DNode[];
  beams: OpenFem3DBeam[];
  /** Optional so models made before nodal conditions remain readable. */
  supports?: OpenFem3DSupport[];
  loads?: OpenFem3DNodalLoad[];
  memberLoads?: OpenFem3DMemberLoad[];
  memberPointLoads?: OpenFem3DMemberPointLoad[];
  thermalLoads?: OpenFem3DThermalLoad[];
  plates?: OpenFem3DPlate[];
  surfaceLoads?: OpenFem3DSurfaceLoad[];
  /** Ontbreekt in bestanden van vóór de belastingvlakken. */
  loadPanels?: OpenFem3DLoadPanel[];
  /** Starre horizontale schijven; ontbreekt in bestanden van vóór de schijven. */
  diaphragms?: OpenFem3DDiaphragm[];
  /**
   * Trek-alleen staven gemonteerd na de permanente belasting: hun
   * spanningsloze lengte volgt de koorde onder de blijvende belastinggevallen
   * (type "dead", factor 1,0, met eigen gewicht en belastingvlakken). Alleen
   * `true` wordt bewaard; ontbreekt het, dan zijn ze spanningsloos in de
   * onvervormde stand.
   */
  tensionOnlyFitAfterPermanent?: boolean;
  /**
   * Kruisregel: van twee trek-alleen staven die elkaar kruisen, blijft altijd
   * de staaf met de grootste normaalkracht actief. Alleen `true` wordt bewaard.
   */
  tensionOnlyCrossRule?: boolean;
}

export const EMPTY_OPEN_FEM_3D: OpenFem3DModel = {
  nodes: [], beams: [], supports: [], loads: [], memberLoads: [], memberPointLoads: [], thermalLoads: [], plates: [], surfaceLoads: [],
  loadPanels: [],
};

function nextEntityId(items: readonly { id: number }[]): number {
  let maximum = 0;
  for (const item of items) if (item.id > maximum) maximum = item.id;
  return maximum + 1;
}

export const OPEN_FEM_3D_SUPPORT_PRESETS = {
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
} as const satisfies Record<string, OpenFem3DSupportRestraints>;

export type OpenFem3DSupportPreset = keyof typeof OPEN_FEM_3D_SUPPORT_PRESETS;

/** Herken een standaardoplegging zonder een tweede, potentieel strijdige typecode op te slaan. */
export function openFem3DSupportPresetOf(
  support: OpenFem3DSupportRestraints,
): OpenFem3DSupportPreset | "custom" {
  const axes = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;
  for (const [name, preset] of Object.entries(OPEN_FEM_3D_SUPPORT_PRESETS)) {
    if (axes.every((axis) => support[axis] === preset[axis])) return name as OpenFem3DSupportPreset;
  }
  return "custom";
}

export function openFem3DRevoluteAxis(
  support: OpenFem3DSupportRestraints,
): "x" | "y" | "z" | null {
  const preset = openFem3DSupportPresetOf(support);
  return preset === "revoluteX" ? "x" : preset === "revoluteY" ? "y" : preset === "revoluteZ" ? "z" : null;
}

const SUPPORT_DOF = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;
const SPRING_DOF = ["kxKnPerM", "kyKnPerM", "kzKnPerM", "krxKnmPerRad", "kryKnmPerRad", "krzKnmPerRad"] as const;
const PRESCRIBED_DOF = ["uxM", "uyM", "uzM", "rxRad", "ryRad", "rzRad"] as const;
const LOAD_DOF = ["fx", "fy", "fz", "mx", "my", "mz"] as const;
const RELEASE_DOF = ["myStart", "myEnd", "mzStart", "mzEnd", "torsionStart", "torsionEnd"] as const;

function readEndReleases(value: unknown): OpenFem3DEndReleases | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Een 3D-staaf bevat ongeldige eindscharnieren.");
  }
  const releases = value as Record<string, unknown>;
  if (RELEASE_DOF.some((axis) => releases[axis] !== undefined && typeof releases[axis] !== "boolean")) {
    throw new Error("Een 3D-staaf bevat een ongeldig eindscharnier.");
  }
  return Object.fromEntries(RELEASE_DOF.map((axis) => [axis, releases[axis] === true])) as unknown as OpenFem3DEndReleases;
}

type Vector3 = [number, number, number];

/** Dezelfde Z-up lokale assen als de solver, inclusief profielrotatie. */
export function openFem3DMemberAxes(
  start: Pick<OpenFem3DNode, "x" | "y" | "z">,
  end: Pick<OpenFem3DNode, "x" | "y" | "z">,
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

/** Levelverwijzing (id van een horizontale stramienas); leeg of null = geen. */
function readOptionalLevelId(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${label} heeft een ongeldige levelverwijzing.`);
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readOptionalCaseId(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error("Een 3D-belasting heeft een ongeldig belastinggeval.");
  }
  return Number(value);
}

export function openFem3DLoadCaseId(load: { caseId?: number }): number {
  return load.caseId ?? 1;
}

/**
 * Voeg het automatische eigen gewicht toe aan een vluchtige kopie van het
 * 3D-model. Het gewicht werkt altijd in globale -Z. De verdeelde last wordt
 * ontbonden in lokale y/z-componenten; de lokale axiale component (qx), die
 * het huidige contract van de externe kern nog niet rechtstreeks kent, krijgt de exact
 * equivalente halve normaalkracht op beide eindknopen. Een plaat krijgt een
 * vlaklast −ρ·g·t in Z (kN/m²) over haar hele oppervlak.
 *
 * Een trek-alleen staaf (strip, staaf) hangt in werkelijkheid door en draagt
 * haar gewicht als kabel naar haar einden; scharnierend gemodelleerd zou zij
 * onder dat gewicht buigen. Haar gewicht ρ·A·g·L gaat daarom als twee gelijke
 * knooplasten in −Z naar begin- en eindknoop (kabelwerking): dezelfde
 * resultante, geen buigend moment in de staaf.
 */
export function withOpenFem3DSelfWeight(model: OpenFem3DModel, caseId: number): OpenFem3DModel {
  if (!Number.isSafeInteger(caseId) || caseId <= 0) throw new Error("Het belastinggeval voor 3D-eigen gewicht is ongeldig.");
  const loads = [...(model.loads ?? [])];
  const memberLoads = [...(model.memberLoads ?? [])];
  let nextLoadId = nextEntityId(loads);
  let nextMemberLoadId = nextEntityId(memberLoads);

  for (const beam of model.beams) {
    const start = model.nodes.find((node) => node.id === beam.startNodeId)!;
    const end = model.nodes.find((node) => node.id === beam.endNodeId)!;
    const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
    const { ex, ey, ez } = openFem3DMemberAxes(start, end, beam.rollAngleRad ?? 0);

    const resolved = resolveSection(beam.material?.trim() ?? "", beam.profileName?.trim() ?? "");
    if (resolved.bron === "default") {
      throw new Error(`Staaf ${beam.id}: eigen gewicht kan niet worden bepaald: ${resolved.reden ?? "doorsnede onbekend"}.`);
    }
    const areaM2 = (resolved.aBruto ?? resolved.A) * 1e-6;
    const qGlobal: [number, number, number] = [
      0, 0, -(dichtheidVanMateriaal(beam.material) * areaM2 * G) / 1000,
    ];
    if (beam.tensionOnly) {
      // Kabelwerking: het halve gewicht op elk einde, in −Z.
      const endForce = qGlobal[2] * length / 2;
      if (endForce !== 0) {
        for (const nodeId of [beam.startNodeId, beam.endNodeId]) {
          loads.push({ id: nextLoadId++, nodeId, caseId, fx: 0, fy: 0, fz: endForce, mx: 0, my: 0, mz: 0 });
        }
      }
      continue;
    }
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
  const surfaceLoads = [...(model.surfaceLoads ?? [])];
  let nextSurfaceLoadId = nextEntityId(surfaceLoads);
  for (const plate of model.plates ?? []) {
    const material = resolveOpenFem3DPlateMaterial(plate);
    const qz = -(material.rhoKgM3 * G * plate.thicknessM) / 1000;
    if (qz !== 0) surfaceLoads.push({ id: nextSurfaceLoadId++, plateId: plate.id, caseId, qx: 0, qy: 0, qz });
  }
  return { ...model, loads, memberLoads, ...(model.plates?.length ? { surfaceLoads } : {}) };
}

function readSupportRestraints(value: Record<string, unknown>): OpenFem3DSupportRestraints {
  if (SUPPORT_DOF.some((axis) => typeof value[axis] !== "boolean")) {
    throw new Error("Een 3D-oplegging moet zes geldige vrijheidsgraden hebben.");
  }
  return Object.fromEntries(SUPPORT_DOF.map((axis) => [axis, value[axis]])) as unknown as OpenFem3DSupportRestraints;
}

function readSupportSprings(value: unknown): OpenFem3DSupportSprings | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Een 3D-oplegging bevat ongeldige veerstijfheden.");
  }
  const raw = value as Record<string, unknown>;
  const springs: OpenFem3DSupportSprings = {};
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

function readPrescribedDisplacements(value: unknown): OpenFem3DPrescribedDisplacements | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Een 3D-oplegging bevat ongeldige opgelegde verplaatsingen.");
  }
  const raw = value as Record<string, unknown>;
  const prescribed: OpenFem3DPrescribedDisplacements = {};
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

function readNodalLoadComponents(value: Record<string, unknown>): OpenFem3DNodalLoadComponents {
  if (LOAD_DOF.some((axis) => typeof value[axis] !== "number" || !Number.isFinite(value[axis])) ||
      !LOAD_DOF.some((axis) => value[axis] !== 0)) {
    throw new Error("Een 3D-knoopbelasting moet zes eindige componenten en minstens één niet-nulwaarde hebben.");
  }
  return Object.fromEntries(LOAD_DOF.map((axis) => [axis, value[axis]])) as unknown as OpenFem3DNodalLoadComponents;
}

function requireNode(model: OpenFem3DModel, nodeId: number) {
  if (!model.nodes.some((node) => node.id === nodeId)) {
    throw new Error(`3D-knoop ${nodeId} bestaat niet.`);
  }
}

function beamLength(model: OpenFem3DModel, beamId: number): number {
  const beam = model.beams.find((item) => item.id === beamId);
  if (!beam) throw new Error(`3D-staaf ${beamId} bestaat niet.`);
  const start = model.nodes.find((node) => node.id === beam.startNodeId)!;
  const end = model.nodes.find((node) => node.id === beam.endNodeId)!;
  return Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
}

function readMemberLoad(
  value: Record<string, unknown>, model: OpenFem3DModel, id: number, beamId: number,
): OpenFem3DMemberLoad {
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
  value: Record<string, unknown>, model: OpenFem3DModel, id: number, beamId: number,
): OpenFem3DMemberPointLoad {
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
  value: Record<string, unknown>, model: OpenFem3DModel, id: number, beamId: number,
): OpenFem3DThermalLoad {
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

/** Older copies kept the source plate's drawn contour while remapping its node loop. */
function repairCopiedBoundary(
  value: unknown, loop: number[], templates: Map<string, number[]>, nodes: ReadonlyMap<number, OpenFem3DNode>,
): unknown {
  if (!Array.isArray(value) || !value.length) return value;
  const segmentIds = value.flatMap((segment: unknown) => {
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) return [];
    const part = segment as Record<string, unknown>;
    return [part.startNodeId, part.endNodeId, ...(part.kind === "arc" ? [part.controlNodeId] : [])];
  });
  const key = JSON.stringify(value);
  if (segmentIds.every((id) => loop.includes(Number(id)))) {
    templates.set(key, loop);
    return value;
  }
  const sourceLoop = templates.get(key);
  if (!sourceLoop || sourceLoop.length !== loop.length) return value;
  const source = nodes.get(sourceLoop[0]), target = nodes.get(loop[0]);
  if (!source || !target) return value;
  const delta = [target.x - source.x, target.y - source.y, target.z - source.z];
  if (!sourceLoop.every((id, index) => {
    const from = nodes.get(id), to = nodes.get(loop[index]);
    return from && to && Math.abs(to.x - from.x - delta[0]) < 1e-8 &&
      Math.abs(to.y - from.y - delta[1]) < 1e-8 && Math.abs(to.z - from.z - delta[2]) < 1e-8;
  })) return value;
  const idMap = new Map(sourceLoop.map((id, index) => [id, loop[index]]));
  if (!segmentIds.every((id) => idMap.has(Number(id)))) return value;
  return value.map((segment: OpenFem3DPlateBoundarySegment) => segment.kind === "arc"
    ? { ...segment, startNodeId: idMap.get(segment.startNodeId)!, controlNodeId: idMap.get(segment.controlNodeId)!, endNodeId: idMap.get(segment.endNodeId)! }
    : { ...segment, startNodeId: idMap.get(segment.startNodeId)!, endNodeId: idMap.get(segment.endNodeId)! });
}

function hasCopiedBoundaryReference(value: unknown, loop: number[]): boolean {
  return Array.isArray(value) && value.some((segment: unknown) => {
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) return false;
    const part = segment as Record<string, unknown>;
    return !loop.includes(Number(part.startNodeId)) || !loop.includes(Number(part.endNodeId)) ||
      (part.kind === "arc" && !loop.includes(Number(part.controlNodeId)));
  });
}

function readPlateBoundary(
  value: unknown, loop: number[], nodeIds: Set<number>, nodes: ReadonlyMap<number, OpenFem3DNode>, label: string,
): OpenFem3DPlateBoundarySegment[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 2) throw new Error(`${label} bevat geen geldige getekende contour.`);
  const segments = value.map((raw, index): OpenFem3DPlateBoundarySegment => {
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
      const start = nodes.get(startNodeId)!, control = nodes.get(controlNodeId)!, end = nodes.get(endNodeId)!;
      const first = [control.x - start.x, control.y - start.y, control.z - start.z];
      const second = [end.x - start.x, end.y - start.y, end.z - start.z];
      const cross = Math.hypot(
        first[1] * second[2] - first[2] * second[1],
        first[2] * second[0] - first[0] * second[2],
        first[0] * second[1] - first[1] * second[0],
      );
      if (cross <= 1e-12 * Math.hypot(...first) * Math.hypot(...second)) {
        throw new Error(`${label} bevat een boog waarvan begin-, stuur- en eindpunt op één lijn liggen.`);
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

function validatePlatePlane(nodes: OpenFem3DNode[], nodeIds: number[], label: string): void {
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

/** An opening must lie strictly in the plate; a touching edge is not a meshable hole. */
function validateOpeningInsidePlate(
  nodes: ReadonlyMap<number, OpenFem3DNode>,
  plateLoop: readonly number[], plateBoundary: readonly OpenFem3DPlateBoundarySegment[] | undefined,
  openingLoop: readonly number[], openingBoundary: readonly OpenFem3DPlateBoundarySegment[] | undefined,
  label: string,
): void {
  const contour = (loop: readonly number[], boundary: readonly OpenFem3DPlateBoundarySegment[] | undefined) => {
    if (!boundary) return loop.map((id) => nodes.get(id)!);
    const points: ArcPoint3D[] = [nodes.get(boundary[0].startNodeId)!];
    for (const segment of boundary) {
      if (segment.kind === "line") points.push(nodes.get(segment.endNodeId)!);
      else {
        const arc = sampleCircularArc3D(
          nodes.get(segment.startNodeId)!, nodes.get(segment.controlNodeId)!, nodes.get(segment.endNodeId)!, 32,
        );
        if (!arc) throw new Error(`${label} bevat een ongeldige cirkelboog.`);
        points.push(...arc.slice(1));
      }
    }
    points.pop(); // de laatste knoop herhaalt de eerste bij een gesloten contour
    return points;
  };
  const outer = contour(plateLoop, plateBoundary);
  const opening = contour(openingLoop, openingBoundary);
  const origin = nodes.get(plateLoop[0])!;
  let normal: [number, number, number] | null = null;
  for (let index = 1; index < plateLoop.length - 1 && !normal; index += 1) {
    const a = nodes.get(plateLoop[index])!, b = nodes.get(plateLoop[index + 1])!;
    const ax = a.x - origin.x, ay = a.y - origin.y, az = a.z - origin.z;
    const bx = b.x - origin.x, by = b.y - origin.y, bz = b.z - origin.z;
    const cross: [number, number, number] = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
    if (Math.hypot(...cross) > 1e-12) normal = cross;
  }
  if (!normal) throw new Error(`${label} heeft geen vlakke buitencontour.`);
  const norm = Math.hypot(...normal);
  const drop = Math.abs(normal[0]) > Math.abs(normal[1])
    ? Math.abs(normal[0]) > Math.abs(normal[2]) ? "x" : "z"
    : Math.abs(normal[1]) > Math.abs(normal[2]) ? "y" : "z";
  const project = (point: ArcPoint3D) => drop === "x" ? [point.y, point.z] as const
    : drop === "y" ? [point.x, point.z] as const : [point.x, point.y] as const;
  const outline = outer.map(project);
  const span = outer.reduce((largest, point) => Math.max(largest,
    Math.hypot(point.x - origin.x, point.y - origin.y, point.z - origin.z)), 1);
  const tolerance = span * 1e-8;
  const inside = (point: readonly [number, number]) => {
    let contained = false;
    for (let index = 0; index < outline.length; index += 1) {
      const a = outline[index], b = outline[(index + 1) % outline.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared > 0
        ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared)) : 0;
      if (Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy) <= tolerance) return false;
      if ((a[1] > point[1]) !== (b[1] > point[1])
        && point[0] < a[0] + (point[1] - a[1]) * dx / dy) contained = !contained;
    }
    return contained;
  };
  for (const point of [...opening, ...openingLoop.map((id) => nodes.get(id)!)]) {
    const planeDistance = Math.abs(
      (point.x - origin.x) * normal[0] + (point.y - origin.y) * normal[1]
      + (point.z - origin.z) * normal[2]) / norm;
    if (planeDistance > tolerance || !inside(project(point))) {
      throw new Error(`${label} moet volledig binnen de plaat liggen, zonder de buitenrand te raken.`);
    }
  }
}

/** Reject malformed geometry at the file boundary instead of showing a partial model. */
export function parseOpenFem3DModel(value: unknown): OpenFem3DModel {
  if (value === undefined) return { nodes: [], beams: [] };
  if (!value || typeof value !== "object") throw new Error("Het 3D-model is geen object.");
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.beams)) {
    throw new Error("Het 3D-model mist de lijsten nodes en beams.");
  }
  const nodes: OpenFem3DNode[] = [];
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
    const levelId = readOptionalLevelId(node.levelId, `3D-knoop ${id}`);
    const name = readOptionalName(node.name, `3D-knoop ${id}`);
    nodes.push({
      id, x: Number(node.x), y: Number(node.y), z: Number(node.z),
      ...(levelId !== undefined ? { levelId } : {}),
      ...(name !== undefined ? { name } : {}),
    });
    nodeIds.add(id);
  }
  const nodeIndex = new Map(nodes.map((node) => [node.id, node]));
  const beams: OpenFem3DBeam[] = [];
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
    const start = nodeIndex.get(startNodeId)!;
    const end = nodeIndex.get(endNodeId)!;
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
      ...(beam.tensionOnly !== undefined
        ? typeof beam.tensionOnly === "boolean"
          ? (beam.tensionOnly ? { tensionOnly: true } : {})
          : (() => { throw new Error(`3D-staaf ${id} heeft een ongeldige waarde voor trek-alleen.`); })()
        : {}),
      ...(() => {
        const name = readOptionalName(beam.name, `3D-staaf ${id}`);
        const group = readOptionalName(beam.group, `3D-staaf ${id}`);
        return { ...(name !== undefined ? { name } : {}), ...(group !== undefined ? { group } : {}) };
      })(),
    });
    beamIds.add(id);
  }
  const plates: OpenFem3DPlate[] = [];
  const plateIds = new Set<number>();
  const boundaryTemplates = new Map<string, number[]>();
  if (raw.plates !== undefined && !Array.isArray(raw.plates)) throw new Error("Het 3D-model bevat geen geldige lijst plates.");
  for (const item of (raw.plates ?? []) as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Het 3D-model bevat een ongeldige plaat.");
    const plate = item as Record<string, unknown>;
    const id = Number(plate.id);
    if (!Number.isSafeInteger(plate.id) || id <= 0 || plateIds.has(id)) throw new Error("Het 3D-model bevat een plaat met een ongeldige of dubbele id.");
    const loop = readPlateNodeLoop(plate.nodeIds, nodeIds, `3D-plaat ${id}`);
    validatePlatePlane(nodes, loop, `3D-plaat ${id}`);
    const boundary = readPlateBoundary(repairCopiedBoundary(plate.boundary, loop, boundaryTemplates, nodeIndex), loop, nodeIds, nodeIndex, `3D-plaat ${id}`);
    const thicknessM = Number(plate.thicknessM ?? 0.2);
    const cornerRadiusM = Number(plate.cornerRadiusM ?? 0);
    if (!(thicknessM > 0) || !Number.isFinite(thicknessM) || cornerRadiusM < 0 || !Number.isFinite(cornerRadiusM)) {
      throw new Error(`3D-plaat ${id} heeft een ongeldige dikte of randstraal.`);
    }
    const meshSizeM = plate.meshSizeM === undefined || plate.meshSizeM === null ? undefined : Number(plate.meshSizeM);
    if (meshSizeM !== undefined && !(Number.isFinite(meshSizeM) && meshSizeM >= 0.01)) {
      throw new Error(`3D-plaat ${id} heeft een ongeldige elementgrootte (minimaal 10 mm).`);
    }
    const edgeCount = boundary ? boundary.length : loop.length;
    if (plate.edgeSupports !== undefined && !Array.isArray(plate.edgeSupports)) {
      throw new Error(`3D-plaat ${id} bevat geen geldige lijst randopleggingen.`);
    }
    const edgeSupports: OpenFem3DPlateEdgeSupport[] = [];
    for (const rawSupport of (plate.edgeSupports ?? []) as unknown[]) {
      if (!rawSupport || typeof rawSupport !== "object" || Array.isArray(rawSupport)) {
        throw new Error(`3D-plaat ${id} bevat een ongeldige randoplegging.`);
      }
      const support = rawSupport as Record<string, unknown>;
      const edge = Number(support.edge);
      if (!Number.isSafeInteger(support.edge) || edge < 0 || edge >= edgeCount
          || edgeSupports.some((item) => item.edge === edge)) {
        throw new Error(`3D-plaat ${id} bevat een randoplegging op een ongeldige of dubbele rand.`);
      }
      const restraints = readSupportRestraints(support);
      if (!SUPPORT_DOF.some((axis) => restraints[axis])) {
        throw new Error(`De randoplegging op rand ${edge + 1} van 3D-plaat ${id} blokkeert niets.`);
      }
      edgeSupports.push({ edge, ...restraints });
    }
    edgeSupports.sort((a, b) => a.edge - b.edge);
    const openingIds = new Set<number>();
    const openings: OpenFem3DPlateOpening[] = [];
    if (plate.openings !== undefined && !Array.isArray(plate.openings)) throw new Error(`3D-plaat ${id} bevat geen geldige lijst openingen.`);
    for (const rawOpening of (plate.openings ?? []) as unknown[]) {
      if (!rawOpening || typeof rawOpening !== "object" || Array.isArray(rawOpening)) throw new Error(`3D-plaat ${id} bevat een ongeldige opening.`);
      const opening = rawOpening as Record<string, unknown>;
      const openingId = Number(opening.id);
      if (!Number.isSafeInteger(opening.id) || openingId <= 0 || openingIds.has(openingId)) throw new Error(`3D-plaat ${id} bevat een opening met ongeldige of dubbele id.`);
      const openingLoop = readPlateNodeLoop(opening.nodeIds, nodeIds, `Opening ${openingId} van 3D-plaat ${id}`);
      validatePlatePlane(nodes, openingLoop, `Opening ${openingId} van 3D-plaat ${id}`);
      const openingBoundary = readPlateBoundary(repairCopiedBoundary(opening.boundary, openingLoop, boundaryTemplates, nodeIndex), openingLoop, nodeIds, nodeIndex, `Opening ${openingId} van 3D-plaat ${id}`);
      validateOpeningInsidePlate(nodeIndex, loop, boundary, openingLoop, openingBoundary,
        `Opening ${openingId} van 3D-plaat ${id}`);
      const openingRadius = Number(opening.cornerRadiusM ?? 0);
      if (openingRadius < 0 || !Number.isFinite(openingRadius)) throw new Error(`Opening ${openingId} heeft een ongeldige randstraal.`);
      openings.push({ id: openingId, nodeIds: openingLoop,
        ...(openingBoundary ? { boundary: openingBoundary } : {}),
        ...(openingRadius > 0 ? { cornerRadiusM: openingRadius } : {}) });
      openingIds.add(openingId);
    }
    const levelId = readOptionalLevelId(plate.levelId, `3D-plaat ${id}`);
    plates.push({ id, nodeIds: loop, thicknessM,
      ...(boundary ? { boundary } : {}),
      ...(typeof plate.material === "string" && plate.material.trim() ? { material: plate.material.trim() } : {}),
      ...(cornerRadiusM > 0 ? { cornerRadiusM } : {}), ...(openings.length ? { openings } : {}),
      ...(levelId !== undefined ? { levelId } : {}),
      ...(meshSizeM !== undefined ? { meshSizeM } : {}),
      ...(edgeSupports.length ? { edgeSupports } : {}) });
    plateIds.add(id);
  }
  // Een plaat ligt pas op een level als AL haar knopen (ook die van de
  // openingen) aan datzelfde level hangen. Een koppeling die daar niet aan
  // voldoet — alleen denkbaar in een met de hand bewerkt bestand — valt weg;
  // de geometrie zelf blijft precies zoals opgeslagen.
  for (let index = 0; index < plates.length; index += 1) {
    const plate = plates[index];
    if (plate.levelId === undefined) continue;
    const plateNodeIds = [...plate.nodeIds, ...(plate.openings ?? []).flatMap((opening) => opening.nodeIds)];
    if (plateNodeIds.every((nodeId) => nodeIndex.get(nodeId)?.levelId === plate.levelId)) continue;
    const { levelId: _unlinked, ...rest } = plate;
    plates[index] = rest;
  }
  const supports: OpenFem3DSupport[] = [];
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

  const loads: OpenFem3DNodalLoad[] = [];
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
  const model: OpenFem3DModel = {
    nodes, beams, ...(raw.plates !== undefined ? { plates } : {}), supports, loads,
    ...(raw.memberLoads !== undefined ? { memberLoads: [] } : {}),
    ...(raw.memberPointLoads !== undefined ? { memberPointLoads: [] } : {}),
    ...(raw.thermalLoads !== undefined ? { thermalLoads: [] } : {}),
    ...(raw.surfaceLoads !== undefined ? { surfaceLoads: [] } : {}),
  };
  // Modelinstellingen voor trek-alleen staven: alleen `true` blijft staan.
  for (const key of ["tensionOnlyFitAfterPermanent", "tensionOnlyCrossRule"] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "boolean") throw new Error(`Het 3D-model heeft een ongeldige instelling ${key} (true of false).`);
    if (raw[key]) model[key] = true;
  }
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
  if (raw.loadPanels !== undefined) {
    if (!Array.isArray(raw.loadPanels)) throw new Error("Het 3D-model bevat geen geldige lijst loadPanels.");
    const loadPanelIds = new Set<number>();
    model.loadPanels = raw.loadPanels.map((item: unknown) => {
      const panel = readLoadPanel(item, nodeIds, beamIds);
      if (loadPanelIds.has(panel.id)) throw new Error(`Het 3D-model bevat belastingvlak ${panel.id} twee keer.`);
      loadPanelIds.add(panel.id);
      return panel;
    });
  }
  if (raw.diaphragms !== undefined) {
    if (!Array.isArray(raw.diaphragms)) throw new Error("Het 3D-model bevat geen geldige lijst diaphragms.");
    model.diaphragms = readDiaphragms(raw.diaphragms, nodeIds);
  }
  return model;
}

const LOAD_PANEL_DIRECTIONS: readonly OpenFem3DLoadPanelDirection[] = ["gravity", "normal"];
const LOAD_PANEL_DISTRIBUTIONS: readonly OpenFem3DLoadPanelDistribution[] = ["oneWay", "twoWay"];

/**
 * Alleen de STRUCTUUR van een belastingvlak wordt hier gekeurd (knopen,
 * waarden, keuzes). De meetkunde — vlak, niet zelfsnijdend, liggers in het
 * vlak — hangt af van knoopcoördinaten die na het tekenen nog kunnen
 * verschuiven. Die keuring zit daarom in de afdracht (`openFem3dLoadPanels`),
 * die het rekenen blokkeert met een melding. Zo blijft een project met een
 * scheef getrokken vlak te openen en op te slaan in plaats van onleesbaar.
 */
function readLoadPanel(value: unknown, nodeIds: Set<number>, beamIds: Set<number>): OpenFem3DLoadPanel {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Het 3D-model bevat een ongeldig belastingvlak.");
  }
  const raw = value as Record<string, unknown>;
  const id = Number(raw.id);
  if (!Number.isSafeInteger(raw.id) || id <= 0) throw new Error("Het 3D-model bevat een belastingvlak met een ongeldige id.");
  const label = `3D-belastingvlak ${id}`;
  const loop = readPlateNodeLoop(raw.nodeIds, nodeIds, label);
  const q = raw.q;
  if (typeof q !== "number" || !Number.isFinite(q) || q === 0) {
    throw new Error(`${label} heeft een ongeldige intensiteit q; geef een eindige waarde ongelijk aan 0 in kN/m².`);
  }
  if (!LOAD_PANEL_DIRECTIONS.includes(raw.direction as OpenFem3DLoadPanelDirection)) {
    throw new Error(`${label} heeft een onbekende lastrichting ${JSON.stringify(raw.direction)}; kies gravity of normal.`);
  }
  if (!LOAD_PANEL_DISTRIBUTIONS.includes(raw.distribution as OpenFem3DLoadPanelDistribution)) {
    throw new Error(`${label} heeft een onbekende afdracht ${JSON.stringify(raw.distribution)}; kies oneWay of twoWay.`);
  }
  let spanDirection: OpenFem3DVector | undefined;
  if (raw.spanDirection !== undefined) {
    const vector = raw.spanDirection as Record<string, unknown> | null;
    if (!vector || typeof vector !== "object" || Array.isArray(vector)
      || !["x", "y", "z"].every((axis) => typeof vector[axis] === "number" && Number.isFinite(vector[axis]))
      || Math.hypot(Number(vector.x), Number(vector.y), Number(vector.z)) === 0) {
      throw new Error(`${label} heeft een ongeldige overspanningsrichting; geef een vector {x, y, z} ongelijk aan nul.`);
    }
    spanDirection = { x: Number(vector.x), y: Number(vector.y), z: Number(vector.z) };
  }
  if (raw.distribution === "oneWay" && !spanDirection) {
    throw new Error(`${label} draagt in één richting af maar mist de overspanningsrichting.`);
  }
  let excludedBeamIds: number[] | undefined;
  if (raw.excludedBeamIds !== undefined) {
    if (!Array.isArray(raw.excludedBeamIds)) throw new Error(`${label} bevat geen geldige lijst uitgesloten staven.`);
    const ids = raw.excludedBeamIds.map(Number);
    if (ids.some((beamId, index) => !Number.isSafeInteger(beamId) || !beamIds.has(beamId) || ids.indexOf(beamId) !== index)) {
      throw new Error(`${label} sluit een ontbrekende of dubbele staaf uit.`);
    }
    if (ids.length > 0) excludedBeamIds = ids;
  }
  const caseId = readOptionalCaseId(raw.caseId);
  return {
    id, nodeIds: loop,
    ...(caseId !== undefined ? { caseId } : {}),
    q,
    direction: raw.direction as OpenFem3DLoadPanelDirection,
    distribution: raw.distribution as OpenFem3DLoadPanelDistribution,
    ...(spanDirection ? { spanDirection } : {}),
    ...(excludedBeamIds ? { excludedBeamIds } : {}),
  };
}

/** Naam of groep uit een bronmodel; leeg of null = geen. */
function readOptionalName(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${label} heeft een ongeldige naam of groep.`);
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Alleen de STRUCTUUR van de schijven wordt hier gekeurd: bestaande knopen,
 * geen knoop in twee schijven. Of alle knopen op één hoogte liggen hangt af
 * van coördinaten die na het openen nog kunnen verschuiven; dat keurt de
 * rekenroute, die dan het rekenen blokkeert met een melding.
 */
function readDiaphragms(items: unknown[], nodeIds: Set<number>): OpenFem3DDiaphragm[] {
  const ids = new Set<number>();
  const owner = new Map<number, number>();
  return items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Het 3D-model bevat een ongeldige schijf.");
    const raw = item as Record<string, unknown>;
    const id = Number(raw.id);
    if (!Number.isSafeInteger(raw.id) || id <= 0 || ids.has(id)) throw new Error("Het 3D-model bevat een schijf met een ongeldige of dubbele id.");
    ids.add(id);
    if (!Array.isArray(raw.nodeIds) || raw.nodeIds.length < 2) throw new Error(`Schijf ${id} koppelt minder dan twee knopen.`);
    const nodes = raw.nodeIds.map(Number);
    for (const nodeId of nodes) {
      if (!Number.isSafeInteger(nodeId) || !nodeIds.has(nodeId)) throw new Error(`Schijf ${id} verwijst naar een ontbrekende knoop.`);
      const other = owner.get(nodeId);
      if (other === id) throw new Error(`Schijf ${id} noemt knoop ${nodeId} twee keer.`);
      if (other !== undefined) throw new Error(`Knoop ${nodeId} hoort bij schijf ${other} én schijf ${id}; een knoop hoort bij hoogstens één schijf.`);
      owner.set(nodeId, id);
    }
    const name = readOptionalName(raw.name, `Schijf ${id}`);
    return { id, nodeIds: nodes, ...(name !== undefined ? { name } : {}) };
  });
}

export function setOpenFem3DSupport(
  model: OpenFem3DModel, nodeId: number, restraints: OpenFem3DSupportRestraints,
): OpenFem3DModel {
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
  const support: OpenFem3DSupport = {
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
export function setOpenFem3DSupportSprings(
  model: OpenFem3DModel, nodeId: number, springs: OpenFem3DSupportSprings,
): OpenFem3DModel {
  requireNode(model, nodeId);
  const parsed = readSupportSprings(springs);
  const previous = model.supports ?? [];
  const existing = previous.find((item) => item.nodeId === nodeId);
  const restraints: OpenFem3DSupportRestraints = existing
    ? Object.fromEntries(SUPPORT_DOF.map((axis) => [axis, existing[axis]])) as unknown as OpenFem3DSupportRestraints
    : { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };
  const prescribed = existing?.prescribed ? { ...existing.prescribed } : undefined;
  for (let index = 0; index < SUPPORT_DOF.length; index += 1) {
    if (parsed?.[SPRING_DOF[index]] !== undefined) {
      restraints[SUPPORT_DOF[index]] = false;
      if (prescribed) delete prescribed[PRESCRIBED_DOF[index]];
    }
  }
  if (!parsed && !SUPPORT_DOF.some((axis) => restraints[axis])) return removeOpenFem3DSupport(model, nodeId);
  const support: OpenFem3DSupport = {
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
export function setOpenFem3DSupportPrescribed(
  model: OpenFem3DModel, nodeId: number, values: OpenFem3DPrescribedDisplacements,
): OpenFem3DModel {
  requireNode(model, nodeId);
  const prescribed = readPrescribedDisplacements(values);
  const previous = model.supports ?? [];
  const existing = previous.find((item) => item.nodeId === nodeId);
  if (!existing && !prescribed) return model;
  const restraints: OpenFem3DSupportRestraints = existing
    ? Object.fromEntries(SUPPORT_DOF.map((axis) => [axis, existing[axis]])) as unknown as OpenFem3DSupportRestraints
    : { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };
  const springs = existing?.springs ? { ...existing.springs } : undefined;
  for (let index = 0; index < SUPPORT_DOF.length; index += 1) {
    if (prescribed?.[PRESCRIBED_DOF[index]] !== undefined) {
      restraints[SUPPORT_DOF[index]] = true;
      if (springs) delete springs[SPRING_DOF[index]];
    }
  }
  const support: OpenFem3DSupport = {
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

export function removeOpenFem3DSupport(model: OpenFem3DModel, nodeId: number): OpenFem3DModel {
  return { ...model, supports: (model.supports ?? []).filter((item) => item.nodeId !== nodeId) };
}

export function addOpenFem3DNodalLoad(
  model: OpenFem3DModel, nodeId: number, components: OpenFem3DNodalLoadComponents, caseId?: number,
): OpenFem3DModel {
  requireNode(model, nodeId);
  const values = readNodalLoadComponents(components as unknown as Record<string, unknown>);
  const validCaseId = readOptionalCaseId(caseId);
  const previous = model.loads ?? [];
  const id = nextEntityId(previous);
  return { ...model, loads: [...previous, { id, nodeId, ...values, ...(validCaseId !== undefined ? { caseId: validCaseId } : {}) }] };
}

export function updateOpenFem3DNodalLoad(
  model: OpenFem3DModel, loadId: number, components: OpenFem3DNodalLoadComponents,
): OpenFem3DModel {
  const previous = model.loads ?? [];
  if (!previous.some((load) => load.id === loadId)) throw new Error(`3D-knoopbelasting ${loadId} bestaat niet.`);
  const values = readNodalLoadComponents(components as unknown as Record<string, unknown>);
  return {
    ...model,
    loads: previous.map((load) => load.id === loadId ? { ...load, ...values } : load),
  };
}

export function removeOpenFem3DNodalLoad(model: OpenFem3DModel, loadId: number): OpenFem3DModel {
  return { ...model, loads: (model.loads ?? []).filter((load) => load.id !== loadId) };
}

export function addOpenFem3DMemberLoad(
  model: OpenFem3DModel,
  beamId: number,
  values: Omit<OpenFem3DMemberLoad, "id" | "beamId" | "caseId">,
  caseId?: number,
): OpenFem3DModel {
  const previous = model.memberLoads ?? [];
  const id = nextEntityId(previous);
  const load = readMemberLoad({ ...values, ...(caseId !== undefined ? { caseId } : {}) } as unknown as Record<string, unknown>, model, id, beamId);
  return { ...model, memberLoads: [...previous, load] };
}

export function updateOpenFem3DMemberLoad(
  model: OpenFem3DModel,
  loadId: number,
  values: Omit<OpenFem3DMemberLoad, "id" | "beamId" | "caseId">,
): OpenFem3DModel {
  const previous = model.memberLoads ?? [];
  const old = previous.find((load) => load.id === loadId);
  if (!old) throw new Error(`3D-staafbelasting ${loadId} bestaat niet.`);
  const load = readMemberLoad({ ...values, ...(old.caseId !== undefined ? { caseId: old.caseId } : {}) } as unknown as Record<string, unknown>, model, loadId, old.beamId);
  return { ...model, memberLoads: previous.map((item) => item.id === loadId ? load : item) };
}

export function removeOpenFem3DMemberLoad(model: OpenFem3DModel, loadId: number): OpenFem3DModel {
  return { ...model, memberLoads: (model.memberLoads ?? []).filter((load) => load.id !== loadId) };
}

export function addOpenFem3DMemberPointLoad(
  model: OpenFem3DModel,
  beamId: number,
  values: Omit<OpenFem3DMemberPointLoad, "id" | "beamId" | "caseId">,
  caseId?: number,
): OpenFem3DModel {
  const previous = model.memberPointLoads ?? [];
  const id = nextEntityId(previous);
  const load = readMemberPointLoad(
    { ...values, ...(caseId !== undefined ? { caseId } : {}) } as unknown as Record<string, unknown>,
    model, id, beamId,
  );
  return { ...model, memberPointLoads: [...previous, load] };
}

export function updateOpenFem3DMemberPointLoad(
  model: OpenFem3DModel,
  loadId: number,
  values: Omit<OpenFem3DMemberPointLoad, "id" | "beamId" | "caseId">,
): OpenFem3DModel {
  const previous = model.memberPointLoads ?? [];
  const old = previous.find((load) => load.id === loadId);
  if (!old) throw new Error(`3D-staafpuntlast ${loadId} bestaat niet.`);
  const load = readMemberPointLoad(
    { ...values, ...(old.caseId !== undefined ? { caseId: old.caseId } : {}) } as unknown as Record<string, unknown>,
    model, loadId, old.beamId,
  );
  return { ...model, memberPointLoads: previous.map((item) => item.id === loadId ? load : item) };
}

export function removeOpenFem3DMemberPointLoad(model: OpenFem3DModel, loadId: number): OpenFem3DModel {
  return { ...model, memberPointLoads: (model.memberPointLoads ?? []).filter((load) => load.id !== loadId) };
}

export function addOpenFem3DThermalLoad(
  model: OpenFem3DModel,
  beamId: number,
  values: Omit<OpenFem3DThermalLoad, "id" | "beamId" | "caseId">,
  caseId?: number,
): OpenFem3DModel {
  const previous = model.thermalLoads ?? [];
  const id = nextEntityId(previous);
  const load = readThermalLoad(
    { ...values, ...(caseId !== undefined ? { caseId } : {}) } as unknown as Record<string, unknown>,
    model, id, beamId,
  );
  return { ...model, thermalLoads: [...previous, load] };
}

export function updateOpenFem3DThermalLoad(
  model: OpenFem3DModel,
  loadId: number,
  values: Omit<OpenFem3DThermalLoad, "id" | "beamId" | "caseId">,
): OpenFem3DModel {
  const previous = model.thermalLoads ?? [];
  const old = previous.find((load) => load.id === loadId);
  if (!old) throw new Error(`3D-temperatuurbelasting ${loadId} bestaat niet.`);
  const load = readThermalLoad(
    { ...values, ...(old.caseId !== undefined ? { caseId: old.caseId } : {}) } as unknown as Record<string, unknown>,
    model, loadId, old.beamId,
  );
  return { ...model, thermalLoads: previous.map((item) => item.id === loadId ? load : item) };
}

export function removeOpenFem3DThermalLoad(model: OpenFem3DModel, loadId: number): OpenFem3DModel {
  return { ...model, thermalLoads: (model.thermalLoads ?? []).filter((load) => load.id !== loadId) };
}

/** Reconnect a member while preserving its loads, section, releases and checks. */
export function setOpenFem3DBeamNodes(
  model: OpenFem3DModel,
  beamId: number,
  startNodeId: number,
  endNodeId: number,
): OpenFem3DModel {
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

export interface OpenFem3DBeamSplitResult {
  model: OpenFem3DModel;
  nodeId: number;
  firstBeamId: number;
  secondBeamId: number;
}

const RIGID_OPEN_FEM_3D_END: OpenFem3DEndReleases = {
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
export function splitOpenFem3DBeam(
  model: OpenFem3DModel,
  beamId: number,
  ratio: number,
): OpenFem3DBeamSplitResult {
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
  const nodeId = existingNode?.id ?? nextEntityId(model.nodes);
  const secondBeamId = nextEntityId(model.beams);
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
  const firstBeam: OpenFem3DBeam = {
    ...beam,
    endNodeId: nodeId,
    ...(originalReleases ? {
      releases: {
        ...RIGID_OPEN_FEM_3D_END,
        myStart: originalReleases.myStart,
        mzStart: originalReleases.mzStart,
        torsionStart: originalReleases.torsionStart,
      },
    } : {}),
  };
  const secondBeam: OpenFem3DBeam = {
    ...beam,
    id: secondBeamId,
    startNodeId: nodeId,
    ...(originalReleases ? {
      releases: {
        ...RIGID_OPEN_FEM_3D_END,
        myEnd: originalReleases.myEnd,
        mzEnd: originalReleases.mzEnd,
        torsionEnd: originalReleases.torsionEnd,
      },
    } : {}),
  };
  const beams = model.beams.flatMap((item) => item.id === beamId ? [firstBeam, secondBeam] : [item]);
  const splitDistance = ratio * length;

  let nextMemberLoadId = nextEntityId(model.memberLoads ?? []);
  const memberLoads = (model.memberLoads ?? []).flatMap((load): OpenFem3DMemberLoad[] => {
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

  const memberPointLoads = (model.memberPointLoads ?? []).map((load): OpenFem3DMemberPointLoad => {
    if (load.beamId !== beamId || load.positionM < splitDistance) return load;
    return { ...load, beamId: secondBeamId, positionM: load.positionM - splitDistance };
  });

  let nextThermalLoadId = nextEntityId(model.thermalLoads ?? []);
  const thermalLoads = (model.thermalLoads ?? []).flatMap((load): OpenFem3DThermalLoad[] =>
    load.beamId !== beamId
      ? [load]
      : [load, { ...load, id: nextThermalLoadId++, beamId: secondBeamId }]);
  // Een belastingvlak vindt zijn liggers meetkundig, dus beide delen dragen
  // vanzelf weer mee. Alleen een bewuste uitsluiting moet het tweede deel ook
  // krijgen, anders gaat een windverband na knippen half last dragen.
  const loadPanels = model.loadPanels?.map((panel) => panel.excludedBeamIds?.includes(beamId)
    ? { ...panel, excludedBeamIds: [...panel.excludedBeamIds, secondBeamId] }
    : panel);

  return {
    model: {
      ...model,
      // Een staaf tussen twee knopen op hetzelfde level ligt op dat level; de
      // nieuwe tussenknoop hangt er dan ook aan, anders knikt de staaf zodra
      // de hoogte van het level verandert.
      nodes: existingNode ? model.nodes : [...model.nodes, {
        id: nodeId, ...splitPoint,
        ...(start.levelId !== undefined && start.levelId === end.levelId ? { levelId: start.levelId } : {}),
      }],
      beams,
      memberLoads,
      memberPointLoads,
      thermalLoads,
      ...(loadPanels ? { loadPanels } : {}),
    },
    nodeId,
    firstBeamId: beamId,
    secondBeamId,
  };
}

/**
 * Haal verwijderde staven uit de uitsluitlijst van elk belastingvlak. Een
 * blijvende verwijzing zou later een nieuwe staaf met hetzelfde nummer stil
 * uitsluiten, en de modelkeuring weigert een ontbrekende staaf terecht.
 */
function withoutExcludedBeams(
  panels: OpenFem3DLoadPanel[] | undefined, removedBeamIds: ReadonlySet<number>,
): OpenFem3DLoadPanel[] | undefined {
  if (!panels || removedBeamIds.size === 0) return panels;
  return panels.map((panel) => {
    if (!panel.excludedBeamIds?.some((id) => removedBeamIds.has(id))) return panel;
    const excludedBeamIds = panel.excludedBeamIds.filter((id) => !removedBeamIds.has(id));
    const { excludedBeamIds: _removed, ...rest } = panel;
    return excludedBeamIds.length > 0 ? { ...rest, excludedBeamIds } : rest;
  });
}

export function removeOpenFem3DBeam(model: OpenFem3DModel, beamId: number): OpenFem3DModel {
  const loadPanels = withoutExcludedBeams(model.loadPanels, new Set([beamId]));
  return {
    ...model,
    beams: model.beams.filter((beam) => beam.id !== beamId),
    memberLoads: (model.memberLoads ?? []).filter((load) => load.beamId !== beamId),
    memberPointLoads: (model.memberPointLoads ?? []).filter((load) => load.beamId !== beamId),
    thermalLoads: (model.thermalLoads ?? []).filter((load) => load.beamId !== beamId),
    ...(loadPanels ? { loadPanels } : {}),
  };
}

export function removeOpenFem3DLoadPanel(model: OpenFem3DModel, panelId: number): OpenFem3DModel {
  return { ...model, loadPanels: (model.loadPanels ?? []).filter((panel) => panel.id !== panelId) };
}

export function addOpenFem3DPlate(
  model: OpenFem3DModel,
  nodeIds: number[],
  options: { thicknessM?: number; material?: string; cornerRadiusM?: number; boundary?: OpenFem3DPlateBoundarySegment[] } = {},
): OpenFem3DModel {
  const id = nextEntityId(model.plates ?? []);
  const parsed = parseOpenFem3DModel({
    ...model,
    plates: [...(model.plates ?? []), {
      id, nodeIds, thicknessM: options.thicknessM ?? 0.2, material: options.material ?? "C30/37",
      ...(options.boundary?.length ? { boundary: options.boundary } : {}),
      ...(options.cornerRadiusM && options.cornerRadiusM > 0 ? { cornerRadiusM: options.cornerRadiusM } : {}),
    }],
  });
  const addedPlate = parsed.plates?.[parsed.plates.length - 1];
  if (!addedPlate) throw new Error("De nieuwe 3D-plaat kon niet worden gevalideerd.");
  // Het invoermodel is al gevalideerd. Behoud daarom zijn onveranderde
  // objectreferenties en neem alleen de nieuwe, gevalideerde plaat over. De
  // 3D-viewer kan de plaat dan toevoegen zonder knopen, labels en staven
  // opnieuw op te bouwen.
  const legacyCopies = (model.plates ?? []).some((plate) =>
    hasCopiedBoundaryReference(plate.boundary, plate.nodeIds) ||
    (plate.openings ?? []).some((opening) => hasCopiedBoundaryReference(opening.boundary, opening.nodeIds)));
  return legacyCopies ? parsed : { ...model, plates: [...(model.plates ?? []), addedPlate] };
}

export function updateOpenFem3DPlate(
  model: OpenFem3DModel, plateId: number,
  patch: Partial<Pick<OpenFem3DPlate, "thicknessM" | "material" | "cornerRadiusM" | "meshSizeM" | "edgeSupports">>,
): OpenFem3DModel {
  if (!(model.plates ?? []).some((plate) => plate.id === plateId)) throw new Error(`3D-plaat ${plateId} bestaat niet.`);
  const parsed = parseOpenFem3DModel({
    ...model,
    plates: (model.plates ?? []).map((plate) => {
      if (plate.id !== plateId) return plate;
      const next: OpenFem3DPlate = { ...plate, ...patch };
      // `meshSizeM: undefined` zet de elementgrootte terug op automatisch.
      if ("meshSizeM" in patch && patch.meshSizeM === undefined) delete next.meshSizeM;
      if ("edgeSupports" in patch && !patch.edgeSupports?.length) delete next.edgeSupports;
      return next;
    }),
  });
  const updatedPlate = parsed.plates?.find((plate) => plate.id === plateId);
  if (!updatedPlate) throw new Error(`3D-plaat ${plateId} kon niet worden gevalideerd.`);
  return {
    ...model,
    plates: (model.plates ?? []).map((plate) => plate.id === plateId ? updatedPlate : plate),
  };
}

export function addOpenFem3DPlateOpening(
  model: OpenFem3DModel,
  plateId: number,
  nodeIds: number[],
  cornerRadiusOrOptions: number | { cornerRadiusM?: number; boundary?: OpenFem3DPlateBoundarySegment[] } = 0,
): OpenFem3DModel {
  const plate = (model.plates ?? []).find((item) => item.id === plateId);
  if (!plate) throw new Error(`3D-plaat ${plateId} bestaat niet.`);
  const options = typeof cornerRadiusOrOptions === "number"
    ? { cornerRadiusM: cornerRadiusOrOptions }
    : cornerRadiusOrOptions;
  const id = nextEntityId(plate.openings ?? []);
  const parsed = parseOpenFem3DModel({
    ...model,
    plates: (model.plates ?? []).map((item) => item.id === plateId ? {
      ...item,
      openings: [...(item.openings ?? []), {
        id,
        nodeIds,
        ...(options.boundary?.length ? { boundary: options.boundary } : {}),
        ...(options.cornerRadiusM && options.cornerRadiusM > 0 ? { cornerRadiusM: options.cornerRadiusM } : {}),
      }],
    } : item),
  });
  const updatedPlate = parsed.plates?.find((item) => item.id === plateId);
  if (!updatedPlate) throw new Error(`De opening in 3D-plaat ${plateId} kon niet worden gevalideerd.`);
  return {
    ...model,
    plates: (model.plates ?? []).map((item) => item.id === plateId ? updatedPlate : item),
  };
}

export function removeOpenFem3DPlate(model: OpenFem3DModel, plateId: number): OpenFem3DModel {
  return { ...model, plates: (model.plates ?? []).filter((plate) => plate.id !== plateId),
    surfaceLoads: (model.surfaceLoads ?? []).filter((load) => load.plateId !== plateId) };
}

export function addOpenFem3DSurfaceLoad(
  model: OpenFem3DModel, plateId: number, values: Pick<OpenFem3DSurfaceLoad, "qx" | "qy" | "qz">, caseId?: number,
): OpenFem3DModel {
  const id = nextEntityId(model.surfaceLoads ?? []);
  return parseOpenFem3DModel({ ...model, surfaceLoads: [...(model.surfaceLoads ?? []), { id, plateId, ...values, ...(caseId ? { caseId } : {}) }] });
}

export function updateOpenFem3DSurfaceLoad(
  model: OpenFem3DModel, loadId: number, values: Pick<OpenFem3DSurfaceLoad, "qx" | "qy" | "qz">,
): OpenFem3DModel {
  if (!(model.surfaceLoads ?? []).some((load) => load.id === loadId)) throw new Error(`3D-oppervlaktebelasting ${loadId} bestaat niet.`);
  return parseOpenFem3DModel({ ...model, surfaceLoads: (model.surfaceLoads ?? []).map((load) => load.id === loadId ? { ...load, ...values } : load) });
}

export function removeOpenFem3DSurfaceLoad(model: OpenFem3DModel, loadId: number): OpenFem3DModel {
  return { ...model, surfaceLoads: (model.surfaceLoads ?? []).filter((load) => load.id !== loadId) };
}

/** Keep all other node conditions when one node is deleted. */
export function removeOpenFem3DNode(model: OpenFem3DModel, nodeId: number): OpenFem3DModel {
  const removedBeamIds = new Set(model.beams
    .filter((beam) => beam.startNodeId === nodeId || beam.endNodeId === nodeId)
    .map((beam) => beam.id));
  const removedPlateIds = new Set((model.plates ?? []).filter((plate) =>
    plate.nodeIds.includes(nodeId) || (plate.openings ?? []).some((opening) => opening.nodeIds.includes(nodeId)))
    .map((plate) => plate.id));
  // Een belastingvlak zonder een van zijn hoekknopen bestaat niet meer.
  const loadPanels = withoutExcludedBeams(
    model.loadPanels?.filter((panel) => !panel.nodeIds.includes(nodeId)), removedBeamIds);
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
    ...(loadPanels ? { loadPanels } : {}),
    // De knoop verlaat zijn schijf; een schijf met minder dan twee knopen koppelt niets meer.
    ...(model.diaphragms !== undefined
      ? {
          diaphragms: model.diaphragms
            .map((diaphragm) => ({ ...diaphragm, nodeIds: diaphragm.nodeIds.filter((id) => id !== nodeId) }))
            .filter((diaphragm) => diaphragm.nodeIds.length >= 2),
        }
      : {}),
  };
}

/**
 * Verwijder de selectie, zoals de lintknop Verwijderen en de Delete-toets:
 * staven en platen eerst, daarna knopen met alles wat eraan hangt. Een plaat
 * gaat met haar openingen en oppervlaktelasten weg; haar knopen blijven staan.
 */
export function removeOpenFem3DSelection(model: OpenFem3DModel, selection: OpenFem3DSelection): OpenFem3DModel {
  if (!selection) return model;
  if (selection.type === "multi") {
    let next = model;
    for (const beamId of selection.beamIds) next = removeOpenFem3DBeam(next, beamId);
    for (const plateId of selection.plateIds ?? []) next = removeOpenFem3DPlate(next, plateId);
    for (const nodeId of selection.nodeIds) next = removeOpenFem3DNode(next, nodeId);
    return next;
  }
  switch (selection.type) {
    case "beam": return removeOpenFem3DBeam(model, selection.id);
    case "node": return removeOpenFem3DNode(model, selection.id);
    case "nodalLoad": return removeOpenFem3DNodalLoad(model, selection.id);
    case "memberLoad": return removeOpenFem3DMemberLoad(model, selection.id);
    case "memberPointLoad": return removeOpenFem3DMemberPointLoad(model, selection.id);
    case "thermalLoad": return removeOpenFem3DThermalLoad(model, selection.id);
    case "plate": return removeOpenFem3DPlate(model, selection.id);
    case "surfaceLoad": return removeOpenFem3DSurfaceLoad(model, selection.id);
    case "loadPanel": return removeOpenFem3DLoadPanel(model, selection.id);
  }
}

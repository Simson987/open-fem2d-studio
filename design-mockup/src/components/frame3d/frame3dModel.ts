import type { BeamCheckConfig } from "../fem/femTypes";
import { CONCRETE_E_CM, dichtheidVanMateriaal, eVanMateriaal, G, resolveSection } from "../../lib/sectionResolver";
import type { NativeReinforcementSpec } from "../../core/fem/nativePlate2DAdapter";
import type { NativeThreeLayerConfiguration } from "../../core/fem/nativeThreeLayerAdapter";
import { sampleCircularArc3D, type ArcPoint3D } from "./frame3dCircularArc";
import { frame3DVolumeFaces } from "./frame3dVolumeFaces";

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
  /** Alleen normaalkracht in de gedeelde lineaire volume/staafkern; geen rotatie-DOF. */
  axialOnly?: boolean;
  /** Dezelfde materiaal- en norminstellingen als bij een 2D-staaf. */
  checkConfig?: BeamCheckConfig;
  /** Expliciete parameters voor de experimentele fysisch niet-lineaire Rust-analyse. */
  nonlinearLaw?: Frame3DNonlinearLaw;
  /** Rotatie van de lokale y/z-assen om de staafas, in radialen. */
  rollAngleRad?: number;
  /** Moment- en torsiescharnieren aan de staafeinden, in lokale assen. */
  releases?: Frame3DEndReleases;
}

export type Frame3DNonlinearLaw =
  | { kind: "steelBilinear"; yieldMpa: number; hardeningRatio: number }
  | { kind: "concreteCracking"; tensileMpa: number; residualRatio: number };

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

export type Frame3DPlateEdgeSupport = "free" | "simplySupported" | "clamped";

export interface Frame3DPlate {
  id: number;
  /** Knoopvolgorde rond de buitenrand, minimaal drie. */
  nodeIds: number[];
  /** Werkelijke getekende rand; ontbreekt bij oudere hoekpuntplaten. */
  boundary?: Frame3DPlateBoundarySegment[];
  thicknessM: number;
  material?: string;
  /** Explicit linear Tri3 plane-stress membrane in the shared solid/frame system. */
  membraneOnly?: boolean;
  membraneEMpa?: number;
  membranePoisson?: number;
  /** FNL: niet-toenemende secant-E als functie van maximale absolute vezelrek. */
  modulusCurve?: { strain: number; eMpa: number }[];
  /** FNL constitutieve wet voor de GNL-shell membraanpunten. */
  nonlinearLaw?: Frame3DNonlinearLaw;
  /** Rand 1–4 volgt de vier hoekknopen. De Rust-route verdeelt dit over alle randroosterknopen. */
  edgeSupports?: [Frame3DPlateEdgeSupport, Frame3DPlateEdgeSupport, Frame3DPlateEdgeSupport, Frame3DPlateEdgeSupport];
  /** Maximale Q4-celmaat in meter; standaard min(breedte, hoogte)/4. */
  maxCellSizeM?: number;
  /** Expliciete UGT- of BGT-toetsinvoer voor de Rust-buigplaat. */
  reinforcement?: NativeReinforcementSpec;
  /** Expliciete Blaauwendraad-drielagencontrole op hybride plaatresultanten. */
  threeLayer?: NativeThreeLayerConfiguration;
  /** Werkelijke afrondingsstraal van de plaatrand. */
  cornerRadiusM?: number;
  openings?: Frame3DPlateOpening[];
}

function readPlateReinforcement(value: unknown, plateId: number, thicknessM: number): NativeReinforcementSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`3D-plaat ${plateId}: ongeldige wapeningsinvoer.`);
  }
  const raw = value as Record<string, unknown>;
  if (raw.limitState !== "ultimate" && raw.limitState !== "service") {
    throw new Error(`3D-plaat ${plateId}: kies UGT of BGT voor de wapeningscontrole.`);
  }
  const positive = ["fckMpa", "fctmMpa", "gammaC", "fydMpa", "fywdMpa", "esMpa", "barDiameterMm"] as const;
  const nonnegative = ["coverMm", "topXMm2PerM", "topYMm2PerM", "bottomXMm2PerM", "bottomYMm2PerM"] as const;
  for (const key of positive) {
    if (typeof raw[key] !== "number" || !Number.isFinite(raw[key]) || raw[key] <= 0) {
      throw new Error(`3D-plaat ${plateId}: ${key} moet een positief eindig getal zijn.`);
    }
  }
  for (const key of nonnegative) {
    if (typeof raw[key] !== "number" || !Number.isFinite(raw[key]) || raw[key] < 0) {
      throw new Error(`3D-plaat ${plateId}: ${key} moet een niet-negatief eindig getal zijn.`);
    }
  }
  const optionalPositive = ["leverArmMm", "cRdc", "crackLimitMm"] as const;
  for (const key of optionalPositive) {
    if (raw[key] !== undefined && (typeof raw[key] !== "number" || !Number.isFinite(raw[key]) || raw[key] <= 0)) {
      throw new Error(`3D-plaat ${plateId}: ${key} moet een positief eindig getal zijn.`);
    }
  }
  if (raw.shearMm2PerM2 !== undefined && (typeof raw.shearMm2PerM2 !== "number"
      || !Number.isFinite(raw.shearMm2PerM2) || raw.shearMm2PerM2 < 0)) {
    throw new Error(`3D-plaat ${plateId}: shearMm2PerM2 moet niet-negatief zijn.`);
  }
  const tanTheta = raw.tanTheta ?? 1, alphaCc = raw.alphaCc ?? 1;
  if (typeof tanTheta !== "number" || !Number.isFinite(tanTheta) || tanTheta < 0.4 || tanTheta > 1
      || typeof alphaCc !== "number" || !Number.isFinite(alphaCc) || alphaCc <= 0
      || (raw.longTerm !== undefined && typeof raw.longTerm !== "boolean")
      || (raw.fckMpa as number) >= 250
      || thicknessM * 1000 <= 2 * (raw.coverMm as number) + (raw.barDiameterMm as number)
      || (raw.leverArmMm !== undefined && (raw.leverArmMm as number) >= thicknessM * 1000)) {
    throw new Error(`3D-plaat ${plateId}: ongeldige beton-/wapeningsparameters voor de plaatdikte.`);
  }
  return {
    limitState: raw.limitState,
    fckMpa: raw.fckMpa as number, fctmMpa: raw.fctmMpa as number,
    gammaC: raw.gammaC as number, fydMpa: raw.fydMpa as number, fywdMpa: raw.fywdMpa as number,
    esMpa: raw.esMpa as number, coverMm: raw.coverMm as number, barDiameterMm: raw.barDiameterMm as number,
    topXMm2PerM: raw.topXMm2PerM as number, topYMm2PerM: raw.topYMm2PerM as number,
    bottomXMm2PerM: raw.bottomXMm2PerM as number, bottomYMm2PerM: raw.bottomYMm2PerM as number,
    ...(raw.shearMm2PerM2 !== undefined ? { shearMm2PerM2: raw.shearMm2PerM2 as number } : {}),
    ...(raw.leverArmMm !== undefined ? { leverArmMm: raw.leverArmMm as number } : {}),
    ...(raw.cRdc !== undefined ? { cRdc: raw.cRdc as number } : {}),
    ...(raw.crackLimitMm !== undefined ? { crackLimitMm: raw.crackLimitMm as number } : {}),
    tanTheta, alphaCc, longTerm: raw.longTerm === true,
  };
}

function readPlateThreeLayer(value: unknown, plateId: number, thicknessM: number): NativeThreeLayerConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`3D-plaat ${plateId}: ongeldige drielageninvoer.`);
  }
  const raw = value as Record<string, unknown>;
  const positive = ["topSkinMm", "bottomSkinMm", "fcdMpa", "fydMpa", "nuPrime"] as const;
  const readReinforcement = (key: "topReinforcement" | "bottomReinforcement") => {
    const entry = raw[key];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`3D-plaat ${plateId}: ongeldige drielageninvoer voor ${key}.`);
    }
    const reinforcement = entry as Record<string, unknown>;
    for (const direction of ["asX", "asY"] as const) {
      const area = reinforcement[direction];
      if (typeof area !== "number" || !Number.isFinite(area) || area < 0) {
        throw new Error(`3D-plaat ${plateId}: ${key}.${direction} moet niet-negatief en eindig zijn.`);
      }
    }
    return { asX: reinforcement.asX as number, asY: reinforcement.asY as number };
  };
  const topReinforcement = readReinforcement("topReinforcement");
  const bottomReinforcement = readReinforcement("bottomReinforcement");
  for (const key of positive) {
    if (typeof raw[key] !== "number" || !Number.isFinite(raw[key]) || raw[key] <= 0) {
      throw new Error(`3D-plaat ${plateId}: drielagenveld ${key} moet positief en eindig zijn.`);
    }
  }
  if ((raw.topSkinMm as number) + (raw.bottomSkinMm as number) >= thicknessM * 1000
      || (raw.nuPrime as number) > 1
      || (raw.compressionModel !== "blaauwendraad2021" && raw.compressionModel !== "ec2AnnexF")) {
    throw new Error(`3D-plaat ${plateId}: huiddiktes, ν′ of drukmodel passen niet bij de plaat.`);
  }
  let core: NativeThreeLayerConfiguration["core"];
  if (raw.core !== undefined) {
    if (!raw.core || typeof raw.core !== "object" || Array.isArray(raw.core)) {
      throw new Error(`3D-plaat ${plateId}: ongeldige drielagen-kerninvoer.`);
    }
    const c = raw.core as Record<string, unknown>;
    for (const key of ["vRdcKnPerM", "diagonalLimitMpa"] as const) {
      if (typeof c[key] !== "number" || !Number.isFinite(c[key]) || c[key] <= 0) {
        throw new Error(`3D-plaat ${plateId}: kernveld ${key} moet positief en eindig zijn.`);
      }
    }
    if (typeof c.tanTheta !== "number" || !Number.isFinite(c.tanTheta)
        || c.tanTheta < 0.4 || c.tanTheta > 1
        || typeof c.providedShearMm2PerM2 !== "number" || !Number.isFinite(c.providedShearMm2PerM2)
        || c.providedShearMm2PerM2 < 0) {
      throw new Error(`3D-plaat ${plateId}: tan θ moet 0,4–1 zijn en Asv niet-negatief.`);
    }
    core = { vRdcKnPerM: c.vRdcKnPerM as number, tanTheta: c.tanTheta,
      providedShearMm2PerM2: c.providedShearMm2PerM2 as number, diagonalLimitMpa: c.diagonalLimitMpa as number };
  }
  return {
    topSkinMm: raw.topSkinMm as number,
    bottomSkinMm: raw.bottomSkinMm as number,
    topReinforcement,
    bottomReinforcement,
    fcdMpa: raw.fcdMpa as number,
    fydMpa: raw.fydMpa as number,
    nuPrime: raw.nuPrime as number,
    compressionModel: raw.compressionModel,
    ...(core ? { core } : {}),
  };
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

/** Normaallijnlast langs één buitenrand van een rechthoekige plaat, kN/m. */
export interface Frame3DPlateEdgeLoad {
  id: number;
  plateId: number;
  edgeIndex: number;
  caseId?: number;
  startKnPerM: number;
  endKnPerM: number;
}

/** Solid element connectivity follows the native Tet4 / Hex8 solver order. */
export type Frame3DVolumeMaterialLaw =
  | { kind: "steelJ2"; yieldMpa: number; hardeningMpa: number }
  | { kind: "concreteTensionDamage"; tensileStrengthMpa: number;
      fractureEnergyNPerM: number; crackBandWidthM: number };

export interface Frame3DVolume {
  id: number;
  kind: "tet4" | "hex8";
  nodeIds: number[];
  /** Isotropic Young's modulus in MPa. */
  eMpa: number;
  poisson: number;
  /** Experimental hyperelastic beta in W = W0 + beta W0²/(2E); Tet4 GNL only. */
  energyBeta?: number;
  /** Experimental FNL law; every Tet4 in one solve needs the same law family. */
  materialLaw?: Frame3DVolumeMaterialLaw;
  /** Required for automatically generated gravity load, in kg/m³. */
  densityKgPerM3?: number;
}

/** Uniforme globale volumekracht, bijvoorbeeld soortelijk gewicht, in kN/m³. */
export interface Frame3DVolumeBodyLoad {
  id: number;
  volumeId: number;
  caseId?: number;
  forceKnPerM3: [number, number, number];
}

/** Uniform global traction on an outward-oriented Tet4/Hex8 face, kN/m². */
export interface Frame3DVolumeFaceLoad {
  id: number;
  volumeId: number;
  faceIndex: number;
  caseId?: number;
  tractionKnPerM2: [number, number, number];
}

export type Frame3DVolumeBackend = "automatic" | "matrixFreePcg" | "sparsePcg"
  | "sparseDirect" | "frontalWave" | "dense" | "sparseGmres"
  | "matrixFreeGmres" | "matrixFreeGmresLarge";

export const FRAME3D_VOLUME_BACKENDS: readonly Frame3DVolumeBackend[] = [
  "automatic", "matrixFreePcg", "sparsePcg", "sparseDirect", "frontalWave", "dense", "sparseGmres",
  "matrixFreeGmres", "matrixFreeGmresLarge",
];

export interface Frame3DModel {
  nodes: Frame3DNode[];
  beams: Frame3DBeam[];
  /** Absolute lastfactoren voor de Rust 3D-FNL-kern, bij staven of platen. */
  materialLoadPath?: number[];
  /** Optional so models made before nodal conditions remain readable. */
  supports?: Frame3DSupport[];
  loads?: Frame3DNodalLoad[];
  memberLoads?: Frame3DMemberLoad[];
  memberPointLoads?: Frame3DMemberPointLoad[];
  thermalLoads?: Frame3DThermalLoad[];
  plates?: Frame3DPlate[];
  volumes?: Frame3DVolume[];
  volumeBodyLoads?: Frame3DVolumeBodyLoad[];
  volumeFaceLoads?: Frame3DVolumeFaceLoad[];
  /** Shared linear volume/frame solve strategy; omitted means automatic. */
  volumeBackend?: Frame3DVolumeBackend;
  /** Material-FNL kinematics for pure Tet4 steel; default keeps the small-strain J2 path. */
  volumeMaterialKinematics?: "smallStrain" | "finiteStrain";
  /** Native matrix/vector product parallelism; omitted means four threads. */
  volumeThreads?: number;
  /** Relative Newton equilibrium tolerance for volume material-FNL (default 1e-9). */
  volumeResidualTolerance?: number;
  surfaceLoads?: Frame3DSurfaceLoad[];
  plateEdgeLoads?: Frame3DPlateEdgeLoad[];
}

export const EMPTY_FRAME_3D: Frame3DModel = {
  nodes: [], beams: [], supports: [], loads: [], memberLoads: [], memberPointLoads: [], thermalLoads: [], plates: [], volumes: [], volumeBodyLoads: [], volumeFaceLoads: [], surfaceLoads: [], plateEdgeLoads: [],
};

function nextEntityId(items: readonly { id: number }[]): number {
  let maximum = 0;
  for (const item of items) if (item.id > maximum) maximum = item.id;
  return maximum + 1;
}

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

function readNonlinearLaw(value: unknown): Frame3DNonlinearLaw | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Een 3D-staaf bevat een ongeldige FNL-materiaalwet.");
  }
  const law = value as Record<string, unknown>;
  const positive = (number: unknown) => typeof number === "number" && Number.isFinite(number) && number > 0;
  const ratio = (number: unknown) => typeof number === "number" && Number.isFinite(number) && number >= 0 && number <= 1;
  if (law.kind === "steelBilinear" && positive(law.yieldMpa) && ratio(law.hardeningRatio)) {
    return { kind: "steelBilinear", yieldMpa: law.yieldMpa as number, hardeningRatio: law.hardeningRatio as number };
  }
  if (law.kind === "concreteCracking" && positive(law.tensileMpa) && ratio(law.residualRatio)) {
    return { kind: "concreteCracking", tensileMpa: law.tensileMpa as number, residualRatio: law.residualRatio as number };
  }
  throw new Error("Een 3D-staaf heeft ongeldige FNL-parameters: sterkte > 0 MPa en stijfheidsverhouding 0…1 vereist.");
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

/** Gevallen met een werkelijke 3D-last; gebruikt door de app vóór het oplossen. */
export function frame3DLoadedCaseIds(model: Frame3DModel): Set<number> {
  const loaded = new Set<number>();
  for (const list of [model.loads, model.memberLoads, model.memberPointLoads,
    model.thermalLoads, model.surfaceLoads, model.plateEdgeLoads, model.volumeBodyLoads, model.volumeFaceLoads]) {
    for (const load of list ?? []) loaded.add(frame3DLoadCaseId(load));
  }
  return loaded;
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
  const surfaceLoads = [...(model.surfaceLoads ?? [])];
  const volumeBodyLoads = [...(model.volumeBodyLoads ?? [])];
  let nextLoadId = nextEntityId(loads);
  let nextMemberLoadId = nextEntityId(memberLoads);
  let nextSurfaceLoadId = nextEntityId(surfaceLoads);
  let nextVolumeBodyLoadId = nextEntityId(volumeBodyLoads);

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
  for (const plate of model.plates ?? []) {
    if (!plate.material) throw new Error(`Plaat ${plate.id}: eigen gewicht vereist een materiaal.`);
    surfaceLoads.push({
      id: nextSurfaceLoadId++, plateId: plate.id, caseId,
      qx: 0, qy: 0,
      qz: -(dichtheidVanMateriaal(plate.material) * plate.thicknessM * G) / 1000,
    });
  }
  for (const volume of model.volumes ?? []) {
    if (volume.densityKgPerM3 === undefined) {
      throw new Error(`Volume ${volume.id}: eigen gewicht vereist een expliciete dichtheid in kg/m³.`);
    }
    if (!Number.isFinite(volume.densityKgPerM3) || volume.densityKgPerM3 <= 0) {
      throw new Error(`Volume ${volume.id}: ongeldige dichtheid voor eigen gewicht.`);
    }
    volumeBodyLoads.push({ id: nextVolumeBodyLoadId++, volumeId: volume.id, caseId,
      forceKnPerM3: [0, 0, -volume.densityKgPerM3 * G / 1000] });
  }
  return { ...model, loads, memberLoads, surfaceLoads, volumeBodyLoads };
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

/** Older copies kept the source plate's drawn contour while remapping its node loop. */
function repairCopiedBoundary(
  value: unknown, loop: number[], templates: Map<string, number[]>, nodes: ReadonlyMap<number, Frame3DNode>,
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
  return value.map((segment: Frame3DPlateBoundarySegment) => segment.kind === "arc"
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
  value: unknown, loop: number[], nodeIds: Set<number>, nodes: ReadonlyMap<number, Frame3DNode>, label: string,
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

/** An opening must lie strictly in the plate; a touching edge is not a meshable hole. */
function validateOpeningInsidePlate(
  nodes: ReadonlyMap<number, Frame3DNode>,
  plateLoop: readonly number[], plateBoundary: readonly Frame3DPlateBoundarySegment[] | undefined,
  openingLoop: readonly number[], openingBoundary: readonly Frame3DPlateBoundarySegment[] | undefined,
  label: string,
): void {
  const contour = (loop: readonly number[], boundary: readonly Frame3DPlateBoundarySegment[] | undefined) => {
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

const HEX8_SIGNS: readonly (readonly [number, number, number])[] = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];

function volumeDeterminant(a: readonly number[], b: readonly number[], c: readonly number[]): number {
  return a[0] * (b[1] * c[2] - b[2] * c[1])
    + a[1] * (b[2] * c[0] - b[0] * c[2])
    + a[2] * (b[0] * c[1] - b[1] * c[0]);
}

function validateVolumeGeometry(volume: Frame3DVolume, nodeIndex: ReadonlyMap<number, Frame3DNode>): void {
  const points = volume.nodeIds.map((nodeId) => nodeIndex.get(nodeId)!);
  const origin = points[0];
  const size = Math.max(...points.flatMap((point) => [
    Math.abs(point.x - origin.x), Math.abs(point.y - origin.y), Math.abs(point.z - origin.z),
  ]));
  if (!(size > 0) || !Number.isFinite(size)) throw new Error(`3D-volume ${volume.id} heeft geen geldige afmeting.`);
  const floor = 1e-12 * size ** 3;
  if (volume.kind === "tet4") {
    const edges = points.slice(1).map((point) => [point.x - origin.x, point.y - origin.y, point.z - origin.z]);
    const edgeSize = Math.max(...edges.map((edge) => Math.hypot(...edge)));
    const det = volumeDeterminant(edges[0], edges[1], edges[2]);
    if (!Number.isFinite(det) || Math.abs(det) <= 1e-12 * edgeSize ** 3) {
      throw new Error(`3D-volume ${volume.id}: Tet4 is plat of ontaard.`);
    }
    return;
  }
  const gauss = 1 / Math.sqrt(3);
  for (const xi of [-gauss, gauss]) for (const eta of [-gauss, gauss]) for (const zeta of [-gauss, gauss]) {
    const columns = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 8; i += 1) {
      const [sx, sy, sz] = HEX8_SIGNS[i];
      const derivatives = [
        sx * (1 + sy * eta) * (1 + sz * zeta) / 8,
        sy * (1 + sx * xi) * (1 + sz * zeta) / 8,
        sz * (1 + sx * xi) * (1 + sy * eta) / 8,
      ];
      const point = points[i];
      for (let axis = 0; axis < 3; axis += 1) {
        columns[axis][0] += (point.x - origin.x) * derivatives[axis];
        columns[axis][1] += (point.y - origin.y) * derivatives[axis];
        columns[axis][2] += (point.z - origin.z) * derivatives[axis];
      }
    }
    const det = volumeDeterminant(columns[0], columns[1], columns[2]);
    if (!Number.isFinite(det) || det <= floor) {
      throw new Error(`3D-volume ${volume.id}: Hex8 heeft een omgekeerde of ontaarde Jacobiaan.`);
    }
  }
}

/** Reject malformed geometry at the file boundary instead of showing a partial model. */
export function parseFrame3DModel(value: unknown): Frame3DModel {
  if (value === undefined) return { nodes: [], beams: [] };
  if (!value || typeof value !== "object") throw new Error("Het 3D-model is geen object.");
  const raw = value as Record<string, unknown>;
  if (raw.volumeBackend !== undefined && !FRAME3D_VOLUME_BACKENDS.includes(raw.volumeBackend as Frame3DVolumeBackend)) {
    throw new Error("Het 3D-model bevat een ongeldige volume-oplosstrategie.");
  }
  if (raw.volumeMaterialKinematics !== undefined && raw.volumeMaterialKinematics !== "smallStrain"
      && raw.volumeMaterialKinematics !== "finiteStrain") {
    throw new Error("Het 3D-model bevat een ongeldige materiaal-FNL-kinematica.");
  }
  if (raw.volumeThreads !== undefined && (!Number.isSafeInteger(raw.volumeThreads)
      || Number(raw.volumeThreads) < 1 || Number(raw.volumeThreads) > 32)) {
    throw new Error("Het 3D-model vereist 1 tot 32 solverthreads.");
  }
  if (raw.volumeResidualTolerance !== undefined
      && (typeof raw.volumeResidualTolerance !== "number"
        || !Number.isFinite(raw.volumeResidualTolerance)
        || raw.volumeResidualTolerance < 1e-12
        || raw.volumeResidualTolerance > 1e-4)) {
    throw new Error("De Newton-tolerantie voor volume-FNL moet tussen 1e-12 en 1e-4 liggen.");
  }
  if (raw.materialLoadPath !== undefined && (!Array.isArray(raw.materialLoadPath)
      || raw.materialLoadPath.length === 0 || raw.materialLoadPath.length > 100
      || raw.materialLoadPath.some((factor: unknown) => typeof factor !== "number" || !Number.isFinite(factor)))) {
    throw new Error("Het 3D-model bevat een ongeldig FNL-lastpad (1–100 eindige getallen vereist).");
  }
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
  const nodeIndex = new Map(nodes.map((node) => [node.id, node]));
  const volumes: Frame3DVolume[] = [];
  const volumeIds = new Set<number>();
  if (raw.volumes !== undefined && !Array.isArray(raw.volumes)) throw new Error("Het 3D-model bevat geen geldige lijst volumes.");
  for (const item of (raw.volumes ?? []) as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Het 3D-model bevat een ongeldig volume-element.");
    const volume = item as Record<string, unknown>;
    const id = Number(volume.id);
    if (!Number.isSafeInteger(volume.id) || id <= 0 || volumeIds.has(id)) {
      throw new Error("Het 3D-model bevat een volume-element met een ongeldige of dubbele id.");
    }
    const kind = volume.kind;
    if ((kind !== "tet4" && kind !== "hex8") || !Array.isArray(volume.nodeIds)
        || volume.nodeIds.length !== (kind === "tet4" ? 4 : 8)
        || volume.nodeIds.some((nodeId: unknown) => !Number.isSafeInteger(nodeId) || !nodeIds.has(nodeId as number))
        || new Set(volume.nodeIds).size !== volume.nodeIds.length) {
      throw new Error(`3D-volume ${id} heeft ongeldige of dubbele knoopverwijzingen.`);
    }
    if (typeof volume.eMpa !== "number" || !Number.isFinite(volume.eMpa) || volume.eMpa <= 0
        || typeof volume.poisson !== "number" || !Number.isFinite(volume.poisson)
        || volume.poisson < 0 || volume.poisson >= 0.5) {
      throw new Error(`3D-volume ${id} vereist een positieve eindige E en Poisson in [0, 0,5).`);
    }
    if (volume.densityKgPerM3 !== undefined && (typeof volume.densityKgPerM3 !== "number"
        || !Number.isFinite(volume.densityKgPerM3) || volume.densityKgPerM3 <= 0)) {
      throw new Error(`3D-volume ${id} vereist een positieve eindige dichtheid in kg/m³.`);
    }
    if (volume.energyBeta !== undefined && (kind !== "tet4"
        || typeof volume.energyBeta !== "number" || !Number.isFinite(volume.energyBeta))) {
      throw new Error(`3D-volume ${id}: rekafhankelijke β vereist Tet4 en een eindige waarde.`);
    }
    let materialLaw: Frame3DVolumeMaterialLaw | undefined;
    if (volume.materialLaw !== undefined) {
      if (volume.energyBeta !== undefined
          || !volume.materialLaw || typeof volume.materialLaw !== "object" || Array.isArray(volume.materialLaw)) {
        throw new Error(`3D-volume ${id}: materiaal-FNL vereist een geldige materiaalwet zonder hyperelastische β.`);
      }
      const law = volume.materialLaw as Record<string, unknown>;
      const positive = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0;
      if (law.kind === "steelJ2" && positive(law.yieldMpa)
          && typeof law.hardeningMpa === "number" && Number.isFinite(law.hardeningMpa) && law.hardeningMpa >= 0) {
        materialLaw = { kind: "steelJ2", yieldMpa: law.yieldMpa as number, hardeningMpa: law.hardeningMpa };
      } else if (kind === "tet4" && law.kind === "concreteTensionDamage" && positive(law.tensileStrengthMpa)
          && positive(law.fractureEnergyNPerM) && positive(law.crackBandWidthM)) {
        materialLaw = { kind: "concreteTensionDamage", tensileStrengthMpa: law.tensileStrengthMpa as number,
          fractureEnergyNPerM: law.fractureEnergyNPerM as number, crackBandWidthM: law.crackBandWidthM as number };
      } else {
        throw new Error(`3D-volume ${id}: ongeldige staal-J2- of betontrekschadeparameters; Hex8 ondersteunt hier alleen staal-J2.`);
      }
    }
    const parsed: Frame3DVolume = { id, kind, nodeIds: [...volume.nodeIds], eMpa: volume.eMpa, poisson: volume.poisson,
      ...(volume.densityKgPerM3 !== undefined ? { densityKgPerM3: volume.densityKgPerM3 as number } : {}),
      ...(volume.energyBeta !== undefined ? { energyBeta: volume.energyBeta as number } : {}),
      ...(materialLaw ? { materialLaw } : {}) };
    validateVolumeGeometry(parsed, nodeIndex);
    volumes.push(parsed);
    volumeIds.add(id);
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
    const start = nodeIndex.get(startNodeId)!;
    const end = nodeIndex.get(endNodeId)!;
    if (start.x === end.x && start.y === end.y && start.z === end.z) {
      throw new Error("Het 3D-model bevat een staaf zonder lengte.");
    }
    if (beam.axialOnly !== undefined && typeof beam.axialOnly !== "boolean") {
      throw new Error(`3D-staaf ${id}: axialOnly moet een boolean zijn.`);
    }
    if (beam.axialOnly === true && beam.releases !== undefined
        && Object.values(readEndReleases(beam.releases)!).some(Boolean)) {
      throw new Error(`3D-trekstaaf ${id}: eindscharnieren zijn niet van toepassing.`);
    }
    beams.push({
      id,
      startNodeId,
      endNodeId,
      ...(typeof beam.profileName === "string" && beam.profileName.trim() ? { profileName: beam.profileName.trim() } : {}),
      ...(typeof beam.material === "string" && beam.material.trim() ? { material: beam.material.trim() } : {}),
      ...(beam.axialOnly === true ? { axialOnly: true } : {}),
      ...(beam.checkConfig && typeof beam.checkConfig === "object" && !Array.isArray(beam.checkConfig)
        ? { checkConfig: beam.checkConfig as BeamCheckConfig }
        : {}),
      ...(beam.nonlinearLaw !== undefined ? { nonlinearLaw: readNonlinearLaw(beam.nonlinearLaw)! } : {}),
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
    const maxCellSizeM = plate.maxCellSizeM;
    if (maxCellSizeM !== undefined && (typeof maxCellSizeM !== "number"
        || !Number.isFinite(maxCellSizeM) || maxCellSizeM <= 0)) {
      throw new Error(`3D-plaat ${id}: de maximale roostermaat moet positief en eindig zijn.`);
    }
    let edgeSupports: Frame3DPlate["edgeSupports"];
    const rawEdgeSupports = plate.edgeSupports;
    if (rawEdgeSupports !== undefined) {
      if (loop.length !== 4) {
        throw new Error(`3D-plaat ${id}: vier randopleggingen vereisen vier buitenste hoekknopen.`);
      }
      if (!Array.isArray(rawEdgeSupports) || rawEdgeSupports.length !== 4
          || Array.from({ length: 4 }, (_, index) => rawEdgeSupports[index]).some((kind) =>
            !["free", "simplySupported", "clamped"].includes(kind))) {
        throw new Error(`3D-plaat ${id}: geef voor de vier plaatranden een vrije, scharnierende of ingeklemde oplegging op.`);
      }
      edgeSupports = [...rawEdgeSupports] as Frame3DPlate["edgeSupports"];
    }
    let modulusCurve: Frame3DPlate["modulusCurve"];
    if (plate.modulusCurve !== undefined) {
      if (!Array.isArray(plate.modulusCurve) || plate.modulusCurve.length < 2 || plate.modulusCurve.length > 100) {
        throw new Error(`3D-plaat ${id}: de E-rekcurve moet 2–100 punten bevatten.`);
      }
      modulusCurve = plate.modulusCurve.map((rawPoint, index) => {
        if (!rawPoint || typeof rawPoint !== "object" || Array.isArray(rawPoint)) {
          throw new Error(`3D-plaat ${id}: E-rekpunt ${index + 1} is ongeldig.`);
        }
        const point = rawPoint as Record<string, unknown>;
        const strain = point.strain, eMpa = point.eMpa;
        if (typeof strain !== "number" || !Number.isFinite(strain) || strain < 0
            || typeof eMpa !== "number" || !Number.isFinite(eMpa) || eMpa <= 0) {
          throw new Error(`3D-plaat ${id}: E-rekpunt ${index + 1} vereist eindige positieve E en niet-negatieve rek.`);
        }
        return { strain, eMpa };
      });
      if (modulusCurve[0].strain !== 0 || modulusCurve.some((point, index) => index > 0
          && (point.strain <= modulusCurve![index - 1].strain || point.eMpa > modulusCurve![index - 1].eMpa))) {
        throw new Error(`3D-plaat ${id}: de E-rekcurve begint bij rek 0, met stijgende rek en niet-toenemende E.`);
      }
      const baseE = eVanMateriaal(typeof plate.material === "string" ? plate.material.trim() : "").E;
      if (Number.isFinite(baseE) && Math.abs(modulusCurve[0].eMpa - baseE) > baseE * 1e-10) {
        throw new Error(`3D-plaat ${id}: de E-rekcurve moet bij rek 0 beginnen met materiaaleigen E = ${baseE} MPa.`);
      }
    }
    const reinforcement = plate.reinforcement === undefined ? undefined
      : readPlateReinforcement(plate.reinforcement, id, thicknessM);
    const nonlinearLaw = plate.nonlinearLaw === undefined ? undefined
      : readNonlinearLaw(plate.nonlinearLaw);
    if (plate.nonlinearLaw !== undefined && !nonlinearLaw) {
      throw new Error(`3D-plaat ${id}: de opgegeven materiaalwet is ongeldig.`);
    }
    if (reinforcement) {
      const material = typeof plate.material === "string" ? plate.material.trim() : "";
      const fck = Number(/^C(\d+)\//.exec(material)?.[1] ?? NaN);
      if (!(material in CONCRETE_E_CM) || reinforcement.fckMpa !== fck) {
        throw new Error(`3D-plaat ${id}: de wapeningscontrole vereist een herkende betonklasse en dezelfde fck als het plaatmateriaal.`);
      }
    }
    const threeLayer = plate.threeLayer === undefined ? undefined
      : readPlateThreeLayer(plate.threeLayer, id, thicknessM);
    if (threeLayer && (!(typeof plate.material === "string") || !(plate.material.trim() in CONCRETE_E_CM))) {
      throw new Error(`3D-plaat ${id}: de Blaauwendraad-drielagencontrole vereist beton.`);
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
    if (plate.membraneOnly !== undefined && typeof plate.membraneOnly !== "boolean") {
      throw new Error(`3D-plaat ${id}: membraankeuze moet ja of nee zijn.`);
    }
    if (plate.membraneOnly) {
      if (loop.length !== 3 || openings.length > 0 || cornerRadiusM > 0
          || boundary?.some((segment) => segment.kind !== "line") || edgeSupports
          || maxCellSizeM !== undefined || modulusCurve || reinforcement || threeLayer) {
        throw new Error(`3D-plaat ${id}: een gekoppeld Tri3-membraan vereist drie rechte hoekknopen zonder openingen, buigrandvoorwaarden of niet-lineaire plaatopties.`);
      }
      if (nonlinearLaw && (nonlinearLaw.kind !== "steelBilinear" || nonlinearLaw.hardeningRatio >= 1)) {
        throw new Error(`3D-plaat ${id}: een gekoppeld Tri3-membraan ondersteunt alleen bilineaire staalplastificatie met verhardingsratio kleiner dan 1.`);
      }
      if (typeof plate.membraneEMpa !== "number" || !Number.isFinite(plate.membraneEMpa)
          || plate.membraneEMpa <= 0 || typeof plate.membranePoisson !== "number"
          || !Number.isFinite(plate.membranePoisson) || plate.membranePoisson < 0
          || plate.membranePoisson >= 0.5) {
        throw new Error(`3D-plaat ${id}: Tri3-membraan vereist positieve E en Poisson in [0, 0,5).`);
      }
    } else if (plate.membraneEMpa !== undefined || plate.membranePoisson !== undefined) {
      throw new Error(`3D-plaat ${id}: membraan-E en Poisson vereisen de Tri3-membraankeuze.`);
    }
    plates.push({ id, nodeIds: loop, thicknessM,
      ...(plate.membraneOnly ? { membraneOnly: true,
        membraneEMpa: plate.membraneEMpa as number, membranePoisson: plate.membranePoisson as number } : {}),
      ...(boundary ? { boundary } : {}),
      ...(typeof plate.material === "string" && plate.material.trim() ? { material: plate.material.trim() } : {}),
      ...(cornerRadiusM > 0 ? { cornerRadiusM } : {}), ...(openings.length ? { openings } : {}),
      ...(modulusCurve ? { modulusCurve } : {}), ...(reinforcement ? { reinforcement } : {}),
      ...(nonlinearLaw ? { nonlinearLaw } : {}),
      ...(threeLayer ? { threeLayer } : {}),
      ...(edgeSupports ? { edgeSupports } : {}), ...(maxCellSizeM ? { maxCellSizeM } : {}) });
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
    nodes, beams, ...(raw.plates !== undefined ? { plates } : {}),
    ...(raw.volumes !== undefined ? { volumes } : {}), supports, loads,
    ...(raw.volumeBodyLoads !== undefined ? { volumeBodyLoads: [] } : {}),
    ...(raw.volumeFaceLoads !== undefined ? { volumeFaceLoads: [] } : {}),
    ...(raw.volumeBackend !== undefined ? { volumeBackend: raw.volumeBackend as Frame3DVolumeBackend } : {}),
    ...(raw.volumeMaterialKinematics !== undefined
      ? { volumeMaterialKinematics: raw.volumeMaterialKinematics as "smallStrain" | "finiteStrain" } : {}),
    ...(raw.volumeThreads !== undefined ? { volumeThreads: Number(raw.volumeThreads) } : {}),
    ...(raw.volumeResidualTolerance !== undefined
      ? { volumeResidualTolerance: raw.volumeResidualTolerance as number } : {}),
    ...(raw.materialLoadPath !== undefined ? { materialLoadPath: [...raw.materialLoadPath as number[]] } : {}),
    ...(raw.memberLoads !== undefined ? { memberLoads: [] } : {}),
    ...(raw.memberPointLoads !== undefined ? { memberPointLoads: [] } : {}),
    ...(raw.thermalLoads !== undefined ? { thermalLoads: [] } : {}),
    ...(raw.surfaceLoads !== undefined ? { surfaceLoads: [] } : {}),
    ...(raw.plateEdgeLoads !== undefined ? { plateEdgeLoads: [] } : {}),
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
  const volumeBodyLoadIds = new Set<number>();
  if (raw.volumeBodyLoads !== undefined && !Array.isArray(raw.volumeBodyLoads)) {
    throw new Error("Het 3D-model bevat geen geldige lijst volumeBodyLoads.");
  }
  for (const item of (raw.volumeBodyLoads ?? []) as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Het 3D-model bevat een ongeldige volumekracht.");
    const load = item as Record<string, unknown>;
    const id = Number(load.id), volumeId = Number(load.volumeId);
    const force = load.forceKnPerM3;
    if (!Number.isSafeInteger(load.id) || id <= 0 || volumeBodyLoadIds.has(id)
        || !Number.isSafeInteger(load.volumeId) || !volumeIds.has(volumeId)
        || !Array.isArray(force) || force.length !== 3
        || force.some((component) => typeof component !== "number" || !Number.isFinite(component))
        || force.every((component) => component === 0)) {
      throw new Error("Het 3D-model bevat een volumekracht met ongeldige waarden of volumeverwijzing.");
    }
    const caseId = readOptionalCaseId(load.caseId);
    model.volumeBodyLoads!.push({ id, volumeId, ...(caseId !== undefined ? { caseId } : {}),
      forceKnPerM3: [...force] as [number, number, number] });
    volumeBodyLoadIds.add(id);
  }
  const volumeFaceLoadIds = new Set<number>();
  const volumeById = new Map(volumes.map((volume) => [volume.id, volume]));
  if (raw.volumeFaceLoads !== undefined && !Array.isArray(raw.volumeFaceLoads)) {
    throw new Error("Het 3D-model bevat geen geldige lijst volumeFaceLoads.");
  }
  for (const item of (raw.volumeFaceLoads ?? []) as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Het 3D-model bevat een ongeldige volumevlaktractie.");
    const load = item as Record<string, unknown>;
    const id = Number(load.id), volumeId = Number(load.volumeId), faceIndex = Number(load.faceIndex);
    const volume = volumeById.get(volumeId);
    const traction = load.tractionKnPerM2;
    if (!Number.isSafeInteger(load.id) || id <= 0 || volumeFaceLoadIds.has(id)
        || !Number.isSafeInteger(load.volumeId) || !volume
        || !Number.isSafeInteger(load.faceIndex) || faceIndex < 0 || faceIndex >= frame3DVolumeFaces(volume.kind).length
        || !Array.isArray(traction) || traction.length !== 3
        || traction.some((component) => typeof component !== "number" || !Number.isFinite(component))
        || traction.every((component) => component === 0)) {
      throw new Error("Het 3D-model bevat een volumevlaktractie met ongeldige waarden, vlak of volumeverwijzing.");
    }
    const caseId = readOptionalCaseId(load.caseId);
    model.volumeFaceLoads!.push({ id, volumeId, faceIndex, ...(caseId !== undefined ? { caseId } : {}),
      tractionKnPerM2: [...traction] as [number, number, number] });
    volumeFaceLoadIds.add(id);
  }
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
  const plateEdgeLoadIds = new Set<number>();
  if (raw.plateEdgeLoads !== undefined && !Array.isArray(raw.plateEdgeLoads)) throw new Error("Het 3D-model bevat geen geldige lijst plateEdgeLoads.");
  for (const item of (raw.plateEdgeLoads ?? []) as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Het 3D-model bevat een ongeldige plaatrandbelasting.");
    const load = item as Record<string, unknown>;
    const id = Number(load.id), plateId = Number(load.plateId), edgeIndex = Number(load.edgeIndex);
    const startKnPerM = Number(load.startKnPerM), endKnPerM = Number(load.endKnPerM);
    if (!Number.isSafeInteger(load.id) || id <= 0 || plateEdgeLoadIds.has(id) || !Number.isSafeInteger(load.plateId) || !plateIds.has(plateId)
      || !Number.isSafeInteger(load.edgeIndex) || edgeIndex < 0 || edgeIndex > 3
      || ![startKnPerM, endKnPerM].every(Number.isFinite) || (startKnPerM === 0 && endKnPerM === 0)) {
      throw new Error("Het 3D-model bevat een plaatrandbelasting met ongeldige waarden of plaatverwijzing.");
    }
    const caseId = readOptionalCaseId(load.caseId);
    model.plateEdgeLoads!.push({ id, plateId, edgeIndex, ...(caseId !== undefined ? { caseId } : {}), startKnPerM, endKnPerM });
    plateEdgeLoadIds.add(id);
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
  const id = nextEntityId(previous);
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
  const id = nextEntityId(previous);
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
  const id = nextEntityId(previous);
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
  const id = nextEntityId(previous);
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

  let nextMemberLoadId = nextEntityId(model.memberLoads ?? []);
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

  let nextThermalLoadId = nextEntityId(model.thermalLoads ?? []);
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
  const id = nextEntityId(model.plates ?? []);
  const parsed = parseFrame3DModel({
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

export function updateFrame3DPlate(
  model: Frame3DModel, plateId: number,
  patch: Partial<Pick<Frame3DPlate, "thicknessM" | "material" | "cornerRadiusM" | "modulusCurve" | "nonlinearLaw" | "reinforcement" | "threeLayer" | "edgeSupports" | "maxCellSizeM" | "membraneOnly" | "membraneEMpa" | "membranePoisson">>,
): Frame3DModel {
  if (!(model.plates ?? []).some((plate) => plate.id === plateId)) throw new Error(`3D-plaat ${plateId} bestaat niet.`);
  const parsed = parseFrame3DModel({
    ...model,
    plates: (model.plates ?? []).map((plate) => plate.id === plateId ? { ...plate, ...patch } : plate),
  });
  const updatedPlate = parsed.plates?.find((plate) => plate.id === plateId);
  if (!updatedPlate) throw new Error(`3D-plaat ${plateId} kon niet worden gevalideerd.`);
  return {
    ...model,
    plates: (model.plates ?? []).map((plate) => plate.id === plateId ? updatedPlate : plate),
  };
}

export function addFrame3DPlateOpening(
  model: Frame3DModel,
  plateId: number,
  nodeIds: number[],
  cornerRadiusOrOptions: number | { cornerRadiusM?: number; boundary?: Frame3DPlateBoundarySegment[] } = 0,
): Frame3DModel {
  const plate = (model.plates ?? []).find((item) => item.id === plateId);
  if (!plate) throw new Error(`3D-plaat ${plateId} bestaat niet.`);
  const options = typeof cornerRadiusOrOptions === "number"
    ? { cornerRadiusM: cornerRadiusOrOptions }
    : cornerRadiusOrOptions;
  const id = nextEntityId(plate.openings ?? []);
  const parsed = parseFrame3DModel({
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

export function removeFrame3DPlate(model: Frame3DModel, plateId: number): Frame3DModel {
  return { ...model, plates: (model.plates ?? []).filter((plate) => plate.id !== plateId),
    surfaceLoads: (model.surfaceLoads ?? []).filter((load) => load.plateId !== plateId),
    plateEdgeLoads: (model.plateEdgeLoads ?? []).filter((load) => load.plateId !== plateId) };
}

export function addFrame3DVolume(model: Frame3DModel, volume: Omit<Frame3DVolume, "id">): Frame3DModel {
  const id = nextEntityId(model.volumes ?? []);
  const parsed = parseFrame3DModel({ ...model, volumes: [...(model.volumes ?? []), { ...volume, id }] });
  const added = parsed.volumes?.find((item) => item.id === id);
  if (!added) throw new Error(`3D-volume ${id} kon niet worden gevalideerd.`);
  return { ...model, volumes: [...(model.volumes ?? []), added] };
}

export function updateFrame3DVolume(
  model: Frame3DModel, volumeId: number, patch: Partial<Omit<Frame3DVolume, "id">>,
): Frame3DModel {
  if (!(model.volumes ?? []).some((volume) => volume.id === volumeId)) throw new Error(`3D-volume ${volumeId} bestaat niet.`);
  const parsed = parseFrame3DModel({ ...model, volumes: (model.volumes ?? []).map((volume) =>
    volume.id === volumeId ? { ...volume, ...patch } : volume) });
  const updated = parsed.volumes?.find((volume) => volume.id === volumeId);
  if (!updated) throw new Error(`3D-volume ${volumeId} kon niet worden gevalideerd.`);
  return { ...model, volumes: (model.volumes ?? []).map((volume) => volume.id === volumeId ? updated : volume) };
}

export function removeFrame3DVolume(model: Frame3DModel, volumeId: number): Frame3DModel {
  return { ...model, volumes: (model.volumes ?? []).filter((volume) => volume.id !== volumeId),
    volumeBodyLoads: (model.volumeBodyLoads ?? []).filter((load) => load.volumeId !== volumeId),
    volumeFaceLoads: (model.volumeFaceLoads ?? []).filter((load) => load.volumeId !== volumeId) };
}

export function addFrame3DVolumeFaceLoad(
  model: Frame3DModel, volumeId: number, faceIndex: number,
  tractionKnPerM2: [number, number, number], caseId?: number,
): Frame3DModel {
  const id = nextEntityId(model.volumeFaceLoads ?? []);
  return parseFrame3DModel({ ...model, volumeFaceLoads: [...(model.volumeFaceLoads ?? []),
    { id, volumeId, faceIndex, tractionKnPerM2, ...(caseId !== undefined ? { caseId } : {}) }] });
}

export function updateFrame3DVolumeFaceLoad(
  model: Frame3DModel, loadId: number, patch: Pick<Frame3DVolumeFaceLoad, "faceIndex" | "tractionKnPerM2">,
): Frame3DModel {
  if (!(model.volumeFaceLoads ?? []).some((load) => load.id === loadId)) throw new Error(`3D-volumevlaktractie ${loadId} bestaat niet.`);
  return parseFrame3DModel({ ...model, volumeFaceLoads: (model.volumeFaceLoads ?? []).map((load) =>
    load.id === loadId ? { ...load, ...patch } : load) });
}

export function removeFrame3DVolumeFaceLoad(model: Frame3DModel, loadId: number): Frame3DModel {
  return { ...model, volumeFaceLoads: (model.volumeFaceLoads ?? []).filter((load) => load.id !== loadId) };
}

export function addFrame3DVolumeBodyLoad(
  model: Frame3DModel, volumeId: number, forceKnPerM3: [number, number, number], caseId?: number,
): Frame3DModel {
  const id = nextEntityId(model.volumeBodyLoads ?? []);
  return parseFrame3DModel({ ...model, volumeBodyLoads: [...(model.volumeBodyLoads ?? []),
    { id, volumeId, forceKnPerM3, ...(caseId !== undefined ? { caseId } : {}) }] });
}

export function updateFrame3DVolumeBodyLoad(
  model: Frame3DModel, loadId: number, forceKnPerM3: [number, number, number],
): Frame3DModel {
  if (!(model.volumeBodyLoads ?? []).some((load) => load.id === loadId)) throw new Error(`3D-volumekracht ${loadId} bestaat niet.`);
  return parseFrame3DModel({ ...model, volumeBodyLoads: (model.volumeBodyLoads ?? []).map((load) =>
    load.id === loadId ? { ...load, forceKnPerM3 } : load) });
}

export function removeFrame3DVolumeBodyLoad(model: Frame3DModel, loadId: number): Frame3DModel {
  return { ...model, volumeBodyLoads: (model.volumeBodyLoads ?? []).filter((load) => load.id !== loadId) };
}

export function addFrame3DPlateEdgeLoad(
  model: Frame3DModel, plateId: number, edgeIndex: number, startKnPerM: number, endKnPerM: number, caseId?: number,
): Frame3DModel {
  const id = nextEntityId(model.plateEdgeLoads ?? []);
  return parseFrame3DModel({ ...model, plateEdgeLoads: [...(model.plateEdgeLoads ?? []),
    { id, plateId, edgeIndex, startKnPerM, endKnPerM, ...(caseId !== undefined ? { caseId } : {}) }] });
}

export function updateFrame3DPlateEdgeLoad(
  model: Frame3DModel, loadId: number, values: Pick<Frame3DPlateEdgeLoad, "edgeIndex" | "startKnPerM" | "endKnPerM">,
): Frame3DModel {
  if (!(model.plateEdgeLoads ?? []).some((load) => load.id === loadId)) throw new Error(`3D-plaatrandbelasting ${loadId} bestaat niet.`);
  return parseFrame3DModel({ ...model, plateEdgeLoads: (model.plateEdgeLoads ?? []).map((load) => load.id === loadId ? { ...load, ...values } : load) });
}

export function removeFrame3DPlateEdgeLoad(model: Frame3DModel, loadId: number): Frame3DModel {
  return { ...model, plateEdgeLoads: (model.plateEdgeLoads ?? []).filter((load) => load.id !== loadId) };
}

export function addFrame3DSurfaceLoad(
  model: Frame3DModel, plateId: number, values: Pick<Frame3DSurfaceLoad, "qx" | "qy" | "qz">, caseId?: number,
): Frame3DModel {
  const id = nextEntityId(model.surfaceLoads ?? []);
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
  const removedVolumeIds = new Set((model.volumes ?? []).filter((volume) => volume.nodeIds.includes(nodeId))
    .map((volume) => volume.id));
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
    volumes: (model.volumes ?? []).filter((volume) => !volume.nodeIds.includes(nodeId)),
    volumeBodyLoads: (model.volumeBodyLoads ?? []).filter((load) => !removedVolumeIds.has(load.volumeId)),
    volumeFaceLoads: (model.volumeFaceLoads ?? []).filter((load) => !removedVolumeIds.has(load.volumeId)),
    surfaceLoads: (model.surfaceLoads ?? []).filter((load) => !removedPlateIds.has(load.plateId)),
    plateEdgeLoads: (model.plateEdgeLoads ?? []).filter((load) => !removedPlateIds.has(load.plateId)),
  };
}

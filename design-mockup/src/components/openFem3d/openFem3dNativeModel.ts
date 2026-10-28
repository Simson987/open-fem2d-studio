/**
 * Velden van de native Rust-3D-route (Open FEM Rust, `openaec-native-fem`) in
 * het Open FEM 3D-model.
 *
 * Het ontwikkelspoor `frame3d` bewaarde volumes (Tet4/Hex8), volumelasten,
 * plaatrandlasten, axiale staven, materiaalwetten en membraanplaten in
 * hetzelfde `model3d`. Open FEM 3D kent die velden niet zelf; deze module
 * leest ze (met de keuring van `parseFrame3DModel`, zodat beide sporen exact
 * dezelfde regels hanteren), hangt ze aan het Open FEM 3D-model en zet het
 * model terug om naar het `Frame3DModel` dat de native route rekent.
 *
 * Bewust alleen type-imports uit `openFem3dModel`: dat bestand importeert
 * deze module, en een waarde-import terug zou een kringverwijzing geven.
 */
import {
  parseFrame3DModel,
  type Frame3DBeam,
  type Frame3DModel,
  type Frame3DPlate,
  type Frame3DPlateEdgeSupport,
} from "../frame3d/frame3dModel";
import type {
  OpenFem3DModel,
  OpenFem3DPlate,
  OpenFem3DPlateEdgeSupport,
  OpenFem3DSupportRestraints,
} from "./openFem3dModel";

/** Modelvelden die alleen de native route rekent. */
export const OPEN_FEM_3D_NATIVE_MODEL_KEYS = [
  "volumes", "volumeBodyLoads", "volumeFaceLoads", "plateEdgeLoads", "materialLoadPath",
  "volumeBackend", "volumeMaterialKinematics", "volumeThreads", "volumeResidualTolerance",
] as const;
/** Staafvelden die alleen de native route rekent. */
export const OPEN_FEM_3D_NATIVE_BEAM_KEYS = ["axialOnly", "nonlinearLaw"] as const;
/** Plaatvelden die alleen de native route rekent. */
export const OPEN_FEM_3D_NATIVE_PLATE_KEYS = [
  "membraneOnly", "membraneEMpa", "membranePoisson", "modulusCurve", "nonlinearLaw",
  "maxCellSizeM", "reinforcement", "threeLayer",
] as const;

export type OpenFem3DNativeModelFields = Pick<Frame3DModel, typeof OPEN_FEM_3D_NATIVE_MODEL_KEYS[number]>;
export type OpenFem3DNativeBeamFields = Pick<Frame3DBeam, typeof OPEN_FEM_3D_NATIVE_BEAM_KEYS[number]>;
export type OpenFem3DNativePlateFields = Pick<Frame3DPlate, typeof OPEN_FEM_3D_NATIVE_PLATE_KEYS[number]>;

type RawRecord = Record<string, unknown>;
type Point = { x: number; y: number; z: number };
const AXES = ["x", "y", "z"] as const;
const TRANSLATION = { x: "ux", y: "uy", z: "uz" } as const;
const ROTATION = { x: "rx", y: "ry", z: "rz" } as const;
const NO_RESTRAINTS: OpenFem3DSupportRestraints = { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };

const isRecord = (value: unknown): value is RawRecord =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Heeft het ruwe model (of een staaf/plaat erin) een veld van de native route? */
export function hasOpenFem3DNativeFields(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  if (OPEN_FEM_3D_NATIVE_MODEL_KEYS.some((key) => raw[key] !== undefined)) return true;
  const beams = Array.isArray(raw.beams) ? raw.beams : [];
  if (beams.some((beam) => isRecord(beam) && OPEN_FEM_3D_NATIVE_BEAM_KEYS.some((key) => beam[key] !== undefined))) return true;
  const plates = Array.isArray(raw.plates) ? raw.plates : [];
  return plates.some((plate) => isRecord(plate) && OPEN_FEM_3D_NATIVE_PLATE_KEYS.some((key) => plate[key] !== undefined));
}

/**
 * De globale as waarlangs de plaatnormaal ligt, of null bij een schuine plaat.
 * Newell-normaal over de buitenrand; een plaat is "evenwijdig aan een
 * coördinatenvlak" als de normaal op 1e-9 na met een globale as samenvalt.
 */
function plateNormalAxis(points: readonly Point[]): "x" | "y" | "z" | null {
  const normal = [0, 0, 0];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    normal[0] += (a.y - b.y) * (a.z + b.z);
    normal[1] += (a.z - b.z) * (a.x + b.x);
    normal[2] += (a.x - b.x) * (a.y + b.y);
  }
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  if (!(length > 0)) return null;
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(normal[axis]) / length > 1 - 1e-9) return AXES[axis];
  }
  return null;
}

/**
 * De globale opleggingen die precies overeenkomen met een frame3d-randtype op
 * een plaat met de normaal langs `axis`. In het frame3d-formaat geldt de
 * randoplegging in plaatassen (frame3dPlateSolver): "simplySupported" houdt de
 * verplaatsing w loodrecht op de plaat vast, "clamped" daarnaast beide
 * rotaties om de in-vlakassen. Bij een plaat evenwijdig aan een globaal vlak is
 * dat exact u langs de normaal plus de rotaties om de twee andere globale assen.
 */
function restraintsForKind(kind: "simplySupported" | "clamped", axis: "x" | "y" | "z"): OpenFem3DSupportRestraints {
  const restraints = { ...NO_RESTRAINTS, [TRANSLATION[axis]]: true };
  if (kind === "clamped") {
    for (const other of AXES) if (other !== axis) restraints[ROTATION[other]] = true;
  }
  return restraints;
}

/**
 * Zet de frame3d-randoplegging (vier namen, één per hoekpuntrand) om naar de
 * Open FEM 3D-vorm (lijst `{ edge, ux … rz }` in globale assen). Een lege
 * uitkomst betekent: alle randen vrij.
 */
export function legacyFrame3DEdgeSupportsToOpenFem3D(
  kinds: readonly unknown[],
  loop: readonly number[],
  nodeIndex: ReadonlyMap<number, Point>,
  label: string,
): OpenFem3DPlateEdgeSupport[] {
  if (loop.length !== 4 || kinds.length !== 4
      || kinds.some((kind) => kind !== "free" && kind !== "simplySupported" && kind !== "clamped")) {
    throw new Error(`${label} bevat een ongeldige randoplegging: het frame3d-formaat vraagt vier randen (vrij, scharnier of inklemming) bij vier hoekknopen.`);
  }
  if (kinds.every((kind) => kind === "free")) return [];
  const axis = plateNormalAxis(loop.map((id) => nodeIndex.get(id)!));
  if (axis === null) {
    throw new Error(`${label} bevat een randoplegging in plaatassen (frame3d-formaat); die is alleen om te zetten bij een plaat evenwijdig aan een globaal coördinatenvlak.`);
  }
  const supports: OpenFem3DPlateEdgeSupport[] = [];
  kinds.forEach((kind, edge) => {
    if (kind === "free") return;
    supports.push({ edge, ...restraintsForKind(kind as "simplySupported" | "clamped", axis) });
  });
  return supports;
}

/**
 * Omgekeerde omzetting voor de native route. Gooit als de Open FEM 3D-
 * randoplegging niet exact als frame3d-randtype te schrijven is.
 */
export function openFem3DEdgeSupportsToFrame3D(
  plate: Pick<OpenFem3DPlate, "id" | "nodeIds" | "boundary" | "edgeSupports">,
  nodeIndex: ReadonlyMap<number, Point>,
): Frame3DPlate["edgeSupports"] | undefined {
  const supports = plate.edgeSupports ?? [];
  if (supports.length === 0) return undefined;
  const label = `3D-plaat ${plate.id}`;
  const straightQuad = plate.nodeIds.length === 4 && (!plate.boundary || plate.boundary.length === 4
    && plate.boundary.every((segment, index) => segment.kind === "line" && segment.startNodeId === plate.nodeIds[index]));
  if (!straightQuad) {
    throw new Error(`${label}: Open FEM Rust rekent randopleggingen alleen op een plaat met vier rechte randen.`);
  }
  const axis = plateNormalAxis(plate.nodeIds.map((id) => nodeIndex.get(id)!));
  if (axis === null) {
    throw new Error(`${label}: Open FEM Rust rekent randopleggingen alleen op een plaat evenwijdig aan een globaal coördinatenvlak.`);
  }
  const kinds: Frame3DPlateEdgeSupport[] = ["free", "free", "free", "free"];
  const keys = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;
  for (const support of supports) {
    const kind = (["simplySupported", "clamped"] as const).find((candidate) => {
      const expected = restraintsForKind(candidate, axis);
      return keys.every((key) => expected[key] === support[key]);
    });
    if (!kind) {
      throw new Error(`${label}: de randoplegging op rand ${support.edge + 1} is in Open FEM Rust niet te rekenen `
        + "(alleen scharnierend of ingeklemd loodrecht op de plaat).");
    }
    kinds[support.edge] = kind;
  }
  return kinds as Frame3DPlate["edgeSupports"];
}

function pick(source: RawRecord, keys: readonly string[]): RawRecord {
  const result: RawRecord = {};
  for (const key of keys) if (source[key] !== undefined) result[key] = source[key];
  return result;
}

/**
 * Lees de native velden van `raw` en hang ze aan het al gekeurde Open FEM 3D-
 * model `model`. De keuring loopt via `parseFrame3DModel` op een beperkt model
 * (knopen, staaf- en plaatgeometrie uit `model`, plus de native velden uit
 * `raw`), zodat de Open FEM 3D-velden die frame3d niet kent geen rol spelen.
 */
export function attachOpenFem3DNativeFields(raw: unknown, model: OpenFem3DModel): void {
  if (!isRecord(raw) || !hasOpenFem3DNativeFields(raw)) return;
  const nodeIndex = new Map(model.nodes.map((node) => [node.id, node]));
  const rawBeams = (Array.isArray(raw.beams) ? raw.beams : []) as RawRecord[];
  const rawPlates = (Array.isArray(raw.plates) ? raw.plates : []) as RawRecord[];
  const rawBeamById = new Map(rawBeams.map((beam) => [beam.id, beam]));
  const rawPlateById = new Map(rawPlates.map((plate) => [plate.id, plate]));
  const reduced: RawRecord = {
    ...pick(raw, OPEN_FEM_3D_NATIVE_MODEL_KEYS),
    nodes: model.nodes.map(({ id, x, y, z }) => ({ id, x, y, z })),
    beams: model.beams.map((beam) => ({
      id: beam.id, startNodeId: beam.startNodeId, endNodeId: beam.endNodeId,
      ...(beam.profileName !== undefined ? { profileName: beam.profileName } : {}),
      ...(beam.material !== undefined ? { material: beam.material } : {}),
      ...(beam.rollAngleRad !== undefined ? { rollAngleRad: beam.rollAngleRad } : {}),
      ...(beam.releases !== undefined ? { releases: beam.releases } : {}),
      ...pick(rawBeamById.get(beam.id) ?? {}, OPEN_FEM_3D_NATIVE_BEAM_KEYS),
    })),
    plates: (model.plates ?? []).map((plate) => {
      let edgeSupports: Frame3DPlate["edgeSupports"] | undefined;
      try {
        edgeSupports = openFem3DEdgeSupportsToFrame3D(plate, nodeIndex);
      } catch {
        // Niet als frame3d-randtype te schrijven: dan keurt de native route
        // de plaat pas bij het rekenen (met een duidelijke melding).
        edgeSupports = undefined;
      }
      return {
        id: plate.id, nodeIds: plate.nodeIds, thicknessM: plate.thicknessM,
        ...(plate.boundary !== undefined ? { boundary: plate.boundary } : {}),
        ...(plate.material !== undefined ? { material: plate.material } : {}),
        ...(plate.cornerRadiusM !== undefined ? { cornerRadiusM: plate.cornerRadiusM } : {}),
        ...(plate.openings !== undefined ? { openings: plate.openings } : {}),
        ...(edgeSupports !== undefined && rawPlateById.get(plate.id)?.membraneOnly !== true ? { edgeSupports } : {}),
        ...pick(rawPlateById.get(plate.id) ?? {}, OPEN_FEM_3D_NATIVE_PLATE_KEYS),
      };
    }),
  };
  const native = parseFrame3DModel(reduced);
  const target = model as unknown as RawRecord;
  for (const key of OPEN_FEM_3D_NATIVE_MODEL_KEYS) {
    const value = (native as unknown as RawRecord)[key];
    if (value === undefined || Array.isArray(value) && value.length === 0 && key !== "materialLoadPath") continue;
    target[key] = value;
  }
  native.beams.forEach((nativeBeam, index) => {
    const beam = model.beams[index] as unknown as RawRecord;
    for (const key of OPEN_FEM_3D_NATIVE_BEAM_KEYS) {
      const value = (nativeBeam as unknown as RawRecord)[key];
      if (value !== undefined) beam[key] = value;
    }
  });
  (native.plates ?? []).forEach((nativePlate, index) => {
    const plate = model.plates![index] as unknown as RawRecord;
    for (const key of OPEN_FEM_3D_NATIVE_PLATE_KEYS) {
      const value = (nativePlate as unknown as RawRecord)[key];
      if (value !== undefined) plate[key] = value;
    }
  });
}

/**
 * Onderdelen van het model die alleen de native route rekent. Een model met
 * één van deze onderdelen gaat automatisch naar Open FEM Rust: Open FEM 3D
 * zou ze stil negeren (een membraanplaat als schaal, een axiale staaf als
 * buigstaaf, volumes helemaal niet).
 */
export type OpenFem3DNativeFeature =
  | "volumes" | "volumeLoads" | "plateEdgeLoads" | "axialOnly" | "nonlinearLaw"
  | "membraneOnly" | "modulusCurve" | "reinforcement" | "threeLayer" | "materialLoadPath";

export function openFem3DNativeFeatures(model: OpenFem3DModel): OpenFem3DNativeFeature[] {
  const features: OpenFem3DNativeFeature[] = [];
  if ((model.volumes?.length ?? 0) > 0) features.push("volumes");
  if ((model.volumeBodyLoads?.length ?? 0) + (model.volumeFaceLoads?.length ?? 0) > 0) features.push("volumeLoads");
  if ((model.plateEdgeLoads?.length ?? 0) > 0) features.push("plateEdgeLoads");
  if (model.beams.some((beam) => beam.axialOnly)) features.push("axialOnly");
  if (model.beams.some((beam) => beam.nonlinearLaw) || (model.plates ?? []).some((plate) => plate.nonlinearLaw)) {
    features.push("nonlinearLaw");
  }
  const plates = model.plates ?? [];
  if (plates.some((plate) => plate.membraneOnly)) features.push("membraneOnly");
  if (plates.some((plate) => plate.modulusCurve)) features.push("modulusCurve");
  if (plates.some((plate) => plate.reinforcement)) features.push("reinforcement");
  if (plates.some((plate) => plate.threeLayer)) features.push("threeLayer");
  if (model.materialLoadPath !== undefined) features.push("materialLoadPath");
  return features;
}

/**
 * Onderdelen van het Open FEM 3D-model die de native route (nog) niet rekent.
 * Liever een duidelijke weigering dan een uitkomst zonder die onderdelen.
 */
export function openFem3DFeaturesWithoutNativeRoute(model: OpenFem3DModel): string[] {
  const missing: string[] = [];
  if ((model.loadPanels?.length ?? 0) > 0) missing.push("belastingvlakken");
  if ((model.envelopePanels?.length ?? 0) > 0) missing.push("gebouwschil");
  if ((model.diaphragms?.length ?? 0) > 0) missing.push("starre schijven");
  if (model.beams.some((beam) => beam.bedding) || (model.plates ?? []).some((plate) => plate.bedding)) missing.push("bedding");
  if (model.beams.some((beam) => beam.tensionOnly)) missing.push("trek-alleen staven");
  if (model.beams.some((beam) => beam.profileNameEnd !== undefined)) missing.push("verlopende staven");
  if (model.beams.some((beam) => beam.shearDeformation)) missing.push("afschuifvervorming");
  if (model.analysisMaterials && Object.keys(model.analysisMaterials).length > 0) missing.push("analyse-E per materiaal");
  if ((model.memberLoads ?? []).some((load) => load.globalDirection !== undefined)) missing.push("globale lijnlasten");
  return missing;
}

/**
 * Zet een Open FEM 3D-model om naar het `Frame3DModel` van de native route.
 * Weigert onderdelen die de native route niet rekent; zet plaatrand-
 * opleggingen terug naar het frame3d-formaat en keurt het geheel opnieuw.
 */
export function openFem3DToFrame3DModel(model: OpenFem3DModel): Frame3DModel {
  const missing = openFem3DFeaturesWithoutNativeRoute(model);
  if (missing.length > 0) {
    throw new Error(`Open FEM Rust rekent dit 3D-model niet: ${missing.join(", ")} ${missing.length === 1 ? "wordt" : "worden"} `
      + "in die route nog niet ondersteund. Kies Open FEM 3D of verwijder deze onderdelen.");
  }
  const nodeIndex = new Map(model.nodes.map((node) => [node.id, node]));
  const raw: RawRecord = {
    ...model,
    nodes: model.nodes.map(({ id, x, y, z }) => ({ id, x, y, z })),
    plates: (model.plates ?? []).map((plate) => {
      const { edgeSupports: _edgeSupports, bedding: _bedding, levelId: _levelId, meshSizeM, layerId: _layerId, ...rest } = plate;
      const edgeSupports = openFem3DEdgeSupportsToFrame3D(plate, nodeIndex);
      // De elementgrootte van Open FEM 3D is in de native route de maximale
      // Q4-celmaat; een membraanplaat (Tri3) kent die niet.
      const cellSize = !plate.membraneOnly && plate.maxCellSizeM === undefined && meshSizeM !== undefined
        ? { maxCellSizeM: meshSizeM } : {};
      return { ...rest, ...cellSize, ...(edgeSupports ? { edgeSupports } : {}) };
    }),
  };
  return parseFrame3DModel(raw);
}

/** Heeft de plaatrandoplegging al de frame3d-vorm (vier namen)? */
export function isFrame3DEdgeSupportTuple(value: unknown): boolean {
  return Array.isArray(value) && value.every((kind) => typeof kind === "string");
}

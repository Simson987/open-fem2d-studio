import type { NativePrestressedBeamInput } from "./nativeFemClient";

export type PrestressedBeamPointLoad = { positionM: number; downwardKn: number };
export type PrestressedBeamLineLoad = {
  startM: number;
  endM: number;
  startDownwardKnPerM: number;
  endDownwardKnPerM: number;
};

export type PrestressedBeamFields = {
  spanM: number;
  areaM2: number;
  inertiaM4: number;
  fibreDepthM: number;
  segmentModuliMpa: number[];
  segmentBoundariesM: number[];
  tendonEndM: number;
  tendonMidM: number;
  initialForceKn: number;
  lossPercent: number;
  transferLoadKnPerM: number;
  serviceLoadKnPerM: number;
  transferPointLoads: PrestressedBeamPointLoad[];
  servicePointLoads: PrestressedBeamPointLoad[];
  transferLineLoads: PrestressedBeamLineLoad[];
  serviceLineLoads: PrestressedBeamLineLoad[];
  webWidthMm: number;
  effectiveDepthMm: number;
  leverArmMm: number;
  alphaCW: number;
  nu1: number;
  fcdMpa: number;
  fywdMpa: number;
  cotTheta: number;
  providedAswMm2: number;
  providedSpacingMm: number;
};

export const INITIAL_PRESTRESSED_BEAM_FIELDS: PrestressedBeamFields = {
  spanM: 10,
  areaM2: 0.5,
  inertiaM4: 0.02,
  fibreDepthM: 0.3,
  segmentModuliMpa: [30_000, 30_000],
  segmentBoundariesM: [5],
  tendonEndM: 0,
  tendonMidM: 0.2,
  initialForceKn: 1_000,
  lossPercent: 20,
  transferLoadKnPerM: 0,
  serviceLoadKnPerM: 16,
  transferPointLoads: [],
  servicePointLoads: [],
  transferLineLoads: [],
  serviceLineLoads: [],
  webWidthMm: 300,
  effectiveDepthMm: 500,
  leverArmMm: 450,
  alphaCW: 1,
  nu1: 0.6,
  fcdMpa: 20,
  fywdMpa: 435,
  cotTheta: 2,
  providedAswMm2: 157,
  providedSpacingMm: 150,
};

export function buildPrestressedBeamInput(fields: PrestressedBeamFields): NativePrestressedBeamInput {
  const scalarValues = Object.values(fields).filter((value): value is number => typeof value === "number");
  if (scalarValues.some((value) => !Number.isFinite(value))) {
    throw new Error("Alle numerieke liggerinvoer moet eindig zijn.");
  }
  const positiveValues: Array<[string, number]> = [
    ["oppervlak A", fields.areaM2], ["traagheidsmoment I", fields.inertiaM4],
    ["vezelafstand", fields.fibreDepthM], ["beginvoorspankracht", fields.initialForceKn],
    ["breedte lijf", fields.webWidthMm], ["effectieve hoogte", fields.effectiveDepthMm],
    ["hefboomsarm z", fields.leverArmMm], ["alpha-cw", fields.alphaCW],
    ["nu1", fields.nu1], ["fcd", fields.fcdMpa], ["fywd", fields.fywdMpa],
    ["aanwezige beugeldoorsnede", fields.providedAswMm2], ["beugelafstand", fields.providedSpacingMm],
  ];
  const invalidPositive = positiveValues.find(([, value]) => value <= 0);
  if (invalidPositive) {
    throw new Error(`${invalidPositive[0]} moet positief zijn.`);
  }
  if (fields.lossPercent < 0 || fields.lossPercent > 100) {
    throw new Error("Voorspanverlies moet tussen 0 en 100 procent liggen.");
  }
  if (fields.cotTheta < 1 || fields.cotTheta > 2.5) {
    throw new Error("cot(theta) moet tussen 1,0 en 2,5 liggen.");
  }
  if (fields.nu1 > 1 || fields.effectiveDepthMm >= 2 * fields.fibreDepthM * 1000
      || fields.leverArmMm > fields.effectiveDepthMm) {
    throw new Error("Controleer nu1, effectieve hoogte en hefboomsarm ten opzichte van de doorsnede.");
  }
  const moduli = fields.segmentModuliMpa.length ? fields.segmentModuliMpa : [30_000];
  const segmentCount = moduli.length;
  const boundaries = fields.segmentBoundariesM;
  if (!Number.isFinite(fields.spanM) || fields.spanM <= 0 || segmentCount > 12
      || boundaries.length !== segmentCount - 1
      || boundaries.some((position, index) => !Number.isFinite(position) || position <= 0
        || position >= fields.spanM || (index > 0 && position <= boundaries[index - 1]))) {
    throw new Error("E-segmentgrenzen moeten oplopend binnen de overspanning liggen, met één grens tussen segmenten.");
  }
  if (moduli.some((eMpa) => !Number.isFinite(eMpa) || eMpa <= 0)) {
    throw new Error("Iedere E-segmentwaarde moet eindig en positief zijn.");
  }
  const validatePointLoads = (loads: PrestressedBeamPointLoad[]) => loads.every((load) =>
    Number.isFinite(load.downwardKn) && (load.downwardKn === 0
      || (Number.isFinite(load.positionM) && load.positionM > 0 && load.positionM < fields.spanM)));
  if (!validatePointLoads(fields.transferPointLoads) || !validatePointLoads(fields.servicePointLoads)) {
    throw new Error("Actieve puntlasten moeten een eindige last en een positie tussen de steunpunten hebben.");
  }
  const validateLineLoads = (loads: PrestressedBeamLineLoad[]) => loads.every((load) =>
    Number.isFinite(load.startM) && Number.isFinite(load.endM)
      && load.startM >= 0 && load.endM <= fields.spanM && load.startM < load.endM
      && Number.isFinite(load.startDownwardKnPerM) && Number.isFinite(load.endDownwardKnPerM));
  if (!validateLineLoads(fields.transferLineLoads) || !validateLineLoads(fields.serviceLineLoads)) {
    throw new Error("Gedeeltelijke lijnlasten moeten eindig en binnen de overspanning liggen, met begin vóór einde.");
  }
  const ends = [...boundaries, fields.spanM];
  const stiffnessSegments = moduli.map((eMpa, index) => ({
    startM: index === 0 ? 0 : ends[index - 1],
    endM: ends[index],
    eMpa,
  }));
  return {
    spanM: fields.spanM,
    section: {
      areaM2: fields.areaM2,
      inertiaM4: fields.inertiaM4,
      topFibreM: fields.fibreDepthM,
      bottomFibreM: fields.fibreDepthM,
      eMpa: moduli[0],
    },
    stiffnessSegments,
    tendon: {
      kind: "parabolic",
      endEccentricityM: fields.tendonEndM,
      midEccentricityM: fields.tendonMidM,
    },
    initialForceKn: fields.initialForceKn,
    lossFraction: fields.lossPercent / 100,
    transferUniformDownwardKnPerM: fields.transferLoadKnPerM,
    serviceUniformDownwardKnPerM: fields.serviceLoadKnPerM,
    ...(fields.transferPointLoads.some((load) => load.downwardKn !== 0)
      ? { transferPointLoads: fields.transferPointLoads.filter((load) => load.downwardKn !== 0) } : {}),
    ...(fields.servicePointLoads.some((load) => load.downwardKn !== 0)
      ? { servicePointLoads: fields.servicePointLoads.filter((load) => load.downwardKn !== 0) } : {}),
    ...(fields.transferLineLoads.some((load) => load.startDownwardKnPerM !== 0 || load.endDownwardKnPerM !== 0)
      ? { transferLineLoads: fields.transferLineLoads.filter((load) =>
        load.startDownwardKnPerM !== 0 || load.endDownwardKnPerM !== 0) } : {}),
    ...(fields.serviceLineLoads.some((load) => load.startDownwardKnPerM !== 0 || load.endDownwardKnPerM !== 0)
      ? { serviceLineLoads: fields.serviceLineLoads.filter((load) =>
        load.startDownwardKnPerM !== 0 || load.endDownwardKnPerM !== 0) } : {}),
    stationsXM: [fields.spanM / 4, fields.spanM / 2, 3 * fields.spanM / 4,
      ...boundaries,
      ...fields.transferPointLoads.filter((load) => load.downwardKn !== 0).map((load) => load.positionM),
      ...fields.servicePointLoads.filter((load) => load.downwardKn !== 0).map((load) => load.positionM),
      ...fields.transferLineLoads.filter((load) => load.startDownwardKnPerM !== 0 || load.endDownwardKnPerM !== 0)
        .flatMap((load) => [load.startM, load.endM]),
      ...fields.serviceLineLoads.filter((load) => load.startDownwardKnPerM !== 0 || load.endDownwardKnPerM !== 0)
        .flatMap((load) => [load.startM, load.endM])],
    shearLinks: {
      webWidthMm: fields.webWidthMm,
      effectiveDepthMm: fields.effectiveDepthMm,
      leverArmMm: fields.leverArmMm,
      alphaCw: fields.alphaCW,
      nu1: fields.nu1,
      fcdMpa: fields.fcdMpa,
      fywdMpa: fields.fywdMpa,
      cotTheta: fields.cotTheta,
      providedAswMm2: fields.providedAswMm2,
      providedSpacingMm: fields.providedSpacingMm,
    },
  };
}

import { solveNativeVolume3DConcreteDamage, solveNativeVolume3DFiniteJ2, solveNativeVolume3DFiniteJ2Coupled,
  solveNativeVolume3DFiniteJ2FrameCoupled,
  solveNativeVolume3DFiniteJ2HexCoupled,
  solveNativeVolume3DFiniteJ2MembraneCoupled, solveNativeVolume3DJ2,
  type NativeVolume3DConcreteDamageInput, type NativeVolume3DFiniteJ2Input,
  type NativeVolume3DFiniteJ2HexCoupledInput,
  type NativeVolume3DFiniteJ2FrameCoupledInput,
  type NativeVolume3DJ2Input } from "../../lib/nativeFemClient";
import { frame3DMemberAxes, type Frame3DMemberLoad, type Frame3DMemberPointLoad,
  type Frame3DModel, type Frame3DVolume } from "./frame3dModel";
import type { Frame3DSolveResult } from "./frame3dSolver";
import { cauchyStress } from "./frame3dVolumeGnl";
import { frame3DVolumeMemberDiagrams } from "./frame3dVolumeDiagrams";

type Vector3 = [number, number, number];
type Stress = [number, number, number, number, number, number];
type Tensor3 = [Vector3, Vector3, Vector3];
type BodyLoad = { element: number; forceKnPerM3: Vector3 };
type FaceLoad = { element: number; nodes: [number, number, number]; tractionKnPerM2: Vector3 };
type HexBodyLoad = { element: number; forceKnPerM3: Vector3 };
type HexFaceLoad = { element: number; faceNodes: [number, number, number, number]; tractionKnPerM2: Vector3 };
type CoupledTruss = { memberId: number; nodes: [number, number]; youngsMpa: number; areaM2: number;
  plasticity?: { yieldMpa: number; hardeningMpa: number } };
type CoupledMembrane = { plateId: number; nodes: [number, number, number];
  youngsMpa: number; poisson: number; thicknessM: number;
  plasticity?: { yieldMpa: number; hardeningMpa: number } };
type CoupledFrame = NativeVolume3DFiniteJ2FrameCoupledInput["frames"][number] & { memberId: number };
type CoupledBendingPlate = NonNullable<NativeVolume3DFiniteJ2FrameCoupledInput["bendingPlates"]>[number]
  & { plateId: number; nodeIds: [number, number, number] };
type BendingPlateResult = NonNullable<NonNullable<Frame3DSolveResult["volume3D"]>["bendingPlates"]>[number];
type Six = [number, number, number, number, number, number];

const finiteVector = (value: unknown): value is Vector3 =>
  Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === "number" && Number.isFinite(part));
const finiteStress = (value: unknown): value is Stress =>
  Array.isArray(value) && value.length === 6 && value.every((part) => typeof part === "number" && Number.isFinite(part));
const finiteSix = (value: unknown): value is Six =>
  Array.isArray(value) && value.length === 6 && value.every((part) => typeof part === "number" && Number.isFinite(part));
const finiteTensor = (value: unknown): value is Tensor3 =>
  Array.isArray(value) && value.length === 3 && value.every(finiteVector);
const cross = (a: Vector3, b: Vector3): Vector3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vonMises = ([sx, sy, sz, txy, tyz, tzx]: Stress) =>
  Math.sqrt(Math.max(0, ((sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2) / 2
    + 3 * (txy ** 2 + tyz ** 2 + tzx ** 2)));
const scalePrescribed = (values: [number | null, number | null, number | null], factor: number):
  [number | null, number | null, number | null] => [
    values[0] === null ? null : values[0] * factor,
    values[1] === null ? null : values[1] * factor,
    values[2] === null ? null : values[2] * factor,
  ];

/** History-dependent Tet4 and finite-strain steel-J2 Hex8 path in the ordinary 3D app. */
export async function solveFrame3DVolumeMaterial(
  model: Frame3DModel,
  nodes: Frame3DModel["nodes"],
  tets: Frame3DVolume[],
  loadsKn: Vector3[],
  appliedLoadsKn: Vector3[],
  prescribedM: Array<[number | null, number | null, number | null]>,
  bodyForces: BodyLoad[],
  faceTractions: FaceLoad[],
  trusses: CoupledTruss[] = [],
  membranes: CoupledMembrane[] = [],
  hexes: Frame3DVolume[] = [],
  hexBodyForces: HexBodyLoad[] = [],
  hexFaceTractions: HexFaceLoad[] = [],
  frames: CoupledFrame[] = [],
  momentsKnm: Vector3[] = nodes.map(() => [0, 0, 0]),
  appliedMomentsKnm: Vector3[] = momentsKnm,
  prescribedRotationsRad: Array<[number | null, number | null, number | null]> = nodes.map(() => [null, null, null]),
  geometricFrames = false,
  memberLineLoads: ReadonlyArray<{ load: Frame3DMemberLoad; factor: number }> = [],
  memberPointLoads: ReadonlyArray<{ load: Frame3DMemberPointLoad; factor: number }> = [],
  bendingPlates: CoupledBendingPlate[] = [],
): Promise<Frame3DSolveResult> {
  if (tets.length + hexes.length === 0 || [...tets, ...hexes].some((volume) => !volume.materialLaw)) {
    throw new Error("Volume-materiaal-FNL vereist een materiaalwet op ieder volume-element.");
  }
  const family = (tets[0] ?? hexes[0]).materialLaw!.kind;
  if ([...tets, ...hexes].some((volume) => volume.materialLaw!.kind !== family)) {
    throw new Error("Staal-J2 en betontrekschade kunnen nog niet in één volume-FNL-stelsel worden gemengd.");
  }
  const index = new Map(nodes.map((node, position) => [node.id, position]));
  const connectivity = tets.map((tet) => tet.nodeIds.map((id) => {
    const position = index.get(id);
    if (position === undefined) throw new Error(`Tet4 ${tet.id}: knoop ${id} ontbreekt.`);
    return position;
  }) as [number, number, number, number]);
  const mesh = { nodes: nodes.map((node) => [node.x, node.y, node.z] as Vector3), tets: connectivity };
  const factors = model.materialLoadPath?.length ? model.materialLoadPath : [1];
  const finiteKinematics = model.volumeMaterialKinematics === "finiteStrain";
  if (hexes.length > 0 && (!finiteKinematics || family !== "steelJ2")) {
    throw new Error("Hex8-materiaal-FNL vereist eindige-rek J2-staal; kleine-rek Hex8-materiaal-FNL en beton zijn nog niet gekoppeld.");
  }
  if ((trusses.length || membranes.length) && (!finiteKinematics || family !== "steelJ2")) {
    throw new Error("Gekoppelde trekstaven en Tri3-membranen vereisen eindige-rek J2-staalvolumes.");
  }
  if (frames.length && (!finiteKinematics || family !== "steelJ2")) {
    throw new Error("Gekoppelde buigende 3D-staven vereisen eindige-rek J2-staalvolumes; de staven zelf blijven elastisch.");
  }
  if (bendingPlates.length && (!frames.length || !finiteKinematics || family !== "steelJ2")) {
    throw new Error("Gekoppelde DKT-buigplaten vereisen de eindige-rek J2-volume/raamwerkroute; de platen blijven elastisch.");
  }
  if (momentsKnm.length !== nodes.length || prescribedRotationsRad.length !== nodes.length) {
    throw new Error("Volume-raamwerk: knoopmomenten en rotatievoorwaarden moeten alle knopen bevatten.");
  }
  if (factors.length > (finiteKinematics ? 64 : 100) || factors.some((factor) => !Number.isFinite(factor))) {
    throw new Error(`Tet4-materiaal-FNL vereist maximaal ${finiteKinematics ? 64 : 100} eindige absolute lastfactoren.`);
  }
  const targets = factors.map((factor) => ({
    loadsKn: loadsKn.map((load) => load.map((component) => component * factor) as Vector3),
    prescribedM: prescribedM.map((values) => scalePrescribed(values, factor)),
    bodyForces: bodyForces.map((load) => ({ element: load.element,
      forceKnPerM3: load.forceKnPerM3.map((component) => component * factor) as Vector3 })),
    faceTractions: faceTractions.map((load) => ({ element: load.element, faceNodes: load.nodes,
      tractionKnPerM2: load.tractionKnPerM2.map((component) => component * factor) as Vector3 })),
  }));
  const hexTargets: NativeVolume3DFiniteJ2HexCoupledInput["hexTargets"] = factors.map((factor) => ({
    bodyForces: hexBodyForces.map((load) => ({ element: load.element,
      forceKnPerM3: load.forceKnPerM3.map((component) => component * factor) as Vector3 })),
    faceTractions: hexFaceTractions.map((load) => ({ element: load.element, faceNodes: load.faceNodes,
      tractionKnPerM2: load.tractionKnPerM2.map((component) => component * factor) as Vector3 })),
  }));
  const requestedBackend = model.volumeBackend ?? "automatic";
  const residualTolerance = model.volumeResidualTolerance ?? 1e-9;
  if (!Number.isFinite(residualTolerance) || residualTolerance < 1e-12
      || residualTolerance > 1e-4) {
    throw new Error("De Newton-tolerantie voor volume-FNL moet tussen 1e-12 en 1e-4 liggen.");
  }
  let stress: Stress[];
  let hexStress: Stress[] = [];
  let hexGaussStress: Stress[][] = [];
  let hexGaussPlasticStrain: number[][] = [];
  let hexPlasticStrain: number[] = [];
  let firstPiolaMpa: Tensor3[] | undefined;
  let equivalentPlasticStrain: number[] | undefined;
  let tensileDamage: number[] | undefined;
  let nodalDisplacementsM: Vector3[];
  let nodalReactionsKn: Vector3[];
  let nodalRotationsRad: Vector3[] = nodes.map(() => [0, 0, 0]);
  let nodalReactionMomentsKnM: Vector3[] = nodes.map(() => [0, 0, 0]);
  let frameEndForcesLocal: Array<[Six, Six]> = [];
  let bendingPlateMomentsKnmPerM: Vector3[] = [];
  let acceptedSteps: Array<{ newtonIterations: number; targetIndex: number; targetFraction: number }>;
  let cutbacks: number;
  let trueFreeResidualKn: number;
  let backendUsed: string;
  let trussForcesKn: number[] = [];
  let trussStates: Array<{ plasticLogStrain: number; accumulatedPlasticLogStrain: number } | null> = [];
  let trussAlgorithmicModulusMpa: Array<number | null> = [];
  let membraneStressMpa: Array<[number, number, number]> = [];
  let membraneCauchyMpa: Array<[number, number, number] | null> = [];
  let membraneForceResultantKnPerM: Array<[number, number, number] | null> = [];
  let membraneStates: Array<{ equivalentPlasticStrain: number } | null> = [];
  let membraneThicknessStretch: Array<number | null> = [];
  if (family === "steelJ2") {
    const steels = tets.map((tet) => {
      const law = tet.materialLaw!;
      if (law.kind !== "steelJ2") throw new Error("Gemengde volume-FNL-materiaalwetten zijn niet beschikbaar.");
      return { youngsMpa: tet.eMpa, poisson: tet.poisson,
        yieldMpa: law.yieldMpa, hardeningMpa: law.hardeningMpa };
    });
    const hexCells: NativeVolume3DFiniteJ2HexCoupledInput["hexes"] = hexes.map((hex) => {
      const law = hex.materialLaw!;
      if (law.kind !== "steelJ2" || hex.nodeIds.length !== 8) {
        throw new Error(`Hex8 ${hex.id}: acht knopen en J2-staal zijn vereist.`);
      }
      const cellNodes = hex.nodeIds.map((id) => {
        const position = index.get(id);
        if (position === undefined) throw new Error(`Hex8 ${hex.id}: knoop ${id} ontbreekt.`);
        return position;
      }) as NativeVolume3DFiniteJ2HexCoupledInput["hexes"][number]["nodes"];
      return { nodes: cellNodes, steel: { youngsMpa: hex.eMpa, poisson: hex.poisson,
        yieldMpa: law.yieldMpa, hardeningMpa: law.hardeningMpa } };
    });
    if (finiteKinematics) {
      if (!["automatic", "dense", "sparseGmres", "frontalWave", "matrixFreeGmres", "matrixFreeGmresLarge"].includes(requestedBackend)) {
        throw new Error("Tet4-J2 bij eindige vervorming gebruikt Automatisch, Dicht, Sparse GMRES, Frontaal of Matrixvrij GMRES.");
      }
      const linearBackend = requestedBackend as NonNullable<NativeVolume3DFiniteJ2Input["options"]>["linearBackend"];
      const input: NativeVolume3DFiniteJ2Input = { mesh, steel: steels[0] ?? hexCells[0].steel,
        elementSteels: steels, targets,
        options: { linearBackend, ...(geometricFrames ? { geometricFrames: true } : {}),
          matrixFreeThreads: model.volumeThreads ?? 4,
          residualTolerance } };
      const coupledTrusses = trusses.map(({ nodes, youngsMpa, areaM2, plasticity }) =>
        ({ nodes, youngsMpa, areaM2, ...(plasticity ? { plasticity } : {}) }));
      const coupledMembranes = membranes.map(({ nodes, youngsMpa, poisson, thicknessM, plasticity }) =>
        ({ nodes, youngsMpa, poisson, thicknessM, ...(plasticity ? { plasticity } : {}) }));
      const frameTargets: NativeVolume3DFiniteJ2FrameCoupledInput["frameTargets"] = factors.map((factor) => ({
        momentsKnM: momentsKnm.map((moment) => moment.map((value) => value * factor) as Vector3),
        prescribedRotationRad: prescribedRotationsRad.map((values) => scalePrescribed(values, factor)),
      }));
      const frameIndexByMemberId = new Map(frames.map((frame, frameIndex) => [frame.memberId, frameIndex]));
      const frameMemberLoadTargets: NonNullable<NativeVolume3DFiniteJ2FrameCoupledInput["frameMemberLoadTargets"]> =
        memberLineLoads.length ? factors.map((targetFactor) => targetFactor === 0 ? []
          : memberLineLoads.map(({ load, factor }) => {
            const element = frameIndexByMemberId.get(load.beamId);
            if (element === undefined) throw new Error(`Staaflast ${load.id}: gekoppelde raamwerkstaaf ontbreekt.`);
            return { element,
              qyStartKnPerM: load.qyStart * factor * targetFactor,
              qyEndKnPerM: load.qyEnd * factor * targetFactor,
              qzStartKnPerM: load.qzStart * factor * targetFactor,
              qzEndKnPerM: load.qzEnd * factor * targetFactor,
              startPositionM: load.startPositionM, endPositionM: load.endPositionM };
          })) : [];
      const frameMemberPointLoadTargets: NonNullable<NativeVolume3DFiniteJ2FrameCoupledInput["frameMemberPointLoadTargets"]> =
        memberPointLoads.length ? factors.map((targetFactor) => targetFactor === 0 ? []
          : memberPointLoads.map(({ load, factor }) => {
            const element = frameIndexByMemberId.get(load.beamId);
            if (element === undefined) throw new Error(`Staafpuntlast ${load.id}: gekoppelde raamwerkstaaf ontbreekt.`);
            return { element, pyKn: load.py * factor * targetFactor,
              pzKn: load.pz * factor * targetFactor, positionM: load.positionM };
          })) : [];
      const frameCells: NativeVolume3DFiniteJ2FrameCoupledInput["frames"] = frames.map(({ memberId: _id, ...member }) => member);
      const plateCells: NonNullable<NativeVolume3DFiniteJ2FrameCoupledInput["bendingPlates"]> =
        bendingPlates.map(({ plateId: _plateId, nodeIds: _nodeIds, ...plate }) => plate);
      const result = frames.length
        ? await solveNativeVolume3DFiniteJ2FrameCoupled({ volume: input, hexes: hexCells,
          hexTargets, trusses: coupledTrusses, membranes: coupledMembranes,
          frames: frameCells, bendingPlates: plateCells, frameTargets,
          ...(frameMemberLoadTargets.length ? { frameMemberLoadTargets } : {}),
          ...(frameMemberPointLoadTargets.length ? { frameMemberPointLoadTargets } : {}) })
        : hexes.length
        ? await solveNativeVolume3DFiniteJ2HexCoupled({ volume: input, hexes: hexCells,
          hexTargets, trusses: coupledTrusses, membranes: coupledMembranes })
        : membranes.length
        ? await solveNativeVolume3DFiniteJ2MembraneCoupled({ volume: input, trusses: coupledTrusses,
          membranes: coupledMembranes })
        : trusses.length
          ? await solveNativeVolume3DFiniteJ2Coupled({ volume: input, trusses: coupledTrusses })
          : await solveNativeVolume3DFiniteJ2(input);
      const plateMoments = result.bendingPlateMomentsKnmPerM ?? [];
      if (!Array.isArray(plateMoments) || plateMoments.length !== bendingPlates.length
          || !plateMoments.every(finiteVector)) {
        throw new Error("De Rust-J2-kern leverde geen geldige elastische XY-DKT-centroïdemomenten per driehoek.");
      }
      if (result.elementStates?.length !== tets.length
          || result.elementStates.some((state) => !finiteTensor(state.fp)
            || !Number.isFinite(state.equivalentPlasticStrain) || state.equivalentPlasticStrain < 0)
          || result.elementFirstPiolaMpa?.length !== tets.length
          || !result.elementFirstPiolaMpa.every(finiteTensor)
          || (hexes.length > 0 && (result.hexGaussStates?.length !== hexes.length
            || result.hexGaussCauchyMpa?.length !== hexes.length
            || result.hexGaussFirstPiolaMpa?.length !== hexes.length
            || result.hexGaussStates.some((points) => points.length !== 8
              || points.some((state) => !finiteTensor(state.fp)
                || !Number.isFinite(state.equivalentPlasticStrain) || state.equivalentPlasticStrain < 0))
            || result.hexGaussCauchyMpa.some((points) => points.length !== 8 || !points.every(finiteTensor))
            || result.hexGaussFirstPiolaMpa.some((points) => points.length !== 8 || !points.every(finiteTensor))))
          || result.nodalDisplacementsM?.length !== nodes.length
          || !result.nodalDisplacementsM.every(finiteVector)
          || (frames.length > 0 && (result.nodalRotationsRad?.length !== nodes.length
            || !result.nodalRotationsRad.every(finiteVector)
            || result.nodalReactionMomentsKnM?.length !== nodes.length
            || !result.nodalReactionMomentsKnM.every(finiteVector)
            || result.frameEndForcesLocal?.length !== frames.length
            || !result.frameEndForcesLocal.every((ends) =>
              Array.isArray(ends) && ends.length === 2 && ends.every(finiteSix))))
          || (trusses.length > 0 && (result.trussAxialForceKn?.length !== trusses.length
            || !result.trussAxialForceKn.every(Number.isFinite)))
          || result.trussStates?.length !== trusses.length
          || result.trussStates.some((state, i) => trusses[i].plasticity
            ? !state || !Number.isFinite(state.plasticLogStrain)
              || !Number.isFinite(state.accumulatedPlasticLogStrain)
              || state.accumulatedPlasticLogStrain < 0
            : state !== null)
          || result.trussAlgorithmicModulusMpa?.length !== trusses.length
          || result.trussAlgorithmicModulusMpa.some((value, i) => trusses[i].plasticity
            ? value === null || !Number.isFinite(value) || value < 0
            : value !== null)
          || (membranes.length > 0 && (result.membraneStressMpa?.length !== membranes.length
            || !result.membraneStressMpa.every(finiteVector)
            || result.membraneStates?.length !== membranes.length
            || result.membraneKirchhoffMpa?.length !== membranes.length
            || result.membraneCauchyMpa?.length !== membranes.length
            || result.membraneForceResultantKnPerM?.length !== membranes.length
            || result.membraneThicknessStretch?.length !== membranes.length
            || result.membraneStates.some((state, i) => membranes[i].plasticity
              ? !state || !finiteTensor(state.fp)
                || !Number.isFinite(state.equivalentPlasticStrain) || state.equivalentPlasticStrain < 0
              : state !== null)
            || result.membraneKirchhoffMpa.some((value, i) => membranes[i].plasticity
              ? !finiteTensor(value) : value !== null)
            || result.membraneCauchyMpa.some((value, i) => membranes[i].plasticity
              ? !finiteVector(value) : value !== null)
            || result.membraneForceResultantKnPerM.some((value, i) => membranes[i].plasticity
              ? !finiteVector(value) : value !== null)
            || result.membraneThicknessStretch.some((value, i) => membranes[i].plasticity
              ? value === null || !Number.isFinite(value) || value <= 0
              : value !== null)))) {
        throw new Error("De Rust-J2-kern leverde ongeldige eindige-vervormingshistorie.");
      }
      trussForcesKn = result.trussAxialForceKn ?? [];
      trussStates = result.trussStates;
      trussAlgorithmicModulusMpa = result.trussAlgorithmicModulusMpa;
      membraneStressMpa = result.membraneStressMpa ?? [];
      membraneCauchyMpa = result.membraneCauchyMpa ?? [];
      membraneForceResultantKnPerM = result.membraneForceResultantKnPerM ?? [];
      membraneStates = result.membraneStates ?? [];
      membraneThicknessStretch = result.membraneThicknessStretch ?? [];
      firstPiolaMpa = result.elementFirstPiolaMpa;
      stress = firstPiolaMpa.map((firstPiola, i) =>
        cauchyStress(mesh.nodes, result.nodalDisplacementsM, connectivity[i], firstPiola));
      equivalentPlasticStrain = result.elementStates.map((state) => state.equivalentPlasticStrain);
      hexGaussStress = (result.hexGaussCauchyMpa ?? []).map((points) => points.map((tensor) =>
        [tensor[0][0], tensor[1][1], tensor[2][2],
          (tensor[0][1] + tensor[1][0]) / 2,
          (tensor[1][2] + tensor[2][1]) / 2,
          (tensor[2][0] + tensor[0][2]) / 2] as Stress));
      hexStress = hexGaussStress.map((points) => {
        const averaged: Stress = [0, 0, 0, 0, 0, 0];
        for (const values of points) {
          values.forEach((value, component) => { averaged[component] += value / 8; });
        }
        return averaged;
      });
      hexGaussPlasticStrain = (result.hexGaussStates ?? []).map((points) =>
        points.map((point) => point.equivalentPlasticStrain));
      hexPlasticStrain = hexGaussPlasticStrain.map((points) => Math.max(...points));
      nodalDisplacementsM = result.nodalDisplacementsM;
      nodalReactionsKn = result.nodalReactionsKn;
      nodalRotationsRad = result.nodalRotationsRad ?? nodalRotationsRad;
      nodalReactionMomentsKnM = result.nodalReactionMomentsKnM ?? nodalReactionMomentsKnM;
      frameEndForcesLocal = result.frameEndForcesLocal ?? [];
      bendingPlateMomentsKnmPerM = plateMoments;
      acceptedSteps = result.acceptedSteps;
      cutbacks = result.cutbacks;
      trueFreeResidualKn = result.trueFreeResidualKn;
      backendUsed = result.linearBackendUsed;
    } else {
      if (!["automatic", "sparseDirect", "sparsePcg", "frontalWave"].includes(requestedBackend)) {
        throw new Error("Tet4-staal-J2 bij kleine rek gebruikt Automatisch, Sparse direct, Sparse PCG of Frontaal.");
      }
      const large = nodes.length * 3 > 1_800 || tets.length > 3_000;
      if (large && requestedBackend === "automatic" && steels.some((steel) => steel.hardeningMpa <= 0)) {
        throw new Error("Grote J2-volumemodellen vereisen positieve verharding voor Sparse PCG.");
      }
      const linearBackend = large && requestedBackend === "automatic" ? "sparsePcg" : requestedBackend;
      const input: NativeVolume3DJ2Input = { mesh, steel: steels[0], elementSteels: steels, targets,
        options: { linearBackend: linearBackend as NonNullable<NativeVolume3DJ2Input["options"]>["linearBackend"],
          pcgThreads: model.volumeThreads ?? 4 } };
      const result = await solveNativeVolume3DJ2(input);
      if (result.elementStates?.length !== tets.length
          || result.elementStates.some((state) => !Array.isArray(state.stressMpa)
            || state.stressMpa.length !== 3 || !state.stressMpa.every(finiteVector)
            || !Number.isFinite(state.equivalentPlasticStrain) || state.equivalentPlasticStrain < 0)) {
        throw new Error("De Rust-J2-kern leverde ongeldige volumehistorie.");
      }
      stress = result.elementStates.map(({ stressMpa: s }) => [s[0][0], s[1][1], s[2][2], s[0][1], s[1][2], s[2][0]]);
      equivalentPlasticStrain = result.elementStates.map((state) => state.equivalentPlasticStrain);
      nodalDisplacementsM = result.nodalDisplacementsM;
      nodalReactionsKn = result.nodalReactionsKn;
      acceptedSteps = result.acceptedSteps;
      cutbacks = result.cutbacks;
      trueFreeResidualKn = result.trueFreeResidualKn;
      backendUsed = result.linearBackendUsed;
    }
  } else {
    if (finiteKinematics) {
      throw new Error("Tet4-betontrekschade bij eindige vervorming is nog niet beschikbaar; kies Kleine rek.");
    }
    if (!["automatic", "dense", "sparseGmres"].includes(requestedBackend)) {
      throw new Error("Tet4-betontrekschade gebruikt Automatisch, Dichte LU of Sparse GMRES.");
    }
    const materials = tets.map((tet) => {
      const law = tet.materialLaw!;
      if (law.kind !== "concreteTensionDamage") throw new Error("Gemengde volume-FNL-materiaalwetten zijn niet beschikbaar.");
      return { eMpa: tet.eMpa, poisson: tet.poisson,
        tensileStrengthMpa: law.tensileStrengthMpa,
        fractureEnergyNPerM: law.fractureEnergyNPerM,
        crackBandWidthM: law.crackBandWidthM };
    });
    const linearBackend = requestedBackend === "automatic"
      ? nodes.length * 3 <= 180 && tets.length <= 300 ? "denseLu" : "sparseGmres"
      : requestedBackend === "dense" ? "denseLu" : "sparseGmres";
    const input: NativeVolume3DConcreteDamageInput = { mesh, ...materials[0], elementMaterials: materials, targets,
      options: { linearBackend } };
    const result = await solveNativeVolume3DConcreteDamage(input);
    if (result.elementStressMpa?.length !== tets.length || !result.elementStressMpa.every(finiteStress)
        || result.elementDamage?.length !== tets.length
        || result.elementDamage.some((damage) => !Number.isFinite(damage) || damage < 0 || damage > 1)) {
      throw new Error("De Rust-betonschadekern leverde ongeldige volumehistorie.");
    }
    stress = result.elementStressMpa;
    tensileDamage = result.elementDamage;
    nodalDisplacementsM = result.nodalDisplacementsM;
    nodalReactionsKn = result.nodalReactionsKn;
    acceptedSteps = result.acceptedSteps;
    cutbacks = result.cutbacks;
    trueFreeResidualKn = result.trueFreeResidualKn;
    backendUsed = result.linearBackendUsed;
  }
  if (nodalDisplacementsM?.length !== nodes.length || !nodalDisplacementsM.every(finiteVector)
      || nodalReactionsKn?.length !== nodes.length || !nodalReactionsKn.every(finiteVector)
      || !stress.every(finiteStress) || hexStress.length !== hexes.length
      || !hexStress.every(finiteStress) || !Array.isArray(acceptedSteps) || acceptedSteps.length === 0
      || acceptedSteps.some((step) => !Number.isSafeInteger(step.newtonIterations) || step.newtonIterations < 0
        || !Number.isSafeInteger(step.targetIndex) || !Number.isFinite(step.targetFraction))
      || acceptedSteps[acceptedSteps.length - 1].targetIndex !== factors.length - 1
      || Math.abs(acceptedSteps[acceptedSteps.length - 1].targetFraction - 1) > 1e-8
      || !Number.isSafeInteger(cutbacks) || cutbacks < 0
      || !Number.isFinite(trueFreeResidualKn) || trueFreeResidualKn < 0) {
    throw new Error("De Rust-Tet4-materiaal-FNL-kern leverde geen volledig of eindig resultaat.");
  }
  const finalFactor = factors[factors.length - 1];
  const force: Vector3 = [0, 0, 0], moment: Vector3 = [0, 0, 0];
  let forceScale = 0, momentScale = 0;
  nodes.forEach((node, i) => {
    const load = appliedLoadsKn[i].map((component) => component * finalFactor) as Vector3;
    const reaction = nodalReactionsKn[i];
    // First-order frame forces balance moments about their reference nodes.
    // Using deformed arms there adds an unmodelled P-Δ couple and rejects an
    // otherwise converged axial-load solve. The geometric-frame route below
    // uses deformed arms because its tangent includes that effect.
    const arm: Vector3 = finiteKinematics && (frames.length === 0 || geometricFrames)
      ? [node.x + nodalDisplacementsM[i][0], node.y + nodalDisplacementsM[i][1], node.z + nodalDisplacementsM[i][2]]
      : [node.x, node.y, node.z];
    const loadMoment = cross(arm, load), reactionMoment = cross(arm, reaction);
    const appliedCouple = appliedMomentsKnm[i].map((value) => value * finalFactor);
    const reactionCouple = nodalReactionMomentsKnM[i];
    for (let axis = 0; axis < 3; axis++) {
      force[axis] += load[axis] + reaction[axis];
      moment[axis] += loadMoment[axis] + reactionMoment[axis]
        + appliedCouple[axis] + reactionCouple[axis];
      forceScale += Math.abs(load[axis]) + Math.abs(reaction[axis]);
      momentScale += Math.abs(loadMoment[axis]) + Math.abs(reactionMoment[axis])
        + Math.abs(appliedCouple[axis]) + Math.abs(reactionCouple[axis]);
    }
  });
  const toleranceKn = Math.max(1e-7, forceScale * 1e-6);
  // The opt-in von Karman frame has small-rotation truncation terms in a
  // deformed-arm global moment sum. Keep its measured imbalance visible while
  // retaining the strict force and Newton checks for every material route.
  const momentToleranceKnm = Math.max(1e-7, momentScale * (geometricFrames ? 1e-5 : 1e-6));
  const maxImbalanceKn = Math.max(...force.map(Math.abs));
  const maxMomentImbalanceKnm = Math.max(...moment.map(Math.abs));
  const relativeResidual = trueFreeResidualKn / Math.max(1, forceScale);
  if (maxImbalanceKn > toleranceKn || maxMomentImbalanceKnm > momentToleranceKnm
      || trueFreeResidualKn > toleranceKn) {
    throw new Error(`Tet4-materiaal-FNL: reactie- of Newton-evenwicht sluit niet (kracht ${maxImbalanceKn}/${toleranceKn} kN, moment ${maxMomentImbalanceKnm}/${momentToleranceKnm} kNm, residu ${trueFreeResidualKn} kN).`);
  }
  const iterations = acceptedSteps.reduce((sum, step) => sum + step.newtonIterations, 0);
  const bendingResultByPlate = new Map<number, BendingPlateResult>();
  for (const [triangleIndex, plate] of bendingPlates.entries()) {
    let summary = bendingResultByPlate.get(plate.plateId);
    if (!summary) {
      summary = { plateId: plate.plateId, triangleCount: 0, maxAbsWm: 0, maxAbsRotationRad: 0,
        maxAbsMomentKnmPerM: [0, 0, 0], centroidMoments: [] };
      bendingResultByPlate.set(plate.plateId, summary);
    }
    summary.triangleCount++;
    const momentKnmPerM = bendingPlateMomentsKnmPerM[triangleIndex];
    summary.centroidMoments!.push({ triangleIndex: triangleIndex + 1,
      nodeIds: plate.nodeIds, momentKnmPerM });
    for (let axis = 0; axis < 3; axis++) {
      summary.maxAbsMomentKnmPerM![axis] = Math.max(summary.maxAbsMomentKnmPerM![axis],
        Math.abs(momentKnmPerM[axis]));
    }
    for (const node of plate.nodes) {
      summary.maxAbsWm = Math.max(summary.maxAbsWm, Math.abs(nodalDisplacementsM[node][2]));
      summary.maxAbsRotationRad = Math.max(summary.maxAbsRotationRad,
        Math.hypot(nodalRotationsRad[node][0], nodalRotationsRad[node][1]));
    }
  }
  const trussIndex = new Map(trusses.map((truss, index) => [truss.memberId, index]));
  const frameIndex = new Map(frames.map((frame, index) => [frame.memberId, index]));
  const memberForces: Frame3DSolveResult["memberForces"] = model.beams.map((beam) => {
    const trussPosition = trussIndex.get(beam.id);
    const framePosition = frameIndex.get(beam.id);
    const memberNodes = trussPosition !== undefined ? trusses[trussPosition].nodes
      : framePosition !== undefined ? frames[framePosition].nodes : undefined;
    if (!memberNodes) throw new Error(`Staaf ${beam.id}: gekoppeld staafresultaat ontbreekt.`);
    const [start, end] = memberNodes.map((node) => nodes[node]);
    const lengthM = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
    if (framePosition !== undefined) {
      const [startForces, endForces] = frameEndForcesLocal[framePosition];
      // Rust recovers physical end forces after removing both the line-load
      // and point-load equivalent vectors at the final absolute target.
      const a = startForces;
      const b = endForces;
      return { memberId: beam.id, lengthM,
        nStartKn: -a[0], nEndKn: b[0], vyStartKn: a[1], vyEndKn: -b[1],
        vzStartKn: a[2], vzEndKn: -b[2], torsionStartKnm: a[3], torsionEndKnm: -b[3],
        myStartKnm: a[4], myEndKnm: -b[4], mzStartKnm: a[5], mzEndKnm: -b[5] };
    }
    const i = trussPosition!;
    const force = trussForcesKn[i];
    return { memberId: beam.id, lengthM, nStartKn: force, nEndKn: force,
      vyStartKn: 0, vyEndKn: 0, vzStartKn: 0, vzEndKn: 0,
      torsionStartKnm: 0, torsionEndKnm: 0, myStartKnm: 0, myEndKnm: 0,
      mzStartKnm: 0, mzEndKnm: 0,
      ...(trussStates[i] ? { axialHistory: {
        plasticStrain: trussStates[i]!.plasticLogStrain,
        equivalentPlasticStrain: trussStates[i]!.accumulatedPlasticLogStrain,
        tensileDamage: 0,
        tangentEMpa: trussAlgorithmicModulusMpa[i]!,
      } } : {}) };
  });
  const geometricByMember = new Map<number, { localDisplacements: number[]; axialForceKn: number }>();
  if (geometricFrames) {
    for (const beam of model.beams) {
      const position = frameIndex.get(beam.id);
      if (position === undefined) continue;
      const [i, j] = frames[position].nodes;
      const { ex, ey, ez } = frame3DMemberAxes(nodes[i], nodes[j], beam.rollAngleRad ?? 0);
      const axes = [ex, ey, ez];
      const localDisplacements = [i, j].flatMap((node) =>
        [nodalDisplacementsM[node], nodalRotationsRad[node]].flatMap((vector) =>
          axes.map((axis) => axis.reduce((sum, direction, component) =>
            sum + direction * vector[component], 0))));
      geometricByMember.set(beam.id, {
        localDisplacements, axialForceKn: frameEndForcesLocal[position][1][0],
      });
    }
  }
  return {
    schemaVersion: 1,
    engine: { id: "openaec-native-fem", name: "Open FEM Rust", revision: "0.1.0", license: "AGPL-3.0-or-later" },
    analysis: geometricFrames ? "combined" : "material",
    displacements: nodes.map((node, i) => ({ nodeId: node.id,
      ux: nodalDisplacementsM[i][0], uy: nodalDisplacementsM[i][1], uz: nodalDisplacementsM[i][2],
      rx: nodalRotationsRad[i][0], ry: nodalRotationsRad[i][1], rz: nodalRotationsRad[i][2] })),
    reactions: nodes.map((node, i) => ({ nodeId: node.id,
      fx: nodalReactionsKn[i][0], fy: nodalReactionsKn[i][1], fz: nodalReactionsKn[i][2],
      mx: nodalReactionMomentsKnM[i][0], my: nodalReactionMomentsKnM[i][1], mz: nodalReactionMomentsKnM[i][2] })),
    memberForces,
    diagrams: frame3DVolumeMemberDiagrams(memberForces,
      memberLineLoads.map(({ load, factor }) => ({ load, factor: factor * finalFactor })),
      memberPointLoads.map(({ load, factor }) => ({ load, factor: factor * finalFactor })),
      geometricByMember),
    volume3D: { elements: [...tets.map((tet, i) => ({ elementId: tet.id, kind: "tet4" as const, stressMpa: stress[i],
      vonMisesMpa: vonMises(stress[i]),
      ...(firstPiolaMpa ? { firstPiolaMpa: firstPiolaMpa[i] } : {}),
      ...(equivalentPlasticStrain ? { equivalentPlasticStrain: equivalentPlasticStrain[i] } : {}),
      ...(tensileDamage ? { tensileDamage: tensileDamage[i] } : {}) })),
      ...hexes.map((hex, i) => ({ elementId: hex.id, kind: "hex8" as const, stressMpa: hexStress[i],
        gaussStressMpa: hexGaussStress[i], gaussEquivalentPlasticStrain: hexGaussPlasticStrain[i],
        vonMisesMpa: vonMises(hexStress[i]),
        equivalentPlasticStrain: hexPlasticStrain[i] }))],
      membranes: membranes.map((membrane, i) => {
        if (membrane.plasticity) {
          return { plateId: membrane.plateId, stressMpa: membraneCauchyMpa[i]!,
            resultantsKnPerM: membraneForceResultantKnPerM[i]!,
            stressMeasure: "cauchy" as const,
            equivalentPlasticStrain: membraneStates[i]!.equivalentPlasticStrain,
            thicknessStretch: membraneThicknessStretch[i]! };
        }
        const s = membraneStressMpa[i];
        const factor = 1000 * membrane.thicknessM;
        return { plateId: membrane.plateId, stressMpa: s,
          resultantsKnPerM: [factor * s[0], factor * s[1], factor * s[2]] as [number, number, number],
          stressMeasure: "secondPiolaKirchhoff" as const };
      }),
      bendingPlates: [...bendingResultByPlate.values()],
      backendUsed, linearIterations: iterations, relativeResidual,
      formulation: finiteKinematics ? "totalLagrangianJ2" : "smallStrainMaterial", newtonIterations: iterations,
      acceptedSteps: acceptedSteps.length, cutbacks },
    materialIterations: iterations, materialLoadPath: [...factors],
    buckling: { status: "notApplicable", reason: "Eigenknik voor volume-materiaal-FNL is nog niet beschikbaar." },
    equilibrium: { relativeResidual, residualOk: true, maxImbalanceKn, equilibriumOk: true },
    forceBalance: { imbalanceKn: force, maxImbalanceKn, toleranceKn, momentImbalanceKnm: moment,
      maxMomentImbalanceKnm, momentToleranceKnm, ok: true },
    solverPath: `native-rust-volume3d-${finiteKinematics ? "finite-" : ""}${family}-${backendUsed}`,
    diagnostics: [
      `Open FEM Rust: ${tets.length} Tet4- en ${hexes.length} Hex8-elementen, ${trusses.length} trekstaven (${trusses.filter((truss) => truss.plasticity).length} plastisch), ${frames.length} elastische buigende 3D-staven, ${bendingPlates.length} elastische XY-DKT-buigdriehoeken en ${membranes.length} Tri3-membranen (${membranes.filter((membrane) => membrane.plasticity).length} plastisch) met ${family === "steelJ2" ? "J2-staalplastificatie" : "betontrekschade"} bij ${finiteKinematics ? "eindige vervorming" : "kleine rek"}.`,
      `${acceptedSteps.length} geaccepteerde stappen, ${iterations} Newton-iteraties, ${cutbacks} terugstappen; vrij residu ${trueFreeResidualKn.toExponential(3)} kN.`,
      ...(["sparseGmres", "matrixFreeGmres", "matrixFreeGmresLarge"].includes(backendUsed)
        ? ["GMRES bevestigt het algebraïsche evenwicht, maar toetst geen positieve tangent of stabiliteit van de evenwichtstak. Controleer kritieke belastingen aanvullend met een stabiliteitsanalyse; een convergente GMRES-oplossing alleen is geen knikbewijs."]
        : []),
      ...(finiteKinematics ? ["Cauchy-spanning is berekend als P·Fᵀ/det(F); eerste Piola-spanning blijft per element beschikbaar. Krachten en vlaktracties zijn vaste referentielasten, geen meedraaiende druk."] : []),
      family === "steelJ2"
        ? `Plastische rek is per Tet4, op acht punten per Hex8, en optioneel per trekstaaf en Tri3-membraan bewaard. Hex8 toont het ongewogen gemiddelde van acht Cauchy-Gauss-spanningen en de hoogste plastische rek. Plastische Tri3-resultaten gebruiken lokale huidige Cauchy-spanning en membraankrachten; elastische Tri3-resultaten gebruiken tweede Piola–Kirchhoff-spanning. Buigende 3D-staven delen knopen en Newton-stappen, en gebruiken ${geometricFrames ? "geometrische tweede-orde-stijfheid met een elastische referentie-aswet; grote objectieve staafrotaties en staafplasticiteit ontbreken" : "een elastische referentie-aswet zonder geometrische of materiële staafnietlineariteit"}. ${bendingPlates.length ? "XY-DKT-platen delen knoopverplaatsingen met volumes en Rx/Ry met aangesloten raamwerkstaven; hun globale XY-centroïdemomenten volgen elastisch uit de laatste convergente verplaatsingen en de vaste referentiestijfheid. Eigen plaat-GNL/FNL, dwarskracht, membraanwerking, oppervlaktespanning en constructieve plaattoetsing worden hier niet herleid." : "Buigplaten en constructieve toetsing ontbreken."}`
        : "Scheurbandbreedte is expliciete invoer; algemene 3D-meshobjectiviteit en constructieve betoncontrole zijn niet aangetoond.",
    ],
  };
}

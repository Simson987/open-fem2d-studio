import { solveNativeVolume3DGnl, type NativeVolume3DGnlInput, type NativeVolume3DGnlResult } from "../../lib/nativeFemClient";
import type { Frame3DModel, Frame3DVolume } from "./frame3dModel";
import type { Frame3DSolveResult } from "./frame3dSolver";
import type { NativeMixed3DInput } from "../../lib/nativeFemClient";

type Vector3 = [number, number, number];
type Tensor3 = [Vector3, Vector3, Vector3];
type Stress = [number, number, number, number, number, number];

const finiteVector = (value: unknown): value is Vector3 =>
  Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === "number" && Number.isFinite(part));
const finiteTensor = (value: unknown): value is Tensor3 =>
  Array.isArray(value) && value.length === 3 && value.every(finiteVector);
const cross = (a: Vector3, b: Vector3): Vector3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vector3, b: Vector3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a: Vector3, b: Vector3): Vector3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const determinant = (a: Tensor3) => dot(a[0], cross(a[1], a[2]));

export function cauchyStress(
  coordinates: Vector3[], displacements: Vector3[], connectivity: [number, number, number, number],
  firstPiola: Tensor3,
): Stress {
  const [a, b, c, d] = connectivity.map((index) => coordinates[index]);
  const ab = subtract(b, a), ac = subtract(c, a), ad = subtract(d, a);
  const det = dot(ab, cross(ac, ad));
  if (!(det > 0) || !Number.isFinite(det)) throw new Error("Tet4-GNL: ongeldige referentiegeometrie.");
  const gb = cross(ac, ad).map((value) => value / det) as Vector3;
  const gc = cross(ad, ab).map((value) => value / det) as Vector3;
  const gd = cross(ab, ac).map((value) => value / det) as Vector3;
  const ga = gb.map((value, axis) => -value - gc[axis] - gd[axis]) as Vector3;
  const gradients = [ga, gb, gc, gd];
  const deformation: Tensor3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  connectivity.forEach((nodeIndex, local) => {
    for (let spatial = 0; spatial < 3; spatial++)
      for (let reference = 0; reference < 3; reference++)
        deformation[spatial][reference] += displacements[nodeIndex][spatial] * gradients[local][reference];
  });
  const jacobian = determinant(deformation);
  if (!(jacobian > 0) || !Number.isFinite(jacobian)) throw new Error("Tet4-GNL: geïnverteerde eindgeometrie.");
  const sigma = (i: number, j: number) =>
    (firstPiola[i][0] * deformation[j][0]
      + firstPiola[i][1] * deformation[j][1]
      + firstPiola[i][2] * deformation[j][2]) / jacobian;
  const stress: Stress = [sigma(0, 0), sigma(1, 1), sigma(2, 2),
    (sigma(0, 1) + sigma(1, 0)) / 2,
    (sigma(1, 2) + sigma(2, 1)) / 2,
    (sigma(2, 0) + sigma(0, 2)) / 2];
  if (!stress.every(Number.isFinite)) throw new Error("Tet4-GNL: ongeldige Cauchy-spanning.");
  return stress;
}

function vonMises([sx, sy, sz, txy, tyz, tzx]: Stress): number {
  return Math.sqrt(Math.max(0, ((sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2) / 2
    + 3 * (txy ** 2 + tyz ** 2 + tzx ** 2)));
}

/** Experimental finite-deformation Tet4 path for an ordinary 3D project. */
export async function solveFrame3DVolumeGnl(
  model: Frame3DModel,
  nodes: Frame3DModel["nodes"],
  tets: Frame3DVolume[],
  loadsKn: Vector3[],
  appliedLoadsKn: Vector3[],
  prescribedM: Array<[number | null, number | null, number | null]>,
  bodyForces: NonNullable<NativeMixed3DInput["tetBodyForces"]>,
  faceTractions: NonNullable<NativeMixed3DInput["tetFaceTractions"]>,
): Promise<Frame3DSolveResult> {
  const backend = model.volumeBackend ?? "automatic";
  if (backend === "matrixFreePcg" || backend === "sparsePcg" || backend === "sparseGmres"
      || backend === "matrixFreeGmres" || backend === "matrixFreeGmresLarge") {
    throw new Error("Tet4-GNL gebruikt een Newton-tangent; kies Automatisch, Sparse direct, Frontale wavefront of Dicht. PCG en GMRES zijn hier niet beschikbaar.");
  }
  const coordinates: Vector3[] = nodes.map((node) => [node.x, node.y, node.z]);
  const indices = new Map(nodes.map((node, index) => [node.id, index]));
  const connectivity = tets.map((tet) => tet.nodeIds.map((id) => {
    const index = indices.get(id);
    if (index === undefined) throw new Error(`Tet4 ${tet.id}: knoop ${id} ontbreekt.`);
    return index;
  }) as [number, number, number, number]);
  const first = tets[0];
  const input: NativeVolume3DGnlInput = {
    mesh: { nodes: coordinates, tets: connectivity },
    eMpa: first.eMpa, poisson: first.poisson,
    elementMaterials: tets.map((tet) => ({ eMpa: tet.eMpa, poisson: tet.poisson })),
    elementEnergyBeta: tets.map((tet) => tet.energyBeta ?? 0),
    targets: [{ loadsKn, prescribedM,
      bodyForces: bodyForces.map((load) => ({ element: load.element, forceKnPerM3: load.forceKnPerM3 })),
      faceTractions: faceTractions.map((load) => ({ element: load.element,
        faceNodes: load.nodes, tractionKnPerM2: load.tractionKnPerM2 })) }],
    options: { linearBackend: backend },
  };
  const native: NativeVolume3DGnlResult = await solveNativeVolume3DGnl(input);
  if (!Array.isArray(native.nodalDisplacementsM) || native.nodalDisplacementsM.length !== nodes.length
      || !native.nodalDisplacementsM.every(finiteVector)
      || !Array.isArray(native.nodalReactionsKn) || native.nodalReactionsKn.length !== nodes.length
      || !native.nodalReactionsKn.every(finiteVector)
      || native.elementGreenStrain?.length !== tets.length || !native.elementGreenStrain.every(finiteTensor)
      || native.elementFirstPiolaMpa?.length !== tets.length || !native.elementFirstPiolaMpa.every(finiteTensor)
      || native.elementEffectiveEMpa?.length !== tets.length
      || native.elementEffectiveEMpa.some((value) => !Number.isFinite(value) || value <= 0)
      || !Number.isFinite(native.trueFreeResidualKn) || native.trueFreeResidualKn < 0
      || !Array.isArray(native.acceptedSteps) || native.acceptedSteps.length === 0) {
    throw new Error("De Rust-Tet4-GNL-kern leverde geen volledig of eindig resultaat.");
  }
  const force: Vector3 = [0, 0, 0], moment: Vector3 = [0, 0, 0];
  let forceScale = 0, momentScale = 0;
  nodes.forEach((node, index) => {
    const displacement = native.nodalDisplacementsM[index];
    const currentPosition: Vector3 = [node.x + displacement[0], node.y + displacement[1], node.z + displacement[2]];
    const load = appliedLoadsKn[index], reaction = native.nodalReactionsKn[index];
    const loadMoment = cross(currentPosition, load), reactionMoment = cross(currentPosition, reaction);
    for (let axis = 0; axis < 3; axis++) {
      force[axis] += load[axis] + reaction[axis];
      moment[axis] += loadMoment[axis] + reactionMoment[axis];
      forceScale += Math.abs(load[axis]) + Math.abs(reaction[axis]);
      momentScale += Math.abs(loadMoment[axis]) + Math.abs(reactionMoment[axis]);
    }
  });
  const toleranceKn = Math.max(1e-7, forceScale * 1e-6);
  const momentToleranceKnm = Math.max(1e-7, momentScale * 1e-6);
  const maxImbalanceKn = Math.max(...force.map(Math.abs));
  const maxMomentImbalanceKnm = Math.max(...moment.map(Math.abs));
  const relativeResidual = native.trueFreeResidualKn / Math.max(1, forceScale);
  const ok = maxImbalanceKn <= toleranceKn && maxMomentImbalanceKnm <= momentToleranceKnm
    && native.trueFreeResidualKn <= toleranceKn;
  if (!ok) throw new Error("Tet4-GNL: de gerapporteerde reactie- of Newton-onbalans sluit niet.");
  const elements: NonNullable<Frame3DSolveResult["volume3D"]>["elements"] = tets.map((tet, index) => {
    const firstPiolaMpa = native.elementFirstPiolaMpa[index];
    const greenStrain = native.elementGreenStrain[index];
    const stressMpa = cauchyStress(coordinates, native.nodalDisplacementsM, connectivity[index], firstPiolaMpa);
    return { elementId: tet.id, kind: "tet4", stressMpa, vonMisesMpa: vonMises(stressMpa),
      greenStrain, firstPiolaMpa, effectiveEMpa: native.elementEffectiveEMpa[index] };
  });
  const iterations = native.acceptedSteps.reduce((sum, step) => sum + step.newtonIterations, 0);
  return {
    schemaVersion: 1,
    engine: { id: "openaec-native-fem", name: "Open FEM Rust", revision: "0.1.0", license: "AGPL-3.0-or-later" },
    analysis: "p-delta",
    displacements: nodes.map((node, index) => ({ nodeId: node.id,
      ux: native.nodalDisplacementsM[index][0], uy: native.nodalDisplacementsM[index][1],
      uz: native.nodalDisplacementsM[index][2], rx: 0, ry: 0, rz: 0 })),
    reactions: nodes.map((node, index) => ({ nodeId: node.id,
      fx: native.nodalReactionsKn[index][0], fy: native.nodalReactionsKn[index][1],
      fz: native.nodalReactionsKn[index][2], mx: 0, my: 0, mz: 0 })),
    memberForces: [],
    volume3D: { elements, backendUsed: native.linearBackendUsed, linearIterations: iterations,
      relativeResidual, formulation: "totalLagrangian", newtonIterations: iterations,
      acceptedSteps: native.acceptedSteps.length, cutbacks: native.cutbacks },
    buckling: { status: "notApplicable", reason: "Eigenknik voor totale-Lagrange-volumeanalyse is nog niet beschikbaar." },
    equilibrium: { relativeResidual, residualOk: true, maxImbalanceKn, equilibriumOk: true },
    forceBalance: { imbalanceKn: force, maxImbalanceKn, toleranceKn, momentImbalanceKnm: moment,
      maxMomentImbalanceKnm, momentToleranceKnm, ok: true },
    solverPath: `native-rust-volume3d-gnl-${native.linearBackendUsed}`,
    diagnostics: [
      `Open FEM Rust: ${tets.length} Tet4-elementen, totale-Lagrange Green-rek en St Venant–Kirchhoff-materiaal.`,
      `${native.acceptedSteps.length} geaccepteerde stap(pen), ${iterations} Newton-iteraties, ${native.cutbacks} terugstappen; vrij residu ${native.trueFreeResidualKn.toExponential(3)} kN.`,
      "Getoonde spanningen zijn Cauchy-spanningen in de eindgeometrie; Green-rek en eerste Piola-spanning blijven per element beschikbaar. Geen algemene staal- of beton-FNL-toets.",
      ...(tets.some((tet) => (tet.energyBeta ?? 0) !== 0)
        ? ["Rekafhankelijke E volgt uit W = W₀ + βW₀²/(2E₀); de gerapporteerde E_eff is een eindtoestand-secantschaal, geen staalplasticiteit of betonscheurmodel."] : []),
    ],
  };
}

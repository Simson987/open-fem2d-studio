import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18next from "i18next";
import Mixed3DWorkbench from "./Mixed3DWorkbench";
import { metCode } from "./metCode";
import {
  solveNativeVolume3D,
  solveNativeVolume3DJ2,
  solveNativeVolume3DFiniteJ2,
  solveNativeVolume3DConcreteDamage,
  solveNativeVolume3DGnl,
  solveNativeVolumeHex8,
  type NativeVolume3DInput,
  type NativeVolume3DResult,
  type NativeVolume3DJ2Input,
  type NativeVolume3DJ2Result,
  type NativeVolume3DFiniteJ2Input,
  type NativeVolume3DFiniteJ2Result,
  type NativeVolume3DConcreteDamageInput,
  type NativeVolume3DConcreteDamageResult,
  type NativeVolume3DGnlInput,
  type NativeVolume3DGnlResult,
  type NativeVolumeHex8Input,
  type NativeVolumeHex8Result,
} from "../../lib/nativeFemClient";

type ElementKind = "tet4" | "hex8" | "mixed3d" | "j2" | "finiteJ2" | "concreteDamage" | "gnl";
type TetStrategy = NonNullable<NativeVolume3DInput["solverStrategy"]>;
type Hex8Backend = NonNullable<NativeVolumeHex8Input["linearBackend"]>;
type J2Backend = NonNullable<NonNullable<NativeVolume3DJ2Input["options"]>["linearBackend"]>;
type FiniteJ2Backend = NonNullable<NonNullable<NativeVolume3DFiniteJ2Input["options"]>["linearBackend"]>;
type ConcreteBackend = NonNullable<NonNullable<NativeVolume3DConcreteDamageInput["options"]>["linearBackend"]>;
type GnlBackend = NonNullable<NonNullable<NativeVolume3DGnlInput["options"]>["linearBackend"]>;
type WorkbenchResult =
  | { kind: "tet4"; value: NativeVolume3DResult }
  | { kind: "hex8"; value: NativeVolumeHex8Result }
  | { kind: "j2"; value: NativeVolume3DJ2Result }
  | { kind: "finiteJ2"; value: NativeVolume3DFiniteJ2Result }
  | { kind: "concreteDamage"; value: NativeVolume3DConcreteDamageResult }
  | { kind: "gnl"; value: NativeVolume3DGnlResult; input: NativeVolume3DGnlInput };
type StressRow = { element: number; point: string; values: readonly number[]; plasticStrain?: number };

// Both examples are already covered by analytical Rust/app-route tests. They
// demonstrate the transport and linear elastic kernel, not a design check.
const TET4_EXAMPLE: NativeVolume3DInput = {
  nodes: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
  materials: [{ eMpa: 12_000, poisson: 0.25 }],
  elements: [{ nodes: [0, 1, 2, 3], material: 0 }],
  loads: [{ node: 3, forceKn: [1, 0, 0] }],
  supports: [
    { node: 0, displacementM: [0, 0, 0] },
    { node: 1, displacementM: [0, 0, 0] },
    { node: 2, displacementM: [0, 0, 0] },
    { node: 3, displacementM: [null, 0, 0] },
  ],
  threads: 2,
  tolerance: 1e-10,
  maxIterations: 100,
};

const HEX8_EXAMPLE: NativeVolumeHex8Input = {
  nodes: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  materials: [{ eMpa: 210_000, poisson: 0.3 }],
  elements: [{ nodes: [0, 1, 2, 3, 4, 5, 6, 7], material: 0 }],
  loads: [1, 2, 5, 6].map((node) => ({ node, forceKn: [52_500, 0, 0] })),
  supports: [
    { node: 0, displacementM: [0, 0, 0] },
    { node: 3, displacementM: [0, null, 0] },
    { node: 4, displacementM: [0, null, null] },
    { node: 7, displacementM: [0, null, null] },
  ],
  tolerance: 1e-9,
  maxIterations: 2000,
};

const j2Target = (rightDisplacementM: number): NativeVolume3DJ2Input["targets"][number] => ({
  loadsKn: Array.from({ length: 8 }, () => [0, 0, 0] as [number, number, number]),
  prescribedM: [
    [0, 0, 0], [rightDisplacementM, null, null],
    [0, null, 0], [rightDisplacementM, null, null],
    [0, null, null], [rightDisplacementM, null, null],
    [0, null, null], [rightDisplacementM, null, null],
  ],
});

// Matches the checked-in volume3d-j2-steel-coupon example: plastic loading
// to 0.004 m, then unloading to 0.0035 m at the right face.
const J2_EXAMPLE: NativeVolume3DJ2Input = {
  mesh: {
    nodes: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
      [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]],
    tets: [[0, 1, 3, 7], [0, 3, 2, 7], [0, 2, 6, 7],
      [0, 6, 4, 7], [0, 4, 5, 7], [0, 5, 1, 7]],
  },
  steel: { youngsMpa: 200_000, poisson: 0.3, yieldMpa: 250, hardeningMpa: 2_000 },
  targets: [j2Target(0.004), j2Target(0.0035)],
};

const FINITE_J2_EXAMPLE: NativeVolume3DFiniteJ2Input = {
  mesh: J2_EXAMPLE.mesh,
  steel: J2_EXAMPLE.steel,
  targets: J2_EXAMPLE.targets,
};

const concreteTarget = (rightDisplacementM: number): NativeVolume3DConcreteDamageInput["targets"][number] => ({
  loadsKn: Array.from({ length: 8 }, () => [0, 0, 0] as [number, number, number]),
  prescribedM: [
    [0, 0, 0], [rightDisplacementM, null, null],
    [0, null, 0], [rightDisplacementM, null, null],
    [0, null, null], [rightDisplacementM, null, null],
    [0, null, null], [rightDisplacementM, null, null],
  ],
});

// Mirrors volume3d-concrete-damage-coupon.json: load beyond tensile strength,
// then unload while retaining the maximum equivalent strain history.
const CONCRETE_EXAMPLE: NativeVolume3DConcreteDamageInput = {
  mesh: {
    nodes: [[0, 0, 0], [0.1, 0, 0], [0, 0.1, 0], [0.1, 0.1, 0],
      [0, 0, 0.1], [0.1, 0, 0.1], [0, 0.1, 0.1], [0.1, 0.1, 0.1]],
    tets: [[0, 1, 3, 7], [0, 3, 2, 7], [0, 2, 6, 7],
      [0, 6, 4, 7], [0, 4, 5, 7], [0, 5, 1, 7]],
  },
  eMpa: 30_000,
  poisson: 0.2,
  tensileStrengthMpa: 3,
  fractureEnergyNPerM: 100,
  crackBandWidthM: 0.1,
  targets: [concreteTarget(3.833333333333333e-5), concreteTarget(2.4166666666666663e-5)],
};

// Same 2×2×2 cube, 27 nodes and 48 Tet4 elements as the checked-in
// volume3d-gnl-affine-stretch.json fixture. uₓ = 0.05 x gives Eₓₓ = 0.05125.
const gnlNodes: NativeVolume3DGnlInput["mesh"]["nodes"] = Array.from({ length: 27 }, (_, node) => [
  (node % 3) * 0.5, (Math.floor(node / 3) % 3) * 0.5, Math.floor(node / 9) * 0.5,
]);
const gnlNode = (x: number, y: number, z: number) => x + 3 * y + 9 * z;
const gnlTets: NativeVolume3DGnlInput["mesh"]["tets"] = Array.from({ length: 8 }, (_, cell) => {
  const x = cell % 2;
  const y = Math.floor(cell / 2) % 2;
  const z = Math.floor(cell / 4);
  const n = (dx: number, dy: number, dz: number) => gnlNode(x + dx, y + dy, z + dz);
  const a = n(0, 0, 0), b = n(1, 0, 0), c = n(1, 1, 0), d = n(0, 1, 0);
  const e = n(0, 0, 1), f = n(1, 0, 1), g = n(1, 1, 1), h = n(0, 1, 1);
  return [[a, b, c, g], [a, c, d, g], [a, d, h, g],
    [a, h, e, g], [a, e, f, g], [a, f, b, g]] as Array<[number, number, number, number]>;
}).flat();
const GNL_EXAMPLE: NativeVolume3DGnlInput = {
  mesh: { nodes: gnlNodes, tets: gnlTets },
  eMpa: 200_000,
  poisson: 0.3,
  targets: [{
    loadsKn: gnlNodes.map(() => [0, 0, 0]),
    prescribedM: gnlNodes.map(([x], node) => node === 13 ? [null, null, null] : [0.05 * x, 0, 0]),
  }],
};

// De labels staan in common.json onder volumeWorkbench.strategy.* en .elementOption.*.
const STRATEGIES: TetStrategy[] = ["automatic", "matrixFree", "sparse", "sparseDirect", "frontal"];
const ELEMENT_OPTIONS: ElementKind[] = ["tet4", "hex8", "mixed3d", "j2", "finiteJ2", "concreteDamage", "gnl"];
const HEX8_BACKENDS: Hex8Backend[] = ["automatic", "sparse", "sparseDirect", "matrixFreeGeneral", "matrixFreeGeneralLarge", "frontalWave"];
const J2_BACKENDS: J2Backend[] = ["sparseDirect", "sparsePcg", "automatic", "frontalWave"];
const FINITE_J2_BACKENDS: FiniteJ2Backend[] = ["dense", "sparseGmres", "frontalWave", "matrixFreeGmres", "matrixFreeGmresLarge", "automatic"];
const CONCRETE_BACKENDS: ConcreteBackend[] = ["denseLu", "sparseGmres"];
const GNL_BACKENDS: GnlBackend[] = ["dense", "sparseDirect", "sparseGmres", "frontalWave", "automatic"];
/** Validatiemeldingen buiten de component: via i18next, in de taal van de app. */
const fout = (sleutel: string, waarden?: Record<string, unknown>) =>
  new Error(i18next.t(`volumeWorkbench.errors.${sleutel}`, { ns: "common", ...waarden }));

const PAGE_SIZE = 40;
const number = (value: number) => Number.isFinite(value) ? value.toExponential(4) : String(value);

function checkLinearModel(value: unknown): asserts value is NativeVolume3DInput | NativeVolumeHex8Input {
  if (!value || typeof value !== "object") {
    throw fout("modelObject");
  }
  const model = value as Record<string, unknown>;
  for (const key of ["nodes", "materials", "elements", "supports"]) {
    if (!Array.isArray(model[key])) {
      throw fout("missingList", { key });
    }
  }
  if (model.loads !== undefined && !Array.isArray(model.loads)) {
    throw fout("loadsList");
  }
}

function checkDistributedTargetLists(targets: unknown[], label: string) {
  for (const [targetIndex, target] of targets.entries()) {
    if (!target || typeof target !== "object") {
      throw fout("targetObject", { label, index: targetIndex });
    }
    const fields = target as Record<string, unknown>;
    for (const key of ["bodyForces", "faceTractions"] as const) {
      if (fields[key] !== undefined && !Array.isArray(fields[key])) {
        throw fout("targetList", { label, index: targetIndex, key });
      }
    }
  }
}

function checkJ2Model(value: unknown): asserts value is NativeVolume3DJ2Input {
  if (!value || typeof value !== "object") {
    throw fout("j2Object");
  }
  const model = value as Record<string, unknown>;
  const mesh = model.mesh as Record<string, unknown> | undefined;
  if (!mesh || !Array.isArray(mesh.nodes) || !Array.isArray(mesh.tets)
    || !model.steel || typeof model.steel !== "object" || !Array.isArray(model.targets)) {
    throw fout("j2Required");
  }
  if (model.elementSteels !== undefined
    && (!Array.isArray(model.elementSteels)
      || model.elementSteels.length !== mesh.tets.length
      || model.elementSteels.some((steel) => !steel || typeof steel !== "object"
        || [steel.youngsMpa, steel.poisson, steel.yieldMpa, steel.hardeningMpa]
          .some((value) => typeof value !== "number" || !Number.isFinite(value))))) {
    throw fout("j2ElementSteels");
  }
  checkDistributedTargetLists(model.targets, "J2");
}

function checkFiniteJ2Model(value: unknown): asserts value is NativeVolume3DFiniteJ2Input {
  checkJ2Model(value);
}

function checkConcreteModel(value: unknown): asserts value is NativeVolume3DConcreteDamageInput {
  if (!value || typeof value !== "object") {
    throw fout("concreteObject");
  }
  const model = value as Record<string, unknown>;
  const mesh = model.mesh as Record<string, unknown> | undefined;
  if (!mesh || !Array.isArray(mesh.nodes) || !Array.isArray(mesh.tets)
    || !Array.isArray(model.targets)
    || typeof model.eMpa !== "number" || typeof model.tensileStrengthMpa !== "number"
    || typeof model.fractureEnergyNPerM !== "number" || typeof model.crackBandWidthM !== "number") {
    throw fout("concreteRequired");
  }
  if (model.elementMaterials !== undefined
    && (!Array.isArray(model.elementMaterials)
      || model.elementMaterials.length !== mesh.tets.length
      || model.elementMaterials.some((material) => !material || typeof material !== "object"
        || [material.eMpa, material.poisson, material.tensileStrengthMpa,
          material.fractureEnergyNPerM, material.crackBandWidthM]
          .some((value) => typeof value !== "number" || !Number.isFinite(value))))) {
    throw fout("concreteElementMaterials");
  }
  checkDistributedTargetLists(model.targets, i18next.t("volumeWorkbench.errors.concreteLabel", { ns: "common" }));
}

function checkGnlModel(value: unknown): asserts value is NativeVolume3DGnlInput {
  if (!value || typeof value !== "object") {
    throw fout("gnlObject");
  }
  const model = value as Record<string, unknown>;
  const mesh = model.mesh as Record<string, unknown> | undefined;
  if (!mesh || !Array.isArray(mesh.nodes) || !Array.isArray(mesh.tets)
    || !Array.isArray(model.targets) || typeof model.eMpa !== "number"
    || typeof model.poisson !== "number") {
    throw fout("gnlRequired");
  }
  if (model.elementMaterials !== undefined) {
    if (!Array.isArray(model.elementMaterials) || model.elementMaterials.length !== mesh.tets.length
      || model.elementMaterials.some((material) => !material || typeof material !== "object"
        || !Number.isFinite(material.eMpa) || material.eMpa <= 0
        || !Number.isFinite(material.poisson) || material.poisson <= -1 || material.poisson >= 0.5)) {
      throw fout("gnlElementMaterials");
    }
  }
  if (model.elementEnergyBeta !== undefined
    && (!Array.isArray(model.elementEnergyBeta)
      || model.elementEnergyBeta.length !== mesh.tets.length
      || model.elementEnergyBeta.some((beta) => !Number.isFinite(beta)))) {
    throw fout("gnlEnergyBeta");
  }
  checkDistributedTargetLists(model.targets, "GNL");
}

function stressRows(result: WorkbenchResult, page: number): StressRow[] {
  if (result.kind === "concreteDamage" || result.kind === "gnl" || result.kind === "finiteJ2") return [];
  const first = page * PAGE_SIZE;
  const total = result.kind === "tet4"
    ? result.value.elementStressMpa.length
    : result.kind === "hex8" ? result.value.elementGaussStressMpa.length * 8
      : result.value.elementStates.length;
  return Array.from({ length: Math.min(PAGE_SIZE, Math.max(0, total - first)) }, (_, offset) => {
    const index = first + offset;
    if (result.kind === "tet4") {
      return { element: index, point: "constant", values: result.value.elementStressMpa[index] };
    }
    if (result.kind === "j2") {
      const state = result.value.elementStates[index];
      const stress = state.stressMpa;
      return {
        element: index,
        point: "constant",
        values: [stress[0][0], stress[1][1], stress[2][2], stress[0][1], stress[1][2], stress[2][0]],
        plasticStrain: state.equivalentPlasticStrain,
      };
    }
    const element = Math.floor(index / 8);
    const point = index % 8;
    return { element, point: String(point + 1), values: result.value.elementGaussStressMpa[element][point] };
  });
}

export default function VolumeWorkbench() {
  const { t } = useTranslation("common");
  const v = (sleutel: string, waarden?: Record<string, unknown>) => t(`volumeWorkbench.${sleutel}`, waarden ?? {});
  const [kind, setKind] = useState<ElementKind>("tet4");
  const [strategy, setStrategy] = useState<TetStrategy>("automatic");
  const [hex8Backend, setHex8Backend] = useState<Hex8Backend>("sparse");
  const [j2Backend, setJ2Backend] = useState<J2Backend>("sparseDirect");
  const [finiteJ2Backend, setFiniteJ2Backend] = useState<FiniteJ2Backend>("dense");
  const [finiteJ2Threads, setFiniteJ2Threads] = useState(4);
  const [concreteBackend, setConcreteBackend] = useState<ConcreteBackend>("denseLu");
  const [gnlBackend, setGnlBackend] = useState<GnlBackend>("dense");
  const [json, setJson] = useState(() => JSON.stringify(TET4_EXAMPLE, null, 2));
  const [result, setResult] = useState<WorkbenchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nodePage, setNodePage] = useState(0);
  const [stressPage, setStressPage] = useState(0);
  const requestVersion = useRef(0);

  const resetExample = (nextKind: ElementKind) => {
    requestVersion.current += 1;
    setKind(nextKind);
    setHex8Backend("sparse");
    setJ2Backend("sparseDirect");
    setFiniteJ2Backend("dense");
    setFiniteJ2Threads(4);
    setConcreteBackend("denseLu");
    setGnlBackend("dense");
    const example = nextKind === "tet4" ? TET4_EXAMPLE : nextKind === "hex8" ? HEX8_EXAMPLE
      : nextKind === "j2" ? J2_EXAMPLE : nextKind === "finiteJ2" ? FINITE_J2_EXAMPLE
        : nextKind === "gnl" ? GNL_EXAMPLE : CONCRETE_EXAMPLE;
    setJson(JSON.stringify(example, null, 2));
    setResult(null);
    setError(null);
    setBusy(false);
    setNodePage(0);
    setStressPage(0);
  };

  const updateJson = (next: string) => {
    requestVersion.current += 1;
    setJson(next);
    setResult(null);
    setError(null);
    setBusy(false);
  };

  const solve = async () => {
    const version = ++requestVersion.current;
    setResult(null);
    setError(null);
    setBusy(true);
    try {
      const parsed: unknown = JSON.parse(json);
      if (kind === "j2") {
        checkJ2Model(parsed);
        const value = await solveNativeVolume3DJ2({
          ...parsed, options: { ...parsed.options, linearBackend: j2Backend },
        });
        if (version === requestVersion.current) setResult({ kind, value });
      } else if (kind === "finiteJ2") {
        checkFiniteJ2Model(parsed);
        const value = await solveNativeVolume3DFiniteJ2({
          ...parsed, options: { ...parsed.options, linearBackend: finiteJ2Backend,
            ...(finiteJ2Backend === "matrixFreeGmres" || finiteJ2Backend === "matrixFreeGmresLarge"
              ? { matrixFreeThreads: finiteJ2Threads } : {}) },
        });
        if (version === requestVersion.current) setResult({ kind, value });
      } else if (kind === "concreteDamage") {
        checkConcreteModel(parsed);
        const value = await solveNativeVolume3DConcreteDamage({
          ...parsed, options: { ...parsed.options, linearBackend: concreteBackend },
        });
        if (version === requestVersion.current) setResult({ kind, value });
      } else if (kind === "gnl") {
        checkGnlModel(parsed);
        const input = { ...parsed, options: { ...parsed.options, linearBackend: gnlBackend } };
        const value = await solveNativeVolume3DGnl(input);
        if (version === requestVersion.current) setResult({ kind, value, input });
      } else if (kind === "tet4") {
        checkLinearModel(parsed);
        const value = await solveNativeVolume3D({
          ...(parsed as NativeVolume3DInput),
          loads: (parsed as NativeVolume3DInput).loads ?? [],
          solverStrategy: strategy,
        });
        if (version === requestVersion.current) setResult({ kind, value });
      } else if (kind === "hex8") {
        checkLinearModel(parsed);
        const value = await solveNativeVolumeHex8({
          ...(parsed as NativeVolumeHex8Input),
          loads: (parsed as NativeVolumeHex8Input).loads ?? [],
          linearBackend: hex8Backend,
        });
        if (version === requestVersion.current) setResult({ kind, value });
      }
      if (version === requestVersion.current) {
        setNodePage(0);
        setStressPage(0);
      }
    } catch (cause) {
      if (version === requestVersion.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  };

  const displacements = result?.value.nodalDisplacementsM ?? [];
  const reactions = result?.value.nodalReactionsKn ?? [];
  const stressCount = result?.kind === "tet4"
    ? result.value.elementStressMpa.length
    : result?.kind === "hex8" ? result.value.elementGaussStressMpa.length * 8
      : result?.kind === "j2" || result?.kind === "concreteDamage"
        ? result.value.elementStates.length
        : result?.kind === "gnl" ? result.value.elementGreenStrain.length
          : result?.kind === "finiteJ2" ? result.value.elementStates.length : 0;
  const visibleStresses = result ? stressRows(result, stressPage) : [];
  const rightFaceReactionKn = result?.kind === "gnl" ? (() => {
    const maxX = Math.max(...result.input.mesh.nodes.map((node) => node[0]));
    return result.value.nodalReactionsKn.reduce((sum, reaction, node) =>
      result.input.mesh.nodes[node][0] === maxX ? sum + reaction[0] : sum, 0);
  })() : null;
  const nodePageCount = Math.max(1, Math.ceil(displacements.length / PAGE_SIZE));
  const stressPageCount = Math.max(1, Math.ceil(stressCount / PAGE_SIZE));

  const elementOptions = ELEMENT_OPTIONS.map((option) =>
    <option key={option} value={option}>{v(`elementOption.${option}`)}</option>);
  if (kind === "mixed3d") return <section aria-label={v("sectionLabel")} style={{ padding: 16, overflow: "auto", height: "100%" }}>
    <h2>{v("heading")} <small>{v("experimental")}</small></h2>
    <label>{v("elementType")}<br /><select aria-label={v("elementType")} value={kind}
      onChange={(event) => resetExample(event.target.value as ElementKind)}>
      {elementOptions}
    </select></label>
    <Mixed3DWorkbench />
  </section>;

  return (
    <section aria-label={v("sectionLabel")} style={{ padding: 16, overflow: "auto", height: "100%" }}>
      <h2>{v("heading")} <small>{v("experimental")}</small></h2>
      <p>{v("intro")}</p>
      <p style={{ fontSize: "0.9em" }}>{v(`check.${kind}`)}</p>
      <p style={{ fontSize: "0.9em" }}>{metCode(v("limits.general"))}</p>
      {kind === "concreteDamage" && <p style={{ fontSize: "0.9em" }}>{metCode(v("limits.concreteDamage"))}</p>}
      {kind === "finiteJ2" && <p style={{ fontSize: "0.9em" }}>{metCode(v("limits.finiteJ2"))}</p>}
      {kind === "gnl" && <p style={{ fontSize: "0.9em" }}>{metCode(v("limits.gnl"))}</p>}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", marginBottom: 12 }}>
        <label>{v("elementType")}<br />
          <select aria-label={v("elementType")} value={kind} onChange={(event) => resetExample(event.target.value as ElementKind)}>
            {elementOptions}
          </select>
        </label>
        {kind === "tet4" && <label>{v("solveMethod")}<br />
          <select aria-label={v("tet4MethodAria")} value={strategy}
            onChange={(event) => { requestVersion.current += 1; setStrategy(event.target.value as TetStrategy); setResult(null); setError(null); setBusy(false); }}>
            {STRATEGIES.map((option) => <option key={option} value={option}>{v(`strategy.${option}`)}</option>)}
          </select>
        </label>}
        {kind === "hex8" && <label>{v("solveMethod")}<br />
          <select aria-label={v("hex8MethodAria")} value={hex8Backend}
            onChange={(event) => { requestVersion.current += 1; setHex8Backend(event.target.value as Hex8Backend); setResult(null); setError(null); setBusy(false); }}>
            {HEX8_BACKENDS.map((option) => <option key={option} value={option}>{v(`hex8Backend.${option}`)}</option>)}
          </select>
        </label>}
        {kind === "j2" && <label>{v("j2Solver")}<br />
          <select aria-label={v("j2SolverAria")} value={j2Backend}
            onChange={(event) => { requestVersion.current += 1; setJ2Backend(event.target.value as J2Backend); setResult(null); setError(null); setBusy(false); }}>
            {J2_BACKENDS.map((option) => <option key={option} value={option}>{v(`j2Backend.${option}`)}</option>)}
          </select>
        </label>}
        {kind === "finiteJ2" && <label>{v("finiteJ2Solver")}<br />
          <select aria-label={v("finiteJ2SolverAria")} value={finiteJ2Backend}
            onChange={(event) => { requestVersion.current += 1; setFiniteJ2Backend(event.target.value as FiniteJ2Backend); setResult(null); setError(null); setBusy(false); }}>
            {FINITE_J2_BACKENDS.map((option) => <option key={option} value={option}>{v(`finiteJ2Backend.${option}`)}</option>)}
          </select>
        </label>}
        {kind === "finiteJ2" && (finiteJ2Backend === "matrixFreeGmres" || finiteJ2Backend === "matrixFreeGmresLarge") && <label>{v("threads")}<br />
          <input type="number" min={1} max={16} step={1} value={finiteJ2Threads}
            aria-label={v("threadsAria")}
            onChange={(event) => { requestVersion.current += 1; setFiniteJ2Threads(Math.min(16, Math.max(1, Number(event.target.value) || 1))); setResult(null); setError(null); setBusy(false); }} />
        </label>}
        {kind === "concreteDamage" && <label>{v("concreteSolver")}<br />
          <select aria-label={v("concreteSolverAria")} value={concreteBackend}
            onChange={(event) => { requestVersion.current += 1; setConcreteBackend(event.target.value as ConcreteBackend); setResult(null); setError(null); setBusy(false); }}>
            {CONCRETE_BACKENDS.map((option) => <option key={option} value={option}>{v(`concreteBackend.${option}`)}</option>)}
          </select>
        </label>}
        {kind === "gnl" && <label>{v("gnlSolver")}<br />
          <select aria-label={v("gnlSolverAria")} value={gnlBackend}
            onChange={(event) => { requestVersion.current += 1; setGnlBackend(event.target.value as GnlBackend); setResult(null); setError(null); setBusy(false); }}>
            {GNL_BACKENDS.map((option) => <option key={option} value={option}>{v(`gnlBackend.${option}`)}</option>)}
          </select>
        </label>}
        <button type="button" onClick={() => resetExample(kind)}>{v("reloadExample")}</button>
        <button type="button" onClick={solve} disabled={busy}>{busy ? v("solving") : v("solve")}</button>
      </div>

      <label htmlFor="volume-workbench-json">{v("modelJson")}</label>
      <textarea id="volume-workbench-json" aria-label={v("modelJson")} spellCheck={false} value={json}
        onChange={(event) => updateJson(event.target.value)} rows={20}
        style={{ display: "block", boxSizing: "border-box", width: "100%", fontFamily: "monospace", marginTop: 6 }} />
      <p style={{ fontSize: "0.85em" }}>{metCode(v(`override.${kind}`))}</p>
      {error && <p role="alert" style={{ color: "var(--color-danger, #b33)" }}>{v("solverError", { error })}</p>}

      {result && <div aria-live="polite" style={{ marginTop: 16 }}>
        <h3>{v("result")}</h3>
        {result.kind === "j2" || result.kind === "finiteJ2" || result.kind === "concreteDamage" || result.kind === "gnl" ? <p>
          {v("method")}: <strong>{v(`methodName.${result.kind}`, { backend: result.value.linearBackendUsed })}</strong>
          {" · "}{v("freeResidual")}: <strong>{number(result.value.trueFreeResidualKn)} kN</strong>
          {" · "}{v("acceptedSteps")}: {result.value.acceptedSteps.length}
          {" · "}{v("cutbacks")}: {result.value.cutbacks}
          {result.kind === "j2" && <> {" · "}{v("frontalFallbacks")}: {result.value.frontalFallbacks}</>}
          {result.kind === "finiteJ2" && <> {" · "}{v("frontalFallbacks")}: {result.value.frontalFallbacks}</>}
          {result.kind === "gnl" && <> {" · "}{v("frontalFallbacks")}: {result.value.frontalFallbacks}</>}
          {rightFaceReactionKn !== null && <> {" · "}{v("sumRxAt")}<sub>max</sub>: <strong>{number(rightFaceReactionKn)} kN</strong></>}
        </p> : <p>
          {v("method")}: <strong>{result.kind === "tet4" ? result.value.solverUsed
            : result.value.solverUsed === "matrixFree" ? v("solverUsed.matrixFree")
              : result.value.solverUsed === "frontalWave" ? v("solverUsed.frontalWave") : v("solverUsed.sparse")}</strong>
          {" · "}{v("relativeResidual")}: <strong>{number(result.value.relativeResidual)}</strong>
          {result.kind === "hex8" && result.value.solverUsed === "frontalWave"
            ? ` · ${v("peakFront", { dofs: result.value.frontalMaximumFrontDofs ?? "—" })}`
            : <>{" · "}{v("iterations")}: {result.value.iterations}
              {result.kind === "tet4" || result.value.solverUsed === "matrixFree"
                ? ` · ${v("threadsCount", { count: result.value.threads })}` : ` · ${v("csrNonzeros", { count: result.value.csrNonzeros })}`}</>}
        </p>}
        <h4>{v("nodeTableHeading")}</h4>
        <p>{v("nodesPage", { count: displacements.length, page: nodePage + 1, pages: nodePageCount })}</p>
        <div style={{ overflowX: "auto" }}><table>
          <thead><tr><th>{v("node")}</th><th>uₓ</th><th>uᵧ</th><th>u𝓏</th><th>Rₓ</th><th>Rᵧ</th><th>R𝓏</th></tr></thead>
          <tbody>{displacements.slice(nodePage * PAGE_SIZE, (nodePage + 1) * PAGE_SIZE).map((u, offset) => {
            const node = nodePage * PAGE_SIZE + offset;
            const reaction = reactions[node];
            return <tr key={node}><td>{node}</td>{u.map((value, component) => <td key={`u${component}`}>{number(value)}</td>)}
              {reaction.map((value, component) => <td key={`r${component}`}>{number(value)}</td>)}</tr>;
          })}</tbody>
        </table></div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" disabled={nodePage === 0} onClick={() => setNodePage(nodePage - 1)}>{v("prevNodes")}</button>
          <button type="button" disabled={nodePage + 1 >= nodePageCount} onClick={() => setNodePage(nodePage + 1)}>{v("nextNodes")}</button>
        </div>
        {result.kind === "finiteJ2" ? <>
          <h4>{v("finiteJ2Heading")}</h4>
          <p>{v("elementsPage", { count: stressCount, page: stressPage + 1, pages: stressPageCount })}</p>
          <div style={{ overflowX: "auto" }}><table>
            <thead><tr><th>{v("element")}</th><th>{v("equivPlasticStrain")}</th><th>Pₓₓ (MPa)</th><th>Pᵧᵧ (MPa)</th><th>P𝓏𝓏 (MPa)</th></tr></thead>
            <tbody>{result.value.elementStates.slice(stressPage * PAGE_SIZE, (stressPage + 1) * PAGE_SIZE)
              .map((state, offset) => {
                const element = stressPage * PAGE_SIZE + offset;
                const p = result.value.elementFirstPiolaMpa[element];
                return <tr key={element}><td>{element}</td><td>{number(state.equivalentPlasticStrain)}</td>
                  <td>{number(p[0][0])}</td><td>{number(p[1][1])}</td><td>{number(p[2][2])}</td></tr>;
              })}</tbody>
          </table></div>
        </> : result.kind === "gnl" ? <>
          <h4>{v("gnlHeading")}</h4>
          <p>{v("elementsPage", { count: stressCount, page: stressPage + 1, pages: stressPageCount })}</p>
          <div style={{ overflowX: "auto" }}><table>
            <thead><tr><th>{v("element")}</th><th>Eₓₓ</th><th>Eᵧᵧ</th><th>E𝓏𝓏</th><th>Eₓᵧ</th><th>Eᵧ𝓏</th><th>E𝓏ₓ</th><th>Pₓₓ (MPa)</th><th>{v("effectiveE")}</th></tr></thead>
            <tbody>{result.value.elementGreenStrain.slice(stressPage * PAGE_SIZE, (stressPage + 1) * PAGE_SIZE)
              .map((strain, offset) => <tr key={stressPage * PAGE_SIZE + offset}>
                <td>{stressPage * PAGE_SIZE + offset}</td>
                {[strain[0][0], strain[1][1], strain[2][2], strain[0][1], strain[1][2], strain[2][0]]
                  .map((value, component) => <td key={component}>{number(value)}</td>)}
                <td>{result.value.elementFirstPiolaMpa?.[stressPage * PAGE_SIZE + offset]?.[0]?.[0] === undefined
                  ? "—" : number(result.value.elementFirstPiolaMpa[stressPage * PAGE_SIZE + offset][0][0])}</td>
                <td>{number(result.value.elementEffectiveEMpa[stressPage * PAGE_SIZE + offset])}</td>
              </tr>)}</tbody>
          </table></div>
        </> : result.kind === "concreteDamage" ? <>
          <h4>{v("damageHeading")}</h4>
          <p>{v("elementsPage", { count: stressCount, page: stressPage + 1, pages: stressPageCount })}</p>
          <div style={{ overflowX: "auto" }}><table>
            <thead><tr><th>{v("element")}</th><th>{v("maxEquivStrain")}</th><th>{v("damage")}</th><th>σₓₓ (MPa)</th></tr></thead>
            <tbody>{result.value.elementStates.slice(stressPage * PAGE_SIZE, (stressPage + 1) * PAGE_SIZE)
              .map((state, offset) => <tr key={stressPage * PAGE_SIZE + offset}>
                <td>{stressPage * PAGE_SIZE + offset}</td><td>{number(state.maxEquivalentStrain)}</td>
                <td>{result.value.elementDamage?.[stressPage * PAGE_SIZE + offset] === undefined
                  ? "—" : number(result.value.elementDamage[stressPage * PAGE_SIZE + offset])}</td>
                <td>{result.value.elementStressMpa?.[stressPage * PAGE_SIZE + offset]?.[0] === undefined
                  ? "—" : number(result.value.elementStressMpa[stressPage * PAGE_SIZE + offset][0])}</td>
              </tr>)}</tbody>
          </table></div>
        </> : <>
          <h4>{v("stressHeading")}</h4>
          <p>{v("stressPointsPage", { count: stressCount, page: stressPage + 1, pages: stressPageCount })}
            {" · "}{result.kind === "hex8" ? v("gaussOrder") : v("constantTet4")}</p>
          <div style={{ overflowX: "auto" }}><table>
            <thead><tr><th>{v("element")}</th><th>{v("gauss")}</th><th>σₓₓ</th><th>σᵧᵧ</th><th>σ𝓏𝓏</th><th>τₓᵧ</th><th>τᵧ𝓏</th><th>τ𝓏ₓ</th>
              {result.kind === "j2" && <th>{v("equivPlasticStrain")}</th>}</tr></thead>
            <tbody>{visibleStresses.map((stress, offset) =>
              <tr key={`${stressPage}-${offset}`}><td>{stress.element}</td><td>{stress.point}</td>
                {stress.values.map((value, component) => <td key={component}>{number(value)}</td>)}
                {result.kind === "j2" && <td>{number(stress.plasticStrain ?? 0)}</td>}</tr>)}</tbody>
          </table></div>
        </>}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" disabled={stressPage === 0} onClick={() => setStressPage(stressPage - 1)}>{v("prevElements")}</button>
          <button type="button" disabled={stressPage + 1 >= stressPageCount} onClick={() => setStressPage(stressPage + 1)}>{v("nextElements")}</button>
        </div>
        {(result.kind === "j2" || result.kind === "finiteJ2" || result.kind === "concreteDamage" || result.kind === "gnl") && <details style={{ marginTop: 12 }}>
          <summary>{v("stepsSummary")}</summary>
          <div style={{ overflowX: "auto" }}><table>
            <thead><tr><th>{v("target")}</th><th>{v("fraction")}</th><th>{v("newtonIterations")}</th><th>{v("freeResidualKn")}</th></tr></thead>
            <tbody>{result.value.acceptedSteps.map((step, index) => <tr key={index}>
              <td>{step.targetIndex + 1}</td><td>{number(step.targetFraction)}</td>
              <td>{step.newtonIterations}</td><td>{number(step.trueFreeResidualKn)}</td>
            </tr>)}</tbody>
          </table></div>
        </details>}
      </div>}
    </section>
  );
}

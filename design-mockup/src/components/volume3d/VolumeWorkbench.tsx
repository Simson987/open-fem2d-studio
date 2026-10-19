import { useRef, useState } from "react";
import Mixed3DWorkbench from "./Mixed3DWorkbench";
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

const STRATEGIES: Array<{ value: TetStrategy; label: string }> = [
  { value: "automatic", label: "Automatisch" },
  { value: "matrixFree", label: "Matrixvrij PCG" },
  { value: "sparse", label: "Sparse CSR PCG" },
  { value: "sparseDirect", label: "Sparse direct LDLᵀ" },
  { value: "frontal", label: "Frontale wavefront" },
];
const ELEMENT_OPTIONS: Array<{ value: ElementKind; label: string }> = [
  { value: "tet4", label: "Tet4 — afschuifproef" },
  { value: "hex8", label: "Hex8 — trekproef" },
  { value: "mixed3d", label: "Gemengd 3D — Hex8, Tet4 en staaf" },
  { value: "j2", label: "Tet4 J2-staal — trek/ontlastproef" },
  { value: "finiteJ2", label: "Tet4 eindige-rek J2 — trek/ontlastproef" },
  { value: "concreteDamage", label: "Tet4 betontrekschade — trek/ontlastproef" },
  { value: "gnl", label: "Tet4 GNL — affine rekproef" },
];

const PAGE_SIZE = 40;
const number = (value: number) => Number.isFinite(value) ? value.toExponential(4) : String(value);

function checkLinearModel(value: unknown): asserts value is NativeVolume3DInput | NativeVolumeHex8Input {
  if (!value || typeof value !== "object") {
    throw new Error("JSON-invoer moet een modelobject zijn.");
  }
  const model = value as Record<string, unknown>;
  for (const key of ["nodes", "materials", "elements", "supports"]) {
    if (!Array.isArray(model[key])) {
      throw new Error(`JSON-invoer mist een lijst '${key}'.`);
    }
  }
  if (model.loads !== undefined && !Array.isArray(model.loads)) {
    throw new Error("'loads' moet een lijst zijn.");
  }
}

function checkDistributedTargetLists(targets: unknown[], label: string) {
  for (const [targetIndex, target] of targets.entries()) {
    if (!target || typeof target !== "object") {
      throw new Error(`${label} target ${targetIndex} moet een object zijn.`);
    }
    const fields = target as Record<string, unknown>;
    for (const key of ["bodyForces", "faceTractions"] as const) {
      if (fields[key] !== undefined && !Array.isArray(fields[key])) {
        throw new Error(`${label} target ${targetIndex}: ${key} moet een lijst zijn.`);
      }
    }
  }
}

function checkJ2Model(value: unknown): asserts value is NativeVolume3DJ2Input {
  if (!value || typeof value !== "object") {
    throw new Error("J2 JSON-invoer moet een modelobject zijn.");
  }
  const model = value as Record<string, unknown>;
  const mesh = model.mesh as Record<string, unknown> | undefined;
  if (!mesh || !Array.isArray(mesh.nodes) || !Array.isArray(mesh.tets)
    || !model.steel || typeof model.steel !== "object" || !Array.isArray(model.targets)) {
    throw new Error("J2 JSON-invoer vereist mesh.nodes, mesh.tets, steel en targets.");
  }
  if (model.elementSteels !== undefined
    && (!Array.isArray(model.elementSteels)
      || model.elementSteels.length !== mesh.tets.length
      || model.elementSteels.some((steel) => !steel || typeof steel !== "object"
        || [steel.youngsMpa, steel.poisson, steel.yieldMpa, steel.hardeningMpa]
          .some((value) => typeof value !== "number" || !Number.isFinite(value))))) {
    throw new Error("J2 elementSteels moet voor elk Tet4-element een volledige eindige staalwet bevatten.");
  }
  checkDistributedTargetLists(model.targets, "J2");
}

function checkFiniteJ2Model(value: unknown): asserts value is NativeVolume3DFiniteJ2Input {
  checkJ2Model(value);
}

function checkConcreteModel(value: unknown): asserts value is NativeVolume3DConcreteDamageInput {
  if (!value || typeof value !== "object") {
    throw new Error("Betonschade JSON-invoer moet een modelobject zijn.");
  }
  const model = value as Record<string, unknown>;
  const mesh = model.mesh as Record<string, unknown> | undefined;
  if (!mesh || !Array.isArray(mesh.nodes) || !Array.isArray(mesh.tets)
    || !Array.isArray(model.targets)
    || typeof model.eMpa !== "number" || typeof model.tensileStrengthMpa !== "number"
    || typeof model.fractureEnergyNPerM !== "number" || typeof model.crackBandWidthM !== "number") {
    throw new Error("Betonschade JSON-invoer vereist mesh.nodes, mesh.tets, materiaalwaarden en targets.");
  }
  if (model.elementMaterials !== undefined
    && (!Array.isArray(model.elementMaterials)
      || model.elementMaterials.length !== mesh.tets.length
      || model.elementMaterials.some((material) => !material || typeof material !== "object"
        || [material.eMpa, material.poisson, material.tensileStrengthMpa,
          material.fractureEnergyNPerM, material.crackBandWidthM]
          .some((value) => typeof value !== "number" || !Number.isFinite(value))))) {
    throw new Error("Betonschade elementMaterials moet per Tet4 een volledige eindige materiaalwet bevatten.");
  }
  checkDistributedTargetLists(model.targets, "Betonschade");
}

function checkGnlModel(value: unknown): asserts value is NativeVolume3DGnlInput {
  if (!value || typeof value !== "object") {
    throw new Error("GNL JSON-invoer moet een modelobject zijn.");
  }
  const model = value as Record<string, unknown>;
  const mesh = model.mesh as Record<string, unknown> | undefined;
  if (!mesh || !Array.isArray(mesh.nodes) || !Array.isArray(mesh.tets)
    || !Array.isArray(model.targets) || typeof model.eMpa !== "number"
    || typeof model.poisson !== "number") {
    throw new Error("GNL JSON-invoer vereist mesh.nodes, mesh.tets, eMpa, poisson en targets.");
  }
  if (model.elementMaterials !== undefined) {
    if (!Array.isArray(model.elementMaterials) || model.elementMaterials.length !== mesh.tets.length
      || model.elementMaterials.some((material) => !material || typeof material !== "object"
        || !Number.isFinite(material.eMpa) || material.eMpa <= 0
        || !Number.isFinite(material.poisson) || material.poisson <= -1 || material.poisson >= 0.5)) {
      throw new Error("GNL elementMaterials moet voor elk Tet4-element een geldige eMpa en poisson bevatten.");
    }
  }
  if (model.elementEnergyBeta !== undefined
    && (!Array.isArray(model.elementEnergyBeta)
      || model.elementEnergyBeta.length !== mesh.tets.length
      || model.elementEnergyBeta.some((beta) => !Number.isFinite(beta)))) {
    throw new Error("GNL elementEnergyBeta moet voor elk Tet4-element een eindige coëfficiënt bevatten.");
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

  if (kind === "mixed3d") return <section aria-label="Experimentele 3D volume-editor" style={{ padding: 16, overflow: "auto", height: "100%" }}>
    <h2>3D volume-editor <small>experimenteel</small></h2>
    <label>Elementtype<br /><select aria-label="Elementtype" value={kind}
      onChange={(event) => resetExample(event.target.value as ElementKind)}>
      {ELEMENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label>
    <Mixed3DWorkbench />
  </section>;

  return (
    <section aria-label="Experimentele 3D volume-editor" style={{ padding: 16, overflow: "auto", height: "100%" }}>
      <h2>3D volume-editor <small>experimenteel</small></h2>
      <p>3D volumeanalyse. Eenheden: m, kN en MPa. De voorbeelden zijn solvercontroles, geen constructieve ontwerpvalidatie.</p>
      <p style={{ fontSize: "0.9em" }}>{kind === "tet4"
        ? "Lineaire Tet4-controle: uₓ van knoop 3 = 1,25×10⁻⁶ m; τ𝓏ₓ = 0,006 MPa."
        : kind === "hex8"
          ? "Lineaire Hex8-controle: uₓ = 0,001·x m; σₓₓ = 210 MPa in alle Gauss-punten."
          : kind === "j2"
            ? "J2-staalcoupon: plastisch belasten tot 0,004 m en ontlasten tot 0,0035 m; plastische rek blijft aanwezig."
            : kind === "finiteJ2"
              ? "Eindige-rek J2-staalcoupon: multiplicatieve plastische toestand en nominale spanning bij belasten en ontlasten."
            : kind === "gnl"
              ? "Geometrisch niet-lineaire Tet4: 5% affine rek van een 2×2×2 kubus; Green–Lagrange Eₓₓ = 0,05125."
            : "Betontrekcoupon: belasten tot 3,833×10⁻⁵ m en ontlasten tot 2,417×10⁻⁵ m; de maximale equivalente rek blijft als schadehistorie bewaard."}</p>
      <p style={{ fontSize: "0.9em" }}>
        Tet4: maximaal 2 miljoen knopen / 12 miljoen elementen; parallel tijdelijk geheugen maximaal 512 MiB.
        Sparse assemblage maximaal 4 miljoen bijdragen; direct en frontaal maximaal 10.000 DOF,
        frontbreedte maximaal 512. Hex8: CSR tot 4 miljoen assemblagebijdragen; expliciete
        matrixvrije route voor exact geordende rechthoekige roosters met materiaal per element.
        Frontaal Hex8 maximaal 2.500 elementen, 6.000 DOF en 256 actieve front-DOF.
        J2: sparse direct en frontaal maximaal 1.800 DOF / 3.000 Tet4-elementen;
        sparse PCG maximaal 150.000 DOF / 300.000 elementen, met positieve verharding en
        voldoende opgelegde, via volledige vlakken verbonden elementgroepen. De J2-Newtonroute is experimenteel,
        zonder grote vervorming, contact, scheurvorming of globale arc-length-controle.
        Optioneel geeft <code>elementSteels</code> voor ieder Tet4 een eigen E, ν, vloeigrens en verharding.
        De frontale J2-methode vereist een stabiele positief-definiete Newton-tangent en heeft een begrensde frontbreedte.
        Automatisch probeert frontaal alleen als sparse LDLᵀ de ingestelde factoropslaglimiet overschrijdt.
        J2 en betonschade accepteren per lastdoel ook vaste <code>bodyForces</code> in kN/m³
        en nominale <code>faceTractions</code> in kN/m² op een Tet4-vlak.
      </p>
      {kind === "concreteDamage" && <p style={{ fontSize: "0.9em" }}>
        Betonschade: dichte LU maximaal 180 DOF / 300 Tet4-elementen; sparse GMRES maximaal
        12.000 DOF / 20.000 Tet4-elementen, met aparte CSR-opslaggrenzen. De opgegeven scheurbandbreedte kalibreert
        alleen de monotone eenassige breukenergie; algemene 3D mesh-objectiviteit en constructieve
        ontwerpvalidatie zijn niet aangetoond. Geen discrete scheuren, drukschade of postpiek-tracering
        onder krachtsturing.
        Optioneel geeft <code>elementMaterials</code> per Tet4 een eigen E, ν, treksterkte,
        breukenergie en expliciete scheurbandbreedte.
      </p>}
      {kind === "finiteJ2" && <p style={{ fontSize: "0.9em" }}>
        Eindige-rek J2: experimentele totale-Lagrangiaanse Tet4 Newtonroute, maximaal 120 DOF
        en 200 elementen met dichte LU. Optionele sparse CSR-GMRES en frontale wavefront zijn
        begrensd op 2.400 DOF en 3.600 Tet4-elementen, met aanvullende opslag-, iteratie-
        en frontbreedtelimieten. Matrixvrije GMRES is begrensd op 24.000 DOF en 36.000 Tet4
        met maximaal 16 rekenthreads en een begrensde elementtangentcache.
        Voorgeschreven verplaatsingen, knooplasten en dode lichaams- en vlaklasten op de
        referentiegeometrie kunnen per doel wisselen. Plastische geschiedenis blijft na
        geaccepteerde stappen bewaard. Contact, meebewegende vlaklasten, onbeperkt grote modellen
        en constructieve ontwerpvalidatie ontbreken.
      </p>}
      {kind === "gnl" && <p style={{ fontSize: "0.9em" }}>
        GNL: dichte methode maximaal 180 DOF / 300 Tet4-elementen; sparse direct en frontaal
        maximaal 900 DOF / 1.200 Tet4-elementen, met extra factor- en frontgrenzen.
        De expliciete CSR-GMRES-route is begrensd op 2.400 DOF / 3.600 Tet4-elementen
        en aparte opslaglimieten; het iteratieve residu bewijst geen matrixrang of stabiliteit.
        Total-Lagrangian St Venant–Kirchhoff
        met Green–Lagrange-rek, kleine elastische materiaalrekken en Newton-iteraties.
        Gebruik optioneel <code>elementMaterials</code> voor E en ν per Tet4 in meshvolgorde.
        <code>elementEnergyBeta</code> geeft per Tet4 een experimentele rekafhankelijke
        elastische modulus via W = W₀ + βW₀²/(2E), met W₀ de St Venant–Kirchhoff-energie.
        Per lastdoel zijn <code>bodyForces</code> (kN/m³) en <code>faceTractions</code> (kN/m²)
        in de referentiegeometrie mogelijk; de drie <code>faceNodes</code> zijn globale knoopnummers
        van één Tet4-vlak.
        Sparse en frontaal assembleren elementtangenten zonder globale dichte matrix.
        Geen plastificatie, schade, contact, grote elastische materiaalrekken of ontwerpvalidatie.
      </p>}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", marginBottom: 12 }}>
        <label>Elementtype<br />
          <select aria-label="Elementtype" value={kind} onChange={(event) => resetExample(event.target.value as ElementKind)}>
            {ELEMENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        {kind === "tet4" && <label>Oplosmethode<br />
          <select aria-label="Tet4 oplosmethode" value={strategy}
            onChange={(event) => { requestVersion.current += 1; setStrategy(event.target.value as TetStrategy); setResult(null); setError(null); setBusy(false); }}>
            {STRATEGIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>}
        {kind === "hex8" && <label>Oplosmethode<br />
          <select aria-label="Hex8 oplosmethode" value={hex8Backend}
            onChange={(event) => { requestVersion.current += 1; setHex8Backend(event.target.value as Hex8Backend); setResult(null); setError(null); setBusy(false); }}>
            <option value="automatic">Automatisch met begrensde herstelpoging</option>
            <option value="sparse">Sparse CSR of gestructureerd matrixvrij</option>
            <option value="sparseDirect">Directe sparse LDLᵀ (begrensd)</option>
            <option value="matrixFreeGeneral">Matrixvrij voor algemene Hex8-geometrie</option>
            <option value="matrixFreeGeneralLarge">Matrixvrij groot (max. 1 GiB elementcache)</option>
            <option value="frontalWave">Frontale wavefront</option>
          </select>
        </label>}
        {kind === "j2" && <label>J2 Newton-matrixoplosser<br />
          <select aria-label="J2 Tet4 matrixoplosser" value={j2Backend}
            onChange={(event) => { requestVersion.current += 1; setJ2Backend(event.target.value as J2Backend); setResult(null); setError(null); setBusy(false); }}>
            <option value="sparseDirect">Sparse directe LDLᵀ</option>
            <option value="sparsePcg">Sparse CSR, parallelle PCG (positieve verharding)</option>
            <option value="automatic">Automatisch, herstel bij sparse opslaglimiet</option>
            <option value="frontalWave">Frontale wavefront</option>
          </select>
        </label>}
        {kind === "finiteJ2" && <label>Eindige-rek J2 Newton-matrixoplosser<br />
          <select aria-label="Eindige-rek J2 Tet4 matrixoplosser" value={finiteJ2Backend}
            onChange={(event) => { requestVersion.current += 1; setFiniteJ2Backend(event.target.value as FiniteJ2Backend); setResult(null); setError(null); setBusy(false); }}>
            <option value="dense">Dichte LU (kleine modellen)</option>
            <option value="sparseGmres">Sparse CSR-GMRES (experimenteel)</option>
            <option value="frontalWave">Frontale wavefront (experimenteel)</option>
            <option value="matrixFreeGmres">Matrixvrije GMRES (tot 16 threads)</option>
            <option value="matrixFreeGmresLarge">Matrixvrije GMRES groot (max. 300.000 Tet4 / 180.000 DOF)</option>
            <option value="automatic">Automatisch: sparse GMRES, dan begrensd frontaal herstel</option>
          </select>
        </label>}
        {kind === "finiteJ2" && (finiteJ2Backend === "matrixFreeGmres" || finiteJ2Backend === "matrixFreeGmresLarge") && <label>Rekenthreads<br />
          <input type="number" min={1} max={16} step={1} value={finiteJ2Threads}
            aria-label="Eindige-rek J2 matrixvrije rekenthreads"
            onChange={(event) => { requestVersion.current += 1; setFiniteJ2Threads(Math.min(16, Math.max(1, Number(event.target.value) || 1))); setResult(null); setError(null); setBusy(false); }} />
        </label>}
        {kind === "concreteDamage" && <label>Beton Newton-matrixoplosser<br />
          <select aria-label="Beton Tet4 matrixoplosser" value={concreteBackend}
            onChange={(event) => { requestVersion.current += 1; setConcreteBackend(event.target.value as ConcreteBackend); setResult(null); setError(null); setBusy(false); }}>
            <option value="denseLu">Dichte LU (kleine modellen)</option>
            <option value="sparseGmres">Sparse CSR-GMRES (experimenteel)</option>
          </select>
        </label>}
        {kind === "gnl" && <label>Newton-matrixoplosser<br />
          <select aria-label="GNL Tet4 matrixoplosser" value={gnlBackend}
            onChange={(event) => { requestVersion.current += 1; setGnlBackend(event.target.value as GnlBackend); setResult(null); setError(null); setBusy(false); }}>
            <option value="dense">Dichte Cholesky</option>
            <option value="sparseDirect">Sparse directe LDLᵀ</option>
            <option value="sparseGmres">Sparse CSR-GMRES (experimenteel)</option>
            <option value="frontalWave">Frontale wavefront</option>
            <option value="automatic">Automatisch, herstel bij sparse opslaglimiet</option>
          </select>
        </label>}
        <button type="button" onClick={() => resetExample(kind)}>Laad voorbeeld opnieuw</button>
        <button type="button" onClick={solve} disabled={busy}>{busy ? "Oplossen…" : "Los model op"}</button>
      </div>

      <label htmlFor="volume-workbench-json">Model-JSON</label>
      <textarea id="volume-workbench-json" aria-label="Model-JSON" spellCheck={false} value={json}
        onChange={(event) => updateJson(event.target.value)} rows={20}
        style={{ display: "block", boxSizing: "border-box", width: "100%", fontFamily: "monospace", marginTop: 6 }} />
      {kind === "tet4" && <p style={{ fontSize: "0.85em" }}>De methodekeuze hierboven overschrijft <code>solverStrategy</code> in de JSON-invoer.</p>}
      {kind === "hex8" && <p style={{ fontSize: "0.85em" }}>De methodekeuze hierboven overschrijft <code>linearBackend</code> in de JSON-invoer. Een geldig <code>structuredGridCells</code> kiest met de sparse instelling de snelle gestructureerde matrixvrije route. Kies voor afwijkende Hex8-geometrie de algemene matrixvrije methode.</p>}
      {kind === "j2" && <p style={{ fontSize: "0.85em" }}>De J2-matrixoplosser hierboven overschrijft <code>options.linearBackend</code> in de JSON-invoer. PCG is experimenteel en vereist positieve verharding en voldoende opleggingen per aaneengesloten Tet4-groep.</p>}
      {kind === "finiteJ2" && <p style={{ fontSize: "0.85em" }}>De eindige-rek J2-matrixoplosser hierboven overschrijft <code>options.linearBackend</code>. Automatisch probeert binnen de kleine modelgrens alleen bij herkende GMRES- of opslagfouten frontaal herstel. Een geslaagd GMRES-residu bewijst geen unieke evenwichtsoplossing of tangentstabiliteit.</p>}
      {kind === "concreteDamage" && <p style={{ fontSize: "0.85em" }}>De betonmatrixoplosser hierboven overschrijft <code>options.linearBackend</code> in de JSON-invoer. CSR-GMRES is experimenteel; een geslaagd iteratief residu bewijst niet dat de beschadigde tangent een unieke evenwichtsoplossing heeft.</p>}
      {kind === "gnl" && <p style={{ fontSize: "0.85em" }}>De matrixoplosser hierboven overschrijft <code>options.linearBackend</code> in de JSON-invoer.</p>}
      {error && <p role="alert" style={{ color: "var(--color-danger, #b33)" }}>Solverfout: {error}</p>}

      {result && <div aria-live="polite" style={{ marginTop: 16 }}>
        <h3>Resultaat</h3>
        {result.kind === "j2" || result.kind === "finiteJ2" || result.kind === "concreteDamage" || result.kind === "gnl" ? <p>
          Methode: <strong>{result.kind === "j2" ? `J2 Newton + ${result.value.linearBackendUsed}`
            : result.kind === "finiteJ2" ? `Eindige-rek J2 Newton + ${result.value.linearBackendUsed}`
            : result.kind === "gnl" ? `Total-Lagrangian Newton + ${result.value.linearBackendUsed}`
              : `Betontrekschade Newton + ${result.value.linearBackendUsed}`}</strong>
          {" · "}Vrij residu: <strong>{number(result.value.trueFreeResidualKn)} kN</strong>
          {" · "}Geaccepteerde stappen: {result.value.acceptedSteps.length}
          {" · "}Stapverkleiningen: {result.value.cutbacks}
          {result.kind === "j2" && <> {" · "}Frontale herstelpogingen: {result.value.frontalFallbacks}</>}
          {result.kind === "finiteJ2" && <> {" · "}Frontale herstelpogingen: {result.value.frontalFallbacks}</>}
          {result.kind === "gnl" && <> {" · "}Frontale herstelpogingen: {result.value.frontalFallbacks}</>}
          {rightFaceReactionKn !== null && <> {" · "}ΣRₓ op x<sub>max</sub>: <strong>{number(rightFaceReactionKn)} kN</strong></>}
        </p> : <p>
          Methode: <strong>{result.kind === "tet4" ? result.value.solverUsed
            : result.value.solverUsed === "matrixFree" ? "Matrixvrij PCG"
              : result.value.solverUsed === "frontalWave" ? "Frontale wavefront-eliminatie" : "Sparse CSR (Jacobi-PCG)"}</strong>
          {" · "}Relatief residu: <strong>{number(result.value.relativeResidual)}</strong>
          {result.kind === "hex8" && result.value.solverUsed === "frontalWave"
            ? ` · Piekfront: ${result.value.frontalMaximumFrontDofs ?? "—"} DOF`
            : <>{" · "}Iteraties: {result.value.iterations}
              {result.kind === "tet4" || result.value.solverUsed === "matrixFree"
                ? ` · Threads: ${result.value.threads}` : ` · CSR niet-nullen: ${result.value.csrNonzeros}`}</>}
        </p>}
        <h4>Knoopverplaatsingen (m) en reacties (kN)</h4>
        <p>{displacements.length} knopen · pagina {nodePage + 1} / {nodePageCount}</p>
        <div style={{ overflowX: "auto" }}><table>
          <thead><tr><th>Knoop</th><th>uₓ</th><th>uᵧ</th><th>u𝓏</th><th>Rₓ</th><th>Rᵧ</th><th>R𝓏</th></tr></thead>
          <tbody>{displacements.slice(nodePage * PAGE_SIZE, (nodePage + 1) * PAGE_SIZE).map((u, offset) => {
            const node = nodePage * PAGE_SIZE + offset;
            const reaction = reactions[node];
            return <tr key={node}><td>{node}</td>{u.map((value, component) => <td key={`u${component}`}>{number(value)}</td>)}
              {reaction.map((value, component) => <td key={`r${component}`}>{number(value)}</td>)}</tr>;
          })}</tbody>
        </table></div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" disabled={nodePage === 0} onClick={() => setNodePage(nodePage - 1)}>Vorige knopen</button>
          <button type="button" disabled={nodePage + 1 >= nodePageCount} onClick={() => setNodePage(nodePage + 1)}>Volgende knopen</button>
        </div>
        {result.kind === "finiteJ2" ? <>
          <h4>Plastische toestand en nominale spanning per Tet4</h4>
          <p>{stressCount} elementen · pagina {stressPage + 1} / {stressPageCount}</p>
          <div style={{ overflowX: "auto" }}><table>
            <thead><tr><th>Element</th><th>Equiv. plastische rek</th><th>Pₓₓ (MPa)</th><th>Pᵧᵧ (MPa)</th><th>P𝓏𝓏 (MPa)</th></tr></thead>
            <tbody>{result.value.elementStates.slice(stressPage * PAGE_SIZE, (stressPage + 1) * PAGE_SIZE)
              .map((state, offset) => {
                const element = stressPage * PAGE_SIZE + offset;
                const p = result.value.elementFirstPiolaMpa[element];
                return <tr key={element}><td>{element}</td><td>{number(state.equivalentPlasticStrain)}</td>
                  <td>{number(p[0][0])}</td><td>{number(p[1][1])}</td><td>{number(p[2][2])}</td></tr>;
              })}</tbody>
          </table></div>
        </> : result.kind === "gnl" ? <>
          <h4>Green–Lagrange-rek en nominale spanning per Tet4</h4>
          <p>{stressCount} elementen · pagina {stressPage + 1} / {stressPageCount}</p>
          <div style={{ overflowX: "auto" }}><table>
            <thead><tr><th>Element</th><th>Eₓₓ</th><th>Eᵧᵧ</th><th>E𝓏𝓏</th><th>Eₓᵧ</th><th>Eᵧ𝓏</th><th>E𝓏ₓ</th><th>Pₓₓ (MPa)</th><th>E effectief (MPa)</th></tr></thead>
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
          <h4>Schadehistorie per Tet4</h4>
          <p>{stressCount} elementen · pagina {stressPage + 1} / {stressPageCount}</p>
          <div style={{ overflowX: "auto" }}><table>
            <thead><tr><th>Element</th><th>Maximale equivalente rek</th><th>Schade d</th><th>σₓₓ (MPa)</th></tr></thead>
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
          <h4>Elementspanningen (MPa)</h4>
          <p>{stressCount} spanningspunten · pagina {stressPage + 1} / {stressPageCount}
            {result.kind === "hex8" ? " · Gaussvolgorde volgens solver" : " · constante Tet4-spanning"}</p>
          <div style={{ overflowX: "auto" }}><table>
            <thead><tr><th>Element</th><th>Gauss</th><th>σₓₓ</th><th>σᵧᵧ</th><th>σ𝓏𝓏</th><th>τₓᵧ</th><th>τᵧ𝓏</th><th>τ𝓏ₓ</th>
              {result.kind === "j2" && <th>Equiv. plastische rek</th>}</tr></thead>
            <tbody>{visibleStresses.map((stress, offset) =>
              <tr key={`${stressPage}-${offset}`}><td>{stress.element}</td><td>{stress.point}</td>
                {stress.values.map((value, component) => <td key={component}>{number(value)}</td>)}
                {result.kind === "j2" && <td>{number(stress.plasticStrain ?? 0)}</td>}</tr>)}</tbody>
          </table></div>
        </>}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" disabled={stressPage === 0} onClick={() => setStressPage(stressPage - 1)}>Vorige elementen</button>
          <button type="button" disabled={stressPage + 1 >= stressPageCount} onClick={() => setStressPage(stressPage + 1)}>Volgende elementen</button>
        </div>
        {(result.kind === "j2" || result.kind === "finiteJ2" || result.kind === "concreteDamage" || result.kind === "gnl") && <details style={{ marginTop: 12 }}>
          <summary>Geaccepteerde stappen en Newton-residuen</summary>
          <div style={{ overflowX: "auto" }}><table>
            <thead><tr><th>Doel</th><th>Fractie</th><th>Newton-iteraties</th><th>Vrij residu (kN)</th></tr></thead>
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

import { isSteelProfile, mapDeflectionClass } from "../../lib/steelCheckBuilder";
import { STEEL_GRADES } from "../../lib/steelGrades";
import type { BeamCheckInput } from "../../lib/types/steel/BeamCheckInput";
import type { BeamCheckResult } from "../../lib/types/steel/BeamCheckResult";
import type { ConsequenceClass } from "../../lib/types/steel/ConsequenceClass";
import type { NamedCheck } from "../../lib/types/steel/NamedCheck";
import { blijvendeZakking } from "../../lib/blijvendeZakking";
import type { LoadCase } from "../fem/femTypes";
import type { LoadCombination } from "../fem/solver/combinations";
import type { OpenFem3DModel, OpenFem3DNode } from "./openFem3dModel";
import type { OpenFem3DDisplacement, OpenFem3DSolveResult } from "./openFem3dSolver";
import { openFem3DForceStations } from "./openFem3dForceStations";
import { openFem3DMemberFieldDeflectionMm } from "./openFem3dDisplacement";
import { analyseOpenFem3DLoadPanels } from "./openFem3dLoadPanels";
import { kipsteunenVanStaaf } from "../../lib/kipsteunen";

export interface OpenFem3DCheckSkip { beamId: number; reason: string }

export interface OpenFem3DSteelChecks {
  results: BeamCheckResult[];
  skipped: OpenFem3DCheckSkip[];
  /** Assumptions that apply to every generated check input. */
  notes: string[];
}

type Vector = [number, number, number];

const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector, b: Vector): Vector => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalise = (v: Vector): Vector => {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
};

/** Mirrors the pinned external engine's Z-up default local-axis convention. */
export function openFem3DLocalAxes(start: OpenFem3DNode, end: OpenFem3DNode) {
  const ex = normalise([end.x - start.x, end.y - start.y, end.z - start.z]);
  const up: Vector = Math.abs(ex[2]) > 0.999 ? [1, 0, 0] : [0, 0, 1];
  const projection = dot(ex, up);
  const ez = normalise([
    up[0] - projection * ex[0],
    up[1] - projection * ex[1],
    up[2] - projection * ex[2],
  ]);
  const ey = cross(ez, ex);
  return { ex, ey, ez };
}

function translation(value: OpenFem3DDisplacement): Vector { return [value.ux, value.uy, value.uz]; }
function rotation(value: OpenFem3DDisplacement): Vector { return [value.rx, value.ry, value.rz]; }

/**
 * Maximum transverse member curvature relative to the displaced end chord.
 * With the current nodal-load-only 3D contract, cubic Hermite interpolation
 * is the complete Euler-Bernoulli member field between the two end states.
 */
export function openFem3DFieldDeflectionMm(
  start: OpenFem3DNode,
  end: OpenFem3DNode,
  startDisplacement: OpenFem3DDisplacement,
  endDisplacement: OpenFem3DDisplacement,
): number {
  const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  const { ey, ez } = openFem3DLocalAxes(start, end);
  const u1 = translation(startDisplacement), u2 = translation(endDisplacement);
  const r1 = rotation(startDisplacement), r2 = rotation(endDisplacement);
  const v1 = dot(ey, u1), v2 = dot(ey, u2);
  const w1 = dot(ez, u1), w2 = dot(ez, u2);
  const rz1 = dot(ez, r1), rz2 = dot(ez, r2);
  const ry1 = dot(ey, r1), ry2 = dot(ey, r2);
  let maximum = 0;
  for (let index = 0; index <= 20; index += 1) {
    const xi = index / 20;
    const h1 = 1 - 3 * xi ** 2 + 2 * xi ** 3;
    const h2 = length * (xi - 2 * xi ** 2 + xi ** 3);
    const h3 = 3 * xi ** 2 - 2 * xi ** 3;
    const h4 = length * (-(xi ** 2) + xi ** 3);
    const v = h1 * v1 + h2 * rz1 + h3 * v2 + h4 * rz2;
    // The external engine's local w/ry bending block uses the opposite rotation sign.
    const w = h1 * w1 - h2 * ry1 + h3 * w2 - h4 * ry2;
    const chordV = (1 - xi) * v1 + xi * v2;
    const chordW = (1 - xi) * w1 + xi * w2;
    maximum = Math.max(maximum, Math.hypot(v - chordV, w - chordW));
  }
  return maximum * 1000;
}

export interface OpenFem3DCombinationSet {
  combinations: readonly LoadCombination[];
  results: ReadonlyMap<number, OpenFem3DSolveResult>;
  loadCases?: readonly Pick<LoadCase, "id" | "type">[];
  /**
   * De gevolgklasse van het project. De klasse zit al in de γ-factoren van de
   * combinaties; de kern vermeldt haar in de toets. Zonder opgave: CC2.
   */
  consequenceClass?: ConsequenceClass;
}

function isFreeEnd(model: OpenFem3DModel, nodeId: number): boolean {
  if ((model.supports ?? []).some((support) => support.nodeId === nodeId)) return false;
  return model.beams.filter((beam) => beam.startNodeId === nodeId || beam.endNodeId === nodeId).length === 1;
}

/** Kipsteunen op de bovenflens om de L/10: een doorgaand gesteunde flens. */
const BOVENFLENS_DOORGAAND = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const BOVENFLENS_AANNAME =
  "Aanname: de bovenflens is doorgaand gesteund door het vloer- of dakvlak dat op deze ligger " +
  "afdraagt (kipsteunen om de L/10 op de bovenflens). De onderflens is niet gesteund, dus een " +
  "gedrukte onderflens (steunpuntsmoment, windzuiging) wordt op kip getoetst over de volle lengte. " +
  "Eigen kipsteunen in de toetsinstellingen van de staaf gaan voor.";

/**
 * Liggers die de last van een vloer- of dakvlak dragen: de ontvangende staven
 * van elk belastingvlak met zwaartekrachtrichting. Zo’n vlak ligt op de
 * ligger, en een kanaalplaatvloer of stalen dakplaat steunt dan de bovenflens.
 * Een belastingvlak loodrecht op een gevel (wind) steunt niets.
 */
export function liggersOnderVloerOfDak(model: OpenFem3DModel): Set<number> {
  const uit = new Set<number>();
  for (const analyse of analyseOpenFem3DLoadPanels(model)) {
    if (!analyse.result || analyse.panel.direction !== "gravity") continue;
    for (const beamId of analyse.result.receiverBeamIds) uit.add(beamId);
  }
  return uit;
}

export function buildOpenFem3DSteelCheckInputs(
  model: OpenFem3DModel,
  result: OpenFem3DSolveResult,
  combinationSet?: OpenFem3DCombinationSet,
): { inputs: BeamCheckInput[]; skipped: OpenFem3DCheckSkip[]; notes: string[] } {
  const inputs: BeamCheckInput[] = [];
  const skipped: OpenFem3DCheckSkip[] = [];
  const notes = [
    combinationSet
      ? "De EN 1993-krachten zijn op alle solverstations omhuld over de berekende 3D-UGT-combinaties; de doorbuiging volgt de grootste veldkromming over alle berekende BGT-combinaties."
      : "De EN 1993-krachten komen op alle solverstations uit de actuele 3D-rekentoestand; er is geen combinatieset meegegeven.",
    "Kniklengtes en kipsteunen komen uit de toetsinstellingen van de staaf; zonder opgave neemt de kern de staaflengte.",
    "De BGT-doorbuiging volgt uit de geïntegreerde solvermomentlijn M/EI en past exact op beide eindtranslaties; oude solverresultaten vallen terug op Hermite-interpolatie.",
  ];
  const displacements = new Map(result.displacements.map((value) => [value.nodeId, value]));
  const memberForces = new Map(result.memberForces.map((value) => [value.memberId, value]));
  const ulsCombinations = combinationSet?.combinations.filter((combination) =>
    combination.type === "uls" && combinationSet.results.has(combination.id)) ?? [];
  const slsCombinations = combinationSet?.combinations.filter((combination) =>
    combination.type === "sls" && combinationSet.results.has(combination.id)) ?? [];
  const deflectionCombinations = slsCombinations;

  const onderVloerOfDak = liggersOnderVloerOfDak(model);
  for (const beam of model.beams) {
    const material = beam.material?.trim().toUpperCase();
    const profile = beam.profileName?.trim();
    if (!profile || !material || !isSteelProfile(profile) || !STEEL_GRADES.includes(material)) {
      skipped.push({ beamId: beam.id, reason: `geen toetsbaar catalogus-staalprofiel (${profile ?? "—"} — ${material ?? "—"})` });
      continue;
    }
    const start = model.nodes.find((node) => node.id === beam.startNodeId);
    const end = model.nodes.find((node) => node.id === beam.endNodeId);
    const forces = memberForces.get(beam.id);
    const startDisplacement = displacements.get(beam.startNodeId);
    const endDisplacement = displacements.get(beam.endNodeId);
    if (!start || !end || !forces || !startDisplacement || !endDisplacement) {
      skipped.push({ beamId: beam.id, reason: "onvolledige geometrie, staafkrachten of eindverplaatsingen" });
      continue;
    }
    const startFree = isFreeEnd(model, beam.startNodeId);
    const endFree = isFreeEnd(model, beam.endNodeId);
    const ulsEnvelope = ulsCombinations.flatMap((combination) => {
      const combinationResult = combinationSet?.results.get(combination.id);
      return combinationResult ? openFem3DForceStations(combinationResult, beam.id, combination.id) : [];
    });
    const deflectionMm = deflectionCombinations.reduce((maximum, combination) => {
      const combinationResult = combinationSet?.results.get(combination.id);
      return combinationResult
        ? Math.max(maximum, openFem3DMemberFieldDeflectionMm(model, beam, combinationResult))
        : maximum;
    }, 0);
    const permanentDeflection = combinationSet
      ? blijvendeZakking({
          combinations: combinationSet.combinations,
          loadCases: combinationSet.loadCases,
          meet: (combination) => {
            const combinationResult = combinationSet.results.get(combination.id);
            return combinationResult
              ? -openFem3DMemberFieldDeflectionMm(model, beam, combinationResult)
              : null;
          },
        })
      : { mm: 0, notes: [] as string[] };
    const cfg = beam.checkConfig;
    const doorbuigingsklasse = cfg?.deflectionClass ? mapDeflectionClass(cfg.deflectionClass) : "Custom";
    const eigenKipsteunen = cfg?.lateralRestraints !== undefined || cfg?.lateralRestraintsBottom !== undefined;
    const vloerSteunt = !eigenKipsteunen && onderVloerOfDak.has(beam.id);
    const lateralBracing = eigenKipsteunen
      ? kipsteunenVanStaaf(cfg, forces.lengthM * 1000, "staal").lateral_bracing
      : { top_flange_positions: vloerSteunt ? BOVENFLENS_DOORGAAND : [], bottom_flange_positions: [] };
    const inputNotes = [...notes, ...permanentDeflection.notes,
      ...(vloerSteunt ? [BOVENFLENS_AANNAME] : [])];
    inputs.push({
      bijlage: "NL",
      beam_id: beam.id,
      profile_name: profile,
      steel_grade: material,
      length_m: forces.lengthM,
      forces_envelope: ulsEnvelope.length > 0 ? ulsEnvelope : openFem3DForceStations(result, beam.id),
      lateral_bracing: lateralBracing,
      // 0 = niet opgegeven: de kern neemt dan de staaflengte (om z: de grootste
      // afstand tussen plaatsen met een steun aan beide flenzen) en noemt dat.
      buckling_length_y_m: cfg?.bucklingLengthY_m ?? 0,
      buckling_length_z_m: cfg?.bucklingLengthZ_m ?? 0,
      // Doorbuigingsklasse uit de toetsinstellingen van de staaf, zoals in 2D
      // (dak, vloer, vloer met scheurgevoelige wanden, uitkraging of eigen
      // noemer); de kern leidt de NB-grenzen dan zelf af. Zonder opgave
      // blijft het L/300 voor w_fin en w_add.
      deflection_limit_class: doorbuigingsklasse,
      deflection_limit_numerator: doorbuigingsklasse === "Custom" ? cfg?.deflectionLimitNumerator ?? 300 : 333,
      deflection_actual_max_mm: -(deflectionCombinations.length > 0
        ? deflectionMm
        : openFem3DMemberFieldDeflectionMm(model, beam, result)),
      is_cantilever: startFree !== endFree,
      consequence_class: combinationSet?.consequenceClass ?? "CC2",
      pre_camber_mm: 0,
      deflection_permanent_mm: permanentDeflection.mm,
      deflection_add_limit_numerator: cfg?.deflectionAddLimitNumerator
        ?? (doorbuigingsklasse === "Custom" ? cfg?.deflectionLimitNumerator ?? 300 : 0),
      deflection_notes: inputNotes,
      q_equiv_n_per_mm: 0,
      z_a_mm: 0,
      staafeinden: { begin: startFree ? "Vrij" : "Gaffel", eind: endFree ? "Vrij" : "Gaffel" },
      staaf_notities: inputNotes,
      // Een trek-alleen staaf (windverband) doet alleen mee zolang zij op trek
      // staat: de kern toetst dan alleen trek (6.2.3) en meldt een eventuele
      // drukkracht als speling, niet getoetst.
      ...(beam.tensionOnly ? { tension_only: true } : {}),
    });
  }
  return { inputs, skipped, notes };
}

export async function runOpenFem3DSteelChecks(
  model: OpenFem3DModel,
  result: OpenFem3DSolveResult,
  combinationSet?: OpenFem3DCombinationSet,
): Promise<OpenFem3DSteelChecks> {
  const built = buildOpenFem3DSteelCheckInputs(model, result, combinationSet);
  // Pas hier geladen: de toetsstore trekt de Tauri-runtime mee, en
  // `buildOpenFem3DSteelCheckInputs` hoort ook in de solverbundel van de
  // MCP-server (staalhal met toetsing), die geen Tauri of DOM mag bevatten.
  const { roepKern } = await import("../../stores/checkStore");
  const results = built.inputs.length > 0
    ? await roepKern<BeamCheckResult[]>("check_steel_beams", built.inputs)
    : [];
  return { results, skipped: built.skipped, notes: built.notes };
}

export function checkUc(check: NamedCheck): number | null {
  return check.kind.data.uc?.uc ?? null;
}

/** Maximum ULS resistance/stability unity check; BGT remains separately qualified. */
export function openFem3DUlsUc(result: BeamCheckResult): number {
  return result.checks.reduce((maximum, check) =>
    check.id.startsWith("deflection_") || check.id.startsWith("sls_")
      ? maximum
      : Math.max(maximum, checkUc(check) ?? 0), 0);
}

export function openFem3DGoverningUlsCheck(result: BeamCheckResult): NamedCheck | undefined {
  return result.checks
    .filter((check) => !check.id.startsWith("deflection_") && !check.id.startsWith("sls_"))
    .reduce<NamedCheck | undefined>((governing, check) =>
      !governing || (checkUc(check) ?? -1) > (checkUc(governing) ?? -1) ? check : governing, undefined);
}

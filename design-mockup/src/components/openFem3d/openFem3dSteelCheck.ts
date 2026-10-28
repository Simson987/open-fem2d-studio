import {
  isSteelProfile, kipBelasting, mapDeflectionClass, profileLookupKey, VERTICAAL_VANAF_GRADEN,
} from "../../lib/steelCheckBuilder";
import { STEEL_GRADES } from "../../lib/steelGrades";
import { STEEL_SECTION_DIMS } from "../../lib/steelSectionDims.generated";
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
import { openFem3DMemberFieldChangeMm, openFem3DMemberFieldDeflectionMm } from "./openFem3dDisplacement";
import { openFem3DEinden, openFem3DUitkragingNotitie, openFem3DZijdelingseKnik } from "./openFem3dUitkraging";
import { analyseOpenFem3DLoadPanels } from "./openFem3dLoadPanels";
import { kipsteunenVanStaaf } from "../../lib/kipsteunen";
import { bepaalVerloop } from "../../lib/sectionResolver";
import {
  eigenNaamVan, isEigenProfiel, naarCustomSection, zoekEigenDoorsnede,
} from "../../lib/profieleditor/eigenDoorsnedenStore";

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
  /**
   * De scheefstand φ (rad) waarmee de UGT-varianten ±X en ±Y zijn gerekend; één
   * waarde voor beide richtingen. Nodig om te beslissen of de zijdelingse knik
   * van een stalen kolom met een vrije kop in de krachten zit
   * (`openFem3DZijdelingseKnik`). Ontbreekt → niet bekend, en dan geldt 2·L.
   */
  scheefstandPhi?: number;
}

/**
 * Een staaf die minstens 75° met het horizontale vlak maakt: een kolom of
 * gevelstijl. Dezelfde grens als in 2D (`VERTICAAL_VANAF_GRADEN`).
 */
function overwegendVerticaal(start: OpenFem3DNode, end: OpenFem3DNode): boolean {
  const lengte = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  if (!(lengte > 0)) return false;
  return Math.abs(end.z - start.z) / lengte >= Math.sin((VERTICAAL_VANAF_GRADEN * Math.PI) / 180);
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
  // Vrije einden en de inklemming van een uitkraging: dezelfde herkenning als
  // de houttoets (`openFem3dUitkraging.ts`) — een knoop op een plaat, een
  // oplegging, een andere staaf of bedding maakt een eind niet vrij.
  const einden = openFem3DEinden(model);
  const zijdelingseKnik = openFem3DZijdelingseKnik(
    model, ulsCombinations, (id) => combinationSet?.results.get(id)?.analysis, combinationSet?.scheefstandPhi,
  );
  for (const beam of model.beams) {
    const material = beam.material?.trim().toUpperCase();
    const profile = beam.profileName?.trim();
    if (!profile || !material || !isSteelProfile(profile) || !STEEL_GRADES.includes(material)) {
      skipped.push({ beamId: beam.id, reason: `geen toetsbaar catalogus-staalprofiel (${profile ?? "—"} — ${material ?? "—"})` });
      continue;
    }
    // Een eigen doorsnede (de gelaste tussendoorsnede van een gesplitste
    // verlopende staaf) reist als geometrie mee, zoals in 2D; een naam die
    // niet (meer) bewaard is, is een fout in het model en geen stille terugval.
    const eigen = isEigenProfiel(profile) ? zoekEigenDoorsnede(profile) : undefined;
    if (isEigenProfiel(profile) && !eigen) {
      skipped.push({
        beamId: beam.id,
        reason: `eigen doorsnede "${eigenNaamVan(profile)}" is niet (meer) bewaard — open de profieleditor en bewaar hem opnieuw`,
      });
      continue;
    }
    // Verlopend profiel (#73): dezelfde keuring en hetzelfde veld als in 2D
    // (`profile_end`); de kern toetst dan op elk station met de plaatselijke
    // doorsnede. Een prismatische staaf houdt een byte-gelijke invoer.
    const verloop = bepaalVerloop(beam.material, profile, beam.profileNameEnd);
    if (verloop.status === "fout") {
      skipped.push({ beamId: beam.id, reason: verloop.reden });
      continue;
    }
    const eigenEind = verloop.status === "verlopend" && isEigenProfiel(beam.profileNameEnd)
      ? zoekEigenDoorsnede(beam.profileNameEnd)
      : undefined;
    if (verloop.status === "verlopend" && isEigenProfiel(beam.profileNameEnd) && !eigenEind) {
      skipped.push({
        beamId: beam.id,
        reason: `eigen doorsnede "${eigenNaamVan(beam.profileNameEnd)}" als eindprofiel is niet (meer) bewaard — open de profieleditor en bewaar hem opnieuw`,
      });
      continue;
    }
    // Hoogte voor het aangrijpingspunt van de kiplast (z_a = +h/2), zoals in
    // 2D: bij een verlopende staaf die van het begin.
    const hMm = eigen
      ? eigen.motor.z_max_mm - eigen.motor.z_min_mm
      : STEEL_SECTION_DIMS[profileLookupKey(profile)]?.h;
    if (hMm === undefined) {
      skipped.push({ beamId: beam.id, reason: `profiel "${profile}" is niet bekend in de EN 1993-profieldatabase` });
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
    const startFree = einden.vrijEind(beam, beam.startNodeId);
    const endFree = einden.vrijEind(beam, beam.endNodeId);
    // Vrij eind van een kolom bij P-Δ met scheefstand: L of 2·L, zie
    // `openFem3DZijdelingseKnik` (het veld, of een kanttekening waarom niet).
    // Twee vrije einden: de kern weigert de knik; dan is er niets te beslissen.
    const zijdelings = (startFree || endFree) && !(startFree && endFree) ? zijdelingseKnik(beam) : {};
    // Uitkraging (precies één vrij eind, of de klasse "uitkraging" zonder
    // herkend vrij eind): de zakking vanaf het ingeklemde eind, niet vanaf de
    // koorde (controle 2026-10, punt K5).
    const inklemming = einden.inklemming(beam);
    const ulsEnvelope = ulsCombinations.flatMap((combination) => {
      const combinationResult = combinationSet?.results.get(combination.id);
      return combinationResult ? openFem3DForceStations(combinationResult, beam.id, combination.id) : [];
    });
    const forcesEnvelope = ulsEnvelope.length > 0 ? ulsEnvelope : openFem3DForceStations(result, beam.id);
    const deflectionMm = deflectionCombinations.reduce((maximum, combination) => {
      const combinationResult = combinationSet?.results.get(combination.id);
      return combinationResult
        ? Math.max(maximum, openFem3DMemberFieldDeflectionMm(model, beam, combinationResult, inklemming))
        : maximum;
    }, 0);
    const permanentDeflection = combinationSet
      ? blijvendeZakking({
          combinations: combinationSet.combinations,
          loadCases: combinationSet.loadCases,
          meet: (combination) => {
            const combinationResult = combinationSet.results.get(combination.id);
            return combinationResult
              ? -openFem3DMemberFieldDeflectionMm(model, beam, combinationResult, inklemming)
              : null;
          },
        })
      : { mm: 0, combo: null, notes: [] as string[] };
    // w_add = w2 + w3 als de grootste VERANDERING van het vervormingsveld ten
    // opzichte van de blijvende combinatie, niet als |w| − |w₁|: de 3D-maat is
    // een grootte zonder teken, en bij een overstek dat onder de blijvende last
    // omhoog en onder de veranderlijke omlaag gaat, viel de verandering zo weg
    // (controle 2026-10, punt K5). Alleen apart naar de kern als het verschilt
    // van wat de kern uit w − w₁ zou halen.
    const blijvendResultaat = permanentDeflection.combo
      ? combinationSet?.results.get(permanentDeflection.combo.id)
      : undefined;
    const wAddVerandering = blijvendResultaat && deflectionCombinations.length > 0
      ? deflectionCombinations.reduce((maximum, combination) => {
        const combinationResult = combinationSet?.results.get(combination.id);
        return combinationResult
          ? Math.max(maximum, openFem3DMemberFieldChangeMm(model, beam, combinationResult, blijvendResultaat, inklemming))
          : maximum;
      }, 0)
      : null;
    const wAddKern = Math.abs(-deflectionMm - permanentDeflection.mm);
    const wAddApart = wAddVerandering !== null && Math.abs(wAddVerandering - wAddKern) > 1e-6
      ? -wAddVerandering
      : undefined;
    const cfg = beam.checkConfig;
    // Zonder opgegeven klasse dezelfde standaard als in 2D en in de 3D-houttoets:
    // een overwegend horizontale staaf is een vloerligger (w_fin tegen ℓ_rep/250,
    // w_add tegen 3/1 000 · ℓ_rep, NEN-EN 1990:2002/NB:2019 A1.4.3(3)/(4), met
    // ℓ_rep = 2·L bij een uitkraging); een kolom of gevelstijl krijgt h/300 uit
    // A1.4.3(7). Tot oktober 2026 kreeg elke staaf zonder klasse L/300 voor w_fin
    // én w_add op de staaflengte, ook een uitkraging: geen NB-waarde, en bij een
    // uitkraging 2,4 keer te streng (controle 2026-10, punten B15 en K5).
    const verticaal = overwegendVerticaal(start, end);
    const doorbuigingsklasse = cfg?.deflectionClass
      ? mapDeflectionClass(cfg.deflectionClass)
      : verticaal ? "Custom" : "Floor";
    const eigenKipsteunen = cfg?.lateralRestraints !== undefined || cfg?.lateralRestraintsBottom !== undefined;
    const vloerSteunt = !eigenKipsteunen && onderVloerOfDak.has(beam.id);
    const lateralBracing = eigenKipsteunen
      ? kipsteunenVanStaaf(cfg, forces.lengthM * 1000, "staal").lateral_bracing
      : { top_flange_positions: vloerSteunt ? BOVENFLENS_DOORGAAND : [], bottom_flange_positions: [] };
    const inputNotes = [...notes, ...permanentDeflection.notes,
      ...(inklemming ? [openFem3DUitkragingNotitie(inklemming)] : []),
      ...(!cfg?.deflectionClass
        ? [verticaal
          ? "Geen doorbuigingsklasse opgegeven: de staaf staat (overwegend) verticaal, dus de zijdelingse eis h/300 (NEN-EN 1990:2002/NB:2019 A1.4.3(7))."
          : "Geen doorbuigingsklasse opgegeven: de staaf ligt (overwegend) horizontaal en is als vloerligger getoetst — w_fin tegen ℓ_rep/250 (A1.4.3(4)) en w_add tegen 3/1 000 · ℓ_rep (A1.4.3(3)), zoals in 2D. Kies in de toetsinstellingen een andere klasse als dat niet past."]
        : []),
      ...(wAddApart !== undefined
        ? [`w_add = ${Math.abs(wAddApart).toFixed(2).replace(".", ",")} mm is de grootste verandering van het vervormingsveld ten opzichte van de blijvende combinatie "${permanentDeflection.combo?.name ?? "—"}" (w2 + w3 = w_tot − w1, figuur NB.1), niet |w| − |w₁| = ${wAddKern.toFixed(2).replace(".", ",")} mm.`]
        : []),
      ...(vloerSteunt ? [BOVENFLENS_AANNAME] : [])];
    inputs.push({
      bijlage: "NL",
      beam_id: beam.id,
      profile_name: eigen ? eigen.naam : profile,
      ...(eigen ? { custom_section: naarCustomSection(eigen) } : {}),
      ...(verloop.status === "verlopend" ? { profile_end: (beam.profileNameEnd ?? "").trim() } : {}),
      ...(eigenEind ? { custom_section_end: naarCustomSection(eigenEind) } : {}),
      steel_grade: material,
      length_m: forces.lengthM,
      forces_envelope: forcesEnvelope,
      lateral_bracing: lateralBracing,
      // 0 = niet opgegeven: de kern neemt dan de staaflengte (om z: de grootste
      // afstand tussen plaatsen met een steun aan beide flenzen) en noemt dat.
      buckling_length_y_m: cfg?.bucklingLengthY_m ?? 0,
      buckling_length_z_m: cfg?.bucklingLengthZ_m ?? 0,
      // Doorbuigingsklasse uit de toetsinstellingen van de staaf, zoals in 2D
      // (dak, vloer, vloer met scheurgevoelige wanden, uitkraging of eigen
      // noemer); de kern leidt de NB-grenzen dan zelf af. Zonder opgave: een
      // vloerligger, of h/300 bij een verticale staaf (zie hierboven).
      deflection_limit_class: doorbuigingsklasse,
      // Buiten "Custom" leest de kern de noemer niet; 250 is de w_max-grens
      // ℓ_rep/250 van NEN-EN 1990:2002/NB:2019 A1.4.3(4) die zij dan toetst.
      deflection_limit_numerator: doorbuigingsklasse === "Custom" ? cfg?.deflectionLimitNumerator ?? 300 : 250,
      deflection_actual_max_mm: -(deflectionCombinations.length > 0
        ? deflectionMm
        : openFem3DMemberFieldDeflectionMm(model, beam, result, inklemming)),
      // Uitkraging: ℓ_rep = 2·L voor w_fin én w_add (de kern negeert de vlag bij
      // "Custom", waar de noemer op de staaflengte staat).
      is_cantilever: inklemming !== null,
      consequence_class: combinationSet?.consequenceClass ?? "CC2",
      pre_camber_mm: 0,
      deflection_permanent_mm: permanentDeflection.mm,
      ...(wAddApart !== undefined ? { deflection_add_mm: wAddApart } : {}),
      deflection_add_limit_numerator: cfg?.deflectionAddLimitNumerator
        ?? (doorbuigingsklasse === "Custom" ? cfg?.deflectionLimitNumerator ?? 300 : 0),
      deflection_notes: inputNotes,
      // q_equiv uit de momentenlijn en de last op de bovenflens (z_a = +h/2):
      // dezelfde regel als in 2D (#111). Met 0 en 0 lag de last in het
      // dwarskrachtcentrum en kwam de kip-UC te gunstig uit.
      ...kipBelasting(forcesEnvelope, forces.lengthM * 1000, hMm),
      staafeinden: { begin: startFree ? "Vrij" : "Gaffel", eind: endFree ? "Vrij" : "Gaffel" },
      // Een vrij eind van een kolom, P-Δ met scheefstand in X en Y van minstens
      // de φ van de kolom zelf: de zijdelingse knik zit al in de krachten, en de
      // kern kiest L in plaats van 2·L (zie `openFem3DZijdelingseKnik`).
      ...(zijdelings.veld ? { zijdelingse_knik_in_analyse: zijdelings.veld } : {}),
      // De kanttekening ("blijft 2·L") alleen als de kern om minstens één as
      // ook echt 2·L neemt: niet als beide kniklengtes zijn opgegeven.
      staaf_notities: [
        ...inputNotes,
        ...(zijdelings.notitie && !((cfg?.bucklingLengthY_m ?? 0) > 0 && (cfg?.bucklingLengthZ_m ?? 0) > 0)
          ? [zijdelings.notitie] : []),
      ],
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

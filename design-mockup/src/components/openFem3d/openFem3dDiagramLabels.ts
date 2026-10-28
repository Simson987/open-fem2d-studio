/**
 * openFem3dDiagramLabels.ts — de getallen bij de snedekrachtlijnen in 3D
 * (issue #95). Eén gedeelde instelling voor de lijnen (N, Vy, Vz, T, My, Mz
 * en de gronddruk p van #106): Waarden aan of uit, en een stand van 1 (weinig) tot 5 (veel). Een
 * weergavevoorkeur van de gebruiker (onthouden in de browser, en mee in een
 * eigen view), geen modelgegeven. Geen React, geen Three.
 *
 * DE STANDEN, per lijn (component):
 *   1  alleen de maatgevende waarde in het hele model: het grootste |waarde|,
 *      één label per lijn;
 *   2  per staaf alleen het uiterste, op de staven met de grootste waarden: de
 *      top 10 % met een minimum van 3, maar nooit op meer staven dan stand 3;
 *   3  de oude regel van het tekenvlak: tot 24 staven alle, anders elke
 *      ceil(n/16)e staaf, met begin, eind en (als het binnen ligt) uiterste;
 *   4  alle staven, labels per staaf als in stand 3;
 *   5  alle staven: begin, eind, uiterste én de kwartpunten.
 * Geselecteerde staven tonen hun waarden altijd (labels als in stand 4, in
 * stand 5 als in stand 5); is de maatgevende staaf geselecteerd, dan blijft
 * ook zijn uiterste in beeld. Waarden uit: geen enkel getal; de lijnen blijven.
 *
 * N en T zijn geen getekende lijnen maar één label op het staafmidden met de
 * grootste eindwaarde ("N … · T …"). Voor hen geldt hetzelfde met één waarde
 * per staaf (stand 5 = stand 4); stand 2 kiest de staven voor N en T samen,
 * zodat er niet meer middenlabels komen dan in stand 3.
 *
 * MONOTOON. Een hogere stand toont nooit minder: niet per lijn (waarden), en
 * niet in labels op het tekenvlak (elementen: elk lijnlabel, en per staaf één
 * middenlabel). Daarvoor telt stand 2 nooit meer staven dan stand 3, en toont
 * stand 3 de maatgevende waarde als geen enkele (niet-geselecteerde)
 * ingedeelde staaf die lijn heeft — anders zou stand 3 minder tonen dan stand
 * 1. Buiten dat randgeval is stand 3 precies de oude regel.
 */
import type { OpenFem3DDiagramComponent } from "./openFem3dDiagramSide";
import type { OpenFem3DSelection } from "./openFem3dSelection";
import type { OpenFem3DVisibility } from "./openFem3dVisibility";

export type OpenFem3DDiagramLabelStand = 1 | 2 | 3 | 4 | 5;

export interface OpenFem3DDiagramLabels {
  /** Getallen bij de snedekrachtlijnen en op het staafmidden (N, T); uit: alleen de lijnen. */
  show: boolean;
  /** 1 (weinig) … 5 (veel); 3 = zoals het tekenvlak het altijd deed. */
  stand: OpenFem3DDiagramLabelStand;
}

export const OPEN_FEM_3D_DIAGRAM_LABEL_STANDS: readonly OpenFem3DDiagramLabelStand[] = [1, 2, 3, 4, 5];

export const DEFAULT_OPEN_FEM_3D_DIAGRAM_LABELS: OpenFem3DDiagramLabels = { show: true, stand: 3 };

const STORAGE_KEY = "open-fem-studio.openFem3d.diagramLabels";

/** Elke waarde → een geldige instelling: per veld de standaard, de stand afgerond en begrensd. */
export function normalizeOpenFem3DDiagramLabels(value: unknown): OpenFem3DDiagramLabels {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_OPEN_FEM_3D_DIAGRAM_LABELS };
  const raw = value as Record<string, unknown>;
  const show = typeof raw.show === "boolean" ? raw.show : DEFAULT_OPEN_FEM_3D_DIAGRAM_LABELS.show;
  const stand = typeof raw.stand === "number" && Number.isFinite(raw.stand)
    ? Math.min(5, Math.max(1, Math.round(raw.stand))) as OpenFem3DDiagramLabelStand
    : DEFAULT_OPEN_FEM_3D_DIAGRAM_LABELS.stand;
  return { show, stand };
}

export function sameOpenFem3DDiagramLabels(a: OpenFem3DDiagramLabels, b: OpenFem3DDiagramLabels): boolean {
  return a.show === b.show && a.stand === b.stand;
}

export function readOpenFem3DDiagramLabels(): OpenFem3DDiagramLabels {
  if (typeof localStorage === "undefined") return { ...DEFAULT_OPEN_FEM_3D_DIAGRAM_LABELS };
  try {
    return normalizeOpenFem3DDiagramLabels(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
  } catch {
    return { ...DEFAULT_OPEN_FEM_3D_DIAGRAM_LABELS };
  }
}

export function saveOpenFem3DDiagramLabels(value: OpenFem3DDiagramLabels): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Privé venster of volle opslag: de keuze geldt dan alleen deze sessie.
  }
}

// ── Welke lijnen ───────────────────────────────────────────────────────────

/** De waarden op het staafmidden (geen getekende lijn). */
export type OpenFem3DMidForce = "axialForce" | "torsion";
export type OpenFem3DForceLayer = OpenFem3DDiagramComponent | OpenFem3DMidForce;

/**
 * De lijnen met waarden, in de volgorde van de tab Resultaten: de zes
 * snedekrachten en de gronddruk onder staven op bedding (issue #106).
 */
export const OPEN_FEM_3D_FORCE_LAYERS: readonly OpenFem3DForceLayer[] = [
  "axialForce", "shearY", "shearZ", "torsion", "momentY", "momentZ", "groundPressure",
];
/** De getekende lijnen, in tekenvolgorde. */
export const OPEN_FEM_3D_DIAGRAM_COMPONENTS: readonly OpenFem3DDiagramComponent[] = ["shearY", "shearZ", "momentY", "momentZ", "groundPressure"];
/** De delen van het middenlabel, in leesvolgorde. */
export const OPEN_FEM_3D_MID_FORCES: readonly OpenFem3DMidForce[] = ["axialForce", "torsion"];

/** De eerste aangevinkte lijn (daaronder staat het sub-blok Waarden); null = geen. */
export function openFem3DFirstActiveForceLayer(visibility: Pick<OpenFem3DVisibility, OpenFem3DForceLayer>): OpenFem3DForceLayer | null {
  return OPEN_FEM_3D_FORCE_LAYERS.find((layer) => visibility[layer]) ?? null;
}

/** De staven waarvan de waarden altijd te zien zijn: de geselecteerde, oplopend. */
export function openFem3DDiagramLabelSelection(selection: OpenFem3DSelection): number[] {
  if (selection?.type === "beam") return [selection.id];
  if (selection?.type === "multi") return [...selection.beamIds].sort((a, b) => a - b);
  return [];
}

/**
 * Staafindeling van de resultaatlabels: tot 24 staven alle, anders elke
 * ceil(n/16)e staaf (op de plek in het model). Ook de UC-labels gebruiken hem.
 */
export function openFem3DResultLabelStride(beamCount: number): number {
  return beamCount <= 24 ? 1 : Math.ceil(beamCount / 16);
}

export interface OpenFem3DDiagramSample {
  /** Relatieve positie langs de staaf: 0 = begin, 1 = einde. */
  t: number;
  value: number;
}

/** Wordt deze lijn getekend? Minstens twee punten en niet overal 0,000. */
export function openFem3DDiagramDrawn(samples: readonly OpenFem3DDiagramSample[]): boolean {
  return samples.length >= 2 && samples.some((sample) => Math.abs(sample.value) >= 5e-4);
}

/** De waarde op t, lineair tussen de punten (buiten de punten: de rand). */
export function openFem3DDiagramValueAt(samples: readonly OpenFem3DDiagramSample[], t: number): number {
  if (samples.length === 0) return 0;
  if (t <= samples[0].t) return samples[0].value;
  for (let index = 1; index < samples.length; index += 1) {
    const right = samples[index];
    if (t <= right.t) {
      const left = samples[index - 1];
      const span = right.t - left.t;
      return span > 1e-12 ? left.value + (right.value - left.value) * (t - left.t) / span : right.value;
    }
  }
  return samples[samples.length - 1].value;
}

/** Het eerste punt met het grootste |waarde| (zoals het tekenvlak altijd koos). */
function peakIndex(samples: readonly OpenFem3DDiagramSample[]): number {
  let peak = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if (Math.abs(samples[index].value) > Math.abs(samples[peak].value)) peak = index;
  }
  return peak;
}

// ── Het plan ───────────────────────────────────────────────────────────────

/** Een staaf zoals het tekenvlak hem aanlevert. */
export interface OpenFem3DDiagramLabelBeam {
  beamId: number;
  /** Plek in model.beams: de staafindeling van stand 3 telt hierop. */
  index: number;
  /** De punten per actieve lijn. */
  diagrams: Partial<Record<OpenFem3DDiagramComponent, readonly OpenFem3DDiagramSample[]>>;
  /** Per actief middendeel de waarde: max(|begin|, |eind|). */
  mid: Partial<Record<OpenFem3DMidForce, number>>;
}

export type OpenFem3DDiagramLabelKind = "start" | "end" | "peak" | "extreme" | "quarter";

export interface OpenFem3DPlannedDiagramLabel {
  /**
   * start/end: de eindwaarde, iets binnen de staaf geplaatst (op een gedeelde
   * knoop vallen de labels anders over elkaar); peak: het uiterste binnen de
   * staaf; extreme: het uiterste als enige waarde (stand 1 en 2); quarter: een
   * kwartpunt (stand 5).
   */
  kind: OpenFem3DDiagramLabelKind;
  value: number;
  /** Het punt van de lijn waar het label staat … */
  sample?: number;
  /** … of de relatieve positie langs de staaf (kwartpunten). */
  t?: number;
}

export interface OpenFem3DDiagramLabelPlanBeam {
  beamId: number;
  /** Per lijn met labels, in tekenvolgorde. */
  diagrams: { component: OpenFem3DDiagramComponent; labels: OpenFem3DPlannedDiagramLabel[] }[];
  /** De delen van het middenlabel, in leesvolgorde. */
  mid: { component: OpenFem3DMidForce; value: number }[];
}

export interface OpenFem3DDiagramLabelPlan {
  /** Alleen staven met iets te tonen, in modelvolgorde. */
  beams: OpenFem3DDiagramLabelPlanBeam[];
  /** Aantal getoonde waarden: lijnlabels plus delen van middenlabels. */
  count: number;
  /** Aantal labels op het tekenvlak: elk lijnlabel, plus één middenlabel per staaf (N en T samen). */
  elements: number;
  /**
   * Per lijn de staaf met de maatgevende waarde (het grootste |waarde|, de
   * eerste bij gelijke waarde). Het tekenvlak zet de labels van die staaf
   * altijd als element neer, ook als het een grote labellaag uitdunt.
   */
  governingBeamIds: Partial<Record<OpenFem3DForceLayer, number>>;
}

const QUARTERS = [0.25, 0.5, 0.75] as const;

/** De labels van één staaf: stand 3/4 (begin, eind, uiterste als het binnen ligt) of 5 (ook de kwartpunten). */
function beamLabels(samples: readonly OpenFem3DDiagramSample[], alle: boolean): OpenFem3DPlannedDiagramLabel[] {
  const last = samples.length - 1;
  const inset = Math.min(last, Math.max(1, Math.round(last * 0.18)));
  const labels: OpenFem3DPlannedDiagramLabel[] = [
    { kind: "start", value: samples[0].value, sample: inset },
    { kind: "end", value: samples[last].value, sample: Math.max(0, last - inset) },
  ];
  const peak = peakIndex(samples);
  // Stand 3/4: een uiterste vlak naast een eind valt samen met het eindlabel
  // (dat iets binnen de staaf staat) en wordt overgeslagen; stand 5 toont het.
  const peakShown = alle ? peak > 0 && peak < last : peak > 1 && peak < last - 1;
  if (peakShown) labels.push({ kind: "peak", value: samples[peak].value, sample: peak });
  if (alle) {
    const peakT = samples[peak].t;
    for (const t of QUARTERS) {
      if (peakShown && Math.abs(peakT - t) < 0.05) continue;
      labels.push({ kind: "quarter", value: openFem3DDiagramValueAt(samples, t), t });
    }
  }
  return labels;
}

/** Het eerste element met de grootste `size` (zoals het tekenvlak altijd koos). */
function largest<T extends { size: number }>(list: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const item of list) if (!best || item.size > best.size) best = item;
  return best;
}

/** Een getekende lijn op één staaf. */
interface DiagramCandidate {
  beam: OpenFem3DDiagramLabelBeam;
  samples: readonly OpenFem3DDiagramSample[];
  /** Het punt met het grootste |waarde| … */
  peak: number;
  /** … en die |waarde|: bepaalt de volgorde in stand 1 en 2. */
  size: number;
}

const extremeLabel = (candidate: DiagramCandidate): OpenFem3DPlannedDiagramLabel =>
  ({ kind: "extreme", value: candidate.samples[candidate.peak].value, sample: candidate.peak });

/** Toont deze set het uiterste van de staaf (als uiterste, of als begin- of eindwaarde)? */
function showsExtreme(labels: readonly OpenFem3DPlannedDiagramLabel[], candidate: DiagramCandidate): boolean {
  return candidate.peak === 0 || candidate.peak === candidate.samples.length - 1
    || labels.some((label) => (label.kind === "peak" || label.kind === "extreme") && label.sample === candidate.peak);
}

/** Welke staven van één getekende lijn welke labels krijgen; zie de standen bovenaan. */
function planDiagram(
  candidates: readonly DiagramCandidate[],
  stand: OpenFem3DDiagramLabelStand,
  stride: number,
  selected: ReadonlySet<number>,
): Map<number, OpenFem3DPlannedDiagramLabel[]> {
  const uit = new Map<number, OpenFem3DPlannedDiagramLabel[]>();
  const governing = largest(candidates);
  if (!governing) return uit;
  const full = (candidate: DiagramCandidate) => beamLabels(candidate.samples, stand === 5);
  const unselected = candidates.filter((candidate) => !selected.has(candidate.beam.beamId));
  const strideBeams = unselected.filter((candidate) => candidate.beam.index % stride === 0);
  if (stand === 1 || (stand <= 3 && strideBeams.length === 0)) {
    if (!selected.has(governing.beam.beamId)) uit.set(governing.beam.beamId, [extremeLabel(governing)]);
  } else if (stand === 2) {
    // Nooit op meer staven dan stand 3 (dat er per staaf minstens twee toont).
    const k = Math.min(Math.max(3, Math.ceil(candidates.length / 10)), strideBeams.length, unselected.length);
    [...unselected].sort((a, b) => b.size - a.size || a.beam.index - b.beam.index).slice(0, k)
      .forEach((candidate) => uit.set(candidate.beam.beamId, [extremeLabel(candidate)]));
  } else {
    (stand === 3 ? strideBeams : unselected).forEach((candidate) => uit.set(candidate.beam.beamId, full(candidate)));
  }
  // Geselecteerde staven altijd, als volledige staaf. Ligt het uiterste van de
  // geselecteerde maatgevende staaf vlak naast een eind (dan toont de volledige
  // set het niet, zie beamLabels), dan komt het er als eigen label bij: een
  // selectie laat de maatgevende waarde nooit verdwijnen. In elke stand, zodat
  // het aantal monotoon blijft.
  for (const candidate of candidates) {
    if (!selected.has(candidate.beam.beamId)) continue;
    const labels = full(candidate);
    if (candidate === governing && !showsExtreme(labels, candidate)) labels.push(extremeLabel(candidate));
    uit.set(candidate.beam.beamId, labels);
  }
  return uit;
}

/** Per staaf de delen van het middenlabel. */
type MidParts = Map<OpenFem3DDiagramLabelBeam, Set<OpenFem3DMidForce>>;

function putMid(parts: MidParts, beam: OpenFem3DDiagramLabelBeam, component: OpenFem3DMidForce) {
  let set = parts.get(beam);
  if (!set) parts.set(beam, set = new Set());
  set.add(component);
}

/**
 * De middenlabels (N en T): per staaf één label met zijn delen. N en T worden
 * samen ingedeeld, zodat ook het aantal labels (niet alleen het aantal
 * waarden) monotoon met de stand toeneemt:
 *   1  per deel de maatgevende staaf;
 *   2  de staven met de grootste waarden (de maatgevende voorop), niet meer
 *      staven dan stand 3 en per deel niet meer waarden dan stand 3;
 *   3  de ingedeelde staven met al hun delen (de oude regel);
 *   4/5 alle staven.
 */
function planMid(
  beams: readonly OpenFem3DDiagramLabelBeam[],
  stand: OpenFem3DDiagramLabelStand,
  stride: number,
  selected: ReadonlySet<number>,
): { parts: MidParts; governing: Map<OpenFem3DMidForce, OpenFem3DDiagramLabelBeam> } {
  const parts: MidParts = new Map();
  const governing = new Map<OpenFem3DMidForce, OpenFem3DDiagramLabelBeam>();
  const componentsOf = (beam: OpenFem3DDiagramLabelBeam) => OPEN_FEM_3D_MID_FORCES.filter((component) => beam.mid[component] !== undefined);
  const candidates = beams.filter((beam) => componentsOf(beam).length > 0);
  if (candidates.length === 0) return { parts, governing };
  for (const component of OPEN_FEM_3D_MID_FORCES) {
    const best = largest(candidates.filter((beam) => beam.mid[component] !== undefined)
      .map((beam) => ({ beam, size: Math.abs(beam.mid[component]!) })));
    if (best) governing.set(component, best.beam);
  }
  const isSelected = (beam: OpenFem3DDiagramLabelBeam) => selected.has(beam.beamId);
  const unselected = candidates.filter((beam) => !isSelected(beam));
  // Stand 1: per deel zijn maatgevende staaf (niet als die geselecteerd is: die toont alles).
  const stand1 = [...governing].filter(([, beam]) => !isSelected(beam));
  const stand1Beams = new Set(stand1.map(([, beam]) => beam));
  // Stand 3: de ingedeelde staven met al hun delen. Heeft geen ingedeelde
  // staaf een deel, dan dat deel op zijn maatgevende staaf; en levert dat
  // minder labels dan stand 1, dan die van stand 1 erbij.
  const stand3: MidParts = new Map();
  for (const beam of unselected) if (beam.index % stride === 0) componentsOf(beam).forEach((component) => putMid(stand3, beam, component));
  for (const [component, beam] of stand1) {
    if (![...stand3.values()].some((set) => set.has(component))) putMid(stand3, beam, component);
  }
  if (stand3.size < stand1Beams.size) stand1.forEach(([component, beam]) => putMid(stand3, beam, component));

  if (stand === 1) {
    stand1.forEach(([component, beam]) => putMid(parts, beam, component));
  } else if (stand === 2) {
    const cap = new Map(OPEN_FEM_3D_MID_FORCES.map((component) =>
      [component, [...stand3.values()].filter((set) => set.has(component)).length]));
    const limit = Math.min(Math.max(3, Math.ceil(candidates.length / 10)), stand3.size, unselected.length);
    // Rangorde: de grootste waarde van de staaf, per deel gedeeld door het maatgevende.
    const scale = (component: OpenFem3DMidForce) => Math.abs(governing.get(component)?.mid[component] ?? 0);
    const score = (beam: OpenFem3DDiagramLabelBeam) => Math.max(0, ...componentsOf(beam)
      .map((component) => scale(component) > 0 ? Math.abs(beam.mid[component]!) / scale(component) : 0));
    const ranked = [...unselected].sort((a, b) => score(b) - score(a) || a.index - b.index);
    const chosen = [...new Set([...stand1Beams, ...ranked])].slice(0, limit);
    const count = new Map<OpenFem3DMidForce, number>();
    const take = (beam: OpenFem3DDiagramLabelBeam, component: OpenFem3DMidForce) => {
      if (parts.get(beam)?.has(component) || (count.get(component) ?? 0) >= (cap.get(component) ?? 0)) return;
      putMid(parts, beam, component);
      count.set(component, (count.get(component) ?? 0) + 1);
    };
    stand1.forEach(([component, beam]) => take(beam, component));
    for (const beam of chosen) componentsOf(beam).forEach((component) => take(beam, component));
  } else if (stand === 3) {
    stand3.forEach((set, beam) => set.forEach((component) => putMid(parts, beam, component)));
  } else {
    for (const beam of unselected) componentsOf(beam).forEach((component) => putMid(parts, beam, component));
  }
  // Geselecteerde staven altijd, met al hun delen.
  for (const beam of candidates) if (isSelected(beam)) componentsOf(beam).forEach((component) => putMid(parts, beam, component));
  return { parts, governing };
}

/**
 * Het plan: per staaf welke waarden op het tekenvlak komen. `beamCount` is
 * het aantal staven in het model (de staafindeling van stand 3 telt daarop,
 * ook voor staven zonder resultaat).
 */
export function planOpenFem3DDiagramLabels(
  beams: readonly OpenFem3DDiagramLabelBeam[],
  options: { beamCount: number; labels: OpenFem3DDiagramLabels; selectedBeamIds: Iterable<number> },
): OpenFem3DDiagramLabelPlan {
  const { labels } = options;
  if (!labels.show) return { beams: [], count: 0, elements: 0, governingBeamIds: {} };
  const stand = normalizeOpenFem3DDiagramLabels(labels).stand;
  const stride = openFem3DResultLabelStride(options.beamCount);
  const selected = new Set(options.selectedBeamIds);
  const governingBeamIds: Partial<Record<OpenFem3DForceLayer, number>> = {};
  const perDiagram = new Map<OpenFem3DDiagramComponent, Map<number, OpenFem3DPlannedDiagramLabel[]>>();
  for (const component of OPEN_FEM_3D_DIAGRAM_COMPONENTS) {
    const candidates: DiagramCandidate[] = [];
    for (const beam of beams) {
      const samples = beam.diagrams[component];
      if (!samples || !openFem3DDiagramDrawn(samples)) continue;
      const peak = peakIndex(samples);
      candidates.push({ beam, samples, peak, size: Math.abs(samples[peak].value) });
    }
    const governing = largest(candidates);
    if (governing) governingBeamIds[component] = governing.beam.beamId;
    perDiagram.set(component, planDiagram(candidates, stand, stride, selected));
  }
  const mid = planMid(beams, stand, stride, selected);
  mid.governing.forEach((beam, component) => { governingBeamIds[component] = beam.beamId; });
  const planned: OpenFem3DDiagramLabelPlanBeam[] = [];
  let count = 0;
  let elements = 0;
  for (const beam of beams) {
    const diagrams = OPEN_FEM_3D_DIAGRAM_COMPONENTS.flatMap((component) => {
      const list = perDiagram.get(component)?.get(beam.beamId);
      return list ? [{ component, labels: list }] : [];
    });
    const midParts = mid.parts.get(beam);
    const midList = OPEN_FEM_3D_MID_FORCES.filter((component) => midParts?.has(component))
      .map((component) => ({ component, value: beam.mid[component]! }));
    if (diagrams.length === 0 && midList.length === 0) continue;
    const lineLabels = diagrams.reduce((total, diagram) => total + diagram.labels.length, 0);
    count += lineLabels + midList.length;
    elements += lineLabels + (midList.length > 0 ? 1 : 0);
    planned.push({ beamId: beam.beamId, diagrams, mid: midList });
  }
  return { beams: planned, count, elements, governingBeamIds };
}

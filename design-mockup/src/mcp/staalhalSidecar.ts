/**
 * staalhalSidecar.ts — de twee sidecarbewerkingen achter de MCP-tool
 * `open_fem_3d_staalhal_maken`.
 *
 * DE KETEN, en wie wat doet
 *   1. `staalhal_maken` (hier): de generator van de wizard bouwt de hal; met
 *      `reken` erbij komen er per belastinggeval en per standaardcombinatie
 *      rekenverzoeken voor de 3D-kern bij — gebouwd met
 *      `buildOpenFem3DSolveRequest`, dezelfde functie als de app gebruikt,
 *      en met het eigen gewicht via `withOpenFem3DSelfWeight`.
 *   2. Rust rekent elk verzoek met `open_fem_3d::solve`: dezelfde vastgezette
 *      kern als het Tauri-command `solve_open_fem_3d`.
 *   3. `staalhal_uitwerken` (hier): reactiesommen, evenwicht (kern én de
 *      onafhankelijke krachtensom), verplaatsingen en de EN 1993/EN 1995-
 *      toetsinvoer met dezelfde bouwfuncties als de app.
 *   4. Rust toetst met `steel_check::check_all_beams` en
 *      `timber_check::check_all_timber_beams`, dezelfde functies als de app.
 * Er wordt nergens iets tweemaal uitgerekend: de sidecar kent de kern niet,
 * Rust kent de generator niet.
 *
 * DETERMINISME. Beide bewerkingen bouwen de hal opnieuw uit dezelfde
 * parameters. De generator is een pure functie, dus stap 3 ziet precies het
 * model en de verzoeken van stap 1; een resultaat dat bij een ander verzoek
 * hoort wordt aan de sleutels en de knoopnummers herkend en geweigerd.
 */
import { eigenGewichtGeval } from "../lib/eigenGewicht";
import { importeer as importeerEigenDoorsneden } from "../lib/profieleditor/eigenDoorsnedenStore";
import { defaultCombinations, type LoadCombination } from "../components/fem/solver/combinations";
import { GEVOLGKLASSEN, STANDAARD_GEVOLGKLASSE, type Gevolgklasse } from "../components/fem/solver/normcombinaties";
import { openFem3DLoadCaseId, withOpenFem3DSelfWeight, type OpenFem3DModel } from "../components/openFem3d/openFem3dModel";
import {
  buildOpenFem3DSolveRequest,
  openFem3DGlobalForceBalance,
  type OpenFem3DAnalysisKind,
  type OpenFem3DSolveResult,
} from "../components/openFem3d/openFem3dSolver";
import { openFem3DMaximumDisplacementM } from "../components/openFem3d/openFem3dDisplacement";
import { buildOpenFem3DSteelCheckInputs } from "../components/openFem3d/openFem3dSteelCheck";
import { buildOpenFem3DTimberCheckInputs } from "../components/openFem3d/openFem3dTimberCheck";
import {
  maakStaalhal,
  staalhalProject,
  StaalhalFout,
  type StaalhalResultaat,
} from "../components/openFem3d/wizards/staalhal";

/** De velden van een `staalhal_maken`-payload; een ander veld wordt geweigerd. */
const MAKEN_VELDEN = ["hal", "reken", "stramien"] as const;
const UITWERKEN_VELDEN = ["hal", "reken", "resultaten"] as const;
const REKEN_VELDEN = ["analyse", "gevolgklasse"] as const;

export interface StaalhalRekeninstellingen {
  analyse: OpenFem3DAnalysisKind;
  gevolgklasse: Gevolgklasse;
}

function invoerFout(veld: string, melding: string): StaalhalFout {
  return new StaalhalFout([{ code: "ongeldigeKeuze", veld, melding }]);
}

function eisVelden(payload: Record<string, unknown>, velden: readonly string[], waar: string) {
  const onbekend = Object.keys(payload).filter((k) => !velden.includes(k));
  if (onbekend.length > 0) {
    throw new StaalhalFout(onbekend.map((k) => ({
      code: "onbekendVeld" as const, veld: k,
      melding: `Onbekend veld \`${k}\` in ${waar}; bekend zijn: ${velden.join(", ")}.`,
    })));
  }
}

function leesReken(waarde: unknown): StaalhalRekeninstellingen | null {
  if (waarde === undefined || waarde === null || waarde === false) return null;
  const raw = waarde === true ? {} : waarde;
  if (typeof raw !== "object" || Array.isArray(raw)) throw invoerFout("reken", "`reken` moet een object zijn.");
  const r = raw as Record<string, unknown>;
  eisVelden(r, REKEN_VELDEN, "`reken`");
  const analyse = r.analyse ?? "linear";
  if (analyse !== "linear" && analyse !== "p-delta") {
    throw invoerFout("reken.analyse", '`reken.analyse` moet "linear" of "p-delta" zijn.');
  }
  const gevolgklasse = r.gevolgklasse ?? STANDAARD_GEVOLGKLASSE;
  if (typeof gevolgklasse !== "string" || !(GEVOLGKLASSEN as readonly string[]).includes(gevolgklasse)) {
    throw invoerFout("reken.gevolgklasse", `\`reken.gevolgklasse\` moet een van ${GEVOLGKLASSEN.join(", ")} zijn.`);
  }
  return { analyse, gevolgklasse: gevolgklasse as Gevolgklasse };
}

/** Eén verzoek aan de 3D-kern, met een sleutel waaronder Rust het resultaat teruggeeft. */
export interface StaalhalRekenverzoek {
  sleutel: string;
  soort: "geval" | "combinatie";
  id: number;
  naam: string;
  /** Het verzoek van `buildOpenFem3DSolveRequest`, zonder knikvormen (bucklingModes 0). */
  verzoek: Omit<ReturnType<typeof buildOpenFem3DSolveRequest>, "bucklingModes"> & { bucklingModes: number };
}

interface Rekenopzet {
  rekenmodel: OpenFem3DModel;
  combinaties: LoadCombination[];
  verzoeken: StaalhalRekenverzoek[];
}

/**
 * Het rekenmodel (met eigen gewicht), de combinaties en de verzoeken — zoals
 * de knop Berekenen in de app ze opbouwt: alleen belaste gevallen, en alleen
 * de standaardcombinaties waarin minstens één belast geval meedoet.
 */
function rekenopzet(hal: StaalhalResultaat, reken: StaalhalRekeninstellingen): Rekenopzet {
  // De gelaste tussendoorsneden van een verlopende spantligger (#73) moeten in
  // de winkel staan vóór de verzoeken en de toetsinvoer worden gebouwd.
  if (hal.eigenDoorsneden.length > 0) importeerEigenDoorsneden(hal.eigenDoorsneden);
  const egGeval = eigenGewichtGeval(hal.loadCases, hal.selfWeightEnabled);
  const rekenmodel = egGeval ? withOpenFem3DSelfWeight(hal.model, egGeval.id) : hal.model;
  const belast = new Set<number>([
    ...(rekenmodel.loads ?? []).map(openFem3DLoadCaseId),
    ...(rekenmodel.memberLoads ?? []).map(openFem3DLoadCaseId),
  ]);
  const combinaties = defaultCombinations(hal.loadCases, reken.gevolgklasse)
    .filter((c) => [...belast].some((id) => (c.factors.get(id) ?? 0) !== 0));
  const verzoek = (selectie: number | ReadonlyMap<number, number>) =>
    ({ ...buildOpenFem3DSolveRequest(rekenmodel, reken.analyse, selectie), bucklingModes: 0 });
  const verzoeken: StaalhalRekenverzoek[] = [
    ...hal.loadCases.filter((c) => belast.has(c.id)).map((c) => ({
      sleutel: `geval:${c.id}`, soort: "geval" as const, id: c.id, naam: c.name, verzoek: verzoek(c.id),
    })),
    ...combinaties.map((c) => ({
      sleutel: `combinatie:${c.id}`, soort: "combinatie" as const, id: c.id, naam: c.name, verzoek: verzoek(c.factors),
    })),
  ];
  return { rekenmodel, combinaties, verzoeken };
}

function combinatieNaarJson(c: LoadCombination) {
  return {
    id: c.id, name: c.name, type: c.type, formula: c.formula,
    factors: Object.fromEntries([...c.factors].map(([k, v]) => [String(k), v])),
  };
}

function leesPayloadObject(payload: Record<string, unknown>, veld: string): unknown {
  const waarde = payload[veld];
  if (waarde !== undefined && (typeof waarde !== "object" || waarde === null || Array.isArray(waarde))) {
    throw invoerFout(veld, `\`${veld}\` moet een object zijn.`);
  }
  return waarde ?? {};
}

/**
 * `staalhal_maken`: de hal, het projectbestand en — met `reken` — de
 * rekenverzoeken. Gooit `StaalhalFout` bij invoer die niet deugt.
 */
export function opStaalhalMaken(payload: Record<string, unknown>) {
  eisVelden(payload, MAKEN_VELDEN, "de payload");
  const hal = maakStaalhal(leesPayloadObject(payload, "hal"));
  const reken = leesReken(payload.reken);
  if (payload.stramien !== undefined && typeof payload.stramien !== "boolean") {
    throw invoerFout("stramien", "`stramien` moet true of false zijn.");
  }
  const opzet = reken ? rekenopzet(hal, reken) : null;
  return {
    parameters: hal.parameters,
    project: staalhalProject(hal, {}, { stramien: payload.stramien !== false }),
    samenvatting: hal.samenvatting,
    waarschuwingen: hal.waarschuwingen,
    ...(opzet && reken ? {
      reken,
      combinaties: opzet.combinaties.map(combinatieNaarJson),
      rekenverzoeken: opzet.verzoeken,
    } : {}),
  };
}

type Vector = { fx: number; fy: number; fz: number };
const somVan = (r: OpenFem3DSolveResult): Vector => r.reactions.reduce(
  (t, x) => ({ fx: t.fx + x.fx, fy: t.fy + x.fy, fz: t.fz + x.fz }), { fx: 0, fy: 0, fz: 0 });

function leesResultaat(resultaten: Record<string, unknown>, v: StaalhalRekenverzoek): OpenFem3DSolveResult {
  const r = resultaten[v.sleutel] as OpenFem3DSolveResult | undefined;
  if (!r || typeof r !== "object" || !Array.isArray(r.reactions) || !Array.isArray(r.displacements) || !Array.isArray(r.memberForces)) {
    throw invoerFout(`resultaten.${v.sleutel}`, `Het resultaat \`${v.sleutel}\` (${v.naam}) ontbreekt of is geen 3D-rekenresultaat.`);
  }
  const knopen = new Set(v.verzoek.nodes.map((n) => n.id));
  if (r.displacements.length !== knopen.size || r.displacements.some((d) => !knopen.has(d.nodeId))) {
    throw invoerFout(`resultaten.${v.sleutel}`,
      `Het resultaat \`${v.sleutel}\` hoort niet bij deze hal: de knoopnummers wijken af van het verzoek.`);
  }
  return r;
}

/**
 * `staalhal_uitwerken`: uit de rekenresultaten van Rust de controles per
 * geval en combinatie, en de toetsinvoer voor EN 1993.
 */
export function opStaalhalUitwerken(payload: Record<string, unknown>) {
  eisVelden(payload, UITWERKEN_VELDEN, "de payload");
  const hal = maakStaalhal(leesPayloadObject(payload, "hal"));
  const reken = leesReken(payload.reken ?? {})!;
  const resultaten = leesPayloadObject(payload, "resultaten") as Record<string, unknown>;
  const opzet = rekenopzet(hal, reken);
  const bekend = new Set(opzet.verzoeken.map((v) => v.sleutel));
  const vreemd = Object.keys(resultaten).filter((k) => !bekend.has(k));
  if (vreemd.length > 0) {
    throw invoerFout("resultaten", `Onbekende resultaatsleutels: ${vreemd.join(", ")}; verwacht: ${[...bekend].join(", ")}.`);
  }

  const kolomkoppen = new Set(hal.samenvatting.groepen.kolom
    .map((id) => hal.model.beams.find((b) => b.id === id)!.endNodeId));
  const palen = new Set(hal.samenvatting.paalknopen);
  const controle = (v: StaalhalRekenverzoek, r: OpenFem3DSolveResult) => {
    const reactiesom = somVan(r);
    const balans = openFem3DGlobalForceBalance(v.verzoek, r);
    const gootMm = Math.max(0, ...r.displacements.filter((d) => kolomkoppen.has(d.nodeId))
      .map((d) => Math.hypot(d.ux, d.uy) * 1000));
    const paalFz = r.reactions.filter((x) => palen.has(x.nodeId)).map((x) => x.fz);
    return {
      id: v.id,
      naam: v.naam,
      reactiesomKn: reactiesom,
      // Σ opgebrachte last (met eigen gewicht) = restant van de krachtensom − Σ reacties.
      belastingsomKn: {
        fx: balans.imbalanceKn[0] - reactiesom.fx,
        fy: balans.imbalanceKn[1] - reactiesom.fy,
        fz: balans.imbalanceKn[2] - reactiesom.fz,
      },
      evenwicht: {
        kern: r.equilibrium?.equilibriumOk ?? null,
        onafhankelijk: balans.ok,
        restKrachtKn: balans.maxImbalanceKn,
        restMomentKnm: balans.maxMomentImbalanceKnm,
      },
      maxVerplaatsingMm: openFem3DMaximumDisplacementM(hal.model, r) * 1000,
      maxGootverplaatsingMm: gootMm,
      ...(paalFz.length > 0 ? {
        paalreacties: {
          aantal: paalFz.length,
          somFzKn: paalFz.reduce((t, x) => t + x, 0),
          minFzKn: Math.min(...paalFz),
          maxFzKn: Math.max(...paalFz),
        },
      } : {}),
    };
  };

  const gevallen = [], combinaties = [];
  const combinatieResultaten = new Map<number, OpenFem3DSolveResult>();
  let basis: OpenFem3DSolveResult | null = null;
  for (const v of opzet.verzoeken) {
    const r = leesResultaat(resultaten, v);
    if (v.soort === "geval") {
      gevallen.push(controle(v, r));
      basis ??= r;
    } else {
      const c = opzet.combinaties.find((x) => x.id === v.id)!;
      combinaties.push({ ...controle(v, r), type: c.type, formule: c.formula });
      combinatieResultaten.set(v.id, r);
    }
  }
  if (!basis) throw invoerFout("resultaten", "Er is geen enkel belast geval om uit te werken.");
  const toets = buildOpenFem3DSteelCheckInputs(hal.model, basis, {
    combinations: opzet.combinaties, results: combinatieResultaten, loadCases: hal.loadCases,
    consequenceClass: reken.gevolgklasse,
  });
  const houtToets = buildOpenFem3DTimberCheckInputs(hal.model, basis, {
    combinations: opzet.combinaties, results: combinatieResultaten, loadCases: hal.loadCases,
    consequenceClass: reken.gevolgklasse,
  });
  return {
    reken,
    gevallen,
    combinaties,
    toetsinvoer: toets.inputs,
    nietGetoetst: toets.skipped,
    notities: toets.notes,
    houtToetsinvoer: houtToets.inputs,
    houtNietGetoetst: houtToets.skipped,
    houtNotities: houtToets.notes,
    // Ter vergelijking, niet als oordeel: L/250 over de overspanning, h/150 op de goot.
    grenzen: {
      doorbuigingMm: hal.parameters.breedteMm / 250,
      zijverplaatsingMm: hal.parameters.goothoogteMm / 150,
    },
  };
}

/**
 * bediening.ts — de pagina-kant van het bedieningskanaal.
 *
 * Rust (`gui_control.rs`) zet opdrachten als event `gui-control:opdracht` op
 * het hoofdvenster; deze module voert ze uit met de acties die App.tsx al
 * heeft — dezelfde closures die de knoppen en het canvas gebruiken — en meldt
 * de uitkomst terug via het command `gui_control_antwoord`. Er wordt niets
 * nagebouwd: `toetsen` ís `handleRunMemberChecks`, `korf_zetten` ís
 * `updateBeam`.
 *
 * KLAAR BETEKENT KLAAR. Elke actie komt pas terug als de app in de nieuwe
 * toestand STAAT. Voor de zustand-stores (toetsing, dekkingslijn) gebeurt dat
 * met `wachtOpStore` — een abonnement dat oplost bij de eerste toestand die
 * voldoet. Voor de raamwerkstore, die op React-state draait en niets te
 * abonneren heeft, gebeurt het met `verseRender`: een eigen tik die altijd
 * een commit oplevert, en de hook lost hem op na die commit. Geen timers,
 * geen "even wachten".
 *
 * NOOIT KAAL OP DE VOLGENDE RENDER WACHTEN NA EEN ACTIE. Een opdracht die
 * niets verandert — de weergave zetten naar de weergave die al actief is,
 * dezelfde staaf opnieuw selecteren, hetzelfde analysetype — levert in React
 * geen commit op (gelijke state wordt overgeslagen). Wie dan op "de
 * eerstvolgende render" wacht, wacht tot de time-out van Rust (30 s) en
 * krijgt een fout terwijl er niets mis is (issue #28). Daarom wacht elke
 * actie hieronder op `verseRender`, nooit op `wachtOpRender`.
 *
 * FOUTEN REIZEN MEE. Wat de app zelf zou melden — een korf die
 * `controleerKorf` weigert, toetsen zonder model — gaat letterlijk terug als
 * `fout`. Hier wordt niets vertaald en niets verzonnen.
 *
 * In een gewone sessie doet deze module niets: de hook vraagt Rust eenmalig
 * `gui_control_actief` en luistert alleen als dat waar is.
 */
import { useEffect, useRef, useState } from "react";
import { useCheckStore } from "../stores/checkStore";
import { useDekkingslijnStore } from "../stores/dekkingslijnStore";
import { useReportStore } from "../stores/reportStore";
import { leesRapportKopOverschrijving } from "../components/report/useProjectInfo";
import { leesPagineerToestand } from "../components/report/rapportGereedheid";
import { tocToestand } from "../components/report/toc";
import type { Beam, Selection, SupportType, Load, Analysetype, StructuralGrid } from "../components/fem/femTypes";
import {
  FRAME3D_SUPPORT_PRESETS,
  parseFrame3DModel,
  splitFrame3DBeam,
  type Frame3DModel,
} from "../components/frame3d/frame3dModel";
import type { Frame3DVisibility } from "../components/frame3d/frame3dVisibility";
import type { Frame3DView } from "../components/frame3d/frame3dCommands";
import type { Frame3DSolveResult } from "../components/frame3d/frame3dSolver";
import type { Frame3DSteelChecks } from "../components/frame3d/frame3dSteelCheck";
import type { Frame3DConcreteChecks } from "../components/frame3d/frame3dConcreteCheck";
import type { Frame3DSelection } from "../components/frame3d/frame3dSelection";
import { frame3DMaximumDisplacementM } from "../components/frame3d/frame3dDisplacement";
import type { SolverResult } from "../components/fem/solver/types";
import type { ReinforcementCage } from "../lib/types/concrete/ReinforcementCage";
import { isEigenGewichtGeval } from "../lib/eigenGewicht";
import {
  lopendeExportId,
  rapportAfronden,
  rapportVoorbereiden,
  wachtOpRekenrust,
} from "./rapportExport";

const EVENT_OPDRACHT = "gui-control:opdracht";

/** Wat één rekengang (App.tsx `rekenDoor`) opleverde. */
export interface RekengangUitkomst {
  gelukt: boolean;
  /**
   * Wat de fysisch niet-lineaire ronde deed: `nvt` (ander analysetype),
   * `gedraaid`, `niets-te-doen` (geen betonstaaf met korf) of `mislukt`.
   */
  fysisch: "nvt" | "gedraaid" | "niets-te-doen" | "mislukt" | "verouderd";
}

/** De rekentoestand die in refs van App.tsx leeft — niet in de render. */
export interface RekenToestand {
  /** Staat er na een modelwijziging een automatische herberekening gepland? */
  herberekeningGepland: boolean;
  /** Aantal rekengangen dat nog loopt (tot en met de toetsing). */
  lopendeRekengangen: number;
  /** Hoogt op bij elke modelwijziging en elke rekengang. */
  generatie: number;
  /** De combinatieresultaten van de laatste VOLTOOIDE rekengang, of null. */
  volledigeRekengang: Map<number, SolverResult> | null;
}

/** Wat App.tsx aan de bediening geeft. Allemaal bestaande closures. */
export interface BedieningActies {
  /** De raamwerkstore van deze render. */
  fem: {
    nodes: readonly { id: number; x: number; z: number }[];
    beams: readonly Beam[];
    /** Platen: tellen mee bij "is er iets te toetsen" (plaattoets). */
    plates?: readonly { materiaal?: string }[];
    loads: readonly Load[];
    loadCases: readonly { id: number; name: string; type?: string; eigenGewicht?: true }[];
    /** Staat het automatische eigen gewicht aan? (issue #42) */
    selfWeightEnabled?: boolean;
    combinations: readonly { id: number; name: string }[];
    combinationResults: Map<number, SolverResult> | null;
    analysetype: Analysetype;
    addNode: (x: number, z: number) => number;
    addBeam: (fromId: number, toId: number) => number | null;
    updateBeam: (id: number, updates: Partial<Beam>) => void;
    addSupport: (nodeId: number, type: SupportType, k?: number) => void;
    addLoad: (l: Omit<Load, "id">) => void;
    addLoadCase: (name: string) => void;
    setAnalysetype: (v: Analysetype) => void;
  };
  modelDimension: "2d" | "3d";
  frame3d: {
    model: Frame3DModel;
    visibility: Frame3DVisibility;
    structuralGrid: StructuralGrid;
    replaceModel: (model: Frame3DModel) => void;
    setVisibility: (visibility: Frame3DVisibility) => void;
    setStructuralGrid: (grid: StructuralGrid) => void;
    setView: (view: Frame3DView) => void;
    setSelection: (selection: Frame3DSelection) => void;
    selectCombination: (id: number) => void;
    updateBeam: (id: number, updates: Partial<Frame3DModel["beams"][number]>) => void;
    solve: () => Promise<void>;
    result: Frame3DSolveResult | null;
    caseResults: ReadonlyMap<number, Frame3DSolveResult>;
    combinationResults: ReadonlyMap<number, Frame3DSolveResult>;
    activeCombinationId: number | null;
    solveError: string | null;
    checks: Frame3DSteelChecks | null;
    concreteChecks: Frame3DConcreteChecks | null;
    /** Hoogt op bij iedere 3D-modelwijziging en iedere 3D-rekengang. */
    generation: () => number;
    solving: boolean;
    checksRunning: boolean;
    checksError: string | null;
  };
  activeView: string;
  selection: Selection;
  setSelection: (s: Selection) => void;
  setActiveView: (v: string) => void;
  setBottomPanelOpen: (v: boolean) => void;
  handleRunMemberChecks: (opts?: { openPanel?: boolean }) => Promise<void>;
  /**
   * De rekengang van de knop Berekenen — `rekenDoor` in App.tsx, met de
   * fysisch niet-lineaire ronde en de toetsing erachteraan — als belofte die
   * pas inlost als ALLES klaar is. Vroeger riep `rekenen` hier alleen
   * `computeAndStoreSolverOutputs` aan: zonder die ronde en zonder toetsing,
   * zodat een rapport via het kanaal bij tweedeOrdeFysisch op P-Δ-krachten
   * stond waar de knop de gescheurde verdeling gaf.
   */
  rekenDoor: () => Promise<RekengangUitkomst>;
  /** De rekentoestand uit de refs van App.tsx (gepland, lopend, generatie). */
  rekenToestand: () => RekenToestand;
  /**
   * De reden dat de laatste rekengang mislukte, of null. Zonder dit veld gaf
   * "rekenen" altijd "controleer het model (opleggingen, belastingen)" terug,
   * ook bij een onbekende doorsnede of een kolom die knikt.
   */
  laatsteRekenfout: () => string | null;
  createDetachedWindow: (opts: { view: string; title: string; width?: number; height?: number }) => Promise<string>;
  /** Het pad van "Openen…": tekst → project in de store, mét bibliotheken. */
  laadProjectTekst: (tekst: string, pad?: string) => Promise<void>;
}

interface Opdracht {
  id: number;
  naam: string;
  args: Record<string, unknown>;
}

// ── Wachten ─────────────────────────────────────────────────────────────────

/** Lost op bij de eerste store-toestand die voldoet; anders een fout na `ms`. */
function wachtOpStore<S>(
  store: { getState: () => S; subscribe: (l: (s: S) => void) => () => void },
  voldoet: (s: S) => boolean,
  ms: number,
  wat: string,
): Promise<S> {
  return new Promise((los, weiger) => {
    const nu = store.getState();
    if (voldoet(nu)) { los(nu); return; }
    const timer = window.setTimeout(() => {
      af();
      weiger(new Error(`wachten op ${wat} verliep na ${Math.round(ms / 1000)} s`));
    }, ms);
    const af = store.subscribe((s) => {
      if (voldoet(s)) { window.clearTimeout(timer); af(); los(s); }
    });
  });
}

/**
 * `handleSolve` wacht zelf al op solver én normtoetsen. React kan de laatste
 * statusupdates echter over twee commits verdelen, waardoor het eerste
 * API-antwoord soms nog de vorige `checksRunning=true`-render bevatte. Forceer
 * enkele verse commits en antwoord pas vanuit de aantoonbaar rustige render.
 */
async function wachtOpFrame3DRender(
  acties: () => BedieningActies,
  verseRender: () => Promise<void>,
): Promise<void> {
  for (let poging = 0; poging < 8; poging += 1) {
    await verseRender();
    const state = acties().frame3d;
    if (!state.solving && !state.checksRunning) return;
  }
  throw new Error("de 3D-rekengang is afgerond, maar de gebruikersinterface meldt nog steeds dat de toetsing loopt");
}

// ── De hook ─────────────────────────────────────────────────────────────────

/**
 * Installeer de bediening. Geeft terug of het kanaal aanstaat, zodat de
 * statusbalk het kan tonen.
 */
export function useBediening(acties: BedieningActies): boolean {
  const [actief, setActief] = useState(false);
  const actiesRef = useRef(acties);
  actiesRef.current = acties;

  // `wachtOpRender`: beloftes die na de eerstvolgende commit worden ingelost.
  const wachtenden = useRef<Array<() => void>>([]);
  useEffect(() => {
    const w = wachtenden.current;
    wachtenden.current = [];
    for (const los of w) los();
  });
  const wachtOpRender = () =>
    new Promise<void>((los) => { wachtenden.current.push(los); });
  // `verseRender`: forceer een commit en wacht erop. Nodig na een ASYNCHRONE
  // actie (een rekengang met toetsing): de commits die daarbij hoorden kunnen
  // al voorbij zijn, en dan zou `wachtOpRender` op een render wachten die
  // nooit komt. Evengoed na een actie die niets verandert (#28): React slaat
  // gelijke state over en commit dan niet. Met een eigen tik komt er altijd
  // één, en daarna staat de laatste modelstate gegarandeerd in `actiesRef`.
  const [, setTik] = useState(0);
  const verseRender = () => {
    const p = wachtOpRender();
    setTik((n) => n + 1);
    return p;
  };

  useEffect(() => {
    let af: (() => void) | null = null;
    let gestopt = false;
    (async () => {
      let aan = false;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        aan = await invoke<boolean>("gui_control_actief");
      } catch {
        aan = false; // geen Tauri, of een oudere app zonder het command
      }
      if (!aan || gestopt) return;
      setActief(true);
      const { listen } = await import("@tauri-apps/api/event");
      const { invoke } = await import("@tauri-apps/api/core");
      af = await listen<Opdracht>(EVENT_OPDRACHT, async (e) => {
        const { id, naam, args } = e.payload;
        let antwoord: { ok: true; uitkomst: unknown } | { ok: false; fout: string };
        try {
          const uitkomst = await voerUit(naam, args ?? {}, actiesRef, wachtOpRender, verseRender);
          antwoord = { ok: true, uitkomst };
        } catch (err) {
          antwoord = { ok: false, fout: err instanceof Error ? err.message : String(err) };
        }
        try {
          await invoke("gui_control_antwoord", { id, uitkomst: antwoord });
        } catch (err) {
          console.error("[bediening] antwoord niet afgeleverd:", err);
        }
      });
    })();
    return () => { gestopt = true; af?.(); };
  }, []);

  return actief;
}

// ── De acties ───────────────────────────────────────────────────────────────

/**
 * Voer één opdracht uit. Geëxporteerd voor test-bediening-wachten.mjs, dat
 * zonder app nagaat dat geen actie op een render wacht die niet komt.
 * `wachtOpRender` gaat alleen door naar `rapportVoorbereiden`, dat hem pas
 * gebruikt nadat het de weergave aantoonbaar heeft gewisseld.
 */
export async function voerUit(
  naam: string,
  args: Record<string, unknown>,
  ref: { current: BedieningActies },
  wachtOpRender: () => Promise<void>,
  verseRender: () => Promise<void>,
): Promise<unknown> {
  const a = () => ref.current;
  const getal = (k: string): number => {
    const v = args[k];
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`\`${k}\` ontbreekt of is geen getal`);
    return v;
  };
  const staaf = (id: number): Beam => {
    const b = a().fem.beams.find((x) => x.id === id);
    if (!b) throw new Error(`geen staaf met id ${id}`);
    return b;
  };

  switch (naam) {
    case "status": {
      const f = a().fem;
      return {
        frontendDevMode: import.meta.env.DEV,
        frontendModuleUrl: import.meta.url,
        weergave: a().activeView,
        selectie: a().selection,
        aantalKnopen: f.nodes.length,
        aantalStaven: f.beams.length,
        aantalLasten: f.loads.length,
        analysetype: f.analysetype,
        toetsingLoopt: useCheckStore.getState().isRunning,
        rekentoestand: (() => {
          const r = a().rekenToestand();
          return {
            herberekeningGepland: r.herberekeningGepland,
            lopendeRekengangen: r.lopendeRekengangen,
            generatie: r.generatie,
          };
        })(),
        // De rapportinstellingen zoals ze NU staan — zo is na een export te
        // controleren dat type, papier en kop zijn teruggezet.
        rapport: (() => {
          const s = useReportStore.getState();
          return {
            type: s.rapportType,
            formaat: s.pageSize,
            orientatie: s.orientation,
            kopOverschreven: leesRapportKopOverschrijving() !== null,
            lopendeExport: lopendeExportId(),
            // De toestand achter het klaar-signaal van de export: zo is van
            // buiten te zien waarom een export (nog) wacht.
            paginering: leesPagineerToestand(),
            inhoudsopgave: tocToestand(),
          };
        })(),
        // Genoeg om een staaf te kiezen zonder het hele model op te vragen:
        // materiaal en profiel zeggen wat het is, `heeftKorf` of hij al
        // wapening draagt.
        staven: f.beams.map((b) => ({
          id: b.id,
          material: b.material ?? null,
          profileName: (b as { profileName?: string }).profileName ?? null,
          heeftKorf: b.checkConfig?.betonKorf != null,
        })),
        modelDimension: a().modelDimension,
        model3d: {
          aantalKnopen: a().frame3d.model.nodes.length,
          aantalStaven: a().frame3d.model.beams.length,
          aantalPlaten: a().frame3d.model.plates?.length ?? 0,
          aantalOpleggingen: a().frame3d.model.supports?.length ?? 0,
          aantalLasten: (a().frame3d.model.loads?.length ?? 0) + (a().frame3d.model.memberLoads?.length ?? 0) +
            (a().frame3d.model.memberPointLoads?.length ?? 0) + (a().frame3d.model.thermalLoads?.length ?? 0) +
            (a().frame3d.model.surfaceLoads?.length ?? 0) +
            (a().frame3d.model.supports ?? []).filter((support) => Object.keys(support.prescribed ?? {}).length > 0).length,
          aantalOpgelegdeVerplaatsingen: (a().frame3d.model.supports ?? []).reduce((count, support) =>
            count + Object.keys(support.prescribed ?? {}).length, 0),
          generatie: a().frame3d.generation(),
          heeftResultaat: a().frame3d.result !== null,
          rekenfout: a().frame3d.solveError,
          zichtbaarheid: a().frame3d.visibility,
          stramien: a().frame3d.structuralGrid,
        },
      };
    }

    case "model_laden": {
      const tekst = args.tekst;
      if (typeof tekst !== "string") throw new Error("`tekst` ontbreekt");
      await a().laadProjectTekst(tekst, typeof args.pad === "string" ? args.pad : undefined);
      await verseRender();
      const f = a().fem;
      return { aantalKnopen: f.nodes.length, aantalStaven: f.beams.length, aantalLasten: f.loads.length };
    }

    case "model_bouwen": {
      const f = a().fem;
      // Een last in het geval "Eigen gewicht" weigert de store (`addLoad`)
      // met alleen een melding in de app; de client zou dan een model zonder
      // die last terugkrijgen zonder het te weten. Daarom hier VOORAF, vóór er
      // iets gebouwd is, met reden (issue #42).
      for (const l of (args.loads as Array<Omit<Load, "id">> | undefined) ?? []) {
        if (isEigenGewichtGeval(f.loadCases.find((c) => c.id === l.caseId))) {
          throw new Error(
            `last in belastinggeval ${l.caseId}: dat geval draagt het automatische eigen gewicht ` +
            "(eigenGewicht) en wordt uit profiel, materiaal en geometrie gevuld; er kan geen last in. " +
            "Zet de last in een ander blijvend geval, bijvoorbeeld \"Permanent (G)\" (id 1).");
        }
      }
      const knopen = (args.nodes as Array<{ x: number; z: number }> | undefined) ?? [];
      const nodeIds = knopen.map((n) => f.addNode(n.x, n.z));
      const staven = (args.beams as Array<{ from: number; to: number; updates?: Partial<Beam> }> | undefined) ?? [];
      const beamIds: Array<number | null> = [];
      for (const s of staven) {
        const van = nodeIds[s.from - 1], naar = nodeIds[s.to - 1];
        if (van === undefined || naar === undefined) throw new Error(`staaf ${s.from}→${s.to}: knoopindex buiten bereik`);
        const id = f.addBeam(van, naar);
        if (id != null && s.updates) f.updateBeam(id, s.updates);
        beamIds.push(id);
      }
      for (const s of (args.supports as Array<{ node: number; type: SupportType; k?: number }> | undefined) ?? []) {
        const nid = nodeIds[s.node - 1];
        if (nid === undefined) throw new Error(`oplegging op knoop ${s.node}: buiten bereik`);
        f.addSupport(nid, s.type, s.k);
      }
      for (const naam of (args.load_cases as string[] | undefined) ?? []) f.addLoadCase(naam);
      for (const l of (args.loads as Array<Omit<Load, "id">> | undefined) ?? []) f.addLoad(l);
      await verseRender();
      // De belastinggevallen ZOALS ZE NU IN DE APP STAAN gaan mee terug: een
      // nieuw project opent met het geval "Eigen gewicht" (kenmerk
      // `eigenGewicht`, automatisch gevuld, neemt geen lasten aan), en een
      // client moet de id's kennen om zijn lasten in het juiste geval te
      // zetten — "Permanent (G)" is id 1, niet het eerste geval in de lijst.
      const na = a().fem;
      return {
        nodeIds, beamIds,
        loadCases: na.loadCases.map((c) => ({
          id: c.id, name: c.name, type: c.type ?? null,
          ...(c.eigenGewicht === true ? { eigenGewicht: true } : {}),
        })),
        selfWeightEnabled: na.selfWeightEnabled ?? null,
      };
    }

    case "model_3d_bouwen": {
      const rawNodes = Array.isArray(args.nodes) ? args.nodes : [];
      const rawBeams = Array.isArray(args.beams) ? args.beams : [];
      const rawSupports = Array.isArray(args.supports) ? args.supports : [];
      const rawLoads = Array.isArray(args.loads) ? args.loads : [];
      const rawMemberLoads = Array.isArray(args.member_loads) ? args.member_loads : [];
      const rawMemberPointLoads = Array.isArray(args.member_point_loads) ? args.member_point_loads : [];
      const rawThermalLoads = Array.isArray(args.thermal_loads) ? args.thermal_loads : [];
      const rawPlates = Array.isArray(args.plates) ? args.plates : [];
      const rawSurfaceLoads = Array.isArray(args.surface_loads) ? args.surface_loads : [];
      const nodes = rawNodes.map((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`3D-knoop ${index + 1} is ongeldig`);
        const node = value as Record<string, unknown>;
        return { id: index + 1, x: node.x, y: node.y, z: node.z };
      });
      const beams = rawBeams.map((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`3D-staaf ${index + 1} is ongeldig`);
        const beam = value as Record<string, unknown>;
        if (!Number.isSafeInteger(beam.from) || !Number.isSafeInteger(beam.to)) {
          throw new Error(`3D-staaf ${index + 1}: from/to moeten knoopindices zijn`);
        }
        return {
          id: index + 1,
          startNodeId: Number(beam.from),
          endNodeId: Number(beam.to),
          ...(typeof beam.profile_name === "string" ? { profileName: beam.profile_name } : {}),
          ...(typeof beam.material === "string" ? { material: beam.material } : {}),
          ...(beam.roll_angle_deg !== undefined
            ? { rollAngleRad: typeof beam.roll_angle_deg === "number" ? beam.roll_angle_deg * Math.PI / 180 : beam.roll_angle_deg }
            : {}),
          ...(beam.releases && typeof beam.releases === "object" && !Array.isArray(beam.releases)
            ? { releases: {
                myStart: (beam.releases as Record<string, unknown>).my_start,
                myEnd: (beam.releases as Record<string, unknown>).my_end,
                mzStart: (beam.releases as Record<string, unknown>).mz_start,
                mzEnd: (beam.releases as Record<string, unknown>).mz_end,
                torsionStart: (beam.releases as Record<string, unknown>).torsion_start,
                torsionEnd: (beam.releases as Record<string, unknown>).torsion_end,
              } }
            : beam.releases === undefined ? {} : { releases: beam.releases }),
          ...(beam.check_config && typeof beam.check_config === "object" && !Array.isArray(beam.check_config)
            ? { checkConfig: beam.check_config }
            : {}),
        };
      });
      const supports = rawSupports.map((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`3D-oplegging ${index + 1} is ongeldig`);
        const support = value as Record<string, unknown>;
        const preset = support.type;
        if ((preset !== undefined && (typeof preset !== "string" || !(preset in FRAME3D_SUPPORT_PRESETS))) ||
            !Number.isSafeInteger(support.node)) {
          throw new Error(`3D-oplegging ${index + 1}: gebruik node en optioneel type ${Object.keys(FRAME3D_SUPPORT_PRESETS).join(", ")}`);
        }
        const rawSprings = support.springs;
        if (rawSprings !== undefined && (!rawSprings || typeof rawSprings !== "object" || Array.isArray(rawSprings))) {
          throw new Error(`3D-oplegging ${index + 1}: springs moet een object zijn`);
        }
        const springs = rawSprings as Record<string, unknown> | undefined;
        const rawPrescribed = support.prescribed;
        if (rawPrescribed !== undefined && (!rawPrescribed || typeof rawPrescribed !== "object" || Array.isArray(rawPrescribed))) {
          throw new Error(`3D-oplegging ${index + 1}: prescribed moet een object zijn`);
        }
        const prescribed = rawPrescribed as Record<string, unknown> | undefined;
        return {
          nodeId: Number(support.node),
          ...(preset === undefined
            ? { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false }
            : FRAME3D_SUPPORT_PRESETS[preset as keyof typeof FRAME3D_SUPPORT_PRESETS]),
          ...(springs ? { springs: {
            ...(springs.kx_kn_per_m !== undefined ? { kxKnPerM: springs.kx_kn_per_m } : {}),
            ...(springs.ky_kn_per_m !== undefined ? { kyKnPerM: springs.ky_kn_per_m } : {}),
            ...(springs.kz_kn_per_m !== undefined ? { kzKnPerM: springs.kz_kn_per_m } : {}),
            ...(springs.krx_knm_per_rad !== undefined ? { krxKnmPerRad: springs.krx_knm_per_rad } : {}),
            ...(springs.kry_knm_per_rad !== undefined ? { kryKnmPerRad: springs.kry_knm_per_rad } : {}),
            ...(springs.krz_knm_per_rad !== undefined ? { krzKnmPerRad: springs.krz_knm_per_rad } : {}),
          } } : {}),
          ...(prescribed ? { prescribed: {
            ...(prescribed.ux_m !== undefined ? { uxM: prescribed.ux_m } : {}),
            ...(prescribed.uy_m !== undefined ? { uyM: prescribed.uy_m } : {}),
            ...(prescribed.uz_m !== undefined ? { uzM: prescribed.uz_m } : {}),
            ...(prescribed.rx_rad !== undefined ? { rxRad: prescribed.rx_rad } : {}),
            ...(prescribed.ry_rad !== undefined ? { ryRad: prescribed.ry_rad } : {}),
            ...(prescribed.rz_rad !== undefined ? { rzRad: prescribed.rz_rad } : {}),
          } } : {}),
        };
      });
      const loads = rawLoads.map((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`3D-knoopbelasting ${index + 1} is ongeldig`);
        const load = value as Record<string, unknown>;
        return {
          id: index + 1,
          nodeId: load.node,
          ...(load.case_id !== undefined ? { caseId: load.case_id } : {}),
          fx: load.fx ?? 0, fy: load.fy ?? 0, fz: load.fz ?? 0,
          mx: load.mx ?? 0, my: load.my ?? 0, mz: load.mz ?? 0,
        };
      });
      const memberLoads = rawMemberLoads.map((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`3D-staafbelasting ${index + 1} is ongeldig`);
        const load = value as Record<string, unknown>;
        const beamId = Number(load.beam);
        if (!Number.isSafeInteger(load.beam) || !beams.some((beam) => beam.id === beamId)) {
          throw new Error(`3D-staafbelasting ${index + 1}: beam verwijst niet naar een bestaande staaf`);
        }
        const beam = beams.find((item) => item.id === beamId)!;
        const start = nodes.find((node) => node.id === beam.startNodeId)!;
        const end = nodes.find((node) => node.id === beam.endNodeId)!;
        const length = Math.hypot(Number(end.x) - Number(start.x), Number(end.y) - Number(start.y), Number(end.z) - Number(start.z));
        return {
          id: index + 1,
          beamId,
          ...(load.case_id !== undefined ? { caseId: load.case_id } : {}),
          qyStart: load.qy_start ?? 0,
          qyEnd: load.qy_end ?? load.qy_start ?? 0,
          qzStart: load.qz_start ?? 0,
          qzEnd: load.qz_end ?? load.qz_start ?? 0,
          startPositionM: load.start_m ?? 0,
          endPositionM: load.end_m ?? length,
        };
      });
      const memberPointLoads = rawMemberPointLoads.map((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`3D-staafpuntlast ${index + 1} is ongeldig`);
        const load = value as Record<string, unknown>;
        const beamId = Number(load.beam);
        if (!Number.isSafeInteger(load.beam) || !beams.some((beam) => beam.id === beamId)) {
          throw new Error(`3D-staafpuntlast ${index + 1}: beam verwijst niet naar een bestaande staaf`);
        }
        return {
          id: index + 1,
          beamId,
          ...(load.case_id !== undefined ? { caseId: load.case_id } : {}),
          py: load.py ?? 0,
          pz: load.pz ?? 0,
          positionM: load.position_m,
        };
      });
      const thermalLoads = rawThermalLoads.map((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`3D-temperatuurbelasting ${index + 1} is ongeldig`);
        const load = value as Record<string, unknown>;
        const beamId = Number(load.beam);
        if (!Number.isSafeInteger(load.beam) || !beams.some((beam) => beam.id === beamId)) {
          throw new Error(`3D-temperatuurbelasting ${index + 1}: beam verwijst niet naar een bestaande staaf`);
        }
        return {
          id: index + 1,
          beamId,
          ...(load.case_id !== undefined ? { caseId: load.case_id } : {}),
          deltaTUniformK: load.delta_t_uniform_k ?? 0,
          deltaTGradientYK: load.delta_t_gradient_y_k ?? 0,
          deltaTGradientZK: load.delta_t_gradient_z_k ?? 0,
        };
      });
      const plates = rawPlates.map((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`3D-plaat ${index + 1} is ongeldig`);
        const plate = value as Record<string, unknown>;
        if (!Array.isArray(plate.nodes)) throw new Error(`3D-plaat ${index + 1}: nodes moet een lijst met knoopindices zijn`);
        const openings = Array.isArray(plate.openings) ? plate.openings.map((rawOpening, openingIndex) => {
          if (!rawOpening || typeof rawOpening !== "object" || Array.isArray(rawOpening)) throw new Error(`Opening ${openingIndex + 1} van 3D-plaat ${index + 1} is ongeldig`);
          const opening = rawOpening as Record<string, unknown>;
          return { id: openingIndex + 1, nodeIds: opening.nodes,
            ...(opening.corner_radius_m !== undefined ? { cornerRadiusM: opening.corner_radius_m } : {}) };
        }) : plate.openings;
        return { id: index + 1, nodeIds: plate.nodes, thicknessM: plate.thickness_m ?? 0.2,
          ...(typeof plate.material === "string" ? { material: plate.material } : {}),
          ...(plate.corner_radius_m !== undefined ? { cornerRadiusM: plate.corner_radius_m } : {}),
          ...(openings !== undefined ? { openings } : {}) };
      });
      const surfaceLoads = rawSurfaceLoads.map((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`3D-oppervlaktebelasting ${index + 1} is ongeldig`);
        const load = value as Record<string, unknown>;
        return { id: index + 1, plateId: load.plate,
          ...(load.case_id !== undefined ? { caseId: load.case_id } : {}),
          qx: load.qx ?? 0, qy: load.qy ?? 0, qz: load.qz ?? 0 };
      });
      const model = parseFrame3DModel({ nodes, beams, plates, supports, loads, memberLoads, memberPointLoads, thermalLoads, surfaceLoads });
      a().frame3d.replaceModel(model);
      await verseRender();
      return {
        modelDimension: a().modelDimension,
        nodeIds: model.nodes.map((node) => node.id),
        plateIds: (model.plates ?? []).map((plate) => plate.id),
        beamIds: model.beams.map((beam) => beam.id),
        aantalOpleggingen: model.supports?.length ?? 0,
        aantalOplegveren: (model.supports ?? []).reduce((count, support) => count + Object.keys(support.springs ?? {}).length, 0),
        aantalOpgelegdeVerplaatsingen: (model.supports ?? []).reduce((count, support) => count + Object.keys(support.prescribed ?? {}).length, 0),
        aantalLasten: model.loads?.length ?? 0,
        aantalStaaflasten: model.memberLoads?.length ?? 0,
        aantalStaafpuntlasten: model.memberPointLoads?.length ?? 0,
        aantalTemperatuurlasten: model.thermalLoads?.length ?? 0,
        aantalOppervlaktelasten: model.surfaceLoads?.length ?? 0,
      };
    }

    case "weergave_3d_configureren": {
      if (a().modelDimension !== "3d") throw new Error("de actieve projectdimensie is 2D; bouw of converteer eerst een 3D-model");
      if (args.visibility !== undefined) {
        if (!args.visibility || typeof args.visibility !== "object" || Array.isArray(args.visibility)) {
          throw new Error("`visibility` moet een object zijn");
        }
        const current = a().frame3d.visibility;
        const next = { ...current };
        for (const [key, value] of Object.entries(args.visibility as Record<string, unknown>)) {
          if (key === "supportScale") {
            if (typeof value !== "number" || !Number.isFinite(value) || value < 0.25 || value > 3)
              throw new Error("ongeldige 3D-opleggingsgrootte; kies 0,25 t/m 3");
            next.supportScale = value;
          } else {
            if (!(key in current) || typeof value !== "boolean") throw new Error(`ongeldige 3D-zichtbaarheidsoptie ${key}`);
            next[key as keyof Omit<Frame3DVisibility, "supportScale">] = value;
          }
        }
        a().frame3d.setVisibility(next);
      }
      if (args.structural_grid !== undefined) {
        if (!args.structural_grid || typeof args.structural_grid !== "object" || Array.isArray(args.structural_grid)) {
          throw new Error("`structural_grid` moet een object zijn");
        }
        const raw = args.structural_grid as Record<string, unknown>;
        const axisList = (key: string, prefix: string) => {
          const value = raw[key];
          if (value === undefined) return undefined;
          if (!Array.isArray(value)) throw new Error(`structural_grid.${key} moet een lijst zijn`);
          return value.map((axis, index) => {
            if (!axis || typeof axis !== "object" || Array.isArray(axis)) throw new Error(`structural_grid.${key}[${index}] is ongeldig`);
            const item = axis as Record<string, unknown>;
            if (typeof item.label !== "string" || typeof item.position_m !== "number" || !Number.isFinite(item.position_m)) {
              throw new Error(`structural_grid.${key}[${index}] vereist label en position_m`);
            }
            return { id: `${prefix}-${index + 1}`, label: item.label, position: item.position_m * 1000 };
          });
        };
        if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") throw new Error("structural_grid.enabled moet boolean zijn");
        const current = a().frame3d.structuralGrid;
        a().frame3d.setStructuralGrid({
          ...current,
          ...(raw.enabled === undefined ? {} : { enabled: raw.enabled }),
          ...(axisList("x_axes", "x") ? { xAxes: axisList("x_axes", "x")! } : {}),
          ...(axisList("y_axes", "y") ? { yAxes: axisList("y_axes", "y")! } : {}),
          ...(axisList("z_levels", "z") ? { zAxes: axisList("z_levels", "z")! } : {}),
        });
      }
      if (args.view !== undefined) {
        if (args.view !== "iso" && args.view !== "top" && args.view !== "front" && args.view !== "side") {
          throw new Error("`view` moet iso, top, front of side zijn");
        }
        a().frame3d.setView(args.view);
      }
      await verseRender();
      return { zichtbaarheid: a().frame3d.visibility, stramien: a().frame3d.structuralGrid, view: args.view ?? null };
    }

    case "resultaat_3d_kiezen": {
      if (a().modelDimension !== "3d") throw new Error("de actieve projectdimensie is 2D");
      const id = getal("id");
      if (!a().frame3d.combinationResults.has(id)) {
        throw new Error(`3D-combinatie ${id} heeft geen berekend resultaat; voer eerst rekenen uit`);
      }
      a().frame3d.selectCombination(id);
      await verseRender();
      return frame3dUitlezen(a());
    }

    case "staaf_selecteren": {
      const id = getal("id");
      if (a().modelDimension === "3d") {
        const beam = a().frame3d.model.beams.find((candidate) => candidate.id === id);
        if (!beam) throw new Error(`3D-staaf ${id} bestaat niet`);
        a().frame3d.setSelection({ type: "beam", id });
        a().setActiveView("frame3d");
        await verseRender();
        return beam;
      }
      staaf(id);
      a().setSelection({ type: "beam", id });
      await verseRender();
      return staaf(id);
    }

    case "plaat_3d_selecteren": {
      if (a().modelDimension !== "3d") throw new Error("de actieve projectdimensie is 2D");
      const id = getal("id");
      const plate = (a().frame3d.model.plates ?? []).find((candidate) => candidate.id === id);
      if (!plate) throw new Error(`3D-plaat ${id} bestaat niet`);
      a().frame3d.setSelection({ type: "plate", id });
      a().setActiveView("frame3d");
      await verseRender();
      return plate;
    }

    case "staaf_3d_splitsen": {
      if (a().modelDimension !== "3d") throw new Error("de actieve projectdimensie is 2D; bouw of converteer eerst een 3D-model");
      const beamId = getal("beamId");
      const ratio = getal("ratio");
      const split = splitFrame3DBeam(a().frame3d.model, beamId, ratio);
      a().frame3d.replaceModel(split.model);
      a().frame3d.setSelection({ type: "node", id: split.nodeId });
      a().setActiveView("frame3d");
      await verseRender();
      return {
        nodeId: split.nodeId,
        firstBeamId: split.firstBeamId,
        secondBeamId: split.secondBeamId,
        nodes: split.model.nodes,
        beams: split.model.beams,
        memberLoads: split.model.memberLoads ?? [],
        memberPointLoads: split.model.memberPointLoads ?? [],
        thermalLoads: split.model.thermalLoads ?? [],
      };
    }

    case "korf_zetten": {
      const id = getal("beamId");
      const korf = args.korf as ReinforcementCage | undefined;
      if (!korf || typeof korf !== "object") throw new Error("`korf` ontbreekt");
      if (a().modelDimension === "3d") {
        const beam = a().frame3d.model.beams.find((candidate) => candidate.id === id);
        if (!beam) throw new Error(`3D-staaf ${id} bestaat niet`);
        a().frame3d.updateBeam(id, {
          checkConfig: { ...(beam.checkConfig ?? {}), betonKorf: korf },
        });
        await verseRender();
        return a().frame3d.model.beams.find((candidate) => candidate.id === id) ?? {
          ...beam, checkConfig: { ...(beam.checkConfig ?? {}), betonKorf: korf },
        };
      }
      staaf(id);
      // De korf hangt aan `checkConfig.betonKorf`, niet aan de staaf zelf —
      // dezelfde plek waar het startmodel en de eigenschappendialoog hem
      // zetten. De rest van checkConfig blijft staan.
      const huidig = staaf(id).checkConfig ?? {};
      a().fem.updateBeam(id, { checkConfig: { ...huidig, betonKorf: korf } });
      await verseRender();
      return staaf(id);
    }

    case "analysetype_zetten": {
      const v = args.analysetype;
      if (v !== "eersteOrde" && v !== "tweedeOrdeGeometrisch" && v !== "tweedeOrdeFysisch") {
        throw new Error(`onbekend analysetype ${String(v)}`);
      }
      a().fem.setAnalysetype(v);
      await verseRender();
      return { analysetype: a().fem.analysetype };
    }

    case "rekenen": {
      if (a().modelDimension === "3d") {
        await a().frame3d.solve();
        await wachtOpFrame3DRender(a, verseRender);
        const state = a().frame3d;
        if (!state.result || state.solveError) {
          throw new Error(`3D doorrekenen mislukt: ${state.solveError ?? "de rekengang leverde geen resultaat"}`);
        }
        return frame3dUitlezen(a());
      }
      // Dezelfde rekengang als de knop Berekenen, en pas terug als hij HELEMAAL
      // klaar is: doorrekenen, bij tweedeOrdeFysisch de fysisch niet-lineaire
      // ronde, en de toetsing. Stond er na een modelwijziging al een
      // herberekening gepland, dan eerst die laten uitlopen — anders zou die
      // na deze gang nog starten en de toetsing onder de client vandaan wissen.
      const deadline = performance.now() + 590_000;
      await wachtOpRekenrust(a, deadline);
      const uitkomst = await a().rekenDoor();
      await verseRender();
      await wachtOpRekenrust(a, deadline);
      // Mislukt de rekengang, dan de ECHTE reden terug — en nooit de
      // combinatieresultaten van een vorige gang.
      const fout = a().laatsteRekenfout();
      const cr = a().fem.combinationResults;
      if (!uitkomst.gelukt || fout || !cr) {
        throw new Error(`doorrekenen mislukt: ${fout ?? "de rekengang leverde geen combinatieresultaten"}`);
      }
      const t = useCheckStore.getState();
      return {
        ...samenvatting(cr, a().fem.combinations),
        analysetype: a().fem.analysetype,
        fysischeRonde: uitkomst.fysisch,
        // De toetsing liep mee; wat ze opleverde staat hier samengevat, de
        // uitkomsten zelf via `toetsen_uitlezen`.
        toetsing: {
          fout: t.error,
          getoetst: t.results.length,
          overgeslagen: t.skipped.length,
          uitgevoerdOp: t.lastRunAt,
        },
      };
    }

    case "toetsen": {
      if (a().modelDimension === "3d") {
        await a().frame3d.solve();
        await wachtOpFrame3DRender(a, verseRender);
        const state = a().frame3d;
        if (!state.result || state.solveError) {
          throw new Error(`3D doorrekenen mislukt: ${state.solveError ?? "de rekengang leverde geen resultaat"}`);
        }
        return frame3dUitlezen(a());
      }
      await a().handleRunMemberChecks({ openPanel: false });
      await wachtOpStore(useCheckStore, (s) => !s.isRunning, 300_000, "de toetsing");
      return toetsenUitlezen();
    }

    case "toetsen_uitlezen":
      return a().modelDimension === "3d" ? frame3dUitlezen(a()) : toetsenUitlezen();

    case "dekkingslijn_openen": {
      const id = getal("beamId");
      staaf(id);
      const st = useDekkingslijnStore.getState();
      const v0 = st.volgnummer;
      a().setSelection({ type: "beam", id });
      a().setBottomPanelOpen(true);
      await verseRender();
      // Het venster vraagt de kern pas na een korte vertraging; wacht tot hij
      // óf klaar is (volgnummer hoger) óf aantoonbaar bezig, en dan tot klaar.
      // Was deze staaf al open en klaar, dan verandert er niets en is het
      // bestaande antwoord het antwoord.
      try {
        await wachtOpStore(useDekkingslijnStore,
          (s) => s.volgnummer > v0 || s.bezig, 3_000, "het dekkingslijnvenster");
      } catch {
        const s = useDekkingslijnStore.getState();
        if (!(s.beamId === id && !s.bezig && (s.antwoord || s.fout))) {
          throw new Error("het dekkingslijnvenster kwam niet in beweging — is het een betonstaaf met korf?");
        }
      }
      const klaar = await wachtOpStore(useDekkingslijnStore,
        (s) => !s.bezig && s.beamId === id && (s.antwoord !== null || s.fout !== null),
        180_000, "het dekkingslijn-antwoord");
      if (klaar.fout) throw new Error(klaar.fout);
      // Verzoek én antwoord: het verzoek is precies wat naar de kern ging, zodat
      // een client het rechtstreeks kan naspelen (vier wegen, één antwoord).
      return { verzoek: klaar.verzoek, antwoord: klaar.antwoord };
    }

    case "weergave_zetten": {
      const v = args.view;
      if (typeof v !== "string") throw new Error("`view` ontbreekt");
      a().setActiveView(v);
      await verseRender();
      return { weergave: a().activeView };
    }

    case "rapport_losmaken": {
      const label = await a().createDetachedWindow({ view: "report", title: "Rapport", width: 1000, height: 900 });
      return { label };
    }

    case "screenshot_dom": {
      const { default: html2canvas } = await import("html2canvas");
      const compatibeleKleur = (waarde: string) => waarde.replace(
        /color\(\s*(?:srgb|display-p3)\s+([^)]*)\)/gi,
        (_volledig, inhoud: string) => {
          const [kanalen, alfaTekst] = inhoud.split("/").map((deel) => deel.trim());
          const getallen = kanalen.split(/\s+/).map((deel) =>
            deel.endsWith("%") ? Number.parseFloat(deel) / 100 : Number.parseFloat(deel));
          if (getallen.length < 3 || getallen.some((getal) => !Number.isFinite(getal))) return "rgba(0,0,0,0)";
          const alfa = alfaTekst === undefined
            ? 1
            : alfaTekst.endsWith("%") ? Number.parseFloat(alfaTekst) / 100 : Number.parseFloat(alfaTekst);
          const kleur = getallen.slice(0, 3).map((getal) => Math.round(Math.max(0, Math.min(1, getal)) * 255));
          return `rgba(${kleur[0]},${kleur[1]},${kleur[2]},${Number.isFinite(alfa) ? Math.max(0, Math.min(1, alfa)) : 1})`;
        },
      );
      const kleurEigenschappen = [
        "color", "background-color", "border-top-color", "border-right-color",
        "border-bottom-color", "border-left-color", "outline-color",
        "text-decoration-color", "fill", "stroke", "box-shadow", "text-shadow",
      ] as const;
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        logging: false,
        onclone: (kopie) => {
          const bron = [document.documentElement, ...document.querySelectorAll<HTMLElement | SVGElement>("*")];
          const doel = [kopie.documentElement, ...kopie.querySelectorAll<HTMLElement | SVGElement>("*")];
          for (let index = 0; index < Math.min(bron.length, doel.length); index += 1) {
            const berekend = getComputedStyle(bron[index]);
            for (const eigenschap of kleurEigenschappen) {
              const waarde = berekend.getPropertyValue(eigenschap);
              if (waarde.includes("color(")) doel[index].style.setProperty(eigenschap, compatibeleKleur(waarde));
            }
          }
        },
      });
      return { dataUrl: canvas.toDataURL("image/png") };
    }

    // Het standaardrapport als PDF: Rust (`rapport_pdf`) roept deze twee aan,
    // met het printen ertussen. Zie rapportExport.ts.
    case "rapport_voorbereiden":
      return rapportVoorbereiden(args, a, wachtOpRender, verseRender);

    case "rapport_afronden":
      return rapportAfronden(args, a);

    default:
      throw new Error(`onbekende bedieningsopdracht \`${naam}\``);
  }
}

function toetsenUitlezen() {
  const s = useCheckStore.getState();
  // `inputs`: de kerninvoer zoals de bouwers hem samenstelden. Daarmee kan een
  // client dezelfde staaf rechtstreeks door de kern halen en het antwoord
  // naast dat van de GUI leggen — vier wegen, één antwoord.
  return {
    results: s.results,
    skipped: s.skipped,
    // De plaattoets: per plaat het resultaat (of de weigering) en de platen
    // die met reden niet naar de kern gingen. `inputs.plaat` is de kerninvoer.
    plate_results: s.plateResults,
    skipped_plates: s.plateSkipped,
    error: s.error,
    lastRunAt: s.lastRunAt,
    inputs: s.lastRunInputs,
  };
}

/** Volledige 3D-kernuitvoer plus dezelfde EN 1992/EN 1993-resultaten als de GUI. */
function frame3dUitlezen(a: BedieningActies) {
  return {
    dimension: "3d",
    result: a.frame3d.result,
    maxVerplaatsingMm: a.frame3d.result
      ? frame3DMaximumDisplacementM(a.frame3d.model, a.frame3d.result) * 1000
      : null,
    belastinggevallenBerekend: a.frame3d.caseResults.size,
    combinatiesBerekend: a.frame3d.combinationResults.size,
    actieveCombinatie: a.frame3d.activeCombinationId,
    combinatieResultaten: [...a.frame3d.combinationResults].map(([id, result]) => ({
      id,
      maxVerplaatsingMm: frame3DMaximumDisplacementM(a.frame3d.model, result) * 1000,
      alphaCr: result.buckling.status === "available" ? result.buckling.modes[0]?.loadFactor ?? null : null,
      convergent: result.secondOrder?.converged ?? true,
      stabiel: result.secondOrder?.stable ?? result.buckling.status !== "failed",
    })),
    steel: a.frame3d.checks,
    concrete: a.frame3d.concreteChecks,
    checksRunning: a.frame3d.checksRunning,
    solveError: a.frame3d.solveError,
    checksError: a.frame3d.checksError,
  };
}

/** Per combinatie de uitersten — genoeg om te zien dát er gerekend is, en wat. */
function samenvatting(
  cr: Map<number, SolverResult>,
  combos: readonly { id: number; name: string }[],
) {
  const uit: Record<string, unknown>[] = [];
  for (const [id, r] of cr) {
    let mMax = 0, vMax = 0, nMax = 0, wMax = 0;
    // Alleen de reeksen die hier tellen; via `unknown` omdat ElementForces
    // geen indexsignatuur heeft en de veldnamen per pad kunnen verschillen.
    const els = (r as unknown as { elements?: Map<number, Record<string, number[] | undefined>> }).elements;
    if (els) {
      for (const e of els.values()) {
        for (const x of e.bendingMoment ?? []) mMax = Math.max(mMax, Math.abs(x));
        for (const x of e.shearForce ?? []) vMax = Math.max(vMax, Math.abs(x));
        for (const x of e.axialForce ?? e.normalForce ?? []) nMax = Math.max(nMax, Math.abs(x));
        for (const x of e.deflection ?? []) wMax = Math.max(wMax, Math.abs(x));
      }
    }
    uit.push({
      combinatie: id,
      naam: combos.find((c) => c.id === id)?.name ?? String(id),
      M_max_kNm: mMax / 1e6,
      V_max_kN: vMax / 1e3,
      N_max_kN: nMax / 1e3,
      w_max_mm: wMax,
    });
  }
  return { combinaties: uit };
}

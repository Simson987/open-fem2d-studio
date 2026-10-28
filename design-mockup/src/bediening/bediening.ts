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
 * `gui_control_actief` en luistert alleen naar opdrachten als dat waar is, of
 * zodra de schakelaar Instellingen → AI-assistent (MCP) het kanaal aanzet
 * (event `gui-control:status`, issue #109).
 */
import { beschrijfOnbekendeDoorsnede, onbekendeOpenFem3DDoorsneden } from "../components/openFem3d/openFem3dDoorsnedeKeuring";
import { useEffect, useRef, useState } from "react";
import { useCheckStore } from "../stores/checkStore";
import { useDekkingslijnStore } from "../stores/dekkingslijnStore";
import { useReportStore } from "../stores/reportStore";
import { leesRapportKopOverschrijving } from "../components/report/useProjectInfo";
import { leesPagineerToestand } from "../components/report/rapportGereedheid";
import { tocToestand } from "../components/report/toc";
import type { Beam, Selection, SupportType, Load, Analysetype, StructuralGrid } from "../components/fem/femTypes";
import {
  OPEN_FEM_3D_SUPPORT_PRESETS,
  parseOpenFem3DModel,
  splitOpenFem3DBeam,
  type OpenFem3DModel,
} from "../components/openFem3d/openFem3dModel";
import {
  isOpenFem3DSymbolScaleKey, OPEN_FEM_3D_VISIBILITY_FLAGS, type OpenFem3DVisibility, type OpenFem3DVisibilityFlag,
} from "../components/openFem3d/openFem3dVisibility";
import { normalizeOpenFem3DSymbolPercent } from "../components/openFem3d/openFem3dSymbolScale";
import { isOpenFem3DPlateDisplay } from "../components/openFem3d/openFem3dPlateDisplay";
import { DEFAULT_OPEN_FEM_3D_SECTION_BOX, openFem3DSectionBoxUitOpdracht } from "../components/openFem3d/openFem3dSectionBox";
import { DEFAULT_OPEN_FEM_3D_EXPLODE, openFem3DExplodeFromCommand } from "../components/openFem3d/openFem3dExplode";
import { analyseOpenFem3DLoadPanels } from "../components/openFem3d/openFem3dLoadPanels";
import {
  applyOpenFem3DLevels,
  openFem3DLevelLinkError,
  openFem3DLevelsFromMetres,
} from "../components/openFem3d/openFem3dLevels";
import type { OpenFem3DView } from "../components/openFem3d/openFem3dCommands";
import type { OpenFem3DSolveResult } from "../components/openFem3d/openFem3dSolver";
import type { OpenFem3DSteelChecks } from "../components/openFem3d/openFem3dSteelCheck";
import type { OpenFem3DConcreteChecks } from "../components/openFem3d/openFem3dConcreteCheck";
import type { OpenFem3DTimberChecks } from "../components/openFem3d/openFem3dTimberCheck";
import type { ToetsKrachten3D } from "../components/openFem3d/openFem3dToetsKrachten";
import type { OpenFem3DSelection } from "../components/openFem3d/openFem3dSelection";
import { openFem3DEnvelopePanelGeometry } from "../components/openFem3d/openFem3dEnvelopePanels";
import { openFem3DMaximumDisplacementM } from "../components/openFem3d/openFem3dDisplacement";
import { maakStaalhal, type StaalhalResultaat } from "../components/openFem3d/wizards/staalhal";
import { importeerIfcAnalyseModel, type IfcAnalyseImport } from "../io/ifcAnalyseImport";
import type { SolverResult } from "../components/fem/solver/types";
import { combinatieSamenvatting } from "./samenvatting";
import type { ReinforcementCage } from "../lib/types/concrete/ReinforcementCage";
import { isEigenGewichtGeval } from "../lib/eigenGewicht";
import {
  lopendeExportId,
  rapportAfronden,
  rapportVoorbereiden,
  wachtOpRekenrust,
} from "./rapportExport";
import { appRegister, voerApiUitInApp, type ApiAppActies } from "./apiAdapter";
import { openFem3DBeamVerloop } from "../components/openFem3d/openFem3dVerloop";
// Rust meldt met dit event dat het kanaal aan of uit ging (gui_control::EVENT_STATUS).
import { EVENT_KANAAL_STATUS } from "../lib/mcpKoppeling";

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
    /** Het actieve belastinggeval (3D-uitlezing: leeg actief geval, issue #245). */
    activeLoadCaseId?: number;
    /** De combinaties van de laatste rekengang, met de veldpatroonvarianten (#219). */
    rekenCombinaties?: readonly { id: number; name: string }[];
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
  openFem3d: {
    model: OpenFem3DModel;
    visibility: OpenFem3DVisibility;
    structuralGrid: StructuralGrid;
    /** Vervang het 3D-model; met `levels` ook de levels (zAxes) van het stramien. */
    replaceModel: (model: OpenFem3DModel, levels?: StructuralGrid["zAxes"]) => void;
    /**
     * Een stalen hal van de generator in het project zetten: het 3D-model als
     * één undo-stap, de gevallen van de hal gekoppeld aan die van het project
     * (hal-id → project-id), stramien en eigen gewicht zoals de hal. Dezelfde
     * functie als "Maken" in de wizard.
     */
    applySteelHall: (hal: StaalhalResultaat) => { caseIds: Record<number, number> };
    setVisibility: (visibility: OpenFem3DVisibility) => void;
    /**
     * Het stramien. Gewijzigde levels nemen de gekoppelde 3D-knopen en -platen
     * mee; weigert de geometrie dat, dan gooit dit een fout en blijft alles staan.
     */
    setStructuralGrid: (grid: StructuralGrid) => void;
    setView: (view: OpenFem3DView) => void;
    /** De huidige 3D-selectie: `section_box.fit = "selection"` (issue #86) zet de doos eromheen. */
    selection?: OpenFem3DSelection;
    setSelection: (selection: OpenFem3DSelection) => void;
    selectCombination: (id: number) => void;
    updateBeam: (id: number, updates: Partial<OpenFem3DModel["beams"][number]>) => void;
    solve: () => Promise<void>;
    result: OpenFem3DSolveResult | null;
    caseResults: ReadonlyMap<number, OpenFem3DSolveResult>;
    combinationResults: ReadonlyMap<number, OpenFem3DSolveResult>;
    activeCombinationId: number | null;
    solveError: string | null;
    checks: OpenFem3DSteelChecks | null;
    concreteChecks: OpenFem3DConcreteChecks | null;
    timberChecks: OpenFem3DTimberChecks | null;
    /** Hoogt op bij iedere 3D-modelwijziging en iedere 3D-rekengang. */
    generation: () => number;
    solving: boolean;
    checksRunning: boolean;
    checksError: string | null;
    /**
     * De toets van de laatste rekengang (issue #199): altijd P-Δ met
     * scheefstand in ±X/±Y, met φ, α_cr per basiscombinatie, meldingen en een
     * eventuele weigering. Ontbreekt of `null` = geen toets.
     */
    toets?: ToetsKrachten3D | null;
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
  /**
   * Een geïmporteerd IFC-analysemodel als NIEUW 3D-project in de app zetten:
   * dezelfde toepassing als de knop "Rekenmodel importeren" na de modelkeuze.
   * Het kanaal vraagt niet naar niet-opgeslagen werk, net als `model_laden`.
   */
  importeerIfcProject: (imp: IfcAnalyseImport) => void;
  /** De acties waarmee de API-commando's (src/api/) in de app werken; zie apiAdapter.ts. */
  api: ApiAppActies;
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
async function wachtOpOpenFem3DRender(
  acties: () => BedieningActies,
  verseRender: () => Promise<void>,
): Promise<void> {
  for (let poging = 0; poging < 8; poging += 1) {
    await verseRender();
    const state = acties().openFem3d;
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
    let afStatus: (() => void) | null = null;
    let gestopt = false;
    // Eén keer luisteren naar opdrachten, ook als het begin (kanaal al aan bij
    // het starten) en het event van de schakelaar tegelijk komen.
    let koppeling: Promise<void> | null = null;
    const koppel = () => (koppeling ??= (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const { invoke } = await import("@tauri-apps/api/core");
      const afmelder = await listen<Opdracht>(EVENT_OPDRACHT, async (e) => {
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
      if (gestopt) afmelder(); else af = afmelder;
    })());
    (async () => {
      let aan = false;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        aan = await invoke<boolean>("gui_control_actief");
      } catch {
        return; // geen Tauri, of een oudere app zonder het command
      }
      if (gestopt) return;
      // Aan en uit terwijl de app draait (Instellingen → AI-assistent (MCP),
      // issue #109): Rust meldt elke wijziging met `gui-control:status`.
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const afmelder = await listen<{ actief: boolean }>(EVENT_KANAAL_STATUS, (e) => {
          setActief(e.payload.actief);
          if (e.payload.actief) void koppel();
        });
        if (gestopt) afmelder(); else afStatus = afmelder;
      } catch {
        // een app zonder het event: alleen de stand bij het starten
      }
      if (!aan || gestopt) return;
      setActief(true);
      await koppel();
    })();
    return () => { gestopt = true; af?.(); afStatus?.(); };
  }, []);

  return actief;
}

// ── De acties ───────────────────────────────────────────────────────────────

/** De velden van `beams[].bedding` in het kanaal en hun naam in het 3D-model. */
const BEDDING_KANAAL = {
  k_kn_per_m3: "kKnPerM3", width_m: "widthM", k_lateral_kn_per_m3: "kLateralKnPerM3", compression_only: "compressionOnly",
} as const;

/**
 * `beams[].bedding` van model_3d_bouwen in modelvorm. Een onbekend veld is een
 * tikfout en wordt geweigerd; de waarden keurt parseOpenFem3DModel.
 */
function beddingVanKanaal(waarde: unknown, staaf: number): Record<string, unknown> {
  if (!waarde || typeof waarde !== "object" || Array.isArray(waarde)) {
    throw new Error(`3D-staaf ${staaf}: bedding moet een object zijn (k_kn_per_m3, width_m, …)`);
  }
  const uit: Record<string, unknown> = {};
  for (const [sleutel, inhoud] of Object.entries(waarde as Record<string, unknown>)) {
    if (inhoud === undefined) continue;
    const veld = BEDDING_KANAAL[sleutel as keyof typeof BEDDING_KANAAL];
    if (!veld) throw new Error(`3D-staaf ${staaf}: onbekend veld in bedding: ${sleutel} (toegestaan: ${Object.keys(BEDDING_KANAAL).join(", ")})`);
    uit[veld] = inhoud;
  }
  return uit;
}

/** De velden van `plates[].bedding` in het kanaal en hun naam in het 3D-model (#107). */
const PLAATBEDDING_KANAAL = { k_kn_per_m3: "kKnPerM3", compression_only: "compressionOnly" } as const;

/**
 * `plates[].bedding` van model_3d_bouwen in modelvorm (#107). Een onbekend
 * veld is een tikfout en wordt geweigerd; de waarden keurt parseOpenFem3DModel.
 */
function plaatBeddingVanKanaal(waarde: unknown, plaat: number): Record<string, unknown> {
  if (!waarde || typeof waarde !== "object" || Array.isArray(waarde)) {
    throw new Error(`3D-plaat ${plaat}: bedding moet een object zijn (k_kn_per_m3, compression_only)`);
  }
  const uit: Record<string, unknown> = {};
  for (const [sleutel, inhoud] of Object.entries(waarde as Record<string, unknown>)) {
    if (inhoud === undefined) continue;
    const veld = PLAATBEDDING_KANAAL[sleutel as keyof typeof PLAATBEDDING_KANAAL];
    if (!veld) throw new Error(`3D-plaat ${plaat}: onbekend veld in bedding: ${sleutel} (toegestaan: ${Object.keys(PLAATBEDDING_KANAAL).join(", ")})`);
    uit[veld] = inhoud;
  }
  return uit;
}

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
          aantalKnopen: a().openFem3d.model.nodes.length,
          aantalStaven: a().openFem3d.model.beams.length,
          aantalPlaten: a().openFem3d.model.plates?.length ?? 0,
          aantalOpleggingen: a().openFem3d.model.supports?.length ?? 0,
          aantalLasten: (a().openFem3d.model.loads?.length ?? 0) + (a().openFem3d.model.memberLoads?.length ?? 0) +
            (a().openFem3d.model.memberPointLoads?.length ?? 0) + (a().openFem3d.model.thermalLoads?.length ?? 0) +
            (a().openFem3d.model.surfaceLoads?.length ?? 0) +
            (a().openFem3d.model.supports ?? []).filter((support) => Object.keys(support.prescribed ?? {}).length > 0).length,
          aantalOpgelegdeVerplaatsingen: (a().openFem3d.model.supports ?? []).reduce((count, support) =>
            count + Object.keys(support.prescribed ?? {}).length, 0),
          aantalBelastingvlakken: a().openFem3d.model.loadPanels?.length ?? 0,
          trekAlleenGemonteerdNaPermanent: a().openFem3d.model.tensionOnlyFitAfterPermanent === true,
          kruisregel: a().openFem3d.model.tensionOnlyCrossRule === true,
          generatie: a().openFem3d.generation(),
          heeftResultaat: a().openFem3d.result !== null,
          rekenfout: a().openFem3d.solveError,
          zichtbaarheid: a().openFem3d.visibility,
          stramien: a().openFem3d.structuralGrid,
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
      const rawLoadPanels = Array.isArray(args.load_panels) ? args.load_panels : [];
      const rawEnvelopePanels = Array.isArray(args.envelope_panels) ? args.envelope_panels : [];
      const rawDiaphragms = Array.isArray(args.diaphragms) ? args.diaphragms : [];
      // Levels (optioneel): label en hoogte in m. Ze vervangen de levels van
      // het stramien; `level` bij een knoop of plaat is een index (vanaf 1).
      const levels = args.levels === undefined
        ? undefined
        : openFem3DLevelsFromMetres(args.levels, a().openFem3d.structuralGrid.zAxes, "levels");
      const levelIdVan = (waarde: unknown, wat: string): string | undefined => {
        if (waarde === undefined) return undefined;
        if (!levels) throw new Error(`${wat}: level verwijst naar levels, maar levels ontbreekt`);
        if (!Number.isSafeInteger(waarde) || Number(waarde) < 1 || Number(waarde) > levels.length) {
          throw new Error(`${wat}: level moet een index van 1 tot en met ${levels.length} in levels zijn`);
        }
        return levels[Number(waarde) - 1].id;
      };
      const nodes: Array<{ id: number; x: unknown; y: unknown; z: unknown; levelId?: string }> = rawNodes.map((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`3D-knoop ${index + 1} is ongeldig`);
        const node = value as Record<string, unknown>;
        const levelId = levelIdVan(node.level, `3D-knoop ${index + 1}`);
        return { id: index + 1, x: node.x, y: node.y, z: node.z, ...(levelId ? { levelId } : {}) };
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
          // Verlopende staaf (#73); de modelkeuring weigert een niet-tekst, en
          // een verloop dat niet klopt wordt hieronder met de reden geweigerd.
          ...(beam.profile_name_end !== undefined ? { profileNameEnd: beam.profile_name_end } : {}),
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
          // Trek-alleen: alleen `true` zet het aan; de modelkeuring weigert een niet-boolean.
          ...(beam.tension_only !== undefined ? { tensionOnly: beam.tension_only } : {}),
          // Staaf op bedding (#106): de velden in modelvorm; de modelkeuring
          // weigert ongeldige waarden en een verticale k op een kolom.
          ...(beam.bedding !== undefined ? { bedding: beddingVanKanaal(beam.bedding, index + 1) } : {}),
        };
      });
      const supports = rawSupports.map((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`3D-oplegging ${index + 1} is ongeldig`);
        const support = value as Record<string, unknown>;
        const preset = support.type;
        if ((preset !== undefined && (typeof preset !== "string" || !(preset in OPEN_FEM_3D_SUPPORT_PRESETS))) ||
            !Number.isSafeInteger(support.node)) {
          throw new Error(`3D-oplegging ${index + 1}: gebruik node en optioneel type ${Object.keys(OPEN_FEM_3D_SUPPORT_PRESETS).join(", ")}`);
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
            : OPEN_FEM_3D_SUPPORT_PRESETS[preset as keyof typeof OPEN_FEM_3D_SUPPORT_PRESETS]),
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
        const levelId = levelIdVan(plate.level, `3D-plaat ${index + 1}`);
        return { id: index + 1, nodeIds: plate.nodes, thicknessM: plate.thickness_m ?? 0.2,
          ...(typeof plate.material === "string" ? { material: plate.material } : {}),
          ...(plate.corner_radius_m !== undefined ? { cornerRadiusM: plate.corner_radius_m } : {}),
          ...(openings !== undefined ? { openings } : {}),
          ...(levelId ? { levelId } : {}),
          // Plaat op bedding (#107); null of weggelaten = geen bedding.
          ...(plate.bedding !== undefined && plate.bedding !== null ? { bedding: plaatBeddingVanKanaal(plate.bedding, index + 1) } : {}) };
      });
      // Een plaat op een level neemt al haar knopen mee (ook die van de
      // openingen); een knoop die zelf aan een ander level hangt, is strijdig.
      for (const plate of plates) {
        if (!plate.levelId) continue;
        const openingen: unknown[] = Array.isArray(plate.openings) ? plate.openings : [];
        const lussen = [plate.nodeIds, ...openingen.map((opening) => (opening as { nodeIds?: unknown }).nodeIds)];
        const plaatKnopen = new Set(lussen.filter(Array.isArray).flat().map(Number));
        for (const nodeId of plaatKnopen) {
          const knoop = nodes.find((item) => item.id === nodeId);
          if (!knoop) continue; // de modelpoort hieronder meldt de ontbrekende knoop
          if (knoop.levelId && knoop.levelId !== plate.levelId) {
            throw new Error(`3D-plaat ${plate.id}: knoop ${nodeId} hangt aan een ander level dan de plaat`);
          }
          knoop.levelId = plate.levelId;
        }
      }
      const surfaceLoads = rawSurfaceLoads.map((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`3D-oppervlaktebelasting ${index + 1} is ongeldig`);
        const load = value as Record<string, unknown>;
        return { id: index + 1, plateId: load.plate,
          ...(load.case_id !== undefined ? { caseId: load.case_id } : {}),
          qx: load.qx ?? 0, qy: load.qy ?? 0, qz: load.qz ?? 0 };
      });
      // Belastingvlakken: hoekknopen als 1-gebaseerde knoopindices, net als platen.
      // Geen stille standaardwaarden: q, lastrichting en afdracht komen van de
      // aanroeper en de modelkeuring weigert wat ontbreekt.
      const loadPanels = rawLoadPanels.map((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`3D-belastingvlak ${index + 1} is ongeldig`);
        const panel = value as Record<string, unknown>;
        if (!Array.isArray(panel.nodes)) throw new Error(`3D-belastingvlak ${index + 1}: nodes moet een lijst met knoopindices zijn`);
        return {
          id: index + 1,
          nodeIds: panel.nodes,
          ...(panel.case_id !== undefined ? { caseId: panel.case_id } : {}),
          q: panel.q,
          direction: panel.direction,
          distribution: panel.distribution,
          ...(panel.span_direction !== undefined ? { spanDirection: panel.span_direction } : {}),
          ...(panel.excluded_beams !== undefined ? { excludedBeamIds: panel.excluded_beams } : {}),
          ...(panel.openings !== undefined ? { openings: Array.isArray(panel.openings)
            ? panel.openings.map((opening, openingIndex) => ({
              id: openingIndex + 1, nodeIds: (opening as Record<string, unknown>)?.nodes,
            })) : panel.openings } : {}),
        };
      });
      const envelopePanels = rawEnvelopePanels.map((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`3D-schilpaneel ${index + 1} is ongeldig`);
        const panel = value as Record<string, unknown>;
        if (!Array.isArray(panel.nodes)) throw new Error(`3D-schilpaneel ${index + 1}: nodes moet een lijst met knoopindices zijn`);
        return {
          id: index + 1, nodeIds: panel.nodes, type: panel.type, distribution: panel.distribution,
          ...(panel.flip_outer_side !== undefined ? { flipOuterSide: panel.flip_outer_side } : {}),
          ...(panel.span_direction !== undefined ? { spanDirection: panel.span_direction } : {}),
          ...(panel.cladding_weight_kn_per_m2 !== undefined ? { claddingWeightKnPerM2: panel.cladding_weight_kn_per_m2 } : {}),
          ...(panel.name !== undefined ? { name: panel.name } : {}),
          ...(panel.openings !== undefined ? { openings: Array.isArray(panel.openings)
            ? panel.openings.map((opening, openingIndex) => ({
              id: openingIndex + 1, nodeIds: (opening as Record<string, unknown>)?.nodes,
            })) : panel.openings } : {}),
        };
      });
      // Starre schijven: knopen als 1-gebaseerde knoopindices, net als platen.
      // De modelkeuring weigert ontbrekende knopen en een knoop in twee schijven;
      // de rekenkern keurt de hoogte (binnen 1 mm) en de opleggingen.
      const diaphragms = rawDiaphragms.map((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`3D-schijf ${index + 1} is ongeldig`);
        const diaphragm = value as Record<string, unknown>;
        if (!Array.isArray(diaphragm.nodes)) throw new Error(`3D-schijf ${index + 1}: nodes moet een lijst met knoopindices zijn`);
        return {
          id: index + 1,
          nodeIds: diaphragm.nodes,
          ...(diaphragm.name !== undefined ? { name: diaphragm.name } : {}),
        };
      });
      const gelezen = parseOpenFem3DModel({
        nodes, beams, plates, supports, loads, memberLoads, memberPointLoads, thermalLoads, surfaceLoads,
        ...(loadPanels.length > 0 ? { loadPanels } : {}),
        ...(envelopePanels.length > 0 ? { envelopePanels } : {}),
        ...(diaphragms.length > 0 ? { diaphragms } : {}),
        // Modelinstellingen voor trek-alleen staven; de modelkeuring weigert
        // een niet-boolean.
        ...(args.tension_only_fit_after_permanent !== undefined
          ? { tensionOnlyFitAfterPermanent: args.tension_only_fit_after_permanent } : {}),
        ...(args.tension_only_cross_rule !== undefined ? { tensionOnlyCrossRule: args.tension_only_cross_rule } : {}),
      });
      // Een verlopende staaf met een eindprofiel dat niet bij het begin past:
      // dezelfde weigering als model3d.beam.add, met de reden van bepaalVerloop.
      for (const beam of gelezen.beams) {
        if (beam.profileNameEnd === undefined) continue;
        const verloop = openFem3DBeamVerloop(beam);
        if (verloop.status === "fout") throw new Error(`3D-staaf ${beam.id}: ${verloop.reden}`);
      }
      // #230: een onbekend profiel of materiaal (of een combinatie die niet
      // bij elkaar past) weigert Berekenen later toch; dan nu al, met ALLE
      // staven die het betreft, en het huidige model blijft staan. Een staaf
      // ZONDER materiaal valt hier buiten (zoals voorheen: Berekenen meldt
      // dat); het gaat om een opgegeven naam die niet bestaat of niet past.
      const onbekend = onbekendeOpenFem3DDoorsneden({
        beams: gelezen.beams.filter((beam) => (beam.material?.trim() ?? "") !== ""),
      });
      if (onbekend.length > 0) {
        throw new Error(`${onbekend.map(beschrijfOnbekendeDoorsnede).join("; ")}. Het model is niet geopend.${onbekend[0].suggestie}`);
      }
      let model = gelezen;
      if (levels) {
        // Een gekoppelde knoop moet op de hoogte van zijn level liggen; daarna
        // komt hij er exact op (binnen 1 µm was de invoer al goed).
        const fout = openFem3DLevelLinkError(gelezen, levels);
        if (fout) throw new Error(fout);
        const opHoogte = applyOpenFem3DLevels(gelezen, levels);
        if (!opHoogte.ok) throw new Error(`levels: het model klopt niet op de levelhoogtes (${opHoogte.refusal.kind})`);
        model = opHoogte.model;
      }
      for (const panel of model.envelopePanels ?? []) openFem3DEnvelopePanelGeometry(model, panel);
      a().openFem3d.replaceModel(model, levels);
      await verseRender();
      return {
        modelDimension: a().modelDimension,
        levelIds: levels?.map((level) => level.id) ?? null,
        aantalGekoppeldeKnopen: model.nodes.filter((node) => node.levelId !== undefined).length,
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
        loadPanelIds: (model.loadPanels ?? []).map((panel) => panel.id),
        envelopePanelIds: (model.envelopePanels ?? []).map((panel) => panel.id),
        diaphragmIds: (model.diaphragms ?? []).map((diaphragm) => diaphragm.id),
        aantalTrekAlleen: model.beams.filter((beam) => beam.tensionOnly).length,
        trekAlleenGemonteerdNaPermanent: model.tensionOnlyFitAfterPermanent === true,
        kruisregel: model.tensionOnlyCrossRule === true,
        // De afdracht per vlak meteen terug, zodat een fout (geen ligger,
        // niet vlak) niet pas bij het rekenen opvalt.
        belastingvlakken: analyseOpenFem3DLoadPanels(model).map((analysis) => ({
          id: analysis.panel.id,
          ...(analysis.error !== undefined ? { fout: analysis.error } : {
            dragendeStaven: analysis.result!.receiverBeamIds,
            meldingen: analysis.result!.warnings,
          }),
        })),
      };
    }

    case "staalhal_maken": {
      // Dezelfde generator en dezelfde toepassing als de wizard "Stalen hal…".
      // Parameters die niet deugen komen met ALLE problemen terug (de melding
      // van StaalhalFout); er verandert dan niets in het project.
      const onbekend = Object.keys(args).filter((k) => k !== "hal");
      if (onbekend.length > 0) throw new Error(`onbekend veld ${onbekend.map((k) => `\`${k}\``).join(", ")}; staalhal_maken kent alleen \`hal\``);
      const hal = maakStaalhal(args.hal ?? {});
      const { caseIds } = a().openFem3d.applySteelHall(hal);
      await verseRender();
      return {
        modelDimension: a().modelDimension,
        aantallen: hal.samenvatting.aantallen,
        maten: hal.samenvatting.maten,
        groepen: hal.samenvatting.groepen,
        belastinggevallen: hal.loadCases.map((c) => ({ halId: c.id, projectId: caseIds[c.id], naam: c.name })),
        waarschuwingen: hal.waarschuwingen,
        generatie: a().openFem3d.generation(),
      };
    }

    case "ifc_analysemodel_importeren": {
      // Dezelfde import als de knop "Rekenmodel importeren"; Rust las het
      // bestand (`gui_control.rs`), want de pagina mag niet elk pad lezen. Een
      // bestand dat niet deugt of een ontbrekende modelkeuze komt terug met
      // de melding van de import (bij meer modellen: de lijst), en dan
      // verandert er niets in de app.
      const onbekend = Object.keys(args).filter((k) => !["tekst", "pad", "analysemodel"].includes(k));
      if (onbekend.length > 0) {
        throw new Error(`onbekend veld ${onbekend.map((k) => `\`${k}\``).join(", ")}; ifc_analysemodel_importeren kent tekst, pad en analysemodel`);
      }
      if (typeof args.tekst !== "string") throw new Error("`tekst` ontbreekt");
      const keuze = args.analysemodel;
      if (keuze !== undefined && !(typeof keuze === "string" && keuze.trim()) &&
          !(typeof keuze === "number" && Number.isInteger(keuze) && keuze >= 1)) {
        throw new Error("`analysemodel` is de naam van het analysemodel of zijn volgnummer (vanaf 1)");
      }
      const imp = importeerIfcAnalyseModel(args.tekst, { model: keuze as string | number | undefined });
      a().importeerIfcProject(imp);
      await verseRender();
      return {
        modelDimension: a().modelDimension,
        pad: typeof args.pad === "string" ? args.pad : null,
        projectnaam: imp.projectnaam,
        verslag: imp.verslag,
        belastinggevallen: imp.loadCases.map((c) => ({
          id: c.id, naam: c.name, type: c.type, ...(c.eigenGewicht ? { eigenGewicht: true } : {}),
        })),
        combinaties: imp.combinations.map((c) => ({ id: c.id, naam: c.name, type: c.type, formule: c.formula })),
        levels: imp.levels.map((l) => ({ id: l.id, label: l.label, hoogteM: l.position / 1000 })),
        aantalKnopen: a().openFem3d.model.nodes.length,
        aantalStaven: a().openFem3d.model.beams.length,
        generatie: a().openFem3d.generation(),
      };
    }

    case "weergave_3d_configureren": {
      if (a().modelDimension !== "3d") throw new Error("de actieve projectdimensie is 2D; bouw of converteer eerst een 3D-model");
      // De section box (issue #86) eerst keuren: een fout laat dan alles staan.
      const sectionBox = args.section_box === undefined ? undefined
        : openFem3DSectionBoxUitOpdracht(args.section_box, a().openFem3d.visibility.sectionBox ?? DEFAULT_OPEN_FEM_3D_SECTION_BOX,
          a().openFem3d.model, a().openFem3d.selection ?? null);
      // De explode (issue #198), alleen weergave: ook eerst keuren.
      const explode = args.explode === undefined ? undefined
        : openFem3DExplodeFromCommand(args.explode, a().openFem3d.visibility.explode ?? DEFAULT_OPEN_FEM_3D_EXPLODE);
      if (args.visibility !== undefined) {
        if (!args.visibility || typeof args.visibility !== "object" || Array.isArray(args.visibility)) {
          throw new Error("`visibility` moet een object zijn");
        }
        const current = a().openFem3d.visibility;
        const next: OpenFem3DVisibility = { ...current };
        const gevraagd = args.visibility as Record<string, unknown>;
        for (const [key, value] of Object.entries(gevraagd)) {
          // De plaatweergave (issue #78): volume, surface of mesh.
          if (key === "plateDisplay") {
            if (!isOpenFem3DPlateDisplay(value)) {
              throw new Error("ongeldige 3D-zichtbaarheidsoptie plateDisplay: volume, surface of mesh");
            }
            next.plateDisplay = value;
            continue;
          }
          // De oude schakelaar mesh blijft aangenomen voor bestaande aanroepen:
          // true → mesh, false → volume. Staat plateDisplay er ook, dan wint die.
          if (key === "mesh") {
            if (typeof value !== "boolean") throw new Error("ongeldige 3D-zichtbaarheidsoptie mesh: true of false");
            if (gevraagd.plateDisplay === undefined) next.plateDisplay = value ? "mesh" : "volume";
            continue;
          }
          // De grootte van knopen en opleggingen (issue #82): een getal in %,
          // begrensd tot 25–400 zoals de regelaar en de opslag.
          if (isOpenFem3DSymbolScaleKey(key)) {
            if (typeof value !== "number" || !Number.isFinite(value)) {
              throw new Error(`ongeldige 3D-zichtbaarheidsoptie ${key}: een getal in % tussen 25 en 400`);
            }
            next[key] = normalizeOpenFem3DSymbolPercent(value);
            continue;
          }
          if (!OPEN_FEM_3D_VISIBILITY_FLAGS.includes(key as OpenFem3DVisibilityFlag) || typeof value !== "boolean") {
            throw new Error(`ongeldige 3D-zichtbaarheidsoptie ${key}`);
          }
          next[key as OpenFem3DVisibilityFlag] = value;
        }
        if (sectionBox) next.sectionBox = sectionBox;
        if (explode) next.explode = explode;
        a().openFem3d.setVisibility(next);
      } else if (sectionBox || explode) {
        a().openFem3d.setVisibility({
          ...a().openFem3d.visibility, ...(sectionBox ? { sectionBox } : {}), ...(explode ? { explode } : {}),
        });
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
        const current = a().openFem3d.structuralGrid;
        // Levels houden hun id als hun label al bestond: gekoppelde knopen en
        // platen schuiven dan mee naar de nieuwe hoogte. Weigert de app dat
        // (staaf zonder lengte, plaat scheef), dan komt die fout hier terug.
        a().openFem3d.setStructuralGrid({
          ...current,
          ...(raw.enabled === undefined ? {} : { enabled: raw.enabled }),
          ...(axisList("x_axes", "x") ? { xAxes: axisList("x_axes", "x")! } : {}),
          ...(axisList("y_axes", "y") ? { yAxes: axisList("y_axes", "y")! } : {}),
          ...(raw.z_levels !== undefined
            ? { zAxes: openFem3DLevelsFromMetres(raw.z_levels, current.zAxes, "structural_grid.z_levels") }
            : {}),
        });
      }
      if (args.view !== undefined) {
        if (args.view !== "iso" && args.view !== "top" && args.view !== "front" && args.view !== "side") {
          throw new Error("`view` moet iso, top, front of side zijn");
        }
        a().openFem3d.setView(args.view);
      }
      await verseRender();
      return { zichtbaarheid: a().openFem3d.visibility, stramien: a().openFem3d.structuralGrid, view: args.view ?? null };
    }

    case "resultaat_3d_kiezen": {
      if (a().modelDimension !== "3d") throw new Error("de actieve projectdimensie is 2D");
      const id = getal("id");
      if (!a().openFem3d.combinationResults.has(id)) {
        throw new Error(`3D-combinatie ${id} heeft geen berekend resultaat; voer eerst rekenen uit`);
      }
      a().openFem3d.selectCombination(id);
      await verseRender();
      return openFem3dUitlezen(a());
    }

    case "staaf_selecteren": {
      const id = getal("id");
      if (a().modelDimension === "3d") {
        const beam = a().openFem3d.model.beams.find((candidate) => candidate.id === id);
        if (!beam) throw new Error(`3D-staaf ${id} bestaat niet`);
        a().openFem3d.setSelection({ type: "beam", id });
        a().setActiveView("openFem3d");
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
      const plate = (a().openFem3d.model.plates ?? []).find((candidate) => candidate.id === id);
      if (!plate) throw new Error(`3D-plaat ${id} bestaat niet`);
      a().openFem3d.setSelection({ type: "plate", id });
      a().setActiveView("openFem3d");
      await verseRender();
      return plate;
    }

    case "staaf_3d_splitsen": {
      if (a().modelDimension !== "3d") throw new Error("de actieve projectdimensie is 2D; bouw of converteer eerst een 3D-model");
      const beamId = getal("beamId");
      const ratio = getal("ratio");
      const split = splitOpenFem3DBeam(a().openFem3d.model, beamId, ratio);
      a().openFem3d.replaceModel(split.model);
      a().openFem3d.setSelection({ type: "node", id: split.nodeId });
      a().setActiveView("openFem3d");
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
        const beam = a().openFem3d.model.beams.find((candidate) => candidate.id === id);
        if (!beam) throw new Error(`3D-staaf ${id} bestaat niet`);
        a().openFem3d.updateBeam(id, {
          checkConfig: { ...(beam.checkConfig ?? {}), betonKorf: korf },
        });
        await verseRender();
        return a().openFem3d.model.beams.find((candidate) => candidate.id === id) ?? {
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
        await a().openFem3d.solve();
        await wachtOpOpenFem3DRender(a, verseRender);
        const state = a().openFem3d;
        // Issue #245: alleen falen bij een echte rekenfout of als er helemaal
        // niets berekend is. Een leeg ACTIEF geval is geen rekenfout; de
        // uitlezing noemt het in `melding` en geeft de berekende resultaten.
        if (state.solveError || (!state.result && state.caseResults.size === 0 && state.combinationResults.size === 0)) {
          throw new Error(`3D doorrekenen mislukt: ${state.solveError ?? "de rekengang leverde geen resultaat"}`);
        }
        return openFem3dUitlezen(a());
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
        ...combinatieSamenvatting(cr, a().fem.rekenCombinaties ?? a().fem.combinations),
        // Het analysetype van de RESULTATEN; de toets rekent zelf (`toetsing`).
        analysetype: a().fem.analysetype,
        fysischeRonde: uitkomst.fysisch,
        // De toetsing liep mee; wat ze opleverde staat hier samengevat, de
        // uitkomsten zelf via `toetsen_uitlezen`.
        toetsing: {
          fout: t.error,
          getoetst: t.results.length,
          overgeslagen: t.skipped.length,
          uitgevoerdOp: t.lastRunAt,
          // De analyse van de UGT-toetskrachten (issue #199): altijd tweede
          // orde met scheefstand, met φ, bron en of de resultaten hergebruikt
          // zijn. `null` zonder toetsronde (of bij een geweigerde toets: dan
          // staat de reden in `fout`).
          toetsanalyse: t.lastRunData?.toets?.analyse ?? null,
        },
      };
    }

    case "toetsen": {
      if (a().modelDimension === "3d") {
        await a().openFem3d.solve();
        await wachtOpOpenFem3DRender(a, verseRender);
        const state = a().openFem3d;
        // Issue #245: alleen falen bij een echte rekenfout of als er helemaal
        // niets berekend is. Een leeg ACTIEF geval is geen rekenfout; de
        // uitlezing noemt het in `melding` en geeft de berekende resultaten.
        if (state.solveError || (!state.result && state.caseResults.size === 0 && state.combinationResults.size === 0)) {
          throw new Error(`3D doorrekenen mislukt: ${state.solveError ?? "de rekengang leverde geen resultaat"}`);
        }
        return openFem3dUitlezen(a());
      }
      await a().handleRunMemberChecks({ openPanel: false });
      await wachtOpStore(useCheckStore, (s) => !s.isRunning, 300_000, "de toetsing");
      return toetsenUitlezen();
    }

    case "toetsen_uitlezen":
      return a().modelDimension === "3d" ? openFem3dUitlezen(a()) : toetsenUitlezen();

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
      // html2canvas kent color() niet; de kloon wordt zelf nagelopen (#100).
      const { maakKleurenCompatibel } = await import("../lib/html2canvasKleuren");
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        logging: false,
        onclone: maakKleurenCompatibel,
      });
      return { dataUrl: canvas.toDataURL("image/png") };
    }

    // Het standaardrapport als PDF: Rust (`rapport_pdf`) roept deze twee aan,
    // met het printen ertussen. Zie rapportExport.ts.
    case "rapport_voorbereiden":
      return rapportVoorbereiden(args, a, wachtOpRender, verseRender);

    case "rapport_afronden":
      return rapportAfronden(args, a);

    // De API-commando's van de app (src/api/): de catalogus, en één commando
    // uitvoeren. Het antwoord van `api_uitvoeren` is altijd een object met
    // `ok`, zodat de foutcode van het register heel bij de MCP-server komt
    // (het kanaal zelf kent alleen een fouttekst). Zie apiAdapter.ts.
    case "api_catalogus":
      return { commands: appRegister(a().api).catalogus().map((c) => ({
        name: c.naam, description: c.beschrijving, inputSchema: c.invoer, kind: c.soort,
      })) };

    case "api_uitvoeren": {
      if (typeof args.name !== "string") throw new Error("`name` (de naam van het commando) ontbreekt");
      const antwoord = await voerApiUitInApp(a().api, args.name, args.input);
      await verseRender();
      return antwoord;
    }

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
    // De analyse van de UGT-toetskrachten (issue #199) en wat de toets daarover
    // meldde (hout met E_mean, een verhoogde of te kleine φ, vervallen
    // eindtoestandvarianten) — dezelfde gegevens die `check_fem_model` in
    // `stability` en `warnings` geeft.
    toetsanalyse: s.lastRunData?.toets?.analyse ?? null,
    toetsmeldingen: s.lastRunData?.toets?.meldingen ?? [],
  };
}

/** Volledige 3D-kernuitvoer plus dezelfde EN 1992/EN 1993-resultaten als de GUI. */
function openFem3dUitlezen(a: BedieningActies) {
  // Het actieve belastinggeval zonder eigen resultaat (geen last, issue #245):
  // geen rekenfout, maar wél te melden — met wat er in `result` staat.
  const actief = a.fem.activeLoadCaseId;
  const o = a.openFem3d;
  const heeftIets = o.caseResults.size > 0 || o.combinationResults.size > 0;
  const actiefLeeg = actief !== undefined && heeftIets && !o.caseResults.has(actief);
  const gevalNaam = (id: number) => a.fem.loadCases.find((lc) => lc.id === id)?.name ?? String(id);
  const getoondeCombinatie = o.activeCombinationId === null ? undefined
    : a.fem.combinations.find((c) => c.id === o.activeCombinationId);
  const melding = actiefLeeg
    ? `Belastinggeval ${actief} ("${gevalNaam(actief!)}") heeft geen belasting en dus geen eigen resultaat. ` +
      (o.activeCombinationId !== null
        ? `In \`result\` staat combinatie ${o.activeCombinationId}` +
          `${getoondeCombinatie ? ` ("${getoondeCombinatie.name}")` : ""}. `
        : "") +
      `Berekend: ${o.caseResults.size} belastinggeval(len) en ${o.combinationResults.size} combinatie(s); ` +
      "zie `combinatieResultaten`."
    : null;
  return {
    dimension: "3d",
    actiefBelastinggeval: actief === undefined ? null
      : { id: actief, naam: gevalNaam(actief), heeftResultaat: o.caseResults.has(actief) },
    melding,
    result: a.openFem3d.result,
    maxVerplaatsingMm: a.openFem3d.result
      ? openFem3DMaximumDisplacementM(a.openFem3d.model, a.openFem3d.result) * 1000
      : null,
    belastinggevallenBerekend: a.openFem3d.caseResults.size,
    combinatiesBerekend: a.openFem3d.combinationResults.size,
    actieveCombinatie: a.openFem3d.activeCombinationId,
    combinatieResultaten: [...a.openFem3d.combinationResults].map(([id, result]) => ({
      id,
      maxVerplaatsingMm: openFem3DMaximumDisplacementM(a.openFem3d.model, result) * 1000,
      alphaCr: result.buckling.status === "available" ? result.buckling.modes[0]?.loadFactor ?? null : null,
      convergent: result.secondOrder?.converged ?? true,
      stabiel: result.secondOrder?.stable ?? result.buckling.status !== "failed",
    })),
    steel: a.openFem3d.checks,
    concrete: a.openFem3d.concreteChecks,
    timber: a.openFem3d.timberChecks,
    checksRunning: a.openFem3d.checksRunning,
    solveError: a.openFem3d.solveError,
    checksError: a.openFem3d.checksError,
    // De analyse van de UGT-toetskrachten (issue #199): altijd P-Δ met
    // scheefstand in ±X/±Y, met φ, bron en of de resultaten hergebruikt zijn;
    // α_cr per basiscombinatie en wat de toets meldde. `null` zonder toets.
    toetsanalyse: a.openFem3d.toets?.analyse ?? null,
    toetsAlphaCr: a.openFem3d.toets?.alphaCr ?? [],
    toetsmeldingen: a.openFem3d.toets?.meldingen ?? [],
  };
}

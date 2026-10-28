/**
 * FemProjectTree — live project browser, driven by the lifted store.
 *
 * Renders counts & leaves from the actual canvas state (nodes, beams,
 * supports, plates, load cases). Selecting a leaf updates the central
 * selection so the right Properties panel reacts.
 */
import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "./FemProjectTree.css";
import type { Node, Beam, Plate, Support, Load, LoadCase, Selection } from "./femTypes";
import type { LoadCombination, Envelope } from "./solver/combinations";
import type { OvergeslagenCombinatie } from "../../lib/combinatieSelectie";
// De doorsnedenaam van een staaf — één bron, dezelfde keuring als de
// solver en de rekenkern; zie lib/verloopKeuze.
import { doorsnedeNaamVertaald } from "../../lib/verloopKeuze";
import { vertaal } from "../../lib/vertaalbareTekst";
import type { CombinatieAfwijking, CombinatieVervanging, GevalMelding } from "../../lib/combinatieBeheer";
import type { DisplayFlags } from "./FemResultsOverlay";
import { PLAAT_COMPONENTEN } from "./FemCanvas";
import { STEEL_GRADES } from "./BarPropertiesDialog";
import { SUPPORTED_TIMBER_GRADES } from "../../lib/timberCheckBuilder";
import { useCheckStore } from "../../stores/checkStore";
import { useResultaatInfoStore } from "../../stores/resultaatInfoStore";
import ExplorerViewTab from "./ExplorerViewTab";
import type { OpenFem3DVisibility } from "../openFem3d/openFem3dVisibility";

interface TreeNodeProps {
  label: string;
  count?: number;
  defaultOpen?: boolean;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  /** Klapt de knoop open zodra dit getal verandert (selectie op het canvas). */
  onthul?: number;
}

function TreeNode({ label, count, defaultOpen = false, children, icon, onthul }: TreeNodeProps) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (onthul) setOpen(true);
  }, [onthul]);
  const hasChildren = !!children;
  return (
    <div className="fem-tree-node">
      <button
        className="fem-tree-row"
        onClick={() => hasChildren && setOpen(!open)}
      >
        {hasChildren ? (
          <span className={`fem-tree-chevron${open ? " open" : ""}`}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M3 2l4 3-4 3z" />
            </svg>
          </span>
        ) : (
          <span className="fem-tree-chevron-spacer" />
        )}
        {icon && <span className="fem-tree-icon">{icon}</span>}
        <span className="fem-tree-label">{label}</span>
        {count !== undefined && <span className="fem-tree-count">{count}</span>}
      </button>
      {hasChildren && open && (
        <div className="fem-tree-children">{children}</div>
      )}
    </div>
  );
}

interface LeafProps {
  label: string;
  value?: string;
  active?: boolean;
  onClick?: () => void;
  /** Zoekterm die in label en waarde gemarkeerd wordt. */
  zoek?: string;
}
/**
 * ResultsTab — sidebar pane shown under the "Resultaten" tab.
 * Hosts the M-lijn / V-lijn / N-lijn / Δu / R toggles that drive the canvas
 * overlay (lifted state — same flags as the floating HUD on the canvas).
 */
function ResultsTab({
  displayFlags, setDisplayFlags, hasResults,
  loadCases = [], activeLoadCaseId,
  combinations = [], activeCombinationId,
  envelopeView = false,
  hasPlates = false,
  onSelectScope,
}: {
  displayFlags?: DisplayFlags;
  setDisplayFlags?: React.Dispatch<React.SetStateAction<DisplayFlags>>;
  hasResults: boolean;
  loadCases?: LoadCase[];
  activeLoadCaseId?: number;
  combinations?: LoadCombination[];
  activeCombinationId?: number | null;
  envelopeView?: boolean;
  /** True zodra het model platen bevat — toont de contour-rij (P3.2). */
  hasPlates?: boolean;
  /** Called when user picks a scope. Encodes which one was chosen so App
   * can set the right state (single LC / combination / envelope). */
  onSelectScope?: (scope:
    | { kind: "lc"; id: number }
    | { kind: "combo"; id: number }
    | { kind: "envelope" }) => void;
}) {
  // Zijn er toetsresultaten? Bepaalt de hint onder de Unity-check-rij.
  // (Hook vóór de early-return — hooks-regels.)
  const hasCheckResults = useCheckStore((s) => s.results.length > 0);
  // ...en zo nee, waarom niet? Er is verschil tussen "nog niet getoetst" en
  // "de toetsronde is gedraaid maar de rekenkern gaf een fout". Alleen in het
  // eerste geval helpt de knop waar de hint naar wijst.
  const checkFout = useCheckStore((s) => s.error);
  // Draagt het getoonde resultaat segmentstijfheden? Bepaalt of de EI-rij
  // bruikbaar is; het canvas zet dit vlaggetje bij elke solve (zie
  // resultaatInfoStore).
  const heeftSegmentStijfheid = useResultaatInfoStore((s) => s.heeftSegmentStijfheid);
  const { t } = useTranslation("common");
  if (!displayFlags || !setDisplayFlags) {
    return (
      <div className="fem-results-empty">
        {t("tree.runToSeeResults")}
      </div>
    );
  }
  const toggle = (key: keyof DisplayFlags) =>
    setDisplayFlags(f => ({ ...f, [key]: !f[key] }));

  type Row = {
    key: keyof DisplayFlags;
    label: string;
    hint: string;
    swatch: string;
    /** Optional companion scale-flag key for a slider next to this toggle. */
    scaleKey?: keyof DisplayFlags;
    /**
     * Gezet → de rij staat uitgegrijsd en is niet aan te zetten; de tekst is
     * de REDEN, en die verschijnt zowel als tooltip als onder de rij. Bedoeld
     * voor standen die alleen bij een bepaald soort berekening inhoud hebben
     * (nu: EI zonder segmentuitkomsten). Een lege canvas-laag aanzetten zegt
     * de gebruiker niets; een reden wel.
     */
    disabledReden?: string;
  };
  const ROWS: Row[] = [
    { key: "deflection", label: t("tree.rowDeflection"), hint: t("tree.rowDeflectionHint"), swatch: "var(--theme-accent)", scaleKey: "scaleU" },
    { key: "M",          label: "My",            hint: t("tree.rowMomentHint"), swatch: "#2563eb",            scaleKey: "scaleM" },
    { key: "V",          label: "Vz",            hint: t("tree.rowShearHint"), swatch: "#10b981",            scaleKey: "scaleV" },
    { key: "N",          label: "N",             hint: t("tree.rowAxialHint"), swatch: "#f59e0b",            scaleKey: "scaleN" },
    { key: "rotation",   label: "φy",            hint: t("tree.rowRotationHint"), swatch: "#8b5cf6", scaleKey: "scaleR" },
    { key: "reactions",  label: t("tree.rowReactions"), hint: t("tree.rowReactionsHint"), swatch: "var(--theme-text)" },
    { key: "uc",         label: t("resultView.ucLabel"), hint: t("resultView.ucCombinations"), swatch: "#16a34a" },
    // EI-verloop: alleen zinvol met segmentuitkomsten uit de fysisch
    // niet-lineaire (beton)berekening. Zonder die uitkomsten uitgegrijsd MET
    // reden — er is dan niets gescheurd gerekend, en dat is een geldige
    // toestand en geen fout.
    {
      key: "EI", label: t("tree.rowEI"),
      hint: t("tree.rowEIHint"),
      swatch: "#0f766e", scaleKey: "scaleEI",
      disabledReden: heeftSegmentStijfheid
        ? undefined
        : t("tree.rowEIDisabled"),
    },
  ];
  // Contour-rij alleen wanneer het model platen bevat (P3.2).
  if (hasPlates) {
    ROWS.push({
      key: "plaatContour", label: t("tree.rowPlateStress"),
      hint: t("tree.rowPlateStressHint"),
      swatch: "#d97706",
    });
  }

  // Build current "scope" value for the dropdown.
  const currentValue =
    envelopeView                            ? "envelope"
    : activeCombinationId != null           ? `combo:${activeCombinationId}`
    : activeLoadCaseId != null              ? `lc:${activeLoadCaseId}`
    :                                          "";

  const handleScopeChange = (value: string) => {
    if (!onSelectScope) return;
    if (value === "envelope")             onSelectScope({ kind: "envelope" });
    else if (value.startsWith("combo:"))  onSelectScope({ kind: "combo", id: Number(value.slice(6)) });
    else if (value.startsWith("lc:"))     onSelectScope({ kind: "lc", id: Number(value.slice(3)) });
  };

  return (
    <div className="fem-results-tab">
      {/* Scope picker — choose which case / combination / envelope is shown */}
      <div className="fem-results-section-title">{t("tree.showResultFor")}</div>
      <select
        className="fem-results-scope-select"
        value={currentValue}
        onChange={(e) => handleScopeChange(e.target.value)}
      >
        {loadCases.length > 0 && (
          <optgroup label={t("tree.loadCases")}>
            {loadCases.map(lc => (
              <option key={`lc-${lc.id}`} value={`lc:${lc.id}`}>{lc.name}</option>
            ))}
          </optgroup>
        )}
        {combinations.length > 0 && (
          <optgroup label={t("tree.combinations")}>
            {combinations.map(c => (
              <option key={`co-${c.id}`} value={`combo:${c.id}`}>{c.name}</option>
            ))}
          </optgroup>
        )}
        <optgroup label={t("tree.other")}>
          <option value="envelope">{t("tree.envelopeOption")}</option>
        </optgroup>
      </select>

      <div className="fem-results-toggle-list">
        {ROWS.map(row => {
          const uitgegrijsd = row.disabledReden !== undefined;
          // Een uitgegrijsde stand telt nooit als actief, ook niet als het
          // vinkje uit een eerdere sessie nog aan stond.
          const active = !uitgegrijsd && !!displayFlags[row.key];
          const scaleVal = row.scaleKey ? (Number(displayFlags[row.scaleKey] ?? 1)) : 1;
          return (
            <div key={row.key} className="fem-results-row">
              <button
                className={`fem-results-toggle${active ? " active" : ""}${uitgegrijsd ? " disabled" : ""}`}
                onClick={() => { if (!uitgegrijsd) toggle(row.key); }}
                disabled={uitgegrijsd}
                title={row.disabledReden ?? row.hint}
              >
                <span className="fem-results-toggle-swatch" style={{ background: row.swatch }} />
                <span className="fem-results-toggle-label">{row.label}</span>
                {/* Moderne schuifschakelaar i.p.v. AAN/uit-tekst */}
                <span className={`fem-switch${active ? " on" : ""}`} aria-hidden="true">
                  <span className="fem-switch-dot" />
                </span>
              </button>
              {/* Uitgegrijsd: de reden staat er ONDER, niet alleen in de
                  tooltip — anders moet de gebruiker raden waarom de stand
                  niet meedoet. */}
              {row.disabledReden && (
                <div className="fem-results-scale-row" title={row.disabledReden}>
                  <span style={{ fontSize: 10, color: "var(--theme-text-faint)" }}>
                    {row.disabledReden}
                  </span>
                </div>
              )}
              {row.scaleKey && active && (
                <div className="fem-results-scale-row" title={t("tree.scaleTitle")}>
                  <input
                    type="range"
                    className="fem-results-scale-slider"
                    min={0.1} max={5} step={0.1}
                    value={scaleVal}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setDisplayFlags(f => ({ ...f, [row.scaleKey as keyof DisplayFlags]: v }));
                    }}
                  />
                  <span className="fem-results-scale-value">{scaleVal.toFixed(1)}×</span>
                </div>
              )}
              {/* Knoopwaarden-subvinkje: per knoop een label met ux/uz in mm —
                  zelfde subrij-patroon als de reactie-componentkeuze. */}
              {row.key === "deflection" && active && (
                <div className="fem-results-scale-row" title={t("tree.nodeValuesTitle")}>
                  <label className="fem-results-subcheck">
                    <input
                      type="checkbox"
                      checked={displayFlags.knoopWaarden === true}
                      onChange={(e) => setDisplayFlags(f => ({ ...f, knoopWaarden: e.target.checked }))}
                    />
                    <span>{t("tree.nodeValues")}</span>
                  </label>
                </div>
              )}
              {/* Profielbreedte-subvinkje onder Aanzicht (issue #47): de maat
                  b bij het aanzicht — zelfde vlag als in het venster
                  Zichtbaarheid. */}
              {row.key === "aanzicht" && active && (
                <div className="fem-results-scale-row" title={t("zichtbaarheid.aanzichtBreedteHint")}>
                  <label className="fem-results-subcheck">
                    <input
                      type="checkbox"
                      checked={displayFlags.aanzichtBreedte === true}
                      onChange={(e) => setDisplayFlags(f => ({ ...f, aanzichtBreedte: e.target.checked }))}
                    />
                    <span>{t("zichtbaarheid.aanzichtBreedte")}</span>
                  </label>
                </div>
              )}
              {/* Unity-check zonder toetsresultaten: korte hint i.p.v. lege
                  badges. Twee oorzaken, twee teksten — hier stond één regel
                  ("voer eerst de toetsing uit"), ook wanneer de toetsing wél
                  had gedraaid en de rekenkern onbereikbaar bleek. Dat is de
                  browser zonder dev-brug, en dan wijst die regel naar een knop
                  die het niet oplost. De reden van de kern staat voluit in het
                  toetsingspaneel; hier past alleen de verwijzing ernaartoe. */}
              {row.key === "uc" && active && !hasCheckResults && (
                <div
                  className="fem-results-scale-row"
                  title={
                    checkFout
                      ? t("tree.checkRunFailedTitle", { fout: checkFout })
                      : t("tree.badgesAppearTitle")
                  }
                >
                  <span style={{ fontSize: 10, color: "var(--theme-text-faint)" }}>
                    {checkFout
                      ? t("tree.checkFailed")
                      : t("tree.runCheckFirst")}
                  </span>
                </div>
              )}
              {/* Plaatcontour-instellingen (P3.2): componentkeuze (von Mises
                  default) + mesh-lijnen-toggle — zelfde subrij-patroon als de
                  reactie-subcheckboxes hieronder. */}
              {row.key === "plaatContour" && active && (
                <div
                  className="fem-results-scale-row"
                  title={t("tree.plateComponentTitle")}
                >
                  <select
                    className="fem-results-scope-select"
                    style={{ flex: 1, minWidth: 0 }}
                    value={String(displayFlags.plaatComponent ?? "vonMises")}
                    onChange={(e) => setDisplayFlags(f => ({
                      ...f,
                      plaatComponent: e.target.value as DisplayFlags["plaatComponent"],
                    }))}
                  >
                    {Object.entries(PLAAT_COMPONENTEN).map(([k, v]) => (
                      <option key={k} value={k}>{v.label} ({v.eenheid})</option>
                    ))}
                  </select>
                  <label className="fem-results-subcheck">
                    <input
                      type="checkbox"
                      checked={displayFlags.plaatMesh === true}
                      onChange={(e) => setDisplayFlags(f => ({ ...f, plaatMesh: e.target.checked }))}
                    />
                    <span>{t("tree.mesh")}</span>
                  </label>
                </div>
              )}
              {/* Reactie-componentkeuze: X- en Z-pijlen apart schakelbaar.
                  Bij omhullende-weergave tonen de labels min…max. */}
              {row.key === "reactions" && active && (
                <div className="fem-results-scale-row" title={t("tree.reactionComponentsTitle")}>
                  {([["reactieX", "X"], ["reactieZ", "Z"]] as const).map(([k, lbl]) => (
                    <label key={k} className="fem-results-subcheck">
                      <input
                        type="checkbox"
                        checked={displayFlags[k] !== false}
                        onChange={(e) => setDisplayFlags(f => ({ ...f, [k]: e.target.checked }))}
                      />
                      <span>{lbl}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Extra toggles: extreme waarden + snedetekens + omhullende */}
      <div className="fem-results-section-title">{t("tree.options")}</div>
      <div className="fem-results-toggle-list">
        <button
          className={`fem-results-toggle${displayFlags.showExtremes ? " active" : ""}`}
          onClick={() => toggle("showExtremes")}
          title={t("tree.extremesTitle")}
        >
          <span className="fem-results-toggle-swatch" style={{ background: "#f59e0b" }} />
          <span className="fem-results-toggle-label">{t("tree.extremes")}</span>
          <span className={`fem-switch${displayFlags.showExtremes ? " on" : ""}`} aria-hidden="true">
            <span className="fem-switch-dot" />
          </span>
        </button>
        {/* Snedetekens. Standaard AAN, dus hier wordt niet op `!vlag` maar op
            `vlag === false` getoetst: een oudere toestand zonder dit veld hoort
            als AAN te lezen, niet als UIT. */}
        <button
          className={`fem-results-toggle${displayFlags.snedeTekens !== false ? " active" : ""}`}
          onClick={() => setDisplayFlags(f => ({ ...f, snedeTekens: f.snedeTekens === false }))}
          title={t("tree.signConventionTitle")}
        >
          <span className="fem-results-toggle-swatch" style={{ background: "#1d4ed8" }} />
          <span className="fem-results-toggle-label">{t("tree.signConvention")}</span>
          <span className={`fem-switch${displayFlags.snedeTekens !== false ? " on" : ""}`} aria-hidden="true">
            <span className="fem-switch-dot" />
          </span>
        </button>
        <button
          className={`fem-results-toggle${envelopeView ? " active" : ""}`}
          onClick={() => onSelectScope?.(envelopeView
            ? (loadCases.length > 0 ? { kind: "lc", id: activeLoadCaseId ?? loadCases[0].id } : { kind: "envelope" })
            : { kind: "envelope" })}
          title={t("tree.envelopeToggleTitle")}
        >
          <span className="fem-results-toggle-swatch" style={{ background: "#9333ea" }} />
          <span className="fem-results-toggle-label">{t("tree.envelopeToggle")}</span>
          <span className={`fem-switch${envelopeView ? " on" : ""}`} aria-hidden="true">
            <span className="fem-switch-dot" />
          </span>
        </button>
      </div>

      {!hasResults && (
        <div className="fem-results-hint">
          {t("tree.clickCalculateBefore")} <strong>{t("tree.calculate")}</strong> {t("tree.clickCalculateAfter")}
        </div>
      )}
    </div>
  );
}

/** Tekst met de zoekterm gemarkeerd (hoofdletterongevoelig). */
function Markeer({ tekst, zoek }: { tekst: string; zoek?: string }) {
  const q = zoek?.trim().toLowerCase();
  if (!q) return <>{tekst}</>;
  const delen: React.ReactNode[] = [];
  const laag = tekst.toLowerCase();
  let i = 0;
  for (let j = laag.indexOf(q); j >= 0; j = laag.indexOf(q, i)) {
    delen.push(<Fragment key={i}>{tekst.slice(i, j)}</Fragment>, <mark key={`m${j}`}>{tekst.slice(j, j + q.length)}</mark>);
    i = j + q.length;
  }
  delen.push(<Fragment key="rest">{tekst.slice(i)}</Fragment>);
  return <>{delen}</>;
}

function Leaf({ label, value, active, onClick, zoek }: LeafProps) {
  return (
    <div
      className={`fem-tree-leaf${active ? " active" : ""}${onClick ? " clickable" : ""}`}
      onClick={onClick}
    >
      <span className="fem-tree-leaf-label"><Markeer tekst={label} zoek={zoek} /></span>
      {value && <span className="fem-tree-leaf-value"><Markeer tekst={value} zoek={zoek} /></span>}
    </div>
  );
}

interface FemProjectTreeProps {
  nodes: Node[];
  beams: Beam[];
  supports: Support[];
  plates: Plate[];
  loads: Load[];
  loadCases: LoadCase[];
  activeLoadCaseId: number;
  selection: Selection;
  setSelection: (s: Selection) => void;
  setActiveLoadCaseId: (id: number) => void;
  addLoadCase: (name: string) => void;
  // Combinations + envelope (step 2d/2e)
  /** De VOLLEDIGE lijst — de overgeslagen combinaties staan er gedempt bij. */
  combinations: LoadCombination[];
  /**
   * Combinaties die dit model niet nodig heeft, met reden (zie
   * lib/combinatieSelectie). Ze blijven zichtbaar in de boom maar zijn niet
   * aanklikbaar: er zijn geen resultaten voor. Zonder deze lijst zou de
   * gebruiker zes combinaties zien waar hij er acht verwacht, zonder uitleg.
   */
  overgeslagenCombinaties?: OvergeslagenCombinatie[];
  /**
   * Belastinggevallen die in de doorgerekende combinaties niet meetellen
   * (lib/combinatieBeheer). Een geval met een fout staat rood in de boom:
   * zijn last telt dan in elke toets als nul.
   */
  belastingMeldingen?: GevalMelding[];
  /** Wat er bij het openen verder te melden was (wees-factoren e.d.); null = niets. */
  combinatieAfwijking?: CombinatieAfwijking | null;
  /** Wat er bij het openen aan combinaties is vervangen; null = niets. */
  combinatieVervanging?: CombinatieVervanging | null;
  /** Open het combinatievenster (voor de afwijkingsmelding). */
  onOpenCombinaties?: () => void;
  activeCombinationId: number | null;
  setActiveCombinationId: (id: number | null) => void;
  envelopeView: boolean;
  setEnvelopeView: (v: boolean) => void;
  envelope: Envelope | null;
  /** Display toggles for the canvas overlay — shown in the Resultaten tab. */
  displayFlags?: DisplayFlags;
  setDisplayFlags?: React.Dispatch<React.SetStateAction<DisplayFlags>>;
  /** True when any solver result is available — gates the toggle hint. */
  hasResults?: boolean;
  /** Optional controlled tab — when supplied, App.tsx drives which tab is open. */
  activeTab?: "project" | "view" | "results";
  setActiveTab?: (t: "project" | "view" | "results") => void;
  workspace?: "2d" | "3d";
  gridShow: boolean;
  setGridShow: (show: boolean) => void;
  stramienAan: boolean;
  setStramienAan: (show: boolean) => void;
  openFem3dVisibility: OpenFem3DVisibility;
  setOpenFem3DVisibility: (visibility: OpenFem3DVisibility) => void;
  /** Opent het venster Zichtbaarheid (issue #47): het tandwiel in de tab Weergave. */
  onOpenZichtbaarheid?: () => void;
}

export default function FemProjectTree(props: FemProjectTreeProps) {
  const {
    nodes, beams, supports, plates, loads,
    loadCases, activeLoadCaseId, selection,
    setSelection, setActiveLoadCaseId, addLoadCase,
    combinations, overgeslagenCombinaties = [],
    belastingMeldingen = [], combinatieAfwijking = null, combinatieVervanging = null, onOpenCombinaties,
    activeCombinationId, setActiveCombinationId,
    envelopeView, setEnvelopeView, envelope,
    displayFlags, setDisplayFlags, hasResults,
    activeTab, setActiveTab,
    workspace = "2d", gridShow, setGridShow, stramienAan, setStramienAan,
    openFem3dVisibility, setOpenFem3DVisibility, onOpenZichtbaarheid,
  } = props;
  const { t } = useTranslation("common");

  // Selectie op het canvas → de boom klapt de bijbehorende groep open en zet
  // de regel in beeld (met een korte oplichting). Een klik in de boom zelf
  // hoeft dat niet: de regel staat dan al in beeld.
  const bodyRef = useRef<HTMLDivElement>(null);
  const vanBoomRef = useRef(false);
  const [onthul, setOnthul] = useState<{ soort: string; n: number }>({ soort: "", n: 0 });
  const kiesUitBoom = (s: Selection) => { vanBoomRef.current = true; setSelection(s); };
  useEffect(() => {
    if (vanBoomRef.current) { vanBoomRef.current = false; return; }
    if (!selection || selection.type === "multi") return;
    setOnthul((o) => ({ soort: selection.type, n: o.n + 1 }));
  }, [selection]);
  useEffect(() => {
    if (!onthul.n) return;
    const id = requestAnimationFrame(() => {
      const el = bodyRef.current?.querySelector<HTMLElement>(".fem-tree-leaf.active");
      if (!el) return;
      el.scrollIntoView({ block: "nearest" });
      el.classList.remove("fem-tree-flits");
      void el.offsetWidth;
      el.classList.add("fem-tree-flits");
    });
    return () => cancelAnimationFrame(id);
  }, [onthul]);
  const onthulVoor = (soort: string) => (onthul.soort === soort ? onthul.n : 0);

  // Zoeken in de projectboom: met een zoekterm toont de tab alleen de treffers,
  // per groep, met de zoekterm gemarkeerd.
  const [zoek, setZoek] = useState("");
  const q = zoek.trim().toLowerCase();
  const past = (...teksten: (string | undefined)[]) => teksten.some((x) => !!x && x.toLowerCase().includes(q));
  /** Reden per overgeslagen combinatie-id; leeg = alles wordt doorgerekend. */
  const overgeslagenReden = new Map(
    overgeslagenCombinaties.map((o) => [o.id, o] as const),
  );
  /** De combinaties waar wél resultaten voor zijn — voor de resultaatkiezer. */
  const actieveCombinaties = combinations.filter((c) => !overgeslagenReden.has(c.id));
  const [internalTab, setInternalTab] = useState<"project" | "view" | "results">("project");
  // If controlled (activeTab supplied), use it; otherwise fall back to local.
  const tab    = activeTab    ?? internalTab;
  const setTab = setActiveTab ?? setInternalTab;
  /** governingCombinationId picked by envelope (for amber highlight). */
  const envelopeGoverningIds = envelope
    ? new Set(Array.from(envelope.elements.values()).map(v => v.governingCombinationId))
    : new Set<number>();

  const supportTypeLabel: Record<string, string> = {
    pinned: t("tree.support.pinned"), fixed: t("tree.support.fixed"),
    xRoller: t("tree.support.xRoller"), zRoller: t("tree.support.zRoller"),
    zSpring: t("tree.support.zSpring"), xSpring: t("tree.support.xSpring"), rotSpring: t("tree.support.rotSpring"),
  };

  // ── Materialen/profielen in gebruik — afgeleid uit de staven ────────────
  // Zelfde defaults als de solver-route (resolveSection): geen materiaal →
  // S235, geen profiel → HEA 160. Klikken selecteert de staven die het
  // materiaal/profiel gebruiken (multi-selectie, zoals shift-klik op canvas).
  const materialUse = new Map<string, number[]>();
  const profileUse = new Map<string, number[]>();
  for (const b of beams) {
    const mat = b.material ?? "S235";
    if (!materialUse.has(mat)) materialUse.set(mat, []);
    materialUse.get(mat)!.push(b.id);
    // De DOORSNEDE van een staaf, niet alleen haar beginprofiel: een
    // verlopende staaf heet hier "IPE 300 → IPE 200 (verlopend)" en staat dus
    // op een eigen regel. Zou hij onder "IPE 300" mee geteld worden, dan zou
    // deze lijst — de doorsnedelegenda van het model — twee wezenlijk
    // verschillende doorsneden als één tonen.
    const prof = doorsnedeNaamVertaald(b, t) || "HEA160";
    if (!profileUse.has(prof)) profileUse.set(prof, []);
    profileUse.get(prof)!.push(b.id);
  }
  const sortedMaterials = Array.from(materialUse.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  const sortedProfiles = Array.from(profileUse.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

  const selectBeamSet = (ids: number[]) => {
    if (ids.length === 1) kiesUitBoom({ type: "beam", id: ids[0] });
    else kiesUitBoom({ type: "multi", nodeIds: [], beamIds: ids, plateIds: [] });
  };
  const isBeamSetSelected = (ids: number[]) => {
    if (selection?.type === "beam") return ids.length === 1 && selection.id === ids[0];
    if (selection?.type === "multi") {
      return (
        selection.nodeIds.length === 0 &&
        selection.plateIds.length === 0 &&
        selection.beamIds.length === ids.length &&
        ids.every((id) => selection.beamIds.includes(id))
      );
    }
    return false;
  };

  return (
    <div className="fem-project-tree">
      {/* Tabs */}
      <div className="fem-tree-tabs">
        {workspace === "2d" && <button className={`fem-tree-tab${tab === "project" ? " active" : ""}`} onClick={() => setTab("project")}>{t("tree.projectTab")}</button>}
        <button className={`fem-tree-tab${tab === "view" ? " active" : ""}`} onClick={() => setTab("view")}>{t("tree.viewTab")}</button>
        {workspace === "2d" && <button className={`fem-tree-tab${tab === "results" ? " active" : ""}`} onClick={() => setTab("results")}>{t("tree.resultsTab")}</button>}
      </div>

      {/* Tree */}
      <div className="fem-tree-body" ref={bodyRef}>
        {tab === "view" ? (
          displayFlags && setDisplayFlags ? (
            <ExplorerViewTab
              displayFlags={displayFlags}
              setDisplayFlags={setDisplayFlags}
              gridShow={gridShow}
              setGridShow={setGridShow}
              stramienAan={stramienAan}
              setStramienAan={setStramienAan}
              openFem3dVisibility={openFem3dVisibility}
              setOpenFem3DVisibility={setOpenFem3DVisibility}
              workspace={workspace}
              onOpenZichtbaarheid={onOpenZichtbaarheid}
            />
          ) : null
        ) : tab === "project" ? (
          <>
            <div className="fem-tree-zoek">
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
              <input
                value={zoek}
                onChange={(e) => setZoek(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setZoek(""); }}
                placeholder={t("tree.search.placeholder")}
                aria-label={t("tree.search.label")}
              />
              {zoek && (
                <button className="fem-tree-zoek-wis" aria-label={t("tree.search.clear")} onClick={() => setZoek("")}>×</button>
              )}
            </div>
            {q ? (() => {
              const kn = nodes.filter((n) => past(t("tree.nodeLabel", { id: n.id }), `X:${n.x} Z:${n.z}`));
              const st = beams.filter((b) => past(t("tree.barLabel", { id: b.id }), `${b.from}-${b.to}`, doorsnedeNaamVertaald(b, t) || "HEA160", b.material ?? "S235"));
              const op = supports.filter((s) => past(t("tree.nodeLabel", { id: s.nodeId }), supportTypeLabel[s.type] ?? s.type));
              const pl = plates.filter((p) => past(t("tree.plateLabel", { id: p.id })));
              const ma = sortedMaterials.filter(([m]) => past(m));
              const pr = sortedProfiles.filter(([p]) => past(p));
              const lc = loadCases.filter((c) => past(c.name));
              const co = combinations.filter((c) => past(c.name));
              const totaal = kn.length + st.length + op.length + pl.length + ma.length + pr.length + lc.length + co.length;
              if (totaal === 0) return <div className="fem-tree-zoek-leeg">{t("tree.search.none", { q: zoek.trim() })}</div>;
              return (
                <>
                  {kn.length > 0 && <TreeNode label={t("tree.nodes")} count={kn.length} defaultOpen>
                    {kn.map((n) => <Leaf key={`zn${n.id}`} zoek={q} label={t("tree.nodeLabel", { id: n.id })} value={`X:${n.x} Z:${n.z}`}
                      active={selection?.type === "node" && selection.id === n.id} onClick={() => kiesUitBoom({ type: "node", id: n.id })} />)}
                  </TreeNode>}
                  {st.length > 0 && <TreeNode label={t("tree.elements")} count={st.length} defaultOpen>
                    {st.map((b) => {
                      const prof = doorsnedeNaamVertaald(b, t) || "HEA160";
                      const mat = b.material ?? "S235";
                      const waarde = past(prof) ? prof : past(mat) ? mat : `${b.from}-${b.to}`;
                      return <Leaf key={`zb${b.id}`} zoek={q} label={t("tree.barLabel", { id: b.id })} value={waarde}
                        active={selection?.type === "beam" && selection.id === b.id} onClick={() => kiesUitBoom({ type: "beam", id: b.id })} />;
                    })}
                  </TreeNode>}
                  {op.length > 0 && <TreeNode label={t("tree.supports")} count={op.length} defaultOpen>
                    {op.map((s) => <Leaf key={`zs${s.nodeId}`} zoek={q} label={t("tree.nodeLabel", { id: s.nodeId })} value={supportTypeLabel[s.type] ?? s.type}
                      onClick={() => kiesUitBoom({ type: "node", id: s.nodeId })} />)}
                  </TreeNode>}
                  {pl.length > 0 && <TreeNode label={t("tree.plates")} count={pl.length} defaultOpen>
                    {pl.map((p) => <Leaf key={`zp${p.id}`} zoek={q} label={t("tree.plateLabel", { id: p.id })} value={t("tree.corners", { count: p.nodeIds.length })}
                      active={selection?.type === "plate" && selection.id === p.id} onClick={() => kiesUitBoom({ type: "plate", id: p.id })} />)}
                  </TreeNode>}
                  {ma.length > 0 && <TreeNode label={t("tree.materials")} count={ma.length} defaultOpen>
                    {ma.map(([m, ids]) => <Leaf key={`zm${m}`} zoek={q} label={m} value={t("tree.barCount", { count: ids.length })}
                      active={isBeamSetSelected(ids)} onClick={() => selectBeamSet(ids)} />)}
                  </TreeNode>}
                  {pr.length > 0 && <TreeNode label={t("tree.profiles")} count={pr.length} defaultOpen>
                    {pr.map(([p, ids]) => <Leaf key={`zpr${p}`} zoek={q} label={p} value={t("tree.barCount", { count: ids.length })}
                      active={isBeamSetSelected(ids)} onClick={() => selectBeamSet(ids)} />)}
                  </TreeNode>}
                  {lc.length > 0 && <TreeNode label={t("tree.loads")} count={lc.length} defaultOpen>
                    {lc.map((c) => <Leaf key={`zl${c.id}`} zoek={q} label={c.name} active={c.id === activeLoadCaseId}
                      onClick={() => setActiveLoadCaseId(c.id)} />)}
                  </TreeNode>}
                  {co.length > 0 && <TreeNode label={t("tree.combinations")} count={co.length} defaultOpen>
                    {co.map((c) => <Leaf key={`zc${c.id}`} zoek={q} label={c.name} active={!envelopeView && c.id === activeCombinationId}
                      onClick={() => { setActiveCombinationId(c.id); setEnvelopeView(false); }} />)}
                  </TreeNode>}
                </>
              );
            })() : (
            <>
            <TreeNode label={t("tree.model")} defaultOpen onthul={onthul.n} icon={<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12v12H2z" opacity="0.2"/><path d="M2 2h12v12H2zM2 8h12M8 2v12" fill="none" stroke="currentColor" strokeWidth="1"/></svg>}>
              <TreeNode label={t("tree.nodes")} count={nodes.length} defaultOpen onthul={onthulVoor("node")} icon={<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="5" cy="5" r="2.5" /></svg>}>
                {nodes.map(n => (
                  <Leaf
                    key={`tn${n.id}`}
                    label={t("tree.nodeLabel", { id: n.id })}
                    value={`X:${n.x} Z:${n.z}`}
                    active={selection?.type === "node" && selection.id === n.id}
                    onClick={() => kiesUitBoom({ type: "node", id: n.id })}
                  />
                ))}
              </TreeNode>
              <TreeNode label={t("tree.elements")} count={beams.length} defaultOpen onthul={onthulVoor("beam")} icon={<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="1" y1="5" x2="9" y2="5" /></svg>}>
                {beams.map(b => (
                  <Leaf
                    key={`tb${b.id}`}
                    label={t("tree.barLabel", { id: b.id })}
                    value={`${b.from}-${b.to}`}
                    active={selection?.type === "beam" && selection.id === b.id}
                    onClick={() => kiesUitBoom({ type: "beam", id: b.id })}
                  />
                ))}
              </TreeNode>
              <TreeNode label={t("tree.supports")} count={supports.length} icon={<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><polygon points="5,1 1,9 9,9" /></svg>}>
                {supports.map(s => (
                  <Leaf
                    key={`ts${s.nodeId}`}
                    label={t("tree.nodeLabel", { id: s.nodeId })}
                    value={supportTypeLabel[s.type] ?? s.type}
                    onClick={() => kiesUitBoom({ type: "node", id: s.nodeId })}
                  />
                ))}
              </TreeNode>
              {plates.length > 0 && (
                <TreeNode label={t("tree.plates")} count={plates.length} onthul={onthulVoor("plate")} icon={<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1.5" y="1.5" width="7" height="7" /></svg>}>
                  {plates.map(p => (
                    <Leaf
                      key={`tp${p.id}`}
                      label={t("tree.plateLabel", { id: p.id })}
                      value={t("tree.corners", { count: p.nodeIds.length })}
                      active={selection?.type === "plate" && selection.id === p.id}
                      onClick={() => kiesUitBoom({ type: "plate", id: p.id })}
                    />
                  ))}
                </TreeNode>
              )}
              <TreeNode label={t("tree.materials")} count={sortedMaterials.length} icon={<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="1" width="8" height="8" rx="1" /></svg>}>
                {sortedMaterials.map(([mat, ids]) => (
                  <Leaf
                    key={`mat-${mat}`}
                    label={mat}
                    value={t("tree.barCount", { count: ids.length })}
                    active={isBeamSetSelected(ids)}
                    onClick={() => selectBeamSet(ids)}
                  />
                ))}
                {sortedMaterials.length === 0 && (
                  <div className="fem-tree-leaf" style={{ fontStyle: "italic", opacity: 0.7 }}>
                    <span className="fem-tree-leaf-label">{t("tree.noBars")}</span>
                  </div>
                )}
                <TreeNode label={t("tree.availableGrades")} count={STEEL_GRADES.length + SUPPORTED_TIMBER_GRADES.length}>
                  {STEEL_GRADES.map((g) => (
                    <Leaf key={`avail-${g}`} label={g} value={t("tree.steel")} />
                  ))}
                  {SUPPORTED_TIMBER_GRADES.map((g) => (
                    <Leaf key={`avail-${g}`} label={g} value={t("tree.timber")} />
                  ))}
                </TreeNode>
              </TreeNode>
              <TreeNode label={t("tree.profiles")} count={sortedProfiles.length} icon={<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 1h6M5 1v8M2 9h6" /></svg>}>
                {sortedProfiles.map(([prof, ids]) => (
                  <Leaf
                    key={`prof-${prof}`}
                    label={prof}
                    value={t("tree.barCount", { count: ids.length })}
                    active={isBeamSetSelected(ids)}
                    onClick={() => selectBeamSet(ids)}
                  />
                ))}
                {sortedProfiles.length === 0 && (
                  <div className="fem-tree-leaf" style={{ fontStyle: "italic", opacity: 0.7 }}>
                    <span className="fem-tree-leaf-label">{t("tree.noBars")}</span>
                  </div>
                )}
              </TreeNode>
            </TreeNode>

            <TreeNode label={t("tree.loads")} defaultOpen icon={<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l-3 3h2v8h2V4h2z"/></svg>}>
              {belastingMeldingen.filter((m) => m.caseId === null).map((m, i) => (
                <div
                  key={`lcm${i}`}
                  className={`fem-tree-leaf fem-tree-melding-fout${m.vervangAdvies ? " clickable" : ""}`}
                  title={m.tekst}
                  onClick={m.vervangAdvies ? () => onOpenCombinaties?.() : undefined}
                >
                  <span className="fem-tree-leaf-label">⚠ {m.kop ? vertaal(t, m.kop) : m.tekst.split(". ")[0]}.</span>
                </div>
              ))}
              {loadCases.map(lc => {
                const count = loads.filter(l => l.caseId === lc.id).length;
                const isActive = lc.id === activeLoadCaseId;
                // Een fout = de last van dit geval telt nergens mee. Rood, met de
                // volledige uitleg als tooltip — nooit stil.
                const meldingen = belastingMeldingen.filter((m) => m.caseId === lc.id);
                const fout = meldingen.find((m) => m.niveau === "fout");
                const waarschuwing = meldingen.find((m) => m.niveau === "waarschuwing");
                return (
                  <div
                    key={`lc${lc.id}`}
                    className={`fem-tree-leaf clickable${isActive ? " active" : ""}${fout ? " fem-tree-melding-fout" : ""}`}
                    onClick={() => setActiveLoadCaseId(lc.id)}
                    title={(fout ?? waarschuwing)?.tekst}
                  >
                    <span className="fem-tree-leaf-label">
                      {isActive && <span style={{ color: "var(--theme-accent)", marginRight: 4 }}>●</span>}
                      {(fout || waarschuwing) && <span style={{ marginRight: 4 }}>⚠</span>}
                      {lc.name}
                      {fout && lc.type === "other" && ` — ${t("tree.chooseType")}`}
                      {fout && lc.type !== "other" &&
                        (/draagt factoren die niet/.test(fout.tekst) ? ` — ${t("tree.wrongFactors")}` : ` — ${t("tree.notCounted")}`)}
                    </span>
                    <span className="fem-tree-leaf-value">{count}</span>
                  </div>
                );
              })}
              <div
                className="fem-tree-leaf clickable"
                style={{ color: "var(--theme-accent)", fontStyle: "italic" }}
                onClick={() => addLoadCase(t("loadCases.defaultCaseName", { n: loadCases.length + 1 }))}
              >
                <span className="fem-tree-leaf-label">+ {t("tree.newLoadCase")}</span>
              </div>
            </TreeNode>

            <TreeNode label={t("tree.combinations")} count={combinations.length} defaultOpen icon={<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M2 8h12M2 12h12" /></svg>}>
              {combinatieVervanging && (
                <div
                  className="fem-tree-leaf clickable"
                  title={combinatieVervanging.samenvatting}
                  onClick={() => onOpenCombinaties?.()}
                >
                  <span className="fem-tree-leaf-label">
                    ↻ {t("tree.replacedOnOpen")}
                  </span>
                </div>
              )}
              {combinatieAfwijking && (
                <div
                  className="fem-tree-leaf clickable fem-tree-melding-fout"
                  title={combinatieAfwijking.samenvatting}
                  onClick={() => onOpenCombinaties?.()}
                >
                  <span className="fem-tree-leaf-label">
                    ⚠ {t("tree.noticeOnOpen")}
                  </span>
                </div>
              )}
              {/* Envelope header — click to view envelope across all combos */}
              <div
                className={`fem-tree-leaf clickable${envelopeView ? " active" : ""}`}
                onClick={() => {
                  setEnvelopeView(!envelopeView);
                  if (!envelopeView) setActiveCombinationId(null);
                }}
                title={t("tree.envelopeLeafTitle")}
              >
                <span className="fem-tree-leaf-label" style={{ fontWeight: 600 }}>
                  {envelopeView && <span style={{ color: "var(--theme-accent)", marginRight: 4 }}>●</span>}
                  {t("tree.envelopeLeaf")}
                </span>
                <span
                  className="fem-tree-leaf-value"
                  style={{
                    background: "var(--theme-accent)",
                    color: "var(--theme-bg)",
                    padding: "1px 6px",
                    borderRadius: 2,
                    fontSize: 9,
                    fontWeight: 600,
                  }}
                >
                  MAX
                </span>
              </div>
              {combinations.map(c => {
                // Overgeslagen combinatie: blijft staan (anders verdwijnt hij
                // zonder uitleg), maar gedempt en niet aanklikbaar — er zijn
                // geen resultaten voor. De reden staat in de tooltip.
                const overgeslagen = overgeslagenReden.get(c.id);
                const isActive = !overgeslagen && !envelopeView && c.id === activeCombinationId;
                const isGoverning = !overgeslagen && envelopeView && envelopeGoverningIds.has(c.id);
                return (
                  <div
                    key={`combo${c.id}`}
                    className={`fem-tree-leaf${overgeslagen ? "" : " clickable"}${isActive ? " active" : ""}`}
                    onClick={overgeslagen ? undefined : () => {
                      setActiveCombinationId(c.id);
                      setEnvelopeView(false);
                    }}
                    title={overgeslagen ? overgeslagen.reden : c.formula}
                    style={
                      overgeslagen
                        ? { opacity: 0.5, cursor: "help" }
                        : isGoverning
                          ? { background: "rgba(255, 176, 0, 0.15)" }
                          : undefined
                    }
                  >
                    <span className="fem-tree-leaf-label">
                      {isActive && <span style={{ color: "var(--theme-accent)", marginRight: 4 }}>●</span>}
                      {isGoverning && <span style={{ color: "#ffb000", marginRight: 4 }} title={t("tree.governingTitle")}>★</span>}
                      {overgeslagen ? <s>{c.name}</s> : c.name}
                    </span>
                    <span
                      className="fem-tree-leaf-value"
                      style={{
                        background: overgeslagen
                          ? "transparent"
                          : c.type === "uls" ? "var(--theme-accent)" : "var(--theme-text-faint)",
                        color: overgeslagen ? "var(--theme-text-faint)" : "var(--theme-bg)",
                        padding: "1px 5px",
                        borderRadius: 2,
                        fontSize: 9,
                        fontWeight: 600,
                      }}
                    >
                      {overgeslagen ? vertaal(t, overgeslagen.labelTekst) : c.type === "uls" ? "U" : "S"}
                    </span>
                  </div>
                );
              })}
            </TreeNode>
            {/* De "Versies"-knoop is verwijderd: er bestaat (nog) geen
                versie-/snapshotsysteem in de app, dus de knoop was schijn-UI. */}
            </>
            )}
          </>
        ) : (
          <ResultsTab
            displayFlags={displayFlags}
            setDisplayFlags={setDisplayFlags}
            hasResults={hasResults ?? false}
            hasPlates={plates.length > 0}
            loadCases={loadCases}
            activeLoadCaseId={activeLoadCaseId}
            combinations={actieveCombinaties}
            activeCombinationId={activeCombinationId}
            envelopeView={envelopeView}
            onSelectScope={(scope) => {
              if (scope.kind === "envelope") {
                setEnvelopeView?.(true);
                setActiveCombinationId?.(null);
              } else if (scope.kind === "combo") {
                setEnvelopeView?.(false);
                setActiveCombinationId?.(scope.id);
              } else if (scope.kind === "lc") {
                setEnvelopeView?.(false);
                setActiveCombinationId?.(null);
                setActiveLoadCaseId(scope.id);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

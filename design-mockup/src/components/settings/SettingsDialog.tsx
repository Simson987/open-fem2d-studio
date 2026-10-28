import { useState, useEffect, useRef, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { LANGUAGES, changeLanguage } from "../../i18n/config";
import { getSetting, setSetting } from "../../store";
import {
  SOLVER_PREFERENCE_KEY,
  SOLVER_REGISTRY,
  normaliseSolverPreference,
  type SolverPreference,
} from "../../core/solver/SolverRegistry";
import Modal from "../Modal";
import ThemedSelect from "../ThemedSelect";
import AiAssistentPaneel from "./AiAssistentPaneel";
import "../ThemedSelect.css";
import "./SettingsDialog.css";

const THEME_OPTIONS = [
  { value: "light",               labelKey: "appearance.light",             swatches: ["#F1EEEA", "#FFFFFF", "#D97706", "#2A2A32"] },
  { value: "dark",                labelKey: "appearance.dark",              swatches: ["#2A2A32", "#33333C", "#D97706", "#EDEBE8"] },
  { value: "blueprint",           labelKey: "appearance.blueprint",         swatches: ["#0A1320", "#0F1B2D", "#60A5FA", "#E0E7FF"] },
  { value: "high-contrast-dark",  labelKey: "appearance.highContrastDark",  swatches: ["#000000", "#000000", "#F59E0B", "#FFFFFF"] },
  { value: "high-contrast-light", labelKey: "appearance.highContrastLight", swatches: ["#FFFFFF", "#FFFFFF", "#92400E", "#000000"] },
];

/** De vijf thema's van ontwerp 0.4 (OpenAEC Blueprint). */
export const THEMA_IDS = THEME_OPTIONS.map((o) => o.value);

/** The 0.4 theme for a saved value, also for the names of earlier versions. */
export function themeId(theme?: string): string {
  const earlier: Record<string, string> = { forge: "dark", openaec: "dark", contrast: "high-contrast-dark" };
  const id = earlier[theme ?? ""] ?? theme ?? "light";
  return THEME_OPTIONS.some((o) => o.value === id) ? id : "light";
}

/* ─── Tab configuratie ──────────────────────────────────────
   Pas deze array aan voor jouw project.
   Voeg domein-specifieke tabs toe, verwijder wat je niet nodig hebt.

   Voorbeeld met domein-tab:
     const TAB_IDS = ["general", "appearance", "calculation", "about"] as const;
   ─────────────────────────────────────────────────────────── */
// "aiAssistant": Instellingen → AI-assistent (MCP) (issue #109). Dat tabblad
// werkt meteen (schakelaar, koppelknop) en doet niet mee met Opslaan/Annuleren.
const TAB_IDS = ["general", "appearance", "calculation", "aiAssistant", "about"] as const;
export type SettingsTabId = (typeof TAB_IDS)[number];

export function applyTheme(theme?: string) {
  document.documentElement.setAttribute("data-oa-theme", themeId(theme));
}

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  theme: string;
  onThemeChange: (theme: string) => void;
  /** Open op dit tabblad (bijv. "aiAssistant" vanaf het lint); zonder: het laatst gebruikte. */
  initialTab?: SettingsTabId;
}

export default function SettingsDialog({
  open,
  onClose,
  theme,
  onThemeChange,
  initialTab,
}: SettingsDialogProps) {
  const { t } = useTranslation("settings");
  const { t: tCommon } = useTranslation("common");
  const [activeTab, setActiveTab] = useState<string>("general");
  // Geopend met een tabblad (het lint: Instellingen → AI-assistent (MCP)).
  useEffect(() => {
    if (open && initialTab) setActiveTab(initialTab);
  }, [open, initialTab]);

  // Draft state — only committed on Save
  const [draftTheme, setDraftTheme] = useState(theme);
  const [draftLang, setDraftLang] = useState("auto");
  const [draftSolver, setDraftSolver] = useState<SolverPreference>("automatic");
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  // Snapshot of original values when dialog opens, for reverting on Cancel
  const originalTheme = useRef(theme);
  const originalLang = useRef("");
  const originalSolver = useRef<SolverPreference>("automatic");

  // Reset draft to current values when dialog opens
  useEffect(() => {
    if (open) {
      originalTheme.current = theme;
      setDraftTheme(theme);
      getSetting("language", "auto").then((lang) => {
        originalLang.current = lang;
        setDraftLang(lang);
      });
      getSetting<unknown>(SOLVER_PREFERENCE_KEY, "automatic").then((stored) => {
        const solver = normaliseSolverPreference(stored);
        originalSolver.current = solver;
        setDraftSolver(solver);
      });
    }
  }, [open, theme]);

  // Live theme preview — apply immediately when the user picks one in the dropdown.
  // Saved only on Save; reverted on Cancel.
  const handleThemePreview = (value: string) => {
    setDraftTheme(value);
    applyTheme(value);
  };

  // Live language preview — switch i18n immediately on selection.
  const handleLangPreview = (value: string) => {
    setDraftLang(value);
    changeLanguage(value);
  };

  // Cancel — discard all draft changes, revert live preview
  const handleCancel = () => {
    setDraftTheme(originalTheme.current);
    applyTheme(originalTheme.current);
    setDraftLang(originalLang.current);
    changeLanguage(originalLang.current);
    setDraftSolver(originalSolver.current);
    onClose();
  };

  // Save — commit all draft changes
  const handleSave = () => {
    onThemeChange(draftTheme);
    applyTheme(draftTheme);
    setSetting("theme", draftTheme);

    setSetting("language", draftLang);
    changeLanguage(draftLang);

    setSetting(SOLVER_PREFERENCE_KEY, draftSolver);

    onClose();
  };

  // Reset to defaults — resets draft values (still requires Save to apply)
  const handleReset = () => {
    setConfirmResetOpen(true);
  };

  const handleConfirmReset = () => {
    setDraftTheme("light");
    applyTheme("light");
    setDraftLang("auto");
    changeLanguage("auto");
    setDraftSolver("automatic");
    setConfirmResetOpen(false);
  };

  const footer = (
    <>
      <button className="settings-btn settings-btn-secondary" onClick={handleReset}>
        {t("resetToDefaults")}
      </button>
      <div className="settings-footer-right">
        <button className="settings-btn settings-btn-secondary" onClick={handleCancel}>
          {tCommon("cancel")}
        </button>
        <button className="settings-btn settings-btn-primary" onClick={handleSave}>
          {tCommon("save")}
        </button>
      </div>
    </>
  );

  return (
    <>
    <Modal open={open} onClose={handleCancel} title={t("title")} width={560} height={500} className="settings-dialog" footer={footer}>
      <div className="settings-body">
        <div className="settings-sidebar">
          {TAB_IDS.map((id) => (
            <button
              key={id}
              className={`settings-tab${activeTab === id ? " active" : ""}`}
              onClick={() => setActiveTab(id)}
            >
              {t(`tabs.${id}`)}
            </button>
          ))}
        </div>

        <div className="settings-content">
          {activeTab === "general" && (
            <GeneralTabContent lang={draftLang} onLangChange={handleLangPreview} />
          )}
          {activeTab === "appearance" && (
            <AppearanceTabContent theme={draftTheme} onThemeSelect={handleThemePreview} />
          )}
          {activeTab === "calculation" && (
            <CalculationTabContent solver={draftSolver} onSolverChange={setDraftSolver} />
          )}
          {activeTab === "aiAssistant" && <AiAssistentPaneel />}
          {activeTab === "about" && <AboutTabContent />}
        </div>
      </div>
    </Modal>

    <Modal
      open={confirmResetOpen}
      onClose={() => setConfirmResetOpen(false)}
      title={t("resetToDefaults")}
      width={340}
      footer={
        <>
          <button className="settings-btn settings-btn-secondary" onClick={() => setConfirmResetOpen(false)}>
            {tCommon("cancel")}
          </button>
          <button className="settings-btn settings-btn-primary" onClick={handleConfirmReset}>
            {t("resetToDefaults")}
          </button>
        </>
      }
    >
      <div style={{ padding: 12, fontSize: 12 }}>{t("resetConfirm")}</div>
    </Modal>
    </>
  );
}

function CalculationTabContent({
  solver,
  onSolverChange,
}: {
  solver: SolverPreference;
  onSolverChange: (solver: SolverPreference) => void;
}) {
  const { t } = useTranslation("settings");
  const selected = solver === "automatic"
    ? null
    : SOLVER_REGISTRY.find((entry) => entry.id === solver) ?? null;

  return (
    <div className="settings-section">
      <h3>{t("calculation.engine")}</h3>
      <div className="settings-row settings-row-stacked">
        <label className="settings-label" htmlFor="settings-solver-select">
          {t("calculation.solver")}
        </label>
        <select
          id="settings-solver-select"
          className="settings-select settings-solver-select"
          value={solver}
          onChange={(event) => onSolverChange(event.target.value as SolverPreference)}
        >
          <option value="automatic">{t("calculation.automatic")}</option>
          {SOLVER_REGISTRY.map((entry) => (
            <option key={entry.id} value={entry.id} disabled={!entry.available}>
              {entry.name}{entry.available ? "" : ` — ${t("calculation.unavailable")}`}
            </option>
          ))}
        </select>
      </div>
      <p className="settings-description settings-solver-explanation">
        {solver === "automatic"
          ? t("calculation.automaticDescription")
          : t("calculation.manualDescription", { solver: selected?.name ?? solver })}
      </p>

      <div className="settings-solver-list">
        {SOLVER_REGISTRY.map((entry) => (
          <div key={entry.id} className={`settings-solver-card${entry.available ? "" : " unavailable"}`}>
            <div className="settings-solver-card-title">
              <strong>{entry.name}</strong>
              <span className={`settings-solver-status ${entry.available ? "available" : "unavailable"}`}>
                {t(entry.available ? "calculation.available" : "calculation.unavailable")}
              </span>
            </div>
            <div className="settings-solver-meta">
              {t("calculation.license")}: {entry.license} · {t("calculation.version")}: {entry.version}
            </div>
            <div className="settings-solver-meta">
              {t("calculation.supports")}: {entry.capabilities.dimensions.join(", ")} · {entry.capabilities.analyses.map((kind) => t(`calculation.analysis.${kind}`)).join(", ")} · {entry.capabilities.elementFamilies.map((family) => t(`calculation.elements.${family}`)).join(", ")}
            </div>
            {!entry.available && (
              <div className="settings-solver-note">{t("calculation.adapterPending")}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── General Tab ───────────────────────────────────────────
   Taalselectie werkt out-of-the-box.
   Pas de overige secties aan of verwijder ze naar behoefte.
   ─────────────────────────────────────────────────────────── */
function GeneralTabContent({
  lang,
  onLangChange,
}: {
  lang: string;
  onLangChange: (value: string) => void;
}) {
  const { t } = useTranslation("settings");

  return (
    <div className="settings-section">
      <h3>{t("general.application")}</h3>
      <div className="settings-row">
        <span className="settings-label">{t("general.language")}</span>
        <ThemedSelect
          value={lang}
          options={LANGUAGES.map((l) => ({ value: l.code, label: l.name }))}
          onChange={onLangChange}
          style={{ width: 180 }}
        />
      </div>
    </div>
  );
}

/* ─── Appearance Tab ────────────────────────────────────────
   Themaselectie werkt out-of-the-box.
   ─────────────────────────────────────────────────────────── */
function AppearanceTabContent({
  theme,
  onThemeSelect,
}: {
  theme: string;
  onThemeSelect: (value: string) => void;
}) {
  const { t } = useTranslation("settings");
  return (
    <div className="settings-section">
      <h3>{t("appearance.theme")}</h3>
      <ThemeDropdown theme={theme} onThemeSelect={onThemeSelect} />
    </div>
  );
}

function ThemeDropdown({
  theme,
  onThemeSelect,
}: {
  theme: string;
  onThemeSelect: (value: string) => void;
}) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const selected = THEME_OPTIONS.find((o) => o.value === theme) || THEME_OPTIONS[0];

  const swatchRow = (swatches: string[]) => (
    <div className="theme-dropdown-swatches">
      {swatches.map((color, i) => (
        <span key={i} className="theme-dropdown-swatch" style={{ backgroundColor: color } as CSSProperties} />
      ))}
    </div>
  );

  return (
    <div className="theme-dropdown" ref={ref}>
      <button className="theme-dropdown-trigger" onClick={() => setOpen(!open)}>
        {swatchRow(selected.swatches)}
        <span className="theme-dropdown-label">{t(selected.labelKey)}</span>
        <svg className="theme-dropdown-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="theme-dropdown-menu">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`theme-dropdown-item${theme === opt.value ? " active" : ""}`}
              onClick={() => { onThemeSelect(opt.value); setOpen(false); }}
            >
              {swatchRow(opt.swatches)}
              <span className="theme-dropdown-label">{t(opt.labelKey)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── About Tab ───────────────────────────────────────────────
// Pas naam, versie en beschrijving aan via i18n keys
// in locales/{lang}/settings.json, sectie "about"
// ─────────────────────────────────────────────────────────────
function AboutTabContent() {
  const { t } = useTranslation("settings");
  return (
    <div className="settings-section">
      <h3>{t("about.appName")}</h3>
      <div style={{ fontSize: 11, lineHeight: 1.8 }}>
        <p><strong>{t("about.version")}:</strong> 0.1.0</p>
        <p><strong>{t("about.framework")}:</strong> Tauri + React + TypeScript</p>
        <p><strong>{t("about.license")}:</strong> MIT</p>
        <p style={{ marginTop: 8, color: "var(--theme-dialog-content-secondary)" }}>
          {t("about.description")}
        </p>
      </div>
    </div>
  );
}

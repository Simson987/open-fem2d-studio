import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";
import RibbonButtonStack from "./RibbonButtonStack";
import { changeLanguage } from "../../i18n/config";
import { setSetting } from "../../store";
import {
  projectInfoIcon,
  materialsIcon,
  sectionsIcon,
  calcSettingsIcon,
  themeSunIcon,
  themeMoonIcon,
  languageIcon,
  aiAssistantIcon,
} from "./icons";

interface SettingsTabProps {
  onSettingsClick?: () => void;
  onProjectSettingsClick?: () => void;
  /** Actieve app-thema — bepaalt de active-markering op de themaknoppen. */
  theme?: string;
  /** Themawissel (direct toepassen + persist) — geleverd door App via Ribbon. */
  onThemeSelect?: (theme: string) => void;
  /** Open de alleen-lezen bibliotheek-dialoog op het gegeven tabblad. */
  onOpenLibrary?: (tab: "sections" | "materials") => void;
  /** Open Instellingen op het tabblad AI-assistent (MCP) (issue #109). */
  onOpenAiAssistant?: () => void;
}

export default function SettingsTab({
  onSettingsClick, onProjectSettingsClick,
  theme, onThemeSelect, onOpenLibrary, onOpenAiAssistant,
}: SettingsTabProps) {
  const { t, i18n } = useTranslation("ribbon");
  // Actieve taal — resolvedLanguage vangt varianten als "en-US" af.
  const activeLang = (i18n.resolvedLanguage ?? i18n.language ?? "en").split("-")[0];

  // Taalwissel: zelfde route als SettingsDialog (changeLanguage + persist),
  // maar direct — de ribbon-knop is een sneltoets, geen draft-dialoog.
  const selectLanguage = (lang: "nl" | "en" | "de" | "fr") => {
    void changeLanguage(lang);
    void setSetting("language", lang);
  };

  return (
    <div className="ribbon-content">
      <div className="ribbon-groups">
        {/* Project */}
        <RibbonGroup label={t("settings.project")}>
          <RibbonButton
            icon={projectInfoIcon}
            label={t("settings.projectInfo")}
            size="large"
            onClick={onProjectSettingsClick}
          />
          <RibbonButtonStack>
            <RibbonButton
              icon={materialsIcon}
              label={t("settings.materials")}
              size="small"
              onClick={() => onOpenLibrary?.("materials")}
            />
            <RibbonButton
              icon={sectionsIcon}
              label={t("settings.sections")}
              size="small"
              onClick={() => onOpenLibrary?.("sections")}
            />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* Berekening */}
        <RibbonGroup label={t("settings.calculation")}>
          <RibbonButton
            icon={calcSettingsIcon}
            label={t("settings.calcSettings")}
            size="large"
            onClick={onSettingsClick}
          />
        </RibbonGroup>

        {/* AI-assistent — de bediening door een AI-assistent (MCP) toestaan en
            koppelen; opent Instellingen op dat tabblad (issue #109). */}
        <RibbonGroup label={t("settings.aiGroup")}>
          <RibbonButton
            icon={aiAssistantIcon}
            label={t("settings.aiAssistant")}
            size="large"
            onClick={onOpenAiAssistant}
          />
        </RibbonGroup>

        {/* Weergave — themawissel tussen Licht en Donker (ontwerp 0.4); bij
            Blueprint of een high-contrastthema licht geen van beide op. */}
        <RibbonGroup label={t("settings.appearance")}>
          <RibbonButton
            icon={themeMoonIcon}
            label={t("settings.darkMode")}
            size="large"
            active={theme === "dark"}
            onClick={() => onThemeSelect?.("dark")}
          />
          <RibbonButton
            icon={themeSunIcon}
            label={t("settings.lightMode")}
            size="large"
            active={theme === "light"}
            onClick={() => onThemeSelect?.("light")}
          />
        </RibbonGroup>

        {/* Taal — de vier talen met een eigen locale (nl/en/de/fr, zie LANGUAGES
            in i18n/config.ts). De naam staat in de taal zelf, zodat iemand die
            de huidige taal niet leest zijn eigen taal herkent. */}
        <RibbonGroup label={t("settings.language")}>
          <RibbonButton
            icon={languageIcon}
            label="NL"
            size="large"
            title="Nederlands"
            active={activeLang === "nl"}
            onClick={() => selectLanguage("nl")}
          />
          <RibbonButton
            icon={languageIcon}
            label="EN"
            size="large"
            title="English"
            active={activeLang === "en"}
            onClick={() => selectLanguage("en")}
          />
          <RibbonButton
            icon={languageIcon}
            label="DE"
            size="large"
            title="Deutsch"
            active={activeLang === "de"}
            onClick={() => selectLanguage("de")}
          />
          <RibbonButton
            icon={languageIcon}
            label="FR"
            size="large"
            title="Français"
            active={activeLang === "fr"}
            onClick={() => selectLanguage("fr")}
          />
        </RibbonGroup>
      </div>
    </div>
  );
}

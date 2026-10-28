/**
 * Vraag bij niet-opgeslagen wijzigingen (sluiten, Nieuw, Openen): één venster
 * met Opslaan / Niet opslaan / Annuleren, in de stijl van de app. Vervangt de
 * twee systeemvensters achter elkaar (de Tauri-dialoog kent maar twee knoppen).
 * Sluiten met Esc of het kruisje = Annuleren: er gaat nooit stil werk verloren.
 */
import { useTranslation } from "react-i18next";
import Modal from "./Modal";
import "./settings/SettingsDialog.css";

export type OnopgeslagenKeuze = "opslaan" | "niet" | "annuleren";

interface Props {
  open: boolean;
  /** Bestandsnaam van het project; leeg = nog nooit opgeslagen. */
  naam?: string;
  onKeuze: (keuze: OnopgeslagenKeuze) => void;
}

export default function OnopgeslagenDialog({ open, naam, onKeuze }: Props) {
  const { t } = useTranslation("common");
  return (
    <Modal
      open={open}
      onClose={() => onKeuze("annuleren")}
      title={t("unsaved.title")}
      width={420}
      footer={
        <>
          <button className="settings-btn settings-btn-secondary" onClick={() => onKeuze("annuleren")}>{t("unsaved.cancelBtn")}</button>
          <button className="settings-btn settings-btn-secondary" onClick={() => onKeuze("niet")}>{t("unsaved.dontSaveBtn")}</button>
          <button className="settings-btn settings-btn-primary" autoFocus onClick={() => onKeuze("opslaan")}>{t("unsaved.saveBtn")}</button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{naam ? t("unsaved.askSaveNamed", { naam }) : t("unsaved.askSave")}</p>
    </Modal>
  );
}

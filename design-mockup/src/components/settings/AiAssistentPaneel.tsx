/**
 * Instellingen → AI-assistent (MCP) (issue #109).
 *
 * Twee delen:
 *  1. de schakelaar "Bediening door een AI-assistent toestaan (MCP)" met de
 *     status van het kanaal (actief op poort …, uit, of waarom het niet
 *     startte). Bij een vers profiel is de bewaarde keuze standaard aan;
 *     omzetten bewaart de keuze en start of stopt het kanaal meteen
 *     — los van Opslaan/Annuleren van het instellingenvenster. De schakelaar
 *     toont alleen de BEWAARDE keuze. Een kanaal dat alleen voor deze sessie
 *     aanstaat (de app gestart met OPENAEC_GUI_CONTROL=1, ook door gui_start_app
 *     van de MCP-server), staat apart in de status, met een eigen knop om het
 *     nu uit te zetten;
 *  2. het koppelen: het pad van de meegeleverde MCP-server, de knop
 *     "Toevoegen aan Claude Desktop" (alleen na een klik; Rust maakt eerst een
 *     reservekopie en laat de rest van de config staan), de opdracht voor
 *     Claude Code en het JSON-fragment voor andere MCP-clients.
 *
 * De Rust-kant: gui_control.rs (schakelaar) en mcp_koppeling.rs (koppelen);
 * de aanroepen en teksten: lib/mcpKoppeling.ts.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  claudeCodeOpdracht,
  isKoppelFout,
  kopieerTekst,
  leesKanaalStatus,
  leesKoppelInfo,
  luisterNaarKanaal,
  mcpJsonFragment,
  voegToeAanClaudeDesktop,
  zetKanaal,
  type KanaalStatus,
  type KoppelInfo,
  type KoppelUitkomst,
} from "../../lib/mcpKoppeling";
import "./AiAssistentPaneel.css";

type Toevoeging =
  | { soort: "bezig" }
  | { soort: "klaar"; uitkomst: KoppelUitkomst }
  | { soort: "fout"; fout: string };

function foutTekst(e: unknown): string {
  if (isKoppelFout(e)) return e.melding;
  return e instanceof Error ? e.message : String(e);
}

/** De weigering van "Toevoegen aan Claude Desktop" in de taal van de gebruiker: ongeldige JSON via i18n, de rest zoals Rust hem meldt. */
function koppelFoutTekst(e: unknown, t: TFunction<"settings">): string {
  if (isKoppelFout(e) && e.code === "ONGELDIGE_JSON" && e.regel != null && e.kolom != null) {
    return t("aiAssistant.invalidJson", {
      config: e.config ?? "claude_desktop_config.json",
      regel: e.regel,
      kolom: e.kolom,
    });
  }
  return foutTekst(e);
}

/** Een pad dat na elk scheidingsteken mag afbreken, niet midden in een naam. */
function Pad({ tekst }: { tekst: string }) {
  return <>{tekst.split(/(?<=[\\/])/).map((deel, i) => <Fragment key={i}>{deel}<wbr /></Fragment>)}</>;
}

/** Een tekst met een knop Kopiëren; "Gekopieerd" staat er twee seconden. */
function Kopieerblok({ tekst, id }: { tekst: string; id: string }) {
  const { t } = useTranslation("settings");
  const [gekopieerd, setGekopieerd] = useState(false);
  const klok = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (klok.current) clearTimeout(klok.current); }, []);
  const kopieer = async () => {
    if (await kopieerTekst(tekst)) {
      setGekopieerd(true);
      if (klok.current) clearTimeout(klok.current);
      klok.current = setTimeout(() => setGekopieerd(false), 2000);
    }
  };
  return (
    <div className="ai-kopieerblok">
      <pre className="ai-code" id={id}>{tekst}</pre>
      <button type="button" className="settings-btn settings-btn-secondary ai-kopieer" onClick={() => void kopieer()}>
        {gekopieerd ? t("aiAssistant.copied") : t("aiAssistant.copy")}
      </button>
    </div>
  );
}

export default function AiAssistentPaneel() {
  const { t } = useTranslation("settings");
  const [status, setStatus] = useState<KanaalStatus | null>(null);
  const [info, setInfo] = useState<KoppelInfo | null>(null);
  const [geladen, setGeladen] = useState(false);
  const [schakelt, setSchakelt] = useState(false);
  const [schakelFout, setSchakelFout] = useState<string | null>(null);
  const [toevoeging, setToevoeging] = useState<Toevoeging | null>(null);

  useEffect(() => {
    let weg = false;
    let af: (() => void) | null = null;
    void (async () => {
      const [s, i] = await Promise.all([leesKanaalStatus(), leesKoppelInfo()]);
      if (weg) return;
      setStatus(s);
      setInfo(i);
      setGeladen(true);
      const afmelder = await luisterNaarKanaal((nieuw) => setStatus(nieuw));
      if (weg) afmelder(); else af = afmelder;
    })();
    return () => { weg = true; af?.(); };
  }, []);

  const schakel = useCallback(async (aan: boolean) => {
    setSchakelt(true);
    setSchakelFout(null);
    try {
      setStatus(await zetKanaal(aan));
    } catch (e) {
      setSchakelFout(foutTekst(e));
      const s = await leesKanaalStatus();
      if (s) setStatus(s);
    } finally {
      setSchakelt(false);
    }
  }, []);

  const voegToe = useCallback(async () => {
    setToevoeging({ soort: "bezig" });
    try {
      setToevoeging({ soort: "klaar", uitkomst: await voegToeAanClaudeDesktop() });
    } catch (e) {
      setToevoeging({ soort: "fout", fout: koppelFoutTekst(e, t) });
    }
  }, [t]);

  const inApp = geladen && status !== null;
  const server = info?.serverPad ?? null;

  let statusTekst: string;
  let statusSoort: "aan" | "uit" | "fout";
  if (!geladen) {
    statusTekst = "…";
    statusSoort = "uit";
  } else if (!status) {
    statusTekst = t("aiAssistant.statusBrowser");
    statusSoort = "uit";
  } else if (status.actief) {
    statusTekst = t("aiAssistant.statusActive", { poort: status.poort ?? "?" });
    statusSoort = "aan";
  } else if (status.fout) {
    statusTekst = t("aiAssistant.statusFailed", { fout: status.fout });
    statusSoort = "fout";
  } else {
    statusTekst = t("aiAssistant.statusOff");
    statusSoort = "uit";
  }
  // De schakelaar volgt alleen de bewaarde keuze: een aangevinkte schakelaar
  // betekent "ook bij de volgende start aan". Een kanaal dat alleen voor deze
  // sessie aanstaat (OPENAEC_GUI_CONTROL=1, ook via gui_start_app), staat
  // eronder apart, met een knop om het nu uit te zetten.
  const aan = !!status && status.toegestaan;
  const alleenDezeSessie = !!status && status.actief && !status.toegestaan;

  return (
    <div className="ai-paneel">
      <div className="settings-section">
        <h3>{t("aiAssistant.title")}</h3>
        <div className="settings-checkbox-row">
          <input
            id="ai-toestaan"
            type="checkbox"
            checked={aan}
            disabled={!inApp || schakelt}
            onChange={(e) => void schakel(e.target.checked)}
          />
          <label htmlFor="ai-toestaan">{t("aiAssistant.allow")}</label>
        </div>
        <p className="settings-description ai-uitleg">{t("aiAssistant.allowDescription")}</p>
        <div className={`ai-status ai-status-${statusSoort}`} role="status" id="ai-status">
          <span className="ai-status-stip" aria-hidden="true" />
          <span>{schakelt ? t("aiAssistant.busy") : statusTekst}</span>
        </div>
        {alleenDezeSessie && (
          <div className="ai-sessie">
            <p className="settings-description" id="ai-omgeving">{t("aiAssistant.statusEnv")}</p>
            <button
              type="button"
              id="ai-sessie-uit"
              className="settings-btn settings-btn-secondary ai-knop"
              disabled={schakelt}
              onClick={() => void schakel(false)}
            >
              {t("aiAssistant.stopSession")}
            </button>
          </div>
        )}
        {schakelFout && <p className="ai-melding ai-melding-fout" id="ai-schakelfout">{schakelFout}</p>}
      </div>

      <div className="settings-section">
        <h3>{t("aiAssistant.connect")}</h3>
        <div className="ai-rij">
          <span className="settings-label">{t("aiAssistant.server")}</span>
          {server ? (
            <code className="ai-pad" id="ai-serverpad"><Pad tekst={server} /></code>
          ) : geladen && info ? (
            <div className="ai-melding ai-melding-fout" id="ai-server-ontbreekt">
              <div>{t("aiAssistant.serverMissing", { naam: "openaec-mcp-server" })}</div>
              <div className="ai-gezocht">{t("aiAssistant.serverSearched")}</div>
              <ul className="ai-gezocht-lijst">
                {info.gezocht.map((p) => <li key={p}><code>{p}</code></li>)}
              </ul>
              <div>{t("aiAssistant.serverHint")}</div>
            </div>
          ) : (
            <span className="settings-description">{geladen ? t("aiAssistant.statusBrowser") : "…"}</span>
          )}
        </div>

        <h4 className="ai-kop">{t("aiAssistant.claudeDesktop")}</h4>
        <p className="settings-description">
          {t("aiAssistant.claudeDesktopDescription", {
            naam: info?.servernaam ?? "open-fem-studio",
            config: info?.claudeDesktopConfig ?? "claude_desktop_config.json",
          })}
        </p>
        <button
          type="button"
          id="ai-claude-desktop"
          className="settings-btn settings-btn-primary ai-knop"
          disabled={!server || toevoeging?.soort === "bezig"}
          onClick={() => void voegToe()}
        >
          {t("aiAssistant.claudeDesktopButton")}
        </button>
        {toevoeging?.soort === "klaar" && (
          <div className="ai-melding ai-melding-goed" id="ai-uitkomst" role="status">
            <div>{t(`aiAssistant.result.${toevoeging.uitkomst.soort}`, { config: toevoeging.uitkomst.config })}</div>
            {toevoeging.uitkomst.reservekopie && (
              <div>{t("aiAssistant.backup", { pad: toevoeging.uitkomst.reservekopie })}</div>
            )}
            {toevoeging.uitkomst.mapAangemaakt && <div>{t("aiAssistant.folderCreated")}</div>}
            {toevoeging.uitkomst.dubbel.length > 0 && (
              <div>{t("aiAssistant.duplicate", { namen: toevoeging.uitkomst.dubbel.join(", ") })}</div>
            )}
            {toevoeging.uitkomst.soort !== "ongewijzigd" && <div><strong>{t("aiAssistant.restart")}</strong></div>}
          </div>
        )}
        {toevoeging?.soort === "fout" && (
          <div className="ai-melding ai-melding-fout" id="ai-uitkomst-fout" role="alert">
            {t("aiAssistant.failed", { fout: toevoeging.fout })}
          </div>
        )}

        {server && (
          <>
            <h4 className="ai-kop">{t("aiAssistant.claudeCode")}</h4>
            <p className="settings-description">{t("aiAssistant.claudeCodeDescription")}</p>
            <Kopieerblok id="ai-claude-code" tekst={claudeCodeOpdracht(server)} />

            <h4 className="ai-kop">{t("aiAssistant.otherClients")}</h4>
            <p className="settings-description">{t("aiAssistant.otherClientsDescription")}</p>
            <Kopieerblok id="ai-json" tekst={mcpJsonFragment(server)} />
          </>
        )}
        <p className="settings-description ai-voetnoot">{t("aiAssistant.startApp")}</p>
      </div>
    </div>
  );
}

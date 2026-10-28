/**
 * Een AI-assistent aan de app koppelen (issue #109): de schakelaar van het
 * bedieningskanaal en het koppelpaneel in Instellingen → AI-assistent (MCP).
 *
 * De Rust-kant staat in `src-tauri/src/gui_control.rs` (de schakelaar:
 * `gui_kanaal_status`, `gui_kanaal_aan`, `gui_kanaal_uit`, het event
 * `gui-control:status`) en `src-tauri/src/mcp_koppeling.rs` (de server vinden,
 * Claude Desktop bijwerken: `mcp_koppeling_info`, `mcp_claude_desktop_toevoegen`).
 * Hier staan de typen van die antwoorden, de aanroepen, en de twee teksten
 * die de pagina zelf maakt: de opdracht voor Claude Code en het JSON-fragment
 * voor andere MCP-clients. Geen geheimen: alleen het pad van de server.
 */

/** De naam van de regel in `mcpServers` en in `claude mcp add`; gelijk aan `SERVERNAAM` in mcp_koppeling.rs. */
export const MCP_SERVERNAAM = "open-fem-studio";

/** Het event waarmee Rust meldt dat het kanaal aan of uit ging. */
export const EVENT_KANAAL_STATUS = "gui-control:status";

/** `gui_control::KanaalStatus`. */
export interface KanaalStatus {
  /** De bewaarde instelling "Bediening door een AI-assistent toestaan". */
  toegestaan: boolean;
  /** Luistert er nu een kanaal? */
  actief: boolean;
  poort: number | null;
  /** Aangezet met OPENAEC_GUI_CONTROL=1 bij het starten. */
  doorOmgeving: boolean;
  vindbestand: string | null;
  /** Waarom het kanaal niet startte. */
  fout: string | null;
}

/** `mcp_koppeling::KoppelInfo`. */
export interface KoppelInfo {
  serverPad: string | null;
  gezocht: string[];
  claudeDesktopConfig: string | null;
  claudeDesktopConfigBestaat: boolean;
  servernaam: string;
}

export type KoppelSoort = "aangemaakt" | "toegevoegd" | "bijgewerkt" | "ongewijzigd";

/** `mcp_koppeling::KoppelUitkomst`. */
export interface KoppelUitkomst {
  config: string;
  soort: KoppelSoort;
  reservekopie: string | null;
  mapAangemaakt: boolean;
  dubbel: string[];
  servernaam: string;
  server: string;
}

/**
 * `mcp_koppeling::KoppelFout`: waarom "Toevoegen aan Claude Desktop" niets
 * deed. `code` is vast — `ONGELDIGE_JSON` (met `regel` en `kolom`, het paneel
 * vertaalt de melding) of `MISLUKT` — en `melding` is de volledige
 * Nederlandse tekst van Rust.
 */
export interface KoppelFout {
  code: "ONGELDIGE_JSON" | "MISLUKT";
  melding: string;
  config: string | null;
  regel: number | null;
  kolom: number | null;
}

/** Is dit een weigering van `mcp_claude_desktop_toevoegen` (en niet een andere fout)? */
export function isKoppelFout(e: unknown): e is KoppelFout {
  return typeof e === "object" && e !== null
    && typeof (e as KoppelFout).code === "string"
    && typeof (e as KoppelFout).melding === "string";
}

/** `claude mcp add --scope user open-fem-studio -- "<pad>"`. */
export function claudeCodeOpdracht(serverPad: string): string {
  return `claude mcp add --scope user ${MCP_SERVERNAAM} -- "${serverPad}"`;
}

/** Het fragment voor de MCP-configuratie van een andere client (zelfde vorm als claude_desktop_config.json). */
export function mcpJsonFragment(serverPad: string): string {
  return JSON.stringify({ mcpServers: { [MCP_SERVERNAAM]: { command: serverPad, args: [] } } }, null, 2);
}

async function roep<T>(commando: string): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(commando);
}

/** De status van het kanaal, of `null` buiten de desktop-app. */
export async function leesKanaalStatus(): Promise<KanaalStatus | null> {
  try {
    return await roep<KanaalStatus>("gui_kanaal_status");
  } catch {
    return null;
  }
}

/** De schakelaar: bewaren en het kanaal meteen starten of stoppen. Gooit bij een fout. */
export async function zetKanaal(aan: boolean): Promise<KanaalStatus> {
  return roep<KanaalStatus>(aan ? "gui_kanaal_aan" : "gui_kanaal_uit");
}

/** Waar de MCP-server staat, of `null` buiten de desktop-app. */
export async function leesKoppelInfo(): Promise<KoppelInfo | null> {
  try {
    return await roep<KoppelInfo>("mcp_koppeling_info");
  } catch {
    return null;
  }
}

/** De knop "Toevoegen aan Claude Desktop". Gooit een {@link KoppelFout} als het niet kan. */
export async function voegToeAanClaudeDesktop(): Promise<KoppelUitkomst> {
  return roep<KoppelUitkomst>("mcp_claude_desktop_toevoegen");
}

/** Luister naar `gui-control:status`; geeft een afmelder terug (in de browser een no-op). */
export async function luisterNaarKanaal(cb: (status: KanaalStatus) => void): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<KanaalStatus>(EVENT_KANAAL_STATUS, (e) => cb(e.payload));
  } catch {
    return () => {};
  }
}

/** Zet tekst op het klembord; met een terugval voor een webview zonder klembord-API. */
export async function kopieerTekst(tekst: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(tekst);
      return true;
    }
  } catch {
    // val terug op execCommand
  }
  try {
    const veld = document.createElement("textarea");
    veld.value = tekst;
    veld.setAttribute("readonly", "");
    veld.style.position = "fixed";
    veld.style.opacity = "0";
    document.body.appendChild(veld);
    veld.select();
    const ok = document.execCommand("copy");
    veld.remove();
    return ok;
  } catch {
    return false;
  }
}

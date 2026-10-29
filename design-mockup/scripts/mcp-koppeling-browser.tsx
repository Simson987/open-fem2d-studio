/**
 * Browserkant van test-mcp-koppeling-ui.mjs (issue #109): het paneel
 * Instellingen → AI-assistent (MCP) in de echte onderdelen (AiAssistentPaneel,
 * SettingsDialog, het lint SettingsTab), met alleen de native IPC-grens
 * nagebootst: de commando's gui_kanaal_status/_aan/_uit, mcp_koppeling_info en
 * mcp_claude_desktop_toevoegen, en het event gui-control:status.
 *
 * `#beeld=licht` of `#beeld=donker` bouwt alleen het beeld voor een
 * schermafbeelding: het instellingenvenster op dit tabblad, kanaal aan, na een
 * klik op "Toevoegen aan Claude Desktop". Met `-sessie` erachter staat het
 * kanaal alleen voor deze sessie aan (de bewaarde keuze uit).
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import nlSettings from "../src/i18n/locales/nl/settings.json";
import enSettings from "../src/i18n/locales/en/settings.json";
import deSettings from "../src/i18n/locales/de/settings.json";
import frSettings from "../src/i18n/locales/fr/settings.json";
import nlCommon from "../src/i18n/locales/nl/common.json";
import nlRibbon from "../src/i18n/locales/nl/ribbon.json";
import enRibbon from "../src/i18n/locales/en/ribbon.json";
import deRibbon from "../src/i18n/locales/de/ribbon.json";
import frRibbon from "../src/i18n/locales/fr/ribbon.json";
import "../src/openaec/openaec-tokens.css";
import "../src/themes.css";
import "../src/App.css";
import AiAssistentPaneel from "../src/components/settings/AiAssistentPaneel";
import SettingsDialog from "../src/components/settings/SettingsDialog";
import SettingsTab from "../src/components/ribbon/SettingsTab";
import type { KanaalStatus, KoppelFout, KoppelInfo, KoppelUitkomst } from "../src/lib/mcpKoppeling";

const tests: { name: string; error?: string }[] = [];
const fouten: string[] = [];
window.addEventListener("unhandledrejection", (e) => { fouten.push(String(e.reason)); e.preventDefault(); });
const wacht = (ms = 30) => new Promise((r) => setTimeout(r, ms));
function ok(waarde: unknown, bericht: string): asserts waarde { if (!waarde) throw Error(bericht); }
async function test(name: string, run: () => Promise<void>) {
  try { await run(); tests.push({ name }); } catch (e) { tests.push({ name, error: e instanceof Error ? e.message : String(e) }); }
}

const SERVER = "C:\\Users\\proef\\AppData\\Local\\Open FEM Studio\\openaec-mcp-server.exe";
const CONFIG = "C:\\Users\\proef\\AppData\\Roaming\\Claude\\claude_desktop_config.json";

/* ── De native kant in het klein ─────────────────────────────────────── */

const UIT: KanaalStatus = { toegestaan: false, actief: false, poort: null, doorOmgeving: false, vindbestand: null, fout: null };
// Na een verse installatie heeft Rust nog geen instellingenbestand en start
// het kanaal vanzelf. UIT hieronder modelleert een expliciet bewaarde keuze.
const VERS: KanaalStatus = { ...UIT, toegestaan: true, actief: true, poort: 51234 };
let toestand: KanaalStatus = { ...UIT };
let info: KoppelInfo = { serverPad: SERVER, gezocht: [SERVER], claudeDesktopConfig: CONFIG, claudeDesktopConfigBestaat: true, servernaam: "open-fem-studio" };
const standaardToevoegen = (): KoppelUitkomst => ({
  config: CONFIG, soort: "toegevoegd", reservekopie: `${CONFIG}.20261006-142233.bak`, mapAangemaakt: false,
  dubbel: [], servernaam: "open-fem-studio", server: SERVER,
});
let toevoegen: () => KoppelUitkomst = standaardToevoegen;
let aanroepen: string[] = [];
/** Gezet: gui_kanaal_aan weigert met deze reden (zoals Rust een Err teruggeeft). */
let aanWeigert: string | null = null;
const terugroepen = new Map<number, (e: unknown) => void>();
const luisteraars: { event: string; handler: number }[] = [];
let volgnummer = 0;

const api = window as unknown as Record<string, unknown>;
api.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
  transformCallback: (cb: (e: unknown) => void) => { const id = ++volgnummer; terugroepen.set(id, cb); return id; },
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    aanroepen.push(cmd);
    switch (cmd) {
      case "gui_kanaal_status": return toestand;
      case "gui_kanaal_aan":
        if (aanWeigert) throw aanWeigert;
        // Draait er al een kanaal (bijvoorbeeld voor deze sessie), dan blijft het; anders een nieuwe poort.
        toestand = { ...toestand, toegestaan: true, actief: true, poort: toestand.actief ? toestand.poort : 51234, fout: null };
        return toestand;
      // doorOmgeving hoort bij de start van de app en blijft; het kanaal gaat uit.
      case "gui_kanaal_uit": toestand = { ...UIT, doorOmgeving: toestand.doorOmgeving }; return toestand;
      case "mcp_koppeling_info": return info;
      case "mcp_claude_desktop_toevoegen": return toevoegen();
      case "plugin:event|listen": luisteraars.push({ event: String(args.event), handler: Number(args.handler) }); return luisteraars.length;
      case "plugin:event|unlisten": return null;
      default: return null;
    }
  },
};
api.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };

/** Een event van Rust naar de pagina. */
function stuur(event: string, payload: unknown) {
  for (const l of luisteraars.filter((x) => x.event === event)) terugroepen.get(l.handler)?.({ event, id: 1, payload });
}

/* ── Monteren ────────────────────────────────────────────────────────── */

const host = document.getElementById("root")!;
let root = createRoot(host);
async function monteer(el: React.ReactNode) {
  flushSync(() => root.unmount());
  root = createRoot(host);
  luisteraars.length = 0;
  aanroepen = [];
  flushSync(() => root.render(el));
  for (let i = 0; i < 10; i++) await wacht(10);
}
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const tekst = (sel: string) => $(sel)?.textContent ?? "";
async function klik(el: HTMLElement | null, wat: string) {
  ok(el, `${wat} niet gevonden`);
  el.click();
  for (let i = 0; i < 10; i++) await wacht(10);
}
function knopMet(label: string): HTMLButtonElement | null {
  return [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | null;
}

function thema(naam: "light" | "dark") { document.documentElement.setAttribute("data-oa-theme", naam); }

async function toonBeeld(beeld: string) {
  thema(beeld.startsWith("donker") ? "dark" : "light");
  // "-sessie": alleen voor deze sessie aan (zoals na gui_start_app).
  toestand = beeld.endsWith("-sessie")
    ? { ...UIT, actief: true, poort: 51234, doorOmgeving: true }
    : { ...UIT, toegestaan: true, actief: true, poort: 51234 };
  await monteer(<SettingsDialog open onClose={() => {}} theme="light" onThemeChange={() => {}} initialTab="aiAssistant" />);
  await klik(knopMet("Toevoegen aan Claude Desktop"), "de knop Toevoegen aan Claude Desktop");
  // "-midden": vanaf de uitkomst van de knop; "-onder": het onderste deel.
  const inhoud = $(".settings-content");
  if (inhoud && beeld.endsWith("-midden")) inhoud.scrollTop = ($("#ai-uitkomst")?.offsetTop ?? 0) - 60;
  if (inhoud && beeld.endsWith("-onder")) inhoud.scrollTop = inhoud.scrollHeight;
  document.getElementById("uitslag")!.style.display = "none";
}

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", fallbackLng: false, defaultNS: "settings", initImmediate: false, showSupportNotice: false,
    resources: {
      nl: { settings: nlSettings, common: nlCommon, ribbon: nlRibbon },
      en: { settings: enSettings, ribbon: enRibbon },
      de: { settings: deSettings, ribbon: deRibbon },
      fr: { settings: frSettings, ribbon: frRibbon },
    },
  } as Parameters<typeof i18next.init>[0]);
  // SettingsDialog laadt ook de app-brede i18n-config. Begin elke proef in het
  // Nederlands; de testpagina zet navigator.language vooraf op nl-NL zodat de
  // latere asynchrone instelling "auto" dezelfde taal behoudt.
  await i18next.changeLanguage("nl");
  const beeld = new URLSearchParams(location.hash.slice(1)).get("beeld");
  if (beeld) { await toonBeeld(beeld); return; }
  thema("light");

  await test("het paneel toont het pad van de server, de opdracht voor Claude Code en het JSON-fragment", async () => {
    toestand = { ...UIT };
    await monteer(<AiAssistentPaneel />);
    ok(tekst("#ai-serverpad") === SERVER, `pad: ${tekst("#ai-serverpad")}`);
    const opdracht = `claude mcp add --scope user open-fem-studio -- "${SERVER}"`;
    ok(tekst("#ai-claude-code") === opdracht, `opdracht: ${tekst("#ai-claude-code")}`);
    const fragment = JSON.parse(tekst("#ai-json"));
    ok(JSON.stringify(fragment) === JSON.stringify({ mcpServers: { "open-fem-studio": { command: SERVER, args: [] } } }),
      `fragment: ${tekst("#ai-json")}`);
    ok(!/token/i.test(tekst("#ai-json") + tekst("#ai-claude-code")), "geen token in wat de gebruiker kopieert");
    ok(!aanroepen.includes("mcp_claude_desktop_toevoegen"), "Claude Desktop wordt niet bijgewerkt zonder klik");
    ok(!aanroepen.includes("gui_kanaal_aan") && !aanroepen.includes("gui_kanaal_uit"), "openen zet niets aan of uit");
  });

  await test("een vers profiel toont bediening aan en actief op een poort", async () => {
    toestand = { ...VERS };
    await monteer(<AiAssistentPaneel />);
    ok(($("#ai-toestaan") as HTMLInputElement).checked, "het nieuwe profiel staat aan");
    ok(tekst("#ai-status").includes("Actief op poort 51234"), tekst("#ai-status"));
    ok(!aanroepen.includes("gui_kanaal_aan"), "het paneel hoeft het kanaal niet zelf te starten");
  });

  await test("na een expliciete keuze voor uit zet de schakelaar het kanaal meteen aan en uit", async () => {
    toestand = { ...UIT };
    await monteer(<AiAssistentPaneel />);
    const vink = $("#ai-toestaan") as HTMLInputElement;
    ok(vink && !vink.checked && !vink.disabled, "de bewaarde keuze staat uit en is te bedienen");
    ok(tekst("#ai-status").includes("Uit"), `status: ${tekst("#ai-status")}`);
    await klik(vink, "de schakelaar");
    ok(aanroepen.includes("gui_kanaal_aan"), `aanroepen: ${aanroepen.join(", ")}`);
    ok((($("#ai-toestaan") as HTMLInputElement).checked), "de schakelaar staat aan");
    ok(tekst("#ai-status").includes("Actief op poort 51234"), `status: ${tekst("#ai-status")}`);
    await klik($("#ai-toestaan"), "de schakelaar");
    ok(aanroepen.includes("gui_kanaal_uit"), `aanroepen: ${aanroepen.join(", ")}`);
    ok(!(($("#ai-toestaan") as HTMLInputElement).checked), "de schakelaar staat weer uit");
    ok(tekst("#ai-status").includes("Uit"), `status: ${tekst("#ai-status")}`);
  });

  await test("een event van Rust (gui-control:status) werkt de status bij", async () => {
    toestand = { ...UIT };
    await monteer(<AiAssistentPaneel />);
    ok(luisteraars.some((l) => l.event === "gui-control:status"), "het paneel luistert naar gui-control:status");
    flushSync(() => stuur("gui-control:status", { ...UIT, toegestaan: true, actief: true, poort: 6000 }));
    await wacht(20);
    ok(tekst("#ai-status").includes("Actief op poort 6000"), `status: ${tekst("#ai-status")}`);
  });

  await test("Toevoegen aan Claude Desktop: pas na een klik, met uitkomst, reservekopie en herstartmelding", async () => {
    toestand = { ...UIT };
    await monteer(<AiAssistentPaneel />);
    ok(tekst(".ai-paneel").includes(CONFIG), "de beschrijving noemt het configbestand");
    await klik(knopMet("Toevoegen aan Claude Desktop"), "de knop");
    ok(aanroepen.filter((a) => a === "mcp_claude_desktop_toevoegen").length === 1, `aanroepen: ${aanroepen.join(", ")}`);
    const uit = tekst("#ai-uitkomst");
    ok(uit.includes(`Toegevoegd aan ${CONFIG}.`), uit);
    ok(uit.includes(`Reservekopie: ${CONFIG}.20261006-142233.bak`), uit);
    ok(uit.includes("Start Claude Desktop opnieuw om de server te laden."), uit);
  });

  await test("een tweede regel met dezelfde server en een nieuwe map worden gemeld; 'ongewijzigd' vraagt geen herstart", async () => {
    toevoegen = () => ({ config: CONFIG, soort: "aangemaakt", reservekopie: null, mapAangemaakt: true, dubbel: ["openaec-fem"], servernaam: "open-fem-studio", server: SERVER });
    await monteer(<AiAssistentPaneel />);
    await klik(knopMet("Toevoegen aan Claude Desktop"), "de knop");
    const uit = tekst("#ai-uitkomst");
    ok(uit.includes("aangemaakt") && uit.includes("bestond nog niet") && uit.includes("openaec-fem start dezelfde server"), uit);
    ok(!uit.includes("Reservekopie"), "geen reservekopie bij een nieuw bestand");
    toevoegen = () => ({ config: CONFIG, soort: "ongewijzigd", reservekopie: null, mapAangemaakt: false, dubbel: [], servernaam: "open-fem-studio", server: SERVER });
    await monteer(<AiAssistentPaneel />);
    await klik(knopMet("Toevoegen aan Claude Desktop"), "de knop");
    ok(tekst("#ai-uitkomst").includes("Stond al goed"), tekst("#ai-uitkomst"));
    ok(!tekst("#ai-uitkomst").includes("opnieuw"), "niets gewijzigd: geen herstart nodig");
  });

  // Zoals Rust (mcp_koppeling::KoppelFout) een ongeldige config weigert.
  const ongeldig: KoppelFout = {
    code: "ONGELDIGE_JSON",
    melding: `${CONFIG}: het bestand is geen geldige JSON (syntaxfout op regel 3, kolom 5) — het bestand is niet gewijzigd`,
    config: CONFIG, regel: 3, kolom: 5,
  };

  await test("een weigering (ongeldige JSON) staat er vertaald als fout, met de plek één keer, zonder succesmelding", async () => {
    toevoegen = () => { throw ongeldig; };
    await monteer(<AiAssistentPaneel />);
    await klik(knopMet("Toevoegen aan Claude Desktop"), "de knop");
    const fout = tekst("#ai-uitkomst-fout");
    ok(fout === `Niet toegevoegd: ${CONFIG} is geen geldige JSON: fout op regel 3, kolom 5. Het bestand is niet gewijzigd.`, fout);
    ok(!$("#ai-uitkomst"), "geen succesmelding");
    await i18next.changeLanguage("en");
    await monteer(<AiAssistentPaneel />);
    await klik(knopMet("Add to Claude Desktop"), "de knop");
    ok(tekst("#ai-uitkomst-fout") === `Not added: ${CONFIG} is not valid JSON: error at line 3, column 5. The file was not changed.`,
      tekst("#ai-uitkomst-fout"));
    await i18next.changeLanguage("nl");
  });

  await test("een andere weigering (MISLUKT) toont de reden van Rust", async () => {
    toevoegen = () => { throw { code: "MISLUKT", melding: "de map van Claude Desktop is onbekend", config: null, regel: null, kolom: null } satisfies KoppelFout; };
    await monteer(<AiAssistentPaneel />);
    await klik(knopMet("Toevoegen aan Claude Desktop"), "de knop");
    ok(tekst("#ai-uitkomst-fout") === "Niet toegevoegd: de map van Claude Desktop is onbekend", tekst("#ai-uitkomst-fout"));
    ok(!/\[object Object\]/.test(tekst(".ai-paneel")), "geen [object Object]");
    toevoegen = standaardToevoegen;
  });

  await test("zonder server: waar gezocht is, de knop uit en geen opdrachten", async () => {
    const zocht = ["C:\\app\\openaec-mcp-server.exe", "C:\\bron\\src-tauri\\target\\release\\openaec-mcp-server.exe"];
    info = { ...info, serverPad: null, gezocht: zocht };
    await monteer(<AiAssistentPaneel />);
    const melding = tekst("#ai-server-ontbreekt");
    ok(melding.includes("niet gevonden") && zocht.every((p) => melding.includes(p)), melding);
    ok((knopMet("Toevoegen aan Claude Desktop") as HTMLButtonElement).disabled, "de knop is uit");
    ok(!$("#ai-claude-code") && !$("#ai-json"), "geen opdracht zonder pad");
    info = { ...info, serverPad: SERVER, gezocht: [SERVER] };
  });

  await test("een kanaal dat niet startte, toont de reden", async () => {
    toestand = { ...UIT, toegestaan: true, fout: "een andere Open FEM Studio (pid 7) bedient het kanaal al" };
    await monteer(<AiAssistentPaneel />);
    ok(tekst("#ai-status").includes("Niet gestart: een andere Open FEM Studio (pid 7)"), tekst("#ai-status"));
    ok(($("#ai-toestaan") as HTMLInputElement).checked, "de keuze staat wel aan");
  });

  await test("alleen voor deze sessie aan (gui_start_app of OPENAEC_GUI_CONTROL=1): de schakelaar toont de bewaarde keuze 'uit', de sessie staat apart en is nu uit te zetten", async () => {
    toestand = { ...UIT, actief: true, poort: 7000, doorOmgeving: true };
    await monteer(<AiAssistentPaneel />);
    ok(!($("#ai-toestaan") as HTMLInputElement).checked, "de schakelaar volgt de bewaarde keuze: uit");
    ok(tekst("#ai-status").includes("Actief op poort 7000"), tekst("#ai-status"));
    const uitleg = tekst("#ai-omgeving");
    ok(uitleg.includes("Voor deze sessie") && uitleg.includes("gui_start_app") && uitleg.includes("OPENAEC_GUI_CONTROL=1")
      && uitleg.includes("bewaarde instelling staat uit"), uitleg);
    await klik($("#ai-sessie-uit"), "de knop Nu uitzetten");
    ok(aanroepen.includes("gui_kanaal_uit") && !aanroepen.includes("gui_kanaal_aan"), `aanroepen: ${aanroepen.join(", ")}`);
    ok(tekst("#ai-status").includes("Uit"), `status: ${tekst("#ai-status")}`);
    ok(!$("#ai-sessie-uit") && !$("#ai-omgeving"), "geen sessie meer");
    ok(!($("#ai-toestaan") as HTMLInputElement).checked, "de schakelaar staat nog steeds uit");
  });

  await test("aanvinken terwijl de sessie aanstaat, bewaart de keuze; dan geen sessiemelding meer", async () => {
    toestand = { ...UIT, actief: true, poort: 7000, doorOmgeving: true };
    await monteer(<AiAssistentPaneel />);
    await klik($("#ai-toestaan"), "de schakelaar");
    ok(aanroepen.includes("gui_kanaal_aan"), `aanroepen: ${aanroepen.join(", ")}`);
    ok(($("#ai-toestaan") as HTMLInputElement).checked, "nu bewaard aan");
    ok(tekst("#ai-status").includes("Actief op poort 7000"), "hetzelfde kanaal");
    ok(!$("#ai-omgeving") && !$("#ai-sessie-uit"), "de keuze is bewaard: geen sessiemelding");
  });

  await test("een fout bij het omzetten: de reden in beeld, de status opnieuw gelezen", async () => {
    toestand = { ...UIT };
    aanWeigert = "de app-datamap is onbekend: de instelling kan niet bewaard worden";
    try {
      await monteer(<AiAssistentPaneel />);
      const gelezen = aanroepen.filter((a) => a === "gui_kanaal_status").length;
      await klik($("#ai-toestaan"), "de schakelaar");
      ok(tekst("#ai-schakelfout") === aanWeigert, `fout: ${tekst("#ai-schakelfout")}`);
      ok(aanroepen.lastIndexOf("gui_kanaal_status") > aanroepen.indexOf("gui_kanaal_aan")
        && aanroepen.filter((a) => a === "gui_kanaal_status").length === gelezen + 1, `aanroepen: ${aanroepen.join(", ")}`);
      ok(!($("#ai-toestaan") as HTMLInputElement).checked, "de schakelaar volgt de opnieuw gelezen status: uit");
      ok(!($("#ai-toestaan") as HTMLInputElement).disabled, "en is weer te bedienen");
      ok(tekst("#ai-status").includes("Uit"), tekst("#ai-status"));
    } finally {
      aanWeigert = null;
    }
    // Een volgende geslaagde klik haalt de fout weg.
    await klik($("#ai-toestaan"), "de schakelaar");
    ok(!$("#ai-schakelfout"), "de fout is weg");
  });

  await test("Kopiëren zet de opdracht op het klembord", async () => {
    toestand = { ...UIT };
    const geplakt: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => { geplakt.push(t); } } });
    await monteer(<AiAssistentPaneel />);
    const knop = $("#ai-claude-code")?.parentElement?.querySelector("button") as HTMLButtonElement;
    ok(knop?.textContent === "Kopiëren", `knop: ${knop?.textContent}`);
    await klik(knop, "Kopiëren");
    ok(geplakt[0] === `claude mcp add --scope user open-fem-studio -- "${SERVER}"`, `klembord: ${geplakt[0]}`);
    ok(knop.textContent === "Gekopieerd", `na het kopiëren: ${knop.textContent}`);
  });

  for (const [taal, kop, knop] of [
    ["en", "Control by an AI assistant", "Add to Claude Desktop"],
    ["de", "Steuerung durch einen KI-Assistenten", "Zu Claude Desktop hinzufügen"],
    ["fr", "Pilotage par un assistant IA", "Ajouter à Claude Desktop"],
  ] as const) {
    await test(`in het ${taal}: vertaald, zonder ruwe sleutels`, async () => {
      await i18next.changeLanguage(taal);
      toestand = { ...UIT, toegestaan: true, actief: true, poort: 51234 };
      await monteer(<AiAssistentPaneel />);
      const t = tekst(".ai-paneel");
      ok(t.includes(kop), `kop ontbreekt: ${t.slice(0, 200)}`);
      ok(!!knopMet(knop), `knop ${knop} ontbreekt`);
      ok(!/aiAssistant\./.test(t), `ruwe sleutel: ${t}`);
      ok(t.includes("51234"), "de poort");
      await i18next.changeLanguage("nl");
    });
  }

  await test("het lint Instellingen heeft de knop AI-assistent (MCP)", async () => {
    let geopend = 0;
    await monteer(<SettingsTab onOpenAiAssistant={() => { geopend++; }} />);
    const knop = [...document.querySelectorAll(".ribbon-btn")].find((b) => b.textContent?.includes("AI-assistent (MCP)")) as HTMLElement;
    ok(knop, `knoppen: ${[...document.querySelectorAll(".ribbon-btn")].map((b) => b.textContent).join(" | ")}`);
    await klik(knop, "de lintknop");
    ok(geopend === 1, "de knop opent het tabblad");
  });

  await test("het instellingenvenster opent op het tabblad AI-assistent (MCP)", async () => {
    toestand = { ...UIT };
    await monteer(<SettingsDialog open onClose={() => {}} theme="light" onThemeChange={() => {}} initialTab="aiAssistant" />);
    const actief = $(".settings-tab.active");
    ok(actief?.textContent === "AI-assistent (MCP)", `actief tabblad: ${actief?.textContent}`);
    ok($("#ai-toestaan"), "het paneel staat erin");
  });

  await test("geen onafgehandelde fouten", async () => {
    ok(fouten.length === 0, fouten.join("; "));
  });
}

run().then(() => { document.getElementById("uitslag")!.textContent = JSON.stringify({ tests, error: null }); })
  .catch((e) => { document.getElementById("uitslag")!.textContent = JSON.stringify({ tests, error: String(e) }); });

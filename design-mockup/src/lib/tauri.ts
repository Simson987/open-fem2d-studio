/**
 * tauri.ts — runtime-detectie van de Tauri desktop-shell.
 *
 * De app draait in twee omgevingen:
 *  - browser (vite dev op :1440 of een statische build): geen Rust-backend,
 *    dus geen invoke-commands. Normtoetsing en PDF-generatie zijn dan niet
 *    beschikbaar en moeten een nette melding geven i.p.v. een kale
 *    invoke-fout.
 *  - Tauri (WebView2): window.__TAURI_INTERNALS__ bestaat en alle commands
 *    uit src-tauri/src/lib.rs zijn bereikbaar.
 */
export function isTauriApp(): boolean {
  return typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
}

/**
 * Opent een externe link (http/https/mailto) in de standaardbrowser.
 *
 * In de desktop-app via de opener-plugin (`openUrl`); buiten Tauri, of als de
 * plugin weigert (rechten, niet geregistreerd), met
 * `window.open(url, "_blank", "noopener,noreferrer")`. Lost altijd op, ook als
 * beide wegen falen: klikhandlers kunnen hem dus zonder catch aanroepen
 * (`void openExternal(url)`). Alle externe links in `src/` lopen via deze
 * helper (#38, bewaakt door test-tauri-plugin-versies.mjs).
 */
export async function openExternal(url: string): Promise<void> {
  if (isTauriApp()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch (fout) {
      console.warn(`Link openen via de opener-plugin mislukte; terugval op window.open (${url}).`, fout);
    }
  }
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (fout) {
    console.warn(`Link openen mislukte (${url}).`, fout);
  }
}

/**
 * Toon een bestand in de bestandsverkenner van het besturingssysteem (alleen
 * in de desktop-app; via tauri-plugin-opener, permissie
 * opener:allow-reveal-item-in-dir). Geeft false terug als het niet lukte.
 */
export async function revealInFolder(pad: string): Promise<boolean> {
  if (!isTauriApp()) return false;
  try {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(pad);
    return true;
  } catch (fout) {
    console.warn(`Map openen mislukte (${pad}).`, fout);
    return false;
  }
}

/** Nederlandse melding voor functies die de desktop-app vereisen. */
export const DESKTOP_ONLY_MSG =
  "Toetsing vereist de desktop-app. Start Open FEM Studio als desktop-applicatie (Tauri) om de EN 1993/EN 1995-rekenkern te gebruiken.";

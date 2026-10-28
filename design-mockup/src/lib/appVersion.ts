/**
 * appVersion — één bron voor het versienummer van de app.
 *
 * - Desktop (Tauri): de bundelversie uit tauri.conf.json via `getVersion()`.
 * - Browser/dev: fallback op de versie in package.json.
 *
 * TitleBar en StatusBar consumeren allebei deze functie zodat er nooit twee
 * verschillende (hardcoded) versienummers in de UI kunnen staan.
 */
import pkg from "../../package.json";

export async function fetchAppVersion(): Promise<string> {
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return (pkg as { version?: string }).version ?? "";
  }
}

/**
 * Het versienummer zoals de interface het toont. De app heeft een
 * kalenderversie: jaar.week, bijvoorbeeld 2026.39. Tauri, Cargo en npm eisen
 * drie delen (2026.39.0); een patch 0 valt in de weergave weg, een echte patch
 * (2026.39.1) blijft staan. Een voorgevoegde "v" verdwijnt.
 */
export function toonVersie(versie: string): string {
  return versie.trim().replace(/^v/i, "").replace(/^(\d+\.\d+)\.0$/, "$1");
}

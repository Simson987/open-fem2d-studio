/**
 * Een .ifc-bestand kiezen en als tekst lezen, voor "Rekenmodel importeren".
 *
 * In de app: de bestandsdialoog van Tauri. Het gekozen pad komt daarmee voor
 * de looptijd in de fs-scope (de dialoogplugin geeft het vrij), zodat
 * `readTextFile` het mag lezen zonder dat er een vrijgave voor `**\/*.ifc` in
 * de capability nodig is (zie test-fs-scope.mjs). In de browser: een verborgen
 * bestandsveld.
 */
import { isTauriApp } from "../lib/tauri";

export interface GekozenIfcBestand {
  tekst: string;
  /** Bestandsnaam zonder map, voor het verslag. */
  naam: string;
  /** Volledig pad (alleen in de app). */
  pad?: string;
}

export async function kiesIfcBestand(): Promise<GekozenIfcBestand | null> {
  if (isTauriApp()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const gekozen = await open({
      multiple: false,
      filters: [{ name: "IFC", extensions: ["ifc", "IFC"] }],
    });
    if (!gekozen || Array.isArray(gekozen)) return null;
    const pad = gekozen as string;
    const tekst = await readTextFile(pad);
    return { tekst, naam: pad.split(/[\\/]/).pop() ?? pad, pad };
  }
  return await new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ifc,.IFC,application/x-step";
    input.hidden = true;
    document.body.appendChild(input);
    const klaar = (waarde: GekozenIfcBestand | null) => {
      input.remove();
      resolve(waarde);
    };
    input.onchange = async () => {
      const bestand = input.files?.[0];
      if (!bestand) { klaar(null); return; }
      klaar({ tekst: await bestand.text(), naam: bestand.name });
    };
    input.addEventListener("cancel", () => klaar(null), { once: true });
    input.click();
  });
}

/**
 * ifcResultatenApp.ts — de app-kant van het `.ifcfemresults`-bestand (issue
 * #87): wegschrijven (Tauri: opslaan-venster, browser: download) en het
 * gelezen bestand omzetten in wat de app nodig heeft. Het bouwen en lezen van
 * het IFC zelf staat in `ifcResultaten.ts`, dat ook de MCP-sidecar gebruikt.
 */
import { isTauriApp } from "../lib/tauri";
import { computeEnvelope, type LoadCombination } from "../components/fem/solver/combinations";
import { IFC_RESULTATEN_EXT, IfcResultatenFout, leesIfcResultaten, type IfcResultatenGelezen } from "./ifcResultaten";

/**
 * Schrijft het resultatenbestand weg. Tauri: opslaan-venster met het filter
 * .ifcfemresults, geeft het pad (leeg = geannuleerd). Browser: download, geeft "".
 */
export async function bewaarIfcResultaten(inhoud: string, voorgesteldeNaam: string): Promise<string | null> {
  const naam = voorgesteldeNaam.replace(/[\\/:*?"<>|]/g, "_");
  const metExt = naam.toLowerCase().endsWith(`.${IFC_RESULTATEN_EXT}`) ? naam : `${naam}.${IFC_RESULTATEN_EXT}`;
  if (isTauriApp()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const pad = await save({
      defaultPath: metExt,
      filters: [{ name: "Open FEM Studio resultaten (IFC4)", extensions: [IFC_RESULTATEN_EXT] }],
    });
    if (!pad) return null;
    await writeTextFile(pad, inhoud);
    return pad;
  }
  const blob = new Blob([inhoud], { type: "application/x-step" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = metExt;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return "";
}

/** Het gelezen bestand, klaar voor de app: projecttekst plus de resultaten. */
export function leesIfcResultatenVoorApp(tekst: string): IfcResultatenGelezen & { projectTekst: string } {
  const gelezen = leesIfcResultaten(tekst);
  if (gelezen.projectTekst === null) {
    throw new IfcResultatenFout(
      "Dit IFC-bestand bevat geen Open FEM Studio-projectbestand (set OpenFEM_Projectbestand); " +
      "het model is niet exact te heropenen. Importeer het als rekenmodel via het IFC-tabblad.",
    );
  }
  return { ...gelezen, projectTekst: gelezen.projectTekst };
}

/** De 2D-uitkomsten zoals `fem.setSolverOutputs` ze vraagt; de omhullende volgt uit de opgeslagen combinaties. */
export function solverOutputsUitBestand(gelezen: IfcResultatenGelezen, combinaties: LoadCombination[]) {
  const { perCase, combinaties: combinationResults } = gelezen.tweeD;
  return {
    perCase,
    combinationResults,
    envelope: computeEnvelope(combinaties.filter((c) => combinationResults.has(c.id)), perCase, combinationResults),
  };
}

/**
 * Wacht tot React het zojuist geladen project heeft verwerkt (alle effecten
 * die bij een modelwijziging de resultaten wissen, zijn dan gelopen).
 */
export function wachtTotVerwerkt(): Promise<void> {
  return new Promise((klaar) => {
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (f: () => void) => setTimeout(f, 16);
    raf(() => raf(() => setTimeout(klaar, 50)));
  });
}

/**
 * Extensies zonder app: de sidecar draait het script van een extensie in een
 * eigen `vm`-context (een eigen globaal object, zonder `require` of `process`).
 * Dat is geen beveiligingsgrens zoals de Web Worker in de app: een extensie
 * draait hier met de rechten van de MCP-server. Koppel alleen extensies die je
 * vertrouwt (docs/extensies.md).
 */

/** `node:vm` via process.getBuiltinModule: de sidecarbundel mag geen externe imports hebben. */
interface Vm {
  createContext(sandbox: object): object;
  runInContext(code: string, context: object, opties: { filename: string; timeout: number }): unknown;
}
function vm(): Vm {
  const haal = (globalThis as { process?: { getBuiltinModule?: (naam: string) => unknown } }).process?.getBuiltinModule;
  if (typeof haal !== "function") throw new Error("Extensies draaien zonder app alleen in Node 22.3 of nieuwer (process.getBuiltinModule).");
  return haal("node:vm") as Vm;
}

export interface ExtensieImportInvoer { importerId: string; fileName: string; bytes: Uint8Array }

/** Draai het script en geef zijn `openFemExtension`; gooit een Error met de reden. */
export function laadExtensieScript(tekst: string, bestandsnaam: string): { importFile(invoer: ExtensieImportInvoer): unknown } {
  const node = vm();
  const context = node.createContext({ TextDecoder, TextEncoder, console: { log() {}, warn() {}, error() {} } });
  try {
    node.runInContext(tekst, context, { filename: bestandsnaam, timeout: 60_000 });
  } catch (fout) {
    throw new Error(`Het script ${bestandsnaam} gaf een fout bij het laden: ${fout instanceof Error ? fout.message : String(fout)}`);
  }
  const extensie = (context as { openFemExtension?: { importFile?: unknown } }).openFemExtension;
  if (!extensie || typeof extensie.importFile !== "function") {
    throw new Error(`Het script ${bestandsnaam} zet geen globalThis.openFemExtension met een functie importFile.`);
  }
  return extensie as { importFile(invoer: ExtensieImportInvoer): unknown };
}

import { importeurVoorBestand, keurImportResultaat, keurManifest, type GeladenExtensie } from "../extensies/manifest";
import { ApiFout } from "../api/register";

interface BestandSysteem {
  readFileSync(pad: string): Uint8Array;
  writeFileSync(pad: string, inhoud: string, opties: { flag: string }): void;
  renameSync(van: string, naar: string): void;
  unlinkSync(pad: string): void;
}
interface Paden {
  join(...delen: string[]): string;
  dirname(pad: string): string;
  basename(pad: string): string;
}
function nodeModule<T>(naam: string): T {
  const haal = (globalThis as { process?: { getBuiltinModule?: (naam: string) => unknown } }).process?.getBuiltinModule;
  if (!haal) throw new Error("Bestanden importeren zonder app vereist Node 22.3 of nieuwer.");
  return haal(naam) as T;
}

/** De MCP-sidecar importeert zonder app en schrijft het project pas na strikte keuring. */
export async function opExtensieImporteren(payload: Record<string, unknown>): Promise<unknown> {
  const onbekend = Object.keys(payload).filter((key) => !["path", "saveAs", "importer", "extensionDirs", "disabledIds"].includes(key));
  if (onbekend.length || typeof payload.path !== "string" || !payload.path
      || typeof payload.saveAs !== "string" || !payload.saveAs
      || (payload.importer !== undefined && typeof payload.importer !== "string")
      || !Array.isArray(payload.extensionDirs) || !payload.extensionDirs.every((x) => typeof x === "string")
      || (payload.disabledIds !== undefined && (!Array.isArray(payload.disabledIds) || !payload.disabledIds.every((x) => typeof x === "string")))) {
    throw new ApiFout("INVOER_ONGELDIG", "extensie_importeren verwacht path, saveAs en extensionDirs (lijst met mappen).", { onbekend });
  }
  const fs = nodeModule<BestandSysteem>("node:fs");
  const paden = nodeModule<Paden>("node:path");
  const geladen: GeladenExtensie[] = [];
  for (const map of payload.extensionDirs as string[]) {
    let tekst: string;
    try { tekst = new TextDecoder().decode(fs.readFileSync(paden.join(map, "extension.json"))); }
    catch { continue; }
    const keuring = keurManifest(tekst);
    if (keuring.ok) geladen.push({ map, manifest: keuring.manifest,
      ingeschakeld: !(payload.disabledIds as string[] | undefined)?.includes(keuring.manifest.id) });
  }
  const kandidaten = importeurVoorBestand(geladen, payload.path)
    .filter(({ extensie, importeur }) => payload.importer === undefined || payload.importer === importeur.id
      || payload.importer === `${extensie.manifest.id}/${importeur.id}`);
  if (kandidaten.length === 0) throw new ApiFout("NIET_GEVONDEN", `Geen extensie kan ${payload.path} importeren.`);
  if (kandidaten.length > 1) throw new ApiFout("INVOER_ONGELDIG", "Meerdere importeurs bieden dit bestandstype aan; geef importer op.", {
    importers: kandidaten.map(({ extensie, importeur }) => `${extensie.manifest.id}/${importeur.id}`),
  });
  const { extensie, importeur } = kandidaten[0];
  let script: string;
  let bytes: Uint8Array;
  try {
    script = new TextDecoder().decode(fs.readFileSync(paden.join(extensie.map, extensie.manifest.main)));
    bytes = fs.readFileSync(payload.path);
  } catch (fout) {
    throw new ApiFout("BESTAND_ONLEESBAAR", `Extensiescript of importbestand is niet te lezen: ${String(fout)}`);
  }
  let uitkomst;
  try {
    const resultaat = await laadExtensieScript(script, extensie.manifest.main).importFile({
      importerId: importeur.id, fileName: paden.basename(payload.path), bytes,
    });
    uitkomst = keurImportResultaat(resultaat);
  } catch (fout) {
    throw new ApiFout("BESTAND_ONLEESBAAR", `De extensie kon het bestand niet importeren: ${String(fout)}`);
  }
  const doel = payload.saveAs;
  const tijdelijk = paden.join(paden.dirname(doel), `.${paden.basename(doel)}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  try {
    fs.writeFileSync(tijdelijk, uitkomst.projectTekst, { flag: "wx" });
    fs.renameSync(tijdelijk, doel);
  } catch (fout) {
    try { fs.unlinkSync(tijdelijk); } catch { /* Bestand was nog niet gemaakt. */ }
    throw new ApiFout("BESTAND_ONLEESBAAR", `Projectbestand kon niet worden geschreven: ${String(fout)}`);
  }
  return { path: doel, messages: uitkomst.meldingen, extension: {
    id: extensie.manifest.id, name: extensie.manifest.name, version: extensie.manifest.version,
  } };
}

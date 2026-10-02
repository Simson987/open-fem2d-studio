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
  if (typeof haal !== "function") throw new Error("Extensies draaien zonder app alleen in Node 20.16 of nieuwer (process.getBuiltinModule).");
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

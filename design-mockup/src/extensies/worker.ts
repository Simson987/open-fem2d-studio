import type { ExtensieImportInvoer } from "../mcp/extensieSidecar";

/** Draai een importeur buiten de pagina; ook een vastgelopen script wordt gestopt. */
export function draaiImporteurInWorker(
  scriptTekst: string,
  invoer: ExtensieImportInvoer,
  opties: { tijdslimietMs?: number } = {},
): Promise<unknown> {
  const tijdslimietMs = opties.tijdslimietMs ?? 60_000;
  if (!Number.isFinite(tijdslimietMs) || tijdslimietMs <= 0) {
    return Promise.reject(new Error("De tijdslimiet voor de importeur moet positief zijn."));
  }
  const bootstrap = `
    self.onmessage = async (event) => {
      try {
        const extensie = globalThis.openFemExtension;
        if (!extensie || typeof extensie.importFile !== "function") {
          throw new Error("De extensie zet geen globalThis.openFemExtension met importFile.");
        }
        const uitkomst = await extensie.importFile(event.data);
        self.postMessage({ ok: true, uitkomst });
      } catch (fout) {
        self.postMessage({ ok: false, fout: fout instanceof Error ? fout.message : String(fout) });
      }
    };
  `;
  const url = URL.createObjectURL(new Blob([scriptTekst, "\n;", bootstrap], { type: "text/javascript" }));
  let worker: Worker;
  try {
    worker = new Worker(url);
  } catch (fout) {
    URL.revokeObjectURL(url);
    return Promise.reject(fout);
  }
  return new Promise((resolve, reject) => {
    let klaar = false;
    const opruimen = () => {
      if (klaar) return false;
      klaar = true;
      clearTimeout(klok);
      worker.terminate();
      URL.revokeObjectURL(url);
      return true;
    };
    const klok = setTimeout(() => {
      if (opruimen()) reject(new Error(`De importeur reageerde niet binnen ${tijdslimietMs} ms.`));
    }, tijdslimietMs);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; uitkomst?: unknown; fout?: string }>) => {
      if (!opruimen()) return;
      if (event.data?.ok) resolve(event.data.uitkomst);
      else reject(new Error(event.data?.fout || "De importeur gaf een onbekende fout."));
    };
    worker.onerror = (event) => {
      if (opruimen()) reject(new Error(`Het extensiescript kon niet laden: ${event.message || "onbekende fout"}`));
    };
    // Een kopie voorkomt dat het aanroepen de bytes van de app ontkoppelt.
    const bytes = new Uint8Array(invoer.bytes);
    try {
      worker.postMessage({ ...invoer, bytes }, [bytes.buffer]);
    } catch (fout) {
      opruimen();
      reject(fout);
    }
  });
}

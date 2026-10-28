import { draaiImporteurInWorker } from "../src/extensies/worker";
import { keurImportResultaat } from "../src/extensies/manifest";

declare global {
  interface Window { __extensieTest: { script: string; bytes: number[] } }
}

const tests: { name: string; error?: string }[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); tests.push({ name }); }
  catch (error) { tests.push({ name, error: error instanceof Error ? error.message : String(error) }); }
}
const invoer = { importerId: "demofem", fileName: "voorbeeld.demofem", bytes: Uint8Array.from(window.__extensieTest.bytes) };

void (async () => {
await test("voorbeeldextensie draait in de worker en levert een leesbaar project", async () => {
  const resultaat = await draaiImporteurInWorker(window.__extensieTest.script, invoer);
  const project = keurImportResultaat(resultaat);
  if (!project.projectTekst.includes('"format"') || project.meldingen.length !== 2) {
    throw new Error("Project of importverslag ontbreekt.");
  }
  if (invoer.bytes.byteLength === 0) throw new Error("De originele invoerbytes zijn ontkoppeld.");
});
await test("een vastgelopen script wordt na de tijdslimiet beëindigd", async () => {
  try {
    await draaiImporteurInWorker("for (;;) {}", invoer, { tijdslimietMs: 300 });
    throw new Error("Vastgelopen script werd geaccepteerd.");
  } catch (error) {
    if (!String(error).includes("300 ms")) throw error;
  }
});
await test("een fout uit de importeur komt als melding terug", async () => {
  try {
    await draaiImporteurInWorker('globalThis.openFemExtension = { importFile() { throw Error("testfout"); } };', invoer);
    throw new Error("Fout uit de importeur werd geaccepteerd.");
  } catch (error) {
    if (!String(error).includes("testfout")) throw error;
  }
});
await test("de worker heeft geen pagina of Tauri-kanaal", async () => {
  const result = await draaiImporteurInWorker(
    'globalThis.openFemExtension = { importFile() { return { document: typeof document, tauri: typeof __TAURI_INTERNALS__ }; } };', invoer,
  ) as { document: string; tauri: string };
  if (result.document !== "undefined" || result.tauri !== "undefined") throw new Error(JSON.stringify(result));
});
await test("een script zonder importFile wordt geweigerd", async () => {
  try {
    await draaiImporteurInWorker("globalThis.openFemExtension = {};", invoer);
    throw new Error("Script zonder importFile werd geaccepteerd.");
  } catch (error) {
    if (!String(error).includes("importFile")) throw error;
  }
});

document.getElementById("uitslag")!.textContent = JSON.stringify({ tests, error: null });
})().catch((error) => {
  document.getElementById("uitslag")!.textContent = JSON.stringify({ tests, error: String(error) });
});

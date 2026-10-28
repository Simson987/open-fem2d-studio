// Paginakant van test-bestandskoppeling-recent.mjs: de echte useRecentFiles en
// useBestandskoppeling in React, met alleen de native IPC-grens nagebootst
// (de store-plugin, het command van de wachtrij en het event).
import React, { useCallback } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { useRecentFiles, type RecentFile } from "../src/hooks/useRecentFiles";
import { useBestandskoppeling } from "../src/hooks/useBestandskoppeling";

const tests: { name: string; error?: string }[] = [];
const fouten: string[] = [];
window.addEventListener("unhandledrejection", (e) => { fouten.push(String(e.reason)); e.preventDefault(); });
const tick = () => new Promise((klaar) => setTimeout(klaar, 0));
function ok(waarde: unknown, bericht: string): asserts waarde { if (!waarde) throw Error(bericht); }
async function test(name: string, run: () => Promise<void>) {
  try { await run(); tests.push({ name }); } catch (e) { tests.push({ name, error: String(e) }); }
}

/** De native kant in het klein: de opgeslagen instellingen en de wachtrij van Rust. */
let opgeslagen: Record<string, unknown> = {};
let wachtrij: string[] = [];
const api = window as unknown as Record<string, unknown>;
api.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
  transformCallback: () => 1,
  invoke: async (cmd: string, args: { key?: string; value?: unknown } = {}) => {
    switch (cmd) {
      case "plugin:store|load": return 1;
      case "plugin:store|get": return [opgeslagen[args.key!] ?? null, args.key! in opgeslagen];
      case "plugin:store|set": opgeslagen[args.key!] = args.value; return null;
      case "bestandskoppeling_ophalen": return wachtrij.splice(0);
      case "plugin:event|listen": return 1;
      default: return null;
    }
  },
};
api.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };

/**
 * Zoals App.tsx: de open-weg roept na een paar `await`s (de vraag over
 * niet-opgeslagen werk, de imports, het lezen) `addRecentFile(path)` aan,
 * zonder erop te wachten (`pasProjectToe`). Hier wachten die stappen alleen
 * microtaken: het ergste geval, want dan rendert React niet tussen twee
 * bestanden in. Zo is het ook bij een bestand zonder rapportinstellingen, dat
 * geen zustand-update met voorrang doet.
 */
function Proef() {
  const { recentFiles, loaded, addRecentFile } = useRecentFiles();
  const open = useCallback(async (pad: string) => {
    await Promise.resolve();
    await Promise.resolve();
    void addRecentFile(pad);
  }, [addRecentFile]);
  useBestandskoppeling(open, loaded);
  return <ol id="recent">{recentFiles.map((f) => <li key={f.path}>{f.path}</li>)}</ol>;
}

const host = document.getElementById("root")!;
let root = createRoot(host);
async function monteer() {
  flushSync(() => root.unmount());
  root = createRoot(host);
  flushSync(() => root.render(<Proef />));
  for (let i = 0; i < 20; i++) await tick();
}
const getoond = () => [...host.querySelectorAll("#recent li")].map((li) => li.textContent);
const bewaard = () => ((opgeslagen.recentFiles as RecentFile[] | undefined) ?? []).map((f) => f.path);

async function run() {
  await test("drie bestanden in één ophaalronde staan alle drie in de recente bestanden", async () => {
    opgeslagen = {};
    wachtrij = ["C:\\werk\\a.ifcfem", "C:\\werk\\b.ifcfem2d", "C:\\werk\\c.ifcfem"];
    await monteer();
    ok(wachtrij.length === 0, "de wachtrij is niet opgehaald");
    const verwacht = ["C:\\werk\\c.ifcfem", "C:\\werk\\b.ifcfem2d", "C:\\werk\\a.ifcfem"];
    ok(JSON.stringify(getoond()) === JSON.stringify(verwacht), `getoond: ${JSON.stringify(getoond())}`);
    ok(JSON.stringify(bewaard()) === JSON.stringify(verwacht), `bewaard: ${JSON.stringify(bewaard())}`);
  });
  await test("… bovenop de lijst die al bewaard was", async () => {
    opgeslagen = { recentFiles: [{ path: "D:\\oud\\x.ifcfem", name: "x.ifcfem", type: "project", timestamp: 1 }] };
    wachtrij = ["C:\\werk\\a.ifcfem", "C:\\werk\\b.ifcfem"];
    await monteer();
    const verwacht = ["C:\\werk\\b.ifcfem", "C:\\werk\\a.ifcfem", "D:\\oud\\x.ifcfem"];
    ok(JSON.stringify(getoond()) === JSON.stringify(verwacht), `getoond: ${JSON.stringify(getoond())}`);
    ok(JSON.stringify(bewaard()) === JSON.stringify(verwacht), `bewaard: ${JSON.stringify(bewaard())}`);
  });
  await test("geen onafgehandelde fouten", async () => {
    ok(fouten.length === 0, fouten.join("; "));
  });
}
run().then(() => { document.getElementById("uitslag")!.textContent = JSON.stringify({ tests }); })
  .catch((e) => { document.getElementById("uitslag")!.textContent = JSON.stringify({ tests, error: String(e) }); });

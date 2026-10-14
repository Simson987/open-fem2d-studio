// Externe links openen (issue #38): de helper openExternal(url) in
// src/lib/tauri.ts, met de echte @tauri-apps/plugin-opener en een nagebootste
// IPC-grens (window.__TAURI_INTERNALS__.invoke) en window.open.
//
// Eis: in de desktop-app gaat de link via de opener-plugin naar de standaard-
// browser; buiten Tauri, of als de plugin weigert of ontbreekt, valt hij terug
// op window.open(url, "_blank", "noopener,noreferrer"). Nooit een
// onafgehandelde rejection: de klikhandlers roepen de helper aan zonder catch.
//
//   [1] buiten Tauri: window.open, geen IPC
//   [2] in Tauri: openUrl via de plugin, geen window.open
//   [3] in Tauri, de IPC weigert (rechten, plugin niet geregistreerd): terugval
//   [4] in Tauri, de IPC gooit synchroon: terugval
//   [5] ook window.open faalt: de helper lost toch op
//   [6] zonder window (geen webview): de helper lost op zonder fout
//
// De broncontrole dat alle externe links via deze helper lopen, staat in
// test-tauri-plugin-versies.mjs ([4]).
import { openExternal } from "./src/lib/tauri.ts";

let geslaagd = 0;
let gefaald = 0;
function check(naam, ok, detail = "") {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
}
const onafgehandeld = [];
process.on("unhandledRejection", (reden) => onafgehandeld.push(String(reden)));
const wacht = () => new Promise((klaar) => setTimeout(klaar, 30));
// De helper meldt een mislukte weg met console.warn; hier opvangen en tellen.
const waarschuwingen = [];
console.warn = (...args) => waarschuwingen.push(args.map(String).join(" "));

const URL_ = "https://www.open-aec.com/";
/** Een nagebootste webview; `invoke` bepaalt de Tauri-kant (afwezig = browser). */
function webview({ invoke, openGooit = false } = {}) {
  const geopend = [];
  const aanroepen = [];
  globalThis.window = {
    open: (...args) => {
      geopend.push(args);
      if (openGooit) throw new Error("pop-up geblokkeerd");
      return null;
    },
    ...(invoke ? {
      __TAURI_INTERNALS__: {
        invoke: (cmd, args, options) => { aanroepen.push({ cmd, args, options }); return invoke(cmd, args, options); },
        transformCallback: () => 0,
      },
    } : {}),
  };
  return { geopend, aanroepen };
}
/** Roept de helper aan en vangt een (onterechte) rejection als uitkomst. */
async function open(url) {
  try { await openExternal(url); return "opgelost"; }
  catch (fout) { return `verworpen: ${fout?.message ?? fout}`; }
}

console.log("[1] buiten Tauri");
{
  const { geopend } = webview();
  const uitkomst = await open(URL_);
  await wacht();
  check("de helper lost op", uitkomst === "opgelost", uitkomst);
  check("window.open(url, \"_blank\", \"noopener,noreferrer\")",
    geopend.length === 1 && JSON.stringify(geopend[0]) === JSON.stringify([URL_, "_blank", "noopener,noreferrer"]),
    JSON.stringify(geopend));
}

console.log("\n[2] in Tauri, de opener-plugin opent de link");
{
  const { geopend, aanroepen } = webview({ invoke: () => Promise.resolve(null) });
  const uitkomst = await open(URL_);
  await wacht();
  check("de helper lost op", uitkomst === "opgelost", uitkomst);
  check("één aanroep plugin:opener|open_url met de url",
    aanroepen.length === 1 && aanroepen[0].cmd === "plugin:opener|open_url" && aanroepen[0].args?.url === URL_,
    JSON.stringify(aanroepen));
  check("geen window.open ernaast (de link opent één keer)", geopend.length === 0, JSON.stringify(geopend));
}

console.log("\n[3] in Tauri, de IPC weigert");
{
  const { geopend, aanroepen } = webview({ invoke: () => Promise.reject(new Error("opener.open_url not allowed")) });
  const uitkomst = await open(URL_);
  await wacht();
  check("de helper lost op", uitkomst === "opgelost", uitkomst);
  check("eerst de plugin geprobeerd", aanroepen.length === 1);
  check("de mislukte pluginweg staat als waarschuwing in de console",
    waarschuwingen.length === 1 && waarschuwingen[0].includes("opener-plugin"), JSON.stringify(waarschuwingen));
  check("daarna terugval op window.open met noopener,noreferrer",
    geopend.length === 1 && JSON.stringify(geopend[0]) === JSON.stringify([URL_, "_blank", "noopener,noreferrer"]),
    JSON.stringify(geopend));
}

console.log("\n[4] in Tauri, de IPC gooit synchroon");
{
  const { geopend } = webview({ invoke: () => { throw new TypeError("invoke is geen functie"); } });
  const uitkomst = await open(URL_);
  await wacht();
  check("de helper lost op", uitkomst === "opgelost", uitkomst);
  check("terugval op window.open", geopend.length === 1, JSON.stringify(geopend));
}

console.log("\n[5] de plugin weigert en window.open faalt ook");
{
  const { geopend } = webview({ invoke: () => Promise.reject(new Error("geweigerd")), openGooit: true });
  const uitkomst = await open(URL_);
  await wacht();
  check("de helper lost toch op", uitkomst === "opgelost", uitkomst);
  check("window.open is wel geprobeerd", geopend.length === 1);
}

console.log("\n[6] zonder window");
{
  delete globalThis.window;
  const uitkomst = await open(URL_);
  await wacht();
  check("de helper lost op zonder fout", uitkomst === "opgelost", uitkomst);
}

check("geen onafgehandelde rejection in [1]–[6]", onafgehandeld.length === 0, onafgehandeld.join("; "));
console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

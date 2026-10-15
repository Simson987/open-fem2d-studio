// De UGT-toets van de 3D-MCP-tools (issue #199, besluit B9) is die van de app:
// voor hetzelfde project geeft de MCP-weg (sidecar `staalhal_maken` → Rust →
// `staalhal_uitwerken`, hier met de kern als apart proces in plaats van Rust)
// dezelfde rekenverzoeken en dezelfde toetsinvoer als de knop Berekenen in de
// app (de 3D-tak van `handleSolve` in App.tsx: de resultaten met
// `solveOpenFem3DCombination`, de toets met `bepaalToetsKrachten3D` en
// `toetsSet3D`, de bouwers zoals `runOpenFem3DSteelChecks` en
// `runOpenFem3DTimberChecks` ze aanroepen).
//
//  [1] de verzoeken: elk toetsverzoek van de sidecar is byte voor byte een
//      verzoek dat de app naar de kern stuurt (POST /api/openFem3d/solve), en
//      andersom; zo ook de resultaatverzoeken;
//  [2] de toetsanalyse: dezelfde φ, bron, hergebruik en α_cr per
//      basiscombinatie;
//  [3] de toetsinvoer voor staal en hout: gelijk, inclusief de notities.
//
// Hal: 12 × 10 m, goot 5 m, plat dak, kolommen en spantliggers van staal,
// gordingen van hout (C24) en trek-alleen verbanden; zo doen beide bouwers
// mee en is elke toetsberekening stabiel. Met hout in het model geldt voor de
// toets minstens φ volgens NEN-EN 1995-1-1 (5.1): bij h = 5 m is dat 0,005 =
// 1/200, gelijk aan de vaste noemer van het projectbestand.
//
// ALLEEN_BRON: de app-weg (`solveOpenFem3DCombination`, met de rekenaanroep
// via fetch) zit niet in de bundel. De MCP-weg tegen de bundel staat in
// test-staalhal-sidecar en test-ifc-analyse-sidecar, de Rust-server in
// tests/staalhal_mcp.rs en tests/ifc_import_mcp.rs.
//
// Rekenkern: OPEN_FEM_3D_SOLVER_PATH, anders src-tauri/target/debug/open-fem-3d(.exe).
// Uitvoeren: npx tsx test-toets-3d-mcp.mjs   (vanuit design-mockup/)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { verwerkVerzoek } = await import("./src/mcp/sidecar.ts");
const { maakStaalhal, staalhalProject, STAALHAL_GEVAL } = await import("./src/components/openFem3d/wizards/staalhal.ts");
const { withOpenFem3DSelfWeight } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { solveOpenFem3D, solveOpenFem3DCombination } = await import("./src/components/openFem3d/openFem3dSolver.ts");
const {
  leidScheefstandGeometrieAf3D, metScheefstandRichtingen3D, scheefstandVanCombinatie, toepasselijkeScheefstandNormen3D,
  bepaalScheefstand3D,
} = await import("./src/components/openFem3d/openFem3dScheefstand.ts");
const { bepaalToetsKrachten3D, toetsSet3D } = await import("./src/components/openFem3d/openFem3dToetsKrachten.ts");
const { buildOpenFem3DSteelCheckInputs } = await import("./src/components/openFem3d/openFem3dSteelCheck.ts");
const { buildOpenFem3DTimberCheckInputs } = await import("./src/components/openFem3d/openFem3dTimberCheck.ts");
const { defaultCombinations } = await import("./src/components/fem/solver/combinations.ts");
const { eigenGewichtGeval } = await import("./src/lib/eigenGewicht.ts");

let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};

// ── De kern, als apart proces (zoals Rust en vite.config.ts hem aanroepen) ──
const exe = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const KERN = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${exe}`, import.meta.url));
if (!existsSync(KERN)) {
  log(`  ✗ 3D-kern ontbreekt (${KERN}). Bouw eerst: cargo build -p open-fem-3d`);
  process.exit(1);
}
/** Eén verzoek (als JSON-tekst) door de kern: de uitvoer als tekst, en of het lukte. */
const kern = (tekst) => new Promise((resolve, reject) => {
  const kind = spawn(KERN, [], { stdio: ["pipe", "pipe", "pipe"] });
  const uit = [];
  kind.stdout.on("data", (d) => uit.push(d));
  kind.on("error", reject);
  kind.on("close", (code) => resolve({ ok: code === 0, tekst: Buffer.concat(uit).toString() }));
  kind.stdin.end(tekst);
});
/** De rekenweg van de app in de browser: POST /api/openFem3d/solve; elk verzoek wordt bewaard. */
const appVerzoeken = [];
globalThis.fetch = async (url, options) => {
  if (url !== "/api/openFem3d/solve") throw new Error(`onbekende url ${url}`);
  appVerzoeken.push(options.body);
  const { ok, tekst } = await kern(options.body);
  return { ok, status: ok ? 200 : 500, json: async () => JSON.parse(tekst) };
};

// ── De hal ───────────────────────────────────────────────────────────────────
const halInvoer = {
  lengteMm: 12000, breedteMm: 10000, aantalVakken: 2, goothoogteMm: 5000,
  dak: { type: "platdak" }, gordingafstandMm: 2500,
  profielen: { gording: { materiaal: "C24", profiel: "80x200" } },
  verbanden: { trekAlleen: true },
};
const hal = maakStaalhal(halInvoer);

// ── De MCP-weg: sidecar → kern → sidecar ─────────────────────────────────────
log("[1] de MCP-weg (sidecar → kern → sidecar)");
let volgnummer = 0;
const vraag = (op, payload) => verwerkVerzoek({ v: 1, id: ++volgnummer, op, payload });
const gemaakt = vraag("staalhal_maken", { hal: halInvoer, reken: {} });
check("staalhal_maken met reken slaagt", gemaakt.ok, JSON.stringify(gemaakt.error));
const resultaten = {};
for (const v of gemaakt.result.rekenverzoeken) {
  const { ok, tekst } = await kern(JSON.stringify(v.verzoek));
  if (!ok) throw new Error(`${v.sleutel}: ${tekst.slice(0, 300)}`);
  resultaten[v.sleutel] = JSON.parse(tekst);
}
const toetsresultaten = {};
for (const v of gemaakt.result.toetsverzoeken) {
  const { ok, tekst } = await kern(JSON.stringify(v.verzoek));
  toetsresultaten[v.sleutel] = ok ? { resultaat: JSON.parse(tekst) } : { fout: JSON.parse(tekst).fout };
}
const uitgewerkt = vraag("staalhal_uitwerken", { hal: gemaakt.result.parameters, reken: {}, resultaten, toetsresultaten });
check("staalhal_uitwerken slaagt, zonder weigering", uitgewerkt.ok && !uitgewerkt.result.toetsweigering,
  JSON.stringify(uitgewerkt.error ?? uitgewerkt.result?.toetsweigering)?.slice(0, 400));
const mcp = uitgewerkt.result;

// ── De app-weg: zoals de 3D-tak van handleSolve (App.tsx) ────────────────────
log("[2] de app-weg (handleSolve, 3D-tak)");
// Het project zoals de app het opent: geen scheefstandvelden → vast 1/200, schakelaar uit.
const project = staalhalProject(hal);
const eg = eigenGewichtGeval(hal.loadCases, hal.selfWeightEnabled);
const rekenmodel = eg ? withOpenFem3DSelfWeight(hal.model, eg.id) : hal.model;
const opties = {
  permanentCaseIds: hal.loadCases.filter((c) => c.type === "dead").map((c) => c.id),
  ...(eg ? { selfWeightCaseId: eg.id } : {}),
};
const belast = new Set([...(rekenmodel.loads ?? []), ...(rekenmodel.memberLoads ?? [])].map((l) => l.caseId ?? 1));
// φ per richting (issue #194); de schakelaar staat uit, dus geen scheefstand in de resultaten.
const scheefstandPhi = project.scheefstandEnabled ? { x: 1, y: 1 } : null;
const combinaties = metScheefstandRichtingen3D(defaultCombinations(hal.loadCases)
  .filter((c) => [...belast].some((id) => (c.factors.get(id) ?? 0) !== 0)), scheefstandPhi, { bgt: true });
const combinationResults = new Map(await Promise.all(combinaties.map(async (c) =>
  [c.id, await solveOpenFem3DCombination(rekenmodel, c.factors, "linear", scheefstandVanCombinatie(c, scheefstandPhi), opties)])));
// Het resultaat van het actieve geval (Permanent), zoals `result` in handleSolve.
const basis = await solveOpenFem3D(rekenmodel, STAALHAL_GEVAL.permanent, "linear", opties);
const normen = toepasselijkeScheefstandNormen3D(hal.model);
const toets = await bepaalToetsKrachten3D({
  model: rekenmodel,
  combinaties,
  scheefstand: {
    project: bepaalScheefstand3D({ bron: "vast", noemer: 200, hoogteM: null, aantalElementen: null },
      leidScheefstandGeometrieAf3D(hal.model), normen),
    normen,
    modelAan: false,
  },
  resultaten: { combinationResults, phi: scheefstandPhi },
}, (run) => solveOpenFem3DCombination(rekenmodel, run.combinatie.factors, run.analyse, run.scheefstand,
  { ...opties, bucklingModes: run.bucklingModes, tweedeOrdeVerplicht: run.analyse === "p-delta" }));
check("de app-toets heeft krachten", toets.weigering === null, JSON.stringify(toets.weigering));
const combinationSet = toetsSet3D(toets, { combinaties, combinationResults, loadCases: hal.loadCases, consequenceClass: "CC2" });
const appStaal = buildOpenFem3DSteelCheckInputs(hal.model, basis, combinationSet);
const appHout = buildOpenFem3DTimberCheckInputs(hal.model, basis, combinationSet);

// ── [1] De verzoeken ─────────────────────────────────────────────────────────
log("[3] dezelfde rekenverzoeken");
const appSet = new Set(appVerzoeken);
const mcpToets = gemaakt.result.toetsverzoeken.map((v) => JSON.stringify(v.verzoek));
const mcpResultaat = gemaakt.result.rekenverzoeken
  .filter((v) => v.soort === "combinatie" || v.id === STAALHAL_GEVAL.permanent).map((v) => JSON.stringify(v.verzoek));
check(`elk van de ${mcpToets.length} toetsverzoeken van de MCP-weg is byte voor byte een verzoek van de app`,
  mcpToets.length === 4 * combinaties.filter((c) => c.type === "uls").length && mcpToets.every((t) => appSet.has(t)),
  `${mcpToets.filter((t) => !appSet.has(t)).length} afwijkend`);
check(`elk combinatieverzoek van de resultaten (en het geval Permanent) is byte voor byte een verzoek van de app`,
  mcpResultaat.every((t) => appSet.has(t)), `${mcpResultaat.filter((t) => !appSet.has(t)).length} afwijkend`);
const mcpAlles = new Set([...mcpToets, ...mcpResultaat]);
check("de app stuurt geen verzoek dat de MCP-weg niet stuurt",
  appVerzoeken.every((t) => mcpAlles.has(t)), `${appVerzoeken.filter((t) => !mcpAlles.has(t)).length} verzoeken alleen in de app`);

// ── [2] De toetsanalyse ──────────────────────────────────────────────────────
log("[4] dezelfde toetsanalyse");
const t = mcp.toetsanalyse;
check("φ, noemer, bron en hergebruik gelijk aan de app (1/200, vast, niet hergebruikt)",
  t.scheefstand.phi === toets.analyse.phi && t.scheefstand.noemer === toets.analyse.noemer
  && t.scheefstand.bron === toets.analyse.bron && t.hergebruikt === toets.analyse.hergebruikt
  && toets.analyse.phi === 1 / 200 && toets.analyse.bron === "vast",
  JSON.stringify([t.scheefstand, toets.analyse]));
check("α_cr per UGT-basiscombinatie gelijk aan de app",
  JSON.stringify(t.alpha_cr.map((x) => [x.combination_id, x.alpha_cr])) ===
  JSON.stringify(toets.alphaCr.map((x) => [x.combinatieId, x.alphaCr])),
  JSON.stringify([t.alpha_cr.map((x) => x.alpha_cr), toets.alphaCr.map((x) => x.alphaCr)]));
check("dezelfde meldingen (hout: E_mean en 2·L, B10)",
  JSON.stringify(t.meldingen) === JSON.stringify(toets.meldingen) && t.meldingen.some((m) => m.includes("E_mean")),
  JSON.stringify(t.meldingen));

// ── [3] De toetsinvoer ───────────────────────────────────────────────────────
log("[5] dezelfde toetsinvoer");
const gelijk = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check(`staal: ${appStaal.inputs.length} toetsinvoeren, gelijk aan de app`,
  appStaal.inputs.length > 0 && gelijk(mcp.toetsinvoer, appStaal.inputs));
check(`hout: ${appHout.inputs.length} toetsinvoeren, gelijk aan de app`,
  appHout.inputs.length > 0 && gelijk(mcp.houtToetsinvoer, appHout.inputs));
check("dezelfde notities en overgeslagen staven",
  gelijk(mcp.notities, appStaal.notes) && gelijk(mcp.houtNotities, appHout.notes)
  && gelijk(mcp.nietGetoetst, appStaal.skipped) && gelijk(mcp.houtNietGetoetst, appHout.skipped));
const ugtIds = new Set(appStaal.inputs.flatMap((x) => x.forces_envelope.map((p) => p.combination_id)));
check("de UGT-krachten komen uit de toetsvarianten (id + k·1 000 000), niet uit de resultaten",
  [...ugtIds].some((id) => id >= 1_000_000) && [...ugtIds].every((id) => toets.combinationResults.has(id)),
  JSON.stringify([...ugtIds]));

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
if (gefaald > 0) process.exit(1);

// Drie wegen naar dezelfde toetsing (issue #199, de sidecar en MCP): de UGT-toets
// rekent altijd tweede orde (P-Δ) met scheefstand, en dat geeft langs elke weg
// dezelfde toetsinvoer en dezelfde unity check:
//   - de APP: `handleRunMemberChecks` uit de AST van App.tsx
//     (scripts/bron-uitvoeren.mjs), de echte checkStore en bouwers, en de
//     toetsbrug als kern (de weg van de dev-brug, `/api/toetsing`);
//   - de SIDECAR uit de bron: `verwerkVerzoek` met `op: "check"`;
//   - MCP: `check_fem_model` via de gebouwde MCP-server (de ingebakken bundel en
//     de Rust-kernen in die binary).
// Per model wordt bewaakt:
//   1. de staal- en houtinvoer van de kern is in alle drie bit-gelijk;
//   2. de UC per staaf en de maatgevende toets van de app zijn die van MCP;
//   3. de toetsanalyse: app (`lastRunData.toets.analyse`) en MCP (`stability`)
//      noemen dezelfde soort, φ, bron, hergebruik en schakelaarstand.
// Modellen:
//   A. een portaal HEA 200 / IPE 300 met wind, eerste orde, scheefstand uit
//      (de beginstand van een nieuw model): de toets rekent zelf P-Δ;
//   B. hetzelfde portaal als projectbestand op P-Δ met de scheefstand aan: de
//      toets hergebruikt de resultaten;
//   C. een houten kolom (C24) met een vrije kop: de toets rekent P-Δ met de
//      φ van NEN-EN 1995-1-1 (5.1) als ondergrens, met de houtmelding;
//   D. het portaal met de normbron EN 1993-1-1 (5.5) en de schakelaar uit;
//   E. de houten kolom met een vaste noemer 300: de toets verhoogt φ naar
//      1/200 (EN 1995 (5.1)), met de melding, één keer in het rapport.
//
// Uitvoeren: npx tsx test-toets-drie-wegen.mjs   (vanuit design-mockup/)
// Vereist: cargo build --release -p toetsbrug -p openaec-mcp-server (vanuit
// src-tauri), na `npm run build:sidecar`.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { declaratie, leesBron, voerUitIn } from "./scripts/bron-uitvoeren.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const RELEASE = join(resolve(HIER, ".."), "src-tauri", "target", "release");
const EXE = process.platform === "win32" ? ".exe" : "";
const TOETSBRUG = join(RELEASE, `toetsbrug${EXE}`);
const MCP_SERVER = join(RELEASE, `openaec-mcp-server${EXE}`);

const { combineResults, metScheefstandRichtingen, SCHEEFSTAND_COMBO_OFFSET } =
  await import("./src/components/fem/solver/combinations.ts");
const { solveAllCases, solveAllCasesNonlinear } = await import("./src/components/fem/solver/engine.ts");
const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");
const { bepaalScheefstand, leidScheefstandGeometrieAf, toepasselijkeScheefstandNormen } =
  await import("./src/lib/scheefstandNorm.ts");
const { useCheckStore, getProfileDb, getTimberGrades } = await import("./src/stores/checkStore.ts");
const { combinationsFromFile } = await import("./src/io/projectFile.ts");
const { verwerkVerzoek } = await import("./src/mcp/sidecar.ts");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function check(naam, voorwaarde, detail = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}`); }
  else            { failed++; log(`  ✗ ${naam}${detail ? ` — ${detail}` : ""}`); }
}

for (const [naam, pad] of [["toetsbrug", TOETSBRUG], ["openaec-mcp-server", MCP_SERVER]]) {
  if (!existsSync(pad)) {
    failed++;
    log(`  ✗ ${naam} ontbreekt (${pad}). Bouw eerst: cargo build --release -p toetsbrug -p openaec-mcp-server`);
  }
}
if (failed > 0) {
  log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(1);
}
// De dev-brug (`/api/toetsing`) nagebootst met de echte toetsbrug.
globalThis.fetch = async (_url, init) => {
  const r = spawnSync(TOETSBRUG, [], { input: init.body, maxBuffer: 1 << 28 });
  return { ok: r.status === 0, status: r.status === 0 ? 200 : 400, text: async () => r.stdout.toString() };
};

// ── De modellen ─────────────────────────────────────────────────────────────
//
// A en B: portaal, kolommen HEA 200 (h = 4000 mm, ingeklemd), ligger IPE 300
// (6000 mm), S235. G = 10 kN/m en Q = 6 kN/m op de ligger, W = 8 kN op de
// linkerkop. UGT: 1,35·G; 1,2·G + 1,5·Q; 1,2·G + 1,5·W (+ 0 Q). BGT: G + Q en
// G + W. C: houten kolom C24 100x200, h = 3000 mm, ingeklemd, G = 20 kN en
// W = 1 kN op de kop.
const LC = [
  { id: 1, name: "G", type: "dead" },
  { id: 2, name: "Q", type: "live", categorie: "A" },
  { id: 3, name: "W", type: "wind" },
];
const portaal = (extra = {}) => ({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: 4000 }, { id: 3, x: 6000, z: 4000 }, { id: 4, x: 6000, z: 0 }],
  beams: [
    { id: 1, from: 1, to: 2, material: "S235", profile: "HEA200" },
    { id: 2, from: 2, to: 3, material: "S235", profile: "IPE300" },
    { id: 3, from: 4, to: 3, material: "S235", profile: "HEA200" },
  ],
  supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 4, type: "fixed" }],
  plates: [],
  loadCases: LC,
  loads: [
    { id: 1, type: "lineLoad", caseId: 1, beamId: 2, q: -10 },
    { id: 2, type: "lineLoad", caseId: 2, beamId: 2, q: -6 },
    { id: 3, type: "pointForce", caseId: 3, nodeId: 2, fx: 8 },
  ],
  selfWeightEnabled: false,
  scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
  ...extra,
});
const houtKolom = () => ({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: 3000 }],
  beams: [{ id: 1, from: 1, to: 2, material: "C24", profile: "100x200" }],
  supports: [{ nodeId: 1, type: "fixed" }],
  plates: [],
  loadCases: [LC[0], LC[2]],
  loads: [
    { id: 1, type: "pointForce", caseId: 1, nodeId: 2, fz: -20 },
    { id: 2, type: "pointForce", caseId: 3, nodeId: 2, fx: 1 },
  ],
  selfWeightEnabled: false,
  scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
});
/** Combinaties in de vorm van het projectbestand en van `combinations` bij MCP. */
const COMBI_PORTAAL = [
  { id: 1, name: "1,35G", type: "uls", formula: "", factors: { 1: 1.35 } },
  { id: 2, name: "1,2G+1,5Q", type: "uls", formula: "", factors: { 1: 1.2, 2: 1.5 } },
  { id: 3, name: "1,2G+1,5W", type: "uls", formula: "", factors: { 1: 1.2, 3: 1.5 } },
  { id: 4, name: "G+Q", type: "sls", formula: "", factors: { 1: 1, 2: 1 } },
  { id: 5, name: "G+W", type: "sls", formula: "", factors: { 1: 1, 3: 1 } },
];
const COMBI_HOUT = [
  { id: 1, name: "1,35G", type: "uls", formula: "", factors: { 1: 1.35 } },
  { id: 3, name: "1,2G+1,5W", type: "uls", formula: "", factors: { 1: 1.2, 3: 1.5 } },
  { id: 5, name: "G+W", type: "sls", formula: "", factors: { 1: 1, 3: 1 } },
];

/** Een projectbestand met dit model, deze combinaties en dit analysetype. */
const projectbestand = (m, combinaties, analysetype) => JSON.stringify({
  format: "open-fem-studio-v2", version: 2, savedAt: "2026-10-15T00:00:00Z",
  ...m, combinations: combinaties, activeLoadCaseId: 1,
  nonlinearEnabled: analysetype !== "eersteOrde", analysetype,
});

// ── Weg 1: de app ───────────────────────────────────────────────────────────
const app = leesBron("src/App.tsx");

async function viaApp(m, combinaties, analysetype) {
  const aan = m.scheefstandEnabled;
  const basis = bouwMultiInput(m);
  const { perCase } = analysetype === "eersteOrde" ? solveAllCases(basis) : solveAllCasesNonlinear(basis);
  const actieveCombinaties = metScheefstandRichtingen(combinationsFromFile(combinaties), aan, m.scheefstandRichting);
  const resultaten = new Map(actieveCombinaties.map((c) => [c.id, combineResults(c, perCase)]));
  const fem = {
    nodes: m.nodes, beams: m.beams, supports: m.supports, plates: m.plates,
    actieveCombinaties, gevolgklasse: "CC2", nationaleBijlage: "NL", loadCases: m.loadCases,
    analysetype, scheefstandEnabled: aan, scheefstandRichting: m.scheefstandRichting,
    betonKruipcoefficient: null, betonKruipInvoer: null, combinationResults: null, multiLcResult: null,
  };
  useCheckStore.getState().clear();
  const handle = await voerUitIn(app, declaratie(app, "handleRunMemberChecks"), {
    fem, rekenGeneratieRef: { current: 0 }, rekenFoutRef: { current: null }, laatsteMultiInputRef: { current: null },
    gemeldeWeigeringRef: { current: null },
    // De FOUT in Inzichten bij een geweigerde toets (taak 7); hier geen onderwerp.
    setStabiliteitsMelding() {},
    dynamischeImport: async () => ({ notifyInfo() {}, notifyWarning() {} }),
    setActiveView() {},
    i18next: { t: (k) => k },
    checkRun: (d) => useCheckStore.getState().run(d),
    checkWeiger: (reden) => useCheckStore.getState().weiger(reden),
    computeAndStoreSolverOutputs: () => { throw new Error("de rekengang is meegegeven"); },
    rekenToetsFysisch: async () => { throw new Error("geen fysisch niet-lineaire ronde bij P-Δ"); },
    // De φ zoals de app hem bepaalt (`scheefstandUitkomst` in App.tsx).
    scheefstandUitkomst: bepaalScheefstand(
      {
        bron: m.scheefstandBron ?? "vast", noemer: m.scheefstandNoemer,
        hoogteM: m.scheefstandHoogteM ?? null, aantalElementen: m.scheefstandAantalElementen ?? null,
      },
      leidScheefstandGeometrieAf(m), toepasselijkeScheefstandNormen(m.beams),
    ),
  });
  await handle({ openPanel: false, outputs: { combinationResults: resultaten, perCase, multiInput: basis } });
  return useCheckStore.getState();
}

// ── Weg 2: de sidecar uit de bron ───────────────────────────────────────────
const profielen = [...(await getProfileDb()).values()];
const houtklassen = await getTimberGrades();

function viaSidecar(payload) {
  const a = verwerkVerzoek({ v: 1, id: 1, op: "check", payload: { ...payload, profiles: profielen, timber_grades: houtklassen } });
  return a.ok ? a.result : { fout: a.error };
}

// ── Weg 3: MCP ──────────────────────────────────────────────────────────────
function mcp(aanroepen) {
  return new Promise((klaar, mis) => {
    const k = spawn(MCP_SERVER, [], { stdio: ["pipe", "pipe", "pipe"] });
    const klok = setTimeout(() => { k.kill(); mis(new Error("MCP-server reageerde niet binnen 180 s")); }, 180_000);
    let buf = "";
    const antwoorden = new Map();
    k.on("error", (e) => { clearTimeout(klok); mis(e); });
    k.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const regel = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!regel) continue;
        const bericht = JSON.parse(regel);
        antwoorden.set(bericht.id, bericht);
        if (antwoorden.size === aanroepen.length + 1) {
          clearTimeout(klok);
          k.stdin.end();
          klaar(aanroepen.map((_, n) => antwoorden.get(n + 2)));
        }
      }
    });
    const schrijf = (o) => k.stdin.write(JSON.stringify(o) + "\n");
    schrijf({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-toets-drie-wegen", version: "1" } } });
    aanroepen.forEach((a, n) => schrijf({ jsonrpc: "2.0", id: n + 2, method: "tools/call", params: { name: "check_fem_model", arguments: a } }));
  });
}
const inhoud = (x) => (x?.result?.isError ? { fout: x.result.structuredContent } : x?.result?.structuredContent);

// ── De vergelijking ─────────────────────────────────────────────────────────
/**
 * JSON met de sleutels op volgorde. De MCP-server zet het antwoord om via
 * serde_json, en die sorteert de sleutels van een object; de waarden (ook elke
 * float) komen ongewijzigd terug. Vergeleken wordt dus de inhoud, bit voor bit.
 */
const json = (x) => JSON.stringify(x, (_k, v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
    : v);
/** UC en maatgevende toets per staaf, gesorteerd op staafnummer. */
const ucs = (lijst) => (lijst ?? []).map((r) => ({ id: r.beam_id, uc: r.uc_max, toets: r.governing_check_id, status: r.status }))
  .sort((a, b) => a.id - b.id);

function vergelijk(titel, s, sidecar, viaMcp, verwacht) {
  log(`\n${titel}`);
  check("app: de toetsing liep zonder fout", s.error === null && s.results.length > 0, String(s.error));
  check("sidecar: geslaagd", sidecar && !sidecar.fout, json(sidecar?.fout));
  check("MCP: geslaagd", viaMcp && !viaMcp.fout, json(viaMcp?.fout));
  if (!sidecar || sidecar.fout || !viaMcp || viaMcp.fout || s.error) return;

  const a = s.lastRunData.toets.analyse;
  const st = viaMcp.stability;
  check(`toetsanalyse: ${verwacht.soort}, φ = 1/${verwacht.noemer.toFixed(2)}, bron ${verwacht.bron}, hergebruikt ${verwacht.hergebruikt}`,
    a.soort === verwacht.soort && Math.abs(a.noemer - verwacht.noemer) <= 1e-9 * verwacht.noemer
      && a.bron === verwacht.bron && a.hergebruikt === verwacht.hergebruikt,
    json(a));
  check("MCP noemt dezelfde toetsanalyse als de app",
    st.analysis_type === a.soort && st.scheefstand.phi === a.phi && st.scheefstand.noemer === a.noemer
      && st.scheefstand.bron === a.bron && st.scheefstand.model_scheefstand_aan === a.scheefstandModelAan
      && st.scheefstand.afgedwongen === true && st.hergebruikt === a.hergebruikt,
    json({ app: a, mcp: st }));
  check("de sidecar uit de bron noemt dezelfde toetsanalyse als MCP", json(sidecar.stability) === json(st),
    json({ sidecar: sidecar.stability, mcp: st }));
  check("α_cr van de toets: dezelfde basiscombinaties en waarden in app en MCP",
    json(s.lastRunData.stabiliteit.alphaCr.map((u) => [u.combinatieId, u.alphaCr]))
      === json(st.alpha_cr.map((u) => [u.combination_id, u.alpha_cr])),
    json({ app: s.lastRunData.stabiliteit.alphaCr, mcp: st.alpha_cr }));
  check("de toetsmeldingen van de app staan ook in de MCP-waarschuwingen",
    s.lastRunData.toets.meldingen.every((m) => viaMcp.warnings.includes(m)), json(s.lastRunData.toets.meldingen));

  const inv = s.lastRunInputs;
  for (const [soort, app, sc, m] of [
    ["staal", inv.steel, sidecar.steel_check_inputs, viaMcp.steel_check_inputs],
    ["hout", inv.timber, sidecar.timber_check_inputs, viaMcp.timber_check_inputs],
  ]) {
    check(`${soort}invoer: app = sidecar = MCP, bit voor bit (${app.length} staven)`,
      app.length === verwacht[soort] && json(app) === json(sc) && json(sc) === json(m),
      app.length !== verwacht[soort] ? `${app.length} staven, verwacht ${verwacht[soort]}`
        : json(app).slice(0, 300) + " … " + json(m).slice(0, 300));
  }
  const ucApp = ucs(s.results);
  const ucMcp = ucs([...(viaMcp.results ?? []), ...(viaMcp.timber_results ?? [])]);
  check("UC en maatgevende toets per staaf: app = MCP", json(ucApp) === json(ucMcp), json({ app: ucApp, mcp: ucMcp }));
  log(`    UC: ${ucApp.map((u) => `staaf ${u.id} ${u.uc.toFixed(4)} (${u.toets})`).join("; ")}`);
  // Elke UGT-toetscombinatie in +x en −x: de tegengestelde richting onder
  // id + 1 000 000, ook als de schakelaar uit staat.
  const ids = new Set((inv.steel[0] ?? inv.timber[0]).forces_envelope.map((p) => p.combination_id));
  check("de krachten van de toets bevatten beide richtingen van elke UGT-combinatie",
    verwacht.ugt.every((id) => ids.has(id) && ids.has(id + SCHEEFSTAND_COMBO_OFFSET)), json([...ids]));
}

const map = mkdtempSync(join(tmpdir(), "toets-drie-wegen-"));
try {
  const bestandB = join(map, "portaal-pdelta.ifcfem");
  const mB = portaal({ scheefstandEnabled: true });
  writeFileSync(bestandB, projectbestand(mB, COMBI_PORTAAL, "tweedeOrdeGeometrisch"));

  const mD = portaal({ scheefstandBron: "en1993" });
  const mE = { ...houtKolom(), scheefstandNoemer: 300 };
  const [mcpA, mcpB, mcpC, mcpD, mcpE] = (await mcp([
    { model: portaal(), combinations: COMBI_PORTAAL },
    { project_path: bestandB },
    { model: houtKolom(), combinations: COMBI_HOUT },
    { model: mD, combinations: COMBI_PORTAAL },
    { model: mE, combinations: COMBI_HOUT },
  ])).map(inhoud);

  const sA = await viaApp(portaal(), COMBI_PORTAAL, "eersteOrde");
  vergelijk("[A] Portaal, eerste orde, scheefstand uit: de toets rekent zelf P-Δ met φ = 1/200",
    sA, viaSidecar({ model: portaal(), combinations: COMBI_PORTAAL }), mcpA,
    { soort: "tweedeOrdeGeometrisch", noemer: 200, bron: "vast", hergebruikt: false, staal: 3, hout: 0, ugt: [1, 2, 3] });

  const sB = await viaApp(mB, COMBI_PORTAAL, "tweedeOrdeGeometrisch");
  vergelijk("[B] Portaal als projectbestand, P-Δ met de scheefstand aan: de toets hergebruikt de resultaten",
    sB, viaSidecar({ project: { inhoud: projectbestand(mB, COMBI_PORTAAL, "tweedeOrdeGeometrisch") } }), mcpB,
    { soort: "tweedeOrdeGeometrisch", noemer: 200, bron: "vast", hergebruikt: true, staal: 3, hout: 0, ugt: [1, 2, 3] });
  if (!sA.error && !sB.error) {
    check("[A] en [B] geven dezelfde UGT-toetsinvoer: de schakelaar en het analysetype gelden alleen voor de resultaten",
      json(sA.lastRunInputs.steel.map((i) => i.forces_envelope)) === json(sB.lastRunInputs.steel.map((i) => i.forces_envelope)));
  }

  const sC = await viaApp(houtKolom(), COMBI_HOUT, "eersteOrde");
  vergelijk("[C] Houten kolom: P-Δ met φ = 1/200 (NEN-EN 1995-1-1 (5.1) bij h = 3 m geeft hetzelfde), met de houtmelding",
    sC, viaSidecar({ model: houtKolom(), combinations: COMBI_HOUT }), mcpC,
    { soort: "tweedeOrdeGeometrisch", noemer: 200, bron: "vast", hergebruikt: false, staal: 0, hout: 1, ugt: [1, 3] });
  check("[C] de houtmelding (E_mean, 2·L) staat in de MCP-waarschuwingen",
    (mcpC?.warnings ?? []).some((w) => w.startsWith("Hout in de toets") && w.includes("2·L")), json(mcpC?.warnings));

  // D: de normbron EN 1993-1-1 (5.5) met de schakelaar UIT. De resultaten
  // hebben dan geen scheefstand, maar de toets rekent met de φ van die bron —
  // ook langs MCP, dus de sidecar leidt φ af terwijl de schakelaar uit staat.
  // Hand: h = 4 m → α_h = 2/√4 = 1,0; m = 2 kolommen → α_m = √(0,5·(1 + 1/2))
  // = 0,8660; φ = 1/200 · 1,0 · 0,8660 = 1/230,94.
  const noemerD = 1 / ((1 / 200) * 1.0 * Math.sqrt(0.5 * (1 + 1 / 2)));
  const sD = await viaApp(mD, COMBI_PORTAAL, "eersteOrde");
  vergelijk(`[D] Portaal met normbron EN 1993-1-1 (5.5) en de schakelaar uit: de toets rekent φ = 1/${noemerD.toFixed(2)}`,
    sD, viaSidecar({ model: mD, combinations: COMBI_PORTAAL }), mcpD,
    { soort: "tweedeOrdeGeometrisch", noemer: noemerD, bron: "en1993", hergebruikt: false, staal: 3, hout: 0, ugt: [1, 2, 3] });
  check("[D] de vaste regel noemt φ en de normbron met h en m",
    (mcpD?.warnings ?? []).some((w) => w.startsWith("Toetskrachten:") && w.includes("φ = 1/230,9") && w.includes("EN 1993-1-1 (5.5)") && w.includes("m = 2")),
    json((mcpD?.warnings ?? []).filter((w) => w.startsWith("Toetskrachten:"))));
  if (!sA.error && !sD.error) {
    check("[D] een kleinere φ dan in [A] geeft een kleinere kolom-UC (de scheefstand zit echt in de toets)",
      sD.results.find((r) => r.beam_id === 1).uc_max < sA.results.find((r) => r.beam_id === 1).uc_max,
      `${sD.results.find((r) => r.beam_id === 1).uc_max} tegen ${sA.results.find((r) => r.beam_id === 1).uc_max}`);
  }

  // E: hout met een vaste noemer 300 in de projectinstelling. Hand: NEN-EN
  // 1995-1-1 (5.1) φ = 0,005 bij h = 3 m ≤ 5 m, dus 1/200 > 1/300: de toets
  // VERHOOGT φ naar 1/200, bron EN 1995, met een melding — langs alle drie de
  // wegen dezelfde. (C dekt dit pad niet: daar is de noemer al 200.)
  const sE = await viaApp(mE, COMBI_HOUT, "eersteOrde");
  const sidecarE = viaSidecar({ model: mE, combinations: COMBI_HOUT });
  vergelijk("[E] Houten kolom met vaste noemer 300: de toets verhoogt φ naar 1/200 volgens NEN-EN 1995-1-1 (5.1)",
    sE, sidecarE, mcpE,
    { soort: "tweedeOrdeGeometrisch", noemer: 200, bron: "en1995", hergebruikt: false, staal: 0, hout: 1, ugt: [1, 3] });
  const verhoogd = (m) => /Scheefstand in de toets verhoogd naar φ = 1\/200 volgens NEN-EN 1995-1-1 \(5\.1\)/.test(m);
  check("[E] app: de verhogingsmelding in de toetsmeldingen", (sE.lastRunData?.toets?.meldingen ?? []).some(verhoogd),
    json(sE.lastRunData?.toets?.meldingen));
  check("[E] sidecar en MCP: de verhogingsmelding in `warnings`",
    (sidecarE?.warnings ?? []).some(verhoogd) && (mcpE?.warnings ?? []).some(verhoogd), json(mcpE?.warnings));
  // De melding staat in het scheefstandblok van het rapport, en NIET nog eens
  // in de analysetoelichting (die twee blokken staan beide in rapport en PDF).
  const telVerhoogd = (t) => (t ?? "").split("\n").filter(verhoogd).length;
  check("[E] MCP: de verhogingsmelding één keer in scheefstand_toelichting en niet in analyse_toelichting",
    telVerhoogd(mcpE?.scheefstand_toelichting) === 1 && telVerhoogd(mcpE?.analyse_toelichting) === 0,
    json({ scheef: mcpE?.scheefstand_toelichting, analyse: mcpE?.analyse_toelichting }));
} finally {
  rmSync(map, { recursive: true, force: true });
}

log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed === 0 ? 0 : 1);

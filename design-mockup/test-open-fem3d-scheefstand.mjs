// Initiële scheefstand in 3D (NEN-EN 1993-1-1 §5.3.2): h en m uit het
// 3D-model, φ uit dezelfde normfunctie als 2D, UGT-combinaties in vier
// richtingen, en op elke verticale last V een horizontale last φ·V. Blok [4]
// voert de rekenroute van de app uit (scripts/bron-uitvoeren.mjs) in plaats
// van de broncode te lezen.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { declaratie, jsxAttribuut, leesBron, stateNaden, voerUitIn } from "./scripts/bron-uitvoeren.mjs";
const {
  leidScheefstandGeometrieAf3D, metScheefstandRichtingen3D, metScheefstandLasten,
  scheefstandVanCombinatie, toepasselijkeScheefstandNormen3D,
} = await import("./src/components/openFem3d/openFem3dScheefstand.ts");
const { bepaalScheefstand, scheefstandToelichting } = await import("./src/lib/scheefstandNorm.ts");
const { parseOpenFem3DModel, withOpenFem3DSelfWeight, openFem3DMemberAxes, openFem3DGlobalDirectionVector, openFem3DGlobalMemberLoadFactor } =
  await import("./src/components/openFem3d/openFem3dModel.ts");
const { buildOpenFem3DSolveRequest } = await import("./src/components/openFem3d/openFem3dSolver.ts");
const { SCHEEFSTAND_COMBO_OFFSET } = await import("./src/components/fem/solver/combinations.ts");
const HIER = dirname(fileURLToPath(import.meta.url));
let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => { if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); } };
const dichtbij = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// Raamwerk 6 × 5 m, twee verdiepingen van 3,5 m: vier kolomlijnen van elk
// twee staven, liggers in X en Y op beide vloeren, één schoor (45°, telt niet).
const knopen = [];
let id = 1;
const kId = new Map();
for (const z of [0, 3.5, 7]) for (const y of [0, 5]) for (const x of [0, 6]) {
  knopen.push({ id, x, y, z }); kId.set(`${x},${y},${z}`, id++);
}
const k = (x, y, z) => kId.get(`${x},${y},${z}`);
const staven = [];
let sId = 1;
const staaf = (a, b, profiel) => staven.push({ id: sId++, startNodeId: a, endNodeId: b, profileName: profiel, material: "S235" });
for (const [x, y] of [[0, 0], [6, 0], [0, 5], [6, 5]]) { staaf(k(x, y, 0), k(x, y, 3.5), "HEB 200"); staaf(k(x, y, 3.5), k(x, y, 7), "HEB 200"); }
for (const z of [3.5, 7]) {
  staaf(k(0, 0, z), k(6, 0, z), "IPE 300"); staaf(k(0, 5, z), k(6, 5, z), "IPE 300");   // langs X
  staaf(k(0, 0, z), k(0, 5, z), "IPE 240"); staaf(k(6, 0, z), k(6, 5, z), "IPE 240");   // langs Y
}
staaf(k(0, 0, 0), k(6, 0, 3.5), "HEA 100");                                              // schoor, ~30°
const opleggingen = [[0, 0], [6, 0], [0, 5], [6, 5]].map(([x, y]) => ({ nodeId: k(x, y, 0), ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }));
const model = parseOpenFem3DModel({
  nodes: knopen, beams: staven, supports: opleggingen,
  loads: [{ id: 1, nodeId: k(6, 5, 7), fx: 0, fy: 0, fz: -100, mx: 0, my: 0, mz: 0, caseId: 2 }],
  memberLoads: [
    { id: 1, beamId: 9, caseId: 2, qyStart: 0, qyEnd: 0, qzStart: -10, qzEnd: -10, startPositionM: 0, endPositionM: 6 },      // IPE 300 langs X op +3,5
    { id: 2, beamId: 11, caseId: 2, qyStart: 0, qyEnd: 0, qzStart: -8, qzEnd: -4, startPositionM: 1, endPositionM: 4 },      // IPE 240 langs Y, trapezium
  ],
  memberPointLoads: [{ id: 1, beamId: 10, caseId: 2, py: 0, pz: -30, positionM: 2 }],
});

log("[1] h en m uit het 3D-model");
const geo = leidScheefstandGeometrieAf3D(model);
check("h = 7 m (laagste oplegging tot hoogste knoop)", dichtbij(geo.hoogteM, 7));
check("m = 4 kolomlijnen (een kolom over twee verdiepingen telt één keer; de schoor niet)", geo.aantalElementen === 4, String(geo.aantalElementen));
check("staal → EN 1993", JSON.stringify(toepasselijkeScheefstandNormen3D(model)) === JSON.stringify(["en1993"]));
const uitkomst = bepaalScheefstand({ bron: "en1993", noemer: 200 }, geo, ["en1993"]);
const toelichting3d = scheefstandToelichting(uitkomst, geo, "3d");
check("de 3D-toelichting noemt de vier richtingen en niet de 2D-richtingen +x en −x",
  /\+X, −X, \+Y en −Y/.test(toelichting3d) && !/\+x én in −x/.test(toelichting3d)
  && /\+x én in −x/.test(scheefstandToelichting(uitkomst, geo)));
check("de richtingen staan er ook bij een vaste noemer",
  /\+X, −X, \+Y en −Y/.test(scheefstandToelichting(bepaalScheefstand({ noemer: 200 }, geo, ["en1993"]), geo, "3d")));
const phiHand = (1 / 200) * (2 / Math.sqrt(7)) * Math.sqrt(0.5 * (1 + 1 / 4));
check(`φ = φ₀·α_h·α_m = 1/200 · 2/√7 · √(0,5·(1+1/4)) = ${phiHand.toFixed(6)}`, dichtbij(uitkomst.phi, phiHand, 1e-12), String(uitkomst.phi));

log("\n[2] combinaties ontvouwen");
const combinaties = [
  { id: 1, name: "UGT 6.10b", type: "uls", formula: "", factors: new Map([[2, 1.35]]) },
  { id: 2, name: "BGT kar.", type: "sls", formula: "", factors: new Map([[2, 1]]) },
];
const ontvouwen = metScheefstandRichtingen3D(combinaties, true);
check("één UGT-combinatie wordt vier varianten, de BGT-combinatie blijft",
  ontvouwen.length === 5 && ontvouwen.filter((c) => c.type === "sls").length === 1);
check("id's: +X houdt het id, de andere krijgen een veelvoud van de offset",
  JSON.stringify(ontvouwen.filter((c) => c.type === "uls").map((c) => c.id)) ===
  JSON.stringify([1, 1 + SCHEEFSTAND_COMBO_OFFSET, 1 + 2 * SCHEEFSTAND_COMBO_OFFSET, 1 + 3 * SCHEEFSTAND_COMBO_OFFSET]));
check("namen en richtingen", ontvouwen.filter((c) => c.type === "uls").map((c) => `${c.scheefstandAs}${c.scheefstandRichting}:${c.name}`).join("|")
  === "x1:UGT 6.10b (scheefstand +X)|x-1:UGT 6.10b (scheefstand −X)|y1:UGT 6.10b (scheefstand +Y)|y-1:UGT 6.10b (scheefstand −Y)");
check("uit: de lijst blijft zoals hij is", metScheefstandRichtingen3D(combinaties, false).length === 2);
check("een BGT-combinatie krijgt geen scheefstand", scheefstandVanCombinatie(combinaties[1], 0.003) === null);

log("\n[3] lasten: Σ horizontaal = φ·Σ verticaal, voor elke lastsoort");
const metEg = withOpenFem3DSelfWeight(model, 1);   // eigen gewicht in geval 1
const factoren = new Map([[1, 1.2], [2, 1.5]]);
const verzoek = buildOpenFem3DSolveRequest(metEg, "linear", factoren);
const knoopVan = new Map(verzoek.nodes.map((n) => [n.id, n]));
const staafVan = new Map(verzoek.members.map((m) => [m.id, m]));
function sommen(v) {
  const s = [0, 0, 0];
  for (const l of v.nodalLoads) { s[0] += l.fx; s[1] += l.fy; s[2] += l.fz; }
  for (const l of v.memberLoads) {
    const m = staafVan.get(l.memberId);
    const a = knoopVan.get(m.startNodeId), b = knoopVan.get(m.endNodeId);
    const { ex, ey, ez } = openFem3DMemberAxes(a, b, m.rollAngleRad ?? 0);
    const lengte = (l.endPositionM ?? Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)) - (l.startPositionM ?? 0);
    if (l.globalDirection !== undefined) {
      // Globale lijnlast (#80; sinds #112 ook het eigen gewicht): q langs de globale as, per staafmeter of per projectie.
      const d = openFem3DGlobalDirectionVector(l.globalDirection);
      const q = (l.qStartKnPerM + l.qEndKnPerM) / 2 * lengte * openFem3DGlobalMemberLoadFactor(ex, l.globalDirection, l.perProjection);
      for (let i = 0; i < 3; i++) s[i] += q * d[i];
      continue;
    }
    const qy = (l.qyStartKnPerM + l.qyEndKnPerM) / 2 * lengte, qz = (l.qzStartKnPerM + l.qzEndKnPerM) / 2 * lengte;
    for (let i = 0; i < 3; i++) s[i] += qy * ey[i] + qz * ez[i];
  }
  for (const l of v.memberPointLoads) {
    const m = staafVan.get(l.memberId);
    const { ey, ez } = openFem3DMemberAxes(knoopVan.get(m.startNodeId), knoopVan.get(m.endNodeId), m.rollAngleRad ?? 0);
    for (let i = 0; i < 3; i++) s[i] += l.pyKn * ey[i] + l.pzKn * ez[i];
  }
  return s;
}
const voor = sommen(verzoek);
const phi = 0.004;
for (const [as, richting, index] of [["x", 1, 0], ["x", -1, 0], ["y", 1, 1], ["y", -1, 1]]) {
  const na = sommen(metScheefstandLasten(verzoek, { phi, as, richting }));
  const verwacht = -phi * voor[2] * richting;
  check(`${richting > 0 ? "+" : "−"}${as.toUpperCase()}: toegevoegd ${ (na[index] - voor[index]).toFixed(4)} kN = φ·ΣV = ${verwacht.toFixed(4)} kN`,
    dichtbij(na[index] - voor[index], verwacht, 1e-9));
  check(`${richting > 0 ? "+" : "−"}${as.toUpperCase()}: verticaal en de andere richting ongewijzigd`,
    dichtbij(na[2], voor[2], 1e-9) && dichtbij(na[1 - index], voor[1 - index], 1e-9));
}
const eenStaaf = metScheefstandLasten(verzoek, { phi, as: "x", richting: 1 });
const ids = (l) => l.map((x) => x.id);
check("unieke id's in elke lastlijst", ["nodalLoads", "memberLoads", "memberPointLoads"]
  .every((lijst) => new Set(ids(eenStaaf[lijst])).size === eenStaaf[lijst].length));
check("het oorspronkelijke verzoek blijft onaangeroerd", verzoek.nodalLoads.length < eenStaaf.nodalLoads.length && sommen(verzoek)[0] === voor[0]);

log("\n[4] de app gebruikt de scheefstand in de 3D-rekenroute — uitgevoerd, niet gelezen");
{
  // De knop Berekenen (`handleSolve`, 3D-tak) uit App.tsx, in de AST opgezocht
  // en uitgevoerd (scripts/bron-uitvoeren.mjs). De 3D-kern en de toetsen zijn
  // naden die vastleggen WAT de app ze vraagt; ontvouwen en scheefstand per
  // combinatie zijn de echte functies. Geen broncodetekst.
  const app = leesBron("src/App.tsx");
  const PHI = 0.004;
  const UGT = { id: 1, name: "UGT 6.10b", type: "uls", formula: "", factors: new Map([[2, 1.35]]) };
  const BGT = { id: 2, name: "BGT kar.", type: "sls", formula: "", factors: new Map([[2, 1]]) };
  const LEEG = { id: 3, name: "UGT zonder last", type: "uls", formula: "", factors: new Map([[9, 1.5]]) };
  async function berekenen({ scheefstandAan, analysetype = "tweedeOrdeGeometrisch" }) {
    const kern = [];
    const toetsSets = [];
    const toestand = { openFem3dSolvedCombinations: [], openFem3dCombinationResults: new Map(), openFem3dVisibility: {} };
    const naden = stateNaden(app, toestand, {
      modelDimension: "3d",
      getSetting: async (_sleutel, standaard) => standaard,
      resolveSolver: () => ({}),
      leesSnapInstellingen: () => ({ verbindingsTolerantie: 5 }),
      openFem3d: model, openFem3dCalculationModel: model,
      openFem3dCalculation: { selfWeightError: undefined, selfWeightCaseId: undefined },
      openFem3dSolveGenerationRef: { current: 0 },
      // De projectinstelling: vast 1/250 (de toets leest er sinds #199 ook de
      // noemer, bron, h en m uit, voor de φ van de toets).
      openFem3dScheefstandUitkomst: { phi: PHI, noemer: 1 / PHI, bron: "vast", hoogteM: 7, aantalElementen: 4 },
      fem: {
        analysetype, scheefstandEnabled: scheefstandAan, activeLoadCaseId: 2,
        combinations: [UGT, BGT, LEEG], loadCases: [{ id: 2, name: "Q", type: "live" }], gevolgklasse: "CC2",
      },
      setActiveView() {},
      solveOpenFem3D: async (_m, caseId, analysis) => ({ caseId, analysis, forceBalance: { ok: true } }),
      solveOpenFem3DCombination: async (_m, factors, analysis, scheefstand, opties) => {
        // `toets`: een run van de UGT-toets (issue #199), die P-Δ verplicht stelt.
        kern.push({ factors, analysis, scheefstand, toets: opties?.tweedeOrdeVerplicht === true });
        return { analysis, forceBalance: { ok: true } };
      },
      runOpenFem3DSteelChecks: async (_m, _r, set) => { toetsSets.push(set); return { results: [], skipped: [] }; },
      runOpenFem3DConcreteChecks: async () => ({ results: [], skipped: [] }),
      runOpenFem3DTimberChecks: async () => ({ results: [], skipped: [] }),
    });
    const handleSolve = await voerUitIn(app, declaratie(app, "handleSolve"), naden);
    await handleSolve();
    return { kern, toetsSet: toetsSets[0], toestand, naden };
  }

  const aan = await berekenen({ scheefstandAan: true });
  const ugt = aan.kern.filter((k) => k.factors === UGT.factors);
  check("UGT-combinaties ontvouwen met φ uit de 3D-geometrie: vier rekengangen, elk met φ",
    ugt.length === 4 && ugt.every((k) => k.scheefstand?.phi === PHI), JSON.stringify(ugt.map((k) => k.scheefstand)));
  check("elke combinatie rekent met haar eigen richting (+X, −X, +Y, −Y)",
    ugt.map((k) => `${k.scheefstand?.richting > 0 ? "+" : "−"}${k.scheefstand?.as}`).sort().join(" ") === "+x +y −x −y",
    ugt.map((k) => JSON.stringify(k.scheefstand)).join(" "));
  const bgt = aan.kern.filter((k) => k.factors === BGT.factors);
  check("de BGT-combinatie één keer, zonder scheefstand", bgt.length === 1 && bgt[0].scheefstand === null);
  check("een combinatie zonder last in het model wordt niet gerekend", !aan.kern.some((k) => k.factors === LEEG.factors));
  check("P-Δ bij de instelling tweede orde", aan.kern.every((k) => k.analysis === "p-delta"));
  check("de toetsing krijgt de varianten en de φ (voor de φ-eis bij een vrij staafeind)",
    aan.toetsSet?.scheefstandPhi === PHI && aan.toetsSet?.combinations?.length === 5,
    JSON.stringify({ phi: aan.toetsSet?.scheefstandPhi, n: aan.toetsSet?.combinations?.length }));

  const uit = await berekenen({ scheefstandAan: false, analysetype: "eersteOrde" });
  // GEWIJZIGD door issue #199 (besluiten B1 en B2). Tot 2026.42 rekende de app
  // hier alleen de twee resultaatcombinaties, lineair en zonder scheefstand, en
  // kreeg de toetsing die krachten zonder φ (2·L bij een vrij staafeind). Nu
  // blijven de RESULTATEN zo (2 runs, lineair, zonder scheefstand), en rekent
  // de UGT-toets zelf P-Δ met de φ van de projectinstelling (hier 1/250) in
  // +X, −X, +Y en −Y: 4 runs erbij, en de toetsing krijgt die φ.
  const resultaatRuns = uit.kern.filter((k) => !k.toets);
  const toetsRuns = uit.kern.filter((k) => k.toets);
  check("scheefstand uit: de resultaten rekenen elke combinatie één keer, zonder scheefstand",
    resultaatRuns.length === 2 && resultaatRuns.every((k) => k.scheefstand === null),
    JSON.stringify(resultaatRuns.map((k) => k.scheefstand)));
  check("… lineair bij de instelling eerste orde",
    resultaatRuns.every((k) => k.analysis === "linear"));
  check("… de UGT-toets rekent zelf P-Δ met φ in +X, −X, +Y en −Y, en de toetsing krijgt die φ (issue #199)",
    toetsRuns.length === 4 && toetsRuns.every((k) => k.analysis === "p-delta" && k.scheefstand?.phi === PHI
      && k.factors === UGT.factors)
    && toetsRuns.map((k) => `${k.scheefstand.richting > 0 ? "+" : "−"}${k.scheefstand.as}`).sort().join(" ") === "+x +y −x −y"
    && uit.toetsSet?.scheefstandPhi === PHI && uit.toetsSet.combinations.length === 5,
    JSON.stringify({ runs: toetsRuns.map((k) => k.scheefstand), phi: uit.toetsSet?.scheefstandPhi }));

  // Rapport en verkenner tonen de GEREKENDE varianten, met de toelichting in
  // vier richtingen: de combinatielijst en de scheefstandtekst van App.tsx.
  const naden = { ...aan.naden, openFem3dSolvedCombinations: aan.toestand.openFem3dSolvedCombinations };
  const lijst = await voerUitIn(app, declaratie(app, "openFem3dCombinaties"), naden);
  check("de combinatielijst van de 3D-weergave zijn de gerekende varianten",
    lijst.length === 5 && lijst.filter((c) => c.scheefstandAs !== undefined).length === 4, String(lijst.length));
  for (const tag of ["OpenFem3DReport", "OpenFem3DExplorer"]) {
    const gegeven = await voerUitIn(app, jsxAttribuut(app, tag, "combinations"), { ...naden, openFem3dCombinaties: lijst });
    check(`${tag} krijgt die lijst`, gegeven === lijst);
  }
  const tekstNaden = (scheefstandEnabled) => ({
    fem: { scheefstandEnabled }, openFem3d: model,
    openFem3dScheefstandUitkomst: uitkomst, openFem3dScheefstandGeometrie: geo,
  });
  const tekst = (await voerUitIn(app, declaratie(app, "openFem3dScheefstandTekst"), tekstNaden(true)))();
  const inRapport = await voerUitIn(app, jsxAttribuut(app, "OpenFem3DReport", "scheefstandTekst"), { openFem3dScheefstandTekst: tekst });
  check("het 3D-rapport krijgt de toelichting in de vier richtingen",
    inRapport === tekst && /\+X, −X, \+Y en −Y/.test(tekst), tekst);
  // GEWIJZIGD door issue #199 (taak 7): tot 2026.42 was deze tekst LEEG met de
  // schakelaar uit (de scheefstand zat dan in geen toetskracht). De UGT-toets
  // rekent nu altijd met deze φ, dus het rapport noemt haar altijd, en zegt dat.
  const tekstUit = (await voerUitIn(app, declaratie(app, "openFem3dScheefstandTekst"), tekstNaden(false)))();
  check("met de schakelaar uit: dezelfde toelichting, niet leeg (de toets rekent er altijd mee)",
    tekstUit === tekst && /ook als de schakelaar Scheefstand uit staat/.test(tekstUit), tekstUit);
}

log("\n[5] met de kern: de reacties nemen φ·ΣV op");
const solverBinary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH ?? join(HIER, "..", "src-tauri", "target", "debug", solverBinary);
if (!existsSync(solverPath)) {
  log("  · overgeslagen: bouw eerst de 3D-kern (cargo build -p open-fem-3d)");
} else {
  const reken = (request) => new Promise((ok, fout) => {
    const c = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] }); const uit = [];
    c.stdout.on("data", (d) => uit.push(d)); c.on("error", fout);
    c.on("close", () => { try { ok(JSON.parse(Buffer.concat(uit).toString())); } catch (e) { fout(e); } });
    c.stdin.end(JSON.stringify(request));
  });
  const zonder = await reken({ ...verzoek, bucklingModes: 0 });
  const met = await reken({ ...metScheefstandLasten(verzoek, { phi, as: "y", richting: -1 }), bucklingModes: 0 });
  const som = (r, as) => r.reactions.reduce((s, x) => s + x[as], 0);
  check("zonder scheefstand: geen horizontale reactie", Math.abs(som(zonder, "fy")) < 1e-6 && Math.abs(som(zonder, "fx")) < 1e-6);
  // Toegevoegd in −Y: F_y = −φ·ΣF_z·(−1) = φ·ΣF_z (< 0, want ΣF_z < 0). De
  // reactie staat daar tegenover: ΣR_y = −F_y = −φ·ΣF_z > 0.
  const verwachtRy = -phi * voor[2];
  check(`−Y: ΣR_y = −φ·ΣF_z = ${verwachtRy.toFixed(4)} kN, tegengesteld aan de toegevoegde last`,
    dichtbij(som(met, "fy"), verwachtRy, 1e-6), String(som(met, "fy")));
  check("ΣR_z verandert niet", dichtbij(som(met, "fz"), som(zonder, "fz"), 1e-9));
}

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

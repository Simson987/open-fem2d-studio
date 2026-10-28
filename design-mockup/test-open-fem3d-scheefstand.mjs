// Initiële scheefstand in 3D (NEN-EN 1993-1-1 §5.3.2): h en m uit het
// 3D-model, φ uit dezelfde normfunctie als 2D, combinaties in vier
// richtingen, en op elke verticale last V een horizontale last φ·V. Blok [4]
// voert de rekenroute van de app uit (scripts/bron-uitvoeren.mjs) in plaats
// van de broncode te lezen.
//
// Issue #194: m per rij en per richting (EN 1993-1-1 5.3.2(3)), φ_X en φ_Y
// apart, de BGT-combinaties met scheefstand in de resultaten (zoals 2D), en
// de vlaklast-tak van `metScheefstandLasten` (blok [3b]). Blok [6] is de
// acceptatie van het issue: een hal van 4 × 2 kolommen met h = 6 m.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { declaratie, jsxAttribuut, leesBron, stateNaden, voerUitIn } from "./scripts/bron-uitvoeren.mjs";
const {
  leidScheefstandGeometrieAf3D, metScheefstandRichtingen3D, metScheefstandLasten,
  scheefstandVanCombinatie, toepasselijkeScheefstandNormen3D, bepaalScheefstand3D,
  scheefstandToelichting3D, zonderScheefstandVariant,
} = await import("./src/components/openFem3d/openFem3dScheefstand.ts");
const { scheefstandToelichting } = await import("./src/lib/scheefstandNorm.ts");
const { planToetsKrachten3D } = await import("./src/components/openFem3d/openFem3dToetsKrachten.ts");
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
// GEWIJZIGD door issue #194. Tot 2026.43 was m = 4: alle kolomlijnen van het
// gebouw in één rij. EN 1993-1-1 5.3.2(3) telt de kolommen in een rij in het
// beschouwde vlak: in X de rijen y = 0 en y = 5 m, elk met 2 kolommen; in Y
// de rijen x = 0 en x = 6 m, ook elk 2. Dus m_X = m_Y = 2.
check("vier kolomlijnen (een kolom over twee verdiepingen telt één keer; de schoor niet)",
  geo.kolomlijnen.length === 4, String(geo.kolomlijnen.length));
check("m_X = 2: rijen evenwijdig aan X op y = 0 en y = 5000 mm, elk 2 kolommen",
  geo.perAs.x.aantalElementen === 2 && JSON.stringify(geo.perAs.x.rijen) === JSON.stringify([{ coordinaatMm: 0, aantal: 2 }, { coordinaatMm: 5000, aantal: 2 }]),
  JSON.stringify(geo.perAs.x.rijen));
check("m_Y = 2: rijen evenwijdig aan Y op x = 0 en x = 6000 mm, elk 2 kolommen",
  geo.perAs.y.aantalElementen === 2 && JSON.stringify(geo.perAs.y.rijen) === JSON.stringify([{ coordinaatMm: 0, aantal: 2 }, { coordinaatMm: 6000, aantal: 2 }]),
  JSON.stringify(geo.perAs.y.rijen));
check("staal → EN 1993", JSON.stringify(toepasselijkeScheefstandNormen3D(model)) === JSON.stringify(["en1993"]));
const uitkomst = bepaalScheefstand3D({ bron: "en1993", noemer: 200 }, geo, ["en1993"]);
const toelichting3d = scheefstandToelichting3D(uitkomst, geo);
check("de 3D-toelichting noemt de vier richtingen met φ_X en φ_Y, en niet de 2D-richtingen +x en −x",
  /\+X en −X met φ_X, \+Y en −Y met φ_Y/.test(toelichting3d) && !/\+x én in −x/.test(toelichting3d)
  && /\+x én in −x/.test(scheefstandToelichting(uitkomst.x, geo.perAs.x)), toelichting3d);
check("de 3D-toelichting noemt φ_X, φ_Y, m_X en m_Y, en de torsie van 5.3.2(10) als niet meegenomen",
  /Richting X: φ_X = 1\//.test(toelichting3d) && /Richting Y: φ_Y = 1\//.test(toelichting3d)
  && /m_X = 2/.test(toelichting3d) && /m_Y = 2/.test(toelichting3d) && /5\.3\.2\(10\)/.test(toelichting3d), toelichting3d);
const vast3d = scheefstandToelichting3D(bepaalScheefstand3D({ noemer: 200 }, geo, ["en1993"]), geo);
check("de richtingen staan er ook bij een vaste noemer, met één φ voor X en Y",
  /\+X en −X met φ_X/.test(vast3d) && /Deze φ geldt in X en in Y\./.test(vast3d), vast3d);
// GEWIJZIGD door issue #194: met m = 2 in plaats van 4 is α_m = √(0,5·(1 + 1/2))
// = 0,866 in plaats van √(0,5·(1 + 1/4)) = 0,791, dus φ is 9,5 % groter.
const phiHand = (1 / 200) * (2 / Math.sqrt(7)) * Math.sqrt(0.5 * (1 + 1 / 2));
check(`φ_X = φ_Y = φ₀·α_h·α_m = 1/200 · 2/√7 · √(0,5·(1+1/2)) = ${phiHand.toFixed(6)}`,
  dichtbij(uitkomst.phi.x, phiHand, 1e-12) && dichtbij(uitkomst.phi.y, phiHand, 1e-12), JSON.stringify(uitkomst.phi));
{
  const hand = bepaalScheefstand3D({ bron: "en1993", noemer: 200, aantalElementen: 6 }, geo, ["en1993"]);
  const phi6 = (1 / 200) * (2 / Math.sqrt(7)) * Math.sqrt(0.5 * (1 + 1 / 6));
  check("een handmatige m geldt in X en in Y", dichtbij(hand.phi.x, phi6, 1e-12) && dichtbij(hand.phi.y, phi6, 1e-12)
    && /m is handmatig opgegeven: 6, in X en in Y\./.test(scheefstandToelichting3D(hand, geo)));
}

log("\n[2] combinaties ontvouwen");
const combinaties = [
  { id: 1, name: "UGT 6.10b", type: "uls", formula: "", factors: new Map([[2, 1.35]]) },
  { id: 2, name: "BGT kar.", type: "sls", formula: "", factors: new Map([[2, 1]]) },
];
const PHI2 = { x: 0.004, y: 0.005 };
const ontvouwen = metScheefstandRichtingen3D(combinaties, PHI2);
check("één UGT-combinatie wordt vier varianten, de BGT-combinatie blijft (zonder `bgt`, de toets)",
  ontvouwen.length === 5 && ontvouwen.filter((c) => c.type === "sls").length === 1);
check("id's: +X houdt het id, de andere krijgen een veelvoud van de offset",
  JSON.stringify(ontvouwen.filter((c) => c.type === "uls").map((c) => c.id)) ===
  JSON.stringify([1, 1 + SCHEEFSTAND_COMBO_OFFSET, 1 + 2 * SCHEEFSTAND_COMBO_OFFSET, 1 + 3 * SCHEEFSTAND_COMBO_OFFSET]));
check("namen en richtingen", ontvouwen.filter((c) => c.type === "uls").map((c) => `${c.scheefstandAs}${c.scheefstandRichting}:${c.name}`).join("|")
  === "x1:UGT 6.10b (scheefstand +X)|x-1:UGT 6.10b (scheefstand −X)|y1:UGT 6.10b (scheefstand +Y)|y-1:UGT 6.10b (scheefstand −Y)");
check("uit: de lijst blijft zoals hij is", metScheefstandRichtingen3D(combinaties, null).length === 2);
check("een niet-ontvouwde BGT-combinatie krijgt geen scheefstand", scheefstandVanCombinatie(combinaties[1], PHI2) === null);
check("±X rekent met φ_X, ±Y met φ_Y",
  ontvouwen.filter((c) => c.type === "uls").map((c) => scheefstandVanCombinatie(c, PHI2).phi).join(" ") === "0.004 0.004 0.005 0.005");
{
  // Issue #194: met `bgt` (de resultaten met de schakelaar aan, zoals 2D) ook de BGT.
  const metBgt = metScheefstandRichtingen3D(combinaties, PHI2, { bgt: true });
  check("met bgt: ook de BGT-combinatie wordt vier varianten, met dezelfde id-regel",
    metBgt.length === 8 && JSON.stringify(metBgt.filter((c) => c.type === "sls").map((c) => c.id)) ===
      JSON.stringify([2, 2 + SCHEEFSTAND_COMBO_OFFSET, 2 + 2 * SCHEEFSTAND_COMBO_OFFSET, 2 + 3 * SCHEEFSTAND_COMBO_OFFSET]),
    JSON.stringify(metBgt.map((c) => c.id)));
  const terug = zonderScheefstandVariant(metBgt.find((c) => c.type === "sls" && c.scheefstandAs === "y" && c.scheefstandRichting === -1));
  check("zonderScheefstandVariant geeft de basis terug (id, naam, zonder richting)",
    terug.id === 2 && terug.name === "BGT kar." && terug.scheefstandRichting === undefined && terug.scheefstandAs === undefined, JSON.stringify(terug));
  check("een richting met φ = 0 krijgt geen varianten",
    metScheefstandRichtingen3D(combinaties, { x: 0.004, y: 0 }).filter((c) => c.type === "uls").map((c) => c.scheefstandAs).join("") === "xx");
}

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

log("\n[3b] vlaklast op een plaat: q_h = −φ·q_Z per m², op dezelfde plaat");
{
  // De tak `surfaceLoads` van `metScheefstandLasten`: een vlaklast is globaal
  // per m²; de scheefstand voegt φ·|q_Z| per m² toe in de gekozen richting.
  // Handwaarde: q_Z = −5 kN/m², φ = 0,004 → q_X = +0,020 kN/m² in +X.
  const vlak = {
    nodes: [], members: [], nodalLoads: [], memberLoads: [], memberPointLoads: [],
    surfaceLoads: [
      { id: 1, plateId: 7, qxKnPerM2: 0.5, qyKnPerM2: 0, qzKnPerM2: -5 },
      { id: 2, plateId: 8, qxKnPerM2: 1, qyKnPerM2: 2, qzKnPerM2: 0 },
    ],
  };
  const px = metScheefstandLasten(vlak, { phi: 0.004, as: "x", richting: 1 });
  check("+X: q_X = 0,5 + 0,004·5 = 0,520 kN/m², q_Y en q_Z ongewijzigd",
    dichtbij(px.surfaceLoads[0].qxKnPerM2, 0.52, 1e-12) && px.surfaceLoads[0].qyKnPerM2 === 0 && px.surfaceLoads[0].qzKnPerM2 === -5,
    JSON.stringify(px.surfaceLoads[0]));
  const my = metScheefstandLasten(vlak, { phi: 0.004, as: "y", richting: -1 });
  check("−Y: q_Y = −0,004·5 = −0,020 kN/m², q_X ongewijzigd",
    dichtbij(my.surfaceLoads[0].qyKnPerM2, -0.02, 1e-12) && my.surfaceLoads[0].qxKnPerM2 === 0.5, JSON.stringify(my.surfaceLoads[0]));
  check("een vlaklast zonder verticale component blijft precies dezelfde", px.surfaceLoads[1] === vlak.surfaceLoads[1]);
  check("geen knoop- of staaflasten erbij", px.nodalLoads.length === 0 && px.memberLoads.length === 0 && px.memberPointLoads.length === 0);
}

log("\n[4] de app gebruikt de scheefstand in de 3D-rekenroute — uitgevoerd, niet gelezen");
{
  // De knop Berekenen (`handleSolve`, 3D-tak) uit App.tsx, in de AST opgezocht
  // en uitgevoerd (scripts/bron-uitvoeren.mjs). De 3D-kern en de toetsen zijn
  // naden die vastleggen WAT de app ze vraagt; ontvouwen en scheefstand per
  // combinatie zijn de echte functies. Geen broncodetekst.
  const app = leesBron("src/App.tsx");
  const PHI = 0.004;
  // De projectinstelling: vast 1/250, dus φ_X = φ_Y = 1/250 (de toets leest er
  // sinds #199 ook de noemer, bron, h en m uit, voor de φ van de toets).
  const projectUitkomst = bepaalScheefstand3D({ noemer: 250 }, geo, ["en1993"]);
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
      openFem3dScheefstandUitkomst: projectUitkomst,
      // Issue #212: de torsievarianten van 5.3.2(10) staan uit.
      openFem3dTorsieRijen: null,
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
  // GEWIJZIGD door issue #194: tot 2026.43 rekende de BGT-combinatie hier één
  // keer zonder scheefstand. Nu krijgen de resultaten met de schakelaar aan ook
  // in de BGT de scheefstand, zoals 2D: vier rekengangen, elk met φ.
  const bgt = aan.kern.filter((k) => k.factors === BGT.factors);
  check("met de schakelaar aan ook de BGT-combinatie in vier richtingen, elk met φ (zoals 2D, #194)",
    bgt.length === 4 && bgt.every((k) => k.scheefstand?.phi === PHI && !k.toets)
    && bgt.map((k) => `${k.scheefstand.richting > 0 ? "+" : "−"}${k.scheefstand.as}`).sort().join(" ") === "+x +y −x −y",
    JSON.stringify(bgt.map((k) => k.scheefstand)));
  check("een combinatie zonder last in het model wordt niet gerekend", !aan.kern.some((k) => k.factors === LEEG.factors));
  check("P-Δ bij de instelling tweede orde", aan.kern.every((k) => k.analysis === "p-delta"));
  // GEWIJZIGD door issue #194: de toetsset krijgt φ per richting, en de BGT van
  // de resultaten (nu vier varianten): 4 UGT + 4 BGT = 8 (was 4 + 1 = 5).
  check("de toetsing krijgt de varianten en φ_X en φ_Y (voor de φ-eis bij een vrij staafeind)",
    JSON.stringify(aan.toetsSet?.scheefstandPhi) === JSON.stringify({ x: PHI, y: PHI }) && aan.toetsSet?.combinations?.length === 8,
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
    && JSON.stringify(uit.toetsSet?.scheefstandPhi) === JSON.stringify({ x: PHI, y: PHI }) && uit.toetsSet.combinations.length === 5,
    JSON.stringify({ runs: toetsRuns.map((k) => k.scheefstand), phi: uit.toetsSet?.scheefstandPhi }));

  // Rapport en verkenner tonen de GEREKENDE varianten, met de toelichting in
  // vier richtingen: de combinatielijst en de scheefstandtekst van App.tsx.
  const naden = { ...aan.naden, openFem3dSolvedCombinations: aan.toestand.openFem3dSolvedCombinations };
  const lijst = await voerUitIn(app, declaratie(app, "openFem3dCombinaties"), naden);
  // GEWIJZIGD door issue #194: ook de BGT in vier varianten, dus 8 (was 5).
  check("de combinatielijst van de 3D-weergave zijn de gerekende varianten",
    lijst.length === 8 && lijst.filter((c) => c.scheefstandAs !== undefined).length === 8, String(lijst.length));
  for (const tag of ["OpenFem3DReport", "OpenFem3DExplorer"]) {
    const gegeven = await voerUitIn(app, jsxAttribuut(app, tag, "combinations"), { ...naden, openFem3dCombinaties: lijst });
    check(`${tag} krijgt die lijst`, gegeven === lijst);
  }
  const tekstNaden = (scheefstandEnabled) => ({
    fem: { scheefstandEnabled }, openFem3d: model,
    openFem3dScheefstandUitkomst: uitkomst, openFem3dScheefstandGeometrie: geo,
    // Issue #212: de torsievarianten van 5.3.2(10) staan uit.
    openFem3dTorsieRijen: null,
  });
  const tekst = (await voerUitIn(app, declaratie(app, "openFem3dScheefstandTekst"), tekstNaden(true)))();
  const inRapport = await voerUitIn(app, jsxAttribuut(app, "OpenFem3DReport", "scheefstandTekst"), { openFem3dScheefstandTekst: tekst });
  check("het 3D-rapport krijgt de toelichting in de vier richtingen, met φ_X en φ_Y",
    inRapport === tekst && /\+X en −X met φ_X, \+Y en −Y met φ_Y/.test(tekst), tekst);
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

log("\n[6] acceptatie #194: een hal van 4 × 2 kolommen, h = 6 m");
{
  // Kolommen op x = 0, 6, 12, 18 m en y = 0, 15 m, vrijstaand met liggers erover.
  // Handwaarden (EN 1993-1-1 (5.5)): α_h = 2/√6 = 0,8165;
  //   m_X = 4 (rijen y = 0 en y = 15, elk 4 kolommen): α_m = √(0,5·1,25) = 0,7906
  //     → φ_X = 1/200·0,8165·0,7906 = 0,0032275 = 1/309,8;
  //   m_Y = 2 (rijen x = 0, 6, 12, 18, elk 2 kolommen): α_m = √(0,5·1,5) = 0,8660
  //     → φ_Y = 1/200·0,8165·0,8660 = 0,0035355 = 1/282,8.
  // Tot 2026.43: m = 8, α_m = √(0,5·1,125) = 0,75 → φ = 1/326,6 in beide richtingen.
  const kn = [];
  const st = [];
  const op = [];
  let n = 1;
  for (const x of [0, 6, 12, 18]) for (const y of [0, 15]) {
    kn.push({ id: n, x, y, z: 0 }, { id: n + 1, x, y, z: 6 });
    st.push({ id: st.length + 1, startNodeId: n, endNodeId: n + 1, profileName: "HEA 200", material: "S235" });
    op.push({ nodeId: n, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true });
    n += 2;
  }
  for (const x of [0, 6, 12, 18]) {
    const a = kn.find((k) => k.x === x && k.y === 0 && k.z === 6).id, b = kn.find((k) => k.x === x && k.y === 15 && k.z === 6).id;
    st.push({ id: st.length + 1, startNodeId: a, endNodeId: b, profileName: "IPE 400", material: "S235" });
  }
  const hal = parseOpenFem3DModel({ nodes: kn, beams: st, supports: op, loads: [] });
  const g = leidScheefstandGeometrieAf3D(hal);
  check("m_X = 4, m_Y = 2", g.perAs.x.aantalElementen === 4 && g.perAs.y.aantalElementen === 2,
    `${g.perAs.x.aantalElementen}/${g.perAs.y.aantalElementen}`);
  const u = bepaalScheefstand3D({ bron: "en1993", noemer: 200 }, g, ["en1993"]);
  const phiX = (1 / 200) * (2 / Math.sqrt(6)) * Math.sqrt(0.5 * 1.25);
  const phiY = (1 / 200) * (2 / Math.sqrt(6)) * Math.sqrt(0.5 * 1.5);
  check(`φ_X = 1/${(1 / phiX).toFixed(1)} (1/309,8)`, dichtbij(u.phi.x, phiX, 1e-12) && (1 / u.phi.x).toFixed(1) === "309.8", String(1 / u.phi.x));
  check(`φ_Y = 1/${(1 / phiY).toFixed(1)} (1/282,8)`, dichtbij(u.phi.y, phiY, 1e-12) && (1 / u.phi.y).toFixed(1) === "282.8", String(1 / u.phi.y));
  const oud = (1 / 200) * (2 / Math.sqrt(6)) * Math.sqrt(0.5 * (1 + 1 / 8));
  check("ter vergelijking het oude getal: m = 8 gaf 1/326,6", (1 / oud).toFixed(1) === "326.6", String(1 / oud));
  // De toets rekent ±X met φ_X en ±Y met φ_Y (planToetsKrachten3D).
  const plan = planToetsKrachten3D({
    model: hal,
    combinaties: [{ id: 1, name: "UGT", type: "uls", formula: "", factors: new Map([[1, 1.35]]) }],
    scheefstand: { project: u, normen: ["en1993"], modelAan: false },
  });
  const perRun = plan.runs.map((r) => `${r.scheefstand.as}:${(1 / r.scheefstand.phi).toFixed(1)}`).join(" ");
  check("de toets: ±X met φ_X = 1/309,8, ±Y met φ_Y = 1/282,8", perRun === "x:309.8 x:309.8 y:282.8 y:282.8", perRun);
  check("de toetsanalyse draagt φ per richting; phi is de grootste (φ_Y)",
    plan.analyse.phiPerAs && dichtbij(plan.analyse.phiPerAs.x, phiX, 1e-12) && dichtbij(plan.analyse.phiPerAs.y, phiY, 1e-12)
    && dichtbij(plan.analyse.phi, phiY, 1e-12), JSON.stringify(plan.analyse));
  // Een losse gevelstijl in het midden van de kopgevel (x = 0, y = 7,5): in X
  // een rij van 1 → m_X = 1 en de waarschuwing over losse rijen.
  const metStijl = parseOpenFem3DModel({
    nodes: [...kn, { id: 100, x: 0, y: 7.5, z: 0 }, { id: 101, x: 0, y: 7.5, z: 6 }],
    beams: [...st, { id: 100, startNodeId: 100, endNodeId: 101, profileName: "HEA 100", material: "S235" }],
    supports: [...op, { nodeId: 100, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false }], loads: [],
  });
  const gs = leidScheefstandGeometrieAf3D(metStijl);
  check("een losse gevelstijl: m_X = 1 (de veilige kant), m_Y = 2, met de kanttekening over de rijen",
    gs.perAs.x.aantalElementen === 1 && gs.perAs.y.aantalElementen === 2
    && gs.notities.some((t) => /LET OP bij de rijen/.test(t.tekst)), `${gs.perAs.x.aantalElementen}/${gs.perAs.y.aantalElementen}`);
}

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

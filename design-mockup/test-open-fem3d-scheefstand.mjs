// Initiële scheefstand in 3D (NEN-EN 1993-1-1 §5.3.2): h en m uit het
// 3D-model, φ uit dezelfde normfunctie als 2D, UGT-combinaties in vier
// richtingen, en op elke verticale last V een horizontale last φ·V.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const {
  leidScheefstandGeometrieAf3D, metScheefstandRichtingen3D, metScheefstandLasten,
  scheefstandVanCombinatie, toepasselijkeScheefstandNormen3D,
} = await import("./src/components/openFem3d/openFem3dScheefstand.ts");
const { bepaalScheefstand, scheefstandToelichting } = await import("./src/lib/scheefstandNorm.ts");
const { parseOpenFem3DModel, withOpenFem3DSelfWeight, openFem3DMemberAxes } = await import("./src/components/openFem3d/openFem3dModel.ts");
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
    const { ey, ez } = openFem3DMemberAxes(a, b, m.rollAngleRad ?? 0);
    const lengte = (l.endPositionM ?? Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)) - (l.startPositionM ?? 0);
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

log("\n[4] de app gebruikt de scheefstand in de 3D-rekenroute");
const app = readFileSync(join(HIER, "src", "App.tsx"), "utf8");
check("UGT-combinaties ontvouwen met φ uit de 3D-geometrie",
  /const scheefstandPhi = fem\.scheefstandEnabled \? openFem3dScheefstandUitkomst\?\.phi \?\? 0 : 0;/.test(app)
  && /metScheefstandRichtingen3D\(fem\.combinations\.filter/.test(app));
check("elke combinatie rekent met haar eigen richting",
  /scheefstandVanCombinatie\(combination, scheefstandPhi\), openFem3dOptions\)\] as const\)\)/.test(app));
check("rapport en verkenner tonen de gerekende varianten",
  /combinations=\{openFem3dCombinaties\}[\s\S]{0,120}scheefstandTekst=\{openFem3dScheefstandTekst\}/.test(app));

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

// Samenvattingen in het 3D-rapport van een groot model: de horizontale
// verplaatsing in de BGT tegen h/300 en de unity checks per staafgroep.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const { openFem3DHorizontaleVerplaatsingen, openFem3DUcPerGroep } = await import("./src/components/openFem3d/openFem3dRapportSamenvatting.ts");
const HIER = dirname(fileURLToPath(import.meta.url));
let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => { if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); } };
const dichtbij = (a, b) => Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b));

log("[1] horizontale verplaatsing tegen h/300");
const model = {
  nodes: [
    { id: 1, x: 0, y: 0, z: 0.5 }, { id: 2, x: 0, y: 0, z: 3.5, name: "K 1/A +3.500" },
    { id: 3, x: 0, y: 0, z: 7.5 }, { id: 4, x: 6, y: 0, z: 0.55 },
  ],
  supports: [{ nodeId: 1 }, { nodeId: 4 }],
};
const verpl = (nodeId, ux, uy) => ({ nodeId, ux, uy, uz: 0, rx: 0, ry: 0, rz: 0 });
const combinaties = [
  { id: 1, name: "BGT W+X", type: "sls" },
  { id: 2, name: "UGT", type: "uls" },
  { id: 3, name: "BGT W+Y", type: "sls" },
];
const resultaten = new Map([
  // Knoop 2 op h = 3 m: 8 mm → UC = 8/10 = 0,8. Knoop 3 op h = 7 m: 20 mm → 20/23,333 = 0,857.
  [1, { displacements: [verpl(1, 0, 0), verpl(2, 0.008, 0), verpl(3, 0.020, 0), verpl(4, 0.001, 0)] }],
  [2, { displacements: [verpl(3, 0.5, 0)] }],
  // Knoop 2: √(6² + 8²) = 10 mm op h = 3 m → UC 1,0; knoop 3: 12 mm op 7 m → 0,514.
  [3, { displacements: [verpl(2, 0.006, 0.008), verpl(3, 0, 0.012), verpl(4, 0.3, 0)] }],
]);
const rijen = openFem3DHorizontaleVerplaatsingen(model, combinaties, resultaten);
check("alleen BGT-combinaties", rijen.map((r) => r.combinationId).join(",") === "1,3");
check("W+X: de hoogste knoop is maatgevend (UC 20/(7000/300) = 0,857)",
  rijen[0].nodeId === 3 && dichtbij(rijen[0].hoogteM, 7) && dichtbij(rijen[0].uc, 20 / (7000 / 300)), JSON.stringify(rijen[0]));
check("W+Y: u_hor = √(u_x² + u_y²) = 10 mm op h = 3 m → UC 1,0, met de knoopnaam",
  rijen[1].nodeId === 2 && dichtbij(rijen[1].uHorMm, 10) && dichtbij(rijen[1].uc, 1) && rijen[1].nodeNaam === "K 1/A +3.500");
check("de voet is de laagste oplegging: een knoop 0,05 m daarboven telt niet (u = 300 mm)",
  rijen.every((r) => r.nodeId !== 4));

// Met bouwlagen telt een tussenknoop van een kolom niet: knoop 3 heeft geen
// level en zit in geen schijf, knoop 2 ligt op een bouwlaag.
const metLagen = { ...model, nodes: model.nodes.map((n) => n.id === 2 ? { ...n, levelId: "z-2" } : n) };
const lagen = openFem3DHorizontaleVerplaatsingen(metLagen, combinaties, resultaten);
check("met bouwlagen: W+X neemt knoop 2 op de bouwlaag, niet de tussenknoop 3",
  lagen[0].nodeId === 2 && dichtbij(lagen[0].uc, 8 / (3000 / 300)), JSON.stringify(lagen[0]));
const metSchijf = { ...model, diaphragms: [{ id: 1, nodeIds: [3, 4] }] };
check("een knoop in een schijf telt wel, ook zonder level",
  openFem3DHorizontaleVerplaatsingen(metSchijf, combinaties, resultaten)[0].nodeId === 3);

log("\n[2] unity checks per groep en profiel");
const staaf = (id, group, name) => ({ id, startNodeId: 1, endNodeId: 2, group, ...(name ? { name } : {}) });
const toets = (id, uc) => ({ id, kind: { data: { uc: { uc } } } });
const uitkomst = (beam_id, profiel, checks) => ({ beam_id, profile_name: profiel, steel_grade: "S235", checks });
const groepen = openFem3DUcPerGroep(
  { beams: [staaf(1, "kolom", "Kolom 1/A"), staaf(2, "kolom", "Kolom 2/A"), staaf(3, "kolom"), staaf(4, "windverband"), staaf(5)] },
  [
    uitkomst(1, "HEA 180", [toets("section_n_my", 0.62), toets("buckling_z", 0.91), toets("deflection_w_fin", 0.3)]),
    uitkomst(2, "HEA 180", [toets("section_n_my", 1.12), toets("deflection_w_fin", 0.5)]),
    uitkomst(3, "HEB 200", [toets("section_n_my", 0.4)]),
    uitkomst(4, "RD 24", [toets("tension_thread", 0.68)]),
    uitkomst(5, "IPE 270", [toets("ltb", 0.8)]),
  ]);
const kolom = groepen.find((g) => g.groep === "kolom" && g.profiel === "HEA 180");
check("groep + profiel: twee HEA 180-kolommen samen, HEB 200 apart",
  kolom.aantal === 2 && groepen.some((g) => g.groep === "kolom" && g.profiel === "HEB 200" && g.aantal === 1));
check("maatgevend: staaf 2 met UC 1,12 (section_n_my), met naam; één overschrijding",
  dichtbij(kolom.ucMax, 1.12) && kolom.maatgevendeStaaf === 2 && kolom.maatgevendeStaafNaam === "Kolom 2/A"
  && kolom.maatgevendeToets === "section_n_my" && kolom.aantalOverschreden === 1);
check("de doorbuiging telt niet in de UGT-UC maar apart (0,5)", dichtbij(kolom.doorbuigingUcMax, 0.5));
check("zonder doorbuigingstoets: null", groepen.find((g) => g.groep === "windverband").doorbuigingUcMax === null);
check("zonder groep: onder \"—\"", groepen.some((g) => g.groep === "—" && g.profiel === "IPE 270"));
check("gesorteerd op groep", groepen.map((g) => g.groep).join(",") === "—,kolom,kolom,windverband");

log("\n[3] het rapport toont beide");
const rapport = readFileSync(join(HIER, "src", "components", "openFem3d", "OpenFem3DReport.tsx"), "utf8");
check("horizontale verplaatsing uit de gerekende combinaties",
  /openFem3DHorizontaleVerplaatsingen\(model, combinations, combinationResults\)/.test(rapport) && /data-open-fem3d-horizontaal/.test(rapport));
check("UC per groep uit de staaltoets", /openFem3DUcPerGroep\(model, checks\.results\)/.test(rapport) && /data-open-fem3d-uc-per-groep/.test(rapport));

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

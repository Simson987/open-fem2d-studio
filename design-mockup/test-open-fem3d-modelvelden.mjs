// Nieuwe modelvelden van de 3D-module: trek-alleen staven, starre horizontale
// schijven en namen/groepen uit een bronmodel. Het bestand moet ze bewaren en
// ongeldige invoer weigeren; de rekenroute geeft trek-alleen en schijven aan
// de kern door (het rekenen zelf: test-open-fem3d-trek-schijf.mjs).
const { parseOpenFem3DModel, removeOpenFem3DNode } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { buildOpenFem3DSolveRequest } = await import("./src/components/openFem3d/openFem3dSolver.ts");
let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => { if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); } };
const fout = (f) => { try { f(); return null; } catch (e) { return e.message; } };

const basis = () => ({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0, name: "K 1/A +0.000" }, { id: 2, x: 6, y: 0, z: 0 },
    { id: 3, x: 0, y: 0, z: 4 }, { id: 4, x: 6, y: 0, z: 4 },
  ],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 3, profileName: "HEA 200", material: "S235", name: "Kolom 1/A", group: "kolom" },
    { id: 2, startNodeId: 2, endNodeId: 4, profileName: "HEA 200", material: "S235", group: "kolom" },
    { id: 3, startNodeId: 3, endNodeId: 4, profileName: "IPE 270", material: "S235" },
    { id: 4, startNodeId: 1, endNodeId: 4, profileName: "HEA 200", material: "S235", tensionOnly: true, group: "windverband" },
  ],
  supports: [
    { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
    { nodeId: 2, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
  ],
  loads: [{ id: 1, nodeId: 3, fx: 10, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
  diaphragms: [{ id: 1, nodeIds: [3, 4], name: "Vloer +4.000" }],
});

log("[1] lezen en bewaren");
const model = parseOpenFem3DModel(basis());
check("trek-alleen blijft staan", model.beams.find((b) => b.id === 4).tensionOnly === true);
check("een staaf zonder de vlag krijgt geen veld", !("tensionOnly" in model.beams.find((b) => b.id === 3)));
check("naam en groep van staaf en knoop blijven staan",
  model.beams[0].name === "Kolom 1/A" && model.beams[0].group === "kolom" && model.nodes[0].name === "K 1/A +0.000");
check("de schijf blijft staan", JSON.stringify(model.diaphragms) === JSON.stringify([{ id: 1, nodeIds: [3, 4], name: "Vloer +4.000" }]));
const tweeKeer = parseOpenFem3DModel(JSON.parse(JSON.stringify(model)));
check("opslaan en opnieuw lezen verandert niets", JSON.stringify(tweeKeer) === JSON.stringify(model));
check("tensionOnly false wordt niet bewaard",
  !("tensionOnly" in parseOpenFem3DModel({ ...basis(), beams: basis().beams.map((b) => ({ ...b, tensionOnly: false })) }).beams[0]));

log("\n[2] ongeldige invoer");
const met = (wijzig) => { const m = basis(); wijzig(m); return fout(() => parseOpenFem3DModel(m)); };
check("trek-alleen moet een boolean zijn", /trek-alleen/.test(met((m) => { m.beams[0].tensionOnly = "ja"; }) ?? ""));
check("een schijf met één knoop wordt geweigerd", /minder dan twee/.test(met((m) => { m.diaphragms[0].nodeIds = [3]; }) ?? ""));
check("een schijf naar een ontbrekende knoop wordt geweigerd", /ontbrekende knoop/.test(met((m) => { m.diaphragms[0].nodeIds = [3, 99]; }) ?? ""));
check("een knoop in twee schijven wordt geweigerd",
  /hoogstens één schijf/.test(met((m) => { m.diaphragms.push({ id: 2, nodeIds: [4, 1] }); }) ?? ""));
check("een dubbele schijf-id wordt geweigerd", /dubbele id/.test(met((m) => { m.diaphragms.push({ id: 1, nodeIds: [1, 2] }); }) ?? ""));
check("een naam moet tekst zijn", /naam of groep/.test(met((m) => { m.beams[0].group = 5; }) ?? ""));

log("\n[3] knoop verwijderen");
const zonder3 = removeOpenFem3DNode(model, 3);
check("een schijf die onder de twee knopen zakt, verdwijnt", zonder3.diaphragms.length === 0);
const drie = parseOpenFem3DModel({ ...basis(), diaphragms: [{ id: 1, nodeIds: [1, 3, 4] }] });
check("anders verlaat alleen die knoop de schijf",
  JSON.stringify(removeOpenFem3DNode(drie, 1).diaphragms) === JSON.stringify([{ id: 1, nodeIds: [3, 4] }]));

log("\n[4] rekenroute");
const metVelden = buildOpenFem3DSolveRequest(model, "linear");
check("trek-alleen en de schijf gaan naar de kern",
  metVelden.members.find((m) => m.id === 4)?.tensionOnly === true
    && JSON.stringify(metVelden.diaphragms) === JSON.stringify([{ id: 1, nodeIds: [3, 4] }]));
const gewoon = parseOpenFem3DModel({ ...basis(), beams: basis().beams.map(({ tensionOnly: _t, ...b }) => b), diaphragms: [] });
const verzoek = buildOpenFem3DSolveRequest(gewoon, "linear");
check("namen en groepen gaan niet naar de kern (deny_unknown_fields)",
  verzoek.members.every((m) => !("name" in m) && !("group" in m)) && verzoek.nodes.every((n) => !("name" in n)));

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

// Lijnlast in een globale richting in 3D (issue #80), de app-kant:
//  1. het model: lezen en keuren (richting x/y/z, eindige qStart/qEnd met
//     minstens één niet-nulwaarde, geen lokale waarden bij een globale last,
//     perProjection een ja/nee), oude bestanden met lokale lasten blijven
//     byte-gelijk;
//  2. bewerken: toevoegen, wijzigen van lokaal naar globaal en terug, knippen
//     (de waarde op het knippunt geïnterpoleerd, richting en projectie mee),
//     de lokale assen omkeren (een globale last verandert niet);
//  3. het rekenverzoek: een globale last 1-op-1 volgens het contract
//     (globalDirection, qStartKnPerM, qEndKnPerM, perProjection alleen als
//     hij aan staat), met de factor van een combinatie; lokale lasten exact
//     als voorheen;
//  4. het projectbestand: heen en terug, en de versie (zie hieronder);
//  5. de onafhankelijke krachtensom en de scheefstand rekenen de globale last
//     mee (per staafmeter q, per projectie q·|e_x × d|);
//  6. het tekenen: pijlen in de globale richting met de staart langs de
//     staaf, en bij per projectie een gestippelde projectielijn loodrecht op
//     de lastrichting; het rapportbeeld idem met "proj." in het label;
//  7. de IFC-export: GLOBAL_COORDS en, per projectie, PROJECTED_LENGTH; de
//     import van die export houdt dezelfde verticale som;
//  8. rekenen via de echte 3D-kern (OPEN_FEM_3D_SOLVER_PATH of de debugbouw):
//     analytisch (vrij opgelegde schuine spant per projectie en per
//     staaflengte, kolom met een globale X-last). Van eind tot eind door de
//     rekenweg van de app, met N-lijn en reacties: test-open-fem3d-globale-lijnlast-e2e.mjs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import {
  OPEN_FEM_3D_SUPPORT_PRESETS, addOpenFem3DMemberLoad, flipOpenFem3DBeamLocalAxes, openFem3DGlobalMemberLoadFactor,
  openFem3DMemberAxes, openFem3DMemberLoadAlongMember, parseOpenFem3DModel, splitOpenFem3DBeam, updateOpenFem3DMemberLoad,
} from "./src/components/openFem3d/openFem3dModel.ts";
import {
  addOpenFem3DConditionMarkers, openFem3DConditionMarkerSize, openFem3DLoadPickSegments,
} from "./src/components/openFem3d/openFem3dMarkers.ts";
import { buildOpenFem3DSolveRequest, openFem3DGlobalForceBalance } from "./src/components/openFem3d/openFem3dSolver.ts";
import { metScheefstandLasten } from "./src/components/openFem3d/openFem3dScheefstand.ts";
import { openFem3DRapportBeeld } from "./src/components/openFem3d/openFem3dRapportBeeld.ts";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY } from "./src/components/openFem3d/openFem3dVisibility.ts";
import { PROJECT_FORMAT_VERSION_3D, deserializeProject, serializeProject } from "./src/io/projectFile.ts";
import { bouwIfcRekenmodel, valideerIfc } from "./src/io/ifcExport.ts";
import { importeerIfcAnalyseModel } from "./src/io/ifcAnalyseImport.ts";
import { resolveSection } from "./src/lib/sectionResolver.ts";

let geslaagd = 0;
const ok = (waar, naam) => { assert.ok(waar, naam); geslaagd++; console.log(`  ✓ ${naam}`); };
const gelijk = (werkelijk, verwacht, naam, relatief = 1e-9, absoluut = 1e-9) => {
  const verschil = Math.abs(werkelijk - verwacht);
  assert.ok(verschil <= Math.max(absoluut, Math.abs(verwacht) * relatief),
    `${naam}: berekend ${werkelijk}, verwacht ${verwacht} (verschil ${verschil})`);
  geslaagd++;
  console.log(`  ✓ ${naam}`);
};
const zelfde = (werkelijk, verwacht, naam) => {
  assert.deepStrictEqual(werkelijk, verwacht, naam);
  geslaagd++;
  console.log(`  ✓ ${naam}`);
};
const weigert = (f, patroon, naam) => {
  assert.throws(f, patroon, naam);
  geslaagd++;
  console.log(`  ✓ ${naam}`);
};

// Een schuine spant: horizontaal 4 m, 3 m omhoog, dus L = 5 m en cos α = 0,8;
// daarachter een liggende staaf van 4 m terug omlaag naar knoop 3.
const spant = (extra = {}) => parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 3 }, { id: 3, x: 8, y: 0, z: 0 }],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 300", material: "S235" },
    { id: 2, startNodeId: 2, endNodeId: 3, profileName: "IPE 300", material: "S235" },
  ],
  supports: [{ nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.fixed }, { nodeId: 3, ...OPEN_FEM_3D_SUPPORT_PRESETS.pinned }],
  loads: [], memberLoads: extra.memberLoads ?? [], memberPointLoads: [],
});
const sneeuw = { globalDirection: "z", qStart: -2, qEnd: -2, perProjection: true, startPositionM: 0, endPositionM: 5 };

console.log("[1] het model: lezen en keuren");
{
  const model = addOpenFem3DMemberLoad(spant(), 1, sneeuw, 1);
  zelfde(model.memberLoads, [{
    id: 1, beamId: 1, caseId: 1, globalDirection: "z", qStart: -2, qEnd: -2, perProjection: true, startPositionM: 0, endPositionM: 5,
  }], "een globale Z-last per projectie, zonder lokale velden");
  ok(!("qyStart" in model.memberLoads[0]) && !("qzEnd" in model.memberLoads[0]), "geen qy/qz in een globale last");
  const perMeter = addOpenFem3DMemberLoad(spant(), 1, { ...sneeuw, perProjection: false }, 1).memberLoads[0];
  ok(!("perProjection" in perMeter), "perProjection false wordt niet bewaard (standaard per staafmeter)");
  const metNullen = addOpenFem3DMemberLoad(spant(), 1, { ...sneeuw, qyStart: 0, qyEnd: 0, qzStart: 0, qzEnd: 0 }, 1).memberLoads[0];
  ok(!("qyStart" in metNullen) && metNullen.globalDirection === "z", "lokale velden 0 naast een globale last: toegestaan en weggelaten");
  zelfde(parseOpenFem3DModel(JSON.parse(JSON.stringify(model))), model, "heen en terug door JSON: gelijk");
  const trapezium = addOpenFem3DMemberLoad(spant(), 2, { globalDirection: "x", qStart: 1, qEnd: 3, startPositionM: 1, endPositionM: 4 }, 2);
  zelfde(trapezium.memberLoads[0], { id: 1, beamId: 2, caseId: 2, globalDirection: "x", qStart: 1, qEnd: 3, startPositionM: 1, endPositionM: 4 },
    "een globale X-trapeziumlast over een deel");
  weigert(() => addOpenFem3DMemberLoad(spant(), 1, { ...sneeuw, qzStart: -1, qzEnd: -1 }), /lokale/,
    "een globale last met lokale waarden wordt geweigerd");
  for (const richting of ["Z", "w", 1, ""]) {
    weigert(() => addOpenFem3DMemberLoad(spant(), 1, { ...sneeuw, globalDirection: richting }), /richting/,
      `richting ${JSON.stringify(richting)} wordt geweigerd`);
  }
  for (const [naam, waarden] of [
    ["qStart NaN", { qStart: Number.NaN }], ["qEnd oneindig", { qEnd: Infinity }], ["qStart als tekst", { qStart: "1" }],
    ["qEnd ontbreekt", { qEnd: undefined }],
  ]) {
    weigert(() => addOpenFem3DMemberLoad(spant(), 1, { ...sneeuw, ...waarden }), /eindige/, `${naam} wordt geweigerd`);
  }
  weigert(() => addOpenFem3DMemberLoad(spant(), 1, { ...sneeuw, qStart: 0, qEnd: 0 }), /niet-nulwaarde/, "q = 0 over de hele last wordt geweigerd");
  weigert(() => addOpenFem3DMemberLoad(spant(), 1, { ...sneeuw, perProjection: "ja" }), /perProjection/, "perProjection moet ja/nee zijn");
  weigert(() => addOpenFem3DMemberLoad(spant(), 1, { ...sneeuw, endPositionM: 5.1 }), /staaflengte/, "buiten de staaflengte wordt geweigerd");
  const lokaal = { qyStart: 0, qyEnd: 0, qzStart: -1, qzEnd: -1, startPositionM: 0, endPositionM: 5 };
  for (const veld of ["qStart", "qEnd", "perProjection"]) {
    weigert(() => addOpenFem3DMemberLoad(spant(), 1, { ...lokaal, [veld]: veld === "perProjection" ? true : 1 }), /globalDirection/,
      `${veld} zonder globalDirection wordt geweigerd`);
  }
  weigert(() => parseOpenFem3DModel({ ...JSON.parse(JSON.stringify(model)), memberLoads: [{ ...model.memberLoads[0], globalDirection: "y ", }] }),
    /richting/, "een bestand met een ongeldige richting wordt geweigerd");
}

console.log("\n[2] oude bestanden en lokale lasten: ongewijzigd");
{
  const oud = {
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 3 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 300", material: "S235" }],
    supports: [{ nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.fixed }],
    loads: [], memberPointLoads: [],
    memberLoads: [{ id: 1, beamId: 1, caseId: 1, qyStart: 0, qyEnd: 2, qzStart: -4, qzEnd: -6, startPositionM: 0.5, endPositionM: 3.5 }],
  };
  const gelezen = parseOpenFem3DModel(JSON.parse(JSON.stringify(oud)));
  ok(JSON.stringify(gelezen.memberLoads) === JSON.stringify(oud.memberLoads), "een lokale last leest byte-gelijk terug (zelfde velden en volgorde)");
  const verzoek = buildOpenFem3DSolveRequest(gelezen, "linear", 1);
  ok(JSON.stringify(verzoek.memberLoads) === JSON.stringify([{
    id: 1, memberId: 1, qyStartKnPerM: 0, qyEndKnPerM: 2, qzStartKnPerM: -4, qzEndKnPerM: -6, startPositionM: 0.5, endPositionM: 3.5,
  }]), "het verzoek van een lokale last is byte-gelijk aan voorheen");
}

console.log("\n[3] bewerken");
{
  const lokaal = addOpenFem3DMemberLoad(spant(), 1, { qyStart: 0, qyEnd: 0, qzStart: -3, qzEnd: -3, startPositionM: 0, endPositionM: 5 }, 1);
  const globaal = updateOpenFem3DMemberLoad(lokaal, 1, { globalDirection: "y", qStart: 4, qEnd: 2, startPositionM: 1, endPositionM: 5 });
  zelfde(globaal.memberLoads[0], { id: 1, beamId: 1, caseId: 1, globalDirection: "y", qStart: 4, qEnd: 2, startPositionM: 1, endPositionM: 5 },
    "wijzigen van lokaal naar globaal Y houdt id en geval");
  const terug = updateOpenFem3DMemberLoad(globaal, 1, { qyStart: 0, qyEnd: 0, qzStart: -3, qzEnd: -3, startPositionM: 0, endPositionM: 5 });
  zelfde(terug.memberLoads, lokaal.memberLoads, "en terug naar lokaal");

  // Knippen op 40 %: q loopt van 1 (s = 1) naar 4 (s = 4), dus op s = 2 is q = 2.
  const voor = addOpenFem3DMemberLoad(spant(), 1, { globalDirection: "z", qStart: -1, qEnd: -4, perProjection: true, startPositionM: 1, endPositionM: 4 }, 3);
  const { model: geknipt, secondBeamId } = splitOpenFem3DBeam(voor, 1, 0.4);
  const [eerste, tweede] = geknipt.memberLoads;
  zelfde(eerste, { id: 1, beamId: 1, caseId: 3, globalDirection: "z", qStart: -1, qEnd: -2, perProjection: true, startPositionM: 1, endPositionM: 2 },
    "knippen: het eerste deel tot het knippunt, q op het knippunt geïnterpoleerd");
  gelijk(tweede.qStart, -2, "knippen: het tweede deel begint met dezelfde q");
  zelfde({ ...tweede, qStart: -2, endPositionM: Math.round(tweede.endPositionM * 1e9) / 1e9 },
    { id: 2, beamId: secondBeamId, caseId: 3, globalDirection: "z", qStart: -2, qEnd: -4, perProjection: true, startPositionM: 0, endPositionM: 2 },
    "knippen: het tweede deel met richting en projectie");

  const beide = addOpenFem3DMemberLoad(voor, 1, { qyStart: 1, qyEnd: 1, qzStart: -2, qzEnd: -2, startPositionM: 0, endPositionM: 5 }, 3);
  const omgekeerd = flipOpenFem3DBeamLocalAxes(beide, 1);
  zelfde(omgekeerd.memberLoads[0], beide.memberLoads[0], "lokale assen omkeren: de globale last blijft gelijk");
  ok(omgekeerd.memberLoads[1].qyStart === -1 && omgekeerd.memberLoads[1].qzStart === 2, "en de lokale last draait mee, zoals voorheen");
}

console.log("\n[4] het rekenverzoek");
{
  const model = addOpenFem3DMemberLoad(addOpenFem3DMemberLoad(spant(), 1, sneeuw, 1), 2,
    { globalDirection: "x", qStart: 1, qEnd: 3, startPositionM: 1, endPositionM: 4 }, 2);
  zelfde(buildOpenFem3DSolveRequest(model, "linear", 1).memberLoads, [{
    id: 1, memberId: 1, globalDirection: "z", qStartKnPerM: -2, qEndKnPerM: -2, perProjection: true, startPositionM: 0, endPositionM: 5,
  }], "per projectie: 1-op-1 volgens het contract, zonder lokale velden");
  zelfde(buildOpenFem3DSolveRequest(model, "linear", 2).memberLoads, [{
    id: 2, memberId: 2, globalDirection: "x", qStartKnPerM: 1, qEndKnPerM: 3, startPositionM: 1, endPositionM: 4,
  }], "per staafmeter: zonder perProjection");
  const combinatie = buildOpenFem3DSolveRequest(model, "linear", new Map([[1, 1.5], [2, 0.5]])).memberLoads;
  zelfde(combinatie.map((load) => [load.qStartKnPerM, load.qEndKnPerM]), [[-3, -3], [0.5, 1.5]],
    "een combinatie vermenigvuldigt qStart en qEnd met de factor van het geval");
}

console.log("\n[5] het projectbestand en de versie");
{
  const project = (model3d) => ({
    nodes: [], beams: [], supports: [], plates: [], loads: [], loadCases: [{ id: 1, name: "G", type: "dead" }],
    modelDimension: "3d", model3d,
  });
  const model = addOpenFem3DMemberLoad(spant(), 1, sneeuw, 1);
  const tekst = serializeProject(project(model));
  const bestand = JSON.parse(tekst);
  zelfde(deserializeProject(tekst).model3d.memberLoads, model.memberLoads, "heen en terug: de globale last blijft gelijk");
  // Een eerdere uitgave (2026.39.2 en ouder) eist vier eindige lokale componenten
  // en weigert dus een last zonder qy/qz met een melding; er valt niets stil weg.
  // Daarom geen nieuwe bestandsversie: een 3D-project blijft versie 3.
  ok(bestand.version === PROJECT_FORMAT_VERSION_3D && bestand.version === 3, "een bestand met een globale lijnlast houdt versie 3");
  const oudeKeuring = (value) => ["qyStart", "qyEnd", "qzStart", "qzEnd"].some((name) => typeof value[name] !== "number" || !Number.isFinite(value[name]));
  ok(oudeKeuring(bestand.model3d.memberLoads[0]), "de lastkeuring van eerdere uitgaven weigert de opgeslagen globale last (geen stil verlies)");
  bestand.model3d.memberLoads[0].qzStart = -1;
  weigert(() => deserializeProject(JSON.stringify(bestand)), /lokale/, "een bestand met lokale én globale waarden wordt geweigerd");
}

console.log("\n[6] de onafhankelijke krachtensom");
{
  const reactie = (nodeId, f = {}) => ({ nodeId, fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0, ...f });
  const perProjectie = buildOpenFem3DSolveRequest(addOpenFem3DMemberLoad(spant(), 1, sneeuw, 1), "linear", 1);
  // q = 2 kN/m per horizontale meter over 4 m: 8 kN omlaag in het midden (2; 0; 1,5); de helft op elke knoop.
  ok(openFem3DGlobalForceBalance(perProjectie, { reactions: [reactie(1, { fz: 4 }), reactie(2, { fz: 4 })] }).ok,
    "per projectie: 2 × 4 kN sluit (8 kN = q · 4 m)");
  ok(!openFem3DGlobalForceBalance(perProjectie, { reactions: [reactie(1, { fz: 5 }), reactie(2, { fz: 5 })] }).ok,
    "per projectie: 2 × 5 kN (per staafmeter gerekend) sluit niet");
  const perMeter = buildOpenFem3DSolveRequest(addOpenFem3DMemberLoad(spant(), 1, { ...sneeuw, perProjection: false }, 1), "linear", 1);
  ok(openFem3DGlobalForceBalance(perMeter, { reactions: [reactie(1, { fz: 5 }), reactie(2, { fz: 5 })] }).ok,
    "per staafmeter: 2 × 5 kN sluit (10 kN = q · 5 m)");
  // X-trapezium 1 → 3 kN/m over s = 1 … 4 m op de schuine staaf: 6 kN in +X, zwaartepunt op
  // s = 1 + 3·(1 + 2·3)/(3·(1 + 3)) = 2,75 m, dus in (2,2; 0; 1,65). Eén reactie in knoop 1 met het moment.
  const trapezium = buildOpenFem3DSolveRequest(
    addOpenFem3DMemberLoad(spant(), 1, { globalDirection: "x", qStart: 1, qEnd: 3, startPositionM: 1, endPositionM: 4 }, 1), "linear", 1);
  const balans = openFem3DGlobalForceBalance(trapezium, { reactions: [reactie(1, { fx: -6, my: -1.65 * 6 })] });
  ok(balans.ok, `X-trapezium: kracht én moment sluiten (${balans.maxImbalanceKn.toExponential(1)} kN, ${balans.maxMomentImbalanceKnm.toExponential(1)} kNm)`);
  ok(!openFem3DGlobalForceBalance(trapezium, { reactions: [reactie(1, { fx: -6, my: -1.5 * 6 })] }).ok,
    "X-trapezium: met de arm van het midden (1,5 m) sluit het moment niet");
  gelijk(openFem3DGlobalMemberLoadFactor([0.8, 0, 0.6], "z", true), 0.8, "projectiefactor |e_x × Z| van de spant = cos α");
  gelijk(openFem3DGlobalMemberLoadFactor([0.8, 0, 0.6], "y", true), 1, "projectiefactor |e_x × Y| = 1 (Y staat loodrecht op de spant)");
  gelijk(openFem3DGlobalMemberLoadFactor([0.8, 0, 0.6], "z", false), 1, "per staafmeter: factor 1");
}

console.log("\n[7] de scheefstand");
{
  const verzoek = buildOpenFem3DSolveRequest(addOpenFem3DMemberLoad(spant(), 1, sneeuw, 1), "linear", 1);
  const phi = 1 / 200;
  const met = metScheefstandLasten(verzoek, { phi, as: "x", richting: 1 });
  const extra = met.memberLoads.slice(verzoek.memberLoads.length);
  zelfde(extra.map(({ qStartKnPerM: _q1, qEndKnPerM: _q2, ...rest }) => rest),
    [{ id: 2, memberId: 1, globalDirection: "x", startPositionM: 0, endPositionM: 5 }],
    "een globale Z-last geeft één globale X-last per staafmeter over hetzelfde deel");
  gelijk(extra[0].qStartKnPerM, phi * 1.6, "met φ·V, V = q·cos α = 1,6 kN/m per staafmeter (begin)");
  gelijk(extra[0].qEndKnPerM, phi * 1.6, "en eind");
  const horizontaal = extra.reduce((som, last) => som + (last.qStartKnPerM + last.qEndKnPerM) / 2 * (last.endPositionM - last.startPositionM), 0)
    + met.nodalLoads.reduce((som, last) => som + last.fx, 0);
  gelijk(horizontaal, phi * 8, "de som van de horizontale lasten is φ·ΣV = φ · 8 kN");
  const xLast = buildOpenFem3DSolveRequest(addOpenFem3DMemberLoad(spant(), 1, { globalDirection: "x", qStart: 2, qEnd: 2, startPositionM: 0, endPositionM: 5 }, 1), "linear", 1);
  ok(metScheefstandLasten(xLast, { phi, as: "y", richting: -1 }).memberLoads.length === 1, "een globale X-last heeft geen verticale component: geen extra last");
}

console.log("\n[8] tekenen");
{
  const pijlen = (model) => {
    const groep = new THREE.Group();
    addOpenFem3DConditionMarkers(groep, model, { supports: false, loads: true }, 1);
    return { groep, delen: openFem3DLoadPickSegments(groep).filter((deel) => deel.selection.type === "memberLoad") };
  };
  const richting = (deel) => deel.b.clone().sub(deel.a).normalize();
  const ex = new THREE.Vector3(0.8, 0, 0.6);
  const evenwijdig = (v, w) => Math.abs(Math.abs(v.dot(w)) - 1) < 1e-9;
  {
    const { groep, delen } = pijlen(addOpenFem3DMemberLoad(spant(), 1, sneeuw, 1));
    const omlaag = delen.filter((deel) => evenwijdig(richting(deel), new THREE.Vector3(0, 0, 1)));
    ok(omlaag.length >= 3 && omlaag.every((deel) => richting(deel).z < 0), `${omlaag.length} pijlen recht omlaag (globaal −Z), niet loodrecht op de spant`);
    ok(omlaag.every((deel) => Math.abs(deel.b.y) < 1e-9 && Math.abs(deel.b.z - deel.b.x * 0.75) < 1e-9), "de punten liggen op de spant");
    const staarten = delen.filter((deel) => !omlaag.includes(deel));
    ok(staarten.length >= 2 && staarten.every((deel) => evenwijdig(richting(deel), ex)), "de staartlijn loopt langs de staaf");
    const projecties = [];
    groep.traverse((object) => { if (object.userData.openFem3dLoadProjection) projecties.push(object); });
    ok(projecties.length === 1 && projecties[0].userData.type === "memberLoad" && projecties[0].userData.id === 1,
      "per projectie: één gestippelde projectielijn, kiesbaar en te markeren als de last");
    const punten = projecties[0].geometry.getAttribute("position");
    const zs = [], xs = [];
    for (let i = 0; i < punten.count; i++) { zs.push(punten.getZ(i)); xs.push(punten.getX(i)); }
    ok(Math.max(...zs) - Math.min(...zs) < 1e-9 && Math.min(...zs) > 3, "de projectielijn ligt horizontaal (loodrecht op Z), boven de staarten");
    gelijk(Math.max(...xs) - Math.min(...xs), 4, "en overspant de horizontale projectie van 4 m", 0.02);
    ok(punten.count >= 8 && punten.count % 2 === 0, `gestippeld: ${punten.count / 2} streepjes`);
  }
  {
    const { groep } = pijlen(addOpenFem3DMemberLoad(spant(), 1, { ...sneeuw, perProjection: false }, 1));
    let projecties = 0;
    groep.traverse((object) => { if (object.userData.openFem3dLoadProjection) projecties++; });
    ok(projecties === 0, "per staafmeter: geen projectielijn");
  }
  {
    const lokaal = pijlen(addOpenFem3DMemberLoad(spant(), 1, { qyStart: 0, qyEnd: 0, qzStart: -2, qzEnd: -2, startPositionM: 0, endPositionM: 5 }, 1));
    const ez = new THREE.Vector3(-0.6, 0, 0.8);
    ok(lokaal.delen.filter((deel) => evenwijdig(richting(deel), ez)).length >= 3, "ter vergelijking: een lokale z-last staat loodrecht op de staaf");
  }
  {
    // Vier lasten: de markeringen gaan in GPU-batches; de projectielijn blijft een eigen object.
    let model = spant();
    for (let i = 0; i < 4; i++) model = addOpenFem3DMemberLoad(model, 1 + (i % 2), { ...sneeuw, endPositionM: 4 }, 1);
    let projecties = 0;
    pijlen(model).groep.traverse((object) => { if (object.userData.openFem3dLoadProjection) projecties++; });
    ok(projecties === 4, "met batches: nog steeds een projectielijn per last");
  }
  {
    const kolom = parseOpenFem3DModel({
      nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 3 }],
      beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEB 200", material: "S235" }],
      supports: [{ nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.fixed }],
      memberLoads: [{ id: 1, beamId: 1, globalDirection: "x", qStart: 2, qEnd: 2, startPositionM: 0, endPositionM: 3 }],
    });
    const { delen } = pijlen(kolom);
    const pijl = delen.filter((deel) => evenwijdig(richting(deel), new THREE.Vector3(1, 0, 0)));
    ok(pijl.length >= 3 && pijl.every((deel) => richting(deel).x > 0), "een kolom met een globale X-last: pijlen in +X");
  }
  {
    // Een globale last langs de staaf (kolom onder Globaal Z, ligger langs X
    // onder Globaal X) viel met pijlen, staartlijn en klikdoelen op de
    // staafas. Nu staat alles 0,8 markeringsmaat opzij, langs het deel van de
    // lokale z-as loodrecht op de lastrichting; de pijlen houden hun richting.
    const staaf = (eind, last, rol) => parseOpenFem3DModel({
      nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, ...eind }],
      beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEB 200", material: "S235", ...(rol ? { rollAngleRad: rol } : {}) }],
      supports: [{ nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.fixed }],
      memberLoads: [{ id: 1, beamId: 1, startPositionM: 0, endPositionM: 3, ...last }],
    });
    const kolomZ = staaf({ x: 0, y: 0, z: 3 }, { globalDirection: "z", qStart: -2, qEnd: -2 });
    const opzij = 0.8 * openFem3DConditionMarkerSize(kolomZ.nodes);
    ok(openFem3DMemberLoadAlongMember(kolomZ.memberLoads[0], [0, 0, 1]), "een kolom onder Globaal Z ligt langs de staaf");
    ok(!openFem3DMemberLoadAlongMember({ ...sneeuw, id: 1, beamId: 1 }, [0.8, 0, 0.6]) && !openFem3DMemberLoadAlongMember(
      { id: 1, beamId: 1, qyStart: 0, qyEnd: 0, qzStart: -2, qzEnd: -2, startPositionM: 0, endPositionM: 3 }, [1, 0, 0]),
    "een globale last schuin op de staaf en een lokale last niet");
    const punten = (delen) => delen.flatMap((deel) => [deel.a, deel.b]);
    {
      const { delen } = pijlen(kolomZ);
      const omlaag = delen.filter((deel) => evenwijdig(richting(deel), new THREE.Vector3(0, 0, 1)));
      ok(delen.length >= 4 && omlaag.length === delen.length && omlaag.some((deel) => richting(deel).z < 0),
        `kolom onder Globaal Z: ${delen.length} lijnstukken, alle in Z, de pijlen omlaag`);
      ok(punten(delen).every((p) => Math.abs(p.x - opzij) < 1e-9 && Math.abs(p.y) < 1e-9),
        `kolom: pijlen, staartlijn en klikdoelen ${opzij.toFixed(2)} m naast de staafas (+X), niet erop`);
      const zs = punten(delen).map((p) => p.z);
      ok(Math.min(...zs) < 0.5 && Math.max(...zs) > 2.5, "en over de hele kolomhoogte");
    }
    {
      const { delen } = pijlen(staaf({ x: 3, y: 0, z: 0 }, { globalDirection: "x", qStart: 1, qEnd: 3 }));
      ok(delen.length >= 4 && delen.every((deel) => evenwijdig(richting(deel), new THREE.Vector3(1, 0, 0))), "ligger langs X onder Globaal X: alles in X");
      ok(punten(delen).every((p) => Math.abs(p.z - opzij) < 1e-9 && Math.abs(p.y) < 1e-9), "ligger: boven de staafas");
    }
    {
      // Met een rolhoek van 90° draait lokaal z mee: de pijlen schuiven langs die as.
      const { delen } = pijlen(staaf({ x: 0, y: 0, z: 3 }, { globalDirection: "z", qStart: -2, qEnd: -2 }, Math.PI / 2));
      ok(punten(delen).every((p) => Math.abs(Math.hypot(p.x, p.y) - opzij) < 1e-9), "met rolhoek: dezelfde afstand tot de staafas");
      ok(punten(delen).every((p) => Math.abs(p.x) < 1e-9), `met rolhoek: langs de gedraaide lokale z (y ${punten(delen)[0].y.toFixed(3)})`);
    }
    {
      // Het rapportbeeld (vooraanzicht): de pijlen van de kolomlast 10 px rechts van de staaflijn, verticaal omlaag.
      const beeld = openFem3DRapportBeeld({
        model: kolomZ, lagen: { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, beams: true, loads: true, supports: false }, view: "front", camera: null,
        resultaat: null, utilizations: [], loadCaseId: 1,
      });
      const lijn = beeld.staven[0];
      ok(beeld.lastpijlen.length >= 3 && beeld.lastpijlen.every((p) => Math.abs(p.x1 - p.x2) < 1e-6 && p.y2 > p.y1),
        "rapportbeeld kolom: pijlen verticaal omlaag");
      ok(beeld.lastpijlen.every((p) => Math.abs(p.x2 - lijn.x1 - 10) < 1e-6), `rapportbeeld kolom: 10 px rechts van de staaflijn (x ${lijn.x1.toFixed(1)})`);
      ok(beeld.teksten.some((t) => t.tekst === "q 2 kN/m"), "rapportbeeld kolom: het label blijft");
    }
  }
  {
    // Het rapportbeeld (vooraanzicht): pijlen recht omlaag op het scherm en "proj." in het label.
    const model = addOpenFem3DMemberLoad(spant(), 1, sneeuw, 1);
    const beeld = openFem3DRapportBeeld({
      model, lagen: { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, beams: true, loads: true }, view: "front", camera: null,
      resultaat: null, utilizations: [], loadCaseId: 1,
    });
    ok(beeld.lastpijlen.length >= 3 && beeld.lastpijlen.every((p) => Math.abs(p.x2 - p.x1) < 1e-6 && p.y2 > p.y1),
      "rapportbeeld: de pijlen staan verticaal, omlaag");
    ok(beeld.teksten.some((t) => t.tekst === "q 2 kN/m proj."), `rapportbeeld: label met proj. (${beeld.teksten.map((t) => t.tekst).join(" | ")})`);
  }
}

console.log("\n[9] de IFC-export");
{
  // Globaal in GLOBAL_COORDS, per projectie als PROJECTED_LENGTH; de import leest dat terug
  // (als lokale last met knoopkrachten) met dezelfde verticale som: q · 4 m = 8 kN omlaag.
  const model = addOpenFem3DMemberLoad(spant(), 1, sneeuw, 1);
  const project = deserializeProject(serializeProject({
    nodes: [], beams: [], supports: [], plates: [], loads: [], loadCases: [{ id: 1, name: "S", type: "snow" }],
    activeLoadCaseId: 1, modelDimension: "3d", model3d: model,
  }));
  const ifc = bouwIfcRekenmodel({ ...project, projectNaam: "Spant" });
  zelfde(valideerIfc(ifc).fouten, [], "de export is geldig IFC4");
  const actie = ifc.split("\n").find((regel) => regel.includes("IFCSTRUCTURALLINEARACTION(") && regel.includes("'3D-staaflast 1'"));
  ok(actie?.includes(".GLOBAL_COORDS.") && actie.includes(".PROJECTED_LENGTH.") && actie.includes(".CONST."),
    `globaal per projectie: GLOBAL_COORDS en PROJECTED_LENGTH (${actie})`);
  ok(ifc.includes("IFCSTRUCTURALLOADLINEARFORCE('3D q 1',IFCLINEARFORCEMEASURE(0.),IFCLINEARFORCEMEASURE(0.),IFCLINEARFORCEMEASURE(-2000.)"),
    "de lijnkracht in globaal Z: −2000 N/m");
  const terug = importeerIfcAnalyseModel(ifc, { model: 2 }).model3d;
  let fz = (terug.loads ?? []).reduce((som, last) => som + last.fz, 0);
  for (const last of terug.memberLoads) {
    const staaf = terug.beams.find((b) => b.id === last.beamId);
    const a = terug.nodes.find((n) => n.id === staaf.startNodeId), e = terug.nodes.find((n) => n.id === staaf.endNodeId);
    const { ey, ez } = openFem3DMemberAxes(a, e, staaf.rollAngleRad ?? 0);
    fz += ((last.qyStart + last.qyEnd) / 2 * ey[2] + (last.qzStart + last.qzEnd) / 2 * ez[2]) * (last.endPositionM - last.startPositionM);
  }
  gelijk(fz, -8, "de import van die export: ΣFz = −8 kN (per projectie behouden)");
}

console.log("\n[10] rekenen via de 3D-kern");
const solverBinary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${solverBinary}`, import.meta.url));
const reken = (request) => new Promise((resolve, reject) => {
  const child = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  const uit = [], fout = [];
  child.stdout.on("data", (d) => uit.push(d));
  child.stderr.on("data", (d) => fout.push(d));
  child.on("error", reject);
  child.on("close", () => {
    try { resolve(JSON.parse(Buffer.concat(uit).toString())); }
    catch (error) { reject(new Error(`${error.message}; ${Buffer.concat(fout).toString().slice(0, 400)}`)); }
  });
  child.stdin.end(JSON.stringify(request));
});
const rekenModel = async (model) => {
  const request = { ...buildOpenFem3DSolveRequest(model, "linear", 1), bucklingModes: 0 };
  return { request, result: await reken(request) };
};
// Vrij opgelegde schuine spant (4 m horizontaal, 3 m hoog): knoop 1 vast in X, Y en Z
// (en om X en Z, tegen draaien om de as), knoop 2 rolt in X.
const ligger = (memberLoads, eind = { x: 4, z: 3 }) => parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: eind.x, y: 0, z: eind.z }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 300", material: "S235" }],
  supports: [
    { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: false, rz: true },
    { nodeId: 2, ux: false, uy: true, uz: true, rx: false, ry: false, rz: false },
  ],
  memberLoads,
});
const somFz = (result) => result.reactions.reduce((som, r) => som + r.fz, 0);
const maxMy = (result) => Math.max(...result.diagrams.momentY.find((d) => d.memberId === 1).points.map((p) => Math.abs(p.value)));
// Sinds de kern de globale last kent (#80) rekent dit deel altijd: een kern zonder
// globalDirection is een fout, geen reden om over te slaan.
assert.ok(existsSync(solverPath), `Bouw eerst de Rust-rekenkern (${solverPath}) of zet OPEN_FEM_3D_SOLVER_PATH.`);
const proef = await rekenModel(ligger([{ id: 1, beamId: 1, ...sneeuw }]));
{
  // Per projectie: w = 2 kN/m per horizontale meter over a = 4 m. ΣRz = w·a = 8 kN, M = w·a²/8 = 4 kNm.
  const { request, result } = proef;
  assert.ok(!result.fout, `kern: ${result.fout}`);
  gelijk(somFz(result), 8, "spant per projectie: ΣRz = q · 4 m = 8 kN", 1e-6);
  gelijk(maxMy(result), 4, "spant per projectie: M = q·a²/8 = 4 kNm (bemonsterd, 1 %)", 0.01);
  ok(openFem3DGlobalForceBalance(request, result).ok, "spant per projectie: de onafhankelijke krachtensom sluit");
}
{
  // Per staafmeter: 2 kN/m over L = 5 m verticaal = 2,5 kN/m per horizontale meter. ΣRz = 10 kN, M = 2,5·16/8 = 5 kNm.
  const { request, result } = await rekenModel(ligger([{ id: 1, beamId: 1, ...sneeuw, perProjection: false }]));
  assert.ok(!result.fout, `kern: ${result.fout}`);
  gelijk(somFz(result), 10, "spant per staafmeter: ΣRz = q · 5 m = 10 kN", 1e-6);
  gelijk(maxMy(result), 5, "spant per staafmeter: M = 5 kNm (bemonsterd, 1 %)", 0.01);
  ok(openFem3DGlobalForceBalance(request, result).ok, "spant per staafmeter: de onafhankelijke krachtensom sluit");
}
{
  // Een liggende ligger: globaal Z per staafmeter = lokaal z (e_z = Z). Dezelfde uitkomst.
  const globaal = await rekenModel(ligger([{ id: 1, beamId: 1, globalDirection: "z", qStart: -10, qEnd: -4, startPositionM: 1, endPositionM: 5 }], { x: 6, z: 0 }));
  const lokaal = await rekenModel(ligger([{ id: 1, beamId: 1, qyStart: 0, qyEnd: 0, qzStart: -10, qzEnd: -4, startPositionM: 1, endPositionM: 5 }], { x: 6, z: 0 }));
  assert.ok(!globaal.result.fout && !lokaal.result.fout, `kern: ${globaal.result.fout ?? lokaal.result.fout}`);
  for (const verplaatsing of lokaal.result.displacements) {
    const andere = globaal.result.displacements.find((d) => d.nodeId === verplaatsing.nodeId);
    for (const as of ["ux", "uy", "uz", "rx", "ry", "rz"]) {
      assert.ok(Math.abs(andere[as] - verplaatsing[as]) <= 1e-9 * Math.max(1e-6, Math.abs(verplaatsing[as])) + 1e-15,
        `knoop ${verplaatsing.nodeId} ${as}: globaal ${andere[as]}, lokaal ${verplaatsing[as]}`);
    }
  }
  ok(true, "liggende ligger: globaal Z-trapezium geeft dezelfde verplaatsingen als lokaal z");
}
{
  // Kolom 3 m, ingeklemd, globaal X 2 kN/m: H = 6 kN, M = q·h²/2 = 9 kNm, u = q·h⁴/(8EI).
  const kolom = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 3 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEB 200", material: "S235" }],
    supports: [{ nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.fixed }],
    memberLoads: [{ id: 1, beamId: 1, globalDirection: "x", qStart: 2, qEnd: 2, startPositionM: 0, endPositionM: 3 }],
  });
  const { request, result } = await rekenModel(kolom);
  assert.ok(!result.fout, `kern: ${result.fout}`);
  const voet = result.reactions.find((r) => r.nodeId === 1);
  gelijk(voet.fx, -6, "kolom: Rx = −q·h = −6 kN", 1e-6);
  gelijk(Math.abs(voet.my), 9, "kolom: |My| = q·h²/2 = 9 kNm", 1e-6);
  const EI = 210_000 * 1000 * resolveSection("S235", "HEB 200").I * 1e-12;
  gelijk(result.displacements.find((d) => d.nodeId === 2).ux, 2 * 3 ** 4 / (8 * EI), "kolom: u = q·h⁴/(8EI)", 1e-3);
  ok(openFem3DGlobalForceBalance(request, result).ok, "kolom: de onafhankelijke krachtensom sluit");
}

console.log(`\n${geslaagd} geslaagd, 0 gefaald`);

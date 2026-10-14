// Staaf op bedding in 3D (issue #106), de app-kant:
//  1. het model: lezen en keuren (positief, eindig, geen tikfout in een veld,
//     een verticale staaf alleen zijdelings), oude bestanden zonder het veld
//     blijven gelijk, het projectbestand heen en terug;
//  2. zetten en weghalen op één of meer staven als één stap ongedaan maken,
//     ook via staaf toevoegen/wijzigen; knippen houdt de bedding op beide delen;
//  3. de verzoekopbouw: `bedding` op Member3D volgens het contract, alleen bij
//     staven op bedding; een ongeldige bedding wordt vóór de kern geweigerd;
//  4. de uitkomst: gronddruk als lijn, de stukken zonder contact, de zakking
//     langs de staaf in de vervormde vorm, de rapportregels en de
//     onafhankelijke krachtensom met de grondveren (op de knopen van de kern);
//  5. het bedieningskanaal (model_3d_bouwen) met `beams[].bedding`;
//  (en, na de review van #106: de geometrie-wegen van de GUI keuren de
//  bedding, een bestand met bedding krijgt versie 5, een zijdelingse bedding
//  werkt rondom bij een staaf steiler dan 45°, en het rapportbeeld tekent de
//  laag Gronddruk);
//  6. rekenen via de echte 3D-kern (OPEN_FEM_3D_SOLVER_PATH of de debugbouw):
//     gelijkmatige last (zakking q/(k·b), geen buiging), puntlast tegen de
//     oplossing van Hetényi voor een eindige vrije balk, alleen druk met een
//     excentrische last (een deel komt los), een paal met zijdelingse bedding
//     en de weigering van een verticale k. Ontbreekt de kern of kent zij
//     `bedding` niet (een oude bouw), dan faalt de test met die melding.
//     Van eind tot eind (de rekenweg van de app, analytisch vergeleken):
//     test-open-fem3d-bedding-e2e.mjs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import {
  OpenFem3DBeddingVerticalError, addOpenFem3DBeam, openFem3DBeddingAllRound, parseOpenFem3DModel, readOpenFem3DBeamBedding,
  setOpenFem3DBeamBedding, setOpenFem3DBeamNodes, splitOpenFem3DBeam, updateOpenFem3DBeam, updateOpenFem3DNode,
} from "./src/components/openFem3d/openFem3dModel.ts";
import { transformOpenFem3D } from "./src/components/openFem3d/openFem3dTransform.ts";
import { openFem3DBeddingBandShapes, OPEN_FEM_3D_BEDDING_COLOR } from "./src/components/openFem3d/openFem3dBeddingBand.ts";
import { openFem3DRapportBeeld } from "./src/components/openFem3d/openFem3dRapportBeeld.ts";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY } from "./src/components/openFem3d/openFem3dVisibility.ts";
import { openFem3dHistoryReducer } from "./src/components/openFem3d/openFem3dHistory.ts";
import { buildOpenFem3DSolveRequest, openFem3DGlobalForceBalance } from "./src/components/openFem3d/openFem3dSolver.ts";
import {
  OPEN_FEM_3D_BEDDING_DEFAULT_K_KN_PER_M3, openFem3DBeddingLiftedRuns, openFem3DBeddingPileLateralForces,
  openFem3DBeddingPressurePoints, openFem3DBeddingRefusal, openFem3DBeddingResultOf, openFem3DBeddingSettlementAt,
  openFem3DBeddingSummary, openFem3DBeddingTributaryLengths,
} from "./src/components/openFem3d/openFem3dBedding.ts";
import { openFem3DMemberDisplacementStations } from "./src/components/openFem3d/openFem3dDisplacement.ts";
import { setOpenFem3DTensionOnly } from "./src/components/openFem3d/openFem3dTrekSchijf.ts";
import {
  PROJECT_FORMAT_VERSION_3D_BEDDING, PROJECT_FORMAT_VERSION_MAX, deserializeProject, serializeProject,
} from "./src/io/projectFile.ts";
import { resolveSection } from "./src/lib/sectionResolver.ts";

// Componenten importeren stylesheets; Node kent die niet. Een lege module volstaat.
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function load(url, ctx, next) {" +
        " if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };" +
        " return next(url, ctx); }",
    ),
);

let geslaagd = 0;
const ok = (waar, naam) => { assert.ok(waar, naam); geslaagd++; console.log(`  ✓ ${naam}`); };
const gelijk = (werkelijk, verwacht, naam, relatief = 1e-9, absoluut = 1e-9) => {
  const verschil = Math.abs(werkelijk - verwacht);
  assert.ok(verschil <= Math.max(absoluut, Math.abs(verwacht) * relatief),
    `${naam}: berekend ${werkelijk}, verwacht ${verwacht} (verschil ${verschil})`);
  geslaagd++;
  console.log(`  ✓ ${naam}`);
};
const weigert = (f, patroon, naam) => {
  assert.throws(f, patroon, naam);
  geslaagd++;
  console.log(`  ✓ ${naam}`);
};

/**
 * Een funderingsbalk van 6 m langs X (staaf 1), een ligger erboven op 3 m
 * (staaf 2, geen bedding) en een paal van 8 m onder knoop 1 (staaf 3).
 */
const basis = (extra = {}) => ({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 },
    { id: 3, x: 0, y: 0, z: 3 }, { id: 4, x: 6, y: 0, z: 3 }, { id: 5, x: 0, y: 0, z: -8 },
  ],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEB 300", material: "S235", ...(extra.balk ?? {}) },
    { id: 2, startNodeId: 3, endNodeId: 4, profileName: "IPE 300", material: "S235" },
    { id: 3, startNodeId: 5, endNodeId: 1, profileName: "HEB 300", material: "S235", ...(extra.paal ?? {}) },
  ],
  supports: [{ nodeId: 5, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
  loads: [{ id: 1, nodeId: 2, fx: 0, fy: 0, fz: -10, mx: 0, my: 0, mz: 0 }],
});
const strook = { kKnPerM3: 50_000, widthM: 0.6 };

console.log("[1] het model: lezen, keuren en bewaren");
{
  const oud = parseOpenFem3DModel(basis());
  ok(oud.beams.every((beam) => !("bedding" in beam)), "een bestand zonder bedding: geen veld");
  ok(JSON.stringify(parseOpenFem3DModel(JSON.parse(JSON.stringify(oud)))) === JSON.stringify(oud), "zonder bedding verandert heen en terug niets");
  const model = parseOpenFem3DModel(basis({ balk: { bedding: { ...strook, compressionOnly: false } } }));
  ok(JSON.stringify(model.beams[0].bedding) === JSON.stringify(strook), "k en b blijven staan; compressionOnly false wordt niet bewaard");
  const vol = parseOpenFem3DModel(basis({ balk: { bedding: { ...strook, kLateralKnPerM3: 20_000, compressionOnly: true } } }));
  ok(JSON.stringify(vol.beams[0].bedding) === JSON.stringify({ ...strook, kLateralKnPerM3: 20_000, compressionOnly: true }),
    "zijdelings en alleen druk blijven staan, in vaste volgorde");
  ok(JSON.stringify(parseOpenFem3DModel(JSON.parse(JSON.stringify(vol)))) === JSON.stringify(vol), "met bedding verandert heen en terug niets");
  ok(!("bedding" in parseOpenFem3DModel(basis({ balk: { bedding: null } })).beams[0]), "null in een bestand: geen bedding");
  const paal = parseOpenFem3DModel(basis({ paal: { bedding: { widthM: 0.3, kLateralKnPerM3: 20_000 } } }));
  ok(JSON.stringify(paal.beams[2].bedding) === JSON.stringify({ widthM: 0.3, kLateralKnPerM3: 20_000 }), "een paal met alleen zijdelingse bedding");
  const fout = (bedding, patroon, naam, waar = "balk") => weigert(() => parseOpenFem3DModel(basis({ [waar]: { bedding } })), patroon, naam);
  fout({ kKnPerM3: 0, widthM: 0.6 }, /3D-staaf 1: de beddingsconstante k \(kN\/m³\) moet een eindig getal groter dan 0 zijn/, "k = 0 wordt geweigerd");
  fout({ kKnPerM3: -5, widthM: 0.6 }, /groter dan 0/, "k < 0 wordt geweigerd");
  fout({ kKnPerM3: Number.NaN, widthM: 0.6 }, /eindig getal/, "k = NaN wordt geweigerd");
  fout({ kKnPerM3: "50000", widthM: 0.6 }, /eindig getal/, "k als tekst wordt geweigerd");
  fout({ kKnPerM3: 50_000 }, /mist de contactbreedte b \(widthM, in m\)/, "zonder breedte geweigerd");
  fout({ kKnPerM3: 50_000, widthM: 0 }, /contactbreedte b \(m\) moet een eindig getal groter dan 0/, "breedte 0 geweigerd");
  fout({ kKnPerM3: 50_000, widthM: Infinity }, /eindig/, "oneindige breedte geweigerd");
  fout({ widthM: 0.6 }, /geef een beddingsconstante/, "zonder constante geweigerd");
  fout({ kKnPerm3: 50_000, widthM: 0.6 }, /onbekend veld in de bedding: kKnPerm3/, "een tikfout in een veldnaam wordt geweigerd, niet genegeerd");
  fout({ ...strook, compressionOnly: "ja" }, /compressionOnly\) moet true of false zijn/, "alleen druk als tekst geweigerd");
  fout(50_000, /moet een object zijn/, "een getal in plaats van een object geweigerd");
  fout(strook, /3D-staaf 3 staat \(bijna\) verticaal: daar kan geen verticale bedding \(k\) onder/, "een paal met een verticale k wordt geweigerd", "paal");
  fout({ widthM: 0.3, kLateralKnPerM3: 20_000, compressionOnly: true }, /"alleen druk" geldt voor de verticale bedding/,
    "alleen druk zonder verticale k geweigerd", "paal");
  weigert(() => parseOpenFem3DModel(basis({ balk: { tensionOnly: true, bedding: strook } })), /3D-staaf 1 is trek-alleen en kan niet op bedding liggen/,
    "een bestand met een trek-alleen staaf op bedding wordt geweigerd (zoals de kern)");
  // Grens: |ex·Z| > 0,95 is verticaal (dezelfde grens als de kern en de kolomregel).
  const schuin = (dz) => readOpenFem3DBeamBedding(strook, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: dz }, "schuin");
  ok(schuin(3) !== undefined, "een schuine staaf met |ex·Z| = 0,949 mag een verticale k hebben");
  weigert(() => schuin(3.1), /verticaal/, "met |ex·Z| = 0,952 niet meer");
}

console.log("\n[2] zetten en weghalen, één stap ongedaan maken");
{
  const model = parseOpenFem3DModel(basis());
  const aan = setOpenFem3DBeamBedding(model, [1], { ...strook, compressionOnly: true });
  ok(JSON.stringify(aan.beams[0].bedding) === JSON.stringify({ ...strook, compressionOnly: true }), "zetten op één staaf");
  ok(aan.beams[1] === model.beams[1] && aan.beams[2] === model.beams[2], "de andere staven blijven dezelfde objecten");
  ok(setOpenFem3DBeamBedding(aan, [1], { ...strook, compressionOnly: true }) === aan, "dezelfde bedding opnieuw: hetzelfde model");
  const uit = setOpenFem3DBeamBedding(aan, [1], null);
  ok(!("bedding" in uit.beams[0]), "null haalt de bedding weg");
  ok(setOpenFem3DBeamBedding(model, [1], null) === model, "weghalen waar niets is: hetzelfde model");
  const twee = parseOpenFem3DModel({ ...basis(), beams: [...basis().beams, { id: 4, startNodeId: 3, endNodeId: 2, profileName: "IPE 300", material: "S235" }] });
  const beide = setOpenFem3DBeamBedding(twee, [1, 4], strook);
  ok(beide.beams.filter((beam) => beam.bedding).map((beam) => beam.id).join() === "1,4", "twee staven in één keer");
  let historie = { model: twee, past: [], future: [] };
  historie = openFem3dHistoryReducer(historie, { type: "edit", model: beide });
  ok(historie.past.length === 1, "één stap in de geschiedenis");
  historie = openFem3dHistoryReducer(historie, { type: "undo" });
  ok(historie.model === twee && twee.beams.every((beam) => !beam.bedding), "ongedaan maken haalt beide weg");
  weigert(() => setOpenFem3DBeamBedding(model, [9], strook), /3D-staaf 9 bestaat niet/, "een onbekende staaf");
  weigert(() => setOpenFem3DBeamBedding(model, [1, 3], strook), /3D-staaf 3 staat \(bijna\) verticaal/,
    "een selectie met een paal en een verticale k: geweigerd, met de paal in de melding");
  ok(model.beams.every((beam) => !beam.bedding), "na een weigering is het model onveranderd");
  // Staaf wijzigen en toevoegen gebruiken dezelfde keuring.
  const via = updateOpenFem3DBeam(model, 1, { bedding: strook });
  ok(JSON.stringify(via.beams[0].bedding) === JSON.stringify(strook), "updateOpenFem3DBeam zet de bedding");
  ok(!("bedding" in updateOpenFem3DBeam(via, 1, { bedding: null }).beams[0]), "updateOpenFem3DBeam met null haalt haar weg");
  weigert(() => updateOpenFem3DBeam(model, 3, { bedding: strook }), /verticaal/, "updateOpenFem3DBeam keurt tegen de stand van de staaf");
  const { model: erbij, beam } = addOpenFem3DBeam(model, { startNodeId: 3, endNodeId: 2, bedding: { kKnPerM3: 30_000, widthM: 0.4 } });
  ok(beam.id === 4 && JSON.stringify(beam.bedding) === JSON.stringify({ kKnPerM3: 30_000, widthM: 0.4 })
    && erbij.beams.at(-1).bedding !== undefined, "addOpenFem3DBeam met bedding");
  weigert(() => addOpenFem3DBeam(model, { startNodeId: 3, endNodeId: 5, bedding: strook }), /verticaal/, "een nieuwe verticale staaf met k: geweigerd");
  weigert(() => updateOpenFem3DNode(via, 2, { x: 0.2, z: 6 }), /verticaal/,
    "een knoop zo verplaatsen dat de staaf op bedding verticaal komt: geweigerd");
  const geknipt = splitOpenFem3DBeam(via, 1, 0.5).model;
  ok(geknipt.beams.filter((item) => JSON.stringify(item.bedding) === JSON.stringify(strook)).length === 2, "knippen: beide delen op dezelfde bedding");
  ok(OPEN_FEM_3D_BEDDING_DEFAULT_K_KN_PER_M3 === 50_000, "standaard k zoals de 2D-staafdialoog: 50 000 kN/m³");
  // Trek-alleen en bedding sluiten elkaar uit, in beide richtingen (zoals de kern).
  weigert(() => setOpenFem3DBeamBedding(setOpenFem3DTensionOnly(model, [1], true), [1], strook),
    /3D-staaf 1 is trek-alleen en kan niet op bedding liggen/, "bedding op een trek-alleen staaf: geweigerd");
  weigert(() => setOpenFem3DTensionOnly(via, [1], true), /3D-staaf 1 is trek-alleen en kan niet op bedding liggen/,
    "een staaf op bedding trek-alleen maken: geweigerd");
  ok(!("tensionOnly" in setOpenFem3DTensionOnly(via, [1], false).beams[0]), "trek-alleen uitzetten op een staaf op bedding mag");
  weigert(() => updateOpenFem3DBeam(via, 1, { tensionOnly: true }), /trek-alleen en kan niet op bedding liggen/,
    "updateOpenFem3DBeam: trek-alleen op een staaf op bedding geweigerd");
  ok(updateOpenFem3DBeam(via, 1, { tensionOnly: true, bedding: null }).beams[0].tensionOnly === true,
    "in één wijziging de bedding weg en trek-alleen aan: mag");
}

console.log("\n[2b] de geometrie-wegen van de GUI keuren de bedding");
{
  // Review #106: draaien en verplaatsen (transformatiepaneel en model3d.transform),
  // een coördinaat intypen en omhangen in het eigenschappenpaneel zetten een staaf
  // op een verticale k niet meer (bijna) verticaal; dezelfde regel als het lezen.
  // Voorheen ging dat door en lukten daarna opslaan en rekenen niet meer. Na elke
  // weigering is het model onveranderd en blijft het op te slaan.
  const { openFem3DModelWithNodeCoordinate } = await import("./src/components/openFem3d/OpenFem3DProperties.tsx");
  const opslaan = (model3d) => deserializeProject(serializeProject({
    nodes: [], beams: [], supports: [], plates: [], loads: [], loadCases: [{ id: 1, name: "G", type: "dead" }],
    modelDimension: "3d", model3d,
  })).model3d;
  const model = parseOpenFem3DModel(basis({ balk: { bedding: strook } }));
  const geweigerd = (f, naam) => {
    let fout = null;
    try { f(); } catch (error) { fout = error; }
    ok(fout instanceof OpenFem3DBeddingVerticalError && fout.beamId === 1 && /3D-staaf 1 komt dan \(bijna\) verticaal/.test(fout.message),
      `${naam}: geweigerd (${fout?.message?.slice(0, 60)})`);
    const melding = openFem3DBeddingRefusal(fout);
    ok(melding?.key === "openFem3d.bedding.verticalRefused" && melding.values.id === 1, `${naam}: vertaalde melding met het staafnummer`);
    ok(opslaan(model).beams[0].bedding?.kKnPerM3 === 50_000, `${naam}: het model blijft op te slaan`);
  };
  geweigerd(() => transformOpenFem3D(model, { type: "beam", id: 1 }, { kind: "rotate", axis: "y", angleDeg: 90 }), "draaien om Y met 90°");
  geweigerd(() => transformOpenFem3D(model, { type: "node", id: 2 }, { kind: "move", dx: -5.8, dy: 0, dz: 6 }), "knoop 2 tot boven knoop 1 verplaatsen");
  const x = openFem3DModelWithNodeCoordinate(model, 2, "x", 0.2);
  ok(x !== null && x.nodes.find((n) => n.id === 2).x === 0.2, "intypen: x = 200 mm laat de staaf liggen");
  geweigerd(() => openFem3DModelWithNodeCoordinate(x, 2, "z", 6), "intypen: z = 6000 mm zet de staaf verticaal");
  geweigerd(() => setOpenFem3DBeamNodes(model, 1, 1, 3), "omhangen naar knoop 3 (recht boven knoop 1)");
  ok(openFem3DBeddingRefusal(new Error("iets anders")) === null, "een andere melding wordt niet vertaald");
  // Wat niet verticaal wordt, gaat gewoon door; ook een schuine stand onder de grens.
  ok(transformOpenFem3D(model, { type: "beam", id: 1 }, { kind: "rotate", axis: "z", angleDeg: 90 }).model.beams[0].bedding?.kKnPerM3 === 50_000,
    "draaien om Z: de staaf blijft liggen, de bedding blijft");
  const schuin = transformOpenFem3D(model, { type: "beam", id: 1 }, { kind: "rotate", axis: "y", angleDeg: 70 }).model;
  ok(opslaan(schuin).beams[0].bedding?.kKnPerM3 === 50_000, "draaien om Y met 70° (|ex·Z| = 0,94): mag, en blijft op te slaan");
  // Met alleen een zijdelingse bedding mag de staaf wel verticaal (een paal); opslaan en rekenen blijven werken.
  const zij = setOpenFem3DBeamBedding(model, [1], { widthM: 0.6, kLateralKnPerM3: 20_000 });
  const gedraaid = transformOpenFem3D(zij, { type: "beam", id: 1 }, { kind: "rotate", axis: "y", angleDeg: 90 }).model;
  ok(JSON.stringify(opslaan(gedraaid).beams[0].bedding) === JSON.stringify({ widthM: 0.6, kLateralKnPerM3: 20_000 }), "zijdelings: draaien mag, opslaan blijft werken");
  ok(buildOpenFem3DSolveRequest(gedraaid, "linear", 1).members[0].bedding?.kLateralKnPerM3 === 20_000, "zijdelings: het verzoek gaat naar de kern");
  ok(opslaan(setOpenFem3DBeamNodes(zij, 1, 1, 3)).beams[0].endNodeId === 3, "zijdelings: omhangen mag");
  ok(opslaan(openFem3DModelWithNodeCoordinate(openFem3DModelWithNodeCoordinate(zij, 2, "x", 0.2), 2, "z", 6)).nodes.find((n) => n.id === 2).z === 6,
    "zijdelings: intypen mag");
  // De API kan in één wijziging omhangen en de verticale k weghalen.
  const api = updateOpenFem3DBeam(model, 1, { endNodeId: 3, bedding: { widthM: 0.6, kLateralKnPerM3: 20_000 } });
  ok(api.beams[0].endNodeId === 3 && api.beams[0].bedding.kKnPerM3 === undefined, "updateOpenFem3DBeam: omhangen naar verticaal en alleen zijdelings in één stap");
  weigert(() => updateOpenFem3DBeam(model, 1, { endNodeId: 3 }), /verticaal/, "updateOpenFem3DBeam: omhangen met de verticale k geweigerd");

  // Het veld Op bedding: staat er op een verticale staaf toch een verticale k (een model van vóór
  // deze keuring), dan blijft het k-veld zichtbaar zodat de gebruiker haar kan wissen.
  await import("./scripts/i18n-voor-tests.mjs");
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { OpenFem3DBeddingField } = await import("./src/components/openFem3d/OpenFem3DBeddingVeld.tsx");
  const veld = (m) => renderToStaticMarkup(React.createElement(OpenFem3DBeddingField, { model: m, beamIds: [1], onChange: () => {} }));
  const ongeldig = { ...model, nodes: model.nodes.map((n) => n.id === 2 ? { ...n, x: 0, z: 6 } : n) };
  const html = veld(ongeldig);
  ok(html.includes("data-open-fem3d-bedding-k") && html.includes("data-open-fem3d-bedding-vertical-k"),
    "verticaal met een verticale k: het k-veld en de melding staan er");
  const paalHtml = veld(gedraaid);
  ok(!paalHtml.includes("data-open-fem3d-bedding-k") && paalHtml.includes("data-open-fem3d-bedding-vertical")
    && !paalHtml.includes("data-open-fem3d-bedding-vertical-k"), "een paal met alleen zijdelings: geen k-veld, wel de uitleg");
  const steil = transformOpenFem3D(zij, { type: "beam", id: 1 }, { kind: "rotate", axis: "y", angleDeg: 60 }).model;
  ok(veld(steil).includes("data-open-fem3d-bedding-all-round"), "steiler dan 45° met zijdelingse k: de uitleg over rondom");
  ok(!veld(zij).includes("data-open-fem3d-bedding-all-round"), "liggend: geen uitleg over rondom");
}

console.log("\n[3] het projectbestand");
{
  const project = (model3d) => ({
    nodes: [], beams: [], supports: [], plates: [], loads: [], loadCases: [{ id: 1, name: "G", type: "dead" }],
    modelDimension: "3d", model3d,
  });
  const met = parseOpenFem3DModel(basis({ balk: { bedding: { ...strook, kLateralKnPerM3: 10_000, compressionOnly: true } } }));
  const terug = deserializeProject(serializeProject(project(met))).model3d;
  ok(JSON.stringify(terug.beams[0].bedding) === JSON.stringify(met.beams[0].bedding), "heen en terug: de bedding blijft gelijk");
  const zonder = parseOpenFem3DModel(basis());
  const tekst = serializeProject(project(zonder));
  ok(!tekst.includes("bedding") && JSON.parse(tekst).version === 3, "zonder bedding: geen veld en dezelfde versie als voorheen");
  const bestand = JSON.parse(tekst);
  bestand.model3d.beams[0].bedding = { kKnPerM3: -1, widthM: 0.6 };
  weigert(() => deserializeProject(JSON.stringify(bestand)), /groter dan 0/, "een bestand met een ongeldige bedding wordt geweigerd");
  // Versie (review #106): een uitgave zonder bedding (2026.39.2 en ouder, hoogste versie 4) zou het
  // veld stil overslaan en zonder de grond rekenen. Met bedding dus versie 5, die zo'n uitgave weigert.
  // Sinds #73 (verlopende staven, versie 6) en #107 (plaat op bedding, versie 7) is 5 niet meer de hoogste leesbare versie; de staafbedding houdt 5.
  ok(PROJECT_FORMAT_VERSION_3D_BEDDING === 5 && PROJECT_FORMAT_VERSION_MAX >= 5, "versie 5 voor bedding, en die is leesbaar");
  ok(JSON.parse(serializeProject(project(met))).version === 5, "met een staaf op bedding: versie 5");
  const paalAlleen = parseOpenFem3DModel(basis({ paal: { bedding: { widthM: 0.3, kLateralKnPerM3: 20_000 } } }));
  ok(JSON.parse(serializeProject(project(paalAlleen))).version === 5, "ook met alleen een zijdelingse bedding: versie 5");
  const metVlak = { ...met, loadPanels: [] };
  ok(JSON.parse(serializeProject(project(metVlak))).version === 5, "bedding gaat boven de versie van de belastingvlakken");
  ok(JSON.parse(serializeProject(project(setOpenFem3DBeamBedding(met, [1], null)))).version === 3, "bedding weer weg: terug naar versie 3");
  const versie5 = serializeProject(project(met));
  ok(JSON.stringify(deserializeProject(versie5).model3d.beams[0].bedding) === JSON.stringify(met.beams[0].bedding), "een bestand van versie 5 leest terug");
  const nieuwer = PROJECT_FORMAT_VERSION_MAX + 1;
  weigert(() => deserializeProject(JSON.stringify({ ...JSON.parse(versie5), version: nieuwer })), new RegExp(`nieuwere versie \\(${nieuwer}\\)`),
    `versie ${nieuwer} (boven de hoogste leesbare) wordt geweigerd`);
}

console.log("\n[4] de verzoekopbouw");
{
  const model = parseOpenFem3DModel(basis({
    balk: { bedding: { ...strook, compressionOnly: true } },
    paal: { bedding: { widthM: 0.3, kLateralKnPerM3: 20_000 } },
  }));
  const verzoek = buildOpenFem3DSolveRequest(model, "linear", 1);
  const lid = (id) => verzoek.members.find((member) => member.id === id);
  ok(JSON.stringify(lid(1).bedding) === JSON.stringify({ kKnPerM3: 50_000, widthM: 0.6, compressionOnly: true }), "de balk: k, b en alleen druk");
  ok(!("bedding" in lid(2)), "een staaf zonder bedding krijgt geen veld (een oudere kern rekent dan precies als voorheen)");
  ok(JSON.stringify(lid(3).bedding) === JSON.stringify({ widthM: 0.3, kLateralKnPerM3: 20_000 }), "de paal: alleen zijdelings");
  // Een model in het geheugen dat niet door de keuring ging: de melding komt vóór de kern.
  const ongekeurd = { ...model, beams: model.beams.map((beam) => beam.id === 3 ? { ...beam, bedding: strook } : beam) };
  weigert(() => buildOpenFem3DSolveRequest(ongekeurd, "linear", 1), /Staaf 3 staat \(bijna\) verticaal/, "een verticale k wordt vóór de kern geweigerd");
  // Grondveren tellen als oplegging, zoals in de kern: zonder knoopoplegging rekent een model op bedding.
  ok(buildOpenFem3DSolveRequest({ ...model, supports: [] }, "linear", 1).supports.length === 0, "op bedding zonder oplegging: het verzoek gaat naar de kern");
  weigert(() => buildOpenFem3DSolveRequest(parseOpenFem3DModel({ ...basis(), supports: [] }), "linear", 1), /minstens één 3D-oplegging/,
    "zonder bedding en zonder oplegging: nog steeds geweigerd");
}

// Een kleine nep-uitkomst van de kern voor de weergave en het rapport.
const L = 6;
const punten = (lijst) => lijst.map(([t, w, active = true]) => ({
  t, settlementM: w, pressureKnPerM: active ? 30_000 * w : 0, active,
}));
const nepUitkomst = (model, bedding, extra = {}) => ({
  schemaVersion: 1, engine: { id: "open-fem-3d", name: "Open FEM 3D", revision: "test", license: "AGPL-3.0" }, analysis: "linear",
  displacements: model.nodes.map((node) => ({ nodeId: node.id, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 })),
  reactions: [], memberForces: [], buckling: { status: "notApplicable", reason: "test" }, diagnostics: [],
  bedding, ...extra,
});

console.log("\n[5] de uitkomst: gronddruk, contact, zakking en rapport");
{
  const model = parseOpenFem3DModel(basis({ balk: { bedding: { ...strook, compressionOnly: true } } }));
  const lid = {
    memberId: 1,
    points: punten([[0, 0.002], [1 / 6, 0.0015], [2 / 6, 0.001], [3 / 6, 0.0004], [4 / 6, -0.0002, false], [5 / 6, -0.0008, false], [1, -0.0014, false]]),
    maxPressureKnPerM: 60, minPressureKnPerM: 0, maxSettlementM: 0.002, totalReactionKn: 123.4, liftedFraction: 0.25,
  };
  const uitkomst = nepUitkomst(model, [lid]);
  ok(openFem3DBeddingResultOf(uitkomst, 1) === lid && openFem3DBeddingResultOf(uitkomst, 2) === undefined
    && openFem3DBeddingResultOf(null, 1) === undefined, "de uitkomst per staaf");
  ok(JSON.stringify(openFem3DBeddingPressurePoints(uitkomst, 1)) === JSON.stringify(lid.points.map((p) => ({ t: p.t, value: p.pressureKnPerM }))),
    "de gronddruklijn: pressureKnPerM per punt");
  ok(openFem3DBeddingPressurePoints(uitkomst, 2).length === 0, "een staaf zonder bedding: geen lijn");
  gelijk(openFem3DBeddingSettlementAt(lid, 0.25), (0.0015 + 0.001) / 2, "zakking lineair tussen de punten");
  gelijk(openFem3DBeddingSettlementAt(lid, -1), 0.002, "voor het begin: de eerste waarde");
  const lengtes = openFem3DBeddingTributaryLengths(lid.points, L);
  ok(lengtes.length === 7 && Math.abs(lengtes[0] - 0.5) < 1e-12 && Math.abs(lengtes[3] - 1) < 1e-12
    && Math.abs(lengtes.reduce((a, b) => a + b, 0) - L) < 1e-12, "veerlengte per knoop: de halve stukken ernaast, samen L");
  const los = openFem3DBeddingLiftedRuns(lid);
  ok(los.length === 1 && Math.abs(los[0][0] - 7 / 12) < 1e-12 && los[0][1] === 1, `zonder contact van t = 7/12 tot 1 (${JSON.stringify(los)})`);
  ok(openFem3DBeddingLiftedRuns({ ...lid, points: lid.points.map((p) => ({ ...p, active: true })) }).length === 0, "alles in contact: geen stuk");
  const verzoek = buildOpenFem3DSolveRequest(model, "linear", 1);
  ok(!openFem3DBeddingPileLateralForces(verzoek, uitkomst), "geen zijdelingse kracht op een paal");
  const zij = (memberId) => [{ ...lid, memberId, points: lid.points.map((p) => ({ ...p, lateralKnPerM: 2 })) }];
  ok(!openFem3DBeddingPileLateralForces(verzoek, nepUitkomst(model, zij(1))), "zijdelingse kracht op de liggende balk: telt mee in de som");
  ok(openFem3DBeddingPileLateralForces(verzoek, nepUitkomst(model, zij(3))), "zijdelingse kracht op de paal: alleen een grootte");
  // De vervormde vorm volgt de zakking langs de staaf (de einden en het veld).
  const metEinden = { ...uitkomst, displacements: uitkomst.displacements.map((d) => d.nodeId === 1 ? { ...d, uz: -0.002 } : d.nodeId === 2 ? { ...d, uz: 0.0014 } : d) };
  const stations = openFem3DMemberDisplacementStations(model, model.beams[0], metEinden, 12);
  gelijk(stations.find((s) => Math.abs(s.t - 0.5) < 1e-9).uz, -0.0004, "vervormd: uz op het midden = −zakking");
  gelijk(stations.find((s) => Math.abs(s.t - 0.25) < 1e-9).uz, -0.00125, "vervormd: uz op een kwart, lineair tussen de punten");
  const zonderBedding = openFem3DMemberDisplacementStations(model, model.beams[1], metEinden, 12);
  ok(zonderBedding.every((s) => s.uz === 0), "een staaf zonder bedding houdt de bestaande vorm");
  // Rapport: per staaf op bedding k, b, grootste zakking, gronddruk in kN/m en kN/m², zonder contact.
  const rijen = openFem3DBeddingSummary(model, uitkomst);
  ok(rijen.length === 1 && rijen[0].beamId === 1, "één rapportregel: alleen staven op bedding");
  const r = rijen[0];
  ok(r.kKnPerM3 === 50_000 && r.widthMm === 600 && r.kLateralKnPerM3 === null && r.compressionOnly === true, "invoer in de regel");
  gelijk(r.result.maxSettlementMm, 2, "grootste zakking in mm");
  gelijk(r.result.maxPressureKnPerM, 60, "grootste gronddruk in kN/m");
  gelijk(r.result.maxPressureKnPerM2, 100, "grootste gronddruk in kN/m² = p/b");
  gelijk(r.result.liftedPercent, 25, "zonder contact in %");
  gelijk(r.result.totalReactionKn, 123.4, "som van de veerkrachten");
  ok(r.result.maxLateralKnPerM === null, "geen zijdelingse lijnlast");
  ok(openFem3DBeddingSummary(model, null)[0].result === null, "zonder uitkomst: alleen de invoer");
  ok(openFem3DBeddingSummary(model, nepUitkomst(model, undefined))[0].result === null, "een kern zonder bedding-uitvoer: alleen de invoer");

  // Rapportbeeld (review #106): de laag Gronddruk staat ook in de figuur, aan de kant van de grond,
  // in de kleur van de bedding en met de grootste waarde; uit, dan geen lijn.
  const lagen = { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, beams: true, supports: true, groundPressure: true };
  const beeld = (laag) => openFem3DRapportBeeld({ model, lagen: laag, view: "front", camera: null, resultaat: uitkomst, utilizations: [], loadCaseId: 1 });
  const figuur = beeld(lagen);
  const kleur = `#${OPEN_FEM_3D_BEDDING_COLOR.toString(16).padStart(6, "0")}`;
  ok(figuur.diagrammen.length === 1 && figuur.diagrammen[0].kleur === kleur, `rapportbeeld: één gronddruklijn in ${kleur}`);
  ok(figuur.teksten.some((t) => t.tekst === "p 60 kN/m" && t.kleur === kleur), "rapportbeeld: de grootste gronddruk als label");
  const lijnY = figuur.diagrammen[0].lijn.split(" ").map((p) => Number(p.split(",")[1]));
  const nul = figuur.diagrammen[0].nullijn;
  ok(Math.abs(nul.y1 - nul.y2) < 1e-6 && lijnY.every((y) => y >= nul.y1 - 1e-6) && Math.max(...lijnY) > nul.y1 + 1,
    "rapportbeeld: de lijn ligt onder de balk, aan de kant van de grond (vooraanzicht)");
  ok(beeld({ ...lagen, groundPressure: false }).diagrammen.length === 0, "rapportbeeld: laag uit, geen gronddruklijn");
  ok(beeld({ ...lagen, beams: false }).diagrammen.length === 0, "rapportbeeld: staven uit, ook geen gronddruklijn (zoals de snedekrachtlijnen)");

  // Rondom (review #106): een schoorpaal 1:3 (|ex·Z| = 0,949, onder de kolomgrens) met zijdelingse
  // bedding werkt rondom, loodrecht op de as; ook daar geeft de kern alleen een grootte. Een staaf
  // onder 30° houdt de horizontale normaal en telt mee in de onafhankelijke som.
  const schoor = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: -12 }, { id: 3, x: 10, y: 0, z: -10 / Math.sqrt(3) }],
    beams: [
      { id: 1, startNodeId: 2, endNodeId: 1, profileName: "HEB 300", material: "S235", bedding: { widthM: 0.4, kLateralKnPerM3: 30_000 } },
      { id: 2, startNodeId: 1, endNodeId: 3, profileName: "HEB 300", material: "S235", bedding: { widthM: 0.4, kLateralKnPerM3: 30_000 } },
    ],
    supports: [{ nodeId: 2, ux: false, uy: false, uz: true, rx: false, ry: false, rz: true }],
    loads: [{ id: 1, nodeId: 1, fx: 10, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
  });
  const knopen = new Map(schoor.nodes.map((n) => [n.id, n]));
  ok(openFem3DBeddingAllRound(schoor.beams[0], knopen) && !openFem3DBeddingAllRound(schoor.beams[1], knopen),
    "rondom: de schoorpaal 1:3 wel, de staaf onder 30° niet");
  const schoorVerzoek = buildOpenFem3DSolveRequest(schoor, "linear", 1);
  const schoorLid = (memberId) => [{ ...lid, memberId, points: lid.points.map((p) => ({ ...p, lateralKnPerM: 2 })) }];
  ok(openFem3DBeddingPileLateralForces(schoorVerzoek, nepUitkomst(schoor, schoorLid(1))), "zijdelingse kracht op de schoorpaal: alleen een grootte");
  ok(!openFem3DBeddingPileLateralForces(schoorVerzoek, nepUitkomst(schoor, schoorLid(2))), "zijdelingse kracht op de staaf onder 30°: telt mee");
  const banden = openFem3DBeddingBandShapes(schoor, 1);
  const [paalBand, schuinBand] = [1, 2].map((id) => banden.find((band) => band.beamId === id));
  const ex = paalBand.end.clone().sub(paalBand.start).normalize();
  ok(paalBand.kind === "pile" && paalBand.strips.length === 2
    && paalBand.strips.every((s) => Math.abs(s.normal.dot(ex)) < 1e-12 && Math.abs(s.normal.y) < 1e-12),
    "band van de schoorpaal: aan twee zijden in het schoorvlak, loodrecht op de as");
  ok(schuinBand.kind === "ground" && schuinBand.strips.length === 2 && schuinBand.strips.every((s) => Math.abs(s.normal.z) < 1e-12),
    "band van de staaf onder 30°: horizontaal aan twee zijden");
}

console.log("\n[6] onafhankelijke krachtensom met de grondveren");
{
  // Balk van 6 m met een puntlast P op x = a; de grond geeft een lineaire
  // gronddruk p = c0 + c1·x op zeven knopen, zó gekozen dat de veerkrachten
  // p_i·L_i (de halve stukken ernaast) P dragen en geen moment overlaten.
  const model = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEB 300", material: "S235", bedding: strook }],
    supports: [{ nodeId: 1, ux: true, uy: true, uz: false, rx: true, ry: false, rz: true }],
    memberPointLoads: [{ id: 1, beamId: 1, py: 0, pz: -60, positionM: 2 }],
  });
  const verzoek = buildOpenFem3DSolveRequest(model, "linear", 1);
  const ts = [0, 1, 2, 3, 4, 5, 6].map((i) => i / 6);
  const li = openFem3DBeddingTributaryLengths(ts.map((t) => ({ t })), L);
  const xs = ts.map((t) => t * L);
  // Σ (c0 + c1 x_i) L_i = 60 en Σ (c0 + c1 x_i) L_i x_i = 60·2.
  const s0 = li.reduce((a, l) => a + l, 0), s1 = li.reduce((a, l, i) => a + l * xs[i], 0), s2 = li.reduce((a, l, i) => a + l * xs[i] ** 2, 0);
  const det = s0 * s2 - s1 * s1;
  const c0 = (60 * s2 - 120 * s1) / det, c1 = (120 * s0 - 60 * s1) / det;
  const druk = xs.map((x) => c0 + c1 * x);
  const lid = (drukken) => [{
    memberId: 1, points: ts.map((t, i) => ({ t, settlementM: drukken[i] / 30_000, pressureKnPerM: drukken[i], active: true })),
    maxPressureKnPerM: Math.max(...drukken), minPressureKnPerM: Math.min(...drukken), maxSettlementM: Math.max(...drukken) / 30_000,
    totalReactionKn: drukken.reduce((a, p, i) => a + p * li[i], 0), liftedFraction: 0,
  }];
  const goed = openFem3DGlobalForceBalance(verzoek, { reactions: [], bedding: lid(druk) });
  ok(goed.ok && goed.maxImbalanceKn < 1e-9 && goed.maxMomentImbalanceKnm < 1e-9,
    `de grondveren sluiten kracht- en momentensom (${goed.maxImbalanceKn}, ${goed.maxMomentImbalanceKnm})`);
  const scheef = druk.map((p, i) => i === 3 ? p * 1.01 : p);
  ok(!openFem3DGlobalForceBalance(verzoek, { reactions: [], bedding: lid(scheef) }).ok, "een afwijkende veerkracht valt op");
  ok(!openFem3DGlobalForceBalance(verzoek, { reactions: [] }).ok, "zonder de grondveren sluit het niet (de last gaat in de grond)");
  // Zijdelings: een horizontale puntlast Py = 60 kN in +Y op x = 2; de grond werkt langs n = Z × e_x = +Y
  // (de component langs n): dezelfde lineaire verdeling, met het tegengestelde teken (van de last af).
  const zijModel = parseOpenFem3DModel({
    ...model, beams: [{ ...model.beams[0], bedding: { ...strook, kLateralKnPerM3: 20_000 } }],
    memberPointLoads: [{ id: 1, beamId: 1, py: 60, pz: 0, positionM: 2 }],
  });
  const zijVerzoek = buildOpenFem3DSolveRequest(zijModel, "linear", 1);
  const metZij = lid(druk.map(() => 0)).map((item) => ({
    ...item, points: item.points.map((p, i) => ({ ...p, lateralKnPerM: -druk[i] })),
  }));
  const zijBalans = openFem3DGlobalForceBalance(zijVerzoek, { reactions: [], bedding: metZij });
  ok(zijBalans.ok, `zijdelingse grondkrachten langs n = Z × e_x sluiten de som (${zijBalans.maxImbalanceKn}, ${zijBalans.maxMomentImbalanceKnm})`);
}

console.log("\n[7] bedieningskanaal (model_3d_bouwen)");
{
  const { voerUit } = await import("./src/bediening/bediening.ts");
  const acties = () => ({
    fem: { nodes: [], beams: [], loads: [], loadCases: [], combinations: [], combinationResults: null },
    modelDimension: "3d",
    openFem3d: {
      model: { nodes: [], beams: [] },
      visibility: { nodes: true, beams: true, structuralGrid: true },
      structuralGrid: { enabled: true, xAxes: [], yAxes: [], zAxes: [] },
      replaceModel(model) { this.model = model; },
      setVisibility() {}, setView() {}, setSelection() {},
    },
    setActiveView() {},
  });
  const voer = async (naam, args, a) => {
    try {
      return await voerUit(naam, args, { current: a }, () => new Promise(() => {}), () => Promise.resolve());
    } catch (fout) {
      return { fout: fout instanceof Error ? fout.message : String(fout) };
    }
  };
  const bouw = (balk, paal = {}) => ({
    nodes: [{ x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }, { x: 0, y: 0, z: -8 }],
    beams: [
      { from: 1, to: 2, profile_name: "HEB 300", material: "S235", ...balk },
      { from: 3, to: 1, profile_name: "HEB 300", material: "S235", ...paal },
    ],
    supports: [{ node: 3, type: "fixed" }],
  });
  const a = acties();
  const antwoord = await voer("model_3d_bouwen", bouw(
    { bedding: { k_kn_per_m3: 40_000, width_m: 0.5, compression_only: true } },
    { bedding: { width_m: 0.3, k_lateral_kn_per_m3: 15_000 } },
  ), a);
  ok(!antwoord.fout, `model_3d_bouwen met bedding${antwoord.fout ? `: ${antwoord.fout}` : ""}`);
  ok(JSON.stringify(a.openFem3d.model.beams[0].bedding) === JSON.stringify({ kKnPerM3: 40_000, widthM: 0.5, compressionOnly: true }),
    "de balk staat op bedding, in modelvorm");
  ok(JSON.stringify(a.openFem3d.model.beams[1].bedding) === JSON.stringify({ widthM: 0.3, kLateralKnPerM3: 15_000 }), "de paal zijdelings");
  const tik = await voer("model_3d_bouwen", bouw({ bedding: { k: 40_000, width_m: 0.5 } }), acties());
  ok(tik.fout && /3D-staaf 1: onbekend veld in bedding: k/.test(tik.fout), `een tikfout wordt geweigerd: ${tik.fout}`);
  const verticaal = await voer("model_3d_bouwen", bouw({}, { bedding: { k_kn_per_m3: 40_000, width_m: 0.5 } }), acties());
  ok(verticaal.fout && /verticaal/.test(verticaal.fout), `een paal met verticale k wordt geweigerd: ${verticaal.fout}`);
}

console.log("\n[8] rekenen via de 3D-kern");
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
const EI = 210_000 * 1000 * resolveSection("S235", "HEB 300").I * 1e-12; // kNm²
const balk = (lengte, extra = {}) => parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: lengte, y: 0, z: 0 }, ...(extra.knopen ?? [])],
  beams: extra.staven ?? [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEB 300", material: "S235", bedding: extra.bedding ?? strook }],
  // Alleen X, Y, torsie en draaiing om Z vast: verticaal draagt alleen de grond.
  supports: [{ nodeId: 1, ux: true, uy: true, uz: false, rx: true, ry: false, rz: true }],
  loads: extra.loads ?? [], memberLoads: extra.memberLoads ?? [],
});
const rekenModel = async (model) => {
  const request = { ...buildOpenFem3DSolveRequest(model, "linear", 1), bucklingModes: 0 };
  const result = await reken(request);
  return { request, result };
};
assert.ok(existsSync(solverPath), `Bouw eerst de Rust-rekenkern (${solverPath}) of zet OPEN_FEM_3D_SOLVER_PATH.`);
{
  const proef = await rekenModel(balk(6, { memberLoads: [{ id: 1, beamId: 1, qyStart: 0, qyEnd: 0, qzStart: -30, qzEnd: -30, startPositionM: 0, endPositionM: 6 }] }));
  assert.ok(!/unknown field `bedding`/.test(proef.result.fout ?? ""),
    `de 3D-kern op ${solverPath} kent bedding niet: een oude bouw; bouw open-fem-3d opnieuw (${proef.result.fout?.slice(0, 120)})`);
}
{
  const kb = 50_000 * 0.6; // kN/m²
  {
    // Gelijkmatige last op een vrije balk: overal dezelfde zakking q/(k·b), geen buiging.
    const q = 30;
    const { request, result } = await rekenModel(balk(6, {
      memberLoads: [{ id: 1, beamId: 1, qyStart: 0, qyEnd: 0, qzStart: -q, qzEnd: -q, startPositionM: 0, endPositionM: 6 }],
    }));
    assert.ok(!result.fout, `kern: ${result.fout}`);
    const lid = result.bedding?.find((item) => item.memberId === 1);
    ok(lid && lid.points.length >= 3 && lid.points[0].t === 0 && lid.points.at(-1).t === 1, `bedding in het resultaat, ${lid?.points.length} punten van t = 0 tot 1`);
    for (const p of lid.points) assert.ok(Math.abs(p.settlementM - q / kb) <= 0.01 * q / kb, `zakking op t = ${p.t}: ${p.settlementM}`);
    ok(true, `zakking overal q/(k·b) = ${(q / kb * 1000).toFixed(3)} mm (binnen 1 %)`);
    gelijk(lid.totalReactionKn, q * 6, "som van de veerkrachten = q·L", 1e-6);
    gelijk(lid.maxPressureKnPerM, q, "gronddruk = q", 0.01);
    ok(lid.liftedFraction === 0 && lid.points.every((p) => p.active), "overal contact");
    gelijk(-result.displacements.find((d) => d.nodeId === 2).uz, q / kb, "uz van de eindknoop = −zakking", 0.01);
    const balans = openFem3DGlobalForceBalance(request, result);
    ok(balans.ok, `kracht- en momentensom sluiten met de grondveren (${balans.maxImbalanceKn.toExponential(2)} kN, ${balans.maxMomentImbalanceKnm.toExponential(2)} kNm)`);
  }
  {
    // Puntlast P in het midden van een vrije balk van 10 m (twee staven, de last op de middenknoop):
    // w = Pλ/(2kb) · (cosh λL + cos λL + 2)/(sinh λL + sin λL), λ = (kb/(4EI))^¼ (Hetényi).
    const P = 100, lengte = 10;
    const model = balk(lengte, {
      knopen: [{ id: 3, x: lengte / 2, y: 0, z: 0 }],
      staven: [
        { id: 1, startNodeId: 1, endNodeId: 3, profileName: "HEB 300", material: "S235", bedding: strook },
        { id: 2, startNodeId: 3, endNodeId: 2, profileName: "HEB 300", material: "S235", bedding: strook },
      ],
      loads: [{ id: 1, nodeId: 3, fx: 0, fy: 0, fz: -P, mx: 0, my: 0, mz: 0 }],
    });
    const { request, result } = await rekenModel(model);
    assert.ok(!result.fout, `kern: ${result.fout}`);
    const lambda = (kb / (4 * EI)) ** 0.25, a = lambda * lengte;
    const verwacht = P * lambda / (2 * kb) * (Math.cosh(a) + Math.cos(a) + 2) / (Math.sinh(a) + Math.sin(a));
    gelijk(-result.displacements.find((d) => d.nodeId === 3).uz, verwacht, `zakking onder de last (λL = ${a.toFixed(2)}) tegen Hetényi`, 0.02);
    const som = result.bedding.reduce((s, item) => s + item.totalReactionKn, 0);
    gelijk(som, P, "de grond draagt de hele last", 1e-6);
    ok(openFem3DGlobalForceBalance(request, result).ok, "kracht- en momentensom sluiten");
  }
  {
    // Alleen druk, bijna starre balk (HEB 1000, slappe grond, λL ≈ 0,77) met P op een kwart:
    // star: contact over 3·1,5 = 4,5 m, dus een kwart zonder contact.
    const P = 50, slap = { kKnPerM3: 5_000, widthM: 0.3, compressionOnly: true };
    const model = balk(6, {
      knopen: [{ id: 3, x: 1.5, y: 0, z: 0 }],
      staven: [
        { id: 1, startNodeId: 1, endNodeId: 3, profileName: "HEB 1000", material: "S235", bedding: slap },
        { id: 2, startNodeId: 3, endNodeId: 2, profileName: "HEB 1000", material: "S235", bedding: slap },
      ],
      loads: [{ id: 1, nodeId: 3, fx: 0, fy: 0, fz: -P, mx: 0, my: 0, mz: 0 }],
    });
    const { request, result } = await rekenModel(model);
    assert.ok(!result.fout, `kern: ${result.fout}`);
    const alle = result.bedding.flatMap((item) => item.points);
    ok(alle.every((p) => p.active ? p.pressureKnPerM >= -1e-9 : p.pressureKnPerM === 0), "alleen druk: geen trek, losse punten zonder druk");
    const los = result.bedding.reduce((s, item) => s + item.liftedFraction * (item.memberId === 1 ? 1.5 : 4.5), 0) / 6;
    ok(los > 0.15 && los < 0.35, `ongeveer een kwart zonder contact (${(los * 100).toFixed(1)} %)`);
    ok(result.bedding.find((item) => item.memberId === 2).points.at(-1).active === false, "het verre eind komt los");
    gelijk(result.bedding.reduce((s, item) => s + item.totalReactionKn, 0), P, "de grond draagt de hele last", 1e-6);
    ok(openFem3DGlobalForceBalance(request, result).ok, "kracht- en momentensom sluiten");
  }
  {
    // Paal van 8 m met zijdelingse bedding, H = 10 kN op de kop.
    const model = parseOpenFem3DModel({
      nodes: [{ id: 1, x: 0, y: 0, z: -8 }, { id: 2, x: 0, y: 0, z: 0 }],
      beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEB 300", material: "S235", bedding: { widthM: 0.3, kLateralKnPerM3: 20_000 } }],
      supports: [{ nodeId: 1, ux: false, uy: false, uz: true, rx: false, ry: false, rz: true }],
      loads: [{ id: 1, nodeId: 2, fx: 10, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
    });
    const { request, result } = await rekenModel(model);
    assert.ok(!result.fout, `kern: ${result.fout}`);
    const lid = result.bedding?.find((item) => item.memberId === 1);
    ok(lid && lid.points.some((p) => (p.lateralKnPerM ?? 0) > 0), "de paal: zijdelingse gronddruk in het resultaat");
    ok(openFem3DBeddingPileLateralForces(request, result), "de app herkent zijdelingse grondkrachten op een paal");
  }
  {
    // Schoorpaal 1:3 (|ex·Z| = 0,949, net onder de kolomgrens) met alleen zijdelingse bedding en een
    // horizontale kopkracht in het schoorvlak: de grond werkt rondom, dus geen mechanisme (review #106).
    const model = parseOpenFem3DModel({
      nodes: [{ id: 1, x: 4, y: 0, z: -12 }, { id: 2, x: 0, y: 0, z: 0 }],
      beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEB 300", material: "S235", bedding: { widthM: 0.4, kLateralKnPerM3: 30_000 } }],
      supports: [{ nodeId: 1, ux: false, uy: false, uz: true, rx: false, ry: false, rz: true }],
      loads: [{ id: 1, nodeId: 2, fx: 50, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
    });
    const { request, result } = await rekenModel(model);
    ok(!result.fout, `schoorpaal 1:3: de kern rekent${result.fout ? ` (${result.fout.slice(0, 120)})` : ""}`);
    const kop = result.displacements?.find((d) => d.nodeId === 2);
    ok(kop && kop.ux > 0, `schoorpaal 1:3: de kop wijkt uit naar de kracht (${(kop?.ux * 1000).toFixed(2)} mm)`);
    ok(openFem3DBeddingPileLateralForces(request, result), "schoorpaal 1:3: de app herkent de zijdelingse grondkrachten rondom");
  }
  {
    // Een liggende balk met zijdelingse bedding en een horizontale last in Y op het eind: de
    // zijdelingse grondkrachten (langs n = Z × e_x) sluiten de onafhankelijke som.
    const model = balk(6, {
      bedding: { ...strook, kLateralKnPerM3: 20_000 },
      loads: [{ id: 1, nodeId: 2, fx: 0, fy: 15, fz: -20, mx: 0, my: 0, mz: 0 }],
    });
    const { request, result } = await rekenModel({ ...model, supports: [{ nodeId: 1, ux: true, uy: false, uz: false, rx: true, ry: false, rz: false }] });
    assert.ok(!result.fout, `kern: ${result.fout}`);
    const lid = result.bedding.find((item) => item.memberId === 1);
    ok(lid.points.some((p) => Math.abs(p.lateralKnPerM ?? 0) > 1e-6), "zijdelingse lijnlast langs de balk");
    const balans = openFem3DGlobalForceBalance(request, result);
    ok(balans.ok, `kracht- en momentensom sluiten met de zijdelingse grond (${balans.maxImbalanceKn.toExponential(2)} kN, ${balans.maxMomentImbalanceKnm.toExponential(2)} kNm)`);
  }
  {
    // De kern weigert zelf een verticale k op een verticale staaf (contract), in het Nederlands.
    const { request } = await rekenModel(balk(6, { memberLoads: [{ id: 1, beamId: 1, qyStart: 0, qyEnd: 0, qzStart: -1, qzEnd: -1, startPositionM: 0, endPositionM: 6 }] }));
    const verticaal = {
      ...request,
      nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 6 }],
      memberLoads: [],
      nodalLoads: [{ id: 1, nodeId: 2, fx: 1, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
    };
    const uit = await reken(verticaal);
    ok(typeof uit.fout === "string" && /verticaal/i.test(uit.fout), `de kern weigert een verticale k: ${uit.fout?.slice(0, 120)}`);
  }
}

console.log(`\n${geslaagd} geslaagd, 0 gefaald`);

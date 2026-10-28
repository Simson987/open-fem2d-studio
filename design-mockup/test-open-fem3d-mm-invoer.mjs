// 3D-invoer in mm (issue #36): elke bewerkbare lengte in de 3D-UI wordt in
// millimeters getypt, terwijl het 3D-model, de rekenkern en het projectbestand
// in meters blijven. De omrekening gebeurt alleen aan de UI-grens.
//
// WAAROM DEZE TEST BESTAAT
// De 3D-velden lazen meters. Kopiëren met ΔX = 3000 legde de kopie daardoor
// 3000 m verderop in plaats van 3 m. Een verkeerd eenheidslabel of een
// vergeten omrekening verandert een geldige maat een factor 1000, zonder
// foutmelding; deze test legt de omrekening per veld vast.
//
// Checks:
//  [a] TRANSFORMATIE   — ΔX-tekst "3000" verplaatst en kopieert 3 m in het
//                        model; "3000,5" en "3000.5" geven 3,0005 m; het
//                        spiegelvlak volgt dezelfde regel, de hoek blijft in
//                        graden; ongeldige tekst geeft de melding van het
//                        paneel en verandert niets.
//  [b] KNOOPCOÖRDINAAT — "12000" wordt 12 m; het veld toont opgeslagen 12 m als
//                        "12000"; ongeldige tekst en een staaf zonder lengte
//                        veranderen niets.
//  [c] PLAAT           — dikte "250" wordt 0,25 m; dikte en randstraal staan
//                        in mm in het veld.
//  [d] STAAFBELASTING  — bereik en puntlastpositie van mm naar meters binnen de
//                        staaf; ongewijzigde tekst geeft de opgeslagen meters
//                        exact terug; hint en lijst tonen mm.
//  [e] VERKENNER       — knoopcoördinaten, plaatdikte en lastposities in hele mm.
//  [f] LABELS          — de invoerlabels dragen "(mm)" in nl/en/de/fr; de oude
//                        sleutels en "(m)" zijn weg uit de 3D-teksten.
//
// De invoervelden van knoop en plaat zijn LengthInput met storedUnit "m": die
// leest de tekst met parseLength(tekst, "m") en toont de opgeslagen waarde met
// formatLength(waarde, "m"). [b] en [c] bewijzen beide richtingen: de
// gerenderde veldwaarde (opgeslagen → mm) en het model na parseLength (mm →
// opgeslagen). Het typen zelf in een echte browser staat in test-mm-invoer-ui.
//
// Uitvoeren: npx tsx test-open-fem3d-mm-invoer.mjs   (vanuit design-mockup/)
//        of: node scripts/run-tests.mjs --filter=open-fem3d-mm

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

// De componenten importeren stylesheets; Node kent die niet. Een lege module
// volstaat: hier worden tekst en veldwaarden gelezen, geen opmaak.
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function load(url, ctx, next) {" +
        " if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };" +
        " return next(url, ctx); }",
    ),
);
const i18next = (await import("./scripts/i18n-voor-tests.mjs")).default;
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const { formatLength, parseLength } = await import("./src/lib/lengthInput.ts");
const { transformOpenFem3D } = await import("./src/components/openFem3d/openFem3dTransform.ts");
const { addOpenFem3DMemberLoad, addOpenFem3DMemberPointLoad, parseOpenFem3DModel, updateOpenFem3DPlate } =
  await import("./src/components/openFem3d/openFem3dModel.ts");
const { default: OpenFem3DTransformPanel, openFem3DTransformCommand } =
  await import("./src/components/openFem3d/OpenFem3DTransformPanel.tsx");
const { default: OpenFem3DProperties, openFem3DModelWithNodeCoordinate } =
  await import("./src/components/openFem3d/OpenFem3DProperties.tsx");
const { default: OpenFem3DMemberLoads, openFem3DMemberLoadFromText, openFem3DMemberPointLoadFromText } =
  await import("./src/components/openFem3d/OpenFem3DMemberLoads.tsx");
const { default: OpenFem3DExplorer } = await import("./src/components/openFem3d/OpenFem3DExplorer.tsx");

let geslaagd = 0;
let gefaald = 0;
function check(naam, proef) {
  try {
    proef();
    geslaagd += 1;
    console.log(`  ✓ ${naam}`);
  } catch (fout) {
    gefaald += 1;
    console.log(`  ✗ ${naam}\n      ${String(fout?.message ?? fout).split("\n").join("\n      ")}`);
  }
}

const t = i18next.getFixedT("nl", "ribbon");
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const tekst = (html) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
/** De waarde van het invoerveld in de eigenschappenrij met dit label. */
function veld(html, label) {
  const rij = html.split('<div class="fem-prop-row">')
    .find((deel) => deel.startsWith(`<span class="fem-prop-label">${label}</span>`));
  return rij ? /<input[^>]*\svalue="([^"]*)"/.exec(rij)?.[1] : undefined;
}
const velden = (anders) => ({ dx: "0", dy: "0", dz: "0", axis: "z", angle: "90", offset: "0", ...anders });

/* ── [a] Transformatie ───────────────────────────────────────────────── */
console.log("\n[a] Verplaatsen, kopiëren en spiegelen in mm");
// Portaal in het XZ-vlak: kolommen van 3 m, ligger van 6 m.
const portaal = parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 3 },
    { id: 3, x: 6, y: 0, z: 3 }, { id: 4, x: 6, y: 0, z: 0 },
  ],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2 },
    { id: 2, startNodeId: 2, endNodeId: 3 },
    { id: 3, startNodeId: 3, endNodeId: 4 },
  ],
});
const heelPortaal = { type: "multi", nodeIds: [], beamIds: [1, 2, 3] };
/** Wat "Toepassen" doet: paneel → bewerking → model; bij een fout blijft het model staan. */
function toepassen(model, tool, invoer) {
  try {
    return { model: transformOpenFem3D(model, heelPortaal, openFem3DTransformCommand(tool, invoer, t)).model, melding: null };
  } catch (fout) {
    return { model, melding: fout.message };
  }
}

check("kopiëren met ΔX = 3000 legt het portaal 3 m verderop, niet 3000 m", () => {
  assert.deepEqual(openFem3DTransformCommand("copy", velden({ dx: "3000" }), t), { kind: "copy", dx: 3, dy: 0, dz: 0 });
  const { model, melding } = toepassen(portaal, "copy", velden({ dx: "3000" }));
  assert.equal(melding, null);
  assert.deepEqual(model.nodes.slice(4).map((knoop) => [knoop.x, knoop.y, knoop.z]),
    [[3, 0, 0], [3, 0, 3], [9, 0, 3], [9, 0, 0]]);
  assert.deepEqual(model.nodes.slice(0, 4), portaal.nodes, "het origineel blijft staan");
});

check("verplaatsen: 3000 → 3 m; 3000,5 en 3000.5 → 3,0005 m; -1500 → -1,5 m", () => {
  for (const [invoer, meters] of [["3000", 3], ["3000,5", 3.0005], ["3000.5", 3.0005], ["-1500", -1.5], [" 250 ", 0.25]]) {
    const { model, melding } = toepassen(portaal, "move", velden({ dx: invoer }));
    assert.equal(melding, null, invoer);
    assert.equal(model.nodes[0].x, meters, `knoop 1 bij ΔX = ${JSON.stringify(invoer)}`);
    assert.equal(model.nodes[2].x, 6 + meters, `knoop 3 bij ΔX = ${JSON.stringify(invoer)}`);
  }
});

check("ΔY en ΔZ volgen dezelfde regel: 2500,5 → 2,5005 m en -250 → -0,25 m", () => {
  assert.deepEqual(openFem3DTransformCommand("move", velden({ dy: "2500,5", dz: "-250" }), t),
    { kind: "move", dx: 0, dy: 2.5005, dz: -0.25 });
});

check("ongeldige tekst (abc, 12mm, 1,2.3, leeg) geeft de melding en verandert niets", () => {
  for (const ongeldig of ["abc", "12mm", "1,2.3", ""]) {
    for (const [naam, symbool] of [["dx", "ΔX"], ["dy", "ΔY"], ["dz", "ΔZ"]]) {
      const { model, melding } = toepassen(portaal, "copy", velden({ [naam]: ongeldig }));
      assert.equal(melding, `${symbool} is geen geldig getal.`, `${naam} = ${JSON.stringify(ongeldig)}`);
      assert.strictEqual(model, portaal, `${naam} = ${JSON.stringify(ongeldig)} laat het model ongemoeid`);
    }
  }
});

check("spiegelvlak 1500 spiegelt om x = 1,5 m; 12mm geeft de melding; de hoek blijft in graden", () => {
  const spiegel = openFem3DTransformCommand("mirror", velden({ axis: "x", offset: "1500" }), t);
  assert.deepEqual(spiegel, { kind: "mirror", axis: "x", offset: 1.5 });
  assert.deepEqual(transformOpenFem3D(portaal, heelPortaal, spiegel).model.nodes.map((knoop) => knoop.x), [3, 3, -3, -3]);
  const fout = toepassen(portaal, "mirror", velden({ offset: "12mm" }));
  assert.equal(fout.melding, "Vlakcoördinaat is geen geldig getal.");
  assert.strictEqual(fout.model, portaal);
  assert.deepEqual(openFem3DTransformCommand("rotate", velden({ axis: "y", angle: "90" }), t),
    { kind: "rotate", axis: "y", angleDeg: 90 }, "90 blijft 90°, geen omrekening");
});

check("het paneel noemt mm bij ΔX/ΔY/ΔZ en bij het spiegelvlak", () => {
  const kopieer = tekst(render(OpenFem3DTransformPanel, { tool: "copy", selectionLabel: "Portaal", onApply() {}, onCancel() {} }));
  for (const label of ["ΔX (mm)", "ΔY (mm)", "ΔZ (mm)"]) assert.ok(kopieer.includes(label), label);
  const spiegel = tekst(render(OpenFem3DTransformPanel, { tool: "mirror", selectionLabel: "Portaal", onApply() {}, onCancel() {} }));
  assert.ok(spiegel.includes("Spiegelvlak op (mm)"), spiegel);
  assert.ok(!/\(m\)/.test(kopieer + spiegel), "geen (m) meer in het paneel");
});

/* ── [b] Knoopcoördinaat ─────────────────────────────────────────────── */
console.log("\n[b] Knoopcoördinaten in mm");
const staaf = parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 5 }, { id: 2, x: 6, y: 0, z: 5 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }],
});

check("\"12000\" in het X-veld zet knoop 1 op x = 12 m; \"12000,5\" op 12,0005 m", () => {
  const na = openFem3DModelWithNodeCoordinate(staaf, 1, "x", parseLength("12000", "m"));
  assert.deepEqual(na.nodes[0], { id: 1, x: 12, y: 0, z: 5 });
  assert.deepEqual(na.nodes[1], staaf.nodes[1], "de andere knoop blijft staan");
  assert.equal(openFem3DModelWithNodeCoordinate(staaf, 1, "y", parseLength("12000,5", "m")).nodes[0].y, 12.0005);
});

check("het veld toont de opgeslagen meters in mm: X 12000, Y 0, Z 5000, label (mm)", () => {
  const model = openFem3DModelWithNodeCoordinate(staaf, 1, "x", 12);
  const html = render(OpenFem3DProperties, { model, selection: { type: "node", id: 1 }, onChange() {}, result: null });
  assert.equal(veld(html, "X (mm)"), "12000");
  assert.equal(veld(html, "Y (mm)"), "0");
  assert.equal(veld(html, "Z (mm)"), "5000");
  assert.ok(!html.includes("(m)"), "geen (m)-label meer bij de knoop");
});

check("ongeldige tekst en een staaf zonder lengte veranderen niets", () => {
  for (const ongeldig of ["abc", "12mm"]) {
    assert.ok(Number.isNaN(parseLength(ongeldig, "m")), `LengthInput schrijft ${ongeldig} niet door`);
    assert.equal(openFem3DModelWithNodeCoordinate(staaf, 1, "x", parseLength(ongeldig, "m")), null);
  }
  // Knoop 1 op x = 6000 mm valt samen met knoop 2: de staaf zou geen lengte hebben.
  assert.equal(openFem3DModelWithNodeCoordinate(staaf, 1, "x", parseLength("6000", "m")), null);
});

/* ── [c] Plaat ───────────────────────────────────────────────────────── */
console.log("\n[c] Plaatdikte en randstraal in mm");
const vloer = parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 },
    { id: 3, x: 4, y: 3, z: 0 }, { id: 4, x: 0, y: 3, z: 0 },
  ],
  beams: [],
  plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2, cornerRadiusM: 0.1 }],
});

check("dikte \"250\" wordt 0,25 m in het model; \"250,5\" wordt 0,2505 m", () => {
  assert.equal(updateOpenFem3DPlate(vloer, 1, { thicknessM: parseLength("250", "m") }).plates[0].thicknessM, 0.25);
  assert.equal(updateOpenFem3DPlate(vloer, 1, { thicknessM: parseLength("250,5", "m") }).plates[0].thicknessM, 0.2505);
  for (const ongeldig of ["abc", "12mm"]) assert.ok(Number.isNaN(parseLength(ongeldig, "m")), ongeldig);
});

check("dikte en randstraal staan in mm in het veld, met (mm) in het label", () => {
  const html = render(OpenFem3DProperties, { model: vloer, selection: { type: "plate", id: 1 }, onChange() {}, result: null });
  assert.equal(veld(html, "Dikte (mm)"), "200");
  assert.equal(veld(html, "Randstraal (mm)"), "100");
  const dikker = updateOpenFem3DPlate(vloer, 1, { thicknessM: parseLength("250", "m") });
  assert.equal(veld(render(OpenFem3DProperties, { model: dikker, selection: { type: "plate", id: 1 }, onChange() {}, result: null }),
    "Dikte (mm)"), "250");
});

/* ── [d] Staafbelasting ──────────────────────────────────────────────── */
console.log("\n[d] Lastbereik en puntlastpositie in mm");
const ligger = parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 200", material: "S235" }],
});
const q = { qyStart: "0", qyEnd: "0", qzStart: "-5", qzEnd: "-5" };

check("lijnlast 1500 tot 4500,5 mm wordt 1,5 tot 4,5005 m in het model", () => {
  const last = openFem3DMemberLoadFromText({ ...q, startMm: "1500", endMm: "4500,5" }, 6);
  assert.deepEqual(last, { qyStart: 0, qyEnd: 0, qzStart: -5, qzEnd: -5, startPositionM: 1.5, endPositionM: 4.5005 });
  const opgeslagen = addOpenFem3DMemberLoad(ligger, 1, last).memberLoads[0];
  assert.equal(opgeslagen.startPositionM, 1.5);
  assert.equal(opgeslagen.endPositionM, 4.5005);
  const vol = openFem3DMemberLoadFromText({ ...q, startMm: "0", endMm: "6000" }, 6);
  assert.equal(vol.startPositionM, 0);
  assert.equal(vol.endPositionM, 6, "6000 mm is de volle staaf van 6 m");
});

check("ongewijzigde tekst geeft de opgeslagen meters exact terug (staaf van √50 m)", () => {
  // Voorwaarde die de regel nodig maakt: 7071.067811865475 mm terugdelen door
  // 1000 geeft niet bit voor bit de staaflengte 7,0710678118654755 m.
  const lengte = Math.hypot(3, 4, 5);
  assert.notStrictEqual(parseLength(formatLength(lengte, "m"), "m"), lengte);
  const vol = openFem3DMemberLoadFromText({ ...q, startMm: "0", endMm: formatLength(lengte, "m") }, lengte);
  assert.strictEqual(vol.endPositionM, lengte);
  const bewerkt = { startPositionM: lengte / 3, endPositionM: lengte };
  const opnieuw = openFem3DMemberLoadFromText(
    { ...q, startMm: formatLength(bewerkt.startPositionM, "m"), endMm: formatLength(bewerkt.endPositionM, "m") }, lengte, bewerkt);
  assert.strictEqual(opnieuw.startPositionM, bewerkt.startPositionM);
  assert.strictEqual(opnieuw.endPositionM, bewerkt.endPositionM);
  const punt = openFem3DMemberPointLoadFromText({ py: "0", pz: "-10", positionMm: formatLength(lengte / 2, "m") }, lengte);
  assert.strictEqual(punt.positionM, lengte / 2);
  const eindpunt = openFem3DMemberPointLoadFromText({ py: "0", pz: "-10", positionMm: formatLength(lengte, "m") }, lengte, lengte);
  assert.strictEqual(eindpunt.positionM, lengte, "een bewerkte puntlast op het staafeinde blijft exact op het einde");
});

check("ongeldig lastbereik (abc, 12mm, voorbij de staaf, omgekeerd, negatief) verandert niets", () => {
  for (const [startMm, endMm] of [["0", "abc"], ["12mm", "6000"], ["0", "6001"], ["4500", "1500"], ["-1", "3000"], ["3000", "3000"]]) {
    assert.equal(openFem3DMemberLoadFromText({ ...q, startMm, endMm }, 6), null, `${startMm}–${endMm}`);
  }
});

check("puntlast op 2500 mm staat op 2,5 m; 3000,5 → 3,0005 m; buiten de staaf of ongeldig → niets", () => {
  const punt = openFem3DMemberPointLoadFromText({ py: "0", pz: "-10", positionMm: "2500" }, 6);
  assert.deepEqual(punt, { py: 0, pz: -10, positionM: 2.5 });
  assert.equal(addOpenFem3DMemberPointLoad(ligger, 1, punt).memberPointLoads[0].positionM, 2.5);
  assert.equal(openFem3DMemberPointLoadFromText({ py: "0", pz: "-10", positionMm: "3000,5" }, 6).positionM, 3.0005);
  for (const ongeldig of ["6001", "-1", "abc", "12mm"]) {
    assert.equal(openFem3DMemberPointLoadFromText({ py: "0", pz: "-10", positionMm: ongeldig }, 6), null, ongeldig);
  }
});

check("de hint en de lastenlijst tonen de staaflengte en het bereik in mm", () => {
  const belast = addOpenFem3DMemberLoad(ligger, 1, { qyStart: 0, qyEnd: 0, qzStart: -5, qzEnd: -5, startPositionM: 1.5, endPositionM: 4.5 });
  const lijst = tekst(render(OpenFem3DMemberLoads, { model: belast, beamId: 1, lengthM: 6, onChange() {} }));
  assert.ok(lijst.includes("staaflengte 6000 mm"), lijst);
  assert.ok(lijst.includes("1500–4500 mm"), lijst);
  assert.ok(!lijst.includes("1.5–4.5 m"), "geen meters meer in de lijst");
});

/* ── [e] Verkenner ───────────────────────────────────────────────────── */
console.log("\n[e] Verkenner in hele mm");
check("knoop X:12000 Y:0 Z:5000, plaat 250 mm, lijnlast 1500–4500 mm, puntlast x 2500 mm", () => {
  const model = parseOpenFem3DModel({
    nodes: [
      { id: 1, x: 12, y: 0, z: 5 }, { id: 2, x: 18, y: 0, z: 5 },
      { id: 3, x: 18, y: 4, z: 5 }, { id: 4, x: 12, y: 4, z: 5 },
    ],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }],
    plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.25 }],
    memberLoads: [{ id: 1, beamId: 1, qyStart: 0, qyEnd: 0, qzStart: -5, qzEnd: -5, startPositionM: 1.5, endPositionM: 4.5 }],
    memberPointLoads: [{ id: 1, beamId: 1, py: 0, pz: -10, positionM: 2.5 }],
  });
  const noop = () => {};
  const boom = tekst(render(OpenFem3DExplorer, {
    model, selection: null, setSelection: noop, result: null,
    visibility: {}, setVisibility: noop, displayFlags: {}, setDisplayFlags: noop,
    gridShow: true, setGridShow: noop, structuralGrid: { enabled: false, xAxes: [], zAxes: [] }, setStructuralGridEnabled: noop,
  }));
  for (const waarde of ["X:12000 Y:0 Z:5000", "X:18000 Y:4000 Z:5000", "250 mm", "1500–4500 mm", "x 2500 mm"]) {
    assert.ok(boom.includes(waarde), `${waarde} ontbreekt in: ${boom}`);
  }
  for (const oud of ["X:12 ", "0.25 m", "1.5–4.5 m", "x 2.5 m"]) assert.ok(!boom.includes(oud), `nog in meters: ${oud}`);
});

/* ── [f] Labels ──────────────────────────────────────────────────────── */
console.log("\n[f] Invoerlabels in vier talen");
check("de 3D-invoerlabels dragen (mm) in nl/en/de/fr; oude sleutels en (m) zijn weg", () => {
  for (const taal of ["nl", "en", "de", "fr"]) {
    const { openFem3d } = JSON.parse(readFileSync(new URL(`./src/i18n/locales/${taal}/ribbon.json`, import.meta.url), "utf8"));
    for (const [pad, label] of Object.entries({
      "props.thicknessMm": openFem3d.props.thicknessMm,
      "props.cornerRadiusMm": openFem3d.props.cornerRadiusMm,
      "memberLoads.range": openFem3d.memberLoads.range,
      "memberLoads.positionMm": openFem3d.memberLoads.positionMm,
      "transform.mirrorPlane": openFem3d.transform.mirrorPlane,
    })) assert.match(label ?? "", /\(mm\)$/, `${taal}:openFem3d.${pad}`);
    assert.match(openFem3d.memberLoads.lineHint, /\{\{length\}\} mm$/, `${taal}:openFem3d.memberLoads.lineHint`);
    for (const oud of ["thicknessM", "cornerRadiusM"]) assert.equal(openFem3d.props[oud], undefined, `${taal}: ${oud}`);
    assert.equal(openFem3d.memberLoads.positionM, undefined, `${taal}: memberLoads.positionM`);
    assert.ok(!JSON.stringify(openFem3d).includes("(m)"), `${taal}: nog een (m)-label in openFem3d`);
  }
});

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald === 0 ? 0 : 1);

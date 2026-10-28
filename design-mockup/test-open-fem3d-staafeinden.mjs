// Scharnieren aan staafeinden in 3D (issue #93): het gereedschap "Scharnier
// aan staafeind", de opdracht "Liggers scharnierend op kolommen" en de kleine
// bol die een scharnier op de staaf laat zien. De knoppen, het tekenvlak en de
// API-commando's model3d.beam.setEndHinge en model3d.beam.pinToColumns roepen
// dezelfde zuivere functies aan.
//   [1] één staafeind los of vast: My en Mz samen, torsie blijft zoals hij is;
//   [2] kolom of ligger: |ex·Z| > 0,95 is een kolom;
//   [3] liggers scharnierend op kolommen: portaal, ligger aan één kolom en één
//       ligger, schuine spant, doorgaande kolom, selectie of alles;
//   [4] alleen op een kolomkop, en geen mechanisme: een kolom op een ligger,
//       een balkrooster onder een kolomvoet of poer, een hangstaaf, een
//       uitkraging (ook in stukken), een luifel aan twee kolommen, een ligger
//       in stukken tussen twee kolommen, een model zonder opleggingen;
//   [5] waar de bolletjes komen: op de staafas, net vóór de knoopbol, kleiner
//       dan de knoopbol (ook met de rand), dikker dan de staaf, met de
//       markeringsmaat mee; op een korte staaf kleiner of één in het midden;
//       de diepteverschuiving in de profielweergave;
//   [6] de lintknop: welke staven (selectie of alles), welke melding, en de
//       staven in beeld bij het gereedschap;
//   [7] rekenproef met de 3D-kern: de staalhal met balkrooster, een
//       uitkraging en een kolom op een ligger rekenen na de opdracht nog.
import * as THREE from "three";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const {
  parseOpenFem3DModel, setOpenFem3DBeamEndHinge, openFem3DBeamIsColumn, openFem3DBeamEndHinged,
  pinOpenFem3DBeamsToColumns, OPEN_FEM_3D_COLUMN_COSINE, openFem3DPinToColumnsScope, openFem3DPinToColumnsMessage,
} = await import("./src/components/openFem3d/openFem3dModel.ts");
const {
  openFem3DBeamHingePlacements, OPEN_FEM_3D_HINGE_RIM_SCALE,
} = await import("./src/components/openFem3d/openFem3dMarkers.ts");
const { openFem3DVisibilityForTool, DEFAULT_OPEN_FEM_3D_VISIBILITY } = await import("./src/components/openFem3d/openFem3dVisibility.ts");
const { maakStaalhal, STAALHAL_GEVAL } = await import("./src/components/openFem3d/wizards/staalhal.ts");
const { buildOpenFem3DSolveRequest } = await import("./src/components/openFem3d/openFem3dSolver.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const fout = (fn) => { try { fn(); return null; } catch (e) { return e; } };
const VAST = { myStart: false, myEnd: false, mzStart: false, mzEnd: false, torsionStart: false, torsionEnd: false };
const INKLEMMING = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };
const SCHARNIER = { ux: true, uy: true, uz: true, rx: false, ry: false, rz: false };
const tekst = (r) => r === undefined ? "geen" : Object.entries(r).filter(([, v]) => v).map(([k]) => k).join(",") || "alles vast";
const einden = (lijst) => lijst.map((c) => `${c.beamId}${c.end === "start" ? "b" : "e"}${c.reason ? `:${c.reason}` : ""}`).join(" ");
const staaf = (id, a, b, extra = {}) => ({ id, startNodeId: a, endNodeId: b, ...extra });

console.log("[1] één staafeind los of vast");
{
  const model = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 12, y: 0, z: 0 }],
    beams: [
      { id: 1, startNodeId: 1, endNodeId: 2 },
      { id: 2, startNodeId: 2, endNodeId: 3, releases: { ...VAST, myStart: true, torsionStart: true } },
    ],
  });
  const voor = JSON.stringify(model);
  const los = setOpenFem3DBeamEndHinge(model, 1, "start");
  const r1 = los.model.beams[0].releases;
  check("klik bij het begin: My en Mz aan het begin los", los.hinged === true && r1.myStart && r1.mzStart, tekst(r1));
  check("… het eind en de torsie blijven vast", !r1.myEnd && !r1.mzEnd && !r1.torsionStart && !r1.torsionEnd, tekst(r1));
  const weer = setOpenFem3DBeamEndHinge(los.model, 1, "start");
  check("nog een klik: weer vast, en zonder scharnieren geen veld meer (zoals Momentvast)",
    weer.hinged === false && !("releases" in weer.model.beams[0]), tekst(weer.model.beams[0].releases));
  const eind = setOpenFem3DBeamEndHinge(model, 1, "end").model.beams[0].releases;
  check("het eind los: alleen myEnd en mzEnd", tekst(eind) === "myEnd,mzEnd", tekst(eind));
  // Staaf 2: aan het begin alleen My los (en torsie). Niet "al los": de klik maakt My en Mz los.
  const half = setOpenFem3DBeamEndHinge(model, 2, "start");
  check("half los (alleen My): de klik zet My én Mz los", half.hinged && tekst(half.model.beams[1].releases) === "myStart,mzStart,torsionStart",
    tekst(half.model.beams[1].releases));
  const terug = setOpenFem3DBeamEndHinge(half.model, 2, "start");
  check("… de volgende klik zet ze vast; de losse torsie blijft los",
    !terug.hinged && tekst(terug.model.beams[1].releases) === "torsionStart", tekst(terug.model.beams[1].releases));
  check("expliciet los (hinged: true) op een los eind verandert niets",
    setOpenFem3DBeamEndHinge(los.model, 1, "start", true).model === los.model);
  check("expliciet vast (hinged: false) op een vast eind verandert niets",
    setOpenFem3DBeamEndHinge(model, 1, "end", false).model === model);
  check("het oorspronkelijke model is niet veranderd", JSON.stringify(model) === voor);
  check("een onbekende staaf wordt geweigerd", fout(() => setOpenFem3DBeamEndHinge(model, 9, "start"))?.message.includes("9"));
  check("scharnier zichtbaar bij een los My, Mz of T aan dat eind",
    openFem3DBeamEndHinged(los.model.beams[0], "start") && !openFem3DBeamEndHinged(los.model.beams[0], "end")
      && openFem3DBeamEndHinged({ ...model.beams[0], releases: { ...VAST, torsionEnd: true } }, "end")
      && !openFem3DBeamEndHinged(model.beams[0], "start"));
}

console.log("\n[2] kolom of ligger");
{
  const knopen = new Map([
    [1, { id: 1, x: 0, y: 0, z: 0 }], [2, { id: 2, x: 0, y: 0, z: 4 }],
    [3, { id: 3, x: 0.2, y: 0, z: 4 }], [4, { id: 4, x: 6, y: 0, z: 5.6 }], [5, { id: 5, x: 1.5, y: 0, z: 4 }],
  ]);
  const s = (a, b) => ({ id: 1, startNodeId: a, endNodeId: b });
  check("drempel 0,95", OPEN_FEM_3D_COLUMN_COSINE === 0.95);
  check("een verticale staaf is een kolom (ook van boven naar beneden)",
    openFem3DBeamIsColumn(s(1, 2), knopen) && openFem3DBeamIsColumn(s(2, 1), knopen));
  // (0,2; 4) vanaf (0; 0): cos = 4/√16,04 ≈ 0,9988 — bijna verticaal.
  check("een bijna verticale staaf (scheef 0,2 m op 4 m) is een kolom", openFem3DBeamIsColumn(s(1, 3), knopen));
  // (1,5; 4): cos = 4/√18,25 ≈ 0,936 — net geen kolom.
  check("een steile schoor (cos 0,94) is geen kolom", !openFem3DBeamIsColumn(s(1, 5), knopen));
  check("een schuine spant (15°) is een ligger", !openFem3DBeamIsColumn(s(2, 4), knopen));
}

console.log("\n[3] liggers scharnierend op kolommen");
{
  // Portaal met een tweede veld: kolommen 1 (1→2) en 2 (3→4), ligger 3 (2→4)
  // tussen de kolomkoppen, ligger 4 (4→5) van kolomkop 4 naar knoop 5 waar
  // alleen ligger 5 (5→6) aansluit; die ligt in 6 scharnierend op. Een
  // schuine spant 6 (4→7) naar de kop van kolom 7 (8→7), en een kolom 8
  // (2→9) die boven knoop 2 doorloopt. Inklemmingen in 1, 3 en 8.
  const portaal = parseOpenFem3DModel({
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 4 }, { id: 3, x: 6, y: 0, z: 0 }, { id: 4, x: 6, y: 0, z: 4 },
      { id: 5, x: 12, y: 0, z: 4 }, { id: 6, x: 18, y: 0, z: 4 }, { id: 7, x: 6, y: 6, z: 5.6 }, { id: 8, x: 6, y: 6, z: 0 },
      { id: 9, x: 0, y: 0, z: 7 },
    ],
    beams: [
      staaf(1, 1, 2), staaf(2, 3, 4), staaf(3, 2, 4), staaf(4, 4, 5), staaf(5, 5, 6), staaf(6, 4, 7), staaf(7, 8, 7),
      staaf(8, 2, 9, { releases: { ...VAST, torsionEnd: true } }),
    ],
    supports: [{ nodeId: 1, ...INKLEMMING }, { nodeId: 3, ...INKLEMMING }, { nodeId: 8, ...INKLEMMING }, { nodeId: 6, ...SCHARNIER }],
  });
  const voor = JSON.stringify(portaal);
  const uit = pinOpenFem3DBeamsToColumns(portaal);
  const r = (id) => uit.model.beams.find((b) => b.id === id).releases;
  check("ligger tussen twee kolommen: beide einden My en Mz los",
    tekst(r(3)) === "myStart,myEnd,mzStart,mzEnd", tekst(r(3)));
  check("ligger aan één kolom en één ligger: alleen het eind bij de kolom",
    tekst(r(4)) === "myStart,mzStart", tekst(r(4)));
  check("ligger zonder kolom (5) blijft momentvast", r(5) === undefined, tekst(r(5)));
  check("schuine spant tussen twee kolommen telt als ligger: beide einden",
    tekst(r(6)) === "myStart,myEnd,mzStart,mzEnd", tekst(r(6)));
  check("kolommen blijven doorgaand (geen scharnieren, of zoals ze waren)",
    r(1) === undefined && r(2) === undefined && r(7) === undefined && tekst(r(8)) === "torsionEnd", `${tekst(r(1))} ${tekst(r(8))}`);
  check("de opdracht meldt welke staafeinden veranderden (vijf), niets overgeslagen",
    einden(uit.changed) === "3b 3e 4b 6b 6e" && uit.skipped.length === 0, `${einden(uit.changed)} | ${einden(uit.skipped)}`);
  check("torsie blijft overal zoals hij was", uit.model.beams.every((b) => !b.releases || !b.releases.torsionStart));
  check("het oorspronkelijke model is niet veranderd", JSON.stringify(portaal) === voor);
  const nogEens = pinOpenFem3DBeamsToColumns(uit.model);
  check("nog eens: niets meer te doen, hetzelfde model (geen lege stap ongedaan maken)",
    nogEens.changed.length === 0 && nogEens.model === uit.model);

  const selectie = pinOpenFem3DBeamsToColumns(portaal, [4, 1, 5]);
  const s = (id) => selectie.model.beams.find((b) => b.id === id).releases;
  check("alleen de geselecteerde staven: ligger 4 aan de kolom, de kolom en ligger 5 niet",
    tekst(s(4)) === "myStart,mzStart" && s(1) === undefined && s(5) === undefined && s(3) === undefined && s(6) === undefined,
    `${tekst(s(4))} | 3: ${tekst(s(3))}`);
  check("… en meldt alleen dat eind", einden(selectie.changed) === "4b", einden(selectie.changed));
  const half = parseOpenFem3DModel({ ...portaal, beams: portaal.beams.map((b) => b.id === 3
    ? { ...b, releases: { ...VAST, myStart: true } } : b) });
  const aangevuld = pinOpenFem3DBeamsToColumns(half, [3]);
  check("een half los eind (alleen My) krijgt ook Mz los en telt mee",
    tekst(aangevuld.model.beams[2].releases) === "myStart,myEnd,mzStart,mzEnd" && aangevuld.changed.length === 2);
  check("een onbekende staaf wordt geweigerd", fout(() => pinOpenFem3DBeamsToColumns(portaal, [99]))?.message.includes("99"));
}

console.log("\n[4] alleen op een kolomkop, en geen mechanisme");
{
  // Het portaal van 6 × 4 m met inklemmingen; de proeven voegen er telkens iets aan toe.
  const basis = {
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 4 }, { id: 3, x: 6, y: 0, z: 0 }, { id: 4, x: 6, y: 0, z: 4 }],
    beams: [staaf(1, 1, 2), staaf(2, 3, 4), staaf(3, 2, 4)],
    supports: [{ nodeId: 1, ...INKLEMMING }, { nodeId: 3, ...INKLEMMING }],
  };
  const met = (extra) => parseOpenFem3DModel({
    nodes: [...basis.nodes, ...(extra.nodes ?? [])],
    beams: [...(extra.beams0 ?? basis.beams), ...(extra.beams ?? [])],
    supports: [...basis.supports, ...(extra.supports ?? [])],
  });
  const losVan = (uit, id) => tekst(uit.model.beams.find((b) => b.id === id).releases);

  // Een kolom 5 (6→7) staat midden op een doorgaande ligger 2→6→4 (staven 3 en 4).
  const kolomOpLigger = pinOpenFem3DBeamsToColumns(met({
    nodes: [{ id: 6, x: 3, y: 0, z: 4 }, { id: 7, x: 3, y: 0, z: 7 }],
    beams0: [staaf(1, 1, 2), staaf(2, 3, 4), staaf(3, 2, 6), staaf(4, 6, 4), staaf(5, 6, 7)],
  }));
  check("kolom op een doorgaande ligger: de ligger blijft momentvast onder de kolom",
    losVan(kolomOpLigger, 3) === "myStart,mzStart" && losVan(kolomOpLigger, 4) === "myEnd,mzEnd",
    `3: ${losVan(kolomOpLigger, 3)}, 4: ${losVan(kolomOpLigger, 4)}`);
  check("… alleen de einden op de kolomkoppen 2 en 4, de kolom erop blijft doorgaand",
    einden(kolomOpLigger.changed) === "3b 4e" && losVan(kolomOpLigger, 5) === "geen", einden(kolomOpLigger.changed));

  // Een poer (1→10) onder kolomvoet 1, met een funderingsbalk 11 (10→11) op
  // een veer: alleen het bovenste eind van poer en kolom telt.
  const poer = pinOpenFem3DBeamsToColumns(parseOpenFem3DModel({
    nodes: [...basis.nodes, { id: 10, x: 0, y: 0, z: -0.8 }, { id: 11, x: 6, y: 0, z: -0.8 }, { id: 12, x: 6, y: 0, z: 0 }],
    beams: [staaf(1, 10, 1), staaf(2, 1, 2), staaf(3, 2, 4), staaf(4, 12, 4), staaf(5, 11, 12), staaf(6, 10, 11)],
    supports: [10, 11].map((nodeId) => ({ nodeId, ux: true, uy: true, uz: false, rx: false, ry: false, rz: false,
      springs: { kzKnPerM: 50000 } })),
  }));
  check("balkrooster onder poer en kolomvoet: de funderingsbalk blijft doorgaand, alleen de ligger tussen de koppen",
    einden(poer.changed) === "3b 3e" && losVan(poer, 6) === "geen", einden(poer.changed));

  // Een hangstaaf 5 (6→7) onder een doorgaande ligger 2→6→4: geen kolomkop.
  const hang = pinOpenFem3DBeamsToColumns(met({
    nodes: [{ id: 6, x: 3, y: 0, z: 4 }, { id: 7, x: 3, y: 0, z: 2 }],
    beams0: [staaf(1, 1, 2), staaf(2, 3, 4), staaf(3, 2, 6), staaf(4, 6, 4), staaf(5, 7, 6)],
  }));
  check("hangstaaf onder een ligger: de ligger blijft doorgaand boven de hangstaaf",
    einden(hang.changed) === "3b 4e", einden(hang.changed));

  // Uitkraging 4 (4→5) aan kolomkop 4, met het andere eind vrij.
  const uitkraging = pinOpenFem3DBeamsToColumns(met({ nodes: [{ id: 5, x: 9, y: 0, z: 4 }], beams: [staaf(4, 4, 5)] }));
  check("uitkraging aan een kolomkop: blijft momentvast (cantilever), de ligger ernaast niet",
    einden(uitkraging.changed) === "3b 3e" && einden(uitkraging.skipped) === "4b:cantilever" && losVan(uitkraging, 4) === "geen",
    `${einden(uitkraging.changed)} | ${einden(uitkraging.skipped)}`);
  const alleenKraging = pinOpenFem3DBeamsToColumns(met({ nodes: [{ id: 5, x: 9, y: 0, z: 4 }], beams: [staaf(4, 4, 5)] }), [4]);
  check("… ook als alleen de uitkraging geselecteerd is: niets veranderd, hetzelfde model",
    alleenKraging.changed.length === 0 && einden(alleenKraging.skipped) === "4b:cantilever");
  const inStukken = pinOpenFem3DBeamsToColumns(met({
    nodes: [{ id: 5, x: 7.5, y: 0, z: 4 }, { id: 6, x: 9, y: 0, z: 4 }], beams: [staaf(4, 4, 5), staaf(5, 5, 6)],
  }));
  check("uitkraging in twee stukken (een tussenknoop voor een puntlast): ook momentvast",
    einden(inStukken.skipped) === "4b:cantilever" && einden(inStukken.changed) === "3b 3e", einden(inStukken.skipped));
  const opgelegd = pinOpenFem3DBeamsToColumns(met({
    nodes: [{ id: 5, x: 9, y: 0, z: 4 }], beams: [staaf(4, 4, 5)], supports: [{ nodeId: 5, ...SCHARNIER }],
  }));
  check("een 'uitkraging' met een oplegging op het eind is een ligger: scharnierend aan de kolom",
    einden(opgelegd.changed) === "3b 3e 4b" && opgelegd.skipped.length === 0, einden(opgelegd.changed));
  const verend = pinOpenFem3DBeamsToColumns(met({
    nodes: [{ id: 5, x: 9, y: 0, z: 4 }], beams: [staaf(4, 4, 5)],
    supports: [{ nodeId: 5, ux: false, uy: false, uz: false, rx: false, ry: false, rz: false, springs: { kzKnPerM: 2000 } }],
  }));
  check("… ook op een veer", einden(verend.changed) === "3b 3e 4b", einden(verend.changed));

  // Luifel aan twee kolommen: uitkragingen 4 (2→5) en 5 (4→6) dwars op het
  // portaal, met een randligger 6 (5→6). Hij hangt alleen aan de koppen 2 en 4,
  // die op één lijn liggen, en geen staaf langs die lijn draagt torsie over.
  const luifel = pinOpenFem3DBeamsToColumns(met({
    nodes: [{ id: 5, x: 0, y: 3, z: 4 }, { id: 6, x: 6, y: 3, z: 4 }], beams: [staaf(4, 2, 5), staaf(5, 4, 6), staaf(6, 5, 6)],
  }));
  check("luifel aan twee kolommen met een randligger: blijft momentvast (hingeLine)",
    einden(luifel.skipped) === "4b:hingeLine 5b:hingeLine" && einden(luifel.changed) === "3b 3e",
    `${einden(luifel.changed)} | ${einden(luifel.skipped)}`);
  // Een knik (2→5→8) tussen twee kolomkoppen: ook die draait om de lijn 2–8.
  const knik = pinOpenFem3DBeamsToColumns(met({
    nodes: [{ id: 5, x: 0, y: 3, z: 4 }, { id: 7, x: 3, y: 3, z: 0 }, { id: 8, x: 3, y: 3, z: 4 }],
    beams: [staaf(4, 2, 5), staaf(5, 5, 8), staaf(6, 7, 8)], supports: [{ nodeId: 7, ...INKLEMMING }],
  }));
  check("een geknikte ligger tussen twee kolomkoppen: blijft momentvast (hingeLine)",
    einden(knik.skipped) === "4b:hingeLine 5e:hingeLine", einden(knik.skipped));
  // Een ligger 6 (8→6) van een derde kolom (7→8) naar het midden van de
  // ligger 2→6→4: dat deel hangt aan drie koppen die niet op één lijn liggen.
  const drieKoppen = pinOpenFem3DBeamsToColumns(met({
    nodes: [{ id: 6, x: 3, y: 0, z: 4 }, { id: 7, x: 3, y: 3, z: 0 }, { id: 8, x: 3, y: 3, z: 4 }],
    beams0: [staaf(1, 1, 2), staaf(2, 3, 4), staaf(3, 2, 6), staaf(4, 6, 4), staaf(5, 7, 8), staaf(6, 8, 6)],
    supports: [{ nodeId: 7, ...INKLEMMING }],
  }));
  check("ligger van een derde kolom op een ligger tussen twee kolommen: drie koppen, niet op één lijn, alle drie scharnierend",
    drieKoppen.skipped.length === 0 && einden(drieKoppen.changed) === "3b 4e 6b", `${einden(drieKoppen.changed)} | ${einden(drieKoppen.skipped)}`);
  // Een ligger in twee stukken (2→6→4) tussen de kolomkoppen: de stukken liggen op de lijn en dragen torsie.
  const inTweeStukken = pinOpenFem3DBeamsToColumns(met({
    nodes: [{ id: 6, x: 3, y: 0, z: 4 }], beams0: [staaf(1, 1, 2), staaf(2, 3, 4), staaf(3, 2, 6), staaf(4, 6, 4)],
  }));
  check("ligger in twee stukken tussen twee kolommen: beide buiteneinden scharnierend, doorgaand in het midden",
    einden(inTweeStukken.changed) === "3b 4e" && inTweeStukken.skipped.length === 0, einden(inTweeStukken.skipped));
  // Een ligger met aan beide einden torsie los tussen twee kolomkoppen wordt een pendelstaaf: geen mechanisme.
  const torsieLos = pinOpenFem3DBeamsToColumns(parseOpenFem3DModel({
    ...basis, beams: [staaf(1, 1, 2), staaf(2, 3, 4), staaf(3, 2, 4, { releases: { ...VAST, torsionStart: true, torsionEnd: true } })],
  }));
  check("ligger tussen twee kolomkoppen met torsie los: gewoon scharnierend", einden(torsieLos.changed) === "3b 3e");
  // Een kolom 4 (5→6) zonder oplegging eronder: haar kop telt niet (zij hangt aan de ligger).
  const losseKolom = pinOpenFem3DBeamsToColumns(met({
    nodes: [{ id: 5, x: 12, y: 0, z: 0 }, { id: 6, x: 12, y: 0, z: 4 }], beams: [staaf(4, 5, 6), staaf(5, 4, 6)],
  }));
  check("een kolom die nergens op staat, is geen kolomkop: de ligger ernaar blijft momentvast",
    einden(losseKolom.changed) === "3b 3e", `${einden(losseKolom.changed)} | ${einden(losseKolom.skipped)}`);
  // Zonder één oplegging in het model telt elke kolom (het model is nog niet af).
  const zonder = pinOpenFem3DBeamsToColumns(parseOpenFem3DModel({ nodes: basis.nodes, beams: basis.beams }));
  check("zonder opleggingen telt elke kolom", einden(zonder.changed) === "3b 3e", einden(zonder.changed));
  // Een kolom in twee stukken (1→5→2) met een vloerligger 4 (5→6) op halve hoogte naar kolom 5 (7→6).
  const verdieping = pinOpenFem3DBeamsToColumns(parseOpenFem3DModel({
    nodes: [...basis.nodes, { id: 5, x: 0, y: 0, z: 2 }, { id: 6, x: 6, y: 0, z: 2 }],
    beams: [staaf(1, 1, 5), staaf(6, 5, 2), staaf(2, 3, 6), staaf(7, 6, 4), staaf(3, 2, 4), staaf(4, 5, 6)],
    supports: basis.supports,
  }));
  check("een kolom in stukken telt op de tussenknoop: ook de vloerligger daar scharnierend",
    einden(verdieping.changed) === "3b 3e 4b 4e", einden(verdieping.changed));
}

console.log("\n[5] waar de bolletjes komen");
{
  const model = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6, y: 0, z: 2 }, { id: 4, x: 6, y: 4, z: 0 }],
    beams: [
      { id: 1, startNodeId: 1, endNodeId: 2, releases: { ...VAST, myEnd: true, mzEnd: true } },
      { id: 2, startNodeId: 2, endNodeId: 3, releases: { ...VAST, torsionStart: true, myEnd: true } },
      { id: 3, startNodeId: 2, endNodeId: 4 },
    ],
  });
  // Zoals in het tekenvlak: knoopbol 2,2 × en kleinste bolletje 1,25 × de staafstraal van 0,035 m.
  const opties = { nodeRadius: 0.077, markerSize: 0.4, minRadius: 0.04375 };
  const p = openFem3DBeamHingePlacements(model, opties);
  const van = (beamId, end) => p.find((x) => x.beamId === beamId && x.end === end);
  check("drie bolletjes: eind van 1, begin en eind van 2; geen bij de momentvaste staaf 3",
    p.length === 3 && van(1, "end") && van(2, "start") && van(2, "end") && !p.some((x) => x.beamId === 3),
    p.map((x) => `${x.beamId}${x.end}`).join(" "));
  const b = van(1, "end");
  const knoop = new THREE.Vector3(6, 0, 0);
  const afstand = b.position.distanceTo(knoop);
  check("op de staafas, vóór de eindknoop", Math.abs(b.position.y) < 1e-12 && Math.abs(b.position.z) < 1e-12 && b.position.x < 6);
  check("de rand is een dunne schil: buitenstraal = 1,12 × de straal", OPEN_FEM_3D_HINGE_RIM_SCALE === 1.12
    && Math.abs(b.rimRadius - 1.12 * b.radius) < 1e-12, `${b.rimRadius} / ${b.radius}`);
  check("kleiner dan de knoopbol, ook met de rand (≤ 0,85 ×)", b.rimRadius <= 0.85 * opties.nodeRadius,
    `${(b.rimRadius / opties.nodeRadius).toFixed(3)} × de knoopbol`);
  check("duidelijk dikker dan de staaf (≥ 1,25 × 0,035 m)", b.radius >= 1.25 * 0.035 - 1e-12, String(b.radius));
  check("raakt de knoopbol niet, ook niet met de rand (tussenruimte = 0,2 · maat)",
    Math.abs(afstand - b.rimRadius - opties.nodeRadius - 0.2 * opties.markerSize) < 1e-12,
    `${(afstand - b.rimRadius - opties.nodeRadius).toFixed(3)} m`);
  check("net vóór de knoop: binnen één markeringsmaat", afstand <= opties.markerSize, `${afstand.toFixed(3)} m`);
  const groter = openFem3DBeamHingePlacements(model, { ...opties, markerSize: 0.8 }).find((x) => x.beamId === 1);
  check("de afstand schaalt met de markeringsmaat", groter.position.distanceTo(knoop) > afstand + 0.05,
    `${groter.position.distanceTo(knoop).toFixed(3)} tegen ${afstand.toFixed(3)} m`);
  check("geen diepteverschuiving buiten de profielweergave", p.every((x) => x.depthBias === 0));
  const profiel = openFem3DBeamHingePlacements(model, { ...opties, profileExtent: (beam) => beam.id === 1 ? 0.2 : 0.12 });
  check("profielweergave: zo ver naar voren als het profiel uitsteekt, plus de buitenstraal",
    profiel.every((x) => Math.abs(x.depthBias - ((x.beamId === 1 ? 0.2 : 0.12) + x.rimRadius + 0.005)) < 1e-12),
    profiel.map((x) => x.depthBias.toFixed(3)).join(" "));
  check("geen scharnieren, geen bolletjes", openFem3DBeamHingePlacements(parseOpenFem3DModel({
    nodes: model.nodes, beams: model.beams.map(({ releases: _r, ...rest }) => rest),
  }), opties).length === 0);

  // Korte staven: L van 0,30 tot 1,0 m in een klein model en in een hal
  // (knoopbol 0,08, maat 0,8). Geen bolletje raakt een knoopbol of het
  // andere bolletje; is er geen plaats voor twee, dan één in het midden.
  const kort = (lengte, beideEinden, maten) => openFem3DBeamHingePlacements(parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: lengte, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, releases: { ...VAST, myEnd: true, mzEnd: true, ...(beideEinden ? { myStart: true, mzStart: true } : {}) } }],
  }), maten);
  const hal = { nodeRadius: 0.08, markerSize: 0.8, minRadius: 0.04375 };
  for (const [naam, maten] of [["klein model", opties], ["hal", hal]]) {
    for (const lengte of [0.3, 0.4, 0.51, 0.7, 1.0]) {
      for (const beide of [true, false]) {
        const ballen = kort(lengte, beide, maten);
        const vrijVanKnopen = ballen.every((x) => x.position.x - x.rimRadius > maten.nodeRadius
          && lengte - x.position.x - x.rimRadius > maten.nodeRadius);
        const vrijVanElkaar = ballen.length < 2 || ballen[1].position.x - ballen[0].position.x > ballen[0].rimRadius + ballen[1].rimRadius;
        const dikGenoeg = ballen.every((x) => x.radius >= maten.minRadius - 1e-12 && x.rimRadius <= 0.85 * maten.nodeRadius + 1e-12);
        const eigenHelft = ballen.length !== 2 || (ballen[0].position.x <= lengte / 2 && ballen[1].position.x >= lengte / 2);
        const goedAantal = beide ? ballen.length === 2 || (ballen.length === 1 && ballen[0].end === "both")
          : ballen.length === 1 && ballen[0].end === "end";
        check(`${naam}, staaf van ${lengte} m, ${beide ? "twee scharnieren" : "één scharnier"}: ${ballen.map((x) => x.end).join("+")}, `
          + "vrij van de knoopbollen en van elkaar, dikker dan de staaf",
          goedAantal && vrijVanKnopen && vrijVanElkaar && dikGenoeg && eigenHelft,
          ballen.map((x) => `${x.end} x=${x.position.x.toFixed(3)} r=${x.radius.toFixed(4)} rand=${x.rimRadius.toFixed(4)}`).join("; "));
      }
    }
  }
  // De bevinding uit de controle: een staaf van 0,40 m in een hal kreeg 3,2 cm overlap; nu twee kleinere bolletjes.
  const veertig = kort(0.4, true, hal);
  check("hal, 0,40 m met twee scharnieren: twee bolletjes, kleiner dan normaal maar dikker dan de staaf",
    veertig.length === 2 && veertig[0].radius < 0.75 * hal.nodeRadius && veertig[0].radius >= hal.minRadius,
    veertig.map((x) => x.radius.toFixed(4)).join(" "));
  const dertig = kort(0.3, true, hal);
  check("hal, 0,30 m met twee scharnieren: één bolletje in het midden", dertig.length === 1 && dertig[0].end === "both"
    && Math.abs(dertig[0].position.x - 0.15) < 1e-12, dertig.map((x) => `${x.end} ${x.position.x}`).join());
}

console.log("\n[6] de lintknop en het gereedschap");
{
  const model = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 4 }, { id: 3, x: 6, y: 0, z: 4 }],
    beams: [staaf(1, 1, 2), staaf(2, 2, 3), staaf(5, 1, 3)],
  });
  check("geen selectie: alle staven", openFem3DPinToColumnsScope(model, null) === undefined);
  check("één staaf geselecteerd: die staaf", JSON.stringify(openFem3DPinToColumnsScope(model, { type: "beam", id: 2 })) === "[2]");
  check("meerdere staven (en knopen): de staven, zonder dubbele en zonder verdwenen staaf",
    JSON.stringify(openFem3DPinToColumnsScope(model, { type: "multi", nodeIds: [1], beamIds: [5, 2, 5, 9] })) === "[5,2]");
  check("alleen knopen geselecteerd: alle staven",
    openFem3DPinToColumnsScope(model, { type: "multi", nodeIds: [1, 2], beamIds: [] }) === undefined
      && openFem3DPinToColumnsScope(model, { type: "node", id: 1 }) === undefined);
  check("een plaat of last geselecteerd: alle staven", openFem3DPinToColumnsScope(model, { type: "plate", id: 1 }) === undefined
    && openFem3DPinToColumnsScope(model, { type: "memberLoad", id: 2 }) === undefined);
  check("een verdwenen staaf als enige selectie: alle staven", openFem3DPinToColumnsScope(model, { type: "beam", id: 9 }) === undefined);

  const melding = (changed, skipped, scope) => JSON.stringify(openFem3DPinToColumnsMessage({
    changed: Array.from({ length: changed }, (_, i) => ({ beamId: i + 1, end: "start" })),
    skipped: Array.from({ length: skipped }, (_, i) => ({ beamId: i + 1, end: "end", reason: "cantilever" })),
  }, scope));
  const k = (naam) => `ribbon:openFem3d.pinBeamsToColumns${naam}`;
  check("veranderd in het hele model: een succesmelding met het aantal",
    melding(3, 0, undefined) === JSON.stringify({ level: "success", title: { key: k("Done"), count: 3 }, details: [{ key: k("ScopeAll") }] }),
    melding(3, 0, undefined));
  check("veranderd binnen de selectie: met het aantal geselecteerde staven",
    melding(1, 0, [4, 6]) === JSON.stringify({ level: "success", title: { key: k("Done"), count: 1 },
      details: [{ key: k("ScopeSelection"), count: 2 }] }), melding(1, 0, [4, 6]));
  check("niets veranderd: een informatiemelding",
    melding(0, 0, undefined) === JSON.stringify({ level: "info", title: { key: k("None") }, details: [{ key: k("ScopeAll") }] }));
  check("momentvast gebleven einden staan erbij, ook als er verder niets veranderde",
    melding(2, 1, undefined).includes(`{"key":"${k("Skipped")}","count":1}`)
      && melding(0, 2, [3]).startsWith(`{"level":"info"`) && melding(0, 2, [3]).includes(`{"key":"${k("Skipped")}","count":2}`));

  const uit = { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, beams: false, loads: false };
  check("Scharnier aan staafeind zet de staven aan", openFem3DVisibilityForTool(uit, "beamEndHinge").beams === true);
  check("… en laat de rest zoals het was", JSON.stringify({ ...openFem3DVisibilityForTool(uit, "beamEndHinge"), beams: false }) === JSON.stringify(uit));
  check("staven al aan, of een ander gereedschap: dezelfde zichtbaarheid (geen nieuwe toestand)",
    openFem3DVisibilityForTool(DEFAULT_OPEN_FEM_3D_VISIBILITY, "beamEndHinge") === DEFAULT_OPEN_FEM_3D_VISIBILITY
      && openFem3DVisibilityForTool(uit, "select") === uit && openFem3DVisibilityForTool(uit, "addBeam") === uit);
  const vlak = openFem3DVisibilityForTool({ ...uit, loadPanels: false }, "addLoadPanel");
  check("een belastingvlak tekenen zet lasten en belastingvlakken aan", vlak.loads && vlak.loadPanels && !vlak.beams);

  // De lintknop en het gereedschap in App.tsx gebruiken deze functies.
  const app = readFileSync(new URL("./src/App.tsx", import.meta.url), "utf8");
  const blok = (naam) => {
    const begin = app.indexOf(`const ${naam} = (`);
    return begin < 0 ? "" : app.slice(begin, app.indexOf("\n  };", begin));
  };
  check("App: het gereedschap zet in beeld wat het nodig heeft (openFem3DVisibilityForTool)",
    /setOpenFem3dVisibility\(\(value\) => openFem3DVisibilityForTool\(value, next\)\)/.test(blok("handleOpenFem3DToolChange")));
  const knop = blok("handleOpenFem3DPinBeamsToColumns");
  check("App: de lintknop kiest de staven en de melding met de zuivere functies",
    /openFem3DPinToColumnsScope\(current, openFem3dSelection\)/.test(knop) && /pinOpenFem3DBeamsToColumns\(current, scope\)/.test(knop)
      && /openFem3DPinToColumnsMessage\(result, scope\)/.test(knop));
}

console.log("\n[7] rekenproef met de 3D-kern");
{
  const binary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
  const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH
    ?? fileURLToPath(new URL(`../src-tauri/target/debug/${binary}`, import.meta.url));
  if (!existsSync(solverPath)) {
    check("de 3D-kern is gebouwd", false, `${solverPath} ontbreekt (bouw eerst de Rust-rekenkern)`);
  } else {
    const reken = (request) => new Promise((resolve) => {
      const child = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] });
      const uit = [], err = [];
      child.stdout.on("data", (d) => uit.push(d));
      child.stderr.on("data", (d) => err.push(d));
      child.on("error", (e) => resolve({ code: -1, fout: String(e) }));
      child.on("close", (code) => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(uit).toString()); } catch { /* geen JSON */ }
        resolve({ code, json, fout: Buffer.concat(err).toString().slice(0, 300) });
      });
      child.stdin.end(JSON.stringify(request));
    });
    const maxU = (r) => Math.max(...r.json.displacements.map((d) => Math.hypot(d.ux, d.uy, d.uz)));
    const rekent = async (model, caseId) => {
      const r = await reken(buildOpenFem3DSolveRequest(model, "linear", caseId));
      return r.code === 0 && r.json && !r.json.fout && Array.isArray(r.json.displacements) ? maxU(r) : `exit ${r.code} ${r.json?.fout ?? r.fout}`;
    };
    for (const [naam, fundering] of [["balkrooster 800 mm diep", { type: "balkrooster" }], ["balkrooster op peil", { type: "balkrooster", diepteMm: 0 }]]) {
      const hal = maakStaalhal({ fundering });
      const groep = new Map(Object.entries(hal.samenvatting.groepen).flatMap(([g, ids]) => ids.map((id) => [id, g])));
      const pin = pinOpenFem3DBeamsToColumns(hal.model);
      const perGroep = {};
      for (const c of pin.changed) perGroep[groep.get(c.beamId)] = (perGroep[groep.get(c.beamId)] ?? 0) + 1;
      check(`staalhal met ${naam}: alleen de 22 spantliggereinden op de kolomkoppen, geen funderingsbalk of poer`,
        JSON.stringify(perGroep) === JSON.stringify({ spantligger: 22 }) && pin.skipped.length === 0,
        `${JSON.stringify(perGroep)} | overgeslagen ${pin.skipped.length}`);
      const voor = await rekent(hal.model, STAALHAL_GEVAL.windDwars);
      const na = await rekent(pin.model, STAALHAL_GEVAL.windDwars);
      // Met scharnierende spanten dragen alleen de ingeklemde kolommen de wind:
      // meer verplaatsing (≈ 0,16 m), maar geen mechanisme (dat gaf > 100 m).
      check(`… wind dwars rekent daarna nog, zonder mechanisme (max|u| < 0,5 m)`,
        typeof voor === "number" && typeof na === "number" && na < 0.5,
        `voor ${typeof voor === "number" ? voor.toFixed(4) : voor}, na ${typeof na === "number" ? na.toFixed(4) : na}`);
    }
    const B = (id, a, b, profileName) => ({ id, startNodeId: a, endNodeId: b, profileName, material: "S235" });
    const last = (nodeId, fz) => [{ id: 1, nodeId, caseId: 1, fx: 0, fy: 0, fz, mx: 0, my: 0, mz: 0 }];
    for (const [naam, raw, verwacht] of [
      ["portaal met een uitkraging (last op het vrije eind)", {
        nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 4 }, { id: 3, x: 6, y: 0, z: 0 }, { id: 4, x: 6, y: 0, z: 4 }, { id: 5, x: 9, y: 0, z: 4 }],
        beams: [B(1, 1, 2, "HEA 200"), B(2, 3, 4, "HEA 200"), B(3, 2, 4, "IPE 300"), B(4, 4, 5, "IPE 300")],
        supports: [{ nodeId: 1, ...INKLEMMING }, { nodeId: 3, ...INKLEMMING }], loads: last(5, -10),
      }, "3b 3e | 4b:cantilever"],
      ["kolom op een ligger (last bovenop de kolom)", {
        nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 4 }, { id: 3, x: 12, y: 0, z: 0 }, { id: 4, x: 12, y: 0, z: 4 },
          { id: 6, x: 6, y: 0, z: 4 }, { id: 7, x: 6, y: 0, z: 7 }],
        beams: [B(1, 1, 2, "HEA 200"), B(2, 3, 4, "HEA 200"), B(3, 2, 6, "IPE 300"), B(4, 6, 4, "IPE 300"), B(5, 6, 7, "HEA 200")],
        supports: [{ nodeId: 1, ...INKLEMMING }, { nodeId: 3, ...INKLEMMING }], loads: last(7, -50),
      }, "3b 4e | "],
      ["luifel aan twee kolommen", {
        nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 4 }, { id: 3, x: 6, y: 0, z: 0 }, { id: 4, x: 6, y: 0, z: 4 },
          { id: 5, x: 0, y: 2, z: 4 }, { id: 6, x: 6, y: 2, z: 4 }],
        beams: [B(1, 1, 2, "HEA 200"), B(2, 3, 4, "HEA 200"), B(3, 2, 4, "IPE 300"), B(4, 2, 5, "IPE 200"), B(5, 4, 6, "IPE 200"),
          B(6, 5, 6, "IPE 200")],
        supports: [{ nodeId: 1, ...INKLEMMING }, { nodeId: 3, ...INKLEMMING }], loads: last(5, -5),
      }, "3b 3e | 4b:hingeLine 5b:hingeLine"],
    ]) {
      const model = parseOpenFem3DModel(raw);
      const pin = pinOpenFem3DBeamsToColumns(model);
      const voor = await rekent(model, 1);
      const na = await rekent(pin.model, 1);
      check(`${naam}: ${verwacht}; rekent ervoor en erna`,
        `${einden(pin.changed)} | ${einden(pin.skipped)}` === verwacht && typeof voor === "number" && typeof na === "number",
        `${einden(pin.changed)} | ${einden(pin.skipped)}; voor ${voor}, na ${na}`);
    }
  }
}

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

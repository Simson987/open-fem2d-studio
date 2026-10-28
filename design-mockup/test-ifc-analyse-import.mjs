// Import van een IFC4-analysemodel (Structural Analysis View) naar het 3D-model.
//
// De bestanden zijn synthetisch: docs/verificatie/ifc-analyse/genereer-ifc-analyse.mjs
// maakt ze (twee analysemodellen in één bestand, in m/N en in mm/kN), en met
// `afwijkingen: true` een derde model met alles wat de import moet melden.
//
// Elk verwacht getal volgt uit de invoer van de generator:
//   - vlaklasten Σ = q × oppervlak: G2 vloer 3,0 · 2 · (3 × 5) + dak 0,5 · (6 × 5)
//     = 90 + 15 = 105 kN; Q 2,5 · 30 = 75 kN; dakzuiging 0,4 · 30 = 12 kN omhoog;
//   - wind: 1,2 kN/m op de kolommen x = 0 (twee kolomlijnen van 7,2 m) = 17,28 kN
//     plus 2 kN op K13 = 19,28 kN in +X; imperfectie 0,5 + 0,25 = 0,75 kN in +X;
//   - luifel: ligger P2 (0, 0, 3) → P3 (3, 0, 2,5), L = √9,25, cos α = 3/√9,25;
//     G 2,0 kN/m per geprojecteerde lengte → Σ = 2,0 · 3 = 6 kN; S 0,8 kN/m per
//     ware lengte → Σ = 0,8 · √9,25; Q 5 + 3 = 8 kN; W 0,5 kN/m op de kolom
//     (3 m) = 1,5 kN in +X;
//   - rolhoeken: een kolom (x = +Z) heeft e_z0 = +X en e_y0 = −Y; Axis X geeft
//     θ = atan2(0, 1) = 0, Axis Y geeft θ = atan2(1, 0) = π/2.
//
// Daarna rekent de 3D-kern het hallenmodel zonder trek-alleen staven en
// schijven (die kent de kern in deze versie nog niet), de luifel en de
// doorgaande ligger door, en moeten de reacties de lasten opheffen. Het model
// "Varianten" (vlaklasten met een eigen face, strips) toetst alleen de
// importuitvoer: de kern op deze tak kent het profiel "Strip" nog niet.
// Rekenkern: OPEN_FEM_3D_SOLVER_PATH, anders src-tauri/target/debug/open-fem-3d(.exe).
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  decodeerStepTekst, leesStep, StepGetypt, StepEnum, StepRef, StepLeesFout, STEP_AFGELEID,
} from "./src/io/stepLezer.ts";
import {
  ifcAnalyseModellen, ifcAnalyseProject, importeerIfcAnalyseModel, IfcImportFout, leesIfcAnalyseBestand,
} from "./src/io/ifcAnalyseImport.ts";
import { openFem3DMemberAxes, parseOpenFem3DModel, withOpenFem3DSelfWeight } from "./src/components/openFem3d/openFem3dModel.ts";
import { openFem3DLoadPanelGeometry, withOpenFem3DLoadPanels } from "./src/components/openFem3d/openFem3dLoadPanels.ts";
import { buildOpenFem3DSolveRequest, openFem3DGlobalForceBalance } from "./src/components/openFem3d/openFem3dSolver.ts";
import { resolveSection, dichtheidVanMateriaal, G } from "./src/lib/sectionResolver.ts";
import { deserializeProject, serializeProject } from "./src/io/projectFile.ts";
import { maakIfcAnalyseBestand } from "../docs/verificatie/ifc-analyse/genereer-ifc-analyse.mjs";

let geslaagd = 0, gefaald = 0;
const log = (s) => process.stdout.write(s + "\n");
function check(naam, voorwaarde, detail = "") {
  if (voorwaarde) { geslaagd += 1; log(`  ✓ ${naam}`); }
  else { gefaald += 1; log(`  ✗ ${naam}${detail ? ` — ${detail}` : ""}`); }
}
const dicht = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const gooit = (fn) => { try { fn(); return null; } catch (fout) { return fout; } };

const FIXTURE = (naam) => fileURLToPath(new URL(`../docs/verificatie/ifc-analyse/${naam}`, import.meta.url));
const MN = readFileSync(FIXTURE("ifc-analyse-m-n.ifc"), "utf8");
const MMKN = readFileSync(FIXTURE("ifc-analyse-mm-kn.ifc"), "utf8");

// ── [1] De STEP-lezer ────────────────────────────────────────────────────────
log("\n[1] STEP-lezer");
{
  check("'' is een apostrof, \\\\ een backslash", decodeerStepTekst("O''Neil \\\\ pad".replace("''", "'")) === "O'Neil \\ pad");
  check("\\X2\\00E9\\X0\\ (UTF-16), \\X\\E9 (Latijn-1) en \\S\\i (+128) worden é",
    decodeerStepTekst("caf\\X2\\00E9\\X0\\") === "café" && decodeerStepTekst("caf\\X\\E9") === "café" && decodeerStepTekst("caf\\S\\i") === "café");
  check("\\X4\\ (UCS-4) buiten het basisvlak", decodeerStepTekst("\\X4\\0001F600\\X0\\") === "😀");
  const b = leesStep([
    "ISO-10303-21;", "HEADER;", "FILE_SCHEMA(('IFC4'));", "ENDSEC;", "DATA;",
    "#1 = IFCTEST ( 'a''b' , 1.E-5,-2.5E+003, 12, $, *, .T., #2, (1., (2., 3.)), IFCBOOLEAN(.F.) ) ;",
    "/* commentaar */ #2=IFCREGELS('over",
    "twee regels',",
    "  .ENUM_WAARDE.",
    ");",
    "ENDSEC;", "END-ISO-10303-21;",
  ].join("\n"));
  const r = b.records.get(1);
  check("schema uit de kop", b.schemas[0] === "IFC4");
  check("record over meerdere regels, met commentaar ertussen",
    b.records.get(2)?.args[0] === "overtwee regels" && b.records.get(2)?.args[1] instanceof StepEnum);
  check("tekst, getallen met exponent, $, *, opsomming, verwijzing",
    r.args[0] === "a'b" && r.args[1] === 1e-5 && r.args[2] === -2500 && r.args[3] === 12 && r.args[4] === null &&
    r.args[5] === STEP_AFGELEID && r.args[6] instanceof StepEnum && r.args[6].waarde === "T" &&
    r.args[7] instanceof StepRef && r.args[7].id === 2);
  check("geneste lijst en getypte waarde",
    JSON.stringify(r.args[8]) === "[1,[2,3]]" && r.args[9] instanceof StepGetypt && r.args[9].type === "IFCBOOLEAN" &&
    r.args[9].waarde instanceof StepEnum && r.args[9].waarde.waarde === "F");
  const kapot = gooit(() => leesStep("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=IFCX(1,2;\nENDSEC;\n"));
  check("een kapot record geeft een fout met het regelnummer", kapot instanceof StepLeesFout && /Regel 5/.test(kapot.message), kapot?.message);
  const zip = gooit(() => leesStep("PK\u0003\u0004..."));
  check("een ifcZIP wordt herkend", zip instanceof StepLeesFout && /ifcZIP/.test(zip.message));
  const xml = gooit(() => leesStep("<?xml version='1.0'?><ifcXML/>"));
  check("een ifcXML wordt herkend", xml instanceof StepLeesFout && /ifcXML/.test(xml.message));
  const t0 = performance.now();
  for (let i = 0; i < 20; i += 1) leesStep(MN);
  const ms = (performance.now() - t0) / 20;
  check(`de testfixture (${(MN.length / 1024).toFixed(0)} kB) leest in ${ms.toFixed(1)} ms`, ms < 200);
}

// ── [2] Fixture en modelkeuze ────────────────────────────────────────────────
log("\n[2] Fixture, schema en keuze van het analysemodel");
{
  check("de vaste bestanden zijn gelijk aan de generator (m/N en mm/kN)",
    maakIfcAnalyseBestand({ eenheden: "m-N" }) === MN.replace(/\r\n/g, "\n") &&
    maakIfcAnalyseBestand({ eenheden: "mm-kN" }) === MMKN.replace(/\r\n/g, "\n"));
  const modellen = ifcAnalyseModellen(MN);
  check("twee analysemodellen met naam, beschrijving en aantallen",
    JSON.stringify(modellen.map((m) => [m.nummer, m.naam, m.aantallen])) === JSON.stringify([
      [1, "Hal", { knopen: 14, staven: 23, vlakken: 4, belastinggevallen: 5, combinaties: 3 }],
      [2, "Luifel", { knopen: 3, staven: 2, vlakken: 0, belastinggevallen: 4, combinaties: 2 }],
    ]) && modellen[0].beschrijving === "Portaal met verdieping, verbanden en schijven", JSON.stringify(modellen));
  const zonder = gooit(() => importeerIfcAnalyseModel(MN));
  check("zonder keuze bij twee modellen: fout met de lijst",
    zonder instanceof IfcImportFout && zonder.code === "modelKeuzeNodig" && zonder.modellen.length === 2 &&
    zonder.message.includes('1 "Hal"') && zonder.message.includes('2 "Luifel"'), zonder?.message);
  const onbekend = gooit(() => importeerIfcAnalyseModel(MN, { model: "Loods" }));
  check("een onbekende naam wordt geweigerd", onbekend instanceof IfcImportFout && onbekend.code === "modelOnbekend");
  const opNaam = importeerIfcAnalyseModel(MN, { model: "luifel" });
  const opNummer = importeerIfcAnalyseModel(leesIfcAnalyseBestand(MN), { model: 2 });
  check("kiezen op naam (hoofdletterongevoelig) en op nummer geeft hetzelfde model",
    opNaam.verslag.model === "Luifel" && JSON.stringify(opNaam.model3d) === JSON.stringify(opNummer.model3d));
  const ifc2x3 = gooit(() => importeerIfcAnalyseModel(MN.replace("FILE_SCHEMA(('IFC4'))", "FILE_SCHEMA(('IFC2X3'))")));
  check("IFC2X3 wordt geweigerd met de reden", ifc2x3 instanceof IfcImportFout && ifc2x3.code === "geenIfc4" && /IFC2X3/.test(ifc2x3.message));
  const bouwkundig = gooit(() => importeerIfcAnalyseModel(MN.replace(/IFCSTRUCTURALANALYSISMODEL/g, "IFCGROUP")));
  check("een bestand zonder analysemodel wordt geweigerd", bouwkundig instanceof IfcImportFout && bouwkundig.code === "geenAnalysemodel");
}

// ── [3] Model 1: de hal ──────────────────────────────────────────────────────
log("\n[3] Model 1 \"Hal\": knopen, staven, opleggingen, scharnieren");
const hal = importeerIfcAnalyseModel(MN, { model: "Hal" });
const m1 = hal.model3d;
const staaf = (naam) => m1.beams.find((b) => b.name === naam);
const knoop = (naam) => m1.nodes.find((n) => n.name === naam);
{
  const a = hal.verslag.aantallen;
  check("aantallen", JSON.stringify(a) === JSON.stringify({
    knopen: 14, staven: 23, opleggingen: 4, stavenMetScharnieren: 11, belastingvlakken: 6, staaflasten: 4,
    staafpuntlasten: 0, knooplasten: 3, belastinggevallen: 5, combinaties: 3, levels: 3, schijven: 2, imperfectieGevallen: 1,
  }), JSON.stringify(a));
  check("knopen dragen de naam uit het bestand en de coördinaten in m",
    m1.nodes.length === 14 && knoop("K7").x === 6 && knoop("K7").y === 0 && knoop("K7").z === 3.6 && knoop("K14").z === 7.2);
  check("staafeinden delen de knopen (dezelfde IfcVertexPoint)",
    staaf("C1a").endNodeId === knoop("K5").id && staaf("C1b").startNodeId === knoop("K5").id && staaf("L1").startNodeId === knoop("K5").id);

  // Rolhoeken: e_z van het model valt samen met de Axis uit het bestand.
  const axis = {
    C1a: [1, 0, 0], C1b: [1, 0, 0], C2a: [1, 0, 0], C2b: [1, 0, 0], C3a: [0, 1, 0], C3b: [0, 1, 0], C4a: [0, 1, 0], C4b: [0, 1, 0],
    L1: [0, 0, 1], L5: [0, 0, 1], R1: [0, 0, 1], R3: [0, 0, 1], V1: [1, 0, 0], V2: [1, 0, 0], S1: [1, 0, 0], F1: [0, 0, 1],
  };
  const byId = new Map(m1.nodes.map((n) => [n.id, n]));
  const afwijking = Object.entries(axis).map(([naam, z]) => {
    const b = staaf(naam);
    const { ez } = openFem3DMemberAxes(byId.get(b.startNodeId), byId.get(b.endNodeId), b.rollAngleRad ?? 0);
    return Math.abs(ez[0] * z[0] + ez[1] * z[1] + ez[2] * z[2] - 1);
  });
  check("voor elke staaf is e_z = Axis (rol volgt de Axis van het bestand)", afwijking.every((d) => d < 1e-12), afwijking.join(", "));
  check("kolom met Axis X: rol 0; met Axis Y: rol π/2",
    ["C1a", "C1b", "C2a", "C2b"].every((n) => (staaf(n).rollAngleRad ?? 0) === 0) &&
    ["C3a", "C3b", "C4a", "C4b"].every((n) => dicht(staaf(n).rollAngleRad, Math.PI / 2, 1e-12)));

  const profielen = Object.fromEntries(m1.beams.map((b) => [b.name, `${b.profileName}|${b.material}`]));
  check("profielen: naam, 'HE 200 A', afmetingen, UPN, koker K80/4, massief rond",
    profielen.C1a === "HEA 200|S235" && profielen.C3a === "HEA 200|S235" && profielen.L1 === "IPE 300|S355" &&
    profielen.L5 === "IPE 330|S235" && profielen.R1 === "IPE 240|S235" && profielen.R3 === "UNP 200|S235" &&
    profielen.S1 === "SHS 80x80x4|S235" && profielen.V1 === "RD 20|S235" && profielen.F1 === "RD 16|S235", JSON.stringify(profielen));
  check("groep: de eigenschap Onderdeel gaat voor ObjectType",
    staaf("C1a").group === "Kolom as A" && staaf("C2a").group === "Kolom" && staaf("L6").group === "Vloerligger" && staaf("S1").group === "Schoor");
  check("trek-alleen: X-verband en vloerdiagonaal van rond staal, niet de kokerschoor",
    ["V1", "V2", "F1"].every((n) => staaf(n).tensionOnly === true) && staaf("S1").tensionOnly === undefined && hal.verslag.trekAlleen === 3);

  const vrij = (naam) => JSON.stringify(staaf(naam).releases ?? null);
  const scharnier = JSON.stringify({ myStart: true, myEnd: true, mzStart: true, mzEnd: true, torsionStart: false, torsionEnd: false });
  check("scharnierende liggers: My en Mz vrij aan beide einden, torsie vast",
    ["L5", "L6", "L7", "R1", "R2", "R3", "R4", "S1"].every((n) => vrij(n) === scharnier), vrij("L5"));
  check("kogelscharnier aan beide einden: torsie aan het begin vastgezet (mechanisme)",
    ["V1", "V2", "F1"].every((n) => vrij(n) === JSON.stringify({ myStart: true, myEnd: true, mzStart: true, mzEnd: true, torsionStart: false, torsionEnd: true })));
  check("doorgaande kolommen en starre vloerliggers zonder scharnieren",
    ["C1a", "C1b", "C2a", "C4b", "L1", "L4"].every((n) => staaf(n).releases === undefined));

  const steun = (naam) => m1.supports.find((s) => s.nodeId === knoop(naam).id);
  const vast = (s) => ["ux", "uy", "uz", "rx", "ry", "rz"].map((k) => (s[k] ? 1 : 0)).join("");
  check("ingeklemde voet K1 en scharnierende voeten K2, K3", vast(steun("K1")) === "111111" && vast(steun("K2")) === "111000" && vast(steun("K3")) === "111000");
  check("voet K4 op veren: k_z 50 000 kN/m, k_ry 2 000 kNm/rad (uit N/m en N·m/rad)",
    vast(steun("K4")) === "110000" && steun("K4").springs?.kzKnPerM === 50000 && steun("K4").springs?.kryKnmPerRad === 2000,
    JSON.stringify(steun("K4")));
}

log("\n[4] Schijven, belastingvlakken, lasten, gevallen, combinaties, levels");
{
  const namen = (ids) => ids.map((id) => m1.nodes.find((n) => n.id === id).name).join(",");
  check("twee schijven: de KPV-vlakken op +3,6 delen knopen, het dak op +7,2 staat los",
    JSON.stringify(hal.verslag.schijven.map((s) => [s.naam, s.hoogteM, s.knopen, s.vlakken])) === JSON.stringify([
      ["Schijf +3.600", 3.6, 6, ["KPV-1", "KPV-2"]], ["Schijf +7.200", 7.2, 4, ["Dakschijf"]],
    ]) && namen(m1.diaphragms[0].nodeIds) === "K5,K6,K7,K8,K9,K10" && namen(m1.diaphragms[1].nodeIds) === "K11,K12,K13,K14",
    JSON.stringify(m1.diaphragms));

  const byId = new Map(m1.nodes.map((n) => [n.id, n]));
  const panelen = m1.loadPanels.map((p) => {
    const g = openFem3DLoadPanelGeometry(m1, p, byId);
    return { ...p, opp: g.areaM2, som: p.q * g.projectedAreaM2 };
  });
  const somPerGeval = (caseId) => panelen.filter((p) => p.caseId === caseId).reduce((s, p) => s + p.som, 0);
  check("Σ q × oppervlak: G2 105 kN, Q 75 kN, dakzuiging −12 kN",
    dicht(somPerGeval(2), 105) && dicht(somPerGeval(3), 75) && dicht(somPerGeval(4), -12),
    `${somPerGeval(2)} ${somPerGeval(3)} ${somPerGeval(4)}`);
  const kpv1 = panelen.filter((p) => namen(p.nodeIds) === "K5,K6,K9,K8");
  const kpv2 = panelen.filter((p) => namen(p.nodeIds) === "K6,K7,K10,K9");
  const dak = panelen.filter((p) => namen(p.nodeIds) === "K11,K12,K14,K13");
  check("KPV-1 zonder overspanningsrichting: twee richtingen; KPV-2 'globaal X', dak 'globaal Y': één richting",
    kpv1.every((p) => p.distribution === "twoWay") &&
    kpv2.every((p) => p.distribution === "oneWay" && p.spanDirection.x === 1) &&
    dak.every((p) => p.distribution === "oneWay" && p.spanDirection.y === 1));
  check("twee acties van hetzelfde geval op het dakvlak zijn opgeteld (0,3 + 0,2)", dak.find((p) => p.caseId === 2)?.q === 0.5);
  check("PlanarForceZ < 0 → q > 0 met gravity; zuiging (> 0) → q < 0",
    kpv1.every((p) => p.q > 0 && p.direction === "gravity") && dak.find((p) => p.caseId === 4)?.q === -0.4);
  check("de vloerdiagonaal (trek-alleen, in het vlak) krijgt geen vloerlast",
    kpv1.every((p) => JSON.stringify(p.excludedBeamIds) === JSON.stringify([staaf("F1").id])) && kpv2.every((p) => !p.excludedBeamIds));
  // De afdracht van de app sluit: Σ omgezette last = q × projectie.
  const omgezet = withOpenFem3DLoadPanels(m1).model;
  const verticaal = (caseId) => {
    let fz = 0;
    for (const l of omgezet.loads.filter((x) => x.caseId === caseId)) fz += l.fz;
    for (const l of omgezet.memberLoads.filter((x) => x.caseId === caseId)) {
      const b = omgezet.beams.find((x) => x.id === l.beamId);
      const { ey, ez } = openFem3DMemberAxes(byId.get(b.startNodeId), byId.get(b.endNodeId), b.rollAngleRad ?? 0);
      const lengte = l.endPositionM - l.startPositionM;
      fz += ((l.qyStart + l.qyEnd) / 2 * ey[2] + (l.qzStart + l.qzEnd) / 2 * ez[2]) * lengte;
    }
    return fz;
  };
  check("de afdracht van de belastingvlakken sluit: G2 −105, Q −75 kN verticaal",
    dicht(verticaal(2), -105, 1e-6) && dicht(verticaal(3), -75, 1e-6), `${verticaal(2)} ${verticaal(3)}`);

  // Lijnlast op de kolommen, globaal X: lokaal qz bij rol 0, qy bij rol π/2.
  const wind = m1.memberLoads.filter((l) => l.caseId === 4);
  const q = (naam) => wind.find((l) => l.beamId === staaf(naam).id);
  check("wind globaal X: rol 0 → qz = 1,2; rol π/2 → qy = 1,2 kN/m, over de hele staaf",
    ["C1a", "C1b"].every((n) => dicht(q(n).qzStart, 1.2, 1e-12) && Math.abs(q(n).qyStart) < 1e-12) &&
    ["C3a", "C3b"].every((n) => dicht(q(n).qyStart, 1.2, 1e-12) && Math.abs(q(n).qzStart) < 1e-12) &&
    wind.every((l) => l.startPositionM === 0 && dicht(l.endPositionM, 3.6)), JSON.stringify(wind));
  let somX = 0;
  for (const l of wind) {
    const b = m1.beams.find((x) => x.id === l.beamId);
    const { ey, ez } = openFem3DMemberAxes(byId.get(b.startNodeId), byId.get(b.endNodeId), b.rollAngleRad ?? 0);
    somX += (l.qyStart * ey[0] + l.qzStart * ez[0]) * (l.endPositionM - l.startPositionM);
  }
  check("Σ lijnlast = q × L = 1,2 · 7,2 · 2 = 17,28 kN in +X", dicht(somX, 17.28, 1e-12), String(somX));
  const knoopLast = (naam, caseId) => m1.loads.find((l) => l.nodeId === knoop(naam).id && l.caseId === caseId);
  check("puntacties op knopen: 2 kN op K13 (W), 0,5 op K5 en 0,25 kN op K11 (imperfectie)",
    knoopLast("K13", 4)?.fx === 2 && knoopLast("K5", 5)?.fx === 0.5 && knoopLast("K11", 5)?.fx === 0.25);

  check("belastinggevallen: type uit ActionType en ActionSource, imperfectie 'overig' met kenmerk, eigen gewicht uit (0, 0, −1)",
    JSON.stringify(hal.loadCases) === JSON.stringify([
      { id: 1, name: "G1 eigen gewicht", type: "dead", eigenGewicht: true },
      { id: 2, name: "G2 afbouw", type: "dead" },
      { id: 3, name: "Q vloer", type: "live" },
      { id: 4, name: "W wind X", type: "wind" },
      // Het kenmerk `imperfectie` (issue #199): de UGT-toets telt dit geval
      // met factor 0, want zij rekent zelf met de scheefstand.
      { id: 5, name: "Imp G +X", type: "other", imperfectie: true },
    ]) && hal.selfWeightCaseId === 1, JSON.stringify(hal.loadCases));
  const c = Object.fromEntries(hal.combinations.map((x) => [x.name, x]));
  const factoren = (x) => JSON.stringify([...x.factors].sort((a, b) => a[0] - b[0]));
  check("UGT 1: factoren uit IfcRelAssignsToGroupByFactor (ook twee gevallen in één relatie), Purpose ULS",
    c["UGT 1"].type === "uls" && factoren(c["UGT 1"]) === JSON.stringify([[1, 1.2], [2, 1.2], [3, 1.5], [4, 0.9]]), factoren(c["UGT 1"]));
  check("BGT kar: factor 1 uit een gewone toewijzing, imperfectie +1; BGT kar -X: imperfectie −1",
    c["BGT kar"].type === "sls" && factoren(c["BGT kar"]) === JSON.stringify([[1, 1], [2, 1], [3, 1], [4, 0.6], [5, 1]]) &&
    c["BGT kar -X"].type === "sls" && factoren(c["BGT kar -X"]) === JSON.stringify([[1, 1], [2, 1], [3, 1], [4, 0.6], [5, -1]]),
    `${factoren(c["BGT kar"])} ${factoren(c["BGT kar -X"])}`);
  check("formules leesbaar, met minteken",
    c["UGT 1"].formula === "1,2·G1 eigen gewicht + 1,2·G2 afbouw + 1,5·Q vloer + 0,9·W wind X" &&
    c["BGT kar -X"].formula === "G1 eigen gewicht + G2 afbouw + Q vloer − 1·Imp G +X + 0,6·W wind X", c["BGT kar -X"].formula);
  check("eigen combinaties: geen kenmerk standaard", hal.combinations.every((x) => x.standaard === undefined));
  check("levels uit IfcBuildingStorey.Elevation, knopen precies op die hoogte gekoppeld",
    JSON.stringify(hal.levels) === JSON.stringify([
      { id: "z-1", label: "Begane grond", position: 0 }, { id: "z-2", label: "Verdieping", position: 3600 },
      { id: "z-3", label: "Dak", position: 7200 },
    ]) && ["K1", "K4"].every((n) => knoop(n).levelId === "z-1") && ["K5", "K10"].every((n) => knoop(n).levelId === "z-2") &&
    knoop("K14").levelId === "z-3");
  check("projectnaam: IfcProject.Name + het analysemodel", hal.projectnaam === "Voorbeeldhal - Hal");

  const v = hal.verslag;
  const heeft = (lijst, ...delen) => lijst.some((regel) => delen.every((d) => regel.includes(d)));
  check("verslag legt de trek-alleenregel uit, met aantallen",
    heeft(v.toelichting, "Trek-alleen: 3 staven", "3 pendelstaven (PIN_JOINED_MEMBER) van massief rond staal", "1 pendelstaaf met een ander profiel"),
    v.toelichting.join(" | "));
  check("verslag: eenheden, profiel op afmetingen, eigen gewicht",
    heeft(v.toelichting, "lengte m, kracht N") && heeft(v.toelichting, "op afmetingen gevonden: IPE 300 (4×)") &&
    heeft(v.toelichting, "draagt het automatische eigen gewicht"));
  check("verslag: schijfbenadering, mechanisme (3× gegroepeerd), imperfectie, twee richtingen, gewicht van vloeren",
    heeft(v.waarschuwingen, "benaderd als starre schijf", "2 schijven") &&
    heeft(v.waarschuwingen, "torsie aan het begin is vastgezet (3×)", '"V1"', '"F1"') &&
    heeft(v.waarschuwingen, "1 imperfectiegeval (SYSTEM_IMPERFECTION) ingelezen; zet de scheefstand van de app uit") &&
    heeft(v.waarschuwingen, "afdracht in twee richtingen", '"KPV-1"') &&
    heeft(v.waarschuwingen, "gewicht van vloeren en platen"), v.waarschuwingen.join(" | "));
  check("niets onondersteund in model 1", v.nietOndersteund.length === 0, v.nietOndersteund.join(" | "));
  check("geen dubbele regels in het verslag",
    [v.toelichting, v.waarschuwingen, v.nietOndersteund].every((l) => new Set(l).size === l.length));

  const project = ifcAnalyseProject(hal, { projectNumber: "P-1" });
  const terug = deserializeProject(serializeProject(project));
  check("projectbestand: 3D, eerste orde, eigen gewicht aan, scheefstand uit, eigen combinaties, levels, naam",
    terug.modelDimension === "3d" && terug.analysetype === "eersteOrde" && terug.selfWeightEnabled === true &&
    project.scheefstandEnabled === false && terug.scheefstandEnabled === false &&
    terug.combinations.length === 3 && terug.combinations.every((x) => !x.standaard) &&
    terug.structuralGrid.zAxes.length === 3 && terug.structuralGrid.enabled === true &&
    terug.projectInfo.name === "Voorbeeldhal - Hal" && terug.projectInfo.projectNumber === "P-1" &&
    terug.activeLoadCaseId === 2 && JSON.stringify(parseOpenFem3DModel(terug.model3d)) === JSON.stringify(m1));
}

// ── [5] Eenheden: hetzelfde model in mm en kN ────────────────────────────────
log("\n[5] Eenheden: hetzelfde model in mm en kN");
{
  let grootste = 0, waar = "";
  const vergelijk = (a, b, pad) => {
    if (typeof a === "number" && typeof b === "number") {
      const d = Math.abs(a - b) / Math.max(1, Math.abs(a));
      if (d > grootste) { grootste = d; waar = pad; }
      return;
    }
    if (a instanceof Map) return vergelijk(Object.fromEntries(a), Object.fromEntries(b), pad);
    if (a && typeof a === "object") {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b ?? {})])) vergelijk(a[k], b?.[k], `${pad}.${k}`);
      return;
    }
    if (a !== b) { grootste = Infinity; waar = `${pad}: ${a} ≠ ${b}`; }
  };
  for (const model of [1, 2]) {
    const a = importeerIfcAnalyseModel(MN, { model }), b = importeerIfcAnalyseModel(MMKN, { model });
    vergelijk({ ...a, verslag: { ...a.verslag, toelichting: [] } }, { ...b, verslag: { ...b.verslag, toelichting: [] } }, "");
  }
  check("m/N en mm/kN (LINEARFORCEUNIT kN/m, PRESSUREUNIT kPa) geven hetzelfde model", grootste < 1e-12, `${grootste} bij ${waar}`);
  const t = importeerIfcAnalyseModel(MMKN, { model: 1 }).verslag.toelichting[0];
  check("het verslag noemt de eenheden van het bestand",
    t.includes("lengte mm, kracht kN, lijnlast kN/m (LINEARFORCEUNIT), vlaklast kPa (PRESSUREUNIT)"), t);
}

// ── [6] Model 2: plaatsingsketen en lijnlasten ───────────────────────────────
log("\n[6] Model 2 \"Luifel\": gedraaide plaatsing, geprojecteerde en lokale lijnlasten");
const luifel = importeerIfcAnalyseModel(MN, { model: 2 });
const m2 = luifel.model3d;
{
  check("knopen door SharedPlacement (20, 0, 0) en een 90° gedraaide, verschoven itemplaatsing heen",
    JSON.stringify(m2.nodes.map((n) => [n.name, n.x, n.y, n.z])) === JSON.stringify([["P1", 0, 0, 0], ["P2", 0, 0, 3], ["P3", 3, 0, 2.5]]),
    JSON.stringify(m2.nodes));
  const [kolom, ligger] = m2.beams;
  check("de Axis draait mee: kolom met rol 0 (e_z = +X), buis CHS 88.9x4 op afmetingen, S355",
    (kolom.rollAngleRad ?? 0) === 0 && kolom.profileName === "HEA 160" && ligger.profileName === "CHS 88.9x4" && ligger.material === "S355");
  const L = Math.sqrt(9.25), cos = 3 / L, sin = 0.5 / L;
  const last = (caseId, beamId) => m2.memberLoads.find((l) => l.caseId === caseId && l.beamId === beamId);
  // G per geprojecteerde lengte: q_waar,z = −2 · cos α; lokaal qz = q_waar,z · e_z,z = −2 cos²α.
  check("G per geprojecteerde lengte: qz = −2 · cos²α = −1,9459 kN/m", dicht(last(1, 2).qzStart, -2 * cos * cos, 1e-12), String(last(1, 2).qzStart));
  check("S per ware lengte: qz = −0,8 · cos α", dicht(last(2, 2).qzStart, -0.8 * cos, 1e-12));
  check("W lokaal z op de kolom: qz = 0,5 (lokaal z = +X)", dicht(last(4, 1).qzStart, 0.5, 1e-12) && last(4, 1).qyStart === 0);
  const byId = new Map(m2.nodes.map((n) => [n.id, n]));
  const som = (caseId) => {
    const s = [0, 0, 0];
    for (const l of m2.loads.filter((x) => x.caseId === caseId)) { s[0] += l.fx; s[1] += l.fy; s[2] += l.fz; }
    for (const l of m2.memberLoads.filter((x) => x.caseId === caseId)) {
      const b = m2.beams.find((x) => x.id === l.beamId);
      const { ey, ez } = openFem3DMemberAxes(byId.get(b.startNodeId), byId.get(b.endNodeId), b.rollAngleRad ?? 0);
      const lengte = l.endPositionM - l.startPositionM;
      for (let k = 0; k < 3; k += 1) s[k] += (l.qyStart * ey[k] + l.qzStart * ez[k]) * lengte;
    }
    for (const l of m2.memberPointLoads.filter((x) => x.caseId === caseId)) {
      const b = m2.beams.find((x) => x.id === l.beamId);
      const { ey, ez } = openFem3DMemberAxes(byId.get(b.startNodeId), byId.get(b.endNodeId), b.rollAngleRad ?? 0);
      for (let k = 0; k < 3; k += 1) s[k] += l.py * ey[k] + l.pz * ez[k];
    }
    return s;
  };
  // De axiale component staat als knooplasten half-half op de uiteinden.
  check("Σ G = 2,0 · 3 m (projectie) = 6 kN omlaag, ook met het axiale deel op de knopen",
    dicht(som(1)[2], -6, 1e-12) && Math.abs(som(1)[0]) < 1e-12, JSON.stringify(som(1)));
  check("Σ S = 0,8 · √9,25 kN omlaag", dicht(som(2)[2], -0.8 * L, 1e-12));
  check("Σ Q = 5 (knoop P3) + 3 (op de ligger, midden) = 8 kN omlaag; de puntlast staat op L/2",
    dicht(som(3)[2], -8, 1e-12) && dicht(m2.memberPointLoads[0].positionM, L / 2, 1e-12) && dicht(m2.memberPointLoads[0].pz, -3 * cos, 1e-12));
  check("Σ W = 0,5 · 3 = 1,5 kN in +X", dicht(som(4)[0], 1.5, 1e-12));
  check("geen eigen gewicht zonder SelfWeightCoefficients; type BGT uit de naam",
    luifel.selfWeightCaseId === undefined && luifel.combinations[1].type === "sls" && luifel.combinations[0].type === "uls" &&
    ifcAnalyseProject(luifel).selfWeightEnabled === false);
  check("P1 op het level Begane grond", m2.nodes[0].levelId === "z-1" && m2.nodes[1].levelId === undefined);
  check("sin/cos van de helling kloppen met de geometrie", dicht(sin * sin + cos * cos, 1, 1e-15));
}

// ── [7] Wat niet ondersteund is, staat in het verslag ────────────────────────
log("\n[7] Afwijkingen: alles wat de import niet vertaalt, staat in het verslag");
{
  const afw = importeerIfcAnalyseModel(maakIfcAnalyseBestand({ afwijkingen: true }), { model: "Afwijkingen" });
  const v = afw.verslag;
  const alle = [...v.toelichting, ...v.waarschuwingen, ...v.nietOndersteund];
  const heeft = (lijst, ...delen) => lijst.some((regel) => delen.every((d) => regel.includes(d)));
  const verwacht = [
    [v.nietOndersteund, "niet-globaal assenstelsel", '"A4"'],
    [v.nietOndersteund, "CardinalPoint 1", '"X1"'],
    [v.nietOndersteund, "IfcLShapeProfileDef", '"X2"'],
    [v.nietOndersteund, 'Materiaal "C24"', '"X3"'],
    [v.nietOndersteund, "COMPRESSION_MEMBER", '"X4"'],
    [v.nietOndersteund, "IfcRelConnectsWithEccentricity", '"X1"'],
    [v.nietOndersteund, "Rotatieveer aan een staafeinde", '"X5" (begin)'],
    [v.nietOndersteund, "Translatievrijheid", '"X5" (eind)'],
    [v.waarschuwingen, "valt niet samen met het lokale stelsel", '"X6" (eind)'],
    [v.toelichting, "Liggende koker", '"X7"'],
    [v.nietOndersteund, "(SHELL) wordt niet als plaat geïmporteerd", '"Wand"'],
    [v.nietOndersteund, "Opening in een vlak", '"Vloer met sparing" (1 opening)'],
    [v.nietOndersteund, "IfcStructuralCurveConnection", '"Strookfundering"'],
    [v.nietOndersteund, "Coefficient 1,2", '"Afw G"'],
    [v.nietOndersteund, "(0; 0; −0,5)", '"Afw G"'],
    [v.nietOndersteund, "verloop LINEAR", '"Verlopend"'],
    [v.nietOndersteund, "LinearMoment", '"Met moment"'],
    [v.nietOndersteund, "Moment als puntlast", '"Puntmoment"'],
    [v.nietOndersteund, "PlanarForceX/Y", '"Schuine last"'],
    [v.waarschuwingen, "hellend vlak omgerekend", '"Hellend dak"'],
    [v.waarschuwingen, 'als "overig" ingelezen', '"Afw onbekend"'],
    [v.waarschuwingen, "als uiterste grenstoestand aangenomen", '"Afw combinatie"'],
    [v.waarschuwingen, "Knoop zonder staaf, vlak of last overgeslagen", '"A11"'],
    [v.toelichting, "op die tussenknopen geknipt", 'staaf "X8" (2 delen)'],
    [v.waarschuwingen, "Aansluiting op een knoop die niet op de staaf ligt; genegeerd", 'staaf "X8" bij knoop "A10"'],
  ];
  const ontbreekt = verwacht.filter(([lijst, ...delen]) => !heeft(lijst, ...delen)).map(([, ...d]) => d.join(" + "));
  check(`${verwacht.length} meldingen, elk met het onderdeel erbij`, ontbreekt.length === 0, `ontbreekt: ${ontbreekt.join(" | ")}\n${alle.join("\n")}`);
  const s = (naam) => afw.model3d.beams.find((b) => b.name === naam);
  check("zonder profiel of materiaal blijft de staaf staan; rekenen meldt het zelf",
    s("X2").profileName === undefined && s("X2").material === "S235" && s("X3").material === undefined && s("X3").profileName === "IPE 200");
  check("liggende koker: RHS 200x100x8 met een rol van 90°", s("X7").profileName === "RHS 200x100x8" && dicht(s("X7").rollAngleRad, Math.PI / 2, 1e-12));
  check("rotatieveer → star, translatievrijheid → star, vrije rotaties blijven vrij",
    JSON.stringify(s("X5").releases) === JSON.stringify({ myStart: false, myEnd: true, mzStart: true, mzEnd: true, torsionStart: false, torsionEnd: false }));
  check("30° gedraaid stelsel met alleen R_y vrij: 75 % langs lokaal y → My vrij, Mz vast",
    JSON.stringify(s("X6").releases) === JSON.stringify({ myStart: false, myEnd: true, mzStart: false, mzEnd: false, torsionStart: false, torsionEnd: false }));
  const p = afw.model3d.loadPanels;
  check("hellend vlak per ware lengte: q = 1/cos α = √17/4 per m² projectie", dicht(p[0].q, Math.sqrt(17) / 4, 1e-12) && p[0].direction === "gravity");
  check("wind loodrecht op de wand: richting normal, q = −0,8 (n = −Y)", p[1].direction === "normal" && dicht(p[1].q, -0.8, 1e-12));
  // A1–A10 en A12 blijven (A12 via de aansluiting op X8); de losse A11 gaat eruit.
  check("een losse knoop gaat eruit; de nummering sluit", afw.model3d.nodes.length === 11 && afw.model3d.nodes.every((n, i) => n.id === i + 1) &&
    !afw.model3d.nodes.some((n) => n.name === "A11"));
  check("SelfWeightCoefficients (0, 0, −0,5): geen automatisch eigen gewicht", afw.selfWeightCaseId === undefined);
  // X8 loopt in het bestand in één stuk van A3 naar A8 (4 m); A12 op 2 m hangt er via een aansluiting aan.
  const x8 = afw.model3d.beams.filter((b) => b.name === "X8");
  const a12 = afw.model3d.nodes.find((n) => n.name === "A12");
  check("X8 is op tussenknoop A12 geknipt: twee delen met hetzelfde profiel, opvolgend genummerd",
    x8.length === 2 && x8[0].endNodeId === a12.id && x8[1].startNodeId === a12.id && x8[1].id === x8[0].id + 1 &&
    x8.every((b) => b.profileName === "IPE 200" && b.material === "S235" && b.releases === undefined) &&
    afw.model3d.beams.every((b, i) => b.id === i + 1), JSON.stringify(x8));
  const x8Ids = x8.map((b) => b.id);
  const lijnX8 = afw.model3d.memberLoads.filter((l) => x8Ids.includes(l.beamId));
  const puntX8 = afw.model3d.memberPointLoads.filter((l) => x8Ids.includes(l.beamId));
  check("lijnlast −1,5 kN/m over beide delen [0; 2] m; puntlast −4 kN op 3 m → tweede deel op 1 m",
    lijnX8.length === 2 && lijnX8.every((l) => l.qzStart === -1.5 && l.qzEnd === -1.5 && l.startPositionM === 0 && dicht(l.endPositionM, 2, 1e-12)) &&
    puntX8.length === 1 && puntX8[0].beamId === x8Ids[1] && dicht(puntX8[0].positionM, 1, 1e-12) && puntX8[0].pz === -4,
    JSON.stringify({ lijnX8, puntX8 }));
}

// ── [8] De 3D-kern: reacties = lasten ────────────────────────────────────────
log("\n[8] 3D-kern: reacties heffen de lasten op");
{
  const solverBinary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
  const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH ?? fileURLToPath(new URL(`../src-tauri/target/debug/${solverBinary}`, import.meta.url));
  if (!existsSync(solverPath)) {
    check("3D-rekenkern aanwezig (bouw: cargo build -p open-fem-3d)", false, solverPath);
  } else {
    const reken = (request) => new Promise((resolve, reject) => {
      const child = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] });
      const uit = [], fout = [];
      child.stdout.on("data", (d) => uit.push(d));
      child.stderr.on("data", (d) => fout.push(d));
      child.on("error", reject);
      child.on("close", (code) => code !== 0
        ? reject(new Error(`3D-kern: exit ${code}; ${Buffer.concat(fout).toString().slice(0, 400)}`))
        : resolve(JSON.parse(Buffer.concat(uit).toString())));
      child.stdin.end(JSON.stringify(request));
    });
    // Model 1 zonder trek-alleen staven en schijven: die kent de kern in deze versie nog niet.
    const trek = new Set(m1.beams.filter((b) => b.tensionOnly).map((b) => b.id));
    const zonder = parseOpenFem3DModel({
      ...m1,
      beams: m1.beams.filter((b) => !trek.has(b.id)),
      loadPanels: m1.loadPanels.map(({ excludedBeamIds, ...p }) => {
        const rest = (excludedBeamIds ?? []).filter((id) => !trek.has(id));
        return rest.length > 0 ? { ...p, excludedBeamIds: rest } : p;
      }),
      diaphragms: undefined,
    });
    const rekenmodel = withOpenFem3DSelfWeight(zonder, 1);
    // Σ ρ·A·g·L van de overgebleven staven, met de doorsnede van de catalogus.
    let eigenGewicht = 0;
    const byId = new Map(zonder.nodes.map((n) => [n.id, n]));
    for (const b of zonder.beams) {
      const a = byId.get(b.startNodeId), e = byId.get(b.endNodeId);
      const d = resolveSection(b.material, b.profileName);
      eigenGewicht += dichtheidVanMateriaal(b.material) * (d.aBruto ?? d.A) * 1e-6 * G / 1000 * Math.hypot(e.x - a.x, e.y - a.y, e.z - a.z);
    }
    const verwacht = {
      1: [0, 0, eigenGewicht], 2: [0, 0, 105], 3: [0, 0, 75], 4: [-19.28, 0, -12], 5: [-0.75, 0, 0],
    };
    for (const [caseId, [rx, ry, rz]] of Object.entries(verwacht)) {
      const request = { ...buildOpenFem3DSolveRequest(rekenmodel, "linear", Number(caseId)), bucklingModes: 0 };
      const r = await reken(request);
      const som = r.reactions.reduce((t, x) => [t[0] + x.fx, t[1] + x.fy, t[2] + x.fz], [0, 0, 0]);
      const balans = openFem3DGlobalForceBalance(request, r);
      check(`hal, geval ${hal.loadCases[caseId - 1].name}: ΣR = (${rx.toFixed(3)}; ${ry}; ${rz.toFixed(3)}) kN, evenwicht`,
        dicht(som[0], rx, 1e-6) && dicht(som[1], ry, 1e-6) && dicht(som[2], rz, 1e-6) && balans.ok && r.equilibrium?.equilibriumOk,
        JSON.stringify(som));
    }
    // De factor −1 van de imperfectie in "BGT kar -X": Σ Fx = 0,6 · 19,28 − 0,75 = 10,818 kN.
    const combi = hal.combinations.find((c) => c.name === "BGT kar -X");
    const request = { ...buildOpenFem3DSolveRequest(rekenmodel, "linear", combi.factors), bucklingModes: 0 };
    const r = await reken(request);
    const som = r.reactions.reduce((t, x) => [t[0] + x.fx, t[1] + x.fy, t[2] + x.fz], [0, 0, 0]);
    check("hal, combinatie BGT kar -X: ΣRx = −(0,6 · 19,28 − 0,75) = −10,818 kN",
      dicht(som[0], -10.818, 1e-6) && dicht(som[2], eigenGewicht + 105 + 75 - 0.6 * 12, 1e-6), JSON.stringify(som));
    const verwachtLuifel = { 1: [0, 0, 6], 2: [0, 0, 0.8 * Math.sqrt(9.25)], 3: [0, 0, 8], 4: [-1.5, 0, 0] };
    for (const [caseId, [rx, ry, rz]] of Object.entries(verwachtLuifel)) {
      const req = { ...buildOpenFem3DSolveRequest(m2, "linear", Number(caseId)), bucklingModes: 0 };
      const uit = await reken(req);
      const s = uit.reactions.reduce((t, x) => [t[0] + x.fx, t[1] + x.fy, t[2] + x.fz], [0, 0, 0]);
      check(`luifel, geval ${luifel.loadCases[caseId - 1].name}: ΣR = (${rx}; ${ry}; ${rz.toFixed(4)}) kN, evenwicht`,
        dicht(s[0], rx, 1e-6) && dicht(s[1], ry, 1e-6) && dicht(s[2], rz, 1e-6) && openFem3DGlobalForceBalance(req, uit).ok,
        JSON.stringify(s));
    }
    // Doorgaande ligger: één IFC-staaf over twee velden van L = 4 m; het tussensteunpunt D2
    // hangt er alleen via een aansluiting aan. q = 2 kN/m over alles, P = 4 kN midden in het
    // tweede veld; steunpuntsmoment M_B = −qL²/8 − 3PL/32, dus
    // R1 = 3qL/8 − 3P/32 = 2,625, R2 = 5qL/4 + 11P/16 = 12,75 en R3 = 3qL/8 + 13P/32 = 4,625 kN.
    // Zonder knippen hing D2 los en droeg de ligger als één veld van 8 m (9 en 11 kN).
    const doorgaand = importeerIfcAnalyseModel(maakIfcAnalyseBestand({ doorgaand: true }), { model: "Doorgaande ligger" });
    const reqD = { ...buildOpenFem3DSolveRequest(doorgaand.model3d, "linear", 1), bucklingModes: 0 };
    const uitD = await reken(reqD);
    const reactie = (naam) => uitD.reactions.find((x) => x.nodeId === doorgaand.model3d.nodes.find((n) => n.name === naam)?.id)?.fz;
    check("doorgaande ligger, geknipt op D2: R = 2,625 / 12,75 / 4,625 kN, evenwicht",
      doorgaand.model3d.beams.length === 2 && dicht(reactie("D1"), 2.625, 1e-6) && dicht(reactie("D2"), 12.75, 1e-6) &&
      dicht(reactie("D3"), 4.625, 1e-6) && openFem3DGlobalForceBalance(reqD, uitD).ok,
      JSON.stringify(uitD.reactions));
  }
}

// ── [9] Vlaklasten met een eigen face; pendelstaven van een massieve rechthoek ──
// Model "Varianten" (alleen de importuitvoer: de kern op deze tak kent "Strip" nog niet).
log("\n[9] Varianten: vlaklasten met een eigen face, strips als pendelstaaf");
{
  const tekst = maakIfcAnalyseBestand({ varianten: true });
  const v = importeerIfcAnalyseModel(tekst, { model: "Varianten" });
  const m = v.model3d;
  const naamVan = new Map(m.nodes.map((n) => [n.id, n.name]));
  const geval = (naam) => v.loadCases.find((c) => c.name === naam).id;
  const panelen = m.loadPanels;
  check("de face gelijk aan het vlak (zonder tussenpunt, ander beginpunt) en dezelfde veelhoek als IfcPolyLoop " +
    "(beginpunt W3, andere draairichting, met tussenpunt, 0,5 mm afwijking, eigen plaatsing) geven elk een belastingvlak op het hele vlak",
    panelen.length === 2 &&
    panelen[0].caseId === geval("G vloer") && panelen[0].q === 2 && panelen[0].direction === "gravity" &&
    panelen[1].caseId === geval("Q vloer") && panelen[1].q === 3 && panelen[1].direction === "gravity" &&
    panelen.every((p) => p.nodeIds.map((id) => naamVan.get(id)).join(",") === "W5,W2,W3,W4,W1"),
    JSON.stringify(panelen));
  const byId = new Map(m.nodes.map((n) => [n.id, n]));
  const som = (p) => p.q * openFem3DLoadPanelGeometry(m, p, byId).projectedAreaM2;
  check("Σ q × oppervlak: 2 · 6 · 4 = 48 kN en 3 · 6 · 4 = 72 kN", dicht(som(panelen[0]), 48) && dicht(som(panelen[1]), 72),
    `${som(panelen[0])} ${som(panelen[1])}`);
  const omgezet = withOpenFem3DLoadPanels(m).model;
  const omgezetById = new Map(omgezet.nodes.map((n) => [n.id, n]));
  const verticaal = (caseId) => omgezet.memberLoads.filter((l) => l.caseId === caseId).reduce((s, l) => {
    const b = omgezet.beams.find((x) => x.id === l.beamId);
    const { ey, ez } = openFem3DMemberAxes(omgezetById.get(b.startNodeId), omgezetById.get(b.endNodeId), b.rollAngleRad ?? 0);
    return s + ((l.qyStart + l.qyEnd) / 2 * ey[2] + (l.qzStart + l.qzEnd) / 2 * ez[2]) * (l.endPositionM - l.startPositionM);
  }, 0) + omgezet.loads.filter((l) => l.caseId === caseId).reduce((s, l) => s + l.fz, 0);
  check("de afdracht naar de randliggers sluit: −48 en −72 kN verticaal",
    dicht(verticaal(geval("G vloer")), -48, 1e-6) && dicht(verticaal(geval("Q vloer")), -72, 1e-6),
    `${verticaal(geval("G vloer"))} ${verticaal(geval("Q vloer"))}`);
  const heeft = (lijst, ...delen) => lijst.some((regel) => delen.every((d) => regel.includes(d)));
  check("een kleinere face en een face met een opening die het vlak niet heeft: niet ondersteund, gemeld, geen belastingvlak",
    heeft(v.verslag.nietOndersteund, "Vlaklast op een deel van een vlak", '"Vlak deel" in geval "Q deel"', '"Vlak met gat" in geval "Q deel"') &&
    heeft(v.verslag.nietOndersteund, "Vlaklast met een eigen topologie zonder leesbare face", '"Vlak zonder face"') &&
    !panelen.some((p) => p.caseId === geval("Q deel")), v.verslag.nietOndersteund.join("\n"));

  const s = (naam) => m.beams.find((b) => b.name === naam);
  check("stalen rechthoek → \"Strip <b>x<t>\" met b de brede zijde: 80 × 10 (twee standen), 60 × 30, 40 × 10",
    s("SP1").profileName === "Strip 80x10" && s("SP2").profileName === "Strip 80x10" &&
    s("SP3").profileName === "Strip 60x30" && s("SP4").profileName === "Strip 40x10" &&
    s("SP1").material === "S235" && s("SP3").material === "S355",
    JSON.stringify(["SP1", "SP2", "SP3", "SP4"].map((n) => [s(n).profileName, s(n).material])));
  check("pendelstaaf van platte strip (t ≤ b/4, ook 40 × 10 op de grens) is trek-alleen; de gedrongen 60 × 30 niet",
    s("SP1").tensionOnly === true && s("SP2").tensionOnly === true && s("SP4").tensionOnly === true &&
    s("SP3").tensionOnly === undefined && v.verslag.trekAlleen === 3);
  check("de toelichting noemt de strips apart",
    heeft(v.verslag.toelichting, "Trek-alleen: 3 staven", "3 pendelstaven van platte strip (dikte ≤ ¼ breedte)", "2 pendelstaven met een ander profiel"),
    v.verslag.toelichting.join("\n"));
  // Aanname: de catalogus legt b (de brede zijde) langs lokaal z, zoals h van een koker.
  const ez = (naam) => {
    const b = s(naam);
    return openFem3DMemberAxes(byId.get(b.startNodeId), byId.get(b.endNodeId), b.rollAngleRad ?? 0).ez;
  };
  check("de brede zijde ligt langs lokaal z: SP1 (80 langs profiel-x) in het wandvlak, SP2 (80 langs profiel-y = Axis) loodrecht erop",
    Math.abs(ez("SP1")[1]) < 1e-9 && dicht(Math.abs(ez("SP2")[1]), 1, 1e-12) &&
    heeft(v.verslag.toelichting, "Strip met de brede zijde langs profiel-x", '"SP1"') && !heeft(v.verslag.toelichting, '"SP2"'),
    JSON.stringify([ez("SP1"), ez("SP2")]));
  check("een rechthoek van hout blijft zoals hij was: profieltype en materiaal niet ondersteund",
    s("SP5").profileName === undefined && s("SP5").material === undefined && s("SP5").tensionOnly === undefined &&
    heeft(v.verslag.nietOndersteund, "Profieltype IfcRectangleProfileDef", '"SP5"') && heeft(v.verslag.nietOndersteund, 'Materiaal "C24"', '"SP5"'));
  const mm = importeerIfcAnalyseModel(maakIfcAnalyseBestand({ eenheden: "mm-kN", varianten: true }), { model: "Varianten" });
  check("in mm en kN hetzelfde model", JSON.stringify(mm.model3d) === JSON.stringify(m));
}

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);

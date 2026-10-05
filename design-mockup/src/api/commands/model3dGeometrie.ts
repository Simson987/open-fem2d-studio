/**
 * API-commando's voor de geometrie van het 3D-model: knopen, staven, platen
 * en openingen. Elk commando is een dunne laag over een zuivere functie uit
 * `openFem3dModel.ts` — dezelfde regels als in de app. Lengtes in meters,
 * hoeken in graden (zoals in de app); het model zelf rekent in radialen.
 */
import { ApiFout } from "../register";
import { documentCommando, nietGevonden, nieuwElement, verdwenenIds } from "../commandoHulp";
import { metModel3d, model3dVan } from "../projectDocument";
import { eenVan, geheel, getal, id, jaNee, keuze, lijst, obj, ofNull, tekst } from "../schemaBouw";
import {
  addOpenFem3DBeam, addOpenFem3DNode, addOpenFem3DPlate, addOpenFem3DPlateOpening, flipOpenFem3DBeamLocalAxes, pinOpenFem3DBeamsToColumns,
  removeOpenFem3DBeam, removeOpenFem3DNode, removeOpenFem3DPlate, setOpenFem3DBeamBedding, setOpenFem3DBeamEndHinge, setOpenFem3DReleasePreset,
  splitOpenFem3DBeam, updateOpenFem3DBeam, updateOpenFem3DNode, updateOpenFem3DPlate,
  type OpenFem3DBeamBedding, type OpenFem3DBeamEnd, type OpenFem3DBeamPatch, type OpenFem3DEndReleases, type OpenFem3DModel, type OpenFem3DPlateBoundarySegment,
  type OpenFem3DPlateEdgeSupport, type OpenFem3DReleasePreset,
} from "../../components/openFem3d/openFem3dModel";

const RAD_PER_GRAAD = Math.PI / 180;

function vindKnoop(model: OpenFem3DModel, nodeId: number) {
  const node = model.nodes.find((item) => item.id === nodeId);
  if (!node) throw nietGevonden("3D-knoop", nodeId);
  return node;
}
function vindStaaf(model: OpenFem3DModel, beamId: number) {
  const beam = model.beams.find((item) => item.id === beamId);
  if (!beam) throw nietGevonden("3D-staaf", beamId);
  return beam;
}
function vindPlaat(model: OpenFem3DModel, plateId: number) {
  const plate = (model.plates ?? []).find((item) => item.id === plateId);
  if (!plate) throw nietGevonden("3D-plaat", plateId);
  return plate;
}

// ── Schemadelen ───────────────────────────────────────────────────────────

const coordinaat = (as: string) => getal(`${as}-coördinaat in m (globaal, z omhoog).`);
const knoopId = id("Id van een bestaande 3D-knoop.");
const scharnieren = obj({
  myStart: jaNee("Momentscharnier om de lokale y-as aan het begin."),
  myEnd: jaNee("Momentscharnier om de lokale y-as aan het eind."),
  mzStart: jaNee("Momentscharnier om de lokale z-as aan het begin."),
  mzEnd: jaNee("Momentscharnier om de lokale z-as aan het eind."),
  torsionStart: jaNee("Torsiescharnier aan het begin."),
  torsionEnd: jaNee("Torsiescharnier aan het eind."),
}, [], "Eindscharnieren in lokale assen; een ontbrekende vrijheidsgraad is vast.");
/** Staaf op bedding (#106): dezelfde velden als het model en het rekencontract. */
const bedding = obj({
  kKnPerM3: getal("Beddingsconstante k in kN/m³ voor de verticale richting (globaal Z; de grond ligt onder de staaf). Niet bij een (bijna) verticale staaf.", { exclusiveMinimum: 0 }),
  widthM: getal("Contactbreedte b in m; de lijnstijfheid is k·b (kN/m per m).", { exclusiveMinimum: 0 }),
  kLateralKnPerM3: getal("Zijdelingse beddingsconstante in kN/m³: horizontaal loodrecht op de staafas, naar beide zijden, altijd lineair. Bij een staaf steiler dan 45° (een (schoor)paal) rondom, in twee richtingen loodrecht op de as; bij een loodrechte paal in X en Y.", { exclusiveMinimum: 0 }),
  compressionOnly: jaNee("Alleen druk: de verticale veren vallen weg waar de staaf omhoog komt (de grond trekt niet)."),
}, ["widthM"], "Staaf op bedding (Winkler): de grond steunt de staaf over haar hele lengte; de rekenkern knipt de staaf fijn genoeg. Geef kKnPerM3, kLateralKnPerM3 of beide.");
const staafVelden = {
  profileName: tekst("Profielnaam uit de bibliotheek, bijv. \"IPE 200\", \"HEA 300\", \"CHS 88.9x4\", \"Strip 80x10\".", { minLength: 1 }),
  material: tekst("Materiaal, bijv. \"S235\", \"S355\", \"C24\", \"C30/37\".", { minLength: 1 }),
  rollAngleDeg: getal("Rotatie van de lokale y/z-assen om de staafas, in graden."),
  releases: scharnieren,
  tensionOnly: jaNee("Trek-alleen staaf (bijv. een windverband): valt weg zolang hij op druk staat."),
  bedding,
  name: tekst("Naam van de staaf (alleen weergave en rapport)."),
  group: tekst("Groep, bijv. \"kolom\", \"spantligger\", \"windverband\"."),
};
const randSegment = eenVan([
  obj({ kind: { const: "line" }, startNodeId: knoopId, endNodeId: knoopId }, ["kind", "startNodeId", "endNodeId"], "Recht randstuk."),
  obj({ kind: { const: "arc" }, startNodeId: knoopId, controlNodeId: knoopId, endNodeId: knoopId },
    ["kind", "startNodeId", "controlNodeId", "endNodeId"], "Boog door begin-, stuur- en eindknoop."),
]);
const contour = (wat: string) => lijst(knoopId, `Knoopvolgorde rond ${wat}; alle knopen in één vlak.`, { minItems: 3 });

// ── Invoertypen ───────────────────────────────────────────────────────────

interface StaafVeldenInvoer {
  profileName?: string; material?: string; rollAngleDeg?: number; releases?: Partial<OpenFem3DEndReleases>;
  tensionOnly?: boolean; bedding?: OpenFem3DBeamBedding; name?: string; group?: string;
}
type Wisbaar<T> = { [K in keyof T]?: T[K] | null };

function naarPatch(invoer: Wisbaar<StaafVeldenInvoer> & { startNodeId?: number; endNodeId?: number }): OpenFem3DBeamPatch {
  const { rollAngleDeg, tensionOnly, ...rest } = invoer;
  return {
    ...rest,
    ...(rollAngleDeg !== undefined ? { rollAngleRad: rollAngleDeg === null ? null : rollAngleDeg * RAD_PER_GRAAD } : {}),
    ...(tensionOnly !== undefined && tensionOnly !== null ? { tensionOnly } : {}),
  } as OpenFem3DBeamPatch;
}

// ── Commando's ────────────────────────────────────────────────────────────

const modelLezen = documentCommando<Record<string, never>, unknown>({
  naam: "model3d.get",
  beschrijving: "Het 3D-model lezen: knopen, staven, platen, opleggingen, lasten, belastingvlakken en schijven, met de aantallen.",
  invoer: obj({}),
  uitvoeren: (_invoer, document) => {
    const model = model3dVan(document);
    return {
      uitkomst: {
        counts: {
          nodes: model.nodes.length, beams: model.beams.length, plates: (model.plates ?? []).length,
          supports: (model.supports ?? []).length,
          loads: (model.loads ?? []).length + (model.memberLoads ?? []).length + (model.memberPointLoads ?? []).length
            + (model.thermalLoads ?? []).length + (model.surfaceLoads ?? []).length,
          loadPanels: (model.loadPanels ?? []).length, diaphragms: (model.diaphragms ?? []).length,
        },
        model,
      },
    };
  },
});

const knoopToevoegen = documentCommando<{ x: number; y: number; z: number; name?: string }, unknown>({
  naam: "model3d.node.add",
  beschrijving: "Een 3D-knoop toevoegen. Op de plek van een bestaande knoop wordt geweigerd.",
  invoer: obj({ x: coordinaat("x"), y: coordinaat("y"), z: coordinaat("z"), name: tekst("Naam van de knoop.") }, ["x", "y", "z"]),
  uitvoeren: (invoer, document) => {
    const { model, node } = addOpenFem3DNode(model3dVan(document), invoer);
    return { uitkomst: { node }, document: metModel3d(document, model) };
  },
});

const knoopWijzigen = documentCommando<{ id: number; x?: number; y?: number; z?: number; name?: string | null }, unknown>({
  naam: "model3d.node.update",
  beschrijving: "Een 3D-knoop verplaatsen of hernoemen. Staven, platen, opleggingen en lasten blijven eraan hangen.",
  invoer: obj({
    id: knoopId, x: coordinaat("x"), y: coordinaat("y"), z: coordinaat("z"),
    name: ofNull(tekst(), "Nieuwe naam; null wist de naam."),
  }, ["id"]),
  uitvoeren: ({ id: nodeId, ...patch }, document) => {
    const huidig = model3dVan(document);
    vindKnoop(huidig, nodeId);
    const model = updateOpenFem3DNode(huidig, nodeId, patch);
    return { uitkomst: { node: vindKnoop(model, nodeId) }, document: metModel3d(document, model) };
  },
});

const knoopVerwijderen = documentCommando<{ id: number }, unknown>({
  naam: "model3d.node.delete",
  beschrijving: "Een 3D-knoop verwijderen, met de staven en platen die eraan hangen en hun lasten.",
  invoer: obj({ id: knoopId }, ["id"]),
  uitvoeren: ({ id: nodeId }, document) => {
    const huidig = model3dVan(document);
    vindKnoop(huidig, nodeId);
    const model = removeOpenFem3DNode(huidig, nodeId);
    return {
      uitkomst: {
        deletedNodeId: nodeId,
        removedBeamIds: verdwenenIds(huidig.beams, model.beams),
        removedPlateIds: verdwenenIds(huidig.plates, model.plates),
      },
      document: metModel3d(document, model),
    };
  },
});

const staafToevoegen = documentCommando<{ startNodeId: number; endNodeId: number } & StaafVeldenInvoer, unknown>({
  naam: "model3d.beam.add",
  beschrijving: "Een 3D-staaf tussen twee bestaande knopen toevoegen. Zonder profiel en materiaal: IPE 200 in S235, net als het tekengereedschap.",
  invoer: obj({ startNodeId: knoopId, endNodeId: knoopId, ...staafVelden }, ["startNodeId", "endNodeId"]),
  uitvoeren: ({ rollAngleDeg, ...rest }, document) => {
    const { model, beam } = addOpenFem3DBeam(model3dVan(document), {
      ...rest, ...(rollAngleDeg !== undefined ? { rollAngleRad: rollAngleDeg * RAD_PER_GRAAD } : {}),
    });
    return { uitkomst: { beam }, document: metModel3d(document, model) };
  },
});

const staafWijzigen = documentCommando<{ id: number; startNodeId?: number; endNodeId?: number } & Wisbaar<StaafVeldenInvoer>, unknown>({
  naam: "model3d.beam.update",
  beschrijving: "Eigenschappen of knopen van een 3D-staaf wijzigen. null wist een optioneel veld; lasten en toetsinstellingen blijven.",
  invoer: obj({
    id: id("Id van de staaf."),
    startNodeId: knoopId, endNodeId: knoopId,
    profileName: ofNull(staafVelden.profileName), material: ofNull(staafVelden.material),
    rollAngleDeg: ofNull(staafVelden.rollAngleDeg), releases: ofNull(scharnieren),
    tensionOnly: staafVelden.tensionOnly, bedding: ofNull(bedding, "Staaf op bedding; null haalt de bedding weg."),
    name: ofNull(staafVelden.name), group: ofNull(staafVelden.group),
  }, ["id"]),
  uitvoeren: ({ id: beamId, ...rest }, document) => {
    const huidig = model3dVan(document);
    vindStaaf(huidig, beamId);
    const model = updateOpenFem3DBeam(huidig, beamId, naarPatch(rest));
    return { uitkomst: { beam: vindStaaf(model, beamId) }, document: metModel3d(document, model) };
  },
});

const staafBedding = documentCommando<{ beamIds: number[]; bedding: OpenFem3DBeamBedding | null }, unknown>({
  naam: "model3d.beam.setBedding",
  beschrijving: "Eén of meer 3D-staven op dezelfde bedding zetten (Winkler, zoals het vinkje Op bedding in het eigenschappenpaneel), of de bedding weghalen met null. Eén stap ongedaan maken. Een (bijna) verticale staaf krijgt alleen een zijdelingse bedding (kLateralKnPerM3); een verticale k wordt dan geweigerd.",
  invoer: obj({
    beamIds: lijst(id("Id van een staaf."), "De staven.", { minItems: 1 }),
    bedding: ofNull(bedding, "De bedding voor alle genoemde staven; null haalt haar weg."),
  }, ["beamIds", "bedding"]),
  uitvoeren: ({ beamIds, bedding: nieuw }, document) => {
    const huidig = model3dVan(document);
    const ids = [...new Set(beamIds)];
    for (const beamId of ids) vindStaaf(huidig, beamId);
    const model = setOpenFem3DBeamBedding(huidig, ids, nieuw);
    return {
      uitkomst: { beamIds: ids, bedding: ids.map((beamId) => ({ beamId, bedding: vindStaaf(model, beamId).bedding ?? null })) },
      document: metModel3d(document, model),
    };
  },
});

const staafVerwijderen = documentCommando<{ id: number }, unknown>({
  naam: "model3d.beam.delete",
  beschrijving: "Een 3D-staaf verwijderen, met zijn lasten. De knopen blijven.",
  invoer: obj({ id: id("Id van de staaf.") }, ["id"]),
  uitvoeren: ({ id: beamId }, document) => {
    const huidig = model3dVan(document);
    vindStaaf(huidig, beamId);
    return { uitkomst: { deletedBeamId: beamId }, document: metModel3d(document, removeOpenFem3DBeam(huidig, beamId)) };
  },
});

const staafSplitsen = documentCommando<{ id: number; fraction?: number; positionM?: number }, unknown>({
  naam: "model3d.beam.split",
  beschrijving: "Een 3D-staaf in twee delen splitsen met een nieuwe tussenknoop. Geef fraction (0–1) óf positionM (m vanaf het begin).",
  invoer: obj({
    id: id("Id van de staaf."),
    fraction: getal("Plaats als deel van de lengte, strikt tussen 0 en 1.", { exclusiveMinimum: 0, maximum: 1 }),
    positionM: getal("Plaats in m vanaf de beginknoop.", { exclusiveMinimum: 0 }),
  }, ["id"]),
  uitvoeren: ({ id: beamId, fraction, positionM }, document) => {
    const huidig = model3dVan(document);
    const beam = vindStaaf(huidig, beamId);
    if ((fraction === undefined) === (positionM === undefined)) {
      throw new ApiFout("INVOER_ONGELDIG", "Geef precies één van fraction en positionM.");
    }
    let ratio = fraction;
    if (positionM !== undefined) {
      const a = vindKnoop(huidig, beam.startNodeId), b = vindKnoop(huidig, beam.endNodeId);
      const lengte = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      ratio = positionM / lengte;
      if (ratio >= 1) throw new ApiFout("GEWEIGERD", `De staaf is ${lengte.toFixed(3)} m lang; ${positionM} m ligt er niet binnen.`);
    }
    if (ratio! >= 1) throw new ApiFout("GEWEIGERD", "fraction moet kleiner zijn dan 1.");
    const resultaat = splitOpenFem3DBeam(huidig, beamId, ratio!);
    return {
      uitkomst: { nodeId: resultaat.nodeId, firstBeamId: resultaat.firstBeamId, secondBeamId: resultaat.secondBeamId },
      document: metModel3d(document, resultaat.model),
    };
  },
});

const assenOmkeren = documentCommando<{ id: number }, unknown>({
  naam: "model3d.beam.flipLocalAxes",
  beschrijving: "De lokale dwarsassen van een 3D-staaf omkeren (profielrotatie + 180°), zoals de knop in het eigenschappenpaneel. De lokale componenten van de staaf-, puntlasten en temperatuurgradiënten draaien mee, zodat hun richting in het wereldstelsel gelijk blijft.",
  invoer: obj({ id: id("Id van de staaf.") }, ["id"]),
  uitvoeren: ({ id: beamId }, document) => {
    const huidig = model3dVan(document);
    vindStaaf(huidig, beamId);
    const model = flipOpenFem3DBeamLocalAxes(huidig, beamId);
    return { uitkomst: { beam: model.beams.find((item) => item.id === beamId) }, document: metModel3d(document, model) };
  },
});

const scharnierSituatie = documentCommando<{ beamIds: number[]; preset: OpenFem3DReleasePreset }, unknown>({
  naam: "model3d.beam.setReleasePreset",
  beschrijving: "Eén of meer 3D-staven een standaardsituatie voor hun eindscharnieren geven, zoals de knoppen Momentvast en Scharnierend in het eigenschappenpaneel. rigid (momentvast): geen scharnieren. pinned (scharnierend): My en Mz los aan beide einden; torsie gaat over, anders draait de staaf vrij om zijn as. Een losse combinatie zet je met model3d.beam.update (releases).",
  invoer: obj({
    beamIds: lijst(id("Id van een staaf."), "De staven.", { minItems: 1 }),
    preset: keuze(["rigid", "pinned"], "rigid (momentvast) of pinned (scharnierend)."),
  }, ["beamIds", "preset"]),
  uitvoeren: ({ beamIds, preset }, document) => {
    const huidig = model3dVan(document);
    const ids = [...new Set(beamIds)];
    for (const beamId of ids) vindStaaf(huidig, beamId);
    const model = setOpenFem3DReleasePreset(huidig, ids, preset);
    return { uitkomst: { beamIds: ids, preset }, document: metModel3d(document, model) };
  },
});

const staafeindScharnier = documentCommando<{ beamId: number; end: OpenFem3DBeamEnd; hinged?: boolean }, unknown>({
  naam: "model3d.beam.setEndHinge",
  beschrijving: "Eén eind van een 3D-staaf scharnierend maken of weer vast, zoals het gereedschap Scharnier aan staafeind: My en Mz aan dat eind samen los (hinged true) of vast (false); torsie blijft zoals hij is. Zonder hinged wisselt het, zoals een klik: stonden My en Mz daar allebei los, dan gaan ze vast, anders allebei los. Zonder losse vrijheidsgraad verdwijnt het scharnierveld (momentvast). Een losse combinatie (bijv. alleen My) zet je met model3d.beam.update (releases).",
  invoer: obj({
    beamId: id("Id van de staaf."),
    end: keuze(["start", "end"], "start: het eind bij startNodeId; end: het eind bij endNodeId."),
    hinged: jaNee("true: My en Mz los; false: vast; weglaten: wisselen."),
  }, ["beamId", "end"]),
  uitvoeren: ({ beamId, end, hinged }, document) => {
    const huidig = model3dVan(document);
    vindStaaf(huidig, beamId);
    const resultaat = setOpenFem3DBeamEndHinge(huidig, beamId, end, hinged);
    const beam = resultaat.model.beams.find((item) => item.id === beamId)!;
    return {
      uitkomst: { beamId, end, hinged: resultaat.hinged, releases: beam.releases ?? null },
      document: metModel3d(document, resultaat.model),
    };
  },
});

const liggersOpKolommen = documentCommando<{ beamIds?: number[] }, unknown>({
  naam: "model3d.beam.pinToColumns",
  beschrijving: "Liggers scharnierend op kolommen aansluiten, zoals de knop in het lint: elk eind van een ligger (een staaf die niet bijna verticaal staat; een schuine spant telt mee) op een kolomkop krijgt My en Mz los. Een kolomkop is het bovenste eind van een kolom (|ex·Z| > 0,95) die naar beneden op een oplegging of veer steunt; het onderste eind telt niet, dus een balkrooster onder een kolomvoet of poer en een ligger waar een kolom op staat, blijven doorgaand. Kolommen blijven doorgaand; torsie blijft zoals hij is. Een eind blijft momentvast als het deel achter de ligger anders zou gaan draaien: reason cantilever (het hangt alleen aan die kolomkop, zoals een uitkraging of luifel) of hingeLine (het hangt alleen aan scharnieren op één lijn zonder staaf langs die lijn). Zonder beamIds alle staven, anders alleen de genoemde (een kolom ertussen wordt overgeslagen). Geeft de staafeinden die veranderden (changed, count) en die momentvast bleven (skipped); een eind dat al scharnierend was, telt niet mee.",
  invoer: obj({
    beamIds: lijst(id("Id van een staaf."), "Alleen deze staven; weglaten = alle staven.", { minItems: 1 }),
  }, []),
  uitvoeren: ({ beamIds }, document) => {
    const huidig = model3dVan(document);
    const ids = beamIds === undefined ? undefined : [...new Set(beamIds)];
    for (const beamId of ids ?? []) vindStaaf(huidig, beamId);
    const resultaat = pinOpenFem3DBeamsToColumns(huidig, ids);
    return {
      uitkomst: { changed: resultaat.changed, count: resultaat.changed.length, skipped: resultaat.skipped },
      document: metModel3d(document, resultaat.model),
    };
  },
});

const plaatToevoegen = documentCommando<{
  nodeIds: number[]; thicknessM: number; material?: string; cornerRadiusM?: number; boundary?: OpenFem3DPlateBoundarySegment[];
}, unknown>({
  naam: "model3d.plate.add",
  beschrijving: "Een vlakke 3D-plaat (schaalelementen) toevoegen op bestaande knopen in één vlak.",
  invoer: obj({
    nodeIds: contour("de plaat"),
    thicknessM: getal("Dikte in m.", { exclusiveMinimum: 0 }),
    material: tekst("Materiaal, bijv. \"C30/37\".", { minLength: 1 }),
    cornerRadiusM: getal("Afrondingsstraal van de hoeken in m.", { minimum: 0 }),
    boundary: lijst(randSegment, "Getekende contour met rechte stukken en bogen; ontbreekt = rechte randen tussen nodeIds."),
  }, ["nodeIds", "thicknessM"]),
  uitvoeren: ({ nodeIds, ...opties }, document) => {
    const huidig = model3dVan(document);
    const model = addOpenFem3DPlate(huidig, nodeIds, opties);
    return { uitkomst: { plate: nieuwElement(huidig.plates, model.plates) }, document: metModel3d(document, model) };
  },
});

const plaatWijzigen = documentCommando<{
  id: number; thicknessM?: number; material?: string; cornerRadiusM?: number; meshSizeM?: number; edgeSupports?: OpenFem3DPlateEdgeSupport[];
}, unknown>({
  naam: "model3d.plate.update",
  beschrijving: "Dikte, materiaal, afronding, netgrootte of randopleggingen van een 3D-plaat wijzigen.",
  invoer: obj({
    id: id("Id van de plaat."),
    thicknessM: getal("Dikte in m.", { exclusiveMinimum: 0 }),
    material: tekst("Materiaal.", { minLength: 1 }),
    cornerRadiusM: getal("Afrondingsstraal van de hoeken in m.", { minimum: 0 }),
    meshSizeM: getal("Gewenste elementgrootte in m.", { exclusiveMinimum: 0 }),
    edgeSupports: lijst(obj({
      edge: geheel("Rand k: randstuk k van de contour (vanaf 0).", { minimum: 0 }),
      ux: jaNee(), uy: jaNee(), uz: jaNee(), rx: jaNee(), ry: jaNee(), rz: jaNee(),
    }, ["edge", "ux", "uy", "uz", "rx", "ry", "rz"], "Lijnoplegging langs één rand; true = verhinderd."),
    "Randopleggingen; vervangt de bestaande lijst."),
  }, ["id"]),
  uitvoeren: ({ id: plateId, ...patch }, document) => {
    const huidig = model3dVan(document);
    vindPlaat(huidig, plateId);
    const model = updateOpenFem3DPlate(huidig, plateId, patch);
    return { uitkomst: { plate: vindPlaat(model, plateId) }, document: metModel3d(document, model) };
  },
});

const plaatVerwijderen = documentCommando<{ id: number }, unknown>({
  naam: "model3d.plate.delete",
  beschrijving: "Een 3D-plaat verwijderen, met haar openingen en oppervlaktelasten. De knopen blijven.",
  invoer: obj({ id: id("Id van de plaat.") }, ["id"]),
  uitvoeren: ({ id: plateId }, document) => {
    const huidig = model3dVan(document);
    vindPlaat(huidig, plateId);
    return { uitkomst: { deletedPlateId: plateId }, document: metModel3d(document, removeOpenFem3DPlate(huidig, plateId)) };
  },
});

const openingToevoegen = documentCommando<{
  plateId: number; nodeIds: number[]; cornerRadiusM?: number; boundary?: OpenFem3DPlateBoundarySegment[];
}, unknown>({
  naam: "model3d.plate.addOpening",
  beschrijving: "Een opening in een 3D-plaat maken, op bestaande knopen binnen de plaat.",
  invoer: obj({
    plateId: id("Id van de plaat."),
    nodeIds: contour("de opening"),
    cornerRadiusM: getal("Afrondingsstraal van de hoeken in m.", { minimum: 0 }),
    boundary: lijst(randSegment, "Getekende contour van de opening; ontbreekt = rechte randen."),
  }, ["plateId", "nodeIds"]),
  uitvoeren: ({ plateId, nodeIds, ...opties }, document) => {
    const huidig = model3dVan(document);
    const voor = vindPlaat(huidig, plateId);
    const model = addOpenFem3DPlateOpening(huidig, plateId, nodeIds, opties);
    const na = vindPlaat(model, plateId);
    return { uitkomst: { plateId, opening: nieuwElement(voor.openings, na.openings) }, document: metModel3d(document, model) };
  },
});

export const MODEL3D_GEOMETRIE_COMMANDOS = [
  modelLezen, knoopToevoegen, knoopWijzigen, knoopVerwijderen,
  staafToevoegen, staafWijzigen, staafBedding, staafVerwijderen, staafSplitsen, assenOmkeren, scharnierSituatie, staafeindScharnier,
  liggersOpKolommen,
  plaatToevoegen, plaatWijzigen, plaatVerwijderen, openingToevoegen,
];

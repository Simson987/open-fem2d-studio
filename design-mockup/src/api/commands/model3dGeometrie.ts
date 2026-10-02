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
  addOpenFem3DBeam, addOpenFem3DNode, addOpenFem3DPlate, addOpenFem3DPlateOpening, flipOpenFem3DBeamLocalAxes, removeOpenFem3DBeam,
  removeOpenFem3DNode, removeOpenFem3DPlate, setOpenFem3DReleasePreset, splitOpenFem3DBeam, updateOpenFem3DBeam, updateOpenFem3DNode,
  updateOpenFem3DPlate,
  type OpenFem3DBeamPatch, type OpenFem3DEndReleases, type OpenFem3DModel, type OpenFem3DPlateBoundarySegment,
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
const staafVelden = {
  profileName: tekst("Profielnaam uit de bibliotheek, bijv. \"IPE 200\", \"HEA 300\", \"CHS 88.9x4\", \"Strip 80x10\".", { minLength: 1 }),
  material: tekst("Materiaal, bijv. \"S235\", \"S355\", \"C24\", \"C30/37\".", { minLength: 1 }),
  rollAngleDeg: getal("Rotatie van de lokale y/z-assen om de staafas, in graden."),
  releases: scharnieren,
  tensionOnly: jaNee("Trek-alleen staaf (bijv. een windverband): valt weg zolang hij op druk staat."),
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
  tensionOnly?: boolean; name?: string; group?: string;
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
    tensionOnly: staafVelden.tensionOnly, name: ofNull(staafVelden.name), group: ofNull(staafVelden.group),
  }, ["id"]),
  uitvoeren: ({ id: beamId, ...rest }, document) => {
    const huidig = model3dVan(document);
    vindStaaf(huidig, beamId);
    const model = updateOpenFem3DBeam(huidig, beamId, naarPatch(rest));
    return { uitkomst: { beam: vindStaaf(model, beamId) }, document: metModel3d(document, model) };
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
  staafToevoegen, staafWijzigen, staafVerwijderen, staafSplitsen, assenOmkeren, scharnierSituatie,
  plaatToevoegen, plaatWijzigen, plaatVerwijderen, openingToevoegen,
];

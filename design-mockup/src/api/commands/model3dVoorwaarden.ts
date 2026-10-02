/**
 * API-commando's voor de randvoorwaarden en belastingen van het 3D-model:
 * opleggingen (vast, veren, opgelegde verplaatsing), knoop-, staaf-,
 * staafpunt-, temperatuur- en oppervlaktelasten, belastingvlakken, schijven
 * en de trek-alleen-instellingen. Dunne lagen over de zuivere functies van
 * de app; dezelfde regels.
 *
 * Een last zonder `caseId` komt in het actieve belastinggeval van het
 * project, net als bij het tekengereedschap. Een onbekend geval is
 * NIET_GEVONDEN. Krachten in kN, momenten in kNm, lijnlasten in kN/m,
 * vlaklasten in kN/m², lengtes in m, temperatuurverschillen in K.
 */
import { ApiFout } from "../register";
import { documentCommando, nietGevonden, nieuwElement } from "../commandoHulp";
import { metModel3d, model3dVan, type ApiDocument } from "../projectDocument";
import { getal, id, jaNee, keuze, lijst, obj, ofNull, tekst } from "../schemaBouw";
import {
  OPEN_FEM_3D_SUPPORT_PRESETS,
  addOpenFem3DMemberLoad, addOpenFem3DMemberPointLoad, addOpenFem3DNodalLoad, addOpenFem3DSurfaceLoad,
  addOpenFem3DThermalLoad, removeOpenFem3DLoadPanel, removeOpenFem3DMemberLoad, removeOpenFem3DMemberPointLoad,
  removeOpenFem3DNodalLoad, removeOpenFem3DSupport, removeOpenFem3DSurfaceLoad, removeOpenFem3DThermalLoad,
  setOpenFem3DSupport, setOpenFem3DSupportPrescribed, setOpenFem3DSupportSprings, updateOpenFem3DMemberLoad,
  updateOpenFem3DMemberPointLoad, updateOpenFem3DNodalLoad, updateOpenFem3DSurfaceLoad, updateOpenFem3DThermalLoad,
  type OpenFem3DModel, type OpenFem3DPrescribedDisplacements, type OpenFem3DSupportPreset,
  type OpenFem3DSupportRestraints, type OpenFem3DSupportSprings, type OpenFem3DVector,
} from "../../components/openFem3d/openFem3dModel";
import {
  addOpenFem3DLoadPanel, convertOpenFem3DPlateToLoadPanels, duplicateOpenFem3DLoadPanel, updateOpenFem3DLoadPanel,
  type OpenFem3DLoadPanelOptions, type OpenFem3DLoadPanelPatch,
} from "../../components/openFem3d/openFem3dLoadPanels";
import {
  addOpenFem3DDiaphragm, removeOpenFem3DDiaphragm, setOpenFem3DTensionOnly, setOpenFem3DTensionOnlySetting,
  type OpenFem3DDiaphragmRefusal,
} from "../../components/openFem3d/openFem3dTrekSchijf";

// ── Hulp ──────────────────────────────────────────────────────────────────

function vindKnoop(model: OpenFem3DModel, nodeId: number) {
  if (!model.nodes.some((node) => node.id === nodeId)) throw nietGevonden("3D-knoop", nodeId, "nodeId");
}
function vindStaaf(model: OpenFem3DModel, beamId: number) {
  const beam = model.beams.find((item) => item.id === beamId);
  if (!beam) throw nietGevonden("3D-staaf", beamId, "beamId");
  return beam;
}
function vindIn<T extends { id: number }>(lijstje: readonly T[] | undefined, soort: string, itemId: number): T {
  const item = (lijstje ?? []).find((x) => x.id === itemId);
  if (!item) throw nietGevonden(soort, itemId);
  return item;
}
/** Het belastinggeval van een nieuwe last: opgegeven en bestaand, of het actieve geval. */
function geval(document: ApiDocument, caseId: number | undefined): number {
  const gekozen = caseId ?? document.activeLoadCaseId;
  if (!document.loadCases.some((lc) => lc.id === gekozen)) throw nietGevonden("Belastinggeval", gekozen, "caseId");
  return gekozen;
}
function staafLengte(model: OpenFem3DModel, beamId: number): number {
  const beam = vindStaaf(model, beamId);
  const a = model.nodes.find((n) => n.id === beam.startNodeId)!, b = model.nodes.find((n) => n.id === beam.endNodeId)!;
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}
const met = (document: ApiDocument, model: OpenFem3DModel) => metModel3d(document, model);

// ── Schemadelen ───────────────────────────────────────────────────────────

const knoopId = id("Id van een bestaande 3D-knoop.");
const staafId = id("Id van een bestaande 3D-staaf.");
const gevalId = id("Belastinggeval; ontbreekt = het actieve geval van het project.");
const vrijheidsgraden = {
  ux: jaNee("Verplaatsing in X verhinderd."), uy: jaNee("Verplaatsing in Y verhinderd."), uz: jaNee("Verplaatsing in Z verhinderd."),
  rx: jaNee("Rotatie om X verhinderd."), ry: jaNee("Rotatie om Y verhinderd."), rz: jaNee("Rotatie om Z verhinderd."),
};
const veren = {
  kxKnPerM: getal("Veer in X, kN/m.", { exclusiveMinimum: 0 }), kyKnPerM: getal("Veer in Y, kN/m.", { exclusiveMinimum: 0 }),
  kzKnPerM: getal("Veer in Z, kN/m.", { exclusiveMinimum: 0 }),
  krxKnmPerRad: getal("Rotatieveer om X, kNm/rad.", { exclusiveMinimum: 0 }),
  kryKnmPerRad: getal("Rotatieveer om Y, kNm/rad.", { exclusiveMinimum: 0 }),
  krzKnmPerRad: getal("Rotatieveer om Z, kNm/rad.", { exclusiveMinimum: 0 }),
};
const opgelegd = {
  uxM: getal("Opgelegde verplaatsing in X, m."), uyM: getal("Opgelegde verplaatsing in Y, m."), uzM: getal("Opgelegde verplaatsing in Z, m."),
  rxRad: getal("Opgelegde rotatie om X, rad."), ryRad: getal("Opgelegde rotatie om Y, rad."), rzRad: getal("Opgelegde rotatie om Z, rad."),
};
const knoopLastVelden = {
  fx: getal("Kracht in X, kN."), fy: getal("Kracht in Y, kN."), fz: getal("Kracht in Z, kN (negatief = omlaag)."),
  mx: getal("Moment om X, kNm."), my: getal("Moment om Y, kNm."), mz: getal("Moment om Z, kNm."),
};
const lijnLastVelden = {
  qyStart: getal("Lijnlast in lokale y aan het begin, kN/m."), qyEnd: getal("Lijnlast in lokale y aan het eind, kN/m."),
  qzStart: getal("Lijnlast in lokale z aan het begin, kN/m."), qzEnd: getal("Lijnlast in lokale z aan het eind, kN/m."),
  startPositionM: getal("Begin van de last in m vanaf de beginknoop; ontbreekt = 0.", { minimum: 0 }),
  endPositionM: getal("Eind van de last in m vanaf de beginknoop; ontbreekt = de staaflengte.", { exclusiveMinimum: 0 }),
};
const puntLastVelden = {
  py: getal("Puntlast in lokale y, kN."), pz: getal("Puntlast in lokale z, kN."),
  positionM: getal("Plaats in m vanaf de beginknoop.", { minimum: 0 }),
};
const temperatuurVelden = {
  deltaTUniformK: getal("Gelijkmatige temperatuurverandering, K."),
  deltaTGradientYK: getal("Temperatuurverschil over de hoogte in lokale y, K."),
  deltaTGradientZK: getal("Temperatuurverschil over de hoogte in lokale z, K."),
};
const vlakLastVelden = {
  qx: getal("Vlaklast in X, kN/m²."), qy: getal("Vlaklast in Y, kN/m²."), qz: getal("Vlaklast in Z, kN/m² (negatief = omlaag)."),
};
const vector = obj({ x: getal(), y: getal(), z: getal() }, ["x", "y", "z"], "Richting in globale assen.");
const vlakVelden = {
  q: getal("Belasting op het vlak, kN/m²."),
  direction: keuze(["gravity", "normal"], "gravity = zwaartekracht per horizontale projectie; normal = loodrecht op het vlak."),
  distribution: keuze(["oneWay", "twoWay"], "Afdracht: oneWay naar de liggers dwars op de overspanning, twoWay naar alle randliggers."),
  spanDirection: vector,
  excludedBeamIds: lijst(staafId, "Liggers in het vlak die geen last krijgen."),
};

// ── Opleggingen ───────────────────────────────────────────────────────────

const PRESETS = Object.keys(OPEN_FEM_3D_SUPPORT_PRESETS) as OpenFem3DSupportPreset[];

const opleggingZetten = documentCommando<{ nodeId: number; preset?: OpenFem3DSupportPreset } & Partial<OpenFem3DSupportRestraints>, unknown>({
  naam: "model3d.support.set",
  beschrijving: "Een oplegging op een knoop zetten of vervangen: een standaardtype (preset) óf alle zes vrijheidsgraden.",
  invoer: obj({
    nodeId: knoopId,
    preset: keuze(PRESETS, "Standaardtype: fixed (inklemming), pinned (scharnier), x-/y-/zRoller, revoluteX/Y/Z (scharnier met één vrije draaias)."),
    ...vrijheidsgraden,
  }, ["nodeId"]),
  uitvoeren: ({ nodeId, preset, ...vrij }, document) => {
    const model = model3dVan(document);
    vindKnoop(model, nodeId);
    const gegeven = Object.keys(vrij);
    if (preset !== undefined && gegeven.length > 0) throw new ApiFout("INVOER_ONGELDIG", "Geef een preset óf de vrijheidsgraden, niet allebei.");
    if (preset === undefined && gegeven.length !== 6) throw new ApiFout("INVOER_ONGELDIG", "Zonder preset zijn alle zes vrijheidsgraden (ux … rz) nodig.");
    const restraints = preset ? OPEN_FEM_3D_SUPPORT_PRESETS[preset] : (vrij as OpenFem3DSupportRestraints);
    const nieuw = setOpenFem3DSupport(model, nodeId, { ...restraints });
    return { uitkomst: { support: nieuw.supports!.find((s) => s.nodeId === nodeId) }, document: met(document, nieuw) };
  },
});

const opleggingenZetten = documentCommando<{ nodeIds?: number[]; allSupports?: boolean; preset: OpenFem3DSupportPreset }, unknown>({
  naam: "model3d.support.setMany",
  beschrijving: "Meerdere knopen in één keer hetzelfde standaardtype oplegging geven, bijvoorbeeld alle opleggingen scharnierend (allSupports + preset pinned). Zoals een lintknop: veren en opgelegde verplaatsingen in richtingen die vrij blijven, blijven staan.",
  invoer: obj({
    nodeIds: lijst(knoopId, "De knopen; niet samen met allSupports."),
    allSupports: jaNee("Alle knopen die nu een oplegging hebben."),
    preset: keuze(PRESETS, "Standaardtype: fixed (inklemming), pinned (scharnier), x-/y-/zRoller, revoluteX/Y/Z."),
  }, ["preset"]),
  uitvoeren: ({ nodeIds, allSupports, preset }, document) => {
    const model = model3dVan(document);
    if ((nodeIds !== undefined) === (allSupports === true)) {
      throw new ApiFout("INVOER_ONGELDIG", "Geef nodeIds óf allSupports: true.");
    }
    const ids = allSupports ? (model.supports ?? []).map((support) => support.nodeId) : [...new Set(nodeIds)];
    for (const nodeId of ids) vindKnoop(model, nodeId);
    const nieuw = ids.reduce((volgend, nodeId) => setOpenFem3DSupport(volgend, nodeId, { ...OPEN_FEM_3D_SUPPORT_PRESETS[preset] }), model);
    return { uitkomst: { nodeIds: ids, preset }, document: met(document, nieuw) };
  },
});

const verenZetten = documentCommando<{ nodeId: number } & OpenFem3DSupportSprings, unknown>({
  naam: "model3d.support.setSprings",
  beschrijving: "Veren op een knoop zetten (vervangt de bestaande veren). Een veer maakt zijn richting vrij: op een verhinderde richting vervangt de veer de vaste oplegging, en een opgelegde waarde in die richting vervalt.",
  invoer: obj({ nodeId: knoopId, ...veren }, ["nodeId"]),
  uitvoeren: ({ nodeId, ...springs }, document) => {
    const model = model3dVan(document);
    vindKnoop(model, nodeId);
    const nieuw = setOpenFem3DSupportSprings(model, nodeId, springs);
    return { uitkomst: { support: nieuw.supports?.find((s) => s.nodeId === nodeId) ?? null }, document: met(document, nieuw) };
  },
});

const opgelegdZetten = documentCommando<{ nodeId: number } & OpenFem3DPrescribedDisplacements, unknown>({
  naam: "model3d.support.setPrescribed",
  beschrijving: "Opgelegde verplaatsingen of rotaties op een knoop zetten (vervangt de bestaande). Een opgelegde waarde verhindert zijn richting automatisch.",
  invoer: obj({ nodeId: knoopId, ...opgelegd }, ["nodeId"]),
  uitvoeren: ({ nodeId, ...values }, document) => {
    const model = model3dVan(document);
    vindKnoop(model, nodeId);
    const nieuw = setOpenFem3DSupportPrescribed(model, nodeId, values);
    return { uitkomst: { support: nieuw.supports?.find((s) => s.nodeId === nodeId) ?? null }, document: met(document, nieuw) };
  },
});

const opleggingWeg = documentCommando<{ nodeId: number }, unknown>({
  naam: "model3d.support.remove",
  beschrijving: "De oplegging van een knoop weghalen, met haar veren en opgelegde verplaatsingen. De knoop blijft.",
  invoer: obj({ nodeId: knoopId }, ["nodeId"]),
  uitvoeren: ({ nodeId }, document) => {
    const model = model3dVan(document);
    if (!(model.supports ?? []).some((s) => s.nodeId === nodeId)) {
      throw new ApiFout("NIET_GEVONDEN", `3D-knoop ${nodeId} heeft geen oplegging.`, { nodeId });
    }
    return { uitkomst: { removedSupportNodeId: nodeId }, document: met(document, removeOpenFem3DSupport(model, nodeId)) };
  },
});

// ── Lasten ────────────────────────────────────────────────────────────────

const knoopLastToevoegen = documentCommando<{ nodeId: number; caseId?: number } & Partial<Record<keyof typeof knoopLastVelden, number>>, unknown>({
  naam: "model3d.load.nodal.add",
  beschrijving: "Een knooplast (krachten en momenten in globale assen) toevoegen. Ontbrekende componenten zijn 0.",
  invoer: obj({ nodeId: knoopId, caseId: gevalId, ...knoopLastVelden }, ["nodeId"]),
  uitvoeren: ({ nodeId, caseId, fx = 0, fy = 0, fz = 0, mx = 0, my = 0, mz = 0 }, document) => {
    const model = model3dVan(document);
    vindKnoop(model, nodeId);
    const nieuw = addOpenFem3DNodalLoad(model, nodeId, { fx, fy, fz, mx, my, mz }, geval(document, caseId));
    return { uitkomst: { load: nieuwElement(model.loads, nieuw.loads) }, document: met(document, nieuw) };
  },
});
const knoopLastWijzigen = documentCommando<{ id: number } & Partial<Record<keyof typeof knoopLastVelden, number>>, unknown>({
  naam: "model3d.load.nodal.update",
  beschrijving: "Componenten van een knooplast wijzigen; niet genoemde componenten blijven.",
  invoer: obj({ id: id("Id van de knooplast."), ...knoopLastVelden }, ["id"]),
  uitvoeren: ({ id: loadId, ...patch }, document) => {
    const model = model3dVan(document);
    const oud = vindIn(model.loads, "3D-knooplast", loadId);
    const nieuw = updateOpenFem3DNodalLoad(model, loadId, {
      fx: patch.fx ?? oud.fx, fy: patch.fy ?? oud.fy, fz: patch.fz ?? oud.fz,
      mx: patch.mx ?? oud.mx, my: patch.my ?? oud.my, mz: patch.mz ?? oud.mz,
    });
    return { uitkomst: { load: vindIn(nieuw.loads, "3D-knooplast", loadId) }, document: met(document, nieuw) };
  },
});

const staafLastToevoegen = documentCommando<{ beamId: number; caseId?: number } & Partial<Record<keyof typeof lijnLastVelden, number>>, unknown>({
  naam: "model3d.load.member.add",
  beschrijving: "Een (trapeziumvormige) lijnlast op een staaf toevoegen, in lokale y/z. Zonder positie: over de hele staaf.",
  invoer: obj({ beamId: staafId, caseId: gevalId, ...lijnLastVelden }, ["beamId"]),
  uitvoeren: ({ beamId, caseId, qyStart = 0, qyEnd, qzStart = 0, qzEnd, startPositionM = 0, endPositionM }, document) => {
    const model = model3dVan(document);
    const lengte = staafLengte(model, beamId);
    const nieuw = addOpenFem3DMemberLoad(model, beamId, {
      qyStart, qyEnd: qyEnd ?? qyStart, qzStart, qzEnd: qzEnd ?? qzStart,
      startPositionM, endPositionM: endPositionM ?? lengte,
    }, geval(document, caseId));
    return { uitkomst: { load: nieuwElement(model.memberLoads, nieuw.memberLoads) }, document: met(document, nieuw) };
  },
});
const staafLastWijzigen = documentCommando<{ id: number } & Partial<Record<keyof typeof lijnLastVelden, number>>, unknown>({
  naam: "model3d.load.member.update",
  beschrijving: "Waarden of positie van een lijnlast wijzigen; niet genoemde velden blijven.",
  invoer: obj({ id: id("Id van de lijnlast."), ...lijnLastVelden }, ["id"]),
  uitvoeren: ({ id: loadId, ...patch }, document) => {
    const model = model3dVan(document);
    const { id: _id, beamId: _beam, caseId: _case, ...oud } = vindIn(model.memberLoads, "3D-lijnlast", loadId);
    const nieuw = updateOpenFem3DMemberLoad(model, loadId, { ...oud, ...patch });
    return { uitkomst: { load: vindIn(nieuw.memberLoads, "3D-lijnlast", loadId) }, document: met(document, nieuw) };
  },
});

const puntLastToevoegen = documentCommando<{ beamId: number; caseId?: number; py?: number; pz?: number; positionM: number }, unknown>({
  naam: "model3d.load.memberPoint.add",
  beschrijving: "Een puntlast op een staaf toevoegen, in lokale y/z, op een plaats vanaf de beginknoop.",
  invoer: obj({ beamId: staafId, caseId: gevalId, ...puntLastVelden }, ["beamId", "positionM"]),
  uitvoeren: ({ beamId, caseId, py = 0, pz = 0, positionM }, document) => {
    const model = model3dVan(document);
    vindStaaf(model, beamId);
    const nieuw = addOpenFem3DMemberPointLoad(model, beamId, { py, pz, positionM }, geval(document, caseId));
    return { uitkomst: { load: nieuwElement(model.memberPointLoads, nieuw.memberPointLoads) }, document: met(document, nieuw) };
  },
});
const puntLastWijzigen = documentCommando<{ id: number; py?: number; pz?: number; positionM?: number }, unknown>({
  naam: "model3d.load.memberPoint.update",
  beschrijving: "Waarden of plaats van een puntlast op een staaf wijzigen; niet genoemde velden blijven.",
  invoer: obj({ id: id("Id van de puntlast."), ...puntLastVelden }, ["id"]),
  uitvoeren: ({ id: loadId, ...patch }, document) => {
    const model = model3dVan(document);
    const { id: _id, beamId: _beam, caseId: _case, ...oud } = vindIn(model.memberPointLoads, "3D-puntlast", loadId);
    const nieuw = updateOpenFem3DMemberPointLoad(model, loadId, { ...oud, ...patch });
    return { uitkomst: { load: vindIn(nieuw.memberPointLoads, "3D-puntlast", loadId) }, document: met(document, nieuw) };
  },
});

const temperatuurToevoegen = documentCommando<{ beamId: number; caseId?: number } & Partial<Record<keyof typeof temperatuurVelden, number>>, unknown>({
  naam: "model3d.load.thermal.add",
  beschrijving: "Een temperatuurbelasting op een staaf toevoegen (gelijkmatig en/of gradiënt). Ontbrekende waarden zijn 0; niet alles 0.",
  invoer: obj({ beamId: staafId, caseId: gevalId, ...temperatuurVelden }, ["beamId"]),
  uitvoeren: ({ beamId, caseId, deltaTUniformK = 0, deltaTGradientYK = 0, deltaTGradientZK = 0 }, document) => {
    const model = model3dVan(document);
    vindStaaf(model, beamId);
    const nieuw = addOpenFem3DThermalLoad(model, beamId, { deltaTUniformK, deltaTGradientYK, deltaTGradientZK }, geval(document, caseId));
    return { uitkomst: { load: nieuwElement(model.thermalLoads, nieuw.thermalLoads) }, document: met(document, nieuw) };
  },
});
const temperatuurWijzigen = documentCommando<{ id: number } & Partial<Record<keyof typeof temperatuurVelden, number>>, unknown>({
  naam: "model3d.load.thermal.update",
  beschrijving: "Een temperatuurbelasting wijzigen; niet genoemde waarden blijven.",
  invoer: obj({ id: id("Id van de temperatuurbelasting."), ...temperatuurVelden }, ["id"]),
  uitvoeren: ({ id: loadId, ...patch }, document) => {
    const model = model3dVan(document);
    const { id: _id, beamId: _beam, caseId: _case, ...oud } = vindIn(model.thermalLoads, "3D-temperatuurbelasting", loadId);
    const nieuw = updateOpenFem3DThermalLoad(model, loadId, { ...oud, ...patch });
    return { uitkomst: { load: vindIn(nieuw.thermalLoads, "3D-temperatuurbelasting", loadId) }, document: met(document, nieuw) };
  },
});

const vlakLastToevoegen = documentCommando<{ plateId: number; caseId?: number; qx?: number; qy?: number; qz?: number }, unknown>({
  naam: "model3d.load.surface.add",
  beschrijving: "Een oppervlaktebelasting op een plaat toevoegen, in globale assen. Ontbrekende componenten zijn 0.",
  invoer: obj({ plateId: id("Id van een bestaande 3D-plaat."), caseId: gevalId, ...vlakLastVelden }, ["plateId"]),
  uitvoeren: ({ plateId, caseId, qx = 0, qy = 0, qz = 0 }, document) => {
    const model = model3dVan(document);
    vindIn(model.plates, "3D-plaat", plateId);
    const nieuw = addOpenFem3DSurfaceLoad(model, plateId, { qx, qy, qz }, geval(document, caseId));
    return { uitkomst: { load: nieuwElement(model.surfaceLoads, nieuw.surfaceLoads) }, document: met(document, nieuw) };
  },
});
const vlakLastWijzigen = documentCommando<{ id: number; qx?: number; qy?: number; qz?: number }, unknown>({
  naam: "model3d.load.surface.update",
  beschrijving: "Een oppervlaktebelasting wijzigen; niet genoemde componenten blijven.",
  invoer: obj({ id: id("Id van de oppervlaktebelasting."), ...vlakLastVelden }, ["id"]),
  uitvoeren: ({ id: loadId, ...patch }, document) => {
    const model = model3dVan(document);
    const oud = vindIn(model.surfaceLoads, "3D-oppervlaktebelasting", loadId);
    const nieuw = updateOpenFem3DSurfaceLoad(model, loadId, { qx: patch.qx ?? oud.qx, qy: patch.qy ?? oud.qy, qz: patch.qz ?? oud.qz });
    return { uitkomst: { load: vindIn(nieuw.surfaceLoads, "3D-oppervlaktebelasting", loadId) }, document: met(document, nieuw) };
  },
});

/** Eén verwijdercommando per lastsoort: dezelfde vorm, eigen lijst en functie. */
function lastVerwijderen(
  soort: string, sleutel: "loads" | "memberLoads" | "memberPointLoads" | "thermalLoads" | "surfaceLoads",
  naam: string, verwijder: (model: OpenFem3DModel, loadId: number) => OpenFem3DModel,
) {
  return documentCommando<{ id: number }, unknown>({
    naam,
    beschrijving: `Een ${soort} verwijderen.`,
    invoer: obj({ id: id(`Id van de ${soort}.`) }, ["id"]),
    uitvoeren: ({ id: loadId }, document) => {
      const model = model3dVan(document);
      vindIn<{ id: number }>(model[sleutel], `3D-${soort}`, loadId);
      return { uitkomst: { deletedLoadId: loadId }, document: met(document, verwijder(model, loadId)) };
    },
  });
}

// ── Belastingvlakken ──────────────────────────────────────────────────────

const vlakToevoegen = documentCommando<{ nodeIds: number[] } & OpenFem3DLoadPanelOptions, unknown>({
  naam: "model3d.loadPanel.add",
  beschrijving: "Een belastingvlak over bestaande knopen toevoegen: draagt zijn vlaklast af naar de liggers in het vlak (bijv. een dak of gevel). Standaard q = 1 kN/m², zwaartekracht, tweezijdig.",
  invoer: obj({ nodeIds: lijst(id("Id van een hoekknoop."), "Hoekknopen in volgorde, in één vlak.", { minItems: 3 }), caseId: gevalId, ...vlakVelden }, ["nodeIds"]),
  uitvoeren: ({ nodeIds, caseId, ...opties }, document) => {
    const model = model3dVan(document);
    const nieuw = addOpenFem3DLoadPanel(model, nodeIds, { ...opties, caseId: geval(document, caseId) });
    return { uitkomst: { loadPanel: nieuwElement(model.loadPanels, nieuw.loadPanels) }, document: met(document, nieuw) };
  },
});
const vlakWijzigen = documentCommando<{ id: number } & Omit<OpenFem3DLoadPanelPatch, "spanDirection"> & { spanDirection?: OpenFem3DVector | null }, unknown>({
  naam: "model3d.loadPanel.update",
  beschrijving: "Een belastingvlak wijzigen: q, richting, afdracht, overspanning, uitgesloten liggers of belastinggeval.",
  invoer: obj({
    id: id("Id van het belastingvlak."), caseId: id("Ander bestaand belastinggeval."),
    q: vlakVelden.q, direction: vlakVelden.direction, distribution: vlakVelden.distribution,
    spanDirection: ofNull(vector, "Overspanningsrichting; null = de standaard."),
    excludedBeamIds: vlakVelden.excludedBeamIds,
  }, ["id"]),
  uitvoeren: ({ id: panelId, caseId, spanDirection, ...rest }, document) => {
    const model = model3dVan(document);
    vindIn(model.loadPanels, "3D-belastingvlak", panelId);
    const patch: OpenFem3DLoadPanelPatch = {
      ...rest,
      ...(caseId !== undefined ? { caseId: geval(document, caseId) } : {}),
      ...(spanDirection !== undefined ? { spanDirection: spanDirection ?? undefined } : {}),
    };
    const nieuw = updateOpenFem3DLoadPanel(model, panelId, patch);
    return { uitkomst: { loadPanel: vindIn(nieuw.loadPanels, "3D-belastingvlak", panelId) }, document: met(document, nieuw) };
  },
});
const vlakWeg = documentCommando<{ id: number }, unknown>({
  naam: "model3d.loadPanel.delete",
  beschrijving: "Een belastingvlak verwijderen.",
  invoer: obj({ id: id("Id van het belastingvlak.") }, ["id"]),
  uitvoeren: ({ id: panelId }, document) => {
    const model = model3dVan(document);
    vindIn(model.loadPanels, "3D-belastingvlak", panelId);
    return { uitkomst: { deletedLoadPanelId: panelId }, document: met(document, removeOpenFem3DLoadPanel(model, panelId)) };
  },
});
const vlakDupliceren = documentCommando<{ id: number; caseId: number }, unknown>({
  naam: "model3d.loadPanel.duplicate",
  beschrijving: "Een belastingvlak kopiëren naar een ander belastinggeval (zelfde hoeken en instellingen).",
  invoer: obj({ id: id("Id van het belastingvlak."), caseId: id("Bestaand belastinggeval van de kopie.") }, ["id", "caseId"]),
  uitvoeren: ({ id: panelId, caseId }, document) => {
    const model = model3dVan(document);
    vindIn(model.loadPanels, "3D-belastingvlak", panelId);
    const kopie = duplicateOpenFem3DLoadPanel(model, panelId, geval(document, caseId));
    return { uitkomst: { loadPanelId: kopie.panelId }, document: met(document, kopie.model) };
  },
});
const plaatNaarVlakken = documentCommando<{ plateId: number; caseId?: number }, unknown>({
  naam: "model3d.plate.toLoadPanels",
  beschrijving: "Een plaat omzetten in belastingvlakken: de plaat verdwijnt, haar omtrek draagt alleen nog last af. Openingen, bogen of een schuine last worden geweigerd.",
  invoer: obj({ plateId: id("Id van de plaat."), caseId: gevalId }, ["plateId"]),
  uitvoeren: ({ plateId, caseId }, document) => {
    const model = model3dVan(document);
    vindIn(model.plates, "3D-plaat", plateId);
    const omgezet = convertOpenFem3DPlateToLoadPanels(model, plateId, { caseId: geval(document, caseId) });
    return { uitkomst: { loadPanelIds: omgezet.panelIds }, document: met(document, omgezet.model) };
  },
});

// ── Schijven en trek-alleen ───────────────────────────────────────────────

function schijfWeigering(refusal: OpenFem3DDiaphragmRefusal): string {
  switch (refusal.kind) {
    case "tooFewNodes": return "Een schijf heeft minstens twee verschillende knopen nodig.";
    case "missingNode": return `3D-knoop ${refusal.nodeId} bestaat niet.`;
    case "notLevel": return `Knoop ${refusal.lowNodeId} en ${refusal.highNodeId} liggen ${refusal.differenceMm.toFixed(1)} mm uit elkaar in hoogte; een schijf ligt op één hoogte (binnen 1 mm).`;
    case "alreadyInDiaphragm": return `Knoop ${refusal.nodeId} zit al in schijf ${refusal.diaphragmId}.`;
  }
}

const schijfToevoegen = documentCommando<{ nodeIds: number[]; name?: string }, unknown>({
  naam: "model3d.diaphragm.add",
  beschrijving: "Een starre horizontale schijf (bijv. een vloer met druklaag) uit knopen op één hoogte: X, Y en rotatie om Z bewegen samen.",
  invoer: obj({ nodeIds: lijst(knoopId, "Knopen op één hoogte (binnen 1 mm).", { minItems: 2 }), name: tekst("Naam van de schijf.") }, ["nodeIds"]),
  uitvoeren: ({ nodeIds, name }, document) => {
    const resultaat = addOpenFem3DDiaphragm(model3dVan(document), nodeIds, name);
    if (!resultaat.ok) throw new ApiFout("GEWEIGERD", schijfWeigering(resultaat.refusal), { refusal: resultaat.refusal });
    return { uitkomst: { diaphragmId: resultaat.id }, document: met(document, resultaat.model) };
  },
});
const schijfWeg = documentCommando<{ id: number }, unknown>({
  naam: "model3d.diaphragm.delete",
  beschrijving: "Een starre schijf verwijderen; de knopen blijven.",
  invoer: obj({ id: id("Id van de schijf.") }, ["id"]),
  uitvoeren: ({ id: diaphragmId }, document) => {
    const model = model3dVan(document);
    vindIn(model.diaphragms, "Schijf", diaphragmId);
    return { uitkomst: { deletedDiaphragmId: diaphragmId }, document: met(document, removeOpenFem3DDiaphragm(model, diaphragmId)) };
  },
});
const trekAlleen = documentCommando<{ beamIds: number[]; on: boolean }, unknown>({
  naam: "model3d.beam.setTensionOnly",
  beschrijving: "Staven trek-alleen maken (on: true) of weer gewoon (on: false).",
  invoer: obj({ beamIds: lijst(staafId, "De staven.", { minItems: 1 }), on: jaNee("true = trek-alleen.") }, ["beamIds", "on"]),
  uitvoeren: ({ beamIds, on }, document) => {
    const model = model3dVan(document);
    for (const beamId of beamIds) vindStaaf(model, beamId);
    return { uitkomst: { beamIds, on }, document: met(document, setOpenFem3DTensionOnly(model, beamIds, on)) };
  },
});
const instellingen = documentCommando<{ tensionOnlyFitAfterPermanent?: boolean; tensionOnlyCrossRule?: boolean }, unknown>({
  naam: "model3d.settings.update",
  beschrijving: "Modelinstellingen voor trek-alleen staven: montage na de permanente belasting en de kruisregel.",
  invoer: obj({
    tensionOnlyFitAfterPermanent: jaNee("Trek-alleen staven gemonteerd na de permanente belasting (spanningsloos daaronder)."),
    tensionOnlyCrossRule: jaNee("Kruisregel: van twee kruisende trek-alleen staven blijft de staaf met de grootste N actief."),
  }),
  uitvoeren: (invoer, document) => {
    let model = model3dVan(document);
    for (const [setting, on] of Object.entries(invoer) as [keyof typeof invoer, boolean][]) {
      model = setOpenFem3DTensionOnlySetting(model, setting, on);
    }
    return {
      uitkomst: {
        tensionOnlyFitAfterPermanent: model.tensionOnlyFitAfterPermanent === true,
        tensionOnlyCrossRule: model.tensionOnlyCrossRule === true,
      },
      document: met(document, model),
    };
  },
});

export const MODEL3D_VOORWAARDEN_COMMANDOS = [
  opleggingZetten, opleggingenZetten, verenZetten, opgelegdZetten, opleggingWeg,
  knoopLastToevoegen, knoopLastWijzigen, lastVerwijderen("knooplast", "loads", "model3d.load.nodal.delete", removeOpenFem3DNodalLoad),
  staafLastToevoegen, staafLastWijzigen, lastVerwijderen("lijnlast", "memberLoads", "model3d.load.member.delete", removeOpenFem3DMemberLoad),
  puntLastToevoegen, puntLastWijzigen, lastVerwijderen("puntlast", "memberPointLoads", "model3d.load.memberPoint.delete", removeOpenFem3DMemberPointLoad),
  temperatuurToevoegen, temperatuurWijzigen, lastVerwijderen("temperatuurbelasting", "thermalLoads", "model3d.load.thermal.delete", removeOpenFem3DThermalLoad),
  vlakLastToevoegen, vlakLastWijzigen, lastVerwijderen("oppervlaktebelasting", "surfaceLoads", "model3d.load.surface.delete", removeOpenFem3DSurfaceLoad),
  vlakToevoegen, vlakWijzigen, vlakWeg, vlakDupliceren, plaatNaarVlakken,
  schijfToevoegen, schijfWeg, trekAlleen, instellingen,
];

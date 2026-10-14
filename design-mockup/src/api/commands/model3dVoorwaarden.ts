/**
 * API-commando's voor de randvoorwaarden en belastingen van het 3D-model:
 * opleggingen (vast, veren, opgelegde verplaatsing), knoop-, staaf-,
 * staafpunt-, temperatuur- en oppervlaktelasten, belastingvlakken, schijven
 * en de trek-alleen-instellingen. Dunne lagen over de zuivere functies van
 * de app; dezelfde regels.
 *
 * Plaatsen op een object (issues #76 en #77): `model3d.support.place` en
 * `model3d.load.placePoint` doen wat de gereedschappen Oplegging, Veer en
 * Puntlast in de app doen, met dezelfde zuivere functies
 * (openFem3dNodeTools, openFem3dPlaatsen): op een knoop, op een staaf, op een
 * plaat of op een vrij punt.
 *
 * Een last zonder `caseId` komt in het actieve belastinggeval van het
 * project, net als bij het tekengereedschap. Een onbekend geval is
 * NIET_GEVONDEN. Een lijnlast is lokaal (qy/qz) of, met `globalDirection`,
 * globaal (issue #80). Krachten in kN, momenten in kNm, lijnlasten in kN/m,
 * vlaklasten in kN/m², lengtes in m, temperatuurverschillen in K.
 */
import { ApiFout } from "../register";
import { documentCommando, nietGevonden, nieuwElement } from "../commandoHulp";
import { metModel3d, model3dVan, type ApiDocument } from "../projectDocument";
import { eenVan, getal, id, jaNee, keuze, lijst, obj, ofNull, tekst } from "../schemaBouw";
import {
  OPEN_FEM_3D_SUPPORT_PRESETS,
  addOpenFem3DMemberLoad, addOpenFem3DMemberPointLoad, addOpenFem3DNodalLoad, addOpenFem3DSurfaceLoad,
  addOpenFem3DThermalLoad, removeOpenFem3DLoadPanel, removeOpenFem3DMemberLoad, removeOpenFem3DMemberPointLoad,
  removeOpenFem3DNodalLoad, removeOpenFem3DSupport, removeOpenFem3DSurfaceLoad, removeOpenFem3DThermalLoad,
  setOpenFem3DSupport, setOpenFem3DSupportPrescribed, setOpenFem3DSupportSprings, updateOpenFem3DMemberLoad,
  updateOpenFem3DMemberPointLoad, updateOpenFem3DNodalLoad, updateOpenFem3DSurfaceLoad, updateOpenFem3DThermalLoad,
  OPEN_FEM_3D_GLOBAL_DIRECTIONS, isOpenFem3DGlobalMemberLoad,
  type OpenFem3DGlobalDirection, type OpenFem3DMemberLoad, type OpenFem3DMemberLoadValues,
  type OpenFem3DEnvelopePanel, type OpenFem3DModel, type OpenFem3DPrescribedDisplacements, type OpenFem3DSupportPreset,
  type OpenFem3DSupportRestraints, type OpenFem3DSupportSprings, type OpenFem3DVector,
} from "../../components/openFem3d/openFem3dModel";
import {
  addOpenFem3DLoadPanel, convertOpenFem3DPlateToLoadPanels, duplicateOpenFem3DLoadPanel, updateOpenFem3DLoadPanel,
  type OpenFem3DLoadPanelOptions, type OpenFem3DLoadPanelPatch,
} from "../../components/openFem3d/openFem3dLoadPanels";
import {
  addOpenFem3DEnvelopePanel, addOpenFem3DEnvelopePanelLoad, removeOpenFem3DEnvelopePanel,
  updateOpenFem3DEnvelopePanel,
} from "../../components/openFem3d/openFem3dEnvelopePanels";
import {
  addOpenFem3DDiaphragm, removeOpenFem3DDiaphragm, setOpenFem3DTensionOnly, setOpenFem3DTensionOnlySetting,
  type OpenFem3DDiaphragmRefusal,
} from "../../components/openFem3d/openFem3dTrekSchijf";
import {
  OPEN_FEM_3D_DEFAULT_SPRING_STIFFNESS, placeOpenFem3DNodeCondition, type OpenFem3DNodeCondition,
} from "../../components/openFem3d/openFem3dNodeTools";
import {
  placeOpenFem3DPointLoad, type OpenFem3DPlacementTarget, type OpenFem3DPointLoadTarget,
} from "../../components/openFem3d/openFem3dPlaatsen";
import type { OpenFem3DSpringAxis } from "../../components/openFem3d/openFem3dCommands";

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
const globaleRichting = keuze([...OPEN_FEM_3D_GLOBAL_DIRECTIONS],
  "Globale richting van de last: x, y of z. Met dit veld is het een globale lijnlast (qStart/qEnd langs die as, de kern zet hem om naar de staaf); zonder is het een lokale last (qy/qz).");
const lijnLastVelden = {
  qyStart: getal("Lijnlast in lokale y aan het begin, kN/m. Alleen bij een lokale last."), qyEnd: getal("Lijnlast in lokale y aan het eind, kN/m."),
  qzStart: getal("Lijnlast in lokale z aan het begin, kN/m. Alleen bij een lokale last."), qzEnd: getal("Lijnlast in lokale z aan het eind, kN/m."),
  globalDirection: globaleRichting,
  qStart: getal("Globale lijnlast aan het begin, kN/m, met teken langs de globale as (z negatief = omlaag). Alleen met globalDirection."),
  qEnd: getal("Globale lijnlast aan het eind, kN/m; ontbreekt bij toevoegen = qStart."),
  perProjection: jaNee("Alleen met globalDirection. true: per meter projectie van de staaf op het vlak loodrecht op de lastrichting (sneeuw op een schuin dak: per horizontale meter); false of ontbreekt: per meter staaflengte."),
  startPositionM: getal("Begin van de last in m vanaf de beginknoop; ontbreekt = 0.", { minimum: 0 }),
  endPositionM: getal("Eind van de last in m vanaf de beginknoop; ontbreekt = de staaflengte.", { exclusiveMinimum: 0 }),
};
/** Wijzigen: globalDirection null maakt van een globale last weer een lokale (geef dan qy/qz). */
const lijnLastWijzigVelden = {
  ...lijnLastVelden,
  globalDirection: ofNull(globaleRichting,
    "Globale richting x, y of z (een lokale last wordt globaal; geef dan qStart), of null: weer een lokale last (geef dan qy/qz). Ontbreekt = blijft."),
};
type LijnLastInvoer = Partial<Record<"qyStart" | "qyEnd" | "qzStart" | "qzEnd" | "qStart" | "qEnd" | "startPositionM" | "endPositionM", number>>
  & { globalDirection?: OpenFem3DGlobalDirection | null; perProjection?: boolean };
const LOKALE_VELDEN = ["qyStart", "qyEnd", "qzStart", "qzEnd"] as const;
const GLOBALE_VELDEN = ["qStart", "qEnd", "perProjection"] as const;

/**
 * De waarden van een lijnlast uit de invoer (issue #80: lokaal of globaal).
 * Bij wijzigen is `oud` de basis: niet genoemde velden blijven, ook bij een
 * wissel tussen lokaal en globaal (dan zijn de nieuwe waarden nodig). Lokale
 * en globale velden door elkaar is een invoerfout.
 */
function lijnLastWaarden(invoer: LijnLastInvoer, oud: OpenFem3DMemberLoad | undefined, lengte: number): OpenFem3DMemberLoadValues {
  const startPositionM = invoer.startPositionM ?? oud?.startPositionM ?? 0;
  const endPositionM = invoer.endPositionM ?? oud?.endPositionM ?? lengte;
  const richting = invoer.globalDirection === undefined ? oud?.globalDirection : invoer.globalDirection ?? undefined;
  const lokaal = LOKALE_VELDEN.filter((veld) => invoer[veld] !== undefined);
  const globaal = GLOBALE_VELDEN.filter((veld) => invoer[veld] !== undefined);
  if (richting) {
    if (lokaal.length > 0) {
      throw new ApiFout("INVOER_ONGELDIG", `Een globale lijnlast heeft geen ${lokaal.join(", ")}; geef qStart en qEnd langs de globale as.`);
    }
    const vorige = oud && isOpenFem3DGlobalMemberLoad(oud) ? oud : undefined;
    const qStart = invoer.qStart ?? vorige?.qStart;
    if (qStart === undefined) throw new ApiFout("INVOER_ONGELDIG", "Een globale lijnlast heeft qStart nodig (kN/m langs de globale as).");
    return {
      globalDirection: richting, qStart, qEnd: invoer.qEnd ?? vorige?.qEnd ?? qStart,
      perProjection: invoer.perProjection ?? vorige?.perProjection ?? false, startPositionM, endPositionM,
    };
  }
  if (globaal.length > 0) {
    throw new ApiFout("INVOER_ONGELDIG", `${globaal.join(", ")} hoort bij een globale lijnlast; geef ook globalDirection (x, y of z).`);
  }
  if (oud && !isOpenFem3DGlobalMemberLoad(oud)) {
    return {
      qyStart: invoer.qyStart ?? oud.qyStart, qyEnd: invoer.qyEnd ?? oud.qyEnd,
      qzStart: invoer.qzStart ?? oud.qzStart, qzEnd: invoer.qzEnd ?? oud.qzEnd, startPositionM, endPositionM,
    };
  }
  const qyStart = invoer.qyStart ?? 0, qzStart = invoer.qzStart ?? 0;
  return { qyStart, qyEnd: invoer.qyEnd ?? qyStart, qzStart, qzEnd: invoer.qzEnd ?? qzStart, startPositionM, endPositionM };
}
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
  direction: keuze(["gravity", "normal", "verticalSurface"], "gravity = verticaal per horizontale projectie; normal = loodrecht op het vlak; verticalSurface = verticaal per werkelijk vlakoppervlak."),
  distribution: keuze(["oneWay", "twoWay"], "Afdracht: oneWay naar de liggers dwars op de overspanning, twoWay naar alle randliggers."),
  spanDirection: vector,
  excludedBeamIds: lijst(staafId, "Liggers in het vlak die geen last krijgen."),
  openings: lijst(obj({ id: id("Id van de opening."), nodeIds: lijst(knoopId, "Hoekknopen van de opening.", { minItems: 3 }) },
    ["id", "nodeIds"]), "Openingen zonder vlaklast."),
};

const schilVelden = {
  nodeIds: lijst(knoopId, "Hoekknopen van het gevel- of dakpaneel.", { minItems: 3 }),
  type: keuze(["facade", "roof"], "Gevel of dak."),
  name: tekst("Naam of groep van het paneel."),
  flipOuterSide: jaNee("Keer de buitenwaartse normaal om."),
  distribution: vlakVelden.distribution,
  spanDirection: vector,
  openings: vlakVelden.openings,
  claddingWeightKnPerM2: getal("Bekledingsgewicht per werkelijk vlakoppervlak, kN/m².", { minimum: 0 }),
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

// ── Plaatsen op een object (issues #76 en #77) ──────────────────────────────

const VEERRICHTINGEN: OpenFem3DSpringAxis[] = ["kx", "ky", "kz", "krx", "kry", "krz"];
const coordinaten = {
  x: getal("x in m (globaal)."), y: getal("y in m (globaal)."), z: getal("z in m (globaal, omhoog)."),
};
const knoopDoel = obj({ kind: { const: "node" }, nodeId: knoopId }, ["kind", "nodeId"], "Een bestaande knoop.");
const staafDoel = (wat: string) => obj({
  kind: { const: "beam" }, beamId: staafId,
  t: getal("Plek als fractie van de staaflengte: 0 = beginknoop, 1 = eindknoop.", { minimum: 0, maximum: 1 }),
  positionM: getal("Plek in m vanaf de beginknoop.", { minimum: 0 }),
}, ["kind", "beamId"], `Een plek op een staaf: t óf positionM. ${wat}`);

type DoelInvoer =
  | { kind: "node"; nodeId: number }
  | { kind: "beam"; beamId: number; t?: number; positionM?: number }
  | { kind: "plate"; plateId: number; x: number; y: number; z: number }
  | { kind: "point"; x: number; y: number; z: number };

/** Het doel uit de invoer, als plaatsingsdoel van de app; een onbekend element is NIET_GEVONDEN. */
function naarDoel(model: OpenFem3DModel, doel: DoelInvoer): OpenFem3DPlacementTarget {
  switch (doel.kind) {
    case "node":
      vindKnoop(model, doel.nodeId);
      return { nodeId: doel.nodeId };
    case "beam": {
      vindStaaf(model, doel.beamId);
      if ((doel.t === undefined) === (doel.positionM === undefined)) {
        throw new ApiFout("INVOER_ONGELDIG", "Geef de plek op de staaf als t (0–1) óf als positionM (m), niet allebei.");
      }
      return doel.t !== undefined ? { beamId: doel.beamId, t: doel.t } : { beamId: doel.beamId, positionM: doel.positionM! };
    }
    case "plate":
      vindIn(model.plates, "3D-plaat", doel.plateId);
      return { plateId: doel.plateId, point: { x: doel.x, y: doel.y, z: doel.z } };
    case "point":
      return { position: { x: doel.x, y: doel.y, z: doel.z } };
  }
}

const opleggingPlaatsen = documentCommando<{
  target: DoelInvoer; preset?: OpenFem3DSupportPreset; springAxis?: OpenFem3DSpringAxis; stiffness?: number;
}, unknown>({
  naam: "model3d.support.place",
  beschrijving: "Een oplegging of veer plaatsen zoals de gereedschappen Oplegging en Veer in de app: op een knoop; op een staaf (de staaf wordt op die plek gesplitst zoals bij een tussenknoop, lasten en eindscharnieren blijven goed verdeeld; op t = 0 of 1 de eindknoop); op een plaat (nieuwe knoop in het middenvlak, het punt loodrecht geprojecteerd, met het level van de plaat; een punt in een opening of buiten de plaat wordt geweigerd); of op een vrij punt (de knoop die daar ligt, of een nieuwe). Geef preset (oplegging) óf springAxis (veer). Knoop en oplegging zijn één bewerking.",
  invoer: obj({
    target: eenVan([
      knoopDoel,
      staafDoel("De staaf wordt daar gesplitst."),
      obj({ kind: { const: "plate" }, plateId: id("Id van een bestaande 3D-plaat."), ...coordinaten }, ["kind", "plateId", "x", "y", "z"],
        "Een punt op of bij een plaat; het wordt loodrecht op het middenvlak geprojecteerd."),
      obj({ kind: { const: "point" }, ...coordinaten }, ["kind", "x", "y", "z"], "Een vrij punt (zoals een klik op het werkvlak)."),
    ], "Waar de oplegging of veer komt."),
    preset: keuze(PRESETS, "Oplegging: fixed (inklemming), pinned (scharnier), x-/y-/zRoller, revoluteX/Y/Z."),
    springAxis: keuze(VEERRICHTINGEN, "Veer: kx, ky, kz (translatie, kN/m) of krx, kry, krz (rotatie, kNm/rad), in globale assen. Andere veren op de knoop blijven."),
    stiffness: getal("Stijfheid van de veer; ontbreekt = 10 000 kN/m (translatie) of 1000 kNm/rad (rotatie).", { exclusiveMinimum: 0 }),
  }, ["target"]),
  uitvoeren: ({ target, preset, springAxis, stiffness }, document) => {
    const model = model3dVan(document);
    if ((preset === undefined) === (springAxis === undefined)) {
      throw new ApiFout("INVOER_ONGELDIG", "Geef preset (oplegging) óf springAxis (veer).");
    }
    if (stiffness !== undefined && springAxis === undefined) {
      throw new ApiFout("INVOER_ONGELDIG", "stiffness hoort bij een veer (springAxis).");
    }
    const condition: OpenFem3DNodeCondition = preset !== undefined
      ? { kind: "support", preset } : { kind: "spring", axis: springAxis! };
    const geplaatst = placeOpenFem3DNodeCondition(model, naarDoel(model, target), condition,
      springAxis !== undefined ? stiffness ?? OPEN_FEM_3D_DEFAULT_SPRING_STIFFNESS[springAxis] : 0);
    return {
      uitkomst: {
        nodeId: geplaatst.nodeId, created: geplaatst.created,
        ...(geplaatst.split ? { split: geplaatst.split } : {}),
        node: geplaatst.model.nodes.find((node) => node.id === geplaatst.nodeId),
        support: geplaatst.model.supports?.find((s) => s.nodeId === geplaatst.nodeId) ?? null,
      },
      document: met(document, geplaatst.model),
    };
  },
});

const puntlastPlaatsen = documentCommando<{
  target: Extract<DoelInvoer, { kind: "node" | "beam" }>; caseId?: number; py?: number; pz?: number;
} & Partial<Record<keyof typeof knoopLastVelden, number>>, unknown>({
  naam: "model3d.load.placePoint",
  beschrijving: "Een puntlast plaatsen zoals het gereedschap Puntlast in de app: op een knoop een knooplast (globale assen), op een staaf een staafpuntlast op die plek (lokale y/z; de staaf blijft heel). Zonder waarden: −10 kN omlaag (Fz op een knoop, Pz op een staaf). fx … mz alleen bij een knoop, py en pz alleen bij een staaf.",
  invoer: obj({
    target: eenVan([knoopDoel, staafDoel("De last komt op die plek.")], "Waar de puntlast komt."),
    caseId: gevalId,
    ...knoopLastVelden,
    py: puntLastVelden.py, pz: puntLastVelden.pz,
  }, ["target"]),
  uitvoeren: ({ target, caseId, ...waarden }, document) => {
    const model = model3dVan(document);
    const doel = naarDoel(model, target) as OpenFem3DPointLoadTarget;
    const gegeven = (velden: readonly string[]) => velden.filter((veld) => (waarden as Record<string, unknown>)[veld] !== undefined);
    const vreemd = target.kind === "node" ? gegeven(["py", "pz"]) : gegeven(Object.keys(knoopLastVelden));
    if (vreemd.length > 0) {
      throw new ApiFout("INVOER_ONGELDIG", `${vreemd.join(", ")} hoort niet bij een puntlast op een ${target.kind === "node" ? "knoop" : "staaf"}.`);
    }
    const geplaatst = placeOpenFem3DPointLoad(model, doel, geval(document, caseId), waarden);
    const load = geplaatst.kind === "nodal"
      ? geplaatst.model.loads?.find((item) => item.id === geplaatst.loadId)
      : geplaatst.model.memberPointLoads?.find((item) => item.id === geplaatst.loadId);
    return { uitkomst: { kind: geplaatst.kind, load }, document: met(document, geplaatst.model) };
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

const staafLastToevoegen = documentCommando<{ beamId: number; caseId?: number } & LijnLastInvoer, unknown>({
  naam: "model3d.load.member.add",
  beschrijving: "Een (trapeziumvormige) lijnlast op een staaf toevoegen: in lokale y/z (qyStart … qzEnd), of met globalDirection in een globale richting (qStart/qEnd, per staafmeter of met perProjection per meter projectie). Zonder positie: over de hele staaf.",
  invoer: obj({ beamId: staafId, caseId: gevalId, ...lijnLastVelden }, ["beamId"]),
  uitvoeren: ({ beamId, caseId, ...invoer }, document) => {
    const model = model3dVan(document);
    const lengte = staafLengte(model, beamId);
    const nieuw = addOpenFem3DMemberLoad(model, beamId, lijnLastWaarden(invoer, undefined, lengte), geval(document, caseId));
    return { uitkomst: { load: nieuwElement(model.memberLoads, nieuw.memberLoads) }, document: met(document, nieuw) };
  },
});
const staafLastWijzigen = documentCommando<{ id: number } & LijnLastInvoer, unknown>({
  naam: "model3d.load.member.update",
  beschrijving: "Waarden, richting of positie van een lijnlast wijzigen; niet genoemde velden blijven. globalDirection maakt een lokale last globaal (met qStart), null maakt hem weer lokaal (met qy/qz).",
  invoer: obj({ id: id("Id van de lijnlast."), ...lijnLastWijzigVelden }, ["id"]),
  uitvoeren: ({ id: loadId, ...patch }, document) => {
    const model = model3dVan(document);
    const oud = vindIn(model.memberLoads, "3D-lijnlast", loadId);
    const nieuw = updateOpenFem3DMemberLoad(model, loadId, lijnLastWaarden(patch, oud, staafLengte(model, oud.beamId)));
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
    openings: vlakVelden.openings,
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

const schilToevoegen = documentCommando<Omit<OpenFem3DEnvelopePanel, "id">, unknown>({
  naam: "model3d.panel.add",
  beschrijving: "Een gevel- of dakpaneel zonder stijfheid toevoegen, onafhankelijk van belastinggevallen.",
  invoer: obj(schilVelden, ["nodeIds", "type", "distribution"]),
  uitvoeren: (waarden, document) => {
    const model = model3dVan(document);
    const nieuw = addOpenFem3DEnvelopePanel(model, waarden);
    return { uitkomst: { panel: nieuwElement(model.envelopePanels, nieuw.envelopePanels) }, document: met(document, nieuw) };
  },
});
const schilWijzigen = documentCommando<{ id: number } & Partial<Omit<OpenFem3DEnvelopePanel, "id">>, unknown>({
  naam: "model3d.panel.update",
  beschrijving: "Een gevel- of dakpaneel wijzigen, inclusief openingen, buitenzijde en afdracht.",
  invoer: obj({ id: id("Id van het paneel."), ...schilVelden }, ["id"]),
  uitvoeren: ({ id: panelId, ...patch }, document) => {
    const model = model3dVan(document);
    vindIn(model.envelopePanels, "3D-schilpaneel", panelId);
    const nieuw = updateOpenFem3DEnvelopePanel(model, panelId, patch);
    return { uitkomst: { panel: vindIn(nieuw.envelopePanels, "3D-schilpaneel", panelId) }, document: met(document, nieuw) };
  },
});
const schilWeg = documentCommando<{ id: number }, unknown>({
  naam: "model3d.panel.delete",
  beschrijving: "Een gevel- of dakpaneel verwijderen; knopen en staven blijven staan.",
  invoer: obj({ id: id("Id van het paneel.") }, ["id"]),
  uitvoeren: ({ id: panelId }, document) => {
    const model = model3dVan(document);
    vindIn(model.envelopePanels, "3D-schilpaneel", panelId);
    return { uitkomst: { deletedPanelId: panelId }, document: met(document, removeOpenFem3DEnvelopePanel(model, panelId)) };
  },
});
const schilLastMaken = documentCommando<{ id: number; caseId?: number; q: number; direction: "normal" | "gravity" | "verticalSurface" }, unknown>({
  naam: "model3d.panel.createLoad",
  beschrijving: "Een vlaklast uit een gevel- of dakpaneel maken met dezelfde afdracht als een handmatig belastingvlak.",
  invoer: obj({ id: id("Id van het paneel."), caseId: gevalId,
    q: getal("Lastintensiteit in kN/m²; bij normal positief naar buiten."),
    direction: vlakVelden.direction }, ["id", "q", "direction"]),
  uitvoeren: ({ id: panelId, caseId, q, direction }, document) => {
    const model = model3dVan(document);
    vindIn(model.envelopePanels, "3D-schilpaneel", panelId);
    const nieuw = addOpenFem3DEnvelopePanelLoad(model, panelId, geval(document, caseId), q, direction);
    return { uitkomst: { loadPanel: nieuwElement(model.loadPanels, nieuw.loadPanels) }, document: met(document, nieuw) };
  },
});

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
  opleggingZetten, opleggingenZetten, verenZetten, opgelegdZetten, opleggingWeg, opleggingPlaatsen, puntlastPlaatsen,
  knoopLastToevoegen, knoopLastWijzigen, lastVerwijderen("knooplast", "loads", "model3d.load.nodal.delete", removeOpenFem3DNodalLoad),
  staafLastToevoegen, staafLastWijzigen, lastVerwijderen("lijnlast", "memberLoads", "model3d.load.member.delete", removeOpenFem3DMemberLoad),
  puntLastToevoegen, puntLastWijzigen, lastVerwijderen("puntlast", "memberPointLoads", "model3d.load.memberPoint.delete", removeOpenFem3DMemberPointLoad),
  temperatuurToevoegen, temperatuurWijzigen, lastVerwijderen("temperatuurbelasting", "thermalLoads", "model3d.load.thermal.delete", removeOpenFem3DThermalLoad),
  vlakLastToevoegen, vlakLastWijzigen, lastVerwijderen("oppervlaktebelasting", "surfaceLoads", "model3d.load.surface.delete", removeOpenFem3DSurfaceLoad),
  vlakToevoegen, vlakWijzigen, vlakWeg, vlakDupliceren, plaatNaarVlakken,
  schilToevoegen, schilWijzigen, schilWeg, schilLastMaken,
  schijfToevoegen, schijfWeg, trekAlleen, instellingen,
];

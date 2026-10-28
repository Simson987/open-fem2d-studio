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
  removeOpenFem3DBeam, removeOpenFem3DNode, removeOpenFem3DOpeningLintel, removeOpenFem3DPlate, setOpenFem3DBeamBedding,
  setOpenFem3DOpeningLintel, setOpenFem3DPlateMasonry, type OpenFem3DLintelInput, setOpenFem3DBeamEndHinge, setOpenFem3DPlateBedding,
  setOpenFem3DReleasePreset, splitOpenFem3DBeam, updateOpenFem3DBeam, updateOpenFem3DNode, updateOpenFem3DPlate,
  type OpenFem3DBeamBedding, type OpenFem3DBeamEnd, type OpenFem3DBeamPatch, type OpenFem3DEndReleases, type OpenFem3DModel, type OpenFem3DPlateBedding,
  type OpenFem3DPlateBoundarySegment, type OpenFem3DPlateEdgeSupport, type OpenFem3DReleasePreset,
} from "../../components/openFem3d/openFem3dModel";
import { connectOpenFem3DNodesToBeams, OPEN_FEM_3D_CONNECT_TOLERANCE_MM } from "../../components/openFem3d/openFem3dAansluiten";
import { mergeOpenFem3DNodes, OPEN_FEM_3D_MERGE_TOLERANCE_MM } from "../../components/openFem3d/openFem3dSamenvoegen";
import { openFem3DPlateGroundSide } from "../../components/openFem3d/openFem3dPlateBedding";
import {
  OPEN_FEM_3D_LINTEL_DEFAULT, openFem3DLintelDesign, type OpenFem3DMasonryWall,
} from "../../components/openFem3d/openFem3dMetselwerkwand";
import { VERBINDINGSTOLERANTIE_MAX_MM, VERBINDINGSTOLERANTIE_MIN_MM } from "../../lib/modelControle";
import { keurOpenFem3DStaafdoorsnede, onbekendeOpenFem3DDoorsneden } from "../../components/openFem3d/openFem3dDoorsnedeKeuring";

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
/**
 * Een 3D-staaf met een profiel of materiaal dat de rekenkern niet kent, wordt
 * al bij het invoeren geweigerd (#230) — met staafnummer, de onbekende naam en
 * bekende namen als suggestie. De regel: `keurOpenFem3DStaafdoorsnede`.
 */
function keurStaafdoorsnede(beam: { id: number; material?: string; profileName?: string }): void {
  const fout = keurOpenFem3DStaafdoorsnede(beam);
  if (!fout) return;
  throw new ApiFout(
    "INVOER_ONGELDIG",
    `3D-staaf ${beam.id}: ${fout.reden}. De staaf is niet opgeslagen.${fout.suggestie}`,
    { beamId: beam.id, profileName: fout.profileName, material: fout.material },
  );
}

function vindPlaat(model: OpenFem3DModel, plateId: number) {
  const plate = (model.plates ?? []).find((item) => item.id === plateId);
  if (!plate) throw nietGevonden("3D-plaat", plateId);
  return plate;
}

/**
 * De grondzijde van een plaat op bedding ("+Y", "−X", "−Z" …), of null zonder
 * bedding. Bij een wand ligt die zijde vast door de plaatassen (#107).
 */
function grondzijde(model: OpenFem3DModel, plateId: number): string | null {
  const plate = vindPlaat(model, plateId);
  return plate.bedding ? openFem3DPlateGroundSide(model, plate)?.side ?? null : null;
}

/**
 * Waarschuwingen bij wanden op bedding: de grondzijde volgt uit de plaatassen
 * en is niet te kiezen (een wand in het XZ-vlak heeft de grond aan +Y, in het
 * YZ-vlak aan −X). Ligt de grond aan de andere kant, dan zijn zakking en
 * gronddruk van teken omgekeerd en werkt alleen druk aan de verkeerde kant.
 * Dezelfde regel als het eigenschappenpaneel en de melding van de rekenkern.
 */
function wandWaarschuwingen(model: OpenFem3DModel, plateIds: readonly number[]): string[] {
  return plateIds.flatMap((plateId) => {
    const plate = vindPlaat(model, plateId);
    const zijde = plate.bedding ? openFem3DPlateGroundSide(model, plate) : null;
    if (!plate.bedding || !zijde?.vertical) return [];
    const druk = plate.bedding.compressionOnly
      ? "; met alleen druk laat de grond dan juist los waar de wand haar in duwt: reken die wand zonder alleen druk"
      : "";
    return [`3D-plaat ${plateId} staat verticaal (een wand): de grond ligt volgens de plaatassen aan de ${zijde.side}-zijde. Die zijde volgt uit de assenafspraak en is niet te kiezen. Ligt de grond aan de andere kant (bij een kelder bij twee van de vier wanden), dan zijn zakking en gronddruk van teken omgekeerd${druk}.`];
  });
}

/** De uitkomst van een plaatcommando, met de waarschuwingen bij wanden op bedding als die er zijn. */
function metWaarschuwingen<T extends object>(uitkomst: T, model: OpenFem3DModel, plateIds: readonly number[]): T & { warnings?: string[] } {
  const warnings = wandWaarschuwingen(model, plateIds);
  return warnings.length > 0 ? { ...uitkomst, warnings } : uitkomst;
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
/** Plaat op bedding (#107): dezelfde velden als het model en het rekencontract. */
const plaatBedding = obj({
  kKnPerM3: getal("Beddingsconstante k in kN/m³, loodrecht op het plaatvlak. De grond ligt aan de onderzijde: tegen de plaatnormaal in (de z-as van de plaatassen; bij een vloer globaal −Z). Bij een wand legt de assenafspraak de grondzijde vast, los van de knoopvolgorde, en is zij niet te kiezen: een wand in het XZ-vlak heeft de grond aan +Y, een wand in het YZ-vlak aan −X (de uitkomst noemt haar in groundSide en waarschuwt in warnings). Ligt de grond aan de andere kant, dan zijn zakking en gronddruk van teken omgekeerd en is alleen druk niet bruikbaar. De rekenkern zet op elke knoop van het rekennet een veer k·A_trib; zonder oplegging in het plaatvlak houdt zij de plaat daar vast zolang de belasting loodrecht op de plaat staat.", { exclusiveMinimum: 0 }),
  compressionOnly: jaNee("Alleen druk: de veren vallen weg waar de plaat van de grond loskomt (de grond trekt niet)."),
}, ["kKnPerM3"], "Plaat op bedding (Winkler), bijvoorbeeld een vloer op zand: de grond steunt de plaat over haar hele oppervlak. Het resultaat geeft per plaat de zakking en de gronddruk per knoop van het rekennet.");
const staafVelden = {
  profileName: tekst("Profielnaam uit de bibliotheek of een bewaarde eigen doorsnede, bijv. \"IPE 200\", \"HEA 300\", \"CHS 88.9x4\", \"EIGEN:Mijn doorsnede\".", { minLength: 1 }),
  profileNameEnd: tekst(
    "Verlopende staaf: het profiel aan het EINDE (eindknoop); de maten verlopen lineair van profileName (beginknoop) " +
    "naar dit profiel. Dezelfde regels als een 2D-staaf: rechthoek naar rechthoek (\"100x500\" → \"100x300\") of I/H-profiel " +
    "naar I/H-profiel uit de staalcatalogus (\"IPE 500\" → \"IPE 300\", gerekend als gelast I-profiel zonder afrondingsstraal); " +
    "kokers, buizen, hoeklijnen, U-profielen, kruislaaghout en beton kennen geen verloop en worden met de reden geweigerd. " +
    "Gelijk aan profileName = prismatisch. De kern rekent de staaf in gelijke delen met elk de doorsnede van hun midden.",
    { minLength: 1 },
  ),
  material: tekst("Materiaal, bijv. \"S235\", \"S355\", \"C24\", \"C30/37\".", { minLength: 1 }),
  rollAngleDeg: getal("Rotatie van de lokale y/z-assen om de staafas, in graden."),
  releases: scharnieren,
  tensionOnly: jaNee("Trek-alleen staaf (bijv. een windverband): valt weg zolang hij op druk staat."),
  shearDeformation: jaNee("Afschuifvervorming (Timoshenko) meenemen; gebruikt Av;y en Av;z. Standaard uit (Euler–Bernoulli)."),
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
  profileName?: string; profileNameEnd?: string; material?: string; rollAngleDeg?: number; releases?: Partial<OpenFem3DEndReleases>;
  tensionOnly?: boolean; shearDeformation?: boolean; bedding?: OpenFem3DBeamBedding; name?: string; group?: string;
}
type Wisbaar<T> = { [K in keyof T]?: T[K] | null };

function naarPatch(invoer: Wisbaar<StaafVeldenInvoer> & { startNodeId?: number; endNodeId?: number }): OpenFem3DBeamPatch {
  const { rollAngleDeg, tensionOnly, shearDeformation, ...rest } = invoer;
  return {
    ...rest,
    ...(rollAngleDeg !== undefined ? { rollAngleRad: rollAngleDeg === null ? null : rollAngleDeg * RAD_PER_GRAAD } : {}),
    ...(tensionOnly !== undefined && tensionOnly !== null ? { tensionOnly } : {}),
    ...(shearDeformation !== undefined && shearDeformation !== null ? { shearDeformation } : {}),
  } as OpenFem3DBeamPatch;
}

// ── Commando's ────────────────────────────────────────────────────────────

const modelLezen = documentCommando<Record<string, never>, unknown>({
  naam: "model3d.get",
  beschrijving: "Het 3D-model lezen: knopen, staven, platen, opleggingen, lasten, belastingvlakken en schijven, met de aantallen. Staan er staven in met een profiel of materiaal dat Berekenen weigert (bijvoorbeeld uit een met de hand bewerkt projectbestand), dan noemt onbekendeDoorsneden ze met staafnummer, namen en reden.",
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
        // #230: staven met een profiel of materiaal dat Berekenen weigert,
        // al bij het lezen gemeld (alleen als er zulke staven zijn).
        ...(() => {
          const onbekend = onbekendeOpenFem3DDoorsneden(model);
          return onbekend.length > 0 ? { onbekendeDoorsneden: onbekend.map(({ suggestie: _s, ...rest }) => rest) } : {};
        })(),
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
  beschrijving: "Een 3D-staaf tussen twee bestaande knopen toevoegen. Zonder profiel en materiaal: IPE 200 in S235, net als het tekengereedschap. Met profileNameEnd een verlopende staaf (begin → eind, lineair). Een onbekend profiel of materiaal, of een combinatie die niet bij elkaar past (\"IPE 300\" in C24), wordt geweigerd met de onbekende naam en bekende namen als suggestie; de staaf wordt dan niet opgeslagen.",
  invoer: obj({ startNodeId: knoopId, endNodeId: knoopId, ...staafVelden }, ["startNodeId", "endNodeId"]),
  uitvoeren: ({ rollAngleDeg, ...rest }, document) => {
    const { model, beam } = addOpenFem3DBeam(model3dVan(document), {
      ...rest, ...(rollAngleDeg !== undefined ? { rollAngleRad: rollAngleDeg * RAD_PER_GRAAD } : {}),
    });
    keurStaafdoorsnede(beam);
    return { uitkomst: { beam }, document: metModel3d(document, model) };
  },
});

const staafWijzigen = documentCommando<{ id: number; startNodeId?: number; endNodeId?: number } & Wisbaar<StaafVeldenInvoer>, unknown>({
  naam: "model3d.beam.update",
  beschrijving: "Eigenschappen of knopen van een 3D-staaf wijzigen. null wist een optioneel veld; lasten en toetsinstellingen blijven. Een nieuw profiel of materiaal dat niet meer bij het eindprofiel van een verlopende staaf past, wordt geweigerd: geef dan ook profileNameEnd (of null). Een onbekend profiel of materiaal wordt eveneens geweigerd, zoals bij model3d.beam.add.",
  invoer: obj({
    id: id("Id van de staaf."),
    startNodeId: knoopId, endNodeId: knoopId,
    profileName: ofNull(staafVelden.profileName),
    profileNameEnd: ofNull(staafVelden.profileNameEnd, "Eindprofiel van een verlopende staaf; null maakt de staaf prismatisch."),
    material: ofNull(staafVelden.material),
    rollAngleDeg: ofNull(staafVelden.rollAngleDeg), releases: ofNull(scharnieren),
    tensionOnly: staafVelden.tensionOnly, shearDeformation: staafVelden.shearDeformation,
    bedding: ofNull(bedding, "Staaf op bedding; null haalt de bedding weg."),
    name: ofNull(staafVelden.name), group: ofNull(staafVelden.group),
  }, ["id"]),
  uitvoeren: ({ id: beamId, ...rest }, document) => {
    const huidig = model3dVan(document);
    vindStaaf(huidig, beamId);
    const model = updateOpenFem3DBeam(huidig, beamId, naarPatch(rest));
    // Alleen keuren als profiel of materiaal in deze wijziging zit: een oude
    // ongeldige staaf blijft dan nog te verplaatsen of te hernoemen.
    if (rest.profileName !== undefined || rest.material !== undefined) keurStaafdoorsnede(vindStaaf(model, beamId));
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

const knopenAansluiten = documentCommando<{ toleranceMm?: number; beamIds?: number[]; nodeIds?: number[] }, unknown>({
  naam: "model3d.beam.connectNodes",
  beschrijving: "Knopen op staven aansluiten (issue #63), zoals de lintknop Knopen aansluiten en de knop Aansluiten in de modelcontrole: elke 3D-staaf waarop een knoop ligt zonder eraan vast te zitten, wordt in één keer op al die knopen gesplitst. Een knoop ligt op een staaf als hij niet haar begin- of eindknoop is, hoogstens toleranceMm van de staafas af ligt, en zijn projectie op de as verder dan toleranceMm van beide staafeinden ligt (langs de as gemeten; geen stompje). De knoop wordt niet verschoven: ligt hij net naast de as, dan lopen de delen naar de knoop. Lijnlasten (lokaal en globaal), puntlasten, temperatuur, scharnieren (begin op het eerste deel, eind op het laatste), profiel, materiaal, rolhoek, trek-alleen, bedding en groep gaan mee; de oorspronkelijke id blijft bij het eerste deel. Zonder beamIds en nodeIds het hele model; anders alleen de paren met een genoemde knoop of een genoemde staaf. Geeft per gesplitste staaf de knopen en de delen (splits, met parts), het aantal gesplitste staven (count) en aangesloten knopen (nodeCount), en wat overgeslagen is (skipped: nearNode = te dicht bij een ander knippunt, met otherNodeId; duplicate = de knip zou een bestaande staaf verdubbelen, want de staven overlappen, met otherBeamId). Eén stap ongedaan maken.",
  invoer: obj({
    toleranceMm: getal(
      `Verbindingstolerantie in mm (${VERBINDINGSTOLERANTIE_MIN_MM}–${VERBINDINGSTOLERANTIE_MAX_MM}); weglaten = ${OPEN_FEM_3D_CONNECT_TOLERANCE_MM} mm, de standaard van de app.`,
      { minimum: VERBINDINGSTOLERANTIE_MIN_MM, maximum: VERBINDINGSTOLERANTIE_MAX_MM },
    ),
    beamIds: lijst(id("Id van een staaf."), "Alleen deze staven splitsen (op elke knoop die erop ligt).", { minItems: 1 }),
    nodeIds: lijst(knoopId, "Alleen deze knopen aansluiten (op elke staaf waarop ze liggen).", { minItems: 1 }),
  }, []),
  uitvoeren: ({ toleranceMm, beamIds, nodeIds }, document) => {
    const huidig = model3dVan(document);
    for (const beamId of beamIds ?? []) vindStaaf(huidig, beamId);
    for (const nodeId of nodeIds ?? []) vindKnoop(huidig, nodeId);
    const resultaat = connectOpenFem3DNodesToBeams(huidig, {
      ...(toleranceMm !== undefined ? { toleranceMm } : {}),
      ...(beamIds ? { beamIds } : {}),
      ...(nodeIds ? { nodeIds } : {}),
    });
    return {
      uitkomst: {
        splits: resultaat.splits, count: resultaat.splits.length, nodeCount: resultaat.nodeCount, skipped: resultaat.skipped,
      },
      ...(resultaat.model !== huidig ? { document: metModel3d(document, resultaat.model) } : {}),
    };
  },
});

const knopenSamenvoegen = documentCommando<{ toleranceMm?: number; nodeIds?: number[] }, unknown>({
  naam: "model3d.nodes.merge",
  beschrijving: "Knopen samenvoegen (issue #75), zoals de lintknop Knopen samenvoegen en de knop Samenvoegen in de modelcontrole: 3D-knopen die binnen toleranceMm van elkaar liggen (transitief: een groep), worden één knoop. De knoop met de laagste id blijft op zijn plek; staven, platen (hoeken, getekende randen met boogstuurknopen, openingen), knooplasten, opleggingen, schijven, belastingvlakken en het level gaan naar hem. Een groep breder dan 2 × toleranceMm wordt geweigerd (tooWide): zo ver mag een verbinding niet verschuiven. Opleggingen: de geblokkeerde vrijheidsgraden samen; een veer en een blokkering in dezelfde richting: de blokkering wint (notes: springOverruled); twee veren of verschillende opgelegde verplaatsingen in één richting: geweigerd (springs, prescribed). Een staaf van lengte 0 verdwijnt met haar lasten (removedBeams); een staaf die omhangt houdt haar lasten over dezelfde fractie van haar lengte. Een dubbele staaf (dezelfde eindknopen, in welke volgorde ook) blijft één keer, de laagste id, met de lasten van beide (mergedBeams; reversed: in omgekeerde richting, posities gespiegeld en de lokale componenten volgens de lokale assen: met dezelfde rolhoek qy, py en de temperatuurgradiënt in y van teken om, qz en pz niet; een globale lijnlast houdt zijn richting). Verschillen de staven in profiel, materiaal, stand van de doorsnede, scharnieren, trek-alleen, bedding, toetsinstellingen of groep, of sluit een belastingvlak er maar één uit: geweigerd (beamProperties, beamExcluded). Verder geweigerd: verschillende levels (levels), een plaat op een level waarvan de blijvende knoop niet op die hoogte ligt (levelPlate), twee schijven (diaphragms) of een schijf die niet meer op één hoogte ligt (diaphragmHeight), een plaat, opening of belastingvlak met minder dan drie hoeken, een rand die zichzelf raakt, een ontaarde boog, een niet meer vlakke plaat of een randoplegging op een rand van lengte 0. Weigeren gaat per groep: de rest wordt samengevoegd. Zonder nodeIds het hele model; anders alleen de groepen met een genoemde knoop (de paren met die knoop). Geeft groups (keepNodeId, nodeIds die verdwenen, distanceMm), count (groepen), nodeCount (verdwenen knopen), removedBeams, mergedBeams, plates (hoeken die wegvielen), notes en refused (per groep nodeIds, keepNodeId en reason met kind). Eén stap ongedaan maken.",
  invoer: obj({
    toleranceMm: getal(
      `Tolerantie in mm (${VERBINDINGSTOLERANTIE_MIN_MM}–${VERBINDINGSTOLERANTIE_MAX_MM}); weglaten = ${OPEN_FEM_3D_MERGE_TOLERANCE_MM} mm, de verbindingstolerantie van de app.`,
      { minimum: VERBINDINGSTOLERANTIE_MIN_MM, maximum: VERBINDINGSTOLERANTIE_MAX_MM },
    ),
    nodeIds: lijst(knoopId, "Alleen de groepen rond deze knopen samenvoegen (de paren met een van deze knopen).", { minItems: 1 }),
  }, []),
  uitvoeren: ({ toleranceMm, nodeIds }, document) => {
    const huidig = model3dVan(document);
    for (const nodeId of nodeIds ?? []) vindKnoop(huidig, nodeId);
    const resultaat = mergeOpenFem3DNodes(huidig, {
      ...(toleranceMm !== undefined ? { toleranceMm } : {}),
      ...(nodeIds ? { nodeIds } : {}),
    });
    return {
      uitkomst: {
        groups: resultaat.groups, count: resultaat.groups.length, nodeCount: resultaat.nodeCount,
        removedBeams: resultaat.removedBeams, mergedBeams: resultaat.mergedBeams, plates: resultaat.plates,
        notes: resultaat.notes, refused: resultaat.refused,
      },
      ...(resultaat.model !== huidig ? { document: metModel3d(document, resultaat.model) } : {}),
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
  bedding?: OpenFem3DPlateBedding;
}, unknown>({
  naam: "model3d.plate.add",
  beschrijving: "Een vlakke 3D-plaat (schaalelementen) toevoegen op bestaande knopen in één vlak.",
  invoer: obj({
    nodeIds: contour("de plaat"),
    thicknessM: getal("Dikte in m.", { exclusiveMinimum: 0 }),
    material: tekst("Materiaal, bijv. \"C30/37\".", { minLength: 1 }),
    cornerRadiusM: getal("Afrondingsstraal van de hoeken in m.", { minimum: 0 }),
    boundary: lijst(randSegment, "Getekende contour met rechte stukken en bogen; ontbreekt = rechte randen tussen nodeIds."),
    bedding: plaatBedding,
  }, ["nodeIds", "thicknessM"]),
  uitvoeren: ({ nodeIds, ...opties }, document) => {
    const huidig = model3dVan(document);
    const model = addOpenFem3DPlate(huidig, nodeIds, opties);
    const plate = nieuwElement(huidig.plates, model.plates);
    return { uitkomst: metWaarschuwingen({ plate }, model, [plate.id]), document: metModel3d(document, model) };
  },
});

const plaatWijzigen = documentCommando<{
  id: number; thicknessM?: number; material?: string; cornerRadiusM?: number; meshSizeM?: number; edgeSupports?: OpenFem3DPlateEdgeSupport[];
  bedding?: OpenFem3DPlateBedding | null;
}, unknown>({
  naam: "model3d.plate.update",
  beschrijving: "Dikte, materiaal, afronding, netgrootte, randopleggingen of bedding van een 3D-plaat wijzigen. bedding: null haalt de bedding weg.",
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
    bedding: ofNull(plaatBedding, "Plaat op bedding; null haalt de bedding weg."),
  }, ["id"]),
  uitvoeren: ({ id: plateId, ...patch }, document) => {
    const huidig = model3dVan(document);
    vindPlaat(huidig, plateId);
    const model = updateOpenFem3DPlate(huidig, plateId, patch);
    return { uitkomst: metWaarschuwingen({ plate: vindPlaat(model, plateId) }, model, [plateId]), document: metModel3d(document, model) };
  },
});

const plaatBeddingZetten = documentCommando<{ plateIds: number[]; bedding: OpenFem3DPlateBedding | null }, unknown>({
  naam: "model3d.plate.setBedding",
  beschrijving: "Eén of meer 3D-platen op dezelfde bedding zetten (Winkler, bijvoorbeeld een vloer op zand; zoals het vinkje Op bedding in het eigenschappenpaneel), of de bedding weghalen met null. Eén stap ongedaan maken. De uitkomst noemt per plaat de grondzijde (groundSide, bijv. \"−Z\" onder een vloer) en waarschuwt bij een wand (warnings): daar ligt die zijde vast door de plaatassen.",
  invoer: obj({
    plateIds: lijst(id("Id van een plaat."), "De platen.", { minItems: 1 }),
    bedding: ofNull(plaatBedding, "De bedding voor alle genoemde platen; null haalt haar weg."),
  }, ["plateIds", "bedding"]),
  uitvoeren: ({ plateIds, bedding: nieuw }, document) => {
    const huidig = model3dVan(document);
    const ids = [...new Set(plateIds)];
    for (const plateId of ids) vindPlaat(huidig, plateId);
    const model = setOpenFem3DPlateBedding(huidig, ids, nieuw);
    const bedding = ids.map((plateId) => ({
      plateId, bedding: vindPlaat(model, plateId).bedding ?? null, groundSide: grondzijde(model, plateId),
    }));
    return { uitkomst: metWaarschuwingen({ plateIds: ids, bedding }, model, ids), document: metModel3d(document, model) };
  },
});

const metselwerkwand = obj({
  unitWeightKnM3: getal("Volumegewicht γ in kN/m³ (kalkzandsteen ca. 18–20); het eigen gewicht is γ·t per m² wand.", { exclusiveMinimum: 0, maximum: 100 }),
  eMpa: getal("E van het metselwerk in verticale richting, N/mm² (E = K_E·f_k, NEN-EN 1996-1-1 §3.7.2).", { exclusiveMinimum: 0 }),
}, ["unitWeightKnM3", "eMpa"], "Metselwerkwand (#97): de plaat rekent orthotroop met E verticaal = eMpa, E horizontaal = 1e-6·eMpa (de wand werkt niet als hoge ligger met de funderingsbalk samen) en G = 0,4·eMpa (NEN-EN 1996-1-1 §3.7.3; wind in het vlak gaat via afschuiving naar de fundering). De plaat moet verticaal staan; het materiaal van de plaat doet dan niet mee.");

const plaatMetselwerk = documentCommando<{ plateId: number; masonry: OpenFem3DMasonryWall | null }, unknown>({
  naam: "model3d.plate.setMasonry",
  beschrijving: "Een verticale 3D-plaat tot metselwerkwand maken (#97), of terugzetten met null (dan verdwijnen ook de lateien van haar openingen; de lateistaven blijven als gewone staven staan).",
  invoer: obj({
    plateId: id("Id van de plaat."),
    masonry: ofNull(metselwerkwand, "De metselwerkwand; null zet de plaat terug."),
  }, ["plateId", "masonry"]),
  uitvoeren: ({ plateId, masonry }, document) => {
    const huidig = model3dVan(document);
    vindPlaat(huidig, plateId);
    const model = setOpenFem3DPlateMasonry(huidig, plateId, masonry);
    return { uitkomst: { plate: vindPlaat(model, plateId) }, document: metModel3d(document, model) };
  },
});

const latei = obj({
  bearingM: getal("Opleglengte aan elke zijde van de opening, m.", { exclusiveMinimum: 0 }),
  loadSpread: keuze(["triangle60", "fullHeight"], "Lateibelasting in de lateitoets: triangle60 = driehoek met hoeken van 60° (alleen als het metselwerk boven de latei minstens zo hoog is, anders volle hoogte), fullHeight = het metselwerk over de volle hoogte. Het rekenmodel legt altijd de volle hoogte op de latei (E horizontaal ≈ 0 vormt geen boog)."),
  profileName: tekst(`Profiel van een nieuwe lateistaaf (standaard "${OPEN_FEM_3D_LINTEL_DEFAULT.profileName}"); een bestaande latei wijzig je met model3d.beam.update.`, { minLength: 1 }),
  material: tekst(`Materiaal van een nieuwe lateistaaf (standaard "${OPEN_FEM_3D_LINTEL_DEFAULT.material}").`, { minLength: 1 }),
}, ["bearingM", "loadSpread"], "Latei boven een opening: een gewone staaf langs de bovenrand van de opening, aan beide zijden met de opleglengte de wand in.");

const openingLatei = documentCommando<{ plateId: number; openingId: number; lintel: OpenFem3DLintelInput | null }, unknown>({
  naam: "model3d.plate.setLintel",
  beschrijving: "Een latei boven een opening van een metselwerkwand zetten, wijzigen of weghalen (null; dan verdwijnt ook de lateistaaf). De opening moet een rechte, horizontale bovenrand hebben en de opleggingen moeten in het metselwerk liggen. De uitkomst geeft de staaf (beamId) en de lateibelasting voor de toets (design: karakteristiek eigen gewicht van het metselwerk, met de gekozen en de toegepaste spreiding).",
  invoer: obj({
    plateId: id("Id van de metselwerkwand."),
    openingId: id("Id van de opening in die plaat."),
    lintel: ofNull(latei, "De latei; null haalt haar weg."),
  }, ["plateId", "openingId", "lintel"]),
  uitvoeren: ({ plateId, openingId, lintel }, document) => {
    const huidig = model3dVan(document);
    const plate = vindPlaat(huidig, plateId);
    if (!(plate.openings ?? []).some((opening) => opening.id === openingId)) throw nietGevonden("opening", openingId);
    const model = lintel === null
      ? removeOpenFem3DOpeningLintel(huidig, plateId, openingId)
      : setOpenFem3DOpeningLintel(huidig, plateId, openingId, lintel);
    const na = vindPlaat(model, plateId);
    const opening = (na.openings ?? []).find((item) => item.id === openingId)!;
    return {
      uitkomst: { plateId, opening, design: openFem3DLintelDesign(model, na, opening) },
      document: metModel3d(document, model),
    };
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
  staafToevoegen, staafWijzigen, staafBedding, staafVerwijderen, staafSplitsen, knopenAansluiten, knopenSamenvoegen, assenOmkeren, scharnierSituatie,
  staafeindScharnier,
  liggersOpKolommen,
  plaatToevoegen, plaatWijzigen, plaatBeddingZetten, plaatVerwijderen, openingToevoegen,
  plaatMetselwerk, openingLatei,
];

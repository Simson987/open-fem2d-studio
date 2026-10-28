/**
 * Dekking van de 3D-bediening door de API: elke functie van de 3D-editor wijst
 * naar het commando dat hetzelfde doet, of naar de fase waarin ze een commando
 * krijgt, met de reden. Zo blijft "alles is via de API te doen" waar als de
 * bediening groeit: test-api-dekking.mjs faalt zodra er een functie bij komt
 * die hier niet staat, of een commando wordt genoemd dat niet bestaat.
 *
 * Wat er gedekt wordt, en hoe de test de lijst compleet houdt:
 *  - de gereedschappen (`OpenFem3DTool`): via het type, `satisfies`;
 *  - de knoppen van het 3D-lint (HomeTab in 3D): de test tekent het lint en
 *    leest de labelsleutels;
 *  - de velden van het 3D-model (knoop, staaf, plaat, lasten, ...): via de
 *    typen, `satisfies Record<keyof T, …>`; de test zoekt elk genoemd veld op
 *    in het invoerschema van het commando;
 *  - de knoppen van het eigenschappenpaneel en zijn onderdelen: de test leest
 *    ze uit de bron;
 *  - de sneltoetsen: de toetsreeksen (lib/commandoReeks.ts) en de toetsen die
 *    de editor, het tekenvlak en de app afvangen.
 *
 * Fasen (docs/superpowers/specs/2026-10-01-api-mcp-alle-functies-design.md):
 *  2 — het 2D-model en de generatoren;
 *  3 — rekenen en toetsen: instellingen, toetsinstellingen per staaf, resultaten;
 *  4 — weergave, selectie, rapport, instellingen en export.
 * Fase 1 (het 3D-model) is af: geen functie wacht daar nog op.
 *
 * Zuiver: alleen gegevens en typen.
 */
import type { OpenFem3DTool } from "../components/openFem3d/openFem3dCommands";
import type {
  OpenFem3DBeam, OpenFem3DBeamBedding, OpenFem3DDiaphragm, OpenFem3DEndReleases, OpenFem3DEnvelopePanel, OpenFem3DLoadPanel, OpenFem3DMemberLoad,
  OpenFem3DMemberPointLoad, OpenFem3DModel, OpenFem3DNodalLoad, OpenFem3DNode, OpenFem3DPlate, OpenFem3DPlateBedding,
  OpenFem3DPlateBoundarySegment, OpenFem3DPlateEdgeSupport, OpenFem3DPlateOpening, OpenFem3DPrescribedDisplacements,
  OpenFem3DSupport, OpenFem3DSupportSprings, OpenFem3DSurfaceLoad, OpenFem3DThermalLoad, OpenFem3DVector,
} from "../components/openFem3d/openFem3dModel";
import type { GridAxisLine, LoadCase, StructuralGrid } from "../components/fem/femTypes";
import type { LoadCombination } from "../components/fem/solver/combinations";

export type Dekking =
  /** Dit commando doet hetzelfde (bij een lijst: samen). */
  | { commando: string | readonly string[] }
  /** Dit invoerveld van elk genoemd commando zet het modelveld; een punt gaat een niveau dieper. */
  | { commando: string | readonly string[]; veld: string }
  /** Nog geen commando: het komt in deze fase. */
  | { fase: 2 | 3 | 4; reden: string }
  /** Geen invoer: het model kent het zelf toe, of het volgt uit iets anders. */
  | { afgeleid: string };

const ID: Dekking = { afgeleid: "het model kent het id toe" };
const veld = (commando: string | readonly string[], naam: string): Dekking => ({ commando, veld: naam });

// ── Gereedschappen ─────────────────────────────────────────────────────────

// Het gereedschap plaatst op een knoop, staaf, plaat of het werkvlak (#76): model3d.support.place.
const OPLEGGING: Dekking = { commando: ["model3d.support.set", "model3d.support.setMany", "model3d.support.place"] };
const VEER: Dekking = { commando: ["model3d.support.setSprings", "model3d.support.place"] };
const TRANSFORMATIE: Dekking = { commando: "model3d.transform" };

export const GEREEDSCHAP_3D = {
  select: { fase: 4, reden: "selecteren hoort bij de weergave; de commando's werken met id's" },
  addNode: { commando: "model3d.node.add" },
  addBeam: { commando: "model3d.beam.add" },
  addSubNode: { commando: "model3d.beam.split" },
  addPlate: { commando: "model3d.plate.add" },
  addPlateArc: { commando: "model3d.plate.add" },
  addOpening: { commando: "model3d.plate.addOpening" },
  addOpeningArc: { commando: "model3d.plate.addOpening" },
  addMemberLoad: { commando: "model3d.load.member.add" },
  addPointLoad: { commando: "model3d.load.placePoint" },
  addLoadPanel: { commando: "model3d.loadPanel.add" },
  addEnvelopePanel: { commando: "model3d.panel.add" },
  loadPanelSpan: veld("model3d.loadPanel.update", "spanDirection"),
  beamEndHinge: { commando: "model3d.beam.setEndHinge" },
  move: TRANSFORMATIE,
  rotate: TRANSFORMATIE,
  // Ook met basispunt en doelpunt in het tekenvlak (openFem3dCopyPoints.ts): dat is dezelfde kopie met
  // dx/dy/dz = doelpunt − basispunt; de punten zelf zijn bediening, geen modelinvoer.
  copy: TRANSFORMATIE,
  mirror: TRANSFORMATIE,
  "support:fixed": OPLEGGING,
  "support:pinned": OPLEGGING,
  "support:xRoller": OPLEGGING,
  "support:yRoller": OPLEGGING,
  "support:zRoller": OPLEGGING,
  "support:revoluteX": OPLEGGING,
  "support:revoluteY": OPLEGGING,
  "support:revoluteZ": OPLEGGING,
  "spring:kx": VEER,
  "spring:ky": VEER,
  "spring:kz": VEER,
  "spring:krx": VEER,
  "spring:kry": VEER,
  "spring:krz": VEER,
} satisfies Record<OpenFem3DTool, Dekking>;

// ── Het 3D-lint (HomeTab in 3D), op de labelsleutel ─────────────────────────

const WEERGAVE: Dekking = { fase: 4, reden: "weergave" };

export const LINT_3D: Record<string, Dekking> = {
  "ribbon:home.solve": { fase: 3, reden: "rekenen" },
  "ribbon:home.new": { commando: "project.new" },
  "ribbon:home.open": { commando: "app.project.open" },
  "ribbon:home.save": { commando: "app.project.save" },
  "ribbon:home.saveAs": { commando: "app.project.save" },
  "ribbon:home.projectInfo": { fase: 3, reden: "projectgegevens en uitgangspunten (gevolgklasse, ontwerplevensduur) horen bij de rekeninstellingen" },
  "ribbon:staalhal.knop": { fase: 2, reden: "generator (wizard Stalen hal), met de andere generatoren; als MCP-tool bestaat staalhal_maken al" },
  "ribbon:home.select": GEREEDSCHAP_3D.select,
  "ribbon:home.bar": GEREEDSCHAP_3D.addBeam,
  "ribbon:home.node": GEREEDSCHAP_3D.addNode,
  "ribbon:home.subNode": GEREEDSCHAP_3D.addSubNode,
  "ribbon:home.plate": GEREEDSCHAP_3D.addPlate,
  "ribbon:home.plateArc": GEREEDSCHAP_3D.addPlateArc,
  "ribbon:home.opening": GEREEDSCHAP_3D.addOpening,
  // Knopen op staven aansluiten (issue #63): dezelfde zuivere functie, op de selectie of het hele model.
  "ribbon:openFem3d.connectNodes": { commando: "model3d.beam.connectNodes" },
  // Knopen samenvoegen (issue #75), in de groep Bewerken: dezelfde zuivere functie, op de selectie of het hele model.
  "ribbon:openFem3d.mergeNodes": { commando: "model3d.nodes.merge" },
  "ribbon:home.surfaceLoad": { commando: "model3d.load.surface.add" },
  "ribbon:home.grids": { commando: ["project.grid.set", "model3d.levels.set"] },
  "ribbon:home.pinned": OPLEGGING,
  "ribbon:home.xRoller": OPLEGGING,
  "ribbon:home.zRoller": OPLEGGING,
  "ribbon:openFem3d.yRoller": OPLEGGING,
  "ribbon:home.fixed": OPLEGGING,
  "ribbon:openFem3d.revoluteX": OPLEGGING,
  "ribbon:openFem3d.revoluteY": OPLEGGING,
  "ribbon:openFem3d.revoluteZ": OPLEGGING,
  "ribbon:home.xSpring": VEER,
  "ribbon:openFem3d.ySpring": VEER,
  "ribbon:home.zSpring": VEER,
  "ribbon:openFem3d.rotSpringX": VEER,
  "ribbon:openFem3d.rotSpringY": VEER,
  "ribbon:openFem3d.rotSpringZ": VEER,
  "ribbon:openFem3d.beamEndHinge": GEREEDSCHAP_3D.beamEndHinge,
  "ribbon:openFem3d.pinBeamsToColumns": { commando: "model3d.beam.pinToColumns" },
  // Met een selectie het formulier van de knooplast of staafpuntlast, zonder selectie het gereedschap (#77).
  "ribbon:home.pointLoad": { commando: ["model3d.load.placePoint", "model3d.load.nodal.add", "model3d.load.memberPoint.add"] },
  "ribbon:home.lineLoad": GEREEDSCHAP_3D.addMemberLoad,
  "ribbon:home.loadPanel": GEREEDSCHAP_3D.addLoadPanel,
  "ribbon:home.envelopePanel": GEREEDSCHAP_3D.addEnvelopePanel,
  "ribbon:home.plateToLoadPanel": { commando: "model3d.plate.toLoadPanels" },
  "ribbon:home.pointLoadH": { commando: "model3d.load.nodal.add" },
  "ribbon:home.moment": { commando: "model3d.load.nodal.add" },
  "ribbon:home.temp": { commando: "model3d.load.thermal.add" },
  "ribbon:home.loadCases": { commando: ["project.loadCase.add", "project.loadCase.update", "project.loadCase.delete"] },
  "ribbon:home.combinations": {
    commando: ["project.combination.add", "project.combination.update", "project.combination.delete", "project.combinations.resetToStandard"],
  },
  "ribbon:home.generateEnvelopeLoads": { commando: "model3d.envelope.generateLoads" },
  "ribbon:home.waterAccumulation": { fase: 2, reden: "generator voor het 2D-model; in 3D staat de knop uit" },
  "ribbon:home.move": TRANSFORMATIE,
  "ribbon:home.rotate": TRANSFORMATIE,
  "ribbon:home.copy": TRANSFORMATIE,
  "ribbon:home.mirror": TRANSFORMATIE,
  "ribbon:home.undo": { commando: "app.undo" },
  "ribbon:home.redo": { commando: "app.redo" },
  "common:delete": { commando: "model3d.selection.delete" },
  // Het venster Selectiefilter (issue #94): dezelfde zuivere functie, id's in en uit.
  "ribbon:home.filterSelection": { commando: "model3d.selection.filter" },
  "ribbon:openFem3d.fit": WEERGAVE,
  "ribbon:openFem3d.isoView": WEERGAVE,
  "ribbon:openFem3d.topView": WEERGAVE,
  "ribbon:openFem3d.frontView": WEERGAVE,
  "ribbon:openFem3d.sideView": WEERGAVE,
  "ribbon:openFem3d.visibility": WEERGAVE,
  // Plaatweergave (issue #78): volume, vlak of mesh; een weergavevoorkeur, geen modelwijziging.
  "ribbon:openFem3d.plateDisplayVolume": WEERGAVE,
  "ribbon:openFem3d.plateDisplaySurface": WEERGAVE,
  "ribbon:openFem3d.plateDisplayMesh": WEERGAVE,
  // Section box (issue #86): hoort bij de weergave (zichtbaarheid en views); via de
  // MCP-tool gui_configure_3d_view (section_box) in de draaiende app, nog geen API-commando.
  "ribbon:openFem3d.sectionBox": WEERGAVE,
  "ribbon:openFem3d.explode": { commando: "app.view3d.explode" },
};

// ── De velden van het 3D-model ─────────────────────────────────────────────

const knoopAddUpdate = ["model3d.node.add", "model3d.node.update"];
const staafAddUpdate = ["model3d.beam.add", "model3d.beam.update"];
const plaatAddUpdate = ["model3d.plate.add", "model3d.plate.update"];
const knooplast = ["model3d.load.nodal.add", "model3d.load.nodal.update"];
const staaflast = ["model3d.load.member.add", "model3d.load.member.update"];
const puntlast = ["model3d.load.memberPoint.add", "model3d.load.memberPoint.update"];
const thermisch = ["model3d.load.thermal.add", "model3d.load.thermal.update"];
const vlaklast = ["model3d.load.surface.add", "model3d.load.surface.update"];
const vlak = ["model3d.loadPanel.add", "model3d.loadPanel.update"];
const gevalBijToevoegen = (commando: string) => veld(commando, "caseId");
/**
 * Velden van de native Rust-3D-route (volumes, materiaalwetten, membraanplaten;
 * openFem3dNativeModel): ze komen uit een projectbestand en worden bewaard,
 * maar hebben nog geen API-commando.
 */
const NATIVE_ROUTE: Dekking = { fase: 3, reden: "native Rust-3D-route (volumes, FNL): via het projectbestand; API-commando's volgen" };
const modelLaag: Dekking = { fase: 2, reden: "3D-modellaag wordt in het project bewaard; API-commando's voor toewijzing volgen." };

type BoogRand = Extract<OpenFem3DPlateBoundarySegment, { kind: "arc" }>;

export const VELDEN_3D = {
  model: {
    nodes: { commando: "model3d.node.add" },
    beams: { commando: "model3d.beam.add" },
    layers: modelLaag,
    analysisMaterials: { commando: "model3d.material.setAnalysis" },
    supports: { commando: "model3d.support.set" },
    loads: { commando: "model3d.load.nodal.add" },
    memberLoads: { commando: "model3d.load.member.add" },
    memberPointLoads: { commando: "model3d.load.memberPoint.add" },
    thermalLoads: { commando: "model3d.load.thermal.add" },
    plates: { commando: "model3d.plate.add" },
    surfaceLoads: { commando: "model3d.load.surface.add" },
    loadPanels: { commando: "model3d.loadPanel.add" },
    envelopePanels: { commando: "model3d.panel.add" },
    generatedNodeIds: { afgeleid: "hulpknopen van de 3D-belastinggenerator worden bij genereren bijgehouden" },
    diaphragms: { commando: "model3d.diaphragm.add" },
    tensionOnlyFitAfterPermanent: veld("model3d.settings.update", "tensionOnlyFitAfterPermanent"),
    tensionOnlyCrossRule: veld("model3d.settings.update", "tensionOnlyCrossRule"),
    volumes: NATIVE_ROUTE,
    volumeBodyLoads: NATIVE_ROUTE,
    volumeFaceLoads: NATIVE_ROUTE,
    plateEdgeLoads: NATIVE_ROUTE,
    materialLoadPath: NATIVE_ROUTE,
    volumeBackend: NATIVE_ROUTE,
    volumeMaterialKinematics: NATIVE_ROUTE,
    volumeThreads: NATIVE_ROUTE,
    volumeResidualTolerance: NATIVE_ROUTE,
  } satisfies Record<keyof OpenFem3DModel, Dekking>,
  knoop: {
    id: ID,
    layerId: modelLaag,
    x: veld(knoopAddUpdate, "x"),
    y: veld(knoopAddUpdate, "y"),
    z: veld(knoopAddUpdate, "z"),
    levelId: veld("model3d.node.linkLevel", "levelId"),
    name: veld(knoopAddUpdate, "name"),
  } satisfies Record<keyof OpenFem3DNode, Dekking>,
  staaf: {
    id: ID,
    layerId: modelLaag,
    startNodeId: veld(staafAddUpdate, "startNodeId"),
    endNodeId: veld(staafAddUpdate, "endNodeId"),
    profileName: veld(staafAddUpdate, "profileName"),
    // Verlopende staaf (#73): begin → eind; update met null maakt haar prismatisch.
    profileNameEnd: veld(staafAddUpdate, "profileNameEnd"),
    material: veld(staafAddUpdate, "material"),
    checkConfig: { fase: 3, reden: "toetsinstellingen per staaf (kniklengtes, kipsteunen, betonkorf, milieuklasse)" },
    rollAngleRad: veld(staafAddUpdate, "rollAngleDeg"),
    releases: veld(staafAddUpdate, "releases"),
    tensionOnly: veld(staafAddUpdate, "tensionOnly"),
    shearDeformation: veld(staafAddUpdate, "shearDeformation"),
    // Staaf op bedding (#106); voor meer staven tegelijk ook model3d.beam.setBedding.
    bedding: veld([...staafAddUpdate, "model3d.beam.setBedding"], "bedding"),
    name: veld(staafAddUpdate, "name"),
    group: veld(staafAddUpdate, "group"),
    axialOnly: NATIVE_ROUTE,
    nonlinearLaw: NATIVE_ROUTE,
  } satisfies Record<keyof OpenFem3DBeam, Dekking>,
  bedding: {
    kKnPerM3: veld([...staafAddUpdate, "model3d.beam.setBedding"], "bedding.kKnPerM3"),
    widthM: veld([...staafAddUpdate, "model3d.beam.setBedding"], "bedding.widthM"),
    kLateralKnPerM3: veld([...staafAddUpdate, "model3d.beam.setBedding"], "bedding.kLateralKnPerM3"),
    compressionOnly: veld([...staafAddUpdate, "model3d.beam.setBedding"], "bedding.compressionOnly"),
  } satisfies Record<keyof OpenFem3DBeamBedding, Dekking>,
  eindscharnieren: {
    myStart: veld(staafAddUpdate, "releases.myStart"),
    myEnd: veld(staafAddUpdate, "releases.myEnd"),
    mzStart: veld(staafAddUpdate, "releases.mzStart"),
    mzEnd: veld(staafAddUpdate, "releases.mzEnd"),
    torsionStart: veld(staafAddUpdate, "releases.torsionStart"),
    torsionEnd: veld(staafAddUpdate, "releases.torsionEnd"),
  } satisfies Record<keyof OpenFem3DEndReleases, Dekking>,
  schijf: {
    id: ID,
    nodeIds: veld("model3d.diaphragm.add", "nodeIds"),
    name: veld("model3d.diaphragm.add", "name"),
  } satisfies Record<keyof OpenFem3DDiaphragm, Dekking>,
  oplegging: {
    nodeId: veld("model3d.support.set", "nodeId"),
    layerId: modelLaag,
    ux: veld("model3d.support.set", "ux"),
    uy: veld("model3d.support.set", "uy"),
    uz: veld("model3d.support.set", "uz"),
    rx: veld("model3d.support.set", "rx"),
    ry: veld("model3d.support.set", "ry"),
    rz: veld("model3d.support.set", "rz"),
    springs: { commando: "model3d.support.setSprings" },
    prescribed: { commando: "model3d.support.setPrescribed" },
  } satisfies Record<keyof OpenFem3DSupport, Dekking>,
  veren: {
    kxKnPerM: veld("model3d.support.setSprings", "kxKnPerM"),
    kyKnPerM: veld("model3d.support.setSprings", "kyKnPerM"),
    kzKnPerM: veld("model3d.support.setSprings", "kzKnPerM"),
    krxKnmPerRad: veld("model3d.support.setSprings", "krxKnmPerRad"),
    kryKnmPerRad: veld("model3d.support.setSprings", "kryKnmPerRad"),
    krzKnmPerRad: veld("model3d.support.setSprings", "krzKnmPerRad"),
  } satisfies Record<keyof OpenFem3DSupportSprings, Dekking>,
  voorgeschrevenVerplaatsing: {
    uxM: veld("model3d.support.setPrescribed", "uxM"),
    uyM: veld("model3d.support.setPrescribed", "uyM"),
    uzM: veld("model3d.support.setPrescribed", "uzM"),
    rxRad: veld("model3d.support.setPrescribed", "rxRad"),
    ryRad: veld("model3d.support.setPrescribed", "ryRad"),
    rzRad: veld("model3d.support.setPrescribed", "rzRad"),
  } satisfies Record<keyof OpenFem3DPrescribedDisplacements, Dekking>,
  knooplast: {
    id: ID,
    layerId: modelLaag,
    nodeId: veld("model3d.load.nodal.add", "nodeId"),
    caseId: gevalBijToevoegen("model3d.load.nodal.add"),
    fx: veld(knooplast, "fx"),
    fy: veld(knooplast, "fy"),
    fz: veld(knooplast, "fz"),
    mx: veld(knooplast, "mx"),
    my: veld(knooplast, "my"),
    mz: veld(knooplast, "mz"),
    generated: { afgeleid: "NBC-deelwindgenerator bewaart bron en gevalsleutel bij zijn knooplasten" },
  } satisfies Record<keyof OpenFem3DNodalLoad, Dekking>,
  staaflast: {
    id: ID,
    layerId: modelLaag,
    beamId: veld("model3d.load.member.add", "beamId"),
    caseId: gevalBijToevoegen("model3d.load.member.add"),
    qyStart: veld(staaflast, "qyStart"),
    qyEnd: veld(staaflast, "qyEnd"),
    qzStart: veld(staaflast, "qzStart"),
    qzEnd: veld(staaflast, "qzEnd"),
    // Globale lijnlast (issue #80).
    globalDirection: veld(staaflast, "globalDirection"),
    qStart: veld(staaflast, "qStart"),
    qEnd: veld(staaflast, "qEnd"),
    perProjection: veld(staaflast, "perProjection"),
    startPositionM: veld(staaflast, "startPositionM"),
    endPositionM: veld(staaflast, "endPositionM"),
  } satisfies Record<keyof OpenFem3DMemberLoad, Dekking>,
  staafpuntlast: {
    id: ID,
    layerId: modelLaag,
    beamId: veld("model3d.load.memberPoint.add", "beamId"),
    caseId: gevalBijToevoegen("model3d.load.memberPoint.add"),
    py: veld(puntlast, "py"),
    pz: veld(puntlast, "pz"),
    positionM: veld(puntlast, "positionM"),
  } satisfies Record<keyof OpenFem3DMemberPointLoad, Dekking>,
  temperatuurlast: {
    id: ID,
    layerId: modelLaag,
    beamId: veld("model3d.load.thermal.add", "beamId"),
    caseId: gevalBijToevoegen("model3d.load.thermal.add"),
    deltaTUniformK: veld(thermisch, "deltaTUniformK"),
    deltaTGradientYK: veld(thermisch, "deltaTGradientYK"),
    deltaTGradientZK: veld(thermisch, "deltaTGradientZK"),
  } satisfies Record<keyof OpenFem3DThermalLoad, Dekking>,
  plaat: {
    id: ID,
    layerId: modelLaag,
    nodeIds: veld("model3d.plate.add", "nodeIds"),
    boundary: veld("model3d.plate.add", "boundary"),
    thicknessM: veld(plaatAddUpdate, "thicknessM"),
    material: veld(plaatAddUpdate, "material"),
    cornerRadiusM: veld(plaatAddUpdate, "cornerRadiusM"),
    openings: { commando: "model3d.plate.addOpening" },
    levelId: veld("model3d.node.linkLevel", "plateIds"),
    meshSizeM: veld("model3d.plate.update", "meshSizeM"),
    edgeSupports: veld("model3d.plate.update", "edgeSupports"),
    // Plaat op bedding (#107); voor meer platen tegelijk ook model3d.plate.setBedding.
    bedding: veld([...plaatAddUpdate, "model3d.plate.setBedding"], "bedding"),
    membraneOnly: NATIVE_ROUTE,
    membraneEMpa: NATIVE_ROUTE,
    membranePoisson: NATIVE_ROUTE,
    modulusCurve: NATIVE_ROUTE,
    nonlinearLaw: NATIVE_ROUTE,
    maxCellSizeM: NATIVE_ROUTE,
    reinforcement: NATIVE_ROUTE,
    threeLayer: NATIVE_ROUTE,
  } satisfies Record<keyof OpenFem3DPlate, Dekking>,
  plaatbedding: {
    kKnPerM3: veld([...plaatAddUpdate, "model3d.plate.setBedding"], "bedding.kKnPerM3"),
    compressionOnly: veld([...plaatAddUpdate, "model3d.plate.setBedding"], "bedding.compressionOnly"),
  } satisfies Record<keyof OpenFem3DPlateBedding, Dekking>,
  plaatrand: {
    kind: veld(["model3d.plate.add", "model3d.plate.addOpening"], "boundary.kind"),
    startNodeId: veld(["model3d.plate.add", "model3d.plate.addOpening"], "boundary.startNodeId"),
    controlNodeId: veld(["model3d.plate.add", "model3d.plate.addOpening"], "boundary.controlNodeId"),
    endNodeId: veld(["model3d.plate.add", "model3d.plate.addOpening"], "boundary.endNodeId"),
  } satisfies Record<keyof BoogRand, Dekking>,
  opening: {
    id: ID,
    nodeIds: veld("model3d.plate.addOpening", "nodeIds"),
    boundary: veld("model3d.plate.addOpening", "boundary"),
    cornerRadiusM: veld("model3d.plate.addOpening", "cornerRadiusM"),
  } satisfies Record<keyof OpenFem3DPlateOpening, Dekking>,
  randoplegging: {
    edge: veld("model3d.plate.update", "edgeSupports.edge"),
    ux: veld("model3d.plate.update", "edgeSupports.ux"),
    uy: veld("model3d.plate.update", "edgeSupports.uy"),
    uz: veld("model3d.plate.update", "edgeSupports.uz"),
    rx: veld("model3d.plate.update", "edgeSupports.rx"),
    ry: veld("model3d.plate.update", "edgeSupports.ry"),
    rz: veld("model3d.plate.update", "edgeSupports.rz"),
  } satisfies Record<keyof OpenFem3DPlateEdgeSupport, Dekking>,
  vlaklast: {
    id: ID,
    layerId: modelLaag,
    plateId: veld("model3d.load.surface.add", "plateId"),
    caseId: gevalBijToevoegen("model3d.load.surface.add"),
    qx: veld(vlaklast, "qx"),
    qy: veld(vlaklast, "qy"),
    qz: veld(vlaklast, "qz"),
  } satisfies Record<keyof OpenFem3DSurfaceLoad, Dekking>,
  belastingvlak: {
    id: ID,
    layerId: modelLaag,
    generated: { afgeleid: "de 3D-generator bewaart herkomst, zone en normwaarden bij zijn belastingvlakken" },
    nodeIds: veld("model3d.loadPanel.add", "nodeIds"),
    caseId: veld(vlak, "caseId"),
    q: veld(vlak, "q"),
    direction: veld(vlak, "direction"),
    distribution: veld(vlak, "distribution"),
    spanDirection: veld(vlak, "spanDirection"),
    excludedBeamIds: veld(vlak, "excludedBeamIds"),
    openings: veld(vlak, "openings"),
  } satisfies Record<keyof OpenFem3DLoadPanel, Dekking>,
  schilpaneel: {
    id: ID,
    layerId: modelLaag,
    nodeIds: veld("model3d.panel.add", "nodeIds"),
    type: veld("model3d.panel.add", "type"),
    flipOuterSide: veld("model3d.panel.update", "flipOuterSide"),
    distribution: veld("model3d.panel.update", "distribution"),
    spanDirection: veld("model3d.panel.update", "spanDirection"),
    openings: veld("model3d.panel.update", "openings"),
    claddingWeightKnPerM2: veld("model3d.panel.update", "claddingWeightKnPerM2"),
    name: veld("model3d.panel.update", "name"),
  } satisfies Record<keyof OpenFem3DEnvelopePanel, Dekking>,
  overspanningsrichting: {
    x: veld(vlak, "spanDirection.x"),
    y: veld(vlak, "spanDirection.y"),
    z: veld(vlak, "spanDirection.z"),
  } satisfies Record<keyof OpenFem3DVector, Dekking>,
  stramien: {
    enabled: veld("project.grid.set", "enabled"),
    xAxes: veld("project.grid.set", "xAxes"),
    yAxes: veld("project.grid.set", "yAxes"),
    zAxes: veld("model3d.levels.set", "levels"),
  } satisfies Record<keyof StructuralGrid, Dekking>,
  stramienas: {
    id: { afgeleid: "een as houdt het id van de as met dezelfde naam, een nieuwe krijgt er een" },
    label: veld("project.grid.set", "xAxes.label"),
    position: veld("project.grid.set", "xAxes.positionM"),
  } satisfies Record<keyof GridAxisLine, Dekking>,
  belastinggeval: {
    id: ID,
    name: veld(["project.loadCase.add", "project.loadCase.update"], "name"),
    type: veld(["project.loadCase.add", "project.loadCase.update"], "type"),
    categorie: veld(["project.loadCase.add", "project.loadCase.update"], "categorie"),
    gegenereerd: { afgeleid: "de windgenerator markeert de gevallen die hij maakt (fase 2)" },
    eigenGewicht: { afgeleid: "het standaardgeval Eigen gewicht draagt het kenmerk" },
  } satisfies Record<keyof LoadCase, Dekking>,
  combinatie: {
    id: ID,
    name: veld(["project.combination.add", "project.combination.update"], "name"),
    type: veld(["project.combination.add", "project.combination.update"], "type"),
    formula: veld(["project.combination.add", "project.combination.update"], "formula"),
    factors: veld(["project.combination.add", "project.combination.update"], "factors"),
    standaard: { afgeleid: "de standaardset zet het (project.combinations.resetToStandard)" },
    scheefstandRichting: { afgeleid: "rekenvariant van de scheefstand, gezet bij het rekenen en niet opgeslagen" },
    scheefstandAs: { afgeleid: "rekenvariant van de scheefstand, gezet bij het rekenen en niet opgeslagen" },
    eindtoestand: { afgeleid: "rekenvariant met de eindstijfheid, gezet bij het rekenen en niet opgeslagen" },
    veldpatroon: { afgeleid: "rekenvariant met veldsgewijs geplaatste veranderlijke vloerbelasting (issue #219), gezet bij het rekenen en niet opgeslagen" },
  } satisfies Record<keyof LoadCombination, Dekking>,
};

// ── Knoppen in het eigenschappenpaneel, per bestand ────────────────────────
// Op de labelsleutel; een knop zonder letterlijke sleutel op zijn klikfunctie.
// Een bestand staat in src/components/openFem3d/, of met een map ervoor onder
// src/components/ (een venster dat 2D en 3D delen).

export const PANEEL_3D: Record<string, Record<string, Dekking>> = {
  "OpenFem3DProperties.tsx": {
    "openFem3d.general": WEERGAVE,
    "openFem3d.results": { fase: 3, reden: "resultaten lezen" },
    'setTab("norm")': { fase: 3, reden: "de normtoets van de staaf" },
    "openFem3d.chooseProfile": veld("model3d.beam.update", "profileName"),
    "openFem3d.props.flipAxes": { commando: "model3d.beam.flipLocalAxes" },
    "openFem3d.props.presetRigid": { commando: "model3d.beam.setReleasePreset" },
    "openFem3d.props.presetPinned": { commando: "model3d.beam.setReleasePreset" },
    "openFem3d.props.deleteSurfaceLoad": { commando: "model3d.load.surface.delete" },
  },
  "OpenFem3DNodeConditions.tsx": {
    usePreset: OPLEGGING,
    "openFem3d.free": { commando: "model3d.support.remove" },
    selectLoad: { fase: 4, reden: "een last kiezen om te bewerken is selectie" },
    "openFem3d.deleteLoad": { commando: "model3d.load.nodal.delete" },
    "openFem3d.addLoad": { commando: ["model3d.load.nodal.add", "model3d.load.nodal.update"] },
  },
  "OpenFem3DMemberLoads.tsx": {
    "openFem3d.memberLoads.tabLine": WEERGAVE,
    "openFem3d.memberLoads.tabPoint": WEERGAVE,
    "openFem3d.memberLoads.tabThermal": WEERGAVE,
    select: { fase: 4, reden: "een last kiezen om te bewerken is selectie" },
    selectPoint: { fase: 4, reden: "een last kiezen om te bewerken is selectie" },
    selectThermal: { fase: 4, reden: "een last kiezen om te bewerken is selectie" },
    "openFem3d.memberLoads.deleteLine": { commando: "model3d.load.member.delete" },
    "openFem3d.memberLoads.newLine": { commando: "model3d.load.member.add" },
    "openFem3d.memberLoads.fewerOptions": WEERGAVE,
    "openFem3d.memberLoads.addLine": { commando: ["model3d.load.member.add", "model3d.load.member.update"] },
    "openFem3d.memberLoads.deletePoint": { commando: "model3d.load.memberPoint.delete" },
    "openFem3d.memberLoads.newPoint": { commando: "model3d.load.memberPoint.add" },
    "openFem3d.memberLoads.add": {
      commando: ["model3d.load.memberPoint.add", "model3d.load.memberPoint.update", "model3d.load.thermal.add", "model3d.load.thermal.update"],
    },
    "openFem3d.memberLoads.deleteThermal": { commando: "model3d.load.thermal.delete" },
    "openFem3d.memberLoads.newThermal": { commando: "model3d.load.thermal.add" },
  },
  "OpenFem3DLoadPanelProperties.tsx": {
    "openFem3d.loadPanel.flip": veld("model3d.loadPanel.update", "direction"),
    "openFem3d.loadPanel.pickSpan": veld("model3d.loadPanel.update", "spanDirection"),
    "openFem3d.loadPanel.duplicateButton": { commando: "model3d.loadPanel.duplicate" },
    "openFem3d.loadPanel.delete": { commando: "model3d.loadPanel.delete" },
  },
  // De modelcontrole op het 3D-tekenvlak (issues #63 en #75): knopen op een staaf zonder verbinding, en samenvallende knopen.
  "OpenFem3DModelCheck.tsx": {
    "openFem3d.modelCheck.toggleTitle": WEERGAVE,
    "openFem3d.modelCheck.connectTitle": { commando: "model3d.beam.connectNodes" },
    // Samenvallende knopen (issue #75): de knop Samenvoegen.
    "openFem3d.modelCheck.mergeTitle": { commando: "model3d.nodes.merge" },
  },
  "OpenFem3DTrekSchijfVelden.tsx": {
    "openFem3d.trekSchijf.makeDiaphragm": { commando: "model3d.diaphragm.add" },
  },
  "OpenFem3DTransformPanel.tsx": {
    onCancel: WEERGAVE,
    cancel: WEERGAVE,
    "openFem3d.apply": TRANSFORMATIE,
  },
  // Het venster Selectiefilter (issue #94), ook in 2D.
  "selectieFilter/SelectieFilterDialog.tsx": {
    "selectieFilter.wissen": WEERGAVE,
    cancel: WEERGAVE,
    apply: { commando: "model3d.selection.filter" },
  },
};

// ── Sneltoetsen ────────────────────────────────────────────────────────────
// De toetsreeksen uit lib/commandoReeks.ts (kleine letters, aaneen) en de
// toetsen die de editor, het tekenvlak en de app afvangen (`event.key`).

export const SNELTOETSEN_3D: Record<string, Dekking> = {
  m: TRANSFORMATIE,
  mv: TRANSFORMATIE,
  co: TRANSFORMATIE,
  Delete: { commando: "model3d.selection.delete" },
  Escape: { fase: 4, reden: "gereedschap afbreken of de selectie opheffen; tijdens het slepen van een greep de section box resetten" },
  Enter: { fase: 4, reden: "een label op het tekenvlak kiezen (selectie); bij het tekenen de getypte maat bevestigen (tekenhulp)" },
  " ": { fase: 4, reden: "een label op het tekenvlak kiezen (selectie)" },
  // Tekenhulpen van het 3D-tekenvlak (#84): geen modelfunctie, de commando's
  // krijgen coördinaten en lengtes al exact mee.
  Alt: { fase: 4, reden: "tekenhulp: alle snaps tijdelijk uit" },
  Shift: { fase: 4, reden: "tekenhulp: ortho, de richting langs een globale as" },
  Backspace: { fase: 4, reden: "tekenhulp: een teken van de getypte maat wissen" },
  ",": { fase: 4, reden: "tekenhulp: decimaalteken van de getypte maat" },
  ".": { fase: 4, reden: "tekenhulp: decimaalteken van de getypte maat" },
  z: { commando: ["app.undo", "app.redo"] },
  y: { commando: "app.redo" },
  s: { commando: "app.project.save" },
  "?": { fase: 4, reden: "overzicht van de sneltoetsen openen (lib/sneltoetsen.ts); geen modelfunctie" },
};
